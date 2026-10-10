//! Head office acting on a shop server from a distance.
//!
//! Three instructions, carried on the ordinary downstream command lane — the
//! same signed, sequenced, revocable lane that carries price books — so the
//! cloud still never dials a shop, and every instruction is recorded with who
//! gave it (STORE-SERVER-PLAN §5):
//!
//! - `node.restart`  — restart the node; waits for open drawers unless forced;
//! - `node.backup`   — take a database backup now;
//! - `node.diagnose` — run `store diagnose` and send the report to head office.
//!
//! Re-sending the initial data needs no instruction to the node: head office
//! simply issues the data again (`/sync/origins/{id}/bootstrap`).
//!
//! # Remote actions per store (28 Sep 2026)
//!
//! A store page's *Actions* menu (`cloud/postgres/store_actions.rs`) records
//! each action and follows it until it finishes. A node that can be followed
//! says so with [`NODE_ACTIONS_CAPABILITY`] in its heartbeat; only such a node
//! is sent an operation that carries an `action_id`, the two newer
//! instructions below, or anything else a build before it would refuse —
//! `NodeOpPayload` denies unknown fields, and a refused command blocks the
//! node's whole stream.
//!
//! - `node.sync_now`    — push the outbox and pull commands now, and say how
//!   the queue stood before and after;
//! - `node.resnapshot`  — the marker after re-sent initial data: applied in
//!   order behind it, so applying it means the node has rebuilt everything
//!   head office just sent.
//!
//! What came of each is written on the node (`edge_node_action`, sqlite
//! 0067) and carried up in the heartbeat as [`ActionReport`]s — the same
//! channel a test page's outcome already takes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const NODE_RESTART: &str = "node.restart";
pub const NODE_BACKUP: &str = "node.backup";
pub const NODE_DIAGNOSE: &str = "node.diagnose";
/// Install a signed build (`edge/update.rs`).
pub const NODE_UPDATE: &str = "node.update";

/// Push the outbox and pull commands now (remote actions, 28 Sep 2026).
pub const NODE_SYNC_NOW: &str = "node.sync_now";
/// The marker behind re-sent initial data (remote actions, 28 Sep 2026).
pub const NODE_RESNAPSHOT: &str = "node.resnapshot";

/// What a node's heartbeat carries once its build takes the two instructions
/// above, an `action_id` on every node operation, and reports what came of
/// each (`NodeStatus::action_results`).
pub const NODE_ACTIONS_CAPABILITY: &str = "node.actions.v1";

/// The four operations every build since 0475 takes. The fleet page's own
/// `ask` endpoint is held to these: it does not look at capabilities.
pub fn is_node_op(command_type: &str) -> bool {
    matches!(
        command_type,
        NODE_RESTART | NODE_BACKUP | NODE_DIAGNOSE | NODE_UPDATE
    )
}

/// The instructions only a node advertising [`NODE_ACTIONS_CAPABILITY`] takes.
pub fn is_action_op(command_type: &str) -> bool {
    matches!(command_type, NODE_SYNC_NOW | NODE_RESNAPSHOT)
}

/// An action as the node last saw it, carried in every heartbeat until it is
/// a couple of hours old (`edge/ops.rs`). Head office files it by
/// `action_id`, so a repeat changes nothing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionReport {
    pub action_id: Uuid,
    /// The command type that carried it: `node.restart`, `node.backup`, ...
    pub kind: String,
    /// `QUEUED`, `RUNNING`, `DONE` or `FAILED`.
    pub state: String,
    pub received_at: DateTime<Utc>,
    #[serde(default)]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub finished_at: Option<DateTime<Utc>>,
    /// One sentence a person reads: "Backup taken: 41.2 MB in 3 s."
    #[serde(default)]
    pub sentence: Option<String>,
    /// The numbers behind the sentence, kind by kind.
    #[serde(default)]
    pub detail: serde_json::Value,
}

pub const ACTION_QUEUED: &str = "QUEUED";
pub const ACTION_RUNNING: &str = "RUNNING";
pub const ACTION_DONE: &str = "DONE";
pub const ACTION_FAILED: &str = "FAILED";

pub fn is_action_state(state: &str) -> bool {
    matches!(
        state,
        ACTION_QUEUED | ACTION_RUNNING | ACTION_DONE | ACTION_FAILED
    )
}

/// `node.update`: which build, where it is, and the proof it is ours.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpdatePayload {
    pub reason: String,
    pub version: String,
    /// Where the node downloads the executable from (https).
    pub url: String,
    /// SHA-256 of the executable, lowercase hex.
    pub sha256: String,
    /// Ed25519 signature over the 32 raw digest bytes, hex, by the release
    /// key whose public half is compiled into the node.
    pub signature: String,
    /// When it may be installed, local time, `HH:MM-HH:MM`. Default 23:00-05:00.
    #[serde(default)]
    pub window: Option<String>,
}

