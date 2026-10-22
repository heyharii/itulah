//! The Gudang in the cloud: picking (DC-CLOUD-NATIVE.md).
//!
//! A picklist exists for every allotment × shop the moment the allotment is
//! made (owner, 29 Sep 2026) — nobody composes one — and accepting it is the
//! pick. The routes answer what the DC server's `/api/v1/dc/*` picking routes
//! answer, in its shapes (`edge::outbound`, `edge::contracts`), so the hub's
//! Picking, Packing and Board screens run unchanged.
//!
//! # What a pick does here
//!
//! The stock move is the cloud's own allotment execution
//! (`postgres::execute_allotment`), one call per allotment line the SKU is
//! owed on, oldest allotment first. It takes the pieces off the line's own
//! source pool (the Gudang's stockroom), puts them in the Gudang's pick area,
//! raises `allotment_line.picked_quantity` and writes the line's
//! `ALLOTMENT_PICKED` event — so the allotment screens' Picked moves. With no
//! DC origin owning the head-office site, allotments made in the hub are
//! cloud-executed (`activation_target_origin_id` is NULL); one an on-premise
//! DC owns is not offered here and execution would refuse it.
//!
//! What a DC server kept beside the move is kept in `dc_pick_session`,
//! `dc_pick_line` and `dc_pick_piece` (0906).
//!
//! # For packing: where picked pieces are and whose they are
//!
//! - **The pick area** is the Gudang site's pool of role PICKING —
//!   `postgres::sites::pool_of_role(db, &common::gudang_site(db), PoolRole::Picking)`
//!   — and its place is `<that pool id>:on_hand`. It is ONE pool for every
//!   shop: execution never writes the legacy per-store `picked.{store}` pools.
//! - **Whose a piece is** is not in the pool's name; it is in the view
//!   `dc_pick_waiting` (0907): one row per subject a cloud-run pick put in the
//!   pick area that is still there, with `pick_session_id` (the picklist =
//!   the hub's `pick_session_ids`), `pick_line_id`, `allotment_id`,
//!   `allotment_line_id`, `destination_id` (the shop), `sku_id`, `sku_code`,
//!   `subject_id`, `place_id`, `quantity` (still waiting) and `picked_at`.
//!   Pack a shop's carton from its rows there; moving a subject out of
//!   `place_id` (into a koli) drops it from the view, and from every
//!   "waiting" / "to pack" figure here, without writing to picking's tables.
//! - **The allotment line's counters**: `picked_quantity` was raised at pick
//!   and must not be raised again at pack; packing raises `packed_quantity`
//!   (the commitment view's `to_pack_qty` falls with it).

use crate::cloud::dc::common;
use crate::cloud::http::auth::Principal;
use crate::cloud::{application::ExecuteAllotmentRequest, AppError, AppState};
use crate::edge::contracts::{CreatePicklistRequest, PicklistRefusal, PicklistResult};
use crate::edge::outbound::{
    AllotmentPick, ListFilter, PickSessionSummary, PickedLine, PicklistLine, PicklistSummary,
    Session,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Extension, Json, Router,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use sqlx::{postgres::PgRow, PgPool, Row};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/picklist", get(picklist))
        .route("/api/v1/dc/picklist/allotments", get(picklists_to_pick))
        .route(
            "/api/v1/dc/picklists",
            get(list_picklists).post(create_picklist),
        )
        .route("/api/v1/dc/pick-sessions", get(list_pick_sessions))
        .route("/api/v1/dc/pick-sessions/{session_id}", get(pick_session))
}

