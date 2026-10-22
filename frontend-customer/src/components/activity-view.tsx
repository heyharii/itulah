import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ScreenTitle } from "@/components/app-shell"
import { MattePicture, type MatteArt, type MatteTone } from "@/components/matte"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ListGroup } from "@/components/ui/list"
import { dayKey, dayLabel, timeOfDay } from "@/lib/dates"
import { units } from "@/lib/money"
import { at, markSeen, newest, readSeen, usePointsFeed } from "@/lib/points-feed"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { PointsEntry } from "@/lib/api"

/// What each kind of ledger line means to the person whose points they are.
const KIND: Record<string, { art: MatteArt; title: string; tone: MatteTone }> = {
  EARN: { art: "bag", title: "Poin dari belanja", tone: "deep" },
  REDEEM_TO_VOUCHER: { art: "gift", title: "Ditukar jadi voucher", tone: "deep" },
  VOID_REVERSAL: { art: "undo", title: "Belanja dibatalkan toko", tone: "mute" },
  RETURN_REVERSAL: { art: "undo", title: "Barang dikembalikan", tone: "mute" },
  ADJUSTMENT: { art: "adjust", title: "Penyesuaian dari toko", tone: "mute" },
  OPENING: { art: "flag", title: "Saldo awal", tone: "deep" },
}

const FALLBACK = { art: "adjust", title: "Perubahan poin", tone: "mute" } as const

/// Every change to the balance, newest first — the points ledger read as a
/// notification list. Opening it marks everything read; the dots stay for this
/// visit so the member can still see which lines were the new ones.
export function ActivityView() {
  const { member } = useSession()
  const feed = usePointsFeed()
  // Captured once, before this visit marks anything read.
  const [seenBefore] = useState(() => readSeen(member.member_id))

  useEffect(() => {
    const entries = feed.data?.entries
    if (entries !== undefined && entries.length > 0) {
      markSeen(member.member_id, newest(entries))
    }
  }, [feed.data, member.member_id])

  const title = <ScreenTitle>Aktivitas poin</ScreenTitle>

  if (feed.isPending) {
    return (
      <>
        {title}
        <LoadingRows rows={5} />
      </>
    )
  }
  if (feed.isError) {
    return (
      <>
        {title}
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      </>
    )
  }

  const entries = [...feed.data.entries].sort((a, b) => at(b) - at(a))
  if (entries.length === 0) {
    return (
      <>
        {title}
        <EmptyState
          title="Belum ada aktivitas"
          description="Poin yang masuk dan yang kamu tukar akan muncul di sini."
        />
      </>
    )
  }

  const days: { key: string; label: string; entries: PointsEntry[] }[] = []
  for (const entry of entries) {
    const k = dayKey(entry.created_at)
    const last = days.at(-1)
    if (last?.key === k) last.entries.push(entry)
    else days.push({ key: k, label: dayLabel(entry.created_at), entries: [entry] })
  }

  let index = 0
  return (
    <>
      {title}
      <div className="flex flex-col gap-5">
        {days.map((day) => (
          <section key={day.key} className="flex flex-col gap-2">
            <h2 className="px-1 text-nav font-semibold text-ink">{day.label}</h2>
            <ListGroup>
              {day.entries.map((entry) => {
                const fresh = seenBefore !== null && at(entry) > seenBefore
                return (
                  <Row
                    key={entry.entry_id}
                    entry={entry}
                    fresh={fresh}
                    // The first screenful cascades in; anything below the
                    // fold simply appears.
                    order={Math.min(index++, 8)}
                  />
                )
              })}
            </ListGroup>
          </section>
        ))}
      </div>
    </>
  )
}

function Row({ entry, fresh, order }: { entry: PointsEntry; fresh: boolean; order: number }) {
  const kind = KIND[entry.entry_type] ?? FALLBACK
  const positive = entry.points > 0
  const body = (
    <>
      <span className="relative shrink-0">
        <MattePicture art={kind.art} tone={kind.tone} />
        {fresh && (
          <span
            aria-label="Baru"
            className="absolute -top-0.5 right-0 size-3 rounded-full border-2 border-canvas bg-accent"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-metric font-medium text-ink">{kind.title}</span>
        <span className="block text-meta text-body">{timeOfDay(entry.created_at)}</span>
      </span>
      <span
        className={cn(
          "num shrink-0 text-metric font-semibold",
          positive ? "text-ok-fg" : "text-ink",
        )}
      >
        {positive ? "+" : "−"}
        {units(Math.abs(entry.points))}
      </span>
    </>
  )
  const classes =
    "rise flex items-center gap-3 rounded-inner px-3 py-2.5 transition-colors duration-[var(--t-hover)] ease-[var(--ease-out)]"
  const style = { "--i": order } as React.CSSProperties
  if (entry.sale_id != null) {
    return (
      <Link
        to="/riwayat/$saleId"
        params={{ saleId: entry.sale_id }}
        className={cn(classes, "active:bg-soft-2")}
        style={style}
      >
        {body}
      </Link>
    )
  }
  return (
    <div className={classes} style={style}>
      {body}
    </div>
  )
}
