import { queryOptions } from "@tanstack/react-query"

import { gaKeys, gaLocations } from "@/lib/queries/ga"

/// Every place GA keeps, narrowed by what was searched: the one read the
/// Sites list is made of. Shared with the prefetcher (`prefetch.ts`) so the
/// server's answer is the screen's own.
export const placesQuery = (scope: { readonly q?: string }) =>
  queryOptions({
    queryKey: gaKeys.locations(scope),
    queryFn: ({ signal }) => gaLocations(scope, signal),
  })
