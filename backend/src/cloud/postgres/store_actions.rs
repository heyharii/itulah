//! A store page's Actions menu: head office acting on a store's server and
//! its devices from a distance, each action recorded, followed until it
//! finishes, and its result shown (owner's decision of 28 Sep 2026).
//!
//! # Reused, not rebuilt
//!
//! Every action rides a command that already existed on the signed,
//! sequenced lane: `node.restart`, `node.backup`, `node.diagnose`
//! (`sync/node_ops.rs`, 0475), re-sending the initial data
//! (`bootstrap_origin`), a test page (`device.test_print.v1`, 0632) and a
//! device's suspension, reactivation or revocation (`device.status.set.v1`,
//! 0604). Two instructions are new — `node.sync_now` and the
//! `node.resnapshot` marker — and every operation now carries the action's
//! id, so the node can say what came of it.
//!
//! # Only to a node that understands
//!
//! An older build refuses a field it does not know and blocks its whole
//! command stream on it. So the server's operations are offered only when
//! the node's heartbeat advertises `node.actions.v1`; otherwise the menu
//! says "server version too old". Re-sending the initial data works for any
//! node — it is data the node already takes — and is followed by the lane
//! alone when there is no marker to send. A device action keeps the gate it
//! always had (`devices.rs`).
//!
//! # Where an action gets to
//!
//! One row in `store_action` (0643), moved by three things this module
//! listens to:
//!
//! - the node fetching the command (`commands_for` → [`mark_sent`]): SENT;
//! - the node's acknowledgement (`record_command_ack` → [`settle_origin`]):
//!   RUNNING when the node reports a result of its own, DONE when applying
//!   was the whole of it, FAILED when the command blocked the stream;
//! - the node's report in its heartbeat (`record_heartbeat` →
//!   [`record_action_reports`]): progress, then DONE or FAILED with a
//!   sentence and numbers.
//!
//! An action nobody picked up by `expires_at` — `fleet_setting.
//! action_expiry_minutes`, 30 by default — EXPIRES, and the node skips the
//! command if it ever arrives. Reads settle first, so what a person sees is
//! never staler than the lane.

use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::cloud::application::AppError;
use crate::sync::device::{self as wire, TEST_PRINT_CAPABILITY};
use crate::sync::node_ops::{
    ActionPayload, ActionReport, NodeOpPayload, NODE_ACTIONS_CAPABILITY, NODE_BACKUP,
    NODE_DIAGNOSE, NODE_RESNAPSHOT, NODE_RESTART, NODE_SYNC_NOW,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgConnection, PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

// ── the vocabulary ───────────────────────────────────────────────────────

pub const ACTION_RESTART_SERVER: &str = "restart_server";
pub const ACTION_RESEND_INITIAL_DATA: &str = "resend_initial_data";
pub const ACTION_BACK_UP_NOW: &str = "back_up_now";
pub const ACTION_DIAGNOSE: &str = "diagnose";
pub const ACTION_SYNC_NOW: &str = "sync_now";
/// Listed, never enabled: see [`UPDATE_DEFERRED`].
pub const ACTION_UPDATE_SERVER: &str = "update_server";
pub const ACTION_TEST_PRINT: &str = "test_print";
pub const ACTION_SUSPEND_DEVICE: &str = "suspend_device";
pub const ACTION_REACTIVATE_DEVICE: &str = "reactivate_device";
pub const ACTION_REVOKE_DEVICE: &str = "revoke_device";

pub const TARGET_SERVER: &str = "server";
pub const TARGET_DEVICE: &str = "device";

pub const STATE_QUEUED: &str = "QUEUED";
pub const STATE_SENT: &str = "SENT";
pub const STATE_RUNNING: &str = "RUNNING";
pub const STATE_DONE: &str = "DONE";
pub const STATE_FAILED: &str = "FAILED";
pub const STATE_EXPIRED: &str = "EXPIRED";

/// Why "Update server" is in the menu and never enabled. The updater takes a
/// targeted update (`node.update`), but only with a signed build — version,
/// address, digest and signature — which this menu has no way to carry.
pub const UPDATE_DEFERRED: &str =
    "Not from this menu yet: a signed build is installed from Fleet → Nodes → Update.";

/// Until the expiry setting can be read.
const DEFAULT_EXPIRY_MINUTES: i32 = 30;
/// A node may apply a command a little before head office hears of it.
const ACK_GRACE_SECONDS: i64 = 120;
/// A restart waits up to twelve hours for open drawers (`edge/ops.rs`);
/// past this with no word the action is given up.
const RUNNING_PATIENCE_HOURS: i64 = 13;
/// A test page that has not come out in this long is not coming.
const TEST_PRINT_PATIENCE_MINUTES: i64 = 30;
/// A restart that has not come back in this long is an outage again.
const MAINTENANCE_MINUTES: i64 = 15;
const HISTORY_DEFAULT_LIMIT: i64 = 20;
const HISTORY_MAX_LIMIT: i64 = 100;

/// A key as a sentence names it.
pub fn action_label(key: &str) -> &'static str {
    match key {
        ACTION_RESTART_SERVER => "Restart server",
        ACTION_RESEND_INITIAL_DATA => "Resend initial data",
        ACTION_BACK_UP_NOW => "Back up now",
        ACTION_DIAGNOSE => "Diagnose",
        ACTION_SYNC_NOW => "Sync now",
        ACTION_UPDATE_SERVER => "Update server",
        ACTION_TEST_PRINT => "Test print",
        ACTION_SUSPEND_DEVICE => "Suspend",
        ACTION_REACTIVATE_DEVICE => "Reactivate",
        ACTION_REVOKE_DEVICE => "Revoke",
        _ => "Action",
    }
}

