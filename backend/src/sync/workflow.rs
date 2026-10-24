//! Versioned Cloud-authored inventory commands and Edge-authored workflow facts.
//!
//! Activation carries immutable planning identities, Pick allocates quantities
//! by FIFO without pretending an EPC is known, and Pack is the first stage that
//! binds scanned EPCs to Allotment lines. Package facts may span Allotments but
//! always have ONE destination site — of any kind since the owner's ruling of
//! 2026-09-27: a shop for an allotment or a transfer, the Gudang for a shop's
//! return. Facts written when the destination could only be a shop read the
//! same way; the field keeps its wire name.

use crate::edge::{OperationalPool, SiteId};
use crate::pool_role::OutboundStage;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, str::FromStr};
use uuid::Uuid;

pub const INVENTORY_ALLOTMENT_ACTIVATE_V1: &str = "inventory.allotment.activate.v1";
pub const INVENTORY_ALLOTMENT_APPLICATION_RESULT_V1: &str =
    "inventory.allotment.application_result.v1";
/// What a pick says today: so many of a SKU came off the racks. It allots
/// nothing, so its name no longer claims to.
pub const INVENTORY_PICK_V1: &str = "inventory.pick.v1";

/// The name picks travelled under while fetching still consumed allotment
/// lines. Facts already in a node's log carry it, so the centre keeps
/// accepting it; nothing emits it any more.
pub const INVENTORY_ALLOTMENT_PICK_V1: &str = "inventory.allotment.pick.v1";
pub const INVENTORY_FULFILLMENT_PROGRESS_V1: &str = "inventory.fulfillment.progress.v1";
pub const INVENTORY_ALLOTMENT_CANCEL_V1: &str = "inventory.allotment.cancel.v1";
pub const INVENTORY_ALLOTMENT_CANCELLATION_RESULT_V1: &str =
    "inventory.allotment.cancellation_result.v1";
/// MD gives up on part of a store's share (allotment-v1 §7): taken off what
/// the Gudang still has to pack, never off goods already in a carton.
pub const INVENTORY_ALLOTMENT_CLOSE_SHORT_V1: &str = "inventory.allotment.close_short.v1";
pub const INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1: &str = "inventory.official_count.activate.v1";
pub const INVENTORY_OFFICIAL_COUNT_RESULT_V1: &str = "inventory.official_count.result.v1";
pub const INVENTORY_OFFICIAL_COUNT_ADJUST_V1: &str = "inventory.official_count.adjust.v1";
pub const INVENTORY_OFFICIAL_COUNT_ADJUSTMENT_RESULT_V1: &str =
    "inventory.official_count.adjustment_result.v1";
