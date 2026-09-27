//! Carrying out what head office asked for (`sync::node_ops`).
//!
//! The command lane applies each command inside a database transaction, and
//! none of these belongs inside one: a restart would kill the transaction that
//! records it, a backup would wait on the very lock the transaction holds. So
//! applying the command only queues the operation here, and a runner does it
//! after the commit — the command is acknowledged as received, and what then
//! happened is written to the log and, for a diagnosis, sent to head office.
//!
//! # Followed actions (remote actions, 28 Sep 2026)
//!
//! An operation that carries an `action_id` is one of a store page's Actions,
//! and head office follows it until it finishes. Its row in
//! `edge_node_action` (sqlite 0067) is written in the command's own
//! transaction, so accepting it and remembering it are one event; the runner
//! then moves it to RUNNING and to DONE or FAILED with a sentence and the
//! numbers behind it, and the heartbeat carries it up
//! ([`recent_reports`]). A restart is marked done by the start it causes; an
//! action the node accepted and had not finished when it went down is picked
//! up again at start ([`resume`]).

use crate::edge::console::StopReason;
use crate::edge::status::StatusSource;
use crate::sync::node_ops::{
    ActionPayload, ActionReport, NodeOpPayload, UpdatePayload, ACTION_DONE, ACTION_FAILED,
    ACTION_RUNNING, NODE_BACKUP, NODE_DIAGNOSE, NODE_RESNAPSHOT, NODE_RESTART,
    NODE_SYNC_NOW,
};
use chrono::{DateTime, Local, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

#[derive(Debug)]
pub enum NodeOp {
    Plain { kind: String, payload: NodeOpPayload },
    Update(UpdatePayload),
}

static QUEUE: OnceLock<mpsc::UnboundedSender<NodeOp>> = OnceLock::new();

/// Queue an operation for after the command's transaction commits. A node
/// with no runner (a DC, a developer's run without a data directory) logs it
/// and carries on: the instruction is received, there is simply nothing here
/// that carries it out.
pub fn enqueue(kind: &str, payload: NodeOpPayload) {
    send(NodeOp::Plain {
        kind: kind.to_owned(),
        payload,
    });
}

/// Queue `node.sync_now`.
pub fn enqueue_sync_now(action: ActionPayload) {
    enqueue(
        NODE_SYNC_NOW,
        NodeOpPayload {
            reason: action.reason,
            force: false,
            action_id: Some(action.action_id),
        },
    );
}

/// Queue a signed update (`edge/update.rs`).
pub fn enqueue_update(update: UpdatePayload) {
    send(NodeOp::Update(update));
}

fn send(op: NodeOp) {
    match QUEUE.get() {
        Some(queue) => {
            let _ = queue.send(op);
        }
        None => tracing::warn!(?op, "head office asked for an operation this node does not run"),
    }
}

/// How long a restart waits for open drawers before it goes ahead anyway.
const RESTART_PATIENCE: Duration = Duration::from_secs(12 * 3600);
const RESTART_RECHECK: Duration = Duration::from_secs(5 * 60);
/// How long "sync now" waits for the cycle it started.
const SYNC_NOW_PATIENCE: Duration = Duration::from_secs(120);
/// An action accepted this long before a start is still worth doing then.
const RESUME_WITHIN: chrono::Duration = chrono::Duration::hours(1);
/// Finished actions ride in the heartbeat for this long.
const REPORT_FOR: chrono::Duration = chrono::Duration::hours(2);
const REPORT_AT_MOST: i64 = 20;
const KEEP_FOR: chrono::Duration = chrono::Duration::days(7);

// ---- The node's record ---------------------------------------------------------

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn parse_stamp(text: Option<String>) -> Option<DateTime<Utc>> {
    text.and_then(|text| DateTime::parse_from_rfc3339(&text).ok())
        .map(|at| at.with_timezone(&Utc))
}

/// Write down an action as accepted, inside the command's transaction. A
/// resent command finds its row and changes nothing.
pub fn record_received(
    connection: &Connection,
    action_id: Uuid,
    kind: &str,
    reason: &str,
    force: bool,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO edge_node_action (action_id, kind, reason, force, received_at, state)
         VALUES (?1, ?2, ?3, ?4, ?5, 'QUEUED')",
        params![action_id.to_string(), kind, reason, i64::from(force), stamp(Utc::now())],
    )?;
    Ok(())
}

