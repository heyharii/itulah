/**
 * The filter model every list screen shares.
 *
 * Today each screen invents its own: the ledger has movement-kind chips, the
 * catalogue has a division list, permissions has module counts, customers has
 * tier counts. Same shape, twelve implementations, and every one of them
 * recomputes its own counts by hand over the row array.
 *
 * The idea is borrowed from openstatus's `data-table-filters`, whose useful
 * insight is not the components but the **schema**: declare a field once, and
 * derive the filter control, the URL encoding, and the counts from that one
 * declaration rather than restating them in three places.
 *
 * What this deliberately does not borrow: their state adapters (nuqs/zustand/
 * memory). This app already decided that filters live in the URL and that
 * TanStack Router owns it — rule S1. A second state mechanism would be a second
 * source of truth for the thing the URL is already the truth about.
 */

/** The kinds of filter a list can offer. */
export type FilterKind = "select" | "multi" | "range" | "dateRange" | "text" | "boolean"

interface FilterBase {
  /** The URL search param, and the server param name when it is server-side. */
  key: string
  label: string
  /**
   * Where this filter is answered.
   *
   * `server` sends it with the request. `client` narrows rows already held —
   * and is **only** valid over a list the client fully holds. Over a paged list
   * a client filter searches the page and reports the page's count as the
   * answer, which is the wrong-but-confident failure the list contract exists
   * to remove. See docs/list-contract.md §0.
   */
  where: "server" | "client"
}

export interface SelectFilter<T> extends FilterBase {
  kind: "select"
  options: () => FilterOption[]
  /** Reads the row's value for this field, for client filtering and counts. */
  valueOf: (row: T) => string | undefined
}

export interface MultiFilter<T> extends FilterBase {
  kind: "multi"
  options: () => FilterOption[]
  /** A row may carry several values — tags, roles, offers. */
  valuesOf: (row: T) => string[]
}

export interface RangeFilter<T> extends FilterBase {
  kind: "range"
  valueOf: (row: T) => number | undefined
  /** Rendered beside the bounds — `formatIDR` for money, `formatQty` for counts. */
  format?: (value: number) => string
}

export interface DateRangeFilter<T> extends FilterBase {
  kind: "dateRange"
  /** `YYYY-MM-DD`. */
  valueOf: (row: T) => string | undefined
}

export interface TextFilter<T> extends FilterBase {
  kind: "text"
  /** Everything this row matches on. Joined once, searched many times. */
  haystackOf: (row: T) => string
}

export interface BooleanFilter<T> extends FilterBase {
  kind: "boolean"
  valueOf: (row: T) => boolean
}

export type FilterField<T> =
  | SelectFilter<T>
  | MultiFilter<T>
  | RangeFilter<T>
  | DateRangeFilter<T>
  | TextFilter<T>
  | BooleanFilter<T>

export interface FilterOption {
  value: string
  label: string
  /** Optional colour for a status dot, matching the row's own treatment. */
  hue?: string
}

/** A count per option — what a facet is, without the word. */
export type FilterCounts = Map<string, number>

/**
 * How many rows each option would keep.
 *
 * Counted against the rows **the other filters have already narrowed**, not
 * against the whole list — otherwise a chip promises 40 results and delivers 3
 * because another filter is also on. That is the behaviour people expect from a
 * faceted filter and the reason hand-rolled counts are usually subtly wrong.
 */
export function countOptions<T>(
  field: FilterField<T>,
  rows: T[],
): FilterCounts {
  const counts: FilterCounts = new Map()

  for (const row of rows) {
    if (field.kind === "multi") {
      for (const value of field.valuesOf(row)) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      continue
    }
    if (field.kind === "select") {
      const value = field.valueOf(row)
      if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1)
      continue
    }
    if (field.kind === "boolean") {
      const value = String(field.valueOf(row))
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  }

  return counts
}

/** The active value of one filter, as it appears in the URL. */
export type FilterValue = string | string[] | [number, number] | boolean | undefined

export type FilterState = Record<string, FilterValue>

/**
 * Narrow rows by every `client` filter in the schema.
 *
 * Server filters are skipped here on purpose — they were already applied by the
 * request, and re-applying them would be a second, divergent implementation of
 * the same rule.
 */
export function applyClientFilters<T>(
  fields: FilterField<T>[],
  state: FilterState,
  rows: T[],
): T[] {
  const active = fields.filter(
    (field) => field.where === "client" && !isEmpty(state[field.key]),
  )
  if (active.length === 0) return rows

  return rows.filter((row) => active.every((field) => keeps(field, state[field.key], row)))
}

function isEmpty(value: FilterValue): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "string") return value.trim() === ""
  return false
}

function keeps<T>(field: FilterField<T>, value: FilterValue, row: T): boolean {
  switch (field.kind) {
    case "select":
      return field.valueOf(row) === value

    case "multi": {
      const wanted = Array.isArray(value) ? (value as string[]) : [String(value)]
      const held = field.valuesOf(row)
      /* Several selected values mean OR — the same as the list contract's
       * comma-separated server filter, so the two agree. */
      return wanted.some((item) => held.includes(item))
    }

    case "range": {
      const held = field.valueOf(row)
      if (held === undefined) return false
      const [min, max] = value as [number, number]
      return held >= min && held <= max
    }

    case "dateRange": {
      const held = field.valueOf(row)
      if (held === undefined) return false
      const [from, to] = value as unknown as [string, string]
      return (!from || held >= from) && (!to || held <= to)
    }

    case "text": {
      const needle = String(value).trim().toLowerCase()
      return field.haystackOf(row).toLowerCase().includes(needle)
    }

    case "boolean":
      return field.valueOf(row) === value
  }
}
