//! Allotment held by the Gudang server (GUDANG-SERVER-PLAN.md §0, step 4).
//!
//! Once the pen has moved (`INVENTORY_DC_HOSTING` off at Central, a DC node
//! owning head office's site), this server is the only writer of the Gudang's
//! stock and of the allotments that reserve it. Two roads reach it:
//!
//! - **At HO, on the LAN:** MD raises, edits and cancels here, on the same
//!   paths and JSON the hub uses at Central (`/api/v1/inventory/allotments…`).
//! - **Outside:** MD edits at Central, which forwards
//!   `inventory.allotment.amend.v1` ([`apply_amend_command`]) and shows
//!   "waiting for the Gudang" until this server's answer arrives.
//!
//! Either way the change is written once, here, and reported once, as one
//! fact (`inventory.allotment.amended.v1` / `.created.v1`), which is all
//! Central's copy is built from. The arithmetic is the cloud-run Gudang's
//! (`cloud::postgres::allotment_amend`, `cloud::dc::owed`, `cloud::dc::changes`),
//! which is the specification; only the counters it reads are this node's:
//!
//! - **to pack** (wanted, not yet in a carton) is `accepted − picked −
//!   cancelled`: here `picked` rises with packing, and a picked piece waiting
//!   in the pick area is still "to pack".
//! - **sent** (the floor) is what was packed and is no longer in a carton on
//!   the bench: `packed −` the line's pieces in unsent koli.
//! - Giving up what nobody picked, and picked pieces nobody wants any more, is
//!   written at once to `cancelled_quantity`. A waiting piece the line no
//!   longer wants is then simply surplus in the pick area — the "owed picked"
//!   the board shows, which `move_back` already knows to settle.
//! - Pieces taken out of cartons that have not left are `dc_allotment_takeout`
//!   until the carton is opened; [`settle_takeout`] writes them off then, as
//!   the cloud's `takeout_pending_quantity` closes short.

use crate::cloud::application::CancelAllotmentRequest;
use crate::cloud::dc::changes::{AcknowledgeRequest, DcChange, DcChangeLine};
use crate::cloud::dc::owed::{OwedKind, OwedKoli, OwedLine, OwedWork};
use crate::cloud::domain::{AllotmentType, DestinationType};
use crate::cloud::postgres::{
    AllotmentPackedStage, AllotmentWork, AllotmentWorkStage, AmendAllotmentRequest,
    AmendAllotmentResult, AmendedAllotmentLine,
};
use crate::edge::http::{name_the_actor, require_permission, run_blocking, ApiError, EdgeState};
use crate::edge::outbound::{picking_place, WAITING_PICK_UNITS};
use crate::edge::{
    derive_allotment_status, EdgeError, EdgePermission, EdgePrincipal, NodeContext,
    OperationalPool, SiteId,
};
use crate::sync::workflow::{
    AllotmentActivationLine, AllotmentActivationPayload, AllotmentAmendPayload,
    AllotmentAmendedLine, AllotmentAmendedPayload, AmendmentOutcome,
    INVENTORY_ALLOTMENT_AMENDED_V1, INVENTORY_ALLOTMENT_CREATED_V1,
    INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::str::FromStr;
use uuid::Uuid;

/// The books of 0099. Creates only; run before every write and read here, so
/// a server that never had an allotment changed still answers.
pub(crate) const SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0099_md_changes_an_allotment_at_the_gudang_and_the_gudang_sees_it.sql"
));

pub(crate) fn ensure_schema(connection: &Connection) -> Result<(), EdgeError> {
    connection.execute_batch(SCHEMA).map_err(db)
}

/// The routes MD and the Gudang use on this server. The three `/api/v1/dc`
/// ones replace the empty answers `edge::http` gave until now (`dc_owed`,
/// `dc_changes`, `dc_acknowledge_change`): take those out of its route table
/// when merging this, or axum refuses the overlap.
pub fn routes() -> Router<EdgeState> {
    Router::new()
        .route("/api/v1/inventory/allotments", post(create))
        .route("/api/v1/inventory/allotments/batch", post(create_batch))
        .route("/api/v1/inventory/allotments/{id}/amend", post(amend))
        .route("/api/v1/inventory/allotments/{id}/cancel", post(cancel))
        .route("/api/v1/inventory/allotments/{id}/work", get(work))
        .route("/api/v1/dc/owed", get(owed))
        .route("/api/v1/dc/changes", get(changes))
        .route("/api/v1/dc/changes/acknowledge", post(acknowledge))
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_time(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn parse_uuid(value: &str) -> Result<Uuid, EdgeError> {
    Uuid::parse_str(value).map_err(|error| EdgeError::Persistence(error.to_string()))
}

/// Who acted: the signed-in person, else what the request named.
fn actor(principal: Option<EdgePrincipal>, asked: &str) -> String {
    let mut actor_id = principal
        .map(|principal| principal.username)
        .unwrap_or_else(|| asked.trim().to_owned());
    name_the_actor(&mut actor_id);
    actor_id
}

/// A pool id as this server spells it: Central writes `dc.warehouse` (or
/// head office's own id) where this node runs as `dc-01`.
fn pool_here(pool_id: &str, site: &SiteId) -> String {
    match pool_id.trim().to_ascii_lowercase().split_once('.') {
        Some((_, rest)) => format!("{site}.{rest}"),
        None => pool_id.trim().to_ascii_lowercase(),
    }
}

/// The route words this table's CHECK knows (before 0611), back to the ones
/// the hub reads.
fn hub_type(stored: &str) -> &str {
    match stored {
        "TO_STORE" => "TO_SITE",
        "RETURN_TO_DC" => "RETURN_TO_WAREHOUSE",
        other => other,
    }
}

// ---------------------------------------------------------------------------
// Idempotency: a retried press does the change once
// ---------------------------------------------------------------------------

fn replayed(
    tx: &Transaction<'_>,
    key: &str,
    kind: &str,
    request_json: &str,
) -> Result<Option<Value>, EdgeError> {
    let held: Option<(String, String, String)> = tx
        .query_row(
            "SELECT kind, request_json, response_json FROM dc_allotment_request
              WHERE idempotency_key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;
    match held {
        None => Ok(None),
        Some((held_kind, held_request, response)) => {
            if held_kind != kind || held_request != request_json {
                return Err(EdgeError::Conflict(format!(
                    "idempotency key {key} was already used for a different request"
                )));
            }
            serde_json::from_str(&response)
                .map(Some)
                .map_err(|error| EdgeError::Persistence(error.to_string()))
        }
    }
}

fn remember(
    tx: &Transaction<'_>,
    key: &str,
    kind: &str,
    request_json: &str,
    response: &Value,
    at: DateTime<Utc>,
) -> Result<(), EdgeError> {
    tx.execute(
        "INSERT INTO dc_allotment_request
             (idempotency_key, kind, request_json, response_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![key, kind, request_json, response.to_string(), time_text(at)],
    )
    .map_err(db)?;
    Ok(())
}

fn require_key(key: &str) -> Result<String, EdgeError> {
    let key = key.trim();
    if key.is_empty() {
        return Err(EdgeError::Validation("idempotency_key is required".into()));
    }
    Ok(key.to_owned())
}

// ---------------------------------------------------------------------------
// Stock this server may still promise
// ---------------------------------------------------------------------------

/// What is free of `sku_code` at `pool_id`: on the racks and in the pick area
/// beside them, less everything still to pack against that pool. The same
/// measure an activation from Central is checked with (`edge::sync`).
fn free_stock(
    tx: &Transaction<'_>,
    site: &SiteId,
    pool_id: &str,
    sku_code: &str,
) -> Result<i64, EdgeError> {
    let shelf = format!("{pool_id}:on_hand");
    let pick_area = match OperationalPool::from_str(pool_id) {
        Ok(pool) if matches!(pool.role(), crate::pool_role::PoolRole::Stockroom) => {
            let area = OperationalPool::DcOutboundPicking {
                dc_id: site.clone(),
            };
            format!("{}:on_hand", area.id())
        }
        _ => shelf.clone(),
    };
    let physical: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(projection.quantity),0)
               FROM inventory_projection projection
               JOIN inventory_subject subject ON subject.id=projection.subject_id
              WHERE projection.place_id IN (?1, ?3) AND subject.sku_code=?2",
            params![shelf, sku_code, pick_area],
            |row| row.get(0),
        )
        .map_err(db)?;
    let reserved: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(line.accepted_quantity-line.picked_quantity-line.cancelled_quantity),0)
               FROM dc_allotment_work_line line
               JOIN dc_allotment_work work ON work.allotment_id=line.allotment_id
              WHERE work.application_status='ACCEPTED'
                AND line.source_pool_id=?1 AND line.sku_code=?2",
            params![pool_id, sku_code],
            |row| row.get(0),
        )
        .map_err(db)?;
    Ok((physical - reserved).max(0))
}

