import { useQuery } from "@tanstack/react-query"
import { RotateCcw, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { node } from "@/lib/api"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { count, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import { cn } from "@/lib/utils"
import { Td, TotalRow } from "@/screens/finance-final/parts"
import { share } from "@/screens/finance-final/reports/two-year"
import { isoDay, todayIso } from "@/screens/finance/chart"
import { useUnitName, type DateWindow } from "@/screens/finance/hooks"
import { UnitSelect, WindowControl } from "@/screens/finance/parts"
import type {
  BreakdownCell,
  BreakdownRow,
  BreakdownSite,
  BreakdownTotal,
  SalesBreakdown as Report,
} from "@itulah/contract"

/// Sales by tag, division, store, article, SKU, PO, supplier, campaign,
/// payment and cashier session — ONE screen ten times.
///
/// The owner's menu of 2026-09-30 asks the same question of many different
/// groupings: what did each of these sell, how much of it is still on the
/// shelves, and how did the shops compare. The answer is the same page each
/// time — a chart that replays the window, then the figures under it — so the
/// grouping is a prop and the screens at the bottom are one line each. A tenth
/// grouping is a tenth line, not a tenth copy.
///
/// `GET /api/v1/reports/sales/breakdown?by=…`. The server sends every figure,
/// the stock now, and the window already cut into steps; nothing is summed in
/// the browser except the running totals the scrubber needs, and those add up
/// the server's own step figures.
///
/// **Some groupings overlap** (tag, campaign), and that is the point rather
/// than a bug: an article under two tags sold once is in both rows, so the
/// rows add up to more than the total, which counts every line once. **Nothing
/// is retroactive**: a sale counts under what was true when it was rung up —
/// the tags and division then, the order its piece came in on, the campaign
/// names of that day, the tenders it was paid with. Each grouping says its own
/// part of that in one quiet line under the table (`Kind.note`).
///
/// **Two flags come from the server, not from `by`**: `has_stock` is false for
/// campaign, payment and session (a promotion, a tender or a shift holds no
/// pieces), which drops every Stock column; `rows_total` says how many rows
/// there were when the server kept only the biggest five hundred (article,
/// SKU, PO, session).

export type By =
  | "tag"
  | "division"
  | "store"
  | "article"
  | "sku"
  | "po"
  | "supplier"
  | "campaign"
  | "payment"
  | "session"

interface Kind {
  readonly noun: string
  /// The row with an empty code, for a sale whose article has none.
  readonly none: string
  readonly search: string
  /// The one quiet line under the table: what overlaps, what is not
  /// retroactive. Absent where the grouping has nothing to add.
  readonly note?: string
}

const KINDS: Readonly<Record<By, Kind>> = {
  tag: {
    noun: "Tag",
    none: "Untagged",
    search: "Search tags",
    note: "An article under two tags counts in both, so the rows add up to more than the total. Sales count under the tags an article had when it sold.",
  },
  division: {
    noun: "Division",
    none: "Unclassified",
    search: "Search divisions",
    note: "Sales count under the division an article had when it sold.",
  },
  store: {
    noun: "Store",
    none: "Unassigned",
    search: "Search stores",
  },
  article: {
    noun: "Article",
    none: "Unknown article",
    search: "Search article code or name",
  },
  sku: {
    noun: "SKU",
    none: "Unknown SKU",
    search: "Search SKU or article",
  },
  po: {
    noun: "PO",
    none: "No PO",
    search: "Search PO number or supplier",
    note: "Each piece counts under the order it came in on, read off its tag. Pieces whose tag was not created here have no PO.",
  },
  supplier: {
    noun: "Supplier",
    none: "No supplier",
    search: "Search suppliers",
    note: "Each piece counts under the supplier its purchase order named.",
  },
  campaign: {
    noun: "Campaign",
    none: "No campaign",
    search: "Search campaigns",
    note: "A line touched by two campaigns counts in both, so the rows add up to more than the total. Sales count under the campaign names of the day they were rung up.",
  },
  payment: {
    noun: "Payment",
    none: "Not recorded",
    search: "Search payments",
    note: "A sale paid two ways is split between them in proportion, so pieces are apportioned too. Sales count under the tenders they were paid with.",
  },
  session: {
    noun: "Session",
    none: "No session",
    search: "Search sessions",
    note: "Sales count under the session they were rung on. Returns and sales rung with no session open fall under No session.",
  },
}

/// Groupings whose rows each sit at one shop already, so a per-store table
/// would only repeat the rows along a diagonal.
const ONE_SHOP: ReadonlySet<By> = new Set<By>(["store", "session"])

/// The row a group with no code is drawn as, everywhere it can appear.
const noneKey = "\u0000none"

/// How many bars the chart holds. Ten is what a person can compare by eye;
/// the rest are in the table under it.
const TOP = 10

export function SalesBreakdownScreen({ by, title }: { by: By; title: string }) {
  const kind = KINDS[by]
  const range = useYearToDate()
  const { from, to } = range
  const [unit, setUnit] = useState("")
  const [division, setDivision] = useState("")
  const [view, setView] = useState<"all" | "stores">("all")
  const [needle, setNeedle] = useState("")
  const unitName = useUnitName()

  // The division report is already cut by division; asking it to filter by one
  // as well would be a select that can only ever empty the page.
  const filterable = by !== "division"
  const divisions = useQuery({
    queryKey: vocabularyKeys.list("divisions"),
    queryFn: ({ signal }) => listTerms("divisions", signal),
    staleTime: 5 * 60_000,
    enabled: filterable,
  })

  const divisionCode = filterable ? division : ""
  const ready = from !== "" && to !== "" && from <= to
  const report = useQuery({
    queryKey: [
      "sales",
      "breakdown",
      by,
      from,
      to,
      unit || null,
      divisionCode || null,
    ],
    queryFn: ({ signal }) =>
      salesBreakdown({ by, from, to, unit, division: divisionCode }, signal),
    enabled: ready,
  })

  const divisionName =
    divisions.data?.terms.find((term) => term.code === division)?.label ??
    division
  const note = [
    unit === "" ? "All units" : unitName(unit),
    ...(divisionCode === "" ? [] : [divisionName]),
  ].join(" · ")

  // Rows are stores already when the report is by store, and a session is at
  // one shop; a per-store switch there would repeat the same table.
  const perStore = !ONE_SHOP.has(by) && view === "stores"

  const build = (): ExportSheet | null => {
    const data = report.data
    if (data === undefined) return null
    return exportSheet({
      data,
      kind,
      by,
      perStore,
      subtitle: `${windowLabel(from, to)} · ${note}`,
      filename: `Sales-by-${kind.noun}-${unit === "" ? "All-Units" : fileSafe(unitName(unit))}-${from}-${to}`,
    })
  }

  return (
    <PageContent>
      <PageHeader crumb="Sales" title={title} />

      <Toolbar className="mb-6 gap-3">
        <label className="flex h-control w-72 items-center gap-2 rounded-inner border border-hairline-2 bg-soft px-3 focus-within:border-accent">
          <Search className="size-4 shrink-0 text-line-ico" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label={kind.search}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-mute"
          />
        </label>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="All units"
          className="h-control w-52"
          aria-label="Unit"
        />
        {filterable && (
          <Select
            value={division}
            onChange={setDivision}
            className="h-control w-48"
            aria-label="Division"
          >
            <option value="">All divisions</option>
            {(divisions.data?.terms ?? []).map((term) => (
              <option key={term.code} value={term.code}>
                {term.label}
              </option>
            ))}
          </Select>
        )}
        <Toolbar.Spacer />
        <ExportButton
          build={build}
          disabled={report.data === undefined || report.data.rows.length === 0}
        />
      </Toolbar>

      {!ready ? (
        <Card>
          <EmptyState>Pick a start and an end date.</EmptyState>
        </Card>
      ) : (
        queryState(report, {
          loading: "Adding up the sales…",
          render: (data) => (
            <Body
              // A new window is a new race: back to the last step.
              key={`${by}|${from}|${to}|${unit}|${divisionCode}`}
              report={data}
              by={by}
              title={title}
              kind={kind}
              perStore={perStore}
              needle={needle}
              view={view}
              setView={setView}
            />
          ),
        })
      )}
    </PageContent>
  )
}

export function SalesByTag() {
  return <SalesBreakdownScreen by="tag" title="Sales by tag" />
}

export function SalesByDivision() {
  return <SalesBreakdownScreen by="division" title="Sales by division" />
}

export function SalesByStore() {
  return <SalesBreakdownScreen by="store" title="Sales by store" />
}

export function SalesByArticle() {
  return <SalesBreakdownScreen by="article" title="Sales by article" />
}

export function SalesBySku() {
  return <SalesBreakdownScreen by="sku" title="Sales by SKU" />
}

export function SalesByPo() {
  return <SalesBreakdownScreen by="po" title="Sales by PO" />
}

export function SalesBySupplier() {
  return <SalesBreakdownScreen by="supplier" title="Sales by supplier" />
}

export function SalesByCampaign() {
  return <SalesBreakdownScreen by="campaign" title="Sales by campaign" />
}

export function SalesByPayment() {
  return <SalesBreakdownScreen by="payment" title="Sales by payment" />
}

export function SalesBySession() {
  return <SalesBreakdownScreen by="session" title="Sales by cashier session" />
}

function Body({
  report,
  by,
  title,
  kind,
  perStore,
  needle,
  view,
  setView,
}: {
  report: Report
  by: By
  title: string
  kind: Kind
  perStore: boolean
  needle: string
  view: "all" | "stores"
  setView: (view: "all" | "stores") => void
}) {
  const { voided } = report
  const query = needle.trim().toLowerCase()
  const shown = useMemo(
    () =>
      query === ""
        ? report
        : {
            ...report,
            rows: report.rows.filter((row) =>
              `${row.name} ${row.code}`.toLowerCase().includes(query)
            ),
          },
    [report, query]
  )

  if (report.rows.length === 0) {
    return (
      <Card>
        <EmptyState>No sales in this window.</EmptyState>
      </Card>
    )
  }

  return (
    <>
      <RaceCard report={report} title={title} kind={kind} />

      {!ONE_SHOP.has(by) && (
        <Toolbar className="mb-6">
          <Toolbar.Spacer />
          <Segmented
            options={VIEWS}
            value={view}
            onChange={setView}
            className="shrink-0"
          />
        </Toolbar>
      )}

      {shown.rows.length === 0 ? (
        <Card>
          <EmptyState>No match.</EmptyState>
        </Card>
      ) : (
        <FigureTable report={shown} kind={kind} perStore={perStore} />
      )}

      <div className="mt-6 flex flex-col gap-2 px-2 text-[0.875rem] text-mute tabular-nums">
        {report.rows_total > report.rows.length && (
          <p>
            Top {count(report.rows.length)} of {count(report.rows_total)} by net
            sales.
          </p>
        )}
        <p>
          Voided sales: {count(voided.count)} · {money(voided.gross_minor)}
        </p>
      </div>
    </>
  )
}

const VIEWS: readonly { value: "all" | "stores"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stores", label: "Per store" },
]

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

/// One group's running net across the steps of the window.
interface Runner {
  readonly code: string
  readonly name: string
  /// `cum[i]` is the net from the first step up to and including step `i`.
  readonly cum: readonly number[]
  /// A stable colour for the group. It follows the group, not the rank, so a
  /// bar keeps its hue while it overtakes another.
  readonly color: string
  readonly cap: string
}

/// The hub's categorical tokens, in the order they sit furthest apart. The
/// grey is for the group with no code: it is "the rest", not a competitor.
const HUES: readonly string[] = [
  "var(--a-blue)",
  "var(--a-orange)",
  "var(--a-green)",
  "var(--a-pink)",
  "var(--a-violet)",
  "var(--fill-sky)",
  "var(--fill-orange)",
  "var(--fill-green)",
  "color-mix(in srgb, var(--a-pink) 60%, var(--a-orange))",
  "color-mix(in srgb, var(--a-green) 55%, var(--a-blue))",
]

/// The darker end of a bar: the same hue pulled toward black, so it reads as
/// the bar's own edge rather than a second colour.
const capOf = (color: string) => `color-mix(in srgb, ${color} 70%, black)`

/// How many groups are drawn at once, ranked or not. A bar outside the top ten
/// stays in the DOM, faded, so that when it climbs in it slides from below
/// instead of appearing; this bounds that cost on a report of sixty tags.
const CANDIDATES = 30

/// A row is 2.5rem tall; ranks are placed by `translateY` in multiples of it.
const ROW_REM = 2.5

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]"

function RaceCard({
  report,
  title,
  kind,
}: {
  report: Report
  title: string
  kind: Kind
}) {
  const race = useMemo(() => buildRace(report, kind), [report, kind])
  const last = race.starts.length - 1
  // `null` is "the end", which is where the chart opens: the whole window is
  // what was asked for, and the replay is an extra.
  const [at, setAt] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const pos = Math.min(at ?? last, last)

  // ~6s for the whole replay however many steps there are, at most half a
  // second per step and never so fast a step cannot be seen.
  const every = Math.min(
    500,
    Math.max(60, Math.round(6000 / Math.max(last, 1)))
  )

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setAt((current) => Math.min((current ?? last) + 1, last))
    }, every)
    return () => window.clearInterval(id)
  }, [playing, every, last])

  useEffect(() => {
    if (playing && pos >= last) setPlaying(false)
  }, [playing, pos, last])

  const replay = () => {
    setAt(0)
    setPlaying(true)
  }

  if (race.runners.length === 0) return null

  const ranked = race.runners
    .map((runner, order) => ({ runner, order, value: runner.cum[pos] ?? 0 }))
    .sort((a, b) => b.value - a.value || a.order - b.order)
  const rankOf = new Map(ranked.map((entry, rank) => [entry.runner.code, rank]))
  const shown = Math.min(TOP, race.runners.length)
  const axis = niceAxis(race.peak)
  const leader = ranked[0]?.runner.code
  const more = race.active - TOP

  return (
    <Card className="mb-6 px-5 py-5">
      <h3 className="text-card-title font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-[0.875rem] text-mute">
        {windowLabel(report.from, report.to)}
      </p>

      <div className="mt-5 flex items-baseline justify-between gap-4">
        <div className="text-[2rem] leading-none font-semibold tracking-tight text-ink tabular-nums">
          {bigLabel(race.starts[pos], report.step, race.multiYear)}
        </div>
        <div className="text-[0.875rem] text-mute tabular-nums">
          Total {compactMoney(race.total[pos] ?? 0)}
        </div>
      </div>

      <div className="mt-5">
        {/* The axis: a light row of compact figures above the bars. */}
        <div className="flex" aria-hidden>
          <div className="w-28 shrink-0 sm:w-40" />
          <div className="relative mr-[4.75rem] ml-3 h-6 flex-1">
            {axis.ticks.map((tick) => (
              <span
                key={tick}
                style={{ left: `${(tick / axis.max) * 100}%` }}
                className="absolute top-0 -translate-x-1/2 text-[0.875rem] text-mute tabular-nums"
              >
                {compactMoney(tick)}
              </span>
            ))}
          </div>
        </div>

        <div
          className="relative"
          style={{ height: `${shown * ROW_REM}rem` }}
          role="list"
          aria-label={`${title}, ${bigLabel(race.starts[pos], report.step, race.multiYear)}`}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-[4.75rem] left-[7.75rem] sm:left-[10.75rem]"
          >
            {axis.ticks.map((tick) => (
              <span
                key={tick}
                style={{ left: `${(tick / axis.max) * 100}%` }}
                className="absolute inset-y-0 w-px bg-hairline"
              />
            ))}
          </div>

          {race.runners.map((runner) => {
            const rank = rankOf.get(runner.code) ?? race.runners.length
            const value = runner.cum[pos] ?? 0
            const visible = rank < TOP && value > 0
            const first = runner.code === leader
            return (
              <div
                key={runner.code || noneKey}
                role="listitem"
                aria-hidden={!visible}
                style={{
                  transform: `translateY(${Math.min(rank, shown) * ROW_REM}rem)`,
                  opacity: visible ? 1 : 0,
                }}
                className={cn(
                  "absolute inset-x-0 top-0 flex h-10 items-center",
                  // Only `transform` and `opacity` move the row and only
                  // `width` moves the bar: nothing here asks the browser to
                  // lay the page out again on each step.
                  "transition-[transform,opacity] duration-300",
                  EASE,
                  "motion-reduce:transition-none",
                  !visible && "pointer-events-none"
                )}
              >
                <span
                  title={runner.name}
                  className={cn(
                    "w-28 shrink-0 truncate pr-3 text-right text-[0.875rem] sm:w-40",
                    first ? "font-medium text-ink" : "text-body"
                  )}
                >
                  {runner.name}
                </span>
                <div className="relative mr-[4.75rem] h-full flex-1">
                  <div
                    style={{
                      width: `${Math.max(0, (value / axis.max) * 100)}%`,
                      minWidth: value > 0 ? "4px" : 0,
                      background: runner.color,
                    }}
                    className={cn(
                      "absolute top-1/2 left-0 h-6 -translate-y-1/2 rounded-r-[0.375rem]",
                      "transition-[width] duration-300",
                      EASE,
                      "motion-reduce:transition-none"
                    )}
                  >
                    <span
                      aria-hidden
                      style={{ background: runner.cap }}
                      className="absolute inset-y-0 right-0 w-[3px] rounded-r-[0.375rem]"
                    />
                    <span
                      className={cn(
                        "absolute top-1/2 left-full -translate-y-1/2 pl-2 text-[0.875rem] whitespace-nowrap tabular-nums",
                        first ? "font-medium text-ink" : "text-body"
                      )}
                    >
                      {compactMoney(value)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {more > 0 && (
          <p className="mt-2 text-[0.875rem] text-mute">
            +{more} more in the table
          </p>
        )}
      </div>

      <div className="mt-5 flex items-start gap-3">
        <button
          type="button"
          onClick={replay}
          disabled={last < 1}
          aria-label="Replay from the start"
          title="Replay"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-hairline-2 text-body transition-colors hover:bg-soft-2 hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <Scrubber
            steps={race.starts.length}
            pos={pos}
            label={bigLabel(race.starts[pos], report.step, race.multiYear)}
            onChange={(next) => {
              // Dragging takes the wheel back from the replay.
              setPlaying(false)
              setAt(next)
            }}
          />
          <div className="mt-0.5 flex justify-between gap-4 text-[0.875rem] text-mute">
            <span>
              {shortLabel(race.starts[0], report.step, race.multiYear)}
            </span>
            <span>
              {shortLabel(race.starts[last], report.step, race.multiYear)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

/// A native range input, so the keyboard, the screen reader and touch already
/// work; only the drawing is ours. The input sits over a drawn track so the
/// dots and the filled part line up with the thumb's travel (the thumb is
/// 1rem wide, so its centre runs from 0.5rem to 0.5rem short of each end).
function Scrubber({
  steps,
  pos,
  label,
  onChange,
}: {
  steps: number
  pos: number
  label: string
  onChange: (index: number) => void
}) {
  const last = Math.max(steps - 1, 1)
  // A year of days is not 365 dots: thin them to at most sixty.
  const every = Math.max(1, Math.ceil(steps / 60))
  const dots: number[] = []
  for (let i = 0; i < steps; i += every) dots.push(i)

  return (
    <div className="relative h-9">
      <div
        aria-hidden
        className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-hairline"
      >
        <div
          style={{ width: `${(pos / last) * 100}%` }}
          className="h-full rounded-full bg-hairline-strong"
        />
        {dots.map((i) => (
          <span
            key={i}
            style={{ left: `${(i / last) * 100}%` }}
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hairline-strong"
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={steps - 1}
        step={1}
        value={pos}
        disabled={steps < 2}
        aria-label="Step of the window"
        aria-valuetext={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className={RANGE}
      />
    </div>
  )
}

const RANGE = [
  "absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-default",
  "[&::-webkit-slider-runnable-track]:h-9 [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-moz-range-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:mt-[0.625rem] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-canvas [&::-webkit-slider-thumb]:bg-ink [&::-webkit-slider-thumb]:shadow-soft",
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-canvas [&::-moz-range-thumb]:bg-ink",
  "[&:focus-visible::-webkit-slider-thumb]:ring-4 [&:focus-visible::-webkit-slider-thumb]:ring-hairline-2",
  "[&:focus-visible::-moz-range-thumb]:ring-4 [&:focus-visible::-moz-range-thumb]:ring-hairline-2",
].join(" ")

interface Race {
  /// Every stop of the scrubber, ISO day each, in order.
  readonly starts: readonly string[]
  readonly runners: readonly Runner[]
  /// The window's running net, one line once.
  readonly total: readonly number[]
  /// The biggest running net any group reaches: the axis is fixed to it so a
  /// bar's length means the same thing on every step of the replay.
  readonly peak: number
  /// Groups that sold anything in the window.
  readonly active: number
  readonly multiYear: boolean
}

/// The server sends only the steps where something sold. The scrubber wants
/// every stop, so the list is generated from the window and the step size —
/// and then unioned with whatever the server did send, so that a step the two
/// disagree about is still a stop rather than a lost figure.
function buildRace(report: Report, kind: Kind): Race {
  const starts = stepStarts(report.from, report.to, report.step)
  const known = new Set(starts)
  for (const step of report.step_totals) known.add(step.starts)
  for (const step of report.steps) known.add(step.starts)
  const list = [...known].sort()
  const index = new Map(list.map((start, i) => [start, i]))

  const perGroup = new Map<string, number[]>()
  for (const step of report.steps) {
    const i = index.get(step.starts)
    if (i === undefined) continue
    let series = perGroup.get(step.code)
    if (series === undefined) {
      series = new Array<number>(list.length).fill(0)
      perGroup.set(step.code, series)
    }
    series[i] += step.net_minor
  }

  const total = new Array<number>(list.length).fill(0)
  for (const step of report.step_totals) {
    const i = index.get(step.starts)
    if (i !== undefined) total[i] += step.net_minor
  }

  const running = (series: readonly number[]) => {
    let sum = 0
    return series.map((value) => (sum += value))
  }

  const candidates = report.rows
    .filter((row) => perGroup.has(row.code))
    .map((row) => ({ row, cum: running(perGroup.get(row.code) ?? []) }))
    .sort(
      (a, b) => (b.cum[b.cum.length - 1] ?? 0) - (a.cum[a.cum.length - 1] ?? 0)
    )

  let hue = 0
  const runners: Runner[] = candidates
    .slice(0, CANDIDATES)
    .map(({ row, cum }) => {
      const color =
        row.code === "" ? "var(--hairline-strong)" : HUES[hue++ % HUES.length]
      return {
        code: row.code,
        name: row.code === "" ? kind.none : row.name,
        cum,
        color,
        cap: row.code === "" ? "var(--mute)" : capOf(color),
      }
    })

  return {
    starts: list,
    runners,
    total: running(total),
    peak: Math.max(0, ...runners.flatMap((runner) => runner.cum)),
    active: candidates.length,
    multiYear: report.from.slice(0, 4) !== report.to.slice(0, 4),
  }
}

/// The first day of every step in the window: each day; each Monday, the first
/// stop being the window's own first day when that is mid-week; the 1st of each
/// month likewise. Mirrors how the server cuts `steps`.
function stepStarts(from: string, to: string, step: string): string[] {
  const end = parseIso(to)
  const out = [from]
  let cursor = parseIso(from)
  // A guard, not a limit: the server never sends more than a few hundred
  // steps, and a malformed pair of dates must not spin the tab.
  for (let guard = 0; guard < 2000; guard++) {
    let next: Date
    if (step === "day") {
      next = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 1
      )
    } else if (step === "week") {
      const sinceMonday = (cursor.getDay() + 6) % 7
      next = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 7 - sinceMonday
      )
    } else {
      next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    }
    if (next > end) break
    out.push(isoDay(next))
    cursor = next
  }
  return out
}

function parseIso(iso: string): Date {
  const [year, month, date] = iso.split("-").map(Number)
  return new Date(year, (month ?? 1) - 1, date ?? 1)
}

const monthShort = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short" })

/// "15 Sep" — a day without its year.
function dayLabel(iso: string): string {
  const date = parseIso(iso)
  return `${date.getDate()} ${monthShort(date)}`
}

/// "1 Jan – 30 Sep 2026", or with both years when the window crosses one.
function windowLabel(from: string, to: string): string {
  const full = (iso: string) => `${dayLabel(iso)} ${iso.slice(0, 4)}`
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${dayLabel(from)} – ${full(to)}`
    : `${full(from)} – ${full(to)}`
}

/// The big label over the bars: what the scrubber is standing on.
function bigLabel(iso: string | undefined, step: string, multiYear: boolean) {
  if (iso === undefined) return ""
  const date = parseIso(iso)
  const year = multiYear ? ` ${date.getFullYear()}` : ""
  if (step === "month") {
    return `${date.toLocaleDateString("en-US", { month: "long" })}${year}`
  }
  if (step === "week") return `Week of ${dayLabel(iso)}${year}`
  return `${dayLabel(iso)}${year}`
}

/// The same stop, short enough to sit under either end of the slider.
function shortLabel(iso: string | undefined, step: string, multiYear: boolean) {
  if (iso === undefined) return ""
  const date = parseIso(iso)
  if (step === "month") {
    return `${monthShort(date)}${multiYear ? ` ${date.getFullYear()}` : ""}`
  }
  return `${dayLabel(iso)}${multiYear ? ` ${date.getFullYear()}` : ""}`
}

/// Rupiah the way an Indonesian chart says it: rb (thousand), jt (million),
/// M (billion), T (trillion). The full figure is in the table; a bar only has
/// to say roughly how long it is.
const compactNumber = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0,
  }).format(value)

function compactMoney(minor: number): string {
  const sign = minor < 0 ? "−" : ""
  const size = Math.abs(minor)
  if (size >= 1e12) return `${sign}Rp ${compactNumber(size / 1e12)} T`
  if (size >= 1e9) return `${sign}Rp ${compactNumber(size / 1e9)} M`
  if (size >= 1e6) return `${sign}Rp ${compactNumber(size / 1e6)} jt`
  if (size >= 1e3) return `${sign}Rp ${compactNumber(size / 1e3)} rb`
  return `${sign}Rp ${compactNumber(size)}`
}

/// A round top for the axis and the gridlines under it: a step of 1, 2, 2.5 or
/// 5 times a power of ten, so the ticks read "200 jt, 400 jt" and not
/// "183 jt, 366 jt".
function niceAxis(peak: number): { max: number; ticks: number[] } {
  if (peak <= 0) return { max: 1, ticks: [] }
  const raw = peak / 5
  const power = 10 ** Math.floor(Math.log10(raw))
  const lead = raw / power
  const unit =
    (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 2.5 ? 2.5 : lead <= 5 ? 5 : 10) *
    power
  const ticks: number[] = []
  for (let tick = unit; tick < peak + unit; tick += unit) ticks.push(tick)
  return { max: ticks[ticks.length - 1] ?? peak, ticks }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/// Name | Stock | Qty sold | Sales — or, with the switch on, those three for
/// every store and then for all of them.
///
/// A plain table and not `DataTable`: the per-store view needs two header rows
/// (a store spanning its three columns) and the list is already in the order
/// the server ranked it, so nothing here sorts. It scrolls sideways inside its
/// card and the name column stays put while it does; down the page it grows
/// with the page, like every long list in the hub.
function FigureTable({
  report,
  kind,
  perStore,
}: {
  report: Report
  kind: Kind
  perStore: boolean
}) {
  const hasStock = report.has_stock
  const width = hasStock ? 3 : 2
  const cells = useMemo(() => {
    const map = new Map<string, BreakdownCell>()
    for (const cell of report.cells)
      map.set(cellKey(cell.code, cell.site_id), cell)
    return map
  }, [report.cells])
  const siteTotals = useMemo(() => {
    const map = new Map<string, BreakdownCell>()
    for (const cell of report.site_totals) map.set(cell.site_id, cell)
    return map
  }, [report.site_totals])

  return (
    <Card className="overflow-clip">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-cell [&_tr:last-child>td]:border-b-0 [&_tr:last-child>td:last-child]:pr-6 [&_tr>:last-child]:pr-6 [&_tr[data-total]>td]:font-semibold">
          <thead>
            {perStore ? (
              <>
                <tr>
                  <Head rowSpan={2} sticky>
                    {kind.noun}
                  </Head>
                  {report.sites.map((site) => (
                    <Head
                      key={site.site_id}
                      colSpan={width}
                      align="center"
                      edge
                    >
                      {site.name}
                    </Head>
                  ))}
                  <Head colSpan={width} align="center" edge>
                    All
                  </Head>
                </tr>
                <tr>
                  {[...report.sites, null].map((site) => (
                    <SubHeads
                      key={site?.site_id ?? "all"}
                      hasStock={hasStock}
                    />
                  ))}
                </tr>
              </>
            ) : (
              <tr>
                <Head sticky>{kind.noun}</Head>
                {hasStock && (
                  <Head align="right" title={STOCK_TITLE}>
                    Stock
                  </Head>
                )}
                <Head align="right">Quantity sold</Head>
                <Head align="right">Sales</Head>
              </tr>
            )}
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <GroupRow
                key={row.code || noneKey}
                row={row}
                kind={kind}
                sites={perStore ? report.sites : null}
                cells={cells}
                hasStock={hasStock}
              />
            ))}
            <TotalRow>
              <Td className="sticky left-0 z-[1] bg-soft pl-6">Total</Td>
              {perStore && (
                <>
                  {report.sites.map((site) => (
                    <Figures
                      key={site.site_id}
                      stock={siteTotals.get(site.site_id)?.stock}
                      quantity={siteTotals.get(site.site_id)?.quantity}
                      net={siteTotals.get(site.site_id)?.net_minor}
                      hasStock={hasStock}
                      edge
                    />
                  ))}
                </>
              )}
              <TotalFigures
                total={report.total}
                edge={perStore}
                hasStock={hasStock}
              />
            </TotalRow>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const STOCK_TITLE = "Pieces on hand at the shops now"

const cellKey = (code: string, site: string) => `${code}\u0000${site}`

function GroupRow({
  row,
  kind,
  sites,
  cells,
  hasStock,
}: {
  row: BreakdownRow
  kind: Kind
  /// The stores to draw a column group for, or `null` for the plain table.
  sites: readonly BreakdownSite[] | null
  cells: ReadonlyMap<string, BreakdownCell>
  hasStock: boolean
}) {
  const none = row.code === ""
  return (
    <tr className="group/row h-14 hover:bg-soft">
      <Td className="sticky left-0 z-[1] bg-canvas pl-6 group-hover/row:bg-soft">
        <span
          title={none ? undefined : row.name}
          className={cn(
            "block min-w-60 whitespace-nowrap",
            none ? "text-mute" : "font-medium text-ink"
          )}
        >
          {none ? kind.none : row.name}
        </span>
      </Td>
      {sites?.map((site) => {
        const cell = cells.get(cellKey(row.code, site.site_id))
        return (
          <Figures
            key={site.site_id}
            stock={cell?.stock}
            quantity={cell?.quantity}
            net={cell?.net_minor}
            hasStock={hasStock}
            muted={none}
            edge
          />
        )
      })}
      <Figures
        stock={row.stock}
        quantity={row.quantity}
        net={row.net_minor}
        hasStock={hasStock}
        muted={none}
        edge={sites !== null}
        plain={sites === null}
      />
    </tr>
  )
}

/// The three figure cells of one column group. A missing cell is zeros — the
/// server sends a cell only where the group sold or holds stock — and a zero
/// in a grid of many stores is drawn as a quiet dash so the numbers stand out.
function Figures({
  stock,
  quantity,
  net,
  hasStock,
  muted,
  edge,
  plain,
}: {
  stock: number | undefined
  quantity: number | undefined
  net: number | undefined
  /// Campaign and payment hold no pieces, so they have no stock cell.
  hasStock: boolean
  muted?: boolean
  edge?: boolean
  /// The plain table shows a zero as a zero: there it is an answer.
  plain?: boolean
}) {
  const figure = (value: number | undefined, text: (n: number) => string) =>
    value === undefined || (value === 0 && !plain) ? (
      <span className="text-mute">—</span>
    ) : (
      text(value)
    )
  const tone = muted ? "text-mute" : undefined
  return (
    <>
      {hasStock && (
        <Td
          align="right"
          className={cn(tone, edge && "border-l border-hairline pl-7")}
        >
          {figure(stock, count)}
        </Td>
      )}
      <Td
        align="right"
        className={cn(
          tone,
          !hasStock && edge && "border-l border-hairline pl-7"
        )}
      >
        {figure(quantity, count)}
      </Td>
      <Td align="right" className={tone}>
        {figure(net, money)}
      </Td>
    </>
  )
}

function TotalFigures({
  total,
  edge,
  hasStock,
}: {
  total: BreakdownTotal
  edge: boolean
  hasStock: boolean
}) {
  const rule = edge ? "border-l border-hairline pl-7" : undefined
  return (
    <>
      {hasStock && (
        <Td align="right" className={rule}>
          {count(total.stock)}
        </Td>
      )}
      <Td align="right" className={hasStock ? undefined : rule}>
        {count(total.quantity)}
      </Td>
      <Td align="right">{money(total.net_minor)}</Td>
    </>
  )
}

/// Stock | Qty | Sales under a store's name.
function SubHeads({ hasStock }: { hasStock: boolean }) {
  return (
    <>
      {hasStock && (
        <Head align="right" edge title={STOCK_TITLE}>
          Stock
        </Head>
      )}
      <Head align="right" edge={!hasStock}>
        Qty
      </Head>
      <Head align="right">Sales</Head>
    </>
  )
}

/// The table's heading cell, drawn like `Th` in `finance-final/parts` with the
/// three things that one cannot say: span columns or rows, stay put when the
/// grid scrolls sideways, and carry a rule down its left edge.
function Head({
  children,
  align,
  colSpan,
  rowSpan,
  sticky,
  edge,
  title,
}: {
  children?: React.ReactNode
  align?: "right" | "center"
  colSpan?: number
  rowSpan?: number
  sticky?: boolean
  edge?: boolean
  title?: string
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      title={title}
      className={cn(
        "h-12 border-b border-hairline bg-soft px-4 py-0 text-cell font-medium whitespace-nowrap text-mute normal-case",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
        sticky && "sticky left-0 z-[2] pl-6",
        edge && "border-l",
        edge && align === "right" && "pl-7"
      )}
    >
      {children}
    </th>
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function exportSheet({
  data,
  kind,
  by,
  perStore,
  subtitle,
  filename,
}: {
  data: Report
  kind: Kind
  by: By
  perStore: boolean
  subtitle: string
  filename: string
}): ExportSheet {
  // A store's code is its id, which is nothing a person reads.
  const withCode = by !== "store"
  const hasStock = data.has_stock
  const cells = new Map<string, BreakdownCell>()
  for (const cell of data.cells)
    cells.set(cellKey(cell.code, cell.site_id), cell)
  const siteTotals = new Map<string, BreakdownCell>()
  for (const cell of data.site_totals) siteTotals.set(cell.site_id, cell)

  const figures = (
    code: string,
    name: string,
    articles: number | null,
    line: BreakdownRow | BreakdownTotal,
    stores: (site: BreakdownSite) => BreakdownCell | undefined
  ): (string | number | null)[] => {
    const gp = line.net_minor - line.cost_minor
    return [
      ...(withCode ? [code] : []),
      name,
      articles,
      line.quantity,
      line.gross_minor,
      line.discount_minor,
      line.returns_minor,
      line.net_minor,
      line.cost_minor,
      gp,
      share(gp, line.net_minor),
      ...(hasStock ? [line.stock] : []),
      ...(perStore
        ? data.sites.flatMap((site) => {
            const cell = stores(site)
            return [
              ...(hasStock ? [cell?.stock ?? 0] : []),
              cell?.quantity ?? 0,
              cell?.net_minor ?? 0,
            ]
          })
        : []),
    ]
  }

  return {
    filename,
    sheet: `Sales by ${kind.noun}`,
    title: `Sales by ${kind.noun}`,
    subtitle,
    columns: [
      ...(withCode
        ? [{ header: "Code", kind: "text" as const, width: 16 }]
        : []),
      { header: kind.noun, kind: "text", width: 28 },
      { header: "Articles", kind: "number" },
      { header: "Quantity", kind: "number" },
      { header: "Gross Sales", kind: "money" },
      { header: "Discount", kind: "money" },
      { header: "Returns", kind: "money" },
      { header: "Net Sales", kind: "money" },
      { header: "HPP", kind: "money" },
      { header: "Gross Profit", kind: "money" },
      { header: "Margin %", kind: "percent" },
      ...(hasStock ? [{ header: "Stock", kind: "number" as const }] : []),
      ...(perStore
        ? data.sites.flatMap((site) => [
            ...(hasStock
              ? [{ header: `${site.name} Stock`, kind: "number" as const }]
              : []),
            { header: `${site.name} Quantity`, kind: "number" as const },
            { header: `${site.name} Sales`, kind: "money" as const },
          ])
        : []),
    ],
    rows: [
      ...data.rows.map((row) =>
        figures(
          row.code,
          row.code === "" ? kind.none : row.name,
          row.articles,
          row,
          (site) => cells.get(cellKey(row.code, site.site_id))
        )
      ),
      [],
      [
        ...(withCode ? [""] : []),
        "Voided sales",
        null,
        data.voided.count,
        data.voided.gross_minor,
      ],
    ],
    totalRow: figures("", "Total", null, data.total, (site) =>
      siteTotals.get(site.site_id)
    ),
  }
}

// ---------------------------------------------------------------------------

/// A window defaulting to the year so far, and following the boxes once
/// somebody edits one. The same default the division report in Finance opens
/// on; copied rather than shared because that file owns its own screen and
/// this one only borrows its habit.
function useYearToDate(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)
  const today = todayIso()
  const value = draft ?? { from: `${today.slice(0, 4)}-01-01`, to: today }
  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: windowLabel(value.from, value.to),
  }
}

/// Query string from what is set; an empty filter is left off.
function salesBreakdown(
  params: {
    by: By
    from: string
    to: string
    unit: string
    division: string
  },
  signal?: AbortSignal
): Promise<Report> {
  const query = new URLSearchParams({
    by: params.by,
    from: params.from,
    to: params.to,
  })
  if (params.unit !== "") query.set("unit", params.unit)
  if (params.division !== "") query.set("division", params.division)
  return node.get<Report>(
    `/api/v1/reports/sales/breakdown?${query.toString()}`,
    {
      signal,
    }
  )
}