/// `node.resnapshot`, inside its command's transaction: every command head
/// office re-sent ahead of it has been applied by now (they are applied in
/// order), so the node has rebuilt what it holds from head office. Says how
/// much it now holds.
pub fn record_resnapshot(connection: &Connection, action: &ActionPayload) -> rusqlite::Result<()> {
    let count = |table: &str| -> Option<i64> {
        connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get(0))
            .ok()
    };
    let catalogue = count("catalog_item");
    let price_rules = count("commercial_price_rule");
    let users = count("edge_user");
    let roster = count("attendance_employee");
    let mut parts = Vec::new();
    for (value, word) in [
        (catalogue, "catalogue items"),
        (price_rules, "price rules"),
        (users, "users"),
        (roster, "people on the attendance book"),
    ] {
        if let Some(value) = value {
            parts.push(format!("{value} {word}"));
        }
    }
    let sentence = if parts.is_empty() {
        "Initial data applied.".to_owned()
    } else {
        format!("Initial data applied: {}.", parts.join(", "))
    };
    let now = stamp(Utc::now());
    connection.execute(
        "INSERT INTO edge_node_action
             (action_id, kind, reason, received_at, started_at, finished_at, state, sentence, detail)
         VALUES (?1, ?2, ?3, ?4, ?4, ?4, 'DONE', ?5, ?6)
         ON CONFLICT (action_id) DO NOTHING",
        params![
            action.action_id.to_string(),
            NODE_RESNAPSHOT,
            action.reason,
            now,
            sentence,
            json!({
                "catalogue_items": catalogue,
                "price_rules": price_rules,
                "users": users,
                "attendance_people": roster,
            })
            .to_string(),
        ],
    )?;
    Ok(())
}

/// Move one action on. `started` stamps `started_at` when it has none;
/// a finished state stamps `finished_at`. Logged, never fatal: the action
/// itself matters more than its record.
fn mark(
    connection: &Arc<Mutex<Connection>>,
    action_id: Option<Uuid>,
    state: &str,
    sentence: &str,
    detail: &Value,
) {
    let Some(action_id) = action_id else {
        return;
    };
    let now = stamp(Utc::now());
    let finished = matches!(state, ACTION_DONE | ACTION_FAILED).then(|| now.clone());
    let written = connection.lock().map_err(|_| "database lock poisoned".to_owned()).and_then(|guard| {
        guard
            .execute(
                "UPDATE edge_node_action
                    SET state = ?2, sentence = ?3, detail = ?4,
                        started_at = COALESCE(started_at, ?5),
                        finished_at = COALESCE(?6, finished_at)
                  WHERE action_id = ?1",
                params![action_id.to_string(), state, sentence, detail.to_string(), now, finished],
            )
            .map_err(|error| error.to_string())
    });
    if let Err(error) = written {
        tracing::warn!(%error, %action_id, "an action's progress was not written down");
    }
    crate::edge::heartbeat::soon();
}

