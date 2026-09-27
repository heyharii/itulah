import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { activeShift, cashMovement, closeShift, openShift } from "@/api"
import { Icon } from "@/icons"
import { refreshPaymentMethods } from "@/payment-methods"
import { Topbar } from "@/till"
import type { ShiftReport } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The cash session — one drawer, from the float in the morning to the count
/// at the end of it.
///
/// Everything here is the node's: which shift is running, what it took, what
/// should therefore be in the drawer. This screen holds no figure of its own
/// except the one a cashier is typing, and it sends that one exactly as typed.
///
/// # Four rules this screen obeys, and where they come from
///
/// **"No shift" and "cannot tell" are different answers.** `store_active_shift`
/// answers `null` on purpose — a shop at nine in the morning has no open shift
/// and that is not an error — and refuses when the node cannot be reached.
/// Drawn as one empty state they would invite a cashier to act on a drawer this
/// terminal cannot see.
///
/// **The count is blind, then checked.** `till.rs`: "The close is blind on
/// purpose — a cashier shown the expected figure counts toward it." So the
/// node's expectation is fetched before the close and held back until a figure
/// has been committed, the declared box is never seeded with it, and the
/// running summary above deliberately omits the cash totals a cashier could add
/// up into the same answer. The difference is then shown, because the
/// difference is the entire reason a shift is closed.
///
/// **Money out of a drawer carries a reason.** `record_cash_movement` refuses
/// an empty one; this screen refuses it first, in Indonesian, at the counter.
/// A payout with no reason is the row nobody can reconstruct months later.
///
/// **A key belongs to an attempt, not to a press and not to a screen.** See
/// `useIdempotency` below — the node binds the key to the body it first saw,
/// so both a per-press key and a screen-lifetime key are wrong, in opposite
/// directions.

/// Every amount on this wire is an integer count of the smallest unit, and IDR
/// has no smaller unit — so the digits a cashier types ARE the minor value and
/// nothing is multiplied on the way out. No shift figure carries a currency
/// code either: a drawer holds the notes of the country the shop stands in.
const CURRENCY = "IDR"

const PAD = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "⌫", "0", "000"]

/// The two movements this terminal can complete on its own.
///
/// `till.rs` takes five kinds. `OPENING_FLOAT` is written by the open itself,
/// and `PAYOUT` and `CORRECTION` are refused without a supervisor in the body —
/// a field `cashMovement()` has no room for. A button that can only ever fail
/// is worse than no button, so those two are named as absent instead.
///
/// The sign is the screen's, never the cashier's: the amount is signed on the
/// wire, in positive and out negative, and a direction typed as a minus is a
/// direction that gets typed wrong.
const MOVES = [
  {
    kind: "DROP",
    sign: -1,
    label: "Setor ke brankas",
  },
  {
    kind: "PICKUP",
    sign: 1,
    label: "Tambah uang laci",
  },
] as const

type MoveKind = (typeof MOVES)[number]["kind"]

/// The node names movements in English on the wire; the counter reads
/// Indonesian. Anything unknown prints as it arrived rather than as a blank.
const MOVEMENT: Record<string, string> = {
  OPENING_FLOAT: "Modal awal",
  DROP: "Setor ke brankas",
  PAYOUT: "Pengeluaran",
  PICKUP: "Uang masuk laci",
  CORRECTION: "Koreksi",
}

/// `EdgeReply.problem` is typed nullable but the shell fills it on every
/// refusal. If it ever is not, say that plainly rather than render nothing and
/// leave a cashier looking at a button that did something invisible.
const SILENT = "Node toko menolak tanpa alasan."

/// The write went through — the drawer has changed — but the reply could not be
/// read, so nothing on this screen may be trusted until the node is asked again.
const UNREADABLE = "Jawaban node tidak terbaca. Keadaan laci dibaca ulang."

/// `actor_id` is required by the node, and when the node runs with auth switched
/// off it is NOT overwritten from a session — whatever this screen sends is what
/// the ledger keeps forever. Checked here so the refusal names the real problem.
const NAMELESS = "Masuk dulu sebagai kasir."

