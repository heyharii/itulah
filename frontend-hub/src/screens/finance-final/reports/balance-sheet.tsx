import { useSuspenseQueries } from "@tanstack/react-query"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { balanceStatementQuery } from "@/lib/queries/finance"
import {
  Code,
  Grid,
  Td,
  Th,
  TotalRow,
  useAskedWindow,
} from "@/screens/finance-final/parts"
import { asPresented, ladderLevel, periodResult } from "@/screens/finance/chart"
import { useSettledWindow, useUnitName } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import {
  PhoneStatement,
  type StatementLine,
} from "@/screens/finance/phone-parts"
import {
  PeriodicitySelect,
  ReportChart,
  ReportFilters,
  ReportSummary,
  periodsOf,
  type Periodicity,
} from "@/screens/finance/report"
import { ScreenPending } from "@/screens/finance/pending"

import type { Statement } from "@itulah/contract"

/// ERPNext's Balance Sheet, on the client's own chart.
///
/// The page is ERPNext's report (`accounts/report/balance_sheet`): unit in
/// Company's place, From and To, Periodicity (Yearly by default); then its
/// report summary — Total Asset, Total Liability, Total Equity, Provisional
/// Profit / Loss (Credit) — then Assets, Liabilities and Equity charted over
/// the periods; then the table, one column per period, each the position as
/// at that period's last day, closing on ERPNext's two derived rows.
///
/// ERPNext's Accumulated Values is not offered: `GET /finance/statement`
/// answers a balance sheet inception to date, so every column here is already
/// accumulated, and a box that could only be ticked would be a control that
/// does nothing.
///
/// Every class total is the server's. The out-of-balance figure is the
/// server's own check (`out_of_balance_minor`, from `journal_line`), and when
/// it is not zero the page says so before anything else: a sheet that does
/// not balance is a defect in the books, not a rounding.
export function BalanceSheet() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Financial Reports"
          title="Balance Sheet"
        >
          Reading what is held and what is owed…
        </ScreenPending>
      }
    >
      <BalanceSheetScreen />
    </Suspense>
  )
}

