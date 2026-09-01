/**
 * Binds a filter schema to the URL and to the rows.
 *
 * The URL stays the source of truth (rule S1) — this hook does not hold filter
 * state, it reads and writes the route's search params. That is why a filtered
 * view can be pasted into a message and open the same way for someone else,
 * and why Back undoes a filter instead of leaving the app.
 */

import { useMemo } from "react"

import {
  applyClientFilters,
  countOptions,
  type FilterCounts,
  type FilterField,
  type FilterState,
  type FilterValue,
} from "./model"

export interface UseFiltersResult<T> {
  /** Rows after every client-side filter in the schema. */
  rows: T[]
  /** The active value per filter key, straight off the URL. */
  state: FilterState
  /** Set one filter. `undefined` clears it. Always a `replace` navigation. */
  set: (key: string, value: FilterValue) => void
  clear: () => void
  /** How many filters are on — for a "Clear (3)" affordance. */
  activeCount: number
  /**
   * Per-option counts, computed against the rows the *other* filters already
   * narrowed. A chip that says 40 and delivers 3 is worse than no count.
   */
  countsFor: (key: string) => FilterCounts
}

export interface UseFiltersOptions<T> {
  fields: FilterField<T>[]
  rows: T[]
  /** The route's current search params. */
  search: Record<string, unknown>
  /** The route's navigate, already bound with `from`. */
  navigate: (options: {
    search: (prev: Record<string, unknown>) => Record<string, unknown>
    replace?: boolean
  }) => void
}

export function useFilters<T>({
  fields,
  rows,
  search,
  navigate,
}: UseFiltersOptions<T>): UseFiltersResult<T> {
  const state = useMemo<FilterState>(() => {
    const next: FilterState = {}
    for (const field of fields) next[field.key] = search[field.key] as FilterValue
    return next
  }, [fields, search])

  const filtered = useMemo(
    () => applyClientFilters(fields, state, rows),
    [fields, state, rows],
  )

  const set = (key: string, value: FilterValue) => {
    /* `replace`, because changing a filter is not a new destination — thirty
     * keystrokes in a search box should not be thirty history entries the Back
     * button has to walk through. Rule S3. */
    navigate({
      search: (prev) => ({ ...prev, [key]: isEmpty(value) ? undefined : value }),
      replace: true,
    })
  }

  const clear = () => {
    navigate({
      search: (prev) => {
        const next = { ...prev }
        for (const field of fields) next[field.key] = undefined
        return next
      },
      replace: true,
    })
  }

  const countsFor = (key: string): FilterCounts => {
    const field = fields.find((candidate) => candidate.key === key)
    if (!field) return new Map()

    /* Counted against the rows every *other* filter has already narrowed, so a
     * count answers "how many would this add" rather than "how many exist
     * somewhere in the dataset". */
    const others = fields.filter((candidate) => candidate.key !== key)
    const narrowed = applyClientFilters(others, state, rows)
    return countOptions(field, narrowed)
  }

  const activeCount = fields.filter((field) => !isEmpty(state[field.key])).length

  return { rows: filtered, state, set, clear, activeCount, countsFor }
}

function isEmpty(value: FilterValue): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "string") return value.trim() === ""
  return false
}
