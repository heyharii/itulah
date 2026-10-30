//! The Gudang server's outbound side, brought up to the cloud-run Gudang
//! (GUDANG-SERVER-PLAN.md step 3). `cloud/dc` is the specification: the same
//! `/api/v1/dc/*` paths and the same JSON, so the hub's `dc` client works
//! against either.
//!
//! - MD answers **Continue** on short picks (`cloud/dc/short_pick.rs`): the
//!   picker tries again, and the Short pick flag clears.
//! - The moves back to the picklist of the last two days
//!   (`cloud/dc/move_back.rs` `list_to_pick`). Nothing new is kept for them:
//!   `EdgeInventory::move_back` already keeps its answer by idempotency key and
//!   writes the movement group that put the pieces back on the racks, and the
//!   list is read from those two.
//! - **RFID verify** of packed koli, and a store verified on the C5
//!   (`cloud/dc/rfid_verify.rs`). A koli's tags are its `koli_unit` rows — the
//!   same rows a packing box's sweep sealed — and the tags read come in the
//!   body as they do at Central or, on the LAN, as a reader session the
//!   handheld already filed in the RFID evidence ledger
//!   (`edge_observation_sighting`), so a sweep never travels twice.
//!
//! Every write puts a fact in the outbox in the same transaction, carrying the
//! row `cloud/dc` writes. Central has no applier for these yet; its receipt log
//! keeps them for one (`cloud/postgres/sync.rs`: unknown types pass through).

use crate::edge::http::{name_the_actor, require_permission, run_blocking, ApiError, EdgeState};
use crate::edge::outbound::{MoveBackRequest, MoveBackResult};
use crate::edge::{EdgeError, EdgePermission, EdgePrincipal, SiteId};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use uuid::Uuid;

/// MD said Continue on a short pick: `dc_short_pick.continued_by/_at`.
pub const FACT_SHORT_PICK_CONTINUED: &str = "dc.short_pick.continued";
/// A koli's last RFID check, whole: a `dc_koli_rfid_check` row.
pub const FACT_KOLI_RFID_CHECKED: &str = "dc.koli_rfid.checked";
/// Packed sent a store to the C5: a `dc_koli_rfid_request` row.
pub const FACT_KOLI_RFID_REQUESTED: &str = "dc.koli_rfid.requested";
/// The C5 verified a store, and its request ended.
pub const FACT_KOLI_RFID_STORE_VERIFIED: &str = "dc.koli_rfid.store_verified";

/// `pub(crate)` because the state it serves is (`edge::http::EdgeState`).
pub(crate) fn routes() -> Router<EdgeState> {
    Router::new()
        .route(
            "/api/v1/dc/short-picks/continue",
            post(continue_short_picks),
        )
        .route("/api/v1/dc/move-backs", get(list_move_backs))
        .route("/api/v1/dc/koli-rfid", get(list_checks))
        .route("/api/v1/dc/koli-rfid/verify", post(verify))
        .route("/api/v1/dc/koli/{koli_id}/epcs", get(koli_epcs))
        .route(
            "/api/v1/dc/koli-rfid/requests",
            get(list_requests).post(send_stores),
        )
        .route(
            "/api/v1/dc/koli-rfid/requests/{store_id}/check",
            post(check_store),
        )
        .route(
            "/api/v1/dc/koli-rfid/requests/{store_id}/verify",
            post(verify_store),
        )
}

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

