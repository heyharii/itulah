//! A copy of the shop's database, every day, kept for a week.
//!
//! Most of what a node holds can be sent again from head office — the
//! catalogue, the prices, the users. What cannot is what the shop wrote and
//! has not sent yet: the outbox. A dead disk with an unsynced afternoon on it
//! is the one loss the fleet cannot repair by itself, and this is what repairs
//! it (STORE-SERVER-PLAN §6).
//!
//! `VACUUM INTO` writes a whole, consistent copy while the node keeps running;
//! it takes the database lock for the length of the copy, which for a shop's
//! database is seconds. It waits while the machine is busy (`edge/pace.rs`) —
//! a backup can run an hour later, a sale cannot.

use chrono::{DateTime, Local, Utc};
use rusqlite::Connection;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

const KEEP: usize = 7;
const CHECK_EVERY: Duration = Duration::from_secs(15 * 60);

fn folder(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

/// The newest backup and when it was taken.
pub fn latest(data_dir: &Path) -> Option<(PathBuf, DateTime<Utc>)> {
    let entries = std::fs::read_dir(folder(data_dir)).ok()?;
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".sqlite3"))
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), DateTime::<Utc>::from(modified)))
        })
        .max_by_key(|(_, at)| *at)
}

/// Take a backup now. Returns where it went. The outcome is written down
/// (`edge_backup_run`, sqlite 0065) either way, so the heartbeat can say that
/// last night's backup failed rather than only how old the newest file is.
pub fn take(connection: &Arc<Mutex<Connection>>, data_dir: &Path) -> Result<PathBuf, String> {
    let result = copy(connection, data_dir);
    let bytes = result
        .as_ref()
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len());
    if let Ok(guard) = connection.lock() {
        if let Err(error) = record_attempt(&guard, Utc::now(), result.as_ref().err(), bytes) {
            tracing::warn!(%error, "the backup's outcome was not written down");
        }
    }
    result
}

/// Write down one attempt. A failure keeps the last success.
pub fn record_attempt(
    connection: &Connection,
    at: DateTime<Utc>,
    error: Option<&String>,
    bytes: Option<u64>,
) -> rusqlite::Result<()> {
    let at = at.to_rfc3339();
    match error {
        None => connection.execute(
            "INSERT INTO edge_backup_run (singleton, last_attempt_at, last_ok_at, last_error, last_bytes)
             VALUES (1, ?1, ?1, NULL, ?2)
             ON CONFLICT (singleton) DO UPDATE SET
                 last_attempt_at = excluded.last_attempt_at, last_ok_at = excluded.last_ok_at,
                 last_error = NULL, last_bytes = excluded.last_bytes",
            rusqlite::params![at, bytes.and_then(|b| i64::try_from(b).ok())],
        )?,
        Some(error) => connection.execute(
            "INSERT INTO edge_backup_run (singleton, last_attempt_at, last_error)
             VALUES (1, ?1, ?2)
             ON CONFLICT (singleton) DO UPDATE SET
                 last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error",
            rusqlite::params![at, error.chars().take(300).collect::<String>()],
        )?,
    };
    Ok(())
}

/// The last attempt, for the heartbeat. `None` before the first one.
pub fn last_run(connection: &Connection) -> Option<crate::sync::node_status::BackupFacts> {
    let parse = |text: Option<String>| {
        text.and_then(|at| DateTime::parse_from_rfc3339(&at).ok())
            .map(|at| at.with_timezone(&Utc))
    };
    connection
        .query_row(
            "SELECT last_attempt_at, last_ok_at, last_error, last_bytes
               FROM edge_backup_run WHERE singleton = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .ok()
        .map(|(attempt, ok, error, bytes)| crate::sync::node_status::BackupFacts {
            last_attempt_at: parse(attempt),
            last_ok_at: parse(ok),
            last_error: error,
            last_bytes: bytes.and_then(|b| u64::try_from(b).ok()),
        })
}

fn copy(connection: &Arc<Mutex<Connection>>, data_dir: &Path) -> Result<PathBuf, String> {
    let dir = folder(data_dir);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("store-{}.sqlite3", Local::now().format("%Y%m%d-%H%M")));
    let partial = path.with_extension("partial");
    let _ = std::fs::remove_file(&partial);
    {
        let guard = connection.lock().map_err(|_| "database lock poisoned".to_owned())?;
        guard
            .execute("VACUUM INTO ?1", [partial.to_string_lossy().as_ref()])
            .map_err(|error| error.to_string())?;
    }
    // Renamed only once whole, so a half-written copy never looks like a backup.
    std::fs::rename(&partial, &path).map_err(|error| error.to_string())?;
    prune(&dir);
    Ok(path)
}

fn prune(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut backups: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sqlite3"))
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(KEEP);
    for old in backups.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

/// Keep a backup no older than a day, from now on.
pub fn spawn(connection: Arc<Mutex<Connection>>, data_dir: PathBuf) {
    tokio::spawn(async move {
        loop {
            let due = latest(&data_dir)
                .map_or(true, |(_, at)| Utc::now() - at > chrono::Duration::hours(24));
            if due && crate::edge::pace::factor() == 1 && !crate::edge::power::on_battery() {
                let connection = connection.clone();
                let dir = data_dir.clone();
                match tokio::task::spawn_blocking(move || take(&connection, &dir)).await {
                    Ok(Ok(path)) => tracing::info!(path = %path.display(), "daily backup taken"),
                    Ok(Err(error)) => tracing::warn!(%error, "daily backup failed"),
                    Err(error) => tracing::warn!(%error, "daily backup task failed"),
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}
