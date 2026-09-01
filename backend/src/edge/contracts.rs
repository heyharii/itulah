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
    pub total_minor: i64,
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
    pub allotted: Option<i64>,
    pub on_hand: i64,
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
    fn allotment_line_position(
        &self,
        allotment_line_id: &str,
    ) -> Result<super::outbound::LinePosition, EdgeError>;
    fn intake_dc(&self, request: IntakeRequest) -> Result<CommandResult, EdgeError>;
    fn pick_stock(&self, request: PickRequest) -> Result<PickResult, EdgeError>;
    fn pack_koli(&self, request: PackKoliRequest) -> Result<FulfillmentProgressResult, EdgeError>;
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
    fn move_stock(&self, request: MoveRequest) -> Result<CommandResult, EdgeError>;
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

    /// What this shop may sell right now, priced by the resident price book.
    ///
    /// Answered from the same evaluator the till uses, so the catalogue screen
    /// and the receipt cannot disagree.
    fn store_catalog(&self) -> Result<Vec<super::pricing::CatalogRow>, EdgeError>;
    fn store_catalog_page(
        &self,
        query: super::pricing::CatalogQuery,
    ) -> Result<super::pricing::CatalogPage, EdgeError>;
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
    /// Record the supplier's invoice against a delivery.
    ///
    /// The verifier is holding the paper; nothing else in the estate can see
    /// it. This is the only route by which the system learns what was billed.
    fn record_receipt_invoice(
        &self,
        request: RecordInvoiceRequest,
    ) -> Result<GoodsReceiptView, EdgeError>;
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

/// Whether one pair of hands may both count a delivery and approve it.
///
/// The rule protects the accepted quantity — the number that becomes supplier
/// debt — from being asserted and confirmed by the same person. Someone who
/// can do both can sign phantom stock onto the shelf, and no later report
/// would show anything wrong: the books and the shelf would agree, and both
/// would be a lie.
///
/// It is a policy rather than a hard rule because a site with one receiving
/// clerk on shift would otherwise be unable to receive at all. Turning it off
/// is a decision a site makes out loud, not a default it drifts into.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum SegregationPolicy {
    /// The verifier must be someone other than the counter.
    Enforced,
    /// No separation. Only for single-operator sites that have accepted the
    /// exposure.
    Relaxed,
}

impl SegregationPolicy {
    pub fn from_env() -> Self {
        match std::env::var("DC_RECEIVING_SEGREGATION")
            .unwrap_or_default()
            .trim()
        {
            "off" | "false" | "0" | "relaxed" => Self::Relaxed,
            _ => Self::Enforced,
        }
    }

    pub const fn requires_two_people(self) -> bool {
        matches!(self, Self::Enforced)
    }
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
    /// Only set when accepted: what actually became stock.
    pub accepted_quantity: Option<i64>,
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
    /// The agreed price per piece, to check the invoice against.
    pub unit_price_minor: Option<i64>,
}
