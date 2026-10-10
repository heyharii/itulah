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

import { edge, signedEdge, type EdgeReply } from "@/edge"
import type { MyShifts, TakeOverOutcome, TillSeat } from "@itulah/contract"

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
  /// `DEVELOPMENT` when the node checks nobody (`INVENTORY_AUTH_MODE=disabled`)
  /// and answers every caller as its development identity — see `me` in
  /// `backend/src/edge/http.rs`.
  readonly source?: string
}

export const me = () => edge<Me>("GET", "/api/v1/auth/me")

export const logout = () => edge<unknown>("POST", "/api/v1/auth/logout")

// ── a finger, instead of a keyboard ─────────────────────────────────────

/// One enrolled finger, as the node hands it down.
///
/// The template is the vendor's opaque blob. It is not an image and cannot be
/// turned back into one, which is the only reason it is acceptable for it to
/// leave the node at all — and it only leaves to a terminal that has proved its
/// pairing secret.
export type RosterEntry = {
  readonly finger_id: string
  readonly username: string
  readonly label: string
  readonly template_base64: string
  /// Whether this person may authorise a void or a return, so the till can tell
  /// a cashier's finger from a supervisor's before it asks for one.
  readonly is_supervisor: boolean
}

/// `GET /api/v1/auth/fingerprints/roster` — signed by the terminal.
export const roster = () =>
  signedEdge<{ items?: RosterEntry[] }>(
    "GET",
    "/api/v1/auth/fingerprints/roster",
  )

/// `POST /api/v1/auth/fingerprints/claim` — signed by the terminal.
///
/// `SESSION` comes back as the same bearer token a password login issues.
/// `SUPERVISOR` comes back as a one-shot `authorization` to put on a void or a
/// return instead of a password — a supervisor walking over is a step-up, not
/// a login.
export type ClaimReply = {
  readonly username?: string
  readonly purpose?: string
  readonly token?: string
  readonly expires_at_epoch?: number
  readonly authorization?: string | null
  readonly expires_at?: string | null
}

export const claimFinger = (
  fingerId: string | null,
  purpose: "SESSION" | "SUPERVISOR",
  score: number | null,
) =>
  signedEdge<ClaimReply>("POST", "/api/v1/auth/fingerprints/claim", {
    finger_id: fingerId,
    purpose,
    score,
  })

/// Which quick step-up this node accepts besides a password.
///
/// The same three words `edge/pin.rs::set_step_up` takes. Which one a shop runs
/// is the node's decision, asked of the node (`GET /api/v1/auth/methods`) and
/// never guessed here: a pad drawn on a hunch fetches a supervisor to a machine
/// that was never going to take their PIN.
export type StepUp = "NONE" | "PIN" | "FINGERPRINT"

/// `GET /api/v1/auth/methods` — unauthenticated on purpose. The sign-in screen
/// asks it before anybody has signed in, which is exactly why the route opens
/// no session; what it leaks is one word about the shop's configuration, worth
/// less than a till that guesses and draws a pad the node would refuse.
export const authMethods = () =>
  edge<{ till_step_up?: StepUp }>("GET", "/api/v1/auth/methods")

/// `POST /api/v1/auth/pin/claim` — signed by the terminal, checked by the node.
///
/// The same claim a finger makes, with the one difference that matters: the
/// secret travels to the node and the node compares it itself, so there is
/// nothing a terminal can assert past this one. `SESSION` comes back as the
/// same bearer token a password login issues; `SUPERVISOR` as the same one-shot
/// `authorization` a finger earns. The node refuses the whole route unless this
/// shop's `till_step_up` is `PIN` — a method only hidden in the interface while
/// still accepted at the door would be the weakest thing in the building.
///
/// The PIN rides the terminal-signed channel and is never put on a sale or a
/// void: `Supervisor` carries a password or an authorization, and the request
/// body of those is filed at the node against the idempotency key — a PIN in
/// that body would be a PIN sitting in the shop's SQLite for as long as the
/// row lives. It is exchanged for a grant first, and only the grant travels.
export const claimPin = (body: {
  username: string
  pin: string
  purpose: "SESSION" | "SUPERVISOR"
}) => signedEdge<ClaimReply>("POST", "/api/v1/auth/pin/claim", body)

/// `POST /api/v1/auth/terminals` — pair this machine with the node. Done once,
/// by somebody with `AuthAdmin`, because pairing grants a machine the standing
/// to say who is pressing a finger on it.
export type PairedTerminal = {
  readonly terminal_id: string
  readonly secret: string
  readonly label: string
  readonly paired_at: string
}

