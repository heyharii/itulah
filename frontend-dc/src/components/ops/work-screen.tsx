import { Link } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"

import { Note, ScreenBody, ScreenHeader } from "@/components/shell"
import { Panel } from "@/components/ops/parts"
import { units } from "@/lib/format"
import { useOperationCounts } from "@/lib/queries"
import { useSession } from "@/lib/session"

/// The home screen is a queue, not a dashboard.
///
/// Every DC role in this building starts the same way: what is waiting for me
/// right now. A dashboard answers "how are we doing", which is a question for
/// the centre — it has the whole estate's numbers and the time to read them.
/// This answers "what do I pick up next", and it is the only screen that has
/// to be right at the start of a shift.
export function WorkScreen() {
  const counts = useOperationCounts()
  const { identity, node } = useSession()

  const queues = [
    {
      to: "/receiving",
      title: "Receiving",
      waiting: counts.receipts + counts.awaitingVerification,
      unit: "on the bay",
      detail:
        counts.awaitingVerification > 0
          ? `${counts.receipts} deliveries open · ${counts.awaitingVerification} counts waiting for a second person`
          : `${counts.receipts} deliveries open`,
    },
    {
      to: "/tagging",
      title: "Tagging",
      waiting: counts.tagging,
      unit: "jobs",
      detail: "Labels sent from head office, not yet confirmed as attached",
    },
    {
      to: "/picking",
      title: "Picking",
      waiting: counts.picklistLines,
      unit: "SKUs",
      detail: `${units(counts.picklistUnits)} pieces still owed to stores`,
    },
    {
      to: "/packing",
      title: "Packing",
      waiting: counts.unsealedKoli,
      unit: "open boxes",
      detail: "A box is where a destination is finally chosen",
    },
    {
      to: "/shipping",
      title: "Shipping",
      waiting: counts.loose + counts.unshipped,
      unit: "to gather",
      detail: `${counts.loose} sealed boxes loose · ${counts.unshipped} consignments without a truck · ${counts.onYard} trucks on the yard`,
    },
    {
      to: "/stock",
      title: "Stock",
      waiting: counts.missing,
      unit: "missing",
      detail: "Where everything is, and the ledger that says how it got there",
    },
    {
      to: "/counts",
      title: "Official counts",
      waiting: counts.openCounts,
      unit: "to execute",
      detail: "Authored at the centre, counted here",
    },
  ]

  return (
    <>
      <ScreenHeader
        title="Work"
        subtitle={
          node === null
            ? identity.display_name
            : `${node.node_id}${node.site_id === undefined ? "" : ` · ${node.site_id}`} · ${identity.display_name}`
        }
      />
      <ScreenBody>
        <Panel title="Needs doing" meta="this node">
          {queues.map((queue) => (
            <Link
              key={queue.to}
              to={queue.to}
              className="flex min-h-(--tap) items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-accent/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{queue.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {queue.detail}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-lg leading-tight font-medium tabular-nums">
                  {units(queue.waiting)}
                </span>
                <span className="block text-[10.5px] text-muted-foreground">
                  {queue.unit}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </Panel>

        <Note>
          <strong className="font-medium text-foreground">
            Nobody authors these lists.
          </strong>{" "}
          The picklist is recomputed on every read from allotments that have
          come down from head office; the receiving queue is what this DC still
          owes a supplier delivery against. What a person decides is the
          allotment and the order — at the centre — not the queue, here.
        </Note>

        <Note>
          This node keeps working with the line down. What it has written and
          not yet sent is in the{" "}
          <Link to="/outbox" className="underline">
            outbox
          </Link>{" "}
          — worth a glance at the end of a shift, because a warehouse that
          traded all day with nothing leaving the building looks exactly like
          one with nothing to send.
        </Note>
      </ScreenBody>
    </>
  )
}
