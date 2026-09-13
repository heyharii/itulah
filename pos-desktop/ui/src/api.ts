/// Every endpoint this terminal knows, and the shape of what comes back.
///
/// One file, so that a screen never spells a path itself and never guesses a
/// field name. Each wrapper below was written against the handler it calls —
/// `backend/src/edge/http.rs` for the routes, `src/edge/till.rs` and
/// `src/edge/contracts.rs` for the request shapes — and the comment on a
/// wrapper says which one, so the next person can check it rather than trust it.
///
/// # What is deliberately not here
///
/// No caching, no retry, no queue. Those are decisions about *when* to call,
/// and they belong to the screen or to the outbox — a wrapper that silently
/// retried a sale would be a wrapper that sold something twice.

import { edge, type EdgeReply } from "@/edge"

// ── identity ────────────────────────────────────────────────────────────

/// `POST /api/v1/auth/login` → `LoginResponse { token, token_type }`.
///
/// The edge also sets cookies, and this app ignores them on purpose: both of
/// our backends name their session cookie the same thing, so a terminal that
/// ever also spoke to the centre would send the wrong one. The bearer token is
/// handed to the shell, which puts it on every later call.
export type LoginReply = {
  readonly token: string
  readonly token_type: string
}

export const login = (username: string, password: string) =>
  edge<LoginReply>("POST", "/api/v1/auth/login", { username, password })

/// `GET /api/v1/auth/me` — who this token belongs to, and what it may do.
export type Me = {
  readonly username: string
  readonly display_name?: string | null
  readonly permissions?: readonly string[]
}

export const me = () => edge<Me>("GET", "/api/v1/auth/me")

export const logout = () => edge<unknown>("POST", "/api/v1/auth/logout")

// ── the price book ──────────────────────────────────────────────────────

export type CatalogRow = {
  readonly sku_code: string
  readonly barcode: string | null
  readonly name: string
  readonly unit_price_minor: number
  readonly base_unit_price_minor: number
  readonly currency: string
}

/// `GET /api/v1/store/catalog` — this shop's sellable range at this shop's
/// prices. Read once and held: it is what lets a basket be drawn and priced
/// while the line to the node is unsteady.
export const catalogue = () =>
  edge<{ items?: CatalogRow[]; currency?: string; has_price_book?: boolean }>(
    "GET",
    "/api/v1/store/catalog",
  )

// ── pricing a basket ────────────────────────────────────────────────────

/// `POST /api/v1/store/quote` — `QuoteRequest { epcs, coupon_codes,
/// customer_id, charges }`.
///
/// Takes tags, not lines: the same input the sale takes, so the figure on
/// screen is quoted by the engine that will settle it. `total_minor` comes back
/// null when this shop has no price book, which is said plainly rather than
/// returned as a basket worth nothing.
export type QuoteReply = {
  readonly has_price_book?: boolean
  readonly total_minor?: number | null
  readonly lines?: readonly unknown[]
  readonly promotions?: readonly unknown[]
}

/// A fee on the bill that is not goods — a carrier bag, delivery, wrapping.
///
/// `Charge` in `backend/crates/pricing-engine/src/lib.rs:116`, whose own doc
/// names `PACKAGING`. It rides the quote as well as the sale on purpose: a
/// preview that priced the garments and not the bag is a preview the sale will
/// not honour.
export type Charge = {
  readonly code: string
  readonly description: string
  readonly amount_minor: number
  readonly tax_category: string
}

export const quote = (
  epcs: readonly string[],
  couponCodes: readonly string[] = [],
  customerId: string | null = null,
  charges: readonly Charge[] = [],
) =>
  edge<QuoteReply>("POST", "/api/v1/store/quote", {
    epcs,
    coupon_codes: couponCodes,
    customer_id: customerId,
    charges,
  })

// ── taking the money ────────────────────────────────────────────────────

export type SaleTender = {
  readonly method: string
  readonly amount_minor: number
  readonly reference: string | null
}

export type SaleReply = {
  readonly sale_id?: string
  readonly total_minor?: number
  readonly paid_minor?: number
  readonly change_minor?: number
  readonly receipt_no?: string | null
}

/// `POST /api/v1/store/sales` — `SaleRequest { epcs, tenders, actor_id,
/// idempotency_key, coupon_codes, charges, customer_id }`.
///
/// The key is the caller's, held across retries. A key that changed per attempt
/// would turn a retry into a second sale, which is the one thing idempotency
/// exists to prevent.
export const sell = (body: {
  epcs: readonly string[]
  tenders: readonly SaleTender[]
  actor_id: string
  idempotency_key: string
  coupon_codes?: readonly string[]
  customer_id?: string | null
  /// Sent with the sale rather than folded into a price. The engine is what
  /// keeps a fee out of the promotions, the thresholds and the points — a
  /// caller that added a bag to a garment's price would get a discount on the
  /// bag and loyalty points for it.
  charges?: readonly Charge[]
}) => edge<SaleReply>("POST", "/api/v1/store/sales", body)

/// `GET /api/v1/store/sales/{id}/receipt` — what the node says the sale was.
/// If this and the screen ever disagree, this is the one that happened.
export const receipt = (saleId: string) =>
  edge<Record<string, unknown>>(
    "GET",
    `/api/v1/store/sales/${encodeURIComponent(saleId)}/receipt`,
  )

