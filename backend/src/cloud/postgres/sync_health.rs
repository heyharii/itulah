//! The sync lane read from both ends at once, and whether the whole thing is
//! safe to leave running.
//!
//! `/sync/status` knows facts per stream and nothing about commands;
//! `/sync/fleet` knows commands per node and nothing about facts. Neither can
//! answer the operator's actual question — *is data moving between the centre
//! and every shop, in both directions, and is anything stuck* — so this is the
//! join the two never make, plus the security posture the same person asks
//! about in the same breath.
//!
//! Everything here is a READ. Thresholds are policy and arrive as arguments
//! (the convention `sync_health_state` set); the classification is a pure
//! function over the row so it can be tested without a database.
//!
//! What the centre cannot see, and this endpoint therefore does not pretend
//! to: a node's own backlog depth, its breaker, its last error. Those live in
//! the node's SQLite and never ride the batch. Silence and lag are inferred
//! from what does arrive — `sync_ingest_watermark.last_received_at` is bumped
//! on every cycle, empty batches included, so it is a heartbeat.

use super::{breaker_is_open, seconds_since, sync_health_state, sync_snapshot};
use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Where one node stands, in one word.
///
/// Ordered by how urgently a person is needed. `Stalled` is the only state
/// that never clears itself: a blocked command or a blocked fact holds every
/// later one behind it until somebody acts.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LaneStatus {
    /// Spoke recently, nothing owed in either direction.
    Healthy,
    /// Spoke recently, but the centre is still waiting on it — commands it has
    /// not applied, or facts the centre has received and not yet applied.
    Lagging,
    /// A command or a fact is blocked. Nothing behind it moves.
    Stalled,
    /// Has spoken before and has not for longer than the threshold.
    Silent,
    /// Registered, never once contacted the centre.
    Never,
}

/// The one-word answer for the whole system.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthVerdict {
    Healthy,
    Attention,
    Stalled,
}

/// What a security check found, as a tone the console can draw directly.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckTone {
    Ok,
    Warn,
    Bad,
}

/// Why a stream of facts stopped being applied into the centre's ledger.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct LaneBlock {
    pub seq: i64,
    pub reason: Option<String>,
    pub since: Option<DateTime<Utc>>,
    pub age_seconds: Option<f64>,
}

/// The command a node stopped at, and what it was.
///
/// The command itself is looked up so the operator can see WHICH command
/// jammed the lane without tracing a sequence number by hand — and whether it
/// has already been revoked, in which case the next cycle clears it.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct StuckCommand {
    pub seq: i64,
    pub reason: Option<String>,
    pub since: Option<DateTime<Utc>>,
    pub age_seconds: Option<f64>,
    pub command_id: Option<Uuid>,
    pub command_type: Option<String>,
    pub issued_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

/// One node, both lanes.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct SyncOriginHealth {
    pub origin_id: String,
    pub label: Option<String>,
    pub site_id: Option<String>,
    pub node_role: Option<String>,
    pub active_generation: i64,
    pub inventory_enabled: bool,
    pub key_created_at: DateTime<Utc>,
    pub key_rotated_at: Option<DateTime<Utc>>,

    // ---- node → centre (facts) ----
    /// Contiguous prefix of facts the centre holds durably.
    pub durable_seq: Option<i64>,
    /// The heartbeat: bumped on every cycle, even one carrying no facts.
    pub last_received_at: Option<DateTime<Utc>>,
    pub last_received_age_seconds: Option<f64>,
    /// Contiguous prefix applied into the centre's ledger.
    pub applied_seq: Option<i64>,
    /// `durable_seq - applied_seq`: received but not yet in the ledger.
    pub apply_lag: i64,
    pub apply_blocked: Option<LaneBlock>,
    pub rejected_total: i64,
    pub accepted_24h: i64,
    pub rejected_24h: i64,
    /// The node's own independent statement of its positions.
    pub checkpoint_seq: Option<i64>,
    pub checkpoint_at: Option<DateTime<Utc>>,
    pub checkpoint_age_seconds: Option<f64>,

    // ---- centre → node (commands) ----
    pub issued_seq: i64,
    pub acked_seq: i64,
    /// Issued minus acknowledged: what the node still owes.
    pub pending_commands: i64,
    pub acked_at: Option<DateTime<Utc>>,
    pub last_ack_age_seconds: Option<f64>,
    pub oldest_pending_issued_at: Option<DateTime<Utc>>,
    pub oldest_pending_age_seconds: Option<f64>,
    pub command_blocked: Option<StuckCommand>,

    // ---- both ----
    /// The later of the two heartbeats, which is when this node last spoke.
    pub last_contact_at: Option<DateTime<Utc>>,
    pub last_contact_age_seconds: Option<f64>,
    pub status: LaneStatus,
}

/// How many nodes stand where.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Default, Serialize)]
pub struct FleetCounts {
    pub origins: i64,
    pub dc: i64,
    pub stores: i64,
    pub inventory_enabled: i64,
    pub healthy: i64,
    pub lagging: i64,
    pub stalled: i64,
    pub silent: i64,
    pub never: i64,
}

/// The centre → node lane, summed.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Default, Serialize)]
pub struct DownstreamHealth {
    pub commands_total: i64,
    pub revoked_total: i64,
    pub issued_24h: i64,
    pub pending_total: i64,
    pub origins_behind: i64,
    pub origins_blocked: i64,
    pub oldest_pending_age_seconds: Option<f64>,
    pub last_issued_at: Option<DateTime<Utc>>,
    pub last_ack_at: Option<DateTime<Utc>>,
}

