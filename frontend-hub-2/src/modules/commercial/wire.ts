import type { Applicability, FacetCount, Rule } from "@itulah/contract"

/// What the commercial endpoints answer, declared here because nothing
/// generates it.
///
/// ## Why this file exists at all, when no other module has one
///
/// Every read in Finance and People is typed from `@itulah/contract`, which
/// `ts-rs` generates from the Rust struct the handler serialises. Fourteen of
/// the sixteen commercial GETs serialise no struct: they return
/// `Json<serde_json::Value>` built by a `json!` macro in
/// `cloud/postgres/{commercial,catalogue,performance}.rs`, so there is nothing
/// for `ts-rs` to generate from — not "nobody has run the generator", but
/// nothing to run it on.
///
/// So these interfaces are **transcribed from those literals and checked by
/// nothing.** If a key moves on the server this file goes stale silently and a
/// column reads `undefined`. That is the same exception `frontend-hub`'s
/// `lib/queries/commercial.ts` makes, and the same one `Attention` in
/// `modules/finance/overview.tsx` makes for `GET /finance/attention` — named
/// rather than hidden, because the reader is entitled to know which of the
/// types on a screen the compiler is actually holding.
///
/// **The vouchers are a different and better case.** `VoucherRow`,
/// `VoucherMovementRow`, `VoucherDetail`, `VoucherLedger` and `VoucherList`
/// are real Rust structs and they already carry
/// `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]` — the derive is
/// there and does nothing, because `backend/tests/contract_types.rs` never
/// names them, so `export_all` never reaches them and no `.ts` is written.
/// That is five lines in one test file plus `make contract` away from being
/// checked. Until somebody does it they are transcribed below like the rest,
/// and they are the ones to delete first.
///
/// ## What IS taken from the contract
///
/// `Rule`, and the `Applicability` inside it. `GET /commercial/rules` hands the
/// promotion document back through `canonical()` — it round-trips the stored
/// JSONB through `pricing_engine::Rule` before answering — so the document on
/// the wire is that struct's own serialisation and the generated type is the
/// right reading of it. A second, hand-written opinion about what a promotion
/// does is the one thing this module must not have.
///
/// The exception `canonical()` allows is worth knowing: a document this build
/// of the server cannot parse is **passed through as stored** and logged,
/// rather than dropped — right, because a promotion nobody can see is the one
/// nobody turns off. So `rule.scope`, `rule.conditions` and `rule.caps` are
/// typed as always present and can be absent at runtime for exactly those
/// rows. `labels.ts` reads all three through defaults for that reason.
///
/// Money is in minor units and stays an integer until it is drawn. For IDR
/// those are whole rupiah — see `lib/format.ts`, which has the scar.

// ── price books ────────────────────────────────────────────────────────────

/// `GET /api/v1/commercial/publications` → `{ items }`. No parameters, no cap,
/// newest version first.
export interface PriceBook {
  readonly id: string
  readonly version: number
  readonly name: string
  /// `DRAFT` or `PUBLISHED`. A draft book is authored, not running.
  readonly status: string
  readonly effective_from: string
  readonly effective_to: string | null
  readonly created_by: string
  readonly created_at: string
  readonly published_by: string | null
  readonly published_at: string | null
  readonly offer_count: number
}

// ── the three catalogue lists ──────────────────────────────────────────────

/// One shop that has put a book into service.
///
/// Reported by the shop itself, in the transaction that activated the book —
/// never ticked off by hand, so "published" and "in force" cannot drift.
export interface BookActivation {
  readonly origin_id: string
  readonly site_id: string | null
  readonly activated_at: string
  readonly reported_at: string
  /// How much of the book arrived. A truncated delivery shows here as a number
  /// rather than as a wrong price three weeks later.
  readonly price_rule_count: number
}

/// The book an offer arrived in, flattened onto every catalogue row.
///
/// Carried per row rather than fetched per book: "has this offer reached
/// anywhere" is asked of every row, and a second round trip to answer it is the
/// N+1 `catalogue.rs` was written to remove.
interface Carried {
  readonly publication_id: string
  readonly version: number
  readonly book_name: string
  readonly effective_from: string
  readonly effective_to: string | null
  readonly activated_by: readonly BookActivation[]
}

