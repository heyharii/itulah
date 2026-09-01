import type { SalesMatrix, SalesSeriesKind } from "@/components/sales/matrix"
import { compactMoney, money, units } from "@/lib/money"
import type { SalesBucket } from "@/lib/sales"
import { bucketEnd, bucketLabel, bucketTitle } from "@/lib/sales"

/// The width of the two columns that do not scroll away.
///
/// Pinned in pixels rather than in `ch` because the second column's `left`
/// offset has to be exactly the first column's width; a unit that resolves
/// against the font would leave a seam that moves as you scroll.
const SHOP_COLUMN = 184
const TOTAL_COLUMN = 116

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
  bucket,
  kind,
  onOpen,
  onFocus,
}: {
  matrix: SalesMatrix
  bucket: SalesBucket
  kind: SalesSeriesKind
  /// A shop and a span — one period, or the whole range from the total column.
  onOpen: (scope: { siteId: string; from: string; to: string; title: string }) => void
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
  const exactly = (value: number) => (kind === "gross_minor" ? money(value) : units(value))

  const span = {
    from: matrix.buckets[0] ?? "",
    to: bucketEnd(matrix.buckets[matrix.buckets.length - 1] ?? "", bucket),
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="bg-card text-muted-foreground sticky top-0 left-0 z-30 h-9 border-r border-b px-3 text-left font-medium"
              style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
            >
              Shop
            </th>
            <th
              scope="col"
              className="bg-card text-muted-foreground sticky top-0 z-30 h-9 border-r border-b px-3 text-right font-medium"
              style={{ left: SHOP_COLUMN, width: TOTAL_COLUMN, minWidth: TOTAL_COLUMN }}
            >
              Total
            </th>
            {matrix.buckets.map((start) => (
              <th
                key={start}
                scope="col"
                title={bucketTitle(start, bucket)}
                className="bg-card text-muted-foreground sticky top-0 z-20 h-9 border-b px-3 text-right font-medium whitespace-nowrap"
              >
                {bucketLabel(start, bucket)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {matrix.rows.map((site) => {
            const total = matrix.siteTotal(site.site_id, kind)
            return (
              <tr key={site.site_id} className="group">
                <th
                  scope="row"
                  className="bg-card group-hover:bg-muted sticky left-0 z-10 border-r border-b p-0 text-left font-medium transition-colors"
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
                    className="focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
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
                  className="bg-card group-hover:bg-muted sticky z-10 border-r border-b p-0 transition-colors"
                  style={{ left: SHOP_COLUMN, width: TOTAL_COLUMN, minWidth: TOTAL_COLUMN }}
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
                        title: `${site.site_name} · whole range`,
                      })
                    }
                    className="hover:bg-muted focus-visible:ring-ring w-full cursor-pointer px-3 py-1.5 text-right font-mono font-semibold tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {show(total, true)}
                  </button>
                </td>
                {matrix.buckets.map((start) => {
                  const value = matrix.siteValue(site.site_id, start, kind)
                  return (
                    <td
                      key={start}
                      className="bg-card group-hover:bg-muted border-b p-0 transition-colors"
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
                            title: `${site.site_name} · ${bucketTitle(start, bucket)}`,
                          })
                        }
                        className="hover:bg-muted focus-visible:ring-ring w-full cursor-pointer px-3 py-1.5 text-right font-mono tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {show(value)}
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>

        {/* What the fleet did, under the shops that did it. Not clickable:
            there is no one shop to open, and a sheet about "everybody" would
            be this screen again.

            Absent when one shop is being looked at on its own, because then it
            is not a total of anything — it is the row above it, again. */}
        <tfoot hidden={matrix.rows.length < 2}>
          <tr>
            <th
              scope="row"
              className="bg-secondary sticky bottom-0 left-0 z-30 border-t border-r px-3 py-1.5 text-left font-semibold"
              style={{ width: SHOP_COLUMN, minWidth: SHOP_COLUMN }}
            >
              Fleet
            </th>
            <td
              className="bg-secondary sticky bottom-0 z-30 border-t border-r px-3 py-1.5 text-right font-mono font-semibold tabular-nums"
              style={{ left: SHOP_COLUMN, width: TOTAL_COLUMN, minWidth: TOTAL_COLUMN }}
            >
              {show(matrix.grandTotal(kind), true)}
            </td>
            {matrix.buckets.map((start) => (
              <td
                key={start}
                title={exactly(matrix.bucketTotal(start, kind))}
                className="bg-secondary sticky bottom-0 z-20 border-t px-3 py-1.5 text-right font-mono font-medium tabular-nums"
              >
                {show(matrix.bucketTotal(start, kind))}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
