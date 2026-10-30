//! Head office lets a new POS into a store, or refuses it (owner, 24 Oct
//! 2026: the store opens and closes its day and sets nothing up; a new POS
//! joins only with head office's approval, into a free seat; postgres 0994).
//!
//! # Where a waiting POS comes from
//!
//! A till asking its store's server to join is held there
//! (`edge::devices::begin_join`) and reported in every heartbeat
//! (`DeviceFacts::joins_waiting`). Nothing is copied into a table of its own:
//! the newest heartbeat is what is waiting, and a till that gave up or was let
//! in drops out of it by itself. [`waiting_pos`] reads it for the store's POS
//! tab; what head office already decided is kept in `pos_join_decision`, so
//! the tab says "on its way" until the server has carried it out.
//!
//! # Into a free seat
//!
//! The store's seats are head office's number (`site.till_count`). A new POS
//! takes one only while fewer live tills than seats are on the register,
//! counting the approvals still on their way; a POS that replaces another
//! takes that one's seat and name, and is refused while that one's drawer is
//! open, for the reason `edge::devices::refuse_while_shift_open` gives.
//!
//! A warehouse PC (Central Gudang, `WAREHOUSE`, postgres 1000) asks and is
//! decided on the same tab, and takes no seat: it never sells. It replaces
//! only another warehouse PC.

use super::sync::issue_command_tx;
use crate::cloud::application::AppError;
use crate::sync::device::{
    JoinDecisionCommand, WaitingJoin, COMMAND_DEVICE_JOIN_DECIDE, JOIN_DECIDE_CAPABILITY,
    KIND_TILL, KIND_WAREHOUSE, STATUS_REVOKED,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// A POS waiting to join the store, for the POS tab.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePosWaiting {
    pub join_id: Uuid,
    /// `TILL`, or `WAREHOUSE` for a Central Gudang PC, which takes no seat.
    pub kind: String,
    /// `7K4-P9Q`, as the POS shows it on its screen.
    pub code: String,
    /// The six digits the POS shows beside the code.
    pub verification: String,
    /// The PC's name, as the POS said.
    pub machine: Option<String>,
    pub os: Option<String>,
    pub version: Option<String>,
    pub asked_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// Head office's decision, while the store's server has not carried it
    /// out yet.
    pub decision: Option<StorePosDecision>,
    /// Why the store's server could not carry out the last approval — the
    /// POS it was to replace has a drawer open, say. It is still waiting.
    pub error: Option<String>,
    /// Whether this store's server takes head office's decision. An older
    /// one is updated first.
    pub decidable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePosDecision {
    pub approve: bool,
    pub replaces_device_id: Option<String>,
    pub by: String,
    pub at: DateTime<Utc>,
}

/// `POST /api/v1/stores/{unit}/pos/joins/{join_id}/approve`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ApprovePosRequest {
    /// The POS this one takes over from, by its register id. It is removed as
    /// the new one joins, and the new one takes its seat and name.
    #[serde(default)]
    pub replaces_device_id: Option<String>,
}

/// One waiting till, with the server that holds it.
struct Held {
    origin_id: String,
    join: WaitingJoin,
    decidable: bool,
}

/// Every till waiting at the store's servers, from their newest heartbeats.
async fn held_at(
    executor: impl sqlx::PgExecutor<'_>,
    unit_id: &str,
) -> Result<Vec<Held>, AppError> {
    let rows = sqlx::query(
        "SELECT h.origin_id, h.status -> 'devices' -> 'joins_waiting' AS joins,
                COALESCE(h.status -> 'capabilities' ? $2, false) AS decidable
           FROM node_heartbeat h
           JOIN sync_origin_credential o ON o.origin_id = h.origin_id
           JOIN site s ON s.id = o.site_id
          WHERE s.unit_id = $1 AND o.revoked_at IS NULL",
    )
    .bind(unit_id)
    .bind(JOIN_DECIDE_CAPABILITY)
    .fetch_all(executor)
    .await?;
    let now = Utc::now();
    let mut held = Vec::new();
    for row in &rows {
        let origin_id: String = row.try_get("origin_id")?;
        let decidable: bool = row.try_get("decidable")?;
        let joins: Option<serde_json::Value> = row.try_get("joins")?;
        let Some(joins) = joins else { continue };
        // A list this build cannot read is shown as nothing waiting rather
        // than failing the store's page.
        let joins: Vec<WaitingJoin> = serde_json::from_value(joins).unwrap_or_default();
        held.extend(
            joins
                .into_iter()
                .filter(|join| join.expires_at > now)
                .map(|join| Held {
                    origin_id: origin_id.clone(),
                    join,
                    decidable,
                }),
        );
    }
    held.sort_by_key(|held| held.join.issued_at);
    Ok(held)
}

