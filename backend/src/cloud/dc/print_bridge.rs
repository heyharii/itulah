//! Printing from the cloud-run Gudang (DC-CLOUD-NATIVE.md).
//!
//! A label printer sits on the warehouse LAN, out of the cloud's reach. So the
//! warehouse fetches its own print jobs: a small bridge on any machine there
//! (`scripts/print-bridge-cloud.py`) asks the cloud for the next job over
//! HTTPS, hands it to the printer, and reports how it went. In the print bench
//! the printer's address is `bridge:<name>`; the port is the printer's on the
//! warehouse LAN, handed to the bridge.
//!
//! [`deliver`] is the one door every Gudang printing path uses — tag labels,
//! koli labels, test pages. An address that is not a bridge is opened
//! directly, for a printer the cloud can reach (and a test sink).
//!
//! Jobs live in memory: a bridge that is not running is a printer that is off.
//! The job waits a while, then fails, and the print run records the failure
//! and can be run again — exactly as with a switched-off printer.

use crate::cloud::{AppError, AppState};
use axum::{
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt as _;
use tokio::sync::{oneshot, Notify};
use uuid::Uuid;

/// How long a job waits for the bridge to print it.
const JOB_TIMEOUT: Duration = Duration::from_secs(45);
/// How long a bridge's poll is held open when nothing is waiting.
const POLL_HOLD: Duration = Duration::from_secs(25);
/// A bridge heard from within this long counts as connected.
const ALIVE_WITHIN: Duration = Duration::from_secs(60);
/// A printer the cloud opens directly.
const DIRECT_TIMEOUT: Duration = Duration::from_secs(10);

struct Job {
    id: Uuid,
    port: u16,
    payload: Vec<u8>,
}

#[derive(Default)]
struct Bridge {
    waiting: VecDeque<Job>,
    last_seen: Option<Instant>,
}

#[derive(Default)]
struct Hub {
    bridges: HashMap<String, Bridge>,
    outcomes: HashMap<Uuid, oneshot::Sender<Result<(), String>>>,
}

struct Shared {
    hub: Mutex<Hub>,
    arrived: Notify,
}

fn shared() -> &'static Shared {
    static SHARED: std::sync::OnceLock<Shared> = std::sync::OnceLock::new();
    SHARED.get_or_init(|| Shared {
        hub: Mutex::new(Hub::default()),
        arrived: Notify::new(),
    })
}

fn poisoned() -> AppError {
    AppError::Configuration("the print bridge's queue is poisoned".into())
}

/// `bridge:<name>` → the bridge's name.
pub fn bridge_name(host: &str) -> Option<&str> {
    host.trim()
        .strip_prefix("bridge:")
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

/// Hand `payload` to the printer at `host:port` and return once it took it.
/// `host` is `bridge:<name>` for a printer in the warehouse.
pub async fn deliver(host: &str, port: u16, payload: &[u8]) -> Result<(), AppError> {
    match bridge_name(host) {
        Some(name) => through_bridge(name, port, payload).await,
        None => directly(host, port, payload).await,
    }
}

/// Whether a printer address answers: a bridge that has asked for work in
/// the last minute, or a socket that opens.
pub async fn reachable(host: &str, port: u16) -> Result<(), String> {
    if let Some(name) = bridge_name(host) {
        return if is_connected(name) {
            Ok(())
        } else {
            Err(format!(
                "print bridge {name} has not asked for work in the last minute; is it running in \
                 the warehouse?"
            ))
        };
    }
    match tokio::time::timeout(
        DIRECT_TIMEOUT,
        tokio::net::TcpStream::connect((host.trim(), port)),
    )
    .await
    {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(error)) => Err(format!("cannot reach {host}:{port}: {error}")),
        Err(_) => Err(format!("{host}:{port} did not answer")),
    }
}

async fn directly(host: &str, port: u16, payload: &[u8]) -> Result<(), AppError> {
    let host = host.trim();
    if host.is_empty() {
        return Err(AppError::Validation("printer host is required".into()));
    }
    let work = async {
        let mut stream = tokio::net::TcpStream::connect((host, port)).await?;
        stream.write_all(payload).await?;
        stream.flush().await?;
        stream.shutdown().await
    };
    match tokio::time::timeout(DIRECT_TIMEOUT, work).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(AppError::Conflict(format!(
            "the printer at {host}:{port} refused: {error}"
        ))),
        Err(_) => Err(AppError::Conflict(format!(
            "the printer at {host}:{port} did not answer"
        ))),
    }
}

