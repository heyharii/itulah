import { useSheet } from "./use-sheet"

/// The sheets that belong to pricing.
export function useBookSheet() {
  const sheet = useSheet("book")
  return {
    /// Which publication is open, or `null`.
    publicationId: sheet.value,
    isOpen: sheet.isOpen,
    open: sheet.open,
    close: sheet.close,
  }
}
