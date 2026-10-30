//! **RFID verify** (owner, 21 Oct 2026): before a koli goes, the handheld
//! reads its tags. The Packed tab picks the koli, the reader sends every EPC
//! it saw, and each koli is checked against its own units (`dc_koli_unit`):
//! read, not read, and tags that belong to none of the chosen koli. The last
//! check of each koli is kept in `dc_koli_rfid_check` (0985).
//!
//! **A store, verified on the C5** (owner, 25 Oct 2026): Packed sends a store
//! (`dc_koli_rfid_request`, 0996), the C5 lists it, reads every packed koli of
//! it, and may Verify only when the read matches — every tag of that store's
//! koli, and none of another store's. Optional: nothing here gates a dispatch.

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

/// A koli on the Packed tab: sealed, on no trip yet, not emptied by a move
/// back (`packing.rs` `list_koli` with `ready` and `unassigned`).
const PACKED: &str = "k.sealed_at IS NOT NULL AND k.shipment_id IS NULL AND k.voided_at IS NULL";

/// What a reader sent, as `dc_koli_unit` spells an EPC.
fn seen_of(epcs: &[String]) -> BTreeSet<String> {
    epcs.iter()
        .map(|epc| epc.trim().to_uppercase())
        .filter(|epc| !epc.is_empty())
        .collect()
}

/// Write a koli's check whole; a later check replaces it.
async fn write_check(
    connection: &mut sqlx::PgConnection,
    koli_id: Uuid,
    read: &[String],
    total: i32,
    checked_by: &str,
) -> Result<sqlx::postgres::PgRow, AppError> {
    let missing = total - read.len() as i32;
    Ok(sqlx::query(
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
    .bind(read)
    .bind(total)
    .bind(missing)
    .bind(checked_by)
    .fetch_one(&mut *connection)
    .await?)
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
    let seen = seen_of(&request.epcs);

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
        let row = write_check(
            &mut *tx,
            *koli_id,
            &read,
            epcs.len() as i32,
            &principal.username,
        )
        .await?;
        items.push(check_json(&row));
    }
    tx.commit().await?;

    let extra: Vec<&String> = seen.iter().filter(|epc| !known.contains(*epc)).collect();
    Ok(Json(json!({ "items": items, "extra": extra })))
}

/// The stores Packed sent to the C5, each with its packed koli.
async fn list_requests(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    Ok(Json(json!({ "items": requests(&state).await? })))
}

async fn requests(state: &AppState) -> Result<Vec<Value>, AppError> {
    // A store whose koli have all gone — on a trip, or unpacked — has nothing
    // left to read, and its request ends here rather than coming back the next
    // time that store packs.
    sqlx::query(&format!(
        "DELETE FROM dc_koli_rfid_request r
          WHERE NOT EXISTS (SELECT 1 FROM dc_koli k
                             WHERE k.destination_store_id = r.destination_store_id
                               AND {PACKED})"
    ))
    .execute(&state.db)
    .await?;
    let rows = sqlx::query(&format!(
        "SELECT r.destination_store_id, r.requested_by, r.requested_at,
                COALESCE(shop.code, r.destination_store_id) AS store_code,
                COALESCE(shop.name, r.destination_store_id) AS store_name,
                k.koli_id, k.koli_number,
                (SELECT count(*) FROM dc_koli_unit u WHERE u.koli_id = k.koli_id)::bigint AS total
           FROM dc_koli_rfid_request r
           JOIN dc_koli k ON k.destination_store_id = r.destination_store_id AND {PACKED}
           LEFT JOIN site shop ON shop.id = r.destination_store_id
          ORDER BY r.requested_at, r.destination_store_id, k.koli_number"
    ))
    .fetch_all(&state.db)
    .await?;

    let mut items: Vec<(String, Value, Vec<Value>, i64)> = Vec::new();
    for row in &rows {
        let store: String = row.try_get("destination_store_id")?;
        let total: i64 = row.try_get("total")?;
        let koli = json!({
            "koli_id": row.try_get::<Uuid, _>("koli_id")?.to_string(),
            "koli_number": row.try_get::<String, _>("koli_number")?,
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
                    "store_code": row.try_get::<String, _>("store_code")?,
                    "store_name": row.try_get::<String, _>("store_name")?,
                    "requested_by": row.try_get::<String, _>("requested_by")?,
                    "requested_at": stamp(row.try_get("requested_at")?),
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
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<SendRequest>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let stores: BTreeSet<String> = request
        .store_ids
        .iter()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
        .collect();
    if stores.is_empty() {
        return Err(AppError::Validation("choose a store to verify".into()));
    }
    let mut tx = state.db.begin().await?;
    for store in &stores {
        let packed: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM dc_koli k WHERE k.destination_store_id = $1 AND {PACKED}"
        ))
        .bind(store)
        .fetch_one(&mut *tx)
        .await?;
        if packed == 0 {
            return Err(AppError::Conflict(format!(
                "{} has no packed koli to verify",
                store_code(&mut *tx, store).await?
            )));
        }
        sqlx::query(
            "INSERT INTO dc_koli_rfid_request (destination_store_id, requested_by, requested_at)
             VALUES ($1, $2, now())
             ON CONFLICT (destination_store_id) DO UPDATE SET
                 requested_by = EXCLUDED.requested_by, requested_at = EXCLUDED.requested_at",
        )
        .bind(store)
        .bind(&principal.username)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "items": requests(&state).await? })))
}

