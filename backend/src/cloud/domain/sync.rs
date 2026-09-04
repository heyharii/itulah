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
    /// The store's applied command watermark, riding along so the downstream
    /// lane needs no second round trip and the cloud's fleet-convergence view
    /// refreshes on every cycle. `default` keeps an older store decodable.
    #[serde(default)]
    pub command_watermark: i64,
    /// Set when this store is stuck on a command it will not apply. Reported
    /// rather than inferred: the cloud must be able to name the blocked store
    /// and the reason without waiting for an operator to go looking.
    #[serde(default)]
    pub command_blocked: Option<CommandBlock>,
}

/// A store's report that its command stream has stopped.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct CommandBlock {
    pub seq: i64,
    pub reason: String,
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
    /// The downstream half: commands waiting for this store, contiguous from
    /// its reported watermark. Empty is the ordinary case.
    #[serde(default)]
    pub commands: Vec<PushedCommand>,
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
    let exponent = consecutive_failures
        .saturating_sub(policy.threshold)
        .min(16);
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
            commands: vec![],
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

/// One line of a movement fact as `enqueue_movement_fact` persists it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MovementFactLine {
    pub subject_id: Uuid,
    pub quantity: i64,
    pub from_place_id: String,
    pub to_place_id: String,
    /// The item's own identity, carried so the fact can be read by a centre
    /// that has never heard of this subject. Optional because facts written
    /// before this field existed are still replayable.
    #[serde(default)]
    pub epc: Option<String>,
    #[serde(default)]
    pub sku_code: Option<String>,
}

/// The `inventory.movement` payload shape, as written by the edge enqueue.
/// The applier parses this to replay the fact into the receiving ledger.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MovementFactPayload {
    pub movement_group_id: Uuid,
    pub cause: String,
    pub reason: String,
    #[serde(default)]
    pub reference_type: Option<String>,
    #[serde(default)]
    pub reference_id: Option<String>,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
    pub lines: Vec<MovementFactLine>,
    #[serde(default)]
    pub payload_digest: Option<String>,
}

/// Parse and validate an `inventory.movement` payload for application.
///
/// `Err` here means the stream BLOCKS at this fact (head-of-line, on purpose):
/// an accepted canonical fact that cannot be applied is an incident to
/// surface, never something to silently skip — skipping would advance the
/// applied prefix past a business event that left no ledger effect.
pub fn parse_movement_fact(payload: &Value) -> Result<MovementFactPayload, String> {
    let fact: MovementFactPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed inventory.movement payload: {e}"))?;
    if fact.lines.is_empty() {
        return Err("inventory.movement payload has no lines".into());
    }
    if fact.lines.iter().any(|line| line.quantity <= 0) {
        return Err("inventory.movement line quantity must be positive".into());
    }
    if fact.cause.trim().is_empty()
        || fact.reason.trim().is_empty()
        || fact.actor_id.trim().is_empty()
    {
        return Err("inventory.movement payload requires cause, reason and actor_id".into());
    }
    Ok(fact)
}

#[cfg(test)]
mod apply_tests {
    use super::*;
    use serde_json::json;

    fn sound_payload() -> Value {
        json!({
            "movement_group_id": Uuid::new_v4(),
            "cause": "NORMAL_MOVE",
            "reason": "restock",
            "reference_type": null,
            "reference_id": null,
            "actor_id": "till-1",
            "occurred_at": Utc::now(),
            "lines": [{
                "subject_id": Uuid::new_v4(),
                "quantity": 1,
                "from_place_id": "store-07.warehouse:on_hand",
                "to_place_id": "store-07.floor:on_hand",
            }],
        })
    }

    #[test]
    fn movement_fact_parses_and_validates() {
        assert!(parse_movement_fact(&sound_payload()).is_ok());
    }

    #[test]
    fn movement_fact_rejects_empty_lines_and_bad_quantity() {
        let mut no_lines = sound_payload();
        no_lines["lines"] = json!([]);
        assert!(parse_movement_fact(&no_lines).is_err());
        let mut bad_qty = sound_payload();
        bad_qty["lines"][0]["quantity"] = json!(0);
        assert!(parse_movement_fact(&bad_qty).is_err());
    }

    #[test]
    fn movement_fact_rejects_blank_required_fields() {
        let mut blank = sound_payload();
        blank["actor_id"] = json!("  ");
        assert!(parse_movement_fact(&blank).is_err());
    }
}

// ---- The downstream lane: cloud -> store commands -------------------------

/// One command as it travels to a store, riding the ingest response.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PushedCommand {
    pub seq: i64,
    pub command_id: Uuid,
    pub command_type: String,
    pub payload: Value,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub revoked: bool,
    /// Hex HMAC-SHA256 over [`command_canonical`], under the store's ingest
    /// key. A forged command changes prices in a shop, so the downstream
    /// direction is signed even where the upstream one is not yet.
    pub signature: String,
}

/// The exact bytes a command's signature covers.
///
/// `seq` is inside the signature on purpose: without it a valid command could
/// be replayed at a different position by anyone able to reorder the
/// response, and position is what decides application order.
pub fn command_canonical(
    seq: i64,
    command_id: &Uuid,
    command_type: &str,
    payload: &Value,
    expires_at: Option<&DateTime<Utc>>,
    revoked: bool,
) -> Vec<u8> {
    let payload = serde_json::to_string(payload).unwrap_or_else(|_| "null".into());
    let expires_at = expires_at.map(DateTime::to_rfc3339).unwrap_or_default();
    format!("{seq}\n{command_id}\n{command_type}\n{expires_at}\n{revoked}\n{payload}").into_bytes()
}

fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    use sha2::{Digest as _, Sha256};
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner_key = [0x36u8; BLOCK];
    let mut outer_key = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        inner_key[i] ^= block[i];
        outer_key[i] ^= block[i];
    }
    let mut inner = Sha256::new();
    inner.update(inner_key);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_key);
    outer.update(inner);
    hex::encode(outer.finalize())
}

/// Sign one command for one store.
pub fn sign_command(
    key: &[u8],
    seq: i64,
    command_id: &Uuid,
    command_type: &str,
    payload: &Value,
    expires_at: Option<&DateTime<Utc>>,
    revoked: bool,
) -> String {
    hmac_sha256_hex(
        key,
        &command_canonical(seq, command_id, command_type, payload, expires_at, revoked),
    )
}

/// Compare two hex digests without an early exit on the first differing byte.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// What the store should do with one command.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommandDisposition {
    /// Apply the effect, then advance the watermark in the same transaction.
    Apply,
    /// Do not apply, but DO advance past it — the command is deliberately
    /// dead and holding the prefix behind it would help no one.
    Skip {
        outcome: &'static str,
        reason: String,
    },
    /// Stop the stream here. The command is not trustworthy or not
    /// intelligible, and skipping it would silently drop an instruction the
    /// cloud believes it gave.
    Block { reason: String },
}

/// Decide one command's fate, given the store's key and the current time.
///
/// Order matters. The signature is checked FIRST: an unsigned or forged
/// command must never be trusted enough to read its expiry or its revocation
/// flag, both of which an attacker would otherwise control.
pub fn decide_command(
    key: &[u8],
    watermark: i64,
    command: &PushedCommand,
    now: DateTime<Utc>,
) -> CommandDisposition {
    if command.seq != watermark + 1 {
        return CommandDisposition::Block {
            reason: format!(
                "command seq {} is not the next position after watermark {watermark}",
                command.seq
            ),
        };
    }
    let expected = sign_command(
        key,
        command.seq,
        &command.command_id,
        &command.command_type,
        &command.payload,
        command.expires_at.as_ref(),
        command.revoked,
    );
    if !constant_time_eq(&expected, &command.signature) {
        return CommandDisposition::Block {
            reason: "command signature does not verify under this store's key".into(),
        };
    }
    if command.revoked {
        return CommandDisposition::Skip {
            outcome: "SKIPPED_REVOKED",
            reason: "revoked by the issuer before this store applied it".into(),
        };
    }
    if command.expires_at.is_some_and(|expiry| expiry <= now) {
        return CommandDisposition::Skip {
            outcome: "SKIPPED_EXPIRED",
            reason: "expired before it reached this store".into(),
        };
    }
    CommandDisposition::Apply
}

/// The command types a store understands. An unknown type BLOCKS rather than
/// being skipped: it means the cloud is ahead of this store's build, and
/// quietly discarding an instruction is worse than stopping and being seen.
pub const COMMAND_ACTIVATE_PUBLICATION: &str = "commercial.publication.activate";

/// Running totals of what promotions have given away.
///
/// A separate command from the publication on purpose, and the separation is
/// the point: a publication is a decision, frozen and versioned, sent when the
/// prices change. This is an observation that moves with every sale in the
/// fleet. Carrying the second inside the first is why no count was ever kept.
pub const COMMAND_COMMERCIAL_USAGE: &str = "commercial.usage.v1";

/// The `commercial.usage.v1` payload: the whole picture, not a delta.
///
/// Whole rather than incremental so a shop that missed one of these is merely
/// out of date rather than permanently wrong — a lost delta would understate a
/// budget forever, and nothing would ever notice.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialUsagePayload {
    pub counted_at: DateTime<Utc>,
    pub counts: Vec<CommercialUsageCount>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CommercialUsageCount {
    /// `RULE`, `CAMPAIGN` or `COUPON`.
    pub kind: String,
    /// The rule id, campaign id, or coupon code.
    pub key: String,
    pub uses: i64,
    #[serde(default)]
    pub spent_minor: i64,
}

/// Whether each campaign is running, and between which dates.
///
/// A third lane, and the reason there has to be one is written into migration
/// 0073: a campaign's `status` is **the lever the business pulls** when it says
/// "stop the Lebaran promo", and until this command existed pulling it changed
/// Postgres and nothing else. A shop only ever learned a campaign's status from
/// the publication that carried it, and publications are frozen and seasonal —
/// so a pause reached a till when somebody happened to cut a new price book,
/// which is to say never, on the day it mattered.
///
/// It cannot be folded into the publication for the same reason
/// [`COMMAND_COMMERCIAL_USAGE`] cannot: a publication is a decision, frozen and
/// versioned; a switch is pulled between them.
///
/// This is what makes a campaign stoppable, and stoppability is what makes it safe
/// to gate a *markdown* on a campaign at all — see
/// `pricing_engine::PriceIndex::campaign_allows`. Without a delivered pause,
/// the only way to end a campaign early would be silence, and silence is exactly
/// what that gate refuses to read as "put the prices back up".
pub const COMMAND_COMMERCIAL_CAMPAIGN: &str = "commercial.campaign.v1";

