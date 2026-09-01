import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { FilterBar } from "@/components/ui/filter-bar"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilters } from "@/lib/filters"
import { count, moment } from "@/lib/format"
import {
  inventoryKeys,
  listReconciliations,
  type Reconciliation,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"

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

/// Attention first, alphabetical never. The rank is what the column sorts on
/// while the pill is what it draws, so opening the screen puts the rows that
/// stop certification at the top without anybody choosing a sort.
const RANK: Readonly<Record<Reconciliation["status"], number>> = {
  STORE_ONLY: 0,
  CONFLICT: 1,
  UNRESOLVED: 2,
  DC_ONLY: 3,
  MATCHED: 4,
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
    id: "status",
    accessorFn: (row) => RANK[row.status],
    header: "Status",
    size: 130,
    meta: { filter: { kind: "option" } },
    cell: ({ row }) => (
      <Pill tone={TONE[row.original.status]}>{WORD[row.original.status]}</Pill>
    ),
  },
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    meta: { filter: { kind: "text" } },
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
    meta: { filter: { kind: "option" } },
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
    meta: { filter: { kind: "text" } },
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
    meta: { filter: { kind: "text" } },
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
    cell: ({ row }) => moment(row.original.received?.occurred_at),
  },
]

export function Reconciliations() {
  const [slice, setSlice] = useState<"attention" | "all">("attention")
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "status", desc: false },
  ])

  const report = useQuery({
    queryKey: inventoryKeys.reconciliations(),
    queryFn: ({ signal }) => listReconciliations(signal),
  })

  const rows = useMemo(() => {
    const items = report.data?.items ?? []
    return slice === "attention"
      ? items.filter(
          (item) => item.status !== "MATCHED" && item.status !== "DC_ONLY"
        )
      : items
  }, [report.data, slice])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: Reconciliation) =>
          `${row.destination_store_id}/${row.epc}/${row.shipment_reference ?? ""}`,
        state: {
          columnFilters: filters.columnFilters,
          globalFilter: query,
          sorting,
        },
        onSortingChange: setSorting,
        onGlobalFilterChange: setQuery,
      }),
      [rows, filters.columns, filters.columnFilters, query, sorting]
    )
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Transfer reconciliation"
        sub="Every tag a DC says it sent, against every tag a store says it received."
      />

      {queryState(report, {
        loading: "Matching the claims…",
        render: (data) => (
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
              <Kpi label="Unresolved" value={count(data.summary.unresolved)} />
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
                placeholder="Tag, store or shipment"
                className="h-8 w-64"
              />
              <FilterBar model={filters} table={table} />
              <Toolbar.Spacer />
              <span className="text-[0.71875rem] text-mute tabular-nums">
                {count(rows.length)} of {count(data.items.length)}
              </span>
            </Toolbar>

            <Card className="overflow-hidden">
              {rows.length === 0 ? (
                <EmptyState>
                  {slice === "attention"
                    ? "Every transfer claim matches. Nothing here is holding the fleet total back."
                    : "No DC has claimed a despatch and no store has claimed a receipt."}
                </EmptyState>
              ) : (
                <DataTable<Reconciliation>
                  table={table}
                  className="max-h-[calc(100vh-26rem)]"
                />
              )}
            </Card>
          </>
        ),
      })}
    </PageContent>
  )
}