async fn store_code(connection: &mut sqlx::PgConnection, store: &str) -> Result<String, AppError> {
    let code: Option<String> = sqlx::query_scalar("SELECT code FROM site WHERE id = $1")
        .bind(store)
        .fetch_optional(&mut *connection)
        .await?
        .flatten();
    Ok(code.unwrap_or_else(|| store.to_owned()))
}

#[derive(Deserialize)]
struct StoreRead {
    epcs: Vec<String>,
}

/// One packed koli of the store, its tags and the ones read.
struct KoliRead {
    koli_id: Uuid,
    koli_number: String,
    epcs: Vec<String>,
    read: Vec<String>,
}

/// What a sweep came to against one store's packed koli.
struct Reading {
    store_code: String,
    koli: Vec<KoliRead>,
    /// Tags of another store's packed koli: (koli, number, store, code, tags).
    wrong: Vec<(Uuid, String, String, String, i64)>,
}

impl Reading {
    fn total(&self) -> usize {
        self.koli.iter().map(|one| one.epcs.len()).sum()
    }

    fn read(&self) -> usize {
        self.koli.iter().map(|one| one.read.len()).sum()
    }

    /// The same: every tag of every koli read, none of another store's. A
    /// tag of nobody's packed koli — loose stock nearby — changes nothing.
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
                "koli_id": one.koli_id.to_string(),
                "koli_number": one.koli_number,
                "total": one.epcs.len(),
                "read": one.read.len(),
            })).collect::<Vec<_>>(),
            "wrong_store": self.wrong.iter().map(|(koli_id, number, store_id, code, tags)| json!({
                "koli_id": koli_id.to_string(),
                "koli_number": number,
                "store_id": store_id,
                "store_code": code,
                "tags": tags,
            })).collect::<Vec<_>>(),
        })
    }
}

