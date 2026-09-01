/**
 * The one shape a screen uses to say what it wants from a list.
 *
 * See `docs/list-contract.md` §3. Built from URL search params, so the URL stays
 * the source of truth for what the user is looking at, and dropped whole into a
 * query key, so changing a filter starts a different list rather than
 * continuing the old one.
 *
 * The reason this is a type and not a convention: filtering currently happens
 * in twelve screens as a post-fetch `.filter()`, which is correct over a list
 * the client fully holds and silently wrong over a paged one — it searches the
 * page and reports the page's count as the answer. Making the filter part of
 * the *request* is what removes that whole class of wrong-but-confident result.
 */

export type SortOrder = "asc" | "desc"

export interface ListSort {
  /** Must be on the handler's `SortWhitelist`; an unknown field falls back to
   *  its `DefaultSort` rather than erroring. */
  field: string
  order: SortOrder
}

/** A filter value. An array means OR: `status=open&status=held`. */
export type FilterValue = string | string[] | undefined

export interface ListQuery {
  /** Free text over the resource's searchable fields. */
  q?: string
  sort?: ListSort
  /** Domain-named filters: `location_id`, `status`, `store_id`, `period`, … */
  filters?: Record<string, FilterValue>
  /**
   * Inclusive date window. `date_from` / `date_to` are what `listparams`
   * parses; a resource using `listquery` takes `<key>_gte` / `<key>_lte`
   * instead and those go through `filters`.
   */
  dateFrom?: string
  dateTo?: string
  limit?: number
}

/**
 * The query-string params for a `ListQuery`, ready for `qs()`.
 *
 * Empty values are dropped rather than sent as empty strings — `q=` is a filter
 * that matches everything and nothing depending on the handler, and no endpoint
 * should have to decide which.
 */
export function listQueryParams(
  query: ListQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {}

  const text = query.q?.trim()
  if (text) params.q = text

  /* `sort_by` / `sort_dir`, not `sort` / `order`.
   *
   * These are the names `internal/cloud/_lib/listparams` already parses, and
   * `listquery.Schema` already whitelists. An earlier draft of this file
   * invented `sort` and `order` because a grep for `Query().Get("sort")` came
   * back empty — the estate reads them through the shared library rather than
   * off the request, so the grep missed a standard that already existed. */
  if (query.sort) {
    params.sort_by = query.sort.field
    params.sort_dir = query.sort.order
  }

  if (query.dateFrom) params.date_from = query.dateFrom
  if (query.dateTo) params.date_to = query.dateTo

  if (query.limit !== undefined) params.limit = query.limit

  for (const [key, value] of Object.entries(query.filters ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      /* Repeated keys are the contract's OR. `qs` takes one value per key, so
       * the joined form is used and the hub splits it — the two agree on comma
       * because no filter value in this estate contains one. */
      const present = value.filter(Boolean)
      if (present.length > 0) params[key] = present.join(",")
      continue
    }
    if (value) params[key] = value
  }

  return params
}

/**
 * A stable, flat key fragment for a `ListQuery`.
 *
 * Flat scalars rather than the object itself: a query key is hashed
 * structurally, and an inline object literal is only safe while every value in
 * it is stable. Sorting the filter entries makes two equivalent queries produce
 * one cache entry instead of two.
 */
export function listQueryKey(query: ListQuery): string {
  const parts: string[] = []
  const text = query.q?.trim()
  if (text) parts.push(`q=${text}`)
  if (query.sort) parts.push(`sort=${query.sort.field}:${query.sort.order}`)
  if (query.dateFrom) parts.push(`from=${query.dateFrom}`)
  if (query.dateTo) parts.push(`to=${query.dateTo}`)
  if (query.limit !== undefined) parts.push(`limit=${query.limit}`)

  const filters = Object.entries(query.filters ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => {
      const flat = Array.isArray(value) ? [...value].sort().join(",") : value
      return `${key}=${flat}`
    })
    .sort()

  return [...parts, ...filters].join("&")
}