/// The `commercial.campaign.v1` payload: every campaign, not a delta.
///
/// Named for the switch rather than for the table it lands in, and that is not
/// only taste: `tests/pricing_authority.rs` reads every source file for the
/// name of a price table, and this module — which declares payloads and writes
/// nothing — must not appear on that list. The first draft named this parser
/// after the table instead of the message, and tripped that guard by spelling
/// alone. An allow-list entry to excuse a false positive is how a guard stops
/// guarding, so the name changed instead.
///
/// Whole for the same reason usage is whole — a shop that missed one is behind
/// rather than permanently wrong about which promotions are running.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CampaignSwitchPayload {
    pub switched_at: DateTime<Utc>,
    pub campaigns: Vec<CampaignSwitchEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CampaignSwitchEntry {
    pub campaign_id: String,
    /// `DRAFT`, `SCHEDULED`, `ACTIVE`, `PAUSED`, `EXPIRED` or `CANCELLED`.
    pub status: String,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    /// The poster, carried on the same lane and for the same reason as the
    /// switch: it is the other half of a campaign that is allowed to change
    /// between price books, so a corrected banner must not have to wait for a
    /// season's repricing to reach the shop floor.
    ///
    /// Absent leaves what the shop holds. A shop that receives an older
    /// centre's switch keeps the picture its last publication gave it, which is
    /// better than being blanked by a message that simply did not mention it.
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub headline: Option<String>,
    #[serde(default)]
    pub terms: Option<String>,
}

pub fn parse_campaign_switch(payload: &Value) -> Result<CampaignSwitchPayload, String> {
    let parsed: CampaignSwitchPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_COMMERCIAL_CAMPAIGN} payload: {e}"))?;
    for campaign in &parsed.campaigns {
        if campaign.campaign_id.trim().is_empty() {
            return Err("a campaign switch must name its campaign".into());
        }
        // The same list the shop's CHECK constraint holds. Refused at the door
        // rather than stored and read as "not running" later: a status this
        // build cannot read would silently pause a live campaign, putting prices
        // back up across the fleet with nothing saying why.
        if !matches!(
            campaign.status.as_str(),
            "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "EXPIRED" | "CANCELLED"
        ) {
            return Err(format!("unknown campaign status {}", campaign.status));
        }
        if let (Some(from), Some(to)) = (campaign.valid_from, campaign.valid_to) {
            if to <= from {
                return Err(format!(
                    "campaign {} ends before it starts",
                    campaign.campaign_id
                ));
            }
        }
    }
    Ok(parsed)
}

pub fn parse_commercial_usage(payload: &Value) -> Result<CommercialUsagePayload, String> {
    let parsed: CommercialUsagePayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_COMMERCIAL_USAGE} payload: {e}"))?;
    for count in &parsed.counts {
        if !matches!(count.kind.as_str(), "RULE" | "CAMPAIGN" | "COUPON") {
            return Err(format!("unknown usage kind {}", count.kind));
        }
        if count.key.trim().is_empty() {
            return Err("a usage count must name what it counts".into());
        }
        if count.uses < 0 || count.spent_minor < 0 {
            return Err("a usage count cannot be negative".into());
        }
    }
    Ok(parsed)
}

