import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CloudOff,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Store as StoreIcon,
  Unplug,
  Warehouse,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BarSeries,
  ChartLegend,
  type ChartRow,
  type ChartSeries,
} from "@/components/ui/chart"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { ago, count, day, moment, type Tone } from "@/lib/format"
import { useAppNavigate } from "@/lib/navigate"
import { reconciliation, syncHealth, systemKeys } from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { span } from "@/screens/system/units"
import type {
  CheckTone,
  HealthVerdict,
  LaneStatus,
  SecurityCheck,
  SyncFleetHealth,
  SyncOriginHealth,
} from "@itulah/contract"

/// Is data moving between the centre and every node, both ways, and is
/// anything stuck — and is the whole thing safe to leave running.
///
/// One read, `GET /sync/health`, polled every half minute. The verdict and the
/// per-node word are the server's: the thresholds are its policy and the rule
/// has tests beside it, so this screen draws rather than decides. What it adds
/// is the ORDER — the verdict first, then who needs a person, then the figures,
/// then the two lanes per node — because a page of green numbers tells somebody
/// their day is fine, and this page has to tell them what their day is.
///
/// Two lanes, deliberately, and always both. Commands go down and facts come
/// up, and a node can be perfect on one and dead on the other: a shop applying
/// every price change while its sales never arrive is the failure that costs
/// the most and shows the least. Every row here says both.
///
/// What the centre cannot see is said rather than guessed at: a node's own
/// backlog, its breaker and its last error live in its SQLite and never ride
/// the batch. Silence and lag are inferred from what does arrive.

/// Every thirty seconds. The nodes cycle every five, so a lane that stalled
/// shows here within a minute — and the question this page answers is not one
/// anybody needs to the second.
const REFRESH_MS = 30_000

/// The word for each state, and its tone. `info` is SKY and means in motion —
/// a node catching up is receiving, not failing.
const LANE: Readonly<Record<LaneStatus, { word: string; tone: Tone }>> = {
  HEALTHY: { word: "Flowing", tone: "ok" },
  LAGGING: { word: "Catching up", tone: "info" },
  STALLED: { word: "Stuck", tone: "bad" },
  SILENT: { word: "Silent", tone: "warn" },
  NEVER: { word: "Never spoken", tone: "neutral" },
}

const VERDICT: Readonly<
  Record<HealthVerdict, { word: string; tone: Tone; sentence: string }>
> = {
  HEALTHY: {
    word: "All clear",
    tone: "ok",
    sentence:
      "Every node is talking, nothing is blocked, and no fact was refused today.",
  },
  ATTENTION: {
    word: "Needs attention",
    tone: "warn",
    sentence: "Data is moving, but something below wants a look.",
  },
  STALLED: {
    word: "Stalled",
    tone: "bad",
    sentence: "Something has stopped and will not restart on its own.",
  },
}

const CHECK: Readonly<Record<CheckTone, { word: string; tone: Tone }>> = {
  OK: { word: "OK", tone: "ok" },
  WARN: { word: "Watch", tone: "warn" },
  BAD: { word: "Fix", tone: "bad" },
}

const FILL: Readonly<Record<Tone, string>> = {
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn",
  bad: "bg-bad",
  accent: "bg-accent",
  neutral: "bg-hairline-strong",
}

export function Health() {
  const health = useQuery({
    queryKey: systemKeys.health(),
    queryFn: ({ signal }) => syncHealth(signal),
    refetchInterval: REFRESH_MS,
  })
  // Heavier than the health read — it recomputes every pool the centre has
  // caught up with — so it is asked half as often.
  const positions = useQuery({
    queryKey: systemKeys.reconciliation(),
    queryFn: ({ signal }) => reconciliation(signal),
    refetchInterval: REFRESH_MS * 2,
  })
  const now = useNow()

  return (
    <PageContent>
      <PageHeader
        crumb="System"
        title="Health"
        sub="Whether data is moving between the centre and every node, in both directions, and whether it is safe to leave running."
        actions={
          <>
            <span className="text-[0.75rem] text-mute tabular-nums">
              {health.dataUpdatedAt > 0
                ? `Checked ${sinceMs(now - health.dataUpdatedAt)} · every ${REFRESH_MS / 1000} s`
                : "Checking…"}
            </span>
            <Button
              disabled={health.isFetching}
              onClick={() => {
                void health.refetch()
                void positions.refetch()
              }}
            >
              {health.isFetching ? "Checking…" : "Check now"}
            </Button>
            <AppLink to="/system/sync" variant="quiet">
              Sync console
            </AppLink>
          </>
        }
      />

      {queryState(health, {
        loading: "Asking every lane…",
        render: (data) => (
          <Board
            data={data}
            positions={positions.data ?? null}
            positionsFailed={positions.isError}
          />
        ),
      })}
    </PageContent>
  )
}