fn target_of(key: &str) -> Option<&'static str> {
    match key {
        ACTION_RESTART_SERVER | ACTION_RESEND_INITIAL_DATA | ACTION_BACK_UP_NOW
        | ACTION_DIAGNOSE | ACTION_SYNC_NOW | ACTION_UPDATE_SERVER => Some(TARGET_SERVER),
        ACTION_TEST_PRINT | ACTION_SUSPEND_DEVICE | ACTION_REACTIVATE_DEVICE
        | ACTION_REVOKE_DEVICE => Some(TARGET_DEVICE),
        _ => None,
    }
}

/// Restarting, re-sending everything and revoking cannot be taken back, so
/// the request must say `confirm: true`.
pub fn is_dangerous(key: &str) -> bool {
    matches!(
        key,
        ACTION_RESTART_SERVER | ACTION_RESEND_INITIAL_DATA | ACTION_REVOKE_DEVICE
    )
}

/// The node operation a server action is carried by, when it is one.
fn node_command(key: &str) -> Option<&'static str> {
    match key {
        ACTION_RESTART_SERVER => Some(NODE_RESTART),
        ACTION_BACK_UP_NOW => Some(NODE_BACKUP),
        ACTION_DIAGNOSE => Some(NODE_DIAGNOSE),
        ACTION_SYNC_NOW => Some(NODE_SYNC_NOW),
        _ => None,
    }
}

// ── the wire ─────────────────────────────────────────────────────────────

/// One entry of a store's Actions menu.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreActionOption {
    /// `restart_server`, `resend_initial_data`, `back_up_now`, `diagnose`,
    /// `sync_now`, `update_server`, `test_print`, `suspend_device`,
    /// `reactivate_device` or `revoke_device`.
    pub key: String,
    pub label: String,
    /// `server` or `device`.
    #[cfg_attr(feature = "ts", ts(type = "\"server\" | \"device\""))]
    pub target: String,
    /// The device a device action is for; send it back in the request.
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub device_id: Option<String>,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub device_label: Option<String>,
    /// `TILL`, `PRINTER`, ...
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub device_kind: Option<String>,
    pub enabled: bool,
    /// Why not, in a sentence, when `enabled` is false.
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub reason_disabled: Option<String>,
    /// The request must carry `confirm: true`.
    pub danger: bool,
    /// What to ask the person before sending it.
    pub confirm_sentence: String,
    /// The request must carry a `note` saying why (suspend, revoke).
    pub note_required: bool,
}

/// `GET /api/v1/stores/{unit}/actions`.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreActionMenu {
    pub unit_id: String,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub site_id: Option<String>,
    /// The store's server, when it has one.
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub origin_id: Option<String>,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub server_version: Option<String>,
    /// Whether this caller may send any of them (an Admin, the owner, IT).
    pub can_act: bool,
    pub items: Vec<StoreActionOption>,
}

/// `POST /api/v1/stores/{unit}/actions/{key}`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreActionRequest {
    /// Required for a device action.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub device_id: Option<String>,
    /// Why; shown in the history and on the server. Required to suspend or
    /// revoke a device. At most 300 characters.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
    /// Must be `true` for a dangerous action.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub confirm: bool,
}

/// `202` to a request: recorded and on its way.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreActionAccepted {
    pub action_id: Uuid,
}

/// One line of a store's action history.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreActionEntry {
    pub action_id: Uuid,
    pub key: String,
    pub label: String,
    #[cfg_attr(feature = "ts", ts(type = "\"server\" | \"device\""))]
    pub target: String,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub device_id: Option<String>,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub device_label: Option<String>,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    /// `QUEUED`, `SENT`, `RUNNING`, `DONE`, `FAILED` or `EXPIRED`.
    #[cfg_attr(
        feature = "ts",
        ts(type = "\"QUEUED\" | \"SENT\" | \"RUNNING\" | \"DONE\" | \"FAILED\" | \"EXPIRED\"")
    )]
    pub state: String,
    pub expires_at: DateTime<Utc>,
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub finished_at: Option<DateTime<Utc>>,
    /// What came of it, or where it has got to, in a sentence.
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub result_sentence: Option<String>,
    /// The numbers behind the sentence: a backup's size and time, a sync's
    /// queue before and after, a diagnosis's checks and its full `report`
    /// (logs, disk, database, versions).
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub detail: Value,
}

/// `GET /api/v1/stores/{unit}/actions/history`.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreActionHistory {
    pub items: Vec<StoreActionEntry>,
}

// ── what the menu is built from ──────────────────────────────────────────

#[derive(Clone, Debug, Default)]
struct StoreServerFacts {
    unit_id: String,
    unit_code: String,
    unit_name: String,
    site_id: Option<String>,
    origin_id: Option<String>,
    heard: bool,
    version: Option<String>,
    capabilities: Vec<String>,
    takes_device_commands: bool,
}

#[derive(Clone, Debug)]
struct StoreDevice {
    device_id: String,
    kind: String,
    label: String,
    status: String,
    test_print_in_flight: bool,
    status_in_flight: bool,
}

#[derive(Clone, Debug)]
struct InFlight {
    key: String,
    device_id: Option<String>,
    requested_by: String,
    requested_at: DateTime<Utc>,
}

async fn server_facts(
    connection: &mut PgConnection,
    unit: &str,
) -> Result<StoreServerFacts, AppError> {
    let row = sqlx::query(
        "SELECT u.id, u.code, u.name, place.site_id, place.origin_id,
                h.received_at IS NOT NULL AS heard, h.version,
                COALESCE(h.status -> 'capabilities', '[]'::jsonb) AS capabilities,
                COALESCE(h.status ? 'device_list', false) AS takes_device_commands
           FROM unit u
           LEFT JOIN LATERAL (
               SELECT s.id AS site_id, sn.origin_id
                 FROM site s
                 LEFT JOIN site_node sn ON sn.site_id = s.id
                WHERE s.unit_id = u.id
                ORDER BY (sn.origin_id IS NOT NULL) DESC, (s.kind = 'STORE') DESC, s.id
                LIMIT 1
           ) place ON true
           LEFT JOIN node_heartbeat h ON h.origin_id = place.origin_id
          WHERE u.id = $1",
    )
    .bind(unit)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("store {unit}")))?;
    let capabilities: Value = row.try_get("capabilities")?;
    Ok(StoreServerFacts {
        unit_id: row.try_get("id")?,
        unit_code: row.try_get("code")?,
        unit_name: row.try_get("name")?,
        site_id: row.try_get("site_id")?,
        origin_id: row.try_get("origin_id")?,
        heard: row.try_get("heard")?,
        version: row.try_get("version")?,
        capabilities: capabilities
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        takes_device_commands: row.try_get("takes_device_commands")?,
    })
}

