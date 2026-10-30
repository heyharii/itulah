import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"

import {
  closeShift,
  countShift,
  edcMachines,
  myShifts,
  takeOver,
  tillSeats,
} from "@/api"
import { Icon } from "@/icons"
import { CLOSE_KEY, DRAWER_KEY } from "@/keybar"
import { siteTitle } from "@/joining"
import { useOutbox } from "@/outbox"
import { refreshPaymentMethods } from "@/payment-methods"
import type { Seat } from "@/seat"
import { handedOverBy, useNodeConfig, useSession } from "@/session"
import { isKey, useShortcuts, viaPointer } from "@/shortcuts"
import { titled } from "@/simulation"
import { initials, kasirLabel, Topbar } from "@/till"
import type { ShiftReport, TillSeat } from "@itulah/contract"
import { money } from "@itulah/contract/money"
import {
  CashSlipPaper,
  CutLabels,
  Denoms,
  fmt,
  PrintCopy,
  printSlip,
  Row,
  shopOf,
  ShopHead,
  Signs,
  ThermalSheet,
  type Shop,
} from "@/screens/thermal"
import "@/shift-d.css"
import "@/exchange-d.css"

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

/// The node names movements in English on the wire; the counter reads
/// Indonesian. Anything unknown prints as it arrived rather than as a blank.
const MOVEMENT: Record<string, string> = {
  OPENING_FLOAT: "Saldo awal",
  DROP: "Setoran sementara",
  PAYOUT: "Uang keluar",
  PICKUP: "Tambah modal kasir",
  FLOAT_RETURN: "Modal disetor",
}

/// The float this drawer stands on now: what it was opened with, and every
/// "Tambah modal kasir" (PICKUP) since. The till no longer offers
/// CORRECTION, but one already on an old shift still counts, so the closing
/// paper stays right. Exported for the ⇧3 Laci dialogs (laci.tsx).
export function floatOf(report: ShiftReport): number {
  return (
    report.opening_float_minor +
    report.movements
      .filter((one) => one.kind === "PICKUP" || one.kind === "CORRECTION")
      .reduce((sum, one) => sum + one.amount_minor, 0)
  )
}

/// What went back to the Kepala toko by "Setor modal" (`FLOAT_RETURN`), and to
/// whom (their name; null when the node does not say). The shift report carries
/// both as `float_returned_minor` / `float_returned_to`; a node that does not
/// yet say it is read from the movements, and a node that knows nothing of it
/// gives zero.
export function floatReturnedOf(report: ShiftReport): {
  readonly minor: number
  readonly to: string | null
} {
  const said = report as ShiftReport & {
    float_returned_minor?: number | null
    float_returned_to?: string | null
  }
  const minor =
    typeof said.float_returned_minor === "number"
      ? said.float_returned_minor
      : report.movements
          .filter((one) => one.kind === "FLOAT_RETURN")
          .reduce((sum, one) => sum + Math.abs(one.amount_minor), 0)
  const to = typeof said.float_returned_to === "string" && said.float_returned_to.trim() !== ""
    ? said.float_returned_to
    : null
  return { minor, to }
}

/// The float still in the drawer: what it stands on, less what was handed to
/// the Kepala toko. Setor modal takes all of it; Tambah modal grows it again.
export function floatLeftOf(report: ShiftReport): number {
  return Math.max(0, floatOf(report) - floatReturnedOf(report).minor)
}

/// `EdgeReply.problem` is typed nullable but the shell fills it on every
/// refusal. If it ever is not, say that plainly rather than render nothing and
/// leave a cashier looking at a button that did something invisible.
const SILENT = "Server toko menolak tanpa alasan."

/// `actor_id` is required by the node, and when the node runs with auth switched
/// off it is NOT overwritten from a session — whatever this screen sends is what
/// the ledger keeps forever. Checked here so the refusal names the real problem.
const NAMELESS = "Masuk dulu."

function minorOf(text: string): number {
  return Number(text.replace(/\D/g, "")) || 0
}

/// A timestamp a cashier can read. RFC3339 from the node; anything else is
/// shown as it arrived rather than as "Invalid Date".
function when(stamp: string): string {
  const at = new Date(stamp)
  return Number.isNaN(at.getTime())
    ? stamp
    : `${at.getDate()} ${MON[at.getMonth()]} ${at.getFullYear()}, ${clock(stamp)}`
}

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

/// What a shift report carries since 25 Oct 2026, which the contract's
/// generated type has not caught up with: each EDC machine the shift used, and
/// the slips the cashier counted off it. The node's own count is never read
/// here — a cashier is not shown the figure a count could be worked toward.
type EdcLine = {
  readonly machine_id: string
  readonly machine_name: string
  readonly slips: number | null
}

const edcOf = (report: ShiftReport): readonly EdcLine[] =>
  (report as ShiftReport & { readonly edc_slips?: readonly EdcLine[] }).edc_slips ?? []

/// The paper vouchers the cashier counted off the drawer at close; null until counted.
const vouchersOf = (report: ShiftReport): number | null => {
  const counted = (report as ShiftReport & { readonly vouchers_counted?: number | null }).vouchers_counted
  return typeof counted === "number" ? counted : null
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
/// payment page counts change out in, and the order the closing paper prints.
/// Rp 1.000 is one line, note and coin together, as 7Soft's Closing Cashier.
const DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const

/// The order a drawer is counted in: Rp 100.000 first, down to the smallest
/// coin (client, 28 Oct 2026: "dari yang paling besar ke paling kecil").
const COUNT_ORDER = DENOMINATIONS

const two = (n: number) => String(n).padStart(2, "0")
const hhmm = (at: Date) => `${two(at.getHours())}:${two(at.getMinutes())}`

/// `08:58`, kept current while a screen is up.
function useHm(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(tick)
  }, [])
  return hhmm(now)
}

