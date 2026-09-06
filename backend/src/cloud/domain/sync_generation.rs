//! Which generation a sender may write into, and whether a batch may land.
//!
//! The ordered log in `domain::sync` assumes one thing it never checked: that
//! a sender's seq counter and the receiver's watermark describe the same
//! stream. They stop describing the same stream the moment a till's database
//! is replaced — restored from a backup, or re-provisioned empty — because the
//! node keeps its `origin_id` and starts counting again from one. The receiver
//! sees seq 1 for an origin it is already durable through 5,000 of, calls it a
//! duplicate, and answers "durable through 5,000". The sender advances,
//! purges, and a day of sales is gone with every dashboard green.
//!
//! Two decisions close that, and both are here rather than in an adapter
//! because both are protocol, not storage:
//!
//! * [`plan_handshake`] — before its first upload a sender says where it is;
//!   the receiver answers with what it holds, and this decides whether that
//!   stream may continue or must move to a generation above everything the
//!   receiver has ever acknowledged.
//! * [`admit_batch`] — the receiver's own guard, for the sender that skipped
//!   the handshake or was restored underneath one. A batch lying entirely at
//!   or below the watermark is refused by name instead of being swallowed as
//!   duplicates.
//!
//! # Why a generation and not a repair
//!
//! Renumbering a restored node's facts onto the receiver's watermark would ask
//! two databases to agree about which fact each seq meant, and they cannot: the
//! restored node has never seen the facts it is missing. A new generation is
//! the honest answer — the old stream is closed at its watermark, the new one
//! starts at one, and the pair (origin, generation) keeps them apart forever.
//!
//! Everything this module needs arrives as an argument, which is what lets the
//! whole restore scenario be checked in microseconds without a database.
//! `tests/kernel_purity.rs` holds it to that.

use serde::{Deserialize, Serialize};

/// The machine-readable name of the receiver's refusal, carried in the error
/// text so a sender can recognise it without parsing prose.
pub const STALE_GENERATION_CODE: &str = "sync.stale_generation";

/// What the receiver holds for one origin, as the sender is told it.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct OriginHorizon {
    /// The highest generation the receiver has ever held a watermark for.
    /// Zero means it has never heard of this origin, which is the ordinary
    /// state of a genuinely new shop.
    pub highest_generation: i64,
    /// The receiver's durable watermark at the generation the sender proposed.
    /// Zero when the receiver holds nothing for it.
    pub durable_through: i64,
}

/// Where the sender is, as its own database records it.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct LocalStream {
    pub generation: i64,
    /// The highest seq this node has allocated in `generation`. Zero on a
    /// database that has never written a fact — which is exactly the shape a
    /// re-provisioned till has, and the reason this number is worth sending.
    pub next_seq: i64,
}

/// What a sender asks before its first upload.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct HandshakeRequest {
    pub origin_id: String,
    /// The generation this node's database says it is writing.
    pub generation: i64,
    /// The highest seq it has allocated in that generation.
    pub next_seq: i64,
}

/// The receiver's answer, and the only thing the sender acts on.
///
/// The decision is made at the RECEIVER because the receiver is the authority
/// on its own watermark; the sender adopting an answer it did not compute is
/// the point. The horizon rides along anyway so the sender can log what it was
/// told and refuse an answer that would move it backwards.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct HandshakeAgreement {
    pub generation: i64,
    pub rotated: bool,
    pub reason: Option<String>,
    pub horizon: OriginHorizon,
}

/// Which generation the sender may write into.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "plan", rename_all = "snake_case")]
pub enum HandshakePlan {
    /// The proposed stream continues. Nothing moves.
    Keep { generation: i64 },
    /// The proposed stream would write into seqs the receiver already holds.
    /// Close it and start this one, above everything the receiver has ever
    /// acknowledged for this origin.
    Rotate { generation: i64, reason: String },
}

impl HandshakePlan {
    /// The generation the sender is cleared to use, either way.
    pub fn generation(&self) -> i64 {
        match self {
            Self::Keep { generation } | Self::Rotate { generation, .. } => *generation,
        }
    }

    pub fn rotated(&self) -> bool {
        matches!(self, Self::Rotate { .. })
    }

    /// The plan as the sender receives it.
    pub fn agreement(&self, horizon: OriginHorizon) -> HandshakeAgreement {
        HandshakeAgreement {
            generation: self.generation(),
            rotated: self.rotated(),
            reason: match self {
                Self::Keep { .. } => None,
                Self::Rotate { reason, .. } => Some(reason.clone()),
            },
            horizon,
        }
    }
}