/// `GET /api/v1/commercial/rules` → `{ items, book_count }`.
export interface RuleRow extends Carried {
  readonly rule_id: string
  readonly name: string
  /// The column the server keeps beside the document, which is what its own
  /// queries read. `definition.status` is the engine's copy of the same fact.
  readonly status: string
  readonly priority: number
  readonly definition: Rule
}

/// `GET /api/v1/commercial/coupons` → `{ items, book_count }`.
///
/// Deliberately unfiltered by validity: a lapsed coupon is returned, because a
/// code that stopped working is exactly what somebody is looking for when they
/// come to this screen.
export interface CouponRow extends Carried {
  readonly code: string
  readonly rule_id: string
  readonly active: boolean
  /// Set when the coupon was issued to one named shopper.
  readonly customer_id: string | null
  readonly valid_from: string | null
  readonly valid_to: string | null
  readonly max_uses: number | null
}

/// `GET /api/v1/commercial/campaigns` → `{ items, book_count }`.
///
/// What a campaign has SPENT is not here — that is `/commercial/usage`, joined
/// by the caller. The limit is a decision frozen with the book that declared
/// it; the count is an observation that moves with every sale.
export interface CampaignRow extends Carried {
  readonly campaign_id: string
  readonly name: string
  readonly status: string
  readonly valid_from: string | null
  readonly valid_to: string | null
  readonly budget_minor: number | null
  readonly max_uses: number | null
  /// The poster a shop puts in front of a shopper — the only part of a price
  /// book a customer reads, and the only part still editable after
  /// publication. A typo in a banner must be fixable without cutting a book.
  readonly image_url: string | null
  readonly headline: string | null
  readonly terms: string | null
}

/// The envelope all three catalogue lists share.
///
/// `book_count` is the honest denominator rather than a cost: "no promotions,
/// from eleven books" and "no promotions, from none" look identical without it
/// and mean opposite things.
///
/// Note what is NOT here: no `next_cursor`, no `total`, and no `limit` on the
/// server side either. These three endpoints take no parameters and apply no
/// cap, so `items` is the whole set — which is why the screens can say so.
export interface Catalogue<Row> {
  readonly items: readonly Row[]
  readonly book_count: number
}

// ── what the offers have actually cost ─────────────────────────────────────

/// `GET /api/v1/commercial/usage` → `{ item_count, items }`. No parameters, no
/// cap, ordered by spend.
export interface UsageRow {
  readonly kind: "RULE" | "CAMPAIGN" | "COUPON"
  /// The rule id, campaign id or coupon code.
  readonly key: string
  readonly name: string | null
  readonly uses: number
  readonly spent_minor: number
  /// `null` is unlimited — which is not zero, and must never be drawn as a
  /// full meter or as an empty one.
  readonly budget_minor: number | null
  readonly max_uses: number | null
  readonly customer_count: number
  readonly first_used_at: string
  readonly last_used_at: string
}

export interface UsageList {
  readonly item_count: number
  readonly items: readonly UsageRow[]
}

// ── the pricelist ──────────────────────────────────────────────────────────

/// Which rung of the cascade a candidate was authored on.
///
/// `pricing_engine::PriceLevel`, which serde tags with `level` — so it arrives
/// as an OBJECT, not a string. It was once transcribed as `applies_to: string`
/// in the app this replaces and every reading of it rendered
/// `"[object Object]"`, which is the exact failure this file's header warns
/// about and the reason the shape is written out arm by arm here.
export type PriceLevel =
  | { readonly level: "COMPANY" }
  | { readonly level: "SITE_GROUP"; readonly site_ids: readonly string[] }
  | { readonly level: "SITE"; readonly site_id: string }