/// A kasir and the shop it stands in, the way every header of the prototype
/// says it: "Kasir 1 · C011 Spin".
function usePlace(kasir: string): string {
  const { config } = useNodeConfig()
  const site =
    config?.joined != null ? siteTitle(config.joined).replace(" · ", " ") : ""
  return site === "" ? kasir : `${kasir} · ${site}`
}

/// Each note and coin as the counter sees it: a note is a coloured card, a coin
/// a disc, and Rp 1.000 is both on one row.
const CHIP: Readonly<
  Record<number, { kind: "note" | "coin" | "both"; c: string; c2?: string }>
> = {
  100_000: { kind: "note", c: "#d0484d" },
  50_000: { kind: "note", c: "#2f6fb8" },
  20_000: { kind: "note", c: "#2f9461" },
  10_000: { kind: "note", c: "#7f55ad" },
  5_000: { kind: "note", c: "#a8743a" },
  2_000: { kind: "note", c: "#7b7f88" },
  1_000: { kind: "both", c: "#5d9a88", c2: "#c9cbd0" },
  500: { kind: "coin", c: "#cdb36a" },
  200: { kind: "coin", c: "#c3c6cc" },
  100: { kind: "coin", c: "#c9cbd0" },
}

function MoneyChip({ value }: { value: number }) {
  const chip = CHIP[value]
  if (chip === undefined) return null
  const paint = (c: string) => ({ "--c": c }) as CSSProperties
  if (chip.kind === "coin") return <span className="coin-chip" style={paint(chip.c)} />
  if (chip.kind === "both") {
    return (
      <span className="duo">
        <span className="note-chip" style={paint(chip.c)} />
        <span className="coin-chip" style={paint(chip.c2 ?? chip.c)} />
      </span>
    )
  }
  return <span className="note-chip" style={paint(chip.c)} />
}

const PrinterIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
    <rect x="6" y="14" width="12" height="8" rx="1" />
  </svg>
)

const DelIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />
    <path d="m12 9 6 6" />
    <path d="m18 9-6 6" />
  </svg>
)

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
        <h3 />
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
    // A shift is opened at the gate, not here: no shift now means it was
    // ended or taken over, and the opening float is where that is put right.
    panel = (
      <>
        <p className="notice warn">Belum ada shift yang dibuka.</p>
        <div className="rows">
          <button className="btn primary" onClick={onOpenShift}>
            Buka kasir
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
        onBack={onBack}
      />
    )
  } else {
    panel = <Closed report={reading.report} onLeave={onLeave} />
  }

  // ⇧4 goes straight to the count: no "Shift & kas" page flashing first.
  if (finishing && (reading.kind === "reading" || reading.kind === "open")) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#e8ebf0" }}>
        {reading.kind === "open" ? panel : null}
      </div>
    )
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
              <h1>Shift &amp; kas</h1>
              {label !== "" && <p className="num">{label}</p>}
            </div>
            {/* A finished shift has no counter to go back to: the way on is
                Done, which signs the person out. */}
            {reading.kind !== "closed" && (
              <button className="btn ghost" onClick={onBack}>
                <Icon name="back" />
                Kembali ke kasir
              </button>
            )}
          </div>
          {panel}
        </div>
      </main>
    </div>
  )
}

/// The till's usual float (the client's "Modal"), Rp 500.000 on the opening
/// video of 22 Oct 2026. The field opens on it; typing replaces it.
const DEFAULT_FLOAT = "500000"

/// What a cashier can start a float from with one touch.
const PRESETS = [300_000, 500_000, 1_000_000] as const

/// The pad of the opening float, in the prototype's order.
const FLOAT_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "000", "0", "del"] as const

/// The door's card, on the stone, with whatever the page has to say under it.
/// One card for every state of the gate, so a swap is the inside moving and the
/// card staying where it is.
function Door({
  children,
  below,
  popup = false,
  small = false,
}: {
  children: ReactNode
  below?: ReactNode
  popup?: boolean
  small?: boolean
}) {
  return (
    <div className={`shd shd-door${popup ? " shd-inline" : ""}`}>
      <div className={`d-card m-lift${small ? " sm" : ""}`}>{children}</div>
      {below}
    </div>
  )
}

/// "● Central online · Kasir 1 · C011 Spin · 08:58", under the card.
function Status({ place }: { place: string }) {
  const hm = useHm()
  return (
    <p className="d-status m-lift">
      <span className="live" />
      <span>Central online</span>
      <span className="dot">·</span>
      <span>{place}</span>
      <span className="dot">·</span>
      <span>{hm}</span>
    </p>
  )
}

