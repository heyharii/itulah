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

/// The till's own name, sent on every sign-in so the node can refuse a cashier
/// who already closed on this till today ("… sudah tutup kasir hari ini").
/// Set by `session.ts` whenever it knows the terminal.
let signInTerminal: string | null = null
export const setSignInTerminal = (id: string | null) => {
  signInTerminal = id !== null && id.trim() !== "" ? id.trim() : null
}
const withTerminal = () => (signInTerminal === null ? {} : { terminal_id: signInTerminal })

export const login = (username: string, password: string) =>
  edge<LoginReply>("POST", "/api/v1/auth/login", { username, password, ...withTerminal() })

/// `GET /api/v1/auth/me` — who this token belongs to, and what it may do.
export type Me = {
  readonly username: string
  readonly display_name?: string | null
  readonly permissions?: readonly string[]
  /// `DEVELOPMENT` when the node checks nobody (`INVENTORY_AUTH_MODE=disabled`)
  /// and answers every caller as its development identity — see `me` in
  /// `backend/src/edge/http.rs`.
  readonly source?: string
  /// `CASHIER`, `SUPERVISOR` or `ADMIN`: anyone above a cashier is a Kepala
  /// toko at the till door.
  readonly role?: string
}

export const me = () => edge<Me>("GET", "/api/v1/auth/me")

export const logout = () => edge<unknown>("POST", "/api/v1/auth/logout")

// ── the store's own tags ────────────────────────────────────────────────

/// One move of one tag, as `GET /api/v1/inventory/movements` answers it.
export type TagMove = {
  readonly epc: string
  readonly to: string
  readonly occurred_at: string
}

/// The store's latest tag movements (500 at most), newest first or not — the
/// caller orders them. Read by the till to find a tag of a typed SKU on the
/// shop floor.
export const tagMoves = () =>
  edge<{ items?: TagMove[] }>("GET", "/api/v1/inventory/movements?limit=500")

// ── opened by the Kepala toko ───────────────────────────────────────────

/// One person a Kepala toko may open this till for — `till_people` in
/// `backend/src/edge/http.rs`.
export type TillPerson = {
  readonly username: string
  readonly display_name: string
  /// `CASHIER` or `SUPERVISOR`.
  readonly role: string
}

/// `GET /api/v1/auth/on-behalf` — asked with the head's own session.
export const tillPeople = () =>
  edge<{ items?: TillPerson[] }>("GET", "/api/v1/auth/on-behalf")

/// `POST /api/v1/auth/on-behalf` → the cashier's session; the head's ends.
export type OnBehalfReply = {
  readonly token: string
  readonly username: string
  readonly display_name: string
  readonly opened_by: string
}

export const openOnBehalf = (username: string) =>
  edge<OnBehalfReply>("POST", "/api/v1/auth/on-behalf", { username, ...withTerminal() })

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
    ...withTerminal(),
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
}) => signedEdge<ClaimReply>("POST", "/api/v1/auth/pin/claim", { ...body, ...withTerminal() })

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

/// The ten fingers, in head office's words (`FINGER_CODES` in
/// `backend/src/edge/fingerprint.rs`).
export type FingerCode =
  | "LEFT_THUMB"
  | "LEFT_INDEX"
  | "LEFT_MIDDLE"
  | "LEFT_RING"
  | "LEFT_LITTLE"
  | "RIGHT_THUMB"
  | "RIGHT_INDEX"
  | "RIGHT_MIDDLE"
  | "RIGHT_RING"
  | "RIGHT_LITTLE"

/// A finger the store head recorded, as the node hands it back
/// (`FingerSubmission` there). Her own is `PENDING` until head office decides;
/// somebody else's she approved by recording it, `APPROVED`, and it opens the
/// POS at once. `REFUSED` carries head office's reason.
export type FingerSubmission = {
  readonly submission_id: string
  readonly username: string
  readonly finger: FingerCode
  /// "Telunjuk kanan".
  readonly label: string
  readonly status: "PENDING" | "APPROVED" | "REFUSED"
  readonly reason: string | null
  readonly recorded_by: string
  readonly recorded_at: string
}