async fn store_devices(
    connection: &mut PgConnection,
    origin_id: &str,
) -> Result<Vec<StoreDevice>, AppError> {
    let rows = sqlx::query(
        "SELECT device_id, kind, label, status,
                test_print_request_id IS NOT NULL AS test_print_in_flight,
                requested_status IS NOT NULL AS status_in_flight
           FROM device
          WHERE origin_id = $1 AND status <> 'REVOKED'
          ORDER BY kind, label, device_id",
    )
    .bind(origin_id)
    .fetch_all(&mut *connection)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(StoreDevice {
                device_id: row.try_get("device_id")?,
                kind: row.try_get("kind")?,
                label: row.try_get("label")?,
                status: row.try_get("status")?,
                test_print_in_flight: row.try_get("test_print_in_flight")?,
                status_in_flight: row.try_get("status_in_flight")?,
            })
        })
        .collect()
}

async fn in_flight(connection: &mut PgConnection, unit: &str) -> Result<Vec<InFlight>, AppError> {
    let rows = sqlx::query(
        "SELECT action_key, device_id, requested_by, requested_at
           FROM store_action
          WHERE unit_id = $1 AND state IN ('QUEUED', 'SENT', 'RUNNING')",
    )
    .bind(unit)
    .fetch_all(&mut *connection)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(InFlight {
                key: row.try_get("action_key")?,
                device_id: row.try_get("device_id")?,
                requested_by: row.try_get("requested_by")?,
                requested_at: row.try_get("requested_at")?,
            })
        })
        .collect()
}

fn store_name(facts: &StoreServerFacts) -> String {
    format!("{} {}", facts.unit_code, facts.unit_name)
}

/// The menu, from what is known. Pure, so what is offered and why not can be
/// read and tested without a database.
fn build_menu(
    facts: &StoreServerFacts,
    devices: &[StoreDevice],
    flying: &[InFlight],
    can_act: bool,
    now: DateTime<Utc>,
) -> Vec<StoreActionOption> {
    let name = store_name(facts);
    let capable = facts
        .capabilities
        .iter()
        .any(|capability| capability == NODE_ACTIONS_CAPABILITY);
    let prints = facts
        .capabilities
        .iter()
        .any(|capability| capability == TEST_PRINT_CAPABILITY);
    let busy = |key: &str, device: Option<&str>| -> Option<String> {
        flying
            .iter()
            .find(|action| action.key == key && action.device_id.as_deref() == device)
            .map(|action| {
                format!(
                    "Already asked by {} {} ago; wait for it to finish.",
                    action.requested_by,
                    crate::sync::node_status::span(now - action.requested_at)
                )
            })
    };
    let too_old = || match &facts.version {
        Some(version) => format!("Server version too old ({version}): update it to use this."),
        None => "Server version too old: update it to use this.".to_owned(),
    };
    // The first reason that applies, or none.
    let server_reason = |key: &str, needs_capability: bool| -> Option<String> {
        if !can_act {
            return Some("Only an Admin, the owner or IT may act on a store's server.".into());
        }
        if facts.origin_id.is_none() {
            return Some("This store has no server yet.".into());
        }
        if key == ACTION_UPDATE_SERVER {
            return Some(UPDATE_DEFERRED.into());
        }
        if needs_capability && !facts.heard {
            return Some("The server has not reported in yet.".into());
        }
        if needs_capability && !capable {
            return Some(too_old());
        }
        busy(key, None)
    };
    let server = |key: &str, needs_capability: bool, confirm: String| {
        let reason = server_reason(key, needs_capability);
        StoreActionOption {
            key: key.to_owned(),
            label: action_label(key).to_owned(),
            target: TARGET_SERVER.to_owned(),
            device_id: None,
            device_label: None,
            device_kind: None,
            enabled: reason.is_none(),
            reason_disabled: reason,
            danger: is_dangerous(key),
            confirm_sentence: confirm,
            note_required: false,
        }
    };
    let mut items = vec![
        server(
            ACTION_RESTART_SERVER,
            true,
            format!(
                "Restart the server at {name}? It finishes what it is doing, waits for every cash \
                 drawer to close, then restarts; tills reconnect by themselves within a minute."
            ),
        ),
        server(
            ACTION_RESEND_INITIAL_DATA,
            false,
            format!(
                "Send {name}'s server its catalogue, prices, users and attendance book again? It \
                 rebuilds them from head office; sales carry on meanwhile."
            ),
        ),
        server(
            ACTION_BACK_UP_NOW,
            true,
            format!("Take a backup of {name}'s server now?"),
        ),
        server(
            ACTION_DIAGNOSE,
            true,
            format!(
                "Run a diagnosis on {name}'s server? It checks its logs, disk, database and \
                 versions and sends the report here."
            ),
        ),
        server(
            ACTION_SYNC_NOW,
            true,
            format!(
                "Send {name}'s waiting records to head office and fetch its instructions now?"
            ),
        ),
        server(
            ACTION_UPDATE_SERVER,
            true,
            format!("Update the server at {name}?"),
        ),
    ];
    for device in devices {
        let device_reason = |key: &str| -> Option<String> {
            if !can_act {
                return Some("Only an Admin, the owner or IT may act on a store's devices.".into());
            }
            if key == ACTION_TEST_PRINT {
                if device.status != wire::STATUS_ACTIVE {
                    return Some(format!(
                        "{} is {}; reactivate it first.",
                        device.label,
                        device.status.to_ascii_lowercase()
                    ));
                }
                if !prints {
                    return Some(too_old());
                }
                if device.test_print_in_flight {
                    return busy(key, Some(&device.device_id))
                        .or_else(|| Some("A test page is already on its way.".into()));
                }
            } else {
                if !facts.takes_device_commands {
                    return Some(too_old());
                }
                if device.status_in_flight {
                    return busy(key, Some(&device.device_id)).or_else(|| {
                        Some("A decision about this device is already on its way.".into())
                    });
                }
            }
            busy(key, Some(&device.device_id))
        };
        let option = |key: &str, confirm: String, note_required: bool| {
            let reason = device_reason(key);
            StoreActionOption {
                key: key.to_owned(),
                label: action_label(key).to_owned(),
                target: TARGET_DEVICE.to_owned(),
                device_id: Some(device.device_id.clone()),
                device_label: Some(device.label.clone()),
                device_kind: Some(device.kind.clone()),
                enabled: reason.is_none(),
                reason_disabled: reason,
                danger: is_dangerous(key),
                confirm_sentence: confirm,
                note_required,
            }
        };
        let label = &device.label;
        if wire::prints_test_page(&device.kind) {
            items.push(option(
                ACTION_TEST_PRINT,
                format!("Print a test page on {label}?"),
                false,
            ));
        }
        if !wire::node_owns(&device.kind) {
            continue;
        }
        if device.status == wire::STATUS_ACTIVE {
            items.push(option(
                ACTION_SUSPEND_DEVICE,
                format!("Suspend {label}? It stops working until head office reactivates it."),
                true,
            ));
        }
        if device.status == wire::STATUS_SUSPENDED {
            items.push(option(
                ACTION_REACTIVATE_DEVICE,
                format!("Reactivate {label}?"),
                false,
            ));
        }
        items.push(option(
            ACTION_REVOKE_DEVICE,
            format!("Revoke {label} for good? To be used again it must join the store afresh."),
            true,
        ));
    }
    items
}

