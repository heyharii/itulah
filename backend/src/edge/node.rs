//! Running a store node unattended: the lifecycle around the router.
//!
//! `bin/store.rs` used to be the whole of this — read the environment, open
//! the database, serve. That is enough for a developer's terminal. A node in a
//! shop runs for months with nobody watching, so it also has to:
//!
//! - **say how the last run ended** — cleanly, killed by its own watchdog, or
//!   gone without a word (a crash, or the power), and when;
//! - **notice a hang**, not only a crash: a process that is alive but stuck
//!   answers nobody and is never restarted by a supervisor that only watches
//!   for exits;
//! - **refuse to spin** when it keeps dying: five starts in ten minutes and it
//!   holds for five minutes before trying again, so a bad disk or a broken
//!   update does not become a machine at 100 % CPU forever;
//! - **write all of that down** where a screen can read it (`incidents.ndjson`).
//!
//! The supervisor — systemd on Linux, the Service Control Manager on Windows —
//! is still what restarts the process. This module makes sure each restart is
//! explained, and that "restarted" never silently means "stuck".
//!
//! Everything here is inert without a data directory, which is how
//! `cargo run --bin store` keeps behaving exactly as it did.

use crate::edge::console::{self, StopReason};
use crate::edge::heartbeat;
use crate::edge::status::StatusSource;
use crate::edge::{
    dc_router_with_sync, enrolment, store_router_with_sync, EdgeAuth, EdgeAuthConfig, EdgeRole,
    NodeContext, SiteId, SqliteEdge,
};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    io::Write as _,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc,
    },
    time::Duration,
};

/// How long the node may go without proving it is alive before its own
/// watchdog ends it. Long enough that a big catalogue chunk being applied is
/// not mistaken for a hang; short enough that a stuck till is back inside two
/// minutes.
pub const HANG_TIMEOUT: Duration = Duration::from_secs(120);

/// [`HANG_TIMEOUT`], unless `ITULAH_HANG_TIMEOUT_SECONDS` says otherwise — a
/// node on a slow disk may need longer. Never under 30 s: shorter than a
/// busy moment is a watchdog that kills healthy nodes.
fn hang_timeout() -> i64 {
    std::env::var("ITULAH_HANG_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .map_or(HANG_TIMEOUT.as_secs() as i64, |seconds| seconds.max(30))
}
/// How often the node proves it is alive.
const BEAT_INTERVAL: Duration = Duration::from_secs(10);
/// Starts inside this window that make a crash loop.
pub const CRASH_LOOP_WINDOW_MINUTES: i64 = 10;
pub const CRASH_LOOP_STARTS: usize = 5;
/// How long a node in a crash loop waits before trying again. Not forever:
/// the cause is often outside the process (a full disk, a network share, a
/// clock) and fixes itself, and a node that gave up permanently needs a person
/// to notice that it gave up.
pub const CRASH_LOOP_HOLD: Duration = Duration::from_secs(5 * 60);

const INCIDENTS_FILE: &str = "incidents.ndjson";
const MARKER_FILE: &str = "running.json";
const STARTS_FILE: &str = "starts.json";
/// Incidents kept. Old ones are dropped from the front when the journal is
/// rewritten; the log files keep the detail.
const INCIDENTS_KEPT: usize = 2_000;

/// Where an installed node keeps everything it owns.
///
/// `ITULAH_DATA_DIR` when set — the Linux unit and the Windows installer both
/// set it. A Windows service started without it falls back to
/// `%ProgramData%\itulah\store` (a Gudang's node to `…\dc`), so a service
/// registered by hand still has a home.
pub fn installed_data_dir(role: EdgeRole, running_as_service: bool) -> Option<PathBuf> {
    if let Some(dir) = enrolment::data_dir() {
        return Some(dir);
    }
    if running_as_service {
        if let Some(program_data) = std::env::var_os("ProgramData") {
            return Some(
                PathBuf::from(program_data)
                    .join("itulah")
                    .join(role_directory(role)),
            );
        }
    }
    None
}

/// The directory name a role's node owns under `itulah/`, and the default
/// database file inside it. One name per role so a shop and the Gudang on one
/// machine cannot open each other's data — which they did while both used
/// `store-edge.sqlite3`.
const fn role_directory(role: EdgeRole) -> &'static str {
    match role {
        EdgeRole::Dc => "dc",
        EdgeRole::Store => "store",
    }
}

