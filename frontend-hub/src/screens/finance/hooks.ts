import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { day } from "@/lib/format"
import { accountMap, financeKeys, listPeriods } from "@/lib/queries/finance"
import { isoDay, todayIso } from "@/screens/finance/chart"

/// The module's shared reads, and the two shapes of date question it asks.
///
/// A separate file from `parts.tsx` for one blunt reason: a module that exports
/// both components and hooks loses fast refresh, and the lint rule that says so
/// is right — editing `<AccountPicker>` would remount every screen holding one
/// of these hooks. `parts.tsx` is the components; this is what they and the
/// screens both call.
///
/// Nothing here fetches anything a screen was not already fetching. Every query
/// key is one some screen in this module owns, so a location select on six
/// screens is one request, and the date default reuses the calendar the sidebar
/// badge already holds.

/// The locations the books are kept for.
///
/// `GET /account-map` is the only endpoint that answers this, and it answers it
/// from the chart itself rather than from the list of places a delivery can
/// reach — a location the books are kept for is one that has accounts scoped to
/// it. Every caller here shares the key the Account map screen and the overview
/// already use, so a module full of location pickers is still one request.
///
/// Held for five minutes: the client opens a shop about once a year.
export function useLocations() {
  return useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
    staleTime: 5 * 60 * 1000,
  })
}

/// A `site_id` as the client says it: "Store 07", not `store-07`.
///
/// Falls back to the id, which is the only honest thing to draw for a location
/// the account map does not carry — inventing a label for an id nobody
/// recognises would be worse than showing the id.
export function useSiteName(): (siteId: string | null | undefined) => string {
  const map = useLocations()
  const byId = useMemo(() => {
    const table = new Map<string, string>()
    for (const location of map.data?.locations ?? []) {
      table.set(location.site_id, location.name)
    }
    return table
  }, [map.data])

  return (siteId) =>
    siteId === null || siteId === undefined || siteId === ""
      ? "—"
      : (byId.get(siteId) ?? siteId)
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/// The two shapes of date question finance asks, and nothing else.
///
/// A balance is a moment: *what is this worth as at a date*. A movement is a
/// window: *what happened between two*. Before these, six screens each had a
/// pair of bare `<input type="date">` boxes left blank, every one of them
/// relying on a different server-side default, and none of them saying on the
/// page what date they were actually reporting. Blank is the problem: the
/// reader cannot tell "today" from "the server picked something" from "I
/// forgot to fill this in", and all three look identical.
///
/// So the boxes arrive filled, and the effective answer is always echoed in
/// words. The server's own defaults are untouched — these send what is on
/// screen, which is what the screen says it is sending.
export interface AsOf {
  readonly value: string
  readonly set: (value: string) => void
  /// "As at 02 Sep 2026" — for the screen's existing muted chip.
  readonly chip: string
}

export function useAsOf(): AsOf {
  const [value, setValue] = useState(todayIso)
  return { value, set: setValue, chip: `As at ${day(value)}` }
}

export interface DateWindow {
  readonly from: string
  readonly to: string
  readonly setFrom: (value: string) => void
  readonly setTo: (value: string) => void
  /// "01 Aug 2026 – 02 Sep 2026".
  readonly chip: string
}

/// A window, defaulting to the month the books are actually being worked in.
///
/// Not the current calendar month: on the third of September an accountant is
/// usually still in August, and the system already knows which month that is —
/// the most recent period somebody opened and has not sealed. Falling back to
/// the first of the current month is right when no period is open at all,
/// because then nothing can be posted anywhere and the calendar is the only
/// honest guess.
///
/// The default follows the periods query until somebody edits a box, and stops
/// the moment they do. No effect and no reset: an answer that rewrites itself
/// under a reader half a second after a list arrives is worse than a stale one.
export function useWindow(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)

  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal),
    staleTime: 60_000,
  })

  const fallback = useMemo(() => {
    const now = new Date()
    const open = (periods.data ?? [])
      .filter((row) => row.status.toUpperCase() === "OPEN")
      .sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month))[0]
    const start =
      open === undefined
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(open.year, open.month - 1, 1)
    return { from: isoDay(start), to: isoDay(now) }
  }, [periods.data])

  const value = draft ?? fallback

  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}
