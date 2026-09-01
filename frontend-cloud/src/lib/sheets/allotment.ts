import { useSheet } from "./use-sheet"

/// The sheets that belong to allotting.
///
/// `/allotments/$allotmentId` was a route and is now a redirect into this
/// parameter. Watching an allotment is the job: seven stage counts, an edge
/// node that may or may not have answered, and a cancellation that may have
/// been refused for goods already picked. That is a thing somebody checks
/// repeatedly across a list of them, and as a route each check cost the list.
export function useAllotmentSheet() {
  const sheet = useSheet("allotment")
  return {
    /// Which allotment is open, or `null`.
    allotmentId: sheet.value,
    isOpen: sheet.isOpen,
    open: sheet.open,
    close: sheet.close,
  }
}