/// Every allotment line the Gudang still has to pick, with how much: `$1` is
/// the Gudang's site.
///
/// Per line, the smaller of two things. What execution will still take
/// (`quantity − picked − cancelled`, the rule `execute_allotment` holds a
/// line to), and what is still owed to a carton (`to_pack_qty`, which also
/// knows about Close short) less what was already picked for this line and
/// still waits in the pick area. The second is the DC server's arithmetic
/// (`picklists_to_pick`): a piece fetched and not yet packed is the packer's
/// work, not the picker's.
///
/// Only allotments to a shop from the Gudang that the cloud executes itself
/// and that are still open. One MD cancelled is never picked, even while its
/// header stays ACTIVE for pieces already on the road (owner, 21 Oct 2026:
/// "kenapa ga ada allotment, tapi ada picklist?").
const OPEN_PICK_LINES: &str = "
    SELECT line.id AS allotment_line_id, line.allotment_id, header.allotment_number,
           header.created_at, line.destination_id, line.sku_id, sku.sku_code,
           line.source_pool_id,
           GREATEST(0, LEAST(line.quantity - line.picked_quantity - line.cancelled_quantity,
                             commitment.to_pack_qty - COALESCE(waiting.quantity, 0)))::bigint
               AS to_pick
      FROM allotment_line line
      JOIN allotment header ON header.id = line.allotment_id
      JOIN allotment_line_commitment commitment ON commitment.allotment_line_id = line.id
      JOIN sku ON sku.id = line.sku_id
      LEFT JOIN (SELECT allotment_line_id, SUM(quantity)::bigint AS quantity
                   FROM dc_pick_waiting
                  GROUP BY allotment_line_id) waiting
        ON waiting.allotment_line_id = line.id
     WHERE line.source_site_id = $1
       AND header.type = 'TO_SITE'
       AND line.destination_type = 'STORE'
       AND header.activation_target_origin_id IS NULL
       AND header.status IN ('ACTIVE', 'IN_PROGRESS')
       AND header.cancelled_at IS NULL";

/// Timestamps on the wire the way the DC server writes them.
fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

// ---------------------------------------------------------------------------
// What is owed
// ---------------------------------------------------------------------------

/// What is still owed, added up by SKU. The picker's sheet.
async fn picklist(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(&format!(
        "SELECT owed.sku_code, SUM(owed.to_pick)::bigint AS to_pick, COUNT(*)::bigint AS lines
           FROM ({OPEN_PICK_LINES}) owed
          WHERE owed.to_pick > 0
          GROUP BY owed.sku_code
          ORDER BY SUM(owed.to_pick) DESC, owed.sku_code"
    ))
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let lines: Vec<PicklistLine> = rows
        .iter()
        .map(|row| PicklistLine {
            sku_code: row.get("sku_code"),
            outstanding: row.get("to_pick"),
            allotment_lines: row.get("lines"),
        })
        .collect();
    Ok(Json(json!({ "lines": lines })))
}

/// Every picklist still to pick: one per allotment × shop, grouped by shop
/// and oldest allotment first within it.
async fn picklists_to_pick(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(&format!(
        "SELECT owed.allotment_id, owed.allotment_number, owed.destination_id, owed.created_at,
                owed.sku_code, SUM(owed.to_pick)::bigint AS to_pick, COUNT(*)::bigint AS lines
           FROM ({OPEN_PICK_LINES}) owed
          WHERE owed.to_pick > 0
          GROUP BY owed.allotment_id, owed.allotment_number, owed.destination_id,
                   owed.created_at, owed.sku_code
          ORDER BY owed.destination_id, owed.created_at, owed.allotment_id,
                   SUM(owed.to_pick) DESC, owed.sku_code"
    ))
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let mut picks: Vec<AllotmentPick> = Vec::new();
    for row in &rows {
        let allotment_id = row.get::<Uuid, _>("allotment_id").to_string();
        let destination_id: String = row.get("destination_id");
        let line = PicklistLine {
            sku_code: row.get("sku_code"),
            outstanding: row.get("to_pick"),
            allotment_lines: row.get("lines"),
        };
        match picks.last_mut() {
            Some(pick)
                if pick.allotment_id == allotment_id && pick.destination_id == destination_id =>
            {
                pick.pieces += line.outstanding;
                pick.lines.push(line);
            }
            _ => picks.push(AllotmentPick {
                allotment_id,
                allotment_number: row.get("allotment_number"),
                destination_id,
                created_at: stamp(row.get("created_at")),
                pieces: line.outstanding,
                lines: vec![line],
            }),
        }
    }
    Ok(Json(json!({ "items": picks })))
}

// ---------------------------------------------------------------------------
// Picklists already walked
// ---------------------------------------------------------------------------

fn session_from(row: &PgRow) -> Session {
    Session {
        session_id: row.get::<Uuid, _>("session_id").to_string(),
        actor_id: row.get("picker_id"),
        started_at: stamp(row.get("started_at")),
        closed_at: row.get::<Option<DateTime<Utc>>, _>("closed_at").map(stamp),
        status: row.get("status"),
    }
}