/// The actions to carry up in the heartbeat: unfinished ones, and those
/// finished lately. `None` when the table cannot be read.
pub fn recent_reports(connection: &Connection) -> Option<Vec<ActionReport>> {
    let since = stamp(Utc::now() - REPORT_FOR);
    let mut statement = connection
        .prepare(
            "SELECT action_id, kind, state, received_at, started_at, finished_at, sentence, detail
               FROM edge_node_action
              WHERE state IN ('QUEUED', 'RUNNING') OR COALESCE(finished_at, received_at) >= ?1
              ORDER BY received_at DESC
              LIMIT ?2",
        )
        .ok()?;
    let rows = statement
        .query_map(params![since, REPORT_AT_MOST], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .ok()?;
    let mut reports = Vec::new();
    for row in rows.flatten() {
        let (id, kind, state, received, started, finished, sentence, detail) = row;
        let (Ok(action_id), Some(received_at)) = (Uuid::parse_str(&id), parse_stamp(Some(received)))
        else {
            continue;
        };
        reports.push(ActionReport {
            action_id,
            kind,
            state,
            received_at,
            started_at: parse_stamp(started),
            finished_at: parse_stamp(finished),
            sentence,
            detail: serde_json::from_str(&detail).unwrap_or(Value::Null),
        });
    }
    Some(reports)
}

/// At start: finish the restart that caused it, pick up what was accepted and
/// not done, and forget what is a week old. Returns what to run again.
fn resume(connection: &Arc<Mutex<Connection>>, started_at: DateTime<Utc>) -> Vec<(Uuid, String, NodeOpPayload)> {
    let Ok(guard) = connection.lock() else {
        return Vec::new();
    };
    let _ = guard.execute(
        "DELETE FROM edge_node_action WHERE received_at < ?1",
        [stamp(Utc::now() - KEEP_FOR)],
    );
    let unfinished: Vec<(String, String, String, i64, String, String)> = guard
        .prepare(
            "SELECT action_id, kind, COALESCE(reason, ''), force, received_at, detail
               FROM edge_node_action WHERE state IN ('QUEUED', 'RUNNING')",
        )
        .and_then(|mut statement| {
            statement
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
                })
                .map(|rows| rows.flatten().collect())
        })
        .unwrap_or_default();
    let now = Utc::now();
    let finish = |id: &str, state: &str, sentence: &str, detail: &Value| {
        let _ = guard.execute(
            "UPDATE edge_node_action
                SET state = ?2, sentence = ?3, detail = ?4,
                    started_at = COALESCE(started_at, ?5), finished_at = ?5
              WHERE action_id = ?1",
            params![id, state, sentence, detail.to_string(), stamp(now)],
        );
    };
    let mut again = Vec::new();
    for (id, kind, reason, force, received, detail) in unfinished {
        let mut detail: Value = serde_json::from_str(&detail).unwrap_or_else(|_| json!({}));
        if kind == NODE_RESTART {
            let stopping = detail
                .get("stopping_at")
                .and_then(Value::as_str)
                .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                .map(|at| at.with_timezone(&Utc));
            let sentence = match stopping {
                Some(stopped) => {
                    let down = (started_at - stopped).num_seconds().max(0);
                    detail["back_at"] = json!(started_at);
                    detail["down_seconds"] = json!(down);
                    format!(
                        "Restarted: back at {} after {down} s.",
                        started_at.with_timezone(&Local).format("%H:%M")
                    )
                }
                None => {
                    detail["back_at"] = json!(started_at);
                    "The server had already restarted for another reason before this restart \
                     was due."
                        .to_owned()
                }
            };
            detail["version"] = json!(env!("CARGO_PKG_VERSION"));
            finish(&id, ACTION_DONE, &sentence, &detail);
            continue;
        }
        let fresh = parse_stamp(Some(received)).is_some_and(|at| now - at < RESUME_WITHIN);
        match Uuid::parse_str(&id) {
            Ok(action_id) if fresh && matches!(kind.as_str(), NODE_BACKUP | NODE_DIAGNOSE | NODE_SYNC_NOW) => {
                let _ = guard.execute(
                    "UPDATE edge_node_action SET state = 'QUEUED' WHERE action_id = ?1",
                    [&id],
                );
                again.push((
                    action_id,
                    kind,
                    NodeOpPayload {
                        reason,
                        force: force == 1,
                        action_id: Some(action_id),
                    },
                ));
            }
            _ => finish(
                &id,
                ACTION_FAILED,
                "The server restarted before it could finish this. Ask again.",
                &detail,
            ),
        }
    }
    again
}

// ---- The runner ------------------------------------------------------------------