/// Sitting down at a seat: the float counted into the drawer. Free seat or one
/// taken over, the person arriving always enters their own — the previous
/// holder's money left with them and is theirs to count.
///
/// The amount opens on the till's usual float and selected, so the first key
/// typed replaces it. The keys are the window's, not a field's: the pad and the
/// keyboard both work without anything having to hold the caret.
function Opening({
  actorId,
  seat,
  name,
  sub,
  leaveLabel,
  onDone,
  onCancel,
  onProblem,
}: {
  actorId: string
  seat: TillSeat
  name: string
  /// Under the name: who opened the till for them, or where the kasir is.
  sub: string
  leaveLabel: string
  onDone: (report: ShiftReport | null) => void
  onCancel: () => void
  /// Said under the card, where the status line is.
  onProblem: (problem: string | null) => void
}) {
  const [text, setText] = useState(DEFAULT_FLOAT)
  // True while the amount is the one it opened on, or a preset: the next key
  // starts over instead of adding to it.
  const [fresh, setFresh] = useState(true)
  const [busy, setBusy] = useState(false)
  const attempt = useIdempotency()
  const amount = minorOf(text)

  async function open() {
    if (busy || amount <= 0) return
    if (actorId.trim() === "") {
      onProblem(NAMELESS)
      return
    }
    setBusy(true)
    onProblem(null)
    const draft = {
      terminal_id: seat.terminal_id,
      opening_float_minor: amount,
      actor_id: actorId,
    }
    // One call for a free seat and a held one alike: the node ends the old
    // shift first when there is one, and answers `ended: null` when not.
    const reply = await takeOver({
      ...draft,
      idempotency_key: attempt.keyFor(draft),
      handed_by: handedOverBy()?.username ?? null,
    })
    setBusy(false)
    if (reply.ok) {
      attempt.spent()
      // A new shift is when Finance's latest payment methods are picked up.
      void refreshPaymentMethods()
      onDone(asReport(reply.body?.shift))
      return
    }
    onProblem(reply.problem ?? SILENT)
  }

  function press(key: string) {
    if (busy) return
    if (key === "del") {
      const next = Math.floor(amount / 10)
      setText(next > 0 ? String(next) : "")
    } else {
      const next = String(Number((fresh ? "" : text) + key) || "")
      if (next.length > 11) return
      setText(next)
    }
    setFresh(false)
  }

  // The window's keys, read through a ref so the listener binds once.
  const live = useRef({ press, open, onCancel, busy })
  useEffect(() => {
    live.current = { press, open, onCancel, busy }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        live.current.press(event.key)
        return
      }
      if (event.key === "Backspace") {
        event.preventDefault()
        live.current.press("del")
        return
      }
      if (event.repeat) return
      // A focused button answers Enter itself; Enter anywhere else opens.
      if (event.target instanceof HTMLButtonElement) return
      if (event.key === "Enter") {
        event.preventDefault()
        void live.current.open()
      } else if (event.key === "Escape" && !live.current.busy) {
        event.preventDefault()
        live.current.onCancel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // A touched key must not keep the focus, or the next Enter would press it.
  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault()

  return (
    <div className="d-in d-float m-swap" key="float">
      <div className="f-who">
        <span className="av md">{initials(name)}</span>
        <div className="f-who-t">
          <b>{name}</b>
          <span>{sub}</span>
        </div>
        <button className="d-chip" type="button" disabled={busy} onClick={onCancel}>
          {leaveLabel}
        </button>
      </div>
      <p className="f-title">Saldo awal</p>
      <div className="f-amt" role="status" aria-label="Saldo awal">
        <span className="cur">Rp</span>
        <span
          className={`v${amount > 0 ? "" : " zero"}${amount > 0 && fresh ? " sel" : ""}`}
        >
          {amount > 0 ? amount.toLocaleString("id-ID") : "0"}
        </span>
        <span className="caret" />
      </div>
      <div className="f-pre">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={amount === preset ? "on" : undefined}
            onMouseDown={keepFocus}
            onClick={() => {
              if (busy) return
              setText(String(preset))
              setFresh(true)
            }}
          >
            {preset.toLocaleString("id-ID")}
          </button>
        ))}
      </div>
      <div className="f-pad">
        {FLOAT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={key === "del" ? "Hapus" : undefined}
            onMouseDown={keepFocus}
            onClick={() => press(key)}
          >
            {key === "del" ? <DelIcon /> : key}
          </button>
        ))}
      </div>
      {/* A shift opens on counted cash: an empty drawer is counted as
          nothing, and nothing is not a float. */}
      <button
        className="ds-btn ds-btn--primary f-open"
        type="button"
        disabled={busy || amount <= 0}
        onClick={() => void open()}
      >
        <span>{busy ? "Membuka…" : "Buka kasir"}</span>
        <span className="kbd">Enter</span>
      </button>
    </div>
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
    <Closing
      actorId={actorId}
      report={report}
      counting
      title={`Hitung laci ${report.terminal_label}`}
      caption={`Shift Anda diambil alih oleh ${titled(report.taken_over_by ?? "orang lain")}${
        report.closed_at !== null ? ` pukul ${clock(report.closed_at)}` : ""
      }. Hitung uang yang Anda ambil dari laci.`}
      onDone={() => onCounted()}
    />
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
  /// Opened: the MODAL AWAL slip goes to the printer, then the till.
  | { readonly kind: "opened"; readonly report: ShiftReport }

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
/// the float is for that one. A kasir somebody else still has open cannot be
/// opened over: they close their shift first.
export function ShiftGate({
  actorId,
  notice,
  onReady,
  onSignOut,
  popup = false,
}: {
  actorId: string
  /// Why the person is here again, when it is not a fresh sign-in.
  notice?: string | null
  onReady: (seat: Seat) => void
  onSignOut: () => void
  /// Drawn inside the Kasir pop-up over the menu rather than as its own page;
  /// then "leave" closes the pop-up instead of signing the person out.
  popup?: boolean
}) {
  const { terminalId, me } = useSession()
  const name = me?.display_name ?? me?.username ?? actorId
  const [state, setState] = useState<Gate>({ kind: "asking" })
  // What the node said to the float, under the card.
  const [flash, setFlash] = useState<string | null>(null)
  const alive = useRef(true)
  const place = usePlace(
    state.kind === "opening" ? state.seat.label : kasirLabel(terminalId),
  )

  const look = useCallback(async () => {
    setState({ kind: "asking" })
    setFlash(null)
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
            problem: `Perangkat ini belum diatur sebagai kasir (${terminalId}). Minta kantor pusat mengatur kasir untuk toko ini.`,
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

  const leave = popup ? "Batal" : "Keluar"

  // Opened: MODAL AWAL goes to the printer, then the till.
  if (state.kind === "opened") {
    return <OpeningSlip report={state.report} onPrinted={() => onReady(seatOf(state.report))} />
  }

  // The two that fill the window: counting a drawer is not a card on the stone.
  if (state.kind === "count") {
    return (
      <Uncounted
        actorId={actorId}
        report={state.report}
        onCounted={() => void look()}
      />
    )
  }
  if (state.kind === "closing") {
    return (
      <Closing
        actorId={actorId}
        report={state.report}
        backLabel="Kembali"
        onDone={() => void look()}
        onCancel={() => setState({ kind: "elsewhere", report: state.report })}
      />
    )
  }

  let card: ReactNode
  let small = true
  let below: ReactNode = <Status place={place} />
  if (state.kind === "asking") {
    below = null
    card = (
      <div className="d-in sm m-swap" key="asking">
        <p className="d-say">Memuat shift…</p>
      </div>
    )
  } else if (state.kind === "problem") {
    below = null
    card = (
      <div className="d-in sm m-swap" key="problem">
        <p className="d-say bad">{state.problem}</p>
        <div className="d-acts">
          <button
            className="ds-btn ds-btn--primary"
            type="button"
            onClick={() => void look()}
          >
            Coba lagi
          </button>
          <button className="ds-btn ds-btn--ghost" type="button" onClick={onSignOut}>
            Batal
          </button>
        </div>
      </div>
    )
  } else if (state.kind === "elsewhere") {
    card = (
      <div className="d-in sm m-swap" key="elsewhere">
        <span className="av lg">{initials(name)}</span>
        <p className="d-say">Shift Anda dibuka di {seatOf(state.report).label}</p>
        <p className="d-hint">
          {name} · sejak {clock(state.report.opened_at)}
        </p>
        <div className="d-acts">
          <button
            className="ds-btn ds-btn--primary"
            type="button"
            onClick={() => setState({ kind: "closing", report: state.report })}
          >
            Hitung dan tutup
          </button>
          <button className="ds-btn ds-btn--ghost" type="button" onClick={onSignOut}>
            {leave}
          </button>
        </div>
      </div>
    )
  } else if (state.seat.held_by !== null) {
    // Somebody else's shift is still open on this kasir: nobody opens over it
    // (owner, 23 Oct 2026). They close it — count the drawer — first.
    const holder = titled(state.seat.held_by)
    card = (
      <div className="d-in sm m-swap" key="held">
        <span className="av lg">{initials(holder)}</span>
        <p className="d-say">
          {state.seat.label} masih dibuka {holder}
        </p>
        <p className="d-hint">Tutup kasir {holder} dulu</p>
        <div className="d-acts">
          <button
            className="ds-btn ds-btn--primary"
            type="button"
            onClick={() => void look()}
          >
            Coba lagi
          </button>
          <button className="ds-btn ds-btn--ghost" type="button" onClick={onSignOut}>
            {leave}
          </button>
        </div>
      </div>
    )
  } else {
    small = false
    if (flash !== null) {
      below = (
        <p className="d-status bad" role="alert">
          {flash}
        </p>
      )
    }
    card = (
      <Opening
        actorId={actorId}
        seat={state.seat}
        name={name}
        sub={notice !== undefined && notice !== null && notice !== "" ? notice : place}
        leaveLabel={popup ? "Batal" : "Bukan Anda?"}
        onDone={(report) => {
          if (report === null) void look()
          else if (report.opening_float_minor > 0) setState({ kind: "opened", report })
          else onReady(seatOf(report))
        }}
        onCancel={onSignOut}
        onProblem={setFlash}
      />
    )
  }

  // Looking the shift up is a moment: the stone background alone, no card
  // and no "Memuat shift…" flashing between the door and the float.
  if (state.kind === "asking") {
    return <div style={{ position: "fixed", inset: 0, background: "#e8ebf0" }} />
  }

  return (
    <Door popup={popup} small={small} below={below}>
      {card}
    </Door>
  )
}

/// MODAL AWAL (pos-thermal-prototype.html, "Modal awal · buka kasir"): the
/// float the Kepala toko hands over, printed once as the till opens, then the
/// till. Its number (MA-0001) rides the opening movement.
function OpeningSlip({ report, onPrinted }: { report: ShiftReport; onPrinted: () => void }) {
  const { config } = useNodeConfig()
  const code = (config?.joined?.site_code ?? "").trim()
  const name = titled(report.opened_by)
  const opened = new Date(report.opened_at)
  const float = report.movements.find((one) => one.kind === "OPENING_FLOAT")
  const no = (float as (typeof float & { slip_no?: unknown }) | undefined)?.slip_no
  const done = useRef(onPrinted)
  useEffect(() => {
    // print() returns once the page has gone to the printer.
    const timer = window.setTimeout(() => {
      void printSlip(config?.paper).then(() => done.current())
    }, 50)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "#e8ebf0" }} />
      <PrintCopy
        paper={
          <CashSlipPaper
            shop={shopOf(report)}
            title="MODAL AWAL"
            no={typeof no === "string" && no.trim() !== "" ? no.trim() : null}
            at={Number.isNaN(opened.getTime()) ? new Date() : opened}
            cashier={name}
            code={code}
            amount={report.opening_float_minor}
            from={handedOverBy()?.name ?? name}
            to={name}
          />
        }
      />
    </>
  )
}

function Running({
  actorId,
  report,
  startClosing,
  onDone,
  onBack,
}: {
  actorId: string
  report: ShiftReport
  startClosing: boolean
  onDone: (report: ShiftReport | null) => void
  onBack: () => void
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
        // Finish shift opened straight at the count: stepping back is back to
        // selling, not to a page nobody asked for.
        onCancel={startClosing ? onBack : () => setClosing(false)}
        backLabel={startClosing ? "Kembali ke penjualan" : "Kembali"}
      />
    )
  }

  return (
    <>
      <div className="stats">
        <div className="stat">
          <small>Saldo awal</small>
          <strong className="num">
            {money(floatOf(report), CURRENCY)}
          </strong>
        </div>
        <div className="stat">
          <small>Penjualan</small>
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
            {report.voided_count} penjualan ·{" "}
            {money(report.voided_total_minor, CURRENCY)}
          </span>
        </div>
      )}

      {report.movements.length > 0 && (
        <div>
          <span className="label">Riwayat kas</span>
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
        {owed > 0 && (
          <p className="error">
            {outbox.unsent > 0
              ? `${outbox.unsent} penjualan belum terkirim ke server toko — tunggu sampai terkirim sebelum tutup kasir.`
              : `${outbox.refused} penjualan ditolak server toko — kepala toko menyelesaikannya di layar kasir sebelum kasir bisa ditutup.`}
          </p>
        )}
        <button
          className="btn danger lg"
          onClick={() => setClosing(true)}
          disabled={owed > 0}
        >
          <Icon name="lock" />
          Tutup kasir
        </button>
      </div>
    </>
  )
}

