/// The two dialogs behind F3 Laci — "Tambah modal kasir" and "Setoran
/// sementara" — and the slip each one prints (pos-classic-prototype.html:
/// `faddView`, `faddGo`, `depositNow`, `slipPaperView`). Tutup kasir (F4) shares
/// the first and has a third, "Setor modal" (`floatDeposit`): the cashier hands
/// what is left of the float to the Kepala toko, slip "SETOR MODAL" (SM-0001).
///
/// All ask the Kepala toko's finger: for the modal they are the one who hands
/// the money over, for the setoran the one who receives it. The node takes the
/// supervisor's proof directly on the movement (`perform`, as Return and Barang
/// tak dikenal do), and answers a slip number (TM-0001 / ST-0001 / SM-0001). A
/// node that answers without a slip gets one built here from what is known.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import * as api from "@/api"
import { useApproval } from "@/approval"
import { Icon } from "@/icons"
import { siteTitle } from "@/joining"
import { seatNow } from "@/seat"
import { useNodeConfig, useSession } from "@/session"
import { useShortcuts, viaPointer } from "@/shortcuts"
import { units as grouped } from "@itulah/contract/money"

import "@/exchange-d.css"
import "@/laci-d.css"

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
const two = (n: number) => String(n).padStart(2, "0")
const rp = (n: number) => `Rp ${grouped(n)}`

