//! The Gudang's official counts, in the DC server's shape.
//!
//! With no node owning the Gudang's site, a count is executed by the cloud
//! itself (`postgres::counts`: the snapshot at activation, entries, submit to
//! REVIEW, approval). These routes show those counts as the DC server showed
//! its own (`EdgeOfficialCountSummary`, `EdgeOfficialCountDetail`), and hand
//! the handheld's entries and submit to the cloud's count functions — after
//! the checks the DC server made on an entry (`record_official_count_entries_impl`):
//! a tag is found once or not at all, inside the count's scope, as the SKU it
//! is known as, and a tag the count did not expect must have been physically
//! found and must not stand anywhere else.
//!
//! The DC server's words for the states: ACTIVE, SUBMITTED (the cloud's
//! REVIEW), CLOSED. A cloud count has no separate result record — the count is
//! its own result — so its result id is the count's id.

use super::{actor_of, hosted, normalized_epc, require_key, unit_subject_tx};
use crate::cloud::application::{CommandRequest, CountEntriesRequest, CountEntryInput};
use crate::cloud::dc::common;
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::edge::contracts::{
    EdgeOfficialCountDetail, EdgeOfficialCountLine, EdgeOfficialCountSummary,
    OfficialCountEntriesRequest, OfficialCountSubmitRequest, OfficialCountSubmitResult,
};
use crate::sync::workflow::OfficialCountScope;
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use std::collections::HashSet;
use uuid::Uuid;

/// The DC server's word for a count's state.
fn edge_status(status: &str) -> &str {
    match status {
        "REVIEW" => "SUBMITTED",
        other => other,
    }
}

/// The counts the Gudang runs, as the DC server listed them: activated, at its
/// own site, executed here. `$1` the site, `$2` one count or NULL.
const COUNTS: &str = "
WITH counts AS (
    SELECT c.id, c.site_id, c.pool_id, c.kind, c.status, c.reason, c.created_by,
           c.created_at, COALESCE(c.activated_at, c.created_at) AS activated_at,
           c.submitted_at, c.closed_at, c.scope_json, c.adjustment_id,
           c.approval_movement_group_id
      FROM official_count c
     WHERE c.site_id = $1
       AND c.activation_target_origin_id IS NULL
       AND c.status IN ('ACTIVE', 'REVIEW', 'CLOSED')
       AND ($2::uuid IS NULL OR c.id = $2)
     ORDER BY COALESCE(c.activated_at, c.created_at) DESC, c.id
     LIMIT 200
), lines AS (
    SELECT COALESCE(s.count_id, e.count_id) AS count_id,
           COALESCE(s.expected_quantity, 0)::bigint AS expected,
           COALESCE(e.found_quantity, 0)::bigint AS found
      FROM (SELECT * FROM count_snapshot WHERE count_id IN (SELECT id FROM counts)) s
      FULL OUTER JOIN (SELECT * FROM count_entry WHERE count_id IN (SELECT id FROM counts)) e
        ON e.count_id = s.count_id AND e.subject_id = s.subject_id
), tally AS (
    SELECT count_id,
           SUM(expected)::bigint AS expected,
           SUM(found)::bigint AS found,
           COUNT(*) FILTER (WHERE found = expected)::bigint AS matches,
           COUNT(*) FILTER (WHERE found < expected)::bigint AS shortages,
           COUNT(*) FILTER (WHERE found > expected)::bigint AS gains
      FROM lines GROUP BY count_id
)
SELECT c.*,
       COALESCE(t.expected, 0) AS expected, COALESCE(t.found, 0) AS found,
       COALESCE(t.matches, 0) AS matches, COALESCE(t.shortages, 0) AS shortages,
       COALESCE(t.gains, 0) AS gains,
       COALESCE((SELECT array_agg(sku.sku_code ORDER BY sku.sku_code) FROM sku
                  WHERE sku.id::text IN (SELECT jsonb_array_elements_text(
                                             COALESCE(c.scope_json->'sku_ids', '[]'::jsonb)))),
                '{}') AS sku_codes
  FROM counts c
  LEFT JOIN tally t ON t.count_id = c.id
 ORDER BY c.activated_at DESC, c.id";

