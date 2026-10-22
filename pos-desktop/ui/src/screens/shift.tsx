import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import {
  cashMovement,
  closeShift,
  countShift,
  myShifts,
  takeOver,
  tillSeats,
} from "@/api"
import { Icon } from "@/icons"
import { useOutbox } from "@/outbox"
import { refreshPaymentMethods } from "@/payment-methods"
import type { Seat } from "@/seat"
import { useSession } from "@/session"
import { titled } from "@/simulation"
import { Topbar } from "@/till"
import type { ShiftReport, TillSeat } from "@itulah/contract"
import { money } from "@itulah/contract/money"

/// The cash session — one person's drawer at one seat, from the float they
/// count in when they sit down to the count they make when they leave.
///
/// A till is a seat the store has (`Kasir 1` … `Kasir N`, head office sets N),
/// not the machine: whoever signs in picks one. Anyone may take a seat somebody
/// else holds, by themselves and with no approval — that ends the other
/// person's shift at once with nothing declared, and *they* count what they took
/// out when they next sign in (`Uncounted`). The person arriving always counts
/// in their own float.
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
    label: "Drop to the safe",
  },
  {
    kind: "PICKUP",
    sign: 1,
    label: "Add cash to the drawer",
  },
] as const

type MoveKind = (typeof MOVES)[number]["kind"]

/// The node names movements in English on the wire; the counter reads
/// Indonesian. Anything unknown prints as it arrived rather than as a blank.
const MOVEMENT: Record<string, string> = {
  OPENING_FLOAT: "Opening float",
  DROP: "Drop to the safe",
  PAYOUT: "Payout",
  PICKUP: "Cash into the drawer",
  CORRECTION: "Correction",
}

/// `EdgeReply.problem` is typed nullable but the shell fills it on every
/// refusal. If it ever is not, say that plainly rather than render nothing and
/// leave a cashier looking at a button that did something invisible.
const SILENT = "The store node refused without giving a reason."

/// `actor_id` is required by the node, and when the node runs with auth switched
/// off it is NOT overwritten from a session — whatever this screen sends is what
/// the ledger keeps forever. Checked here so the refusal names the real problem.
const NAMELESS = "Sign in first."

function minorOf(text: string): number {
  return Number(text.replace(/\D/g, "")) || 0
}

/// A timestamp a cashier can read. RFC3339 from the node; anything else is
/// shown as it arrived rather than as "Invalid Date".
function when(stamp: string): string {
  const at = new Date(stamp)
  return Number.isNaN(at.getTime())
    ? stamp
    : at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
}

/// The Z report, out of a reply the wrapper types loosely.
///
/// `api.ts` types `closeShift`, `countShift` and `cashMovement` bodies as
/// `Record<string, unknown>`, but every one of these handlers returns the whole
/// `ShiftReport`. Rather than assert that, the two fields this screen actually
/// steers on are checked, and a body carrying neither is reported as unreadable
/// instead of being drawn as an empty drawer.
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

/// `14:05`, the way a shift is spoken of at the counter. Anything that is not a
/// timestamp is shown as it arrived.
function clock(stamp: string): string {
  const at = new Date(stamp)
  if (Number.isNaN(at.getTime())) return stamp
  const two = (n: number) => String(n).padStart(2, "0")
  return `${two(at.getHours())}:${two(at.getMinutes())}`
}