fn json_error(error: serde_json::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

fn time_text(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

/// Who did it: the signed-in person, or `api` on a node without sign-in.
fn actor(principal: Option<EdgePrincipal>) -> String {
    let mut actor = principal
        .map(|principal| principal.username)
        .unwrap_or_default();
    name_the_actor(&mut actor);
    actor
}

/// Run `work` on the node's one writer connection, off the async thread.
/// The writer, not a read handle, for the reads too: the request list tidies
/// itself as it is read, as Central's does.
async fn on_connection<T, F>(state: &EdgeState, work: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, EdgeError> + Send + 'static,
{
    let connection = state.auth.connection();
    run_blocking(move || {
        let mut guard = connection
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        work(&mut guard)
    })
    .await
}

fn enqueue(tx: &Transaction<'_>, event_type: &str, payload: &Value) -> Result<(), EdgeError> {
    crate::edge::sync::enqueue_fact(tx, Uuid::new_v4(), event_type, payload).map_err(db)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Short picks: MD's Continue
// ---------------------------------------------------------------------------

/// Where a short pick stands on this node, from what is still to pick of it
/// and whether MD answered Continue: `cloud/dc/short_pick.rs` `status_of`
/// without the count review (FOUND, LOST) and MD's close (CLOSED), which do
/// not reach this node. Nothing left to pick wins over her answer.
pub(crate) fn short_pick_status(still_short: i64, continued: bool) -> &'static str {
    if still_short <= 0 {
        "PICKED"
    } else if continued {
        "CONTINUED"
    } else {
        "OPEN"
    }
}

#[derive(Deserialize)]
struct ContinueShortPicksRequest {
    ids: Vec<String>,
}

/// MD answers **Continue** on the reports of one review: the picker tries
/// again. Written once per report — one already answered keeps its first
/// answer, so a second delivery changes nothing. A report with nothing left to
/// pick is not written: it is no longer MD's to answer. Answers with the
/// reports as they stand now.
async fn continue_short_picks(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<ContinueShortPicksRequest>,
) -> Result<Json<Value>, ApiError> {
    let by = actor(require_permission(
        &state,
        principal,
        EdgePermission::DcOperate,
    )?);
    let ids: Vec<String> = request
        .ids
        .iter()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .collect();
    if ids.is_empty() {
        return Err(ApiError(EdgeError::Validation(
            "ids is required: the short picks MD answers".into(),
        )));
    }
    let site = state.inventory.node().site_id.to_string();
    let at = time_text(state.clock.now());
    let items = on_connection(&state, move |connection| {
        connection
            .execute_batch(crate::edge::outbound::SHORT_PICK_SCHEMA)
            .map_err(db)?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        for id in &ids {
            let (allotment_id, destination_id, sku_code, pieces): (String, String, String, i64) =
                tx.query_row(
                    "SELECT allotment_id, destination_id, sku_code, pieces
                       FROM dc_short_pick WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()
                .map_err(db)?
                .ok_or_else(|| EdgeError::NotFound(format!("short pick {id}")))?;
            let left = crate::edge::outbound::still_to_pick(
                &tx,
                &site,
                &allotment_id,
                &destination_id,
                &sku_code,
            )?;
            if pieces.min(left) <= 0 {
                continue;
            }
            let written = tx
                .execute(
                    "INSERT INTO dc_short_pick_continue (short_pick_id, continued_by, continued_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT (short_pick_id) DO NOTHING",
                    params![id, by, at],
                )
                .map_err(db)?;
            if written == 1 {
                enqueue(
                    &tx,
                    FACT_SHORT_PICK_CONTINUED,
                    &json!({
                        "id": id,
                        "allotment_id": allotment_id,
                        "destination_id": destination_id,
                        "sku_code": sku_code,
                        "continued_by": by,
                        "continued_at": at,
                    }),
                )?;
            }
        }
        tx.commit().map_err(db)?;
        // Read back the way the board reads them, in the order asked. The
        // board reads its newest 500; a report older than that is answered
        // but not repeated here.
        let all = crate::edge::outbound::list_short_picks(connection, &site)?;
        Ok(ids
            .iter()
            .filter_map(|id| all.iter().find(|one| &one.id == id).cloned())
            .collect::<Vec<_>>())
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

// ---------------------------------------------------------------------------
// Moves back to the picklist
// ---------------------------------------------------------------------------

/// The moves back to the picklist of the last two days, newest first, as the
/// board marks the card it put back ("Back from Pack" / "Back from
/// Dispatch").
///
/// A move back that reached the racks wrote a movement group under its own
/// key and `:rack` (`EdgeInventory::move_back`); one that only went back to
/// the pick area wrote none, and is not a move back to the picklist. The
/// group gives who and when on the business clock, and its id names the move;
/// the request and the answer kept under the key give the rest.
async fn list_move_backs(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let since = time_text(state.clock.now() - Duration::days(2));
    let items = on_connection(&state, move |connection| {
        let mut statement = connection
            .prepare(
                "SELECT g.id, g.actor_id, g.occurred_at, r.request_json, r.response_json
                   FROM idempotency_response r
                   JOIN movement_group g ON g.idempotency_key = r.idempotency_key || ':rack'
                  WHERE r.operation = 'DC_MOVE_BACK' AND g.occurred_at >= ?1
                  ORDER BY g.occurred_at DESC
                  LIMIT 500",
            )
            .map_err(db)?;
        let rows = statement
            .query_map(params![since], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        let mut items = Vec::with_capacity(rows.len());
        for (move_back_id, actor_id, created_at, request, response) in rows {
            // The request was stored by the same build that reads it; one
            // that no longer parses is skipped rather than failing the board.
            let Ok(request) = serde_json::from_str::<MoveBackRequest>(&request) else {
                continue;
            };
            let moved = serde_json::from_str::<MoveBackResult>(&response)
                .map(|result| result.moved)
                .unwrap_or(0);
            items.push(json!({
                "move_back_id": move_back_id,
                "destination_id": request.destination_id,
                "allotment_id": request.allotment_id,
                "from_stage": request.from,
                "moved": moved,
                "actor_id": actor_id,
                "created_at": created_at,
                "sku_codes": request
                    .lines
                    .into_iter()
                    .map(|line| line.sku_code)
                    .collect::<Vec<_>>(),
            }));
        }
        Ok(items)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

// ---------------------------------------------------------------------------
// RFID verify
// ---------------------------------------------------------------------------

/// A koli on the Packed tab: sealed, on no trip yet, not emptied by a move
/// back. A move back deletes the pieces it takes out (`koli_unit`), and a
/// sealed koli with none left is on no list (`outbound::list_koli`).
const PACKED: &str = "k.sealed_at IS NOT NULL AND k.shipment_id IS NULL
     AND EXISTS (SELECT 1 FROM koli_unit pu WHERE pu.koli_id = k.koli_id)";

/// What a reader saw, in capitals: the EPCs in the body, and those the
/// handheld filed under its reader session, when it names one.
fn swept(
    connection: &Connection,
    epcs: &[String],
    reader_session_id: Option<&str>,
) -> Result<BTreeSet<String>, EdgeError> {
    let mut seen: BTreeSet<String> = epcs
        .iter()
        .map(|epc| epc.trim().to_uppercase())
        .filter(|epc| !epc.is_empty())
        .collect();
    if let Some(session) = reader_session_id
        .map(str::trim)
        .filter(|session| !session.is_empty())
    {
        // DISTINCT because a tag read forty times is one garment.
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT epc FROM edge_observation_sighting WHERE reader_session_id = ?1",
            )
            .map_err(db)?;
        let filed = statement
            .query_map(params![session], |row| row.get::<_, String>(0))
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        seen.extend(filed.into_iter().map(|epc| epc.trim().to_uppercase()));
    }
    Ok(seen)
}

/// A koli id as the hub sends it: a malformed one is a koli that does not
/// exist, as at Central.
fn koli_id_of(value: &str) -> Result<String, EdgeError> {
    Uuid::parse_str(value.trim())
        .map(|id| id.to_string())
        .map_err(|_| EdgeError::NotFound(format!("koli {value}")))
}

/// A store as `koli.destination_store_id` spells it: a site id, trimmed and
/// lower-cased; anything else as it came.
fn store_id_of(value: &str) -> String {
    SiteId::new(value)
        .map(|site| site.to_string())
        .unwrap_or_else(|_| value.trim().to_owned())
}

fn check_json(
    koli_id: &str,
    total: i64,
    missing: i64,
    checked_by: &str,
    checked_at: &str,
    verified_at: Option<&str>,
) -> Value {
    json!({
        "koli_id": koli_id,
        "total": total,
        "missing": missing,
        "checked_by": checked_by,
        "checked_at": checked_at,
        "verified_at": verified_at,
    })
}

/// Write a koli's check whole; a later check replaces it. Verified when
/// nothing is missing. The same row goes into the outbox.
fn write_check(
    tx: &Transaction<'_>,
    koli_id: &str,
    read: &[String],
    total: i64,
    checked_by: &str,
    at: &str,
) -> Result<Value, EdgeError> {
    let missing = total - i64::try_from(read.len()).unwrap_or(i64::MAX);
    let verified_at = (missing == 0).then_some(at);
    tx.execute(
        "INSERT INTO dc_koli_rfid_check
             (koli_id, read_epcs, total, missing, checked_by, checked_at, verified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (koli_id) DO UPDATE SET
             read_epcs = excluded.read_epcs, total = excluded.total,
             missing = excluded.missing, checked_by = excluded.checked_by,
             checked_at = excluded.checked_at, verified_at = excluded.verified_at",
        params![
            koli_id,
            serde_json::to_string(read).map_err(json_error)?,
            total,
            missing,
            checked_by,
            at,
            verified_at
        ],
    )
    .map_err(db)?;
    enqueue(
        tx,
        FACT_KOLI_RFID_CHECKED,
        &json!({
            "koli_id": koli_id,
            "read_epcs": read,
            "total": total,
            "missing": missing,
            "checked_by": checked_by,
            "checked_at": at,
            "verified_at": verified_at,
        }),
    )?;
    Ok(check_json(
        koli_id,
        total,
        missing,
        checked_by,
        at,
        verified_at,
    ))
}

/// The last check of every koli that has one.
async fn list_checks(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let items = on_connection(&state, |connection| {
        let mut statement = connection
            .prepare(
                "SELECT koli_id, total, missing, checked_by, checked_at, verified_at
                   FROM dc_koli_rfid_check",
            )
            .map_err(db)?;
        let items = statement
            .query_map([], |row| {
                Ok(check_json(
                    &row.get::<_, String>(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    &row.get::<_, String>(3)?,
                    &row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?.as_deref(),
                ))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        Ok(items)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

/// One koli's EPCs, with whether the last check read each.
async fn koli_epcs(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(koli_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let koli_id = koli_id_of(&koli_id).map_err(ApiError)?;
    let answer = on_connection(&state, move |connection| {
        let check: Option<(Value, String)> = connection
            .query_row(
                "SELECT koli_id, total, missing, checked_by, checked_at, verified_at, read_epcs
                   FROM dc_koli_rfid_check WHERE koli_id = ?1",
                params![koli_id],
                |row| {
                    Ok((
                        check_json(
                            &row.get::<_, String>(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            &row.get::<_, String>(3)?,
                            &row.get::<_, String>(4)?,
                            row.get::<_, Option<String>>(5)?.as_deref(),
                        ),
                        row.get(6)?,
                    ))
                },
            )
            .optional()
            .map_err(db)?;
        let read: BTreeSet<String> = match &check {
            Some((_, read_epcs)) => serde_json::from_str::<Vec<String>>(read_epcs)
                .map_err(json_error)?
                .into_iter()
                .collect(),
            None => BTreeSet::new(),
        };
        let mut statement = connection
            .prepare(
                "SELECT epc, sku_code FROM koli_unit WHERE koli_id = ?1 ORDER BY sku_code, epc",
            )
            .map_err(db)?;
        let epcs = statement
            .query_map(params![koli_id], |row| {
                let epc: String = row.get(0)?;
                Ok(json!({
                    "read": check.as_ref().map(|_| read.contains(&epc)),
                    "sku_code": row.get::<_, String>(1)?,
                    "epc": epc,
                }))
            })
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        Ok(json!({
            "koli_id": koli_id,
            "epcs": epcs,
            "check": check.map(|(json, _)| json),
        }))
    })
    .await?;
    Ok(Json(answer))
}

#[derive(Deserialize)]
struct VerifyRequest {
    koli_ids: Vec<String>,
    #[serde(default)]
    epcs: Vec<String>,
    /// The handheld's sweep as it filed it here, instead of (or beside) the
    /// EPCs in the body.
    #[serde(default)]
    reader_session_id: Option<String>,
}

/// What the handheld read, against the chosen koli. Each koli's check is
/// written whole (a later check replaces it); the tags that belong to none of
/// them are answered, not stored.
///
/// One IMMEDIATE transaction: a move back and a dispatch write on the same
/// connection, so neither can empty or send a koli between what is read here
/// and the check written for it.
async fn verify(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<Value>, ApiError> {
    let by = actor(require_permission(
        &state,
        principal,
        EdgePermission::DcOperate,
    )?);
    if request.koli_ids.is_empty() {
        return Err(ApiError(EdgeError::Validation(
            "choose a koli to verify".into(),
        )));
    }
    let ids: BTreeSet<String> = request
        .koli_ids
        .iter()
        .map(|id| koli_id_of(id))
        .collect::<Result<_, _>>()
        .map_err(ApiError)?;
    let at = time_text(state.clock.now());
    let answer = on_connection(&state, move |connection| {
        let seen = swept(
            connection,
            &request.epcs,
            request.reader_session_id.as_deref(),
        )?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        // (koli, number, its EPCs)
        let mut koli: Vec<(String, String, Vec<String>)> = Vec::with_capacity(ids.len());
        let mut known = BTreeSet::new();
        for koli_id in &ids {
            let (number, sealed, gone): (String, bool, bool) = tx
                .query_row(
                    "SELECT COALESCE(k.koli_number, k.koli_id), k.sealed_at IS NOT NULL,
                            k.status = 'IN_TRANSIT'
                            OR EXISTS (SELECT 1 FROM shipment s
                                         JOIN dispatch d ON d.dispatch_id = s.dispatch_id
                                        WHERE s.shipment_id = k.shipment_id
                                          AND d.departed_at IS NOT NULL)
                       FROM koli k WHERE k.koli_id = ?1",
                    params![koli_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(db)?
                .ok_or_else(|| EdgeError::NotFound(format!("koli {koli_id}")))?;
            // One already on the road is not in the building to be read.
            if gone {
                return Err(EdgeError::Conflict(format!(
                    "{number} has already left on its trip; it can only be verified before it goes"
                )));
            }
            let mut statement = tx
                .prepare_cached("SELECT epc FROM koli_unit WHERE koli_id = ?1 ORDER BY epc")
                .map_err(db)?;
            let epcs = statement
                .query_map(params![koli_id], |row| row.get::<_, String>(0))
                .map_err(db)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db)?;
            drop(statement);
            // A koli with nothing in it cannot be verified: its check would
            // count nothing missing, and that reads as Verified — a carton
            // marked read with not one tag read. A sealed one with nothing
            // left was emptied by a move back and is no carton any more.
            if epcs.is_empty() {
                return Err(EdgeError::Conflict(if sealed {
                    format!("{number} was emptied by a move back; there is no koli left to verify")
                } else {
                    format!("{number} holds no pieces; there is nothing in it to verify")
                }));
            }
            known.extend(epcs.iter().map(|epc| epc.to_uppercase()));
            koli.push((koli_id.clone(), number, epcs));
        }

        let mut items = Vec::with_capacity(koli.len());
        for (koli_id, _, epcs) in &koli {
            let read: Vec<String> = epcs
                .iter()
                .filter(|epc| seen.contains(&epc.to_uppercase()))
                .cloned()
                .collect();
            let total = i64::try_from(epcs.len()).unwrap_or(i64::MAX);
            items.push(write_check(&tx, koli_id, &read, total, &by, &at)?);
        }
        tx.commit().map_err(db)?;
        let extra: Vec<&String> = seen.iter().filter(|epc| !known.contains(*epc)).collect();
        Ok(json!({ "items": items, "extra": extra }))
    })
    .await?;
    Ok(Json(answer))
}

/// The stores Packed sent to the C5, each with its packed koli.
async fn list_requests(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let items = on_connection(&state, |connection| requests(connection)).await?;
    Ok(Json(json!({ "items": items })))
}

fn store_name(connection: &Connection, store: &str) -> String {
    crate::edge::site_profile::known(connection, store)
        .map(|site| site.name)
        .unwrap_or_else(|| store.to_owned())
}

fn requests(connection: &Connection) -> Result<Vec<Value>, EdgeError> {
    // A store whose koli have all gone — on a trip, or unpacked — has nothing
    // left to read, and its request ends here rather than coming back the next
    // time that store packs. No fact: Central reads the same from the koli.
    connection
        .execute(
            &format!(
                "DELETE FROM dc_koli_rfid_request
                  WHERE NOT EXISTS (SELECT 1 FROM koli k
                                     WHERE k.destination_store_id
                                           = dc_koli_rfid_request.destination_store_id
                                       AND {PACKED})"
            ),
            [],
        )
        .map_err(db)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT r.destination_store_id, r.requested_by, r.requested_at,
                    k.koli_id, COALESCE(k.koli_number, k.koli_id),
                    (SELECT count(*) FROM koli_unit u WHERE u.koli_id = k.koli_id)
               FROM dc_koli_rfid_request r
               JOIN koli k ON k.destination_store_id = r.destination_store_id AND {PACKED}
              ORDER BY r.requested_at, r.destination_store_id, k.koli_number"
        ))
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);

    let mut items: Vec<(String, Value, Vec<Value>, i64)> = Vec::new();
    for (store, requested_by, requested_at, koli_id, koli_number, total) in rows {
        let koli = json!({
            "koli_id": koli_id,
            "koli_number": koli_number,
            "total": total,
        });
        match items.last_mut() {
            Some((id, _, list, sum)) if *id == store => {
                list.push(koli);
                *sum += total;
            }
            _ => {
                let head = json!({
                    "store_id": store,
                    "store_code": crate::edge::site_profile::display_code(connection, &store),
                    "store_name": store_name(connection, &store),
                    "requested_by": requested_by,
                    "requested_at": requested_at,
                });
                items.push((store, head, vec![koli], total));
            }
        }
    }
    Ok(items
        .into_iter()
        .map(|(_, mut head, koli, total)| {
            head["koli"] = Value::from(koli);
            head["total"] = Value::from(total);
            head
        })
        .collect())
}

#[derive(Deserialize)]
struct SendRequest {
    store_ids: Vec<String>,
}

/// Send stores to the C5. Sending one already waiting sends it again.
async fn send_stores(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<SendRequest>,
) -> Result<Json<Value>, ApiError> {
    let by = actor(require_permission(
        &state,
        principal,
        EdgePermission::DcOperate,
    )?);
    let stores: BTreeSet<String> = request
        .store_ids
        .iter()
        .map(|id| store_id_of(id))
        .filter(|id| !id.is_empty())
        .collect();
    if stores.is_empty() {
        return Err(ApiError(EdgeError::Validation(
            "choose a store to verify".into(),
        )));
    }
    let at = time_text(state.clock.now());
    let items = on_connection(&state, move |connection| {
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        for store in &stores {
            let packed: i64 = tx
                .query_row(
                    &format!(
                        "SELECT count(*) FROM koli k WHERE k.destination_store_id = ?1 AND {PACKED}"
                    ),
                    params![store],
                    |row| row.get(0),
                )
                .map_err(db)?;
            if packed == 0 {
                return Err(EdgeError::Conflict(format!(
                    "{} has no packed koli to verify",
                    crate::edge::site_profile::display_code(&tx, store)
                )));
            }
            tx.execute(
                "INSERT INTO dc_koli_rfid_request (destination_store_id, requested_by, requested_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT (destination_store_id) DO UPDATE SET
                     requested_by = excluded.requested_by, requested_at = excluded.requested_at",
                params![store, by, at],
            )
            .map_err(db)?;
            enqueue(
                &tx,
                FACT_KOLI_RFID_REQUESTED,
                &json!({
                    "destination_store_id": store,
                    "requested_by": by,
                    "requested_at": at,
                }),
            )?;
        }
        tx.commit().map_err(db)?;
        requests(connection)
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

#[derive(Deserialize)]
struct StoreRead {
    #[serde(default)]
    epcs: Vec<String>,
    #[serde(default)]
    reader_session_id: Option<String>,
}

/// One packed koli of the store, its tags and the ones read.
struct KoliRead {
    koli_id: String,
    koli_number: String,
    epcs: Vec<String>,
    read: Vec<String>,
}

/// A packed koli of another store whose tags were read: (koli, number, store,
/// its code, tags read).
type WrongStore = (String, String, String, String, i64);

/// What a sweep came to against one store's packed koli.
struct Reading {
    store_code: String,
    koli: Vec<KoliRead>,
    wrong: Vec<WrongStore>,
}

impl Reading {
    fn total(&self) -> usize {
        self.koli.iter().map(|one| one.epcs.len()).sum()
    }

    fn read(&self) -> usize {
        self.koli.iter().map(|one| one.read.len()).sum()
    }

    /// The same: every tag of every koli read, none of another store's. A tag
    /// of nobody's packed koli — loose stock nearby — changes nothing.
    fn matches(&self) -> bool {
        self.wrong.is_empty()
            && self
                .koli
                .iter()
                .all(|one| !one.epcs.is_empty() && one.read.len() == one.epcs.len())
    }

    fn json(&self, store: &str) -> Value {
        json!({
            "store_id": store,
            "store_code": self.store_code,
            "matches": self.matches(),
            "total": self.total(),
            "read": self.read(),
            "koli": self.koli.iter().map(|one| json!({
                "koli_id": one.koli_id,
                "koli_number": one.koli_number,
                "total": one.epcs.len(),
                "read": one.read.len(),
            })).collect::<Vec<_>>(),
            "wrong_store": self.wrong.iter().map(|(koli_id, number, store_id, code, tags)| json!({
                "koli_id": koli_id,
                "koli_number": number,
                "store_id": store_id,
                "store_code": code,
                "tags": tags,
            })).collect::<Vec<_>>(),
        })
    }
}

/// Read a store's packed koli against what was swept.
fn reading(
    connection: &Connection,
    store: &str,
    seen: &BTreeSet<String>,
) -> Result<Reading, EdgeError> {
    let store_code = crate::edge::site_profile::display_code(connection, store);
    let mut statement = connection
        .prepare(&format!(
            "SELECT k.koli_id, COALESCE(k.koli_number, k.koli_id) FROM koli k
              WHERE k.destination_store_id = ?1 AND {PACKED}
              ORDER BY k.koli_number"
        ))
        .map_err(db)?;
    let mut koli = statement
        .query_map(params![store], |row| {
            Ok(KoliRead {
                koli_id: row.get(0)?,
                koli_number: row.get(1)?,
                epcs: Vec::new(),
                read: Vec::new(),
            })
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    drop(statement);
    if koli.is_empty() {
        return Err(EdgeError::Conflict(format!(
            "{store_code} has no packed koli left; it may have gone on a trip"
        )));
    }
    let mut known = BTreeSet::new();
    let mut units = connection
        .prepare_cached("SELECT epc FROM koli_unit WHERE koli_id = ?1 ORDER BY epc")
        .map_err(db)?;
    for one in &mut koli {
        let epcs = units
            .query_map(params![one.koli_id], |row| row.get::<_, String>(0))
            .map_err(db)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db)?;
        for epc in epcs {
            let upper = epc.to_uppercase();
            if seen.contains(&upper) {
                one.read.push(epc.clone());
            }
            one.epcs.push(epc);
            known.insert(upper);
        }
    }
    drop(units);

    // Tags of another store's packed koli, by koli. One look-up per tag read
    // that is not this store's; a sweep is a few hundred tags at most.
    let mut wrong: Vec<WrongStore> = Vec::new();
    let mut owner = connection
        .prepare_cached(&format!(
            "SELECT k.koli_id, COALESCE(k.koli_number, k.koli_id), k.destination_store_id
               FROM koli_unit u
               JOIN koli k ON k.koli_id = u.koli_id
              WHERE upper(u.epc) = ?1 AND k.destination_store_id <> ?2 AND {PACKED}"
        ))
        .map_err(db)?;
    for epc in seen.iter().filter(|epc| !known.contains(*epc)) {
        let found: Option<(String, String, String)> = owner
            .query_row(params![epc, store], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .optional()
            .map_err(db)?;
        let Some((koli_id, number, other)) = found else {
            continue;
        };
        match wrong.iter_mut().find(|one| one.0 == koli_id) {
            Some(one) => one.4 += 1,
            None => {
                let code = crate::edge::site_profile::display_code(connection, &other);
                wrong.push((koli_id, number, other, code, 1));
            }
        }
    }
    drop(owner);
    wrong.sort_by(|left, right| left.1.cmp(&right.1));
    Ok(Reading {
        store_code,
        koli,
        wrong,
    })
}

/// What the C5's sweep comes to against the store, saved nowhere.
async fn check_store(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(store_id): Path<String>,
    Json(request): Json<StoreRead>,
) -> Result<Json<Value>, ApiError> {
    require_permission(&state, principal, EdgePermission::InventoryRead)?;
    let store = store_id_of(&store_id);
    let answer = on_connection(&state, move |connection| {
        let seen = swept(
            connection,
            &request.epcs,
            request.reader_session_id.as_deref(),
        )?;
        Ok(reading(connection, &store, &seen)?.json(&store))
    })
    .await?;
    Ok(Json(answer))
}

/// Verify the store: only when the sweep matches, read again here in the
/// transaction that writes the checks. Every koli of it is then Verified and
/// the store leaves the C5's list.
async fn verify_store(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Path(store_id): Path<String>,
    Json(request): Json<StoreRead>,
) -> Result<Json<Value>, ApiError> {
    let by = actor(require_permission(
        &state,
        principal,
        EdgePermission::DcOperate,
    )?);
    let store = store_id_of(&store_id);
    let at = time_text(state.clock.now());
    let answer = on_connection(&state, move |connection| {
        let seen = swept(
            connection,
            &request.epcs,
            request.reader_session_id.as_deref(),
        )?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db)?;
        let reading = reading(&tx, &store, &seen)?;
        if !reading.matches() {
            let missing = reading.total() - reading.read();
            let wrong: i64 = reading.wrong.iter().map(|one| one.4).sum();
            let mut said = Vec::new();
            if missing > 0 {
                said.push(format!("{missing} tags not read"));
            }
            if wrong > 0 {
                said.push(format!("{wrong} tags of another store's koli"));
            }
            if said.is_empty() {
                said.push("a koli holds no pieces".to_owned());
            }
            return Err(EdgeError::Conflict(format!(
                "{} does not match: {}",
                reading.store_code,
                said.join(", ")
            )));
        }
        let mut items = Vec::with_capacity(reading.koli.len());
        for one in &reading.koli {
            let total = i64::try_from(one.epcs.len()).unwrap_or(i64::MAX);
            items.push(write_check(&tx, &one.koli_id, &one.read, total, &by, &at)?);
        }
        tx.execute(
            "DELETE FROM dc_koli_rfid_request WHERE destination_store_id = ?1",
            params![store],
        )
        .map_err(db)?;
        enqueue(
            &tx,
            FACT_KOLI_RFID_STORE_VERIFIED,
            &json!({
                "destination_store_id": store,
                "koli_ids": reading.koli.iter().map(|one| &one.koli_id).collect::<Vec<_>>(),
                "verified_by": by,
                "verified_at": at,
            }),
        )?;
        tx.commit().map_err(db)?;
        Ok(json!({ "store": reading.json(&store), "items": items }))
    })
    .await?;
    Ok(Json(answer))
}

#[cfg(test)]
mod tests {
    use super::short_pick_status;

    #[test]
    fn continue_answers_a_short_pick_until_nothing_is_left_to_pick() {
        assert_eq!(short_pick_status(2, true), "CONTINUED");
        assert_eq!(short_pick_status(2, false), "OPEN");
        assert_eq!(short_pick_status(0, true), "PICKED");
        assert_eq!(short_pick_status(0, false), "PICKED");
    }
}