/// Every picklist this Gudang has raised, newest first. One query, not a
/// summary per row: a fortnight of picking is a few hundred of them.
async fn list_picklists(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(
        "SELECT s.session_id, s.picker_id, s.started_at, s.closed_at, s.status,
                s.destination_id, s.allotment_id, a.allotment_number,
                COALESCE(done.sku_count, 0)::bigint AS sku_count,
                COALESCE(done.picked, 0)::bigint AS picked,
                COALESCE(waiting.quantity, 0)::bigint AS waiting
           FROM dc_pick_session s
           LEFT JOIN allotment a ON a.id = s.allotment_id
           LEFT JOIN (SELECT pick_session_id, COUNT(DISTINCT sku_code) AS sku_count,
                             SUM(picked) AS picked
                        FROM dc_pick_line
                       WHERE status = 'DONE' AND picked > 0
                       GROUP BY pick_session_id) done
             ON done.pick_session_id = s.session_id
           LEFT JOIN (SELECT pick_session_id, SUM(quantity) AS quantity
                        FROM dc_pick_waiting
                       GROUP BY pick_session_id) waiting
             ON waiting.pick_session_id = s.session_id
          WHERE s.site_id = $1
          ORDER BY s.started_at DESC, s.session_id DESC",
    )
    .bind(&site)
    .fetch_all(&state.db)
    .await?;
    let items: Vec<PicklistSummary> = rows
        .iter()
        .map(|row| PicklistSummary {
            session: session_from(row),
            destination_id: row.get("destination_id"),
            allotment_id: row
                .get::<Option<Uuid>, _>("allotment_id")
                .map(|id| id.to_string()),
            allotment_number: row.get("allotment_number"),
            sku_count: row.get("sku_count"),
            total_picked: row.get("picked"),
            waiting: row.get("waiting"),
        })
        .collect();
    Ok(Json(json!({ "items": items })))
}

/// The rounds themselves, newest fifty; `ready` keeps only the open ones.
async fn list_pick_sessions(
    State(state): State<AppState>,
    Query(filter): Query<ListFilter>,
) -> Result<Json<Value>, AppError> {
    common::require_hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let rows = sqlx::query(
        "SELECT session_id, picker_id, started_at, closed_at, status
           FROM dc_pick_session
          WHERE site_id = $1 AND (NOT $2 OR status = 'OPEN')
          ORDER BY started_at DESC, session_id DESC
          LIMIT 50",
    )
    .bind(&site)
    .bind(filter.ready)
    .fetch_all(&state.db)
    .await?;
    let items: Vec<Session> = rows.iter().map(session_from).collect();
    Ok(Json(json!({ "items": items })))
}

/// One picklist, read back: what came off the racks, and what of it is still
/// in the pick area waiting for a carton.
async fn pick_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<PickSessionSummary>, AppError> {
    common::require_hosted()?;
    let id = Uuid::parse_str(session_id.trim())
        .map_err(|_| AppError::NotFound(format!("session {session_id}")))?;
    Ok(Json(session_summary(&state.db, id).await?))
}

async fn session_summary(db: &PgPool, session_id: Uuid) -> Result<PickSessionSummary, AppError> {
    let row = sqlx::query(
        "SELECT s.session_id, s.picker_id, s.started_at, s.closed_at, s.status,
                s.destination_id, s.allotment_id, a.allotment_number
           FROM dc_pick_session s
           LEFT JOIN allotment a ON a.id = s.allotment_id
          WHERE s.session_id = $1",
    )
    .bind(session_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("session {session_id}")))?;
    // One trip per SKU: a picklist is walked once, however many allotment
    // lines its SKU was split over.
    let lines: Vec<PickedLine> = sqlx::query(
        "SELECT done.sku_code, done.picked, COALESCE(waiting.quantity, 0)::bigint AS waiting
           FROM (SELECT sku_code, SUM(picked)::bigint AS picked
                   FROM dc_pick_line
                  WHERE pick_session_id = $1 AND status = 'DONE' AND picked > 0
                  GROUP BY sku_code) done
           LEFT JOIN (SELECT sku_code, SUM(quantity)::bigint AS quantity
                        FROM dc_pick_waiting
                       WHERE pick_session_id = $1
                       GROUP BY sku_code) waiting
             ON waiting.sku_code = done.sku_code
          ORDER BY done.sku_code",
    )
    .bind(session_id)
    .fetch_all(db)
    .await?
    .iter()
    .map(|line| PickedLine {
        sku_code: line.get("sku_code"),
        picked: line.get("picked"),
        events: 1,
        waiting: line.get("waiting"),
    })
    .collect();
    Ok(PickSessionSummary {
        session: session_from(&row),
        destination_id: row.get("destination_id"),
        allotment_id: row
            .get::<Option<Uuid>, _>("allotment_id")
            .map(|id| id.to_string()),
        allotment_number: row.get("allotment_number"),
        sku_count: i64::try_from(lines.len()).unwrap_or(i64::MAX),
        total_picked: lines.iter().map(|line| line.picked).sum(),
        waiting: lines.iter().map(|line| line.waiting).sum(),
        lines,
    })
}

