//! A store server leaving its PC (24 Oct 2026).
//!
//! Head office decides when a shop's server may go, and nothing the shop did
//! goes with it:
//!
//! 1. Head office asks for **Prepare for removal** on the store's page
//!    (`node.prepare_removal`, `edge/ops.rs`). The node sends what is waiting,
//!    then reads [`Readiness`]: nothing unsent, no cash drawer open, no basket
//!    held at a till. When all three hold it writes a release
//!    ([`RELEASE_FILE`]) good for [`RELEASE_FOR`] and reports "Ready to
//!    remove"; otherwise it reports what stands in the way.
//! 2. The uninstaller asks [`may_uninstall`] (`store can-uninstall`): a
//!    connected server needs a release still good AND the same readiness read
//!    again from the database at that moment. A server that never connected
//!    holds nothing of head office's and goes freely — once its own records
//!    are clear too.
//! 3. Removing the program removes its data ([`wipe`]): the database, the
//!    enrolment and its sealed key, the logs. Whatever is unsent by then — a
//!    sale in the seconds between the check and the stop, or everything on a
//!    forced removal (`FORCE_UNINSTALL=1`, `--force` on Linux, for a PC that
//!    can no longer reach head office) — is copied to [`backup_dir`] first:
//!    kept, never lost.
//!
//! Records head office refused (`sync_dead_letter`) are no reason to wait:
//! head office keeps its own copy of every fact it set aside.

use crate::edge::{enrolment, node, EdgeRole};
use chrono::{DateTime, Duration, Local, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Head office's release, in the data directory, written by the node itself.
pub const RELEASE_FILE: &str = "removal-release.json";
/// How long a release stays good: the day a technician has to uninstall.
pub const RELEASE_FOR: Duration = Duration::hours(24);

/// What stands between this server and its removal, read from its database.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct Readiness {
    /// Records head office has not acknowledged yet.
    pub unsent: i64,
    /// When the oldest of them was written.
    pub oldest_unsent: Option<String>,
    /// The tills whose cash drawer is open (a shift not closed).
    pub open_drawers: Vec<String>,
    /// Baskets a cashier held (Tunda) and nobody finished or dropped.
    pub held_baskets: i64,
    /// Records head office refused; it keeps its own copy, so these never
    /// hold a removal back.
    pub refused: i64,
}

impl Readiness {
    pub fn read(connection: &Connection) -> rusqlite::Result<Self> {
        let (unsent, oldest_unsent) = connection.query_row(
            "SELECT count(*), min(f.created_at)
               FROM sync_fact_log f
               LEFT JOIN sync_watermark w
                 ON w.origin_id = f.origin_id AND w.generation = f.generation
              WHERE f.seq > COALESCE(w.durable_seq, 0)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        // A Gudang's database has no tills: no drawer, no basket.
        let open_drawers = connection
            .prepare(
                "SELECT COALESCE(t.label, s.terminal_id)
                   FROM cash_shift s
                   LEFT JOIN edge_terminal t ON t.terminal_id = s.terminal_id
                  WHERE s.status = 'OPEN'
                  ORDER BY 1",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .unwrap_or_default();
        let count =
            |sql: &str| -> i64 { connection.query_row(sql, [], |row| row.get(0)).unwrap_or(0) };
        Ok(Self {
            unsent,
            oldest_unsent,
            open_drawers,
            held_baskets: count("SELECT count(*) FROM held_sale WHERE status = 'HELD'"),
            refused: count("SELECT count(*) FROM sync_dead_letter"),
        })
    }

    /// The database of the installed node, read-only; empty when there is
    /// none (a machine that never started has nothing to keep).
    pub fn read_installed(role: EdgeRole, data_dir: &Path) -> Result<Self, String> {
        let Some(path) = database_path(role, data_dir) else {
            return Ok(Self::default());
        };
        let connection = Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| format!("cannot open {}: {error}", path.display()))?;
        let _ = connection.busy_timeout(std::time::Duration::from_secs(5));
        Self::read(&connection).map_err(|error| format!("cannot read {}: {error}", path.display()))
    }

    /// Whether anything here would be lost with the data.
    pub fn holds_anything(&self) -> bool {
        self.unsent > 0 || self.held_baskets > 0
    }

    /// What stands in the way, one sentence each, in the words the person at
    /// the PC (or head office, in the action's report) reads.
    pub fn obstacles(&self) -> Vec<String> {
        let mut obstacles = Vec::new();
        if self.unsent > 0 {
            let since = self
                .oldest_unsent
                .as_deref()
                .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                .map(|at| ago(Utc::now() - at.with_timezone(&Utc)))
                .map(|ago| format!(", the oldest from {ago}"))
                .unwrap_or_default();
            obstacles.push(format!(
                "{} {} not reached Central yet{since}: connect this PC to the internet and let \
                 them send.",
                self.unsent,
                if self.unsent == 1 {
                    "record has"
                } else {
                    "records have"
                }
            ));
        }
        if !self.open_drawers.is_empty() {
            let n = self.open_drawers.len();
            obstacles.push(format!(
                "{n} cash {} still open ({}): close the {} first.",
                if n == 1 { "drawer is" } else { "drawers are" },
                self.open_drawers.join(", "),
                if n == 1 { "shift" } else { "shifts" }
            ));
        }
        if self.held_baskets > 0 {
            obstacles.push(format!(
                "{} held {} at the tills: finish or drop {}.",
                self.held_baskets,
                if self.held_baskets == 1 {
                    "basket"
                } else {
                    "baskets"
                },
                if self.held_baskets == 1 { "it" } else { "them" }
            ));
        }
        obstacles
    }
}

fn ago(span: Duration) -> String {
    match span.num_minutes() {
        m if m < 60 => format!("{} min ago", m.max(0)),
        m if m < 48 * 60 => format!("{} hours ago", m / 60),
        m => format!("{} days ago", m / (24 * 60)),
    }
}

/// Head office letting this server go, for [`RELEASE_FOR`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Release {
    /// The store action that asked for it.
    pub action_id: Option<Uuid>,
    /// Why, in the words of whoever asked.
    pub reason: String,
    pub released_at: DateTime<Utc>,
    pub until: DateTime<Utc>,
}

