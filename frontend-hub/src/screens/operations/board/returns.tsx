import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

import { useShopName } from "@/components/operations/outbound-papers"
import { PageContent } from "@/components/shell/app-shell"
import { DockTools } from "@/components/shell/dock-tools"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Input } from "@/components/ui/field"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { SubTabs } from "@/components/ui/sub-tabs"
import { EmptyState } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { count, day, dayMonth, quantity } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { allotmentListQuery, type AllotmentRow } from "@/lib/queries/inventory"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { cn } from "@/lib/utils"
import { STAMP } from "@/screens/procurement/shared"
import { DeliverySheet } from "@/screens/operations/intake/receive-return-sheet"
import { NewReturnSheet } from "@/screens/operations/board/new-return"
import { Fab } from "@/components/ui/fab"
import { ROOMY } from "@/screens/operations/roomy"
import type { ReturnToInspect, StoreInboundDelivery } from "@itulah/contract"

/// Same interval as the outbound board's lanes, so the two boards' badges
/// never disagree for longer than one poll.
const POLL_MS = 30_000

/// **Return Store** — every store's return, one row per return, laid out as
/// the PO list is (owner, 20 Oct 2026: "kayak po list aja", no kanban, no
/// grouping by store). A return has one store and one way to go, so it has
/// one status, not a pipeline:
///
///   **To pick** (MD asked, the store has not sent it) → **In transit** (on
///   the lorry, blind: koli only) → **Review count** (counted here — every
///   count is reviewed, a matching one too, owner 20 Oct 2026) → Completed.
///
/// Review count is the blue button in the Status column, as a PO's Review
/// Count is, and those rows stand first. It opens the delivery's sheet: the
/// comparison and the inspection that puts the pieces back in stock.
type Stage = "pick" | "transit" | "review" | "done" | "cancelled"

interface ReturnRow {
  readonly key: string
  readonly stage: Stage
  readonly siteId: string
  /// The surat jalan once the store sent it, the ALT before.
  readonly doc: string
  readonly articles: number | null
  readonly at: string | null
  /// What the store sent (or was asked to send), as words — "8 pcs", "2 koli".
  readonly sent: string
  readonly sentPieces: number
  readonly received: number | null
  readonly off: boolean
  readonly finishedAt: string | null
  /// The delivery its sheet opens, once there is one.
  readonly deliveryId: string | null
}

const RANK: Record<Stage, number> = {
  review: 0,
  transit: 1,
  pick: 2,
  done: 3,
  cancelled: 4,
}

