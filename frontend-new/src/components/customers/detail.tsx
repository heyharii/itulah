import { Icon, paths } from "@/components/dashboard/parts"
import { STORES, articleOf, resolveReturn } from "@/components/commercial/data"
import type {
  Customer360Data,
  Customer360Purchase,
} from "@/components/customers/api"
import {
  POINT_VALUE,
  TIER_META,
  hasLastSeen,
  codeLabel,
  lastSeenOf,
  pointsOf,
  returnsOf,
  rupiah,
  spendOf,
  tierOf,
  visitsOf,
  vouchersOf,
  type Customer,
} from "@/components/customers/data"
import { shortDate } from "@/lib/day"
import { cn } from "@/lib/utils"

const rule =
  "border-b border-b-[color-mix(in_srgb,var(--line)_78%,transparent)]"

/** One customer: what they bought, what came back, and what they are owed. */
export function CustomerDetail({
  customer,
  detail,
}: {
  customer: Customer
  detail?: Customer360Data
}) {
  const viewCustomer = detail?.customer ?? customer
  const tier = tierOf(viewCustomer)
  const spend = spendOf(viewCustomer)
  const points = pointsOf(viewCustomer)
  const returned = returnsOf(viewCustomer)
  const vouchers = vouchersOf(viewCustomer)
  const detailVouchers = detail?.vouchers
  const purchaseRows = detail
    ? detail.purchases.map(toPurchaseRow)
    : viewCustomer.purchases.map(toPurchaseRow)
  const next = tier === "none" ? "silver" : tier === "silver" ? "gold" : null
  const toNext = next ? TIER_META[next].from - spend : 0

  return (
    <div className="px-4 py-4">
      <div className="grid grid-cols-4 gap-2 pb-3">
        {[
          { label: "Lifetime spend", value: rupiah(spend), tone: "text-ink" },
          {
            label: "Visits",
            value: visitsOf(customer) ? String(visitsOf(customer)) : "—",
            tone: "text-ink",
          },
          { label: "Points", value: points.toLocaleString(), tone: "text-ink" },
          {
            label: "Worth",
            value: rupiah(points * POINT_VALUE),
            tone: "text-grass",
          },
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
                "truncate font-mono text-[14px] font-medium",
                stat.tone
              )}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* how far off the next tier they are */}
      {next && (
        <div className="mb-3 rounded-panel border border-line-strong px-3.5 py-2.5">
          <div className="flex items-baseline justify-between pb-1.5">
            <span className="text-[11.5px] text-ink-3">
              {rupiah(Math.max(0, toNext))} more to {TIER_META[next].label}
            </span>
            <span className="font-mono text-[10.5px] text-ink-4">
              {rupiah(spend)} of {rupiah(TIER_META[next].from)}
            </span>
          </div>
          <span className="block h-[5px] overflow-hidden rounded-full bg-inset">
            <span
              style={{
                width: `${Math.min(100, (spend / TIER_META[next].from) * 100)}%`,
                background: TIER_META[next].hue,
              }}
              className="block h-full rounded-full"
            />
          </span>
        </div>
      )}

      {[
        { label: "Member since", value: shortDate(viewCustomer.joinedOn) },
        {
          label: "Last seen",
          value: hasLastSeen(viewCustomer)
            ? shortDate(lastSeenOf(viewCustomer))
            : "No activity data",
        },
        {
          label: "Home store",
          value:
            STORES.find((s) => s.id === viewCustomer.homeStoreId)?.name ?? "—",
        },
        { label: "Phone", value: viewCustomer.phone },
        { label: "Email", value: viewCustomer.email },
      ].map((row) => (
        <div
          key={row.label}
          className="flex items-start gap-3 border-t border-line py-[9px]"
        >
          <span className="w-[104px] shrink-0 pt-px text-xs text-ink-4">
            {row.label}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-2">
            {row.value}
          </span>
        </div>
      ))}

      {(detailVouchers ? detailVouchers.length > 0 : vouchers.length > 0) && (
        <>
          <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
            Vouchers held
          </div>
          <ul className="overflow-hidden rounded-panel border border-line-strong">
            {(detailVouchers ?? vouchers).map((voucher) => (
              <li
                key={voucher.id}
                className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="grid size-[26px] shrink-0 place-items-center rounded-panel bg-green-tint text-green">
                  <Icon path={paths.tag} size={13} width={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11.5px] font-medium text-ink">
                    {voucher.code}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-4">
                    {"voucherType" in voucher
                      ? `${voucher.title || voucher.voucherType} · ${voucher.status}`
                      : codeLabel(voucher)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-ink tabular-nums">
                  {rupiah(
                    "balance" in voucher
                      ? voucher.balance
                      : (voucher.value ?? 0)
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        Purchases
      </div>
      {purchaseRows.length === 0 ? (
        <p className="rounded-panel bg-inset py-8 text-center text-xs text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
          Nothing bought yet.
        </p>
      ) : (
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup>
            <col style={{ width: 96 }} />
            <col />
            <col style={{ width: 132 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 128 }} />
          </colgroup>
          <thead>
            <tr className="[&>th]:h-9 [&>th]:border-y [&>th]:border-y-line-strong [&>th]:bg-surface [&>th]:px-2.5 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:tracking-[0.04em] [&>th]:text-ink-3 [&>th]:uppercase">
              <th className="text-left">When</th>
              <th className="text-left">Article</th>
              <th className="text-left">Store</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {purchaseRows.slice(0, 14).map((purchase) => {
              const article = articleOf(purchase.articleId)
              const policy = article
                ? resolveReturn(article, purchase.storeId)
                : undefined
              return (
                <tr key={purchase.id} className="hover:[&>td]:bg-hover">
                  <td
                    className={cn(
                      "h-row px-2.5 align-middle font-mono text-[11px] text-ink-3 tabular-nums",
                      rule
                    )}
                  >
                    {shortDate(purchase.at)}
                  </td>
                  <td className={cn("px-2.5 align-middle", rule)}>
                    <span className="flex items-center gap-2">
                      {article && (
                        <img
                          src={article.colorways[0].image}
                          alt=""
                          loading="lazy"
                          className="size-[24px] shrink-0 rounded-chip bg-inset object-cover"
                        />
                      )}
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate text-[11.5px] font-medium",
                            purchase.returned
                              ? "text-ink-4 line-through"
                              : "text-ink"
                          )}
                        >
                          {article?.name ?? purchase.label}
                        </span>
                        {purchase.returned && (
                          <span className="block text-[10px] text-ember">
                            Returned
                            {policy &&
                              !policy.returnable &&
                              " · outside policy"}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-2.5 align-middle text-[11px] text-ink-3",
                      rule
                    )}
                  >
                    <span className="block truncate">
                      {purchase.storeName ||
                        STORES.find((s) => s.id === purchase.storeId)?.name ||
                        "—"}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-2.5 text-right align-middle font-mono text-xs text-ink-3 tabular-nums",
                      rule
                    )}
                  >
                    {purchase.qty}
                  </td>
                  <td
                    className={cn(
                      "px-2.5 text-right align-middle font-mono text-[12px] tabular-nums",
                      purchase.returned
                        ? "text-ink-4 line-through"
                        : "text-ink",
                      rule
                    )}
                  >
                    {rupiah(purchase.amount)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {returned.length > 0 && (
        <p className="pt-2 text-[11px] text-ink-4">
          {returned.length} line{returned.length === 1 ? "" : "s"} came back —
          the points they carried came off the balance with them.
        </p>
      )}

      <div className="pt-4 pb-2 text-[10.5px] font-semibold tracking-[0.05em] text-ink-4 uppercase">
        Points
      </div>
      <ul className="overflow-hidden rounded-panel border border-line-strong">
        {viewCustomer.points.slice(0, 10).map((entry) => (
          <li
            key={entry.id}
            className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0"
          >
            <span
              className={cn(
                "grid size-[24px] shrink-0 place-items-center rounded-panel",
                entry.points >= 0
                  ? "bg-green-tint text-green"
                  : "bg-inset text-ink-3"
              )}
            >
              <Icon
                path={entry.points >= 0 ? paths.arrowUp : paths.download}
                size={12}
                width={2}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] text-ink-2">
                {entry.note}
              </span>
              <span className="block truncate text-[10.5px] text-ink-4">
                {shortDate(entry.at)}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 font-mono text-[12px] tabular-nums",
                entry.points >= 0 ? "text-grass" : "text-ink-3"
              )}
            >
              {entry.points >= 0 ? "+" : ""}
              {entry.points.toLocaleString()}
            </span>
          </li>
        ))}
        {viewCustomer.points.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-ink-4">
            {detail
              ? "No points movement has been recorded in Internal."
              : "No points movement yet."}
          </li>
        )}
      </ul>
    </div>
  )
}

type PurchaseRow = {
  id: string
  at: Customer["joinedOn"]
  storeId: string
  storeName: string
  articleId: string
  label: string
  qty: number
  amount: number
  returned?: boolean
}

function toPurchaseRow(
  purchase: Customer360Purchase | Customer["purchases"][number]
): PurchaseRow {
  if ("itemCount" in purchase) {
    const count = Math.max(0, purchase.itemCount)
    return {
      id: purchase.id,
      at: purchase.at,
      storeId: purchase.storeId,
      storeName: purchase.storeName,
      articleId: "",
      label:
        count > 0
          ? `${count} item${count === 1 ? "" : "s"} · ${purchase.id}`
          : purchase.id,
      qty: count,
      amount: purchase.amount,
    }
  }
  const article = articleOf(purchase.articleId)
  return {
    id: purchase.id,
    at: purchase.at,
    storeId: purchase.storeId,
    storeName: "",
    articleId: purchase.articleId,
    label: article?.name ?? "Unknown article",
    qty: purchase.qty,
    amount: purchase.amount,
    returned: purchase.returned,
  }
}