/// The `commercial.publication.activate` payload: a whole published
/// commercial version, carried by value so a store can price a basket with no
/// further round trip.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ActivatePublicationPayload {
    pub publication_id: Uuid,
    pub version: i64,
    pub name: String,
    pub effective_from: DateTime<Utc>,
    #[serde(default)]
    pub effective_to: Option<DateTime<Utc>>,
    pub tax_rules: Vec<PublicationTaxRule>,
    pub price_rules: Vec<PublicationPriceRule>,
    /// Clearance prices that replace the base for the goods they name.
    #[serde(default)]
    pub markdowns: Vec<PublicationMarkdown>,
    /// Promotions, carried as the pricing engine's own documents.
    ///
    /// Opaque here on purpose. Parsing them into a type this module owns would
    /// mean a shop running an older build blocks the whole price book because
    /// one promotion used a shape it does not recognise — and a shop that
    /// cannot price at all is far worse than a shop missing one offer. The
    /// centre validates them when they are authored; a shop skips what it
    /// cannot read and charges correct prices regardless.
    #[serde(default)]
    pub rules: Vec<Value>,
    /// Codes that unlock those promotions.
    #[serde(default)]
    pub coupons: Vec<PublicationCoupon>,
    /// The envelopes those promotions sit in.
    ///
    /// A shop refuses to apply a promotion naming a campaign it does not hold,
    /// so these must arrive with the rules that reference them or the offers go
    /// dark. That is the safe direction — a campaign paused at the centre must
    /// not keep running at the shop that missed the message.
    #[serde(default)]
    pub campaigns: Vec<PublicationCampaign>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PublicationCampaign {
    pub campaign_id: String,
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    /// Shared across every rule in the campaign. `None` is unlimited.
    #[serde(default)]
    pub budget_minor: Option<i64>,
    // No `spent_minor` and no `used`. A limit travels with the book that
    // declared it; what has been spent against that limit travels on the usage
    // lane, because it changes with every sale and the book is frozen. Sending
    // both gave a shop two numbers for one fact and it overwrote one with the
    // other on arrival.
    #[serde(default)]
    pub max_uses: Option<i64>,
    /// The banner, the words on it, and the small print under it.
    ///
    /// A campaign is the only thing in a price book a SHOPPER is meant to read,
    /// which is why these three ride here and nowhere else. A price rule
    /// describes a number; a markdown describes a garment; a campaign
    /// describes an event — "Lebaran Sale, ends Sunday" — and a shop cannot put
    /// that on a screen out of an id and a percentage.
    ///
    /// All three `default`, so an older centre sends none and a shop simply
    /// draws the campaign's internal name with no picture.
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub headline: Option<String>,
    #[serde(default)]
    pub terms: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PublicationMarkdown {
    pub markdown_id: String,
    /// One product, or — with `article_code` — a whole style. Naming neither
    /// marks nothing down, and is refused at the door.
    #[serde(default)]
    pub sku_code: Option<String>,
    #[serde(default)]
    pub article_code: Option<String>,
    /// `None` means every shop, unless a group is named below.
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub site_ids: Option<Vec<String>>,
    pub replacement_unit_price_minor: i64,
    #[serde(default)]
    pub priority: i64,
    /// The campaign this price drop is part of, when it is part of one.
    ///
    /// This is what makes a "flash sale" expressible: a run of markdowns under
    /// one campaign's name, window and switch. `None` — every markdown written
    /// before this existed — stands on its own, and standing on its own is the
    /// permissive case by design. See postgres migration 0087 for why the gate
    /// on a markdown's campaign is the opposite way round from a rule's.
    #[serde(default)]
    pub campaign_id: Option<String>,
    /// The days it runs on (ISO, Monday is 1) and the minutes of the day it
    /// runs between, read in the shop's own time. Empty and `None` mean all
    /// day, every day — what every markdown meant before a price could be
    /// scheduled by the hour.
    #[serde(default)]
    pub iso_weekdays: Vec<u32>,
    #[serde(default)]
    pub from_minute: Option<u32>,
    #[serde(default)]
    pub to_minute: Option<u32>,
    pub effective_from: DateTime<Utc>,
    #[serde(default)]
    pub effective_to: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PublicationCoupon {
    pub code: String,
    pub rule_id: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub max_uses: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PublicationTaxRule {
    pub tax_category: String,
    pub rate_bps: i32,
    pub tax_inclusive: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PublicationPriceRule {
    pub sku_id: Uuid,
    /// The code the receiving shop names this product by.
    ///
    /// Carried beside the id, not instead of it. The id is what the centre
    /// calls the row and is what a fact reported back up must quote; the code
    /// is the only name a shop can act on — its catalogue is keyed by it and a
    /// scanned tag decodes to it. A price that arrives with the id alone is
    /// stored faithfully and matches nothing.
    pub sku_code: String,
    /// One shop. Set for a shop-level price.
    #[serde(default)]
    pub site_id: Option<String>,
    /// A named set of shops — a city, a format. Set for a group-level price.
    #[serde(default)]
    pub site_ids: Option<Vec<String>>,
    pub channel: String,
    pub sellable: bool,
    pub currency: String,
    pub unit_price_minor: i64,
    pub tax_category: String,
}

/// Parse and validate an activation payload. `Err` blocks the stream.
pub fn parse_activate_publication(payload: &Value) -> Result<ActivatePublicationPayload, String> {
    let parsed: ActivatePublicationPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_ACTIVATE_PUBLICATION} payload: {e}"))?;
    if parsed.version <= 0 {
        return Err("publication version must be positive".into());
    }
    if parsed.name.trim().is_empty() {
        return Err("publication name must not be empty".into());
    }
    // Something has to change. Not price rules specifically: a book carrying
    // only a markdown, or only a promotion, is an ordinary thing to publish and
    // demanding a price rule forced an author to restate a base price they did
    // not mean to touch — which is how a book meant to add a discount reprices
    // the range instead, since the newest book naming a product wins.
    //
    // A book carrying nothing at all is still refused: it would dispatch to
    // thirty shops, activate, and leave every one of them exactly as it was.
    if parsed.price_rules.is_empty()
        && parsed.markdowns.is_empty()
        && parsed.rules.is_empty()
        && parsed.coupons.is_empty()
        && parsed.campaigns.is_empty()
    {
        return Err(
            "publication carries nothing: no prices, markdowns, promotions, \
                    coupons or campaigns"
                .into(),
        );
    }
    if parsed
        .price_rules
        .iter()
        .any(|rule| rule.sku_code.trim().is_empty())
    {
        return Err("publication price rule must name a sku_code".into());
    }
    // A markdown naming neither a product nor a style is a markdown on
    // everything. Two empty fields must never become "the whole shop at this
    // price", so it is refused here rather than discovered on a shelf.
    if parsed
        .markdowns
        .iter()
        .any(|markdown| markdown.sku_code.is_none() && markdown.article_code.is_none())
    {
        return Err("publication markdown must name a sku_code or an article_code".into());
    }
    if parsed
        .markdowns
        .iter()
        .any(|markdown| markdown.replacement_unit_price_minor < 0)
    {
        return Err("publication markdown price must not be negative".into());
    }
    if parsed
        .coupons
        .iter()
        .any(|coupon| coupon.code.trim().is_empty() || coupon.rule_id.trim().is_empty())
    {
        return Err("publication coupon must name a code and the rule it unlocks".into());
    }
    // Only one level per price. A row claiming to be both a shop price and a
    // group price has no single right reading, and picking one silently is how
    // the centre and a till come to disagree.
    for rule in &parsed.price_rules {
        let levels = u8::from(rule.site_id.is_some())
            + u8::from(rule.site_ids.as_ref().is_some_and(|ids| !ids.is_empty()));
        if levels > 1 {
            return Err(format!(
                "price rule for {} names more than one level",
                rule.sku_code
            ));
        }
    }
    for markdown in &parsed.markdowns {
        let levels = u8::from(markdown.site_id.is_some())
            + u8::from(
                markdown
                    .site_ids
                    .as_ref()
                    .is_some_and(|ids| !ids.is_empty()),
            );
        if levels > 1 {
            return Err(format!(
                "markdown {} names more than one level",
                markdown.markdown_id
            ));
        }
    }
    if parsed
        .campaigns
        .iter()
        .any(|campaign| campaign.campaign_id.trim().is_empty() || campaign.name.trim().is_empty())
    {
        return Err("publication campaign must name an id and a name".into());
    }
    if parsed
        .price_rules
        .iter()
        .any(|rule| rule.unit_price_minor < 0)
    {
        return Err("publication price must not be negative".into());
    }
    if parsed
        .tax_rules
        .iter()
        .any(|rule| !(0..=100_000).contains(&rule.rate_bps))
    {
        return Err("publication tax rate must be within 0..=100000 bps".into());
    }
    if let Some(end) = parsed.effective_to {
        if end <= parsed.effective_from {
            return Err("publication effective_to must be after effective_from".into());
        }
    }
    Ok(parsed)
}

#[cfg(test)]
mod downstream_tests {
    use super::*;
    use serde_json::json;

    const KEY: &[u8] = b"store-07-key";

    fn signed_with(
        seq: i64,
        payload: Value,
        expires_at: Option<DateTime<Utc>>,
        revoked: bool,
    ) -> PushedCommand {
        let command_id = Uuid::new_v4();
        let command_type = COMMAND_ACTIVATE_PUBLICATION.to_string();
        let signature = sign_command(
            KEY,
            seq,
            &command_id,
            &command_type,
            &payload,
            expires_at.as_ref(),
            revoked,
        );
        PushedCommand {
            seq,
            command_id,
            command_type,
            payload,
            expires_at,
            revoked,
            signature,
        }
    }

    fn signed(seq: i64, payload: Value) -> PushedCommand {
        signed_with(seq, payload, None, false)
    }

    #[test]
    fn a_well_formed_command_at_the_next_position_applies() {
        let command = signed(1, json!({}));
        assert_eq!(
            decide_command(KEY, 0, &command, Utc::now()),
            CommandDisposition::Apply
        );
    }

    #[test]
    fn a_command_out_of_position_blocks() {
        let command = signed(3, json!({}));
        assert!(matches!(
            decide_command(KEY, 0, &command, Utc::now()),
            CommandDisposition::Block { .. }
        ));
    }

    #[test]
    fn a_forged_or_wrong_key_command_blocks() {
        let mut tampered = signed(1, json!({"price": 100}));
        tampered.payload = json!({"price": 1});
        assert!(matches!(
            decide_command(KEY, 0, &tampered, Utc::now()),
            CommandDisposition::Block { .. }
        ));
        let other_store = signed(1, json!({}));
        assert!(matches!(
            decide_command(b"another-store-key", 0, &other_store, Utc::now()),
            CommandDisposition::Block { .. }
        ));
    }

    #[test]
    fn a_command_replayed_at_another_position_blocks() {
        // Signed for seq 1, presented as seq 2: the signature covers position,
        // so moving it invalidates it rather than just failing the ordering
        // check that an attacker could also satisfy.
        let mut moved = signed(1, json!({}));
        moved.seq = 2;
        assert!(matches!(
            decide_command(KEY, 1, &moved, Utc::now()),
            CommandDisposition::Block { .. }
        ));
    }

    #[test]
    fn revoked_and_expired_commands_skip_without_damming_the_stream() {
        let revoked = signed_with(1, json!({}), None, true);
        assert_eq!(
            decide_command(KEY, 0, &revoked, Utc::now()),
            CommandDisposition::Skip {
                outcome: "SKIPPED_REVOKED",
                reason: "revoked by the issuer before this store applied it".into(),
            }
        );
        let expired = signed_with(
            1,
            json!({}),
            Some(Utc::now() - chrono::Duration::seconds(1)),
            false,
        );
        assert!(matches!(
            decide_command(KEY, 0, &expired, Utc::now()),
            CommandDisposition::Skip {
                outcome: "SKIPPED_EXPIRED",
                ..
            }
        ));
    }

    #[test]
    fn an_unsigned_revocation_cannot_cancel_a_real_command() {
        // Signature is checked before the revoked flag, so an attacker who can
        // flip bits on the wire cannot cancel a fleet-wide instruction.
        let mut command = signed(1, json!({}));
        command.revoked = true; // flipped after signing
        assert!(matches!(
            decide_command(KEY, 0, &command, Utc::now()),
            CommandDisposition::Block { .. }
        ));
    }

    #[test]
    fn activation_payload_validates() {
        let sound = json!({
            "publication_id": Uuid::new_v4(),
            "version": 3,
            "name": "Lebaran 2026",
            "effective_from": Utc::now(),
            "effective_to": null,
            "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
            "price_rules": [{
                "sku_id": Uuid::new_v4(), "sku_code": "10012345001",
                "site_id": null, "channel": "STORE",
                "sellable": true, "currency": "IDR",
                "unit_price_minor": 25000, "tax_category": "STANDARD"
            }],
        });
        assert!(parse_activate_publication(&sound).is_ok());
        let mut empty = sound.clone();
        empty["price_rules"] = json!([]);
        assert!(parse_activate_publication(&empty).is_err());
        let mut bad_tax = sound.clone();
        bad_tax["tax_rules"][0]["rate_bps"] = json!(999_999);
        assert!(parse_activate_publication(&bad_tax).is_err());
    }

    #[test]
    fn a_price_the_shop_cannot_match_to_a_product_is_refused() {
        // The shop floor names products by sku_code. A price carrying only the
        // centre's UUID lands, stores cleanly, and prices nothing — so it is
        // refused at the door rather than discovered at a till.
        let base = json!({
            "publication_id": Uuid::new_v4(),
            "version": 3,
            "name": "Lebaran 2026",
            "effective_from": Utc::now(),
            "effective_to": null,
            "tax_rules": [{"tax_category": "STANDARD", "rate_bps": 1100, "tax_inclusive": true}],
            "price_rules": [{
                "sku_id": Uuid::new_v4(), "site_id": null, "channel": "STORE",
                "sellable": true, "currency": "IDR",
                "unit_price_minor": 25000, "tax_category": "STANDARD"
            }],
        });
        assert!(
            parse_activate_publication(&base).is_err(),
            "a price rule with no sku_code must block the stream"
        );

        let mut blank = base;
        blank["price_rules"][0]["sku_code"] = json!("   ");
        assert!(
            parse_activate_publication(&blank).is_err(),
            "whitespace is not a product name"
        );
    }
}

// ---- Master data flowing DOWN: the catalogue snapshot --------------------

/// A catalogue is delivered as an ordered run of chunks on the command lane.
///
/// It is not a command in the "do this now" sense — it is data — but it rides
/// the command lane on purpose. That lane is already contiguous, gap-free,
/// signed, revocable and acknowledged, and reusing it means a snapshot needs
/// no ordering rules, no anti-rollback protocol and no second connection of
/// its own. The reference implementations deliver snapshots out of band and
/// pay for it with exactly those three mechanisms.
pub const COMMAND_CATALOG_CHUNK: &str = "catalog.snapshot.chunk";

// ---- Identity and device policy flowing DOWN -----------------------------

/// Complete Cloud-owned authorization projection for exactly one Edge.
///
/// It rides the existing signed, ordered command lane.  Replacement is atomic:
/// an Edge either keeps its last-known-good projection or activates this whole
/// snapshot; it never observes a half-updated user/device set.
pub const COMMAND_AUTH_POLICY_REPLACE: &str = "auth.policy.replace";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AuthPolicyUser {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub credential_hash: String,
    pub active: bool,
    pub auth_version: i64,
    pub valid_until: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AuthPolicyDevice {
    pub device_id: String,
    pub label: String,
    pub auth_key_sha256: String,
    pub active: bool,
    pub pools: Vec<String>,
    pub valid_until: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AuthPolicySnapshot {
    pub snapshot_id: Uuid,
    pub version: i64,
    pub origin_id: String,
    pub site_id: String,
    pub node_role: String,
    pub issued_at: DateTime<Utc>,
    pub valid_until: DateTime<Utc>,
    pub content_hash: String,
    pub users: Vec<AuthPolicyUser>,
    pub devices: Vec<AuthPolicyDevice>,
}

pub fn auth_policy_content_hash(snapshot: &AuthPolicySnapshot) -> String {
    use sha2::{Digest as _, Sha256};
    let canonical = serde_json::to_vec(&(
        snapshot.version,
        &snapshot.origin_id,
        &snapshot.site_id,
        &snapshot.node_role,
        snapshot.issued_at,
        snapshot.valid_until,
        &snapshot.users,
        &snapshot.devices,
    ))
    .unwrap_or_default();
    hex::encode(Sha256::digest(canonical))
}

pub fn parse_auth_policy(payload: &Value) -> Result<AuthPolicySnapshot, String> {
    use std::collections::HashSet;

    let snapshot: AuthPolicySnapshot = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed {COMMAND_AUTH_POLICY_REPLACE} payload: {error}"))?;
    if snapshot.version < 1 {
        return Err("auth policy version must be positive".into());
    }
    if snapshot.origin_id.trim().is_empty() || snapshot.site_id.trim().is_empty() {
        return Err("auth policy origin_id and site_id are required".into());
    }
    if !matches!(snapshot.node_role.as_str(), "DC" | "STORE") {
        return Err("auth policy node_role must be DC or STORE".into());
    }
    if snapshot.valid_until <= snapshot.issued_at {
        return Err("auth policy valid_until must follow issued_at".into());
    }
    if snapshot.content_hash.len() != 64
        || !snapshot
            .content_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("auth policy content_hash must be 64 hex characters".into());
    }
    let mut user_ids = HashSet::new();
    let mut usernames = HashSet::new();
    for user in &snapshot.users {
        let normalized = crate::security::normalize_username(&user.username)?;
        if normalized != user.username {
            return Err(format!(
                "auth policy username '{}' is not canonical",
                user.username
            ));
        }
        if user.display_name.trim().is_empty() || user.display_name.len() > 128 {
            return Err(format!(
                "auth policy user {} has an invalid display name",
                user.username
            ));
        }
        if !matches!(user.role.as_str(), "CASHIER" | "SUPERVISOR" | "ADMIN") {
            return Err(format!(
                "auth policy user {} has an invalid role",
                user.username
            ));
        }
        if user.auth_version < 1 || user.credential_hash.trim().is_empty() {
            return Err(format!(
                "auth policy user {} has an invalid verifier",
                user.username
            ));
        }
        if user.valid_until > snapshot.valid_until {
            return Err(format!(
                "auth policy user {} outlives the snapshot",
                user.username
            ));
        }
        if !user_ids.insert(user.user_id) || !usernames.insert(user.username.clone()) {
            return Err("auth policy contains a duplicate user".into());
        }
    }
    let mut devices = HashSet::new();
    for device in &snapshot.devices {
        if device.device_id.trim().is_empty() || device.label.trim().is_empty() {
            return Err("auth policy device id and label are required".into());
        }
        if device.auth_key_sha256.len() != 64
            || !device
                .auth_key_sha256
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(format!(
                "RFID device {} has an invalid key digest",
                device.device_id
            ));
        }
        if device.valid_until > snapshot.valid_until {
            return Err(format!(
                "RFID device {} outlives the snapshot",
                device.device_id
            ));
        }
        if device.pools.is_empty() || device.pools.iter().any(|pool| pool.trim().is_empty()) {
            return Err(format!(
                "RFID device {} has no valid pool scope",
                device.device_id
            ));
        }
        if !devices.insert(device.device_id.clone()) {
            return Err("auth policy contains a duplicate RFID device".into());
        }
    }
    let expected = auth_policy_content_hash(&snapshot);
    if !crate::security::constant_time_eq(&expected, &snapshot.content_hash) {
        return Err("auth policy content hash does not match its contents".into());
    }
    Ok(snapshot)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct CatalogItem {
    pub sku_code: String,
    pub name: String,
    pub uom: String,
    #[serde(default)]
    pub barcode: Option<String>,
    pub tax_category: String,
    pub active: bool,
    /// Centre-authored base price used only when an Edge must create identity
    /// for a newly discovered Official Count gain EPC.
    #[serde(default)]
    pub base_price_minor: Option<i64>,
    /// The style this is a variant of, and what it is filed under.
    ///
    /// Carried so a shop can tell the pricing engine what a product IS, not
    /// only what it is called. A markdown or promotion written against a whole
    /// style, a division or a tag matches on these; without them it matches
    /// nothing, which is what every till in the fleet was doing.
    ///
    /// `default` on all three, so a node running an older build applies a newer
    /// catalogue without failing, and a newer node accepts an older payload. It
    /// prices correctly either way — it simply cannot see range-wide markdowns
    /// until both ends have been updated.
    #[serde(default)]
    pub article_code: Option<String>,
    #[serde(default)]
    pub division_code: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// The style's photograph, as the centre holds it.
    ///
    /// Delivered with the catalogue rather than looked up per node, because the
    /// two places a node could look it up — the tagging job that printed the
    /// labels and the purchase order line the goods were bought on — are DC
    /// work. A shop has neither, so before this every photograph lookup at a
    /// till resolved to nothing. See edge migration 0025.
    ///
    /// `default`, like the three above it: an older centre sends no picture and
    /// the shop simply has none to draw.
    #[serde(default)]
    pub image_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CatalogChunkPayload {
    pub snapshot_id: Uuid,
    /// Monotonic per fleet. An edge refuses a generation below the one it
    /// already honours, so a replayed or reordered publication cannot walk
    /// the catalogue backwards.
    pub generation: i64,
    pub chunk_index: u32,
    pub chunk_count: u32,
    /// SHA-256 over the canonical bytes of ALL items in the snapshot, in
    /// delivery order. Identical in every chunk, so the edge knows the target
    /// before the last chunk lands and can reject a set that does not add up.
    pub content_hash: String,
    pub items: Vec<CatalogItem>,
}

/// The bytes the content hash covers: every item, in order, one per line.
///
/// Deliberately not `serde_json::to_string` of the whole payload — that would
/// fold in chunk boundaries, so re-chunking the same catalogue would change
/// its identity.
///
/// # The style, division and tags are covered too
///
/// They were added after the first six fields, and covering them is a
/// deliberate choice with an operational cost: a node computing this over six
/// fields and a centre computing it over nine disagree, so the receiving
/// validator rejects the catalogue outright with `catalogue content hash
/// mismatch`. **Shops must be updated before or with the centre.**
///
/// The alternative — deliver them outside the hash — buys a painless rollout
/// and pays for it in the exact currency this system keeps losing: a field that
/// arrives truncated or empty passes every check, and the only symptom is a
/// range-wide markdown quietly not applying, weeks later, at one shop. That is
/// the bug this field exists to fix. A loud refusal that names itself is the
/// better failure.
pub fn catalog_content_bytes(items: &[CatalogItem]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for item in items {
        bytes.extend_from_slice(
            format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\n",
                item.sku_code,
                item.name,
                item.uom,
                item.barcode.as_deref().unwrap_or(""),
                item.tax_category,
                item.active,
                item.base_price_minor
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                item.article_code.as_deref().unwrap_or(""),
                item.division_code.as_deref().unwrap_or(""),
                // A separator that is not the field separator, so a tag list
                // can never be read as extra fields.
                item.tags.join("\u{1e}")
            )
            .as_bytes(),
        );
    }
    bytes
}

pub fn catalog_content_hash(items: &[CatalogItem]) -> String {
    use sha2::{Digest as _, Sha256};
    hex::encode(Sha256::digest(catalog_content_bytes(items)))
}

/// Parse and validate one chunk. `Err` blocks the command stream, which is
/// the right outcome: a catalogue the edge cannot make sense of must not be
/// silently skipped while later commands price against it.
pub fn parse_catalog_chunk(payload: &Value) -> Result<CatalogChunkPayload, String> {
    let chunk: CatalogChunkPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_CATALOG_CHUNK} payload: {e}"))?;
    if chunk.generation <= 0 {
        return Err("catalogue generation must be positive".into());
    }
    if chunk.chunk_count == 0 || chunk.chunk_index >= chunk.chunk_count {
        return Err(format!(
            "catalogue chunk {} is outside a run of {}",
            chunk.chunk_index, chunk.chunk_count
        ));
    }
    if chunk.content_hash.len() != 64 || !chunk.content_hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("catalogue content_hash must be 64 hex characters".into());
    }
    // An empty chunk in the middle of a run is almost certainly a producer
    // bug; an empty catalogue is expressed as a one-chunk run with no items.
    if chunk.items.is_empty() && chunk.chunk_count > 1 {
        return Err("catalogue chunk carries no items".into());
    }
    for item in &chunk.items {
        if item.sku_code.trim().is_empty() {
            return Err("catalogue item has an empty sku_code".into());
        }
        if item.name.trim().is_empty() {
            return Err(format!("catalogue item {} has no name", item.sku_code));
        }
        if item.uom.trim().is_empty() {
            return Err(format!("catalogue item {} has no uom", item.sku_code));
        }
        if item.tax_category.trim().is_empty() {
            return Err(format!(
                "catalogue item {} has no tax_category",
                item.sku_code
            ));
        }
        if item.base_price_minor.is_some_and(|price| price < 0) {
            return Err(format!(
                "catalogue item {} has a negative base_price_minor",
                item.sku_code
            ));
        }
    }
    Ok(chunk)
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use serde_json::json;

    fn item(sku: &str) -> CatalogItem {
        CatalogItem {
            sku_code: sku.into(),
            name: format!("Produk {sku}"),
            uom: "EA".into(),
            barcode: Some(format!("899{sku}")),
            tax_category: "STANDARD".into(),
            active: true,
            base_price_minor: Some(10_000),
            article_code: Some("ART-1".into()),
            division_code: Some("MENSWEAR".into()),
            tags: vec!["LEBARAN".into()],
            image_url: Some(format!("https://cdn.example/{sku}.jpg")),
        }
    }

    fn chunk(index: u32, count: u32, items: Vec<CatalogItem>) -> Value {
        json!({
            "snapshot_id": Uuid::new_v4(),
            "generation": 5,
            "chunk_index": index,
            "chunk_count": count,
            "content_hash": catalog_content_hash(&items),
            "items": items,
        })
    }

    #[test]
    fn a_well_formed_chunk_parses() {
        assert!(parse_catalog_chunk(&chunk(0, 2, vec![item("A1"), item("A2")])).is_ok());
    }

    #[test]
    fn the_hash_ignores_where_the_chunk_boundaries_fall() {
        // Re-chunking the same catalogue must not change its identity, or a
        // producer could never resume a delivery with a different batch size.
        let all = vec![item("A1"), item("A2"), item("A3")];
        let (left, right) = all.split_at(1);
        let mut rejoined = left.to_vec();
        rejoined.extend_from_slice(right);
        assert_eq!(catalog_content_hash(&all), catalog_content_hash(&rejoined));
    }

    #[test]
    fn the_hash_changes_when_an_item_changes() {
        let a = vec![item("A1")];
        let mut b = a.clone();
        b[0].name = "Diganti".into();
        assert_ne!(catalog_content_hash(&a), catalog_content_hash(&b));
    }

    #[test]
    fn a_chunk_outside_its_run_is_refused() {
        let mut bad = chunk(2, 2, vec![item("A1")]);
        assert!(parse_catalog_chunk(&bad).is_err());
        bad["chunk_index"] = json!(0);
        bad["chunk_count"] = json!(0);
        assert!(parse_catalog_chunk(&bad).is_err());
    }

    #[test]
    fn an_item_missing_required_fields_is_refused() {
        let mut blank_sku = chunk(0, 1, vec![item("A1")]);
        blank_sku["items"][0]["sku_code"] = json!("  ");
        assert!(parse_catalog_chunk(&blank_sku).is_err());
        let mut blank_uom = chunk(0, 1, vec![item("A1")]);
        blank_uom["items"][0]["uom"] = json!("");
        assert!(parse_catalog_chunk(&blank_uom).is_err());
    }

    #[test]
    fn a_bad_hash_is_refused_before_any_chunk_is_stored() {
        let mut bad = chunk(0, 1, vec![item("A1")]);
        bad["content_hash"] = json!("not-a-hash");
        assert!(parse_catalog_chunk(&bad).is_err());
    }
}

// ---- Money flowing UP: the completed sale --------------------------------

/// A finished sale, with the money on it.
///
/// The stock side of a sale already travels as an `inventory.movement`, so
/// the centre has always known that goods left the shop. What it has NOT
/// known is what they were sold for — which makes a sales report over thirty
/// shops impossible, and is the single largest gap in what this fleet
/// synchronises.
///
/// This is a separate fact rather than fields bolted onto the movement,
/// because the two answer different questions and have different audiences:
/// one is inventory authority, the other is revenue. They are joined by
/// `movement_group_id`, so a reconciliation can always ask "does the stock
/// that left match the stock that was billed".
pub const FACT_SALES_COMPLETED: &str = "sales.completed";

/// A shop reporting that it has put a price book into service.
///
/// Nobody presses a button for this. A shop that applies a publication says so
/// on its own, because the alternative is an operator ticking a list and being
/// wrong about it. Until this existed the centre published prices into silence:
/// there was no way to ask which shops were still selling at last season's
/// prices, and a shop whose sync had stalled looked exactly like one that was
/// up to date.
pub const FACT_PUBLICATION_ACTIVATED: &str = "commercial.publication.activated";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PublicationActivatedPayload {
    pub publication_id: Uuid,
    pub version: i64,
    /// When the shop put it into service — its own clock, which is the honest
    /// answer to "since when has this shop been charging these prices".
    ///
    /// Note what is NOT here: which shop. Every fact is already attributed to
    /// the origin that signed for it, and a shop naming itself in a payload
    /// would be a claim rather than an attribution — weaker than the one the
    /// lane already makes, and able to disagree with it.
    pub activated_at: DateTime<Utc>,
    /// How much of the book it holds, so a truncated delivery is visible as a
    /// number rather than as a wrong price weeks later.
    pub price_rule_count: i64,
}

pub fn parse_publication_activated(payload: &Value) -> Result<PublicationActivatedPayload, String> {
    let parsed: PublicationActivatedPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {FACT_PUBLICATION_ACTIVATED} payload: {e}"))?;
    if parsed.version <= 0 {
        return Err("an activated publication has a positive version".into());
    }
    if parsed.price_rule_count < 0 {
        return Err("a price rule count cannot be negative".into());
    }
    Ok(parsed)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SaleFactLine {
    pub subject_id: Uuid,
    pub epc: String,
    pub sku_code: String,
    pub quantity: i64,
    /// What one unit came to before any promotion — after the price list and
    /// any clearance, which is the number on the shelf edge.
    pub unit_price_minor: i64,
    /// What the line actually came to.
    ///
    /// A promotion acts on a line, not a unit, so this is not always a whole
    /// number of unit prices — "fifty thousand off the basket" apportions to
    /// amounts that do not divide evenly. It is the figure the shopper paid and
    /// the one the centre's revenue must be built from.
    ///
    /// Absent from a shop running a build that predates promotions, where the
    /// line was exactly its unit price times its quantity. That is a
    /// reconstruction of the old meaning, not a guess at the new one.
    #[serde(default)]
    pub line_total_minor: Option<i64>,
    /// What one unit would have cost before a clearance replaced the price.
    ///
    /// `price_source` already says a markdown applied; this says what it was
    /// worth. Without it the centre can report every rupiah a PROMOTION gave
    /// away — `edge_sale_promotion` carries that per rule — and nothing at all
    /// about what CLEARANCE cost, which for a fashion retailer is usually the
    /// larger of the two.
    ///
    /// Absent from a shop with no book in force, and from any build older than
    /// this field. Absent rather than equal to the charged price: "nothing was
    /// marked down" and "we do not know" are different, and only one of them
    /// belongs in a margin report.
    #[serde(default)]
    pub base_unit_price_minor: Option<i64>,
    /// Which clearance set the price, when one did.
    ///
    /// `price_source` says a markdown won and `base_unit_price_minor` says what
    /// it was worth; this says which one it was. Together they make a sold line
    /// self-describing, so "what did THIS clearance cost us across the fleet"
    /// is a group-by rather than a reconstruction from sku, version and date.
    #[serde(default)]
    pub markdown_id: Option<String>,
    /// Which authority set the price: the published book, a branch price, a
    /// clearance, a cashier's override, or the price stamped at intake.
    #[serde(default)]
    pub price_source: Option<String>,
    /// The exact price book this line was charged against.
    #[serde(default)]
    pub publication_version: Option<i64>,
}

impl SaleFactLine {
    /// What this line was charged.
    pub fn charged(&self) -> Result<i64, String> {
        match self.line_total_minor {
            Some(total) => Ok(total),
            None => self
                .unit_price_minor
                .checked_mul(self.quantity)
                .ok_or_else(|| format!("sale line {} overflows", self.epc)),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SalesCompletedPayload {
    pub sale_id: Uuid,
    /// The inventory fact this sale's stock movement was recorded under.
    pub movement_group_id: Uuid,
    pub site_id: String,
    pub actor_id: String,
    pub occurred_at: DateTime<Utc>,
    pub currency: String,
    pub total_minor: i64,
    pub paid_minor: i64,
    pub change_minor: i64,
    pub lines: Vec<SaleFactLine>,
    /// What the promotions took off, together. Zero from a shop that has none.
    #[serde(default)]
    pub discount_total_minor: i64,
    #[serde(default)]
    pub points_earned: i64,
    /// The fingerprint of the pricing decision behind this sale, so a disputed
    /// receipt can be reproduced rather than argued about.
    #[serde(default)]
    pub pricing_trace_id: Option<String>,
    /// The shopper, when the till knew them. Without this the points on a sale
    /// arrive with nobody to credit.
    #[serde(default)]
    pub customer_id: Option<String>,
    /// Which promotions actually came off, and what each was worth.
    ///
    /// Only the total used to travel, which left two questions unanswerable:
    /// what a promotion cost, and whether a single-use coupon had been spent.
    /// A shop reports what it gave away; the centre keeps the running totals,
    /// because no single shop can know what the others have spent.
    #[serde(default)]
    pub promotions: Vec<SaleFactPromotion>,
    /// How the sale was paid for. `default` because sales recorded before the
    /// till could take anything but cash carry none, and a shop on an older
    /// build still sells — an empty list means "not recorded", which is not the
    /// same as "paid nothing" and must not be read as it.
    #[serde(default)]
    pub tenders: Vec<SaleFactTender>,
}

/// How one sale was settled, as the shop recorded it.
///
/// `tender_seq` is the identity: a tender has no natural id, and its position
/// in the list the till captured is stable, so a fact delivered twice
/// overwrites the same row rather than recording one payment twice.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SaleFactTender {
    pub tender_seq: i32,
    pub method: String,
    pub amount_minor: i64,
    #[serde(default)]
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SaleFactPromotionLine {
    pub subject_id: Uuid,
    pub benefit_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SaleFactPromotion {
    pub rule_id: String,
    #[serde(default)]
    pub campaign_id: Option<String>,
    /// Set only when a code unlocked the promotion, so a code that was typed
    /// and refused is never counted as redeemed.
    #[serde(default)]
    pub coupon_code: Option<String>,
    pub benefit_minor: i64,
    /// Which sold units it came off, and for how much each.
    ///
    /// Absent from a shop running a build that predates it, which is why the
    /// sale-level `benefit_minor` stays authoritative: this is the attributed
    /// breakdown of that figure, not a replacement for it. A report that needs
    /// both influenced and attributed revenue reads the total from the row and
    /// the split from here, and says so when the split is missing rather than
    /// treating absence as zero.
    #[serde(default)]
    pub lines: Vec<SaleFactPromotionLine>,
}

/// Parse and validate a sale fact, arithmetic included.
///
/// The arithmetic is re-checked at the boundary rather than trusted. A shop
/// runs its own build and can be behind, or wrong; a sale whose lines do not
/// add up to its total would otherwise enter the centre's revenue figures
/// silently, and a silently wrong number is worse than a refused one.
pub fn parse_sales_completed(payload: &Value) -> Result<SalesCompletedPayload, String> {
    let sale: SalesCompletedPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {FACT_SALES_COMPLETED} payload: {e}"))?;
    if sale.lines.is_empty() {
        return Err("a completed sale has no lines".into());
    }
    if sale.site_id.trim().is_empty() || sale.actor_id.trim().is_empty() {
        return Err("a completed sale requires site_id and actor_id".into());
    }
    if sale.currency.len() != 3 {
        return Err("currency must be a three-letter code".into());
    }
    let mut computed: i64 = 0;
    for line in &sale.lines {
        if line.quantity <= 0 {
            return Err(format!(
                "sale line {} has a non-positive quantity",
                line.epc
            ));
        }
        if line.unit_price_minor < 0 {
            return Err(format!("sale line {} has a negative price", line.epc));
        }
        let amount = line.charged()?;
        if amount < 0 {
            return Err(format!(
                "sale line {} was charged a negative amount",
                line.epc
            ));
        }
        computed = computed
            .checked_add(amount)
            .ok_or_else(|| "sale total overflows".to_string())?;
    }
    if computed != sale.total_minor {
        return Err(format!(
            "sale lines add up to {computed} but the total says {}",
            sale.total_minor
        ));
    }
    // Tender must cover the sale, and the change must be exactly what is
    // left over — a till that hands back the wrong change is a cash
    // discrepancy the centre should hear about immediately, not at close.
    if sale.paid_minor < sale.total_minor {
        return Err(format!(
            "tender {} does not cover the total {}",
            sale.paid_minor, sale.total_minor
        ));
    }
    if sale
        .promotions
        .iter()
        .any(|promotion| promotion.rule_id.trim().is_empty() || promotion.benefit_minor < 0)
    {
        return Err("a sale promotion needs a rule_id and a benefit that is not negative".into());
    }
    // A promotion's per-line split, checked the way the sale's own arithmetic
    // is: re-derived here rather than believed.
    //
    // An empty split is a shop that does not send one yet and is accepted. A
    // split that is present and does not add up to the promotion's own total is
    // refused, because the two would then be stored side by side and every
    // report reading both would give a different answer depending on which it
    // happened to sum — the quietest kind of wrong number, and the kind this
    // system already refuses on the money side.
    for promotion in &sale.promotions {
        if promotion.lines.is_empty() {
            continue;
        }
        let mut apportioned = 0_i64;
        for line in &promotion.lines {
            if line.benefit_minor < 0 {
                return Err(format!(
                    "promotion {} claims a negative benefit on a line",
                    promotion.rule_id
                ));
            }
            // It must name a unit this sale actually sold. A subject from
            // another basket would attribute one shop's discount to another
            // sale's goods, and the join that reads it would look perfectly
            // healthy.
            if !sale
                .lines
                .iter()
                .any(|sold| sold.subject_id == line.subject_id)
            {
                return Err(format!(
                    "promotion {} names a unit this sale did not sell",
                    promotion.rule_id
                ));
            }
            apportioned = apportioned
                .checked_add(line.benefit_minor)
                .ok_or_else(|| format!("promotion {} overflows", promotion.rule_id))?;
        }
        if apportioned != promotion.benefit_minor {
            return Err(format!(
                "promotion {} says it took {} but its lines account for {}",
                promotion.rule_id, promotion.benefit_minor, apportioned
            ));
        }
    }
    if sale.paid_minor - sale.total_minor != sale.change_minor {
        return Err(format!(
            "change {} does not reconcile tender {} against total {}",
            sale.change_minor, sale.paid_minor, sale.total_minor
        ));
    }
    // And the tenders must add up to what was paid.
    //
    // Neither reference implementation checks this: both store a list of
    // payments beside a paid figure and trust whatever wrote them. The two then
    // disagree silently, and the disagreement surfaces at a bank
    // reconciliation as money with no transaction behind it — the single
    // hardest number in retail to chase, because by then the receipt, the
    // statement and the ledger have all been read by different people.
    //
    // An empty list is not a failure. Sales recorded before the till could take
    // anything but cash carry none, and a shop on an older build still sells:
    // "not recorded" is not "paid nothing", and only the first is legal here.
    if !sale.tenders.is_empty() {
        let mut settled: i64 = 0;
        let mut seen = std::collections::BTreeSet::new();
        for tender in &sale.tenders {
            if tender.amount_minor <= 0 {
                return Err(format!(
                    "tender {} on this sale is not a positive amount",
                    tender.tender_seq
                ));
            }
            if <crate::tender::PaymentMethod as std::str::FromStr>::from_str(&tender.method)
                .is_err()
            {
                return Err(format!("unknown tender method {}", tender.method));
            }
            if tender
                .reference
                .as_deref()
                .is_some_and(|reference| crate::tender::screen_reference(reference).is_err())
            {
                // Refused at the door rather than stored and regretted: a card
                // number that reaches a database has to be erased from every
                // backup of it.
                return Err("a payment reference must not look like a card number".into());
            }
            if !seen.insert(tender.tender_seq) {
                return Err(format!(
                    "two tenders on this sale share position {}",
                    tender.tender_seq
                ));
            }
            settled = settled
                .checked_add(tender.amount_minor)
                .ok_or_else(|| "the tenders add up to more than can be counted".to_string())?;
        }
        if settled != sale.paid_minor {
            return Err(format!(
                "the tenders add up to {settled} but the sale says {} was paid",
                sale.paid_minor
            ));
        }
    }
    Ok(sale)
}

#[cfg(test)]
mod sales_fact_tests {
    use super::*;
    use serde_json::json;

    fn sale(total: i64, paid: i64, change: i64, unit: i64) -> Value {
        json!({
            "sale_id": Uuid::new_v4(),
            "movement_group_id": Uuid::new_v4(),
            "site_id": "store-07",
            "actor_id": "kasir-1",
            "occurred_at": Utc::now(),
            "currency": "IDR",
            "total_minor": total,
            "paid_minor": paid,
            "change_minor": change,
            "lines": [{
                "subject_id": Uuid::new_v4(),
                "epc": "EPC00000001",
                "sku_code": "BERAS-5KG",
                "quantity": 1,
                "unit_price_minor": unit
            }],
        })
    }

    #[test]
    fn a_sale_that_adds_up_is_accepted() {
        assert!(parse_sales_completed(&sale(25_000, 50_000, 25_000, 25_000)).is_ok());
    }

    #[test]
    fn lines_that_do_not_match_the_total_are_refused() {
        // The shop claims 25,000 but its only line is 20,000.
        assert!(parse_sales_completed(&sale(25_000, 25_000, 0, 20_000)).is_err());
    }

    #[test]
    fn tender_below_the_total_is_refused() {
        assert!(parse_sales_completed(&sale(25_000, 20_000, 0, 25_000)).is_err());
    }

    #[test]
    fn change_that_does_not_reconcile_is_refused() {
        // Paid 50,000 for 25,000 but handed back 20,000: a 5,000 cash hole.
        assert!(parse_sales_completed(&sale(25_000, 50_000, 20_000, 25_000)).is_err());
    }

    #[test]
    fn a_sale_with_no_lines_is_refused() {
        let mut empty = sale(0, 0, 0, 0);
        empty["lines"] = json!([]);
        assert!(parse_sales_completed(&empty).is_err());
    }
}

// ---- Purchase orders: raised at the centre, worked at a DC ---------------

/// A purchase order travelling down to the DC that will receive it.
///
/// The DC does not get the commercial terms it has no business seeing — it
/// gets what it needs to receive against: which items, how many, in what
/// unit, and by when. Price stays at the centre.
pub const COMMAND_PURCHASE_ORDER_ACTIVATE: &str = "purchase.order.activate";

/// A DC reporting what physically arrived against a PO line.
/// One line of a delivery, counted and accepted by a second person.
pub const FACT_GOODS_RECEIPT_LINE: &str = "goods_receipt.line";

/// The supplier's invoice, as the verifier read it off the paper.
pub const FACT_GOODS_RECEIPT_INVOICE: &str = "goods_receipt.invoice";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct PurchaseOrderLinePayload {
    pub po_line_id: Uuid,
    pub line_number: i32,
    pub article_code: String,
    pub article_name: String,
    #[serde(default)]
    pub image_url: Option<String>,
    /// Where the buyer files it. A preset for the setup form later, never a
    /// decision — head office may replace it once the goods are identified.
    #[serde(default)]
    pub division_code: Option<String>,
    /// Likewise, and from the same vocabulary the master article uses. One
    /// spelling of "kemeja" exists in this system, and this is it.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Pieces. This company orders in pieces, so there is no second unit and
    /// nothing to convert.
    pub ordered_quantity: i64,
    /// What the order agreed to pay, per piece.
    ///
    /// This DOES travel to the warehouse, and only to the verifier's view of
    /// it. The supplier's invoice arrives on the lorry with the goods, so the
    /// verifier is holding one of the two numbers already; withholding the
    /// other would be asking them to check a match against something they
    /// cannot see. The checker still sees neither — they are counting, not
    /// comparing.
    pub unit_price_minor: i64,
    #[serde(default)]
    pub promised_date: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PurchaseOrderPayload {
    pub purchase_order_id: Uuid,
    pub po_number: String,
    pub supplier_id: String,
    #[serde(default)]
    pub supplier_name: Option<String>,
    /// The DC this order is for. The command is addressed to exactly this
    /// site, never broadcast: goods arrive somewhere specific.
    pub destination_site_id: String,
    pub lines: Vec<PurchaseOrderLinePayload>,
}

/// Parse and validate a purchase order for a DC to work against.
pub fn parse_purchase_order(payload: &Value) -> Result<PurchaseOrderPayload, String> {
    let order: PurchaseOrderPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_PURCHASE_ORDER_ACTIVATE} payload: {e}"))?;
    if order.po_number.trim().is_empty() {
        return Err("purchase order needs a number".into());
    }
    if order.supplier_id.trim().is_empty() {
        return Err("purchase order needs a supplier".into());
    }
    if order.destination_site_id.trim().is_empty() {
        return Err("purchase order needs a destination site".into());
    }
    if order.lines.is_empty() {
        return Err("purchase order has no lines".into());
    }
    let mut seen_numbers = std::collections::HashSet::new();
    for line in &order.lines {
        if !seen_numbers.insert(line.line_number) {
            return Err(format!("line number {} appears twice", line.line_number));
        }
        if line.ordered_quantity <= 0 {
            return Err(format!(
                "line {} orders a non-positive quantity",
                line.line_number
            ));
        }
        if line.article_code.trim().is_empty() || line.article_name.trim().is_empty() {
            return Err(format!(
                "line {} needs an article_code and an article_name",
                line.line_number
            ));
        }
        for tag in &line.tags {
            if tag.trim().is_empty() {
                return Err(format!("line {} carries a blank tag", line.line_number));
            }
        }
    }
    Ok(order)
}

/// One accepted line of a delivery, carrying enough of its document for the
/// centre to know what it belongs to.
///
/// The header rides along rather than travelling as its own fact. Two fact
/// types would need an ordering rule between them — "the header must arrive
/// first" — and a rule like that is one more way for a stream to block. This
/// way each line is self-contained and the centre upserts the document.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GoodsReceiptLinePayload {
    // --- the document ---
    pub receipt_id: Uuid,
    pub receipt_number: String,
    pub supplier_id: String,
    pub arrived_at: DateTime<Utc>,
    pub opened_by: String,
    pub opened_at: DateTime<Utc>,

    // --- this line ---
    pub receipt_line_id: Uuid,
    pub po_line_id: Uuid,
    pub movement_group_id: Uuid,
    /// Pieces.
    pub quantity: i64,
    /// Who counted the delivery.
    pub counted_by: String,
    /// Who accepted that count. A line only travels once both exist, and they
    /// must be different people: one person who can both count goods in and
    /// approve their own count can sign phantom stock onto the shelf, and no
    /// later report would show anything wrong.
    pub verified_by: String,
    pub counted_at: DateTime<Utc>,
    pub verified_at: DateTime<Utc>,
}

pub fn parse_goods_receipt_line(payload: &Value) -> Result<GoodsReceiptLinePayload, String> {
    let line: GoodsReceiptLinePayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {FACT_GOODS_RECEIPT_LINE} payload: {e}"))?;
    if line.quantity <= 0 {
        return Err("a receipt of nothing is not a receipt".into());
    }
    if line.receipt_number.trim().is_empty() {
        return Err("a goods receipt must have a number".into());
    }
    if line.supplier_id.trim().is_empty() {
        return Err("a goods receipt must name its supplier".into());
    }
    if line.counted_by.trim().is_empty() {
        return Err("a receipt line must name who counted it".into());
    }
    if line.verified_by.trim().is_empty() {
        return Err("a receipt line must name who accepted it".into());
    }
    // The centre enforces this too, not only the DC. A node running an older
    // or altered build must not be able to put unverified stock on the books.
    if line.counted_by.trim() == line.verified_by.trim() {
        return Err(format!(
            "{} both counted and accepted this delivery; receiving requires two people",
            line.counted_by
        ));
    }
    Ok(line)
}

/// The supplier's invoice, recorded against a delivery.
///
/// It arrives on the same lorry as the goods, so the verifier is holding it.
/// This is the only route by which the system ever learns what was actually
/// billed — nothing else in the estate can see that piece of paper.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GoodsReceiptInvoicePayload {
    pub receipt_id: Uuid,
    pub invoice_number: String,
    #[serde(default)]
    pub invoice_date: Option<String>,
    pub invoice_total_minor: i64,
    /// Where the scan lives. A reference, not the bytes.
    #[serde(default)]
    pub invoice_document_ref: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
}

pub fn parse_goods_receipt_invoice(payload: &Value) -> Result<GoodsReceiptInvoicePayload, String> {
    let invoice: GoodsReceiptInvoicePayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {FACT_GOODS_RECEIPT_INVOICE} payload: {e}"))?;
    if invoice.invoice_number.trim().is_empty() {
        return Err("an invoice must have a number".into());
    }
    if invoice.invoice_total_minor < 0 {
        return Err("an invoice total cannot be negative".into());
    }
    if invoice.recorded_by.trim().is_empty() {
        return Err("an invoice must name who recorded it".into());
    }
    Ok(invoice)
}

#[cfg(test)]
mod purchase_tests {
    use super::*;
    use serde_json::json;

    fn order(lines: Value) -> Value {
        json!({
            "purchase_order_id": Uuid::new_v4(),
            "po_number": "PO-000001",
            "supplier_id": "SUP-01",
            "supplier_name": "PT Sumber Pangan",
            "destination_site_id": "dc-01",
            "lines": lines,
        })
    }

    fn line(number: i32, qty: i64) -> Value {
        json!({
            "po_line_id": Uuid::new_v4(),
            "line_number": number,
            "article_code": "SANDANG-KMJ-LP-01",
            "article_name": "Kemeja Lengan Panjang",
            "division_code": "MENSWEAR",
            "tags": ["KEMEJA", "LENGAN_PANJANG"],
            "ordered_quantity": qty,
            "unit_price_minor": 300_000,
            "promised_date": "2026-09-15"
        })
    }

    #[test]
    fn a_sound_order_parses() {
        let parsed = parse_purchase_order(&order(json!([line(1, 120), line(2, 60)])))
            .unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(parsed.lines.len(), 2);
        // Pieces, straight through. Nothing to convert, so nothing to get
        // wrong twice.
        assert_eq!(parsed.lines[0].ordered_quantity, 120);
        assert_eq!(parsed.lines[0].division_code.as_deref(), Some("MENSWEAR"));
        assert_eq!(parsed.lines[0].tags, vec!["KEMEJA", "LENGAN_PANJANG"]);
    }

    #[test]
    fn duplicate_line_numbers_are_refused() {
        assert!(parse_purchase_order(&order(json!([line(1, 10), line(1, 5)]))).is_err());
    }

    #[test]
    fn an_order_with_no_lines_or_no_destination_is_refused() {
        assert!(parse_purchase_order(&order(json!([]))).is_err());
        let mut homeless = order(json!([line(1, 1)]));
        homeless["destination_site_id"] = json!("  ");
        assert!(parse_purchase_order(&homeless).is_err());
    }

    #[test]
    fn a_blank_tag_is_refused() {
        // An empty tag would join the article to a vocabulary entry that
        // cannot exist, and read on screen as no tag at all.
        let mut blank = order(json!([line(1, 10)]));
        blank["lines"][0]["tags"] = json!(["KEMEJA", "  "]);
        assert!(parse_purchase_order(&blank).is_err());
    }

    fn receipt_line() -> Value {
        json!({
            "receipt_id": Uuid::new_v4(),
            "receipt_number": "GRN-dc-01-000001",
            "supplier_id": "SUP-01",
            "arrived_at": Utc::now(),
            "opened_by": "penerima-1",
            "opened_at": Utc::now(),
            "receipt_line_id": Uuid::new_v4(),
            "po_line_id": Uuid::new_v4(),
            "movement_group_id": Uuid::new_v4(),
            "quantity": 118,
            "counted_by": "checker-1",
            "verified_by": "verifier-1",
            "counted_at": Utc::now(),
            "verified_at": Utc::now(),
        })
    }

    #[test]
    fn a_receipt_line_must_be_of_something_and_by_two_people() {
        let sound = receipt_line();
        assert!(parse_goods_receipt_line(&sound).is_ok());

        let mut nothing = sound.clone();
        nothing["quantity"] = json!(0);
        assert!(parse_goods_receipt_line(&nothing).is_err());

        let mut nobody = sound.clone();
        nobody["counted_by"] = json!("");
        assert!(parse_goods_receipt_line(&nobody).is_err());

        // One pair of hands cannot both count and approve. The centre checks
        // this too, so a node running an altered build cannot put unverified
        // stock onto the books.
        let mut alone = sound.clone();
        alone["verified_by"] = json!("checker-1");
        assert!(parse_goods_receipt_line(&alone).is_err());

        // A line that names no document cannot be filed against one.
        let mut unnumbered = sound;
        unnumbered["receipt_number"] = json!("  ");
        assert!(parse_goods_receipt_line(&unnumbered).is_err());
    }

    #[test]
    fn an_invoice_must_have_a_number_and_a_recorder() {
        let sound = json!({
            "receipt_id": Uuid::new_v4(),
            "invoice_number": "INV-99120",
            "invoice_date": "2026-08-30",
            "invoice_total_minor": 35_400_000_i64,
            "recorded_by": "verifier-1",
            "recorded_at": Utc::now(),
        });
        assert!(parse_goods_receipt_invoice(&sound).is_ok());

        let mut unnumbered = sound.clone();
        unnumbered["invoice_number"] = json!("");
        assert!(parse_goods_receipt_invoice(&unnumbered).is_err());

        let mut negative = sound;
        negative["invoice_total_minor"] = json!(-1);
        assert!(parse_goods_receipt_invoice(&negative).is_err());
    }
}

// ---- A question going up, and an answer coming down ----------------------

/// A DC asking head office to change a price it is being billed at.
///
/// This is the first thing in the fleet that travels as a question. It uses
/// no new lane: a request is a fact, its answer is a command, and the two are
/// joined by the request's own id. That is the whole mechanism — the fact lane
/// and the command lane already guarantee ordering, delivery and
/// acknowledgement in both directions, so a request/response needs only a
/// correlation and a convention about who may answer.
pub const FACT_PRICE_AMENDMENT_REQUESTED: &str = "purchase.price_amendment.requested";

/// Head office's answer, addressed back to the DC that asked.
pub const COMMAND_PRICE_AMENDMENT_DECIDED: &str = "purchase.price_amendment.decided";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PriceAmendmentRequestPayload {
    pub request_id: Uuid,
    pub po_line_id: Uuid,
    /// The count this request is holding up. The verifier raised it INSTEAD
    /// of accepting, so the delivery waits for the answer.
    pub count_id: Uuid,
    /// What the invoice in the verifier's hand actually said, per unit.
    pub invoiced_price_minor: i64,
    pub note: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
}

pub fn parse_price_amendment_request(
    payload: &Value,
) -> Result<PriceAmendmentRequestPayload, String> {
    let request: PriceAmendmentRequestPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {FACT_PRICE_AMENDMENT_REQUESTED} payload: {e}"))?;
    if request.invoiced_price_minor < 0 {
        return Err("an invoiced price cannot be negative".into());
    }
    if request.note.trim().is_empty() {
        return Err("a price amendment must say what the invoice showed".into());
    }
    if request.requested_by.trim().is_empty() {
        return Err("a price amendment must name who raised it".into());
    }
    Ok(request)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum PriceAmendmentOutcome {
    /// The order's price is changed to what the invoice said.
    Approved,
    /// The order stands. The DC may still accept the delivery — a price
    /// dispute is not a reason to leave goods on the bay — but the disagreement
    /// is now on record against the supplier.
    Rejected,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PriceAmendmentDecisionPayload {
    /// The request being answered. This is the whole of the request/response
    /// mechanism: an answer that names no question is not an answer.
    pub causation_request_id: Uuid,
    pub po_line_id: Uuid,
    pub count_id: Uuid,
    pub outcome: PriceAmendmentOutcome,
    /// Set when approved: the price the order now carries. The DC is told it
    /// so the verifier can see their own reading confirmed — not so the
    /// warehouse learns what anything costs.
    #[serde(default)]
    pub approved_price_minor: Option<i64>,
    pub decided_by: String,
    #[serde(default)]
    pub decision_note: Option<String>,
    pub decided_at: DateTime<Utc>,
}

pub fn parse_price_amendment_decision(
    payload: &Value,
) -> Result<PriceAmendmentDecisionPayload, String> {
    let decision: PriceAmendmentDecisionPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_PRICE_AMENDMENT_DECIDED} payload: {e}"))?;
    if decision.decided_by.trim().is_empty() {
        return Err("a decision must name who made it".into());
    }
    match (decision.outcome, decision.approved_price_minor) {
        (PriceAmendmentOutcome::Approved, None) => {
            Err("an approved amendment must say what the price became".into())
        }
        (PriceAmendmentOutcome::Approved, Some(price)) if price < 0 => {
            Err("an approved price cannot be negative".into())
        }
        (PriceAmendmentOutcome::Rejected, Some(_)) => {
            Err("a rejected amendment must not carry a new price".into())
        }
        _ => Ok(decision),
    }
}

// ---------------------------------------------------------------------------
// Tagging: identity travelling down, and its completion travelling back
// ---------------------------------------------------------------------------

/// The work order that carries a settled identity to the goods it belongs to.
///
/// This is the command that turns "118 pieces of something we ordered" into
/// "60 red mediums and 58 red larges, here are their labels". It goes down the
/// same lane as every other instruction; nothing new was needed to carry it.
pub const COMMAND_TAGGING_JOB_ACTIVATE: &str = "tagging.job.activate";

/// A DC reporting that the labels are on the goods.
pub const FACT_TAGGING_COMPLETED: &str = "tagging.completed";

/// The most units one job may carry.
///
/// A command is delivered whole or not at all, and every EPC in this payload
/// is a finished 24-character string. A job of a hundred thousand units would
/// be a multi-megabyte command that blocks the DC's entire command stream
/// while it moves. Deliveries larger than this are split into several jobs,
/// which is also how a warehouse would work through them anyway.
pub const MAX_TAGGING_JOB_UNITS: i64 = 5_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaggingJobLine {
    pub sku_code: String,
    pub colour_digit: String,
    pub colour_label: String,
    pub size_code: String,
    pub size_label: String,
    pub quantity: i64,
    /// One per SKU, identical on every unit: what the item IS.
    pub qr_payload: String,
    pub barcode_payload: String,
    /// The price this SKU was given at setup. Commercial publication may
    /// override it later; this is the floor underneath, so a SKU tagged today
    /// is sellable today.
    pub base_price_minor: i64,
    /// Finished EPC strings, one per unit, minted at the centre.
    ///
    /// They are carried rather than derived because the edge does not encode.
    /// The encoding rule exists once in this system, and a second copy of it
    /// that drifted by one bit would write tags nothing can read back — which
    /// on a warehouse floor looks like stock going missing, not like a bug.
    pub epcs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaggingJobPayload {
    pub job_id: Uuid,
    pub session_id: Uuid,
    /// The line of the delivery these goods came in on. This is what lets the
    /// DC find the exact pile this job is about: the same identifier it minted
    /// when the verifier accepted the count, come back down with an answer
    /// attached.
    pub receipt_line_id: Uuid,
    pub site_id: String,
    pub article_code: String,
    pub article_name: String,
    #[serde(default)]
    pub image_url: Option<String>,
    /// What the delivery was counted at. The lines must sum to exactly this.
    pub total_quantity: i64,
    pub issued_at: DateTime<Utc>,
    pub lines: Vec<TaggingJobLine>,
}

pub fn parse_tagging_job(payload: &Value) -> Result<TaggingJobPayload, String> {
    let job: TaggingJobPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {COMMAND_TAGGING_JOB_ACTIVATE} payload: {e}"))?;
    if job.article_name.trim().is_empty() {
        return Err("a tagging job must name the article".into());
    }
    if job.site_id.trim().is_empty() {
        return Err("a tagging job must name the site that will do it".into());
    }
    crate::cloud::domain::validate_article_code(&job.article_code)?;
    if job.lines.is_empty() {
        return Err("a tagging job with no lines has nothing to tag".into());
    }

    let mut total = 0i64;
    let mut seen_skus = std::collections::HashSet::new();
    let mut seen_epcs = std::collections::HashSet::new();
    for line in &job.lines {
        crate::cloud::domain::validate_sku_code(&line.sku_code)?;
        if !seen_skus.insert(line.sku_code.clone()) {
            return Err(format!("SKU {} appears on two lines", line.sku_code));
        }
        // A SKU must belong to the article this job is for; otherwise a job
        // for one product would quietly tag goods as another.
        if !line.sku_code.starts_with(&job.article_code) {
            return Err(format!(
                "SKU {} does not belong to article {}",
                line.sku_code, job.article_code
            ));
        }
        if line.quantity <= 0 {
            return Err(format!("line {} tags nothing", line.sku_code));
        }
        if line.base_price_minor < 0 {
            return Err(format!("line {} has a negative price", line.sku_code));
        }
        if line.qr_payload.trim().is_empty() || line.barcode_payload.trim().is_empty() {
            return Err(format!(
                "line {} needs a QR and a barcode payload",
                line.sku_code
            ));
        }
        // One label per unit. A job that says 60 and carries 59 tags would
        // leave one garment untagged with nothing to show which.
        if line.epcs.len() as i64 != line.quantity {
            return Err(format!(
                "line {} tags {} units but carries {} EPCs",
                line.sku_code,
                line.quantity,
                line.epcs.len()
            ));
        }
        for epc in &line.epcs {
            // Decoding here is not a second implementation of the rule — it
            // is the same one, asked in reverse. It catches a centre that
            // minted the wrong tags BEFORE a warehouse prints them onto
            // garments, which is the last moment the mistake is cheap.
            let (sku, _) = crate::cloud::domain::decode_epc(epc)?;
            if sku != line.sku_code {
                return Err(format!(
                    "EPC {epc} on line {} decodes to SKU {sku}",
                    line.sku_code
                ));
            }
            if !seen_epcs.insert(epc.to_ascii_lowercase()) {
                return Err(format!(
                    "EPC {epc} appears twice: two garments cannot share one identity"
                ));
            }
        }
        total = total
            .checked_add(line.quantity)
            .ok_or_else(|| "tagging job quantities overflow".to_string())?;
    }

    if total != job.total_quantity {
        return Err(format!(
            "the variants account for {total} units but the delivery was {}: \
             a tagging job must neither invent stock nor leave any behind",
            job.total_quantity
        ));
    }
    if total > MAX_TAGGING_JOB_UNITS {
        return Err(format!(
            "a tagging job of {total} units exceeds the {MAX_TAGGING_JOB_UNITS} limit; \
             split the delivery into several jobs"
        ));
    }
    Ok(job)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaggingCompletedLine {
    pub sku_code: String,
    pub quantity: i64,
}

/// What the DC sends back when the tags are on the goods.
///
/// It does not report the EPCs. Those travel anyway, on the movement facts
/// that carry each newly tagged unit into the warehouse — asking for them
/// twice would create a second version of the truth to reconcile against the
/// first.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TaggingCompletedPayload {
    pub job_id: Uuid,
    pub session_id: Uuid,
    pub movement_group_id: Uuid,
    pub confirmed_by: String,
    pub confirmed_at: DateTime<Utc>,
    pub lines: Vec<TaggingCompletedLine>,
}

pub fn parse_tagging_completed(payload: &Value) -> Result<TaggingCompletedPayload, String> {
    let done: TaggingCompletedPayload = serde_json::from_value(payload.clone())
        .map_err(|e| format!("malformed {FACT_TAGGING_COMPLETED} payload: {e}"))?;
    if done.confirmed_by.trim().is_empty() {
        return Err("a tagging confirmation must name who gave it".into());
    }
    if done.lines.is_empty() {
        return Err("a tagging confirmation with no lines confirms nothing".into());
    }
    for line in &done.lines {
        crate::cloud::domain::validate_sku_code(&line.sku_code)?;
        if line.quantity <= 0 {
            return Err(format!("line {} confirms nothing", line.sku_code));
        }
    }
    Ok(done)
}

#[cfg(test)]
mod tagging_tests {
    use super::*;
    use crate::cloud::domain::encode_epc_range;
    use serde_json::json;

    fn line(sku: &str, quantity: i64, start: u64) -> Value {
        json!({
            "sku_code": sku,
            "colour_digit": &sku[8..9],
            "colour_label": "Merah",
            "size_code": &sku[9..],
            "size_label": "M",
            "quantity": quantity,
            "qr_payload": format!("R1:{sku}"),
            "barcode_payload": format!("8{sku}"),
            "base_price_minor": 150_000,
            "epcs": encode_epc_range(sku, start, quantity as u64)
                .unwrap_or_else(|e| panic!("range: {e}")),
        })
    }

    fn job(lines: Vec<Value>, total: i64) -> Value {
        json!({
            "job_id": Uuid::new_v4(),
            "session_id": Uuid::new_v4(),
            "receipt_line_id": Uuid::new_v4(),
            "site_id": "dc-01",
            "article_code": "12345678",
            "article_name": "Kemeja Lengan Panjang",
            "total_quantity": total,
            "issued_at": Utc::now(),
            "lines": lines,
        })
    }

    #[test]
    fn a_sound_job_parses() {
        let sound = job(
            vec![line("12345678103", 60, 1), line("12345678104", 58, 1)],
            118,
        );
        let parsed = parse_tagging_job(&sound).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.lines[0].epcs.len(), 60);
    }

    #[test]
    fn variants_that_do_not_sum_to_the_delivery_are_refused() {
        // 60 + 58 = 118. Claiming the delivery was 120 would mint two
        // garments that never arrived; claiming 100 would strand eighteen in
        // `unidentified` with no job to rescue them.
        for claimed in [120, 100] {
            let wrong = job(
                vec![line("12345678103", 60, 1), line("12345678104", 58, 1)],
                claimed,
            );
            let Err(error) = parse_tagging_job(&wrong) else {
                panic!("a job that does not balance must be refused")
            };
            assert!(error.contains("118"), "{error}");
        }
    }

    #[test]
    fn a_line_whose_labels_do_not_match_its_count_is_refused() {
        let mut short = job(vec![line("12345678103", 60, 1)], 60);
        short["lines"][0]["quantity"] = json!(61);
        short["total_quantity"] = json!(61);
        assert!(parse_tagging_job(&short).is_err());
    }

    #[test]
    fn the_same_epc_twice_is_refused() {
        let mut twice = job(vec![line("12345678103", 2, 1)], 2);
        let first = twice["lines"][0]["epcs"][0].clone();
        twice["lines"][0]["epcs"][1] = first;
        let Err(error) = parse_tagging_job(&twice) else {
            panic!("duplicate EPCs must be refused")
        };
        assert!(error.contains("cannot share one identity"), "{error}");
    }

    #[test]
    fn an_epc_that_decodes_to_another_sku_is_caught_before_it_is_printed() {
        // The centre minted tags for the wrong SKU. Catching it here is the
        // last moment it costs nothing; the next stop is a printer.
        let mut crossed = job(vec![line("12345678103", 2, 1)], 2);
        crossed["lines"][0]["epcs"][0] =
            json!(encode_epc_range("12345678104", 1, 1).unwrap_or_else(|e| panic!("{e}"))[0]);
        let Err(error) = parse_tagging_job(&crossed) else {
            panic!("crossed EPCs must be refused")
        };
        assert!(error.contains("decodes to SKU"), "{error}");
    }

    #[test]
    fn a_sku_from_another_article_cannot_ride_along() {
        let foreign = job(vec![line("87654321103", 5, 1)], 5);
        let Err(error) = parse_tagging_job(&foreign) else {
            panic!("foreign SKU must be refused")
        };
        assert!(error.contains("does not belong to article"), "{error}");
    }

    #[test]
    fn a_job_too_large_to_deliver_is_refused_at_the_desk() {
        let huge = job(
            vec![line("12345678103", MAX_TAGGING_JOB_UNITS + 1, 1)],
            MAX_TAGGING_JOB_UNITS + 1,
        );
        let Err(error) = parse_tagging_job(&huge) else {
            panic!("an oversized job must be refused")
        };
        assert!(error.contains("split the delivery"), "{error}");
    }

    #[test]
    fn a_confirmation_must_say_who_gave_it() {
        let sound = json!({
            "job_id": Uuid::new_v4(),
            "session_id": Uuid::new_v4(),
            "movement_group_id": Uuid::new_v4(),
            "confirmed_by": "petugas-tag",
            "confirmed_at": Utc::now(),
            "lines": [{"sku_code": "12345678103", "quantity": 60}],
        });
        assert!(parse_tagging_completed(&sound).is_ok());
        let mut anonymous = sound;
        anonymous["confirmed_by"] = json!("  ");
        assert!(parse_tagging_completed(&anonymous).is_err());
    }
}

#[cfg(test)]
mod price_amendment_tests {
    use super::*;
    use serde_json::json;

    fn decision(outcome: &str, price: Value) -> Value {
        json!({
            "causation_request_id": Uuid::new_v4(),
            "po_line_id": Uuid::new_v4(),
            "count_id": Uuid::new_v4(),
            "outcome": outcome,
            "approved_price_minor": price,
            "decided_by": "buyer-1",
            "decided_at": Utc::now(),
        })
    }

    #[test]
    fn a_request_must_say_what_the_invoice_showed() {
        let sound = json!({
            "request_id": Uuid::new_v4(),
            "po_line_id": Uuid::new_v4(),
            "count_id": Uuid::new_v4(),
            "invoiced_price_minor": 310_000,
            "note": "Invoice supplier tertulis 310.000, PO 300.000",
            "requested_by": "supervisor-1",
            "requested_at": Utc::now(),
        });
        assert!(parse_price_amendment_request(&sound).is_ok());
        let mut silent = sound;
        silent["note"] = json!("   ");
        assert!(
            parse_price_amendment_request(&silent).is_err(),
            "a request with no explanation gives head office nothing to decide on"
        );
    }

    #[test]
    fn an_approval_must_carry_the_price_it_approved() {
        assert!(parse_price_amendment_decision(&decision("Approved", json!(310_000))).is_ok());
        assert!(parse_price_amendment_decision(&decision("Approved", Value::Null)).is_err());
    }

    #[test]
    fn a_rejection_must_not_smuggle_a_price_change() {
        // A refusal that quietly carries a new price would change the order
        // while telling everyone it did not.
        assert!(parse_price_amendment_decision(&decision("Rejected", Value::Null)).is_ok());
        assert!(parse_price_amendment_decision(&decision("Rejected", json!(310_000))).is_err());
    }
}
