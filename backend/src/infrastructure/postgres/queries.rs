use super::{create_movement, movement_request_for_resolution, parse_missing_id};
use crate::{
    application::{AppError, AsOfQuery, MissingResolutionRequest},
    domain::{InventoryBalance, OperationalPool},
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

pub async fn list_pools(
    pool: &PgPool,
    at: Option<DateTime<Utc>>,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let at = at.unwrap_or_else(Utc::now);
    let rows = sqlx::query(r#"
WITH ledger_deltas AS (
    SELECT m.subject_id, ip.pool_id, ip.state, m.quantity AS delta
    FROM movement m JOIN inventory_place ip ON ip.id=m.to_place_id
    WHERE ip.kind='OPERATIONAL' AND m.occurred_at <= $1
    UNION ALL
    SELECT m.subject_id, ip.pool_id, ip.state, -m.quantity AS delta
    FROM movement m JOIN inventory_place ip ON ip.id=m.from_place_id
    WHERE ip.kind='OPERATIONAL' AND m.occurred_at <= $1
), balances AS (
    SELECT pool_id, state, SUM(delta)::bigint quantity FROM ledger_deltas GROUP BY pool_id,state
), observed AS (
    SELECT pool_id, COUNT(DISTINCT COALESCE(subject_id::text,epc))::bigint quantity
    FROM observation_sighting WHERE last_seen_at > $1 - ($2::text || ' hours')::interval AND last_seen_at <= $1 GROUP BY pool_id
), opening AS (
    SELECT p.id AS pool_id, COALESCE(SUM(CASE WHEN m.to_place_id=p.id||':on_hand' THEN m.quantity WHEN m.from_place_id=p.id||':on_hand' THEN -m.quantity ELSE 0 END),0)::bigint quantity
    FROM operational_pool p LEFT JOIN movement m ON m.occurred_at < $1 - ($3::text || ' days')::interval AND (m.to_place_id=p.id||':on_hand' OR m.from_place_id=p.id||':on_hand')
    GROUP BY p.id
), inbound AS (
    SELECT p.id AS pool_id, COALESCE(SUM(m.quantity),0)::bigint quantity FROM operational_pool p
    LEFT JOIN movement m ON m.to_place_id=p.id||':on_hand' AND m.occurred_at >= $1 - ($3::text || ' days')::interval AND m.occurred_at <= $1 GROUP BY p.id
), lost AS (
    SELECT p.id AS pool_id, COALESCE(SUM(m.quantity),0)::bigint quantity FROM operational_pool p
    LEFT JOIN movement m ON m.from_place_id=p.id||':missing' AND m.to_place_id='system/lost' AND m.occurred_at >= $1 - ($3::text || ' days')::interval AND m.occurred_at <= $1 GROUP BY p.id
), allotted_balance AS (
    SELECT COALESCE(event.source_pool_id,line.source_pool_id) source_pool_id,
           COALESCE(SUM(event.remaining_delta),0)::bigint quantity
    FROM allotment_event event
    LEFT JOIN allotment_line line ON line.id=event.allotment_line_id
    WHERE event.occurred_at <= $1
    GROUP BY COALESCE(event.source_pool_id,line.source_pool_id)
)
SELECT p.id,p.site_id,s.name site_name,s.kind site_kind,p.group_code,p.pool_code,p.label,p.store_origin_site_id,p.display_order,
       COALESCE(normal.quantity,0)::bigint normal,
       COALESCE(missing.quantity,0)::bigint missing,
       COALESCE(observed.quantity,0)::bigint observed,
       COALESCE(allotted.quantity,0)::bigint allotted,
       COALESCE(lost.quantity,0)::bigint lost_quantity,
       CASE WHEN GREATEST(opening.quantity,0)+inbound.quantity > 0
            THEN ROUND(lost.quantity::numeric/(GREATEST(opening.quantity,0)+inbound.quantity)::numeric,6)
            ELSE 0 END::text lost_rate,
       (GREATEST(opening.quantity,0)+inbound.quantity)::bigint exposure
FROM operational_pool p JOIN site s ON s.id=p.site_id
LEFT JOIN balances normal ON normal.pool_id=p.id AND normal.state='NORMAL'
LEFT JOIN balances missing ON missing.pool_id=p.id AND missing.state='MISSING'
LEFT JOIN observed ON observed.pool_id=p.id
LEFT JOIN allotted_balance allotted ON allotted.source_pool_id=p.id
JOIN opening ON opening.pool_id=p.id
JOIN inbound ON inbound.pool_id=p.id
JOIN lost ON lost.pool_id=p.id
WHERE p.active ORDER BY CASE WHEN p.site_id='dc' THEN 0 ELSE 1 END,p.site_id,p.display_order,p.id
"#).bind(at).bind(observed_hours).bind(lost_days).fetch_all(pool).await?;
    let items = rows
        .into_iter()
        .map(|row| {
            let balance = InventoryBalance::project(
                row.get::<i64, _>("normal"),
                row.get::<Option<i64>, _>("allotted"),
                row.get::<i64, _>("missing"),
                row.get::<i64, _>("observed"),
            )
            .map_err(|error| AppError::Conflict(format!("invalid inventory projection: {error}")))?;
            Ok(json!({
                "id":row.get::<String,_>("id"),"site_id":row.get::<String,_>("site_id"),"site_name":row.get::<String,_>("site_name"),"site_kind":row.get::<String,_>("site_kind"),
                "group":row.get::<String,_>("group_code"),"pool_code":row.get::<String,_>("pool_code"),"label":row.get::<String,_>("label"),
                "store_origin_site_id":row.get::<Option<String>,_>("store_origin_site_id"),"display_order":row.get::<i32,_>("display_order"),
                "stock":balance.stock.value(),"allotted":balance.allotted.map(|quantity| quantity.value()),"on_hand":balance.on_hand.value(),
                "missing":balance.missing.value(),"observed":balance.observed.value(),
                "lost_rate":row.get::<String,_>("lost_rate").parse::<f64>().unwrap_or(0.0),"lost_quantity":row.get::<i64,_>("lost_quantity"),"exposure":row.get::<i64,_>("exposure")
            }))
        })
        .collect::<Result<Vec<Value>, AppError>>()?;
    Ok(json!({
        "as_of":at,"read_only": at < Utc::now() - chrono::Duration::seconds(2),"observed_window_hours":observed_hours,"lost_risk_window_days":lost_days,
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "lost_risk_formula":"confirmed Lost from pool during window / (opening operational balance + inbound movements during window)","items":items
    }))
}

pub async fn get_pool(
    pool: &PgPool,
    pool_id: &str,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    OperationalPool::from_str(pool_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let summary = list_pools(pool, None, observed_hours, lost_days).await?;
    let row = summary
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|v| v.get("id").and_then(Value::as_str) == Some(pool_id))
        })
        .cloned()
        .ok_or_else(|| AppError::NotFound("operational pool".into()))?;
    let item_rows = sqlx::query("SELECT p.subject_id,s.subject_type,s.epc,s.barcode,s.quantity subject_quantity,p.quantity,sk.sku_code,a.article_code,a.name FROM inventory_projection p JOIN inventory_subject s ON s.id=p.subject_id LEFT JOIN sku sk ON sk.id=s.sku_id LEFT JOIN article a ON a.id=sk.article_id WHERE p.place_id=$1||':on_hand' ORDER BY s.epc NULLS LAST LIMIT 200")
        .bind(pool_id).fetch_all(pool).await?;
    let items: Vec<Value> = item_rows.into_iter().map(|r| json!({"subject_id":r.get::<Uuid,_>("subject_id"),"subject_type":r.get::<String,_>("subject_type"),"epc":r.get::<Option<String>,_>("epc"),"barcode":r.get::<Option<String>,_>("barcode"),"quantity":r.get::<i64,_>("quantity"),"sku_code":r.get::<Option<String>,_>("sku_code"),"article_code":r.get::<Option<String>,_>("article_code"),"article_name":r.get::<Option<String>,_>("name")})).collect();
    let missing = list_missing_for_pool(pool, Some(pool_id), 200).await?;
    let observations =
        crate::infrastructure::list_observations(pool, Some(pool_id), None, 100).await?;
    let movements = crate::infrastructure::list_movements(
        pool,
        crate::application::MovementQuery {
            pool_id: Some(pool_id.into()),
            subject_id: None,
            limit: Some(100),
        },
    )
    .await?;
    let count_rows = sqlx::query("SELECT id,kind,status,reason,created_at,activated_at,submitted_at,closed_at FROM official_count WHERE pool_id=$1 ORDER BY created_at DESC LIMIT 20")
        .bind(pool_id).fetch_all(pool).await?;
    let counts: Vec<Value> = count_rows.into_iter().map(|r| json!({"id":r.get::<Uuid,_>("id"),"kind":r.get::<String,_>("kind"),"status":r.get::<String,_>("status"),"reason":r.get::<String,_>("reason"),"created_at":r.get::<DateTime<Utc>,_>("created_at"),"activated_at":r.get::<Option<DateTime<Utc>>,_>("activated_at"),"submitted_at":r.get::<Option<DateTime<Utc>>,_>("submitted_at"),"closed_at":r.get::<Option<DateTime<Utc>>,_>("closed_at")})).collect();
    Ok(
        json!({"summary":row,"items":items,"missing":missing.get("items").cloned().unwrap_or(json!([])),"observations":observations.get("items").cloned().unwrap_or(json!([])),"movements":movements.get("items").cloned().unwrap_or(json!([])),"counts":counts}),
    )
}

