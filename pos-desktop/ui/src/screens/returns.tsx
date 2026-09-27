import { useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { Icon } from "@/icons"
import { PinPad } from "@/pinpad"
import { supervisorByFinger, supervisorByPin } from "@/session"
import { Topbar } from "@/till"
import { readScan } from "@epc"
import { money } from "@itulah/contract/money"

/// Undoing a sale, the two ways a shop is allowed to.
///
/// Two screens rather than one screen with a switch, because they are two
/// different admissions and the cashier has to have chosen which one they are
/// making before they start. A **retur** accepts that the sale happened: the
/// garments come home one tag at a time, and every tag has to be told where it
/// goes. A **void** says the sale should not have happened at all — the whole
/// basket in one movement, with nothing to disposition, because nothing about
/// the garments was ever in question.
///
/// # What both of them ask for, and why
///
/// **A supervisor, at the moment it is needed.** `verify_supervisor` in
/// `backend/src/edge/till.rs` is a step-up and not a session: the cashier stays
/// signed in, a second person is checked, and their name is written onto the
/// row that needed them. A password typed into the two fields here always
/// works. Beyond that there is a quick way, and **the node decides which one it
/// is** — a finger pressed on this counter's scanner, or a PIN pressed on the
/// pad; either is answered with a one-shot authorisation good for three minutes
/// and exactly one action. The quick way exists because a supervisor is called
/// to a till many times a day, and a password typed in front of a queue is how
/// it ends up written on the side of a monitor.
///
/// Which quick way is on offer is asked of the node (`authMethods()`), not
/// chosen here, and a PIN is the *staging* method: the pad says so where the
/// cashier can read it. A till that cannot tell a rehearsal from the real thing
/// is how a rehearsal reaches a customer.
///
/// All three are credentials and all three are kept the same way: the fields are
/// uncontrolled, the PIN and the authorisation live in refs, never in state,
/// read once on the way out, and wiped the moment the node has answered, refusal
/// or not. What the screen does keep is the supervisor's *name*, because a
/// cashier has to see that a person was recognised — a tick is not a person.
///
/// **One key per attempt.** The node files an idempotency key together with the
/// request it arrived with. Pressing again after a refusal that never reached
/// the node has to send the *same* key, or a retry of a call that did land
/// becomes a second refund. Change what is being asked — a tag, a disposition,
/// the method, the reason — and it is a different attempt, so it gets a new key.
///
/// **The node's own words when it refuses.** It knows why it said no, and a
/// sentence invented here could only ever disagree with it — while the cashier
/// is about to repeat that sentence to somebody standing in front of them.

// ── what the node actually accepts ──────────────────────────────────────

/// Where a returned garment goes.
///
/// These two are the whole list: `return_sale` in `backend/src/edge/sqlite.rs`
/// uppercases what it is sent and refuses anything else by name, and the two
/// steer the movement into two different pools — `StoreFloor` and
/// `StoreReject`. `ReturnLineRequest` defaults a missing one to `RESALEABLE`,
/// which is right for a wire format that still has to read a message from an
/// older till and wrong for a screen. So nothing here is pre-selected. A
/// stained shirt the till decided about on the cashier's behalf goes back on
/// the rail, and the shop sells the same damage twice.
const DISPOSITIONS = [
  {
    value: "RESALEABLE",
    label: "Layak jual",
    detail: "Kembali ke lantai jual dan boleh dijual lagi",
  },
  {
    value: "DAMAGED",
    label: "Rusak",
    detail: "Masuk pool reject, tidak kembali ke rak",
  },
] as const

/// How the money goes back.
///
/// The node checks this with `PaymentMethod::from_str`, and refuses a voucher
/// (paying one back out would be issuing one), so the other five are offered
/// here — including `OTHER`, which the counter itself does not take. A refund that was neither cash nor a reversal has to be able to
/// say so: the shift report buckets `refund_method='CASH'` against the drawer,
/// so a transfer booked as cash is a drawer that comes up short at close with
/// nobody able to say why.
///
/// Nothing is pre-selected here either, and the sale's own tenders are shown
/// beside it rather than copied into it. `ReturnRequest` says why in as many
/// words: a card sale refunded in cash happens every day.
const REFUNDS = [
  { value: "CASH", label: "Tunai" },
  { value: "CARD", label: "Kartu" },
  { value: "QRIS", label: "QRIS" },
  { value: "EWALLET", label: "E-Wallet" },
  { value: "OTHER", label: "Lainnya" },
] as const

/// The number printed on the paper is not the id this endpoint wants.
///
/// `receipt_no` is `SITE-YYYYMMDD-XXXXXX` — the site, the day and the last six
/// of the sale id, derived rather than allocated — while
/// `GET /store/sales/{id}/receipt` looks a sale up by its full id, and nothing
/// on the wire turns one into the other. A cashier holding only the receipt has
/// to find the sale another way, and being told that here is worth more than a
/// refusal that says "sale S01-20260913-A1B2C3 not found".
const RECEIPT_NUMBER = /^[A-Za-z0-9]+-\d{8}-[A-Za-z0-9]{1,8}$/

// ── reading what the node sent back ─────────────────────────────────────

/// `receipt()` answers a map, so it is read as one.
///
/// The wrappers in `api.ts` declare the shapes this terminal relies on, and the
/// receipt is deliberately not one of them — casting an unchecked body into a
/// generated struct would be asserting a shape nobody looked at. These four
/// read a field if it is there and say null if it is not, which is also what
/// happens when the node answered with something that is not a receipt at all.
const asMap = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const asList = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : []

/// One line of goods, as the receipt document has it.
///
/// Note what is missing: **no EPC**. `ReceiptLine` carries a name, a SKU and
/// money, and the tag is not on it — so these lines say what was sold, and
/// they cannot say which garment on the counter is which. That single fact is
/// why a return below is scanned rather than ticked.
type SaleLine = {
  readonly name: string
  readonly skuCode: string
  readonly quantity: number
  readonly lineTotalMinor: number | null
}

type SaleTender = {
  readonly method: string
  readonly amountMinor: number | null
}

/// One sale, as the node describes it. Money is in minor units and the document
/// carries no currency code of its own — this node prints Rupiah, which is what
/// `money` defaults to.
type Sale = {
  readonly saleId: string
  readonly receiptNo: string | null
  readonly when: string | null
  readonly cashier: string | null
  readonly totalMinor: number | null
  /// `** BATAL **` or `** RETUR **`, set by the node when this sale has already
  /// been undone once. Printed on the reprint, and shown here for the same
  /// reason: a second return against the same basket is refused unit by unit,
  /// and the cashier should see it coming.
  readonly stamp: string | null
  readonly lines: readonly SaleLine[]
  readonly tenders: readonly SaleTender[]
}

function readSale(body: unknown): Sale | null {
  const doc = asMap(body)
  if (doc === null) return null
  const saleId = asText(doc.sale_id)
  if (saleId === null) return null

  const lines: SaleLine[] = []
  for (const row of asList(doc.lines)) {
    const line = asMap(row)
    if (line === null) continue
    const skuCode = asText(line.sku_code)
    if (skuCode === null) continue
    lines.push({
      name: asText(line.name) ?? skuCode,
      skuCode,
      quantity: asCount(line.quantity) ?? 1,
      lineTotalMinor: asCount(line.line_total_minor),
    })
  }

  const tenders: SaleTender[] = []
  for (const row of asList(doc.tenders)) {
    const tender = asMap(row)
    if (tender === null) continue
    const method = asText(tender.method)
    if (method === null) continue
    tenders.push({ method, amountMinor: asCount(tender.amount_minor) })
  }

  return {
    saleId,
    receiptNo: asText(doc.receipt_no),
    when: asText(doc.completed_at),
    cashier: asText(doc.cashier),
    totalMinor: asCount(doc.total_minor),
    stamp: asText(doc.stamp),
    lines,
    tenders,
  }
}

/// What the node said, or the plain fact that it said nothing.
///
/// Never a sentence this file made up to fill the space: the cashier is about
/// to be asked why, and "silakan coba lagi" is not a reason.
function refusal(reply: api.EdgeReply<unknown>): string {
  return (
    reply.problem ??
    `Node toko menolak dengan status ${reply.status} dan tidak menyebut alasannya.`
  )
}

function methodLabel(value: string | null): string {
  return REFUNDS.find((one) => one.value === value)?.label ?? (value ?? "—")
}

// ── the supervisor ──────────────────────────────────────────────────────

/// How long a pressed finger is worth, counted from the press and not from the
/// answer.
///
/// `SUPERVISOR_GRANT_SECONDS` in `backend/src/edge/fingerprint.rs` is 180, and
/// the node stamps the deadline when it writes the grant down — a moment *after*
/// the finger was pressed here. Its own `expires_at` does not come back through
/// `supervisorByFinger()`, so this screen counts the three minutes itself; from
/// the press, which ends them a shade before the node's rather than after. That
/// is the only safe direction to be wrong in — it warns while the grant is still
/// good, instead of promising time that has already gone.
///
/// A PIN earns the same kind of grant through `supervisorByPin()` and is counted
/// the same way, from the press. One clock for both, because what expires is the
/// grant, not the method it was bought with.
const GRANT_MS = 180_000

/// When the countdown stops being a detail and starts being a warning. Long
/// enough to still finish the screen, which is the point: the node's refusal
/// arrives *after* the action was attempted, and this arrives before.
const GRANT_WARNING_MS = 45_000

/// `m:ss`, for a figure somebody is watching rather than reading.
function countdown(ms: number): string {
  const whole = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/// Something to say about the step-up, and which one it was that failed.
///
/// The causes spelled out further down are worth offering only when an attempt
/// was refused, and they are different lists for the two methods: a missing
/// scanner is not a wrong PIN. A grant that lapsed on the counter, or one that
/// has already been spent on an attempt, is neither, and `from: null` is what
/// says so — offering either list for those would be answering a question nobody
/// asked.
type Trouble = {
  readonly text: string
  readonly from: "FINGER" | "PIN" | null
}

/// A supervisor who was recognised, as far as this screen is allowed to know it.
type Granted = {
  /// The node's own answer about whose credential it was — never what was typed
  /// in a field. `ClaimAccepted.username` is not optional at the node, so an
  /// authorisation that arrives without one is not an answer this screen
  /// understands.
  readonly who: string
  /// When this screen stops believing in it, whatever the node's clock says.
  readonly until: number
  /// Which way it was earned. Not used to decide anything — the grant is a grant
  /// — only to say it in the right words, since "tekan jarinya lagi" is an
  /// instruction nobody can follow on a node that took a PIN.
  readonly how: "FINGER" | "PIN"
}

/// The supervisor's credentials, for exactly as long as one request takes.
///
/// Uncontrolled on purpose. `useState` would put a password in the fibre tree,
/// in every closure that render made and in any devtools snapshot taken while
/// it sat there; a ref reaches into the field it was typed in, reads it once on
/// the way to the node, and wipes it as soon as the node answers. It is never
/// logged, and the object built for the body dies with the call that sent it.
///
/// The price of that is that the screen cannot watch these two fields — a
/// button that greyed out until the password was filled would be a button that
/// knew what was in it. So they are checked on the press instead, and a blank
/// one is refused here rather than spent on a call.
///
/// A fingerprint authorisation is a credential on the same terms, so the token
/// itself lives in a ref beside them. A PIN is one too, and lives in a third.
/// Only what the counter has to *look* at is state — the name it was earned by
/// and how long is left — and neither of those authorises anything on its own.
function useSupervisor() {
  const username = useRef<HTMLInputElement>(null)
  const password = useRef<HTMLInputElement>(null)
  const grant = useRef<string | null>(null)
  const [granted, setGranted] = useState<Granted | null>(null)
  /// Which wait is in progress, rather than merely that one is. Two different
  /// waits drawn in the same words would have the fingerprint button saying
  /// "menunggu jari pada pemindai" while a PIN claim is in flight, which is a
  /// sentence telling a supervisor to touch a scanner for something else.
  const [asking, setAsking] = useState<"FINGER" | "PIN" | null>(null)
  const [refused, setRefused] = useState<Trouble | null>(null)
  const [now, setNow] = useState(() => Date.now())

  /// The PIN, and the one thing about it that is allowed to be state.
  ///
  /// The digits live in a ref for the same reason the password lives in an
  /// uncontrolled field: `useState` would put them in the fibre tree, in every
  /// closure this render made and in any devtools snapshot taken while they sat
  /// there. But a pad has to redraw on every press, and writing a ref redraws
  /// nothing — so a press bumps a counter, a number that says nothing about the
  /// PIN, and the pad is handed the ref's own string at render time. `askPin()`
  /// and `wipe()` go to the ref, which is why an emptied PIN is actually empty
  /// rather than merely no longer drawn.
  const pin = useRef("")
  const [, redrawPin] = useState(0)

  function setPin(next: string) {
    pin.current = next
    redrawPin((count) => count + 1)
  }

  /// Which quick step-up this node accepts, asked of the node itself.
  ///
  /// Null means it has not answered — not `NONE`. Only a positive `PIN` puts the
  /// pad on screen: a method the node does not accept is refused *at the node*,
  /// so drawing a pad on a hunch would fetch a supervisor to a counter to type a
  /// PIN into a machine that was never going to take it.
  const [stepUp, setStepUp] = useState<api.StepUp | null>(null)
  const [methods, setMethods] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const reply = await api.authMethods()
      if (!alive) return
      if (!reply.ok) {
        setStepUp(null)
        setMethods(reply.problem)
        return
      }
      setStepUp(reply.body?.till_step_up ?? "NONE")
      setMethods(null)
    })()
    return () => {
      alive = false
    }
  }, [])

  /// Stop holding it, and stop naming whoever earned it.
  function release() {
    grant.current = null
    setGranted(null)
  }

  // The clock, and the only thing that runs on its own here. A grant that
  // lapses while the screen sits open is dropped on this tick rather than
  // carried into a submit: the node would refuse it, and that refusal would
  // arrive with a supervisor's name attached, as though the person standing
  // there had been the one told no.
  useEffect(() => {
    if (granted === null) return
    const tick = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at < granted.until) return
      release()
      setRefused({
        text:
          `${granted.how === "PIN" ? "Otorisasi PIN" : "Otorisasi sidik jari"}` +
          " sudah lewat tiga menit dan sudah dilepas — node akan menolaknya. " +
          `Minta supervisor ${
            granted.how === "PIN"
              ? "menekan PIN-nya sekali lagi"
              : "menekan jarinya sekali lagi"
          }, atau pakai nama pengguna dan kata sandi.`,
        from: null,
      })
    }, 1000)
    return () => window.clearInterval(tick)
  }, [granted])

  /// Hold what the node gave back, or say why it gave nothing.
  ///
  /// One body for both quick methods, because both are the same transaction: a
  /// credential goes out, and a one-shot grant comes back with a name on it that
  /// this screen did not invent. `how` changes not one decision here — a grant is
  /// a grant — only the words, since "tekan jarinya lagi" is an instruction
  /// nobody can follow at a node that asked for a PIN.
  function take(
    pressed: number,
    answer: {
      readonly authorization: string | null
      readonly username: string | null
      readonly problem: string | null
    },
    how: "FINGER" | "PIN",
  ): void {
    if (answer.authorization === null) {
      // Whoever refused said why, and this screen does not improve on it. For a
      // finger, three unrelated things end up here — no scanner bound to this
      // shell, nobody enrolled at this shop, a finger that did not match; for a
      // PIN, a wrong one, a person who is not a supervisor, or a node that does
      // not take PINs at all. Only the party that refused knows which it meant.
      release()
      setRefused({
        text:
          answer.problem ??
          (how === "PIN"
            ? "PIN itu tidak menghasilkan otorisasi, dan tidak ada yang menyebut alasannya."
            : "Sidik jari tidak menghasilkan otorisasi, dan tidak ada yang menyebut alasannya."),
        from: how,
      })
      return
    }
    const who = answer.username?.trim() ?? ""
    if (who === "") {
      // An authorisation nobody can be named for is not offered as a person,
      // and a tick is not a person. Dropped rather than spent: the cashier
      // would be watching a green light stand in for a supervisor.
      release()
      setRefused({
        text:
          "Node memberi otorisasi tanpa menyebut siapa yang memberikannya, " +
          "jadi terminal ini tidak memakainya. Pakai nama pengguna dan kata sandi.",
        from: null,
      })
      return
    }
    // A second attempt while one is already held replaces it. The one left
    // behind is unspent, bound to this terminal and lapses by itself, which is a
    // better trade than refusing a supervisor who wants to start the three
    // minutes again because the cashier is not finished yet.
    grant.current = answer.authorization
    setNow(Date.now())
    setGranted({ who, until: pressed + GRANT_MS, how })
  }

  /// Ask the scanner on this counter, and hold what the node gives back.
  async function ask(): Promise<void> {
    // Started before the call rather than after it: see `GRANT_MS`.
    const pressed = Date.now()
    setAsking("FINGER")
    setRefused(null)
    const answer = await supervisorByFinger()
    setAsking(null)
    take(pressed, answer, "FINGER")
  }

  /// Spend a PIN on a grant — the staging counterpart of `ask()`.
  ///
  /// The PIN itself never goes any further than this call. `Supervisor` on the
  /// wire carries a password or an authorisation and has no field for a PIN, and
  /// that is the right shape: the node files the request body it was sent
  /// against the idempotency key, so a PIN in that body would be a PIN sitting in
  /// the shop node's SQLite for as long as the row lives. It is exchanged for a
  /// grant here, and the grant is what travels.
  async function askPin(): Promise<void> {
    const pressed = Date.now()
    // Both halves are checked here, before anything is spent. A supervisor
    // should not be told "PIN salah" by the node because the name box above this
    // pad was empty — and the PIN they typed correctly would be gone either way.
    const who = username.current?.value.trim() ?? ""
    const typed = pin.current
    if (who === "" || typed === "") {
      setRefused({
        text:
          "PIN perlu dua hal: nama pengguna supervisor di kolom di atas, dan " +
          "PIN-nya di pad. Node mencocokkan keduanya, bukan salah satunya.",
        from: null,
      })
      return
    }
    setAsking("PIN")
    setRefused(null)
    const answer = await supervisorByPin(who, typed)
    setAsking(null)
    // Gone the moment the node has answered, refusal included. It bought a grant
    // or it bought nothing, and there is no second thing to buy with it either
    // way — a PIN still in the ref is a PIN the next person at this counter can
    // press ⏎ on.
    setPin("")
    take(pressed, answer, "PIN")
  }

  function read(): api.Supervisor | null {
    const token = grant.current
    if (token !== null) {
      // A grant is held — by a finger or by a PIN — so the password field is not
      // read at all, not even if something was typed into it before.
      // `verify_supervisor` spends the grant first and never looks at a password
      // once one arrived, and it checks the name against whom the grant was
      // earned by, so the name sent is the node's own answer rather than
      // anything on this screen.
      if (granted !== null && Date.now() < granted.until) {
        return { username: granted.who, authorization: token }
      }
      release()
      return null
    }
    const who = username.current?.value.trim() ?? ""
    // Not trimmed: a password's spaces are the password's business.
    const secret = password.current?.value ?? ""
    if (who === "" || secret === "") return null
    return { username: who, password: secret }
  }

  function wipe() {
    if (username.current !== null) username.current.value = ""
    if (password.current !== null) password.current.value = ""
    // The PIN and the authorisation go at the same moment and for the same
    // reason. The grant was single-use at the node whichever way the node
    // answered, so one still sitting in a ref afterwards is a credential this
    // counter is keeping for nothing — and a PIN left in its ref is worse, since
    // it can buy another one.
    const spent = grant.current === null ? null : granted?.how ?? "FINGER"
    setPin("")
    release()
    setRefused(
      spent === null
        ? null
        : {
            text:
              (spent === "PIN"
                ? "PIN itu sudah terpakai untuk percobaan tadi"
                : "Sidik jari itu sudah terpakai untuk percobaan tadi") +
              " — satu otorisasi untuk satu tindakan. Kalau percobaannya " +
              (spent === "PIN"
                ? "ditolak, minta supervisor menekan PIN-nya lagi."
                : "ditolak, minta supervisor menekan jarinya lagi."),
            from: null,
          },
    )
  }

  /// What to say when nothing has authorised the action yet.
  ///
  /// It names only the ways *this* node will accept. A sentence sending a cashier
  /// to fetch a finger for a node that takes PINs sends somebody to press a
  /// scanner that is going to refuse them, while a queue waits — and on a node
  /// that accepts neither, the password is the whole answer.
  const missing =
    "Belum ada otorisasi supervisor. Isi nama pengguna dan kata sandinya" +
    (stepUp === "PIN"
      ? ", atau minta supervisor menekan PIN-nya di pad"
      : stepUp === "NONE"
        ? ""
        : ", atau minta supervisor menekan sidik jarinya") +
    " — node yang memeriksanya, bukan terminal ini."

  return {
    username,
    password,
    granted,
    asking,
    refused,
    now,
    stepUp,
    methods,
    /// The pad's `value`: read out of the ref at render time, never held in
    /// state. See the ref's own note above.
    pinValue: pin.current,
    setPin,
    missing,
    ask,
    askPin,
    release,
    read,
    wipe,
  }
}