function Board({
  data,
  positions,
  positionsFailed,
}: {
  data: SyncFleetHealth
  positions: Awaited<ReturnType<typeof reconciliation>> | null
  positionsFailed: boolean
}) {
  const go = useAppNavigate()

  /// Who needs a person, worst first. Stuck outranks silent outranks never:
  /// the first never clears itself, the second used to work, the third has
  /// not started — and the third is only worth a line when the centre is
  /// actually holding something for it.
  const exceptions = useMemo<Exception[]>(() => {
    const rows: Exception[] = []
    for (const node of data.origins) {
      const open = () => go("/system", { key: "origin", value: node.origin_id })
      const title = node.label ?? node.origin_id
      if (node.status === "STALLED") {
        const stuck = node.command_blocked
        const held = node.apply_blocked
        rows.push({
          id: node.origin_id,
          title,
          detail: stuck
            ? `Command #${count(stuck.seq)}${stuck.command_type ? ` (${stuck.command_type})` : ""} blocked${stuck.since ? ` since ${moment(stuck.since)}` : ""}: ${stuck.reason ?? "no reason given"}${stuck.revoked_at ? " — already revoked, clears on the next cycle" : ""}`
            : held
              ? `Its facts stopped being applied at #${count(held.seq)}${held.since ? ` since ${moment(held.since)}` : ""}: ${held.reason ?? "no reason given"}`
              : "Blocked",
          amount: `${count(node.pending_commands)} waiting`,
          severity: "high",
          icon: <CloudOff className="size-4" />,
          onOpen: open,
        })
      } else if (node.status === "SILENT") {
        rows.push({
          id: node.origin_id,
          title,
          detail: `Last heard ${ago(node.last_contact_at)} — nothing since, in either direction`,
          amount: `${span(node.last_contact_age_seconds)} quiet`,
          severity: "medium",
          icon: <Radio className="size-4" />,
          onOpen: open,
        })
      }
    }
    // The nodes that have never spoken are ONE line, however many there are.
    // Thirteen rows saying "never contacted the centre" is a list, not a
    // queue: the fact is one fact (the fleet is not yet up), and the board
    // below names every node anyway. A single such node is named here.
    const never = data.origins.filter(
      (node) => node.status === "NEVER" && node.pending_commands > 0
    )
    if (never.length === 1) {
      const node = never[0]
      rows.push({
        id: node.origin_id,
        title: node.label ?? node.origin_id,
        detail: `Registered ${day(node.key_created_at)} and has never contacted the centre`,
        amount: `${count(node.pending_commands)} waiting`,
        severity: "low",
        icon: <Unplug className="size-4" />,
        onOpen: () => go("/system", { key: "origin", value: node.origin_id }),
      })
    } else if (never.length > 1) {
      const waiting = never.reduce(
        (sum, node) => sum + node.pending_commands,
        0
      )
      rows.push({
        id: "never",
        title: `${count(never.length)} nodes have never contacted the centre`,
        detail: never.map((node) => node.label ?? node.origin_id).join(" · "),
        amount: `${count(waiting)} waiting`,
        severity: "low",
        icon: <Unplug className="size-4" />,
        onOpen: () => go("/system"),
      })
    }
    const rank = { high: 0, medium: 1, low: 2 }
    return rows.sort((a, b) => rank[a.severity] - rank[b.severity])
  }, [data.origins, go])

  const talking = data.fleet.healthy + data.fleet.lagging

  return (
    <>
      <Verdict data={data} />

      {!data.security.auth_enabled && (
        <Banner tone="bad" className="mb-3">
          Sign-in is switched off on this node: every request is treated as an
          administrator. Fine on a laptop; never on a fleet.
        </Banner>
      )}

      <ExceptionQueue
        title="Nodes needing a person"
        exceptions={exceptions}
        empty="No node is stuck, silent, or waiting to be brought up."
      />

      <KpiStrip>
        <Kpi
          label="Nodes talking"
          value={`${count(talking)} / ${count(data.fleet.origins)}`}
        />
        <Kpi label="Stuck" value={count(data.fleet.stalled)} />
        <Kpi label="Silent" value={count(data.fleet.silent)} />
        <Kpi
          label="Commands waiting"
          value={count(data.downstream.pending_total)}
        />
        <Kpi
          label="Facts refused, 24 h"
          value={count(data.upstream.rejected_24h)}
        />
        <Kpi
          label="Server errors, 24 h"
          value={count(data.security.server_errors_24h)}
        />
      </KpiStrip>

      {/* The board takes the whole width: a node row is a name and two lanes
          with a sentence each, and beside a chart the sentences were the first
          thing to go. The chart and the positions share the row under it. */}
      <Lanes data={data} />

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Throughput data={data} />
        <Positions
          positions={positions}
          failed={positionsFailed}
          upstream={data.upstream}
        />
      </div>

      <Security data={data} className="mt-3" />
    </>
  )
}

