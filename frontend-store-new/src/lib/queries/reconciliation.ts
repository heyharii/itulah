import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import { shiftKey } from "@/lib/till"
import type { ShiftReport } from "@itulah/contract"

/// The one read the reconciliation screen needs that nothing else makes.
///
/// Everything else that screen draws already exists: `lib/queries.ts` fetches
/// `sales/window`, and `lib/till.ts` fetches the active shift. This file adds a
/// second way of asking for that shift, and the difference between the two is
/// the whole reason it exists.

/// The drawer this **shop** has open — not the drawer this **browser** opened.
///
/// `useActiveShift` in `lib/till.ts` sends `terminal_id`, and it is right to:
/// it is the cashier's own screen, and a cashier is accountable for the drawer
/// they counted the float into. Reconciliation is the other question. It is
/// read by whoever is responsible for the takings, on whatever device is to
/// hand — the manager's tablet, the office browser — and `terminalId()` mints a
/// fresh name per browser profile. Asking with this browser's terminal would
/// answer `null` on a shop with a drawer plainly open, and the screen would
/// then tell a manager there was nothing to reconcile.
///
/// `store_active_shift` treats a missing `terminal_id` as "whatever shift this
/// node has open", which `edge/http.rs` states is the right answer in a shop
/// with one counter — and every shop in this fleet has one counter.
///
/// `null` is an ordinary answer, not an error: no drawer is open at nine in the
/// morning, and none is open ten minutes after close.
export const openDrawerKey = () => [...shiftKey(), "node"] as const

export function useOpenDrawer() {
  return useQuery({
    queryKey: openDrawerKey(),
    queryFn: ({ signal }) =>
      node.get<ShiftReport | null>("/api/v1/store/shifts/active", { signal }),
    // Under `shiftKey()` on purpose. A void, a return and a close all
    // invalidate that prefix from `lib/till.ts`, and every one of them moves
    // the figures below — a reconciliation reading a drawer from before the
    // refund is the kind of wrong that gets somebody accused.
    refetchInterval: 60_000,
  })
}
