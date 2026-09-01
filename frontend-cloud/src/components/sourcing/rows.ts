import type { SourcedItem, SupplierStatus } from "@itulah/contract"

/// A sourcing candidate, flattened.
///
/// The server sends `{ item, supplier }` because sourcing asks a question no
/// single supplier can answer. The table needs the opposite shape: one flat
/// record per row, because every faceted filter, sort and column id in the
/// data-table addresses a top-level key. Flattening here — once, in a named
/// function — is the whole reconciliation, and it is also where a null the wire
/// allows becomes something a column can render.
export interface SourcingRow {
  /// `supplier_item_id`. The only id a purchase-order line can be raised
  /// against, so it is also the React key and the shortlist key.
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly image: string | null
  readonly supplierId: string
  readonly supplier: string
  readonly supplierCode: string
  /// The item's own division in our vocabulary. Unclassified is a real state,
  /// not a missing value, so it is spelled out rather than left blank.
  readonly division: string
  readonly tags: readonly string[]
  /// `unit_price_minor` — an integer count of the smallest currency unit.
  readonly price: number
  readonly currency: string
  readonly status: SupplierStatus
  /// Set once head office has matched this supplier item to one of our own
  /// articles. Null means nobody has.
  readonly article: string | null
  readonly updatedAt: string
}

export const UNCLASSIFIED = "Unclassified"

export function toSourcingRow({ item, supplier }: SourcedItem): SourcingRow {
  return {
    id: item.supplier_item_id,
    code: item.supplier_item_code,
    name: item.name,
    description: item.description,
    image: item.image_url,
    supplierId: item.supplier_id,
    supplier: supplier.name,
    supplierCode: supplier.supplier_code,
    division: item.division_code ?? UNCLASSIFIED,
    tags: item.tags,
    price: item.unit_price_minor,
    currency: item.currency,
    status: item.status,
    article: item.internal_article_code,
    updatedAt: item.updated_at,
  }
}

/// Rows grouped by the supplier that sells them.
///
/// Not a display convenience: a purchase order is raised against exactly one
/// `supplier_id` (`CatalogPurchaseOrderRequest`), so a shortlist spanning three
/// suppliers is three orders. Grouping is how the screen says that before the
/// buyer finds out from a 400.
export function bySupplier(
  rows: readonly SourcingRow[],
): { supplierId: string; supplier: string; rows: SourcingRow[] }[] {
  const groups = new Map<string, { supplierId: string; supplier: string; rows: SourcingRow[] }>()
  for (const row of rows) {
    const group = groups.get(row.supplierId)
    if (group === undefined) {
      groups.set(row.supplierId, {
        supplierId: row.supplierId,
        supplier: row.supplier,
        rows: [row],
      })
    } else {
      group.rows.push(row)
    }
  }
  return [...groups.values()].sort((a, b) => a.supplier.localeCompare(b.supplier))
}

/// What a set of rows is worth at the quoted price, and in which currency.
///
/// Returns `null` for a mixed-currency set rather than adding the numbers up:
/// 100 IDR plus 100 USD is not 200 of anything, and a total that pretends
/// otherwise is worse than no total.
export function quoteTotal(
  rows: readonly { price: number; currency: string; quantity?: number }[],
): { minor: number; currency: string } | null {
  if (rows.length === 0) return null
  const currency = rows[0].currency
  if (rows.some((row) => row.currency !== currency)) return null
  return {
    minor: rows.reduce((sum, row) => sum + row.price * (row.quantity ?? 1), 0),
    currency,
  }
}
