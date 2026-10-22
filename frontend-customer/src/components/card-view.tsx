import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowLeft, Barcode as BarcodeIcon, CreditCard } from "lucide-react"

import { MemberCard, type MemberCardHandle } from "@/components/member-card"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { cacheKey, pointsAccount } from "@/lib/api"
import { EASE_OUT } from "@/lib/motion"
import { units } from "@/lib/money"
import { useSession } from "@/lib/session"

const JOINED = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })

/// The card, presented.
///
/// This is the screen a shopper holds up at the counter, so it is built for
/// that moment: the card large and alone under a white spotlight on the matte
/// ground, with nothing
/// else in the cashier's eyeline, and a single action that turns it over to
/// the barcode.
/// The card can also be turned by hand: drag it, or flick it.
export function CardView() {
  const { member } = useSession()
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const reduce = useReducedMotion()
  const card = useRef<MemberCardHandle>(null)
  const [back, setBack] = useState(false)

  const balance = useQuery({
    queryKey: cacheKey.points(),
    queryFn: ({ signal }) => pointsAccount(signal),
  })

  const leave = () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: "/" })
  }

  return (
    <div className="stage fixed inset-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[30rem] flex-col px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <header className="flex items-center justify-between">
          <Chip aria-label="Kembali" onClick={leave}>
            <ArrowLeft />
          </Chip>
          <p className="text-appbar font-semibold text-ink">Kartu member</p>
          <span className="size-11" aria-hidden />
        </header>

        <div className="relative flex flex-1 flex-col justify-center py-8">
          {/* The card brings its own contact shadow (`.card-floor`). */}
          <motion.div layoutId="member-card" className="relative">
            <MemberCard
              ref={card}
              memberId={member.member_id}
              name={member.display_name}
              since={member.joined_on}
              pose="stage"
              flippable
              onFlipChange={setBack}
            />
          </motion.div>
          <p className="mt-5 text-center text-meta text-mute">
            Ketuk tombol atau geser kartunya untuk membalik
          </p>
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-headline font-semibold text-ink">
            {member.display_name?.trim() || "Member Central"}
          </p>
          <p className="text-meta text-body">
            Member sejak {JOINED.format(new Date(member.joined_on))}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 rounded-card bg-canvas py-4 shadow-soft">
          <div className="flex flex-col items-center gap-0.5 border-r border-hairline">
            <p className="text-meta text-body">Saldo poin</p>
            <p className="num text-kpi font-semibold text-ink">
              {balance.data === undefined
                ? "…"
                : units(balance.data.balance_points ?? 0)}
            </p>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <p className="text-meta text-body">Nomor member</p>
            <p className="font-mono text-metric font-medium tracking-[0.12em] text-ink uppercase">
              {member.member_id}
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="lg"
          block
          className="mt-4"
          onClick={() => card.current?.flip()}
        >
          {/* The label swaps with a short blur-crossfade so the two words read
              as one control changing its mind, not two labels overlapping. */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={back ? "front" : "barcode"}
              initial={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)", y: 6 }}
              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)", y: -6 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="inline-flex items-center gap-2"
            >
              {back ? <CreditCard /> : <BarcodeIcon />}
              {back ? "Lihat depan kartu" : "Tampilkan barcode"}
            </motion.span>
          </AnimatePresence>
        </Button>
        <p className="mt-3 text-center text-meta text-body">
          Pindai di kasir toko mana pun — poinnya masuk ke kartu ini.
        </p>
      </div>
    </div>
  )
}
