import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import type { SheetSearch } from "@/lib/sheets"
import { useDebounced } from "@/lib/use-debounced"
import {
  decodeState,
  encodeState,
  savedViews,
  subscribeViews,
  type ExplorerState,
} from "@/screens/sales/explorer-model"

/// The Explorer's view lives in the address bar, so one can be sent to a
/// colleague and the back button walks back through it.
///
/// **One key carries it.** The root route keeps only the search keys that
/// `lib/sheets.ts` names and drops the rest, so a `period`, a `group` and a
/// `metrics` of this screen's own would not survive a navigation. `f` — the
/// filter bar's key, which nothing on this screen reads — holds the whole view
/// as a small query string of its own (`explorer-model.ts`), and `q` holds the
/// search, which is what `q` means everywhere else. When the registry grows
/// keys for this screen, only `encodeState` and `decodeState` need to change.
export function useExplorerState() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SheetSearch
  const raw = search.f
  const q = search.q ?? ""
  const state = useMemo(() => decodeState(raw), [raw])

  /// Change the view. `next` is applied to the view as the address bar holds it
  /// at that moment, not as the last render saw it, so two changes in one
  /// breath do not undo each other. A step the person may want to come back
  /// from (a drill, a quick view, a grouping) pushes; the tweaks replace.
  const update = useCallback(
    (
      next: (state: ExplorerState) => ExplorerState,
      push = false,
      /// The search in the same step, where the change takes the rows it was
      /// typed at away.
      query?: string
    ) => {
      void navigate({
        to: ".",
        replace: !push,
        search: (prev: SheetSearch) => {
          const encoded = encodeState(next(decodeState(prev.f)))
          return {
            ...prev,
            f: encoded === "" ? undefined : encoded,
            ...(query === undefined
              ? {}
              : { q: query === "" ? undefined : query }),
          }
        },
      })
    },
    [navigate]
  )

  const setQuery = useCallback(
    (value: string) => {
      void navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({
          ...prev,
          q: value === "" ? undefined : value,
        }),
      })
    },
    [navigate]
  )

  return { state, q, update, setQuery }
}

/// The views this browser has kept.
export function useSavedViews() {
  return useSyncExternalStore(subscribeViews, savedViews, savedViews)
}

/// The search box's own text, written to the address bar a quarter of a second
/// after the last key. Held in the box and not in the screen, so a letter typed
/// does not draw the whole table again.
export function useSearchBox(
  q: string,
  setQuery: (value: string) => void
): readonly [string, (value: string) => void] {
  const [needle, setNeedle] = useState(q)
  const [seen, setSeen] = useState(q)
  // The address moved on its own (the back button): the box follows it.
  if (q !== seen) {
    setSeen(q)
    setNeedle(q)
  }
  const settled = useDebounced(needle, 250)
  useEffect(() => {
    if (settled === needle && settled !== q) setQuery(settled)
  }, [settled, needle, q, setQuery])
  return [needle, setNeedle]
}
