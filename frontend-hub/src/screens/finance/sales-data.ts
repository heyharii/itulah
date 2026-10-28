import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import {
  analyticsKeys,
  salesWindow,
  type WindowTransaction,
} from "@/lib/queries/analytics"
import { returnsPageQuery } from "@/lib/queries/storeops"

/// The reads the sales screens of Finance share: Penjualan Cash · POS, Info
/// Penjualan, Retur Penjualan and the sales reports.

/// One page of receipts. The same size as the Sales register, so the two share
/// pages.
export const RECEIPTS_PAGE = 100

/// The receipts of a window a page at a time; every page carries the whole
/// span's totals, and the first page's are the ones to draw.
export function useReceipts(site: string, from: string, to: string) {
  return useInfiniteQuery({
    queryKey: analyticsKeys.windowPages(site, from, to),
    queryFn: ({ pageParam, signal }) =>
      salesWindow(
        {
          siteId: site,
          from,
          to,
          limit: RECEIPTS_PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.transactions_next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })
}

/// The returns of a window, every page of them: a report adds a window up, so
/// it reads on until the server has no more.
export function useReturns(site: string, from: string, to: string) {
  const query = useInfiniteQuery(
    returnsPageQuery({
      siteId: site === "" ? undefined : site,
      from,
      to,
      sort: "at",
      dir: "desc",
      limit: RECEIPTS_PAGE,
    })
  )
  useReadOn(query)
  return query
}

/// Walks a paged query to its end, a page at a time. A page that failed is not
/// asked for again on its own.
export function useReadOn(query: {
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly isFetchNextPageError?: boolean
  readonly fetchNextPage: () => unknown
}) {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError } = query
  const ask = query.fetchNextPage
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && isFetchNextPageError !== true)
      void ask()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, ask])
}

/// The member a receipt was rung against; a walk-in is 7Soft's CASH customer.
export const customerCode = (sale: WindowTransaction): string =>
  sale.customer_id ?? "CASH"
