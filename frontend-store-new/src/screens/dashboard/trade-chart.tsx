import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card } from "@/components/ui/card"
import { compactFormat } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { Totals } from "@/lib/queries/dashboard"
import { cn } from "@/lib/utils"
import { money, units } from "@itulah/contract/money"

/// The card the dashboard leads with: what the shop took, one bar for each
/// day, and the three figures it can be read by.
///
/// The shadcn "Bar Chart - Interactive" shape. The card's title is the figure
/// on show; the three buttons on its right are those figures over the whole
/// span, and pressing one redraws the bars in it — the same days, a different
/// measure. They are the card's only control: the span they all read is the
/// dashboard's own filter, above, not a choice made here.
///
/// The marks follow the rules the other charts here keep, and the dataviz
/// ones where the two differ: one accent, a bar no thicker than 18px with a
/// 4px rounded top and square foot, 2px of air between bars, a solid hairline
/// grid that recedes, the day on the axis once a week and the exact figure in
/// the tooltip. A single series has no legend — the title says what it is.

export type Figure = "sales" | "transactions" | "items"

/// One bar: a day, or an hour when the span is a single day.
export interface ChartPoint extends Totals {
  /// Unique along the axis.
  readonly key: string
  /// What the axis says under it, where it says anything.
  readonly tick: string
  /// The tooltip's heading.
  readonly title: string
}

const compact = compactFormat()

const FIGURES: readonly {
  readonly id: Figure
  readonly label: string
  readonly key: keyof Totals
  readonly show: (value: number) => string
  /// The same figure where there is no room for every digit.
  readonly short: (value: number) => string
}[] = [
  {
    id: "sales",
    label: "Sales",
    key: "sales_minor",
    show: (value) => money(value),
    short: (value) => `Rp ${compact.format(value)}`,
  },
  {
    id: "transactions",
    label: "Transactions",
    key: "transactions",
    show: units,
    short: units,
  },
  {
    id: "items",
    label: "Items sold",
    key: "items",
    show: units,
    short: units,
  },
]

