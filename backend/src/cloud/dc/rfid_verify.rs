//! **RFID verify** (owner, 21 Oct 2026): before a koli goes, the handheld
//! reads its tags. The Packed tab picks the koli, the reader sends every EPC
//! it saw, and each koli is checked against its own units (`dc_koli_unit`):
//! read, not read, and tags that belong to none of the chosen koli. The last
//! check of each koli is kept in `dc_koli_rfid_check` (0985).

use super::common;
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/koli-rfid", get(list_checks))
        .route("/api/v1/dc/koli-rfid/verify", post(verify))
        .route("/api/v1/dc/koli/{koli_id}/epcs", get(koli_epcs))
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_id(value: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(value.trim()).map_err(|_| AppError::NotFound(format!("koli {value}")))
}

fn check_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "koli_id": row.get::<Uuid, _>("koli_id").to_string(),
        "total": row.get::<i32, _>("total"),
        "missing": row.get::<i32, _>("missing"),
        "checked_by": row.get::<String, _>("checked_by"),
        "checked_at": stamp(row.get("checked_at")),
        "verified_at": row
            .get::<Option<DateTime<Utc>>, _>("verified_at")
            .map(stamp),
    })
}

/// The last check of every koli that has one.
async fn list_checks(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let rows = sqlx::query(
        "SELECT koli_id, total, missing, checked_by, checked_at, verified_at
           FROM dc_koli_rfid_check",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        json!({ "items": rows.iter().map(check_json).collect::<Vec<_>>() }),
    ))
}

