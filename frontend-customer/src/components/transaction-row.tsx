import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { shortDate, timeOfDay } from "@/lib/dates"
import { money, units } from "@/lib/money"
import type { CustomerTransaction } from "@itulah/contract"

/// One purchase in a list.
///
/// The whole row is the link, not a chevron at the end of it: a thumb aiming
/// at a 16px arrow on a phone misses, and there is nothing else on the row to
/// press.
///
/// `when` is not a style choice. Under a day heading the date is already
/// stated and the time is what distinguishes two purchases; in a flat list it
/// is the reverse, and a row that showed only "12.08" for something bought
/// last month would read as this morning.
export function TransactionRow({
  transaction,
  when = "time",
}: {
  transaction: CustomerTransaction
  when?: "time" | "date"
}) {
  return (
    <Link
      to="/riwayat/$saleId"
      params={{ saleId: transaction.sale_id }}
      className="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {transaction.site_id.toUpperCase()}
        </p>
        {/* Two facts, both short, so this line never wraps into a widow on a
            narrow phone. What the purchase earned belongs to the money on the
            right, where the eye already is. */}
        <p className="text-muted-foreground truncate text-xs">
          {when === "date"
            ? shortDate(transaction.occurred_at)
            : timeOfDay(transaction.occurred_at)}{" "}
          · {units(transaction.item_count)} barang
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">
          {money(transaction.total_minor, transaction.currency)}
        </p>
        {transaction.points_earned > 0 && (
          <p className="text-muted-foreground text-xs tabular-nums">
            +{units(transaction.points_earned)} poin
          </p>
        )}
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  )
}