pub const INVENTORY_WORKFLOW_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentActivationLine {
    pub allotment_line_id: Uuid,
    pub source_pool_id: String,
    pub destination_type: String,
    pub destination_id: String,
    pub sku_id: Uuid,
    pub sku_code: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentActivationPayload {
    pub schema_version: u32,
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub allotment_type: String,
    pub status: String,
    pub source_site_id: String,
    pub created_by: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub lines: Vec<AllotmentActivationLine>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplicationDecision {
    Accepted,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentApplicationLine {
    pub allotment_line_id: Uuid,
    pub planned_quantity: i64,
    pub accepted_quantity: i64,
    pub available_quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentApplicationResultPayload {
    pub schema_version: u32,
    pub result_id: Uuid,
    pub activation_command_id: Uuid,
    pub allotment_id: Uuid,
    pub source_site_id: String,
    pub decision: ApplicationDecision,
    pub rejection_code: Option<String>,
    pub reason: Option<String>,
    pub lines: Vec<AllotmentApplicationLine>,
    pub applied_at: DateTime<Utc>,
}

/// Pick is deliberately not an inventory movement: no EPC was scanned yet.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PickPayload {
    pub schema_version: u32,
    pub pick_id: Uuid,
    pub source_site_id: String,
    pub source_pool_id: String,
    pub sku_code: String,
    pub quantity: i64,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum FulfillmentStage {
    Packed,
    Shipment,
    /// On the truck, still on the yard. "Dispatched" reads as gone, and
    /// these have not gone.
    Loaded,
    InTransit,
}

impl FulfillmentStage {
    pub const fn rank(self) -> i16 {
        match self {
            Self::Packed => 2,
            Self::Shipment => 3,
            Self::Loaded => 4,
            Self::InTransit => 5,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Packed => "PACKED",
            Self::Shipment => "SHIPMENT",
            Self::Loaded => "LOADED",
            Self::InTransit => "IN_TRANSIT",
        }
    }

    pub const fn previous(self) -> Option<Self> {
        match self {
            Self::Packed => None,
            Self::Shipment => Some(Self::Packed),
            Self::Loaded => Some(Self::Shipment),
            Self::InTransit => Some(Self::Loaded),
        }
    }

    pub const fn requires_shipment_reference(self) -> bool {
        self.rank() >= Self::Shipment.rank()
    }
}

/// The stage as a pool at its origin is spelled (`crate::pool_role`).
impl From<FulfillmentStage> for OutboundStage {
    fn from(stage: FulfillmentStage) -> Self {
        match stage {
            FulfillmentStage::Packed => Self::Packed,
            FulfillmentStage::Shipment => Self::Shipment,
            FulfillmentStage::Loaded => Self::Loaded,
            FulfillmentStage::InTransit => Self::InTransit,
        }
    }
}

impl From<OutboundStage> for FulfillmentStage {
    fn from(stage: OutboundStage) -> Self {
        match stage {
            OutboundStage::Packed => Self::Packed,
            OutboundStage::Shipment => Self::Shipment,
            OutboundStage::Loaded => Self::Loaded,
            OutboundStage::InTransit => Self::InTransit,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PackageUnitAllocation {
    pub allotment_id: Uuid,
    pub allotment_line_id: Uuid,
    pub sku_code: String,
    pub epc: String,
}

/// A package belongs to one destination site — a shop, or the Gudang a return
/// goes back to — but may fulfill many Allotments. `units` is the complete
/// immutable package membership at every stage, sorted by EPC.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FulfillmentProgressPayload {
    pub schema_version: u32,
    pub progress_id: Uuid,
    /// The carton. Facts written before the box was called a koli carry
    /// `package_id`, so both names are read and only the new one is written.
    #[serde(alias = "package_id")]
    pub koli_id: Uuid,
    pub source_site_id: String,
    /// The destination SITE, of any kind. Named for the wire it has always
    /// travelled on; `destination_site_id` is read as the same field.
    #[serde(alias = "destination_site_id")]
    pub destination_store_id: String,
    /// What the koli's label says — `KL-…` — so a surat jalan printed at the
    /// centre can list the boxes by the number on them. Absent on facts
    /// written before it travelled; skipped when absent, so those facts keep
    /// the bytes they were written with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub koli_number: Option<String>,
    pub stage: FulfillmentStage,
    pub shipment_reference: Option<String>,
    pub movement_group_id: Uuid,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
    pub units: Vec<PackageUnitAllocation>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentCancellationLine {
    pub allotment_line_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentCancellationPayload {
    pub schema_version: u32,
    pub cancellation_id: Uuid,
    pub allotment_id: Uuid,
    pub source_site_id: String,
    pub reason: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub lines: Vec<AllotmentCancellationLine>,
}

/// Close Short, line by line. Each quantity comes off `To Pack` at the
/// Gudang; a line that no longer has that much to pack refuses the whole
/// command, because the centre has already booked it as given up.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentCloseShortPayload {
    pub schema_version: u32,
    pub close_short_id: Uuid,
    pub allotment_id: Uuid,
    pub source_site_id: String,
    pub reason: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    pub lines: Vec<AllotmentCancellationLine>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CancellationOutcome {
    Applied,
    PartiallyApplied,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentCancellationResultLine {
    pub allotment_line_id: Uuid,
    pub requested_quantity: i64,
    pub cancelled_quantity: i64,
    pub blocked_picked_quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AllotmentCancellationResultPayload {
    pub schema_version: u32,
    pub result_id: Uuid,
    pub cancellation_id: Uuid,
    pub cancellation_command_id: Uuid,
    pub allotment_id: Uuid,
    pub source_site_id: String,
    pub outcome: CancellationOutcome,
    pub reason: Option<String>,
    pub lines: Vec<AllotmentCancellationResultLine>,
    pub applied_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OfficialCountScope {
    #[serde(default)]
    pub sku_ids: Vec<Uuid>,
    #[serde(default)]
    pub sku_codes: Vec<String>,
    #[serde(default)]
    pub epcs: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OfficialCountActivationPayload {
    pub schema_version: u32,
    pub count_id: Uuid,
    pub site_id: String,
    pub pool_id: String,
    pub kind: String,
    pub reason: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub activated_at: DateTime<Utc>,
    pub scope: OfficialCountScope,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OfficialCountResultLine {
    pub epc: String,
    pub sku_code: String,
    pub expected_quantity: i64,
    pub found_quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OfficialCountResultPayload {
    pub schema_version: u32,
    pub result_id: Uuid,
    pub count_id: Uuid,
    pub site_id: String,
    pub pool_id: String,
    pub actor_id: String,
    pub submitted_at: DateTime<Utc>,
    pub lines: Vec<OfficialCountResultLine>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OfficialCountAdjustmentLine {
    pub epc: String,
    pub sku_code: String,
    pub expected_quantity: i64,
    pub found_quantity: i64,
    /// Signed found minus expected. Negative is shortage, positive is gain.
    pub adjustment_quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OfficialCountAdjustmentPayload {
    pub schema_version: u32,
    pub adjustment_id: Uuid,
    pub count_id: Uuid,
    pub result_id: Uuid,
    pub site_id: String,
    pub pool_id: String,
    pub approved_by: String,
    pub approved_at: DateTime<Utc>,
    pub lines: Vec<OfficialCountAdjustmentLine>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdjustmentResultStatus {
    Applied,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct OfficialCountAdjustmentResultPayload {
    pub schema_version: u32,
    pub completion_id: Uuid,
    pub adjustment_id: Uuid,
    pub adjustment_command_id: Uuid,
    pub count_id: Uuid,
    pub site_id: String,
    pub pool_id: String,
    pub status: AdjustmentResultStatus,
    #[serde(default)]
    pub movement_group_ids: Vec<Uuid>,
    pub actor_id: String,
    pub reason: Option<String>,
    pub applied_at: DateTime<Utc>,
    pub lines: Vec<OfficialCountAdjustmentLine>,
}

macro_rules! parser {
    ($name:ident, $payload:ty) => {
        pub fn $name(value: &Value) -> Result<$payload, String> {
            let payload: $payload =
                serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
            payload.validate()?;
            Ok(payload)
        }
    };
}

parser!(parse_allotment_activation, AllotmentActivationPayload);
parser!(
    parse_allotment_application_result,
    AllotmentApplicationResultPayload
);
parser!(parse_pick, PickPayload);
parser!(parse_fulfillment_progress, FulfillmentProgressPayload);
parser!(parse_allotment_cancellation, AllotmentCancellationPayload);
parser!(parse_allotment_close_short, AllotmentCloseShortPayload);
parser!(
    parse_allotment_cancellation_result,
    AllotmentCancellationResultPayload
);
parser!(
    parse_official_count_activation,
    OfficialCountActivationPayload
);
parser!(parse_official_count_result, OfficialCountResultPayload);
parser!(
    parse_official_count_adjustment,
    OfficialCountAdjustmentPayload
);
parser!(
    parse_official_count_adjustment_result,
    OfficialCountAdjustmentResultPayload
);

impl AllotmentActivationPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.allotment_id, "allotment_id")?;
        required(&self.allotment_number, "allotment_number")?;
        // The words nodes in the field read. Head office writes TO_SITE and
        // RETURN_TO_WAREHOUSE into its own tables (postgres `0611`) and sends
        // their old spellings, which every build understands; the new ones
        // are accepted too, for a head office that one day stops translating.
        if !matches!(
            self.allotment_type.as_str(),
            "TO_STORE" | "RETURN_TO_DC" | "RETURN_TO_SUPPLIER" | "TO_SITE" | "RETURN_TO_WAREHOUSE"
        ) {
            return Err("unknown allotment_type".into());
        }
        if self.status != "ACTIVE" {
            return Err("allotment activation status must be ACTIVE".into());
        }
        required(&self.source_site_id, "source_site_id")?;
        let source_site = SiteId::new(&self.source_site_id).map_err(|error| error.to_string())?;
        required(&self.created_by, "created_by")?;
        if self.lines.is_empty() {
            return Err("allotment activation requires at least one line".into());
        }
        let mut line_ids = HashSet::new();
        for line in &self.lines {
            non_nil(line.allotment_line_id, "allotment_line_id")?;
            non_nil(line.sku_id, "sku_id")?;
            required(&line.source_pool_id, "source_pool_id")?;
            // Every route packs from goods at rest at the source site; the
            // pool's role says whether they are, never the site's spelling.
            let source_pool = OperationalPool::from_str(&line.source_pool_id)
                .map_err(|error| error.to_string())?;
            if source_pool.id() != line.source_pool_id
                || !source_pool.is_fulfillment_source_for(&source_site)
            {
                return Err(
                    "source_pool_id must be a canonical pool of goods at rest at source_site_id"
                        .into(),
                );
            }
            validate_destination(&line.destination_type, &line.destination_id)?;
            canonical_upper(&line.sku_code, "sku_code")?;
            positive(line.quantity, "allotment line quantity")?;
            if !line_ids.insert(line.allotment_line_id) {
                return Err("duplicate allotment_line_id".into());
            }
        }
        Ok(())
    }
}

impl AllotmentApplicationResultPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.result_id, "result_id")?;
        non_nil(self.activation_command_id, "activation_command_id")?;
        non_nil(self.allotment_id, "allotment_id")?;
        required(&self.source_site_id, "source_site_id")?;
        if self.lines.is_empty() {
            return Err("allotment application result requires lines".into());
        }
        let mut line_ids = HashSet::new();
        for line in &self.lines {
            non_nil(line.allotment_line_id, "allotment_line_id")?;
            positive(line.planned_quantity, "planned_quantity")?;
            non_negative(line.available_quantity, "available_quantity")?;
            if !line_ids.insert(line.allotment_line_id) {
                return Err("duplicate allotment application line".into());
            }
            match self.decision {
                ApplicationDecision::Accepted
                    if line.accepted_quantity != line.planned_quantity =>
                {
                    return Err("accepted Allotment must reserve every planned unit".into());
                }
                ApplicationDecision::Rejected if line.accepted_quantity != 0 => {
                    return Err("rejected Allotment cannot reserve any unit".into());
                }
                _ => {}
            }
        }
        match self.decision {
            ApplicationDecision::Accepted => {
                if self.rejection_code.is_some() || self.reason.is_some() {
                    return Err("accepted Allotment cannot have rejection details".into());
                }
            }
            ApplicationDecision::Rejected => {
                required_option(&self.rejection_code, "rejection_code")?;
                required_option(&self.reason, "reason")?;
            }
        }
        Ok(())
    }
}

impl PickPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.pick_id, "pick_id")?;
        required(&self.source_site_id, "source_site_id")?;
        required(&self.source_pool_id, "source_pool_id")?;
        canonical_upper(&self.sku_code, "sku_code")?;
        positive(self.quantity, "quantity")?;
        required(&self.actor_id, "actor_id")?;
        // No allocations to check. A pick says a picker took so many of a SKU
        // off the racks; it allots nothing to anyone, so there is no FIFO order
        // for the centre to agree with. That agreement moved to packing, where
        // a carton — and so a store — has actually been chosen.
        Ok(())
    }
}

impl FulfillmentProgressPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.progress_id, "progress_id")?;
        non_nil(self.koli_id, "koli_id")?;
        non_nil(self.movement_group_id, "movement_group_id")?;
        required(&self.source_site_id, "source_site_id")?;
        required(&self.destination_store_id, "destination_store_id")?;
        required(&self.actor_id, "actor_id")?;
        if self.stage.requires_shipment_reference() {
            required_option(&self.shipment_reference, "shipment_reference")?;
        } else if self.shipment_reference.is_some() {
            return Err("PACKED package cannot have shipment_reference yet".into());
        }
        if self.units.is_empty() {
            return Err("package progress requires EPC units".into());
        }
        let mut epcs = HashSet::new();
        let mut previous_epc: Option<&str> = None;
        for unit in &self.units {
            non_nil(unit.allotment_id, "allotment_id")?;
            non_nil(unit.allotment_line_id, "allotment_line_id")?;
            canonical_upper(&unit.sku_code, "sku_code")?;
            canonical_upper(&unit.epc, "epc")?;
            if previous_epc.is_some_and(|previous| previous >= unit.epc.as_str()) {
                return Err("package units must be uniquely sorted by EPC".into());
            }
            previous_epc = Some(&unit.epc);
            if !epcs.insert(unit.epc.as_str()) {
                return Err("duplicate package EPC".into());
            }
        }
        Ok(())
    }
}

impl AllotmentCancellationPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.cancellation_id, "cancellation_id")?;
        non_nil(self.allotment_id, "allotment_id")?;
        required(&self.source_site_id, "source_site_id")?;
        required(&self.reason, "reason")?;
        required(&self.requested_by, "requested_by")?;
        validate_positive_lines(
            self.lines
                .iter()
                .map(|line| (line.allotment_line_id, line.quantity)),
            "cancellation",
        )
    }
}

impl AllotmentCloseShortPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.close_short_id, "close_short_id")?;
        non_nil(self.allotment_id, "allotment_id")?;
        required(&self.source_site_id, "source_site_id")?;
        required(&self.reason, "reason")?;
        required(&self.requested_by, "requested_by")?;
        validate_positive_lines(
            self.lines
                .iter()
                .map(|line| (line.allotment_line_id, line.quantity)),
            "close short",
        )
    }
}

