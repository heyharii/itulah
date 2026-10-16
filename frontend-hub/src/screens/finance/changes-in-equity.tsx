import { useSuspenseQueries } from "@tanstack/react-query"
import { Suspense, useDeferredValue, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  balanceStatementQuery,
  resultStatementQuery,
} from "@/lib/queries/finance"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import {
  asPresented,
  dayBefore,
  ladderLevel,
  periodResult,
  yearToDate,
} from "@/screens/finance/chart"
import { useUnitName, type DateWindow } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import {
  PhoneStatement,
  type StatementLine,
} from "@/screens/finance/phone-parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"

import type { Statement } from "@itulah/contract"

/// Statement of Changes in Equity: how each part of equity got from where it
/// stood the day before the window to where it stands at its end.
///
/// There is no endpoint for it and none is needed — it is three readings of
/// the statements the Balance Sheet and the Profit and Loss already use:
///
///  - **Opening**: the balance sheet at the day before `from`, equity class.
///  - **Closing**: the balance sheet at `to`.
///  - **Profit for the period**: the profit and loss over `from`..`to`.
///  - **Other movements**: what is left — closing less opening less profit.
///
/// # The profit that appears twice on the books
///
/// A balance sheet that has not been closed carries the year's profit as a
/// reconciling figure (`result_minor`), the client's `3013001003 Laba (Rugi)
/// bulan berjalan`, and not as a line of equity. So that figure is its own row
/// here, and it is the only row the period's profit is added to. When a Period
/// Closing Voucher moves the profit into Retained Earnings (3003), the move
/// shows as the same amount leaving that row and arriving on 3003 under Other
/// movements — the two cancel in the total, which is how a closing should read.
///
/// The profit and loss leaves a closing voucher's entry out (the balance sheet
/// keeps it), so a window holding the year-end still reports the year's profit.
export function ChangesInEquity() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          crumb="Finance · Financial Reports"
          title="Statement of Changes in Equity"
        >
          Reading equity at both ends of the window…
        </ScreenPending>
      }
    >
      <ChangesInEquityScreen />
    </Suspense>
  )
}

function ChangesInEquityScreen() {
  const phone = useLayout() === "phone"
  const [opened] = useState(() => yearToDate())
  const [from, setFrom] = useState(opened.from)
  const [to, setTo] = useState(opened.to)
  const [unit, setUnit] = useState("")
  const unitName = useUnitName()

  const range: DateWindow = {
    from,
    to,
    setFrom,
    setTo,
    chip: `${day(from)} – ${day(to)}`,
  }
  const valid = from !== "" && to !== "" && from <= to
  const opening = valid ? dayBefore(from) : ""

  // A window that does not make sense asks for nothing new: the reads stay on
  // the window the page opened on, which is already held. The boxes answer at
  // once; the statements trail them, and the figures in hand stay on screen
  // (dimmed) until the next are read.
  const askedFrom = useDeferredValue(valid ? from : opened.from)
  const askedTo = useDeferredValue(valid ? to : opened.to)
  const askedUnit = useDeferredValue(unit) || null
  const [before, after, result] = useSuspenseQueries({
    queries: [
      balanceStatementQuery(dayBefore(askedFrom), askedUnit),
      balanceStatementQuery(askedTo, askedUnit),
      resultStatementQuery(askedFrom, askedTo, askedUnit),
    ],
  })
  const stale =
    askedFrom !== (valid ? from : opened.from) ||
    askedTo !== (valid ? to : opened.to) ||
    askedUnit !== (unit || null)

  const table = valid ? build(before.data, after.data, result.data) : null

  const exportSheet = (): ExportSheet | null => {
    if (table === null) return null
    return {
      filename: `Changes-in-Equity-${monthStamp(to)}`,
      sheet: "Changes in Equity",
      title: "Statement of Changes in Equity",
      subtitle: `${range.chip} · ${unit === "" ? "all units" : unitName(unit)}`,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 48 },
        { header: "Opening", kind: "money" },
        { header: "Profit for the Period", kind: "money" },
        { header: "Other Movements", kind: "money" },
        { header: "Closing", kind: "money" },
      ],
      rows: table.rows.map((row) => [
        row.code,
        row.name,
        row.opening,
        row.profit,
        row.other,
        row.closing,
      ]),
      rowStyles: table.rows.map((row) => ({
        bold: row.heading,
        indent: row.level,
      })),
      totalRow: [
        null,
        "Total equity",
        table.total.opening,
        table.total.profit,
        table.total.other,
        table.total.closing,
      ],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Statement of Changes in Equity"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={
          phone ? undefined : (
            <ExportButton build={exportSheet} disabled={table === null} />
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
        {phone && (
          <ExportButton build={exportSheet} disabled={table === null} />
        )}
      </ReportFilters>

      {!valid ? (
        <EmptyState>
          Choose a From date that is on or before the To date.
        </EmptyState>
      ) : table === null ? null : (
        <div className="list-swap" aria-busy={stale || undefined}>
          <Body table={table} opening={opening} to={to} />
        </div>
      )}
    </PageContent>
  )
}