/// `GET /api/v1/stores/{unit}/actions`.
pub async fn store_action_menu(
    pool: &PgPool,
    unit: &str,
    can_act: bool,
) -> Result<StoreActionMenu, AppError> {
    let mut connection = pool.acquire().await?;
    let facts = server_facts(&mut connection, unit).await?;
    if let Some(origin) = facts.origin_id.as_deref() {
        settle_origin(&mut connection, origin).await?;
    }
    let devices = match facts.origin_id.as_deref() {
        Some(origin) => store_devices(&mut connection, origin).await?,
        None => Vec::new(),
    };
    let flying = in_flight(&mut connection, &facts.unit_id).await?;
    let items = build_menu(&facts, &devices, &flying, can_act, Utc::now());
    Ok(StoreActionMenu {
        unit_id: facts.unit_id,
        site_id: facts.site_id,
        origin_id: facts.origin_id,
        server_version: facts.version,
        can_act,
        items,
    })
}

// ── asking ───────────────────────────────────────────────────────────────

/// What a request came to, with what the activity log names.
#[derive(Clone, Debug)]
pub struct RequestedStoreAction {
    pub accepted: StoreActionAccepted,
    pub origin_id: Option<String>,
}

async fn expiry_minutes(connection: &mut PgConnection) -> Result<i32, AppError> {
    Ok(sqlx::query_scalar::<_, i32>(
        "SELECT action_expiry_minutes FROM fleet_setting WHERE singleton",
    )
    .fetch_optional(&mut *connection)
    .await?
    .unwrap_or(DEFAULT_EXPIRY_MINUTES))
}

async fn seq_of(
    tx: &mut Transaction<'_, Postgres>,
    command_id: Uuid,
    origin_id: &str,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT seq FROM sync_command_delivery WHERE command_id = $1 AND origin_id = $2",
    )
    .bind(command_id)
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?)
}

