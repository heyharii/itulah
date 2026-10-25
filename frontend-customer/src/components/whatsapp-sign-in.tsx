import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"

import { Spinner } from "@/components/spinner"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { CodeInput } from "@/components/ui/code-boxes"
import { Input } from "@/components/ui/input"
import { member } from "@/lib/api"
import { mmss, secondsUntil, useNow } from "@/lib/countdown"
import { ApiError } from "@itulah/contract/client"
import type { MemberSessionResponse, SentOtp } from "@itulah/contract"

/// Signing in with a code from WhatsApp — two scenes of `PairingForm`.
///
/// 1. **Phone**: the number the shopper gave the cashier when they registered.
/// 2. **Code**: the six digits head office's WhatsApp sent to it.
///
/// Nobody signs up here (owner, 25 Oct 2026: "register member hanya bisa via
/// kasir"). A number that is not a member is told so and sent nothing; the way
/// in for them is a till.

/// How long a sent code makes the shopper wait before asking for another.
/// Long enough that a code still on its way is not answered with a second one,
/// short enough that one which never came is not a dead end.
const RESEND_AFTER_S = 30

const SERVER_TROUBLE = "Server sedang bermasalah. Coba lagi sebentar lagi."

function statusOf(error: unknown): number {
  return error instanceof ApiError ? error.status : 0
}

/// Why a code could not be sent, as a sentence the shopper can act on.
function sendProblem(error: unknown): string {
  const status = statusOf(error)
  if (status === 404) return "Nomor ini belum terdaftar sebagai member. Daftar di kasir toko."
  if (status === 400) return "Masukkan nomor ponsel yang diawali 08."
  if (status === 422) return "Nomor ini tidak memakai WhatsApp. Minta kode ke kasir."
  if (status === 409) {
    // The server sends one status for several reasons and no machine-readable
    // code beside it, so the sentence is all there is to tell them apart: a
    // limit on this number or on WhatsApp itself, against head office's
    // WhatsApp not being connected at all.
    const reason = error instanceof Error ? error.message : ""
    return /hour|too many/i.test(reason)
      ? "Terlalu sering meminta kode. Coba lagi nanti."
      : "WhatsApp kantor pusat sedang tidak tersambung. Coba lagi nanti."
  }
  if (status === 0 || status >= 500) return SERVER_TROUBLE
  return "Kode belum bisa dikirim sekarang."
}

function signInProblem(error: unknown): string {
  const status = statusOf(error)
  if (status === 401) return "Kode salah atau sudah kedaluwarsa."
  if (status === 0 || status >= 500) return SERVER_TROUBLE
  return "Belum bisa masuk sekarang."
}

export function PhoneScene({
  phone,
  onPhone,
  onBack,
  onSent,
}: {
  phone: string
  onPhone: (phone: string) => void
  onBack: () => void
  onSent: (sent: SentOtp) => void
}) {
  const send = useMutation({
    mutationFn: () => member.sendCode(phone.trim()),
    onSuccess: onSent,
  })
  const problem = send.isError ? sendProblem(send.error) : null
  const ready = phone.replace(/\D/g, "").length >= 9

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !send.isPending) send.mutate()
      }}
    >
      <div>
        <Chip aria-label="Kembali" onClick={onBack}>
          <ArrowLeft />
        </Chip>
      </div>
      <h1 className="mt-6 text-title font-semibold text-ink">Masuk dengan WhatsApp</h1>

      <label htmlFor="phone" className="mt-8 text-meta font-semibold text-text">
        Nomor WhatsApp
      </label>
      <Input
        id="phone"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        placeholder="0812 3456 7890"
        aria-invalid={problem !== null || undefined}
        className="num mt-2"
        value={phone}
        onChange={(event) => {
          // Digits, a leading plus and the spaces people type — the server
          // takes 0812…, 62812… and +62 812… alike.
          onPhone(event.target.value.replace(/[^\d+\s-]/g, ""))
          if (send.isError) send.reset()
        }}
      />
      {problem !== null && (
        <p role="alert" className="mt-3 text-meta font-medium text-bad-fg">
          {problem}
        </p>
      )}

      <div className="mt-auto pt-8">
        <Button type="submit" variant="primary" size="lg" block disabled={!ready || send.isPending}>
          {send.isPending && <Spinner />}
          {send.isPending ? "Mengirim…" : "Kirim kode"}
        </Button>
      </div>
    </form>
  )
}

