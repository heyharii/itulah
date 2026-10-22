import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { Sparkles } from "lucide-react"

import { MattePicture } from "@/components/matte"
import { ErrorState, LoadingRows } from "@/components/states"
import { CardLabel } from "@/components/ui/card"
import { ListGroup } from "@/components/ui/list"
import { Pill } from "@/components/ui/pill"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, member } from "@/lib/api"
import { stamp } from "@/lib/dates"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"

const step = (index: number) => ({ "--i": index }) as React.CSSProperties

/// One receipt.
///
/// Read top-down the way a shopper checks one: what it came to, where and
/// when, what it earned — then the lines, then the arithmetic. The total is
/// the headline because it is the number people compare against their bank
/// app; the lines are secondary because they are what people scan for "did
/// they charge me for the second shirt".
export function TransactionView() {
  const { saleId } = useParams({ from: "/riwayat/$saleId" })

  const receipt = useQuery({
    queryKey: cacheKey.transaction(saleId),
    queryFn: ({ signal }) => member.transaction(saleId, signal),
  })

  if (receipt.isPending) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="size-14" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-4 w-32" />
        <div className="mt-6 w-full">
          <LoadingRows rows={3} />
        </div>
      </div>
    )
  }

  if (receipt.isError) {
    return (
      <ErrorState
        error={receipt.error}
        notFound="Transaksi ini tidak ada di riwayat kartu kamu."
        onRetry={() => void receipt.refetch()}
      />
    )
  }

  const { sale, lines } = receipt.data
  const voided = sale.status === "VOIDED"
  const shelfTotal = lines.reduce(
    (sum, line) => sum + line.unit_price_minor * line.quantity,
    0,
  )

  return (
    <div className="flex flex-col">
      <section className="rise flex flex-col items-center text-center" style={step(0)}>
        {voided ? (
          <MattePicture art="undo" tone="mute" size={64} />
        ) : (
          <MattePicture art="bag" size={64} />
        )}
        <p
          className={cn(
            "num mt-4 text-[2.75rem] leading-none font-semibold tracking-[-0.045em]",
            voided ? "text-mute line-through" : "text-ink",
          )}
        >
          {money(sale.total_minor, sale.currency)}
        </p>
        <p className="mt-2.5 text-nav font-medium text-ink">
          {sale.site_name ?? sale.site_id.toUpperCase()}
        </p>
        <p className="text-meta text-body">{stamp(sale.occurred_at)}</p>
        <div className="mt-3">
          {voided ? (
            <Pill tone="soft">Dibatalkan toko</Pill>
          ) : sale.points_earned > 0 ? (
            <Pill tone="ok">
              <Sparkles />+{units(sale.points_earned)} poin
            </Pill>
          ) : null}
        </div>
        {voided && (
          <p className="mt-3 max-w-[18rem] text-meta text-body">
            Uangnya dikembalikan dan poinnya sudah ditarik lagi dari saldo
            kamu.
          </p>
        )}
      </section>

      <ListGroup className="rise mt-7 p-0" style={step(1)}>
        <CardLabel aside={<span className="text-meta text-mute">{units(sale.item_count)} barang</span>}>
          Barang
        </CardLabel>
        <ul className="flex flex-col px-1.5 pb-1.5">
          {lines.map((line, index) => {
            const shelf = line.unit_price_minor * line.quantity
            return (
              <li
                key={`${line.sku_code}-${index}`}
                className="flex items-start gap-3 rounded-inner px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-metric font-medium break-words text-ink">
                    {line.name ?? line.sku_code}
                  </p>
                  <p className="num mt-0.5 text-meta text-body">
                    {line.name != null && (
                      <span className="font-mono text-id text-mute">
                        {line.sku_code} ·{" "}
                      </span>
                    )}
                    {units(line.quantity)} × {money(line.unit_price_minor, sale.currency)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-metric font-medium text-ink">
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
      </ListGroup>

      <ListGroup className="rise mt-3 p-0" style={step(2)}>
        <dl className="flex flex-col gap-3 px-5 py-5">
          <Row label="Harga normal" value={money(shelfTotal, sale.currency)} />
          {sale.discount_total_minor > 0 && (
            <Row
              label="Potongan"
              value={`−${money(sale.discount_total_minor, sale.currency)}`}
              tone="ok"
            />
          )}
          <div className="h-px bg-hairline" />
          <Row label="Total dibayar" value={money(sale.total_minor, sale.currency)} strong />
          {!voided && sale.points_earned > 0 && (
            <Row label="Poin didapat" value={`+${units(sale.points_earned)}`} tone="ok" />
          )}
        </dl>
      </ListGroup>

      {/* The one thing a counter can look a disputed receipt up by. */}
      <p className="rise mt-5 px-1 text-center font-mono text-id break-all text-mute select-all" style={step(3)}>
        {sale.sale_id}
      </p>
    </div>
  )
}

function Row({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: "ok"
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "text-metric font-semibold text-ink" : "text-nav text-body"}>
        {label}
      </dt>
      <dd
        className={cn(
          "num",
          strong ? "text-headline font-semibold text-ink" : "text-nav text-ink",
          tone === "ok" && "text-ok-fg",
        )}
      >
        {value}
      </dd>
    </div>
  )
}