/// Write the release, replacing any older one.
pub fn write_release(
    data_dir: &Path,
    action_id: Option<Uuid>,
    reason: &str,
) -> Result<Release, String> {
    let now = Utc::now();
    let release = Release {
        action_id,
        reason: reason.to_owned(),
        released_at: now,
        until: now + RELEASE_FOR,
    };
    let text = serde_json::to_string_pretty(&release).map_err(|error| error.to_string())?;
    let path = data_dir.join(RELEASE_FILE);
    std::fs::write(&path, text)
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    Ok(release)
}

/// Take back a release that no longer holds (a later check found something).
pub fn withdraw_release(data_dir: &Path) {
    let _ = std::fs::remove_file(data_dir.join(RELEASE_FILE));
}

/// The release, while it is still good.
pub fn release(data_dir: &Path) -> Option<Release> {
    let text = std::fs::read_to_string(data_dir.join(RELEASE_FILE)).ok()?;
    let release: Release = serde_json::from_str(&text).ok()?;
    (Utc::now() < release.until).then_some(release)
}

/// "Uninstall it before 14:05 tomorrow."
pub fn until_words(release: &Release) -> String {
    let until = release.until.with_timezone(&Local);
    let today = Local::now().date_naive();
    let day = if until.date_naive() == today {
        "today".to_owned()
    } else if until.date_naive() == today.succ_opt().unwrap_or(today) {
        "tomorrow".to_owned()
    } else {
        until.format("%-d %b").to_string()
    };
    format!("{} {day}", until.format("%H:%M"))
}

