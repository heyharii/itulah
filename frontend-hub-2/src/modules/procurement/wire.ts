import type { Page, Unpack } from "@/lib/list"
import type { SourcedItem, SourcingPage } from "@itulah/contract"

/// What purchasing's endpoints actually answer, and where the contract stops.
///
/// ## Why half of this file is hand-written
///
/// Most of the module's reads are typed from `@itulah/contract`, which is
/// generated from the Rust structs the server serialises — a supplier, a
/// supplier item, a sourced item, a basket line, a destination, the catalogue
/// vocabulary. Those are checked at build time and are imported directly by the
/// screens.
///
/// **The purchase order is not.** `list_purchase_orders`,
/// `purchase_order_status` and `pending_price_amendments` answer with `json!()`
/// literals rather than a struct, so `ts-rs` has nothing to generate from and
/// the interfaces below are TRANSCRIBED from those literals. They are unchecked
/// — if a field is renamed on the server this file is where it goes stale, and
/// it is the first place to look when a column reads `undefined`. The precedent
/// is `Attention` in `modules/finance/overview.tsx`, and the fix is the same
/// one: give the handlers a struct and a `#[derive(TS)]`.
///
/// `/api/v1/colours` and `/api/v1/auth/me` are in the same position.
///
/// ## Three envelopes, and the one line that reconciles them
///
/// `lib/list.ts`'s hooks expect `{ rows, next_cursor, total }`. Purchasing
/// spells it `items`, three different ways, so each read that needs a hook
/// passes an `Unpack` — see the bottom of this file. The envelope is kept whole
/// rather than reduced to its rows, because the facet counts travel on it and
/// they are what the filter panels are drawn from.

// ---------------------------------------------------------------------------
// Purchase orders — transcribed from `cloud/postgres/sync.rs`.

/// One order on the buyer's list, with its outstanding position.
export interface PurchaseOrderRow {
  readonly purchase_order_id: string
  readonly po_number: string
  /// The supplier's own CODE — `SUP12` — despite the name. A `Supplier`
  /// record's `supplier_id` is a uuid, and the two are not the same string:
  /// a filter built from the uuid matches nothing, quietly, on every supplier.
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly destination_site_id: string
  /// Where the order stands, derived by the server from its receipts every
  /// time it is asked for: `ACTIVE`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`,
  /// `CLOSED`. This is what the tabs count and what a row shows.
  readonly lifecycle: string
  /// The stored column, which only ever reads `ISSUED` or `CLOSED`. Kept
  /// because the server still sends it; nothing should draw it.
  readonly order_status: string
  readonly currency: string
  readonly issued_at: string | null
  /// What the supplier promised, as a day — the earliest of the lines, because
  /// a split promise is due at its first half.
  readonly expected_arrival: string | null
  /// How many different things were ordered, not how many pieces.
  readonly line_count: number
  readonly gross_minor: number
  readonly discount_minor: number
  /// What the supplier will invoice: the lines less the order's discount.
  readonly net_minor: number
  /// Ordered minus cancelled — what the order still expects.
  readonly expected_stock_units: number
  /// Summed from the DC's goods receipts on every read, never stored. Counts
  /// what ANSWERED the order: quantity that arrived beyond it is excess and is
  /// reported separately.
  readonly received_stock_units: number
  readonly outstanding_stock_units: number
  /// Arrived beyond the order, waiting for a buyer's decision.
  readonly excess_stock_units: number
  readonly fully_received: boolean
}

/// A value and how many orders carry it, counted by the server over the whole
/// book rather than over what the current filters left behind.
///
/// The distinction is the whole affordance of a facet: counting the surviving
/// rows prints a zero beside every option nobody has ticked, which reads as a
/// book with nothing in it.
export interface PurchaseOrderFacets {
  readonly order_status: readonly { value: string; count: number }[]
  readonly supplier: readonly { value: string; count: number }[]
}

