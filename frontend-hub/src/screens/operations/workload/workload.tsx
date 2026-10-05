import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRight,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Hourglass,
  Layers,
  LayoutGrid,
  ListTodo,
  PackagePlus,
  Printer,
  Truck,
  type LucideIcon,
} from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { dc } from "@/lib/api"
import { today } from "@/lib/calendar"
import { useEdgeIdentity, useEdgeNodeIdentity } from "@/lib/edge-session"
import { count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { listPurchaseOrders, procurementKeys } from "@/lib/queries/procurement"
import { useFlowCounts } from "@/screens/operations/workload/use-flow-counts"
import { cn } from "@/lib/utils"

/// Same interval as the flow counts (`use-flow-counts.ts`), so the two
/// numbers on one card never come from different minutes.
const POLL_MS = 30_000

/// A white card lifted the way `Card` lifts one, with the bento's own
/// hover: the hairline darkens and the card rises a step, so a whole card
/// reads as pressable without a button inside it.
const CARD =
  "flex min-w-0 flex-col rounded-card border border-hairline bg-canvas shadow-soft transition-[border-color,box-shadow] duration-150 hover:border-hairline-strong hover:shadow-pop"

/// The bento numeral: big, quiet, tabular. A figure this size is the card's
/// subject — the label and the unit stay small beside it.
const NUM =
  "text-[2.5rem] leading-none font-semibold tracking-tight text-ink tabular-nums"

const CARD_TITLE = "text-card-title font-medium text-ink"
const SUB = "mt-2 text-[0.875rem] text-mute"

/// **Workload** — the Operations landing, laid out as the bento the owner
/// picked (ops-workload-bento-prototype.html, "Flow utama"): the four flows
/// across the top row, printing and today's arrivals and the decisions
/// owed underneath, and the quiet links along the bottom.
///
/// Every number is live — read from the DC edge node and the centre by
/// `useFlowCounts` and the two order-book queries here — and every card
/// opens the screen that owns the work. Nothing on this page estimates:
/// where a number cannot be computed honestly yet, the card shows a dash
/// until its query has answered.
export function WorkloadScreen() {
  const flows = useFlowCounts()

  // The DC node only answers somebody signed in to it; the gate wrapping
  // this screen guarantees that, but the queries still wait for it rather
  // than firing as a burst of 401s on the way in.
  const open = useEdgeNodeIdentity().data?.auth === "DISABLED"
  const signedIn = useEdgeIdentity().data != null || open

  // The printing card re-reads the tagging jobs and the receipts the flow
  // counts already polled — same cache keys, so no request is added.
  const jobs = useQuery({
    queryKey: keys.taggingJobs(),
    queryFn: ({ signal }: { signal: AbortSignal }) => dc.taggingJobs(signal),
    refetchInterval: POLL_MS,
    enabled: signedIn,
  })
  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }: { signal: AbortSignal }) => dc.goodsReceipts(signal),
    refetchInterval: POLL_MS,
    enabled: signedIn,
  })

  // Today's arrivals, narrowed by the SERVER (`deliveryFrom`/`deliveryTo`
  // are its parameters), and the active order book for the overdue
  // footnote — the same scoped read Ops Stock and Ops Articles already
  // hold, so the book is fetched once for all three screens.
  const day = today()
  const arrivingScope = {
    statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
    deliveryFrom: day,
    deliveryTo: day,
  }
  const bookScope = { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"] }
  const arriving = useQuery({
    queryKey: procurementKeys.orders(arrivingScope),
    queryFn: ({ signal }) => listPurchaseOrders(arrivingScope, signal),
    refetchInterval: POLL_MS,
    enabled: signedIn,
  })
  const book = useQuery({
    queryKey: procurementKeys.orders(bookScope),
    queryFn: ({ signal }) => listPurchaseOrders(bookScope, signal),
    refetchInterval: POLL_MS,
    enabled: signedIn,
  })

  const { po, outbox, store, rts } = flows
  const ready =
    po && outbox
      ? po.list + po.review + outbox.pick + outbox.pack + outbox.dispatch
      : null
  const waiting = po && rts ? po.review + rts.dispatch + rts.resolution : null

  const tagJobs = jobs.data ?? []
  const tagsPending = tagJobs.reduce((sum, job) => sum + job.total_quantity, 0)
  const tagPoCount = new Set(
    tagJobs.map((job) => job.po_number).filter((one) => one !== null)
  ).size
  // A receipt whose every counted line has been accepted — the delivery
  // note is complete and worth printing. The list only carries receipts
  // still open, so "complete" is read from the lines, not the status.
  const grnReady = (receipts.data ?? []).filter(
    (one) => one.counted_lines > 0 && one.accepted_lines === one.counted_lines
  ).length
  const overdue = (book.data ?? []).filter((row) => row.overdue).length

  return (
    <PageContent>
      <PageHeader
        title="Workload"
        sub="What is waiting across the building, live from the floor and the centre."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FlowCard
          to="/operations/intake"
          name="Receiving"
          unit="active POs"
          total={po ? po.list + po.review + po.received + po.tags : null}
          stages={[
            ["Receive list", po?.list ?? null],
            ["In review", po?.review ?? null],
            ["Received", po?.received ?? null],
            ["Tag list", po?.tags ?? null],
          ]}
        />
        <FlowCard
          to="/operations/board"
          name="Allotment"
          unit="active documents"
          total={
            outbox
              ? outbox.pick +
                outbox.picked +
                outbox.pack +
                outbox.dispatch +
                outbox.received
              : null
          }
          stages={[
            ["Pick list", outbox?.pick ?? null],
            ["Picked", outbox?.picked ?? null],
            ["Pack", outbox?.pack ?? null],
            ["Dispatch", outbox?.dispatch ?? null],
            ["Received", outbox?.received ?? null],
          ]}
        />
        <FlowCard
          to="/operations/board/returns"
          name="Return from store"
          unit="active returns"
          total={
            store
              ? store.transit + store.count + store.review + store.received
              : null
          }
          stages={[
            ["In transit", store?.transit ?? null],
            ["Receive count", store?.count ?? null],
            ["In review", store?.review ?? null],
            ["Received", store?.received ?? null],
          ]}
        />
        <FlowCard
          to="/operations/board/suppliers"
          name="Return PO"
          unit="active returns"
          total={
            rts
              ? rts.list + rts.dispatch + rts.resolution + rts.completed
              : null
          }
          stages={[
            ["Return list", rts?.list ?? null],
            ["Dispatch", rts?.dispatch ?? null],
            ["Resolution", rts?.resolution ?? null],
            ["Completed", rts?.completed ?? null],
          ]}
        />

        <AppLink
          to="/operations/tagging"
          className={cn(CARD, "group p-4 md:col-span-2")}
        >
          <div className="flex items-center justify-between gap-2.5">
            <span className={CARD_TITLE}>Printing</span>
            <ArrowUpRight className="size-4 text-faint transition-colors group-hover:text-ink" />
          </div>
          <div className="mt-auto flex gap-5 pt-4">
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className={NUM}>
                  {jobs.isPending ? "—" : count(tagsPending)}
                </span>
                <span className="text-[0.875rem] text-mute">tags</span>
              </div>
              <p className={SUB}>
                {jobs.isPending ? "—" : `${count(tagPoCount)} POs ready to tag`}
              </p>
            </div>
            <div className="min-w-0 border-l border-hairline pl-5">
              <div className="flex items-baseline gap-1.5">
                <span className={NUM}>
                  {receipts.isPending ? "—" : count(grnReady)}
                </span>
                <span className="text-[0.875rem] text-mute">GRN</span>
              </div>
              <p className={SUB}>receipt notes ready to print</p>
            </div>
          </div>
        </AppLink>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[0.875rem] font-medium text-body">
              Arriving today
            </span>
            <PackagePlus className="size-4 text-mute" />
          </div>
          <div className="mt-auto pt-4">
            <div className="flex items-baseline gap-1.5">
              <span className={NUM}>
                {arriving.isPending ? "—" : count(arriving.data?.length ?? 0)}
              </span>
              <span className="text-[0.875rem] text-mute">POs</span>
            </div>
            <p className={SUB}>
              {book.isPending ? (
                "—"
              ) : (
                <>
                  <span className="font-medium text-body tabular-nums">
                    {count(overdue)}
                  </span>{" "}
                  overdue
                </>
              )}
            </p>
          </div>
        </Card>

        <AppLink to="/operations/intake" className={cn(CARD, "group p-4")}>
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[0.875rem] font-medium text-body">
              Waiting for decision
            </span>
            <Hourglass className="size-4 text-mute" />
          </div>
          <div className="mt-auto pt-4">
            <div className="flex items-baseline gap-1.5">
              <span className={NUM}>
                {waiting === null ? "—" : count(waiting)}
              </span>
              <span className="text-[0.875rem] text-mute">documents</span>
            </div>
            <p className={SUB}>
              {po && rts
                ? `${count(po.review)} to review · ${count(rts.dispatch)} with supplier · ${count(rts.resolution)} partly settled`
                : "—"}
            </p>
          </div>
        </AppLink>

        <Card className="p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[0.875rem] font-medium text-body">
              Ready work
            </span>
            <ListTodo className="size-4 text-mute" />
          </div>
          <div className="mt-auto pt-4">
            <div className="flex items-baseline gap-1.5">
              <span className={NUM}>{ready === null ? "—" : count(ready)}</span>
              <span className="text-[0.875rem] text-mute">Ready now</span>
            </div>
            <p className={SUB}>
              {po && outbox
                ? `${count(po.list)} receive · ${count(po.review)} review · ${count(outbox.pick)} pick · ${count(outbox.pack)} pack · ${count(outbox.dispatch)} dispatch`
                : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[0.875rem] font-medium text-body">More</span>
            <LayoutGrid className="size-4 text-mute" />
          </div>
          <nav
            className="mt-auto flex flex-wrap gap-1.5 pt-3"
            aria-label="Other Operations screens"
          >
            {MORE_LINKS.map(([label, to, Icon]) => (
              <AppLink
                key={to}
                to={to}
                className="inline-flex items-center gap-1.5 rounded-inner bg-soft px-2.5 py-1.5 text-[0.875rem] text-ink transition-colors hover:bg-soft-2"
              >
                <Icon className="size-4 text-mute" />
                {label}
              </AppLink>
            ))}
          </nav>
        </Card>
      </div>

      <p className="mt-3 text-[0.875rem] text-mute">
        Numbers come from the ops boards and the order book — nothing estimated.
      </p>
    </PageContent>
  )
}

/// One flow card: the flow's name, everything it has in motion as one big
/// figure, and how that figure sits across the stages of its board — the
/// prototype's `stages` rows, one row per lane. The whole card opens the
/// board the stages come from.
function FlowCard({
  to,
  name,
  unit,
  total,
  stages,
}: {
  to: string
  name: string
  unit: string
  total: number | null
  stages: readonly (readonly [label: string, value: number | null])[]
}) {
  return (
    <AppLink to={to} className={cn(CARD, "group p-4")}>
      <div className="flex items-center justify-between gap-2.5">
        <span className={CARD_TITLE}>{name}</span>
        <ArrowUpRight className="size-4 text-faint transition-colors group-hover:text-ink" />
      </div>
      <div className="mt-auto flex items-baseline gap-1.5 pt-4">
        <span className={NUM}>{total === null ? "—" : count(total)}</span>
        <span className="text-[0.875rem] text-mute">{unit}</span>
      </div>
      <ul className="mt-3 border-t border-hairline">
        {stages.map(([label, value]) => (
          <li
            key={label}
            className="flex items-baseline justify-between gap-3 border-b border-hairline py-[0.3125rem] text-[0.875rem] text-body last:border-b-0"
          >
            <span>{label}</span>
            <span className="font-medium text-ink tabular-nums">
              {value === null ? "—" : count(value)}
            </span>
          </li>
        ))}
      </ul>
    </AppLink>
  )
}

/// The quiet links along the bottom: the rest of the module, as the sidebar
/// carries it.
const MORE_LINKS: readonly (readonly [
  label: string,
  to: string,
  icon: LucideIcon,
])[] = [
  ["Receiving", "/operations/intake", Truck],
  ["Printing", "/operations/tagging", Printer],
  ["Packing lists", "/operations/packing-lists", ClipboardList],
  ["Stock", "/operations/stock", Layers],
  ["Count", "/operations/count", ClipboardCheck],
  ["Stock ledger", "/operations/ledger", BookOpen],
]
