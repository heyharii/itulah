//! Installing a new build of the store server, and taking it back if it fails.
//!
//! Pulled, signed, windowed, reversible (STORE-SERVER-PLAN §5):
//!
//! 1. Head office sends `node.update` with the build's address, digest and an
//!    Ed25519 signature over the digest. The public half of the release key is
//!    compiled in (`ITULAH_RELEASE_PUBLIC_KEY`, hex); a build without one
//!    accepts no updates at all.
//! 2. The node waits for its window (default 23:00-05:00 local) and for every
//!    drawer to be closed — an update never lands on a cashier mid-sale.
//! 3. It downloads, checks the digest and the signature, backs the database
//!    up, and puts the new executable in `<data>/bin/store`, keeping the one
//!    it replaces as `store.old`. `<data>` because the service may write there
//!    and nowhere else (`ProtectSystem=strict`).
//! 4. It stops cleanly — maintenance, not an outage — and the supervisor
//!    starts it again; the installed executable hands over to `<data>/bin/store`
//!    at start ([`hand_over`]), keeping its process id, so systemd's watchdog
//!    and notify socket carry on.
//! 5. The new version is committed once it has synced with head office within
//!    three minutes. If it instead falls over within ten, the start after
//!    restores the old executable and the pre-update database ([`settle`]).
//!
//! Windows cannot hand a running service over to another executable, and the
//! service account may not write Program Files, so there the build is fetched
//! and verified into `<data>/updates` and reported; installing it is the MSI's
//! job.

use crate::edge::console::StopReason;
use crate::edge::node::Journal;
use crate::edge::status::StatusSource;
use crate::sync::node_ops::{in_window, parse_window, UpdatePayload};
use chrono::{DateTime, Local, Timelike, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::watch;

const DEFAULT_WINDOW: &str = "23:00-05:00";
const RECHECK: Duration = Duration::from_secs(5 * 60);
/// How long an update may wait for its window and closed drawers.
const PATIENCE: Duration = Duration::from_secs(36 * 3600);
/// A new version that fails within this long is rolled back.
const TRIAL_MINUTES: i64 = 10;
/// A new version that has synced within this long is kept.
const COMMIT_AFTER: Duration = Duration::from_secs(3 * 60);

/// What an install in progress leaves behind for the next start to settle.
#[derive(Debug, Serialize, Deserialize)]
struct Pending {
    from_version: String,
    to_version: String,
    installed_at: DateTime<Utc>,
    backup: Option<PathBuf>,
}

fn bin_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("bin")
}

fn pending_file(data_dir: &Path) -> PathBuf {
    data_dir.join("updates").join("pending.json")
}

/// The executable an installed node should be running: the updated one in
/// `<data>/bin` when there is one.
fn installed_executable(data_dir: &Path) -> PathBuf {
    bin_dir(data_dir).join(if cfg!(windows) { "store.exe" } else { "store" })
}

/// At start: if an update installed a newer executable, become it. Same
/// process, same arguments, same environment — `exec` replaces the image, so
/// the supervisor never sees a second process. Unix only; a no-op elsewhere
/// and when already running the installed one.
pub fn hand_over(data_dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        if std::env::var_os("ITULAH_HANDED_OVER").is_some() {
            return;
        }
        let target = installed_executable(data_dir);
        let current = std::env::current_exe().ok().and_then(|p| std::fs::canonicalize(p).ok());
        let wanted = std::fs::canonicalize(&target).ok();
        if wanted.is_none() || current == wanted {
            return;
        }
        let error = std::process::Command::new(&target)
            .args(std::env::args_os().skip(1))
            .env("ITULAH_HANDED_OVER", "1")
            .exec();
        // Only reached when exec failed: carry on as the installed build.
        eprintln!("could not hand over to {}: {error}", target.display());
    }
    #[cfg(not(unix))]
    let _ = data_dir;
}

/// At start: settle an update the previous run installed. A failure inside
/// the trial restores the old executable and the pre-update database and
/// restarts; a healthy run is committed later by [`watch_trial`].
pub fn settle(data_dir: &Path, journal: &Journal, previous_failed: bool) -> bool {
    let path = pending_file(data_dir);
    let Some(pending) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Pending>(&text).ok())
    else {
        return false;
    };
    let within_trial = Utc::now() - pending.installed_at < chrono::Duration::minutes(TRIAL_MINUTES);
    if !(previous_failed && within_trial) {
        return false;
    }
    tracing::error!(
        from = %pending.from_version,
        to = %pending.to_version,
        "the new version failed inside its trial: rolling back"
    );
    let executable = installed_executable(data_dir);
    let old = executable.with_extension("old");
    let restored = if old.exists() {
        std::fs::rename(&old, &executable).is_ok()
    } else {
        // No older one in <data>/bin: the build in the install directory is
        // the previous one.
        std::fs::remove_file(&executable).is_ok()
    };
    if let Some(backup) = &pending.backup {
        let database = std::env::var("INVENTORY_DATABASE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("store-edge.sqlite3"));
        for suffix in ["sqlite3-wal", "sqlite3-shm"] {
            let _ = std::fs::remove_file(database.with_extension(suffix));
        }
        let _ = std::fs::copy(backup, &database);
    }
    let _ = std::fs::remove_file(&path);
    journal.record(&crate::sync::node_status::Incident::Stopped {
        at: Utc::now(),
        reason: format!(
            "update to {} failed and was rolled back to {}",
            pending.to_version, pending.from_version
        ),
    });
    restored
}