/// The database file a role opens when `INVENTORY_DATABASE_PATH` is unset.
pub const fn default_database_file(role: EdgeRole) -> &'static str {
    match role {
        EdgeRole::Dc => "dc-edge.sqlite3",
        EdgeRole::Store => "store-edge.sqlite3",
    }
}

/// The role this process is running as, read from its own database.
///
/// `node_metadata` is written when the node opens and refused when it
/// disagrees with the environment (`edge/sqlite.rs`), so it is the node's own
/// answer rather than the environment's. The console and the operations runner
/// hold a connection and no `NodeContext`, and both need it to say what they
/// are diagnosing — a diagnosis that calls a Gudang "a shop's node" is the
/// kind of wrong that costs an hour on the phone.
pub fn resident_role(connection: &rusqlite::Connection) -> EdgeRole {
    connection
        .query_row(
            "SELECT role FROM node_metadata WHERE singleton = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|role| role.parse::<EdgeRole>().ok())
        .unwrap_or(EdgeRole::Store)
}

/// The port a role's node listens on when nothing sets `BIND_ADDR`, `PORT` or
/// `INVENTORY_BIND_ADDR`: the Gudang below its shops, as `backend/README.md`
/// states it, as `deploy/edge/*.env.example` writes it, and as the Windows
/// installer's shortcuts already open it (`deploy/windows/store.wxs`).
pub const fn default_port(role: EdgeRole) -> u16 {
    match role {
        EdgeRole::Dc => 8081,
        EdgeRole::Store => 8082,
    }
}

/// Load configuration the way this node is meant to be configured.
///
/// Installed, a node is configured by its real environment and its own
/// `node.env`, and by nothing else: `dotenv()` searches every parent directory
/// for a `.env`, so a service started anywhere under a developer's checkout
/// would otherwise inherit whichever node that file describes — the cloud's
/// identity, on the first machine this was tried on. A developer's run keeps
/// reading `.env` as before.
pub fn prepare_environment(
    data_dir: Option<&Path>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match data_dir {
        Some(dir) => {
            enrolment::load_node_env(dir)?;
        }
        None => {
            dotenvy::dotenv().ok();
        }
    }
    Ok(())
}

/// Colour codes only for a person at a terminal. Under systemd or the Windows
/// SCM, stdout is a journal, and `\x1b[32m INFO` is noise in every line.
fn interactive() -> bool {
    use std::io::IsTerminal as _;
    std::io::stdout().is_terminal()
}

/// Log to the terminal always, and — installed — to a daily file as well, one
/// JSON object per line, fourteen days kept. The guard must live as long as
/// the process or the last lines are lost.
pub fn init_logging(
    role: EdgeRole,
    data_dir: Option<&Path>,
) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::{
        fmt, layer::SubscriberExt as _, util::SubscriberInitExt as _, EnvFilter,
    };
    let filter = || EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let appender = data_dir.map(|dir| {
        tracing_appender::rolling::Builder::new()
            .rotation(tracing_appender::rolling::Rotation::DAILY)
            .filename_prefix(role_directory(role))
            .filename_suffix("ndjson")
            .max_log_files(14)
            .build(dir.join("logs"))
    });
    match appender {
        Some(Ok(appender)) => {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            tracing_subscriber::registry()
                .with(filter())
                .with(fmt::layer().with_ansi(interactive()))
                .with(fmt::layer().json().with_writer(writer))
                .init();
            Some(guard)
        }
        other => {
            tracing_subscriber::registry()
                .with(filter())
                .with(fmt::layer().with_ansi(interactive()))
                .init();
            if let Some(Err(error)) = other {
                tracing::error!(%error, "cannot open the log directory; logging to the terminal only");
            }
            None
        }
    }
}

// ---- What happened, written down ------------------------------------------

// `Incident` and `PreviousExit` live in `crate::sync::node_status`, shared
// with the cloud that receives them in the heartbeat.
pub use crate::sync::node_status::{Incident, PreviousExit};

/// The run marker: present while the node runs, rewritten with each proof of
/// life, removed on a clean stop.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Marker {
    started: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    /// Set just before the watchdog ends the process, so the next start can
    /// tell a hang from a crash.
    #[serde(default)]
    hung: bool,
}

