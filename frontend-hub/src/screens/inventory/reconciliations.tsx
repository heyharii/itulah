import { useInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  inventoryKeys,
  reconciliationsPage,
  type Reconciliation,
  type ReconciliationScope,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"

/// One tag, two claims: the DC says it sent it, the store says it received it.
///
/// `MATCHED` is the healthy case and `DC_ONLY` is simply goods still in the
/// air. The three that matter are `STORE_ONLY` — a store signed for a tag no DC
/// says it despatched — plus `UNRESOLVED` and `CONFLICT`, and between them they
/// are one of the three reasons the server refuses to certify a fleet total.
/// That is why this screen exists as more than a report: clearing it is what
/// makes the number on the overview appear.
///
/// A matched receipt still has to be tied back to the allotment line that
/// promised it. **Unattributed** means the goods arrived and nothing knows what
/// they were sent against — matched, and still not explained.

/// Which column means which order the endpoint names. The server's `status`
/// order is attention first, alphabetical never — the rows that stop
/// certification at the top without anybody choosing a sort. A column not in
/// here cannot be sorted: sorting it would sort the loaded pages.
const SORTS: Record<string, string> = {
  status: "status",
  epc: "epc",
  route: "destination",
}

/// The route's two ends, as the chips the endpoint answers. `single`, because
/// it compares one column to one value.
const FIELDS: FilterField[] = [
  {
    column: "destination_store_id",
    label: "Store",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
  {
    column: "source_dc_id",
    label: "Sent from",
    spec: { kind: "option", single: true, operators: ["isAnyOf"] },
  },
]

function scopeFromFilters(filters: readonly Filter[]): {
  destination_store_id?: string
  source_dc_id?: string
} {
  const scope: { destination_store_id?: string; source_dc_id?: string } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0 || operator !== "isAnyOf") continue
    if (column === "destination_store_id")
      scope.destination_store_id = values[0]
    else if (column === "source_dc_id") scope.source_dc_id = values[0]
  }
  return scope
}

const TONE: Readonly<
  Record<Reconciliation["status"], "ok" | "warn" | "bad" | "info">
> = {
  MATCHED: "ok",
  DC_ONLY: "info",
  STORE_ONLY: "bad",
  UNRESOLVED: "warn",
  CONFLICT: "bad",
}

const WORD: Readonly<Record<Reconciliation["status"], string>> = {
  MATCHED: "Matched",
  DC_ONLY: "In the air",
  STORE_ONLY: "Store only",
  UNRESOLVED: "Unresolved",
  CONFLICT: "Conflict",
}

const columns: ColumnDef<TableSetup, Reconciliation>[] = [
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    cell: ({ row }) => (
      <Pill tone={TONE[row.original.status]}>{WORD[row.original.status]}</Pill>
    ),
  },
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">{row.original.epc}</span>
    ),
  },
  {
    id: "route",
    accessorFn: (row) =>
      `${row.source_dc_id ?? ""} ${row.destination_store_id}`,
    header: "Route",
    size: 200,
    cell: ({ row }) => (
      <span className="text-body">
        {row.original.source_dc_id ?? "—"} → {row.original.destination_store_id}
      </span>
    ),
  },
  {
    accessorKey: "sku_code",
    header: "SKU",
    size: 140,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.sku_code ? (
        <span className="font-mono text-id text-body">
          {row.original.sku_code}
        </span>
      ) : (
        <Tag tone="warn">{count(row.original.sku_codes.length)} CODES</Tag>
      ),
  },
  {
    accessorKey: "shipment_reference",
    header: "Shipment",
    size: 150,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono text-id text-mute">
        {row.original.shipment_reference ?? "—"}
      </span>
    ),
  },
  {
    id: "attributed",
    accessorFn: (row) => (row.attributed ? 1 : 0),
    header: "Attributed",
    size: 120,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.status !== "MATCHED" ? (
        <span className="text-mute">—</span>
      ) : row.original.attributed ? (
        <Tag tone="ok">ALLOTTED</Tag>
      ) : (
        <Tag tone="warn">UNEXPLAINED</Tag>
      ),
  },
  {
    id: "received",
    accessorFn: (row) => row.received?.occurred_at ?? "",
    header: "Received",
    size: 160,
    enableSorting: false,
    cell: ({ row }) => moment(row.original.received?.occurred_at),
  },
]

