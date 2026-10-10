import { useCallback, useMemo, useState } from "react"

/// Which groups of a phone list are folded — the state behind a `GroupHeading`
/// that opens and closes its cards. Every group starts open.
export function useFolded<K = string>() {
  const [folded, setFolded] = useState<ReadonlySet<K>>(() => new Set())
  const has = useCallback((key: K) => folded.has(key), [folded])
  const toggle = useCallback(
    (key: K) =>
      setFolded((was) => {
        const next = new Set(was)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    []
  )
  return useMemo(() => ({ has, toggle }), [has, toggle])
}