/// Decide the sender's generation from the two positions.
///
/// The rule is one comparison, and it is worth stating in words because the
/// wrong version of it loses money either way:
///
/// * The sender's NEXT fact takes seq `next_seq + 1`. Every seq at or below
///   the receiver's watermark is one the receiver will discard as a duplicate.
///   So the stream is safe to continue exactly when `next_seq` has already
///   reached the watermark — the next seq it allocates is one the receiver has
///   never seen.
/// * When it has not, the sender is behind its own acknowledged history: a
///   restore. Rotate.
///
/// The comparison is deliberately against `next_seq` and not against the
/// sender's watermark. A sender whose watermark lags because a response was
/// lost in flight is in perfect health — its facts are the ones the receiver
/// holds, matched by `event_id` on the retry — and rotating it would abandon
/// the unsent tail it is about to deliver.
pub fn plan_handshake(local: LocalStream, horizon: OriginHorizon) -> HandshakePlan {
    let floor = horizon.highest_generation.max(local.generation).max(1);
    if local.generation < 1 {
        return HandshakePlan::Rotate {
            generation: floor,
            reason: "sender proposed no generation".into(),
        };
    }
    if local.generation < horizon.highest_generation {
        return HandshakePlan::Rotate {
            generation: floor + 1,
            reason: format!(
                "receiver has acknowledged generation {} for this origin; \
                 generation {} is behind its own history",
                horizon.highest_generation, local.generation
            ),
        };
    }
    if local.next_seq < horizon.durable_through {
        return HandshakePlan::Rotate {
            generation: floor + 1,
            reason: format!(
                "receiver is durable through seq {} of generation {}, \
                 but this node has only allocated {}; its next {} fact(s) \
                 would be discarded as duplicates",
                horizon.durable_through,
                local.generation,
                local.next_seq,
                horizon.durable_through - local.next_seq
            ),
        };
    }
    HandshakePlan::Keep {
        generation: local.generation,
    }
}

/// Whether a batch may be interpreted by the prefix rules at all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchAdmission {
    /// Ordinary. Apply the duplicate/gap/accept rules as written.
    Proceed,
    /// Every seq in this batch is at or below the watermark and none of them
    /// replays a tombstone: the sender is writing into a range the receiver
    /// already holds. Refuse it by name.
    BelowWatermark {
        watermark: i64,
        lowest_seq: i64,
        highest_seq: i64,
    },
}

/// The receiver's guard.
///
/// `tombstoned` says whether any seq or identity in the batch is one the
/// receiver permanently rejected. That is the one legitimate reason to resend
/// facts below the watermark — the sender lost the response that carried the
/// rejection and must be told again before it may advance — and it is why this
/// takes a flag rather than deciding from the seqs alone.
///
/// An empty batch always proceeds: a cycle with nothing to send still calls,
/// because the request carries the sender's command watermark.
pub fn admit_batch(watermark: i64, seqs: &[i64], tombstoned: bool) -> BatchAdmission {
    if tombstoned {
        return BatchAdmission::Proceed;
    }
    let (Some(&lowest_seq), Some(&highest_seq)) = (seqs.iter().min(), seqs.iter().max()) else {
        return BatchAdmission::Proceed;
    };
    if highest_seq > watermark {
        return BatchAdmission::Proceed;
    }
    BatchAdmission::BelowWatermark {
        watermark,
        lowest_seq,
        highest_seq,
    }
}

/// The refusal, written once so the receiver's message and the sender's
/// recognition of it cannot drift apart.
pub fn stale_generation_message(
    origin_id: &str,
    generation: i64,
    watermark: i64,
    lowest_seq: i64,
    highest_seq: i64,
) -> String {
    format!(
        "{STALE_GENERATION_CODE}: origin {origin_id} generation {generation} is already \
         durable through seq {watermark}; this batch covers seq {lowest_seq}..{highest_seq}, \
         entirely at or below it. This node's stream has been replaced — handshake at \
         POST /api/v1/sync/handshake for a new generation before sending again."
    )
}

