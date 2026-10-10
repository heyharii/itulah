import type { CatalogRow } from "@itulah/contract"

/// Marked down: selling under the book's own base price. `base` equals `unit`
/// on everything that is not, so this is never true by rounding.
export function isDown(row: CatalogRow): boolean {
  return row.unit_price_minor < row.base_unit_price_minor
}
