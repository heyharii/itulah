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

/// Text that may be all digits, which is not the same as `id` above.
///
/// Router's default search parser runs each value through `JSON.parse`, so
/// `?sku=31001101001` arrives as the **number** 31001101001 rather than the
/// string. Every SKU in this fleet is eleven digits (see the EPC codec), so
/// every product link hits this — and it fails in the quietest possible way:
/// `31001101001` renders identically in a template, so a screen prints the
/// right code in its own error message while `row.sku_code === value` is false
/// against every row in the book. The screen then says the shop does not sell a
/// garment it plainly sells.
///
/// A search box has the same problem the moment somebody types a code into it,
/// which on a shop floor is most of the time.
function text(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value
  // Only a finite number becomes text. `Infinity` and `NaN` are what
  // `JSON.parse` yields for a malformed URL, and neither is a product.
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

/// A whole positive number carried as text — how many days a report covers.
function counted(value: unknown): string | undefined {
  return typeof value === "string" && /^[1-9]\d{0,3}$/.test(value)
    ? value
    : undefined
}

/// A calendar day, `YYYY-MM-DD`, which is how every date on the wire is
/// spelled. Checked rather than passed through: the value reaches head office
/// as a `NaiveDate`, and `?week=next` is a 400 dressed up as a link.
function day(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
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
  /// The product a catalogue drill-in is showing.
  ///
  /// In the URL rather than in state for this screen's own reason: a shop
  /// floor reads a price off a tablet that then sleeps in somebody's hand, and
  /// a detail held in `useState` is gone when it wakes. It also makes the
  /// screen linkable from the counter — "look at 30101010001" — which is how
  /// somebody at the till answers somebody on the floor.
  sku: text,
  /// What is typed into the catalogue's search box.
  ///
  /// The exception to the rule below, and it is deliberate: this one is
  /// debounced into the URL rather than written on every keystroke, so the
  /// history stays walkable while a filtered catalogue stays a thing that
  /// survives a reload.
  q: text,
  /// Which part of the range the catalogue is narrowed to.
  division: text,
  /// Whether the catalogue draws one card per article or one per SKU.
  view: oneOf(["article", "sku"] as const),
  /// The Stock screens' record sheets, one key each, so a reload keeps the
  /// sheet that was open and a back gesture closes it: a pool (`store-01.floor`),
  /// a count, an inbound delivery, a ledger movement, a return request.
  pool: text,
  count: text,
  delivery: text,
  movement: text,
  returning: text,
  /// How many days the report covers, ending today.
  span: counted,
  /// How the series is grouped.
  bucket: oneOf(["day", "week", "month"] as const),
  /// The first day of the week the roster is showing.
  ///
  /// In the URL for this surface's own reason rather than the console's: a
  /// manager looks at next week's rota on a tablet that then sleeps in their
  /// hand, and a week offset held in `useState` is back to this week when it
  /// wakes. It is also what makes "look at the week of the 21st" a thing one
  /// person can send another.
  week: day,
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
