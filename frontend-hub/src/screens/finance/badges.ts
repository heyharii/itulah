import { useQuery } from "@tanstack/react-query"

import {
  accountMap,
  financeKeys,
  listBills,
  listPeriods,
  type AccountMapView,
} from "@/lib/queries/finance"

/// The counts the sidebar draws beside three finance entries, and the one
/// derivation two screens and a badge all needed.
///
/// # Why a hook per item rather than a number on the nav
///
/// `lib/navigation.ts` is a static declaration read by the sidebar, the palette
/// and the router. Putting a live count in it would make it a module that
/// fetches, and all three readers would pay for it. A `useCount` hook instead
/// is called by exactly one of them — the sidebar — and the per-item ones only
/// while the module they belong to is expanded.
///
/// # Why these three and not a badge on everything
///
/// A badge is an interruption. It earns its place when the number means
/// *somebody has to do something and nobody has*, and it stops meaning
/// anything at all the moment half the sidebar wears one. Bills past due,
/// meanings with no account, and a month nobody has opened are the three
/// states where work is actually blocked; a count of assets or of bank lines
/// is a workload, which is what the screen is for.
///
/// # What this costs
///
/// Nothing that was not already being fetched. Each hook reuses the exact key
/// of the screen it points at, so the sidebar warms three caches the overview
/// reads anyway, and clicking through to any of the three finds its answer
/// already in hand. It is a real cost on the screens that do not want it — the
/// journal, say, now holds a list of bills it never draws — and that is the
/// trade a badge is: three cached lists against three states that otherwise go
/// unnoticed until a posting is refused.
///
/// Every hook answers `null` while its query is pending. Not `0`: "no bills are
/// overdue" and "we have not asked yet" are different facts, and a badge that
/// showed the second as the first would blink on at every page load.

// ---------------------------------------------------------------------------
// The account map, counted once
// ---------------------------------------------------------------------------

/// Which meanings have no account, at which locations.
///
/// A *pair*, not a row: the posting rules ask for a meaning at a location, and
/// `bank_savings` legitimately holds five accounts at one site — one per bank.
/// Counting rows would report a site as five-sixths finished on the strength of
/// one meaning, and counting keys would report a meaning as done when it is set
/// at one location out of fourteen.
///
/// This lived in three places before it lived here: the overview's exception
/// queue, the account map's own table, and then the sidebar badge wanted it
/// too. Three copies of a derivation is three chances for the number on the
/// sidebar to disagree with the number on the screen it links to.
export interface MapGaps {
  /// Every location the books are kept for.
  readonly sites: readonly string[]
  /// Semantic key → the locations it is not set at.
  readonly missingByKey: ReadonlyMap<string, readonly string[]>
  /// Unmapped meaning × location pairs, which is what "how much is left" means.
  readonly pairs: number
  /// Pairs required in total, and pairs answered.
  readonly required: number
  readonly set: number
}

const NO_GAPS: MapGaps = {
  sites: [],
  missingByKey: new Map(),
  pairs: 0,
  required: 0,
  set: 0,
}

export function accountMapGaps(view: AccountMapView | undefined): MapGaps {
  if (view === undefined) return NO_GAPS

  const sites = view.locations.map((location) => location.site_id)
  const have = new Set(
    view.mappings.map((row) => `${row.semantic_key} ${row.site_id}`)
  )

  const missingByKey = new Map<string, readonly string[]>()
  let pairs = 0
  for (const doc of view.required_keys) {
    const missing = sites.filter((site) => !have.has(`${doc.key} ${site}`))
    missingByKey.set(doc.key, missing)
    pairs += missing.length
  }

  const required = view.required_keys.length * sites.length
  return { sites, missingByKey, pairs, required, set: required - pairs }
}

// ---------------------------------------------------------------------------
// The three hooks the sidebar calls
// ---------------------------------------------------------------------------

/// Bills that are recorded, not posted, and past their due date.
///
/// Recorded-and-not-posted is not by itself a problem — a bill can arrive, be
/// queried and be held on purpose. Past due while still unposted is the pair
/// that means somebody stopped.
export function useOverdueBillCount(): number | null {
  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
  })
  if (bills.data === undefined) return null
  return bills.data.filter(
    (bill) => bill.status.toUpperCase() !== "POSTED" && bill.days_overdue > 0
  ).length
}

/// Meanings with no account behind them, counted per location.
///
/// Drawn as `bad` and not `warn`: every posting that needs one of these is
/// refused outright, so this is not a backlog, it is a stoppage.
export function useUnmappedMeaningCount(): number | null {
  const map = useQuery({
    queryKey: financeKeys.accountMap(null),
    queryFn: ({ signal }) => accountMap(undefined, signal),
  })
  if (map.data === undefined) return null
  return accountMapGaps(map.data).pairs
}

/// One, when this calendar month is not open for posting.
///
/// A count of one rather than a state, because the sidebar draws numbers. There
/// is exactly one current month and it is either open or it is not — a month
/// that has been sealed counts here too, since nothing can be posted into that
/// one either and the answer is the same: open the next one.
export function useMonthNotOpenCount(): number | null {
  const periods = useQuery({
    queryKey: financeKeys.periods(),
    queryFn: ({ signal }) => listPeriods(signal),
  })
  if (periods.data === undefined) return null

  const now = new Date()
  const current = periods.data.find(
    (row) => row.year === now.getFullYear() && row.month === now.getMonth() + 1
  )
  return current !== undefined && current.status.toUpperCase() === "OPEN"
    ? 0
    : 1
}

// ---------------------------------------------------------------------------
// The one the module's own row calls
// ---------------------------------------------------------------------------

/// The three above, added up — what Finance wears while its sub-items are not
/// on screen.
///
/// It exists because the sidebar collapses every module but the one you are
/// standing in, and a badge whose whole job is to be noticed without visiting
/// the module would otherwise only appear once you had. Composing the three
/// here rather than summing them in the sidebar is what keeps the sidebar to
/// one hook per row: three calls in a fixed order inside one hook is ordinary
/// React, three calls in a loop over a list of differing lengths is not.
///
/// `null` until at least one has answered, so the row draws nothing on a cold
/// load rather than counting up as each query lands.
export function useFinanceAttentionCount(): number | null {
  const overdue = useOverdueBillCount()
  const unmapped = useUnmappedMeaningCount()
  const closed = useMonthNotOpenCount()

  if (overdue === null && unmapped === null && closed === null) return null
  return (overdue ?? 0) + (unmapped ?? 0) + (closed ?? 0)
}
