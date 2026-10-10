import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Send } from "lucide-react"

import { useSite } from "@/components/shell/sidebar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Screen } from "@/components/ui/screen"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, ErrorState, LoadingState } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { sync } from "@/lib/api"
import { describe } from "@/lib/errors"
import { count } from "@/lib/format"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { useNodeIdentity } from "@/lib/session"
import type { EdgeSyncStatus } from "@itulah/contract"
import {
  syncHealth,
  type NodeIdentity,
  type SyncHealth,
} from "@itulah/contract/client"

const STATUS = ["sync", "status"] as const

/// How often to ask. The sender's own cycle is five seconds, so polling much
/// faster only makes the screen busy without making it more truthful.
const POLL_MS = 5_000

/// Whether today's trade has reached head office.
///
/// Drawn as the hub's Node › Sync (`frontend-hub/src/screens/operations/node/
/// sync.tsx`) — the same endpoint answered by a different kind of node — so
/// somebody who has read the warehouse's outbox can read the shop's: the
/// verdict in a sentence, the four figures that decide it, then the sender and
/// the node side by side.
///
/// There are **two** backlogs a shop can have and they are different things,
/// which is why they are shown apart:
///
///   - the node's outbox — facts captured in this shop's SQLite that head
///     office has not acknowledged. That is the number a shop actually cares
///     about: it is what would be lost if the building burned down tonight.
///   - this browser's queue — sales rung here before the counter screens moved
///     to the POS app, which have not reached the node yet. Those are not in
///     the node's count at all, because the node has never seen them. The
///     queue still drains on its own (`lib/sale-queue.ts`); the line about it
///     is information, not a task, so it links nowhere.
export function SyncScreen() {
  const client = useQueryClient()
  const where = useNodeIdentity()
  const unsent = unsentCount(useSaleQueue())

  const backlog = useQuery({
    queryKey: STATUS,
    queryFn: ({ signal }) => sync.status(signal),
    refetchInterval: POLL_MS,
  })

  const send = useMutation({
    mutationFn: () => sync.trigger(),
    // Whether the sender ran or refused to, the backlog on screen was read
    // before it happened.
    onSettled: () => client.invalidateQueries({ queryKey: STATUS }),
  })

  const status = backlog.data

  // A refusal is not a failure: the request reached the node and the node said
  // no, which is worth reading in the same place as a request that never
  // arrived — but in the colour of "not done", not "broken".
  const refusal =
    send.data === undefined || send.data.triggered
      ? null
      : (send.data.reason ?? "this node has no sender configured")
  // A failed poll is said beside the last answer rather than instead of it:
  // this screen re-asks every five seconds, and one lost request should not
  // blank the figures somebody is reading.
  const failure =
    backlog.error !== null
      ? describe(backlog.error)
      : send.error !== null
        ? describe(send.error)
        : null

  const sendNow = () => send.mutate()
  const cannotSend = send.isPending || status?.sender_enabled !== true

  return (
    <Screen
      actions={
        <Button variant="primary" disabled={cannotSend} onClick={sendNow}>
          <Send />
          {send.isPending ? "Sending…" : "Send now"}
        </Button>
      }
    >
      {/* The screen's one act, on a phone, is the dock's wide button — where
          the thumb is, not at the top of the page. */}
      <Fab
        label={send.isPending ? "Sending…" : "Send now"}
        icon={Send}
        disabled={cannotSend}
        onClick={sendNow}
      />

      {failure !== null && (
        <Banner tone="bad" className="mb-4">
          {failure}
        </Banner>
      )}
      {refusal !== null && (
        <Banner tone="warn" className="mb-4">
          Nothing was sent: {refusal}.
        </Banner>
      )}

      {status === undefined ? (
        backlog.isError ? (
          <Card>
            <ErrorState
              error={backlog.error}
              onRetry={() => void backlog.refetch()}
            />
          </Card>
        ) : (
          <LoadingState>Reading the sync status…</LoadingState>
        )
      ) : (
        <Outbox
          status={status}
          health={syncHealth(status)}
          unsent={unsent}
          node={where.data ?? null}
        />
      )}
    </Screen>
  )
}