/// `POST /api/v1/stores/{unit}/actions/{key}`: record the action and issue
/// the command that carries it, in one transaction under the caller's
/// Idempotency-Key — the same key with the same body answers the first
/// action again. Re-sending the initial data issues its streams after that
/// transaction (they are many, each on its own), then its marker.
pub async fn request_store_action(
    pool: &PgPool,
    unit: &str,
    key: &str,
    request: StoreActionRequest,
    actor: &str,
    idempotency_key: &str,
) -> Result<RequestedStoreAction, AppError> {
    let target = target_of(key).ok_or_else(|| {
        AppError::NotFound(format!("no store action is called {key}"))
    })?;
    if key == ACTION_UPDATE_SERVER {
        return Err(AppError::Conflict(UPDATE_DEFERRED.into()));
    }
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_owned);
    if note.as_ref().is_some_and(|note| note.chars().count() > 300) {
        return Err(AppError::Validation("a note is at most 300 characters".into()));
    }
    let device_id = request
        .device_id
        .as_deref()
        .map(str::trim)
        .filter(|device| !device.is_empty())
        .map(str::to_owned);
    match (target, &device_id) {
        (TARGET_DEVICE, None) => {
            return Err(AppError::Validation(format!("{key} needs a device_id")));
        }
        (TARGET_SERVER, Some(_)) => {
            return Err(AppError::Validation(format!(
                "{key} acts on the server; leave device_id out"
            )));
        }
        _ => {}
    }
    if matches!(key, ACTION_SUSPEND_DEVICE | ACTION_REVOKE_DEVICE) && note.is_none() {
        return Err(AppError::Validation(
            "say why in the note: the store reads it when its device stops working".into(),
        ));
    }
    let digest = payload_digest(&json!({
        "unit": unit, "key": key, "device_id": device_id, "note": note, "confirm": request.confirm,
    }))?;

    let mut tx = pool.begin().await?;
    if let Some(answer) = begin_idempotent(&mut tx, idempotency_key, "store.action", &digest).await? {
        tx.commit().await?;
        let accepted: StoreActionAccepted = serde_json::from_value(answer)?;
        let origin_id = sqlx::query_scalar("SELECT origin_id FROM store_action WHERE action_id = $1")
            .bind(accepted.action_id)
            .fetch_optional(pool)
            .await?;
        return Ok(RequestedStoreAction { accepted, origin_id });
    }
    // One action at a time per store: two Admins pressing at once record it
    // once, and the second is told it is already on its way.
    sqlx::query("SELECT id FROM unit WHERE id = $1 FOR UPDATE")
        .bind(unit)
        .fetch_optional(&mut *tx)
        .await?;
    let facts = server_facts(&mut tx, unit).await?;
    if let Some(origin) = facts.origin_id.as_deref() {
        settle_origin(&mut tx, origin).await?;
    }
    let devices = match facts.origin_id.as_deref() {
        Some(origin) => store_devices(&mut tx, origin).await?,
        None => Vec::new(),
    };
    let flying = in_flight(&mut tx, &facts.unit_id).await?;
    let now = Utc::now();
    let menu = build_menu(&facts, &devices, &flying, true, now);
    let option = menu
        .iter()
        .find(|option| option.key == key && option.device_id == device_id)
        .ok_or_else(|| match &device_id {
            Some(device) => AppError::Conflict(format!(
                "{} is not offered for device {device} at {}",
                action_label(key),
                store_name(&facts)
            )),
            None => AppError::Conflict(format!("{} has no server yet", store_name(&facts))),
        })?;
    if let Some(reason) = &option.reason_disabled {
        return Err(AppError::Conflict(reason.clone()));
    }
    if option.danger && !request.confirm {
        return Err(AppError::Validation(format!(
            "this action needs \"confirm\": true — {}",
            option.confirm_sentence
        )));
    }
    let origin_id = facts
        .origin_id
        .clone()
        .ok_or_else(|| AppError::Conflict(format!("{} has no server yet", store_name(&facts))))?;
    let site_id = facts
        .site_id
        .clone()
        .ok_or_else(|| AppError::Conflict(format!("{} has no site yet", store_name(&facts))))?;
    let expires_at = now + Duration::minutes(i64::from(expiry_minutes(&mut tx).await?));
    let action_id = Uuid::new_v4();
    let reason = note
        .clone()
        .unwrap_or_else(|| format!("{} from the hub by {actor}", action_label(key)));
    let reason: String = reason.chars().take(300).collect();

    let (command_id, request_id, reported) = match key {
        ACTION_RESTART_SERVER | ACTION_BACK_UP_NOW | ACTION_DIAGNOSE => {
            let kind = node_command(key).unwrap_or(NODE_DIAGNOSE);
            let payload = serde_json::to_value(NodeOpPayload {
                reason: reason.clone(),
                force: false,
                action_id: Some(action_id),
            })?;
            let command =
                super::sync::issue_command_tx(&mut tx, kind, &payload, actor, Some(expires_at), &[origin_id.clone()])
                    .await?;
            (Some(command), None, true)
        }
        ACTION_SYNC_NOW => {
            let payload = serde_json::to_value(ActionPayload {
                action_id,
                reason: reason.clone(),
            })?;
            let command = super::sync::issue_command_tx(
                &mut tx,
                NODE_SYNC_NOW,
                &payload,
                actor,
                Some(expires_at),
                &[origin_id.clone()],
            )
            .await?;
            (Some(command), None, true)
        }
        ACTION_TEST_PRINT => {
            let device = device_id.as_deref().unwrap_or_default();
            let (command, ask) =
                super::devices::test_print_tx(&mut tx, device, actor, Some(expires_at)).await?;
            (Some(command), Some(ask), false)
        }
        ACTION_SUSPEND_DEVICE | ACTION_REACTIVATE_DEVICE | ACTION_REVOKE_DEVICE => {
            let device = device_id.as_deref().unwrap_or_default();
            let status = match key {
                ACTION_SUSPEND_DEVICE => wire::STATUS_SUSPENDED,
                ACTION_REVOKE_DEVICE => wire::STATUS_REVOKED,
                _ => wire::STATUS_ACTIVE,
            };
            let command = super::devices::device_status_tx(
                &mut tx,
                device,
                super::devices::DeviceStatusRequest {
                    status: status.to_owned(),
                    reason: note.clone(),
                },
                actor,
                Some(expires_at),
            )
            .await?;
            (Some(command), None, false)
        }
        // Issued after this transaction: see below.
        _ => (None, None, false),
    };
    let command_seq = match command_id {
        Some(command) => seq_of(&mut tx, command, &origin_id).await?,
        None => None,
    };
    sqlx::query(
        "INSERT INTO store_action
             (action_id, unit_id, site_id, origin_id, action_key, target, device_id, note,
              requested_by, requested_at, expires_at, command_id, command_seq, request_id,
              reported)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    )
    .bind(action_id)
    .bind(&facts.unit_id)
    .bind(&site_id)
    .bind(&origin_id)
    .bind(key)
    .bind(target)
    .bind(&device_id)
    .bind(&note)
    .bind(actor)
    .bind(now)
    .bind(expires_at)
    .bind(command_id)
    .bind(command_seq)
    .bind(request_id)
    .bind(reported)
    .execute(&mut *tx)
    .await?;
    let accepted = StoreActionAccepted { action_id };
    complete_idempotent(&mut tx, idempotency_key, &serde_json::to_value(&accepted)?).await?;
    tx.commit().await?;

    if key == ACTION_RESEND_INITIAL_DATA {
        resend_initial_data(pool, action_id, &origin_id, &facts, &reason, actor, expires_at).await?;
    }
    Ok(RequestedStoreAction {
        accepted,
        origin_id: Some(origin_id),
    })
}