/// The one-word answer, with its reasons. A card and not a `<Banner>`: a
/// banner is a fact that sits beside the page, and this IS the page.
function Verdict({ data }: { data: SyncFleetHealth }) {
  const verdict = VERDICT[data.verdict]
  return (
    <Card className="mb-3 overflow-hidden">
      <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                FILL[verdict.tone],
                // Only the healthy dot breathes: it is the one state a person
                // wants to glance at and see is still live.
                verdict.tone === "ok" &&
                  "animate-pulse motion-reduce:animate-none"
              )}
            />
            <h2 className="text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-ink">
              {verdict.word}
            </h2>
          </div>
          <p className="mt-2 text-meta text-body">{verdict.sentence}</p>
          {data.reasons.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {data.reasons.map((reason) => (
                <li
                  key={reason}
                  className="flex items-start gap-2 text-[0.8125rem] text-ink"
                >
                  <span
                    className={cn(
                      "mt-[0.4375rem] size-1.5 shrink-0 rounded-full",
                      FILL[verdict.tone]
                    )}
                  />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[0.75rem] md:min-w-[17rem]">
          <Reading term="Last fact in">
            {ago(data.upstream.last_fact_at)}
          </Reading>
          <Reading term="Last command out">
            {ago(data.downstream.last_issued_at)}
          </Reading>
          <Reading term="Last acknowledgement">
            {ago(data.downstream.last_ack_at)}
          </Reading>
          <Reading term="Centre's sender">
            <Pill tone={data.sync_state === "OK" ? "ok" : "bad"}>
              {data.sync_state === "OK" ? "OK" : "Degraded"}
            </Pill>
          </Reading>
        </dl>
      </div>
    </Card>
  )
}

function Reading({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-mute">{term}</dt>
      <dd className="mt-0.5 truncate text-[0.8125rem] text-ink tabular-nums">
        {children}
      </dd>
    </div>
  )
}

// ---- the two lanes, per node ---------------------------------------------

/// What the down lane (centre → node) is doing, in a tone and five words.
function downLane(node: SyncOriginHealth): { tone: Tone; text: string } {
  if (node.command_blocked)
    return { tone: "bad", text: `stuck at #${count(node.command_blocked.seq)}` }
  if (node.issued_seq === 0)
    return { tone: "neutral", text: "nothing issued yet" }
  if (node.pending_commands === 0)
    return { tone: "ok", text: "everything applied" }
  if (node.acked_at === null)
    return {
      tone: "warn",
      text: `${count(node.pending_commands)} waiting, never acked`,
    }
  return { tone: "info", text: `${count(node.pending_commands)} waiting` }
}

/// What the up lane (node → centre) is doing.
function upLane(
  node: SyncOriginHealth,
  silentAfter: number
): { tone: Tone; text: string } {
  if (node.apply_blocked)
    return { tone: "bad", text: `blocked at #${count(node.apply_blocked.seq)}` }
  if (node.last_received_at === null)
    return { tone: "neutral", text: "never heard from" }
  if (node.apply_lag > 0)
    return {
      tone: "info",
      text: `${count(node.apply_lag)} received, not yet applied`,
    }
  if ((node.last_received_age_seconds ?? 0) >= silentAfter)
    return {
      tone: "warn",
      text: `quiet for ${span(node.last_received_age_seconds)}`,
    }
  return { tone: "ok", text: `heard ${ago(node.last_received_at)}` }
}

/// A lane drawn as a short track with its direction. The fill is the tone;
/// full for a lane that is doing its job, part-way for one that is waiting,
/// empty for one that has never carried anything.
function Lane({
  direction,
  tone,
  text,
}: {
  direction: "down" | "up"
  tone: Tone
  text: string
}) {
  const width =
    tone === "neutral"
      ? "0%"
      : tone === "warn" || tone === "bad"
        ? "40%"
        : "100%"
  const Arrow = direction === "down" ? ArrowRight : ArrowLeft
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="relative h-1 w-14 shrink-0 overflow-hidden rounded-full bg-soft-2">
        <span
          className={cn(
            "absolute inset-y-0 rounded-full",
            direction === "down" ? "left-0" : "right-0",
            FILL[tone],
            // In motion, and only then: a lane still carrying something.
            tone === "info" && "animate-pulse motion-reduce:animate-none"
          )}
          style={{ width }}
        />
      </span>
      <Arrow
        className={cn(
          "size-3.5 shrink-0",
          tone === "neutral" ? "text-faint" : "text-line-ico"
        )}
      />
      <span className="truncate text-[0.75rem] text-body">{text}</span>
    </div>
  )
}

function Lanes({ data }: { data: SyncFleetHealth }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Centre ↔ nodes</CardTitle>
        <span className="text-[0.75rem] text-mute">
          silent after {span(data.silent_after_seconds)}
        </span>
      </CardHeader>
      <div className="grid gap-4 border-t border-hairline p-4 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        <Centre data={data} />
        <div className="min-w-0 overflow-hidden rounded-inner border border-hairline">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 border-b border-hairline bg-soft px-3.5 py-2 text-[0.75rem] font-medium text-body md:grid">
            <span>Node</span>
            <span>Centre → node</span>
            <span>Node → centre</span>
            <span className="w-[6.5rem]">State</span>
          </div>
          {data.origins.length === 0 ? (
            <p className="px-4 py-8 text-center text-meta text-body">
              No node has been registered. Nothing can move until one is.
            </p>
          ) : (
            data.origins.map((node) => (
              <NodeRow
                key={node.origin_id}
                node={node}
                silentAfter={data.silent_after_seconds}
              />
            ))
          )}
        </div>
      </div>
    </Card>
  )
}

