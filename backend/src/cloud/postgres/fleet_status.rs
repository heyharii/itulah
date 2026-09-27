//! Head office's fleet status: one row per store and one for the gudang,
//! coloured by the worst of their parts, each part with ninety days of
//! history; sync shown as freshness and queues; and the alerts in between.
//!
//! Owner's decisions of 28 Sep 2026. The parts of a store are its server,
//! connection and sync, each device (tills, printers, handhelds and fixed
//! readers, EDC, the attendance terminal), the USB desk reader on a till, the
//! gudang's label printer, the daily backup, the server version, and power
//! and disk. Head office has a row of its own: the cloud API and database,
//! and the background jobs the stores lean on without seeing them.
//!
//! # Where each thing comes from
//!
//! Everything a store says about itself arrives in its heartbeat
//! (`sync::node_status::NodeStatus`, kept whole in `node_heartbeat.status`),
//! including each device's health (`sync::device::DeviceHealth`). What head
//! office knows by itself it reads from its own tables: the command lane
//! (`sync_command_delivery` past `sync_command_cursor.acked_seq`), the
//! outbox acks (`sync_ingest_watermark`), the terminals it registers
//! (`device_register`), and its own jobs (`fleet_job_beat`, 0640).
//!
//! [`evaluate_fleet`] turns all of that into parts, live, for the reads; the
//! once-a-minute [`fleet_sweep`] writes the same parts down (0638) so each
//! has a history, and raises and closes the incidents (0639).
//!
//! # Colours
//!
//! `OK` green, `WARN` yellow, `BAD` red, `UNKNOWN` grey. A row is the worst
//! of the parts that can be judged, grey only when none can. When a store's
//! server is silent its parts go grey — nobody can say what a till is doing
//! through a dead line — and the server and sync parts carry the news.

use super::notifications::{raise_notification, NewNotification};
use crate::cloud::application::AppError;
use crate::sync::device::{self as wire, DeviceReport};
use crate::sync::node_status::{
    disturbances_today, span, NodeStatus, PowerSource, QueuedFacts, QUEUE_SALES,
};
use chrono::{DateTime, Duration, NaiveDate, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Head office's own row, as a `subject`.
pub const HEAD_OFFICE_SUBJECT: &str = "HO";
/// What `{unit}` is spelled as to ask for head office's own row.
pub const HEAD_OFFICE_KEY: &str = "head-office";

pub const PART_OK: &str = "OK";
pub const PART_WARN: &str = "WARN";
pub const PART_BAD: &str = "BAD";
pub const PART_UNKNOWN: &str = "UNKNOWN";

/// How often the sweep runs, and so how long one confirmation of a colour
/// is taken to cover.
const TICK_SECONDS: i64 = 60;
/// A span not confirmed for longer than this is closed, and the same colour
/// seen again starts a new one: the gap is time head office was not looking.
const SPAN_GAP_SECONDS: i64 = 180;
/// The bars.
const HISTORY_BARS: i64 = 90;
/// A till or a reader heard from within this long is online.
const DEVICE_ONLINE_MINUTES: i64 = 15;
/// A till with its drawer open and no request for this long is worth a look.
const TILL_QUIET_MINUTES: i64 = 30;
const HANDHELD_BATTERY_LOW: u8 = 15;

pub fn part_colour(state: &str) -> &'static str {
    match state {
        PART_OK => "green",
        PART_WARN => "yellow",
        PART_BAD => "red",
        _ => "grey",
    }
}

fn severity(state: &str) -> u8 {
    match state {
        PART_BAD => 3,
        PART_WARN => 2,
        PART_OK => 1,
        _ => 0,
    }
}

fn static_state(state: &str) -> &'static str {
    match state {
        PART_OK => PART_OK,
        PART_WARN => PART_WARN,
        PART_BAD => PART_BAD,
        _ => PART_UNKNOWN,
    }
}

/// A row's colour: the worst of the parts that can be judged; grey only when
/// none can.
pub fn worst_state<'a>(states: impl IntoIterator<Item = &'a str>) -> &'static str {
    states
        .into_iter()
        .max_by_key(|state| severity(state))
        .map_or(PART_UNKNOWN, static_state)
}

// ════════════════════════════════════════════════════════════════════════════
// Settings (0637)
// ════════════════════════════════════════════════════════════════════════════

/// `GET/PUT /api/v1/fleet/alert-settings`. The whole set, read and written at
/// once; `quiet_from` and `quiet_until` are `HH:MM` on head office's clock,
/// both or neither.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FleetSettings {
    pub synced_within_seconds: i32,
    pub behind_alert_minutes: i32,
    pub offline_after_seconds: i32,
    pub alerts_enabled: bool,
    pub alert_on_red: bool,
    pub red_after_minutes: i32,
    pub alert_on_sync_behind: bool,
    pub alert_on_printer_fault: bool,
    pub alert_on_backup: bool,
    pub backup_max_age_hours: i32,
    pub alert_on_reader_silent: bool,
    pub reader_silent_minutes: i32,
    pub escalate_after_minutes: i32,
    pub notify_roles: Vec<String>,
    pub notify_unit_pic: bool,
    pub escalate_to_roles: Vec<String>,
    #[serde(default)]
    pub quiet_from: Option<String>,
    #[serde(default)]
    pub quiet_until: Option<String>,
    pub history_days: i32,
}

impl Default for FleetSettings {
    /// 0637's defaults, for a database that has lost its row.
    fn default() -> Self {
        Self {
            synced_within_seconds: 120,
            behind_alert_minutes: 30,
            offline_after_seconds: 120,
            alerts_enabled: true,
            alert_on_red: true,
            red_after_minutes: 5,
            alert_on_sync_behind: true,
            alert_on_printer_fault: true,
            alert_on_backup: true,
            backup_max_age_hours: 26,
            alert_on_reader_silent: true,
            reader_silent_minutes: 60,
            escalate_after_minutes: 30,
            notify_roles: vec!["IT".into(), "OWNER".into(), "ADMIN".into()],
            notify_unit_pic: true,
            escalate_to_roles: vec!["OWNER".into()],
            quiet_from: None,
            quiet_until: None,
            history_days: 100,
        }
    }
}

