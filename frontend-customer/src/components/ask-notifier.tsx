import { useEffect, useRef } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { toast } from "sonner"

import { MattePicture } from "@/components/matte"
import { money, units } from "@/lib/money"
import { ASK_POLL_MS, useLiveAsk } from "@/lib/redeem-asks"

/// Tells the shopper a cashier is waiting on them — wherever they are in the app.
///
/// The ask has to find the shopper: at the till the phone is usually showing
/// the card's barcode (`/kartu`) or whatever tab was open last, and a card that
/// only exists on Tukar would sit unseen while the cashier waits. So this is
/// the one place that watches for asks all the time (the redeem screen, which
/// watches faster, takes over while it is open), and the answer to "where do I
/// say yes" is a toast that stays until the ask is answered or runs out.
///
/// Tapping it opens Tukar, where the card is. On Beranda and Tukar themselves
/// the card is already on screen, so nothing is raised on top of it.
export function AskNotifier() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const cardShown = pathname === "/" || pathname === "/tukar-poin"

  // Exactly one poller: the redeem screen asks for itself, faster.
  const { ask } = useLiveAsk(pathname === "/tukar-poin" ? false : ASK_POLL_MS)

  // The primitives, not the ask: a poll hands back a new object for the same
  // question every few seconds, and the toast must not be rebuilt each time.
  const requestId = ask?.request_id
  const store = ask?.store_name?.trim() || "Kasir"
  const points = ask?.points
  const value = ask?.value_minor
  // One tick per ask, not one per time the toast comes back after a visit to
  // Beranda.
  const buzzed = useRef<string | null>(null)

  useEffect(() => {
    if (requestId === undefined || points === undefined || value === undefined || cardShown) {
      return
    }
    if (buzzed.current !== requestId) {
      buzzed.current = requestId
      navigator.vibrate?.([12, 60, 12])
    }
    toast.custom(
      (toastId) => (
        <AskToast
          store={store}
          points={points}
          value={value}
          onOpen={() => {
            toast.dismiss(toastId)
            void navigate({ to: "/tukar-poin" })
          }}
        />
      ),
      { id: `ask-${requestId}`, duration: Infinity },
    )
    // Gone with the ask — answered, withdrawn or out of time — and gone when
    // the card itself comes on screen.
    return () => {
      toast.dismiss(`ask-${requestId}`)
    }
  }, [requestId, store, points, value, cardShown, navigate])

  return null
}

function AskToast({
  store,
  points,
  value,
  onOpen,
}: {
  store: string
  points: number
  value: number
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-[1.25rem] bg-canvas px-3.5 py-3 text-left shadow-[0_2px_8px_rgb(0_0_0/0.06),0_16px_40px_rgb(0_0_0/0.12)]"
    >
      <MattePicture art="gift" />
      <span className="min-w-0 flex-1">
        <span className="block text-metric font-semibold text-ink">
          {store} meminta tukar {units(points)} poin
        </span>
        <span className="block text-meta text-body">
          <span className="num">{money(value)}</span>
          {" · ketuk untuk menjawab"}
        </span>
      </span>
    </button>
  )
}
