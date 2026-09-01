import { useState } from "react"

import { LOCATIONS as HR_LOCATIONS } from "@/components/hr/data"
import { useHr } from "@/components/hr/store"
import {
  EXPENSE_META,
  rupiah,
  type Expense,
  type ExpenseCategory,
} from "@/components/finance/data"
import type {
  FinanceCashFlow,
  FinanceReimbursement,
  FinanceCashFlowSection,
  FinancePnL,
} from "@/components/finance/api"
import { shortDate } from "@/lib/day"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const rule =
  "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

const EXPENSES_COLUMNS = "150px minmax(0,1fr) 132px 104px 148px 148px"
const REIMBURSEMENTS_COLUMNS = "180px 142px minmax(0,1fr) 150px 126px 132px"

/** Posted revenue from Internal's accounting P&L; no local price/COGS math. */
export function Revenue({ report }: { report: FinancePnL | undefined }) {
  if (!report) {
    return <UnavailableReport title="Internal revenue report unavailable" />
  }

  const revenue = report.revenue.total
  const expenses = report.expenses.total

  return (
    <div>
      <Tiles
        tiles={[
          { label: "Revenue", value: rupiah(revenue), tone: "text-ink" },
          {
            label: "Posted expenses",
            value: rupiah(expenses),
            tone: "text-ink-3",
          },
          {
            label: "Net income",
            value: rupiah(report.netIncome),
            tone: report.netIncome >= 0 ? "text-grass" : "text-ember",
          },
          {
            label: "Revenue accounts",
            value: String(report.revenue.accounts.length),
            tone: "text-ink",
          },
        ]}
      />

      <p className="px-3.5 pb-3 text-[11px] leading-[1.5] text-ink-4">
        Posted from Internal&apos;s general ledger for {report.periodFrom}{" "}
        through {report.periodTo}. This report does not infer units sold,
        product prices, or cost of sales.
      </p>

      <table className="w-full min-w-[620px] table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col />
          <col style={{ width: 150 }} />
          <col style={{ width: 190 }} />
          <col style={{ width: 180 }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
            <th className="pl-3.5 text-left">Revenue account</th>
            <th className="text-left">Code</th>
            <th className="pr-3.5 text-right">Posted amount</th>
          </tr>
        </thead>
        <tbody>
          {report.revenue.accounts.map((account) => (
            <tr
              key={account.accountId || account.code || account.name}
              className="hover:[&>td]:bg-hover"
            >
              <td
                className={cn(
                  "h-row pr-3 pl-3.5 align-middle text-xs font-medium text-ink",
                  rule
                )}
              >
                {account.name || "Unnamed account"}
              </td>
              <td
                className={cn(
                  "px-3 align-middle font-mono text-xs text-ink-3",
                  rule
                )}
              >
                {account.code || "—"}
              </td>
              <td
                className={cn(
                  "pr-3.5 pl-3 text-right align-middle font-mono text-[12.5px] text-ink tabular-nums",
                  rule
                )}
              >
                {rupiah(account.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── payroll, as finance sees it ─────────────────────────────── */

export function PayrollView() {
  const { payroll, netFor, submissionFor } = useHr()
  const run = payroll.find((p) => p.status !== "released")
  /* payroll follows the People register of locations, not the stock one —
   * they are different lists and mixing them silently zeroes a store */
  const locations = HR_LOCATIONS

  const rows = locations.map((location) => ({
    location,
    net: netFor(location.id),
    submission: submissionFor(run?.id ?? "", location.id),
  }))
  const total = rows.reduce((sum, r) => sum + r.net, 0)
  const ready = rows.filter((r) => r.submission.status === "approved")

  return (
    <div>
      <Tiles
        tiles={[
          { label: "This month", value: rupiah(total), tone: "text-ink" },
          {
            label: "Approved by People",
            value: rupiah(ready.reduce((s, r) => s + r.net, 0)),
            tone: "text-grass",
          },
          { label: "Locations", value: String(rows.length), tone: "text-ink" },
          {
            label: "Still with stores",
            value: String(
              rows.filter((r) => r.submission.status === "draft").length
            ),
            tone: "text-honey",
          },
        ]}
      />

      <p className="px-3.5 pb-3 text-[11px] leading-[1.5] text-ink-4">
        These are the same payslips People prepares — finance pays what People
        has released, and cannot change a component here.
      </p>

      <table className="w-full min-w-[680px] table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col />
          <col style={{ width: 168 }} />
          <col style={{ width: 168 }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-3 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
            <th className="pl-3.5 text-left">Location</th>
            <th className="text-left">People status</th>
            <th className="pr-3.5 text-right">Net pay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ location, net, submission }) => (
            <tr key={location.id} className="hover:[&>td]:bg-hover">
              <td
                className={cn(
                  "h-row pr-3 pl-3.5 align-middle text-xs font-medium text-ink",
                  rule
                )}
              >
                {location.name}
              </td>
              <td className={cn("px-3 align-middle text-[11.5px]", rule)}>
                <span
                  className={cn(
                    submission.status === "approved"
                      ? "text-grass"
                      : submission.status === "submitted"
                        ? "text-honey"
                        : "text-ink-4"
                  )}
                >
                  {submission.status === "approved"
                    ? "Released"
                    : submission.status === "submitted"
                      ? "With Head Office"
                      : submission.status === "returned"
                        ? "Sent back"
                        : "Being prepared"}
                </span>
              </td>
              <td
                className={cn(
                  "pr-3.5 pl-3 text-right align-middle font-mono text-[12.5px] text-ink tabular-nums",
                  rule
                )}
              >
                {rupiah(net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── store expenses ──────────────────────────────────────────── */

export function Expenses({
  expenses,
  onDecide,
}: {
  expenses: Expense[]
  onDecide: (id: string, status: Expense["status"]) => void
}) {
  const [category, setCategory] = useState<ExpenseCategory | "all">("all")

  const rows = expenses
    .filter((e) => category === "all" || e.category === category)
    .sort((a, b) => b.incurredOn.localeCompare(a.incurredOn))

  const pending = expenses.filter((e) => e.status === "pending")
  const month = expenses.filter((e) => e.status !== "declined")

  return (
    <div>
      <Tiles
        tiles={[
          {
            label: "Claimed",
            value: rupiah(month.reduce((s, e) => s + e.amount, 0)),
            tone: "text-ink",
          },
          {
            label: "Waiting on finance",
            value: rupiah(pending.reduce((s, e) => s + e.amount, 0)),
            tone: "text-honey",
          },
          {
            label: "Paid",
            value: rupiah(
              expenses
                .filter((e) => e.status === "paid")
                .reduce((s, e) => s + e.amount, 0)
            ),
            tone: "text-grass",
          },
          { label: "Claims", value: String(expenses.length), tone: "text-ink" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-3">
        {(
          ["all", ...(Object.keys(EXPENSE_META) as ExpenseCategory[])] as const
        ).map((option) => {
          const on = category === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option as ExpenseCategory | "all")}
              className={cn(
                "inline-flex h-[26px] items-center gap-1.5 rounded-control px-2.5 text-[11px] font-medium transition-colors",
                on
                  ? "bg-hover text-ink"
                  : "text-ink-3 hover:bg-hover hover:text-ink"
              )}
            >
              {option !== "all" && (
                <span
                  style={{
                    background: EXPENSE_META[option as ExpenseCategory].hue,
                  }}
                  className="size-1.5 rounded-full"
                />
              )}
              {option === "all"
                ? "All"
                : EXPENSE_META[option as ExpenseCategory].label}
            </button>
          )
        })}
      </div>

      <VirtualRows
        rows={rows}
        rowKey={(expense) => expense.id}
        columns={EXPENSES_COLUMNS}
        rowHeight={34}
        className="min-w-[820px]"
        /* The wash goes on the row, not the cells: cells are `items-center`
         * grid items and only as tall as their own content, so a background on
         * them paints a short band instead of the whole row. `group/row` below
         * stays for the action-button reveal. */
        hoverable
        header={
          <>
            <span className="pl-3.5">Category</span>
            <span>What for</span>
            <span>Location</span>
            <span className="text-right">When</span>
            <span className="text-right">Amount</span>
            <span className="pr-3.5 text-right">Status</span>
          </>
        }
        renderRow={(expense) => {
          const meta = EXPENSE_META[expense.category]
          return (
            /* `contents` keeps every cell a direct grid item of the row
             * while still giving the row a single DOM ancestor the action
             * buttons' `group-hover/row` reveal can key off. */
            <div className="contents group/row">
              <span
                role="gridcell"
                className="pr-3 pl-3.5"
              >
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink">
                  <span
                    style={{ background: meta.hue }}
                    className="size-1.5 rounded-full"
                  />
                  {meta.label}
                </span>
              </span>
              <span
                role="gridcell"
                className="min-w-0 px-3 text-xs text-ink-2"
              >
                <span className="block truncate">{expense.note}</span>
              </span>
              <span
                role="gridcell"
                className="min-w-0 px-3 text-[11.5px] text-ink-3"
              >
                <span className="block truncate">{expense.raisedBy}</span>
              </span>
              <span
                role="gridcell"
                className="px-3 text-right font-mono text-[11px] text-ink-4"
              >
                {shortDate(expense.incurredOn)}
              </span>
              <span
                role="gridcell"
                className="px-3 text-right font-mono text-[12.5px] text-ink tabular-nums"
              >
                {rupiah(expense.amount)}
              </span>
              <span
                role="gridcell"
                className="pr-3.5 pl-3 text-right"
              >
                {expense.status === "pending" ? (
                  <span className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                    <button
                      type="button"
                      onClick={() => onDecide(expense.id, "declined")}
                      className="inline-flex h-[24px] items-center rounded-control px-2 text-[11px] font-medium text-ink-3 transition-colors hover:bg-hover-2 hover:text-ember"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(expense.id, "paid")}
                      className="inline-flex h-[24px] items-center rounded-control bg-ink px-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                    >
                      Pay
                    </button>
                  </span>
                ) : (
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      expense.status === "paid"
                        ? "text-grass"
                        : expense.status === "approved"
                          ? "text-accent-ink"
                          : "text-ember"
                    )}
                  >
                    {expense.status === "paid"
                      ? "Paid"
                      : expense.status === "approved"
                        ? "Approved"
                        : "Declined"}
                  </span>
                )}
              </span>
            </div>
          )
        }}
      />
    </div>
  )
}

/**
 * Live employee reimbursement claims from Internal's HR resource.
 *
 * The old store-expense fixture is intentionally not rendered in Finance:
 * these claims have a different owner, lifecycle, and accounting contract.
 * Approval/payment actions remain absent until the screen can supply the
 * authenticated actor and confirmation flow required by Internal.
 */
export function Reimbursements({ rows }: { rows: FinanceReimbursement[] }) {
  const total = rows.reduce((sum, row) => sum + row.totalAmount, 0)
  const pending = rows
    .filter((row) => row.status === "submitted")
    .reduce((sum, row) => sum + row.totalAmount, 0)
  const paid = rows
    .filter((row) => row.status === "paid")
    .reduce((sum, row) => sum + row.totalAmount, 0)

  return (
    <div>
      <Tiles
        tiles={[
          { label: "Claims", value: String(rows.length), tone: "text-ink" },
          { label: "Claimed", value: rupiah(total), tone: "text-ink" },
          { label: "Submitted", value: rupiah(pending), tone: "text-honey" },
          { label: "Paid", value: rupiah(paid), tone: "text-grass" },
        ]}
      />

      <p className="px-3.5 pb-3 text-[11px] leading-[1.5] text-ink-4">
        Employee reimbursement claims read from Internal&apos;s HR tables. The
        employee ID is shown because this endpoint does not include a name join;
        no local employee name is substituted.
      </p>

      <VirtualRows
        rows={rows}
        rowKey={(row) => row.id}
        columns={REIMBURSEMENTS_COLUMNS}
        rowHeight={34}
        className="min-w-[760px]"
        empty={
          <p className="px-3.5 py-12 text-center text-xs text-ink-4">
            No reimbursement claims in Internal.
          </p>
        }
        header={
          <>
            <span className="pl-3.5">Employee</span>
            <span>Type</span>
            <span>Notes</span>
            <span className="text-right">Created</span>
            <span className="text-right">Amount</span>
            <span className="pr-3.5 text-right">Status</span>
          </>
        }
        renderRow={(row) => (
          <>
            <span role="gridcell" className="pr-3 pl-3.5">
              <span className="block truncate font-mono text-[11.5px] text-ink-2">
                {row.employeeId}
              </span>
              <span className="block truncate font-mono text-[10px] text-ink-4">
                {row.id}
              </span>
            </span>
            <span role="gridcell" className="px-3 text-xs text-ink-2 capitalize">
              {row.reimbursementType}
            </span>
            <span role="gridcell" className="min-w-0 px-3 text-xs text-ink-2">
              <span className="block truncate">{row.notes || "—"}</span>
            </span>
            <span
              role="gridcell"
              className="px-3 text-right font-mono text-[11px] text-ink-4"
            >
              {shortDate(row.createdAt.slice(0, 10))}
            </span>
            <span
              role="gridcell"
              className="px-3 text-right font-mono text-[12.5px] text-ink tabular-nums"
            >
              {rupiah(row.totalAmount)}
            </span>
            <span role="gridcell" className="pr-3.5 pl-3 text-right">
              <span
                className={cn(
                  "text-[11px] font-medium capitalize",
                  row.status === "paid"
                    ? "text-grass"
                    : row.status === "submitted" || row.status === "approved"
                      ? "text-honey"
                      : row.status === "rejected" || row.status === "cancelled"
                        ? "text-ember"
                        : "text-ink-3"
                )}
              >
                {row.status}
              </span>
            </span>
          </>
        )}
      />
    </div>
  )
}

/* ── posted cash-flow statement ─────────────────────────────── */

/**
 * Display Internal's indirect cash-flow statement without recasting account
 * movements as fake transaction kinds. The report is a GL statement, not a
 * bank transaction feed, so sections and signed account lines stay explicit.
 */
export function CashFlow({ report }: { report: FinanceCashFlow | undefined }) {
  if (!report) {
    return (
      <UnavailableReport title="Internal cash-flow statement unavailable" />
    )
  }

  const sections = [report.operating, report.investing, report.financing]
  return (
    <div>
      <Tiles
        tiles={[
          {
            label: "Opening cash",
            value: rupiah(report.openingCash),
            tone: "text-ink-3",
          },
          {
            label: "Closing cash",
            value: rupiah(report.closingCash),
            tone: "text-ink",
          },
          {
            label: "Net change",
            value: rupiah(report.netCashChange),
            tone: report.netCashChange >= 0 ? "text-grass" : "text-ember",
          },
          {
            label: "Sections",
            value: String(sections.length),
            tone: "text-ink",
          },
        ]}
      />

      <p className="px-3.5 pb-3 text-[11px] leading-[1.5] text-ink-4">
        Indirect cash-flow statement from Internal&apos;s posted general ledger
        for {report.dateFrom} through {report.dateTo}. It is not a bank
        statement or transaction-level cash trail.
      </p>

      <div className="space-y-3 px-3.5 pb-4">
        {sections.map((section) => (
          <CashFlowSectionView key={section.label} section={section} />
        ))}
      </div>
    </div>
  )
}

function CashFlowSectionView({ section }: { section: FinanceCashFlowSection }) {
  return (
    <section className="overflow-hidden rounded-panel border border-line-strong">
      <div className="flex items-center gap-3 border-b border-line px-3.5 py-2.5">
        <span className="flex-1 text-[12.5px] font-semibold text-ink">
          {section.label}
        </span>
        <span className="font-mono text-[12px] text-ink tabular-nums">
          {rupiah(section.total)}
        </span>
      </div>
      {section.lines.length === 0 ? (
        <p className="px-3.5 py-3 text-[11.5px] text-ink-4">
          No posted account movements in this section.
        </p>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 180 }} />
          </colgroup>
          <thead>
            <tr className="[&>th]:h-8 [&>th]:border-b [&>th]:border-line [&>th]:px-3 [&>th]:text-[10.5px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-4 [&>th]:uppercase">
              <th className="pl-3.5 text-left">Account</th>
              <th className="text-left">Code</th>
              <th className="pr-3.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {section.lines.map((line) => (
              <tr
                key={line.accountId || line.accountCode || line.accountName}
                className="hover:[&>td]:bg-hover"
              >
                <td
                  className={cn(
                    "h-row pr-3 pl-3.5 align-middle text-xs text-ink-2",
                    rule
                  )}
                >
                  {line.accountName || "Unnamed account"}
                </td>
                <td
                  className={cn(
                    "px-3 align-middle font-mono text-xs text-ink-3",
                    rule
                  )}
                >
                  {line.accountCode || "—"}
                </td>
                <td
                  className={cn(
                    "pr-3.5 pl-3 text-right align-middle font-mono text-[12.5px] tabular-nums",
                    line.amount >= 0 ? "text-grass" : "text-ember",
                    rule
                  )}
                >
                  {line.amount >= 0 ? "+" : "−"}
                  {rupiah(Math.abs(line.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function UnavailableReport({ title }: { title: string }) {
  return (
    <div className="flex min-h-[280px] items-center justify-center px-6 text-center">
      <p className="max-w-[420px] text-xs leading-[1.5] text-ink-4">
        {title}. No local preview is shown because it would not represent
        Internal&apos;s posted financial state.
      </p>
    </div>
  )
}

/* ── shared bits ─────────────────────────────────────────────── */

export function Tiles({
  tiles,
}: {
  tiles: { label: string; value: string; tone: string }[]
}) {
  return (
    <div className="grid gap-2.5 p-3.5 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-panel bg-inset px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--line)]"
        >
          <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
            {tile.label}
          </div>
          <div
            className={cn(
              "truncate font-mono text-[17px] font-medium tracking-[-0.02em]",
              tile.tone
            )}
          >
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  )
}
