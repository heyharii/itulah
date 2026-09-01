/**
 * The current calendar month, as the attendance API's date bounds.
 *
 * This lives in its own module for one reason: `routes/_people/hr-store.tsx`
 * calls it from its **loader**, and a route's loader is not code-split — only
 * its `component` is. While this function was exported from `hr-store.tsx`,
 * importing it pulled that 2,000-line screen into the entry chunk, where it
 * measured **55.5 kB minified** — the single largest piece of application code
 * every user downloaded before the first screen painted, for a ten-line date
 * helper.
 *
 * The rule this encodes: anything a route's `loader`, `loaderDeps` or
 * `validateSearch` imports is eager. Keep those imports pointed at small
 * modules — `queries`, `api`, helpers like this one — and never at a screen.
 */

import { todayKey, type DayKey } from "@/lib/day"

export interface MonthBounds {
  dateFrom: DayKey
  dateTo: DayKey
}

/** First and last day of the month `todayKey()` falls in, inclusive. */
export function currentMonthBounds(): MonthBounds {
  const today = todayKey()
  const [year, month] = today.split("-").map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, "0")

  return {
    dateFrom: `${year}-${mm}-01` as DayKey,
    dateTo: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` as DayKey,
  }
}
