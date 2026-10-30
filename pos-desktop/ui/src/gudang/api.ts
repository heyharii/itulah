/// What Central Gudang asks of the shop's node.
///
/// Written with the till's own `edge()` and in the same spirit as `@/api`: one
/// file, each wrapper says which handler it calls. The warehouse PC is a device
/// of the shop's node (`WAREHOUSE`, `backend/src/edge/devices.rs`), so it reads
/// and writes the same stock the store app does — `POST /store/movements/by-sku`
/// in the store app is a move by SKU; here a move is one numbered thing
/// (PB-0042) with its lines, who did it and a surat jalan to print.
///
/// # What is the store app's and what is Central Gudang's
///
/// The store app's own: the stock read, the inbound reads, the price book and
/// the names, and the list of returns waiting to be sent. Central Gudang's own,
/// `backend/src/edge/warehouse.rs`: the moves, the receipt, the return a send
/// leaves on, the send and the surat jalan — marked "Gudang" below. Head office
/// is never called from here: the node raises the return itself.
///
/// # What a refusal says
///
/// The node answers a refusal as `{"error":"<kind>: <sentence>"}` and `edge()`
/// hands it over as `problem`. The kind is for programs; the person reads the
/// sentence (`said`). A 403 for a person who may not make moves is shown as the
/// node says it, never worked around.

import type { StoreInboundDetail, StoreInboundScan } from "@itulah/contract"

import type { Supervisor } from "@/api"
import { edge, type EdgeReply } from "@/edge"
import { receiptTarget } from "@/peripherals"
import { shellCall, type NodeConfig } from "@/session"

/// The Kepala toko's proof, as `approval.tsx` hands it over (`@/api`).
export type { Supervisor }

// ── the places ──────────────────────────────────────────────────────────

/// The shop's three rooms, by the codes the node spells them with — the store
/// app's `PlaceCode` (`frontend-store-new/src/screens/stock/shared.ts`).
export type Room = "warehouse" | "floor" | "reject"

/// Every end a move can have: the three rooms, the DC a delivery comes from and
/// head office, where a send goes.
export type Place = Room | "dc" | "ho"

/// Why a piece goes to Reject: one tap, never typed (`REASONS` in
/// `backend/src/edge/warehouse.rs`).
export const REASONS = ["Rusak", "Cacat", "Kotor", "Salah kirim"] as const
export type Reason = (typeof REASONS)[number]

/// Whether a refusal is about the supervisor's proof — a finger that is not a
/// Kepala toko's, a grant already spent, one person approving their own act, an
/// approval that ran out its fifteen minutes ("403 Reject dan kirim HO perlu
/// jari Kepala toko.") — so the finger is asked for again, rather than the save
/// being given up. A 403 that says the person may not, or that her account is
/// the shop's only, is not: it is said as it is.
export function askAgain(status: number, problem: string | null | undefined): boolean {
  return status === 401 || (status === 403 && /jari Kepala toko|menyetujui permintaannya sendiri|persetujuan/i.test(problem ?? ""))
}

/// What a refusal says to the person: the node's sentence without its kind
/// ("conflict: Stok gudang … tinggal 3" → "Stok gudang … tinggal 3").
export function said(problem: string | null | undefined, fallback: string): string {
  if (problem === null || problem === undefined || problem.trim() === "") return fallback
  return problem.replace(/^[a-z][a-z _-]*: /, "").trim()
}

/// One key per act, so a retry after an answer that never arrived finishes the
/// act instead of doing it twice. The same rule as `approval.tsx` and the outbox.
export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// ── stock ───────────────────────────────────────────────────────────────

/// One SKU in the three rooms — `SkuStockRow` in `backend/src/edge/contracts.rs`.
/// `floor` and `warehouse` are spendable pieces (on hand less what is promised
/// away); `reject` is what stands in the reject room. A SKU with none has no
/// row.
export type Held = {
  readonly sku_code: string
  readonly floor: number
  readonly warehouse: number
  readonly reject?: number
}

/// `GET /api/v1/inventory/sku-stock` — the store app's own read. The till's
/// `skuStock` (`@/api`) types only the floor; this one also has the reject room.
export const stockByRoom = () =>
  edge<{ readonly items?: readonly Held[] }>("GET", "/api/v1/inventory/sku-stock")

/// The first stock read, started by the door as the welcome plays (as
/// `warmCatalogue`); `useStock` takes it once and polls on its own after.
let warmStockRead: ReturnType<typeof stockByRoom> | null = null

