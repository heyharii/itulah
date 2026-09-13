import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { financeKeys, statement } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { asPresented, ladderLevel, periodResult } from "@/screens/finance/chart"
import { useLocations, useWindow } from "@/screens/finance/hooks"
import { LocationSelect, SiteName, WindowControl } from "@/screens/finance/parts"
import type { Statement } from "@itulah/contract"

/// What was earned and what it cost, over a window, by unit.
///
/// # The family these four reports belong to
///
/// This is the first of the Reports group to be written, so it settles the
/// shape the other three follow. Four rules, and they are the whole of it:
///
///  1. **The toolbar is always dates, then unit, then whatever this report
///     alone needs, then the sentence saying what is on screen.** A reader
///     moving between Profit & Loss and Balance Sheet should not have to go
///     looking for the location select again.
///  2. **The figures a reader checks first sit in `<NumberCard>`s above the
///     table**, and they are the server's own numbers — never a sum of the
///     rows below them. A page that added up its visible rows would report a
///     different answer while it was still loading.
///  3. **One tree, one indent.** `ladderLevel()` turns the client's
///     `{1,3,5,7,10,12}` code ladder into a rung, and a rung is `1.125rem`.
///     Indenting by the raw code length would step four times between a
///     heading and its child.
///  4. **`TotalRow` ends a table and appears once.** Subtotals inside the tree
///     are ordinary rows carrying their own rule; the bottom line is the one
///     with `TotalRow`'s.
///
/// # Why the comparison is an axis the reader picks
///
/// ERPNext offers `periodicity` — monthly, quarterly, half-yearly, yearly
/// columns — and, separately, `group_by_dimension`. They drive the **same
/// axis**, so "store against store, month by month" is not a report you can
/// ask ERPNext for. Worse, its unit comparison only works when each shop is
/// its own Company: thirteen charts of accounts and inter-company entries to
/// keep them straight.
///
/// This module rejected that arrangement. One chart, and the unit is a
/// dimension on the ledger row (`journal_line.site_id`), so both comparisons
/// are askable here — a column is one more request to
/// `GET /finance/statement` with its own `from`, `to` and `site`, and never a
/// slice of a wider answer cut up in the browser. A per-unit profit and loss
/// is the thing this model does *better* than the reference, and it costs one
/// round trip per shop.
///
/// Still one axis at a time, and deliberately: fourteen units across six
/// months is eighty-four requests and a table nobody can read.
///
/// # Why income reads positive here and negative on the wire
///
/// The server sends every figure as the ledger holds it — debits positive — so
/// income arrives negative and a loss arrives *positive*. A balance does not
/// know it is about to be printed on a page where income reads as a positive
/// number; a statement does. `asPresented()` and `periodResult()` are that
/// knowledge, shared with the live Finance module so the two reports cannot
/// disagree about a figure they both got right.
export function ProfitAndLoss() {
  const range = useWindow()
  const [site, setSite] = useState("")
  const [compare, setCompare] = useState<CompareAxis>("NONE")

  const locations = useLocations()

  // Comparing units and filtering to one unit is a filter fighting the thing
  // it filters, so the select goes dead rather than disappearing — a control
  // that vanishes between modes reads as a bug. The consolidated reading is
  // then the last column, which is what "all units" means.
  const byUnit = compare === "UNIT"
  const effectiveSite = byUnit ? "" : site

  const columns = useMemo<readonly ReportColumn[]>(() => {
    if (compare === "NONE") return []
    if (compare === "UNIT") {
      return (locations.data?.locations ?? []).map((location) => ({
        key: `site:${location.site_id}`,
        label: location.name,
        from: range.from,
        to: range.to,
        site: location.site_id,
      }))
    }
    return periodColumns(range.from, range.to, compare).map((period) => ({
      key: `period:${period.from}`,
      label: period.label,
      from: period.from,
      to: period.to,
      site: effectiveSite,
    }))
  }, [compare, locations.data, range.from, range.to, effectiveSite])

  // Past this many the table stops being readable and the fan-out stops being
  // polite. Refused outright rather than silently truncated: a report that
  // quietly dropped the last nine months would be wrong in the one way a
  // finance screen may never be.
  const tooWide = columns.length > MAX_COLUMNS

  /// The whole window at the chosen unit. Asked on every axis, because it is
  /// three things at once: the figures in the cards, the Total column beside
  /// the comparison, and the check on it — the server computes it from
  /// `journal_line` rather than by adding the columns up, so a disagreement
  /// between it and the columns beside it is a bug showing itself.
  const total = useQuery({
    queryKey: financeKeys.statement(
      "PROFIT_LOSS",
      range.from,
      range.to,
      effectiveSite || null
    ),
    queryFn: ({ signal }) =>
      statement(
        "PROFIT_LOSS",
        { from: range.from, to: range.to, site: effectiveSite || undefined },
        signal
      ),
  })

  // `combine` rather than a `useMemo` over the results: `useQueries` hands back
  // a fresh array every render, so a memo over it would either recompute
  // constantly or need a hand-rolled fingerprint as its dependency. Keyed
  // positionally and zipped with `columns` at render time, so nothing in here
  // closes over a value whose identity changes each pass.
  const cells = useQueries({
    queries: (tooWide ? [] : columns).map((column) => ({
      queryKey: financeKeys.statement(
        "PROFIT_LOSS",
        column.from,
        column.to,
        column.site || null
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        statement(
          "PROFIT_LOSS",
          { from: column.from, to: column.to, site: column.site || undefined },
          signal
        ),
    })),
    combine: (results) => ({
      readings: results.map((result) => readingOf(result.data)),
    }),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Reports"
        title="Profit & Loss"
        sub="What was earned and what it cost, over a window, by unit."
      />

      <Toolbar>
        <WindowControl range={range} />
        <LocationSelect
          value={site}
          onChange={setSite}
          disabled={byUnit}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Segmented
          value={compare}
          onChange={setCompare}
          options={COMPARE_OPTIONS}
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box left blank and a
            date box filled with today look identical to a reader; this
            sentence is what tells them which report they are looking at. */}
        <span className="text-[0.71875rem] text-mute">
          {range.chip}
          {byUnit ? (
            " · every unit, side by side"
          ) : site === "" ? (
            " · every unit"
          ) : (
            <>
              {" · "}
              <SiteName id={site} />
            </>
          )}
        </span>
      </Toolbar>

      {queryState(total, {
        loading: "Reading what was earned and what it cost…",
        render: (report) => {
          const anchor = readingOf(report)
          const shown: readonly ShownColumn[] =
            compare === "NONE" || tooWide
              ? [{ key: "total", label: "Amount", reading: anchor }]
              : [
                  ...columns.map((column, index) => ({
                    key: column.key,
                    label: column.label,
                    reading: cells.readings[index] ?? EMPTY_READING,
                  })),
                  {
                    key: "total",
                    label: byUnit ? "All units" : "Total",
                    reading: anchor,
                  },
                ]
          const rows = buildTree([
            report,
            ...cells.readings.map((reading) => reading.report),
          ])
          const result = periodResult(report.result_minor)
          const silent =
            report.result_minor === 0 &&
            report.sections.every((section) => section.total_minor === 0)

          return (
            <div className="flex flex-col gap-4">
              <CardRow>
                <NumberCard
                  label="Income"
                  value={sectionOf(anchor, "4")}
                  note="Class 4, in the client's own chart"
                />
                <NumberCard
                  label="Gross profit"
                  value={grossOf(anchor)}
                  note="Income less cost of goods sold"
                />
                <NumberCard
                  label={result.label}
                  value={result.minor}
                  tone={result.loss ? "bad" : "ok"}
                  note="The server's bottom line, not a sum of the rows"
                />
              </CardRow>

              {silent ? (
                <EmptyState>
                  Nothing was posted to the income and expense classes in this
                  window, so there is no profit and loss to draw.
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="24rem">Account</Th>
                      {shown.map((column) => (
                        <Th key={column.key} align="right" width="10rem">
                          {column.label}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.rootClass}:${row.code}`}>
                        <Td
                          className={
                            row.kind === "section"
                              ? "font-medium text-ink"
                              : undefined
                          }
                        >
                          {/* The indent is on a span inside the cell rather
                              than on the cell: `<Td>` owns its padding, and a
                              second opinion about it in every table of this
                              module is how two reports stop lining up. */}
                          <span
                            className="flex items-baseline gap-1.5"
                            style={{ paddingLeft: indentOf(row.level) }}
                          >
                            {/* Printed, not linked. ERPNext's own docs warn
                                that "a drill-down that loses a dimension
                                filter can show a broader ledger scope than the
                                original report" — and a sheet carries one key,
                                so a link from here could take the account or
                                the unit, never both. A code that silently
                                widened the scope is worse than a code you
                                copy. */}
                            <Code>{row.code}</Code>
                            <span className="min-w-0">{row.name}</span>
                          </span>
                        </Td>
                        {shown.map((column) => (
                          <Td key={column.key} align="right">
                            {money(
                              presented(
                                column.reading,
                                row.kind === "section"
                                  ? sectionKey(row.rootClass)
                                  : row.code,
                                row.rootClass
                              )
                            )}
                          </Td>
                        ))}
                      </tr>
                    ))}

                    {/* Gross profit is the one figure on this page nobody on
                        the server computed. It is income less cost of goods
                        sold — two section totals the server DID compute — and
                        it carries a rule rather than an account code so nobody
                        goes looking for it in the chart. */}
                    <tr className="border-t border-hairline-strong">
                      <Td className="font-medium text-ink">Gross profit</Td>
                      {shown.map((column) => (
                        <Td key={column.key} align="right">
                          <span className="font-medium text-ink">
                            {money(grossOf(column.reading))}
                          </span>
                        </Td>
                      ))}
                    </tr>

                    <TotalRow>
                      <Td>{result.label}</Td>
                      {shown.map((column) => {
                        const line =
                          column.reading.report === undefined
                            ? null
                            : periodResult(column.reading.report.result_minor)
                        return (
                          <Td key={column.key} align="right">
                            <span
                              className={
                                line?.loss === true ? "text-bad-fg" : undefined
                              }
                            >
                              {money(line === null ? null : line.minor)}
                            </span>
                          </Td>
                        )
                      })}
                    </TotalRow>
                  </tbody>
                </Grid>
              )}

              {tooWide && (
                <Note>
                  This window covers {columns.length}{" "}
                  {compare === "MONTH" ? "months" : "quarters"}, and every
                  column is a whole request. Comparison stops at {MAX_COLUMNS}{" "}
                  columns, so what is above is the window consolidated — narrow
                  the dates to compare period by period.
                </Note>
              )}

              <Note>
                <b>Income reads positive here and negative on the wire.</b> The
                ledger stores debits positive, so income — and any credit
                balance sitting inside an expense class — arrives negative. The
                sign is flipped for reading, per class, and never on the server:
                the same figure has to come back the same way whichever screen
                asks for it. <b>Gross profit is the only derived number on the
                page</b>: income less cost of goods sold, from two totals the
                server computed. The bottom line is the server's own, taken from{" "}
                <code className="font-mono text-[0.6875rem]">journal_line</code>{" "}
                rather than by adding the sections up, so a disagreement with
                the rows above it is a bug and not a rounding.
              </Note>

              <Note>
                <b>Each column is its own request.</b>{" "}
                <code className="font-mono text-[0.6875rem]">
                  GET /finance/statement
                </code>{" "}
                takes one window and one unit — it has no <i>periodicity</i> and
                no per-unit breakout of its own — so {shown.length} columns is{" "}
                {shown.length} round trips. That is why one axis runs at a time,
                and why the two are offered as a choice rather than as a grid.
                ERPNext cannot offer the choice at all: its period columns and
                its dimension columns share one axis, and its per-unit
                comparison needs each shop set up as a separate company. Here a
                unit is a dimension on the ledger row, so a shop is a filter
                rather than a second set of books.
              </Note>
            </div>
          )
        },
      })}
    </PageContent>
  )
}

/// The axes the columns can carry. One at a time — see the note on the screen.
type CompareAxis = "NONE" | "MONTH" | "QUARTER" | "UNIT"

const COMPARE_OPTIONS: readonly {
  readonly value: CompareAxis
  readonly label: string
}[] = [
  { value: "NONE", label: "No comparison" },
  { value: "MONTH", label: "By month" },
  { value: "QUARTER", label: "By quarter" },
  { value: "UNIT", label: "By unit" },
]

/// Fourteen units fits. A two-year window compared month by month does not.
const MAX_COLUMNS = 24

/// One column of the report: a window, a unit, and the label above it.
interface ReportColumn {
  readonly key: string
  readonly label: string
  readonly from: string
  readonly to: string
  readonly site: string
}

/// One reading of the statement, and every figure a row can ask it for.
///
/// `figures` is `null` while the reading has not arrived, which is what lets a
/// cell render `—`. A reading that HAS arrived and simply does not carry a code
/// answers zero, and that is correct rather than sloppy: the server drops a
/// heading whose whole subtree summed to nothing, so "absent from a loaded
/// statement" means "nothing moved here" — `Rp 0`, not a gap.
interface Reading {
  readonly report: Statement | undefined
  readonly figures: ReadonlyMap<string, number> | null
}

const EMPTY_READING: Reading = { report: undefined, figures: null }

interface ShownColumn {
  readonly key: string
  readonly label: string
  readonly reading: Reading
}

function sectionKey(rootClass: string): string {
  return `section:${rootClass}`
}

function readingOf(report: Statement | undefined): Reading {
  if (report === undefined) return EMPTY_READING
  const figures = new Map<string, number>()
  for (const section of report.sections) {
    figures.set(sectionKey(section.root_class), section.total_minor)
    for (const line of section.lines) {
      figures.set(line.account_code, line.amount_minor)
    }
  }
  return { report, figures }
}

/// One figure, as a statement prints it: flipped for the credit-natured
/// classes, and `null` only when the reading itself has not landed.
function presented(
  reading: Reading,
  key: string,
  rootClass: string
): number | null {
  if (reading.figures === null) return null
  return asPresented(reading.figures.get(key) ?? 0, rootClass)
}

function sectionOf(reading: Reading, rootClass: string): number | null {
  return presented(reading, sectionKey(rootClass), rootClass)
}

/// Income less cost of goods sold, from two totals the server computed.
function grossOf(reading: Reading): number | null {
  const income = sectionOf(reading, "4")
  const cogs = sectionOf(reading, "5")
  if (income === null || cogs === null) return null
  return income - cogs
}

function indentOf(level: number): string {
  return `${level * 1.125}rem`
}

/// One row of the printed tree.
interface TreeRow {
  readonly kind: "section" | "line"
  readonly rootClass: string
  readonly code: string
  readonly name: string
  readonly level: number
}

/// The union of every account the readings on screen mention.
///
/// The union, and not the first reading's: a shop that spent nothing on
/// depreciation in March has no depreciation row in March's statement, and a
/// table built from March alone would cost that column's neighbours their row.
/// Sorted by code, which is the order the client's own chart prints in.
function buildTree(
  sources: readonly (Statement | undefined)[]
): readonly TreeRow[] {
  const sections = new Map<
    string,
    { title: string; lines: Map<string, TreeRow> }
  >()
  for (const report of sources) {
    if (report === undefined) continue
    for (const section of report.sections) {
      const held = sections.get(section.root_class) ?? {
        title: section.title,
        lines: new Map<string, TreeRow>(),
      }
      sections.set(section.root_class, held)
      for (const line of section.lines) {
        if (held.lines.has(line.account_code)) continue
        held.lines.set(line.account_code, {
          kind: "line",
          rootClass: section.root_class,
          code: line.account_code,
          name: line.name,
          // The section is its own row at level zero, so the first rung under
          // one starts at one — which is exactly what `ladderLevel` returns
          // for a three-digit code.
          level: ladderLevel(line.depth),
        })
      }
    }
  }

  const rows: TreeRow[] = []
  for (const rootClass of [...sections.keys()].sort()) {
    const section = sections.get(rootClass)
    if (section === undefined) continue
    rows.push({
      kind: "section",
      rootClass,
      code: rootClass,
      name: section.title,
      level: 0,
    })
    for (const code of [...section.lines.keys()].sort()) {
      const line = section.lines.get(code)
      if (line !== undefined) rows.push(line)
    }
  }
  return rows
}

/// The calendar periods a window covers, clipped to it.
///
/// ERPNext's four periodicities are Monthly, Quarterly, Half-Yearly and Yearly;
/// the two short ones are what a thirteen-shop chain actually reads, so they
/// are the two offered. Each period is clipped to the window rather than
/// spilling past it: 15 Aug – 10 Sep compared by month is *part* of August and
/// *part* of September, and a column that quietly reported the whole of August
/// would not add up to the total beside it.
///
/// Dates are sliced, never parsed. `new Date("2026-08-01")` is UTC, and in
/// Jakarta that names July for the first seven hours of every first-of-month.
function periodColumns(
  from: string,
  to: string,
  axis: "MONTH" | "QUARTER"
): readonly { from: string; to: string; label: string }[] {
  const step = axis === "MONTH" ? 1 : 3
  const startYear = Number(from.slice(0, 4))
  const startMonth = Number(from.slice(5, 7))
  const endYear = Number(to.slice(0, 4))
  const endMonth = Number(to.slice(5, 7))
  if (
    !Number.isFinite(startYear) ||
    !Number.isFinite(endYear) ||
    !Number.isFinite(startMonth) ||
    !Number.isFinite(endMonth)
  ) {
    return []
  }

  // A quarter starts in January, April, July or October whatever month the
  // window opens in. A three-month span beginning on the 15th is not a quarter,
  // and labelling it "Q3" would be a lie about which figures it holds.
  const firstMonth =
    axis === "MONTH" ? startMonth : startMonth - ((startMonth - 1) % 3)

  const periods: { from: string; to: string; label: string }[] = []
  let year = startYear
  let month = firstMonth
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const openIso = iso(year, month, 1)
    // Day zero of the month after the last one in the period is that month's
    // last day — whatever its length, and whether or not February has 29.
    const close = new Date(year, month - 1 + step, 0)
    const closeIso = iso(
      close.getFullYear(),
      close.getMonth() + 1,
      close.getDate()
    )
    periods.push({
      from: openIso > from ? openIso : from,
      to: closeIso < to ? closeIso : to,
      label:
        axis === "MONTH"
          ? // `id-ID`, matching `format.ts::day()` and every other date in the
            // app. Under `en-GB` this column read "Sept 2026" beside a toolbar
            // chip reading "01 Sep 2026" — the same month spelled two ways, a
            // character apart, on one screen.
            new Date(year, month - 1, 1).toLocaleDateString("id-ID", {
              month: "short",
              year: "numeric",
            })
          : `Q${Math.floor((month - 1) / 3) + 1} ${year}`,
    })
    month += step
    while (month > 12) {
      month -= 12
      year += 1
    }
  }
  return periods
}

function iso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}