/// `POST /api/v1/auth/fingerprints/submissions` — the Kepala toko records a
/// finger and head office approves it; nothing opens the POS until then.
/// Answers 409 "Jari ini sudah terdaftar atas nama X." when the exact template
/// is somebody else's. The old `POST /api/v1/auth/fingerprints` (enrol at
/// once) is an Admin's alone now, and this app no longer calls it.
export const submitFinger = (body: {
  username: string
  finger: FingerCode
  template_base64: string
  reader_kind: string
  quality?: number
}) =>
  edge<FingerSubmission>("POST", "/api/v1/auth/fingerprints/submissions", body)

/// One person on the store's team with the fingers that open the POS and the
/// ones waiting for head office (`TeamMember` in `fingerprint.rs`).
export type TeamMember = {
  readonly username: string
  readonly display_name: string
  /// `CASHIER`, `SUPERVISOR` or `ADMIN`.
  readonly role: string
  readonly fingers: readonly {
    readonly finger_id: string
    /// Null for a finger enrolled at the store before head office took over,
    /// which names its finger only in words (`label`).
    readonly finger: FingerCode | null
    readonly label: string
  }[]
  readonly submissions: readonly FingerSubmission[]
}

/// `GET /api/v1/auth/fingerprints/team` — everybody who signs in here, store
/// heads first. Asked with the Kepala toko's own session.
export const fingerTeam = () =>
  edge<{ items?: TeamMember[] }>("GET", "/api/v1/auth/fingerprints/team")

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
  readonly article_code?: string | null
  /// Which part of the range it is filed under — the grid's Divisi.
  readonly division_code?: string | null
  readonly barcode: string | null
  /// The node holds a photograph for it (`/api/v1/catalog/image?sku=`).
  readonly has_image?: boolean
  readonly name: string
  readonly unit_price_minor: number
  readonly base_unit_price_minor: number
  readonly currency: string
}

export type CataloguePage = {
  readonly items?: CatalogRow[]
  readonly currency?: string
  readonly has_price_book?: boolean
  readonly publication_version?: number | null
  /// The last SKU of this page, to ask for the next one with; null on the last.
  readonly next_cursor?: string | null
}

/// The node's own ceiling for one page (`store_catalog_page` in
/// `backend/src/edge/pricing.rs` clamps `limit` to 1–500, default 100).
const CATALOGUE_PAGE = 500

/// `GET /api/v1/store/catalog?limit=&cursor=` — one page of this shop's
/// sellable range at this shop's prices, keyset-paged by SKU code.
///
/// The cursor is always sent, empty for the first page. The node treats an
/// empty cursor as the start, and a page asked for with a cursor is never
/// answered from its whole-book ETag — which is the catalogue's generation,
/// not the price book's, so a browser holding the first page could keep
/// yesterday's prices on it.
export const cataloguePage = (cursor: string) =>
  edge<CataloguePage>(
    "GET",
    `/api/v1/store/catalog?limit=${CATALOGUE_PAGE}&cursor=${encodeURIComponent(cursor)}`,
  )

/// `GET /api/v1/catalog/snapshot` — which generation of the catalogue the node
/// holds: one small row, the cheap way to ask whether the products changed.
/// It says nothing about prices; those are checked against the quote.
export type CatalogueState = {
  readonly generation: number
  readonly item_count: number
  readonly content_hash: string
  readonly activated_at: string | null
}

export const catalogueState = () =>
  edge<CatalogueState>("GET", "/api/v1/catalog/snapshot")

/// One SKU as head office names it — `CatalogIdentity` in
/// `backend/src/edge/contracts.rs`. The grid reads `tags` from it (Merchandising's
/// words under the article's name: "Koko, Lebaran"); prices never come from here.
export type CatalogIdentity = {
  readonly sku_code: string
  readonly name: string
  readonly article_code: string | null
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly active: boolean
}

/// `GET /api/v1/catalog/identities?skus=a,b,c` — `{ items }`, one row for each
/// SKU the node knows (`catalog_identities` in `backend/src/edge/http.rs`: the
/// SKUs go in ONE comma-separated `skus` parameter, a repeated parameter is
/// refused). A SKU it does not know has no row.
export const catalogIdentities = (skus: readonly string[]) =>
  edge<{ readonly items?: CatalogIdentity[] }>(
    "GET",
    `/api/v1/catalog/identities?skus=${skus.map(encodeURIComponent).join(",")}`,
  )

/// The whole price book, page after page. Read at the till's start and again
/// only when it changed: one page is at most 500 rows, and the counter needs
/// every row, not the first page of them. All or nothing — a book that broke
/// off halfway is reported, never shown as if it were the whole range.
export async function wholeCatalogue(): Promise<
  | { readonly ok: true; readonly rows: CatalogRow[]; readonly hasPriceBook: boolean }
  | { readonly ok: false; readonly problem: string }
