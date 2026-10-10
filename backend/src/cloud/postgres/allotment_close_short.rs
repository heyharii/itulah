//! What a store will not get, and MD giving it up (allotment-v1 §7).
//!
//! A short pick raises an RFID count; while it runs the pieces are still on
//! hand and nothing here notices. Once the count books them Missing, the
//! Gudang holds less of the SKU than its stores are still owed, and every
//! line waiting on that SKU is **unfilled** — Merchandise's list. MD answers
//! one way only (owner, 1 Oct 2026): **Close short**, the store gets what is
//! already packed. More goods go out on a new allotment, never a top-up.
//!
//! Close Short only ever takes from `To Pack`. It is written as the legacy
//! `cancelled_quantity` on both sides, because that is the counter the
//! Gudang's pick, pack and cancellation all already subtract — a whole-
//! allotment cancellation after a close short then agrees with the node about
//! what is left.
//!
//! A line is also MD's to answer when the cloud-run Gudang's picker reported
//! it short and the report is still flagged (`cloud::dc::short_pick`, owner,
//! 9 Oct 2026): the racks may look full, but the picker could not get the
//! rest. MD sees Target · Sent · To pick and may close what is not yet
//! picked. Pieces already picked for the store go on to it and are never
//! closed short, on either kind of Gudang.

use super::allotments::{
    edge_normal_balance_tx, eligible_supply_pools_tx, insert_allotment_event,
    line_identity_from_row, normal_balance_tx,
};
use super::sync::{issue_command_tx, origin_site_id_tx, pool_id_for_site};
use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::cloud::application::AppError;
use crate::cloud::dc::short_pick::{self, ShortReason};
use crate::sync::workflow::{
    AllotmentCancellationLine, AllotmentCloseShortPayload, CLOSE_SHORT_CAPABILITY,
    INVENTORY_ALLOTMENT_CLOSE_SHORT_V1, INVENTORY_WORKFLOW_SCHEMA_VERSION,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

/// One store's share of one SKU that the Gudang cannot fill, or that its
/// picker reported short.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnfilledLine {
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub allotment_line_id: Uuid,
    pub sku_code: String,
    pub article_code: String,
    pub article_name: String,
    pub destination_id: String,
    pub destination_name: Option<String>,
    /// What MD allotted to the store.
    pub allotted: i64,
    /// What MD wants the store to have now: what she allotted, less what her
    /// reductions and cancels took (`allotment_amendment`). An addition is
    /// already in `allotted`.
    pub target: i64,
    /// On a delivery note or beyond, and not booked lost on the way or at the
    /// store (a loss puts its demand back in To Pack): the least the store
    /// will get.
    pub sent: i64,
    /// Already in cartons for it.
    pub packed: i64,
    /// Still to pack.
    pub to_pack: i64,
    /// The most a Close short here takes: what the Gudang cannot cover, or,
    /// on a line its picker reported short, everything not yet picked.
    /// Never a piece already picked for the store.
    pub unfilled: i64,
    /// Why the Gudang's picker could not finish this line, while the Short
    /// pick flag is up (OPEN or LOST); the newest report's.
    pub short_reason: Option<ShortReason>,
    pub allotted_at: DateTime<Utc>,
}

