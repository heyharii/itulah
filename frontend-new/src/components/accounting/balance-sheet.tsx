/*
 * Balance sheet — assets against liabilities and equity, with the hub's own
 * `balanced` verdict given the top of the screen.
 *
 * `/v1/accounting/reports/balance-sheet?as_of=` returns three labelled sections
 * plus `total_assets`, `total_liabilities_equity` and a `balanced` flag that
 * the hub computes by comparing the two to within 0.01. That verdict outranks
 * every other number here, so it is stated before the sections rather than
 * tucked into a footer, and the residual is shown beside it.
 */

import {
  money,
  moneyOrDash,
  type BalanceSheet as BalanceSheetData,
  type StatementSection,
} from "@/components/accounting/api"
import { headRow, num, rule } from "@/components/accounting/parts"
import { Icon, paths } from "@/components/dashboard/parts"
import { cn } from "@/lib/utils"

function Section({ section }: { section: StatementSection }) {
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--line)]">
      <table className="w-full border-collapse">
        <thead>
          <tr className={headRow}>
            <th className="pl-3 text-left">{section.label}</th>
            <th className="w-[150px] pr-3 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {section.lines.length === 0 ? (
            <tr>
              <td colSpan={2} className={cn("h-row px-3 align-middle", rule)}>
                <span className="text-[11.5px] text-ink-4">
                  No {section.label.toLowerCase()} account carries a balance as at
                  this date.
                </span>
              </td>
            </tr>
          ) : (
            section.lines.map((line) => (
              <tr key={line.accountId || line.code}>
                <td className={cn("h-row pl-3 align-middle", rule)}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={cn(num, "shrink-0 text-ink-4")}>
                      {line.code}
                    </span>
                    <span className="truncate text-xs text-ink-2">
                      {line.name}
                    </span>
                  </span>
                </td>
                <td className={cn("pr-3 pl-3 text-right align-middle", rule)}>
                  <span className={cn(num, "text-ink")}>
                    {moneyOrDash(line.amount)}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="[&>td]:h-9 [&>td]:align-middle">
            <td className="pl-3 text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
              Total
            </td>
            <td className="pr-3 text-right">
              <span className={cn(num, "font-semibold text-ink")}>
                {money(section.total)}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function BalanceSheetView({
  sheet,
  periodLabel,
}: {
  sheet: BalanceSheetData
  periodLabel: string
}) {
  const balances = sheet.balanced

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* The single most important number on the screen. */}
      <div
        className={cn(
          "flex items-center gap-3 px-3.5 py-3",
          rule,
          balances ? "bg-grass/8" : "bg-ember/8"
        )}
      >
        <span
          className={cn(
            "grid size-[34px] shrink-0 place-items-center rounded-panel",
            balances ? "bg-grass/15 text-grass" : "bg-ember/15 text-ember"
          )}
        >
          <Icon
            path={balances ? paths.healthy : paths.alert}
            size={18}
            width={1.9}
          />
        </span>
        <div className="min-w-0">
          <div
            className={cn(
              "text-[13px] font-semibold",
              balances ? "text-grass" : "text-ember"
            )}
          >
            {balances
              ? "The book balances."
              : "The book does not balance."}
          </div>
          <div className="text-[11px] text-ink-3">
            assets − (liabilities + equity) ={" "}
            <span className={cn(num, "text-ink")}>{money(sheet.difference)}</span>
            {" "}· as at <span className={num}>{sheet.asOf}</span> · {periodLabel}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-5 text-right">
          <div>
            <div className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Assets
            </div>
            <div className={cn(num, "text-[13px] text-ink")}>
              {money(sheet.totalAssets)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
              Liabilities + equity
            </div>
            <div className={cn(num, "text-[13px] text-ink")}>
              {money(sheet.totalLiabilitiesEquity)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3 p-3.5">
        <Section section={sheet.assets} />
        <div className="flex min-w-[280px] flex-1 flex-col gap-3">
          <Section section={sheet.liabilities} />
          <Section section={sheet.equity} />
          <div className="flex items-center gap-3 rounded-panel px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
                Not in this report
              </div>
              <div className="mt-0.5 text-[11px] leading-[1.5] text-ink-4">
                The balance sheet route returns assets, liabilities and equity
                only — there is no separate retained-result line. Income and
                expenses live in{" "}
                <span className={num}>/reports/profit-and-loss</span>, and the
                period closing voucher is what folds them into equity. Neither
                is estimated here.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