/// The seat a shift sits at, in the shape the rest of the app keeps it.
function seatOf(report: ShiftReport): Seat {
  return {
    terminal_id: report.terminal_id,
    label: report.terminal_label === "" ? report.terminal_id : report.terminal_label,
    shift_id: report.shift_id,
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
  finishing = false,
  onBack,
  onClosed,
  onLeave,
  onOpenShift,
}: {
  actorId: string
  /// Opened from Finish shift: start straight at counting the drawer.
  finishing?: boolean
  onBack: () => void
  /// The node has closed this person's shift. Fired the moment it is known, so
  /// the till stops treating the seat as theirs while the count is still on
  /// screen.
  onClosed: () => void
  /// The shift is finished and counted: the person is done, and signed out.
  onLeave: () => void
  /// No shift is open: back to the opening float.
  onOpenShift: () => void
}) {
  const [reading, setReading] = useState<Reading>({ kind: "reading" })

  const read = useCallback(async () => {
    setReading({ kind: "reading" })
    // The person's own drawer, not `activeShift` ("any open shift on the
    // node"): with several seats open, that one names somebody else's.
    const reply = await myShifts()
    if (!reply.ok) {
      setReading({ kind: "unknown", problem: reply.problem ?? SILENT })
      return
    }
    const report = reply.body.open
    setReading(
      report === null
        ? { kind: "none" }
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
      if (report.status !== "OPEN") onClosed()
      setReading(
        report.status === "OPEN"
          ? { kind: "open", report }
          : { kind: "closed", report },
      )
    },
    [read, onClosed],
  )

  let panel: ReactNode
  if (reading.kind === "reading") {
    panel = (
      <div className="empty">
        <h3>Loading shift…</h3>
      </div>
    )
  } else if (reading.kind === "unknown") {
    panel = (
      <>
        <p className="error">{reading.problem}</p>
        <div className="rows">
          <button className="btn primary" onClick={() => void read()}>
            Try again
          </button>
        </div>
      </>
    )
  } else if (reading.kind === "none") {
    // A shift is opened at the gate, not here: no shift now means it was
    // ended or taken over, and the opening float is where that is put right.
    panel = (
      <>
        <p className="notice warn">You have no open shift.</p>
        <div className="rows">
          <button className="btn primary" onClick={onOpenShift}>
            Open shift
          </button>
        </div>
      </>
    )
  } else if (reading.kind === "open") {
    panel = (
      <Running
        actorId={actorId}
        report={reading.report}
        startClosing={finishing}
        onDone={onDone}
      />
    )
  } else {
    panel = <Closed report={reading.report} onLeave={onLeave} />
  }

  const label =
    reading.kind === "open" || reading.kind === "closed"
      ? reading.report.terminal_label
      : ""

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} />
      <main className="page">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <h1>Shift &amp; cash</h1>
              {label !== "" && <p className="num">{label}</p>}
            </div>
            {/* A finished shift has no counter to go back to: the way on is
                Done, which signs the person out. */}
            {reading.kind !== "closed" && (
              <button className="btn ghost" onClick={onBack}>
                <Icon name="back" />
                Back to counter
              </button>
            )}
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
            aria-label={key === "⌫" ? "Delete one digit" : undefined}
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

/// Sitting down at a seat: the float counted into the drawer. Free seat or one
/// taken over, the person arriving always enters their own — the previous
/// holder's money left with them and is theirs to count.
function Opening({
  actorId,
  seat,
  onDone,
  onCancel,
}: {
  actorId: string
  seat: TillSeat
  onDone: (report: ShiftReport | null) => void
  onCancel: () => void
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
      terminal_id: seat.terminal_id,
      opening_float_minor: minorOf(text),
      actor_id: actorId,
    }
    // One call for a free seat and a held one alike: the node ends the old
    // shift first when there is one, and answers `ended: null` when not.
    const reply = await takeOver({
      ...draft,
      idempotency_key: attempt.keyFor(draft),
    })
    setBusy(false)
    if (reply.ok) {
      attempt.spent()
      // A new shift is when Finance's latest payment methods are picked up.
      void refreshPaymentMethods()
      onDone(asReport(reply.body?.shift))
      return
    }
    setProblem(reply.problem ?? SILENT)
  }

  return (
    <form
      className="rows"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && minorOf(text) > 0) void open()
      }}
    >
      <Rupiah caption="Opening float" text={text} onText={setText} autoFocus />

      {problem !== null && <p className="error">{problem}</p>}

      {/* A shift opens on counted cash: an empty drawer is counted as
          nothing, and nothing is not a float. */}
      <button
        className="btn primary lg"
        type="submit"
        disabled={busy || minorOf(text) <= 0}
      >
        {busy ? "Opening…" : `Open shift · ${money(minorOf(text), CURRENCY)}`}
      </button>
      <button className="btn ghost" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}