export const pairTerminal = (label: string) =>
  edge<PairedTerminal>("POST", "/api/v1/auth/terminals", { label })

/// `POST /api/v1/auth/fingerprints` — record a finger against a user.
export const enrolFinger = (body: {
  username: string
  label: string
  template_base64: string
  reader_kind: string
}) => edge<RosterEntry>("POST", "/api/v1/auth/fingerprints", body)

// ── a sweep, read back ──────────────────────────────────────────────────

/// One reader session, as the list hands it down.
///
/// A session is not created by anyone; it begins existing the moment a handheld
/// files observations under its name — so this is a list of what is being swept
/// right now, not a registry (`edge/rfid.rs::recent_sessions`).
export type RfidSessionBrief = {
  readonly reader_session_id: string
  readonly tag_count: number
  readonly device_count: number
  readonly last_seen_at: string | null
}

/// `GET /api/v1/rfid/sessions` — what is being swept right now, newest first.
///
/// The lane is the reader's, not this terminal's: a handheld signs its batch
/// and posts it to the node (`/api/v1/rfid/observations`), and the till only
/// ever reads back what the node already holds. Nothing here polls, either —
/// the cashier pulls a finished sweep when they want it, which is a decision
/// made at the counter and not a second, weaker node inside the till.
export const rfidSessions = () =>
  edge<{ items?: RfidSessionBrief[] }>("GET", "/api/v1/rfid/sessions")

/// One session read whole: distinct EPCs, at most 2000 of them
/// (`edge/rfid.rs::MAX_EPCS`), with `truncated` saying when the list was cut.
export type RfidSessionSummary = {
  readonly reader_session_id: string
  readonly tag_count: number
  readonly sighting_count: number
  readonly epcs?: readonly string[]
  readonly truncated?: boolean
  readonly last_seen_at: string | null
}

/// `GET /api/v1/rfid/sessions/{id}` — the tags one sweep actually saw.
export const rfidSession = (readerSessionId: string) =>
  edge<RfidSessionSummary>(
    "GET",
    `/api/v1/rfid/sessions/${encodeURIComponent(readerSessionId)}`,
  )

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
  edge<{
    items?: CatalogRow[]
    currency?: string
    has_price_book?: boolean
    publication_version?: number | null
  }>(
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
  readonly amount_due_minor?: number
  readonly discount_total_minor?: number
  readonly points_earned?: number
  readonly lines?: readonly unknown[]
  readonly promotions?: readonly PromotionOutcome[]
  readonly granted_lines?: readonly GrantedLine[]
  /// Limited coupons (a cap across every shop) that came without a hold from
  /// head office, so did not apply. The till's cue to hold them — `coupons.ts`.
  readonly coupons_to_authorize?: readonly string[]
}

export type PromotionOutcome = {
  readonly rule_id: string
  readonly name: string
  readonly applied: boolean
  readonly benefit_minor: number
  readonly coupon_code?: string | null
  /// Head office's hold behind a limited coupon that applied.
  readonly coupon_authorization_id?: string | null
  readonly reason?: string | null
}

/// A hold head office granted for a limited coupon, as the node takes it.
export type CouponAuthorization = {
  readonly code: string
  readonly authorization_id: string
}

export type GrantedLine = {
  readonly sku_code: string
  readonly quantity: number
  readonly unit_price_minor: number
  readonly value_minor: number
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
  couponAuthorizations: readonly CouponAuthorization[] = [],
) =>
  edge<QuoteReply>("POST", "/api/v1/store/quote", {
    epcs,
    coupon_codes: couponCodes,
    customer_id: customerId,
    charges,
    coupon_authorizations: couponAuthorizations,
  })

// ── taking the money ────────────────────────────────────────────────────

export type SaleTender = {
  readonly method: string
  readonly amount_minor: number
  readonly reference: string | null
  readonly voucher_authorization_id?: string | null
  /// Which bank's EDC or which QRIS acquirer took it (`BCA`, `MANDIRI`…).
  /// Card and QRIS only; the node refuses it on anything else.
  readonly acquirer?: string | null
  /// `DEBIT` or `CREDIT`, on a card only.
  readonly card_kind?: "DEBIT" | "CREDIT" | null
  /// The Finance master's Mode of Payment code (`DEBIT_BCA`…) the cashier
  /// picked. The node re-derives method/acquirer/card_kind from it; those are
  /// still sent for nodes that predate it. Null when the till fell back to its
  /// built-in list because the master could not be read.
  readonly payment_method_code?: string | null
}