impl AllotmentCancellationResultPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.result_id, "result_id")?;
        non_nil(self.cancellation_id, "cancellation_id")?;
        non_nil(self.cancellation_command_id, "cancellation_command_id")?;
        non_nil(self.allotment_id, "allotment_id")?;
        required(&self.source_site_id, "source_site_id")?;
        if self.lines.is_empty() {
            return Err("cancellation result requires lines".into());
        }
        let mut line_ids = HashSet::new();
        let mut any_cancelled = false;
        let mut any_blocked = false;
        for line in &self.lines {
            non_nil(line.allotment_line_id, "allotment_line_id")?;
            positive(line.requested_quantity, "requested_quantity")?;
            non_negative(line.cancelled_quantity, "cancelled_quantity")?;
            non_negative(line.blocked_picked_quantity, "blocked_picked_quantity")?;
            if line.cancelled_quantity + line.blocked_picked_quantity != line.requested_quantity {
                return Err(
                    "requested cancellation must equal cancelled plus blocked Picked".into(),
                );
            }
            if !line_ids.insert(line.allotment_line_id) {
                return Err("duplicate cancellation result line".into());
            }
            any_cancelled |= line.cancelled_quantity > 0;
            any_blocked |= line.blocked_picked_quantity > 0;
        }
        let valid_outcome = match self.outcome {
            CancellationOutcome::Applied => any_cancelled && !any_blocked,
            CancellationOutcome::PartiallyApplied => any_cancelled && any_blocked,
            CancellationOutcome::Rejected => !any_cancelled && any_blocked,
        };
        if !valid_outcome {
            return Err("cancellation outcome does not match actual quantities".into());
        }
        if matches!(self.outcome, CancellationOutcome::Applied) {
            if self.reason.is_some() {
                return Err("fully applied cancellation cannot have a failure reason".into());
            }
        } else {
            required_option(&self.reason, "reason")?;
        }
        Ok(())
    }
}

