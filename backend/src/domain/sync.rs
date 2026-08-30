//! Ordered edge->cloud sync: the decisions, free of SQL and HTTP.
//!
//! The wire model is a log with prefix acknowledgement. The sender uploads a
//! contiguous range of facts starting after its durable watermark; the
//! receiver answers with `durable_through` (the contiguous prefix it now
//! durably holds) plus the seqs it rejected PERMANENTLY (tombstoned at their
//! position so the prefix can still advance past them). Everything uncertain —
//! transport failure, an inconsistent response, no progress — resolves to "do
//! not advance, retry later": the one thing a sender must never do is advance
//! the watermark past a fact it cannot prove was received.
//!
//! Keeping these decisions pure keeps them testable without a database and
//! keeps the storage adapter free of protocol opinions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// One fact on the wire and in the log.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SyncFact {
    pub seq: i64,
    pub event_id: Uuid,
    pub event_type: String,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
}

/// One upload: a contiguous range of facts from a single origin stream.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IngestBatch {
    pub origin_id: String,
    pub generation: i64,
    pub facts: Vec<SyncFact>,
}

/// A permanent rejection at one seq.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RejectedFact {
    pub seq: i64,
    pub reason: String,
}

/// The receiver's answer: a prefix acknowledgement plus tombstoned rejects.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IngestResponse {
    pub durable_through: i64,
    #[serde(default)]
    pub rejected: Vec<RejectedFact>,
}

/// What one settled cycle means for the sender's durable state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SettlementOutcome {
    /// Advance the watermark and copy these rejects to the dead-letter table.
    Advance {
        advance_to: i64,
        dead_letters: Vec<RejectedFact>,
    },
    /// The response cannot be trusted or made no progress. Advance nothing;
    /// the facts stay pending and the failure counts toward the breaker.
    NoProgress { reason: String },
}

/// Decide what a response does to the watermark.
///
/// `sent_seqs` must be the contiguous, ascending seqs that were uploaded.
/// Every inconsistent shape — a regressed watermark, a reject outside the
/// acknowledged range, a reject we never sent — resolves to [`SettlementOutcome::NoProgress`]
/// rather than a partial guess, because a settlement protocol interpreted
/// leniently is how two nodes drift apart without either noticing.
pub fn plan_settlement(
    watermark: i64,
    sent_seqs: &[i64],
    response: &IngestResponse,
) -> SettlementOutcome {
    let Some(&max_sent) = sent_seqs.last() else {
        return SettlementOutcome::NoProgress {
            reason: "nothing was sent; settlement is not applicable".into(),
        };
    };
    if response.durable_through < watermark {
        return SettlementOutcome::NoProgress {
            reason: format!(
                "receiver durable_through {} is behind our watermark {}; refusing to regress",
                response.durable_through, watermark
            ),
        };
    }
    if response.durable_through == watermark {
        return SettlementOutcome::NoProgress {
            reason: format!(
                "receiver made no progress past watermark {watermark} despite {} facts sent",
                sent_seqs.len()
            ),
        };
    }
    // Never advance past what we actually sent: a larger claim would mark
    // facts durable that this sender has not observed being received.
    let advance_to = response.durable_through.min(max_sent);
    let mut dead_letters = Vec::with_capacity(response.rejected.len());
    for reject in &response.rejected {
        if reject.seq <= watermark || reject.seq > advance_to || !sent_seqs.contains(&reject.seq) {
            return SettlementOutcome::NoProgress {
                reason: format!(
                    "inconsistent settlement: rejected seq {} is outside the acknowledged range ({}, {}]",
                    reject.seq, watermark, advance_to
                ),
            };
        }
        dead_letters.push(reject.clone());
    }
    SettlementOutcome::Advance {
        advance_to,
        dead_letters,
    }
}

/// Breaker policy: after `threshold` consecutive failures the sender stops
/// trying for a cooldown that doubles per further failure, capped.
#[derive(Clone, Copy, Debug)]
pub struct BreakerPolicy {
    pub threshold: u32,
    pub base_cooldown_seconds: i64,
    pub max_cooldown_seconds: i64,
}

/// Cooldown to apply after the failure that brought the count to
/// `consecutive_failures`, or `None` while still under the threshold.
pub fn cooldown_after_failure(policy: BreakerPolicy, consecutive_failures: u32) -> Option<i64> {
    if consecutive_failures < policy.threshold.max(1) {
        return None;
    }
    let exponent = consecutive_failures.saturating_sub(policy.threshold).min(16);
    let cooldown = policy
        .base_cooldown_seconds
        .saturating_mul(1_i64 << exponent);
    Some(cooldown.min(policy.max_cooldown_seconds).max(1))
}

