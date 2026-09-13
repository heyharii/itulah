import { useCallback, useMemo } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"

/// A screen's narrowing, kept in the URL.
///
/// Search, filters, sort and the reporting date all live in the query string
/// rather than in `useState`, and it is not tidiness. It is four things a
/// business app is expected to do and cannot do from component state:
///
///   - **Send someone a link to what you are looking at.** "The four accounts
///     that disagree with the bank" is a message somebody wants to send, and
///     from local state the recipient gets an unfiltered list.
///   - **Come back to it.** A bookmark, a reopened tab, a browser restored
///     after a crash.
///   - **Undo a filter with Back.** From local state, Back leaves the screen
///     entirely — which is why people learn not to press it.
///   - **Reload without losing your place.**
///
/// `replace` for the ones that change while somebody types or clicks around,
/// so a search does not stack twenty history entries between the row they were
/// on and the screen they came from.
/// ## It reads the ROUTER's search, not the address bar's
///
/// `useSearch` hands back what the route's `validateSearch` produced — the
/// schema in `NavItem.search`, applied at the edge before the screen rendered.
/// `useRouterState(s => s.location.search)` would hand back the raw query
/// string instead, and the two differ in exactly the ways the schema exists to
/// settle: a key nobody declared, a `dir=sideways`, a repeated key that arrived
/// as a bare string.
///
/// This is why every parameter a screen reads must be declared in its
/// `search` schema. An undeclared key is not a key that works by default — it
/// is a key this hook cannot see, and the screen reads its fallback instead.
/// `strict: false` is what lets one hook serve every route; it widens the type,
/// it does not skip the validation.
export function useQueryState() {
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()

  const set = useCallback(
    (patch: Record<string, string | string[] | null>, replace = true) => {
      void navigate({
        to: ".",
        search: (current: Record<string, unknown>) => {
          const next = { ...current }
          for (const [key, value] of Object.entries(patch)) {
            // An empty value and an absent one mean the same thing to every
            // reader here, so only one of them is ever put in the URL. Two
            // spellings of "no filter" is two cache keys for one question.
            if (value === null || value.length === 0) delete next[key]
            else next[key] = value
          }
          return next
        },
        replace,
      })
    },
    [navigate],
  )

  const one = useCallback(
    (key: string, fallback = "") => {
      const value = search[key]
      return typeof value === "string" ? value : fallback
    },
    [search],
  )

  /// A repeated key, always as a list.
  ///
  /// A single value arrives as a string and a repeated one as an array, and a
  /// caller that forgot the difference gets `"BANK".length === 4` filters.
  const many = useCallback(
    (key: string): readonly string[] => {
      const value = search[key]
      if (Array.isArray(value))
        return value.filter((v) => typeof v === "string")
      if (typeof value === "string" && value !== "") return [value]
      return []
    },
    [search],
  )

  return useMemo(() => ({ one, many, set }), [one, many, set])
}
