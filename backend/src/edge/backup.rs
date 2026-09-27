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

/// Take a backup now. Returns where it went.
pub fn take(connection: &Arc<Mutex<Connection>>, data_dir: &Path) -> Result<PathBuf, String> {
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
