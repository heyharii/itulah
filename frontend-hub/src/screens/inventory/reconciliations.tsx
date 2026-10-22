import { useSuspenseInfiniteQuery } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Card } from "@/components/ui/card"
import { DataTable, dockSortOf } from "@/components/ui/data-table"
import { FilterPanel } from "@/components/ui/filter-panel"
import { BarSpacer } from "@/components/ui/list-chrome"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { useFilterState, type Filter, type FilterField } from "@/lib/filters"
import { count, moment, sku as skuNumber } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  reconciliationsPageQuery,
  type Reconciliation,
  type ReconciliationScope,
} from "@/lib/queries/inventory"
import { tableSetup, type TableSetup } from "@/lib/table"
import { useDebounced } from "@/lib/use-debounced"
import { CardName } from "@/components/ui/phone-cards"

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
    meta: { card: "hide" },
    cell: ({ row }) => (
      <Pill tone={TONE[row.original.status]}>{WORD[row.original.status]}</Pill>
    ),
  },
  {
    accessorKey: "epc",
    header: "Tag",
    size: 220,
    meta: { card: "hide" },
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
    meta: { card: "hide" },
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
    meta: { card: "hide" },
    cell: ({ row }) =>
      row.original.sku_code ? (
        <span className="font-mono text-id text-body">
          {skuNumber(row.original.sku_code)}
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
    meta: { card: "hide" },
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
    meta: { card: "hide" },
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
    meta: { card: "hide" },
    cell: ({ row }) => moment(row.original.received?.occurred_at),
  },
]

/// The card a phone draws for a claim, as columns of their own that exist there
/// only (`cardLead`): the SKU over the tag, the route and shipment on the foot,
/// and where the claim stands. A claim has no figure to lead with.
const cards: ColumnDef<TableSetup, Reconciliation>[] = [
  {
    id: "head",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "title" },
    accessorFn: (row) => row.sku_code ?? "",
    cell: ({ row }) => (
      <CardName
        name={
          row.original.sku_code ??
          `${count(row.original.sku_codes.length)} codes`
        }
        code={row.original.epc}
      />
    ),
  },
  {
    id: "foot",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { card: "foot" },
    accessorFn: (row) => row.destination_store_id,
    cell: ({ row }) => (
      <span className="flex flex-col leading-6">
        <span>
          {row.original.source_dc_id ?? "—"} →{" "}
          {row.original.destination_store_id}
          {row.original.status === "MATCHED" && !row.original.attributed && (
            <span className="font-medium text-warn-fg"> · unexplained</span>
          )}
        </span>
        {(row.original.shipment_reference ??
          row.original.received?.occurred_at) && (
          <span className="tabular-nums">
            {row.original.shipment_reference}
            {row.original.shipment_reference !== null &&
              row.original.received !== null &&
              " · "}
            {row.original.received !== null &&
              moment(row.original.received?.occurred_at)}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "where",
    header: "",
    enableHiding: false,
    enableSorting: false,
    meta: { align: "right", card: "status" },
    accessorFn: (row) => row.status,
    cell: ({ row }) => (
      <Pill tone={TONE[row.original.status]}>{WORD[row.original.status]}</Pill>
    ),
  },
]

export function Reconciliations() {
  // The title stands at once; the claims wait for the first page and stream in
  // with it (the server starts the read too).
  return (
    <PageContent>
      <PageHeader
        crumb="Inventory"
        title="Claim Reconciliation"
        sub="Every tag a DC says it sent, against every tag a store says it received."
      />
      <Suspense fallback={<LoadingState>Matching the claims…</LoadingState>}>
        <ClaimBook />
      </Suspense>
    </PageContent>
  )
}

function ClaimBook() {
  const phone = useLayout() === "phone"
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

  // The deferred scope keeps the rows in hand on screen while the next
  // question is read, so a keystroke does not empty the table.
  const asked = useDeferredValue(scope)
  const report = useSuspenseInfiniteQuery(reconciliationsPageQuery(asked))

  const rows = useMemo(
    () => report.data.pages.flatMap((page) => page.rows),
    [report.data]
  )
  const head = report.data.pages[0]

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
        columns: phone ? [...columns, ...cards] : columns,
        getRowId: (row: Reconciliation) =>
          `${row.destination_store_id}/${row.epc}/${row.shipment_reference ?? ""}`,
        state: { sorting },
        // The rows arrive in the order the request asked for.
        manualSorting: true,
        onSortingChange: setSorting,
      }),
      [rows, sorting, phone]
    )
  )

  const summary = head?.summary
  const attention = summary
    ? summary.store_only + summary.unresolved + summary.conflicts
    : undefined

  return (
    <>
      {/* On a phone the slice, the search, the filter and the order are the
          dock's. */}
      <DockTools
        search={{ value: query, onChange: setQuery, label: "Search claims" }}
        filter={{
          count: filters.filters.length,
          panel: { model: filters, filterModel: model },
        }}
        sort={dockSortOf(table)}
        status={{
          value: slice,
          options: [
            {
              value: "attention",
              label: "Needs answering",
              ...(attention === undefined ? {} : { count: attention }),
            },
            {
              value: "all",
              label: "Every claim",
              ...(head === undefined ? {} : { count: head.total }),
            },
          ],
          onChange: (next) => setSlice(next as "attention" | "all"),
        }}
      />

      {(() => {
        // The summary is the whole fleet's and arrives on every page.
        const data = report.data.pages[0]
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

            {/* The slice is the page's status: tabs on a desk, the dock's
                  status button on a phone. */}
            <SubTabs
              className="max-md:hidden"
              tabs={[
                {
                  value: "attention",
                  label: (
                    <span>
                      Needs answering
                      {attention !== undefined && (
                        <span className="ml-1.5 text-body tabular-nums">
                          {count(attention)}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  value: "all",
                  label: (
                    <span>
                      Every claim
                      {/* The server's total is over the slice being read:
                            beside "Needs answering" it would say 0. */}
                      {slice === "all" && (
                        <span className="ml-1.5 text-body tabular-nums">
                          {count(data.total)}
                        </span>
                      )}
                    </span>
                  ),
                },
              ]}
              value={slice}
              onChange={(next) => setSlice(next as "attention" | "all")}
            />

            <div className="group/bar mb-3.5 flex min-h-[2.25rem] flex-wrap items-center gap-2 max-md:hidden">
              <FilterPanel
                model={model}
                search={{
                  value: query,
                  onChange: setQuery,
                  label: "Search claims",
                }}
              />
              <BarSpacer />
              <span className="text-[0.9375rem] text-mute tabular-nums">
                {count(data.total)} claims
              </span>
            </div>

            <Card
              aria-busy={asked !== scope || undefined}
              className="list-swap overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none"
            >
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
                  refresh={[report]}
                  table={table}
                  more={report}
                  className="max-h-[calc(100dvh-24rem)]"
                  cardSort={false}
                  cardsApart
                  cardLead
                />
              )}
            </Card>
          </>
        )
      })()}
    </>
  )
}