/// Whether a sender's failure text is the receiver telling it to re-handshake.
pub fn is_stale_generation(error: &str) -> bool {
    error.contains(STALE_GENERATION_CODE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_shop_keeps_the_generation_it_was_provisioned_with() {
        let plan = plan_handshake(
            LocalStream {
                generation: 1,
                next_seq: 0,
            },
            OriginHorizon::default(),
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 1 });
    }

    #[test]
    fn an_established_shop_keeps_its_stream_across_a_restart() {
        let plan = plan_handshake(
            LocalStream {
                generation: 3,
                next_seq: 5_000,
            },
            OriginHorizon {
                highest_generation: 3,
                durable_through: 5_000,
            },
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 3 });
    }

    #[test]
    fn a_sender_whose_response_was_lost_keeps_its_stream() {
        // The receiver committed seqs the sender has not yet marked durable.
        // Those are the sender's OWN facts and it still holds them; rotating
        // here would abandon the unsent tail above them.
        let plan = plan_handshake(
            LocalStream {
                generation: 2,
                next_seq: 120,
            },
            OriginHorizon {
                highest_generation: 2,
                durable_through: 100,
            },
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 2 });
    }

    #[test]
    fn a_re_provisioned_database_is_moved_above_everything_acknowledged() {
        let plan = plan_handshake(
            LocalStream {
                generation: 1,
                next_seq: 0,
            },
            OriginHorizon {
                highest_generation: 1,
                durable_through: 5_000,
            },
        );
        assert_eq!(plan.generation(), 2);
        assert!(plan.rotated());
        let HandshakePlan::Rotate { reason, .. } = plan else {
            panic!("a replaced database must rotate");
        };
        assert!(reason.contains("5000"), "the reason names the watermark");
    }

    #[test]
    fn a_backup_restored_behind_the_watermark_rotates() {
        // Restored from a backup taken at seq 3,000 while the receiver had
        // acknowledged 5,000: seqs 3,001..5,000 would be silently discarded.
        let plan = plan_handshake(
            LocalStream {
                generation: 4,
                next_seq: 3_000,
            },
            OriginHorizon {
                highest_generation: 4,
                durable_through: 5_000,
            },
        );
        assert_eq!(plan.generation(), 5);
    }

    #[test]
    fn a_backup_restored_ahead_of_the_watermark_keeps_its_stream() {
        // The backup already contains every fact the receiver acknowledged, so
        // resending them deduplicates by identity and the tail lands.
        let plan = plan_handshake(
            LocalStream {
                generation: 4,
                next_seq: 5_200,
            },
            OriginHorizon {
                highest_generation: 4,
                durable_through: 5_000,
            },
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 4 });
    }

    #[test]
    fn a_node_behind_a_generation_it_never_saw_rotates_above_it() {
        let plan = plan_handshake(
            LocalStream {
                generation: 2,
                next_seq: 900,
            },
            OriginHorizon {
                highest_generation: 6,
                durable_through: 0,
            },
        );
        assert_eq!(plan.generation(), 7);
    }

    #[test]
    fn an_ordinary_batch_above_the_watermark_is_admitted() {
        assert_eq!(
            admit_batch(10, &[11, 12, 13], false),
            BatchAdmission::Proceed
        );
    }

    #[test]
    fn a_batch_straddling_the_watermark_is_admitted() {
        // The sender resending from a watermark it never advanced past is the
        // ordinary recovery, not a divergence.
        assert_eq!(
            admit_batch(12, &[11, 12, 13], false),
            BatchAdmission::Proceed
        );
    }

    #[test]
    fn a_batch_entirely_below_the_watermark_is_refused_by_name() {
        assert_eq!(
            admit_batch(5_000, &[1, 2, 3], false),
            BatchAdmission::BelowWatermark {
                watermark: 5_000,
                lowest_seq: 1,
                highest_seq: 3,
            }
        );
    }

    #[test]
    fn a_tombstone_replay_below_the_watermark_is_still_admitted() {
        assert_eq!(admit_batch(5_000, &[4_999], true), BatchAdmission::Proceed);
    }

    #[test]
    fn an_empty_heartbeat_is_admitted() {
        assert_eq!(admit_batch(5_000, &[], false), BatchAdmission::Proceed);
    }

    #[test]
    fn the_refusal_names_the_watermark_and_is_recognisable_to_a_sender() {
        let message = stale_generation_message("store-07-edge", 1, 5_000, 1, 3);
        assert!(is_stale_generation(&message));
        assert!(message.contains("5000"));
        assert!(message.contains("store-07-edge"));
    }
}
