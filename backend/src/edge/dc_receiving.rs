//! The Gudang server's receiving, brought up to the cloud-run Gudang
//! (GUDANG-SERVER-PLAN.md step 3; the specification is `cloud/dc/receiving.rs`
//! and `cloud/dc/returns_supplier.rs`).
//!
//! What only the cloud did until now, done here against the node's SQLite:
//!
//! - **the bay takes its count back** (`POST /api/v1/dc/purchase-counts/recall`,
//!   0950): a count still waiting for review becomes RECALLED, stays in the
//!   order's history, and its line is owed a count again. A document, not
//!   stock — nothing travels to Central, as no count does before it is
//!   accepted;
//! - **a count of nothing, and a count per variant** (owner, 2026-10-05 and
//!   2026-10-10): the per-line and sheet counts in `edge/sqlite.rs` call
//!   [`check_variants`] and [`insert_variants`]; accepting a count of 0 books
//!   nothing and sends nothing (`verify_purchase_impl`);
//! - **the surat jalan of a purchase return** (`POST
//!   /api/v1/dc/purchase-returns/note`, 0917): the Gudang's person in charge is
//!   named and the note exists from then on.
//!
//! The schema these need is 0098, applied by [`ensure_schema`] when the node
//! opens its database.

use super::http::{require_permission, run_blocking, ApiError, EdgeState};
use super::sqlite::db;
use crate::edge::contracts::{
    PurchaseCountEntry, PurchaseCountRecallRequest, PurchaseCountRecallResult,
    PurchaseCountVariant, PurchaseReturnWork, RecalledCount,
};
use crate::edge::{EdgeError, EdgePermission, EdgePrincipal, EdgeRole, SqliteEdge};
use axum::{extract::State, http::StatusCode, routing::post, Extension, Json, Router};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use uuid::Uuid;

/// 0098: RECALLED and a count of nothing on `receiving_count`, the variant
/// breakdown, and the purchase return's surat jalan.
const RECALL_AND_VARIANT_SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/migrations/sqlite/0098_the_bay_takes_a_count_back_and_counts_nothing_or_by_variant.sql"
));

/// A count sheet is one order's lines; a recall takes back one sheet. Anything
/// larger is a caller's bug (the cloud's own bound).
const MOST_COUNTS_RECALLED: usize = 1000;

pub fn routes() -> Router<EdgeState> {
    Router::new()
        // Under the counting path on purpose, as in the cloud: whoever may
        // count may take their count back.
        .route("/api/v1/dc/purchase-counts/recall", post(recall_counts))
        .route("/api/v1/dc/purchase-returns/note", post(generate_note))
}

/// Apply 0098 once, after 0075 and 0076 (it rebuilds the table they shaped).
/// Probed by the column it adds: the rebuild must never run twice.
pub(crate) fn ensure_schema(connection: &Connection) -> Result<(), EdgeError> {
    let a_count_can_be_recalled: i64 = connection
        .prepare_cached(
            "SELECT COUNT(*) FROM pragma_table_info('receiving_count') WHERE name='recalled_at'",
        )
        .map_err(db)?
        .query_row([], |row| row.get(0))
        .map_err(db)?;
    if a_count_can_be_recalled == 0 {
        connection
            .execute_batch(RECALL_AND_VARIANT_SCHEMA)
            .map_err(db)?;
    }
    Ok(())
}

// ---- the routes ---------------------------------------------------------------

/// The bay takes its own count back, before anybody decided on it (0950).
async fn recall_counts(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(mut request): Json<PurchaseCountRecallRequest>,
) -> Result<(StatusCode, Json<PurchaseCountRecallResult>), ApiError> {
    if let Some(principal) = require_permission(&state, principal, EdgePermission::DcOperate)? {
        request.actor_id = principal.username;
    }
    require_dc(&state)?;
    let connection = state.auth.connection();
    let now = state.clock.now();
    let result = run_blocking(move || {
        let mut connection = lock(&connection)?;
        recall(&mut connection, request, now)
    })
    .await?;
    Ok((StatusCode::CREATED, Json(result)))
}