/// The node → centre lane, summed, plus the centre's own outbox — the centre is
/// a sender too, and its breaker is part of the same picture.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Default, Serialize)]
pub struct UpstreamHealth {
    pub accepted_total: i64,
    pub rejected_total: i64,
    pub accepted_24h: i64,
    pub rejected_24h: i64,
    /// Nodes that have contacted the centre at least once.
    pub origins_reporting: i64,
    pub origins_apply_blocked: i64,
    pub apply_lag_total: i64,
    pub checkpoints_current: i64,
    pub checkpoints_stale: i64,
    /// Inventory-enabled nodes with no checkpoint at all.
    pub checkpoints_missing: i64,
    pub last_fact_at: Option<DateTime<Utc>>,
    pub own_backlog: i64,
    pub own_dead_letters: i64,
    pub own_breaker_open: bool,
    pub own_last_error: Option<String>,
}

/// One hour of traffic, both directions. Gap-filled: a quiet hour is a zero,
/// not a missing bucket, so a chart of it does not silently compress time.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct HourlyFlow {
    pub bucket: DateTime<Utc>,
    pub facts_accepted: i64,
    pub facts_rejected: i64,
    /// Issued, not delivered. Delivery has no timestamp in the schema and the
    /// acknowledgement cursor is overwritten every cycle, so "delivered per
    /// hour" is not a question this database can answer yet.
    pub commands_issued: i64,
}

/// One thing checked about who can get in and what they can reach.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct SecurityCheck {
    pub id: String,
    pub label: String,
    /// The figure the check turned on, when it is a count.
    pub count: Option<i64>,
    pub tone: CheckTone,
    pub detail: String,
}

/// The identity store and the request log, read for the signs an operator
/// looks for: sign-in switched off, live logins for people who have left,
/// accounts nobody uses, keys never rotated, refusals and failures piling up.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct SecurityPosture {
    pub auth_enabled: bool,
    pub accounts_total: i64,
    pub accounts_active: i64,
    pub admins_active: i64,
    pub live_sessions: i64,
    pub edge_grants_active: i64,
    pub devices_active: i64,
    pub requests_24h: i64,
    pub refusals_24h: i64,
    pub server_errors_24h: i64,
    /// Measured from the data, right now.
    pub checks: Vec<SecurityCheck>,
    /// Known from reading the code, not from measuring anything. Listed so the
    /// console does not say "safe" while a documented gap is open; an entry
    /// leaves this list when the code that causes it changes.
    pub exposures: Vec<SecurityCheck>,
}

/// The whole answer.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Serialize)]
pub struct SyncFleetHealth {
    pub as_of: DateTime<Utc>,
    pub verdict: HealthVerdict,
    /// Why the verdict is what it is, one sentence each. Empty when healthy.
    pub reasons: Vec<String>,
    /// The centre's own `OK` / `DEGRADED`, as `/api/v1/health` reports it, so
    /// the two endpoints cannot disagree.
    pub sync_state: String,
    pub silent_after_seconds: i64,
    pub checkpoint_stale_after_seconds: i64,
    pub fleet: FleetCounts,
    pub downstream: DownstreamHealth,
    pub upstream: UpstreamHealth,
    pub hourly: Vec<HourlyFlow>,
    pub origins: Vec<SyncOriginHealth>,
    pub security: SecurityPosture,
}

/// The thresholds, decided by the caller.
#[derive(Clone, Copy, Debug)]
pub struct HealthPolicy {
    /// A node that has not spoken for this long is `Silent`. The same number
    /// `sync_health_state` uses for a stale backlog, so one knob governs both.
    pub silent_after_seconds: i64,
    /// A checkpoint older than this no longer certifies a fleet total. 300 s
    /// is what `list_fleet_pools` uses; pass the same so the two screens agree.
    pub checkpoint_stale_after_seconds: i64,
    pub auth_enabled: bool,
}

/// The facts about one node that decide its status. Separated from the wire
/// row so the rule can be tested on six numbers rather than forty fields.
#[derive(Clone, Copy, Debug, Default)]
pub struct LaneFacts {
    pub ever_spoke: bool,
    pub command_blocked: bool,
    pub apply_blocked: bool,
    pub last_contact_age_seconds: Option<f64>,
    pub pending_commands: i64,
    pub apply_lag: i64,
}

/// The rule. Stalled before silent: a node that jammed and then went quiet
/// needs the jam cleared first, and a node that is blocked is not "silent" —
/// it is talking and being refused.
pub fn classify_lane(facts: LaneFacts, silent_after_seconds: i64) -> LaneStatus {
    if !facts.ever_spoke {
        return LaneStatus::Never;
    }
    if facts.command_blocked || facts.apply_blocked {
        return LaneStatus::Stalled;
    }
    if facts
        .last_contact_age_seconds
        .is_some_and(|age| age >= silent_after_seconds as f64)
    {
        return LaneStatus::Silent;
    }
    if facts.pending_commands > 0 || facts.apply_lag > 0 {
        return LaneStatus::Lagging;
    }
    LaneStatus::Healthy
}

