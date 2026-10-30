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
use crate::cloud::domain::{
    BreakerPolicy, HandshakeAgreement, HandshakeRequest, IngestBatch, IngestResponse,
};
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
    handshake_url: String,
    handover_url: String,
    key: Option<String>,
}

impl HttpTransport {
    pub fn new(base_url: &str, key: Option<String>) -> Result<Self, AppError> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::Configuration(format!("sync http client: {e}")))?;
        let base = base_url.trim_end_matches('/');
        Ok(Self {
            client,
            url: format!("{base}/api/v1/sync/ingest"),
            handshake_url: format!("{base}/api/v1/sync/handshake"),
            handover_url: format!("{base}/api/v1/sync/stock-handover"),
            key,
        })
    }

    fn authorized(&self, url: &str) -> reqwest::RequestBuilder {
        let request = self.client.post(url);
        match &self.key {
            Some(key) => request.header("x-sync-key", key),
            None => request,
        }
    }
}

/// A refusal's status AND its body.
///
/// The status alone used to be the whole error text, and that threw away the
/// one thing a sender needs to act on: the receiver refuses a batch written
/// into somebody else's seqs with a named code in the body, and a sender told
/// only "409" cannot tell that from any other conflict. It would retry the
/// same doomed batch until the breaker opened, forever.
async fn failure_text(what: &str, response: reqwest::Response) -> String {
    let status = response.status();
    match response.text().await {
        Ok(body) if !body.trim().is_empty() => {
            let bounded: String = body.chars().take(500).collect();
            format!("sync {what} returned {status}: {bounded}")
        }
        _ => format!("sync {what} returned {status}"),
    }
}

#[async_trait::async_trait]
impl SyncTransport for HttpTransport {
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String> {
        let response = self
            .authorized(&self.url)
            .json(batch)
            .send()
            .await
            .map_err(|e| format!("sync upload failed: {e}"))?;
        // Told apart from every other refusal: the cycle answers this one by
        // sending less at once (`sync::port::PAYLOAD_TOO_LARGE`), where any
        // other failure waits and sends the same batch again.
        if response.status() == reqwest::StatusCode::PAYLOAD_TOO_LARGE {
            return Err(format!(
                "{}: {}",
                crate::sync::port::PAYLOAD_TOO_LARGE,
                failure_text("ingest", response).await
            ));
        }
        if !response.status().is_success() {
            return Err(failure_text("ingest", response).await);
        }
        response
            .json::<IngestResponse>()
            .await
            .map_err(|e| format!("unintelligible ingest response: {e}"))
    }

    async fn handshake(&self, request: &HandshakeRequest) -> Result<HandshakeAgreement, String> {
        let response = self
            .authorized(&self.handshake_url)
            .json(request)
            .send()
            .await
            .map_err(|e| format!("sync handshake failed: {e}"))?;
        if !response.status().is_success() {
            return Err(failure_text("handshake", response).await);
        }
        response
            .json::<HandshakeAgreement>()
            .await
            .map_err(|e| format!("unintelligible handshake response: {e}"))
    }