/// Generating a purchase return's surat jalan: the Gudang's person in charge
/// is named (owner, 2026-10-05). One request covers every open return going to
/// one supplier, because the note is per supplier; saying it again with
/// another name replaces the name until the hand-over.
async fn generate_note(
    State(state): State<EdgeState>,
    principal: Option<Extension<EdgePrincipal>>,
    Json(request): Json<GenerateNoteRequest>,
) -> Result<Json<Value>, ApiError> {
    let principal = require_permission(&state, principal, EdgePermission::DcOperate)?;
    require_dc(&state)?;
    let connection = state.auth.connection();
    let now = state.clock.now();
    let items = run_blocking(move || {
        let mut connection = lock(&connection)?;
        note(
            &mut connection,
            request,
            principal.map(|principal| principal.username),
            now,
        )
    })
    .await?;
    Ok(Json(json!({ "items": items })))
}

/// The surat jalan, as the hub sends it (the cloud's `GenerateNoteRequest`).
#[derive(Debug, Deserialize)]
struct GenerateNoteRequest {
    return_ids: Vec<Uuid>,
    pic: String,
    /// A few words per item, by article code ("*" for the not-as-ordered
    /// pieces); none required. Blank ones are dropped.
    #[serde(default)]
    notes: BTreeMap<String, String>,
}

// ---- the work ------------------------------------------------------------------

/// Recall a whole count sheet, or none of it.
///
/// Every count named must be of one order and still waiting for review.
/// Nothing is deleted and stock is not touched: a count waiting for review
/// never put anything in the Gudang. The write lock taken by the transaction
/// is what keeps a recall and an acceptance of the same count from both
/// winning — whichever runs second finds the status changed.
fn recall(
    connection: &mut Connection,
    mut request: PurchaseCountRecallRequest,
    now: DateTime<Utc>,
) -> Result<PurchaseCountRecallResult, EdgeError> {
    request.reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(str::to_owned);
    if request.idempotency_key.trim().is_empty() {
        return Err(EdgeError::Validation("idempotency_key is required".into()));
    }
    if request.actor_id.trim().is_empty() {
        return Err(EdgeError::Validation("actor_id is required".into()));
    }
    if request.count_ids.is_empty() {
        return Err(EdgeError::Validation(
            "name the counts to recall: a recall takes back at least one".into(),
        ));
    }
    if request.count_ids.len() > MOST_COUNTS_RECALLED {
        return Err(EdgeError::Validation(
            "a recall takes back one order's count sheet, not more".into(),
        ));
    }
    let mut ids = request.count_ids.clone();
    ids.sort();
    ids.dedup();
    let request_json = encode(&request)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    if let Some(answer) = replay(
        &tx,
        &request.idempotency_key,
        "PURCHASE_RECALL",
        &request_json,
    )? {
        tx.commit().map_err(db)?;
        return Ok(answer);
    }

    struct Held {
        line_number: i64,
        po_number: String,
        cancelled: bool,
        status: String,
        verified_by: Option<String>,
        count: RecalledCount,
    }
    let mut held = Vec::with_capacity(ids.len());
    {
        let mut statement = tx
            .prepare_cached(
                "SELECT c.count_id, c.po_line_id, c.receipt_id, c.counted_quantity,
                        c.wrong_quantity, c.counted_unit_code, c.counted_unit_quantity,
                        c.counted_by, c.counted_at, c.status, c.verified_by,
                        o.po_number, o.cancelled_at, l.line_number
                   FROM receiving_count c
                   JOIN purchase_order_line l ON l.po_line_id = c.po_line_id
                   JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
                  WHERE c.count_id = ?1",
            )
            .map_err(db)?;
        for id in &ids {
            let row = statement
                .query_row(params![id.to_string()], |row| {
                    Ok(Held {
                        line_number: row.get(13)?,
                        po_number: row.get(11)?,
                        cancelled: row.get::<_, Option<String>>(12)?.is_some(),
                        status: row.get(9)?,
                        verified_by: row.get(10)?,
                        count: RecalledCount {
                            count_id: *id,
                            po_line_id: uuid_of(row.get(1)?)?,
                            receipt_id: uuid_of(row.get(2)?)?,
                            counted_quantity: row.get(3)?,
                            wrong_quantity: row.get(4)?,
                            counted_unit_code: row.get(5)?,
                            counted_unit_quantity: row.get(6)?,
                            counted_by: row.get(7)?,
                            counted_at: time_of(row.get(8)?)?,
                            recalled_by: request.actor_id.clone(),
                            recalled_at: now,
                            reason: request.reason.clone(),
                            variants: Vec::new(),
                        },
                    })
                })
                .optional()
                .map_err(db)?;
            if let Some(row) = row {
                held.push(row);
            }
        }
    }
    if held.len() != ids.len() {
        return Err(EdgeError::NotFound(format!(
            "{} of the {} counts named are not counts at this Gudang",
            ids.len() - held.len(),
            ids.len()
        )));
    }
    // The sheet's own order, so the answer reads as the sheet did.
    held.sort_by_key(|row| row.line_number);
    let mut po_number: Option<String> = None;
    for row in &held {
        let order = &row.po_number;
        match &po_number {
            None => po_number = Some(order.clone()),
            Some(first) if first != order => {
                return Err(EdgeError::Validation(format!(
                    "a recall takes back one order's count; these are counts of {first} and \
                     {order}"
                )))
            }
            Some(_) => {}
        }
        if row.cancelled {
            return Err(EdgeError::Conflict(format!(
                "{order} was cancelled by head office; its count is void and is not recalled"
            )));
        }
        match row.status.as_str() {
            "AWAITING_VERIFICATION" => {}
            "ACCEPTED" => {
                return Err(EdgeError::Conflict(format!(
                    "{} already accepted this count of {order}; the goods are received and \
                     the count can no longer be recalled",
                    row.verified_by.as_deref().unwrap_or("the buyer")
                )));
            }
            "RECOUNT_REQUESTED" => {
                return Err(EdgeError::Conflict(format!(
                    "{} already sent this count of {order} back to be counted again; count it \
                     again",
                    row.verified_by.as_deref().unwrap_or("the buyer")
                )));
            }
            "RECALLED" => {
                return Err(EdgeError::Conflict(format!(
                    "this count of {order} was already recalled; count it again"
                )));
            }
            other => {
                return Err(EdgeError::Conflict(format!(
                    "this count of {order} is {}",
                    other.to_lowercase().replace('_', " ")
                )));
            }
        }
    }
    {
        let mut statement = tx
            .prepare_cached(
                "UPDATE receiving_count
                    SET status = 'RECALLED', recalled_by = ?2, recalled_at = ?3,
                        recall_reason = ?4
                  WHERE count_id = ?1 AND status = 'AWAITING_VERIFICATION'",
            )
            .map_err(db)?;
        for row in &held {
            statement
                .execute(params![
                    row.count.count_id.to_string(),
                    request.actor_id,
                    time_text(now),
                    request.reason
                ])
                .map_err(db)?;
        }
    }
    let mut items = Vec::with_capacity(held.len());
    for mut row in held {
        // What each count said per variant (0963): the sheet opens with them.
        row.count.variants = variants_of(&tx, &row.count.count_id.to_string())?;
        items.push(row.count);
    }
    let response = PurchaseCountRecallResult {
        po_number: po_number.unwrap_or_default(),
        items,
    };
    remember(
        &tx,
        &request.idempotency_key,
        "PURCHASE_RECALL",
        &request_json,
        &response,
    )?;
    tx.commit().map_err(db)?;
    Ok(response)
}

