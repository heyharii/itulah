import type { ReturnRow, SaleRow } from "@/lib/queries/storeops"

/// The arithmetic two screens share.
///
/// It lives in its own module rather than beside the table that first needed
/// it, because `stores.tsx` exports a component and a screen that also exports
/// a helper cannot hot-reload. The deeper reason is the comment below: two
/// screens counting open tills with two pieces of arithmetic is two screens
/// that will eventually disagree.

export interface StoreRow {
  readonly site_id: string
  readonly open_count: number
  readonly owing_minor: number
  readonly completed_count: number
  readonly takings_minor: number
  readonly voided_count: number
  readonly return_count: number
  readonly refunded_minor: number
}

/// One row per shop that appears anywhere in either list.
export function rollUp(
  sales: readonly SaleRow[],
  returns: readonly ReturnRow[]
): readonly StoreRow[] {
  const rows = new Map<string, StoreRow>()
  const blank = (site_id: string): StoreRow => ({
    site_id,
    open_count: 0,
    owing_minor: 0,
    completed_count: 0,
    takings_minor: 0,
    voided_count: 0,
    return_count: 0,
    refunded_minor: 0,
  })

  for (const sale of sales) {
    const running = rows.get(sale.site_id) ?? blank(sale.site_id)
    rows.set(sale.site_id, {
      ...running,
      open_count: running.open_count + (sale.status === "OPEN" ? 1 : 0),
      owing_minor:
        running.owing_minor +
        (sale.status === "OPEN"
          ? Math.max(sale.total_minor - sale.paid_minor, 0)
          : 0),
      completed_count:
        running.completed_count + (sale.status === "COMPLETED" ? 1 : 0),
      takings_minor:
        running.takings_minor +
        (sale.status === "COMPLETED" ? sale.total_minor : 0),
      voided_count: running.voided_count + (sale.status === "VOIDED" ? 1 : 0),
    })
  }

  for (const entry of returns) {
    const running = rows.get(entry.site_id) ?? blank(entry.site_id)
    rows.set(entry.site_id, {
      ...running,
      return_count: running.return_count + 1,
      refunded_minor: running.refunded_minor + entry.refund_total_minor,
    })
  }

  return [...rows.values()]
}