/// The settings with who last changed them.
#[derive(Debug, Clone, Serialize)]
pub struct FleetSettingsView {
    #[serde(flatten)]
    pub settings: FleetSettings,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// `HH:MM` or `HH:MM:SS` into minutes after midnight.
fn clock_minutes(text: &str) -> Option<u32> {
    let mut parts = text.trim().split(':');
    let hours: u32 = parts.next()?.parse().ok()?;
    let minutes: u32 = parts.next()?.parse().ok()?;
    if let Some(seconds) = parts.next() {
        let seconds: u32 = seconds.parse().ok()?;
        if seconds > 59 {
            return None;
        }
    }
    if parts.next().is_some() || hours > 23 || minutes > 59 {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn valid_role_code(code: &str) -> bool {
    let mut characters = code.chars();
    characters.next().is_some_and(|first| first.is_ascii_uppercase())
        && code.len() >= 2
        && code.len() <= 32
        && characters.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

impl FleetSettings {
    /// The same ranges the table holds them to, said in words first.
    pub fn validate(&self) -> Result<(), AppError> {
        let range = |name: &str, value: i32, low: i32, high: i32| {
            if value < low || value > high {
                Err(AppError::Validation(format!(
                    "{name} must be between {low} and {high}"
                )))
            } else {
                Ok(())
            }
        };
        range("synced_within_seconds", self.synced_within_seconds, 10, 3600)?;
        range("behind_alert_minutes", self.behind_alert_minutes, 1, 1440)?;
        range("offline_after_seconds", self.offline_after_seconds, 60, 3600)?;
        range("red_after_minutes", self.red_after_minutes, 0, 1440)?;
        range("backup_max_age_hours", self.backup_max_age_hours, 1, 720)?;
        range("reader_silent_minutes", self.reader_silent_minutes, 5, 1440)?;
        range("escalate_after_minutes", self.escalate_after_minutes, 1, 1440)?;
        range("history_days", self.history_days, 91, 400)?;
        if i64::from(self.behind_alert_minutes) * 60 < i64::from(self.synced_within_seconds) {
            return Err(AppError::Validation(
                "behind_alert_minutes must not be shorter than synced_within_seconds".into(),
            ));
        }
        for (name, roles) in [
            ("notify_roles", &self.notify_roles),
            ("escalate_to_roles", &self.escalate_to_roles),
        ] {
            if roles.is_empty() || roles.len() > 16 {
                return Err(AppError::Validation(format!(
                    "{name} names between 1 and 16 roles"
                )));
            }
            if let Some(bad) = roles.iter().find(|role| !valid_role_code(role)) {
                return Err(AppError::Validation(format!(
                    "{name}: {bad} is not a role code (upper-case letters, digits and _)"
                )));
            }
        }
        match (self.quiet_from.as_deref(), self.quiet_until.as_deref()) {
            (None, None) => {}
            (Some(from), Some(until)) => {
                let (Some(from), Some(until)) = (clock_minutes(from), clock_minutes(until)) else {
                    return Err(AppError::Validation(
                        "quiet hours are HH:MM on head office's clock".into(),
                    ));
                };
                if from == until {
                    return Err(AppError::Validation(
                        "quiet hours must start and end at different times".into(),
                    ));
                }
            }
            _ => {
                return Err(AppError::Validation(
                    "quiet hours need both a start and an end, or neither".into(),
                ))
            }
        }
        Ok(())
    }

    /// Whether `minute` (after midnight, head office's clock) is inside the
    /// quiet hours. A span that crosses midnight wraps.
    pub fn is_quiet_at(&self, minute: u32) -> bool {
        let (Some(from), Some(until)) = (
            self.quiet_from.as_deref().and_then(clock_minutes),
            self.quiet_until.as_deref().and_then(clock_minutes),
        ) else {
            return false;
        };
        if from < until {
            minute >= from && minute < until
        } else {
            minute >= from || minute < until
        }
    }
}

/// The one row of 0637, or its defaults.
pub async fn fleet_settings(
    executor: impl sqlx::PgExecutor<'_>,
) -> Result<FleetSettingsView, AppError> {
    let row = sqlx::query(
        "SELECT synced_within_seconds, behind_alert_minutes, offline_after_seconds,
                alerts_enabled, alert_on_red, red_after_minutes, alert_on_sync_behind,
                alert_on_printer_fault, alert_on_backup, backup_max_age_hours,
                alert_on_reader_silent, reader_silent_minutes, escalate_after_minutes,
                notify_roles, notify_unit_pic, escalate_to_roles,
                to_char(quiet_from, 'HH24:MI') AS quiet_from,
                to_char(quiet_until, 'HH24:MI') AS quiet_until,
                history_days, updated_by, updated_at
           FROM fleet_setting WHERE singleton",
    )
    .fetch_optional(executor)
    .await?;
    let Some(row) = row else {
        return Ok(FleetSettingsView {
            settings: FleetSettings::default(),
            updated_by: None,
            updated_at: None,
        });
    };
    Ok(FleetSettingsView {
        settings: FleetSettings {
            synced_within_seconds: row.try_get("synced_within_seconds")?,
            behind_alert_minutes: row.try_get("behind_alert_minutes")?,
            offline_after_seconds: row.try_get("offline_after_seconds")?,
            alerts_enabled: row.try_get("alerts_enabled")?,
            alert_on_red: row.try_get("alert_on_red")?,
            red_after_minutes: row.try_get("red_after_minutes")?,
            alert_on_sync_behind: row.try_get("alert_on_sync_behind")?,
            alert_on_printer_fault: row.try_get("alert_on_printer_fault")?,
            alert_on_backup: row.try_get("alert_on_backup")?,
            backup_max_age_hours: row.try_get("backup_max_age_hours")?,
            alert_on_reader_silent: row.try_get("alert_on_reader_silent")?,
            reader_silent_minutes: row.try_get("reader_silent_minutes")?,
            escalate_after_minutes: row.try_get("escalate_after_minutes")?,
            notify_roles: row.try_get("notify_roles")?,
            notify_unit_pic: row.try_get("notify_unit_pic")?,
            escalate_to_roles: row.try_get("escalate_to_roles")?,
            quiet_from: row.try_get("quiet_from")?,
            quiet_until: row.try_get("quiet_until")?,
            history_days: row.try_get("history_days")?,
        },
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Replace the settings. Admin only (`domain::auth`).
pub async fn fleet_update_settings(
    pool: &PgPool,
    settings: &FleetSettings,
    actor: &str,
) -> Result<FleetSettingsView, AppError> {
    settings.validate()?;
    let quiet = |value: &Option<String>| {
        value
            .as_deref()
            .and_then(clock_minutes)
            .map(|minutes| format!("{:02}:{:02}", minutes / 60, minutes % 60))
    };
    sqlx::query(
        "INSERT INTO fleet_setting (
             singleton, synced_within_seconds, behind_alert_minutes, offline_after_seconds,
             alerts_enabled, alert_on_red, red_after_minutes, alert_on_sync_behind,
             alert_on_printer_fault, alert_on_backup, backup_max_age_hours,
             alert_on_reader_silent, reader_silent_minutes, escalate_after_minutes,
             notify_roles, notify_unit_pic, escalate_to_roles, quiet_from, quiet_until,
             history_days, updated_by, updated_at)
         VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17::time, $18::time, $19, $20, now())
         ON CONFLICT (singleton) DO UPDATE SET
             synced_within_seconds = EXCLUDED.synced_within_seconds,
             behind_alert_minutes = EXCLUDED.behind_alert_minutes,
             offline_after_seconds = EXCLUDED.offline_after_seconds,
             alerts_enabled = EXCLUDED.alerts_enabled,
             alert_on_red = EXCLUDED.alert_on_red,
             red_after_minutes = EXCLUDED.red_after_minutes,
             alert_on_sync_behind = EXCLUDED.alert_on_sync_behind,
             alert_on_printer_fault = EXCLUDED.alert_on_printer_fault,
             alert_on_backup = EXCLUDED.alert_on_backup,
             backup_max_age_hours = EXCLUDED.backup_max_age_hours,
             alert_on_reader_silent = EXCLUDED.alert_on_reader_silent,
             reader_silent_minutes = EXCLUDED.reader_silent_minutes,
             escalate_after_minutes = EXCLUDED.escalate_after_minutes,
             notify_roles = EXCLUDED.notify_roles,
             notify_unit_pic = EXCLUDED.notify_unit_pic,
             escalate_to_roles = EXCLUDED.escalate_to_roles,
             quiet_from = EXCLUDED.quiet_from,
             quiet_until = EXCLUDED.quiet_until,
             history_days = EXCLUDED.history_days,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at",
    )
    .bind(settings.synced_within_seconds)
    .bind(settings.behind_alert_minutes)
    .bind(settings.offline_after_seconds)
    .bind(settings.alerts_enabled)
    .bind(settings.alert_on_red)
    .bind(settings.red_after_minutes)
    .bind(settings.alert_on_sync_behind)
    .bind(settings.alert_on_printer_fault)
    .bind(settings.alert_on_backup)
    .bind(settings.backup_max_age_hours)
    .bind(settings.alert_on_reader_silent)
    .bind(settings.reader_silent_minutes)
    .bind(settings.escalate_after_minutes)
    .bind(&settings.notify_roles)
    .bind(settings.notify_unit_pic)
    .bind(&settings.escalate_to_roles)
    .bind(quiet(&settings.quiet_from))
    .bind(quiet(&settings.quiet_until))
    .bind(settings.history_days)
    .bind(actor)
    .execute(pool)
    .await?;
    fleet_settings(pool).await
}

/// Whether the fleet alerts are on — which is when the older per-node alert
/// (`node_health::announce`) leaves the conditions they cover to them, so a
/// silent store is announced once, not twice.
pub async fn fleet_alerts_enabled(executor: impl sqlx::PgExecutor<'_>) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT alerts_enabled FROM fleet_setting WHERE singleton")
            .fetch_optional(executor)
            .await?
            .unwrap_or(true),
    )
}

// ════════════════════════════════════════════════════════════════════════════
// Job beats (0640)
// ════════════════════════════════════════════════════════════════════════════

pub const JOB_SYNC_APPLY: &str = "sync_apply";
pub const JOB_POSTINGS: &str = "postings";
pub const JOB_PUSH: &str = "push";
pub const JOB_BRIEF: &str = "brief";

/// A head-office loop finished a pass. Never fails the loop: a beat that
/// cannot be written is logged and forgotten.
pub async fn fleet_job_beat(pool: &PgPool, job: &str, error: Option<&str>) {
    let error = error.map(|text| text.chars().take(500).collect::<String>());
    let result = sqlx::query(
        "INSERT INTO fleet_job_beat (job, last_run_at, last_ok_at, last_error, last_error_at)
         VALUES ($1, now(), CASE WHEN $2::text IS NULL THEN now() END, $2,
                 CASE WHEN $2::text IS NOT NULL THEN now() END)
         ON CONFLICT (job) DO UPDATE SET
             last_run_at = EXCLUDED.last_run_at,
             last_ok_at = COALESCE(EXCLUDED.last_ok_at, fleet_job_beat.last_ok_at),
             last_error = COALESCE(EXCLUDED.last_error, fleet_job_beat.last_error),
             last_error_at = COALESCE(EXCLUDED.last_error_at, fleet_job_beat.last_error_at),
             runs = fleet_job_beat.runs + 1",
    )
    .bind(job)
    .bind(error)
    .execute(pool)
    .await;
    if let Err(error) = result {
        tracing::debug!(%error, job, "a job beat was not written down");
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Parts
// ════════════════════════════════════════════════════════════════════════════

/// One part of a row, judged now.
#[derive(Debug, Clone, Serialize)]
pub struct FleetPart {
    /// Stable within its row: `server`, `sync`, `backup`, `version`, `power`,
    /// `disk`, `device:<id>`, `desk_reader:<till id>`, `server:<origin>` for a
    /// second server at one site, `ho.api`, `ho.sync_apply`, `ho.postings`,
    /// `ho.notifications`, `ho.brief`.
    pub component: String,
    /// `SERVER`, `SYNC`, `DEVICE`, `DESK_READER`, `BACKUP`, `VERSION`,
    /// `POWER`, `DISK`, `HO_API`, `HO_JOB`.
    pub kind: &'static str,
    /// For a `DEVICE`: `TILL`, `PRINTER`, `HANDHELD`, `RFID_READER`, `EDC`,
    /// `ATTENDANCE_TERMINAL`.
    pub device_kind: Option<String>,
    pub label: String,
    pub state: &'static str,
    pub code: String,
    pub sentence: String,
    pub detail: Value,
}

fn part(
    component: impl Into<String>,
    kind: &'static str,
    label: impl Into<String>,
    state: &'static str,
    code: &str,
    sentence: impl Into<String>,
    detail: Value,
) -> FleetPart {
    FleetPart {
        component: component.into(),
        kind,
        device_kind: None,
        label: label.into(),
        state,
        code: code.to_owned(),
        sentence: sentence.into(),
        detail,
    }
}

/// `14:05` on a clock `offset_minutes` east of UTC.
fn local_hm(at: DateTime<Utc>, offset_minutes: i32) -> String {
    (at + Duration::minutes(i64::from(offset_minutes)))
        .format("%H:%M")
        .to_string()
}

/// `14:05`, or `27 Sep 14:05` when it was not today.
fn local_when(at: DateTime<Utc>, offset_minutes: i32, now: DateTime<Utc>) -> String {
    let shift = Duration::minutes(i64::from(offset_minutes));
    let (local, today) = (at + shift, now + shift);
    if local.date_naive() == today.date_naive() {
        local.format("%H:%M").to_string()
    } else {
        local.format("%-d %b %H:%M").to_string()
    }
}

/// `1.10.2` > `1.9.0`: numbers compared as numbers, anything else as text.
fn version_key(version: &str) -> Vec<(u64, String)> {
    version
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .map(|piece| (piece.parse::<u64>().unwrap_or(0), piece.to_owned()))
        .collect()
}

/// Everything head office holds about one node, read once per evaluation.
#[derive(Debug, Clone)]
struct NodeRow {
    origin_id: String,
    node_label: Option<String>,
    site_id: String,
    site_name: String,
    site_kind: String,
    site_code: Option<String>,
    unit_id: Option<String>,
    unit_code: Option<String>,
    unit_name: Option<String>,
    received_at: Option<DateTime<Utc>>,
    version: Option<String>,
    status: Option<NodeStatus>,
}

#[derive(Debug, Clone)]
struct PendingCommand {
    command_type: String,
    hint: Option<String>,
    issued_at: DateTime<Utc>,
    expired: bool,
    revoked: bool,
}

#[derive(Debug, Clone, Default)]
struct CommandCursor {
    issued_seq: i64,
    acked_seq: i64,
    acked_at: Option<DateTime<Utc>>,
    blocked_at_seq: Option<i64>,
    blocked_reason: Option<String>,
    blocked_since: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
struct IngestMark {
    durable_seq: i64,
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
struct RegisteredDevice {
    device_id: String,
    kind: String,
    site_id: String,
    label: String,
    status: String,
    last_seen_at: Option<DateTime<Utc>>,
}

// ---- Sync: freshness and queues, never a percentage ----------------------------

/// A store's sync, both directions (`GET /api/v1/fleet/sync`).
#[derive(Debug, Clone, Serialize)]
pub struct FleetFreshness {
    /// `SYNCED`, `BEHIND`, `OFFLINE` or `NEVER_SEEN`.
    pub state: &'static str,
    /// `OK`, `WARN`, `BAD`, `UNKNOWN`: behind past `behind_alert_minutes`
    /// and offline are red.
    pub tone: &'static str,
    pub colour: &'static str,
    pub sentence: String,
    pub last_heard_at: Option<DateTime<Utc>>,
    /// Set while offline: the last contact.
    pub offline_since: Option<DateTime<Utc>>,
    /// How far behind head office's picture of this store is: now minus the
    /// moment up to which it has everything the store wrote.
    pub behind_seconds: Option<i64>,
    /// Store → head office.
    pub up: UpstreamQueue,
    /// Head office → store.
    pub down: DownstreamQueue,
    /// For finance: head office holds every sale this store rang up before
    /// this moment.
    pub sales_complete_up_to: Option<DateTime<Utc>>,
    /// The same, `HH:MM` on the store's clock.
    pub sales_complete_up_to_local: Option<String>,
    /// Whether that moment is today on the store's clock. False means not
    /// even this morning's sales are known complete.
    pub sales_complete_today: bool,
    /// The store's most recent outage in the last week and what it was.
    pub last_outage: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpstreamQueue {
    /// Facts written at the store that head office has not acknowledged, as
    /// of `as_of`. `None` from a node that has never reported.
    pub waiting: Option<i64>,
    /// By kind: `SALES`, `STOCK`, `ATTENDANCE`, `OTHER`. `None` from a node
    /// older than the breakdown.
    pub by_kind: Option<Vec<QueuedFacts>>,
    pub oldest_unsent_at: Option<DateTime<Utc>>,
    pub oldest_unsent_age_seconds: Option<i64>,
    /// When the newest fact head office has was written ("data up to").
    pub data_up_to: Option<DateTime<Utc>>,
    /// When head office last acknowledged an upload from this store.
    pub last_ack_at: Option<DateTime<Utc>>,
    pub acked_seq: Option<i64>,
    /// Facts head office refused, held at the store.
    pub rejected: i64,
    /// When the store took the snapshot these figures come from.
    pub as_of: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownstreamQueue {
    /// Commands sent and not yet acknowledged.
    pub pending: i64,
    /// Those commands, named: "Price list v42", "Catalogue g17 (3 parts)".
    pub commands: Vec<PendingCommandGroup>,
    pub oldest_sent_at: Option<DateTime<Utc>>,
    pub oldest_age_seconds: Option<i64>,
    pub issued_seq: i64,
    pub acked_seq: i64,
    pub last_ack_at: Option<DateTime<Utc>>,
    /// Set when the store is stuck on a command it will not apply.
    pub blocked: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingCommandGroup {
    pub label: String,
    pub command_type: String,
    pub count: i64,
    pub oldest_sent_at: DateTime<Utc>,
    pub age_seconds: i64,
    /// Of `count`, how many passed their expiry or were recalled: the store
    /// will skip them, but must still acknowledge them.
    pub expired: i64,
    pub revoked: i64,
}

/// What a command on the lane is, in words a person at head office uses.
pub fn command_label(command_type: &str, hint: Option<&str>) -> String {
    let with = |base: &str| match hint {
        Some(hint) if !hint.is_empty() => format!("{base} {hint}"),
        _ => base.to_owned(),
    };
    match command_type {
        "commercial.publication.activate" => match hint {
            Some(version) => format!("Price list v{version}"),
            None => "Price list".to_owned(),
        },
        "catalog.snapshot.chunk" => match hint {
            Some(generation) => format!("Catalogue g{generation}"),
            None => "Catalogue".to_owned(),
        },
        "auth.policy.replace" => match hint {
            Some(version) => format!("Users and devices v{version}"),
            None => "Users and devices".to_owned(),
        },
        "attendance.book.replace" => "Attendance book".to_owned(),
        "payment.methods.replace" => "Payment methods".to_owned(),
        "commercial.usage.v1" => "Promotion usage".to_owned(),
        "commercial.campaign.v1" => "Campaigns".to_owned(),
        "commercial.eligibility.v1" => "Promotion eligibility".to_owned(),
        "purchase.order.activate" => with("Purchase order"),
        "purchase.order.revise" => format!("{} (revised)", with("Purchase order")),
        "purchase.order.cancel" => format!("{} (cancelled)", with("Purchase order")),
        "purchase.price_amendment.decided" => "Price amendment decision".to_owned(),
        "tagging.job.activate" => "Tagging job".to_owned(),
        wire::COMMAND_DEVICE_STATUS_SET => "Device switched on or off".to_owned(),
        other => {
            if let Some(action) = other.strip_prefix("node.") {
                format!("Server: {}", action.replace('_', " "))
            } else if let Some(rest) = other.strip_prefix("inventory.") {
                let words = rest
                    .trim_end_matches(".v1")
                    .replace(['.', '_'], " ");
                format!("Stock: {words}")
            } else {
                other.to_owned()
            }
        }
    }
}

fn group_commands(pending: &[&PendingCommand], now: DateTime<Utc>) -> Vec<PendingCommandGroup> {
    let mut groups: Vec<PendingCommandGroup> = Vec::new();
    let mut index: HashMap<(String, Option<String>), usize> = HashMap::new();
    for command in pending {
        let key = (command.command_type.clone(), command.hint.clone());
        let at = match index.get(&key) {
            Some(at) => *at,
            None => {
                groups.push(PendingCommandGroup {
                    label: command_label(&command.command_type, command.hint.as_deref()),
                    command_type: command.command_type.clone(),
                    count: 0,
                    oldest_sent_at: command.issued_at,
                    age_seconds: 0,
                    expired: 0,
                    revoked: 0,
                });
                index.insert(key, groups.len() - 1);
                groups.len() - 1
            }
        };
        if let Some(group) = groups.get_mut(at) {
            group.count += 1;
            group.oldest_sent_at = group.oldest_sent_at.min(command.issued_at);
            group.expired += i64::from(command.expired);
            group.revoked += i64::from(command.revoked);
        }
    }
    for group in &mut groups {
        group.age_seconds = (now - group.oldest_sent_at).num_seconds().max(0);
        if group.command_type == "catalog.snapshot.chunk" && group.count > 1 {
            group.label = format!("{} ({} parts)", group.label, group.count);
        }
    }
    groups.sort_by_key(|group| group.oldest_sent_at);
    groups
}

/// What the store's last outage was, from its journal and its link reports
/// (`node_incident`). `None` when it had none in the week.
fn outage_from(kind: &str, payload: &Value) -> Option<Value> {
    match kind {
        "CONNECTION_LOST" => Some(json!({
            "cause": "INTERNET",
            "from": payload.get("from"),
            "to": payload.get("to"),
            "kept_selling": payload.get("sales_written").and_then(Value::as_i64).unwrap_or(0) > 0,
            "facts_written": payload.get("facts_written"),
            "sales_written": payload.get("sales_written"),
            "sentence": "The internet was down; the server stayed on and kept everything written meanwhile.",
        })),
        "STARTED" => {
            let previous = payload.get("previous")?;
            let at = payload.get("at");
            let (cause, from, sentence) = match previous.get("how").and_then(Value::as_str)? {
                "CLEAN" => (
                    "STOPPED",
                    previous.get("at"),
                    "Stopped on purpose: a restart, an update or a shutdown.",
                ),
                "HUNG" => (
                    "CRASH",
                    previous.get("at"),
                    "The server hung and restarted itself.",
                ),
                "UNCLEAN" => match previous.get("machine_restarted").and_then(Value::as_bool) {
                    Some(true) => (
                        "SWITCHED_OFF",
                        previous.get("last_seen"),
                        "The machine was switched off or lost power.",
                    ),
                    _ => (
                        "CRASH",
                        previous.get("last_seen"),
                        "The server stopped suddenly and recovered on its own.",
                    ),
                },
                _ => return None,
            };
            Some(json!({
                "cause": cause,
                "from": from,
                "to": at,
                "kept_selling": false,
                "sentence": sentence,
            }))
        }
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
fn node_freshness(
    node: &NodeRow,
    pending: &[&PendingCommand],
    cursor: Option<&CommandCursor>,
    ingest: Option<&IngestMark>,
    last_outage: Option<Value>,
    settings: &FleetSettings,
    offset_minutes: i32,
    now: DateTime<Utc>,
) -> FleetFreshness {
    let status = node.status.as_ref();
    let sync = status.map(|status| &status.sync);
    let queue = sync.and_then(|sync| sync.queue.clone());
    let waiting = match (&queue, sync) {
        (Some(queue), _) => Some(queue.iter().map(|kind| kind.count).sum()),
        (None, Some(sync)) => Some(sync.pending_facts),
        (None, None) => None,
    };
    let oldest_unsent_at = queue
        .as_ref()
        .and_then(|queue| queue.iter().filter_map(|kind| kind.oldest_at).min())
        .or_else(|| sync.and_then(|sync| sync.oldest_pending_at));
    let taken_at = status.map(|status| status.taken_at);
    // Head office has everything written before this moment.
    let complete_up_to = match (oldest_unsent_at, taken_at) {
        (Some(oldest), _) => Some(oldest),
        (None, Some(taken)) => Some(taken.min(node.received_at.unwrap_or(taken))),
        (None, None) => None,
    };
    let behind_seconds = complete_up_to.map(|at| (now - at).num_seconds().max(0));
    let sales_complete_up_to = match &queue {
        Some(queue) => queue
            .iter()
            .find(|kind| kind.kind == QUEUE_SALES)
            .and_then(|sales| sales.oldest_at.filter(|_| sales.count > 0))
            .or(taken_at),
        None => oldest_unsent_at.or(taken_at),
    };
    let shift = Duration::minutes(i64::from(offset_minutes));
    let sales_complete_today = sales_complete_up_to
        .is_some_and(|at| (at + shift).date_naive() == (now + shift).date_naive());

    let down_oldest = pending.iter().map(|command| command.issued_at).min();
    let down_age = down_oldest.map(|at| (now - at).num_seconds().max(0));
    let cursor = cursor.cloned().unwrap_or_default();
    let down = DownstreamQueue {
        pending: pending.len() as i64,
        commands: group_commands(pending, now),
        oldest_sent_at: down_oldest,
        oldest_age_seconds: down_age,
        issued_seq: cursor.issued_seq,
        acked_seq: cursor.acked_seq,
        last_ack_at: cursor.acked_at,
        blocked: cursor.blocked_at_seq.map(|seq| {
            json!({ "seq": seq, "reason": cursor.blocked_reason, "since": cursor.blocked_since })
        }),
    };
    let up = UpstreamQueue {
        waiting,
        by_kind: queue.clone(),
        oldest_unsent_at,
        oldest_unsent_age_seconds: oldest_unsent_at.map(|at| (now - at).num_seconds().max(0)),
        data_up_to: sync.and_then(|sync| sync.newest_acked_at),
        last_ack_at: ingest.and_then(|mark| mark.updated_at),
        acked_seq: ingest.map(|mark| mark.durable_seq),
        rejected: sync.map_or(0, |sync| sync.dead_lettered),
        as_of: taken_at,
    };

    let synced_within = i64::from(settings.synced_within_seconds);
    let alert_after = i64::from(settings.behind_alert_minutes) * 60;
    let offline = node
        .received_at
        .is_none_or(|heard| (now - heard).num_seconds() > i64::from(settings.offline_after_seconds));
    let waiting_words = |waiting: Option<i64>| match (waiting, &queue) {
        (Some(0), _) | (None, _) => "nothing waiting".to_owned(),
        (Some(count), Some(queue)) => {
            let kinds: Vec<String> = queue
                .iter()
                .filter(|kind| kind.count > 0)
                .map(|kind| format!("{} {}", kind.kind.to_lowercase(), kind.count))
                .collect();
            format!("{count} events waiting ({})", kinds.join(", "))
        }
        (Some(count), None) => format!("{count} events waiting"),
    };
    let commands_words = || {
        let names: Vec<String> = down
            .commands
            .iter()
            .take(3)
            .map(|group| format!("{}, sent {} ago", group.label, span(Duration::seconds(group.age_seconds))))
            .collect();
        format!(
            "{} {} not yet taken ({})",
            down.pending,
            if down.pending == 1 { "command" } else { "commands" },
            names.join("; ")
        )
    };

    let (state, tone, sentence, offline_since) = match node.received_at {
        None => (
            "NEVER_SEEN",
            PART_UNKNOWN,
            "This server has never reported in.".to_owned(),
            None,
        ),
        Some(heard) if offline => (
            "OFFLINE",
            PART_BAD,
            format!(
                "No contact since {} ({}). {} then; the store keeps selling while its server is on.",
                local_when(heard, offset_minutes, now),
                span(now - heard),
                waiting_words(waiting)
            ),
            Some(heard),
        ),
        Some(_) => {
            let up_behind = behind_seconds.unwrap_or(0);
            let down_behind = down_age.unwrap_or(0);
            let behind = up_behind >= synced_within || down_behind >= synced_within;
            if behind {
                let mut words = Vec::new();
                if up_behind >= synced_within {
                    words.push(format!("{} behind — {}", span(Duration::seconds(up_behind)), waiting_words(waiting)));
                }
                if down.pending > 0 {
                    words.push(commands_words());
                }
                let tone = if up_behind >= alert_after || down_behind >= alert_after {
                    PART_BAD
                } else {
                    PART_WARN
                };
                ("BEHIND", tone, format!("Up · behind: {}.", words.join("; ")), None)
            } else {
                let mut words = vec![format!("Up · synced: {}", waiting_words(waiting))];
                if down.pending > 0 {
                    words.push(commands_words());
                }
                ("SYNCED", PART_OK, format!("{}.", words.join("; ")), None)
            }
        }
    };
    FleetFreshness {
        state,
        tone,
        colour: part_colour(tone),
        sentence,
        last_heard_at: node.received_at,
        offline_since,
        behind_seconds,
        up,
        down,
        sales_complete_up_to,
        sales_complete_up_to_local: sales_complete_up_to.map(|at| local_hm(at, offset_minutes)),
        sales_complete_today,
        last_outage,
    }
}

// ---- A node's parts -----------------------------------------------------------

fn server_part(
    component: &str,
    label: &str,
    node: &NodeRow,
    offline: bool,
    offset_minutes: i32,
    now: DateTime<Utc>,
) -> FleetPart {
    let detail = json!({
        "origin_id": node.origin_id,
        "last_heard_at": node.received_at,
        "version": node.version,
        "started_at": node.status.as_ref().map(|status| status.started_at),
        "hostname": node.status.as_ref().map(|status| status.hostname.clone()),
    });
    let Some(heard) = node.received_at else {
        return part(component, "SERVER", label, PART_UNKNOWN, "NEVER_SEEN",
            "This server has never reported in. Make sure it is on and online.", detail);
    };
    if offline {
        return part(
            component,
            "SERVER",
            label,
            PART_BAD,
            "OFFLINE",
            format!(
                "No word since {} ({}): the internet, the power, or the server is off.",
                local_when(heard, offset_minutes, now),
                span(now - heard)
            ),
            detail,
        );
    }
    let Some(status) = node.status.as_ref() else {
        return part(component, "SERVER", label, PART_UNKNOWN, "UNKNOWN",
            "This server reports in without a status: its version is too old.", detail);
    };
    if status.sync.dead_lettered > 0 {
        return part(component, "SERVER", label, PART_BAD, "REJECTED_FACTS",
            format!("Head office refused {} records. They are held on the server; a developer needs to look.", status.sync.dead_lettered),
            detail);
    }
    if status
        .sync
        .last_error
        .as_deref()
        .is_some_and(|error| error.contains("403") || error.contains("x-sync-key"))
    {
        return part(component, "SERVER", label, PART_BAD, "KEY_REFUSED",
            "Head office refuses this machine's key: it was replaced or revoked. Enrol it again if that is a mistake.",
            detail);
    }
    if let Some(skew) = status.machine.clock_skew_seconds.filter(|skew| skew.abs() > 30) {
        return part(component, "SERVER", label, PART_BAD, "CLOCK_SKEW",
            format!("The clock is {} off from head office; tills may be refused. Turn on automatic time.", span(Duration::seconds(skew.abs()))),
            detail);
    }
    let disturbances = disturbances_today(&status.incidents, now);
    if disturbances > 3 {
        return part(component, "SERVER", label, PART_WARN, "UNSTABLE",
            format!("Disrupted {disturbances} times in 24 hours. It recovered each time, but this has a cause."),
            detail);
    }
    let recovered = if disturbances > 0 {
        format!(
            " Recovered by itself {disturbances} {} today.",
            if disturbances == 1 { "time" } else { "times" }
        )
    } else {
        String::new()
    };
    part(
        component,
        "SERVER",
        label,
        PART_OK,
        if disturbances > 0 { "RECOVERED" } else { "RUNNING" },
        format!(
            "Running since {} ({}).{recovered}",
            local_when(status.started_at, offset_minutes, now),
            span(now - status.started_at)
        ),
        detail,
    )
}

fn silent_part(component: String, kind: &'static str, label: String, device_kind: Option<String>) -> FleetPart {
    FleetPart {
        component,
        kind,
        device_kind,
        label,
        state: PART_UNKNOWN,
        code: "NO_REPORT".to_owned(),
        sentence: "Not known while the store's server is silent.".to_owned(),
        detail: json!({}),
    }
}

fn backup_part(status: &NodeStatus, settings: &FleetSettings, offset_minutes: i32, now: DateTime<Utc>) -> FleetPart {
    let facts = status.machine.backup.clone().unwrap_or_default();
    let last_ok = match (facts.last_ok_at, status.machine.last_backup_at) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    };
    let detail = json!({
        "last_ok_at": last_ok,
        "last_attempt_at": facts.last_attempt_at,
        "last_error": facts.last_error,
        "last_bytes": facts.last_bytes,
        "max_age_hours": settings.backup_max_age_hours,
    });
    let max_age = Duration::hours(i64::from(settings.backup_max_age_hours));
    if let (Some(error), Some(attempt)) = (facts.last_error.as_deref(), facts.last_attempt_at) {
        if last_ok.is_none_or(|ok| attempt > ok) {
            return part("backup", "BACKUP", "Daily backup", PART_BAD, "FAILED",
                format!("The last backup failed at {}: {error}", local_when(attempt, offset_minutes, now)),
                detail);
        }
    }
    match last_ok {
        Some(at) if now - at > max_age => part("backup", "BACKUP", "Daily backup", PART_BAD, "STALE",
            format!("The newest backup is {} old (taken {}).", span(now - at), local_when(at, offset_minutes, now)),
            detail),
        Some(at) => part("backup", "BACKUP", "Daily backup", PART_OK, "OK",
            format!("Last backup {} ({} ago).", local_when(at, offset_minutes, now), span(now - at)),
            detail),
        None if now - status.started_at > max_age => part("backup", "BACKUP", "Daily backup", PART_BAD, "STALE",
            format!("No backup in {} of running.", span(now - status.started_at)),
            detail),
        None => part("backup", "BACKUP", "Daily backup", PART_WARN, "NONE",
            "No backup yet; the first is taken within a day of starting.", detail),
    }
}

fn version_part(node: &NodeRow, newest: Option<&str>) -> FleetPart {
    let Some(version) = node.version.as_deref() else {
        return part("version", "VERSION", "Server version", PART_UNKNOWN, "UNKNOWN",
            "Not reported yet.", json!({}));
    };
    let detail = json!({ "version": version, "newest_in_fleet": newest });
    match newest {
        Some(newest) if version_key(version) < version_key(newest) => part(
            "version", "VERSION", "Server version", PART_WARN, "OUTDATED",
            format!("Runs {version}; the newest in the fleet is {newest}."), detail),
        _ => part("version", "VERSION", "Server version", PART_OK, "CURRENT",
            format!("Runs {version}, the newest in the fleet."), detail),
    }
}

fn power_part(status: &NodeStatus) -> FleetPart {
    let Some(power) = status.machine.power.as_ref() else {
        return part("power", "POWER", "Power / UPS", PART_UNKNOWN, "NO_UPS",
            "No UPS reported on this server.", json!({}));
    };
    let detail = json!({
        "source": power.source,
        "charge_percent": power.charge_percent,
        "runtime_seconds": power.runtime_seconds,
        "low": power.low,
    });
    let charge = power.charge_percent.map(|c| format!(" (battery {c} %)")).unwrap_or_default();
    match power.source {
        PowerSource::Battery if power.low => part("power", "POWER", "Power / UPS", PART_BAD, "UPS_LOW",
            format!("Power cut and the UPS battery is almost empty{charge}. The server will shut down cleanly."), detail),
        PowerSource::Battery => {
            let left = power
                .runtime_seconds
                .map(|seconds| format!(", about {} left", span(Duration::seconds(seconds))))
                .unwrap_or_default();
            part("power", "POWER", "Power / UPS", PART_WARN, "ON_BATTERY",
                format!("Power cut: running on the UPS{left}{charge}."), detail)
        }
        PowerSource::Mains => part("power", "POWER", "Power / UPS", PART_OK, "MAINS",
            format!("On mains power{charge}."), detail),
        PowerSource::Unknown => part("power", "POWER", "Power / UPS", PART_UNKNOWN, "UNKNOWN",
            "The UPS does not say whether it is on mains or battery.", detail),
    }
}

fn disk_part(status: &NodeStatus) -> FleetPart {
    let (Some(free), Some(total)) = (status.machine.disk_free_bytes, status.machine.disk_total_bytes) else {
        return part("disk", "DISK", "Disk", PART_UNKNOWN, "UNKNOWN", "Not reported.", json!({}));
    };
    let percent = if total > 0 { free * 100 / total } else { 100 };
    let gigabytes = free as f64 / 1_073_741_824.0;
    let detail = json!({
        "free_bytes": free,
        "total_bytes": total,
        "free_percent": percent,
        "database_bytes": status.machine.database_bytes,
    });
    if percent < 5 {
        part("disk", "DISK", "Disk", PART_BAD, "DISK_CRITICAL",
            format!("Only {gigabytes:.1} GB free ({percent} %). A full disk stops the server saving sales."), detail)
    } else if percent < 10 {
        part("disk", "DISK", "Disk", PART_WARN, "DISK_LOW",
            format!("Only {gigabytes:.1} GB free ({percent} %). Plan to free up or replace the disk."), detail)
    } else {
        part("disk", "DISK", "Disk", PART_OK, "OK", format!("{gigabytes:.1} GB free ({percent} %)."), detail)
    }
}

fn device_part(
    device: &DeviceReport,
    status: &NodeStatus,
    settings: &FleetSettings,
    offset_minutes: i32,
    now: DateTime<Utc>,
) -> Vec<FleetPart> {
    let health = device.health.clone().unwrap_or_default();
    let when = |at: DateTime<Utc>| local_when(at, offset_minutes, now);
    let component = format!("device:{}", device.device_id);
    let mut detail = serde_json::to_value(&health).unwrap_or_else(|_| json!({}));
    if let Value::Object(map) = &mut detail {
        map.insert("device_id".into(), json!(device.device_id));
        map.insert("status".into(), json!(device.status));
        map.insert("last_seen_at".into(), json!(device.last_seen_at));
    }
    let make = |state: &'static str, code: &str, label: String, sentence: String, detail: Value| FleetPart {
        component: component.clone(),
        kind: "DEVICE",
        device_kind: Some(device.kind.clone()),
        label,
        state,
        code: code.to_owned(),
        sentence,
        detail,
    };
    if device.status == wire::STATUS_SUSPENDED {
        return vec![make(PART_UNKNOWN, "SUSPENDED", device.label.clone(),
            "Switched off; it cannot be used until it is switched on again.".into(), detail)];
    }
    let online_within = Duration::minutes(DEVICE_ONLINE_MINUTES);
    let mut parts = Vec::new();
    match device.kind.as_str() {
        wire::KIND_TILL => {
            let drawer_open = status
                .till
                .open_shift_terminals
                .iter()
                .any(|name| *name == device.label || *name == device.device_id);
            let till = match device.last_seen_at {
                Some(at) if now - at <= Duration::minutes(TILL_QUIET_MINUTES) => make(
                    PART_OK, "ONLINE", device.label.clone(),
                    format!("Active; last request {}.", when(at)), detail.clone()),
                Some(at) if drawer_open => make(
                    PART_WARN, "QUIET", device.label.clone(),
                    format!("Its drawer is open but it has sent nothing since {} ({}).", when(at), span(now - at)),
                    detail.clone()),
                Some(at) => make(PART_UNKNOWN, "IDLE", device.label.clone(),
                    format!("Idle since {}.", when(at)), detail.clone()),
                None => make(PART_UNKNOWN, "NEVER", device.label.clone(),
                    "Not used yet.".into(), detail.clone()),
            };
            parts.push(till);
            if let Some(reader) = health.desk_reader.as_ref() {
                let model = reader.model.clone().unwrap_or_else(|| "desk reader".to_owned());
                let label = format!("{} desk reader ({model})", device.label);
                let reader_detail = json!({
                    "till_id": device.device_id,
                    "model": reader.model,
                    "attached": reader.attached,
                    "reported_at": reader.reported_at,
                });
                let (state, code, sentence) = match reader.attached {
                    Some(true) => (PART_OK, "ATTACHED", format!("{model} plugged in.")),
                    Some(false) => (
                        PART_WARN,
                        "DETACHED",
                        format!(
                            "{model} is not plugged in{}.",
                            reader.reported_at.map(|at| format!(" (reported {})", when(at))).unwrap_or_default()
                        ),
                    ),
                    None => (
                        PART_UNKNOWN,
                        "NOT_REPORTED",
                        format!("{model} configured; this till does not say whether it is plugged in."),
                    ),
                };
                parts.push(FleetPart {
                    component: format!("desk_reader:{}", device.device_id),
                    kind: "DESK_READER",
                    device_kind: None,
                    label,
                    state,
                    code: code.to_owned(),
                    sentence,
                    detail: reader_detail,
                });
            }
        }
        wire::KIND_PRINTER => {
            let purpose = device.config.get("purpose").and_then(Value::as_str).unwrap_or("LABEL");
            let label = device.label.clone();
            if let Some(fault) = health.fault.as_deref() {
                parts.push(make(PART_BAD, "FAULT", label,
                    format!("The last label failed{}: {fault}",
                        health.fault_at.map(|at| format!(" at {}", when(at))).unwrap_or_default()),
                    detail));
            } else if purpose == "LABEL" {
                let failures = health.encode_failures_24h.unwrap_or(0);
                let voided = health.void_tags_24h.unwrap_or(0);
                let printed = health.labels_printed_24h.unwrap_or(0);
                let last = health
                    .last_print_at
                    .map(|at| format!("last print {}", when(at)))
                    .unwrap_or_else(|| "nothing printed yet".to_owned());
                if failures > 0 {
                    parts.push(make(PART_WARN, "ENCODE_FAILURES", label,
                        format!("{failures} labels could not be encoded in 24 h ({voided} tags voided); {last}."),
                        detail));
                } else {
                    parts.push(make(PART_OK, "READY", label,
                        format!("Ready; {last}; {printed} labels in 24 h, {voided} tags voided."), detail));
                }
            } else {
                parts.push(match device.last_seen_at {
                    Some(at) => make(PART_OK, "READY", label, format!("Last used {}.", when(at)), detail),
                    None => make(PART_UNKNOWN, "NEVER", label, "Not used yet.".into(), detail),
                });
            }
        }
        wire::KIND_HANDHELD => {
            let alive_at = match (health.pinged_at, device.last_seen_at) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            };
            let mut facts = Vec::new();
            if let Some(battery) = health.battery_percent {
                facts.push(format!("battery {battery} %"));
            }
            if let Some(version) = health.app_version.as_deref() {
                facts.push(format!("app {version}"));
            }
            if let Some(scan) = health.last_scan_at.or(health.last_tag_at) {
                facts.push(format!("last scan {}", when(scan)));
            }
            let facts = if facts.is_empty() { String::new() } else { format!(" · {}", facts.join(" · ")) };
            parts.push(match alive_at {
                Some(at) if now - at <= online_within => {
                    if health.battery_percent.is_some_and(|battery| battery <= HANDHELD_BATTERY_LOW) {
                        make(PART_WARN, "BATTERY_LOW", device.label.clone(), format!("Online, battery low{facts}."), detail)
                    } else {
                        make(PART_OK, "ONLINE", device.label.clone(), format!("Online{facts}."), detail)
                    }
                }
                Some(at) => make(PART_UNKNOWN, "IDLE", device.label.clone(),
                    format!("Last seen {}{facts}.", when(at)), detail),
                None => make(PART_UNKNOWN, "NEVER", device.label.clone(), "Not used yet.".into(), detail),
            });
        }
        wire::KIND_RFID_READER => {
            let alive_at = match (health.pinged_at, device.last_seen_at) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            };
            let silent_after = Duration::minutes(i64::from(settings.reader_silent_minutes));
            let rate = health
                .reads_per_minute
                .map(|rate| format!("{rate:.1} reads/min"))
                .unwrap_or_else(|| "no read rate".to_owned());
            parts.push(match alive_at {
                Some(at) if now - at <= online_within => match health.last_tag_at {
                    Some(tag) if now - tag <= silent_after => make(PART_OK, "READING", device.label.clone(),
                        format!("Reading: {rate}; last tag {}.", when(tag)), detail),
                    Some(tag) => make(PART_WARN, "SILENT", device.label.clone(),
                        format!("Alive but no tag read for {} (last {}).", span(now - tag), when(tag)), detail),
                    None => make(PART_WARN, "SILENT", device.label.clone(),
                        "Alive but has never read a tag.".into(), detail),
                },
                Some(at) if health.pinged_at.is_some() => make(PART_BAD, "OFFLINE", device.label.clone(),
                    format!("No word from this reader since {} ({}).", when(at), span(now - at)), detail),
                Some(at) => make(PART_UNKNOWN, "QUIET", device.label.clone(),
                    format!("Last batch {}; this reader does not ping, so quiet and off look the same.", when(at)),
                    detail),
                None => make(PART_UNKNOWN, "NEVER", device.label.clone(), "Has not reported yet.".into(), detail),
            });
        }
        _ => parts.push(make(PART_UNKNOWN, "UNKNOWN", device.label.clone(),
            "Reported without anything to judge.".into(), detail)),
    }
    parts
}

fn registered_device_part(device: &RegisteredDevice, offset_minutes: i32, now: DateTime<Utc>) -> FleetPart {
    let detail = json!({ "device_id": device.device_id, "status": device.status, "last_seen_at": device.last_seen_at });
    let make = |state: &'static str, code: &str, sentence: String| FleetPart {
        component: format!("device:{}", device.device_id),
        kind: "DEVICE",
        device_kind: Some(device.kind.clone()),
        label: device.label.clone(),
        state,
        code: code.to_owned(),
        sentence,
        detail: detail.clone(),
    };
    if device.status != wire::STATUS_ACTIVE {
        return make(PART_UNKNOWN, "SUSPENDED", "Switched off at head office.".into());
    }
    match (device.kind.as_str(), device.last_seen_at) {
        (wire::KIND_ATTENDANCE_TERMINAL, Some(at)) if now - at <= Duration::hours(26) => make(
            PART_OK, "ONLINE", format!("Last heard {}.", local_when(at, offset_minutes, now))),
        (wire::KIND_ATTENDANCE_TERMINAL, Some(at)) => make(
            PART_WARN, "QUIET", format!("Nothing from this terminal for {}.", span(now - at))),
        (wire::KIND_ATTENDANCE_TERMINAL, None) => make(PART_UNKNOWN, "NEVER", "Has not reported yet.".into()),
        _ => make(PART_UNKNOWN, "NOT_MONITORED", "Registered; nothing reports its condition yet.".into()),
    }
}

/// Every part of one node's site, judged now.
fn node_parts(
    node: &NodeRow,
    freshness: &FleetFreshness,
    settings: &FleetSettings,
    newest_version: Option<&str>,
    offset_minutes: i32,
    now: DateTime<Utc>,
) -> Vec<FleetPart> {
    let offline = freshness.state == "OFFLINE" || freshness.state == "NEVER_SEEN";
    let mut parts = vec![server_part("server", "Store server", node, offline, offset_minutes, now)];
    parts.push(part(
        "sync",
        "SYNC",
        "Connection & sync",
        freshness.tone,
        freshness.state,
        freshness.sentence.clone(),
        json!({
            "behind_seconds": freshness.behind_seconds,
            "waiting": freshness.up.waiting,
            "pending_commands": freshness.down.pending,
        }),
    ));
    parts.push(version_part(node, newest_version));
    let status = node.status.as_ref().filter(|_| !offline);
    match status {
        Some(status) => {
            parts.push(backup_part(status, settings, offset_minutes, now));
            parts.push(power_part(status));
            parts.push(disk_part(status));
            for device in status.device_list.iter().flatten() {
                if device.status == wire::STATUS_REVOKED {
                    continue;
                }
                parts.extend(device_part(device, status, settings, offset_minutes, now));
            }
        }
        None => {
            parts.push(silent_part("backup".into(), "BACKUP", "Daily backup".into(), None));
            parts.push(silent_part("power".into(), "POWER", "Power / UPS".into(), None));
            parts.push(silent_part("disk".into(), "DISK", "Disk".into(), None));
            let last_known = node.status.as_ref().and_then(|status| status.device_list.clone());
            for device in last_known.iter().flatten() {
                if device.status == wire::STATUS_REVOKED {
                    continue;
                }
                parts.push(silent_part(
                    format!("device:{}", device.device_id),
                    "DEVICE",
                    device.label.clone(),
                    Some(device.kind.clone()),
                ));
            }
        }
    }
    parts
}

// ════════════════════════════════════════════════════════════════════════════
// Head office's own row
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
struct JobBeat {
    last_run_at: DateTime<Utc>,
    last_ok_at: Option<DateTime<Utc>>,
    last_error: Option<String>,
    last_error_at: Option<DateTime<Utc>>,
}

async fn job_beats(pool: &PgPool) -> Result<HashMap<String, JobBeat>, AppError> {
    let rows = sqlx::query(
        "SELECT job, last_run_at, last_ok_at, last_error, last_error_at FROM fleet_job_beat",
    )
    .fetch_all(pool)
    .await?;
    let mut beats = HashMap::new();
    for row in rows {
        beats.insert(
            row.try_get::<String, _>("job")?,
            JobBeat {
                last_run_at: row.try_get("last_run_at")?,
                last_ok_at: row.try_get("last_ok_at")?,
                last_error: row.try_get("last_error")?,
                last_error_at: row.try_get("last_error_at")?,
            },
        );
    }
    Ok(beats)
}

/// A loop that has not finished a pass in `stale` is stopped; one whose last
/// pass failed says so. `None` when the loop is fine, or has never run here.
fn beat_problem(
    component: &str,
    label: &str,
    beat: Option<&JobBeat>,
    stale: Duration,
    offset_minutes: i32,
    now: DateTime<Utc>,
) -> Option<FleetPart> {
    let beat = beat?;
    let detail = json!({
        "last_run_at": beat.last_run_at,
        "last_ok_at": beat.last_ok_at,
        "last_error": beat.last_error,
        "last_error_at": beat.last_error_at,
    });
    if now - beat.last_run_at > stale {
        return Some(part(component, "HO_JOB", label, PART_BAD, "STOPPED",
            format!("Has not run since {} ({}).", local_when(beat.last_run_at, offset_minutes, now), span(now - beat.last_run_at)),
            detail));
    }
    if let (Some(error), Some(at)) = (beat.last_error.as_deref(), beat.last_error_at) {
        if beat.last_ok_at.is_none_or(|ok| at > ok) {
            return Some(part(component, "HO_JOB", label, PART_WARN, "FAILING",
                format!("The last pass failed at {}: {error}", local_when(at, offset_minutes, now)),
                detail));
        }
    }
    None
}

async fn head_office_parts(pool: &PgPool, offset_minutes: i32, now: DateTime<Utc>) -> Result<Vec<FleetPart>, AppError> {
    let beats = job_beats(pool).await?;
    let mut parts = Vec::new();

    // The API and the database: if this runs, both answer; how fast is the
    // question. When they do not, nothing is written, and the gap in the
    // history is the outage (0638).
    let started = std::time::Instant::now();
    sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(pool).await?;
    let milliseconds = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    parts.push(if milliseconds > 1000 {
        part("ho.api", "HO_API", "Cloud API & database", PART_WARN, "SLOW",
            format!("Answering, but the database took {milliseconds} ms for a trivial query."),
            json!({ "database_ms": milliseconds }))
    } else {
        part("ho.api", "HO_API", "Cloud API & database", PART_OK, "OK",
            format!("Answering; the database in {milliseconds} ms."), json!({ "database_ms": milliseconds }))
    });

    // Applying what the stores sent.
    let apply = sqlx::query(
        "SELECT count(*) FILTER (WHERE a.blocked_at_seq IS NOT NULL) AS blocked,
                min(a.blocked_since) AS blocked_since,
                (array_agg(a.blocked_reason ORDER BY a.blocked_since) FILTER (WHERE a.blocked_at_seq IS NOT NULL))[1] AS reason,
                COALESCE(sum(GREATEST(i.durable_seq - COALESCE(a.applied_seq, 0), 0)), 0)::bigint AS lag
           FROM sync_ingest_watermark i
           LEFT JOIN sync_applied_watermark a
             ON a.origin_id = i.origin_id AND a.generation = i.generation",
    )
    .fetch_one(pool)
    .await?;
    let blocked: i64 = apply.try_get("blocked")?;
    let blocked_since: Option<DateTime<Utc>> = apply.try_get("blocked_since")?;
    let reason: Option<String> = apply.try_get("reason")?;
    let lag: i64 = apply.try_get("lag")?;
    let apply_detail = json!({ "blocked_streams": blocked, "blocked_since": blocked_since, "reason": reason, "waiting": lag });
    let apply_label = "Sync apply";
    parts.push(if blocked > 0 {
        let long = blocked_since.is_some_and(|since| now - since > Duration::minutes(30));
        part("ho.sync_apply", "HO_JOB", apply_label, if long { PART_BAD } else { PART_WARN }, "BLOCKED",
            format!("{blocked} store {} stuck{}: {}", if blocked == 1 { "stream" } else { "streams" },
                blocked_since.map(|at| format!(" since {}", local_when(at, offset_minutes, now))).unwrap_or_default(),
                reason.as_deref().unwrap_or("no reason given")),
            apply_detail)
    } else if let Some(problem) = beat_problem("ho.sync_apply", apply_label, beats.get(JOB_SYNC_APPLY), Duration::minutes(10), offset_minutes, now) {
        problem
    } else if !beats.contains_key(JOB_SYNC_APPLY) && lag > 0 {
        part("ho.sync_apply", "HO_JOB", apply_label, PART_WARN, "NOT_RUNNING",
            format!("{lag} facts received and not applied, and no applier has reported on this server."), apply_detail)
    } else {
        part("ho.sync_apply", "HO_JOB", apply_label, PART_OK, "OK",
            if lag > 0 { format!("Applying; {lag} facts in hand.") } else { "Everything received is applied.".to_owned() },
            apply_detail)
    });

    // Automatic postings: a sales day, a goods receipt, a flow's meanings.
    let held = sqlx::query(
        "SELECT count(*) AS held, min(attempted_at) AS since,
                (array_agg(note ORDER BY attempted_at))[1] AS reason
           FROM flow_posting WHERE status = 'PENDING' AND note IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    let held_count: i64 = held.try_get("held")?;
    let held_since: Option<DateTime<Utc>> = held.try_get("since")?;
    let held_reason: Option<String> = held.try_get("reason")?;
    let postings_detail = json!({ "held_flow_postings": held_count, "held_since": held_since, "first_reason": held_reason });
    parts.push(
        if let Some(problem) = beat_problem("ho.postings", "Automatic postings", beats.get(JOB_POSTINGS), Duration::hours(2), offset_minutes, now) {
            problem
        } else if held_count > 0 {
            part("ho.postings", "HO_JOB", "Automatic postings", PART_WARN, "HELD",
                format!("{held_count} flow {} held for Finance: {}", if held_count == 1 { "posting" } else { "postings" },
                    held_reason.as_deref().unwrap_or("no reason given")),
                postings_detail)
        } else {
            part("ho.postings", "HO_JOB", "Automatic postings", PART_OK, "OK",
                "Nothing held.", postings_detail)
        },
    );

    // Notifications and Web Push.
    let push = sqlx::query(
        "SELECT count(*) AS overdue, min(next_attempt_at) AS since
           FROM push_delivery WHERE next_attempt_at < $1",
    )
    .bind(now - Duration::minutes(10))
    .fetch_one(pool)
    .await?;
    let overdue: i64 = push.try_get("overdue")?;
    let overdue_since: Option<DateTime<Utc>> = push.try_get("since")?;
    let push_detail = json!({ "overdue_deliveries": overdue, "overdue_since": overdue_since });
    parts.push(
        if let Some(problem) = beat_problem("ho.notifications", "Notifications & push", beats.get(JOB_PUSH), Duration::minutes(5), offset_minutes, now) {
            problem
        } else if overdue > 0 {
            part("ho.notifications", "HO_JOB", "Notifications & push", PART_WARN, "BACKLOG",
                format!("{overdue} push deliveries overdue by more than ten minutes."), push_detail)
        } else {
            part("ho.notifications", "HO_JOB", "Notifications & push", PART_OK, "OK",
                "Delivering.", push_detail)
        },
    );

    // The assistant's morning brief.
    let hour: Option<i32> = sqlx::query_scalar(
        "SELECT round(value_numeric)::int FROM finance_setting WHERE setting_key = 'assistant_brief_hour'",
    )
    .fetch_optional(pool)
    .await?
    .filter(|hour: &i32| (0..=23).contains(hour));
    let local = now + Duration::minutes(i64::from(offset_minutes));
    let yesterday = local.date_naive() - Duration::days(1);
    let sent: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT sent_at FROM assistant_brief WHERE business_date = $1",
    )
    .bind(yesterday)
    .fetch_optional(pool)
    .await?;
    let brief_detail = json!({ "hour": hour, "business_date": yesterday, "sent_at": sent });
    let local_hour = i32::try_from(local.hour()).unwrap_or_default();
    parts.push(match hour {
        None => part("ho.brief", "HO_JOB", "Morning brief", PART_UNKNOWN, "OFF",
            "Switched off (assistant_brief_hour).", brief_detail),
        Some(hour) => {
            if let Some(problem) = beat_problem("ho.brief", "Morning brief", beats.get(JOB_BRIEF), Duration::minutes(30), offset_minutes, now) {
                problem
            } else {
                match sent {
                    Some(at) => part("ho.brief", "HO_JOB", "Morning brief", PART_OK, "SENT",
                        format!("Sent at {}.", local_hm(at, offset_minutes)), brief_detail),
                    None if local_hour >= hour + 4 => part("ho.brief", "HO_JOB", "Morning brief", PART_BAD, "NOT_SENT",
                        format!("Due at {hour:02}:00 and not sent today."), brief_detail),
                    None if local_hour > hour => part("ho.brief", "HO_JOB", "Morning brief", PART_WARN, "LATE",
                        format!("Due at {hour:02}:00 and not sent yet."), brief_detail),
                    None => part("ho.brief", "HO_JOB", "Morning brief", PART_OK, "DUE",
                        format!("Due at {hour:02}:00."), brief_detail),
                }
            }
        }
    });
    Ok(parts)
}

// ════════════════════════════════════════════════════════════════════════════
// The whole fleet, judged now
// ════════════════════════════════════════════════════════════════════════════

/// One row of the status page: a store, or the gudang.
#[derive(Debug, Clone, Serialize)]
pub struct FleetRow {
    /// The row's key: its site's id. `{unit}` also accepts the site's code
    /// and the unit's code or id.
    pub key: String,
    pub site_id: String,
    pub site_code: Option<String>,
    pub unit_id: Option<String>,
    /// `C004` for a store, the unit's code (`HO`) for the gudang.
    pub unit_code: Option<String>,
    pub name: String,
    /// `STORE` or `GUDANG`.
    pub kind: &'static str,
    pub origin_id: Option<String>,
    pub last_heard_at: Option<DateTime<Utc>>,
    pub parts: Vec<FleetPart>,
    pub freshness: FleetFreshness,
    /// Minutes east of UTC on the store's clock, for its sentences.
    #[serde(skip)]
    pub offset_minutes: i32,
}

#[derive(Debug, Clone)]
pub struct FleetEvaluation {
    pub rows: Vec<FleetRow>,
    pub head_office: Vec<FleetPart>,
    pub head_office_offset_minutes: i32,
    pub now: DateTime<Utc>,
}

async fn load_nodes(pool: &PgPool) -> Result<Vec<(NodeRow, bool)>, AppError> {
    let rows = sqlx::query(
        "SELECT c.origin_id, c.label, s.id AS site_id, s.name AS site_name, s.kind AS site_kind,
                s.code AS site_code, s.unit_id, u.code AS unit_code, u.name AS unit_name,
                h.received_at, h.version, h.status,
                COALESCE(sn.origin_id = c.origin_id, true) AS is_primary
           FROM sync_origin_credential c
           JOIN site s ON s.id = c.site_id
           LEFT JOIN unit u ON u.id = s.unit_id
           LEFT JOIN node_heartbeat h ON h.origin_id = c.origin_id
           LEFT JOIN site_node sn ON sn.site_id = s.id
          ORDER BY s.id, is_primary DESC, c.origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut nodes = Vec::with_capacity(rows.len());
    for row in rows {
        let status: Option<NodeStatus> = row
            .try_get::<Option<Value>, _>("status")?
            .and_then(|value| serde_json::from_value(value).ok());
        nodes.push((
            NodeRow {
                origin_id: row.try_get("origin_id")?,
                node_label: row.try_get("label")?,
                site_id: row.try_get("site_id")?,
                site_name: row.try_get("site_name")?,
                site_kind: row.try_get("site_kind")?,
                site_code: row.try_get("site_code")?,
                unit_id: row.try_get("unit_id")?,
                unit_code: row.try_get("unit_code")?,
                unit_name: row.try_get("unit_name")?,
                received_at: row.try_get("received_at")?,
                version: row.try_get("version")?,
                status,
            },
            row.try_get("is_primary")?,
        ));
    }
    Ok(nodes)
}

async fn load_pending_commands(pool: &PgPool, now: DateTime<Utc>) -> Result<HashMap<String, Vec<PendingCommand>>, AppError> {
    let rows = sqlx::query(
        "SELECT d.origin_id, c.command_type,
                COALESCE(c.payload->>'version', c.payload->>'generation', c.payload->>'po_number') AS hint,
                c.issued_at, c.expires_at, c.revoked_at
           FROM sync_command_delivery d
           JOIN sync_command c ON c.command_id = d.command_id
           LEFT JOIN sync_command_cursor cur ON cur.origin_id = d.origin_id
          WHERE d.seq > COALESCE(cur.acked_seq, 0)
          ORDER BY d.origin_id, d.seq",
    )
    .fetch_all(pool)
    .await?;
    let mut by_origin: HashMap<String, Vec<PendingCommand>> = HashMap::new();
    for row in rows {
        let expires_at: Option<DateTime<Utc>> = row.try_get("expires_at")?;
        let revoked_at: Option<DateTime<Utc>> = row.try_get("revoked_at")?;
        by_origin
            .entry(row.try_get("origin_id")?)
            .or_default()
            .push(PendingCommand {
                command_type: row.try_get("command_type")?,
                hint: row.try_get("hint")?,
                issued_at: row.try_get("issued_at")?,
                expired: expires_at.is_some_and(|at| at <= now),
                revoked: revoked_at.is_some(),
            });
    }
    Ok(by_origin)
}

async fn load_cursors(pool: &PgPool) -> Result<HashMap<String, CommandCursor>, AppError> {
    let rows = sqlx::query(
        "SELECT origin_id, next_seq, acked_seq, acked_at, blocked_at_seq, blocked_reason, blocked_since
           FROM sync_command_cursor",
    )
    .fetch_all(pool)
    .await?;
    let mut cursors = HashMap::new();
    for row in rows {
        cursors.insert(
            row.try_get::<String, _>("origin_id")?,
            CommandCursor {
                issued_seq: row.try_get("next_seq")?,
                acked_seq: row.try_get("acked_seq")?,
                acked_at: row.try_get("acked_at")?,
                blocked_at_seq: row.try_get("blocked_at_seq")?,
                blocked_reason: row.try_get("blocked_reason")?,
                blocked_since: row.try_get("blocked_since")?,
            },
        );
    }
    Ok(cursors)
}

async fn load_ingest_marks(pool: &PgPool) -> Result<HashMap<String, IngestMark>, AppError> {
    let rows = sqlx::query(
        "SELECT w.origin_id, w.durable_seq, w.updated_at
           FROM sync_ingest_watermark w
           JOIN sync_origin_credential c
             ON c.origin_id = w.origin_id AND c.active_generation = w.generation",
    )
    .fetch_all(pool)
    .await?;
    let mut marks = HashMap::new();
    for row in rows {
        marks.insert(
            row.try_get::<String, _>("origin_id")?,
            IngestMark {
                durable_seq: row.try_get("durable_seq")?,
                updated_at: row.try_get("updated_at")?,
            },
        );
    }
    Ok(marks)
}

async fn load_registered_devices(pool: &PgPool) -> Result<Vec<RegisteredDevice>, AppError> {
    let rows = sqlx::query(
        "SELECT device_id, kind, site_id, label, status, last_seen_at
           FROM device_register
          WHERE source <> 'NODE' AND status <> 'REVOKED'
          ORDER BY site_id, kind, label",
    )
    .fetch_all(pool)
    .await?;
    let mut devices = Vec::with_capacity(rows.len());
    for row in rows {
        devices.push(RegisteredDevice {
            device_id: row.try_get("device_id")?,
            kind: row.try_get("kind")?,
            site_id: row.try_get("site_id")?,
            label: row.try_get("label")?,
            status: row.try_get("status")?,
            last_seen_at: row.try_get("last_seen_at")?,
        });
    }
    Ok(devices)
}

async fn load_last_outages(pool: &PgPool, now: DateTime<Utc>) -> Result<HashMap<String, Value>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (origin_id) origin_id, kind, payload
           FROM node_incident
          WHERE kind IN ('CONNECTION_LOST', 'STARTED') AND at > $1
          ORDER BY origin_id, at DESC",
    )
    .bind(now - Duration::days(7))
    .fetch_all(pool)
    .await?;
    let mut outages = HashMap::new();
    for row in rows {
        let kind: String = row.try_get("kind")?;
        let payload: Value = row.try_get("payload")?;
        if let Some(outage) = outage_from(&kind, &payload) {
            outages.insert(row.try_get::<String, _>("origin_id")?, outage);
        }
    }
    Ok(outages)
}

async fn load_site_offsets(pool: &PgPool, now: DateTime<Utc>) -> Result<HashMap<String, i32>, AppError> {
    let rows: Vec<(String, i32)> = sqlx::query_as(
        "SELECT s.id, (EXTRACT(EPOCH FROM ($1::timestamptz AT TIME ZONE site_business_timezone(s.id))
                                       - ($1::timestamptz AT TIME ZONE 'UTC')) / 60)::int
           FROM site s",
    )
    .bind(now)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Every row and head office's own, judged now. Read-only: the reads call
/// this for the present and add the history the sweep has written.
pub async fn evaluate_fleet(
    pool: &PgPool,
    settings: &FleetSettings,
    now: DateTime<Utc>,
) -> Result<FleetEvaluation, AppError> {
    let nodes = load_nodes(pool).await?;
    let pending = load_pending_commands(pool, now).await?;
    let cursors = load_cursors(pool).await?;
    let marks = load_ingest_marks(pool).await?;
    let registered = load_registered_devices(pool).await?;
    let outages = load_last_outages(pool, now).await?;
    let offsets = load_site_offsets(pool, now).await?;
    let head_office_offset = super::sites::business_utc_offset_minutes(pool, None, now).await?;

    let newest_version = nodes
        .iter()
        .filter_map(|(node, _)| node.version.as_deref())
        .max_by_key(|version| version_key(version))
        .map(str::to_owned);

    let mut rows: Vec<FleetRow> = Vec::new();
    let mut seen_sites: HashSet<String> = HashSet::new();
    for (node, primary) in &nodes {
        let offset = offsets.get(&node.site_id).copied().unwrap_or(head_office_offset);
        let commands: Vec<&PendingCommand> = pending
            .get(&node.origin_id)
            .map(|list| list.iter().collect())
            .unwrap_or_default();
        let freshness = node_freshness(
            node,
            &commands,
            cursors.get(&node.origin_id),
            marks.get(&node.origin_id),
            outages.get(&node.origin_id).cloned(),
            settings,
            offset,
            now,
        );
        if seen_sites.contains(&node.site_id) || !*primary {
            // A second server at a site that already has its row: its own
            // server part, on that row.
            if let Some(row) = rows.iter_mut().find(|row| row.site_id == node.site_id) {
                let offline = freshness.state == "OFFLINE" || freshness.state == "NEVER_SEEN";
                let label = format!(
                    "Server {}",
                    node.node_label.clone().unwrap_or_else(|| node.origin_id.clone())
                );
                row.parts.push(server_part(
                    &format!("server:{}", node.origin_id),
                    &label,
                    node,
                    offline,
                    offset,
                    now,
                ));
                continue;
            }
        }
        seen_sites.insert(node.site_id.clone());
        let mut parts = node_parts(node, &freshness, settings, newest_version.as_deref(), offset, now);
        for device in registered.iter().filter(|device| device.site_id == node.site_id) {
            parts.push(registered_device_part(device, offset, now));
        }
        let gudang = node.site_kind == "HO";
        rows.push(FleetRow {
            key: node.site_id.clone(),
            site_id: node.site_id.clone(),
            site_code: node.site_code.clone(),
            unit_id: node.unit_id.clone(),
            unit_code: node.unit_code.clone(),
            name: if gudang {
                node.site_name.clone()
            } else {
                node.unit_name.clone().unwrap_or_else(|| node.site_name.clone())
            },
            kind: if gudang { "GUDANG" } else { "STORE" },
            origin_id: Some(node.origin_id.clone()),
            last_heard_at: node.received_at,
            parts,
            freshness,
            offset_minutes: offset,
        });
    }
    // The gudang first, then the stores by code.
    rows.sort_by(|a, b| {
        (a.kind != "GUDANG", a.unit_code.clone(), a.site_id.clone())
            .cmp(&(b.kind != "GUDANG", b.unit_code.clone(), b.site_id.clone()))
    });
    let head_office = head_office_parts(pool, head_office_offset, now).await?;
    Ok(FleetEvaluation {
        rows,
        head_office,
        head_office_offset_minutes: head_office_offset,
        now,
    })
}

// ════════════════════════════════════════════════════════════════════════════
// The sweep: history, then alerts
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize)]
pub struct FleetSweepReport {
    pub parts: usize,
    pub opened: usize,
    pub notified: usize,
    pub escalated: usize,
    pub resolved: usize,
}

/// Write every part down — its colour now, and its span — and prune what is
/// past `history_days`. One transaction, so a part and its history agree.
async fn record_parts(
    pool: &PgPool,
    evaluation: &FleetEvaluation,
    settings: &FleetSettings,
) -> Result<usize, AppError> {
    let now = evaluation.now;
    let mut records = Vec::new();
    let mut push = |subject: &str, origin_id: Option<&str>, part: &FleetPart| {
        records.push(json!({
            "subject": subject,
            "component": part.component,
            "kind": part.kind,
            "device_kind": part.device_kind,
            "label": part.label,
            "origin_id": origin_id,
            "state": part.state,
            "code": part.code,
            "sentence": part.sentence,
            "detail": part.detail,
        }));
    };
    for row in &evaluation.rows {
        for part in &row.parts {
            push(&row.site_id, row.origin_id.as_deref(), part);
        }
    }
    for part in &evaluation.head_office {
        push(HEAD_OFFICE_SUBJECT, None, part);
    }
    let count = records.len();
    let records = Value::Array(records);
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO fleet_component
             (subject, component, kind, device_kind, label, origin_id, state, code, sentence,
              since, checked_at, detail)
         SELECT r.subject, r.component, r.kind, r.device_kind, r.label, r.origin_id, r.state,
                r.code, r.sentence, $2, $2, COALESCE(r.detail, '{}'::jsonb)
           FROM jsonb_to_recordset($1::jsonb) AS r(
                subject text, component text, kind text, device_kind text, label text,
                origin_id text, state text, code text, sentence text, detail jsonb)
         ON CONFLICT (subject, component) DO UPDATE SET
             kind = EXCLUDED.kind, device_kind = EXCLUDED.device_kind, label = EXCLUDED.label,
             origin_id = EXCLUDED.origin_id, code = EXCLUDED.code, sentence = EXCLUDED.sentence,
             detail = EXCLUDED.detail, checked_at = EXCLUDED.checked_at,
             since = CASE WHEN fleet_component.state = EXCLUDED.state
                          THEN fleet_component.since ELSE EXCLUDED.since END,
             state = EXCLUDED.state",
    )
    .bind(&records)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    // A span continues while its colour holds and nobody stopped looking;
    // otherwise a new one starts. See 0638.
    sqlx::query(
        "WITH input AS (
             SELECT r.subject, r.component, r.state
               FROM jsonb_to_recordset($1::jsonb) AS r(subject text, component text, state text)
         ),
         latest AS (
             SELECT DISTINCT ON (s.subject, s.component) s.subject, s.component, s.state,
                    s.started_at, s.seen_at
               FROM fleet_component_span s
               JOIN input i ON i.subject = s.subject AND i.component = s.component
              ORDER BY s.subject, s.component, s.started_at DESC
         ),
         extended AS (
             UPDATE fleet_component_span s SET seen_at = $2
               FROM latest l
               JOIN input i ON i.subject = l.subject AND i.component = l.component
              WHERE s.subject = l.subject AND s.component = l.component
                AND s.started_at = l.started_at
                AND l.state = i.state
                AND l.seen_at >= $2 - make_interval(secs => $3)
             RETURNING s.subject, s.component
         )
         INSERT INTO fleet_component_span (subject, component, state, started_at, seen_at)
         SELECT i.subject, i.component, i.state, $2, $2
           FROM input i
          WHERE NOT EXISTS (SELECT 1 FROM extended e
                             WHERE e.subject = i.subject AND e.component = i.component)
         ON CONFLICT (subject, component, started_at) DO NOTHING",
    )
    .bind(&records)
    .bind(now)
    .bind(SPAN_GAP_SECONDS as f64)
    .execute(&mut *tx)
    .await?;
    // The retention job, on the same tick: cheap with the index on seen_at.
    sqlx::query("DELETE FROM fleet_component_span WHERE seen_at < $1")
        .bind(now - Duration::days(i64::from(settings.history_days)))
        .execute(&mut *tx)
        .await?;
    // A part nobody has reported for a day — a device taken away, a store
    // closed — leaves the page; its spans age out with the rest.
    sqlx::query("DELETE FROM fleet_component WHERE checked_at < $1")
        .bind(now - Duration::days(1))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(count)
}

/// Once a minute: judge the fleet, write down each part's colour and
/// history, and raise, escalate and close the incidents. Called from the
/// cloud's one-minute loop beside the silent-node sweep.
pub async fn fleet_sweep(pool: &PgPool) -> Result<FleetSweepReport, AppError> {
    let now = Utc::now();
    let settings = fleet_settings(pool).await?.settings;
    let evaluation = evaluate_fleet(pool, &settings, now).await?;
    let parts = record_parts(pool, &evaluation, &settings).await?;
    let mut report = run_alerts(pool, &evaluation, &settings).await?;
    report.parts = parts;
    Ok(report)
}

// ---- Alerts ---------------------------------------------------------------------

/// Who is told about a fleet incident: the job roles named in the settings
/// where the estate has job roles (`app_user.role_code`, 0633), else — or
/// when those roles name nobody — every active Admin; plus the PIC of the
/// store's unit (`unit_pic`, 0602) when asked. Resolved now and written down
/// on the incident, as every notification's audience is.
async fn fleet_recipients(
    tx: &mut Transaction<'_, Postgres>,
    roles: &[String],
    unit_id: Option<&str>,
    with_pic: bool,
) -> Result<Vec<String>, AppError> {
    let has_job_roles: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = current_schema()
                           AND table_name = 'app_user' AND column_name = 'role_code')",
    )
    .fetch_one(&mut **tx)
    .await?;
    let mut people: Vec<String> = if has_job_roles {
        sqlx::query_scalar("SELECT username FROM app_user WHERE active AND role_code = ANY($1)")
            .bind(roles)
            .fetch_all(&mut **tx)
            .await?
    } else {
        Vec::new()
    };
    if people.is_empty() {
        people = sqlx::query_scalar("SELECT username FROM app_user WHERE active AND role = 'ADMIN'")
            .fetch_all(&mut **tx)
            .await?;
    }
    if let (true, Some(unit_id)) = (with_pic, unit_id) {
        let has_pic: bool = sqlx::query_scalar("SELECT to_regclass('unit_pic') IS NOT NULL")
            .fetch_one(&mut **tx)
            .await?;
        if has_pic {
            let pic: Vec<String> = sqlx::query_scalar(
                "SELECT u.username FROM unit_pic p
                   JOIN app_user u ON u.employee_id = p.employee_id
                  WHERE p.unit_id = $1 AND p.valid_to IS NULL AND u.active",
            )
            .bind(unit_id)
            .fetch_all(&mut **tx)
            .await?;
            people.extend(pic);
        }
    }
    people.sort();
    people.dedup();
    Ok(people)
}