impl OfficialCountActivationPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.count_id, "count_id")?;
        required(&self.site_id, "site_id")?;
        required(&self.pool_id, "pool_id")?;
        required(&self.reason, "reason")?;
        required(&self.created_by, "created_by")?;
        if !matches!(self.kind.as_str(), "FULL" | "CYCLE" | "TARGETED") {
            return Err("unknown official count kind".into());
        }
        let site = SiteId::new(&self.site_id).map_err(|error| error.to_string())?;
        let pool = OperationalPool::from_str(&self.pool_id).map_err(|error| error.to_string())?;
        if pool.id() != self.pool_id || pool.site_id() != &site {
            return Err("official count pool must be canonical and belong to site_id".into());
        }
        let mut sku_ids = HashSet::new();
        for sku_id in &self.scope.sku_ids {
            non_nil(*sku_id, "scope.sku_ids")?;
            if !sku_ids.insert(*sku_id) {
                return Err("duplicate count scope sku_id".into());
            }
        }
        unique_canonical(&self.scope.sku_codes, "scope.sku_codes")?;
        unique_canonical(&self.scope.epcs, "scope.epcs")?;
        if self.scope.sku_ids.len() != self.scope.sku_codes.len() {
            return Err("count scope sku_ids and sku_codes must have the same cardinality".into());
        }
        if self.kind == "TARGETED" && self.scope.sku_ids.is_empty() && self.scope.epcs.is_empty() {
            return Err("TARGETED official count requires SKU or EPC scope".into());
        }
        Ok(())
    }
}