/// The counts the security checks turn on. A struct so the checks are a pure
/// function of it and the SQL that fills it is one query.
#[derive(Clone, Copy, Debug, Default)]
pub struct SecurityCounts {
    pub accounts_total: i64,
    pub accounts_active: i64,
    pub admins_active: i64,
    pub dormant_accounts: i64,
    pub left_but_live: i64,
    pub locked_out: i64,
    pub failed_logins_24h: i64,
    pub live_sessions: i64,
    pub stale_keys: i64,
    pub devices_active: i64,
    pub devices_unseen: i64,
    pub edge_grants_active: i64,
    pub requests_24h: i64,
    pub refusals_24h: i64,
    pub server_errors_24h: i64,
}

fn check(
    id: &str,
    label: &str,
    count: Option<i64>,
    tone: CheckTone,
    detail: String,
) -> SecurityCheck {
    SecurityCheck {
        id: id.to_string(),
        label: label.to_string(),
        count,
        tone,
        detail,
    }
}

/// The measured checks. Thresholds are written here, once, with the reason.
pub fn security_checks(counts: SecurityCounts, auth_enabled: bool) -> Vec<SecurityCheck> {
    let mut out = Vec::new();

    out.push(if auth_enabled {
        check(
            "auth_mode",
            "Sign-in is enforced",
            None,
            CheckTone::Ok,
            "Every request carries a session, and every write carries a CSRF token.".into(),
        )
    } else {
        check(
            "auth_mode",
            "Sign-in is switched off",
            None,
            CheckTone::Bad,
            "INVENTORY_AUTH_MODE is disabled, so every request is treated as an administrator named \"development\". Never run a real fleet this way.".into(),
        )
    });

    // Nobody able to administer is worse than too many: it is the state in
    // which a leaked key cannot be rotated. Past a handful, the admin role has
    // stopped being a role and become the default.
    let admins_tone = match counts.admins_active {
        0 => CheckTone::Bad,
        1..=4 => CheckTone::Ok,
        _ => CheckTone::Warn,
    };
    out.push(check(
        "admins",
        "Administrators",
        Some(counts.admins_active),
        admins_tone,
        format!(
            "{} of {} active accounts hold ADMIN, the role that can register nodes, rotate keys and issue commands.",
            counts.admins_active, counts.accounts_active
        ),
    ));

    out.push(check(
        "left_but_live",
        "People who have left but can still sign in",
        Some(counts.left_but_live),
        if counts.left_but_live > 0 { CheckTone::Bad } else { CheckTone::Ok },
        "Active accounts whose employment record is no longer ACTIVE. A live credential for somebody who has gone is the classic way in.".into(),
    ));

    out.push(check(
        "dormant",
        "Accounts never used, older than 30 days",
        Some(counts.dormant_accounts),
        if counts.dormant_accounts > 0 { CheckTone::Warn } else { CheckTone::Ok },
        "Created, never signed in. Either the person never needed it or the credential is sitting in a spreadsheet somewhere.".into(),
    ));

    out.push(check(
        "locked_out",
        "Accounts locked out right now",
        Some(counts.locked_out),
        if counts.locked_out > 0 { CheckTone::Warn } else { CheckTone::Ok },
        "Too many wrong passwords in the window. One is a forgotten password; several at once is somebody guessing.".into(),
    ));

    out.push(check(
        "failed_logins",
        "Failed sign-ins in the last 24 hours",
        Some(counts.failed_logins_24h),
        if counts.failed_logins_24h >= 20 {
            CheckTone::Bad
        } else if counts.failed_logins_24h >= 5 {
            CheckTone::Warn
        } else {
            CheckTone::Ok
        },
        "Summed across accounts whose failure window opened today.".into(),
    ));

    out.push(check(
        "stale_keys",
        "Node keys older than 90 days",
        Some(counts.stale_keys),
        if counts.stale_keys > 0 { CheckTone::Warn } else { CheckTone::Ok },
        "Ingest keys never rotated since issue. The key is also what the centre signs that node's commands with, so an old key is a long-lived signing key.".into(),
    ));

    out.push(check(
        "devices_unseen",
        "Active readers that have never checked in",
        Some(counts.devices_unseen),
        if counts.devices_unseen > 0 {
            CheckTone::Warn
        } else {
            CheckTone::Ok
        },
        "An RFID reader registered with a live key that has not once been seen by its node.".into(),
    ));

    out.push(check(
        "refusals",
        "Requests refused in the last 24 hours",
        Some(counts.refusals_24h),
        if counts.refusals_24h >= 50 {
            CheckTone::Bad
        } else if counts.refusals_24h >= 10 {
            CheckTone::Warn
        } else {
            CheckTone::Ok
        },
        "401 and 403 answers in the request log. A few are people clicking what they may not; a stream of them is a client, or a person, probing.".into(),
    ));

    out.push(check(
        "server_errors",
        "Server errors in the last 24 hours",
        Some(counts.server_errors_24h),
        if counts.server_errors_24h >= 20 {
            CheckTone::Bad
        } else if counts.server_errors_24h > 0 {
            CheckTone::Warn
        } else {
            CheckTone::Ok
        },
        "5xx answers in the request log. Each one is a request the centre could not honour, and a burst of them usually shares one cause.".into(),
    ));

    out
}

/// What is known from the code rather than the data. Kept beside the measured
/// checks so a green page cannot be read as "nothing is open".
pub fn known_exposures() -> Vec<SecurityCheck> {
    vec![
        check(
            "assistant_sql_reach",
            "The assistant's SQL tool is not gated by role",
            None,
            CheckTone::Bad,
            "POST /api/v1/assistant/ask falls through to SUPERVISOR, and its read-only SQL tool is held back only by a short denylist — which omits the key digests the centre signs commands with. Recorded 2026-09-06; still open.".into(),
        ),
        check(
            "metrics_public",
            "/metrics answers without a session",
            None,
            CheckTone::Warn,
            "It lists every node's watermarks and the node topology. Fine inside the tailnet; put it behind a token before the centre is reachable from anywhere else.".into(),
        ),
    ]
}

