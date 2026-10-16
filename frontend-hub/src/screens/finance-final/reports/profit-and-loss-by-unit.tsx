import { useSuspenseQueries } from "@tanstack/react-query"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { useLayout } from "@/lib/layout"
import { resultStatementQuery } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import {
  buildTree,
  defaultMonth,
  figuresOf,
  indentOf,
  lastDayOf,
  percent,
  presentedFigure,
  sectionKey,
  share,
  signed,
  spanLabel,
} from "@/screens/finance-final/reports/two-year"
import { YearMonthControl } from "@/screens/finance-final/reports/two-year-controls"
import { periodResult } from "@/screens/finance/chart"
import { useUnitName } from "@/screens/finance/hooks"
import { UnitSelect } from "@/screens/finance/parts"
import {
  PhoneStatement,
  type StatementLine,
} from "@/screens/finance/phone-parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import { ScreenPending } from "@/screens/finance/pending"
import type { Statement } from "@itulah/contract"

/// 7Soft's "Laba Rugi GL per Cabang 2 Tahunan": the profit and loss of one
/// unit — or, with no unit chosen, of all of them, which 7Soft calls
/// Kompilasi Unit — for a year beside the year before, each with the share of
/// net sales every line is.
///
/// # What is read
///
/// `GET /finance/statement?kind=PROFIT_LOSS`, twice: January to the chosen
/// month of the year, and January to the same month of the year before. Both
/// windows are the same length, so a year in progress is compared like for
/// like. The lines of the two answers are joined by account code; an account
/// that moved in only one year still has its row, with a dash in the other.
///
/// # How the statement is laid out
///
/// The client's classes in code order, as 7Soft prints them: sales (class 4,
/// which is 7Soft's TOTAL PENJUALAN BERSIH and the base of every %), cost of
/// goods sold (5), gross profit drawn under it, operating expenses (6), gross
/// operating profit, other operating expenses (7), non-operating (8), and the
/// result at the bottom. The derived lines carry 7Soft's own names; the class
/// headings and accounts carry the chart's.
///
/// Income arrives negative — the ledger stores debits positive — and is
/// flipped for reading by `asPresented()`, shared with every other statement
/// so no two can disagree about a sign.
export function ProfitAndLossByUnit() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Financial Reports"
          title="Profit and Loss by Unit"
        >
          Reading this year…
        </ScreenPending>
      }
    >
      <ProfitAndLossByUnitScreen />
    </Suspense>
  )
}

function ProfitAndLossByUnitScreen() {
  const phone = useLayout() === "phone"
  const [unit, setUnit] = useState("")
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [monthDraft, setMonthDraft] = useState<number | null>(null)
  const unitName = useUnitName()
  const month = monthDraft ?? defaultMonth(year)

  // The boxes answer at once; the two statements trail them, and the figures
  // in hand stay on screen (dimmed) until the next are read.
  const askedUnit = useDeferredValue(unit)
  const askedYear = useDeferredValue(year)
  const askedMonth = useDeferredValue(month)
  const stale = askedUnit !== unit || askedYear !== year || askedMonth !== month

  const windows = {
    now: {
      from: `${askedYear}-01-01`,
      to: lastDayOf(askedYear, askedMonth),
    },
    before: {
      from: `${askedYear - 1}-01-01`,
      to: lastDayOf(askedYear - 1, askedMonth),
    },
  }

  const [now, before] = useSuspenseQueries({
    queries: [
      resultStatementQuery(windows.now.from, windows.now.to, askedUnit || null),
      resultStatementQuery(
        windows.before.from,
        windows.before.to,
        askedUnit || null
      ),
    ],
  })

  const rows = useMemo(
    () => linesOf(now.data, before.data),
    [now.data, before.data]
  )

  const scope = askedUnit === "" ? "All units (compiled)" : unitName(askedUnit)
  const note = `${spanLabel(askedYear, askedMonth)} against ${spanLabel(askedYear - 1, askedMonth)} · ${scope}`

  const build = (): ExportSheet | null => {
    const body = rows.filter((row) => row.key !== "net")
    const net = rows.find((row) => row.key === "net")
    return {
      filename: `Profit-and-Loss-by-Unit-${askedUnit === "" ? "All-Units" : fileSafe(unitName(askedUnit))}-${askedYear}-${String(askedMonth).padStart(2, "0")}`,
      sheet: "Profit and Loss by Unit",
      title: "Profit and Loss by Unit",
      subtitle: note,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 48 },
        { header: String(askedYear), kind: "money" },
        { header: "%", kind: "percent" },
        { header: String(askedYear - 1), kind: "money" },
        { header: "%", kind: "percent" },
      ],
      rows: body.map(exportRow),
      rowStyles: body.map((row) => ({
        bold: row.kind !== "line",
        indent: row.level,
      })),
      totalRow: net === undefined ? undefined : exportRow(net),
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Profit and Loss by Unit"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={phone ? undefined : <ExportButton build={build} />}
      />

      <ReportFilters note={note}>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="All units (compiled)"
          className="h-control w-52"
          aria-label="Unit"
        />
        <YearMonthControl
          year={year}
          month={month}
          onYear={(next) => {
            setYear(next)
            setMonthDraft(null)
          }}
          onMonth={setMonthDraft}
        />
        {phone && <ExportButton build={build} />}
      </ReportFilters>

      <div className="list-swap" aria-busy={stale || undefined}>
        {queryState(now, {
          render: (report) =>
            queryState(before, {
              render: (prior) => (
                <Body
                  report={report}
                  prior={prior}
                  year={askedYear}
                  rows={rows}
                />
              ),
            }),
        })}
      </div>
    </PageContent>
  )
}