/// Name the person in charge on every return of one surat jalan. Refused for a
/// return that is not here, not open, or named twice.
fn note(
    connection: &mut Connection,
    request: GenerateNoteRequest,
    actor: Option<String>,
    now: DateTime<Utc>,
) -> Result<Vec<PurchaseReturnWork>, EdgeError> {
    let pic = request.pic.split_whitespace().collect::<Vec<_>>().join(" ");
    if pic.is_empty() {
        return Err(EdgeError::Validation(
            "say who is in charge of this delivery".into(),
        ));
    }
    if request.return_ids.is_empty() {
        return Err(EdgeError::Validation("no returns were named".into()));
    }
    let notes: BTreeMap<String, String> = request
        .notes
        .into_iter()
        .map(|(article, text)| (article, text.trim().to_string()))
        .filter(|(_, text)| !text.is_empty())
        .collect();
    let notes =
        serde_json::to_string(&notes).map_err(|error| EdgeError::Persistence(error.to_string()))?;
    // Who generated it: the signed-in caller. A node running without sign-in
    // (a test rig) has nobody else to name than the person in charge.
    let by = actor
        .map(|actor| actor.trim().to_string())
        .filter(|actor| !actor.is_empty())
        .unwrap_or_else(|| pic.clone());
    let ids: BTreeSet<Uuid> = request.return_ids.iter().copied().collect();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let mut done = 0usize;
    {
        let mut statement = tx
            .prepare_cached(
                "UPDATE purchase_return
                    SET note_pic = ?2, note_generated_at = ?3, note_generated_by = ?4,
                        note_line_notes = ?5
                  WHERE return_id = ?1 AND status = 'OPEN'",
            )
            .map_err(db)?;
        for id in &ids {
            done += statement
                .execute(params![id.to_string(), pic, time_text(now), by, notes])
                .map_err(db)?;
        }
    }
    // A name repeated in the list counts once, as the cloud's `ANY` does, so
    // it is refused the same way.
    if done != request.return_ids.len() {
        return Err(EdgeError::Conflict(
            "one of those returns is not open here any more".into(),
        ));
    }
    tx.commit().map_err(db)?;
    let mut items = Vec::with_capacity(request.return_ids.len());
    for id in &request.return_ids {
        items.extend(SqliteEdge::load_purchase_returns(
            connection,
            Some(&id.to_string()),
        )?);
    }
    Ok(items)
}

