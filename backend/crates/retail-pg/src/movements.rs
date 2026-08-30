use super::{begin_idempotent, complete_idempotent, payload_digest, resolve_subject};
use retail_app::{ AppError, CorrectPlacementRequest, CreateMovementRequest, MissingResolutionRequest, MovementLineRequest, MovementQuery, };
use retail_domain::{ validate_command, MovementCause, MovementCommand, MovementGroupId, MovementLine, Place, SubjectId, SubjectType, };
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

const TO_STORE_SOURCE_PLACE_ID: &str = "dc.warehouse:on_hand";

pub async fn create_manual_movement(
    pool: &PgPool,
    request: CreateMovementRequest,
) -> Result<Value, AppError> {
    let cause = MovementCause::from_str(request.cause.as_deref().unwrap_or("NORMAL_MOVE"))
        .map_err(|e| AppError::Validation(e.to_string()))?;
    if !matches!(
        cause,
        MovementCause::NormalMove | MovementCause::Sale | MovementCause::SupplierReturn
    ) {
        return Err(AppError::Validation(
            "manual movement endpoint only accepts NORMAL_MOVE, SALE, or SUPPLIER_RETURN".into(),
        ));
    }
    if cause == MovementCause::NormalMove
        && request.lines.iter().any(|line| {
            line.from == TO_STORE_SOURCE_PLACE_ID
                && line.to.starts_with("dc.outbound.picked.store-")
        })
    {
        return Err(AppError::Validation(
            "DC Warehouse outbound entry must use Allotment execute so the line counter and movement remain atomic".into(),
        ));
    }
    create_movement_with_cause(pool, request, Some(cause)).await
}

pub async fn create_movement(
    pool: &PgPool,
    request: CreateMovementRequest,
) -> Result<Value, AppError> {
    create_movement_with_cause(pool, request, None).await
}

pub async fn correct_placement(
    pool: &PgPool,
    request: CorrectPlacementRequest,
) -> Result<Value, AppError> {
    if request.evidence_reference.trim().is_empty() {
        return Err(AppError::Validation(
            "evidence_reference is required for placement correction".into(),
        ));
    }
    let reason = match request
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        Some(notes) => format!("{} — {}", request.reason.trim(), notes),
        None => request.reason.clone(),
    };
    let move_request = CreateMovementRequest {
        idempotency_key: request.idempotency_key,
        actor_id: request.actor_id,
        occurred_at: request.occurred_at,
        reason,
        reference_type: Some("PLACEMENT_EVIDENCE".into()),
        reference_id: Some(request.evidence_reference),
        cause: Some("PLACEMENT_CORRECTION".into()),
        lines: vec![request.line],
    };
    create_movement_with_cause(pool, move_request, Some(MovementCause::PlacementCorrection)).await
}

