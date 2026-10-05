import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { Input } from "@/components/ui/input"
import { financeKeys, profitAndLoss, unitResults } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { FinancialStatementLine, ProfitAndLoss, UnitResult } from "@itulah/contract"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

/// The profit and loss in the client's own layers (owner decision, 25 Sep
/// 2026), read top to bottom exactly as the Central Fashion Store report reads:
///
///   Penjualan Bersih − Beban Pokok Penjualan = Laba Kotor
///   − Beban Usaha = Gross Operating Profit
///   − Beban Usaha Lainnya = Net Operating Profit
///   ± Pendapatan (Biaya) Non Operasi = Laba Sebelum Pajak
///   − Pajak Penghasilan = Laba Bersih Setelah Pajak
///
/// Every subtotal comes from the server. The browser only lays them out, so the
/// screen and the unit results can never disagree about a layer.

/// The numbers every layered report carries — a `ProfitAndLoss` and each
/// `UnitResult` both do.
type Layered = Pick<
  ProfitAndLoss,
  | "revenue_minor"
  | "cost_of_sales_minor"
  | "gross_profit_minor"
  | "operating_expenses_minor"
  | "gross_operating_profit_minor"
  | "other_operating_expenses_minor"
  | "net_operating_profit_minor"
  | "non_operating_minor"
  | "profit_before_tax_minor"
  | "income_tax_minor"
  | "net_profit_minor"
>

type Block = {
  label: string
  /// The `statement_section`s whose accounts are listed under this block.
  sections: readonly string[]
  total: (report: Layered) => number
  subtotal?: { label: string; value: (report: Layered) => number }
}

/// The client's order. Costs read as positive under their own heading and are
/// subtracted in the subtotal; the non-operating block is signed, because the
/// client's block mixes income and cost.
const BLOCKS: readonly Block[] = [
  {
    label: "Penjualan Bersih",
    sections: ["REVENUE"],
    total: (r) => r.revenue_minor,
  },
  {
    label: "Beban Pokok Penjualan",
    sections: ["COST_OF_SALES"],
    total: (r) => r.cost_of_sales_minor,
    subtotal: { label: "Laba Kotor", value: (r) => r.gross_profit_minor },
  },
  {
    label: "Beban Usaha",
    sections: ["OPERATING_EXPENSE"],
    total: (r) => r.operating_expenses_minor,
    subtotal: {
      label: "Gross Operating Profit",
      value: (r) => r.gross_operating_profit_minor,
    },
  },
  {
    label: "Beban Usaha Lainnya",
    sections: ["OTHER_OPERATING_EXPENSE"],
    total: (r) => r.other_operating_expenses_minor,
    subtotal: {
      label: "Net Operating Profit",
      value: (r) => r.net_operating_profit_minor,
    },
  },
  {
    label: "Pendapatan (Biaya) Non Operasi",
    sections: ["OTHER_INCOME", "OTHER_EXPENSE", "OTHER_NET"],
    total: (r) => r.non_operating_minor,
    subtotal: { label: "Laba Sebelum Pajak", value: (r) => r.profit_before_tax_minor },
  },
  {
    label: "Pajak Penghasilan",
    sections: ["INCOME_TAX"],
    total: (r) => r.income_tax_minor,
    subtotal: {
      label: "Laba Bersih Setelah Pajak",
      value: (r) => r.net_profit_minor,
    },
  },
]

/// A line as it reads inside its block. The server signs each line for its
/// own section; inside the signed non-operating block a cost is a minus.
function blockAmount(line: FinancialStatementLine): number {
  return line.section === "OTHER_EXPENSE" ? -line.amount_minor : line.amount_minor
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/// The year so far — the same default `/finance/statement` takes.
function useWindow() {
  const today = new Date()
  const [from, setFrom] = useState(`${today.getFullYear()}-01-01`)
  const [to, setTo] = useState(isoDate(today))
  return { from, to, setFrom, setTo }
}

function WindowPicker({
  from,
  to,
  setFrom,
  setTo,
}: ReturnType<typeof useWindow>) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <Input
        type="date"
        value={from}
        max={to}
        onChange={(event) => event.target.value !== "" && setFrom(event.target.value)}
        className="w-[9.5rem]"
        aria-label="Dari tanggal"
      />
      <span className="text-muted-foreground">s/d</span>
      <Input
        type="date"
        value={to}
        min={from}
        onChange={(event) => event.target.value !== "" && setTo(event.target.value)}
        className="w-[9.5rem]"
        aria-label="Sampai tanggal"
      />
    </div>
  )
}

