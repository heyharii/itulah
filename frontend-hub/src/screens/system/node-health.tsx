import { ActivityFold } from "@/components/ui/activity-fold"
import { useInfiniteQuery } from "@tanstack/react-query"

import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Fact, Facts } from "@/components/ui/sheet"
import { Banner, LoadMore } from "@/components/ui/states"
import { ago, moment } from "@/lib/format"
import {
  describeIncident,
  pillTone,
  type Line,
  type PillTone,
} from "@/lib/node-health"
import {
  nodeIncidents,
  systemKeys,
  type FleetNodeHealth,
  type HealthTone,
} from "@/lib/queries/system"
import { queryState } from "@/lib/query-state"
import { Section } from "@/screens/system/shared"

/// A shop server's health, the way head office reads it.
///
/// The words come from the server: `assessment` is the same judgement the
/// shop's own console shows (`backend/src/sync/node_status.rs`), so this file
/// only arranges them. The one thing it writes itself is the incident history,
/// and that follows the console's wording (`backend/src/edge/console.html`).

export function HealthPill({ health }: { health: FleetNodeHealth | null }) {
  if (!health) return <Pill>No heartbeat</Pill>
  return (
    <Pill tone={pillTone(health.assessment.tone)}>
      {health.assessment.label}
    </Pill>
  )
}

const STRIP_FILL: Record<HealthTone, string> = {
  OK: "bg-ok",
  INFO: "bg-info",
  WARN: "bg-warn",
  BAD: "bg-bad",
}

/// The last four hours, fifteen minutes a bar. A gap is a silence, not a
/// green: a node that said nothing said nothing.
export function HealthStrip({
  strip,
}: {
  strip: readonly (HealthTone | null)[]
}) {
  return (
    <span
      className="inline-flex h-4 items-end gap-[2px]"
      aria-label="Health over the last four hours"
    >
      {strip.map((tone, index) => (
        <span
          key={index}
          className={
            tone
              ? `h-4 w-[5px] rounded-[1px] ${STRIP_FILL[tone]}`
              : "h-1.5 w-[5px] rounded-[1px] bg-hairline-2"
          }
        />
      ))}
    </span>
  )
}

const DOT: Record<PillTone, string> = {
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn",
  bad: "bg-bad",
  neutral: "bg-mute",
}

function gb(bytes: number | null): string {
  return bytes === null
    ? "—"
    : `${(bytes / 1073741824).toFixed(1).replace(".", ",")} GB`
}

/// The node's condition, its machine, and what happened to it this week.
export function NodeHealthSection({
  originId,
  health,
}: {
  originId: string
  health: FleetNodeHealth | null
}) {
  const incidents = useInfiniteQuery({
    queryKey: systemKeys.nodeIncidents(originId),
    queryFn: ({ pageParam, signal }) =>
      nodeIncidents(originId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  if (!health) {
    return (
      <Section title="Condition">
        <p className="text-[0.9375rem] text-body">
          This node has not sent a heartbeat. A store server sends one a minute
          once it runs version 0.1 or later with a cloud address.
        </p>
      </Section>
    )
  }
  const { assessment, status } = health
  const tone = pillTone(assessment.tone)
  return (
    <>
      <Section title="Condition">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tone}>{assessment.label}</Pill>
            <HealthStrip strip={health.strip} />
          </div>
          <Banner
            tone={tone === "neutral" ? "info" : tone === "ok" ? "ok" : tone}
          >
            <span>
              <strong className="font-medium">{assessment.headline}.</strong>{" "}
              {assessment.sentence}
            </span>
          </Banner>
          <p className="text-meta text-mute">
            {assessment.since ? `Since ${moment(assessment.since)} · ` : ""}
            Last heard {ago(health.last_heard_at)}
            {assessment.needs === "DEVELOPER" ? " · needs a developer" : ""}
          </p>
        </div>
      </Section>

      {status && (
        <Section title="Machine">
          <Facts>
            <Fact term="Host">{`${status.hostname} · ${status.os}`}</Fact>
            <Fact term="Version">{status.version}</Fact>
            <Fact term="Running since">{moment(status.started_at)}</Fact>
            <Fact term="Disk free">
              {`${gb(status.machine.disk_free_bytes)} of ${gb(status.machine.disk_total_bytes)}`}
            </Fact>
            <Fact term="Memory">
              {`${gb(status.machine.memory_used_bytes)} / ${gb(status.machine.memory_total_bytes)}`}
            </Fact>
            <Fact term="Clock">
              {status.machine.clock_skew_seconds === null
                ? "—"
                : `${status.machine.clock_skew_seconds} s off`}
            </Fact>
            <Fact term="Waiting to send">
              {`${status.sync.pending_facts}${status.sync.oldest_pending_at ? ` · oldest ${ago(status.sync.oldest_pending_at)}` : ""}`}
            </Fact>
            <Fact term="Tills">
              {`${status.devices.terminals_seen_recently} of ${status.devices.terminals_active} seen`}
            </Fact>
            <Fact term="Open drawers">
              {status.till.open_shifts
                ? status.till.open_shift_terminals.join(", ")
                : "None"}
            </Fact>
          </Facts>
        </Section>
      )}

      <ActivityFold>
        {queryState(incidents, {
          loading: "Loading…",
          render: (data) => {
            const lines = data.pages
              .flatMap((page) => page.items)
              .map(describeIncident)
              .filter((line): line is Line => line !== null)
            if (lines.length === 0 && !incidents.hasNextPage)
              return (
                <p className="text-[0.9375rem] text-body">
                  Nothing recorded this week.
                </p>
              )
            return (
              <>
                <MiniTable head={["When", "What Happened"]}>
                  {lines.map((line, index) => (
                    <tr key={index} className="border-t border-hairline">
                      <td className="py-2 pr-3 align-top font-mono text-meta whitespace-nowrap text-mute">
                        {line.when}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2 font-medium text-ink">
                          <span
                            className={`size-[5px] shrink-0 rounded-full ${DOT[line.tone]}`}
                          />
                          {line.what}
                        </div>
                        <div className="mt-1 text-meta text-body">
                          {line.detail}
                        </div>
                      </td>
                    </tr>
                  ))}
                </MiniTable>
                {/* Inside the sheet body, which is the box that scrolls. */}
                <LoadMore query={incidents} />
              </>
            )
          },
        })}
      </ActivityFold>
    </>
  )
}
