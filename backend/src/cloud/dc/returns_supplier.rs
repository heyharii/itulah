//! Purchase returns at the Gudang: an order's excess, put on a return by the
//! buyer (`postgres::purchase_returns`, 0710), handed to the supplier here.
//!
//! The DC server's hand-over (`SqliteEdge::hand_over_purchase_return_impl`) is
//! the specification: every piece on the return leaves the Unidentified pool
//! for the supplier in one movement, found through the accepted delivery line
//! it arrived on, so two deliveries of one article are never confused; a
//! return is handed over once. Its movement fact used to close the return at
//! the centre (`purchase_return_handed_over`); here the same function closes
//! it in the same transaction.

use super::{actor_of, hosted, lock_document, require_key, time_text, write_movement};
use crate::cloud::dc::common;
use crate::cloud::domain::{
    ExternalPlace, MovementCause, MovementCommand, MovementGroupId, MovementLine, Place, SubjectId,
};
use crate::cloud::http::auth::Principal;
use crate::cloud::{AppError, AppState};
use crate::edge::contracts::{PurchaseReturnHandoverRequest, PurchaseReturnWork};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgConnection, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

/// The Gudang's purchase returns: every open one and those handed over in the
/// last fortnight — or just `only`.
async fn load_returns(
    conn: &mut PgConnection,
    site_id: &str,
    only: Option<Uuid>,
) -> Result<Vec<PurchaseReturnWork>, AppError> {
    let rows = sqlx::query(
        "SELECT pr.return_id, pr.return_number, po.po_number, pr.supplier_id, po.supplier_name,
                pr.note, pr.raised_by, pr.raised_at, pr.status, pr.handed_over_by,
                h.handed_over_to, pr.handed_over_at, pr.note_pic, pr.note_generated_at,
                COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'receipt_line_id', x.receipt_line_id,
                                     'po_line_id', x.po_line_id,
                                     'article_code', l.article_code,
                                     'article_name', l.article_name,
                                     'quantity', x.quantity)
                                 ORDER BY l.article_code, x.receipt_line_id)
                            FROM purchase_return_line x
                            JOIN purchase_order_line l ON l.po_line_id = x.po_line_id
                           WHERE x.return_id = pr.return_id), '[]'::jsonb) AS lines
           FROM purchase_return pr
           JOIN purchase_order po ON po.purchase_order_id = pr.purchase_order_id
           LEFT JOIN dc_purchase_return_handover h ON h.return_id = pr.return_id
          WHERE pr.site_id = $1
            AND (($2::uuid IS NULL
                  AND (pr.status = 'OPEN' OR pr.handed_over_at >= now() - interval '14 days'))
                 OR pr.return_id = $2)
          ORDER BY pr.status = 'HANDED_OVER', pr.raised_at DESC
          LIMIT 500",
    )
    .bind(site_id)
    .bind(only)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| -> Result<PurchaseReturnWork, AppError> {
            let lines: Vec<crate::edge::contracts::PurchaseReturnWorkLine> =
                serde_json::from_value(row.try_get::<Value, _>("lines")?)?;
            Ok(PurchaseReturnWork {
                return_id: row.try_get("return_id")?,
                return_number: row.try_get("return_number")?,
                po_number: row.try_get("po_number")?,
                supplier_id: row.try_get("supplier_id")?,
                supplier_name: row.try_get("supplier_name")?,
                note: row.try_get("note")?,
                raised_by: row.try_get("raised_by")?,
                // With the Gudang hosted, a return reaches it the moment it
                // is raised.
                received_at: time_text(row.try_get("raised_at")?),
                status: row.try_get("status")?,
                handed_over_by: row.try_get("handed_over_by")?,
                handed_over_to: row.try_get("handed_over_to")?,
                handed_over_at: row
                    .try_get::<Option<DateTime<Utc>>, _>("handed_over_at")?
                    .map(time_text),
                note_pic: row.try_get("note_pic")?,
                note_generated_at: row
                    .try_get::<Option<DateTime<Utc>>, _>("note_generated_at")?
                    .map(time_text),
                quantity: lines.iter().map(|line| line.quantity).sum(),
                lines,
            })
        })
        .collect()
}

/// Open returns first, then the last fortnight's hand-overs.
pub(super) async fn list(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    hosted()?;
    let site = common::gudang_site(&state.db).await?;
    let mut conn = state.db.acquire().await?;
    let items = load_returns(&mut *conn, &site, None).await?;
    Ok(Json(json!({ "items": items })))
}

