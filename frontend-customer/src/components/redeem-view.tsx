import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Clock } from "lucide-react"

import { ScreenTitle } from "@/components/app-shell"
import { NumberTicker } from "@/components/motion/number-ticker"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { SuccessMark } from "@/components/success-mark"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CodeDisplay } from "@/components/ui/code-boxes"
import { ListGroup, ListRow } from "@/components/ui/list"
import { Pill } from "@/components/ui/pill"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, member, pointsAccount } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { EASE_OUT } from "@/lib/motion"
import { units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import type { IssuedRedeemRequest, RedeemRequest } from "@itulah/contract"

/// Points redemption: a balance, a request, and the request's own history.
///
/// Redeeming is pairing from the other side. Pairing proves to the app that a
/// card is in a shopper's hand at a counter (`pairing-form.tsx`); the code
/// here proves to a cashier that the shopper is holding the phone that just
/// asked. Six digits, ten minutes, read aloud — never copied to a clipboard.
///
/// The rate — how many points buy how much — is decided once, at the centre,
/// when the cashier confirms (`postgres/loyalty.rs::confirm_redeem_request`).
/// Nothing on this screen states one, because nothing here decides one.

const STATUS_LABEL: Record<RedeemRequest["status"], string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Ditukar",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
}

const STATUS_TONE: Record<RedeemRequest["status"], "warn" | "ok" | "bad" | "soft"> = {
  PENDING: "warn",
  CONFIRMED: "ok",
  EXPIRED: "soft",
  CANCELLED: "soft",
}

/// How often a screen with a live code asks whether the cashier has used it.
const WATCH_MS = 3_000

/// Quick amounts. Only the ones the balance can cover are offered.
const PRESETS = [25, 50, 100, 250] as const

/// A chosen amount: the pastel ground with a ring of the matte blue.
const CHOSEN = "bg-matte-ground text-matte-foot shadow-[inset_0_0_0_2px_var(--m-foot)]"

const step = (index: number) => ({ "--i": index }) as React.CSSProperties

