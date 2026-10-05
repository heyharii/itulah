import { ApiError } from "@itulah/contract/client"
import type { PurchaseOrderLineReceipt } from "@itulah/contract"
import type {
  AddToBasketRequest,
  BasketLine,
  CatalogPurchaseOrderRequest,
  CatalogueVocabulary,
  CreateSupplierBankAccountRequest,
  CreateSupplierContactRequest,
  CreateSupplierItemRequest,
  CreateSupplierRequest,
  PaymentTermsBook,
  PurchaseDestination,
  SourcingPage,
  Supplier,
  SupplierBankAccount,
  PurchaseOrderRevisionEntry,
  SupplierContact,
  SupplierItem,
  SupplierList,
  SupplierStatus,
  UpdateSupplierBankAccountRequest,
  UpdateSupplierContactRequest,
  UpdateSupplierRequest,
} from "@itulah/contract"

import { node } from "@/lib/api"
import { arity, type Filter } from "@/lib/filters"

/// Purchasing reads and writes, and the keys they are held under.
///
/// Most of this file is typed from `@itulah/contract`, which is generated from
/// the Rust structs the server actually serialises. The exceptions are marked
/// where they appear: a handful of purchasing routes answer with `json!()`
/// literals rather than a struct, so ts-rs has nothing to generate from and
/// those interfaces cannot be checked against the server at build time. They
/// are transcribed from the literal — if a field moves, this file is where it
/// goes stale, and it is the first place to look when a column reads
/// `undefined`.

// ---------------------------------------------------------------------------
// Purchase orders — hand-written, from the `json!()` literals in
// `cloud/postgres/sync.rs`.

/// One order on the buyer's list, with its outstanding position.
export interface PurchaseOrderRow {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly destination_site_id: string
  /// Where the order STANDS, derived by the server from its receipts every
  /// time it is asked for: `ACTIVE`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`,
  /// `CLOSED`. This is what the screen draws and what the status facet counts.
  readonly lifecycle: string
  /// The stored column, which only ever reads `ISSUED` or `CLOSED` and cannot
  /// tell an order that has arrived in full from one nobody has delivered
  /// against. Kept because the server still sends it; nothing should draw it.
  readonly order_status: string
  readonly currency: string
  readonly issued_at: string | null
  /// What the supplier promised, as a day. The earliest of the lines, because
  /// the promise is stamped on all of them and a split one is due first.
  readonly expected_arrival: string | null
  /// How many lines are on it — how many different things were ordered, not
  /// how many pieces.
  readonly line_count: number
  readonly gross_minor: number
  readonly discount_minor: number
  /// What the supplier will invoice: the lines less the order's discount.
  readonly net_minor: number
  /// Ordered minus cancelled — what the order still expects.
  readonly expected_stock_units: number
  /// As the order says it — "5 kodi", "10 kodi + 2 pcs" — and null when the
  /// order predates the order unit being kept.
  readonly ordered_label: string | null
  /// Summed from the DC's goods receipts on every read, never stored.
  readonly received_stock_units: number
  readonly outstanding_stock_units: number
  /// Quantities covered by non-rejected, non-void supplier bills.
  readonly invoiced_stock_units: number
  /// Quantity that arrived beyond the order, all of it.
  readonly excess_stock_units: number
  /// The part of it nobody has put on a purchase return yet (0710): what
  /// the order's buyer still has to send back.
  readonly excess_pending_stock_units: number
  readonly fully_received: boolean
  /// What the pieces received so far are worth, net of the discount
  /// allocated to them. PPN is not split out: the net value is what is paid.
  readonly received_value_minor: number
  /// When the order was finished — the last receipt, or the last line closed
  /// short. Null while it is still open.
  readonly fulfilled_at: string | null
  /// The delivery date has passed and pieces are still owed.
  readonly overdue: boolean
}

/// How the order book is narrowed, on the SERVER.
///
/// Every field here is a query parameter the endpoint answers. Nothing is
/// filtered in the browser: the book is the whole company's purchasing, and a
/// chip applied after it arrives has already paid for all of it.
export interface PurchaseOrderScope {
  /// PO number, supplier name or supplier code — the plain-text search.
  readonly q?: string
  readonly statuses?: readonly string[]
  readonly suppliers?: readonly string[]
  /// ISO days, inclusive at both ends.
  readonly issuedFrom?: string
  readonly issuedTo?: string
  /// Promised for delivery between these ISO days, inclusive.
  readonly deliveryFrom?: string
  readonly deliveryTo?: string
}

export interface PurchaseOrderLine {
  readonly po_line_id: string
  readonly line_number: number
  /// The catalogue item the line was ordered from — what an edit names it by.
  /// Null only on orders raised line by line, which cannot be edited.
  readonly supplier_item_id: string | null
  readonly unit_price_minor: number
  readonly ordered_value_minor: number
  /// What is owed, derived from receipts. A line that arrived short shows both.
  /// What the acceptances are EXPECTED to be worth, at the prices that applied
  /// when each was accepted and net of the discount allocated to them. An
  /// operational estimate, never a payable: nothing has validated it, and
  /// nothing reaches the ledger until Finance matches a supplier bill.
  readonly expected_value_minor: number
  readonly article_code: string
  readonly article_name: string
  /// The picture chosen when the order was raised, carried on the line since
  /// the catalogue path was written.
  readonly image_url: string | null
  readonly division_code: string | null
  readonly tags: readonly string[]
  /// What the supplier promised, as `YYYY-MM-DD`. Null when nobody said.
  readonly promised_date: string | null
  readonly ordered_quantity: number
  readonly cancelled_quantity: number
  readonly expected_stock_units: number
  readonly received_quantity: number
  /// This line's share of the order's discount, when the server sends it.
  readonly discount_minor?: number
  /// Each receiving against this line, oldest first; empty when none.
  readonly receipts?: readonly PurchaseOrderLineReceipt[]
  readonly outstanding_stock_units: number
  /// Quantity that arrived beyond this line, all of it (0710).
  readonly excess_quantity: number
  /// The part of the excess nobody has put on a purchase return yet — what
  /// the "Return {n} pcs to supplier" button on the order still offers.
  readonly excess_pending_quantity: number
  /// The part of what arrived the checker counted as not the article the
  /// order names (0829). Inside the excess; it goes back with it.
  readonly wrong_quantity: number
  /// Set when the buyer stopped waiting. The shortfall is still reported:
  /// "settled" and "arrived" are not the same thing.
  readonly closed_short_units: number | null
  readonly closed_short_by: string | null
  readonly closed_short_reason: string | null
  readonly line_status: string
  /// What the buyer means the goods to sell for, and the markup over the
  /// purchase price it came from (basis points).
  readonly base_price_minor?: number | null
  readonly markup_bps?: number | null
  /// How many of each colour and size, and a SKU's own price.
  readonly variants?: readonly {
    readonly colour_code: string | null
    readonly size_code: string | null
    readonly quantity: number
    readonly base_price_minor: number | null
  }[]
  /// What it was ordered in — "10" "KODI" at "20" pieces each.
  readonly order_unit_code?: string | null
  readonly order_unit_quantity?: string | null
  readonly unit_factor?: string | null
  /// The price agreed for ONE `order_unit_code`, exactly as quoted (0656).
  /// Present only when the line was priced per order unit; `unit_price_minor`
  /// above is then the per-piece figure the server derived from it.
  readonly order_unit_price_minor?: number | null
}

