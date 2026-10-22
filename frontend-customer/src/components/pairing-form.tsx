import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ArrowLeft } from "lucide-react"

import { CentralMark, MattePicture, type MatteArt } from "@/components/matte"
import { MemberCard } from "@/components/member-card"
import { SuccessMark } from "@/components/success-mark"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { CodeInput } from "@/components/ui/code-boxes"
import { Input } from "@/components/ui/input"
import { cacheKey, member } from "@/lib/api"
import { EASE_DRAWER, EASE_OUT } from "@/lib/motion"
import { useNodeIdentity } from "@/lib/session"
import { ApiError } from "@itulah/contract/client"
import type { MemberSessionResponse } from "@itulah/contract"

/// Connecting a phone to a card — three short scenes.
///
/// 1. **Welcome**: what this is, with the card itself as the picture.
/// 2. **Connect**: the card number and six digits the cashier reads out. That
///    pair proves what matters — the card is in this person's hand, in the
///    shop, in front of an employee. Deliberately not a code sent to a phone
///    number: prepaid numbers here change hands and get recycled, and whoever
///    inherits one would inherit the previous holder's history.
/// 3. **You're in**: a moment to mark it, once. The session is already set;
///    the app opens when they press on.
///
/// Registering is done at the till, not here — the cashier enrols the card and
/// hands over the code in the same breath, so "daftar" and "hubungkan" are one
/// visit to a counter.
export function PairingForm() {
  const client = useQueryClient()
  const reduce = useReducedMotion()
  const [scene, setScene] = useState<"welcome" | "connect" | "done">("welcome")
  const [paired, setPaired] = useState<MemberSessionResponse | null>(null)

  const enter = () => {
    if (paired !== null) client.setQueryData(cacheKey.me(), paired.member)
  }

  // Scenes slide the way iOS pushes: forward from the right, back to the
  // right, on the drawer curve. Exit is faster than enter.
  const variants = {
    enter: (forward: boolean) =>
      reduce ? { opacity: 0 } : { opacity: 0, x: forward ? "8%" : "-8%" },
    center: { opacity: 1, x: "0%" },
    leave: (forward: boolean) =>
      reduce ? { opacity: 0 } : { opacity: 0, x: forward ? "-6%" : "6%" },
  }
  const forward = scene !== "welcome"

  return (
    <main className="min-h-svh overflow-hidden bg-backdrop">
      <AnimatePresence mode="wait" custom={forward} initial={false}>
        <motion.div
          key={scene}
          custom={forward}
          variants={variants}
          initial="enter"
          animate="center"
          exit="leave"
          transition={{ duration: 0.32, ease: EASE_DRAWER }}
          className="mx-auto flex min-h-svh w-full max-w-[30rem] flex-col px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        >
          {scene === "welcome" && <Welcome onStart={() => setScene("connect")} />}
          {scene === "connect" && (
            <Connect
              onBack={() => setScene("welcome")}
              onPaired={(session) => {
                setPaired(session)
                setScene("done")
              }}
            />
          )}
          {scene === "done" && <Done name={paired?.member.display_name ?? null} onEnter={enter} />}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}

/// What connecting a card gives, each beside its matte picture.
const PROMISES: ReadonlyArray<{ art: MatteArt; text: string }> = [
  { art: "spark", text: "Poin dari setiap belanja, di toko Central mana pun" },
  { art: "store", text: "Riwayat belanja dan struk, selalu ada" },
]

function Welcome({ onStart }: { onStart: () => void }) {
  const reduce = useReducedMotion()
  return (
    <>
      <div className="flex items-center gap-2 pt-1">
        <CentralMark className="size-9" />
        <span className="text-card-title font-semibold tracking-[-0.02em] text-ink">Central</span>
      </div>

      {/* The card, fanned: two blanks behind the member's, the way cards
          sit in a wallet. They arrive one after another (60ms), settling into
          the fan rather than being dealt out of nowhere. */}
      <div className="panel-soft relative mt-6 flex aspect-[1.1] w-full items-center justify-center overflow-hidden rounded-shell">
        {[
          { rotate: -16, x: "-18%", y: "6%", delay: 0 },
          { rotate: -6, x: "-8%", y: "2%", delay: 0.06 },
        ].map((blank, index) => (
          <motion.div
            key={index}
            aria-hidden
            initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: blank.rotate + 10, y: 40 }}
            animate={{ opacity: 1, rotate: blank.rotate, x: blank.x, y: blank.y }}
            transition={{ type: "spring", duration: 0.8, bounce: 0, delay: blank.delay }}
            className={
              index === 0
                ? "card-matte absolute aspect-[1.586] w-[62%] rounded-member-card opacity-45"
                : "card-matte absolute aspect-[1.586] w-[62%] rounded-member-card opacity-70"
            }
          />
        ))}
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: 18, y: 60 }}
          animate={{ opacity: 1, rotate: 6, y: "-4%", x: "8%" }}
          transition={{ type: "spring", duration: 0.9, bounce: 0, delay: 0.12 }}
          className="absolute w-[66%]"
        >
          <MemberCard memberId="••••••" name="Nama kamu" since={null} />
        </motion.div>
      </div>

      <div className="mt-8 flex-1">
        <h1 className="text-title font-semibold text-ink">
          Kartu member kamu,
          <br />
          sekarang di ponsel.
        </h1>
        <ul className="mt-5 flex flex-col gap-3.5">
          {PROMISES.map((item) => (
            <li key={item.text} className="flex items-center gap-3">
              <MattePicture art={item.art} size={40} />
              <span className="text-nav text-text">{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <Button variant="primary" size="lg" block onClick={onStart}>
          Hubungkan kartu
        </Button>
        <p className="text-center text-meta text-body">
          Belum punya kartu? Minta kasir mendaftarkan kamu saat belanja —
          gratis, langsung jadi.
        </p>
      </div>
    </>
  )
}

function Connect({
  onBack,
  onPaired,
}: {
  onBack: () => void
  onPaired: (session: MemberSessionResponse) => void
}) {
  const where = useNodeIdentity()
  const [memberId, setMemberId] = useState("")
  const [code, setCode] = useState("")

  const pair = useMutation({
    mutationFn: () => member.pair(memberId.trim(), code.trim()),
    onSuccess: onPaired,
  })

  // Every failure is one status on purpose (the form must not reveal which
  // numbers are members), so it gets one sentence a shopper can act on.
  const status = pair.error instanceof ApiError ? pair.error.status : 0
  const problem =
    pair.error === null
      ? null
      : status === 401
        ? "Nomor member atau kodenya tidak cocok. Coba lagi, atau minta kode baru ke kasir."
        : status === 0 || status >= 500
          ? "Server sedang bermasalah. Coba lagi sebentar lagi."
          : "Belum bisa dihubungkan sekarang."

  const ready = memberId.trim() !== "" && code.length === 6

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) pair.mutate()
      }}
    >
      <div>
        <Chip aria-label="Kembali" onClick={onBack}>
          <ArrowLeft />
        </Chip>
      </div>
      <h1 className="mt-6 text-title font-semibold text-ink">Hubungkan kartu</h1>
      <p className="mt-2 text-nav text-body">
        Minta kodenya ke kasir. Kasir akan menyebutkan 6 angka.
      </p>

      <label htmlFor="member" className="mt-8 text-meta font-semibold text-text">
        Nomor member
      </label>
      <Input
        id="member"
        name="member"
        autoFocus
        required
        autoComplete="off"
        autoCapitalize="characters"
        // Not numeric-only: some card numbers carry a letter.
        inputMode="text"
        placeholder="Nomor di kartu kamu"
        className="mt-2 font-mono tracking-[0.08em] uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
        value={memberId}
        // Uppercased in the value, not only on screen: card numbers are
        // printed in capitals, and a lowercase "m-c1" would be a different
        // number to the server while looking identical to the shopper.
        onChange={(event) => setMemberId(event.target.value.toUpperCase())}
      />

      <label htmlFor="code" className="mt-6 text-meta font-semibold text-text">
        Kode dari kasir
      </label>
      <div className="mt-2">
        <CodeInput id="code" value={code} onChange={setCode} invalid={problem !== null && status === 401} />
      </div>
      <p
        role={problem !== null ? "alert" : undefined}
        className={
          problem !== null
            ? "mt-3 text-meta font-medium text-bad-fg"
            : "mt-3 text-meta text-body"
        }
      >
        {problem ?? "Berlaku 10 menit. Kalau kedaluwarsa, minta lagi ke kasir."}
      </p>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!ready || pair.isPending}
        >
          {pair.isPending && (
            <span
              aria-hidden
              className="size-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-[spin_0.7s_linear_infinite]"
            />
          )}
          {pair.isPending ? "Menghubungkan…" : "Hubungkan"}
        </Button>
        {where.data != null && (
          <p className="text-center text-meta text-faint">
            {where.data.node_id} · {where.data.node_role}
          </p>
        )}
      </div>
    </form>
  )
}

function Done({ name, onEnter }: { name: string | null; onEnter: () => void }) {
  const reduce = useReducedMotion()
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <SuccessMark />
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.25, ease: EASE_OUT }}
          className="mt-6"
        >
          <p className="text-title font-semibold text-ink">Kamu sudah terhubung!</p>
          <p className="mx-auto mt-2 max-w-[17rem] text-nav text-body">
            {name?.trim() ? `Halo, ${name.trim()}. ` : ""}Poin dan riwayat
            belanja kamu sekarang ada di sini.
          </p>
        </motion.div>
      </div>
      <Button variant="primary" size="lg" block onClick={onEnter}>
        Mulai
      </Button>
    </div>
  )
}
