import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import type { ChartRow } from "@/components/ui/chart"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import {
  fetchSeries,
  isoDay,
  lastDays,
  seriesKey,
  type SalesSeries,
} from "@/lib/queries"
import { cn } from "@/lib/utils"
import { TrendLine } from "@/screens/money/chart"
import { dayStamp, dayTick, dayTitle, spanWords } from "@/screens/money/format"
import {
  CardHead,
  Delta,
  MoneyScreen,
  Note,
  SpanPicker,
  Toolbar,
} from "@/screens/money/parts"
import { money, units } from "@itulah/contract/money"
import { previousWindow } from "@itulah/contract/reporting"

/// How the trade ran, day by day — the hub's Sales (`frontend-hub/src/
/// screens/sales/`) cut to one shop.
///
/// The owner asked for this screen in two sentences — a chart of sales on top,
/// "garis meningkat menurun", and a daily sales table under it — and the
/// restraint is the point. It answers one question: is the shop going up or
/// down. The hub's grammar adds the one thing that question needs and the old
/// screen could not say: *against what*. So the span before this one is drawn
/// as a ghost behind the line, and every total carries an arrow.
///
/// **It is not Reports, and must not drift into it.** Reports answers "what
/// happened in this span", down to the receipts and what is expected in the
/// drawer. This screen answers "how has this shop been trading", across days,
/// and a receipt has no place in it — which is why a day's row opens nothing.
///
/// The chart, the tiles and the table are the SAME `sales/series` answer,
/// drawn three times. That is what makes them impossible to argue with — a
/// figure in the table is the point above it. `sales/window` is deliberately
/// not called here: it would hand back the same totals a second time, plus two
/// hundred receipts this screen never draws.
export function Sales() {
  const span = useParam("span")
  const chosen = spanOf(span.value)
  // Taken once per render, not once per use: `lastDays` reads the clock, and
  // two calls either side of midnight would key the cache on one span and
  // fetch another.
  const range = lastDays(Number(chosen))
  const before = previousWindow(range.from, range.to)

  const run = useQuery({
    queryKey: seriesKey(range.from, range.to, "day"),
    queryFn: ({ signal }) => fetchSeries({ ...range, bucket: "day" }, signal),
  })
  // A second read rather than a wider one: a comparison is worth nothing if
  // it delays the number it qualifies, so the screen paints on the first and
  // fills the arrows in when this lands. Nothing is still being written into
  // a span that has closed, hence the long stale time.
  const prior = useQuery({
    queryKey: seriesKey(before.from, before.to, "day"),
    queryFn: ({ signal }) => fetchSeries({ ...before, bucket: "day" }, signal),
    staleTime: 5 * 60_000,
  })

  const total = run.data === undefined ? null : sum(daysOf(run.data))

  return (
    <MoneyScreen
      sub={
        total === null
          ? "Adding up the days…"
          : `${spanWords(range.from, range.to)} · ${money(total.gross_minor)} over ${units(total.sales_count)} ${total.sales_count === 1 ? "sale" : "sales"}`
      }
    >
      <Toolbar>
        <SpanPicker
          options={SPANS}
          value={chosen}
          onChange={(next) => span.set(next)}
        />
        <span className="flex items-center gap-2 text-meta text-mute">
          <span
            aria-hidden
            className="h-0 w-4 border-t border-dashed border-hairline-strong"
          />
          Compared with {spanWords(before.from, before.to)}
        </span>
      </Toolbar>

      {queryState(run, {
        loading: "Reading the run of days…",
        render: (series) => <Trade run={series} prior={prior.data} />,
      })}
    </MoneyScreen>
  )
}

/// The spans this screen offers, and why none of them is a day.
///
/// A single day has no run to show — a line of one point is a dot — so `Today`
/// stays on Reports, where a day is the whole question. `span` is the
/// parameter Reports already declares in `lib/params.ts`, so the two screens
/// hand it to each other; a value this screen has no button for (`?span=1`
/// carried over from Reports) falls back to a month instead of asking the node
/// for an axis it cannot draw.
const SPANS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const

type Span = (typeof SPANS)[number]["value"]

