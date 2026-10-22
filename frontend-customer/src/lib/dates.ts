/// Dates as a shopper reads them, in their own timezone.
///
/// The server sends an instant in UTC; a purchase made at half past nine on a
/// Friday evening in Jakarta is stamped Saturday in UTC, and a history grouped
/// by the UTC day would file it under the wrong date on the phone of the
/// person who made it. Every function here works in the browser's local zone
/// for exactly that reason.

const DAY = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

const DAY_SHORT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const DAY_MONTH = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
})

const TIME = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
})

/// The local calendar day an instant fell on, as a key to group by.
///
/// Built from the local date parts rather than `toISOString().slice(0, 10)`,
/// which is the UTC day and would split a single evening across two headings.
export function dayKey(iso: string): string {
  const at = new Date(iso)
  const year = at.getFullYear()
  const month = `${at.getMonth() + 1}`.padStart(2, "0")
  const day = `${at.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

/// "Hari ini", "Kemarin", or the date written out.
export function dayLabel(iso: string): string {
  const key = dayKey(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (key === dayKey(today.toISOString())) {
    return "Hari ini"
  }
  if (key === dayKey(yesterday.toISOString())) {
    return "Kemarin"
  }
  return DAY.format(new Date(iso))
}

export function shortDate(iso: string): string {
  return DAY_SHORT.format(new Date(iso))
}

/// A date in a row: the year only when it is not this one. A purchase list
/// at 15px on a 375-wide phone has no room for "2026" on every line, and
/// this year is the one nobody needs told.
export function rowDate(iso: string): string {
  const date = new Date(iso)
  return date.getFullYear() === new Date().getFullYear()
    ? DAY_MONTH.format(date)
    : DAY_SHORT.format(date)
}

export function timeOfDay(iso: string): string {
  return TIME.format(new Date(iso))
}

/// A date and a time together, for a receipt.
export function stamp(iso: string): string {
  return `${DAY_SHORT.format(new Date(iso))} · ${TIME.format(new Date(iso))}`
}
