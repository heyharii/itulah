/// The figure grammar every executive page shares: rupiah at the size a board
/// reads it, a share, a movement, and the time axis in Indonesian.

const decimal = (digits: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })

/// Rupiah at the size a board reads it: "Rp1,97 miliar", "Rp807,1 jt". The
/// full figure goes in the tooltip; nobody compares a report to the rupiah.
export function rupiah(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "—"
  const sign = minor < 0 ? "−" : ""
  const size = Math.abs(minor)
  if (size >= 1e9) return `${sign}Rp${decimal(2).format(size / 1e9)} miliar`
  if (size >= 1e6) return `${sign}Rp${decimal(1).format(size / 1e6)} jt`
  if (size >= 1e3) return `${sign}Rp${decimal(0).format(size / 1e3)} rb`
  return `${sign}Rp${decimal(0).format(size)}`
}

export function percent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction))
    return "—"
  return `${new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction * 100)}%`
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
  if (fraction === null) return "—"
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
    ? date.toLocaleDateString("id-ID", { month: "short" })
    : date.toLocaleDateString("id-ID", { day: "numeric", month: "short" })
}

/// A bucket in full, for the tooltip.
export function tickTitle(
  start: string,
  bucket: "day" | "week" | "month"
): string {
  if (start === "") return "—"
  const date = new Date(`${start}T12:00:00`)
  if (bucket === "month")
    return date.toLocaleDateString("id-ID", { month: "long", year: "numeric" })
  if (bucket === "week")
    return `Minggu ${date.toLocaleDateString("id-ID", { day: "numeric", month: "long" })}`
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}