async fn refusals(db: &PgPool, session_id: Uuid) -> Result<Vec<PicklistRefusal>, AppError> {
    Ok(sqlx::query(
        "SELECT sku_code, quantity, COALESCE(reason, '') AS reason
           FROM dc_pick_line
          WHERE pick_session_id = $1 AND status = 'REFUSED'
          ORDER BY sku_code, planned_at",
    )
    .bind(session_id)
    .fetch_all(db)
    .await?
    .iter()
    .map(|row| PicklistRefusal {
        sku_code: row.get("sku_code"),
        quantity: row.get("quantity"),
        reason: row.get("reason"),
    })
    .collect())
}

// ---------------------------------------------------------------------------
// Accepting a picklist: the pick
// ---------------------------------------------------------------------------

/// Raise a picklist: a round opened, walked and closed in one act, as the DC
/// server does it (`create_picklist`).
///
/// In three steps, so a delivery that dies part-way is finished by its retry
/// rather than walked twice:
///
/// 1. The round is claimed under the request's idempotency key.
/// 2. Every SKU of the round is planned in one pass, in one transaction of
///    its own: what each is owed, what the racks hold and the lines' shares
///    are read and written once, not once per SKU. A SKU nothing can be
///    picked for is written down as refused — a fact about the racks, not
///    a failed request: the other lines are still worth fetching.
/// 3. Each planned line is executed under its own stored key and quantity,
///    so a retry replays the execution instead of making a second one.
///
/// A row lock on the round is held throughout: a second delivery of the same
/// accept waits, then finds the round closed and answers with it.
///
/// The round runs in its own task, so it finishes even if the screen that
/// asked goes away part-way — a reload, a tablet off the Wi-Fi. Step 3 is one
/// transaction per line, and a dropped request used to stop between them: on
/// 17 Oct a hub reload left a piece off the rack that no pack ever saw, the
/// round OPEN, and its key gone with the page that held it.
async fn create_picklist(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(mut request): Json<CreatePicklistRequest>,
) -> Result<(StatusCode, Json<PicklistResult>), AppError> {
    common::require_hosted()?;
    request.actor_id = principal.username.trim().to_owned();
    tokio::spawn(async move { pick_round(state, request).await })
        .await
        .map_err(|error| AppError::Configuration(format!("the pick round stopped: {error}")))?
        .map(|result| (StatusCode::CREATED, Json(result)))
}

/// The pick itself, out of the request's hands (`create_picklist`).
async fn pick_round(
    state: AppState,
    mut request: CreatePicklistRequest,
) -> Result<PicklistResult, AppError> {
    let allotment_id = normalise(&state.db, &mut request).await?;
    let site = common::gudang_site(&state.db).await?;
    // The flows a pick parks are told who picked under the Gudang's own
    // origin; it has to exist before the first one.
    common::ensure_origin(&state.db).await?;

    let session_id = claim_round(&state, &site, &request, allotment_id).await?;

    let mut hold = state.db.begin().await?;
    // NO KEY UPDATE, not UPDATE: the lines and pieces written below point at
    // this row, and their key-share locks must not wait on the hold.
    let status: String = sqlx::query_scalar(
        "SELECT status FROM dc_pick_session WHERE session_id = $1 FOR NO KEY UPDATE",
    )
    .bind(session_id)
    .fetch_one(&mut *hold)
    .await?;
    if status == "OPEN" {
        plan_round(&state, &site, session_id, &request, allotment_id).await?;
        execute_planned(&state, &site, session_id, &request.actor_id).await?;
        sqlx::query(
            "UPDATE dc_pick_session SET status = 'CLOSED', closed_at = $2
              WHERE session_id = $1 AND status = 'OPEN'",
        )
        .bind(session_id)
        .bind(state.clock.now())
        .execute(&mut *hold)
        .await?;
    }
    hold.commit().await?;

    let summary = session_summary(&state.db, session_id).await?;
    let refused = refusals(&state.db, session_id).await?;
    Ok(PicklistResult { summary, refused })
}

