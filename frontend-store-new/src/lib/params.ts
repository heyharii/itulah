import { useNavigate, useSearch } from "@tanstack/react-router"

/// The screen state that belongs in the URL, named once.
///
/// The console holds "which record is open" in the address bar because a sheet
/// in `useState` cannot be sent to a colleague. A till has a blunter reason for
/// the same rule: **it is reloaded.** The tablet sleeps and wakes, the browser
/// is killed by the OS, somebody reloads because the wifi looked stuck — and a
/// receipt or a report window held in component state is gone every time,
/// mid-shift, with a customer waiting.
///
/// Kept small on purpose. Anything transient — what is half-typed in the search
/// box, which tender chip is highlighted — stays in state, because a URL that
/// changes on every keystroke is a history nobody can go back through.

/// Which sale's receipt is being read. A local queue id, not a node id: the
/// receipt has to be reachable before the node has ever seen the sale.
function id(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/// A whole positive number carried as text — how many days a report covers.
function counted(value: unknown): string | undefined {
  return typeof value === "string" && /^[1-9]\d{0,3}$/.test(value)
    ? value
    : undefined
}

/// One of a fixed set. Anything else is dropped rather than passed on: the
/// value reaches the node as a grouping, and `?bucket=fortnight` is a 400
/// dressed up as a link.
function oneOf<const T extends readonly string[]>(allowed: T) {
  return (value: unknown): T[number] | undefined =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : undefined
}

export const PARAMS = {
  /// The sale whose receipt is open, by its queue id.
  sale: id,
  /// How many days the report covers, ending today.
  span: counted,
  /// How the series is grouped.
  bucket: oneOf(["day", "week", "month"] as const),
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
/// `replace: true` on write, unlike the console's sheets: these are a screen's
/// own controls — the span a report covers, the bucket it is grouped by — and
/// pressing back should leave the screen rather than walking through every
/// setting somebody tried.
export function useParam<K extends ParamKey>(key: K) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Search
  return {
    value: search[key],
    set: (next: Search[K] | undefined) =>
      navigate({
        to: ".",
        replace: true,
        search: (previous: Search) => ({ ...previous, [key]: next }),
      }),
  }
}
