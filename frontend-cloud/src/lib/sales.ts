import type { SalesBucket, SalesRange } from "@itulah/contract/reporting"
import { node } from "@/lib/api"

/// What the shops took, read from the centre.
///
/// Hand-written for the same reason as `pools.ts` and the purchase-order
/// reads: `GET /api/v1/reports/sales/*` is assembled with `json!()` in
/// `cloud/postgres/reports.rs` rather than serialised from a struct, so ts-rs
/// has nothing to generate and nothing here is checked against the server at
/// build time. Transcribed from those literals — if a field moves, this is
/// where it goes stale.

export interface SalesSeriesSite {
  readonly site_id: string
  readonly site_name: string
  readonly site_kind: string
}

/// One shop's trade in one bucket. Absent rather than zero when there was
/// none — the axis comes from `buckets`, not from these.
export interface SalesSeriesCell {
  readonly site_id: string
  /// The local date the bucket starts on, `YYYY-MM-DD`. A week is named by its
  /// Monday and a month by its first.
  readonly bucket_start: string
  readonly sales_count: number
  readonly units_sold: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly gross_minor: number
}

export interface SalesSeries {
  readonly from: string
  readonly to: string
  readonly bucket: SalesBucket
  readonly utc_offset_minutes: number
  readonly window: { readonly from: string; readonly to: string }
  /// Every bucket in the span, including the ones nobody sold anything in.
  readonly buckets: readonly string[]
  readonly sites: readonly SalesSeriesSite[]
  readonly cells: readonly SalesSeriesCell[]
}

export const salesSeriesKey = (range: SalesRange) =>
  ["sales", "series", range.from, range.to, range.bucket] as const

export function salesSeries(range: SalesRange, signal?: AbortSignal): Promise<SalesSeries> {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    bucket: range.bucket,
  })
  return node.get<SalesSeries>(`/api/v1/reports/sales/series?${query}`, { signal })
}

/// How a sale was paid for, as the till recorded it.
///
/// Four values and no more — `sale_payment.method` is a CHECK constraint in
/// `0003_commercial_sales.sql`. Worth knowing before promising anybody a
/// debit-versus-credit split: the schema records CARD and does not distinguish
/// the two, so a screen showing them apart would be inventing the difference.
export type PaymentMethod = "CASH" | "CARD" | "QRIS" | "OTHER"

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["CASH", "CARD", "QRIS", "OTHER"]

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  QRIS: "QRIS",
  OTHER: "Other",
}

export interface SaleTender {
  readonly method: string
  readonly amount_minor: number
  readonly count: number
}

export interface SaleTransaction {
  readonly id: string
  readonly sale_number: string
  readonly channel: string
  readonly currency: string
  readonly net_minor: number
  readonly tax_minor: number
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly line_count: number
  readonly units: number
  /// Every distinct tender on the sale. More than one means a split payment,
  /// which is the row a supervisor opens this list to find.
  readonly methods: readonly string[]
  readonly actor_id: string
  readonly completed_at: string | null
}

export interface SalesWindow {
  readonly site_id: string
  readonly site_name: string
  readonly from: string
  readonly to: string
  readonly utc_offset_minutes: number
  readonly window: { readonly from: string; readonly to: string }
  readonly sales: {
    readonly count: number
    readonly units_sold: number
    readonly net_minor: number
    readonly tax_minor: number
    readonly gross_minor: number
    readonly paid_minor: number
    readonly change_minor: number
    /// Revenue divided by completed sales, computed by the server so it cannot
    /// be divided by a count that includes voided ones.
    readonly average_minor: number
    readonly voided_count: number
  }
  readonly tenders: readonly SaleTender[]
  readonly returns: {
    readonly count: number
    readonly refund_total_minor: number
    readonly by_method: readonly { readonly method: string; readonly amount_minor: number }[]
  }
  readonly cash: {
    readonly cash_tendered_minor: number
    readonly change_given_minor: number
    readonly cash_refunded_minor: number
    readonly cash_expected_minor: number
  }
  readonly transactions: readonly SaleTransaction[]
  readonly transactions_truncated: boolean
  readonly transactions_limit: number
}

export interface SalesWindowScope {
  readonly siteId: string
  readonly from: string
  readonly to: string
}

export const salesWindowKey = (scope: SalesWindowScope) =>
  ["sales", "window", scope.siteId, scope.from, scope.to] as const

export function salesWindow(
  scope: SalesWindowScope,
  signal?: AbortSignal,
): Promise<SalesWindow> {
  const query = new URLSearchParams({
    site_id: scope.siteId,
    from: scope.from,
    to: scope.to,
  })
  return node.get<SalesWindow>(`/api/v1/reports/sales/window?${query}`, { signal })
}

/// One line of a receipt: what was actually sold.
///
/// `epc` is the tag on the individual garment. A sale line is one physical
/// item here rather than a quantity of a SKU — `sale_line` is unique on
/// (sale, subject), because the till scanned a tag and not a barcode.
export interface SaleLine {
  readonly id: string
  readonly subject_id: string
  readonly epc: string
  readonly sku_id: string
  readonly sku_code: string
  readonly quantity: number
  readonly unit_price_minor: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly total_minor: number
  readonly currency: string
  readonly tax_category: string
  readonly tax_rate_bps: number
  readonly tax_inclusive: boolean
  readonly added_at: string
}

export interface SalePayment {
  readonly id: string
  readonly method: string
  readonly amount_minor: number
  readonly reference: string | null
  readonly actor_id: string
  readonly recorded_at: string
}

/// One receipt, whole.
export interface SaleDetail {
  readonly id: string
  readonly sale_number: string
  readonly site_id: string
  readonly channel: string
  readonly status: string
  readonly currency: string
  readonly net_minor: number
  readonly tax_minor: number
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly actor_id: string
  readonly created_at: string
  readonly completed_at: string | null
  readonly voided_at: string | null
  readonly lines: readonly SaleLine[]
  readonly payments: readonly SalePayment[]
}

export const saleDetailKey = (saleId: string) => ["sales", "receipt", saleId] as const

export function saleDetail(saleId: string, signal?: AbortSignal): Promise<SaleDetail> {
  return node.get<SaleDetail>(`/api/v1/sales/${saleId}`, { signal })
}

// ---- The shared calendar -----------------------------------------------

/// Re-exported rather than imported directly by every screen, so this file
/// stays the one place a Sales screen looks — and so moving something into or
/// out of the shared package does not touch a dozen import lines.
export * from "@itulah/contract/reporting"
