import { Outlet } from "@tanstack/react-router"

import { HrProvider } from "@/components/hr/store"

/**
 * The subtree that shares the People register: `/hr-ho`, `/hr-store` and
 * `/finance`.
 *
 * Mounted by the pathless `_people` layout route, which is what keeps this
 * provider — and the ~1,400 lines of fixture state it closes over — out of the
 * entry chunk that all eighteen apps download. See `routes/_people.tsx` for
 * why the scope is a layout rather than three separate providers.
 */
export function PeopleScope() {
  return (
    <HrProvider>
      <Outlet />
    </HrProvider>
  )
}