/// The DC server's checks on a picklist, in its words. Returns the allotment
/// it answers, parsed.
async fn normalise(
    db: &PgPool,
    request: &mut CreatePicklistRequest,
) -> Result<Option<Uuid>, AppError> {
    request.idempotency_key = request.idempotency_key.trim().to_owned();
    if request.idempotency_key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    if request.actor_id.is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    request.source_pool_id = request.source_pool_id.trim().to_owned();
    if request.source_pool_id.is_empty() {
        return Err(AppError::Validation("source_pool_id is required".into()));
    }
    for line in &mut request.lines {
        line.sku_code = line.sku_code.trim().to_ascii_uppercase();
        if line.sku_code.is_empty() {
            return Err(AppError::Validation("sku_code is required".into()));
        }
        if line.quantity <= 0 {
            return Err(AppError::Validation(format!(
                "quantity for {} must be positive",
                line.sku_code
            )));
        }
    }
    request
        .lines
        .sort_by(|left, right| left.sku_code.cmp(&right.sku_code));
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a picklist needs at least one line; a round fetching nothing is a walk".into(),
        ));
    }
    if request
        .lines
        .windows(2)
        .any(|pair| pair[0].sku_code == pair[1].sku_code)
    {
        return Err(AppError::Validation(
            "one SKU cannot appear on two lines of the same picklist".into(),
        ));
    }
    request.destination_id = match request.destination_id.as_deref().map(str::trim) {
        Some(shop) if !shop.is_empty() => {
            let known: Option<String> = sqlx::query_scalar("SELECT id FROM site WHERE id = $1")
                .bind(shop)
                .fetch_optional(db)
                .await?;
            Some(known.ok_or_else(|| AppError::Validation(format!("{shop} is not a shop")))?)
        }
        _ => None,
    };
    request.allotment_id = request
        .allotment_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    let allotment_id = match request.allotment_id.as_deref() {
        Some(id) => Some(
            Uuid::parse_str(id)
                .map_err(|_| AppError::Validation(format!("{id} is not an allotment id")))?,
        ),
        None => None,
    };
    if allotment_id.is_some() && request.destination_id.is_none() {
        return Err(AppError::Validation(
            "a picklist for an allotment names the shop it is for".into(),
        ));
    }
    Ok(allotment_id)
}

/// The round for this accept: a new one, or the one an earlier delivery of
/// the same key opened. The same key with a different request is refused.
async fn claim_round(
    state: &AppState,
    site: &str,
    request: &CreatePicklistRequest,
    allotment_id: Option<Uuid>,
) -> Result<Uuid, AppError> {
    let request_json = serde_json::to_value(request)?;
    let claimed: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO dc_pick_session
             (session_id, site_id, picker_id, started_at, status, note, source_pool_id,
              destination_id, allotment_id, idempotency_key, request_json)
         VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7, $8, $9, $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING session_id",
    )
    .bind(Uuid::new_v4())
    .bind(site)
    .bind(&request.actor_id)
    .bind(state.clock.now())
    .bind(&request.note)
    .bind(&request.source_pool_id)
    .bind(&request.destination_id)
    .bind(allotment_id)
    .bind(&request.idempotency_key)
    .bind(&request_json)
    .fetch_optional(&state.db)
    .await?;
    if let Some(session_id) = claimed {
        return Ok(session_id);
    }
    let row = sqlx::query(
        "SELECT session_id, request_json FROM dc_pick_session WHERE idempotency_key = $1",
    )
    .bind(&request.idempotency_key)
    .fetch_one(&state.db)
    .await?;
    let stored: Option<Value> = row.get("request_json");
    if stored.as_ref() != Some(&request_json) {
        return Err(AppError::Conflict(
            "idempotency key was already used with a different request payload".into(),
        ));
    }
    Ok(row.get("session_id"))
}

