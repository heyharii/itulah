import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Grid3x3 } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { DockedFilters, ViewPicker } from "@/components/ui/list-chrome"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable, TotalsLadder } from "@/components/ui/rows"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { Thumbnail } from "@/components/ui/thumbnail"
import {
  Lifecycle,
  Timeline,
  type TimelineEvent,
} from "@/components/ui/timeline"
import { useFilters } from "@/lib/filters"
import { count, day, label as humanise, moment, toneFor } from "@/lib/format"
import { useCatalogueIdentity } from "@/lib/operations/catalogue"
import {
  allotmentDetail,
  allotmentsByArticle,
  allotmentsByStore,
  cancelAllotment,
  executeAllotment,
  fleetPools,
  idempotencyKey,
  inventoryKeys,
  listAllotments,
  type AllotmentRow,
  type ArticleAllotmentList,
  type StoreSkuSummary,
} from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { Choice, Metric, MetricRow } from "@/screens/inventory/parts"
import { sitesOf, useActor } from "@/screens/inventory/shared"

/// Allotments — goods promised out of a pool.
///
/// The number to read is **remaining**: accepted minus picked minus cancelled,
/// which is what is still reserved and has not moved. It is the quantity
/// holding stock out of everybody else's reach, so the list opens sorted by it.
///
/// `accepted` rather than `quantity` is what everything is measured against. An
/// allotment a DC owns counts as nothing until that DC accepts it, so 300
/// ordered with 0 accepted is a real and common state — and 0 is what can be
/// picked. The same ownership decides whether picking is possible here at all:
/// the centre may only execute an allotment no DC owns, because picking is the
/// warehouse's act and raising a movement nobody made would be inventing stock
/// history.

const TYPES = [
  { value: "TO_STORE", label: "To store" },
  { value: "RETURN_TO_DC", label: "Return to DC" },
  { value: "RETURN_TO_SUPPLIER", label: "Return to supplier" },
]

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DC_COMPLETED", label: "DC completed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
]

/// The road from allotted to arrived, in the order goods travel it. Each stage
/// counts pieces that have reached at least that far, so the numbers only fall
/// from left to right — and where they fall is where the goods are.
const STAGES = [
  { key: "total_accepted_quantity", label: "Accepted" },
  { key: "total_picked_quantity", label: "Picked" },
  { key: "total_packed_quantity", label: "Packed" },
  { key: "total_shipment_quantity", label: "Shipment" },
  { key: "total_dispatched_quantity", label: "Dispatched" },
  { key: "total_in_transit_quantity", label: "In transit" },
  { key: "total_received_quantity", label: "Received" },
] as const

/// Ticks in the progress bar. Twenty-four is the older app's count, and it is
/// a good one: enough that a single piece of a hundred still moves the bar,
/// few enough that each tick stays wide enough to see.
const TICKS = 24

