/// The dialogs behind ⇧3 Laci — "Tambah modal kasir", "Setoran sementara" and
/// "Setor modal" — and the slip each one prints (pos-classic-prototype.html:
/// `faddView`, `faddGo`, `depositNow`, `floatDeposit`, `slipPaperView`). The
/// three cash movements live in one place: Tutup kasir only counts and closes.
///
/// Tambah modal has no finger (client, 28 Oct 2026): the cashier asks for the
/// amount and the slip is the confirmation. Setoran sementara and Setor modal
/// ask the Kepala toko's finger, the one who receives the money. The node takes
/// the supervisor's proof directly on the movement (`perform`, as Return and
/// Barang tak dikenal do), and answers a slip number (TM-0001 / ST-0001 /
/// SM-0001). A node that answers without a slip gets one built here from what
/// is known.
///
/// The slips are the 80 mm thermal papers of pos-thermal-prototype.html
/// (`screens/thermal.tsx`): a Setoran sementara lists the notes counted and
/// prints one cut label per denomination under its paper.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"

import * as api from "@/api"
import { useApproval } from "@/approval"
import { Icon } from "@/icons"
import { seatNow } from "@/seat"
import { useNodeConfig, useSession } from "@/session"
import { useShortcuts, viaPointer } from "@/shortcuts"
import { units as grouped } from "@itulah/contract/money"
import {
  CashSlipPaper,
  CutLabels,
  PrintCopy,
  printSlip,
  shopOf,
  ThermalSheet,
  type Shop,
} from "@/screens/thermal"

import "@/exchange-d.css"
import "@/laci-d.css"