/// The verdict, and the sentences that justify it.
pub fn verdict_of(
    fleet: &FleetCounts,
    downstream: &DownstreamHealth,
    upstream: &UpstreamHealth,
    sync_state: &str,
    never_with_pending: (i64, i64),
    checks: &[SecurityCheck],
    silent_after_seconds: i64,
) -> (HealthVerdict, Vec<String>) {
    let mut stalled = Vec::new();
    let mut attention = Vec::new();

    if fleet.stalled > 0 {
        stalled.push(format!(
            "{} {} stopped applying: a command or a fact is blocked, and nothing behind it moves until it is cleared.",
            fleet.stalled,
            plural(fleet.stalled, "node has", "nodes have")
        ));
    }
    if sync_state != "OK" {
        stalled.push(
            "The centre's own sender is degraded: its breaker is open or its outbox has facts older than the threshold."
                .to_string(),
        );
    }
    if fleet.silent > 0 {
        attention.push(format!(
            "{} {} not spoken for over {}.",
            fleet.silent,
            plural(fleet.silent, "node has", "nodes have"),
            span(silent_after_seconds)
        ));
    }
    let (never, waiting) = never_with_pending;
    if never > 0 {
        attention.push(format!(
            "{} registered {} never contacted the centre, and {} {} waiting for them.",
            never,
            plural(never, "node has", "nodes have"),
            waiting,
            plural(waiting, "command is", "commands are")
        ));
    }
    if upstream.rejected_24h > 0 {
        attention.push(format!(
            "The centre refused {} {} in the last 24 hours.",
            upstream.rejected_24h,
            plural(upstream.rejected_24h, "fact", "facts")
        ));
    }
    if upstream.checkpoints_stale > 0 {
        attention.push(format!(
            "{} {} checkpoint is stale, so the fleet total is not certified.",
            upstream.checkpoints_stale,
            plural(upstream.checkpoints_stale, "node's", "nodes'")
        ));
    }
    if downstream.origins_behind > 0 && fleet.stalled == 0 && fleet.silent == 0 && never == 0 {
        // Behind on its own is motion, not trouble — unless the oldest waiting
        // command has been waiting longer than a node is allowed to be quiet.
        if downstream
            .oldest_pending_age_seconds
            .is_some_and(|age| age >= silent_after_seconds as f64)
        {
            attention.push(format!(
                "{} {} behind on commands, the oldest waiting {}.",
                downstream.origins_behind,
                plural(downstream.origins_behind, "node is", "nodes are"),
                span(downstream.oldest_pending_age_seconds.unwrap_or(0.0) as i64)
            ));
        }
    }
    for failed in checks.iter().filter(|c| c.tone == CheckTone::Bad) {
        attention.push(format!("Security: {}.", failed.label.trim_end_matches('.')));
    }

    if !stalled.is_empty() {
        stalled.extend(attention);
        (HealthVerdict::Stalled, stalled)
    } else if !attention.is_empty() {
        (HealthVerdict::Attention, attention)
    } else {
        (HealthVerdict::Healthy, Vec::new())
    }
}

fn plural<'a>(n: i64, one: &'a str, many: &'a str) -> &'a str {
    if n == 1 {
        one
    } else {
        many
    }
}

/// A span of seconds the way an operator says it.
fn span(seconds: i64) -> String {
    if seconds >= 86_400 {
        format!("{} d", seconds / 86_400)
    } else if seconds >= 3_600 {
        format!("{} h", seconds / 3_600)
    } else if seconds >= 60 {
        format!("{} min", seconds / 60)
    } else {
        format!("{} s", seconds)
    }
}

