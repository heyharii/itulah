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