function relativeLabel(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return "Baru saja"
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} hari lalu`
  return shortDate(iso)
}

/// Counted down rather than stated as a time: the question at a counter is
/// "have I still got it", and subtracting a clock in your head is how that
/// answer arrives wrong while a cashier waits.
function useRemainingSeconds(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))
}

function mmss(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

export function RedeemView() {
  const client = useQueryClient()
  const reduce = useReducedMotion()
  const [amount, setAmount] = useState("")
  // Held here rather than read back from the history list: a history read
  // never repeats a code once minted, so the moment a request is created is
  // the only moment this screen will ever see it.
  const [issued, setIssued] = useState<IssuedRedeemRequest | null>(null)

  // While a code is on screen the shopper is standing at a counter, and the
  // cashier confirming it happens on another machine. Nothing tells this
  // phone, so it asks — every few seconds, and only while a code is showing.
  const watching = issued !== null
  const balance = useQuery({
    queryKey: cacheKey.points(),
    queryFn: ({ signal }) => pointsAccount(signal),
    refetchInterval: watching ? WATCH_MS : false,
  })
  const history = useQuery({
    queryKey: cacheKey.redeemRequests(),
    queryFn: ({ signal }) => member.redeemRequests(signal),
    refetchInterval: watching ? WATCH_MS : false,
  })
  const issuedStatus =
    issued === null
      ? undefined
      : history.data?.find((request) => request.request_id === issued.request_id)
          ?.status

  // A confirmation moves the balance and the home screen's figures with it.
  const confirmed = useRef(false)
  useEffect(() => {
    if (issuedStatus === "CONFIRMED" && !confirmed.current) {
      confirmed.current = true
      void client.invalidateQueries({ queryKey: cacheKey.summary() })
    }
    if (issuedStatus !== "CONFIRMED") confirmed.current = false
  }, [client, issuedStatus])

  const ask = useMutation({
    mutationFn: (points: number) => member.createRedeemRequest(points),
    onSuccess: (request) => {
      setIssued(request)
      setAmount("")
      void client.invalidateQueries({ queryKey: cacheKey.points() })
      void client.invalidateQueries({ queryKey: cacheKey.redeemRequests() })
    },
  })

  const available =
    balance.data === undefined ? undefined : (balance.data.balance_points ?? 0)
  const amountValue = Number(amount)
  const overBalance =
    amount !== "" && available !== undefined && amountValue > available
  const ready =
    amount !== "" &&
    Number.isInteger(amountValue) &&
    amountValue > 0 &&
    !overBalance &&
    available !== undefined

  const askStatus = ask.error instanceof ApiError ? ask.error.status : 0
  const askProblem =
    ask.error === null
      ? null
      : askStatus === 409
        ? "Masih ada penukaran yang menunggu kasir. Selesaikan dulu, atau tunggu sampai kedaluwarsa."
        : askStatus === 0 || askStatus >= 500
          ? "Server sedang bermasalah. Coba lagi sebentar lagi."
          : "Permintaan belum bisa diproses sekarang."

  return (
    <div className="flex flex-col">
      <ScreenTitle>Tukar poin</ScreenTitle>

      <Card className="rise flex flex-col px-5 py-5" style={step(0)}>
        <p className="text-nav text-body">Poin yang bisa ditukar</p>
        <div className="mt-1 flex min-h-[3.5rem] items-baseline gap-2">
          {balance.isError ? (
            <p className="text-body">Saldo belum bisa ditampilkan.</p>
          ) : available === undefined ? (
            <Skeleton className="h-12 w-32" />
          ) : (
            <>
              <NumberTicker
                value={available}
                format={units}
                className="text-display font-semibold text-ink"
              />
              <span className="text-headline font-semibold text-mute">poin</span>
            </>
          )}
        </div>
      </Card>

      <div className="rise mt-4" style={step(1)}>
        {/* The form and the code occupy the same place and trade it: the
            outgoing one leaves quickly, the incoming one arrives — exit
            faster than enter, so the screen never holds both. */}
        <AnimatePresence mode="wait" initial={false}>
          {issued !== null ? (
            <motion.div
              key={`code-${issued.request_id}-${issuedStatus === "CONFIRMED" ? "done" : "live"}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
              transition={{ duration: 0.26, ease: EASE_OUT }}
            >
              <RedeemCode
                request={issued}
                status={issuedStatus}
                onReset={() => setIssued(null)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
              transition={{ duration: 0.26, ease: EASE_OUT }}
            >
              <Card className="px-5 pt-5 pb-5">
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (ready) ask.mutate(amountValue)
                  }}
                  className="flex flex-col"
                >
                  <label htmlFor="redeem-amount" className="text-center text-meta text-body">
                    Mau tukar berapa poin?
                  </label>
                  <div className="mt-1 flex items-baseline justify-center gap-2">
                    <input
                      id="redeem-amount"
                      name="amount"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="0"
                      value={amount === "" ? "" : units(amountValue)}
                      onChange={(event) =>
                        setAmount(event.target.value.replace(/\D/g, "").slice(0, 7))
                      }
                      className={cn(
                        "num min-w-0 bg-transparent text-right text-[3rem] leading-tight font-semibold tracking-[-0.04em] caret-accent outline-none placeholder:text-faint",
                        overBalance ? "text-bad-fg" : "text-ink",
                      )}
                      // Exactly as wide as what is typed, so "poin" sits right
                      // after the figure the way it does under the balance.
                      style={{ width: `${(amount === "" ? 1 : units(amountValue).length) + 0.15}ch` }}
                    />
                    <span className="text-headline font-semibold text-mute">poin</span>
                  </div>

                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {PRESETS.filter((preset) => available !== undefined && preset <= available).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAmount(String(preset))}
                        className={cn(
                          "press h-10 rounded-full px-4 text-meta font-semibold",
                          amountValue === preset ? CHOSEN : "bg-soft-2 text-ink",
                        )}
                      >
                        {units(preset)}
                      </button>
                    ))}
                    {available !== undefined && available > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(String(available))}
                        className={cn(
                          "press h-10 rounded-full px-4 text-meta font-semibold",
                          amountValue === available ? CHOSEN : "bg-soft-2 text-ink",
                        )}
                      >
                        Semua
                      </button>
                    )}
                  </div>

                  <p
                    role={overBalance || askProblem !== null ? "alert" : undefined}
                    className={cn(
                      "mt-4 min-h-[2.5rem] text-center text-meta",
                      overBalance || askProblem !== null ? "font-medium text-bad-fg" : "text-body",
                    )}
                  >
                    {overBalance
                      ? "Poin kamu tidak cukup untuk jumlah ini."
                      : (askProblem ??
                        "Kamu akan dapat kode 6 angka. Tunjukkan ke kasir, dan kasir menukarnya jadi voucher belanja.")}
                  </p>

                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    block
                    className="mt-2"
                    disabled={!ready || ask.isPending}
                  >
                    {ask.isPending ? <Spinner /> : null}
                    {ask.isPending ? "Membuat kode…" : "Buat kode penukaran"}
                  </Button>
                </form>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section aria-labelledby="riwayat-penukaran" className="rise mt-8 flex flex-col gap-2.5" style={step(2)}>
        <h2 id="riwayat-penukaran" className="px-1 text-headline font-semibold text-ink">
          Riwayat penukaran
        </h2>
        {history.isPending ? (
          <LoadingRows rows={2} />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data.length === 0 ? (
          <EmptyState
            title="Belum ada penukaran"
            description="Setiap kode yang kamu buat tercatat di sini, lengkap dengan statusnya."
          />
        ) : (
          <ListGroup>
            {history.data.map((request) => (
              <ListRow
                key={request.request_id}
                art="gift"
                title={<span className="num">{units(request.points)} poin</span>}
                description={relativeLabel(request.requested_at)}
                trailing={<Pill tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Pill>}
              />
            ))}
          </ListGroup>
        )}
      </section>
    </div>
  )
}