// ---- shared with `edge/sqlite.rs` ----------------------------------------------

/// The rules of a line counted per variant (owner, 2026-10-10): every row is a
/// colour, a size or both, named once, never negative, and together they come
/// to the line's matching pieces exactly — a breakdown, not a second count.
///
/// What a DC server cannot check is that the order named each variant: the
/// activation it was given (`purchase.order.activate`) carries no variants.
pub(crate) fn check_variants(entry: &PurchaseCountEntry) -> Result<(), EdgeError> {
    if entry.variants.is_empty() {
        return Ok(());
    }
    let mut seen = HashSet::with_capacity(entry.variants.len());
    let mut sum: i64 = 0;
    for variant in &entry.variants {
        if variant.counted_quantity < 0 {
            return Err(EdgeError::Validation(
                "a count cannot be less than nothing".into(),
            ));
        }
        let key = variant_key(variant);
        if key.0.is_none() && key.1.is_none() {
            return Err(EdgeError::Validation(
                "a variant is a colour, a size or both; this one names neither".into(),
            ));
        }
        if !seen.insert(key) {
            return Err(EdgeError::Validation(
                "a variant is counted once on a sheet; add its pieces into one figure".into(),
            ));
        }
        sum = sum.checked_add(variant.counted_quantity).ok_or_else(|| {
            EdgeError::Validation("that is more pieces than a count can hold".into())
        })?;
    }
    let right = entry.counted_quantity - entry.wrong_quantity;
    if sum != right {
        return Err(EdgeError::Validation(format!(
            "the variants come to {sum} pieces and the line to {right}; a line counted per \
             variant is the sum of its variants"
        )));
    }
    Ok(())
}

/// Write a count's breakdown beside it, in the count's own transaction: a
/// sheet is accepted whole or not at all.
pub(crate) fn insert_variants(
    connection: &Connection,
    count_id: &str,
    variants: &[PurchaseCountVariant],
) -> Result<(), EdgeError> {
    if variants.is_empty() {
        return Ok(());
    }
    let mut statement = connection
        .prepare_cached(
            "INSERT INTO receiving_count_variant
                 (count_id, colour_code, size_code, counted_quantity)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .map_err(db)?;
    for variant in variants {
        let (colour, size) = variant_key(variant);
        statement
            .execute(params![count_id, colour, size, variant.counted_quantity])
            .map_err(db)?;
    }
    Ok(())
}

/// The bay's recalled count, as the work list carries it (0950): `None` when
/// the count is not RECALLED.
pub(crate) fn recalled_count(
    connection: &Connection,
    count_id: &str,
) -> Result<Option<RecalledCount>, EdgeError> {
    let count = connection
        .prepare_cached(
            "SELECT count_id, po_line_id, receipt_id, counted_quantity, wrong_quantity,
                    counted_unit_code, counted_unit_quantity, counted_by, counted_at,
                    recalled_by, recalled_at, recall_reason
               FROM receiving_count
              WHERE count_id = ?1 AND status = 'RECALLED'",
        )
        .map_err(db)?
        .query_row(params![count_id], |row| {
            Ok(RecalledCount {
                count_id: uuid_of(row.get(0)?)?,
                po_line_id: uuid_of(row.get(1)?)?,
                receipt_id: uuid_of(row.get(2)?)?,
                counted_quantity: row.get(3)?,
                wrong_quantity: row.get(4)?,
                counted_unit_code: row.get(5)?,
                counted_unit_quantity: row.get(6)?,
                counted_by: row.get(7)?,
                counted_at: time_of(row.get(8)?)?,
                recalled_by: row.get(9)?,
                recalled_at: time_of(row.get(10)?)?,
                reason: row.get(11)?,
                variants: Vec::new(),
            })
        })
        .optional()
        .map_err(db)?;
    let Some(mut count) = count else {
        return Ok(None);
    };
    count.variants = variants_of(connection, count_id)?;
    Ok(Some(count))
}

// ---- helpers ---------------------------------------------------------------------

fn require_dc(state: &EdgeState) -> Result<(), ApiError> {
    if state.inventory.node().role != EdgeRole::Dc {
        return Err(ApiError(EdgeError::Forbidden(
            "supplier deliveries are received at a DC".into(),
        )));
    }
    Ok(())
}

/// The node's one writer connection — the same handle the inventory writes
/// through, so this module's transactions queue behind a sale's, never beside.
fn lock(connection: &Arc<Mutex<Connection>>) -> Result<MutexGuard<'_, Connection>, EdgeError> {
    connection
        .lock()
        .map_err(|_| EdgeError::Persistence("SQLite connection lock poisoned".into()))
}

