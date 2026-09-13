/// Typed search params, validated by the ROUTER rather than by each screen.
///
/// `lib/query-state.ts` reads the URL as `Record<string, unknown>` and every
/// caller writes `url.one("sort")` and hopes. For one screen that is fine. For
/// a module of fifteen it is fifteen places that each decide what an absent
/// value means, what a malformed one means, and which spelling of a key is
/// right — and they will not all decide the same way.
///
/// TanStack Router already owns this problem. `validateSearch` on a route runs
/// before the screen renders: it parses, applies defaults, drops what it does
/// not recognise, and hands the screen a typed object. A pasted URL with
/// `?dir=sideways` is normalised once, at the edge, instead of being guessed at
/// in three components.
///
/// ## Why a schema and not one hand-written validator per screen
///
/// Because the same four narrowings appear on nearly every list — a search box,
/// a set of ticked facets, a sort key with a direction, an open record — and
/// hand-writing them fifteen times is fifteen chances to spell `q` as `search`
/// on one screen. A screen declares which of them it has; the shapes come from
/// here.
///
/// The router is generated from `lib/nav.ts`, so a screen's schema travels with
/// its declaration — see `NavItem.search`.

/// One parameter's reader: raw value in, typed value out, never throwing.
///
/// Never throwing is deliberate. A URL is user input and is routinely wrong —
/// truncated by a chat client, edited by hand, left over from a previous
/// version of the screen. The answer to a bad value is the default, not a
/// crash: the reader came for the list.
export interface Param<T> {
  readonly read: (raw: unknown) => T
}

export const str = (fallback = ""): Param<string> => ({
  read: (raw) => (typeof raw === "string" && raw !== "" ? raw : fallback),
})

/// One of a fixed set, or the fallback. For a tab, a mode, a direction.
export const oneOf = <const T extends readonly string[]>(
  allowed: T,
  fallback: T[number],
): Param<T[number]> => ({
  read: (raw) =>
    typeof raw === "string" && (allowed as readonly string[]).includes(raw)
      ? (raw as T[number])
      : fallback,
})

/// A repeated key, always a list.
///
/// A single value arrives as a string and a repeated one as an array. A caller
/// that forgot gets `"BANK".length === 4` filters, which is the kind of bug
/// that looks like a backend fault.
export const list = (): Param<readonly string[]> => ({
  read: (raw) => {
    if (Array.isArray(raw)) return raw.filter((v) => typeof v === "string")
    if (typeof raw === "string" && raw !== "") return [raw]
    return []
  },
})

export const bool = (fallback = false): Param<boolean> => ({
  read: (raw) => (raw === "1" || raw === "true" ? true : fallback),
})

export const int = (fallback: number): Param<number> => ({
  read: (raw) => {
    const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(n) ? n : fallback
  },
})

/// A date as `YYYY-MM-DD`, or the fallback.
///
/// Shape-checked rather than parsed: `new Date("2026-02-31")` is a valid Date
/// in JavaScript and it is the third of March, which is not what anybody typed.
/// The server is the one that decides whether a date exists.
export const date = (fallback: () => string): Param<string> => ({
  read: (raw) =>
    typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : fallback(),
})

export type Schema = Readonly<Record<string, Param<unknown>>>

export type Values<S extends Schema> = {
  readonly [K in keyof S]: S[K] extends Param<infer T> ? T : never
}

/// Turn a schema into the `validateSearch` a route wants.
///
/// Keys not in the schema never reach the screen — provided the screen reads
/// its parameters through `useQueryState`, which asks the ROUTER for the
/// validated object rather than reading the address bar. A URL carrying
/// `?bogus=1` renders with `bogus` absent from what the component sees, so a
/// link cannot smuggle state a screen never declared.
///
/// The flip side is the rule this imposes: **a parameter a screen reads must be
/// declared here.** An undeclared key is not a key that quietly works — it is a
/// key the screen cannot see, and it will read its fallback and look as though
/// the URL was ignored.
///
/// The stray key does stay in the ADDRESS BAR until the next navigation
/// rewrites the query string, and that is worth being accurate about rather
/// than claiming a tidiness this does not deliver. What matters is that nothing
/// downstream can see it; the leftover text is cosmetic.
export function validator<S extends Schema>(schema: S) {
  return (raw: Record<string, unknown>): Values<S> => {
    const out: Record<string, unknown> = {}
    for (const [key, param] of Object.entries(schema)) {
      out[key] = param.read(raw[key])
    }
    return out as Values<S>
  }
}

/// Every parameter's default, as one object.
///
/// Handed to TanStack Router's `stripSearchParams` middleware so a value that
/// equals its default is kept OUT of the URL. Without it `validateSearch`
/// writes all seven back — `?q=&sort=default&dir=asc&panel=&status=&bill=` on a
/// screen nobody has narrowed — and the address bar stops being something
/// anybody reads or sends.
///
/// The screen still receives the defaults; only the URL is spared them. Those
/// are different questions and conflating them is what produced the noise.
export function defaultsOf<S extends Schema>(schema: S): Values<S> {
  const out: Record<string, unknown> = {}
  for (const [key, param] of Object.entries(schema)) {
    out[key] = param.read(undefined)
  }
  return out as Values<S>
}

/// The narrowings nearly every list has, so fifteen screens spell them alike.
///
/// Spread into a screen's own schema; a screen that does not sort simply omits
/// `sort` and `dir` and the router stops accepting them.
export const listParams = {
  /// The search box.
  q: str(),
  /// Sort key, as the SERVER names it. `default` means "however the server
  /// orders it" — which for most of these endpoints is the only order there is.
  sort: str("default"),
  dir: oneOf(["asc", "desc"] as const, "asc"),
  /// Which side panel is open, if any. In the URL so a filter panel survives a
  /// reload and can be linked to.
  panel: str(),
} as const
