import { Delta } from "@/components/sales/delta"
import type { SalesMatrix, SalesSeriesKind } from "@/components/sales/matrix"
import { compactMoney, money, units } from "@/lib/money"
import type { Comparison, SalesBucket } from "@/lib/sales"
import { bucketEnd, bucketLabel, bucketTitle } from "@/lib/sales"

/// The width of the two columns that do not scroll away.
///
/// Pinned in pixels rather than in `ch` because the second column's `left`
/// offset has to be exactly the first column's width; a unit that resolves
/// against the font would leave a seam that moves as you scroll.
const SHOP_COLUMN = 184
const TOTAL_COLUMN = 116
/// The comparison column. Pinned with the other two: "which branch is having a
/// bad month" is the question this table gets opened for, and an answer that
/// scrolls out of sight is not one.
const DELTA_COLUMN = 74

/// Every shop against every period, with the periods scrolling under a shop
/// column that stays.
///
/// The chart above answers "how is the fleet doing"; this answers "which shop,
/// which week". They are the same numbers, and it matters that they are — the
/// table is also the relief for a stacked chart whose lighter bands sit under
/// 3:1 against the card, and a reader who cannot tell aqua from yellow reads
/// the figure here instead of guessing at the band.
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
  /// The same shops over the span being compared against.
  before?: SalesMatrix
  comparison: Comparison
  bucket: SalesBucket
  kind: SalesSeriesKind
  /// A shop and a span — one period, or the whole range from the total column.
  /// What was clicked, as the three things that identify it. The title is the
  /// screen's to write: it has to survive a reload from the URL alone, and a
  /// shop's name is not in the address.
  onOpen: (cell: { siteId: string; from: string; to: string }) => void
  /// Narrow the whole screen to one shop.
  onFocus: (siteId: string) => void
}) {
  const show = (value: number, exact = false) => {
    if (value === 0) {
      return <span className="text-muted-foreground/50">–</span>
    }
    if (kind !== "gross_minor") {
      return units(value)
    }
    return exact ? money(value) : compactMoney(value)
  }
  const exactly = (value: number) =>
    kind === "gross_minor" ? money(value) : units(value)

  const span = {
    from: matrix.buckets[0] ?? "",
    to: bucketEnd(matrix.buckets[matrix.buckets.length - 1] ?? "", bucket),
  }

  return (
    <div className="os-card min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 h-9 border-r border-b bg-card px-3 text-left font-medium text-muted-foreground"
              style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
            >
              Shop
            </th>
            <th
              scope="col"
              className="sticky top-0 z-30 h-9 border-r border-b bg-card px-3 text-right font-medium text-muted-foreground"
              style={{
                left: SHOP_COLUMN,
                width: TOTAL_COLUMN,
                minWidth: TOTAL_COLUMN,
              }}
            >
              Total
            </th>
            {before !== undefined && (
              <th
                scope="col"
                title={`Against ${comparison.full}`}
                className="sticky top-0 z-30 h-9 border-r border-b bg-card px-2 text-right font-medium text-muted-foreground"
                style={{
                  left: SHOP_COLUMN + TOTAL_COLUMN,
                  width: DELTA_COLUMN,
                  minWidth: DELTA_COLUMN,
                }}
              >
                {comparison.short}
              </th>
            )}
            {matrix.buckets.map((start) => (
              <th
                key={start}
                scope="col"
                title={bucketTitle(start, bucket)}
                className="sticky top-0 z-20 h-9 border-b bg-card px-3 text-right font-medium whitespace-nowrap text-muted-foreground"
              >
                {bucketLabel(start, bucket)}
              </th>
            ))}
          </tr>
        </thead>

        {/* One tbody per shop, so a shop and the span it is being compared
            against hover together and the rule underneath separates shops
            rather than rows.

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
                  className="sticky left-0 z-10 border-r bg-card p-0 text-left font-medium transition-colors group-hover:bg-muted"
                  style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
                >
                  {/* The name is the way to look at this shop and nothing
                      else. Somebody who has found the row they care about is
                      already pointing at it; making them go back up to a
                      dropdown to say so again would be asking twice. */}
                  <button
                    type="button"
                    onClick={() => onFocus(site.site_id)}
                    title={`Show ${site.site_name} on its own`}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 pt-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {/* The band's colour, taken from the chart's own variable
                        so the swatch is right in both themes rather than in
                        whichever one it was written for. */}
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: `var(--color-${matrix.bandKeyOf(site.site_id)})`,
                      }}
                    />
                    <span className="truncate">{site.site_name}</span>
                  </button>
                </th>
                <td
                  className="sticky z-10 border-r bg-card p-0 transition-colors group-hover:bg-muted"
                  style={{
                    left: SHOP_COLUMN,
                    width: TOTAL_COLUMN,
                    minWidth: TOTAL_COLUMN,
                  }}
                >
                  <button
                    type="button"
                    disabled={total === 0}
                    title={total === 0 ? undefined : exactly(total)}
                    onClick={() =>
                      onOpen({
                        siteId: site.site_id,
                        from: span.from,
                        to: span.to,
                      })
                    }
                    className="w-full cursor-pointer px-3 pt-1.5 text-right font-mono font-semibold tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {show(total, true)}
                  </button>
                </td>
                {before !== undefined && (
                  <td
                    rowSpan={2}
                    className="sticky z-10 border-r border-b bg-card px-2 text-right align-middle transition-colors group-hover:bg-muted"
                    style={{
                      left: SHOP_COLUMN + TOTAL_COLUMN,
                      width: DELTA_COLUMN,
                      minWidth: DELTA_COLUMN,
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
                      className="bg-card p-0 transition-colors group-hover:bg-muted"
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
                        className="w-full cursor-pointer px-3 pt-1.5 text-right font-mono tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {show(value)}
                      </button>
                    </td>
                  )
                })}
              </tr>

              {before !== undefined && (
                <tr className="text-muted-foreground">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-b bg-card px-3 pb-1.5 text-left font-normal transition-colors group-hover:bg-muted"
                    style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
                  >
                    {/* Indented past the swatch above it, so the eye reads it
                        as belonging to that shop rather than as another one. */}
                    <span className="block truncate pl-4 text-[10.5px]">
                      {comparison.full}
                    </span>
                  </th>
                  <td
                    className="sticky z-10 border-r border-b bg-card p-0 transition-colors group-hover:bg-muted"
                    style={{
                      left: SHOP_COLUMN,
                      width: TOTAL_COLUMN,
                      minWidth: TOTAL_COLUMN,
                    }}
                  >
                    <button
                      type="button"
                      disabled={wasTotal === 0}
                      title={wasTotal === 0 ? undefined : exactly(wasTotal)}
                      onClick={() =>
                        onOpen({
                          siteId: site.site_id,
                          from: comparison.from,
                          to: comparison.to,
                        })
                      }
                      className="w-full cursor-pointer px-3 pb-1.5 text-right font-mono tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      {show(wasTotal, true)}
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
                        className="border-b bg-card p-0 transition-colors group-hover:bg-muted"
                      >
                        {was === null || wasBucket === undefined ? (
                          <span className="block px-3 pb-1.5 text-right text-muted-foreground/40">
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
                            className="w-full cursor-pointer px-3 pb-1.5 text-right font-mono text-[11px] tabular-nums transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
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
            there is no one shop to open, and a sheet about "everybody" would
            be this screen again.

            Absent when one shop is being looked at on its own, because then it
            is not a total of anything — it is the row above it, again. */}
        <tfoot hidden={matrix.rows.length < 2}>
          <tr>
            <th
              scope="row"
              className="sticky bottom-0 left-0 z-30 border-t border-r bg-secondary px-3 pt-1.5 text-left font-semibold"
              style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
            >
              Fleet
            </th>
            <td
              className="sticky bottom-0 z-30 border-t border-r bg-secondary px-3 pt-1.5 text-right font-mono font-semibold tabular-nums"
              style={{
                left: SHOP_COLUMN,
                width: TOTAL_COLUMN,
                minWidth: TOTAL_COLUMN,
              }}
            >
              {show(matrix.grandTotal(kind), true)}
            </td>
            {before !== undefined && (
              <td
                rowSpan={2}
                className="sticky bottom-0 z-30 border-t border-r bg-secondary px-2 text-right align-middle"
                style={{
                  left: SHOP_COLUMN + TOTAL_COLUMN,
                  width: DELTA_COLUMN,
                  minWidth: DELTA_COLUMN,
                }}
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
                title={exactly(matrix.bucketTotal(start, kind))}
                className="sticky bottom-0 z-20 border-t bg-secondary px-3 pt-1.5 text-right font-mono font-medium tabular-nums"
              >
                {show(matrix.bucketTotal(start, kind))}
              </td>
            ))}
          </tr>
          {/* The fleet gets the same two rows as the shops above it, for the
              same reason: a total is only a comparison if you can see what it
              is being compared with. */}
          {before !== undefined && (
            <tr className="text-muted-foreground">
              <th
                scope="row"
                className="sticky bottom-0 left-0 z-30 border-r bg-secondary px-3 pb-1.5 text-left font-normal"
                style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
              >
                <span className="block truncate text-[10.5px]">
                  {comparison.full}
                </span>
              </th>
              <td
                className="sticky bottom-0 z-30 border-r bg-secondary px-3 pb-1.5 text-right font-mono tabular-nums"
                style={{
                  left: SHOP_COLUMN,
                  width: TOTAL_COLUMN,
                  minWidth: TOTAL_COLUMN,
                }}
              >
                {show(before.grandTotal(kind), true)}
              </td>
              {matrix.buckets.map((start, index) => {
                const wasBucket = before.buckets[index]
                return (
                  <td
                    key={start}
                    className="sticky bottom-0 z-20 bg-secondary px-3 pb-1.5 text-right font-mono text-[11px] tabular-nums"
                  >
                    {wasBucket === undefined ? (
                      <span className="text-muted-foreground/40">·</span>
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
