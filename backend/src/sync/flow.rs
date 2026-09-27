//! Goods flows on the wire, both ways.
//!
//! **Upward, facts.** A flow document's stages are done on the nodes that own
//! the sites' ledgers, and most of that work already travels: a pick, a koli
//! packed, shipped, loaded and departed (`sync::workflow`), a supplier's
//! delivery accepted, a tagging job confirmed. Three steps had no fact of
//! their own and are named here:
//!
//! * [`INVENTORY_INBOUND_RECEIVED_V1`] — a site of ours received an announced
//!   delivery (one surat jalan, or one koli without one) in its one confirm.
//!   The per-EPC transfer claims that the same receipt writes say which
//!   garments were found; this says which delivery was received, what came
//!   off the lorry for each allotment line and what of it was found, which no
//!   set of claims can: a garment that was not found writes no claim.
//!   Enqueued after the receipt's claims in the same transaction, so the
//!   centre, which applies one origin's facts in order, has every claim of a
//!   delivery before it reads the delivery.
//! * [`INVENTORY_RETURN_INSPECTED_V1`] — the Gudang inspected (part of) a
//!   store's return it received: good goods to the racks, damaged to reject.
//! * [`INVENTORY_PUTAWAY_V1`] — the Gudang put a tagged job's goods away.
//!
//! None of them is a movement: the movements travel as movement facts. These
//! say which document the movement belongs to, which is what a flow is keyed
//! by (`cloud::postgres::flow_stages`).
//!
//! **Downward, a command.** [`INVENTORY_FLOW_EVENTS_V1`] carries the flow's
//! outbox (`flow_event`, 0618) to the node of each site a document touches,
//! so the node knows which document a stage belongs to and what the hub did.
//! It is only sent to a node whose heartbeat advertises [`FLOWS_CAPABILITY`]:
//! an older build blocks its whole command stream on a type it does not know.
//!
//! No payload here denies unknown fields: a newer build adding one must not
//! stop an older reader.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const INVENTORY_INBOUND_RECEIVED_V1: &str = "inventory.inbound.received.v1";
pub const INVENTORY_RETURN_INSPECTED_V1: &str = "inventory.return.inspected.v1";
pub const INVENTORY_PUTAWAY_V1: &str = "inventory.putaway.v1";

/// Cloud → node: what a flow document did, for the node of a site it touches.
pub const INVENTORY_FLOW_EVENTS_V1: &str = "inventory.flow.events.v1";

/// What a node's heartbeat carries once its build applies
/// [`INVENTORY_FLOW_EVENTS_V1`] and emits the three facts above.
pub const FLOWS_CAPABILITY: &str = "inventory.flows.v1";

pub const FLOW_FACT_SCHEMA_VERSION: u32 = 1;

/// Most lines one of these facts may carry: a delivery is one surat jalan.
pub const MAX_FLOW_FACT_LINES: usize = 5_000;

// ---- a delivery received --------------------------------------------------

/// One allotment line of a received delivery.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InboundReceivedLine {
    /// `None` for a unit announced without a line (an older centre).
    #[serde(default)]
    pub allotment_line_id: Option<Uuid>,
    pub sku_code: String,
    /// Units of this line the delivery's koli held: what came off the lorry
    /// and was handed over, found or not (allotment ALT-D01).
    pub expected: i64,
    /// Of those, what was found.
    pub received: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InboundReceivedPayload {
    pub schema_version: u32,
    /// The receipt's id: the event id.
    pub receipt_id: Uuid,
    pub delivery_id: String,
    /// The site the delivery left, in its node's spelling.
    pub source_site_id: String,
    /// The receiving site, in this node's spelling.
    pub destination_site_id: String,
    #[serde(default)]
    pub shipment_reference: Option<String>,
    /// Where the goods landed: the stockroom, or a store's return pool.
    pub landing_pool_id: String,
    #[serde(default)]
    pub koli_ids: Vec<Uuid>,
    pub lines: Vec<InboundReceivedLine>,
    /// Tags read that no koli of the delivery held.
    #[serde(default)]
    pub extra_units: i64,
    pub received_by: String,
    pub received_at: DateTime<Utc>,
}

