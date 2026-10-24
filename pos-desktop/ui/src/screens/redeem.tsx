import { useEffect, useRef, useState } from "react"

import {
  confirmRedeemRequest,
  lookupRedeemRequest,
  type ConfirmedRedeemRequest,
  type FoundRedeemRequest,
} from "@/redeem"
import { Icon } from "@/icons"
import { viaPointer } from "@/shortcuts"
import { sound } from "@/sound"
import { Topbar } from "@/till"
import { money } from "@itulah/contract/money"

import "../exchange-d.css"

/// The other half of a pairing code's conversation.
///
/// `frontend-hub`'s member counter reads a cashier-generated code out to a
/// shopper's phone; this is the shopper's own version, read the other way —
/// `frontend-customer` shows the member a balance, a points figure they pick,
/// and a six-digit code, and this screen is where that code is spent. The
/// cashier never decides how many points buy how much: that rate is fixed at
/// the centre (`postgres/loyalty.rs::confirm_redeem_request`) and this
/// counter only ever confirms what a shopper already asked for.
///
/// # What comes out of this is a voucher, not a rupiah figure
///
/// A confirmed redemption is a `GOODWILL` voucher, the same object
/// `vouchers.ts` already knows how to spend. This screen does not apply it to
/// the sale itself — it shows the code plainly and sends the cashier back to
/// the counter to key it into the existing "Voucher" tender, exactly as any
/// other voucher code would be. A second tender mechanism for one more kind
/// of voucher would be two ways to do the same thing, and the two would drift.

/// What the node said, or the plain fact that it said nothing — same
/// reasoning `refusal()` in `screens/returns.tsx` gives: the cashier is about
/// to repeat this sentence to somebody standing in front of them, so it has
/// to be the node's own.
function refusal(reply: { readonly problem: string | null; readonly status: number }): string {
  return (
    reply.problem ??
    `Server toko menolak dengan status ${reply.status} tanpa alasan.`
  )
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "PENDING":
      return "Menunggu"
    case "CONFIRMED":
      return "Sudah ditukar"
    case "EXPIRED":
      return "Kedaluwarsa"
    case "CANCELLED":
      return "Dibatalkan"
    default:
      return status ?? "—"
  }
}