async fn create_movement_with_cause(
    pool: &PgPool,
    request: CreateMovementRequest,
    forced_cause: Option<MovementCause>,
) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let command_type = if forced_cause == Some(MovementCause::PlacementCorrection) {
        "CORRECT_PLACEMENT"
    } else {
        "MOVE_STOCK"
    };
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, command_type, &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let cause = forced_cause.unwrap_or(
        MovementCause::from_str(request.cause.as_deref().unwrap_or("NORMAL_MOVE"))
            .map_err(|e| AppError::Validation(e.to_string()))?,
    );
    let group_id = Uuid::new_v4();
    let mut lines = Vec::with_capacity(request.lines.len());
    for line in &request.lines {
        let subject = resolve_subject(&mut tx, line.subject_id, line.epc.as_deref(), true).await?;
        lines.push(MovementLine {
            subject_id: SubjectId(subject),
            quantity: line.quantity,
            from: line
                .from
                .parse()
                .map_err(|e: retail_domain::PlaceError| AppError::Validation(e.to_string()))?,
            to: line
                .to
                .parse()
                .map_err(|e: retail_domain::PlaceError| AppError::Validation(e.to_string()))?,
        });
    }
    let command = MovementCommand {
        movement_group_id: MovementGroupId(group_id),
        lines,
        cause,
        reference_type: request.reference_type.clone(),
        reference_id: request.reference_id.clone(),
        reason: request.reason.clone(),
        actor_id: request.actor_id.clone(),
        occurred_at: request.occurred_at.unwrap_or_else(Utc::now),
    };
    validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
    insert_group(&mut tx, &command, &request.idempotency_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &command, &request.idempotency_key, &digest).await?;
    let response = json!({
        "movement_group_id": group_id,
        "movement_ids": movement_ids,
        "line_count": command.lines.len(),
        "cause": cause.as_str(),
        "occurred_at": command.occurred_at,
        "idempotent_replay": false
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub(super) async fn insert_group(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
    idempotency_key: &str,
    digest: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO movement_group (id,cause,reason,reference_type,reference_id,actor_id,idempotency_key,payload_digest,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(command.movement_group_id.0).bind(command.cause.as_str()).bind(&command.reason)
        .bind(&command.reference_type).bind(&command.reference_id).bind(&command.actor_id)
        .bind(idempotency_key).bind(digest).bind(command.occurred_at)
        .execute(&mut **tx).await?;
    // Every movement group is one sync fact, appended in the SAME transaction
    // as the authoritative write: the ledger and the outbox cannot disagree.
    // A no-op when this node has enqueueing disabled (CLOUD role).
    super::enqueue_movement_fact(tx, command).await?;
    Ok(())
}

pub(super) async fn apply_lines(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
    idempotency_key: &str,
    digest: &str,
) -> Result<Vec<Uuid>, AppError> {
    let mut ids = Vec::with_capacity(command.lines.len());
    for line in &command.lines {
        ids.push(apply_line(tx, command, line, idempotency_key, digest).await?);
    }
    Ok(ids)
}

async fn apply_line(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
    line: &MovementLine,
    idempotency_key: &str,
    digest: &str,
) -> Result<Uuid, AppError> {
    let subject =
        sqlx::query("SELECT subject_type, quantity FROM inventory_subject WHERE id=$1 FOR UPDATE")
            .bind(line.subject_id.0)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound("inventory subject".into()))?;
    let subject_type = match subject.get::<String, _>("subject_type").as_str() {
        "UNIT" => SubjectType::Unit,
        "QUANTITY" => SubjectType::Quantity,
        _ => return Err(AppError::Conflict("unknown persisted subject type".into())),
    };
    let subject_quantity: i64 = subject.get("quantity");
    if subject_type == SubjectType::Unit && (line.quantity != 1 || subject_quantity != 1) {
        return Err(AppError::Validation(
            "UNIT/EPC movement quantity must equal 1".into(),
        ));
    }
    if line.from.is_company() {
        let balance = ledger_balance(tx, line.subject_id.0, &line.from.id()).await?;
        if balance < line.quantity {
            return Err(AppError::Conflict(format!(
                "insufficient authoritative ledger balance at {}: balance {balance}, requested {}",
                line.from.id(),
                line.quantity
            )));
        }
    }
    if command.cause == MovementCause::NormalMove {
        validate_outbound_allotment_line_provenance(tx, command, line).await?;
    }
    if subject_type == SubjectType::Unit && line.to.is_company() && !line.from.is_company() {
        let current = company_placement_count(tx, line.subject_id.0).await?;
        if current > 0 {
            return Err(AppError::Conflict(
                "UNIT/EPC already has a current company placement".into(),
            ));
        }
    }
    let movement_id = Uuid::new_v4();
    sqlx::query("INSERT INTO movement (movement_id,movement_group_id,subject_id,quantity,from_place_id,to_place_id,cause,reference_type,reference_id,idempotency_key,payload_digest,actor_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(movement_id).bind(command.movement_group_id.0).bind(line.subject_id.0).bind(line.quantity)
        .bind(line.from.id()).bind(line.to.id()).bind(command.cause.as_str()).bind(&command.reference_type)
        .bind(&command.reference_id).bind(idempotency_key).bind(digest).bind(&command.actor_id).bind(command.occurred_at)
        .execute(&mut **tx).await?;
    refresh_projection_position(tx, line.subject_id.0, &line.from).await?;
    refresh_projection_position(tx, line.subject_id.0, &line.to).await?;
    if subject_type == SubjectType::Unit
        && company_placement_count(tx, line.subject_id.0).await? > 1
    {
        return Err(AppError::Conflict(
            "UNIT/EPC would have more than one company placement".into(),
        ));
    }
    Ok(movement_id)
}

async fn ledger_balance(
    tx: &mut Transaction<'_, Postgres>,
    subject_id: Uuid,
    place_id: &str,
) -> Result<i64, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN to_place_id=$2 THEN quantity WHEN from_place_id=$2 THEN -quantity ELSE 0 END),0)::bigint AS balance FROM movement WHERE subject_id=$1 AND (from_place_id=$2 OR to_place_id=$2)")
        .bind(subject_id).bind(place_id).fetch_one(&mut **tx).await?;
    Ok(row.get("balance"))
}

