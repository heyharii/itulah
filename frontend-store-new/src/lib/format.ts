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

/// "1 pc", "12 pcs".
export function pcs(value: number | null | undefined): string {
  return `${count(value)} ${value === 1 ? "pc" : "pcs"}`
}

/// A date in English month names, day first ("06 Oct 2026") — the hub's
/// `dateText`. The app is English (owner, 2026-10-06): Indonesian month names —
/// "Okt", "Agu", "Mei", "Des" — read as a mistake beside it; amounts keep the
/// rupiah's own grouping. `en-GB` spells September "Sept", trimmed to "Sep".
export function dateText(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-GB", options)
    .format(date)
    .replace(/\bSept\b/, "Sep")
}

/// A time somebody at a counter reads: the day, the year and the minute —
/// "06 Oct 2026, 14:28" — because on this surface almost everything did happen
/// at a minute that matters: which receipt, which movement.
export function moment(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  return dateText(parsed, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/// A date, with no time: "06 Oct 2026" — where the day is all that matters,
/// such as when a delivery left and when it arrived.
export function day(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return "—"
  return dateText(parsed, { day: "2-digit", month: "short", year: "numeric" })
}

const COMPACT_STEPS = [
  [1e3, "K"],
  [1e6, "M"],
  [1e9, "B"],
  [1e12, "T"],
] as const

/// Large figures for a chart axis or a tight cell: K (thousand), M (million),
/// B (billion), T (trillion), with the rupiah's own decimal comma — the hub's
/// `compactFormat`. `id-ID`'s built-in compact notation says rb / jt / M, and
/// its M is a billion, so the suffixes are written out here instead.
export function compactFormat(maxFractionDigits = 1): {
  format: (value: number) => string
} {
  const grouped = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: maxFractionDigits,
  })
  const scale = 10 ** maxFractionDigits
  return {
    format(value: number): string {
      const size = Math.abs(value)
      let at = -1
      COMPACT_STEPS.forEach(([step], index) => {
        if (size >= step) at = index
      })
      if (at < 0) return grouped.format(value)
      // 999,950 rounds to "1.000 K"; say "1 M" instead.
      const rounded = Math.round((size / COMPACT_STEPS[at][0]) * scale) / scale
      if (rounded >= 1000 && at < COMPACT_STEPS.length - 1) at += 1
      const [step, suffix] = COMPACT_STEPS[at]
      return `${grouped.format(value / step)} ${suffix}`
    },
  }
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

/// A stored code as words in Title Case: "SANDAL_SEPATU" → "Sandal Sepatu".
export function words(code: string | null | undefined): string {
  if (!code) return "—"
  return code
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

/// The letter an avatar shows for a name: the first LETTER, not the first
/// character — "👨‍💼 Budi" is a B, where `charAt(0)` hands back half of an emoji
/// and the avatar draws a replacement mark. A name with no letter at all falls
/// back to its first whole character, and an empty one to "?".
export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim()
  if (trimmed === "") return "?"
  const letter = trimmed.match(/\p{L}/u)?.[0]
  return (letter ?? Array.from(trimmed)[0] ?? "?").toLocaleUpperCase()
}

/// ── SKU ─────────────────────────────────────────────────────────────────────

/// A SKU as a person reads it (owner, 21 Oct 2026): the article's eight digits,
/// a middle dot, then colour + size — "00000004103" → "00000004·103". The
/// stored code stays eleven plain digits; this is display only, so barcodes,
/// QR and search keep the raw value. Anything not eleven digits is returned
/// as it came.
export function sku(code: string | null | undefined): string {
  if (code === null || code === undefined || code === "") return "—"
  return /^\d{11}$/.test(code) ? `${code.slice(0, 8)}·${code.slice(8)}` : code
}

/// The article id a line names: its `article_code` when the API sent one,
/// otherwise the first eight digits of an eleven-digit SKU; "—" when neither.
export function articleId(
  articleCode: string | null | undefined,
  skuCode?: string | null,
): string {
  if (articleCode !== null && articleCode !== undefined && articleCode !== "")
    return articleCode
  return skuCode !== null && skuCode !== undefined && /^\d{11}$/.test(skuCode)
    ? skuCode.slice(0, 8)
    : "—"
}
