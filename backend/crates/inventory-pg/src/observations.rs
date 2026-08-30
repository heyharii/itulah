use super::{begin_idempotent, complete_idempotent, payload_digest};
use inventory_app::{AppError, ObservationBatchRequest};
use inventory_domain::{belongs_to_same_burst, consolidate_reads, OperationalPool, SiteId};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

pub async fn ingest_observations(
    pool: &PgPool,
    request: ObservationBatchRequest,
    burst_window_seconds: i64,
) -> Result<Value, AppError> {
    if request.observations.is_empty() {
        return Err(AppError::Validation(
            "observations batch cannot be empty".into(),
        ));
    }
    if request.device_id.trim().is_empty() || request.reader_session_id.trim().is_empty() {
        return Err(AppError::Validation(
            "device_id and reader_session_id are required".into(),
        ));
    }
    let site = SiteId::new(&request.site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let operational_pool = OperationalPool::from_str(&request.pool)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    if operational_pool.site_id() != site {
        return Err(AppError::Validation(
            "observation pool does not belong to site_id".into(),
        ));
    }
    let consolidated = consolidate_reads(&request.observations);
    if consolidated.is_empty() {
        return Err(AppError::Validation("batch contains no valid EPC".into()));
    }
    let digest = payload_digest(&request)?;
    let raw_read_count: i64 = request
        .observations
        .iter()
        .map(|r| i64::from(r.read_count.max(1)))
        .sum();
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "RFID_OBSERVATION_BATCH",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let mut inserted = 0_i64;
    let mut merged = 0_i64;
    let mut observation_ids = Vec::new();
    for read in consolidated {
        let subject_id = sqlx::query("SELECT id FROM inventory_subject WHERE epc=$1")
            .bind(&read.epc)
            .fetch_optional(&mut *tx)
            .await?
            .map(|r| r.get::<Uuid, _>("id"));
        let existing = sqlx::query("SELECT observation_id,last_seen_at FROM observation_sighting WHERE device_id=$1 AND reader_session_id=$2 AND pool_id=$3 AND epc=$4 ORDER BY last_seen_at DESC LIMIT 1 FOR UPDATE")
            .bind(&request.device_id).bind(&request.reader_session_id).bind(&request.pool).bind(&read.epc).fetch_optional(&mut *tx).await?;
        if let Some(row) = existing {
            let id: Uuid = row.get("observation_id");
            let last_seen: DateTime<Utc> = row.get("last_seen_at");
            if belongs_to_same_burst(last_seen, request.observed_at, burst_window_seconds) {
                sqlx::query("UPDATE observation_sighting SET last_seen_at=$2,received_at=now(),read_count=read_count+$3,best_rssi=CASE WHEN best_rssi IS NULL THEN $4 WHEN $4 IS NULL THEN best_rssi ELSE GREATEST(best_rssi,$4) END,antenna=COALESCE($5,antenna),subject_id=COALESCE(subject_id,$6) WHERE observation_id=$1")
                    .bind(id).bind(request.observed_at).bind(read.read_count).bind(read.best_rssi).bind(&read.antenna).bind(subject_id).execute(&mut *tx).await?;
                merged += 1;
                observation_ids.push(id);
                continue;
            }
        }
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO observation_sighting(observation_id,subject_id,epc,site_id,pool_id,first_seen_at,last_seen_at,device_id,reader_session_id,method,read_count,best_rssi,antenna) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,'RFID_HANDHELD',$9,$10,$11)")
            .bind(id).bind(subject_id).bind(&read.epc).bind(site.as_str()).bind(&request.pool).bind(request.observed_at)
            .bind(&request.device_id).bind(&request.reader_session_id).bind(read.read_count).bind(read.best_rssi).bind(&read.antenna)
            .execute(&mut *tx).await?;
        inserted += 1;
        observation_ids.push(id);
    }
    let response = json!({
        "idempotency_key":request.idempotency_key,"raw_read_count":raw_read_count,"consolidated_sighting_count":observation_ids.len(),
        "inserted":inserted,"merged_into_burst":merged,"observation_ids":observation_ids,"observed_at":request.observed_at,"received_at":Utc::now(),
        "inventory_effect":{"movement_count":0,"missing_created":0}
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn list_observations(
    pool: &PgPool,
    pool_id: Option<&str>,
    epc: Option<&str>,
    limit: i64,
) -> Result<Value, AppError> {
    let rows = sqlx::query(r#"
SELECT o.observation_id,o.subject_id,o.epc,o.site_id,o.pool_id,o.first_seen_at,o.last_seen_at,o.received_at,
       o.device_id,o.reader_session_id,o.method,o.read_count,o.best_rssi,o.antenna,sk.sku_code
FROM observation_sighting o
LEFT JOIN inventory_subject s ON s.id=o.subject_id
LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN operational_pool observed_pool ON observed_pool.id=o.pool_id
WHERE (
    $1::text IS NULL OR o.pool_id=$1
    OR EXISTS (
        SELECT 1 FROM operational_pool scope
        WHERE scope.id=$1 AND NOT scope.is_placement AND scope.outbound_stage IS NOT NULL
          AND observed_pool.is_placement AND observed_pool.outbound_stage=scope.outbound_stage
    )
) AND ($2::text IS NULL OR o.epc=$2)
ORDER BY o.last_seen_at DESC LIMIT $3
"#)
        .bind(pool_id).bind(epc.map(|v|v.to_ascii_uppercase())).bind(limit.clamp(1,500)).fetch_all(pool).await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "observation_id":r.get::<Uuid,_>("observation_id"),"subject_id":r.get::<Option<Uuid>,_>("subject_id"),"epc":r.get::<String,_>("epc"),"sku_code":r.get::<Option<String>,_>("sku_code"),
        "site_id":r.get::<String,_>("site_id"),"pool_id":r.get::<String,_>("pool_id"),"first_seen_at":r.get::<DateTime<Utc>,_>("first_seen_at"),"last_seen_at":r.get::<DateTime<Utc>,_>("last_seen_at"),"received_at":r.get::<DateTime<Utc>,_>("received_at"),
        "device_id":r.get::<String,_>("device_id"),"reader_session_id":r.get::<String,_>("reader_session_id"),"method":r.get::<String,_>("method"),"read_count":r.get::<i64,_>("read_count"),"best_rssi":r.get::<Option<f32>,_>("best_rssi"),"antenna":r.get::<Option<String>,_>("antenna")
    })).collect();
    Ok(json!({"items":items}))
}

pub async fn observation_anomalies(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(r#"
WITH latest_observation AS (
    SELECT DISTINCT ON (subject_id) subject_id,epc,pool_id,last_seen_at,device_id
    FROM observation_sighting WHERE subject_id IS NOT NULL ORDER BY subject_id,last_seen_at DESC
), deltas AS (
    SELECT subject_id,to_place_id place_id,quantity delta FROM movement
    UNION ALL SELECT subject_id,from_place_id,-quantity FROM movement
), current_ledger AS (
    SELECT d.subject_id,ip.pool_id,SUM(d.delta)::bigint quantity FROM deltas d JOIN inventory_place ip ON ip.id=d.place_id
    WHERE ip.kind='OPERATIONAL' GROUP BY d.subject_id,ip.pool_id HAVING SUM(d.delta)>0
)
SELECT o.subject_id,o.epc,o.pool_id observed_pool,o.last_seen_at,o.device_id,c.pool_id ledger_pool,c.quantity
FROM latest_observation o JOIN current_ledger c ON c.subject_id=o.subject_id WHERE c.pool_id<>o.pool_id
ORDER BY o.last_seen_at DESC
"#).fetch_all(pool).await?;
    let items: Vec<Value> = rows.into_iter().map(|r| json!({
        "type":"PLACEMENT_MISMATCH","subject_id":r.get::<Uuid,_>("subject_id"),"epc":r.get::<String,_>("epc"),
        "ledger_pool":r.get::<String,_>("ledger_pool"),"observed_pool":r.get::<String,_>("observed_pool"),"quantity":r.get::<i64,_>("quantity"),
        "last_observed_at":r.get::<DateTime<Utc>,_>("last_seen_at"),"device_id":r.get::<String,_>("device_id"),
        "automatic_inventory_effect":false
    })).collect();
    Ok(json!({"items":items}))
}
