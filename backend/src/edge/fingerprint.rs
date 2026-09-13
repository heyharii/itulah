//! A finger opens a till, and authorises a void.
//!
//! The counter reaches for a keyboard far less often than it reaches for a
//! scanner. A cashier signs in at the start of a shift and a supervisor is
//! called over many times a day, and both are password prompts typed in front
//! of a queue — which is how a shop ends up with a supervisor's password
//! written on the side of a monitor.
//!
//! # Where the matching happens, and what that costs
//!
//! On the till. The scanner is USB on the counter and its matcher is the
//! vendor's own; this node has neither, and a node that asked for the captured
//! print instead would be a node that cannot sign anybody in when it is the
//! thing that is unreachable.
//!
//! So this node does two things and refuses a third. It says **which fingers
//! may open this shop** (the roster), and it decides **what a match is worth**
//! (a session, or one supervisor authorisation). It does not decide whether the
//! finger matched — it cannot see the finger.
//!
//! That makes the claim a statement by the terminal, and a statement is only
//! worth the credential behind it. Hence [`TerminalProof`]: the same
//! construction `edge/rfid.rs` already demands of a reader — a signature over
//! the method, the path, the terminal, the clock, a monotonic sequence and the
//! body — so a captured claim is useless a second time.
//!
//! **What a paired terminal can do, said plainly:** assert that a finger
//! matched. That is inherent to matching on the device and no signature removes
//! it. It is bounded by three things instead: every claim is written down
//! against the terminal that made it, refused claims included; a terminal is
//! switched off by one row; and a terminal only ever holds the fingers this
//! shop enrolled.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::edge::contracts::EdgeError;
use crate::security;

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

/// How far a terminal's clock may be out before its claim is refused.
///
/// The same five minutes the sync wire allows. A counter PC with a dead CMOS
/// battery is a real thing, and the failure it should produce is "fix this
/// terminal's clock", not a signature that silently verifies anyway.
const CLOCK_SKEW_SECONDS: i64 = 300;

// ════════════════════════════════════════════════════════════════════════════
// The terminal's credential
// ════════════════════════════════════════════════════════════════════════════

/// What a terminal sends to prove a claim is its own.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TerminalProof {
    pub terminal_id: String,
    /// Unix seconds, as the terminal reads them.
    pub timestamp: i64,
    /// Strictly increasing per terminal. A replayed claim carries a sequence
    /// the node has already seen and is refused on that alone.
    pub sequence: i64,
    /// Lowercase hex HMAC-SHA256. See [`sign_terminal_request`].
    pub signature: String,
}

/// The one construction, written once so the terminal and the node cannot
/// drift apart on it.
///
/// Deliberately the same shape as `sign_rfid_request`: method, path, who,
/// when, which, and what. The path is in there because a signature that did not
/// name its endpoint could be lifted from the roster call and spent on the
/// session call.
pub fn sign_terminal_request(
    signing_key_sha256: &str,
    terminal_id: &str,
    method: &str,
    path: &str,
    timestamp: i64,
    sequence: i64,
    body_sha256: &str,
) -> String {
    let canonical =
        format!("{method}\n{path}\n{terminal_id}\n{timestamp}\n{sequence}\n{body_sha256}");
    security::hmac_sha256_hex(signing_key_sha256.as_bytes(), canonical.as_bytes())
}

/// What pairing hands back, once and never again.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PairedTerminal {
    pub terminal_id: String,
    /// The secret, in the clear, in this one response. The node keeps only its
    /// hash — a node that could read its terminals' keys back is a node whose
    /// theft is every till's theft.
    pub secret: String,
    pub label: String,
    pub paired_at: String,
}

/// Pair a counter terminal with this shop's node.
///
/// Done once, by whoever installs the till, while signed in as somebody allowed
/// to. `actor` is written onto the row: pairing grants a machine the right to
/// assert who is standing at it, and an unattributed pairing is that right
/// granted by nobody.
pub fn pair_terminal(
    connection: &Connection,
    label: &str,
    actor: &str,
) -> Result<PairedTerminal, EdgeError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(EdgeError::Validation(
            "a terminal needs a label somebody can read off the machine".into(),
        ));
    }
    let actor = security::normalize_username(actor).map_err(EdgeError::Validation)?;
    let terminal_id = format!("term-{}", Uuid::new_v4());
    let secret = security::random_token();
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO edge_terminal
               (terminal_id,label,auth_key_sha256,active,last_sequence,paired_at,paired_by,updated_at)
             VALUES (?1,?2,?3,1,0,?4,?5,?4)",
            params![
                terminal_id,
                label,
                security::sha256_hex(&secret),
                now,
                actor
            ],
        )
        .map_err(db)?;
    Ok(PairedTerminal {
        terminal_id,
        secret,
        label: label.to_string(),
        paired_at: now,
    })
}