const TABS = [
  { value: "active", label: "Active" },
  { value: "done", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const
type Tab = (typeof TABS)[number]["value"]

const tabOf = (stage: Stage): Tab =>
  stage === "done" ? "done" : stage === "cancelled" ? "cancelled" : "active"

/// A return MD made that the store has not sent yet: nothing dispatched.
const notSent = (row: AllotmentRow) =>
  row.total_dispatched_quantity === 0 &&
  row.total_in_transit_quantity === 0 &&
  row.total_received_quantity === 0

function rowsOf(
  deliveries: readonly StoreInboundDelivery[],
  inspections: readonly ReturnToInspect[],
  returns: readonly AllotmentRow[]
): ReturnRow[] {
  const inspection = new Map(inspections.map((one) => [one.delivery_id, one]))
  const fromAllotments = returns.flatMap((one): ReturnRow[] => {
    const cancelled = one.status === "CANCELLED" || one.status === "REJECTED"
    if (!cancelled && !notSent(one)) return []
    if (!cancelled && (one.status === "COMPLETED" || one.status === "DC_COMPLETED"))
      return []
    return [
      {
        key: `alt~${one.id}`,
        stage: cancelled ? "cancelled" : "pick",
        siteId: one.source_site_ids?.[0] ?? "",
        doc: one.allotment_number,
        articles: one.article_count,
        at: one.created_at,
        sent: quantity(one.total_quantity),
        sentPieces: one.total_quantity,
        received: null,
        off: false,
        finishedAt: one.cancelled_at ?? null,
        deliveryId: null,
      },
    ]
  })
  const fromDeliveries = deliveries.map((one): ReturnRow => {
    const pool = inspection.get(one.delivery_id)
    const result = one.result
    const stage: Stage =
      one.status === "IN_TRANSIT"
        ? "transit"
        : pool !== undefined && pool.waiting_units === 0 && pool.inspected_units > 0
          ? "done"
          : "review"
    return {
      key: `inb~${one.delivery_id}`,
      stage,
      siteId: one.source_site_id,
      doc: one.shipment_reference ?? one.delivery_id,
      articles: null,
      at: one.departed_at,
      sent:
        result === null
          ? `${count(one.koli_count)} koli`
          : quantity(result.expected_units),
      sentPieces: result?.expected_units ?? 0,
      received: result?.received_units ?? null,
      off:
        result !== null && (result.missing_units > 0 || result.extra_units > 0),
      finishedAt: one.received_at,
      deliveryId: one.delivery_id,
    }
  })
  return [...fromAllotments, ...fromDeliveries]
}

/// The Status column: a word, the Review count button, or the stamp.
function StatusCell({ row }: { row: ReturnRow }) {
  const delivery = useSheet("inbound")
  if (row.stage === "review")
    return (
      <Button
        variant="primary"
        size="card"
        onClick={(event) => {
          event.stopPropagation()
          if (row.deliveryId !== null) delivery.open(row.deliveryId)
        }}
      >
        Review count
      </Button>
    )
  if (row.stage === "done")
    return (
      <span className={cn(STAMP, row.off ? "text-warn-fg" : "text-ok-fg")}>
        {row.off ? "Accepted" : "Completed"}
        {row.finishedAt !== null && (
          <span className="block tabular-nums">{dayMonth(row.finishedAt)}</span>
        )}
      </span>
    )
  if (row.stage === "cancelled") return <span className="text-mute">Cancelled</span>
  return (
    <span className={row.stage === "transit" ? "text-info-fg" : "text-ok-fg"}>
      {row.stage === "transit" ? "In transit" : "To pick"}
    </span>
  )
}

function StoreName({ id }: { id: string }) {
  const shop = useShopName()
  return (
    <span className="block truncate font-medium text-ink">
      {shop(id) || id || "—"}
    </span>
  )
}

const columns: ColumnDef<TableSetup, ReturnRow>[] = [
  {
    id: "return",
    accessorFn: (row) => row.doc,
    header: "Return",
    size: 340,
    meta: { card: "title", grow: 340 },
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5 py-1 leading-5">
        <StoreName id={row.original.siteId} />
        <span className="truncate text-mute">
          <span className="font-mono text-id">{row.original.doc}</span>
          {row.original.articles !== null &&
            ` · ${count(row.original.articles)} ${row.original.articles === 1 ? "article" : "articles"}`}
        </span>
      </span>
    ),
  },
  {
    id: "at",
    accessorFn: (row) => row.at ?? "",
    header: "Sent on",
    size: 140,
    meta: { card: "hide" },
    cell: ({ row }) => (row.original.at === null ? "—" : day(row.original.at)),
  },
  {
    id: "sent",
    accessorFn: (row) => row.sentPieces,
    header: "Sent",
    size: 120,
    meta: { align: "right", card: "foot" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.sent}</span>,
  },
  {
    id: "received",
    accessorFn: (row) => row.received ?? -1,
    header: "Received",
    size: 120,
    meta: { align: "right", card: "hide" },
    cell: ({ row }) =>
      row.original.received === null ? (
        <span className="text-mute">—</span>
      ) : (
        <span className={cn("tabular-nums", row.original.off && "text-warn-fg")}>
          {quantity(row.original.received)}
        </span>
      ),
  },
  {
    id: "status",
    accessorFn: (row) => RANK[row.stage],
    header: "Status",
    size: 200,
    meta: { align: "right", card: "status" },
    cell: ({ row }) => <StatusCell row={row.original} />,
  },
]

export function StoreReturnsBoard() {
  const delivery = useSheet("inbound")
  const shop = useShopName()
  const [tab, setTab] = useState<Tab>("active")
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState("")
  const needle = typed.trim().toLowerCase()

  const deliveries = useQuery({
    queryKey: keys.storeInbound("ALL"),
    queryFn: ({ signal }) => dc.storeInboundList("ALL", signal),
    refetchInterval: POLL_MS,
  })
  const inspections = useQuery({
    queryKey: keys.returnInspections(),
    queryFn: ({ signal }) => dc.returnInspections(signal),
    refetchInterval: POLL_MS,
  })
  const returns = useQuery({
    ...allotmentListQuery("RETURN_TO_DC", ""),
    refetchInterval: POLL_MS,
  })

  const all = useMemo(
    () =>
      rowsOf(
        deliveries.data ?? [],
        inspections.data ?? [],
        returns.data?.items ?? []
      ),
    [deliveries.data, inspections.data, returns.data]
  )
  const inTab = (which: Tab) => all.filter((row) => tabOf(row.stage) === which)
  const rows = useMemo(
    () =>
      all
        .filter((row) => tabOf(row.stage) === tab)
        .filter(
          (row) =>
            needle === "" ||
            row.doc.toLowerCase().includes(needle) ||
            (shop(row.siteId) || row.siteId).toLowerCase().includes(needle)
        )
        // A count waiting for review stands first, as on the PO list; then
        // what is on the lorry, then what the store has still to pick.
        .sort(
          (a, b) =>
            RANK[a.stage] - RANK[b.stage] ||
            (b.at ?? "").localeCompare(a.at ?? "")
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, tab, needle]
  )

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: ReturnRow) => row.key,
      }),
      [rows]
    )
  )

  const open = all.filter((row) => tabOf(row.stage) === "active")
  return (
    <PageContent>
      <PageHeader
        title="Return Store"
        actions={
          <span className="max-md:hidden">
            <Button variant="primary" onClick={() => setAsking(true)}>
              New return
            </Button>
          </span>
        }
      />
      {/* A phone's is the dock's round plus, as on every list. */}
      <Fab label="New return" onClick={() => setAsking(true)} />
      {/* On a phone the tabs and the search are the dock's, as on every list. */}
      <DockTools
        search={{ value: typed, onChange: setTyped, label: "Search returns or stores" }}
        status={{
          value: tab,
          options: TABS.map((one) => ({
            value: one.value,
            label: one.label,
            count: inTab(one.value).length,
          })),
          onChange: (next) => setTab(next as Tab),
        }}
      />
      <KpiStrip className="grid-cols-2 md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="Returns" value={count(all.length)} />
        <Kpi label="Still open" value={count(open.length)} />
        <Kpi
          label="Review count"
          value={count(all.filter((row) => row.stage === "review").length)}
        />
        <Kpi
          label="In transit"
          value={`${count(
            (deliveries.data ?? [])
              .filter((one) => one.status === "IN_TRANSIT")
              .reduce((sum, one) => sum + one.koli_count, 0)
          )} koli`}
        />
      </KpiStrip>
      <SubTabs
        className="max-md:hidden"
        value={tab}
        onChange={(next) => setTab(next as Tab)}
        tabs={TABS.map((one) => ({
          value: one.value,
          label: (
            <span>
              {one.label}
              <span className="ml-1.5 text-body tabular-nums">
                {count(inTab(one.value).length)}
              </span>
            </span>
          ),
        }))}
      />
      <div className="relative mb-3.5 w-80 max-md:hidden">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute"
        />
        <Input
          type="search"
          aria-label="Search returns or stores"
          placeholder="Search returns or stores"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(deliveries, {
          loading: "Reading the returns…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {needle !== ""
                  ? "No returns match."
                  : tab === "done"
                    ? "Nothing completed yet."
                    : tab === "cancelled"
                      ? "Nothing cancelled."
                      : "Nothing coming back."}
              </EmptyState>
            ) : (
              <DataTable<ReturnRow>
                refresh={[deliveries, inspections, returns]}
                table={table}
                touch
                onRowClick={(row) => {
                  if (row.deliveryId !== null) delivery.open(row.deliveryId)
                }}
                isSelected={(row) => row.deliveryId === delivery.value}
                pageScroll
                cardSort={false}
                cardsApart
                className={ROOMY}
              />
            ),
        })}
      </Card>

      <DeliverySheet id={delivery.value ?? null} onClose={delivery.close} />
      <NewReturnSheet open={asking} onClose={() => setAsking(false)} />
    </PageContent>
  )
}