export interface PurchaseOrderDetail {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  /// The supplier's record id (`supplier_id` above is its CODE). Null on
  /// orders raised line by line rather than from a catalogue.
  readonly supplier_ref_id: string | null
  readonly notes: string | null
  /// The optional payment terms template chosen on the order, and its name.
  /// Optional on the type so an older server reads as "none".
  readonly payment_terms_code?: string | null
  readonly payment_terms_name?: string | null
  /// How the order is paid: GIRO, TRANSFER or CASH. Absent on an older server.
  readonly payment_method?: string | null
  /// The terms and conditions printed on the order; absent or null means the
  /// default text. Optional until the server sends it.
  readonly terms_and_conditions?: string | null
  /// The discount as a percentage in hundredths (1250 is 12,50 %), as given.
  readonly discount_bps?: number | null
  /// Whether the order can still be rewritten, and if not, why — asked of the
  /// server on every read so Edit is offered only where a save would be taken.
  readonly editable: boolean
  readonly edit_blocked_reason: string | null
  /// Whether the order can still be called off — only while nothing has been
  /// received, billed or advanced against it — and if not, why.
  readonly cancellable?: boolean
  readonly cancel_blocked_reason?: string | null
  readonly supplier_name: string | null
  readonly destination_site_id: string
  readonly origin_kind: string
  /// Where the order stands — see `PurchaseOrderRow`.
  readonly lifecycle: string
  readonly order_status: string
  readonly currency: string
  readonly created_by: string
  readonly issued_at: string | null
  readonly activation_command_id: string | null
  readonly fully_received: boolean
  /// What the acceptances are EXPECTED to be worth, at the prices that applied
  /// when each was accepted and net of the discount allocated to them. An
  /// operational estimate, never a payable: nothing has validated it, and
  /// nothing reaches the ledger until Finance matches a supplier bill.
  readonly expected_value_minor: number
  /// What the order is worth: the lines, the discount agreed on the whole
  /// order, and what the supplier will invoice.
  readonly gross_minor: number
  readonly discount_minor: number
  readonly net_minor: number
  /// The day the supplier promised — the earliest of the lines.
  readonly expected_arrival: string | null
  readonly created_at: string
  /// Every saved edit, newest first: who, when, and what changed.
  readonly revisions?: readonly PurchaseOrderRevisionEntry[]
  readonly lines: readonly PurchaseOrderLine[]
  /// Purchase returns raised against this order's excess, newest first.
  readonly returns: readonly PurchaseReturn[]
}

/// Excess beyond an order, on its way back to the supplier (0710): the PO
/// creator raises one over whatever excess is still pending, and the Gudang
/// closes it by handing the goods to the supplier in Ops Receiving.
export interface PurchaseReturn {
  readonly return_id: string
  readonly return_number: string
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly site_id: string
  readonly status: "OPEN" | "HANDED_OVER"
  readonly note: string | null
  readonly raised_by: string
  readonly raised_at: string
  readonly handed_over_by: string | null
  readonly handed_over_at: string | null
  /// The Gudang's person in charge, named when the surat jalan was generated;
  /// null until it is (0917).
  readonly note_pic?: string | null
  readonly note_generated_at?: string | null
  readonly quantity: number
  readonly lines: readonly {
    readonly receipt_line_id: string
    readonly po_line_id: string
    readonly article_code: string
    readonly article_name: string
    readonly quantity: number
  }[]
}

/// What the server says after it raises an order from the catalogue: the order
/// exists here, and the activation command is on its way to the node that will
/// receive it. The three money figures are returned so the screen that raised
/// the order can show what the supplier will invoice without recomputing it
/// and risking a different answer.
export interface CatalogPurchaseOrderReceipt {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_code: string
  readonly destination_site_id: string
  readonly activation_command_id: string
  readonly sent_to_origin: string
  readonly gross_minor: number
  readonly discount_minor: number
  readonly net_minor: number
}

/// An order raised line by line rather than from the catalogue. `origin_kind`
/// is `SOURCING` or `DIRECT` and the server refuses anything else.
export interface DirectPurchaseLine {
  readonly article_code: string
  readonly article_name: string
  readonly ordered_quantity: number
  readonly unit_price_minor: number
  readonly image_url?: string | null
  readonly division_code?: string | null
  readonly tags?: readonly string[]
  readonly promised_date?: string | null
  /// What it was ordered in, when not the base unit — "KODI" at "10". The
  /// server still requires `ordered_quantity` in pieces and refuses a line
  /// where it does not equal `unit_quantity` times the unit's own factor.
  readonly unit_code?: string | null
  readonly unit_quantity?: string | null
  /// The price agreed for ONE `unit_code`, exactly as quoted (0656). When
  /// present the line totals `unit_quantity` × this and `unit_price_minor`
  /// is ignored by the server; absent prices the line per piece as before.
  readonly order_unit_price_minor?: number | null
}

export interface DirectPurchaseOrder {
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name?: string | null
  readonly destination_site_id: string
  readonly origin_kind: "SOURCING" | "DIRECT"
  readonly currency: string
  readonly notes?: string | null
  readonly created_by: string
  readonly lines: readonly DirectPurchaseLine[]
}

export interface DirectPurchaseOrderReceipt {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly destination_site_id: string
  readonly activation_command_id: string
  readonly sent_to_origin: string
}

// ---------------------------------------------------------------------------
// Price amendments — hand-written, from `pending_price_amendments`.

/// A supplier billed a different price than the order says, and the DC that
/// took the delivery is asking head office what to do about it.
///
/// The ordered price is captured by the server when the request arrives, not
/// sent up by the warehouse — the DC was never told what the order cost, so it
/// could not have quoted it. Both sides are stored so a later reader can see
/// the gap without reconstructing what the order said at the time.
export interface PriceAmendment {
  readonly request_id: string
  readonly po_number: string
  readonly po_line_id: string
  /// Which node took the delivery and raised the question.
  readonly origin_id: string
  readonly count_id: string
  readonly article_code: string
  readonly article_name: string
  readonly ordered_price_minor: number
  readonly invoiced_price_minor: number
  /// Invoiced minus ordered. Negative means the supplier billed LESS than
  /// agreed, which is still a disagreement worth answering.
  readonly difference_minor: number
  readonly note: string
  readonly requested_by: string
  readonly requested_at: string
}

/// Spelled exactly as the Rust enum serialises it — no `rename_all`, so the
/// variant names go on the wire as they are written.
export type PriceAmendmentOutcome = "Approved" | "Rejected"

// ---------------------------------------------------------------------------
// Article setups — hand-written, from `cloud/postgres/tagging.rs`.

/// A delivery counted and accepted but not yet given an identity. What it
/// carries is the SUPPLIER's code and the buyer's own wording: presets for the
/// setup form, never decisions.
export interface UnidentifiedReceipt {
  readonly receipt_line_id: string
  readonly receipt_number: string
  readonly supplier_id: string
  readonly invoice_number: string | null
  readonly quantity: number
  readonly verified_at: string
  readonly supplier_article_code: string
  readonly article_name: string
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly image_url: string | null
  readonly site_id: string
  readonly po_number: string
  /// What the piece cost, per the PO line. Always present — a session cannot
  /// price a SKU below what it cost without knowing what that was.
  readonly purchase_price_minor: number
  /// The buyer's selling price for the line, if the PO carried one. `null`
  /// leaves the composer's base price for a person to set.
  readonly base_price_minor: number | null
  /// The markup that price is over cost, in basis points — 35.5% is 3550.
  readonly markup_bps: number | null
  /// The PO's own colour x size split, prefilling the grid a session is
  /// otherwise filled into by hand. A SKU's `base_price_minor` here is its
  /// OWN price, only set when it differs from the line's.
  readonly variants: readonly {
    readonly colour_code: string | null
    readonly size_code: string | null
    readonly quantity: number
    readonly base_price_minor: number | null
  }[]
}

export interface SetupSessionRow {
  readonly session_id: string
  readonly receipt_line_id: string
  readonly article_code: string
  readonly article_name: string
  readonly division_code: string
  readonly receipt_quantity: number
  /// What the variants add up to. Short of `receipt_quantity` means somebody
  /// has not finished splitting the delivery, which is the decision metric.
  readonly declared_quantity: number
  readonly destination_site_id: string
  readonly status: string
  readonly created_by: string
  readonly created_at: string
}

/// One variant of an article: a colourway in a size, with the serial range its
/// tags are drawn from.
export interface SetupVariant {
  readonly sku_code: string
  readonly colour_digit: string
  readonly colour_label: string
  readonly size_code: string
  readonly size_label: string
  readonly quantity: number
  readonly serial_from: number
  readonly serial_to: number
  readonly qr_payload: string
  readonly base_price_minor: number
}

