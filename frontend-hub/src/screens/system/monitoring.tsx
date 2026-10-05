import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  askNode,
  listNodeHealth,
  listUptime,
  nodeDiagnostics,
  systemKeys,
  type FleetNodeHealth,
  type NodeUptime,
  type NodeAction,
  type Outage,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import {
  dayFill,
  hourly,
  overall,
  percent,
  since,
  span,
  stateTone,
  stateWord,
} from "@/lib/uptime"
import { cn } from "@/lib/utils"

/// Every shop server at a glance, the way a status page reads.
///
/// The structure is UptimeRobot's — one line per monitor with its uptime and
/// ninety days of bars, a headline for the fleet, a page per monitor with its
/// current state, its windows and its incidents — because that is the shape
/// people already know how to read. The look is the hub's. The numbers come
/// from the heartbeats the servers send every minute
/// (`cloud/postgres/node_health.rs`); a restart somebody asked for is
/// maintenance and does not count against anyone.

const DOT: Record<string, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
  neutral: "bg-mute",
}

function StatusDot({ tone, large }: { tone: string; large?: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 rounded-full",
        large ? "size-3.5" : "size-2",
        DOT[tone]
      )}
      aria-hidden="true"
    />
  )
}

function DayBars({
  days,
  className,
}: {
  days: NodeUptime["days"]
  className?: string
}) {
  return (
    <span
      className={cn("flex h-6 items-stretch gap-[2px]", className)}
      role="img"
      aria-label="Uptime per day, last 90 days"
    >
      {days.map((day) => (
        <span
          key={day.day}
          title={`${day.day}: ${percent(day.percent)}${day.down_seconds ? ` · down ${span(day.down_seconds)}` : ""}${day.maintenance_seconds ? ` · maintenance ${span(day.maintenance_seconds)}` : ""}`}
          className={cn(
            "min-w-[2px] flex-1 rounded-[1px]",
            dayFill(day.percent)
          )}
        />
      ))}
    </span>
  )
}

function incidents(count: number) {
  return `${count} ${count === 1 ? "incident" : "incidents"}`
}

function name(node: NodeUptime, health: FleetNodeHealth | undefined) {
  return health?.site_name ?? health?.site_id ?? node.origin_id
}