    async fn stock_handover(
        &self,
        request: &crate::sync::port::StockHandoverRequest,
    ) -> Result<crate::sync::port::StockHandover, String> {
        let response = self
            .authorized(&self.handover_url)
            .json(request)
            .send()
            .await
            .map_err(|e| format!("sync stock handover failed: {e}"))?;
        // A centre from before the handover answers 404: it has nothing to
        // hand over, which is what a new store's centre says too.
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(crate::sync::port::StockHandover::default());
        }
        if !response.status().is_success() {
            return Err(failure_text("stock handover", response).await);
        }
        response
            .json::<crate::sync::port::StockHandover>()
            .await
            .map_err(|e| format!("unintelligible stock handover response: {e}"))
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
            // Louder than a failure and reported apart from one, because a
            // failure is waiting for a network and this is waiting for a
            // person: the upstream node is answering about a stream this node
            // did not send, and no number of retries will change that.
            CycleReport::Divergent {
                reason,
                claimed,
                max_sent,
            } => {
                tracing::error!(
                    %reason,
                    claimed,
                    max_sent,
                    "sync cycle diverged; the watermark was NOT advanced"
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

/// How often the fleet is told which campaigns are running, as a net under the
/// switch that already dispatches when somebody pulls it.
///
/// The promotion COUNTS no longer ride this beat. They used to — every fifteen
/// minutes whether or not anything had been sold — which let a crossed budget
/// wait up to a quarter of an hour to reach a till and sent every shop the same
/// figure ninety-six times a day when nothing moved. The usage watch
/// (`postgres::marketing_watch`) sends them when they change, and at once when
/// a line is crossed.
const CAMPAIGN_BROADCAST_EVERY: Duration = Duration::from_secs(15 * 60);

/// Facts a stream applies per pass — bounds one pass's work, not throughput:
/// the next pass continues where this one stopped.
const APPLY_PER_STREAM: i64 = 200;

/// The receiver's applier: drains the receipt log into this node's ledger.
/// Runs on the node that ingests (the cloud); with 30 stores this is the loop
/// that turns thirty receipt streams into one queryable ledger.
pub async fn run_apply_agent(state: AppState) {
    let interval = Duration::from_secs(state.config.sync_interval_seconds.clamp(1, 3600) as u64);
    let mut last_purge = Instant::now();
    let mut last_campaign_broadcast = Instant::now();
    let mut usage_watch = infrastructure::UsageWatch::default();
    info!(
        interval_seconds = interval.as_secs(),
        per_stream = APPLY_PER_STREAM,
        "sync apply agent started"
    );
    loop {
        tokio::time::sleep(interval).await;
        let applied = infrastructure::apply_pending(&state.db, APPLY_PER_STREAM).await;
        // The fleet page's "sync apply": this pass ran (`job_beat`, 0703).
        infrastructure::job_beat(
            &state.db,
            infrastructure::JOB_SYNC_APPLY,
            applied.as_ref().err().map(ToString::to_string).as_deref(),
        )
        .await;
        // Whether this pass owes the goods-receipt valuation below a look:
        // facts landed, or a stream is blocked part-way through landing
        // them. A pass that did neither applied nothing, so there is
        // nothing new to value.
        let owes_valuation = matches!(
            &applied,
            Ok(report) if report.applied > 0 || !report.blocked.is_empty()
        );
        match applied {
            Ok(report) => {
                if owes_valuation {
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
        // A delivery is owed the moment it is accepted. The DC's verification
        // arrives here as receipt lines, and this values them straight after
        // the pass that applied them — outside it, so a month nobody has opened
        // can hold up a debt but never the warehouse's stream. Only a pass
        // that owes it runs the scan: the cycles that applied nothing have
        // nothing to value, and asking walks the receiving lines. What cannot
        // post yet is left to the one-minute sweep in `bin/cloud.rs`, which
        // says so.
        if owes_valuation {
            match infrastructure::receipts_post_pending(&state.db, true, "system:goods-receipt")
                .await
            {
                Ok(sweep) => {
                    for posting in &sweep.posted {
                        info!(
                            receipt = %posting.receipt_number,
                            entry = %posting.entry_number,
                            value_minor = posting.value_minor,
                            "accepted delivery owed to its supplier"
                        );
                    }
                }
                Err(error) => warn!(%error, "accepted deliveries could not be valued"),
            }
        }
        // What promotions have cost, out to the fleet, and head office told
        // when a budget or basket cap has just been crossed. It runs here
        // rather than in a loop of its own because it must not overtake the
        // applier: usage is built from sale facts, so a count taken before
        // they are applied would send every shop a figure lower than the
        // truth. Every tick, because a crossing is news the moment the sale
        // that caused it lands; the watch itself decides whether a count is
        // due, and sends nothing when nothing has changed.
        match infrastructure::watch_commercial_usage(&state.db, &mut usage_watch).await {
            Ok(report) => {
                if report.announced > 0 || report.sent.is_some() {
                    info!(
                        announced = report.announced,
                        sent = ?report.sent,
                        "commercial usage watch"
                    );
                }
            }
            Err(error) => warn!(%error, "commercial usage watch failed"),
        }
        // Which campaigns are on. `switch_campaign` already dispatches when
        // somebody pulls the lever, so this is the net under it: a shop that
        // was unreachable at that moment learns here rather than at the next
        // price book, which could be a season away.
        if last_campaign_broadcast.elapsed() >= CAMPAIGN_BROADCAST_EVERY {
            last_campaign_broadcast = Instant::now();
            match infrastructure::publish_campaign_switches_to_fleet(&state.db, "system").await {
                Ok(report) => info!(?report, "campaign switches broadcast"),
                Err(error) => warn!(%error, "campaign switches broadcast failed"),
            }
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
