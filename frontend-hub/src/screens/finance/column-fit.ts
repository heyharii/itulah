import { useFittedVisibility } from "@/screens/procurement/shared"

/// The columns a table shows, for a list that has a Columns menu.
///
/// `DataTable` gives up the columns a card has no room for by itself — but only
/// while the screen leaves column visibility alone, and a Columns menu cannot
/// work then: the table's own pass puts back what the reader switched off. So
/// the screen holds the visibility, and this is the purchase orders' fit
/// (`useFittedVisibility`): what the reader switched stays as they set it, and
/// the low-priority columns the card has no room for are left out.
///
/// Returns `[measure, fit]`: `measure` goes on a box exactly as wide as the
/// card, `fit.visibility` and `fit.onChange` go to `useTable`. A phone's cards
/// use every column they have a role for, so nothing is given up for room
/// there.
export function useColumnFit(
  columns: Parameters<typeof useFittedVisibility>[0],
  cards: boolean
) {
  const fit = useFittedVisibility(columns, {})
  return [
    fit.ref,
    {
      visibility: cards ? fit.visibility : fit.shown,
      onChange: fit.change,
    },
  ] as const
}