/// One condition that should have an open incident.
#[derive(Debug, Clone)]
struct Wanted {
    subject: String,
    component: String,
    rule: &'static str,
    code: String,
    title: String,
    body: String,
    opened_at: DateTime<Utc>,
    unit_id: Option<String>,
    site_id: Option<String>,
    origin_id: Option<String>,
}

/// Which rule, if any, a part in this colour since `since` falls under. One
/// rule per part, so one incident per part.
fn rule_for(
    part: &FleetPart,
    since: DateTime<Utc>,
    settings: &FleetSettings,
    now: DateTime<Utc>,
) -> Option<&'static str> {
    let is = |state: &str| part.state == state;
    if part.kind == "BACKUP" {
        return (is(PART_BAD) && settings.alert_on_backup).then_some("BACKUP");
    }
    if part.kind == "DEVICE"
        && part.device_kind.as_deref() == Some(wire::KIND_PRINTER)
        && part.code == "FAULT"
    {
        return settings.alert_on_printer_fault.then_some("PRINTER_FAULT");
    }
    if part.code == "SILENT" && part.kind == "DEVICE" {
        return settings.alert_on_reader_silent.then_some("READER_SILENT");
    }
    if part.kind == "SYNC" {
        // Offline is the server part's news; saying it twice is two
        // notifications for one outage.
        return (part.code == "BEHIND" && is(PART_BAD) && settings.alert_on_sync_behind)
            .then_some("SYNC_BEHIND");
    }
    (is(PART_BAD)
        && settings.alert_on_red
        && now - since >= Duration::minutes(i64::from(settings.red_after_minutes)))
    .then_some("COMPONENT_RED")
}

