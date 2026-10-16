import { useSuspenseQueries } from "@tanstack/react-query"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { balanceStatementQuery } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import {
  buildTree,
  defaultMonth,
  figuresOf,
  indentOf,
  lastDayOf,
  presentedFigure,
  sectionKey,
  signed,
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

/// 7Soft's "Laporan Neraca Central 2 Tahunan": the balance sheet at the end
/// of a month, beside the same month-end a year earlier, and what changed
/// between them.
///
/// # What is read
///
/// `GET /finance/statement?kind=BALANCE_SHEET`, twice, each "as at" the last
/// day of the chosen month — this year's and last year's. It is the query the
/// Balance Sheet screen makes, on the same key, so a position already read
/// there is not read again. A balance sheet is cumulative, so no start date
/// is sent. Lines are joined by account code; an account open at only one of
/// the two dates still has its row.
///
/// The change is this year-end less last year-end, on the figures as the
/// sheet prints them (liabilities and equity flipped to read positive), so a
/// growing liability shows a positive change like a growing asset does.
export function BalanceSheetTwoYears() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Financial Reports"
          title="Balance Sheet 2 Years"
        >
          Reading this year-end…
        </ScreenPending>
      }
    >
      <BalanceSheetTwoYearsScreen />
    </Suspense>
  )
}

function BalanceSheetTwoYearsScreen() {
  const phone = useLayout() === "phone"
  const [unit, setUnit] = useState("")
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [monthDraft, setMonthDraft] = useState<number | null>(null)
  const unitName = useUnitName()
  const month = monthDraft ?? defaultMonth(year)

  // The boxes answer at once; the two sheets trail them, and the figures in
  // hand stay on screen (dimmed) until the next are read.
  const askedUnit = useDeferredValue(unit)
  const askedYear = useDeferredValue(year)
  const askedMonth = useDeferredValue(month)
  const stale = askedUnit !== unit || askedYear !== year || askedMonth !== month

  const dates = {
    now: lastDayOf(askedYear, askedMonth),
    before: lastDayOf(askedYear - 1, askedMonth),
  }

  const [now, before] = useSuspenseQueries({
    queries: [
      balanceStatementQuery(dates.now, askedUnit || null),
      balanceStatementQuery(dates.before, askedUnit || null),
    ],
  })

  const rows = useMemo(
    () => linesOf(now.data, before.data),
    [now.data, before.data]
  )

  const scope = askedUnit === "" ? "All units" : unitName(askedUnit)
  const note = `As at ${day(dates.now)} against ${day(dates.before)} · ${scope}`

  const build = (): ExportSheet | null => {
    const body = rows.filter((row) => row.kind !== "total")
    const total = rows.find((row) => row.kind === "total")
    const exportRow = (row: Line) => [
      row.code,
      row.name,
      row.now,
      row.before,
      change(row),
    ]
    return {
      filename: `Balance-Sheet-2-Years-${askedUnit === "" ? "All-Units" : fileSafe(unitName(askedUnit))}-${askedYear}-${String(askedMonth).padStart(2, "0")}`,
      sheet: "Balance Sheet 2 Years",
      title: "Balance Sheet 2 Years",
      subtitle: note,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 48 },
        { header: day(dates.now), kind: "money" },
        { header: day(dates.before), kind: "money" },
        { header: "Change", kind: "money" },
      ],
      rows: body.map(exportRow),
      rowStyles: body.map((row) => ({
        bold: row.kind !== "line",
        indent: row.level,
      })),
      totalRow: total === undefined ? undefined : exportRow(total),
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Balance Sheet 2 Years"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={phone ? undefined : <ExportButton build={build} />}
      />

      <ReportFilters note={note}>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
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
          render: (sheet) =>
            queryState(before, {
              render: (prior) => (
                <Body
                  sheet={sheet}
                  prior={prior}
                  rows={rows}
                  thisEnd={dates.now}
                  lastEnd={dates.before}
                />
              ),
            }),
        })}
      </div>
    </PageContent>
  )
}

interface Line {
  readonly key: string
  readonly kind: "section" | "line" | "derived" | "total"
  readonly code: string
  readonly name: string
  readonly level: number
  readonly now: number | null
  readonly before: number | null
}

function change(row: Line): number | null {
  return row.now === null || row.before === null ? null : row.now - row.before
}