/// A pool this server fills cartons from.
fn source_pool(site: &SiteId, pool_id: &str) -> Result<String, EdgeError> {
    let pool = OperationalPool::from_str(pool_id)
        .map_err(|error| EdgeError::Validation(error.to_string()))?;
    if !pool.is_fulfillment_source_for(site) {
        return Err(EdgeError::Validation(format!(
            "{pool_id} is not a pool of goods at rest at {site}"
        )));
    }
    Ok(pool.id())
}

/// The SKU code this server knows a SKU id by. Central's catalogue is not
/// here yet (step 4 pushes it later), so the hub may send it with the line;
/// otherwise an allotment this server already held names it.
fn sku_code_of(
    tx: &Transaction<'_>,
    sku_id: Uuid,
    sent: Option<&str>,
) -> Result<String, EdgeError> {
    if let Some(code) = sent.map(str::trim).filter(|code| !code.is_empty()) {
        return Ok(code.to_ascii_uppercase());
    }
    tx.query_row(
        "SELECT sku_code FROM dc_allotment_work_line WHERE sku_id = ?1 LIMIT 1",
        params![sku_id.to_string()],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(db)?
    .map(|code| code.to_ascii_uppercase())
    .ok_or_else(|| {
        EdgeError::Validation(format!(
            "this Gudang server does not know SKU {sku_id} yet; send its sku_code with the line"
        ))
    })
}

// ---------------------------------------------------------------------------
// One line, as a change reads it
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct LineState {
    line_id: String,
    source_pool_id: String,
    destination_type: String,
    destination_id: String,
    sku_id: String,
    sku_code: String,
    planned: i64,
    accepted: i64,
    picked: i64,
    packed: i64,
    cancelled: i64,
    /// What MD's reductions and cancels took, released or owed.
    taken: i64,
    /// This line's pieces in koli that have not left.
    in_boxes: i64,
    /// Of those, the ones MD already took out.
    pending: i64,
    /// Picked pieces waiting in the pick area that this line still wants.
    waiting: i64,
}

impl LineState {
    fn target(&self) -> i64 {
        (self.planned - self.taken).max(0)
    }
    fn floor(&self) -> i64 {
        (self.packed - self.in_boxes).max(0)
    }
    fn to_pack(&self) -> i64 {
        (self.accepted - self.picked - self.cancelled).max(0)
    }
    fn picked_wanted(&self) -> i64 {
        self.waiting.min(self.to_pack())
    }
    fn in_cartons(&self) -> i64 {
        (self.in_boxes - self.pending).max(0)
    }
    /// What MD's Edit may not move: everything the warehouse has worked.
    fn worked(&self) -> i64 {
        let unpicked = (self.to_pack() - self.picked_wanted()).max(0);
        (self.target() - unpicked)
            .max(self.floor())
            .min(self.target())
    }
    fn below_floor(&self) -> EdgeError {
        EdgeError::Conflict(format!(
            "{} to {}: {} pcs already sent, so it cannot go below {}.",
            self.sku_code,
            self.destination_id,
            self.floor(),
            self.floor()
        ))
    }
    fn below_worked(&self) -> EdgeError {
        let worked = self.worked();
        EdgeError::Conflict(format!(
            "{} to {}: {} pcs are already picked, packed or sent, so an edit cannot go below {}. Ask Ops to put them back to the picklist to move them.",
            self.sku_code, self.destination_id, worked, worked
        ))
    }
    fn unchanged(&self) -> Result<AmendedAllotmentLine, EdgeError> {
        Ok(AmendedAllotmentLine {
            allotment_line_id: parse_uuid(&self.line_id)?,
            sku_code: self.sku_code.clone(),
            was: self.target(),
            now: self.target(),
            released: 0,
            owed: 0,
            floor: self.floor(),
        })
    }
}

/// Picked pieces waiting in the pick area for this allotment, per shop × SKU.
fn waiting_by_group(
    connection: &Connection,
    site: &SiteId,
    allotment_id: Option<&str>,
) -> Result<BTreeMap<(String, String, String), i64>, EdgeError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT s.allotment_id, s.destination_id, u.sku_code, COUNT(*)
               {WAITING_PICK_UNITS}
                AND s.allotment_id IS NOT NULL
                AND (?2 IS NULL OR s.allotment_id = ?2)
              GROUP BY s.allotment_id, s.destination_id, u.sku_code"
        ))
        .map_err(db)?;
    let rows = statement
        .query_map(params![picking_place(site.as_str()), allotment_id], |row| {
            Ok((
                (
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ),
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(db)?;
    Ok(rows)
}

const LINE_STATE: &str = "
    SELECT l.allotment_line_id, l.allotment_id, l.source_pool_id, l.destination_type,
           l.destination_id, l.sku_id, upper(l.sku_code), l.planned_quantity,
           l.accepted_quantity, l.picked_quantity, l.packed_quantity, l.cancelled_quantity,
           COALESCE((SELECT SUM(a.released + a.owed) FROM dc_allotment_amendment a
                      WHERE a.allotment_line_id = l.allotment_line_id
                        AND a.kind IN ('REDUCE', 'CANCEL')), 0),
           (SELECT COUNT(*) FROM koli_unit u JOIN koli k ON k.koli_id = u.koli_id
             WHERE u.allotment_line_id = l.allotment_line_id AND u.released_at IS NULL
               AND u.current_stage = 'PACKED' AND k.shipment_id IS NULL),
           COALESCE((SELECT t.pending FROM dc_allotment_takeout t
                      WHERE t.allotment_line_id = l.allotment_line_id), 0)
      FROM dc_allotment_work_line l";

/// Every line of the allotments asked for (all when `None`), with this
/// server's figures, waiting pieces shared out line by line up to what each
/// still wants. The surplus — waiting beyond any line's want — is returned
/// per allotment × shop × SKU: it is what the Gudang owes the racks.
#[allow(clippy::type_complexity)]
fn load_lines(
    connection: &Connection,
    site: &SiteId,
    allotment_id: Option<&str>,
) -> Result<
    (
        Vec<(String, LineState)>,
        BTreeMap<(String, String, String), i64>,
    ),
    EdgeError,
> {
    let mut statement = connection
        .prepare(&format!(
            "{LINE_STATE} WHERE (?1 IS NULL OR l.allotment_id = ?1)
              ORDER BY l.allotment_id, l.allotment_line_id"
        ))
        .map_err(db)?;
    let mut lines = statement
        .query_map(params![allotment_id], |row| {
            Ok((
                row.get::<_, String>(1)?,
                LineState {
                    line_id: row.get(0)?,
                    source_pool_id: row.get(2)?,
                    destination_type: row.get(3)?,
                    destination_id: row.get(4)?,
                    sku_id: row.get(5)?,
                    sku_code: row.get(6)?,
                    planned: row.get(7)?,
                    accepted: row.get(8)?,
                    picked: row.get(9)?,
                    packed: row.get(10)?,
                    cancelled: row.get(11)?,
                    taken: row.get(12)?,
                    in_boxes: row.get(13)?,
                    pending: row.get(14)?,
                    waiting: 0,
                },
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let mut left = waiting_by_group(connection, site, allotment_id)?;
    for (allotment, line) in &mut lines {
        let key = (
            allotment.clone(),
            line.destination_id.clone(),
            line.sku_code.clone(),
        );
        if let Some(waits) = left.get_mut(&key) {
            let share = (*waits).min(line.to_pack());
            line.waiting = share;
            *waits -= share;
        }
    }
    left.retain(|_, surplus| *surplus > 0);
    Ok((lines, left))
}

// ---------------------------------------------------------------------------
// The change itself
// ---------------------------------------------------------------------------

/// A line MD adds, resolved to this server's spelling.
#[derive(Clone, Debug)]
struct NewLine {
    line_id: Uuid,
    source_pool_id: String,
    destination_type: String,
    destination_id: String,
    sku_id: Uuid,
    sku_code: String,
    quantity: i64,
}

#[derive(Clone, Debug)]
struct AmendInput {
    reason: Option<String>,
    actor_id: String,
    move_only: bool,
    cancelling: bool,
    lines: BTreeMap<Uuid, i64>,
    add: Vec<NewLine>,
    request_id: Option<Uuid>,
}

struct Header {
    allotment_number: String,
    allotment_type: String,
    fulfillment_status: String,
}

fn open_header(tx: &Transaction<'_>, allotment_id: &str) -> Result<Header, EdgeError> {
    let (number, kind, application, fulfillment): (String, String, String, String) = tx
        .query_row(
            "SELECT allotment_number, allotment_type, application_status, fulfillment_status
               FROM dc_allotment_work WHERE allotment_id = ?1",
            params![allotment_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| EdgeError::NotFound(format!("allotment {allotment_id}")))?;
    if application != "ACCEPTED"
        || !matches!(
            fulfillment.as_str(),
            "OPEN" | "IN_PROGRESS" | "DC_COMPLETED"
        )
    {
        return Err(EdgeError::Conflict(format!(
            "allotment {number} is {fulfillment}; there is nothing left to change"
        )));
    }
    // A cancel is the last word: one still open only because a carton has to
    // be opened is not edited again (cancelled demand is never revived).
    let cancelled: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM dc_allotment_md_cancel WHERE allotment_id = ?1)
                 OR EXISTS (SELECT 1 FROM dc_allotment_cancellation WHERE allotment_id = ?1)",
            params![allotment_id],
            |row| row.get(0),
        )
        .map_err(db)?;
    if cancelled {
        return Err(EdgeError::Conflict("This allotment is cancelled.".into()));
    }
    Ok(Header {
        allotment_number: number,
        allotment_type: kind,
        fulfillment_status: fulfillment,
    })
}

fn refresh_status(tx: &Transaction<'_>, allotment_id: &str, at: &str) -> Result<String, EdgeError> {
    let (accepted, packed, dispatched, cancelled): (i64, i64, i64, i64) = tx
        .query_row(
            "SELECT COALESCE(SUM(accepted_quantity),0), COALESCE(SUM(packed_quantity),0),
                    COALESCE(SUM(dispatched_quantity),0), COALESCE(SUM(cancelled_quantity),0)
               FROM dc_allotment_work_line WHERE allotment_id=?1",
            params![allotment_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(db)?;
    let status = derive_allotment_status(accepted, packed, dispatched, cancelled, false)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    tx.execute(
        "UPDATE dc_allotment_work SET fulfillment_status=?2, updated_at=?3
          WHERE allotment_id=?1 AND application_status='ACCEPTED'",
        params![allotment_id, status.as_str(), at],
    )
    .map_err(db)?;
    Ok(status.as_str().to_owned())
}

/// An edit that only moves: per SKU, the targets after the change sum to what
/// the SKU's lines held before (owner, 18 Oct 2026).
fn check_moves_only(
    standing: &[LineState],
    asked: &BTreeMap<Uuid, i64>,
    add: &[NewLine],
) -> Result<(), EdgeError> {
    let mut totals: BTreeMap<String, (String, i64, i64)> = BTreeMap::new();
    for line in standing {
        let id = parse_uuid(&line.line_id)?;
        let entry = totals
            .entry(line.sku_id.clone())
            .or_insert_with(|| (line.sku_code.clone(), 0, 0));
        entry.1 += line.target();
        entry.2 += asked.get(&id).copied().unwrap_or(line.target());
    }
    for line in add {
        let Some(entry) = totals.get_mut(&line.sku_id.to_string()) else {
            return Err(EdgeError::Validation(
                "an edit only moves pieces the allotment already holds; a SKU it does not have is a new allotment".into(),
            ));
        };
        entry.2 += line.quantity;
    }
    for (code, was, now) in totals.values() {
        if was != now {
            return Err(EdgeError::Validation(format!(
                "An edit only moves pieces between stores: {code} would go from {was} to {now} pcs. Place every piece, or cancel what is not wanted."
            )));
        }
    }
    Ok(())
}

/// MD's change, applied to this server's lines and reported once.
///
/// Inside a savepoint: a refusal halfway leaves nothing written, which
/// matters most for a change Central forwarded, whose transaction still
/// commits — with the refusal as its answer.
fn amend_tx(
    tx: &Transaction<'_>,
    node: &NodeContext,
    allotment_id: Uuid,
    input: &AmendInput,
    at: DateTime<Utc>,
) -> Result<(AmendAllotmentResult, AllotmentAmendedPayload), EdgeError> {
    tx.execute_batch("SAVEPOINT dc_allotment_amend")
        .map_err(db)?;
    match amend_inner(tx, node, allotment_id, input, at) {
        Ok(done) => {
            tx.execute_batch("RELEASE dc_allotment_amend").map_err(db)?;
            Ok(done)
        }
        Err(error) => {
            tx.execute_batch("ROLLBACK TO dc_allotment_amend; RELEASE dc_allotment_amend")
                .map_err(db)?;
            Err(error)
        }
    }
}

fn amend_inner(
    tx: &Transaction<'_>,
    node: &NodeContext,
    allotment_id: Uuid,
    input: &AmendInput,
    at: DateTime<Utc>,
) -> Result<(AmendAllotmentResult, AllotmentAmendedPayload), EdgeError> {
    let id_text = allotment_id.to_string();
    let header = open_header(tx, &id_text)?;
    let (standing, _) = load_lines(tx, &node.site_id, Some(&id_text))?;
    let standing: Vec<LineState> = standing.into_iter().map(|(_, line)| line).collect();
    let mut by_id: HashMap<Uuid, &LineState> = HashMap::new();
    for line in &standing {
        by_id.insert(parse_uuid(&line.line_id)?, line);
    }
    // Every line is checked before anything is written, so a refusal changes
    // nothing.
    for (line_id, to) in &input.lines {
        let line = by_id.get(line_id).ok_or_else(|| {
            EdgeError::NotFound(format!("allotment line {line_id} on this allotment"))
        })?;
        if *to < 0 {
            return Err(EdgeError::Validation("a line cannot go below zero".into()));
        }
        if *to != line.target() && *to < line.floor() {
            return Err(line.below_floor());
        }
        if input.cancelling && *to > line.target() {
            return Err(EdgeError::Conflict("a cancel never adds to a line".into()));
        }
        if input.move_only && *to < line.target() && *to < line.worked() {
            return Err(line.below_worked());
        }
    }
    if input.move_only {
        check_moves_only(&standing, &input.lines, &input.add)?;
    }
    if !input.add.is_empty() && header.allotment_type != "TO_STORE" {
        return Err(EdgeError::Conflict(
            "only an allotment to stores takes new lines; a return goes where it goes".into(),
        ));
    }

    let at_text = time_text(at);
    let mut amended: HashMap<Uuid, AmendedAllotmentLine> = HashMap::new();
    let mut fact_lines = Vec::new();
    // Reductions first: what they give up is free for an addition in the same
    // change (300 from one store to another).
    for reducing in [true, false] {
        for line in &standing {
            let line_id = parse_uuid(&line.line_id)?;
            let Some(&to) = input.lines.get(&line_id) else {
                continue;
            };
            let was = line.target();
            if to == was || (to < was) != reducing {
                continue;
            }
            let (kind, released, cancelled_now, owed, carton_owed, added) = if to < was {
                let taken = was - to;
                // Only what can still physically change: a target above what
                // the store would get anyway stands on pieces already given up.
                let coming = line.floor() + line.to_pack() + line.in_cartons();
                let physical = (coming - to).clamp(0, taken);
                let unpicked = (line.to_pack() - line.picked_wanted()).max(0);
                let closed_now = physical.min(unpicked);
                // Picked pieces nobody wants are owed to the racks; written
                // off the demand now, they stand as surplus in the pick area
                // until `move_back` takes them.
                let pick_owed = (physical - closed_now).min(line.picked_wanted());
                let carton_owed = physical - closed_now - pick_owed;
                let owed = pick_owed + carton_owed;
                let kind = if input.cancelling { "CANCEL" } else { "REDUCE" };
                (
                    kind,
                    taken - owed,
                    closed_now + pick_owed,
                    owed,
                    carton_owed,
                    0,
                )
            } else {
                let added = to - was;
                let free = free_stock(tx, &node.site_id, &line.source_pool_id, &line.sku_code)?;
                if added > free {
                    return Err(EdgeError::Conflict(format!(
                        "{} to {}: only {} pcs free at {}, {added} asked.",
                        line.sku_code, line.destination_id, free, line.source_pool_id
                    )));
                }
                ("ADD", 0, 0, 0, 0, added)
            };
            let written = tx
                .execute(
                    "UPDATE dc_allotment_work_line
                        SET planned_quantity = planned_quantity + ?2,
                            accepted_quantity = accepted_quantity + ?2,
                            cancelled_quantity = cancelled_quantity + ?3,
                            updated_at = ?4
                      WHERE allotment_line_id = ?1
                        AND accepted_quantity - picked_quantity - cancelled_quantity >= ?3",
                    params![line.line_id, added, cancelled_now, at_text],
                )
                .map_err(db)?;
            if written != 1 {
                return Err(EdgeError::Conflict(format!(
                    "allotment line {} changed while it was being edited",
                    line.line_id
                )));
            }
            if carton_owed > 0 {
                tx.execute(
                    "INSERT INTO dc_allotment_takeout (allotment_line_id, pending, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT (allotment_line_id)
                     DO UPDATE SET pending = pending + ?2, updated_at = ?3",
                    params![line.line_id, carton_owed, at_text],
                )
                .map_err(db)?;
            }
            let amendment_id = Uuid::new_v4();
            tx.execute(
                "INSERT INTO dc_allotment_amendment
                     (amendment_id, allotment_id, allotment_line_id, kind, target_before,
                      target_after, released, owed, cancelled_now, reason, actor_id,
                      created_at, request_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    amendment_id.to_string(),
                    id_text,
                    line.line_id,
                    kind,
                    was,
                    to,
                    released,
                    owed,
                    cancelled_now,
                    input.reason,
                    input.actor_id,
                    at_text,
                    input.request_id.map(|id| id.to_string()),
                ],
            )
            .map_err(db)?;
            fact_lines.push(AllotmentAmendedLine {
                amendment_id,
                allotment_line_id: line_id,
                sku_code: line.sku_code.clone(),
                kind: kind.to_owned(),
                target_before: was,
                target_after: to,
                released,
                owed,
                cancelled_now,
            });
            amended.insert(
                line_id,
                AmendedAllotmentLine {
                    allotment_line_id: line_id,
                    sku_code: line.sku_code.clone(),
                    was,
                    now: to,
                    released,
                    owed,
                    floor: line.floor(),
                },
            );
        }
    }

    // Lines the allotment did not have, each against the stock still free.
    let mut added = Vec::with_capacity(input.add.len());
    let mut added_wire = Vec::with_capacity(input.add.len());
    for line in &input.add {
        if standing.iter().any(|one| {
            one.sku_code == line.sku_code
                && one.destination_id == line.destination_id
                && one.source_pool_id == line.source_pool_id
        }) {
            return Err(EdgeError::Validation(format!(
                "{} already has this SKU on the allotment: change its quantity",
                line.destination_id
            )));
        }
        if line.destination_id == node.site_id.as_str() {
            return Err(EdgeError::Validation(
                "an allotment line cannot send goods to the site they stand at".into(),
            ));
        }
        let free = free_stock(tx, &node.site_id, &line.source_pool_id, &line.sku_code)?;
        if line.quantity > free {
            return Err(EdgeError::Conflict(format!(
                "{} to {}: only {} pcs free at {}, {} asked.",
                line.sku_code, line.destination_id, free, line.source_pool_id, line.quantity
            )));
        }
        tx.execute(
            "INSERT INTO dc_allotment_work_line
                 (allotment_line_id, allotment_id, source_pool_id, destination_type,
                  destination_id, sku_id, sku_code, planned_quantity, accepted_quantity,
                  updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)",
            params![
                line.line_id.to_string(),
                id_text,
                line.source_pool_id,
                line.destination_type,
                line.destination_id,
                line.sku_id.to_string(),
                line.sku_code,
                line.quantity,
                at_text,
            ],
        )
        .map_err(db)?;
        let amendment_id = Uuid::new_v4();
        tx.execute(
            "INSERT INTO dc_allotment_amendment
                 (amendment_id, allotment_id, allotment_line_id, kind, target_before,
                  target_after, released, owed, cancelled_now, reason, actor_id, created_at,
                  request_id)
             VALUES (?1, ?2, ?3, 'ADD', 0, ?4, 0, 0, 0, ?5, ?6, ?7, ?8)",
            params![
                amendment_id.to_string(),
                id_text,
                line.line_id.to_string(),
                line.quantity,
                input.reason,
                input.actor_id,
                at_text,
                input.request_id.map(|id| id.to_string()),
            ],
        )
        .map_err(db)?;
        fact_lines.push(AllotmentAmendedLine {
            amendment_id,
            allotment_line_id: line.line_id,
            sku_code: line.sku_code.clone(),
            kind: "ADD".into(),
            target_before: 0,
            target_after: line.quantity,
            released: 0,
            owed: 0,
            cancelled_now: 0,
        });
        added_wire.push(AllotmentActivationLine {
            allotment_line_id: line.line_id,
            source_pool_id: line.source_pool_id.clone(),
            destination_type: line.destination_type.clone(),
            destination_id: line.destination_id.clone(),
            sku_id: line.sku_id,
            sku_code: line.sku_code.clone(),
            quantity: line.quantity,
        });
        added.push(AmendedAllotmentLine {
            allotment_line_id: line.line_id,
            sku_code: line.sku_code.clone(),
            was: 0,
            now: line.quantity,
            released: 0,
            owed: 0,
            floor: 0,
        });
    }
    if fact_lines.is_empty() {
        return Err(EdgeError::Conflict(
            "nothing on this allotment changes; every line already stands there".into(),
        ));
    }
    if input.cancelling {
        tx.execute(
            "INSERT OR IGNORE INTO dc_allotment_md_cancel
                 (allotment_id, reason, actor_id, cancelled_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![id_text, input.reason, input.actor_id, at_text],
        )
        .map_err(db)?;
    }
    let _ = header.fulfillment_status;
    refresh_status(tx, &id_text, &at_text)?;

    let fact = AllotmentAmendedPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        result_id: Uuid::new_v4(),
        amendment_request_id: input.request_id,
        allotment_id,
        source_site_id: node.site_id.to_string(),
        outcome: AmendmentOutcome::Applied,
        refusal: None,
        reason: input.reason.clone(),
        cancelled: input.cancelling,
        actor_id: input.actor_id.clone(),
        applied_at: at,
        lines: fact_lines,
        added: added_wire,
    };
    fact.validate().map_err(EdgeError::Validation)?;
    crate::edge::sync::enqueue_fact(tx, fact.result_id, INVENTORY_ALLOTMENT_AMENDED_V1, &fact)
        .map_err(db)?;
    // A reservation moved: the checkpoint Central reconciles against.
    crate::edge::SqliteEdge::enqueue_pool_snapshot(tx, node, Uuid::new_v4())?;

    let mut lines = Vec::with_capacity(input.lines.len());
    for line_id in input.lines.keys() {
        match amended.remove(line_id) {
            Some(line) => lines.push(line),
            None => {
                if let Some(line) = by_id.get(line_id) {
                    lines.push(line.unchanged()?);
                }
            }
        }
    }
    let result = AmendAllotmentResult {
        id: allotment_id,
        allotment_number: header.allotment_number,
        released_total: lines.iter().map(|line| line.released).sum(),
        owed_total: lines.iter().map(|line| line.owed).sum(),
        lines,
        added,
        // Written here, where the allotment is held: nothing waits.
        edge_amendment_status: None,
        amendment_request_id: None,
    };
    Ok((result, fact))
}

// ---------------------------------------------------------------------------
// Central's road: the forwarded edit
// ---------------------------------------------------------------------------

/// `inventory.allotment.amend.v1`, applied in the command's transaction
/// (`edge::sync::apply_command_effect`).
///
/// Never an error for a change that cannot be made: the answer is a REJECTED
/// fact with the reason, so Central stops showing "waiting for the Gudang"
/// and MD reads why. An error would block this server's whole command stream
/// on one edit somebody made outside HO.
pub(crate) fn apply_amend_command(
    tx: &Transaction<'_>,
    payload: &AllotmentAmendPayload,
) -> Result<(), crate::sync::SyncError> {
    let fail = |error: EdgeError| crate::sync::SyncError::new(error.to_string());
    ensure_schema(tx).map_err(fail)?;
    let node = resident_node(tx).map_err(fail)?;
    let at = Utc::now();
    let outcome = if payload.source_site_id.trim().to_ascii_lowercase() != node.site_id.as_str() {
        Err(EdgeError::Conflict(format!(
            "this Gudang server is {}, not {}",
            node.site_id, payload.source_site_id
        )))
    } else {
        forwarded_input(&node, payload)
            .and_then(|input| amend_tx(tx, &node, payload.allotment_id, &input, at))
    };
    match outcome {
        Ok(_) => Ok(()),
        // A database that fails is not an answer: the command is retried.
        Err(EdgeError::Persistence(reason)) => Err(crate::sync::SyncError::new(reason)),
        Err(refused) => {
            let fact = AllotmentAmendedPayload {
                schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
                result_id: Uuid::new_v4(),
                amendment_request_id: Some(payload.amendment_request_id),
                allotment_id: payload.allotment_id,
                source_site_id: node.site_id.to_string(),
                outcome: AmendmentOutcome::Rejected,
                refusal: Some(match refused {
                    EdgeError::Validation(text)
                    | EdgeError::Conflict(text)
                    | EdgeError::NotFound(text) => text,
                    other => other.to_string(),
                }),
                reason: payload.reason.clone(),
                cancelled: false,
                actor_id: payload.requested_by.clone(),
                applied_at: at,
                lines: Vec::new(),
                added: Vec::new(),
            };
            crate::edge::sync::enqueue_fact(
                tx,
                fact.result_id,
                INVENTORY_ALLOTMENT_AMENDED_V1,
                &fact,
            )
            .map_err(|error| crate::sync::SyncError::new(error.to_string()))?;
            Ok(())
        }
    }
}

fn resident_node(tx: &Transaction<'_>) -> Result<NodeContext, EdgeError> {
    let (node_id, role, site_id): (String, String, String) = tx
        .query_row(
            "SELECT node_id, role, site_id FROM node_metadata WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(db)?;
    let role = crate::edge::EdgeRole::from_str(&role)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    let site_id =
        SiteId::new(site_id).map_err(|error| EdgeError::Persistence(error.to_string()))?;
    NodeContext::new(node_id, role, site_id)
}

fn forwarded_input(
    node: &NodeContext,
    payload: &AllotmentAmendPayload,
) -> Result<AmendInput, EdgeError> {
    let mut add = Vec::with_capacity(payload.add.len());
    for line in &payload.add {
        add.push(NewLine {
            line_id: line.allotment_line_id,
            source_pool_id: source_pool(
                &node.site_id,
                &pool_here(&line.source_pool_id, &node.site_id),
            )?,
            destination_type: line.destination_type.clone(),
            destination_id: line.destination_id.trim().to_ascii_lowercase(),
            sku_id: line.sku_id,
            sku_code: line.sku_code.trim().to_ascii_uppercase(),
            quantity: line.quantity,
        });
    }
    Ok(AmendInput {
        reason: payload.reason.clone(),
        actor_id: payload.requested_by.clone(),
        move_only: payload.move_only,
        cancelling: false,
        lines: payload
            .lines
            .iter()
            .map(|line| (line.allotment_line_id, line.to))
            .collect(),
        add,
        request_id: Some(payload.amendment_request_id),
    })
}

/// The Gudang opened a carton (`move_back`, Packed): pieces MD had already
/// taken out of it are written off the line's demand now, so the picklist
/// does not ask for them again. Returns how many were settled. Called inside
/// `move_back`'s transaction after the line's picked and packed fell by `n`.
pub(crate) fn settle_takeout(
    tx: &Transaction<'_>,
    allotment_line_id: &str,
    n: i64,
    at: &str,
) -> Result<i64, EdgeError> {
    ensure_schema(tx)?;
    let pending: i64 = tx
        .query_row(
            "SELECT pending FROM dc_allotment_takeout WHERE allotment_line_id = ?1",
            params![allotment_line_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?
        .unwrap_or(0);
    let settled = pending.min(n).max(0);
    if settled == 0 {
        return Ok(0);
    }
    tx.execute(
        "UPDATE dc_allotment_takeout SET pending = pending - ?2, updated_at = ?3
          WHERE allotment_line_id = ?1",
        params![allotment_line_id, settled, at],
    )
    .map_err(db)?;
    let written = tx
        .execute(
            "UPDATE dc_allotment_work_line
                SET cancelled_quantity = cancelled_quantity + ?2, updated_at = ?3
              WHERE allotment_line_id = ?1
                AND accepted_quantity - picked_quantity - cancelled_quantity >= ?2",
            params![allotment_line_id, settled, at],
        )
        .map_err(db)?;
    if written != 1 {
        return Err(EdgeError::Conflict(format!(
            "allotment line {allotment_line_id} cannot take back {settled} pieces MD took out"
        )));
    }
    Ok(settled)
}

// ---------------------------------------------------------------------------
// The LAN road: MD on this server
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, serde::Serialize)]
struct CreateLine {
    #[serde(default)]
    source_site_id: String,
    source_pool_id: String,
    destination_type: DestinationType,
    destination_id: String,
    sku_id: Uuid,
    quantity: i64,
    /// Not in Central's request: this server has no catalogue of its own yet,
    /// so the app that talks to it on the LAN sends the code beside the id.
    #[serde(default)]
    sku_code: Option<String>,
}

/// Central's `CreateAllotmentRequest`, plus each line's optional `sku_code`.
#[derive(Clone, Debug, Deserialize, serde::Serialize)]
struct CreateRequest {
    #[serde(rename = "type")]
    allotment_type: AllotmentType,
    lines: Vec<CreateLine>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    actor_id: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
struct BatchRequest {
    items: Vec<CreateRequest>,
}

async fn create(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<CreateRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryMove)?;
    let body = create_one(&state, principal, request).await?;
    Ok((StatusCode::CREATED, Json(body)))
}

/// One allotment per article, in order; earlier ones stand if a later one is
/// refused, as at Central.
async fn create_batch(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<BatchRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryMove)?;
    if request.items.is_empty() || request.items.len() > 10 {
        return Err(ApiError(EdgeError::Validation(
            "an allotment batch needs between 1 and 10 articles".into(),
        )));
    }
    let mut items = Vec::with_capacity(request.items.len());
    for (index, item) in request.items.into_iter().enumerate() {
        match create_one(&state, principal.clone(), item).await {
            Ok(body) => items.push(body),
            Err(ApiError(error)) => {
                return Ok(Json(json!({
                    "items": items, "failed_index": index, "problem": error.to_string()
                })))
            }
        }
    }
    Ok(Json(
        json!({"items": items, "failed_index": null, "problem": null}),
    ))
}

async fn create_one(
    state: &EdgeState,
    principal: Option<EdgePrincipal>,
    request: CreateRequest,
) -> Result<Value, ApiError> {
    let actor_id = actor(principal, &request.actor_id);
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let at = state.clock.now();
    run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        let tx = guard
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let body = create_tx(&tx, &node, &request, &actor_id, at)?;
        tx.commit().map_err(db)?;
        Ok(body)
    })
    .await
}

/// MD raises an allotment on this server: checked against the stock here,
/// accepted as it is written, and reported to Central as created.
fn create_tx(
    tx: &Transaction<'_>,
    node: &NodeContext,
    request: &CreateRequest,
    actor_id: &str,
    at: DateTime<Utc>,
) -> Result<Value, EdgeError> {
    let key = require_key(&request.idempotency_key)?;
    let request_json = serde_json::to_string(request)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    if let Some(answer) = replayed(tx, &key, "CREATE_ALLOTMENT", &request_json)? {
        return Ok(answer);
    }
    // A return to a supplier involves an outside party and stays Central's
    // (GUDANG-SERVER-PLAN §0); a return to the Gudang is a shop's to send.
    if request.allotment_type != AllotmentType::ToSite {
        return Err(EdgeError::Validation(
            "the Gudang server raises allotments to stores; returns are raised at Central".into(),
        ));
    }
    if request.lines.is_empty() {
        return Err(EdgeError::Validation(
            "allotment must contain at least one line".into(),
        ));
    }
    let site = &node.site_id;
    let mut lines: Vec<AllotmentActivationLine> = Vec::with_capacity(request.lines.len());
    let mut identities = BTreeSet::new();
    for line in &request.lines {
        if line.quantity <= 0 {
            return Err(EdgeError::Validation(
                "allotment line quantity must be positive".into(),
            ));
        }
        let destination_type = match line.destination_type {
            DestinationType::Store | DestinationType::Site => "STORE",
            DestinationType::Warehouse | DestinationType::Supplier => {
                return Err(EdgeError::Validation(
                    "an allotment from the Gudang goes to a store".into(),
                ))
            }
        };
        let destination_id = line.destination_id.trim().to_ascii_lowercase();
        if destination_id.is_empty() {
            return Err(EdgeError::Validation(
                "line source and destination identifiers are required".into(),
            ));
        }
        if destination_id == site.as_str() {
            return Err(EdgeError::Validation(
                "an allotment line cannot send goods to the site they stand at".into(),
            ));
        }
        let source_pool_id = source_pool(site, &pool_here(&line.source_pool_id, site))?;
        let sku_code = sku_code_of(tx, line.sku_id, line.sku_code.as_deref())?;
        if !identities.insert((source_pool_id.clone(), destination_id.clone(), line.sku_id)) {
            return Err(EdgeError::Validation(
                "duplicate allotment line identity".into(),
            ));
        }
        lines.push(AllotmentActivationLine {
            allotment_line_id: Uuid::new_v4(),
            source_pool_id,
            destination_type: destination_type.into(),
            destination_id,
            sku_id: line.sku_id,
            sku_code,
            quantity: line.quantity,
        });
    }
    // The supply is the pool and SKU, not the destination: several lines may
    // share one answer, and refuse together.
    let mut requested: BTreeMap<(String, String), i64> = BTreeMap::new();
    for line in &lines {
        *requested
            .entry((line.source_pool_id.clone(), line.sku_code.clone()))
            .or_default() += line.quantity;
    }
    let mut shortages = Vec::new();
    for ((pool_id, sku_code), wanted) in &requested {
        let free = free_stock(tx, site, pool_id, sku_code)?;
        if *wanted > free {
            shortages.push(format!(
                "cannot allot {sku_code} from {pool_id}: available {free}, requested {wanted}"
            ));
        }
    }
    if !shortages.is_empty() {
        return Err(EdgeError::Conflict(shortages.join("; ")));
    }

    // The server's own number: one raised while the line is down must never
    // take a number Central gives out.
    tx.execute(
        "INSERT INTO dc_allotment_number (singleton, last) VALUES (1, 1)
         ON CONFLICT (singleton) DO UPDATE SET last = last + 1",
        [],
    )
    .map_err(db)?;
    let sequence: i64 = tx
        .query_row(
            "SELECT last FROM dc_allotment_number WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(db)?;
    let allotment_id = Uuid::new_v4();
    let allotment_number = format!("ALT-G{sequence:07}");
    let notes = request
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned);
    let created = AllotmentActivationPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        allotment_id,
        allotment_number: allotment_number.clone(),
        allotment_type: AllotmentType::ToSite.wire_code().to_owned(),
        status: "ACTIVE".into(),
        source_site_id: site.to_string(),
        created_by: actor_id.to_owned(),
        notes: notes.clone(),
        created_at: at,
        lines: lines.clone(),
    };
    created.validate().map_err(EdgeError::Validation)?;
    let event_id = Uuid::new_v4();
    let fact_seq =
        crate::edge::sync::enqueue_fact(tx, event_id, INVENTORY_ALLOTMENT_CREATED_V1, &created)
            .map_err(db)?
            .ok_or_else(|| {
                EdgeError::Configuration(
                    "this server is not sending to Central, so it cannot raise an allotment".into(),
                )
            })?;
    let at_text = time_text(at);
    // Written as an accepted activation, so picking, packing and dispatch
    // treat it exactly as one Central sent. The node mints the ids that a
    // command from Central would otherwise have carried.
    tx.execute(
        "INSERT INTO dc_allotment_work
             (allotment_id, command_id, allotment_number, allotment_type, source_site_id,
              application_status, fulfillment_status, application_result_id,
              application_fact_seq, rejection_code, rejection_reason, created_by, notes,
              created_at, applied_at, updated_at)
         VALUES (?1, ?2, ?3, 'TO_STORE', ?4, 'ACCEPTED', 'OPEN', ?5, ?6, NULL, NULL, ?7, ?8,
                 ?9, ?9, ?9)",
        params![
            allotment_id.to_string(),
            Uuid::new_v4().to_string(),
            allotment_number,
            site.to_string(),
            event_id.to_string(),
            fact_seq,
            actor_id,
            notes,
            at_text,
        ],
    )
    .map_err(db)?;
    let mut response_lines = Vec::with_capacity(lines.len());
    for line in &lines {
        tx.execute(
            "INSERT INTO dc_allotment_work_line
                 (allotment_line_id, allotment_id, source_pool_id, destination_type,
                  destination_id, sku_id, sku_code, planned_quantity, accepted_quantity,
                  updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9)",
            params![
                line.allotment_line_id.to_string(),
                allotment_id.to_string(),
                line.source_pool_id,
                line.destination_type,
                line.destination_id,
                line.sku_id.to_string(),
                line.sku_code,
                line.quantity,
                at_text,
            ],
        )
        .map_err(db)?;
        response_lines.push(json!({
            "id": line.allotment_line_id,
            "source_site_id": site.as_str(),
            "source_pool_id": line.source_pool_id,
            "destination_type": line.destination_type,
            "destination_id": line.destination_id,
            "sku_id": line.sku_id,
            "sku_code": line.sku_code,
            "quantity": line.quantity,
            "accepted_quantity": line.quantity,
            "picked_quantity": 0,
            "packed_quantity": 0,
            "shipment_quantity": 0,
            "dispatched_quantity": 0,
            "in_transit_quantity": 0,
            "received_quantity": 0,
            "cancelled_quantity": 0,
            "remaining_allotted": line.quantity,
            "to_receive_qty": line.quantity,
        }));
    }
    crate::edge::SqliteEdge::enqueue_pool_snapshot(tx, node, Uuid::new_v4())?;
    let total: i64 = lines.iter().map(|line| line.quantity).sum();
    let body = json!({
        "id": allotment_id,
        "allotment_number": allotment_number,
        "type": AllotmentType::ToSite.as_str(),
        "purpose": "REPLENISH",
        "status": "ACTIVE",
        "total_quantity": total,
        "total_picked_quantity": 0,
        "total_cancelled_quantity": 0,
        "remaining_allotted": total,
        "to_receive_qty": total,
        "remaining_quantity": total,
        // Accepted as it was written: this server is the one that decides.
        "edge_application_status": "ACCEPTED",
        "created_by": actor_id,
        "notes": notes,
        "created_at": at,
        "lines": response_lines,
        "activation_command_id": null,
        "activation_target_origin_id": null,
        "execution_authority": "EDGE_DC",
        "inventory_effect": {"movement_count": 0, "ledger_changed": false}
    });
    remember(tx, &key, "CREATE_ALLOTMENT", &request_json, &body, at)?;
    Ok(body)
}

async fn amend(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(allotment_id): Path<Uuid>,
    Json(request): Json<AmendAllotmentRequest>,
) -> Result<Json<AmendAllotmentResult>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryMove)?;
    let actor_id = actor(principal, "");
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let at = state.clock.now();
    let result = run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        let tx = guard
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let key = require_key(&request.idempotency_key)?;
        let request_json = serde_json::to_string(&request)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        let kind = format!("AMEND_ALLOTMENT:{allotment_id}");
        if let Some(answer) = replayed(&tx, &key, &kind, &request_json)? {
            tx.commit().map_err(db)?;
            return serde_json::from_value(answer)
                .map_err(|error| EdgeError::Persistence(error.to_string()));
        }
        let input = lan_input(&tx, &node, allotment_id, &request, &actor_id)?;
        let (result, _) = amend_tx(&tx, &node, allotment_id, &input, at)?;
        let body = serde_json::to_value(&result)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        remember(&tx, &key, &kind, &request_json, &body, at)?;
        tx.commit().map_err(db)?;
        Ok(result)
    })
    .await?;
    Ok(Json(result))
}

/// The hub's request, resolved: an added line leaves from the allotment's own
/// Gudang, from the pool its other lines of the SKU take from (else its first
/// line's), and goes to a store.
fn lan_input(
    tx: &Transaction<'_>,
    node: &NodeContext,
    allotment_id: Uuid,
    request: &AmendAllotmentRequest,
    actor_id: &str,
) -> Result<AmendInput, EdgeError> {
    if request.lines.is_empty() && request.add.is_empty() {
        return Err(EdgeError::Validation(
            "name at least one line to change".into(),
        ));
    }
    let mut lines = BTreeMap::new();
    for line in &request.lines {
        if line.to < 0 {
            return Err(EdgeError::Validation("a line cannot go below zero".into()));
        }
        if lines.insert(line.allotment_line_id, line.to).is_some() {
            return Err(EdgeError::Validation(format!(
                "allotment line {} is named twice",
                line.allotment_line_id
            )));
        }
    }
    let existing: Vec<(String, String, String)> = {
        let mut statement = tx
            .prepare(
                "SELECT sku_id, source_pool_id, sku_code FROM dc_allotment_work_line
                  WHERE allotment_id = ?1 ORDER BY allotment_line_id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![allotment_id.to_string()], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        rows
    };
    let mut add = Vec::with_capacity(request.add.len());
    let mut adding = BTreeSet::new();
    for line in &request.add {
        if line.quantity <= 0 {
            return Err(EdgeError::Validation(
                "a line added to an allotment carries at least one piece".into(),
            ));
        }
        let destination_id = line.destination_id.trim().to_ascii_lowercase();
        if destination_id.is_empty() {
            return Err(EdgeError::Validation(
                "a line added to an allotment names its destination".into(),
            ));
        }
        if !adding.insert((line.sku_id, destination_id.clone())) {
            return Err(EdgeError::Validation(
                "the same SKU is added for the same destination twice".into(),
            ));
        }
        let same_sku = existing
            .iter()
            .find(|(sku_id, _, _)| *sku_id == line.sku_id.to_string());
        let pool = match line
            .source_pool_id
            .as_deref()
            .map(str::trim)
            .filter(|pool| !pool.is_empty())
        {
            Some(pool) => pool_here(pool, &node.site_id),
            None => same_sku
                .or_else(|| existing.first())
                .map(|(_, pool, _)| pool.clone())
                .ok_or_else(|| {
                    EdgeError::Conflict("an allotment with no lines cannot be added to".into())
                })?,
        };
        let sku_code = match same_sku {
            Some((_, _, code)) => code.to_ascii_uppercase(),
            None => sku_code_of(tx, line.sku_id, None)?,
        };
        add.push(NewLine {
            line_id: Uuid::new_v4(),
            source_pool_id: source_pool(&node.site_id, &pool)?,
            destination_type: "STORE".into(),
            destination_id,
            sku_id: line.sku_id,
            sku_code,
            quantity: line.quantity,
        });
    }
    Ok(AmendInput {
        reason: request
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_owned),
        actor_id: actor_id.to_owned(),
        move_only: request.move_only,
        cancelling: false,
        lines,
        add,
        request_id: None,
    })
}

/// MD cancels an allotment at any stage before anything of it is sent
/// (owner, 9–10 Oct 2026): every line down to what is sent — nothing — by the
/// same act as an edit, written as CANCEL. Demand nobody packed is closed at
/// once; picked pieces and pieces in unsent cartons are owed back.
async fn cancel(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(allotment_id): Path<Uuid>,
    Json(request): Json<CancelAllotmentRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::InventoryMove)?;
    let actor_id = actor(principal, &request.actor_id);
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let at = state.clock.now();
    let body = run_blocking(move || {
        if request.reason.trim().is_empty() {
            return Err(EdgeError::Validation(
                "cancellation reason is required".into(),
            ));
        }
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        let tx = guard
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let key = require_key(&request.idempotency_key)?;
        let request_json = serde_json::to_string(&request)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        let kind = format!("CANCEL_ALLOTMENT:{allotment_id}");
        if let Some(answer) = replayed(&tx, &key, &kind, &request_json)? {
            tx.commit().map_err(db)?;
            return Ok(answer);
        }
        let id_text = allotment_id.to_string();
        let header = open_header(&tx, &id_text)?;
        let (standing, _) = load_lines(&tx, &node.site_id, Some(&id_text))?;
        let sent: i64 = standing.iter().map(|(_, line)| line.floor()).sum();
        if sent > 0 {
            return Err(EdgeError::Conflict(format!(
                "{sent} pcs are already sent, so this allotment can no longer be cancelled. Edit the rest down instead."
            )));
        }
        let mut lines = BTreeMap::new();
        for (_, line) in &standing {
            if line.target() > 0 {
                lines.insert(parse_uuid(&line.line_id)?, line.floor().min(line.target()));
            }
        }
        if lines.is_empty() {
            return Err(EdgeError::Conflict(
                "Everything on this allotment is already given up; there is nothing to cancel."
                    .into(),
            ));
        }
        let input = AmendInput {
            reason: Some(request.reason.trim().to_owned()),
            actor_id: actor_id.clone(),
            move_only: false,
            cancelling: true,
            lines,
            add: Vec::new(),
            request_id: None,
        };
        let (result, _) = amend_tx(&tx, &node, allotment_id, &input, at)?;
        let status: String = tx
            .query_row(
                "SELECT fulfillment_status FROM dc_allotment_work WHERE allotment_id = ?1",
                params![id_text],
                |row| row.get(0),
            )
            .map_err(db)?;
        let (after, _) = load_lines(&tx, &node.site_id, Some(&id_text))?;
        let owed_packed: i64 = after.iter().map(|(_, line)| line.pending).sum();
        let owed_picked: i64 = waiting_by_group(&tx, &node.site_id, Some(&id_text))?
            .values()
            .sum::<i64>()
            - after.iter().map(|(_, line)| line.waiting).sum::<i64>();
        let body = json!({
            "id": allotment_id,
            "allotment_number": header.allotment_number,
            "type": hub_type(&header.allotment_type),
            "status": status,
            "cancellation_status": "APPLIED",
            "edge_cancellation_status": null,
            "cancelled_quantity": result.released_total + result.owed_total,
            "total_cancelled_quantity": after.iter().map(|(_, line)| line.cancelled).sum::<i64>(),
            "remaining_quantity": after.iter().map(|(_, line)| line.to_pack()).sum::<i64>(),
            "cancelled_at": at,
            "released_total": result.released_total,
            "owed_total": result.owed_total,
            "owed_picked": owed_picked.max(0),
            "owed_packed": owed_packed,
            "sent_quantity": 0,
            "lines": result.lines,
            "inventory_effect": {"movement_count": 0, "ledger_changed": false}
        });
        remember(&tx, &key, &kind, &request_json, &body, at)?;
        tx.commit().map_err(db)?;
        Ok(body)
    })
    .await?;
    Ok(Json(body))
}

