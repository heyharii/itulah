import { Popover } from "@base-ui/react/popover"
import { useQuery } from "@tanstack/react-query"
import {
  Box,
  Calendar,
  Coins,
  Info,
  ShoppingBag,
  ShoppingCart,
  Tag,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ComboSeries, type ChartRow } from "@/components/ui/chart"
import { Day } from "@/components/ui/day"
import { Banner } from "@/components/ui/states"
import { endOfDay, isoOf, startOfDay } from "@/lib/calendar"
import { POPUP, POSITIONER } from "@/lib/filter-chrome"
import { count, day, money } from "@/lib/format"
import {
  type PromotionPerformance,
  campaignPerformance,
  performanceKeys,
  rulePerformance,
  type PerformancePoint,
  type PromotionTotals,
} from "@/lib/queries/commercial-performance"
import { cn } from "@/lib/utils"

/// What the offers actually did, over a window, above the list that declares
/// them.
///
/// The shape is an advertising console's — a row of figures you can click, and
/// the one you clicked drawn beneath — because the question is the same shape:
/// money let go of, against what came back. The words are not. An ad platform
/// spends cash to buy attention; a promotion spends *margin* to buy a basket,
/// so "ad spend" is "discount given" here and there is no ROAS, only what a
/// rupiah of discount brought back with it.
///
/// ## The two numbers on this panel that are not measurements
///
/// Everything here is `SUM`ed from sale facts except two, and both are labelled
/// where they are drawn rather than only here:
///
///  - **Promo Sales is influenced, not caused.** Attribution is `BASKET`: a
///    three-item basket where one item was discounted counts entirely. It is
///    the standard measure and it overstates, and the hint on the tile says so
///    because a promotion renewed on this figure was renewed on a number
///    nobody checked.
///  - **Gross Profit is an estimate.** Its cost basis is the last price agreed
///    for the STYLE — a purchase order names a style, never a size. The tile
///    reports its own coverage from `costed_units`, and reads as unknown rather
///    than as a figure when nothing sold could be costed.

interface Metric {
  readonly id: string
  readonly label: string
  readonly hint: string
  readonly icon: typeof ShoppingBag
  /// The icon chip's wash. Not a series colour — nothing here is plotted by
  /// tile, so these tint a badge and never encode a value.
  readonly tint: string
  readonly read: (one: PromotionTotals) => number
  readonly point: (one: PerformancePoint) => number
  readonly draw: (value: number) => string
}

const METRICS: readonly Metric[] = [
  {
    id: "revenue",
    label: "Promo Sales",
    hint: "Whole baskets an offer touched — influenced, not caused.",
    icon: ShoppingBag,
    tint: "bg-accent-bg text-accent",
    read: (one) => one.basket_revenue_minor,
    point: (one) => one.basket_revenue_minor,
    draw: money,
  },
  {
    id: "benefit",
    label: "Discount Given",
    hint: "Money taken off tills by these offers.",
    icon: Tag,
    tint: "bg-bad-bg text-bad-fg",
    read: (one) => one.benefit_minor,
    point: (one) => one.benefit_minor,
    draw: money,
  },
  {
    id: "profit",
    label: "Gross Profit",
    hint: "Promo sales less the last agreed cost. An estimate — cost is per style, not per size.",
    icon: Coins,
    tint: "bg-soft-2 text-body",
    read: (one) => one.basket_revenue_minor - one.cost_minor,
    point: (one) => one.basket_revenue_minor - one.cost_minor,
    draw: money,
  },
  {
    id: "baskets",
    label: "Baskets Touched",
    hint: "Sales where at least one offer applied.",
    icon: ShoppingCart,
    tint: "bg-ok-bg text-ok-fg",
    read: (one) => one.sale_count,
    point: (one) => one.sale_count,
    draw: count,
  },
  {
    id: "units",
    label: "Units Sold",
    hint: "Items in those baskets, attributed per basket like the money beside them.",
    icon: Box,
    tint: "bg-soft-2 text-body",
    read: (one) => one.units,
    point: (one) => one.units,
    draw: count,
  },
]