pub fn parse_inbound_received(payload: &Value) -> Result<InboundReceivedPayload, String> {
    let received: InboundReceivedPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {INVENTORY_INBOUND_RECEIVED_V1}: {error}"))?;
    if received.schema_version != FLOW_FACT_SCHEMA_VERSION {
        return Err(format!(
            "{INVENTORY_INBOUND_RECEIVED_V1} schema_version must be {FLOW_FACT_SCHEMA_VERSION}"
        ));
    }
    for (field, value) in [
        ("delivery_id", &received.delivery_id),
        ("source_site_id", &received.source_site_id),
        ("destination_site_id", &received.destination_site_id),
        ("landing_pool_id", &received.landing_pool_id),
        ("received_by", &received.received_by),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{INVENTORY_INBOUND_RECEIVED_V1} names no {field}"));
        }
    }
    if received.lines.len() > MAX_FLOW_FACT_LINES {
        return Err(format!(
            "{INVENTORY_INBOUND_RECEIVED_V1} carries more than {MAX_FLOW_FACT_LINES} lines"
        ));
    }
    if received.extra_units < 0 {
        return Err("extra units cannot be negative".into());
    }
    for line in &received.lines {
        if line.sku_code.trim().is_empty() {
            return Err("a received line names no SKU".into());
        }
        if line.expected < 0 || line.received < 0 || line.received > line.expected {
            return Err(format!(
                "a received line of {} says {} found of {} handed over",
                line.sku_code, line.received, line.expected
            ));
        }
    }
    Ok(received)
}

// ---- a return inspected ---------------------------------------------------

/// One allotment line of an inspection.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReturnInspectedLine {
    #[serde(default)]
    pub allotment_line_id: Option<Uuid>,
    pub sku_code: String,
    /// Fit to sell: moved to the racks.
    pub good: i64,
    /// Not fit to sell: moved to reject.
    pub damaged: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReturnInspectedPayload {
    pub schema_version: u32,
    /// The inspection's id: the event id.
    pub inspection_id: Uuid,
    /// The received delivery the goods came in.
    pub delivery_id: String,
    /// The store the goods came back from, in its node's spelling.
    pub source_site_id: String,
    /// This site, in this node's spelling.
    pub site_id: String,
    #[serde(default)]
    pub shipment_reference: Option<String>,
    /// The movement that took the goods out of the return pool.
    pub movement_group_id: Uuid,
    pub lines: Vec<ReturnInspectedLine>,
    pub inspected_by: String,
    pub inspected_at: DateTime<Utc>,
}

pub fn parse_return_inspected(payload: &Value) -> Result<ReturnInspectedPayload, String> {
    let inspected: ReturnInspectedPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {INVENTORY_RETURN_INSPECTED_V1}: {error}"))?;
    if inspected.schema_version != FLOW_FACT_SCHEMA_VERSION {
        return Err(format!(
            "{INVENTORY_RETURN_INSPECTED_V1} schema_version must be {FLOW_FACT_SCHEMA_VERSION}"
        ));
    }
    for (field, value) in [
        ("delivery_id", &inspected.delivery_id),
        ("source_site_id", &inspected.source_site_id),
        ("site_id", &inspected.site_id),
        ("inspected_by", &inspected.inspected_by),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{INVENTORY_RETURN_INSPECTED_V1} names no {field}"));
        }
    }
    if inspected.lines.is_empty() {
        return Err("an inspection of nothing inspects nothing".into());
    }
    if inspected.lines.len() > MAX_FLOW_FACT_LINES {
        return Err(format!(
            "{INVENTORY_RETURN_INSPECTED_V1} carries more than {MAX_FLOW_FACT_LINES} lines"
        ));
    }
    for line in &inspected.lines {
        if line.sku_code.trim().is_empty() {
            return Err("an inspected line names no SKU".into());
        }
        if line.good < 0 || line.damaged < 0 || line.good + line.damaged == 0 {
            return Err(format!(
                "an inspected line of {} says {} good and {} damaged",
                line.sku_code, line.good, line.damaged
            ));
        }
    }
    Ok(inspected)
}

