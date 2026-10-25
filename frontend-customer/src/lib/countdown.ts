import { useEffect, useState } from "react"

/// The clock, as state.
///
/// A countdown is the one place this app reads the time while it renders, and
/// reading it inline would make two renders a millisecond apart disagree. So
/// the time lives in state and moves on a timer: every consumer re-renders once
/// a second, which is the resolution a person reading "4:32" can use.
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

/// Whole seconds left until `iso`, rounded up so "0" means gone and the first
/// second of a five-minute life reads 5:00 rather than 4:59.
export function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000))
}

/// 272 -> "4:32".
export function mmss(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}