const ORIGIN_ROWS: &str = "
    WITH pend AS (
        SELECT d.origin_id,
               count(*)::bigint AS pending_commands,
               min(c.issued_at) AS oldest_pending_issued_at
          FROM sync_command_delivery d
          JOIN sync_command c ON c.command_id = d.command_id
          LEFT JOIN sync_command_cursor cur ON cur.origin_id = d.origin_id
         WHERE d.seq > COALESCE(cur.acked_seq, 0)
         GROUP BY d.origin_id
    ), recent AS (
        SELECT origin_id, generation,
               count(*) FILTER (WHERE status = 'ACCEPTED')::bigint AS accepted_24h,
               count(*) FILTER (WHERE status = 'REJECTED')::bigint AS rejected_24h
          FROM sync_ingest_fact
         WHERE received_at >= $1 - interval '24 hours'
         GROUP BY origin_id, generation
    ), rejects AS (
        SELECT origin_id, generation, count(*)::bigint AS rejected_total
          FROM sync_ingest_fact
         WHERE status = 'REJECTED'
         GROUP BY origin_id, generation
    )
    SELECT cred.origin_id, cred.label, cred.site_id, cred.node_role,
           cred.active_generation, cred.inventory_enabled,
           cred.created_at AS key_created_at, cred.rotated_at AS key_rotated_at,
           ingest.durable_seq, ingest.last_received_at,
           applied.applied_seq,
           applied.blocked_at_seq AS apply_blocked_at_seq,
           applied.blocked_reason AS apply_blocked_reason,
           applied.blocked_since  AS apply_blocked_since,
           COALESCE(rejects.rejected_total, 0) AS rejected_total,
           COALESCE(recent.accepted_24h, 0)    AS accepted_24h,
           COALESCE(recent.rejected_24h, 0)    AS rejected_24h,
           snap.seq        AS checkpoint_seq,
           snap.applied_at AS checkpoint_at,
           COALESCE(cur.next_seq, 0)  AS issued_seq,
           COALESCE(cur.acked_seq, 0) AS acked_seq,
           cur.acked_at,
           COALESCE(pend.pending_commands, 0) AS pending_commands,
           pend.oldest_pending_issued_at,
           cur.blocked_at_seq AS command_blocked_at_seq,
           cur.blocked_reason AS command_blocked_reason,
           cur.blocked_since  AS command_blocked_since,
           stuck.command_id   AS stuck_command_id,
           stuck.command_type AS stuck_command_type,
           stuck.issued_at    AS stuck_issued_at,
           stuck.revoked_at   AS stuck_revoked_at
      FROM sync_origin_credential cred
      LEFT JOIN sync_ingest_watermark ingest
             ON ingest.origin_id = cred.origin_id
            AND ingest.generation = cred.active_generation
      LEFT JOIN sync_applied_watermark applied
             ON applied.origin_id = cred.origin_id
            AND applied.generation = cred.active_generation
      LEFT JOIN rejects
             ON rejects.origin_id = cred.origin_id
            AND rejects.generation = cred.active_generation
      LEFT JOIN recent
             ON recent.origin_id = cred.origin_id
            AND recent.generation = cred.active_generation
      LEFT JOIN edge_inventory_snapshot snap
             ON snap.origin_id = cred.origin_id
            AND snap.generation = cred.active_generation
      LEFT JOIN sync_command_cursor cur ON cur.origin_id = cred.origin_id
      LEFT JOIN pend ON pend.origin_id = cred.origin_id
      LEFT JOIN LATERAL (
            SELECT c.command_id, c.command_type, c.issued_at, c.revoked_at
              FROM sync_command_delivery d
              JOIN sync_command c ON c.command_id = d.command_id
             WHERE d.origin_id = cred.origin_id
               AND d.seq = cur.blocked_at_seq
             LIMIT 1) stuck ON true
     ORDER BY cred.node_role DESC NULLS LAST, cred.origin_id";

const DOWNSTREAM_TOTALS: &str = "
    SELECT count(*)::bigint AS commands_total,
           count(*) FILTER (WHERE revoked_at IS NOT NULL)::bigint AS revoked_total,
           count(*) FILTER (WHERE issued_at >= $1 - interval '24 hours')::bigint AS issued_24h,
           max(issued_at) AS last_issued_at
      FROM sync_command";

// A scan of every fact the centre has ever received. Honest at today's
// volumes; the day the fleet is real, `received_at` wants an index and the
// all-time totals want to come from the watermarks instead.
const UPSTREAM_TOTALS: &str = "
    SELECT count(*) FILTER (WHERE status = 'ACCEPTED')::bigint AS accepted_total,
           count(*) FILTER (WHERE status = 'REJECTED')::bigint AS rejected_total,
           count(*) FILTER (WHERE status = 'ACCEPTED' AND received_at >= $1 - interval '24 hours')::bigint AS accepted_24h,
           count(*) FILTER (WHERE status = 'REJECTED' AND received_at >= $1 - interval '24 hours')::bigint AS rejected_24h
      FROM sync_ingest_fact";

const HOURLY: &str = "
    SELECT b.bucket,
           COALESCE(f.accepted, 0) AS facts_accepted,
           COALESCE(f.rejected, 0) AS facts_rejected,
           COALESCE(c.issued, 0)   AS commands_issued
      FROM generate_series(date_trunc('hour', $1::timestamptz) - interval '23 hours',
                           date_trunc('hour', $1::timestamptz),
                           interval '1 hour') AS b(bucket)
      LEFT JOIN (
            SELECT date_trunc('hour', received_at) AS bucket,
                   count(*) FILTER (WHERE status = 'ACCEPTED')::bigint AS accepted,
                   count(*) FILTER (WHERE status = 'REJECTED')::bigint AS rejected
              FROM sync_ingest_fact
             WHERE received_at >= date_trunc('hour', $1::timestamptz) - interval '23 hours'
             GROUP BY 1) f ON f.bucket = b.bucket
      LEFT JOIN (
            SELECT date_trunc('hour', issued_at) AS bucket,
                   count(*)::bigint AS issued
              FROM sync_command
             WHERE issued_at >= date_trunc('hour', $1::timestamptz) - interval '23 hours'
             GROUP BY 1) c ON c.bucket = b.bucket
     ORDER BY b.bucket";

