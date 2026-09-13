import { useQuery } from "@tanstack/react-query"

import { Card } from "@/components/ui/card"
import { LineSeries, type ChartRow } from "@/components/ui/chart"
import { MiniRow, MiniTable } from "@/components/ui/rows"
import { Screen, Section } from "@/components/ui/screen"
import { Segmented } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { useParam } from "@/lib/params"
import { queryState } from "@/lib/query-state"
import {
  fetchSeries,
  lastDays,
  seriesKey,
  type SalesSeries,
} from "@/lib/queries"
import { money, units } from "@itulah/contract/money"

/// How the trade ran, day by day.
///
/// The owner asked for this screen in two sentences — a chart of sales on top,
/// "garis meningkat menurun", and a daily sales table under it — and the
/// restraint is the point. It answers one question: is the shop going up or
/// down.
///
/// **It is not Reports, and must not drift into it.** Reports answers "what
/// happened in this span", in detail, down to the receipts and what is expected
/// in the drawer: one window, read at close, by whoever is counting the cash.
/// This screen answers "how has this shop been trading", across days, and a
/// receipt has no place in it.
///
/// The chart and the table are the SAME `sales/series` answer, drawn twice.
/// That is what makes them impossible to argue with — a figure in the table is
/// the point above it. `sales/window` is deliberately not called here: it would
/// hand back the same totals a second time, plus two hundred receipts this
/// screen never draws, and two endpoints answering one screen is how a summary
/// ends up disagreeing with the rows beneath it.
export function Sales() {
  const span = useParam("span")
  const chosen = spanOf(span.value)
  // Taken once per render, not once per use: `lastDays` reads the clock, and
  // two calls either side of midnight would key the cache on one span and fetch
  // another.
  const range = lastDays(Number(chosen))

  const run = useQuery({
    queryKey: seriesKey(range.from, range.to, "day"),
    queryFn: ({ signal }) => fetchSeries({ ...range, bucket: "day" }, signal),
  })

  return (
    <Screen foot="none">
      <div className="pt-1 pb-4">
        <Segmented
          options={SPANS}
          value={chosen}
          onChange={(next) => span.set(next)}
        />
      </div>

      {queryState(run, {
        loading: "Reading the run of days…",
        render: (series) => <Trade run={series} />,
      })}
    </Screen>
  )
}

/// The spans this screen offers, and why none of them is a day.
///
/// A single day has no run to show — a line of one point is a dot — so `Today`
/// stays on Reports, where a day is the whole question. `span` is the parameter
/// Reports already declares in `lib/params.ts`, so the two screens hand it to
/// each other rather than each inventing a key; a value this screen has no
/// button for (`?span=1` carried over from Reports, `?span=9999` typed into the
/// bar) falls back to a month instead of asking the node for an axis it cannot
/// draw.
const SPANS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const

type Span = (typeof SPANS)[number]["value"]

function spanOf(raw: string | undefined): Span {
  return SPANS.some((option) => option.value === raw) ? (raw as Span) : "30"
}

/// One day of trade, as this screen reads it.
///
/// The bucket is always `day`. The owner asked for a *daily* table, and the
/// week/month grouping already exists on Reports — offering it here too would
/// leave two screens that differ by a dropdown.
interface Day {
  readonly day: string
  readonly sales_count: number
  readonly units_sold: number
  readonly gross_minor: number
}