export function warmStock() {
  warmStockRead ??= stockByRoom()
}

export function takeStock(): ReturnType<typeof stockByRoom> {
  const warm = warmStockRead
  warmStockRead = null
  return warm ?? stockByRoom()
}

// ── what a delivery says ────────────────────────────────────────────────

/// `GET /api/v1/store/inbound/scan?code=` — the store app's own. Which delivery
/// (and koli) a scanned surat jalan number, koli label or QR belongs to; 404
/// ("not found: no koli or surat jalan …") when none does.
export const inboundScan = (code: string) =>
  edge<StoreInboundScan>("GET", `/api/v1/store/inbound/scan?code=${encodeURIComponent(code)}`)

/// `GET /api/v1/store/inbound/{delivery_id}` — the store app's own. In transit a
/// line is what was packed (`expected`): Dikirim, and what Terima prefills.
export const inboundDelivery = (deliveryId: string) =>
  edge<StoreInboundDetail>("GET", `/api/v1/store/inbound/${encodeURIComponent(deliveryId)}`)

// ── moves ───────────────────────────────────────────────────────────────

/// One line of a move, or of a count: pieces of a SKU, and for a Reject the
/// reason.
export type MoveLine = {
  readonly sku_code: string
  readonly quantity: number
  readonly reason?: Reason
}

/// One line of a move as the node keeps it — `StockMoveLineView` in
/// `backend/src/edge/warehouse.rs`.
export type MovedLine = {
  readonly line_no: number
  readonly sku_code: string
  readonly name: string | null
  readonly quantity: number
  /// What the surat jalan said was sent, on a receipt.
  readonly sent: number | null
  readonly reason: Reason | null
}

/// One move, as Riwayat lists it (without `lines`) and opens it — `StockMove`
/// in `backend/src/edge/warehouse.rs`.
export type Moved = {
  readonly move_id: string
  /// `PB-0042`.
  readonly number: string
  /// `RECEIVE` (⇧1), `MOVE` (⇧2, ⇧3), `REJECT` (⇧4) or `SEND_HO` (⇧5).
  readonly kind: string
  readonly from: Place
  readonly to: Place
  /// The surat jalan a receipt came on; the shipment a send left as.
  readonly reference: string | null
  readonly pieces: number
  readonly line_count: number
  readonly actor_id: string
  readonly actor_name: string | null
  readonly device: string | null
  readonly occurred_at: string
  /// A send: when its shipment left; null while its goods wait for the return.
  readonly sent_at: string | null
  /// The Kepala toko whose finger approved a Reject or a Kirim HO: her username
  /// and her full name. Both null when nobody had to approve.
  readonly approved_by?: string | null
  readonly approved_by_name?: string | null
  readonly lines?: readonly MovedLine[]
}

/// `POST /api/v1/store/warehouse/moves` — Gudang: ⇧2, ⇧3, ⇧4, and the first step
/// of ⇧5 from Reject, Gudang or Toko (`to: "ho"`; from Reject it only records
/// the send, no stock moves until the send picks it). 201 with the move. Every line in one transaction under one number; a reason
/// is required on every line into Reject. The same key and lines answer the
/// move already made. 403 "Reject dan kirim HO perlu jari Kepala toko." when a
/// Reject or a send came without a supervisor. 409 "Stok gudang {sku} tinggal {n}, tidak cukup untuk
/// {q}."; 400 "Belum ada barang untuk dipindah.", "Jumlah {sku} paling sedikit
/// 1.", "Pilih alasan untuk {sku}: …".
export const makeMove = (request: {
  readonly from: Room
  readonly to: Room | "ho"
  readonly lines: readonly MoveLine[]
  readonly idempotency_key: string
  /// A Reject or a move into Return HO is a Kepala toko's: her finger (or, in
  /// a rig, her password), asked for with `approval.tsx`. Absent when the
  /// person signed in is a Kepala toko or an Admin.
  readonly supervisor?: Supervisor
}) => edge<Moved>("POST", "/api/v1/store/warehouse/moves", request)

/// `POST /api/v1/store/warehouse/receipts` — Gudang: ⇧1. The store's own
/// receive-by-count, then written down as a move from the DC; 201 with
/// `{move, delivery}`. `counts` are the pieces counted per SKU.
export const receive = (request: {
  readonly delivery_id: string
  readonly counts: readonly { readonly sku_code: string; readonly quantity: number }[]
  readonly idempotency_key: string
}) => edge<{ readonly move: Moved; readonly delivery: StoreInboundDetail["delivery"] }>("POST", "/api/v1/store/warehouse/receipts", request)

