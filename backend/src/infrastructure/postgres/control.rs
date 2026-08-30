use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::application::{
    AppError, CorruptProjectionRequest, ReplayRequest, ReplayScope, RepostRequest,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

async fn replay_differences<'e, E>(executor: E, scope: &ReplayScope) -> Result<Vec<Value>, AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let rows=sqlx::query(r#"WITH d AS (
 SELECT subject_id,to_place_id place_id,quantity delta FROM movement
 UNION ALL SELECT subject_id,from_place_id,-quantity FROM movement
), ledger AS (
 SELECT subject_id,place_id,SUM(delta)::bigint quantity FROM d GROUP BY subject_id,place_id HAVING SUM(delta)>0
), compared AS (
 SELECT COALESCE(l.subject_id,p.subject_id) subject_id,COALESCE(l.place_id,p.place_id) place_id,COALESCE(l.quantity,0)::bigint ledger_quantity,COALESCE(p.quantity,0)::bigint projection_quantity
 FROM ledger l FULL OUTER JOIN inventory_projection p ON p.subject_id=l.subject_id AND p.place_id=l.place_id
)
SELECT c.subject_id,c.place_id,c.ledger_quantity,c.projection_quantity,(c.ledger_quantity-c.projection_quantity)::bigint difference
FROM compared c JOIN inventory_place ip ON ip.id=c.place_id LEFT JOIN operational_pool op ON op.id=ip.pool_id
WHERE ip.kind='OPERATIONAL' AND c.ledger_quantity<>c.projection_quantity
AND ($1::uuid IS NULL OR c.subject_id=$1) AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND NOT scope.is_placement AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage)) AND ($3::text IS NULL OR op.site_id=$3)
ORDER BY c.place_id,c.subject_id LIMIT 1000"#)
        .bind(scope.subject_id).bind(&scope.pool_id).bind(&scope.site_id).fetch_all(executor).await?;
    Ok(rows.into_iter().map(|r|json!({"subject_id":r.get::<Uuid,_>("subject_id"),"place_id":r.get::<String,_>("place_id"),"ledger_quantity":r.get::<i64,_>("ledger_quantity"),"projection_quantity":r.get::<i64,_>("projection_quantity"),"difference":r.get::<i64,_>("difference")})).collect())
}

async fn outbound_stage_rollup_differences<'e, E>(
    executor: E,
    scope: &ReplayScope,
) -> Result<Vec<Value>, AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let rows = sqlx::query(r#"
WITH parents AS (
    SELECT parent.id,parent.outbound_stage,parent.site_id
    FROM operational_pool parent
    WHERE parent.active AND NOT parent.is_placement AND parent.outbound_stage IS NOT NULL
      AND ($1::text IS NULL OR parent.id=$1 OR EXISTS (
          SELECT 1 FROM operational_pool selected
          WHERE selected.id=$1 AND selected.is_placement
            AND selected.outbound_stage=parent.outbound_stage
      ))
      AND ($2::text IS NULL OR parent.site_id=$2)
), components AS (
    SELECT parent.id parent_pool_id,component.id component_pool_id
    FROM parents parent
    JOIN operational_pool component ON component.id=parent.id
      OR (component.is_placement AND component.outbound_stage=parent.outbound_stage)
), ledger_delta AS (
    SELECT component.parent_pool_id,place.state,movement.quantity delta
    FROM movement
    JOIN inventory_place place ON place.id=movement.to_place_id
    JOIN components component ON component.component_pool_id=place.pool_id
    WHERE ($3::uuid IS NULL OR movement.subject_id=$3)
    UNION ALL
    SELECT component.parent_pool_id,place.state,-movement.quantity delta
    FROM movement
    JOIN inventory_place place ON place.id=movement.from_place_id
    JOIN components component ON component.component_pool_id=place.pool_id
    WHERE ($3::uuid IS NULL OR movement.subject_id=$3)
), ledger AS (
    SELECT parent_pool_id,state,COALESCE(SUM(delta),0)::bigint quantity
    FROM ledger_delta GROUP BY parent_pool_id,state
), projection AS (
    SELECT component.parent_pool_id,place.state,COALESCE(SUM(projected.quantity),0)::bigint quantity
    FROM inventory_projection projected
    JOIN inventory_place place ON place.id=projected.place_id
    JOIN components component ON component.component_pool_id=place.pool_id
    WHERE ($3::uuid IS NULL OR projected.subject_id=$3)
    GROUP BY component.parent_pool_id,place.state
), compared AS (
    SELECT COALESCE(ledger.parent_pool_id,projection.parent_pool_id) parent_pool_id,
           COALESCE(ledger.state,projection.state) state,
           COALESCE(ledger.quantity,0)::bigint ledger_quantity,
           COALESCE(projection.quantity,0)::bigint projection_quantity
    FROM ledger FULL OUTER JOIN projection
      ON projection.parent_pool_id=ledger.parent_pool_id AND projection.state=ledger.state
)
SELECT parent_pool_id,state,ledger_quantity,projection_quantity,
       (ledger_quantity-projection_quantity)::bigint difference
FROM compared WHERE ledger_quantity<>projection_quantity
ORDER BY parent_pool_id,state
"#)
        .bind(&scope.pool_id)
        .bind(&scope.site_id)
        .bind(scope.subject_id)
        .fetch_all(executor)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| json!({
            "parent_pool_id":row.get::<String,_>("parent_pool_id"),
            "state":row.get::<String,_>("state"),
            "ledger_quantity":row.get::<i64,_>("ledger_quantity"),
            "projection_quantity":row.get::<i64,_>("projection_quantity"),
            "difference":row.get::<i64,_>("difference")
        }))
        .collect())
}

