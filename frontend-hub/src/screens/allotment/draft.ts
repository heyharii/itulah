/// Where the unsaved New allotment draft is kept between visits. One draft per
/// browser, for every supplier at once — a cell is a SKU and a store, and a SKU
/// is only ever one supplier's.
export const DRAFT_KEY = "central.new-allotment.draft"

/// How a new allotment was started from an old one.
export type AllotFrom = {
  /// `topup` adds to what an allotment promised; `reallot` is what a cancelled
  /// allotment gave back, to be given again; `edit` is MD changing a cloud-run
  /// allotment in place, in the same grid (9 Oct 2026).
  readonly mode: "topup" | "reallot" | "edit"
  /// The allotment it comes from.
  readonly id: string
}

/// The `allotFrom` search value for one allotment.
export function allotFromValue(mode: AllotFrom["mode"], id: string): string {
  return `${mode}~${id}`
}

/// Read the search value back, or nothing when there is none.
export function allotFromOf(value: string | undefined): AllotFrom | null {
  if (value === undefined) return null
  const [mode, id] = value.split("~")
  return (mode === "topup" || mode === "reallot" || mode === "edit") && id
    ? { mode, id }
    : null
}

/// Write numbers into the draft New allotment opens with. A cell is a SKU and
/// a store, joined by NUL (see `cellKey` in `matrix.tsx`); a number given here
/// replaces whatever the cell held.
export function stageDraft(
  cells: readonly {
    readonly skuId: string
    readonly destinationId: string
    readonly quantity: number
  }[]
) {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}")
    const draft: Record<string, number> =
      typeof parsed === "object" && parsed !== null
        ? { ...(parsed as Record<string, number>) }
        : {}
    for (const cell of cells)
      if (cell.quantity > 0)
        draft[`${cell.skuId}\u0000${cell.destinationId}`] = cell.quantity
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Storage denied: the page opens narrowed, with the numbers to type.
  }
}