// ---- a tagged job put away ------------------------------------------------

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PutawayLine {
    pub sku_code: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PutawayPayload {
    pub schema_version: u32,
    /// The putaway's id: the event id.
    pub putaway_id: Uuid,
    /// The tagging job whose goods were put away.
    pub job_id: Uuid,
    pub session_id: Uuid,
    /// This site, in this node's spelling.
    pub site_id: String,
    /// The pool they stand in now.
    pub pool_id: String,
    pub lines: Vec<PutawayLine>,
    pub put_away_by: String,
    pub put_away_at: DateTime<Utc>,
}

pub fn parse_putaway(payload: &Value) -> Result<PutawayPayload, String> {
    let putaway: PutawayPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {INVENTORY_PUTAWAY_V1}: {error}"))?;
    if putaway.schema_version != FLOW_FACT_SCHEMA_VERSION {
        return Err(format!(
            "{INVENTORY_PUTAWAY_V1} schema_version must be {FLOW_FACT_SCHEMA_VERSION}"
        ));
    }
    for (field, value) in [
        ("site_id", &putaway.site_id),
        ("pool_id", &putaway.pool_id),
        ("put_away_by", &putaway.put_away_by),
    ] {
        if value.trim().is_empty() {
            return Err(format!("{INVENTORY_PUTAWAY_V1} names no {field}"));
        }
    }
    if putaway.lines.is_empty() {
        return Err("a putaway of nothing puts nothing away".into());
    }
    if putaway.lines.len() > MAX_FLOW_FACT_LINES {
        return Err(format!(
            "{INVENTORY_PUTAWAY_V1} carries more than {MAX_FLOW_FACT_LINES} lines"
        ));
    }
    for line in &putaway.lines {
        if line.sku_code.trim().is_empty() || line.quantity <= 0 {
            return Err(format!(
                "a putaway line of {} says {}",
                line.sku_code, line.quantity
            ));
        }
    }
    Ok(putaway)
}

// ---- the flow's outbox, told to a node --------------------------------------

/// One outbox row (`flow_event`), as a node receives it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlowEventNotice {
    /// `flow_event.id`: what the node keys it by, so a resend is one row.
    pub event_id: i64,
    #[serde(default)]
    pub stage_index: Option<i32>,
    /// `PICK`, `RECEIVE`… `None` for the document's own status.
    #[serde(default)]
    pub stage_kind: Option<String>,
    /// `STAGE_DONE`, `STAGE_PARKED`, `MOVEMENT`, `STATUS`…
    pub event_type: String,
    /// `NODE`: the node already wrote it and this is the flow's record of it.
    /// `HUB`: done in the hub, and the node hears of it here.
    pub executed_at: String,
    #[serde(default)]
    pub target_site_id: Option<String>,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
}

/// A flow document's events for one node: the document's facts, so a node that
/// never saw the document before can file them, and the events themselves.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlowEventsPayload {
    pub document_id: Uuid,
    /// `ALR-00000001`.
    pub document_number: String,
    pub template_code: String,
    pub template_name: String,
    /// `ALLOTMENT`, `PURCHASE_ORDER`…, and its id.
    pub source_kind: String,
    pub source_id: String,
    /// Our sites at either end, in the receiving node's own spelling where the
    /// node is one of them; `None` for an outside party's end.
    #[serde(default)]
    pub origin_site_id: Option<String>,
    #[serde(default)]
    pub destination_site_id: Option<String>,
    #[serde(default)]
    pub destination_party_kind: Option<String>,
    /// The document's status when the relay was built.
    pub status: String,
    /// The stage now due, when there is one.
    #[serde(default)]
    pub current_stage: Option<String>,
    pub events: Vec<FlowEventNotice>,
}

pub fn parse_flow_events(payload: &Value) -> Result<FlowEventsPayload, String> {
    let events: FlowEventsPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {INVENTORY_FLOW_EVENTS_V1}: {error}"))?;
    if events.document_number.trim().is_empty() {
        return Err(format!("{INVENTORY_FLOW_EVENTS_V1} names no document"));
    }
    if events.events.is_empty() {
        return Err(format!("{INVENTORY_FLOW_EVENTS_V1} carries no events"));
    }
    Ok(events)
}