/// A drawer somebody took over from this person, waiting to be counted.
///
/// Their shift ended when the other person sat down, with nothing declared —
/// what they took out of the drawer is theirs to count, blind, the same way a
/// close is. Nobody can skip it (they may sign out); the till does not open
/// until every one is counted.
function Uncounted({
  actorId,
  report,
  onCounted,
}: {
  actorId: string
  report: ShiftReport
  onCounted: () => void
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Count the {report.terminal_label} drawer</h1>
          <p>
            Your shift was taken over by {report.taken_over_by ?? "someone else"}
            {report.closed_at !== null && ` at ${clock(report.closed_at)}`}.
            Count the cash you took out of the drawer.
          </p>
        </div>
      </div>
      <Closing
        actorId={actorId}
        report={report}
        counting
        onDone={() => onCounted()}
      />
    </>
  )
}

type Gate =
  | { readonly kind: "asking" }
  | { readonly kind: "problem"; readonly problem: string }
  | { readonly kind: "count"; readonly report: ShiftReport }
  /// Their shift is open, but at another kasir. A drawer is a place: selling
  /// here on that shift would put this drawer's cash in the other one's books.
  | { readonly kind: "elsewhere"; readonly report: ShiftReport }
  | { readonly kind: "closing"; readonly report: ShiftReport }
  | { readonly kind: "opening"; readonly seat: TillSeat }

/// Whether a seat is this till's. The web till is installed as the seat id
/// (`KASIR-2`); a desktop that joined carries the seat's label (`Kasir 2`).
function isThisTill(terminalId: string, id: string, label: string): boolean {
  return id === terminalId || (label !== "" && label === terminalId)
}