function BalanceSheetScreen() {
  const phone = useLayout() === "phone"
  const range = useSettledWindow()
  const [unit, setUnit] = useState("")
  const [periodicity, setPeriodicity] = useState<Periodicity>("Yearly")

  // The boxes answer at once; the columns trail them, and the figures in hand
  // stay on screen (dimmed) until the next are read.
  const asked = useAskedWindow(range)
  const askedUnit = useDeferredValue(unit)
  const askedPeriodicity = useDeferredValue(periodicity)
  const stale =
    asked.stale || askedUnit !== unit || askedPeriodicity !== periodicity

  const periods = useMemo(
    () => periodsOf(asked.from, asked.to, askedPeriodicity, true),
    [asked.from, asked.to, askedPeriodicity]
  )
  const tooWide = periods.length > MAX_COLUMNS
  const columns = tooWide ? periods.slice(-1) : periods

  // No `from`: a balance sheet is cumulative, and the server drops it.
  const sheets = useSuspenseQueries({
    queries: columns.map((period) =>
      balanceStatementQuery(period.to, askedUnit || null)
    ),
    combine: (results) => results.map((result) => result.data),
  })

  const last = sheets[sheets.length - 1]
  const unitName = useUnitName()

  /// The table as drawn: one column per period, the tree, and the two derived
  /// rows the sheet closes on.
  const build = (): ExportSheet | null => {
    if (last === undefined) return null
    const figures = sheets.map(figuresOf)
    const rows = buildTree(sheets)
    const labels = columns.map((period) => period.label)
    return {
      filename: `Balance-Sheet-${monthStamp(asked.to)}`,
      sheet: "Balance Sheet",
      title: "Balance Sheet",
      subtitle: `${range.chip} · ${unit === "" ? "all units" : unitName(unit)} · ${periodicity}`,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 48 },
        ...labels.map((header) => ({ header, kind: "money" as const })),
      ],
      rows: [
        ...rows.map((row) => [
          row.code,
          row.name,
          ...figures.map((figure) =>
            figure.loaded
              ? asPresented(
                  figure.byKey.get(
                    row.kind === "section"
                      ? sectionKey(row.rootClass)
                      : row.code
                  ) ?? 0,
                  row.rootClass
                )
              : null
          ),
        ]),
        [
          null,
          "Provisional Profit / Loss (Credit)",
          ...figures.map((figure) =>
            figure.loaded ? figure.provisional : null
          ),
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
        "Total (Credit)",
        ...figures.map((figure) =>
          figure.loaded
            ? figure.liability + figure.equity + figure.provisional
            : null
        ),
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Balance Sheet"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={
          phone ? undefined : (
            <ExportButton build={build} disabled={last === undefined} />
          )
        }
      />

      <ReportFilters
        note={
          <>
            {range.chip}
            {unit === "" ? (
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
          className="h-control w-44"
          aria-label="Unit"
        />
        <WindowControl range={range} />
        <PeriodicitySelect value={periodicity} onChange={setPeriodicity} />
        {phone && <ExportButton build={build} disabled={last === undefined} />}
      </ReportFilters>

      <div className="list-swap" aria-busy={stale || undefined}>
        {!asked.valid ? (
          <EmptyState>
            Choose a From date that is on or before the To date.
          </EmptyState>
        ) : last === undefined ? (
          <EmptyState>The balance sheet could not be read.</EmptyState>
        ) : (
          <Body
            sheets={sheets}
            columns={columns.map((period) => period.label)}
            tooWide={tooWide ? periods.length : null}
          />
        )}
      </div>
    </PageContent>
  )
}

/// Two years month by month is readable; longer is not.
const MAX_COLUMNS = 24

function Body({
  sheets,
  columns,
  tooWide,
}: {
  sheets: readonly (Statement | undefined)[]
  columns: readonly string[]
  tooWide: number | null
}) {
  const figures = sheets.map(figuresOf)
  const last = figures[figures.length - 1]
  const lastSheet = sheets[sheets.length - 1]
  const rows = buildTree(sheets)
  const phone = useLayout() === "phone"
  const out = lastSheet?.out_of_balance_minor ?? 0
  const silent =
    last.asset === 0 && last.liability === 0 && last.equity === 0 && out === 0

  return (
    <>
      {out !== 0 && (
        <Banner tone="bad">
          <b>This sheet does not balance.</b> Assets are {money(Math.abs(out))}{" "}
          {out > 0 ? "more" : "less"} than liabilities, equity and the
          provisional profit together.
        </Banner>
      )}

      <ReportSummary
        items={[
          { label: "Total Asset", value: last.asset },
          { label: "Total Liability", value: last.liability },
          { label: "Total Equity", value: last.equity },
          {
            label: "Provisional Profit / Loss (Credit)",
            value: last.provisional,
            indicator: last.provisional > 0 ? "Green" : "Red",
          },
        ]}
      />

      {!silent && (
        <ReportChart
          kind={columns.length > 1 ? "line" : "bar"}
          rows={columns.map((label, index) => ({
            label,
            asset: figures[index].asset,
            liability: figures[index].liability,
            equity: figures[index].equity,
          }))}
          series={[
            { key: "asset", label: "Assets" },
            { key: "liability", label: "Liabilities" },
            { key: "equity", label: "Equity" },
          ]}
        />
      )}

      {tooWide !== null && (
        <p className="mb-3 text-[0.9375rem] text-mute">
          {tooWide} columns is more than {MAX_COLUMNS}, so only the last is
          shown. Narrow the dates or choose a longer periodicity.
        </p>
      )}

      {silent ? (
        <EmptyState>
          Nothing has been posted to the asset, liability or equity classes up
          to this date, so there is no position to draw.
        </EmptyState>
      ) : phone ? (
        <PhoneStatement lines={phoneLines(rows, figures, columns)} />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="26rem">Account</Th>
              {columns.map((label) => (
                <Th key={label} align="right" width="11rem">
                  {label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.rootClass}:${row.code}`}
                className={row.kind === "section" ? "bg-soft" : undefined}
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
                    style={{ paddingLeft: `${row.level * 1.125}rem` }}
                  >
                    <Code>{row.code}</Code>
                    <span className="min-w-0">{row.name}</span>
                  </span>
                </Td>
                {figures.map((figure, index) => (
                  <Td
                    key={columns[index]}
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
                      figure.loaded
                        ? asPresented(
                            figure.byKey.get(
                              row.kind === "section"
                                ? sectionKey(row.rootClass)
                                : row.code
                            ) ?? 0,
                            row.rootClass
                          )
                        : null
                    )}
                  </Td>
                ))}
              </tr>
            ))}

            {/* ERPNext's two derived rows: profit earned and not yet closed
                to equity, and what the credit side comes to with it. */}
            <tr className="border-t border-hairline-strong">
              <Td className="font-medium text-ink">
                Provisional Profit / Loss (Credit)
              </Td>
              {figures.map((figure, index) => (
                <Td key={columns[index]} align="right">
                  <span
                    className={
                      figure.provisional < 0
                        ? "font-medium text-bad-fg"
                        : "font-medium text-ink"
                    }
                  >
                    {money(figure.loaded ? figure.provisional : null)}
                  </span>
                </Td>
              ))}
            </tr>
            <TotalRow>
              <Td>Total (Credit)</Td>
              {figures.map((figure, index) => (
                <Td key={columns[index]} align="right">
                  {money(
                    figure.loaded
                      ? figure.liability + figure.equity + figure.provisional
                      : null
                  )}
                </Td>
              ))}
            </TotalRow>
          </tbody>
        </Grid>
      )}
    </>
  )
}

/// The sheet as a phone reads it: the account and the last column's figure, and
/// every other period in the sheet a tap opens.
function phoneLines(
  rows: readonly TreeRow[],
  figures: readonly Figures[],
  columns: readonly string[]
): StatementLine[] {
  const last = figures[figures.length - 1]
  const manyColumns = columns.length > 1
  const facts = (read: (figure: Figures) => number | null) =>
    manyColumns
      ? columns.map((label, index) => ({
          label,
          value: money(read(figures[index])),
        }))
      : undefined
  const lines: StatementLine[] = rows.map((row) => {
    const read = (figure: Figures) =>
      figure.loaded
        ? asPresented(
            figure.byKey.get(
              row.kind === "section" ? sectionKey(row.rootClass) : row.code
            ) ?? 0,
            row.rootClass
          )
        : null
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
  lines.push(
    {
      key: "provisional",
      name: "Provisional Profit / Loss (Credit)",
      figure: money(last.loaded ? last.provisional : null),
      tone: last.provisional < 0 ? "bad" : undefined,
      facts: facts((figure) => (figure.loaded ? figure.provisional : null)),
    },
    {
      key: "total",
      kind: "total",
      name: "Total (Credit)",
      figure: money(
        last.loaded ? last.liability + last.equity + last.provisional : null
      ),
      facts: facts((figure) =>
        figure.loaded
          ? figure.liability + figure.equity + figure.provisional
          : null
      ),
    }
  )
  return lines
}

interface Figures {
  readonly loaded: boolean
  readonly byKey: ReadonlyMap<string, number>
  readonly asset: number
  readonly liability: number
  readonly equity: number
  readonly provisional: number
}

function sectionKey(rootClass: string): string {
  return `section:${rootClass}`
}

/// Every figure one sheet can be asked for, and its four headline numbers,
/// as the sheet prints them: liabilities and equity flipped to read positive.
function figuresOf(sheet: Statement | undefined): Figures {
  const byKey = new Map<string, number>()
  if (sheet === undefined) {
    return {
      loaded: false,
      byKey,
      asset: 0,
      liability: 0,
      equity: 0,
      provisional: 0,
    }
  }
  for (const section of sheet.sections) {
    byKey.set(sectionKey(section.root_class), section.total_minor)
    for (const line of section.lines)
      byKey.set(line.account_code, line.amount_minor)
  }
  const total = (rootClass: string) =>
    asPresented(byKey.get(sectionKey(rootClass)) ?? 0, rootClass)
  return {
    loaded: true,
    byKey,
    asset: total("1"),
    liability: total("2"),
    equity: total("3"),
    provisional: periodResult(sheet.result_minor).minor,
  }
}

interface TreeRow {
  readonly kind: "section" | "line"
  readonly rootClass: string
  readonly code: string
  readonly name: string
  readonly level: number
}

/// The union of every account the sheets on screen mention, in code order —
/// an account opened in June has no row in March's sheet, and a table built
/// from March alone would cost June its row.
function buildTree(
  sheets: readonly (Statement | undefined)[]
): readonly TreeRow[] {
  const sections = new Map<
    string,
    { title: string; lines: Map<string, TreeRow> }
  >()
  for (const sheet of sheets) {
    if (sheet === undefined) continue
    for (const section of sheet.sections) {
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
