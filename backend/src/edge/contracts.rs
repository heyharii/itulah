use crate::edge::domain::{
    validate_transition, MovementCause, MovementError, MovementLine, OperationalPool, SiteId,
    SiteKind, SubjectId,
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
        let expected = match role {
            EdgeRole::Dc => SiteKind::Dc,
            EdgeRole::Store => SiteKind::Store,
        };
        if site_id.kind() != expected {
            return Err(EdgeError::Configuration(format!(
                "{role} edge cannot own site {site_id}"
            )));
        }
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
    fn move_stock(&self, request: MoveRequest) -> Result<CommandResult, EdgeError>;
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
    fn list_pools(&self) -> Result<Vec<PoolBalance>, EdgeError>;
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
    /// What the customer walks out with, resolved and ready to render.
    fn sale_receipt(&self, sale_id: &str) -> Result<super::escpos::ReceiptDocument, EdgeError>;

    // ── The shop's small money ──────────────────────────────────────────
    //
    // Petty cash, and only petty cash. None of these four can reach the
    // drawer or the day's takings: there is no shift on any of them, and
    // there is nowhere for one to be passed. See `petty.rs` for the three
    // pots and which one a shop is allowed to spend.

    /// Record a cost paid out of the petty cash tin. Refuses a category the
    /// chart does not know, an amount above what a store manager may approve,
    /// an approver who is the claimant, and more than the tin holds.
    fn record_expense(
        &self,
        request: super::petty::RecordExpenseRequest,
    ) -> Result<super::petty::ExpenseRecorded, EdgeError>;
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
    /// Record a blind count of what arrived. A document only: nothing becomes
    /// inventory until a verifier accepts it.
    fn count_purchase(
        &self,
        request: PurchaseCountRequest,
    ) -> Result<PurchaseCountResult, EdgeError>;
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
    pub actor_id: String,
    pub idempotency_key: String,
}

/// A count awaiting a verifier.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseCountResult {
    pub count_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub counted_quantity: i64,
    pub counted_by: String,
    pub counted_at: chrono::DateTime<chrono::Utc>,
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
    /// When this order landed HERE — not when the centre raised it.
    ///
    /// The bay's question is "what turned up recently", and the centre's
    /// issue date does not answer it: an order raised on Monday and
    /// activated at this DC on Thursday is Thursday's work. Carried so the
    /// list can lead with the newest arrival; the PO number cannot stand in
    /// for it, because the book holds numbers in several shapes and sorting
    /// them as text puts `PO-R1-…` above every dated one.
    pub activated_at: chrono::DateTime<chrono::Utc>,
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
    pub verifier_actor_id: String,
    /// The verifier approves the checker's number as it stands. There is no
    /// field for a quantity of their own: someone who can both approve a
    /// delivery and decide what it was has the whole control to themselves.
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
    pub excess_quantity: Option<i64>,
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
    /// belongs to, and on a busy bay that guess is wrong.
    pub receipt_id: uuid::Uuid,
    pub po_line_id: uuid::Uuid,
    pub po_number: String,
    pub supplier_id: String,
    pub article_code: String,
    pub article_name: String,
    pub counted_quantity: i64,
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
}