/// One printed line: a class heading, an account, or a line the statement
/// derives (gross profit, the result).
interface Line {
  readonly key: string
  readonly kind: "section" | "line" | "derived"
  readonly code: string
  readonly name: string
  readonly level: number
  readonly now: number | null
  readonly before: number | null
  /// Net sales of each year — what this line is a percentage of.
  readonly baseNow: number | null
  readonly baseBefore: number | null
}

function exportRow(row: Line): (string | number | null)[] {
  return [
    row.code,
    row.name,
    row.now,
    share(row.now, row.baseNow),
    row.before,
    share(row.before, row.baseBefore),
  ]
}

/// 7Soft's lines it derives, named in English.
const GROSS_PROFIT = "GROSS PROFIT (LOSS)"
const OPERATING_PROFIT = "GROSS OPERATING PROFIT"
const NET_RESULT = "NET PROFIT (LOSS)"

function linesOf(report: Statement, prior: Statement): readonly Line[] {
  const now = figuresOf(report)
  const before = figuresOf(prior)
  const tree = buildTree([report, prior])

  const total = (figures: typeof now, rootClass: string) =>
    presentedFigure(figures, sectionKey(rootClass), rootClass) ?? 0
  const baseNow = total(now, "4")
  const baseBefore = total(before, "4")
  const bases = { baseNow, baseBefore }

  const derived = (key: string, name: string, a: number, b: number): Line => ({
    key,
    kind: "derived",
    code: "",
    name,
    level: 0,
    now: a,
    before: b,
    ...bases,
  })

  const gross = (figures: typeof now) =>
    total(figures, "4") - total(figures, "5")
  const operating = (figures: typeof now) =>
    gross(figures) - total(figures, "6")

  const out: Line[] = []
  const present = new Set(tree.map((row) => row.rootClass))
  for (const rootClass of ["4", "5", "6", "7", "8"]) {
    for (const row of tree.filter((one) => one.rootClass === rootClass)) {
      const key = row.kind === "section" ? sectionKey(row.rootClass) : row.code
      out.push({
        key: `${row.rootClass}:${row.code}`,
        kind: row.kind,
        code: row.code,
        name: row.name,
        level: row.level,
        now: presentedFigure(now, key, row.rootClass),
        before: presentedFigure(before, key, row.rootClass),
        ...bases,
      })
    }
    if (rootClass === "5" && (present.has("4") || present.has("5"))) {
      out.push(derived("gross", GROSS_PROFIT, gross(now), gross(before)))
    }
    if (
      rootClass === "6" &&
      (present.has("4") || present.has("5") || present.has("6"))
    ) {
      out.push(
        derived(
          "operating",
          OPERATING_PROFIT,
          operating(now),
          operating(before)
        )
      )
    }
  }
  if (out.length > 0) {
    out.push(
      derived(
        "net",
        NET_RESULT,
        periodResult(report.result_minor).minor,
        periodResult(prior.result_minor).minor
      )
    )
  }
  return out
}