/// One active Mode of Payment from the cloud master, as the node hands it down.
export type PaymentMethod = {
  readonly code: string
  readonly name: string
  readonly tender_type:
    | "CASH"
    | "DEBIT_CARD"
    | "CREDIT_CARD"
    | "QRIS"
    | "EWALLET"
    | "VOUCHER"
    | "BENEFIT"
    | "POINTS"
  readonly bank_code?: string | null
  readonly settlement_mode?: string | null
}

/// `GET /api/v1/store/payment-methods` — the active payment methods Finance
/// keeps in the cloud master. Held by `payment-methods.ts`, not here.
export const paymentMethods = () =>
  edge<PaymentMethod[]>("GET", "/api/v1/store/payment-methods")

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
  /// The holds the quote was priced with. The node refuses a sale naming a
  /// hold it cannot vouch for, rather than quietly charging without it.
  coupon_authorizations?: readonly CouponAuthorization[]
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
///
/// A printer the node has recorded is named by `printer_id` instead of an
/// address, and the node writes its host and port in itself
/// (`with_recorded_printer` in `backend/src/edge/http.rs`) — so the address
/// lives in one place, and a printer that moved on the router is fixed once.
export const printReceipt = (
  saleId: string,
  body: (
    | { printer_host: string; printer_port: number }
    | { printer_id: string }
  ) & {
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

/// Who authorised an action, and the proof that it was really them.
///
/// `Supervisor` in `backend/src/edge/till.rs`. Both halves are optional on the
/// wire and `verify_supervisor` is satisfied by **either** one: a password
/// typed at the counter, or a one-shot `authorization` earned by pressing a
/// finger on this terminal. The authorisation is looked at first and a password
/// is never read once one arrived, so a caller sends one or the other — and the
/// username still rides along, because the node checks that the grant it is
/// spending was earned by the person the caller named.
///
/// The authorisation is worth exactly one action. It expires three minutes
/// after the finger was pressed and is spent inside the transaction it
/// authorises (`SUPERVISOR_GRANT_SECONDS`, `spend_grant`), so it cannot pay for
/// two: a second void needs a second finger, and a screen holding one "for the
/// next one" is holding a key that no longer opens anything.
///
/// Neither half is written back out. `#[serde(skip_serializing)]` on both keeps
/// them out of `idempotency_response.request_json`, which lives in the shop
/// node's SQLite for as long as the row does.
export type Supervisor = {
  readonly username: string
  readonly password?: string | null
  readonly authorization?: string | null
}

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

/// The open session of one named till — the name it opened the shift under.
/// Asked before approving a replacement for it: the node refuses one while
/// the old till's drawer is still open.
export const activeShiftOf = (terminalId: string) =>
  edge<(Shift & { readonly opened_by?: string }) | null>(
    "GET",
    `/api/v1/store/shifts/active?terminal_id=${encodeURIComponent(terminalId)}`,
  )

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
    /// The count sheet, one line per note or coin. When sent, the node refuses
    /// it unless it adds up to `declared_cash_minor`.
    counted?: readonly { value_minor: number; pieces: number }[]
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

/// `GET /api/v1/store/tills` — the seats this store has, `KASIR-1` … `KASIR-N`,
/// and who holds each. A machine is not a till; a person picks a seat from
/// this list when they sign in, so this is what the seat picker draws.
export const tillSeats = () => edge<TillSeat[]>("GET", "/api/v1/store/tills")

/// `GET /api/v1/store/shifts/mine` — `MyShifts { open, uncounted }` for the
/// signed-in person: the drawer they hold now, and the ones somebody took over
/// from them that they still owe a count. Unlike `activeShift`, which is "any
/// open shift on the node", this is right with several seats open at once.
export const myShifts = () => edge<MyShifts>("GET", "/api/v1/store/shifts/mine")

/// `POST /api/v1/store/shifts/take-over` — `TakeOverRequest { terminal_id,
/// opening_float_minor, actor_id, idempotency_key }` → `TakeOverOutcome`.
///
/// One call for sitting at any seat: a free seat just opens (`ended` comes back
/// null), a held one ends its holder's shift first. No approval either way —
/// the person arriving always counts in their own float, and the previous
/// holder counts what they took out later (`countShift`).
export const takeOver = (body: {
  terminal_id: string
  opening_float_minor: number
  actor_id: string
  idempotency_key: string
}) => edge<TakeOverOutcome>("POST", "/api/v1/store/shifts/take-over", body)

/// `POST /api/v1/store/shifts/{id}/count` — the same body as a close
/// (`CloseShiftRequest`), for a shift that is already closed with nothing
/// declared: one that somebody took over. Blind like the close, and only the
/// person who held it (or a supervisor) may count it.
export const countShift = (
  shiftId: string,
  body: {
    declared_cash_minor: number
    counted?: readonly { value_minor: number; pieces: number }[]
    note: string | null
    actor_id: string
    idempotency_key: string
  },
) =>
  edge<Record<string, unknown>>(
    "POST",
    `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/count`,
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

// ── a supervisor's yes to a basket edit ─────────────────────────────────

/// `POST /api/v1/store/approvals` — `TillApprovalRequest` in
/// `src/edge/till.rs`. The supervisor proves themselves the way a void does
/// (a grant from a PIN or finger, or a password); the node spends the grant
/// and writes down what was agreed to beside their name.
export type TillApproval = {
  readonly approval_id: string
  readonly action: string
  readonly approved_by: string
  readonly recorded_at: string
}

export const recordApproval = (body: {
  action: "EDIT_CART" | "CANCEL_BASKET" | "DROP_HOLD"
  terminal_id: string
  detail: string
  reason: string | null
  epcs: readonly string[]
  amount_minor: number | null
  supervisor: Supervisor
  actor_id: string
  idempotency_key: string
}) => edge<TillApproval>("POST", "/api/v1/store/approvals", body)

// ── the machines enrolled to this node ──────────────────────────────────

/// One device as the node reports it — `DeviceReport` in
/// `backend/src/sync/device.rs`. `config` is kind-specific and never secret:
/// a printer's host, port, language and purpose; a till's peripherals.
export type DeviceRow = {
  readonly device_id: string
  /// `TILL`, `PRINTER`, `RFID_READER`, …
  readonly kind: string
  readonly label: string
  /// `ACTIVE`, `SUSPENDED` or `REVOKED`.
  readonly status: string
  readonly last_seen_at?: string | null
  readonly config?: {
    readonly host?: string
    readonly port?: number
    readonly language?: string | null
    readonly purpose?: string
  } | null
}

/// `GET /api/v1/devices` — every till, printer and reader at this node.
export const devices = () =>
  edge<{ items?: DeviceRow[] }>("GET", "/api/v1/devices")

/// One till waiting for a supervisor — `PendingJoin` in
/// `backend/src/edge/devices.rs`. Nothing in it is a secret: the code and the
/// number are on the waiting till's own screen.
export type PendingJoin = {
  readonly join_id: string
  readonly kind: string
  /// Display form, `7K4-P9Q`.
  readonly code: string
  readonly verification: string
  /// What the till said about itself. Shown, trusted for nothing.
  readonly machine?: {
    readonly hostname?: string
    readonly os?: string
    readonly arch?: string
    readonly version?: string
  } | null
  readonly issued_at: string
  readonly expires_at: string
}

/// `GET /api/v1/devices/joins` — the tills waiting at this node, oldest
/// first. Readable by anybody signed in here, because the till that shows the
/// prompt is usually a cashier's.
export const pendingJoins = () =>
  edge<{ items?: PendingJoin[] }>("GET", "/api/v1/devices/joins")

/// `ApprovedTill` in `backend/src/edge/devices.rs`.
export type ApprovedTill = {
  readonly join_id: string
  readonly terminal_id: string
  readonly label: string
  readonly approved_by: string
  /// `GRANT` (a finger or a PIN) or `SESSION`.
  readonly approved_via: string
  readonly replaced_terminal_id: string | null
}

/// `POST /api/v1/devices/joins/{id}/approve` — `ApproveJoinRequest`.
///
/// `authorization` is a supervisor's one-shot grant from a finger or a PIN
/// pressed at this till (`supervisorByFinger`, `supervisorByPin`), spent by
/// the node in the same transaction that lets the till in. Without one, the
/// node accepts the session alone only from an Admin — or a supervisor, for a
/// shop's first till. `replaces_terminal_id` names the till this one takes
/// over from; it is revoked and its label inherited.
export const approveJoin = (
  joinId: string,
  body: {
    label?: string | null
    replaces_terminal_id?: string | null
    authorization?: string | null
  },
) =>
  edge<ApprovedTill>(
    "POST",
    `/api/v1/devices/joins/${encodeURIComponent(joinId)}/approve`,
    body,
  )

/// `POST /api/v1/devices/joins/{id}/refuse`. The waiting till hears
/// `REJECTED` on its next poll and throws its key away.
export const refuseJoin = (joinId: string) =>
  edge<unknown>(
    "POST",
    `/api/v1/devices/joins/${encodeURIComponent(joinId)}/refuse`,
  )

export type { EdgeReply }
