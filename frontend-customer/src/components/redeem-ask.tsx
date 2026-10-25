import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Clock } from "lucide-react"

import { MattePicture } from "@/components/matte"
import { Spinner } from "@/components/spinner"
import { SuccessMark } from "@/components/success-mark"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cacheKey, member } from "@/lib/api"
import { mmss, secondsUntil, useNow } from "@/lib/countdown"
import { EASE_OUT } from "@/lib/motion"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { RedeemRequest } from "@itulah/contract"

/// Where a cashier's ask to spend points is answered.
///
/// The cashier decides how many points; the shopper only says yes or no. One
/// card carries the whole question — who asks, how many points, what they are
/// worth, how long the question stays open — and the two answers under it.
/// The same card sits on Beranda and on Tukar, so a shopper who opens the app
/// at the till can answer without finding a screen first.
///
/// This component does not ask the server whether there is an ask: its caller
/// does (`useLiveAsk`), once, and hands the answer down.

type Answer = { request: RedeemRequest; approve: boolean }

export function AskPanel({
  ask,
  idle,
  className,
}: {
  /// The ask waiting on an answer, if there is one.
  ask: RedeemRequest | undefined
  /// What to show when there is nothing to answer. Left out where silence is
  /// the right amount of interface (Beranda).
  idle?: React.ReactNode
  /// Placed on whichever card is showing, so the gap above it exists only
  /// when the card does.
  className?: string
}) {
  const client = useQueryClient()

  const answer = useMutation({
    mutationFn: ({ request, approve }: Answer) =>
      approve
        ? member.approveRedeemRequest(request.request_id)
        : member.declineRedeemRequest(request.request_id),
    onSuccess: (request) => {
      void client.invalidateQueries({ queryKey: cacheKey.redeemRequests() })
      if (request.status === "CONFIRMED") {
        // The points are spent: the balance and the home figures moved.
        void client.invalidateQueries({ queryKey: cacheKey.points() })
        void client.invalidateQueries({ queryKey: cacheKey.summary() })
      }
    },
    // A refusal means the world moved on (cancelled, expired, already spent):
    // read it again, and the card goes if it should.
    onError: () => void client.invalidateQueries({ queryKey: cacheKey.redeemRequests() }),
  })

  // What this phone answered last. The list takes a moment to catch up, so
  // the card that was just answered must not come back in the meantime.
  const answered = answer.data
  const open = ask !== undefined && ask.request_id !== answered?.request_id ? ask : undefined
  const spent = answered?.status === "CONFIRMED" ? answered : undefined

  // Only the card that was answered shows how the answering went: an error
  // from the last ask must not greet the next one.
  const here = open !== undefined && answer.variables?.request.request_id === open.request_id
  const pending = answer.isPending && here ? (answer.variables.approve ? "approve" : "decline") : null
  const problem = answer.isError && here ? answerProblem(answer.error, answer.variables.approve) : null

  // The one slot trades its content: the outgoing card leaves quickly, the
  // incoming one arrives — exit faster than enter, so it never holds two.
  return (
    <AnimatePresence mode="wait" initial={false}>
      {open !== undefined ? (
        <Slide key={`ask-${open.request_id}`} className={className}>
          <AskCard
            request={open}
            pending={pending}
            problem={problem}
            onAnswer={(approve) => answer.mutate({ request: open, approve })}
          />
        </Slide>
      ) : spent !== undefined ? (
        <Slide key={`spent-${spent.request_id}`} className={className}>
          <SpentCard request={spent} onDone={answer.reset} />
        </Slide>
      ) : idle !== undefined ? (
        <Slide key="idle" className={className}>
          {idle}
        </Slide>
      ) : null}
    </AnimatePresence>
  )
}

