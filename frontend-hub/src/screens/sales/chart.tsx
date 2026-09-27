import {
  bucketLabel,
  bucketTitle,
  type Comparison,
  type SalesBucket,
} from "@itulah/contract/reporting"

import { LineSeries, type ChartRow } from "@/components/ui/chart"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Delta } from "@/screens/sales/delta"
import {
  SALES_KINDS,
  showSales,
  type SalesKind,
  type SalesMatrix,
} from "@/screens/sales/matrix"

/// How the fleet traded, drawn as a line.
///
/// **It was a stack of bars, one band per shop.** That answered "which branch
/// is the reason" in the chart itself, and it paid for the answer with the one
/// thing a sales chart is actually for: the SHAPE of the trade. A stacked
/// column tells you a total and it tells you a composition, and it is bad at
/// the trend running through both — the eye has to compare the tops of columns
/// whose bases keep moving. A line has no bases.
///
/// The per-shop answer did not disappear, it moved down: every day in the table
/// underneath unfolds into the shops that made it, each with its own figure
/// rather than its own height. That is the better home for it, because a fleet
/// of thirteen cannot be told apart by hue anyway.
///
/// The five totals ARE the control. A reader who wants to know what the fleet
/// took reads the number; a reader who wants its shape over time presses the
/// same number and the line follows. Five separate charts would be five axes to
/// re-read for measures that run over the same days.
export function SalesChart({
  matrix,
  before,
  comparison,
  bucket,
  kind,
  onKindChange,
}: {
  matrix: SalesMatrix
  before?: SalesMatrix
  comparison: Comparison
  bucket: SalesBucket
  kind: SalesKind
  onKindChange: (kind: SalesKind) => void
}) {
  /// One point per bucket, with the comparison's matching point beside it.
  ///
  /// Aligned by POSITION and not by date — the comparison span starts on a
  /// different day, which is the whole reason it was named — so `was_bucket`
  /// travels with the row and the tooltip names it rather than letting it
  /// borrow the heading.
  const rows: ChartRow[] = matrix.buckets.map((start, index) => {
    const wasBucket = before?.buckets[index]
    return {
      bucket: start,
      now: matrix.bucketTotal(start, kind),
      was:
        before === undefined || wasBucket === undefined
          ? 0
          : before.bucketTotal(wasBucket, kind),
      was_bucket: wasBucket ?? "",
    }
  })

  const one = matrix.rows.length === 1 ? matrix.rows[0] : null
  const measure = SALES_KINDS.find((option) => option.kind === kind)

  return (
    <Card className="mb-[1.125rem] overflow-hidden">
      <div className="flex flex-col justify-center gap-0.5 border-b border-hairline px-4 py-3">
        {/* "The fleet" is a lie about a chart showing one shop, and the shop's
            own name is the first thing somebody who narrowed to it wants
            confirmed. */}
        <span className="text-card-title font-semibold text-ink">
          {one !== null ? one.site_name : "The fleet"}
        </span>
        <span className="text-[0.875rem] text-mute">
          {matrix.buckets.length === 0
            ? "No period in this span."
            : `${bucketTitle(matrix.buckets[0], bucket)} — ${bucketTitle(
                matrix.buckets[matrix.buckets.length - 1],
                bucket
              )}`}
        </span>
      </div>

      {/* Five across on a wide screen, two on a phone. A tile is a figure and a
          button at once, and which one is pressed decides the line below. */}
      <div className="grid grid-cols-2 border-b border-hairline sm:grid-cols-3 lg:grid-cols-5">
        {SALES_KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            aria-pressed={kind === option.kind}
            onClick={() => onKindChange(option.kind)}
            className={cn(
              "flex cursor-pointer flex-col justify-start gap-1 border-t border-l border-hairline px-4 py-2.5 text-left transition-colors first:border-l-0 sm:border-t-0",
              kind === option.kind ? "bg-soft" : "hover:bg-soft"
            )}
          >
            <span className="text-eyebrow font-semibold text-mute uppercase">
              {option.label}
            </span>
            <span className="text-metric leading-none font-semibold text-ink tabular-nums">
              {showSales(option.kind, matrix.grandTotal(option.kind))}
            </span>
            {before === undefined ? (
              <span className="text-[0.875rem] text-faint">{option.hint}</span>
            ) : (
              <Delta
                now={matrix.grandTotal(option.kind)}
                before={before.grandTotal(option.kind)}
                against={comparison.full}
              />
            )}
          </button>
        ))}
      </div>

      <div className="px-3 pt-3 pb-3.5">
        {matrix.buckets.length === 0 ? (
          <p className="py-12 text-center text-meta text-body">
            No shop sold anything in this span.
          </p>
        ) : (
          <LineSeries
            rows={rows}
            dataKey="now"
            label={measure?.label ?? "Takings"}
            ghost={
              before === undefined
                ? undefined
                : {
                    dataKey: "was",
                    labelOf: (row) =>
                      row.was_bucket === ""
                        ? comparison.short
                        : bucketTitle(String(row.was_bucket), bucket),
                  }
            }
            format={(value) => showSales(kind, value)}
            labelOf={(start) => bucketLabel(start, bucket)}
            titleOf={(start) => bucketTitle(start, bucket)}
          />
        )}
      </div>
    </Card>
  )
}