const columns: ColumnDef<TableSetup, AllotmentRow>[] = [
  {
    accessorKey: "allotment_number",
    header: "Allotment",
    size: 150,
    meta: { filter: { kind: "text" } },
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-id text-body">
          {row.original.allotment_number}
        </span>
        {/* Only when it is not the ordinary thing. Every allotment this app
            raises goes to a store, so a column of TO_STORE nine hundred rows
            deep said nothing; a return — raised from the pool screen that
            found the goods wrong — is rare enough to be worth a word. */}
        {row.original.type !== "TO_STORE" && (
          <Tag>{humanise(row.original.type)}</Tag>
        )}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 140,
    meta: { filter: { kind: "option", format: humanise } },
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {humanise(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Raised",
    size: 120,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.created_at),
  },
  {
    // How big the delivery is, in the three units a person asks about: how
    // many garments it names, how many pieces that comes to, and how many
    // shops are waiting on it. A row without them says "ALT-13, active" and
    // nothing about the size of what is standing still.
    accessorKey: "sku_count",
    header: "Items",
    size: 90,
    meta: { align: "right", filter: { kind: "number" } },
    cell: ({ row }) => (
      <span
        className="tabular-nums"
        title={`${count(row.original.line_count)} lines — one per SKU per destination`}
      >
        {count(row.original.sku_count)}
      </span>
    ),
  },
  {
    accessorKey: "total_quantity",
    header: "Qty",
    size: 90,
    meta: { align: "right", filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => (
      <span className="tabular-nums">{count(row.original.total_quantity)}</span>
    ),
  },
  {
    accessorKey: "destination_count",
    header: "Stores",
    size: 90,
    meta: { align: "right", filter: { kind: "number" } },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {count(row.original.destination_count)}
      </span>
    ),
  },
  {
    // Keyed on what has not arrived — ordered less received less cancelled —
    // so the list can still be sorted and filtered by the number that matters,
    // drawn rather than printed. Deliberately NOT `remaining_quantity`: that
    // one is accepted minus picked, so an allotment no DC has accepted reads
    // as nothing outstanding, which is the opposite of the truth for the shop
    // waiting for it.
    id: "outstanding",
    accessorFn: (row: AllotmentRow) =>
      Math.max(
        0,
        row.total_quantity -
          row.total_received_quantity -
          row.total_cancelled_quantity
      ),
    header: "Progress",
    size: 260,
    meta: { filter: { kind: "number", unit: "pcs" } },
    cell: ({ row }) => (
      <Journey
        total={row.original.total_quantity}
        picked={row.original.total_picked_quantity}
        dispatched={row.original.total_dispatched_quantity}
        received={row.original.total_received_quantity}
        cancelled={row.original.total_cancelled_quantity}
      />
    ),
  },
]

/// How far one allotment has actually travelled, in a bar.
///
/// This replaces five columns of stage counters — accepted, picked, received,
/// remaining — which asked a person to subtract in their head to answer the
/// only question they were reading the row for: *is this moving*. The counters
/// are still on the record; a list is where the shape of the thing belongs.
///
/// The bar is segmented rather than solid, the way the same measurement is
/// drawn in the older app: twenty-four ticks read as a countable quantity,
/// where a smooth fill reads as a percentage nobody can check.
///
/// It is coloured by stage rather than by threshold. An allotment fully picked
/// but not yet delivered is not "0% done" — the goods are off the rack and in
/// a box, and a bar that showed nothing until they arrived would say the
/// warehouse had not started.
function Journey({
  total,
  picked,
  dispatched,
  received,
  cancelled,
}: {
  total: number
  picked: number
  dispatched: number
  received: number
  cancelled: number
}) {
  // Each counter is cumulative — pieces that reached at least that far — so a
  // band is a difference, and never negative even when two stages report out
  // of order across a sync.
  const arrived = received
  const travelling = Math.max(0, dispatched - arrived)
  const gathered = Math.max(0, picked - dispatched)
  const waiting = Math.max(
    0,
    total - arrived - travelling - gathered - cancelled
  )

  const marks: string[] = []
  for (const band of [
    { pieces: arrived, tone: "bg-ok" },
    { pieces: travelling, tone: "bg-accent" },
    { pieces: gathered, tone: "bg-info" },
    { pieces: cancelled, tone: "bg-line-ico" },
  ]) {
    const ticks = total <= 0 ? 0 : Math.round((band.pieces / total) * TICKS)
    for (let tick = 0; tick < ticks && marks.length < TICKS; tick += 1)
      marks.push(band.tone)
  }
  while (marks.length < TICKS) marks.push("bg-soft-2")

  const share = total <= 0 ? 0 : Math.round((arrived / total) * 100)

  return (
    <div
      className="flex min-w-[9rem] items-center gap-2"
      // The breakdown the columns used to hold, kept within reach of the row
      // it belongs to rather than a click away in the record.
      title={`${count(total)} promised · ${count(gathered)} picked · ${count(travelling)} in transit · ${count(arrived)} received${cancelled > 0 ? ` · ${count(cancelled)} cancelled` : ""}${waiting > 0 ? ` · ${count(waiting)} not started` : ""}`}
    >
      <span className="flex flex-1 gap-px" aria-hidden>
        {marks.map((tone, tick) => (
          <span key={tick} className={cn("h-2 flex-1 rounded-full", tone)} />
        ))}
      </span>
      <span className="w-9 shrink-0 text-right text-[0.875rem] font-medium text-body tabular-nums">
        {share}%
      </span>
    </div>
  )
}

/// The three readings of the allotment book, as the picker beside the title
/// offers them.
///
/// They were a row of tabs until 2026-09-13. Tabs say "these are three
/// screens"; they are three questions asked of one book — the paperwork, one
/// shop's, one garment's — and the owner's instruction was to name them the way
/// the order book names its views. The value is what the queries below switch
/// on, so the words here are the only place they are spelled for a reader.
const VIEWS = [
  { value: "all", label: "Every allotment" },
  { value: "store", label: "By store" },
  { value: "article", label: "By article" },
]

export function Allotments() {
  const [tab, setTab] = useState("all")
  const [type, setType] = useState("")
  const [status, setStatus] = useState("")
  const [store, setStore] = useState("")
  const [query, setQuery] = useState("")
  const allotment = useSheet("allotment")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "outstanding", desc: true },
  ])

  const list = useQuery({
    queryKey: inventoryKeys.allotmentList(type, status),
    queryFn: ({ signal }) => listAllotments(type, status, signal),
    enabled: tab === "all",
  })

  const byStore = useQuery({
    queryKey: inventoryKeys.allotmentsByStore(store),
    queryFn: ({ signal }) => allotmentsByStore(store, signal),
    enabled: tab === "store" && store !== "",
  })

  /// The same book grouped by garment instead of by paperwork. The store
  /// filter is shared with the tab beside it deliberately: "what has store 03
  /// been sent" and "which articles went to store 03" are two readings of one
  /// question, and having to choose the shop twice to ask both is a filter
  /// that forgets what it was told.
  const byArticle = useQuery({
    queryKey: inventoryKeys.allotmentsByArticle(store),
    queryFn: ({ signal }) => allotmentsByArticle(store, signal),
    enabled: tab === "article",
  })

  const fleet = useQuery({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

  const source = tab === "store" ? byStore : list
  const rows = useMemo(
    () => (source.data?.items ?? []) as AllotmentRow[],
    [source.data]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: AllotmentRow) => row.id,
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

  const stores = useMemo(
    () =>
      sitesOf(fleet.data?.items ?? [], "STORE").map((site) => ({
        value: site.site_id,
        label: site.site_name,
      })),
    [fleet.data]
  )

  const shortages = source.data?.shortages ?? []

  return (
    <PageContent>
      <PageHeader
        crumb="Allotment"
        title="Allotments"
        sub="What has been promised out of a pool, and how far it has actually travelled."
      />

      <Toolbar>
        {/* Which reading of the book is on screen, and the saved questions
            somebody asks of it every morning — one control, the same one the
            order book wears, in the same place. The three readings were tabs
            until 2026-09-13; a tab row claimed they were three screens, and
            spent a full line of the page saying so. */}
        <ViewPicker
          model={filters}
          id="allotments"
          views={VIEWS}
          view={tab}
          onView={setTab}
        />
        {tab === "all" ? (
          <>
            <Choice
              value={type}
              onChange={setType}
              options={TYPES}
              placeholder="Every type"
            />
            <Choice
              value={status}
              onChange={setStatus}
              options={STATUSES}
              placeholder="Every status"
            />
          </>
        ) : (
          <Choice
            value={store}
            onChange={setStore}
            options={stores}
            placeholder={tab === "store" ? "Choose a store" : "Every store"}
            className="max-w-72"
          />
        )}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="h-8 w-48"
        />
        <Toolbar.Spacer />
        {/* A link and not a button: the composer is a page of its own now —
            a matrix wide enough to hold thirteen stores does not fit a rail —
            and a page you can be sent to is a page you can be sent a link to. */}
        <AppLink to="/allotment/new" variant="primary">
          <Grid3x3 />
          New allotment
        </AppLink>
      </Toolbar>

      {/* Two columns from 1440 up: the book, and the panel that narrows it —
          the shape the order book has worn since its own panel docked, and the
          reason the filter popover above the table is gone. Below that width
          the same model is reached from the panel's own sheet. */}
      <div className="grid min-w-0 items-start gap-5 dock:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col">
          {shortages.length > 0 && (
            <Card className="mb-[1.125rem] overflow-hidden">
              <CardHeader>
                <CardTitle>Promised more than the pool holds</CardTitle>
                <span className="text-[0.875rem] text-mute tabular-nums">
                  {count(shortages.length)}
                </span>
              </CardHeader>
              <div className="border-t border-hairline px-4 py-3">
                <p className="mb-2.5 text-[0.875rem] text-mute">
                  On Hand is Stock minus Allotted, so a negative reading means
                  the allotments standing against this pool add up to more than
                  the goods in it. The server reports it rather than preventing
                  it — allotting is a promise, and a warehouse is allowed to
                  find out it cannot keep one.
                </p>
                <MiniTable
                  head={["Article", "SKU", "Stock", "Allotted", "Short by"]}
                >
                  {shortages.map((item) => (
                    <tr key={item.sku_id} className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[0.875rem] text-ink">
                        {item.article_name}
                      </td>
                      <td className="py-2 text-right font-mono text-[0.875rem] text-body">
                        {item.sku_code}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.stock_qty)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(item.allotted_qty)}
                      </td>
                      <td className="py-2 text-right font-medium text-bad-fg tabular-nums">
                        {count(item.shortage_qty)}
                      </td>
                    </tr>
                  ))}
                </MiniTable>
              </div>
            </Card>
          )}

          {tab === "article" ? (
            <ByArticle
              query={byArticle}
              needle={query}
              store={stores.find((one) => one.value === store)?.label ?? null}
            />
          ) : tab === "store" && store === "" ? (
            <Card>
              <EmptyState>
                Choose a store to see everything owed to it, and its lifetime
                per-SKU pipeline.
              </EmptyState>
            </Card>
          ) : (
            <>
              {tab === "store" && byStore.data && (
                <Card className="mb-[1.125rem] px-4 py-3.5">
                  <MetricRow>
                    <Metric
                      label="Ordered"
                      value={count(
                        byStore.data.sku_summary.reduce(
                          (total, sku) => total + sku.quantity,
                          0
                        )
                      )}
                    />
                    <Metric
                      label="Received"
                      value={count(
                        byStore.data.sku_summary.reduce(
                          (total, sku) => total + sku.received_quantity,
                          0
                        )
                      )}
                    />
                    <Metric
                      label="Still owed"
                      value={count(
                        byStore.data.sku_summary.reduce(
                          (total, sku) =>
                            total +
                            Math.max(
                              0,
                              sku.quantity -
                                sku.received_quantity -
                                sku.cancelled_quantity
                            ),
                          0
                        )
                      )}
                      tone="warn"
                    />
                    <Metric
                      label="SKUs"
                      value={count(byStore.data.sku_summary.length)}
                    />
                  </MetricRow>
                  <p className="mt-3 text-[0.875rem] text-mute">
                    This summary spans every allotment ever addressed to{" "}
                    {byStore.data.destination_name} — not only the ones listed
                    below.
                  </p>
                </Card>
              )}

              {tab === "store" && byStore.data && (
                <ByStoreSkus
                  rows={byStore.data.sku_summary}
                  store={byStore.data.destination_name}
                  needle={query}
                />
              )}

              <Card className="overflow-hidden">
                {queryState(source, {
                  loading: "Reading the allotment book…",
                  render: () =>
                    rows.length === 0 ? (
                      <EmptyState>
                        {type === "" && status === "" && query === ""
                          ? "Nothing has been allotted out of any pool yet."
                          : "No allotment matches these filters."}
                      </EmptyState>
                    ) : (
                      <DataTable<AllotmentRow>
                        table={table}
                        onRowClick={(row) => allotment.open(row.id)}
                        isSelected={(row) => row.id === allotment.value}
                        className="max-h-[calc(100vh-22rem)]"
                      />
                    ),
                })}
              </Card>
            </>
          )}
        </div>

        {/* Only where there is a table to narrow. "By article" is a different
            reading with columns of its own, and a panel offering the order
            book's fields beside it would be a panel that narrows nothing. */}
        {tab !== "article" && (
          <DockedFilters
            model={filters}
            id="allotments"
            subject="Allotment"
            kpis={[
              { label: "Allotments", value: count(rows.length) },
              {
                label: "Short",
                value: count(shortages.length),
                note: "Pools promising more than they hold.",
              },
            ]}
            className="hidden dock:flex"
          />
        )}
      </div>

      <AllotmentSheet id={allotment.value ?? null} onClose={allotment.close} />
    </PageContent>
  )
}

