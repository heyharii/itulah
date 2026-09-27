//! A store machine joining the fleet, from the machine's side.
//!
//! An installed node that has never been enrolled has no site, no key and no
//! cloud to talk to. Instead of starting half-configured, it serves one page on
//! loopback — `/setup` — where the person installing types the code head
//! office gave them. The node then:
//!
//! 1. mints its own ingest key and claims the code with the key's digest
//!    (`crate::sync::enrolment` has the protocol and why);
//! 2. shows the verification number and waits, polling the cloud, for a person
//!    at head office to approve;
//! 3. writes `node.env` into its data directory and hands over to the normal
//!    startup, which reads that file exactly as it reads any other environment.
//!
//! # Why `node.env` and not a new configuration format
//!
//! Everything a node is configured by is already an environment variable
//! (`EdgeSyncConfig`, `EdgeAuthConfig`, `bin/store.rs`), and the Linux path
//! already keeps them in a file (`/etc/itulah/store.env`). Enrolment writes the
//! same variables into the same kind of file. A real environment variable still
//! wins over the file (`dotenvy` never overrides), so development and the
//! systemd unit behave exactly as before.
//!
//! # State survives a restart
//!
//! The pending claim — the minted key included — is written to the data
//! directory before the number is shown. A machine rebooted while head office
//! is deciding resumes waiting instead of holding a number nobody can approve.
//! Both files are written readable by the owner only; on Windows the installer
//! restricts the data directory itself (STORE-SERVER-PLAN §3).

use crate::edge::EdgeError;
use crate::security;
use crate::sync::enrolment::{
    self, ClaimAnswer, ClaimRequest, MachineFacts, StatusAnswer, StatusRequest,
};
use axum::{
    extract::State,
    http::StatusCode,
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex, Notify};
use uuid::Uuid;

/// Where enrolment writes the node's identity.
pub const NODE_ENV_FILE: &str = "node.env";
const PENDING_FILE: &str = "enrolment.pending.json";
/// A code left for the node to claim by itself on its next start: what a
/// silent install (`msiexec … ENROLL_CODE=…`, `install-store.sh --code …`)
/// writes, so a machine can be enrolled with nobody at its screen. First line
/// the code, optional second line the cloud's address.
pub const STAGED_CODE_FILE: &str = "enroll.code";

/// Leave a code for the node to claim on its next start.
pub fn stage_code(dir: &Path, code: &str, cloud_url: Option<&str>) -> Result<(), EdgeError> {
    if enrolment::normalise_code(code).is_none() {
        return Err(EdgeError::Configuration(format!(
            "{code:?} is not an enrolment code (expected XXXXX-XXXXX)"
        )));
    }
    std::fs::create_dir_all(dir).map_err(|error| {
        EdgeError::Persistence(format!("cannot create {}: {error}", dir.display()))
    })?;
    let mut contents = format!("{}\n", code.trim());
    if let Some(url) = cloud_url {
        contents.push_str(url.trim());
        contents.push('\n');
    }
    write_private(&dir.join(STAGED_CODE_FILE), &contents)
}
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// The installed node's data directory, when it is running installed.
///
/// Set by the installer (and the service unit). Its absence is how a
/// developer's `cargo run --bin store` keeps its old defaults: no data
/// directory, no setup mode.
pub fn data_dir() -> Option<PathBuf> {
    std::env::var_os("ITULAH_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Load `node.env` from the data directory into the environment, without
/// overriding anything already set. Returns whether there was one.
pub fn load_node_env(dir: &Path) -> Result<bool, EdgeError> {
    let path = dir.join(NODE_ENV_FILE);
    if !path.exists() {
        return Ok(false);
    }
    dotenvy::from_path(&path).map_err(|error| {
        EdgeError::Configuration(format!("cannot read {}: {error}", path.display()))
    })?;
    crate::edge::secret::unseal_environment().map_err(EdgeError::Configuration)?;
    Ok(true)
}

/// Whether this node knows which site it is.
pub fn is_enrolled() -> bool {
    std::env::var("INVENTORY_SITE_ID").is_ok_and(|value| !value.trim().is_empty())
}

/// A claim the cloud accepted and head office has not yet decided.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pending {
    cloud_url: String,
    enrolment_id: Uuid,
    /// The ingest key this machine minted. Never leaves the machine except as
    /// `x-sync-key`, over TLS, to the cloud that holds its digest.
    key: String,
    verification: String,
    site_id: String,
    /// The site as people read it, "C003-TOKO · Purbalingga" — what the setup
    /// page shows. Empty in a claim saved by an older build.
    #[serde(default)]
    site_label: String,
    origin_id: String,
    node_role: String,
}

impl Pending {
    /// The site's label, or its id for a claim saved before labels.
    fn site_label(&self) -> String {
        if self.site_label.trim().is_empty() {
            self.site_id.clone()
        } else {
            self.site_label.clone()
        }
    }

    fn waiting(&self, error: Option<String>) -> SetupState {
        SetupState::Waiting {
            verification: self.verification.clone(),
            site_id: self.site_id.clone(),
            site_label: self.site_label(),
            node_role: self.node_role.clone(),
            error,
        }
    }
}

/// What the setup page shows.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
enum SetupState {
    /// Waiting for a code.
    Idle {
        cloud_url: Option<String>,
        error: Option<String>,
    },
    /// Claimed; waiting for head office.
    Waiting {
        verification: String,
        /// Internal; the page shows `site_label`.
        site_id: String,
        site_label: String,
        node_role: String,
        error: Option<String>,
    },
    /// Approved and written; the node is starting.
    Enrolled { site_id: String, site_label: String },
}

struct Setup {
    dir: PathBuf,
    state: Mutex<SetupState>,
    done: Notify,
    client: reqwest::Client,
}

fn cloud_base(url: &str) -> Result<String, String> {
    let base = url.trim().trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        return Err("the cloud address must start with https://".into());
    }
    Ok(base.to_owned())
}

