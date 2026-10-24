//! Head office stops a till, a cashier or a whole store on the POS, and
//! removes a store that has closed for good (client review, 23 Oct 2026;
//! postgres 0990; `ho-stop-access-prototype.html`).
//!
//! # One rule
//!
//! Stopped means no selling and no new shift. A drawer already open can still
//! be counted and closed, so no takings are left hanging. The store cannot
//! stop or remove anything itself: every decision here is head office's, and
//! the node's own route for a till's status refuses tills
//! (`edge::devices::set_status`).
//!
//! # Where each stop lives
//!
//! * **A till** is a device: stopping it is `devices::request_device_status`
//!   with SUSPENDED, resuming it ACTIVE, removing it REVOKED. Nothing here
//!   stores it; [`store_pos`] only reads it for the store's Tills tab.
//! * **A cashier** is stopped on their login (`app_user.till_stopped_*`), at
//!   every store at once, without touching their hub account.
//! * **A store** is stopped on its unit (`unit.stopped_*`). Removing it closes
//!   the unit (`unit.status = 'CLOSED'`) and removes its tills; its history
//!   stays where it is.
//!
//! A node hears about a store or a cashier in its auth policy
//! ([`pos_stops_for`] → `AuthPolicySnapshot::pos_stops`), published at once to
//! every server concerned and marked due first, so a publication that fails
//! now is retried by the lease agent rather than forgotten.
//!
//! # The store's server is not disconnected
//!
//! Removing a store leaves its server connected: sales it rang before the
//! stop and has not sent yet are on its disk, and cutting its key would strand
//! them. Letting it go once it has sent everything is the store's Server tab's
//! Disconnect, which for a closed store revokes the key and issues no new
//! code (`stores::disconnect_store_server`).

use super::devices::device_status_tx;
use super::{publish_node_access, DeviceStatusRequest};
use crate::cloud::application::AppError;
use crate::cloud::domain::{PersonPosStop, PosStop, PosStops};
use crate::sync::device::{STATUS_REVOKED, STATUS_SUSPENDED};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The longest reason a stop may carry: the till shows it on one card.
const REASON_MAX_CHARS: usize = 300;

/// `POST /api/v1/stores/{unit}/stop` and
/// `POST /api/v1/stores/{unit}/cashiers/{user_id}/stop`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PosStopRequest {
    /// Why. Required: the till shows it, and a stop with no reason is a
    /// question nobody can answer later.
    pub reason: String,
}

/// `POST /api/v1/stores/{unit}/remove`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RemoveStoreRequest {
    /// The store's client code, typed by the person removing it (`C003`).
    pub code: String,
}

/// A stop as the hub shows it: when, who, and why.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PosStopNote {
    pub at: DateTime<Utc>,
    pub by: String,
    pub reason: String,
}

/// A drawer open at a till, as head office last heard (`cash_shift`).
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePosShift {
    /// The person's full name, or their login when the hub has none.
    pub name: String,
    pub opened_at: DateTime<Utc>,
}

/// One till of the store, for the Tills tab.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePosTill {
    /// The register's id: `POST /api/v1/sync/devices/{device_id}/status`
    /// stops (SUSPENDED), resumes (ACTIVE) or removes (REVOKED) it.
    pub device_id: String,
    /// `Kasir 1` as the node names it; the hub shows `Till 1`.
    pub label: String,
    /// The PC's name, as the till said when it joined.
    pub machine: Option<String>,
    /// `ACTIVE`, `SUSPENDED` or `REVOKED`, as the node last reported.
    pub status: String,
    /// Head office's decision still on its way to the node, if any.
    pub requested_status: Option<String>,
    /// The newest stop or removal, from the device's history.
    pub stop: Option<PosStopNote>,
    pub last_seen_at: Option<DateTime<Utc>>,
    /// The drawer open at this till's seat.
    pub open_shift: Option<StorePosShift>,
    /// Whether head office can switch it from here: its node takes device
    /// decisions (`RegistryDevice::switchable`).
    pub switchable: bool,
}

/// One person who signs in at the store's tills, for the Tills tab.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePosCashier {
    pub user_id: Uuid,
    pub username: String,
    pub name: String,
    /// The job role's name (`Cashier`, `Store manager`).
    pub role: String,
    /// When they last opened a shift at this store, as head office heard.
    pub last_shift_at: Option<DateTime<Utc>>,
    /// Head office's stop on the POS, at every store.
    pub stop: Option<PosStopNote>,
}

