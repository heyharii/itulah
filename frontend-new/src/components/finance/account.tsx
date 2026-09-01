import { Icon, paths } from "@/components/dashboard/parts"
import {
  rupiah,
  type Applied,
  type Ledger,
  type Payment,
} from "@/components/finance/data"
import { shortDate, todayKey } from "@/lib/day"
import { cn } from "@/lib/utils"

const rule =
  "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

const STATUS: Record<Applied["status"], { label: string; hue: string }> = {
  paid: { label: "Paid", hue: "var(--grass)" },
  "part-paid": { label: "Part paid", hue: "var(--accent-base)" },
  open: { label: "Open", hue: "var(--ink-3)" },
  overdue: { label: "Overdue", hue: "var(--ember)" },
}

/** One supplier's whole account: what was billed, what was paid, what is left. */
export function SupplierAccount({
  ledger,
  payments,
}: {
  ledger: Ledger
  payments: Payment[]
}) {
  return (
    <div className="px-4 py-4">
      <div className="mb-3 grid grid-cols-4 gap-2">
        {[
          { label: "Billed", value: rupiah(ledger.billed), tone: "text-ink-2" },
          { label: "Paid", value: rupiah(ledger.paid), tone: "text-grass" },
          {
            label: "Outstanding",
            value: rupiah(ledger.outstanding),
            tone: "text-ink",
          },
          { label: "Credit", value: rupiah(ledger.credit), tone: "text-grass" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <div className="pb-1 text-[10.5px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
              {stat.label}
            </div>
            <div
              className={cn(
                "truncate font-mono text-[14px] font-medium tracking-[-0.02em]",
                stat.tone
              )}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        Invoices
      </div>
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <colgroup>
          <col style={{ width: 150 }} />
          <col style={{ width: 104 }} />
          <col style={{ width: 108 }} />
          <col />
          <col style={{ width: 128 }} />
          <col style={{ width: 104 }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
            <th className="text-left">Invoice</th>
            <th className="text-left">Order</th>
            <th className="text-right">Due</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Outstanding</th>
            <th className="text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {ledger.lines.map((line) => {
            const short =
              line.invoice.receivedPct !== undefined &&
              line.invoice.receivedPct < 100
            return (
              <tr key={line.invoice.id} className="hover:[&>td]:bg-hover">
                <td className={cn("h-row px-2.5 align-middle", rule)}>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[11.5px] text-ink">
                      {line.invoice.number}
                    </span>
                    {/* billed for more than actually arrived */}
                    {short && (
                      <span
                        title={`Only ${line.invoice.receivedPct}% of this order was received`}
                        className="shrink-0 text-honey"
                      >
                        <Icon path={paths.alert} size={12} width={2} />
                      </span>
                    )}
                  </span>
                </td>
                <td
                  className={cn(
                    "px-2.5 align-middle font-mono text-[11px] text-ink-4",
                    rule
                  )}
                >
                  {line.invoice.poRef}
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-[11.5px] tabular-nums",
                    line.invoice.dueOn < todayKey() && line.outstanding > 0
                      ? "text-ember"
                      : "text-ink-3",
                    rule
                  )}
                >
                  {shortDate(line.invoice.dueOn)}
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-xs text-ink-3 tabular-nums",
                    rule
                  )}
                >
                  {rupiah(line.invoice.amount)}
                </td>
                <td
                  className={cn(
                    "px-2.5 text-right align-middle font-mono text-[12.5px] font-medium tabular-nums",
                    line.outstanding === 0 ? "text-ink-4" : "text-ink",
                    rule
                  )}
                >
                  {line.outstanding === 0 ? "—" : rupiah(line.outstanding)}
                </td>
                <td className={cn("px-2.5 align-middle", rule)}>
                  <span
                    style={{ color: STATUS[line.status].hue }}
                    className="flex items-center gap-1.5 text-[11px] font-medium"
                  >
                    <span
                      style={{ background: STATUS[line.status].hue }}
                      className="size-1.5 rounded-full"
                    />
                    {STATUS[line.status].label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        Payments
      </div>
      {payments.length === 0 ? (
        <p className="rounded-panel bg-inset py-8 text-center text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
          Nothing has been paid to this supplier yet.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-panel border border-line-strong">
          {[...payments]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((payment) => (
              <li
                key={payment.id}
                className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="grid size-[26px] shrink-0 place-items-center rounded-panel bg-green-tint text-green">
                  <Icon path={paths.check} size={13} width={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-ink">
                    {shortDate(payment.at)} · {payment.method}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-4">
                    {payment.reference}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12.5px] text-ink tabular-nums">
                  {rupiah(payment.amount)}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
