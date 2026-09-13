import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { api, search } from "@/lib/api"

/// The two shapes a list comes back in, and why there are two.
///
/// This app's rule is that the server narrows the list — see `lib/table.ts` for
/// what goes wrong when a browser sorts a page it only half has. An endpoint
/// keeps that bargain by taking `q`, facets, `sort`, `dir`, `cursor` and
/// `limit`, and answering with an envelope carrying `next_cursor`, `total` and
/// facet counts. `GET /finance/money` was the first; bills, payments and the
/// workforce have since been brought up to the same shape, and they are the
/// lists people actually read all day.
///
/// What remains on the old shape is a **bare JSON array** with a `limit` the
/// server clamps: no cursor, no total, no search, no sort — bank statements and
/// statement sources. That is not a style difference. It means the screen
/// cannot say "50 of 1,284", cannot page, and **cannot tell whether the answer
/// was cut off**.
///
/// So there are two hooks with two names, and the names are the point. A screen
/// picks the one its endpoint can actually honour, and the one it picked is
/// legible at the call site. A single `useList` that quietly did less against a
/// weaker endpoint is how a truncated list gets shipped looking complete.
///
/// ## What to do about the rest
///
/// Bring them up to the same shape. The work is not a design — it is the same
/// `Scope` struct, the same keyset cursor, the same envelope, written four
/// times now in `backend/src/cloud/http/finance.rs` and
/// `.../postgres/employment.rs`. Until then `useBoundedList` reports
/// `truncated` and every screen using it says so on the page.

/// The envelope a proper list endpoint answers with.
export interface Page<Row> {
  readonly rows: readonly Row[]
  readonly next_cursor: string | null
  /// How many rows match, over the whole set — not this page.
  readonly total: number
}

export type Params = Readonly<
  Record<string, string | number | boolean | null | undefined>
>

/// How to read an envelope that is spelled differently.
///
/// Both hooks take one, and neither needs it for anything in Finance or People:
/// those routes serialise a Rust struct, so the envelope is `rows`,
/// `next_cursor` and `total` because that is what the struct is called.
///
/// **Every route under `/api/v1/inventory` answers with a `json!()` literal
/// instead**, and the literals say `items`, and the one that pages says
/// `total_items`. That is not a second design — it is the same keyset cursor
/// and the same matched total under two other keys, and
/// `GET /inventory/availability` is a better-behaved list than half of Finance:
/// `cursor` on `sku_code`, `q` on the server, a `COUNT(*) OVER()` total.
///
/// The alternative was for those screens to call `useInfiniteQuery` themselves,
/// which is how one list quietly stops reporting `truncated` and another
/// forgets to put a filter in the cache key. A reader function is the smaller
/// thing to have: it is pure, it is written beside the screen that needs it,
/// and it is deliberately NOT part of the query key — it reads the answer, it
/// does not change which answer was asked for.
export type Unpack<T> = (body: unknown) => T

/// A list from an endpoint that pages: cursor in, envelope out.
///
/// Use this wherever the server can honour it. Everything that narrows the
/// list belongs in `params`, and every one of those is part of the cache key —
/// a key that ignored a filter would answer a filtered question with an
/// unfiltered page.
export function useCursorList<Row>({
  key,
  path,
  params,
  limit = 50,
  enabled,
  unpack,
}: {
  /// The cache key's stem, e.g. `["finance", "money"]`. The params are appended
  /// for you, so a screen cannot forget one of them.
  key: readonly unknown[]
  path: string
  params: Params
  limit?: number
  enabled?: boolean
  /// For an endpoint whose envelope is not `{ rows, next_cursor, total }` —
  /// see `Unpack`. Absent means the body already is one.
  unpack?: Unpack<Page<Row>>
}) {
  const query = useInfiniteQuery({
    queryKey: [...key, params, limit] as const,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const body = await api.get<unknown>(
        `${path}${search({ ...params, cursor: pageParam, limit })}`,
        signal,
      )
      return unpack ? unpack(body) : (body as Page<Row>)
    },
    getNextPageParam: (last) => last.next_cursor,
    // Keep the rows on screen while the next question is answered. Without it
    // every tick of a filter blanks the table and shoves the panel's own counts
    // around under the cursor.
    placeholderData: (previous) => previous,
    enabled,
  })

  const pages = useMemo(() => query.data?.pages ?? [], [query.data])
  const rows = useMemo(() => pages.flatMap((page) => page.rows), [pages])

  return {
    query,
    rows,
    /// Over the whole matched set, from the FIRST page — every page carries the
    /// same number and the first one is already there, so the figure does not
    /// flicker as later pages land.
    total: pages[0]?.total ?? 0,
    head: pages[0],
    truncated: false as const,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: query.fetchNextPage,
  }
}

/// A list from an endpoint that does NOT page: one request, a bare array, a cap.
///
/// `truncated` is the whole reason this exists. When the server returns exactly
/// as many rows as were asked for, the honest reading is "there may be more and
/// this endpoint cannot say" — so the screen is told, and says so. A list that
/// stops at 500 rows without mentioning it is the defect this hook is shaped to
/// prevent.
export function useBoundedList<Row>({
  key,
  path,
  params,
  limit = 500,
  enabled,
  unpack,
}: {
  key: readonly unknown[]
  path: string
  params: Params
  /// The server clamps this too, and asking for more is answered with the
  /// clamp and no complaint — which is exactly why `truncated` is derived from
  /// the row count rather than believed from the request.
  limit?: number
  enabled?: boolean
  /// For an endpoint that wraps its array in an object — see `Unpack`. Absent
  /// means the body already is the array.
  unpack?: Unpack<Row[]>
}) {
  const query = useQuery({
    queryKey: [...key, params, limit] as const,
    queryFn: async ({ signal }) => {
      const body = await api.get<unknown>(
        `${path}${search({ ...params, limit })}`,
        signal,
      )
      return unpack ? unpack(body) : (body as Row[])
    },
    placeholderData: (previous) => previous,
    enabled,
  })

  const rows = useMemo(() => query.data ?? [], [query.data])

  return {
    query,
    rows,
    /// What is on screen — which is all there is to say. The endpoint returns
    /// no count of the matched set, so this is the number of ROWS FETCHED and
    /// must never be presented as a total.
    total: rows.length,
    head: undefined,
    truncated: rows.length >= limit,
    hasMore: false,
    loadingMore: false,
    loadMore: () => {},
  }
}

/// One read that is a whole answer rather than a list: a report, a detail, an
/// aggregate. No paging because there are no pages — an ageing report is one
/// object with every supplier in it.
export function useReport<T>({
  key,
  path,
  params = {},
  enabled,
}: {
  key: readonly unknown[]
  path: string
  params?: Params
  enabled?: boolean
}) {
  return useQuery({
    queryKey: [...key, params] as const,
    queryFn: ({ signal }) => api.get<T>(`${path}${search(params)}`, signal),
    placeholderData: (previous) => previous,
    enabled,
  })
}
