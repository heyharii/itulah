import { useQuery } from "@tanstack/react-query"

import { procurementKeys, purchaseReturns } from "@/lib/queries/procurement"
import {
  supplierReturnKeys,
  supplierReturns,
} from "@/lib/queries/supplier-returns"
import { useCountsAwaiting } from "@/screens/procurement/count-review-state"

/// The numbers on Procurement's sidebar rows. Each reads what its screen reads,
/// under the same query keys, so a row asking costs no request of its own once
/// the screen has loaded — and a number shown beside the row can never differ
/// from the list it leads to.

/// Returns to a supplier that are still open: goods to hand over, or a
/// supplier who still owes something — both books, counted the way the
/// Return to supplier screen counts its "Open" tab.
export function useOpenReturns(): number | null {
  const own = useQuery({
    queryKey: supplierReturnKeys.list(),
    queryFn: ({ signal }) => supplierReturns(signal),
  })
  const over = useQuery({
    queryKey: procurementKeys.returns(),
    queryFn: ({ signal }) => purchaseReturns(undefined, signal),
  })
  if (own.data === undefined || over.data === undefined) return null
  return (
    own.data.filter((one) => !["SETTLED", "CLOSED_SHORT"].includes(one.status))
      .length + over.data.filter((one) => one.status === "OPEN").length
  )
}

/// Purchase orders whose count the warehouse took and the buyer has not yet
/// reviewed — the "Counted at the warehouse" banner on an order's sheet, as a
/// number. Nothing until this browser holds a DC session (see
/// `useCountsAwaiting`), which is the sign-in the order book opens quietly.
export function useOrdersAwaitingReview(): number {
  const waiting = useCountsAwaiting()
  return waiting.size
}

/// The module's own row, shown while it is folded: both of the above.
export function useBuyingWaiting(): number | null {
  const returns = useOpenReturns()
  const reviews = useOrdersAwaitingReview()
  return (returns ?? 0) + reviews
}