/// Write a file only its owner can read. On Unix the mode is set at creation,
/// so there is no moment when the key sits in a world-readable file.
fn write_private(path: &Path, contents: &str) -> Result<(), EdgeError> {
    let io = |error: std::io::Error| {
        EdgeError::Persistence(format!("cannot write {}: {error}", path.display()))
    };
    let temporary = path.with_extension("tmp");
    {
        use std::io::Write as _;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(io)?;
        file.write_all(contents.as_bytes()).map_err(io)?;
        file.sync_all().map_err(io)?;
    }
    // Rename, so a crash mid-write leaves the old file or the new one and
    // never half of either.
    std::fs::rename(&temporary, path).map_err(io)
}

fn read_pending(dir: &Path) -> Option<Pending> {
    let text = std::fs::read_to_string(dir.join(PENDING_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn forget_pending(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(PENDING_FILE));
}

/// The environment a newly enrolled node starts with.
fn node_env(pending: &Pending, generation: i64) -> String {
    format!(
        "# Written by enrolment at {at}. This node's identity and its sync key.\n\
         # Readable by the node's service account only. To move this shop to a new\n\
         # machine, enrol the new machine from the hub; do not copy this file.\n\
         INVENTORY_SITE_ID={site}\n\
         INVENTORY_NODE_ID={origin}\n\
         INVENTORY_NODE_ROLE={role}\n\
         INVENTORY_ORIGIN_GENERATION={generation}\n\
         INVENTORY_AUTH_MODE=required\n\
         SYNC_UPLOAD_URL={cloud}\n\
         SYNC_UPLOAD_KEY={key}\n",
        at = Utc::now().to_rfc3339(),
        site = pending.site_id,
        origin = pending.origin_id,
        role = pending.node_role,
        cloud = pending.cloud_url,
        key = crate::edge::secret::seal(&pending.key),
    )
}

impl Setup {
    async fn claim(&self, cloud_url: &str, code: &str) -> Result<Pending, String> {
        let cloud_url = cloud_base(cloud_url)?;
        let key = security::random_token();
        let request = ClaimRequest {
            code: code.to_owned(),
            key_sha256: enrolment::key_digest(&key),
            machine: MachineFacts::here(),
        };
        let response = self
            .client
            .post(format!("{cloud_url}/api/v1/sync/enroll/claim"))
            .json(&request)
            .send()
            .await
            .map_err(|error| format!("cannot reach the cloud: {error}"))?;
        if !response.status().is_success() {
            return Err(match response.status() {
                StatusCode::FORBIDDEN => {
                    "code not valid — mistyped, already used, expired, or cancelled".to_owned()
                }
                status => format!(
                    "the cloud refused ({status}): {}",
                    response.text().await.unwrap_or_default()
                ),
            });
        }
        let answer: ClaimAnswer = response
            .json()
            .await
            .map_err(|error| format!("cannot read the cloud's answer: {error}"))?;
        let pending = Pending {
            cloud_url,
            enrolment_id: answer.enrolment_id,
            key,
            site_label: answer.site_label(),
            verification: answer.verification,
            site_id: answer.site_id,
            origin_id: answer.origin_id,
            node_role: answer.node_role,
        };
        let text = serde_json::to_string_pretty(&pending).map_err(|error| error.to_string())?;
        write_private(&self.dir.join(PENDING_FILE), &text).map_err(|error| error.to_string())?;
        Ok(pending)
    }

    async fn poll_once(&self, pending: &Pending) -> Result<StatusAnswer, String> {
        let response = self
            .client
            .post(format!("{}/api/v1/sync/enroll/status", pending.cloud_url))
            .header("x-sync-key", &pending.key)
            .json(&StatusRequest {
                enrolment_id: pending.enrolment_id,
            })
            .send()
            .await
            .map_err(|error| format!("cannot reach the cloud: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("the cloud answered {}", response.status()));
        }
        response
            .json()
            .await
            .map_err(|error| format!("cannot read the cloud's answer: {error}"))
    }

    /// Claim a code an installer left behind, once. The file is removed
    /// whatever the answer: a code is good for one claim, and one that was
    /// refused will be refused again.
    async fn claim_staged_code(&self, default_cloud: Option<&str>) {
        let path = self.dir.join(STAGED_CODE_FILE);
        let Ok(text) = std::fs::read_to_string(&path) else {
            return;
        };
        let _ = std::fs::remove_file(&path);
        if read_pending(&self.dir).is_some() {
            return;
        }
        let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
        let Some(code) = lines.next() else {
            return;
        };
        let Some(cloud) = lines.next().or(default_cloud) else {
            *self.state.lock().await = SetupState::Idle {
                cloud_url: None,
                error: Some("the installer left a code but no cloud address".into()),
            };
            return;
        };
        let state = match self.claim(cloud, code).await {
            Ok(pending) => {
                tracing::info!(site = %pending.site_id, verification = %pending.verification, "claimed the code the installer left");
                pending.waiting(None)
            }
            Err(error) => {
                tracing::warn!(%error, "the code the installer left was not accepted");
                SetupState::Idle {
                    cloud_url: Some(cloud.to_owned()),
                    error: Some(format!("code from the installer: {error}")),
                }
            }
        };
        *self.state.lock().await = state;
    }

    /// Wait for head office, for as long as there is a pending claim.
    async fn poll(self: Arc<Self>) {
        loop {
            if let Some(pending) = read_pending(&self.dir) {
                match self.poll_once(&pending).await {
                    Ok(StatusAnswer::Approved {
                        active_generation, ..
                    }) => {
                        let written = write_private(
                            &self.dir.join(NODE_ENV_FILE),
                            &node_env(&pending, active_generation),
                        );
                        if let Err(error) = written {
                            *self.state.lock().await = pending.waiting(Some(error.to_string()));
                        } else {
                            forget_pending(&self.dir);
                            tracing::info!(site = %pending.site_id, "enrolment approved");
                            *self.state.lock().await = SetupState::Enrolled {
                                site_id: pending.site_id.clone(),
                                site_label: pending.site_label(),
                            };
                            self.done.notify_one();
                            return;
                        }
                    }
                    Ok(StatusAnswer::Refused { reason }) => {
                        forget_pending(&self.dir);
                        *self.state.lock().await = SetupState::Idle {
                            cloud_url: Some(pending.cloud_url.clone()),
                            error: Some(format!(
                                "enrolment not approved ({reason}). Ask head office for a new code."
                            )),
                        };
                    }
                    Ok(StatusAnswer::Pending { .. }) => {
                        *self.state.lock().await = pending.waiting(None);
                    }
                    Err(error) => {
                        // The cloud being unreachable is not a refusal: keep
                        // the claim and keep asking.
                        *self.state.lock().await = pending.waiting(Some(error));
                    }
                }
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }
}

#[derive(Deserialize)]
struct ClaimBody {
    cloud_url: String,
    code: String,
}

async fn setup_page() -> Html<&'static str> {
    Html(include_str!("enrolment_setup.html"))
}

async fn setup_state(State(setup): State<Arc<Setup>>) -> Json<SetupState> {
    Json(setup.state.lock().await.clone())
}

async fn setup_claim(State(setup): State<Arc<Setup>>, Json(body): Json<ClaimBody>) -> Response {
    if read_pending(&setup.dir).is_some() {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "this machine is already waiting for approval" })),
        )
            .into_response();
    }
    match setup.claim(&body.cloud_url, &body.code).await {
        Ok(pending) => {
            let state = pending.waiting(None);
            *setup.state.lock().await = state.clone();
            Json(state).into_response()
        }
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

/// Serve the setup page on loopback until head office approves this machine,
/// then return so the caller can start the node. Returns `false` when `stop`
/// ended it first — a service stopped while it was still waiting.
///
/// Only the port of `bind` is used: setup always answers on 127.0.0.1, because
/// until it is enrolled the node has no users and anyone on the shop's network
/// could otherwise type a code into it.
pub async fn run_setup(
    dir: PathBuf,
    bind: SocketAddr,
    default_cloud: Option<String>,
    stop: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<bool, EdgeError> {
    std::fs::create_dir_all(&dir).map_err(|error| {
        EdgeError::Persistence(format!("cannot create {}: {error}", dir.display()))
    })?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| EdgeError::Configuration(format!("http client: {error}")))?;
    let initial = match read_pending(&dir) {
        Some(pending) => pending.waiting(None),
        None => SetupState::Idle {
            cloud_url: default_cloud.clone(),
            error: None,
        },
    };
    let setup = Arc::new(Setup {
        dir,
        state: Mutex::new(initial),
        done: Notify::new(),
        client,
    });
    setup.claim_staged_code(default_cloud.as_deref()).await;
    tokio::spawn(setup.clone().poll());

    let router = Router::new()
        .route("/", get(|| async { Redirect::temporary("/setup") }))
        .route("/setup", get(setup_page))
        .route("/setup/state", get(setup_state))
        .route("/setup/claim", post(setup_claim))
        .with_state(setup.clone());
    let loopback = SocketAddr::from(([127, 0, 0, 1], bind.port()));
    let listener = tokio::net::TcpListener::bind(loopback)
        .await
        .map_err(|error| EdgeError::Configuration(format!("cannot bind {loopback}: {error}")))?;
    tracing::warn!(
        "this node is not enrolled: open http://{loopback}/setup on this machine and enter the code from head office"
    );
    let finished = setup.clone();
    let enrolled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = enrolled.clone();
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = finished.done.notified() => {
                    flag.store(true, std::sync::atomic::Ordering::SeqCst);
                    // Long enough for the open page to read "Enrolled" once.
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
                _ = stop => {}
            }
        })
        .await
        .map_err(|error| EdgeError::Configuration(format!("setup server: {error}")))?;
    Ok(enrolled.load(std::sync::atomic::Ordering::SeqCst))
}