/// Straight after sign-in, and again whenever a person has lost their shift:
/// what does this person owe, and then the float for the kasir this till is.
///
/// In that order. A drawer somebody took over from them comes first and cannot
/// be skipped — money that was never counted is money nobody can account for.
/// Then, if they already hold a shift (a refresh, a second window), the till
/// simply carries on. Otherwise the opening float is asked for straight away.
///
/// There is no choosing: this till is installed as one kasir (`KASIR-n`), and
/// the float is for that one. Whoever held it before and left the shift open
/// has it ended by this opening, and counts their own drawer next time.
export function ShiftGate({
  actorId,
  notice,
  onReady,
  onSignOut,
}: {
  actorId: string
  /// Why the person is here again, when it is not a fresh sign-in.
  notice?: string | null
  onReady: (seat: Seat) => void
  onSignOut: () => void
}) {
  const { terminalId, me } = useSession()
  const name = me?.display_name ?? me?.username ?? actorId
  const [state, setState] = useState<Gate>({ kind: "asking" })
  const alive = useRef(true)

  const look = useCallback(async () => {
    setState({ kind: "asking" })
    const mine = await myShifts()
    if (!alive.current) return
    if (!mine.ok) {
      setState({ kind: "problem", problem: mine.problem ?? SILENT })
      return
    }
    const owed = mine.body.uncounted[0]
    if (owed !== undefined) {
      setState({ kind: "count", report: owed })
      return
    }
    const open = mine.body.open
    if (open !== null) {
      if (isThisTill(terminalId, open.terminal_id, open.terminal_label)) {
        onReady(seatOf(open))
      } else {
        setState({ kind: "elsewhere", report: open })
      }
      return
    }
    const seats = await tillSeats()
    if (!alive.current) return
    if (!seats.ok) {
      setState({ kind: "problem", problem: seats.problem ?? SILENT })
      return
    }
    const seat = seats.body.find(
      (one) => isThisTill(terminalId, one.terminal_id, one.label) && one.current,
    )
    setState(
      seat === undefined
        ? {
            kind: "problem",
            problem: `This till is not set up as a kasir yet (${terminalId}). Ask head office to set the kasir for this store.`,
          }
        : { kind: "opening", seat },
    )
  }, [onReady, terminalId])

  useEffect(() => {
    alive.current = true
    void look()
    return () => {
      alive.current = false
    }
  }, [look])

  return (
    <div id="app" data-screen="sale">
      <Topbar actorId={actorId} />
      <main className="page">
        <div className="page-inner" style={{ maxWidth: 440 }}>
          {notice !== undefined && notice !== null && (
            <div className="notice warn" role="status">
              {notice}
            </div>
          )}
          {state.kind === "asking" ? (
            <div className="empty">
              <h3>Loading shift…</h3>
            </div>
          ) : state.kind === "problem" ? (
            <>
              <p className="error">{state.problem}</p>
              <div className="rows">
                <button className="btn primary" onClick={() => void look()}>
                  Try again
                </button>
                <button className="btn ghost" onClick={onSignOut}>
                  Cancel
                </button>
              </div>
            </>
          ) : state.kind === "count" ? (
            <Uncounted
              actorId={actorId}
              report={state.report}
              onCounted={() => void look()}
            />
          ) : state.kind === "elsewhere" ? (
            <>
              <div className="page-head">
                <div>
                  <h1>Your shift is open at {seatOf(state.report).label}</h1>
                  <p>
                    {name} · since {clock(state.report.opened_at)}
                  </p>
                </div>
              </div>
              <div className="rows">
                <button
                  className="btn primary lg"
                  onClick={() => setState({ kind: "closing", report: state.report })}
                >
                  Count and close it
                </button>
                <button className="btn ghost" onClick={onSignOut}>
                  Sign out
                </button>
              </div>
            </>
          ) : state.kind === "closing" ? (
            <>
              <div className="page-head">
                <div>
                  <h1>Close {seatOf(state.report).label}</h1>
                  <p>{name}</p>
                </div>
              </div>
              <Closing
                actorId={actorId}
                report={state.report}
                onDone={() => void look()}
                onCancel={() => setState({ kind: "elsewhere", report: state.report })}
              />
            </>
          ) : (
            <>
              <div className="page-head">
                <div>
                  <h1>Opening float</h1>
                  <p>
                    {name} · {state.seat.label}
                  </p>
                </div>
              </div>
              {state.seat.held_by !== null && (
                <div className="notice warn" role="status">
                  {titled(state.seat.held_by)}&apos;s shift is still open on{" "}
                  {state.seat.label}. Opening yours ends it, and they count
                  their own drawer later.
                </div>
              )}
              <Opening
                actorId={actorId}
                seat={state.seat}
                onDone={(report) => {
                  if (report !== null) onReady(seatOf(report))
                  else void look()
                }}
                onCancel={onSignOut}
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
  report,
  startClosing,
  onDone,
}: {
  actorId: string
  report: ShiftReport
  startClosing: boolean
  onDone: (report: ShiftReport | null) => void
}) {
  const [closing, setClosing] = useState(startClosing)
  const outbox = useOutbox()
  // A sale the node has not acknowledged belongs to this drawer, and closing
  // fixes what the drawer should hold. Closed first, it would arrive afterwards
  // as cash nobody counted.
  const owed = outbox.unsent + outbox.refused

  // A blind count shows nothing that points at the expected figure — not the
  // takings, not the movements — from the moment counting starts. Not while a
  // sale is owed, though: Finish shift in the header opens straight at the
  // count, and must not get round the block below. A refused sale stays owed
  // until a store manager resolves it on the counter screen.
  if (closing && owed === 0) {
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
      <div className="stats">
        <div className="stat">
          <small>Opening float</small>
          <strong className="num">
            {money(report.opening_float_minor, CURRENCY)}
          </strong>
        </div>
        <div className="stat">
          <small>Sales</small>
          <strong className="num">{report.sale_count}</strong>
        </div>
        <div className="stat">
          <small>Opened</small>
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
            {report.voided_count} sales ·{" "}
            {money(report.voided_total_minor, CURRENCY)}
          </span>
        </div>
      )}

      <Movement actorId={actorId} shiftId={report.shift_id} onDone={onDone} />

      {report.movements.length > 0 && (
        <div>
          <span className="label">Cash movements</span>
          <div className="rows" style={{ marginTop: 8 }}>
            {report.movements.map((one) => (
              <div className="row-item" key={one.id}>
                <div className="grow">
                  <h3>{MOVEMENT[one.kind] ?? one.kind}</h3>
                  <p>
                    {one.reason} · {when(one.occurred_at)} · {one.actor_id}
                    {one.approved_by !== null && ` · approved by ${one.approved_by}`}
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
        {owed > 0 && (
          <p className="error">
            {outbox.unsent > 0
              ? `${outbox.unsent} sales not yet sent to the node — wait until they are sent before finishing the shift.`
              : `${outbox.refused} sales refused by the node — a store manager resolves them on the counter screen before the shift can be finished.`}
          </p>
        )}
        <button
          className="btn danger lg"
          onClick={() => setClosing(true)}
          disabled={owed > 0}
        >
          <Icon name="lock" />
          Finish shift
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
      setProblem("Enter the amount.")
      return
    }
    if (reason.trim() === "") {
      setProblem("A reason is required.")
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
      <span className="label">Cash in / out of the drawer</span>
      <div className="segmented" role="radiogroup" aria-label="Movement type">
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

      <Rupiah caption="Amount" text={text} onText={setText} />

      <label className="field">
        Reason
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="For example: afternoon drop, envelope 3"
          autoComplete="off"
        />
      </label>

      {problem !== null && <p className="error">{problem}</p>}

      <button className="btn" disabled={busy} onClick={() => void send()}>
        {busy ? "Recording…" : `Record · ${money(amount, CURRENCY)}`}
      </button>
    </div>
  )
}

/// Closing the drawer, counted blind. Also counting one that was taken over
/// (`counting`): the same sheet, the same blindness, sent to `countShift` —
/// the shift is already closed, so there is nothing to cancel back out of.
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
  counting = false,
}: {
  actorId: string
  report: ShiftReport
  onDone: (report: ShiftReport | null) => void
  onCancel?: () => void
  counting?: boolean
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
    const send = counting ? countShift : closeShift
    const reply = await send(report.shift_id, {
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
        <span className="label">Check the count</span>
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
          <span>Total counted</span>
          <strong className="num">{money(declared, CURRENCY)}</strong>
        </div>
        <label className="field">
          Note (optional)
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
          {busy
            ? counting
              ? "Sending…"
              : "Finishing…"
            : counting
              ? "Lock the count"
              : "Lock the count and finish shift"}
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Count again
        </button>
      </div>
    )
  }

  return (
    <div className="rows">
      <div className="page-head" style={{ alignItems: "center" }}>
        <div>
          <span className="label">
            {counting ? "Count the cash in the drawer" : "Finish shift · count the cash in the drawer"}
          </span>
        </div>
        {onCancel !== undefined && (
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div className="denom-grid">
        {DENOMINATIONS.map((value) => (
          <div className="denom-row" key={value}>
            <span className="num">{money(value, CURRENCY)}</span>
            <div className="qty">
              <button
                type="button"
                aria-label={`Fewer ${money(value, CURRENCY)}`}
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
                aria-label={`Number of notes ${money(value, CURRENCY)}`}
              />
              <button
                type="button"
                aria-label={`More ${money(value, CURRENCY)}`}
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
        <span>Total counted</span>
        <strong className="num">{money(declared, CURRENCY)}</strong>
      </div>

      <button className="btn primary lg" onClick={() => setConfirming(true)}>
        Continue
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
  onLeave,
}: {
  report: ShiftReport
  onLeave: () => void
}) {
  return (
    <>
      <div className="pay-done" style={{ flex: "none", padding: "8px 0" }}>
        <span className="seal">
          <Icon name="check" />
        </span>
        <h3>Shift finished</h3>
      </div>

      <div className="count-total">
        <span>Cash you counted</span>
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
          <span className="muted">Finished</span>
          <span>
            {report.closed_at !== null ? when(report.closed_at) : "—"}
            {report.closed_by !== null && ` · ${report.closed_by}`}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Sales</span>
          <span className="num">{report.sale_count}</span>
        </div>
        {report.note !== null && (
          <div className="kv">
            <span className="muted">Note</span>
            <span style={{ textAlign: "right" }}>{report.note}</span>
          </div>
        )}
      </div>

      <div className="rows">
        <button className="btn primary" onClick={onLeave}>
          Done
        </button>
      </div>
    </>
  )
}
