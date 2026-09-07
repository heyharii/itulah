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
    /// How far this node believes the receiver has acknowledged. The interval
    /// `durable_through + 1 ..= next_seq` is what it is still holding, and the
    /// only part of its stream that can collide with anything.
    pub durable_through: i64,
}

/// What the sender says lives at one seq.
///
/// This is the field that separates the two situations a watermark comparison
/// cannot: a sender whose acknowledgement was lost in flight holds THE SAME
/// facts the receiver holds, and a restored one holds different facts at the
/// same numbers. Both look like "behind the receiver" from the seqs alone, and
/// the right answers are opposite — resend, or start a new generation.
///
/// The identity is a string rather than a uuid because it is only ever
/// compared, never parsed, and a kernel that cannot mint one cannot be tempted
/// to.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct StreamWitness {
    pub seq: i64,
    pub event_id: String,
}

/// Whether the two ends agree about what lives at the witnessed seq.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WitnessCheck {
    /// The receiver holds the same fact there. These streams are one stream.
    Agrees,
    /// The receiver holds a DIFFERENT fact there. Two databases, one origin.
    Disagrees,
    /// No witness was offered, or the receiver no longer holds a receipt at
    /// that seq. Treated as disagreement wherever it matters: an overlap this
    /// exchange cannot explain is not one to write into.
    Unknown,
}

/// What a sender asks before its first upload.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct HandshakeRequest {
    pub origin_id: String,
    /// The generation this node's database says it is writing.
    pub generation: i64,
    /// The highest seq it has allocated in that generation.
    pub next_seq: i64,
    /// How far it believes the receiver acknowledged.
    #[serde(default)]
    pub durable_through: i64,
    /// The first fact it is still waiting to send, named. Absent when it has
    /// nothing waiting.
    #[serde(default)]
    pub witness: Option<StreamWitness>,
}

impl HandshakeRequest {
    /// The pure shape of the position this describes.
    pub fn local_stream(&self) -> LocalStream {
        LocalStream {
            generation: self.generation,
            next_seq: self.next_seq,
            durable_through: self.durable_through,
        }
    }
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

/// Decide which generation the sender may write into.
///
/// The whole decision is "would anything this sender is still holding land in
/// seqs the receiver already holds, and if so, are they the same facts?".
///
/// * No overlap — the sender's unsent range starts above everything the
///   receiver has acknowledged. Nothing can collide. Keep.
/// * Overlap, and the two ends name the same fact at the first contested seq —
///   the sender's acknowledgement was lost in flight. Its facts ARE the
///   receiver's facts; resending deduplicates by identity and the tail lands
///   behind them. Keep. Rotating here would be a false alarm every time a
///   response goes missing, and an alert that cries wolf is one nobody reads.
/// * Overlap, and they name different facts — or the receiver cannot say. Two
///   databases are writing one origin's seqs. Rotate above everything the
///   receiver has ever acknowledged, and let the pair (origin, generation)
///   keep them apart forever.
///
/// The comparison that is deliberately NOT made is `next_seq` against the
/// receiver's watermark. A re-provisioned till that has taken three sales has
/// `next_seq` 3 against a receiver durable through 3, which passes that test
/// and loses all three: they are different sales at the same numbers. It is
/// the sender's own watermark that says what it still has to deliver, and the
/// witness that says whose facts those are.
pub fn plan_handshake(
    local: LocalStream,
    horizon: OriginHorizon,
    witness: WitnessCheck,
) -> HandshakePlan {
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
    if local.durable_through >= horizon.durable_through {
        return HandshakePlan::Keep {
            generation: local.generation,
        };
    }
    if witness == WitnessCheck::Agrees {
        return HandshakePlan::Keep {
            generation: local.generation,
        };
    }
    let contested = horizon.durable_through - local.durable_through;
    HandshakePlan::Rotate {
        generation: floor + 1,
        reason: format!(
            "receiver is durable through seq {} of generation {} and this node \
             believes only {}; the {} fact(s) it would send next occupy seqs the \
             receiver already holds{}",
            horizon.durable_through,
            local.generation,
            local.durable_through,
            contested,
            match witness {
                WitnessCheck::Disagrees =>
                    ", and name different facts — this database was replaced",
                _ => ", and it cannot be shown they are the same facts",
            }
        ),
    }
}

/// One fact of an arriving batch, as the receiver sees it before interpreting
/// any of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BatchFact {
    pub seq: i64,
    /// Whether the receiver already holds a fact with this identity — accepted
    /// or tombstoned, at any seq. Identity rather than position, because
    /// position is the thing in dispute.
    pub known: bool,
}