/// The centre's own box: it is a sender too, and its breaker belongs in the
/// same picture as the nodes'.
function Centre({ data }: { data: SyncFleetHealth }) {
  const up = data.upstream
  return (
    <div className="flex flex-col gap-3 rounded-inner border border-hairline bg-soft p-3.5">
      <div className="flex items-center gap-2">
        <span className="grid size-[1.875rem] place-items-center rounded-inner bg-canvas text-line-ico shadow-soft">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[0.84375rem] font-medium text-ink">Centre</div>
          <div className="text-[0.6875rem] text-mute">head office</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[0.6875rem] lg:grid-cols-1">
        <Reading term="Sender">
          <Pill tone={data.sync_state === "OK" ? "ok" : "bad"}>
            {data.sync_state === "OK" ? "OK" : "Degraded"}
          </Pill>
        </Reading>
        <Reading term="Breaker">
          {up.own_breaker_open ? "Open" : "Closed"}
        </Reading>
        <Reading term="Own outbox">{count(up.own_backlog)} waiting</Reading>
        <Reading term="Own dead letters">{count(up.own_dead_letters)}</Reading>
        <Reading term="Facts held">{count(up.accepted_total)}</Reading>
        <Reading term="Commands issued">
          {count(data.downstream.commands_total)}
        </Reading>
      </dl>
      {up.own_last_error && (
        <p className="text-[0.6875rem] text-bad-fg">
          Last error: {up.own_last_error}
        </p>
      )}
    </div>
  )
}

