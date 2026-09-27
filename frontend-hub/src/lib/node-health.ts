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
  if (d) return `${d} hari${h ? ` ${h} jam` : ""}`
  if (h) return `${h} jam${m ? ` ${m} menit` : ""}`
  if (m) return `${m} menit`
  return `${s} detik`
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
        what: `Macet ${span(incident.stalled_seconds)}, dimulai ulang otomatis`,
        detail:
          "Server tidak memberi tanda hidup, jadi ia menghentikan dirinya sendiri dan menyala lagi.",
      }
    }
    case "CRASH_LOOP":
      return {
        tone: "bad",
        when: moment(incident.at),
        what: `Berhenti sementara: gagal ${incident.starts_in_window} kali dalam 10 menit`,
        detail: `Menahan diri ${span(incident.hold_seconds)} lalu mencoba lagi · perlu developer`,
      }
    case "STOPPED":
      return {
        tone: "info",
        when: moment(incident.at),
        what: "Dihentikan dengan rapi",
        detail:
          incident.reason === "asked to stop"
            ? "Diminta berhenti (restart, update, atau dimatikan)."
            : incident.reason,
      }
    case "ENROLLED":
      return {
        tone: "ok",
        when: moment(incident.at),
        what: `Terdaftar sebagai ${incident.site_id}`,
        detail: "Disetujui kantor pusat; data awal dikirim.",
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
              what: `Listrik padam atau mesin dinyalakan ulang (${span(down)})`,
              detail: "Mesin menyala lagi sendiri dan server melanjutkan.",
            }
          : {
              tone: "warn",
              when,
              what: `Mati mendadak ${span(down)}, pulih sendiri`,
              detail: "Proses berhenti tanpa pesan (crash).",
            }
      }
      if (previous.how === "FIRST_START")
        return {
          tone: "info",
          when: moment(incident.at),
          what: "Pertama kali dijalankan",
          detail: `Versi ${incident.version}`,
        }
      return null
    }
    default:
      return null
  }
}
