//! Head office's device registry: every machine enrolled to a node, fed by
//! the nodes' heartbeats, and the one thing head office may do to a till or a
//! printer from a distance — suspend, reactivate or revoke it.
//!
//! The vocabulary is `sync::device`, shared with the node. Tables in
//! migration 0604.
//!
//! # Whose word is the status
//!
//! For a till and a printer, the node's. It is where a till's signature is
//! checked and where a print is sent, so what the node last reported is what
//! is true. Head office's decision is a *request* — kept in `requested_*` and
//! sent as a signed `device.status.set.v1` command — until a heartbeat reports
//! the device in that status, which clears it. Every other kind keeps its
//! authority where it already was (`rfid_device`, `attendance_terminal`,
//! `edc_terminal`) and is only mirrored here.
//!
//! # Only to a node that understands
//!
//! An edge build that predates the registry does not know the command type,
//! and an unknown type blocks a node's whole command stream. The heartbeat is
//! how head office tells them apart: a node that reports devices at all
//! (`device_list` present in its latest status) takes device commands; one
//! that does not is refused here, with the reason, before anything is sent.

use crate::cloud::application::AppError;
use crate::sync::device::{
    self as wire, DeviceReport, DeviceStatusCommand, COMMAND_DEVICE_STATUS_SET, STATUS_ACTIVE,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

/// File what one node reported about its devices, inside the heartbeat's own
/// transaction. Returns how many rows were filed.
///
/// A node can only ever report its own devices: a row that already belongs to
/// another node is left alone and logged, so one misconfigured shop cannot
/// move another shop's till onto its own list. Rows this cloud cannot file —
/// an unknown kind from a newer node, an empty id — are skipped the same way,
/// rather than failing the heartbeat they came in.
///
/// An RFID key is filed under the kind head office registered it as
/// (`rfid_device.kind`, 0623), whatever the node says: a node older than that
/// reports every key as an `RFID_READER`, and head office is the one that
/// knows which of them are handhelds.
pub async fn record_reported_devices(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    reports: &[DeviceReport],
) -> Result<usize, AppError> {
    // The node's registered site, never the one it claims in its status: a
    // device inherits its site from its node, and the node's is head office's
    // to say.
    let site_id: Option<String> = sqlx::query_scalar::<_, Option<String>>(
        "SELECT site_id FROM sync_origin_credential WHERE origin_id = $1",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    let Some(site_id) = site_id else {
        return Ok(0);
    };

    let now = Utc::now();
    let mut filed = 0;
    for report in reports {
        let device_id = report.device_id.trim();
        if device_id.is_empty()
            || device_id.len() > 128
            || !wire::is_kind(&report.kind)
            || !wire::is_status(&report.status)
        {
            tracing::warn!(
                origin_id,
                device_id,
                kind = %report.kind,
                status = %report.status,
                "a reported device was not filed"
            );
            continue;
        }
        let label: String = match report.label.trim() {
            "" => device_id.to_string(),
            label => label.chars().take(128).collect(),
        };
        let config = if report.config.is_object() {
            report.config.clone()
        } else {
            json!({})
        };

        let current: Option<(String, String)> =
            sqlx::query_as("SELECT origin_id, status FROM device WHERE device_id = $1 FOR UPDATE")
                .bind(device_id)
                .fetch_optional(&mut **tx)
                .await?;

        let previous = match current {
            Some((owner, _)) if owner != origin_id => {
                tracing::warn!(
                    origin_id,
                    device_id,
                    owner = %owner,
                    "a node reported a device registered to another node; left alone"
                );
                continue;
            }
            Some((_, previous)) => {
                sqlx::query(
                    "UPDATE device SET
                         kind = CASE WHEN $2 IN ('RFID_READER', 'HANDHELD')
                             THEN COALESCE((SELECT r.kind FROM rfid_device r WHERE r.device_id = $1), $2)
                             ELSE $2 END,
                         site_id = $3, label = $4, status = $5,
                         last_seen_at = GREATEST(last_seen_at, $6),
                         config = $7,
                         replaces_device_id = COALESCE($8, replaces_device_id),
                         registered_at = COALESCE(registered_at, $9),
                         registered_by = COALESCE(registered_by, $10),
                         rfid_device_id = CASE WHEN $2 IN ('RFID_READER', 'HANDHELD')
                             THEN (SELECT r.device_id FROM rfid_device r WHERE r.device_id = $1)
                             ELSE rfid_device_id END,
                         requested_by = CASE WHEN requested_status = $5 THEN NULL ELSE requested_by END,
                         requested_at = CASE WHEN requested_status = $5 THEN NULL ELSE requested_at END,
                         requested_reason = CASE WHEN requested_status = $5 THEN NULL ELSE requested_reason END,
                         requested_command_id = CASE WHEN requested_status = $5 THEN NULL ELSE requested_command_id END,
                         requested_status = CASE WHEN requested_status = $5 THEN NULL ELSE requested_status END,
                         updated_at = now()
                     WHERE device_id = $1",
                )
                .bind(device_id)
                .bind(&report.kind)
                .bind(&site_id)
                .bind(&label)
                .bind(&report.status)
                .bind(report.last_seen_at)
                .bind(&config)
                .bind(&report.replaces)
                .bind(report.registered_at)
                .bind(&report.registered_by)
                .execute(&mut **tx)
                .await?;
                Some(previous)
            }
            None => {
                let inserted = sqlx::query(
                    "INSERT INTO device
                         (device_id, kind, origin_id, site_id, label, status, last_seen_at,
                          config, replaces_device_id, registered_at, registered_by, rfid_device_id)
                     VALUES ($1,
                             CASE WHEN $2 IN ('RFID_READER', 'HANDHELD')
                                  THEN COALESCE((SELECT r.kind FROM rfid_device r WHERE r.device_id = $1), $2)
                                  ELSE $2 END,
                             $3, $4, $5, $6, $7, $8, $9, $10, $11,
                             CASE WHEN $2 IN ('RFID_READER', 'HANDHELD')
                                  THEN (SELECT r.device_id FROM rfid_device r WHERE r.device_id = $1)
                             END)
                     ON CONFLICT (device_id) DO NOTHING",
                )
                .bind(device_id)
                .bind(&report.kind)
                .bind(origin_id)
                .bind(&site_id)
                .bind(&label)
                .bind(&report.status)
                .bind(report.last_seen_at)
                .bind(&config)
                .bind(&report.replaces)
                .bind(report.registered_at)
                .bind(&report.registered_by)
                .execute(&mut **tx)
                .await?
                .rows_affected();
                if inserted == 0 {
                    // Another heartbeat from the same node filed it a moment
                    // ago; the next one reconciles.
                    continue;
                }
                None
            }
        };

        if previous.as_deref() != Some(report.status.as_str()) {
            let actor = report
                .status_changed_by
                .clone()
                .or_else(|| report.registered_by.clone())
                .unwrap_or_else(|| format!("node {origin_id}"));
            let reason = match (&previous, &report.status_reason) {
                (_, Some(reason)) => Some(reason.clone()),
                (None, None) => Some("first reported by its node".to_string()),
                (Some(_), None) => None,
            };
            sqlx::query(
                "INSERT INTO device_status_event
                     (device_id, source, from_status, to_status, actor, reason, at)
                 VALUES ($1, 'NODE', $2, $3, $4, $5, $6)",
            )
            .bind(device_id)
            .bind(&previous)
            .bind(&report.status)
            .bind(&actor)
            .bind(&reason)
            .bind(report.status_changed_at.unwrap_or(now))
            .execute(&mut **tx)
            .await?;
        }
        filed += 1;
    }
    Ok(filed)
}

/// One device as the hub shows it.
#[derive(Debug, Serialize)]
pub struct RegistryDevice {
    pub device_id: String,
    pub kind: String,
    pub origin_id: String,
    pub node_label: Option<String>,
    pub site_id: String,
    pub site_name: Option<String>,
    pub label: String,
    pub status: String,
    pub requested_status: Option<String>,
    pub requested_by: Option<String>,
    pub requested_at: Option<DateTime<Utc>>,
    pub requested_reason: Option<String>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub config: Value,
    pub replaces_device_id: Option<String>,
    pub rfid_device_id: Option<String>,
    pub attendance_terminal_id: Option<String>,
    pub registered_at: Option<DateTime<Utc>>,
    pub registered_by: Option<String>,
    pub first_reported_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Whether head office can suspend, reactivate or revoke it from here: a
    /// till or a printer, not yet revoked, on a node that takes device
    /// commands.
    pub switchable: bool,
}

const REGISTRY_SELECT: &str = "
    SELECT d.device_id, d.kind, d.origin_id, c.label AS node_label, d.site_id,
           s.name AS site_name, d.label, d.status, d.requested_status, d.requested_by,
           d.requested_at, d.requested_reason, d.last_seen_at, d.config,
           d.replaces_device_id, d.rfid_device_id, d.attendance_terminal_id,
           d.registered_at, d.registered_by, d.first_reported_at, d.updated_at,
           COALESCE(h.status ? 'device_list', false) AS node_takes_commands
      FROM device d
      LEFT JOIN site s ON s.id = d.site_id
      LEFT JOIN sync_origin_credential c ON c.origin_id = d.origin_id
      LEFT JOIN node_heartbeat h ON h.origin_id = d.origin_id";

fn registry_row(row: &sqlx::postgres::PgRow) -> RegistryDevice {
    let kind: String = row.get("kind");
    let status: String = row.get("status");
    let node_takes_commands: bool = row.get("node_takes_commands");
    RegistryDevice {
        switchable: node_takes_commands && wire::node_owns(&kind) && status != wire::STATUS_REVOKED,
        device_id: row.get("device_id"),
        kind,
        origin_id: row.get("origin_id"),
        node_label: row.get("node_label"),
        site_id: row.get("site_id"),
        site_name: row.get("site_name"),
        label: row.get("label"),
        status,
        requested_status: row.get("requested_status"),
        requested_by: row.get("requested_by"),
        requested_at: row.get("requested_at"),
        requested_reason: row.get("requested_reason"),
        last_seen_at: row.get("last_seen_at"),
        config: row.get("config"),
        replaces_device_id: row.get("replaces_device_id"),
        rfid_device_id: row.get("rfid_device_id"),
        attendance_terminal_id: row.get("attendance_terminal_id"),
        registered_at: row.get("registered_at"),
        registered_by: row.get("registered_by"),
        first_reported_at: row.get("first_reported_at"),
        updated_at: row.get("updated_at"),
    }
}

/// Every device, or every device at one site: by site, then kind, then
/// label, so a shop's tills read Kasir 1, Kasir 2, Kasir 3.
pub async fn device_registry(
    pool: &PgPool,
    site_id: Option<&str>,
) -> Result<Vec<RegistryDevice>, AppError> {
    let sql = format!(
        "{REGISTRY_SELECT}
          WHERE ($1::text IS NULL OR d.site_id = $1)
          ORDER BY d.site_id, d.kind, d.label"
    );
    let rows = sqlx::query(&sql).bind(site_id).fetch_all(pool).await?;
    Ok(rows.iter().map(registry_row).collect())
}

pub async fn registry_device(pool: &PgPool, device_id: &str) -> Result<RegistryDevice, AppError> {
    let sql = format!("{REGISTRY_SELECT} WHERE d.device_id = $1");
    let row = sqlx::query(&sql)
        .bind(device_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("device {device_id}")))?;
    Ok(registry_row(&row))
}

/// One line of a device's history.
#[derive(Debug, Serialize)]
pub struct DeviceStatusEvent {
    /// `NODE` — the node reported it happened; `HUB` — head office asked.
    pub source: String,
    pub from_status: Option<String>,
    pub to_status: String,
    pub actor: String,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
}

/// A device's history, newest first.
pub async fn device_history(
    pool: &PgPool,
    device_id: &str,
) -> Result<Vec<DeviceStatusEvent>, AppError> {
    let rows = sqlx::query(
        "SELECT source, from_status, to_status, actor, reason, at
           FROM device_status_event
          WHERE device_id = $1
          ORDER BY at DESC, id DESC
          LIMIT 200",
    )
    .bind(device_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|row| DeviceStatusEvent {
            source: row.get("source"),
            from_status: row.get("from_status"),
            to_status: row.get("to_status"),
            actor: row.get("actor"),
            reason: row.get("reason"),
            at: row.get("at"),
        })
        .collect())
}

