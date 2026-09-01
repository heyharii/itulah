import { useSheet } from "./use-sheet"

/// The sheets that belong to buying.
///
/// A hook per domain rather than one hook for the whole app, because a domain
/// is where the sheets start relating to each other: when the catalogue gains
/// a second sheet — a supplier's terms, say, or two items side by side — the
/// rule that opening one closes the other is a rule about sourcing, and it
/// belongs in one place that sourcing screens call. Until then this is a thin
/// naming layer, and that is fine: it names `itemId` rather than `value`, so
/// the screens read in the vocabulary of the thing rather than of the
/// mechanism.
export function useItemSheet() {
  const sheet = useSheet("item")
  return {
    /// Which supplier item is open, or `null`.
    itemId: sheet.value,
    isOpen: sheet.isOpen,
    open: sheet.open,
    close: sheet.close,
  }
}
