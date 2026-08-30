use super::{
    apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest,
    resolve_subject,
};
use inventory_app::{AppError, CommandRequest, CountEntriesRequest, CreateCountRequest};
use inventory_domain::{ validate_command, CountStatus, MovementCause, MovementCommand, MovementGroupId, MovementLine, OperationalPool, Place, SubjectId, SystemPlace, };
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

pub async fn create_count(pool: &PgPool, request: CreateCountRequest) -> Result<Value, AppError> {
    let typed_pool = OperationalPool::from_str(&request.pool_id)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    if typed_pool.site_id().as_str() != request.site_id {
        return Err(AppError::Validation(
            "count pool does not belong to site_id".into(),
        ));
    }
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation("count reason is required".into()));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CREATE_OFFICIAL_COUNT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let id = Uuid::new_v4();
    let kind = match request.kind {
        inventory_domain::CountKind::Full => "FULL",
        inventory_domain::CountKind::Cycle => "CYCLE",
        inventory_domain::CountKind::Targeted => "TARGETED",
    };
    let scope = json!({"sku_ids":request.sku_ids,"epcs":request.epcs});
    sqlx::query("INSERT INTO official_count(id,site_id,pool_id,kind,status,scope_json,reason,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7)")
        .bind(id).bind(&request.site_id).bind(&request.pool_id).bind(kind).bind(scope).bind(&request.reason).bind(&request.actor_id).execute(&mut *tx).await?;
    let response = json!({"id":id,"status":"DRAFT","kind":kind,"site_id":request.site_id,"pool_id":request.pool_id});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn activate_count(
    pool: &PgPool,
    count_id: Uuid,
    request: CommandRequest,
) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "ACTIVATE_OFFICIAL_COUNT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let row =
        sqlx::query("SELECT status,pool_id,scope_json FROM official_count WHERE id=$1 FOR UPDATE")
            .bind(count_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("official count".into()))?;
    let status: String = row.get("status");
    if status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "count must be DRAFT, currently {status}"
        )));
    }
    let pool_id: String = row.get("pool_id");
    let scope: Value = row.get("scope_json");
    let sku_ids: Vec<Uuid> = scope
        .get("sku_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .filter_map(|v| Uuid::parse_str(v).ok())
        .collect();
    let epcs: Vec<String> = scope
        .get("epcs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .map(str::to_ascii_uppercase)
        .collect();
    let result=sqlx::query(r#"INSERT INTO count_snapshot(count_id,subject_id,expected_quantity,expected_place_id)
WITH d AS (
 SELECT subject_id,quantity delta FROM movement WHERE to_place_id=$2||':on_hand'
 UNION ALL SELECT subject_id,-quantity FROM movement WHERE from_place_id=$2||':on_hand'
), b AS (SELECT subject_id,SUM(delta)::bigint quantity FROM d GROUP BY subject_id HAVING SUM(delta)>0)
SELECT $1,b.subject_id,b.quantity,$2||':on_hand' FROM b JOIN inventory_subject s ON s.id=b.subject_id
WHERE (cardinality($3::uuid[])=0 OR s.sku_id=ANY($3)) AND (cardinality($4::text[])=0 OR s.epc=ANY($4))"#)
        .bind(count_id).bind(&pool_id).bind(&sku_ids).bind(&epcs).execute(&mut *tx).await?;
    sqlx::query("UPDATE official_count SET status='ACTIVE',activated_at=now() WHERE id=$1")
        .bind(count_id)
        .execute(&mut *tx)
        .await?;
    let response = json!({"id":count_id,"status":"ACTIVE","expected_subjects":result.rows_affected(),"expected_snapshot_at":Utc::now()});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn add_count_entries(
    pool: &PgPool,
    count_id: Uuid,
    request: CountEntriesRequest,
) -> Result<Value, AppError> {
    if request.entries.is_empty() {
        return Err(AppError::Validation("count entries cannot be empty".into()));
    }
    if request.entries.iter().any(|e| e.found_quantity < 0) {
        return Err(AppError::Validation(
            "found quantity cannot be negative".into(),
        ));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "OFFICIAL_COUNT_ENTRIES",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let status = sqlx::query("SELECT status FROM official_count WHERE id=$1 FOR UPDATE")
        .bind(count_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("official count".into()))?
        .get::<String, _>("status");
    if status != "ACTIVE" {
        return Err(AppError::Conflict(format!(
            "count entries require ACTIVE status, currently {status}"
        )));
    }
    let mut subject_ids = Vec::new();
    for entry in &request.entries {
        let subject_id =
            resolve_subject(&mut tx, entry.subject_id, entry.epc.as_deref(), false).await?;
        sqlx::query("INSERT INTO count_entry(count_id,subject_id,found_quantity,recorded_by) VALUES($1,$2,$3,$4) ON CONFLICT(count_id,subject_id) DO UPDATE SET found_quantity=EXCLUDED.found_quantity,recorded_by=EXCLUDED.recorded_by,recorded_at=now()")
            .bind(count_id).bind(subject_id).bind(entry.found_quantity).bind(&request.actor_id).execute(&mut *tx).await?;
        subject_ids.push(subject_id);
    }
    let response = json!({"id":count_id,"status":"ACTIVE","entries_recorded":subject_ids.len(),"subject_ids":subject_ids});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn submit_count(
    pool: &PgPool,
    count_id: Uuid,
    request: CommandRequest,
) -> Result<Value, AppError> {
    transition_count(
        pool,
        count_id,
        request,
        "SUBMIT_OFFICIAL_COUNT",
        "ACTIVE",
        "REVIEW",
        "submitted_at",
    )
    .await
}

async fn transition_count(
    pool: &PgPool,
    count_id: Uuid,
    request: CommandRequest,
    command_type: &str,
    from: &str,
    to: &str,
    time_column: &str,
) -> Result<Value, AppError> {
    let from_status = parse_status(from)?;
    let to_status = parse_status(to)?;
    inventory_domain::validate_count_transition(from_status, to_status)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, command_type, &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let status = sqlx::query("SELECT status FROM official_count WHERE id=$1 FOR UPDATE")
        .bind(count_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("official count".into()))?
        .get::<String, _>("status");
    if status != from {
        return Err(AppError::Conflict(format!(
            "count must be {from}, currently {status}"
        )));
    }
    sqlx::query(&format!(
        "UPDATE official_count SET status=$2,{time_column}=now() WHERE id=$1"
    ))
    .bind(count_id)
    .bind(to)
    .execute(&mut *tx)
    .await?;
    let summary = count_comparison_tx(&mut tx, count_id).await?;
    let response = json!({"id":count_id,"status":to,"summary":summary});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn approve_count(
    pool: &PgPool,
    count_id: Uuid,
    request: CommandRequest,
) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "APPROVE_OFFICIAL_COUNT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let count =
        sqlx::query("SELECT status,pool_id,reason FROM official_count WHERE id=$1 FOR UPDATE")
            .bind(count_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("official count".into()))?;
    let status: String = count.get("status");
    if status != "REVIEW" {
        return Err(AppError::Conflict(format!(
            "count must be REVIEW, currently {status}"
        )));
    }
    let pool_id: String = count.get("pool_id");
    let reason: String = count.get("reason");
    let rows=sqlx::query(r#"SELECT COALESCE(s.subject_id,e.subject_id) subject_id,COALESCE(s.expected_quantity,0)::bigint expected,COALESCE(e.found_quantity,0)::bigint found
FROM count_snapshot s FULL OUTER JOIN count_entry e ON e.count_id=s.count_id AND e.subject_id=s.subject_id
WHERE COALESCE(s.count_id,e.count_id)=$1 ORDER BY COALESCE(s.subject_id,e.subject_id)"#).bind(count_id).fetch_all(&mut *tx).await?;
    let mut shortages = Vec::new();
    let mut gains = Vec::new();
    for row in rows {
        let subject_id: Uuid = row.get("subject_id");
        let expected: i64 = row.get("expected");
        let found: i64 = row.get("found");
        if found < expected {
            shortages.push(MovementLine {
                subject_id: SubjectId(subject_id),
                quantity: expected - found,
                from: format!("{pool_id}:on_hand")
                    .parse()
                    .map_err(|e: inventory_domain::PlaceError| AppError::Validation(e.to_string()))?,
                to: format!("{pool_id}:missing")
                    .parse()
                    .map_err(|e: inventory_domain::PlaceError| AppError::Validation(e.to_string()))?,
            })
        } else if found > expected {
            gains.push(MovementLine {
                subject_id: SubjectId(subject_id),
                quantity: found - expected,
                from: Place::System {
                    place: SystemPlace::CountGain,
                },
                to: format!("{pool_id}:on_hand")
                    .parse()
                    .map_err(|e: inventory_domain::PlaceError| AppError::Validation(e.to_string()))?,
            })
        }
    }
    let shortage_subject_ids: Vec<Uuid> = shortages.iter().map(|line| line.subject_id.0).collect();
    let mut shortage_group_id = None;
    let mut group_ids = Vec::new();
    let mut movement_count = 0;
    if !shortages.is_empty() {
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: shortages,
            cause: MovementCause::CountShortage,
            reference_type: Some("OFFICIAL_COUNT".into()),
            reference_id: Some(count_id.to_string()),
            reason: format!("Approved count shortage: {reason}"),
            actor_id: request.actor_id.clone(),
            occurred_at: Utc::now(),
        };
        validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
        let key = format!("{}:shortage", request.idempotency_key);
        insert_group(&mut tx, &command, &key, &digest).await?;
        movement_count += apply_lines(&mut tx, &command, &key, &digest).await?.len();
        shortage_group_id = Some(command.movement_group_id.0);
        group_ids.push(command.movement_group_id.0)
    }
    if !gains.is_empty() {
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: gains,
            cause: MovementCause::CountGain,
            reference_type: Some("OFFICIAL_COUNT".into()),
            reference_id: Some(count_id.to_string()),
            reason: format!("Approved count gain: {reason}"),
            actor_id: request.actor_id.clone(),
            occurred_at: Utc::now(),
        };
        validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
        let key = format!("{}:gain", request.idempotency_key);
        insert_group(&mut tx, &command, &key, &digest).await?;
        movement_count += apply_lines(&mut tx, &command, &key, &digest).await?.len();
        group_ids.push(command.movement_group_id.0)
    }
    let allotment_shortage_event_count = super::allotments::record_allotment_shortages_for_count(
        &mut tx,
        count_id,
        shortage_group_id,
        &pool_id,
        &shortage_subject_ids,
        &request.actor_id,
    )
    .await?;
    sqlx::query("UPDATE official_count SET status='CLOSED',closed_at=now(),approval_movement_group_id=$2 WHERE id=$1").bind(count_id).bind(group_ids.first().copied()).execute(&mut *tx).await?;
    let summary = count_comparison_tx(&mut tx, count_id).await?;
    let response = json!({"id":count_id,"status":"CLOSED","movement_group_ids":group_ids,"movement_count":movement_count,"allotment_shortage_event_count":allotment_shortage_event_count,"summary":summary});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

async fn count_comparison_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    count_id: Uuid,
) -> Result<Value, AppError> {
    let row=sqlx::query(r#"SELECT COALESCE(SUM(expected),0)::bigint expected,COALESCE(SUM(found),0)::bigint found,
COUNT(*) FILTER(WHERE found=expected)::bigint matches,COUNT(*) FILTER(WHERE found<expected)::bigint shortages,COUNT(*) FILTER(WHERE found>expected)::bigint gains
FROM (SELECT COALESCE(s.expected_quantity,0)::bigint expected,COALESCE(e.found_quantity,0)::bigint found FROM count_snapshot s FULL OUTER JOIN count_entry e ON e.count_id=s.count_id AND e.subject_id=s.subject_id WHERE COALESCE(s.count_id,e.count_id)=$1) x"#).bind(count_id).fetch_one(&mut **tx).await?;
    Ok(
        json!({"expected":row.get::<i64,_>("expected"),"found":row.get::<i64,_>("found"),"match_subjects":row.get::<i64,_>("matches"),"shortage_subjects":row.get::<i64,_>("shortages"),"gain_subjects":row.get::<i64,_>("gains")}),
    )
}

pub async fn list_counts(pool: &PgPool) -> Result<Value, AppError> {
    let rows=sqlx::query("SELECT c.id,c.site_id,c.pool_id,c.kind,c.status,c.reason,c.created_by,c.created_at,c.activated_at,c.submitted_at,c.closed_at,(SELECT COALESCE(SUM(expected_quantity),0)::bigint FROM count_snapshot WHERE count_id=c.id) expected,(SELECT COALESCE(SUM(found_quantity),0)::bigint FROM count_entry WHERE count_id=c.id) found FROM official_count c ORDER BY c.created_at DESC LIMIT 200").fetch_all(pool).await?;
    let items:Vec<Value>=rows.into_iter().map(|r|json!({"id":r.get::<Uuid,_>("id"),"site_id":r.get::<String,_>("site_id"),"pool_id":r.get::<String,_>("pool_id"),"kind":r.get::<String,_>("kind"),"status":r.get::<String,_>("status"),"reason":r.get::<String,_>("reason"),"created_by":r.get::<String,_>("created_by"),"created_at":r.get::<DateTime<Utc>,_>("created_at"),"activated_at":r.get::<Option<DateTime<Utc>>,_>("activated_at"),"submitted_at":r.get::<Option<DateTime<Utc>>,_>("submitted_at"),"closed_at":r.get::<Option<DateTime<Utc>>,_>("closed_at"),"expected":r.get::<i64,_>("expected"),"found":r.get::<i64,_>("found")})).collect();
    Ok(
        json!({"active":items.iter().filter(|v|v["status"]=="ACTIVE").cloned().collect::<Vec<_>>(),"needs_review":items.iter().filter(|v|v["status"]=="REVIEW").cloned().collect::<Vec<_>>(),"history":items.iter().filter(|v|v["status"]=="CLOSED").cloned().collect::<Vec<_>>(),"drafts":items.iter().filter(|v|v["status"]=="DRAFT").cloned().collect::<Vec<_>>()}),
    )
}

fn parse_status(value: &str) -> Result<CountStatus, AppError> {
    match value {
        "DRAFT" => Ok(CountStatus::Draft),
        "ACTIVE" => Ok(CountStatus::Active),
        "REVIEW" => Ok(CountStatus::Review),
        "CLOSED" => Ok(CountStatus::Closed),
        _ => Err(AppError::Conflict("unknown count status".into())),
    }
}
