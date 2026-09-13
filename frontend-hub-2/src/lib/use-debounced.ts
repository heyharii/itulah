import { useEffect, useState } from "react"

/// A value that lags behind, so the thing reading it is asked fewer questions.
///
/// Used for search. The delay is not politeness toward the server — it is
/// about what the person can READ: a list that empties and refills on every
/// letter cannot be looked at while it is being typed into, and by the time it
/// settles they have already stopped trusting it.
///
/// 200ms is roughly the gap between deliberate keystrokes. Long enough that a
/// word is one request; short enough that nobody waits after the last letter.
export function useDebounced<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