/// Hand a purchase return to the supplier: its pieces leave the Unidentified
/// pool, and the return is closed.
pub(super) async fn hand_over(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(return_id): Path<Uuid>,
    Json(request): Json<PurchaseReturnHandoverRequest>,
) -> Result<(StatusCode, Json<PurchaseReturnWork>), AppError> {
    hosted()?;
    let actor = actor_of(&principal)?;
    let key = require_key(&request.idempotency_key)?;
    let mut tx = state.db.begin().await?;
    lock_document(&mut tx, "purchase-return", &return_id.to_string()).await?;
    let gudang = common::gudang_site_tx(&mut tx).await?;

    let done: Option<Uuid> = sqlx::query_scalar(
        "SELECT return_id FROM dc_purchase_return_handover WHERE idempotency_key = $1",
    )
    .bind(&key)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(done) = done {
        if done != return_id {
            return Err(AppError::Conflict(
                "idempotency key was already used to hand over another return".into(),
            ));
        }
        let view = load_returns(&mut *tx, &gudang, Some(return_id))
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound(format!("purchase return {return_id}")))?;
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(view)));
    }

    let header = sqlx::query(
        "SELECT pr.status, pr.return_number, pr.supplier_id, pr.site_id, po.supplier_name,
                pr.note_generated_at
           FROM purchase_return pr
           JOIN purchase_order po ON po.purchase_order_id = pr.purchase_order_id
          WHERE pr.return_id = $1
          FOR UPDATE OF pr",
    )
    .bind(return_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(header) = header.filter(|row| {
        row.try_get::<String, _>("site_id")
            .is_ok_and(|site| site == gudang)
    }) else {
        return Err(AppError::NotFound(format!(
            "this Gudang holds no purchase return {return_id}"
        )));
    };
    let status: String = header.try_get("status")?;
    let number: String = header.try_get("return_number")?;
    let supplier_id: String = header.try_get("supplier_id")?;
    let supplier_name: Option<String> = header.try_get("supplier_name")?;
    if status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "{number} has already been handed to the supplier"
        )));
    }
    // The surat jalan comes first (owner, 2026-10-05): a return is handed over
    // against a note that names the person in charge.
    let note_generated: Option<DateTime<Utc>> = header.try_get("note_generated_at")?;
    if note_generated.is_none() {
        return Err(AppError::Conflict(format!(
            "generate the surat jalan for {number} before it is handed over"
        )));
    }

    let wanted = sqlx::query(
        "SELECT x.receipt_line_id, l.article_code, x.quantity
           FROM purchase_return_line x
           JOIN purchase_order_line l ON l.po_line_id = x.po_line_id
          WHERE x.return_id = $1
          ORDER BY l.article_code, x.receipt_line_id",
    )
    .bind(return_id)
    .fetch_all(&mut *tx)
    .await?;
    if wanted.is_empty() {
        return Err(AppError::Validation(format!(
            "{number} has no lines to hand over"
        )));
    }

    // (subject, the place it stands in) → pieces to take from there.
    let mut take: BTreeMap<(Uuid, String), i64> = BTreeMap::new();
    for line in &wanted {
        let receipt_line_id: Uuid = line.try_get("receipt_line_id")?;
        let article_code: String = line.try_get("article_code")?;
        let quantity: i64 = line.try_get("quantity")?;
        // Where the accepted delivery line put its pieces: the Gudang's
        // receiving (Unidentified) pool, under the subject its count booked.
        // A place's state is NORMAL while pieces stand in it (`...:on_hand` is
        // only its id) — it was filtered on 'ON_HAND', which no place has, so
        // every hand-over said the Gudang had never received the goods.
        let sources = sqlx::query(
            "SELECT DISTINCT m.subject_id, m.to_place_id,
                    COALESCE(projection.quantity, 0)::bigint AS on_hand
               FROM goods_receipt_line g
               JOIN movement m ON m.movement_group_id = g.movement_group_id
               JOIN inventory_place place ON place.id = m.to_place_id AND place.state = 'NORMAL'
               JOIN operational_pool pool ON pool.id = place.pool_id
                AND pool.role = 'RECEIVING' AND pool.site_id = $2
               LEFT JOIN inventory_projection projection
                 ON projection.subject_id = m.subject_id AND projection.place_id = m.to_place_id
              WHERE g.receipt_line_id = $1
              ORDER BY m.subject_id, m.to_place_id",
        )
        .bind(receipt_line_id)
        .bind(&gudang)
        .fetch_all(&mut *tx)
        .await?;
        if sources.is_empty() {
            tracing::warn!(%receipt_line_id, %article_code, "return has no receiving stock to hand back");
            return Err(AppError::Validation(format!(
                "{number}: the {article_code} on this return is not in the Gudang's receiving stock, \
                 so it cannot be handed over"
            )));
        }
        let mut left = quantity;
        let mut on_hand_total = 0_i64;
        for source in &sources {
            let subject: Uuid = source.try_get("subject_id")?;
            let place: String = source.try_get("to_place_id")?;
            let already = take.get(&(subject, place.clone())).copied().unwrap_or(0);
            let available = (source.try_get::<i64, _>("on_hand")? - already).max(0);
            on_hand_total += available;
            let now_taken = available.min(left);
            if now_taken > 0 {
                *take.entry((subject, place)).or_default() += now_taken;
                left -= now_taken;
            }
            if left == 0 {
                break;
            }
        }
        if left > 0 {
            return Err(AppError::Conflict(format!(
                "{number} sends back {quantity} of {article_code}, but only {on_hand_total} of \
                 that delivery are still unidentified here"
            )));
        }
    }

    let mut lines = Vec::with_capacity(take.len());
    for ((subject, place), quantity) in take {
        lines.push(MovementLine {
            subject_id: SubjectId(subject),
            quantity,
            from: place
                .parse()
                .map_err(|error: crate::cloud::domain::PlaceError| {
                    AppError::Conflict(error.to_string())
                })?,
            to: Place::External {
                place: ExternalPlace::Supplier,
            },
        });
    }
    let occurred_at = state.clock.now();
    let command = MovementCommand {
        movement_group_id: MovementGroupId::new(),
        lines,
        cause: MovementCause::SupplierReturn,
        reference_type: Some(crate::cloud::domain::PURCHASE_RETURN_REFERENCE.into()),
        reference_id: Some(return_id.to_string()),
        reason: format!(
            "Retur {number} ke supplier {}",
            supplier_name.as_deref().unwrap_or(&supplier_id)
        ),
        actor_id: actor.clone(),
        occurred_at,
    };
    write_movement(&mut tx, &command, &format!("dc-purchase-return:{return_id}")).await?;
    crate::cloud::postgres::purchase_return_handed_over(
        &mut tx,
        &return_id.to_string(),
        &actor,
        occurred_at,
        command.movement_group_id.0,
    )
    .await?;
    let handed_to = request
        .handed_to
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    sqlx::query(
        "INSERT INTO dc_purchase_return_handover
             (return_id, idempotency_key, handed_over_to, handed_over_by, handed_over_at,
              movement_group_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(return_id)
    .bind(&key)
    .bind(handed_to)
    .bind(&actor)
    .bind(occurred_at)
    .bind(command.movement_group_id.0)
    .execute(&mut *tx)
    .await?;
    let view = load_returns(&mut *tx, &gudang, Some(return_id))
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| {
            AppError::Conflict("the purchase return vanished while being handed over".into())
        })?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(view)))
}

