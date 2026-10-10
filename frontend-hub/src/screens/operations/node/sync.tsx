import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { KeyValue } from "@/components/ui/rows"
import { Banner, Problem } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { edgeSync as sync } from "@/lib/api"
import { ago, clock, count } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { useLayout } from "@/lib/layout"
import { syncHealth, type SyncHealth } from "@itulah/contract/client"

/// The outbox: has today's work actually reached head office?
///
/// An edge node runs whether or not anything can reach the centre — capture is
/// local and durable, and the sender drains on its own cadence. Nobody
/// standing on a bay can see that, and until this endpoint existed a sender
/// that had been failing for hours looked exactly like one with nothing to
/// send. So it is said here in plain words rather than left to be inferred
/// from a screen that looks the same either way.
///
/// The three tones follow the status grammar and mean different work:
/// `blocked` needs a person, `behind` clears itself, `off` means the sender
/// was never configured and nothing is going anywhere at all.
const HEALTH: Readonly<
  Record<SyncHealth, { tone: "ok" | "warn" | "bad" | "info"; says: string }>
> = {
  current: {
    tone: "ok",
    says: "Everything this node has recorded has been acknowledged by the centre.",
  },
  behind: {
    tone: "info",
    says: "There is a backlog and the sender is working through it. This is ordinary and clears itself.",
  },
  blocked: {
    tone: "bad",
    says: "The sender is stuck. Facts the centre refused do not retry — they need a person.",
  },
  off: {
    tone: "warn",
    says: "No sender is configured. Capture still runs and the backlog is still durable, but nothing is being uploaded anywhere.",
  },
}

/// How often the outbox re-asks. Faster than the queue polls, because this is
/// the number somebody stares at while deciding whether to call the office.
const POLL_MS = 10_000

export function Sync() {
  const client = useQueryClient()
  const where = useEdgeNodeIdentity()
  const phone = useLayout() === "phone"

  const status = useQuery({
    queryKey: keys.syncStatus(),
    queryFn: ({ signal }) => sync.status(signal),
    refetchInterval: POLL_MS,
  })

  const send = useMutation({
    mutationFn: () => sync.trigger(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.syncStatus() })
    },
  })

  const health = status.data ? syncHealth(status.data) : null

  return (
    <PageContent>
      <PageHeader
        crumb="Node"
        title="Sync"
        sub="What this warehouse has recorded, and whether the centre has it."
        actions={
          phone ? undefined : (
            <Button
              variant="primary"
              pending={send.isPending}
              onClick={() => send.mutate()}
            >
              <RefreshCw />
              {send.isPending ? "Asking…" : "Send now"}
            </Button>
          )
        }
      />
      {/* On a phone Send now is the button in the dock. */}
      <Fab
        label={send.isPending ? "Asking…" : "Send now"}
        icon={RefreshCw}
        onClick={() => {
          if (!send.isPending) send.mutate()
        }}
      />

      {send.isSuccess && send.data && !send.data.triggered && (
        <Banner tone="warn" className="mb-[1.125rem]">
          Nothing was sent. {send.data.reason ?? "This node has no sender."} A
          button that appeared to force a send during an outage would only hide
          the outage.
        </Banner>
      )}
      <Problem error={send.error} className="mb-[1.125rem]" />

      {queryState(status, {
        loading: "Asking the outbox…",
        render: (state) => {
          const shape = HEALTH[health ?? "off"]
          return (
            <>
              <Banner tone={shape.tone} className="mb-[1.125rem]">
                {shape.says}
              </Banner>

              <KpiStrip className="grid-cols-2 xl:grid-cols-4">
                <Kpi
                  label="Waiting to send"
                  value={count(state.pending_facts)}
                  delta="what would be lost tonight"
                  tone={state.pending_facts > 0 ? "down" : "flat"}
                />
                <Kpi
                  label="Confirmed durable"
                  value={count(state.durable_through)}
                  delta="the centre has these"
                />
                <Kpi
                  label="Refused"
                  value={count(state.dead_lettered)}
                  delta={
                    state.dead_lettered > 0
                      ? "these need a person"
                      : "nothing rejected"
                  }
                  tone={state.dead_lettered > 0 ? "down" : "flat"}
                />
                <Kpi
                  label="Last success"
                  value={ago(state.last_success_at)}
                  delta={
                    state.consecutive_failures > 0
                      ? `${count(state.consecutive_failures)} failures since`
                      : "no failures"
                  }
                  tone={state.consecutive_failures > 0 ? "down" : "flat"}
                />
              </KpiStrip>

              <div className="grid gap-[1.125rem] xl:grid-cols-2 xl:items-start">
                <Card className="overflow-hidden">
                  <CardHeader>
                    <CardTitle>The sender</CardTitle>
                    <Pill tone={shape.tone}>{health ?? "off"}</Pill>
                  </CardHeader>
                  <div className="px-4 pt-1 pb-3.5">
                    <KeyValue term="Origin">
                      {state.origin_id ?? "not set"}
                    </KeyValue>
                    <KeyValue term="Generation">
                      {count(state.generation)}
                    </KeyValue>
                    <KeyValue term="Uploading to">
                      {state.upload_url ?? "nowhere"}
                    </KeyValue>
                    <KeyValue term="Every">
                      {state.interval_seconds === null
                        ? "—"
                        : `${count(state.interval_seconds)} s`}
                    </KeyValue>
                    <KeyValue term="Cooldown until">
                      {state.breaker_open_until === null
                        ? "not in cooldown"
                        : clock(state.breaker_open_until)}
                    </KeyValue>
                  </div>
                  {state.breaker_open_until !== null && (
                    <Banner tone="warn" className="mx-4 mb-3.5">
                      Retries are suspended until then, and this survives a
                      restart — it is stored, not held in memory. "Send now"
                      does not shorten it.
                    </Banner>
                  )}
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader>
                    <CardTitle>This node</CardTitle>
                    {where.data && <Tag>{where.data.node_role}</Tag>}
                  </CardHeader>
                  <div className="px-4 pt-1 pb-3.5">
                    <KeyValue term="Node">
                      {where.data?.node_id ?? "—"}
                    </KeyValue>
                    <KeyValue term="Site">
                      {where.data?.site_id ?? "—"}
                    </KeyValue>
                    <KeyValue term="Sign-in">
                      {where.data?.auth === "DISABLED" ? (
                        <span className="text-warn-fg">DISABLED</span>
                      ) : (
                        "enabled"
                      )}
                    </KeyValue>
                    <KeyValue term="Operations">
                      {count(where.data?.local_operations?.length ?? 0)}
                    </KeyValue>
                  </div>
                  {where.data?.local_operations &&
                    where.data.local_operations.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 border-t border-hairline px-4 py-3">
                        {where.data.local_operations.map((operation) => (
                          <Tag key={operation}>{operation}</Tag>
                        ))}
                      </div>
                    )}
                </Card>
              </div>

              {state.last_error !== null && (
                <Banner tone="bad" className="mt-[1.125rem]">
                  <b className="font-medium">
                    Last failure {ago(state.last_error_at)}:
                  </b>{" "}
                  {state.last_error}
                </Banner>
              )}
            </>
          )
        },
      })}
    </PageContent>
  )
}