/// One distinct amount inside a candidate, and which products carry it.
///
/// A style can be priced per size, so a rung of the cascade covers a range
/// rather than a number, and somebody eventually asks which size is the
/// expensive one. The server answers that from the same rung it drew the range
/// from, so the breakdown can never disagree with the summary above it.
export interface PricePoint {
  readonly unit_price_minor: number
  readonly sku_codes: readonly string[]
  /// How many of those products this amount actually wins.
  readonly in_force_for: number
}

/// One rung of one shop's price stack for one style.
///
/// **`rank` is the engine's ranking, not a sort key.** Rank 0 is what the till
/// charges; the rest are the candidates it beat, and re-ordering them would be
/// a screen having a second opinion about a price — the failure the shared
/// pricing engine exists to prevent.
export interface PriceCandidate {
  readonly rank: number
  /// `SITE_PRICE`, `SITE_GROUP_PRICE`, `TIER_PRICE`, `COMPANY_PRICE` or
  /// `MARKDOWN`. One spelling, held equal to `PriceSource::as_str()` by a Rust
  /// test — it used to be two, and a shop rendered `COMPANY_PRICE` where the
  /// centre rendered `CompanyPrice`.
  readonly source: string
  readonly applies_to: PriceLevel
  readonly markdown_id: string | null
  readonly currency: string
  readonly publication_version: number
  readonly min_unit_price_minor: number
  readonly max_unit_price_minor: number
  readonly sku_count: number
  /// How many of the style's products this candidate actually wins. A shop
  /// price on one size beats the company price on that size alone, and the
  /// company rung is then in force for the rest — so a losing row can still be
  /// in force for two sizes out of five.
  readonly in_force_for: number
  readonly points: readonly PricePoint[]
  readonly effective_from: string
  readonly effective_to: string | null
}

export interface ShopStack {
  readonly site_id: string
  /// Always a string: the handler falls back to `site_id` when a shop has no
  /// label, so this is never null and never needs a fallback here.
  readonly label: string
  /// Empty stacks are not sent. A style absent from a shop cannot be sold
  /// there, and no price is not a price of zero.
  readonly stack: readonly PriceCandidate[]
}

export interface ArticlePriceRow {
  readonly article_code: string
  readonly article_name: string
  readonly image_url: string | null
  readonly division_code: string | null
  readonly tags: readonly string[]
  readonly sku_count: number
  readonly shops: readonly ShopStack[]
}

/// `GET /api/v1/commercial/article-prices` — the one endpoint on this surface
/// that narrows properly.
///
/// `channel` is REQUIRED; `q`, `divisions`, `tags`, `min_price` and `max_price`
/// all narrow on the server, and `divisions`/`tags` go on the wire as ONE
/// comma-joined string rather than as repeated keys. `limit` defaults to 200
/// and is clamped to 2.000.
///
/// It is still not an envelope: no `next_cursor`, and the rows are under
/// `items` rather than `rows`. So the screen reads it with `useReport` and
/// pages nothing.
export interface ArticlePrices {
  readonly channel: string
  /// The instant the whole answer was priced at. Everything below is true as
  /// at this moment and at no other — a screen that compares against the
  /// browser's clock instead is comparing two different questions.
  readonly as_of: string
  /// The shops the centre knows about, in label order. The grid's column model
  /// is DATA: it changes when the client opens a branch, and nothing in this
  /// module names a shop.
  readonly shops: readonly {
    readonly site_id: string
    readonly label: string
  }[]
  /// How many styles came back.
  readonly article_count: number
  /// How many styles the narrowing matches, before `limit` — **except the
  /// price bounds**, which are applied after pricing because a price is the
  /// answer rather than the question. So with `min_price` or `max_price` set
  /// this is a ceiling rather than a count of matches, and the screen says so.
  readonly total_article_count: number
  /// Counted over the whole catalogue rather than over what came back, so
  /// ticking a second box shows what it would ADD instead of reading zero.
  ///
  /// `FacetCount` is borrowed from the contract because the shape and the
  /// meaning are identical — `{ value, count }`. It is a borrowed type and not
  /// a checked one: the handler builds the literal rather than serialising the
  /// struct the contract was generated from.
  readonly facets?: {
    readonly divisions: readonly FacetCount[]
    readonly tags: readonly FacetCount[]
  }
  readonly items: readonly ArticlePriceRow[]
}

