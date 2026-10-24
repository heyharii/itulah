use crate::edge::domain::{
    validate_transition, MovementCause, MovementError, MovementLine, OperationalPool, SiteId,
    SubjectId,
};
use crate::sync::workflow::{FulfillmentStage, OfficialCountScope, PackageUnitAllocation};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EdgeRole {
    Dc,
    Store,
}

impl fmt::Display for EdgeRole {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Dc => "DC",
            Self::Store => "STORE",
        })
    }
}

impl FromStr for EdgeRole {
    type Err = EdgeError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().as_str() {
            "DC" => Ok(Self::Dc),
            "STORE" => Ok(Self::Store),
            _ => Err(EdgeError::Configuration(
                "edge role must be DC or STORE".into(),
            )),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NodeContext {
    pub node_id: String,
    pub role: EdgeRole,
    pub site_id: SiteId,
}

impl NodeContext {
    pub fn new(
        node_id: impl Into<String>,
        role: EdgeRole,
        site_id: SiteId,
    ) -> Result<Self, EdgeError> {
        // No check that the site id "looks like" the role: an id is a label
        // (owner, 2026-09-27), and what the site is comes from head office
        // (`edge::site_profile`). A pool's role is its role path, not its
        // site half (`domain::inventory::place`, `crate::pool_role`).
        let node_id = node_id.into();
        if node_id.trim().is_empty() {
            return Err(EdgeError::Configuration("node_id is required".into()));
        }
        Ok(Self {
            node_id,
            role,
            site_id,
        })
    }

    pub fn owns_pool(&self, pool: &OperationalPool) -> bool {
        pool.site_id() == &self.site_id
    }

    pub fn authorize_line(
        &self,
        cause: MovementCause,
        line: &MovementLine,
    ) -> Result<(), EdgeError> {
        validate_transition(cause, line)?;
        match (self.role, cause) {
            (EdgeRole::Dc, MovementCause::StoreReceive | MovementCause::Sale) => {
                return Err(EdgeError::Forbidden(
                    "DC Edge cannot receive Store inventory or complete a Store sale".into(),
                ));
            }
            (EdgeRole::Store, MovementCause::Opening) => {
                return Err(EdgeError::Forbidden(
                    "Store Edge receives directly into Store Warehouse; DC opening is not allowed"
                        .into(),
                ));
            }
            // Goods from suppliers are told apart and tagged where they are
            // received from suppliers, and a shop never deals with one. The
            // pools would once have refused it by their spelling; the role
            // says it now.
            (EdgeRole::Store, MovementCause::Identification | MovementCause::Tagging) => {
                return Err(EdgeError::Forbidden(
                    "Store Edge does not identify or tag supplier deliveries".into(),
                ));
            }
            // A shop keeps no other store's returns.
            (EdgeRole::Store, MovementCause::ReturnToWarehouse) => {
                return Err(EdgeError::Forbidden(
                    "Store Edge cannot book a store's return; the warehouse it went to does".into(),
                ));
            }
            _ => {}
        }
        for place in [&line.from, &line.to] {
            if let Some(pool) = place.pool() {
                if !self.owns_pool(pool) {
                    return Err(EdgeError::Forbidden(format!(
                        "node {} cannot mutate pool {} owned by {}",
                        self.node_id,
                        pool.id(),
                        pool.site_id()
                    )));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum EdgeError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("invalid request: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    /// Head office was asked and could not be reached, or answered that it
    /// could not. Its own variant because the remedy is different from every
    /// other failure here: nothing is wrong with the request or the node, the
    /// line is down, and the honest answer to the cashier is "this needs the
    /// connection".
    #[error("head office could not be reached: {0}")]
    Upstream(String),
    #[error("persistence failed: {0}")]
    Persistence(String),
}

impl From<MovementError> for EdgeError {
    fn from(error: MovementError) -> Self {
        Self::Validation(error.to_string())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IntakeRequest {
    pub epc: String,
    pub sku_code: String,
    pub unit_price_minor: i64,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// One SKU as the resident catalogue snapshot describes it.
///
/// `base_price_minor` is the floor the article was given at setup, not a shop's
/// published price. It is carried so a handheld can show a number where one
/// exists; a till must never read prices from here.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogIdentity {
    pub sku_code: String,
    pub name: String,
    pub article_code: Option<String>,
    pub division_code: Option<String>,
    pub barcode: Option<String>,
    pub base_price_minor: Option<i64>,
    pub tags: Vec<String>,
    pub active: bool,
    /// The article's photograph, when this node happens to hold one.
    ///
    /// The catalogue snapshot does NOT carry imagery — `catalog_item` has no
    /// such column — so this is recovered from the tagging job or purchase
    /// order line that brought the goods in. That covers exactly the articles
    /// this node has handled, which is the population a handheld ever scans,
    /// and is honestly null everywhere else rather than guessed from a URL
    /// pattern.
    pub image_url: Option<String>,
}

/// Which catalogue this node is holding, and nothing else.
///
/// The cheapest question in the system: a handheld that keeps the catalogue in
/// its own SQLite asks this on waking and compares the generation with what it
/// stored. Equal means the copy in its hand is the copy the node has, and it
/// pulls nothing.
///
/// `generation` is zero on a node that has never been sent a catalogue. That is
/// a real state — a shop is commissioned before the centre publishes to it —
/// and it is answered rather than refused, because a handheld has to be able to
/// tell "I have nothing" apart from "I could not ask".
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogSnapshotState {
    pub generation: i64,
    pub item_count: i64,
    pub content_hash: String,
    /// When this node swapped that generation in. `None` while there is no
    /// catalogue to have swapped.
    pub activated_at: Option<DateTime<Utc>>,
}

/// One SKU as a handheld's own copy of the catalogue keeps it.
///
/// Deliberately narrower than [`CatalogIdentity`]: no tags, and above all no
/// `image_url`. That field is not a column — it is recovered from tagging jobs
/// and order lines with two correlated subqueries per row, which is affordable
/// for the dozen SKUs on a rack and is not affordable for the whole catalogue
/// pulled down a shop's wifi. A scan screen shows a name, a size and a number;
/// the picture is fetched per article from `/api/v1/catalog/image` when
/// somebody actually looks at one.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogSnapshotItem {
    pub sku_code: String,
    pub name: String,
    pub article_code: Option<String>,
    pub division_code: Option<String>,
    pub barcode: Option<String>,
    pub base_price_minor: Option<i64>,
    pub active: bool,
}

/// One page of the catalogue, and which catalogue it came out of.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogSnapshotPage {
    pub items: Vec<CatalogSnapshotItem>,
    /// The last `sku_code` on this page, or `None` when the walk is finished.
    pub next_cursor: Option<String>,
    /// The generation these rows were read from.
    ///
    /// Repeated on every page, not just on the first. A pull of a few thousand
    /// SKUs over shop wifi takes long enough for a publication to land halfway
    /// through it, and the swap in `apply_catalog_chunk` is a whole-table
    /// replace: a handheld that began at generation 7 and reads 8 on a later
    /// page is holding rows from two different catalogues, spliced at a
    /// boundary nothing records. Carrying the generation per page is what lets
    /// it notice and start the walk again, instead of storing a mixture that
    /// looks complete.
    pub generation: i64,
}

/// Where to resume a catalogue walk, and how much to take.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct CatalogSnapshotQuery {
    /// Exclusive: the last `sku_code` the caller already has.
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// One garment inside a delivery.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiveLine {
    pub epc: String,
    pub sku_code: String,
    pub unit_price_minor: i64,
}

/// A whole delivery, received as the single event it actually is.
///
/// A handheld sweeping a pallet reads fifty tags in one pass. Sending fifty
/// requests turns one arrival into fifty transactions, fifty movement groups
/// and fifty round trips over shop wifi — slow enough that operators stop
/// waiting for it, and wrong in the ledger besides: the goods came off one
/// lorry, so they belong in one movement group. The lines travel together and
/// commit together.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiveBatchRequest {
    pub lines: Vec<ReceiveLine>,
    #[serde(default)]
    pub source_dc_id: Option<SiteId>,
    #[serde(default)]
    pub shipment_reference: Option<String>,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReceiveRequest {
    pub epc: String,
    pub sku_code: String,
    pub unit_price_minor: i64,
    pub source_dc_id: Option<SiteId>,
    pub shipment_reference: Option<String>,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveRequest {
    pub epc: String,
    #[serde(default = "one")]
    pub quantity: i64,
    pub from: String,
    pub to: String,
    #[serde(default = "normal_move")]
    pub cause: MovementCause,
    pub reason: String,
    pub actor_id: String,
    pub idempotency_key: String,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
}

/// `POST /api/v1/store/movements/by-sku`: move a number of pieces of one SKU
/// between two of this site's rooms without scanning them.
///
/// Staff on the Move stock screen pick an article, colour and size and type
/// how many; they do not hold a reader over each piece. Which pieces go is
/// the node's to choose (the oldest in the room first), so the request names
/// the SKU and the count, never an EPC.
///
/// `from` and `to` are place ids as [`MoveRequest`] takes them
/// (`store-01.floor:on_hand`), or the bare room — `floor`, `warehouse`,
/// `reject` — which means that room at this site, on hand.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveBySkuRequest {
    pub sku_code: String,
    pub quantity: i64,
    pub from: String,
    pub to: String,
    pub reason: String,
    /// Filled from the signed-in person; a body never gets to say who moved
    /// the goods.
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

const fn one() -> i64 {
    1
}

const fn normal_move() -> MovementCause {
    MovementCause::NormalMove
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct QuoteRequest {
    /// The tags on the counter. Scanned, so the same input the sale takes.
    pub epcs: Vec<String>,
    /// Codes the shopper has produced. A promotion gated by one stays shut
    /// until its code appears here — and a code refused is reported with a
    /// reason, never silently ignored.
    #[serde(default)]
    pub coupon_codes: Vec<String>,
    #[serde(default)]
    pub customer_id: Option<String>,
    /// Fees the counter is about to put on the bill. Quoted with the basket so
    /// the figure on screen is the figure the till will settle against — a
    /// preview that showed the goods and not the delivery is a preview that
    /// quotes a price the sale will not honour.
    #[serde(default)]
    pub charges: Vec<pricing_engine::Charge>,
    /// The holds head office granted for this basket's limited coupons, each
    /// relayed through this node (`/store/coupons/{code}/authorize`). A coupon
    /// with a cross-shop cap is priced only on one of these; a hold this node
    /// has no record of — or one already used, released or lapsed — is left
    /// out of the preview, and the coupon is reported as still needing one.
    #[serde(default)]
    pub coupon_authorizations: Vec<pricing_engine::CouponAuthorization>,
    /// The lines the till rings without a tag this shop holds — see
    /// [`UntaggedLine`]. Priced here exactly as the sale will price them, and
    /// each labelled in the answer's `untagged` so the till can say what it is.
    #[serde(default)]
    pub untagged: Vec<UntaggedLine>,
    /// Who is asking — set by the router from the session, never trusted from
    /// the body. Names the seat whose next transaction number the answer's
    /// `receipt_no` previews.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub actor_id: String,
}

/// A line the till rings that this shop's own stock cannot give it.
///
/// Owner, 23 Oct 2026: a piece the till cannot take from its own store's stock
/// still sells ("barang harus bisa dijual"), and the sale belongs to the store
/// where the shopper paid. Head office matches it later to a piece at a store
/// or at HO, and that piece leaves that place's stock. Nothing moves here: the
/// line is kept (`unmatched_sale_line`) and travels on the sale fact.
///
/// Three shapes, told apart by what is filled in:
///
/// * `sku_code` — typed off the label because the tag would not read: `NO_TAG`
///   when this shop holds at least one of that SKU on hand, `NOT_IN_STOCK` when
///   it holds none. Priced by the book like any line, promotions included.
/// * `epc` alone — a tag the till already knows is not held here: `OTHER`.
///   The node classifies `epcs` itself as well, so this is optional.
/// * neither — `UNKNOWN`: no tag, no SKU. The Kepala toko names it, prices it
///   and approves it once, at `POST /api/v1/store/unmatched/approve`, and the
///   line carries that approval (`approval_id`). Charged its given price,
///   outside promotions and points.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UntaggedLine {
    /// 11 digits, typed off the label.
    #[serde(default)]
    pub sku_code: Option<String>,
    #[serde(default)]
    pub epc: Option<String>,
    /// UNKNOWN only: what the Kepala toko called it.
    #[serde(default)]
    pub name: Option<String>,
    /// UNKNOWN only, and more than nought.
    #[serde(default)]
    pub unit_price_minor: Option<i64>,
    /// UNKNOWN only, and required at the sale: the Kepala toko's approval of
    /// this name at this price (`/store/unmatched/approve`). The sale spends it
    /// — one approval, one line — and a quote only prices the line.
    #[serde(default)]
    pub approval_id: Option<String>,
    /// Ignored. A finger's grant is single-use and short-lived, and the till
    /// quotes every couple of seconds, so the supervisor is verified once, at
    /// the approval, never on a quote or a sale.
    #[serde(default)]
    pub supervisor: Option<crate::edge::till::Supervisor>,
}

/// The Kepala toko approving one unknown item: its name and its price.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnknownItemApprovalRequest {
    pub name: String,
    pub unit_price_minor: i64,
    pub supervisor: crate::edge::till::Supervisor,
    /// Who asks: the signed-in cashier, filled by the node from the session,
    /// so the Kepala toko approving is somebody else
    /// (`till::verify_supervisor`).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(skip))]
    pub actor_id: String,
}

/// The approval a sale's UNKNOWN line carries as `approval_id`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnknownItemApproval {
    pub approval_id: String,
    /// The Kepala toko's username.
    pub approved_by: String,
    pub approved_by_name: String,
}

/// How the quote labels one unmatched line, so the till can show it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UntaggedQuoteLine {
    /// Its position in the request's `untagged`, or null for a tag in `epcs`
    /// this shop does not hold.
    pub index: Option<u32>,
    pub epc: Option<String>,
    /// `NO_TAG`, `NOT_IN_STOCK`, `OTHER` or `UNKNOWN`.
    pub kind: String,
    pub sku_code: Option<String>,
    /// The catalogue's name, or the Kepala toko's for an UNKNOWN line.
    pub name: Option<String>,
    /// Where an OTHER tag stands, when this node knows — "In transit" for one
    /// in a delivery on its way here. Null reads as "Luar toko".
    pub from_place: Option<String>,
    /// What the line comes to, promotions included.
    pub line_total_minor: i64,
}

/// Declaring a checkout before the money is asked for.
///
/// Carries what the till is ABOUT to do rather than what it did: the amount on
/// screen and the tenders it intends, each with the reference the operator will
/// use. None of it is a promise — the point is that a crash mid-payment leaves
/// behind a note saying what was being attempted and with which acquirer
/// references, which is the difference between a reconcilable charge and a
/// customer's word against the shop's.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BeginCheckoutRequest {
    /// The key the sale will be written under. The checkout and the sale share
    /// it so the two can be joined without a second identifier, and so a
    /// retried checkout finds its own row instead of opening a second attempt
    /// against the same basket.
    pub idempotency_key: String,
    pub actor_id: String,
    /// What is on screen. Held on the checkout as well as on the sale because
    /// during FINALIZING there is no sale to read it from.
    pub total_minor: i64,
    /// The tenders the operator is about to take, in order.
    pub tenders: Vec<crate::tender::SaleTender>,
    /// Why the basket came to this number, so the question can be answered at
    /// the counter and offline.
    #[serde(default)]
    pub pricing_trace_id: Option<String>,
}

/// What an acquirer said about one tender.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TenderOutcomeRequest {
    pub idempotency_key: String,
    /// Which tender, by its position in the checkout.
    pub tender_seq: i64,
    /// One of the five words in [`crate::checkout::TenderState`]. A word this
    /// build does not know is refused rather than stored, because an
    /// unrecognised status silently drops out of every "is this resolved?"
    /// test.
    pub status: String,
    /// What the acquirer calls it — the handle a shop needs when it rings up to
    /// ask whether the money went through.
    #[serde(default)]
    pub external_reference: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

/// Closing a checkout that did not become a sale.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ResolveCheckoutRequest {
    pub idempotency_key: String,
    /// `VOIDED` for a deliberate abandon, `FAILED` for one that broke. The
    /// distinction is not cosmetic: FAILED is a queue somebody works, and
    /// putting walk-aways in it means nobody works it.
    pub status: String,
    pub actor_id: String,
    #[serde(default)]
    pub last_error: Option<String>,
}

/// A checkout as it stands.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CheckoutResult {
    pub checkout_id: String,
    pub idempotency_key: String,
    pub status: String,
    pub total_minor: i64,
    /// The sale it became, once it has.
    pub sale_id: Option<String>,
    pub tenders: Vec<CheckoutTenderState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CheckoutTenderState {
    pub tender_seq: i64,
    pub method: String,
    pub amount_minor: i64,
    pub status: String,
    pub attempt_count: i64,
    pub external_reference: Option<String>,
    pub last_error: Option<String>,
}

/// One checkout that never finished, with the shape of the problem named.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnresolvedCheckout {
    pub checkout_id: String,
    pub idempotency_key: String,
    pub status: String,
    pub actor_id: String,
    pub total_minor: i64,
    pub opened_at: String,
    pub finalizing_at: Option<String>,
    /// What a person should do about it, from
    /// [`crate::checkout::recovery`] — whether anything was taken, whether an
    /// acquirer still has to be asked, and how much is held with no sale
    /// against it.
    pub recovery: String,
    /// Money the shop is holding for this checkout with no sale to show for it.
    pub money_held_minor: i64,
    pub tenders: Vec<CheckoutTenderState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleRequest {
    pub epcs: Vec<String>,
    /// How the shopper paid, in the order it was taken.
    ///
    /// A list rather than one cash figure. Half on a card and half in cash is
    /// an ordinary basket, and a till that could record only one of them either
    /// refuses the sale or misreports how it settled — and the misreport is the
    /// one that reaches the bank reconciliation, weeks later, as a difference
    /// nobody can trace.
    ///
    /// Order matters only as identity: a tender has no natural id, so its
    /// position keys it, and a fact delivered twice overwrites rather than
    /// records the payment again.
    pub tenders: Vec<crate::tender::SaleTender>,
    pub actor_id: String,
    pub idempotency_key: String,
    /// Codes the shopper presented. A promotion gated by a coupon stays shut
    /// until its code appears here.
    #[serde(default)]
    pub coupon_codes: Vec<String>,
    /// Fees on this bill that are not goods — delivery, service, wrapping.
    ///
    /// Sent with the sale rather than added to a total, because the engine is
    /// what keeps them out of the promotions, the thresholds and the points.
    /// A caller that folded a delivery fee into a line price would get a
    /// discount on the courier and loyalty points for the ride.
    #[serde(default)]
    pub charges: Vec<pricing_engine::Charge>,
    /// The shopper, when they are known. Needed for a coupon issued to one
    /// person, and for a per-customer usage limit.
    #[serde(default)]
    pub customer_id: Option<String>,
    /// The holds head office granted for this basket's limited coupons — the
    /// same list the quote was given. Unlike the quote, a sale REFUSES a hold
    /// this node cannot vouch for rather than quietly pricing without it: the
    /// till showed the shopper a total with the coupon in it, and charging a
    /// different one without saying so is the worse outcome. Each hold the
    /// sale actually used is spent here and travels on the sale fact
    /// (`promotions[].coupon_authorization_id`), where head office commits it.
    #[serde(default)]
    pub coupon_authorizations: Vec<pricing_engine::CouponAuthorization>,
    /// The lines this shop's stock cannot give — see [`UntaggedLine`]. A tag in
    /// `epcs` this shop does not hold joins them on its own (`OTHER`) rather
    /// than refusing the sale.
    #[serde(default)]
    pub untagged: Vec<UntaggedLine>,
    /// When the till rang it, by the till's clock (24 Oct 2026). A sale that
    /// waited in a till's outbox reaches this node after it was rung — after
    /// head office stopped the till, say — and is judged by when it was rung,
    /// not when it arrived (`pos_stop::refuse_selling`). Absent from a till
    /// that sends at once; one no till could mean is not believed
    /// (`sqlite::rung_at`).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub taken_at: Option<DateTime<Utc>>,
}

/// Quantity-only DC Pick. The server assigns this quantity to accepted
/// Allotment lines in deterministic FIFO order; callers cannot choose a line
/// or supply an EPC before Pack.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PickRequest {
    pub source_pool_id: String,
    pub sku_code: String,
    pub quantity: i64,
    pub actor_id: String,
    pub idempotency_key: String,
    /// The round this pick belongs to. Optional: a picker fetching one thing
    /// off a rack without opening a session is ordinary, and refusing it would
    /// make the paperwork the point instead of the goods.
    #[serde(default)]
    pub pick_session_id: Option<String>,
    /// The shop this pick is for (owner, 29 Sep 2026: one picklist per
    /// shop). When set, the pick is held to what THAT shop is still owed,
    /// less what already waits in the pick area for it. `None` is a pick for
    /// nobody in particular, as every pick used to be.
    #[serde(default)]
    pub destination_id: Option<String>,
    /// The allotment this pick answers, with `destination_id`: held to that
    /// allotment's lines for that shop as well as to the shop as a whole.
    #[serde(default)]
    pub allotment_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PickResult {
    pub pick_id: Uuid,
    pub source_site_id: String,
    pub source_pool_id: String,
    pub sku_code: String,
    pub quantity: i64,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
}

/// Raise a picklist: one trip round the racks, written down before it is walked.
///
/// The picks inside it are the same picks a handheld makes one at a time —
/// same event, same movement, same pool. What this adds is the DOCUMENT: a
/// round somebody can be handed, read back, and find again tomorrow. Before
/// it, a picking round was a session that existed only if a person remembered
/// to open one, and the sheet they worked from was recomputed under them as
/// they walked.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePicklistRequest {
    /// The rack the goods come off. One per picklist: a round is a walk
    /// through one place, and a sheet spanning two of them is two sheets.
    pub source_pool_id: String,
    pub lines: Vec<PickLine>,
    pub actor_id: String,
    pub note: Option<String>,
    pub idempotency_key: String,
    /// The shop the round is walked for. A picklist is per shop since the
    /// owner's ruling of 29 Sep 2026, so packing can take a shop's carton
    /// straight off its picklist. Optional on the wire for older callers.
    #[serde(default)]
    pub destination_id: Option<String>,
    /// The allotment the round answers. A picklist exists per allotment ×
    /// shop (owner, 29 Sep 2026); accepting one sends both.
    #[serde(default)]
    pub allotment_id: Option<String>,
}

/// How much of one SKU this round is meant to fetch.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PickLine {
    pub sku_code: String,
    pub quantity: i64,
}