fn text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// The POS waiting to join the store, oldest first.
pub async fn waiting_pos(pool: &PgPool, unit_id: &str) -> Result<Vec<StorePosWaiting>, AppError> {
    let held = held_at(pool, unit_id).await?;
    if held.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = held.iter().map(|held| held.join.join_id).collect();
    let decisions = sqlx::query(
        "SELECT join_id, approve, replaces_device_id, decided_by, decided_at
           FROM pos_join_decision WHERE join_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    let mut decided = std::collections::HashMap::new();
    for row in &decisions {
        let join_id: Uuid = row.try_get("join_id")?;
        let at: DateTime<Utc> = row.try_get("decided_at")?;
        decided.insert(
            join_id,
            StorePosDecision {
                approve: row.try_get("approve")?,
                replaces_device_id: row.try_get("replaces_device_id")?,
                by: row.try_get("decided_by")?,
                at,
            },
        );
    }
    Ok(held
        .into_iter()
        .map(|held| {
            let join = held.join;
            // An approval the server could not carry out is shown as its
            // reason, and may be decided again.
            let decision = decided
                .remove(&join.join_id)
                .filter(|_| join.head_office_error.is_none());
            StorePosWaiting {
                join_id: join.join_id,
                kind: join.kind,
                code: join.code,
                verification: join.verification,
                machine: text(&join.machine.hostname),
                os: text(&join.machine.os),
                version: text(&join.machine.version),
                asked_at: join.issued_at,
                expires_at: join.expires_at,
                decision,
                error: join.head_office_error,
                decidable: held.decidable,
            }
        })
        .collect())
}

/// Approve or refuse a waiting POS: checked against the store's seats here,
/// sent to its server as a signed `device.join.decide.v1`, and written down,
/// in one transaction.
pub async fn decide_pos_join(
    pool: &PgPool,
    unit_id: &str,
    join_id: Uuid,
    approve: bool,
    replaces_device_id: Option<&str>,
    actor: &str,
) -> Result<(), AppError> {
    let replaces_device_id = replaces_device_id
        .map(str::trim)
        .filter(|id| !id.is_empty());
    if !approve && replaces_device_id.is_some() {
        return Err(AppError::Validation("a refusal replaces nothing".into()));
    }
    let mut tx = pool.begin().await?;
    // One decision at a time per store, so two people approving two POS at
    // once cannot both take the last seat.
    let site: Option<(String, i32)> = sqlx::query_as(
        "SELECT s.id, COALESCE(s.till_count, 0)
           FROM site s
          WHERE s.unit_id = $1
          ORDER BY (s.kind = 'STORE') DESC, s.id
          LIMIT 1
            FOR UPDATE",
    )
    .bind(unit_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((site_id, seats)) = site else {
        return Err(AppError::NotFound(format!("store {unit_id}")));
    };

    let all_held = held_at(&mut *tx, unit_id).await?;
    // The other approvals still on their way, which hold a seat too — a
    // warehouse PC's holds none.
    let others_waiting: Vec<Uuid> = all_held
        .iter()
        .filter(|other| {
            other.join.join_id != join_id
                && other.join.head_office_error.is_none()
                && other.join.kind != KIND_WAREHOUSE
        })
        .map(|other| other.join.join_id)
        .collect();
    let held = all_held
        .into_iter()
        .find(|held| held.join.join_id == join_id)
        .ok_or_else(|| {
            AppError::Conflict(
                "that POS is no longer waiting: it was let in, gave up, or its request ran out"
                    .into(),
            )
        })?;
    if !held.decidable {
        return Err(AppError::Conflict(
            "this store's server runs a version that cannot take head office's decision on a \
             new POS; update the server first"
                .into(),
        ));
    }
    let earlier: Option<bool> =
        sqlx::query_scalar("SELECT true FROM pos_join_decision WHERE join_id = $1")
            .bind(join_id)
            .fetch_optional(&mut *tx)
            .await?;
    // A decision the server could not carry out may be made again.
    if earlier.is_some() && held.join.head_office_error.is_none() {
        return Err(AppError::Conflict(
            "head office has already decided this POS; it is on its way to the store's server"
                .into(),
        ));
    }

    // A till or a warehouse PC: each replaces only its own kind, and only a
    // till takes a seat.
    let kind = if held.join.kind == KIND_WAREHOUSE {
        KIND_WAREHOUSE
    } else {
        KIND_TILL
    };
    let mut replaces_terminal = None;
    if approve {
        match replaces_device_id {
            Some(device_id) => {
                replaces_terminal =
                    Some(replaced_till(&mut tx, &site_id, &held.origin_id, device_id, kind).await?);
            }
            None if kind == KIND_WAREHOUSE => {}
            None => {
                let live: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM device
                      WHERE site_id = $1 AND kind = 'TILL' AND status <> $2",
                )
                .bind(&site_id)
                .bind(STATUS_REVOKED)
                .fetch_one(&mut *tx)
                .await?;
                let coming: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM pos_join_decision
                      WHERE approve AND replaces_device_id IS NULL AND join_id = ANY($1)",
                )
                .bind(&others_waiting)
                .fetch_one(&mut *tx)
                .await?;
                if live + coming >= i64::from(seats) {
                    return Err(AppError::Conflict(format!(
                        "every POS seat at this store is taken ({seats}); add a seat, or approve \
                         this POS as the replacement of one"
                    )));
                }
            }
        }
    }

    let command = JoinDecisionCommand {
        join_id,
        approve,
        replaces_terminal_id: replaces_terminal,
        decided_by: actor.to_string(),
        decided_at: Utc::now(),
    };
    let payload = serde_json::to_value(&command)?;
    let command_id = issue_command_tx(
        &mut tx,
        COMMAND_DEVICE_JOIN_DECIDE,
        &payload,
        actor,
        Some(held.join.expires_at),
        std::slice::from_ref(&held.origin_id),
    )
    .await?;
    sqlx::query(
        "INSERT INTO pos_join_decision
            (join_id, origin_id, approve, replaces_device_id, decided_by, command_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (join_id) DO UPDATE
            SET approve = excluded.approve, replaces_device_id = excluded.replaces_device_id,
                decided_by = excluded.decided_by, decided_at = now(),
                command_id = excluded.command_id",
    )
    .bind(join_id)
    .bind(&held.origin_id)
    .bind(approve)
    .bind(replaces_device_id)
    .bind(actor)
    .bind(command_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The till a new POS replaces: on this store's register, at the same
/// server, of the same kind (a warehouse PC replaces a warehouse PC), not
/// removed already, and with no drawer open. Answers its id at the server.
async fn replaced_till(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    origin_id: &str,
    device_id: &str,
    kind: &str,
) -> Result<String, AppError> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT d.label, d.status, d.origin_id FROM device d
          WHERE d.device_id = $1 AND d.site_id = $2 AND d.kind = $3",
    )
    .bind(device_id)
    .bind(site_id)
    .bind(kind)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((label, status, held_by)) = row else {
        return Err(AppError::NotFound(format!("POS {device_id} at this store")));
    };
    if status == STATUS_REVOKED {
        return Err(AppError::Conflict(format!(
            "{label} is already removed; approve the new POS without replacing it"
        )));
    }
    if held_by != origin_id {
        return Err(AppError::Conflict(format!(
            "{label} belongs to another of this store's servers"
        )));
    }
    let open: Option<String> = sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(btrim(u.display_name), ''), c.opened_by)
           FROM cash_shift c
           LEFT JOIN app_user u ON u.username = c.opened_by
          WHERE c.site_id = $1 AND c.status = 'OPEN'
            AND (c.terminal_id = $2
                 OR c.terminal_id = 'KASIR-' || substring($3 FROM '^Kasir ([0-9]+)$'))
          LIMIT 1",
    )
    .bind(site_id)
    .bind(device_id)
    .bind(&label)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(name) = open {
        return Err(AppError::Conflict(format!(
            "{name}'s drawer is still open at {label}. Close that shift first; the money in \
             the drawer belongs to it"
        )));
    }
    Ok(device_id.to_string())
}
