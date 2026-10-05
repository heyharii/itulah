import {
  bucketEnd,
  bucketTitle,
  isoDate,
  type Comparison,
  type SalesBucket,
} from "@itulah/contract/reporting"
import { ChevronRight } from "lucide-react"

import { Pill } from "@/components/ui/pill"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Delta } from "@/screens/sales/delta"
import { showSales, type SalesMatrix } from "@/screens/sales/matrix"
import { useStackLabels } from "@/lib/stack-table"

/// The trading day, and which shops made it.
///
/// **This used to be shops down the side and periods across the top**, one
/// measure at a time, and it was the wrong way round for the question it gets
/// opened with. Nobody starts at a shop; they start at a day — yesterday, last
/// Saturday, the day the promotion began — and then ask which branch is the
/// reason. So a day is a row, every metric is a column, and the shops are
/// folded underneath the day they traded on.
///
/// The other thing that changes with the transpose: a period can now carry ALL
/// the measures at once instead of one at a time. The old grid could not — a
/// column was a date, so a second measure needed a second grid — which is why
/// takings, transactions, average transaction, units and units per sale all
/// appear here and the picker above only decides what the chart draws.
///
/// Every figure comes from `matrix.ts`, which is the same index the chart is
/// built from, so a total here cannot disagree with a height up there.

/// The two columns that do not scroll away.
///
/// Pinned in pixels rather than in `ch`, because the second one's `left` offset
/// has to be exactly the first one's width; a unit that resolves against the
/// font leaves a seam that moves as you scroll.
const WHEN = 208
const TAKINGS = 152
/// The comparison. Not sticky like the two above, but fixed all the same: an
/// arrow and a percentage are five characters, and left to size itself the
/// column wrapped them onto two lines on a narrow screen.
const DELTA = 78

