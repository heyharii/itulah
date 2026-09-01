import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { node } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { EdgeSyncStatus } from "@itulah/contract"
import { ApiError, Sync, syncHealth } from "@itulah/contract/client"

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
  const [status, setStatus] = useState<EdgeSyncStatus | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setStatus(await sync.status(signal))
      setProblem(null)
    } catch (error) {
      if (signal?.aborted) return
      setProblem(
        error instanceof ApiError ? error.message : "could not reach this node",
      )
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = setInterval(() => void refresh(controller.signal), POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [refresh])

  const sendNow = useCallback(async () => {
    setSending(true)
    try {
      const answer = await sync.trigger()
      if (!answer.triggered) {
        setProblem(answer.reason ?? "this node has no sender")
      }
      await refresh()
    } catch (error) {
      setProblem(
        error instanceof ApiError ? error.message : "could not reach this node",
      )
    } finally {
      setSending(false)
    }
  }, [refresh])

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
          <span className="text-muted-foreground text-sm">
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
          <p className="text-destructive text-xs" role="alert">
            {status.last_error}
            {status.consecutive_failures > 1 &&
              ` (${status.consecutive_failures} attempts)`}
          </p>
        )}

        {problem !== null && (
          <p className="text-destructive text-xs" role="alert">
            {problem}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => void sendNow()}
            disabled={sending || !status.sender_enabled}
          >
            {sending ? "Sending…" : "Send now"}
          </Button>
          {!status.sender_enabled && (
            <span className="text-muted-foreground text-xs">
              No upload address is configured on this node.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
