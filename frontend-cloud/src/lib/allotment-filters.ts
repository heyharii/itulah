/// What the allotment grid is narrowed by.
///
/// Data and not components, in its own module because the sheets that edit it
/// and the grid that obeys it both need it, and a file that exports a value
/// alongside a component cannot be hot-reloaded.

/// Which articles have anything to promise.
///
/// Not a number to type: the only threshold anybody ever wants here is "does
/// the warehouse have any of this", and offering a box for it invites a filter
/// that hides a row for having 4 rather than 5.
export type StockFilter = "any" | "in" | "out"

/// Everything the grid is narrowed by, in one object.
///
/// One value passed down and back rather than four, because they are read
/// together — a row is shown when it survives all of them — and a screen that
/// says "3 filters" has to count them somewhere.
export interface AllotmentFilters {
  readonly divisions: readonly string[]
  readonly tags: readonly string[]
  readonly stock: StockFilter
  /// Empty means every order. A `purchase_order_id`, not a number: the number
  /// is what a buyer reads and the id is what the article carries.
  readonly purchaseOrder: string
}

export const NO_FILTERS: AllotmentFilters = {
  divisions: [],
  tags: [],
  stock: "any",
  purchaseOrder: "",
}

export function activeFilterCount(filters: AllotmentFilters): number {
  return (
    filters.divisions.length +
    filters.tags.length +
    (filters.stock === "any" ? 0 : 1) +
    (filters.purchaseOrder === "" ? 0 : 1)
  )
}

export function toggleFilter(
  values: readonly string[],
  value: string
): string[] {
  return values.includes(value)
    ? values.filter((held) => held !== value)
    : [...values, value]
}