pub fn parse_update(payload: &serde_json::Value) -> Result<UpdatePayload, String> {
    let update: UpdatePayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("node.update payload: {error}"))?;
    if update.reason.trim().is_empty() {
        return Err("a node operation needs a reason".into());
    }
    if !update.url.starts_with("https://") {
        return Err("an update is downloaded over https only".into());
    }
    let hex = |value: &str, len: usize| {
        value.len() == len && value.bytes().all(|b| b.is_ascii_hexdigit())
    };
    if !hex(&update.sha256, 64) {
        return Err("sha256 must be 64 hex characters".into());
    }
    if !hex(&update.signature, 128) {
        return Err("signature must be 128 hex characters (Ed25519)".into());
    }
    if update.version.trim().is_empty() || update.version.len() > 40 {
        return Err("version is required".into());
    }
    if let Some(window) = &update.window {
        parse_window(window)?;
    }
    Ok(update)
}

/// `"23:00-05:00"` as minutes after midnight; a window may cross midnight.
pub fn parse_window(window: &str) -> Result<(u32, u32), String> {
    let minutes = |text: &str| -> Option<u32> {
        let (h, m) = text.trim().split_once(':')?;
        let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
        (h < 24 && m < 60).then_some(h * 60 + m)
    };
    let (from, to) = window
        .split_once('-')
        .ok_or("window must look like 23:00-05:00")?;
    Ok((
        minutes(from).ok_or("window must look like 23:00-05:00")?,
        minutes(to).ok_or("window must look like 23:00-05:00")?,
    ))
}

/// Whether `minute` (after local midnight) falls inside `(from, to)`.
pub fn in_window((from, to): (u32, u32), minute: u32) -> bool {
    if from <= to {
        (from..to).contains(&minute)
    } else {
        minute >= from || minute < to
    }
}

/// Validate any node operation's payload at the issuing desk.
pub fn validate(command_type: &str, payload: &serde_json::Value) -> Result<(), String> {
    if command_type == NODE_UPDATE {
        parse_update(payload).map(|_| ())
    } else if is_action_op(command_type) {
        parse_action(payload).map(|_| ())
    } else {
        parse(payload).map(|_| ())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NodeOpPayload {
    /// Why, in the words of whoever asked. Shown in the node's history.
    pub reason: String,
    /// Restart even with drawers open. Ignored by the other two.
    #[serde(default)]
    pub force: bool,
    /// The store action this carries out (`store_action`, 0643), so the node
    /// can say what came of it. Sent only to a node advertising
    /// [`NODE_ACTIONS_CAPABILITY`]: an older build refuses the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_id: Option<Uuid>,
}

/// `node.sync_now` and `node.resnapshot`: always followed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ActionPayload {
    pub action_id: Uuid,
    pub reason: String,
}

pub fn parse_action(payload: &serde_json::Value) -> Result<ActionPayload, String> {
    let parsed: ActionPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("node action payload: {error}"))?;
    if parsed.reason.trim().is_empty() {
        return Err("a node operation needs a reason".into());
    }
    if parsed.reason.chars().count() > 300 {
        return Err("a node operation's reason is at most 300 characters".into());
    }
    Ok(parsed)
}

pub fn parse(payload: &serde_json::Value) -> Result<NodeOpPayload, String> {
    let parsed: NodeOpPayload = serde_json::from_value(payload.clone())
        .map_err(|error| format!("node operation payload: {error}"))?;
    if parsed.reason.trim().is_empty() {
        return Err("a node operation needs a reason".into());
    }
    if parsed.reason.chars().count() > 300 {
        return Err("a node operation's reason is at most 300 characters".into());
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_update_window_may_cross_midnight() {
        let night = parse_window("23:00-05:00").unwrap_or((0, 0));
        assert!(in_window(night, 23 * 60 + 30));
        assert!(in_window(night, 2 * 60));
        assert!(!in_window(night, 12 * 60));
        let lunch = parse_window("12:00-13:00").unwrap_or((0, 0));
        assert!(in_window(lunch, 12 * 60 + 5) && !in_window(lunch, 13 * 60));
        assert!(parse_window("25:00-01:00").is_err());
    }

    #[test]
    fn an_update_must_be_https_and_signed() {
        let good = json!({
            "reason": "rilis 1.4", "version": "1.4.0",
            "url": "https://releases.example/store-1.4.0",
            "sha256": "a".repeat(64), "signature": "b".repeat(128),
        });
        assert!(parse_update(&good).is_ok());
        let mut plain = good.clone();
        plain["url"] = json!("http://releases.example/store");
        assert!(parse_update(&plain).is_err());
        let mut unsigned = good;
        unsigned["signature"] = json!("");
        assert!(parse_update(&unsigned).is_err());
    }

    #[test]
    fn a_reason_is_required_and_bounded() {
        assert!(parse(&json!({ "reason": "server lambat" })).is_ok());
        assert!(parse(&json!({ "reason": "  " })).is_err());
        assert!(parse(&json!({ "reason": "x".repeat(301) })).is_err());
        assert!(parse(&json!({ "reason": "ok", "extra": 1 })).is_err());
    }

    #[test]
    fn an_action_is_followed_by_its_id() {
        let id = Uuid::new_v4();
        assert!(parse(&json!({ "reason": "lambat", "action_id": id })).is_ok());
        assert!(validate(NODE_SYNC_NOW, &json!({ "reason": "now", "action_id": id })).is_ok());
        assert!(validate(NODE_RESNAPSHOT, &json!({ "reason": "now" })).is_err());
        assert!(!is_node_op(NODE_SYNC_NOW) && is_action_op(NODE_RESNAPSHOT));
    }
}
