import { node } from "@/lib/api"
import type { SalesBucket, SalesRange } from "@itulah/contract/reporting"

/// What the shops took, asked the three ways the server answers it.
///
/// Hand-written, like the purchase-order reads: `GET /api/v1/reports/sales/*`
/// is assembled with `json!()` in `cloud/postgres/reports.rs` rather than
/// serialised from a struct, so ts-rs has nothing to generate and nothing here
/// is checked against the server at build time. Transcribed from those three
/// literals — if a field moves, this file is where it goes stale.
///
/// The calendar itself is NOT here. `@itulah/contract/reporting` owns where a
/// week starts, how a span is named and what "vs previous" means, because the
/// centre and the shops both read it: two notions of a week would draw the
/// same trade as two different weeks and nothing would catch it.

// ---- The fleet, bucketed -----------------------------------------------

export interface SalesSeriesSite {
  readonly site_id: string
  readonly site_name: string
  readonly site_kind: string
}

/// One shop's trade in one bucket. Absent rather than zero when there was
/// none — the axis comes from `buckets`, never from these.
export interface SalesSeriesCell {
  readonly site_id: string
  /// The local date the bucket starts on, `YYYY-MM-DD`. A week is named by its
  /// Monday, a month by its first.
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
  /// Every bucket in the span, including the ones nobody sold anything in — a
  /// Sunday the fleet was shut belongs on the chart, and deriving the axis from
  /// the cells would silently drop exactly those days.
  readonly buckets: readonly string[]
  /// Every shop that could have traded, including the ones that did not.
  readonly sites: readonly SalesSeriesSite[]
  readonly cells: readonly SalesSeriesCell[]
}

// ---- One shop, one span ------------------------------------------------

export interface SaleTenderTotal {
  readonly method: string
  readonly amount_minor: number
  readonly count: number
}

export interface WindowTransaction {
  /// The source distinguishes an interactive centre sale from the immutable
  /// receipt facts a store sent over sync.
  readonly source: "CENTRE" | "EDGE"
  readonly id: string
  readonly sale_number: string
  /// Which shop rang it. On every row, not only on a fleet-wide read — a
  /// column a screen has to guess about is worse than one it always has.
  readonly site_id: string
  readonly channel: string
  readonly currency: string
  readonly net_minor: number
  readonly tax_minor: number
  readonly total_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly line_count: number
  readonly units: number
  /// Every distinct tender on the sale. More than one is a split payment,
  /// which is the row a supervisor opens this list to find.
  readonly methods: readonly string[]
  readonly actor_id: string
  /// The member the receipt was rung against, when there was one. The column
  /// has always been on the sale; it simply was not on this wire, so no
  /// register could say which receipts were a member's.
  readonly customer_id: string | null
  readonly completed_at: string | null
}

/// The blocks below are deliberately the same shape as the daily report's: a
/// day is a span of one, and a screen speaking one vocabulary for a day and
/// another for a week would be teaching two.
export interface SalesTotals {
  readonly count: number
  readonly units_sold: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly gross_minor: number
  readonly paid_minor: number
  readonly change_minor: number
  readonly voided_count: number
}

export interface ReturnTotals {
  readonly count: number
  readonly refund_total_minor: number
  readonly by_method: readonly {
    readonly method: string
    readonly amount_minor: number
  }[]
}

/// What should physically be in the drawer from this span's trade.
export interface CashTotals {
  readonly cash_tendered_minor: number
  readonly change_given_minor: number
  readonly cash_refunded_minor: number
  readonly cash_expected_minor: number
}

