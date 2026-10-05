import type { NodeUptime, Outage, UptimeState } from "@/lib/queries/system"

/// Words and colours for uptime, shared by the Monitoring and Incidents
/// screens. The structure follows UptimeRobot's status pages; the look is the
/// hub's own.

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral"

export function stateTone(state: UptimeState): Tone {
  return { UP: "ok", DOWN: "bad", MAINTENANCE: "info", UNKNOWN: "neutral" }[
    state
  ] as Tone
}

export function stateWord(state: UptimeState): string {
  return {
    UP: "Up",
    DOWN: "Down",
    MAINTENANCE: "Maintenance",
    UNKNOWN: "Not seen yet",
  }[state]
}

/// "5 d 14 h", "12 min", "40 s".
export function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} d${h ? ` ${h} h` : ""}`
  if (h) return `${h} h${m ? ` ${m} min` : ""}`
  if (m) return `${m} min`
  return `${s} s`
}

export function since(iso: string | null): string {
  return iso ? span((Date.now() - Date.parse(iso)) / 1000) : "—"
}

/// "99,98 %" — two decimals below 100, because 99.9 and 99.99 are different
/// promises; "—" before the node was ever heard from.
export function percent(value: number | null): string {
  if (value === null) return "—"
  if (value >= 100) return "100 %"
  return `${value.toFixed(2).replace(".", ",")} %`
}

/// A day bar's colour: green for a clean day, amber for a dent, red for a
/// real outage, grey for a day with no data.
export function dayFill(value: number | null): string {
  if (value === null) return "bg-hairline-2"
  if (value >= 99.9) return "bg-ok"
  if (value >= 97) return "bg-warn"
  return "bg-bad"
}

/// The last 24 hours in 24 slots, oldest first: the share of each hour the
/// node was down. Maintenance is not down.
export function hourly(outages: readonly Outage[]): number[] {
  const now = Date.now()
  return Array.from({ length: 24 }, (_, index) => {
    const from = now - (24 - index) * 3_600_000
    const to = from + 3_600_000
    const down = outages
      .filter((outage) => outage.kind === "DOWN")
      .reduce((sum, outage) => {
        const start = Math.max(Date.parse(outage.start), from)
        const end = Math.min(outage.end ? Date.parse(outage.end) : now, to)
        return sum + Math.max(0, end - start)
      }, 0)
    return 100 - (down / 3_600_000) * 100
  })
}

export function overall(nodes: readonly NodeUptime[]): {
  tone: Tone
  headline: string
} {
  const down = nodes.filter((node) => node.state === "DOWN").length
  const maintenance = nodes.filter(
    (node) => node.state === "MAINTENANCE"
  ).length
  if (down)
    return {
      tone: "bad",
      headline: `${down} store ${down === 1 ? "server is" : "servers are"} down`,
    }
  if (maintenance)
    return {
      tone: "info",
      headline: `${maintenance} store ${maintenance === 1 ? "server is" : "servers are"} in maintenance`,
    }
  if (nodes.length === 0)
    return { tone: "neutral", headline: "No store servers yet" }
  // A server that has never reported is not "up" — saying so over nine grey
  // rows was the headline lying.
  const unseen = nodes.filter((node) => node.state === "UNKNOWN").length
  if (unseen === nodes.length)
    return { tone: "neutral", headline: "No store server has reported in yet" }
  if (unseen)
    return {
      tone: "neutral",
      headline: `${nodes.length - unseen} up · ${unseen} not seen yet`,
    }
  return { tone: "ok", headline: "All store servers are up" }
}