/// What the round actually came back with, and what it could not.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PicklistResult {
    pub summary: super::outbound::PickSessionSummary,
    /// The lines the racks did not answer. Reported rather than swallowed: a
    /// picklist that quietly came back two lines short is a shop short two
    /// lines, found out at the box.
    pub refused: Vec<PicklistRefusal>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PicklistRefusal {
    pub sku_code: String,
    pub quantity: i64,
    /// The node's own words, not a code. There is one caller and it shows this
    /// to the person holding the trolley.
    pub reason: String,
}

/// RFID Pack request. A package has one destination Store, while its EPCs may
/// be attributed to many FIFO-picked Allotment lines.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PackKoliRequest {
    pub destination_store_id: String,
    pub epcs: Vec<String>,
    pub actor_id: String,
    pub idempotency_key: String,
    /// Draw these allotments' lines first, then the rest oldest first. Set
    /// when a carton is packed from picklists that each answer an allotment,
    /// so the pieces count against the allotment they were picked for.
    #[serde(default)]
    pub prefer_allotment_ids: Vec<String>,
}

/// Pack a carton by SAYING HOW MUCH, rather than by scanning each piece.
///
/// The EPC request above is the same act described by a reader: a packer
/// sweeps a box and the tags name themselves. This one is the act described by
/// a person — "eight of this, three of that, for shop 04" — and the server
/// chooses which physical pieces answer to it, FIFO out of the picking area,
/// exactly as picking chooses which garments come off a rack.
///
/// Both end in the same movement and the same koli. What differs is who names
/// the units, and that is a question about the equipment on the bench, not
/// about what packing means.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PackRequest {
    pub destination_store_id: String,
    pub lines: Vec<PackLine>,
    pub actor_id: String,
    pub idempotency_key: String,
    /// Seal the carton as part of packing it.
    ///
    /// True is the ordinary case for a bench with no reader: the box is filled
    /// from a sheet in one act, and leaving it open would be leaving it open
    /// for nothing. False leaves it fillable, which is what a second pack into
    /// the same carton would need.
    #[serde(default)]
    pub seal: bool,
    /// Pack from these picklists: the pieces are the ones they moved into
    /// the pick area, and the destination is the shop they were walked for —
    /// all the same shop. A packer gathers a shop's picklists, one per
    /// allotment, into its cartons (owner, 29 Sep 2026). No reader involved:
    /// the picklists already say what the pieces are. Empty = pack from the
    /// whole pick area, as before.
    #[serde(default)]
    pub pick_session_ids: Vec<String>,
}