/// Every stream `bootstrap_origin` sends, then the marker behind them for a
/// node that takes it. A node that does not is followed by the lane alone:
/// the action is done when the node has applied everything issued to it up
/// to now.
async fn resend_initial_data(
    pool: &PgPool,
    action_id: Uuid,
    origin_id: &str,
    facts: &StoreServerFacts,
    reason: &str,
    actor: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), AppError> {
    let streams = match super::bootstrap_origin(pool, origin_id, actor).await {
        Ok(streams) => streams,
        Err(error) => {
            sqlx::query(
                "UPDATE store_action
                    SET state = 'FAILED', finished_at = now(),
                        result_sentence = $2, detail = jsonb_build_object('error', $3::text)
                  WHERE action_id = $1",
            )
            .bind(action_id)
            .bind(format!("The initial data could not be sent: {error}"))
            .bind(error.to_string())
            .execute(pool)
            .await?;
            return Ok(());
        }
    };
    let failed: Vec<String> = streams
        .as_object()
        .map(|streams| {
            streams
                .iter()
                .filter(|(_, outcome)| outcome.get("error").is_some())
                .map(|(stream, _)| stream.clone())
                .collect()
        })
        .unwrap_or_default();
    let capable = facts
        .capabilities
        .iter()
        .any(|capability| capability == NODE_ACTIONS_CAPABILITY);
    let mut tx = pool.begin().await?;
    let (command_id, command_seq) = if capable {
        let payload = serde_json::to_value(ActionPayload {
            action_id,
            reason: reason.to_owned(),
        })?;
        let command = super::sync::issue_command_tx(
            &mut tx,
            NODE_RESNAPSHOT,
            &payload,
            actor,
            Some(expires_at),
            &[origin_id.to_owned()],
        )
        .await?;
        (Some(command), seq_of(&mut tx, command, origin_id).await?)
    } else {
        let last: Option<i64> = sqlx::query_scalar(
            "SELECT max(seq) FROM sync_command_delivery WHERE origin_id = $1",
        )
        .bind(origin_id)
        .fetch_one(&mut *tx)
        .await?;
        (None, last)
    };
    sqlx::query(
        "UPDATE store_action
            SET command_id = $2, command_seq = $3, reported = $4,
                detail = jsonb_build_object('streams', $5::jsonb, 'failed_streams', $6::jsonb)
          WHERE action_id = $1",
    )
    .bind(action_id)
    .bind(command_id)
    .bind(command_seq)
    .bind(capable)
    .bind(&streams)
    .bind(json!(failed))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

// ── following it through ─────────────────────────────────────────────────

/// The node fetched its commands up to `through`: what they carry is SENT.
/// Called from `commands_for`; a failure is logged there, never fatal to a
/// node's sync.
pub(super) async fn mark_sent(
    pool: &PgPool,
    origin_id: &str,
    after_seq: i64,
    through: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE store_action
            SET state = 'SENT', sent_at = now()
          WHERE origin_id = $1 AND state = 'QUEUED'
            AND command_seq > $2 AND command_seq <= $3",
    )
    .bind(origin_id)
    .bind(after_seq)
    .bind(through)
    .execute(pool)
    .await?;
    Ok(())
}

/// Bring one node's open actions up to date with the lane: applied, blocked,
/// expired, a test page's outcome, and patience run out.
pub(super) async fn settle_origin(
    connection: &mut PgConnection,
    origin_id: &str,
) -> Result<(), AppError> {
    // Applied. Head office hears of an application at the node's next sync,
    // so one heard of well past the expiry was one the node skipped.
    sqlx::query(
        "UPDATE store_action a
            SET sent_at = COALESCE(a.sent_at, now()),
                acked_at = now(),
                state = CASE
                    WHEN now() > a.expires_at + make_interval(secs => $2) THEN 'EXPIRED'
                    WHEN a.reported OR a.action_key = 'test_print' THEN 'RUNNING'
                    ELSE 'DONE' END,
                started_at = COALESCE(a.started_at, now()),
                finished_at = CASE
                    WHEN now() > a.expires_at + make_interval(secs => $2) THEN now()
                    WHEN a.reported OR a.action_key = 'test_print' THEN NULL
                    ELSE now() END,
                result_sentence = CASE
                    WHEN now() > a.expires_at + make_interval(secs => $2)
                        THEN 'The server came back after this had expired, so it skipped it.'
                    WHEN a.reported THEN 'The server has it and is carrying it out.'
                    WHEN a.action_key = 'test_print' THEN 'The server has it; waiting for the page.'
                    ELSE 'The server applied it.' END
           FROM sync_command_cursor c
          WHERE a.origin_id = $1 AND c.origin_id = a.origin_id
            AND a.state IN ('QUEUED', 'SENT')
            AND a.command_seq IS NOT NULL AND c.acked_seq >= a.command_seq",
    )
    .bind(origin_id)
    .bind(ACK_GRACE_SECONDS as f64)
    .execute(&mut *connection)
    .await?;
    // Blocked: the node could not apply it, and says why.
    sqlx::query(
        "UPDATE store_action a
            SET state = 'FAILED', finished_at = now(),
                result_sentence = 'The server could not apply it: ' || COALESCE(c.blocked_reason, 'no reason given'),
                detail = a.detail || jsonb_build_object('blocked_reason', c.blocked_reason)
           FROM sync_command_cursor c
          WHERE a.origin_id = $1 AND c.origin_id = a.origin_id
            AND a.state IN ('QUEUED', 'SENT')
            AND c.blocked_at_seq IS NOT NULL AND c.blocked_at_seq = a.command_seq",
    )
    .bind(origin_id)
    .execute(&mut *connection)
    .await?;
    // Never picked up, or fetched and never applied, by its expiry. A
    // device's ask in flight goes with it, so its register does not wait
    // for ever.
    sqlx::query(
        "WITH expired AS (
             UPDATE store_action
                SET state = 'EXPIRED', finished_at = now(),
                    result_sentence = CASE state
                        WHEN 'QUEUED' THEN 'The server did not pick this up in time.'
                        ELSE 'The server fetched this but did not carry it out in time.' END
              WHERE origin_id = $1 AND state IN ('QUEUED', 'SENT')
                AND now() > expires_at + make_interval(secs => $2)
              RETURNING command_id, request_id
         ), prints AS (
             UPDATE device d
                SET test_print_requested_at = NULL, test_print_requested_by = NULL,
                    test_print_request_id = NULL, updated_at = now()
               FROM expired e
              WHERE e.request_id IS NOT NULL AND d.test_print_request_id = e.request_id
              RETURNING d.device_id
         )
         UPDATE device d
            SET requested_status = NULL, requested_by = NULL, requested_at = NULL,
                requested_reason = NULL, requested_command_id = NULL, updated_at = now()
           FROM expired e
          WHERE e.command_id IS NOT NULL AND d.requested_command_id = e.command_id
            AND NOT EXISTS (SELECT 1 FROM prints WHERE prints.device_id = d.device_id)",
    )
    .bind(origin_id)
    .bind(ACK_GRACE_SECONDS as f64)
    .execute(&mut *connection)
    .await?;
    // A test page's outcome, from the device's register row (0632): printed
    // at or after the ask, and the ask no longer in flight.
    sqlx::query(
        "UPDATE store_action a
            SET state = CASE WHEN d.last_test_print_ok THEN 'DONE' ELSE 'FAILED' END,
                finished_at = now(),
                result_sentence = CASE WHEN d.last_test_print_ok
                    THEN 'The test page came out.'
                    ELSE 'The test page did not print: ' || COALESCE(d.last_test_print_error, 'no reason given') END,
                detail = a.detail || jsonb_build_object(
                    'printed_at', d.last_test_print_at,
                    'ok', d.last_test_print_ok,
                    'error', d.last_test_print_error)
           FROM device d
          WHERE a.origin_id = $1 AND a.action_key = 'test_print' AND a.state = 'RUNNING'
            AND d.device_id = a.device_id
            AND d.last_test_print_at IS NOT NULL AND d.last_test_print_at >= a.requested_at
            AND d.test_print_request_id IS DISTINCT FROM a.request_id",
    )
    .bind(origin_id)
    .execute(&mut *connection)
    .await?;
    // Patience run out.
    sqlx::query(
        "UPDATE store_action
            SET state = 'FAILED', finished_at = now(),
                result_sentence = CASE action_key
                    WHEN 'test_print' THEN 'No test page was reported within 30 minutes.'
                    ELSE 'No word from the server about this; it may have gone down. Ask again.' END
          WHERE origin_id = $1 AND state = 'RUNNING'
            AND ((action_key = 'test_print'
                  AND now() > COALESCE(acked_at, requested_at) + make_interval(mins => $2))
              OR (action_key <> 'test_print'
                  AND now() > COALESCE(started_at, requested_at) + make_interval(hours => $3)))",
    )
    .bind(origin_id)
    .bind(TEST_PRINT_PATIENCE_MINUTES as i32)
    .bind(RUNNING_PATIENCE_HOURS as i32)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

