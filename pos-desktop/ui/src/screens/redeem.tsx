import { useState } from "react"

import {
  confirmRedeemRequest,
  lookupRedeemRequest,
  type ConfirmedRedeemRequest,
  type FoundRedeemRequest,
} from "@/redeem"
import { Icon } from "@/icons"
import { Topbar } from "@/till"
import { money } from "@itulah/contract/money"

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
    `Node toko menolak dengan status ${reply.status} dan tidak menyebut alasannya.`
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
        "Nomor member dan kode enam digitnya harus diisi — kode itu yang ditunjukkan pelanggan di layar aplikasinya.",
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
                <p>Pakai kode ini di pembayaran → Voucher.</p>
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
              <div className="notice">Voucher yang sama (sudah pernah dikonfirmasi).</div>
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
              <h1>Tukar poin jadi voucher</h1>
            </div>
            <button className="btn ghost" onClick={onBack}>
              <Icon name="back" />
              Kembali ke konter
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
                placeholder="Nomor pada kartu…"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </label>
            <label className="field">
              Kode enam digit
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Dibacakan dari layar pelanggan…"
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
                {busy ? "Mengirim ke node…" : "Konfirmasi penukaran"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
