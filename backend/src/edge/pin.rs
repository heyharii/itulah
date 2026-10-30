//! A PIN, for a shop that has no scanner yet.
//!
//! Staging runs on this and production runs on fingers, and which one a node
//! accepts is [`step_up`] — one row, changed once when the scanners arrive.
//!
//! # Why a PIN is not simply a shorter password
//!
//! It is guessable. Six digits is a million, which is nothing to a machine and
//! quite a lot to a person standing at a counter, and the whole safety of this
//! rests on that difference being enforced rather than assumed. So a PIN uses
//! the **same lockout counter as the password** (`edge_user.failed_login_count`,
//! `login_blocked_until`): five wrong and the account is shut, and a finger
//! does not open it either, because the lockout is about the account and not
//! about the keyboard.
//!
//! # What this has that the fingerprint path does not
//!
//! **The node checks it itself.** A fingerprint is matched on the counter,
//! because the scanner and its matcher are there and the node has neither — so
//! the node has to believe a paired terminal when it says a finger matched. A
//! PIN has no such problem: the secret comes to the node and the node compares
//! it. A terminal cannot assert its way past this one.
//!
//! It still travels over the terminal-signed channel, so a supervisor's grant
//! stays bound to the till the supervisor actually walked up to.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::edge::contracts::EdgeError;
use crate::security;

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

/// Digits, and enough of them to be worth the lockout behind it.
const MIN_PIN: usize = 6;
const MAX_PIN: usize = 8;

/// Which step-up this node accepts, besides a password.
///
/// Read before anybody has signed in, because a till has to know what to draw
/// on its own sign-in screen.
pub fn step_up(connection: &Connection) -> Result<String, EdgeError> {
    let value: Option<String> = connection
        .query_row(
            "SELECT till_step_up FROM edge_auth_option WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    Ok(value.unwrap_or_else(|| "NONE".to_string()))
}

/// Change what this node accepts. One row, and every till follows it.
pub fn set_step_up(
    connection: &Connection,
    method: &str,
    actor: &str,
) -> Result<String, EdgeError> {
    let method = method.trim().to_ascii_uppercase();
    if !matches!(method.as_str(), "NONE" | "PIN" | "FINGERPRINT") {
        return Err(EdgeError::Validation(
            "a node accepts NONE, PIN or FINGERPRINT".into(),
        ));
    }
    let actor = security::normalize_username(actor).map_err(EdgeError::Validation)?;
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO edge_auth_option (singleton,till_step_up,updated_at,updated_by)
             VALUES (1,?1,?2,?3)
             ON CONFLICT(singleton) DO UPDATE SET
               till_step_up=excluded.till_step_up,
               updated_at=excluded.updated_at,
               updated_by=excluded.updated_by",
            params![method, now, actor],
        )
        .map_err(db)?;
    Ok(method)
}

/// Give somebody a PIN, or replace the one they have.
pub fn set_pin(
    connection: &Connection,
    username: &str,
    pin: &str,
    actor: &str,
) -> Result<(), EdgeError> {
    let username = security::normalize_username(username).map_err(EdgeError::Validation)?;
    let pin = pin.trim();
    if pin.len() < MIN_PIN || pin.len() > MAX_PIN || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(EdgeError::Validation(format!(
            "a PIN is {MIN_PIN} to {MAX_PIN} digits"
        )));
    }
    // Refused rather than merely discouraged. "123456" and a birthday are what
    // a counter picks when nothing stops it, and a PIN that everybody guesses
    // first is a PIN that makes the lockout irrelevant.
    if pin.chars().all(|c| c == pin.as_bytes()[0] as char) {
        return Err(EdgeError::Validation(
            "a PIN cannot be the same digit repeated".into(),
        ));
    }
    let ascending: String = (0..pin.len())
        .map(|at| char::from(b'0' + ((pin.as_bytes()[0] - b'0') + at as u8) % 10))
        .collect();
    if pin == ascending {
        return Err(EdgeError::Validation(
            "a PIN cannot be a run of consecutive digits".into(),
        ));
    }

    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_user WHERE username=?1 AND active=1)",
            params![username],
            |row| row.get(0),
        )
        .map_err(db)?;
    if !exists {
        return Err(EdgeError::Validation(
            "no active user by that name at this shop".into(),
        ));
    }

    let actor = security::normalize_username(actor).map_err(EdgeError::Validation)?;
    // Argon2, the same as a password. Six digits deserve more work per guess
    // than six letters, not less.
    let hash = security::hash_password(pin, MIN_PIN).map_err(EdgeError::Validation)?;
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO edge_user_pin (username,pin_hash,set_at,set_by,updated_at)
             VALUES (?1,?2,?3,?4,?3)
             ON CONFLICT(username) DO UPDATE SET
               pin_hash=excluded.pin_hash,
               set_at=excluded.set_at,
               set_by=excluded.set_by,
               updated_at=excluded.updated_at",
            params![username, hash, now, actor],
        )
        .map_err(db)?;
    Ok(())
}