export function TradeChart({
  points,
  unit,
  totals,
  sub,
  figure,
  onFigure,
}: {
  points: readonly ChartPoint[]
  /// What a bar is, which decides how often the axis speaks.
  unit: "day" | "hour"
  /// The span's figures, for the buttons.
  totals: Totals
  /// Under the title: the span, and what a bar is.
  sub: React.ReactNode
  figure: Figure
  onFigure: (next: Figure) => void
}) {
  const phone = useLayout() === "phone"
  const on = FIGURES.find((one) => one.id === figure) ?? FIGURES[0]

  return (
    <Card className="mb-4">
      <div className="flex flex-col border-b border-hairline md:flex-row md:items-stretch">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-3.5">
          <h2 className="text-card-title font-semibold text-ink">{on.label}</h2>
          <p className="text-meta text-mute">{sub}</p>
        </div>
        <div
          role="group"
          aria-label="Figure"
          className="grid grid-cols-3 border-t border-hairline md:flex md:border-t-0"
        >
          {FIGURES.map((one) => (
            <button
              key={one.id}
              type="button"
              aria-pressed={one.id === figure}
              onClick={() => onFigure(one.id)}
              className={cn(
                "flex min-w-0 flex-col items-start gap-0.5 border-l border-hairline px-4 py-3 text-left outline-none first:border-l-0 max-md:px-3",
                "transition-[background-color,scale] duration-(--t-hover) ease-(--ease-out) hover:bg-soft/60 active:scale-[0.985]",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent md:min-w-[10.5rem] md:px-6 md:py-3.5 md:first:border-l",
                one.id === figure && "bg-soft hover:bg-soft",
              )}
            >
              <span className="text-eyebrow text-mute">{one.label}</span>
              <span className="max-w-full truncate text-kpi font-semibold text-ink">
                {(phone ? one.short : one.show)(totals[one.key])}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-2 pt-4 pb-3 md:px-4">
        {totals.transactions === 0 ? (
          <p className="grid h-[15rem] place-items-center text-meta text-body">
            No sales in this period.
          </p>
        ) : (
          <Bars points={points} unit={unit} figure={on} />
        )}
      </div>

      {/* The chart for anyone who cannot see it, and for whoever wants the
          figures themselves: the tooltip only ever adds to what is here.
          A table ignores sr-only's 1px height, so a div holds it: bare, its
          ninety rows stretched the page and gave it a second scrollbar. */}
      <div className="sr-only">
        <table>
          <caption>{on.label}</caption>
          <thead>
            <tr>
              <th scope="col">{unit === "day" ? "Day" : "Hour"}</th>
              <th scope="col">{on.label}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.key}>
                <th scope="row">{point.title}</th>
                <td>{on.show(point[on.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/// The axis column's width, which the plot does not have.
const AXIS = 44

/// How much width one axis label and the air around it take.
const LABEL_ROOM = 64

/// The bars that carry a label under them.
///
/// A day axis speaks once a week — every seventh bar from the first — and
/// speaks less often, in whole weeks, when the glass is too narrow for that
/// many; a short span, which is not weeks, speaks as often as there is room.
function labelled(
  points: readonly ChartPoint[],
  unit: "day" | "hour",
  width: number,
): string[] {
  const room = Math.max(1, Math.floor((width - AXIS) / LABEL_ROOM))
  const strides =
    unit === "hour"
      ? [1, 2, 3, 6, 12]
      : points.length > 14
        ? [7, 14, 28, 56, 112, 224]
        : [1, 2, 7, 14]
  const stride =
    strides.find((one) => Math.ceil(points.length / one) <= room) ??
    strides[strides.length - 1]
  return points.filter((_, at) => at % stride === 0).map((one) => one.key)
}

const REDUCED = "(prefers-reduced-motion: reduce)"

function watchMotion(notify: () => void): () => void {
  const query = window.matchMedia(REDUCED)
  query.addEventListener("change", notify)
  return () => query.removeEventListener("change", notify)
}

/// Whether to hold the bars still when the figure changes. Opacity and colour
/// carry on regardless; it is the growing and shrinking that is asked about.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    watchMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  )
}

function Bars({
  points,
  unit,
  figure,
}: {
  points: readonly ChartPoint[]
  unit: "day" | "hour"
  figure: (typeof FIGURES)[number]
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const still = usePrefersReducedMotion()

  // The axis has to know how much room it has before it draws, to choose which
  // bars to name; the container is measured, and again whenever it changes.
  useEffect(() => {
    const element = box.current
    if (element === null) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const ticks = labelled(points, unit, width)
  const tickOf = new Map(points.map((one) => [one.key, one.tick] as const))

  return (
    <div ref={box} className="h-[15rem] w-full text-eyebrow">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={2}
        >
          <CartesianGrid vertical={false} stroke="var(--hairline)" />
          <XAxis
            dataKey="key"
            ticks={ticks}
            interval={0}
            tickFormatter={(key: string) => tickOf.get(key) ?? ""}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            tickMargin={8}
            axisLine={{ stroke: "var(--hairline-2)" }}
          />
          <YAxis
            tickFormatter={(value: number) => compact.format(value)}
            tick={{ fill: "var(--mute)" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={AXIS}
          />
          <Tooltip
            cursor={{ fill: "var(--soft)" }}
            isAnimationActive={false}
            content={(info) => {
              if (
                info.active !== true ||
                info.payload === undefined ||
                info.payload.length === 0
              ) {
                return null
              }
              const point = info.payload[0].payload as ChartPoint
              return (
                <div className="rounded-inner border border-hairline bg-canvas px-3 py-2 shadow-pop">
                  <div className="text-pill font-medium text-ink">
                    {point.title}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-pill text-body">
                    <span
                      aria-hidden
                      className="h-0.5 w-3 shrink-0 rounded-full bg-accent"
                    />
                    <span>{figure.label}</span>
                    <span className="ml-auto pl-4 font-semibold text-ink">
                      {figure.show(point[figure.key])}
                    </span>
                  </div>
                </div>
              )
            }}
          />
          <Bar
            dataKey={figure.key}
            name={figure.label}
            fill="var(--accent)"
            maxBarSize={18}
            // The top is rounded and the foot is not: a rounded foot would
            // lift the bar off the axis it is measured from.
            radius={[4, 4, 0, 0]}
            activeBar={{ fillOpacity: 0.7 }}
            isAnimationActive={!still}
            animationDuration={240}
            animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
