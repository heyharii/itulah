import { useSheet } from "./use-sheet"

/// The sheets that belong to ordering.
///
/// `/orders/$purchaseOrderId` was a route and is now a redirect into this
/// parameter. A route was the wrong shape: a buyer chasing a late delivery
/// opens six orders in a row, and a route change threw away the filters and
/// the sort that found them each time. The sheet keeps the list on screen and
/// walks it with the arrow keys.
export function useOrderSheet() {
  const sheet = useSheet("order")
  return {
    /// Which purchase order is open, or `null`.
    purchaseOrderId: sheet.value,
    isOpen: sheet.isOpen,
    open: sheet.open,
    close: sheet.close,
  }
}