function Body({
  report,
  prior,
  year,
  rows,
}: {
  report: Statement
  prior: Statement
  year: number
  rows: readonly Line[]
}) {
  const phone = useLayout() === "phone"
  const result = periodResult(report.result_minor)
  const net = rows.find((row) => row.key === "net")
  const sales = rows.find((row) => row.kind === "section" && row.code === "4")
  const gross = rows.find((row) => row.key === "gross")
  const silent =
    rows.length === 0 ||
    (report.result_minor === 0 &&
      prior.result_minor === 0 &&
      report.sections.every((section) => section.total_minor === 0) &&
      prior.sections.every((section) => section.total_minor === 0))

  if (silent) {
    return (
      <Card>
        <EmptyState>
          Nothing was posted to the income and expense classes in either year up
          to this month, so there is no profit and loss to compare.
        </EmptyState>
      </Card>
    )
  }

  return (
    <>
      <ReportSummary
        items={[
          { label: `Net sales ${year}`, value: sales?.now },
          { label: `Gross profit ${year}`, value: gross?.now },
          {
            label: `Net profit ${year}`,
            value: net?.now,
            indicator: result.minor > 0 ? "Green" : "Red",
          },
        ]}
      />
      {phone ? (
        <PhoneStatement lines={phoneLines(rows, year)} />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="26rem">Account</Th>
              <Th align="right" width="10.5rem">
                {year}
              </Th>
              <Th align="right" width="5.5rem">
                %
              </Th>
              <Th align="right" width="10.5rem">
                {year - 1}
              </Th>
              <Th align="right" width="5.5rem">
                %
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.key !== "net")
              .map((row) => {
                const bold = row.kind !== "line"
                const figure = bold ? "font-medium text-ink" : undefined
                return (
                  <tr
                    key={row.key}
                    className={
                      row.kind === "derived"
                        ? "border-t border-hairline-strong"
                        : row.kind === "section"
                          ? "bg-soft"
                          : undefined
                    }
                  >
                    <Td className={figure}>
                      <span
                        className="flex items-baseline gap-1.5"
                        style={{ paddingLeft: indentOf(row.level) }}
                      >
                        {row.code !== "" && <Code>{row.code}</Code>}
                        <span className="min-w-0">{row.name}</span>
                      </span>
                    </Td>
                    <Td align="right" className={figure}>
                      {signed(row.now)}
                    </Td>
                    <Td align="right" className="text-mute">
                      {percent(share(row.now, row.baseNow))}
                    </Td>
                    <Td align="right" className={figure}>
                      {signed(row.before)}
                    </Td>
                    <Td align="right" className="text-mute">
                      {percent(share(row.before, row.baseBefore))}
                    </Td>
                  </tr>
                )
              })}
            {net !== undefined && (
              <TotalRow>
                <Td>{net.name}</Td>
                <Td align="right">
                  <span
                    className={(net.now ?? 0) < 0 ? "text-bad-fg" : undefined}
                  >
                    {signed(net.now)}
                  </span>
                </Td>
                <Td align="right">{percent(share(net.now, net.baseNow))}</Td>
                <Td align="right">
                  <span
                    className={
                      (net.before ?? 0) < 0 ? "text-bad-fg" : undefined
                    }
                  >
                    {signed(net.before)}
                  </span>
                </Td>
                <Td align="right">
                  {percent(share(net.before, net.baseBefore))}
                </Td>
              </TotalRow>
            )}
          </tbody>
        </Grid>
      )}
    </>
  )
}

/// The statement as a phone reads it: this year's figure on each line, and the
/// share of net sales, last year and its share in the sheet a tap opens.
function phoneLines(rows: readonly Line[], year: number): StatementLine[] {
  return rows.map((row) => ({
    key: row.key,
    kind:
      row.key === "net"
        ? "total"
        : row.kind === "section" || row.kind === "derived"
          ? "section"
          : "line",
    code: row.code === "" ? undefined : row.code,
    name: row.name,
    level: row.level,
    figure: signed(row.now),
    tone: (row.now ?? 0) < 0 ? "bad" : undefined,
    facts: [
      { label: String(year), value: signed(row.now) },
      {
        label: `Share of sales ${year}`,
        value: percent(share(row.now, row.baseNow)),
      },
      { label: String(year - 1), value: signed(row.before) },
      {
        label: `Share of sales ${year - 1}`,
        value: percent(share(row.before, row.baseBefore)),
      },
    ],
  }))
}