/// `POST /api/v1/sync/devices/{device_id}/status`.
#[derive(Debug, Deserialize)]
pub struct DeviceStatusRequest {
    /// `ACTIVE`, `SUSPENDED` or `REVOKED`.
    pub status: String,
    /// Required for anything but ACTIVE: a till switched off with no reason is
    /// a question nobody can answer later.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Head office asks a node to suspend, reactivate or revoke one of its tills
/// or printers.
///
/// Recorded as a request and a `HUB` history line, and sent as a signed
/// command to that node only, in one transaction. The device's `status`
/// changes when the node's next heartbeat reports it — which is also what
/// clears the request.
pub async fn request_device_status(
    pool: &PgPool,
    device_id: &str,
    request: DeviceStatusRequest,
    actor: &str,
) -> Result<RegistryDevice, AppError> {
    let status = request.status.trim().to_ascii_uppercase();
    if !wire::is_status(&status) {
        return Err(AppError::Validation(format!(
            "{status} is not a device status; say ACTIVE, SUSPENDED or REVOKED"
        )));
    }
    let reason = request
        .reason
        .map(|reason| reason.trim().to_string())
        .filter(|reason| !reason.is_empty());
    if status != STATUS_ACTIVE && reason.is_none() {
        return Err(AppError::Validation(
            "say why: the shop reads the reason when its till stops working".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let row: Option<(String, String, String, Option<bool>)> = sqlx::query_as(
        "SELECT d.kind, d.status, d.origin_id, (h.status ? 'device_list')
           FROM device d
           LEFT JOIN node_heartbeat h ON h.origin_id = d.origin_id
          WHERE d.device_id = $1
            FOR UPDATE OF d",
    )
    .bind(device_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((kind, current, origin_id, takes_commands)) = row else {
        return Err(AppError::NotFound(format!("device {device_id}")));
    };
    if !wire::node_owns(&kind) {
        return Err(AppError::Conflict(format!(
            "a {} is switched on and off where its credential is kept (RFID readers in \
             System → Access, attendance terminals in People, EDCs in Finance), not here",
            kind.to_ascii_lowercase().replace('_', " ")
        )));
    }
    if !wire::may_become(&current, &status) {
        return Err(AppError::Conflict(format!(
            "this {} is {}; it cannot become {}",
            kind.to_ascii_lowercase(),
            current.to_ascii_lowercase(),
            status.to_ascii_lowercase()
        )));
    }
    if takes_commands != Some(true) {
        return Err(AppError::Conflict(
            "this device's node runs a version that cannot take a device decision from head \
             office; update the node, or switch the device at the shop"
                .into(),
        ));
    }

    let now = Utc::now();
    let command = DeviceStatusCommand {
        device_id: device_id.to_string(),
        kind,
        status: status.clone(),
        reason: reason.clone(),
        decided_by: actor.to_string(),
        decided_at: now,
    };
    let payload = serde_json::to_value(&command)?;
    let command_id = super::sync::issue_command_tx(
        &mut tx,
        COMMAND_DEVICE_STATUS_SET,
        &payload,
        actor,
        None,
        std::slice::from_ref(&origin_id),
    )
    .await?;
    sqlx::query(
        "UPDATE device
            SET requested_status = $2, requested_by = $3, requested_at = $4,
                requested_reason = $5, requested_command_id = $6, updated_at = now()
          WHERE device_id = $1",
    )
    .bind(device_id)
    .bind(&status)
    .bind(actor)
    .bind(now)
    .bind(&reason)
    .bind(command_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO device_status_event (device_id, source, from_status, to_status, actor, reason, at)
         VALUES ($1, 'HUB', $2, $3, $4, $5, $6)",
    )
    .bind(device_id)
    .bind(&current)
    .bind(&status)
    .bind(actor)
    .bind(&reason)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    registry_device(pool, device_id).await
}
