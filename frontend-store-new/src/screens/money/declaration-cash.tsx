import { Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import {
  cashColumns,
  cashReceiptsOf,
  rowsOf,
  useShiftSales,
} from "@/lib/queries/money-declaration"
import type { Session } from "@/lib/queries/sessions"
import { CashMatrix } from "@/screens/money/declaration-parts"
import { BOX, TD, TH } from "@/screens/money/declaration-words"
import { clock } from "@/screens/money/sales-words"
import { cn } from "@/lib/utils"
import { money, units } from "@itulah/contract/money"

/// The cash half of a cashier's declaration: the sheet the admin counts in,
/// the read-only sheet of what the cashier handed in, and the cash receipts.

const hours = (session: Session): string =>
  `${clock(session.report.opened_at)}–${session.report.closed_at === null ? "Open" : clock(session.report.closed_at)}`

/// What the cashier handed in, read-only: the closing and each temporary
/// deposit, note by note.
export function DepositsSheet({
  session,
  name,
  open,
  onClose,
}: {
  session: Session
  name: string
  open: boolean
  onClose: () => void
}) {
  const columns = cashColumns(session.report, clock)
  const rows = rowsOf(columns)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`${name} · Cashier Closing`}
      caption={hours(session)}
      width="wide"
    >
      {columns.length === 0 ? (
        <Banner tone="warn">The Cashier Has Not Counted the Drawer Yet</Banner>
      ) : (
        <CashMatrix columns={columns} rows={rows} />
      )}
    </Sheet>
  )
}

/// The cash receipts of one cashier's session.
export function CashReceiptsSheet({
  session,
  name,
  open,
  onClose,
}: {
  session: Session
  name: string
  open: boolean
  onClose: () => void
}) {
  const sales = useShiftSales(session.report.shift_id)
  const receipts = cashReceiptsOf(sales.data ?? [])
  const total = receipts.reduce((sum, one) => sum + one.amount, 0)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Cash Sales"
      id={name}
      caption={hours(session)}
      width="wide"
    >
      <div className={BOX}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={cn(TH, "w-28")}>Time</th>
              <th className={TH}>Receipt</th>
              <th className={cn(TH, "text-right")}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((one) => (
              <tr key={one.id}>
                <td className={TD}>{clock(one.at)}</td>
                <td className={TD}>{one.receipt}</td>
                <td className={cn(TD, "text-right")}>{money(one.amount)}</td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={3} className={cn(TD, "text-center text-mute")}>
                  {sales.isPending
                    ? "Reading the Receipts…"
                    : "No Cash Receipts"}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className={cn(TD, "border-b-0 font-semibold text-ink")}>
                Total
              </td>
              <td className={cn(TD, "border-b-0 text-mute")}>
                {units(receipts.length)}{" "}
                {receipts.length === 1 ? "Receipt" : "Receipts"}
              </td>
              <td
                className={cn(
                  TD,
                  "border-b-0 text-right font-semibold text-ink",
                )}
              >
                {money(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Sheet>
  )
}
