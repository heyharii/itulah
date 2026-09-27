import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowRight, Gift, ScanBarcode, ShoppingBag } from "lucide-react"

import { Avatar } from "@/components/avatar"
import { BellChip } from "@/components/bell"
import { MemberCard } from "@/components/member-card"
import { AnimatedNumber } from "@/components/motion/animated-number"
import { NumberTicker } from "@/components/motion/number-ticker"
import { PullToRefresh } from "@/components/motion/pull-to-refresh"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { TransactionRow } from "@/components/transaction-row"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { ListGroup } from "@/components/ui/list"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, member } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { EASE_OUT } from "@/lib/motion"
import { money, moneyShort, units } from "@/lib/money"
import { usePointsFeed } from "@/lib/points-feed"
import { useSession } from "@/lib/session"

const RECENT = 5

/// Position in the first-paint cascade. 50ms apart (see `.rise`).
const step = (index: number) => ({ "--i": index }) as React.CSSProperties

/// The screen a member opens for one thing: how many points, and the card
/// to show at the counter.
///
/// The card is the hero because it is the object this app replaces — the one
/// people used to carry. The balance sits right under it, as large as the
/// screen allows, because it is the number people open the app to check. The
/// three reads fail separately: history that will not load must not blank a
/// balance that arrived perfectly well.
export function HomeView() {
  const { member: me } = useSession()

  const summary = useQuery({
    queryKey: cacheKey.summary(),
    queryFn: ({ signal }) => member.summary(signal),
  })

  const recent = useQuery({
    queryKey: [...cacheKey.transactions(), { limit: RECENT }],
    queryFn: ({ signal }) => member.transactions({ limit: RECENT, signal }),
  })

  // What can still be spent, which is not what was ever earned: a redemption
  // debits the ledger and leaves `points_earned_total` exactly where it was.
  // Polled while on screen (`usePointsFeed`): a member standing at the
  // counter watches this number go up without touching anything.
  const balance = usePointsFeed()

  // All three, together. A member pulling down after a purchase wants the
  // points and the receipt that produced them, and refreshing one of them
  // would leave the screen disagreeing with itself.
  const refresh = useCallback(
    () => Promise.all([summary.refetch(), recent.refetch(), balance.refetch()]),
    [summary, recent, balance],
  )

  // `null` is a member who has never earned or spent — nought to spend, which
  // is not the same as a balance still loading.
  const points =
    balance.data === undefined ? undefined : (balance.data.balance_points ?? 0)
  const earned = summary.data?.points_earned_total
  const gained = useGain(points)

  return (
    <PullToRefresh
      onRefresh={refresh}
      busy={summary.isRefetching || recent.isRefetching || balance.isRefetching}
    >
      <div className="flex flex-col">
        <header className="rise flex items-center justify-between" style={step(0)}>
          <Link to="/profil" aria-label="Profil" className="press rounded-full">
            <Avatar memberId={me.member_id} name={me.display_name} />
          </Link>
          <div className="flex items-center gap-2.5">
            <BellChip />
            <Chip aria-label="Tunjukkan kartu member" render={<Link to="/kartu" />}>
              <ScanBarcode />
            </Chip>
          </div>
        </header>

        <Link
          to="/kartu"
          aria-label="Buka kartu member"
          className="rise mx-auto mt-5 block w-full max-w-[19.5rem]"
          style={step(1)}
        >
          <motion.div layoutId="member-card">
            <MemberCard
              memberId={me.member_id}
              name={me.display_name}
              since={me.joined_on}
              shine={gained?.id ?? 0}
            />
          </motion.div>
        </Link>

        <section
          aria-labelledby="saldo"
          className="rise mt-9 flex flex-col items-center text-center"
          style={step(2)}
        >
          <h2 id="saldo" className="text-nav text-body">
            Saldo poin
          </h2>
          <div className="relative mt-2 flex min-h-[3.5rem] items-baseline justify-center gap-2">
            <GainBubble gain={gained} />
            {balance.isError ? (
              <p className="text-body">Saldo belum bisa ditampilkan.</p>
            ) : points === undefined ? (
              <Skeleton className="h-12 w-36 rounded-full" />
            ) : (
              <>
                <NumberTicker
                  value={points}
                  format={units}
                  className="text-display font-semibold text-ink"
                />
                <span className="text-headline font-semibold text-mute">poin</span>
              </>
            )}
          </div>
          <p className="mt-2 max-w-[18rem] text-meta text-body">
            {/* The ledger may go below nought on purpose: points already turned
                into a voucher are never clawed back when the sale that earned
                them is cancelled. Say so, or a minus reads as a fault. */}
            {points !== undefined && points < 0
              ? "Minus karena belanja yang poinnya sudah ditukar dibatalkan. Tertutup lagi dari belanja berikutnya."
              : earned !== undefined && points !== undefined && earned !== points
                ? `Total terkumpul ${units(earned)} poin`
                : "Sebutkan nomor member atau pindai kartu setiap belanja"}
          </p>
        </section>

        {/* Redeeming is what members come back for, so it is the filled
            action; the card is one tap away on the card itself as well. */}
        <div className="rise mt-6 grid grid-cols-2 gap-3" style={step(3)}>
          <Button variant="primary" size="lg" render={<Link to="/tukar-poin" />}>
            <Gift />
            Tukar poin
          </Button>
          <Button variant="secondary" size="lg" render={<Link to="/kartu" />}>
            <ScanBarcode />
            Kartu
          </Button>
        </div>

        {summary.isError && (
          <div className="mt-4">
            <ErrorState
              error={summary.error}
              onRetry={() => void summary.refetch()}
            />
          </div>
        )}

        <Card className="rise mt-6 overflow-hidden" style={step(4)}>
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3.5">
            <span className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-full bg-ink">
                <ShoppingBag className="size-3.5 text-on-dark" strokeWidth={2.25} />
              </span>
              <span className="text-metric font-medium text-ink">Belanja kamu</span>
            </span>
            {summary.data === undefined ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              <span className="num text-metric font-semibold text-ink">
                {money(summary.data.spent_minor, summary.data.currency ?? "IDR")}
              </span>
            )}
          </div>
          <div className="mx-5 h-px bg-hairline" />
          <div className="grid grid-cols-2 py-4">
            <Figure
              label="Transaksi"
              value={summary.data?.transaction_count}
              format={units}
            />
            <Figure
              label="Hemat"
              value={summary.data?.saved_minor}
              format={(value) => moneyShort(value, summary.data?.currency ?? "IDR")}
              divider
            />
          </div>
          {summary.data?.last_purchase_at != null && (
            <p className="border-t border-hairline px-5 py-3 text-center text-meta text-body">
              Belanja terakhir {shortDate(summary.data.last_purchase_at)}
            </p>
          )}
        </Card>

        <section
          aria-labelledby="terakhir"
          className="rise mt-7 flex flex-col gap-2.5"
          style={step(5)}
        >
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 id="terakhir" className="text-headline font-semibold text-ink">
              Transaksi terakhir
            </h2>
            <Button variant="quiet" size="inline" render={<Link to="/riwayat" />}>
              Semua
              <ArrowRight />
            </Button>
          </div>

          {recent.isPending ? (
            <LoadingRows rows={3} />
          ) : recent.isError ? (
            <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
          ) : recent.data.transactions.length === 0 ? (
            <EmptyState
              title="Belum ada transaksi"
              description="Tunjukkan kartu di kasir saat belanja, dan transaksinya muncul di sini."
            />
          ) : (
            <ListGroup>
              {recent.data.transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.sale_id}
                  transaction={transaction}
                  when="date"
                />
              ))}
            </ListGroup>
          )}
        </section>
      </div>
    </PullToRefresh>
  )
}