/// Closing the drawer, counted blind. Also counting one that was taken over
/// (`counting`): the same sheet, the same blindness, sent to `countShift` —
/// the shift is already closed, so there is nothing to cancel back out of.
///
/// One form (client, 28 Oct 2026): how many slips each EDC machine printed on
/// top, then every note and coin from Rp 100.000 down, as 7Soft's Closing
/// Cashier lays them out — and the cashier never sees the figure the node
/// expects: not while counting, not before sending. The expected cash is not
/// even fetched: a number this screen never holds is a number it cannot leak.
/// Only once the count is locked and the shift closed does the node's answer
/// come back, and `Closed` shows the paper.
///
/// The sheet travels as `counted`, one line per denomination, and the node
/// refuses it unless it adds up to the declared figure — the count sheet is
/// what an audit asks for the next morning.
///
/// The keys are the prototype's: Enter and ↓ walk the rows, ↑ goes back, ⇧4
/// closes (once every machine has its slips), Esc steps back.
function Closing({
  actorId,
  report,
  onDone,
  onCancel,
  backLabel = "Kembali ke penjualan",
  counting = false,
  title,
  caption,
}: {
  actorId: string
  report: ShiftReport
  onDone: (report: ShiftReport | null) => void
  onCancel?: () => void
  /// What the way back is called: where it goes decides.
  backLabel?: string
  counting?: boolean
  /// Over the rows; "Tutup kasir" when not said.
  title?: string
  /// Under it; the kasir and the shop when not said.
  caption?: string
}) {
  const { me } = useSession()
  const who = me?.display_name ?? me?.username ?? titled(report.opened_by)
  const place = usePlace(report.terminal_label)
  const [counts, setCounts] = useState<Record<number, string>>({})
  // How many slips each EDC machine printed this shift, counted blind (client,
  // 25 Oct 2026). `null` until the node has named the machines; a drawer that
  // took no card has none, and the section is left out.
  const [machines, setMachines] = useState<
    readonly { machine_id: string; machine_name: string }[] | null
  >(null)
  const [slips, setSlips] = useState<Record<string, string>>({})
  // How many paper vouchers the shoppers paid with this shift, counted off
  // the drawer like the EDC slips (Hari, 30 Oct 2026): sheets, not rupiah.
  const [vouchers, setVouchers] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const attempt = useIdempotency()
  const rows = useRef<HTMLDivElement>(null)
  // Where the caret was, so a confirmation that is turned down hands it back.
  const lastRow = useRef(0)
  // What is left of the float, and what went back to the Kepala toko.
  const floatLeft = floatLeftOf(report)
  const returned = floatReturnedOf(report)

  const named = machines ?? []
  const lead = named.length
  // One thing at a time (Hari, 30 Oct 2026): the cash first, then the EDC
  // slips (only when a machine took a card), then the vouchers, and only then
  // Tutup kasir — the button walks the cashier through.
  const steps: readonly ("cash" | "edc" | "voucher")[] =
    lead > 0 ? ["cash", "edc", "voucher"] : ["cash", "voucher"]
  const [stepAt, setStepAt] = useState(0)
  const step = steps[Math.min(stepAt, steps.length - 1)]
  const lastStep = stepAt >= steps.length - 1
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

  const focusRow = (index: number) =>
    rows.current?.querySelectorAll<HTMLInputElement>("input")[index]?.focus()

  useEffect(() => {
    let alive = true
    void edcMachines(report.shift_id).then((reply) => {
      if (!alive) return
      setMachines(reply.ok && Array.isArray(reply.body?.items) ? reply.body.items : [])
    })
    return () => {
      alive = false
    }
  }, [report.shift_id])

  useEffect(() => {
    if (machines !== null && !confirming) focusRow(lastRow.current)
  }, [machines, confirming, stepAt])

  const typedSlips = (id: string) => slips[id] ?? ""
  const slipsDone = named.every((one) => typedSlips(one.machine_id) !== "")
  const setSlip = (id: string, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 4)
    setSlips((was) => ({ ...was, [id]: digits === "" ? "" : String(Number(digits)) }))
  }

  /// The node answered a movement with the shift report: hand it up, so this
  /// screen and the page behind it draw the float as it now stands. A reply
  /// that is not a report is read again from the node.
  async function close() {
    if (actorId.trim() === "") {
      setProblem(NAMELESS)
      setConfirming(false)
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
      ...(lead > 0
        ? {
            edc_slips: named.map((one) => ({
              machine_id: one.machine_id,
              slips: Number(typedSlips(one.machine_id)) || 0,
            })),
          }
        : {}),
      vouchers: Number(vouchers) || 0,
      note: null,
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
    setConfirming(false)
  }

  // ⇧4 asks to close — to the first machine still without a count when one is;
  // Esc steps back — out of the confirmation first, then out of the count.
  // Read through a ref so the listener binds once.
  const live = useRef({
    ask: () => {},
    back: () => {},
  })
  useEffect(() => {
    live.current = {
      ask: () => {
        if (machines === null || busy || confirming) return
        if (step === "edc" && !slipsDone) {
          focusRow(Math.max(0, named.findIndex((one) => typedSlips(one.machine_id) === "")))
          return
        }
        if (step === "voucher" && vouchers === "") {
          focusRow(0)
          return
        }
        if (!lastStep) {
          lastRow.current = 0
          setStepAt((at) => at + 1)
          return
        }
        setConfirming(true)
      },
      back: () => {
        if (busy) return
        if (confirming) setConfirming(false)
        else if (stepAt > 0) {
          lastRow.current = 0
          setStepAt((at) => at - 1)
        } else onCancel?.()
      },
    }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (isKey(event, CLOSE_KEY[1])) {
        event.preventDefault()
        live.current.ask()
      } else if (event.key === "Escape") {
        event.preventDefault()
        if (event.target instanceof HTMLTextAreaElement) event.target.blur()
        else live.current.back()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Enter and ↓ go to the next row, ↑ to the one before; Enter on the last
  // row asks to close.
  const walk = (
    event: { key: string; preventDefault: () => void },
    index: number,
  ) => {
    if (event.key === "ArrowUp") {
      event.preventDefault()
      focusRow(index - 1)
    } else if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault()
      const last = (rows.current?.querySelectorAll("input").length ?? 1) - 1
      if (index < last) focusRow(index + 1)
      else if (event.key === "Enter") live.current.ask()
    }
  }

  const goLabel = counting ? "Kunci hitungan" : "Tutup kasir"
  const stepReady =
    step === "edc" ? slipsDone : step === "voucher" ? vouchers !== "" : true
  // ⇧4 shows the count at once; a tap on Tutup kasir pops it in.
  const [enter] = useState(viaPointer)

  return (
    <div className="shd shd-close">
      <div className={enter ? "cc m-pop" : "cc"} inert={confirming}>
        <div className="cc-l">
          <div className="cc-head">
            <div>
              <p className="ttl">{title ?? "Tutup kasir"}</p>
              <p className="cap">{caption ?? place}</p>
            </div>
            {onCancel !== undefined && (
              <button
                className="ds-btn ds-btn--ghost"
                type="button"
                disabled={busy}
                onClick={() => live.current.back()}
              >
                {backLabel}
                <span className="kbd">Esc</span>
              </button>
            )}
          </div>
          <div className="cc-list" ref={rows}>
            {/* Blind, as the cash is: the cashier is told which machines took a
                payment, never how many slips the till expects. */}
            {step === "edc" && lead > 0 && (
              <>
                <p className="cc-sec ed">
                  <span />
                  <b>Struk EDC</b>
                  <span className="r">Jumlah struk</span>
                  <span />
                </p>
                {named.map((one, index) => (
                  <div className="cc-row ed" key={one.machine_id} onClick={() => focusRow(index)}>
                    <span className="cc-chip">
                      <span className="edc-chip">
                        <Icon name="card" size={18} />
                      </span>
                    </span>
                    <span className="cc-mach">
                      <b>EDC {one.machine_name}</b>
                    </span>
                    <label className="cc-slip">
                      <input
                        value={typedSlips(one.machine_id)}
                        onChange={(event) => setSlip(one.machine_id, event.target.value)}
                        inputMode="numeric"
                        placeholder="0"
                        autoComplete="off"
                        aria-label={`Jumlah struk EDC ${one.machine_name}`}
                        onFocus={(event) => {
                          lastRow.current = index
                          event.target.select()
                        }}
                        onKeyDown={(event) => walk(event, index)}
                      />
                      <span className="u">struk</span>
                    </label>
                    <span />
                  </div>
                ))}
              </>
            )}
            {step === "voucher" && machines !== null && (
              <>
                <p className="cc-sec ed">
                  <span />
                  <b>Voucher diterima</b>
                  <span className="r">Jumlah lembar</span>
                  <span />
                </p>
                <div className="cc-row ed" onClick={() => focusRow(0)}>
                  <span className="cc-chip">
                    <span className="edc-chip">
                      <Icon name="voucher" size={18} />
                    </span>
                  </span>
                  <span className="cc-mach">
                    <b>Voucher</b>
                  </span>
                  <label className="cc-slip">
                    <input
                      value={vouchers}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, "").slice(0, 4)
                        setVouchers(digits === "" ? "" : String(Number(digits)))
                      }}
                      inputMode="numeric"
                      placeholder="0"
                      autoComplete="off"
                      aria-label="Jumlah lembar voucher"
                      onFocus={(event) => {
                        lastRow.current = 0
                        event.target.select()
                      }}
                      onKeyDown={(event) => walk(event, 0)}
                    />
                    <span className="u">lembar</span>
                  </label>
                  <span />
                </div>
              </>
            )}
            {step === "cash" && machines !== null && (
              <p className="cc-sec">
                <span />
                <b>Uang kertas &amp; koin</b>
                <span className="c">Jumlah</span>
                <span className="r">Nilai</span>
              </p>
            )}
            {/* From Rp 100.000 down, as 7Soft's Closing Cashier and the cashier
                on the client's video count. */}
            {step === "cash" && machines !== null && COUNT_ORDER.map((value, index) => (
              <div className="cc-row" key={value} onClick={() => focusRow(index)}>
                <span className="cc-chip">
                  <MoneyChip value={value} />
                </span>
                <span className="cc-val">{money(value, CURRENCY)}</span>
                <span className="cc-step">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Kurangi satu ${money(value, CURRENCY)}`}
                    onClick={() => set(value, pieces(value) - 1)}
                  >
                    −
                  </button>
                  <input
                    className="cc-pcs"
                    value={counts[value] ?? ""}
                    onChange={(event) =>
                      set(value, Number(event.target.value.replace(/\D/g, "")) || 0)
                    }
                    inputMode="numeric"
                    placeholder="0"
                    autoComplete="off"
                    aria-label={`Jumlah lembar ${money(value, CURRENCY)}`}
                    // A count that is already there is selected, so the first
                    // key typed replaces it.
                    onFocus={(event) => {
                      lastRow.current = index
                      event.target.select()
                    }}
                    onKeyDown={(event) => walk(event, index)}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Tambah satu ${money(value, CURRENCY)}`}
                    onClick={() => set(value, pieces(value) + 1)}
                  >
                    +
                  </button>
                </span>
                <span className={`cc-amt${pieces(value) > 0 ? "" : " zero"}`}>
                  {pieces(value) > 0 ? money(value * pieces(value), CURRENCY) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="cc-r">
          <div className="cc-who">
            <span className="av md">{initials(who)}</span>
            <div>
              <b>{who}</b>
              <span>{report.terminal_label}</span>
            </div>
          </div>
          <dl className="cc-facts">
            <div>
              <dt>Shift dibuka</dt>
              <dd>{when(report.opened_at)}</dd>
            </div>
            <div>
              <dt>Saldo awal</dt>
              <dd>{money(floatOf(report), CURRENCY)}</dd>
            </div>
            {returned.minor > 0 && (
              <div>
                <dt>Modal disetor</dt>
                <dd>
                  {money(returned.minor, CURRENCY)}
                  {returned.to !== null && ` · ${returned.to.trim().split(/\s+/)[0]}`}
                </dd>
              </div>
            )}
            {lead > 0 && (
              <div>
                <dt>Struk EDC</dt>
                <dd>{named.map((one) => `${one.machine_name} ${Number(typedSlips(one.machine_id)) || 0}`).join(" · ")}</dd>
              </div>
            )}
            <div>
              <dt>Voucher</dt>
              <dd>{Number(vouchers) || 0} lembar</dd>
            </div>
          </dl>
          <div className="cc-sum">
            <p className="k">Terhitung</p>
            <p className="v">{money(declared, CURRENCY)}</p>
          </div>
          {problem !== null && (
            <p className="cc-err" role="alert">
              {problem}
            </p>
          )}
          <button
            className="ds-btn ds-btn--primary cc-go"
            type="button"
            disabled={busy || machines === null || !stepReady}
            onClick={() => live.current.ask()}
          >
            <span>{lastStep ? goLabel : "Lanjut"}</span>
            <span className="kbd">{lastStep ? CLOSE_KEY[0] : "Enter"}</span>
          </button>
        </div>
      </div>

      {confirming && (
        <div
          className="veil m-veil"
          onClick={() => {
            if (!busy) setConfirming(false)
          }}
        >
          <div
            className="cfm m-pop"
            role="alertdialog"
            aria-label={goLabel}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="ttl">
              {goLabel} dengan {money(declared, CURRENCY)}?
            </p>
            <p>
              {counting
                ? "Hitungan tidak bisa diubah setelah dikunci."
                : `${floatLeft > 0 ? `Modal ${money(floatLeft, CURRENCY)} belum disetor · setor lewat Laci (${DRAWER_KEY[0]}) · ` : ""}${report.terminal_label} tertutup sampai shift berikutnya dibuka.`}
            </p>
            <div className="cfm-act">
              <button
                className="ds-btn ds-btn--ghost"
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Hitung lagi
              </button>
              {/* Keyboard only: the count is checked, Enter locks it. */}
              <button
                className="ds-btn ds-btn--primary"
                type="button"
                disabled={busy}
                autoFocus
                onClick={() => void close()}
              >
                {busy ? (counting ? "Mengirim…" : "Menutup…") : goLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/// A closed shift, as the cashier who counted it is allowed to see it: the
/// paper, and the two buttons beside it.
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
  // Cetak once, then Selesai: Enter does the one and then the other.
  const [printed, setPrinted] = useState(false)
  const print = () => {
    setPrinted(true)
    window.setTimeout(() => void printSlip(config?.paper), 50)
  }
  useShortcuts({
    "ctrl+p": print,
    Enter: () => (printed ? onLeave() : print()),
  })
  const { config } = useNodeConfig()
  const code = (config?.joined?.site_code ?? "").trim()
  const shop = shopOf(report)
  const closedAt = report.closed_at !== null ? new Date(report.closed_at) : new Date()
  const at = hhmm(closedAt)
  const lines = DENOMINATIONS.map((value) => ({
    value,
    pieces: (report.counted ?? []).find((line) => line.value_minor === value)?.pieces ?? 0,
  }))
  const name = titled(report.opened_by)
  const paper = <ClosingPaper report={report} shop={shop} code={code} lines={lines} closedAt={closedAt} />
  const labels = <CutLabels who={name} at={closedAt} lines={lines} />

  return (
    <>
      <div className="shd shd-paper">
        <div className="paper-side">
          <p className="ttl">Kasir ditutup</p>
          <p className="cap">
            {report.declared_cash_minor === null
              ? "—"
              : money(report.declared_cash_minor, CURRENCY)}{" "}
            terhitung · {at}
          </p>
          <button
            className={`ds-btn ${printed ? "ds-btn--ghost" : "ds-btn--primary"}`}
            type="button"
            onClick={print}
          >
            <span>
              <PrinterIcon />
              Cetak
            </span>
            {!printed && <span className="kbd">Enter</span>}
          </button>
          <button
            className={`ds-btn ${printed ? "ds-btn--primary" : "ds-btn--ghost"}`}
            type="button"
            onClick={onLeave}
          >
            <span>Selesai</span>
            {printed && <span className="kbd">Enter</span>}
          </button>
        </div>
        <div className="th-col m-pop">
          <ThermalSheet>{paper}</ThermalSheet>
          {lines.some((one) => one.pieces > 0) && (
            <>
              <p className="lbl">Potongan per pecahan</p>
              {labels}
            </>
          )}
        </div>
      </div>
      <PrintCopy paper={paper} labels={labels} />
    </>
  )
}

/// What a cash movement is called on the closing paper, and whether it moves
/// the drawer's float (a setoran only takes takings out). `CORRECTION` is kept
/// as the node signed it.
const MOVE: Readonly<Record<string, { word: string; sign: 1 | -1 | 0; float: boolean }>> = {
  PICKUP: { word: "Tambah Modal", sign: 1, float: true },
  CORRECTION: { word: "Koreksi Modal", sign: 0, float: true },
  FLOAT_RETURN: { word: "Setor Modal", sign: -1, float: true },
  DROP: { word: "Setoran", sign: -1, float: false },
  PAYOUT: { word: "Uang Keluar", sign: -1, float: false },
}

/// The paper the shift closes with (pos-thermal-prototype.html `closing`): who,
/// when, the float and everything that happened to it by its slip number, the
/// slips each EDC machine printed, the notes counted, the total, and two
/// signatures. Blind like the screen: no expected cash, no difference.
function ClosingPaper({
  report,
  shop,
  code,
  lines,
  closedAt,
}: {
  report: ShiftReport
  shop: Shop
  code: string
  lines: readonly { readonly value: number; readonly pieces: number }[]
  closedAt: Date
}) {
  const name = titled(report.opened_by)
  const stamp = (at: Date) =>
    `${at.getDate()} ${MON[at.getMonth()]} ${at.getFullYear()} ${hhmm(at)}`
  const opened = new Date(report.opened_at)
  // Every movement by its slip, in the order it happened. The slip's number
  // comes with the movement when the node says it.
  const moves = report.movements.flatMap((one) => {
    const kind = MOVE[one.kind]
    if (kind === undefined) return []
    const no = (one as typeof one & { slip_no?: unknown }).slip_no
    const amount = kind.sign === 0 ? one.amount_minor : kind.sign * Math.abs(one.amount_minor)
    return [
      {
        word: typeof no === "string" && no.trim() !== "" ? `${kind.word} ${no.trim()}` : kind.word,
        amount,
        float: kind.float,
      },
    ]
  })
  return (
    <>
      <ShopHead shop={shop} />
      <p className="th-c th-b">TUTUP KASIR</p>
      <hr />
      <Row k="Kasir" v={`${name.toUpperCase()} ${code}`.trim()} />
      <Row k="Dibuka" v={Number.isNaN(opened.getTime()) ? report.opened_at : stamp(opened)} />
      <Row k="Ditutup" v={stamp(closedAt)} />
      <Row k="Saldo Awal" v={fmt(report.opening_float_minor)} />
      {moves.map((one, at) => (
        <Row key={`${at}:${one.word}`} k={one.word} v={fmt(one.amount)} />
      ))}
      {/* Only when the float itself moved: a setoran leaves it as it was. */}
      {moves.some((one) => one.float) && <Row k="Modal Akhir" v={fmt(floatLeftOf(report))} bold />}
      {edcOf(report)
        .filter((one) => one.slips !== null)
        .map((one) => (
          <Row key={one.machine_id} k={`Struk ${one.machine_name.toUpperCase()}`} v={String(one.slips)} />
        ))}
      {vouchersOf(report) !== null && <Row k="Voucher" v={String(vouchersOf(report))} />}
      <hr />
      <p className="th-sec">RINCIAN UANG</p>
      <Denoms lines={lines} />
      <hr />
      <Row k="TOTAL" v={report.declared_cash_minor === null ? "-" : fmt(report.declared_cash_minor)} bold />
      <Signs left={["Kasir", name]} right={["Admin", ""]} />
    </>
  )
}