> {
  const rows: CatalogRow[] = []
  let hasPriceBook = false
  let cursor = ""
  // Far beyond any range this estate sells; a node that kept answering with
  // a next page past it would be a node walking in a circle.
  for (let page = 0; page < 2_000; page += 1) {
    const reply = await cataloguePage(cursor)
    if (!reply.ok) {
      return {
        ok: false,
        problem: reply.problem ?? `The price book could not be read (HTTP ${reply.status}).`,
      }
    }
    rows.push(...(reply.body?.items ?? []))
    hasPriceBook ||= reply.body?.has_price_book === true
    const next = reply.body?.next_cursor ?? null
    if (next === null || next === "") return { ok: true, rows, hasPriceBook }
    if (next === cursor) {
      return { ok: false, problem: "The node's price book pages did not move forward." }
    }
    cursor = next
  }
  return { ok: false, problem: "The price book has more pages than this till will read." }
}

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
  readonly lines?: readonly QuotedLine[]
  readonly promotions?: readonly PromotionOutcome[]
  readonly granted_lines?: readonly GrantedLine[]
  /// Limited coupons (a cap across every shop) that came without a hold from
  /// head office, so did not apply. The till's cue to hold them — `coupons.ts`.
  readonly coupons_to_authorize?: readonly string[]
  /// Tags in the basket the node will not sell: not on this shop's floor
  /// (`quote_basket` in `backend/src/edge/sqlite.rs`). A sale naming one is
  /// refused, so the till takes them off before the money is taken.
  readonly unsellable?: readonly Unsellable[]
  /// One per line the node could not take from this shop's own stock, so the
  /// till can say which (`UntaggedQuoteLine`, docs/unmatched-sales-contract.md).
  readonly untagged?: readonly UntaggedQuoteLine[]
}

/// A piece the till sells without a tag the node holds here — `UntaggedLine`
/// in the contract (docs/unmatched-sales-contract.md). One entry per piece:
/// a SKU typed off the label (`sku_code`), or a Barang tak dikenal, which has
/// no SKU, so it carries the name and price the Kepala toko approved
/// (`name`, `unit_price_minor`, and the `approval_id` the node gave when their
/// finger said yes — `approveUnmatched`). The sale goes through either way;
/// head office matches it to a real piece later.
export type UntaggedLine = {
  readonly sku_code?: string | null
  /// A read tag the till already knows this shop does not hold. The node
  /// also classifies the `epcs` itself, so this is optional.
  readonly epc?: string | null
  readonly name?: string | null
  readonly unit_price_minor?: number | null
  readonly approval_id?: string | null
}

/// `POST /api/v1/store/unmatched/approve` — `{ name, unit_price_minor,
/// supervisor }`: the Kepala toko's yes to naming and pricing a piece nobody
/// can identify (Barang tak dikenal). The node checks the proof once, here,
/// and answers an `approval_id` that the line carries on the quote and the
/// sale from then on — it is not a secret. A node that predates unmatched
/// sales has no such route and answers 404.
export type UnmatchedApproval = {
  readonly approval_id: string
  readonly approved_by: string
  readonly approved_by_name?: string | null
}

export const approveUnmatched = (body: {
  name: string
  unit_price_minor: number
  supervisor: Supervisor
}) => edge<UnmatchedApproval>("POST", "/api/v1/store/unmatched/approve", body)

/// Whether this shop's node knows about unmatched sales at all: the read-only
/// list answers (any status but 404 / 405) on a node that does, and is not
/// there on one that predates them.
export const unmatchedProbe = () =>
  edge<unknown>("GET", "/api/v1/store/unmatched?status=open")

/// Why a line is untagged: this shop holds some of the SKU (`NO_TAG`), none of
/// it (`NOT_IN_STOCK`), a tag it does not hold was read (`OTHER`), or nothing
/// at all is known about it (`UNKNOWN`).
export type UntaggedKind = "NO_TAG" | "NOT_IN_STOCK" | "OTHER" | "UNKNOWN"