pub async fn inventory_as_of(
    pool: &PgPool,
    query: AsOfQuery,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let mut result = list_pools(pool, Some(query.at), observed_hours, lost_days).await?;
    if let Some(items) = result.get_mut("items").and_then(Value::as_array_mut) {
        items.retain(|v| {
            query
                .site_id
                .as_deref()
                .map(|x| v.get("site_id").and_then(Value::as_str) == Some(x))
                .unwrap_or(true)
                && query
                    .pool_id
                    .as_deref()
                    .map(|x| v.get("id").and_then(Value::as_str) == Some(x))
                    .unwrap_or(true)
        });
    }
    Ok(result)
}

pub async fn list_missing(pool: &PgPool) -> Result<Value, AppError> {
    list_missing_for_pool(pool, None, 500).await
}

async fn list_missing_for_pool(
    pool: &PgPool,
    pool_id: Option<&str>,
    limit: i64,
) -> Result<Value, AppError> {
    let rows = sqlx::query(r#"
SELECT pr.subject_id,ip.pool_id,pr.quantity,s.subject_type,s.epc,s.barcode,sk.sku_code,op.site_id,op.label,
       first_missing.occurred_at missing_since,last_obs.last_seen_at,last_count.id latest_count_id,last_count.status latest_count_status
FROM inventory_projection pr JOIN inventory_place ip ON ip.id=pr.place_id AND ip.state='MISSING'
JOIN operational_pool op ON op.id=ip.pool_id JOIN inventory_subject s ON s.id=pr.subject_id LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN LATERAL (SELECT occurred_at FROM movement WHERE subject_id=pr.subject_id AND to_place_id=pr.place_id ORDER BY occurred_at ASC LIMIT 1) first_missing ON TRUE
LEFT JOIN LATERAL (SELECT last_seen_at FROM observation_sighting WHERE subject_id=pr.subject_id ORDER BY last_seen_at DESC LIMIT 1) last_obs ON TRUE
LEFT JOIN LATERAL (SELECT c.id,c.status FROM official_count c JOIN count_snapshot cs ON cs.count_id=c.id WHERE cs.subject_id=pr.subject_id ORDER BY c.created_at DESC LIMIT 1) last_count ON TRUE
WHERE ($1::text IS NULL OR ip.pool_id=$1) ORDER BY first_missing.occurred_at ASC NULLS FIRST LIMIT $2
"#).bind(pool_id).bind(limit).fetch_all(pool).await?;
    let now = Utc::now();
    let items: Vec<Value> = rows.into_iter().map(|r| {
        let subject_id: Uuid=r.get("subject_id"); let origin_pool: String=r.get("pool_id"); let since: Option<DateTime<Utc>>=r.get("missing_since");
        json!({"id":format!("{subject_id}@{origin_pool}"),"subject_id":subject_id,"subject_type":r.get::<String,_>("subject_type"),"epc":r.get::<Option<String>,_>("epc"),"barcode":r.get::<Option<String>,_>("barcode"),"sku_code":r.get::<Option<String>,_>("sku_code"),"quantity":r.get::<i64,_>("quantity"),"site_id":r.get::<String,_>("site_id"),"origin_pool":origin_pool,"pool_label":r.get::<String,_>("label"),"missing_since":since,"age_hours":since.map(|s|(now-s).num_hours()),"last_observation":r.get::<Option<DateTime<Utc>>,_>("last_seen_at"),"latest_count_id":r.get::<Option<Uuid>,_>("latest_count_id"),"latest_count_status":r.get::<Option<String>,_>("latest_count_status"),"status":"MISSING"})
    }).collect();
    Ok(json!({"items":items}))
}

async fn missing_quantity(pool: &PgPool, subject_id: Uuid, pool_id: &str) -> Result<i64, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN to_place_id=$2 THEN quantity WHEN from_place_id=$2 THEN -quantity ELSE 0 END),0)::bigint balance FROM movement WHERE subject_id=$1 AND (from_place_id=$2 OR to_place_id=$2)")
        .bind(subject_id).bind(format!("{pool_id}:missing")).fetch_one(pool).await?;
    let balance: i64 = row.get("balance");
    if balance <= 0 {
        return Err(AppError::NotFound("current missing inventory".into()));
    }
    Ok(balance)
}

