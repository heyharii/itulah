import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import type { SalesSeriesKind } from "@/components/sales/matrix"
import { buildMatrix, chartConfig } from "@/components/sales/matrix"
import type { SalesScope } from "@/components/sales/sale-detail-sheet"
import { SaleDetailSheet } from "@/components/sales/sale-detail-sheet"
import { SalesChart } from "@/components/sales/sales-chart"
import { SalesTable } from "@/components/sales/sales-table"
import { Button } from "@/components/ui/button"
import { ChartStyle } from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { compactMoney } from "@/lib/money"
import type { SalesBucket } from "@/lib/sales"
import { SALES_BUCKETS, SALES_SPANS, salesSeries, salesSeriesKey, spanOf } from "@/lib/sales"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo, useState } from "react"

/// The one id under which this screen's colours are defined.
///
/// Both the chart and the table read `--color-<shop>` from it, so a shop's
/// swatch in the table is the same declaration as its band in the chart rather
/// than a copy that would be right in one theme and stale in the other.
const CHART_ID = "sales-fleet"

/// What the shops sold, and which of them sold it.
///
/// Until this screen existed the centre could publish a price and had no way
/// to ask what it earned. The daily report answered that for one shop on one
/// day — a report you had to already know to ask for — and the sales list
/// answered it for the last five hundred receipts regardless of when or where.
/// Neither is the question head office actually has, which is "how did the
/// fleet trade this month, and which branch is the reason".
///
/// One granularity for the chart and the table on purpose. They show the same
/// numbers, and two controls that could disagree would put two answers to one
/// question on one screen.
export interface SalesSearch {
  bucket?: SalesBucket
  span?: number
  /// One shop, or the whole fleet when absent.
  shop?: string
}

export function SalesView() {
  // In the URL for the reason the discussion filters are: a range somebody has
  // narrowed down is a thing they send to a colleague, and a reload should not
  // throw it away.
  const search = useSearch({ from: "/sales" }) as SalesSearch
  const navigate = useNavigate()
  const bucket: SalesBucket = search.bucket ?? "day"
  const spans = SALES_SPANS[bucket]
  const span = spans.includes(search.span ?? 0) ? (search.span as number) : spans[2] ?? spans[0]
  const shop = search.shop ?? null

  const [kind, setKind] = useState<SalesSeriesKind>("gross_minor")
  const [scope, setScope] = useState<SalesScope | null>(null)

  const range = useMemo(() => spanOf(bucket, span), [bucket, span])
  const series = useQuery({
    queryKey: salesSeriesKey(range),
    queryFn: ({ signal }) => salesSeries(range, signal),
    // Today's column is still being written by tills that are still open.
    refetchInterval: 60_000,
  })
  // Two matrices over one fetch. The shown one is narrowed to the chosen shop;
  // the fleet one keeps every shop, so the picker still lists the branches the
  // filter is currently hiding and colours stay handed out over the whole
  // fleet.
  const matrix = useMemo(() => buildMatrix(series.data, shop), [series.data, shop])
  const fleet = useMemo(() => buildMatrix(series.data), [series.data])
  const config = useMemo(() => chartConfig(fleet), [fleet])

  const go = (next: Partial<SalesSearch>) =>
    void navigate({
      to: "/sales",
      search: (previous: SalesSearch) => {
        const bucketNext = next.bucket ?? previous.bucket ?? "day"
        const allowed = SALES_SPANS[bucketNext]
        // A span is a count of buckets, so it does not survive a change of
        // bucket: "30" means a readable month of days and an unreadable two
        // and a half years of months. Switching resets to that bucket's own
        // default rather than carrying a number that means something else.
        const spanNext =
          next.bucket !== undefined
            ? (allowed[2] ?? allowed[0])
            : (next.span ?? previous.span ?? allowed[2] ?? allowed[0])
        const shopNext = "shop" in next ? next.shop : previous.shop
        return {
          bucket: bucketNext,
          span: spanNext,
          shop: shopNext === "" ? undefined : shopNext,
        }
      },
    })

  const focused = fleet.rows.find((site) => site.site_id === shop)

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="Sales"
        subtitle={
          series.isPending
            ? "loading…"
            : `${range.from} → ${range.to} · ${compactMoney(matrix.grandTotal("gross_minor"))}`
        }
      >
        {/* Which shop, then how wide a column, then how many of them. Reading
            order matches the dependency: the span's options are decided by the
            bucket beside it. */}
        <Select
          value={shop ?? ALL_SHOPS}
          onValueChange={(value) =>
            go({ shop: value === ALL_SHOPS ? undefined : String(value) })
          }
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue>{focused?.site_name ?? "All shops"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SHOPS}>All shops</SelectItem>
            {fleet.rows.map((site) => (
              <SelectItem key={site.site_id} value={site.site_id}>
                {site.site_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex overflow-hidden rounded-4xl border" role="group" aria-label="Period">
          {SALES_BUCKETS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={bucket === option}
              onClick={() => go({ bucket: option })}
              className={cn(
                "h-8 cursor-pointer px-3 text-xs font-medium capitalize transition-colors not-first:border-l",
                bucket === option
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {/* The label says what the number means. A trigger reading "30" is a
            number nobody can act on — days? shops? sales? */}
        <Select value={String(span)} onValueChange={(value) => go({ span: Number(value) })}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue>{spanLabel(span, bucket)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {spans.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {spanLabel(count, bucket)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ScreenHeader>

      {series.isPending ? (
        <ScreenState>Adding up the tills…</ScreenState>
      ) : series.isError ? (
        <ScreenState
          tone="problem"
          action={
            <Button size="sm" variant="outline" onClick={() => void series.refetch()}>
              Try again
            </Button>
          }
        >
          {series.error instanceof ApiError
            ? series.error.message
            : "The sales figures could not be read."}
        </ScreenState>
      ) : fleet.rows.length === 0 ? (
        <ScreenState>
          No shop is registered, so there is nothing to have sold anything.
        </ScreenState>
      ) : (
        <div data-chart={CHART_ID} className="flex min-h-0 flex-1 flex-col">
          <ChartStyle id={CHART_ID} config={config} />
          <SalesChart matrix={matrix} bucket={bucket} kind={kind} onKindChange={setKind} />
          <SalesTable
            matrix={matrix}
            bucket={bucket}
            kind={kind}
            onOpen={setScope}
            onFocus={(siteId) => go({ shop: siteId === shop ? undefined : siteId })}
          />
        </div>
      )}

      <SaleDetailSheet scope={scope} onClose={() => setScope(null)} />
    </AppShell>
  )
}

/// The picker's value for "do not filter".
///
/// A sentinel rather than an empty string: base-ui reads `""` as "nothing is
/// selected" and would show the placeholder instead of the option.
const ALL_SHOPS = "__all__"

function spanLabel(count: number, bucket: SalesBucket): string {
  return `Last ${count} ${bucket}${count === 1 ? "" : "s"}`
}
