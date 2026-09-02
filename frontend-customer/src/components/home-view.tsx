import { useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowRight,
  CalendarDays,
  Receipt,
  ShoppingBag,
  TicketPercent,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { AnimatedNumber } from "@/components/motion/animated-number"
import { NumberTicker } from "@/components/motion/number-ticker"
import { PullToRefresh } from "@/components/motion/pull-to-refresh"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { TransactionRow } from "@/components/transaction-row"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, member } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { money, moneyShort, units } from "@/lib/money"

const RECENT = 5

/// The screen a member opens for one number: how many points do I have.
///
/// Points first and biggest, then what they came from. The two queries are
/// separate rather than one composite endpoint because they fail separately:
/// a history that will not load should not blank out a points figure that
/// arrived perfectly well.
export function HomeView() {
  const summary = useQuery({
    queryKey: cacheKey.summary(),
    queryFn: ({ signal }) => member.summary(signal),
  })

  const recent = useQuery({
    queryKey: [...cacheKey.transactions(), { limit: RECENT }],
    queryFn: ({ signal }) => member.transactions({ limit: RECENT, signal }),
  })

  // Both, together. A member pulling down after a purchase wants the points
  // and the receipt that produced them, and refreshing one of the two would
  // leave the screen disagreeing with itself.
  const refresh = useCallback(
    () => Promise.all([summary.refetch(), recent.refetch()]),
    [summary, recent],
  )

  return (
    <PullToRefresh
      onRefresh={refresh}
      busy={summary.isRefetching || recent.isRefetching}
    >
      <div className="flex flex-col gap-5">
        <PointsCard
          points={summary.data?.points_earned_total}
          lastPurchaseAt={summary.data?.last_purchase_at ?? null}
          failed={summary.isError}
        />

        {summary.isError && (
          <ErrorState
            error={summary.error}
            notFound="Nomor member ini belum dikenali. Periksa lagi nomornya di Profil."
            onRetry={() => void summary.refetch()}
          />
        )}

        {/* DESIGN.md's KPI icon-tile — a solid coloured squircle, the label,
            then the figure — 2×2 on a phone and four across from `sm`, which
            is the one responsive rule it states for these. */}
        <section
          aria-labelledby="ringkasan"
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <h2 id="ringkasan" className="sr-only">
            Ringkasan belanja
          </h2>
          <Kpi
            icon={Receipt}
            fill="var(--a-blue)"
            label="Transaksi"
            value={summary.data?.transaction_count}
            format={units}
          />
          <Kpi
            icon={ShoppingBag}
            fill="var(--fill-orange)"
            label="Belanja"
            value={summary.data?.spent_minor}
            format={(value) =>
              moneyShort(value, summary.data?.currency ?? "IDR")
            }
            exact={
              summary.data === undefined
                ? undefined
                : money(
                    summary.data.spent_minor,
                    summary.data.currency ?? "IDR",
                  )
            }
          />
          <Kpi
            icon={TicketPercent}
            fill="var(--fill-green)"
            label="Hemat"
            value={summary.data?.saved_minor}
            format={(value) =>
              moneyShort(value, summary.data?.currency ?? "IDR")
            }
            exact={
              summary.data === undefined
                ? undefined
                : money(
                    summary.data.saved_minor,
                    summary.data.currency ?? "IDR",
                  )
            }
          />
          <StaticKpi
            icon={CalendarDays}
            fill="var(--a-violet)"
            label="Member sejak"
            value={
              summary.data === undefined
                ? undefined
                : summary.data.first_purchase_at === null
                  ? "—"
                  : shortDate(summary.data.first_purchase_at)
            }
          />
        </section>

        <section aria-labelledby="terakhir" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 id="terakhir" className="text-section font-medium text-text">
              Transaksi terakhir
            </h2>
            <Button
              render={<Link to="/riwayat" />}
              variant="quiet"
              size="inline"
            >
              Lihat semua
              <ArrowRight />
            </Button>
          </div>

          {recent.isPending ? (
            <LoadingRows rows={3} />
          ) : recent.isError ? (
            <ErrorState
              error={recent.error}
              onRetry={() => void recent.refetch()}
            />
          ) : recent.data.transactions.length === 0 ? (
            <EmptyState
              title="Belum ada transaksi"
              description="Sebutkan nomor member kamu di kasir, dan belanjanya akan muncul di sini."
            />
          ) : (
            <Card className="divide-y divide-hairline p-1.5">
              {recent.data.transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.sale_id}
                  transaction={transaction}
                  // A flat list spanning months: the date is what tells two
                  // rows apart, not the time of day.
                  when="date"
                />
              ))}
            </Card>
          )}
        </section>
      </div>
    </PullToRefresh>
  )
}