/// The whole answer `GET /api/v1/purchase-orders` gives.
///
/// An envelope, not a bare list: `rows` is one page, `next_cursor` opens the
/// next one, and `total` counts everything the filters match rather than
/// everything that fitted. This shape was declared as `{ items, facets }` for
/// long enough that the screen read `undefined` and drew an empty book against
/// a server that was answering perfectly.
export interface PurchaseOrderPage {
  readonly rows: readonly PurchaseOrderRow[]
  /// Opaque. Pass it back as `cursor` for the next page; absent means this was
  /// the last one.
  readonly next_cursor: string | null
  /// Every order the search and filters match, not just this page.
  readonly total: number
  readonly facets: PurchaseOrderFacets
}

export interface PurchaseOrderLine {
  readonly po_line_id: string
  readonly line_number: number
  readonly unit_price_minor: number
  readonly ordered_value_minor: number
  /// What the acceptances against this line are expected to be worth, at the
  /// prices that applied when each was accepted and net of the discount
  /// allocated to them. An operational estimate: nothing has validated it and
  /// nothing is posted until Finance matches a supplier bill against it, which
  /// is why it is never labelled "payable" on a screen.
  readonly expected_value_minor: number
  readonly article_code: string
  readonly article_name: string
  readonly image_url: string | null
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly promised_date: string | null
  readonly ordered_quantity: number
  readonly cancelled_quantity: number
  readonly expected_stock_units: number
  readonly received_quantity: number
  /// Quantity that arrived beyond what the order had outstanding. Real goods,
  /// waiting for a buyer to say whether the company keeps them; they are not
  /// part of `received_quantity` and carry no expected value.
  readonly excess_quantity: number
  readonly outstanding_stock_units: number
  /// Set when the buyer stopped waiting. The shortfall is still reported:
  /// "settled" and "arrived" are not the same thing, and the report that tells
  /// a buyer which supplier under-delivers is built from the difference.
  readonly closed_short_units: number | null
  readonly closed_short_by: string | null
  readonly closed_short_reason: string | null
  readonly line_status: string
}

export interface PurchaseOrderDetail {
  readonly purchase_order_id: string
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly destination_site_id: string
  readonly origin_kind: string
  readonly order_status: string
  readonly currency: string
  readonly created_by: string
  readonly issued_at: string | null
  readonly activation_command_id: string | null
  readonly fully_received: boolean
  /// Where the order stands, derived from its receipts: `ACTIVE`,
  /// `PARTIALLY_RECEIVED`, `FULLY_RECEIVED` or `CLOSED`.
  readonly lifecycle: string
  /// What the deliveries so far are expected to be worth. Not what the order
  /// is worth, and not a payable — see `PurchaseOrderLine`.
  readonly expected_value_minor: number
  readonly gross_minor: number
  readonly discount_minor: number
  readonly net_minor: number
  readonly expected_arrival: string | null
  readonly lines: readonly PurchaseOrderLine[]
}

/// What the server says after raising an order from the catalogue.
///
/// The three money figures come back so the screen that raised the order can
/// state what the supplier will invoice without recomputing it and risking a
/// different answer from the one that was written down.
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

// ---------------------------------------------------------------------------
// Price amendments — transcribed from `pending_price_amendments`.

/// A supplier billed a different price than the order says, and the DC that
/// took the delivery is asking head office what to do about it.
///
/// The ordered price is captured by the SERVER when the request arrives rather
/// than sent up by the warehouse: the DC was never told what the order cost, so
/// it could not have quoted it. Both sides are stored, which is why this can
/// show the gap without reconstructing what the order said at the time.
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
/// variant names go on the wire capitalised as they are written. Lower-casing
/// them is a 422 that reads like a validation bug.
export type PriceAmendmentOutcome = "Approved" | "Rejected"

// ---------------------------------------------------------------------------
// The colour master — transcribed from `cloud/postgres/colours.rs`.

/// One colour in the company-wide list.
///
/// Colour used to be free text per article, unique only within one article, so
/// the catalogue could hold "Navy", "navy" and "Biru Navy" as three unrelated
/// things and every report that grouped by colour split three ways. It is a
/// master now and is PICKED, never typed — which is why this module reads it
/// rather than letting anybody write a colour name into a supplier item.
///
/// Deliberately not folded into `CatalogueVocabulary`: colours have their own
/// master and their own endpoint, and a second half-copy travelling on another
/// route is the exact split the master exists to prevent. The contract says so
/// in `CatalogueVocabulary`'s own comment.
export interface ColourTerm {
  readonly code: string
  readonly label: string
  /// For the swatch. A colour can be named long before anybody decides which
  /// pixel value stands for it, and an empty ring is drawn for that rather than
  /// a grey invented here.
  readonly hex_code: string | null
  readonly display_order: number
  /// Retiring a colour never unpaints the garments already wearing it, so an
  /// inactive term still appears on items and is still named — it is only
  /// withheld from the pickers that would put it back into circulation.
  readonly active: boolean
  readonly version: number
  readonly in_use: number
}