/// The journal of incidents, append-only, one JSON object per line.
#[derive(Clone)]
pub struct Journal {
    dir: PathBuf,
}

impl Journal {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
        }
    }

    pub fn record(&self, incident: &Incident) {
        let path = self.dir.join(INCIDENTS_FILE);
        let line = match serde_json::to_string(incident) {
            Ok(line) => line,
            Err(_) => return,
        };
        let appended = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| writeln!(file, "{line}"));
        if let Err(error) = appended {
            tracing::warn!(%error, "cannot write the incident journal");
        }
        tracing::info!(incident = %line, "incident");
    }

    /// The newest incidents, newest last.
    pub fn recent(&self, limit: usize) -> Vec<Incident> {
        let Ok(text) = std::fs::read_to_string(self.dir.join(INCIDENTS_FILE)) else {
            return Vec::new();
        };
        let all: Vec<Incident> = text
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        let skip = all.len().saturating_sub(limit);
        all.into_iter().skip(skip).collect()
    }

    /// Keep the journal bounded. Run at start, when nothing else writes.
    fn compact(&self) {
        let recent = self.recent(INCIDENTS_KEPT);
        if recent.len() < INCIDENTS_KEPT {
            return;
        }
        let text: String = recent
            .iter()
            .filter_map(|incident| serde_json::to_string(incident).ok())
            .map(|line| line + "\n")
            .collect();
        let _ = std::fs::write(self.dir.join(INCIDENTS_FILE), text);
    }
}

/// How long the machine has been up, where the platform says so cheaply.
fn machine_booted_at(now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    #[cfg(target_os = "linux")]
    {
        let text = std::fs::read_to_string("/proc/uptime").ok()?;
        let seconds: f64 = text.split_whitespace().next()?.parse().ok()?;
        return Some(now - ChronoDuration::milliseconds((seconds * 1000.0) as i64));
    }
    #[allow(unreachable_code)]
    {
        let _ = now;
        None
    }
}

/// Classify the previous run from the marker it left, if any.
fn previous_exit(
    marker: Option<Marker>,
    last_clean_stop: Option<DateTime<Utc>>,
    booted_at: Option<DateTime<Utc>>,
) -> PreviousExit {
    match marker {
        Some(marker) if marker.hung => PreviousExit::Hung {
            at: marker.last_seen,
        },
        Some(marker) => PreviousExit::Unclean {
            last_seen: marker.last_seen,
            machine_restarted: booted_at.map(|booted| booted > marker.last_seen),
        },
        None => match last_clean_stop {
            Some(at) => PreviousExit::Clean { at },
            None => PreviousExit::FirstStart,
        },
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) {
    if let Ok(text) = serde_json::to_string(value) {
        let temporary = path.with_extension("tmp");
        if std::fs::write(&temporary, text).is_ok() {
            let _ = std::fs::rename(&temporary, path);
        }
    }
}

/// Starts recorded inside the crash-loop window, this one included.
fn starts_in_window(mut starts: Vec<DateTime<Utc>>, now: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let since = now - ChronoDuration::minutes(CRASH_LOOP_WINDOW_MINUTES);
    starts.retain(|start| *start > since && *start <= now);
    starts.push(now);
    starts
}

// ---- Proof of life ---------------------------------------------------------

/// The last moment the node proved it could still do work.
#[derive(Clone)]
pub struct Liveness {
    last_beat: Arc<AtomicI64>,
}

impl Default for Liveness {
    fn default() -> Self {
        Self::new()
    }
}

impl Liveness {
    pub fn new() -> Self {
        Self {
            last_beat: Arc::new(AtomicI64::new(Utc::now().timestamp())),
        }
    }

    pub fn beat(&self) {
        self.last_beat
            .store(Utc::now().timestamp(), Ordering::Relaxed);
    }

    pub fn stalled_for(&self) -> i64 {
        Utc::now().timestamp() - self.last_beat.load(Ordering::Relaxed)
    }
}

/// Tell systemd something, when systemd is listening. A no-op everywhere else.
///
/// The protocol is one datagram to `$NOTIFY_SOCKET`; written here rather than
/// taken from a crate because it is five lines and it is the only thing the
/// node needs from systemd.
pub fn sd_notify(state: &str) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::net::UnixDatagram;
        let Some(path) = std::env::var_os("NOTIFY_SOCKET") else {
            return;
        };
        let Ok(socket) = UnixDatagram::unbound() else {
            return;
        };
        let bytes = path.as_encoded_bytes();
        let sent = if let Some(name) = bytes.strip_prefix(b"@") {
            use std::os::linux::net::SocketAddrExt as _;
            std::os::unix::net::SocketAddr::from_abstract_name(name)
                .and_then(|address| socket.send_to_addr(state.as_bytes(), &address))
        } else {
            socket.send_to(state.as_bytes(), &path)
        };
        let _ = sent;
    }
    #[cfg(not(target_os = "linux"))]
    let _ = state;
}