/// Settle one node after its acknowledgement. Called from
/// `record_command_ack`; a failure is logged there, never fatal to a sync.
pub(super) async fn settle_after_ack(pool: &PgPool, origin_id: &str) -> Result<(), AppError> {
    let mut connection = pool.acquire().await?;
    settle_origin(&mut connection, origin_id).await
}

/// File what a node said about its actions, inside its heartbeat's
/// transaction. Only its own actions, never one already finished; a node's
/// QUEUED means head office's RUNNING — it has the action and has not
/// started. Returns how many rows moved.
pub(super) async fn record_action_reports(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    reports: &[ActionReport],
) -> Result<u64, AppError> {
    let mut moved = 0;
    for report in reports {
        if !crate::sync::node_ops::is_action_state(&report.state) {
            continue;
        }
        let terminal = matches!(report.state.as_str(), "DONE" | "FAILED");
        let state = if terminal { report.state.as_str() } else { STATE_RUNNING };
        let sentence = report
            .sentence
            .as_deref()
            .map(|sentence| sentence.chars().take(500).collect::<String>());
        let node_detail = if report.detail.is_object() {
            report.detail.clone()
        } else {
            json!({})
        };
        moved += sqlx::query(
            "UPDATE store_action
                SET state = $3,
                    sent_at = COALESCE(sent_at, $4),
                    acked_at = COALESCE(acked_at, $4),
                    started_at = COALESCE(started_at, $5, $4),
                    finished_at = CASE WHEN $3 IN ('DONE', 'FAILED') THEN COALESCE($6, now()) ELSE NULL END,
                    result_sentence = COALESCE($7, result_sentence),
                    detail = detail || $8::jsonb
              WHERE action_id = $1 AND origin_id = $2 AND state NOT IN ('DONE', 'FAILED')
                AND (state <> $3 OR result_sentence IS DISTINCT FROM COALESCE($7, result_sentence)
                     OR NOT (detail @> $8::jsonb))",
        )
        .bind(report.action_id)
        .bind(origin_id)
        .bind(state)
        .bind(report.received_at)
        .bind(report.started_at)
        .bind(report.finished_at)
        .bind(sentence)
        .bind(node_detail)
        .execute(&mut **tx)
        .await?
        .rows_affected();
    }
    Ok(moved)
}

/// The nodes restarting at head office's request right now, with who asked:
/// the fleet page shows their silence as maintenance, not an outage, for as
/// long as a restart takes (`fleet_status.rs`).
pub async fn restarting_origins(
    pool: &PgPool,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT origin_id, requested_by
           FROM store_action
          WHERE action_key = 'restart_server' AND state IN ('SENT', 'RUNNING')
            AND COALESCE((detail ->> 'stopping_at')::timestamptz, started_at, sent_at, requested_at)
                > now() - make_interval(mins => $1)",
    )
    .bind(MAINTENANCE_MINUTES as i32)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

// ── reading ──────────────────────────────────────────────────────────────

