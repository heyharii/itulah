import { ArrowDown, ArrowUp } from "lucide-react"
import { useMemo, useState } from "react"

import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Screen } from "@/components/ui/screen"
import { useLayout } from "@/lib/layout"
import {
  returnRate,
  spanBefore,
  useBasket,
  useHours,
  useTrade,
} from "@/lib/queries/dashboard"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { BestSellers } from "@/screens/dashboard/best-sellers"
import { RangePicker } from "@/screens/dashboard/range-picker"
import { DEFAULT_CHOICE, spanOf, type Choice } from "@/screens/dashboard/range"
import {
  TradeChart,
  type ChartPoint,
  type Figure,
} from "@/screens/dashboard/trade-chart"
import { dayTick, dayTitle, spanWords } from "@/screens/money/format"
import { money } from "@itulah/contract/money"

/// Today > Dashboard: what the shop took over the days chosen, and how that
/// compares with the same number of days just before.
///
/// Four figures a store head reads first, each against the period before; one
/// chart of the days, readable by sales, transactions or items; and the ten
/// SKUs that sold most. One filter — the days — scopes all three, so the
/// numbers always agree (store prototype `store-money-prototype.html`, 11 Oct
/// 2026).
///
/// ## What the node cannot say yet
///
/// Everything from the day-by-day report is exact. Two figures are not:
///
///  - **Return rate and the best sellers** come from reading the newest
///    receipts of the span one by one (`lib/queries/dashboard.ts`), because no
///    endpoint cuts the sales by SKU or counts returns. The table says so when
///    it is not every sale.
///  - **Member share** is not recorded: the shop's `sale` row keeps no member,
///    and the receipt document's `points_earned` is a constant nought. The card
///    waits, empty, for the node to say.
export function Dashboard() {
  const phone = useLayout() === "phone"
  const [choice, setChoice] = useState<Choice>(DEFAULT_CHOICE)
  const [figure, setFigure] = useState<Figure>("sales")

  const span = spanOf(choice)
  const single = span.from === span.to

  const trade = useTrade(span)
  const basket = useBasket(span)
  // The period before is read once this one has been: it only moves a delta,
  // and the table should not wait behind it.
  const earlier = useBasket(
    spanBefore(span),
    basket.isSuccess && !basket.isPlaceholderData,
  )
  const hours = useHours(span.from, single)

  const dayPoints = useMemo<readonly ChartPoint[]>(
    () =>
      (trade.data?.days ?? []).map((one) => ({
        key: one.day,
        tick: dayTick(one.day),
        title: dayTitle(one.day),
        sales_minor: one.sales_minor,
        transactions: one.transactions,
        items: one.items,
      })),
    [trade.data],
  )
  const hourPoints = useMemo<readonly ChartPoint[]>(
    () =>
      (hours.data ?? []).map((one) => {
        const from = `${String(one.hour).padStart(2, "0")}:00`
        const to = `${String((one.hour + 1) % 24).padStart(2, "0")}:00`
        return {
          key: String(one.hour),
          tick: from,
          title: `${dayTitle(span.from)} · ${from}–${to}`,
          sales_minor: one.sales_minor,
          transactions: one.transactions,
          items: one.items,
        }
      }),
    [hours.data, span.from],
  )

  const picker = (
    <RangePicker choice={choice} span={span} onChange={setChoice} />
  )
  // A basket from before the span changed is not this span's.
  const sold = basket.isPlaceholderData ? undefined : basket.data
  const soldBefore = earlier.isPlaceholderData ? undefined : earlier.data

  return (
    <Screen actions={phone ? undefined : picker}>
      {/* On a phone the picker is the dock's: it draws nothing in the page. */}
      {phone && picker}

      {queryState(trade, {
        loading: "Reading the takings…",
        render: (answer) => {
          const { now, before } = answer
          const aov = per(now.sales_minor, now.transactions)
          const upt = per(now.items, now.transactions)
          const rate = sold === undefined ? null : returnRate(sold)
          const rateBefore =
            soldBefore === undefined ? null : returnRate(soldBefore)
          return (
            // Dimmed while a new span is on its way, the old one kept in place.
            <div
              className={cn(
                "transition-opacity duration-(--t-pop) ease-(--ease-out)",
                trade.isPlaceholderData && "opacity-60",
              )}
            >
              <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
                <Measure
                  label="Average sale (AOV)"
                  value={aov === null ? null : money(Math.round(aov))}
                  against={compare(
                    aov,
                    per(before.sales_minor, before.transactions),
                    "relative",
                    true,
                  )}
                />
                <Measure
                  label="Items per transaction (UPT)"
                  value={upt === null ? null : decimals(upt, 2)}
                  against={compare(
                    upt,
                    per(before.items, before.transactions),
                    "relative",
                    true,
                  )}
                />
                <Measure
                  label="Return rate"
                  value={rate === null ? null : `${decimals(rate, 1)}%`}
                  against={compare(rate, rateBefore, "points", false)}
                />
                {/* The node keeps no member on a sale (see the doc above). */}
                <Kpi
                  label="Member share of sales"
                  value={<span className="text-mute">—</span>}
                  delta={
                    <span className="font-normal text-mute">
                      Not recorded yet
                    </span>
                  }
                />
              </KpiStrip>

              <TradeChart
                points={single ? hourPoints : dayPoints}
                unit={single ? "hour" : "day"}
                totals={now}
                sub={
                  single
                    ? `By hour · ${dayTitle(span.from)}`
                    : `Every day · ${spanWords(span.from, span.to)}`
                }
                figure={figure}
                onFigure={setFigure}
              />

              <div
                className={cn(
                  "transition-opacity duration-(--t-pop) ease-(--ease-out)",
                  basket.isPlaceholderData && "opacity-60",
                )}
              >
                {queryState(basket, {
                  loading: "Reading the sales…",
                  render: (read) => (
                    <BestSellers
                      basket={read}
                      sub={spanWords(span.from, span.to)}
                    />
                  ),
                })}
              </div>
            </div>
          )
        },
      })}
    </Screen>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// A figure and its change

/// One figure over a total and a count, or nothing when there is no count.
function per(total: number, count: number): number | null {
  return count === 0 ? null : total / count
}

function decimals(value: number, places: number): string {
  return value.toLocaleString("id-ID", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

interface Change {
  readonly text: string
  /// Which way it moved; null when it did not.
  readonly arrow: "up" | "down" | null
  /// Whether that is good news, which is not the same as up.
  readonly tone: "up" | "down" | "flat"
}

/// How `now` stands against `before`: a percentage of it, or — for a figure
/// that is already a percentage — the points between them. Null when either is
/// unknown, or there was nothing before to be a percentage of.
function compare(
  now: number | null,
  before: number | null,
  mode: "relative" | "points",
  goodWhenUp: boolean,
): Change | null {
  if (now === null || before === null) return null
  if (mode === "relative" && before === 0) return null
  const moved =
    mode === "relative" ? ((now - before) / before) * 100 : now - before
  const rounded = Math.round(moved * 10) / 10
  const unit = mode === "relative" ? "%" : " pts"
  const text = `${decimals(Math.abs(rounded), 1)}${unit}`
  if (rounded === 0) return { text, arrow: null, tone: "flat" }
  const up = rounded > 0
  return {
    text,
    arrow: up ? "up" : "down",
    tone: up === goodWhenUp ? "up" : "down",
  }
}

/// A `Kpi` for a figure that is read against the period before.
function Measure({
  label,
  value,
  against,
}: {
  label: string
  /// Null while it cannot be said: nothing sold, or still being read.
  value: string | null
  against: Change | null
}) {
  const Arrow = against?.arrow === "up" ? ArrowUp : ArrowDown
  return (
    <Kpi
      label={label}
      value={value ?? <span className="text-mute">—</span>}
      tone={against?.tone}
      delta={
        against === null ? undefined : (
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span className="inline-flex items-center gap-0.5">
              {against.arrow !== null && (
                <Arrow className="size-3.5 stroke-[2.5]" />
              )}
              {against.text}
            </span>
            <span className="font-normal text-mute">vs the period before</span>
          </span>
        )
      }
    />
  )
}