export function CodeScene({
  phone,
  sent,
  onSent,
  onBack,
  onSignedIn,
}: {
  phone: string
  /// The code on its way: which challenge to answer, until when, and the
  /// number it went to with the middle hidden.
  sent: SentOtp
  /// A fresh code was sent in place of this one.
  onSent: (sent: SentOtp) => void
  onBack: () => void
  onSignedIn: (session: MemberSessionResponse) => void
}) {
  const [code, setCode] = useState("")
  // When this code left, by this phone's clock: the wait before asking for
  // another is counted from here, not from the server's `expires_at`.
  const [sentAt, setSentAt] = useState(() => Date.now())
  const now = useNow()
  const left = secondsUntil(sent.expires_at, now)
  const wait = Math.max(0, Math.ceil((sentAt + RESEND_AFTER_S * 1000 - now) / 1000))

  const signIn = useMutation({
    mutationFn: (digits: string) => member.signInByCode(sent.challenge_id, phone.trim(), digits),
    onSuccess: onSignedIn,
  })
  const resend = useMutation({
    mutationFn: () => member.sendCode(phone.trim()),
    onSuccess: (next) => {
      setCode("")
      setSentAt(Date.now())
      signIn.reset()
      onSent(next)
    },
  })

  const change = (next: string) => {
    setCode(next)
    if (signIn.isError) signIn.reset()
    if (resend.isError) resend.reset()
    // The sixth digit is the last thing there is to do: send it.
    if (next.length === 6 && left > 0 && !signIn.isPending) signIn.mutate(next)
  }

  const problem = signIn.isError
    ? signInProblem(signIn.error)
    : resend.isError
      ? sendProblem(resend.error)
      : null
  const wrong = signIn.isError && statusOf(signIn.error) === 401

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (code.length === 6 && left > 0 && !signIn.isPending) signIn.mutate(code)
      }}
    >
      <div>
        <Chip aria-label="Ganti nomor" onClick={onBack}>
          <ArrowLeft />
        </Chip>
      </div>
      <h1 className="mt-6 text-title font-semibold text-ink">Masukkan kode</h1>
      <p className="mt-2 text-nav text-body">
        Kode dikirim ke WhatsApp <span className="num font-medium text-ink">{sent.sent_to}</span>
      </p>

      <label htmlFor="otp" className="sr-only">
        Kode dari WhatsApp
      </label>
      <div className="mt-8">
        <CodeInput id="otp" autoFocus value={code} onChange={change} invalid={wrong} />
      </div>

      {problem !== null ? (
        <p role="alert" className="mt-3 text-meta font-medium text-bad-fg">
          {problem}
        </p>
      ) : (
        <p className="num mt-3 text-meta text-body">
          {left > 0 ? `Kode berlaku ${mmss(left)}` : "Kode sudah kedaluwarsa. Kirim ulang untuk kode baru."}
        </p>
      )}

      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={wait > 0 || resend.isPending}
          onClick={() => resend.mutate()}
        >
          {resend.isPending && <Spinner />}
          {resend.isPending ? "Mengirim…" : wait > 0 ? `Kirim ulang · ${mmss(wait)}` : "Kirim ulang"}
        </Button>
      </div>

      <div className="mt-auto pt-8">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={code.length !== 6 || left === 0 || signIn.isPending}
        >
          {signIn.isPending && <Spinner />}
          {signIn.isPending ? "Memeriksa…" : "Masuk"}
        </Button>
      </div>
    </form>
  )
}
