use super::InventoryFacet;
use super::{begin_idempotent, complete_idempotent, payload_digest, rank_facets};
use crate::cloud::{
    application::{
        AppError, CorrectPlacementRequest, CreateMovementRequest, MissingResolutionRequest,
        MovementLineRequest,
    },
    domain::{
        validate_command, MovementCause, MovementCommand, MovementGroupId, MovementLine, SubjectId,
        SubjectType,
    },
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::{collections::HashMap, str::FromStr};
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
    // Both spellings of the same exit. `picking` is where an execution lands
    // now (INVENTORY-V1 INV-05); `picked.{store}` is retired and takes no new
    // writes, and naming it here says so with an error rather than a foreign
    // key. Either way the guard is about the counter, not the shelf: a hand
    // written movement out of DC Warehouse leaves the allotment line claiming
    // goods that have already gone.
    if cause == MovementCause::NormalMove
        && request.lines.iter().any(|line| {
            line.from == TO_STORE_SOURCE_PLACE_ID
                && (line.to.starts_with("dc.outbound.picking")
                    || line.to.starts_with("dc.outbound.picked.store-"))
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
    let requested_ids: Vec<Uuid> = request
        .lines
        .iter()
        .filter_map(|line| line.subject_id)
        .collect();
    let requested_epcs: Vec<String> = request
        .lines
        .iter()
        .filter_map(|line| line.epc.as_deref())
        .map(|epc| epc.trim().to_ascii_uppercase())
        .filter(|epc| !epc.is_empty())
        .collect();
    if request.lines.iter().any(|line| {
        line.subject_id.is_none() && line.epc.as_deref().map(str::trim).unwrap_or("").is_empty()
    }) {
        return Err(AppError::Validation("subject_id or epc is required".into()));
    }
    let subject_rows = sqlx::query(
        "SELECT id,epc FROM inventory_subject
         WHERE id = ANY($1) OR epc = ANY($2)
         FOR UPDATE",
    )
    .bind(&requested_ids)
    .bind(&requested_epcs)
    .fetch_all(&mut *tx)
    .await?;
    let mut by_id = std::collections::HashSet::new();
    let mut by_epc = HashMap::new();
    for row in subject_rows {
        let id: Uuid = row.get("id");
        by_id.insert(id);
        if let Some(epc) = row.get::<Option<String>, _>("epc") {
            by_epc.insert(epc, id);
        }
    }
    let mut lines = Vec::with_capacity(request.lines.len());
    for line in &request.lines {
        let subject = if let Some(id) = line.subject_id {
            by_id.contains(&id).then_some(id)
        } else {
            line.epc
                .as_deref()
                .map(str::trim)
                .map(str::to_ascii_uppercase)
                .and_then(|epc| by_epc.get(&epc).copied())
        }
        .ok_or_else(|| AppError::NotFound("inventory subject".into()))?;
        lines.push(MovementLine {
            subject_id: SubjectId(subject),
            quantity: line.quantity,
            from: line
                .from
                .parse()
                .map_err(|e: crate::cloud::domain::PlaceError| {
                    AppError::Validation(e.to_string())
                })?,
            to: line
                .to
                .parse()
                .map_err(|e: crate::cloud::domain::PlaceError| {
                    AppError::Validation(e.to_string())
                })?,
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
    let mut unit_subjects = std::collections::BTreeSet::new();
    for line in &command.lines {
        let (id, is_unit) = apply_line(tx, command, line, idempotency_key, digest).await?;
        ids.push(id);
        if is_unit {
            unit_subjects.insert(line.subject_id.0);
        }
    }
    refresh_projection_positions(tx, &command.lines).await?;
    validate_unique_company_placements(tx, &unit_subjects.into_iter().collect::<Vec<_>>()).await?;
    // The money follows the goods. A count shortfall, a confirmed loss and a
    // disposal are economic outflows, and the general ledger hears about them
    // here, in this same transaction: the movement ledger and the cost ledger
    // commit together or not at all. A move, a sale (already costed by the
    // sales day) and a gain post nothing — see `post_operational_outflow`.
    for line in &command.lines {
        let Some(pool) = line.from.pool() else {
            continue;
        };
        super::stock_ledger::post_operational_outflow(
            tx,
            command.cause.as_str(),
            line.subject_id.0,
            line.quantity,
            command.occurred_at.date_naive(),
            &pool.id(),
            pool.site_id().as_str(),
            &format!("{idempotency_key}:{}", line.subject_id.0),
            &command.reason,
            &command.actor_id,
        )
        .await?;
    }
    Ok(ids)
}

async fn apply_line(
    tx: &mut Transaction<'_, Postgres>,
    command: &MovementCommand,
    line: &MovementLine,
    idempotency_key: &str,
    digest: &str,
) -> Result<(Uuid, bool), AppError> {
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
    Ok((movement_id, subject_type == SubjectType::Unit))
}

async fn refresh_projection_positions(
    tx: &mut Transaction<'_, Postgres>,
    lines: &[MovementLine],
) -> Result<(), AppError> {
    let mut affected = std::collections::BTreeSet::new();
    for line in lines {
        for place in [&line.from, &line.to] {
            if place.is_company() {
                affected.insert((line.subject_id.0, place.id()));
            }
        }
    }
    if affected.is_empty() {
        return Ok(());
    }
    let payload: Vec<Value> = affected
        .into_iter()
        .map(|(subject_id, place_id)| json!({"subject_id":subject_id,"place_id":place_id}))
        .collect();
    sqlx::query(
        "WITH affected AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb)
                 AS row(subject_id uuid,place_id text)
         ), balance AS (
             SELECT affected.subject_id,affected.place_id,
                    COALESCE(SUM(CASE WHEN movement.to_place_id=affected.place_id
                                      THEN movement.quantity
                                      WHEN movement.from_place_id=affected.place_id
                                      THEN -movement.quantity ELSE 0 END),0)::bigint quantity,
                    COALESCE(MAX(movement.fact_sequence),0)::bigint sequence
             FROM affected LEFT JOIN movement
               ON movement.subject_id=affected.subject_id
              AND (movement.from_place_id=affected.place_id OR movement.to_place_id=affected.place_id)
             GROUP BY affected.subject_id,affected.place_id
         )
         INSERT INTO inventory_projection(subject_id,place_id,quantity,last_fact_sequence,updated_at)
         SELECT subject_id,place_id,quantity,sequence,now() FROM balance WHERE quantity>0
         ON CONFLICT(subject_id,place_id) DO UPDATE
         SET quantity=EXCLUDED.quantity,last_fact_sequence=EXCLUDED.last_fact_sequence,updated_at=now()",
    )
    .bind(Value::Array(payload.clone()))
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "WITH affected AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb)
                 AS row(subject_id uuid,place_id text)
         ), live AS (
             SELECT affected.subject_id,affected.place_id,
                    COALESCE(SUM(CASE WHEN movement.to_place_id=affected.place_id
                                      THEN movement.quantity
                                      WHEN movement.from_place_id=affected.place_id
                                      THEN -movement.quantity ELSE 0 END),0)::bigint quantity
             FROM affected LEFT JOIN movement
               ON movement.subject_id=affected.subject_id
              AND (movement.from_place_id=affected.place_id OR movement.to_place_id=affected.place_id)
             GROUP BY affected.subject_id,affected.place_id
         )
         DELETE FROM inventory_projection projection USING live
         WHERE projection.subject_id=live.subject_id AND projection.place_id=live.place_id
           AND live.quantity<=0",
    )
    .bind(Value::Array(payload))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn validate_unique_company_placements(
    tx: &mut Transaction<'_, Postgres>,
    subject_ids: &[Uuid],
) -> Result<(), AppError> {
    if subject_ids.is_empty() {
        return Ok(());
    }
    let duplicate: Option<Uuid> = sqlx::query_scalar(
        "WITH delta AS (
             SELECT subject_id,to_place_id place_id,quantity delta FROM movement
             WHERE subject_id=ANY($1)
             UNION ALL
             SELECT subject_id,from_place_id,-quantity FROM movement
             WHERE subject_id=ANY($1)
         ), balance AS (
             SELECT subject_id,place_id,SUM(delta) quantity FROM delta
             GROUP BY subject_id,place_id
         )
         SELECT balance.subject_id FROM balance
         JOIN inventory_place place ON place.id=balance.place_id
         WHERE place.is_company AND balance.quantity>0
         GROUP BY balance.subject_id HAVING COUNT(*)>1 LIMIT 1",
    )
    .bind(subject_ids)
    .fetch_optional(&mut **tx)
    .await?;
    if duplicate.is_some() {
        return Err(AppError::Conflict(
            "UNIT/EPC would have more than one company placement".into(),
        ));
    }
    Ok(())
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
            if let Some(outbound_store) =
                endpoint.pool().and_then(|pool| pool.outbound_destination())
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
        if to.starts_with("store-") && to.split('.').next() != Some(destination_id.as_str()) {
            return Err(AppError::Conflict(format!(
                "allotment line {allotment_line_id} is destined for {destination_id}, not {}",
                to.split('.').next().unwrap_or_default()
            )));
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

// ── the movement list ────────────────────────────────────────────────────
//
// The same envelope as `money_overview`, `list_employees` and `pools_page`:
// a scope in, `{ rows, next_cursor, total, facets }` out, with the facets
// counted from the same row definition the page is drawn from.

/// How many movements the list returns when the caller does not say.
const MOVEMENT_DEFAULT_LIMIT: i64 = 100;
/// And the most it will return however loudly a caller asks.
///
/// The ledger is the biggest table on this surface — four thousand rows in a
/// seeded fleet and only ever growing — so this is a page size, not a way to
/// ask for the lot. `total` is what tells a caller it hit the ceiling.
const MOVEMENT_MAX_LIMIT: i64 = 500;

/// What a caller is asking the ledger for.
/// `Default` leaves [`MovementScope::count`] FALSE, which is the right answer
/// for the internal readers that take the rows and nothing else — and the wrong
/// one for a route, which is why every route spells it.
#[derive(Clone, Debug, Default)]
pub struct MovementScope {
    /// One subject's whole history.
    pub subject_id: Option<Uuid>,
    /// One pool, matched against EITHER side of the posting — a movement is
    /// double-entry, so a transfer appears once and not twice.
    ///
    /// The CENTRE's spelling — `dc.warehouse`, not an Edge node's
    /// `dc-01.warehouse`. Every place id in this table is written by the
    /// centre's own ledger, so a caller holding the edge's vocabulary matches
    /// nothing, silently. An outbound ROLLUP pool also matches its leaves,
    /// which is what the `EXISTS` in the row definition is for.
    pub pool_id: Option<String>,
    /// Free text over the tag, the SKU code, who posted it, the two place ids
    /// and the reference.
    pub needle: Option<String>,
    /// One cause — `SALE`, `NORMAL_MOVE`, `CONFIRMED_LOST`. An unknown value
    /// narrows to nothing rather than being dropped: it is a column
    /// comparison, not a vocabulary this build has to recognise.
    pub cause: Option<String>,
    pub actor_id: Option<String>,
    /// `occurred_at`, `recorded_at`, `quantity` or `cause`. Anything
    /// unrecognised is the house order — newest first — rather than a 400.
    pub sort: Option<String>,
    /// `true` for descending. The house order is already descending, so this
    /// defaults to the direction the ledger is read in; see [`movements_page`].
    pub desc: bool,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    /// Whether to count at all — the lever `GET /audit` established, for the
    /// same reason and with the same shape.
    ///
    /// The page is a keyset seek and costs what one page costs whatever the
    /// ledger holds: 2.0 ms at 106,100 movements. The counting half reads the
    /// WHOLE matched set, because an exact total cannot cost less than looking
    /// at every row it counts — 45 ms at the same size, and growing with the
    /// table where the page does not.
    ///
    /// Defaults to counting, and that default is affordable rather than
    /// habitual: the counting half used to be 225 ms because it dragged the
    /// page's decoration joins through a hundred thousand rows, and
    /// [`movement_match`] is what took it to 45. A caller walking the keyset
    /// pays it once a page for a number that does not change between them, and
    /// that caller is who `count=0` is for.
    pub count: bool,
}

/// One posting, as a screen reads it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MovementRow {
    pub movement_id: Uuid,
    pub movement_group_id: Uuid,
    pub subject_id: Uuid,
    pub epc: Option<String>,
    pub sku_code: Option<String>,
    pub quantity: i64,
    /// Place ids, not pool ids: `dc.warehouse:on_hand`. The state is part of
    /// the place, which is how a move into `:missing` is a posting rather than
    /// a flag.
    pub from: String,
    pub to: String,
    pub cause: String,
    pub reference_type: Option<String>,
    pub reference_id: Option<String>,
    pub allotment_line_id: Option<Uuid>,
    pub allotment_id: Option<Uuid>,
    pub destination_type: Option<String>,
    pub destination_id: Option<String>,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
    pub recorded_at: DateTime<Utc>,
    /// The ledger's own order. Unique, monotonic, and the tie-break every sort
    /// here ends in.
    pub fact_sequence: i64,
}

/// What the ledger can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MovementFacets {
    pub causes: Vec<InventoryFacet>,
    pub actors: Vec<InventoryFacet>,
}

/// A page of the ledger, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MovementPage {
    pub rows: Vec<MovementRow>,
    pub next_cursor: Option<String>,
    /// Every posting the search and the filters match. Without it a screen can
    /// only say "300 movements", which is a statement about the page size.
    ///
    /// `None` means NOT COUNTED — the caller passed `count=0` — and that is a
    /// different statement from zero, which is why it is not spelled as one. A
    /// screen reading this has to say "300 of —" and why, never "300 of 0".
    /// See [`MovementScope::count`].
    pub total: Option<i64>,
    /// `None` for the same reason and always together with `total`: a filter
    /// panel drawn beside a list whose size it does not know is worse than no
    /// panel.
    pub facets: Option<MovementFacets>,
    /// Echoed back, as the old answer did.
    pub limit: i64,
}

#[derive(Serialize, Deserialize)]
struct MovementCursor {
    fact_sequence: i64,
}

/// Every place one `pool_id` covers — the pool's own two, and for an outbound
/// ROLLUP every leaf at the same stage.
///
/// Binds: `$2` the pool or NULL.
///
/// A set, computed ONCE per query, rather than a question asked of each row.
/// That is the whole difference between a pool-filtered ledger read that works
/// and one that does not: it depends only on `$2`, so PostgreSQL evaluates it
/// as a hashed `SubPlan` and every posting is then a hash probe. Written as a
/// correlated `EXISTS` over `m.from_place_id`/`m.to_place_id` instead — which
/// reads more naturally and is what this started as — the planner has to
/// re-run it per row, and the counting half went to 4.2 seconds over 404,647
/// buffers at 106,100 movements. As a set: 82 ms over 3,907.
///
/// Spelled once and used for both sides of the posting. A movement is
/// double-entry, so a pool matches EITHER end of it and a transfer between two
/// pools appears once in each rather than twice in one.
const MOVEMENT_SCOPE_PLACES: &str = r#"
    SELECT place.id FROM inventory_place place
    JOIN operational_pool op ON op.id=place.pool_id
    WHERE op.id=$2 OR EXISTS (
        SELECT 1 FROM operational_pool scope
        WHERE scope.id=$2 AND NOT scope.is_placement AND scope.outbound_stage IS NOT NULL
          AND op.is_placement AND op.outbound_stage=scope.outbound_stage)
"#;

/// WHICH movements a scope matches, defined once — for the page and for the
/// counting half.
///
/// Binds: `$1` a subject or NULL, `$2` a pool or NULL, `$3` the search pattern
/// or NULL.
///
/// The pool clause lives here rather than outside, unlike every other filter,
/// because a pool matches EITHER side of the posting and an outbound rollup
/// matches its leaves too. Keeping it in the definition means the facets are
/// counted within the pool being looked at — "SALE 412" beside one shop's
/// ledger means that shop sold 412 times, which is the question somebody has
/// there.
///
/// Every clause is a predicate on ONE `movement` row against something the
/// planner can prepare once: the pool's places as a hashed set (see
/// [`MOVEMENT_SCOPE_PLACES`]), the subject's tag and SKU code as an `EXISTS`
/// the row's own primary key answers. No join in the `FROM`, and that is not a
/// stylistic preference — a `WHERE … OR` short-circuits on a NULL bind, so an
/// UNFILTERED read never touches those tables at all, where a join is paid for
/// whether or not the filter is set. The counting half reads every row of the
/// ledger, so it paid that on all of them. Measured on 106,100 movements: count
/// and facets went from 225 ms — a 106k-row wide join materialised to a temp
/// file — to 45, and the pool-filtered case from 2,108 ms to 82.
///
/// It yields exactly one row per matching movement, which is what lets
/// [`movement_rows`] decorate it without changing what is counted: every join
/// added there is a LEFT JOIN on a primary key, over the subject's own NOT NULL
/// foreign key, so the decoration can neither add a row nor drop one.
fn movement_match() -> String {
    format!(
        r#"
FROM movement m
WHERE ($1::uuid IS NULL OR m.subject_id=$1)
  AND ($2::text IS NULL
       OR m.from_place_id IN ({MOVEMENT_SCOPE_PLACES})
       OR m.to_place_id IN ({MOVEMENT_SCOPE_PLACES}))
  AND ($3::text IS NULL
       OR m.actor_id ILIKE $3 OR m.from_place_id ILIKE $3 OR m.to_place_id ILIKE $3
       OR m.reference_id ILIKE $3
       OR EXISTS (SELECT 1 FROM inventory_subject s LEFT JOIN sku sk ON sk.id=s.sku_id
                   WHERE s.id=m.subject_id AND (s.epc ILIKE $3 OR sk.sku_code ILIKE $3)))
"#
    )
}

/// One movement row as a screen reads it: [`movement_match`] plus the columns
/// that only a drawn row needs.
///
/// The decoration is for the PAGE alone — fifty rows — and deliberately not
/// part of what the facets count, which is why the counting half can read
/// `movement` on its own.
fn movement_rows() -> String {
    let matched = movement_match();
    format!(
        r#"
SELECT m.movement_id,m.movement_group_id,m.subject_id,s.epc,sk.sku_code,m.quantity,
       m.from_place_id,m.to_place_id,m.cause,m.reference_type,m.reference_id,
       line.id allotment_line_id,COALESCE(line.allotment_id,legacy.id) allotment_id,
       line.destination_type,line.destination_id,m.actor_id,m.occurred_at,m.recorded_at,
       m.fact_sequence
FROM (SELECT * {matched}) m
JOIN inventory_subject s ON s.id=m.subject_id
LEFT JOIN sku sk ON sk.id=s.sku_id
LEFT JOIN allotment_line line ON m.reference_type='ALLOTMENT_LINE' AND m.reference_id=line.id::text
LEFT JOIN allotment legacy ON m.reference_type='ALLOTMENT' AND m.reference_id=legacy.id::text
"#
    )
}

/// The movement list's filters, spelled once for the page and for the facets.
const MOVEMENT_FILTERS: &str = "
     WHERE ($4::text IS NULL OR cause=$4)
       AND ($5::text IS NULL OR actor_id=$5)
";

fn movement_row_from(row: &sqlx::postgres::PgRow) -> Result<MovementRow, AppError> {
    Ok(MovementRow {
        movement_id: row.try_get("movement_id")?,
        movement_group_id: row.try_get("movement_group_id")?,
        subject_id: row.try_get("subject_id")?,
        epc: row.try_get("epc")?,
        sku_code: row.try_get("sku_code")?,
        quantity: row.try_get("quantity")?,
        from: row.try_get("from_place_id")?,
        to: row.try_get("to_place_id")?,
        cause: row.try_get("cause")?,
        reference_type: row.try_get("reference_type")?,
        reference_id: row.try_get("reference_id")?,
        allotment_line_id: row.try_get("allotment_line_id")?,
        allotment_id: row.try_get("allotment_id")?,
        destination_type: row.try_get("destination_type")?,
        destination_id: row.try_get("destination_id")?,
        actor_id: row.try_get("actor_id")?,
        occurred_at: row.try_get("occurred_at")?,
        recorded_at: row.try_get("recorded_at")?,
        fact_sequence: row.try_get("fact_sequence")?,
    })
}

/// The ledger: searched, filtered, sorted and paged by the server.
///
/// The house order is `occurred_at` DESCENDING — a ledger is read newest
/// first — so `desc` is inverted relative to every other list here rather than
/// leaving the default order backwards. Asking for `dir=desc` on the default
/// sort means "newest first", which is what it says.
pub async fn movements_page(pool: &PgPool, scope: MovementScope) -> Result<MovementPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let limit = scope
        .limit
        .unwrap_or(MOVEMENT_DEFAULT_LIMIT)
        .clamp(1, MOVEMENT_MAX_LIMIT);
    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<MovementCursor>)
        .transpose()?;

    // Every order ends in `fact_sequence`, which is a UNIQUE monotonic column
    // — no two postings can compare equal, which is what stops a keyset from
    // repeating or losing the rows that tie. It is also the ledger's own
    // order, so the default sort's tie-break IS the truth about which posting
    // came first, not a convenient stand-in.
    let (lead, descending) = match scope.sort.as_deref() {
        Some("recorded_at") => ("recorded_at", scope.desc),
        Some("quantity") => ("quantity", scope.desc),
        Some("cause") => ("cause", scope.desc),
        // Newest first unless somebody explicitly asks to walk up from the
        // beginning of the ledger.
        _ => ("occurred_at", !scope.desc),
    };
    let (cols, order) = super::order_by(lead, "fact_sequence", descending);
    let seek = if descending { "<" } else { ">" };

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let rows_sql = movement_rows();
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched {MOVEMENT_FILTERS}
         )
         SELECT * FROM kept
          WHERE $6::bigint IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE fact_sequence = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(scope.subject_id)
        .bind(&scope.pool_id)
        .bind(&needle)
        .bind(&scope.cause)
        .bind(&scope.actor_id)
        .bind(cursor.as_ref().map(|c| c.fact_sequence))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&MovementCursor {
            fact_sequence: row.try_get("fact_sequence")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(movement_row_from)
        .collect::<Result<Vec<_>, AppError>>()?;

    // The page is done. Everything below is the counting half, and it is
    // skipped entirely rather than approximated when the caller says so.
    let (total, facets) = match scope.count {
        true => {
            let (total, facets) = movement_facets(pool, &scope, needle.as_deref()).await?;
            (Some(total), Some(facets))
        }
        false => (None, None),
    };
    Ok(MovementPage {
        rows: out,
        next_cursor,
        total,
        facets,
        limit,
    })
}