export interface SetupSession {
  readonly session_id: string
  readonly receipt_line_id: string
  readonly article_code: string
  readonly supplier_article_code: string | null
  /// Who sent the delivery this session was opened against, by CODE — `SUP02`.
  /// Read off the receipt rather than stored on the session: who sent the
  /// goods is a fact about the delivery, not about what head office decided.
  /// Absent on a server that has not been restarted since it started sending
  /// it, which is why the record draws the row only when it is there.
  readonly supplier_code?: string | null
  readonly article_name: string
  readonly division_code: string
  readonly tags: readonly string[]
  readonly currency: string
  readonly receipt_quantity: number
  readonly site_id: string
  readonly status: string
  readonly created_by: string
  readonly created_at: string
  readonly issued_at: string | null
  readonly tagged_at: string | null
  readonly job: {
    readonly job_id: string
    readonly status: string | null
    readonly confirmed_by: string | null
    readonly confirmed_at: string | null
  } | null
  readonly variants: readonly SetupVariant[]
  /// Only on the answer to an issue: the job the mint produced and the command
  /// carrying it to the warehouse that will tag the goods.
  readonly tagging_job_id?: string
  readonly tagging_command_id?: string
}

// ---------------------------------------------------------------------------
// Catalogue imagery — hand-written, from `cloud/media.rs`.

/// Where an image is, and for how long that answer is good for.
export interface ImageLocation {
  readonly key: string
  readonly url: string
  /// `null` when the bucket has a public URL; seconds otherwise.
  readonly expires_in_seconds: number | null
}

export interface ImageUploadTicket {
  readonly upload: ImageLocation
  readonly method: string
  readonly content_type: string
}

// ---------------------------------------------------------------------------
// Supplier contacts

/// The people at a supplier, the primary one first.
///
/// `includeRetired` is the picker/master split the server draws: a form
/// choosing who to send a PO to wants the live ones, and the screen that
/// retired somebody has to be able to find them again.
export function supplierContacts(
  supplierId: string,
  includeRetired = false,
  signal?: AbortSignal
) {
  const query = includeRetired ? "?include_retired=true" : ""
  return node.get<SupplierContact[]>(
    `/api/v1/suppliers/${supplierId}/contacts${query}`,
    { signal }
  )
}

