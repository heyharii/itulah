//! Allotments the Gudang server holds (GUDANG-SERVER-PLAN.md §0, step 4).
//!
//! Once the pen has moved — `INVENTORY_DC_HOSTING` off, a DC node owning head
//! office's site — Central keeps a read copy of the Gudang's allotments and
//! writes none of them itself. Three things live here:
//!
//! - [`forward_amend_tx`]: MD's edit made at Central, forwarded to the server
//!   as `inventory.allotment.amend.v1`. Nothing of the allotment changes here;
//!   the request waits, PENDING ("waiting for the Gudang"), for the answer.
//! - [`apply_allotment_amended`]: the server's answer, or an edit MD made on
//!   the server itself. The only writer of this copy's amendments.
//! - [`apply_allotment_created`]: an allotment MD raised on the server.
//!
//! While Central hosts the Gudang no allotment carries an
//! `activation_target_origin_id`, so none of this is reached and the hosted
//! path (`allotment_amend`, `allotments`) is exactly as it was.

use super::allotment_amend::{AmendAllotmentRequest, AmendAllotmentResult};
use super::allotments::{
    insert_allotment_event, line_identity_from_row, validate_added_lines_tx, LineIdentity,
};
use super::sync::{
    canonical_site_id_tx, inventory_owner_tx, issue_command_tx, node_site_id_tx, origin_site_id_tx,
    origin_takes_tx, pool_id_for_site,
};
use crate::cloud::application::AppError;
use crate::cloud::domain::flow::Actor;
use crate::cloud::domain::{AllotmentStatus, AllotmentType, DestinationType, FulfillmentStatus};
use crate::sync::workflow::{
    AllotmentActivationLine, AllotmentActivationPayload, AllotmentAmendPayload,
    AllotmentAmendTarget, AllotmentAmendedPayload, AmendmentOutcome, ALLOTMENT_AMEND_CAPABILITY,
    INVENTORY_ALLOTMENT_AMENDED_V1, INVENTORY_ALLOTMENT_AMEND_V1, INVENTORY_ALLOTMENT_CREATED_V1,
    INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::{postgres::PgRow, Postgres, Row, Transaction};
use std::collections::{BTreeSet, HashMap};
use std::str::FromStr;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// The outside road: forward MD's edit
// ---------------------------------------------------------------------------

/// MD's edit of an allotment `origin_id` holds, forwarded and left waiting.
///
/// Called from `allotment_amend::amend_allotment` once the header is locked
/// and the request is known to be well formed, and before anything there is
/// written. Added lines are checked here as a new allotment's are (route,
/// destination, SKU still sold) and given their ids, so this copy and the
/// server name them the same; whether the stock is free is the server's to
/// say, because only it knows.
pub(super) async fn forward_amend_tx(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
    header: &PgRow,
    origin_id: &str,
    request: &AmendAllotmentRequest,
    reason: Option<&str>,
    actor: &Actor,
) -> Result<AmendAllotmentResult, AppError> {
    let actor_id = actor.id.trim();
    if header
        .get::<Option<String>, _>("edge_application_status")
        .as_deref()
        != Some("ACCEPTED")
    {
        return Err(AppError::Conflict(
            "This allotment is still waiting for the Gudang to take it; change it once it has."
                .into(),
        ));
    }
    if header
        .get::<Option<String>, _>("edge_cancellation_status")
        .is_some()
    {
        return Err(AppError::Conflict("This allotment is cancelled.".into()));
    }
    if !origin_takes_tx(tx, origin_id, ALLOTMENT_AMEND_CAPABILITY).await? {
        return Err(AppError::Conflict(
            "The Gudang server runs a build that cannot take an edit from here yet; update it, or change the allotment on the server at HO."
                .into(),
        ));
    }
    let waiting: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM allotment_amendment_request
                         WHERE allotment_id = $1 AND status = 'PENDING')",
    )
    .bind(allotment_id)
    .fetch_one(&mut **tx)
    .await?;
    if waiting {
        return Err(AppError::Conflict(
            "An earlier change to this allotment is still waiting for the Gudang.".into(),
        ));
    }

    let standing = sqlx::query(
        "SELECT line.id, line.source_site_id, line.source_pool_id, line.destination_type,
                line.destination_id, line.sku_id
           FROM allotment_line line WHERE line.allotment_id = $1 ORDER BY line.id",
    )
    .bind(allotment_id)
    .fetch_all(&mut **tx)
    .await?;
    let first = standing
        .first()
        .ok_or_else(|| AppError::Conflict("an allotment with no lines cannot be changed".into()))?;
    let first = line_identity_from_row(first)?;
    let known: BTreeSet<Uuid> = standing
        .iter()
        .map(|row| row.get::<Uuid, _>("id"))
        .collect();
    for line in &request.lines {
        if !known.contains(&line.allotment_line_id) {
            return Err(AppError::NotFound(format!(
                "allotment line {} on this allotment",
                line.allotment_line_id
            )));
        }
    }

    // What the server calls itself: every name on the wire is respelled.
    let owner_site = origin_site_id_tx(tx, origin_id).await?;
    let mut add = Vec::with_capacity(request.add.len());
    if !request.add.is_empty() {
        let stored_type: String = header.get("type");
        let allotment_type = AllotmentType::from_str(&stored_type)
            .map_err(|_| AppError::Conflict(format!("allotment type {stored_type} is unknown")))?;
        if allotment_type != AllotmentType::ToSite {
            return Err(AppError::Conflict(
                "only an allotment to stores takes new lines; a return goes where it goes".into(),
            ));
        }
        let mut wanted = Vec::with_capacity(request.add.len());
        for line in &request.add {
            let destination_id = line.destination_id.trim().to_ascii_lowercase();
            let source_pool_id = match line
                .source_pool_id
                .as_deref()
                .map(str::trim)
                .filter(|pool| !pool.is_empty())
            {
                Some(pool) => pool.to_ascii_lowercase(),
                None => standing
                    .iter()
                    .find(|row| row.get::<Uuid, _>("sku_id") == line.sku_id)
                    .map(|row| row.get::<String, _>("source_pool_id"))
                    .unwrap_or_else(|| first.source_pool_id.clone()),
            };
            wanted.push((
                LineIdentity {
                    source_site_id: first.source_site_id.clone(),
                    source_pool_id,
                    destination_type: DestinationType::Site,
                    destination_id,
                    sku_id: line.sku_id,
                },
                line.quantity,
            ));
        }
        let wanted = validate_added_lines_tx(tx, allotment_type, wanted).await?;
        let skus: Vec<Uuid> = wanted.iter().map(|(identity, _)| identity.sku_id).collect();
        let codes: HashMap<Uuid, String> =
            sqlx::query("SELECT id, sku_code FROM sku WHERE id = ANY($1) AND active")
                .bind(&skus)
                .fetch_all(&mut **tx)
                .await?
                .into_iter()
                .map(|row| (row.get("id"), row.get("sku_code")))
                .collect();
        for (identity, quantity) in wanted {
            let sku_code = codes
                .get(&identity.sku_id)
                .cloned()
                .ok_or_else(|| AppError::Validation("only an active SKU can be allotted".into()))?;
            add.push(AllotmentActivationLine {
                allotment_line_id: Uuid::new_v4(),
                source_pool_id: pool_id_for_site(&identity.source_pool_id, &owner_site),
                destination_type: identity.destination_type.as_str().to_owned(),
                destination_id: node_site_id_tx(tx, &identity.destination_id).await?,
                sku_id: identity.sku_id,
                sku_code: sku_code.to_ascii_uppercase(),
                quantity,
            });
        }
    }

    let request_id = Uuid::new_v4();
    let requested_at = Utc::now();
    let payload = AllotmentAmendPayload {
        schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
        amendment_request_id: request_id,
        allotment_id,
        source_site_id: owner_site,
        reason: reason.map(str::to_owned),
        requested_by: actor_id.to_owned(),
        requested_at,
        move_only: request.move_only,
        lines: request
            .lines
            .iter()
            .map(|line| AllotmentAmendTarget {
                allotment_line_id: line.allotment_line_id,
                to: line.to,
            })
            .collect(),
        add,
    };
    let command_id = issue_command_tx(
        tx,
        INVENTORY_ALLOTMENT_AMEND_V1,
        &serde_json::to_value(&payload)?,
        actor_id,
        None,
        &[origin_id.to_owned()],
    )
    .await?;
    sqlx::query(
        "INSERT INTO allotment_amendment_request
             (id, allotment_id, origin_id, command_id, status, request, requested_by,
              requested_at, idempotency_key)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8)",
    )
    .bind(request_id)
    .bind(allotment_id)
    .bind(origin_id)
    .bind(command_id)
    .bind(serde_json::to_value(request)?)
    .bind(actor_id)
    .bind(requested_at)
    .bind(&request.idempotency_key)
    .execute(&mut **tx)
    .await?;
    Ok(AmendAllotmentResult {
        id: allotment_id,
        allotment_number: header.get("allotment_number"),
        lines: Vec::new(),
        released_total: 0,
        owed_total: 0,
        added: Vec::new(),
        edge_amendment_status: Some("PENDING".into()),
        amendment_request_id: Some(request_id),
    })
}