/// The live code — or, once the cashier has used it, the confirmation.
function RedeemCode({
  request,
  status,
  onReset,
}: {
  request: IssuedRedeemRequest
  /// What became of it, as last read back. Undefined until the history has
  /// caught up with a request this screen only just made.
  status: RedeemRequest["status"] | undefined
  onReset: () => void
}) {
  const remaining = useRemainingSeconds(request.expires_at)
  // The full life of a code, for the bar. Read once: the bar is a clock and
  // must not restart when the component re-renders.
  const [lifetime] = useState(() =>
    Math.max(1, Math.round((Date.parse(request.expires_at) - Date.now()) / 1000)),
  )

  if (status === "CONFIRMED") {
    return (
      <Card className="flex flex-col items-center px-6 py-8 text-center">
        <SuccessMark />
        <p className="mt-5 text-hero font-semibold text-ink">Berhasil ditukar</p>
        <p className="mt-2 max-w-[17rem] text-nav text-body">
          {units(request.points)} poin sudah jadi voucher. Kasir langsung
          memakainya untuk pembayaranmu.
        </p>
        <Button variant="secondary" className="mt-6" onClick={onReset}>
          Selesai
        </Button>
      </Card>
    )
  }

  const dead = remaining === 0 || status === "EXPIRED" || status === "CANCELLED"

  return (
    <div className="flex flex-col items-center rounded-card bg-matte-ground px-4 pt-6 pb-5 text-center">
      <p className={cn("text-nav font-semibold", dead ? "text-mute" : "text-matte-foot")}>
        {dead ? "Kode tidak berlaku" : "Tunjukkan ke kasir"}
      </p>
      <div className="mt-4 w-full">
        <CodeDisplay code={request.code} dead={dead} />
      </div>

      {dead ? (
        <p className="mt-5 max-w-[17rem] text-meta text-bad-fg">
          Kode ini sudah tidak berlaku. Buat yang baru kalau masih mau menukar
          poin.
        </p>
      ) : (
        <>
          <p className="mt-5 text-nav text-text">
            <span className="num font-semibold text-ink">{units(request.points)} poin</span>
            {" · "}
            <span className={cn("num", remaining < 60 ? "text-bad-fg" : "text-body")}>
              <Clock className="mr-1 -mt-0.5 inline size-3.5" />
              {mmss(remaining)}
            </span>
          </p>
          {/* The code's life as a draining line. Linear — it is a clock —
              and a transform, so it costs nothing while it runs. */}
          <div className="mt-3 h-1 w-40 overflow-hidden rounded-full bg-matte-ground-2">
            <div
              className="h-full origin-left rounded-full bg-matte-foot"
              style={{
                animation: `drain ${lifetime}s linear both`,
                animationDelay: `-${lifetime - remaining}s`,
              }}
            />
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-meta text-mute">
            <Spinner tone="mute" />
            Menunggu kasir…
          </p>
        </>
      )}

      <Button variant="ghost" size="sm" className="mt-5" onClick={onReset}>
        {dead ? "Buat kode baru" : "Buat penukaran lain"}
      </Button>
    </div>
  )
}

/// A fast spinner makes waiting feel shorter than a slow one (Emil: perceived
/// performance). 700ms a turn, linear.
function Spinner({ tone = "on-dark" }: { tone?: "on-dark" | "mute" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-[spin_0.7s_linear_infinite]",
        tone === "mute" ? "text-mute" : "text-on-dark",
      )}
    />
  )
}