function Body({
  table,
  opening,
  to,
}: {
  table: Table
  opening: string
  to: string
}) {
  const phone = useLayout() === "phone"
  const silent =
    table.rows.length === 0 &&
    table.total.opening === 0 &&
    table.total.closing === 0 &&
    table.total.profit === 0

  return (
    <>
      {table.disagrees.length > 0 && (
        <Banner tone="warn" className="mb-3">
          The equity lines do not add up to the Balance Sheet at{" "}
          {table.disagrees.map((at) => day(at)).join(" and ")}. Some equity has
          been posted to an account that is not listed here — open the Balance
          Sheet for the same date and compare.
        </Banner>
      )}

      <ReportSummary
        items={[
          { label: `Equity at ${day(opening)}`, value: table.total.opening },
          {
            label: "Profit for the period",
            value: table.total.profit,
            indicator: table.total.profit >= 0 ? "Green" : "Red",
          },
          { label: "Other movements", value: table.total.other },
          { label: `Equity at ${day(to)}`, value: table.total.closing },
        ]}
      />

      {silent ? (
        <EmptyState>
          Nothing has been posted to equity, and no profit earned, up to this
          window.
        </EmptyState>
      ) : phone ? (
        <>
          <PhoneStatement lines={phoneLines(table)} />
        </>
      ) : (
        <>
          <Grid>
            <thead>
              <tr>
                <Th width="26rem">Account</Th>
                <Th align="right" width="11rem">
                  Opening
                </Th>
                <Th align="right" width="11rem">
                  Profit for the period
                </Th>
                <Th align="right" width="11rem">
                  Other movements
                </Th>
                <Th align="right" width="11rem">
                  Closing
                </Th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.code}>
                  <Td
                    className={row.heading ? "font-medium text-ink" : undefined}
                  >
                    <span
                      className="flex items-baseline gap-1.5"
                      style={{ paddingLeft: `${row.level * 1.125}rem` }}
                    >
                      {row.code !== "" && <Code>{row.code}</Code>}
                      <span className="min-w-0">{row.name}</span>
                    </span>
                  </Td>
                  <Td align="right">{money(row.opening)}</Td>
                  <Td align="right">{movement(row.profit)}</Td>
                  <Td align="right">{movement(row.other)}</Td>
                  <Td align="right">{money(row.closing)}</Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total equity</Td>
                <Td align="right">{money(table.total.opening)}</Td>
                <Td align="right">{money(table.total.profit)}</Td>
                <Td align="right">{money(table.total.other)}</Td>
                <Td align="right">{money(table.total.closing)}</Td>
              </TotalRow>
            </tbody>
          </Grid>
        </>
      )}
    </>
  )
}

/// The statement as a phone reads it: each line with where it closed, and the
/// opening and what moved in the sheet a tap opens.
function phoneLines(table: Table): StatementLine[] {
  const facts = (
    row: Pick<Row, "opening" | "profit" | "other" | "closing">
  ) => [
    { label: "Opening", value: money(row.opening) },
    { label: "Profit for the period", value: money(row.profit) },
    { label: "Other movements", value: money(row.other) },
    { label: "Closing", value: money(row.closing) },
  ]
  return [
    ...table.rows.map((row): StatementLine => ({
      key: row.code === "" ? row.name : row.code,
      kind: row.heading ? "section" : "line",
      code: row.code === "" ? undefined : row.code,
      name: row.name,
      level: row.level,
      figure: money(row.closing),
      tone: row.closing < 0 ? "bad" : undefined,
      facts: facts(row),
    })),
    {
      key: "total",
      kind: "total",
      name: "Total equity",
      figure: money(table.total.closing),
      tone: table.total.closing < 0 ? "bad" : undefined,
      facts: facts(table.total),
    },
  ]
}

