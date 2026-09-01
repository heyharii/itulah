use super::sync::{inventory_dc_owner_tx, issue_command_tx};
use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use crate::cloud::{
    application::{
        AllotmentQuery, AppError, AvailabilityQuery, CancelAllotmentRequest,
        CreateAllotmentRequest, ExecuteAllotmentRequest,
    },
    domain::{
        derive_allotment_status, AllotmentType, DestinationType, InventoryState, MovementCause,
        MovementCommand, MovementGroupId, MovementLine, OperationalPool, Place, SiteId, SubjectId,
    },
};
use crate::edge::{OperationalPool as EdgeOperationalPool, SiteId as EdgeSiteId};
use crate::sync::workflow::{
    parse_allotment_cancellation, AllotmentActivationLine, AllotmentActivationPayload,
    AllotmentCancellationLine, AllotmentCancellationPayload, AllotmentCancellationResultLine,
    INVENTORY_ALLOTMENT_ACTIVATE_V1, INVENTORY_ALLOTMENT_CANCEL_V1,
    INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    str::FromStr,
};
use uuid::Uuid;

const DEFAULT_SOURCE_POOL_ID: &str = "dc.warehouse";

#[derive(Clone, Debug)]
pub(super) struct LineIdentity {
    pub(super) source_site_id: String,
    pub(super) source_pool_id: String,
    pub(super) destination_type: DestinationType,
    pub(super) destination_id: String,
    pub(super) sku_id: Uuid,
}

#[derive(Clone, Debug)]
struct NormalizedLine {
    identity: LineIdentity,
    quantity: i64,
}

struct CreateValidationContext {
    source_sites: HashMap<String, (String, String)>,
    destination_kinds: HashMap<String, String>,
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