/// `23 Okt 2026, 14:05` — the prototype's `dayTime`. Anything that is not a
/// timestamp is shown as it arrived.
function dayTime(stamp: string): string {
  const at = new Date(stamp)
  if (Number.isNaN(at.getTime())) return stamp
  return `${at.getDate()} ${MON[at.getMonth()]} ${at.getFullYear()}, ${two(at.getHours())}:${two(at.getMinutes())}`
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `laci-${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

const SILENT = "Server toko menolak tanpa alasan."

/// What the paper says. `modal`: the supervisor hands over, the cashier
/// receives. `setor`: the cashier hands over, the supervisor receives, the
/// amount left for the receiver to write. `float` (Setor modal): the cashier
/// hands over the float, the supervisor receives, the amount printed.
type Slip = {
  readonly kind: "modal" | "setor" | "float"
  readonly no: string
  readonly at: string
  readonly amount: number | null
  readonly cashier: string
  readonly from: string
  readonly to: string
}

/// Reads the node's reply defensively: the slip may be the body itself or sit
/// under `slip`; any field may be missing on a node older than the contract.
function slipFrom(
  body: unknown,
  kind: Slip["kind"],
  fallback: { cashier: string; supervisor: string; amount: number | null },
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
      kind === "modal"
        ? (amount ?? fallback.amount)
        : kind === "float" && amount !== null
          ? Math.abs(amount)
          : null,
    cashier: fallback.cashier,
    from: given ?? (kind === "modal" ? fallback.supervisor : fallback.cashier),
    to: received ?? (kind === "modal" ? fallback.cashier : fallback.supervisor),
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

/// "Tambah modal kasir": the amount, then the Kepala toko's finger.
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
  const approval = useApproval()
  const cashier = useCashier()
  const [digits, setDigits] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const [float, setFloat] = useState<number | null>(null)
  const [slip, setSlip] = useState<Slip | null>(null)
  const box = useRef<HTMLInputElement>(null)
  const sentBody = useRef<unknown>(null)
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
    if (!approval.open && slip === null) box.current?.focus()
  }, [approval.open, slip])

  useShortcuts(
    { Escape: onClose },
    !approval.open && slip === null,
  )

  function go() {
    if (value <= 0) {
      box.current?.focus()
      return
    }
    if (approval.open) return
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
    ;(document.activeElement as HTMLElement | null)?.blur()
    // One key for this attempt: a finger tried again is the same movement.
    const key = newKey()
    let reply: unknown = null
    // Next tick: the sheet reads Enter as a press on the sensor, and the
    // Enter that pressed Tambah must not be that press.
    window.setTimeout(
      () =>
        approval.ask({
          action: "EDIT_CART",
          title: "Tambah modal kasir",
          detail: `${rp(value)} · diserahkan …`,
          perform: async (supervisor) => {
            const sent = await api.cashMovement(shiftId, {
              kind: "PICKUP",
              amount_minor: value,
              reason: "Tambah modal kasir",
              actor_id: actorId,
              idempotency_key: key,
              supervisor,
            })
            if (!sent.ok) {
              return sent.status === 401 || sent.status === 403
                ? "Bukan kepala toko"
                : sent.status === 404 || sent.status === 405
                  ? "Server toko ini belum bisa menambah modal kasir."
                  : (sent.problem ?? SILENT)
            }
            reply = sent.body
            sentBody.current = sent.body
            return null
          },
          onApproved: (by) =>
            setSlip(slipFrom(reply, "modal", { cashier, supervisor: by.name, amount: value })),
        }),
      0,
    )
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
    <Frame label="Tambah modal kasir" approvalOpen={approval.open} sheet={approval.sheet} onClose={onClose}>
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
                  go()
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
        <button type="button" className="ds-btn ds-btn--primary" disabled={value <= 0} onClick={go}>
          <span>Tambah</span>
          <span className="kbd">Enter</span>
        </button>
      </div>
    </Frame>
  )
}

/// "Setoran sementara": no amount — the Kepala toko's finger straight away,
/// and the paper is printed with the amount blank for the receiver to fill.
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
  const asked = useRef(false)
  const key = useRef(newKey())

  // Opens on the finger sheet at once; Batal there closes this too.
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    const shiftId = seatNow()?.shift_id
    if (shiftId === undefined) {
      setProblem("Kasir belum dibuka.")
      return
    }
    if (actorId.trim() === "") {
      setProblem("Masuk dulu.")
      return
    }
    ask(shiftId)
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function ask(shiftId: string) {
    let reply: unknown = null
    approval.ask({
      action: "EDIT_CART",
      title: "Setoran sementara",
      detail: `${cashier} · ${seatNow()?.label ?? ""}`.replace(/ · $/, ""),
      perform: async (supervisor) => {
        const base = {
          kind: "DROP",
          reason: "Setoran sementara",
          actor_id: actorId,
          supervisor,
        }
        // The amount is left blank on the paper: sent as 0; a node that
        // refuses 0 and takes the amount as optional gets it without.
        let sent = await api.cashMovement(shiftId, { ...base, amount_minor: 0, idempotency_key: key.current })
        if (!sent.ok && (sent.status === 400 || sent.status === 422)) {
          const retry = await api.cashMovement(shiftId, { ...base, idempotency_key: newKey() })
          if (retry.ok) sent = retry
        }
        if (!sent.ok) {
          return sent.status === 401 || sent.status === 403
            ? "Bukan kepala toko"
            : sent.status === 404 || sent.status === 405
              ? "Server toko ini belum bisa menerima setoran sementara."
              : (sent.problem ?? SILENT)
        }
        reply = sent.body
        return null
      },
      onApproved: (by) =>
        setSlip(slipFrom(reply, "setor", { cashier, supervisor: by.name, amount: null })),
    })
  }

  // The sheet was dismissed with nothing done: nothing left to show.
  const was = useRef(false)
  useEffect(() => {
    if (approval.open) was.current = true
    else if (was.current && slip === null && problem === null) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval.open])

  if (slip !== null) return <SlipDialog slip={slip} onDone={() => onDone("Setoran sementara dicatat")} />

  return (
    <>
      {problem !== null && (
        <Frame label="Setoran sementara" approvalOpen={false} sheet={approval.sheet} onClose={onClose}>
          <div className="dlg-head">
            <p className="ttl">Setoran sementara</p>
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

/// "Setor modal" (Tutup kasir, F2; prototype `floatDeposit`): no amount is
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

/// The slip: shown beside "Cetak lagi" and "Selesai", printed once on opening.
function SlipDialog({ slip, onDone }: { slip: Slip; onDone: () => void }) {
  const { config } = useNodeConfig()
  const modal = slip.kind === "modal"
  const float = slip.kind === "float"
  const site = config?.joined != null ? siteTitle(config.joined).replace(" · ", " ") : ""
  const till = seatNow()?.label ?? ""
  const place = [site, till].filter((part) => part !== "").join(" · ")
  const title = modal ? "TAMBAH MODAL KASIR" : float ? "SETOR MODAL" : "SETORAN SEMENTARA"
  const amount =
    (modal || float) && slip.amount !== null ? `Jumlah: ${rp(slip.amount)}` : "Jumlah: ____________"
  // Every slip names the hand-over the same way (prototype `slipPaperView`).
  const left = "Diserahkan oleh"
  const right = "Diterima oleh"

  const print = () => window.setTimeout(() => window.print(), 50)
  useEffect(() => {
    print()
  }, [])
  useShortcuts({ Enter: onDone, Escape: onDone })

  const body = (
    <>
      <h4>{title}</h4>
      No. {slip.no}
      <br />
      {place}
      <br />
      {dayTime(slip.at)}
      <br />
      Kasir: {slip.cashier}
      <br />
      {amount}
      <div className="sg">
        <div>
          {left}
          <br />
          <br />
          <span>{slip.from}</span>
        </div>
        <div>
          {right}
          <br />
          <br />
          <span>{slip.to}</span>
        </div>
      </div>
    </>
  )

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
            <div className="slip">{body}</div>
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
      {createPortal(
        <div className="slip-print" aria-hidden="true">
          {body}
        </div>,
        document.body,
      )}
    </>
  )
}