/// Prove the node alive every few seconds by doing real work: taking the
/// database lock and asking it something. A deadlocked mutex or a wedged
/// runtime stops the beat, which is exactly what the watchdog is for.
fn spawn_beats(
    liveness: Liveness,
    connection: Option<Arc<std::sync::Mutex<rusqlite::Connection>>>,
) {
    // A development build can be told to stop proving itself alive after a
    // while, which is the only honest way to watch the watchdog work. Release
    // builds do not read the variable at all.
    let simulate_hang_after = if cfg!(debug_assertions) {
        std::env::var("ITULAH_SIMULATE_HANG_AFTER")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(|seconds| tokio::time::Instant::now() + Duration::from_secs(seconds))
    } else {
        None
    };
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(BEAT_INTERVAL);
        loop {
            interval.tick().await;
            if simulate_hang_after.is_some_and(|at| tokio::time::Instant::now() >= at) {
                continue;
            }
            let healthy = match &connection {
                None => true,
                Some(connection) => {
                    let connection = connection.clone();
                    tokio::task::spawn_blocking(move || {
                        connection
                            .lock()
                            .ok()
                            .and_then(|guard| {
                                guard
                                    .query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                                    .ok()
                            })
                            .is_some()
                    })
                    .await
                    .unwrap_or(false)
                }
            };
            if healthy {
                liveness.beat();
            }
        }
    });
}

/// The watchdog, on its own OS thread so a wedged async runtime cannot stop
/// it. Also where the run marker is refreshed and systemd is fed.
fn spawn_watchdog(
    liveness: Liveness,
    dir: Option<PathBuf>,
    journal: Option<Journal>,
    started: DateTime<Utc>,
) {
    std::thread::Builder::new()
        .name("watchdog".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(5));
            let stalled = liveness.stalled_for();
            if stalled >= hang_timeout() {
                let now = Utc::now();
                if let Some(dir) = &dir {
                    write_json(
                        &dir.join(MARKER_FILE),
                        &Marker {
                            started,
                            last_seen: now - ChronoDuration::seconds(stalled),
                            hung: true,
                        },
                    );
                }
                if let Some(journal) = &journal {
                    journal.record(&Incident::Hung {
                        at: now,
                        stalled_seconds: stalled,
                    });
                }
                tracing::error!(
                    stalled,
                    "no proof of life: ending the process so the supervisor restarts it"
                );
                // 70 = EX_SOFTWARE. Non-zero, so both supervisors treat it as
                // a failure and apply their restart action.
                std::process::exit(70);
            }
            // Only a live node feeds systemd's own watchdog, so if this
            // thread ever dies with the rest, systemd notices too.
            sd_notify("WATCHDOG=1");
            if let Some(dir) = &dir {
                write_json(
                    &dir.join(MARKER_FILE),
                    &Marker {
                        started,
                        last_seen: Utc::now() - ChronoDuration::seconds(stalled),
                        hung: false,
                    },
                );
            }
        })
        .expect("spawning the watchdog thread");
}

// ---- The node ----------------------------------------------------------------