    let validation = load_create_validation_context(&mut tx, &lines).await?;
    for line in &lines {
        validate_create_line(request.allotment_type, line, &validation)?;
    }
    let mut sku_ids: Vec<Uuid> = lines.iter().map(|line| line.identity.sku_id).collect();
    sku_ids.sort_unstable();
    sku_ids.dedup();
    lock_active_skus(&mut tx, &sku_ids).await?;
    let source_sites = lines
        .iter()
        .map(|line| line.identity.source_site_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    if source_sites.len() != 1 {
        return Err(AppError::Validation(
            "one Allotment must have exactly one source site".into(),
        ));
    }
    let source_site_id = source_sites
        .iter()
        .next()
        .cloned()
        .ok_or_else(|| AppError::Validation("allotment source site is required".into()))?;
    let activation_target_origin_id = if matches!(
        request.allotment_type,
        AllotmentType::ToStore | AllotmentType::ReturnToSupplier
    ) {
        inventory_dc_owner_tx(&mut tx, &source_site_id).await?
    } else {
        None
    };

    let allotment_id = Uuid::new_v4();
    let sequence = sqlx::query("SELECT nextval('allotment_number_sequence')::bigint sequence")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("sequence");
    let allotment_number = format!("ALT-{sequence:08}");
    let now = Utc::now();
    sqlx::query("INSERT INTO allotment(id,allotment_number,type,status,created_by,notes,idempotency_key,created_at,updated_at,activation_target_origin_id,edge_application_status) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$7,$8,CASE WHEN $8 IS NULL THEN NULL ELSE 'PENDING' END)")
        .bind(allotment_id)
        .bind(&allotment_number)
        .bind(request.allotment_type.as_str())
        .bind(request.actor_id.trim())
        .bind(request.notes.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(&request.idempotency_key)
        .bind(now)
        .bind(activation_target_origin_id.as_deref())
        .execute(&mut *tx)
        .await?;

    let mut response_lines = Vec::with_capacity(lines.len());
    for line in lines {
        let sku_code: String = sqlx::query("SELECT sku_code FROM sku WHERE id=$1")
            .bind(line.identity.sku_id)
            .fetch_one(&mut *tx)
            .await?
            .get("sku_code");
        let (normal_quantity, allotted_quantity) = if let Some(origin_id) =
            activation_target_origin_id.as_deref()
        {
            (
                edge_normal_balance_tx(
                    &mut tx,
                    origin_id,
                    &line.identity.source_pool_id,
                    &sku_code,
                )
                .await?,
                edge_active_allotment_tx(
                    &mut tx,
                    origin_id,
                    &line.identity.source_pool_id,
                    &sku_code,
                )
                .await?,
            )
        } else {
            (
                normal_balance_tx(&mut tx, &line.identity.source_pool_id, line.identity.sku_id)
                    .await?,
                active_allotment_tx(&mut tx, &line.identity.source_pool_id, line.identity.sku_id)
                    .await?,
            )
        };
        let on_hand_quantity = normal_quantity - allotted_quantity;
        if line.quantity > on_hand_quantity {
            return Err(AppError::Conflict(format!(
                "cannot allot SKU {} from {}: fact-derived available quantity {on_hand_quantity}, requested {}",
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
        if activation_target_origin_id.is_none() {
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
        }
        response_lines.push(json!({
            "id":line_id,
            "source_site_id":line.identity.source_site_id,
            "source_pool_id":line.identity.source_pool_id,
            "destination_type":line.identity.destination_type.as_str(),
            "destination_id":line.identity.destination_id,
            "sku_id":line.identity.sku_id,
            "sku_code":sku_code,
            "quantity":line.quantity,
            "accepted_quantity":if activation_target_origin_id.is_some() { 0 } else { line.quantity },
            "picked_quantity":0,
            "packed_quantity":0,
            "shipment_quantity":0,
            "dispatched_quantity":0,
            "in_transit_quantity":0,
            "received_quantity":0,
            "cancelled_quantity":0,
            "remaining_allotted":if activation_target_origin_id.is_some() { 0 } else { line.quantity },
            "on_hand_qty_before":on_hand_quantity,
            "on_hand_qty_after":on_hand_quantity-line.quantity
        }));
    }

    let total_quantity: i64 = response_lines
        .iter()
        .filter_map(|line| line["quantity"].as_i64())
        .sum();
    let mut activation_command_id = None;
    if let Some(target_origin_id) = activation_target_origin_id.as_ref() {
        let command_lines = response_lines
            .iter()
            .map(|line| {
                Ok(AllotmentActivationLine {
                    allotment_line_id: serde_json::from_value(line["id"].clone())?,
                    source_pool_id: line["source_pool_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    destination_type: line["destination_type"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    destination_id: line["destination_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    sku_id: serde_json::from_value(line["sku_id"].clone())?,
                    sku_code: line["sku_code"].as_str().unwrap_or_default().to_string(),
                    quantity: line["quantity"].as_i64().unwrap_or_default(),
                })
            })
            .collect::<Result<Vec<_>, serde_json::Error>>()?;
        let command_payload = AllotmentActivationPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            allotment_id,
            allotment_number: allotment_number.clone(),
            allotment_type: request.allotment_type.as_str().to_string(),
            status: "ACTIVE".into(),
            source_site_id: source_site_id.clone(),
            created_by: request.actor_id.trim().to_string(),
            notes: request.notes.clone(),
            created_at: now,
            lines: command_lines,
        };
        let payload = serde_json::to_value(command_payload)?;
        let command_id = issue_command_tx(
            &mut tx,
            INVENTORY_ALLOTMENT_ACTIVATE_V1,
            &payload,
            request.actor_id.trim(),
            None,
            std::slice::from_ref(target_origin_id),
        )
        .await?;
        sqlx::query("UPDATE allotment SET activation_command_id=$2 WHERE id=$1")
            .bind(allotment_id)
            .bind(command_id)
            .execute(&mut *tx)
            .await?;
        activation_command_id = Some(command_id);
    }

    let response = json!({
        "id":allotment_id,
        "allotment_number":allotment_number,
        "type":request.allotment_type.as_str(),
        "status":"ACTIVE",
        "total_quantity":total_quantity,
        "total_picked_quantity":0,
        "total_cancelled_quantity":0,
        "remaining_allotted":if activation_command_id.is_some() { 0 } else { total_quantity },
        "remaining_quantity":if activation_command_id.is_some() { 0 } else { total_quantity },
        "edge_application_status":if activation_command_id.is_some() { json!("PENDING") } else { Value::Null },
        "created_by":request.actor_id.trim(),
        "notes":request.notes,
        "created_at":now,
        "lines":response_lines,
        "activation_command_id":activation_command_id,
        "activation_target_origin_id":activation_target_origin_id,
        "execution_authority":if activation_command_id.is_some() { "EDGE_DC" } else { "CLOUD" },
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
    if let Some(target_origin_id) = header.get::<Option<String>, _>("activation_target_origin_id") {
        if header
            .get::<Option<String>, _>("edge_application_status")
            .as_deref()
            != Some("ACCEPTED")
        {
            return Err(AppError::Conflict(
                "Edge-owned Allotment must be accepted by its DC before cancellation".into(),
            ));
        }
        if header
            .get::<Option<Uuid>, _>("cancellation_command_id")
            .is_some()
            || header
                .get::<Option<String>, _>("edge_cancellation_status")
                .is_some()
        {
            return Err(AppError::Conflict(
                "Edge-owned Allotment already has a cancellation workflow".into(),
            ));
        }

        let lines = sqlx::query(
            "SELECT line.id,line.source_site_id,line.source_pool_id,line.destination_type,
                    line.destination_id,line.sku_id,progress.accepted_quantity,
                    progress.picked_quantity,progress.cancelled_quantity
             FROM allotment_line line
             JOIN edge_allotment_line_progress progress
               ON progress.allotment_line_id=line.id
              AND progress.allotment_id=line.allotment_id
              AND progress.origin_id=$2
             WHERE line.allotment_id=$1
             ORDER BY line.id FOR UPDATE OF line,progress",
        )
        .bind(allotment_id)
        .bind(&target_origin_id)
        .fetch_all(&mut *tx)
        .await?;
        let authored_count: i64 = sqlx::query(
            "SELECT count(*)::bigint AS count FROM allotment_line WHERE allotment_id=$1",
        )
        .bind(allotment_id)
        .fetch_one(&mut *tx)
        .await?
        .get("count");
        if lines.is_empty() || i64::try_from(lines.len()).ok() != Some(authored_count) {
            return Err(AppError::Conflict(
                "accepted Edge Allotment line projection is incomplete".into(),
            ));
        }

        let source_site_id = lines[0].get::<String, _>("source_site_id");
        let mut command_lines = Vec::with_capacity(lines.len());
        let mut accepted_total = 0_i64;
        let mut picked_total = 0_i64;
        let mut cancelled_total = 0_i64;
        for line in &lines {
            if line.get::<String, _>("source_site_id") != source_site_id {
                return Err(AppError::Conflict(
                    "Edge-owned Allotment spans more than one source site".into(),
                ));
            }
            let accepted = line.get::<i64, _>("accepted_quantity");
            if accepted <= 0 {
                return Err(AppError::Conflict(
                    "Edge-owned cancellation requires every line to be fully accepted".into(),
                ));
            }
            accepted_total = accepted_total
                .checked_add(accepted)
                .ok_or_else(|| AppError::Conflict("accepted quantity overflow".into()))?;
            picked_total = picked_total
                .checked_add(line.get::<i64, _>("picked_quantity"))
                .ok_or_else(|| AppError::Conflict("picked quantity overflow".into()))?;
            cancelled_total = cancelled_total
                .checked_add(line.get::<i64, _>("cancelled_quantity"))
                .ok_or_else(|| AppError::Conflict("cancelled quantity overflow".into()))?;
            command_lines.push(AllotmentCancellationLine {
                allotment_line_id: line.get("id"),
                quantity: accepted,
            });
        }
        let remaining = accepted_total
            .checked_sub(picked_total)
            .and_then(|quantity| quantity.checked_sub(cancelled_total))
            .filter(|quantity| *quantity >= 0)
            .ok_or_else(|| AppError::Conflict("invalid Edge reservation progress".into()))?;
        let cancellation_id = Uuid::new_v4();
        let requested_at = Utc::now();
        let command_payload = AllotmentCancellationPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            cancellation_id,
            allotment_id,
            source_site_id: source_site_id.clone(),
            reason: request.reason.trim().to_string(),
            requested_by: request.actor_id.trim().to_string(),
            requested_at,
            lines: command_lines,
        };
        let command_id = issue_command_tx(
            &mut tx,
            INVENTORY_ALLOTMENT_CANCEL_V1,
            &serde_json::to_value(&command_payload)?,
            request.actor_id.trim(),
            None,
            std::slice::from_ref(&target_origin_id),
        )
        .await?;
        sqlx::query(
            "UPDATE allotment
             SET cancellation_id=$2,cancellation_command_id=$3,
                 edge_cancellation_status='PENDING',updated_at=$4
             WHERE id=$1",
        )
        .bind(allotment_id)
        .bind(cancellation_id)
        .bind(command_id)
        .bind(requested_at)
        .execute(&mut *tx)
        .await?;
        let cancellation_reference = cancellation_id.to_string();
        for line in &lines {
            let line_id: Uuid = line.get("id");
            let accepted: i64 = line.get("accepted_quantity");
            let identity = line_identity_from_row(line)?;
            insert_allotment_event(
                &mut tx,
                &format!("edge-cancellation:{cancellation_id}:requested:{line_id}"),
                Some(allotment_id),
                Some(line_id),
                "ALLOTMENT_CANCELLATION_REQUESTED",
                Some(&identity),
                accepted,
                0,
                None,
                Some("ALLOTMENT_CANCELLATION"),
                Some(&cancellation_reference),
                request.actor_id.trim(),
                json!({
                    "reason": request.reason.trim(),
                    "cancellation_id": cancellation_id,
                    "cancellation_command_id": command_id,
                    "reservation_changed": false
                }),
                requested_at,
            )
            .await?;
        }

        let response = json!({
            "id":allotment_id,
            "allotment_number":header.get::<String,_>("allotment_number"),
            "type":header.get::<String,_>("type"),
            "status":header.get::<String,_>("status"),
            "cancellation_id":cancellation_id,
            "cancellation_command_id":command_id,
            "edge_cancellation_status":"PENDING",
            "requested_cancellation_quantity":accepted_total,
            "cancelled_quantity":cancelled_total,
            "blocked_picked_quantity":Value::Null,
            "remaining_quantity":remaining,
            "requested_at":requested_at,
            "cancellation":{
                "status":"PENDING",
                "reason":request.reason.trim(),
                "requested_by":request.actor_id.trim(),
                "lines":command_payload.lines
            },
            "inventory_effect":{
                "movement_count":0,
                "ledger_changed":false,
                "reservation_changed":false
            }
        });
        complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
        tx.commit().await?;
        return Ok(response);
    }

    let lines = sqlx::query("SELECT id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity,picked_quantity,cancelled_quantity FROM allotment_line WHERE allotment_id=$1 ORDER BY sku_id,source_pool_id,destination_type,destination_id FOR UPDATE")
        .bind(allotment_id)
        .fetch_all(&mut *tx)
        .await?;
    let now = Utc::now();
    let mut cancelled_total = 0_i64;
    for line in lines {
        let line_id: Uuid = line.get("id");
        let identity = line_identity_from_row(&line)?;
        let remaining = line.get::<i64, _>("quantity")
            - line.get::<i64, _>("picked_quantity")
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
    let totals = allotment_totals_tx(&mut tx, allotment_id).await?;
    let status = derive_allotment_status(totals.quantity, totals.picked, totals.cancelled)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    sqlx::query("UPDATE allotment SET status=$2,cancelled_at=$3,updated_at=$3 WHERE id=$1")
        .bind(allotment_id)
        .bind(status.as_str())
        .bind(now)
        .execute(&mut *tx)
        .await?;
    let response = json!({
        "id":allotment_id,
        "allotment_number":header.get::<String,_>("allotment_number"),
        "type":header.get::<String,_>("type"),
        "status":status.as_str(),
        "cancellation_status":"APPLIED",
        "edge_cancellation_status":Value::Null,
        "cancelled_quantity":cancelled_total,
        "total_cancelled_quantity":totals.cancelled,
        "remaining_quantity":totals.remaining(),
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
    if header
        .get::<Option<String>, _>("activation_target_origin_id")
        .is_some()
    {
        return Err(AppError::Conflict(
            "Edge-owned allotment must be picked by the authoritative DC".into(),
        ));
    }
    let line = sqlx::query("SELECT id,source_site_id,source_pool_id,destination_type,destination_id,sku_id,quantity,picked_quantity,cancelled_quantity FROM allotment_line WHERE id=$1 AND allotment_id=$2 FOR UPDATE")
        .bind(request.allotment_line_id)
        .bind(allotment_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment line belonging to header".into()))?;
    let identity = line_identity_from_row(&line)?;
    lock_active_skus(&mut tx, &[identity.sku_id]).await?;

    let quantity: i64 = line.get("quantity");
    let picked_quantity: i64 = line.get("picked_quantity");
    let cancelled_quantity: i64 = line.get("cancelled_quantity");
    let remaining = quantity - picked_quantity - cancelled_quantity;
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
    crate::cloud::domain::validate_command(&movement)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let movement_key = format!("{}:inventory", request.idempotency_key);
    insert_group(&mut tx, &movement, &movement_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &movement, &movement_key, &digest).await?;

    sqlx::query(
        "UPDATE allotment_line SET picked_quantity=picked_quantity+$2,updated_at=$3 WHERE id=$1",
    )
    .bind(request.allotment_line_id)
    .bind(request.quantity)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let totals = allotment_totals_tx(&mut tx, allotment_id).await?;
    let status = derive_allotment_status(totals.quantity, totals.picked, totals.cancelled)
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
            "{}:picked:{}",
            request.idempotency_key, request.allotment_line_id
        ),
        Some(allotment_id),
        Some(request.allotment_line_id),
        "ALLOTMENT_PICKED",
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
        "picked_quantity":request.quantity,
        "total_picked_quantity":totals.picked,
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
    let header = sqlx::query("SELECT id,allotment_number,type,status,created_by,notes,created_at,updated_at,cancelled_at,activation_command_id,activation_target_origin_id,edge_application_status,edge_application_result_id,edge_application_received_at,cancellation_id,cancellation_command_id,edge_cancellation_status,edge_cancellation_result_id,edge_cancellation_received_at FROM allotment WHERE id=$1")
        .bind(allotment_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    let cancellation_command = if let Some(command_id) =
        header.get::<Option<Uuid>, _>("cancellation_command_id")
    {
        let row = sqlx::query("SELECT command_type,payload FROM sync_command WHERE command_id=$1")
            .bind(command_id)
            .fetch_one(pool)
            .await?;
        if row.get::<String, _>("command_type") != INVENTORY_ALLOTMENT_CANCEL_V1 {
            return Err(AppError::Conflict(
                "Allotment cancellation command has the wrong type".into(),
            ));
        }
        Some(
            parse_allotment_cancellation(&row.get::<Value, _>("payload"))
                .map_err(AppError::Conflict)?,
        )
    } else {
        None
    };
    let cancellation_result =
        if let Some(result_id) = header.get::<Option<Uuid>, _>("edge_cancellation_result_id") {
            sqlx::query(
                "SELECT outcome,reason,lines,applied_at
             FROM edge_allotment_cancellation_result WHERE result_id=$1",
            )
            .bind(result_id)
            .fetch_optional(pool)
            .await?
        } else {
            None
        };
    let cancellation_result_lines = cancellation_result
        .as_ref()
        .map(|row| {
            serde_json::from_value::<Vec<AllotmentCancellationResultLine>>(
                row.get::<Value, _>("lines"),
            )
        })
        .transpose()?;
    let cancellation_requested_by_line = cancellation_command
        .as_ref()
        .map(|payload| {
            payload
                .lines
                .iter()
                .map(|line| (line.allotment_line_id, line.quantity))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let cancellation_result_by_line = cancellation_result_lines
        .as_ref()
        .map(|lines| {
            lines
                .iter()
                .map(|line| (line.allotment_line_id, line))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let lines = sqlx::query("SELECT l.id,l.source_site_id,l.source_pool_id,l.destination_type,l.destination_id,l.sku_id,sk.sku_code,ar.article_code,ar.name article_name,l.quantity,COALESCE(progress.accepted_quantity,CASE WHEN header.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)::bigint accepted_quantity,COALESCE(progress.picked_quantity,l.picked_quantity)::bigint picked_quantity,COALESCE(progress.packed_quantity,l.packed_quantity)::bigint packed_quantity,COALESCE(progress.shipment_quantity,l.shipment_quantity)::bigint shipment_quantity,COALESCE(progress.dispatched_quantity,l.dispatched_quantity)::bigint dispatched_quantity,COALESCE(progress.in_transit_quantity,l.in_transit_quantity)::bigint in_transit_quantity,COALESCE(progress.received_quantity,l.received_quantity)::bigint received_quantity,COALESCE(progress.cancelled_quantity,l.cancelled_quantity)::bigint cancelled_quantity,(COALESCE(progress.accepted_quantity,CASE WHEN header.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)-COALESCE(progress.picked_quantity,l.picked_quantity)-COALESCE(progress.cancelled_quantity,l.cancelled_quantity))::bigint remaining_allotted,l.created_at,l.updated_at FROM allotment_line l JOIN allotment header ON header.id=l.allotment_id JOIN sku sk ON sk.id=l.sku_id JOIN article ar ON ar.id=sk.article_id LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=l.id WHERE l.allotment_id=$1 ORDER BY l.source_pool_id,l.destination_type,l.destination_id,sk.sku_code")
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
    let received_rows = sqlx::query(
        "SELECT attribution.allotment_line_id,attribution.koli_id,
                attribution.epc,attribution.receipt_event_id,
                attribution.in_transit_event_id,attribution.matched_at,
                receipt.receipt_id,receipt.movement_group_id AS receipt_movement_group_id,
                receipt.occurred_at AS received_at,receipt.source_dc_id,
                receipt.destination_store_id,receipt.shipment_reference,
                receipt.sku_code,
                in_transit.movement_group_id AS in_transit_movement_group_id
         FROM edge_transfer_allotment_attribution attribution
         JOIN edge_transfer_claim receipt
           ON receipt.event_id=attribution.receipt_event_id
         JOIN edge_transfer_claim in_transit
           ON in_transit.event_id=attribution.in_transit_event_id
         WHERE attribution.allotment_id=$1
         ORDER BY attribution.allotment_line_id,attribution.epc",
    )
    .bind(allotment_id)
    .fetch_all(pool)
    .await?;
    let mut received_breakdown = BTreeMap::<Uuid, Vec<Value>>::new();
    for row in received_rows {
        received_breakdown
            .entry(row.get("allotment_line_id"))
            .or_default()
            .push(json!({
                "epc": row.get::<String, _>("epc"),
                "sku_code": row.get::<String, _>("sku_code"),
                "koli_id": row.get::<Uuid, _>("koli_id"),
                "source_dc_id": row.get::<Option<String>, _>("source_dc_id"),
                "destination_store_id": row.get::<String, _>("destination_store_id"),
                "shipment_reference": row.get::<Option<String>, _>("shipment_reference"),
                "receipt_id": row.get::<Option<Uuid>, _>("receipt_id"),
                "receipt_event_id": row.get::<Uuid, _>("receipt_event_id"),
                "in_transit_event_id": row.get::<Uuid, _>("in_transit_event_id"),
                "receipt_movement_group_id": row.get::<Uuid, _>("receipt_movement_group_id"),
                "in_transit_movement_group_id": row.get::<Uuid, _>("in_transit_movement_group_id"),
                "received_at": row.get::<DateTime<Utc>, _>("received_at"),
                "matched_at": row.get::<DateTime<Utc>, _>("matched_at"),
            }));
    }
    let line_values: Vec<Value> = lines
        .iter()
        .map(|row| {
            let line_id = row.get::<Uuid, _>("id");
            let received_quantity = row.get::<i64, _>("received_quantity");
            let breakdown = received_breakdown
                .get(&line_id)
                .cloned()
                .unwrap_or_default();
            let breakdown_quantity = i64::try_from(breakdown.len()).unwrap_or(i64::MAX);
            json!({
                "id":line_id,
                "source_site_id":row.get::<String,_>("source_site_id"),
                "source_pool_id":row.get::<String,_>("source_pool_id"),
                "destination_type":row.get::<String,_>("destination_type"),
                "destination_id":row.get::<String,_>("destination_id"),
                "sku_id":row.get::<Uuid,_>("sku_id"),
                "sku_code":row.get::<String,_>("sku_code"),
                "article_code":row.get::<String,_>("article_code"),
                "article_name":row.get::<String,_>("article_name"),
                "quantity":row.get::<i64,_>("quantity"),
                "accepted_quantity":row.get::<i64,_>("accepted_quantity"),
                "picked_quantity":row.get::<i64,_>("picked_quantity"),
                "packed_quantity":row.get::<i64,_>("packed_quantity"),
                "shipment_quantity":row.get::<i64,_>("shipment_quantity"),
                "dispatched_quantity":row.get::<i64,_>("dispatched_quantity"),
                "in_transit_quantity":row.get::<i64,_>("in_transit_quantity"),
                "received_quantity":received_quantity,
                "cancelled_quantity":row.get::<i64,_>("cancelled_quantity"),
                "remaining_allotted":row.get::<i64,_>("remaining_allotted"),
                "cancellation_requested_quantity":cancellation_requested_by_line.get(&line_id).copied(),
                "cancellation_actual_cancelled_quantity":cancellation_result_by_line.get(&line_id).map(|line| line.cancelled_quantity),
                "cancellation_blocked_picked_quantity":cancellation_result_by_line.get(&line_id).map(|line| line.blocked_picked_quantity),
                "received_breakdown_quantity": breakdown_quantity,
                "received_projection_consistent": received_quantity == breakdown_quantity,
                "received_breakdown": breakdown,
            })
        })
        .collect();
    let total_quantity: i64 = lines.iter().map(|row| row.get::<i64, _>("quantity")).sum();
    let total_accepted: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("accepted_quantity"))
        .sum();
    let total_picked: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("picked_quantity"))
        .sum();
    let total_packed: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("packed_quantity"))
        .sum();
    let total_shipment: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("shipment_quantity"))
        .sum();
    let total_dispatched: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("dispatched_quantity"))
        .sum();
    let total_in_transit: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("in_transit_quantity"))
        .sum();
    let total_received: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("received_quantity"))
        .sum();
    let total_cancelled: i64 = lines
        .iter()
        .map(|row| row.get::<i64, _>("cancelled_quantity"))
        .sum();
    let total_received_breakdown = received_breakdown
        .values()
        .try_fold(0_i64, |total, rows| {
            i64::try_from(rows.len())
                .ok()
                .and_then(|quantity| total.checked_add(quantity))
        })
        .ok_or_else(|| AppError::Conflict("received breakdown quantity overflow".into()))?;
    let cancellation_requested_total = cancellation_command
        .as_ref()
        .map(|payload| {
            payload
                .lines
                .iter()
                .try_fold(0_i64, |total, line| total.checked_add(line.quantity))
        })
        .unwrap_or(Some(0))
        .ok_or_else(|| AppError::Conflict("cancellation requested quantity overflow".into()))?;
    let cancellation_actual_total = cancellation_result_lines
        .as_ref()
        .map(|lines| {
            lines.iter().try_fold(0_i64, |total, line| {
                total.checked_add(line.cancelled_quantity)
            })
        })
        .unwrap_or(Some(0))
        .ok_or_else(|| AppError::Conflict("cancellation actual quantity overflow".into()))?;
    let cancellation_blocked_total = cancellation_result_lines
        .as_ref()
        .map(|lines| {
            lines.iter().try_fold(0_i64, |total, line| {
                total.checked_add(line.blocked_picked_quantity)
            })
        })
        .unwrap_or(Some(0))
        .ok_or_else(|| AppError::Conflict("cancellation blocked quantity overflow".into()))?;
    let cancellation_lines = if let Some(lines) = cancellation_result_lines.as_ref() {
        lines
            .iter()
            .map(|line| {
                json!({
                    "allotment_line_id":line.allotment_line_id,
                    "requested_quantity":line.requested_quantity,
                    "cancelled_quantity":line.cancelled_quantity,
                    "blocked_picked_quantity":line.blocked_picked_quantity
                })
            })
            .collect::<Vec<_>>()
    } else {
        cancellation_command
            .as_ref()
            .map(|payload| {
                payload
                    .lines
                    .iter()
                    .map(|line| {
                        json!({
                            "allotment_line_id":line.allotment_line_id,
                            "requested_quantity":line.quantity,
                            "cancelled_quantity":Value::Null,
                            "blocked_picked_quantity":Value::Null
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let cancellation = cancellation_command.as_ref().map(|payload| {
        json!({
            "cancellation_id":payload.cancellation_id,
            "command_id":header.get::<Option<Uuid>,_>("cancellation_command_id"),
            "status":header.get::<Option<String>,_>("edge_cancellation_status"),
            "result_id":header.get::<Option<Uuid>,_>("edge_cancellation_result_id"),
            "requested_by":payload.requested_by,
            "reason":payload.reason,
            "requested_at":payload.requested_at,
            "received_at":header.get::<Option<DateTime<Utc>>,_>("edge_cancellation_received_at"),
            "outcome":cancellation_result.as_ref().map(|row| row.get::<String,_>("outcome")),
            "result_reason":cancellation_result.as_ref().and_then(|row| row.get::<Option<String>,_>("reason")),
            "applied_at":cancellation_result.as_ref().map(|row| row.get::<DateTime<Utc>,_>("applied_at")),
            "requested_quantity":cancellation_requested_total,
            "cancelled_quantity":cancellation_result_lines.as_ref().map(|_| cancellation_actual_total),
            "blocked_picked_quantity":cancellation_result_lines.as_ref().map(|_| cancellation_blocked_total),
            "lines":cancellation_lines
        })
    });
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
        "activation_command_id":header.get::<Option<Uuid>,_>("activation_command_id"),
        "activation_target_origin_id":header.get::<Option<String>,_>("activation_target_origin_id"),
        "edge_application_status":header.get::<Option<String>,_>("edge_application_status"),
        "edge_application_result_id":header.get::<Option<Uuid>,_>("edge_application_result_id"),
        "edge_application_received_at":header.get::<Option<DateTime<Utc>>,_>("edge_application_received_at"),
        "cancellation_id":header.get::<Option<Uuid>,_>("cancellation_id"),
        "cancellation_command_id":header.get::<Option<Uuid>,_>("cancellation_command_id"),
        "edge_cancellation_status":header.get::<Option<String>,_>("edge_cancellation_status"),
        "edge_cancellation_result_id":header.get::<Option<Uuid>,_>("edge_cancellation_result_id"),
        "edge_cancellation_received_at":header.get::<Option<DateTime<Utc>>,_>("edge_cancellation_received_at"),
        "cancellation":cancellation,
        "total_quantity":total_quantity,
        "total_accepted_quantity":total_accepted,
        "total_picked_quantity":total_picked,
        "total_packed_quantity":total_packed,
        "total_shipment_quantity":total_shipment,
        "total_dispatched_quantity":total_dispatched,
        "total_in_transit_quantity":total_in_transit,
        "total_received_quantity":total_received,
        "total_received_breakdown_quantity":total_received_breakdown,
        "received_projection_consistent":total_received == total_received_breakdown,
        "total_cancelled_quantity":total_cancelled,
        "remaining_allotted":total_accepted-total_picked-total_cancelled,
        "remaining_quantity":total_accepted-total_picked-total_cancelled,
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
    let rows = sqlx::query("SELECT a.id,a.allotment_number,a.type,a.status,a.edge_cancellation_status,a.created_by,a.notes,a.created_at,a.updated_at,COALESCE(SUM(l.quantity),0)::bigint quantity,COALESCE(SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)),0)::bigint accepted,COALESCE(SUM(COALESCE(progress.picked_quantity,l.picked_quantity)),0)::bigint picked,COALESCE(SUM(COALESCE(progress.packed_quantity,l.packed_quantity)),0)::bigint packed,COALESCE(SUM(COALESCE(progress.shipment_quantity,l.shipment_quantity)),0)::bigint shipment,COALESCE(SUM(COALESCE(progress.dispatched_quantity,l.dispatched_quantity)),0)::bigint dispatched,COALESCE(SUM(COALESCE(progress.in_transit_quantity,l.in_transit_quantity)),0)::bigint in_transit,COALESCE(SUM(COALESCE(progress.received_quantity,l.received_quantity)),0)::bigint received,COALESCE(SUM(COALESCE(progress.cancelled_quantity,l.cancelled_quantity)),0)::bigint cancelled,COALESCE(SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)-COALESCE(progress.picked_quantity,l.picked_quantity)-COALESCE(progress.cancelled_quantity,l.cancelled_quantity)),0)::bigint remaining FROM allotment a LEFT JOIN allotment_line l ON l.allotment_id=a.id LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=l.id WHERE ($1::text IS NULL OR a.type=$1) AND ($2::text IS NULL OR a.status=$2) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM allotment_line source_line WHERE source_line.allotment_id=a.id AND source_line.source_pool_id=$3)) AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM allotment_line destination_line WHERE destination_line.allotment_id=a.id AND destination_line.destination_id=$4)) GROUP BY a.id ORDER BY a.created_at DESC LIMIT $5")
        .bind(allotment_type)
        .bind(status)
        .bind(query.source_pool_id.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(query.destination_id.as_deref().map(str::trim).filter(|value| !value.is_empty()))
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let destination_rows = sqlx::query("SELECT l.destination_type,l.destination_id,s.name destination_name,COALESCE(SUM(l.quantity),0)::bigint quantity,COALESCE(SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)),0)::bigint accepted,COALESCE(SUM(COALESCE(progress.picked_quantity,l.picked_quantity)),0)::bigint picked,COALESCE(SUM(COALESCE(progress.packed_quantity,l.packed_quantity)),0)::bigint packed,COALESCE(SUM(COALESCE(progress.shipment_quantity,l.shipment_quantity)),0)::bigint shipment,COALESCE(SUM(COALESCE(progress.dispatched_quantity,l.dispatched_quantity)),0)::bigint dispatched,COALESCE(SUM(COALESCE(progress.in_transit_quantity,l.in_transit_quantity)),0)::bigint in_transit,COALESCE(SUM(COALESCE(progress.received_quantity,l.received_quantity)),0)::bigint received,COALESCE(SUM(COALESCE(progress.cancelled_quantity,l.cancelled_quantity)),0)::bigint cancelled,COALESCE(SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)-COALESCE(progress.picked_quantity,l.picked_quantity)-COALESCE(progress.cancelled_quantity,l.cancelled_quantity)),0)::bigint remaining FROM allotment_line l JOIN allotment a ON a.id=l.allotment_id LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=l.id LEFT JOIN site s ON s.id=l.destination_id GROUP BY l.destination_type,l.destination_id,s.name ORDER BY l.destination_type,l.destination_id")
        .fetch_all(pool)
        .await?;
    let projection = get_availability(
        pool,
        AvailabilityQuery {
            at: None,
            source_pool_id: query.source_pool_id,
            cursor: None,
            q: None,
            limit: None,
            unbounded: true,
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
                "edge_cancellation_status":row.get::<Option<String>,_>("edge_cancellation_status"),
                "total_quantity":row.get::<i64,_>("quantity"),
                "total_accepted_quantity":row.get::<i64,_>("accepted"),
                "total_picked_quantity":row.get::<i64,_>("picked"),
                "total_packed_quantity":row.get::<i64,_>("packed"),
                "total_shipment_quantity":row.get::<i64,_>("shipment"),
                "total_dispatched_quantity":row.get::<i64,_>("dispatched"),
                "total_in_transit_quantity":row.get::<i64,_>("in_transit"),
                "total_received_quantity":row.get::<i64,_>("received"),
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
            "total_accepted_quantity":row.get::<i64,_>("accepted"),
            "total_picked_quantity":row.get::<i64,_>("picked"),
            "total_packed_quantity":row.get::<i64,_>("packed"),
            "total_shipment_quantity":row.get::<i64,_>("shipment"),
            "total_dispatched_quantity":row.get::<i64,_>("dispatched"),
            "total_in_transit_quantity":row.get::<i64,_>("in_transit"),
            "total_received_quantity":row.get::<i64,_>("received"),
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
    let rows = sqlx::query("SELECT l.sku_id,sk.sku_code,SUM(l.quantity)::bigint quantity,SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END))::bigint accepted,SUM(COALESCE(progress.picked_quantity,l.picked_quantity))::bigint picked,SUM(COALESCE(progress.packed_quantity,l.packed_quantity))::bigint packed,SUM(COALESCE(progress.shipment_quantity,l.shipment_quantity))::bigint shipment,SUM(COALESCE(progress.dispatched_quantity,l.dispatched_quantity))::bigint dispatched,SUM(COALESCE(progress.in_transit_quantity,l.in_transit_quantity))::bigint in_transit,SUM(COALESCE(progress.received_quantity,l.received_quantity))::bigint received,SUM(COALESCE(progress.cancelled_quantity,l.cancelled_quantity))::bigint cancelled,SUM(COALESCE(progress.accepted_quantity,CASE WHEN a.activation_target_origin_id IS NULL THEN l.quantity ELSE 0 END)-COALESCE(progress.picked_quantity,l.picked_quantity)-COALESCE(progress.cancelled_quantity,l.cancelled_quantity))::bigint remaining FROM allotment_line l JOIN allotment a ON a.id=l.allotment_id JOIN sku sk ON sk.id=l.sku_id LEFT JOIN edge_allotment_line_progress progress ON progress.allotment_line_id=l.id WHERE l.destination_type='STORE' AND l.destination_id=$1 GROUP BY l.sku_id,sk.sku_code ORDER BY sk.sku_code")
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
            "accepted_quantity":row.get::<i64,_>("accepted"),
            "picked_quantity":row.get::<i64,_>("picked"),
            "packed_quantity":row.get::<i64,_>("packed"),
            "shipment_quantity":row.get::<i64,_>("shipment"),
            "dispatched_quantity":row.get::<i64,_>("dispatched"),
            "in_transit_quantity":row.get::<i64,_>("in_transit"),
            "received_quantity":row.get::<i64,_>("received"),
            "cancelled_quantity":row.get::<i64,_>("cancelled"),
            "remaining_quantity":row.get::<i64,_>("remaining")
        }))
        .collect::<Vec<_>>());
    Ok(result)
}

pub async fn get_availability(pool: &PgPool, query: AvailabilityQuery) -> Result<Value, AppError> {
    let at = query.at.unwrap_or_else(Utc::now);
    let limit = if query.unbounded {
        i64::MAX
    } else {
        query.limit.unwrap_or(100).clamp(1, 500)
    };
    let fetch_limit = if query.unbounded { limit } else { limit + 1 };
    let cursor = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
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
-- What the article IS, carried alongside what there is of it. The screen that
-- promises goods to stores reads by article, not by SKU code, so the division,
-- the tags and the photograph have to arrive with the balances rather than in
-- a second read per row.
), article_tags AS (
    SELECT article_id,array_agg(tag_code ORDER BY tag_code) codes
    FROM article_tag GROUP BY article_id
-- Which orders this article has actually arrived on.
--
-- Joined on OUR article code rather than on `article.created_by_session_id`,
-- and the difference matters: that column records only the setup session that
-- first minted the article, so a second delivery of the same shirt on a later
-- order would still trace back to the first one. An article belongs to every
-- order that ever brought it in.
--
-- The order line's own `article_code` cannot be used for this at all — it is
-- the supplier's code, and two suppliers reuse each other's. The setup session
-- is the only place the supplier's string and ours are tied together, and it
-- is tied there by a human deciding what the goods are.
), article_orders AS (
    SELECT setup.article_code,
           array_agg(DISTINCT line.purchase_order_id) purchase_order_ids
    FROM article_setup_session setup
    JOIN goods_receipt_line receipt ON receipt.receipt_line_id=setup.receipt_line_id
    JOIN purchase_order_line line ON line.po_line_id=receipt.po_line_id
    GROUP BY setup.article_code
), availability_rows AS (
SELECT sku.id sku_id,sku.sku_code,article.id article_id,
       article.article_code,article.name article_name,
       article.division_code,article.image_url,
       COALESCE(tags.codes,ARRAY[]::text[]) tags,
       COALESCE(orders.purchase_order_ids,ARRAY[]::uuid[]) purchase_order_ids,
       sku.color colour,sku.size size,
       (COALESCE(ledger.normal_quantity,0)+COALESCE(ledger.missing_quantity,0))::bigint stock_quantity,
       COALESCE(allotted.allotted_quantity,0)::bigint allotted_quantity,
       (COALESCE(ledger.normal_quantity,0)-COALESCE(allotted.allotted_quantity,0))::bigint on_hand_quantity,
       COALESCE(ledger.missing_quantity,0)::bigint missing_quantity
FROM sku JOIN article ON article.id=sku.article_id
LEFT JOIN ledger_balance ledger ON ledger.sku_id=sku.id
LEFT JOIN allotted_balance allotted ON allotted.sku_id=sku.id
LEFT JOIN article_tags tags ON tags.article_id=article.id
LEFT JOIN article_orders orders ON orders.article_code=article.article_code
WHERE sku.active
  AND ($4::text IS NULL OR sku.sku_code ILIKE '%'||$4||'%'
       OR article.article_code ILIKE '%'||$4||'%'
       OR article.name ILIKE '%'||$4||'%')
), numbered AS (
SELECT availability_rows.*,
       COUNT(*) OVER()::bigint total_items,
       SUM(stock_quantity) OVER()::bigint total_stock_quantity,
       SUM(allotted_quantity) OVER()::bigint total_allotted_quantity,
       SUM(on_hand_quantity) OVER()::bigint total_on_hand_quantity,
       SUM(missing_quantity) OVER()::bigint total_missing_quantity
FROM availability_rows
)
SELECT * FROM numbered
WHERE ($3::text IS NULL OR sku_code > $3)
ORDER BY sku_code
LIMIT $5
"#)
        .bind(at)
        .bind(&source_pool_id)
        .bind(cursor)
        .bind(needle)
        .bind(fetch_limit)
        .fetch_all(pool)
        .await?;
    let has_more = !query.unbounded && rows.len() > limit as usize;
    let total_items = rows
        .first()
        .map(|row| row.get::<i64, _>("total_items"))
        .unwrap_or(0);
    let stock_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_stock_quantity"))
        .unwrap_or(0);
    let allotted_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_allotted_quantity"))
        .unwrap_or(0);
    let on_hand_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_on_hand_quantity"))
        .unwrap_or(0);
    let missing_qty = rows
        .first()
        .map(|row| row.get::<i64, _>("total_missing_quantity"))
        .unwrap_or(0);
    let items: Vec<Value> = rows
        .into_iter()
        .take(limit as usize)
        .map(|row| {
            json!({
                "sku_id":row.get::<Uuid,_>("sku_id"),
                "sku_code":row.get::<String,_>("sku_code"),
                "article_id":row.get::<Uuid,_>("article_id"),
                "article_code":row.get::<String,_>("article_code"),
                "article_name":row.get::<String,_>("article_name"),
                "division_code":row.get::<Option<String>,_>("division_code"),
                "image_url":row.get::<Option<String>,_>("image_url"),
                "tags":row.get::<Vec<String>,_>("tags"),
                "purchase_order_ids":row.get::<Vec<Uuid>,_>("purchase_order_ids"),
                "colour":row.get::<Option<String>,_>("colour"),
                "size":row.get::<Option<String>,_>("size"),
                "stock_qty":row.get::<i64,_>("stock_quantity"),
                "allotted_qty":row.get::<i64,_>("allotted_quantity"),
                "on_hand_qty":row.get::<i64,_>("on_hand_quantity"),
                "missing_qty":row.get::<i64,_>("missing_quantity")
            })
        })
        .collect();
    let next_cursor = has_more
        .then(|| {
            items
                .last()
                .and_then(|item| item["sku_code"].as_str())
                .map(str::to_owned)
        })
        .flatten();
    Ok(json!({
        "source_site_id":source.get::<String,_>("site_id"),
        "source_pool_id":source_pool_id,
        "source_pool_label":source.get::<String,_>("label"),
        "source_place_id":format!("{source_pool_id}:on_hand"),
        "as_of":at,
        "total_items":total_items,
        "stock_qty":stock_qty,
        "allotted_qty":allotted_qty,
        "on_hand_qty":on_hand_qty,
        "missing_qty":missing_qty,
        "inventory_equation":"Stock = On Hand + Allotted + Missing",
        "limit":limit,
        "next_cursor":next_cursor,
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

async fn load_create_validation_context(
    tx: &mut Transaction<'_, Postgres>,
    lines: &[NormalizedLine],
) -> Result<CreateValidationContext, AppError> {
    let pool_ids: Vec<String> = lines
        .iter()
        .map(|line| line.identity.source_pool_id.clone())
        .collect();
    let destination_ids: Vec<String> = lines
        .iter()
        .map(|line| line.identity.destination_id.clone())
        .collect();
    let source_sites = sqlx::query(
        "SELECT pool.id,pool.site_id,site.kind FROM operational_pool pool
         JOIN site ON site.id=pool.site_id
         WHERE pool.id=ANY($1) AND pool.active AND pool.is_placement",
    )
    .bind(&pool_ids)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| (row.get("id"), (row.get("site_id"), row.get("kind"))))
    .collect();
    let destination_kinds = sqlx::query("SELECT id,kind FROM site WHERE id=ANY($1)")
        .bind(&destination_ids)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| (row.get("id"), row.get("kind")))
        .collect();
    Ok(CreateValidationContext {
        source_sites,
        destination_kinds,
    })
}

fn validate_create_line(
    allotment_type: AllotmentType,
    line: &NormalizedLine,
    context: &CreateValidationContext,
) -> Result<(), AppError> {
    let (source_site_id, source_site_kind) = context
        .source_sites
        .get(&line.identity.source_pool_id)
        .ok_or_else(|| AppError::NotFound("active placement source pool/site pair".into()))?;
    if source_site_id != &line.identity.source_site_id {
        return Err(AppError::NotFound(
            "active placement source pool/site pair".into(),
        ));
    }
    match allotment_type {
        AllotmentType::ToStore => {
            let source_site = EdgeSiteId::new(&line.identity.source_site_id)
                .map_err(|error| AppError::Validation(error.to_string()))?;
            let source_pool = EdgeOperationalPool::from_str(&line.identity.source_pool_id)
                .map_err(|error| AppError::Validation(error.to_string()))?;
            if source_pool.id() != line.identity.source_pool_id
                || !source_pool.is_dc_fulfillment_source_for(&source_site)
                || line.identity.destination_type != DestinationType::Store
            {
                return Err(AppError::Validation(
                    "TO_STORE requires an allowed non-fulfillment DC source pool and a STORE destination".into(),
                ));
            }
            let destination = context
                .destination_kinds
                .get(&line.identity.destination_id)
                .ok_or_else(|| AppError::NotFound("destination store".into()))?;
            if destination != "STORE" {
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
        sqlx::query("SELECT id,allotment_number,type,status,activation_command_id,activation_target_origin_id,edge_application_status,cancellation_id,cancellation_command_id,edge_cancellation_status FROM allotment WHERE id=$1 FOR UPDATE")
            .bind(allotment_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    let status: String = row.get("status");
    if !matches!(status.as_str(), "ACTIVE" | "IN_PROGRESS") {
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
    let row = sqlx::query("SELECT COALESCE(SUM(quantity-picked_quantity-cancelled_quantity),0)::bigint quantity FROM allotment_line WHERE source_pool_id=$1 AND sku_id=$2")
        .bind(source_pool_id)
        .bind(sku_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.get("quantity"))
}

async fn edge_normal_balance_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    source_pool_id: &str,
    sku_code: &str,
) -> Result<i64, AppError> {
    let place_id = format!("{source_pool_id}:on_hand");
    let row = sqlx::query(
        "SELECT COALESCE(SUM(quantity),0)::bigint quantity
         FROM edge_inventory_fact_position
         WHERE origin_id=$1 AND place_id=$2 AND sku_code=$3",
    )
    .bind(origin_id)
    .bind(place_id)
    .bind(sku_code)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get("quantity"))
}

/// Reservations already accepted by DC plus exact commands issued but not yet
/// applied. Including pending plans prevents concurrent Cloud authors from
/// over-issuing against the same fact-derived availability.
async fn edge_active_allotment_tx(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    source_pool_id: &str,
    sku_code: &str,
) -> Result<i64, AppError> {
    let row = sqlx::query(
        "SELECT (
             SELECT COALESCE(SUM(accepted_quantity-picked_quantity-cancelled_quantity),0)::bigint
             FROM edge_allotment_line_progress
             WHERE origin_id=$1 AND source_pool_id=$2 AND sku_code=$3
         ) + (
             SELECT COALESCE(SUM(line.quantity),0)::bigint
             FROM allotment_line line
             JOIN allotment header ON header.id=line.allotment_id
             JOIN sku ON sku.id=line.sku_id
             WHERE header.activation_target_origin_id=$1
               AND header.edge_application_status='PENDING'
               AND line.source_pool_id=$2 AND sku.sku_code=$3
         ) AS quantity",
    )
    .bind(origin_id)
    .bind(source_pool_id)
    .bind(sku_code)
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
    let source: Place =
        source_place_id
            .parse()
            .map_err(|error: crate::cloud::domain::PlaceError| {
                AppError::Validation(error.to_string())
            })?;
    let destination: Place =
        destination_place_id
            .parse()
            .map_err(|error: crate::cloud::domain::PlaceError| {
                AppError::Validation(error.to_string())
            })?;
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
    picked: i64,
    cancelled: i64,
}

impl AllotmentTotals {
    fn remaining(&self) -> i64 {
        self.quantity - self.picked - self.cancelled
    }
}

async fn allotment_totals_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
) -> Result<AllotmentTotals, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(quantity),0)::bigint quantity,COALESCE(SUM(picked_quantity),0)::bigint picked,COALESCE(SUM(cancelled_quantity),0)::bigint cancelled FROM allotment_line WHERE allotment_id=$1")
        .bind(allotment_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(AllotmentTotals {
        quantity: row.get("quantity"),
        picked: row.get("picked"),
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
pub(super) async fn insert_allotment_event(
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