/// One answer per untagged line (`UntaggedQuoteLine`): `index` is the line's
/// position in the request's `untagged`, or null for a tag in `epcs` the node
/// turned into one (then `epc` names it).
export type UntaggedQuoteLine = {
  readonly index: number | null
  readonly epc?: string | null
  readonly kind: UntaggedKind
  readonly sku_code?: string | null
  readonly name?: string | null
  /// The site the piece is known to be at, when it is.
  readonly from_place?: string | null
  readonly line_total_minor?: number | null
}

/// One line as the engine priced it (`QuotedLine` in
/// `backend/src/edge/pricing.rs`); only what the till reads.
export type QuotedLine = {
  readonly sku_code: string
  /// What one costs after markdown, before any promotion — the shelf price,
  /// this minute.
  readonly unit_price_minor: number
  /// The price list's figure, before any markdown.
  readonly base_unit_price_minor?: number
  /// What this line comes to after its promotions.
  readonly line_total_minor?: number
}

/// A tag the node will not sell from this shop's floor, and why.
export type Unsellable = {
  readonly epc: string
  readonly sku_code: string
  readonly reason: string
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
  /// What it took off each line, by the line's position in the basket — which
  /// is the order the tags were sent in. Empty for one that grants goods.
  readonly line_benefits?: readonly { readonly line: number; readonly benefit_minor: number }[]
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
  untagged: readonly UntaggedLine[] = [],
) =>
  edge<QuoteReply>("POST", "/api/v1/store/quote", {
    epcs,
    coupon_codes: couponCodes,
    customer_id: customerId,
    charges,
    coupon_authorizations: couponAuthorizations,
    // Left out when there is none, so a node that has not learnt the field
    // is never asked about it.
    ...(untagged.length > 0 ? { untagged } : {}),
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
  /// The pieces with no tag, one entry each (`UntaggedLine`). Sent on the
  /// quote too, so the figure on screen is the figure the sale settles.
  untagged?: readonly UntaggedLine[]
  /// When the money changed hands, by this till's clock. A sale that waited
  /// in the outbox — the line down, then head office stopping the till — is
  /// judged by when it was rung, not when it arrived.
  taken_at?: string
}) => edge<SaleReply>("POST", "/api/v1/store/sales", body)

/// A voucher as head office reports it, read-only — what F2 shows.
export type VoucherCheck = {
  readonly code: string
  /// `GIFT_CARD`, `REFUND` or `GOODWILL`.
  readonly kind: string
  readonly balance_minor: number
  /// `ACTIVE`, `VOIDED`, …
  readonly status: string
  readonly expires_at: string | null
  /// Past its expiry, whatever its status says.
  readonly expired: boolean
  readonly member_name: string | null
}

/// `POST /api/v1/store/vouchers/{code}/check` (no body) — what the voucher is
/// and what is left on it. The node relays to head office, which is where a
/// card spendable at any shop is known: no hold is made and nothing is
/// recorded, so a balance asked is not a balance spent. 404 `{error}` when the
/// code is unknown; a down line answers with a sentence.
export const checkVoucher = (code: string) =>
  edge<VoucherCheck>(
    "POST",
    `/api/v1/store/vouchers/${encodeURIComponent(code.trim().toUpperCase())}/check`,
  )

/// A member as head office knows them.
export type Member = {
  /// The phone's digits, or a card number — what a sale carries as
  /// `customer_id`.
  readonly member_id: string
  readonly display_name: string
  readonly joined_on: string
  readonly blocked: boolean
  readonly points_balance: number
}

/// `POST /api/v1/store/members/lookup` — `{ member_id }`. Who is this number,
/// and their points. 404 `{error: "no member X"}` when there is none.
export const lookupMember = (memberId: string) =>
  edge<Member>("POST", "/api/v1/store/members/lookup", { member_id: memberId })

/// Head office's answer to "send this number a code" (owner, 25 Oct 2026: a new
/// member is registered by a code read back from their WhatsApp). With no
/// WhatsApp at head office nothing is sent and `required` is false: the
/// registration goes as it always did. Otherwise `member_id` is the number as
/// head office keys it (`08…`) and `sent_to` is masked (`0812****7890`).
export type MemberCode =
  | { readonly required: false }
  | {
      readonly required: true
      readonly member_id: string
      readonly challenge_id: string
      readonly expires_at: string
      readonly sent_to: string
    }

