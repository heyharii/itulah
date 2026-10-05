import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { fileSafe, type ExportSheet } from "@/lib/export-xlsx"
import { count, day } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  expensesByMonth,
  financeReportKeys,
} from "@/lib/queries/finance-reports"
import { cn } from "@/lib/utils"
import { Code, Grid, Td, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import { useUnitName, type DateWindow } from "@/screens/finance/hooks"
import { UnitSelect, WindowControl } from "@/screens/finance/parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import type {
  ExpensesByMonth as Report,
  ExpenseMonthLine,
} from "@itulah/contract"

/// What each kind of cost came to, month by month: the expense accounts down
/// the side under the headings of the chart they sit in (BIAYA SEWA, BIAYA
/// GAJI…), one column per month and a Total — the page the owner reads to see
/// whether rent or salaries moved, which neither statement shows side by side.
///
/// `GET /api/v1/finance/reports/expenses-by-month`. The server reads the
/// journal, leaves out the year-end closing voucher, and answers with one
/// figure per month per account; the group rows and the month totals are sums
/// of those lines made here, once, and the Total is the server's own — so
/// the screen and the Excel file cannot disagree, and a column that does not
/// add up would show in the corner cell.
///
/// The server lays at most 24 months side by side and refuses more; the screen
/// says so before asking rather than after.
///
/// Figures are whole rupiah, grouped digits, no sign (the note says rupiah) —
/// twelve months of `Rp 12.345.678` would not fit a laptop. A refund larger
/// than the month's spending shows in brackets rather than being hidden.
///
/// Each account's amounts could link to its General Ledger for that month, but
/// the ledger takes only the account in its address, not a window, so the link
/// would open the wrong dates; there is none.
export function ExpensesByMonth() {
  const range = useYearToDate()
  const [unit, setUnit] = useState("")
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const unitName = useUnitName()

  const span = monthsIn(range.from, range.to)
  const refusal =
    range.from === "" || range.to === ""
      ? "Choose the first and last day."
      : range.from > range.to
        ? "The window starts after it ends."
        : span > MAX_MONTHS
          ? `${span} months is more than one report can lay side by side; choose ${MAX_MONTHS} or fewer.`
          : null

  const report = useQuery({
    queryKey: financeReportKeys.expensesByMonth(
      range.from,
      range.to,
      unit || null
    ),
    queryFn: ({ signal }) =>
      expensesByMonth(
        { from: range.from, to: range.to, unit: unit || undefined },
        signal
      ),
    enabled: refusal === null,
  })

  const note = [
    range.chip,
    unit === "" ? "All units" : unitName(unit),
    "Rupiah",
  ].join(" · ")

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const build = (): ExportSheet | null => {
    const data = report.data
    if (data === undefined) return null
    const groups = groupLines(data)
    return {
      filename: `Expenses-by-Month-${unit === "" ? "All-Units" : fileSafe(unitName(unit))}-${range.from}-${range.to}`,
      sheet: "Expenses by Month",
      title: "Expenses by Month",
      subtitle: note,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 44 },
        ...data.months.map((month) => ({
          header: monthName(month),
          kind: "money" as const,
        })),
        { header: "Total", kind: "money" },
      ],
      rows: groups.flatMap((group) => [
        [group.code, group.name, ...group.byMonth, group.total],
        ...group.lines.map((line) => [
          line.account_code,
          line.account_name,
          ...line.by_month_minor,
          line.total_minor,
        ]),
      ]),
      rowStyles: groups.flatMap((group) => [
        { bold: true },
        ...group.lines.map(() => ({ indent: 1 })),
      ]),
      totalRow: ["", "Total expenses", ...columnTotals(data), data.total_minor],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Expenses by Month"
        actions={
          <ExportButton
            build={build}
            disabled={
              report.data === undefined || report.data.lines.length === 0
            }
          />
        }
      />

      <ReportFilters note={note}>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="All units"
          className="h-control w-52"
          aria-label="Unit"
        />
        <WindowControl range={range} />
      </ReportFilters>

      {refusal !== null ? (
        <Card>
          <EmptyState>{refusal}</EmptyState>
        </Card>
      ) : (
        queryState(report, {
          loading: "Adding up the months…",
          render: (data) => (
            <Body report={data} collapsed={collapsed} onToggle={toggle} />
          ),
        })
      )}
    </PageContent>
  )
}

/// The most months the server lays side by side.
const MAX_MONTHS = 24

function Body({
  report,
  collapsed,
  onToggle,
}: {
  report: Report
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const groups = useMemo(() => groupLines(report), [report])
  const totals = columnTotals(report)

  if (report.lines.length === 0) {
    return (
      <Card>
        <EmptyState>No expenses were booked in this window.</EmptyState>
      </Card>
    )
  }

  const months = report.months.length
  const highest = totals.reduce(
    (best, value, index) => (value > (totals[best] ?? 0) ? index : best),
    0
  )
  const highestMonth = report.months[highest]

  return (
    <>
      <ReportSummary
        items={[
          { label: "Total expenses", value: report.total_minor },
          {
            label: "Average per month",
            value:
              months === 0 ? null : Math.round(report.total_minor / months),
          },
          {
            label: "Highest month",
            value: totals[highest] ?? null,
            display:
              highestMonth === undefined
                ? "—"
                : `${monthName(highestMonth)} · ${figure(totals[highest] ?? 0)}`,
          },
        ]}
      />

      <Grid>
        <thead>
          <tr>
            <th className={cn(HEAD, STICKY, "min-w-[18rem] text-left")}>
              Account
            </th>
            {report.months.map((month) => (
              <th key={month} className={cn(HEAD, "text-right")}>
                {monthName(month)}
              </th>
            ))}
            <th className={cn(HEAD, "text-right")}>Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const closed = collapsed.has(group.key)
            const Chevron = closed ? ChevronRight : ChevronDown
            return (
              <GroupBlock
                key={group.key}
                group={group}
                closed={closed}
                chevron={<Chevron className="size-4 shrink-0 text-mute" />}
                onToggle={() => onToggle(group.key)}
              />
            )
          })}
          <TotalRow>
            <Td className={cn(STICKY, "bg-soft")}>Total expenses</Td>
            {totals.map((value, index) => (
              <Td key={report.months[index]} align="right">
                {figure(value)}
              </Td>
            ))}
            <Td align="right">{figure(report.total_minor)}</Td>
          </TotalRow>
        </tbody>
      </Grid>
    </>
  )
}