impl OfficialCountResultPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.result_id, "result_id")?;
        non_nil(self.count_id, "count_id")?;
        required(&self.site_id, "site_id")?;
        required(&self.pool_id, "pool_id")?;
        required(&self.actor_id, "actor_id")?;
        validate_count_lines(&self.lines)
    }
}

impl OfficialCountAdjustmentPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.adjustment_id, "adjustment_id")?;
        non_nil(self.count_id, "count_id")?;
        non_nil(self.result_id, "result_id")?;
        required(&self.site_id, "site_id")?;
        required(&self.pool_id, "pool_id")?;
        required(&self.approved_by, "approved_by")?;
        validate_adjustment_lines(&self.lines)
    }
}

impl OfficialCountAdjustmentResultPayload {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        non_nil(self.completion_id, "completion_id")?;
        non_nil(self.adjustment_id, "adjustment_id")?;
        non_nil(self.adjustment_command_id, "adjustment_command_id")?;
        non_nil(self.count_id, "count_id")?;
        required(&self.site_id, "site_id")?;
        required(&self.pool_id, "pool_id")?;
        required(&self.actor_id, "actor_id")?;
        validate_adjustment_lines(&self.lines)?;
        let mut movement_group_ids = HashSet::new();
        for movement_group_id in &self.movement_group_ids {
            non_nil(*movement_group_id, "movement_group_ids")?;
            if !movement_group_ids.insert(*movement_group_id) {
                return Err("duplicate count adjustment movement_group_id".into());
            }
        }
        match self.status {
            AdjustmentResultStatus::Applied => {
                let required_groups =
                    usize::from(self.lines.iter().any(|line| line.adjustment_quantity < 0))
                        + usize::from(self.lines.iter().any(|line| line.adjustment_quantity > 0));
                if self.movement_group_ids.len() != required_groups {
                    return Err(format!(
                        "applied adjustment requires exactly {required_groups} movement group(s)"
                    ));
                }
                if self.reason.is_some() {
                    return Err("applied adjustment cannot have a rejection reason".into());
                }
            }
            AdjustmentResultStatus::Rejected => {
                required_option(&self.reason, "reason")?;
                if !self.movement_group_ids.is_empty() {
                    return Err("rejected adjustment cannot have movement_group_ids".into());
                }
            }
        }
        Ok(())
    }
}