// ---------------------------------------------------------------------------
// The server's facts
// ---------------------------------------------------------------------------

/// Keep the fact by its id; `false` when it was already applied.
#[allow(clippy::too_many_arguments)]
async fn receipt(
    tx: &mut Transaction<'_, Postgres>,
    event_id: Uuid,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_type: &str,
    allotment_id: Uuid,
    outcome: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query(
        "INSERT INTO edge_allotment_amended_fact
             (event_id, origin_id, generation, seq, event_type, allotment_id, outcome)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO NOTHING",
    )
    .bind(event_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(event_type)
    .bind(allotment_id)
    .bind(outcome)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1)
}

/// The header follows the commitment view, as an edit at Central leaves it;
/// a cancel with nothing sent is stamped cancelled.
async fn refresh_header(
    tx: &mut Transaction<'_, Postgres>,
    allotment_id: Uuid,
    cancelled_at: Option<DateTime<Utc>>,
    at: DateTime<Utc>,
) -> Result<(), AppError> {
    let stored: String =
        sqlx::query_scalar("SELECT status FROM allotment_commitment WHERE allotment_id = $1")
            .bind(allotment_id)
            .fetch_one(&mut **tx)
            .await?;
    let status = AllotmentStatus::from(FulfillmentStatus::from_legacy(&stored));
    // A final header is immutable (0005); a late fact leaves it as it is.
    sqlx::query(
        "UPDATE allotment SET status = $2, cancelled_at = COALESCE($3, cancelled_at),
                updated_at = $4
          WHERE id = $1 AND status NOT IN ('EXECUTED', 'CANCELLED')",
    )
    .bind(allotment_id)
    .bind(status.as_str())
    // A cancelled header carries its time (0004's CHECK).
    .bind((status.as_str() == "CANCELLED").then(|| cancelled_at.unwrap_or(at)))
    .bind(at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// `inventory.allotment.amended.v1`: what the Gudang server did with an edit
/// or cancel, whichever road it came by.
pub(super) async fn apply_allotment_amended(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    fact: &AllotmentAmendedPayload,
) -> Result<(), AppError> {
    if event_id != fact.result_id {
        return Err(AppError::Validation(
            "allotment amendment result_id must equal event_id".into(),
        ));
    }
    let outcome = match fact.outcome {
        AmendmentOutcome::Applied => "APPLIED",
        AmendmentOutcome::Rejected => "REJECTED",
    };
    if !receipt(
        tx,
        event_id,
        origin_id,
        generation,
        seq,
        INVENTORY_ALLOTMENT_AMENDED_V1,
        fact.allotment_id,
        outcome,
    )
    .await?
    {
        return Ok(());
    }
    let holder: Option<String> = sqlx::query_scalar(
        "SELECT activation_target_origin_id FROM allotment WHERE id = $1 FOR UPDATE",
    )
    .bind(fact.allotment_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("allotment {}", fact.allotment_id)))?;
    if holder.as_deref() != Some(origin_id) {
        return Err(AppError::Validation(format!(
            "allotment {} is not held by {origin_id}",
            fact.allotment_id
        )));
    }
    if let Some(request_id) = fact.amendment_request_id {
        // The answer to MD's request: "waiting for the Gudang" ends here.
        sqlx::query(
            "UPDATE allotment_amendment_request
                SET status = $3, refusal = $4, result_event_id = $5, answered_at = $6
              WHERE id = $1 AND allotment_id = $2 AND status = 'PENDING'",
        )
        .bind(request_id)
        .bind(fact.allotment_id)
        .bind(outcome)
        .bind(fact.refusal.as_deref())
        .bind(event_id)
        .bind(fact.applied_at)
        .execute(&mut **tx)
        .await?;
    }
    if fact.outcome == AmendmentOutcome::Rejected {
        return Ok(());
    }

    // Lines the server added, in this copy's spelling: the allotment's own
    // source site, the pool respelled onto it, the shop as the centre names it.
    let source_site: String = sqlx::query_scalar(
        "SELECT source_site_id FROM allotment_line WHERE allotment_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(fact.allotment_id)
    .fetch_one(&mut **tx)
    .await?;
    let mut new_lines = BTreeSet::new();
    for line in &fact.added {
        let destination_id = canonical_site_id_tx(tx, &line.destination_id).await?;
        let destination_type = DestinationType::from_str(&line.destination_type)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        let source_pool_id = pool_id_for_site(&line.source_pool_id, &source_site);
        sqlx::query(
            "INSERT INTO allotment_line
                 (id, allotment_id, source_site_id, source_pool_id, destination_type,
                  destination_id, sku_id, quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(line.allotment_line_id)
        .bind(fact.allotment_id)
        .bind(&source_site)
        .bind(&source_pool_id)
        .bind(destination_type.as_str())
        .bind(&destination_id)
        .bind(line.sku_id)
        .bind(line.quantity)
        .execute(&mut **tx)
        .await?;
        insert_progress(
            tx,
            line.allotment_line_id,
            fact.allotment_id,
            origin_id,
            &source_site,
            &source_pool_id,
            destination_type.as_str(),
            &destination_id,
            &line.sku_code,
            line.quantity,
            generation,
            seq,
        )
        .await?;
        new_lines.insert(line.allotment_line_id);
    }

    for line in &fact.lines {
        let row = sqlx::query(
            "SELECT id, source_site_id, source_pool_id, destination_type, destination_id, sku_id
               FROM allotment_line WHERE id = $1 AND allotment_id = $2 FOR UPDATE",
        )
        .bind(line.allotment_line_id)
        .bind(fact.allotment_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("allotment line {}", line.allotment_line_id)))?;
        let identity = line_identity_from_row(&row)?;
        let raised = (line.target_after - line.target_before).max(0);
        if line.kind == "ADD" && raised > 0 && !new_lines.contains(&line.allotment_line_id) {
            // A promise made later rises; it never falls (0939).
            sqlx::query(
                "UPDATE allotment_line SET quantity = quantity + $2, updated_at = $3 WHERE id = $1",
            )
            .bind(line.allotment_line_id)
            .bind(raised)
            .bind(fact.applied_at)
            .execute(&mut **tx)
            .await?;
            sqlx::query(
                "UPDATE edge_allotment_line_progress
                    SET planned_quantity = planned_quantity + $2,
                        accepted_quantity = accepted_quantity + $2,
                        last_generation = $3, last_seq = $4, updated_at = now()
                  WHERE allotment_line_id = $1",
            )
            .bind(line.allotment_line_id)
            .bind(raised)
            .bind(generation)
            .bind(seq)
            .execute(&mut **tx)
            .await?;
        }
        if line.cancelled_now > 0 {
            // What the server wrote off the line's demand at once. Pieces it
            // owes back out of cartons are written there as the carton opens.
            sqlx::query(
                "UPDATE edge_allotment_line_progress
                    SET cancelled_quantity = cancelled_quantity + $2,
                        last_generation = $3, last_seq = $4, updated_at = now()
                  WHERE allotment_line_id = $1",
            )
            .bind(line.allotment_line_id)
            .bind(line.cancelled_now)
            .bind(generation)
            .bind(seq)
            .execute(&mut **tx)
            .await?;
        }
        sqlx::query(
            "INSERT INTO allotment_amendment
                 (id, allotment_id, allotment_line_id, kind, target_before, target_after,
                  released, owed, reason, actor_id, created_at, idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(line.amendment_id)
        .bind(fact.allotment_id)
        .bind(line.allotment_line_id)
        .bind(&line.kind)
        .bind(line.target_before)
        .bind(line.target_after)
        .bind(line.released)
        .bind(line.owed)
        .bind(fact.reason.as_deref())
        .bind(&fact.actor_id)
        .bind(fact.applied_at)
        .bind(format!("edge:{event_id}"))
        .execute(&mut **tx)
        .await?;
        let reference = line.amendment_id.to_string();
        let details = json!({
            "kind": line.kind,
            "amendment_id": line.amendment_id,
            "reason": fact.reason,
            "target_before": line.target_before,
            "target_after": line.target_after,
            "written_by": origin_id,
        });
        if line.cancelled_now > 0 {
            insert_allotment_event(
                tx,
                &format!("amendment:{}:released", line.amendment_id),
                Some(fact.allotment_id),
                Some(line.allotment_line_id),
                "ALLOTMENT_CANCELLED",
                Some(&identity),
                line.cancelled_now,
                -line.cancelled_now,
                None,
                Some("ALLOTMENT_AMENDMENT"),
                Some(&reference),
                &fact.actor_id,
                details.clone(),
                fact.applied_at,
            )
            .await?;
        }
        if line.kind == "ADD" && raised > 0 {
            insert_allotment_event(
                tx,
                &format!("amendment:{}:added", line.amendment_id),
                Some(fact.allotment_id),
                Some(line.allotment_line_id),
                "ALLOTMENT_CREATED",
                Some(&identity),
                raised,
                raised,
                None,
                Some("ALLOTMENT_AMENDMENT"),
                Some(&reference),
                &fact.actor_id,
                details,
                fact.applied_at,
            )
            .await?;
        }
    }
    refresh_header(
        tx,
        fact.allotment_id,
        fact.cancelled.then_some(fact.applied_at),
        fact.applied_at,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn insert_progress(
    tx: &mut Transaction<'_, Postgres>,
    allotment_line_id: Uuid,
    allotment_id: Uuid,
    origin_id: &str,
    source_site_id: &str,
    source_pool_id: &str,
    destination_type: &str,
    destination_id: &str,
    sku_code: &str,
    quantity: i64,
    generation: i64,
    seq: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO edge_allotment_line_progress
             (allotment_line_id, allotment_id, origin_id, source_site_id, source_pool_id,
              destination_type, destination_id, sku_code, planned_quantity,
              accepted_quantity, last_generation, last_seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)
         ON CONFLICT (allotment_line_id) DO NOTHING",
    )
    .bind(allotment_line_id)
    .bind(allotment_id)
    .bind(origin_id)
    .bind(source_site_id)
    .bind(source_pool_id)
    .bind(destination_type)
    .bind(destination_id)
    .bind(sku_code)
    .bind(quantity)
    .bind(generation)
    .bind(seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// `inventory.allotment.created.v1`: an allotment MD raised on the Gudang
/// server, already accepted there. Written as Central's copy of an accepted
/// edge allotment: header, lines and line progress, in this copy's spelling.
pub(super) async fn apply_allotment_created(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    event_id: Uuid,
    created: &AllotmentActivationPayload,
) -> Result<(), AppError> {
    if !receipt(
        tx,
        event_id,
        origin_id,
        generation,
        seq,
        INVENTORY_ALLOTMENT_CREATED_V1,
        created.allotment_id,
        "APPLIED",
    )
    .await?
    {
        return Ok(());
    }
    let source_site = canonical_site_id_tx(tx, &created.source_site_id).await?;
    if inventory_owner_tx(tx, &source_site).await?.as_deref() != Some(origin_id) {
        return Err(AppError::Validation(format!(
            "allotment {} came from {origin_id}, which does not hold {source_site}",
            created.allotment_id
        )));
    }
    let allotment_type = AllotmentType::from_str(&created.allotment_type).map_err(|_| {
        AppError::Validation(format!("unknown allotment type {}", created.allotment_type))
    })?;
    sqlx::query(
        "INSERT INTO allotment
             (id, allotment_number, type, purpose, status, created_by, notes, idempotency_key,
              created_at, updated_at, activation_target_origin_id, edge_application_status,
              edge_application_received_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, $8, $9, 'ACCEPTED', now())
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(created.allotment_id)
    .bind(&created.allotment_number)
    .bind(allotment_type.as_str())
    // From the Gudang to a store: head office replenishing (0611).
    .bind((allotment_type == AllotmentType::ToSite).then_some("REPLENISH"))
    .bind(&created.created_by)
    .bind(created.notes.as_deref())
    .bind(format!("edge:{}", created.allotment_id))
    .bind(created.created_at)
    .bind(origin_id)
    .execute(&mut **tx)
    .await?;
    for line in &created.lines {
        let destination_id = canonical_site_id_tx(tx, &line.destination_id).await?;
        let destination_type = DestinationType::from_str(&line.destination_type)
            .map_err(|error| AppError::Validation(error.to_string()))?;
        let source_pool_id = pool_id_for_site(&line.source_pool_id, &source_site);
        sqlx::query(
            "INSERT INTO allotment_line
                 (id, allotment_id, source_site_id, source_pool_id, destination_type,
                  destination_id, sku_id, quantity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(line.allotment_line_id)
        .bind(created.allotment_id)
        .bind(&source_site)
        .bind(&source_pool_id)
        .bind(destination_type.as_str())
        .bind(&destination_id)
        .bind(line.sku_id)
        .bind(line.quantity)
        .execute(&mut **tx)
        .await?;
        insert_progress(
            tx,
            line.allotment_line_id,
            created.allotment_id,
            origin_id,
            &source_site,
            &source_pool_id,
            destination_type.as_str(),
            &destination_id,
            &line.sku_code,
            line.quantity,
            generation,
            seq,
        )
        .await?;
    }
    Ok(())
}
