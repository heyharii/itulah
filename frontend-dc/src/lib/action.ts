import { useCallback, useState } from "react"

/// An action with the two states a person needs to see: it is going, and it
/// failed.
///
/// Written once because every operations screen is a queue of writes, and each
/// one of them can be refused for a reason worth reading — a box already
/// sealed, a count the same person took, a piece no allotment line wants.
export function useAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setPending(true)
    setError(null)
    try {
      await work()
      return true
    } catch (caught) {
      setError(caught)
      return false
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, error, run, clear: () => setError(null) }
}