/// Plan every SKU of the round in one pass, in one transaction of the
/// round's own: split each over the allotment lines it is owed on, oldest
/// allotment first, and hold each share to what the line still owes and to
/// what is on its rack. More than is owed is a short pick of what is owed,
/// never a trolley of goods going nowhere.
///
/// Where `plan` used to run once per SKU — each run its own transaction, its
/// own read of what is owed, its own rack sums and its own line inserts —
/// this reads what the whole round is owed once, the racks once in one
/// grouped read, and writes every line (planned share or refusal) in one
/// statement, all of it committed before the execution reads it. A SKU an
/// earlier delivery of this round already planned is skipped, so the retry
/// carries on from here.
async fn plan_round(
    state: &AppState,
    site: &str,
    session_id: Uuid,
    request: &CreatePicklistRequest,
    allotment_id: Option<Uuid>,
) -> Result<(), AppError> {
    let mut tx = state.db.begin().await?;
    // The SKUs an earlier delivery of this round already got this far on.
    let planned: BTreeSet<String> =
        sqlx::query("SELECT DISTINCT sku_code FROM dc_pick_line WHERE pick_session_id = $1")
            .bind(session_id)
            .fetch_all(&mut *tx)
            .await?
            .iter()
            .map(|row| row.get("sku_code"))
            .collect();
    let skus: Vec<String> = request
        .lines
        .iter()
        .filter(|line| !planned.contains(&line.sku_code))
        .map(|line| line.sku_code.clone())
        .collect();
    if skus.is_empty() {
        return Ok(());
    }
    let now = state.clock.now();
    // What every SKU of the round is owed, in one read in plan order.
    let owed = sqlx::query(&format!(
        "SELECT owed.sku_code, owed.allotment_line_id, owed.allotment_id,
                owed.source_pool_id, owed.sku_id, owed.to_pick
           FROM ({OPEN_PICK_LINES}) owed
          WHERE owed.to_pick > 0
            AND owed.sku_code = ANY($2)
            AND ($3::text IS NULL OR owed.destination_id = $3)
            AND ($4::uuid IS NULL OR owed.allotment_id = $4)
          ORDER BY owed.sku_code, owed.created_at, owed.allotment_id,
                   owed.allotment_line_id"
    ))
    .bind(site)
    .bind(&skus)
    .bind(&request.destination_id)
    .bind(allotment_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut owed_by_sku: BTreeMap<String, Vec<PgRow>> = BTreeMap::new();
    let mut racks_needed: BTreeSet<(String, Uuid)> = BTreeSet::new();
    for row in owed {
        let source_pool: String = row.get("source_pool_id");
        let sku_id: Uuid = row.get("sku_id");
        racks_needed.insert((format!("{source_pool}:on_hand"), sku_id));
        owed_by_sku
            .entry(row.get::<String, _>("sku_code"))
            .or_default()
            .push(row);
    }

    // What is on those racks, one grouped read for the round instead of one
    // sum per owed line. A rack nothing stands on has no row here; it holds
    // nothing.
    let (places, rack_skus): (Vec<String>, Vec<Uuid>) = racks_needed.into_iter().unzip();
    let mut on_rack: BTreeMap<(String, Uuid), i64> = if places.is_empty() {
        BTreeMap::new()
    } else {
        sqlx::query(
            "SELECT pool.place_id, pool.sku_id,
                    COALESCE(SUM(projection.quantity), 0)::bigint AS quantity
               FROM unnest($1::text[], $2::uuid[]) WITH ORDINALITY
                    AS pool(place_id, sku_id, ord)
               JOIN inventory_projection projection ON projection.place_id = pool.place_id
               JOIN inventory_subject subject
                 ON subject.id = projection.subject_id AND subject.sku_id = pool.sku_id
              GROUP BY pool.place_id, pool.sku_id",
        )
        .bind(&places)
        .bind(&rack_skus)
        .fetch_all(&mut *tx)
        .await?
        .iter()
        .map(|row| {
            (
                (
                    row.get::<String, _>("place_id"),
                    row.get::<Uuid, _>("sku_id"),
                ),
                row.get::<i64, _>("quantity"),
            )
        })
        .collect()
    };

    // The walk itself, in Rust where plan's was: each SKU over its owed
    // lines, taking the smaller of what is left to fetch, what the line is
    // still owed and what its rack holds.
    let mut ids: Vec<Uuid> = Vec::new();
    let mut sku_codes: Vec<String> = Vec::new();
    let mut allotment_ids: Vec<Option<Uuid>> = Vec::new();
    let mut line_ids: Vec<Option<Uuid>> = Vec::new();
    let mut quantities: Vec<i64> = Vec::new();
    let mut statuses: Vec<String> = Vec::new();
    let mut execute_keys: Vec<Option<String>> = Vec::new();
    let mut reasons: Vec<Option<String>> = Vec::new();
    for line in &request.lines {
        if planned.contains(&line.sku_code) {
            continue;
        }
        let owed = owed_by_sku.get(&line.sku_code);
        let mut left = line.quantity;
        let mut first_rack: Option<String> = None;
        for row in owed.into_iter().flatten() {
            if left == 0 {
                break;
            }
            let source_pool: String = row.get("source_pool_id");
            first_rack.get_or_insert_with(|| source_pool.clone());
            let sku_id: Uuid = row.get("sku_id");
            let rack = (format!("{source_pool}:on_hand"), sku_id);
            let available = on_rack.get(&rack).copied().unwrap_or(0);
            let to_pick: i64 = row.get("to_pick");
            let take = left.min(to_pick).min(available).max(0);
            *on_rack.entry(rack).or_insert(0) -= take;
            if take == 0 {
                continue;
            }
            let line_id: Uuid = row.get("allotment_line_id");
            ids.push(Uuid::new_v4());
            sku_codes.push(line.sku_code.clone());
            allotment_ids.push(Some(row.get::<Uuid, _>("allotment_id")));
            line_ids.push(Some(line_id));
            quantities.push(take);
            statuses.push("PLANNED".to_owned());
            execute_keys.push(Some(format!("dc-pick:{session_id}:{line_id}")));
            reasons.push(None);
            left -= take;
        }

        if left == line.quantity {
            let reason = match (owed.is_none(), request.destination_id.as_deref()) {
                (false, _) => format!(
                    "no {} is on the racks at {}",
                    line.sku_code,
                    first_rack.as_deref().unwrap_or(site)
                ),
                (true, Some(shop)) if allotment_id.is_some() => format!(
                    "this allotment owes {shop} no more {} to pick",
                    line.sku_code
                ),
                (true, Some(shop)) => format!("{shop} is not owed any {}", line.sku_code),
                (true, None) => format!(
                    "no open allotment needs {}: pick only what head office allotted",
                    line.sku_code
                ),
            };
            ids.push(Uuid::new_v4());
            sku_codes.push(line.sku_code.clone());
            allotment_ids.push(None);
            line_ids.push(None);
            quantities.push(line.quantity);
            statuses.push("REFUSED".to_owned());
            execute_keys.push(None);
            reasons.push(Some(reason));
        }
    }
    if ids.is_empty() {
        return Ok(());
    }
    // Every line of the round — planned share or refusal — in one statement,
    // the ids minted here so the write needs no round trip per line.
    sqlx::query(
        "INSERT INTO dc_pick_line
             (id, pick_session_id, sku_code, allotment_id, allotment_line_id, quantity,
              status, execute_key, reason, planned_at)
         SELECT line.id, $1, line.sku_code, line.allotment_id, line.allotment_line_id,
                line.quantity, line.status, line.execute_key, line.reason, $2
           FROM unnest($3::uuid[], $4::text[], $5::uuid[], $6::uuid[], $7::bigint[],
                       $8::text[], $9::text[], $10::text[])
                WITH ORDINALITY AS line(id, sku_code, allotment_id, allotment_line_id,
                                        quantity, status, execute_key, reason, ord)
          ORDER BY line.ord",
    )
    .bind(session_id)
    .bind(now)
    .bind(&ids)
    .bind(&sku_codes)
    .bind(&allotment_ids)
    .bind(&line_ids)
    .bind(&quantities)
    .bind(&statuses)
    .bind(&execute_keys)
    .bind(&reasons)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Execute every planned line of the round that is not done yet. A line the
/// execution refuses (the rack emptied meanwhile, the allotment was closed)
/// is written down as refused; a database failure stops the round, and its
/// retry carries on from here.
async fn execute_planned(
    state: &AppState,
    site: &str,
    session_id: Uuid,
    actor_id: &str,
) -> Result<(), AppError> {
    let planned = sqlx::query(
        "SELECT id, allotment_id, allotment_line_id, sku_code, quantity, execute_key
           FROM dc_pick_line
          WHERE pick_session_id = $1 AND status = 'PLANNED'
          ORDER BY sku_code, planned_at, id",
    )
    .bind(session_id)
    .fetch_all(&state.db)
    .await?;
    for row in &planned {
        let pick_line_id: Uuid = row.get("id");
        let allotment_id: Uuid = row.get("allotment_id");
        let sku_code: String = row.get("sku_code");
        let request = ExecuteAllotmentRequest {
            allotment_line_id: row.get("allotment_line_id"),
            quantity: row.get("quantity"),
            actor_id: actor_id.to_owned(),
            idempotency_key: row.get("execute_key"),
        };
        match crate::cloud::postgres::execute_allotment(&state.db, allotment_id, request).await {
            Ok(response) => {
                record_pick(state, site, pick_line_id, &sku_code, actor_id, &response).await?
            }
            Err(AppError::Database(error)) => return Err(AppError::Database(error)),
            Err(error) => {
                sqlx::query(
                    "UPDATE dc_pick_line SET status = 'REFUSED', reason = $2
                      WHERE id = $1 AND status = 'PLANNED'",
                )
                .bind(pick_line_id)
                .bind(error.to_string())
                .execute(&state.db)
                .await?;
            }
        }
    }
    Ok(())
}

/// Write down what an execution moved: the line is done, and each subject it
/// put in the pick area is remembered with the shop and allotment line it was
/// picked for — what packing packs from (`dc_pick_waiting`).
async fn record_pick(
    state: &AppState,
    site: &str,
    pick_line_id: Uuid,
    sku_code: &str,
    actor_id: &str,
    response: &Value,
) -> Result<(), AppError> {
    let movement_group_id = response["movement_group_id"]
        .as_str()
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| {
            AppError::Configuration("the allotment execution answered without its movement".into())
        })?;
    let picked = response["picked_quantity"].as_i64().unwrap_or_default();
    let now = state.clock.now();
    let mut tx = state.db.begin().await?;
    let marked = sqlx::query(
        "UPDATE dc_pick_line
            SET status = 'DONE', picked = $2, movement_group_id = $3, done_at = $4
          WHERE id = $1 AND status = 'PLANNED'",
    )
    .bind(pick_line_id)
    .bind(picked)
    .bind(movement_group_id)
    .bind(now)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if marked == 1 {
        sqlx::query(
            "INSERT INTO dc_pick_piece
                 (pick_line_id, pick_session_id, allotment_id, allotment_line_id, destination_id,
                  sku_id, sku_code, subject_id, place_id, quantity, movement_group_id, picked_at)
             SELECT pick.id, pick.pick_session_id, line.allotment_id, line.id,
                    line.destination_id, line.sku_id, pick.sku_code, movement.subject_id,
                    movement.to_place_id, movement.quantity, movement.movement_group_id, $3
               FROM dc_pick_line pick
               JOIN allotment_line line ON line.id = pick.allotment_line_id
               JOIN movement ON movement.movement_group_id = $2
              WHERE pick.id = $1
              ORDER BY movement.fact_sequence",
        )
        .bind(pick_line_id)
        .bind(movement_group_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        // Picking is under way at the Gudang for this SKU: the flows whose
        // pick is due there park it, as a DC server's pick fact does
        // (`sync::apply_allotment_pick`). Never fails the pick.
        let fact = crate::cloud::postgres::flow_stages::NodeFact {
            origin_id: common::CLOUD_DC_ORIGIN,
            event_type: crate::sync::workflow::INVENTORY_PICK_V1,
            event_id: movement_group_id,
            stage: crate::cloud::domain::flow::StageKind::Pick,
            actor_id: Some(actor_id),
        };
        crate::cloud::postgres::flow_stages::resume_picks_tx(&mut tx, site, sku_code, &fact, now)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}