const SECURITY: &str = "
    SELECT
      (SELECT count(*)::bigint FROM app_user) AS accounts_total,
      (SELECT count(*)::bigint FROM app_user WHERE active) AS accounts_active,
      (SELECT count(*)::bigint FROM app_user WHERE active AND role = 'ADMIN') AS admins_active,
      (SELECT count(*)::bigint FROM app_user
        WHERE active AND last_login_at IS NULL
          AND created_at < $1 - interval '30 days') AS dormant_accounts,
      (SELECT count(*)::bigint FROM app_user u
         JOIN employee e ON e.id = u.employee_id
        WHERE u.active AND e.status <> 'ACTIVE') AS left_but_live,
      (SELECT count(*)::bigint FROM app_user WHERE login_blocked_until > $1) AS locked_out,
      (SELECT COALESCE(sum(failed_login_count), 0)::bigint FROM app_user
        WHERE failed_login_window_started_at >= $1 - interval '24 hours') AS failed_logins_24h,
      (SELECT count(*)::bigint FROM auth_session
        WHERE revoked_at IS NULL AND expires_at > $1) AS live_sessions,
      (SELECT count(*)::bigint FROM sync_origin_credential
        WHERE COALESCE(rotated_at, created_at) < $1 - interval '90 days') AS stale_keys,
      (SELECT count(*)::bigint FROM rfid_device WHERE active) AS devices_active,
      (SELECT count(*)::bigint FROM rfid_device WHERE active AND last_seen_at IS NULL) AS devices_unseen,
      (SELECT count(*)::bigint FROM edge_identity_assignment WHERE active) AS edge_grants_active,
      (SELECT count(*)::bigint FROM audit_log WHERE at >= $1 - interval '24 hours') AS requests_24h,
      (SELECT count(*)::bigint FROM audit_log
        WHERE at >= $1 - interval '24 hours' AND status IN (401, 403)) AS refusals_24h,
      (SELECT count(*)::bigint FROM audit_log
        WHERE at >= $1 - interval '24 hours' AND status >= 500) AS server_errors_24h";