/// Check a terminal's proof, and burn the sequence it used.
///
/// Returns the terminal id in its stored spelling. Every refusal here is
/// `Unauthorized` with one wording: "which of the six things was wrong" is a
/// way to probe a node for valid terminal ids.
fn verify_terminal(
    tx: &Transaction<'_>,
    proof: &TerminalProof,
    method: &str,
    path: &str,
    body_sha256: &str,
) -> Result<String, EdgeError> {
    let refuse = || EdgeError::Unauthorized("terminal authorisation refused".into());
    let terminal_id = proof.terminal_id.trim();
    if terminal_id.is_empty() || proof.sequence < 1 {
        return Err(refuse());
    }
    if proof.signature.len() != 64 || !proof.signature.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(refuse());
    }

    let now = Utc::now().timestamp();
    if (now - proof.timestamp).abs() > CLOCK_SKEW_SECONDS {
        // The one refusal that is spelled out, because it is the only one a
        // person at the counter can act on and it is not a secret.
        return Err(EdgeError::Unauthorized(
            "this terminal's clock is too far from the node's; fix the clock and try again".into(),
        ));
    }

    let row: Option<(String, i64, i64, Option<String>)> = tx
        .query_row(
            "SELECT auth_key_sha256,active,last_sequence,last_request_digest
             FROM edge_terminal WHERE terminal_id=?1",
            params![terminal_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((signing_key, active, last_sequence, last_digest)) = row else {
        return Err(refuse());
    };
    if active != 1 {
        return Err(EdgeError::Unauthorized(
            "this terminal has been switched off at the node".into(),
        ));
    }

    // A repeat of the last sequence with the same body is the same request
    // arriving twice — a till that retried through a timeout. Anything else at
    // or below the high-water mark is a replay.
    if proof.sequence < last_sequence
        || (proof.sequence == last_sequence && last_digest.as_deref() != Some(body_sha256))
    {
        return Err(refuse());
    }

    let expected = sign_terminal_request(
        &signing_key,
        terminal_id,
        method,
        path,
        proof.timestamp,
        proof.sequence,
        body_sha256,
    );
    if !security::constant_time_eq(&proof.signature.to_ascii_lowercase(), &expected) {
        return Err(refuse());
    }

    tx.execute(
        "UPDATE edge_terminal
         SET last_sequence=?2,last_request_digest=?3,last_seen_at=?4,updated_at=?4
         WHERE terminal_id=?1",
        params![
            terminal_id,
            proof.sequence,
            body_sha256,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(db)?;
    Ok(terminal_id.to_string())
}

// ════════════════════════════════════════════════════════════════════════════
// Enrolment
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EnrolRequest {
    /// Whose finger. Checked against the same user table a password is checked
    /// against, so somebody barred at the keyboard is barred at the scanner.
    pub username: String,
    /// Which finger, in the enroller's words — "telunjuk kanan". A person
    /// enrols more than one, because a plaster on a thumb must not end a shift.
    pub label: String,
    pub template_base64: String,
    /// What produced it. A template from one SDK generation does not always
    /// match under another, and a shop replacing its scanners needs to know
    /// which enrolments to redo rather than finding out one cashier at a time.
    pub reader_kind: String,
}

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EnrolledFinger {
    pub finger_id: String,
    pub username: String,
    pub label: String,
    pub reader_kind: String,
    pub enrolled_at: String,
    pub enrolled_by: String,
}

/// Record a finger against a user.
///
/// The enroller is a person, not a terminal: this is authenticated by a normal
/// session with the permission to do it, the same way changing a password is.
pub fn enrol(
    connection: &Connection,
    request: EnrolRequest,
    enrolled_by: &str,
) -> Result<EnrolledFinger, EdgeError> {
    let username =
        security::normalize_username(&request.username).map_err(EdgeError::Validation)?;
    let label = request.label.trim();
    let template = request.template_base64.trim();
    let reader_kind = request.reader_kind.trim();
    if label.is_empty() {
        return Err(EdgeError::Validation(
            "say which finger this is, so it can be retired without guessing".into(),
        ));
    }
    if template.is_empty() {
        return Err(EdgeError::Validation("no fingerprint template".into()));
    }
    if reader_kind.is_empty() {
        return Err(EdgeError::Validation(
            "say which reader produced this template; a later SDK may not match it".into(),
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

    let enrolled_by = security::normalize_username(enrolled_by).map_err(EdgeError::Validation)?;
    let finger_id = format!("fp-{}", Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO edge_fingerprint
               (finger_id,username,label,template_base64,reader_kind,
                enrolled_at,enrolled_by,active,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,1,?6)",
            params![
                finger_id,
                username,
                label,
                template,
                reader_kind,
                now,
                enrolled_by
            ],
        )
        .map_err(db)?;

    Ok(EnrolledFinger {
        finger_id,
        username,
        label: label.to_string(),
        reader_kind: reader_kind.to_string(),
        enrolled_at: now,
        enrolled_by,
    })
}

/// Retire a finger. Never deleted: a void authorised last month was authorised
/// by a finger, and a row that vanished takes the answer to "who let this
/// happen" with it.
pub fn retire(connection: &Connection, finger_id: &str) -> Result<(), EdgeError> {
    let now = Utc::now().to_rfc3339();
    let changed = connection
        .execute(
            "UPDATE edge_fingerprint SET active=0,retired_at=?2,updated_at=?2
             WHERE finger_id=?1 AND active=1",
            params![finger_id, now],
        )
        .map_err(db)?;
    if changed == 0 {
        return Err(EdgeError::Validation(
            "no active enrolment by that id".into(),
        ));
    }
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// The roster
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RosterEntry {
    pub finger_id: String,
    pub username: String,
    pub label: String,
    pub template_base64: String,
    /// Whether this person may authorise a void or a return, so a till can tell
    /// a cashier's finger from a supervisor's before it asks for one.
    pub is_supervisor: bool,
}

/// The fingers that may open this shop's tills.
///
/// Handed only to a terminal that has proved possession of its pairing secret.
/// The templates are opaque vendor blobs and cannot be turned back into images,
/// which is the only reason it is acceptable for them to leave this node at all.
pub fn roster(
    connection: &mut Connection,
    proof: &TerminalProof,
    path: &str,
    body_sha256: &str,
) -> Result<Vec<RosterEntry>, EdgeError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    verify_terminal(&tx, proof, "GET", path, body_sha256)?;

    let entries = {
        let mut statement = tx
            .prepare(
                "SELECT f.finger_id,f.username,f.label,f.template_base64,u.role
                 FROM edge_fingerprint f
                 JOIN edge_user u ON u.username = f.username
                 WHERE f.active=1 AND u.active=1
                 ORDER BY f.username,f.label",
            )
            .map_err(db)?;
        let rows = statement
            .query_map([], |row| {
                let role: String = row.get(4)?;
                Ok(RosterEntry {
                    finger_id: row.get(0)?,
                    username: row.get(1)?,
                    label: row.get(2)?,
                    template_base64: row.get(3)?,
                    is_supervisor: matches!(role.as_str(), "SUPERVISOR" | "ADMIN"),
                })
            })
            .map_err(db)?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(db)?);
        }
        entries
    };

    tx.commit().map_err(db)?;
    Ok(entries)
}

// ════════════════════════════════════════════════════════════════════════════
// The claim
// ════════════════════════════════════════════════════════════════════════════

/// What a till says it found on the scanner.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimRequest {
    /// Which enrolment matched. Null when nothing did — reported rather than
    /// withheld, because a finger tried repeatedly and never matching is the
    /// shape a table of successes could never show.
    pub finger_id: Option<String>,
    /// `SESSION` to open a till, `SUPERVISOR` to authorise one action on a till
    /// somebody else is signed in to.
    pub purpose: String,
    /// The vendor's own confidence, when it reported one.
    #[serde(default)]
    pub score: Option<i32>,
}

/// What the node made of it.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimAccepted {
    pub username: String,
    pub purpose: String,
    /// Present for `SUPERVISOR` only: a one-shot authorisation the till puts on
    /// the void or the return instead of a password. Short-lived, single-use,
    /// and bound to the terminal that earned it.
    pub authorization: Option<String>,
    pub expires_at: Option<String>,
}

/// How long a supervisor's authorisation is good for.
///
/// Long enough for somebody to walk back to their own till, short enough that a
/// supervisor who authorises a void and then leaves has not left a spare key on
/// the counter.
const SUPERVISOR_GRANT_SECONDS: i64 = 180;

/// Judge a claim, and write it down either way.
pub fn claim(
    connection: &mut Connection,
    proof: &TerminalProof,
    request: ClaimRequest,
    path: &str,
    body_sha256: &str,
) -> Result<ClaimAccepted, EdgeError> {
    let purpose = request.purpose.trim().to_ascii_uppercase();
    if !matches!(purpose.as_str(), "SESSION" | "SUPERVISOR") {
        return Err(EdgeError::Validation(
            "a claim is either SESSION or SUPERVISOR".into(),
        ));
    }

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = verify_terminal(&tx, proof, "POST", path, body_sha256)?;
    let now = Utc::now();

    // Written whether or not it is accepted, and before the decision is acted
    // on, so a refusal cannot be lost by the error path that produced it.
    let record = |tx: &Transaction<'_>,
                  finger_id: Option<&str>,
                  username: Option<&str>,
                  accepted: bool,
                  refusal: Option<&str>|
     -> Result<(), EdgeError> {
        tx.execute(
            "INSERT INTO edge_fingerprint_claim
               (claim_id,device_id,finger_id,username,purpose,accepted,refusal,score,claimed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                Uuid::new_v4().to_string(),
                terminal_id,
                finger_id,
                username,
                purpose,
                i64::from(accepted),
                refusal,
                request.score,
                now.to_rfc3339()
            ],
        )
        .map_err(db)?;
        Ok(())
    };

    let Some(finger_id) = request
        .finger_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        record(&tx, None, None, false, Some("no match on the terminal"))?;
        tx.commit().map_err(db)?;
        return Err(EdgeError::Unauthorized(
            "that finger is not enrolled at this shop".into(),
        ));
    };

    let row: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT f.username,u.role,u.active
             FROM edge_fingerprint f
             JOIN edge_user u ON u.username = f.username
             WHERE f.finger_id=?1 AND f.active=1",
            params![finger_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;

    let Some((username, role, active)) = row else {
        record(&tx, Some(finger_id), None, false, Some("unknown enrolment"))?;
        tx.commit().map_err(db)?;
        return Err(EdgeError::Unauthorized(
            "that finger is not enrolled at this shop".into(),
        ));
    };
    if active != 1 {
        record(
            &tx,
            Some(finger_id),
            Some(&username),
            false,
            Some("user is not active"),
        )?;
        tx.commit().map_err(db)?;
        return Err(EdgeError::Unauthorized(
            "that account is not active at this shop".into(),
        ));
    }
    if purpose == "SUPERVISOR" && !matches!(role.as_str(), "SUPERVISOR" | "ADMIN") {
        record(
            &tx,
            Some(finger_id),
            Some(&username),
            false,
            Some("not a supervisor"),
        )?;
        tx.commit().map_err(db)?;
        // Same wording a wrong password gets in `verify_supervisor`: telling a
        // till which fingers are supervisors is telling it whose finger to ask
        // for.
        return Err(EdgeError::Unauthorized(
            "supervisor authorisation refused".into(),
        ));
    }

    let accepted = if purpose == "SUPERVISOR" {
        let grant = security::random_token();
        let expires_at = now + chrono::Duration::seconds(SUPERVISOR_GRANT_SECONDS);
        tx.execute(
            "INSERT INTO edge_supervisor_grant
               (grant_token_sha256,username,terminal_id,issued_at,expires_at,spent_at)
             VALUES (?1,?2,?3,?4,?5,NULL)",
            params![
                security::sha256_hex(&grant),
                username,
                terminal_id,
                now.to_rfc3339(),
                expires_at.to_rfc3339()
            ],
        )
        .map_err(db)?;
        ClaimAccepted {
            username: username.clone(),
            purpose: purpose.clone(),
            authorization: Some(grant),
            expires_at: Some(expires_at.to_rfc3339()),
        }
    } else {
        ClaimAccepted {
            username: username.clone(),
            purpose: purpose.clone(),
            authorization: None,
            expires_at: None,
        }
    };

    record(&tx, Some(finger_id), Some(&username), true, None)?;
    tx.commit().map_err(db)?;
    Ok(accepted)
}

/// The same claim, made with a PIN instead of a finger.
///
/// Shares everything that matters with [`claim`] — the terminal's proof, the
/// claim record, the grant — and differs in the one place that counts: the node
/// checks the secret itself rather than believing the terminal's word that a
/// finger matched. A PIN cannot be asserted past this function.
///
/// It still rides the terminal-signed channel, so a supervisor's grant stays
/// bound to the till the supervisor actually walked up to.
pub fn pin_claim(
    connection: &mut Connection,
    proof: &TerminalProof,
    username: &str,
    pin: &str,
    purpose: &str,
    path: &str,
    body_sha256: &str,
) -> Result<ClaimAccepted, EdgeError> {
    let purpose = purpose.trim().to_ascii_uppercase();
    if !matches!(purpose.as_str(), "SESSION" | "SUPERVISOR") {
        return Err(EdgeError::Validation(
            "a claim is either SESSION or SUPERVISOR".into(),
        ));
    }

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = verify_terminal(&tx, proof, "POST", path, body_sha256)?;

    // What this node accepts is this node's decision. A production shop refuses
    // a PIN here rather than relying on its tills not to offer one: a method
    // hidden in an interface and still accepted at the door is the weakest
    // thing in the building, and it is weakest where nobody is looking.
    let accepts = crate::edge::pin::step_up(&tx)?;
    if accepts != "PIN" {
        return Err(EdgeError::Unauthorized(
            "this shop's node does not accept a PIN; use a fingerprint or a password".into(),
        ));
    }

    let now = Utc::now();
    let record = |tx: &Transaction<'_>,
                  who: Option<&str>,
                  accepted: bool,
                  refusal: Option<&str>|
     -> Result<(), EdgeError> {
        tx.execute(
            "INSERT INTO edge_fingerprint_claim
               (claim_id,device_id,finger_id,username,purpose,accepted,refusal,score,claimed_at,method)
             VALUES (?1,?2,NULL,?3,?4,?5,?6,NULL,?7,'PIN')",
            params![
                Uuid::new_v4().to_string(),
                terminal_id,
                who,
                purpose,
                i64::from(accepted),
                refusal,
                now.to_rfc3339()
            ],
        )
        .map_err(db)?;
        Ok(())
    };

    let verified = match crate::edge::pin::verify(&tx, username, pin) {
        Ok(verified) => verified,
        Err(error) => {
            // Written down before the refusal leaves, so a run of wrong PINs at
            // one terminal late in the evening is visible as the shape it is.
            record(&tx, Some(username.trim()), false, Some("PIN refused"))?;
            tx.commit().map_err(db)?;
            return Err(error);
        }
    };

    if purpose == "SUPERVISOR" {
        let role: String = tx
            .query_row(
                "SELECT role FROM edge_user WHERE username=?1",
                params![verified],
                |row| row.get(0),
            )
            .map_err(db)?;
        if !matches!(role.as_str(), "SUPERVISOR" | "ADMIN") {
            record(&tx, Some(&verified), false, Some("not a supervisor"))?;
            tx.commit().map_err(db)?;
            return Err(EdgeError::Unauthorized(
                "supervisor authorisation refused".into(),
            ));
        }
        let grant = security::random_token();
        let expires_at = now + chrono::Duration::seconds(SUPERVISOR_GRANT_SECONDS);
        tx.execute(
            "INSERT INTO edge_supervisor_grant
               (grant_token_sha256,username,terminal_id,issued_at,expires_at,spent_at)
             VALUES (?1,?2,?3,?4,?5,NULL)",
            params![
                security::sha256_hex(&grant),
                verified,
                terminal_id,
                now.to_rfc3339(),
                expires_at.to_rfc3339()
            ],
        )
        .map_err(db)?;
        record(&tx, Some(&verified), true, None)?;
        tx.commit().map_err(db)?;
        return Ok(ClaimAccepted {
            username: verified,
            purpose,
            authorization: Some(grant),
            expires_at: Some(expires_at.to_rfc3339()),
        });
    }

    record(&tx, Some(&verified), true, None)?;
    tx.commit().map_err(db)?;
    Ok(ClaimAccepted {
        username: verified,
        purpose,
        authorization: None,
        expires_at: None,
    })
}

/// Spend a supervisor's authorisation, or refuse it.
///
/// Single use, and marked spent inside the caller's own transaction so a void
/// that fails after this point does not leave a grant that has been burned for
/// nothing — and a grant cannot pay for two voids.
pub fn spend_grant(tx: &Transaction<'_>, token: &str) -> Result<String, EdgeError> {
    let refuse = || EdgeError::Unauthorized("supervisor authorisation refused".into());
    let digest = security::sha256_hex(token);
    let row: Option<(String, String, Option<String>)> = tx
        .query_row(
            "SELECT username,expires_at,spent_at FROM edge_supervisor_grant
             WHERE grant_token_sha256=?1",
            params![digest],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((username, expires_at, spent_at)) = row else {
        return Err(refuse());
    };
    if spent_at.is_some() {
        return Err(refuse());
    }
    let expires = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    if expires <= Utc::now() {
        return Err(EdgeError::Unauthorized(
            "that authorisation has expired; ask the supervisor again".into(),
        ));
    }
    tx.execute(
        "UPDATE edge_supervisor_grant SET spent_at=?2 WHERE grant_token_sha256=?1",
        params![digest, Utc::now().to_rfc3339()],
    )
    .map_err(db)?;
    Ok(username)
}