/// Read a store's packed koli against what was swept. `lock` holds the koli
/// (FOR SHARE) for a verify that writes their checks, as [`verify`] does.
async fn reading(
    connection: &mut sqlx::PgConnection,
    store: &str,
    seen: &BTreeSet<String>,
    lock: bool,
) -> Result<Reading, AppError> {
    let store_code = store_code(&mut *connection, store).await?;
    let koli = sqlx::query(&format!(
        "SELECT k.koli_id, k.koli_number FROM dc_koli k
          WHERE k.destination_store_id = $1 AND {PACKED}
          ORDER BY k.koli_number{}",
        if lock { " FOR SHARE" } else { "" }
    ))
    .bind(store)
    .fetch_all(&mut *connection)
    .await?;
    if koli.is_empty() {
        return Err(AppError::Conflict(format!(
            "{store_code} has no packed koli left; it may have gone on a trip"
        )));
    }
    let mut by_koli: Vec<KoliRead> = Vec::with_capacity(koli.len());
    for row in &koli {
        by_koli.push(KoliRead {
            koli_id: row.try_get("koli_id")?,
            koli_number: row.try_get("koli_number")?,
            epcs: Vec::new(),
            read: Vec::new(),
        });
    }
    let ids: Vec<Uuid> = by_koli.iter().map(|one| one.koli_id).collect();
    let units =
        sqlx::query("SELECT koli_id, epc FROM dc_koli_unit WHERE koli_id = ANY($1) ORDER BY epc")
            .bind(&ids)
            .fetch_all(&mut *connection)
            .await?;
    let mut known = BTreeSet::new();
    for row in &units {
        let koli_id: Uuid = row.try_get("koli_id")?;
        let epc: String = row.try_get("epc")?;
        if let Some(one) = by_koli.iter_mut().find(|one| one.koli_id == koli_id) {
            if seen.contains(&epc) {
                one.read.push(epc.clone());
            }
            one.epcs.push(epc.clone());
        }
        known.insert(epc);
    }

    let others: Vec<String> = seen
        .iter()
        .filter(|epc| !known.contains(*epc))
        .cloned()
        .collect();
    let mut wrong = Vec::new();
    if !others.is_empty() {
        let rows = sqlx::query(&format!(
            "SELECT k.koli_id, k.koli_number, k.destination_store_id,
                    COALESCE(shop.code, k.destination_store_id) AS store_code,
                    count(*)::bigint AS tags
               FROM dc_koli_unit u
               JOIN dc_koli k ON k.koli_id = u.koli_id
               LEFT JOIN site shop ON shop.id = k.destination_store_id
              WHERE u.epc = ANY($1) AND k.destination_store_id <> $2 AND {PACKED}
              GROUP BY k.koli_id, k.koli_number, k.destination_store_id, shop.code
              ORDER BY k.koli_number"
        ))
        .bind(&others)
        .bind(store)
        .fetch_all(&mut *connection)
        .await?;
        for row in &rows {
            wrong.push((
                row.try_get("koli_id")?,
                row.try_get("koli_number")?,
                row.try_get("destination_store_id")?,
                row.try_get("store_code")?,
                row.try_get("tags")?,
            ));
        }
    }
    Ok(Reading {
        store_code,
        koli: by_koli,
        wrong,
    })
}

/// What the C5's sweep comes to against the store, saved nowhere.
async fn check_store(
    State(state): State<AppState>,
    Path(store_id): Path<String>,
    Json(request): Json<StoreRead>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let store = store_id.trim();
    let mut connection = state.db.acquire().await?;
    let reading = reading(&mut *connection, store, &seen_of(&request.epcs), false).await?;
    Ok(Json(reading.json(store)))
}

/// Verify the store: only when the sweep matches, read again here under the
/// koli's locks. Every koli of it is then Verified and the store leaves the
/// C5's list.
async fn verify_store(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(store_id): Path<String>,
    Json(request): Json<StoreRead>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let store = store_id.trim();
    let mut tx = state.db.begin().await?;
    let reading = reading(&mut *tx, store, &seen_of(&request.epcs), true).await?;
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
        return Err(AppError::Conflict(format!(
            "{} does not match: {}",
            reading.store_code,
            said.join(", ")
        )));
    }
    let mut items = Vec::with_capacity(reading.koli.len());
    for one in &reading.koli {
        let row = write_check(
            &mut *tx,
            one.koli_id,
            &one.read,
            one.epcs.len() as i32,
            &principal.username,
        )
        .await?;
        items.push(check_json(&row));
    }
    sqlx::query("DELETE FROM dc_koli_rfid_request WHERE destination_store_id = $1")
        .bind(store)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "store": reading.json(store), "items": items }),
    ))
}
