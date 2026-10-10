use super::sync::{inventory_count_owner_tx, issue_command_tx};
use super::{
    apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest, rank_facets,
    resolve_subject, InventoryFacet,
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
use serde::{Deserialize, Serialize};
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
    // The pool's site is its row's, not its id's first segment.
    let pool_site = super::sites::pool_site_id(pool, &typed_pool.id()).await?;
    if typed_pool.id() != request.pool_id || pool_site.as_deref() != Some(request.site_id.as_str())
    {
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
    let owner = inventory_count_owner_tx(&mut tx, &site_id).await?;
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
        // A tag the node counted where its own ledger had nothing: the node
        // books it as a gain, and no node can see another's ledger. If the
        // facts say a different node still holds that very piece, approving
        // would put it on two shelves at once — the adjustment must equal the
        // submitted result, so the one place to stop it is here.
        let counted_in: Vec<String> = result_lines
            .iter()
            .filter(|line| line.expected_quantity == 0 && line.found_quantity > 0)
            .map(|line| line.epc.clone())
            .collect();
        if !counted_in.is_empty() {
            let held_elsewhere = sqlx::query(
                "SELECT epc,origin_id,place_id FROM edge_inventory_fact_position
                 WHERE epc = ANY($1) AND origin_id <> $2 AND quantity > 0
                   AND place_id LIKE '%:%'
                 ORDER BY epc,origin_id LIMIT 5",
            )
            .bind(&counted_in)
            .bind(&target_origin_id)
            .fetch_all(&mut *tx)
            .await?;
            if !held_elsewhere.is_empty() {
                let named = held_elsewhere
                    .iter()
                    .map(|row| {
                        format!(
                            "{} at {} ({})",
                            row.get::<String, _>("epc"),
                            row.get::<String, _>("origin_id"),
                            row.get::<String, _>("place_id")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(AppError::Conflict(format!(
                    "this count found pieces another node still holds, and approving would book them twice: {named}. Reject the count, or move the pieces first"
                )));
            }
        }
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
    // Counted over where this pool has the same piece missing: a find, not a
    // gain — a count closes an open Missing first (owner, 1 Oct 2026).
    let mut finds = Vec::new();
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
            let missing_here: i64 = sqlx::query(
                "SELECT COALESCE(SUM(pr.quantity),0)::bigint quantity
                 FROM inventory_projection pr
                 JOIN inventory_place ip ON ip.id=pr.place_id
                 WHERE pr.subject_id=$1 AND ip.pool_id=$2 AND ip.state='MISSING'",
            )
            .bind(subject_id)
            .bind(&pool_id)
            .fetch_one(&mut *tx)
            .await?
            .get("quantity");
            let over = found - expected;
            let find = over.min(missing_here);
            if find > 0 {
                finds.push(MovementLine {
                    subject_id: SubjectId(subject_id),
                    quantity: find,
                    from: format!("{pool_id}:missing").parse().map_err(
                        |error: crate::cloud::domain::PlaceError| {
                            AppError::Validation(error.to_string())
                        },
                    )?,
                    to: format!("{pool_id}:on_hand").parse().map_err(
                        |error: crate::cloud::domain::PlaceError| {
                            AppError::Validation(error.to_string())
                        },
                    )?,
                });
            }
            if over == find {
                continue;
            }
            gains.push(MovementLine {
                subject_id: SubjectId(subject_id),
                quantity: over - find,
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
    if !finds.is_empty() {
        let command = MovementCommand {
            movement_group_id: MovementGroupId::new(),
            lines: finds,
            cause: MovementCause::Found,
            reference_type: Some("OFFICIAL_COUNT".into()),
            reference_id: Some(count_id.to_string()),
            reason: format!("Approved count found what was missing: {reason}"),
            actor_id: request.actor_id.clone(),
            occurred_at: Utc::now(),
        };
        validate_command(&command).map_err(|error| AppError::Validation(error.to_string()))?;
        let key = format!("{}:found", request.idempotency_key);
        insert_group(&mut tx, &command, &key, &digest).await?;
        movement_count += apply_lines(&mut tx, &command, &key, &digest).await?.len();
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
    // Each line names its article, so a review reads as goods rather than codes.
    let mut lines = lines;
    if let Value::Array(items) = &mut lines {
        let codes: Vec<String> = items
            .iter()
            .filter_map(|line| {
                line.get("sku_code")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        let names: BTreeMap<String, String> = sqlx::query(
            "SELECT sku.sku_code, article.name FROM sku
             JOIN article ON article.id = sku.article_id
             WHERE sku.sku_code = ANY($1)",
        )
        .bind(&codes)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| (row.get("sku_code"), row.get("name")))
        .collect();
        for line in items.iter_mut() {
            let name = line
                .get("sku_code")
                .and_then(Value::as_str)
                .and_then(|code| names.get(code))
                .cloned();
            if let Value::Object(map) = line {
                map.insert("article_name".into(), json!(name));
            }
        }
    }
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

// ── the count list ───────────────────────────────────────────────────────
//
// The board this route used to answer with — four arrays, one per status —
// was a filter the server had already applied and could not be asked to
// change. It is an envelope now, like every other list here, and the four
// buckets are a facet: `statuses` says how many drafts and how many are in
// review, and `status=REVIEW` asks for them.

/// How many counts the list returns when the caller does not say.
const COUNT_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const COUNT_MAX_LIMIT: i64 = 500;

/// What a caller is asking the count list for.
#[derive(Clone, Debug, Default)]
pub struct CountScope {
    /// Free text over the pool id, the reason, and who opened it.
    pub needle: Option<String>,
    /// `DRAFT`, `ACTIVE`, `REVIEW` or `CLOSED`. An unknown value narrows to
    /// nothing rather than being dropped.
    pub status: Option<String>,
    /// The CENTRE's site id — `dc`, not an Edge node's `dc-01`. An official
    /// count is authored here even when an Edge executes it, so the row's
    /// `site_id` is always the centre's spelling.
    pub site_id: Option<String>,
    pub pool_id: Option<String>,
    pub kind: Option<String>,
    /// `created_at`, `pool`, `status`, `variance` or `closed_at`. Anything
    /// unrecognised is the house order — newest first.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// One official count, as the board reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CountRow {
    pub id: Uuid,
    pub site_id: String,
    pub pool_id: String,
    pub kind: String,
    pub status: String,
    pub reason: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub activated_at: Option<DateTime<Utc>>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub expected: i64,
    pub found: i64,
    /// `EDGE_DC` when an Edge node ran it, `CLOUD` when the centre did.
    pub execution_authority: String,
    pub comparison_authority: String,
    pub edge_result_id: Option<Uuid>,
    pub adjustment_id: Option<Uuid>,
    pub adjustment_command_id: Option<Uuid>,
    pub edge_adjustment_status: Option<String>,
    pub edge_adjustment_completion_id: Option<Uuid>,
}

/// What the count list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CountFacets {
    /// The four buckets the board used to be, as numbers somebody can click.
    pub statuses: Vec<InventoryFacet>,
    pub sites: Vec<InventoryFacet>,
    pub pools: Vec<InventoryFacet>,
    pub kinds: Vec<InventoryFacet>,
}

/// A page of counts, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CountPage {
    pub rows: Vec<CountRow>,
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: CountFacets,
}

#[derive(Serialize, Deserialize)]
struct CountCursor {
    count_id: Uuid,
}

/// One count row, defined once — for the page and for the facets.
///
/// Binds: `$1` the search pattern or NULL.
///
/// `expected` and `found` come from two places depending on who ran the count,
/// and that branch is the reason this is a constant rather than two queries: a
/// facet that counted rows one way while the page totalled them another would
/// agree on every ordinary day and part company on an Edge-executed count.
const COUNT_ROWS: &str = r#"
SELECT count.id,count.site_id,count.pool_id,count.kind,count.status,count.reason,
       count.created_by,count.created_at,count.activated_at,count.submitted_at,
       count.closed_at,count.activation_target_origin_id,count.edge_result_id,
       count.adjustment_id,count.adjustment_command_id,count.edge_adjustment_status,
       count.edge_adjustment_completion_id,
       pool.label pool_label,
       CASE WHEN count.activation_target_origin_id IS NULL
            THEN (SELECT COALESCE(SUM(expected_quantity),0)::bigint
                  FROM count_snapshot WHERE count_id=count.id)
            ELSE COALESCE(edge_summary.expected,0)::bigint END expected,
       CASE WHEN count.activation_target_origin_id IS NULL
            THEN (SELECT COALESCE(SUM(found_quantity),0)::bigint
                  FROM count_entry WHERE count_id=count.id)
            ELSE COALESCE(edge_summary.found,0)::bigint END found,
       ABS(CASE WHEN count.activation_target_origin_id IS NULL
                THEN (SELECT COALESCE(SUM(found_quantity),0)::bigint
                      FROM count_entry WHERE count_id=count.id)
                     - (SELECT COALESCE(SUM(expected_quantity),0)::bigint
                        FROM count_snapshot WHERE count_id=count.id)
                ELSE COALESCE(edge_summary.found,0)-COALESCE(edge_summary.expected,0)
           END)::bigint variance_key,
       -- A count still open has no closing moment. The sentinel keeps it out
       -- of a NULL a keyset cannot compare against, and puts the open ones
       -- first in ascending order, which is where somebody sorting by "closed"
       -- would look for them.
       COALESCE(count.closed_at,TIMESTAMPTZ '-infinity') closed_key
FROM official_count count
LEFT JOIN operational_pool pool ON pool.id=count.pool_id
LEFT JOIN LATERAL (
  SELECT SUM((line->>'expected_quantity')::bigint)::bigint expected,
         SUM((line->>'found_quantity')::bigint)::bigint found
  FROM edge_official_count_result result
  CROSS JOIN LATERAL jsonb_array_elements(result.lines) line
  WHERE result.count_id=count.id
) edge_summary ON TRUE
WHERE ($1::text IS NULL OR count.pool_id ILIKE $1 OR count.reason ILIKE $1
       OR count.created_by ILIKE $1 OR pool.label ILIKE $1)
"#;

/// The count list's filters, spelled once for the page and for the facets.
const COUNT_FILTERS: &str = "
     WHERE ($2::text IS NULL OR status=$2)
       AND ($3::text IS NULL OR site_id=$3)
       AND ($4::text IS NULL OR pool_id=$4)
       AND ($5::text IS NULL OR kind=$5)
";

fn count_row_from(row: &sqlx::postgres::PgRow) -> Result<CountRow, AppError> {
    let edge_owned = row
        .try_get::<Option<String>, _>("activation_target_origin_id")?
        .is_some();
    Ok(CountRow {
        id: row.try_get("id")?,
        site_id: row.try_get("site_id")?,
        pool_id: row.try_get("pool_id")?,
        kind: row.try_get("kind")?,
        status: row.try_get("status")?,
        reason: row.try_get("reason")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        activated_at: row.try_get("activated_at")?,
        submitted_at: row.try_get("submitted_at")?,
        closed_at: row.try_get("closed_at")?,
        expected: row.try_get("expected")?,
        found: row.try_get("found")?,
        execution_authority: if edge_owned { "EDGE_DC" } else { "CLOUD" }.into(),
        comparison_authority: if edge_owned {
            "EDGE_RESULT_FACT"
        } else {
            "CLOUD_COUNT_RECORD"
        }
        .into(),
        edge_result_id: row.try_get("edge_result_id")?,
        adjustment_id: row.try_get("adjustment_id")?,
        adjustment_command_id: row.try_get("adjustment_command_id")?,
        edge_adjustment_status: row.try_get("edge_adjustment_status")?,
        edge_adjustment_completion_id: row.try_get("edge_adjustment_completion_id")?,
    })
}

/// The counts: searched, filtered, sorted and paged by the server.
pub async fn counts_page(pool: &PgPool, scope: CountScope) -> Result<CountPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let limit = scope
        .limit
        .unwrap_or(COUNT_DEFAULT_LIMIT)
        .clamp(1, COUNT_MAX_LIMIT);
    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<CountCursor>)
        .transpose()?;

    // Every order ends in the count id, the primary key.
    let (lead, descending) = match scope.sort.as_deref() {
        Some("pool") => ("pool_id", scope.desc),
        Some("status") => ("status", scope.desc),
        Some("variance") => ("variance_key", scope.desc),
        Some("closed_at") => ("closed_key", scope.desc),
        // Newest first, as a board is read.
        _ => ("created_at", !scope.desc),
    };
    let (cols, order) = super::order_by(lead, "id", descending);
    let seek = if descending { "<" } else { ">" };

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({COUNT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {COUNT_FILTERS}
         )
         SELECT * FROM kept
          WHERE $6::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE id = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&scope.status)
        .bind(&scope.site_id)
        .bind(&scope.pool_id)
        .bind(&scope.kind)
        .bind(cursor.as_ref().map(|c| c.count_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&CountCursor {
            count_id: row.try_get("id")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(count_row_from)
        .collect::<Result<Vec<_>, AppError>>()?;

    let (total, facets) = count_facets(pool, &scope, needle.as_deref()).await?;
    Ok(CountPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many counts there are, and how they split.
async fn count_facets(
    pool: &PgPool,
    scope: &CountScope,
    needle: Option<&str>,
) -> Result<(i64, CountFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({COUNT_ROWS}), kept AS (
             SELECT * FROM searched {COUNT_FILTERS}
         )
         SELECT 'status' AS kind, status AS value, NULL::text AS l, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'site', site_id, NULL::text, COUNT(*)::bigint FROM searched GROUP BY site_id
          UNION ALL
         SELECT 'pool', pool_id, pool_label, COUNT(*)::bigint
           FROM searched GROUP BY pool_id, pool_label
          UNION ALL
         SELECT 'kind', kind, NULL::text, COUNT(*)::bigint FROM searched GROUP BY kind
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&scope.status)
        .bind(&scope.site_id)
        .bind(&scope.pool_id)
        .bind(&scope.kind)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = CountFacets {
        statuses: Vec::new(),
        sites: Vec::new(),
        pools: Vec::new(),
        kinds: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = InventoryFacet {
            value: row.try_get("value")?,
            label: row.try_get("l")?,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "status" => facets.statuses.push(facet),
            "site" => facets.sites.push(facet),
            "pool" => facets.pools.push(facet),
            "kind" => facets.kinds.push(facet),
            _ => total = facet.count,
        }
    }
    for list in [
        &mut facets.statuses,
        &mut facets.sites,
        &mut facets.pools,
        &mut facets.kinds,
    ] {
        rank_facets(list);
    }
    Ok((total, facets))
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
