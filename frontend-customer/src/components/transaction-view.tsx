import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { ArrowLeft, Sparkles } from "lucide-react"

import { ErrorState, LoadingRows } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cacheKey, customerTransaction } from "@/lib/api"
import { stamp } from "@/lib/dates"
import { useMemberId } from "@/lib/member"
import { money, units } from "@/lib/money"

/// One receipt, as the member's copy of it.
///
/// The lines are what the till charged, not what the shelf edge said: a
/// promotion acts on a line and does not always divide evenly into units, so a
/// unit price times a quantity would disagree with the total on the paper
/// receipt in the member's pocket. Where the two differ, the shelf price is
/// shown struck through so the difference reads as a discount rather than a
/// mistake.
export function TransactionView() {
  const memberId = useMemberId()
  const { saleId } = useParams({ from: "/riwayat/$saleId" })

  const receipt = useQuery({
    queryKey: cacheKey.transaction(memberId, saleId),
    queryFn: ({ signal }) => customerTransaction(memberId, saleId, signal),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="px-1">
        <Button variant="ghost" size="sm" render={<Link to="/riwayat" />}>
          <ArrowLeft />
          Riwayat
        </Button>
      </div>

      {receipt.isPending ? (
        <LoadingRows rows={5} />
      ) : receipt.isError ? (
        <ErrorState
          error={receipt.error}
          notFound="Transaksi ini tidak ada di riwayat nomor member kamu."
          onRetry={() => void receipt.refetch()}
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-heading text-base font-medium">
                    {receipt.data.sale.site_id.toUpperCase()}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {stamp(receipt.data.sale.occurred_at)}
                  </p>
                </div>
                {receipt.data.sale.points_earned > 0 && (
                  <span className="bg-primary text-primary-foreground flex items-center gap-1 rounded-4xl px-3 py-1 text-xs font-medium">
                    <Sparkles className="size-3" />+
                    {units(receipt.data.sale.points_earned)} poin
                  </span>
                )}
              </div>

              <Separator />

              <ul className="flex flex-col gap-3">
                {receipt.data.lines.map((line, index) => {
                  const shelf = line.unit_price_minor * line.quantity
                  return (
                    <li
                      key={`${line.sku_code}-${index}`}
                      className="flex items-start gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">
                          {line.sku_code}
                        </p>
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {units(line.quantity)} ×{" "}
                          {money(
                            line.unit_price_minor,
                            receipt.data.sale.currency,
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm tabular-nums">
                          {money(
                            line.line_total_minor,
                            receipt.data.sale.currency,
                          )}
                        </p>
                        {shelf !== line.line_total_minor && (
                          <p className="text-muted-foreground text-xs line-through tabular-nums">
                            {money(shelf, receipt.data.sale.currency)}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              <Separator />

              <dl className="flex flex-col gap-2 text-sm">
                {receipt.data.sale.discount_total_minor > 0 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Potongan</dt>
                    <dd className="tabular-nums">
                      −
                      {money(
                        receipt.data.sale.discount_total_minor,
                        receipt.data.sale.currency,
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="font-medium">Total dibayar</dt>
                  <dd className="text-base font-semibold tabular-nums">
                    {money(
                      receipt.data.sale.total_minor,
                      receipt.data.sale.currency,
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* The id is here because it is the one thing a counter can look a
              disputed receipt up by. Small, at the bottom, and selectable. */}
          <p className="text-muted-foreground px-1 font-mono text-[11px] break-all select-all">
            {receipt.data.sale.sale_id}
          </p>
        </>
      )}
    </div>
  )
}