fn row_title(row: &FleetRow) -> String {
    match row.kind {
        "GUDANG" => format!(
            "{} {}",
            row.site_code.clone().unwrap_or_else(|| row.site_id.clone()),
            row.name
        ),
        _ => format!(
            "{} {}",
            row.unit_code.clone().unwrap_or_else(|| row.site_id.clone()),
            row.name
        ),
    }
}

fn rule_words(rule: &str) -> &'static str {
    match rule {
        "SYNC_BEHIND" => "sync behind",
        "PRINTER_FAULT" => "printer fault",
        "BACKUP" => "backup",
        "READER_SILENT" => "reader silent",
        _ => "down",
    }
}

async fn run_alerts(
    pool: &PgPool,
    evaluation: &FleetEvaluation,
    settings: &FleetSettings,
) -> Result<FleetSweepReport, AppError> {
    let mut report = FleetSweepReport::default();
    if !settings.alerts_enabled {
        // Switched off: nothing opens, nothing is told, and what is open
        // stays as it is until they are on again.
        return Ok(report);
    }
    let now = evaluation.now;
    let stored: Vec<(String, String, DateTime<Utc>)> =
        sqlx::query_as("SELECT subject, component, since FROM fleet_component")
            .fetch_all(pool)
            .await?;
    let since: HashMap<(String, String), DateTime<Utc>> = stored
        .into_iter()
        .map(|(subject, component, since)| ((subject, component), since))
        .collect();

    let mut wanted: Vec<Wanted> = Vec::new();
    // Every part present now, with its colour: what closes an incident.
    let mut present: HashMap<(String, String), &'static str> = HashMap::new();
    let mut consider = |subject: &str,
                        row_title: &str,
                        part: &FleetPart,
                        unit_id: Option<&String>,
                        site_id: Option<&String>,
                        origin_id: Option<&String>| {
        let key = (subject.to_owned(), part.component.clone());
        present.insert(key.clone(), part.state);
        let began = since.get(&key).copied().unwrap_or(now);
        if let Some(rule) = rule_for(part, began, settings, now) {
            wanted.push(Wanted {
                subject: subject.to_owned(),
                component: part.component.clone(),
                rule,
                code: part.code.clone(),
                title: format!("{row_title}: {} — {}", part.label, rule_words(rule)),
                body: part.sentence.clone(),
                opened_at: began,
                unit_id: unit_id.cloned(),
                site_id: site_id.cloned(),
                origin_id: origin_id.cloned(),
            });
        }
    };
    for row in &evaluation.rows {
        let title = row_title(row);
        for part in &row.parts {
            consider(&row.site_id, &title, part, row.unit_id.as_ref(), Some(&row.site_id), row.origin_id.as_ref());
        }
    }
    for part in &evaluation.head_office {
        consider(HEAD_OFFICE_SUBJECT, "Head office", part, None, None, None);
    }

    // Open what is wanted and not open. The partial unique index is the
    // deduplication: a second sweep, or a second cloud process, inserts
    // nothing.
    for want in &wanted {
        let inserted = sqlx::query(
            "INSERT INTO fleet_incident
                 (incident_id, subject, component, rule, unit_id, site_id, origin_id, code,
                  title, body, opened_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (subject, component, rule) WHERE resolved_at IS NULL DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(&want.subject)
        .bind(&want.component)
        .bind(want.rule)
        .bind(&want.unit_id)
        .bind(&want.site_id)
        .bind(&want.origin_id)
        .bind(&want.code)
        .bind(&want.title)
        .bind(&want.body)
        .bind(want.opened_at)
        .execute(pool)
        .await?;
        report.opened += inserted.rows_affected() as usize;
    }

    let wanted_keys: HashSet<(String, String, String)> = wanted
        .iter()
        .map(|want| (want.subject.clone(), want.component.clone(), want.rule.to_owned()))
        .collect();
    let open = sqlx::query(
        "SELECT incident_id, subject, component, rule, unit_id, origin_id, title, body,
                opened_at, notified_at, acknowledged_at, escalated_at
           FROM fleet_incident WHERE resolved_at IS NULL
          ORDER BY opened_at",
    )
    .fetch_all(pool)
    .await?;
    let ho_minute = {
        let local = now + Duration::minutes(i64::from(evaluation.head_office_offset_minutes));
        local.hour() * 60 + local.minute()
    };
    let quiet = settings.is_quiet_at(ho_minute);
    let escalate_after = Duration::minutes(i64::from(settings.escalate_after_minutes));

    for row in open {
        let incident_id: Uuid = row.try_get("incident_id")?;
        let subject: String = row.try_get("subject")?;
        let component: String = row.try_get("component")?;
        let rule: String = row.try_get("rule")?;
        let unit_id: Option<String> = row.try_get("unit_id")?;
        let origin_id: Option<String> = row.try_get("origin_id")?;
        let title: String = row.try_get("title")?;
        let body: String = row.try_get("body")?;
        let opened_at: DateTime<Utc> = row.try_get("opened_at")?;
        let notified_at: Option<DateTime<Utc>> = row.try_get("notified_at")?;
        let acknowledged_at: Option<DateTime<Utc>> = row.try_get("acknowledged_at")?;
        let escalated_at: Option<DateTime<Utc>> = row.try_get("escalated_at")?;
        let key = (subject.clone(), component.clone());
        let still_wanted = wanted_keys.contains(&(subject.clone(), component.clone(), rule.clone()));

        if !still_wanted {
            // A part gone grey has not recovered — nobody can see it — so
            // its incident waits. Anything else is recovery, or the part is
            // gone from the page altogether.
            if present.get(&key) == Some(&PART_UNKNOWN) {
                continue;
            }
            let mut tx = pool.begin().await?;
            let closed = sqlx::query(
                "UPDATE fleet_incident SET resolved_at = $2
                  WHERE incident_id = $1 AND resolved_at IS NULL
                 RETURNING notified_at, notified_to",
            )
            .bind(incident_id)
            .bind(now)
            .fetch_optional(&mut *tx)
            .await?;
            let Some(closed) = closed else {
                continue;
            };
            let told: Option<DateTime<Utc>> = closed.try_get("notified_at")?;
            let told_to: Vec<String> = closed.try_get("notified_to")?;
            if told.is_some() && !told_to.is_empty() {
                let recovered = match present.get(&key) {
                    Some(_) => format!(
                        "Recovered after {}.",
                        span(now - opened_at)
                    ),
                    None => "No longer reported; closed.".to_owned(),
                };
                let notification = raise_notification(
                    &mut tx,
                    NewNotification {
                        kind: "node.recovered",
                        title: format!("{} recovered", title.split(" — ").next().unwrap_or(&title)),
                        body: recovered,
                        subject: None,
                        origin_id: origin_id.as_deref(),
                        payload: json!({
                            "fleet_incident_id": incident_id,
                            "rule": rule,
                            "subject": subject,
                            "component": component,
                            "resolved": true,
                        }),
                    },
                    &told_to,
                )
                .await?;
                sqlx::query("UPDATE fleet_incident SET resolved_notification_id = $2 WHERE incident_id = $1")
                    .bind(incident_id)
                    .bind(notification)
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
            report.resolved += 1;
            continue;
        }

        if quiet {
            // Filed, and held until the quiet hours end.
            continue;
        }
        if notified_at.is_none() {
            let mut tx = pool.begin().await?;
            let recipients = fleet_recipients(
                &mut tx,
                &settings.notify_roles,
                unit_id.as_deref(),
                settings.notify_unit_pic,
            )
            .await?;
            if recipients.is_empty() {
                // Nobody to tell yet; the next sweep tries again.
                continue;
            }
            let notification = raise_notification(
                &mut tx,
                NewNotification {
                    kind: "node.attention",
                    title: title.clone(),
                    body: body.clone(),
                    subject: None,
                    origin_id: origin_id.as_deref(),
                    payload: json!({
                        "fleet_incident_id": incident_id,
                        "rule": rule,
                        "subject": subject,
                        "component": component,
                        "opened_at": opened_at,
                    }),
                },
                &recipients,
            )
            .await?;
            let updated = sqlx::query(
                "UPDATE fleet_incident
                    SET notified_at = $2, notification_id = $3, notified_to = $4
                  WHERE incident_id = $1 AND notified_at IS NULL AND resolved_at IS NULL",
            )
            .bind(incident_id)
            .bind(now)
            .bind(notification)
            .bind(&recipients)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() == 1 {
                tx.commit().await?;
                report.notified += 1;
            }
            continue;
        }
        let due = notified_at.is_some_and(|told| now - told >= escalate_after);
        if acknowledged_at.is_none() && escalated_at.is_none() && due {
            let mut tx = pool.begin().await?;
            let owners = fleet_recipients(&mut tx, &settings.escalate_to_roles, None, false).await?;
            if owners.is_empty() {
                continue;
            }
            let notification = raise_notification(
                &mut tx,
                NewNotification {
                    kind: "node.attention",
                    title: format!(
                        "Unanswered for {}: {title}",
                        span(escalate_after)
                    ),
                    body: body.clone(),
                    subject: None,
                    origin_id: origin_id.as_deref(),
                    payload: json!({
                        "fleet_incident_id": incident_id,
                        "rule": rule,
                        "subject": subject,
                        "component": component,
                        "escalated": true,
                    }),
                },
                &owners,
            )
            .await?;
            let updated = sqlx::query(
                "UPDATE fleet_incident
                    SET escalated_at = $2, escalation_notification_id = $3,
                        notified_to = ARRAY(SELECT DISTINCT unnest(notified_to || $4::text[]) ORDER BY 1)
                  WHERE incident_id = $1 AND escalated_at IS NULL AND acknowledged_at IS NULL
                    AND resolved_at IS NULL",
            )
            .bind(incident_id)
            .bind(now)
            .bind(notification)
            .bind(&owners)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() == 1 {
                tx.commit().await?;
                report.escalated += 1;
            }
        }
    }
    Ok(report)
}

// ════════════════════════════════════════════════════════════════════════════
// History: uptime and the daily bars
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
struct SpanRow {
    state: String,
    started_at: DateTime<Utc>,
    seen_at: DateTime<Utc>,
}

/// Seconds in each colour inside `[from, to)`. When `gaps_are_down`, time
/// after the first span that no span covers counts as down: head office's
/// own API, whose silence is the outage (0638).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Tally {
    ok: i64,
    warn: i64,
    bad: i64,
    unknown: i64,
}

impl Tally {
    fn known(&self) -> i64 {
        self.ok + self.warn + self.bad
    }

    fn percent(&self) -> Option<f64> {
        let known = self.known();
        (known > 0).then(|| ((known - self.bad) as f64 / known as f64 * 100.0).clamp(0.0, 100.0))
    }

    fn worst(&self) -> &'static str {
        if self.bad > 0 {
            PART_BAD
        } else if self.warn > 0 {
            PART_WARN
        } else if self.ok > 0 {
            PART_OK
        } else if self.unknown > 0 {
            PART_UNKNOWN
        } else {
            "NONE"
        }
    }
}

/// Spans sorted by start. Each covers from its start to one tick past its
/// last confirmation, cut at the next span's start and at `now`.
fn tally(spans: &[SpanRow], from: DateTime<Utc>, to: DateTime<Utc>, now: DateTime<Utc>, gaps_are_down: bool) -> Tally {
    let to = to.min(now);
    let mut tally = Tally::default();
    if to <= from {
        return tally;
    }
    let mut covered_until: Option<DateTime<Utc>> = None;
    for (index, span) in spans.iter().enumerate() {
        let mut end = (span.seen_at + Duration::seconds(TICK_SECONDS)).min(now);
        if let Some(next) = spans.get(index + 1) {
            end = end.min(next.started_at);
        }
        if gaps_are_down {
            // The unwatched stretch before this span, after the first.
            if let Some(until) = covered_until {
                let gap_start = until.max(from);
                let gap_end = span.started_at.min(to);
                if gap_end > gap_start {
                    tally.bad += (gap_end - gap_start).num_seconds();
                }
            }
        }
        covered_until = Some(covered_until.map_or(end, |until| until.max(end)));
        let start = span.started_at.max(from);
        let stop = end.min(to);
        if stop <= start {
            continue;
        }
        let seconds = (stop - start).num_seconds();
        match span.state.as_str() {
            PART_OK => tally.ok += seconds,
            PART_WARN => tally.warn += seconds,
            PART_BAD => tally.bad += seconds,
            _ => tally.unknown += seconds,
        }
    }
    if gaps_are_down {
        if let Some(until) = covered_until {
            let gap_start = until.max(from);
            if to > gap_start {
                tally.bad += (to - gap_start).num_seconds();
            }
        }
    }
    tally
}

/// One day's bar.
#[derive(Debug, Clone, Serialize)]
pub struct FleetDayBar {
    /// The day on head office's clock.
    pub day: NaiveDate,
    /// The worst colour seen that day: `OK`, `WARN`, `BAD`, `UNKNOWN`, or
    /// `NONE` for a day with no history at all.
    pub state: &'static str,
    pub colour: &'static str,
    /// Up (green or yellow) over the time the part could be judged.
    pub uptime_percent: Option<f64>,
    pub bad_seconds: i64,
    pub warn_seconds: i64,
    pub known_seconds: i64,
}

fn day_bars(spans: &[SpanRow], offset_minutes: i32, now: DateTime<Utc>, gaps_are_down: bool) -> Vec<FleetDayBar> {
    let shift = Duration::minutes(i64::from(offset_minutes));
    let today = (now + shift).date_naive();
    (0..HISTORY_BARS)
        .rev()
        .map(|back| {
            let day = today - Duration::days(back);
            let start = day
                .and_hms_opt(0, 0, 0)
                .map(|midnight| midnight.and_utc() - shift)
                .unwrap_or(now);
            let t = tally(spans, start, start + Duration::days(1), now, gaps_are_down);
            let state = t.worst();
            FleetDayBar {
                day,
                state,
                colour: if state == "NONE" { "none" } else { part_colour(state) },
                uptime_percent: t.percent(),
                bad_seconds: t.bad,
                warn_seconds: t.warn,
                known_seconds: t.known(),
            }
        })
        .collect()
}

async fn load_spans(
    pool: &PgPool,
    subject: Option<&str>,
    now: DateTime<Utc>,
) -> Result<HashMap<(String, String), Vec<SpanRow>>, AppError> {
    let rows = sqlx::query(
        "SELECT subject, component, state, started_at, seen_at
           FROM fleet_component_span
          WHERE seen_at >= $1 AND ($2::text IS NULL OR subject = $2)
          ORDER BY subject, component, started_at",
    )
    .bind(now - Duration::days(HISTORY_BARS + 1))
    .bind(subject)
    .fetch_all(pool)
    .await?;
    let mut spans: HashMap<(String, String), Vec<SpanRow>> = HashMap::new();
    for row in rows {
        spans
            .entry((row.try_get("subject")?, row.try_get("component")?))
            .or_default()
            .push(SpanRow {
                state: row.try_get("state")?,
                started_at: row.try_get("started_at")?,
                seen_at: row.try_get("seen_at")?,
            });
    }
    Ok(spans)
}

// ════════════════════════════════════════════════════════════════════════════
// Reads
// ════════════════════════════════════════════════════════════════════════════

/// One part on the page.
#[derive(Debug, Clone, Serialize)]
pub struct FleetComponentView {
    #[serde(flatten)]
    pub part: FleetPart,
    pub colour: &'static str,
    /// When this colour began, as the sweep saw it; now when it has not seen
    /// it yet.
    pub since: DateTime<Utc>,
    pub checked_at: Option<DateTime<Utc>>,
    /// Up over the last ninety days, of the time it could be judged.
    pub uptime_90d: Option<f64>,
    /// `GET /fleet/status/{unit}` only: ninety bars, oldest first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days: Option<Vec<FleetDayBar>>,
}

/// One row on the page: a store, the gudang, or head office.
#[derive(Debug, Clone, Serialize)]
pub struct FleetRowView {
    pub key: String,
    pub site_id: Option<String>,
    pub site_code: Option<String>,
    pub unit_id: Option<String>,
    pub unit_code: Option<String>,
    pub name: String,
    /// `STORE`, `GUDANG` or `HEAD_OFFICE`.
    pub kind: &'static str,
    pub origin_id: Option<String>,
    /// The worst part that can be judged.
    pub state: &'static str,
    pub colour: &'static str,
    /// The worst part's sentence, prefixed with its label.
    pub headline: String,
    pub last_heard_at: Option<DateTime<Utc>>,
    /// The server's (head office: the API's) uptime over ninety days.
    pub uptime_90d: Option<f64>,
    pub open_incidents: i64,
    /// The sync part in brief; `GET /fleet/sync` has the rest.
    pub sync: Option<Value>,
    pub components: Vec<FleetComponentView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FleetStatusPage {
    pub generated_at: DateTime<Utc>,
    pub summary: Value,
    pub head_office: FleetRowView,
    pub stores: Vec<FleetRowView>,
}

struct Stored {
    since: HashMap<(String, String), (String, DateTime<Utc>, DateTime<Utc>)>,
    open: HashMap<String, i64>,
}

async fn stored_state(pool: &PgPool) -> Result<Stored, AppError> {
    let rows: Vec<(String, String, String, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT subject, component, state, since, checked_at FROM fleet_component",
    )
    .fetch_all(pool)
    .await?;
    let open: Vec<(String, i64)> = sqlx::query_as(
        "SELECT subject, count(*) FROM fleet_incident WHERE resolved_at IS NULL GROUP BY subject",
    )
    .fetch_all(pool)
    .await?;
    Ok(Stored {
        since: rows
            .into_iter()
            .map(|(subject, component, state, since, checked)| ((subject, component), (state, since, checked)))
            .collect(),
        open: open.into_iter().collect(),
    })
}

#[allow(clippy::too_many_arguments)]
fn component_views(
    subject: &str,
    parts: &[FleetPart],
    stored: &Stored,
    spans: &HashMap<(String, String), Vec<SpanRow>>,
    offset_minutes: i32,
    now: DateTime<Utc>,
    with_days: bool,
) -> Vec<FleetComponentView> {
    parts
        .iter()
        .map(|part| {
            let key = (subject.to_owned(), part.component.clone());
            let (since, checked_at) = match stored.since.get(&key) {
                Some((state, since, checked)) if state == part.state => (*since, Some(*checked)),
                Some((_, _, checked)) => (now, Some(*checked)),
                None => (now, None),
            };
            let gaps_are_down = part.kind == "HO_API";
            let history = spans.get(&key).map(Vec::as_slice).unwrap_or(&[]);
            let uptime_90d = tally(history, now - Duration::days(HISTORY_BARS), now, now, gaps_are_down).percent();
            FleetComponentView {
                part: part.clone(),
                colour: part_colour(part.state),
                since,
                checked_at,
                uptime_90d,
                days: with_days.then(|| day_bars(history, offset_minutes, now, gaps_are_down)),
            }
        })
        .collect()
}

fn headline(components: &[FleetComponentView]) -> (&'static str, String) {
    let state = worst_state(components.iter().map(|view| view.part.state));
    let sentence = components
        .iter()
        .filter(|view| view.part.state == state)
        .map(|view| format!("{}: {}", view.part.label, view.part.sentence))
        .next()
        .unwrap_or_else(|| "Nothing to report yet.".to_owned());
    let sentence = if state == PART_OK {
        "All parts running.".to_owned()
    } else {
        sentence
    };
    (state, sentence)
}

fn row_view(
    row: &FleetRow,
    stored: &Stored,
    spans: &HashMap<(String, String), Vec<SpanRow>>,
    now: DateTime<Utc>,
    with_days: bool,
) -> FleetRowView {
    let components = component_views(&row.site_id, &row.parts, stored, spans, row.offset_minutes, now, with_days);
    let (state, headline) = headline(&components);
    let uptime_90d = components
        .iter()
        .find(|view| view.part.component == "server")
        .and_then(|view| view.uptime_90d);
    FleetRowView {
        key: row.key.clone(),
        site_id: Some(row.site_id.clone()),
        site_code: row.site_code.clone(),
        unit_id: row.unit_id.clone(),
        unit_code: row.unit_code.clone(),
        name: row.name.clone(),
        kind: row.kind,
        origin_id: row.origin_id.clone(),
        state,
        colour: part_colour(state),
        headline,
        last_heard_at: row.last_heard_at,
        uptime_90d,
        open_incidents: stored.open.get(&row.site_id).copied().unwrap_or(0),
        sync: Some(json!({
            "state": row.freshness.state,
            "tone": row.freshness.tone,
            "colour": row.freshness.colour,
            "sentence": row.freshness.sentence,
            "behind_seconds": row.freshness.behind_seconds,
            "sales_complete_up_to_local": row.freshness.sales_complete_up_to_local,
        })),
        components,
    }
}

fn head_office_view(
    evaluation: &FleetEvaluation,
    stored: &Stored,
    spans: &HashMap<(String, String), Vec<SpanRow>>,
    with_days: bool,
) -> FleetRowView {
    let now = evaluation.now;
    let components = component_views(
        HEAD_OFFICE_SUBJECT,
        &evaluation.head_office,
        stored,
        spans,
        evaluation.head_office_offset_minutes,
        now,
        with_days,
    );
    let (state, headline) = headline(&components);
    let uptime_90d = components
        .iter()
        .find(|view| view.part.component == "ho.api")
        .and_then(|view| view.uptime_90d);
    FleetRowView {
        key: HEAD_OFFICE_KEY.to_owned(),
        site_id: None,
        site_code: None,
        unit_id: None,
        unit_code: None,
        name: "Head office".to_owned(),
        kind: "HEAD_OFFICE",
        origin_id: None,
        state,
        colour: part_colour(state),
        headline,
        last_heard_at: Some(now),
        uptime_90d,
        open_incidents: stored.open.get(HEAD_OFFICE_SUBJECT).copied().unwrap_or(0),
        sync: None,
        components,
    }
}

/// `GET /api/v1/fleet/status`.
pub async fn fleet_status_page(pool: &PgPool) -> Result<FleetStatusPage, AppError> {
    let now = Utc::now();
    let settings = fleet_settings(pool).await?.settings;
    let evaluation = evaluate_fleet(pool, &settings, now).await?;
    let stored = stored_state(pool).await?;
    let spans = load_spans(pool, None, now).await?;
    let stores: Vec<FleetRowView> = evaluation
        .rows
        .iter()
        .map(|row| row_view(row, &stored, &spans, now, false))
        .collect();
    let head_office = head_office_view(&evaluation, &stored, &spans, false);
    let count = |colour: &str| stores.iter().filter(|row| row.colour == colour).count();
    let summary = json!({
        "rows": stores.len(),
        "green": count("green"),
        "yellow": count("yellow"),
        "red": count("red"),
        "grey": count("grey"),
        "head_office": head_office.colour,
        "open_incidents": stored.open.values().sum::<i64>(),
    });
    Ok(FleetStatusPage {
        generated_at: now,
        summary,
        head_office,
        stores,
    })
}

/// A `{unit}` or `?unit=` into the row it names: `head-office`; a site's id
/// or code (`store-04`, `C004-TOKO`, `HO-GUDANG`); or a unit's code or id
/// (`C004`, `HO` — the gudang, head office's unit's one site with a server).
pub async fn fleet_resolve_subject(pool: &PgPool, key: &str) -> Result<String, AppError> {
    let key = key.trim();
    if key.eq_ignore_ascii_case(HEAD_OFFICE_KEY) {
        return Ok(HEAD_OFFICE_SUBJECT.to_owned());
    }
    sqlx::query_scalar::<_, String>(
        "SELECT s.id FROM site s LEFT JOIN unit u ON u.id = s.unit_id
          WHERE (s.id = $1 OR upper(s.code) = upper($1) OR u.id = $1 OR upper(u.code) = upper($1))
            AND EXISTS (SELECT 1 FROM sync_origin_credential c WHERE c.site_id = s.id)
          ORDER BY (s.id = $1) DESC, (upper(COALESCE(s.code, '')) = upper($1)) DESC, s.id
          LIMIT 1",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no store, gudang or unit with a server is called {key}")))
}

