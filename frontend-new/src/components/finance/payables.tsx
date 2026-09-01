import type { Supplier } from "@/components/sourcing/catalogue"
import {
  ageOfDebt,
  rupiah,
  shortRupiah,
  type Ledger,
} from "@/components/finance/data"
import { shortDate, todayKey } from "@/lib/day"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"

const PAYABLES_COLUMNS = "minmax(0,1fr) 96px 148px 148px 132px 96px"

export interface Account {
  supplier: Supplier
  ledger: Ledger
}

/** Who is owed what, how old it is, and one button to pay any amount of it. */
export function Payables({
  accounts,
  owed,
  overdue,
  credit,
  dueSoon,
  onOpen,
  onPay,
}: {
  accounts: Account[]
  owed: number
  overdue: number
  credit: number
  dueSoon: number
  onOpen: (id: string) => void
  onPay: (id: string) => void
}) {
  const aging = ageOfDebt(accounts.flatMap((a) => a.ledger.lines))

  return (
    <div>
      {/* the four numbers a finance team opens the morning with */}
      <div className="grid gap-2.5 p-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Outstanding", value: rupiah(owed), tone: "text-ink" },
          { label: "Overdue", value: rupiah(overdue), tone: "text-ember" },
          {
            label: "Due in 7 days",
            value: rupiah(dueSoon),
            tone: "text-honey",
          },
          {
            label: "Credit on account",
            value: rupiah(credit),
            tone: "text-grass",
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

      {/* how old the debt is, before who it is owed to */}
      <div className="px-3.5 pb-3.5">
        <div className="overflow-hidden rounded-panel border border-line-strong">
          <div className="border-b border-line px-3.5 py-2.5 text-[12.5px] font-semibold text-ink">
            How old the debt is
          </div>
          <div className="flex h-[34px] w-full">
            {aging.map(({ band, amount: value }) =>
              value === 0 ? null : (
                <span
                  key={band.id}
                  title={`${band.label} · ${rupiah(value)}`}
                  style={{
                    background: `color-mix(in srgb, ${band.hue} 22%, var(--surface))`,
                    color: `color-mix(in srgb, ${band.hue} 70%, var(--ink))`,
                    width: `${(value / Math.max(owed, 1)) * 100}%`,
                  }}
                  className="flex items-center justify-center overflow-hidden border-r border-surface font-mono text-[10.5px] whitespace-nowrap last:border-r-0"
                >
                  {Math.round((value / Math.max(owed, 1)) * 100)}%
                </span>
              )
            )}
          </div>
          <div className="flex flex-wrap gap-4 px-3.5 py-2.5">
            {aging.map(({ band, amount: value }) => (
              <span
                key={band.id}
                className="flex items-center gap-1.5 text-[11px]"
              >
                <span
                  style={{ background: band.hue }}
                  className="size-2 rounded-[3px]"
                />
                <span className="text-ink-3">{band.label}</span>
                <span className="font-mono text-ink">{shortRupiah(value)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <VirtualRows
        rows={accounts}
        rowKey={({ supplier }) => supplier.id}
        columns={PAYABLES_COLUMNS}
        rowHeight={46}
        className="min-w-[860px]"
        onRowClick={({ supplier }) => onOpen(supplier.id)}
        header={
          <>
            <span className="pl-3.5">Supplier</span>
            <span className="text-right">Invoices</span>
            <span className="text-right">Billed</span>
            <span className="text-right">Outstanding</span>
            <span className="text-right">Oldest due</span>
            <span className="pr-3.5 text-right" />
          </>
        }
        renderRow={({ supplier, ledger }) => (
          /* `contents` keeps every cell a direct grid item of the row while
           * still giving the row a single DOM ancestor the Pay button's
           * `group-hover/row` reveal can key off. */
          <div className="contents group/row">
            <span role="gridcell" className="min-w-0 pr-3 pl-3.5">
              <span className="flex items-center gap-2.5">
                <span
                  style={{ background: supplier.hue }}
                  className="size-[26px] shrink-0 rounded-panel"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink">
                    {supplier.name}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {supplier.division} · {supplier.country}
                  </span>
                </span>
              </span>
            </span>
            <span
              role="gridcell"
              className="px-3 text-right font-mono text-xs text-ink-3 tabular-nums"
            >
              {ledger.lines.filter((l) => l.outstanding > 0).length}
              <span className="text-ink-4">/{ledger.lines.length}</span>
            </span>
            <span
              role="gridcell"
              className="px-3 text-right font-mono text-xs text-ink-4 tabular-nums"
            >
              {rupiah(ledger.billed)}
            </span>
            <span role="gridcell" className="px-3 text-right">
              <span className="block font-mono text-[12.5px] font-medium text-ink tabular-nums">
                {rupiah(ledger.outstanding)}
              </span>
              {ledger.credit > 0 && (
                <span className="block font-mono text-[10.5px] text-grass tabular-nums">
                  {rupiah(ledger.credit)} credit
                </span>
              )}
            </span>
            <span role="gridcell" className="px-3 text-right">
              <OldestDue ledger={ledger} />
            </span>
            <span role="gridcell" className="pr-3.5 pl-3 text-right">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onPay(supplier.id)
                }}
                className="inline-flex h-[26px] items-center rounded-control bg-surface px-2.5 text-[11px] font-medium text-ink opacity-0 shadow-btn transition-opacity group-hover/row:opacity-100 hover:bg-hover"
              >
                Pay
              </button>
            </span>
          </div>
        )}
      />
    </div>
  )
}

function OldestDue({ ledger }: { ledger: Ledger }) {
  if (!ledger.oldestDue) {
    return <span className="font-mono text-xs text-ink-4">settled</span>
  }
  const late = Math.round(
    (new Date(`${todayKey()}T12:00:00`).getTime() -
      new Date(`${ledger.oldestDue}T12:00:00`).getTime()) /
      86_400_000
  )
  return (
    <span className="block">
      <span
        className={cn(
          "block font-mono text-xs tabular-nums",
          late > 0 ? "text-ember" : "text-ink-2"
        )}
      >
        {shortDate(ledger.oldestDue)}
      </span>
      <span
        className={cn(
          "block text-[10.5px]",
          late > 0 ? "text-ember" : "text-ink-4"
        )}
      >
        {late > 0 ? `${late}d late` : `in ${Math.abs(late)}d`}
      </span>
    </span>
  )
}