function Slide({ className, children }: { className?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ duration: 0.26, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/// A refusal, turned into a sentence the shopper can act on.
function answerProblem(error: unknown, approve: boolean): string {
  const status = error instanceof ApiError ? error.status : 0
  if (status === 409) {
    return approve
      ? "Penukaran ini sudah tidak berlaku, atau poin kamu tidak cukup."
      : "Poin ini sudah ditukar."
  }
  if (status === 404) return "Permintaan ini tidak ditemukan."
  if (status === 0 || status >= 500) return "Server sedang bermasalah. Coba lagi sebentar lagi."
  return "Belum bisa diproses sekarang."
}

/// The question itself.
function AskCard({
  request,
  pending,
  problem,
  onAnswer,
}: {
  request: RedeemRequest
  pending: "approve" | "decline" | null
  problem: string | null
  onAnswer: (approve: boolean) => void
}) {
  const now = useNow()
  const remaining = secondsUntil(request.expires_at, now)
  // The ask's whole life, and how much of it is already gone, for the line.
  // Read once: the line is a clock and must not restart on a re-render.
  const lifetime = Math.max(
    1,
    (Date.parse(request.expires_at) - Date.parse(request.requested_at)) / 1000,
  )
  const [elapsed] = useState(() =>
    Math.min(lifetime, Math.max(0, (Date.now() - Date.parse(request.requested_at)) / 1000)),
  )

  const store = request.store_name?.trim() || "Kasir"
  const busy = pending !== null || remaining === 0

  return (
    <Card
      role="group"
      aria-label={`${store} meminta tukar ${units(request.points)} poin`}
      className="px-5 pt-5 pb-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-metric text-body">
            <span className="font-semibold text-ink">{store}</span> meminta tukar
          </p>
          <p className="num mt-1.5 flex items-baseline gap-2">
            <span className="text-display font-semibold text-ink">{units(request.points)}</span>
            <span className="text-headline font-semibold text-mute">poin</span>
          </p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-nav text-body">senilai</span>
            <span className="num text-hero font-semibold text-matte-foot">
              {money(request.value_minor)}
            </span>
          </p>
        </div>
        <MattePicture art="gift" size={56} className="shrink-0" />
      </div>

      {/* The question's life as a draining line. Linear — it is a clock —
          and a transform, so it costs nothing while it runs. */}
      <div className="mt-5 flex items-center gap-3">
        <span
          className={cn(
            "num flex shrink-0 items-center gap-1.5 text-meta font-medium",
            remaining < 60 ? "text-bad-fg" : "text-body",
          )}
        >
          <Clock aria-hidden className="size-4" />
          {mmss(remaining)}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-matte-ground-2">
          <div
            className="h-full origin-left rounded-full bg-matte-foot"
            style={{
              animation: `drain ${lifetime}s linear both`,
              animationDelay: `-${elapsed}s`,
            }}
          />
        </div>
      </div>

      {problem !== null && (
        <p role="alert" className="mt-4 text-meta font-medium text-bad-fg">
          {problem}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" className="px-4" disabled={busy} onClick={() => onAnswer(false)}>
          {pending === "decline" && <Spinner />}
          {pending === "decline" ? "Menolak…" : "Tolak"}
        </Button>
        <Button variant="primary" size="lg" className="px-4" disabled={busy} onClick={() => onAnswer(true)}>
          {pending === "approve" && <Spinner />}
          {pending === "approve" ? "Menukar…" : "Setujui"}
        </Button>
      </div>
    </Card>
  )
}

/// The points went — here, or because the shopper read the code back instead.
function SpentCard({ request, onDone }: { request: RedeemRequest; onDone: () => void }) {
  const reduce = useReducedMotion()
  return (
    <Card className="flex flex-col items-center px-6 py-8 text-center">
      <SuccessMark />
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.25, ease: EASE_OUT }}
        className="mt-5 flex flex-col items-center"
      >
        <p className="text-hero font-semibold text-ink">Poin ditukar</p>
        <p className="num mt-1 text-title font-semibold text-matte-foot">
          {money(request.value_minor)}
        </p>
        <p className="num mt-1 text-nav text-body">{units(request.points)} poin</p>
      </motion.div>
      <Button variant="secondary" className="mt-6" onClick={onDone}>
        Selesai
      </Button>
    </Card>
  )
}