/// Everything the node said about its outbox, once there is an answer.
function Outbox({
  status,
  health,
  unsent,
  node,
}: {
  status: EdgeSyncStatus
  health: SyncHealth
  unsent: number
  node: NodeIdentity | null
}) {
  const site = useSite()
  const shape = HEALTH[health]
  const cooling = status.breaker_open_until !== null

  return (
    <>
      {/* The verdict first, in a sentence, in the colour of the work it
          means: `blocked` needs a person, `behind` clears itself, `off`
          means nothing is going anywhere at all. */}
      <Banner tone={shape.tone} className="mb-4">
        {shape.says}
      </Banner>

      {unsent > 0 && (
        <Banner tone="warn" className="mb-4">
          {unsent === 1 ? "1 sale" : `${count(unsent)} sales`} waiting in this
          browser. They send once the server answers.
        </Banner>
      )}

      {/* Four across from a tablet up: the strip's default three would leave
          the fourth figure alone on a second row. */}
      <StatStrip className="md:grid-cols-4">
        <Stat
          label="Not yet at head office"
          value={count(status.pending_facts)}
          sub="Held only in this shop"
          tone={
            health === "blocked"
              ? "bad"
              : health === "current"
                ? "ok"
                : undefined
          }
        />
        <Stat
          label="Confirmed through"
          value={count(status.durable_through)}
          sub="Head office has these"
        />
        <Stat
          label="Rejected by head office"
          value={count(status.dead_lettered)}
          // These never retry. Somebody has to look at them.
          sub={status.dead_lettered > 0 ? "Needs a person" : "Nothing rejected"}
          tone={status.dead_lettered > 0 ? "bad" : undefined}
        />
        <Stat
          label="Last sent"
          value={ago(status.last_success_at)}
          sub={
            status.consecutive_failures > 0
              ? `${count(status.consecutive_failures)} failures in a row`
              : "No failures"
          }
          tone={status.consecutive_failures > 0 ? "bad" : undefined}
        />
      </StatStrip>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHead title="The sender">
            <Pill tone={shape.tone}>{shape.word}</Pill>
          </CardHead>
          <div className="px-4 pt-1 pb-3">
            <KeyValue term="Origin">
              {status.origin_id === null ? (
                "not set"
              ) : (
                <span className="font-mono text-id">{status.origin_id}</span>
              )}
            </KeyValue>
            <KeyValue term="Generation">{count(status.generation)}</KeyValue>
            {/* Truncated rather than wrapped: an address is read by its host,
                and a URL broken over three lines reads as three facts. */}
            <KeyValue
              term="Uploading to"
              className="[&>span:first-child]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
            >
              {status.upload_url ?? "nowhere"}
            </KeyValue>
            <KeyValue term="Sends every">
              {status.interval_seconds === null
                ? "—"
                : `${count(status.interval_seconds)} s`}
            </KeyValue>
            <KeyValue term="Cooldown">
              {status.breaker_open_until === null
                ? "Not in cooldown"
                : `Retrying ${until(status.breaker_open_until)}`}
            </KeyValue>
            <KeyValue
              term="Failures in a row"
              tone={status.consecutive_failures > 0 ? "bad" : "normal"}
            >
              {count(status.consecutive_failures)}
            </KeyValue>
          </div>

          {/* Said plainly rather than hidden behind a disabled button: asking
              for a send during a cooldown would only hide the outage. */}
          {cooling && (
            <Banner tone="warn" className="mx-4 mb-3.5">
              Cooling down. Sending now won't skip the wait.
            </Banner>
          )}
          {!status.sender_enabled && (
            <Banner tone="warn" className="mx-4 mb-3.5">
              No upload address set. Nothing is sent to head office.
            </Banner>
          )}
        </Card>

        <Card>
          <CardHead title="This node">
            {node !== null && <Tag>{node.node_role}</Tag>}
          </CardHead>
          <div className="px-4 pt-1 pb-3">
            <KeyValue term="Node">
              <span className="font-mono text-id">{node?.node_id ?? "—"}</span>
            </KeyValue>
            <KeyValue term="Shop">{node === null ? "—" : site}</KeyValue>
            <KeyValue term="Sign-in">
              {node === null ? (
                "—"
              ) : node.auth === "DISABLED" ? (
                <span className="text-warn-fg">Switched off</span>
              ) : (
                "On"
              )}
            </KeyValue>
          </div>
          {node?.local_operations !== undefined &&
            node.local_operations.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline px-4 py-3">
                <span className="mr-1 text-meta text-mute">Runs here</span>
                {node.local_operations.map((operation) => (
                  <Tag key={operation}>{operation}</Tag>
                ))}
              </div>
            )}
        </Card>
      </div>

      {status.last_error !== null && (
        <Banner tone="bad" className="mt-4">
          <b className="font-medium">
            Last failure
            {status.last_error_at !== null && ` ${ago(status.last_error_at)}`}:
          </b>{" "}
          {status.last_error}
        </Banner>
      )}
    </>
  )
}

/// The hub's card header: the card's name at the left, what it IS at the
/// right. Local rather than a kit component — two cards on one screen, and
/// the store kit's `Card` has no header yet.
function CardHead({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2.5 px-4 pt-3.5 pb-1">
      <h2 className="text-[0.9375rem] font-medium text-ink">{title}</h2>
      {children}
    </div>
  )
}

/// The verdict, in the pill vocabulary and in a shop's words.
const HEALTH: Readonly<
  Record<
    SyncHealth,
    { tone: "ok" | "warn" | "bad" | "info"; word: string; says: string }
  >
> = {
  current: {
    tone: "ok",
    word: "Up to date",
    says: "Everything has reached head office.",
  },
  behind: {
    tone: "info",
    word: "Sending",
    says: "Sending. Clears on its own.",
  },
  blocked: {
    tone: "bad",
    word: "Stuck",
    says: "Not getting through. Needs a look.",
  },
  off: {
    tone: "warn",
    word: "Off",
    says: "Nothing is being sent.",
  },
}

function ago(value: string | null): string {
  if (value === null) return "never"
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000)
  if (Number.isNaN(seconds)) return "—"
  if (seconds < 0) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/// How long until a moment still to come — the cooldown's end.
function until(value: string): string {
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000)
  if (Number.isNaN(seconds)) return "later"
  if (seconds <= 0) return "now"
  if (seconds < 60) return `in ${seconds}s`
  if (seconds < 3600) return `in ${Math.ceil(seconds / 60)}m`
  return `in ${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`
}
