import {
  dateText,
  EMPTY,
  moneyCompact,
  percent as sharePercent,
} from "@/lib/format"

/// The figure grammar every executive page shares: rupiah at the size a board
/// reads it, a share, a movement, and the time axis. The grammar itself is
/// `lib/format.ts` — this file only says which of its figures a board wants.

/// Rupiah at the size a board reads it: "Rp 2,0 B", "Rp 807,1 M". The
/// full figure goes in the tooltip; nobody compares a report to the rupiah.
export function rupiah(minor: number | null | undefined): string {
  return moneyCompact(minor)
}

/// A share of one (`0.123` is "12,3%").
export function percent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return EMPTY
  return sharePercent(fraction * 100, { digits: 1 })
}

/// A share, or nothing when there is nothing to divide by — never `NaN%`.
export function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole
}

/// How far a figure moved against the comparison, as a signed percentage.
/// Null when the comparison is zero: "new" is a fact, "+∞%" is not.
export function change(now: number, before: number): number | null {
  return before === 0 ? null : (now - before) / Math.abs(before)
}

export function changeLabel(fraction: number | null): string {
  if (fraction === null) return EMPTY
  const sign = fraction > 0.0005 ? "+" : fraction < -0.0005 ? "−" : ""
  return `${sign}${percent(Math.abs(fraction))}`
}

/// Up is good for sales and profit and bad for what is owed, so the caller
/// says which way is good and the tint follows.
export function changeTone(
  fraction: number | null,
  good: "up" | "down" = "up"
): "up" | "down" | "flat" {
  if (fraction === null || Math.abs(fraction) < 0.0005) return "flat"
  return fraction > 0 === (good === "up") ? "up" : "down"
}

// ── the time axis ───────────────────────────────────────────────────────────

/// A bucket on the axis: "7 Sep" for a day or a week, "Sep" for a month.
export function tick(start: string, bucket: "day" | "week" | "month"): string {
  const date = new Date(`${start}T12:00:00`)
  return bucket === "month"
    ? dateText(date, { month: "short" })
    : dateText(date, { day: "numeric", month: "short" })
}

/// A bucket in full, for the tooltip.
export function tickTitle(
  start: string,
  bucket: "day" | "week" | "month"
): string {
  if (start === "") return EMPTY
  const date = new Date(`${start}T12:00:00`)
  if (bucket === "month")
    return dateText(date, { month: "long", year: "numeric" })
  if (bucket === "week")
    return `Week of ${dateText(date, { day: "numeric", month: "long" })}`
  return dateText(date, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}
