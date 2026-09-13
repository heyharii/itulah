import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import {
  activeShift,
  cashMovement,
  closeShift,
  openShift,
  shiftReport,
} from "@/api"
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
    label: "Uang keluar laci",
    hint: "Setor ke brankas — uangnya keluar dari laci, tapi masih di toko.",
  },
  {
    kind: "PICKUP",
    sign: 1,
    label: "Uang masuk laci",
    hint: "Tambahan modal atau uang kecil untuk kembalian.",
  },
] as const

type MoveKind = (typeof MOVES)[number]["kind"]

/// The node names tenders and movements in English on the wire; the counter
/// reads Indonesian. Anything unknown prints as it arrived rather than as a
/// blank — a tender added at the centre must not vanish off a Z report.
const TENDER: Record<string, string> = {
  CASH: "Tunai",
  CARD: "Kartu",
  QRIS: "QRIS",
  VOUCHER: "Voucher",
}

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
const SILENT = "Node toko menolak, tetapi tidak mengatakan alasannya."

/// The write went through — the drawer has changed — but the reply could not be
/// read, so nothing on this screen may be trusted until the node is asked again.
const UNREADABLE =
  "Node menjawab dalam bentuk yang tidak dikenali layar ini. Keadaan laci dibaca ulang."

/// `actor_id` is required by the node, and when the node runs with auth switched
/// off it is NOT overwritten from a session — whatever this screen sends is what
/// the ledger keeps forever. Checked here so the refusal names the real problem.
const NAMELESS =
  "Terminal ini belum tahu siapa yang bertugas, jadi pergerakan uang tidak bisa diatasnamakan siapa pun. Masuk dulu sebagai kasir."

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
  if (typeof maybe.expected_cash_minor !== "number") return null
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
    // `null` is the shop's ordinary morning. An object that cannot be read is
    // something else entirely, and saying "belum ada shift" for it would be
    // this screen inventing an answer the node never gave.
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

  /// A write landed. `null` means it landed but the reply was unreadable — the
  /// drawer moved, so the only honest thing left is to ask the node again.
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
        <h3>Menanyakan ke node toko…</h3>
        <p>
          Keadaan laci belum diketahui. Layar ini tidak menebaknya sambil
          menunggu.
        </p>
      </div>
    )
  } else if (reading.kind === "unknown") {
    panel = (
      <>
        <div className="notice warn">
          <strong>Node toko tidak menjawab.</strong> Jadi layar ini tidak tahu
          apakah ada shift yang sedang terbuka — dan “tidak tahu” bukan berarti
          “tidak ada”. Node yang memegang jawabannya, bukan terminal ini.
        </div>
        <p className="error">{reading.problem}</p>
        <div className="rows">
          <button className="btn primary" onClick={() => void read()}>
            Tanya lagi
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

  // The same shell every secondary screen in this app wears: `#app` is the
  // window, `.page` the one thing in it that scrolls. Deliberately without the
  // counter's topbar — this screen is entered from the till and leaves by the
  // button beside its own heading, and a second way back is a second thing to
  // press by accident with a customer waiting.
  return (
    <div id="app" data-screen="sale">
      <main className="page">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <h1>Shift kasir</h1>
              <p>
                Satu laci, satu shift, satu terminal —{" "}
                <span className="num">{terminalId}</span>. Tanpa shift yang
                terbuka, konter ini tidak boleh menerima uang.
              </p>
            </div>
            <button className="btn ghost" onClick={onBack}>
              ← Kembali ke konter
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
}: {
  caption: string
  text: string
  onText: (next: string) => void
}) {
  return (
    <div>
      <span className="label">{caption}</span>
      <div className="amount-field" style={{ marginTop: 8 }}>
        <span className="rp">Rp</span>
        <input
          value={text}
          onChange={(event) => onText(event.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="0"
          aria-label={caption}
        />
      </div>
      <div className="numpad" style={{ marginTop: 8 }}>
        {PAD.map((key) => (
          <button
            key={key}
            type="button"
            className={key === "⌫" ? "del" : undefined}
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

/// Opening the drawer.
///
/// The terminal is shown and not typed: it comes from the shell, which is the
/// only thing that knows which machine this is, and a till whose id could be
/// edited at the counter is a till whose takings can be filed under another
/// drawer.
function Opening({
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
      onDone(asReport(reply.body))
      return
    }
    setProblem(reply.problem ?? SILENT)
  }

  return (
    <>
      <div className="notice">
        Belum ada shift yang terbuka di terminal ini. Hitung modal awal di laci,
        tulis jumlahnya, lalu buka shift — mulai dari sana setiap rupiah yang
        masuk dan keluar punya tempat.
      </div>

      <div className="kv">
        <span className="muted">Terminal</span>
        <strong className="num">{terminalId}</strong>
      </div>
      <div className="kv">
        <span className="muted">Dibuka oleh</span>
        <strong>{actorId.trim() === "" ? "—" : actorId}</strong>
      </div>

      <Rupiah caption="Modal awal di laci" text={text} onText={setText} />

      {problem !== null && <p className="error">{problem}</p>}

      <div className="rows">
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void open()}
        >
          {busy ? "Membuka…" : `Buka shift dengan ${money(minorOf(text), CURRENCY)}`}
        </button>
      </div>
    </>
  )
}

/// The shift as it runs.
///
/// Note what is NOT here: penjualan tunai, dan berapa yang seharusnya ada di
/// laci. Both are in the report this screen already holds, and either one shown
/// now would be the expected figure handed to the person about to count against
/// it. They appear at the close, after a number has been committed.
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

  return (
    <>
      {report.terminal_id !== terminalId && (
        // The active-shift call names no terminal, so the node answers with the
        // earliest shift open anywhere in the shop — `any_open_shift`. One till
        // per shop makes that the same answer every time; two do not, and a
        // cashier must not find that out by counting the wrong drawer.
        <div className="notice warn">
          Shift yang terbuka ini milik terminal{" "}
          <strong>{report.terminal_id}</strong>, bukan {terminalId}. Node
          menjawab dengan shift terbuka paling awal di toko ini. Pastikan laci
          yang Anda pegang memang laci itu sebelum menyentuh uangnya.
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
          <small>Total penjualan</small>
          <strong className="num">
            {money(report.sales_total_minor, CURRENCY)}
          </strong>
        </div>
      </div>

      <div>
        <div className="kv">
          <span className="muted">Dibuka</span>
          <span>
            {when(report.opened_at)} · {report.opened_by}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Terminal</span>
          <span className="num">{report.terminal_id}</span>
        </div>
        <div className="kv">
          <span className="muted">Batal</span>
          <span>
            {report.voided_count === 0 ? (
              <span className="badge ok">Tidak ada</span>
            ) : (
              <span className="badge warn">
                {report.voided_count} transaksi ·{" "}
                {money(report.voided_total_minor, CURRENCY)}
              </span>
            )}
          </span>
        </div>
      </div>

      {closing ? (
        <Closing
          actorId={actorId}
          report={report}
          onDone={onDone}
          onCancel={() => setClosing(false)}
        />
      ) : (
        <>
          <Movement
            actorId={actorId}
            shiftId={report.shift_id}
            onDone={onDone}
          />

          <div>
            <span className="label">Pergerakan kas shift ini</span>
            <div className="rows" style={{ marginTop: 8 }}>
              {report.movements.length === 0 ? (
                <div className="empty">
                  <h3>Belum ada pergerakan</h3>
                  <p>
                    Selain penjualan, belum ada uang yang masuk atau keluar dari
                    laci ini.
                  </p>
                </div>
              ) : (
                report.movements.map((one) => (
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
                ))
              )}
            </div>
          </div>

          <div className="rows">
            <button className="btn" onClick={() => setClosing(true)}>
              Tutup shift…
            </button>
          </div>
        </>
      )}
    </>
  )
}

/// Cash that moves for a reason that is not a sale.
///
/// Two fields decide what is written: which direction, and why. The amount is
/// typed as a magnitude and signed from the direction, so the cashier never has
/// to reason about a minus, and the reason is refused here rather than at the
/// node so the refusal arrives in the language of the counter.
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
      setProblem("Isi nominalnya dulu — pergerakan kas nol tidak mencatat apa pun.")
      return
    }
    if (reason.trim() === "") {
      setProblem(
        "Alasan wajib diisi. Uang yang keluar dari laci tanpa alasan adalah baris yang tidak bisa direkonstruksi lagi saat diaudit.",
      )
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
    <div>
      <span className="label">Uang masuk / keluar laci</span>

      <div className="rows" style={{ marginTop: 8 }}>
        {MOVES.map((one) => (
          <button
            key={one.kind}
            className={one.kind === kind ? "btn primary" : "btn"}
            onClick={() => {
              setKind(one.kind)
              setProblem(null)
            }}
          >
            {one.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        {chosen.hint}
      </p>
      <div className="notice" style={{ marginTop: 8 }}>
        Pengeluaran dan koreksi tidak ada di sini: keduanya menuntut otorisasi
        supervisor pada permintaannya, dan terminal ini belum punya jalan untuk
        mengirimkannya.
      </div>

      <div style={{ marginTop: 12 }}>
        <Rupiah caption="Nominal" text={text} onText={setText} />
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        Alasan (wajib)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Misalnya: setor ke brankas sore, amplop 3"
          autoComplete="off"
        />
      </label>

      {problem !== null && <p className="error">{problem}</p>}

      <div className="rows" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={() => void send()}>
          {busy
            ? "Mencatat…"
            : `Catat ${chosen.label.toLowerCase()} ${money(amount, CURRENCY)}`}
        </button>
      </div>
    </div>
  )
}

/// The count.
///
/// The declared figure is the cashier's and is sent exactly as typed — the node
/// computes its own expectation and stores both, so the two can never be
/// reconciled after the fact into agreeing. What the node expects is fetched
/// here and kept out of sight until a figure has been committed: shown earlier
/// it would be a target, and a count that has seen its target is not a count.
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
  const [text, setText] = useState("")
  const [note, setNote] = useState("")
  const [expected, setExpected] = useState<ShiftReport | null>(null)
  // Why there is no figure to compare against, when there is none. A close is
  // still allowed without it: the declaration is the cashier's either way, and
  // the node does its own arithmetic when the close lands.
  const [blind, setBlind] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const attempt = useIdempotency()

  // Asked again rather than taken from the report already on screen: a till
  // that has been selling while this panel was opened has moved on, and the
  // figure worth comparing to is the one from a second ago.
  useEffect(() => {
    void (async () => {
      const reply = await shiftReport(report.shift_id)
      if (!reply.ok) {
        setBlind(reply.problem ?? SILENT)
        return
      }
      const fresh = asReport(reply.body)
      if (fresh === null) {
        setBlind(UNREADABLE)
        return
      }
      setExpected(fresh)
    })()
  }, [report.shift_id])

  const counted = text !== ""
  const declared = minorOf(text)
  const gap = expected === null ? null : declared - expected.expected_cash_minor

  async function close() {
    if (actorId.trim() === "") {
      setProblem(NAMELESS)
      return
    }
    if (!counted) {
      setProblem("Tulis dulu jumlah uang yang Anda hitung di laci.")
      return
    }
    // A difference with no explanation is the thing somebody has to guess at
    // next week. The node does not demand it; the counter does, while the
    // person who counted is still standing at the drawer.
    if (gap !== null && gap !== 0 && note.trim() === "") {
      setProblem(
        "Ada selisih. Tulis catatan singkat sekarang, selagi Anda masih di depan laci — nanti tidak ada lagi yang ingat.",
      )
      return
    }
    setBusy(true)
    setProblem(null)
    const draft = {
      declared_cash_minor: declared,
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

  return (
    <div>
      <div className="notice">
        Hitung dulu uang tunai di laci, lalu tulis jumlahnya. Angka yang
        diharapkan node sengaja belum ditampilkan: hitungan yang sudah melihat
        targetnya bukan lagi hitungan.
      </div>

      <div style={{ marginTop: 12 }}>
        <Rupiah
          caption="Uang tunai yang Anda hitung"
          text={text}
          onText={setText}
        />
      </div>

      {counted && (
        <div style={{ marginTop: 12 }}>
          {blind !== null ? (
            <>
              <div className="notice warn">
                Node belum memberi angka pembanding, jadi selisihnya baru
                dihitung saat shift ditutup. Yang Anda tulis tetap yang dikirim.
              </div>
              <p className="error">{blind}</p>
            </>
          ) : expected === null ? (
            <div className="notice">Mengambil angka node…</div>
          ) : (
            <>
              <div className="kv">
                <span className="muted">Anda hitung</span>
                <strong className="num">{money(declared, CURRENCY)}</strong>
              </div>
              <div className="kv">
                <span className="muted">Menurut node</span>
                <strong className="num">
                  {money(expected.expected_cash_minor, CURRENCY)}
                </strong>
              </div>
              <div className="kv">
                <span className="muted">Selisih</span>
                <Gap gap={gap ?? 0} />
              </div>
            </>
          )}
        </div>
      )}

      <label className="field" style={{ marginTop: 12 }}>
        Catatan{gap !== null && gap !== 0 ? " (wajib — ada selisih)" : " (opsional)"}
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Misalnya: kurang 5rb, kembalian salah hitung"
          autoComplete="off"
        />
      </label>

      {problem !== null && <p className="error">{problem}</p>}

      <div className="rows" style={{ marginTop: 12 }}>
        <button
          className="btn danger"
          disabled={busy}
          onClick={() => void close()}
        >
          {busy ? "Menutup…" : "Tutup shift dan kunci angkanya"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>
          Batal, shift tetap terbuka
        </button>
      </div>
    </div>
  )
}

/// The difference, in the direction a cashier thinks in. Short is not an error
/// state and long is not a success; both are facts that need looking at, so
/// neither is drawn in green.
function Gap({ gap }: { gap: number }) {
  if (gap === 0) return <span className="badge ok">Cocok</span>
  return (
    <span className={gap < 0 ? "badge bad" : "badge warn"}>
      {gap < 0 ? "Kurang " : "Lebih "}
      {money(Math.abs(gap), CURRENCY)}
    </span>
  )
}

/// What the shift came to, as the node recorded it.
///
/// Every figure below is read back from the close reply rather than recomputed
/// here: the variance is stored at the node the moment the drawer is closed,
/// and a screen that recalculated it could only ever disagree with the books.
function Closed({
  report,
  onAgain,
}: {
  report: ShiftReport
  onAgain: () => void
}) {
  return (
    <>
      <div className="notice">
        Shift <span className="num">{report.shift_id}</span> sudah ditutup
        {report.closed_at !== null && ` pada ${when(report.closed_at)}`}
        {report.closed_by !== null && ` oleh ${report.closed_by}`}. Angkanya
        terkunci — shift yang sudah tutup tidak bisa ditutup dua kali.
      </div>

      <div className="stats">
        <div className="stat">
          <small>Dihitung kasir</small>
          <strong className="num">
            {report.declared_cash_minor === null
              ? "—"
              : money(report.declared_cash_minor, CURRENCY)}
          </strong>
        </div>
        <div className="stat">
          <small>Menurut node</small>
          <strong className="num">
            {money(report.expected_cash_minor, CURRENCY)}
          </strong>
        </div>
        <div className="stat">
          <small>Selisih</small>
          <strong className="num">
            {report.variance_minor === null ? (
              "—"
            ) : (
              <Gap gap={report.variance_minor} />
            )}
          </strong>
        </div>
      </div>

      <div>
        <div className="kv">
          <span className="muted">Modal awal</span>
          <span className="num">
            {money(report.opening_float_minor, CURRENCY)}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Penjualan tunai</span>
          <span className="num">{money(report.cash_sales_minor, CURRENCY)}</span>
        </div>
        <div className="kv">
          <span className="muted">Kembalian keluar</span>
          <span className="num">
            {money(report.change_given_minor, CURRENCY)}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Retur tunai</span>
          <span className="num">
            {money(report.cash_refunds_minor, CURRENCY)}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Pergerakan kas</span>
          <span className="num">
            {money(report.cash_movements_minor, CURRENCY)}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Bukan tunai</span>
          <span className="num">{money(report.non_cash_minor, CURRENCY)}</span>
        </div>
        {report.note !== null && (
          <div className="kv">
            <span className="muted">Catatan</span>
            <span>{report.note}</span>
          </div>
        )}
      </div>

      {report.tenders.length > 0 && (
        <div>
          <span className="label">Per metode bayar</span>
          <div className="rows" style={{ marginTop: 8 }}>
            {report.tenders.map((one) => (
              <div className="row-item" key={one.method}>
                <div className="grow">
                  <h3>{TENDER[one.method] ?? one.method}</h3>
                  <p>{one.count} transaksi</p>
                </div>
                <strong className="num">
                  {money(one.amount_minor, CURRENCY)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rows">
        <button className="btn primary" onClick={onAgain}>
          Buka shift baru
        </button>
      </div>
    </>
  )
}
