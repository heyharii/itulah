import { AppLink } from "@/components/ui/app-link"
import type { Tone } from "@/lib/format"
import { ago, percent } from "@/lib/format"
import {
  useFleetStatusOf,
  type FleetColour,
  type FleetDayBar,
} from "@/lib/queries/fleet"
import { cn } from "@/lib/utils"

/// Words, tones and the day-bar strip shared by the Health, Sync and
/// Incidents tabs of "Store servers" (`servers.tsx`) — one place so a store's
/// row, its component rows and its detail sheet never draw the same colour
/// two different ways.

export const FLEET_PILL_TONE: Readonly<Record<FleetColour, Tone>> = {
  green: "ok",
  yellow: "warn",
  red: "bad",
  grey: "neutral",
}

export const FLEET_BANNER_TONE: Readonly<
  Record<FleetColour, "ok" | "warn" | "bad" | "info">
> = {
  green: "ok",
  yellow: "warn",
  red: "bad",
  grey: "info",
}

const DOT_FILL: Readonly<Record<FleetColour, string>> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-bad",
  grey: "bg-mute",
}

/// A small dot in the row's colour — the mock's own status dot.
export function FleetDot({
  colour,
  className,
}: {
  colour: FleetColour
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[8px] shrink-0 rounded-full",
        DOT_FILL[colour],
        className
      )}
    />
  )
}

const BAR_FILL: Readonly<Record<FleetColour | "none", string>> = {
  green: "bg-ok",
  yellow: "bg-warn",
  red: "bg-bad",
  grey: "bg-hairline-strong",
  none: "bg-hairline-2",
}

/// Ninety days, oldest first, at the size UptimeRobot draws its own strip —
/// a tick per day, no axis, because nothing here is meant to be read off to
/// the second: the sentence beside it already says the one thing that
/// matters today.
export function FleetDayBars({
  days,
  className,
}: {
  days: readonly FleetDayBar[]
  className?: string
}) {
  return (
    <span
      className={cn("inline-flex h-5 items-stretch gap-[1.5px]", className)}
      aria-label="Ninety days, oldest to newest"
    >
      {days.map((bar) => (
        <span
          key={bar.day}
          title={`${bar.day}${bar.uptime_percent === null ? " · no history" : ` · ${percent(bar.uptime_percent, { digits: 2, pad: true })}`}`}
          className={cn(
            "h-full w-[3px] shrink-0 rounded-[1px]",
            BAR_FILL[bar.colour]
          )}
        />
      ))}
    </span>
  )
}

/// A skeleton strip for a component whose ninety days have not loaded yet —
/// same width, so a row does not jump when the fetch lands.
export function FleetDayBarsPlaceholder({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 items-stretch gap-[1.5px]", className)}
    >
      {Array.from({ length: 90 }, (_, index) => (
        <span
          key={index}
          className="h-full w-[3px] shrink-0 rounded-[1px] bg-hairline-2"
        />
      ))}
    </span>
  )
}

export function uptimeWord(uptime: number | null): string {
  if (uptime === null) return "—"
  if (uptime >= 99.995) return "100%"
  return percent(uptime, { digits: 2, pad: true })
}

const KIND_WORD: Readonly<Record<string, string>> = {
  STORE: "Store",
  GUDANG: "Warehouse",
  HEAD_OFFICE: "Head office",
}

export function fleetKindWord(kind: string): string {
  return KIND_WORD[kind] ?? kind
}

/// A store's own status, one line, for its Overview tab
/// (`screens/stores/overview-tab.tsx`) — the same row the fleet page draws,
/// read again by unit so a store manager without `stores` reach to every
/// other row still sees theirs. Silent (`null`) rather than an error banner
/// when the fetch fails: a store's own checklist is the page's real subject,
/// and this strip is a courtesy on top of it.
export function FleetStoreStrip({ unitId }: { unitId: string }) {
  const status = useFleetStatusOf(unitId, true)
  const row = status.data?.row
  if (row === undefined) return null
  return (
    <AppLink
      to="/system/servers"
      className="flex items-center gap-2.5 rounded-card border border-hairline-2 bg-canvas px-3.5 py-2.5 text-[0.875rem] transition-colors hover:bg-soft"
    >
      <FleetDot colour={row.colour} />
      <span className="min-w-0 flex-1 truncate text-body">{row.headline}</span>
      {row.last_heard_at && (
        <span className="shrink-0 text-meta text-mute">
          heard {ago(row.last_heard_at)}
        </span>
      )}
    </AppLink>
  )
}