/// `GET /api/v1/store/warehouse/moves?q=&limit=` — Gudang: Riwayat, the newest
/// first, without `lines`. `q` finds a number, a surat jalan or shipment, a SKU
/// or an article's name.
export const moves = (q: string) =>
  edge<{ readonly items?: readonly Moved[] }>(
    "GET",
    `/api/v1/store/warehouse/moves?limit=100${q.trim() === "" ? "" : `&q=${encodeURIComponent(q.trim())}`}`,
  )

/// `GET /api/v1/store/warehouse/moves/{number}` — Gudang: one move with every
/// line; 404 "not found: pindahan PB-0042".
export const moveOf = (number: string) =>
  edge<Moved>("GET", `/api/v1/store/warehouse/moves/${encodeURIComponent(number)}`)

// ── sending to head office ──────────────────────────────────────────────

/// A return head office has raised for this shop and the node has taken —
/// `StoreReturnAsk` in `frontend-store-new/src/lib/returns.ts`.
type ReturnAsk = { readonly allotment_id: string }

/// `GET /api/v1/store/return-requests` — the store app's own. What head office
/// asked this shop to send back, and so what a send can be made on.
const returnAsks = () => edge<{ readonly items?: readonly ReturnAsk[] }>("GET", "/api/v1/store/return-requests")

/// The return head office raised for a send: its id, and the number it is
/// known by there.
export type Allotment = { readonly id: string; readonly allotment_number: string }

/// `POST /api/v1/store/warehouse/returns` — Gudang: the second step of ⇧5. The
/// node asks head office to raise the return the move's goods leave on — the
/// store app's own raise, made by the node as the Kepala toko who said yes, so
/// a cashier never calls head office herself. 201 with `{move, allotment}`.
/// The supervisor is ignored once the move carries her approval (fifteen
/// minutes). 403 "<name> is an account of this shop only; head office does not
/// know it, …" for a Kepala toko whose account is the shop's alone.
const raiseReturn = (request: {
  readonly move_number: string
  readonly idempotency_key: string
  readonly supervisor?: Supervisor
}) =>
  edge<{ readonly move: Moved; readonly allotment: Allotment }>(
    "POST",
    "/api/v1/store/warehouse/returns",
    request,
  )

/// `POST /api/v1/store/warehouse/sends` — Gudang: the last step of ⇧5, the
/// store's own Send of the return (pick, pack, seal, dispatch), written onto
/// the move; 201 with `{move, shipment_number, quantity}`. A cashier must name
/// the move (400 "move_number is required: …").
const sendReturn = (request: {
  readonly move_number: string
  readonly trip_note?: string
  readonly idempotency_key: string
  readonly supervisor?: Supervisor
}) =>
  edge<{ readonly move: Moved; readonly shipment_number: string; readonly quantity: number | null }>(
    "POST",
    "/api/v1/store/warehouse/sends",
    request,
  )

const sleep = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms))

/// Head office has to hear that the goods are on the move before it will raise
/// the return on them, and says "cannot allot … fact-derived available
/// quantity" (409) until it has. The same key is asked again every two seconds
/// for half a minute.
async function raise(request: Parameters<typeof raiseReturn>[0]) {
  for (let tries = 0; ; tries += 1) {
    const reply = await raiseReturn(request)
    if (reply.ok || reply.status !== 409 || !/cannot allot/i.test(reply.problem ?? "") || tries >= 14) {
      return reply
    }
    await sleep(2_000)
  }
}

/// The three keys of one send. Held by the screen until the send is done, so
/// pressing ⇧7 again after a refusal picks up where it stopped.
export type SendKeys = {
  readonly move: string
  readonly raise: string
  readonly send: string
}

export const newSendKeys = (): SendKeys => ({ move: newKey(), raise: newKey(), send: newKey() })

/// How far a send got: what is done is not done again, and a send asked for
/// again after a refusal — the finger's, the fifteen minutes', the line's —
/// goes on from the step that failed. Filled in as the steps are made.
export type Progress = {
  moved: Moved | null
  allotment: Allotment | null
}

export const newProgress = (): Progress => ({ moved: null, allotment: null })

export type Sent =
  | { readonly ok: true; readonly move: Moved }
  | {
      readonly ok: false
      readonly problem: string
      /// The refusal is about the supervisor's proof: ask for the finger again.
      readonly again: boolean
    }