/// What one shop is owed, SKU by SKU.
///
/// The tab used to answer this with four totals and then list the allotment
/// headers — which is the paperwork, not the goods. A shop asking "what is
/// still coming" wants the size run: which colour, which size, how many, and
/// how far along. The server has computed exactly that for the whole lifetime
/// of the store, and the screen was throwing it away.
///
/// Sorted by what is still owed rather than by SKU code: a store's picking
/// question is about the rows that have not arrived, and there can be hundreds
/// that have.
function ByStoreSkus({
  rows,
  store,
  needle,
}: {
  rows: readonly StoreSkuSummary[]
  store: string
  needle: string
}) {
  // The summary answers in SKU codes; a code is not a garment. The catalogue
  // is already in cache for this hub, so the name costs nothing.
  const catalogue = useCatalogueIdentity()
  const wanted = needle.trim().toLowerCase()
  const shown = useMemo(
    () =>
      [...rows]
        .filter((row) => {
          if (wanted === "") return true
          const identity = catalogue.get(row.sku_code)
          return (
            row.sku_code.toLowerCase().includes(wanted) ||
            (identity?.article_name ?? "").toLowerCase().includes(wanted) ||
            (identity?.article_code ?? "").toLowerCase().includes(wanted)
          )
        })
        .sort(
          (left, right) =>
            right.quantity -
              right.received_quantity -
              (left.quantity - left.received_quantity) ||
            left.sku_code.localeCompare(right.sku_code)
        ),
    [rows, catalogue, wanted]
  )

  return (
    <Card className="mb-[1.125rem] overflow-hidden">
      <CardHeader>
        <CardTitle>Owed to {store}, by SKU</CardTitle>
        <span className="text-[0.875rem] text-mute tabular-nums">
          {count(shown.length)} SKUs
        </span>
      </CardHeader>
      <div className="max-h-[26rem] overflow-auto border-t border-hairline px-4 py-3">
        {shown.length === 0 ? (
          <EmptyState>
            Nothing has ever been allotted to this store under that search.
          </EmptyState>
        ) : (
          <MiniTable
            head={[
              "SKU",
              { label: "Ordered", align: "right" },
              "Progress",
              { label: "Still owed", align: "right" },
            ]}
          >
            {shown.map((row) => {
              const identity = catalogue.get(row.sku_code)
              // Ordered less arrived less cancelled. Not `remaining_quantity`,
              // which counts a DC's acceptance rather than the goods.
              const owed = Math.max(
                0,
                row.quantity - row.received_quantity - row.cancelled_quantity
              )
              return (
                <tr key={row.sku_id} className="border-t border-hairline">
                  <td className="py-2 pr-2">
                    <span className="block text-[0.875rem] text-ink">
                      {identity?.article_name ?? row.sku_code}
                    </span>
                    <span className="font-mono text-[0.875rem] text-mute">
                      {row.sku_code}
                      {identity &&
                        ` · ${[identity.colour, identity.size].filter(Boolean).join(" · ")}`}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {count(row.quantity)}
                  </td>
                  <td className="w-[14rem] py-2 pr-2">
                    <Journey
                      total={row.quantity}
                      picked={row.picked_quantity}
                      dispatched={row.dispatched_quantity}
                      received={row.received_quantity}
                      cancelled={row.cancelled_quantity}
                    />
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right tabular-nums",
                      owed > 0 ? "font-medium text-info-fg" : "text-mute"
                    )}
                  >
                    {count(owed)}
                  </td>
                </tr>
              )
            })}
          </MiniTable>
        )}
      </div>
    </Card>
  )
}