export function RedeemScreen({
  actorId,
  onBack,
}: {
  actorId: string
  onBack: () => void
}) {
  const [memberId, setMemberId] = useState("")
  const [code, setCode] = useState("")
  const [looking, setLooking] = useState(false)
  const [found, setFound] = useState<FoundRedeemRequest | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ConfirmedRedeemRequest | null>(null)

  async function find() {
    const member = memberId.trim()
    const typed = code.trim()
    if (member === "" || typed.length !== 6) {
      setProblem(
        "Ketik nomor member dan kode 6 angka.",
      )
      return
    }
    setLooking(true)
    setProblem(null)
    setFound(null)
    const reply = await lookupRedeemRequest(member, typed)
    setLooking(false)
    if (!reply.ok) {
      setProblem(refusal(reply))
      return
    }
    setFound(reply.body)
  }

  async function confirm() {
    if (found?.request_id === undefined) return
    setBusy(true)
    setProblem(null)
    const reply = await confirmRedeemRequest(found.request_id)
    setBusy(false)
    if (!reply.ok) {
      setProblem(refusal(reply))
      return
    }
    setDone(reply.body)
  }

  if (done !== null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar actorId={actorId} />
        <div className="page">
          <div className="page-inner">
            <div className="page-head">
              <div>
                <span className="label">Poin ditukar</span>
                <h1 className="num">
                  {done.voucher_code ?? "—"}
                </h1>
                <p>Pakai kode ini saat bayar → Voucher.</p>
              </div>
              <button className="btn primary" onClick={onBack}>
                Selesai
              </button>
            </div>
            <div>
              <div className="kv">
                <span className="muted">Poin terpakai</span>
                <span className="num">{done.points_spent ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="muted">Nilai voucher</span>
                <strong className="num">
                  {done.voucher_value_minor === undefined
                    ? "—"
                    : money(done.voucher_value_minor)}
                </strong>
              </div>
              <div className="kv">
                <span className="muted">Sisa poin member</span>
                <span className="num">{done.balance_points ?? "—"}</span>
              </div>
            </div>
            {done.replayed === true && (
              <div className="notice">Voucher yang sama (sudah dikonfirmasi sebelumnya).</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} />
      <div className="page">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <span className="label">Tukar poin</span>
              <h1>Tukar poin dengan voucher</h1>
            </div>
            <button className="btn ghost" onClick={onBack}>
              <Icon name="back" />
              Kembali ke kasir
            </button>
          </div>

          <div className="steps">
            <span className={found === null ? "active" : undefined}>
              1 · Cari permintaan
            </span>
            <span className={found !== null ? "active" : undefined}>
              2 · Konfirmasi
            </span>
          </div>

          <form
            className="rows"
            onSubmit={(event) => {
              event.preventDefault()
              void find()
            }}
          >
            <label className="field">
              Nomor member
              <input
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                placeholder="Nomor di kartu…"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
            <label className="field">
              Kode 6 angka
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Dari layar pelanggan…"
                autoComplete="off"
                spellCheck={false}
                inputMode="numeric"
              />
            </label>
            <button className="btn" type="submit" disabled={looking}>
              {looking ? "Mencari…" : "Cari permintaan"}
            </button>
          </form>
          {problem !== null && found === null && (
            <p className="error">{problem}</p>
          )}

          {found !== null && (
            <>
              <div className="divider" />
              <span className="label">Permintaan ditemukan</span>
              <div>
                <div className="kv">
                  <span className="muted">Poin diminta</span>
                  <strong className="num">{found.points ?? "—"}</strong>
                </div>
                <div className="kv">
                  <span className="muted">Status</span>
                  <span>{statusLabel(found.status)}</span>
                </div>
              </div>

              {problem !== null && <p className="error">{problem}</p>}
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? "Mengirim ke server toko…" : "Konfirmasi penukaran"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/// A refusal in the counter's words: a node that has no such route says so
/// once, plainly; anything else is the node's own sentence.
function redeemRefusal(reply: { readonly problem: string | null; readonly status: number }, code: string): string {
  if (reply.status === 405 || (reply.status === 404 && reply.problem === null)) {
    return "Server toko ini belum bisa tukar poin."
  }
  if (reply.status === 404 || /no live redemption|not found|no such/i.test(reply.problem ?? "")) {
    return `Kode ${code} tidak ada untuk member ini.`
  }
  if (reply.status === 401 || reply.status === 403) return "Server toko menolak tukar poin dari kasir ini."
  if (reply.status === 0 || reply.status === 502 || reply.status === 503 || reply.status === 504) {
    return "Kantor pusat tidak terjangkau — coba lagi sebentar."
  }
  return reply.problem ?? `Server toko menolak (${reply.status}).`
}

/// F11 · Tukar poin as a dialog over the counter — the prototype's
/// `redeemView`: the member from the sale already filled in, the 6-digit code
/// from the shopper's app, Enter to find it, Enter again to tukar; Esc closes.
/// What comes out is a voucher code, keyed into Bayar → Voucher.
export function RedeemDialog({
  memberId,
  onClose,
  onDone,
}: {
  memberId: string | null
  onClose: () => void
  onDone: (text: string) => void
}) {
  const [enter] = useState(viaPointer)
  const [member, setMember] = useState(memberId ?? "")
  const [code, setCode] = useState("")
  const [found, setFound] = useState<FoundRedeemRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const memberBox = useRef<HTMLInputElement>(null)
  const codeBox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(memberId !== null && memberId !== "" ? codeBox : memberBox).current?.focus()
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  function say(text: string | null) {
    setError(text)
    if (text !== null) sound.no()
  }

  async function go() {
    if (busy) return
    const who = member.trim()
    if (found === null) {
      if (who === "") {
        say("Ketik nomor member.")
        memberBox.current?.focus()
        return
      }
      if (code.length !== 6) {
        say("Kode redeem itu 6 angka dari aplikasi member.")
        codeBox.current?.focus()
        return
      }
      setBusy(true)
      say(null)
      const reply = await lookupRedeemRequest(who, code)
      setBusy(false)
      if (!reply.ok) {
        say(redeemRefusal(reply, code))
        return
      }
      if (reply.body?.status !== undefined && reply.body.status !== "PENDING") {
        say(`Kode ${code} ${statusLabel(reply.body.status).toLowerCase()}.`)
        return
      }
      setFound(reply.body)
      return
    }
    if (found.request_id === undefined) return
    setBusy(true)
    say(null)
    const reply = await confirmRedeemRequest(found.request_id)
    setBusy(false)
    if (!reply.ok) {
      say(redeemRefusal(reply, code))
      return
    }
    const done = reply.body
    onDone(
      `Poin ditukar · ${done.points_spent ?? found.points ?? "—"} poin → voucher ${done.voucher_code ?? "—"}` +
        (done.voucher_value_minor === undefined ? "" : ` senilai ${money(done.voucher_value_minor)}`) +
        ". Pakai di Bayar → Voucher.",
    )
  }

  const keyEnter = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    void go()
  }

  return (
    <div className={enter ? "xchd enter" : "xchd"} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dlg xc-find" role="dialog" aria-modal="true" aria-label="Tukar poin">
        <div className="dlg-head">
          <p className="ttl">Tukar poin</p>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-body">
          <label className="xc-scan sm idle">
            <span className="mem-k" style={{ margin: 0, minWidth: 72 }}>Member</span>
            <input
              ref={memberBox}
              value={member}
              onChange={(event) => {
                setMember(event.target.value)
                setFound(null)
                setError(null)
              }}
              onKeyDown={keyEnter}
              placeholder="Nomor member"
              autoComplete="off"
              spellCheck={false}
              aria-label="Nomor member"
            />
          </label>
          <label className={error !== null ? "xc-scan bad" : "xc-scan"}>
            <Icon name="search" />
            <input
              ref={codeBox}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                setFound(null)
                setError(null)
              }}
              onKeyDown={keyEnter}
              placeholder="Scan atau ketik kode redeem 6 angka"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              aria-label="Kode redeem"
            />
          </label>
          {error !== null && (
            <p className="xc-err" role="alert">
              {error}
            </p>
          )}
          {found !== null && (
            <div className="mem on" style={{ cursor: "default" }}>
              <span className="kbd">✓</span>
              <span>
                <b>{member.trim()}</b>
                <span>{found.points ?? "—"} poin · {statusLabel(found.status)}</span>
              </span>
              <span className="pts">{code}</span>
            </div>
          )}
        </div>
        <div className="dlg-foot">
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--ghost" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="ds-btn ds-btn--primary" disabled={busy} onClick={() => void go()}>
            <span>{busy ? "Menanyakan…" : found !== null ? `Tukar ${found.points ?? ""} poin` : "Cari"}</span>
            <span className="kbd">Enter</span>
          </button>
        </div>
      </section>
    </div>
  )
}