// ── vouchers ───────────────────────────────────────────────────────────────

/// `GET /api/v1/commercial/vouchers` → `{ vouchers, ledger }`.
///
/// Takes `status`, `kind`, `member_id`, `q` and `limit` — all narrowed on the
/// server, `q` over the code, the holder's name and the member id. `limit`
/// defaults to 200 and is clamped to 1.000. No cursor and no sort: the order
/// is `issued_at DESC, code` and there is no way to ask for another.
export interface VoucherRow {
  readonly voucher_id: string
  /// What is printed on the card, and what a shopper reads out. The routes are
  /// keyed on this rather than on the uuid for exactly that reason.
  readonly code: string
  /// `GIFT_CARD`, `REFUND` or `GOODWILL`. Not decoration: the accounting
  /// differs at the moment of issue — a gift card was paid for and is a
  /// liability, goodwill was given away and is an expense that day.
  readonly kind: string
  readonly currency: string
  /// The face value, frozen at issue.
  readonly issued_minor: number
  /// What is left. One card's worth of the shop's liability.
  readonly balance_minor: number
  /// Derived by the server, so `issued - balance` happens in one place rather
  /// than becoming a third number that can disagree with the two it came from.
  readonly spent_minor: number
  /// `ACTIVE`, `SPENT` or `VOIDED`. Expiry is deliberately not one of them.
  readonly status: string
  readonly member_id: string | null
  readonly member_name: string | null
  readonly expires_at: string | null
  /// Past its date with value still on it. Computed against the DATABASE's
  /// clock — a laptop with a wrong date must not be able to make a live card
  /// look dead.
  readonly expired: boolean
  readonly issued_at: string
  readonly issued_by: string
  readonly issued_site: string | null
  readonly note: string | null
  readonly version: number
  readonly movement_count: number
  readonly last_movement_at: string | null
}

export interface VoucherMovementRow {
  readonly movement_id: string
  readonly seq: number
  /// `ISSUE`, `REDEEM` or `VOID`.
  readonly kind: string
  /// Signed: issue adds, redeem and void subtract. So the movements sum to the
  /// balance, and the history reads as arithmetic rather than as a column of
  /// positives that happen to mean opposite things.
  readonly amount_minor: number
  readonly balance_after_minor: number
  readonly sale_id: string | null
  readonly site_id: string | null
  readonly actor: string
  readonly occurred_at: string
  readonly note: string | null
}

/// What the whole book of vouchers comes to — over EVERY voucher, never over
/// the filter.
///
/// That is the server's decision and it is worth restating, because a reader
/// assumes it the other way round: `outstanding_minor` is what the shop owes,
/// and a liability that moved because somebody typed in the search box is a
/// figure nobody could quote to an accountant.
export interface VoucherLedger {
  readonly issued_count: number
  readonly issued_minor: number
  readonly outstanding_count: number
  /// Every live voucher's remaining balance, expired ones included — an
  /// expired card is still money the shop is holding until somebody decides to
  /// write it off, and quietly excluding it would be the shop marking its own
  /// homework.
  readonly outstanding_minor: number
  readonly redeemed_minor: number
  /// Taken off cards that were stopped rather than spent. Kept apart from
  /// redemption because one is a customer being served and the other is a
  /// decision somebody made.
  readonly voided_minor: number
  readonly expired_count: number
  readonly expired_minor: number
}

export interface VoucherList {
  readonly vouchers: readonly VoucherRow[]
  readonly ledger: VoucherLedger
}

/// `GET /api/v1/commercial/vouchers/{code}` — one card and its whole history.
export interface VoucherDetail {
  readonly voucher: VoucherRow
  readonly movements: readonly VoucherMovementRow[]
}

/// Re-exported so a screen importing the rule vocabulary does not also have to
/// import the contract package to name the one type inside it that it touches.
export type { Applicability, Rule }
