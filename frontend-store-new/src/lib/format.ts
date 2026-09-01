/// Formatting, in one place.
///
/// **Money is not here.** It is `money()` from `@itulah/contract/money`, shared
/// with the centre and the warehouse, and a second formatter in this file would
/// be exactly the drift that estate once paid for: two tills that priced the
/// same garment differently, and a label on a shirt that disagreed with the
/// receipt. Formatting is not pricing, but "IDR has no minor unit" is a fact
/// about the currency rather than about a screen.

const plain = new Intl.NumberFormat("id-ID")

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  return plain.format(value)
}

/// A time somebody at a counter reads: the day and the minute, because on this
/// surface almost everything did happen at a minute that matters — which
/// receipt, which movement, how long ago.
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
