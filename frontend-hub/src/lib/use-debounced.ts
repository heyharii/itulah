import { useEffect, useState } from "react"

/// A value that lags behind, so an expensive question is not asked per
/// keystroke.
///
/// Written for the pricelist, whose search reaches a server that prices every
/// matching style across every shop — a request measured in hundreds of
/// milliseconds, where typing a six-letter word unthrottled means six of them,
/// five of which are already stale when they land.
///
/// Deliberately NOT a debounce on the request. Debouncing the fetch would
/// leave the query key changing on every keystroke, so React Query would still
/// see six distinct questions and cache six answers; delaying the VALUE means
/// there is only ever one question, asked once, and the cache holds what a
/// person actually searched for.
///
/// The first value is returned immediately rather than after the delay: the
/// screen's initial load is not a keystroke, and waiting out the timer before
/// the first request would make every arrival feel slow.
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (value === settled) return
    const timer = setTimeout(() => setSettled(value), delay)
    // Cleared on the next change, which is what makes it a debounce rather
    // than a throttle: the timer restarts while somebody is still typing, and
    // fires once they stop.
    return () => clearTimeout(timer)
    // `settled` is read to skip a no-op timer, not to re-run when it changes —
    // listing it would schedule a second timer on every settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay])

  return settled
}
