import { infiniteQueryOptions } from "@tanstack/react-query"

import { gaKeys, gaSupplyBook } from "@/lib/queries/ga"

/// How many requests one page of the register asks for.
export const PAGE = 100

/// The register of supply requests, a page at a time as its foot nears view —
/// the paged reading of the list, which used to stop at the two-hundredth
/// request. Shared with the prefetcher (`prefetch.ts`) so the server's answer
/// is the screen's own.
export const supplyBookQuery = () =>
  infiniteQueryOptions({
    queryKey: [...gaKeys.supplies({}), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      gaSupplyBook({ limit: PAGE, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