/// How many postings there are, and how they split.
///
/// Per-value counts read the SEARCHED set, ignoring which cause is currently
/// ticked; the total reads the FILTERED one, because it describes the list on
/// screen.
///
/// It selects `cause` and `actor_id` off [`movement_match`] and nothing else.
/// Both are columns of `movement` itself, so an unfiltered count is one scan of
/// one table — where counting over the page's row definition dragged five joins
/// and nineteen columns through every row of the ledger and spilled the result
/// to a temp file to do it. Same rows counted, 225 ms against 45.
async fn movement_facets(
    pool: &PgPool,
    scope: &MovementScope,
    needle: Option<&str>,
) -> Result<(i64, MovementFacets), AppError> {
    let matched = movement_match();
    let sql = format!(
        "WITH searched AS (SELECT m.cause,m.actor_id {matched}), kept AS (
             SELECT * FROM searched {MOVEMENT_FILTERS}
         )
         SELECT 'cause' AS kind, cause AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY cause
          UNION ALL
         SELECT 'actor', actor_id, COUNT(*)::bigint FROM searched GROUP BY actor_id
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(scope.subject_id)
        .bind(&scope.pool_id)
        .bind(needle)
        .bind(&scope.cause)
        .bind(&scope.actor_id)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = MovementFacets {
        causes: Vec::new(),
        actors: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let facet = InventoryFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match kind.as_str() {
            "cause" => facets.causes.push(facet),
            "actor" => facets.actors.push(facet),
            _ => total = facet.count,
        }
    }
    for list in [&mut facets.causes, &mut facets.actors] {
        rank_facets(list);
    }
    Ok((total, facets))
}

pub fn parse_missing_id(value: &str) -> Result<(Uuid, String), AppError> {
    let (subject, pool) = value
        .split_once('@')
        .ok_or_else(|| AppError::Validation("missing id must be subject_uuid@pool_id".into()))?;
    let subject = Uuid::parse_str(subject)
        .map_err(|_| AppError::Validation("invalid missing subject id".into()))?;
    pool.parse::<crate::cloud::domain::OperationalPool>()
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
