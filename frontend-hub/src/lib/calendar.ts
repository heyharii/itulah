/// Calendar arithmetic, in the local day.
///
/// One module because every screen that asks for a day needs the same three
/// things — what today is, what a month's grid looks like, and how to turn a
/// day into the instant the server stores — and each of them has a way of
/// going wrong that is invisible until somebody east of Greenwich uses it.
///
/// It moved here out of `screens/commercial/compose` when `<Day>` moved into
/// the kit: a control in `components/ui` cannot reach into a screen module for
/// its arithmetic.

/// Today, as this browser reckons it. **Never** through `toISOString()`, which
/// is UTC: east of Greenwich that is yesterday for the first seven hours of
/// every day, and Jakarta is seven hours east.
export const WEEKDAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const

export function today(): string {
  return isoOf(new Date())
}

export function isoOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0")
  const dayOfMonth = String(at.getDate()).padStart(2, "0")
  return `${at.getFullYear()}-${month}-${dayOfMonth}`
}

export function dateOf(iso: string): Date {
  const [year, month, dayOfMonth] = iso.split("-").map(Number)
  return new Date(year, month - 1, dayOfMonth)
}

/// A day, plus or minus some days, staying in local time.
export function shift(iso: string, days: number): string {
  const at = dateOf(iso)
  at.setDate(at.getDate() + days)
  return isoOf(at)
}

/// The start of a day, as the instant the server stores.
///
/// Its pair, `endOfDay`, is 23:59:59 of the same day and not midnight of the
/// next one — which is the off-by-one this whole control exists to stop.
/// "Until 30 September" means the thirtieth is included, and a `datetime-local`
/// box left at 00:00 quietly meant it was not.
export function startOfDay(iso: string): string {
  return dateOf(iso).toISOString()
}

export function endOfDay(iso: string): string {
  const at = dateOf(iso)
  at.setHours(23, 59, 59, 999)
  return at.toISOString()
}

/// The six-week grid a month is drawn on, Monday first.
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  // `getDay()` is Sunday-first; this app's week starts on Monday.
  const lead = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - lead)
  return Array.from({ length: 42 }, (_, index) => {
    const at = new Date(start)
    at.setDate(start.getDate() + index)
    return isoOf(at)
  })
}