export function Reconciliations() {
  const [slice, setSlice] = useState<"attention" | "all">("attention")
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "status", desc: false },
  ])

  const filters = useFilterState(FIELDS)

  // Debounced: every keystroke re-folds the fleet's claims.
  const needle = useDebounced(query.trim(), 400)
  const scope = useMemo<ReconciliationScope>(() => {
    const by = sorting[0]
    return {
      ...scopeFromFilters(filters.filters),
      ...(needle === "" ? {} : { q: needle }),
      // The three that stop certification, asked of the server rather than
      // sifted out of the page in hand.
      ...(slice === "attention" ? { status: "ATTENTION" } : {}),
      sort: by === undefined ? undefined : SORTS[by.id],
      desc: by?.desc === true,
    }
  }, [filters.filters, needle, slice, sorting])

  const report = useInfiniteQuery({
    queryKey: inventoryKeys.reconciliations(scope),
    queryFn: ({ pageParam, signal }) =>
      reconciliationsPage({ ...scope, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  const rows = useMemo(
    () => report.data?.pages.flatMap((page) => page.rows) ?? [],
    [report.data]
  )
  const head = report.data?.pages[0]

  const model = useMemo(
    () => ({
      ...filters,
      fields: head
        ? FIELDS.map((field) => ({
            ...field,
            spec: {
              ...field.spec,
              counted:
                field.column === "destination_store_id"
                  ? head.facets.destinations
                  : head.facets.sources,
            },
          }))
        : FIELDS,
    }),
    [filters, head]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: Reconciliation) =>
          `${row.destination_store_id}/${row.epc}/${row.shipment_reference ?? ""}`,
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Claim reconciliation"
        sub="Every tag a DC says it sent, against every tag a store says it received."
      />

      {queryState(report, {
        loading: "Matching the claims…",
        render: (answer) => {
          // The summary is the whole fleet's and arrives on every page.
          const data = answer.pages[0]
          return (
            <>
              <KpiStrip>
                <Kpi
                  label="Matched"
                  value={count(data.summary.matched)}
                  delta={`${count(data.summary.matched_unattributed)} unexplained`}
                  tone={data.summary.matched_unattributed > 0 ? "down" : "up"}
                />
                <Kpi label="In the air" value={count(data.summary.dc_only)} />
                <Kpi
                  label="Store only"
                  value={count(data.summary.store_only)}
                  tone={data.summary.store_only > 0 ? "down" : "flat"}
                />
                <Kpi
                  label="Unresolved"
                  value={count(data.summary.unresolved)}
                />
                <Kpi label="Conflicts" value={count(data.summary.conflicts)} />
                <Kpi label="Read at" value={moment(data.as_of)} />
              </KpiStrip>

              {data.summary.store_only +
                data.summary.unresolved +
                data.summary.conflicts >
                0 && (
                <Banner tone="warn" className="mb-[1.125rem]">
                  While any of these stands, the server will not certify a fleet
                  total: a tag claimed by a store and by nobody else is either
                  stock that arrived from nowhere or a despatch that was never
                  recorded, and it cannot tell which.
                </Banner>
              )}

              <Toolbar>
                <Segmented
                  value={slice}
                  onChange={setSlice}
                  options={[
                    { value: "attention", label: "Needs answering" },
                    { value: "all", label: "Every claim" },
                  ]}
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 w-64"
                />
                <FilterPanel model={model} />
                <Toolbar.Spacer />
                <span className="text-[0.875rem] text-mute tabular-nums">
                  {count(data.total)} claims
                </span>
              </Toolbar>

              <Card className="overflow-hidden">
                {rows.length === 0 ? (
                  <EmptyState>
                    {needle !== "" || filters.filters.length > 0
                      ? "No claim matches what you asked for."
                      : slice === "attention"
                        ? "Every claim matches. Nothing here is holding the fleet total back."
                        : "No DC has claimed a despatch and no store has claimed a receipt."}
                  </EmptyState>
                ) : (
                  <DataTable<Reconciliation>
                    table={table}
                    more={report}
                    className="max-h-[calc(100vh-26rem)]"
                  />
                )}
              </Card>
            </>
          )
        },
      })}
    </PageContent>
  )
}