/// Outbound placement remains ledger truth while the immutable allotment line
/// carries intended Store provenance through every outbound stage.
async fn validate_outbound_allotment_line_provenance(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
    line: &MovementLine,
) -> Result<(), AppError> {
    let from = line.from.id();
    let to = line.to.id();
    let from_outbound = from.starts_with("dc.outbound.");
    let to_outbound = to.starts_with("dc.outbound.");
    if !from_outbound && !to_outbound {
        return Ok(());
    }

    if command.reference_type.as_deref() == Some("ALLOTMENT_LINE") {
        let allotment_line_id = command
            .reference_id
            .as_deref()
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(|| {
                AppError::Validation(
                    "ALLOTMENT_LINE reference_id must be a valid allotment line UUID".into(),
                )
            })?;
        let provenance = sqlx::query("SELECT l.allotment_id,l.sku_id,l.source_pool_id,l.destination_type,l.destination_id,a.type allotment_type,s.sku_id subject_sku_id FROM allotment_line l JOIN allotment a ON a.id=l.allotment_id JOIN inventory_subject s ON s.id=$2 WHERE l.id=$1")
            .bind(allotment_line_id)
            .bind(line.subject_id.0)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound("movement allotment line reference".into()))?;
        if provenance.get::<String, _>("allotment_type") != "TO_STORE"
            || provenance.get::<String, _>("destination_type") != "STORE"
        {
            return Err(AppError::Conflict(
                "outbound movement requires a TO_STORE line with a Store destination".into(),
            ));
        }
        let line_sku_id: Uuid = provenance.get("sku_id");
        let subject_sku_id: Option<Uuid> = provenance.get("subject_sku_id");
        if subject_sku_id != Some(line_sku_id) {
            return Err(AppError::Conflict(
                "outbound subject SKU does not match the referenced allotment line".into(),
            ));
        }
        let destination_id: String = provenance.get("destination_id");
        for endpoint in [&line.from, &line.to] {
            if let Some(outbound_store) = endpoint
                .pool()
                .and_then(|pool| pool.outbound_destination())
            {
                if outbound_store.as_str() != destination_id {
                    return Err(AppError::Conflict(format!(
                        "allotment line {allotment_line_id} is destined for {destination_id}, not {outbound_store}"
                    )));
                }
            }
        }
        if to_outbound && !from_outbound {
            let source_pool_id: String = provenance.get("source_pool_id");
            let expected_source = format!("{source_pool_id}:on_hand");
            if from != expected_source {
                return Err(AppError::Conflict(format!(
                    "allotment line {allotment_line_id} starts at {expected_source}, not {from}"
                )));
            }
        }
        if from_outbound {
            let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN to_place_id=$3 THEN quantity WHEN from_place_id=$3 THEN -quantity ELSE 0 END),0)::bigint balance FROM movement WHERE subject_id=$1 AND reference_type='ALLOTMENT_LINE' AND reference_id=$2 AND (from_place_id=$3 OR to_place_id=$3)")
                .bind(line.subject_id.0)
                .bind(allotment_line_id.to_string())
                .bind(&from)
                .fetch_one(&mut **tx)
                .await?;
            let referenced_balance: i64 = row.get("balance");
            if referenced_balance < line.quantity {
                return Err(AppError::Conflict(format!(
                    "insufficient outbound quantity for allotment line {allotment_line_id} at {from}: balance {referenced_balance}, requested {}",
                    line.quantity
                )));
            }
        }
        if to.starts_with("store-") {
            if to.split('.').next() != Some(destination_id.as_str()) {
                return Err(AppError::Conflict(format!(
                    "allotment line {allotment_line_id} is destined for {destination_id}, not {}",
                    to.split('.').next().unwrap_or_default()
                )));
            }
        }
        return Ok(());
    }

    if to_outbound && !from_outbound {
        return Err(AppError::Validation(
            "outbound entry requires an ALLOTMENT_LINE reference and the Allotment execute command"
                .into(),
        ));
    }
    if from_outbound {
        let row = sqlx::query(r#"
WITH delta AS (
    SELECT reference_id,quantity delta FROM movement
    WHERE subject_id=$1 AND reference_type='ALLOTMENT_LINE' AND to_place_id=$2
    UNION ALL
    SELECT reference_id,-quantity delta FROM movement
    WHERE subject_id=$1 AND reference_type='ALLOTMENT_LINE' AND from_place_id=$2
), reserved AS (
    SELECT reference_id,SUM(delta)::bigint quantity FROM delta GROUP BY reference_id HAVING SUM(delta)>0
)
SELECT COALESCE(SUM(quantity),0)::bigint quantity FROM reserved
"#)
            .bind(line.subject_id.0)
            .bind(&from)
            .fetch_one(&mut **tx)
            .await?;
        let reserved: i64 = row.get("quantity");
        let physical = ledger_balance(tx, line.subject_id.0, &from).await?;
        let unassigned = physical - reserved;
        if unassigned < line.quantity {
            return Err(AppError::Conflict(format!(
                "outbound quantity belongs to an allotment line; unassigned {unassigned}, requested {}. Retain the ALLOTMENT_LINE reference",
                line.quantity
            )));
        }
    }
    Ok(())
}