/// `POST /api/v1/store/members/otp` — `{ member_id }`: send a new member's
/// phone a six-digit code on WhatsApp. 409 "… already has the number 08…",
/// 422 "… is not on WhatsApp", 409 "head office's WhatsApp is not connected…",
/// 409 "… has been sent 5 codes this hour…", 400 "a new member is registered by
/// a mobile number, 08…".
export const sendMemberCode = (memberId: string) =>
  edge<MemberCode>("POST", "/api/v1/store/members/otp", { member_id: memberId })

/// `POST /api/v1/store/members` — `{ member_id, display_name }`, 201 with the
/// member. The id is the phone's digits (10–13); 400 `{error}` for a phone or
/// name the node will not take, 409 `{error}` naming who already has the number.
export const registerMember = (
  memberId: string,
  displayName: string,
  /// The client's registration form (23 Oct 2026, docs/pos-client-feedback-
  /// contract.md): phone, name, gender, birth place and birth date are
  /// required, address and email optional. `birth_date` goes as ISO
  /// `YYYY-MM-DD`. A node that predates the form ignores what it does not know.
  more?: {
    readonly gender: "L" | "P"
    readonly birth_place: string
    readonly birth_date: string
    readonly address?: string | null
    readonly email?: string | null
  },
  /// The code the new member read back from their WhatsApp (`sendMemberCode`);
  /// required while head office has WhatsApp, and the member id must then be
  /// the number the code was sent to. 400 when missing, 401 "that code does not
  /// match, or it has expired" (five guesses, five minutes).
  otp?: { readonly challenge_id: string; readonly code: string },
) =>
  edge<Member>("POST", "/api/v1/store/members", {
    member_id: memberId,
    display_name: displayName,
    ...(more ?? {}),
    ...(otp === undefined ? {} : { otp_challenge_id: otp.challenge_id, otp_code: otp.code }),
  })

/// `POST /api/v1/store/sales/{id}/member` — `{ member_id }`: a member added to
/// a sale that is already paid ("Tambah member F5" on Transaksi selesai).
/// Not in the 23 Oct contract yet: 404 / 405 means this node cannot, and the
/// till says so.
export const addMemberToSale = (saleId: string, memberId: string) =>
  edge<unknown>(
    "POST",
    `/api/v1/store/sales/${encodeURIComponent(saleId)}/member`,
    { member_id: memberId },
  )

/// What tying a member to an earlier sale answers (`POST /api/v1/store/sales/
/// member`): the sale it found, whose it is now, and the points that sale earned
/// them — the same rule as if they had been on it at the time.
export type MemberOnSale = {
  readonly sale_id: string
  readonly receipt_no: string
  readonly member_id: string
  readonly member_name: string
  readonly points_earned: number
}

/// `POST /api/v1/store/sales/member` — `{ receipt_no, member_id }`: F5's "No.
/// transaksi" (a member registered at the counter for a sale already rung, by
/// the number on its struk). The refusals come with their words in Indonesian
/// in `problem`: 404 "Struk … tidak ada"; 409 "… sudah atas nama …", "… sudah
/// di-void", "… sudah ditukar".
export const memberToReceipt = (receiptNo: string, memberId: string) =>
  edge<MemberOnSale>("POST", "/api/v1/store/sales/member", {
    receipt_no: receiptNo,
    member_id: memberId,
  })

// ── held sales (Tunda), kept on the store node ──────────────────────────

/// One held sale as the node lists it (`GET /api/v1/store/held` answers
/// `{ items }`, today's, any cashier). `basket` is whatever the till stored
/// with it — see `Held` in `till.tsx`.
export type HeldSale = {
  readonly id: string
  readonly terminal_id?: string
  readonly held_by?: string
  readonly held_by_name: string
  readonly held_at: string
  readonly business_date?: string
  readonly total_minor: number
  readonly pcs: number
  readonly basket?: unknown
}

/// `GET /api/v1/store/held`. A node without the route answers 404 / 405; the
/// till then keeps held sales on this counter only, as it always did.
export const heldSales = () => edge<{ items: HeldSale[] }>("GET", "/api/v1/store/held")

/// `POST /api/v1/store/held` — `{ basket, total_minor, pcs }` → `{ id,
/// held_by_name, held_at }`.
export const holdSaleOnNode = (body: { basket: unknown; total_minor: number; pcs: number; terminal_id?: string }) =>
  edge<{ id: string; held_by_name: string; held_at: string }>("POST", "/api/v1/store/held", body)

/// `POST /api/v1/store/held/{id}/resume` — removes it and answers the basket.
export const resumeHeldSale = (id: string) =>
  edge<HeldSale>("POST", `/api/v1/store/held/${encodeURIComponent(id)}/resume`)