fn validate_destination(destination_type: &str, destination_id: &str) -> Result<(), String> {
    if !matches!(destination_type, "STORE" | "DC" | "SUPPLIER") {
        return Err("unknown allotment destination_type".into());
    }
    required(destination_id, "destination_id")
}

fn validate_positive_lines(
    lines: impl IntoIterator<Item = (Uuid, i64)>,
    label: &str,
) -> Result<(), String> {
    let mut line_ids = HashSet::new();
    for (line_id, quantity) in lines {
        non_nil(line_id, "allotment_line_id")?;
        positive(quantity, "quantity")?;
        if !line_ids.insert(line_id) {
            return Err(format!("duplicate {label} line"));
        }
    }
    if line_ids.is_empty() {
        Err(format!("{label} requires at least one line"))
    } else {
        Ok(())
    }
}

fn validate_count_lines(lines: &[OfficialCountResultLine]) -> Result<(), String> {
    let mut epcs = HashSet::new();
    for line in lines {
        canonical_upper(&line.epc, "epc")?;
        canonical_upper(&line.sku_code, "sku_code")?;
        non_negative(line.expected_quantity, "expected_quantity")?;
        non_negative(line.found_quantity, "found_quantity")?;
        if !epcs.insert(line.epc.as_str()) {
            return Err("duplicate count result EPC".into());
        }
    }
    Ok(())
}

fn validate_adjustment_lines(lines: &[OfficialCountAdjustmentLine]) -> Result<(), String> {
    let mut epcs = HashSet::new();
    for line in lines {
        canonical_upper(&line.epc, "epc")?;
        canonical_upper(&line.sku_code, "sku_code")?;
        non_negative(line.expected_quantity, "expected_quantity")?;
        non_negative(line.found_quantity, "found_quantity")?;
        let expected_delta = line
            .found_quantity
            .checked_sub(line.expected_quantity)
            .ok_or_else(|| "count adjustment quantity overflow".to_string())?;
        if line.adjustment_quantity == 0 || line.adjustment_quantity != expected_delta {
            return Err("adjustment_quantity must be non-zero found minus expected".into());
        }
        if !epcs.insert(line.epc.as_str()) {
            return Err("duplicate count adjustment EPC".into());
        }
    }
    Ok(())
}

fn version(value: u32) -> Result<(), String> {
    if value == INVENTORY_WORKFLOW_SCHEMA_VERSION {
        Ok(())
    } else {
        Err(format!(
            "workflow schema_version must be {INVENTORY_WORKFLOW_SCHEMA_VERSION}"
        ))
    }
}

fn non_nil(value: Uuid, field: &str) -> Result<(), String> {
    if value.is_nil() {
        Err(format!("{field} must not be nil"))
    } else {
        Ok(())
    }
}

fn positive(value: i64, field: &str) -> Result<(), String> {
    if value > 0 {
        Ok(())
    } else {
        Err(format!("{field} must be positive"))
    }
}

fn non_negative(value: i64, field: &str) -> Result<(), String> {
    if value >= 0 {
        Ok(())
    } else {
        Err(format!("{field} cannot be negative"))
    }
}

fn required(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} is required"))
    } else if value != value.trim() {
        Err(format!("{field} must be trimmed"))
    } else {
        Ok(())
    }
}

fn required_option(value: &Option<String>, field: &str) -> Result<(), String> {
    required(
        value
            .as_deref()
            .ok_or_else(|| format!("{field} is required"))?,
        field,
    )
}

fn canonical_upper(value: &str, field: &str) -> Result<(), String> {
    required(value, field)?;
    if value != value.to_ascii_uppercase() {
        Err(format!("{field} must be uppercase"))
    } else {
        Ok(())
    }
}

fn unique_canonical(values: &[String], field: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for value in values {
        canonical_upper(value, field)?;
        if !seen.insert(value.as_str()) {
            return Err(format!("duplicate {field} value"));
        }
    }
    Ok(())
}

// ---- Store inbound: what is on the lorry, told to the shop -----------------

/// Cloud → Store Edge: a carton left the DC for this shop.
///
/// Issued once per koli, when the centre applies that koli's `IN_TRANSIT`
/// fulfillment progress, and targeted only at the STORE origin registered for
/// `destination_store_id`. The shop files the units under a delivery (one per
/// surat jalan, or per koli when there is none) and keeps them out of sight
/// until the delivery has been counted — the count is blind.
///
/// Deliberately no `deny_unknown_fields`: a newer centre adding a field must
/// not block an older shop's command stream.
pub const INVENTORY_STORE_INBOUND_ANNOUNCE_V1: &str = "inventory.store_inbound.announce.v1";

/// What a shop edge advertises (in `/api/v1/health` → `capabilities`) once it
/// understands [`INVENTORY_STORE_INBOUND_ANNOUNCE_V1`].
pub const STORE_INBOUND_CAPABILITY: &str = "store.inbound";