async fn through_bridge(name: &str, port: u16, payload: &[u8]) -> Result<(), AppError> {
    let shared = shared();
    let id = Uuid::new_v4();
    let (told, outcome) = oneshot::channel();
    {
        let mut hub = shared.hub.lock().map_err(|_| poisoned())?;
        hub.outcomes.insert(id, told);
        hub.bridges
            .entry(name.to_owned())
            .or_default()
            .waiting
            .push_back(Job {
                id,
                port,
                payload: payload.to_vec(),
            });
    }
    shared.arrived.notify_waiters();
    match tokio::time::timeout(JOB_TIMEOUT, outcome).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(message))) => Err(AppError::Conflict(format!(
            "the printer behind bridge {name} refused: {message}"
        ))),
        Ok(Err(_)) | Err(_) => {
            // Still queued: take it back, so it is not printed after the run
            // already counted it as failed.
            if let Ok(mut hub) = shared.hub.lock() {
                if let Some(bridge) = hub.bridges.get_mut(name) {
                    bridge.waiting.retain(|job| job.id != id);
                }
                hub.outcomes.remove(&id);
            }
            Err(AppError::Conflict(format!(
                "print bridge {name} did not answer; is it running in the warehouse?"
            )))
        }
    }
}

/// Whether the named bridge has asked for work recently.
pub fn is_connected(name: &str) -> bool {
    shared()
        .hub
        .lock()
        .ok()
        .and_then(|hub| hub.bridges.get(name).and_then(|bridge| bridge.last_seen))
        .is_some_and(|seen| seen.elapsed() < ALIVE_WITHIN)
}

// ---- the bridge's side ------------------------------------------------------

/// The bridge's routes. They are outside the session gate (the bridge has no
/// account; `http::auth::is_public`) and answer only to `PRINT_BRIDGE_KEY`.
pub fn routes(router: axum::Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/dc/print-bridge/next", get(next_job))
        .route(
            "/api/v1/dc/print-bridge/jobs/{job_id}/result",
            post(job_result),
        )
}

fn authorised(headers: &HeaderMap) -> bool {
    let Some(key) = std::env::var("PRINT_BRIDGE_KEY")
        .ok()
        .map(|key| key.trim().to_owned())
        .filter(|key| key.chars().count() >= 24)
    else {
        return false;
    };
    let given = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    given.len() == key.len()
        && given
            .bytes()
            .zip(key.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn refused() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "bad or missing print bridge key" })),
    )
        .into_response()
}

#[derive(Deserialize)]
struct NextQuery {
    name: String,
}

async fn next_job(headers: HeaderMap, Query(query): Query<NextQuery>) -> Response {
    if !authorised(&headers) {
        return refused();
    }
    let name = query.name.trim().to_owned();
    if name.is_empty() || name.len() > 64 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name the bridge" })),
        )
            .into_response();
    }
    let shared = shared();
    let deadline = tokio::time::Instant::now() + POLL_HOLD;
    loop {
        // Registered before looking, so a job that arrives between the look
        // and the wait still wakes this poll.
        let arrived = shared.arrived.notified();
        let job = match shared.hub.lock() {
            Ok(mut hub) => {
                let bridge = hub.bridges.entry(name.clone()).or_default();
                bridge.last_seen = Some(Instant::now());
                bridge.waiting.pop_front()
            }
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
        if let Some(job) = job {
            return Json(json!({
                "job_id": job.id,
                "port": job.port,
                "payload_base64": base64::engine::general_purpose::STANDARD.encode(&job.payload),
            }))
            .into_response();
        }
        if tokio::time::timeout_at(deadline, arrived).await.is_err() {
            return StatusCode::NO_CONTENT.into_response();
        }
    }
}

#[derive(Deserialize)]
struct ResultBody {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
}

async fn job_result(
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    Json(body): Json<ResultBody>,
) -> Response {
    if !authorised(&headers) {
        return refused();
    }
    let sender = shared()
        .hub
        .lock()
        .ok()
        .and_then(|mut hub| hub.outcomes.remove(&job_id));
    match sender {
        Some(sender) => {
            let _ = sender.send(if body.ok {
                Ok(())
            } else {
                Err(body.error.unwrap_or_else(|| "no reason given".into()))
            });
            StatusCode::NO_CONTENT.into_response()
        }
        // Timed out on this side already; the run counted it as failed.
        None => (
            StatusCode::GONE,
            Json(json!({ "error": "that job is no longer waiting" })),
        )
            .into_response(),
    }
}