/// Where an allotment's pieces stand, by stage: what a cancel would cost.
async fn work(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(allotment_id): Path<Uuid>,
) -> Result<Json<AllotmentWork>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let connection = state.auth.connection();
    let node = state.inventory.node().clone();
    let work = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        let id_text = allotment_id.to_string();
        let known: bool = guard
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM dc_allotment_work WHERE allotment_id = ?1)",
                params![id_text],
                |row| row.get(0),
            )
            .map_err(db)?;
        if !known {
            return Err(EdgeError::NotFound("allotment".into()));
        }
        let (lines, _) = load_lines(&guard, &node.site_id, Some(&id_text))?;
        let mut stage: [(BTreeSet<String>, i64); 4] = Default::default();
        for (_, line) in &lines {
            let to_pick = (line.to_pack() - line.waiting).max(0);
            let picked = line.picked_wanted();
            let figures = [to_pick, picked, line.in_boxes, line.floor()];
            for (index, pieces) in figures.into_iter().enumerate() {
                if pieces > 0 {
                    stage[index].0.insert(line.destination_id.clone());
                    stage[index].1 += pieces;
                }
            }
        }
        let koli: i64 = guard
            .query_row(
                "SELECT COUNT(DISTINCT k.koli_id) FROM koli k
                   JOIN koli_unit u ON u.koli_id = k.koli_id
                  WHERE u.allotment_id = ?1 AND u.released_at IS NULL
                    AND u.current_stage = 'PACKED' AND k.shipment_id IS NULL",
                params![id_text],
                |row| row.get(0),
            )
            .map_err(db)?;
        let at = |index: usize| AllotmentWorkStage {
            stores: i64::try_from(stage[index].0.len()).unwrap_or(i64::MAX),
            pieces: stage[index].1,
        };
        Ok(AllotmentWork {
            to_pick: at(0),
            picked: at(1),
            packed: AllotmentPackedStage {
                stores: i64::try_from(stage[2].0.len()).unwrap_or(i64::MAX),
                pieces: stage[2].1,
                koli,
            },
            sent: at(3),
        })
    })
    .await?;
    Ok(Json(work))
}