/// `GET /api/v1/stores/{unit}/pos`: the store's Tills tab.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePos {
    pub tills: Vec<StorePosTill>,
    pub cashiers: Vec<StorePosCashier>,
    /// Whether the caller may stop, resume and remove here — an Admin at
    /// head office.
    pub can_manage: bool,
}

fn reason_of(reason: &str) -> Result<String, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "say why: the till shows the reason".into(),
        ));
    }
    if reason.chars().count() > REASON_MAX_CHARS {
        return Err(AppError::Validation(format!(
            "keep the reason under {REASON_MAX_CHARS} characters"
        )));
    }
    Ok(reason.to_string())
}

/// The unit, locked, refused unless it is a store.
struct LockedStore {
    code: String,
    name: String,
    status: String,
    opened: bool,
    stopped: bool,
}

async fn lock_store(
    tx: &mut Transaction<'_, Postgres>,
    unit_id: &str,
) -> Result<LockedStore, AppError> {
    let row = sqlx::query(
        "SELECT kind, code, name, status, opened_at IS NOT NULL AS opened,
                stopped_at IS NOT NULL AS stopped
           FROM unit WHERE id = $1 FOR UPDATE",
    )
    .bind(unit_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("store {unit_id}")))?;
    let kind: String = row.try_get("kind")?;
    if kind != "STORE" {
        return Err(AppError::Conflict(format!(
            "{unit_id} is not a store; only a store's tills are stopped from here"
        )));
    }
    let store = LockedStore {
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        status: row.try_get("status")?,
        opened: row.try_get("opened")?,
        stopped: row.try_get("stopped")?,
    };
    if store.status == "CLOSED" {
        return Err(AppError::Conflict(format!(
            "{} ({}) has been removed",
            store.name, store.code
        )));
    }
    Ok(store)
}

/// Head office stops a store: its tills sell nothing and open no shift until
/// it is resumed. Its server keeps syncing and its store app keeps working.
pub async fn stop_store(
    pool: &PgPool,
    unit_id: &str,
    request: PosStopRequest,
    actor: &str,
) -> Result<(), AppError> {
    let reason = reason_of(&request.reason)?;
    let mut tx = pool.begin().await?;
    let store = lock_store(&mut tx, unit_id).await?;
    if store.stopped {
        return Err(AppError::Conflict(format!(
            "{} ({}) is already stopped",
            store.name, store.code
        )));
    }
    if !store.opened {
        return Err(AppError::Conflict(format!(
            "{} ({}) is still getting ready; its tills open no shift until it is opened",
            store.name, store.code
        )));
    }
    sqlx::query(
        "UPDATE unit
            SET stopped_at = now(), stopped_by = $2, stopped_reason = $3, updated_at = now()
          WHERE id = $1",
    )
    .bind(unit_id)
    .bind(actor)
    .bind(&reason)
    .execute(&mut *tx)
    .await?;
    let origins = mark_store_nodes_due(&mut tx, unit_id).await?;
    tx.commit().await?;
    tracing::info!(unit = %unit_id, %actor, "head office stopped a store's tills");
    publish_node_access(pool, &origins, actor).await;
    Ok(())
}

/// Head office lets a stopped store trade again.
pub async fn resume_store(pool: &PgPool, unit_id: &str, actor: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let store = lock_store(&mut tx, unit_id).await?;
    if !store.stopped {
        return Err(AppError::Conflict(format!(
            "{} ({}) is not stopped",
            store.name, store.code
        )));
    }
    sqlx::query(
        "UPDATE unit
            SET stopped_at = NULL, stopped_by = NULL, stopped_reason = NULL, updated_at = now()
          WHERE id = $1",
    )
    .bind(unit_id)
    .execute(&mut *tx)
    .await?;
    let origins = mark_store_nodes_due(&mut tx, unit_id).await?;
    tx.commit().await?;
    tracing::info!(unit = %unit_id, %actor, "head office resumed a store's tills");
    publish_node_access(pool, &origins, actor).await;
    Ok(())
}

