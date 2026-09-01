import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowRight, Sparkles } from "lucide-react"

import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { TransactionRow } from "@/components/transaction-row"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, customerSummary, customerTransactions } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { useMemberId } from "@/lib/member"
import { money, units } from "@/lib/money"

const RECENT = 5

/// The screen a member opens for one number: how many points do I have.
///
/// Points first and biggest, then what they came from. The two queries are
/// separate rather than one composite endpoint because they fail separately:
/// a history that will not load should not blank out a points figure that
/// arrived perfectly well.
export function HomeView() {
  const memberId = useMemberId()

  const summary = useQuery({
    queryKey: cacheKey.summary(memberId),
    queryFn: ({ signal }) => customerSummary(memberId, signal),
  })

  const recent = useQuery({
    queryKey: [...cacheKey.transactions(memberId), { limit: RECENT }],
    queryFn: ({ signal }) =>
      customerTransactions(memberId, { limit: RECENT, signal }),
  })

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="poin">
        <h1 id="poin" className="sr-only">
          Poin saya
        </h1>
        <Card className="bg-primary text-primary-foreground ring-0">
          <CardContent className="flex flex-col gap-1">
            <p className="text-primary-foreground/70 flex items-center gap-1.5 text-xs">
              <Sparkles className="size-3.5" />
              Poin terkumpul
            </p>
            {summary.isPending ? (
              <Skeleton className="bg-primary-foreground/20 h-11 w-40" />
            ) : summary.isError ? (
              <p className="text-primary-foreground/80 py-2 text-sm">
                Poin belum bisa ditampilkan.
              </p>
            ) : (
              <p className="text-4xl font-semibold tabular-nums md:text-5xl">
                {units(summary.data.points_earned_total)}
              </p>
            )}
            <p className="text-primary-foreground/70 text-xs">
              {/* Named for what it is. Nothing in this system records points
                  being spent yet, so calling this a balance would be a number
                  that quietly stops being true the first time somebody
                  redeems at a counter. */}
              Total poin yang pernah kamu kumpulkan
              {summary.data?.last_purchase_at != null && (
                <>
                  {" · "}
                  belanja terakhir {shortDate(summary.data.last_purchase_at)}
                </>
              )}
            </p>
          </CardContent>
        </Card>
      </section>

      {summary.isError && (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      )}

      {/* Stacked rows on a phone, three tiles from `sm` up. A three-column
          grid at 375px puts "Rp 3.085.000" in an 80px box, where it breaks
          mid-number — and a price broken across two lines is a price nobody
          can read at a glance. */}
      <section
        aria-labelledby="ringkasan"
        className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
      >
        <h2 id="ringkasan" className="sr-only">
          Ringkasan belanja
        </h2>
        <Stat
          label="Transaksi"
          value={
            summary.data === undefined
              ? undefined
              : units(summary.data.transaction_count)
          }
        />
        <Stat
          label="Belanja"
          value={
            summary.data === undefined
              ? undefined
              : money(
                  summary.data.spent_minor,
                  summary.data.currency ?? "IDR",
                )
          }
        />
        <Stat
          label="Hemat"
          value={
            summary.data === undefined
              ? undefined
              : money(
                  summary.data.saved_minor,
                  summary.data.currency ?? "IDR",
                )
          }
        />
      </section>

      <section aria-labelledby="terakhir" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 id="terakhir" className="font-heading text-sm font-medium">
            Transaksi terakhir
          </h2>
          <Button
            render={<Link to="/riwayat" />}
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
          >
            Lihat semua
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>

        {recent.isPending ? (
          <LoadingRows rows={3} />
        ) : recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
        ) : recent.data.transactions.length === 0 ? (
          <EmptyState
            title="Belum ada transaksi"
            description="Sebutkan nomor member kamu di kasir, dan belanjanya akan muncul di sini."
          />
        ) : (
          <Card size="sm" className="py-2">
            <CardContent className="flex flex-col px-2">
              {recent.data.transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.sale_id}
                  transaction={transaction}
                  // A flat list spanning months: the date is what tells two
                  // rows apart, not the time of day.
                  when="date"
                />
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | undefined }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-1">
        <p className="text-muted-foreground text-xs">{label}</p>
        {value === undefined ? (
          <Skeleton className="h-5 w-24 sm:w-full" />
        ) : (
          <p className="text-sm font-medium tabular-nums">{value}</p>
        )}
      </CardContent>
    </Card>
  )
}
