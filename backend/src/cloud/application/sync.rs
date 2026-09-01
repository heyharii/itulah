//! The sync sender: one fenced-by-singleton loop that drains the ordered fact
//! log toward the upstream node.
//!
//! A cycle is: read the watermark, read the next contiguous batch, send it,
//! settle the response. There is nothing to clean up on a crash — no claims,
//! no leases over rows — because recovery is simply "resend from the
//! watermark" and the receiver deduplicates on the stream key.
//!
//! The transport is a trait so tests can drive the real receiver router
//! in-process; production uses HTTP.

use crate::cloud::application::{AppConfig, AppError, AppState};
use crate::cloud::domain::{BreakerPolicy, IngestBatch, IngestResponse};
use crate::cloud::postgres as infrastructure;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

/// One upload, as the sender sees it.
// ---- One implementation, two storage engines -----------------------------
//
// The cycle itself moved to `crate::sync`, behind the `SyncStore` port, when
// the SQLite edges needed it too. What is left here is the cloud's wiring:
// the HTTP transport, the config lift from `AppConfig`, and the long-running
// agents. Nothing in this file decides anything about settlement — a second
// copy of that logic is exactly the drift the port exists to prevent.
pub use crate::sync::port::{CommandApplyReport, SenderState, SyncTransport};
pub use crate::sync::{CycleOutcome, CycleReport, SyncStore};

/// The cloud node's name for the shared [`crate::sync::SyncConfig`].
pub type SyncCycleConfig = crate::sync::SyncConfig;

pub struct HttpTransport {
    client: reqwest::Client,
    url: String,
    key: Option<String>,
}

impl HttpTransport {
    pub fn new(base_url: &str, key: Option<String>) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::Configuration(format!("sync http client: {e}")))?;
        Ok(Self {
            client,
            url: format!("{}/api/v1/sync/ingest", base_url.trim_end_matches('/')),
            key,
        })
    }
}

#[async_trait::async_trait]
impl SyncTransport for HttpTransport {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let mut request = self.client.post(&self.url).json(batch);
        if let Some(key) = &self.key {
            request = request.header("x-sync-key", key);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("sync upload failed: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("sync ingest returned {status}"));
        }
        response
            .json::<IngestResponse>()
            .await
            .map_err(|e| format!("unintelligible ingest response: {e}"))
    }
}

impl SyncCycleConfig {
    pub fn from_app_config(config: &AppConfig) -> Self {
        Self {
            batch_limit: config.sync_batch_limit,
            breaker: BreakerPolicy {
                threshold: config.sync_breaker_threshold,
                base_cooldown_seconds: config.sync_breaker_base_cooldown_seconds,
                max_cooldown_seconds: config.sync_breaker_max_cooldown_seconds,
            },
            command_key: config
                .sync_upload_key
                .as_deref()
                .map(infrastructure::command_signing_key),
        }
    }
}

/// Run one drain cycle for the cloud node.
///
/// A three-line wrapper over [`crate::sync::run_cycle`]: it adapts the pool
/// into a [`SyncStore`] and maps the shared error back. The behaviour is the
/// edges' behaviour, because it is the same code.
pub async fn sync_cycle(
    pool: &PgPool,
    config: &SyncCycleConfig,
    transport: &dyn SyncTransport,
) -> Result<CycleOutcome, AppError> {
    let store = infrastructure::PgSyncStore::new(pool.clone());
    crate::sync::run_cycle(&store, config, transport)
        .await
        .map_err(|error| AppError::Configuration(error.to_string()))
}

const PURGE_EVERY: Duration = Duration::from_secs(3600);

