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

use crate::application::{AppConfig, AppError, AppState};
use crate::domain::{
    plan_settlement, BreakerPolicy, IngestBatch, IngestResponse, SettlementOutcome,
};
use crate::infrastructure;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

/// One upload, as the sender sees it.
#[async_trait]
pub trait SyncTransport: Send + Sync {
    /// `Err` is a transport-level failure (network, non-2xx, unintelligible
    /// body). The cycle treats every `Err` identically: nothing advances and
    /// the failure counts toward the breaker.
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String>;
}

/// Production transport: JSON over HTTP to the receiver's ingest endpoint.
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

#[async_trait]
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

/// What one cycle did — logged, and asserted directly by tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CycleReport {
    /// No provisioned origin, or nothing pending.
    Idle,
    /// The durable breaker is open; nothing was attempted.
    SkippedBreaker { open_until: DateTime<Utc> },
    /// The watermark advanced.
    Advanced {
        sent: usize,
        advance_to: i64,
        dead_lettered: usize,
    },
    /// The cycle failed; the failure was durably recorded.
    Failed {
        error: String,
        consecutive_failures: u32,
        breaker_opened: bool,
    },
}

/// The cycle's knobs, lifted from [`AppConfig`].
#[derive(Clone, Copy, Debug)]
pub struct SyncCycleConfig {
    pub batch_limit: i64,
    pub breaker: BreakerPolicy,
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
        }
    }
}

/// Run one drain cycle. Every uncertain outcome leaves the watermark alone.
pub async fn sync_cycle(
    pool: &PgPool,
    config: &SyncCycleConfig,
    transport: &dyn SyncTransport,
) -> Result<CycleReport, AppError> {
    let Some((origin_id, generation)) = infrastructure::origin_identity(pool).await? else {
        return Ok(CycleReport::Idle);
    };
    let state = infrastructure::load_sender_state(pool).await?;
    let now = Utc::now();
    if let Some(open_until) = state.breaker_open_until.filter(|until| *until > now) {
        return Ok(CycleReport::SkippedBreaker { open_until });
    }
    let watermark = infrastructure::watermark(pool, &origin_id, generation).await?;
    let facts =
        infrastructure::pending_batch(pool, &origin_id, generation, watermark, config.batch_limit)
            .await?;
    if facts.is_empty() {
        infrastructure::record_cycle_idle(pool).await?;
        return Ok(CycleReport::Idle);
    }
    let sent_seqs: Vec<i64> = facts.iter().map(|f| f.seq).collect();
    let batch = IngestBatch {
        origin_id: origin_id.clone(),
        generation,
        facts,
    };
    let response = match transport.send(&batch).await {
        Ok(response) => response,
        Err(error) => return record_failure(pool, config, error).await,
    };
    match plan_settlement(watermark, &sent_seqs, &response) {
        SettlementOutcome::Advance {
            advance_to,
            dead_letters,
        } => {
            infrastructure::settle_advance(pool, &origin_id, generation, advance_to, &dead_letters)
                .await?;
            infrastructure::record_cycle_success(pool).await?;
            Ok(CycleReport::Advanced {
                sent: sent_seqs.len(),
                advance_to,
                dead_lettered: dead_letters.len(),
            })
        }
        SettlementOutcome::NoProgress { reason } => record_failure(pool, config, reason).await,
    }
}

async fn record_failure(
    pool: &PgPool,
    config: &SyncCycleConfig,
    error: String,
) -> Result<CycleReport, AppError> {
    // Keep durable error text bounded; transports can produce long bodies.
    let bounded: String = error.chars().take(500).collect();
    let state = infrastructure::record_cycle_failure(pool, &bounded, config.breaker).await?;
    let breaker_opened = state
        .breaker_open_until
        .is_some_and(|until| until > Utc::now());
    Ok(CycleReport::Failed {
        error: bounded,
        consecutive_failures: state.consecutive_failures,
        breaker_opened,
    })
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
        match sync_cycle(&state.db, &cycle_config, transport.as_ref()).await {
            Ok(CycleReport::Idle) => {}
            Ok(CycleReport::SkippedBreaker { open_until }) => {
                info!(%open_until, "sync cycle skipped: breaker open");
            }
            Ok(CycleReport::Advanced {
                sent,
                advance_to,
                dead_lettered,
            }) => {
                info!(sent, advance_to, dead_lettered, "sync cycle advanced");
            }
            Ok(CycleReport::Failed {
                error,
                consecutive_failures,
                breaker_opened,
            }) => {
                warn!(
                    %error,
                    consecutive_failures,
                    breaker_opened,
                    "sync cycle failed"
                );
            }
            Err(error) => warn!(%error, "sync cycle errored"),
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