/// `POST /api/v1/store/sales/{id}/receipt` — `PrintReceiptRequest {
/// printer_host, printer_port, paper, drawer, copy }`.
///
/// The node renders and prints, not this terminal. It is the party on the
/// printer's LAN, and a receipt rendered here would be a second implementation
/// of the paper — the version a customer takes home disagreeing with the
/// version the shop can reprint.
///
/// `paper` is `NARROW` (58mm, 32 columns) or `WIDE` (80mm, 48).
/// `drawer` is `PRINTER_PULSE` to kick the cash drawer open through the
/// printer, or `NONE`. `copy` stamps every print after the first, so a
/// duplicate can never be mistaken for a second sale.
export const printReceipt = (
  saleId: string,
  body: {
    printer_host: string
    printer_port: number
    paper: string
    drawer: string
    copy: boolean
  },
) =>
  edge<Record<string, unknown>>(
    "POST",
    `/api/v1/store/sales/${encodeURIComponent(saleId)}/receipt`,
    body,
  )

// ── undoing one ─────────────────────────────────────────────────────────

export type Supervisor = { readonly username: string; readonly password: string }

/// `POST /api/v1/store/sales/{id}/void` — `VoidSaleRequest { reason,
/// supervisor, actor_id, idempotency_key }`.
///
/// A void is not a return: it cancels a sale that should not have happened,
/// and the node asks for a supervisor because it moves stock back and money
/// out in one step.
export const voidSale = (
  saleId: string,
  body: {
    reason: string
    supervisor: Supervisor
    actor_id: string
    idempotency_key: string
  },
) =>
  edge<Record<string, unknown>>(
    "POST",
    `/api/v1/store/sales/${encodeURIComponent(saleId)}/void`,
    body,
  )

/// `POST /api/v1/store/returns` — `ReturnRequest { sale_id, lines, refund_method,
/// refund_reference, reason, supervisor, actor_id, idempotency_key }`, where a
/// line is `{ epc, disposition }`.
///
/// Returns name the tags coming back, the same way a sale names the tags going
/// out. `disposition` is where the garment goes, and the node accepts exactly
/// two words: `RESALEABLE` puts it back on the floor, `DAMAGED` routes it to
/// the reject pool (`return_sale` refuses anything else by name). It is never
/// defaulted on screen, because a returned item that silently re-entered floor
/// stock is a shop selling a damaged garment twice.
export type ReturnLine = { readonly epc: string; readonly disposition: string }

export const returnSale = (body: {
  sale_id: string
  lines: readonly ReturnLine[]
  refund_method: string
  refund_reference: string | null
  reason: string
  supervisor: Supervisor
  actor_id: string
  idempotency_key: string
}) => edge<Record<string, unknown>>("POST", "/api/v1/store/returns", body)

// ── the cash session ────────────────────────────────────────────────────

export type Shift = {
  readonly shift_id?: string
  readonly terminal_id?: string
  readonly opened_at?: string
  readonly opening_float_minor?: number
  readonly actor_id?: string
  readonly status?: string
}

/// `GET /api/v1/store/shifts/active` — the open session on this terminal, if
/// there is one. A till with no shift may not take money, and the node is the
/// one that knows, not this app.
export const activeShift = () =>
  edge<Shift | null>("GET", "/api/v1/store/shifts/active")

/// `POST /api/v1/store/shifts` — `OpenShiftRequest { terminal_id,
/// opening_float_minor, actor_id, idempotency_key }`.
export const openShift = (body: {
  terminal_id: string
  opening_float_minor: number
  actor_id: string
  idempotency_key: string
}) => edge<Shift>("POST", "/api/v1/store/shifts", body)

/// `POST /api/v1/store/shifts/{id}/close` — `CloseShiftRequest {
/// declared_cash_minor, note, actor_id, idempotency_key }`.
///
/// Declared, not computed: the figure is what was counted out of the drawer,
/// and the difference against what the node expected is the whole point of
/// closing a shift.
export const closeShift = (
  shiftId: string,
  body: {
    declared_cash_minor: number
    note: string | null
    actor_id: string
    idempotency_key: string
  },
) =>
  edge<Record<string, unknown>>(
    "POST",
    `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/close`,
    body,
  )

/// `GET /api/v1/store/shifts/{id}` — what this session took, by tender.
export const shiftReport = (shiftId: string) =>
  edge<Record<string, unknown>>(
    "GET",
    `/api/v1/store/shifts/${encodeURIComponent(shiftId)}`,
  )

/// `POST /api/v1/store/shifts/{id}/movements` — `CashMovementRequest { kind,
/// amount_minor, reason, actor_id, idempotency_key }`. Money in or out of the
/// drawer that is not a sale.
export const cashMovement = (
  shiftId: string,
  body: {
    kind: string
    amount_minor: number
    reason: string
    actor_id: string
    idempotency_key: string
    /// Required for `PAYOUT` and `CORRECTION` and refused without it — see
    /// `record_cash_movement` in `src/edge/till.rs`. Money leaving a drawer,
    /// and a figure being rewritten after the fact, are the two movements a
    /// shop cannot let one person make alone.
    supervisor?: Supervisor
  },
) =>
  edge<Record<string, unknown>>(
    "POST",
    `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/movements`,
    body,
  )

export type { EdgeReply }