/// Whether a batch may be interpreted by the prefix rules at all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BatchAdmission {
    /// Ordinary. Apply the duplicate/gap/accept rules as written.
    Proceed,
    /// The batch carries facts the receiver has never seen, at seqs it is
    /// already durable through. The prefix rules would skip every one of them
    /// as a duplicate and answer with a watermark that says they are safe.
    BelowWatermark {
        watermark: i64,
        lowest_seq: i64,
        highest_seq: i64,
        contested: usize,
    },
}

/// The receiver's guard, for the sender that never handshook or was replaced
/// underneath one.
///
/// # What is actually being asked
///
/// Not "is this batch below the watermark" — a sender that lost its own
/// watermark resends from zero, and those are the receiver's own facts coming
/// back. Skipping them as duplicates is right, and refusing them would break
/// the ordinary crash recovery this protocol was built around.
///
/// The question is narrower and it is the one that costs money: does this
/// batch carry a fact the receiver has NEVER SEEN, at a seq it is already
/// durable through? Every such fact is one the prefix rules will skip in
/// silence while the response says "durable through" a number that covers it.
/// The sender then advances and purges. That is the entire failure.
///
/// Identity is what separates the two, which is why [`BatchFact::known`] is
/// about the fact and not about the seq. A resend names facts the receiver
/// holds; a replaced database names sales nobody has ever heard of, at numbers
/// somebody else's sales already occupy.
///
/// A batch may straddle: facts above the watermark are new work and are not
/// this function's business either way.
pub fn admit_batch(watermark: i64, facts: &[BatchFact]) -> BatchAdmission {
    let contested: Vec<i64> = facts
        .iter()
        .filter(|fact| fact.seq <= watermark && !fact.known)
        .map(|fact| fact.seq)
        .collect();
    let (Some(&lowest_seq), Some(&highest_seq)) = (contested.iter().min(), contested.iter().max())
    else {
        return BatchAdmission::Proceed;
    };
    BatchAdmission::BelowWatermark {
        watermark,
        lowest_seq,
        highest_seq,
        contested: contested.len(),
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
    contested: usize,
) -> String {
    format!(
        "{STALE_GENERATION_CODE}: origin {origin_id} generation {generation} is already \
         durable through seq {watermark}, and this batch carries {contested} fact(s) this \
         cloud has never seen at seq {lowest_seq}..{highest_seq} — at or below it. Accepting \
         it would discard them and report them safe. This node's stream has been replaced — \
         handshake at POST /api/v1/sync/handshake for a new generation before sending again."
    )
}

/// Whether a sender's failure text is the receiver telling it to re-handshake.
pub fn is_stale_generation(error: &str) -> bool {
    error.contains(STALE_GENERATION_CODE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(generation: i64, next_seq: i64, durable_through: i64) -> LocalStream {
        LocalStream {
            generation,
            next_seq,
            durable_through,
        }
    }

    #[test]
    fn a_new_shop_keeps_the_generation_it_was_provisioned_with() {
        let plan = plan_handshake(
            stream(1, 0, 0),
            OriginHorizon::default(),
            WitnessCheck::Unknown,
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 1 });
    }

    #[test]
    fn an_established_shop_keeps_its_stream_across_a_restart() {
        let plan = plan_handshake(
            stream(3, 5_000, 5_000),
            OriginHorizon {
                highest_generation: 3,
                durable_through: 5_000,
            },
            WitnessCheck::Unknown,
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 3 });
    }

    #[test]
    fn a_sender_whose_response_was_lost_keeps_its_stream() {
        // The receiver committed seqs the sender has not yet marked durable.
        // Those are the sender's OWN facts — the witness says so — and it
        // still holds them; rotating here would raise a false alarm every
        // time a response goes missing.
        let plan = plan_handshake(
            stream(2, 120, 100),
            OriginHorizon {
                highest_generation: 2,
                durable_through: 110,
            },
            WitnessCheck::Agrees,
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 2 });
    }

    #[test]
    fn a_re_provisioned_database_is_moved_above_everything_acknowledged() {
        let plan = plan_handshake(
            stream(1, 0, 0),
            OriginHorizon {
                highest_generation: 1,
                durable_through: 5_000,
            },
            WitnessCheck::Unknown,
        );
        assert_eq!(plan.generation(), 2);
        assert!(plan.rotated());
        let HandshakePlan::Rotate { reason, .. } = plan else {
            panic!("a replaced database must rotate");
        };
        assert!(reason.contains("5000"), "the reason names the watermark");
    }

    #[test]
    fn a_till_that_took_sales_at_seqs_the_cloud_already_holds_rotates() {
        // The failure the old rule waved through: a re-provisioned till that
        // has taken three sales has next_seq 3 against a receiver durable
        // through 3. The seqs match; the sales do not.
        let plan = plan_handshake(
            stream(1, 3, 0),
            OriginHorizon {
                highest_generation: 1,
                durable_through: 3,
            },
            WitnessCheck::Disagrees,
        );
        assert_eq!(plan.generation(), 2);
        let HandshakePlan::Rotate { reason, .. } = plan else {
            panic!("three different sales at three held seqs must rotate");
        };
        assert!(
            reason.contains("replaced"),
            "and it says why, in words an operator can act on: {reason}"
        );
    }

    #[test]
    fn a_backup_restored_behind_the_watermark_rotates() {
        // Restored from a backup taken at seq 3,000 while the receiver had
        // acknowledged 5,000: the sales it takes next are numbered 3,001
        // onward, which the receiver holds other facts at.
        let plan = plan_handshake(
            stream(4, 3_000, 3_000),
            OriginHorizon {
                highest_generation: 4,
                durable_through: 5_000,
            },
            WitnessCheck::Unknown,
        );
        assert_eq!(plan.generation(), 5);
    }

    #[test]
    fn a_backup_restored_ahead_of_the_watermark_keeps_its_stream() {
        // The backup already contains every fact the receiver acknowledged,
        // so nothing it is holding can collide.
        let plan = plan_handshake(
            stream(4, 5_200, 5_000),
            OriginHorizon {
                highest_generation: 4,
                durable_through: 5_000,
            },
            WitnessCheck::Unknown,
        );
        assert_eq!(plan, HandshakePlan::Keep { generation: 4 });
    }

    #[test]
    fn a_node_behind_a_generation_it_never_saw_rotates_above_it() {
        let plan = plan_handshake(
            stream(2, 900, 900),
            OriginHorizon {
                highest_generation: 6,
                durable_through: 0,
            },
            WitnessCheck::Unknown,
        );
        assert_eq!(plan.generation(), 7);
    }

    fn arriving(entries: &[(i64, bool)]) -> Vec<BatchFact> {
        entries
            .iter()
            .map(|&(seq, known)| BatchFact { seq, known })
            .collect()
    }

    #[test]
    fn an_ordinary_batch_above_the_watermark_is_admitted() {
        let batch = arriving(&[(11, false), (12, false), (13, false)]);
        assert_eq!(admit_batch(10, &batch), BatchAdmission::Proceed);
    }

    #[test]
    fn a_sender_that_lost_its_watermark_may_resend_its_own_facts() {
        // The ordinary crash recovery: the sender resends from zero and every
        // fact below the watermark is one the receiver already holds. Refusing
        // this would break the recovery the whole protocol is built around.
        let batch = arriving(&[(1, true), (2, true), (3, false)]);
        assert_eq!(admit_batch(2, &batch), BatchAdmission::Proceed);
    }

    #[test]
    fn a_tombstone_replay_below_the_watermark_is_still_admitted() {
        assert_eq!(
            admit_batch(5_000, &arriving(&[(4_999, true)])),
            BatchAdmission::Proceed
        );
    }

    #[test]
    fn unseen_facts_at_held_seqs_are_refused_by_name() {
        assert_eq!(
            admit_batch(5_000, &arriving(&[(1, false), (2, false), (3, false)])),
            BatchAdmission::BelowWatermark {
                watermark: 5_000,
                lowest_seq: 1,
                highest_seq: 3,
                contested: 3,
            }
        );
    }

    #[test]
    fn a_straddling_batch_is_still_refused_for_the_part_that_would_vanish() {
        // The half above the watermark would land and the half below would be
        // discarded in silence. Admitting this is how a restore loses only
        // SOME of a day, which is worse to find than losing all of it.
        let batch = arriving(&[(2, false), (3, false), (4, false), (5, false)]);
        let BatchAdmission::BelowWatermark {
            lowest_seq,
            highest_seq,
            contested,
            ..
        } = admit_batch(3, &batch)
        else {
            panic!("facts the receiver has never seen sit at seqs it holds");
        };
        assert_eq!((lowest_seq, highest_seq, contested), (2, 3, 2));
    }

    #[test]
    fn an_empty_heartbeat_is_admitted() {
        assert_eq!(admit_batch(5_000, &[]), BatchAdmission::Proceed);
    }

    #[test]
    fn the_refusal_names_the_watermark_and_is_recognisable_to_a_sender() {
        let message = stale_generation_message("store-07-edge", 1, 5_000, 1, 3, 3);
        assert!(is_stale_generation(&message));
        assert!(message.contains("5000"));
        assert!(message.contains("store-07-edge"));
    }
}