/// Run operations from now on.
pub fn spawn_runner(
    source: Arc<StatusSource>,
    data_dir: Option<PathBuf>,
    stop: Arc<watch::Sender<StopReason>>,
) {
    let (sender, mut receiver) = mpsc::unbounded_channel::<NodeOp>();
    if QUEUE.set(sender.clone()).is_err() {
        return;
    }
    tokio::spawn(async move {
        {
            let connection = source.connection.clone();
            let started_at = source.started_at;
            let again = tokio::task::spawn_blocking(move || resume(&connection, started_at))
                .await
                .unwrap_or_default();
            for (_, kind, payload) in again {
                let _ = sender.send(NodeOp::Plain { kind, payload });
            }
            crate::edge::heartbeat::soon();
        }
        while let Some(op) = receiver.recv().await {
            let (kind, payload) = match op {
                NodeOp::Update(update) => {
                    tracing::info!(version = %update.version, reason = %update.reason, "update from head office");
                    tokio::spawn(crate::edge::update::install(
                        update,
                        source.clone(),
                        data_dir.clone(),
                        stop.clone(),
                    ));
                    continue;
                }
                NodeOp::Plain { kind, payload } => (kind, payload),
            };
            tracing::info!(kind = %kind, reason = %payload.reason, "operation from head office");
            let action = payload.action_id;
            match kind.as_str() {
                NODE_RESTART => {
                    tokio::spawn(restart(source.clone(), stop.clone(), payload.force, action));
                }
                NODE_BACKUP => backup(&source, data_dir.clone(), action).await,
                NODE_DIAGNOSE => diagnose(&source, data_dir.clone(), action).await,
                NODE_SYNC_NOW => sync_now(&source, action).await,
                other => {
                    tracing::warn!(kind = other, "unknown operation");
                    mark(
                        &source.connection,
                        action,
                        ACTION_FAILED,
                        "This server does not know that operation.",
                        &json!({}),
                    );
                }
            }
        }
    });
}

async fn open_drawers(source: &Arc<StatusSource>) -> (i64, Vec<String>) {
    let collecting = source.clone();
    tokio::task::spawn_blocking(move || {
        let till = collecting.collect().till;
        (till.open_shifts, till.open_shift_terminals)
    })
    .await
    .unwrap_or_default()
}

