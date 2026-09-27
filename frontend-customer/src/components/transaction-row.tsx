import { Link } from "@tanstack/react-router"
import { ShoppingBag, Undo2 } from "lucide-react"

import { Pill } from "@/components/ui/pill"
import { shortDate, timeOfDay } from "@/lib/dates"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { CustomerTransaction } from "@itulah/contract"

/// One purchase in a list.
///
/// The whole row is the link: a thumb aiming at a chevron on a phone misses.
/// Press feedback is a tint that lands on pointer-down.
///
/// `when` is not a style choice. Under a day heading the date is already
/// stated and the time tells two purchases apart; in a flat list it is the
/// reverse, and "12.08" for something bought last month would read as today.
export function TransactionRow({
  transaction,
  when = "time",
}: {
  transaction: CustomerTransaction
  when?: "time" | "date"
}) {
  // A sale the shop cancelled is still listed — the shopper was there and may
  // ask about it — but it earned nothing, so it must not look as if it did.
  const voided = transaction.status === "VOIDED"
  return (
    <Link
      to="/riwayat/$saleId"
      params={{ saleId: transaction.sale_id }}
      className="flex items-center gap-3.5 rounded-inner px-3 py-3 transition-colors duration-[var(--t-hover)] ease-[var(--ease-out)] active:bg-soft-2"
    >
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-soft-2"
      >
        {voided ? (
          <Undo2 className="size-[1.125rem] text-mute" strokeWidth={2} />
        ) : (
          <ShoppingBag className="size-[1.125rem] text-ink" strokeWidth={2} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-metric font-medium text-ink">
          {transaction.site_name ?? transaction.site_id.toUpperCase()}
        </p>
        <p className="truncate text-meta text-body">
          {when === "date"
            ? shortDate(transaction.occurred_at)
            : timeOfDay(transaction.occurred_at)}{" "}
          · {units(transaction.item_count)} barang
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            "num text-metric font-semibold",
            voided ? "text-mute line-through" : "text-ink",
          )}
        >
          {money(transaction.total_minor, transaction.currency)}
        </p>
        {voided ? (
          <Pill tone="soft" className="mt-0.5 px-2 py-0.5">
            Dibatalkan
          </Pill>
        ) : (
          transaction.points_earned > 0 && (
            <p className="num text-meta font-medium text-ok-fg">
              +{units(transaction.points_earned)} poin
            </p>
          )
        )}
      </div>
    </Link>
  )
}