// ---------------------------------------------------------------------------
// What the Gudang has to move back (`cloud::dc::owed`, on this ledger)
// ---------------------------------------------------------------------------

async fn owed(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let connection = state.auth.connection();
    let site = state.inventory.node().site_id.clone();
    let items = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        owed_work(&guard, &site)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

/// One card per allotment × shop with pieces still to move back. Nothing is
/// stored: every read starts from what is in the building now.
///
/// - **owed picked**: pieces waiting in the pick area beyond what the
///   allotment's lines for that shop and SKU still want.
/// - **owed packed**: pieces MD took out of a carton that has not left, or —
///   for an allotment MD cancelled — every piece of a line with nothing left
///   to pack, newest carton first.
fn owed_work(connection: &Connection, site: &SiteId) -> Result<Vec<OwedWork>, EdgeError> {
    let (lines, surplus) = load_lines(connection, site, None)?;
    let mut cartons: BTreeMap<String, Vec<OwedKoli>> = BTreeMap::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT u.allotment_line_id, k.koli_id, COALESCE(k.koli_number, k.koli_id),
                        COUNT(*)
                   FROM koli k JOIN koli_unit u ON u.koli_id = k.koli_id
                  WHERE k.shipment_id IS NULL AND u.released_at IS NULL
                    AND u.current_stage = 'PACKED'
                  GROUP BY u.allotment_line_id, k.koli_id
                  ORDER BY u.allotment_line_id, k.created_at DESC, k.koli_number DESC",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        for (line_id, koli_id, koli_number, quantity) in rows {
            if let Ok(koli_id) = Uuid::parse_str(&koli_id) {
                cartons.entry(line_id).or_default().push(OwedKoli {
                    koli_id,
                    koli_number,
                    quantity,
                });
            }
        }
    }
    let cancelled: BTreeSet<String> = {
        let mut statement = connection
            .prepare(
                "SELECT allotment_id FROM dc_allotment_md_cancel
                 UNION SELECT allotment_id FROM dc_allotment_work
                        WHERE fulfillment_status IN ('CANCELLED', 'REJECTED')",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(db)?
            .collect::<Result<BTreeSet<_>, _>>()
            .map_err(db)?;
        rows
    };

    let mut cards: Vec<OwedWork> = Vec::new();
    let mut card_of: BTreeMap<(String, String), usize> = BTreeMap::new();
    let mut surplus = surplus;
    for (allotment_id, line) in &lines {
        if line.destination_type != "STORE" {
            continue;
        }
        let group = (
            allotment_id.clone(),
            line.destination_id.clone(),
            line.sku_code.clone(),
        );
        // The group's surplus goes on its first line.
        let owed_picked = surplus.remove(&group).unwrap_or(0);
        let held = cartons.get(&line.line_id).map(Vec::as_slice).unwrap_or(&[]);
        let boxed: i64 = held.iter().map(|carton| carton.quantity).sum();
        let cancelled_boxed = if cancelled.contains(allotment_id) && line.to_pack() <= 0 {
            boxed
        } else {
            0
        };
        let owed_packed = line.pending.max(cancelled_boxed).clamp(0, boxed);
        if owed_picked + owed_packed == 0 {
            continue;
        }
        let mut left = owed_packed;
        let mut koli = Vec::new();
        for carton in held {
            if left == 0 {
                break;
            }
            let take = carton.quantity.min(left);
            koli.push(OwedKoli {
                koli_id: carton.koli_id,
                koli_number: carton.koli_number.clone(),
                quantity: take,
            });
            left -= take;
        }
        let key = (allotment_id.clone(), line.destination_id.clone());
        let index = match card_of.get(&key) {
            Some(&index) => index,
            None => {
                let (number, by, updated_at): (String, String, String) = connection
                    .query_row(
                        "SELECT allotment_number, created_by, updated_at
                           FROM dc_allotment_work WHERE allotment_id = ?1",
                        params![allotment_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .map_err(db)?;
                cards.push(OwedWork {
                    allotment_id: parse_uuid(allotment_id)?,
                    allotment_number: number,
                    destination_id: line.destination_id.clone(),
                    kind: if cancelled.contains(allotment_id) {
                        OwedKind::Cancelled
                    } else {
                        OwedKind::Edited
                    },
                    reason: None,
                    by,
                    at: parse_time(&updated_at),
                    was: 0,
                    now: 0,
                    owed_picked: 0,
                    owed_packed: 0,
                    lines: Vec::new(),
                });
                card_of.insert(key, cards.len() - 1);
                cards.len() - 1
            }
        };
        let article_name: String = connection
            .query_row(
                "SELECT COALESCE((SELECT name FROM catalog_item WHERE upper(sku_code) = ?1), ?1)",
                params![line.sku_code],
                |row| row.get(0),
            )
            .map_err(db)?;
        let card = &mut cards[index];
        card.owed_picked += owed_picked;
        card.owed_packed += owed_packed;
        card.lines.push(OwedLine {
            allotment_line_id: parse_uuid(&line.line_id)?,
            sku_code: line.sku_code.clone(),
            article_name,
            owed_picked,
            owed_packed,
            koli,
        });
    }

    for card in &mut cards {
        let id = card.allotment_id.to_string();
        // Who changed what, and why: MD's latest act on the allotment.
        let latest: Option<(String, Option<String>, String, String)> = connection
            .query_row(
                "SELECT kind, reason, actor_id, created_at FROM dc_allotment_amendment
                  WHERE allotment_id = ?1 ORDER BY created_at DESC, amendment_id DESC LIMIT 1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(db)?;
        if let Some((kind, reason, by, at)) = latest {
            if kind == "CANCEL" {
                card.kind = OwedKind::Cancelled;
            }
            card.reason = reason;
            card.by = by;
            card.at = parse_time(&at);
        }
        let (was, now) = lines
            .iter()
            .filter(|(allotment, line)| {
                *allotment == id && line.destination_id == card.destination_id
            })
            .fold((0, 0), |(was, now), (_, line)| {
                (was + line.planned, now + line.target())
            });
        card.was = was;
        card.now = now;
    }
    // The oldest change first: it has waited longest.
    cards.sort_by(|left, right| {
        left.at
            .cmp(&right.at)
            .then_with(|| left.allotment_number.cmp(&right.allotment_number))
            .then_with(|| left.destination_id.cmp(&right.destination_id))
    });
    Ok(cards)
}

// ---------------------------------------------------------------------------
// What MD changed that the Gudang has not seen (`cloud::dc::changes`)
// ---------------------------------------------------------------------------

async fn changes(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let connection = state.auth.connection();
    let items = run_blocking(move || {
        let guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        unseen_changes(&guard)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

/// One item per allotment × shop: MD's amendments nobody acknowledged, and a
/// cancellation Central sent as `inventory.allotment.cancel.v1` (what was
/// released comes off; picked pieces it could not release still go).
fn unseen_changes(connection: &Connection) -> Result<Vec<DcChange>, EdgeError> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        String,
        String,
        bool,
        String,
        String,
        String,
        String,
        i64,
        i64,
        String,
        String,
    )> = {
        let mut statement = connection
            .prepare(
                "SELECT a.allotment_id, w.allotment_number,
                        EXISTS (SELECT 1 FROM dc_allotment_md_cancel c
                                 WHERE c.allotment_id = a.allotment_id),
                        l.destination_id, a.allotment_line_id, upper(l.sku_code), a.kind,
                        a.target_before, a.target_after, a.actor_id, a.created_at
                   FROM dc_allotment_amendment a
                   JOIN dc_allotment_work w ON w.allotment_id = a.allotment_id
                   JOIN dc_allotment_work_line l ON l.allotment_line_id = a.allotment_line_id
                   LEFT JOIN dc_allotment_change_ack ack ON ack.change_id = a.amendment_id
                  WHERE ack.change_id IS NULL
                  ORDER BY a.created_at, a.amendment_id",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                ))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        rows
    };
    let mut items: BTreeMap<(String, String), DcChange> = BTreeMap::new();
    for (
        allotment_id,
        number,
        cancelled,
        destination,
        line_id,
        sku_code,
        kind,
        before,
        after,
        by,
        at,
    ) in rows
    {
        let at = parse_time(&at);
        let item = match items.entry((allotment_id.clone(), destination.clone())) {
            std::collections::btree_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::btree_map::Entry::Vacant(entry) => entry.insert(DcChange {
                allotment_id: parse_uuid(&allotment_id)?,
                allotment_number: number,
                destination_id: destination,
                cancelled,
                was_total: 0,
                now_total: 0,
                lines: Vec::new(),
                by: by.clone(),
                at,
            }),
        };
        item.by = by;
        item.at = at;
        let line_id = parse_uuid(&line_id)?;
        match item
            .lines
            .iter_mut()
            .find(|line| line.allotment_line_id == line_id)
        {
            Some(line) => {
                line.now = after;
                line.kind = kind;
            }
            None => item.lines.push(DcChangeLine {
                allotment_line_id: line_id,
                sku_code,
                kind,
                was: before,
                now: after,
            }),
        }
    }

    // Central's cancellations, per shop of the allotment.
    #[derive(Deserialize)]
    struct CancelledLine {
        allotment_line_id: Uuid,
        requested_quantity: i64,
        cancelled_quantity: i64,
    }
    let cancellations: Vec<(String, String, String, String, String)> = {
        let mut statement = connection
            .prepare(
                "SELECT c.cancellation_id, c.allotment_id, w.allotment_number, c.requested_by,
                        c.applied_at
                   FROM dc_allotment_cancellation c
                   JOIN dc_allotment_work w ON w.allotment_id = c.allotment_id
                  ORDER BY c.applied_at",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        rows
    };
    for (cancellation_id, allotment_id, number, by, at) in cancellations {
        let lines_json: String = connection
            .query_row(
                "SELECT lines_json FROM dc_allotment_cancellation WHERE cancellation_id = ?1",
                params![cancellation_id],
                |row| row.get(0),
            )
            .map_err(db)?;
        let lines: Vec<CancelledLine> = serde_json::from_str(&lines_json).unwrap_or_default();
        for line in lines {
            let (destination, sku_code): (String, String) = match connection
                .query_row(
                    "SELECT destination_id, upper(sku_code) FROM dc_allotment_work_line
                      WHERE allotment_line_id = ?1",
                    params![line.allotment_line_id.to_string()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(db)?
            {
                Some(found) => found,
                None => continue,
            };
            let acked: bool = connection
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM dc_allotment_change_ack WHERE change_id = ?1)",
                    params![format!("{cancellation_id}:{destination}")],
                    |row| row.get(0),
                )
                .map_err(db)?;
            if acked {
                continue;
            }
            let at = parse_time(&at);
            let item = items
                .entry((allotment_id.clone(), destination.clone()))
                .or_insert_with(|| DcChange {
                    allotment_id: Uuid::parse_str(&allotment_id).unwrap_or_default(),
                    allotment_number: number.clone(),
                    destination_id: destination.clone(),
                    cancelled: true,
                    was_total: 0,
                    now_total: 0,
                    lines: Vec::new(),
                    by: by.clone(),
                    at,
                });
            item.cancelled = true;
            item.by = by.clone();
            item.at = at;
            item.lines.push(DcChangeLine {
                allotment_line_id: line.allotment_line_id,
                sku_code,
                kind: "CANCEL".into(),
                was: line.requested_quantity,
                now: (line.requested_quantity - line.cancelled_quantity).max(0),
            });
        }
    }
    Ok(items
        .into_values()
        .map(|mut item| {
            item.was_total = item.lines.iter().map(|line| line.was).sum();
            item.now_total = item.lines.iter().map(|line| line.now).sum();
            item
        })
        .collect())
}

/// "Got it": every unseen change of this allotment for this shop at once. A
/// second tap finds nothing left and answers 0.
async fn acknowledge(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<AcknowledgeRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::DcOperate)?;
    let actor_id = actor(principal, "");
    let connection = state.auth.connection();
    let at = time_text(state.clock.now());
    let acknowledged = run_blocking(move || {
        let destination = request.destination_id.trim().to_ascii_lowercase();
        if destination.is_empty() {
            return Err(EdgeError::Validation("destination_id is required".into()));
        }
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        ensure_schema(&guard)?;
        let tx = guard
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let allotment_id = request.allotment_id.to_string();
        let mut acknowledged = tx
            .execute(
                "INSERT OR IGNORE INTO dc_allotment_change_ack (change_id, actor_id, acknowledged_at)
                 SELECT a.amendment_id, ?3, ?4
                   FROM dc_allotment_amendment a
                   JOIN dc_allotment_work_line l ON l.allotment_line_id = a.allotment_line_id
                  WHERE a.allotment_id = ?1 AND l.destination_id = ?2",
                params![allotment_id, destination, actor_id, at],
            )
            .map_err(db)?;
        acknowledged += tx
            .execute(
                "INSERT OR IGNORE INTO dc_allotment_change_ack (change_id, actor_id, acknowledged_at)
                 SELECT c.cancellation_id || ':' || ?2, ?3, ?4
                   FROM dc_allotment_cancellation c
                  WHERE c.allotment_id = ?1
                    AND EXISTS (SELECT 1 FROM dc_allotment_work_line l
                                 WHERE l.allotment_id = c.allotment_id AND l.destination_id = ?2)",
                params![allotment_id, destination, actor_id, at],
            )
            .map_err(db)?;
        tx.commit().map_err(db)?;
        Ok(acknowledged)
    })
    .await?;
    Ok(Json(json!({ "acknowledged": acknowledged })))
}