/// The one soft gradient this language allows, spent on the one figure this
/// app exists to show.
///
/// DESIGN.md permits the blue→lavender→peach card for "a big stat + a dark
/// CTA", used sparingly — which is exactly this screen, once. The figure rolls
/// on a slot reel rather than counting up because a member opening the app
/// after a purchase is checking one thing: whether it went up.
function PointsCard({
  points,
  lastPurchaseAt,
  failed,
}: {
  points: number | undefined
  lastPurchaseAt: string | null
  failed: boolean
}) {
  return (
    <section
      aria-labelledby="poin"
      className="overflow-hidden rounded-card border border-hairline bg-[linear-gradient(135deg,var(--promo-from)_0%,var(--promo-via)_52%,var(--promo-to)_100%)] px-5 py-5 shadow-soft"
    >
      <h2 id="poin" className="text-eyebrow font-semibold uppercase text-mute">
        Poin terkumpul
      </h2>

      <div className="mt-2 flex min-h-[3.25rem] items-center">
        {failed ? (
          <p className="text-body">Poin belum bisa ditampilkan.</p>
        ) : points === undefined ? (
          <Skeleton className="h-11 w-44 bg-canvas/50" />
        ) : (
          <NumberTicker
            value={points}
            format={units}
            className="text-points font-semibold text-ink"
          />
        )}
      </div>

      {/* Named for what it is. Nothing in this system records points being
          spent yet, so calling this a balance would be a number that quietly
          stops being true the first time somebody redeems at a counter. */}
      <p className="mt-1.5 text-meta text-body">
        Total poin yang pernah kamu kumpulkan
        {lastPurchaseAt !== null && (
          <> · belanja terakhir {shortDate(lastPurchaseAt)}</>
        )}
      </p>

      <Button
        render={<Link to="/riwayat" />}
        variant="dark"
        size="sm"
        className="mt-4"
      >
        Lihat riwayat
        <ArrowRight />
      </Button>
    </section>
  )
}

/// A figure that counts up to itself when it changes.
function Kpi({
  icon: Icon,
  fill,
  label,
  value,
  format,
  exact,
}: {
  icon: LucideIcon
  fill: string
  label: string
  value: number | undefined
  format: (value: number) => string
  /// The unrounded figure, for a screen reader, when the tile shows a
  /// shortened one.
  exact?: string
}) {
  return (
    <Card className="flex flex-col gap-2.5 px-3.5 py-3.5">
      <Squircle icon={Icon} fill={fill} />
      <p className="text-meta text-body">{label}</p>
      {value === undefined ? (
        <Skeleton className="h-5 w-20" />
      ) : exact === undefined ? (
        <AnimatedNumber
          value={value}
          format={format}
          className="text-kpi font-semibold text-ink"
        />
      ) : (
        <p className="text-kpi font-semibold text-ink">
          <span aria-hidden>
            <AnimatedNumber value={value} format={format} />
          </span>
          <span className="sr-only">{exact}</span>
        </p>
      )}
    </Card>
  )
}

/// The same tile, for a fact that is a date rather than a quantity — nothing
/// to count up to.
function StaticKpi({
  icon: Icon,
  fill,
  label,
  value,
}: {
  icon: LucideIcon
  fill: string
  label: string
  value: string | undefined
}) {
  return (
    <Card className="flex flex-col gap-2.5 px-3.5 py-3.5">
      <Squircle icon={Icon} fill={fill} />
      <p className="text-meta text-body">{label}</p>
      {value === undefined ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <p className="text-metric font-semibold text-ink">{value}</p>
      )}
    </Card>
  )
}

/// The KPI hallmark: a solid coloured squircle with a white glyph. The one
/// place in this app where the categorical accents appear at all.
function Squircle({ icon: Icon, fill }: { icon: LucideIcon; fill: string }) {
  return (
    <span
      aria-hidden
      className="flex size-[1.875rem] items-center justify-center rounded-inner"
      style={{ background: fill }}
    >
      <Icon className="size-[1rem] text-on-dark" />
    </span>
  )
}
