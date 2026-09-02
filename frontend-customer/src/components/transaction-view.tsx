import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { Sparkles } from "lucide-react"

import { ErrorState, LoadingRows } from "@/components/states"
import { Card, CardContent, CardStrip } from "@/components/ui/card"
import { Pill } from "@/components/ui/pill"
import { Separator } from "@/components/ui/separator"
import { cacheKey, member } from "@/lib/api"
import { stamp } from "@/lib/dates"
import { money, units } from "@/lib/money"

/// One receipt, as the member's copy of it.
///
/// A record card in DESIGN.md's sense: a tinted `{soft}` header strip saying
/// what the record is, white body below it, and the totals ladder at the foot
/// with only the final line in `{ink}`.
///
/// The lines are what the till charged, not what the shelf edge said: a
/// promotion acts on a line and does not always divide evenly into units, so a
/// unit price times a quantity would disagree with the total on the paper
/// receipt in the member's pocket. Where the two differ, the shelf price is
/// shown struck through so the difference reads as a discount rather than a
/// mistake.
export function TransactionView() {
  const { saleId } = useParams({ from: "/riwayat/$saleId" })

  const receipt = useQuery({
    queryKey: cacheKey.transaction(saleId),
    queryFn: ({ signal }) => member.transaction(saleId, signal),
  })

  if (receipt.isPending) {
    return <LoadingRows rows={5} />
  }

  if (receipt.isError) {
    return (
      <ErrorState
        error={receipt.error}
        notFound="Transaksi ini tidak ada di riwayat nomor member kamu."
        onRetry={() => void receipt.refetch()}
      />
    )
  }

  const { sale, lines } = receipt.data

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardStrip>
          <div className="min-w-0">
            <p className="truncate text-card-title font-semibold text-ink">
              {sale.site_id.toUpperCase()}
            </p>
            <p className="text-meta text-body">{stamp(sale.occurred_at)}</p>
          </div>
          {sale.points_earned > 0 && (
            <Pill tone="accent">
              <Sparkles />+{units(sale.points_earned)} poin
            </Pill>
          )}
        </CardStrip>

        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3.5">
            {lines.map((line, index) => {
              const shelf = line.unit_price_minor * line.quantity
              return (
                <li
                  key={`${line.sku_code}-${index}`}
                  className="flex items-start gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-id break-words text-ink">
                      {line.sku_code}
                    </p>
                    <p className="num text-meta text-body">
                      {units(line.quantity)} ×{" "}
                      {money(line.unit_price_minor, sale.currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-ink">
                      {money(line.line_total_minor, sale.currency)}
                    </p>
                    {shelf !== line.line_total_minor && (
                      <p className="num text-meta text-mute line-through">
                        {money(shelf, sale.currency)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <Separator />

          {/* The totals ladder: everything above the last line is `{body}`,
              and only "Total dibayar" is `{ink}`/600. */}
          <dl className="flex flex-col gap-2">
            {sale.discount_total_minor > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-body">Potongan</dt>
                <dd className="num text-body">
                  −{money(sale.discount_total_minor, sale.currency)}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-medium text-ink">Total dibayar</dt>
              <dd className="num text-card-title font-semibold text-ink">
                {money(sale.total_minor, sale.currency)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* The id is here because it is the one thing a counter can look a
          disputed receipt up by. Small, at the bottom, and selectable. */}
      <p className="px-1 font-mono text-id break-all text-mute select-all">
        {sale.sale_id}
      </p>
    </div>
  )
}