function spanOf(raw: string | undefined): Span {
  return SPANS.some((option) => option.value === raw) ? (raw as Span) : "30"
}

/// One day of trade, as this screen reads it. The bucket is always `day`: the
/// owner asked for a *daily* table, and week and month grouping live on
/// Reports.
interface Day {
  readonly day: string
  readonly sales_count: number
  readonly units_sold: number
  readonly gross_minor: number
}

type Figures = Omit<Day, "day">

/// Every day on the axis, including the ones nobody sold anything on.
///
/// `cells` carries only the days a sale happened; `buckets` carries the axis.
/// Joining the first onto the second is what puts a real zero on a Sunday the
/// shop was shut — leaving it out would draw one straight line from Saturday
/// to Monday, an invented Sunday's trade on a chart somebody decides from.
function daysOf(run: SalesSeries): readonly Day[] {
  const cells = new Map(run.cells.map((cell) => [cell.bucket_start, cell]))
  return run.buckets.map((day) => ({
    day,
    sales_count: cells.get(day)?.sales_count ?? 0,
    units_sold: cells.get(day)?.units_sold ?? 0,
    gross_minor: cells.get(day)?.gross_minor ?? 0,
  }))
}

function sum(days: readonly Figures[]): Figures {
  return days.reduce(
    (total, day) => ({
      sales_count: total.sales_count + day.sales_count,
      units_sold: total.units_sold + day.units_sold,
      gross_minor: total.gross_minor + day.gross_minor,
    }),
    { sales_count: 0, units_sold: 0, gross_minor: 0 },
  )
}

/// The four figures a day carries, and which one the line is drawn in.
///
/// The average is takings over sales, recomputed for whatever it is asked of —
/// a span's average sale is its takings over its sales, not the mean of thirty
/// daily averages. No margin and no tax: the edge `sale` row has neither, and a
/// column made up here out of numbers the node never computed is a figure
/// nobody can reconcile against the node.
type Measure = "gross_minor" | "sales_count" | "average_minor" | "units_sold"

const MEASURES: readonly {
  readonly kind: Measure
  readonly label: string
  readonly hint: string
  readonly show: (value: number) => string
}[] = [
  {
    kind: "gross_minor",
    label: "Takings",
    hint: "completed sales",
    show: (value) => money(value),
  },
  { kind: "sales_count", label: "Sales", hint: "receipts", show: units },
  {
    kind: "average_minor",
    label: "Average sale",
    hint: "takings over sales",
    show: (value) => money(value),
  },
  { kind: "units_sold", label: "Items", hint: "pieces sold", show: units },
]

function valueOf(figures: Figures, kind: Measure): number {
  if (kind !== "average_minor") return figures[kind]
  return figures.sales_count === 0
    ? 0
    : Math.round(figures.gross_minor / figures.sales_count)
}

