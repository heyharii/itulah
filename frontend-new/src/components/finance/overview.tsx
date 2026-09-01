import { Icon, paths } from "@/components/dashboard/parts"
import {
  CASH_META,
  rupiah,
  shortRupiah,
  type CashRow,
} from "@/components/finance/data"
import { shortDate } from "@/lib/day"
import { cn } from "@/lib/utils"

/** The month in one screen: what came in, what has to go out, what is late. */
export function Overview({
  owed,
  overdue,
  revenue,
  payrollDue,
  expensesDue,
  cash,
}: {
  owed: number
  overdue: number
  revenue: number
  payrollDue: number
  expensesDue: number
  cash: CashRow[]
}) {
  const commitments = [
    { label: "Suppliers", value: owed, hue: "var(--violet)" },
    { label: "Payroll", value: payrollDue, hue: "var(--accent-base)" },
    { label: "Expenses", value: expensesDue, hue: "var(--honey)" },
  ]
  const outTotal = commitments.reduce((sum, c) => sum + c.value, 0)

  return (
    <div className="p-3.5">
      <div className="grid gap-2.5 pb-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Revenue", value: rupiah(revenue), tone: "text-grass" },
          { label: "Committed out", value: rupiah(outTotal), tone: "text-ink" },
          {
            label: "Overdue to suppliers",
            value: rupiah(overdue),
            tone: "text-ember",
          },
          {
            label: "Left after commitments",
            value: rupiah(revenue - outTotal),
            tone: revenue - outTotal >= 0 ? "text-ink" : "text-ember",
          },
        ].map((tile) => (
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

      <div className="grid gap-3 lg:grid-cols-2">
        {/* what the month owes, and to whom */}
        <section className="overflow-hidden rounded-panel border border-line-strong">
          <div className="border-b border-line px-3.5 py-2.5">
            <div className="text-[12.5px] font-semibold text-ink">
              Where the money goes
            </div>
            <div className="text-[11px] text-ink-4">
              Everything committed but not yet out
            </div>
          </div>
          <div className="flex h-[34px] w-full">
            {commitments.map((row) =>
              row.value === 0 ? null : (
                <span
                  key={row.label}
                  title={`${row.label} · ${rupiah(row.value)}`}
                  style={{
                    background: `color-mix(in srgb, ${row.hue} 22%, var(--surface))`,
                    color: `color-mix(in srgb, ${row.hue} 70%, var(--ink))`,
                    width: `${(row.value / Math.max(outTotal, 1)) * 100}%`,
                  }}
                  className="flex items-center justify-center overflow-hidden border-r border-surface font-mono text-[10.5px] whitespace-nowrap last:border-r-0"
                >
                  {Math.round((row.value / Math.max(outTotal, 1)) * 100)}%
                </span>
              )
            )}
          </div>
          <ul>
            {commitments.map((row) => (
              <li
                key={row.label}
                className="flex items-center gap-2 border-t border-line px-3.5 py-2.5"
              >
                <span
                  style={{ background: row.hue }}
                  className="size-2 shrink-0 rounded-[3px]"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                  {row.label}
                </span>
                <span className="shrink-0 font-mono text-[12.5px] text-ink tabular-nums">
                  {rupiah(row.value)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="overflow-hidden rounded-panel border border-line-strong">
          <div className="border-b border-line px-3.5 py-2.5">
            <div className="text-[12.5px] font-semibold text-ink">
              Latest live AP payment
            </div>
            <div className="text-[11px] text-ink-4">
              Supplier payments from Internal, newest first
            </div>
          </div>
          <ul className="max-h-[268px] overflow-auto">
            {cash.length === 0 ? (
              <li className="px-3.5 py-8 text-center text-xs text-ink-4">
                No recorded supplier payments in the current response.
              </li>
            ) : (
              cash.slice(0, 12).map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2.5 border-b border-line px-3.5 py-2 last:border-b-0"
                >
                  <span
                    style={{ color: CASH_META.supplier.hue }}
                    className="grid size-[24px] shrink-0 place-items-center rounded-panel bg-inset"
                  >
                    <Icon path={paths.download} size={12} width={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">
                      {row.label}
                    </span>
                    <span className="block truncate text-[10.5px] text-ink-4">
                      Supplier payment · {shortDate(row.at)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-ink-2 tabular-nums">
                    −{shortRupiah(row.amount)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
