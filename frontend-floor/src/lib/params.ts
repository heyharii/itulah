import { useNavigate, useRouter, useSearch } from "@tanstack/react-router"
import { useState } from "react"

/// The screen state that belongs in the URL, named once.
///
/// A phone on a floor is **reloaded**, constantly: it sleeps in a pocket, the OS
/// kills the tab to reclaim memory, somebody pulls down to refresh because the
/// wifi looked stuck. A record held in component state — which order is being
/// counted, which carton is open — is gone every time, mid-job, with a lorry
/// waiting. So the record is in the address bar.
///
/// Kept small on purpose. Anything transient — what is half-typed in the scan
/// box, which row is highlighted — stays in state, because a URL that changes on
/// every keystroke is a history nobody can go back through.

/// Text that may be all digits, which is not the same as a string.
///
/// Router's default search parser runs each value through `JSON.parse`, so
/// `?po=4400012` arrives as the **number** 4400012 rather than the string. Every
/// SKU in this fleet is eleven digits and most document numbers are numeric, so
/// nearly every link here hits this — and it fails in the quietest possible way:
/// the number renders identically in a template, so a screen prints the right
/// code in its own error message while `row.po_number === value` is false
/// against every row it holds.
function text(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value
  // Only a finite number becomes text. `Infinity` and `NaN` are what
  // `JSON.parse` yields for a malformed URL, and neither is a record.
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/// One of a fixed set. Anything else is dropped rather than passed on: a
/// segmented control set to a slice that does not exist is a blank screen with
/// no way back to a full one.
function oneOf<const T extends readonly string[]>(allowed: T) {
  return (value: unknown): T[number] | undefined =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : undefined
}

export const PARAMS = {
  /// The purchase order a count sheet or a verification is against. An order,
  /// not a delivery document: the person on the bay is looking at a lorry and a
  /// stack of paper with a PO number on it, and the delivery document is
  /// something this app opens for them.
  po: text,
  /// The shop a pack sheet is filling for.
  toko: text,
  /// The one record a pushed screen or a station's sheet is showing — a pick
  /// round, a carton, a dispatch, a stock take, a tagging job. One key rather
  /// than five, because either shows exactly one thing and the path already
  /// says what kind.
  id: text,
  /// The rack picking is taking stock off. In the URL because it survives the
  /// phone sleeping mid-round, and because a pick written against the wrong pool
  /// is a movement out of stock that was never there.
  rak: text,
  /// Which slice of a station's screen is showing.
  lihat: oneOf([
    "hitung",
    "periksa",
    "antre",
    "koli",
    "kiriman",
    "truk",
    "berjalan",
    "selesai",
  ] as const),
} as const

export type ParamKey = keyof typeof PARAMS

export type Search = {
  [K in ParamKey]?: ReturnType<(typeof PARAMS)[K]>
}

/// The root route's `validateSearch`.
///
/// Unknown keys are dropped rather than preserved: a URL is a public surface,
/// and letting arbitrary parameters ride along means a stale link keeps
/// resurrecting state nothing reads any more.
export function validateSearch(raw: Record<string, unknown>): Search {
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(PARAMS)) {
    const value = check(raw[key])
    if (value !== undefined) out[key] = value
  }
  return out as Search
}

/// Read and write one parameter.
///
/// `replace: true` on write: these are a screen's own controls — which slice is
/// showing, which rack is selected — and pressing back should leave the screen
/// rather than walking back through every setting somebody tried.
export function useParam<K extends ParamKey>(key: K) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Search
  return {
    value: search[key],
    set: (next: Search[K] | undefined) =>
      void navigate({
        to: ".",
        replace: true,
        search: (previous: Search) => ({ ...previous, [key]: next }),
      }),
  }
}

declare module "@tanstack/history" {
  interface HistoryState {
    /// Which sheet pushed this entry — see `useSheetParam`.
    sheet?: ParamKey
  }
}

/// A station's sheet whose record is in the URL — the order being counted, the
/// shop being packed for — opened so that the phone's back button closes it.
///
/// `useParam` replaces, which is right for a slice or a rack and wrong here:
/// on Android the hardware back button is how a sheet is put away, and with
/// the sheet written over the list's own entry that press left the station
/// altogether, with the count still on the glass a moment before. So opening
/// PUSHES an entry, marked as this sheet's, and closing goes back through it —
/// the swipe, the save and the back button all end on the same entry.
///
/// A sheet reached cold — a reload, a pasted link — has no entry of its own
/// behind it, so closing replaces instead; going back from there would leave
/// the app. Moving from one record to the next while the sheet is up replaces
/// too, so back is one press however many orders somebody looked at.
///
/// Closed at once, not when the URL catches up. `history.back()` lands on a
/// later `popstate`, and Base UI's drawer checks on the very next frame whether
/// its dismiss was taken — a sheet still open then is put back, so a swipe
/// would bounce up before sliding away. So the record being closed reads as
/// gone the moment `close()` is called, and a second `close()` before the first
/// lands does nothing rather than stepping back out of the station.
export function useSheetParam<K extends ParamKey>(key: K) {
  const navigate = useNavigate()
  const router = useRouter()
  const search = useSearch({ strict: false }) as Search
  const [closing, setClosing] = useState<Search[K]>(undefined)
  const current = search[key]
  // Only while the URL still names the record being closed: the moment it
  // changes — the back landed, or another record was opened — this lapses.
  const shut = closing !== undefined && closing === current
  // Once the URL has moved on, forget it — or the same record opened again
  // later (a second look at the same order, the forward button) would read as
  // still being closed and never rise.
  if (closing !== undefined && closing !== current) setClosing(undefined)
  return {
    value: shut ? undefined : current,
    open: (next: NonNullable<Search[K]>) => {
      setClosing(undefined)
      void navigate({
        to: ".",
        replace: search[key] !== undefined,
        search: (previous: Search) => ({ ...previous, [key]: next }),
        state: (previous) => ({ ...previous, sheet: key }),
      })
    },
    close: () => {
      if (current === undefined || shut) return
      setClosing(current)
      const here = router.state.location
      if (here.state.sheet === key && router.history.canGoBack()) {
        router.history.back()
        return
      }
      void navigate({
        to: ".",
        replace: true,
        search: (previous: Search) => ({ ...previous, [key]: undefined }),
      })
    },
  }
}
