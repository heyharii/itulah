import { useQuery } from "@tanstack/react-query"

import { node } from "@/lib/api"
import { shiftKey } from "@/lib/till"
import type { ShiftReport, TillSeat } from "@itulah/contract"

/// The reads the reconciliation screen needs that nothing else makes.
///
/// Everything else that screen draws already exists: `lib/queries.ts` fetches
/// `sales/window`, and `lib/till.ts` fetches the shift this browser opened.
/// This file adds two ways of asking about the counter as a whole, and the
/// difference between them and `useActiveShift` is the reason it exists.

/// Every drawer this **shop** has open — not the drawer this **browser** opened.
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
/// It is also no longer one drawer. A store has till seats, `KASIR-1..N`, set
/// by head office, and a shift is one person's drawer at one seat — several
/// can be open at once. `shifts/active` without a terminal still answers with
/// only the *oldest* open shift, which on a two-seat shop would hide the
/// second drawer from the one person asked to add them up. `shifts/open` is
/// the list, and a cashier is served it blind like every other report.
///
/// An empty list is an ordinary answer, not an error: no drawer is open at
/// nine in the morning, and none is open ten minutes after close.
export const openDrawersKey = () => [...shiftKey(), "node"] as const

export function useOpenDrawers() {
  return useQuery({
    queryKey: openDrawersKey(),
    queryFn: ({ signal }) =>
      node.get<ShiftReport[]>("/api/v1/store/shifts/open", { signal }),
    // Under `shiftKey()` on purpose. A void, a return and a close all
    // invalidate that prefix from `lib/till.ts`, and every one of them moves
    // the figures below — a reconciliation reading a drawer from before the
    // refund is the kind of wrong that gets somebody accused.
    refetchInterval: 60_000,
  })
}

/// The counter at a glance: every seat, and who holds it right now.
///
/// A seat with no drawer comes back with `shift_id: null` — that is a free
/// seat, and it is listed so a manager sees the whole counter rather than
/// only the seats somebody is sitting at. A seat head office has since
/// removed (`current: false`) is listed only while its drawer is still open.
///
/// Under `shiftKey()` for the same reason as the drawers: taking a seat over
/// or closing a drawer must move this list with the figures beside it.
export const tillSeatsKey = () => [...shiftKey(), "seats"] as const

export function useTillSeats() {
  return useQuery({
    queryKey: tillSeatsKey(),
    queryFn: ({ signal }) =>
      node.get<TillSeat[]>("/api/v1/store/tills", { signal }),
    refetchInterval: 60_000,
  })
}
