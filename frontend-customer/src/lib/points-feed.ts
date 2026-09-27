import { useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"

import { cacheKey, pointsAccount, type PointsEntry } from "@/lib/api"
import { useDocumentVisible } from "@/lib/motion"

/// The points ledger as a feed of things that happened to this member —
/// points earned, spent, taken back — and which of them this phone has shown.
///
/// "Seen" is a per-phone convenience, kept in `localStorage`: the badge on the
/// bell is about what THIS screen has told its holder, not a fact the centre
/// needs, and losing it (a private window, cleared site data) costs a badge
/// that lights up once too often — never a wrong balance. Every read and write
/// is guarded, because storage can throw in exactly those situations.

/// How often an open, visible app asks whether points have arrived. A member
/// standing at the counter with the app open should see the points from the
/// sale being rung up without doing anything; a phone in a pocket (hidden
/// tab) asks nothing at all.
export const FEED_POLL_MS = 15_000

const key = (memberId: string) => `itulah.points.seen.v1.${memberId}`

export function readSeen(memberId: string): number | null {
  try {
    const raw = localStorage.getItem(key(memberId))
    if (raw === null) return null
    const at = Number(raw)
    return Number.isFinite(at) ? at : null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

export function markSeen(memberId: string, at: number): void {
  const current = readSeen(memberId)
  if (current !== null && current >= at) return
  try {
    localStorage.setItem(key(memberId), String(at))
  } catch {
    // Storage refused. The badge will simply show again next time.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab of the same app marking things read.
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

/// The instant up to which this phone has shown the member their activity.
export function useSeen(memberId: string): number | null {
  return useSyncExternalStore(subscribe, () => readSeen(memberId))
}

export const at = (entry: PointsEntry) => Date.parse(entry.created_at)

export function newest(entries: readonly PointsEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, at(entry)), 0)
}

/// The points account, re-read on a short beat while the app is on screen.
export function usePointsFeed() {
  const visible = useDocumentVisible()
  return useQuery({
    queryKey: cacheKey.points(),
    queryFn: ({ signal }) => pointsAccount(signal),
    refetchInterval: visible ? FEED_POLL_MS : false,
  })
}

/// Entries this phone has not shown yet. Before anything has ever been marked
/// (`seen === null`) nothing counts as new: a phone paired today should not
/// greet its holder with a year of history as "unread".
export function unread(
  entries: readonly PointsEntry[] | undefined,
  seen: number | null,
): PointsEntry[] {
  if (entries === undefined || seen === null) return []
  return entries.filter((entry) => at(entry) > seen)
}
