use super::sync::{inventory_dc_owner_tx, issue_command_tx};
use super::{
    apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest,
    resolve_subject,
};
use crate::cloud::{
    application::{AppError, CommandRequest, CountEntriesRequest, CreateCountRequest},
    domain::{
        validate_command, CountKind, CountStatus, MovementCause, MovementCommand, MovementGroupId,
        MovementLine, OperationalPool, Place, SubjectId, SystemPlace,
    },
};
use crate::sync::workflow::{
    OfficialCountActivationPayload, OfficialCountAdjustmentLine, OfficialCountAdjustmentPayload,
    OfficialCountResultLine, OfficialCountScope, INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1,
    INVENTORY_OFFICIAL_COUNT_ADJUST_V1, INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{collections::BTreeMap, str::FromStr};
use uuid::Uuid;

fn require_actor(actor_id: &str) -> Result<&str, AppError> {
    let actor_id = actor_id.trim();
    if actor_id.is_empty() {
        Err(AppError::Validation("actor_id is required".into()))
    } else {
        Ok(actor_id)
    }
}

fn normalize_epcs(epcs: &mut Vec<String>) -> Result<(), AppError> {
    for epc in epcs.iter_mut() {
        *epc = epc.trim().to_ascii_uppercase();
        if epc.is_empty() {
            return Err(AppError::Validation(
                "count scope EPC cannot be empty".into(),
            ));
        }
    }
    epcs.sort();
    epcs.dedup();
    Ok(())
}

pub async fn create_count(
    pool: &PgPool,
    mut request: CreateCountRequest,
) -> Result<Value, AppError> {
    let typed_pool = OperationalPool::from_str(request.pool_id.trim())
        .map_err(|error| AppError::Validation(error.to_string()))?;
    if typed_pool.id() != request.pool_id || typed_pool.site_id().as_str() != request.site_id {
        return Err(AppError::Validation(
            "count pool must be canonical and belong to site_id".into(),
        ));
    }
    request.reason = request.reason.trim().to_owned();
    request.actor_id = require_actor(&request.actor_id)?.to_owned();
    if request.reason.is_empty() {
        return Err(AppError::Validation("count reason is required".into()));
    }
    request.sku_ids.sort();
    request.sku_ids.dedup();
    normalize_epcs(&mut request.epcs)?;
    if matches!(request.kind, CountKind::Targeted)
        && request.sku_ids.is_empty()
        && request.epcs.is_empty()
    {
        return Err(AppError::Validation(
            "TARGETED official count requires SKU or EPC scope".into(),
        ));
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
        CountKind::Full => "FULL",
        CountKind::Cycle => "CYCLE",
        CountKind::Targeted => "TARGETED",
    };
    let scope = json!({"sku_ids":request.sku_ids,"epcs":request.epcs});
    sqlx::query(
        "INSERT INTO official_count
             (id,site_id,pool_id,kind,status,scope_json,reason,created_by)
         VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7)",
    )
    .bind(id)
    .bind(&request.site_id)
    .bind(&request.pool_id)
    .bind(kind)
    .bind(scope)
    .bind(&request.reason)
    .bind(&request.actor_id)
    .execute(&mut *tx)
    .await?;
    let response = json!({
        "id":id,"status":"DRAFT","kind":kind,
        "site_id":request.site_id,"pool_id":request.pool_id
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn activate_count(
    pool: &PgPool,
    count_id: Uuid,
    mut request: CommandRequest,
) -> Result<Value, AppError> {
    request.actor_id = require_actor(&request.actor_id)?.to_owned();
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
    let row = sqlx::query(
        "SELECT status,site_id,pool_id,kind,scope_json,reason,created_by,created_at
         FROM official_count WHERE id=$1 FOR UPDATE",
    )
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
    let kind: String = row.get("kind");
    let mut scope: OfficialCountScope = serde_json::from_value(row.get("scope_json"))?;
    scope.sku_ids.sort();
    scope.sku_ids.dedup();
    normalize_epcs(&mut scope.epcs)?;
    if kind == "TARGETED" && scope.sku_ids.is_empty() && scope.epcs.is_empty() {
        return Err(AppError::Validation(
            "TARGETED official count requires SKU or EPC scope".into(),
        ));
    }
    let sku_rows = if scope.sku_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query("SELECT id,sku_code FROM sku WHERE id=ANY($1) ORDER BY id")
            .bind(&scope.sku_ids)
            .fetch_all(&mut *tx)
            .await?
    };
    let sku_codes = sku_rows
        .into_iter()
        .map(|sku| (sku.get::<Uuid, _>("id"), sku.get::<String, _>("sku_code")))
        .collect::<BTreeMap<_, _>>();
    if sku_codes.len() != scope.sku_ids.len() {
        return Err(AppError::Validation(
            "every count scope sku_id must resolve to exactly one SKU".into(),
        ));
    }
    scope.sku_codes = scope
        .sku_ids
        .iter()
        .map(|sku_id| {
            sku_codes
                .get(sku_id)
                .cloned()
                .ok_or_else(|| AppError::Validation(format!("unknown count scope SKU {sku_id}")))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let site_id: String = row.get("site_id");
    let pool_id: String = row.get("pool_id");
    let owner = inventory_dc_owner_tx(&mut tx, &site_id).await?;
    let expected_subjects = if owner.is_none() {
        sqlx::query(
            r#"INSERT INTO count_snapshot(count_id,subject_id,expected_quantity,expected_place_id)
WITH d AS (
 SELECT subject_id,quantity delta FROM movement WHERE to_place_id=$2||':on_hand'
 UNION ALL SELECT subject_id,-quantity FROM movement WHERE from_place_id=$2||':on_hand'
), b AS (
 SELECT subject_id,SUM(delta)::bigint quantity FROM d GROUP BY subject_id HAVING SUM(delta)>0
)
SELECT $1,b.subject_id,b.quantity,$2||':on_hand'
FROM b JOIN inventory_subject subject ON subject.id=b.subject_id
WHERE (cardinality($3::uuid[])=0 OR subject.sku_id=ANY($3))
  AND (cardinality($4::text[])=0 OR subject.epc=ANY($4))"#,
        )
        .bind(count_id)
        .bind(&pool_id)
        .bind(&scope.sku_ids)
        .bind(&scope.epcs)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    } else {
        0
    };
    let activated_at = Utc::now();
    let mut activation_command_id = None;
    if let Some(target_origin_id) = owner.as_ref() {
        let payload = OfficialCountActivationPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            count_id,
            site_id: site_id.clone(),
            pool_id: pool_id.clone(),
            kind,
            reason: row.get("reason"),
            created_by: row.get("created_by"),
            created_at: row.get("created_at"),
            activated_at,
            scope,
        };
        payload.validate().map_err(AppError::Validation)?;
        activation_command_id = Some(
            issue_command_tx(
                &mut tx,
                INVENTORY_OFFICIAL_COUNT_ACTIVATE_V1,
                &serde_json::to_value(payload)?,
                &request.actor_id,
                None,
                std::slice::from_ref(target_origin_id),
            )
            .await?,
        );
    }
    sqlx::query(
        "UPDATE official_count SET status='ACTIVE',activated_at=$2,
                activation_command_id=$3,activation_target_origin_id=$4 WHERE id=$1",
    )
    .bind(count_id)
    .bind(activated_at)
    .bind(activation_command_id)
    .bind(owner.as_deref())
    .execute(&mut *tx)
    .await?;
    let response = json!({
        "id":count_id,
        "status":"ACTIVE",
        "expected_subjects":if owner.is_some() { Value::Null } else { json!(expected_subjects) },
        "expected_snapshot_at":if owner.is_some() { Value::Null } else { json!(activated_at) },
        "activation_command_id":activation_command_id,
        "activation_target_origin_id":owner,
        "execution_authority":if activation_command_id.is_some() { "EDGE_DC" } else { "CLOUD" }
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn add_count_entries(
    pool: &PgPool,
    count_id: Uuid,
    mut request: CountEntriesRequest,
) -> Result<Value, AppError> {
    request.actor_id = require_actor(&request.actor_id)?.to_owned();
    if request.entries.is_empty() {
        return Err(AppError::Validation("count entries cannot be empty".into()));
    }
    if request.entries.iter().any(|entry| entry.found_quantity < 0) {
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
    let count = sqlx::query(
        "SELECT status,activation_target_origin_id FROM official_count WHERE id=$1 FOR UPDATE",
    )
    .bind(count_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("official count".into()))?;
    if count
        .get::<Option<String>, _>("activation_target_origin_id")
        .is_some()
    {
        return Err(AppError::Conflict(
            "Edge-owned count entries must be recorded by the authoritative DC".into(),
        ));
    }
    let status = count.get::<String, _>("status");
    if status != "ACTIVE" {
        return Err(AppError::Conflict(format!(
            "count entries require ACTIVE status, currently {status}"
        )));
    }
    let mut subject_ids = Vec::new();
    for entry in &request.entries {
        let subject_id =
            resolve_subject(&mut tx, entry.subject_id, entry.epc.as_deref(), false).await?;
        sqlx::query(
            "INSERT INTO count_entry(count_id,subject_id,found_quantity,recorded_by)
             VALUES($1,$2,$3,$4)
             ON CONFLICT(count_id,subject_id) DO UPDATE SET
                 found_quantity=EXCLUDED.found_quantity,
                 recorded_by=EXCLUDED.recorded_by,recorded_at=now()",
        )
        .bind(count_id)
        .bind(subject_id)
        .bind(entry.found_quantity)
        .bind(&request.actor_id)
        .execute(&mut *tx)
        .await?;
        subject_ids.push(subject_id);
    }
    let response = json!({
        "id":count_id,"status":"ACTIVE",
        "entries_recorded":subject_ids.len(),"subject_ids":subject_ids
    });
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
    mut request: CommandRequest,
    command_type: &str,
    from: &str,
    to: &str,
    time_column: &str,
) -> Result<Value, AppError> {
    request.actor_id = require_actor(&request.actor_id)?.to_owned();
    let from_status = parse_status(from)?;
    let to_status = parse_status(to)?;
    crate::cloud::domain::validate_count_transition(from_status, to_status)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, command_type, &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let count = sqlx::query(
        "SELECT status,activation_target_origin_id FROM official_count WHERE id=$1 FOR UPDATE",
    )
    .bind(count_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("official count".into()))?;
    if count
        .get::<Option<String>, _>("activation_target_origin_id")
        .is_some()
    {
        return Err(AppError::Conflict(
            "Edge-owned count must be submitted by the authoritative DC".into(),
        ));
    }
    let status = count.get::<String, _>("status");
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
    mut request: CommandRequest,
) -> Result<Value, AppError> {
    request.actor_id = require_actor(&request.actor_id)?.to_owned();
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
    let count = sqlx::query(
        "SELECT status,site_id,pool_id,reason,activation_target_origin_id,
                edge_result_id,edge_adjustment_status
         FROM official_count WHERE id=$1 FOR UPDATE",
    )
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

    if let Some(target_origin_id) = count.get::<Option<String>, _>("activation_target_origin_id") {
        if count
            .get::<Option<String>, _>("edge_adjustment_status")
            .is_some()
        {
            return Err(AppError::Conflict(
                "Edge-owned count already has an adjustment outcome or pending command".into(),
            ));
        }
        let result_id = count
            .get::<Option<Uuid>, _>("edge_result_id")
            .ok_or_else(|| AppError::Conflict("Edge-owned count has no immutable result".into()))?;
        let result = sqlx::query(
            "SELECT lines FROM edge_official_count_result
             WHERE result_id=$1 AND count_id=$2 AND origin_id=$3 FOR KEY SHARE",
        )
        .bind(result_id)
        .bind(count_id)
        .bind(&target_origin_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::Conflict("Edge result fact is unavailable".into()))?;
        let result_lines: Vec<OfficialCountResultLine> =
            serde_json::from_value(result.get("lines"))?;
        let lines = result_lines
            .into_iter()
            .filter_map(|line| {
                let adjustment_quantity =
                    line.found_quantity.checked_sub(line.expected_quantity)?;
                (adjustment_quantity != 0).then_some(OfficialCountAdjustmentLine {
                    epc: line.epc,
                    sku_code: line.sku_code,
                    expected_quantity: line.expected_quantity,
                    found_quantity: line.found_quantity,
                    adjustment_quantity,
                })
            })
            .collect::<Vec<_>>();
        let adjustment_id = Uuid::new_v4();
        let payload = OfficialCountAdjustmentPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            adjustment_id,
            count_id,
            result_id,
            site_id: count.get("site_id"),
            pool_id: pool_id.clone(),
            approved_by: request.actor_id.clone(),
            approved_at: Utc::now(),
            lines,
        };
        payload.validate().map_err(AppError::Validation)?;
        let adjustment_command_id = issue_command_tx(
            &mut tx,
            INVENTORY_OFFICIAL_COUNT_ADJUST_V1,
            &serde_json::to_value(&payload)?,
            &request.actor_id,
            None,
            std::slice::from_ref(&target_origin_id),
        )
        .await?;
        let updated = sqlx::query(
            "UPDATE official_count
             SET adjustment_id=$2,adjustment_command_id=$3,
                 adjustment_target_origin_id=$4,edge_adjustment_status='PENDING'
             WHERE id=$1 AND status='REVIEW' AND edge_adjustment_status IS NULL",
        )
        .bind(count_id)
        .bind(adjustment_id)
        .bind(adjustment_command_id)
        .bind(&target_origin_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AppError::Conflict(
                "Official Count approval stopped being available".into(),
            ));
        }
        let response = json!({
            "id":count_id,
            "status":"REVIEW",
            "execution_authority":"EDGE_DC",
            "edge_adjustment_status":"PENDING",
            "adjustment_id":adjustment_id,
            "adjustment_command_id":adjustment_command_id,
            "adjustment_target_origin_id":target_origin_id,
            "summary":count_comparison_tx(&mut tx,count_id).await?
        });
        complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
        tx.commit().await?;
        return Ok(response);
    }

    let rows = sqlx::query(
        r#"SELECT COALESCE(snapshot.subject_id,entry.subject_id) subject_id,
                  COALESCE(snapshot.expected_quantity,0)::bigint expected,
                  COALESCE(entry.found_quantity,0)::bigint found
           FROM count_snapshot snapshot
           FULL OUTER JOIN count_entry entry
             ON entry.count_id=snapshot.count_id AND entry.subject_id=snapshot.subject_id
           WHERE COALESCE(snapshot.count_id,entry.count_id)=$1
           ORDER BY COALESCE(snapshot.subject_id,entry.subject_id)"#,
    )
    .bind(count_id)
    .fetch_all(&mut *tx)
    .await?;
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
                from: format!("{pool_id}:on_hand").parse().map_err(
                    |error: crate::cloud::domain::PlaceError| {
                        AppError::Validation(error.to_string())
                    },
                )?,
                to: format!("{pool_id}:missing").parse().map_err(
                    |error: crate::cloud::domain::PlaceError| {
                        AppError::Validation(error.to_string())
                    },
                )?,
            });
        } else if found > expected {
            gains.push(MovementLine {
                subject_id: SubjectId(subject_id),
                quantity: found - expected,
                from: Place::System {
                    place: SystemPlace::CountGain,
                },
                to: format!("{pool_id}:on_hand").parse().map_err(
                    |error: crate::cloud::domain::PlaceError| {
                        AppError::Validation(error.to_string())
                    },
                )?,
            });
        }
    }
    let shortage_subject_ids = shortages
        .iter()
        .map(|line| line.subject_id.0)
        .collect::<Vec<_>>();
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
        validate_command(&command).map_err(|error| AppError::Validation(error.to_string()))?;
        let key = format!("{}:shortage", request.idempotency_key);
        insert_group(&mut tx, &command, &key, &digest).await?;
        movement_count += apply_lines(&mut tx, &command, &key, &digest).await?.len();
        shortage_group_id = Some(command.movement_group_id.0);
        group_ids.push(command.movement_group_id.0);
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
        validate_command(&command).map_err(|error| AppError::Validation(error.to_string()))?;
        let key = format!("{}:gain", request.idempotency_key);
        insert_group(&mut tx, &command, &key, &digest).await?;
        movement_count += apply_lines(&mut tx, &command, &key, &digest).await?.len();
        group_ids.push(command.movement_group_id.0);
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
    sqlx::query(
        "UPDATE official_count SET status='CLOSED',closed_at=now(),
                approval_movement_group_id=$2 WHERE id=$1",
    )
    .bind(count_id)
    .bind(group_ids.first().copied())
    .execute(&mut *tx)
    .await?;
    let response = json!({
        "id":count_id,"status":"CLOSED","execution_authority":"CLOUD",
        "movement_group_ids":group_ids,"movement_count":movement_count,
        "allotment_shortage_event_count":allotment_shortage_event_count,
        "summary":count_comparison_tx(&mut tx,count_id).await?
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

async fn count_comparison_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    count_id: Uuid,
) -> Result<Value, AppError> {
    let owner = sqlx::query(
        "SELECT activation_target_origin_id,edge_result_id FROM official_count WHERE id=$1",
    )
    .bind(count_id)
    .fetch_one(&mut **tx)
    .await?;
    let row = if owner
        .get::<Option<String>, _>("activation_target_origin_id")
        .is_some()
    {
        sqlx::query(
            r#"SELECT COALESCE(SUM((line->>'expected_quantity')::bigint),0)::bigint expected,
                      COALESCE(SUM((line->>'found_quantity')::bigint),0)::bigint found,
                      COUNT(*) FILTER(WHERE (line->>'found_quantity')::bigint=(line->>'expected_quantity')::bigint)::bigint matches,
                      COUNT(*) FILTER(WHERE (line->>'found_quantity')::bigint<(line->>'expected_quantity')::bigint)::bigint shortages,
                      COUNT(*) FILTER(WHERE (line->>'found_quantity')::bigint>(line->>'expected_quantity')::bigint)::bigint gains
               FROM edge_official_count_result result
               CROSS JOIN LATERAL jsonb_array_elements(result.lines) line
               WHERE result.result_id=$1 AND result.count_id=$2"#,
        )
        .bind(owner.get::<Option<Uuid>, _>("edge_result_id"))
        .bind(count_id)
        .fetch_one(&mut **tx)
        .await?
    } else {
        sqlx::query(
            r#"SELECT COALESCE(SUM(expected),0)::bigint expected,
                      COALESCE(SUM(found),0)::bigint found,
                      COUNT(*) FILTER(WHERE found=expected)::bigint matches,
                      COUNT(*) FILTER(WHERE found<expected)::bigint shortages,
                      COUNT(*) FILTER(WHERE found>expected)::bigint gains
               FROM (
                 SELECT COALESCE(snapshot.expected_quantity,0)::bigint expected,
                        COALESCE(entry.found_quantity,0)::bigint found
                 FROM count_snapshot snapshot
                 FULL OUTER JOIN count_entry entry
                   ON entry.count_id=snapshot.count_id AND entry.subject_id=snapshot.subject_id
                 WHERE COALESCE(snapshot.count_id,entry.count_id)=$1
               ) comparison"#,
        )
        .bind(count_id)
        .fetch_one(&mut **tx)
        .await?
    };
    Ok(json!({
        "expected":row.get::<i64,_>("expected"),
        "found":row.get::<i64,_>("found"),
        "match_subjects":row.get::<i64,_>("matches"),
        "shortage_subjects":row.get::<i64,_>("shortages"),
        "gain_subjects":row.get::<i64,_>("gains")
    }))
}

pub async fn get_count(pool: &PgPool, count_id: Uuid) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT id,site_id,pool_id,kind,status,scope_json,reason,created_by,created_at,
                activated_at,submitted_at,closed_at,activation_command_id,
                activation_target_origin_id,edge_result_id,edge_result_received_at,
                adjustment_id,adjustment_command_id,adjustment_target_origin_id,
                edge_adjustment_status,edge_adjustment_completion_id,
                edge_adjustment_received_at
         FROM official_count WHERE id=$1",
    )
    .bind(count_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("official count".into()))?;
    let edge_owned = row
        .get::<Option<String>, _>("activation_target_origin_id")
        .is_some();
    let lines = if edge_owned {
        sqlx::query("SELECT lines FROM edge_official_count_result WHERE count_id=$1")
            .bind(count_id)
            .fetch_optional(pool)
            .await?
            .map(|result| result.get::<Value, _>("lines"))
            .unwrap_or_else(|| json!([]))
    } else {
        let rows = sqlx::query(
            r#"SELECT subject.id subject_id,subject.epc,sku.sku_code,
                      COALESCE(snapshot.expected_quantity,0)::bigint expected_quantity,
                      COALESCE(entry.found_quantity,0)::bigint found_quantity
               FROM count_snapshot snapshot
               FULL OUTER JOIN count_entry entry
                 ON entry.count_id=snapshot.count_id AND entry.subject_id=snapshot.subject_id
               JOIN inventory_subject subject
                 ON subject.id=COALESCE(snapshot.subject_id,entry.subject_id)
               JOIN sku ON sku.id=subject.sku_id
               WHERE COALESCE(snapshot.count_id,entry.count_id)=$1
               ORDER BY subject.epc"#,
        )
        .bind(count_id)
        .fetch_all(pool)
        .await?;
        Value::Array(
            rows.into_iter()
                .map(|line| {
                    json!({
                        "subject_id":line.get::<Uuid,_>("subject_id"),
                        "epc":line.get::<String,_>("epc"),
                        "sku_code":line.get::<String,_>("sku_code"),
                        "expected_quantity":line.get::<i64,_>("expected_quantity"),
                        "found_quantity":line.get::<i64,_>("found_quantity")
                    })
                })
                .collect(),
        )
    };
    let summary = {
        let mut tx = pool.begin().await?;
        let value = count_comparison_tx(&mut tx, count_id).await?;
        tx.commit().await?;
        value
    };
    Ok(json!({
        "id":row.get::<Uuid,_>("id"),
        "site_id":row.get::<String,_>("site_id"),
        "pool_id":row.get::<String,_>("pool_id"),
        "kind":row.get::<String,_>("kind"),
        "status":row.get::<String,_>("status"),
        "scope":row.get::<Value,_>("scope_json"),
        "reason":row.get::<String,_>("reason"),
        "created_by":row.get::<String,_>("created_by"),
        "created_at":row.get::<DateTime<Utc>,_>("created_at"),
        "activated_at":row.get::<Option<DateTime<Utc>>,_>("activated_at"),
        "submitted_at":row.get::<Option<DateTime<Utc>>,_>("submitted_at"),
        "closed_at":row.get::<Option<DateTime<Utc>>,_>("closed_at"),
        "execution_authority":if edge_owned { "EDGE_DC" } else { "CLOUD" },
        "comparison_authority":if edge_owned { "EDGE_RESULT_FACT" } else { "CLOUD_COUNT_RECORD" },
        "activation_command_id":row.get::<Option<Uuid>,_>("activation_command_id"),
        "activation_target_origin_id":row.get::<Option<String>,_>("activation_target_origin_id"),
        "edge_result_id":row.get::<Option<Uuid>,_>("edge_result_id"),
        "edge_result_received_at":row.get::<Option<DateTime<Utc>>,_>("edge_result_received_at"),
        "adjustment_id":row.get::<Option<Uuid>,_>("adjustment_id"),
        "adjustment_command_id":row.get::<Option<Uuid>,_>("adjustment_command_id"),
        "adjustment_target_origin_id":row.get::<Option<String>,_>("adjustment_target_origin_id"),
        "edge_adjustment_status":row.get::<Option<String>,_>("edge_adjustment_status"),
        "edge_adjustment_completion_id":row.get::<Option<Uuid>,_>("edge_adjustment_completion_id"),
        "edge_adjustment_received_at":row.get::<Option<DateTime<Utc>>,_>("edge_adjustment_received_at"),
        "summary":summary,
        "lines":lines
    }))
}

pub async fn list_counts(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query(
        r#"SELECT count.id,count.site_id,count.pool_id,count.kind,count.status,count.reason,
                  count.created_by,count.created_at,count.activated_at,count.submitted_at,
                  count.closed_at,count.activation_target_origin_id,count.edge_result_id,
                  count.adjustment_id,count.adjustment_command_id,count.edge_adjustment_status,
                  count.edge_adjustment_completion_id,
                  CASE WHEN count.activation_target_origin_id IS NULL
                       THEN (SELECT COALESCE(SUM(expected_quantity),0)::bigint
                             FROM count_snapshot WHERE count_id=count.id)
                       ELSE COALESCE(edge_summary.expected,0)::bigint END expected,
                  CASE WHEN count.activation_target_origin_id IS NULL
                       THEN (SELECT COALESCE(SUM(found_quantity),0)::bigint
                             FROM count_entry WHERE count_id=count.id)
                       ELSE COALESCE(edge_summary.found,0)::bigint END found
           FROM official_count count
           LEFT JOIN LATERAL (
             SELECT SUM((line->>'expected_quantity')::bigint)::bigint expected,
                    SUM((line->>'found_quantity')::bigint)::bigint found
             FROM edge_official_count_result result
             CROSS JOIN LATERAL jsonb_array_elements(result.lines) line
             WHERE result.count_id=count.id
           ) edge_summary ON TRUE
           ORDER BY count.created_at DESC LIMIT 200"#,
    )
    .fetch_all(pool)
    .await?;
    let items = rows
        .into_iter()
        .map(|row| {
            let edge_owned = row
                .get::<Option<String>, _>("activation_target_origin_id")
                .is_some();
            json!({
                "id":row.get::<Uuid,_>("id"),
                "site_id":row.get::<String,_>("site_id"),
                "pool_id":row.get::<String,_>("pool_id"),
                "kind":row.get::<String,_>("kind"),
                "status":row.get::<String,_>("status"),
                "reason":row.get::<String,_>("reason"),
                "created_by":row.get::<String,_>("created_by"),
                "created_at":row.get::<DateTime<Utc>,_>("created_at"),
                "activated_at":row.get::<Option<DateTime<Utc>>,_>("activated_at"),
                "submitted_at":row.get::<Option<DateTime<Utc>>,_>("submitted_at"),
                "closed_at":row.get::<Option<DateTime<Utc>>,_>("closed_at"),
                "expected":row.get::<i64,_>("expected"),
                "found":row.get::<i64,_>("found"),
                "execution_authority":if edge_owned { "EDGE_DC" } else { "CLOUD" },
                "comparison_authority":if edge_owned { "EDGE_RESULT_FACT" } else { "CLOUD_COUNT_RECORD" },
                "edge_result_id":row.get::<Option<Uuid>,_>("edge_result_id"),
                "adjustment_id":row.get::<Option<Uuid>,_>("adjustment_id"),
                "adjustment_command_id":row.get::<Option<Uuid>,_>("adjustment_command_id"),
                "edge_adjustment_status":row.get::<Option<String>,_>("edge_adjustment_status"),
                "edge_adjustment_completion_id":row.get::<Option<Uuid>,_>("edge_adjustment_completion_id")
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "active":items.iter().filter(|item| item["status"]=="ACTIVE").cloned().collect::<Vec<_>>(),
        "needs_review":items.iter().filter(|item| item["status"]=="REVIEW").cloned().collect::<Vec<_>>(),
        "history":items.iter().filter(|item| item["status"]=="CLOSED").cloned().collect::<Vec<_>>(),
        "drafts":items.iter().filter(|item| item["status"]=="DRAFT").cloned().collect::<Vec<_>>()
    }))
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
