import { useHydrated } from "@tanstack/react-router"

import { dateText } from "@/lib/format"
import type { UnitView } from "@/lib/queries/organisation"
import { isoDay } from "@/screens/finance/chart"

/// The small arithmetic the Finance › Stores pages share with their
/// prefetcher: which shop is open, which one a page lands on, and the days,
/// weeks and months its rails are drawn over. Pure, so the server warms
/// exactly what the screen then asks for.

/// The shop the Stores pages last looked at, remembered for the session: the
/// sidebar's sub-menu links carry no search, so going from Cash on hand to
/// Petty cash should land on the same shop.
export const REMEMBERED_STORE = "finance.stores.unit"

function remembered(): string | null {
  try {
    return window.sessionStorage.getItem(REMEMBERED_STORE)
  } catch {
    return null
  }
}

export function remember(id: string) {
  try {
    window.sessionStorage.setItem(REMEMBERED_STORE, id)
  } catch {
    // Private window or blocked storage: the URL still carries the choice.
  }
}

/// The shop this tab last looked at, read once the browser has hydrated: the
/// server has no `sessionStorage`, and a first render that already knew the
/// answer would not be the markup the server sent. On a client-side
/// navigation the browser is hydrated already and the answer is there at once.
export function useRemembered(): string | null {
  const hydrated = useHydrated()
  return hydrated ? remembered() : null
}

/// Every open shop, by code.
export function openStoresOf(units: readonly UnitView[]): UnitView[] {
  return units
    .filter((unit) => unit.kind === "STORE" && unit.status !== "CLOSED")
    .sort((a, b) => a.code.localeCompare(b.code))
}

/// The shop a page opens on: the one asked for (`?store=`, or the one the tab
/// remembers), else the first by code.
export function chosenStoreOf(
  stores: readonly UnitView[],
  wanted: string | null
): UnitView | undefined {
  return stores.find((one) => one.id === wanted) ?? stores[0]
}

/// The last `n` days, oldest first, ending today.
export function lastDays(n: number, now: Date = new Date()): string[] {
  const days: string[] = []
  for (let back = n - 1; back >= 0; back -= 1) {
    const date = new Date(now)
    date.setDate(date.getDate() - back)
    days.push(isoDay(date))
  }
  return days
}

/// The Mondays of the last `n` weeks, oldest first.
export function lastWeeks(n: number, now: Date = new Date()): string[] {
  const monday = new Date(now)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const weeks: string[] = []
  for (let back = n - 1; back >= 0; back -= 1) {
    const start = new Date(monday)
    start.setDate(start.getDate() - back * 7)
    weeks.push(isoDay(start))
  }
  return weeks
}

/// The last `n` months, newest last; each a tab.
export function lastMonthTabs(n: number, now: Date = new Date()) {
  const months: { value: string; label: string; from: string; to: string }[] =
    []
  for (let back = n - 1; back >= 0; back -= 1) {
    const first = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
    months.push({
      value: isoDay(first).slice(0, 7),
      label: dateText(first, { month: "short", year: "numeric" }),
      from: isoDay(first),
      to: isoDay(last),
    })
  }
  return months
}

/// The account codes of a shop's three cash boxes in the client's chart (1002
/// CASH ON HAND, 1003 PETTY CASH, 1004 MODAL KASIR). The ledger is asked by
/// code.
export type StoreBox = "cash" | "petty_cash" | "cashier_float"
export const STORE_BOX_CODES: Record<StoreBox, string> = {
  cash: "1002",
  petty_cash: "1003",
  cashier_float: "1004",
}