export interface SalesWindow {
  /// Null on a chain-wide read, and the two are different answers: null means
  /// "every unit", never "a unit we could not name".
  readonly site_id: string | null
  readonly site_name: string | null
  readonly from: string
  readonly to: string
  readonly utc_offset_minutes: number
  readonly window: { readonly from: string; readonly to: string }
  readonly sales: SalesTotals & {
    /// Revenue over completed sales, divided by the server so it cannot be
    /// divided by a count that includes the voided ones.
    readonly average_minor: number
  }
  readonly tenders: readonly SaleTenderTotal[]
  readonly returns: ReturnTotals
  readonly cash: CashTotals
  readonly transactions: readonly WindowTransaction[]
  /// Said by the server rather than inferred from a length: a list that stopped
  /// at the limit and a shop that made exactly that many sales look identical,
  /// and only one of them means there is more.
  readonly transactions_truncated: boolean
  readonly transactions_limit: number
  /// Pass back as `cursor` for the receipts after these, newest first. Null
  /// is the end of the span. The totals are the whole span on every page.
  readonly transactions_next_cursor: string | null
}

// ---- One shop, one day -------------------------------------------------

export interface DailyReport {
  readonly site_id: string
  readonly date: string
  readonly utc_offset_minutes: number
  readonly window: { readonly from: string; readonly to: string }
  readonly sales: SalesTotals
  readonly tenders: readonly SaleTenderTotal[]
  readonly returns: ReturnTotals
  readonly cash: CashTotals
  /// The server's own statement of the arithmetic the numbers above obey.
  readonly identity: string
}

// ---- Keys --------------------------------------------------------------

export const analyticsKeys = {
  all: ["analytics"] as const,
  /// Every part of the span is in the key: a series for September is not a
  /// stale answer for October, it is a different question.
  series: (range: SalesRange) =>
    ["analytics", "series", range.from, range.to, range.bucket] as const,
  /// `limit` is in the key because it changes the ANSWER: it is how many
  /// receipts come back beside the totals, so a summary asked for with
  /// `limit: 1` and a register asked for with two hundred are two different
  /// answers and must not share an entry. `siteId` empty is the whole chain.
  window: (
    siteId: string,
    from: string,
    to: string,
    limit: number | null = null
  ) => ["analytics", "window", siteId, from, to, limit] as const,
  /// The same span walked a page of receipts at a time. Its own entry: an
  /// infinite query caches pages, and sharing `window`'s key would hand a
  /// plain reader of it a list of pages instead of a report.
  windowPages: (siteId: string, from: string, to: string) =>
    ["analytics", "window", siteId, from, to, "pages"] as const,
  daily: (siteId: string, date: string) =>
    ["analytics", "daily", siteId, date] as const,
}

// ---- Reads -------------------------------------------------------------

export function salesSeries(range: SalesRange, signal?: AbortSignal) {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    bucket: range.bucket,
  })
  return node.get<SalesSeries>(`/api/v1/reports/sales/series?${query}`, {
    signal,
  })
}

/// One shop over one span, or the whole chain when `siteId` is omitted.
///
/// `limit` is the server's own — how many receipts come back with the totals —
/// and it was being dropped, so every caller paid for up to two hundred
/// receipts whether or not it drew one. A fleet-wide read multiplies that by
/// the number of shops, which is why it is spelled here rather than left to a
/// default nobody can see: a caller that wants only the summary sends `limit:
/// 1` and the totals are unaffected, because the server computes them over the
/// whole span regardless.
export function salesWindow(
  scope: {
    /// Absent is every unit. The server treats the unit as a filter now, not
    /// as an argument.
    readonly siteId?: string
    readonly from: string
    readonly to: string
    readonly limit?: number
    /// A `transactions_next_cursor` from the previous answer.
    readonly cursor?: string
  },
  signal?: AbortSignal
) {
  const query = new URLSearchParams({
    from: scope.from,
    to: scope.to,
  })
  if (scope.siteId !== undefined && scope.siteId !== "") {
    query.set("site_id", scope.siteId)
  }
  if (scope.limit !== undefined) query.set("limit", String(scope.limit))
  if (scope.cursor !== undefined) query.set("cursor", scope.cursor)
  return node.get<SalesWindow>(`/api/v1/reports/sales/window?${query}`, {
    signal,
  })
}

