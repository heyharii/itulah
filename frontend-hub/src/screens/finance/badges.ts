import { useQuery } from "@tanstack/react-query"

import {
  accountMap,
  financeAttention,
  financeKeys,
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
/// One request of about a hundred bytes, shared by all four hooks.
///
/// It used to be three, and the claim written here was that they cost nothing
/// because each reused the key of the screen it pointed at. That was true of
/// the cache and false of the wire: the sidebar is mounted on EVERY screen, so
/// every cold load of the journal, of Sales, of anything at all pulled the
/// bill list, the period list and the whole account map — 695 mappings, 165 KB
/// — to arrive at three integers. Counting belongs where the rows are.
///
/// What is lost is the warm cache on the three screens the badges point at:
/// they now fetch their own lists when opened. That is one request on the
/// screen that wants it, instead of three on every screen that does not.
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

/// The one read behind all four badges.
///
/// The month is this browser's, because "this month is not open" is a
/// statement about the operator's day; a node in UTC and a shop in WIB
/// disagree about the answer for the first seven hours of every month.
function useAttention() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return useQuery({
    queryKey: financeKeys.attention(year, month),
    queryFn: ({ signal }) => financeAttention(year, month, signal),
    staleTime: 60_000,
  })
}

/// Bills that are recorded, not posted, and past their due date.
///
/// Recorded-and-not-posted is not by itself a problem — a bill can arrive, be
/// queried and be held on purpose. Past due while still unposted is the pair
/// that means somebody stopped.
///
/// Counted by the server over every bill. The browser used to count the page
/// of bills the list endpoint handed it, which is the same number until a
/// house has more unpaid bills than one page holds.
export function useOverdueBillCount(): number | null {
  const attention = useAttention()
  return attention.data?.overdue_bills ?? null
}

/// Meanings with no account behind them, counted per location.
///
/// Drawn as `bad` and not `warn`: every posting that needs one of these is
/// refused outright, so this is not a backlog, it is a stoppage.
export function useUnmappedMeaningCount(): number | null {
  const attention = useAttention()
  return attention.data?.unmapped_pairs ?? null
}

/// One, when this calendar month is not open for posting.
///
/// A count of one rather than a state, because the sidebar draws numbers. There
/// is exactly one current month and it is either open or it is not — a month
/// that has been sealed counts here too, since nothing can be posted into that
/// one either and the answer is the same: open the next one.
export function useMonthNotOpenCount(): number | null {
  const attention = useAttention()
  return attention.data?.month_not_open ?? null
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
  const attention = useAttention()
  return attention.data?.attention ?? null
}