/// A Close short already made.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClosedShortLine {
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub allotment_line_id: Uuid,
    pub sku_code: String,
    pub article_code: String,
    pub article_name: String,
    pub destination_id: String,
    pub destination_name: Option<String>,
    pub allotted: i64,
    pub packed: i64,
    pub closed_short: i64,
    pub closed_by: String,
    pub closed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnfilledList {
    pub open: Vec<UnfilledLine>,
    /// Newest first, the last 200.
    pub closed: Vec<ClosedShortLine>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllotmentCloseShortLine {
    pub allotment_line_id: Uuid,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllotmentCloseShortRequest {
    pub idempotency_key: String,
    pub lines: Vec<AllotmentCloseShortLine>,
    #[serde(default)]
    pub reason: Option<String>,
}

const OPEN_LINES: &str = "
SELECT c.allotment_line_id, c.allotment_id, a.allotment_number, a.activation_target_origin_id,
       a.created_at, c.source_pool_id, c.destination_id, site.name AS destination_name,
       c.sku_id, sk.sku_code, ar.article_code, ar.name AS article_name,
       c.original_alloted, c.packed_total, c.to_pack_qty,
       GREATEST(0, c.original_alloted - COALESCE(amended.taken, 0))::bigint AS target,
       (c.at_shipment + c.at_loaded + c.at_in_transit + c.receiving_gap_qty + c.received)::bigint
           AS sent
  FROM allotment_line_commitment c
  JOIN allotment a ON a.id = c.allotment_id
  JOIN sku sk ON sk.id = c.sku_id
  JOIN article ar ON ar.id = sk.article_id
  LEFT JOIN site ON site.id = c.destination_id
  LEFT JOIN (SELECT allotment_line_id, SUM(released + owed)::bigint AS taken
               FROM allotment_amendment
              WHERE kind IN ('REDUCE', 'CANCEL')
              GROUP BY allotment_line_id) amended
    ON amended.allotment_line_id = c.allotment_line_id
 WHERE c.to_pack_qty > 0
   AND c.destination_type = 'STORE'
   AND a.status <> 'CANCELLED'
   AND a.edge_cancellation_status IS NULL
   AND (a.activation_target_origin_id IS NULL OR a.edge_application_status = 'ACCEPTED')
 ORDER BY a.created_at, c.allotment_line_id";

/// Every line the Gudang cannot fill or its picker reported short, and the
/// Close shorts already made.
///
/// Supply is measured the way an allotment is checked when it is raised —
/// the source pool and its pick areas, from the node's own facts when a node
/// owns the stock — against everything still to pack of that SKU there. A
/// line the cloud-run Gudang's picker reported short, and whose report is
/// still flagged, is listed whatever the supply says: MD may close what is
/// not yet picked of it.
pub async fn list_unfilled(pool: &PgPool) -> Result<UnfilledList, AppError> {
    let mut tx = pool.begin().await?;
    let rows = sqlx::query(OPEN_LINES).fetch_all(&mut *tx).await?;
    let flags = short_pick::flagged(&mut *tx).await?;
    // What already waits in the pick area for a cloud-executed line. A node's
    // lines are answered by the node's own figures when MD closes them.
    let mut cloud_lines = Vec::new();
    for row in &rows {
        if row
            .try_get::<Option<String>, _>("activation_target_origin_id")?
            .is_none()
        {
            cloud_lines.push(row.try_get::<Uuid, _>("allotment_line_id")?);
        }
    }
    let waiting = waiting_tx(&mut tx, &cloud_lines).await?;

    // (owner, source pool, SKU) → the lines waiting on it.
    let mut groups: BTreeMap<(Option<String>, String, String), Vec<usize>> = BTreeMap::new();
    for (index, row) in rows.iter().enumerate() {
        groups
            .entry((
                row.try_get("activation_target_origin_id")?,
                row.try_get("source_pool_id")?,
                row.try_get("sku_code")?,
            ))
            .or_default()
            .push(index);
    }

    let mut open = Vec::new();
    for ((origin, source_pool, sku_code), indexes) in groups {
        let demand: i64 = indexes
            .iter()
            .map(|&i| rows[i].get::<i64, _>("to_pack_qty"))
            .sum();
        let supply = match origin.as_deref() {
            Some(origin_id) => {
                let site = origin_site_id_tx(&mut tx, origin_id).await?;
                let scope = eligible_supply_pools_tx(&mut tx, &source_pool)
                    .await?
                    .iter()
                    .map(|pool_id| pool_id_for_site(pool_id, &site))
                    .collect::<Vec<_>>();
                edge_normal_balance_tx(&mut tx, origin_id, &scope, &sku_code).await?
            }
            None => {
                let sku_id: Uuid = rows[indexes[0]].try_get("sku_id")?;
                normal_balance_tx(&mut tx, &source_pool, sku_id).await?
            }
        };
        let shortage = demand - supply.max(0);
        for &i in &indexes {
            let row = &rows[i];
            let allotment_id: Uuid = row.try_get("allotment_id")?;
            let allotment_line_id: Uuid = row.try_get("allotment_line_id")?;
            let destination_id: String = row.try_get("destination_id")?;
            let to_pack: i64 = row.try_get("to_pack_qty")?;
            // Picked for the store and waiting for a carton: it goes on to
            // the store, so a Close short never takes it.
            let picked = waiting
                .get(&allotment_line_id)
                .copied()
                .unwrap_or(0)
                .max(0);
            let free = (to_pack - picked).max(0);
            let short_reason = flags
                .get(&(allotment_id, destination_id.clone(), sku_code.clone()))
                .copied();
            let unfilled = match short_reason {
                Some(_) => free,
                None => free.min(shortage),
            };
            if unfilled <= 0 {
                continue;
            }
            open.push(UnfilledLine {
                allotment_id,
                allotment_number: row.try_get("allotment_number")?,
                allotment_line_id,
                sku_code: sku_code.clone(),
                article_code: row.try_get("article_code")?,
                article_name: row.try_get("article_name")?,
                destination_id,
                destination_name: row.try_get("destination_name")?,
                allotted: row.try_get("original_alloted")?,
                target: row.try_get("target")?,
                sent: row.try_get("sent")?,
                packed: row.try_get("packed_total")?,
                to_pack,
                unfilled,
                short_reason,
                allotted_at: row.try_get("created_at")?,
            });
        }
    }
    open.sort_by(|a, b| {
        b.allotted_at
            .cmp(&a.allotted_at)
            .then_with(|| a.article_name.cmp(&b.article_name))
    });

    let closed = sqlx::query(
        "SELECT e.allotment_id, a.allotment_number, e.allotment_line_id, sk.sku_code,
                ar.article_code, ar.name AS article_name,
                COALESCE(e.destination_id, e.destination_store_id) AS destination_id,
                site.name AS destination_name, c.original_alloted, c.packed_total,
                e.quantity, e.actor_id, e.occurred_at
           FROM allotment_event e
           JOIN allotment a ON a.id = e.allotment_id
           JOIN sku sk ON sk.id = e.sku_id
           JOIN article ar ON ar.id = sk.article_id
           LEFT JOIN allotment_line_commitment c ON c.allotment_line_id = e.allotment_line_id
           LEFT JOIN site ON site.id = COALESCE(e.destination_id, e.destination_store_id)
          WHERE e.event_type = 'ALLOTMENT_CANCELLED' AND e.reference_type = 'CLOSE_SHORT'
          ORDER BY e.occurred_at DESC
          LIMIT 200",
    )
    .fetch_all(&mut *tx)
    .await?
    .iter()
    .map(|row| {
        Ok(ClosedShortLine {
            allotment_id: row.try_get("allotment_id")?,
            allotment_number: row.try_get("allotment_number")?,
            allotment_line_id: row.try_get("allotment_line_id")?,
            sku_code: row.try_get("sku_code")?,
            article_code: row.try_get("article_code")?,
            article_name: row.try_get("article_name")?,
            destination_id: row
                .try_get::<Option<String>, _>("destination_id")?
                .unwrap_or_default(),
            destination_name: row.try_get("destination_name")?,
            allotted: row
                .try_get::<Option<i64>, _>("original_alloted")?
                .unwrap_or(0),
            packed: row.try_get::<Option<i64>, _>("packed_total")?.unwrap_or(0),
            closed_short: row.try_get("quantity")?,
            closed_by: row.try_get("actor_id")?,
            closed_at: row.try_get("occurred_at")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    tx.commit().await?;
    Ok(UnfilledList { open, closed })
}

/// What the cloud-run Gudang's pick area holds for each of these allotment
/// lines (`dc_pick_waiting`, 0907): picked for the store, in no carton yet.
/// A line nothing waits for has no entry.
async fn waiting_tx(
    tx: &mut Transaction<'_, Postgres>,
    line_ids: &[Uuid],
) -> Result<BTreeMap<Uuid, i64>, AppError> {
    if line_ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    sqlx::query(
        "SELECT allotment_line_id, SUM(quantity)::bigint AS quantity
           FROM dc_pick_waiting
          WHERE allotment_line_id = ANY($1)
          GROUP BY allotment_line_id",
    )
    .bind(line_ids)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|row| -> Result<(Uuid, i64), AppError> {
        Ok((row.try_get("allotment_line_id")?, row.try_get("quantity")?))
    })
    .collect()
}

/// MD gives up on part of what an allotment still has to pack, line by line.
pub async fn close_allotment_short(
    pool: &PgPool,
    allotment_id: Uuid,
    request: AllotmentCloseShortRequest,
    actor_id: &str,
) -> Result<serde_json::Value, AppError> {
    if request.lines.is_empty() || request.lines.iter().any(|line| line.quantity <= 0) {
        return Err(AppError::Validation(
            "every line to close short needs a quantity above zero".into(),
        ));
    }
    let reason = request
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("Close short")
        .to_owned();
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CLOSE_SHORT_ALLOTMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let header = sqlx::query(
        "SELECT allotment_number, status, activation_target_origin_id, edge_application_status,
                edge_cancellation_status
           FROM allotment WHERE id = $1 FOR UPDATE",
    )
    .bind(allotment_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("allotment".into()))?;
    if header.get::<String, _>("status") == "CANCELLED"
        || header
            .get::<Option<String>, _>("edge_cancellation_status")
            .is_some()
    {
        return Err(AppError::Conflict("This allotment is cancelled.".into()));
    }
    let origin: Option<String> = header.get("activation_target_origin_id");
    if origin.is_some()
        && header
            .get::<Option<String>, _>("edge_application_status")
            .as_deref()
            != Some("ACCEPTED")
    {
        return Err(AppError::Conflict(
            "The Gudang has not taken this allotment yet.".into(),
        ));
    }

    // The cloud-run Gudang knows whose each picked piece is (`dc_pick_waiting`).
    // Its lines are locked first, in one order, so no pick lands on them
    // between reading what waits and closing; a pick locks its line too.
    let waiting = if origin.is_none() {
        let mut line_ids: Vec<Uuid> = request
            .lines
            .iter()
            .map(|line| line.allotment_line_id)
            .collect();
        line_ids.sort_unstable();
        line_ids.dedup();
        sqlx::query(
            "SELECT id FROM allotment_line
              WHERE allotment_id = $1 AND id = ANY($2)
              ORDER BY id
              FOR UPDATE",
        )
        .bind(allotment_id)
        .bind(&line_ids)
        .fetch_all(&mut *tx)
        .await?;
        waiting_tx(&mut tx, &line_ids).await?
    } else {
        BTreeMap::new()
    };

    let now = Utc::now();
    let close_short_id = Uuid::new_v4();
    let reference = close_short_id.to_string();
    let mut command_lines = Vec::with_capacity(request.lines.len());
    let mut total = 0_i64;
    for asked in &request.lines {
        let line = sqlx::query(
            "SELECT line.id, line.source_site_id, line.source_pool_id, line.destination_type,
                    line.destination_id, line.sku_id, sk.sku_code, c.to_pack_qty
               FROM allotment_line line
               JOIN allotment_line_commitment c ON c.allotment_line_id = line.id
               JOIN sku sk ON sk.id = line.sku_id
              WHERE line.id = $1 AND line.allotment_id = $2
              FOR UPDATE OF line",
        )
        .bind(asked.allotment_line_id)
        .bind(allotment_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("allotment line".into()))?;
        let to_pack: i64 = line.get("to_pack_qty");
        if asked.quantity > to_pack {
            return Err(AppError::Conflict(format!(
                "Only {to_pack} left to pack on this line."
            )));
        }
        // Close short releases only what is not yet picked (allotment-v1 §7;
        // E2E 2026-10-02). Picked pieces stand in the Gudang's pick area for
        // the shop and go on to it; giving them up left a piece the centre
        // offered again and the packer could not seal. The centre cannot see
        // which shop a node's pick was for, so every piece of this SKU in its
        // pick area is counted against this line, up to what it still has to
        // pack; the cloud-run Gudang's picks name their line.
        let sku_code: String = line.get("sku_code");
        let picked = match origin.as_deref() {
            Some(origin_id) => {
                let site = origin_site_id_tx(&mut tx, origin_id).await?;
                edge_normal_balance_tx(
                    &mut tx,
                    origin_id,
                    &[format!("{site}.outbound.picking")],
                    &sku_code,
                )
                .await?
            }
            None => waiting
                .get(&asked.allotment_line_id)
                .copied()
                .unwrap_or(0),
        }
        .clamp(0, to_pack);
        let free = to_pack - picked;
        if asked.quantity > free {
            return Err(AppError::Conflict(format!(
                "{picked} of {sku_code} {} already picked and will be packed for the store; \
                 only {free} not yet picked can be closed short.",
                if picked == 1 { "is" } else { "are" }
            )));
        }
        let written = match origin.as_deref() {
            Some(origin_id) => sqlx::query(
                "UPDATE edge_allotment_line_progress
                    SET cancelled_quantity = cancelled_quantity + $3
                  WHERE allotment_line_id = $1 AND origin_id = $2",
            )
            .bind(asked.allotment_line_id)
            .bind(origin_id)
            .bind(asked.quantity)
            .execute(&mut *tx)
            .await?
            .rows_affected(),
            None => sqlx::query(
                "UPDATE allotment_line
                    SET closed_short_quantity = closed_short_quantity + $2, updated_at = $3
                  WHERE id = $1",
            )
            .bind(asked.allotment_line_id)
            .bind(asked.quantity)
            .bind(now)
            .execute(&mut *tx)
            .await?
            .rows_affected(),
        };
        if written != 1 {
            return Err(AppError::Conflict(
                "This line has no fulfillment progress to close short.".into(),
            ));
        }
        let identity = line_identity_from_row(&line)?;
        insert_allotment_event(
            &mut tx,
            &format!("close-short:{close_short_id}:{}", asked.allotment_line_id),
            Some(allotment_id),
            Some(asked.allotment_line_id),
            "ALLOTMENT_CANCELLED",
            Some(&identity),
            asked.quantity,
            -asked.quantity,
            None,
            Some("CLOSE_SHORT"),
            Some(&reference),
            actor_id,
            json!({ "reason": reason, "close_short_id": close_short_id }),
            now,
        )
        .await?;
        command_lines.push(AllotmentCancellationLine {
            allotment_line_id: asked.allotment_line_id,
            quantity: asked.quantity,
        });
        total += asked.quantity;
    }

    // The Gudang stops packing what was given up. Only a node that says it
    // takes the command is sent one: an unknown command blocks its stream.
    if let Some(origin_id) = origin.as_deref() {
        let takes_it: bool = sqlx::query_scalar(
            "SELECT COALESCE(status->'capabilities' ? $2, false)
               FROM node_heartbeat WHERE origin_id = $1",
        )
        .bind(origin_id)
        .bind(CLOSE_SHORT_CAPABILITY)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(false);
        if !takes_it {
            return Err(AppError::Conflict(
                "The Gudang's node needs an update before it can close short.".into(),
            ));
        }
        let payload = AllotmentCloseShortPayload {
            schema_version: INVENTORY_WORKFLOW_SCHEMA_VERSION,
            close_short_id,
            allotment_id,
            source_site_id: origin_site_id_tx(&mut tx, origin_id).await?,
            reason: reason.clone(),
            requested_by: actor_id.to_owned(),
            requested_at: now,
            lines: command_lines,
        };
        issue_command_tx(
            &mut tx,
            INVENTORY_ALLOTMENT_CLOSE_SHORT_V1,
            &serde_json::to_value(&payload)?,
            actor_id,
            None,
            std::slice::from_ref(&origin_id.to_owned()),
        )
        .await?;
    }

    let response = json!({
        "allotment_id": allotment_id,
        "allotment_number": header.get::<String, _>("allotment_number"),
        "close_short_id": close_short_id,
        "closed_short": total,
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}