/// Head office removes a store that has closed for good.
///
/// Only a stopped store, only with every drawer closed, and only when the
/// person typed the store's code. The unit is closed (`status = 'CLOSED'`),
/// which takes the store out of the active lists; its sales, stock, journals
/// and people keep pointing at it. Its tills are removed (REVOKED) on its
/// node. A till whose node cannot take that decision is left as it is — the
/// store is stopped, so it sells nothing either way.
pub async fn remove_store(
    pool: &PgPool,
    unit_id: &str,
    request: RemoveStoreRequest,
    actor: &str,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let store = lock_store(&mut tx, unit_id).await?;
    if !store.stopped {
        return Err(AppError::Conflict(format!(
            "stop {} ({}) before removing it",
            store.name, store.code
        )));
    }
    if !request.code.trim().eq_ignore_ascii_case(&store.code) {
        return Err(AppError::Validation(format!(
            "type {} to remove {}",
            store.code, store.name
        )));
    }
    let open: i64 = sqlx::query_scalar(
        "SELECT count(*)
           FROM cash_shift c
           JOIN site s ON s.id = c.site_id
          WHERE s.unit_id = $1 AND c.status = 'OPEN'",
    )
    .bind(unit_id)
    .fetch_one(&mut *tx)
    .await?;
    if open > 0 {
        return Err(AppError::Conflict(format!(
            "{open} {} still open at {}; close {} at the till first",
            if open == 1 { "shift is" } else { "shifts are" },
            store.name,
            if open == 1 { "it" } else { "them" },
        )));
    }
    sqlx::query(
        "UPDATE unit
            SET status = 'CLOSED', closed_at = now(), closed_by = $2, updated_at = now()
          WHERE id = $1",
    )
    .bind(unit_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    let tills: Vec<String> = sqlx::query_scalar(
        "SELECT d.device_id
           FROM device d
           JOIN site s ON s.id = d.site_id
          WHERE s.unit_id = $1 AND d.kind = 'TILL' AND d.status <> $2
          ORDER BY d.device_id",
    )
    .bind(unit_id)
    .bind(STATUS_REVOKED)
    .fetch_all(&mut *tx)
    .await?;
    for device_id in tills {
        let request = DeviceStatusRequest {
            status: STATUS_REVOKED.into(),
            reason: Some(format!("{} removed", store.name)),
        };
        match device_status_tx(&mut tx, &device_id, request, actor, None).await {
            Ok(_) => {}
            // Refused before anything was written — a node too old to take
            // the decision. The store is stopped; the till sells nothing.
            Err(AppError::Conflict(message)) => {
                tracing::warn!(%device_id, %message, "a removed store's till was left as it is");
            }
            Err(other) => return Err(other),
        }
    }
    let origins = mark_store_nodes_due(&mut tx, unit_id).await?;
    tx.commit().await?;
    tracing::info!(unit = %unit_id, %actor, "head office removed a store");
    publish_node_access(pool, &origins, actor).await;
    Ok(())
}

/// Head office stops one person on the POS, at every store.
pub async fn stop_cashier(
    pool: &PgPool,
    user_id: Uuid,
    request: PosStopRequest,
    actor: &str,
) -> Result<(), AppError> {
    let reason = reason_of(&request.reason)?;
    let mut tx = pool.begin().await?;
    let stopped: Option<bool> = sqlx::query_scalar(
        "SELECT till_stopped_at IS NOT NULL FROM app_user WHERE id = $1 FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    match stopped {
        None => return Err(AppError::NotFound(format!("user {user_id}"))),
        Some(true) => {
            return Err(AppError::Conflict(
                "this person is already stopped on the POS".into(),
            ))
        }
        Some(false) => {}
    }
    sqlx::query(
        "UPDATE app_user
            SET till_stopped_at = now(), till_stopped_by = $2, till_stopped_reason = $3,
                updated_at = now()
          WHERE id = $1",
    )
    .bind(user_id)
    .bind(actor)
    .bind(&reason)
    .execute(&mut *tx)
    .await?;
    let origins = mark_user_nodes_due(&mut tx, user_id).await?;
    tx.commit().await?;
    tracing::info!(%user_id, %actor, "head office stopped a person on the POS");
    publish_node_access(pool, &origins, actor).await;
    Ok(())
}

/// Head office lets a stopped person back on the POS.
pub async fn resume_cashier(pool: &PgPool, user_id: Uuid, actor: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let stopped: Option<bool> = sqlx::query_scalar(
        "SELECT till_stopped_at IS NOT NULL FROM app_user WHERE id = $1 FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    match stopped {
        None => return Err(AppError::NotFound(format!("user {user_id}"))),
        Some(false) => {
            return Err(AppError::Conflict(
                "this person is not stopped on the POS".into(),
            ))
        }
        Some(true) => {}
    }
    sqlx::query(
        "UPDATE app_user
            SET till_stopped_at = NULL, till_stopped_by = NULL, till_stopped_reason = NULL,
                updated_at = now()
          WHERE id = $1",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    let origins = mark_user_nodes_due(&mut tx, user_id).await?;
    tx.commit().await?;
    tracing::info!(%user_id, %actor, "head office resumed a person on the POS");
    publish_node_access(pool, &origins, actor).await;
    Ok(())
}

/// The servers of a store, marked due for a fresh auth policy.
async fn mark_store_nodes_due(
    tx: &mut Transaction<'_, Postgres>,
    unit_id: &str,
) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO edge_auth_policy_due (origin_id)
         SELECT DISTINCT c.origin_id
           FROM sync_origin_credential c
           JOIN site s ON s.id = c.site_id
          WHERE s.unit_id = $1 AND c.revoked_at IS NULL
         ON CONFLICT (origin_id) DO UPDATE SET since = edge_auth_policy_due.since
         RETURNING origin_id",
    )
    .bind(unit_id)
    .fetch_all(&mut **tx)
    .await?)
}

