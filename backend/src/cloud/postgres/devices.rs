//! Head office's device registry: every machine enrolled to a node, fed by
//! the nodes' heartbeats, and the one thing head office may do to a till or a
//! printer from a distance — suspend, reactivate or revoke it.
//!
//! The vocabulary is `sync::device`, shared with the node. Tables in
//! migration 0604; the register is read through the `device_register` view
//! (0624).
//!
//! # Two ways onto the list
//!
//! What a node holds — its tills, its printers, the RFID keys it trusts — the
//! node reports in every heartbeat, and it is filed in `device`. What head
//! office registers at a site itself — punch stations (`attendance_terminal`)
//! and EDCs (`edc_terminal`) — is not reported by anybody: the view links
//! those rows by id to their site and to the node that serves it when the
//! register is read. Head office already holds every fact about them, a node
//! was never sent an EDC at all, and a terminal at a site with no node must
//! still be listed; the migration says so at length. `source` says which way a
//! row came in, and it is what [`device_history`] reads, never the id.
//!
//! # Whose word is the status
//!
//! For a till and a printer, the node's. It is where a till's signature is
//! checked and where a print is sent, so what the node last reported is what
//! is true. Head office's decision is a *request* — kept in `requested_*` and
//! sent as a signed `device.status.set.v1` command — until a heartbeat reports
//! the device in that status, which clears it. Every other kind keeps its
//! authority where it already was (`rfid_device`, `attendance_terminal`,
//! `edc_terminal`) and is only shown here.
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
    self as wire, DeviceReport, DeviceStatusCommand, DeviceTestPrintCommand,
    COMMAND_DEVICE_STATUS_SET, COMMAND_DEVICE_TEST_PRINT, STATUS_ACTIVE, TEST_PRINT_CAPABILITY,
};
use uuid::Uuid;
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
        // A test page is kept whole or not at all (0632): when it was
        // printed, whether it came out, and why not.
        let printed = match (report.last_test_print_at, report.last_test_print_ok) {
            (Some(at), Some(ok)) => Some((at, ok)),
            _ => None,
        };
        let printed_error = printed
            .filter(|(_, ok)| !ok)
            .and(report.last_test_print_error.as_deref())
            .map(|error| error.chars().take(500).collect::<String>());

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
                         last_test_print_ok = CASE
                             WHEN $11::timestamptz IS NOT NULL
                              AND (last_test_print_at IS NULL OR $11 >= last_test_print_at)
                             THEN $12 ELSE last_test_print_ok END,
                         last_test_print_error = CASE
                             WHEN $11::timestamptz IS NOT NULL
                              AND (last_test_print_at IS NULL OR $11 >= last_test_print_at)
                             THEN $13 ELSE last_test_print_error END,
                         last_test_print_at = CASE
                             WHEN $11::timestamptz IS NOT NULL
                              AND (last_test_print_at IS NULL OR $11 >= last_test_print_at)
                             THEN $11 ELSE last_test_print_at END,
                         test_print_requested_at = CASE WHEN test_print_request_id = $14::uuid
                             THEN NULL ELSE test_print_requested_at END,
                         test_print_requested_by = CASE WHEN test_print_request_id = $14::uuid
                             THEN NULL ELSE test_print_requested_by END,
                         test_print_request_id = CASE WHEN test_print_request_id = $14::uuid
                             THEN NULL ELSE test_print_request_id END,
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
                .bind(printed.map(|(at, _)| at))
                .bind(printed.map(|(_, ok)| ok))
                .bind(&printed_error)
                .bind(report.last_test_print_request_id)
                .execute(&mut **tx)
                .await?;
                Some(previous)
            }
            None => {
                let inserted = sqlx::query(
                    "INSERT INTO device
                         (device_id, kind, origin_id, site_id, label, status, last_seen_at,
                          config, replaces_device_id, registered_at, registered_by, rfid_device_id,
                          last_test_print_at, last_test_print_ok, last_test_print_error)
                     VALUES ($1,
                             CASE WHEN $2 IN ('RFID_READER', 'HANDHELD')
                                  THEN COALESCE((SELECT r.kind FROM rfid_device r WHERE r.device_id = $1), $2)
                                  ELSE $2 END,
                             $3, $4, $5, $6, $7, $8, $9, $10, $11,
                             CASE WHEN $2 IN ('RFID_READER', 'HANDHELD')
                                  THEN (SELECT r.device_id FROM rfid_device r WHERE r.device_id = $1)
                             END,
                             $12, $13, $14)
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
                .bind(printed.map(|(at, _)| at))
                .bind(printed.map(|(_, ok)| ok))
                .bind(&printed_error)
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RegistryDevice {
    pub device_id: String,
    pub kind: String,
    /// The node it is enrolled to, or — for a terminal head office registered
    /// at a site — the node that serves that site. `None` for a terminal at a
    /// site with no node.
    pub origin_id: Option<String>,
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
    /// Kind-specific and never secret: a printer's host and port, a till's
    /// peripherals and machine, a reader's pools.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub config: Value,
    pub replaces_device_id: Option<String>,
    pub rfid_device_id: Option<String>,
    pub attendance_terminal_id: Option<String>,
    pub registered_at: Option<DateTime<Utc>>,
    pub registered_by: Option<String>,
    pub first_reported_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Where the row comes from: `NODE` (reported in a heartbeat),
    /// `ATTENDANCE_TERMINAL` or `EDC_TERMINAL` (registered at head office, and
    /// switched there).
    pub source: String,
    /// Whether head office can suspend, reactivate or revoke it from here: a
    /// till or a printer, not yet revoked, on a node that takes device
    /// commands.
    pub switchable: bool,
    /// The newest test page it printed, as its node reported it (0632):
    /// when, whether it came out, and why not.
    pub last_test_print_at: Option<DateTime<Utc>>,
    pub last_test_print_ok: Option<bool>,
    pub last_test_print_error: Option<String>,
    /// Head office's test-page ask still in flight, cleared when the node
    /// reports it finished.
    pub test_print_requested_at: Option<DateTime<Utc>>,
    pub test_print_requested_by: Option<String>,
    pub test_print_request_id: Option<Uuid>,
    /// Whether head office can ask it for a test page from here: an active
    /// till or printer on a node that takes the ask.
    pub can_test_print: bool,
}

/// The register's columns. `$1` is [`TEST_PRINT_CAPABILITY`], bound by
/// every reader so the capability is spelled once.
const REGISTRY_SELECT: &str = "
    SELECT d.device_id, d.kind, d.origin_id, c.label AS node_label, d.site_id,
           s.name AS site_name, d.label, d.status, d.requested_status, d.requested_by,
           d.requested_at, d.requested_reason, d.last_seen_at, d.config,
           d.replaces_device_id, d.rfid_device_id, d.attendance_terminal_id,
           d.registered_at, d.registered_by, d.first_reported_at, d.updated_at, d.source,
           d.last_test_print_at, d.last_test_print_ok, d.last_test_print_error,
           d.test_print_requested_at, d.test_print_requested_by, d.test_print_request_id,
           COALESCE(h.status ? 'device_list', false) AS node_takes_commands,
           COALESCE(h.status -> 'capabilities' ? $1, false) AS node_takes_test_print
      FROM device_register d
      LEFT JOIN site s ON s.id = d.site_id
      LEFT JOIN sync_origin_credential c ON c.origin_id = d.origin_id
      LEFT JOIN node_heartbeat h ON h.origin_id = d.origin_id";

fn registry_row(row: &sqlx::postgres::PgRow) -> RegistryDevice {
    let kind: String = row.get("kind");
    let status: String = row.get("status");
    let node_takes_commands: bool = row.get("node_takes_commands");
    let node_takes_test_print: bool = row.get("node_takes_test_print");
    let source: String = row.get("source");
    RegistryDevice {
        switchable: node_takes_commands && wire::node_owns(&kind) && status != wire::STATUS_REVOKED,
        can_test_print: node_takes_test_print
            && source == "NODE"
            && wire::prints_test_page(&kind)
            && status == STATUS_ACTIVE,
        last_test_print_at: row.get("last_test_print_at"),
        last_test_print_ok: row.get("last_test_print_ok"),
        last_test_print_error: row.get("last_test_print_error"),
        test_print_requested_at: row.get("test_print_requested_at"),
        test_print_requested_by: row.get("test_print_requested_by"),
        test_print_request_id: row.get("test_print_request_id"),
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
        source,
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
          WHERE ($2::text IS NULL OR d.site_id = $2)
          ORDER BY d.site_id, d.kind, d.label"
    );
    let rows = sqlx::query(&sql)
        .bind(TEST_PRINT_CAPABILITY)
        .bind(site_id)
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(registry_row).collect())
}

pub async fn registry_device(pool: &PgPool, device_id: &str) -> Result<RegistryDevice, AppError> {
    let sql = format!("{REGISTRY_SELECT} WHERE d.device_id = $2");
    let row = sqlx::query(&sql)
        .bind(TEST_PRINT_CAPABILITY)
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

/// A punch station's history, from the row that is its authority: its
/// registration, then every change of trust with who made it and why. Each
/// change's `from` is the one before it; a station is registered ACTIVE.
const ATTENDANCE_HISTORY: &str = "
    WITH events AS (
        SELECT e.value ->> 'to' AS to_status,
               e.value -> 'authorization' ->> 'actor' AS actor,
               e.value -> 'authorization' ->> 'reason' AS reason,
               (e.value -> 'authorization' ->> 'at')::timestamptz AS at,
               e.n
          FROM attendance_terminal t
         CROSS JOIN LATERAL jsonb_array_elements(t.history) WITH ORDINALITY AS e(value, n)
         WHERE t.id = $1
    )
    SELECT 'HUB' AS source,
           COALESCE(lag(to_status) OVER (ORDER BY n), 'ACTIVE') AS from_status,
           to_status, actor, reason, at
      FROM events
     UNION ALL
    SELECT 'HUB', NULL, 'ACTIVE', t.registered ->> 'actor', t.registered ->> 'reason',
           COALESCE((t.registered ->> 'at')::timestamptz, t.created_at)
      FROM attendance_terminal t
     WHERE t.id = $1
     ORDER BY at DESC
     LIMIT 200";

/// An EDC's history is its registration: Finance keeps no record of the day
/// it was switched off, and this says only what is known.
const EDC_HISTORY: &str = "
    SELECT 'HUB'::text AS source, NULL::text AS from_status, 'ACTIVE'::text AS to_status,
           e.created_by AS actor, 'registered in Finance'::text AS reason, e.created_at AS at
      FROM device_register d
      JOIN edc_terminal e
        ON e.site_id = d.site_id AND e.terminal_id = d.config ->> 'terminal_id'
     WHERE d.device_id = $1 AND d.source = 'EDC_TERMINAL'";

/// A device's history, newest first. A node's device from `device_status_event`;
/// a terminal head office registered from the row it is kept in.
pub async fn device_history(
    pool: &PgPool,
    device_id: &str,
) -> Result<Vec<DeviceStatusEvent>, AppError> {
    let linked: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT source, attendance_terminal_id FROM device_register
          WHERE device_id = $1 AND source <> 'NODE'",
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await?;
    let rows = match linked {
        Some((source, Some(terminal_id))) if source == "ATTENDANCE_TERMINAL" => {
            sqlx::query(ATTENDANCE_HISTORY)
                .bind(terminal_id)
                .fetch_all(pool)
                .await?
        }
        Some(_) => {
            sqlx::query(EDC_HISTORY)
                .bind(device_id)
                .fetch_all(pool)
                .await?
        }
        None => {
            sqlx::query(
                "SELECT source, from_status, to_status, actor, reason, at
                   FROM device_status_event
                  WHERE device_id = $1
                  ORDER BY at DESC, id DESC
                  LIMIT 200",
            )
            .bind(device_id)
            .fetch_all(pool)
            .await?
        }
    };
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

/// Why the register cannot switch a device of this kind, and where it is done.
fn switched_elsewhere(kind: &str) -> String {
    format!(
        "a {} is switched on and off where its credential is kept (RFID readers and \
         handhelds in System → Access, punch stations in People → Settings, EDCs in \
         Finance → Sales & banks), not here",
        kind.to_ascii_lowercase().replace('_', " ")
    )
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
    let mut tx = pool.begin().await?;
    device_status_tx(&mut tx, device_id, request, actor, None).await?;
    tx.commit().await?;
    registry_device(pool, device_id).await
}

/// [`request_device_status`] in the caller's transaction, so a store action
/// (`store_actions.rs`) is recorded with the command that carries it.
/// Returns the command's id.
pub(super) async fn device_status_tx(
    tx: &mut Transaction<'_, Postgres>,
    device_id: &str,
    request: DeviceStatusRequest,
    actor: &str,
    expires_at: Option<DateTime<Utc>>,
) -> Result<Uuid, AppError> {
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

    let row: Option<(String, String, String, Option<bool>)> = sqlx::query_as(
        "SELECT d.kind, d.status, d.origin_id, (h.status ? 'device_list')
           FROM device d
           LEFT JOIN node_heartbeat h ON h.origin_id = d.origin_id
          WHERE d.device_id = $1
            FOR UPDATE OF d",
    )
    .bind(device_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((kind, current, origin_id, takes_commands)) = row else {
        // A terminal head office registered is in the register without being
        // in `device`: say where it is switched rather than that it is missing.
        let linked: Option<String> = sqlx::query_scalar(
            "SELECT kind FROM device_register WHERE device_id = $1 AND source <> 'NODE'",
        )
        .bind(device_id)
        .fetch_optional(&mut **tx)
        .await?;
        return Err(match linked {
            Some(kind) => AppError::Conflict(switched_elsewhere(&kind)),
            None => AppError::NotFound(format!("device {device_id}")),
        });
    };
    if !wire::node_owns(&kind) {
        return Err(AppError::Conflict(switched_elsewhere(&kind)));
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
        tx,
        COMMAND_DEVICE_STATUS_SET,
        &payload,
        actor,
        expires_at,
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
    .execute(&mut **tx)
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
    .execute(&mut **tx)
    .await?;
    Ok(command_id)
}

/// `POST /api/v1/devices/{device_id}/test-print`: accepted, and on its way.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TestPrintRequested {
    /// Head office's id for the ask. The register shows it in
    /// `test_print_request_id` until the node reports it finished.
    pub request_id: Uuid,
}

/// Head office asks a till or a network printer for a test page.
///
/// Sent as a signed `device.test_print.v1` to the device's node, and written
/// on the device's row as the ask in flight, in one transaction. Only to a
/// node whose heartbeat says it takes the ask: an older build would block its
/// whole command stream on a type it does not know, which is worse than the
/// person at the shop pressing "test print" themselves. The outcome comes
/// back in a later heartbeat (`record_reported_devices`).
pub async fn request_test_print(
    pool: &PgPool,
    device_id: &str,
    actor: &str,
) -> Result<TestPrintRequested, AppError> {
    let mut tx = pool.begin().await?;
    let (_, request_id) = test_print_tx(&mut tx, device_id, actor, None).await?;
    tx.commit().await?;
    Ok(TestPrintRequested { request_id })
}

/// [`request_test_print`] in the caller's transaction, for a store action
/// (`store_actions.rs`). Returns the command's id and the ask's.
pub(super) async fn test_print_tx(
    tx: &mut Transaction<'_, Postgres>,
    device_id: &str,
    actor: &str,
    expires_at: Option<DateTime<Utc>>,
) -> Result<(Uuid, Uuid), AppError> {
    let row: Option<(String, String, String, String, Option<bool>)> = sqlx::query_as(
        "SELECT d.kind, d.status, d.origin_id, d.label,
                (h.status -> 'capabilities' ? $2)
           FROM device d
           LEFT JOIN node_heartbeat h ON h.origin_id = d.origin_id
          WHERE d.device_id = $1
            FOR UPDATE OF d",
    )
    .bind(device_id)
    .bind(TEST_PRINT_CAPABILITY)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((kind, status, origin_id, label, takes_it)) = row else {
        let linked: Option<String> = sqlx::query_scalar(
            "SELECT kind FROM device_register WHERE device_id = $1 AND source <> 'NODE'",
        )
        .bind(device_id)
        .fetch_optional(&mut **tx)
        .await?;
        return Err(match linked {
            Some(kind) => AppError::Conflict(format!(
                "a {} prints no test page from here",
                kind.to_ascii_lowercase().replace('_', " ")
            )),
            None => AppError::NotFound(format!("device {device_id}")),
        });
    };
    if !wire::prints_test_page(&kind) {
        return Err(AppError::Conflict(format!(
            "a {} prints no test page; only a till or a network printer does",
            kind.to_ascii_lowercase().replace('_', " ")
        )));
    }
    if status != STATUS_ACTIVE {
        return Err(AppError::Conflict(format!(
            "{label} is {}; reactivate it before asking it to print",
            status.to_ascii_lowercase()
        )));
    }
    if takes_it != Some(true) {
        return Err(AppError::Conflict(
            "this device's store server runs a version that cannot print a test page for head \
             office; update the server, or press test print at the store"
                .into(),
        ));
    }
    let request_id = Uuid::new_v4();
    let now = Utc::now();
    let command = DeviceTestPrintCommand {
        request_id,
        device_id: device_id.to_string(),
        kind,
        requested_by: actor.to_string(),
        requested_at: now,
    };
    let payload = serde_json::to_value(&command)?;
    let command_id = super::sync::issue_command_tx(
        tx,
        COMMAND_DEVICE_TEST_PRINT,
        &payload,
        actor,
        expires_at,
        std::slice::from_ref(&origin_id),
    )
    .await?;
    sqlx::query(
        "UPDATE device
            SET test_print_requested_at = $2, test_print_requested_by = $3,
                test_print_request_id = $4, updated_at = now()
          WHERE device_id = $1",
    )
    .bind(device_id)
    .bind(now)
    .bind(actor)
    .bind(request_id)
    .execute(&mut **tx)
    .await?;
    Ok((command_id, request_id))
}