/// Run a node until `shutdown` resolves.
///
/// `default_role` is what this binary serves when `INVENTORY_NODE_ROLE` is
/// unset: `store` runs a shop's node, `dc` runs the Gudang's. The role decides
/// the routes, the default port, the database file and the log line — one
/// runtime, two callers (`edge::cli`).
///
/// `data_dir` is `Some` for an installed node and `None` for a developer's
/// run; everything unattended hangs off it.
pub async fn run(
    default_role: EdgeRole,
    data_dir: Option<PathBuf>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<Exit, Box<dyn std::error::Error + Send + Sync>> {
    let now = Utc::now();
    let journal = data_dir.as_deref().map(Journal::new);
    let liveness = Liveness::new();
    // One stop request, honoured whichever phase the node is in — holding
    // after a crash loop, waiting to be enrolled, or serving. A stop that
    // arrived while holding used to kill the process mid-wait and be recorded
    // next time as a crash.
    // The console can ask for a restart through the same channel.
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(StopReason::Running);
    let stop_tx = Arc::new(stop_tx);
    {
        let stop_tx = stop_tx.clone();
        tokio::spawn(async move {
            shutdown.await;
            let _ = stop_tx.send(StopReason::Stop);
        });
    }
    let reason = {
        let stop_rx = stop_rx.clone();
        move || *stop_rx.borrow()
    };
    let stopping = move || {
        let mut rx = stop_rx.clone();
        async move {
            let _ = rx.wait_for(|reason| *reason != StopReason::Running).await;
        }
    };
    let port = default_port(default_role);
    let bind: SocketAddr = match (&data_dir, std::env::var("BIND_ADDR").ok()) {
        // An installed node serves the shop's tills over the LAN; the
        // firewall rule the installer writes keeps it off anything else.
        (Some(_), None) if std::env::var("PORT").is_err() => {
            format!("0.0.0.0:{port}").parse()?
        }
        _ => crate::bind_addr(port)?,
    };

    if let (Some(dir), Some(journal)) = (&data_dir, &journal) {
        std::fs::create_dir_all(dir)?;
        journal.compact();
        let marker: Option<Marker> = read_json(&dir.join(MARKER_FILE));
        let last_clean_stop =
            journal
                .recent(50)
                .into_iter()
                .rev()
                .find_map(|incident| match incident {
                    Incident::Stopped { at, .. } => Some(at),
                    Incident::Started { .. } => Some(DateTime::<Utc>::MIN_UTC),
                    _ => None,
                });
        let last_clean_stop = last_clean_stop.filter(|at| *at != DateTime::<Utc>::MIN_UTC);
        let previous = previous_exit(marker, last_clean_stop, machine_booted_at(now));
        // A deliberate stop — an update, a person restarting it — is not a
        // crash, and must not bring the node closer to holding itself back.
        let healthy_before = matches!(
            previous,
            PreviousExit::Clean { .. } | PreviousExit::FirstStart
        );
        // An update on trial that the last run did not survive is rolled back
        // here, and the node restarts into the build it had before.
        if crate::edge::update::settle(dir, journal, !healthy_before) {
            return Ok(Exit::Restart);
        }
        journal.record(&Incident::Started {
            at: now,
            version: env!("CARGO_PKG_VERSION").to_owned(),
            previous,
        });
        let history = if healthy_before {
            Vec::new()
        } else {
            read_json(&dir.join(STARTS_FILE)).unwrap_or_default()
        };
        let starts = starts_in_window(history, now);
        write_json(&dir.join(STARTS_FILE), &starts);
        if starts.len() >= CRASH_LOOP_STARTS {
            let retry_at = now + ChronoDuration::seconds(CRASH_LOOP_HOLD.as_secs() as i64);
            journal.record(&Incident::CrashLoop {
                at: now,
                starts_in_window: starts.len(),
                hold_seconds: CRASH_LOOP_HOLD.as_secs() as i64,
            });
            tracing::error!(
                starts = starts.len(),
                %retry_at,
                "crash loop: holding before the next attempt"
            );
            // Ready and alive while holding, so neither supervisor kills the
            // wait itself and turns it into one more crash.
            sd_notify("READY=1\nSTATUS=Crash loop: holding before the next attempt");
            spawn_watchdog(liveness.clone(), None, None, now);
            if hold_with_an_explanation(bind, retry_at, starts.len(), &liveness, stopping()).await {
                stopped_cleanly(dir, journal, "asked to stop");
                return Ok(Exit::Stopped);
            }
        }
    }

    if let (Some(dir), Some(journal)) = (&data_dir, &journal) {
        if !enrolment::is_enrolled() {
            journal.record(&Incident::AwaitingEnrolment { at: Utc::now() });
            sd_notify("READY=1\nSTATUS=Waiting to be enrolled: open /setup on this machine");
            spawn_beats(liveness.clone(), None);
            spawn_watchdog(liveness.clone(), Some(dir.clone()), None, now);
            // The cloud's address for the setup page: configured, or baked
            // into the build a shop downloads, so nobody has to type it.
            let cloud = std::env::var("ITULAH_CLOUD_URL")
                .ok()
                .or_else(|| option_env!("ITULAH_DEFAULT_CLOUD_URL").map(str::to_owned));
            if !enrolment::run_setup(dir.clone(), bind, cloud, stopping()).await? {
                stopped_cleanly(dir, journal, "asked to stop");
                return Ok(Exit::Stopped);
            }
            enrolment::load_node_env(dir)?;
            journal.record(&Incident::Enrolled {
                at: Utc::now(),
                site_id: std::env::var("INVENTORY_SITE_ID").unwrap_or_default(),
            });
        }
    }

    let site_id = SiteId::new(
        std::env::var("INVENTORY_SITE_ID").unwrap_or_else(|_| match default_role {
            EdgeRole::Dc => "dc-01".into(),
            EdgeRole::Store => "store-07".into(),
        }),
    )?;
    let node_id = std::env::var("INVENTORY_NODE_ID").unwrap_or_else(|_| format!("{site_id}-edge"));
    // What head office enrolled this machine as: a shop's server or the
    // Gudang's. One program serves both; the routes follow the role. A
    // node.env from before the role was written down is a shop's — and a
    // `dc` binary that finds no role runs the Gudang's, not a shop's.
    let role = match std::env::var("INVENTORY_NODE_ROLE") {
        Ok(role) if !role.trim().is_empty() => role.trim().parse::<EdgeRole>()?,
        _ => default_role,
    };
    let node = NodeContext::new(node_id, role, site_id)?;
    // Kept for the LAN advertisement, which starts once the listener is up.
    let lan_identity = node.clone();
    let generation = crate::edge::sync::EdgeSyncConfig::generation_from_env()?;
    let database = std::env::var("INVENTORY_DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| match &data_dir {
            Some(dir) => dir.join(default_database_file(role)),
            None => PathBuf::from(format!("./{}", default_database_file(role))),
        });
    let frontend = std::env::var("FRONTEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_frontend_dir(data_dir.is_some()));
    let inventory = Arc::new(SqliteEdge::open(database.clone(), node.clone())?);
    let auth = Arc::new(EdgeAuth::new(
        inventory.connection(),
        node,
        EdgeAuthConfig::from_env()?,
    )?);
    inventory.configure_sync_generation(generation)?;
    // Capture is always enabled. The optional sender uploads the durable
    // backlog and receives downstream commands over the shared cycle.
    let sync = match crate::edge::sync::EdgeSyncConfig::from_env()? {
        Some(config) => Some(crate::edge::sync::spawn_agent(&inventory, config)?),
        None => {
            tracing::warn!(
                "SYNC_UPLOAD_URL is unset: capture continues locally and only the sender is disabled"
            );
            None
        }
    };

    if data_dir.is_some() || std::env::var_os("NOTIFY_SOCKET").is_some() {
        spawn_beats(liveness.clone(), Some(inventory.connection()));
        spawn_watchdog(liveness.clone(), data_dir.clone(), journal.clone(), now);
    }

    let sync_for_power = sync.clone();
    // What the console shows and the heartbeat sends: one collector.
    let source = Arc::new(StatusSource::new(
        inventory.connection(),
        sync.clone(),
        data_dir.clone(),
        database,
        now,
    ));
    heartbeat::spawn(source.clone());
    // Test pages head office asks of this node's network printers
    // (`device.test_print.v1`); a till prints its own.
    crate::edge::devices::spawn_test_printer(inventory.connection());
    crate::edge::ops::spawn_runner(source.clone(), data_dir.clone(), stop_tx.clone());
    if let Some(dir) = &data_dir {
        crate::edge::update::watch_trial(source.clone(), dir.clone());
    }
    crate::edge::pace::spawn_monitor();
    crate::edge::power::spawn_monitor(sync_for_power, journal.clone());
    if let Some(dir) = &data_dir {
        crate::edge::backup::spawn(inventory.connection(), dir.clone());
    }

    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, %role, "Edge node running independently with SQLite");
    // Tills, tablets and handhelds on the LAN find this node by browsing for
    // it (`edge/discovery.rs`), and read the shop's code and name off it from
    // the site directory. Held to the end of this function: dropping it says
    // goodbye on the network.
    let _advertisement =
        crate::edge::discovery::advertise(&lan_identity, inventory.connection(), bind);
    sd_notify("READY=1\nSTATUS=Serving");
    let routes = match role {
        EdgeRole::Dc => dc_router_with_sync(inventory.clone(), auth, frontend, sync)?,
        EdgeRole::Store => store_router_with_sync(inventory.clone(), auth, frontend, sync)?,
    };
    let router = routes.merge(console::router(console::Console {
        source,
        data_dir: data_dir.clone(),
        stop: stop_tx.clone(),
    }));
    // With the caller's address, which is how the console knows a request
    // came from the machine itself.
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(stopping())
    .await?;

    // Stopped on request. Fold the write-ahead log into the database so a
    // copy of the file taken now is whole, then say so.
    sd_notify("STOPPING=1");
    if let Ok(guard) = inventory.connection().lock() {
        let _ = guard.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
    let exit = match reason() {
        StopReason::Restart => Exit::Restart,
        _ => Exit::Stopped,
    };
    if let (Some(dir), Some(journal)) = (&data_dir, &journal) {
        stopped_cleanly(
            dir,
            journal,
            match exit {
                Exit::Restart => "restart requested from the console",
                Exit::Stopped => "asked to stop",
            },
        );
    }
    Ok(exit)
}

/// How a run ended when it ended on request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Stopped,
    /// The console asked for a restart. The caller exits with
    /// [`RESTART_EXIT_CODE`] so the supervisor starts the node again —
    /// systemd restarts on any exit, the Windows SCM on a non-zero one.
    Restart,
}