const WINDOWS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
] as const

/// Add up the rows without pretending the total is a fleet figure.
///
/// Money, counts and units add; **customers do not**. Two campaigns that both
/// served the same shopper would count them twice, and the server ships no
/// distinct roll-up, so those two report the largest single row rather than a
/// sum — the honest lower bound, said out loud where they are drawn.
function fold(
  rows: readonly PromotionTotals[]
): PromotionTotals & { readonly overlapping: boolean } {
  const add = (read: (one: PromotionTotals) => number) =>
    rows.reduce((total, one) => total + read(one), 0)
  const most = (read: (one: PromotionTotals) => number) =>
    rows.reduce((highest, one) => Math.max(highest, read(one)), 0)
  return {
    benefit_minor: add((one) => one.benefit_minor),
    clearance_minor: add((one) => one.clearance_minor),
    sale_count: add((one) => one.sale_count),
    basket_revenue_minor: add((one) => one.basket_revenue_minor),
    units: add((one) => one.units),
    cost_minor: add((one) => one.cost_minor),
    costed_units: add((one) => one.costed_units),
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
/// The same tiles serve both screens because the measurement is the same —
/// `edge_sale_promotion` keyed by campaign or by rule — and reading them as two
/// components would be two chances for the arithmetic to drift apart.
export function PerformanceHeader({ of }: { of: "campaigns" | "rules" }) {
  const [days, setDays] = useState<number>(30)
  /// A range somebody typed, which wins over the preset while it is set.
  /// Two states rather than one so that clearing the range returns to the
  /// preset that was chosen before it rather than to a hard-coded thirty.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [metric, setMetric] = useState<string>("revenue")

  const scope = useMemo(() => {
    if (range !== null) {
      return { from: startOfDay(range.from), to: endOfDay(range.to) }
    }
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [days, range])

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
  const discount = METRICS[1]

  // Every hook runs before the error branch below. A `useMemo` after an early
  // return changes the hook order between a loaded render and a failed one,
  // which React cannot recover from.
  const rows = useMemo(() => report.data ?? [], [report.data])
  const now = useMemo(() => fold(rows), [rows])
  const before = useMemo(() => fold(rows.map((one) => one.previous)), [rows])

  /// One row per day carrying BOTH series, summed across offers. Days with no
  /// trading are absent from every series, so the union of days is taken rather
  /// than one offer's — otherwise a quiet promotion would shorten the chart.
  const series = useMemo(() => {
    const byDay = new Map<string, { line: number; bar: number }>()
    for (const row of rows) {
      for (const point of row.series) {
        const held = byDay.get(point.day) ?? { line: 0, bar: 0 }
        held.line += chosen.point(point)
        held.bar += discount.point(point)
        byDay.set(point.day, held)
      }
    }
    return [...byDay.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([bucket, one]): ChartRow => ({
        bucket,
        line: one.line,
        bar: one.bar,
      }))
  }, [rows, chosen, discount])

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

  const spend = now.benefit_minor
  const sales = now.basket_revenue_minor
  const share = sales > 0 ? (spend / sales) * 100 : null
  const window = range === null ? `previous ${days} days` : "period before"

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <div className="inline-flex items-center gap-1 rounded-full border border-hairline bg-canvas p-0.5">
          {WINDOWS.map((one) => (
            <button
              key={one.days}
              type="button"
              onClick={() => {
                setRange(null)
                setDays(one.days)
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-meta transition-colors",
                range === null && days === one.days
                  ? "bg-accent-bg font-medium text-accent"
                  : "text-mute hover:text-ink"
              )}
            >
              {one.label}
            </button>
          ))}
        </div>
        <Range value={range} onChange={setRange} />
      </div>

      {/* The tiles. Clicking one draws it below — the console gesture, and the
          reason the chart's line needs no control of its own. */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {METRICS.map((one) => (
          <Tile
            key={one.id}
            metric={one}
            live={one.id === metric}
            pending={report.isPending}
            value={one.read(now)}
            // Revenue minus a cost of nought is revenue, and drawing it under
            // the word "profit" is the worst number on this page: it is the
            // most flattering possible figure, produced by the ABSENCE of data.
            // Unknown is unknown.
            unknown={
              one.id === "profit" && now.units > 0 && now.costed_units === 0
            }
            change={delta(one.read(now), one.read(before))}
            window={window}
            // Only the margin tile carries a coverage note, and only when the
            // cost basis did not reach everything sold. Everywhere else it is
            // absent rather than "100%", which would be a badge on a number
            // that was never in doubt.
            caveat={
              one.id === "profit" &&
              now.units > 0 &&
              now.costed_units < now.units
                ? now.costed_units === 0
                  ? "No unit sold has a cost on file"
                  : `Costed for ${count(now.costed_units)} of ${count(now.units)} units`
                : null
            }
            onSelect={() => setMetric(one.id)}
          />
        ))}
      </div>

      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-4 p-3.5 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-card-title font-semibold text-ink">
                  {chosen.label} over time
                </h2>
                <p className="mt-0.5 text-meta text-mute">
                  Daily value of sales using promotions, with discount given.
                </p>
              </div>
              {/* Our own legend rather than the chart's, so its type scale is
                  the page's and not the library's. */}
              <div className="flex items-center gap-3 text-meta text-body">
                <Key colour="var(--accent)" label={chosen.label} />
                {chosen.id !== discount.id && (
                  <Key colour="var(--a-violet)" label={discount.label} />
                )}
              </div>
            </div>
            {series.length === 0 ? (
              <p className="py-16 text-center text-meta text-mute">
                Nothing sold against an offer in this window, so there is no
                line to draw. An empty chart is not a flat one.
              </p>
            ) : (
              <ComboSeries
                rows={series}
                line={{ key: "line", label: chosen.label }}
                bars={
                  chosen.id === discount.id
                    ? null
                    : { key: "bar", label: discount.label }
                }
                format={chosen.id === discount.id ? money : chosen.draw}
                titleOf={(bucket) => day(bucket)}
                labelOf={(bucket) => day(bucket).slice(0, 6)}
                className="h-[15rem]"
              />
            )}
          </div>

          <aside className="shrink-0 rounded-card bg-soft p-3.5 lg:w-[15rem]">
            <Ratio share={share} spend={spend} sales={sales} />
            {/* Kept beside the ratio rather than as tiles of their own. They
                are the only reading of how shoppers responded, and they cannot
                be summed across offers — so they sit where a lower bound can be
                said in words instead of implied by a big number. */}
            <dl className="mt-3.5 border-t border-hairline pt-3 text-meta">
              <Side
                term="Customers"
                value={count(now.customer_count)}
                hint={
                  now.overlapping
                    ? "The largest single offer, never a sum — the same shopper served by two offers would be counted twice."
                    : "Shoppers the till could name. Anonymous baskets count in nobody."
                }
              />
              <Side
                term="New customers"
                value={count(now.new_customer_count)}
                hint="First purchase anywhere, ever, inside this window."
              />
            </dl>
          </aside>
        </div>
      </Card>
    </>
  )
}

function Key({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: colour }}
      />
      {label}
    </span>
  )
}

function Side({
  term,
  value,
  hint,
}: {
  term: string
  value: string
  hint: string
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-1"
      title={hint}
    >
      <dt className="text-mute">{term}</dt>
      <dd className="font-medium text-ink tabular-nums">{value}</dd>
    </div>
  )
}

/// What share of what the offers brought in was given away to bring it in.
///
/// Drawn here rather than summed server-side: it is a ratio, and rounding two
/// minor-unit integers into a percentage on the server would put a float among
/// a page of exact amounts. Both figures ship whole and this divides them.
function Ratio({
  share,
  spend,
  sales,
}: {
  share: number | null
  spend: number
  sales: number
}) {
  return (
    <>
      <div className="flex items-center gap-1 text-eyebrow font-medium text-body">
        Discount / Promo Sales
        <Hint text="Discount as a share of the baskets touched. Reads low because the base is whole baskets." />
      </div>
      <div className="mt-1 text-[1.375rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {share === null ? "—" : `${share.toFixed(1)}%`}
      </div>
      <p className="mt-1.5 text-meta text-mute">
        {money(spend)} of {money(sales)}
      </p>
    </>
  )
}

function Hint({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex text-faint">
      <Info aria-hidden className="size-3" />
      <span className="sr-only">{text}</span>
    </span>
  )
}

/// One figure, and whether it is going the right way.
function Tile({
  metric,
  live,
  pending,
  value,
  unknown,
  change,
  window,
  caveat,
  onSelect,
}: {
  metric: Metric
  live: boolean
  pending: boolean
  value: number
  /// The figure cannot be computed from what is on file. Not zero, and not the
  /// arithmetic run anyway over a missing input.
  unknown?: boolean
  change: number | null
  window: string
  caveat: string | null
  onSelect: () => void
}) {
  const Icon = metric.icon
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={live}
      className={cn(
        "rounded-card border bg-canvas px-3.5 py-3 text-left shadow-soft transition-colors",
        live ? "border-accent bg-accent-bg/40" : "border-hairline hover:bg-soft"
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-inner",
            metric.tint
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="flex min-w-0 items-center gap-1 text-eyebrow font-medium text-body">
          <span className="truncate">{metric.label}</span>
          <Hint text={metric.hint} />
        </span>
      </div>
      <div className="mt-2 truncate text-[1.25rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
        {pending || unknown === true ? "—" : metric.draw(value)}
      </div>
      {caveat !== null ? (
        <div className="mt-1.5 truncate text-[0.71875rem] text-warn-fg">
          {caveat}
        </div>
      ) : change !== null ? (
        <div className="mt-1.5 truncate text-[0.71875rem] tabular-nums">
          <span
            className={cn(
              "font-semibold",
              change >= 0 ? "text-ok-fg" : "text-bad-fg"
            )}
          >
            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}%
          </span>{" "}
          <span className="text-mute">vs {window}</span>
        </div>
      ) : (
        // Nothing to compare against is not a flat nought per cent, and drawing
        // one would claim a steady figure where there is no earlier figure.
        <div className="mt-1.5 truncate text-[0.71875rem] text-mute">
          No earlier period to compare
        </div>
      )}
    </button>
  )
}

/// Two days, when the three presets are not the question.
///
/// `<Day>` rather than a range calendar: this app already draws one day and the
/// second box is the cheaper half of the problem. Applied on Apply rather than
/// on change, because a half-typed range is a window nobody asked for and every
/// keystroke inside one is a request to the server.
function Range({
  value,
  onChange,
}: {
  value: { from: string; to: string } | null
  onChange: (next: { from: string; to: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(value?.from ?? "")
  const [to, setTo] = useState(value?.to ?? "")

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-meta transition-colors",
          value === null
            ? "border-hairline text-mute hover:text-ink"
            : "border-accent bg-accent-bg font-medium text-accent"
        )}
      >
        <Calendar aria-hidden className="size-3.5" />
        {value === null
          ? "Pick dates"
          : `${day(value.from)} – ${day(value.to)}`}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={POSITIONER}
          side="bottom"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className={cn(POPUP, "w-[19rem] p-3")}>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-eyebrow text-mute">
                From
                <Day
                  value={from}
                  onChange={setFrom}
                  notAfter={to || isoOf(new Date())}
                  label="From"
                />
              </label>
              <label className="text-eyebrow text-mute">
                To
                <Day
                  value={to}
                  onChange={setTo}
                  notBefore={from}
                  notAfter={isoOf(new Date())}
                  label="To"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {value !== null && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFrom("")
                    setTo("")
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  Clear
                </Button>
              )}
              <Button
                variant="primary"
                disabled={from === "" || to === ""}
                onClick={() => {
                  onChange({ from, to })
                  setOpen(false)
                }}
              >
                Apply
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
