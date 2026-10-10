import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/states"
import { monthStamp, type ExportSheet } from "@/lib/export-xlsx"
import { money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import { financeKeys, statement } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { useUnitName, useWindow } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import {
  PhoneStatement,
  type StatementLine,
} from "@/screens/finance/phone-parts"
import { ReportFilters, ReportSummary } from "@/screens/finance/report"
import type { Statement } from "@itulah/contract"

/// Where cash came from and where it went over a window — ERPNext's Cash Flow
/// report (`accounts/report/cash_flow`): the filters, the summary (Opening,
/// Net Change in Cash, Closing), then Operating, Investing and Financing with
/// each account's cash effect under them.
///
/// The server's own statement (`GET /finance/statement?kind=CASH_FLOW`):
/// every entry that touched a cash or bank account, with its other side filed
/// by activity. Amounts are the cash effect — positive is cash in — so the
/// table reads as inflows and outflows. An account the chart does not yet
/// file under an activity is shown under "Not classified" rather than guessed
/// into one.
export function CashFlow() {
  const phone = useLayout() === "phone"
  const range = useWindow()
  const [unit, setUnit] = useState("")

  const flow = useQuery({
    queryKey: financeKeys.statement(
      "CASH_FLOW",
      range.from,
      range.to,
      unit || null
    ),
    queryFn: ({ signal }) =>
      statement(
        "CASH_FLOW",
        { from: range.from, to: range.to, unit: unit || undefined },
        signal
      ),
  })

  const unitName = useUnitName()

  /// The table as drawn: each activity, its accounts, its net, then the net
  /// change — with the opening and closing cash the summary shows above it.
  const build = (): ExportSheet | null => {
    const data = flow.data
    if (data === undefined) return null
    const sections = data.sections.filter((section) => section.lines.length > 0)
    const net = data.sections.reduce(
      (sum, section) => sum + section.total_minor,
      0
    )
    const rows: (string | number | null)[][] = [
      [null, "Opening cash", data.opening_cash_minor],
    ]
    const rowStyles: { bold?: boolean; indent?: number }[] = [{ bold: true }]
    for (const section of sections) {
      rows.push([null, section.title, null])
      rowStyles.push({ bold: true })
      for (const line of section.lines) {
        rows.push([line.account_code, line.name, line.amount_minor])
        rowStyles.push({ indent: 1 })
      }
      rows.push([
        null,
        `Net cash from ${section.title.toLowerCase()}`,
        section.total_minor,
      ])
      rowStyles.push({ bold: true, indent: 1 })
    }
    rows.push([null, "Net change in cash", net])
    rowStyles.push({ bold: true })
    return {
      filename: `Cash-Flow-${monthStamp(range.to)}`,
      sheet: "Cash Flow",
      title: "Cash Flow",
      subtitle: `${range.chip} · ${unit === "" ? "all units" : unitName(unit)}`,
      columns: [
        { header: "Code", kind: "text", width: 12 },
        { header: "Account", kind: "text", width: 48 },
        { header: "Cash in / (out)", kind: "money" },
      ],
      rows,
      rowStyles,
      totalRow: [null, "Closing cash", data.closing_cash_minor],
    }
  }

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Financial Reports"
        title="Cash Flow"
        // On a phone Export is a row of the Filters sheet, not a button at the
        // top of the page.
        actions={
          phone ? undefined : (
            <ExportButton build={build} disabled={flow.data === undefined} />
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
          <ExportButton build={build} disabled={flow.data === undefined} />
        )}
      </ReportFilters>

      {queryState(flow, {
        loading: "Reading the cash movements…",
        render: (data) => <Body flow={data} />,
      })}
    </PageContent>
  )
}

function Body({ flow }: { flow: Statement }) {
  const phone = useLayout() === "phone"
  const sections = flow.sections.filter((section) => section.lines.length > 0)
  const net = flow.sections.reduce(
    (sum, section) => sum + section.total_minor,
    0
  )
  return (
    <>
      <ReportSummary
        items={[
          { label: "Opening cash", value: flow.opening_cash_minor },
          {
            label: "Net change in cash",
            value: net,
            indicator: net >= 0 ? "Green" : "Red",
          },
          { label: "Closing cash", value: flow.closing_cash_minor },
        ]}
      />
      {sections.length === 0 ? (
        <Card>
          <EmptyState>No cash moved in this window.</EmptyState>
        </Card>
      ) : phone ? (
        <PhoneStatement lines={phoneLines(sections, net)} />
      ) : (
        <Card className="overflow-hidden">
          <Grid>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th align="right" width="11rem">
                  Cash in / (out)
                </Th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <SectionRows key={section.root_class} section={section} />
              ))}
              <TotalRow>
                <Td>Net change in cash</Td>
                <Td align="right">{signed(net)}</Td>
              </TotalRow>
            </tbody>
          </Grid>
        </Card>
      )}
    </>
  )
}

/// The statement as a phone reads it: each activity a band with its net, its
/// accounts under it, and the net change in cash to close.
function phoneLines(
  sections: readonly Statement["sections"][number][],
  net: number
): StatementLine[] {
  const lines: StatementLine[] = []
  for (const section of sections) {
    lines.push({
      key: section.root_class,
      kind: "section",
      name: section.title,
      figure: signed(section.total_minor),
      tone: section.total_minor < 0 ? "bad" : undefined,
    })
    for (const line of section.lines) {
      lines.push({
        key: `${section.root_class}:${line.account_code}`,
        code: line.account_code,
        name: line.name,
        level: 1,
        figure: signed(line.amount_minor),
        tone: line.amount_minor < 0 ? "bad" : undefined,
      })
    }
  }
  lines.push({
    key: "net",
    kind: "total",
    name: "Net change in cash",
    figure: signed(net),
    tone: net < 0 ? "bad" : undefined,
  })
  return lines
}

function SectionRows({ section }: { section: Statement["sections"][number] }) {
  return (
    <>
      <tr className="bg-soft">
        <Td className="font-semibold text-ink">{section.title}</Td>
        <Td />
      </tr>
      {section.lines.map((line) => (
        <tr key={line.account_code}>
          <Td>
            <span className="pl-4">
              <span className="mr-2 font-mono text-[0.875rem] text-mute">
                {line.account_code}
              </span>
              <span className="text-body">{line.name}</span>
            </span>
          </Td>
          <Td
            align="right"
            className={line.amount_minor < 0 ? "text-bad-fg" : undefined}
          >
            {signed(line.amount_minor)}
          </Td>
        </tr>
      ))}
      <tr className="border-t border-hairline-strong">
        <Td className="font-medium text-ink">
          <span className="pl-4">
            Net cash from {section.title.toLowerCase()}
          </span>
        </Td>
        <Td align="right" className="font-medium text-ink">
          {signed(section.total_minor)}
        </Td>
      </tr>
    </>
  )
}

/// Cash out in brackets, as the client's own statements print it.
function signed(amount: number): string {
  return amount < 0 ? `(${money(-amount)})` : money(amount)
}