/// `DELETE /api/v1/store/held/{id}` with `{ supervisor }` — the Kepala toko's
/// finger (or password).
export const dropHeldSale = (id: string, supervisor: Supervisor) =>
  edge<HeldSale>("DELETE", `/api/v1/store/held/${encodeURIComponent(id)}`, { supervisor })

/// The slip a drawer movement prints: `PICKUP` (Tambah modal kasir) and `DROP`
/// (Setoran sementara) both answer one.
export type MovementSlip = {
  readonly slip_no: string
  readonly amount_minor?: number | null
  readonly given_by_name: string
  readonly received_by_name: string
  readonly at: string
}

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
/// A piece sold without a tag comes back by its SKU: `epc` empty and
/// `sku_code` set (owner, 25 Oct 2026).
export type ReturnLine = { readonly epc: string; readonly sku_code?: string; readonly disposition: string }

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

/// One sale on a drawer — `ShiftSale` in `backend/src/edge/till.rs`.
export type ShiftSale = {
  readonly sale_id: string
  /// The number the customer reads back, `C11-JLC-26-10-02765`.
  readonly receipt_no: string
  readonly completed_at: string
  readonly cashier: string
  /// `COMPLETED` or `VOIDED`.
  readonly status: string
  readonly total_minor: number
  readonly change_minor: number
  /// Refunded against this sale since.
  readonly returned_minor: number
  readonly tenders: readonly {
    readonly method: string
    readonly amount_minor: number
    /// `DEBIT` or `CREDIT` on a card; null on every other tender.
    readonly card_kind: string | null
    readonly acquirer: string | null
    readonly reference: string | null
  }[]
}

/// `GET /api/v1/store/shifts/{id}/sales` — the sales rung on one drawer, with
/// how each was paid. A supervisor gets every sale, oldest first; a CASHIER gets
/// only the 3 newest of their own shift, newest first (a full receipt list is
/// the expectation a blind close keeps from them), and any other shift is
/// refused. The till sorts and takes three either way.
export const shiftSales = (shiftId: string) =>
  edge<ShiftSale[]>(
    "GET",
    `/api/v1/store/shifts/${encodeURIComponent(shiftId)}/sales`,
  )

/// `POST /api/v1/store/shifts/{id}/movements` — `CashMovementRequest { kind,
/// amount_minor, reason, actor_id, idempotency_key }`. Money in or out of the
/// drawer that is not a sale.
export const cashMovement = (
  shiftId: string,
  body: {
    kind: string
    /// Optional only for a `DROP` whose amount is left blank on the slip
    /// (Setoran sementara) on a node that takes it so.
    amount_minor?: number
    reason: string
    actor_id: string
    idempotency_key: string
    /// Required for `PAYOUT`, `PICKUP` and `DROP` (the Kepala toko who hands
    /// over or receives), and for `CORRECTION` and refused without it — see
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

export type { EdgeReply }

// ── head office's stops (postgres 0990) ─────────────────────────────────

/// A stop as the node holds it — `StopNote` in `backend/src/edge/pos_stop.rs`.
export type PosStop = {
  readonly at: string
  readonly by: string
  readonly reason: string
  /// A store only: when head office removed it for good.
  readonly removed_at?: string
}

/// A till head office stopped (`SUSPENDED`) or removed (`REVOKED`) —
/// `TillStop` there.
export type TillStop = {
  /// `Kasir 3`.
  readonly label: string
  readonly status: "SUSPENDED" | "REVOKED"
  readonly at: string | null
  readonly reason: string | null
}

/// The drawer still open at this till's seat — `OpenDrawer` there.
export type OpenDrawer = {
  readonly shift_id: string
  readonly opened_by: string
  readonly name: string
}

/// What head office has stopped that this till shows on its door.
export type TillStanding = {
  readonly store: PosStop | null
  readonly till: TillStop | null
  readonly open_shift: OpenDrawer | null
}

/// `GET /api/v1/till/standing` — open on purpose, like `authMethods`: the
/// door asks it before anybody has signed in. `till_standing` in
/// `backend/src/edge/http.rs`.
export const tillStanding = (terminalId: string) =>
  edge<TillStanding>(
    "GET",
    `/api/v1/till/standing?terminal_id=${encodeURIComponent(terminalId)}`,
  )
