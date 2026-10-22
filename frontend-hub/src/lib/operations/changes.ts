import { idempotencyKey } from "@itulah/contract/client"

import { dcNode, node } from "@/lib/api"

/// MD's edits and cancels, the Gudang's move back, and the short pick: the
/// wire for docs/research/2026-10-09-outbound-cancel-edit-build.md.
///
/// Written by hand until `make contract` has seen the Rust structs
/// (`cloud/postgres/allotment_amend.rs`, `cloud/dc/move_back.rs`,
/// `cloud/dc/owed.rs`, `cloud/dc/short_pick.rs`); the field names are the
/// Rust ones.

// ── Short pick ─────────────────────────────────────────────────────────────

export type ShortReason =
  "NOT_CONFIRMED" | "NOT_FOUND" | "DAMAGED" | "LABEL_OR_EQUIPMENT" | "OTHER"

/// The five reasons the pick sheet offers, in its order. The first three are
/// about the stock and raise a targeted count; the other two stay with Ops.
export const SHORT_REASONS: readonly {
  code: ShortReason
  label: string
  stock: boolean
}[] = [
  {
    code: "NOT_CONFIRMED",
    label: "Stock in the pool could not be confirmed",
    stock: true,
  },
  { code: "NOT_FOUND", label: "Item not found in the pool", stock: true },
  { code: "DAMAGED", label: "Item damaged", stock: true },
  {
    code: "LABEL_OR_EQUIPMENT",
    label: "Label or equipment problem",
    stock: false,
  },
  { code: "OTHER", label: "Other", stock: false },
]

export const shortReasonLabel = (code: ShortReason | string | null) =>
  SHORT_REASONS.find((one) => one.code === code)?.label ?? "Other"

export interface ReportShortPickRequest {
  idempotency_key: string
  allotment_id: string
  destination_id: string
  sku_code: string
  /// How many the picker could not find on this pick.
  pieces: number
  reason: ShortReason
  note?: string | null
  pick_session_id?: string | null
  /// The targeted count a stock-related reason raised.
  count_id?: string | null
}

/// OPEN: still short. FOUND: the count found them (the remainder can be picked).
/// LOST: the count booked them Missing (MD closes the remainder). PICKED: the
/// remainder was picked. CLOSED: MD closed the remainder. CONTINUED: MD
/// answered Continue in her review — the picker tries again (0976).
export type ShortPickStatus =
  "OPEN" | "FOUND" | "LOST" | "PICKED" | "CLOSED" | "CONTINUED"

export interface ShortPick {
  id: string
  allotment_id: string
  allotment_number: string
  destination_id: string
  sku_code: string
  article_name: string
  /// Reported on the pick.
  pieces: number
  /// Still to pick of them now.
  still_short: number
  reason: ShortReason
  note: string | null
  reported_by: string
  reported_at: string
  count_id: string | null
  status: ShortPickStatus
  /// Who answered Continue in MD's review, and when (0976).
  continued_by?: string | null
  continued_at?: string | null
}

/// The flag stays on the card while the remainder is open or lost.
export const flagged = (one: ShortPick) =>
  one.status === "OPEN" || one.status === "LOST"

/// A move back to the picklist (`GET /api/v1/dc/move-backs`): what the board
/// marks "Back from Pack" / "Back from Dispatch" (owner, 18 Oct 2026).
export interface MoveBackToPick {
  move_back_id: string
  destination_id: string
  allotment_id: string | null
  /// `picked`: from Pack. `packed`: a koli, from Dispatch.
  from_stage: "picked" | "packed"
  moved: number
  actor_id: string
  created_at: string
  sku_codes: string[]
}

export async function moveBacksToPick(
  signal?: AbortSignal
): Promise<MoveBackToPick[]> {
  const body = await dcNode().get<{ items: MoveBackToPick[] }>(
    "/api/v1/dc/move-backs",
    { signal }
  )
  return body.items
}

export function reportShortPick(request: ReportShortPickRequest) {
  return dcNode().post<ShortPick>("/api/v1/dc/short-picks", request)
}

export async function shortPicks(signal?: AbortSignal): Promise<ShortPick[]> {
  const body = await dcNode().get<{ items: ShortPick[] }>(
    "/api/v1/dc/short-picks",
    { signal }
  )
  return body.items
}

// ── Work MD left the Gudang to undo ────────────────────────────────────────

export interface OwedKoli {
  koli_id: string
  koli_number: string
  quantity: number
}

export interface OwedLine {
  allotment_line_id: string
  sku_code: string
  article_name: string
  /// Pieces in the pick area MD no longer wants.
  owed_picked: number
  /// Pieces in unsent cartons MD no longer wants.
  owed_packed: number
  /// Where the packed ones are.
  koli: OwedKoli[]
}

/// One allotment × shop with pieces still to move back.
export interface OwedWork {
  allotment_id: string
  allotment_number: string
  destination_id: string
  /// CANCELLED when MD cancelled the allotment (the big stamp), EDITED when
  /// MD reduced it (the red strip).
  kind: "CANCELLED" | "EDITED"
  reason: string | null
  by: string
  at: string
  /// What this shop was allotted before MD's change and now, in pieces.
  was: number
  now: number
  owed_picked: number
  owed_packed: number
  lines: OwedLine[]
}

export async function owedWork(signal?: AbortSignal): Promise<OwedWork[]> {
  const body = await dcNode().get<{ items: OwedWork[] }>("/api/v1/dc/owed", {
    signal,
  })
  return body.items
}