pub async fn run_replay(pool: &PgPool, request: ReplayRequest) -> Result<Value, AppError> {
    let differences = replay_differences(pool, &request.scope).await?;
    let outbound_rollup_differences =
        outbound_stage_rollup_differences(pool, &request.scope).await?;
    let fact_count = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(pool)
        .await?
        .get::<i64, _>("count");
    let difference_count = differences.len() + outbound_rollup_differences.len();
    let status = if difference_count == 0 {
        "MATCH"
    } else {
        "DIFFERENCE"
    };
    let run_id = Uuid::new_v4();
    let result = json!({
        "run_id":run_id,
        "status":status,
        "scope":request.scope,
        "ledger_fact_count":fact_count,
        "difference_count":difference_count,
        "differences":differences,
        "outbound_rollup_status":if outbound_rollup_differences.is_empty(){"MATCH"}else{"DIFFERENCE"},
        "outbound_rollup_difference_count":outbound_rollup_differences.len(),
        "outbound_rollup_differences":outbound_rollup_differences,
        "read_only":true,
        "ran_at":Utc::now()
    });
    sqlx::query("INSERT INTO replay_run(id,scope_json,status,ledger_fact_count,difference_count,result_json,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(run_id).bind(serde_json::to_value(&request.scope)?).bind(status).bind(fact_count).bind(difference_count as i64).bind(&result).bind(&request.actor_id).execute(pool).await?;
    Ok(result)
}

pub async fn run_repost(pool: &PgPool, request: RepostRequest) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "REPOST_PROJECTION",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(78236491)")
        .execute(&mut *tx)
        .await?;
    let before = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    let differences_before = replay_differences(&mut *tx, &request.scope).await?;
    let outbound_rollup_differences_before =
        outbound_stage_rollup_differences(&mut *tx, &request.scope).await?;
    sqlx::query("DELETE FROM inventory_projection p USING inventory_place ip LEFT JOIN operational_pool op ON op.id=ip.pool_id WHERE p.place_id=ip.id AND ip.kind='OPERATIONAL' AND ($1::uuid IS NULL OR p.subject_id=$1) AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND NOT scope.is_placement AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage)) AND ($3::text IS NULL OR op.site_id=$3)")
        .bind(request.scope.subject_id).bind(&request.scope.pool_id).bind(&request.scope.site_id).execute(&mut *tx).await?;
    let inserted=sqlx::query(r#"INSERT INTO inventory_projection(subject_id,place_id,quantity,last_fact_sequence,updated_at)
WITH d AS (
 SELECT subject_id,to_place_id place_id,quantity delta,fact_sequence FROM movement
 UNION ALL SELECT subject_id,from_place_id,-quantity,fact_sequence FROM movement
), b AS (
 SELECT subject_id,place_id,SUM(delta)::bigint quantity,MAX(fact_sequence)::bigint seq FROM d GROUP BY subject_id,place_id HAVING SUM(delta)>0
)
SELECT b.subject_id,b.place_id,b.quantity,b.seq,now() FROM b JOIN inventory_place ip ON ip.id=b.place_id LEFT JOIN operational_pool op ON op.id=ip.pool_id
WHERE ip.kind='OPERATIONAL' AND ($1::uuid IS NULL OR b.subject_id=$1) AND ($2::text IS NULL OR op.id=$2 OR EXISTS (SELECT 1 FROM operational_pool scope WHERE scope.id=$2 AND NOT scope.is_placement AND scope.outbound_stage IS NOT NULL AND op.is_placement AND op.outbound_stage=scope.outbound_stage)) AND ($3::text IS NULL OR op.site_id=$3)
ON CONFLICT(subject_id,place_id) DO UPDATE SET quantity=EXCLUDED.quantity,last_fact_sequence=EXCLUDED.last_fact_sequence,updated_at=now()"#)
        .bind(request.scope.subject_id).bind(&request.scope.pool_id).bind(&request.scope.site_id).execute(&mut *tx).await?.rows_affected();
    let after = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    if before != after {
        return Err(AppError::Conflict(
            "ledger changed during repost; transaction aborted".into(),
        ));
    }
    let differences_after = replay_differences(&mut *tx, &request.scope).await?;
    let outbound_rollup_differences_after =
        outbound_stage_rollup_differences(&mut *tx, &request.scope).await?;
    if !differences_after.is_empty() || !outbound_rollup_differences_after.is_empty() {
        return Err(AppError::Conflict(
            "repost failed to reproduce ledger projection and outbound stage rollups".into(),
        ));
    }
    let run_id = Uuid::new_v4();
    sqlx::query("INSERT INTO repost_run(id,scope_json,ledger_fact_count_before,ledger_fact_count_after,projection_rows,actor_id) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(run_id).bind(serde_json::to_value(&request.scope)?).bind(before).bind(after).bind(inserted as i64).bind(&request.actor_id).execute(&mut *tx).await?;
    let response = json!({
        "run_id":run_id,
        "status":"REPAIRED",
        "scope":request.scope,
        "differences_before":differences_before.len(),
        "differences_after":0,
        "outbound_rollup_status":"MATCH",
        "outbound_rollup_differences_before":outbound_rollup_differences_before.len(),
        "outbound_rollup_differences_after":0,
        "projection_rows_rebuilt":inserted,
        "ledger_fact_count_before":before,
        "ledger_fact_count_after":after,
        "ledger_facts_created":0
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn control_status(pool: &PgPool) -> Result<Value, AppError> {
    let fact_count = sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(pool)
        .await?
        .get::<i64, _>("count");
    let differences = replay_differences(pool, &ReplayScope::default()).await?;
    let replay = sqlx::query(
        "SELECT id,status,difference_count,ran_at FROM replay_run ORDER BY ran_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let repost = sqlx::query(
        "SELECT id,projection_rows,ran_at FROM repost_run ORDER BY ran_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    let last_replay=replay.map(|r|json!({"id":r.get::<Uuid,_>("id"),"status":r.get::<String,_>("status"),"difference_count":r.get::<i64,_>("difference_count"),"ran_at":r.get::<DateTime<Utc>,_>("ran_at")}));
    let last_repost=repost.map(|r|json!({"id":r.get::<Uuid,_>("id"),"projection_rows":r.get::<i64,_>("projection_rows"),"ran_at":r.get::<DateTime<Utc>,_>("ran_at")}));
    Ok(
        json!({"ledger_fact_count":fact_count,"projection_difference_count":differences.len(),"ledger_health":if differences.is_empty(){"HEALTHY"}else{"DIFFERENCE"},"last_replay":last_replay,"last_repost":last_repost,"differences":differences}),
    )
}

pub async fn corrupt_projection_for_test(
    pool: &PgPool,
    request: CorruptProjectionRequest,
    enabled: bool,
) -> Result<Value, AppError> {
    if !enabled {
        return Err(AppError::Forbidden("test controls are disabled; set INVENTORY_ENABLE_TEST_CONTROLS=true only in a disposable environment".into()));
    }
    let row=sqlx::query("UPDATE inventory_projection SET quantity=quantity+$3,updated_at=now() WHERE subject_id=$1 AND place_id=$2 RETURNING quantity")
        .bind(request.subject_id).bind(&request.place_id).bind(request.delta).fetch_optional(pool).await?.ok_or_else(||AppError::NotFound("projection row".into()))?;
    Ok(
        json!({"warning":"TEST-ONLY projection corruption applied","subject_id":request.subject_id,"place_id":request.place_id,"new_projection_quantity":row.get::<i64,_>("quantity"),"ledger_changed":false}),
    )
}