/// `GET /api/v1/stores/{unit}/actions/history?limit=`: newest first. A
/// diagnosis carries the report its server sent after it was asked for.
pub async fn store_action_history(
    pool: &PgPool,
    unit: &str,
    limit: Option<i64>,
) -> Result<StoreActionHistory, AppError> {
    let limit = limit.unwrap_or(HISTORY_DEFAULT_LIMIT).clamp(1, HISTORY_MAX_LIMIT);
    let mut connection = pool.acquire().await?;
    let facts = server_facts(&mut connection, unit).await?;
    let origins: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT origin_id FROM store_action
          WHERE unit_id = $1 AND state IN ('QUEUED', 'SENT', 'RUNNING')",
    )
    .bind(&facts.unit_id)
    .fetch_all(&mut *connection)
    .await?;
    for origin in &origins {
        settle_origin(&mut connection, origin).await?;
    }
    let rows = sqlx::query(
        "SELECT a.action_id, a.action_key, a.target, a.device_id, d.label AS device_label,
                a.note, a.requested_by, a.requested_at, a.state, a.expires_at, a.finished_at,
                a.result_sentence,
                CASE WHEN diag.report IS NULL THEN a.detail
                     ELSE a.detail || jsonb_build_object(
                         'report', diag.report, 'report_received_at', diag.received_at)
                END AS detail
           FROM store_action a
           LEFT JOIN device d ON d.device_id = a.device_id
           LEFT JOIN LATERAL (
               SELECT n.report, n.received_at
                 FROM node_diagnostic n
                WHERE a.action_key = 'diagnose' AND a.state = 'DONE'
                  AND n.origin_id = a.origin_id AND n.received_at >= a.requested_at
                ORDER BY n.received_at
                LIMIT 1
           ) diag ON true
          WHERE a.unit_id = $1
          ORDER BY a.requested_at DESC, a.action_id
          LIMIT $2",
    )
    .bind(&facts.unit_id)
    .bind(limit)
    .fetch_all(&mut *connection)
    .await?;
    let items = rows
        .into_iter()
        .map(|row| {
            let key: String = row.try_get("action_key")?;
            Ok(StoreActionEntry {
                action_id: row.try_get("action_id")?,
                label: action_label(&key).to_owned(),
                key,
                target: row.try_get("target")?,
                device_id: row.try_get("device_id")?,
                device_label: row.try_get("device_label")?,
                note: row.try_get("note")?,
                requested_by: row.try_get("requested_by")?,
                requested_at: row.try_get("requested_at")?,
                state: row.try_get("state")?,
                expires_at: row.try_get("expires_at")?,
                finished_at: row.try_get("finished_at")?,
                result_sentence: row.try_get("result_sentence")?,
                detail: row.try_get("detail")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(StoreActionHistory { items })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(capabilities: &[&str]) -> StoreServerFacts {
        StoreServerFacts {
            unit_id: "store-c014".into(),
            unit_code: "C014".into(),
            unit_name: "Tegal".into(),
            site_id: Some("c014".into()),
            origin_id: Some("c014-node".into()),
            heard: true,
            version: Some("0.9.0".into()),
            capabilities: capabilities.iter().map(|c| (*c).to_owned()).collect(),
            takes_device_commands: true,
        }
    }

    fn till(status: &str) -> StoreDevice {
        StoreDevice {
            device_id: "till-1".into(),
            kind: wire::KIND_TILL.into(),
            label: "Kasir 1".into(),
            status: status.into(),
            test_print_in_flight: false,
            status_in_flight: false,
        }
    }

    fn find<'a>(menu: &'a [StoreActionOption], key: &str) -> Option<&'a StoreActionOption> {
        menu.iter().find(|option| option.key == key)
    }

    #[test]
    fn an_old_server_is_offered_only_what_it_understands() {
        let menu = build_menu(&facts(&[]), &[], &[], true, Utc::now());
        let restart = find(&menu, ACTION_RESTART_SERVER);
        assert!(restart.is_some_and(|o| !o.enabled
            && o.reason_disabled.as_deref().unwrap_or("").contains("too old")));
        assert!(find(&menu, ACTION_RESEND_INITIAL_DATA).is_some_and(|o| o.enabled && o.danger));
        assert!(find(&menu, ACTION_UPDATE_SERVER).is_some_and(|o| !o.enabled));
    }

    #[test]
    fn a_current_server_is_offered_everything_but_the_update() {
        let menu = build_menu(
            &facts(&[NODE_ACTIONS_CAPABILITY, TEST_PRINT_CAPABILITY]),
            &[till(wire::STATUS_ACTIVE)],
            &[],
            true,
            Utc::now(),
        );
        for key in [ACTION_RESTART_SERVER, ACTION_BACK_UP_NOW, ACTION_DIAGNOSE, ACTION_SYNC_NOW] {
            assert!(find(&menu, key).is_some_and(|o| o.enabled), "{key}");
        }
        assert!(find(&menu, ACTION_TEST_PRINT).is_some_and(|o| o.enabled));
        assert!(find(&menu, ACTION_SUSPEND_DEVICE).is_some_and(|o| o.note_required));
        assert!(find(&menu, ACTION_REACTIVATE_DEVICE).is_none());
        assert!(find(&menu, ACTION_REVOKE_DEVICE).is_some_and(|o| o.danger));
    }

    #[test]
    fn nobody_but_admin_owner_or_it_may_act_and_one_at_a_time() {
        let everything = facts(&[NODE_ACTIONS_CAPABILITY]);
        let menu = build_menu(&everything, &[], &[], false, Utc::now());
        assert!(menu.iter().all(|option| !option.enabled));
        let flying = [InFlight {
            key: ACTION_RESTART_SERVER.into(),
            device_id: None,
            requested_by: "rina".into(),
            requested_at: Utc::now() - Duration::minutes(3),
        }];
        let menu = build_menu(&everything, &[], &flying, true, Utc::now());
        assert!(find(&menu, ACTION_RESTART_SERVER).is_some_and(|o| !o.enabled
            && o.reason_disabled.as_deref().unwrap_or("").contains("rina")));
        assert!(find(&menu, ACTION_BACK_UP_NOW).is_some_and(|o| o.enabled));
    }
}
