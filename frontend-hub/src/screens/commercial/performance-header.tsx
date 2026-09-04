import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Card } from "@/components/ui/card"
import { Banner } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import {
  type PromotionPerformance,
  campaignPerformance,
  performanceKeys,
  rulePerformance,
  type PerformancePoint,
  type PromotionTotals,
} from "@/lib/queries/commercial-performance"

/// What the offers actually did, over a window, above the list that declares
/// them.
///
/// The shape is an advertising console's — a row of figures you can click, and
/// the one you clicked drawn as a line beneath — because the question is the
/// same shape: money let go of, against what came back. The words are not. An
/// ad platform spends cash to buy attention; a promotion spends *margin* to buy
/// a basket, so "ad spend" is "discount given" here and there is no ROAS, only
/// what a rupiah of discount brought back with it.
///
/// Two of that console's six tiles cannot be honest here and are absent rather
/// than approximated:
///
///  - **Revenue attributed to the offer.** What we have is the whole of every
///    basket the offer touched (`Attribution: BASKET`) — a three-item basket
///    where one item was discounted counts entirely. It is drawn, and labelled
///    as baskets rather than as revenue, because pretending otherwise is how a
///    promotion gets renewed on a number nobody checked.
///  - **Cost per new customer** is a division this component does not do: the
///    server ships integers and the ratio is drawn from them, never stored.

const METRICS = [
  {
    id: "benefit",
    label: "Discount given",
    hint: "Money taken off tills by these offers.",
    read: (one: PromotionTotals) => one.benefit_minor,
    point: (one: PerformancePoint) => one.benefit_minor,
    draw: money,
  },
  {
    id: "baskets",
    label: "Baskets touched",
    hint: "Sales where at least one offer applied.",
    read: (one: PromotionTotals) => one.sale_count,
    point: (one: PerformancePoint) => one.sale_count,
    draw: count,
  },
  {
    id: "revenue",
    label: "Basket value",
    hint: "The whole of every basket an offer touched — not revenue caused by it.",
    read: (one: PromotionTotals) => one.basket_revenue_minor,
    point: (one: PerformancePoint) => one.basket_revenue_minor,
    draw: money,
  },
  {
    id: "customers",
    label: "Customers",
    hint: "Shoppers the till could name. Anonymous baskets count in nobody.",
    read: (one: PromotionTotals) => one.customer_count,
    point: () => 0,
    draw: count,
  },
  {
    id: "new",
    label: "New customers",
    hint: "First purchase anywhere, ever, inside this window.",
    read: (one: PromotionTotals) => one.new_customer_count,
    point: () => 0,
    draw: count,
  },
] as const

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const

/// Add up the rows without pretending the total is a fleet figure.
///
/// Money and counts add; **customers do not**. Two campaigns that both served
/// the same shopper would count them twice, and the server ships no distinct
/// roll-up, so those two tiles report the largest single campaign rather than a
/// sum — the honest lower bound, said out loud in the hint.
function fold(
  rows: readonly PromotionTotals[]
): PromotionTotals & { readonly overlapping: boolean } {
  const add = (read: (one: PromotionTotals) => number) =>
    rows.reduce((total, one) => total + read(one), 0)
  const most = (read: (one: PromotionTotals) => number) =>
    rows.reduce((highest, one) => Math.max(highest, read(one)), 0)
  return {
    benefit_minor: add((one) => one.benefit_minor),
    sale_count: add((one) => one.sale_count),
    basket_revenue_minor: add((one) => one.basket_revenue_minor),
    customer_count: most((one) => one.customer_count),
    new_customer_count: most((one) => one.new_customer_count),
    overlapping: rows.length > 1,
  }
}

/// Percentage change against the previous window of the same length, or `null`
/// when there is nothing to compare against. Zero to something is not "infinite
/// per cent", it is new — and is drawn as such.
function delta(now: number, before: number): number | null {
  if (before === 0) return null
  return Math.round(((now - before) / before) * 1000) / 10
}

