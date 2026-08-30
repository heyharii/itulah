use super::{create_movement, movement_request_for_resolution, parse_missing_id};
use retail_app::{AppError, AsOfQuery, MissingResolutionRequest};
use retail_domain::InventoryBalance;
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
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
    SELECT place.pool_id,place.state,movement.quantity delta
    FROM movement JOIN inventory_place place ON place.id=movement.to_place_id
    WHERE place.kind='OPERATIONAL' AND movement.occurred_at <= $1
    UNION ALL
    SELECT place.pool_id,place.state,-movement.quantity delta
    FROM movement JOIN inventory_place place ON place.id=movement.from_place_id
    WHERE place.kind='OPERATIONAL' AND movement.occurred_at <= $1
), balances AS (
    SELECT pool_id,state,SUM(delta)::bigint quantity
    FROM ledger_deltas
    GROUP BY pool_id,state
), observed_raw AS (
    SELECT pool_id,COUNT(DISTINCT COALESCE(subject_id::text,epc))::bigint quantity
    FROM observation_sighting
    WHERE last_seen_at > $1-($2::text||' hours')::interval AND last_seen_at <= $1
    GROUP BY pool_id
), opening_raw AS (
    SELECT pool.id pool_id,COALESCE(SUM(CASE WHEN movement.to_place_id=pool.id||':on_hand' THEN movement.quantity WHEN movement.from_place_id=pool.id||':on_hand' THEN -movement.quantity ELSE 0 END),0)::bigint quantity
    FROM operational_pool pool LEFT JOIN movement ON movement.occurred_at < $1-($3::text||' days')::interval AND (movement.to_place_id=pool.id||':on_hand' OR movement.from_place_id=pool.id||':on_hand')
    GROUP BY pool.id
), inbound_raw AS (
    SELECT pool.id pool_id,COALESCE(SUM(movement.quantity),0)::bigint quantity
    FROM operational_pool pool LEFT JOIN movement ON movement.to_place_id=pool.id||':on_hand' AND movement.occurred_at >= $1-($3::text||' days')::interval AND movement.occurred_at <= $1
    GROUP BY pool.id
), lost_raw AS (
    SELECT pool.id pool_id,COALESCE(SUM(movement.quantity),0)::bigint quantity
    FROM operational_pool pool LEFT JOIN movement ON movement.from_place_id=pool.id||':missing' AND movement.to_place_id='system/lost' AND movement.occurred_at >= $1-($3::text||' days')::interval AND movement.occurred_at <= $1
    GROUP BY pool.id
), pool_scope AS (
    SELECT output.id output_pool_id,component.id component_pool_id
    FROM operational_pool output
    JOIN operational_pool component ON
        (output.is_placement AND component.id=output.id)
        OR (
            NOT output.is_placement
            AND output.outbound_stage IS NOT NULL
            AND (component.id=output.id OR (component.is_placement AND component.outbound_stage=output.outbound_stage))
        )
), balance_rollup AS (
    SELECT scope.output_pool_id,balance.state,COALESCE(SUM(balance.quantity),0)::bigint quantity
    FROM pool_scope scope LEFT JOIN balances balance ON balance.pool_id=scope.component_pool_id
    GROUP BY scope.output_pool_id,balance.state
), observed_rollup AS (
    SELECT scope.output_pool_id,COALESCE(SUM(observed.quantity),0)::bigint quantity
    FROM pool_scope scope LEFT JOIN observed_raw observed ON observed.pool_id=scope.component_pool_id
    GROUP BY scope.output_pool_id
), risk_rollup AS (
    SELECT scope.output_pool_id,
           COALESCE(SUM(opening.quantity),0)::bigint opening,
           COALESCE(SUM(inbound.quantity),0)::bigint inbound,
           COALESCE(SUM(lost.quantity),0)::bigint lost
    FROM pool_scope scope
    LEFT JOIN opening_raw opening ON opening.pool_id=scope.component_pool_id
    LEFT JOIN inbound_raw inbound ON inbound.pool_id=scope.component_pool_id
    LEFT JOIN lost_raw lost ON lost.pool_id=scope.component_pool_id
    GROUP BY scope.output_pool_id
), allotted_balance AS (
    SELECT COALESCE(event.source_pool_id,line.source_pool_id) source_pool_id,
           COALESCE(SUM(event.remaining_delta),0)::bigint quantity
    FROM allotment_event event LEFT JOIN allotment_line line ON line.id=event.allotment_line_id
    WHERE event.occurred_at <= $1
    GROUP BY COALESCE(event.source_pool_id,line.source_pool_id)
)
SELECT pool.id,pool.site_id,site.name site_name,site.kind site_kind,pool.group_code,pool.pool_code,pool.label,
       pool.store_origin_site_id,pool.display_order,pool.is_placement,pool.outbound_stage,pool.destination_store_id,
       COALESCE(normal.quantity,0)::bigint normal,
       COALESCE(missing.quantity,0)::bigint missing,
       COALESCE(observed.quantity,0)::bigint observed,
       CASE WHEN pool.is_placement AND (pool.id IN ('dc.warehouse','dc.reject.dc') OR pool.site_id<>'dc')
            THEN COALESCE(allotted.quantity,0) ELSE NULL END::bigint allotted,
       risk.lost::bigint lost_quantity,
       CASE WHEN GREATEST(risk.opening,0)+risk.inbound > 0
            THEN ROUND(risk.lost::numeric/(GREATEST(risk.opening,0)+risk.inbound)::numeric,6)
            ELSE 0 END::text lost_rate,
       (GREATEST(risk.opening,0)+risk.inbound)::bigint exposure