export function SalesTable({
  matrix,
  before,
  comparison,
  bucket,
  expanded,
  onToggle,
  onOpen,
  onFocus,
}: {
  matrix: SalesMatrix
  /// The same shops over the span being compared against, or undefined while
  /// it is still being fetched. The figures render either way — a comparison
  /// that has not arrived must not hold up the number it qualifies.
  before?: SalesMatrix
  comparison: Comparison
  bucket: SalesBucket
  /// Which days are showing their shops. Held by the screen rather than here
  /// so it survives a re-render, and deliberately NOT in the URL: it is a
  /// thing a reader opens and closes while reading one span, like the measure
  /// the chart is drawn in, rather than a question worth sending to somebody.
  expanded: ReadonlySet<string>
  onToggle: (bucketStart: string) => void
  /// A shop and a span — one day, or the whole range from the footer.
  onOpen: (cell: { siteId: string; from: string; to: string }) => void
  /// Narrow the whole screen to one shop.
  onFocus: (siteId: string) => void
}) {
  // Newest first. A register of trading days is read from the top: the day
  // somebody wants is almost always the most recent one, and scrolling four
  // hundred rows to reach it is the failure the old left-to-right axis had.
  const order = [...matrix.buckets].reverse()
  const stack = useStackLabels()

  // The bucket today falls in is still being written by tills that are still
  // open, so every figure on that row is a part-day. It is drawn rather than
  // hidden — a manager watching the shop trade wants exactly that row — and
  // labelled, because an unlabelled part-day beside thirteen whole ones reads
  // as a collapse.
  const today = isoDate(new Date())
  const isLive = (start: string) =>
    start <= today && bucketEnd(start, bucket) >= today

  // A single shop is not a fleet: the roll-up row would repeat the shop rows
  // under it, and there would be nothing to expand into.
  const alone = matrix.rows.length === 1
  const only = alone ? matrix.rows[0] : null

  const HEAD =
    "sticky top-0 z-20 h-9 border-b border-hairline bg-canvas px-3 text-cell font-normal whitespace-nowrap text-body"
  const CELL = "border-b border-hairline px-3 py-2 text-right tabular-nums"

  return (
    <div className="max-h-[calc(100dvh-25rem)] min-h-0 overflow-auto rounded-card">
      {/* Stacks on a phone rather than scrolling a 750px matrix sideways
          inside a 320px card (`useStackLabels`). */}
      <table
        ref={stack}
        className="mini-stack w-full border-separate border-spacing-0 text-cell"
      >
        <thead>
          <tr>
            <th
              scope="col"
              className={`${HEAD} left-0 z-30 border-r text-left`}
              style={{ width: WHEN, minWidth: WHEN }}
            >
              {bucket === "day" ? "Day" : bucket === "week" ? "Week" : "Month"}
            </th>
            <th
              scope="col"
              className={`${HEAD} z-30 border-r text-right`}
              style={{ left: WHEN, width: TAKINGS, minWidth: TAKINGS }}
            >
              Takings
            </th>
            {before !== undefined && (
              <th
                scope="col"
                title={`Against ${comparison.full}`}
                className={`${HEAD} px-2 text-right whitespace-nowrap`}
                style={{ width: DELTA, minWidth: DELTA }}
              >
                {comparison.short}
              </th>
            )}
            <th scope="col" className={`${HEAD} text-right`}>
              Transactions
            </th>
            <th
              scope="col"
              title="Average transaction value — takings over transactions"
              className={`${HEAD} text-right`}
            >
              Avg transaction
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Units
            </th>
            <th
              scope="col"
              title="Units per transaction — how many pieces leave in an average basket"
              className={`${HEAD} text-right`}
            >
              UPT
            </th>
            {!alone && (
              <th
                scope="col"
                title="How many shops rang up a sale"
                className={`${HEAD} text-right`}
              >
                Shops
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {order.map((start) => {
            const open = expanded.has(start)
            const takings = matrix.bucketTotal(start, "gross_minor")
            // Aligned by POSITION and not by date, which is the same bargain
            // the chart makes: the comparison span starts on a different day —
            // that is the whole reason it was named — so the second day of one
            // is read against the second day of the other.
            const at = matrix.buckets.indexOf(start)
            const wasBucket = before?.buckets[at]
            const was =
              before === undefined || wasBucket === undefined
                ? null
                : before.bucketTotal(wasBucket, "gross_minor")

            // Only the shops that actually traded. A day showing thirteen rows
            // of dashes is a day nobody can read.
            const traded = matrix.rows
              .filter(
                (site) =>
                  matrix.siteValue(site.site_id, start, "sales_count") > 0
              )
              .sort(
                (left, right) =>
                  matrix.siteValue(right.site_id, start, "gross_minor") -
                  matrix.siteValue(left.site_id, start, "gross_minor")
              )

            return (
              <BucketRows
                key={start}
                start={start}
                open={open}
                live={isLive(start)}
                traded={traded}
                takings={takings}
                comparing={before !== undefined}
                was={was}
                comparison={comparison}
                bucket={bucket}
                matrix={matrix}
                alone={alone}
                onlySiteId={only?.site_id ?? null}
                onToggle={onToggle}
                onOpen={onOpen}
                onFocus={onFocus}
                cellClass={CELL}
              />
            )
          })}
        </tbody>

        {/* The whole span, under the days that make it up. The two divided
            columns are recomputed here rather than averaged down the column —
            a span's average transaction is its takings over its transactions,
            not the mean of fourteen daily averages. */}
        <tfoot>
          <tr>
            <th
              scope="row"
              className="sticky bottom-0 left-0 z-30 border-t border-r border-hairline bg-soft-2 px-3 py-2 text-left font-semibold text-ink"
              style={{ width: WHEN, minWidth: WHEN }}
            >
              {alone ? (only?.site_name ?? "This shop") : "Whole span"}
            </th>
            <td
              className="sticky bottom-0 z-30 border-t border-r border-hairline bg-soft-2 px-3 py-2 text-right font-semibold text-ink tabular-nums"
              style={{ left: WHEN, width: TAKINGS, minWidth: TAKINGS }}
            >
              {showSales("gross_minor", matrix.grandTotal("gross_minor"))}
            </td>
            {before !== undefined && (
              <td className="sticky bottom-0 z-20 border-t border-hairline bg-soft-2 px-2 py-2 text-right align-middle">
                <Delta
                  now={matrix.grandTotal("gross_minor")}
                  before={before.grandTotal("gross_minor")}
                  against={comparison.full}
                />
              </td>
            )}
            {(
              [
                "sales_count",
                "average_minor",
                "units_sold",
                "items_per_sale",
              ] as const
            ).map((kind) => (
              <td
                key={kind}
                className="sticky bottom-0 z-20 border-t border-hairline bg-soft-2 px-3 py-2 text-right font-medium text-ink tabular-nums"
              >
                {showSales(kind, matrix.grandTotal(kind))}
              </td>
            ))}
            {!alone && (
              <td className="sticky bottom-0 z-20 border-t border-hairline bg-soft-2 px-3 py-2 text-right font-medium text-ink tabular-nums">
                {count(
                  matrix.rows.filter(
                    (site) => matrix.siteTotal(site.site_id, "sales_count") > 0
                  ).length
                )}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/// One trading period, and the shops under it when it is open.
///
/// Split out because the day row and its shop rows share a hover group and a
/// dozen derived figures, and inlining both in the map above made the parent
/// unreadable rather than shorter.
function BucketRows({
  start,
  open,
  live,
  traded,
  takings,
  comparing,
  was,
  comparison,
  bucket,
  matrix,
  alone,
  onlySiteId,
  onToggle,
  onOpen,
  onFocus,
  cellClass,
}: {
  start: string
  open: boolean
  live: boolean
  traded: readonly { site_id: string; site_name: string }[]
  takings: number
  /// Whether the comparison COLUMN exists, which is not the same question as
  /// whether this row has a figure for it. The header draws the column from
  /// the first; a row that answered the second would shift every cell to its
  /// right by one on any span shorter than the one it is measured against.
  comparing: boolean
  was: number | null
  comparison: Comparison
  bucket: SalesBucket
  matrix: SalesMatrix
  alone: boolean
  onlySiteId: string | null
  onToggle: (start: string) => void
  onOpen: (cell: { siteId: string; from: string; to: string }) => void
  onFocus: (siteId: string) => void
  cellClass: string
}) {
  const span = { from: start, to: bucketEnd(start, bucket) }
  const quiet = takings === 0

  return (
    <>
      <tr className="group">
        <th
          scope="row"
          className="sticky left-0 z-10 border-r border-b border-hairline bg-canvas p-0 text-left font-medium transition-colors group-hover:bg-soft"
          style={{ width: WHEN, minWidth: WHEN }}
        >
          {/* One shop on screen has nothing to unfold into — the row IS the
              shop — so the day opens that shop's receipts instead. */}
          <button
            type="button"
            disabled={quiet && !alone}
            onClick={() =>
              alone && onlySiteId !== null
                ? onOpen({ siteId: onlySiteId, ...span })
                : onToggle(start)
            }
            title={
              alone
                ? `Open ${bucketTitle(start, bucket)}`
                : quiet
                  ? undefined
                  : `${traded.length} shop${traded.length === 1 ? "" : "s"} traded`
            }
            className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-2 text-left disabled:cursor-default"
          >
            {!alone && (
              <ChevronRight
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 text-line-ico transition-transform",
                  open && "rotate-90",
                  quiet && "opacity-0"
                )}
              />
            )}
            <span
              className={cn(
                "truncate",
                alone && "pl-1",
                quiet ? "text-mute" : "text-ink"
              )}
            >
              {bucketTitle(start, bucket)}
            </span>
            {live && (
              <Pill
                tone="accent"
                withDot
                className="ml-auto h-[1.25rem] px-1.5"
              >
                Live
              </Pill>
            )}
          </button>
        </th>

        <td
          className="sticky z-10 border-r border-b border-hairline bg-canvas px-3 py-2 text-right font-medium text-ink tabular-nums transition-colors group-hover:bg-soft"
          style={{ left: WHEN, width: TAKINGS, minWidth: TAKINGS }}
        >
          {quiet ? (
            <span className="text-faint">–</span>
          ) : (
            showSales("gross_minor", takings)
          )}
        </td>

        {comparing && (
          <td
            className={`${cellClass} bg-canvas px-2 align-middle whitespace-nowrap transition-colors group-hover:bg-soft`}
            style={{ width: DELTA, minWidth: DELTA }}
          >
            {was === null ? (
              // No counterpart period in the span being compared against.
              <span className="text-faint">·</span>
            ) : (
              <Delta now={takings} before={was} against={comparison.full} />
            )}
          </td>
        )}

        {(
          [
            "sales_count",
            "average_minor",
            "units_sold",
            "items_per_sale",
          ] as const
        ).map((kind) => {
          const value = matrix.bucketTotal(start, kind)
          return (
            <td
              key={kind}
              className={`${cellClass} bg-canvas text-text transition-colors group-hover:bg-soft`}
            >
              {value === 0 ? (
                <span className="text-faint">–</span>
              ) : (
                showSales(kind, value)
              )}
            </td>
          )
        })}

        {!alone && (
          <td
            className={`${cellClass} bg-canvas text-body transition-colors group-hover:bg-soft`}
          >
            {traded.length === 0 ? (
              <span className="text-faint">–</span>
            ) : (
              count(traded.length)
            )}
          </td>
        )}
      </tr>

      {open &&
        !alone &&
        traded.map((site) => (
          <tr key={site.site_id} className="group/shop">
            <th
              scope="row"
              className="sticky left-0 z-10 border-r border-b border-hairline bg-soft/40 p-0 text-left font-normal transition-colors group-hover/shop:bg-soft"
              style={{ width: WHEN, minWidth: WHEN }}
            >
              {/* The name narrows the whole screen to this shop; the takings
                  cell beside it opens this shop's day. Two different questions
                  about one row, and the old grid answered them the same way. */}
              <button
                type="button"
                onClick={() => onFocus(site.site_id)}
                title={`Show ${site.site_name} on its own`}
                className="flex w-full cursor-pointer items-center gap-2 py-1.5 pr-3 pl-[1.875rem] text-left"
              >
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-[2px]"
                  style={{ background: matrix.colourOf(site.site_id) }}
                />
                <span className="truncate text-body">{site.site_name}</span>
              </button>
            </th>

            <td
              className="sticky z-10 border-r border-b border-hairline bg-soft/40 p-0 transition-colors group-hover/shop:bg-soft"
              style={{ left: WHEN, width: TAKINGS, minWidth: TAKINGS }}
            >
              <button
                type="button"
                onClick={() => onOpen({ siteId: site.site_id, ...span })}
                title={`${site.site_name} · ${bucketTitle(start, bucket)} — open the receipts`}
                className="w-full cursor-pointer px-3 py-1.5 text-right text-text tabular-nums transition-colors hover:bg-soft-2"
              >
                {showSales(
                  "gross_minor",
                  matrix.siteValue(site.site_id, start, "gross_minor")
                )}
              </button>
            </td>

            {/* No per-shop comparison column. The shop's own day against the
                positionally-matching day of another span is a number nobody
                asked for, and drawing it would put thirteen arrows on a screen
                whose comparison is about the fleet. The cell is held open so
                the columns to its right stay under their headings. */}
            {comparing && (
              <td className="border-b border-hairline bg-soft/40 transition-colors group-hover/shop:bg-soft" />
            )}

            {(
              [
                "sales_count",
                "average_minor",
                "units_sold",
                "items_per_sale",
              ] as const
            ).map((kind) => (
              <td
                key={kind}
                className={`${cellClass} bg-soft/40 py-1.5 text-body transition-colors group-hover/shop:bg-soft`}
              >
                {showSales(kind, matrix.siteValue(site.site_id, start, kind))}
              </td>
            ))}

            <td className="border-b border-hairline bg-soft/40 transition-colors group-hover/shop:bg-soft" />
          </tr>
        ))}
    </>
  )
}
