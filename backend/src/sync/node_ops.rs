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

use serde::{Deserialize, Serialize};

pub const NODE_RESTART: &str = "node.restart";
pub const NODE_BACKUP: &str = "node.backup";
pub const NODE_DIAGNOSE: &str = "node.diagnose";
/// Install a signed build (`edge/update.rs`).
pub const NODE_UPDATE: &str = "node.update";

pub fn is_node_op(command_type: &str) -> bool {
    matches!(command_type, NODE_RESTART | NODE_BACKUP | NODE_DIAGNOSE | NODE_UPDATE)
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
    let hex = |value: &str, len: usize| value.len() == len && value.bytes().all(|b| b.is_ascii_hexdigit());
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
    let (from, to) = window.split_once('-').ok_or("window must look like 23:00-05:00")?;
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
}