/// EX_TEMPFAIL: "try again", which is exactly what a restart asks.
pub const RESTART_EXIT_CODE: i32 = 75;

/// Write down that the node stopped because it was asked to, so the next
/// start does not call it a crash.
fn stopped_cleanly(dir: &Path, journal: &Journal, reason: &str) {
    sd_notify("STOPPING=1");
    journal.record(&Incident::Stopped {
        at: Utc::now(),
        reason: reason.into(),
    });
    let _ = std::fs::remove_file(dir.join(MARKER_FILE));
}

/// Hold back after a crash loop, but answer while doing it.
///
/// A port that refuses connections tells a cashier nothing; a till that gets
/// "the server is holding back after repeated failures, trying again at 14:05"
/// can say so. Every request is answered 503 with that sentence — JSON under
/// `/api`, a page anywhere else — until the hold ends and the node tries to
/// start properly again.
async fn hold_with_an_explanation(
    bind: SocketAddr,
    retry_at: DateTime<Utc>,
    starts: usize,
    liveness: &Liveness,
    stop: impl Future<Output = ()> + Send + 'static,
) -> bool {
    use axum::{
        http::{StatusCode, Uri},
        response::{Html, IntoResponse, Response},
        Json, Router,
    };
    let answer = move |uri: Uri| async move {
        let local = retry_at.with_timezone(&chrono::Local).format("%H:%M");
        let saying = format!(
            "The store server is paused after failing to start {starts} times in a row. \
             It tries again by itself at {local}. Head office has been told."
        );
        let response: Response = if uri.path().starts_with("/api") {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "state": "CRASH_LOOP_HOLD",
                    "retry_at": retry_at,
                    "starts_in_window": starts,
                    "message": saying,
                })),
            )
                .into_response()
        } else {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Html(format!(
                    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>\
                     <meta http-equiv=refresh content=30><title>Store server</title>\
                     <body style='font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 16px'>\
                     <h1 style='font-size:20px'>Store server paused</h1><p>{saying}</p>\
                     <p style='color:#777'>This page refreshes itself.</p>"
                )),
            )
                .into_response()
        };
        response
    };
    let router = Router::new().fallback(answer);
    let deadline = tokio::time::Instant::now() + CRASH_LOOP_HOLD;
    let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let beating = {
        let liveness = liveness.clone();
        let stopped = stopped.clone();
        async move {
            let hold = async {
                while tokio::time::Instant::now() < deadline {
                    liveness.beat();
                    tokio::time::sleep(BEAT_INTERVAL).await;
                }
            };
            tokio::select! {
                _ = hold => {}
                _ = stop => stopped.store(true, Ordering::SeqCst),
            }
        }
    };
    match tokio::net::TcpListener::bind(bind).await {
        Ok(listener) => {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(beating)
                .await;
        }
        // The port is taken — perhaps by the very process that keeps dying.
        // Hold quietly then; there is nothing better to answer with.
        Err(_) => beating.await,
    }
    stopped.load(Ordering::SeqCst)
}

