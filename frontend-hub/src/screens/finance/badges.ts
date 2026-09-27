import { useQuery } from "@tanstack/react-query"

import {
  checkoutExceptionKeys,
  listCheckoutExceptions,
} from "@/lib/queries/checkout-exceptions"
import {
  financeAttention,
  financeKeys,
  postingReadiness,
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
/// — to arrive at three integers. Counting belongs where the rows are. (The
/// gap count now comes from the readiness matrix; see
/// `useUnmappedMeaningCount`.)
///
/// What is lost is the warm cache on the three screens the badges point at:
/// they now fetch their own lists when opened. That is one request on the
/// screen that wants it, instead of three on every screen that does not.
///
/// Every hook answers `null` while its query is pending. Not `0`: "no bills are
/// overdue" and "we have not asked yet" are different facts, and a badge that
/// showed the second as the first would blink on at every page load.

// ---------------------------------------------------------------------------
// Posting readiness, counted once
// ---------------------------------------------------------------------------

/// The readiness matrix, under the key the Posting readiness screen and the
/// Account links screen both read — so the number on the sidebar and the
/// number on the screen it links to are one answer, not two derivations.
///
/// A (role, source, site) that resolves nowhere is a gap. That is the server's
/// count, taken over everything; the browser does not re-derive it.
export function usePostingReadiness() {
  return useQuery({
    queryKey: financeKeys.postingReadiness(),
    queryFn: ({ signal }) => postingReadiness(signal),
    staleTime: 60_000,
  })
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

/// Shoppers owed money because a branch took a charge and wrote no sale.
///
/// Its own query rather than a field on `useAttention`, and deliberately: this
/// count comes from the till fleet by sync, not from the books, and folding it
/// into the finance attention read would make one endpoint's latency the
/// sidebar's. The list endpoint already counts across everything that matched,
/// so this costs one small read and cannot disagree with the screen.
///
/// Amber and not red. A row here is somebody waiting for their money, which is
/// bad — but nothing is stopped by it, and the branch's own books balance. Red
/// is for a stoppage.
export function useUnansweredChargeCount(): number | null {
  const open = useQuery({
    queryKey: checkoutExceptionKeys.list(null, true),
    queryFn: ({ signal }) => listCheckoutExceptions(null, true, signal),
  })
  const count = open.data?.open_count ?? null
  // Nought is not a badge. A sidebar that draws a zero teaches people to read
  // past the number, and then the day it says 3 nobody notices.
  return count === null || count === 0 ? null : count
}

/// Roles with no account behind them, counted per (role, source, site).
///
/// Drawn as `bad` and not `warn`: every posting that needs one of these is
/// refused outright, so this is not a backlog, it is a stoppage.
///
/// From `posting-readiness` and not from `attention`: the readiness gaps are
/// the ones the Account links and Posting readiness screens show, and a badge
/// that counted a different set would send somebody to a screen that
/// disagreed with it. It costs the sidebar one more read than the other three.
export function useUnmappedMeaningCount(): number | null {
  const readiness = usePostingReadiness()
  return readiness.data?.gaps ?? null
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
  const readiness = usePostingReadiness()
  if (attention.data === undefined) return null
  // The server's `attention` counts the old pairs; the gaps are the
  // readiness matrix's, so the module row agrees with its own sub-item.
  return (
    attention.data.overdue_bills +
    attention.data.month_not_open +
    (readiness.data?.gaps ?? 0)
  )
}