FROM operational_pool pool JOIN site ON site.id=pool.site_id
LEFT JOIN balance_rollup normal ON normal.output_pool_id=pool.id AND normal.state='NORMAL'
LEFT JOIN balance_rollup missing ON missing.output_pool_id=pool.id AND missing.state='MISSING'
LEFT JOIN observed_rollup observed ON observed.output_pool_id=pool.id
LEFT JOIN risk_rollup risk ON risk.output_pool_id=pool.id
LEFT JOIN allotted_balance allotted ON allotted.source_pool_id=pool.id
WHERE pool.active
ORDER BY CASE WHEN pool.site_id='dc' THEN 0 ELSE 1 END,pool.site_id,pool.display_order,pool.is_placement,pool.destination_store_id NULLS FIRST,pool.id
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
            let is_placement = row.get::<bool, _>("is_placement");
            let outbound_stage = row.get::<Option<String>, _>("outbound_stage");
            Ok(json!({
                "id":row.get::<String,_>("id"),"site_id":row.get::<String,_>("site_id"),"site_name":row.get::<String,_>("site_name"),"site_kind":row.get::<String,_>("site_kind"),
                "group":row.get::<String,_>("group_code"),"pool_code":row.get::<String,_>("pool_code"),"label":row.get::<String,_>("label"),
                "store_origin_site_id":row.get::<Option<String>,_>("store_origin_site_id"),"display_order":row.get::<i32,_>("display_order"),
                "is_rollup":!is_placement,"is_outbound_leaf":is_placement&&outbound_stage.is_some(),"outbound_stage":outbound_stage,
                "destination_store_id":row.get::<Option<String>,_>("destination_store_id"),
                "stock":balance.stock.value(),"allotted":balance.allotted.map(|quantity| quantity.value()),"on_hand":balance.on_hand.value(),
                "missing":balance.missing.value(),"observed":balance.observed.value(),
                "lost_rate":row.get::<String,_>("lost_rate").parse::<f64>().unwrap_or(0.0),"lost_quantity":row.get::<i64,_>("lost_quantity"),"exposure":row.get::<i64,_>("exposure")
            }))
        })
        .collect::<Result<Vec<Value>, AppError>>()?;
    Ok(json!({
        "as_of":at,"read_only":at<Utc::now()-chrono::Duration::seconds(2),"observed_window_hours":observed_hours,"lost_risk_window_days":lost_days,
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "outbound_rollup_equation":"Stage total = sum of destination Store leaf pools",
        "lost_risk_formula":"confirmed Lost from pool during window / (opening operational balance + inbound movements during window)","items":items
    }))
}

pub async fn get_pool(
    pool: &PgPool,
    pool_id: &str,
    observed_hours: i64,
    lost_days: i64,
) -> Result<Value, AppError> {
    let exists = sqlx::query("SELECT 1 FROM operational_pool WHERE id=$1 AND active")
        .bind(pool_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("operational pool".into()));
    }
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
        crate::list_observations(pool, Some(pool_id), None, 100).await?;
    let movements = crate::list_movements(
        pool,
        retail_app::MovementQuery {
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