/// What a node's heartbeat carries (`NodeStatus::capabilities`) once its build
/// takes the goods-route commands of the owner's 2026-09-27 routes: an
/// allotment activation at a shop (its return or its transfer), an inbound
/// announcement at a warehouse (a shop's return), and the in-transit release.
/// Head office sends none of them to a node whose heartbeat does not say so:
/// an unknown command blocks a node's whole stream.
pub const GOODS_ROUTES_CAPABILITY: &str = "inventory.goods_routes.v1";

/// What a node's heartbeat carries once its build takes
/// `inventory.in_transit.short.v1` (a piece the destination did not find,
/// booked Missing at the origin) and lets a release take a piece out of
/// Missing. Head office sends neither to a node that does not say so.
pub const TRANSIT_SHORT_CAPABILITY: &str = "inventory.transit_short.v1";

/// A node that takes `inventory.allotment.close_short.v1`.
pub const CLOSE_SHORT_CAPABILITY: &str = "inventory.allotment_close_short.v1";

/// MD's answer to a trip's review, for one shop of the trip (owner, 17–18 Oct
/// 2026; `cloud::postgres::allotment_store_review`).
///
/// The shop counted its delivery blind and what it counted differs from what
/// was sent, so nothing of it was booked: a delivery in review is the shop's
/// only when MD has answered (owner, 18 Oct 2026). MD answers for the whole
/// trip, and each shop of it whose count differed is told what that answer
/// means for it:
///
/// - `book`: the pieces it now books into its stockroom, by EPC — a typed
///   count reads no tag, so head office names them. Its own pieces, as many
///   of each SKU as it counted up to what was sent, and (on Accept as
///   delivered) another shop's pieces of the trip that arrived here.
/// - `send_back`: pieces that go back to HO — what nobody sent, and (on
///   Return & reallot) another shop's pieces.
///
/// Sent only to a shop whose heartbeat carries [`STORE_ON_HOLD_CAPABILITY`].
/// No `deny_unknown_fields`, like every command a shop reads.
pub const INVENTORY_STORE_INBOUND_ON_HOLD_V1: &str = "inventory.store_inbound.on_hold.v1";

/// A shop that takes [`INVENTORY_STORE_INBOUND_ON_HOLD_V1`].
pub const STORE_ON_HOLD_CAPABILITY: &str = "inventory.store_inbound.on_hold.v1";

