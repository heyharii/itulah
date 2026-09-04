import {
  bucketLabel,
  bucketTitle,
  type Comparison,
  type SalesBucket,
} from "@itulah/contract/reporting"

import { BandLegend, BandStack, type ChartRow } from "@/components/ui/chart"
import { Card } from "@/components/ui/card"
import { count, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Delta } from "@/screens/sales/delta"
import {
  SALES_KINDS,
  type SalesKind,
  type SalesMatrix,
} from "@/screens/sales/matrix"

/// What the fleet took, and what it is being measured against.
///
/// The three totals ARE the control. A reader who wants to know what the fleet
/// took reads the number; a reader who wants the shape of it over time presses
/// the same number and the chart follows. Three separate charts would be three
/// axes to re-read for measures that are the same shape over the same days.
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
  const rows: ChartRow[] = matrix.buckets.map((start) => {
    // Assembled and then spread, because a `ChartRow`'s index signature is
    // read-only — the rows a chart is handed are data it must not mutate.
    const values: Record<string, number> = {}
    for (const band of matrix.bands) {
      values[band.key] = matrix.bandValue(band.key, start, kind)
    }
    return { bucket: start, ...values }
  })

  const format = (value: number) =>
    kind === "gross_minor" ? money(value) : count(value)

  const one = matrix.bands.length === 1 ? matrix.bands[0] : null

  return (
    <Card className="mb-[1.125rem] overflow-hidden">
      <div className="flex flex-col items-stretch border-b border-hairline sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-0.5 px-4 py-3">
          {/* "The fleet" is a lie about a chart showing one shop, and the
              shop's own name is the first thing somebody who narrowed to it
              wants confirmed. */}
          <span className="text-card-title font-semibold text-ink">
            {one !== null ? one.label : "The fleet, by shop"}
          </span>
          <span className="text-[0.71875rem] text-mute">
            {matrix.buckets.length === 0
              ? "No period in this span."
              : `${bucketTitle(matrix.buckets[0], bucket)} — ${bucketTitle(
                  matrix.buckets[matrix.buckets.length - 1],
                  bucket
                )}`}
          </span>
        </div>
        <div className="flex border-t border-hairline sm:border-t-0">
          {SALES_KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              aria-pressed={kind === option.kind}
              onClick={() => onKindChange(option.kind)}
              className={cn(
                "flex flex-1 cursor-pointer flex-col justify-center gap-1 border-l border-hairline px-4 py-2.5 text-left transition-colors",
                kind === option.kind ? "bg-soft" : "hover:bg-soft"
              )}
            >
              <span className="text-eyebrow font-semibold text-mute uppercase">
                {option.label}
              </span>
              <span className="text-metric leading-none font-semibold text-ink tabular-nums">
                {option.kind === "gross_minor"
                  ? money(matrix.grandTotal(option.kind))
                  : count(matrix.grandTotal(option.kind))}
              </span>
              {before !== undefined && (
                <Delta
                  now={matrix.grandTotal(option.kind)}
                  before={before.grandTotal(option.kind)}
                  against={comparison.full}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-3 pt-2.5 pb-3.5">
        {matrix.bands.length === 0 ? (
          <p className="py-12 text-center text-meta text-body">
            No shop sold anything in this span.
          </p>
        ) : (
          <>
            {matrix.bands.length > 1 && <BandLegend bands={matrix.bands} />}
            <BandStack
              rows={rows}
              bands={matrix.bands}
              format={format}
              labelOf={(start) => bucketLabel(start, bucket)}
              titleOf={(start) => bucketTitle(start, bucket)}
              totalLabel={one !== null ? one.label : "Fleet"}
            />
          </>
        )}
      </div>
    </Card>
  )
}
