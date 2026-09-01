import { useInfiniteQuery } from "@tanstack/react-query"

import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { TransactionRow } from "@/components/transaction-row"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cacheKey, customerTransactions, type HistoryCursor } from "@/lib/api"
import { dayKey, dayLabel } from "@/lib/dates"
import { useMemberId } from "@/lib/member"
import { money, units } from "@/lib/money"
import type { CustomerTransaction } from "@itulah/contract"

const PAGE = 25

/// Everything this member has bought, newest first.
///
/// Paged with the server's cursor rather than an offset, and the reason is
/// visible from this screen: a purchase made while somebody is reading their
/// history would shift every offset by one, and the next page would repeat a
/// receipt or skip one.
export function HistoryView() {
  const memberId = useMemberId()

  const history = useInfiniteQuery({
    queryKey: cacheKey.transactions(memberId),
    initialPageParam: undefined as HistoryCursor | undefined,
    queryFn: ({ pageParam, signal }) =>
      customerTransactions(memberId, { limit: PAGE, cursor: pageParam, signal }),
    getNextPageParam: (page) =>
      page.next_before_occurred_at === null || page.next_before_sale_id === null
        ? undefined
        : {
            before_occurred_at: page.next_before_occurred_at,
            before_sale_id: page.next_before_sale_id,
          },
  })

  if (history.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Heading />
        <LoadingRows rows={6} />
      </div>
    )
  }

  if (history.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Heading />
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      </div>
    )
  }

  const transactions = history.data.pages.flatMap((page) => page.transactions)

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Heading />
        <EmptyState
          title="Riwayat masih kosong"
          description="Setiap belanja yang kamu daftarkan dengan nomor member akan tercatat di sini, lengkap dengan poinnya."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading />
      {groupByDay(transactions).map((day) => (
        <section key={day.key} className="flex flex-col gap-2">
          {/* The heading sticks under the phone's header so the reader can
              always see which day they have scrolled into. */}
          <div className="bg-background/90 sticky top-13 z-[5] flex items-baseline justify-between gap-3 px-1 py-1 backdrop-blur md:top-0">
            <h2 className="text-sm font-medium">{dayLabel(day.at)}</h2>
            <p className="text-muted-foreground text-xs tabular-nums">
              {money(day.total_minor, day.currency)}
              {day.points > 0 && <> · +{units(day.points)} poin</>}
            </p>
          </div>
          <Card size="sm" className="py-2">
            <CardContent className="flex flex-col px-2">
              {day.transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.sale_id}
                  transaction={transaction}
                />
              ))}
            </CardContent>
          </Card>
        </section>
      ))}

      {history.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}
        </Button>
      )}
    </div>
  )
}

function Heading() {
  return (
    <h1 className="font-heading px-1 text-lg font-medium">Riwayat belanja</h1>
  )
}

interface Day {
  key: string
  at: string
  transactions: CustomerTransaction[]
  total_minor: number
  points: number
  currency: string
}

/// Purchases split into the local days they happened on.
///
/// The list already arrives newest first, so this walks it in order and starts
/// a new group when the day changes — no sorting, and no risk of reordering
/// what the server ranked.
function groupByDay(transactions: CustomerTransaction[]): Day[] {
  const days: Day[] = []
  for (const transaction of transactions) {
    const key = dayKey(transaction.occurred_at)
    let day = days.at(-1)
    if (day === undefined || day.key !== key) {
      day = {
        key,
        at: transaction.occurred_at,
        transactions: [],
        total_minor: 0,
        points: 0,
        currency: transaction.currency,
      }
      days.push(day)
    }
    day.transactions.push(transaction)
    day.total_minor += transaction.total_minor
    day.points += transaction.points_earned
  }
  return days
}