function Trade({ run }: { run: SalesSeries }) {
  // `cells` carries only the days a sale actually happened on; `buckets`
  // carries the axis. Joining the first onto the second is what puts a real
  // zero on a Sunday the shop was shut — and leaving those days out instead
  // would draw one straight line from Saturday to Monday, which is an invented
  // Sunday's trade on a chart somebody makes a decision from.
  const cells = new Map(run.cells.map((cell) => [cell.bucket_start, cell]))
  const days: readonly Day[] = run.buckets.map((day) => ({
    day,
    sales_count: cells.get(day)?.sales_count ?? 0,
    units_sold: cells.get(day)?.units_sold ?? 0,
    gross_minor: cells.get(day)?.gross_minor ?? 0,
  }))

  const total = days.reduce(
    (sum, day) => ({
      sales_count: sum.sales_count + day.sales_count,
      units_sold: sum.units_sold + day.units_sold,
      gross_minor: sum.gross_minor + day.gross_minor,
    }),
    { sales_count: 0, units_sold: 0, gross_minor: 0 },
  )

  // Nothing at all in the span is a fact about the shop, not a failure of the
  // screen, and it has to read like one. A line lying flat along zero for
  // thirty days looks like a chart that broke.
  if (run.cells.length === 0) {
    return (
      <EmptyState>
        This shop recorded no completed sale between {title(run.from)} and{" "}
        {title(run.to)}. There is no line to draw for it.
      </EmptyState>
    )
  }

  const busiest = run.cells.reduce((best, cell) =>
    cell.gross_minor > best.gross_minor ? cell : best,
  )
  const rows: readonly ChartRow[] = days.map((day) => ({
    bucket: day.day,
    takings: day.gross_minor,
  }))

  return (
    <>
      <Section
        title="Takings, day by day"
        action={
          <span className="text-metric font-semibold text-ink tabular-nums">
            {money(total.gross_minor)}
          </span>
        }
      >
        <Card className="px-3 pt-3.5 pb-2">
          {/* Taller on a counter monitor than in a hand. The chart grammar
              never simplifies between the two — it only gets more room. */}
          <LineSeries
            rows={rows}
            dataKey="takings"
            label="Takings"
            format={money}
            labelOf={label}
            titleOf={title}
            className="h-[13.75rem] md:h-[17.5rem]"
          />
          <p className="px-1 pt-2 pb-1 text-meta text-mute">
            Busiest day was {title(busiest.bucket_start)} at{" "}
            <span className="tabular-nums">{money(busiest.gross_minor)}</span>,
            over {units(run.cells.length)} of {units(days.length)} days traded.
          </p>
        </Card>
      </Section>

      {/* The second `<table>` in this app, where `components/ui/rows.tsx` says
          a list is a stack of cards. It earns the exception by not being a list
          of records: it is one quantity measured on consecutive days, and the
          reason to draw it at all is to read DOWN a column. Ninety cards is a
          scroll; ninety rows is a shape.

          Four columns and no more, because `SalesCell` has three figures and
          nothing else. No margin and no tax: `edge/reports.rs` says in its own
          module docs that the edge `sale` row has neither, and a column made up
          here out of numbers the node never computed is a figure nobody can
          reconcile against the node. */}
      <Section title="Daily sales">
        <Card>
          {/* Its own scroller, and the floor under the table is what makes it
              one. Four columns of tabular figures measure 335px on a 375px
              phone — they fit, and they stop fitting the first day this shop
              takes eight figures. Without the scroller that day widens the
              whole app sideways instead; the page itself never scrolls
              horizontally, this does. */}
          <div className="overflow-x-auto">
            <MiniTable
              head={["Day", "Sales", "Items", "Takings"]}
              className="min-w-[20rem]"
            >
              {days.map((day) => (
                <MiniRow
                  key={day.day}
                  // A day the shop took nothing is greyed rather than dropped:
                  // it is part of the answer, and it should not read with the
                  // same weight as a day that traded.
                  className={day.sales_count === 0 ? "[&>td]:text-mute" : ""}
                >
                  <td>{stamp(day.day)}</td>
                  <td>
                    {day.sales_count === 0 ? "—" : units(day.sales_count)}
                  </td>
                  <td>{day.units_sold === 0 ? "—" : units(day.units_sold)}</td>
                  <td>
                    {day.gross_minor === 0 ? "—" : money(day.gross_minor)}
                  </td>
                </MiniRow>
              ))}
              {/* The foot is the sum of the rows above it and nothing else. */}
              <MiniRow className="border-t border-hairline [&>td]:py-2.5 [&>td]:font-medium [&>td:first-child]:font-medium">
                <td>{units(days.length)} days</td>
                <td>{units(total.sales_count)}</td>
                <td>{units(total.units_sold)}</td>
                <td>{money(total.gross_minor)}</td>
              </MiniRow>
            </MiniTable>
          </div>
        </Card>
        <p className="mt-3 text-meta text-mute">
          Takings, not revenue. A voided sale is out of these figures and a
          refund is not deducted from the day it was given back on — which is
          how the node counts them, and the same count the shift report puts
          against the drawer.
        </p>
      </Section>
    </>
  )
}

/// The three ways a day is written on this screen.
///
/// Local to it rather than added to `lib/format.ts`, which this screen does not
/// own: what is there is `moment()`, a day AND a minute, and every figure here
/// is a whole day — printing `08 Sep 00:00` against a day's takings would put a
/// time on a number that has none. `new Date(iso)` alone would read the node's
/// `YYYY-MM-DD` as UTC and move a Jakarta shop's day back by one, so the
/// midnight is spelled out and parsed local, the same way `isoDay()` writes it.
const at = (iso: string) => new Date(`${iso}T00:00:00`)

/// The x-axis tick: as short as a date gets and still be a date.
const label = (iso: string) =>
  at(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })

/// The tooltip and the prose: the day somebody says out loud.
const title = (iso: string) =>
  at(iso).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })

/// The table's first column. The weekday is carried because half of what this
/// table is read for is which days are quiet, and a reader should not have to
/// work that out from a number.
const stamp = (iso: string) =>
  at(iso).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  })