pub const STORE_INBOUND_ON_HOLD_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreInboundBook {
    pub epc: String,
    pub sku_code: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreInboundSendBack {
    pub sku_code: String,
    pub pieces: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreInboundOnHoldPayload {
    pub schema_version: u32,
    /// The trip MD reviewed.
    pub dispatch_number: String,
    /// `AS_DELIVERED` or `RETURN_REALLOT`.
    pub decision: String,
    /// The shop's surat jalan on that trip: the delivery it received.
    pub shipment_reference: String,
    #[serde(default)]
    pub book: Vec<StoreInboundBook>,
    #[serde(default)]
    pub send_back: Vec<StoreInboundSendBack>,
    pub decided_by: String,
    pub decided_at: DateTime<Utc>,
}

pub fn parse_store_inbound_on_hold(payload: &Value) -> Result<StoreInboundOnHoldPayload, String> {
    let decided: StoreInboundOnHoldPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {INVENTORY_STORE_INBOUND_ON_HOLD_V1}: {error}"))?;
    if decided.schema_version != STORE_INBOUND_ON_HOLD_SCHEMA_VERSION {
        return Err(format!(
            "{INVENTORY_STORE_INBOUND_ON_HOLD_V1} schema_version must be {STORE_INBOUND_ON_HOLD_SCHEMA_VERSION}"
        ));
    }
    required(&decided.dispatch_number, "dispatch_number")?;
    required(&decided.shipment_reference, "shipment_reference")?;
    required(&decided.decided_by, "decided_by")?;
    if decided.decision != "AS_DELIVERED" && decided.decision != "RETURN_REALLOT" {
        return Err(format!(
            "decision must be AS_DELIVERED or RETURN_REALLOT, not {}",
            decided.decision
        ));
    }
    for book in &decided.book {
        required(&book.epc, "book.epc")?;
        required(&book.sku_code, "book.sku_code")?;
    }
    for back in &decided.send_back {
        required(&back.sku_code, "send_back.sku_code")?;
        if back.pieces <= 0 {
            return Err(format!("{} to send back must be positive", back.sku_code));
        }
    }
    Ok(decided)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreInboundAnnounceUnit {
    pub epc: String,
    pub sku_code: String,
    pub allotment_line_id: Uuid,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreInboundAnnouncePayload {
    pub koli_id: Uuid,
    pub source_site_id: String,
    /// The destination site — a shop, or the Gudang a return goes back to —
    /// in the receiving node's own spelling. Named for the wire.
    pub destination_store_id: String,
    pub shipment_reference: Option<String>,
    /// The koli's `IN_TRANSIT` fact's `occurred_at` — when it left the yard.
    pub departed_at: DateTime<Utc>,
    pub units: Vec<StoreInboundAnnounceUnit>,
    /// Where the delivery lands, when it is not the receiver's stockroom: a
    /// store's own return pool at the Gudang (postgres `0610`), in the
    /// receiving node's spelling. Absent on every announcement to a shop and
    /// from a centre older than the goods routes; a shop that has never heard
    /// of it ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_pool_id: Option<String>,
    /// What the koli's label says (`KL-…`), so the shop can scan the label
    /// and see what is in the box. Absent from a centre older than this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub koli_number: Option<String>,
}

impl StoreInboundAnnouncePayload {
    /// Built from the centre's own applied fact, so it cannot disagree with it.
    pub fn from_progress(progress: &FulfillmentProgressPayload) -> Self {
        Self {
            koli_id: progress.koli_id,
            source_site_id: progress.source_site_id.clone(),
            destination_store_id: progress.destination_store_id.clone(),
            shipment_reference: progress.shipment_reference.clone(),
            departed_at: progress.occurred_at,
            units: progress
                .units
                .iter()
                .map(|unit| StoreInboundAnnounceUnit {
                    epc: unit.epc.clone(),
                    sku_code: unit.sku_code.clone(),
                    allotment_line_id: unit.allotment_line_id,
                })
                .collect(),
            destination_pool_id: None,
            koli_number: progress.koli_number.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        non_nil(self.koli_id, "koli_id")?;
        required(&self.source_site_id, "source_site_id")?;
        required(&self.destination_store_id, "destination_store_id")?;
        if let Some(reference) = &self.shipment_reference {
            required(reference, "shipment_reference")?;
        }
        if self.units.is_empty() {
            return Err("an announced koli must carry at least one unit".into());
        }
        let mut epcs = HashSet::new();
        for unit in &self.units {
            canonical_upper(&unit.epc, "epc")?;
            canonical_upper(&unit.sku_code, "sku_code")?;
            non_nil(unit.allotment_line_id, "allotment_line_id")?;
            if !epcs.insert(unit.epc.as_str()) {
                return Err(format!("EPC {} is announced twice in one koli", unit.epc));
            }
        }
        Ok(())
    }
}

parser!(
    parse_store_inbound_announcement,
    StoreInboundAnnouncePayload
);

/// Head office moves a shop's goods to its To be returned · Return HO pocket
/// (owner, 23 Oct 2026): the shop does not wait on a request and HO does not
/// write one. The shop's node moves each SKU off its stockroom first, then
/// its floor, into `{site}.to-return.ho`; what it no longer holds (sold since
/// HO looked) is moved as far as it goes and the rest is passed over. The
/// shop then sends the pocket whenever it is ready.
///
/// Sent only to a shop whose heartbeat carries [`STORE_RETURN_MARK_CAPABILITY`].
/// No `deny_unknown_fields`, like every command a shop reads.
pub const INVENTORY_STORE_RETURN_MARK_V1: &str = "inventory.store_return.mark.v1";

/// A shop that takes [`INVENTORY_STORE_RETURN_MARK_V1`].
pub const STORE_RETURN_MARK_CAPABILITY: &str = "inventory.store_return.mark.v1";

pub const STORE_RETURN_MARK_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreReturnMarkLine {
    pub sku_code: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct StoreReturnMarkPayload {
    pub schema_version: u32,
    /// The shop the goods are at, as head office spells it.
    pub site_id: String,
    pub lines: Vec<StoreReturnMarkLine>,
    pub moved_by: String,
    pub moved_at: DateTime<Utc>,
}

pub fn parse_store_return_mark(payload: &Value) -> Result<StoreReturnMarkPayload, String> {
    let marked: StoreReturnMarkPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {INVENTORY_STORE_RETURN_MARK_V1}: {error}"))?;
    if marked.schema_version != STORE_RETURN_MARK_SCHEMA_VERSION {
        return Err(format!(
            "{INVENTORY_STORE_RETURN_MARK_V1} schema_version must be {STORE_RETURN_MARK_SCHEMA_VERSION}"
        ));
    }
    required(&marked.site_id, "site_id")?;
    required(&marked.moved_by, "moved_by")?;
    if marked.lines.is_empty() {
        return Err(format!("{INVENTORY_STORE_RETURN_MARK_V1} names no goods"));
    }
    for line in &marked.lines {
        required(&line.sku_code, "lines.sku_code")?;
        if line.quantity <= 0 {
            return Err(format!("{} to move must be positive", line.sku_code));
        }
    }
    Ok(marked)
}
