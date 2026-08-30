use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use crate::{
    application::{
        AllotmentQuery, AppError, AvailabilityQuery, CancelAllotmentRequest,
        CreateAllotmentRequest, ExecuteAllotmentRequest,
    },
    domain::{
        derive_allotment_status, AllotmentType, DestinationType, InventoryState, MovementCause,
        MovementCommand, MovementGroupId, MovementLine, OperationalPool, Place, SiteId, SubjectId,
    },
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{collections::HashSet, str::FromStr};
use uuid::Uuid;

const DEFAULT_SOURCE_POOL_ID: &str = "dc.warehouse";

#[derive(Clone, Debug)]
struct LineIdentity {
    source_site_id: String,
    source_pool_id: String,
    destination_type: DestinationType,
    destination_id: String,
    sku_id: Uuid,
}

#[derive(Clone, Debug)]
struct NormalizedLine {
    identity: LineIdentity,
    quantity: i64,
}

pub async fn create_allotment(
    pool: &PgPool,
    request: CreateAllotmentRequest,
) -> Result<Value, AppError> {
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "allotment must contain at least one line".into(),
        ));
    }

    let mut lines = Vec::with_capacity(request.lines.len());
    let mut identities = HashSet::new();
    for line in &request.lines {
        if line.quantity <= 0 {
            return Err(AppError::Validation(
                "allotment line quantity must be positive".into(),
            ));
        }
        let source_site_id = line.source_site_id.trim().to_ascii_lowercase();
        let source_pool_id = line.source_pool_id.trim().to_ascii_lowercase();
        let destination_id = line.destination_id.trim().to_ascii_lowercase();
        if source_site_id.is_empty() || source_pool_id.is_empty() || destination_id.is_empty() {
            return Err(AppError::Validation(
                "line source and destination identifiers are required".into(),
            ));
        }
        let identity_key = (
            source_pool_id.clone(),
            line.destination_type,
            destination_id.clone(),
            line.sku_id,
        );
        if !identities.insert(identity_key) {
            return Err(AppError::Validation(
                "duplicate allotment line identity".into(),
            ));
        }
        lines.push(NormalizedLine {
            identity: LineIdentity {
                source_site_id,
                source_pool_id,
                destination_type: line.destination_type,
                destination_id,
                sku_id: line.sku_id,
            },
            quantity: line.quantity,
        });
    }
    lines.sort_by(|left, right| {
        left.identity
            .sku_id
            .cmp(&right.identity.sku_id)
            .then_with(|| {
                left.identity
                    .source_pool_id
                    .cmp(&right.identity.source_pool_id)
            })
            .then_with(|| {
                left.identity
                    .destination_type
                    .as_str()
                    .cmp(right.identity.destination_type.as_str())
            })
            .then_with(|| {
                left.identity
                    .destination_id
                    .cmp(&right.identity.destination_id)
            })
    });

    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CREATE_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    for line in &lines {
        validate_create_line(&mut tx, request.allotment_type, line).await?;
    }
    let mut sku_ids: Vec<Uuid> = lines.iter().map(|line| line.identity.sku_id).collect();
    sku_ids.sort_unstable();
    sku_ids.dedup();
    lock_active_skus(&mut tx, &sku_ids).await?;

    let allotment_id = Uuid::new_v4();
    let sequence = sqlx::query("SELECT nextval('allotment_number_sequence')::bigint sequence")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("sequence");
    let allotment_number = format!("ALT-{sequence:08}");
    let now = Utc::now();
    sqlx::query("INSERT INTO allotment(id,allotment_number,type,status,created_by,notes,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$7)")
        .bind(allotment_id)
        .bind(&allotment_number)
        .bind(request.allotment_type.as_str())
        .bind(request.actor_id.trim())
        .bind(request.notes.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(&request.idempotency_key)
        .bind(now)
        .execute(&mut *tx)
        .await?;

    let mut response_lines = Vec::with_capacity(lines.len());
    for line in lines {
        let normal_quantity =
            normal_balance_tx(&mut tx, &line.identity.source_pool_id, line.identity.sku_id).await?;
        let allotted_quantity =
            active_allotment_tx(&mut tx, &line.identity.source_pool_id, line.identity.sku_id)
                .await?;
        let on_hand_quantity = normal_quantity - allotted_quantity;
        if line.quantity > on_hand_quantity {
            return Err(AppError::Conflict(format!(
                "cannot allot SKU {} from {}: on-hand quantity {on_hand_quantity}, requested {}",
                line.identity.sku_id, line.identity.source_pool_id, line.quantity
            )));
        }

        let line_id = Uuid::new_v4();
        sqlx::query("INSERT INTO allotment_line(id,allotment_id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(line_id)
            .bind(allotment_id)
            .bind(&line.identity.source_site_id)
            .bind(&line.identity.source_pool_id)
            .bind(line.identity.destination_type.as_str())
            .bind(&line.identity.destination_id)
            .bind(line.identity.sku_id)
            .bind(line.quantity)
            .execute(&mut *tx)
            .await?;
        insert_allotment_event(
            &mut tx,
            &format!("{}:created:{line_id}", request.idempotency_key),
            Some(allotment_id),
            Some(line_id),
            "ALLOTMENT_CREATED",
            Some(&line.identity),
            line.quantity,
            line.quantity,
            None,
            None,
            None,
            request.actor_id.trim(),
            json!({
                "normal_qty": normal_quantity,
                "allotted_qty_before": allotted_quantity,
                "on_hand_qty_before": on_hand_quantity,
                "on_hand_qty_after": on_hand_quantity - line.quantity
            }),
            now,
        )
        .await?;
        response_lines.push(json!({
            "id":line_id,
            "source_site_id":line.identity.source_site_id,
            "source_pool_id":line.identity.source_pool_id,
            "destination_type":line.identity.destination_type.as_str(),
            "destination_id":line.identity.destination_id,
            "sku_id":line.identity.sku_id,
            "quantity":line.quantity,
            "executed_quantity":0,
            "cancelled_quantity":0,
            "remaining_quantity":line.quantity,
            "on_hand_qty_before":on_hand_quantity,
            "on_hand_qty_after":on_hand_quantity-line.quantity
        }));
    }

    let total_quantity: i64 = response_lines
        .iter()
        .filter_map(|line| line["quantity"].as_i64())
        .sum();
    let response = json!({
        "id":allotment_id,
        "allotment_number":allotment_number,
        "type":request.allotment_type.as_str(),
        "status":"ACTIVE",
        "total_quantity":total_quantity,
        "total_executed_quantity":0,
        "total_cancelled_quantity":0,
        "remaining_quantity":total_quantity,
        "created_by":request.actor_id.trim(),
        "notes":request.notes,
        "created_at":now,
        "lines":response_lines,
        "inventory_effect":{"movement_count":0,"ledger_changed":false}
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn cancel_allotment(
    pool: &PgPool,
    allotment_id: Uuid,
    request: CancelAllotmentRequest,
) -> Result<Value, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "cancellation reason is required".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CANCEL_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let header = lock_open_allotment(&mut tx, allotment_id).await?;
    let lines = sqlx::query("SELECT id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity,executed_quantity,cancelled_quantity FROM allotment_line WHERE allotment_id=$1 ORDER BY sku_id,source_pool_id,destination_type,destination_id FOR UPDATE")
        .bind(allotment_id)
        .fetch_all(&mut *tx)
        .await?;
    let now = Utc::now();
    let mut cancelled_total = 0_i64;
    for line in lines {
        let line_id: Uuid = line.get("id");
        let identity = line_identity_from_row(&line)?;
        let remaining = line.get::<i64, _>("quantity")
            - line.get::<i64, _>("executed_quantity")
            - line.get::<i64, _>("cancelled_quantity");
        if remaining <= 0 {
            continue;
        }
        sqlx::query("UPDATE allotment_line SET cancelled_quantity=cancelled_quantity+$2,updated_at=$3 WHERE id=$1")
            .bind(line_id)
            .bind(remaining)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        insert_allotment_event(
            &mut tx,
            &format!("{}:cancelled:{line_id}", request.idempotency_key),
            Some(allotment_id),
            Some(line_id),
            "ALLOTMENT_CANCELLED",
            Some(&identity),
            remaining,
            -remaining,
            None,
            None,
            None,
            request.actor_id.trim(),
            json!({"reason":request.reason}),
            now,
        )
        .await?;
        cancelled_total += remaining;
    }
    if cancelled_total == 0 {
        return Err(AppError::Conflict(
            "allotment has no remaining quantity to cancel".into(),
        ));
    }
    sqlx::query(
        "UPDATE allotment SET status='CANCELLED',cancelled_at=$2,updated_at=$2 WHERE id=$1",
    )
    .bind(allotment_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let response = json!({
        "id":allotment_id,
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":header.get::<String,_>("type"),
        "status":"CANCELLED",
        "cancelled_quantity":cancelled_total,
        "remaining_quantity":0,
        "cancelled_at":now,
        "inventory_effect":{"movement_count":0,"ledger_changed":false}
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn execute_allotment(
    pool: &PgPool,
    allotment_id: Uuid,
    request: ExecuteAllotmentRequest,
) -> Result<Value, AppError> {
    if request.quantity <= 0 {
        return Err(AppError::Validation(
            "execution quantity must be positive".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "EXECUTE_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let header = lock_open_allotment(&mut tx, allotment_id).await?;
    let line = sqlx::query("SELECT id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity,executed_quantity,cancelled_quantity FROM allotment_line WHERE id=$1 AND allotment_id=$2 FOR UPDATE")
        .bind(request.allotment_line_id)
        .bind(allotment_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment line belonging to header".into()))?;
    let identity = line_identity_from_row(&line)?;
    lock_active_skus(&mut tx, &[identity.sku_id]).await?;

    let quantity: i64 = line.get("quantity");
    let executed_quantity: i64 = line.get("executed_quantity");
    let cancelled_quantity: i64 = line.get("cancelled_quantity");
    let remaining = quantity - executed_quantity - cancelled_quantity;
    if request.quantity > remaining {
        return Err(AppError::Conflict(format!(
            "cannot execute more than remaining allotment quantity: remaining {remaining}, requested {}",
            request.quantity
        )));
    }

    let allotment_type = AllotmentType::from_str(&header.get::<String, _>("type"))
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    let (cause, destination_place_id) = execution_transition(allotment_type, &identity)?;
    let source_place_id = format!("{}:on_hand", identity.source_pool_id);
    let movement_lines = allocate_source_subjects(
        &mut tx,
        identity.sku_id,
        request.quantity,
        &source_place_id,
        &destination_place_id,
    )
    .await?;
    let movement_group_id = MovementGroupId::new();
    let now = Utc::now();
    let movement = MovementCommand {
        movement_group_id,
        lines: movement_lines,
        cause,
        reference_type: Some("ALLOTMENT_LINE".into()),
        reference_id: Some(request.allotment_line_id.to_string()),
        reason: format!(
            "Execute {} units for {} line {}",
            request.quantity,
            header.get::<String, _>("allotment_number"),
            request.allotment_line_id
        ),
        actor_id: request.actor_id.trim().into(),
        occurred_at: now,
    };
    crate::domain::validate_command(&movement)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let movement_key = format!("{}:inventory", request.idempotency_key);
    insert_group(&mut tx, &movement, &movement_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &movement, &movement_key, &digest).await?;

    sqlx::query("UPDATE allotment_line SET executed_quantity=executed_quantity+$2,updated_at=$3 WHERE id=$1")
        .bind(request.allotment_line_id)
        .bind(request.quantity)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    let totals = allotment_totals_tx(&mut tx, allotment_id).await?;
    let status = derive_allotment_status(totals.quantity, totals.executed, totals.cancelled)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    sqlx::query("UPDATE allotment SET status=$2,updated_at=$3 WHERE id=$1")
        .bind(allotment_id)
        .bind(status.as_str())
        .bind(now)
        .execute(&mut *tx)
        .await?;
    insert_allotment_event(
        &mut tx,
        &format!(
            "{}:executed:{}",
            request.idempotency_key, request.allotment_line_id
        ),
        Some(allotment_id),
        Some(request.allotment_line_id),
        "ALLOTMENT_EXECUTED",
        Some(&identity),
        request.quantity,
        -request.quantity,
        Some(movement_group_id.0),
        Some("ALLOTMENT_LINE"),
        Some(&request.allotment_line_id.to_string()),
        request.actor_id.trim(),
        json!({"source":source_place_id,"destination":destination_place_id}),
        now,
    )
    .await?;

    let response = json!({
        "id":allotment_id,
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":allotment_type.as_str(),
        "status":status.as_str(),
        "allotment_line_id":request.allotment_line_id,
        "source_site_id":identity.source_site_id,
        "source_pool_id":identity.source_pool_id,
        "destination_type":identity.destination_type.as_str(),
        "destination_id":identity.destination_id,
        "sku_id":identity.sku_id,
        "executed_quantity":request.quantity,
        "total_executed_quantity":totals.executed,
        "remaining_quantity":totals.remaining(),
        "movement_group_id":movement_group_id.0,
        "movement_ids":movement_ids,
        "inventory_effect":format!("{source_place_id} -> {destination_place_id}")
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn get_allotment(pool: &PgPool, allotment_id: Uuid) -> Result<Value, AppError> {
    let header = sqlx::query("SELECT id,allotment_number,type,status,created_by,notes,created_at,updated_at,cancelled_at FROM allotment WHERE id=$1")
        .bind(allotment_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    let lines = sqlx::query("SELECT l.id,l.source_site_id,l.source_pool_id,l.destination_type,l.destination_id,l.sku_id,sk.sku_code,ar.article_code,ar.name article_name,l.quantity,l.executed_quantity,l.cancelled_quantity,(l.quantity-l.executed_quantity-l.cancelled_quantity)::bigint remaining_quantity,l.created_at,l.updated_at FROM allotment_line l JOIN sku sk ON sk.id=l.sku_id JOIN article ar ON ar.id=sk.article_id WHERE l.allotment_id=$1 ORDER BY l.source_pool_id,l.destination_type,l.destination_id,sk.sku_code")
        .bind(allotment_id)
        .fetch_all(pool)
        .await?;
    let events = sqlx::query("SELECT id,event_sequence,event_type,sku_id,source_site_id,source_pool_id,destination_type,destination_id,quantity,remaining_delta,movement_group_id,reference_type,reference_id,actor_id,details,occurred_at,recorded_at FROM allotment_event WHERE allotment_id=$1 ORDER BY event_sequence")
        .bind(allotment_id)
        .fetch_all(pool)
        .await?;
    let movements = sqlx::query("SELECT m.movement_id,m.movement_group_id,m.subject_id,m.quantity,m.from_place_id,m.to_place_id,m.cause,m.reference_type,m.reference_id,l.id allotment_line_id,l.destination_type,l.destination_id,m.actor_id,m.occurred_at,m.recorded_at FROM movement m LEFT JOIN allotment_line l ON m.reference_type='ALLOTMENT_LINE' AND m.reference_id=l.id::text WHERE (l.allotment_id=$1) OR (m.reference_type='ALLOTMENT' AND m.reference_id=$1::text) ORDER BY m.fact_sequence")
        .bind(allotment_id)
        .fetch_all(pool)
        .await?;
    let line_values: Vec<Value> = lines
        .iter()
        .map(|row| {
            json!({
                "id":row.get::<Uuid,_>("id"),
                "source_site_id":row.get::<String,_>("source_site_id"),
                "source_pool_id":row.get::<String,_>("source_pool_id"),
                "destination_type":row.get::<String,_>("destination_type"),
                "destination_id":row.get::<String,_>("destination_id"),
                "sku_id":row.get::<Uuid,_>("sku_id"),
                "sku_code":row.get::<String,_>("sku_code"),
                "article_code":row.get::<String,_>("article_code"),
                "article_name":row.get::<String,_>("article_name"),
                "quantity":row.get::<i64,_>("quantity"),
                "executed_quantity":row.get::<i64,_>("executed_quantity"),
                "cancelled_quantity":row.get::<i64,_>("cancelled_quantity"),
                "remaining_quantity":row.get::<i64,_>("remaining_quantity")
            })
        })
        .collect();
    let total_quantity: i64 = lines.iter().map(|row| row.get::<i64, _>("quantity")).sum();
    let total_executed: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("executed_quantity"))
        .sum();
    let total_cancelled: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("cancelled_quantity"))
        .sum();
    Ok(json!({
        "id":header.get::<Uuid,_>("id"),
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":header.get::<String,_>("type"),
        "status":header.get::<String,_>("status"),
        "created_by":header.get::<String,_>("created_by"),
        "notes":header.get::<Option<String>,_>("notes"),
        "created_at":header.get::<DateTime<Utc>,_>("created_at"),
        "updated_at":header.get::<DateTime<Utc>,_>("updated_at"),
        "cancelled_at":header.get::<Option<DateTime<Utc>>,_>("cancelled_at"),
        "total_quantity":total_quantity,
        "total_executed_quantity":total_executed,
        "total_cancelled_quantity":total_cancelled,
        "remaining_quantity":total_quantity-total_executed-total_cancelled,
        "lines":line_values,
        "events":events.into_iter().map(|row|json!({
            "id":row.get::<Uuid,_>("id"),
            "sequence":row.get::<i64,_>("event_sequence"),
            "event_type":row.get::<String,_>("event_type"),
            "sku_id":row.get::<Option<Uuid>,_>("sku_id"),
            "source_site_id":row.get::<Option<String>,_>("source_site_id"),
            "source_pool_id":row.get::<Option<String>,_>("source_pool_id"),
            "destination_type":row.get::<Option<String>,_>("destination_type"),
            "destination_id":row.get::<Option<String>,_>("destination_id"),
            "quantity":row.get::<i64,_>("quantity"),
            "remaining_delta":row.get::<i64,_>("remaining_delta"),
            "movement_group_id":row.get::<Option<Uuid>,_>("movement_group_id"),
            "reference_type":row.get::<Option<String>,_>("reference_type"),
            "reference_id":row.get::<Option<String>,_>("reference_id"),
            "actor_id":row.get::<String,_>("actor_id"),
            "details":row.get::<Value,_>("details"),
            "occurred_at":row.get::<DateTime<Utc>,_>("occurred_at"),
            "recorded_at":row.get::<DateTime<Utc>,_>("recorded_at")
        })).collect::<Vec<_>>(),
        "movements":movements.into_iter().map(|row|json!({
            "movement_id":row.get::<Uuid,_>("movement_id"),
            "movement_group_id":row.get::<Uuid,_>("movement_group_id"),
            "subject_id":row.get::<Uuid,_>("subject_id"),
            "quantity":row.get::<i64,_>("quantity"),
            "from":row.get::<String,_>("from_place_id"),
            "to":row.get::<String,_>("to_place_id"),
            "cause":row.get::<String,_>("cause"),
            "reference_type":row.get::<Option<String>,_>("reference_type"),
            "reference_id":row.get::<Option<String>,_>("reference_id"),
            "allotment_line_id":row.get::<Option<Uuid>,_>("allotment_line_id"),
            "allotment_id":allotment_id,
            "destination_type":row.get::<Option<String>,_>("destination_type"),
            "destination_id":row.get::<Option<String>,_>("destination_id"),
            "actor_id":row.get::<String,_>("actor_id"),
            "occurred_at":row.get::<DateTime<Utc>,_>("occurred_at"),
            "recorded_at":row.get::<DateTime<Utc>,_>("recorded_at")
        })).collect::<Vec<_>>()
    }))
}

pub async fn list_allotments(pool: &PgPool, query: AllotmentQuery) -> Result<Value, AppError> {
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let allotment_type = query.allotment_type.map(|value| value.as_str().to_owned());
    let status = query.status.map(|value| value.as_str().to_owned());
    let rows = sqlx::query("SELECT a.id,a.allotment_number,a.type,a.status,a.created_by,a.notes,a.created_at,a.updated_at,COALESCE(SUM(l.quantity),0)::bigint quantity,COALESCE(SUM(l.executed_quantity),0)::bigint executed,COALESCE(SUM(l.cancelled_quantity),0)::bigint cancelled,COALESCE(SUM(l.quantity-l.executed_quantity-l.cancelled_quantity),0)::bigint remaining FROM allotment a LEFT JOIN allotment_line l ON l.allotment_id=a.id WHERE ($1::text IS NULL OR a.type=$1) AND ($2::text IS NULL OR a.status=$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM allotment_line source_line WHERE source_line.allotment_id=a.id AND source_line.source_pool_id=$3)) AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM allotment_line destination_line WHERE destination_line.allotment_id=a.id AND destination_line.destination_id=$4)) GROUP BY a.id ORDER BY a.created_at DESC LIMIT $5")
        .bind(allotment_type)
        .bind(status)
        .bind(query.source_pool_id.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(query.destination_id.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let destination_rows = sqlx::query("SELECT l.destination_type,l.destination_id,s.name destination_name,COALESCE(SUM(l.quantity),0)::bigint quantity,COALESCE(SUM(l.executed_quantity),0)::bigint executed,COALESCE(SUM(l.cancelled_quantity),0)::bigint cancelled,COALESCE(SUM(l.quantity-l.executed_quantity-l.cancelled_quantity),0)::bigint remaining FROM allotment_line l LEFT JOIN site s ON s.id=l.destination_id GROUP BY l.destination_type,l.destination_id,s.name ORDER BY l.destination_type,l.destination_id")
        .fetch_all(pool)
        .await?;
    let projection = get_availability(
        pool,
        AvailabilityQuery {
            at: None,
            source_pool_id: query.source_pool_id,
        },
    )
    .await?;
    let shortages = projection["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let on_hand = item["on_hand_qty"].as_i64()?;
                    if on_hand >= 0 {
                        return None;
                    }
                    let mut shortage = item.clone();
                    shortage["shortage_qty"] = json!(-on_hand);
                    Some(shortage)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id":row.get::<Uuid,_>("id"),
                "allotment_number":row.get::<String,_>("allotment_number"),
                "type":row.get::<String,_>("type"),
                "status":row.get::<String,_>("status"),
                "total_quantity":row.get::<i64,_>("quantity"),
                "total_executed_quantity":row.get::<i64,_>("executed"),
                "total_cancelled_quantity":row.get::<i64,_>("cancelled"),
                "remaining_quantity":row.get::<i64,_>("remaining"),
                "created_by":row.get::<String,_>("created_by"),
                "notes":row.get::<Option<String>,_>("notes"),
                "created_at":row.get::<DateTime<Utc>,_>("created_at"),
                "updated_at":row.get::<DateTime<Utc>,_>("updated_at")
            })
        })
        .collect();
    Ok(json!({
        "items":items,
        "limit":limit,
        "by_destination":destination_rows.into_iter().map(|row|json!({
            "destination_type":row.get::<String,_>("destination_type"),
            "destination_id":row.get::<String,_>("destination_id"),
            "destination_name":row.get::<Option<String>,_>("destination_name"),
            "total_quantity":row.get::<i64,_>("quantity"),
            "total_executed_quantity":row.get::<i64,_>("executed"),
            "total_cancelled_quantity":row.get::<i64,_>("cancelled"),
            "remaining_quantity":row.get::<i64,_>("remaining")
        })).collect::<Vec<_>>(),
        "shortages":shortages
    }))
}

pub async fn list_allotments_by_store(pool: &PgPool, store_id: &str) -> Result<Value, AppError> {
    let store_id = store_id.trim().to_ascii_lowercase();
    let store = sqlx::query("SELECT name FROM site WHERE id=$1 AND kind='STORE'")
        .bind(&store_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("destination store".into()))?;
    let mut result = list_allotments(
        pool,
        AllotmentQuery {
            allotment_type: None,
            status: None,
            source_pool_id: None,
            destination_id: Some(store_id.clone()),
            limit: Some(500),
        },
    )
    .await?;
    let rows = sqlx::query("SELECT l.sku_id,sk.sku_code,SUM(l.quantity)::bigint quantity,SUM(l.executed_quantity)::bigint executed,SUM(l.cancelled_quantity)::bigint cancelled,SUM(l.quantity-l.executed_quantity-l.cancelled_quantity)::bigint remaining FROM allotment_line l JOIN sku sk ON sk.id=l.sku_id WHERE l.destination_type='STORE' AND l.destination_id=$1 GROUP BY l.sku_id,sk.sku_code ORDER BY sk.sku_code")
        .bind(&store_id)
        .fetch_all(pool)
        .await?;
    result["destination_type"] = json!("STORE");
    result["destination_id"] = json!(store_id);
    result["destination_name"] = json!(store.get::<String, _>("name"));
    result["sku_summary"] = json!(rows
        .into_iter()
        .map(|row| json!({
            "sku_id":row.get::<Uuid,_>("sku_id"),
            "sku_code":row.get::<String,_>("sku_code"),
            "quantity":row.get::<i64,_>("quantity"),
            "executed_quantity":row.get::<i64,_>("executed"),
            "cancelled_quantity":row.get::<i64,_>("cancelled"),
            "remaining_quantity":row.get::<i64,_>("remaining")
        }))
        .collect::<Vec<_>>());
    Ok(result)
}

pub async fn get_availability(pool: &PgPool, query: AvailabilityQuery) -> Result<Value, AppError> {
    let at = query.at.unwrap_or_else(Utc::now);
    let source_pool_id = query
        .source_pool_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SOURCE_POOL_ID)
        .to_ascii_lowercase();
    let source =
        sqlx::query("SELECT p.site_id,p.label FROM operational_pool p WHERE p.id=$1 AND p.active AND p.is_placement")
            .bind(&source_pool_id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound("active placement source pool".into()))?;
    let rows = sqlx::query(r#"
WITH ledger_delta AS (
    SELECT subject.sku_id,place.state,movement.quantity delta
    FROM movement
    JOIN inventory_subject subject ON subject.id=movement.subject_id
    JOIN inventory_place place ON place.id=movement.to_place_id
    WHERE place.pool_id=$2 AND place.state IN ('NORMAL','MISSING')
      AND subject.sku_id IS NOT NULL AND movement.occurred_at <= $1
    UNION ALL
    SELECT subject.sku_id,place.state,-movement.quantity delta
    FROM movement
    JOIN inventory_subject subject ON subject.id=movement.subject_id
    JOIN inventory_place place ON place.id=movement.from_place_id
    WHERE place.pool_id=$2 AND place.state IN ('NORMAL','MISSING')
      AND subject.sku_id IS NOT NULL AND movement.occurred_at <= $1
), ledger_balance AS (
    SELECT sku_id,
           COALESCE(SUM(delta) FILTER(WHERE state='NORMAL'),0)::bigint normal_quantity,
           COALESCE(SUM(delta) FILTER(WHERE state='MISSING'),0)::bigint missing_quantity
    FROM ledger_delta GROUP BY sku_id
), allotted_balance AS (
    SELECT event.sku_id,COALESCE(SUM(event.remaining_delta),0)::bigint allotted_quantity
    FROM allotment_event event
    LEFT JOIN allotment_line line ON line.id=event.allotment_line_id
    WHERE event.sku_id IS NOT NULL AND event.occurred_at <= $1
      AND COALESCE(event.source_pool_id,line.source_pool_id)=$2
    GROUP BY event.sku_id
)
SELECT sku.id sku_id,sku.sku_code,article.article_code,article.name article_name,
       (COALESCE(ledger.normal_quantity,0)+COALESCE(ledger.missing_quantity,0))::bigint stock_quantity,
       COALESCE(allotted.allotted_quantity,0)::bigint allotted_quantity,
       (COALESCE(ledger.normal_quantity,0)-COALESCE(allotted.allotted_quantity,0))::bigint on_hand_quantity,
       COALESCE(ledger.missing_quantity,0)::bigint missing_quantity
FROM sku JOIN article ON article.id=sku.article_id
LEFT JOIN ledger_balance ledger ON ledger.sku_id=sku.id
LEFT JOIN allotted_balance allotted ON allotted.sku_id=sku.id
WHERE sku.active ORDER BY sku.sku_code
"#)
        .bind(at)
        .bind(&source_pool_id)
        .fetch_all(pool)
        .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "sku_id":row.get::<Uuid,_>("sku_id"),
                "sku_code":row.get::<String,_>("sku_code"),
                "article_code":row.get::<String,_>("article_code"),
                "article_name":row.get::<String,_>("article_name"),
                "stock_qty":row.get::<i64,_>("stock_quantity"),
                "allotted_qty":row.get::<i64,_>("allotted_quantity"),
                "on_hand_qty":row.get::<i64,_>("on_hand_quantity"),
                "missing_qty":row.get::<i64,_>("missing_quantity")
            })
        })
        .collect();
    let total = |field: &str| {
        items
            .iter()
            .filter_map(|item| item[field].as_i64())
            .sum::<i64>()
    };
    Ok(json!({
        "source_site_id":source.get::<String,_>("site_id"),
        "source_pool_id":source_pool_id,
        "source_pool_label":source.get::<String,_>("label"),
        "source_place_id":format!("{source_pool_id}:on_hand"),
        "as_of":at,
        "stock_qty":total("stock_qty"),
        "allotted_qty":total("allotted_qty"),
        "on_hand_qty":total("on_hand_qty"),
        "missing_qty":total("missing_qty"),
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "items":items
    }))
}

pub(super) async fn record_allotment_shortages_for_count(
    tx: &mut Transaction<'_, Postgres>,
    count_id: Uuid,
    movement_group_id: Option<Uuid>,
    pool_id: &str,
    shortage_subject_ids: &[Uuid],
    actor_id: &str,
) -> Result<i64, AppError> {
    if shortage_subject_ids.is_empty() {
        return Ok(0);
    }
    let Some(movement_group_id) = movement_group_id else {
        return Ok(0);
    };
    let source = sqlx::query("SELECT site_id FROM operational_pool WHERE id=$1")
        .bind(pool_id)
        .fetch_one(&mut **tx)
        .await?;
    let source_site_id: String = source.get("site_id");
    let rows = sqlx::query("SELECT DISTINCT sku_id FROM inventory_subject WHERE id=ANY($1) AND sku_id IS NOT NULL ORDER BY sku_id")
        .bind(shortage_subject_ids)
        .fetch_all(&mut **tx)
        .await?;
    let mut inserted = 0_i64;
    for row in rows {
        let sku_id: Uuid = row.get("sku_id");
        let normal_quantity = normal_balance_tx(tx, pool_id, sku_id).await?;
        let allotted_quantity = active_allotment_tx(tx, pool_id, sku_id).await?;
        let shortage_quantity = allotted_quantity - normal_quantity;
        if shortage_quantity <= 0 {
            continue;
        }
        let event_key = format!("official-count:{count_id}:allotment-shortage:{pool_id}:{sku_id}");
        let result = sqlx::query("INSERT INTO allotment_event(id,event_key,event_type,sku_id,quantity,remaining_delta,movement_group_id,reference_type,reference_id,actor_id,details,occurred_at) VALUES($1,$2,'ALLOTMENT_SHORTAGE',$3,$4,0,$5,'OFFICIAL_COUNT',$6,$7,$8,now()) ON CONFLICT(event_key) DO NOTHING")
            .bind(Uuid::new_v4())
            .bind(event_key)
            .bind(sku_id)
            .bind(shortage_quantity)
            .bind(movement_group_id)
            .bind(count_id.to_string())
            .bind(actor_id)
            .bind(json!({
                "source_site_id":source_site_id,
                "source_pool_id":pool_id,
                "normal_qty":normal_quantity,
                "allotted_qty":allotted_quantity,
                "shortage_qty":shortage_quantity
            }))
            .execute(&mut **tx)
            .await?;
        inserted += result.rows_affected() as i64;
    }
    Ok(inserted)
}

async fn validate_create_line(
    tx: &mut Transaction<'_, Postgres>,
    allotment_type: AllotmentType,
    line: &NormalizedLine,
) -> Result<(), AppError> {
    let source = sqlx::query("SELECT p.site_id,s.kind site_kind FROM operational_pool p JOIN site s ON s.id=p.site_id WHERE p.id=$1 AND p.site_id=$2 AND p.active AND p.is_placement")
        .bind(&line.identity.source_pool_id)
        .bind(&line.identity.source_site_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("active placement source pool/site pair".into()))?;
    let source_site_kind: String = source.get("site_kind");
    match allotment_type {
        AllotmentType::ToStore => {
            if line.identity.source_site_id != "dc"
                || line.identity.source_pool_id != DEFAULT_SOURCE_POOL_ID
                || line.identity.destination_type != DestinationType::Store
            {
                return Err(AppError::Validation(
                    "TO_STORE requires dc.warehouse at dc and a STORE destination".into(),
                ));
            }
            let destination = sqlx::query("SELECT kind FROM site WHERE id=$1")
                .bind(&line.identity.destination_id)
                .fetch_optional(&mut **tx)
                .await?
                .ok_or_else(|| AppError::NotFound("destination store".into()))?;
            if destination.get::<String, _>("kind") != "STORE" {
                return Err(AppError::Validation(
                    "TO_STORE destination must be an existing Store".into(),
                ));
            }
        }
        AllotmentType::ReturnToDc => {
            let site = &line.identity.source_site_id;
            let source_matches_store = line.identity.source_pool_id == format!("{site}.warehouse")
                || line.identity.source_pool_id == format!("{site}.floor")
                || line.identity.source_pool_id == format!("{site}.reject");
            if source_site_kind != "STORE"
                || !source_matches_store
                || line.identity.destination_type != DestinationType::Dc
                || line.identity.destination_id != "dc"
            {
                return Err(AppError::Validation(
                    "RETURN_TO_DC requires a Store warehouse/floor/reject source and DC/dc destination"
                        .into(),
                ));
            }
        }
        AllotmentType::ReturnToSupplier => {
            if line.identity.source_site_id != "dc"
                || line.identity.source_pool_id != "dc.reject.dc"
                || line.identity.destination_type != DestinationType::Supplier
                || line.identity.destination_id != "external/supplier"
            {
                return Err(AppError::Validation(
                    "RETURN_TO_SUPPLIER requires dc.reject.dc and SUPPLIER/external/supplier"
                        .into(),
                ));
            }
        }
    }
    Ok(())
}

fn execution_transition(
    allotment_type: AllotmentType,
    identity: &LineIdentity,
) -> Result<(MovementCause, String), AppError> {
    match allotment_type {
        AllotmentType::ToStore
            if identity.source_site_id == "dc"
                && identity.source_pool_id == DEFAULT_SOURCE_POOL_ID
                && identity.destination_type == DestinationType::Store =>
        {
            let destination_store = SiteId::new(&identity.destination_id)
                .map_err(|error| AppError::Conflict(error.to_string()))?;
            let destination = Place::Operational {
                pool: OperationalPool::DcOutboundPicked(destination_store),
                state: InventoryState::Normal,
            };
            Ok((MovementCause::NormalMove, destination.id()))
        }
        AllotmentType::ReturnToDc
            if identity.destination_type == DestinationType::Dc
                && identity.destination_id == "dc" =>
        {
            Ok((MovementCause::ReturnToDc, "dc.warehouse:on_hand".into()))
        }
        AllotmentType::ReturnToSupplier
            if identity.source_pool_id == "dc.reject.dc"
                && identity.destination_type == DestinationType::Supplier
                && identity.destination_id == "external/supplier" =>
        {
            Ok((MovementCause::SupplierReturn, "external/supplier".into()))
        }
        _ => Err(AppError::Conflict(
            "persisted allotment type and line endpoints are inconsistent".into(),
        )),
    }
}

async fn lock_active_skus(
    tx: &mut Transaction<'_, Postgres>,
    sku_ids: &[Uuid],
) -> Result<(), AppError> {
    let rows = sqlx::query("SELECT id FROM sku WHERE id=ANY($1) AND active ORDER BY id FOR UPDATE")
        .bind(sku_ids)
        .fetch_all(&mut **tx)
        .await?;
    if rows.len() != sku_ids.len() {
        return Err(AppError::Validation(
            "every allotment line must reference an active SKU".into(),
        ));
    }
    Ok(())
}

async fn lock_open_allotment(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<sqlx::postgres::PgRow, AppError> {
    let row =
        sqlx::query("SELECT id,allotment_number,type,status FROM allotment WHERE id=$1 FOR UPDATE")
            .bind(allotment_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    let status: String = row.get("status");
    if !matches!(status.as_str(), "ACTIVE" | "PARTIALLY_EXECUTED") {
        return Err(AppError::Conflict(format!(
            "allotment must have remaining active quantity, currently {status}"
        )));
    }
    Ok(row)
}

async fn normal_balance_tx(
    tx: &mut Transaction<'_, Postgres>,
    source_pool_id: &str,
    sku_id: Uuid,
) -> Result<i64, AppError> {
    let place_id = format!("{source_pool_id}:on_hand");
    let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN movement.to_place_id=$2 THEN movement.quantity WHEN movement.from_place_id=$2 THEN -movement.quantity ELSE 0 END),0)::bigint quantity FROM movement JOIN inventory_subject subject ON subject.id=movement.subject_id WHERE subject.sku_id=$1 AND (movement.to_place_id=$2 OR movement.from_place_id=$2)")
        .bind(sku_id)
        .bind(place_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.get("quantity"))
}

async fn active_allotment_tx(
    tx: &mut Transaction<'_, Postgres>,
    source_pool_id: &str,
    sku_id: Uuid,
) -> Result<i64, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(quantity-executed_quantity-cancelled_quantity),0)::bigint quantity FROM allotment_line WHERE source_pool_id=$1 AND sku_id=$2")
        .bind(source_pool_id)
        .bind(sku_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.get("quantity"))
}

async fn allocate_source_subjects(
    tx: &mut Transaction<'_, Postgres>,
    sku_id: Uuid,
    quantity: i64,
    source_place_id: &str,
    destination_place_id: &str,
) -> Result<Vec<MovementLine>, AppError> {
    let rows = sqlx::query(
        r#"
WITH delta AS (
    SELECT subject_id,quantity delta FROM movement WHERE to_place_id=$2
    UNION ALL SELECT subject_id,-quantity delta FROM movement WHERE from_place_id=$2
), balance AS (
    SELECT subject_id,SUM(delta)::bigint quantity FROM delta GROUP BY subject_id HAVING SUM(delta)>0
)
SELECT subject.id,subject.subject_type,balance.quantity
FROM balance JOIN inventory_subject subject ON subject.id=balance.subject_id
WHERE subject.sku_id=$1 ORDER BY subject.id FOR UPDATE OF subject
"#,
    )
    .bind(sku_id)
    .bind(source_place_id)
    .fetch_all(&mut **tx)
    .await?;
    let source: Place = source_place_id
        .parse()
        .map_err(|error: crate::domain::PlaceError| AppError::Validation(error.to_string()))?;
    let destination: Place = destination_place_id
        .parse()
        .map_err(|error: crate::domain::PlaceError| AppError::Validation(error.to_string()))?;
    let mut needed = quantity;
    let mut lines = Vec::new();
    for row in rows {
        if needed == 0 {
            break;
        }
        let balance: i64 = row.get("quantity");
        let subject_type: String = row.get("subject_type");
        let take = if subject_type == "UNIT" {
            1.min(needed)
        } else {
            balance.min(needed)
        };
        if take <= 0 {
            continue;
        }
        lines.push(MovementLine {
            subject_id: SubjectId(row.get("id")),
            quantity: take,
            from: source.clone(),
            to: destination.clone(),
        });
        needed -= take;
    }
    if needed > 0 {
        return Err(AppError::Conflict(format!(
            "insufficient inventory at {source_place_id}: balance {}, requested {quantity}",
            quantity - needed
        )));
    }
    Ok(lines)
}

struct AllotmentTotals {
    quantity: i64,
    executed: i64,
    cancelled: i64,
}

impl AllotmentTotals {
    fn remaining(&self) -> i64 {
        self.quantity - self.executed - self.cancelled
    }
}

async fn allotment_totals_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<AllotmentTotals, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(quantity),0)::bigint quantity,COALESCE(SUM(executed_quantity),0)::bigint executed,COALESCE(SUM(cancelled_quantity),0)::bigint cancelled FROM allotment_line WHERE allotment_id=$1")
        .bind(allotment_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(AllotmentTotals {
        quantity: row.get("quantity"),
        executed: row.get("executed"),
        cancelled: row.get("cancelled"),
    })
}

fn line_identity_from_row(row: &sqlx::postgres::PgRow) -> Result<LineIdentity, AppError> {
    let destination_type = DestinationType::from_str(&row.get::<String, _>("destination_type"))
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    Ok(LineIdentity {
        source_site_id: row.get("source_site_id"),
        source_pool_id: row.get("source_pool_id"),
        destination_type,
        destination_id: row.get("destination_id"),
        sku_id: row.get("sku_id"),
    })
}

#[allow(clippy::too_many_arguments)]
async fn insert_allotment_event(
    tx: &mut Transaction<'_, Postgres>,
    event_key: &str,
    allotment_id: Option<Uuid>,
    allotment_line_id: Option<Uuid>,
    event_type: &str,
    identity: Option<&LineIdentity>,
    quantity: i64,
    remaining_delta: i64,
    movement_group_id: Option<Uuid>,
    reference_type: Option<&str>,
    reference_id: Option<&str>,
    actor_id: &str,
    details: Value,
    occurred_at: DateTime<Utc>,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO allotment_event(id,event_key,allotment_id,allotment_line_id,event_type,sku_id,source_site_id,source_pool_id,destination_type,destination_id,quantity,remaining_delta,movement_group_id,reference_type,reference_id,actor_id,details,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(Uuid::new_v4())
        .bind(event_key)
        .bind(allotment_id)
        .bind(allotment_line_id)
        .bind(event_type)
        .bind(identity.map(|value| value.sku_id))
        .bind(identity.map(|value| value.source_site_id.as_str()))
        .bind(identity.map(|value| value.source_pool_id.as_str()))
        .bind(identity.map(|value| value.destination_type.as_str()))
        .bind(identity.map(|value| value.destination_id.as_str()))
        .bind(quantity)
        .bind(remaining_delta)
        .bind(movement_group_id)
        .bind(reference_type)
        .bind(reference_id)
        .bind(actor_id)
        .bind(details)
        .bind(occurred_at)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
