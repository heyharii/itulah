/**
 * Reads any list response into the one shape the tables consume.
 *
 * See `docs/list-contract.md`. The hub is mid-migration onto that contract, so
 * this understands the target envelope and today's eleven variations of it, and
 * — this is the point — refuses to guess where the old shape is genuinely
 * ambiguous.
 *
 * The ambiguity is not theoretical. `total` is used for two different things in
 * the Go tree: the size of the whole result set (~44 sites) and the size of the
 * page just returned (~17 sites). A client cannot tell them apart from the
 * response alone. Treating the second as the first is what let four screens ship
 * a silent cap: `total > items.length` is false when `total === items.length`,
 * so the client concluded nothing had been withheld exactly where it could not
 * know.
 *
 * So: when `total` equals the row count, this reports the total as **unknown**
 * rather than as "that was everything". A UI can honestly say "50 shown"; it
 * cannot honestly say "50 of 50" on a number that might be a page length.
 */

/** The array keys the hub currently uses, in the order they are tried. */
const ARRAY_KEYS = [
  "items",
  "data",
  "rows",
  "results",
  "entries",
  "records",
] as const

export interface ListEnvelope<T> {
  items: T[]
  /** Rows in this response. */
  count: number
  /**
   * Rows matching the filter across the whole result set, or `undefined` when
   * the server did not say — or said something this client cannot trust.
   */
  total: number | undefined
  /** Opaque. `null` means the list is exhausted; this is the ONLY end signal. */
  nextCursor: string | null
  /**
   * True only when the client is *certain* more rows exist. Uncertainty reads
   * as `false` here and is carried by `total === undefined` instead, so a
   * caller never pages forever against a number it invented.
   */
  hasMore: boolean
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export interface ReadEnvelopeOptions {
  /** Rows already held, to derive a cursor from an offset-paged endpoint. */
  offset?: number
  /**
   * `X-Total-Count`, when the caller captured it.
   *
   * The hub's own `listparams.ApplyInMemory` leaves the body as a bare array
   * and conveys the total in this header instead. Without it, such a response
   * looks like "here is everything" — the same wrong-but-confident answer this
   * reader exists to prevent, arriving through a different door.
   */
  totalCount?: number | string | null
}

export function readListEnvelope<T>(
  payload: unknown,
  options: number | ReadEnvelopeOptions = {},
): ListEnvelope<T> {
  const { offset = 0, totalCount } =
    typeof options === "number" ? { offset: options, totalCount: undefined } : options

  const headerTotal =
    typeof totalCount === "number"
      ? totalCount
      : typeof totalCount === "string" && totalCount.trim() !== ""
        ? Number(totalCount)
        : undefined
  const trustedHeaderTotal =
    headerTotal !== undefined && Number.isFinite(headerTotal) ? headerTotal : undefined

  if (Array.isArray(payload)) {
    /* A bare array carries no paging information in its body — but the hub's
     * in-memory pager puts the total in a header, so the array alone is not
     * evidence that this was everything. */
    const items = payload as T[]
    const more =
      trustedHeaderTotal !== undefined && offset + items.length < trustedHeaderTotal
    return {
      items,
      count: items.length,
      total: trustedHeaderTotal ?? (offset === 0 ? items.length : undefined),
      nextCursor: more ? String(offset + items.length) : null,
      hasMore: more,
    }
  }

  const root = asRecord(payload)
  if (!root) {
    return { items: [], count: 0, total: 0, nextCursor: null, hasMore: false }
  }

  const items = findItems<T>(root)
  const page = asRecord(root.page)

  const count = num(page?.count) ?? num(root.count) ?? items.length

  /* The trust rule. A `total` equal to the row count is exactly the shape the
   * two meanings share, so it is not evidence of either. */
  /* A header total is unambiguous by construction — it is only ever the whole
   * result set — so it outranks a body `total` whose meaning varies. */
  const claimedTotal = trustedHeaderTotal ?? num(page?.total) ?? num(root.total)
  const total =
    trustedHeaderTotal !== undefined || page?.total !== undefined
      ? (claimedTotal ?? undefined) // header and `page.total` are unambiguous
      : claimedTotal === undefined || claimedTotal === items.length
        ? undefined
        : claimedTotal

  const explicitCursor =
    str(page?.next_cursor) ?? str(root.next_cursor) ?? str(root.after) ?? null

  /* Several offset-paged endpoints already answer the only question that
   * matters — `inventory/balances` and `inventory/movements` both return
   * `has_more` — without offering a cursor. That flag is worth more than an
   * ambiguous `total`, because it is about this request rather than about a
   * count whose meaning varies by handler. */
  const declaredMore = bool(page?.has_more) ?? bool(root.has_more)

  /* Without a cursor, the next offset can be inferred from `has_more`, or from
   * a total that survived the trust rule above — and from nothing else. */
  const moreByTotal = total !== undefined && offset + items.length < total
  const hasAnotherPage = declaredMore ?? moreByTotal

  const derivedCursor =
    explicitCursor === null && hasAnotherPage && items.length > 0
      ? String(offset + items.length)
      : null

  const nextCursor = explicitCursor ?? derivedCursor

  return { items, count, total, nextCursor, hasMore: nextCursor !== null }
}

/**
 * The rows, from `items` or from whichever bespoke key this endpoint uses.
 *
 * Falling back to "the first array-valued property" is deliberate: 29 endpoints
 * name their array after the resource (`locations`, `suppliers`, `balances`,
 * `movements`, …), and enumerating all of them here would mean editing this
 * file every time the hub grows a route.
 */
function findItems<T>(root: Record<string, unknown>): T[] {
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(root[key])) return root[key] as T[]
  }
  for (const value of Object.values(root)) {
    if (Array.isArray(value)) return value as T[]
  }
  return []
}
