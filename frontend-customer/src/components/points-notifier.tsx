import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import { cacheKey } from "@/lib/api"
import { units } from "@/lib/money"
import { at, markSeen, newest, readSeen, usePointsFeed } from "@/lib/points-feed"
import { useSession } from "@/lib/session"
import type { PointsEntry } from "@/lib/api"

/// Tells the member when points arrive.
///
/// Two moments, and they are different sentences:
///   - **opening the app** after points came in while it was closed — one
///     toast summing everything new since this phone last showed activity;
///   - **while the app is open** (standing at the counter, the sale just rung
///     up) — a toast per arrival, the moment the centre accepts the sale.
///
/// Only EARN entries toast. A redemption the member asked for themselves, or a
/// reversal, is on the activity screen (the bell), but interrupting someone to
/// tell them about something they just did is noise.
///
/// Sonner does the presenting — enter from the top on its own `ease` curve,
/// swipe to dismiss with velocity, timers paused while the tab is hidden —
/// which is the component these motion rules were written for.
export function PointsNotifier() {
  const { member } = useSession()
  const navigate = useNavigate()
  const client = useQueryClient()
  const feed = usePointsFeed()
  // Where the member is, read by the effect below without re-running it: on
  // the activity list itself a toast would announce the rows already in view.
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const onActivity = useRef(pathname === "/notifikasi")
  useEffect(() => {
    onActivity.current = pathname === "/notifikasi"
  }, [pathname])
  // Every entry already accounted for this session. Null until the first
  // read, which is when the baseline is taken.
  const known = useRef<Set<string> | null>(null)

  useEffect(() => {
    const entries = feed.data?.entries
    if (entries === undefined) return
    const id = member.member_id

    const show = (earned: readonly PointsEntry[], sinceOpen: boolean) => {
      if (earned.length === 0 || onActivity.current) return
      const points = earned.reduce((sum, entry) => sum + entry.points, 0)
      const saleId = earned.length === 1 ? (earned[0].sale_id ?? null) : null
      // A single short tick on phones that have one — the same frame as the
      // toast, so the two read as one event (causality, harmony).
      if (!sinceOpen) navigator.vibrate?.(12)
      toast.custom(
        (toastId) => (
          <PointsToast
            points={points}
            count={earned.length}
            sinceOpen={sinceOpen}
            onOpen={() => {
              toast.dismiss(toastId)
              if (saleId !== null) {
                void navigate({ to: "/riwayat/$saleId", params: { saleId } })
              } else {
                void navigate({ to: "/notifikasi" })
              }
            }}
          />
        ),
        { duration: 6000 },
      )
    }

    if (known.current === null) {
      known.current = new Set(entries.map((entry) => entry.entry_id))
      const seen = readSeen(id)
      if (seen === null) {
        // First time on this phone: start the clock here rather than call a
        // year of history new.
        markSeen(id, newest(entries))
        return
      }
      show(
        entries.filter((entry) => entry.entry_type === "EARN" && at(entry) > seen),
        true,
      )
      return
    }

    const arrived = entries.filter((entry) => !known.current!.has(entry.entry_id))
    arrived.forEach((entry) => known.current!.add(entry.entry_id))
    if (arrived.length > 0) {
      // The ledger moved, so the purchase behind it has landed too: the
      // totals and the history are stale the moment the points arrive.
      void client.invalidateQueries({ queryKey: cacheKey.summary() })
      void client.invalidateQueries({ queryKey: cacheKey.transactions() })
    }
    show(
      arrived.filter((entry) => entry.entry_type === "EARN"),
      false,
    )
  }, [client, feed.data, member.member_id, navigate])

  return null
}

function PointsToast({
  points,
  count,
  sinceOpen,
  onOpen,
}: {
  points: number
  count: number
  sinceOpen: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-[1.25rem] bg-canvas px-3.5 py-3 text-left shadow-[0_2px_8px_rgb(0_0_0/0.06),0_16px_40px_rgb(0_0_0/0.12)]"
    >
      <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-ok-bg">
        <Sparkles className="size-5 text-ok" strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-metric font-semibold text-ink">
          +{units(points)} poin masuk
        </span>
        <span className="block truncate text-meta text-body">
          {sinceOpen
            ? count > 1
              ? `Dari ${count} belanja sejak terakhir buka`
              : "Dari belanja terakhir kamu"
            : "Dari belanja barusan"}
          {" · ketuk untuk lihat"}
        </span>
      </span>
    </button>
  )
}