fn summary_from(row: &sqlx::postgres::PgRow) -> Result<EdgeOfficialCountSummary, AppError> {
    let count_id: Uuid = row.try_get("id")?;
    let status: String = row.try_get("status")?;
    let mut scope: OfficialCountScope =
        serde_json::from_value(row.try_get::<Value, _>("scope_json")?)?;
    scope.sku_codes = row.try_get("sku_codes")?;
    let submitted = status == "REVIEW" || status == "CLOSED";
    let closed = status == "CLOSED";
    Ok(EdgeOfficialCountSummary {
        count_id,
        site_id: row.try_get("site_id")?,
        pool_id: row.try_get("pool_id")?,
        kind: row.try_get("kind")?,
        status: edge_status(&status).to_owned(),
        reason: row.try_get("reason")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        activated_at: row.try_get("activated_at")?,
        submitted_at: row.try_get("submitted_at")?,
        closed_at: row.try_get("closed_at")?,
        scope,
        result_id: submitted.then_some(count_id),
        adjustment_id: row.try_get("adjustment_id")?,
        // Approval applies the difference in the same transaction here.
        adjustment_status: closed.then(|| "APPLIED".to_owned()),
        adjustment_completion_id: None,
        movement_group_ids: row
            .try_get::<Option<Uuid>, _>("approval_movement_group_id")?
            .into_iter()
            .collect(),
        expected: row.try_get("expected")?,
        found: row.try_get("found")?,
        match_epcs: row.try_get("matches")?,
        shortage_epcs: row.try_get("shortages")?,
        gain_epcs: row.try_get("gains")?,
    })
}

/// A count's lines: every subject expected or entered, tag by tag.
async fn count_lines(
    conn: &mut PgConnection,
    count_id: Uuid,
) -> Result<Vec<EdgeOfficialCountLine>, AppError> {
    let rows = sqlx::query(
        "SELECT COALESCE(subject.epc, subject.barcode, subject.id::text) AS epc, sku.sku_code,
                COALESCE(snapshot.expected_quantity, 0)::bigint AS expected_quantity,
                COALESCE(entry.found_quantity, 0)::bigint AS found_quantity
           FROM (SELECT * FROM count_snapshot WHERE count_id = $1) snapshot
           FULL OUTER JOIN (SELECT * FROM count_entry WHERE count_id = $1) entry
             ON entry.subject_id = snapshot.subject_id
           JOIN inventory_subject subject
             ON subject.id = COALESCE(snapshot.subject_id, entry.subject_id)
           JOIN sku ON sku.id = subject.sku_id
          ORDER BY 1",
    )
    .bind(count_id)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let expected_quantity: i64 = row.try_get("expected_quantity")?;
            let found_quantity: i64 = row.try_get("found_quantity")?;
            Ok(EdgeOfficialCountLine {
                epc: row.try_get("epc")?,
                sku_code: row.try_get("sku_code")?,
                expected_quantity,
                found_quantity,
                adjustment_quantity: found_quantity - expected_quantity,
            })
        })
        .collect()
}

async fn load_detail(
    conn: &mut PgConnection,
    site_id: &str,
    count_id: Uuid,
) -> Result<EdgeOfficialCountDetail, AppError> {
    let row = sqlx::query(COUNTS)
        .bind(site_id)
        .bind(Some(count_id))
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Official Count {count_id}")))?;
    let mut summary = summary_from(&row)?;
    // The whole set of movements a closed count made, for the one count shown.
    if summary.status == "CLOSED" {
        summary.movement_group_ids = sqlx::query_scalar(
            "SELECT id FROM movement_group
              WHERE reference_type = 'OFFICIAL_COUNT' AND reference_id = $1
              ORDER BY occurred_at, id",
        )
        .bind(count_id.to_string())
        .fetch_all(&mut *conn)
        .await?;
    }
    Ok(EdgeOfficialCountDetail {
        summary,
        lines: count_lines(conn, count_id).await?,
    })
}

/// The Gudang's counts, newest first.
pub(super) async fn list(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(COUNTS)
        .bind(&site)
        .bind(None::<Uuid>)
        .fetch_all(&state.db)
        .await?;
    let items = rows
        .iter()
        .map(summary_from)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(
        json!({ "items": items, "execution_authority": "CLOUD" }),
    ))
}