/// `GET /api/v1/fleet/status/{unit}`: one row with ninety daily bars per
/// part, its sync in full, its incidents of the last thirty days and its
/// server's outages.
pub async fn fleet_status_of(pool: &PgPool, key: &str) -> Result<Value, AppError> {
    let subject = fleet_resolve_subject(pool, key).await?;
    let now = Utc::now();
    let settings = fleet_settings(pool).await?.settings;
    let evaluation = evaluate_fleet(pool, &settings, now).await?;
    let stored = stored_state(pool).await?;
    let spans = load_spans(pool, Some(&subject), now).await?;
    let (row, sync, outages) = if subject == HEAD_OFFICE_SUBJECT {
        (head_office_view(&evaluation, &stored, &spans, true), Value::Null, Value::Null)
    } else {
        let row = evaluation
            .rows
            .iter()
            .find(|row| row.site_id == subject)
            .ok_or_else(|| AppError::NotFound(format!("{key} has no server on the fleet")))?;
        let outages = match row.origin_id.as_deref() {
            Some(origin) => {
                let uptime = super::node_health::node_uptime(pool, origin).await?;
                serde_json::to_value(uptime.outages.iter().take(20).collect::<Vec<_>>())?
            }
            None => Value::Null,
        };
        (
            row_view(row, &stored, &spans, now, true),
            serde_json::to_value(&row.freshness)?,
            outages,
        )
    };
    let (incidents, _) = fleet_incidents(
        pool,
        &FleetIncidentQuery {
            unit: Some(key.to_owned()),
            from: Some(now - Duration::days(30)),
            ..FleetIncidentQuery::default()
        },
    )
    .await?;
    Ok(json!({
        "generated_at": now,
        "row": row,
        "sync": sync,
        "server_outages": outages,
        "incidents": incidents,
    }))
}