type Supervision = ReturnType<typeof useSupervisor>

function Authorisation({ hold }: { hold: Supervision }) {
  const granted = hold.granted
  const left = granted === null ? null : Math.max(0, granted.until - hold.now)

  return (
    <>
      <span className="label">Otorisasi supervisor</span>
      {granted !== null && left !== null ? (
        <>
          {/* Who, before anything else. A cashier has to be able to see that a
              real person was recognised, and the name is the node's answer —
              it is also the name that will be written on the row. */}
          <div className="notice">
            Diotorisasi oleh <strong>{granted.who}</strong> (
            {granted.how === "PIN" ? "PIN" : "sidik jari"})
          </div>
          {left > GRANT_WARNING_MS ? (
            <p className="muted">
              Berlaku <span className="num">{countdown(left)}</span> lagi
            </p>
          ) : (
            <div className="notice warn">
              Otorisasi tinggal{" "}
              <strong className="num">{countdown(left)}</strong> — kirim
              sekarang.
            </div>
          )}
          <button className="btn ghost" type="button" onClick={hold.release}>
            Lepas otorisasi
          </button>
        </>
      ) : (
        <>
          {/* Unmounted while an authorisation is held, not merely disabled: a
              password field drawn beside a grant that will not be sending it is
              a lie about what is going to happen, and a field that is gone is a
              field nobody can leave a password sitting in. The PIN pad is in here
              for the same reason and on the same terms — while a grant is held
              there is nothing left for a PIN to buy, and getting back to it is
              the "lepas otorisasi" button below. */}
          <label className="field">
            Nama pengguna supervisor
            <input
              ref={hold.username}
              autoComplete="off"
              spellCheck={false}
              placeholder="Nama pengguna"
            />
          </label>
          <label className="field">
            Kata sandi supervisor
            <input ref={hold.password} type="password" autoComplete="off" />
          </label>

          {/* Only on a positive PIN from the node, and the notice says out loud
              what that positive answer means: this is a staging node. A cashier
              who cannot tell a rehearsal from the real thing is how a rehearsal
              reaches a customer, and a void authorised by a PIN is a void on a
              node nobody is meant to be selling from. */}
          {hold.stepUp === "PIN" && (
            <div>
              <span className="label">Atau PIN supervisor</span>
              <PinPad
                value={hold.pinValue}
                onChange={hold.setPin}
                onSubmit={() => void hold.askPin()}
                disabled={hold.asking !== null}
              />
              <button
                className="btn"
                type="button"
                style={{ marginTop: 8 }}
                disabled={hold.asking !== null || hold.pinValue === ""}
                onClick={() => void hold.askPin()}
              >
                {hold.asking === "PIN"
                  ? "Menanyakan ke node…"
                  : "Otorisasi dengan PIN ini"}
              </button>
            </div>
          )}
        </>
      )}

      {(hold.stepUp === "FINGERPRINT" || granted !== null) && (
      <button
        className="btn"
        type="button"
        disabled={hold.asking !== null}
        onClick={() => void hold.ask()}
      >
        {hold.asking === "FINGER"
          ? "Menunggu jari pada pemindai…"
          : granted === null
            ? "Otorisasi dengan sidik jari"
            : "Tekan sidik jari lagi"}
      </button>
      )}

      {hold.refused !== null && (
        <>
          <p className="error">{hold.refused.text}</p>
        </>
      )}
    </>
  )
}