function minorOf(text: string): number {
  return Number(text.replace(/\D/g, "")) || 0
}

/// A timestamp a cashier can read. RFC3339 from the node; anything else is
/// shown as it arrived rather than as "Invalid Date".
function when(stamp: string): string {
  const at = new Date(stamp)
  return Number.isNaN(at.getTime())
    ? stamp
    : at.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}

/// The Z report, out of a reply the wrapper types loosely.
///
/// `api.ts` names `activeShift`'s body `Shift` and the other three
/// `Record<string, unknown>`, but every one of these handlers returns the whole
/// `ShiftReport` — `store_active_shift` an `Option` of it. Rather than assert
/// that, the two fields this screen actually steers on are checked, and a body
/// carrying neither is reported as unreadable instead of being drawn as an
/// empty drawer.
function asReport(body: unknown): ShiftReport | null {
  if (body === null || typeof body !== "object") return null
  const maybe = body as Partial<ShiftReport>
  if (typeof maybe.shift_id !== "string") return null
  // Not `expected_cash_minor`: a cashier is served the report blind, with
  // that figure null (`http.rs::blind_for_cashier`), and a blind report is
  // still a report.
  if (typeof maybe.status !== "string") return null
  return maybe as ShiftReport
}

/// One idempotency key per attempt, held while that attempt is retried and not
/// a moment longer.
///
/// The node stores a key against the request body it first saw and refuses the
/// same key with any other body — "idempotency key was already used with a
/// different request payload". So a key that lived for the life of the screen
/// would refuse the cashier who mistyped a float, was told so, corrected it and
/// pressed again. And a key minted per press would turn the retry after a
/// timeout into a second shift, which is the one thing idempotency is for.
/// Keyed on the body itself, both are answered at once.
function useIdempotency() {
  const held = useRef<{ body: string; key: string } | null>(null)
  return {
    keyFor(body: unknown): string {
      const shape = JSON.stringify(body)
      if (held.current === null || held.current.body !== shape) {
        held.current = { body: shape, key: crypto.randomUUID() }
      }
      return held.current.key
    },
    /// The attempt landed. The next one is a different event and gets its own
    /// key, even when a cashier opens with the same float tomorrow.
    spent() {
      held.current = null
    },
  }
}

/// What the node last said about this drawer. `unknown` is a state of its own
/// and never collapses into `none`.
type Reading =
  | { readonly kind: "reading" }
  | { readonly kind: "none" }
  | { readonly kind: "open"; readonly report: ShiftReport }
  | { readonly kind: "closed"; readonly report: ShiftReport }
  | { readonly kind: "unknown"; readonly problem: string }

/// Notes and coins a drawer is counted in, largest first. The same set the
/// payment page counts change out in.
const DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const

export function ShiftScreen({
  actorId,
  terminalId,
  onBack,
}: {
  actorId: string
  terminalId: string
  onBack: () => void
}) {
  const [reading, setReading] = useState<Reading>({ kind: "reading" })

  const read = useCallback(async () => {
    setReading({ kind: "reading" })
    const reply = await activeShift()
    if (!reply.ok) {
      setReading({ kind: "unknown", problem: reply.problem ?? SILENT })
      return
    }
    if (reply.body === null) {
      setReading({ kind: "none" })
      return
    }
    const report = asReport(reply.body)
    setReading(
      report === null
        ? { kind: "unknown", problem: UNREADABLE }
        : report.status === "OPEN"
          ? { kind: "open", report }
          : { kind: "closed", report },
    )
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  const onDone = useCallback(
    (report: ShiftReport | null) => {
      if (report === null) {
        void read()
        return
      }
      setReading(
        report.status === "OPEN"
          ? { kind: "open", report }
          : { kind: "closed", report },
      )
    },
    [read],
  )

  let panel: ReactNode
  if (reading.kind === "reading") {
    panel = (
      <div className="empty">
        <h3>Memuat shift…</h3>
      </div>
    )
  } else if (reading.kind === "unknown") {
    panel = (
      <>
        <p className="error">{reading.problem}</p>
        <div className="rows">
          <button className="btn primary" onClick={() => void read()}>
            Coba lagi
          </button>
        </div>
      </>
    )
  } else if (reading.kind === "none") {
    panel = (
      <Opening actorId={actorId} terminalId={terminalId} onDone={onDone} />
    )
  } else if (reading.kind === "open") {
    panel = (
      <Running
        actorId={actorId}
        terminalId={terminalId}
        report={reading.report}
        onDone={onDone}
      />
    )
  } else {
    panel = (
      <Closed
        report={reading.report}
        onAgain={() => setReading({ kind: "none" })}
      />
    )
  }

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} />
      <main className="page">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <h1>Shift &amp; kas</h1>
              <p className="num">{terminalId}</p>
            </div>
            <button className="btn ghost" onClick={onBack}>
              <Icon name="back" />
              Kembali ke konter
            </button>
          </div>
          {panel}
        </div>
      </main>
    </div>
  )
}