/// The book read by garment: where has this article been sent, and how much of
/// it has actually arrived.
///
/// This is the reading merchandising does, and until now the app could not do
/// it at all — allotments were only ever listed as paperwork, and an article's
/// history was spread across however many allotments happened to name it. The
/// rollup is the server's, across every line in the table; the store picker
/// above narrows it to one shop.
function ByArticle({
  query,
  needle,
  store,
}: {
  query: UseQueryResult<ArticleAllotmentList>
  needle: string
  store: string | null
}) {
  const wanted = needle.trim().toLowerCase()
  const rows = useMemo(() => {
    const items = query.data?.items ?? []
    return items
      .filter(
        (item) =>
          wanted === "" ||
          item.article_name.toLowerCase().includes(wanted) ||
          item.article_code.toLowerCase().includes(wanted)
      )
      .slice()
      .sort(
        (left, right) =>
          right.total_quantity -
            right.total_received_quantity -
            (left.total_quantity - left.total_received_quantity) ||
          left.article_name.localeCompare(right.article_name)
      )
  }, [query.data, wanted])

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>
          {store === null ? "Every article ever allotted" : `Sent to ${store}`}
        </CardTitle>
        <span className="text-[0.875rem] text-mute tabular-nums">
          {count(rows.length)} articles
        </span>
      </CardHeader>
      <div className="border-t border-hairline px-4 py-3">
        {queryState(query, {
          loading: "Reading the book by garment…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {store === null
                  ? "Nothing has been allotted out of any pool yet."
                  : "Nothing has ever been sent to this store."}
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Article",
                  { label: "SKUs", align: "right" },
                  { label: "Places", align: "right" },
                  { label: "Ordered", align: "right" },
                  "Progress",
                  { label: "Still owed", align: "right" },
                ]}
              >
                {rows.map((item) => {
                  const owed = Math.max(
                    0,
                    item.total_quantity -
                      item.total_received_quantity -
                      item.total_cancelled_quantity
                  )
                  return (
                    <tr
                      key={item.article_id}
                      className="border-t border-hairline"
                    >
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2.5">
                          <Thumbnail
                            url={item.image_url}
                            className="size-8 shrink-0 rounded-inner"
                          />
                          <div className="min-w-0">
                            <span className="block truncate text-[0.875rem] text-ink">
                              {item.article_name}
                            </span>
                            <span className="font-mono text-[0.875rem] text-mute">
                              {item.article_code}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {count(item.sku_count)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {count(item.destination_count)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {count(item.total_quantity)}
                      </td>
                      <td className="w-[14rem] py-2 pr-2">
                        <Journey
                          total={item.total_quantity}
                          picked={item.total_picked_quantity}
                          dispatched={item.total_dispatched_quantity}
                          received={item.total_received_quantity}
                          cancelled={item.total_cancelled_quantity}
                        />
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums",
                          owed > 0 ? "font-medium text-info-fg" : "text-mute"
                        )}
                      >
                        {count(owed)}
                      </td>
                    </tr>
                  )
                })}
              </MiniTable>
            ),
        })}
      </div>
    </Card>
  )
}

function AllotmentSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const actor = useActor()
  const [reason, setReason] = useState("")
  const [line, setLine] = useState("")
  const [pickQuantity, setPickQuantity] = useState("1")

  const detail = useQuery({
    queryKey: inventoryKeys.allotment(id ?? ""),
    queryFn: ({ signal }) => allotmentDetail(id!, signal),
    enabled: id !== null,
  })

  // Both writes change the same two things: this record, and every list that
  // sums it. The list keys carry the filters, so the whole `allotments` prefix
  // goes — a cancelled allotment leaves one filtered list and joins another.
  const invalidate = () => {
    client.invalidateQueries({ queryKey: inventoryKeys.allotments() })
    client.invalidateQueries({ queryKey: inventoryKeys.fleet() })
  }

  const cancel = useMutation({
    mutationFn: () =>
      cancelAllotment(id!, {
        reason,
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: invalidate,
  })

  const execute = useMutation({
    mutationFn: () =>
      executeAllotment(id!, {
        allotment_line_id: line,
        quantity: Number(pickQuantity),
        actor_id: actor,
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: invalidate,
  })

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "allotment", id }}
      onOpenChange={(open) => !open && onClose()}
      title={detail.data?.allotment_number ?? "Allotment"}
    >
      {queryState(detail, {
        loading: "Opening the allotment…",
        render: (record) => {
          const owned = record.activation_target_origin_id !== null
          const reached = STAGES.findIndex((stage) => record[stage.key] === 0)
          const events: TimelineEvent[] = record.events.map((event) => ({
            id: event.id,
            title: humanise(event.event_type),
            detail: `${event.actor_id} · ${count(event.quantity)} pieces · reserve ${event.remaining_delta >= 0 ? "+" : ""}${event.remaining_delta}`,
            at: moment(event.occurred_at),
            state: "done",
          }))

          return (
            <div className="flex flex-col gap-5">
              <Lifecycle
                steps={STAGES.map((stage, index) => ({
                  label: stage.label,
                  state:
                    record[stage.key] > 0
                      ? "done"
                      : index === (reached === -1 ? STAGES.length : reached)
                        ? "current"
                        : "todo",
                }))}
              />

              <div className="flex flex-wrap gap-1.5">
                <Pill tone={toneFor(record.status)}>
                  {humanise(record.status)}
                </Pill>
                {owned && (
                  <Pill tone="info">
                    {record.edge_application_status === "ACCEPTED"
                      ? "Accepted by the DC"
                      : record.edge_application_status === "REJECTED"
                        ? "Refused by the DC"
                        : "Waiting on the DC"}
                  </Pill>
                )}
                {!record.received_projection_consistent && (
                  <Pill tone="bad">Receipt evidence disagrees</Pill>
                )}
              </div>

              <Facts>
                <Fact term="Raised by">{record.created_by}</Fact>
                <Fact term="Raised">{moment(record.created_at)}</Fact>
                <Fact term="Notes">{record.notes ?? "—"}</Fact>
              </Facts>

              {record.cancellation && (
                <Banner
                  tone={
                    record.cancellation.outcome === "APPLIED"
                      ? "ok"
                      : record.cancellation.outcome === null
                        ? "info"
                        : "warn"
                  }
                >
                  {record.cancellation.outcome === null
                    ? `Cancellation of ${count(record.cancellation.requested_quantity)} requested by ${record.cancellation.requested_by}; the DC has not answered. Nothing is released until it does.`
                    : `${humanise(record.cancellation.outcome)} — ${count(record.cancellation.cancelled_quantity ?? 0)} released, ${count(record.cancellation.blocked_picked_quantity ?? 0)} already picked and blocked.`}
                </Banner>
              )}

              <section>
                <h4 className="mb-2 text-card-title font-semibold text-ink">
                  Lines
                </h4>
                <MiniTable
                  head={[
                    "SKU",
                    { label: "Qty", align: "right" },
                    "Progress",
                    { label: "Still owed", align: "right" },
                  ]}
                >
                  {record.lines.map((item) => (
                    <tr key={item.id} className="border-t border-hairline">
                      <td className="py-2 pr-2">
                        <span className="block text-[0.875rem] text-ink">
                          {item.article_name}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {item.sku_code}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {count(item.quantity)}
                      </td>
                      <td className="w-[13rem] py-2 pr-2">
                        <Journey
                          total={item.quantity}
                          picked={item.picked_quantity}
                          dispatched={item.dispatched_quantity}
                          received={item.received_quantity}
                          cancelled={item.cancelled_quantity}
                        />
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {count(
                          Math.max(
                            0,
                            item.quantity -
                              item.received_quantity -
                              item.cancelled_quantity
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </MiniTable>

                <TotalsLadder
                  className="mt-3"
                  rows={[
                    { label: "Ordered", value: count(record.total_quantity) },
                    {
                      label: "Received",
                      value: count(record.total_received_quantity),
                    },
                    {
                      label: "Cancelled",
                      value: count(record.total_cancelled_quantity),
                    },
                  ]}
                  total={{
                    label: "Still owed",
                    value: count(
                      Math.max(
                        0,
                        record.total_quantity -
                          record.total_received_quantity -
                          record.total_cancelled_quantity
                      )
                    ),
                  }}
                />
              </section>

              {record.movements.length > 0 && (
                <section>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    Ledger movements
                  </h4>
                  <MiniTable head={["Route", "Cause", "Qty"]}>
                    {record.movements.map((movement) => (
                      <tr
                        key={movement.movement_id}
                        className="border-t border-hairline"
                      >
                        <td className="py-2 pr-2 font-mono text-[0.875rem] text-body">
                          <AppLink
                            to="/inventory/pools"
                            sheet={{
                              key: "pool",
                              value: movement.from.replace(/:.*$/, ""),
                            }}
                            className="hover:text-ink"
                          >
                            {movement.from}
                          </AppLink>{" "}
                          →{" "}
                          <AppLink
                            to="/inventory/pools"
                            sheet={{
                              key: "pool",
                              value: movement.to.replace(/:.*$/, ""),
                            }}
                            className="hover:text-ink"
                          >
                            {movement.to}
                          </AppLink>
                        </td>
                        <td className="py-2 text-right">
                          <Tag>{movement.cause}</Tag>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {count(movement.quantity)}
                        </td>
                      </tr>
                    ))}
                  </MiniTable>
                </section>
              )}

              {events.length > 0 && (
                <section>
                  <h4 className="mb-2 text-card-title font-semibold text-ink">
                    History
                  </h4>
                  <Timeline events={events} />
                </section>
              )}

              <section className="border-t border-hairline pt-4">
                {(cancel.isError || execute.isError) && (
                  <Banner tone="bad" className="mb-3">
                    {(cancel.error ?? execute.error) instanceof Error
                      ? ((cancel.error ?? execute.error) as Error).message
                      : "The server refused the request."}
                  </Banner>
                )}

                {owned ? null : (
                  <div className="mb-4 flex flex-col gap-3">
                    <Field
                      label="Pick against a line"
                      hint="Partial picks are expected; press again until nothing remains."
                    >
                      <Choice
                        value={line}
                        onChange={setLine}
                        options={record.lines.map((item) => ({
                          value: item.id,
                          label: `${item.sku_code} · ${count(item.remaining_allotted)} left`,
                        }))}
                        placeholder="Choose a line"
                        className="h-9 w-full max-w-none"
                      />
                    </Field>
                    <Field label="Quantity">
                      <Input
                        type="number"
                        min={1}
                        value={pickQuantity}
                        onChange={(event) =>
                          setPickQuantity(event.target.value)
                        }
                      />
                    </Field>
                    <Button
                      variant="soft"
                      disabled={
                        line === "" ||
                        actor === "" ||
                        Number(pickQuantity) <= 0 ||
                        execute.isPending
                      }
                      onClick={() => execute.mutate()}
                    >
                      {execute.isPending ? "Picking…" : "Pick"}
                    </Button>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Field
                    label="Cancel what is still reserved"
                  >
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Why it is being released"
                    />
                  </Field>
                  <Button
                    variant="danger"
                    disabled={
                      reason.trim() === "" || actor === "" || cancel.isPending
                    }
                    onClick={() => cancel.mutate()}
                  >
                    {cancel.isPending ? "Asking…" : "Cancel allotment"}
                  </Button>
                </div>
              </section>
            </div>
          )
        },
      })}
    </Sheet>
  )
}