/// One koli's EPCs, with whether the last check read each.
async fn koli_epcs(
    State(state): State<AppState>,
    Path(koli_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let koli_id = parse_id(&koli_id)?;
    let check = sqlx::query(
        "SELECT koli_id, total, missing, checked_by, checked_at, verified_at, read_epcs
           FROM dc_koli_rfid_check WHERE koli_id = $1",
    )
    .bind(koli_id)
    .fetch_optional(&state.db)
    .await?;
    let read: BTreeSet<String> = check
        .as_ref()
        .map(|row| row.get::<Vec<String>, _>("read_epcs").into_iter().collect())
        .unwrap_or_default();
    let units = sqlx::query(
        "SELECT epc, sku_code FROM dc_koli_unit WHERE koli_id = $1 ORDER BY sku_code, epc",
    )
    .bind(koli_id)
    .fetch_all(&state.db)
    .await?;
    let epcs: Vec<Value> = units
        .iter()
        .map(|row| {
            let epc: String = row.get("epc");
            json!({
                "read": check.as_ref().map(|_| read.contains(&epc)),
                "sku_code": row.get::<String, _>("sku_code"),
                "epc": epc,
            })
        })
        .collect();
    Ok(Json(json!({
        "koli_id": koli_id.to_string(),
        "epcs": epcs,
        "check": check.as_ref().map(check_json),
    })))
}

#[derive(Deserialize)]
struct VerifyRequest {
    koli_ids: Vec<String>,
    epcs: Vec<String>,
}

/// What the handheld read, against the chosen koli. Each koli's check is
/// written whole (a later check replaces it); the tags that belong to none of
/// them are answered, not stored.
async fn verify(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    if request.koli_ids.is_empty() {
        return Err(AppError::Validation("choose a koli to verify".into()));
    }
    let ids: Vec<Uuid> = request
        .koli_ids
        .iter()
        .map(|id| parse_id(id))
        .collect::<Result<_, _>>()?;
    let seen: BTreeSet<String> = request
        .epcs
        .iter()
        .map(|epc| epc.trim().to_uppercase())
        .filter(|epc| !epc.is_empty())
        .collect();

    let mut tx = state.db.begin().await?;
    // The koli themselves, read in the transaction that writes their checks
    // and held there (FOR SHARE). A move back and a dispatch both lock a koli
    // FOR UPDATE before they change it (`move_back.rs`, `packing_stages.rs`),
    // so neither can empty, void or send one between what is read here and
    // the check written for it: whichever comes second sees what the first
    // did.
    let koli = sqlx::query(
        "SELECT koli_id, koli_number, stage, voided_at
           FROM dc_koli WHERE koli_id = ANY($1)
          ORDER BY koli_number
            FOR SHARE",
    )
    .bind(&ids)
    .fetch_all(&mut *tx)
    .await?;
    let mut numbers: BTreeMap<Uuid, String> = BTreeMap::new();
    for row in &koli {
        let koli_id: Uuid = row.try_get("koli_id")?;
        let number: String = row.try_get("koli_number")?;
        // A carton a move back emptied is no carton any more (move_back.rs),
        // and one already on the road is not in the building to be read.
        if row
            .try_get::<Option<DateTime<Utc>>, _>("voided_at")?
            .is_some()
        {
            return Err(AppError::Conflict(format!(
                "{number} was emptied by a move back; there is no koli left to verify"
            )));
        }
        if row.try_get::<String, _>("stage")? == "IN_TRANSIT" {
            return Err(AppError::Conflict(format!(
                "{number} has already left on its trip; it can only be verified before it goes"
            )));
        }
        numbers.insert(koli_id, number);
    }
    // An unknown id is a koli that does not exist, said as such — not the
    // foreign key of `dc_koli_rfid_check` failing as a server error.
    if let Some(unknown) = ids.iter().find(|id| !numbers.contains_key(*id)) {
        return Err(AppError::NotFound(format!("koli {unknown}")));
    }

    let units = sqlx::query("SELECT koli_id, epc FROM dc_koli_unit WHERE koli_id = ANY($1)")
        .bind(&ids)
        .fetch_all(&mut *tx)
        .await?;
    let mut by_koli: BTreeMap<Uuid, Vec<String>> = ids.iter().map(|id| (*id, Vec::new())).collect();
    let mut known = BTreeSet::new();
    for row in &units {
        let epc: String = row.get("epc");
        known.insert(epc.clone());
        by_koli.entry(row.get("koli_id")).or_default().push(epc);
    }
    // A koli with nothing in it cannot be verified. Its check would count
    // nothing missing, and 0985 records a check with nothing missing as
    // Verified — a carton marked read with not one tag read.
    if let Some((koli_id, _)) = by_koli.iter().find(|(_, epcs)| epcs.is_empty()) {
        let number = numbers
            .get(koli_id)
            .cloned()
            .unwrap_or_else(|| koli_id.to_string());
        return Err(AppError::Conflict(format!(
            "{number} holds no pieces; there is nothing in it to verify"
        )));
    }

    let mut items = Vec::new();
    for (koli_id, epcs) in &by_koli {
        let read: Vec<String> = epcs.iter().filter(|e| seen.contains(*e)).cloned().collect();
        let total = epcs.len() as i32;
        let missing = total - read.len() as i32;
        let row = sqlx::query(
            "INSERT INTO dc_koli_rfid_check
                 (koli_id, read_epcs, total, missing, checked_by, checked_at, verified_at)
             VALUES ($1, $2, $3, $4, $5, now(), CASE WHEN $4 = 0 THEN now() END)
             ON CONFLICT (koli_id) DO UPDATE SET
                 read_epcs = EXCLUDED.read_epcs, total = EXCLUDED.total,
                 missing = EXCLUDED.missing, checked_by = EXCLUDED.checked_by,
                 checked_at = EXCLUDED.checked_at, verified_at = EXCLUDED.verified_at
             RETURNING koli_id, total, missing, checked_by, checked_at, verified_at",
        )
        .bind(koli_id)
        .bind(&read)
        .bind(total)
        .bind(missing)
        .bind(&principal.username)
        .fetch_one(&mut *tx)
        .await?;
        items.push(check_json(&row));
    }
    tx.commit().await?;

    let extra: Vec<&String> = seen.iter().filter(|epc| !known.contains(*epc)).collect();
    Ok(Json(json!({ "items": items, "extra": extra })))
}