const rp = (n: number) => `Rp ${grouped(n)}`

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `laci-${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

const SILENT = "Server toko menolak tanpa alasan."

/// What the paper says. `modal`: the head of the shop hands over, the cashier
/// receives. `setor`: the cashier hands over what they counted, the supervisor
/// receives, the amount printed. `float` (Setor modal): the cashier hands over
/// the float, the supervisor receives, the amount printed.
type Slip = {
  readonly kind: "modal" | "setor" | "float"
  readonly no: string
  readonly at: string
  readonly amount: number | null
  readonly cashier: string
  readonly from: string
  readonly to: string
  /// The notes a setoran was counted from; empty on the other slips.
  readonly counted: readonly { readonly value: number; readonly pieces: number }[]
  /// The shop's header for the paper.
  readonly shop: Shop
}

/// Reads the node's reply defensively: the slip may be the body itself or sit
/// under `slip`; any field may be missing on a node older than the contract.
function slipFrom(
  body: unknown,
  kind: Slip["kind"],
  fallback: {
    cashier: string
    supervisor: string
    amount: number | null
    counted?: readonly { readonly value: number; readonly pieces: number }[]
  },
): Slip {
  const root = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const inner =
    root.slip !== null && typeof root.slip === "object" ? (root.slip as Record<string, unknown>) : root
  const text = (key: string): string | null => {
    const value = inner[key]
    return typeof value === "string" && value.trim() !== "" ? value : null
  }
  const amount = typeof inner.amount_minor === "number" ? inner.amount_minor : fallback.amount
  const given = text("given_by_name")
  const received = text("received_by_name")
  return {
    kind,
    no: text("slip_no") ?? (kind === "modal" ? "TM-0001" : kind === "float" ? "SM-0001" : "ST-0001"),
    at: text("at") ?? new Date().toISOString(),
    // A float handed over is a figure on the paper, however the node signs it.
    amount:
      kind === "modal" || kind === "setor"
        ? (amount ?? fallback.amount)
        : kind === "float" && amount !== null
          ? Math.abs(amount)
          : null,
    cashier: fallback.cashier,
    from: given ?? (kind === "modal" ? fallback.supervisor : fallback.cashier),
    to: received ?? (kind === "modal" ? fallback.cashier : fallback.supervisor),
    counted: fallback.counted ?? [],
    shop: shopOf({ ...inner, ...root }),
  }
}

function useCashier(): string {
  const { me } = useSession()
  return me?.display_name ?? me?.username ?? ""
}

function Frame({
  label,
  approvalOpen,
  sheet,
  onClose,
  children,
}: {
  label: string
  approvalOpen: boolean
  sheet?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const [enter] = useState(viaPointer)
  return (
    <div
      className={enter ? "xchd enter" : "xchd"}
      onMouseDown={(event) => event.target === event.currentTarget && !approvalOpen && onClose()}
    >
      <section className="dlg laci" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </section>
      {sheet}
    </div>
  )
}

/// "Tambah modal kasir": the amount, then the slip. No finger: the cashier and
/// the head of the shop confirm on the paper.
export function TambahModalDialog({
  actorId,
  shiftId: shiftOverride,
  onClose,
  onDone,
}: {
  actorId: string
  currency: string
  /// The shift the money goes into, when the caller knows it (Tutup kasir);
  /// else the seat this till holds.
  shiftId?: string
  onClose: () => void
  /// `body` is the node's reply — the shift report — for a screen that shows
  /// the drawer and must draw it again.
  onDone: (text: string, body?: unknown) => void
}) {
  const cashier = useCashier()
  const [digits, setDigits] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [float, setFloat] = useState<number | null>(null)
  const [slip, setSlip] = useState<Slip | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const sentBody = useRef<unknown>(null)
  // One key for an amount: the same press tried again is the same movement.
  const attempt = useRef<{ value: number; key: string } | null>(null)
  const value = Number(digits || 0)

  // "Modal sekarang": what the drawer was opened with plus earlier additions,
  // less what went back to the Kepala toko (Setor modal). Left out when the
  // report cannot be read.
  useEffect(() => {
    const shiftId = shiftOverride ?? seatNow()?.shift_id
    if (shiftId === undefined) return
    let alive = true
    void api
      .shiftReport(shiftId)
      .then((reply) => {
        if (!alive || !reply.ok || reply.body === null) return
        const report = reply.body as {
          opening_float_minor?: unknown
          float_returned_minor?: unknown
          movements?: { kind?: unknown; amount_minor?: unknown }[]
        }
        if (typeof report.opening_float_minor !== "number") return
        const sum = (kinds: readonly string[], sign: (n: number) => number) =>
          (report.movements ?? [])
            .filter((one) => typeof one.kind === "string" && kinds.includes(one.kind))
            .reduce((total, one) => total + (typeof one.amount_minor === "number" ? sign(one.amount_minor) : 0), 0)
        const added = sum(["PICKUP", "CORRECTION"], (n) => n)
        const returned =
          typeof report.float_returned_minor === "number"
            ? report.float_returned_minor
            : sum(["FLOAT_RETURN"], Math.abs)
        setFloat(Math.max(0, report.opening_float_minor + added - returned))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [shiftOverride])

  useEffect(() => {
    if (slip === null) box.current?.focus()
  }, [slip])

  useShortcuts({ Escape: onClose }, slip === null && !busy)

  async function go() {
    if (value <= 0) {
      box.current?.focus()
      return
    }
    if (busy) return
    const shiftId = shiftOverride ?? seatNow()?.shift_id
    if (shiftId === undefined) {
      setProblem("Kasir belum dibuka.")
      return
    }
    if (actorId.trim() === "") {
      setProblem("Masuk dulu.")
      return
    }
    setProblem(null)
    setBusy(true)
    if (attempt.current === null || attempt.current.value !== value) {
      attempt.current = { value, key: newKey() }
    }
    const sent = await api.cashMovement(shiftId, {
      kind: "PICKUP",
      amount_minor: value,
      reason: "Tambah modal kasir",
      actor_id: actorId,
      idempotency_key: attempt.current.key,
    })
    setBusy(false)
    if (!sent.ok) {
      setProblem(
        sent.status === 404 || sent.status === 405
          ? "Server toko ini belum bisa menambah modal kasir."
          : (sent.problem ?? SILENT),
      )
      return
    }
    sentBody.current = sent.body
    setSlip(slipFrom(sent.body, "modal", { cashier, supervisor: "", amount: value }))
  }

  if (slip !== null) {
    return (
      <SlipDialog
        slip={slip}
        onDone={() => onDone(`Modal ditambah · ${rp(slip.amount ?? value)}`, sentBody.current)}
      />
    )
  }

  return (
    <Frame label="Tambah modal kasir" approvalOpen={false} onClose={onClose}>
      <div className="dlg-head">
        <div>
          <p className="ttl">Tambah modal kasir</p>
          {float !== null && <p className="cap">Modal sekarang {rp(float)}</p>}
        </div>
        <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body">
        <label className="laci-f">
          Tambah
          <span className="unk-amt">
            <span className="cur">Rp</span>
            <input
              ref={box}
              value={value > 0 ? grouped(value) : ""}
              onChange={(event) =>
                setDigits(event.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void go()
                } else if (event.key === "." || event.key === "," || event.code === "NumpadDecimal") {
                  // The key that would be the decimal point types 000.
                  event.preventDefault()
                  if (digits !== "") setDigits((was) => (was + "000").slice(0, 9))
                }
              }}
              inputMode="numeric"
              placeholder="0"
              autoComplete="off"
              aria-label="Tambah modal"
            />
          </span>
        </label>
        {problem !== null && (
          <p className="laci-err" role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className="dlg-foot">
        <span className="sp" />
        <button type="button" className="ds-btn ds-btn--ghost" onClick={onClose}>
          Batal
        </button>
        <button type="button" className="ds-btn ds-btn--primary" disabled={value <= 0 || busy} onClick={() => void go()}>
          <span>Tambah</span>
          <span className="kbd">Enter</span>
        </button>
      </div>
    </Frame>
  )
}

/// The denominations a setoran is counted in, largest first as Tutup kasir
/// lays them out (owner, 28 Oct 2026: "orang ngisi dulu uang 100 ribu berapa").
const SETOR_DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
] as const
const SETOR_ORDER = SETOR_DENOMINATIONS

/// The prototype's money chips, as Tutup kasir draws them.
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

/// "Setoran sementara": the cashier counts what leaves the drawer by
/// denomination, then the Kepala toko's finger receives it and the paper
/// carries the total.
export function SetoranDialog({
  actorId,
  onClose,
  onDone,
}: {
  actorId: string
  currency: string
  onClose: () => void
  onDone: (text: string) => void
}) {
  const approval = useApproval()
  const cashier = useCashier()
  const [slip, setSlip] = useState<Slip | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const key = useRef(newKey())

  const declared = SETOR_DENOMINATIONS.reduce(
    (sum, value) => sum + value * (Number(counts[value] ?? "") || 0),
    0,
  )
  const set = (value: number, next: number) =>
    setCounts((was) => ({
      ...was,
      [value]: next <= 0 ? "" : String(Math.min(next, 9999)),
    }))
  const pieces = (value: number) => Number(counts[value] ?? "") || 0

  useShortcuts({ Escape: onClose }, !approval.open && slip === null)

  const [busy, setBusy] = useState(false)

  // No finger (Hari, 30 Oct 2026): a Setoran sementara is recorded at once and
  // the Kepala toko's line on the slip is left for a pen, as on Tambah modal.
  async function go() {
    if (declared <= 0) {
      setProblem("Hitung dulu uang yang disetor.")
      return
    }
    if (busy) return
    const shiftId = seatNow()?.shift_id
    if (shiftId === undefined) {
      setProblem("Kasir belum dibuka.")
      return
    }
    if (actorId.trim() === "") {
      setProblem("Masuk dulu.")
      return
    }
    setProblem(null)
    ;(document.activeElement as HTMLElement | null)?.blur()
    setBusy(true)
    const counted = SETOR_DENOMINATIONS.map((value) => ({
      value_minor: value,
      pieces: Number(counts[value] ?? "") || 0,
    })).filter((line) => line.pieces > 0)
    // One key for this attempt: pressed again, it is the same movement.
    const sent = await api.cashMovement(shiftId, {
      kind: "DROP",
      amount_minor: declared,
      counted,
      reason: "Setoran sementara",
      actor_id: actorId,
      idempotency_key: key.current,
    })
    setBusy(false)
    if (!sent.ok) {
      setProblem(
        sent.status === 404 || sent.status === 405
          ? "Server toko ini belum bisa menerima setoran sementara."
          : (sent.problem ?? SILENT),
      )
      return
    }
    setSlip(
      slipFrom(sent.body, "setor", {
        cashier,
        supervisor: "",
        amount: declared,
        counted: SETOR_DENOMINATIONS.map((value) => ({ value, pieces: pieces(value) })),
      }),
    )
  }

  // The sheet was dismissed with nothing done: nothing left to show.
  const was = useRef(false)
  useEffect(() => {
    if (approval.open) was.current = true
    else if (was.current && slip === null && problem === null) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval.open])

  if (slip !== null) {
    return (
      <SlipDialog
        slip={slip}
        onDone={() => onDone(`Setoran sementara dicatat · ${rp(declared)}`)}
      />
    )
  }

  return (
    <Frame
      label="Setoran sementara"
      approvalOpen={approval.open}
      sheet={approval.sheet}
      onClose={onClose}
    >
      <div className="dlg-head">
        <p className="ttl">Setoran sementara</p>
        <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body">
        <div className="laci-count">
          <p className="laci-count-h">
            <span className="l">Uang kertas &amp; koin</span>
            <span className="c">Jumlah</span>
            <span className="r">Nilai</span>
          </p>
          {SETOR_ORDER.map((value, index) => (
            <div className="laci-count-row" key={value}>
              <span className="laci-chip">
                <MoneyChip value={value} />
              </span>
              <span className="laci-val">{rp(value)}</span>
              <span className="laci-step">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Kurangi satu ${rp(value)}`}
                  onClick={() => set(value, pieces(value) - 1)}
                >
                  −
                </button>
                <input
                  value={counts[value] ?? ""}
                  onChange={(event) =>
                    set(value, Number(event.target.value.replace(/\D/g, "")) || 0)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      go()
                    }
                  }}
                  inputMode="numeric"
                  placeholder="0"
                  autoComplete="off"
                  autoFocus={index === 0}
                  aria-label={`Jumlah lembar ${rp(value)}`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Tambah satu ${rp(value)}`}
                  onClick={() => set(value, pieces(value) + 1)}
                >
                  +
                </button>
              </span>
              <span className={`laci-amt${pieces(value) > 0 ? "" : " zero"}`}>
                {pieces(value) > 0 ? rp(value * pieces(value)) : "—"}
              </span>
            </div>
          ))}
        </div>
        <p className="laci-total">
          <span>Total setoran</span>
          <b>{rp(declared)}</b>
        </p>
        {problem !== null && (
          <p className="laci-err" role="alert">
            {problem}
          </p>
        )}
      </div>
      {/* One button: × in the head closes (primary-only, Hari 24 Oct 2026). */}
      <div className="dlg-foot">
        <span className="sp" />
        <button
          type="button"
          className="ds-btn ds-btn--primary"
          disabled={declared <= 0}
          onClick={go}
        >
          <span>Setor</span>
          <span className="kbd">Enter</span>
        </button>
      </div>
    </Frame>
  )
}

/// "Setor modal" (Laci, ⇧3; prototype `floatDeposit`): no amount is
/// typed — what is left of the float all goes — so the dialog opens on the
/// Kepala toko's finger at once, then the slip "SETOR MODAL" with the cashier
/// giving and the Kepala toko receiving. It is a movement of its own kind
/// (`FLOAT_RETURN`) and does not close the shift. A node that does not know
/// the kind answers in its own words, the sheet shows them, and nothing
/// changes.
export function SetorModalDialog({
  actorId,
  shiftId,
  amountMinor,
  onClose,
  onDone,
}: {
  actorId: string
  /// The shift on the close screen.
  shiftId: string
  /// What is left of the float. All of it is handed over.
  amountMinor: number
  onClose: () => void
  /// `body` is the node's reply — the shift report, with the float returned.
  onDone: (text: string, body?: unknown) => void
}) {
  const approval = useApproval()
  const cashier = useCashier()
  const [slip, setSlip] = useState<Slip | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const sentBody = useRef<unknown>(null)
  const asked = useRef(false)
  const key = useRef(newKey())

  // Opens on the finger sheet at once; Batal there closes this too.
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    if (actorId.trim() === "") {
      setProblem("Masuk dulu.")
      return
    }
    if (amountMinor <= 0) {
      setProblem("Tidak ada modal yang tersisa.")
      return
    }
    let reply: unknown = null
    approval.ask({
      action: "EDIT_CART",
      title: "Setor modal",
      detail: `${rp(amountMinor)} · diterima Kepala toko`,
      perform: async (supervisor) => {
        const sent = await api.cashMovement(shiftId, {
          kind: "FLOAT_RETURN",
          amount_minor: amountMinor,
          reason: "Setor modal",
          actor_id: actorId,
          idempotency_key: key.current,
          supervisor,
        })
        if (!sent.ok) {
          return sent.status === 401 || sent.status === 403
            ? "Bukan kepala toko"
            : (sent.problem ??
                (sent.status === 404 || sent.status === 405
                  ? "Server toko ini belum bisa menerima setor modal."
                  : SILENT))
        }
        reply = sent.body
        sentBody.current = sent.body
        return null
      },
      onApproved: (by) =>
        setSlip(slipFrom(reply, "float", { cashier, supervisor: by.name, amount: amountMinor })),
    })
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The sheet was dismissed with nothing done: nothing left to show.
  const was = useRef(false)
  useEffect(() => {
    if (approval.open) was.current = true
    else if (was.current && slip === null && problem === null) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval.open])

  if (slip !== null) {
    return (
      <SlipDialog
        slip={slip}
        onDone={() => onDone(`Modal disetor · ${rp(slip.amount ?? amountMinor)}`, sentBody.current)}
      />
    )
  }

  return (
    <>
      {problem !== null && (
        <Frame label="Setor modal" approvalOpen={false} sheet={approval.sheet} onClose={onClose}>
          <div className="dlg-head">
            <p className="ttl">Setor modal</p>
            <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div className="dlg-body">
            <p className="laci-err" role="alert">
              {problem}
            </p>
          </div>
          <div className="dlg-foot">
            <span className="sp" />
            <button type="button" className="ds-btn ds-btn--primary" onClick={onClose}>
              <span>Tutup</span>
            </button>
          </div>
        </Frame>
      )}
      {problem === null && approval.sheet !== null && <div className="xchd">{approval.sheet}</div>}
    </>
  )
}

/// The slip: the 80 mm paper as it prints, beside "Cetak lagi" and "Selesai",
/// printed once on opening. A setoran's paper lists the notes counted and is
/// followed by one cut label per denomination.
function SlipDialog({ slip, onDone }: { slip: Slip; onDone: () => void }) {
  const { config } = useNodeConfig()
  const modal = slip.kind === "modal"
  const float = slip.kind === "float"
  const code = (config?.joined?.site_code ?? "").trim()
  const title = modal ? "TAMBAH MODAL KASIR" : float ? "SETOR MODAL" : "SETORAN SEMENTARA"
  const parsed = new Date(slip.at)
  const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed

  const print = () => window.setTimeout(() => void printSlip(config?.paper), 50)
  useEffect(() => {
    print()
  }, [])
  useShortcuts({ Enter: onDone, Escape: onDone })

  const paper = (
    <CashSlipPaper
      shop={slip.shop}
      title={title}
      no={slip.no}
      at={at}
      cashier={slip.cashier}
      code={code}
      amount={slip.amount}
      denoms={slip.kind === "setor" ? slip.counted : undefined}
      from={slip.from}
      to={slip.to}
    />
  )
  const labels =
    slip.kind === "setor" ? <CutLabels who={slip.cashier} at={at} lines={slip.counted} /> : null

  return (
    <>
      <div className="xchd enter">
        <section
          className="dlg laci"
          role="dialog"
          aria-modal="true"
          aria-label={modal ? "Tambah modal kasir" : float ? "Setor modal" : "Setoran sementara"}
        >
          <div className="dlg-head">
            <p className="ttl">{modal ? "Modal ditambah" : float ? "Modal disetor" : "Setoran sementara"}</p>
          </div>
          <div className="dlg-body">
            <div className="laci-paper">
              <ThermalSheet>{paper}</ThermalSheet>
              {labels}
            </div>
          </div>
          <div className="dlg-foot">
            <button type="button" className="ds-btn ds-btn--tint" onClick={print}>
              Cetak lagi
            </button>
            <span className="sp" />
            <button type="button" className="ds-btn ds-btn--primary" autoFocus onClick={onDone}>
              <span>Selesai</span>
              <span className="kbd">Enter</span>
            </button>
          </div>
        </section>
      </div>
      <PrintCopy paper={paper} labels={labels} />
    </>
  )
}

/// "Setor modal" from Laci: the menu knows no shift, so this reads the open
/// one and what is left of its float before opening the finger dialog.
export function SetorModalFromSeat({
  actorId,
  onClose,
  onDone,
}: {
  actorId: string
  onClose: () => void
  onDone: (text: string, body?: unknown) => void
}) {
  const [ready, setReady] = useState<{ shiftId: string; amount: number } | null | "waiting">(
    "waiting",
  )
  useEffect(() => {
    const shiftId = seatNow()?.shift_id
    if (shiftId === undefined) {
      setReady(null)
      return
    }
    let alive = true
    void api
      .shiftReport(shiftId)
      .then((reply) => {
        if (!alive) return
        if (!reply.ok || reply.body === null) {
          setReady(null)
          return
        }
        const report = reply.body as {
          opening_float_minor?: unknown
          float_returned_minor?: unknown
          movements?: { kind?: unknown; amount_minor?: unknown }[]
        }
        if (typeof report.opening_float_minor !== "number") {
          setReady(null)
          return
        }
        const sum = (kinds: readonly string[], sign: (n: number) => number) =>
          (report.movements ?? [])
            .filter((one) => typeof one.kind === "string" && kinds.includes(one.kind))
            .reduce(
              (total, one) =>
                total + (typeof one.amount_minor === "number" ? sign(one.amount_minor) : 0),
              0,
            )
        const added = sum(["PICKUP", "CORRECTION"], (n) => n)
        const returned =
          typeof report.float_returned_minor === "number"
            ? report.float_returned_minor
            : sum(["FLOAT_RETURN"], Math.abs)
        setReady({
          shiftId,
          amount: Math.max(0, report.opening_float_minor + added - returned),
        })
      })
      .catch(() => alive && setReady(null))
    return () => {
      alive = false
    }
  }, [])

  if (ready === "waiting") return null
  if (ready === null) {
    return (
      <Frame label="Setor modal" approvalOpen={false} onClose={onClose}>
        <div className="dlg-head">
          <p className="ttl">Setor modal</p>
          <button type="button" className="x-btn" aria-label="Tutup" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-body">
          <p className="laci-err" role="alert">
            Kasir belum dibuka.
          </p>
        </div>
        <div className="dlg-foot">
          <span className="sp" />
          <button type="button" className="ds-btn ds-btn--primary" onClick={onClose}>
            <span>Tutup</span>
          </button>
        </div>
      </Frame>
    )
  }
  return (
    <SetorModalDialog
      actorId={actorId}
      shiftId={ready.shiftId}
      amountMinor={ready.amount}
      onClose={onClose}
      onDone={onDone}
    />
  )
}