async fn company_placement_count(
    tx: &mut Transaction<'_, Postgres>,
    subject_id: Uuid,
) -> Result<i64, AppError> {
    let row = sqlx::query("WITH d AS (SELECT to_place_id place_id, quantity q FROM movement WHERE subject_id=$1 UNION ALL SELECT from_place_id, -quantity FROM movement WHERE subject_id=$1), b AS (SELECT place_id,sum(q) qty FROM d GROUP BY place_id) SELECT count(*)::bigint count FROM b JOIN inventory_place p ON p.id=b.place_id WHERE p.is_company AND b.qty>0")
        .bind(subject_id).fetch_one(&mut **tx).await?;
    Ok(row.get("count"))
}

// pub(super): the sync applier replays movement facts from other origins and
// must maintain the projection with the same logic as local writes.
pub(super) async fn refresh_projection_position(
    tx: &mut Transaction<'_, Postgres>,
    subject_id: Uuid,
    place: &Place,
) -> Result<(), AppError> {
    if !place.is_company() {
        return Ok(());
    }
    let place_id = place.id();
    let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN to_place_id=$2 THEN quantity WHEN from_place_id=$2 THEN -quantity ELSE 0 END),0)::bigint balance, COALESCE(MAX(fact_sequence),0)::bigint seq FROM movement WHERE subject_id=$1 AND (from_place_id=$2 OR to_place_id=$2)")
        .bind(subject_id).bind(&place_id).fetch_one(&mut **tx).await?;
    let balance: i64 = row.get("balance");
    let sequence: i64 = row.get("seq");
    if balance > 0 {
        sqlx::query("INSERT INTO inventory_projection(subject_id,place_id,quantity,last_fact_sequence,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(subject_id,place_id) DO UPDATE SET quantity=EXCLUDED.quantity,last_fact_sequence=EXCLUDED.last_fact_sequence,updated_at=now()")
            .bind(subject_id).bind(&place_id).bind(balance).bind(sequence).execute(&mut **tx).await?;
    } else {
        sqlx::query("DELETE FROM inventory_projection WHERE subject_id=$1 AND place_id=$2")
            .bind(subject_id)
            .bind(&place_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

pub async fn list_movements(pool: &PgPool, query: MovementQuery) -> Result<Value, AppError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query(r#"
SELECT m.movement_id,m.movement_group_id,m.subject_id,s.epc,sk.sku_code,m.quantity,m.from_place_id,m.to_place_id,m.cause,m.reference_type,m.reference_id,
       line.id allotment_line_id,COALESCE(line.allotment_id,legacy.id) allotment_id,line.destination_type,line.destination_id,m.actor_id,m.occurred_at,m.recorded_at
FROM movement m
JOIN inventory_subject s ON s.id=m.subject_id
LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN allotment_line line ON m.reference_type='ALLOTMENT_LINE' AND m.reference_id=line.id::text
LEFT JOIN allotment legacy ON m.reference_type='ALLOTMENT' AND m.reference_id=legacy.id::text
LEFT JOIN inventory_place fp ON fp.id=m.from_place_id
LEFT JOIN inventory_place tp ON tp.id=m.to_place_id
LEFT JOIN operational_pool fpool ON fpool.id=fp.pool_id
LEFT JOIN operational_pool tpool ON tpool.id=tp.pool_id
WHERE ($1::uuid IS NULL OR m.subject_id=$1)
  AND (
      $2::text IS NULL OR fpool.id=$2 OR tpool.id=$2
      OR EXISTS (
          SELECT 1 FROM operational_pool scope
          WHERE scope.id=$2 AND NOT scope.is_placement AND scope.outbound_stage IS NOT NULL
            AND ((fpool.is_placement AND fpool.outbound_stage=scope.outbound_stage)
              OR (tpool.is_placement AND tpool.outbound_stage=scope.outbound_stage))
      )
  )
ORDER BY m.occurred_at DESC,m.fact_sequence DESC LIMIT $3
"#)
        .bind(query.subject_id)
        .bind(query.pool_id)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let values: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "movement_id":row.get::<Uuid,_>("movement_id"),
                "movement_group_id":row.get::<Uuid,_>("movement_group_id"),
                "subject_id":row.get::<Uuid,_>("subject_id"),
                "epc":row.get::<Option<String>,_>("epc"),
                "sku_code":row.get::<Option<String>,_>("sku_code"),
                "quantity":row.get::<i64,_>("quantity"),
                "from":row.get::<String,_>("from_place_id"),
                "to":row.get::<String,_>("to_place_id"),
                "cause":row.get::<String,_>("cause"),
                "reference_type":row.get::<Option<String>,_>("reference_type"),
                "reference_id":row.get::<Option<String>,_>("reference_id"),
                "allotment_line_id":row.get::<Option<Uuid>,_>("allotment_line_id"),
                "allotment_id":row.get::<Option<Uuid>,_>("allotment_id"),
                "destination_type":row.get::<Option<String>,_>("destination_type"),
                "destination_id":row.get::<Option<String>,_>("destination_id"),
                "actor_id":row.get::<String,_>("actor_id"),
                "occurred_at":row.get::<chrono::DateTime<Utc>,_>("occurred_at"),
                "recorded_at":row.get::<chrono::DateTime<Utc>,_>("recorded_at")
            })
        })
        .collect();
    Ok(json!({"items": values, "limit": limit}))
}

pub fn parse_missing_id(value: &str) -> Result<(Uuid, String), AppError> {
    let (subject, pool) = value
        .split_once('@')
        .ok_or_else(|| AppError::Validation("missing id must be subject_uuid@pool_id".into()))?;
    let subject = Uuid::parse_str(subject)
        .map_err(|_| AppError::Validation("invalid missing subject id".into()))?;
    pool.parse::<retail_domain::OperationalPool>()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    Ok((subject, pool.to_owned()))
}

pub(super) fn movement_request_for_resolution(
    request: MissingResolutionRequest,
    subject_id: Uuid,
    quantity: i64,
    from: String,
    to: String,
    cause: &str,
) -> CreateMovementRequest {
    CreateMovementRequest {
        idempotency_key: request.idempotency_key,
        actor_id: request.actor_id,
        occurred_at: None,
        reason: request.reason,
        reference_type: request
            .reference
            .as_ref()
            .map(|_| "MISSING_RESOLUTION".into()),
        reference_id: request.reference,
        cause: Some(cause.into()),
        lines: vec![MovementLineRequest {
            subject_id: Some(subject_id),
            epc: None,
            quantity,
            from,
            to,
        }],
    }
}