/// How much of one SKU goes in the box.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PackLine {
    pub sku_code: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateKoliShipmentRequest {
    pub shipment_reference: String,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// Dispatch: sealed cartons onto one trip, in one act.
///
/// Owner, 29 Sep 2026: there is no Shipments station. Dispatch makes one
/// surat jalan per shop out of the cartons ticked, puts them on one trip, and
/// the goods are in transit — generating the surat jalan IS sending it. What
/// the bay knows about the trip (plate, driver, courier, anything) is one
/// free-text note rather than fields nobody fills in the same way twice.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DispatchTripRequest {
    pub koli_ids: Vec<String>,
    #[serde(default)]
    pub trip_note: Option<String>,
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AdvanceKoliRequest {
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FulfillmentProgressResult {
    pub progress_id: Uuid,
    pub koli_id: Uuid,
    pub source_site_id: String,
    pub destination_store_id: String,
    pub stage: FulfillmentStage,
    pub shipment_reference: Option<String>,
    pub movement_group_id: Uuid,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
    pub units: Vec<PackageUnitAllocation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommandResult {
    pub movement_group_id: Uuid,
    pub movement_count: usize,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleResult {
    pub sale_id: Uuid,
    /// The GOODS. Unchanged in meaning by the arrival of fees, so nothing that
    /// already reads it started counting a courier the day delivery shipped.
    pub total_minor: i64,
    /// The fees on this bill, which are not goods — see
    /// `pricing_engine::Charge`. Nought when none were put on it.
    #[serde(default)]
    pub charge_total_minor: i64,
    /// What the shopper owed: `total_minor + charge_total_minor`. **The figure
    /// the tender was measured against**, and the one a receipt totals to.
    ///
    /// Held as its own field rather than left to a caller's addition, because
    /// the caller that forgets is a till that hands the goods over with the
    /// delivery uncollected — and its drawer balances, because it never asked.
    #[serde(default)]
    pub amount_due_minor: i64,
    pub paid_minor: i64,
    pub change_minor: i64,
    pub movement_group_id: Uuid,
    pub completed_at: DateTime<Utc>,
    /// What the promotions did, and what they did not do. A cashier asked "why
    /// didn't the discount come off" has the answer on the same response that
    /// completed the sale.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub promotions: Vec<super::pricing::PromotionOutcome>,
    /// Items a promotion says the shopper is owed.
    ///
    /// Reported, never conjured. Every unit that leaves this shop leaves by
    /// having its tag scanned, so a free shirt has to be scanned like any
    /// other — otherwise the stock would say it is still on the shelf. The
    /// till's job is to prompt for it, not to invent it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub granted_lines: Vec<super::pricing::GrantedLine>,
    #[serde(default)]
    pub points_earned: i64,
    /// The 7-letter transaction number (client, 23 Oct 2026): the store's two
    /// letters, the till's letter, and the till's own running number scrambled
    /// into four letters (`till::allocate_receipt`). Empty on a reply saved
    /// before it existed.
    #[serde(default)]
    pub receipt_no: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoolBalance {
    pub pool_id: String,
    pub site_id: SiteId,
    pub stock: i64,
    /// What this pool still has to put into cartons. `None` on a pool that
    /// cannot be a source of one — the shared picking area carries no store
    /// attribution, so it has no answer rather than nought.
    pub allotted: Option<i64>,
    /// What may still be spent out of this pool, and never below nought.
    pub on_hand: i64,
    /// How far the promises against this pool outrun what is in it. The
    /// warehouse used to refuse to report at all when this went positive,
    /// which took the whole pool list down with it.
    pub shortfall: i64,
    pub missing: i64,
}

/// One SKU's spendable units at this site, split by the room they stand in.
///
/// Spendable means on hand less what this site has already promised to send
/// away, never below nought. Which pool is which room is
/// [`sku_stock_pools`]'s to say.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SkuStockRow {
    pub sku_code: String,
    pub floor: i64,
    pub warehouse: i64,
    /// `floor + warehouse`. Rejects are not stock a shopper can be sold.
    pub total: i64,
    /// On hand in this site's reject room. Shown beside the two rooms so the
    /// Move stock screen can say what is already set aside; never part of
    /// `total`, and nothing is promised out of it.
    #[serde(default)]
    pub reject: i64,
    /// To be returned · Over delivery (0986): what MD sent back from a
    /// delivery, waiting for the shop to send. Never in `total`.
    #[serde(default)]
    pub over_delivery: i64,
    /// To be returned · Return HO (0986): what HO moved off the shelves,
    /// waiting for the shop to send. Never in `total`.
    #[serde(default)]
    pub return_ho: i64,
}

/// `GET /api/v1/inventory/sku-stock`: every SKU with spendable units here,
/// or with pieces in the reject room.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SkuStock {
    pub as_of: DateTime<Utc>,
    pub items: Vec<SkuStockRow>,
}

/// The two rooms a SKU's stock is split into, as `(floor, warehouse)`.
///
/// - FLOOR is `{site}.floor` ([`OperationalPool::StoreFloor`], role `Floor`):
///   the selling floor. It is the pool a sale moves goods out of, so it is
///   what a shopper can pick up now.
/// - WAREHOUSE is `{site}.warehouse` ([`OperationalPool::Stockroom`], role
///   `Stockroom`): at a shop, the back room (gudang). The same pool at the
///   Gudang is its racks, which is why a DC answers with a floor of nought.
///
/// `{site}.reject`, returns and the outbound stages are in neither: none of
/// them can be sold from this shop.
pub fn sku_stock_pools(site_id: &SiteId) -> (OperationalPool, OperationalPool) {
    (
        OperationalPool::StoreFloor {
            store_id: site_id.clone(),
        },
        OperationalPool::Stockroom {
            site_id: site_id.clone(),
        },
    )
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MovementView {
    pub movement_id: Uuid,
    pub movement_group_id: Uuid,
    pub subject_id: SubjectId,
    pub epc: String,
    pub quantity: i64,
    pub from: String,
    pub to: String,
    pub cause: MovementCause,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OfficialCountEntryInput {
    pub epc: String,
    pub sku_code: String,
    pub found_quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OfficialCountEntriesRequest {
    pub entries: Vec<OfficialCountEntryInput>,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OfficialCountSubmitRequest {
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeOfficialCountLine {
    pub epc: String,
    pub sku_code: String,
    pub expected_quantity: i64,
    pub found_quantity: i64,
    pub adjustment_quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeOfficialCountSummary {
    pub count_id: Uuid,
    pub site_id: String,
    pub pool_id: String,
    pub kind: String,
    pub status: String,
    pub reason: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub activated_at: DateTime<Utc>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub scope: OfficialCountScope,
    pub result_id: Option<Uuid>,
    pub adjustment_id: Option<Uuid>,
    pub adjustment_status: Option<String>,
    pub adjustment_completion_id: Option<Uuid>,
    pub movement_group_ids: Vec<Uuid>,
    pub expected: i64,
    pub found: i64,
    pub match_epcs: i64,
    pub shortage_epcs: i64,
    pub gain_epcs: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdgeOfficialCountDetail {
    pub summary: EdgeOfficialCountSummary,
    pub lines: Vec<EdgeOfficialCountLine>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OfficialCountSubmitResult {
    pub count_id: Uuid,
    pub result_id: Uuid,
    pub status: String,
    pub submitted_at: DateTime<Utc>,
    pub lines: Vec<EdgeOfficialCountLine>,
}

pub trait EdgeInventory: Send + Sync {
    fn node(&self) -> &NodeContext;
    /// The business clock this node stamps with, as the shared handle.
    ///
    /// The routers hold the same `Arc` the inventory does, so the control
    /// endpoint moves the one clock every sale, shift and count reads — two
    /// handles would answer two different "now"s (VIRTUAL-TIME-PLAN.md §3).
    fn clock(&self) -> std::sync::Arc<crate::clock::ClockHandle>;
    /// Queue one label per EPC of a tagging job that has already landed here.
    fn open_print_session(
        &self,
        request: super::printing::OpenPrintSessionRequest,
    ) -> Result<super::printing::PrintSessionSummary, EdgeError>;
    /// Claim the next chunk, hand it to the printer, record what happened.
    /// Called repeatedly until nothing is pending.
    fn run_print_chunk(
        &self,
        session_id: &str,
    ) -> Result<super::printing::PrintChunkReport, EdgeError>;
    fn print_session(
        &self,
        session_id: &str,
    ) -> Result<super::printing::PrintSessionSummary, EdgeError>;
    /// The run a tagging job already has, if any. A print run outlives the
    /// screen that opened it, and a job is refused a second one.
    fn job_print_session(
        &self,
        job_id: &str,
    ) -> Result<Option<super::printing::PrintSessionSummary>, EdgeError>;
    /// Draw one of a job's labels without printing it. A read: nothing is
    /// claimed, no socket is opened, and calling it twice costs a ribbon
    /// nothing.
    fn preview_job_label(
        &self,
        job_id: &str,
        request: &super::printing::LabelPreviewRequest,
    ) -> Result<super::printing::LabelPreview, EdgeError>;
    /// Point a run at the printer in front of whoever picked it up.
    fn repoint_print_session(
        &self,
        session_id: &str,
        request: super::printing::RepointPrinterRequest,
    ) -> Result<super::printing::PrintSessionSummary, EdgeError>;
    /// Put labels that already printed back in the queue, keeping their EPCs.
    fn reprint_labels(
        &self,
        session_id: &str,
        request: super::printing::ReprintRequest,
    ) -> Result<super::printing::PrintSessionSummary, EdgeError>;

    // Outbound containment: koli, shipment, dispatch, and the sessions that
    // produce them. Position is derived from containment, never stored.
    fn open_outbound_session(
        &self,
        kind: super::outbound::SessionKind,
        request: super::outbound::OpenSessionRequest,
    ) -> Result<super::outbound::Session, EdgeError>;
    fn close_outbound_session(
        &self,
        kind: super::outbound::SessionKind,
        session_id: &str,
    ) -> Result<super::outbound::Session, EdgeError>;
    fn assign_koli_to_session(
        &self,
        koli_id: &str,
        session_id: &str,
    ) -> Result<super::outbound::Koli, EdgeError>;
    fn seal_koli(
        &self,
        koli_id: &str,
        sealed_by: &str,
    ) -> Result<super::outbound::KoliManifest, EdgeError>;
    fn open_packing_box(
        &self,
        request: super::outbound::OpenPackingBoxRequest,
    ) -> Result<super::outbound::PackingBox, EdgeError>;
    fn packing_box(&self, session_id: &str) -> Result<super::outbound::PackingBox, EdgeError>;
    fn open_packing_boxes(&self) -> Result<Vec<super::outbound::PackingBox>, EdgeError>;
    fn box_candidates(&self, session_id: &str)
        -> Result<super::outbound::BoxCandidates, EdgeError>;
    fn outstanding_for_destination(
        &self,
        destination_store_id: &str,
    ) -> Result<Vec<super::outbound::OutstandingLine>, EdgeError>;
    fn capture_packing_box(
        &self,
        session_id: &str,
        reader_session_id: &str,
        actor_id: &str,
    ) -> Result<super::outbound::CaptureOutcome, EdgeError>;
    fn koli_manifest(&self, koli_id: &str) -> Result<super::outbound::KoliManifest, EdgeError>;
    fn print_koli_label(
        &self,
        koli_id: &str,
        request: super::outbound::PrintKoliLabelRequest,
    ) -> Result<super::outbound::KoliManifest, EdgeError>;
    fn create_shipment(
        &self,
        request: super::outbound::CreateShipmentRequest,
    ) -> Result<super::outbound::Shipment, EdgeError>;
    fn create_dispatch(
        &self,
        request: super::outbound::CreateDispatchRequest,
    ) -> Result<super::outbound::Dispatch, EdgeError>;
    fn depart_dispatch(&self, dispatch_id: &str) -> Result<super::outbound::Dispatch, EdgeError>;
    fn picklist(&self) -> Result<Vec<super::outbound::PicklistLine>, EdgeError>;
    /// Every picklist still to pick, one per allotment × shop — see
    /// [`super::outbound::picklists_to_pick`].
    fn picklists_to_pick(&self) -> Result<Vec<super::outbound::AllotmentPick>, EdgeError>;
    /// The Gudang takes its own work back: Packed → Picked, Packed → To pick,
    /// Picked → To pick. Never from a carton on a trip.
    fn move_back(
        &self,
        request: super::outbound::MoveBackRequest,
    ) -> Result<super::outbound::MoveBackResult, EdgeError>;
    /// A picker says why a line could not be finished.
    fn report_short_pick(
        &self,
        request: super::outbound::ReportShortPickRequest,
    ) -> Result<super::outbound::ShortPick, EdgeError>;
    fn short_picks(&self) -> Result<Vec<super::outbound::ShortPick>, EdgeError>;
    /// Sealed cartons onto a trip: surat jalan per shop, in transit. See
    /// [`DispatchTripRequest`].
    fn dispatch_trip(
        &self,
        request: DispatchTripRequest,
    ) -> Result<super::outbound::DispatchDetail, EdgeError>;
    fn list_koli(
        &self,
        filter: super::outbound::ListFilter,
    ) -> Result<Vec<super::outbound::Koli>, EdgeError>;
    fn list_shipments(
        &self,
        filter: super::outbound::ListFilter,
    ) -> Result<Vec<super::outbound::Shipment>, EdgeError>;
    fn list_dispatches(
        &self,
        filter: super::outbound::ListFilter,
    ) -> Result<Vec<super::outbound::Dispatch>, EdgeError>;
    fn list_outbound_sessions(
        &self,
        kind: super::outbound::SessionKind,
        filter: super::outbound::ListFilter,
    ) -> Result<Vec<super::outbound::Session>, EdgeError>;
    fn shipment_detail(
        &self,
        shipment_id: &str,
    ) -> Result<super::outbound::ShipmentDetail, EdgeError>;
    fn dispatch_detail(
        &self,
        dispatch_id: &str,
    ) -> Result<super::outbound::DispatchDetail, EdgeError>;
    fn packing_session_summary(
        &self,
        session_id: &str,
    ) -> Result<super::outbound::PackingSessionSummary, EdgeError>;
    fn pick_session_summary(
        &self,
        session_id: &str,
    ) -> Result<super::outbound::PickSessionSummary, EdgeError>;
    /// Every shop this DC still owes something to — see
    /// [`super::outbound::destinations_owed`].
    fn destinations_owed(&self) -> Result<Vec<super::outbound::DestinationDemand>, EdgeError>;
    /// Every picklist this DC has raised — see [`super::outbound::list_picklists`].
    fn list_picklists(&self) -> Result<Vec<super::outbound::PicklistSummary>, EdgeError>;
    fn allotment_line_position(
        &self,
        allotment_line_id: &str,
    ) -> Result<super::outbound::LinePosition, EdgeError>;
    fn intake_dc(&self, request: IntakeRequest) -> Result<CommandResult, EdgeError>;
    fn pick_stock(&self, request: PickRequest) -> Result<PickResult, EdgeError>;
    /// Raise a whole picklist in one act — see [`CreatePicklistRequest`].
    fn create_picklist(&self, request: CreatePicklistRequest) -> Result<PicklistResult, EdgeError>;
    fn pack_koli(&self, request: PackKoliRequest) -> Result<FulfillmentProgressResult, EdgeError>;
    /// Pack a carton from quantities, letting the server name the pieces.
    /// See [`PackRequest`].
    fn pack_by_quantity(
        &self,
        request: PackRequest,
    ) -> Result<super::outbound::KoliManifest, EdgeError>;
    fn create_fulfillment_shipment(
        &self,
        koli_id: Uuid,
        request: CreateKoliShipmentRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError>;
    fn dispatch_koli(
        &self,
        koli_id: Uuid,
        request: AdvanceKoliRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError>;
    fn mark_fulfillment_in_transit(
        &self,
        koli_id: Uuid,
        request: AdvanceKoliRequest,
    ) -> Result<FulfillmentProgressResult, EdgeError>;
    fn receive_store(&self, request: ReceiveRequest) -> Result<CommandResult, EdgeError>;

    /// Receive a whole delivery in one transaction — see [`ReceiveBatchRequest`].
    fn receive_store_batch(&self, request: ReceiveBatchRequest)
        -> Result<CommandResult, EdgeError>;

    /// Deliveries head office announced to this shop — blind while in
    /// transit. See [`super::inbound`]. `status` is `IN_TRANSIT`, `RECEIVED`
    /// or `ALL` (the default).
    /// The returns Merchandise asked this shop for — see
    /// [`super::store_returns`].
    fn store_return_asks(&self) -> Result<super::store_returns::StoreReturnList, EdgeError> {
        Err(EdgeError::Forbidden(
            "a shop's returns are kept by the SQLite edge".into(),
        ))
    }
    /// What this shop counted that it could not book, until MD answers —
    /// see [`super::inbound::StoreOnHoldList`].
    fn store_on_hold(&self) -> Result<super::inbound::StoreOnHoldList, EdgeError> {
        Err(EdgeError::Forbidden(
            "announced deliveries are only available on Store Edge".into(),
        ))
    }
    fn store_inbound_list(
        &self,
        _status: Option<&str>,
    ) -> Result<super::inbound::StoreInboundList, EdgeError> {
        Err(EdgeError::Forbidden(
            "announced deliveries are only available on Store Edge".into(),
        ))
    }
    fn store_inbound_detail(
        &self,
        _delivery_id: &str,
    ) -> Result<super::inbound::StoreInboundDetail, EdgeError> {
        Err(EdgeError::Forbidden(
            "announced deliveries are only available on Store Edge".into(),
        ))
    }
    /// The delivery a scanned koli label or surat jalan opens.
    fn store_inbound_scan(
        &self,
        _code: &str,
    ) -> Result<super::inbound::StoreInboundScan, EdgeError> {
        Err(EdgeError::Forbidden(
            "announced deliveries are only available on Store Edge".into(),
        ))
    }
    /// Receive an announced delivery from what the handheld read, in one
    /// transaction, and answer with the comparison.
    fn receive_store_inbound(
        &self,
        _delivery_id: &str,
        _request: super::inbound::StoreInboundReceiveRequest,
    ) -> Result<super::inbound::StoreInboundDetail, EdgeError> {
        Err(EdgeError::Forbidden(
            "announced deliveries are only available on Store Edge".into(),
        ))
    }
    /// Receive an announced delivery from a blind count per SKU, no reader —
    /// see [`super::inbound::StoreInboundCountRequest`].
    fn receive_store_inbound_by_count(
        &self,
        _delivery_id: &str,
        _request: super::inbound::StoreInboundCountRequest,
    ) -> Result<super::inbound::StoreInboundDetail, EdgeError> {
        Err(EdgeError::Forbidden(
            "announced deliveries are only available on Store Edge".into(),
        ))
    }
    /// The goods flows touching this site, as head office last described them
    /// (`super::flows`). `open`: only those still running.
    fn flow_notices(&self, _open: bool) -> Result<super::flows::FlowNoticeList, EdgeError> {
        Err(EdgeError::Forbidden(
            "goods-flow notices are kept by the SQLite edge".into(),
        ))
    }
    /// A store's returns received here with units still waiting to be inspected.
    fn return_inspections(&self) -> Result<super::flows::ReturnInspectionList, EdgeError> {
        Err(EdgeError::Forbidden(
            "return inspection is kept by the SQLite edge".into(),
        ))
    }
    /// One received return and its units still waiting to be inspected.
    fn return_inspection(
        &self,
        _delivery_id: &str,
    ) -> Result<super::flows::ReturnInspectionDetail, EdgeError> {
        Err(EdgeError::Forbidden(
            "return inspection is kept by the SQLite edge".into(),
        ))
    }
    /// Inspect a received return: good goods to the racks, damaged to reject.
    fn inspect_return(
        &self,
        _delivery_id: &str,
        _request: super::flows::InspectReturnRequest,
    ) -> Result<super::flows::InspectReturnResult, EdgeError> {
        Err(EdgeError::Forbidden(
            "return inspection is kept by the SQLite edge".into(),
        ))
    }
    fn move_stock(&self, request: MoveRequest) -> Result<CommandResult, EdgeError>;
    /// Move `quantity` pieces of one SKU between two rooms, the node choosing
    /// which pieces. One movement group, one line per piece.
    fn move_stock_by_sku(&self, request: MoveBySkuRequest) -> Result<CommandResult, EdgeError>;
    /// Write down a checkout BEFORE asking anybody for money.
    ///
    /// Separate from [`complete_sale`](Self::complete_sale) because the money
    /// has already moved by the time that is called: the card terminal is
    /// driven by the till in front of the operator, and `complete_sale` is the
    /// "write it down" step afterwards. Folding the declaration into it would
    /// declare the attempt after the risk had passed, which is no declaration
    /// at all.
    ///
    /// Commits on its own, which is the point — the row has to survive the
    /// process that is about to talk to a terminal and may not come back.
    fn begin_checkout(&self, request: BeginCheckoutRequest) -> Result<CheckoutResult, EdgeError>;

    /// Record what an acquirer said about one tender.
    ///
    /// Keyed by position, so a retried answer updates the tender it already has
    /// rather than writing a second one — a second row here would be a second
    /// charge in every report that sums them.
    fn record_tender_outcome(
        &self,
        request: TenderOutcomeRequest,
    ) -> Result<CheckoutResult, EdgeError>;

    /// Checkouts that never reached an end state, oldest first.
    ///
    /// The query a till runs when it starts. An empty answer is the ordinary
    /// case; a non-empty one is money that may be in hand with no sale against
    /// it, and it is work for a person.
    fn unresolved_checkouts(&self) -> Result<Vec<UnresolvedCheckout>, EdgeError>;

    /// Close an unresolved checkout that did not become a sale.
    ///
    /// Refuses while any tender is still unanswered: voiding a checkout whose
    /// card is still in flight abandons money that may land a minute later.
    fn resolve_checkout(
        &self,
        request: ResolveCheckoutRequest,
    ) -> Result<CheckoutResult, EdgeError>;

    fn complete_sale(&self, request: SaleRequest) -> Result<SaleResult, EdgeError>;
    /// Write down a voucher hold head office just granted through this node's
    /// relay. A VOUCHER tender may spend only a hold recorded here — see
    /// `migrations/sqlite/0044`.
    fn record_voucher_hold(&self, hold: VoucherHoldRecord) -> Result<(), EdgeError>;
    /// A hold head office released (the basket was abandoned) or committed
    /// directly: it can no longer be spent at this till.
    fn close_voucher_hold(&self, code: &str, checkout_id: &str) -> Result<(), EdgeError>;
    /// Write down a limited-coupon hold head office just granted through this
    /// node's relay. A quote or sale may lean only on a hold recorded here —
    /// see `migrations/sqlite/0078`.
    fn record_coupon_hold(&self, hold: CouponHoldRecord) -> Result<(), EdgeError>;
    /// A coupon hold head office released (the basket was abandoned): no quote
    /// or sale at this till may lean on it any more.
    fn close_coupon_hold(&self, code: &str, checkout_id: &str) -> Result<(), EdgeError>;
    fn list_pools(&self) -> Result<Vec<PoolBalance>, EdgeError>;
    /// Spendable units per SKU on the floor and in the warehouse, for every
    /// SKU with any. See [`sku_stock_pools`] for which pool is which.
    fn sku_stock(&self) -> Result<Vec<SkuStockRow>, EdgeError>;
    /// Who these SKUs are, without pricing them.
    ///
    /// A DC has no catalogue in the selling sense — it does not sell, so it has
    /// no price book, and `store_catalog` rightly refuses there. But every node
    /// carries the catalogue SNAPSHOT, because identity travels with the goods:
    /// a picker sweeping a rack needs to read "Sonny Denim, Indigo, M" off a
    /// tag whether or not anything in the building has a price. This answers
    /// that question and only that question, at any node.
    fn catalog_identities(&self, sku_codes: &[String]) -> Result<Vec<CatalogIdentity>, EdgeError>;

    /// Which catalogue this node is holding — one row, no items.
    ///
    /// `catalog_identities` answers about SKUs a handheld has just read off
    /// tags; this answers about the catalogue itself, so a handheld holding its
    /// own copy can decide in one small request whether that copy is still the
    /// current one. Answered at any node role, for the same reason identities
    /// are: a DC has no price book and still holds the snapshot.
    fn catalog_snapshot_state(&self) -> Result<CatalogSnapshotState, EdgeError>;

    /// The whole catalogue, a page at a time, for a handheld to keep locally.
    ///
    /// A shop floor is where the wifi is worst and the handhelds are most
    /// numerous, so the scan screen cannot be a round trip per rack: the
    /// catalogue is pulled once, kept in the device's own SQLite, and refreshed
    /// only when [`catalog_snapshot_state`](Self::catalog_snapshot_state) says
    /// the generation moved. Keyset by `sku_code` rather than OFFSET so a walk
    /// costs an index seek per page however deep it goes.
    fn catalog_snapshot_items(
        &self,
        query: CatalogSnapshotQuery,
    ) -> Result<CatalogSnapshotPage, EdgeError>;

    /// What this shop may sell right now, priced by the resident price book.
    ///
    /// Answered from the same evaluator the till uses, so the catalogue screen
    /// and the receipt cannot disagree.
    fn store_catalog(&self) -> Result<Vec<super::pricing::CatalogRow>, EdgeError>;
    fn store_catalog_page(
        &self,
        query: super::pricing::CatalogQuery,
    ) -> Result<super::pricing::CatalogPage, EdgeError>;
    /// What this shop is offering, and what it is about to offer.
    ///
    /// The other half of the price book. `store_catalog` says what a garment
    /// costs, which already includes any markdown — but a promotion is not a
    /// price, it is a thing that happens to a basket, so it appears nowhere on
    /// a shelf edge and nowhere in the catalogue. A shop that has been sent six
    /// offers has had no way to see that it holds them, and a cashier asked
    /// "what promos are on today?" has had nowhere to look.
    fn store_offers(&self) -> Result<super::pricing::StoreOffers, EdgeError>;
    /// What one piece of each SKU costs a walk-in shopper this minute, once
    /// the promotions that reach a single piece have come off. Only the SKUs a
    /// promotion brings down; every other one costs its catalogue price.
    fn store_final_prices(&self) -> Result<super::pricing::FinalUnitPrices, EdgeError>;
    /// Where one campaign's banner lives, as the centre last told this node.
    ///
    /// Read on its own rather than through the offers list: a browser asking
    /// for a picture has already read the list and knows the campaign's id, and
    /// rebuilding every offer to answer one `<img>` would price the whole book
    /// per image.
    fn campaign_image_url(&self, campaign_id: &str) -> Result<Option<String>, EdgeError>;
    /// Price a basket without selling it.
    ///
    /// The engine already produces everything a counter needs to talk to a
    /// customer — which promotions applied, what each was worth, and for the
    /// ones that did not, a sentence saying why: "that coupon expired on
    /// Friday", "this promotion needs a coupon code". All of it was reachable
    /// only in the response to `complete_sale`, which is to say only after the
    /// money had been taken.
    ///
    /// That is why every coupon-gated and members-only promotion in this system
    /// is unreachable in practice: a cashier has nowhere to try a code, so
    /// nobody types one. This is the read-only half, and it writes nothing —
    /// no sale, no movement, no usage count.
    fn quote_basket(&self, request: QuoteRequest) -> Result<serde_json::Value, EdgeError>;
    /// This shop's own takings over a span, bucketed by day, week or month.
    ///
    /// Answered from the shop's own SQLite so it keeps working when the link
    /// to the centre is down — which is the whole reason an edge node exists.
    /// The centre has the same report across every shop; this one is about the
    /// shop it runs in and nothing else.
    fn sales_series(
        &self,
        query: super::reports::SalesSeriesQuery,
    ) -> Result<super::reports::SalesSeries, EdgeError>;
    /// One span of this shop's trade, down to the receipts.
    fn sales_window(
        &self,
        query: super::reports::SalesWindowQuery,
    ) -> Result<super::reports::SalesWindow, EdgeError>;
    fn list_movements(&self, limit: usize) -> Result<Vec<MovementView>, EdgeError>;

    // ── The till's day ──────────────────────────────────────────────────
    //
    // A drawer that opens and closes, and a sale the shop can take back. None
    // of it existed until `sale.status` stopped being `CHECK (status =
    // 'COMPLETED')`, which is to say the two things a counter does most after
    // taking money were shut at the schema.

    /// Open the drawer for the day. Refuses a second shift on a terminal that
    /// already has one open.
    fn open_shift(
        &self,
        request: super::till::OpenShiftRequest,
    ) -> Result<super::till::ShiftReport, EdgeError>;
    /// The shift currently running — on a named terminal, or on this node at
    /// all when none is named.
    fn active_shift(
        &self,
        terminal_id: Option<&str>,
    ) -> Result<Option<super::till::ShiftReport>, EdgeError>;
    /// Cash that moved for a reason other than a sale: a safe drop, a payout,
    /// a correction.
    fn record_cash_movement(
        &self,
        shift_id: &str,
        request: super::till::CashMovementRequest,
    ) -> Result<super::till::ShiftReport, EdgeError>;
    /// Close against what the cashier counted. Blind: the declaration arrives
    /// with the request and the expectation is computed here, so the two
    /// cannot be reconciled after the fact into agreeing.
    fn close_shift(
        &self,
        shift_id: &str,
        request: super::till::CloseShiftRequest,
    ) -> Result<super::till::ShiftReport, EdgeError>;
    /// The Z report for one shift, closed or still running.
    fn shift_report(&self, shift_id: &str) -> Result<super::till::ShiftReport, EdgeError>;
    /// The store's till seats — head office's number of them — and who holds
    /// each now.
    fn till_seats(&self) -> Result<Vec<super::till::TillSeat>, EdgeError>;
    /// Take a seat from whoever holds it, and open one's own drawer there.
    /// No approval; the shift it ends waits for its holder's count.
    fn take_over_seat(
        &self,
        request: super::till::TakeOverRequest,
    ) -> Result<super::till::TakeOverOutcome, EdgeError>;
    /// Count a drawer somebody took the seat from — by its holder, or a
    /// supervisor.
    fn count_shift(
        &self,
        shift_id: &str,
        request: super::till::CloseShiftRequest,
    ) -> Result<super::till::ShiftReport, EdgeError>;
    /// The drawer one person holds, and the ones taken over from them that
    /// they have not counted.
    fn my_shifts(&self, actor: &str) -> Result<super::till::MyShifts, EdgeError>;
    /// Every drawer open in the store now.
    fn open_shifts(&self) -> Result<Vec<super::till::ShiftReport>, EdgeError>;
    /// Every drawer that traded on one business day, open and closed — the
    /// sessions of a day, oldest first.
    fn shifts_on(&self, business_date: &str) -> Result<Vec<super::till::ShiftReport>, EdgeError>;
    /// The sales rung on one drawer, oldest first, with how each was paid.
    fn shift_sales(&self, shift_id: &str) -> Result<Vec<super::till::ShiftSale>, EdgeError>;
    /// A supervisor's yes to a basket edit — a unit taken off, a basket
    /// abandoned, a parked basket thrown away — with the grant spent on it.
    fn record_till_approval(
        &self,
        request: super::till::TillApprovalRequest,
    ) -> Result<super::till::TillApproval, EdgeError>;

    /// Undo a whole sale. Every unit still out with the customer comes home on
    /// one movement, and the sale keeps its total — a void is a reversal, not
    /// a delete.
    fn void_sale(
        &self,
        sale_id: &str,
        request: super::till::VoidSaleRequest,
    ) -> Result<super::till::VoidResult, EdgeError>;
    /// Take back some of a basket. Each unit is scanned, refunded at what it
    /// was charged on the day, and sent to the floor or to reject.
    fn return_sale(
        &self,
        request: super::till::ReturnRequest,
    ) -> Result<super::till::ReturnResult, EdgeError>;
    /// Exchange, no money back: pieces from one receipt come back to the
    /// floor and replacement pieces are sold against their value, in one
    /// transaction. Only a dearer replacement takes tenders, for the
    /// difference.
    fn exchange_sale(
        &self,
        request: super::till::ExchangeRequest,
    ) -> Result<super::till::ExchangeResult, EdgeError>;
    /// What the customer walks out with, resolved and ready to render.
    fn sale_receipt(&self, sale_id: &str) -> Result<super::escpos::ReceiptDocument, EdgeError>;
    /// The Kepala toko approves an unknown item's name and price, once; the
    /// sale's UNKNOWN line spends the approval (`edge::unmatched`).
    fn approve_unknown_item(
        &self,
        request: UnknownItemApprovalRequest,
    ) -> Result<UnknownItemApproval, EdgeError> {
        let _ = request;
        Err(EdgeError::Forbidden(
            "unknown items are approved at a shop's till".into(),
        ))
    }

    // ── The shop's small money ──────────────────────────────────────────
    //
    // Petty cash, and only petty cash. None of these four can reach the
    // drawer or the day's takings: there is no shift on any of them, and
    // there is nowhere for one to be passed. See `petty.rs` for the three
    // pots and which one a shop is allowed to spend.

    /// Record a cost paid out of the petty cash tin. Refuses a category the
    /// chart does not know, more than the tin holds, and an amount above the
    /// line without Finance's code (`approval`, checked at the centre first).
    fn record_expense(
        &self,
        request: super::petty::RecordExpenseRequest,
        approval: Option<super::petty::ExpenseApproval>,
    ) -> Result<super::petty::ExpenseRecorded, EdgeError>;
    /// Keep the expense-code line the centre last said.
    fn learn_expense_code_line(&self, code_above_minor: i64) -> Result<(), EdgeError>;
    /// Record the float head office handed over. Not an expense: this is the
    /// imprest being put back.
    fn record_petty_cash_top_up(
        &self,
        request: super::petty::PettyCashTopUpRequest,
    ) -> Result<super::petty::PettyCashTopUpRecorded, EdgeError>;
    /// What is in the tin: handed over, spent, left.
    fn petty_cash_position(&self) -> Result<super::petty::PettyCashPosition, EdgeError>;
    /// The shop's own petty cash book over a span.
    fn expense_window(
        &self,
        query: super::petty::ExpenseWindowQuery,
    ) -> Result<super::petty::ExpenseWindow, EdgeError>;

    // ── The unit's punch station ────────────────────────────────────────
    //
    // Three reads and one write, and the write is the only thing this node
    // decides. Employment, the roster, the policy, the corrections and the
    // templates are all the centre's; what is here is what the reader saw,
    // plus enough of the published book to greet somebody by name and refuse a
    // stranger with the line down. See `attendance.rs`.
    //
    // On BOTH node roles, deliberately. The DC has staff, shifts and a door
    // like every shop does, so `require_store` is not called on any of these —
    // a warehouse whose people could not clock in would be a warehouse whose
    // payroll had no basis.

    /// Record a punch the reader produced, and queue it for the centre in the
    /// same transaction. Refuses a stale or missing book, a station the centre
    /// has suspended, and a person not posted to this unit.
    fn record_punch(
        &self,
        request: super::attendance::PunchRequest,
    ) -> Result<super::attendance::Punched, EdgeError>;
    /// What one person is on today, and what they have punched. The station's
    /// own screen, answerable with no uplink.
    fn attendance_today(
        &self,
        employee_id: &str,
        business_date: Option<chrono::NaiveDate>,
    ) -> Result<super::attendance::TodayForEmployee, EdgeError>;
    /// How fresh this box's published book is, and how much of it there is.
    /// A box with no book answers rather than erroring: the station has to be
    /// able to draw "waiting for head office" on its own screen.
    fn attendance_book_status(&self) -> Result<super::attendance::BookStatus, EdgeError>;

    /// Render it and put it on the shop's own printer. The drawer kick rides
    /// the same socket.
    fn print_sale_receipt(
        &self,
        sale_id: &str,
        request: super::till::PrintReceiptRequest,
    ) -> Result<serde_json::Value, EdgeError>;
    fn list_official_counts(&self) -> Result<Vec<EdgeOfficialCountSummary>, EdgeError>;
    fn official_count(&self, count_id: Uuid) -> Result<EdgeOfficialCountDetail, EdgeError>;
    fn record_official_count_entries(
        &self,
        count_id: Uuid,
        request: OfficialCountEntriesRequest,
    ) -> Result<EdgeOfficialCountDetail, EdgeError>;
    fn submit_official_count(
        &self,
        count_id: Uuid,
        request: OfficialCountSubmitRequest,
    ) -> Result<OfficialCountSubmitResult, EdgeError>;
    /// The purchase order lines this node still owes a delivery against.
    fn open_purchase_lines(&self) -> Result<Vec<PurchaseWorkLine>, EdgeError>;
    /// Purchase returns this DC holds: open ones, then the last fortnight's
    /// handed over (`0068`).
    fn purchase_returns(&self) -> Result<Vec<PurchaseReturnWork>, EdgeError>;
    /// Hand a purchase return to the supplier: its pieces leave the
    /// Unidentified pool for the supplier, and the movement tells the centre.
    fn hand_over_purchase_return(
        &self,
        return_id: uuid::Uuid,
        request: PurchaseReturnHandoverRequest,
    ) -> Result<PurchaseReturnWork, EdgeError>;
    /// Record a blind count of what arrived. A document only: nothing becomes
    /// inventory until a verifier accepts it.
    fn count_purchase(
        &self,
        request: PurchaseCountRequest,
    ) -> Result<PurchaseCountResult, EdgeError>;
    /// Record a whole count sheet at once — every counted line of one order,
    /// one delivery document, one transaction. See [`PurchaseCountBatchRequest`].
    fn count_purchase_batch(
        &self,
        request: PurchaseCountBatchRequest,
    ) -> Result<PurchaseCountBatchResult, EdgeError>;
    /// Counts waiting for a decision, with the order and the variance beside
    /// them — the verifier's view, as opposed to the checker's.
    fn counts_awaiting_verification(
        &self,
    ) -> Result<Vec<PurchaseCountAwaitingVerification>, EdgeError>;
    /// Accept a count. THIS is where goods first exist as stock, landing in
    /// the unidentified pool, and where the receipt travels to the centre.
    fn verify_purchase(
        &self,
        request: PurchaseVerifyRequest,
    ) -> Result<PurchaseVerifyResult, EdgeError>;
    /// Open a delivery document when a truck arrives, before anything is
    /// counted. The number is minted here, so receiving works with the
    /// network down.
    fn open_goods_receipt(
        &self,
        request: OpenGoodsReceiptRequest,
    ) -> Result<GoodsReceiptView, EdgeError>;
    /// Deliveries still being worked through at this DC.
    fn open_goods_receipts(&self) -> Result<Vec<GoodsReceiptView>, EdgeError>;

    /// Turn a whole delivery away, with the reason it went back.
    fn reject_delivery(
        &self,
        request: RejectDeliveryRequest,
    ) -> Result<GoodsReceiptView, EdgeError>;
    /// Record the supplier's invoice against a delivery.
    ///
    /// The verifier is holding the paper; nothing else in the estate can see
    /// it. This is the only route by which the system learns what was billed.
    fn record_receipt_invoice(
        &self,
        request: RecordInvoiceRequest,
    ) -> Result<GoodsReceiptView, EdgeError>;
    /// Keep the supplier's invoice as the paper it is.
    ///
    /// The numbers on it are recorded separately, and they are what the system
    /// compares. This is the page behind them — what settles an argument about
    /// a total six weeks later. One per delivery, because one lorry brings one
    /// invoice; a second upload replaces the first.
    fn store_invoice_document(
        &self,
        request: StoreInvoiceDocumentRequest,
    ) -> Result<InvoiceDocumentView, EdgeError>;
    /// The stored invoice's bytes, with the type they were uploaded as.
    fn invoice_document(&self, receipt_id: uuid::Uuid) -> Result<InvoiceDocument, EdgeError>;
    /// Tagging jobs this DC has been given and not yet finished — the print
    /// queue, with the labels head office minted for each variant.
    fn open_tagging_jobs(&self) -> Result<Vec<TaggingWorkJob>, EdgeError>;
    /// Confirm that the labels are on the goods.
    ///
    /// One confirmation for the whole job. There is no per-unit scan and no
    /// batch verification step: the person who attached the tags says so, and
    /// that is the record. At this moment a counted quantity becomes that
    /// many individually tracked units and enters the warehouse.
    fn confirm_tagging(
        &self,
        request: TaggingConfirmRequest,
    ) -> Result<TaggingConfirmResult, EdgeError>;
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenGoodsReceiptRequest {
    pub supplier_id: String,
    /// When the goods physically arrived. Supplied rather than assumed: a
    /// document opened the next morning is still about yesterday's lorry.
    #[serde(default)]
    pub arrived_at: Option<chrono::DateTime<chrono::Utc>>,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// Uploading the invoice page. The bytes travel as the body; everything about
/// them travels here.
#[derive(Clone, Debug)]
pub struct StoreInvoiceDocumentRequest {
    pub receipt_id: uuid::Uuid,
    pub filename: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
    pub actor_id: String,
}

/// What is on file against a delivery, without the bytes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InvoiceDocumentView {
    pub receipt_id: uuid::Uuid,
    pub filename: String,
    pub content_type: String,
    pub byte_count: i64,
    pub uploaded_by: String,
    pub uploaded_at: chrono::DateTime<chrono::Utc>,
}

/// The page itself, on its way back to a browser.
#[derive(Clone, Debug)]
pub struct InvoiceDocument {
    pub filename: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordInvoiceRequest {
    pub receipt_id: uuid::Uuid,
    pub invoice_number: String,
    #[serde(default)]
    pub invoice_date: Option<String>,
    pub invoice_total_minor: i64,
    /// Where the scan of the invoice lives. A reference, not the bytes.
    #[serde(default)]
    pub invoice_document_ref: Option<String>,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// A delivery document as the warehouse sees it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GoodsReceiptView {
    pub receipt_id: uuid::Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub arrived_at: chrono::DateTime<chrono::Utc>,
    pub status: String,
    pub opened_by: String,
    #[serde(default)]
    pub invoice_number: Option<String>,
    #[serde(default)]
    pub invoice_total_minor: Option<i64>,
    /// How many lines have been counted, and how many of those accepted.
    pub counted_lines: i64,
    pub accepted_lines: i64,
}

/// A tagging job as the warehouse sees it: what to print, and how many.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaggingWorkJob {
    pub job_id: uuid::Uuid,
    pub article_code: String,
    pub article_name: String,
    pub image_url: Option<String>,
    pub total_quantity: i64,
    pub issued_at: String,
    /// The purchase order the goods came in on, its supplier, and when the
    /// delivery was counted — so Printing lists labels by PO. `None` for a
    /// job raised before the node kept its delivery line (`0071`).
    pub po_number: Option<String>,
    pub supplier_name: Option<String>,
    pub delivered_at: Option<String>,
    pub lines: Vec<TaggingWorkLine>,
}

/// One variant's worth of labels.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaggingWorkLine {
    pub sku_code: String,
    pub colour_label: String,
    pub size_label: String,
    pub quantity: i64,
    /// The same on every unit of this SKU: what the item IS.
    pub qr_payload: String,
    pub barcode_payload: String,
    /// One per unit, in the order they were minted: which one each is.
    ///
    /// These arrived as finished strings from the centre. The DC prints them;
    /// it never computes one.
    pub epcs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaggingConfirmRequest {
    pub job_id: uuid::Uuid,
    pub actor_id: String,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaggingConfirmResult {
    pub job_id: uuid::Uuid,
    pub movement_group_id: uuid::Uuid,
    /// How many units now exist as individually tracked items.
    pub tagged_units: i64,
    pub confirmed_by: String,
    pub confirmed_at: chrono::DateTime<chrono::Utc>,
}

/// A blind count of what physically arrived against a purchase order line.
///
/// The checker sees the article's name and picture and nothing else — not the
/// ordered quantity, and not what anyone counted before. A count taken while
/// looking at the number it is supposed to produce is not evidence of
/// anything; it is a confirmation of the paperwork.
///
/// There are no EPCs here. Goods arrive untagged and unidentified: tags and
/// SKUs are assigned later, once the delivery has been accepted at all.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountRequest {
    /// The delivery this count belongs to. A truck brings several articles
    /// against several orders, and they are one arrival with one invoice —
    /// so the document is opened first and counts hang off it.
    pub receipt_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    /// Counted by hand, in pieces.
    pub counted_quantity: i64,
    /// The unit the count was typed in — `KODI` — and how many, as a decimal
    /// string ("9.5"). The node converts with the line's own factor and
    /// refuses a count whose pieces disagree with `counted_quantity`, or that
    /// is not a whole number of pieces. Absent means pieces.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub counted_unit_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub counted_unit_quantity: Option<String>,
    /// Of the counted pieces, how many are NOT the article the line names —
    /// the supplier's picker put another colour, model or article in the
    /// carton. Part of the physical count, part of no acceptance: matching
    /// runs on `counted_quantity − wrong_quantity`, and the wrong pieces go
    /// back to the supplier on a purchase return (0710). Typed in pieces.
    /// Absent means none.
    #[serde(default)]
    pub wrong_quantity: i64,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// One unit a line may be counted in, with the pieces in one of it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountUnit {
    pub code: String,
    pub label: String,
    /// Pieces in one, as a decimal string: "20", "12".
    pub factor: String,
    /// The one unit the line's stock is kept in (the article's stock unit,
    /// PCS for nearly everything) — what a total is printed in. False on
    /// orders sent before 0653, where the reader falls back to PCS.
    #[serde(default)]
    pub is_stock: bool,
}

/// A count awaiting a verifier.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountResult {
    pub count_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub counted_quantity: i64,
    /// What the checker wrote as not matching the order, inside the count.
    pub wrong_quantity: i64,
    pub counted_by: String,
    pub counted_at: chrono::DateTime<chrono::Utc>,
}

/// One line of a whole count sheet, as the checker submits it: every line of
/// one order they counted, in one command.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountEntry {
    pub po_line_id: uuid::Uuid,
    /// Counted by hand, in pieces.
    pub counted_quantity: i64,
    /// Of the counted pieces, how many are NOT the article the line names.
    /// Absent means none.
    #[serde(default)]
    pub wrong_quantity: i64,
    /// The unit the count was typed in and how many, exactly as
    /// [`PurchaseCountRequest`] carries them. Absent means pieces.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub counted_unit_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub counted_unit_quantity: Option<String>,
    /// A line ordered in variants is counted per variant (owner, 2026-10-10):
    /// one row per colour × size the line names, in pieces, 0 for one that
    /// did not come. A breakdown, not a second count — the rows add up to the
    /// line's own pieces (`counted_quantity − wrong_quantity`) and the
    /// receipt stays per line. Empty is a count taken as a whole.
    #[serde(default)]
    pub variants: Vec<PurchaseCountVariant>,
}

/// Pieces counted of one variant of a line (0963).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountVariant {
    /// The colour master's code, as the order line's variant carries it.
    #[serde(default)]
    pub colour_code: Option<String>,
    /// The size code ("05"), as the order line's variant carries it.
    #[serde(default)]
    pub size_code: Option<String>,
    pub counted_quantity: i64,
}

/// One variant of a line on the bay's work list: what it is, never how many
/// were ordered — the count stays blind (0963).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseWorkVariant {
    #[serde(default)]
    pub colour_code: Option<String>,
    /// The colour master's name for it; null when the master does not know it.
    #[serde(default)]
    pub colour_label: Option<String>,
    #[serde(default)]
    pub size_code: Option<String>,
    /// "XL", from the size vocabulary.
    #[serde(default)]
    pub size_label: Option<String>,
    /// The variant's own photographs, in the order added (0961). Often none.
    #[serde(default)]
    pub image_urls: Vec<String>,
}

/// One variant of a count under review: what the order asked of it and what
/// the bay found (0963).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseReviewVariant {
    #[serde(default)]
    pub colour_code: Option<String>,
    #[serde(default)]
    pub colour_label: Option<String>,
    #[serde(default)]
    pub size_code: Option<String>,
    #[serde(default)]
    pub size_label: Option<String>,
    #[serde(default)]
    pub image_urls: Vec<String>,
    /// What the order line names of this variant; 0 for a variant the count
    /// named that the order no longer does.
    pub ordered_quantity: i64,
    /// Of that, what is still owed after earlier accepted counts' own
    /// breakdowns — the variant's counterpart of `outstanding_stock_units`.
    pub outstanding_quantity: i64,
    /// What this count found of it; 0 when it named none.
    pub counted_quantity: i64,
}

/// A whole count sheet in one command: every line of ONE order the checker
/// counted against one delivery document.
///
/// The per-line [`PurchaseCountRequest`] remains the shape of a single line;
/// this is the sheet that used to be N of those, one HTTP round trip each,
/// with the delivery, the order and every validation repeated per line. All
/// lines commit in one transaction: a sheet is accepted whole or not at all,
/// and one idempotency key replays the whole sheet.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountBatchRequest {
    pub receipt_id: uuid::Uuid,
    pub counts: Vec<PurchaseCountEntry>,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// What a whole count sheet came to: one result per line, in the order sent.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountBatchResult {
    pub receipt_id: uuid::Uuid,
    pub items: Vec<PurchaseCountResult>,
}

/// The bay takes back its own count while nobody has decided on it (0950).
///
/// Every count named must still be waiting for review, and all of them must
/// be of one order — a count sheet is one order's lines, and it is recalled
/// whole or not at all. The counts are not deleted: each stays in the order's
/// history as RECALLED, and the line is owed a count again.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountRecallRequest {
    pub count_ids: Vec<uuid::Uuid>,
    /// Why, when the checker says. Optional: "I counted it wrong" is the
    /// reason nearly every time.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub reason: Option<String>,
    /// Who is recalling; the cloud replaces it with the signed-in caller.
    #[serde(default)]
    pub actor_id: String,
    pub idempotency_key: String,
}

/// A count the bay took back: what it said, so the sheet can be counted again
/// from it, and who took it back when.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecalledCount {
    pub count_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub receipt_id: uuid::Uuid,
    pub counted_quantity: i64,
    pub wrong_quantity: i64,
    #[serde(default)]
    pub counted_unit_code: Option<String>,
    #[serde(default)]
    pub counted_unit_quantity: Option<String>,
    pub counted_by: String,
    pub counted_at: chrono::DateTime<chrono::Utc>,
    pub recalled_by: String,
    pub recalled_at: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    pub reason: Option<String>,
    /// What the recalled count said per variant (0963), so the sheet opens
    /// with every variant's own figure. Empty when it was counted as a whole.
    #[serde(default)]
    pub variants: Vec<PurchaseCountVariant>,
}

/// What a recall did: the counts, as they were, now RECALLED.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountRecallResult {
    pub po_number: String,
    pub items: Vec<RecalledCount>,
}

/// One open line a DC still owes a supplier delivery against.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseWorkLine {
    pub po_line_id: uuid::Uuid,
    pub po_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub line_number: i64,
    /// What the checker is shown: the article, by name. Deliberately NOT the
    /// ordered quantity — that is the verifier's to know.
    pub article_code: String,
    pub article_name: String,
    pub image_url: Option<String>,
    /// Present only on the verifier's view of the same line.
    pub expected_stock_units: Option<i64>,
    pub received_stock_units: i64,
    /// The unit the order was placed in (not how many — the checker counts
    /// blind), and every unit the count may be typed in.
    pub order_unit_code: Option<String>,
    pub count_units: Vec<PurchaseCountUnit>,
    /// When this order landed HERE — not when the centre raised it.
    ///
    /// The bay's question is "what turned up recently", and the centre's
    /// issue date does not answer it: an order raised on Monday and
    /// activated at this DC on Thursday is Thursday's work. Carried so the
    /// list can lead with the newest arrival; the PO number cannot stand in
    /// for it, because the book holds numbers in several shapes and sorting
    /// them as text puts `PO-R1-…` above every dated one.
    pub activated_at: chrono::DateTime<chrono::Utc>,
    /// Set when the buyer sent this line's last count back to be counted
    /// again: their reason (empty when they gave none). The bay shows "Count
    /// again" with it instead of a fresh line.
    pub recount_reason: Option<String>,
    /// Set when the bay recalled this line's last count before anybody
    /// decided on it (0950): what that count said, so the sheet opens with
    /// the checker's own numbers to correct. Absent on a node that cannot
    /// recall.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "RecalledCount | null"))]
    pub recalled: Option<RecalledCount>,
    /// The colours × sizes the line was ordered in (0398), each counted on
    /// its own (owner, 2026-10-10). Empty for a line not split into variants,
    /// and on a DC server, which counts the line as a whole.
    #[serde(default)]
    pub variants: Vec<PurchaseWorkVariant>,
}

/// One receipt line's excess on a purchase return (`0068`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseReturnWorkLine {
    pub receipt_line_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub article_code: String,
    pub article_name: String,
    pub quantity: i64,
}

/// Goods beyond an order that the buyer is sending back, as the bay sees it:
/// what to hand over, to which supplier, and whether it has been.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseReturnWork {
    pub return_id: uuid::Uuid,
    pub return_number: String,
    pub po_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub note: Option<String>,
    pub raised_by: String,
    /// When the return reached this node.
    pub received_at: String,
    /// `OPEN` or `HANDED_OVER`.
    pub status: String,
    pub handed_over_by: Option<String>,
    pub handed_over_to: Option<String>,
    pub handed_over_at: Option<String>,
    /// The Gudang's person in charge, named when the surat jalan was generated
    /// (0917); `None` until it is.
    #[serde(default)]
    pub note_pic: Option<String>,
    /// When the surat jalan was generated; `None` until it is.
    #[serde(default)]
    pub note_generated_at: Option<String>,
    /// A few words per item on the surat jalan, by article code ("*" for the
    /// not-as-ordered pieces), written when it was generated (0970).
    #[serde(default)]
    pub line_notes: std::collections::BTreeMap<String, String>,
    /// Pieces, over every line.
    pub quantity: i64,
    pub lines: Vec<PurchaseReturnWorkLine>,
}

/// Handing a purchase return to the supplier: every piece on it leaves the
/// Unidentified pool for the supplier in one movement.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseReturnHandoverRequest {
    pub actor_id: String,
    /// Who took the goods for the supplier — a driver's name. Optional: a
    /// supplier who collects does not always leave one.
    #[serde(default)]
    pub handed_to: Option<String>,
    pub idempotency_key: String,
}

/// What a completed receipt did.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PurchaseReceiptResult {
    pub receipt_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub movement_group_id: uuid::Uuid,
    pub stock_units: i64,
    pub received_at: chrono::DateTime<chrono::Utc>,
}

