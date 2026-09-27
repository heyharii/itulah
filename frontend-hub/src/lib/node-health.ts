import { moment } from "@/lib/format"
import type { HealthTone, NodeIncident } from "@/lib/queries/system"

/// Shared by the Nodes screen and anything else that shows a shop server's
/// health. The history wording follows the node's own console
/// (`backend/src/edge/console.html`), so a shop and head office read the same
/// sentence for the same event.

export type PillTone = "ok" | "info" | "warn" | "bad" | "neutral"

export function pillTone(tone: HealthTone | null | undefined): PillTone {
  switch (tone) {
    case "OK":
      return "ok"
    case "INFO":
      return "info"
    case "WARN":
      return "warn"
    case "BAD":
      return "bad"
    default:
      return "neutral"
  }
}

/// Worst first, for sorting.
export function toneRank(tone: HealthTone | null | undefined): number {
  return { BAD: 3, WARN: 2, INFO: 1, OK: 0 }[tone ?? "OK"] ?? 0
}

function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} d${h ? ` ${h} h` : ""}`
  if (h) return `${h} h${m ? ` ${m} min` : ""}`
  if (m) return `${m} min`
  return `${s} s`
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export interface Line {
  tone: PillTone
  when: string
  what: string
  detail: string
}

/// One incident as a sentence: what, from–to, how long.
export function describeIncident(incident: NodeIncident): Line | null {
  switch (incident.kind) {
    case "HUNG": {
      const from = new Date(
        Date.parse(incident.at) - incident.stalled_seconds * 1000
      ).toISOString()
      return {
        tone: "warn",
        when: `${moment(from)}–${clock(incident.at)}`,
        what: `Hung for ${span(incident.stalled_seconds)}, restarted itself`,
        detail:
          "The server stopped showing signs of life, so it stopped itself and started again.",
      }
    }
    case "CRASH_LOOP":
      return {
        tone: "bad",
        when: moment(incident.at),
        what: `Paused: failed ${incident.starts_in_window} times in 10 min`,
        detail: `Holding back ${span(incident.hold_seconds)}, then tries again · needs a developer`,
      }
    case "STOPPED":
      return {
        tone: "info",
        when: moment(incident.at),
        what: "Stopped cleanly",
        detail:
          incident.reason === "asked to stop"
            ? "Asked to stop (restart, update or shutdown)."
            : incident.reason,
      }
    case "ON_BATTERY":
      return {
        tone: "warn",
        when: moment(incident.at),
        what: "Power cut, running on the UPS",
        detail:
          incident.charge_percent != null
            ? `Battery at ${incident.charge_percent} % when it started.`
            : "The queue was sent to head office straight away.",
      }
    case "POWER_RESTORED":
      return {
        tone: "ok",
        when: moment(incident.at),
        what: `Power back after ${span(incident.on_battery_seconds)}`,
        detail: "The server never went down.",
      }
    case "ENROLLED":
      return {
        tone: "ok",
        when: moment(incident.at),
        what: `Registered as ${incident.site_id}`,
        detail: "Approved by head office; initial data sent.",
      }
    case "STARTED": {
      const previous = incident.previous
      if (previous.how === "UNCLEAN") {
        const down =
          (Date.parse(incident.at) - Date.parse(previous.last_seen)) / 1000
        const when = `${moment(previous.last_seen)}–${clock(incident.at)}`
        return previous.machine_restarted
          ? {
              tone: "info",
              when,
              what: `Power cut or machine restarted (${span(down)})`,
              detail:
                "The machine came back on its own and the server carried on.",
            }
          : {
              tone: "warn",
              when,
              what: `Stopped suddenly for ${span(down)}, recovered on its own`,
              detail: "The process stopped without a word (crash).",
            }
      }
      if (previous.how === "FIRST_START")
        return {
          tone: "info",
          when: moment(incident.at),
          what: "First start",
          detail: `Version ${incident.version}`,
        }
      return null
    }
    default:
      return null
  }
}