function NodeRow({
  node,
  silentAfter,
}: {
  node: SyncOriginHealth
  silentAfter: number
}) {
  const state = LANE[node.status]
  const down = downLane(node)
  const up = upLane(node, silentAfter)
  const Icon = node.node_role === "DC" ? Warehouse : StoreIcon
  return (
    <div className="grid gap-2 border-b border-hairline px-3.5 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "grid size-[1.75rem] shrink-0 place-items-center rounded-inner",
            state.tone === "bad"
              ? "bg-bad-bg text-bad-fg"
              : state.tone === "warn"
                ? "bg-warn-bg text-warn-fg"
                : "bg-soft-2 text-line-ico"
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <AppLink
            to="/system"
            sheet={{ key: "origin", value: node.origin_id }}
            className="block truncate text-[0.84375rem] font-medium text-ink hover:underline"
          >
            {node.label ?? node.origin_id}
          </AppLink>
          <div className="flex items-center gap-1.5 text-[0.6875rem] text-mute">
            {node.site_id && <Tag>{node.site_id}</Tag>}
            <span className="truncate">
              {node.last_contact_at
                ? `spoke ${ago(node.last_contact_at)}`
                : "has never spoken"}
            </span>
          </div>
        </div>
      </div>
      <Lane direction="down" tone={down.tone} text={down.text} />
      <Lane direction="up" tone={up.tone} text={up.text} />
      <div className="md:w-[6.5rem]">
        <Pill tone={state.tone} withDot>
          {state.word}
        </Pill>
      </div>
    </div>
  )
}

// ---- traffic --------------------------------------------------------------

const TRAFFIC: readonly ChartSeries[] = [
  { key: "facts", label: "Facts in", tone: "accent" },
  { key: "commands", label: "Commands issued", tone: "cap" },
]

const hourOf = new Intl.DateTimeFormat("id-ID", { hour: "2-digit" })

function Throughput({ data }: { data: SyncFleetHealth }) {
  const rows = useMemo<ChartRow[]>(
    () =>
      data.hourly.map((hour) => ({
        bucket: hour.bucket,
        facts: hour.facts_accepted,
        commands: hour.commands_issued,
      })),
    [data.hourly]
  )
  const quiet = rows.every((row) => row.facts === 0 && row.commands === 0)
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Last 24 hours</CardTitle>
        <span className="text-[0.75rem] text-mute">per hour</span>
      </CardHeader>
      <div className="border-t border-hairline px-4 pt-3 pb-4">
        <ChartLegend series={TRAFFIC} />
        {quiet ? (
          <p className="py-10 text-center text-meta text-body">
            Nothing moved in either direction in the last day.
          </p>
        ) : (
          <BarSeries
            rows={rows}
            series={TRAFFIC}
            format={(value) => count(value)}
            titleOf={(bucket) => moment(bucket)}
            labelOf={(bucket) => hourOf.format(new Date(bucket))}
            className="h-[11rem]"
          />
        )}
        {/* Issued, not delivered — the schema keeps no delivery time and the
            acknowledgement cursor is overwritten every cycle, so "delivered
            per hour" is a question the database cannot answer yet. Said here
            so the chart is not read as reach. */}
        <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-hairline pt-3 text-[0.6875rem]">
          <Reading term="Facts accepted">
            {count(data.upstream.accepted_24h)}
          </Reading>
          <Reading term="Facts refused">
            {count(data.upstream.rejected_24h)}
          </Reading>
          <Reading term="Commands issued">
            {count(data.downstream.issued_24h)}
          </Reading>
        </dl>
      </div>
    </Card>
  )
}

// ---- security -------------------------------------------------------------