export function createSupplierContact(
  supplierId: string,
  request: CreateSupplierContactRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<SupplierContact>(
    `/api/v1/suppliers/${supplierId}/contacts`,
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}

/// Correct a contact, make them primary, retire them or bring them back.
///
/// The contact's own `version` is the `If-Match`, exactly as on the account
/// beside it: two buyers looking at the same stale row cannot both write.
export function updateSupplierContact(
  supplierId: string,
  contactId: string,
  request: UpdateSupplierContactRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<SupplierContact>(
    "PATCH",
    `/api/v1/suppliers/${supplierId}/contacts/${contactId}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

// ---------------------------------------------------------------------------
// Supplier items — the update request is the one supplier shape ts-rs does not
// export, because `NullablePatch` has no generated form. Absent leaves a field
// alone, `null` clears it, a value sets it.

export interface UpdateSupplierItemRequest {
  readonly supplier_item_code?: string | null
  readonly name?: string | null
  readonly description?: string | null
  readonly image_url?: string | null
  readonly unit_price_minor?: number | null
  readonly currency?: string | null
  readonly internal_article_code?: string | null
  readonly division_code?: string | null
  /// Absent leaves tags alone; present REPLACES them, so an empty list means
  /// "remove every tag".
  readonly tags?: readonly string[] | null
  /// What it comes in, same rule: absent leaves them alone, present replaces,
  /// and an empty list is "this does not come in variants after all".
  readonly colour_codes?: readonly string[] | null
  readonly size_codes?: readonly string[] | null
  /// The item's own pack sizes; present replaces them.
  readonly units?: readonly { unit_code: string; factor: string }[] | null
}

/// One page of a supplier's own catalogue.
export interface SupplierItemPage {
  readonly items: readonly SupplierItem[]
  readonly limit: number
  readonly next_cursor: string | null
}

/// What a sourcing screen asks for. Every facet is a set: a buyer looking at
/// kids and footwear is looking at both, not at the intersection of the two,
/// which is empty.
/// How the catalogue is ordered.
///
/// Deliberately no "popular" and no "best selling". Popular would be a ranking
/// with no signal behind it — nothing here records views, per-item order counts
/// a shopper generated, or ratings — and best selling needs a sold figure,
/// which needs every supplier item to carry our own article code. None do yet.
export type SourcingSort = "relevance" | "newest" | "price_low" | "price_high"

export interface SourcingScope {
  /// Omitted is relevance, which is the only order that means anything before
  /// anybody has typed a word.
  readonly sort?: SourcingSort
  readonly q?: string
  readonly status?: SupplierStatus
  readonly supplierIds?: readonly string[]
  readonly divisionCodes?: readonly string[]
  readonly tagCodes?: readonly string[]
  /// The same three, negated, and ANDed with their positive twins.
  ///
  /// A separate field rather than a sign inside the existing one: the two are
  /// asked together often enough — "kidswear, but not from that supplier" —
  /// and a value beginning with a minus would be ambiguous the first time a
  /// code did.
  readonly excludedSupplierIds?: readonly string[]
  readonly excludedDivisionCodes?: readonly string[]
  readonly excludedTagCodes?: readonly string[]
  /// What the item comes in. `ANY` semantics, like tags: navy or black, not
  /// navy and black — somebody narrowing a catalogue is naming what would do,
  /// not writing a specification.
  readonly colourCodes?: readonly string[]
  readonly excludedColourCodes?: readonly string[]
  readonly sizeCodes?: readonly string[]
  readonly excludedSizeCodes?: readonly string[]
  /// `true` asks for the rows with nothing in the column, `false` for the rows
  /// with something. This is what makes the `Unclassified` facet clickable —
  /// it counts items whose division is null, and no list of codes can match
  /// one of those.
  readonly divisionNull?: boolean
  readonly tagsNull?: boolean
  /// `true` is "no variants recorded", which on a supplier feed is most of the
  /// catalogue and is exactly the pile somebody filling the gaps wants.
  readonly coloursNull?: boolean
  readonly sizesNull?: boolean
  readonly priceMin?: number
  readonly priceMax?: number
  readonly limit?: number
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
  /// Which book: `MERCHANDISE`, `EXPENSE` or `AFFILIATE`.
  ///
  /// The two menus each name theirs — Procurement shows merchandise, Finance shows
  /// the parties that send bills — and a screen that named neither would show
  /// PLN in the middle of the garment factories. See migration 0212.
  readonly category?: SupplierCategory
}

export type SupplierCategory = "MERCHANDISE" | "EXPENSE" | "AFFILIATE"

/// What each book is called where a person reads it.
export const SUPPLIER_CATEGORY_LABEL: Readonly<Record<string, string>> = {
  MERCHANDISE: "Merchandise",
  EXPENSE: "Expense",
  AFFILIATE: "Affiliate",
}

// ---------------------------------------------------------------------------

/// Keys live beside the function that fetches them. The first segment is the
/// domain namespace, so signing out can drop a whole module's answers by
/// prefix without naming every key.
///
/// The nesting is deliberate rather than decorative: `supplier(id)` is a
/// prefix of `supplierCatalogue(id)`, so activating a supplier — which changes
/// both the record and what its items are offered as — invalidates the two
/// with one call and does not have to remember the second.
export const procurementKeys = {
  all: ["procurement"] as const,
  /// The order book. The scope is part of the key because a narrowed book is
  /// a different answer — and an unscoped read stays a distinct entry, which
  /// is what the PO-number counter and the command palette want.
  orders: (scope?: PurchaseOrderScope) =>
    scope === undefined
      ? (["procurement", "purchase-orders"] as const)
      : (["procurement", "purchase-orders", "scoped", scope] as const),
  /// The same book read as a PAGE — rows plus facet counts. A different shape
  /// from `orders` above, so it needs a different key: with the same scope
  /// both shared one cache entry, and whichever screen opened first left the
  /// other holding an object where it expected a list (`.filter is not a
  /// function` on Ops › Stock). The prefix is shared on purpose, so invalidating
  /// `orders()` still reaches both.
  ordersPage: (scope: PurchaseOrderScope = {}) =>
    ["procurement", "purchase-orders", "page", scope] as const,
  order: (id: string) => ["procurement", "purchase-orders", id] as const,
  destinations: () => ["procurement", "purchase-destinations"] as const,
  /// The supplier book. Scoped exactly as `orders` above is, and for the same
  /// reason: a narrowed book is a different answer, and the unscoped read the
  /// pickers and the command palette make stays its own entry.
  ///
  /// Both spellings sit under the same prefix, so one `invalidateQueries` on
  /// `suppliers()` still drops every narrowed list a screen is holding.
  suppliers: (scope?: SupplierScope) =>
    scope === undefined
      ? (["procurement", "suppliers"] as const)
      : (["procurement", "suppliers", "scoped", scope] as const),
  supplier: (id: string) => ["procurement", "suppliers", id] as const,
  /// A supplier's own catalogue, under the supplier it belongs to.
  supplierCatalogue: (id: string) =>
    ["procurement", "suppliers", id, "items"] as const,
  /// Where that supplier's money lands. Under the supplier too, so retiring an
  /// account invalidates with the record it belongs to.
  supplierBankAccounts: (id: string) =>
    ["procurement", "suppliers", id, "bank-accounts"] as const,
  supplierContacts: (id: string) =>
    ["procurement", "suppliers", id, "contacts"] as const,
  supplierItems: () => ["procurement", "supplier-items"] as const,
  supplierItem: (id: string) => ["procurement", "supplier-items", id] as const,
  /// The sourcing search. The scope is part of the key because a different
  /// question has a different answer.
  sourcing: (scope: SourcingScope) =>
    ["procurement", "supplier-items", "sourcing", scope] as const,
  amendments: () => ["procurement", "price-amendments"] as const,
  vocabulary: () => ["procurement", "catalogue", "vocabulary"] as const,
  paymentTerms: () => ["procurement", "payment-terms"] as const,
  basket: () => ["procurement", "sourcing-basket"] as const,
  setups: () => ["procurement", "article-setups"] as const,
  unidentified: () =>
    ["procurement", "article-setups", "unidentified"] as const,
  setup: (id: string) => ["procurement", "article-setups", id] as const,
  itemImage: (supplierCode: string, itemCode: string) =>
    ["procurement", "catalogue", "item-image", supplierCode, itemCode] as const,
  articleImage: (articleCode: string, colour: string) =>
    ["procurement", "catalogue", "article-image", articleCode, colour] as const,
  /// Purchase returns — the excess-beyond-the-order book. Scoped by status
  /// exactly as `orders` is: an unscoped read (the whole book, for the "Over-
  /// delivery returns" card) stays its own entry from a status-narrowed one.
  returns: (status?: string) =>
    status === undefined
      ? (["procurement", "purchase-returns"] as const)
      : (["procurement", "purchase-returns", "scoped", status] as const),
}

/// The headers a supplier write carries.
///
/// `Idempotency-Key` is the caller's and is held across retries: the server
/// stores it with a digest of the request and replays its first answer, so a
/// double-clicked Save writes once. `If-Match` is the record's `version` as a
/// strong quoted ETag — the server refuses a write against a version somebody
/// else has already moved past, which is how two buyers editing one supplier
/// stop being a silent last-write-wins.
function guarded(
  idempotencyKey: string,
  version?: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Idempotency-Key": idempotencyKey,
  }
  if (version !== undefined) headers["If-Match"] = `"${version}"`
  return headers
}

// ---------------------------------------------------------------------------
// Purchase orders

/// A value and how many orders carry it, counted by the server over the whole
/// book. What the filter picker prints beside an option: the number is the
/// affordance — it is how somebody decides whether a filter is worth pressing
/// before they press it — and counting the rows that survived the same filter
/// would print a zero beside every option nobody has ticked.
export interface PurchaseOrderFacets {
  readonly order_status: readonly { value: string; count: number }[]
  /// The supplier's name rides along as `label`, because `SUP-0004` is what
  /// the order is filed under and the picker beside it shows a company.
  readonly supplier: readonly {
    value: string
    label?: string | null
    count: number
  }[]
}

export interface PurchaseOrderPage {
  readonly rows: readonly PurchaseOrderRow[]
  /// Opaque. Pass it back as `cursor` for the next page; null was the last one.
  readonly next_cursor: string | null
  /// Every order the scope matches, not just this page. The order book grows
  /// forever, so "23 orders" under a list of 23 and "23 orders" under a list
  /// of 200 out of 4.000 are different sentences, and only `total` can tell
  /// them apart.
  readonly total: number
  readonly facets: PurchaseOrderFacets
}

/// The scope as the route it addresses.
function orderBookUrl(scope: PurchaseOrderScope): string {
  const params = new URLSearchParams()
  if (scope.q !== undefined && scope.q.trim() !== "")
    params.set("q", scope.q.trim())
  // A ticked list that is empty is not sent at all — `?status=` reaches the
  // server as one blank code, matches nothing, and empties the screen on a
  // filter nobody set.
  if (scope.statuses?.length) params.set("status", scope.statuses.join(","))
  if (scope.suppliers?.length) params.set("supplier", scope.suppliers.join(","))
  if (scope.issuedFrom !== undefined)
    params.set("issued_from", scope.issuedFrom)
  if (scope.issuedTo !== undefined) params.set("issued_to", scope.issuedTo)
  if (scope.deliveryFrom !== undefined)
    params.set("delivery_from", scope.deliveryFrom)
  if (scope.deliveryTo !== undefined)
    params.set("delivery_to", scope.deliveryTo)
  const query = params.toString()
  return query === ""
    ? "/api/v1/purchase-orders"
    : `/api/v1/purchase-orders?${query}`
}

/// The order book, or as much of it as the scope asks for.
export function listPurchaseOrders(
  scope: PurchaseOrderScope = {},
  signal?: AbortSignal
) {
  return node
    .get<PurchaseOrderPage>(orderBookUrl(scope), { signal })
    .then((body) => body.rows)
}

/// The same read, keeping the facet counts the filter picker prints.
///
/// Two functions over one route rather than one that returns the envelope: six
/// screens want the rows and nothing else, and making every one of them reach
/// through `.items` to say so is the worse trade.
export function purchaseOrderPage(
  scope: PurchaseOrderScope = {},
  signal?: AbortSignal
) {
  return node.get<PurchaseOrderPage>(orderBookUrl(scope), { signal })
}

/// The filter bar's clauses as the request they mean.
///
/// The operators each field offers are cut to what the endpoint can answer —
/// see the fields declared in `purchase-orders.tsx` — so there is no case here
/// for an operator a chip could show and the request could not carry.
export function orderScopeFromFilters(
  filters: readonly Filter[]
): PurchaseOrderScope {
  const scope: {
    -readonly [K in keyof PurchaseOrderScope]: PurchaseOrderScope[K]
  } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0) continue
    if (column === "lifecycle" && operator === "isAnyOf")
      scope.statuses = values
    else if (column === "supplier" && operator === "isAnyOf")
      scope.suppliers = values
    else if (column === "issued_at") {
      if (operator === "gte") scope.issuedFrom = values[0]
      else if (operator === "lte") scope.issuedTo = values[0]
    } else if (column === "expected_arrival") {
      if (operator === "gte") scope.deliveryFrom = values[0]
      else if (operator === "lte") scope.deliveryTo = values[0]
    }
  }
  return scope
}

export function purchaseOrderDetail(id: string, signal?: AbortSignal) {
  return node.get<PurchaseOrderDetail>(`/api/v1/purchase-orders/${id}`, {
    signal,
  })
}

/// Where a delivery can go.
///
/// Deliberately not `/api/v1/sync/origins`, which is Admin-only: knowing which
/// nodes exist is administration, and a Supervisor raising an order was
/// getting a 403 on a list of site names. This route answers the purchasing
/// question directly and carries a bare array, not an envelope — deliberately,
/// and it is the one list in this module that stays one. A row here is a
/// building: one warehouse and thirteen shops, and a fourteenth arrives when
/// the company signs a lease. There is nothing for a cursor to carry, and a
/// picker served half its options is a picker that quietly hides a warehouse.
export function purchaseDestinations(signal?: AbortSignal) {
  return node.get<PurchaseDestination[]>("/api/v1/purchase-destinations", {
    signal,
  })
}