/// One shop's close of one local business day. The boundary is the shop's, not
/// the server's — `utc_offset_minutes` defaults to WIB (UTC+7).
export function dailyReport(
  scope: { readonly siteId: string; readonly date: string },
  signal?: AbortSignal
) {
  const query = new URLSearchParams({
    site_id: scope.siteId,
    date: scope.date,
  })
  return node.get<DailyReport>(`/api/v1/reports/sales/daily?${query}`, {
    signal,
  })
}

// ---- Arithmetic the screens share --------------------------------------

/// One shop's whole span, added up from its cells.
///
/// Here rather than in a screen because three screens read the same series and
/// a total computed twice is a total that can disagree with itself.
export interface SiteTotals {
  readonly site: SalesSeriesSite
  readonly sales_count: number
  readonly units_sold: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly gross_minor: number
}

export function totalsBySite(
  series: SalesSeries | undefined
): readonly SiteTotals[] {
  if (!series) return []
  const totals = new Map<string, SiteTotals>()
  for (const site of series.sites) {
    totals.set(site.site_id, {
      site,
      sales_count: 0,
      units_sold: 0,
      net_minor: 0,
      tax_minor: 0,
      gross_minor: 0,
    })
  }
  for (const cell of series.cells) {
    const running = totals.get(cell.site_id)
    // A cell for a site the roster does not carry cannot happen — the server
    // builds the roster from the same span — but a dropped row is better than
    // a crash if it ever does.
    if (!running) continue
    totals.set(cell.site_id, {
      site: running.site,
      sales_count: running.sales_count + cell.sales_count,
      units_sold: running.units_sold + cell.units_sold,
      net_minor: running.net_minor + cell.net_minor,
      tax_minor: running.tax_minor + cell.tax_minor,
      gross_minor: running.gross_minor + cell.gross_minor,
    })
  }
  return [...totals.values()]
}

/// The fleet's trade in each bucket, in the order the axis reads them.
export interface BucketTotals {
  readonly bucket_start: string
  readonly sales_count: number
  readonly units_sold: number
  readonly net_minor: number
  readonly tax_minor: number
  readonly gross_minor: number
}

export function totalsByBucket(
  series: SalesSeries | undefined,
  /// Narrow to one shop. Undefined is the whole fleet.
  siteId?: string
): readonly BucketTotals[] {
  if (!series) return []
  const empty = () => ({
    sales_count: 0,
    units_sold: 0,
    net_minor: 0,
    tax_minor: 0,
    gross_minor: 0,
  })
  const totals = new Map(series.buckets.map((start) => [start, empty()]))
  for (const cell of series.cells) {
    if (siteId !== undefined && cell.site_id !== siteId) continue
    const running = totals.get(cell.bucket_start)
    if (!running) continue
    running.sales_count += cell.sales_count
    running.units_sold += cell.units_sold
    running.net_minor += cell.net_minor
    running.tax_minor += cell.tax_minor
    running.gross_minor += cell.gross_minor
  }
  return series.buckets.map((start) => ({
    bucket_start: start,
    ...(totals.get(start) ?? empty()),
  }))
}

/// Everything the fleet did over the span.
export function fleetTotals(series: SalesSeries | undefined) {
  return (
    series?.cells.reduce(
      (sum, cell) => ({
        sales_count: sum.sales_count + cell.sales_count,
        units_sold: sum.units_sold + cell.units_sold,
        net_minor: sum.net_minor + cell.net_minor,
        tax_minor: sum.tax_minor + cell.tax_minor,
        gross_minor: sum.gross_minor + cell.gross_minor,
      }),
      {
        sales_count: 0,
        units_sold: 0,
        net_minor: 0,
        tax_minor: 0,
        gross_minor: 0,
      }
    ) ?? {
      sales_count: 0,
      units_sold: 0,
      net_minor: 0,
      tax_minor: 0,
      gross_minor: 0,
    }
  )
}