/// What a count said per variant, in the order the bay wrote it.
fn variants_of(
    connection: &Connection,
    count_id: &str,
) -> Result<Vec<PurchaseCountVariant>, EdgeError> {
    let mut statement = connection
        .prepare_cached(
            "SELECT colour_code, size_code, counted_quantity
               FROM receiving_count_variant
              WHERE count_id = ?1
              ORDER BY rowid",
        )
        .map_err(db)?;
    let rows = statement
        .query_map(params![count_id], |row| {
            Ok(PurchaseCountVariant {
                colour_code: row.get(0)?,
                size_code: row.get(1)?,
                counted_quantity: row.get(2)?,
            })
        })
        .map_err(db)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db)
}

/// A counted variant's colour and size as the order line's variant spells
/// them: trimmed, and an empty one is no colour (or no size) at all.
fn variant_key(variant: &PurchaseCountVariant) -> (Option<String>, Option<String>) {
    let clean = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    (clean(&variant.colour_code), clean(&variant.size_code))
}

/// A time as the node writes it into its text columns (`sqlite::time_text`).
fn time_text(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn time_of(value: String) -> Result<DateTime<Utc>, rusqlite::Error> {
    DateTime::parse_from_rfc3339(&value)
        .map(|parsed| parsed.with_timezone(&Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn uuid_of(value: String) -> Result<Uuid, rusqlite::Error> {
    Uuid::parse_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
    })
}

fn encode<T: serde::Serialize>(request: &T) -> Result<String, EdgeError> {
    serde_json::to_string(request).map_err(|error| EdgeError::Persistence(error.to_string()))
}

/// A retried press gets the answer it already had; the same key with another
/// body, or for another operation, is refused. The node's own
/// `idempotency_response`, as `SqliteEdge::load_idempotent` reads it.
fn replay<T: serde::de::DeserializeOwned>(
    tx: &Transaction<'_>,
    key: &str,
    operation: &str,
    request_json: &str,
) -> Result<Option<T>, EdgeError> {
    let row: Option<(String, Option<String>, String)> = tx
        .prepare_cached(
            "SELECT operation, request_json, response_json
               FROM idempotency_response WHERE idempotency_key = ?1",
        )
        .map_err(db)?
        .query_row([key], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .optional()
        .map_err(db)?;
    let Some((stored_operation, stored_request, response)) = row else {
        return Ok(None);
    };
    if stored_operation != operation {
        return Err(EdgeError::Conflict(format!(
            "idempotency key already belongs to {stored_operation}"
        )));
    }
    if stored_request.as_deref() != Some(request_json) {
        return Err(EdgeError::Conflict(
            "idempotency key was already used with a different request payload".into(),
        ));
    }
    serde_json::from_str(&response)
        .map(Some)
        .map_err(|error| EdgeError::Persistence(error.to_string()))
}

/// Keep the answer under its key, in the same transaction as the work.
fn remember<T: serde::Serialize>(
    tx: &Transaction<'_>,
    key: &str,
    operation: &str,
    request_json: &str,
    response: &T,
) -> Result<(), EdgeError> {
    tx.prepare_cached(
        "INSERT INTO idempotency_response
             (idempotency_key, operation, request_json, response_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .map_err(db)?
    .execute(params![
        key,
        operation,
        request_json,
        encode(response)?,
        time_text(Utc::now())
    ])
    .map_err(db)?;
    Ok(())
}