function Trade({ run, prior }: { run: SalesSeries; prior?: SalesSeries }) {
  // Which measure the line is drawn in. Deliberately not in the URL, as on
  // the hub: it changes what the chart IS rather than what it is about, and a
  // reader flips it several times while reading one span.
  const [kind, setKind] = useState<Measure>("gross_minor")

  // Nothing at all in the span is a fact about the shop, not a failure of the
  // screen, and it has to read like one. A line lying flat along zero for
  // thirty days looks like a chart that broke.
  if (run.cells.length === 0) {
    return (
      <Card>
        <EmptyState>
          This shop recorded no completed sale between {dayTitle(run.from)} and{" "}
          {dayTitle(run.to)}. There is no line to draw for it.
        </EmptyState>
      </Card>
    )
  }

  const days = daysOf(run)
  const was = prior === undefined ? undefined : daysOf(prior)
  const total = sum(days)
  const wasTotal = was === undefined ? undefined : sum(was)
  const against =
    prior === undefined ? undefined : spanWords(prior.from, prior.to)
  const measure = MEASURES.find((one) => one.kind === kind) ?? MEASURES[0]

  const busiest = run.cells.reduce((best, cell) =>
    cell.gross_minor > best.gross_minor ? cell : best,
  )

  /// One point per day, with the span before's matching day beside it —
  /// aligned by position, so the ghost's own day travels with the row.
  const rows: readonly ChartRow[] = days.map((day, index) => {
    const then = was?.[index]
    return {
      bucket: day.day,
      now: valueOf(day, kind),
      was: then === undefined ? 0 : valueOf(then, kind),
      was_bucket: then?.day ?? "",
    }
  })

  return (
    <>
      <Card className="mb-4">
        <CardHead
          title="How this shop traded"
          sub={`${dayTitle(run.from)} — ${dayTitle(run.to)}`}
        />

        {/* The totals ARE the control, as on the hub: a reader who wants the
            number reads it; a reader who wants its shape presses it and the
            line follows. Two across on a phone, four on a desk. */}
        <div className="grid grid-cols-2 gap-px border-b border-hairline bg-hairline lg:grid-cols-4">
          {MEASURES.map((option) => {
            const on = option.kind === kind
            return (
              <button
                key={option.kind}
                type="button"
                aria-pressed={on}
                onClick={() => setKind(option.kind)}
                className={cn(
                  "flex min-h-tap flex-col gap-1 px-4 py-3 text-left transition-colors",
                  on ? "bg-soft" : "bg-canvas hover:bg-soft/60",
                )}
              >
                <span
                  className={cn(
                    "text-eyebrow font-semibold uppercase",
                    on ? "text-accent" : "text-mute",
                  )}
                >
                  {option.label}
                </span>
                <span className="truncate text-kpi leading-none font-semibold text-ink tabular-nums">
                  {option.show(valueOf(total, option.kind))}
                </span>
                {wasTotal === undefined ? (
                  <span className="text-pill text-faint">{option.hint}</span>
                ) : (
                  <Delta
                    now={valueOf(total, option.kind)}
                    before={valueOf(wasTotal, option.kind)}
                    against={against}
                  />
                )}
              </button>
            )
          })}
        </div>

        <div className="px-3 pt-3.5 pb-2">
          {/* Taller on a desk than in a hand. The chart grammar never
              simplifies between the two — it only gets more room. */}
          <TrendLine
            rows={rows}
            dataKey="now"
            label={measure.label}
            ghost={
              was === undefined
                ? undefined
                : {
                    dataKey: "was",
                    labelOf: (row) =>
                      row.was_bucket === ""
                        ? "Span before"
                        : dayTitle(String(row.was_bucket)),
                  }
            }
            format={measure.show}
            labelOf={dayTick}
            titleOf={dayTitle}
            className="h-[13.75rem] md:h-[17.5rem]"
          />
          <p className="px-1 pt-2 pb-1 text-meta text-mute">
            Busiest day was {dayTitle(busiest.bucket_start)} at{" "}
            <span className="tabular-nums">{money(busiest.gross_minor)}</span>,
            over {units(run.cells.length)} of {units(days.length)} days traded.
          </p>
        </div>
      </Card>

      <DailyTable days={days} was={was} total={total} against={against} />

      <Note>
        Takings, not revenue. A voided sale is out of these figures and a refund
        is not deducted from the day it was given back on — which is how the
        node counts them, and the same count the shift report puts against the
        drawer.
      </Note>
    </>
  )
}

/// One row of the daily table: a day, or the span's foot (`day: null`).
interface Line {
  readonly key: string
  readonly day: string | null
  readonly figures: Figures
  /// The span before's matching day, or null where it has none.
  readonly was: Figures | null
  readonly wasDay: string | null
}