/// `GET /api/v1/fleet/sync`: every store's freshness and queues, both ways.
pub async fn fleet_sync(pool: &PgPool) -> Result<Value, AppError> {
    let now = Utc::now();
    let settings = fleet_settings(pool).await?.settings;
    let evaluation = evaluate_fleet(pool, &settings, now).await?;
    let stores: Vec<Value> = evaluation
        .rows
        .iter()
        .map(|row| {
            let mut value = serde_json::to_value(&row.freshness).unwrap_or_else(|_| json!({}));
            if let Value::Object(map) = &mut value {
                map.insert("key".into(), json!(row.key));
                map.insert("site_id".into(), json!(row.site_id));
                map.insert("site_code".into(), json!(row.site_code));
                map.insert("unit_code".into(), json!(row.unit_code));
                map.insert("name".into(), json!(row.name));
                map.insert("kind".into(), json!(row.kind));
                map.insert("origin_id".into(), json!(row.origin_id));
            }
            value
        })
        .collect();
    let count = |state: &str| evaluation.rows.iter().filter(|row| row.freshness.state == state).count();
    Ok(json!({
        "generated_at": now,
        "thresholds": {
            "synced_within_seconds": settings.synced_within_seconds,
            "behind_alert_minutes": settings.behind_alert_minutes,
            "offline_after_seconds": settings.offline_after_seconds,
        },
        "summary": {
            "synced": count("SYNCED"),
            "behind": count("BEHIND"),
            "offline": count("OFFLINE"),
            "never_seen": count("NEVER_SEEN"),
        },
        "stores": stores,
    }))
}