/// Restart once every drawer is closed, or after twelve hours, or at once
/// when forced. The service manager (systemd, or the Windows SCM through
/// `winservice.rs`) starts the node again; the stop is graceful — requests in
/// flight finish, the log is folded into the database, the journal says it
/// was asked for — so it counts as maintenance, not an outage.
async fn restart(
    source: Arc<StatusSource>,
    stop: Arc<watch::Sender<StopReason>>,
    force: bool,
    action: Option<Uuid>,
) {
    let started = tokio::time::Instant::now();
    loop {
        let (open, terminals) = open_drawers(&source).await;
        if force || open == 0 || started.elapsed() >= RESTART_PATIENCE {
            tracing::warn!("restarting at head office's request");
            let connection = source.connection.clone();
            let _ = tokio::task::spawn_blocking(move || {
                mark(
                    &connection,
                    action,
                    ACTION_RUNNING,
                    "Restarting now.",
                    &json!({ "stopping_at": Utc::now() }),
                );
            })
            .await;
            // A moment for the heartbeat `mark` just woke to tell head office
            // the silence that follows is this restart.
            if action.is_some() {
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            let _ = stop.send(StopReason::Restart);
            return;
        }
        tracing::info!(open, "restart from head office waits for open drawers");
        let connection = source.connection.clone();
        let _ = tokio::task::spawn_blocking(move || {
            mark(
                &connection,
                action,
                ACTION_RUNNING,
                &format!(
                    "Waiting for {open} open cash {} to close ({}) before restarting.",
                    if open == 1 { "drawer" } else { "drawers" },
                    terminals.join(", ")
                ),
                &json!({ "open_drawers": open, "terminals": terminals }),
            );
        })
        .await;
        tokio::time::sleep(RESTART_RECHECK).await;
    }
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

async fn backup(source: &Arc<StatusSource>, data_dir: Option<PathBuf>, action: Option<Uuid>) {
    let connection = source.connection.clone();
    let Some(dir) = data_dir else {
        let _ = tokio::task::spawn_blocking(move || {
            mark(
                &connection,
                action,
                ACTION_FAILED,
                "This server has no data folder to back up into.",
                &json!({}),
            )
        })
        .await;
        return;
    };
    let outcome = tokio::task::spawn_blocking(move || {
        mark(&connection, action, ACTION_RUNNING, "Taking a backup.", &json!({}));
        let began = Instant::now();
        let result = crate::edge::backup::take(&connection, &dir);
        let took = began.elapsed();
        match &result {
            Ok(path) => {
                let bytes = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
                let taken_at = Utc::now();
                mark(
                    &connection,
                    action,
                    ACTION_DONE,
                    &format!(
                        "Backup taken at {}: {} in {} s.",
                        taken_at.with_timezone(&Local).format("%H:%M"),
                        megabytes(bytes),
                        took.as_secs().max(1)
                    ),
                    &json!({
                        "file": path.file_name().map(|name| name.to_string_lossy().into_owned()),
                        "bytes": bytes,
                        "took_ms": u64::try_from(took.as_millis()).unwrap_or(u64::MAX),
                        "taken_at": taken_at,
                    }),
                );
            }
            Err(error) => mark(
                &connection,
                action,
                ACTION_FAILED,
                &format!("Backup failed: {error}"),
                &json!({ "error": error }),
            ),
        }
        result
    })
    .await;
    match outcome {
        Ok(Ok(path)) => tracing::info!(path = %path.display(), "backup taken at head office's request"),
        Ok(Err(error)) => tracing::warn!(%error, "backup requested by head office failed"),
        Err(error) => tracing::warn!(%error, "backup task failed"),
    }
}

async fn diagnose(source: &Arc<StatusSource>, data_dir: Option<PathBuf>, action: Option<Uuid>) {
    let connection = source.connection.clone();
    {
        let connection = connection.clone();
        let _ = tokio::task::spawn_blocking(move || {
            mark(&connection, action, ACTION_RUNNING, "Diagnosing.", &json!({}))
        })
        .await;
    }
    let report = crate::edge::diagnose::diagnose(data_dir.as_deref()).await;
    crate::edge::diagnose::save(&report);
    let uploaded = upload_diagnosis(source, &report).await;
    if let Err(error) = &uploaded {
        tracing::warn!(%error, "diagnosis could not be sent to head office");
    }
    let verdict = serde_json::to_value(report.verdict).unwrap_or(Value::Null);
    let checks = serde_json::to_value(&report.checks).unwrap_or(Value::Null);
    let not_ok: Vec<&crate::edge::diagnose::Check> = report
        .checks
        .iter()
        .filter(|check| check.verdict != crate::edge::diagnose::Verdict::Ok)
        .collect();
    let sentence = match not_ok.first() {
        None => format!("Diagnosis: all {} checks OK.", report.checks.len()),
        Some(first) => format!(
            "Diagnosis: {} of {} checks need a look. {}",
            not_ok.len(),
            report.checks.len(),
            first.saying
        ),
    };
    let detail = json!({
        "verdict": verdict,
        "version": report.version,
        "platform": report.platform,
        "checks": checks,
        "uploaded": uploaded.is_ok(),
        "upload_error": uploaded.err(),
    });
    let _ = tokio::task::spawn_blocking(move || {
        mark(&connection, action, ACTION_DONE, &sentence, &detail)
    })
    .await;
}

fn applied_seq(connection: &Arc<Mutex<Connection>>) -> Option<i64> {
    connection.lock().ok().and_then(|guard| {
        guard
            .query_row("SELECT applied_seq FROM sync_command_watermark", [], |row| row.get(0))
            .optional()
            .ok()
            .flatten()
    })
}

/// Push the outbox and pull commands now, and say how the queue stood
/// before and after. Waits for the cycle it started, two minutes at most.
async fn sync_now(source: &Arc<StatusSource>, action: Option<Uuid>) {
    let connection = source.connection.clone();
    let Some(sync) = source.sync.clone() else {
        let _ = tokio::task::spawn_blocking(move || {
            mark(
                &connection,
                action,
                ACTION_FAILED,
                "This server is not connected to head office.",
                &json!({}),
            )
        })
        .await;
        return;
    };
    let reading = {
        let sync = sync.clone();
        let connection = connection.clone();
        move || {
            let status = sync.status().ok();
            (status, applied_seq(&connection))
        }
    };
    let (before, before_seq) = tokio::task::spawn_blocking(reading.clone()).await.unwrap_or((None, None));
    let asked_at = Utc::now();
    {
        let connection = connection.clone();
        let waiting = before.as_ref().map(|status| status.pending_facts);
        let _ = tokio::task::spawn_blocking(move || {
            mark(
                &connection,
                action,
                ACTION_RUNNING,
                "Syncing now.",
                &json!({ "before": { "waiting": waiting } }),
            )
        })
        .await;
    }
    sync.trigger();
    let began = Instant::now();
    let mut after = None;
    let mut after_seq = None;
    while began.elapsed() < SYNC_NOW_PATIENCE {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let (status, seq) = tokio::task::spawn_blocking(reading.clone()).await.unwrap_or((None, None));
        let finished = status.as_ref().is_some_and(|status| {
            status.last_success_at.is_some_and(|at| at >= asked_at)
                || status.last_error_at.is_some_and(|at| at >= asked_at)
        });
        after = status;
        after_seq = seq;
        if finished {
            break;
        }
    }
    let waiting_before = before.as_ref().map(|status| status.pending_facts);
    let waiting_after = after.as_ref().map(|status| status.pending_facts);
    let pulled = match (before_seq, after_seq) {
        (Some(before), Some(after)) => Some((after - before).max(0)),
        (None, Some(after)) => Some(after),
        _ => None,
    };
    let succeeded = after
        .as_ref()
        .and_then(|status| status.last_success_at)
        .is_some_and(|at| at >= asked_at);
    let error = after
        .as_ref()
        .filter(|status| status.last_error_at.is_some_and(|at| at >= asked_at))
        .and_then(|status| status.last_error.clone());
    let detail = json!({
        "before": {
            "waiting": waiting_before,
            "dead_lettered": before.as_ref().map(|status| status.dead_lettered),
            "applied_command_seq": before_seq,
        },
        "after": {
            "waiting": waiting_after,
            "dead_lettered": after.as_ref().map(|status| status.dead_lettered),
            "applied_command_seq": after_seq,
        },
        "commands_pulled": pulled,
        "took_ms": u64::try_from(began.elapsed().as_millis()).unwrap_or(u64::MAX),
        "error": error,
    });
    let queue = format!(
        "{} waiting (was {})",
        waiting_after.map_or("?".to_owned(), |n| n.to_string()),
        waiting_before.map_or("?".to_owned(), |n| n.to_string())
    );
    let (state, sentence) = if succeeded {
        (
            ACTION_DONE,
            format!(
                "Synced: {queue}; {} from head office applied.",
                match pulled {
                    Some(1) => "1 command".to_owned(),
                    Some(n) => format!("{n} commands"),
                    None => "the commands".to_owned(),
                }
            ),
        )
    } else if let Some(error) = &error {
        (ACTION_FAILED, format!("Sync failed: {error}. {queue}."))
    } else {
        (
            ACTION_FAILED,
            format!("No sync finished within two minutes; {queue}. The server keeps trying."),
        )
    };
    let _ = tokio::task::spawn_blocking(move || mark(&connection, action, state, &sentence, &detail)).await;
}

async fn upload_diagnosis(
    source: &Arc<StatusSource>,
    report: &crate::edge::diagnose::Report,
) -> Result<(), String> {
    let sync = source.sync.as_ref().ok_or("no cloud configured")?;
    let (base, key) = sync.cloud().ok_or("no cloud configured")?;
    let origin = std::env::var("INVENTORY_NODE_ID").unwrap_or_default();
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .post(format!("{base}/api/v1/sync/diagnostics"))
        .header("x-sync-key", key)
        .json(&serde_json::json!({ "origin_id": origin, "report": report }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("head office answered {}", response.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap_or_else(|_| unreachable!());
        let _ = connection.execute_batch(crate::edge::sqlite::NODE_ACTION_SCHEMA);
        connection
    }

    #[test]
    fn an_accepted_action_is_reported_until_it_is_old() {
        let connection = database();
        let id = Uuid::new_v4();
        assert!(record_received(&connection, id, NODE_BACKUP, "lambat", false).is_ok());
        assert!(record_received(&connection, id, NODE_BACKUP, "lambat", false).is_ok());
        let reports = recent_reports(&connection).unwrap_or_default();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].state, crate::sync::node_ops::ACTION_QUEUED);
    }

    #[test]
    fn a_restart_is_finished_by_the_start_it_caused() {
        let shared = Arc::new(Mutex::new(database()));
        let id = Uuid::new_v4();
        if let Ok(guard) = shared.lock() {
            let _ = record_received(&guard, id, NODE_RESTART, "lambat", false);
        }
        mark(&shared, Some(id), ACTION_RUNNING, "Restarting now.", &json!({ "stopping_at": Utc::now() }));
        assert!(resume(&shared, Utc::now()).is_empty());
        let reports = shared
            .lock()
            .ok()
            .and_then(|guard| recent_reports(&guard))
            .unwrap_or_default();
        assert_eq!(reports[0].state, ACTION_DONE);
        assert!(reports[0].sentence.as_deref().unwrap_or("").starts_with("Restarted"));
    }
}