/// Generating the surat jalan: the Gudang's person in charge is named, and the
/// note exists from then on (owner, 2026-10-05). One request covers every open
/// return going to one supplier, because the note is per supplier.
///
/// Refused for a return that is not here, not open, or has been handed over.
/// Saying it again with another name replaces the name: a person in charge can
/// be corrected until the hand-over is confirmed.
#[derive(Debug, serde::Deserialize)]
pub(super) struct GenerateNoteRequest {
    pub return_ids: Vec<Uuid>,
    pub pic: String,
}

pub(super) async fn generate_note(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<GenerateNoteRequest>,
) -> Result<Json<Value>, AppError> {
    hosted()?;
    let pic = request.pic.split_whitespace().collect::<Vec<_>>().join(" ");
    if pic.is_empty() {
        return Err(AppError::Validation(
            "say who is in charge of this delivery".into(),
        ));
    }
    if request.return_ids.is_empty() {
        return Err(AppError::Validation("no returns were named".into()));
    }
    let site = common::gudang_site(&state.db).await?;
    let done = sqlx::query(
        "UPDATE purchase_return
            SET note_pic = $1, note_generated_at = now(), note_generated_by = $2
          WHERE return_id = ANY($3) AND site_id = $4 AND status = 'OPEN'",
    )
    .bind(&pic)
    .bind(&principal.username)
    .bind(&request.return_ids)
    .bind(&site)
    .execute(&state.db)
    .await?;
    if done.rows_affected() as usize != request.return_ids.len() {
        return Err(AppError::Conflict(
            "one of those returns is not open here any more".into(),
        ));
    }
    let mut conn = state.db.acquire().await?;
    let mut items = Vec::new();
    for id in &request.return_ids {
        items.extend(load_returns(&mut *conn, &site, Some(*id)).await?);
    }
    Ok(Json(json!({ "items": items })))
}
