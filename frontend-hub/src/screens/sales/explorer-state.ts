import {
  useLocation,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router"
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
  askedGroup,
  decodeState,
  encodeState,
  groupOfPage,
  PAGE_OF,
  savedViews,
  subscribeViews,
  type ExplorerState,
  type SavedView,
} from "@/screens/sales/explorer-model"

/// The view a page and its `f` describe: the page decides the rows.
export function stateAt(path: string, raw: string | undefined): ExplorerState {
  const state = decodeState(raw)
  return { ...state, group: groupOfPage(path, askedGroup(raw)) ?? state.group }
}

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
///
/// **The page is the rows** (owner, 16 Oct 2026): each grouping has its own
/// row in the Sales sidebar (`PAGE_OF`), so the grouping is read off the path
/// and `f` says it only where a page holds two (Summary's days). A change that
/// lands on other rows — a drill, a step back, a saved view — goes to their
/// page, carrying the period and the filters.
export function useExplorerState() {
  const navigate = useNavigate()
  const router = useRouter()
  const pathname = useLocation({ select: (location) => location.pathname })
  const search = useSearch({ strict: false }) as SheetSearch
  const raw = search.f
  const q = search.q ?? ""
  const state = useMemo(() => stateAt(pathname, raw), [pathname, raw])

  /// Change the view. `next` is applied to the view as the address bar holds it
  /// at that moment (`latestLocation`), not as the last render saw it, so two
  /// changes in one breath do not undo each other. A step the person may want
  /// to come back from (a drill, a tab, a period) pushes; the tweaks replace.
  const update = useCallback(
    (
      next: (state: ExplorerState) => ExplorerState,
      push = false,
      /// The search in the same step, where the change takes the rows it was
      /// typed at away.
      query?: string
    ) => {
      const at = router.latestLocation
      const prev = at.search as SheetSearch
      const target = next(stateAt(at.pathname, prev.f))
      const to = PAGE_OF[target.group]
      const encoded = encodeState(target, groupOfPage(to) ?? target.group)
      const f = encoded === "" ? undefined : encoded
      const q = query === undefined ? prev.q : query === "" ? undefined : query
      if (to === at.pathname) {
        void navigate({
          to: ".",
          replace: !push,
          search: (now: SheetSearch) => ({ ...now, f, q }),
        })
        return
      }
      // Another page: only the view travels, not what was open on this one.
      void navigate({ to, replace: !push, search: { f, q } } as never)
    },
    [navigate, router]
  )

  // A link from before the groupings had pages (`/sales/explorer?f=g%3Dsku`)
  // names rows another page holds: it is sent there, as it was.
  const asked = askedGroup(raw)
  useEffect(() => {
    if (asked === null || PAGE_OF[asked] === pathname) return
    update((s) => ({ ...s, group: asked }))
  }, [asked, pathname, update])

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

/// What the server (which has no browser storage) and the browser's first
/// render, while it hydrates, both draw: no views. The ones this browser has
/// kept join right after.
const NO_VIEWS: readonly SavedView[] = []

/// The views this browser has kept.
export function useSavedViews() {
  return useSyncExternalStore(subscribeViews, savedViews, () => NO_VIEWS)
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