/// Where a node looks for the browser surface it serves beside its API.
///
/// An installed node carries its own under `<exe>/web`. A deployment that
/// serves the app from a static host names one explicitly — `render.yaml`
/// points `FRONTEND_DIR` at `/app/api-only`, which holds nothing on purpose,
/// because the static site owns the browser and the node owns `/api/*`. A
/// developer's run serves none either: the app runs on its own Vite server and
/// proxies `/api` here. This default therefore names a directory that holds
/// nothing, and a request for a page this node does not have gets the 404 it
/// should. It used to say `../frontend`, an application that no longer exists.
fn default_frontend_dir(installed: bool) -> PathBuf {
    if installed {
        if let Some(dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.join("web")))
        {
            return dir;
        }
    }
    PathBuf::from("../api-only")
}

/// Ctrl-C, or SIGTERM from systemd.
pub async fn terminal_or_supervisor_stop() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("stop requested");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap_or_default()
            + ChronoDuration::minutes(minutes)
    }

    #[test]
    fn a_fresh_install_has_no_previous_run() {
        assert_eq!(previous_exit(None, None, None), PreviousExit::FirstStart);
    }

    #[test]
    fn a_clean_stop_is_remembered_by_the_journal_not_the_marker() {
        assert_eq!(
            previous_exit(None, Some(at(0)), None),
            PreviousExit::Clean { at: at(0) }
        );
    }

    #[test]
    fn a_marker_left_behind_is_a_crash_or_the_power_and_the_boot_time_says_which() {
        let marker = || Marker {
            started: at(0),
            last_seen: at(30),
            hung: false,
        };
        // The machine booted after the node was last seen: power or reboot.
        assert_eq!(
            previous_exit(Some(marker()), None, Some(at(40))),
            PreviousExit::Unclean {
                last_seen: at(30),
                machine_restarted: Some(true)
            }
        );
        // The machine has been up since before: the process died on its own.
        assert_eq!(
            previous_exit(Some(marker()), None, Some(at(-600))),
            PreviousExit::Unclean {
                last_seen: at(30),
                machine_restarted: Some(false)
            }
        );
        // A platform that cannot say.
        assert_eq!(
            previous_exit(Some(marker()), None, None),
            PreviousExit::Unclean {
                last_seen: at(30),
                machine_restarted: None
            }
        );
    }

    #[test]
    fn the_watchdog_marks_its_own_kill_so_it_is_not_called_a_crash() {
        let marker = Marker {
            started: at(0),
            last_seen: at(5),
            hung: true,
        };
        assert_eq!(
            previous_exit(Some(marker), None, Some(at(40))),
            PreviousExit::Hung { at: at(5) }
        );
    }

    #[test]
    fn five_starts_in_ten_minutes_is_a_loop_and_old_starts_fall_away() {
        let starts = vec![at(0), at(2), at(4), at(6)];
        assert_eq!(starts_in_window(starts.clone(), at(8)).len(), 5);
        // Twenty minutes later only this start is in the window.
        assert_eq!(starts_in_window(starts, at(28)).len(), 1);
    }

    #[test]
    fn the_journal_keeps_what_it_is_told_in_order() {
        let dir = std::env::temp_dir().join(format!("itulah-journal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("dir: {error}"));
        let journal = Journal::new(&dir);
        journal.record(&Incident::AwaitingEnrolment { at: at(0) });
        journal.record(&Incident::Hung {
            at: at(1),
            stalled_seconds: 125,
        });
        assert_eq!(
            journal.recent(10),
            vec![
                Incident::AwaitingEnrolment { at: at(0) },
                Incident::Hung {
                    at: at(1),
                    stalled_seconds: 125
                }
            ]
        );
        assert_eq!(journal.recent(1).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