/// Whether this machine may be uninstalled now: `Ok(())`, or the sentence to
/// show the person at the PC.
pub fn may_uninstall(role: EdgeRole, data_dir: Option<&Path>) -> Result<(), String> {
    let Some(dir) = data_dir.filter(|dir| dir.exists()) else {
        return Ok(());
    };
    let readiness = Readiness::read_installed(role, dir).map_err(|error| {
        format!("Central Store Server cannot read its data ({error}). Ask head office.")
    })?;
    let mut obstacles = readiness.obstacles();
    let connected = dir.join(enrolment::NODE_ENV_FILE).exists();
    if connected && release(dir).is_none() {
        obstacles.insert(
            0,
            "Head office has not released this server. In Central: the store's page → Actions → \
             Prepare for removal; then uninstall within 24 hours."
                .to_owned(),
        );
    }
    if obstacles.is_empty() {
        return Ok(());
    }
    Err(format!(
        "This PC cannot be uninstalled yet.\n\n{}",
        obstacles
            .iter()
            .map(|obstacle| format!("• {obstacle}"))
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

fn database_path(role: EdgeRole, data_dir: &Path) -> Option<PathBuf> {
    let path = std::env::var("INVENTORY_DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_dir.join(node::default_database_file(role)));
    path.exists().then_some(path)
}

/// Remove the installed node's data directory as the program leaves. The
/// service must already be stopped. When anything would be lost with it —
/// the uninstaller's check passed and a sale came in before the stop, or the
/// removal was forced — a copy of the database is kept in [`backup_dir`]
/// first. Returns where the copy went, if one was made.
pub fn wipe(role: EdgeRole, data_dir: Option<&Path>) -> Result<Option<PathBuf>, String> {
    let Some(dir) = data_dir.filter(|dir| dir.exists()) else {
        return Ok(None);
    };
    let readiness = Readiness::read_installed(role, dir).ok();
    let mut kept = None;
    // Unreadable is treated as holding everything: copy it, never guess.
    if readiness.as_ref().is_none_or(Readiness::holds_anything) {
        if let Some(path) = database_path(role, dir) {
            let backups = backup_dir(dir);
            std::fs::create_dir_all(&backups)
                .map_err(|error| format!("cannot create {}: {error}", backups.display()))?;
            restrict(&backups);
            let stem = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "database".to_owned());
            let target = backups.join(format!(
                "{stem}-unsent-{}.sqlite3",
                Utc::now().format("%Y%m%d-%H%M%S")
            ));
            copy_database(&path, &target)?;
            kept = Some(target);
        }
    }
    std::fs::remove_dir_all(dir)
        .map_err(|error| format!("cannot remove {}: {error}", dir.display()))?;
    Ok(kept)
}

/// A consistent copy (`VACUUM INTO`), or the file as it lies when the
/// database will not open.
fn copy_database(from: &Path, to: &Path) -> Result<(), String> {
    let vacuumed = Connection::open_with_flags(from, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|connection| {
            connection.execute("VACUUM INTO ?1", [to.to_string_lossy().into_owned()])
        });
    if vacuumed.is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)
        .map(|_| ())
        .map_err(|error| format!("cannot copy the database to {}: {error}", to.display()))
}

/// Where a copy is kept: `backups` beside the data directory —
/// `%ProgramData%\itulah\backups`, `/var/lib/itulah/backups`.
pub fn backup_dir(data_dir: &Path) -> PathBuf {
    data_dir
        .parent()
        .map(|parent| parent.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"))
}

/// Administrators and SYSTEM only, like the data directory itself
/// (`winservice.rs`): the copy holds the shop's users, PIN hashes and
/// fingerprints. On Linux `/var/lib/itulah` is the node's own, mode 0700.
#[cfg(windows)]
fn restrict(dir: &Path) {
    let restricted = std::process::Command::new("icacls")
        .arg(dir)
        .args([
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if !restricted {
        eprintln!(
            "warning: could not restrict {}; restrict it by hand",
            dir.display()
        );
    }
}

#[cfg(not(windows))]
fn restrict(_dir: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn database(dir: &Path) -> Connection {
        let connection = Connection::open(dir.join(node::default_database_file(EdgeRole::Store)))
            .unwrap_or_else(|error| panic!("open: {error}"));
        connection
            .execute_batch(
                "CREATE TABLE sync_fact_log (origin_id TEXT, generation INTEGER, seq INTEGER,
                                             created_at TEXT);
                 CREATE TABLE sync_watermark (origin_id TEXT, generation INTEGER,
                                              durable_seq INTEGER);
                 CREATE TABLE sync_dead_letter (seq INTEGER);
                 CREATE TABLE cash_shift (terminal_id TEXT, status TEXT);
                 CREATE TABLE edge_terminal (terminal_id TEXT, label TEXT);
                 CREATE TABLE held_sale (id TEXT, status TEXT);
                 INSERT INTO sync_fact_log VALUES ('o', 1, 1, '2026-10-24T01:00:00Z'),
                                                  ('o', 1, 2, '2026-10-24T02:00:00Z');
                 INSERT INTO sync_watermark VALUES ('o', 1, 2);",
            )
            .unwrap_or_else(|error| panic!("schema: {error}"));
        connection
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("removal-{name}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("data")).unwrap_or_else(|error| panic!("dir: {error}"));
        dir.join("data")
    }

    #[test]
    fn a_machine_that_never_connected_goes_freely_once_its_records_are_clear() {
        let dir = scratch("never");
        drop(database(&dir));
        assert_eq!(may_uninstall(EdgeRole::Store, Some(&dir)), Ok(()));
        assert_eq!(
            may_uninstall(EdgeRole::Store, Some(&dir.join("missing"))),
            Ok(())
        );
        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    #[test]
    fn a_connected_machine_waits_for_head_offices_release_and_a_clear_database() {
        let dir = scratch("connected");
        let connection = database(&dir);
        std::fs::write(dir.join(enrolment::NODE_ENV_FILE), "INVENTORY_SITE_ID=s\n")
            .unwrap_or_else(|error| panic!("env: {error}"));
        let refusal = may_uninstall(EdgeRole::Store, Some(&dir))
            .err()
            .unwrap_or_default();
        assert!(refusal.contains("Prepare for removal"), "{refusal}");

        write_release(&dir, Some(Uuid::new_v4()), "ganti PC")
            .unwrap_or_else(|error| panic!("release: {error}"));
        assert_eq!(may_uninstall(EdgeRole::Store, Some(&dir)), Ok(()));

        // A sale after the release, a drawer opened, a basket held: refused
        // again, each said.
        connection
            .execute_batch(
                "INSERT INTO sync_fact_log VALUES ('o', 1, 3, '2026-10-24T03:00:00Z');
                 INSERT INTO cash_shift VALUES ('term-1', 'OPEN');
                 INSERT INTO edge_terminal VALUES ('term-1', 'Kasir 1');
                 INSERT INTO held_sale VALUES ('h1', 'HELD');
                 INSERT INTO sync_dead_letter VALUES (9);",
            )
            .unwrap_or_else(|error| panic!("later: {error}"));
        let refusal = may_uninstall(EdgeRole::Store, Some(&dir))
            .err()
            .unwrap_or_default();
        assert!(
            refusal.contains("1 record has not reached Central"),
            "{refusal}"
        );
        assert!(refusal.contains("Kasir 1"), "{refusal}");
        assert!(refusal.contains("1 held basket"), "{refusal}");
        assert!(!refusal.contains("Prepare for removal"), "{refusal}");

        // An expired release is no release.
        connection
            .execute_batch(
                "UPDATE sync_watermark SET durable_seq = 3; DELETE FROM cash_shift;
                 DELETE FROM held_sale;",
            )
            .unwrap_or_else(|error| panic!("clear: {error}"));
        let mut old = release(&dir).unwrap_or_else(|| panic!("a release"));
        old.until = Utc::now() - Duration::minutes(1);
        std::fs::write(
            dir.join(RELEASE_FILE),
            serde_json::to_string(&old).unwrap_or_default(),
        )
        .unwrap_or_else(|error| panic!("rewrite: {error}"));
        assert!(may_uninstall(EdgeRole::Store, Some(&dir)).is_err());
        drop(connection);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }

    #[test]
    fn the_data_goes_with_the_program_and_anything_unsent_is_copied_first() {
        let dir = scratch("wipe");
        drop(database(&dir));
        assert_eq!(wipe(EdgeRole::Store, Some(&dir)), Ok(None));
        assert!(!dir.exists());

        let dir = scratch("wipe-unsent");
        let connection = database(&dir);
        connection
            .execute("UPDATE sync_watermark SET durable_seq = 1", [])
            .unwrap_or_else(|error| panic!("unsent: {error}"));
        drop(connection);
        let kept = wipe(EdgeRole::Store, Some(&dir))
            .unwrap_or_else(|error| panic!("wipe: {error}"))
            .unwrap_or_else(|| panic!("a copy"));
        assert!(!dir.exists() && kept.exists(), "{}", kept.display());
        let copy = Connection::open(&kept).unwrap_or_else(|error| panic!("copy: {error}"));
        let unsent = Readiness::read(&copy).map(|r| r.unsent).unwrap_or(-1);
        assert_eq!(unsent, 1);
        let _ = std::fs::remove_dir_all(dir.parent().unwrap_or(&dir));
    }
}