/// The daily table — one quantity measured on consecutive days, read DOWN a
/// column. Ninety cards would be a scroll; ninety rows is a shape.
///
/// Newest first, as the hub orders it: the day somebody wants is almost always
/// the most recent one. The foot is the sum of the rows above it and nothing
/// else.
function DailyTable({
  days,
  was,
  total,
  against,
}: {
  days: readonly Day[]
  was?: readonly Day[]
  total: Figures
  against?: string
}) {
  const today = isoDay(new Date())
  const lines: readonly Line[] = [
    ...days
      .map((day, index) => {
        const then = was?.[index]
        return {
          key: day.day,
          day: day.day,
          figures: day,
          was: then ?? null,
          wasDay: then?.day ?? null,
        }
      })
      .reverse(),
    {
      key: "total",
      day: null,
      figures: total,
      was: was === undefined ? null : sum(was),
      wasDay: null,
    },
  ]

  const figure = (line: Line, value: number, show: string) =>
    value === 0 ? (
      <span className="text-faint">—</span>
    ) : (
      <span className={line.day === null ? "font-semibold text-ink" : ""}>
        {show}
      </span>
    )

  const columns: ListColumn<Line>[] = [
    {
      id: "day",
      header: "Day",
      className: "min-w-[9rem]",
      cell: (line) =>
        line.day === null ? (
          <span className="font-semibold text-ink">
            {units(days.length)} days
          </span>
        ) : (
          <span
            className={cn(
              "flex items-center gap-2",
              // A day the shop took nothing is greyed rather than dropped: it
              // is part of the answer, and it should not read with the weight
              // of a day that traded.
              line.figures.sales_count === 0
                ? "text-mute"
                : "font-medium text-ink",
            )}
          >
            {dayStamp(line.day)}
            {/* Still being written by a till that is still open, so every
                figure on it is a part-day — labelled, because an unlabelled
                part-day beside whole ones reads as a collapse. */}
            {line.day === today && (
              <Pill tone="accent" withDot>
                Today
              </Pill>
            )}
          </span>
        ),
    },
    {
      id: "takings",
      header: "Takings",
      align: "right",
      card: "status",
      className: "tabular-nums",
      cell: (line) =>
        line.figures.gross_minor === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <span
            className={cn(
              "text-ink tabular-nums",
              line.day === null ? "font-semibold" : "font-medium",
            )}
          >
            {money(line.figures.gross_minor)}
          </span>
        ),
    },
    ...(was === undefined
      ? []
      : [
          {
            id: "delta",
            header: "vs before",
            align: "right",
            card: "hide",
            cell: (line) =>
              line.was === null ? (
                <span className="text-faint">·</span>
              ) : (
                <Delta
                  now={line.figures.gross_minor}
                  before={line.was.gross_minor}
                  against={
                    line.day === null
                      ? against
                      : line.wasDay === null
                        ? undefined
                        : dayTitle(line.wasDay)
                  }
                />
              ),
          } satisfies ListColumn<Line>,
        ]),
    {
      id: "sales",
      header: "Sales",
      align: "right",
      card: "hide",
      className: "tabular-nums",
      cell: (line) =>
        figure(line, line.figures.sales_count, units(line.figures.sales_count)),
    },
    {
      id: "average",
      header: "Average sale",
      align: "right",
      card: "hide",
      className: "tabular-nums max-lg:hidden",
      cell: (line) =>
        figure(
          line,
          line.figures.sales_count,
          money(valueOf(line.figures, "average_minor")),
        ),
    },
    {
      id: "items",
      header: "Items",
      align: "right",
      card: "hide",
      className: "tabular-nums",
      cell: (line) =>
        figure(line, line.figures.units_sold, units(line.figures.units_sold)),
    },
    {
      // The phone's line of context, and only the phone's: on a desk the
      // figures have columns of their own.
      id: "summary",
      header: "",
      card: "meta",
      className: "hidden",
      cell: (line) =>
        line.figures.sales_count === 0 ? (
          <span className="text-mute">Nothing sold</span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {units(line.figures.sales_count)}{" "}
              {line.figures.sales_count === 1 ? "sale" : "sales"} ·{" "}
              {units(line.figures.units_sold)} items · avg{" "}
              {money(valueOf(line.figures, "average_minor"))}
            </span>
            {line.was !== null && (
              <Delta
                now={line.figures.gross_minor}
                before={line.was.gross_minor}
              />
            )}
          </span>
        ),
    },
  ]

  return (
    <Card>
      <CardHead
        title="Daily sales"
        sub="Newest first. A day the shop took nothing is greyed, not left out."
      />
      <ListTable
        rows={lines}
        columns={columns}
        rowKey={(line) => line.key}
        empty="No day in this span."
      />
    </Card>
  )
}
