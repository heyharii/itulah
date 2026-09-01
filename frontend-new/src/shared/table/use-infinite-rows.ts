/**
 * The data half of an infinitely-scrolling list.
 *
 * Speaks the list contract (`docs/list-contract.md`): the fetcher is handed an
 * opaque cursor and returns whatever the endpoint gave, and `readListEnvelope`
 * normalises it. A screen writes no page bookkeeping and never parses a cursor.
 *
 * Paging stops on `nextCursor === null` and on nothing else. Not on a total,
 * not on an empty page, not on a `has_more` flag — because `total` means two
 * different things across the hub today, and a client that infers exhaustion
 * from it stops early on the endpoints where it is really a page length. That
 * is the bug this contract exists to remove; see the envelope reader for the
 * detail.
 */

import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query"
import { useMemo } from "react"

import { getErrorMessage } from "@/lib/api"
import { readListEnvelope } from "@/shared/api/list-envelope"
import type { InfiniteControls } from "./virtual-rows"

export interface FetchPageArgs {
  /** Opaque. `null` on the first page. Pass it straight back to the endpoint. */
  cursor: string | null
  limit: number
  signal: AbortSignal
  /** Rows already held — for an offset-paged endpoint with no cursor. */
  offset: number
}

export interface InfiniteRowsOptions {
  queryKey: QueryKey
  /** Fetch one page. Return the raw payload; the envelope reader handles shape. */
  fetchPage: (args: FetchPageArgs) => Promise<unknown>
  /** Rows per request. The contract clamps at 200 server-side. */
  pageSize?: number
  enabled?: boolean
  staleTime?: number | "static"
  gcTime?: number
}

export interface InfiniteRows<T> extends InfiniteControls {
  rows: T[]
  /**
   * Rows the server says match the filter, or `undefined` when it did not say —
   * or said something ambiguous. Render `undefined` as "N shown", never as
   * "N of N": claiming a total the server never gave is how the silent caps
   * happened.
   */
  total: number | undefined
  isLoading: boolean
  isError: boolean
  errorMessage: string | undefined
  reload: () => void
}

interface Cursor {
  cursor: string | null
  offset: number
}

const FIRST_PAGE: Cursor = { cursor: null, offset: 0 }

export function useInfiniteRows<T>({
  queryKey,
  fetchPage,
  pageSize = 200,
  enabled = true,
  staleTime,
  gcTime,
}: InfiniteRowsOptions): InfiniteRows<T> {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    staleTime,
    gcTime,
    initialPageParam: FIRST_PAGE,
    queryFn: async ({ pageParam, signal }) => {
      const { cursor, offset } = pageParam as Cursor
      const payload = await fetchPage({ cursor, offset, limit: pageSize, signal })
      return readListEnvelope<T>(payload, offset)
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.nextCursor === null) return undefined
      const held = allPages.reduce((sum, page) => sum + page.items.length, 0)
      /* A page that returned nothing but still offered a cursor would loop
       * forever; treat it as the end regardless of what the cursor says. */
      if (lastPage.items.length === 0) return undefined
      return { cursor: lastPage.nextCursor, offset: held }
    },
  })

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  )

  /* The last page's total, not the first: a filter applied mid-scroll changes
   * the answer, and the freshest one is the one to show. */
  const total = query.data?.pages.at(-1)?.total

  return {
    rows,
    total,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => void query.fetchNextPage(),
    isLoading: query.isPending,
    isError: query.isError,
    errorMessage: query.error ? getErrorMessage(query.error) : undefined,
    reload: () => void query.refetch(),
  }
}
