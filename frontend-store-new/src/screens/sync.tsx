import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Radio, Send, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RecordCard } from "@/components/ui/card"
import { BigNumber } from "@/components/ui/kpi"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { ActionBar, Screen, Section } from "@/components/ui/screen"
import { Banner } from "@/components/ui/states"
import { Tag as Code } from "@/components/ui/tag"
import { sync } from "@/lib/api"
import { describe } from "@/lib/errors"
import { useGo } from "@/lib/go"
import { unsentCount, useSaleQueue } from "@/lib/sale-queue"
import { useNodeIdentity } from "@/lib/session"
import { syncHealth, type SyncHealth } from "@itulah/contract/client"

const STATUS = ["sync", "status"] as const

/// How often to ask. The sender's own cycle is five seconds, so polling much
/// faster only makes the screen busy without making it more truthful.
const POLL_MS = 5_000

/// Whether today's trade has reached head office.
///
/// There are **two** backlogs on this screen and they are different things, which
/// is why they are shown apart:
///
///   - the node's outbox — facts captured in this shop's SQLite that head
///     office has not acknowledged. That is the number a shop actually cares
///     about: it is what would be lost if the building burned down tonight.
///   - this device's queue — sales rung on this browser that have not reached
///     the node in the next room. Those are not in the node's count at all,
///     because the node has never seen them.
///
/// A screen that showed only the first would say "all sent" while a tablet in
/// somebody's apron held eleven sales.
export function SyncScreen() {
  const go = useGo()
  const client = useQueryClient()
  const where = useNodeIdentity()
  const queue = useSaleQueue()
  const unsent = unsentCount(queue)

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
  const health: SyncHealth | null =
    status === undefined ? null : syncHealth(status)

  // A refusal is not a failure: the request reached the node and the node said
  // no, which is worth reading in the same place as a request that never
  // arrived.
  const refusal =
    send.data === undefined || send.data.triggered
      ? null
      : (send.data.reason ?? "this node has no sender configured")
  const problem =
    backlog.error !== null
      ? describe(backlog.error)
      : send.error !== null
        ? describe(send.error)
        : refusal

  return (
    <>
      <Screen foot="none">
        <div className="py-5">
          <BigNumber
            label="Not yet at head office"
            value={status === undefined ? "…" : status.pending_facts}
            tone={
              health === "blocked" ? "bad" : health === "current" ? "ok" : "ink"
            }
            sub={health === null ? "Reading this node…" : HEADLINE[health]}
          />
        </div>

        {problem !== null && (
          <Banner tone="bad" className="mb-4">
            {problem}
          </Banner>
        )}

        {unsent > 0 && (
          <Banner
            tone="warn"
            className="mb-4"
            action={
              <button
                type="button"
                onClick={() => go("/sell/queue")}
                className="shrink-0 underline underline-offset-2"
              >
                Open
              </button>
            }
          >
            {unsent === 1 ? "One sale is" : `${unsent} sales are`} still on this
            device and have not reached the counter's node — so they are not in
            the count above either.
          </Banner>
        )}

        {status !== undefined && (
          <Section title="This node's outbox">
            <RecordCard
              icon={<Radio />}
              id={where.data?.site_id ?? where.data?.node_id ?? "This node"}
              status={
                health === null ? undefined : (
                  <Pill tone={TONE[health]}>{WORD[health]}</Pill>
                )
              }
            >
              <div className="px-3 pt-1 pb-3">
                <KeyValue term="Confirmed through">
                  {status.durable_through}
                </KeyValue>
                <KeyValue term="Last sent">
                  {ago(status.last_success_at)}
                </KeyValue>
                {status.dead_lettered > 0 && (
                  <KeyValue term="Refused by head office" tone="bad">
                    {/* These never retry. Somebody has to look at them. */}
                    {status.dead_lettered} — needs a person
                  </KeyValue>
                )}
                {status.breaker_open_until !== null && (
                  <KeyValue term="Retrying in">
                    {ago(status.breaker_open_until).replace(" ago", "")}
                  </KeyValue>
                )}
                {status.consecutive_failures > 0 && (
                  <KeyValue term="Failures in a row" tone="bad">
                    {status.consecutive_failures}
                  </KeyValue>
                )}
                {status.interval_seconds !== null && (
                  <KeyValue term="Sends every">
                    {status.interval_seconds}s
                  </KeyValue>
                )}
              </div>
              {status.origin_id !== null && (
                <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2.5">
                  <Code>{status.origin_id}</Code>
                  <span className="text-meta text-mute">
                    generation {status.generation}
                  </span>
                </div>
              )}
            </RecordCard>

            {status.last_error !== null && (
              <Banner tone="bad" className="mt-3">
                {status.last_error}
              </Banner>
            )}

            {!status.sender_enabled && (
              <Banner tone="warn" className="mt-3">
                No upload address is configured on this node. Everything it
                records is still captured and still durable — but nothing is
                being sent anywhere, and nobody at head office can see today.
              </Banner>
            )}
          </Section>
        )}
      </Screen>

      <ActionBar>
        <div className="flex gap-2.5">
          {unsent > 0 && (
            <Button size="lg" onClick={() => go("/sell/queue")}>
              <Upload />
              {unsent}
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            block
            disabled={send.isPending || status?.sender_enabled !== true}
            onClick={() => send.mutate()}
          >
            <Send />
            {send.isPending ? "Sending…" : "Send now"}
          </Button>
        </div>
        {/* Said plainly rather than hidden behind a disabled button: asking for
            a send during a cooldown would only hide the outage. */}
        {status?.breaker_open_until !== null && status !== undefined && (
          <p className="mt-2 text-center text-meta text-mute">
            Sending now does not shorten a cooldown. The sender is waiting on
            purpose.
          </p>
        )}
      </ActionBar>
    </>
  )
}

const HEADLINE: Record<SyncHealth, string> = {
  current: "Everything this shop has recorded has reached head office.",
  behind: "Waiting to be sent. This is ordinary and clears itself.",
  blocked: "Not getting through. Somebody needs to look at this.",
  off: "Nothing is being uploaded from this node.",
}

const TONE = {
  current: "ok",
  behind: "warn",
  blocked: "bad",
  off: "neutral",
} as const

const WORD = {
  current: "Up to date",
  behind: "Sending",
  blocked: "Stuck",
  off: "Off",
} as const

function ago(value: string | null): string {
  if (value === null) return "never"
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000)
  if (seconds < 0) return "in the future"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