export function ProfitLossScreen({ title }: { title: string }) {
  const window = useWindow()
  const report = useQuery({
    queryKey: financeKeys.profitAndLoss(window.from, window.to),
    queryFn: ({ signal }) => profitAndLoss({ from: window.from, to: window.to }, signal),
  })

  return (
    <Frame
      title={title}
      subtitle={`${window.from} to ${window.to}`}
      actions={<WindowPicker {...window} />}
    >
      {report.isPending ? (
        <ScreenState>Adding it up…</ScreenState>
      ) : report.error !== null ? (
        <ScreenState tone="problem">
          {report.error instanceof Error ? report.error.message : "could not load the statement"}
        </ScreenState>
      ) : report.data.lines.length === 0 ? (
        <ScreenState>
          Nothing has been posted to the profit and loss in this window yet. It appears
          as soon as the first entry lands.
        </ScreenState>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full max-w-3xl text-[13px]">
            <tbody>
              {BLOCKS.map((block) => (
                <BlockRows key={block.label} block={block} report={report.data} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  )
}

/// One block: its heading and total, the accounts that moved grouped under the
/// client's own parent headings (the 0348 tree), then the subtotal it closes.
function BlockRows({ block, report }: { block: Block; report: ProfitAndLoss }) {
  const lines = report.lines.filter((line) => block.sections.includes(line.section))
  const groups: { code: string; name: string; lines: FinancialStatementLine[] }[] = []
  for (const line of lines) {
    const code = line.group_code ?? ""
    const found = groups.find((group) => group.code === code)
    if (found !== undefined) found.lines.push(line)
    else groups.push({ code, name: line.group_name ?? "", lines: [line] })
  }
  return (
    <>
      <tr className="bg-muted/50">
        <td className="px-3.5 py-1.5 text-[11px] font-medium uppercase">{block.label}</td>
        <td className="px-3.5 py-1.5 text-right font-mono text-[11px] font-medium tabular-nums">
          {money(block.total(report))}
        </td>
      </tr>
      {groups.map((group) => (
        <GroupRows key={group.code} group={group} />
      ))}
      {block.subtotal !== undefined && (
        <SubtotalRow label={block.subtotal.label} value={block.subtotal.value(report)} />
      )}
    </>
  )
}

function GroupRows({
  group,
}: {
  group: { code: string; name: string; lines: FinancialStatementLine[] }
}) {
  const total = group.lines.reduce((sum, line) => sum + blockAmount(line), 0)
  return (
    <>
      {group.code !== "" && (
        <tr className="border-b">
          <td className="py-1 pr-3 pl-[14px]">
            <span className="text-muted-foreground mr-2 font-mono text-[10.5px] tabular-nums">
              {group.code}
            </span>
            <span className="font-medium">{group.name}</span>
          </td>
          <td className="px-3.5 py-1 text-right font-mono font-medium tabular-nums">
            {money(total)}
          </td>
        </tr>
      )}
      {group.lines.map((line) => (
        <tr key={line.account_code} className="hover:bg-muted/30 border-b">
          <td className="py-1 pr-3 pl-[32px]">
            <Link
              to="/finance/ledger"
              search={{ account: line.account_code }}
              className="flex items-baseline gap-2 hover:underline"
            >
              <span className="text-muted-foreground shrink-0 font-mono text-[10.5px] tabular-nums">
                {line.account_code}
              </span>
              <span className="truncate">{line.account_name}</span>
            </Link>
          </td>
          <td className="px-3.5 py-1 text-right font-mono tabular-nums">
            {money(blockAmount(line))}
          </td>
        </tr>
      ))}
    </>
  )
}

function SubtotalRow({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-b-2 border-t">
      <td className="px-3.5 py-1.5 font-semibold">= {label}</td>
      <td
        className={cn(
          "px-3.5 py-1.5 text-right font-mono font-semibold tabular-nums",
          value < 0 && "text-destructive",
        )}
      >
        {money(value)}
      </td>
    </tr>
  )
}

/// The same layers, one column per unit and the consolidated total beside
/// them. The total is the sum of the units — the property that makes unit
/// reporting and consolidated reporting reconcile by construction.
const UNIT_ROWS: readonly { label: string; value: (r: Layered) => number; subtotal?: true }[] =
  [
    { label: "Penjualan Bersih", value: (r) => r.revenue_minor },
    { label: "Beban Pokok Penjualan", value: (r) => r.cost_of_sales_minor },
    { label: "Laba Kotor", value: (r) => r.gross_profit_minor, subtotal: true },
    { label: "Beban Usaha", value: (r) => r.operating_expenses_minor },
    {
      label: "Gross Operating Profit",
      value: (r) => r.gross_operating_profit_minor,
      subtotal: true,
    },
    { label: "Beban Usaha Lainnya", value: (r) => r.other_operating_expenses_minor },
    {
      label: "Net Operating Profit",
      value: (r) => r.net_operating_profit_minor,
      subtotal: true,
    },
    { label: "Pendapatan (Biaya) Non Operasi", value: (r) => r.non_operating_minor },
    { label: "Laba Sebelum Pajak", value: (r) => r.profit_before_tax_minor, subtotal: true },
    { label: "Pajak Penghasilan", value: (r) => r.income_tax_minor },
    {
      label: "Laba Bersih Setelah Pajak",
      value: (r) => r.net_profit_minor,
      subtotal: true,
    },
  ]

export function UnitResultsScreen({ title }: { title: string }) {
  const window = useWindow()
  const report = useQuery({
    queryKey: financeKeys.unitResults(window.from, window.to),
    queryFn: ({ signal }) => unitResults({ from: window.from, to: window.to }, signal),
  })

  return (
    <Frame
      title={title}
      subtitle={`${window.from} to ${window.to}`}
      actions={<WindowPicker {...window} />}
    >
      {report.isPending ? (
        <ScreenState>Adding it up…</ScreenState>
      ) : report.error !== null ? (
        <ScreenState tone="problem">
          {report.error instanceof Error ? report.error.message : "could not load the results"}
        </ScreenState>
      ) : report.data.length === 0 ? (
        <ScreenState>
          Nothing has been posted to the profit and loss in this window yet.
        </ScreenState>
      ) : (
        <UnitTable units={report.data} />
      )}
    </Frame>
  )
}

function UnitTable({ units }: { units: readonly UnitResult[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="text-[12px]">
        <thead>
          <tr className="bg-muted/50">
            <th className="bg-muted/50 sticky left-0 px-3.5 py-1.5 text-left font-medium" />
            {units.map((unit) => (
              <th
                key={unit.unit_id}
                className="px-3 py-1.5 text-right font-mono text-[11px] font-medium"
              >
                {unit.unit_code}
              </th>
            ))}
            <th className="px-3 py-1.5 text-right text-[11px] font-medium">Konsolidasi</th>
          </tr>
        </thead>
        <tbody>
          {UNIT_ROWS.map((row) => {
            const total = units.reduce((sum, unit) => sum + row.value(unit), 0)
            return (
              <tr
                key={row.label}
                className={cn("border-b", row.subtotal === true && "border-b-2 font-semibold")}
              >
                <td className="bg-background sticky left-0 px-3.5 py-1 whitespace-nowrap">
                  {row.subtotal === true ? `= ${row.label}` : row.label}
                </td>
                {units.map((unit) => (
                  <td
                    key={unit.unit_id}
                    className="px-3 py-1 text-right font-mono whitespace-nowrap tabular-nums"
                  >
                    {money(row.value(unit))}
                  </td>
                ))}
                <td className="px-3 py-1 text-right font-mono whitespace-nowrap tabular-nums">
                  {money(total)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Frame({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader title={title} subtitle={subtitle}>
        {actions}
      </ScreenHeader>
      <ScreenBody>{children}</ScreenBody>
    </AppShell>
  )
}