/// Always rendered above `<Nodes>`, inside the "Servers" tab of "Store
/// servers" (`screens/system/servers.tsx`) — never a page of its own, which
/// is why it takes no `embedded` flag the way `Nodes`/`Health`/`SyncLane` do:
/// there is no other place left that calls it.
export function Monitoring() {
  const monitor = useSheet("monitor")
  const uptime = useQuery({
    queryKey: systemKeys.uptime(),
    queryFn: ({ signal }) => listUptime(signal),
    refetchInterval: 30_000,
  })
  const health = useQuery({
    queryKey: systemKeys.nodeHealth(),
    queryFn: ({ signal }) => listNodeHealth(signal),
    refetchInterval: 30_000,
  })
  const byOrigin = useMemo(
    () => new Map((health.data ?? []).map((node) => [node.origin_id, node])),
    [health.data]
  )
  const nodes = useMemo(() => {
    const rank = { DOWN: 0, MAINTENANCE: 1, UNKNOWN: 2, UP: 3 }
    return [...(uptime.data ?? [])].sort(
      (a, b) =>
        rank[a.state] - rank[b.state] || a.origin_id.localeCompare(b.origin_id)
    )
  }, [uptime.data])

  const latest = nodes
    .flatMap((node) => node.outages.filter((o) => o.kind === "DOWN"))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0]
  const summary = overall(nodes)
  const count = (state: NodeUptime["state"]) =>
    nodes.filter((node) => node.state === state).length
  const open = nodes.find((node) => node.origin_id === monitor.value)

  const body = queryState(uptime, {
    loading: "Loading status…",
    render: () =>
      nodes.length === 0 ? (
        <Card>
          <EmptyState>No store servers yet. Install one below.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <StatusDot tone={summary.tone} large />
              <div>
                <h2 className="text-[1.375rem] leading-tight font-semibold text-ink">
                  {summary.headline}
                </h2>
                <p className="mt-1 text-meta text-body">
                  {latest
                    ? `Last incident ${since(latest.start)} ago · ${latest.cause}`
                    : "No incidents recorded yet."}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-4 gap-5 text-center">
              {(
                [
                  ["Total", nodes.length, "text-ink"],
                  ["Up", count("UP"), "text-ok-fg"],
                  ["Down", count("DOWN"), "text-bad-fg"],
                  ["Maint.", count("MAINTENANCE"), "text-info-fg"],
                ] as const
              ).map(([label, value, colour]) => (
                <div key={label}>
                  <dt className="text-meta text-mute">{label}</dt>
                  <dd
                    className={cn(
                      "text-[1.375rem] font-semibold tabular-nums",
                      colour
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="divide-y divide-hairline overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,14rem)_5rem_minmax(0,1fr)_9rem] gap-4 bg-soft px-5 py-2.5 text-meta text-body md:grid">
              <span>Store server</span>
              <span className="text-right">30 days</span>
              <span>Uptime, last 90 days</span>
              <span className="text-right">Status</span>
            </div>
            {nodes.map((node) => {
              const tone = stateTone(node.state)
              const month = node.windows.find((w) => w.days === 30)
              return (
                <button
                  key={node.origin_id}
                  type="button"
                  onClick={() => monitor.open(node.origin_id)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 px-5 py-3.5 text-left transition-colors hover:bg-soft md:grid-cols-[minmax(0,14rem)_5rem_minmax(0,1fr)_9rem]"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <StatusDot tone={tone} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">
                        {name(node, byOrigin.get(node.origin_id))}
                      </span>
                      <span className="block font-mono text-meta text-mute">
                        {node.origin_id}
                      </span>
                    </span>
                  </span>
                  <span className="text-right font-mono text-[0.875rem] text-ink tabular-nums md:order-none">
                    {percent(month?.percent ?? null)}
                  </span>
                  <DayBars
                    days={node.days}
                    className="col-span-2 md:col-span-1"
                  />
                  <span className="col-span-2 text-meta md:col-span-1 md:text-right">
                    <span
                      className={cn(
                        "font-medium",
                        tone === "ok" && "text-ok-fg",
                        tone === "bad" && "text-bad-fg",
                        tone === "info" && "text-info-fg"
                      )}
                    >
                      {stateWord(node.state)}
                    </span>
                    {node.since && (
                      <span className="text-body"> · {since(node.since)}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </Card>
          <p className="text-meta text-mute">
            Checked from a heartbeat every minute. A restart somebody asked for
            counts as maintenance, not downtime.
          </p>
        </div>
      ),
  })

  return (
    <>
      {body}
      <MonitorSheet
        node={open ?? null}
        health={open ? byOrigin.get(open.origin_id) : undefined}
        open={monitor.value !== undefined}
        onClose={monitor.close}
      />
    </>
  )
}

function OutageRows({ outages }: { outages: readonly Outage[] }) {
  if (outages.length === 0)
    return <p className="text-[0.875rem] text-body">No incidents.</p>
  return (
    <ul className="divide-y divide-hairline">
      {outages.slice(0, 30).map((outage) => (
        <li
          key={outage.start + outage.kind}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2.5"
        >
          <Pill tone={outage.kind === "DOWN" ? "bad" : "info"}>
            {outage.kind === "DOWN" ? "Down" : "Maintenance"}
          </Pill>
          <span className="min-w-0">
            <span className="block text-[0.875rem] text-ink">
              {outage.cause}
            </span>
            <span className="block font-mono text-meta text-mute">
              {moment(outage.start)} – {outage.end ? moment(outage.end) : "now"}{" "}
              · {span(outage.seconds)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function MonitorSheet({
  node,
  health,
  open,
  onClose,
}: {
  node: NodeUptime | null
  health: FleetNodeHealth | undefined
  open: boolean
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={node?.origin_id}
      title={node ? name(node, health) : "Server"}
    >
      {!node ? (
        <p className="text-meta text-body">
          This server is no longer registered.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <StatusDot tone={stateTone(node.state)} large />
            <div>
              <div className="text-[1.25rem] font-semibold text-ink">
                {stateWord(node.state)}
              </div>
              <div className="text-meta text-body">
                {node.state === "UP"
                  ? `Up without a break for ${since(node.since)}`
                  : node.state === "DOWN"
                    ? `Unreachable for ${since(node.since)}`
                    : node.state === "MAINTENANCE"
                      ? `Stopped on purpose ${since(node.since)} ago`
                      : "Has not reported in yet"}
              </div>
            </div>
          </div>

          {health && health.assessment.tone !== "OK" && (
            <Banner tone={health.assessment.tone === "BAD" ? "bad" : "warn"}>
              <span>
                <strong className="font-medium">
                  {health.assessment.headline}.
                </strong>{" "}
                {health.assessment.sentence}
              </span>
            </Banner>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="text-meta text-body">Last checked</div>
              <div className="mt-1 text-[1.125rem] font-semibold text-ink">
                {node.last_check ? `${since(node.last_check)} ago` : "—"}
              </div>
              <div className="text-meta text-mute">
                Checked every {node.check_every_seconds} s
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-baseline justify-between text-meta text-body">
                <span>Last 24 hours</span>
                <span className="font-mono">
                  {percent(node.windows[0]?.percent ?? null)}
                </span>
              </div>
              <span className="mt-2 flex h-6 items-stretch gap-[2px]">
                {hourly(node.outages).map((value, index) => (
                  <span
                    key={index}
                    className={cn(
                      "flex-1 rounded-[1px]",
                      dayFill(node.last_check ? value : null)
                    )}
                  />
                ))}
              </span>
              <div className="mt-1.5 text-meta text-mute">
                {incidents(node.windows[0]?.outages ?? 0)} ·{" "}
                {span(node.windows[0]?.down_seconds ?? 0)} down
              </div>
            </Card>
          </div>

          <Card className="grid grid-cols-3 divide-x divide-hairline p-0">
            {node.windows
              .filter((window) => window.days > 1)
              .map((window) => (
                <div key={window.days} className="p-4">
                  <div className="text-meta text-body">
                    Last {window.days} days
                  </div>
                  <div
                    className={cn(
                      "mt-1 font-mono text-[1.125rem] font-semibold",
                      window.percent !== null && window.percent < 99
                        ? "text-warn-fg"
                        : "text-ok-fg"
                    )}
                  >
                    {percent(window.percent)}
                  </div>
                  <div className="text-meta text-mute">
                    {incidents(window.outages)} · {span(window.down_seconds)}
                  </div>
                </div>
              ))}
          </Card>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[0.9375rem] font-semibold text-ink">
                Uptime, last 90 days
              </h3>
            </div>
            <DayBars days={node.days} className="h-8" />
          </div>

          <div>
            <h3 className="mb-1 text-[0.9375rem] font-semibold text-ink">
              Incidents
            </h3>
            <OutageRows outages={node.outages} />
          </div>

          <RemoteActions originId={node.origin_id} />
          <UpdateForm originId={node.origin_id} />
          <Diagnoses originId={node.origin_id} />
        </div>
      )}
    </Sheet>
  )
}

/// Every outage of every server, newest first.
export function Incidents({
  /// Rendered as the "Incidents" tab of "Store servers"
  /// (`screens/system/servers.tsx`) rather than as its own page.
  embedded = false,
}: { embedded?: boolean } = {}) {
  const uptime = useQuery({
    queryKey: systemKeys.uptime(),
    queryFn: ({ signal }) => listUptime(signal),
    refetchInterval: 30_000,
  })
  const monitor = useSheet("monitor")
  const rows = useMemo(
    () =>
      (uptime.data ?? [])
        .flatMap((node) =>
          node.outages.map((outage) => ({ origin: node.origin_id, outage }))
        )
        .sort(
          (a, b) => Date.parse(b.outage.start) - Date.parse(a.outage.start)
        ),
    [uptime.data]
  )
  const body = (
    <Card className="divide-y divide-hairline overflow-hidden">
      {queryState(uptime, {
        loading: "Loading incidents…",
        render: () =>
          rows.length === 0 ? (
            <EmptyState>No incidents recorded yet.</EmptyState>
          ) : (
            rows.slice(0, 200).map(({ origin, outage }) => (
              <button
                key={origin + outage.start + outage.kind}
                type="button"
                onClick={() => monitor.open(origin)}
                className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-5 py-3 text-left hover:bg-soft sm:grid-cols-[6.5rem_8rem_minmax(0,1fr)_auto]"
              >
                <Pill tone={outage.kind === "DOWN" ? "bad" : "info"}>
                  {outage.kind === "DOWN" ? "Down" : "Maintenance"}
                </Pill>
                <span className="font-mono text-[0.875rem] text-ink">
                  {origin}
                </span>
                <span className="text-[0.875rem] text-text">
                  {outage.cause}
                </span>
                <span className="font-mono text-meta text-mute sm:text-right">
                  {moment(outage.start)} · {span(outage.seconds)}
                  {outage.end ? "" : " · ongoing"}
                </span>
              </button>
            ))
          ),
      })}
    </Card>
  )

  if (embedded) return body

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Incidents"
        sub="Every time a store server went down, anywhere, newest first."
      />
      {body}
    </PageContent>
  )
}

const ACTIONS: { action: NodeAction; label: string; done: string }[] = [
  {
    action: "node.diagnose",
    label: "Run diagnostics",
    done: "Requested. The results show up below in a minute or two.",
  },
  {
    action: "node.backup",
    label: "Back up now",
    done: "Requested. The server makes a backup on its next sync.",
  },
  {
    action: "bootstrap",
    label: "Send initial data again",
    done: "Catalogue, prices, users and promotions are on their way again.",
  },
  {
    action: "node.restart",
    label: "Restart server",
    done: "Requested. The server restarts once the cash drawer is closed.",
  },
]

/// What head office can do to a shop server from here. Every button needs a
/// reason: it travels with the instruction and stays in the record of who
/// asked for what.
function RemoteActions({ originId }: { originId: string }) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [force, setForce] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const ask = useMutation({
    mutationFn: (item: (typeof ACTIONS)[number]) =>
      askNode(originId, {
        action: item.action,
        reason: reason.trim(),
        force: item.action === "node.restart" ? force : false,
      }).then(() => item),
    onSuccess: (item) => {
      setDone(
        item.action === "node.restart" && force
          ? "Requested. The server restarts now, without waiting for the cash drawer."
          : item.done
      )
      setReason("")
      void client.invalidateQueries({
        queryKey: systemKeys.nodeDiagnostics(originId),
      })
    },
  })
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[0.9375rem] font-semibold text-ink">
        Remote actions
      </h3>
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-label="Reason"
      />
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((item) => (
          <Button
            key={item.action}
            variant={item.action === "node.restart" ? "danger" : "ghost"}
            disabled={reason.trim() === "" || ask.isPending}
            onClick={() => ask.mutate(item)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <Checkbox
        label="Restart without waiting for the cash drawer to close"
        checked={force}
        onChange={setForce}
      />
      {ask.isError && (
        <Banner tone="bad">Request failed: {String(ask.error)}</Banner>
      )}
      {done && !ask.isError && <Banner tone="ok">{done}</Banner>}
      <p className="text-meta text-mute">
        Reaches the store through the signed command lane on the next sync.
        Expires after an hour if the server cannot be reached.
      </p>
    </div>
  )
}

/// The newest diagnoses the server sent when asked.
function Diagnoses({ originId }: { originId: string }) {
  const diagnoses = useQuery({
    queryKey: systemKeys.nodeDiagnostics(originId),
    queryFn: ({ signal }) => nodeDiagnostics(originId, signal),
    refetchInterval: 20_000,
  })
  const latest = diagnoses.data?.[0]
  if (!latest) return null
  const tone = { OK: "ok", WARN: "warn", FAIL: "bad" } as const
  const word = { OK: "OK", WARN: "Worth a look", FAIL: "Failed" } as const
  return (
    <div>
      <h3 className="mb-1 text-[0.9375rem] font-semibold text-ink">
        Latest diagnostics · {moment(latest.received_at)}
      </h3>
      <ul className="divide-y divide-hairline">
        {latest.report.checks.map((check) => (
          <li
            key={check.name}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2"
          >
            <Pill tone={tone[check.verdict]}>{word[check.verdict]}</Pill>
            <span className="text-[0.875rem] text-text">{check.saying}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// Install a signed build on this one server — the canary before the fleet.
/// Paste what `deploy/release/sign-release.sh sign` prints; the server checks
/// the signature against the key compiled into it, and installs only in its
/// window (default 23:00–05:00) with every drawer closed.
function UpdateForm({ originId }: { originId: string }) {
  const [text, setText] = useState("")
  const [slot, setSlot] = useState("23:00-05:00")
  const [sent, setSent] = useState<string | null>(null)
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text) as Record<string, string>
      return value.version && value.url && value.sha256 && value.signature
        ? value
        : null
    } catch {
      return null
    }
  }, [text])
  const send = useMutation({
    mutationFn: () =>
      askNode(originId, {
        action: "node.update",
        reason: parsed?.reason || `release ${parsed?.version}`,
        version: parsed?.version,
        url: parsed?.url,
        sha256: parsed?.sha256,
        signature: parsed?.signature,
        window: slot,
      }),
    onSuccess: () => {
      setSent(
        `Version ${parsed?.version} sent. The server installs it between ${slot} with every cash drawer closed, and rolls back to the old version on its own if it fails.`
      )
      setText("")
    },
  })
  return (
    <details className="rounded-inner border border-hairline p-3">
      <summary className="cursor-pointer text-[0.9375rem] font-semibold text-ink">
        Install a new version on this server
      </summary>
      <div className="mt-2.5 flex flex-col gap-2.5">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          className="w-full rounded-inner border border-hairline-2 bg-canvas p-2.5 font-mono text-meta text-ink"
          aria-label="Release JSON"
        />
        <Input
          value={slot}
          onChange={(event) => setSlot(event.target.value)}
          aria-label="Install window"
        />
        <Button
          variant="primary"
          disabled={!parsed || send.isPending}
          onClick={() => send.mutate()}
        >
          {parsed
            ? `Send version ${parsed.version}`
            : "Paste the release JSON first"}
        </Button>
        {send.isError && (
          <Banner tone="bad">Refused: {String(send.error)}</Banner>
        )}
        {sent && !send.isError && <Banner tone="ok">{sent}</Banner>}
      </div>
    </details>
  )
}
