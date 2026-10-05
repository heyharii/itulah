import { useQuery } from "@tanstack/react-query"

import { allotmentsUnfilled, inventoryKeys } from "@/lib/queries/inventory"

/// The Unfilled read: lines the Gudang could not fill once the count booked
/// the missing pieces. The server lists a line only after that, so every
/// open row can be closed short.
export function useUnfilled(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.allotmentsUnfilled(),
    queryFn: ({ signal }) => allotmentsUnfilled(signal),
    enabled,
  })
}

/// The Merchandise menu's badge: lines still open.
export function useUnfilledCount() {
  const query = useUnfilled()
  return query.data ? query.data.open.length : null
}