/// One figure in the summary card: grey label over a large number, counting
/// up when it changes so a refetch shows the difference.
function Figure({
  label,
  value,
  format,
  divider = false,
}: {
  label: string
  value: number | undefined
  format: (value: number) => string
  divider?: boolean
}) {
  return (
    <div
      className={
        divider
          ? "flex flex-col items-center gap-1 border-l border-hairline"
          : "flex flex-col items-center gap-1"
      }
    >
      <p className="text-meta text-body">{label}</p>
      {value === undefined ? (
        <Skeleton className="h-6 w-16" />
      ) : (
        <AnimatedNumber
          value={value}
          format={format}
          className="text-kpi font-semibold text-ink"
        />
      )}
    </div>
  )
}

/// The last increase in the balance, while it is worth showing: set when the
/// polled figure goes up, cleared a couple of seconds later. The first reading
/// is a baseline, not a gain — opening the app is not earning points.
function useGain(points: number | undefined) {
  const [gain, setGain] = useState<{ id: number; value: number } | null>(null)
  const previous = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (points === undefined) return
    const before = previous.current
    previous.current = points
    if (before === undefined || points <= before) return
    const shown = { id: Date.now(), value: points - before }
    // Deferred a frame so the reel has started rolling before the bubble
    // lands beside it; the two read as one event.
    const start = window.setTimeout(() => setGain(shown), 16)
    const end = window.setTimeout(
      () => setGain((current) => (current?.id === shown.id ? null : current)),
      2800,
    )
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(end)
    }
  }, [points])

  return gain
}

/// "+13" rising out of the balance when points land. Rare, earned, and the
/// thing the member was waiting for — so it is allowed to arrive with a
/// little spring and float away rather than simply blink.
function GainBubble({ gain }: { gain: { id: number; value: number } | null }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {gain !== null && (
        <motion.span
          key={gain.id}
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, transition: { duration: 0.25, ease: EASE_OUT } }}
          transition={reduce ? { duration: 0.2 } : { type: "spring", duration: 0.45, bounce: 0.25 }}
          className="num absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-ok-bg px-3 py-1 text-meta font-semibold whitespace-nowrap text-ok-fg"
        >
          +{units(gain.value)} poin
        </motion.span>
      )}
    </AnimatePresence>
  )
}
