import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  Flag,
  Gift,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  type LucideIcon,
} from "lucide-react"

import { ScreenTitle } from "@/components/app-shell"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ListGroup } from "@/components/ui/list"
import { dayKey, dayLabel, timeOfDay } from "@/lib/dates"
import { units } from "@/lib/money"
import { at, markSeen, newest, readSeen, usePointsFeed } from "@/lib/points-feed"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import type { PointsEntry } from "@/lib/api"

/// What each kind of ledger line means to the person whose points they are.
const KIND: Record<string, { icon: LucideIcon; title: string; tone: "ok" | "ink" | "mute" }> = {
  EARN: { icon: Sparkles, title: "Poin dari belanja", tone: "ok" },
  REDEEM_TO_VOUCHER: { icon: Gift, title: "Ditukar jadi voucher", tone: "ink" },
  VOID_REVERSAL: { icon: Undo2, title: "Belanja dibatalkan toko", tone: "mute" },
  RETURN_REVERSAL: { icon: Undo2, title: "Barang dikembalikan", tone: "mute" },
  ADJUSTMENT: { icon: SlidersHorizontal, title: "Penyesuaian dari toko", tone: "mute" },
  OPENING: { icon: Flag, title: "Saldo awal", tone: "mute" },
}

const FALLBACK = { icon: SlidersHorizontal, title: "Perubahan poin", tone: "mute" as const }

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
      <span
        className={cn(
          "relative flex size-11 shrink-0 items-center justify-center rounded-full",
          kind.tone === "ok" ? "bg-ok-bg" : kind.tone === "ink" ? "bg-ink" : "bg-soft-2",
        )}
      >
        <kind.icon
          className={cn(
            "size-[1.125rem]",
            kind.tone === "ok" ? "text-ok" : kind.tone === "ink" ? "text-on-dark" : "text-mute",
          )}
          strokeWidth={2}
        />
        {fresh && (
          <span
            aria-label="Baru"
            className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-canvas bg-accent"
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
    "rise flex items-center gap-3.5 rounded-inner px-3 py-3 transition-colors duration-[var(--t-hover)] ease-[var(--ease-out)]"
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