function GroupBlock({
  group,
  closed,
  chevron,
  onToggle,
}: {
  group: Group
  closed: boolean
  chevron: React.ReactNode
  onToggle: () => void
}) {
  return (
    <>
      <tr className="group border-t border-hairline-2 first:border-t-0">
        <Td className={cn(STICKY, "bg-canvas group-hover:bg-soft")}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!closed}
            className="flex w-full items-center gap-1.5 text-left font-medium text-ink"
          >
            {chevron}
            <span className="truncate">{group.name}</span>
            <span className="font-normal text-mute">{group.lines.length}</span>
          </button>
        </Td>
        {group.byMonth.map((value, index) => (
          <Td key={index} align="right" className="font-medium text-ink">
            {cell(value)}
          </Td>
        ))}
        <Td align="right" className="font-medium text-ink">
          {figure(group.total)}
        </Td>
      </tr>
      {!closed &&
        group.lines.map((line) => (
          <tr key={line.account_code} className="group">
            <Td className={cn(STICKY, "bg-canvas pl-9 group-hover:bg-soft")}>
              <span className="flex items-baseline gap-2">
                <Code>{line.account_code}</Code>
                <span className="truncate text-body" title={line.account_name}>
                  {line.account_name}
                </span>
              </span>
            </Td>
            {line.by_month_minor.map((value, index) => (
              <Td key={index} align="right">
                {cell(value)}
              </Td>
            ))}
            <Td align="right" className="text-ink">
              {figure(line.total_minor)}
            </Td>
          </tr>
        ))}
    </>
  )
}

/// The account column stays put while the months scroll under it — only where
/// the table is a table: on a phone it stacks (`useStackLabels`).
const STICKY = "min-[48rem]:sticky left-0 z-[1]"

/// `Th`'s look, which takes no class: the account heading has to be sticky.
const HEAD =
  "h-10 border-b border-hairline bg-soft px-3.5 py-0 text-eyebrow font-medium whitespace-nowrap text-body normal-case"

interface Group {
  readonly key: string
  /// The heading's account code, or empty for accounts with no heading.
  readonly code: string
  readonly name: string
  readonly lines: ExpenseMonthLine[]
  readonly byMonth: number[]
  readonly total: number
}

/// Lines under their chart heading, headings in the order the server first
/// names them (its own order is by parent code, then account code).
function groupLines(report: Report): Group[] {
  const buckets = new Map<string, ExpenseMonthLine[]>()
  for (const line of report.lines) {
    const key = line.group_code ?? ""
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [line])
    else bucket.push(line)
  }
  return [...buckets.entries()].map(([key, lines]) => {
    const byMonth = report.months.map((_, index) =>
      lines.reduce((sum, line) => sum + (line.by_month_minor[index] ?? 0), 0)
    )
    return {
      key,
      code: key,
      name: lines[0]?.group_name ?? lines[0]?.group_code ?? "Ungrouped",
      lines,
      byMonth,
      total: lines.reduce((sum, line) => sum + line.total_minor, 0),
    }
  })
}

/// The month totals across every account.
function columnTotals(report: Report): number[] {
  return report.months.map((_, index) =>
    report.lines.reduce(
      (sum, line) => sum + (line.by_month_minor[index] ?? 0),
      0
    )
  )
}

/// A whole-rupiah figure: grouped digits, no sign, a refund in brackets.
function figure(minor: number): string {
  return minor < 0 ? `(${count(-minor)})` : count(minor)
}

/// A month cell: a quiet dash where nothing moved.
function cell(minor: number): React.ReactNode {
  return minor === 0 ? <span className="text-mute">–</span> : figure(minor)
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/// `Jan 26` from the first-of-month day the server names. Sliced, never
/// parsed: `new Date("2026-08-01")` is UTC and names July in Jakarta for the
/// first seven hours of the day.
function monthName(iso: string): string {
  const month = Number(iso.slice(5, 7))
  return `${MONTH_NAMES[month - 1] ?? iso.slice(5, 7)} ${iso.slice(2, 4)}`
}

/// How many calendar months a window touches.
function monthsIn(from: string, to: string): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1
  )
}

/// A window defaulting to the year so far, and following the boxes once
/// somebody edits one.
function useYearToDate(): DateWindow {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)
  const today = todayIso()
  const value = draft ?? { from: `${today.slice(0, 4)}-01-01`, to: today }
  return {
    from: value.from,
    to: value.to,
    setFrom: (from) => setDraft({ ...value, from }),
    setTo: (to) => setDraft({ ...value, to }),
    chip: `${day(value.from)} – ${day(value.to)}`,
  }
}