function Security({
  data,
  className,
}: {
  data: SyncFleetHealth
  className?: string
}) {
  const security = data.security
  const failing = security.checks.filter((check) => check.tone !== "OK").length
  const Shield = failing === 0 ? ShieldCheck : ShieldAlert
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield
            className={cn(
              "size-4",
              failing === 0 ? "text-ok-fg" : "text-warn-fg"
            )}
          />
          <CardTitle>Is it safe</CardTitle>
        </div>
        <span className="text-[0.75rem] text-mute tabular-nums">
          {count(security.accounts_active)} accounts ·{" "}
          {count(security.live_sessions)} signed in ·{" "}
          {count(security.requests_24h)} requests today
        </span>
      </CardHeader>
      {/* Two abreast on a wide screen: ten checks in one column is a page,
          and the reader wants them at a glance. Each row keeps its own rule
          so the columns do not need one between them. */}
      <div className="grid border-t border-hairline lg:grid-cols-2 lg:gap-x-6 lg:px-0">
        {security.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </div>
      {security.exposures.length > 0 && (
        <>
          <div className="border-t border-hairline bg-soft px-4 py-2 text-eyebrow font-medium text-body uppercase">
            Known from the code, not measured
          </div>
          <div className="grid lg:grid-cols-2 lg:gap-x-6">
            {security.exposures.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline px-4 py-2.5 text-[0.71875rem] text-mute">
        <AppLink to="/system/account" className="hover:text-ink">
          Accounts
        </AppLink>
        <AppLink to="/system/access" className="hover:text-ink">
          Access at nodes
        </AppLink>
        <AppLink to="/system/activity" className="hover:text-ink">
          Request log
        </AppLink>
      </div>
    </Card>
  )
}

function CheckRow({ check }: { check: SecurityCheck }) {
  const shown = CHECK[check.tone]
  return (
    <div className="flex items-start gap-3 border-b border-hairline px-4 py-2.5">
      <span
        className={cn(
          "mt-[0.4375rem] size-1.5 shrink-0 rounded-full",
          FILL[shown.tone]
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[0.84375rem] font-medium text-ink">
          {check.label}
        </div>
        <div className="text-[0.71875rem] leading-relaxed text-mute">
          {check.detail}
        </div>
      </div>
      {check.count !== null && (
        <span className="shrink-0 pt-px text-[0.84375rem] font-semibold text-ink tabular-nums">
          {count(check.count)}
        </span>
      )}
      <Pill tone={shown.tone} className="shrink-0">
        {shown.word}
      </Pill>
    </div>
  )
}

// ---- positions ------------------------------------------------------------

/// Where the centre's arithmetic and a node's own claim about the same pool
/// disagree — the third failure a sync can have after "stuck" and "silent":
/// everything arrived and it still does not add up.
function Positions({
  positions,
  failed,
  upstream,
}: {
  positions: Awaited<ReturnType<typeof reconciliation>> | null
  failed: boolean
  upstream: SyncFleetHealth["upstream"]
}) {
  const worst = useMemo(
    () =>
      [...(positions?.discrepancies ?? [])]
        .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
        .slice(0, 6),
    [positions]
  )
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Do the numbers agree</CardTitle>
        {positions && (
          <Pill tone={positions.reconciled ? "ok" : "bad"}>
            {positions.reconciled
              ? "Every pool agrees"
              : `${count(positions.discrepancy_count)} pools disagree`}
          </Pill>
        )}
      </CardHeader>
      <div className="border-t border-hairline px-4 py-3">
        <dl className="mb-3 grid grid-cols-3 gap-3 text-[0.6875rem]">
          <Reading term="Checkpoints current">
            {count(upstream.checkpoints_current)}
          </Reading>
          <Reading term="Stale">{count(upstream.checkpoints_stale)}</Reading>
          <Reading term="Missing">
            {count(upstream.checkpoints_missing)}
          </Reading>
        </dl>
        {failed ? (
          <p className="text-meta text-bad">
            The reconciliation could not be read. The lanes above are still what
            the centre sees; this is the one figure missing.
          </p>
        ) : positions === null ? (
          <p className="text-meta text-body">Comparing positions…</p>
        ) : worst.length === 0 ? (
          <p className="text-meta text-body">
            Every node the centre has caught up with agrees with the position
            the centre derived from that node's own facts.
          </p>
        ) : (
          <MiniTable head={["Node", "Pool", "Centre", "Node says", "Gap"]}>
            {worst.map((row) => (
              <tr
                key={`${row.origin_id}:${row.pool_id}`}
                className="border-t border-hairline"
              >
                <td className="py-1.5 pr-2 text-[0.75rem] text-ink">
                  {row.origin_id}
                </td>
                <td className="py-1.5 pr-2">
                  <Tag>{row.pool_id}</Tag>
                </td>
                <td className="py-1.5 text-right text-[0.75rem] tabular-nums">
                  {count(row.computed_on_hand)}
                </td>
                <td className="py-1.5 text-right text-[0.75rem] tabular-nums">
                  {count(row.observed_on_hand)}
                </td>
                <td className="py-1.5 text-right text-[0.75rem] font-medium text-bad-fg tabular-nums">
                  {count(row.difference)}
                </td>
              </tr>
            ))}
          </MiniTable>
        )}
      </div>
      <div className="border-t border-hairline px-4 py-2.5 text-[0.71875rem] text-mute">
        <AppLink to="/system/sync" className="hover:text-ink">
          Reconciliation, dead letters and commands
        </AppLink>
      </div>
    </Card>
  )
}

// ---- time -----------------------------------------------------------------

/// A clock that ticks every ten seconds, so "checked 40 s ago" stays true
/// between refetches without re-rendering the board every second.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function sinceMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s ago`
  return `${Math.round(seconds / 60)} min ago`
}
