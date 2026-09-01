import { node } from "@/lib/api"
import type { SalesRange } from "@itulah/contract/reporting"

/// What this shop sold, read from the shop's own node.
///
/// The calendar and the arithmetic are shared with the centre
/// (`@itulah/contract/reporting`); only the response shapes live here, because
/// a shop genuinely answers a smaller question than head office does. See
/// `backend/src/edge/reports.rs` for why:
///
///   - **No tax split.** The edge `sale` row has `total_minor`, `paid_minor`
///     and `change_minor`, and no net/tax to divide them into.
///   - **No returns, no voids.** `status` is `CHECK (status = 'COMPLETED')`.
///
/// Hand-written, like the centre's: these come back from a `Serialize` struct
/// rather than through ts-rs, so nothing here is checked against the server at
/// build time. If a field moves, this is where it goes stale.
export * from "@itulah/contract/reporting"

export interface StoreSalesCell {
  /// The local date the bucket starts on. A week is named by its Monday, the
  /// same Monday the centre uses — see `crate::reporting`.
  readonly bucket_start: string
  readonly sales_count: number
  readonly units_sold: number
  readonly gross_minor: number
}

export interface StoreSalesSeries {
  readonly site_id: string
  readonly from: string
  readonly to: string
  readonly bucket: string
  readonly utc_offset_minutes: number
  /// Every bucket in the span, including the ones nobody sold anything in.
  readonly buckets: readonly string[]
  readonly cells: readonly StoreSalesCell[]
}

export interface StoreReceipt {
  readonly id: string
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly line_count: number
  readonly units: number
  readonly actor_id: string
  readonly completed_at: string
}

export interface StoreTenderTotal {
  /// `CASH` · `CARD` · `QRIS` · `OTHER`, as the node's schema constrains it.
  readonly method: string
  readonly amount_minor: number
  /// Tenders, not sales: one basket settled half on a card is two.
  readonly count: number
}

export interface StoreSalesWindow {
  readonly site_id: string
  readonly from: string
  readonly to: string
  readonly utc_offset_minutes: number
  readonly sales: {
    readonly count: number
    readonly units_sold: number
    readonly gross_minor: number
    readonly paid_minor: number
    readonly change_minor: number
    /// Takings divided by completed sales, computed by the node so it cannot
    /// be divided by a count from somewhere else.
    readonly average_minor: number
  }
  /// What each form of payment took, largest first.
  readonly tenders: readonly StoreTenderTotal[]
  /// Cash taken, less the change given out of it — the drawer, and only the
  /// drawer. Card and QRIS takings are in `tenders` and are chased somewhere
  /// else entirely.
  readonly cash_expected_minor: number
  readonly receipts: readonly StoreReceipt[]
  readonly receipts_truncated: boolean
  readonly receipts_limit: number
}

export const storeSeriesKey = (range: SalesRange) =>
  ["store-sales", "series", range.from, range.to, range.bucket] as const

export function storeSeries(
  range: SalesRange,
  signal?: AbortSignal,
): Promise<StoreSalesSeries> {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    bucket: range.bucket,
  })
  return node.get<StoreSalesSeries>(
    `/api/v1/store/reports/sales/series?${query}`,
    { signal },
  )
}

export const storeWindowKey = (window: { from: string; to: string }) =>
  ["store-sales", "window", window.from, window.to] as const

export function storeWindow(
  window: { from: string; to: string },
  signal?: AbortSignal,
): Promise<StoreSalesWindow> {
  const query = new URLSearchParams({ from: window.from, to: window.to })
  return node.get<StoreSalesWindow>(
    `/api/v1/store/reports/sales/window?${query}`,
    { signal },
  )
}

/// The three numbers a shop is read by.
///
/// All three at once rather than behind a toggle, which is what the centre
/// does. There the rows are shops and a fourth dimension would not fit; here
/// there is one shop, so the rows are free for the measures — and a manager
/// wants to see that takings rose while units fell without pressing anything.
export type StoreMeasure = "gross_minor" | "sales_count" | "units_sold"

export const STORE_MEASURES: readonly { measure: StoreMeasure; label: string }[] = [
  { measure: "gross_minor", label: "Revenue" },
  { measure: "sales_count", label: "Sales" },
  { measure: "units_sold", label: "Units" },
]

/// One shop's trade, indexed the two ways this screen reads it.
export interface StoreMatrix {
  readonly buckets: readonly string[]
  valueAt(bucket: string, measure: StoreMeasure): number
  total(measure: StoreMeasure): number
}

export function buildStoreMatrix(series: StoreSalesSeries | undefined): StoreMatrix {
  const cells = new Map((series?.cells ?? []).map((cell) => [cell.bucket_start, cell]))
  const buckets = series?.buckets ?? []
  const valueAt = (bucket: string, measure: StoreMeasure) =>
    cells.get(bucket)?.[measure] ?? 0
  return {
    buckets,
    valueAt,
    total: (measure) =>
      buckets.reduce((sum, bucket) => sum + valueAt(bucket, measure), 0),
  }
}
