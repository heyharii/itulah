import { Card } from "@/components/ui/card"
import { Status } from "@/components/ui/pill"
import { ago, dayTime } from "@/lib/format"
import {
  useFleetStatusOf,
  type FleetColour,
  type FleetComponent,
  type FleetDayBar,
  type FleetIncident,
  type FleetStatusOf,
} from "@/lib/queries/fleet"
import type { StoreSummary } from "@/lib/queries/stores"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { FleetDot, uptimeWord } from "@/screens/system/fleet-shared"

/// One status page per store: the colour of the whole store is its worst
/// component, every component has ninety days of bars (grey for the days
/// before it was installed), and sync is said as what is waiting in each
/// direction and when the store last spoke — never a percentage.
///
/// It reads the same `GET /fleet/status/{unit}` the System › Store servers ›
/// Health rows open into (`screens/system/fleet-health.tsx`), so the two can
/// never disagree; this is the one store drawn full width instead of
/// folded under a row. A line the data does not carry is left out, not
/// invented.
export function StatusTab({ store }: { store: StoreSummary }) {
  const state = store.server.state
  const running = state === "ONLINE" || state === "OFFLINE"
  const status = useFleetStatusOf(store.unit_id, running)

  if (!running) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <Card className="p-[1.125rem] text-mute">
          Starts once the server is Ready.
        </Card>
      </div>
    )
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {queryState(status, {
        loading: "Reading the store’s status…",
        render: (page) => <StatusPage page={page} />,
      })}
    </div>
  )
}

/// Components a store owner reads; the version string and head office's own
/// parts are not the shop's to watch here.
const SHOWN: ReadonlySet<FleetComponent["kind"]> = new Set([
  "SERVER",
  "SYNC",
  "DEVICE",
  "DESK_READER",
  "BACKUP",
  "POWER",
  "DISK",
])

const KIND_ORDER: Readonly<Record<string, number>> = {
  SERVER: 0,
  SYNC: 1,
  DEVICE: 2,
  DESK_READER: 3,
  BACKUP: 4,
  POWER: 5,
  DISK: 6,
}

/// Tills first among the devices, then the printer, then the rest.
const DEVICE_ORDER: Readonly<Record<string, number>> = { TILL: 0, PRINTER: 1 }

function orderOf(component: FleetComponent): number {
  const kind = KIND_ORDER[component.kind] ?? 9
  const device =
    component.kind === "DEVICE" ? (DEVICE_ORDER[component.device_kind ?? ""] ?? 2) : 0
  return kind * 10 + device
}

const WORD: Readonly<Record<FleetColour, string>> = {
  green: "text-ok-fg",
  yellow: "text-warn-fg",
  red: "text-bad-fg",
  grey: "text-body",
}

function StatusPage({ page }: { page: FleetStatusOf }) {
  const { row, sync, incidents } = page
  const components = row.components
    .filter((component) => SHOWN.has(component.kind))
    .sort((a, b) => orderOf(a) - orderOf(b))

  const heard = sync?.last_heard_at ?? row.last_heard_at
  const dataUpTo = sync?.up.data_up_to ?? null
  const title =
    row.colour === "green"
      ? "All components normal"
      : row.colour === "grey"
        ? "Waiting for the first report"
        : "Needs attention"
  const sub = [
    row.colour === "yellow" || row.colour === "red" ? row.headline : null,
    dataUpTo ? `Data up to ${dayTime(dataUpTo)}` : null,
    `checked ${ago(page.generated_at)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ")

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <FleetDot colour={row.colour} className="size-3" />
          <span className="min-w-0 flex-1">
            <b className="block font-medium text-ink">{title}</b>
            <span className="block text-meta text-mute">{sub}</span>
          </span>
        </div>
        <div className="grid gap-x-6 gap-y-3.5 border-t border-hairline p-4 sm:grid-cols-3">
          {sync && sync.up.waiting !== null && (
            <Figure term="Store → HO">{sync.up.waiting} waiting</Figure>
          )}
          {sync && (
            <Figure term="HO → store">{sync.down.pending} pending</Figure>
          )}
          {heard && <Figure term="Last heartbeat">{ago(heard)}</Figure>}
        </div>
      </Card>

      {components.length > 0 && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-hairline">
            {components.map((component) => (
              <li key={component.component} className="px-4 py-3">
                <ComponentLine component={component} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-hairline px-4 pt-3.5 pb-2.5">
          <h4 className="text-card-title font-semibold text-ink">Incidents</h4>
          <span className="text-[0.9375rem] text-mute">last 30 days</span>
        </div>
        {incidents.length === 0 ? (
          <p className="px-4 py-3.5 text-mute">None in the last 30 days</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {incidents.map((incident) => (
              <IncidentLine key={incident.incident_id} incident={incident} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function Figure({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.9375rem] text-body">{term}</div>
      <div className="mt-1 text-[0.9375rem] text-ink tabular-nums">
        {children}
      </div>
    </div>
  )
}

const BAR: Readonly<Record<FleetDayBar["colour"], string>> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-bad",
  grey: "bg-hairline-strong",
  none: "bg-soft-2",
}

/// One component: its colour and sentence, then ninety days of bars across
/// the card. A day with no history — before the store was installed — is the
/// pale bar, never green.
function ComponentLine({ component }: { component: FleetComponent }) {
  const days = component.days
  const sinceInstalled = days !== undefined && days[0]?.colour === "none"
  return (
    <>
      <div className="flex items-center gap-2.5">
        <FleetDot colour={component.colour} />
        <b className="min-w-0 flex-1 truncate font-medium text-ink">
          {component.label}
        </b>
        <span
          className={cn(
            "text-right text-[0.9375rem]",
            WORD[component.colour]
          )}
        >
          {component.sentence}
        </span>
      </div>
      {days && days.length > 0 && (
        <>
          <div
            aria-label="Ninety days, oldest to newest"
            className="mt-2.5 grid h-[1.625rem] gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {days.map((bar) => (
              <i
                key={bar.day}
                title={`${bar.day}${bar.uptime_percent === null ? " · no history" : ` · ${uptimeWord(bar.uptime_percent)}`}`}
                className={cn("rounded-[2px]", BAR[bar.colour])}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[0.9375rem] text-mute">
            <span>90 days ago</span>
            {component.uptime_90d !== null && (
              <span>
                {uptimeWord(component.uptime_90d)}
                {sinceInstalled ? " since installed" : ""}
              </span>
            )}
            <span>Today</span>
          </div>
        </>
      )}
    </>
  )
}

const INCIDENT_TONE: Readonly<
  Record<FleetIncident["state"], "bad" | "warn" | "done">
> = { OPEN: "bad", ACKNOWLEDGED: "warn", RESOLVED: "done" }

const INCIDENT_WORD: Readonly<Record<FleetIncident["state"], string>> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
}

/// "3 h 20 min" — how long it lasted, or has lasted so far.
function lasted(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48)
    return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`
  return `${Math.floor(hours / 24)} d`
}

function IncidentLine({ incident }: { incident: FleetIncident }) {
  // The title leads with the store ("C001 Cikupa: …"), which this page is
  // already about.
  const title = incident.title.includes(": ")
    ? incident.title.slice(incident.title.indexOf(": ") + 2)
    : incident.title
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-ink">{title}</span>
        <span className="block text-[0.9375rem] text-mute">
          {dayTime(incident.opened_at)} · lasted {lasted(incident.duration_seconds)}
        </span>
      </span>
      <Status tone={INCIDENT_TONE[incident.state]}>
        {INCIDENT_WORD[incident.state]}
      </Status>
    </li>
  )
}
