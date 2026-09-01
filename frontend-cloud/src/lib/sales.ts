import { node } from "@/lib/api"

/// What the shops took, read from the centre.
///
/// Hand-written for the same reason as `pools.ts` and the purchase-order
/// reads: `GET /api/v1/reports/sales/*` is assembled with `json!()` in
/// `cloud/postgres/reports.rs` rather than serialised from a struct, so ts-rs
/// has nothing to generate and nothing here is checked against the server at
/// build time. Transcribed from those literals — if a field moves, this is
/// where it goes stale.

/// How wide a column is.
///
/// The same span means different things at different resolutions, which is why
/// this is the reader's choice and not a constant: thirty days shows which
/// Saturday was quiet, twelve months shows whether the trend is up. Chart and
/// table share one value on purpose — two granularity controls that could
/// disagree would put two different answers on one screen.
export type SalesBucket = "day" | "week" | "month"

export const SALES_BUCKETS: readonly SalesBucket[] = ["day", "week", "month"]

/// How many buckets a span is, per bucket size.
///
/// Not one number of days. Switching to months and keeping "the last 30 days"
/// would draw a single column, and switching to days and keeping a year would
/// draw 365 of them, three pixels wide. Each resolution gets spans that are
/// legible AT that resolution.
export const SALES_SPANS: Record<SalesBucket, readonly number[]> = {
  day: [7, 14, 30, 90],
  week: [8, 13, 26, 52],
  month: [6, 12, 24],
}

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