pub(super) async fn detail(
    State(state): State<AppState>,
    Path(count_id): Path<Uuid>,
) -> Result<Json<EdgeOfficialCountDetail>, AppError> {
    hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let mut conn = state.db.acquire().await?;
    Ok(Json(load_detail(&mut *conn, &site, count_id).await?))
}

/// The count must be the Gudang's and run here.
async fn own_count(
    conn: &mut PgConnection,
    site_id: &str,
    count_id: Uuid,
) -> Result<(String, Value), AppError> {
    let row = sqlx::query(
        "SELECT site_id, status, scope_json, activation_target_origin_id
           FROM official_count WHERE id = $1",
    )
    .bind(count_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Official Count {count_id}")))?;
    if row.try_get::<String, _>("site_id")? != site_id {
        return Err(AppError::Forbidden(
            "Official Count belongs to a different site".into(),
        ));
    }
    if row
        .try_get::<Option<String>, _>("activation_target_origin_id")?
        .is_some()
    {
        return Err(AppError::Conflict(
            "this count is run by a DC server; record it there".into(),
        ));
    }
    Ok((row.try_get("status")?, row.try_get("scope_json")?))
}

/// Scan pieces into a count.
pub(super) async fn entries(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(count_id): Path<Uuid>,
    Json(mut request): Json<OfficialCountEntriesRequest>,
) -> Result<Json<EdgeOfficialCountDetail>, AppError> {
    hosted()?;
    let actor = actor_of(&principal)?;
    let key = require_key(&request.idempotency_key)?;
    if request.entries.is_empty() {
        return Err(AppError::Validation(
            "Official Count entries cannot be empty".into(),
        ));
    }
    let mut seen = HashSet::new();
    for entry in &mut request.entries {
        entry.epc = normalized_epc(&entry.epc)?;
        entry.sku_code = entry.sku_code.trim().to_ascii_uppercase();
        if entry.sku_code.is_empty() {
            return Err(AppError::Validation("sku_code is required".into()));
        }
        if !(0..=1).contains(&entry.found_quantity) {
            return Err(AppError::Validation(
                "EPC found_quantity must be zero or one".into(),
            ));
        }
        if !seen.insert(entry.epc.clone()) {
            return Err(AppError::Validation(format!(
                "duplicate Official Count EPC {}",
                entry.epc
            )));
        }
    }
    // One order, so the same scan sent again is the same request to the
    // cloud's idempotency.
    request
        .entries
        .sort_by(|left, right| left.epc.cmp(&right.epc));
    let site = common::gudang_site(&state.db).await?;

    // Resolve every tag to its subject, creating one only for a piece the
    // count did not expect and that nothing else holds — the DC server's
    // rules. Committed before the entries are recorded: a subject is a fact
    // about a garment, not about this count.
    let mut tx = state.db.begin().await?;
    let (status, scope_json) = own_count(&mut *tx, &site, count_id).await?;
    if status != "ACTIVE" && status != "REVIEW" {
        return Err(AppError::Conflict(format!(
            "Official Count entries require ACTIVE status, currently {}",
            edge_status(&status)
        )));
    }
    let scope: OfficialCountScope = serde_json::from_value(scope_json)?;
    let scope_skus: HashSet<String> =
        sqlx::query_scalar::<_, String>("SELECT upper(sku_code) FROM sku WHERE id = ANY($1)")
            .bind(&scope.sku_ids)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect();
    let scope_epcs: HashSet<String> = scope
        .epcs
        .iter()
        .map(|epc| epc.trim().to_ascii_uppercase())
        .collect();
    let mut inputs = Vec::with_capacity(request.entries.len());
    for entry in &request.entries {
        if (!scope.sku_ids.is_empty() && !scope_skus.contains(&entry.sku_code))
            || (!scope_epcs.is_empty() && !scope_epcs.contains(&entry.epc))
        {
            return Err(AppError::Validation(format!(
                "EPC {} / SKU {} is outside the Official Count scope",
                entry.epc, entry.sku_code
            )));
        }
        let expected: Option<(Uuid, String)> = sqlx::query_as(
            "SELECT snapshot.subject_id, upper(sku.sku_code)
               FROM count_snapshot snapshot
               JOIN inventory_subject subject ON subject.id = snapshot.subject_id
               JOIN sku ON sku.id = subject.sku_id
              WHERE snapshot.count_id = $1 AND subject.epc = $2",
        )
        .bind(count_id)
        .bind(&entry.epc)
        .fetch_optional(&mut *tx)
        .await?;
        let subject_id = match expected {
            Some((subject_id, sku_code)) => {
                if sku_code != entry.sku_code {
                    return Err(AppError::Conflict(format!(
                        "EPC {} is expected as SKU {sku_code}, not {}",
                        entry.epc, entry.sku_code
                    )));
                }
                subject_id
            }
            None => {
                if entry.found_quantity == 0 {
                    return Err(AppError::Validation(format!(
                        "entry-only EPC {} must be physically found",
                        entry.epc
                    )));
                }
                let known = sqlx::query(
                    "SELECT subject.id, upper(sku.sku_code) AS sku_code,
                            EXISTS (SELECT 1 FROM inventory_projection projection
                                      JOIN inventory_place place ON place.id = projection.place_id
                                     WHERE projection.subject_id = subject.id
                                       AND projection.quantity > 0 AND place.is_company)
                                AS positioned
                       FROM inventory_subject subject
                       LEFT JOIN sku ON sku.id = subject.sku_id
                      WHERE subject.epc = $1",
                )
                .bind(&entry.epc)
                .fetch_optional(&mut *tx)
                .await?;
                match known {
                    Some(known) => {
                        let sku_code: Option<String> = known.try_get("sku_code")?;
                        if sku_code.as_deref() != Some(entry.sku_code.as_str()) {
                            return Err(AppError::Conflict(format!(
                                "EPC {} already identifies SKU {}",
                                entry.epc,
                                sku_code.unwrap_or_default()
                            )));
                        }
                        if known.try_get::<bool, _>("positioned")? {
                            return Err(AppError::Conflict(format!(
                                "entry-only EPC {} already has an inventory position",
                                entry.epc
                            )));
                        }
                        known.try_get("id")?
                    }
                    None => unit_subject_tx(&mut tx, &entry.epc, &entry.sku_code)
                        .await?
                        .ok_or_else(|| {
                            AppError::Validation(format!(
                                "SKU {} is not in the catalogue, so {} cannot be counted in",
                                entry.sku_code, entry.epc
                            ))
                        })?,
                }
            }
        };
        inputs.push(CountEntryInput {
            subject_id: Some(subject_id),
            epc: None,
            found_quantity: entry.found_quantity,
        });
    }
    tx.commit().await?;

    crate::cloud::postgres::add_count_entries(
        &state.db,
        count_id,
        CountEntriesRequest {
            actor_id: actor,
            idempotency_key: key,
            entries: inputs,
        },
    )
    .await?;
    let mut conn = state.db.acquire().await?;
    Ok(Json(load_detail(&mut *conn, &site, count_id).await?))
}

/// Hand the count in: ACTIVE → the cloud's REVIEW, for head office to approve.
pub(super) async fn submit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(count_id): Path<Uuid>,
    Json(request): Json<OfficialCountSubmitRequest>,
) -> Result<Json<OfficialCountSubmitResult>, AppError> {
    hosted()?;
    let actor = actor_of(&principal)?;
    let key = require_key(&request.idempotency_key)?;
    let site = common::gudang_site(&state.db).await?;
    let mut conn = state.db.acquire().await?;
    own_count(&mut *conn, &site, count_id).await?;
    // The cloud's submit holds the rules (ACTIVE only) and the idempotency:
    // the same key again answers the same submission.
    crate::cloud::postgres::submit_count(
        &state.db,
        count_id,
        CommandRequest {
            actor_id: actor,
            idempotency_key: key,
        },
    )
    .await?;
    let (status, submitted_at): (String, Option<DateTime<Utc>>) =
        sqlx::query_as("SELECT status, submitted_at FROM official_count WHERE id = $1")
            .bind(count_id)
            .fetch_one(&mut *conn)
            .await?;
    Ok(Json(OfficialCountSubmitResult {
        count_id,
        result_id: count_id,
        status: edge_status(&status).to_owned(),
        submitted_at: submitted_at.unwrap_or_else(|| state.clock.now()),
        lines: count_lines(&mut *conn, count_id).await?,
    }))
}
