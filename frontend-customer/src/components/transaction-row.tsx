import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { Pressable } from "@/components/motion/pressable"
import { shortDate, timeOfDay } from "@/lib/dates"
import { money, units } from "@/lib/money"
import type { CustomerTransaction } from "@itulah/contract"

/// One purchase in a list.
///
/// The whole row is the link, not a chevron at the end of it: a thumb aiming
/// at a 16px arrow on a phone misses, and there is nothing else on the row to
/// press. The ripple under it starts wherever the finger landed — DESIGN.md's
/// one piece of motion guidance, and the reason the row is wrapped rather than
/// merely tinted on hover.
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
    <Pressable className="rounded-inner">
      <Link
        to="/riwayat/$saleId"
        params={{ saleId: transaction.sale_id }}
        className="flex items-center gap-3 rounded-inner px-3 py-3.5 transition-colors duration-[var(--t-hover)] hover:bg-soft-2"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">
            {transaction.site_id.toUpperCase()}
          </p>
          {/* Two facts, both short, so this line never wraps into a widow on a
              narrow phone. What the purchase earned belongs to the money on
              the right, where the eye already is. */}
          <p className="truncate text-meta text-body">
            {when === "date"
              ? shortDate(transaction.occurred_at)
              : timeOfDay(transaction.occurred_at)}{" "}
            · {units(transaction.item_count)} barang
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-medium text-ink">
            {money(transaction.total_minor, transaction.currency)}
          </p>
          {transaction.points_earned > 0 && (
            <p className="num text-meta text-body">
              +{units(transaction.points_earned)} poin
            </p>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint" />
      </Link>
    </Pressable>
  )
}