pub async fn resolve_missing_found(
    pool: &PgPool,
    missing_id: &str,
    request: MissingResolutionRequest,
) -> Result<Value, AppError> {
    let (subject_id, origin_pool) = parse_missing_id(missing_id)?;
    let available = missing_quantity(pool, subject_id, &origin_pool).await?;
    let quantity = request.quantity.unwrap_or(available);
    let destination = request
        .destination_pool_id
        .clone()
        .unwrap_or_else(|| origin_pool.clone());
    OperationalPool::from_str(&destination).map_err(|e| AppError::Validation(e.to_string()))?;
    create_movement(
        pool,
        movement_request_for_resolution(
            request,
            subject_id,
            quantity,
            format!("{origin_pool}:missing"),
            format!("{destination}:on_hand"),
            "FOUND",
        ),
    )
    .await
}

pub async fn resolve_missing_lost(
    pool: &PgPool,
    missing_id: &str,
    request: MissingResolutionRequest,
) -> Result<Value, AppError> {
    let (subject_id, origin_pool) = parse_missing_id(missing_id)?;
    let available = missing_quantity(pool, subject_id, &origin_pool).await?;
    let quantity = request.quantity.unwrap_or(available);
    create_movement(
        pool,
        movement_request_for_resolution(
            request,
            subject_id,
            quantity,
            format!("{origin_pool}:missing"),
            "system/lost".into(),
            "CONFIRMED_LOST",
        ),
    )
    .await
}

pub async fn resolve_missing_dispose(
    pool: &PgPool,
    missing_id: &str,
    request: MissingResolutionRequest,
) -> Result<Value, AppError> {
    let (subject_id, origin_pool) = parse_missing_id(missing_id)?;
    let available = missing_quantity(pool, subject_id, &origin_pool).await?;
    let quantity = request.quantity.unwrap_or(available);
    create_movement(
        pool,
        movement_request_for_resolution(
            request,
            subject_id,
            quantity,
            format!("{origin_pool}:missing"),
            "external/disposal".into(),
            "DISPOSAL",
        ),
    )
    .await
}