/// Turning a whole delivery away.
///
/// A delivery is the supplier's arrival, not our decision about it, so it
/// exists whatever we decide — and a lorry that went back soaked is the one
/// fact worth keeping about that supplier. Refusing is only possible while
/// nothing on it has been accepted: goods already on the shelf cannot be
/// un-arrived.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RejectDeliveryRequest {
    #[serde(default)]
    pub receipt_id: uuid::Uuid,
    /// Why it went back. A rejection with no reason is a rumour.
    pub reason: String,
    pub actor_id: String,
    pub idempotency_key: String,
}

/// Approving a counted delivery, which is what puts it on the shelf.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseVerifyRequest {
    pub count_id: uuid::Uuid,
    /// Who is accepting. Who may accept — and whether that may be the person
    /// who counted, or the one who raised the order — is the caller's role
    /// and permission, not a name comparison (owner, 2026-10-04).
    pub verifier_actor_id: String,
    /// The verifier approves the checker's number as it stands. There is no
    /// field for a quantity of their own: accepting a count never edits it.
    pub decision: PurchaseVerifyDecision,
    /// Required for a recount, so the checker knows what to look at again.
    #[serde(default)]
    pub note: Option<String>,
    /// What the supplier's invoice charges per unit, read off the paper that
    /// came in with the goods. The system never sees that document, so this
    /// number exists only because a person looked.
    ///
    /// Supply it with an acceptance. If it differs from the agreed price, the
    /// delivery is accepted anyway and a query goes to whoever raised the
    /// order — the warehouse notices the discrepancy without being made to
    /// wait for someone else to settle it.
    #[serde(default)]
    pub invoiced_price_minor: Option<i64>,
    pub idempotency_key: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PurchaseVerifyDecision {
    /// The count is right, so the goods become stock. A price that disagrees
    /// with the invoice does NOT stop this: quantity and price are different
    /// questions, and holding a correct delivery on the bay over a billing
    /// dispute helps nobody. Report the price alongside accepting and the
    /// buyer settles it afterwards.
    Accept,
    /// Send it back to be counted again.
    Recount,
}

