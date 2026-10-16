import { useSuspenseQueries } from "@tanstack/react-query"
import { useMemo } from "react"

import type { ChartRow } from "@/components/ui/chart"
import {
  totalsByBucket,
  totalsBySite,
  type SalesSeries,
} from "@/lib/queries/analytics"
import { salesSeriesQuery } from "@/screens/executive/data"
import type { ReportScope } from "@/screens/executive/scope"

/// The trade the executive pages share: this period and the one before it,
/// per shop and per bucket.
///
/// Net of promotions and before tax — `net_minor`, the figure the ledger's
/// Penjualan is built from — never the till's gross. Two series and nothing
/// else, so every page that shows a sales figure shows the same one.

export interface StoreTrade {
  readonly site_id: string
  readonly name: string
  readonly kind: string
  readonly net: number
  readonly before: number
  readonly sales: number
  readonly units: number
}

export interface Trade {
  readonly net: number
  readonly before: number
  readonly sales: number
  readonly salesBefore: number
  readonly units: number
  readonly unitsBefore: number
}

function tradeOf(
  series: SalesSeries | undefined,
  store: string | undefined
): { net: number; sales: number; units: number } {
  let net = 0
  let sales = 0
  let units = 0
  for (const cell of series?.cells ?? []) {
    if (store !== undefined && cell.site_id !== store) continue
    net += cell.net_minor
    sales += cell.sales_count
    units += cell.units_sold
  }
  return { net, sales, units }
}

/// Read inside a `<Suspense>`: the two series are asked for together, and
/// nothing is drawn from half of them — a comparison with no base is not a
/// report.
export function useTrade(scope: ReportScope) {
  const [current, before] = useSuspenseQueries({
    queries: [
      salesSeriesQuery(scope.range),
      salesSeriesQuery(scope.beforeRange),
    ],
  })

  const derived = useMemo(() => {
    const now = tradeOf(current.data, scope.store)
    const then = tradeOf(before.data, scope.store)
    const total: Trade = {
      net: now.net,
      before: then.net,
      sales: now.sales,
      salesBefore: then.sales,
      units: now.units,
      unitsBefore: then.units,
    }

    const earlier = new Map(
      totalsBySite(before.data).map((row) => [row.site.site_id, row])
    )
    const stores: StoreTrade[] = totalsBySite(current.data)
      // A place that neither traded nor could have is noise in a ranking.
      .filter(
        (row) =>
          row.site.site_kind === "STORE" ||
          row.net_minor !== 0 ||
          (earlier.get(row.site.site_id)?.net_minor ?? 0) !== 0
      )
      .map((row) => ({
        site_id: row.site.site_id,
        name: row.site.site_name || row.site.site_id,
        kind: row.site.site_kind,
        net: row.net_minor,
        before: earlier.get(row.site.site_id)?.net_minor ?? 0,
        sales: row.sales_count,
        units: row.units_sold,
      }))

    // Aligned by POSITION, not by date: day 7 of this month against day 7 of
    // the last, which is the comparison the tile above the chart makes.
    const nowBuckets = totalsByBucket(current.data, scope.store)
    const thenBuckets = totalsByBucket(before.data, scope.store)
    const chart: ChartRow[] = nowBuckets.map((bucket, index) => ({
      bucket: bucket.bucket_start,
      now: bucket.net_minor,
      before: thenBuckets[index]?.net_minor ?? 0,
      beforeStart: thenBuckets[index]?.bucket_start ?? "",
    }))

    return { total, stores, chart }
  }, [current.data, before.data, scope.store])

  return {
    data: derived,
    /// The two reads themselves, for a table's reload stamp
    /// (`refresh={trade.reads}`).
    reads: [current, before],
  }
}
