//! Everything the cycle needs from a node's storage, and nothing more.
//!
//! Each method exists because the two adapters answer it differently —
//! PostgreSQL with row locks, SQLite with a single writer — while the
//! *decision* made from the answer must be identical. A method that encodes a
//! policy rather than a storage operation means the algorithm has started
//! leaking back into the adapters, and they will drift again.

use crate::cloud::domain::{
    plan_settlement, BreakerPolicy, CommandBlock, HandshakeAgreement, HandshakeRequest,
    IngestBatch, IngestResponse, PushedCommand, RejectedFact, SettlementOutcome, SyncFact,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::fmt;

/// A storage failure, flattened at the adapter boundary.
///
/// The cycle does not branch on the kind of storage error — every one of them
/// means "this cycle achieved nothing, try again" — so carrying each
/// adapter's error type through the shared code would buy nothing and couple
/// the engine to both databases.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncError(pub String);

impl SyncError {
    pub fn new(error: impl fmt::Display) -> Self {
        Self(error.to_string())
    }
}

impl fmt::Display for SyncError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for SyncError {}

/// The durable breaker and progress record for one sender.
///
/// Durable rather than in-memory because a process that forgets an open
/// circuit reconnects immediately on boot, and a crash-looping node becomes a
/// retry storm against a cloud that is already struggling.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SenderState {
    pub consecutive_failures: u32,
    pub breaker_open_until: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
}

/// What one downstream application pass did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommandApplyReport {
    pub applied: u64,
    pub skipped: u64,
    pub blocked: Option<CommandBlock>,
}

/// One node's durable sync state. Implemented once per storage engine.
#[async_trait]
pub trait SyncStore: Send + Sync {
    /// `(origin_id, generation)`, or `None` on a node that was never
    /// provisioned — which is an ordinary state, not an error.
    async fn origin_identity(&self) -> Result<Option<(String, i64)>, SyncError>;

    async fn sender_state(&self) -> Result<SenderState, SyncError>;

    /// How far the receiver durably holds this stream.
    async fn watermark(&self, origin_id: &str, generation: i64) -> Result<i64, SyncError>;

    /// The next contiguous facts above `after_seq`, oldest first.
    async fn pending_batch(
        &self,
        origin_id: &str,
        generation: i64,
        after_seq: i64,
        limit: i64,
    ) -> Result<Vec<SyncFact>, SyncError>;

    /// Copy the permanently rejected facts to the dead-letter table and
    /// advance the watermark — in ONE transaction, so a crash cannot lose the
    /// evidence or the progress independently.
    async fn settle_advance(
        &self,
        origin_id: &str,
        generation: i64,
        advance_to: i64,
        dead_letters: &[RejectedFact],
    ) -> Result<(), SyncError>;

    async fn record_cycle_success(&self) -> Result<(), SyncError>;
    async fn record_cycle_idle(&self) -> Result<(), SyncError>;
    async fn record_cycle_failure(
        &self,
        error: &str,
        policy: BreakerPolicy,
    ) -> Result<SenderState, SyncError>;

    /// This node's applied command position, and its block if it has one.
    async fn command_watermark(&self) -> Result<(i64, Option<CommandBlock>), SyncError>;

    /// Apply delivered commands in seq order, each effect committed with its
    /// watermark in one transaction.
    async fn apply_commands(
        &self,
        key: &[u8],
        commands: &[PushedCommand],
    ) -> Result<CommandApplyReport, SyncError>;
}

/// The text a transport that cannot negotiate answers with. A sender that is
/// gated on the handshake treats it as "the cloud is unreachable" — it queues
/// rather than guessing, which is the same conclusion for the same reason.
pub const HANDSHAKE_UNSUPPORTED: &str = "this transport cannot negotiate a generation";

/// One upload, as the sender sees it.
#[async_trait]
pub trait SyncTransport: Send + Sync {
    /// `Err` is a transport-level failure (network, non-2xx, unintelligible
    /// body). Every `Err` is treated identically: nothing advances and the
    /// failure counts toward the breaker.
    async fn send(&self, batch: &IngestBatch) -> Result<IngestResponse, String>;

    /// Ask the receiver which generation this stream may write into.
    ///
    /// Defaulted rather than required because most transports in this
    /// repository exist to drive one upload in a test, and a transport that
    /// cannot negotiate is not wrong — it simply belongs to a node whose
    /// generation nobody is disputing. The senders that DO gate on the
    /// handshake refuse to send when this fails, so the default is safe in the
    /// only direction that matters.
    async fn handshake(&self, _request: &HandshakeRequest) -> Result<HandshakeAgreement, String> {
        Err(HANDSHAKE_UNSUPPORTED.into())
    }
}

/// The cycle's knobs.
#[derive(Clone, Debug)]
pub struct SyncConfig {
    pub batch_limit: i64,
    pub breaker: BreakerPolicy,
    /// Derived from this node's ingest key. `None` disables the downstream
    /// lane: a node that cannot verify a command must never apply one.
    pub command_key: Option<String>,
}

/// The upstream half's outcome.
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
    /// The receiver answered about a stream this sender is not the sender of:
    /// it claims a seq above the highest we uploaded. Reported apart from
    /// `Failed` because the two need different responses — a failure waits out
    /// a cooldown and retries, and this one waits for a person or a handshake.
    /// Nothing advanced, and the failure was durably recorded either way.
    Divergent {
        reason: String,
        claimed: i64,
        max_sent: i64,
    },
}