/// A rupiah amount, typed. The pad is here because a counter is touched, not
/// clicked, and because the keyboard on a till is often behind the monitor.
function Rupiah({
  caption,
  text,
  onText,
  autoFocus,
}: {
  caption: string
  text: string
  onText: (next: string) => void
  autoFocus?: boolean
}) {
  const value = Number(text) || 0
  return (
    <div>
      <span className="label">{caption}</span>
      <div className="amount-field" style={{ marginTop: 8 }}>
        <span className="rp">Rp</span>
        <input
          value={value > 0 ? value.toLocaleString("id-ID") : ""}
          onChange={(event) => onText(event.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="0"
          aria-label={caption}
          autoFocus={autoFocus}
        />
      </div>
      <div className="numpad" style={{ marginTop: 8 }}>
        {PAD.map((key) => (
          <button
            key={key}
            type="button"
            className={key === "⌫" ? "del" : undefined}
            aria-label={key === "⌫" ? "Hapus satu angka" : undefined}
            onClick={() =>
              onText(
                key === "⌫"
                  ? text.slice(0, -1)
                  : String(Number(text + key) || ""),
              )
            }
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  )
}

/// Opening the drawer: the float counted into it this morning. Also what a
/// cashier is shown straight after signing in when no shift is open yet —
/// see `ShiftGate` below.
export function Opening({
  actorId,
  terminalId,
  onDone,
}: {
  actorId: string
  terminalId: string
  onDone: (report: ShiftReport | null) => void
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const attempt = useIdempotency()

  async function open() {
    if (actorId.trim() === "") {
      setProblem(NAMELESS)
      return
    }
    setBusy(true)
    setProblem(null)
    const draft = {
      terminal_id: terminalId,
      opening_float_minor: minorOf(text),
      actor_id: actorId,
    }
    const reply = await openShift({
      ...draft,
      idempotency_key: attempt.keyFor(draft),
    })
    setBusy(false)
    if (reply.ok) {
      attempt.spent()
      // A new shift is when Finance's latest payment methods are picked up.
      void refreshPaymentMethods()
      onDone(asReport(reply.body))
      return
    }
    setProblem(reply.problem ?? SILENT)
  }

  return (
    <form
      className="rows"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) void open()
      }}
    >
      <Rupiah caption="Modal awal di laci" text={text} onText={setText} autoFocus />

      {problem !== null && <p className="error">{problem}</p>}

      <button className="btn primary lg" type="submit" disabled={busy}>
        {busy ? "Membuka…" : `Buka shift · ${money(minorOf(text), CURRENCY)}`}
      </button>
    </form>
  )
}

/// Straight after sign-in, when this terminal has no open shift: the float is
/// asked for before the counter opens, because a till with no shift has no
/// drawer to put the first sale's cash in. If the node cannot be asked, the
/// counter opens anyway — the shift screen stays one press away.
export function ShiftGate({
  actorId,
  terminalId,
  onReady,
  onSignOut,
}: {
  actorId: string
  terminalId: string
  onReady: () => void
  onSignOut: () => void
}) {
  const [state, setState] = useState<"asking" | "none">("asking")

  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await activeShift()
      if (!alive) return
      const report = reply.ok ? asReport(reply.body) : null
      if (reply.ok && (reply.body === null || report?.status !== "OPEN")) {
        setState("none")
        return
      }
      onReady()
    })()
    return () => {
      alive = false
    }
  }, [onReady])

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} onSignOut={onSignOut} />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 440 }}>
          {state === "asking" ? (
            <div className="empty">
              <h3>Memuat shift…</h3>
            </div>
          ) : (
            <>
              <div className="page-head">
                <div>
                  <h1>Buka shift</h1>
                  <p>Hitung uang di laci, lalu isi modal awalnya.</p>
                </div>
              </div>
              <Opening
                actorId={actorId}
                terminalId={terminalId}
                onDone={() => onReady()}
              />
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function Running({
  actorId,
  terminalId,
  report,
  onDone,
}: {
  actorId: string
  terminalId: string
  report: ShiftReport
  onDone: (report: ShiftReport | null) => void
}) {
  const [closing, setClosing] = useState(false)

  // A blind count shows nothing that points at the expected figure — not the
  // takings, not the movements — from the moment counting starts.
  if (closing) {
    return (
      <Closing
        actorId={actorId}
        report={report}
        onDone={onDone}
        onCancel={() => setClosing(false)}
      />
    )
  }

  return (
    <>
      {report.terminal_id !== terminalId && (
        <div className="notice warn">
          Shift ini milik terminal <strong>{report.terminal_id}</strong>.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <small>Modal awal</small>
          <strong className="num">
            {money(report.opening_float_minor, CURRENCY)}
          </strong>
        </div>
        <div className="stat">
          <small>Transaksi</small>
          <strong className="num">{report.sale_count}</strong>
        </div>
        <div className="stat">
          <small>Dibuka</small>
          <strong style={{ fontSize: 15 }}>
            {when(report.opened_at)}
          </strong>
          <small style={{ marginTop: 4 }}>{report.opened_by}</small>
        </div>
      </div>

      {report.voided_count > 0 && (
        <div className="kv">
          <span className="muted">Void</span>
          <span className="badge warn">
            {report.voided_count} transaksi ·{" "}
            {money(report.voided_total_minor, CURRENCY)}
          </span>
        </div>
      )}

      <Movement actorId={actorId} shiftId={report.shift_id} onDone={onDone} />

      {report.movements.length > 0 && (
        <div>
          <span className="label">Pergerakan kas</span>
          <div className="rows" style={{ marginTop: 8 }}>
            {report.movements.map((one) => (
              <div className="row-item" key={one.id}>
                <div className="grow">
                  <h3>{MOVEMENT[one.kind] ?? one.kind}</h3>
                  <p>
                    {one.reason} · {when(one.occurred_at)} · {one.actor_id}
                    {one.approved_by !== null && ` · disetujui ${one.approved_by}`}
                  </p>
                </div>
                <strong className="num">
                  {one.amount_minor < 0 ? "−" : "+"}
                  {money(Math.abs(one.amount_minor), CURRENCY)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rows">
        <button className="btn danger lg" onClick={() => setClosing(true)}>
          <Icon name="lock" />
          Tutup shift
        </button>
      </div>
    </>
  )
}

function Movement({
  actorId,
  shiftId,
  onDone,
}: {
  actorId: string
  shiftId: string
  onDone: (report: ShiftReport | null) => void
}) {
  const [kind, setKind] = useState<MoveKind>("DROP")
  const [text, setText] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const attempt = useIdempotency()

  const chosen = MOVES.find((one) => one.kind === kind) ?? MOVES[0]
  const amount = minorOf(text)

  async function send() {
    if (actorId.trim() === "") {
      setProblem(NAMELESS)
      return
    }
    if (amount <= 0) {
      setProblem("Isi nominalnya.")
      return
    }
    if (reason.trim() === "") {
      setProblem("Alasan wajib diisi.")
      return
    }
    setBusy(true)
    setProblem(null)
    const draft = {
      kind: chosen.kind,
      amount_minor: chosen.sign * amount,
      reason: reason.trim(),
      actor_id: actorId,
    }
    const reply = await cashMovement(shiftId, {
      ...draft,
      idempotency_key: attempt.keyFor(draft),
    })
    setBusy(false)
    if (reply.ok) {
      attempt.spent()
      setText("")
      setReason("")
      onDone(asReport(reply.body))
      return
    }
    setProblem(reply.problem ?? SILENT)
  }

  return (
    <div className="rows">
      <span className="label">Uang masuk / keluar laci</span>
      <div className="segmented" role="radiogroup" aria-label="Jenis pergerakan">
        {MOVES.map((one) => (
          <button
            key={one.kind}
            type="button"
            role="radio"
            aria-checked={one.kind === kind}
            aria-pressed={one.kind === kind}
            onClick={() => {
              setKind(one.kind)
              setProblem(null)
            }}
          >
            {one.label}
          </button>
        ))}
      </div>

      <Rupiah caption="Nominal" text={text} onText={setText} />

      <label className="field">
        Alasan
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Misalnya: setor sore, amplop 3"
          autoComplete="off"
        />
      </label>

      {problem !== null && <p className="error">{problem}</p>}

      <button className="btn" disabled={busy} onClick={() => void send()}>
        {busy ? "Mencatat…" : `Catat · ${money(amount, CURRENCY)}`}
      </button>
    </div>
  )
}

/// Closing the drawer, counted blind.
///
/// The cashier counts every note and coin into the rows below and never sees
/// the figure the node expects — not while counting, not before sending. The
/// expected cash is not even fetched: a number this screen never holds is a
/// number it cannot leak. Only once the count is locked and the shift closed
/// does the node's answer come back, and `Closed` shows the difference.
///
/// The sheet travels as `counted`, one line per denomination, and the node
/// refuses it unless it adds up to the declared figure — the count sheet is
/// what an audit asks for the next morning.
function Closing({
  actorId,
  report,
  onDone,
  onCancel,
}: {
  actorId: string
  report: ShiftReport
  onDone: (report: ShiftReport | null) => void
  onCancel: () => void
}) {
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [note, setNote] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const attempt = useIdempotency()

  const pieces = (value: number) => Number(counts[value] ?? "") || 0
  const declared = DENOMINATIONS.reduce(
    (sum, value) => sum + value * pieces(value),
    0,
  )

  const set = (value: number, next: number) =>
    setCounts((was) => ({
      ...was,
      [value]: next <= 0 ? "" : String(Math.min(next, 9999)),
    }))

  async function close() {
    if (actorId.trim() === "") {
      setProblem(NAMELESS)
      return
    }
    setBusy(true)
    setProblem(null)
    const draft = {
      declared_cash_minor: declared,
      counted: DENOMINATIONS.map((value) => ({
        value_minor: value,
        pieces: pieces(value),
      })).filter((line) => line.pieces > 0),
      note: note.trim() === "" ? null : note.trim(),
      actor_id: actorId,
    }
    const reply = await closeShift(report.shift_id, {
      ...draft,
      idempotency_key: attempt.keyFor(draft),
    })
    setBusy(false)
    if (reply.ok) {
      attempt.spent()
      onDone(asReport(reply.body))
      return
    }
    setProblem(reply.problem ?? SILENT)
  }

  if (confirming) {
    return (
      <div className="rows">
        <span className="label">Periksa hitungan</span>
        <div>
          {DENOMINATIONS.filter((value) => pieces(value) > 0).map((value) => (
            <div className="kv" key={value}>
              <span>
                {money(value, CURRENCY)} × {pieces(value)}
              </span>
              <span className="num">
                {money(value * pieces(value), CURRENCY)}
              </span>
            </div>
          ))}
        </div>
        <div className="count-total">
          <span>Total dihitung</span>
          <strong className="num">{money(declared, CURRENCY)}</strong>
        </div>
        <label className="field">
          Catatan (opsional)
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoComplete="off"
          />
        </label>
        {problem !== null && <p className="error">{problem}</p>}
        <button
          className="btn danger lg"
          disabled={busy}
          onClick={() => void close()}
        >
          {busy ? "Menutup…" : "Kunci hitungan & tutup shift"}
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Hitung ulang
        </button>
      </div>
    )
  }

  return (
    <div className="rows">
      <div className="page-head" style={{ alignItems: "center" }}>
        <div>
          <span className="label">Tutup shift · hitung uang di laci</span>
        </div>
        <button className="btn ghost" onClick={onCancel}>
          Batal
        </button>
      </div>

      <div className="denom-grid">
        {DENOMINATIONS.map((value) => (
          <div className="denom-row" key={value}>
            <span className="num">{money(value, CURRENCY)}</span>
            <div className="qty">
              <button
                type="button"
                aria-label={`Kurangi ${money(value, CURRENCY)}`}
                onClick={() => set(value, pieces(value) - 1)}
              >
                −
              </button>
              <input
                value={counts[value] ?? ""}
                onChange={(event) =>
                  set(value, Number(event.target.value.replace(/\D/g, "")) || 0)
                }
                inputMode="numeric"
                placeholder="0"
                aria-label={`Jumlah lembar ${money(value, CURRENCY)}`}
              />
              <button
                type="button"
                aria-label={`Tambah ${money(value, CURRENCY)}`}
                onClick={() => set(value, pieces(value) + 1)}
              >
                +
              </button>
            </div>
            <strong className="num">
              {pieces(value) > 0 ? money(value * pieces(value), CURRENCY) : "—"}
            </strong>
          </div>
        ))}
      </div>

      <div className="count-total">
        <span>Total dihitung</span>
        <strong className="num">{money(declared, CURRENCY)}</strong>
      </div>

      <button className="btn primary lg" onClick={() => setConfirming(true)}>
        Lanjut
      </button>
    </div>
  )
}

/// A closed shift, as the cashier who counted it is allowed to see it.
///
/// Blind to the end: no expected cash, no difference, and none of the figures
/// it could be worked back from — not the cash takings, not the change given,
/// not the per-tender totals. The node has all of them and the back office
/// reads the variance from there; a cashier who could see it here would know,
/// next time, what number the count is meant to come to.
function Closed({
  report,
  onAgain,
}: {
  report: ShiftReport
  onAgain: () => void
}) {
  return (
    <>
      <div className="pay-done" style={{ flex: "none", padding: "8px 0" }}>
        <span className="seal">
          <Icon name="check" />
        </span>
        <h3>Shift ditutup</h3>
      </div>

      <div className="count-total">
        <span>Uang yang Anda hitung</span>
        <strong className="num">
          {report.declared_cash_minor === null
            ? "—"
            : money(report.declared_cash_minor, CURRENCY)}
        </strong>
      </div>

      {(report.counted ?? []).length > 0 && (
        <div>
          {(report.counted ?? []).map((line) => (
            <div className="kv" key={line.value_minor}>
              <span>
                {money(line.value_minor, CURRENCY)} × {line.pieces}
              </span>
              <span className="num">
                {money(line.value_minor * line.pieces, CURRENCY)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="kv">
          <span className="muted">Ditutup</span>
          <span>
            {report.closed_at !== null ? when(report.closed_at) : "—"}
            {report.closed_by !== null && ` · ${report.closed_by}`}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Transaksi</span>
          <span className="num">{report.sale_count}</span>
        </div>
        {report.note !== null && (
          <div className="kv">
            <span className="muted">Catatan</span>
            <span style={{ textAlign: "right" }}>{report.note}</span>
          </div>
        )}
      </div>

      <div className="rows">
        <button className="btn primary" onClick={onAgain}>
          Buka shift baru
        </button>
      </div>
    </>
  )
}