/// What verification did.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseVerifyResult {
    pub count_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub decision: PurchaseVerifyDecision,
    pub counted_by: String,
    pub verified_by: String,
    /// Only set when accepted: what actually became stock. The checker's
    /// number, unchanged — physical truth is never trimmed to fit an order.
    pub accepted_quantity: Option<i64>,
    /// How much of that the order still had room for.
    pub matched_quantity: Option<i64>,
    /// And how much it did not. Real goods, commercially unresolved until a
    /// buyer decides; they create no expected value and no liability.
    /// Includes the wrong pieces: everything beyond what the order can take
    /// goes back to the supplier together (0710).
    pub excess_quantity: Option<i64>,
    /// How much of the excess the checker had already written down as not
    /// matching the order. A part of `excess_quantity`, named so the return
    /// that takes it back can say why. `None` on a recount.
    pub wrong_quantity: Option<i64>,
    /// The agreed price that applied at this moment, written onto the
    /// acceptance so a later amendment cannot restate what this delivery was
    /// worth.
    pub agreed_unit_price_minor: Option<i64>,
    /// Set when the invoice disagreed with the order: the query now waiting
    /// for the buyer. The goods went in regardless.
    pub price_amendment_request_id: Option<uuid::Uuid>,
    pub movement_group_id: Option<uuid::Uuid>,
    pub decided_at: chrono::DateTime<chrono::Utc>,
}