/// Every server that signs this person in, marked due for a fresh policy.
async fn mark_user_nodes_due(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO edge_auth_policy_due (origin_id)
         SELECT DISTINCT origin_id FROM edge_identity_assignment WHERE user_id = $1
         ON CONFLICT (origin_id) DO UPDATE SET since = edge_auth_policy_due.since
         RETURNING origin_id",
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?)
}

/// What one node is told about stops on its POS: its own store's, and every
/// person it signs in whom head office stopped. Read in the publication's
/// own transaction (`auth_policy::publish_auth_policy`).
pub(super) async fn pos_stops_for(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    site_id: &str,
) -> Result<PosStops, AppError> {
    let store = sqlx::query(
        "SELECT u.stopped_at, u.stopped_by, u.stopped_reason, u.closed_at, u.closed_by
           FROM site s JOIN unit u ON u.id = s.unit_id
          WHERE s.id = $1",
    )
    .bind(site_id)
    .fetch_optional(&mut **tx)
    .await?;
    let store = match store {
        None => None,
        Some(row) => {
            let stopped_at: Option<DateTime<Utc>> = row.try_get("stopped_at")?;
            let closed_at: Option<DateTime<Utc>> = row.try_get("closed_at")?;
            match (stopped_at, closed_at) {
                (Some(at), removed_at) => Some(PosStop {
                    at,
                    by: row
                        .try_get::<Option<String>, _>("stopped_by")?
                        .unwrap_or_default(),
                    reason: row
                        .try_get::<Option<String>, _>("stopped_reason")?
                        .unwrap_or_default(),
                    removed_at,
                }),
                // Closed some other way than from here: still no selling.
                (None, Some(at)) => Some(PosStop {
                    at,
                    by: row
                        .try_get::<Option<String>, _>("closed_by")?
                        .unwrap_or_default(),
                    reason: String::new(),
                    removed_at: Some(at),
                }),
                (None, None) => None,
            }
        }
    };
    let people = sqlx::query(
        "SELECT DISTINCT u.id, u.till_stopped_at, u.till_stopped_by, u.till_stopped_reason
           FROM edge_identity_assignment a
           JOIN app_user u ON u.id = a.user_id
          WHERE a.origin_id = $1 AND u.till_stopped_at IS NOT NULL
          ORDER BY u.id",
    )
    .bind(origin_id)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|row| -> Result<PersonPosStop, AppError> {
        Ok(PersonPosStop {
            user_id: row.try_get("id")?,
            stop: PosStop {
                at: row.try_get("till_stopped_at")?,
                by: row
                    .try_get::<Option<String>, _>("till_stopped_by")?
                    .unwrap_or_default(),
                reason: row
                    .try_get::<Option<String>, _>("till_stopped_reason")?
                    .unwrap_or_default(),
                removed_at: None,
            },
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    Ok(PosStops { store, people })
}

fn note_of(
    at: Option<DateTime<Utc>>,
    by: Option<String>,
    reason: Option<String>,
) -> Option<PosStopNote> {
    at.map(|at| PosStopNote {
        at,
        by: by.unwrap_or_default(),
        reason: reason.unwrap_or_default(),
    })
}

/// The store's Tills tab: its tills from the register, each with the drawer
/// open at its seat and its newest stop; and the people its servers sign in
/// as cashier or supervisor, each with their last shift here and their stop.
pub async fn store_pos(
    pool: &PgPool,
    unit_id: &str,
    can_manage: bool,
) -> Result<StorePos, AppError> {
    let kind: Option<String> = sqlx::query_scalar("SELECT kind FROM unit WHERE id = $1")
        .bind(unit_id)
        .fetch_optional(pool)
        .await?;
    match kind.as_deref() {
        Some("STORE") => {}
        Some(_) => {
            return Err(AppError::Conflict(format!(
                "{unit_id} is not a store; only a store has tills"
            )))
        }
        None => return Err(AppError::NotFound(format!("store {unit_id}"))),
    }
    // A till's seat is `KASIR-n` (`edge::till::seat_label`): the node names
    // the n-th till `Kasir n`, and a drawer is kept by its seat. A till from
    // before seats kept its drawer under its own id.
    let tills = sqlx::query(
        "SELECT d.device_id, d.label, d.config -> 'machine' ->> 'hostname' AS machine,
                d.status, d.requested_status, d.last_seen_at,
                COALESCE(h.status ? 'device_list', false) AS node_takes_commands,
                stop.at AS stop_at, stop.actor AS stop_by, stop.reason AS stop_reason,
                shift.name AS shift_name, shift.opened_at AS shift_opened_at
           FROM device d
           JOIN site s ON s.id = d.site_id
           LEFT JOIN node_heartbeat h ON h.origin_id = d.origin_id
           LEFT JOIN LATERAL (
               SELECT e.at, e.actor, e.reason
                 FROM device_status_event e
                WHERE e.device_id = d.device_id
                  AND e.to_status IN ($2, $3)
                ORDER BY e.at DESC
                LIMIT 1
           ) stop ON d.status <> 'ACTIVE' OR d.requested_status IN ($2, $3)
           LEFT JOIN LATERAL (
               SELECT COALESCE(NULLIF(btrim(u.display_name), ''), c.opened_by) AS name,
                      c.opened_at
                 FROM cash_shift c
                 LEFT JOIN app_user u ON u.username = c.opened_by
                WHERE c.site_id = d.site_id AND c.status = 'OPEN'
                  AND (c.terminal_id = d.device_id
                       OR c.terminal_id = 'KASIR-' || substring(d.label FROM '^Kasir ([0-9]+)$'))
                ORDER BY c.opened_at DESC
                LIMIT 1
           ) shift ON true
          WHERE s.unit_id = $1 AND d.kind = 'TILL'
          ORDER BY (d.status = 'REVOKED'), d.label, d.device_id",
    )
    .bind(unit_id)
    .bind(STATUS_SUSPENDED)
    .bind(STATUS_REVOKED)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| -> Result<StorePosTill, AppError> {
        let status: String = row.try_get("status")?;
        let shift_opened_at: Option<DateTime<Utc>> = row.try_get("shift_opened_at")?;
        let shift_name: Option<String> = row.try_get("shift_name")?;
        let node_takes_commands: bool = row.try_get("node_takes_commands")?;
        Ok(StorePosTill {
            device_id: row.try_get("device_id")?,
            label: row.try_get("label")?,
            machine: row.try_get("machine")?,
            switchable: node_takes_commands && status != STATUS_REVOKED,
            status,
            requested_status: row.try_get("requested_status")?,
            stop: note_of(
                row.try_get("stop_at")?,
                row.try_get("stop_by")?,
                row.try_get("stop_reason")?,
            ),
            last_seen_at: row.try_get("last_seen_at")?,
            open_shift: match (shift_name, shift_opened_at) {
                (Some(name), Some(opened_at)) => Some(StorePosShift { name, opened_at }),
                _ => None,
            },
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let cashiers = sqlx::query(
        "WITH people AS (
             SELECT DISTINCT a.user_id
               FROM site s
               JOIN sync_origin_credential o ON o.site_id = s.id
               JOIN edge_identity_assignment a ON a.origin_id = o.origin_id
              WHERE s.unit_id = $1 AND a.active AND a.edge_role IN ('CASHIER', 'SUPERVISOR')
         )
         SELECT u.id, u.username,
                COALESCE(NULLIF(btrim(u.display_name), ''), u.username) AS name,
                COALESCE(r.name, initcap(lower(u.role))) AS role_name,
                u.till_stopped_at, u.till_stopped_by, u.till_stopped_reason,
                (SELECT max(c.opened_at)
                   FROM cash_shift c JOIN site s ON s.id = c.site_id
                  WHERE s.unit_id = $1 AND c.opened_by = u.username) AS last_shift_at
           FROM people p
           JOIN app_user u ON u.id = p.user_id AND u.active
           LEFT JOIN job_role r ON r.code = u.role_code
          ORDER BY (r.rung = 'CASHIER') NULLS LAST, name",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| -> Result<StorePosCashier, AppError> {
        Ok(StorePosCashier {
            user_id: row.try_get("id")?,
            username: row.try_get("username")?,
            name: row.try_get("name")?,
            role: row.try_get("role_name")?,
            last_shift_at: row.try_get("last_shift_at")?,
            stop: note_of(
                row.try_get("till_stopped_at")?,
                row.try_get("till_stopped_by")?,
                row.try_get("till_stopped_reason")?,
            ),
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(StorePos {
        tills,
        cashiers,
        can_manage,
    })
}
