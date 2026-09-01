import { useSheet } from "./use-sheet"

/// The sheets that belong to the people screens.
///
/// The record is read far more often than it is edited — a supervisor checking
/// whether somebody is still on probation, a buyer working out who raised an
/// order — and reading it should not cost the list somebody searched to find
/// the name in.
export function usePersonSheet() {
  const sheet = useSheet("employee")
  return {
    /// Whose record is open, or `null`.
    employeeId: sheet.value,
    isOpen: sheet.isOpen,
    open: sheet.open,
    close: sheet.close,
  }
}