// ── Move back ──────────────────────────────────────────────────────────────

export interface MoveBackRequest {
  idempotency_key: string
  destination_id: string
  allotment_id?: string | null
  /// Where the pieces are now.
  from: "picked" | "packed"
  /// Where they go: the pick area ("picked") or the racks ("pick").
  to: "picked" | "pick"
  /// The carton they leave; required when `from` is "packed".
  koli_id?: string | null
  lines: { sku_code: string; quantity: number }[]
  reason?: string | null
}

export interface MoveBackResult {
  moved: number
  /// How many of them MD had already taken out (not asked for again).
  settled: number
  /// How many go back on the picklist to be picked again.
  to_pick_again: number
  kolis: {
    koli_id: string
    koli_number: string
    units_left: number
    label_reprint: boolean
    emptied: boolean
  }[]
}

export function moveBack(request: MoveBackRequest) {
  return dcNode().post<MoveBackResult>("/api/v1/dc/move-back", request)
}

// ── MD: edit in place, cancel, and what a cancel costs ─────────────────────

/// A line the allotment did not have: a store, or a SKU, MD adds in place
/// (Edit opens the New allotment grid, 9 Oct 2026). Only on an allotment to
/// stores; the SKU and store cannot already be one of its lines — change that
/// line instead.
export interface AmendNewLine {
  sku_id: string
  destination_id: string
  /// Pieces, more than none; checked against the pool's free stock.
  quantity: number
  /// The pool it is taken from. Absent: the pool the allotment's other lines
  /// of this SKU take from.
  source_pool_id?: string | null
}

export interface AmendAllotmentRequest {
  idempotency_key: string
  reason?: string | null
  /// `to` is what MD now wants the line to be, net, in pieces. Never below
  /// what is already sent.
  lines: { allotment_line_id: string; to: number }[]
  add?: AmendNewLine[]
  /// MD's Edit (18 Oct 2026): only moves pieces between stores — each SKU's
  /// total stays what it was. The server refuses anything else.
  move_only?: boolean
}

/// One line as the change left it.
export interface AmendedAllotmentLine {
  allotment_line_id: string
  sku_code: string
  was: number
  now: number
  /// Taken from demand not packed yet: gone at once.
  released: number
  /// Taken from pieces already in cartons: the Gudang moves them back.
  owed: number
  /// The lowest `to` this line accepts: pieces already sent.
  floor: number
}

export interface AmendAllotmentResult {
  id: string
  allotment_number: string
  lines: AmendedAllotmentLine[]
  released_total: number
  owed_total: number
  /// The lines the change added, each `was` 0.
  added: AmendedAllotmentLine[]
}

export function amendAllotment(id: string, request: AmendAllotmentRequest) {
  return node.post<AmendAllotmentResult>(
    `/api/v1/inventory/allotments/${id}/amend`,
    request
  )
}

/// Where an allotment's pieces stand, by stage: what a cancel would cost.
export interface AllotmentWork {
  to_pick: { stores: number; pieces: number }
  picked: { stores: number; pieces: number }
  packed: { stores: number; pieces: number; koli: number }
  sent: { stores: number; pieces: number }
}

export function allotmentWork(id: string, signal?: AbortSignal) {
  return node.get<AllotmentWork>(`/api/v1/inventory/allotments/${id}/work`, {
    signal,
  })
}

// ── What MD changed that the Gudang has not seen yet ───────────────────────

/// One line MD touched. ADD: pieces (or a whole line) added; REDUCE: fewer
/// wanted; CANCEL: the line is gone. `was` and `now` are pieces for this store.
export interface DcChangeLine {
  allotment_line_id: string
  sku_code: string
  kind: "ADD" | "REDUCE" | "CANCEL"
  was: number
  now: number
}

/// An allotment × store whose latest MD changes the warehouse has not
/// acknowledged (owner, 10 Oct 2026: the Gudang acknowledges every MD change
/// with one button; awareness only, nothing moves). Gone from the list once
/// acknowledged. `GET /api/v1/dc/changes`.
export interface DcChange {
  allotment_id: string
  allotment_number: string
  destination_id: string
  /// MD cancelled the whole allotment.
  cancelled: boolean
  /// Pieces for this store before and after, net.
  was_total: number
  now_total: number
  lines: DcChangeLine[]
  /// The MD who made the latest change, and when (ISO).
  by: string
  at: string
}

export async function dcChanges(signal?: AbortSignal): Promise<DcChange[]> {
  const body = await dcNode().get<{ items: DcChange[] }>("/api/v1/dc/changes", {
    signal,
  })
  return body.items
}

export interface AcknowledgeChangeRequest {
  allotment_id: string
  destination_id: string
  idempotency_key: string
}

export function acknowledgeChange(request: AcknowledgeChangeRequest) {
  return dcNode().post<{ acknowledged: number }>(
    "/api/v1/dc/changes/acknowledge",
    request
  )
}

/// Acknowledge several allotment × store changes at once (a Picked card gathers
/// every allotment of its shop). One fresh key per change per press.
export function acknowledgeChanges(items: readonly DcChange[]) {
  return Promise.all(
    items.map((one) =>
      acknowledgeChange({
        allotment_id: one.allotment_id,
        destination_id: one.destination_id,
        idempotency_key: idempotencyKey(),
      })
    )
  )
}