/// Enrol without a browser: `store enroll --code K [--cloud URL]`. Prints the
/// verification number and waits for approval.
pub async fn enroll_headless(dir: PathBuf, cloud_url: &str, code: &str) -> Result<(), EdgeError> {
    std::fs::create_dir_all(&dir).map_err(|error| {
        EdgeError::Persistence(format!("cannot create {}: {error}", dir.display()))
    })?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| EdgeError::Configuration(format!("http client: {error}")))?;
    let setup = Arc::new(Setup {
        dir: dir.clone(),
        state: Mutex::new(SetupState::Idle {
            cloud_url: None,
            error: None,
        }),
        done: Notify::new(),
        client,
    });
    let pending = match read_pending(&dir) {
        Some(pending) => pending,
        None => setup
            .claim(cloud_url, code)
            .await
            .map_err(EdgeError::Configuration)?,
    };
    println!(
        "Claimed {} ({}). Verification number: {} {}",
        pending.site_label(),
        pending.node_role,
        &pending.verification[..3],
        &pending.verification[3..]
    );
    println!("Read this number to head office and wait for approval…");
    tokio::spawn(setup.clone().poll());
    setup.done.notified().await;
    println!("Approved. {} written.", dir.join(NODE_ENV_FILE).display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_env_carries_what_the_node_starts_with() {
        let pending = Pending {
            cloud_url: "https://cloud.example".into(),
            enrolment_id: Uuid::nil(),
            key: "k".repeat(64),
            verification: "123456".into(),
            site_id: "store-07".into(),
            site_label: "C007-TOKO · Bumiayu".into(),
            origin_id: "store-07".into(),
            node_role: "STORE".into(),
        };
        let env = node_env(&pending, 2);
        for line in [
            "INVENTORY_SITE_ID=store-07",
            "INVENTORY_NODE_ID=store-07",
            "INVENTORY_NODE_ROLE=STORE",
            "INVENTORY_ORIGIN_GENERATION=2",
            "SYNC_UPLOAD_URL=https://cloud.example",
            "INVENTORY_AUTH_MODE=required",
        ] {
            assert!(env.lines().any(|l| l == line), "{line} missing from\n{env}");
        }
        let parsed: Vec<(String, String)> = dotenvy::from_read_iter(env.as_bytes())
            .collect::<Result<_, _>>()
            .unwrap_or_else(|error| panic!("node.env must parse: {error}"));
        assert!(parsed
            .iter()
            .any(|(k, v)| k == "SYNC_UPLOAD_KEY" && v == &"k".repeat(64)));
    }

    #[test]
    fn the_cloud_address_must_be_a_web_address() {
        assert_eq!(
            cloud_base("https://cloud.example/").as_deref(),
            Ok("https://cloud.example")
        );
        assert!(cloud_base("cloud.example").is_err());
    }

    #[test]
    fn a_private_file_is_written_whole_and_owner_only() {
        let dir = std::env::temp_dir().join(format!("itulah-enrol-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("dir: {error}"));
        let path = dir.join(NODE_ENV_FILE);
        write_private(&path, "A=1\n").unwrap_or_else(|error| panic!("write: {error}"));
        assert_eq!(std::fs::read_to_string(&path).unwrap_or_default(), "A=1\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&path)
                .map(|m| m.permissions().mode() & 0o777)
                .unwrap_or_default();
            assert_eq!(mode, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
