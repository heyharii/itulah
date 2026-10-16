import {
  keepPreviousData,
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query"

import { node } from "@/lib/api"
import { fetchSeries, isoDay } from "@/lib/queries"
import { fetchWindowAll } from "@/lib/sales-window"
import { receiptKey } from "@/lib/till"
import type { ReceiptDocument } from "@itulah/contract"

/// The reads behind Today > Dashboard.
///
/// Everything here is the shop's own SQLite, through the two report endpoints
/// (`edge/reports.rs`) and the receipt document, so the screen answers with the
/// line to head office down. The node has no endpoint that cuts sales by SKU,
/// by member, or counts returns — see `fetchBasket` for what is done instead
/// and what it costs.
///
/// Every key sits under `salesKey()`'s `"sales"` prefix, so a sale, a void or a
/// return that invalidates the day's takings refreshes this screen with them.

// ─────────────────────────────────────────────────────────────────────────────
// Spans

/// Two calendar days, both counted, as `YYYY-MM-DD`.
export interface Span {
  readonly from: string
  readonly to: string
}

/// A calendar day as local midnight — `isoDay`'s own writing, read back.
function atDay(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(iso: string, days: number): string {
  const at = atDay(iso)
  at.setDate(at.getDate() + days)
  return isoDay(at)
}

/// How many days a span covers, both ends counted.
export function daysIn(span: Span): number {
  const apart = atDay(span.to).getTime() - atDay(span.from).getTime()
  return Math.round(apart / 86_400_000) + 1
}

/// The span of the same length that ends the day before this one starts — what
/// every figure on the dashboard is compared with.
export function spanBefore(span: Span): Span {
  const length = daysIn(span)
  return { from: addDays(span.from, -length), to: addDays(span.from, -1) }
}

/// Whether today is in the span, and so whether it can still change.
const includesToday = (span: Span) => isoDay(new Date()) <= span.to

/// How often a span that includes today is read again. A sale rung at another
/// till does not invalidate anything in this browser.
const REFRESH = 60_000

// ─────────────────────────────────────────────────────────────────────────────
// What was taken, day by day

/// The three figures a day is read by.
export interface Totals {
  readonly sales_minor: number
  readonly transactions: number
  readonly items: number
}

export interface DayFigures extends Totals {
  readonly day: string
}

export interface Trade {
  /// Every day of the span, the ones nobody sold anything in included.
  readonly days: readonly DayFigures[]
  readonly now: Totals
  /// The span just before, of the same length.
  readonly before: Totals
}

const NOTHING: Totals = { sales_minor: 0, transactions: 0, items: 0 }

export function addUp(rows: readonly Totals[]): Totals {
  return rows.reduce(
    (total, row) => ({
      sales_minor: total.sales_minor + row.sales_minor,
      transactions: total.transactions + row.transactions,
      items: total.items + row.items,
    }),
    NOTHING,
  )
}

export const tradeKey = (span: Span) =>
  ["sales", "dashboard", "trade", span.from, span.to] as const

/// `GET /api/v1/store/reports/sales/series` over the span and the span before
/// it, in one request: the node buckets by day, and the two spans are one
/// unbroken run of days that is cut in two here.
export async function fetchTrade(
  span: Span,
  signal?: AbortSignal,
): Promise<Trade> {
  const earlier = spanBefore(span)
  const series = await fetchSeries(
    { from: earlier.from, to: span.to, bucket: "day" },
    signal,
  )
  const cells = new Map(
    series.cells.map((cell) => [cell.bucket_start, cell] as const),
  )
  const run = series.buckets.map<DayFigures>((day) => {
    const cell = cells.get(day)
    return {
      day,
      sales_minor: cell?.gross_minor ?? 0,
      transactions: cell?.sales_count ?? 0,
      items: cell?.units_sold ?? 0,
    }
  })
  const days = run.filter((one) => one.day >= span.from)
  return {
    days,
    now: addUp(days),
    before: addUp(run.filter((one) => one.day < span.from)),
  }
}

export const tradeQuery = (span: Span) =>
  queryOptions({
    queryKey: tradeKey(span),
    queryFn: ({ signal }) => fetchTrade(span, signal),
  })

export function useTrade(span: Span) {
  return useQuery({
    ...tradeQuery(span),
    // A new span keeps the old chart on the glass, dimmed, until its own
    // arrives — a skeleton in between is a flash and a layout jump.
    placeholderData: keepPreviousData,
    refetchInterval: includesToday(span) ? REFRESH : false,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// One day, hour by hour

/// A single day is one bar on a chart by day, and a bar is not a chart. So a
/// span of one day is drawn by the hour instead, from its receipts.
export interface HourFigures extends Totals {
  /// 0–23, on the shop's clock.
  readonly hour: number
}

/// A shop's trading day reads from about ten until about nine. The hours drawn
/// start there and stretch to take in a sale outside them.
const OPENING_HOUR = 10
const CLOSING_HOUR = 21

export const hoursKey = (day: string) =>
  ["sales", "dashboard", "hours", day] as const

/// `GET /api/v1/store/reports/sales/window` for one day, its receipts grouped
/// by the hour they were completed in.
export async function fetchHours(
  day: string,
  signal?: AbortSignal,
): Promise<readonly HourFigures[]> {
  const listed = await fetchWindowAll({ from: day, to: day }, signal)
  const byHour = new Map<number, Totals>()
  for (const receipt of listed.receipts) {
    const hour = new Date(receipt.completed_at).getHours()
    const was = byHour.get(hour) ?? NOTHING
    byHour.set(hour, {
      sales_minor: was.sales_minor + receipt.total_minor,
      transactions: was.transactions + 1,
      items: was.items + receipt.units,
    })
  }
  if (byHour.size === 0) return []
  const hours = [...byHour.keys()]
  const first = Math.min(OPENING_HOUR, ...hours)
  const last = Math.max(CLOSING_HOUR, ...hours)
  return Array.from({ length: last - first + 1 }, (_, at) => {
    const hour = first + at
    return { hour, ...(byHour.get(hour) ?? NOTHING) }
  })
}

export const hoursQuery = (day: string) =>
  queryOptions({
    queryKey: hoursKey(day),
    queryFn: ({ signal }) => fetchHours(day, signal),
  })

export function useHours(day: string, enabled: boolean) {
  return useQuery({
    ...hoursQuery(day),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: includesToday({ from: day, to: day }) ? REFRESH : false,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// What was in the baskets

/// One SKU, as sold over a span.
export interface SoldSku {
  readonly sku_code: string
  /// As the receipt names it — the catalogue's name for the SKU.
  readonly name: string
  readonly units: number
  readonly sales_minor: number
}

export interface Basket {
  /// Completed sales in the span: the node's own count, over the whole span.
  readonly sales: number
  /// How many of them were read down to their lines.
  readonly read: number
  /// Of those, the ones something was taken back from.
  readonly returned: number
  /// Per SKU, most units first and then most money.
  readonly skus: readonly SoldSku[]
}

/// How many receipts are read down to their lines for one span.
///
/// There is no endpoint that sums sale lines by SKU, so a SKU's units come from
/// the receipts themselves, one request each. That is fast on a shop's own
/// network and still a few hundred requests, so it stops here: the newest
/// receipts are read, and `Basket.read` against `Basket.sales` says when that
/// was not all of them.
const READ_LIMIT = 300

/// How many receipts are in flight at once.
const READ_PARALLEL = 8

/// How old a receipt this screen is given may be. `useReceipt` trusts a receipt
/// for good, because a void or a return made in this browser invalidates it;
/// one made at another till does not reach this browser, and this screen is
/// the one that counts them.
const RECEIPT_FRESH = 5 * 60_000

/// What `till::receipt_document` stamps across a receipt (`edge/till.rs`).
const VOID_STAMP = "BATAL"
const RETURN_STAMP = "RETUR"

export const basketKey = (span: Span) =>
  ["sales", "dashboard", "basket", span.from, span.to] as const

/// `GET /api/v1/store/sales/{id}/receipt` for each, under the key `useReceipt`
/// in `lib/till.ts` files it, so a receipt opened on Sales is already here and
/// a void or a return that invalidates it is read again.
async function readReceipts(
  ids: readonly string[],
  signal: AbortSignal,
  client: QueryClient,
): Promise<ReceiptDocument[]> {
  const read: (ReceiptDocument | null)[] = ids.map(() => null)
  let failure: unknown = null
  let next = 0
  const worker = async () => {
    while (next < ids.length && !signal.aborted) {
      const at = next
      next += 1
      const id = ids[at]
      try {
        read[at] = await client.fetchQuery({
          queryKey: receiptKey(id),
          queryFn: ({ signal: own }) =>
            node.get<ReceiptDocument>(
              `/api/v1/store/sales/${encodeURIComponent(id)}/receipt`,
              { signal: own },
            ),
          staleTime: RECEIPT_FRESH,
        })
      } catch (error) {
        failure ??= error
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(READ_PARALLEL, ids.length) }, worker),
  )
  signal.throwIfAborted()
  const papers = read.filter((one) => one !== null)
  // Some receipts missing is a thinner answer; none at all is an error.
  if (papers.length === 0 && failure !== null) throw failure
  return papers
}

/// The span's sales down to their lines: which SKUs sold, how many, for how
/// much — and how many of the sales had something taken back.
///
/// Built from `sales/window` for the newest receipts of the span and the
/// receipt document of each, because that is all the node offers. Two things
/// follow from it, and the screen says the first out loud:
///
///  - a span with more than `READ_LIMIT` sales is read from its newest ones;
///  - a return is known from the stamp on the SALE it came out of, so it is
///    counted in the span of the sale, not of the day it was taken back.
///
/// A returned sale still counts its lines as sold: the receipt keeps them and
/// does not say which came back.
export async function fetchBasket(
  span: Span,
  signal: AbortSignal,
  client: QueryClient,
): Promise<Basket> {
  const listed = await fetchWindowAll(span, signal)
  // Newest first, as the node lists them.
  const ids = listed.receipts.slice(0, READ_LIMIT).map((one) => one.id)
  const papers = await readReceipts(ids, signal, client)

  const bySku = new Map<string, SoldSku>()
  let read = 0
  let returned = 0
  for (const paper of papers) {
    // Voided since the list was drawn: not a sale any more.
    if (paper.stamp?.includes(VOID_STAMP) === true) continue
    read += 1
    if (paper.stamp?.includes(RETURN_STAMP) === true) returned += 1
    for (const line of paper.lines) {
      const was = bySku.get(line.sku_code)
      bySku.set(line.sku_code, {
        sku_code: line.sku_code,
        name: line.name,
        units: (was?.units ?? 0) + line.quantity,
        sales_minor:
          (was?.sales_minor ?? 0) + line.unit_price_minor * line.quantity,
      })
    }
  }
  return {
    sales: listed.sales.count,
    read,
    returned,
    skus: [...bySku.values()].sort(
      (a, b) => b.units - a.units || b.sales_minor - a.sales_minor,
    ),
  }
}

export const basketQuery = (span: Span) =>
  queryOptions({
    queryKey: basketKey(span),
    queryFn: ({ signal, client }) => fetchBasket(span, signal, client),
  })

export function useBasket(span: Span, enabled = true) {
  return useQuery({
    ...basketQuery(span),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: includesToday(span) ? REFRESH : false,
  })
}

/// The share of the sales read that had something taken back, in percent — or
/// null when none were read.
export function returnRate(basket: Basket): number | null {
  return basket.read === 0 ? null : (basket.returned / basket.read) * 100
}