/// One count waiting for a verifier, with everything needed to decide it.
///
/// The counterpart to [`PurchaseWorkLine`], and deliberately a different
/// shape. The checker's view withholds the ordered quantity and the agreed
/// price because a checker is counting; this one carries both, because a
/// verifier is comparing — against the count in front of them and the
/// supplier's invoice that arrived on the same lorry as the goods.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountAwaitingVerification {
    pub count_id: uuid::Uuid,
    /// The delivery document this count hangs off — and the only thing the
    /// supplier's invoice can be attached to. A verifier holding the paper
    /// would otherwise have to guess which of a supplier's open deliveries it
    /// belongs to, and on a busy bay that guess is wrong. One receipt holds
    /// one order's counts: a count for a second order of the same lorry is
    /// put on that order's own receipt (`receipt_for_order`), so an invoice
    /// filed here is compared with this order's lines only.
    pub receipt_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub po_number: String,
    pub supplier_id: String,
    pub article_code: String,
    pub article_name: String,
    pub counted_quantity: i64,
    /// What the checker wrote as not matching the order, inside the count:
    /// pieces on the lorry that are not this article. Received runs on
    /// `counted_quantity − wrong_quantity`; the wrong pieces go back to the
    /// supplier on a purchase return.
    pub wrong_quantity: i64,
    pub counted_by: String,
    pub counted_at: chrono::DateTime<chrono::Utc>,
    /// What the order expects, in the same unit the checker counted in.
    pub expected_stock_units: i64,
    /// Counted minus expected. Negative is short, positive is over.
    pub variance: i64,
    /// What this line can still take before a count becomes excess: ordered
    /// less everything already matched against it. A verifier accepting 105
    /// against an order with 100 outstanding is accepting 100 the company
    /// bought and 5 it did not, and should be able to see that before they
    /// press the button.
    pub outstanding_stock_units: i64,
    /// The agreed price per piece, to check the invoice against.
    pub unit_price_minor: Option<i64>,
    /// Who raised the order at head office — the one person who may verify
    /// this count. Absent on orders activated before the centre sent it.
    pub raised_by: Option<String>,
    /// What the order was placed in — "10 KODI", factor "20" — beside the
    /// pieces above. Absent for a line ordered in pieces.
    pub order_unit_code: Option<String>,
    pub order_unit_quantity: Option<String>,
    pub unit_factor: Option<String>,
    /// What the count was typed in — "9.5 KODI". Absent when counted in
    /// pieces.
    pub counted_unit_code: Option<String>,
    pub counted_unit_quantity: Option<String>,
    /// The unit the line's stock is kept in — PCS, or GRAM/CM for goods kept
    /// by weight or length (0653). Null on orders sent before it: PCS.
    pub stock_unit_code: Option<String>,
    /// The count variant by variant, when the line was ordered in variants
    /// and counted per variant (0963). Empty for a count taken as a whole.
    #[serde(default)]
    pub variants: Vec<PurchaseReviewVariant>,
    /// After a recount: what the count this one replaces came to for the
    /// ordered article (its count less its not-as-ordered pieces, so it reads
    /// against `counted_quantity − wrong_quantity`). Absent on a first count.
    /// The review shows it struck through beside the new figure, only where
    /// it changed (owner, 2026-10-12).
    #[serde(default)]
    pub previous_counted_quantity: Option<i64>,
    /// Why the buyer sent the count back, as they wrote it. Absent on a first
    /// count and when no reason was given.
    #[serde(default)]
    pub recount_reason: Option<String>,
    /// When the first count of this line was taken, once there has been a
    /// recount.
    #[serde(default)]
    pub first_counted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// A limited-coupon hold as head office granted it, recorded by the node that
/// relayed the request (`migrations/sqlite/0078`).
#[derive(Clone, Debug)]
pub struct CouponHoldRecord {
    pub authorization_id: String,
    pub code: String,
    pub checkout_id: String,
    pub expires_at: Option<DateTime<Utc>>,
}

/// A voucher hold as head office granted it, recorded by the node that relayed
/// the request.
#[derive(Clone, Debug)]
pub struct VoucherHoldRecord {
    pub authorization_id: String,
    pub code: String,
    pub checkout_id: String,
    pub amount_minor: i64,
    pub expires_at: Option<DateTime<Utc>>,
}