// ---- Incidents ------------------------------------------------------------------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetIncidentQuery {
    /// A row, spelled as `{unit}` is.
    #[serde(default)]
    pub unit: Option<String>,
    /// A part's id (`backup`, `device:till-1`), or a family by its prefix
    /// (`device` matches every `device:…`).
    #[serde(default)]
    pub component: Option<String>,
    /// Opened at or after this; thirty days back when absent.
    #[serde(default)]
    pub from: Option<DateTime<Utc>>,
    /// `open` (the default is every state).
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

const INCIDENT_SELECT: &str = "
    SELECT i.incident_id, i.subject, i.component, i.rule, i.unit_id, u.code AS unit_code,
           i.site_id, i.origin_id, i.code, i.title, i.body, i.opened_at, i.filed_at,
           i.notified_at, i.notified_to, i.acknowledged_at, i.acknowledged_by,
           i.acknowledged_note, i.escalated_at, i.resolved_at, c.label AS component_label
      FROM fleet_incident i
      LEFT JOIN unit u ON u.id = i.unit_id
      LEFT JOIN fleet_component c ON c.subject = i.subject AND c.component = i.component";

fn incident_json(row: &sqlx::postgres::PgRow, now: DateTime<Utc>) -> Result<Value, AppError> {
    let opened_at: DateTime<Utc> = row.try_get("opened_at")?;
    let resolved_at: Option<DateTime<Utc>> = row.try_get("resolved_at")?;
    let acknowledged_at: Option<DateTime<Utc>> = row.try_get("acknowledged_at")?;
    let state = match (resolved_at, acknowledged_at) {
        (Some(_), _) => "RESOLVED",
        (None, Some(_)) => "ACKNOWLEDGED",
        (None, None) => "OPEN",
    };
    Ok(json!({
        "incident_id": row.try_get::<Uuid, _>("incident_id")?,
        "state": state,
        "subject": row.try_get::<String, _>("subject")?,
        "unit_id": row.try_get::<Option<String>, _>("unit_id")?,
        "unit_code": row.try_get::<Option<String>, _>("unit_code")?,
        "site_id": row.try_get::<Option<String>, _>("site_id")?,
        "origin_id": row.try_get::<Option<String>, _>("origin_id")?,
        "component": row.try_get::<String, _>("component")?,
        "component_label": row.try_get::<Option<String>, _>("component_label")?,
        "rule": row.try_get::<String, _>("rule")?,
        "code": row.try_get::<String, _>("code")?,
        "title": row.try_get::<String, _>("title")?,
        "body": row.try_get::<String, _>("body")?,
        "opened_at": opened_at,
        "filed_at": row.try_get::<DateTime<Utc>, _>("filed_at")?,
        "notified_at": row.try_get::<Option<DateTime<Utc>>, _>("notified_at")?,
        "notified_to": row.try_get::<Vec<String>, _>("notified_to")?,
        "acknowledged_at": acknowledged_at,
        "acknowledged_by": row.try_get::<Option<String>, _>("acknowledged_by")?,
        "acknowledged_note": row.try_get::<Option<String>, _>("acknowledged_note")?,
        "escalated_at": row.try_get::<Option<DateTime<Utc>>, _>("escalated_at")?,
        "resolved_at": resolved_at,
        "duration_seconds": (resolved_at.unwrap_or(now) - opened_at).num_seconds().max(0),
    }))
}