/// The order's optional payment terms: a template code from the payment
/// terms book. Widened here until the contract carries it. On a revision
/// absent leaves it unchanged, a code sets it, `null` clears it.
export interface WithPaymentTerms {
  readonly payment_terms_code?: string | null
  /// GIRO (default), TRANSFER or CASH; absent leaves a revised order as it was.
  readonly payment_method?: string | null
  /// The terms and conditions printed on the order (optional; blank prints
  /// the default text). Widened here until the contract carries it.
  readonly terms_and_conditions?: string | null
}

/// Raise an order against the supplier's catalogue.
///
/// Prices are not sent: the server snapshots each line from the supplier item
/// it names, so a buyer cannot order at a price the catalogue does not hold.
/// The idempotency key is the caller's and is held across retries — a
/// double-clicked Create raises one order and gets the same receipt twice.
export function createCatalogPurchaseOrder(
  request: CatalogPurchaseOrderRequest & WithPaymentTerms,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<CatalogPurchaseOrderReceipt>(
    "/api/v1/purchase-orders/catalog",
    request,
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// The whole order as it should now read, for an order nothing has happened
/// against yet. The supplier and destination are fixed: changing either is a
/// different order.
export interface CatalogPurchaseOrderRevision extends WithPaymentTerms {
  readonly notes: string | null
  readonly discount_minor: number | null
  readonly lines: CatalogPurchaseOrderRequest["lines"]
}

/// Rewrite an issued catalog order. Same receipt as raising one; the command
/// id on it is the revision sent to the DC.
export function reviseCatalogPurchaseOrder(
  id: string,
  request: CatalogPurchaseOrderRevision,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.put<CatalogPurchaseOrderReceipt>(
    `/api/v1/purchase-orders/${id}`,
    request,
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Call off an order nothing has been received against. The DC is told, and
/// takes it off the receiving bay's worklist.
export function cancelPurchaseOrder(
  id: string,
  reason: string | null,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<{
    readonly purchase_order_id: string
    readonly po_number: string
  }>(
    `/api/v1/purchase-orders/${id}/cancel`,
    { reason },
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Put an order's excess on a purchase return, for the Gudang to hand to the
/// supplier. Empty/omitted `po_line_ids` means all of the order's pending
/// excess — the "Return N pcs to supplier" button on the sheet asks for the
/// whole order rather than line by line. 409 when nothing is pending.
export function raisePurchaseReturn(
  orderId: string,
  body: { po_line_ids?: readonly string[]; note?: string | null },
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<PurchaseReturn>(
    `/api/v1/purchase-orders/${orderId}/returns`,
    body,
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// The purchase-return book, or the slice of it a status narrows to.
export function purchaseReturns(status?: string, signal?: AbortSignal) {
  const query = status === undefined ? "" : `?status=${status}`
  return node
    .get<{ items: PurchaseReturn[] }>(`/api/v1/purchase-returns${query}`, {
      signal,
    })
    .then((body) => body.items)
}

/// Raise an order line by line, for goods no supplier catalogue carries.
///
/// The server takes no idempotency key here — it is the older route, and the
/// PO number is the thing that has to be unique. A repeated number is refused
/// rather than silently making a second order.
export function raiseDirectPurchaseOrder(
  request: DirectPurchaseOrder,
  signal?: AbortSignal
) {
  return node.post<DirectPurchaseOrderReceipt>(
    "/api/v1/purchase-orders",
    request,
    { signal }
  )
}

/// Stop waiting for the rest of a line. The shortfall stays on the record:
/// "settled" and "arrived" are not the same thing, and the report that tells a
/// buyer which supplier under-delivers depends on the difference.
export function closeLineShort(
  lineId: string,
  closedBy: string,
  reason: string,
  signal?: AbortSignal
) {
  return node.post(
    `/api/v1/purchase-order-lines/${lineId}/close-short`,
    { closed_by: closedBy, reason },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Price amendments

export interface PriceAmendmentPage {
  readonly rows: readonly PriceAmendment[]
  readonly next_cursor: string | null
  /// Every question still waiting, not just this page — the number a badge
  /// wants. Counting the array instead makes a pile deeper than a page
  /// advertise itself as exactly one page deep.
  readonly total: number
  readonly facets: {
    readonly origins: readonly { value: string; count: number }[]
  }
}

export function pendingPriceAmendments(signal?: AbortSignal) {
  return node
    .get<PriceAmendmentPage>("/api/v1/purchase-price-amendments", { signal })
    .then((body) => body.rows)
}

/// The same read, keeping the count the badge prints.
export function priceAmendmentPage(signal?: AbortSignal) {
  return node.get<PriceAmendmentPage>("/api/v1/purchase-price-amendments", {
    signal,
  })
}

/// Answer one. Approving changes the order's price to the invoice and tells
/// the DC in one step; rejecting leaves the order alone and records the
/// disagreement, which is the only place a supplier who repeatedly bills above
/// the agreed price leaves a trail.
export function decidePriceAmendment(
  requestId: string,
  outcome: PriceAmendmentOutcome,
  decidedBy: string,
  note: string | null,
  signal?: AbortSignal
) {
  return node.post(
    `/api/v1/purchase-price-amendments/${requestId}/decide`,
    { outcome, decided_by: decidedBy, note },
    { signal }
  )
}

// ---------------------------------------------------------------------------
// Suppliers

/// A page of the supplier book, and the shape of everything it was drawn from.
///
/// It was a bare array. It is an envelope now for the reason every other list
/// here grew one: a supplier is deactivated rather than deleted, so the book
/// only ever gets longer, and an array has nowhere to put a cursor.
///
/// The type is `SupplierList` from the contract — generated from the struct the
/// server serialises — rather than an interface transcribed here. There was one
/// of those, and it was already half a field behind: a facet carries a `label`
/// it did not mention.
export type SupplierPage = SupplierList

/// How the supplier book is ordered. The three the server names, and no more:
/// a fourth would be a menu item that silently falls back to the house order.
///
/// There is deliberately no sort by status or by what a supplier offers. The
/// server refuses the first (alphabetising two state names groups nothing
/// anybody asked for — the house order already floats the active ones), and
/// the second is not its column to sort: the count comes from the catalogue
/// search, so ordering a page of suppliers by it would rank the page rather
/// than the book.
export type SupplierSort =
  | "code"
  | "name"
  | "created"
  | "status"
  | "active"
  | "completed"
  | "cancelled"
  | "last_purchased"

/// What a screen is asking the supplier book for.
///
/// Every field is a parameter `/api/v1/suppliers` answers. That is the whole
/// contract of this type: a scope the request cannot carry is a control that
/// claims to narrow a list and does not.
export interface SupplierScope {
  /// Free text, tried by the server against the code, the name and the contact
  /// — not the phone or the email, which are a named individual's.
  readonly q?: string
  /// One status, which is all the endpoint takes.
  readonly status?: SupplierStatus
  /// Omitted is the house order: still buying from first, then by name.
  readonly sort?: SupplierSort
  readonly desc?: boolean
  readonly limit?: number
  /// From a previous page's `next_cursor`.
  readonly cursor?: string
  /// Which book: `MERCHANDISE`, `EXPENSE` or `AFFILIATE`.
  ///
  /// The two menus each name theirs — Procurement shows merchandise, Finance shows
  /// the parties that send bills — and a screen that named neither would show
  /// PLN in the middle of the garment factories. See migration 0212.
  readonly category?: SupplierCategory
  /// Only suppliers with an order still open — the "Active order" switch.
  readonly activeOrders?: boolean
}

/// The scope as the route it addresses.
function supplierBookUrl(scope: SupplierScope): string {
  const params = new URLSearchParams()
  if (scope.q !== undefined && scope.q.trim() !== "")
    params.set("q", scope.q.trim())
  if (scope.status !== undefined) params.set("status", scope.status)
  if (scope.activeOrders === true) params.set("active_orders", "true")
  if (scope.sort !== undefined) params.set("sort", scope.sort)
  // Only the word the server looks for. Anything else — including `asc` — is
  // ascending, so sending it would be a parameter that means nothing.
  if (scope.desc === true) params.set("dir", "desc")
  if (scope.limit !== undefined) params.set("limit", String(scope.limit))
  if (scope.cursor !== undefined) params.set("cursor", scope.cursor)
  if (scope.category !== undefined) params.set("category", scope.category)
  const query = params.toString()
  return query === "" ? "/api/v1/suppliers" : `/api/v1/suppliers?${query}`
}

/// A thousand a page, and ten pages at most: the pickers want the whole book,
/// and a book past ten thousand parties wants a search box, not a list.
const BOOK_PAGE = 1000
const BOOK_PAGES = 10

/// Every supplier the scope matches, as the rows alone.
///
/// The pickers that call this want a list of names and nothing else, so the
/// envelope is unwrapped here rather than in nine screens. `supplierPage`
/// below is the same read for anybody who needs the count, the facets or the
/// cursor.
///
/// It follows the cursor. The endpoint answers 200 rows unless asked for more,
/// so a single request left every supplier past the 200th without its legal
/// form in the order list and out of the order picker altogether.
export async function listSuppliers(
  status?: SupplierStatus,
  signal?: AbortSignal
) {
  const rows: SupplierPage["rows"][number][] = []
  let cursor: string | undefined
  for (let page = 0; page < BOOK_PAGES; page++) {
    const body = await node.get<SupplierPage>(
      supplierBookUrl({ status, limit: BOOK_PAGE, cursor }),
      { signal }
    )
    rows.push(...body.rows)
    if (!body.next_cursor) break
    cursor = body.next_cursor
  }
  return rows
}

/// The same read, keeping the count and the facet the filter panel prints.
export function supplierPage(scope: SupplierScope = {}, signal?: AbortSignal) {
  return node.get<SupplierPage>(supplierBookUrl(scope), { signal })
}

/// The filter panel's clauses as the request they mean.
///
/// Beside the fetcher rather than in the screen, like `orderScopeFromFilters`
/// above and for the same reason: this function is the statement of what the
/// endpoint can be asked, and every operator the fields offer has a case here.
export function supplierScopeFromFilters(
  filters: readonly Filter[]
): SupplierScope {
  const scope: { -readonly [K in keyof SupplierScope]: SupplierScope[K] } = {}
  for (const { column, operator, values } of filters) {
    if (values.length === 0) continue
    // One status, because the endpoint compares one column to one value. The
    // field is declared `single`, so the chip cannot offer a second.
    if (column === "status" && operator === "isAnyOf")
      scope.status = values[0] as SupplierStatus
  }
  return scope
}

/// Every live contact of every supplier — what the supplier export reads, in
/// one request rather than one per supplier.
export function allSupplierContacts(signal?: AbortSignal) {
  return node.get<SupplierContact[]>("/api/v1/suppliers/contacts", { signal })
}

export function supplierDetail(id: string, signal?: AbortSignal) {
  return node.get<Supplier>(`/api/v1/suppliers/${id}`, { signal })
}

export function createSupplier(
  request: CreateSupplierRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<Supplier>("/api/v1/suppliers", request, {
    signal,
    headers: guarded(idempotencyKey),
  })
}

export function updateSupplier(
  id: string,
  request: UpdateSupplierRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<Supplier>("PATCH", `/api/v1/suppliers/${id}`, request, {
    signal,
    headers: guarded(idempotencyKey, version),
  })
}

/// Activate or retire a supplier. Two routes on the server, one function here:
/// the caller is choosing a status, and spelling it as a status rather than as
/// two verbs is what lets one row action read from the record it is acting on.
export function setSupplierStatus(
  id: string,
  status: SupplierStatus,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  const verb = status === "ACTIVE" ? "activate" : "deactivate"
  return node.post<Supplier>(
    `/api/v1/suppliers/${id}/${verb}`,
    {},
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

// ---------------------------------------------------------------------------
// Where a supplier's money lands
//
// A bilyet giro is an order to move money INTO a named account, so the paper
// cannot be filled in without these three facts. They hang off the supplier
// because that is the only screen anybody asks the question on.

/// One supplier's accounts, default first.
///
/// Live ones only unless asked. A form choosing where to send a giro wants the
/// accounts that still work; the screen that retired one has to be able to find
/// it again.
export function supplierBankAccounts(
  supplierId: string,
  includeRetired = false,
  signal?: AbortSignal
) {
  const query = includeRetired ? "?include_retired=true" : ""
  return node.get<SupplierBankAccount[]>(
    `/api/v1/suppliers/${supplierId}/bank-accounts${query}`,
    { signal }
  )
}

export function createSupplierBankAccount(
  supplierId: string,
  request: CreateSupplierBankAccountRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<SupplierBankAccount>(
    `/api/v1/suppliers/${supplierId}/bank-accounts`,
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}

/// Correct an account, make it the default, retire it or bring it back.
///
/// The account's own `version` is the `If-Match`, exactly as on the supplier:
/// two buyers looking at the same stale row cannot both write.
export function updateSupplierBankAccount(
  supplierId: string,
  accountId: string,
  request: UpdateSupplierBankAccountRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<SupplierBankAccount>(
    "PATCH",
    `/api/v1/suppliers/${supplierId}/bank-accounts/${accountId}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

// ---------------------------------------------------------------------------
// Supplier items

/// One supplier's catalogue, a page at a time.
export function supplierCatalogue(
  supplierId: string,
  options: { status?: SupplierStatus; cursor?: string; limit?: number } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (options.status !== undefined) params.set("status", options.status)
  if (options.cursor !== undefined) params.set("cursor", options.cursor)
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const query = params.toString()
  return node.get<SupplierItemPage>(
    `/api/v1/suppliers/${supplierId}/items${query === "" ? "" : `?${query}`}`,
    { signal }
  )
}

export function createSupplierItem(
  supplierId: string,
  request: CreateSupplierItemRequest,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<SupplierItem>(
    `/api/v1/suppliers/${supplierId}/items`,
    request,
    { signal, headers: guarded(idempotencyKey) }
  )
}

/// A new item and its photograph, as one act.
///
/// The picture is filed under the supplier's code and the item's own code, so
/// it can only be uploaded once the item exists — and then attached with a
/// second write. That second write has its OWN key: the first one's would be
/// read as a retry of the create and replayed, leaving the item saved and the
/// picture nowhere.
///
/// A picture that fails does not fail the item: the item is what the order
/// needs, and a missing photograph is something somebody can add later. The
/// failure comes back beside the item for the caller to say out loud.
export async function createSupplierItemWithPhoto(
  supplierId: string,
  request: CreateSupplierItemRequest,
  photo: Blob | null,
  supplierCode: string | undefined,
  idempotencyKey: string
): Promise<{ item: SupplierItem; photoTrouble: string | null }> {
  const item = await createSupplierItem(supplierId, request, idempotencyKey)
  if (photo === null) return { item, photoTrouble: null }
  try {
    if (supplierCode === undefined) {
      throw new Error(
        "the supplier's code has not loaded, so there was nowhere to file it"
      )
    }
    const url = await uploadSupplierItemImage(
      supplierCode,
      item.supplier_item_code,
      photo
    )
    return {
      item: await updateSupplierItem(
        item.supplier_item_id,
        { image_url: url },
        item.version,
        crypto.randomUUID()
      ),
      photoTrouble: null,
    }
  } catch (error) {
    return { item, photoTrouble: (error as Error).message }
  }
}

export function supplierItemDetail(id: string, signal?: AbortSignal) {
  return node.get<SupplierItem>(`/api/v1/supplier-items/${id}`, { signal })
}

export function updateSupplierItem(
  id: string,
  request: UpdateSupplierItemRequest,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.request<SupplierItem>(
    "PATCH",
    `/api/v1/supplier-items/${id}`,
    request,
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

export function setSupplierItemStatus(
  id: string,
  status: SupplierStatus,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  const verb = status === "ACTIVE" ? "activate" : "deactivate"
  return node.post<SupplierItem>(
    `/api/v1/supplier-items/${id}/${verb}`,
    {},
    { signal, headers: guarded(idempotencyKey, version) }
  )
}

/// Everything on offer, across every supplier — one page, plus what the rest
/// of the catalogue contains.
///
/// The facets come back counted over everything the text search matches, not
/// over the page and not over the current selection: choosing a division must
/// not make the other divisions read zero, because a facet list is how a buyer
/// sees what else is there.
export function searchSupplierItems(
  scope: SourcingScope = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (scope.q !== undefined && scope.q.trim() !== "")
    params.set("q", scope.q.trim())
  if (scope.status !== undefined) params.set("status", scope.status)
  // Omitted rather than sent as "relevance": the server's default IS relevance,
  // and a cursor issued under one order cannot be walked under another, so the
  // fewer ways the same request can be spelled the better.
  if (scope.sort !== undefined && scope.sort !== "relevance")
    params.set("sort", scope.sort)
  // Comma-separated rather than repeated keys: that is what the browser's own
  // filter state serialises to, and a second encoding for the same idea is a
  // second thing to get wrong.
  if (scope.supplierIds?.length)
    params.set("supplier_id", scope.supplierIds.join(","))
  if (scope.divisionCodes?.length)
    params.set("division", scope.divisionCodes.join(","))
  if (scope.tagCodes?.length) params.set("tags", scope.tagCodes.join(","))
  if (scope.excludedSupplierIds?.length)
    params.set("supplier_id_not", scope.excludedSupplierIds.join(","))
  if (scope.excludedDivisionCodes?.length)
    params.set("division_not", scope.excludedDivisionCodes.join(","))
  if (scope.excludedTagCodes?.length)
    params.set("tags_not", scope.excludedTagCodes.join(","))
  if (scope.divisionNull !== undefined)
    params.set("division_null", String(scope.divisionNull))
  if (scope.tagsNull !== undefined)
    params.set("tags_null", String(scope.tagsNull))
  if (scope.colourCodes?.length)
    params.set("colour", scope.colourCodes.join(","))
  if (scope.excludedColourCodes?.length)
    params.set("colour_not", scope.excludedColourCodes.join(","))
  if (scope.coloursNull !== undefined)
    params.set("colour_null", String(scope.coloursNull))
  if (scope.sizeCodes?.length) params.set("size", scope.sizeCodes.join(","))
  if (scope.excludedSizeCodes?.length)
    params.set("size_not", scope.excludedSizeCodes.join(","))
  if (scope.sizesNull !== undefined)
    params.set("size_null", String(scope.sizesNull))
  if (scope.priceMin !== undefined)
    params.set("price_min", String(scope.priceMin))
  if (scope.priceMax !== undefined)
    params.set("price_max", String(scope.priceMax))
  if (scope.limit !== undefined) params.set("limit", String(scope.limit))
  if (scope.cursor !== undefined) params.set("cursor", scope.cursor)
  if (scope.category !== undefined) params.set("category", scope.category)
  const query = params.toString()
  return node.get<SourcingPage>(
    `/api/v1/supplier-items${query === "" ? "" : `?${query}`}`,
    { signal }
  )
}

/// The filter bar's clauses, as a request this endpoint can answer.
///
/// Here rather than in the screen, and beside `searchSupplierItems` rather
/// than beside the bar, because this function is the whole statement of what
/// the endpoint can and cannot be asked. Every operator the sourcing fields
/// offer has a case below; an operator with no case is one the server would
/// silently ignore, which is a chip that claims to narrow a list and does not.
/// Keeping the mapping next to the fetcher is what makes that reviewable in
/// one screenful — in the browser it would be spread across a component.
///
/// The column names are the bar's, not the wire's: `division`, `tag`,
/// `colour`, `size`, `supplier`, `price`. They are also what appears in `?f=`,
/// so they are a public surface and worth keeping short.
export function scopeFromFilters(
  filters: readonly Filter[]
): Partial<SourcingScope> {
  const scope: {
    -readonly [K in keyof SourcingScope]: SourcingScope[K]
  } = {}

  for (const { column, operator, values } of filters) {
    if (values.length === 0 && arity(operator) !== "none") continue

    switch (column) {
      case "division":
        if (operator === "is" || operator === "isAnyOf")
          scope.divisionCodes = values
        else if (operator === "isNot" || operator === "isNoneOf")
          scope.excludedDivisionCodes = values
        else if (operator === "isEmpty") scope.divisionNull = true
        else if (operator === "isNotEmpty") scope.divisionNull = false
        break

      case "tag":
        if (operator === "includesAnyOf") scope.tagCodes = values
        else if (operator === "excludes") scope.excludedTagCodes = values
        else if (operator === "isEmpty") scope.tagsNull = true
        else if (operator === "isNotEmpty") scope.tagsNull = false
        break

      case "colour":
        if (operator === "includesAnyOf") scope.colourCodes = values
        else if (operator === "excludes") scope.excludedColourCodes = values
        else if (operator === "isEmpty") scope.coloursNull = true
        else if (operator === "isNotEmpty") scope.coloursNull = false
        break

      case "size":
        if (operator === "includesAnyOf") scope.sizeCodes = values
        else if (operator === "excludes") scope.excludedSizeCodes = values
        else if (operator === "isEmpty") scope.sizesNull = true
        else if (operator === "isNotEmpty") scope.sizesNull = false
        break

      case "supplier":
        if (operator === "is" || operator === "isAnyOf")
          scope.supplierIds = values
        else if (operator === "isNot" || operator === "isNoneOf")
          scope.excludedSupplierIds = values
        break

      case "price": {
        // Sent as typed. `unit_price_minor` is whole rupiah despite its name
        // (`lib/format`: IDR has no minor unit in practice), so a bound needs
        // no conversion — and applying one would silently multiply every
        // filter by a hundred.
        const minor = (at: number) => {
          const parsed = Number(values[at])
          return Number.isFinite(parsed) ? Math.round(parsed) : undefined
        }
        if (operator === "gte") scope.priceMin = minor(0)
        else if (operator === "lte") scope.priceMax = minor(0)
        else if (operator === "between") {
          const [low, high] = [minor(0), minor(1)]
          if (low !== undefined && high !== undefined) {
            scope.priceMin = Math.min(low, high)
            scope.priceMax = Math.max(low, high)
          }
        }
        break
      }
    }
  }

  return scope
}

/// The words the catalogue may be described with, so a screen can show
/// "Kaus Kaki" where the database says `KAUS_KAKI` — and still filter by the
/// code, which is the thing that does not change when somebody edits a label.
export function catalogueVocabulary(signal?: AbortSignal) {
  return node.get<CatalogueVocabulary>("/api/v1/catalogue/vocabulary", {
    signal,
  })
}

/// The arrangements a buyer may agree, and what each instalment counts from.
///
/// The composer carried four of these in a `const` until migration 0201 gave
/// them a table — which meant a fifth arrangement cost a release. Terms and
/// templates arrive together because a template is unreadable without its
/// terms: "40% advance, 60% before dispatch" is four words until you know that
/// *before dispatch* means thirty days after the bill.
export function paymentTermsBook(signal?: AbortSignal) {
  return node.get<PaymentTermsBook>("/api/v1/payment-terms", { signal })
}

// ---------------------------------------------------------------------------
// The basket
//
// Every route is scoped to the caller by the session and nothing else, so no
// path here names a user: there is no shape of request that reads or empties
// somebody else's basket.

export function readBasket(signal?: AbortSignal) {
  return node.get<BasketLine[]>("/api/v1/sourcing-basket", { signal })
}

export function addToBasket(request: AddToBasketRequest, signal?: AbortSignal) {
  return node.post<BasketLine>("/api/v1/sourcing-basket", request, { signal })
}

/// Say exactly how many. Zero takes the line out and answers 204, which the
/// client reads back as `undefined` — there is no line left to describe.
export function setBasketQuantity(
  supplierItemId: string,
  quantity: number,
  signal?: AbortSignal
) {
  return node.request<BasketLine | undefined>(
    "PATCH",
    `/api/v1/sourcing-basket/${supplierItemId}`,
    { quantity },
    { signal }
  )
}

/// A POST rather than a DELETE because the server's CORS layer permits GET,
/// POST and PATCH, and widening it for one route would loosen every route.
export function removeFromBasket(supplierItemId: string, signal?: AbortSignal) {
  return node.post<void>(
    `/api/v1/sourcing-basket/${supplierItemId}/remove`,
    {},
    { signal }
  )
}

export function clearBasket(signal?: AbortSignal) {
  return node.post<void>("/api/v1/sourcing-basket/clear", {}, { signal })
}

// ---------------------------------------------------------------------------
// Article setups

/// Head office's queue: sessions opened and not yet issued.
export function listSetupSessions(signal?: AbortSignal) {
  return node
    .get<{ items: SetupSessionRow[] }>("/api/v1/article-setups", { signal })
    .then((body) => body.items)
}

/// Deliveries counted and accepted but not yet worked out.
export function unidentifiedReceipts(signal?: AbortSignal) {
  return node
    .get<{ items: UnidentifiedReceipt[] }>(
      "/api/v1/article-setups/unidentified",
      { signal }
    )
    .then((body) => body.items)
}

/// One (colour, size) actually present in a delivery.
export interface NewSetupVariant {
  readonly colour_digit: string
  readonly size_code: string
  readonly quantity: number
  readonly base_price_minor: number
}

/// What opening a setup session says about a delivery.
///
/// `article_code` absent means a product new to this company and a fresh
/// eight-digit code is minted for it; present attaches this delivery to an
/// article we already sell, so a second shipment reuses the SKUs the first one
/// created instead of quietly becoming a different product. The code on the
/// purchase order is never it — that one is the supplier's.
export interface NewSetupSession {
  readonly receipt_line_id: string
  readonly article_code?: string
  readonly article_name: string
  readonly division_code: string
  readonly tags: readonly string[]
  readonly image_url?: string | null
  readonly currency: string
  readonly colours: readonly {
    readonly colour_digit: string
    readonly colour_code: string
  }[]
  readonly variants: readonly NewSetupVariant[]
  readonly created_by: string
}

/// Give a delivery its identity.
///
/// This is the step everything downstream waits on: until a session exists and
/// is issued, the goods have no article of ours, so they can have no SKU — and
/// without a SKU they can never be tagged, priced or sold. The DC's tagging
/// queue stays empty because head office has not answered this question yet.
export function openSetupSession(
  request: NewSetupSession,
  signal?: AbortSignal
) {
  return node.post<SetupSession>("/api/v1/article-setups", request, { signal })
}

/// One article of a delivery line split into several: its own colourways and
/// its own share of the pieces.
export interface NewSetupPart {
  readonly colours: NewSetupSession["colours"]
  readonly variants: readonly NewSetupVariant[]
}

/// One delivery line set up as several sibling articles (0825): the same name,
/// division, tags and price, each with its own minted code and SKUs. No parent
/// article. Every part becomes an ordinary session, all opened in one
/// transaction — every one opens or none does — and each is then issued on
/// its own with `issueSetupSession`.
export interface NewSplitSetup {
  readonly receipt_line_id: string
  readonly article_name: string
  readonly division_code: string
  readonly tags: readonly string[]
  readonly image_url?: string | null
  readonly currency: string
  readonly articles: readonly NewSetupPart[]
  readonly created_by: string
}

/// Open every article of a split line. The sessions come back in the order
/// the parts were sent, which is the order their codes were minted in.
export function openSplitSetup(request: NewSplitSetup, signal?: AbortSignal) {
  return node
    .post<{
      items: SetupSession[]
    }>("/api/v1/article-setups/split", request, { signal })
    .then((body) => body.items)
}

export function setupSessionDetail(id: string, signal?: AbortSignal) {
  return node.get<SetupSession>(`/api/v1/article-setups/${id}`, { signal })
}

/// Mint the article, its SKUs and their EPCs, and send the tagging job down.
/// All of it commits together: a serial range drawn and not sent is a hole in
/// the numbering that nothing will ever fill — which is exactly why this write
/// must not be applied twice, and carries a key that says so.
export function issueSetupSession(
  id: string,
  issuedBy: string,
  idempotencyKey: string,
  signal?: AbortSignal
) {
  return node.post<SetupSession>(
    `/api/v1/article-setups/${id}/issue`,
    { issued_by: issuedBy },
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

/// Mint an article code for a product new to the catalogue.
///
/// Ordinarily a setup session mints its own; this exists for the case where a
/// buyer wants the code in hand before the goods arrive. It draws from a
/// sequence, so a repeated call is a code nobody will ever use — hence the
/// key, held across retries.
export function mintArticleCode(idempotencyKey: string, signal?: AbortSignal) {
  return node.post<{ article_code: string }>(
    "/api/v1/article-codes",
    {},
    { signal, headers: { "Idempotency-Key": idempotencyKey } }
  )
}

// ---------------------------------------------------------------------------
// Catalogue imagery
//
// A missing photograph answers 404, which is an answer and not a failure: an
// item nobody has shot yet is ordinary. These resolve to `null` so a screen
// says "no photograph" instead of showing the error state.

async function imageOrNothing(
  path: string,
  signal?: AbortSignal
): Promise<ImageLocation | null> {
  try {
    return await node.get<ImageLocation>(path, { signal })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/// Keyed by OUR article code and a colour digit. Photographs are per colourway,
/// not per SKU: every size of the red shirt is the same red shirt.
export function articleImage(
  articleCode: string,
  colour: string,
  signal?: AbortSignal
) {
  return imageOrNothing(
    `/api/v1/catalogue/articles/${articleCode}/colours/${colour}/image`,
    signal
  )
}

/// Keyed by the SUPPLIER's own numbering, which is not an identity here — two
/// suppliers reuse each other's codes — so it lives under its own prefix and
/// is never derived from an article code.
export function supplierItemImage(
  supplierCode: string,
  itemCode: string,
  signal?: AbortSignal
) {
  return imageOrNothing(
    `/api/v1/catalogue/suppliers/${supplierCode}/items/${itemCode}/image`,
    signal
  )
}

/// Put a photograph on a supplier's item.
///
/// Two steps like the article upload, and a third: the column holds a URL
/// rather than a key the server can recompute, so the durable address is read
/// back through the GET route once the bytes are up. That route is the one
/// that knows whether this bucket serves a public URL or a signed one — and a
/// signed one must not be written into `image_url`, because it stops resolving
/// while the item it belongs to does not.
///
/// The key is the supplier's own code and the item's own code, so this can be
/// called for an item that exists. It is not a way to park bytes before there
/// is anything to hang them on.
export async function uploadSupplierItemImage(
  supplierCode: string,
  itemCode: string,
  file: Blob,
  signal?: AbortSignal
): Promise<string> {
  const ticket = await node.post<ImageUploadTicket>(
    `/api/v1/catalogue/suppliers/${supplierCode}/items/${itemCode}/image/upload-url`,
    {},
    { signal }
  )
  const response = await fetch(ticket.upload.url, {
    method: ticket.method,
    body: file,
    headers: { "content-type": ticket.content_type },
    signal,
  })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `The image store refused the upload (${response.status}).`
    )
  }
  const stored = await supplierItemImage(supplierCode, itemCode, signal)
  if (stored === null) {
    throw new ApiError(
      502,
      "The photograph uploaded but the store cannot say where it landed."
    )
  }
  if (stored.expires_in_seconds !== null) {
    throw new ApiError(
      501,
      "This bucket hands out expiring links, which cannot be stored against an item. Set a public base URL on the node."
    )
  }
  return stored.url
}

/// Put a photograph on a colourway.
///
/// Two steps, on purpose: the node hands out a URL that authorises this one
/// key for an hour, and the bytes then go straight to the bucket. The
/// credential never leaves the server and the image never transits it — which
/// is why the second call is a bare `fetch` rather than `node`: it is not
/// addressed to the node at all.
export async function uploadArticleImage(
  articleCode: string,
  colour: string,
  file: Blob,
  signal?: AbortSignal
): Promise<ImageLocation> {
  const ticket = await node.post<ImageUploadTicket>(
    `/api/v1/catalogue/articles/${articleCode}/colours/${colour}/image/upload-url`,
    {},
    { signal }
  )
  const response = await fetch(ticket.upload.url, {
    method: ticket.method,
    body: file,
    headers: { "content-type": ticket.content_type },
    signal,
  })
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `The image store refused the upload (${response.status}).`
    )
  }
  return ticket.upload
}
