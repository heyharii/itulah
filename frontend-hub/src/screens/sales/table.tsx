import {
  bucketEnd,
  bucketLabel,
  bucketTitle,
  type Comparison,
  type SalesBucket,
} from "@itulah/contract/reporting"

import { count, money } from "@/lib/format"
import { Delta } from "@/screens/sales/delta"
import type { SalesKind, SalesMatrix } from "@/screens/sales/matrix"

/// The width of the three columns that do not scroll away.
///
/// Pinned in pixels rather than in `ch` because each one's `left` offset has to
/// be exactly the sum of the widths before it; a unit that resolves against the
/// font would leave a seam that moves as you scroll.
///
/// `TOTAL` is wide enough for the biggest figure this column can hold — the
/// fleet's own year, eleven digits of rupiah — and that is a constraint rather
/// than a preference. A table lays itself out from its content, so a figure
/// wider than the column widens the column, and then the `left` offsets below
/// point INTO it: the comparison column parks on top of the total and clips it.
/// It looks like a rendering glitch and it is arithmetic.
const SHOP = 168
const TOTAL = 152
/// The comparison. Pinned with the other two: "which branch is having a bad
/// month" is the question this table gets opened for, and an answer that
/// scrolls out of sight is not one.
const DELTA = 72

/// Every shop against every period, with the periods scrolling under a shop
/// column that stays.
///
/// The chart above answers "how did the fleet trade"; this answers "which shop,
/// which week". They are the same numbers, and it matters that they are — this
/// is also the relief for a chart that draws only the five biggest shops by
/// name. Every shop has a row here, including the ones the chart folds into
/// Other, and every figure is a figure rather than a height.
export function SalesTable({
  matrix,
  before,
  comparison,
  bucket,
  kind,
  onOpen,
  onFocus,
}: {
  matrix: SalesMatrix
  /// The same shops over the span being compared against, or undefined while it
  /// is still being fetched. The figures render either way — a comparison that
  /// has not arrived must not hold up the number it qualifies.
  before?: SalesMatrix
  comparison: Comparison
  bucket: SalesBucket
  kind: SalesKind
  /// A shop and a span — one period, or the whole range from the total column.
  onOpen: (cell: { siteId: string; from: string; to: string }) => void
  /// Narrow the whole screen to one shop.
  onFocus: (siteId: string) => void
}) {
  const show = (value: number) => {
    if (value === 0) return <span className="text-faint">–</span>
    return exactly(value)
  }
  const exactly = (value: number) =>
    kind === "gross_minor" ? money(value) : count(value)

  const span = {
    from: matrix.buckets[0] ?? "",
    to: bucketEnd(matrix.buckets[matrix.buckets.length - 1] ?? "", bucket),
  }

  const HEAD =
    "sticky top-0 h-8 border-b border-hairline bg-canvas px-3 text-eyebrow font-semibold whitespace-nowrap text-mute uppercase"
  const FIGURE =
    "w-full cursor-pointer px-3 pt-1.5 text-right tabular-nums transition-colors hover:bg-soft-2 disabled:cursor-default disabled:hover:bg-transparent"

  return (
    <div className="max-h-[calc(100vh-22rem)] min-h-0 overflow-auto rounded-card">
      <table className="w-full border-separate border-spacing-0 text-cell">
        <thead>
          <tr>
            <th
              scope="col"
              className={`${HEAD} left-0 z-30 border-r text-left`}
              style={{ width: SHOP, minWidth: SHOP }}
            >
              Shop
            </th>
            <th
              scope="col"
              className={`${HEAD} z-30 border-r text-right`}
              style={{ left: SHOP, width: TOTAL, minWidth: TOTAL }}
            >
              Total
            </th>
            {before !== undefined && (
              <th
                scope="col"
                title={`Against ${comparison.full}`}
                className={`${HEAD} z-30 border-r px-2 text-right`}
                style={{ left: SHOP + TOTAL, width: DELTA, minWidth: DELTA }}
              >
                {comparison.short}
              </th>
            )}
            {matrix.buckets.map((start) => (
              <th
                key={start}
                scope="col"
                title={bucketTitle(start, bucket)}
                className={`${HEAD} z-20 text-right`}
              >
                {bucketLabel(start, bucket)}
              </th>
            ))}
          </tr>
        </thead>

        {/* One tbody per shop, so a shop and the span it is measured against
            hover together and the rule underneath separates shops rather than
            rows.

            Two rows rather than a percentage alone, because a percentage
            answers "how much" and hides "out of what". Ramadan against last
            Ramadan is the case that makes this obvious: +40% means nothing
            until you can see it is forty percent of a fortnight that was
            already the best fortnight of the year. */}
        {matrix.rows.map((site) => {
          const total = matrix.siteTotal(site.site_id, kind)
          const wasTotal = before?.siteTotal(site.site_id, kind) ?? 0
          return (
            <tbody key={site.site_id} className="group">
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-hairline bg-canvas p-0 text-left font-medium transition-colors group-hover:bg-soft"
                  style={{ width: SHOP, minWidth: SHOP }}
                >
                  {/* The name is the way to look at this shop and nothing
                      else. Somebody who has found the row they care about is
                      already pointing at it; sending them back to a picker to
                      say so again would be asking twice. */}
                  <button
                    type="button"
                    onClick={() => onFocus(site.site_id)}
                    title={`Show ${site.site_name} on its own`}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 pt-1.5 text-left"
                  >
                    <span
                      aria-hidden
                      className="size-[7px] shrink-0 rounded-[2px]"
                      style={{ background: matrix.colourOf(site.site_id) }}
                    />
                    <span className="truncate text-ink">{site.site_name}</span>
                  </button>
                </th>
                <td
                  className="sticky z-10 border-r border-hairline bg-canvas p-0 transition-colors group-hover:bg-soft"
                  style={{ left: SHOP, width: TOTAL, minWidth: TOTAL }}
                >
                  <button
                    type="button"
                    disabled={total === 0}
                    onClick={() =>
                      onOpen({
                        siteId: site.site_id,
                        from: span.from,
                        to: span.to,
                      })
                    }
                    className={`${FIGURE} font-medium text-ink`}
                  >
                    {show(total)}
                  </button>
                </td>
                {before !== undefined && (
                  <td
                    rowSpan={2}
                    className="sticky z-10 border-r border-b border-hairline bg-canvas px-2 text-right align-middle transition-colors group-hover:bg-soft"
                    style={{
                      left: SHOP + TOTAL,
                      width: DELTA,
                      minWidth: DELTA,
                    }}
                  >
                    <Delta
                      now={total}
                      before={wasTotal}
                      against={comparison.full}
                    />
                  </td>
                )}
                {matrix.buckets.map((start) => {
                  const value = matrix.siteValue(site.site_id, start, kind)
                  return (
                    <td
                      key={start}
                      className="bg-canvas p-0 transition-colors group-hover:bg-soft"
                    >
                      <button
                        type="button"
                        disabled={value === 0}
                        title={
                          value === 0
                            ? undefined
                            : `${site.site_name} · ${bucketTitle(start, bucket)} · ${exactly(value)}`
                        }
                        onClick={() =>
                          onOpen({
                            siteId: site.site_id,
                            from: start,
                            to: bucketEnd(start, bucket),
                          })
                        }
                        className={`${FIGURE} text-text`}
                      >
                        {show(value)}
                      </button>
                    </td>
                  )
                })}
              </tr>

              {before !== undefined && (
                <tr>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-b border-hairline bg-canvas px-3 pb-1.5 text-left font-normal transition-colors group-hover:bg-soft"
                    style={{ width: SHOP, minWidth: SHOP }}
                  >
                    {/* Indented past the swatch above it, so the eye reads it
                        as belonging to that shop rather than as another one. */}
                    <span className="block truncate pl-[0.9375rem] text-[0.65625rem] text-mute">
                      {comparison.full}
                    </span>
                  </th>
                  <td
                    className="sticky z-10 border-r border-b border-hairline bg-canvas p-0 transition-colors group-hover:bg-soft"
                    style={{ left: SHOP, width: TOTAL, minWidth: TOTAL }}
                  >
                    <button
                      type="button"
                      disabled={wasTotal === 0}
                      onClick={() =>
                        onOpen({
                          siteId: site.site_id,
                          from: comparison.from,
                          to: comparison.to,
                        })
                      }
                      className="w-full cursor-pointer px-3 pb-1.5 text-right text-[0.6875rem] text-body tabular-nums transition-colors hover:bg-soft-2 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      {show(wasTotal)}
                    </button>
                  </td>
                  {/* Aligned by POSITION, not by date. The comparison span
                      starts on a different day — that is the whole reason it
                      was named — so the second column of one is read against
                      the second column of the other: day two of this Ramadan
                      under day two of last. Where the spans are different
                      lengths the tail has no counterpart and says so. */}
                  {matrix.buckets.map((start, index) => {
                    const wasBucket = before.buckets[index]
                    const was =
                      wasBucket === undefined
                        ? null
                        : before.siteValue(site.site_id, wasBucket, kind)
                    return (
                      <td
                        key={start}
                        className="border-b border-hairline bg-canvas p-0 transition-colors group-hover:bg-soft"
                      >
                        {was === null || wasBucket === undefined ? (
                          <span className="block px-3 pb-1.5 text-right text-faint">
                            ·
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={was === 0}
                            title={
                              was === 0
                                ? undefined
                                : `${site.site_name} · ${bucketTitle(wasBucket, bucket)} · ${exactly(was)}`
                            }
                            onClick={() =>
                              onOpen({
                                siteId: site.site_id,
                                from: wasBucket,
                                to: bucketEnd(wasBucket, bucket),
                              })
                            }
                            className="w-full cursor-pointer px-3 pb-1.5 text-right text-[0.6875rem] text-body tabular-nums transition-colors hover:bg-soft-2 disabled:cursor-default disabled:hover:bg-transparent"
                          >
                            {show(was)}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )}
            </tbody>
          )
        })}

        {/* What the fleet did, under the shops that did it. Not clickable:
            there is no one shop to open, and a sheet about "everybody" would be
            this screen again.

            Absent when one shop is being looked at on its own, because then it
            is not a total of anything — it is the row above it, again. */}
        <tfoot hidden={matrix.rows.length < 2}>
          <tr>
            <th
              scope="row"
              className="sticky bottom-0 left-0 z-30 border-t border-r border-hairline bg-soft-2 px-3 pt-1.5 text-left font-semibold text-ink"
              style={{ width: SHOP, minWidth: SHOP }}
            >
              Fleet
            </th>
            <td
              className="sticky bottom-0 z-30 border-t border-r border-hairline bg-soft-2 px-3 pt-1.5 text-right font-semibold text-ink tabular-nums"
              style={{ left: SHOP, width: TOTAL, minWidth: TOTAL }}
            >
              {show(matrix.grandTotal(kind))}
            </td>
            {before !== undefined && (
              <td
                rowSpan={2}
                className="sticky bottom-0 z-30 border-t border-r border-hairline bg-soft-2 px-2 text-right align-middle"
                style={{ left: SHOP + TOTAL, width: DELTA, minWidth: DELTA }}
              >
                <Delta
                  now={matrix.grandTotal(kind)}
                  before={before.grandTotal(kind)}
                  against={comparison.full}
                />
              </td>
            )}
            {matrix.buckets.map((start) => (
              <td
                key={start}
                className="sticky bottom-0 z-20 border-t border-hairline bg-soft-2 px-3 pt-1.5 text-right font-medium text-ink tabular-nums"
              >
                {show(matrix.bucketTotal(start, kind))}
              </td>
            ))}
          </tr>
          {/* The fleet gets the same two rows as the shops above it, for the
              same reason: a total is only a comparison if you can see what it
              is being compared with. */}
          {before !== undefined && (
            <tr>
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-30 border-r border-hairline bg-soft-2 px-3 pb-1.5 text-left font-normal"
                style={{ width: SHOP, minWidth: SHOP }}
              >
                <span className="block truncate text-[0.65625rem] text-mute">
                  {comparison.full}
                </span>
              </th>
              <td
                className="sticky bottom-0 z-30 border-r border-hairline bg-soft-2 px-3 pb-1.5 text-right text-[0.6875rem] text-body tabular-nums"
                style={{ left: SHOP, width: TOTAL, minWidth: TOTAL }}
              >
                {show(before.grandTotal(kind))}
              </td>
              {matrix.buckets.map((start, index) => {
                const wasBucket = before.buckets[index]
                return (
                  <td
                    key={start}
                    className="sticky bottom-0 z-20 bg-soft-2 px-3 pb-1.5 text-right text-[0.6875rem] text-body tabular-nums"
                  >
                    {wasBucket === undefined ? (
                      <span className="text-faint">·</span>
                    ) : (
                      show(before.bucketTotal(wasBucket, kind))
                    )}
                  </td>
                )
              })}
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}