/// A movement: nothing is a dash, not "Rp 0" down a whole column.
function movement(minor: number): React.ReactNode {
  return minor === 0 ? <span className="text-faint">—</span> : money(minor)
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

interface Row {
  readonly code: string
  readonly name: string
  readonly level: number
  /// The class heading: bold, and its figures are the class's own total.
  readonly heading: boolean
  readonly opening: number
  readonly profit: number
  readonly other: number
  readonly closing: number
}

interface Table {
  readonly rows: readonly Row[]
  readonly total: Omit<Row, "code" | "name" | "level" | "heading">
  /// Dates at which the listed lines do not add up to the sheet's own equity
  /// total. Empty is the only healthy answer.
  readonly disagrees: readonly string[]
}

/// What one balance sheet says about equity, read as a credit-natured class
/// reads: positive when it is capital.
interface Side {
  readonly byCode: ReadonlyMap<string, number>
  /// The sheet's own total for the class.
  readonly equity: number
  /// Postable lines only, so adding them is adding each rupiah once. A
  /// heading is the sum of what hangs under it.
  readonly leaves: number
  /// The profit earned and not yet closed to equity, positive for a profit.
  readonly unclosed: number
}

function sideOf(sheet: Statement): Side {
  const byCode = new Map<string, number>()
  let leaves = 0
  const section = sheet.sections.find((one) => one.root_class === "3")
  for (const line of section?.lines ?? []) {
    const amount = asPresented(line.amount_minor, "3")
    byCode.set(line.account_code, amount)
    if (!line.is_group) leaves += amount
  }
  return {
    byCode,
    equity: asPresented(section?.total_minor ?? 0, "3"),
    leaves,
    unclosed: periodResult(sheet.result_minor).minor,
  }
}

/// The union of the equity accounts either sheet mentions, in code order — an
/// account opened during the window has no line in the opening sheet, and a
/// table built from that sheet alone would cost it its row.
function build(
  before: Statement | undefined,
  after: Statement | undefined,
  result: Statement | undefined
): Table | null {
  if (before === undefined || after === undefined || result === undefined)
    return null
  const start = sideOf(before)
  const end = sideOf(after)

  const profit = periodResult(result.result_minor).minor

  const lines = new Map<
    string,
    { name: string; level: number; heading: boolean }
  >()
  let title = "Equity"
  for (const sheet of [before, after]) {
    const section = sheet.sections.find((one) => one.root_class === "3")
    if (section === undefined) continue
    title = section.title
    for (const line of section.lines) {
      if (lines.has(line.account_code)) continue
      lines.set(line.account_code, {
        name: line.name,
        level: ladderLevel(line.depth),
        heading: line.is_group,
      })
    }
  }

  const rows: Row[] = [
    {
      code: "3",
      name: title,
      level: 0,
      heading: true,
      opening: start.equity,
      profit: 0,
      other: end.equity - start.equity,
      closing: end.equity,
    },
  ]
  for (const code of [...lines.keys()].sort()) {
    const line = lines.get(code)
    if (line === undefined) continue
    const opening = start.byCode.get(code) ?? 0
    const closing = end.byCode.get(code) ?? 0
    if (opening === 0 && closing === 0) continue
    rows.push({
      code,
      name: line.name,
      level: line.level + 1,
      heading: line.heading,
      opening,
      profit: 0,
      other: closing - opening,
      closing,
    })
  }
  // The one row the period's profit belongs to.
  rows.push({
    code: "",
    name: "Profit / Loss not yet closed",
    level: 0,
    heading: false,
    opening: start.unclosed,
    profit,
    other: end.unclosed - start.unclosed - profit,
    closing: end.unclosed,
  })

  const opening = start.equity + start.unclosed
  const closing = end.equity + end.unclosed
  return {
    rows,
    total: {
      opening,
      profit,
      other: closing - opening - profit,
      closing,
    },
    // The listed lines against the sheet's own class total, at both ends.
    disagrees: [
      ...(start.leaves !== start.equity ? [before.to] : []),
      ...(end.leaves !== end.equity ? [after.to] : []),
    ],
  }
}
