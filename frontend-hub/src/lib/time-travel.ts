import type { ClockControlRequest, ClockStatus } from "@itulah/contract"

import { dateParts, dateText } from "@/lib/format"

/// The arithmetic behind the Time travel panel: what "now" is on the server,
/// where a quick jump lands, and how a moment reads. Business time is always
/// Asia/Jakarta (UTC+7, no daylight saving), so a fixed offset is exact.

export const DAY = 86_400_000
const WIB = 7 * 3_600_000
const ZONE = "Asia/Jakarta"

/// Every moment on this panel is read in Jakarta, whatever zone the browser is
/// in: the clock being bent is the business's, not the laptop's.
const MOMENT = {
  timeZone: ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const

/// "Fri 06 Nov 2026 · 14:05"
export function momentLabel(ms: number): string {
  const p = momentParts(ms)
  return `${p.weekday} ${p.day} ${p.month} ${p.year} · ${p.hour}:${p.minute}`
}

/// `momentLabel`, in the pieces the header rolls one by one.
export function momentParts(ms: number): {
  weekday: string
  day: string
  month: string
  year: string
  hour: string
  minute: string
} {
  const found = dateParts(new Date(ms), MOMENT)
  return {
    weekday: found.weekday ?? "",
    day: found.day ?? "",
    month: found.month ?? "",
    year: found.year ?? "",
    hour: found.hour ?? "",
    minute: found.minute ?? "",
  }
}

/// Where the two hands of an analog face stand, in degrees clockwise from 12,
/// at an instant in Jakarta.
export function handAngles(ms: number): { hour: number; minute: number } {
  const minutes = ((((ms + WIB) % DAY) + DAY) % DAY) / 60_000
  return { hour: ((minutes / 60) % 12) * 30, minute: (minutes % 60) * 6 }
}

/// The calendar day (`yyyy-mm-dd`) an instant falls on in Jakarta.
export function businessDay(ms: number): string {
  return new Date(ms + WIB).toISOString().slice(0, 10)
}

/// The instant a Jakarta calendar day begins.
export function dayStart(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) - WIB
}

/// "05 Nov" — the button's reminder that time is bent.
export function shortDay(ms: number): string {
  return dateText(new Date(ms), {
    timeZone: ZONE,
    day: "2-digit",
    month: "short",
  })
}

/// "06 Nov 2026" — the toast after a jump.
export function dayLabel(ms: number): string {
  return dateText(new Date(ms), {
    timeZone: ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/// Whether the clock is anything but the wall clock.
export function isBent(status: ClockStatus): boolean {
  return status.source.mode !== "system" || status.paused
}

/// The server's instants, carried forward from the poll to this moment:
/// a status can be five seconds old, and a ×876 clock moves 73 virtual
/// minutes in that time.
export function serverNow(
  status: ClockStatus,
  fetchedAt: number,
  realNow: number
): { real: number; business: number } {
  const elapsed = Math.max(0, realNow - fetchedAt)
  const real = Date.parse(status.real_now) + elapsed
  if (status.virtual_now === null) return { real, business: real }
  const virtual = Date.parse(status.virtual_now)
  const factor =
    status.source.mode === "scaled" && !status.paused ? status.source.factor : 0
  return { real, business: virtual + elapsed * factor }
}

/// "Virtual · 35 days ahead of real", or "Real time".
export function aheadLabel(status: ClockStatus): string {
  if (status.virtual_now === null) return "Real time"
  const offset = Date.parse(status.virtual_now) - Date.parse(status.real_now)
  const size = Math.abs(offset)
  const side = offset >= 0 ? "ahead of" : "behind"
  let gap: string
  if (size < 60_000) gap = "level with real time"
  else if (size < DAY) {
    const hours = Math.max(1, Math.round(size / 3_600_000))
    gap = `${hours} ${hours === 1 ? "hour" : "hours"} ${side} real`
  } else {
    const days = Math.round(size / DAY)
    gap = `${days} ${days === 1 ? "day" : "days"} ${side} real`
  }
  return `Virtual · ${gap}`
}

/// "37 days ahead" — the header's reminder that time is bent; `null` when the
/// virtual clock is level with the real one (or there is none).
export function aheadShort(status: ClockStatus): string | null {
  if (status.virtual_now === null) return null
  const offset = Date.parse(status.virtual_now) - Date.parse(status.real_now)
  const size = Math.abs(offset)
  if (size < 60_000) return null
  const side = offset >= 0 ? "ahead" : "behind"
  if (size < DAY) {
    const hours = Math.max(1, Math.round(size / 3_600_000))
    return `${hours} ${hours === 1 ? "hour" : "hours"} ${side}`
  }
  const days = Math.round(size / DAY)
  return `${days} ${days === 1 ? "day" : "days"} ${side}`
}

/// The speed, said plainly — `null` when it is simply the wall's pace.
export function speedLabel(status: ClockStatus): string | null {
  if (status.paused) return "Paused"
  const mode = status.source
  if (mode.mode === "controlled") return "Stopped at this moment"
  if (mode.mode === "scaled" && mode.factor !== 1) {
    const factor = mode.factor >= 10 ? Math.round(mode.factor) : mode.factor
    return `Running ${factor}× faster than real`
  }
  return null
}

/// How the virtual clock's dust moves: 1 is calm, a clock running faster
/// than real time raises it (to 4 at most), and a paused or stopped clock
/// holds it still.
export function flowOf(status: ClockStatus): {
  speed: number
  paused: boolean
} {
  const mode = status.source
  return {
    speed: mode.mode === "scaled" ? Math.min(4, Math.max(1, mode.factor)) : 1,
    paused: status.paused || mode.mode === "controlled",
  }
}

/// Midnight WIB on the first of the month after `ms`.
export function nextMonthStart(ms: number): number {
  const local = new Date(ms + WIB)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - WIB
}

/// `<input type="datetime-local">` value for an instant, in WIB.
export function toInput(ms: number): string {
  return new Date(ms + WIB).toISOString().slice(0, 16)
}

/// The instant a `datetime-local` value names, read as WIB wall time.
export function fromInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (m === null) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  return Date.UTC(y, mo - 1, d, h, mi) - WIB
}

/// The request that puts business time at `target`. From the wall clock the
/// node will not "advance" (there is no virtual time yet), so the first jump
/// starts a virtual clock running at real speed from `target`; after that
/// every jump is an `advance_to`, which keeps the speed it has.
export function jumpRequest(
  status: ClockStatus,
  target: number,
  real: number
): ClockControlRequest {
  if (status.source.mode === "system")
    return {
      op: "set_mode",
      mode: {
        mode: "scaled",
        anchor_real: new Date(real).toISOString(),
        anchor_virtual: new Date(target).toISOString(),
        factor: 1,
      },
    }
  return { op: "advance_to", at: new Date(target).toISOString() }
}