// ── finding the sale ────────────────────────────────────────────────────

/// The one lookup both screens start with.
///
/// Kept together because both of them fail in the same three ways — a receipt
/// number typed in place of an id, a node that refuses, and an answer that is
/// not a receipt — and a cashier should get the same sentence for the same
/// mistake on either screen.
function useSaleLookup() {
  const [typed, setTyped] = useState("")
  const [sale, setSale] = useState<Sale | null>(null)
  const [looking, setLooking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function find(): Promise<void> {
    const wanted = typed.trim()
    if (wanted === "") return
    if (RECEIPT_NUMBER.test(wanted)) {
      setTrouble(
        "Itu nomor struk, bukan ID penjualan. Node mencari dengan ID penuh — " +
          "ambil dari layar penjualan yang bersangkutan.",
      )
      return
    }
    setLooking(true)
    setTrouble(null)
    const reply = await api.receipt(wanted)
    setLooking(false)
    if (!reply.ok) {
      // The old sale goes too. A refusal on screen with somebody else's basket
      // still drawn under it is how the wrong sale gets returned against.
      setSale(null)
      setTrouble(refusal(reply))
      return
    }
    const read = readSale(reply.body)
    if (read === null) {
      setSale(null)
      setTrouble(
        "Node menjawab, tapi isinya bukan struk penjualan. Periksa ID-nya.",
      )
      return
    }
    setSale(read)
  }

  return { typed, setTyped, sale, looking, trouble, find }
}

function SaleFinder({
  hold,
  hint,
}: {
  hold: ReturnType<typeof useSaleLookup>
  hint: string | null
}) {
  return (
    <form
      className="rows"
      onSubmit={(event) => {
        event.preventDefault()
        void hold.find()
      }}
    >
      <label className="field">
        ID penjualan
        <input
          value={hold.typed}
          onChange={(event) => hold.setTyped(event.target.value)}
          placeholder="Tempel ID penjualan…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      {hint !== null && <p className="muted">{hint}</p>}
      <button className="btn" type="submit" disabled={hold.looking}>
        {hold.looking ? "Mencari…" : "Buka penjualan"}
      </button>
    </form>
  )
}

/// What the sale was. Read-only on both screens, and read from the node rather
/// than from anything this terminal remembers: the receipt is the truth about
/// what happened, and these two screens exist to argue with it.
function SaleSummary({ sale }: { sale: Sale }) {
  return (
    <>
      <span className="label">Penjualan</span>
      {sale.stamp !== null && (
        <div className="notice warn">
          Struk ini sudah bertanda <strong>{sale.stamp}</strong> — sebagian atau
          seluruh isinya pernah kembali. Node menolak unit yang sama dua kali.
        </div>
      )}
      <div>
        <div className="kv">
          <span className="muted">Nomor struk</span>
          <strong className="num">{sale.receiptNo ?? "—"}</strong>
        </div>
        <div className="kv">
          <span className="muted">Waktu</span>
          <span className="num">{sale.when ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="muted">Kasir</span>
          <span>{sale.cashier ?? "—"}</span>
        </div>
        <div className="kv">
          <span className="muted">Dibayar dengan</span>
          <span>
            {sale.tenders.length === 0
              ? "—"
              : sale.tenders
                  .map(
                    (one) =>
                      `${methodLabel(one.method)}${
                        one.amountMinor === null
                          ? ""
                          : ` ${money(one.amountMinor)}`
                      }`,
                  )
                  .join(" · ")}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Total</span>
          <strong className="num">
            {sale.totalMinor === null ? "—" : money(sale.totalMinor)}
          </strong>
        </div>
      </div>
      <div className="receipt-lines">
        {sale.lines.map((line, at) => (
          <div className="receipt-line" key={`${line.skuCode}-${at}`}>
            <span>
              {line.name} <small className="num muted">{line.skuCode}</small>
            </span>
            <strong className="num">
              {line.lineTotalMinor === null ? "—" : money(line.lineTotalMinor)}
            </strong>
          </div>
        ))}
      </div>
    </>
  )
}

// ── retur ───────────────────────────────────────────────────────────────

/// A tag the customer has put back on the counter.
type Coming = {
  readonly epc: string
  readonly skuCode: string
  /// Off the receipt, when this SKU is on it: a name to read and what that line
  /// was charged. Both are for the cashier's eyes only. `record_return` refunds
  /// `charged_minor` from the sale line it finds itself, so this screen never
  /// sends a figure at all — and by SKU it cannot tell two units of one shirt
  /// apart anyway.
  readonly name: string | null
  readonly chargedMinor: number | null
  readonly onReceipt: boolean
  /// Chosen, never defaulted. Null until somebody says where the garment goes.
  readonly disposition: string | null
}

/// What the node wrote down.
type Refunded = {
  readonly refundMinor: number | null
  readonly method: string | null
  readonly approvedBy: string | null
  readonly remaining: number | null
}

export function ReturnScreen({
  actorId,
  onBack,
}: {
  actorId: string
  onBack: () => void
}) {
  const lookup = useSaleLookup()
  const supervisor = useSupervisor()
  const [coming, setComing] = useState<readonly Coming[]>([])
  const [reason, setReason] = useState("")
  const [method, setMethod] = useState<string | null>(null)
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  // Two places to be wrong, kept apart. A tag that would not read is answered
  // beside the tag field; a node that refused the whole return is answered
  // beside the button that sent it. One slot for both would put the sentence
  // half a screen from what caused it.
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<Refunded | null>(null)
  const scan = useRef<HTMLInputElement>(null)

  const sale = lookup.sale
  const openSale = sale?.saleId ?? null

  // Tags scanned against the previous sale are not evidence about this one, so
  // opening a different sale empties the list instead of carrying it over into
  // a return the node would refuse EPC by EPC.
  useEffect(() => {
    setComing([])
    setScanNote(null)
    setProblem(null)
  }, [openSale])

  // The key belongs to the attempt, not to the press: see the file's head.
  // `shape` is everything the node would file the key against except who
  // authorised it — a name this screen can now sometimes see, since a finger
  // comes back with one, and still leaves out. A refusal answered by a second
  // supervisor is this same return tried twice, not a second return.
  const attempt = useRef<string | null>(null)
  const shape = JSON.stringify([
    sale?.saleId ?? null,
    coming.map((one) => [one.epc, one.disposition]),
    method,
    reference.trim(),
    reason.trim(),
  ])
  useEffect(() => {
    attempt.current = null
  }, [shape])

  // The tag field is where the next thing happens once a sale is open, and a
  // cashier holding a garment in one hand should not have to find it.
  useEffect(() => {
    if (sale !== null && done === null) scan.current?.focus()
  }, [sale, done])

  /// More tags of one SKU than that SKU was sold on this receipt.
  ///
  /// The node refuses the extra one — it matches every EPC against the sale's
  /// own lines — but it refuses *after* a supervisor has been fetched to the
  /// counter and spent a password or a finger on it, and this much is knowable
  /// before that.
  const overscanned = useMemo(() => {
    if (sale === null) return [] as readonly string[]
    const sold = new Map<string, number>()
    for (const line of sale.lines) {
      sold.set(
        line.skuCode,
        (sold.get(line.skuCode) ?? 0) + Math.max(1, line.quantity),
      )
    }
    const seen = new Map<string, number>()
    const over: string[] = []
    for (const one of coming) {
      const many = (seen.get(one.skuCode) ?? 0) + 1
      seen.set(one.skuCode, many)
      if (many > (sold.get(one.skuCode) ?? 0) && !over.includes(one.skuCode)) {
        over.push(one.skuCode)
      }
    }
    return over as readonly string[]
  }, [sale, coming])

  const undecided = coming.filter((one) => one.disposition === null).length
  const ready =
    sale !== null &&
    coming.length > 0 &&
    undecided === 0 &&
    reason.trim() !== "" &&
    method !== null

  function onTag(raw: string) {
    const typed = raw.trim()
    if (typed === "") return
    const scanned = readScan(typed)
    // A barcode names a product, not a garment. The shop has forty of that
    // shirt and this says nothing about which one came home — and `lines` on
    // the wire is a list of EPCs, so there is no field for it either.
    if (scanned.kind !== "epc") {
      setScanNote(
        scanned.kind === "sku"
          ? "Itu kode produk, bukan barang yang mana. Retur dicatat per tag — pindai tag RFID di garmennya."
          : `“${typed}” bukan tag yang dikenali terminal ini.`,
      )
      return
    }
    if (coming.some((one) => one.epc === scanned.epc)) {
      setScanNote("Tag itu sudah ada di daftar. Satu tag adalah satu barang.")
      return
    }
    const line =
      sale?.lines.find((one) => one.skuCode === scanned.sku_code) ?? null
    setComing((held) => [
      ...held,
      {
        epc: scanned.epc,
        skuCode: scanned.sku_code,
        name: line?.name ?? null,
        chargedMinor: line?.lineTotalMinor ?? null,
        onReceipt: line !== null,
        disposition: null,
      },
    ])
    setScanNote(null)
  }

  async function send() {
    if (sale === null || method === null) return
    const lines: api.ReturnLine[] = []
    for (const one of coming) {
      if (one.disposition === null) {
        setProblem(
          "Masih ada tag tanpa tujuan. Retur tidak dikirim setengah jadi.",
        )
        return
      }
      lines.push({ epc: one.epc, disposition: one.disposition })
    }
    const trimmed = reference.trim()
    // `screen_reference` guards a *sale* tender against this and never sees
    // `refund_reference`, so the till is the only thing standing in front of
    // it. A card number that reaches a database is a card number somebody has
    // to erase from the backups afterwards.
    if (trimmed.replace(/\D/g, "").length >= 12) {
      setProblem(
        "Referensi itu menyerupai nomor kartu. Tulis kode approval atau nama acquirer, bukan nomor instrumennya.",
      )
      return
    }
    // Read last, and only once everything this screen could refuse on its own
    // has already passed: a password is not touched, and a finger's three
    // minutes are not spent, to be told the form is incomplete.
    const authorisation = supervisor.read()
    if (authorisation === null) {
      setProblem(
        "Belum ada otorisasi supervisor. Isi nama pengguna dan kata sandinya, atau minta supervisor menekan sidik jarinya — node yang memeriksanya, bukan terminal ini.",
      )
      return
    }
    attempt.current ??= crypto.randomUUID()

    setBusy(true)
    setProblem(null)
    const reply = await api.returnSale({
      sale_id: sale.saleId,
      lines,
      refund_method: method,
      refund_reference: trimmed === "" ? null : trimmed,
      reason: reason.trim(),
      supervisor: authorisation,
      actor_id: actorId,
      idempotency_key: attempt.current,
    })
    // The moment the node has answered, either way — the password field and the
    // fingerprint authorisation together. A refusal is the case where either is
    // most likely to be left lying about while somebody reads the reason out
    // loud, and the grant was single-use whichever way this went.
    supervisor.wipe()
    setBusy(false)
    if (!reply.ok) {
      setProblem(refusal(reply))
      return
    }
    const body = asMap(reply.body) ?? {}
    setDone({
      refundMinor: asCount(body.refund_minor),
      method: asText(body.refund_method),
      approvedBy: asText(body.approved_by),
      remaining: asCount(body.remaining_lines),
    })
  }

  if (done !== null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar actorId={actorId} />
        <div className="page">
          <div className="page-inner">
            <div className="page-head">
              <div>
                <span className="label">Retur tercatat</span>
                <h1 className="num">
                  {done.refundMinor === null ? "—" : money(done.refundMinor)}
                </h1>
              </div>
              <button className="btn primary" onClick={onBack}>
                Selesai
              </button>
            </div>
            <div>
              <div className="kv">
                <span className="muted">Disetujui oleh</span>
                <strong>{done.approvedBy ?? "—"}</strong>
              </div>
              <div className="kv">
                <span className="muted">Uang kembali lewat</span>
                <span>{methodLabel(done.method)}</span>
              </div>
              <div className="kv">
                <span className="muted">Masih di tangan pelanggan</span>
                <span className="num">
                  {done.remaining === null ? "—" : `${done.remaining} unit`}
                </span>
              </div>
            </div>
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
              <span className="label">Retur</span>
              <h1>Retur barang</h1>
            </div>
            <button className="btn ghost" onClick={onBack}>
              <Icon name="back" />
              Kembali ke konter
            </button>
          </div>

          <div className="steps">
            <span className={sale === null ? "active" : undefined}>
              1 · Cari penjualan
            </span>
            <span
              className={
                sale !== null && coming.length === 0 ? "active" : undefined
              }
            >
              2 · Pindai tag yang kembali
            </span>
            <span
              className={
                coming.length > 0 && !ready ? "active" : undefined
              }
            >
              3 · Tujuan, alasan, cara kembali
            </span>
            <span className={ready ? "active" : undefined}>
              4 · Otorisasi supervisor
            </span>
          </div>

          <SaleFinder
            hold={lookup}
            hint={null}
          />
          {lookup.trouble !== null && <p className="error">{lookup.trouble}</p>}

          {sale === null ? (
            <div className="empty">
              <h3>Belum ada penjualan dibuka</h3>
            </div>
          ) : (
            <>
              <div className="divider" />
              <SaleSummary sale={sale} />

              <div className="divider" />
              <span className="label">Barang yang kembali</span>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  const field = scan.current
                  if (field === null) return
                  onTag(field.value)
                  field.value = ""
                }}
              >
                <label className="field">
                  Pindai tag yang kembali
                  <input
                    ref={scan}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Pindai tag atau ketik EPC"
                  />
                </label>
              </form>
              {scanNote !== null && <p className="error">{scanNote}</p>}

              {coming.length === 0 ? (
                <div className="empty">
                  <h3>Belum ada tag dipindai</h3>
                </div>
              ) : (
                <div className="rows">
                  {coming.map((one) => (
                    <div className="row-item" key={one.epc}>
                      <div className="grow">
                        <h3>{one.name ?? one.skuCode}</h3>
                        <p className="num">
                          {one.skuCode} · …{one.epc.slice(-8)}
                        </p>
                        <div className="chips">
                          {DISPOSITIONS.map((where) => (
                            <button
                              key={where.value}
                              className={
                                one.disposition === where.value
                                  ? "chip on"
                                  : "chip"
                              }
                              title={where.detail}
                              onClick={() =>
                                setComing((held) =>
                                  held.map((item) =>
                                    item.epc === one.epc
                                      ? { ...item, disposition: where.value }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {where.label}
                            </button>
                          ))}
                          {one.disposition === null && (
                            <span className="badge warn">
                              Tujuan belum dipilih
                            </span>
                          )}
                          {!one.onReceipt && (
                            <span className="badge bad">
                              SKU tidak ada di struk ini
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="num">
                        {one.chargedMinor === null
                          ? "—"
                          : money(one.chargedMinor)}
                      </span>
                      <button
                        className="btn ghost"
                        onClick={() =>
                          setComing((held) =>
                            held.filter((item) => item.epc !== one.epc),
                          )
                        }
                      >
                        Lepas
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {undecided > 0 && (
                <div className="notice warn">
                  {undecided} tag belum diberi tujuan.
                </div>
              )}
              {overscanned.length > 0 && (
                <div className="notice warn">
                  Tag untuk {overscanned.join(", ")} lebih banyak daripada yang
                  terjual di struk ini. Node akan menolak kelebihannya.
                </div>
              )}

              <div className="divider" />
              <label className="field">
                Alasan retur
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Misalnya: ukuran tidak pas"
                  autoComplete="off"
                />
              </label>

              <span className="label">Uang kembali lewat</span>
              <div className="chips">
                {REFUNDS.map((one) => (
                  <button
                    key={one.value}
                    className={method === one.value ? "chip on" : "chip"}
                    onClick={() => setMethod(one.value)}
                  >
                    {one.label}
                  </button>
                ))}
              </div>

              {method !== null && method !== "CASH" && (
                <label className="field">
                  Referensi pengembalian (boleh kosong)
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="Misalnya: BCA · approval 8842"
                    autoComplete="off"
                  />
                </label>
              )}

              <div className="divider" />
              <Authorisation hold={supervisor} />

              {problem !== null && <p className="error">{problem}</p>}
              <button
                className="btn primary"
                disabled={busy || !ready}
                onClick={() => void send()}
              >
                {busy ? "Mengirim ke node…" : "Catat retur"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── void ────────────────────────────────────────────────────────────────

type Voided = {
  readonly refundMinor: number | null
  readonly approvedBy: string | null
  readonly voidedAt: string | null
  readonly units: number
}

export function VoidScreen({
  actorId,
  onBack,
}: {
  actorId: string
  onBack: () => void
}) {
  const lookup = useSaleLookup()
  const supervisor = useSupervisor()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<Voided | null>(null)

  const sale = lookup.sale

  // One key per attempt, thrown away when the attempt changes. A void has only
  // two things to change: which sale, and why.
  const attempt = useRef<string | null>(null)
  const shape = JSON.stringify([sale?.saleId ?? null, reason.trim()])
  useEffect(() => {
    attempt.current = null
  }, [shape])

  const ready = sale !== null && reason.trim() !== ""

  async function send() {
    if (sale === null) return
    const authorisation = supervisor.read()
    if (authorisation === null) {
      setProblem(
        "Belum ada otorisasi supervisor. Isi nama pengguna dan kata sandinya, atau minta supervisor menekan sidik jarinya — node yang memeriksanya, bukan terminal ini.",
      )
      return
    }
    attempt.current ??= crypto.randomUUID()

    setBusy(true)
    setProblem(null)
    const reply = await api.voidSale(sale.saleId, {
      reason: reason.trim(),
      supervisor: authorisation,
      actor_id: actorId,
      idempotency_key: attempt.current,
    })
    // Wiped the moment the node has answered, refusal included — the field and
    // the fingerprint authorisation both.
    supervisor.wipe()
    setBusy(false)
    if (!reply.ok) {
      setProblem(refusal(reply))
      return
    }
    const body = asMap(reply.body) ?? {}
    setDone({
      refundMinor: asCount(body.refund_minor),
      approvedBy: asText(body.approved_by),
      voidedAt: asText(body.voided_at),
      units: asList(body.lines).length,
    })
  }

  if (done !== null) {
    return (
      <div id="app" data-screen="sale">
        <Topbar actorId={actorId} />
        <div className="page">
          <div className="page-inner">
            <div className="page-head">
              <div>
                <span className="label">Penjualan dibatalkan</span>
                <h1 className="num">
                  {done.refundMinor === null ? "—" : money(done.refundMinor)}
                </h1>
                <p>
                  Seluruh isinya kembali ke lantai jual dalam satu gerakan, dan
                  penjualannya berstatus VOIDED di node.
                </p>
              </div>
              <button className="btn primary" onClick={onBack}>
                Selesai
              </button>
            </div>
            <div>
              <div className="kv">
                <span className="muted">Disetujui oleh</span>
                <strong>{done.approvedBy ?? "—"}</strong>
              </div>
              <div className="kv">
                <span className="muted">Waktu</span>
                <span className="num">{done.voidedAt ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="muted">Unit yang pulang</span>
                <span className="num">{done.units} unit</span>
              </div>
            </div>
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
              <span className="label">Void</span>
              <h1>Void penjualan</h1>
            </div>
            <button className="btn ghost" onClick={onBack}>
              <Icon name="back" />
              Kembali ke konter
            </button>
          </div>

          <div className="steps">
            <span className={sale === null ? "active" : undefined}>
              1 · Cari penjualan
            </span>
            <span className={sale !== null && !ready ? "active" : undefined}>
              2 · Alasan pembatalan
            </span>
            <span className={ready ? "active" : undefined}>
              3 · Otorisasi supervisor
            </span>
          </div>

          <SaleFinder
            hold={lookup}
            hint={null}
          />
          {lookup.trouble !== null && <p className="error">{lookup.trouble}</p>}

          {sale === null ? (
            <div className="empty">
              <h3>Belum ada penjualan dibuka</h3>
            </div>
          ) : (
            <>
              <div className="divider" />
              <SaleSummary sale={sale} />

              <div className="divider" />
              <label className="field">
                Alasan pembatalan
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Misalnya: salah tekan"
                  autoComplete="off"
                />
              </label>

              <div className="divider" />
              <Authorisation hold={supervisor} />

              {problem !== null && <p className="error">{problem}</p>}
              <button
                className="btn danger"
                disabled={busy || !ready}
                onClick={() => void send()}
              >
                {busy
                  ? "Mengirim ke node…"
                  : `Batalkan seluruh penjualan${
                      sale.totalMinor === null
                        ? ""
                        : ` ${money(sale.totalMinor)}`
                    }`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