function linesOf(sheet: Statement, prior: Statement): readonly Line[] {
  const now = figuresOf(sheet)
  const before = figuresOf(prior)
  const tree = buildTree([sheet, prior], ["1", "2", "3"])
  const total = (figures: typeof now, rootClass: string) =>
    presentedFigure(figures, sectionKey(rootClass), rootClass) ?? 0

  const out: Line[] = tree.map((row) => {
    const key = row.kind === "section" ? sectionKey(row.rootClass) : row.code
    return {
      key: `${row.rootClass}:${row.code}`,
      kind: row.kind,
      code: row.code,
      name: row.name,
      level: row.level,
      now: presentedFigure(now, key, row.rootClass),
      before: presentedFigure(before, key, row.rootClass),
    }
  })
  if (out.length === 0) return out

  // ERPNext's two derived rows, as the Balance Sheet screen closes on them.
  const provisionalNow = periodResult(sheet.result_minor).minor
  const provisionalBefore = periodResult(prior.result_minor).minor
  out.push({
    key: "provisional",
    kind: "derived",
    code: "",
    name: "Provisional Profit / Loss (Credit)",
    level: 0,
    now: provisionalNow,
    before: provisionalBefore,
  })
  out.push({
    key: "total",
    kind: "total",
    code: "",
    name: "Total (Credit)",
    level: 0,
    now: total(now, "2") + total(now, "3") + provisionalNow,
    before: total(before, "2") + total(before, "3") + provisionalBefore,
  })
  return out
}

function Body({
  sheet,
  prior,
  rows,
  thisEnd,
  lastEnd,
}: {
  sheet: Statement
  prior: Statement
  rows: readonly Line[]
  thisEnd: string
  lastEnd: string
}) {
  const phone = useLayout() === "phone"
  const out = sheet.out_of_balance_minor ?? 0
  const outBefore = prior.out_of_balance_minor ?? 0
  const at = (code: string) =>
    rows.find((row) => row.kind === "section" && row.code === code)?.now ?? null
  const provisional = rows.find((row) => row.key === "provisional")

  if (rows.length === 0) {
    return (
      <EmptyState>
        Nothing has been posted to the asset, liability or equity classes up to
        either date, so there is no position to compare.
      </EmptyState>
    )
  }

  return (
    <>
      {(out !== 0 || outBefore !== 0) && (
        <Banner tone="bad">
          <b>A sheet here does not balance.</b>{" "}
          {out !== 0 && (
            <>
              At {day(thisEnd)} assets are {money(Math.abs(out))}{" "}
              {out > 0 ? "more" : "less"} than liabilities, equity and the
              provisional profit together.{" "}
            </>
          )}
          {outBefore !== 0 && (
            <>
              At {day(lastEnd)} the difference is {money(Math.abs(outBefore))}.
            </>
          )}
        </Banner>
      )}

      <ReportSummary
        items={[
          { label: "Total Asset", value: at("1") },
          { label: "Total Liability", value: at("2") },
          { label: "Total Equity", value: at("3") },
          {
            label: "Provisional Profit / Loss (Credit)",
            value: provisional?.now,
            indicator: (provisional?.now ?? 0) > 0 ? "Green" : "Red",
          },
        ]}
      />

      {phone ? (
        <PhoneStatement lines={phoneLines(rows, thisEnd, lastEnd)} />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th width="26rem">Account</Th>
              <Th align="right" width="11.5rem">
                {day(thisEnd)}
              </Th>
              <Th align="right" width="11.5rem">
                {day(lastEnd)}
              </Th>
              <Th align="right" width="11.5rem">
                Change
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.kind !== "total")
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
                    <Td align="right" className={figure}>
                      {signed(row.before)}
                    </Td>
                    <Td align="right" className={figure}>
                      {signed(change(row))}
                    </Td>
                  </tr>
                )
              })}
            {rows
              .filter((row) => row.kind === "total")
              .map((row) => (
                <TotalRow key={row.key}>
                  <Td>{row.name}</Td>
                  <Td align="right">{signed(row.now)}</Td>
                  <Td align="right">{signed(row.before)}</Td>
                  <Td align="right">{signed(change(row))}</Td>
                </TotalRow>
              ))}
          </tbody>
        </Grid>
      )}
    </>
  )
}

/// The sheet as a phone reads it: this year-end on each line, last year-end and
/// the change in the sheet a tap opens.
function phoneLines(
  rows: readonly Line[],
  thisEnd: string,
  lastEnd: string
): StatementLine[] {
  return rows.map((row) => ({
    key: row.key,
    kind:
      row.kind === "total"
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
      { label: day(thisEnd), value: signed(row.now) },
      { label: day(lastEnd), value: signed(row.before) },
      { label: "Change", value: signed(change(row)) },
    ],
  }))
}