/// Take a PIN away. Used one at a time, and used in bulk on the day a shop
/// stops being staging.
pub fn clear_pin(connection: &Connection, username: &str) -> Result<(), EdgeError> {
    let username = security::normalize_username(username).map_err(EdgeError::Validation)?;
    connection
        .execute(
            "DELETE FROM edge_user_pin WHERE username=?1",
            params![username],
        )
        .map_err(db)?;
    Ok(())
}

/// Check a PIN, and move the account's lockout counter either way.
///
/// Returns the username in its stored spelling. Every refusal is the same
/// sentence: "no such user" told apart from "wrong PIN" is a way to find out
/// who works here, and at a counter that list is worth something.
pub fn verify(connection: &Connection, username: &str, pin: &str) -> Result<String, EdgeError> {
    let refuse = || EdgeError::Unauthorized("PIN refused".into());
    let username = security::normalize_username(username).map_err(|_| refuse())?;
    let now = Utc::now();

    let row: Option<(
        String,
        i64,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
    )> = connection
        .query_row(
            "SELECT u.id,u.active,u.login_blocked_until,u.failed_login_count,p.pin_hash,
                    u.valid_until
             FROM edge_user u
             LEFT JOIN edge_user_pin p ON p.username = u.username
             WHERE u.username=?1",
            params![username],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(db)?;

    let Some((id, active, blocked_until, failures, pin_hash, valid_until)) = row else {
        return Err(refuse());
    };
    if active != 1 {
        return Err(refuse());
    }
    // The password's lease, never the finger's (`0095`): a PIN is typed, so it
    // proves no more than a password that the person is at the till. Checked
    // before the PIN is, as a password past its lease is, so it moves no
    // counter; an unreadable lease is an ended one. No lease is a LOCAL
    // account, which head office does not lease.
    if valid_until.as_deref().is_some_and(|until| {
        chrono::DateTime::parse_from_rfc3339(until)
            .map(|parsed| parsed <= now)
            .unwrap_or(true)
    }) {
        return Err(refuse());
    }
    if let Some(until) = blocked_until.as_deref() {
        if chrono::DateTime::parse_from_rfc3339(until)
            .map(|parsed| parsed > now)
            .unwrap_or(false)
        {
            // Said plainly, because it is the one refusal a person can act on
            // — by waiting, or by asking for a reset — and it reveals nothing
            // a wrong PIN did not already reveal.
            return Err(EdgeError::Unauthorized(
                "this account is locked after too many wrong tries; wait or ask for a reset".into(),
            ));
        }
    }
    let Some(pin_hash) = pin_hash else {
        return Err(refuse());
    };

    if !security::password_matches(&pin_hash, pin.trim()) {
        // The same counter a wrong password moves. Six digits is only safe
        // because of this line.
        let failures = failures.saturating_add(1);
        let blocked = (failures >= 5).then(|| (now + chrono::Duration::minutes(15)).to_rfc3339());
        connection
            .execute(
                "UPDATE edge_user
                 SET failed_login_count=?2,login_blocked_until=?3,updated_at=?4
                 WHERE id=?1",
                params![id, failures, blocked, now.to_rfc3339()],
            )
            .map_err(db)?;
        return Err(refuse());
    }

    connection
        .execute(
            "UPDATE edge_user
             SET failed_login_count=0,failed_login_window_started_at=NULL,
                 login_blocked_until=NULL,last_login_at=?2
             WHERE id=?1",
            params![id, now.to_rfc3339()],
        )
        .map_err(db)?;
    Ok(username)
}
