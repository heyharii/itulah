import { useSheet } from "./use-sheet"

/// The sheets that belong to the books.
///
/// One entry, down to its lines. The journal already opened an entry under the
/// table it was clicked in, and the argument for that is still right — an
/// opened entry is not another entry, so it must not become a row in the sort
/// order or the count. A sheet honours the same argument and adds the two
/// things the panel could not have: an address for an entry, which is what an
/// auditor asks for by name, and ↑/↓ through the register, which is what
/// checking a day's postings actually is.
export function useEntrySheet() {
  const sheet = useSheet("entry")
  return {
    /// Which entry is open, or `null`.
    entryId: sheet.value,
    isOpen: sheet.isOpen,
    open: sheet.open,
    close: sheet.close,
  }
}
