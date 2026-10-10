import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { financeKeys, statement } from "@/lib/queries/finance"
import { unitLabel } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { asPresented, ladderLevel, periodResult } from "@/screens/finance/chart"
import { useLocations, useUnitName, useWindow } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import {
  PhoneStatement,
  type StatementLine,
} from "@/screens/finance/phone-parts"
import {
  FilterCheck,
  PeriodicitySelect,
  ReportChart,
  ReportFilters,
  ReportSummary,
  periodsOf,
  type Periodicity,
  type ReportChartRow,
} from "@/screens/finance/report"

import type { Statement } from "@itulah/contract"

/// ERPNext's Profit and Loss Statement, on the client's own layers.
///
/// The page is ERPNext's report (`accounts/report/profit_and_loss_statement`):
/// its filters — unit in Company's place, From and To, Periodicity (Yearly by
/// default), Accumulated Values (off by default) — then its report summary,
/// Total Income, Total Expense and Net Profit ("… This Year" when the report
/// is one Yearly column), then its chart, Income, Expense and Net Profit/Loss
/// per period, bars or lines when accumulated, then the table: one column per
/// period and a Total, as ERPNext prints it.
///
/// The statement inside is the client's, as the owner set it on 25 Sep: the
/// classes of their chart in code order, with gross profit drawn between
/// cost of goods sold and the expenses below it. Where the client's book and
/// ERPNext differ, the client's book wins — ERPNext decides the page, not the
/// accounts on it.
///
/// Compare units is ours and comes last. ERPNext can only compare shops by
/// making each its own Company; here a unit is a dimension on the ledger row,
/// so it is one more column — one more request to `GET /finance/statement`,
/// which takes one window and one unit, as every column here is.
///
/// Income arrives negative — the ledger stores debits positive — and is
/// flipped for reading by `asPresented()` and `periodResult()`, shared with
/// every other statement so no two can disagree about a sign.
export function ProfitAndLoss() {
  const phone = useLayout() === "phone"
  const range = useWindow()
  const [unit, setUnit] = useState("")
  const [periodicity, setPeriodicity] = useState<Periodicity>("Yearly")
  const [accumulated, setAccumulated] = useState(false)
  const [compareUnits, setCompareUnits] = useState(false)

  // The units the books are kept for: head office and each store.
  const locations = useLocations()
  const unitName = useUnitName()

  // Comparing units and filtering to one unit is a filter fighting the thing
  // it filters, so the unit select goes dead while units are compared.
  const effectiveUnit = compareUnits ? "" : unit

  const periods = useMemo(
    () => periodsOf(range.from, range.to, periodicity, accumulated),
    [range.from, range.to, periodicity, accumulated]
  )

  const columns = useMemo<readonly ReportColumn[]>(() => {
    if (compareUnits) {
      return (locations.data?.locations ?? []).map((location) => ({
        key: `unit:${location.unit_id}`,
        label: unitLabel(location),
        from: range.from,
        to: range.to,
        unit: location.unit_id,
      }))
    }
    // One period is the window itself: the Total column says it.
    if (periods.length <= 1) return []
    return periods.map((period) => ({
      key: `period:${period.key}`,
      label: period.label,
      from: period.from,
      to: period.to,
      unit: effectiveUnit,
    }))
  }, [
    compareUnits,
    locations.data,
    periods,
    range.from,
    range.to,
    effectiveUnit,
  ])

  // Past this many the table stops being readable and the fan-out stops being
  // polite. Refused outright rather than silently truncated.
  const tooWide = columns.length > MAX_COLUMNS

  /// The whole window at the chosen unit: the summary, the Total column, and
  /// the check on the columns — the server computes it from `journal_line`
  /// rather than by adding them up.
  const total = useQuery({
    queryKey: financeKeys.statement(
      "PROFIT_LOSS",
      range.from,
      range.to,
      effectiveUnit || null
    ),
    queryFn: ({ signal }) =>
      statement(
        "PROFIT_LOSS",
        { from: range.from, to: range.to, unit: effectiveUnit || undefined },
        signal
      ),
  })

  const cells = useQueries({
    queries: (tooWide ? [] : columns).map((column) => ({
      queryKey: financeKeys.statement(
        "PROFIT_LOSS",
        column.from,
        column.to,
        column.unit || null
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        statement(
          "PROFIT_LOSS",
          { from: column.from, to: column.to, unit: column.unit || undefined },
          signal
        ),
    })),
    combine: (results) => ({
      readings: results.map((result) => readingOf(result.data)),
    }),
  })

  /// The columns and rows the table draws for a given answer — shared by the
  /// screen and by Export, so the file is the table.
  const layout = (report: Statement) => {
    const anchor = readingOf(report)
    const periodColumns = !tooWide && columns.length > 0
    const shown: readonly ShownColumn[] = periodColumns
      ? [
          ...columns.map((column, index) => ({
            key: column.key,
            label: column.label,
            reading: cells.readings[index] ?? EMPTY_READING,
          })),
          // Accumulated, the last period IS the window, and ERPNext
          // prints no Total beside it.
          ...(accumulated && !compareUnits
            ? []
            : [
                {
                  key: "total",
                  label: compareUnits ? "All units" : "Total",
                  reading: anchor,
                },
              ]),
        ]
      : [
          {
            key: "total",
            label: periods[0]?.label ?? "Amount",
            reading: anchor,
          },
        ]
    const rows = buildTree([
      report,
      ...cells.readings.map((reading) => reading.report),
    ])
    return { anchor, periodColumns, shown, rows }
  }

  const build = (): ExportSheet | null => {
    if (total.data === undefined) return null
    const { shown, rows } = layout(total.data)
    const at = (column: ShownColumn, row: TreeRow) =>
      presented(
        column.reading,
        row.kind === "section" ? sectionKey(row.rootClass) : row.code,
        row.rootClass
      )
    const result = periodResult(total.data.result_minor)
    return {
      filename: `Profit-and-Loss-${monthStamp(range.to)}`,
      sheet: "Profit and Loss",
      title: "Profit and Loss Statement",
      subtitle: `${range.chip} · ${
        compareUnits
          ? "all units, side by side"
          : unit === ""
            ? "all units"
            : unitName(unit)
      } · ${periodicity}${accumulated ? " · accumulated" : ""}`,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 48 },
        ...shown.map((column) => ({
          header: column.label,
          kind: "money" as const,
        })),
      ],
      rows: [
        ...rows.map((row) => [
          row.code,
          row.name,
          ...shown.map((column) => at(column, row)),
        ]),
        [
          null,
          "Gross profit",
          ...shown.map((column) => grossOf(column.reading)),
        ],
      ],
      rowStyles: [
        ...rows.map((row) => ({
          bold: row.kind === "section",
          indent: row.level,
        })),
        { bold: true },
      ],
      totalRow: [
        null,
        result.label,
        ...shown.map((column) =>
          column.reading.report === undefined
            ? null
            : periodResult(column.reading.report.result_minor).minor
        ),
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Profit and Loss Statement"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={
          phone ? undefined : (
            <ExportButton build={build} disabled={total.data === undefined} />
          )
        }
      />

      <ReportFilters
        note={
          <>
            {range.chip}
            {compareUnits ? (
              " · all units, side by side"
            ) : unit === "" ? (
              " · all units"
            ) : (
              <>
                {" · "}
                <UnitName id={unit} />
              </>
            )}
          </>
        }
      >
        <UnitSelect
          value={unit}
          onChange={setUnit}
          disabled={compareUnits}
          className="h-control w-44"
          aria-label="Unit"
        />
        <WindowControl range={range} />
        <PeriodicitySelect value={periodicity} onChange={setPeriodicity} />
        <FilterCheck
          label="Accumulated Values"
          checked={accumulated}
          onChange={setAccumulated}
        />
        <FilterCheck
          label="Compare units"
          checked={compareUnits}
          onChange={setCompareUnits}
        />
        {phone && (
          <ExportButton build={build} disabled={total.data === undefined} />
        )}
      </ReportFilters>

      {queryState(total, {
        loading: "Reading what was earned and what it cost…",
        render: (report) => {
          const { anchor, periodColumns, shown, rows } = layout(report)
          const result = periodResult(report.result_minor)
          const income = sectionOf(anchor, "4")
          const silent =
            report.result_minor === 0 &&
            report.sections.every((section) => section.total_minor === 0)

          const chartColumns = periodColumns
            ? shown.filter((column) => column.key !== "total")
            : shown
          const chartRows: ReportChartRow[] = chartColumns.map((column) => {
            const earned = sectionOf(column.reading, "4") ?? 0
            const net =
              column.reading.report === undefined
                ? 0
                : periodResult(column.reading.report.result_minor).minor
            return {
              label: column.label,
              income: earned,
              expense: earned - net,
              net,
            }
          })

          return (
            <>
              <ReportSummary
                items={[
                  {
                    label: "Total Income",
                    value: income,
                  },
                  {
                    label: "Total Expense",
                    value: income === null ? null : income - result.minor,
                  },
                  {
                    label: "Net Profit",
                    value: result.minor,
                    indicator: result.minor > 0 ? "Green" : "Red",
                  },
                ]}
              />

              {!silent && (
                <ReportChart
                  kind={accumulated ? "line" : "bar"}
                  rows={chartRows}
                  series={[
                    { key: "income", label: "Income" },
                    { key: "expense", label: "Expense" },
                    { key: "net", label: "Net Profit/Loss" },
                  ]}
                />
              )}

              {tooWide && (
                <p className="mb-3 text-[0.875rem] text-mute">
                  {columns.length} columns is more than {MAX_COLUMNS}, so the
                  window is shown as one. Narrow the dates or choose a longer
                  periodicity.
                </p>
              )}

              {silent ? (
                <EmptyState>
                  Nothing was posted to the income and expense classes in this
                  window, so there is no profit and loss to draw.
                </EmptyState>
              ) : phone ? (
                <PhoneStatement lines={phoneLines(rows, shown, result)} />
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
                      <tr
                        key={`${row.rootClass}:${row.code}`}
                        // The class opens on a tinted band, its groups are a
                        // weight heavier than their accounts: the tree reads
                        // from the left edge without counting indents.
                        className={
                          row.kind === "section" ? "bg-soft" : undefined
                        }
                      >
                        <Td
                          className={
                            row.kind === "section"
                              ? "font-semibold text-ink"
                              : row.level === 1
                                ? "font-medium text-ink"
                                : undefined
                          }
                        >
                          <span
                            className="flex items-baseline gap-1.5"
                            style={{ paddingLeft: indentOf(row.level) }}
                          >
                            <Code>{row.code}</Code>
                            <span className="min-w-0">{row.name}</span>
                          </span>
                        </Td>
                        {shown.map((column) => (
                          <Td
                            key={column.key}
                            align="right"
                            className={
                              row.kind === "section"
                                ? "font-semibold text-ink"
                                : row.level === 1
                                  ? "font-medium"
                                  : undefined
                            }
                          >
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

                    {/* The client's layer: income less cost of goods sold,
                        from two totals the server computed. */}
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
            </>
          )
        },
      })}
    </PageContent>
  )
}

/// Fourteen units fits. Two years month by month does not.
const MAX_COLUMNS = 24

/// The statement as a phone reads it: each account with the last column's
/// figure (the window's Total, when there are several periods), the other
/// columns in the sheet a tap opens, then gross profit and the result.
function phoneLines(
  rows: readonly TreeRow[],
  shown: readonly ShownColumn[],
  result: ReturnType<typeof periodResult>
): StatementLine[] {
  const last = shown[shown.length - 1]
  const facts = (read: (column: ShownColumn) => number | null) =>
    shown.length > 1
      ? shown.map((column) => ({
          label: column.label,
          value: money(read(column)),
        }))
      : undefined
  const lines: StatementLine[] = rows.map((row) => {
    const read = (column: ShownColumn) =>
      presented(
        column.reading,
        row.kind === "section" ? sectionKey(row.rootClass) : row.code,
        row.rootClass
      )
    const value = read(last)
    return {
      key: `${row.rootClass}:${row.code}`,
      kind: row.kind,
      code: row.code,
      name: row.name,
      level: row.level,
      figure: money(value),
      tone: value !== null && value < 0 ? "bad" : undefined,
      facts: facts(read),
    }
  })
  const gross = grossOf(last.reading)
  lines.push(
    {
      key: "gross",
      name: "Gross profit",
      figure: money(gross),
      tone: gross !== null && gross < 0 ? "bad" : undefined,
      facts: facts((column) => grossOf(column.reading)),
    },
    {
      key: "result",
      kind: "total",
      name: result.label,
      figure: money(result.minor),
      tone: result.loss ? "bad" : undefined,
      facts: facts((column) =>
        column.reading.report === undefined
          ? null
          : periodResult(column.reading.report.result_minor).minor
      ),
    }
  )
  return lines
}

/// One column of the report: a window, a unit, and the label above it.
interface ReportColumn {
  readonly key: string
  readonly label: string
  readonly from: string
  readonly to: string
  readonly unit: string
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
          // The section is its own row at level zero, so its first child is
          // indented once below it.
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