/// The long-running sender. Wakes on the interval or on an explicit trigger
/// (`POST /api/v1/sync/trigger`), and runs retention housekeeping hourly.
pub async fn run_sync_agent(state: AppState, transport: Arc<dyn SyncTransport>) {
    let interval = Duration::from_secs(state.config.sync_interval_seconds.clamp(1, 3600) as u64);
    let cycle_config = SyncCycleConfig::from_app_config(&state.config);
    let mut last_purge = Instant::now();
    info!(
        interval_seconds = interval.as_secs(),
        batch_limit = cycle_config.batch_limit,
        "sync agent started"
    );
    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = state.sync_wake.notified() => {}
        }
        let outcome = match sync_cycle(&state.db, &cycle_config, transport.as_ref()).await {
            Ok(outcome) => outcome,
            Err(error) => {
                warn!(%error, "sync cycle errored");
                continue;
            }
        };
        if outcome.commands_applied > 0 || outcome.commands_skipped > 0 {
            info!(
                applied = outcome.commands_applied,
                skipped = outcome.commands_skipped,
                "downstream commands settled"
            );
        }
        if let Some(blocked) = &outcome.commands_blocked {
            warn!(
                seq = blocked.seq,
                reason = %blocked.reason,
                "command stream blocked; the cloud is told on the next cycle"
            );
        }
        match outcome.upstream {
            CycleReport::Idle => {}
            CycleReport::SkippedBreaker { open_until } => {
                info!(%open_until, "sync cycle skipped: breaker open");
            }
            CycleReport::Advanced {
                sent,
                advance_to,
                dead_lettered,
            } => {
                info!(sent, advance_to, dead_lettered, "sync cycle advanced");
            }
            CycleReport::Failed {
                error,
                consecutive_failures,
                breaker_opened,
            } => {
                warn!(
                    %error,
                    consecutive_failures,
                    breaker_opened,
                    "sync cycle failed"
                );
            }
        }
        if last_purge.elapsed() >= PURGE_EVERY {
            last_purge = Instant::now();
            match infrastructure::purge_synced(&state.db, state.config.sync_retention_days).await {
                Ok(0) => {}
                Ok(purged) => info!(purged, "sync retention purge"),
                Err(error) => warn!(%error, "sync retention purge failed"),
            }
        }
    }
}

/// Facts a stream applies per pass — bounds one pass's work, not throughput:
/// the next pass continues where this one stopped.
const APPLY_PER_STREAM: i64 = 200;

/// The receiver's applier: drains the receipt log into this node's ledger.
/// Runs on the node that ingests (the cloud); with 30 stores this is the loop
/// that turns thirty receipt streams into one queryable ledger.
pub async fn run_apply_agent(state: AppState) {
    let interval = Duration::from_secs(state.config.sync_interval_seconds.clamp(1, 3600) as u64);
    let mut last_purge = Instant::now();
    info!(
        interval_seconds = interval.as_secs(),
        per_stream = APPLY_PER_STREAM,
        "sync apply agent started"
    );
    loop {
        tokio::time::sleep(interval).await;
        match infrastructure::apply_pending(&state.db, APPLY_PER_STREAM).await {
            Ok(report) => {
                if report.applied > 0 || !report.blocked.is_empty() {
                    info!(
                        applied = report.applied,
                        skipped = report.skipped,
                        blocked = report.blocked.len(),
                        "sync apply cycle"
                    );
                }
                for blocked in &report.blocked {
                    warn!(
                        origin_id = %blocked.origin_id,
                        generation = blocked.generation,
                        seq = blocked.seq,
                        reason = %blocked.reason,
                        "sync apply stream blocked"
                    );
                }
            }
            Err(error) => warn!(%error, "sync apply cycle errored"),
        }
        if last_purge.elapsed() >= PURGE_EVERY {
            last_purge = Instant::now();
            match infrastructure::purge_applied_ingest(&state.db, state.config.sync_retention_days)
                .await
            {
                Ok(0) => {}
                Ok(purged) => info!(purged, "sync ingest retention purge"),
                Err(error) => warn!(%error, "sync ingest retention purge failed"),
            }
        }
    }
}
