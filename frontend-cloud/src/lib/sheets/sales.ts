import { useSheetParams } from "./use-sheet"

/// Declared once rather than inline, so the callbacks below are stable.
const KEYS = ["sale", "saleFrom", "saleTo"] as const

/// The sheet that belongs to the sales screen.
///
/// One shop over one span. It was already a sheet — a route change would have
/// thrown away the range and the granularity somebody scrolled sideways to
/// reach — but it lived in a `useState`, so "look at Bandung last week" was not
/// a thing anybody could send to a colleague. Now it is the address.
export function useSaleSheet() {
  const sheet = useSheetParams(KEYS)
  const { sale, saleFrom, saleTo } = sheet.params
  return {
    /// The cell that is open, or `null` when any part of it is missing.
    cell:
      sale === undefined || saleFrom === undefined || saleTo === undefined
        ? null
        : { siteId: sale, from: saleFrom, to: saleTo },
    open: (cell: { siteId: string; from: string; to: string }) =>
      sheet.open({ sale: cell.siteId, saleFrom: cell.from, saleTo: cell.to }),
    close: sheet.close,
  }
}