/// Which list of offers the figures are about.
///
/// The same six tiles serve both screens because the measurement is the same —
/// `edge_sale_promotion` keyed by campaign or by rule — and reading them as two
/// components would be two chances for the arithmetic to drift apart.
export function PerformanceHeader({ of }: { of: "campaigns" | "rules" }) {
  const [days, setDays] = useState<number>(30)
  const [metric, setMetric] = useState<string>("benefit")

  const scope = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [days])

  const report = useQuery({
    queryKey:
      of === "campaigns"
        ? performanceKeys.campaigns(scope)
        : performanceKeys.rules(scope),
    // Named rather than inferred: the two branches return different row
    // types, and their union widens to `unknown` unless the shape they share
    // is the one declared. Both extend `PromotionPerformance`, which is
    // everything this panel reads.
    queryFn: ({ signal }): Promise<readonly PromotionPerformance[]> =>
      of === "campaigns"
        ? campaignPerformance(scope, signal).then((one) => one.campaigns)
        : rulePerformance(scope, signal).then((one) => one.rules),
    // The endpoint is written but not yet deployed to this node. One attempt,
    // then the panel says so — retrying a 404 six times only delays the answer.
    retry: false,
  })

  const chosen = METRICS.find((one) => one.id === metric) ?? METRICS[0]

  // Every hook runs before the error branch below. A `useMemo` after an early
  // return changes the hook order between a loaded render and a failed one,
  // which React cannot recover from.
  const rows = useMemo(() => report.data ?? [], [report.data])
  const now = useMemo(() => fold(rows), [rows])
  const before = useMemo(() => fold(rows.map((one) => one.previous)), [rows])

  /// One line per day, summed across campaigns. Days with no trading are
  /// absent from every series, so the union of days is taken rather than one
  /// campaign's — otherwise a quiet campaign would shorten the chart.
  const series = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const row of rows) {
      for (const point of row.series) {
        byDay.set(point.day, (byDay.get(point.day) ?? 0) + chosen.point(point))
      }
    }
    return [...byDay.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([day, value]) => ({ day, value }))
  }, [rows, chosen])

  if (report.isError) {
    return (
      <Banner tone="info" className="mb-4">
        The performance figures are not on this node yet. The three
        <span className="font-mono"> /commercial/performance </span>
        endpoints are written and tested but not merged, so there is nothing to
        chart — the list below is live either way.
      </Banner>
    )
  }

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2">
        {WINDOWS.map((one) => (
          <button
            key={one.days}
            type="button"
            onClick={() => setDays(one.days)}
            className={
              "rounded-inner px-2 py-1 text-[0.71875rem] transition-colors " +
              (days === one.days
                ? "bg-accent-bg font-medium text-accent"
                : "text-mute hover:bg-soft hover:text-ink")
            }
          >
            Last {one.label}
          </button>
        ))}
        <span className="ml-auto text-[0.65625rem] text-mute">
          against the {days} days before
        </span>
      </div>

      {/* The tiles. Clicking one draws it below — the console gesture, and the
          reason the chart needs no legend of its own. */}
      <div className="grid grid-cols-2 border-b border-hairline sm:grid-cols-3 lg:grid-cols-5">
        {METRICS.map((one) => {
          const value = one.read(now)
          const change = delta(value, one.read(before))
          const live = one.id === metric
          const roll = one.id === "customers" || one.id === "new"
          return (
            <button
              key={one.id}
              type="button"
              onClick={() => setMetric(one.id)}
              title={
                one.hint +
                (roll && now.overlapping
                  ? " Across several campaigns this is the largest single one, never a sum — the same shopper served twice would be counted twice."
                  : "")
              }
              className={
                "border-r border-hairline px-3.5 py-2.5 text-left transition-colors last:border-r-0 " +
                (live
                  ? "bg-soft shadow-[inset_0_2px_0_var(--accent)]"
                  : "hover:bg-soft")
              }
            >
              <span className="block truncate text-[0.65625rem] tracking-[0.04em] text-mute uppercase">
                {one.label}
              </span>
              <span className="mt-0.5 flex items-baseline gap-1.5">
                <span className="truncate font-medium text-ink tabular-nums">
                  {report.isPending ? "—" : one.draw(value)}
                </span>
                {change !== null && (
                  <span
                    className={
                      "shrink-0 text-[0.65625rem] tabular-nums " +
                      (change >= 0 ? "text-ok-fg" : "text-bad-fg")
                    }
                  >
                    {change >= 0 ? "+" : ""}
                    {change}%
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <Sparkline points={series} label={chosen.label} draw={chosen.draw} />
    </Card>
  )
}

/// A line, its own axis, and nothing else.
///
/// Inline SVG rather than a charting library: one series, no legend, no
/// tooltip layer, and a dependency would be more code than this is. The line is
/// drawn from the values as they came — no smoothing, because a smoothed
/// promotion curve invents trading on days nothing sold.
function Sparkline({
  points,
  label,
  draw,
}: {
  points: readonly { day: string; value: number }[]
  label: string
  draw: (value: number) => string
}) {
  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-meta text-mute">
        Nothing sold against an offer in this window, so there is no line to
        draw. An empty chart is not a flat one.
      </p>
    )
  }

  const width = 1000
  const height = 260
  const pad = 8
  const highest = Math.max(...points.map((one) => one.value), 1)
  const step = points.length === 1 ? 0 : (width - pad * 2) / (points.length - 1)
  const plot = points.map((one, index) => ({
    ...one,
    x: pad + index * step,
    y: height - pad - (one.value / highest) * (height - pad * 2),
  }))
  const line = plot
    .map((one, index) => `${index === 0 ? "M" : "L"}${one.x} ${one.y}`)
    .join(" ")

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.65625rem] tracking-[0.04em] text-mute uppercase">
          {label} per day
        </span>
        <span className="text-[0.65625rem] text-mute tabular-nums">
          peak {draw(highest)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} per day, peak ${draw(highest)}`}
        className="mt-1.5 h-64 w-full"
      >
        <path
          d={`${line} L${plot[plot.length - 1].x} ${height - pad} L${plot[0].x} ${height - pad} Z`}
          fill="var(--accent)"
          opacity="0.08"
        />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[0.65625rem] text-mute tabular-nums">
        <span>{points[0].day}</span>
        <span>{points[points.length - 1].day}</span>
      </div>
    </div>
  )
}