/// Head office's activation reaches the node over sync, usually within seconds.
/// Asked every two seconds for half a minute — the store app's own wait.
async function arrives(allotmentId: string): Promise<boolean> {
  for (let tries = 0; tries < 15; tries += 1) {
    const reply = await returnAsks()
    if (reply.ok && (reply.body?.items ?? []).some((ask) => ask.allotment_id === allotmentId)) return true
    await sleep(2_000)
  }
  return false
}

/// ⇧5, the whole of it, on one finger:
///
/// 1. **move** — the pieces go on a numbered move to HO, from Reject, Gudang or
///    Toko. This spends the Kepala toko's grant and writes her name on the move;
///    from Reject no stock moves yet, the send picks it. A cashier's goods then
///    wait in Return HO.
/// 2. **return** — the node has head office raise the return the move leaves on.
/// 3. **wait** — until that return has reached the node.
/// 4. **send** — the store's own Send of it.
///
/// The same supervisor goes with every step: once the move carries her approval
/// it is ignored, and when the fifteen minutes ran out it is what approves
/// again. Whichever step is refused for her proof is `again`, and the step is
/// asked once more with the next finger (`progress` keeps the ones done).
export async function sendToHo(
  from: Room,
  lines: readonly { readonly sku_code: string; readonly quantity: number }[],
  keys: SendKeys,
  progress: Progress,
  supervisor: Supervisor | undefined,
): Promise<Sent> {
  const proof = supervisor === undefined ? {} : { supervisor }
  if (progress.moved === null) {
    const first = await makeMove({ from, to: "ho", lines, idempotency_key: keys.move, ...proof })
    if (!first.ok) {
      return {
        ok: false,
        problem: said(first.problem, "Server toko tidak menjawab."),
        again: askAgain(first.status, first.problem),
      }
    }
    progress.moved = first.body
  }
  const number = progress.moved.number
  if (progress.allotment === null) {
    const raised = await raise({ move_number: number, idempotency_key: keys.raise, ...proof })
    if (!raised.ok) {
      return {
        ok: false,
        problem: said(raised.problem, "Kantor pusat tidak menjawab."),
        again: askAgain(raised.status, raised.problem),
      }
    }
    progress.allotment = raised.body.allotment
  }
  if (!(await arrives(progress.allotment.id))) {
    return {
      ok: false,
      problem: `Retur ${progress.allotment.allotment_number} belum sampai ke server toko.`,
      again: false,
    }
  }
  const done = await sendReturn({ move_number: number, idempotency_key: keys.send, ...proof })
  if (!done.ok) {
    return {
      ok: false,
      problem: said(done.problem, "Server toko menolak mengirim."),
      again: askAgain(done.status, done.problem),
    }
  }
  return { ok: true, move: done.body.move }
}

// ── the surat jalan ─────────────────────────────────────────────────────

/// What the shell answers after printing to the USB printer — `PrintedHere` in
/// `@/peripherals`.
type Printed = { readonly bytes: number; readonly printer: string }

/// One move's surat jalan on the printer this PC prints to: the USB printer
/// the shell sends to (the shell command `print_slip_here`, which asks the node
/// for `POST /api/v1/store/warehouse/moves/{number}/slip/escpos` and sends the
/// bytes, as `print_receipt_here` does for a sale), or a printer the node
/// prints to (`POST /api/v1/store/warehouse/moves/{number}/slip` with the
/// recorded printer or host and port, `paper` and `copy`).
export async function printSlip(
  config: NodeConfig | null,
  number: string,
): Promise<{ readonly ok: boolean; readonly text: string } | null> {
  if (config === null) return null
  const { target, here: usb } = receiptTarget(config)
  const done = `Surat jalan ${number} tercetak.`
  if (usb !== null) {
    const printed = await shellCall<Printed>("print_slip_here", { number, paper: config.paper, copy: false })
    return printed.ok ? { ok: true, text: done } : { ok: false, text: printed.problem }
  }
  if (target === null) return null
  const reply: EdgeReply<unknown> = await edge("POST", `/api/v1/store/warehouse/moves/${encodeURIComponent(number)}/slip`, {
    ...target,
    paper: config.paper,
    copy: false,
  })
  return reply.ok ? { ok: true, text: done } : { ok: false, text: said(reply.problem, "Surat jalan tidak tercetak.") }
}
