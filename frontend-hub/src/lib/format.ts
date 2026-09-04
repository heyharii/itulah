/// Formatting, in one place.
///
/// Money arrives from the server in minor units as an integer, and it stays
/// that way until the moment it is drawn: a float rupiah is a rounding error
/// waiting for a total to disagree with a ledger.

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

/// Minor units → the string a person reads. IDR has no minor unit in practice,
/// so the server's "minor" is already whole rupiah.
export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "—"
  return rupiah.format(minor)
}

const plain = new Intl.NumberFormat("id-ID")

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return plain.format(value)
}

/// A date without a time, because almost nothing in this app happens at a
/// moment a person needs to the minute.
export function day(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function moment(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// The retail status taxonomy, one mapping for the whole app.
///
/// Payment: Paid→ok · Pending→warn · Shipped/Processing→info · Cancelled→bad.
/// Stock: In stock→ok · Low→warn · Out→bad.
/// Logistics: Completed→ok · In transit→info · Awaiting/Delayed→warn.
///
/// Keeping it here rather than per screen is what stops the same word being
/// amber on one list and green on the next.
export type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral"

const tones: Readonly<Record<string, Tone>> = {
  paid: "ok",
  completed: "ok",
  complete: "ok",
  closed: "ok",
  received: "ok",
  active: "ok",
  posted: "ok",
  approved: "ok",
  settled: "ok",
  in_stock: "ok",

  pending: "warn",
  awaiting: "warn",
  draft: "warn",
  delayed: "warn",
  low: "warn",
  partial: "warn",
  submitted: "warn",
  proposed: "warn",

  issued: "info",
  shipped: "info",
  processing: "info",
  in_transit: "info",
  receiving: "info",
  open: "info",

  cancelled: "bad",
  canceled: "bad",
  rejected: "bad",
  failed: "bad",
  void: "bad",
  out: "bad",
  exception: "bad",
}

export function toneFor(status: string | null | undefined): Tone {
  if (!status) return "neutral"
  return tones[status.toLowerCase().replace(/[\s-]/g, "_")] ?? "neutral"
}

/// `PARTIALLY_RECEIVED` → `Partially received`. The server shouts its enums;
/// the screen does not have to.
export function label(status: string | null | undefined): string {
  if (!status) return "—"
  const words = status.toLowerCase().replace(/[_-]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/// ── The warehouse's own readings ────────────────────────────────────────────
///
/// The four above are the app-wide grammar. These four exist because a
/// warehouse asks different questions of a number than an office does: it
/// counts pieces rather than money, it reads a difference as news, and it
/// works in hours rather than in dates.

/// Pieces. The same formatter as `count`, named for what it is counting so a
/// screen reads as the floor talks.
export const units = count

/// Signed, because a variance reads wrong without its sign: "16" is not the
/// same news as "−16". A true minus sign, not a hyphen — it is set beside
/// tabular figures and a hyphen is half the width.
export function variance(value: number): string {
  if (value === 0) return "0"
  return `${value > 0 ? "+" : "−"}${plain.format(Math.abs(value))}`
}

/// Time of day, which is what a shift asks. The date is only added when the
/// answer is not today, because a warehouse works in hours.
export function clock(iso: string | null | undefined): string {
  if (!iso) return "—"
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "—"
  const today = new Date()
  const sameDay =
    at.getDate() === today.getDate() &&
    at.getMonth() === today.getMonth() &&
    at.getFullYear() === today.getFullYear()
  const time = at.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return sameDay
    ? time
    : `${at.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} ${time}`
}

/// How long ago, for anything whose age is the point — a delivery on the bay,
/// a backlog that has not gone anywhere.
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never"
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (Number.isNaN(seconds)) return "—"
  if (seconds < 0) return "in the future"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

/// Where a carton has got to, as the node derives it (`Koli.position`,
/// `Shipment.position`). Positions are computed from containment and never
/// stored, so a box cannot claim to be on a truck it was never loaded onto —
/// and the tones follow the two-blue rule: **on the road is sky**, everything
/// still standing in this building is not.
const positions: Readonly<Record<string, Tone>> = {
  packed: "neutral",
  shipment: "warn",
  loaded: "warn",
  in_transit: "info",
  delivered: "ok",
  open: "warn",
  sealed: "ok",
}

export function positionTone(position: string | null | undefined): Tone {
  if (!position) return "neutral"
  return (
    positions[position.toLowerCase().replace(/[\s-]/g, "_")] ??
    toneFor(position)
  )
}