/// `GET /api/v1/fleet/incidents?unit=&component=&from=&state=&limit=`, newest
/// first. The second half is how many matched in all.
pub async fn fleet_incidents(
    pool: &PgPool,
    query: &FleetIncidentQuery,
) -> Result<(Vec<Value>, i64), AppError> {
    let now = Utc::now();
    let subject = match query.unit.as_deref().map(str::trim).filter(|unit| !unit.is_empty()) {
        Some(unit) => Some(fleet_resolve_subject(pool, unit).await?),
        None => None,
    };
    let open_only = match query.state.as_deref() {
        None | Some("") | Some("all") => false,
        Some("open") => true,
        Some(other) => {
            return Err(AppError::Validation(format!(
                "state is open or all, not {other}"
            )))
        }
    };
    let component = query
        .component
        .as_deref()
        .map(str::trim)
        .filter(|component| !component.is_empty());
    let from = query.from.unwrap_or(now - Duration::days(30));
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let filter = "
     WHERE ($1::text IS NULL OR i.subject = $1)
       AND ($2::text IS NULL OR i.component = $2 OR i.component LIKE $2 || ':%')
       AND (i.opened_at >= $3 OR i.resolved_at IS NULL)
       AND ($4 = false OR i.resolved_at IS NULL)";
    let rows = sqlx::query(&format!(
        "{INCIDENT_SELECT} {filter} ORDER BY i.opened_at DESC, i.incident_id LIMIT $5"
    ))
    .bind(&subject)
    .bind(component)
    .bind(from)
    .bind(open_only)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM fleet_incident i {filter}"
    ))
    .bind(&subject)
    .bind(component)
    .bind(from)
    .bind(open_only)
    .fetch_one(pool)
    .await?;
    let items = rows
        .iter()
        .map(|row| incident_json(row, now))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((items, total))
}

/// `POST /api/v1/fleet/incidents/{id}/acknowledge`: somebody has it. Stops
/// the escalation; does not close the incident, which only recovery does.
/// Acknowledging twice keeps the first person's name.
pub async fn fleet_acknowledge_incident(
    pool: &PgPool,
    incident_id: Uuid,
    actor: &str,
    note: Option<&str>,
) -> Result<Value, AppError> {
    let note = note.map(str::trim).filter(|note| !note.is_empty());
    if note.is_some_and(|note| note.chars().count() > 500) {
        return Err(AppError::Validation("a note is at most 500 characters".into()));
    }
    let found = sqlx::query(
        "UPDATE fleet_incident
            SET acknowledged_at = COALESCE(acknowledged_at, now()),
                acknowledged_by = COALESCE(acknowledged_by, $2),
                acknowledged_note = COALESCE(acknowledged_note, $3)
          WHERE incident_id = $1
         RETURNING incident_id",
    )
    .bind(incident_id)
    .bind(actor)
    .bind(note)
    .fetch_optional(pool)
    .await?;
    if found.is_none() {
        return Err(AppError::NotFound(format!("fleet incident {incident_id}")));
    }
    let row = sqlx::query(&format!("{INCIDENT_SELECT} WHERE i.incident_id = $1"))
        .bind(incident_id)
        .fetch_one(pool)
        .await?;
    incident_json(&row, Utc::now())
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap_or_default() + Duration::minutes(minutes)
    }

    fn span_row(state: &str, from: i64, seen: i64) -> SpanRow {
        SpanRow { state: state.into(), started_at: at(from), seen_at: at(seen) }
    }

    #[test]
    fn a_row_is_the_worst_part_that_can_be_judged() {
        assert_eq!(worst_state([PART_OK, PART_UNKNOWN, PART_WARN]), PART_WARN);
        assert_eq!(worst_state([PART_OK, PART_UNKNOWN]), PART_OK);
        assert_eq!(worst_state([PART_UNKNOWN, PART_UNKNOWN]), PART_UNKNOWN);
        assert_eq!(worst_state([PART_BAD, PART_WARN]), PART_BAD);
    }

    #[test]
    fn quiet_hours_wrap_midnight() {
        let settings = FleetSettings {
            quiet_from: Some("22:00".into()),
            quiet_until: Some("06:30".into()),
            ..FleetSettings::default()
        };
        assert!(settings.is_quiet_at(23 * 60));
        assert!(settings.is_quiet_at(6 * 60 + 29));
        assert!(!settings.is_quiet_at(6 * 60 + 30));
        assert!(!settings.is_quiet_at(12 * 60));
        assert!(!FleetSettings::default().is_quiet_at(3 * 60));
    }

    #[test]
    fn settings_refuse_what_the_table_would() {
        let mut settings = FleetSettings::default();
        assert!(settings.validate().is_ok());
        settings.quiet_from = Some("22:00".into());
        assert!(settings.validate().is_err(), "a start without an end");
        settings.quiet_until = Some("22:00".into());
        assert!(settings.validate().is_err(), "a day with no hours");
        settings.quiet_until = Some("06:00".into());
        assert!(settings.validate().is_ok());
        settings.notify_roles = vec!["it".into()];
        assert!(settings.validate().is_err(), "role codes are upper case");
    }

    #[test]
    fn commands_are_named_as_head_office_says_them() {
        assert_eq!(command_label("commercial.publication.activate", Some("42")), "Price list v42");
        assert_eq!(command_label("catalog.snapshot.chunk", Some("17")), "Catalogue g17");
        assert_eq!(command_label("node.restart", None), "Server: restart");
        assert_eq!(command_label("inventory.flow.events.v1", None), "Stock: flow events");
    }

    #[test]
    fn uptime_counts_red_against_the_time_that_could_be_judged() {
        // Green for an hour, red for ten minutes, grey for twenty.
        let spans = vec![
            span_row(PART_OK, 0, 59),
            span_row(PART_BAD, 60, 69),
            span_row(PART_UNKNOWN, 70, 89),
        ];
        let t = tally(&spans, at(0), at(90), at(90), false);
        assert_eq!((t.ok, t.bad, t.unknown), (3600, 600, 1200));
        let percent = t.percent().unwrap_or_default();
        assert!((percent - 3600.0 / 4200.0 * 100.0).abs() < 0.01, "{percent}");
    }

    #[test]
    fn head_office_counts_the_time_nobody_was_looking_as_down() {
        // Up for ten minutes, then nothing for twenty, then up again.
        let spans = vec![span_row(PART_OK, 0, 9), span_row(PART_OK, 30, 59)];
        let store = tally(&spans, at(0), at(60), at(60), false);
        assert_eq!(store.bad, 0, "a store's part is not down while head office was");
        let head_office = tally(&spans, at(0), at(60), at(60), true);
        assert_eq!(head_office.bad, 20 * 60);
    }

    #[test]
    fn a_day_bar_is_its_worst_colour() {
        let spans = vec![span_row(PART_OK, 0, 30), span_row(PART_WARN, 31, 40)];
        let bars = day_bars(&spans, 0, at(60), false);
        assert_eq!(bars.len(), HISTORY_BARS as usize);
        let today = bars.last().map(|bar| bar.state);
        assert_eq!(today, Some(PART_WARN));
        assert_eq!(bars.first().map(|bar| bar.state), Some("NONE"));
    }

    #[test]
    fn a_red_part_alerts_only_after_the_grace() {
        let settings = FleetSettings::default();
        let red = part("server", "SERVER", "Store server", PART_BAD, "OFFLINE", "x", json!({}));
        assert_eq!(rule_for(&red, at(0), &settings, at(2)), None);
        assert_eq!(rule_for(&red, at(0), &settings, at(5)), Some("COMPONENT_RED"));
        let offline_sync = part("sync", "SYNC", "Connection & sync", PART_BAD, "OFFLINE", "x", json!({}));
        assert_eq!(rule_for(&offline_sync, at(0), &settings, at(60)), None, "the server part says it");
        let backup = part("backup", "BACKUP", "Daily backup", PART_BAD, "FAILED", "x", json!({}));
        assert_eq!(rule_for(&backup, at(0), &settings, at(0)), Some("BACKUP"));
    }

    #[test]
    fn an_outage_says_what_it_was() {
        let internet = outage_from(
            "CONNECTION_LOST",
            &json!({"from": "a", "to": "b", "facts_written": 40, "sales_written": 12}),
        );
        assert_eq!(internet.as_ref().and_then(|o| o["cause"].as_str()), Some("INTERNET"));
        assert_eq!(internet.as_ref().and_then(|o| o["kept_selling"].as_bool()), Some(true));
        let off = outage_from(
            "STARTED",
            &json!({"at": "b", "previous": {"how": "UNCLEAN", "last_seen": "a", "machine_restarted": true}}),
        );
        assert_eq!(off.as_ref().and_then(|o| o["cause"].as_str()), Some("SWITCHED_OFF"));
    }
}
