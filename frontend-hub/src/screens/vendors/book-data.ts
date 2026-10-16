import { infiniteQueryOptions } from "@tanstack/react-query"

import {
  procurementKeys,
  supplierPage,
  type SupplierCategory,
} from "@/lib/queries/procurement"

/// How many suppliers one page of the book asks for.
export const PAGE = 100

/// The book, a page at a time as its foot nears view — the same read and the
/// same key shape the supplier book uses, under the book's prefix so
/// `suppliers()` invalidation still reaches it. Shared with the prefetcher
/// (`prefetch.ts`) so the server's answer is the screen's own.
///
/// Read with `useSuspenseInfiniteQuery`: the rows in hand stay on screen while
/// a new search is read because the screen asks through a deferred scope.
export const vendorBookQuery = (scope: {
  readonly category: SupplierCategory
  readonly q?: string
}) =>
  infiniteQueryOptions({
    queryKey: [...procurementKeys.suppliers(scope), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      supplierPage({ ...scope, limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