/// What one whole cycle did, in both directions.
///
/// The halves are reported separately because they fail independently: a node
/// can be perfectly up to date on facts it sent and still be stuck on a
/// command it was given, and collapsing that into one status hides it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CycleOutcome {
    pub upstream: CycleReport,
    pub commands_applied: u64,
    pub commands_skipped: u64,
    pub commands_blocked: Option<CommandBlock>,
}

impl CycleOutcome {
    fn upstream_only(upstream: CycleReport) -> Self {
        Self {
            upstream,
            commands_applied: 0,
            commands_skipped: 0,
            commands_blocked: None,
        }
    }
}

/// Run one drain cycle against any node.
///
/// Every uncertain outcome leaves the watermark alone: the one thing a sender
/// must never do is advance past a fact it cannot prove was received.
pub async fn run_cycle<S: SyncStore + ?Sized>(
    store: &S,
    config: &SyncConfig,
    transport: &dyn SyncTransport,
) -> Result<CycleOutcome, SyncError> {
    let Some((origin_id, generation)) = store.origin_identity().await? else {
        return Ok(CycleOutcome::upstream_only(CycleReport::Idle));
    };
    let state = store.sender_state().await?;
    let now = Utc::now();
    if let Some(open_until) = state.breaker_open_until.filter(|until| *until > now) {
        return Ok(CycleOutcome::upstream_only(CycleReport::SkippedBreaker {
            open_until,
        }));
    }
    let watermark = store.watermark(&origin_id, generation).await?;
    let facts = store
        .pending_batch(&origin_id, generation, watermark, config.batch_limit)
        .await?;
    let sent_seqs: Vec<i64> = facts.iter().map(|fact| fact.seq).collect();
    // A cycle with nothing to send STILL sends. The request carries this
    // node's command watermark and the response carries its commands, so the
    // downstream lane needs no second connection and no cadence of its own —
    // an idle node still hears from the cloud within one interval.
    let (command_watermark, command_blocked) = store.command_watermark().await?;
    let batch = IngestBatch {
        origin_id: origin_id.clone(),
        generation,
        facts,
        command_watermark,
        command_blocked,
    };
    let response = match transport.send(&batch).await {
        Ok(response) => response,
        Err(error) => {
            return Ok(CycleOutcome::upstream_only(
                record_failure(store, config, error).await?,
            ))
        }
    };
    // Downstream first: commands are instructions this node has already been
    // told to carry out, and a settlement disagreement upstream is no reason
    // to sit on a price the cloud activated.
    let commands = apply_downstream(store, config, &response.commands).await?;
    let upstream = if sent_seqs.is_empty() {
        store.record_cycle_idle().await?;
        CycleReport::Idle
    } else {
        match plan_settlement(watermark, &sent_seqs, &response) {
            SettlementOutcome::Advance {
                advance_to,
                dead_letters,
            } => {
                store
                    .settle_advance(&origin_id, generation, advance_to, &dead_letters)
                    .await?;
                store.record_cycle_success().await?;
                CycleReport::Advanced {
                    sent: sent_seqs.len(),
                    advance_to,
                    dead_lettered: dead_letters.len(),
                }
            }
            SettlementOutcome::NoProgress { reason } => {
                record_failure(store, config, reason).await?
            }
            SettlementOutcome::Divergent {
                reason,
                claimed,
                max_sent,
            } => {
                // Durably recorded like any failure — the breaker still opens,
                // and it survives a restart — but logged at error level and
                // reported under its own name, because retrying will not fix
                // it. What fixes it is a new generation.
                tracing::error!(
                    claimed,
                    max_sent,
                    origin = %origin_id,
                    generation,
                    %reason,
                    "sync settlement diverged; the watermark was NOT advanced"
                );
                record_failure(store, config, reason.clone()).await?;
                CycleReport::Divergent {
                    reason,
                    claimed,
                    max_sent,
                }
            }
        }
    };
    Ok(CycleOutcome {
        upstream,
        commands_applied: commands.applied,
        commands_skipped: commands.skipped,
        commands_blocked: commands.blocked,
    })
}

/// Apply the commands a response delivered. A node with no key configured
/// cannot verify a signature, so it applies nothing rather than trusting the
/// connection to have been the cloud.
async fn apply_downstream<S: SyncStore + ?Sized>(
    store: &S,
    config: &SyncConfig,
    commands: &[PushedCommand],
) -> Result<CommandApplyReport, SyncError> {
    let Some(key) = config.command_key.as_deref() else {
        if !commands.is_empty() {
            tracing::warn!(
                delivered = commands.len(),
                "commands delivered but this node has no sync key to verify them; ignoring"
            );
        }
        return Ok(CommandApplyReport::default());
    };
    store.apply_commands(key.as_bytes(), commands).await
}

async fn record_failure<S: SyncStore + ?Sized>(
    store: &S,
    config: &SyncConfig,
    error: String,
) -> Result<CycleReport, SyncError> {
    // Keep durable error text bounded; transports can produce long bodies.
    let bounded: String = error.chars().take(500).collect();
    let state = store.record_cycle_failure(&bounded, config.breaker).await?;
    let breaker_opened = state
        .breaker_open_until
        .is_some_and(|until| until > Utc::now());
    Ok(CycleReport::Failed {
        error: bounded,
        consecutive_failures: state.consecutive_failures,
        breaker_opened,
    })
}
