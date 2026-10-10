import { useQuery } from "@tanstack/react-query"

import {
  allotmentsUnfilled,
  inventoryKeys,
  type StillNeededList,
} from "@/lib/queries/inventory"

/// The Still needed read: what MD allotted that the warehouse has not been able
/// to finish — for each such line its target, what has been sent, what is still
/// to pick and, when a picker reported one, why. MD may close the remainder.
/// The same route as before (`/allotments/unfilled`), now carrying `target`,
/// `sent` and `short_reason` as the cloud starts to answer them.
export function useUnfilled(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.allotmentsUnfilled(),
    queryFn: ({ signal }) => allotmentsUnfilled(signal),
    // The generated type predates the three new fields; the same body, read
    // with them optional.
    select: (list) => list as StillNeededList,
    enabled,
  })
}

/// The Allotments menu's badge: lines still needed.
export function useUnfilledCount() {
  const query = useUnfilled()
  return query.data ? query.data.open.length : null
}