/// While a new version is on trial: commit it once it has synced with head
/// office, so a later crash is just a crash and not a reason to roll back.
pub fn watch_trial(source: Arc<StatusSource>, data_dir: PathBuf) {
    if !pending_file(&data_dir).exists() {
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(COMMIT_AFTER).await;
        let Some(pending) = std::fs::read_to_string(pending_file(&data_dir))
            .ok()
            .and_then(|text| serde_json::from_str::<Pending>(&text).ok())
        else {
            return;
        };
        let collecting = source.clone();
        let synced = tokio::task::spawn_blocking(move || collecting.collect().sync.last_success_at)
            .await
            .ok()
            .flatten()
            .is_some_and(|at| at > pending.installed_at);
        if synced {
            let _ = std::fs::remove_file(pending_file(&data_dir));
            let _ = std::fs::remove_file(installed_executable(&data_dir).with_extension("old"));
            tracing::info!(version = %pending.to_version, "update committed: the new version synced with head office");
        } else {
            tracing::warn!(version = %pending.to_version, "the new version has not synced yet; it stays on trial");
        }
    });
}

fn verify(bytes: &[u8], update: &UpdatePayload) -> Result<(), String> {
    let digest = Sha256::digest(bytes);
    if hex::encode(digest) != update.sha256.to_ascii_lowercase() {
        return Err("the download does not match its sha256".into());
    }
    let Some(key_hex) = option_env!("ITULAH_RELEASE_PUBLIC_KEY") else {
        return Err("this build carries no release key, so it accepts no updates".into());
    };
    let key = hex::decode(key_hex).map_err(|_| "the compiled release key is not hex".to_owned())?;
    let signature = hex::decode(&update.signature).map_err(|_| "the signature is not hex".to_owned())?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key)
        .verify(&digest, &signature)
        .map_err(|_| "the signature does not verify against the release key".into())
}

/// Carry out one `node.update`, from waiting for the window to the restart.
pub async fn install(
    update: UpdatePayload,
    source: Arc<StatusSource>,
    data_dir: Option<PathBuf>,
    stop: Arc<watch::Sender<StopReason>>,
) {
    let Some(data_dir) = data_dir else {
        tracing::warn!("update ignored: this node has no data directory");
        return;
    };
    if update.version == env!("CARGO_PKG_VERSION") {
        tracing::info!(version = %update.version, "update ignored: already running it");
        return;
    }
    let window = parse_window(update.window.as_deref().unwrap_or(DEFAULT_WINDOW))
        .unwrap_or((23 * 60, 5 * 60));

    // Fetch and verify first, whenever: a download that fails is better found
    // out at noon than at the start of the window.
    let bytes = match fetch(&update.url).await {
        Ok(bytes) => bytes,
        Err(error) => {
            tracing::error!(%error, version = %update.version, "update download failed");
            return;
        }
    };
    if let Err(error) = verify(&bytes, &update) {
        tracing::error!(%error, version = %update.version, "update refused");
        return;
    }
    let staged = data_dir.join("updates").join(format!("store-{}", update.version));
    if let Err(error) = std::fs::create_dir_all(data_dir.join("updates"))
        .and_then(|()| std::fs::write(&staged, &bytes))
    {
        tracing::error!(%error, "cannot stage the update");
        return;
    }
    if cfg!(windows) {
        tracing::warn!(
            version = %update.version,
            path = %staged.display(),
            "update verified and staged; on Windows it is installed by the MSI"
        );
        return;
    }

    // Wait for the window and for every drawer to close.
    let started = tokio::time::Instant::now();
    loop {
        let minute = {
            let now = Local::now();
            now.hour() * 60 + now.minute()
        };
        let collecting = source.clone();
        let open = tokio::task::spawn_blocking(move || collecting.collect().till.open_shifts)
            .await
            .unwrap_or(0);
        if in_window(window, minute) && open == 0 {
            break;
        }
        if started.elapsed() > PATIENCE {
            tracing::warn!(version = %update.version, "update window never came with the drawers closed; giving up");
            return;
        }
        tokio::time::sleep(RECHECK).await;
    }

    let backup = crate::edge::backup::take(&source.connection, &data_dir).ok();
    let executable = installed_executable(&data_dir);
    if let Err(error) = std::fs::create_dir_all(bin_dir(&data_dir)) {
        tracing::error!(%error, "cannot create the bin directory");
        return;
    }
    if executable.exists() {
        let _ = std::fs::rename(&executable, executable.with_extension("old"));
    }
    if let Err(error) = std::fs::copy(&staged, &executable) {
        tracing::error!(%error, "cannot install the update");
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755));
    }
    let pending = Pending {
        from_version: env!("CARGO_PKG_VERSION").to_owned(),
        to_version: update.version.clone(),
        installed_at: Utc::now(),
        backup,
    };
    if let Ok(text) = serde_json::to_string(&pending) {
        let _ = std::fs::write(pending_file(&data_dir), text);
    }
    let _ = std::fs::remove_file(&staged);
    tracing::warn!(version = %update.version, "update installed; restarting into it");
    let _ = stop.send(StopReason::Restart);
}

async fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download answered {}", response.status()));
    }
    Ok(response.bytes().await.map_err(|error| error.to_string())?.to_vec())
}