/// Validate one incoming fact on the receiver. `None` means acceptable;
/// `Some(reason)` becomes a permanent-rejection tombstone at its seq.
pub fn ingest_rejection_reason(fact: &SyncFact) -> Option<String> {
    if fact.event_type.trim().is_empty() {
        return Some("event_type must not be empty".into());
    }
    if !fact.payload.is_object() {
        return Some("payload must be a JSON object".into());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn response(durable_through: i64, rejected: Vec<RejectedFact>) -> IngestResponse {
        IngestResponse {
            durable_through,
            rejected,
        }
    }

    #[test]
    fn settlement_advances_a_clean_prefix() {
        let outcome = plan_settlement(3, &[4, 5, 6], &response(6, vec![]));
        assert_eq!(
            outcome,
            SettlementOutcome::Advance {
                advance_to: 6,
                dead_letters: vec![]
            }
        );
    }

    #[test]
    fn settlement_carries_rejects_inside_the_acknowledged_range() {
        let rejects = vec![RejectedFact {
            seq: 5,
            reason: "bad payload".into(),
        }];
        let outcome = plan_settlement(3, &[4, 5, 6], &response(6, rejects.clone()));
        assert_eq!(
            outcome,
            SettlementOutcome::Advance {
                advance_to: 6,
                dead_letters: rejects
            }
        );
    }

    #[test]
    fn settlement_never_advances_past_what_was_sent() {
        // A receiver claiming more than we sent may be talking about another
        // sender's uploads; cap at our own horizon and let dedup absorb the rest.
        let outcome = plan_settlement(3, &[4, 5], &response(9, vec![]));
        assert_eq!(
            outcome,
            SettlementOutcome::Advance {
                advance_to: 5,
                dead_letters: vec![]
            }
        );
    }

    #[test]
    fn settlement_refuses_a_regressed_watermark() {
        let outcome = plan_settlement(10, &[11, 12], &response(7, vec![]));
        assert!(matches!(outcome, SettlementOutcome::NoProgress { .. }));
    }

    #[test]
    fn settlement_treats_no_progress_as_failure() {
        let outcome = plan_settlement(3, &[4, 5], &response(3, vec![]));
        assert!(matches!(outcome, SettlementOutcome::NoProgress { .. }));
    }

    #[test]
    fn settlement_refuses_rejects_outside_the_acknowledged_range() {
        let out_of_range = vec![RejectedFact {
            seq: 9,
            reason: "?".into(),
        }];
        let outcome = plan_settlement(3, &[4, 5], &response(5, out_of_range));
        assert!(matches!(outcome, SettlementOutcome::NoProgress { .. }));
    }

    #[test]
    fn settlement_refuses_rejects_below_the_watermark() {
        let below = vec![RejectedFact {
            seq: 2,
            reason: "?".into(),
        }];
        let outcome = plan_settlement(3, &[4, 5], &response(5, below));
        assert!(matches!(outcome, SettlementOutcome::NoProgress { .. }));
    }

    #[test]
    fn breaker_stays_closed_under_the_threshold() {
        let policy = BreakerPolicy {
            threshold: 5,
            base_cooldown_seconds: 30,
            max_cooldown_seconds: 900,
        };
        assert_eq!(cooldown_after_failure(policy, 4), None);
    }

    #[test]
    fn breaker_opens_at_the_threshold_and_backs_off_exponentially_with_a_cap() {
        let policy = BreakerPolicy {
            threshold: 5,
            base_cooldown_seconds: 30,
            max_cooldown_seconds: 900,
        };
        assert_eq!(cooldown_after_failure(policy, 5), Some(30));
        assert_eq!(cooldown_after_failure(policy, 6), Some(60));
        assert_eq!(cooldown_after_failure(policy, 7), Some(120));
        assert_eq!(cooldown_after_failure(policy, 12), Some(900));
        assert_eq!(cooldown_after_failure(policy, 40), Some(900));
    }

    #[test]
    fn ingest_validation_rejects_malformed_facts_and_accepts_sound_ones() {
        let sound = SyncFact {
            seq: 1,
            event_id: Uuid::new_v4(),
            event_type: "inventory.movement".into(),
            payload: json!({"ok": true}),
            created_at: Utc::now(),
        };
        assert_eq!(ingest_rejection_reason(&sound), None);
        let empty_type = SyncFact {
            event_type: "  ".into(),
            ..sound.clone()
        };
        assert!(ingest_rejection_reason(&empty_type).is_some());
        let non_object = SyncFact {
            payload: json!([1, 2, 3]),
            ..sound
        };
        assert!(ingest_rejection_reason(&non_object).is_some());
    }
}
