/// How numbers are said on a warehouse screen.
///
/// One module rather than a `toLocaleString` at each call site: quantities and
/// money are read across the room at arm's length, and two screens grouping
/// digits differently is the kind of small inconsistency that makes an
/// operator check twice.

const QUANTITY = new Intl.NumberFormat("id-ID")
const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

export function units(value: number): string {
  return QUANTITY.format(value)
}

/// Money arrives in the smallest unit, always. A screen that divided by 100
/// here would be inventing a decimal the server never sent.
export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) {
    return "—"
  }
  return RUPIAH.format(minor)
}

/// Signed, because a variance reads wrong without its sign: "16" is not the
/// same news as "−16".
export function variance(value: number): string {
  if (value === 0) {
    return "0"
  }
  return `${value > 0 ? "+" : "−"}${QUANTITY.format(Math.abs(value))}`
}

/// Time of day, which is what a shift asks. The date is only added when the
/// answer is not today, because a warehouse works in hours.
export function clock(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") {
    return "—"
  }
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) {
    return iso
  }
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

/// How long ago, for anything whose age is the point.
export function ago(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") {
    return "never"
  }
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (Number.isNaN(seconds)) return iso
  if (seconds < 0) return "in the future"
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

/// The tail of an identifier, for a screen that has no room for the whole of
/// it. Never used where the value has to be copied or typed back in.
export function shortId(value: string): string {
  return value.length <= 8 ? value : `…${value.slice(-8)}`
}
