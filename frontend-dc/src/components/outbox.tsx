import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { node } from "@/lib/api"
import { keys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { ApiError, Sync, syncHealth } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

const sync = new Sync(node)

/// How often to ask. The sender's own cycle is five seconds, so polling much
/// faster only makes the screen busy without making it more truthful.
const POLL_MS = 5000

const TONE = {
  current: "text-emerald-600 dark:text-emerald-400",
  behind: "text-amber-600 dark:text-amber-400",
  blocked: "text-destructive",
  off: "text-muted-foreground",
} as const

const HEADLINE = {
  current: "Everything here has reached head office",
  behind: "Waiting to be sent",
  blocked: "Not getting through",
  off: "Nothing is being uploaded",
} as const

function when(value: string | null): string {
  if (value === null) {
    return "never"
  }
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000)
  if (seconds < 0) return "in the future"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/// This node's outbox: what has not reached head office yet, and a way to stop
/// waiting for the next cycle.
///
/// Worth a permanent place on the screen rather than a diagnostics page. An
/// Edge is built to keep working when the line is down, which means a site can
/// trade all day with nothing leaving the building and no symptom anybody
/// would notice — the tills ring up, the stock moves, and the backlog grows.
export function Outbox({ className }: { className?: string }) {
  const client = useQueryClient()

  const backlog = useQuery({
    queryKey: keys.syncStatus(),
    queryFn: ({ signal }) => sync.status(signal),
    refetchInterval: POLL_MS,
  })

  const sendNow = useMutation({
    mutationFn: () => sync.trigger(),
    // Asked again either way. A trigger the node declined still changed
    // nothing, and a trigger it accepted has already begun draining.
    onSettled: () =>
      void client.invalidateQueries({ queryKey: keys.syncStatus() }),
  })

  const status = backlog.data ?? null

  /// Whatever stopped this panel telling the truth, in the node's own words.
  ///
  /// Either read can fail, and they fail for the same reasons — the node is
  /// down, or it has no sender — so they are reported in one place.
  const refusal = sendNow.data?.triggered === false ? sendNow.data.reason : null
  const failure = sendNow.error ?? backlog.error
  const problem =
    refusal ??
    (failure === null
      ? null
      : failure instanceof ApiError
        ? failure.message
        : "could not reach this node")

  if (status === null) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Outbox</CardTitle>
          <CardDescription>
            {problem ?? "Reading this node's backlog…"}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const health = syncHealth(status)
  const blockedUntil = status.breaker_open_until

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Outbox</CardTitle>
        <CardDescription className={TONE[health]}>
          {HEADLINE[health]}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-3">
          <span
            className={cn("text-4xl font-semibold tabular-nums", TONE[health])}
          >
            {status.pending_facts}
          </span>
          <span className="text-sm text-muted-foreground">
            {status.pending_facts === 1 ? "record" : "records"} not yet
            acknowledged
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Confirmed through</dt>
          <dd className="tabular-nums">{status.durable_through}</dd>

          <dt className="text-muted-foreground">Last sent</dt>
          <dd>{when(status.last_success_at)}</dd>

          {status.dead_lettered > 0 && (
            <>
              <dt className="text-destructive">Refused</dt>
              {/* These never retry. Somebody has to look at them. */}
              <dd className="text-destructive tabular-nums">
                {status.dead_lettered} — needs a person
              </dd>
            </>
          )}

          {blockedUntil !== null && (
            <>
              <dt className="text-muted-foreground">Retrying</dt>
              <dd>after {when(blockedUntil).replace(" ago", "")}</dd>
            </>
          )}

          {status.origin_id !== null && (
            <>
              <dt className="text-muted-foreground">Stream</dt>
              <dd className="truncate font-mono text-xs">
                {status.origin_id} · gen {status.generation}
              </dd>
            </>
          )}
        </dl>

        {status.last_error !== null && (
          <p className="text-xs text-destructive" role="alert">
            {status.last_error}
            {status.consecutive_failures > 1 &&
              ` (${status.consecutive_failures} attempts)`}
          </p>
        )}

        {problem !== null && (
          <p className="text-xs text-destructive" role="alert">
            {problem}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => sendNow.mutate()}
            disabled={sendNow.isPending || !status.sender_enabled}
          >
            {sendNow.isPending ? "Sending…" : "Send now"}
          </Button>
          {!status.sender_enabled && (
            <span className="text-xs text-muted-foreground">
              No upload address is configured on this node.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