/// The whole picture, in five reads and no writes.
pub async fn sync_fleet_health(
    pool: &PgPool,
    policy: HealthPolicy,
    now: DateTime<Utc>,
) -> Result<SyncFleetHealth, AppError> {
    let rows = sqlx::query(ORIGIN_ROWS).bind(now).fetch_all(pool).await?;

    let mut fleet = FleetCounts::default();
    let mut downstream = DownstreamHealth::default();
    let mut upstream = UpstreamHealth::default();
    let mut never_waiting = 0i64;
    let mut origins = Vec::with_capacity(rows.len());

    for r in rows {
        let node_role: Option<String> = r.get("node_role");
        let inventory_enabled: bool = r.get("inventory_enabled");
        let last_received_at: Option<DateTime<Utc>> = r.get("last_received_at");
        let acked_at: Option<DateTime<Utc>> = r.get("acked_at");
        let durable_seq: Option<i64> = r.get("durable_seq");
        let applied_seq: Option<i64> = r.get("applied_seq");
        let apply_lag = (durable_seq.unwrap_or(0) - applied_seq.unwrap_or(0)).max(0);
        let issued_seq: i64 = r.get("issued_seq");
        let acked_seq: i64 = r.get("acked_seq");
        let pending_commands: i64 = r.get("pending_commands");
        let oldest_pending_issued_at: Option<DateTime<Utc>> = r.get("oldest_pending_issued_at");
        let checkpoint_at: Option<DateTime<Utc>> = r.get("checkpoint_at");

        let apply_blocked = r.get::<Option<i64>, _>("apply_blocked_at_seq").map(|seq| {
            let since: Option<DateTime<Utc>> = r.get("apply_blocked_since");
            LaneBlock {
                seq,
                reason: r.get("apply_blocked_reason"),
                since,
                age_seconds: seconds_since(since, now),
            }
        });
        let command_blocked = r
            .get::<Option<i64>, _>("command_blocked_at_seq")
            .map(|seq| {
                let since: Option<DateTime<Utc>> = r.get("command_blocked_since");
                StuckCommand {
                    seq,
                    reason: r.get("command_blocked_reason"),
                    since,
                    age_seconds: seconds_since(since, now),
                    command_id: r.get("stuck_command_id"),
                    command_type: r.get("stuck_command_type"),
                    issued_at: r.get("stuck_issued_at"),
                    revoked_at: r.get("stuck_revoked_at"),
                }
            });

        let last_contact_at = match (last_received_at, acked_at) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        let last_contact_age_seconds = seconds_since(last_contact_at, now);

        let status = classify_lane(
            LaneFacts {
                ever_spoke: last_contact_at.is_some(),
                command_blocked: command_blocked.is_some(),
                apply_blocked: apply_blocked.is_some(),
                last_contact_age_seconds,
                pending_commands,
                apply_lag,
            },
            policy.silent_after_seconds,
        );

        // ---- fold the fleet figures while the row is in hand ----
        fleet.origins += 1;
        match node_role.as_deref() {
            Some("DC") => fleet.dc += 1,
            Some("STORE") => fleet.stores += 1,
            _ => {}
        }
        if inventory_enabled {
            fleet.inventory_enabled += 1;
        }
        match status {
            LaneStatus::Healthy => fleet.healthy += 1,
            LaneStatus::Lagging => fleet.lagging += 1,
            LaneStatus::Stalled => fleet.stalled += 1,
            LaneStatus::Silent => fleet.silent += 1,
            LaneStatus::Never => {
                fleet.never += 1;
                never_waiting += pending_commands;
            }
        }

        downstream.pending_total += pending_commands;
        if pending_commands > 0 {
            downstream.origins_behind += 1;
        }
        if command_blocked.is_some() {
            downstream.origins_blocked += 1;
        }
        let oldest_pending_age_seconds = seconds_since(oldest_pending_issued_at, now);
        if let Some(age) = oldest_pending_age_seconds {
            downstream.oldest_pending_age_seconds = Some(
                downstream
                    .oldest_pending_age_seconds
                    .map_or(age, |o| o.max(age)),
            );
        }
        downstream.last_ack_at = match (downstream.last_ack_at, acked_at) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };

        if last_received_at.is_some() {
            upstream.origins_reporting += 1;
        }
        if apply_blocked.is_some() {
            upstream.origins_apply_blocked += 1;
        }
        upstream.apply_lag_total += apply_lag;
        upstream.last_fact_at = match (upstream.last_fact_at, last_received_at) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        let checkpoint_age_seconds = seconds_since(checkpoint_at, now);
        if inventory_enabled {
            match checkpoint_age_seconds {
                None => upstream.checkpoints_missing += 1,
                Some(age) if age >= policy.checkpoint_stale_after_seconds as f64 => {
                    upstream.checkpoints_stale += 1
                }
                Some(_) => upstream.checkpoints_current += 1,
            }
        }

        origins.push(SyncOriginHealth {
            origin_id: r.get("origin_id"),
            label: r.get("label"),
            site_id: r.get("site_id"),
            node_role,
            active_generation: r.get("active_generation"),
            inventory_enabled,
            key_created_at: r.get("key_created_at"),
            key_rotated_at: r.get("key_rotated_at"),
            durable_seq,
            last_received_at,
            last_received_age_seconds: seconds_since(last_received_at, now),
            applied_seq,
            apply_lag,
            apply_blocked,
            rejected_total: r.get("rejected_total"),
            accepted_24h: r.get("accepted_24h"),
            rejected_24h: r.get("rejected_24h"),
            checkpoint_seq: r.get("checkpoint_seq"),
            checkpoint_at,
            checkpoint_age_seconds,
            issued_seq,
            acked_seq,
            pending_commands,
            acked_at,
            last_ack_age_seconds: seconds_since(acked_at, now),
            oldest_pending_issued_at,
            oldest_pending_age_seconds,
            command_blocked,
            last_contact_at,
            last_contact_age_seconds,
            status,
        });
    }

    let totals = sqlx::query(DOWNSTREAM_TOTALS)
        .bind(now)
        .fetch_one(pool)
        .await?;
    downstream.commands_total = totals.get("commands_total");
    downstream.revoked_total = totals.get("revoked_total");
    downstream.issued_24h = totals.get("issued_24h");
    downstream.last_issued_at = totals.get("last_issued_at");

    let facts = sqlx::query(UPSTREAM_TOTALS)
        .bind(now)
        .fetch_one(pool)
        .await?;
    upstream.accepted_total = facts.get("accepted_total");
    upstream.rejected_total = facts.get("rejected_total");
    upstream.accepted_24h = facts.get("accepted_24h");
    upstream.rejected_24h = facts.get("rejected_24h");

    // The centre is a sender too. Its own outbox and breaker are read through
    // the same snapshot `/api/v1/health` uses, so the two cannot disagree.
    let snapshot = sync_snapshot(pool).await?;
    let sync_state = sync_health_state(&snapshot, policy.silent_after_seconds, now).to_string();
    upstream.own_backlog = snapshot.backlog_count;
    upstream.own_dead_letters = snapshot.dead_letter_count;
    upstream.own_breaker_open = breaker_is_open(&snapshot.sender, now);
    upstream.own_last_error = snapshot.sender.last_error.clone();

    let hourly = sqlx::query(HOURLY)
        .bind(now)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| HourlyFlow {
            bucket: r.get("bucket"),
            facts_accepted: r.get("facts_accepted"),
            facts_rejected: r.get("facts_rejected"),
            commands_issued: r.get("commands_issued"),
        })
        .collect();

    let s = sqlx::query(SECURITY).bind(now).fetch_one(pool).await?;
    let counts = SecurityCounts {
        accounts_total: s.get("accounts_total"),
        accounts_active: s.get("accounts_active"),
        admins_active: s.get("admins_active"),
        dormant_accounts: s.get("dormant_accounts"),
        left_but_live: s.get("left_but_live"),
        locked_out: s.get("locked_out"),
        failed_logins_24h: s.get("failed_logins_24h"),
        live_sessions: s.get("live_sessions"),
        stale_keys: s.get("stale_keys"),
        devices_active: s.get("devices_active"),
        devices_unseen: s.get("devices_unseen"),
        edge_grants_active: s.get("edge_grants_active"),
        requests_24h: s.get("requests_24h"),
        refusals_24h: s.get("refusals_24h"),
        server_errors_24h: s.get("server_errors_24h"),
    };
    let checks = security_checks(counts, policy.auth_enabled);

    let (verdict, reasons) = verdict_of(
        &fleet,
        &downstream,
        &upstream,
        &sync_state,
        (fleet.never, never_waiting),
        &checks,
        policy.silent_after_seconds,
    );

    Ok(SyncFleetHealth {
        as_of: now,
        verdict,
        reasons,
        sync_state,
        silent_after_seconds: policy.silent_after_seconds,
        checkpoint_stale_after_seconds: policy.checkpoint_stale_after_seconds,
        fleet,
        downstream,
        upstream,
        hourly,
        origins,
        security: SecurityPosture {
            auth_enabled: policy.auth_enabled,
            accounts_total: counts.accounts_total,
            accounts_active: counts.accounts_active,
            admins_active: counts.admins_active,
            live_sessions: counts.live_sessions,
            edge_grants_active: counts.edge_grants_active,
            devices_active: counts.devices_active,
            requests_24h: counts.requests_24h,
            refusals_24h: counts.refusals_24h,
            server_errors_24h: counts.server_errors_24h,
            checks,
            exposures: known_exposures(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SILENT_AFTER: i64 = 900;

    fn spoke(age: f64) -> LaneFacts {
        LaneFacts {
            ever_spoke: true,
            last_contact_age_seconds: Some(age),
            ..LaneFacts::default()
        }
    }

    #[test]
    fn a_node_that_never_spoke_is_never_regardless_of_what_it_owes() {
        let facts = LaneFacts {
            ever_spoke: false,
            pending_commands: 300,
            ..LaneFacts::default()
        };
        assert_eq!(classify_lane(facts, SILENT_AFTER), LaneStatus::Never);
    }

    #[test]
    fn a_block_outranks_silence_and_lag() {
        let facts = LaneFacts {
            command_blocked: true,
            pending_commands: 4,
            ..spoke(100_000.0)
        };
        assert_eq!(classify_lane(facts, SILENT_AFTER), LaneStatus::Stalled);
        let facts = LaneFacts {
            apply_blocked: true,
            ..spoke(1.0)
        };
        assert_eq!(classify_lane(facts, SILENT_AFTER), LaneStatus::Stalled);
    }

    #[test]
    fn silence_is_measured_against_the_threshold_inclusive() {
        assert_eq!(
            classify_lane(spoke(SILENT_AFTER as f64), SILENT_AFTER),
            LaneStatus::Silent
        );
        assert_eq!(
            classify_lane(spoke(SILENT_AFTER as f64 - 1.0), SILENT_AFTER),
            LaneStatus::Healthy
        );
    }

    #[test]
    fn owing_anything_while_talking_is_lagging_not_trouble() {
        let facts = LaneFacts {
            pending_commands: 1,
            ..spoke(5.0)
        };
        assert_eq!(classify_lane(facts, SILENT_AFTER), LaneStatus::Lagging);
        let facts = LaneFacts {
            apply_lag: 12,
            ..spoke(5.0)
        };
        assert_eq!(classify_lane(facts, SILENT_AFTER), LaneStatus::Lagging);
    }

    #[test]
    fn the_verdict_is_healthy_only_when_there_is_nothing_to_say() {
        let fleet = FleetCounts {
            origins: 3,
            healthy: 3,
            ..FleetCounts::default()
        };
        let (verdict, reasons) = verdict_of(
            &fleet,
            &DownstreamHealth::default(),
            &UpstreamHealth::default(),
            "OK",
            (0, 0),
            &security_checks(
                SecurityCounts {
                    admins_active: 2,
                    accounts_active: 5,
                    ..SecurityCounts::default()
                },
                true,
            ),
            SILENT_AFTER,
        );
        assert_eq!(verdict, HealthVerdict::Healthy);
        assert!(reasons.is_empty());
    }

    #[test]
    fn one_stalled_node_makes_the_whole_verdict_stalled_and_keeps_the_rest_of_the_story() {
        let fleet = FleetCounts {
            origins: 3,
            stalled: 1,
            silent: 1,
            healthy: 1,
            ..FleetCounts::default()
        };
        let (verdict, reasons) = verdict_of(
            &fleet,
            &DownstreamHealth::default(),
            &UpstreamHealth::default(),
            "OK",
            (0, 0),
            &[],
            SILENT_AFTER,
        );
        assert_eq!(verdict, HealthVerdict::Stalled);
        assert_eq!(reasons.len(), 2, "{reasons:?}");
        assert!(reasons[0].contains("stopped applying"));
        assert!(reasons[1].contains("not spoken"));
    }

    #[test]
    fn nodes_that_never_spoke_are_attention_not_stalled_and_say_what_waits_for_them() {
        let fleet = FleetCounts {
            origins: 14,
            never: 13,
            healthy: 1,
            ..FleetCounts::default()
        };
        let (verdict, reasons) = verdict_of(
            &fleet,
            &DownstreamHealth::default(),
            &UpstreamHealth::default(),
            "OK",
            (13, 4_268),
            &[],
            SILENT_AFTER,
        );
        assert_eq!(verdict, HealthVerdict::Attention);
        assert_eq!(reasons, vec![
            "13 registered nodes have never contacted the centre, and 4268 commands are waiting for them.".to_string()
        ]);
    }

    #[test]
    fn a_failed_security_check_is_a_reason_on_its_own() {
        let checks = security_checks(SecurityCounts::default(), false);
        let (verdict, reasons) = verdict_of(
            &FleetCounts::default(),
            &DownstreamHealth::default(),
            &UpstreamHealth::default(),
            "OK",
            (0, 0),
            &checks,
            SILENT_AFTER,
        );
        assert_eq!(verdict, HealthVerdict::Attention);
        assert!(reasons
            .iter()
            .any(|r| r.contains("Sign-in is switched off")));
        // No administrators at all is the other BAD in an empty store.
        assert!(reasons.iter().any(|r| r.contains("Administrators")));
    }

    #[test]
    fn auth_disabled_is_the_first_check_and_it_is_bad() {
        let checks = security_checks(SecurityCounts::default(), false);
        assert_eq!(checks[0].id, "auth_mode");
        assert_eq!(checks[0].tone, CheckTone::Bad);
        let checks = security_checks(SecurityCounts::default(), true);
        assert_eq!(checks[0].tone, CheckTone::Ok);
    }

    #[test]
    fn the_known_exposures_are_listed_even_when_everything_measured_is_green() {
        let exposures = known_exposures();
        assert!(exposures.iter().any(|e| e.id == "assistant_sql_reach"));
        assert!(exposures.iter().any(|e| e.id == "metrics_public"));
    }
}