export interface ColourVocabulary {
  readonly colours: readonly ColourTerm[]
}

// ---------------------------------------------------------------------------
// Supplier items — the update request is the one supplier shape `ts-rs` does
// not export, because `NullablePatch` has no generated form.

/// Absent leaves a field alone, `null` clears it, a value sets it.
///
/// The three lists are the trap worth naming: present REPLACES, so an empty
/// list means "remove every one" rather than "leave them". That is a thing
/// somebody may legitimately say about an item, which is why they are not
/// merged with what is already there.
export interface UpdateSupplierItemRequest {
  readonly supplier_item_code?: string | null
  readonly name?: string | null
  readonly description?: string | null
  readonly image_url?: string | null
  readonly unit_price_minor?: number | null
  readonly currency?: string | null
  readonly internal_article_code?: string | null
  readonly division_code?: string | null
  readonly tags?: readonly string[] | null
  readonly colour_codes?: readonly string[] | null
  readonly size_codes?: readonly string[] | null
}

// ---------------------------------------------------------------------------
// Who is signed in — transcribed from `GET /api/v1/auth/me`.

/// Four purchasing writes name their actor in the BODY rather than taking it
/// from the session — `closed_by`, `decided_by`, `issued_by`, `created_by` —
/// because the server records them as facts about a decision and not about a
/// request. So the screen has to say who, and the only honest answer is the
/// signed-in user.
export interface Identity {
  readonly username: string
  readonly display_name: string
  readonly role: string
}

// ---------------------------------------------------------------------------
// The cache keys.
//
// The first segment is the module, so one call can settle a whole domain by
// prefix. The nesting is deliberate rather than decorative: `supplier(id)` is a
// prefix of everything about that supplier, so activating one — which changes
// both the record and what its items are offered as — invalidates both with one
// call and cannot forget the second.

export const keys = {
  all: ["procurement"] as const,
  orders: ["procurement", "orders"] as const,
  order: (id: string) => ["procurement", "orders", id] as const,
  destinations: ["procurement", "destinations"] as const,
  suppliers: ["procurement", "suppliers"] as const,
  supplier: (id: string) => ["procurement", "suppliers", id] as const,
  /// The cross-supplier catalogue search, which is what Sourcing, Catalogue and
  /// a supplier's own offering are all three drawn from.
  items: ["procurement", "supplier-items"] as const,
  item: (id: string) => ["procurement", "supplier-items", id] as const,
  amendments: ["procurement", "amendments"] as const,
  basket: ["procurement", "basket"] as const,
  vocabulary: ["procurement", "vocabulary"] as const,
  colours: ["procurement", "colours"] as const,
  identity: ["identity"] as const,
}

// ---------------------------------------------------------------------------
// The envelope readers.
//
// Module scope rather than inline, because `lib/list.ts` puts them in a memo's
// dependencies: an arrow written at the call site is a new function on every
// render and would rebuild the row array every time.

/// A page of the catalogue, with `items` read as `rows` and everything else —
/// the total, the facets — left exactly where it was.
///
/// The intersection is not a trick: the object genuinely carries both spellings
/// after the spread, so a screen can take `head` as `CataloguePage` and reach
/// `facets` without a second cast or a second read.
export type CataloguePage = Page<SourcedItem> & SourcingPage

export const unpackCatalogue: Unpack<Page<SourcedItem>> = (body) => {
  const page = body as SourcingPage
  return { ...page, rows: page.items }
}

/// `{ pending, items }` → the items. `pending` is the count of the same array
/// and is not read: a number beside a list it also contains is one of them
/// being wrong eventually.
export const unpackAmendments: Unpack<PriceAmendment[]> = (body) =>
  (body as { items: PriceAmendment[] }).items