export interface SalesRange {
  readonly from: string
  readonly to: string
  readonly bucket: SalesBucket
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

// ---- Dates -------------------------------------------------------------

/// A local date as the server wants it, `YYYY-MM-DD`.
///
/// Deliberately not `toISOString().slice(0, 10)`, which converts to UTC first
/// and so hands back yesterday for anybody east of Greenwich for the first
/// seven hours of every day — which is to say, all morning, here.
export function isoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/// Midday rather than midnight, so adding days never lands on a daylight-saving
/// seam and silently loses one. Indonesia has no DST, but this function does
/// not know where it is running.
function noon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

/// The Monday of the week a date is in. ISO, matching `date_trunc('week')` on
/// the server — the axis and the cells have to agree on where a week starts or
/// they would not line up.
export function startOfWeek(date: Date): Date {
  const day = noon(date)
  const back = (day.getDay() + 6) % 7
  day.setDate(day.getDate() - back)
  return day
}

/// The span a bucket size and a count of buckets describe, ending today.
///
/// Anchored to the START of the current bucket rather than to today: asking for
/// twelve months should give twelve whole months and a part-month at the end,
/// not eleven and two halves.
export function spanOf(bucket: SalesBucket, buckets: number): SalesRange {
  const today = noon(new Date())
  const to = isoDate(today)
  const start = noon(today)
  if (bucket === "day") {
    start.setDate(start.getDate() - (buckets - 1))
  } else if (bucket === "week") {
    const monday = startOfWeek(today)
    monday.setDate(monday.getDate() - 7 * (buckets - 1))
    return { from: isoDate(monday), to, bucket }
  } else {
    start.setDate(1)
    start.setMonth(start.getMonth() - (buckets - 1))
  }
  return { from: isoDate(start), to, bucket }
}

/// The span of the same shape immediately before this one.
///
/// Shifted by its own length in its own unit rather than by a count of days:
/// "the twelve months before these twelve" is twelve calendar months, and
/// subtracting 365 days would compare February against a piece of March.
///
/// This is what "up 12%" is measured against, so it has to be a span somebody
/// would actually name — last month, the previous four weeks — and not an
/// arbitrary window of equal length.
export function previousSpanOf(bucket: SalesBucket, buckets: number): SalesRange {
  const current = spanOf(bucket, buckets)
  const from = new Date(`${current.from}T12:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() - 1)
  const start = new Date(from)
  if (bucket === "day") {
    start.setDate(start.getDate() - buckets)
  } else if (bucket === "week") {
    start.setDate(start.getDate() - 7 * buckets)
  } else {
    start.setMonth(start.getMonth() - buckets)
  }
  return { from: isoDate(start), to: isoDate(to), bucket }
}

/// The window of equal length immediately before an arbitrary one.
///
/// Used by the sheet, whose span is whatever cell was clicked rather than one
/// of the picker's spans — a Tuesday compares against the Monday, a week
/// against the week before it.
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const before = new Date(start)
  before.setDate(before.getDate() - 1)
  const beforeStart = new Date(before)
  beforeStart.setDate(beforeStart.getDate() - (days - 1))
  return { from: isoDate(beforeStart), to: isoDate(before) }
}

/// How much bigger this period is than the one before it, as a fraction.
///
/// `null` when there is nothing to compare against. A shop that took nothing
/// last month and something this month has not grown by infinity, and printing
/// a percentage there would be arithmetic rather than information — the caller
/// says "new" instead.
export function growth(now: number, before: number): number | null {
  if (before === 0) {
    return null
  }
  return (now - before) / before
}

/// A growth fraction as a person reads it. Always signed, so the direction is
/// in the text and not only in the colour.
export function growthLabel(fraction: number): string {
  const percent = fraction * 100
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : ""
  const magnitude = Math.abs(percent)
  return `${sign}${magnitude >= 100 ? Math.round(magnitude) : magnitude.toFixed(magnitude < 10 ? 1 : 0)}%`
}

/// A bucket's name on an axis: short, because there are up to ninety of them.
export function bucketLabel(start: string, bucket: SalesBucket): string {
  const date = new Date(`${start}T12:00:00`)
  if (bucket === "month") {
    return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/// A bucket's name in full, for a tooltip or a sheet title, where a week has
/// to say it is a week rather than look like a Monday.
export function bucketTitle(start: string, bucket: SalesBucket): string {
  const date = new Date(`${start}T12:00:00`)
  if (bucket === "month") {
    return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  }
  const day = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  if (bucket === "week") {
    const end = new Date(date)
    end.setDate(end.getDate() + 6)
    return `Week of ${day} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
  }
  return day
}

/// The last local date a bucket covers, so a cell can be asked about as a span.
export function bucketEnd(start: string, bucket: SalesBucket): string {
  const date = new Date(`${start}T12:00:00`)
  if (bucket === "day") {
    return start
  }
  if (bucket === "week") {
    date.setDate(date.getDate() + 6)
  } else {
    date.setMonth(date.getMonth() + 1)
    date.setDate(0)
  }
  return isoDate(date)
}

// ---- Colour ------------------------------------------------------------

/// One hue per shop, and never the same one twice.
///
/// Generated rather than picked from a table, because a table has a length and
/// a fleet does not: thirteen shops today, nineteen after a good year, and the
/// screen must not start telling two of them apart by nothing. Every shop gets
/// its own hue at one lightness, spaced evenly round the circle, so the number
/// of shops decides how far apart they are and no two ever collide.
///
/// Honest about what that costs. Eight is the most hues that can be made
/// reliably distinguishable to a colourblind reader; past that they cannot,
/// and this fleet is past it. The colour is therefore a hint and never the
/// only channel — every band is named in the legend, every band is separated
/// by a gap in the surface colour, and the table underneath carries the same
/// swatch beside the shop's own name and its own figure. Nothing on this
/// screen can only be read by telling two hues apart.
///
/// One lightness for every hue, not a lightness ramp: a ramp would make two
/// shops look like more and less of one thing, and they are not — they are
/// different shops.
const HUE_ORIGIN = 20
const LIGHT_STEP = "0.58 0.17"
const DARK_STEP = "0.66 0.16"

/// A step through the hue circle that visits every slot exactly once.
///
/// Consecutive bands are stacked touching each other, so they are the pairs
/// that must not be confusable. Walking in steps of roughly two fifths of the
/// circle puts neighbours nearly opposite, and taking the nearest step coprime
/// with the count means the walk still reaches every hue.
function walk(count: number): number {
  if (count < 3) {
    return 1
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  for (let step = Math.max(2, Math.round(count * 0.4)); step < count; step += 1) {
    if (gcd(step, count) === 1) {
      return step
    }
  }
  return 1
}

/// The colour of the `index`-th band of a stack `count` bands deep.
///
/// `oklch()` straight into CSS rather than hex: the browser gamut-maps a hue
/// that sRGB cannot quite reach, which is a better answer than the flattened
/// one a build-time conversion would bake in.
export function storeColour(
  index: number,
  count: number,
): { readonly light: string; readonly dark: string } {
  const slot = count < 1 ? 0 : (index * walk(count)) % count
  const hue = (HUE_ORIGIN + (slot * 360) / Math.max(count, 1)) % 360
  return {
    light: `oklch(${LIGHT_STEP} ${hue.toFixed(1)})`,
    dark: `oklch(${DARK_STEP} ${hue.toFixed(1)})`,
  }
}

/// A site id as a CSS custom-property suffix.
///
/// `chart.tsx` writes `--color-${key}`, so a key has to survive being part of
/// an identifier. Site ids are `store-01` and `dc` today and a dot in one
/// tomorrow would break the variable rather than the type.
export function seriesKey(siteId: string): string {
  return `site_${siteId.replace(/[^a-zA-Z0-9]/g, "_")}`
}
