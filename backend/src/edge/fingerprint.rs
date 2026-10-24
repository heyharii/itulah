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
///
/// Crate-visible because a till that joined by code (`edge/devices.rs`) signs
/// its own reports the same way. `active` is the one switch read here, and
/// `devices.rs` keeps it in step with the till's status: a suspended or
/// revoked till is refused at this line.
pub(crate) fn verify_terminal(
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

// ════════════════════════════════════════════════════════════════════════════
// An employee's finger opens their benefit balance
// ════════════════════════════════════════════════════════════════════════════

/// What a till says it found on the scanner when an employee lays a finger on
/// it to pay from their benefit balance (client, 24 Oct 2026: "jari karyawan",
/// no code).
#[derive(Clone, Debug, Deserialize)]
pub struct BenefitClaimRequest {
    /// Which enrolment matched. Null when nothing did — written down all the
    /// same, as a sign-in's miss is.
    pub finger_id: Option<String>,
    #[serde(default)]
    pub score: Option<i32>,
}

/// What a matched finger buys: one grant the till puts on the benefit lookup
/// and the spend instead of a code, and who it names.
#[derive(Debug, Serialize)]
pub struct BenefitFinger {
    pub username: String,
    pub display_name: String,
    pub authorization: String,
    pub expires_at: String,
}

/// How long an employee's finger stays good for their balance.
///
/// Longer than a supervisor's three minutes: the finger is laid at Bayar and
/// the spend happens at "Pembayaran diterima", after the rest of the basket is
/// paid — a card on a slow line included. Still one basket's worth: a grant
/// left behind on the counter does not outlive the queue.
const BENEFIT_GRANT_SECONDS: i64 = 600;

/// Judge a benefit claim, and write it down either way.
///
/// Any active person enrolled at this shop may open their own balance — a
/// cashier's finger is an employee's finger. What the grant is NOT is a
/// supervisor's yes: it lives in its own table (`0088`) and nothing that spends
/// a supervisor's grant reads it.
pub fn benefit_claim(
    connection: &mut Connection,
    proof: &TerminalProof,
    request: BenefitClaimRequest,
    path: &str,
    body_sha256: &str,
) -> Result<BenefitFinger, EdgeError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let terminal_id = verify_terminal(&tx, proof, "POST", path, body_sha256)?;
    let now = Utc::now();
    let score = request.score;

    let refuse = |tx: Transaction<'_>,
                  finger_id: Option<&str>,
                  username: Option<&str>,
                  refusal: &str,
                  said: &str|
     -> Result<BenefitFinger, EdgeError> {
        tx.execute(
            "INSERT INTO edge_benefit_finger
               (claim_id,terminal_id,finger_id,username,accepted,refusal,score,claimed_at)
             VALUES (?1,?2,?3,?4,0,?5,?6,?7)",
            params![
                Uuid::new_v4().to_string(),
                terminal_id,
                finger_id,
                username,
                refusal,
                score,
                now.to_rfc3339()
            ],
        )
        .map_err(db)?;
        tx.commit().map_err(db)?;
        Err(EdgeError::Unauthorized(said.into()))
    };

    let Some(finger_id) = request
        .finger_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    else {
        return refuse(
            tx,
            None,
            None,
            "no match on the terminal",
            "that finger is not enrolled at this shop",
        );
    };

    let row: Option<(String, String, i64)> = tx
        .query_row(
            "SELECT f.username,u.display_name,u.active
             FROM edge_fingerprint f
             JOIN edge_user u ON u.username = f.username
             WHERE f.finger_id=?1 AND f.active=1",
            params![finger_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)?;
    let Some((username, display_name, active)) = row else {
        return refuse(
            tx,
            Some(finger_id),
            None,
            "unknown enrolment",
            "that finger is not enrolled at this shop",
        );
    };
    if active != 1 {
        return refuse(
            tx,
            Some(finger_id),
            Some(&username),
            "user is not active",
            "that account is not active at this shop",
        );
    }

    let grant = security::random_token();
    let expires_at = now + chrono::Duration::seconds(BENEFIT_GRANT_SECONDS);
    tx.execute(
        "INSERT INTO edge_benefit_finger
           (claim_id,terminal_id,finger_id,username,accepted,refusal,score,claimed_at,
            grant_token_sha256,expires_at)
         VALUES (?1,?2,?3,?4,1,NULL,?5,?6,?7,?8)",
        params![
            Uuid::new_v4().to_string(),
            terminal_id,
            finger_id,
            username,
            score,
            now.to_rfc3339(),
            security::sha256_hex(&grant),
            expires_at.to_rfc3339()
        ],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(BenefitFinger {
        username,
        display_name,
        authorization: grant,
        expires_at: expires_at.to_rfc3339(),
    })
}

/// A benefit grant's row: whose, until when, and whether it was spent.
fn benefit_grant_row(
    connection: &Connection,
    digest: &str,
) -> Result<Option<(String, String, Option<String>)>, EdgeError> {
    connection
        .query_row(
            "SELECT username,expires_at,spent_at FROM edge_benefit_finger
             WHERE grant_token_sha256=?1 AND accepted=1",
            params![digest],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db)
}

/// Whose finger a benefit grant is, while it is still good. Reads; spends
/// nothing — the lookup that shows the balance uses this.
pub fn benefit_grant_holder(connection: &Connection, token: &str) -> Result<String, EdgeError> {
    let refuse = || EdgeError::Unauthorized("that finger is no longer good; lay it again".into());
    let Some((username, expires_at, spent_at)) =
        benefit_grant_row(connection, &security::sha256_hex(token.trim()))?
    else {
        return Err(refuse());
    };
    if spent_at.is_some() {
        return Err(refuse());
    }
    let expires = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map_err(|error| EdgeError::Persistence(error.to_string()))?;
    if expires <= Utc::now() {
        return Err(EdgeError::Unauthorized(
            "that finger has expired; lay it again".into(),
        ));
    }
    Ok(username)
}

/// Spend a benefit grant on one basket, or refuse it. Single use: two spends
/// racing for one grant meet SQLite's one writer, and the second finds it
/// spent.
pub fn spend_benefit_grant(
    connection: &mut Connection,
    token: &str,
    sale_ref: &str,
) -> Result<String, EdgeError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let username = benefit_grant_holder(&tx, token)?;
    tx.execute(
        "UPDATE edge_benefit_finger SET spent_at=?2,sale_ref=?3
         WHERE grant_token_sha256=?1 AND spent_at IS NULL",
        params![
            security::sha256_hex(token.trim()),
            Utc::now().to_rfc3339(),
            sale_ref.trim()
        ],
    )
    .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(username)
}

/// Give a grant back when head office never took the spend it was used for:
/// the line was down, or it refused. The employee is still standing there and
/// the finger was good — making them lay it again for the node's own failure
/// would be the till's fault passed to the queue. Only the spend it was taken
/// for is undone.
pub fn unspend_benefit_grant(
    connection: &Connection,
    token: &str,
    sale_ref: &str,
) -> Result<(), EdgeError> {
    connection
        .execute(
            "UPDATE edge_benefit_finger SET spent_at=NULL,sale_ref=NULL
             WHERE grant_token_sha256=?1 AND sale_ref=?2",
            params![security::sha256_hex(token.trim()), sale_ref.trim()],
        )
        .map_err(db)?;
    Ok(())
}

// ── HR's enrolments, from head office (24 Oct 2026) ─────────────────────────
//
// The owner: HR enrols a person's fingers when it registers them. The
// templates live sealed at head office (postgres 0233) and this server asks
// for the ones of everybody who signs in here (`/api/v1/sync/pos-fingers`),
// every few minutes. What it holds from head office is replaced by each
// answer: a finger HR enrolled arrives, one withdrawn — or of somebody who
// left, or was moved off this server — is retired and its template wiped.
// A finger enrolled here before (`source = 'STORE'`) keeps working until its
// owner leaves; a store head's recording waits for head office ([`submit`]).

/// One finger as head office hands it down.
#[derive(Debug, Clone, Deserialize)]
pub struct HeadOfficeFinger {
    pub username: String,
    /// `RIGHT_INDEX`, `LEFT_THUMB`, ...
    pub finger: String,
    /// `ZKFINGER_V10`.
    pub format: String,
    pub template_base64: String,
    #[serde(default)]
    pub revision: i64,
}

#[derive(Debug, Deserialize)]
struct HeadOfficeFingers {
    fingers: Vec<HeadOfficeFinger>,
}

/// How often this server asks head office for its fingers, and sends the
/// ones recorded here. A minute: a store head waiting for head office's yes
/// should not wait five more for it to arrive.
const HEAD_OFFICE_FINGERS_EVERY: std::time::Duration = std::time::Duration::from_secs(60);

/// The finger as the POS screen says it.
fn finger_words(code: &str) -> String {
    let (side, digit) = code.split_once('_').unwrap_or(("", code));
    let digit = match digit {
        "THUMB" => "Jempol",
        "INDEX" => "Telunjuk",
        "MIDDLE" => "Jari tengah",
        "RING" => "Jari manis",
        "LITTLE" => "Kelingking",
        other => other,
    };
    match side {
        "LEFT" => format!("{digit} kiri"),
        "RIGHT" => format!("{digit} kanan"),
        _ => digit.to_owned(),
    }
}

/// Replace what this server holds from head office with `fingers`, and
/// retire the finger of anybody who no longer signs in here, whoever enrolled
/// it. A retired row keeps who and when, for "who let this happen", and loses
/// its template: a biometric held without a purpose is the thing UU PDP
/// forbids. Returns how many were taken and how many retired.
pub fn replace_from_head_office(
    connection: &mut Connection,
    fingers: &[HeadOfficeFinger],
) -> Result<(usize, usize), EdgeError> {
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db)?;
    let now = Utc::now().to_rfc3339();
    let mut kept = std::collections::HashSet::new();
    let mut taken = 0;
    for finger in fingers {
        let Ok(username) = security::normalize_username(&finger.username) else {
            continue;
        };
        let here: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM edge_user WHERE username=?1 AND active=1)",
                params![username],
                |row| row.get(0),
            )
            .map_err(db)?;
        if !here || finger.template_base64.trim().is_empty() {
            continue;
        }
        let finger_id = format!("ho-{username}-{}", finger.finger);
        taken += tx
            .execute(
                "INSERT INTO edge_fingerprint
                   (finger_id,username,label,template_base64,reader_kind,
                    enrolled_at,enrolled_by,active,updated_at,source)
                 VALUES (?1,?2,?3,?4,?5,?6,'HR',1,?6,'HO')
                 ON CONFLICT(finger_id) DO UPDATE SET
                    template_base64 = excluded.template_base64,
                    reader_kind = excluded.reader_kind,
                    label = excluded.label,
                    active = 1, retired_at = NULL,
                    updated_at = excluded.updated_at
                  WHERE edge_fingerprint.template_base64 <> excluded.template_base64
                     OR edge_fingerprint.active = 0",
                params![
                    finger_id,
                    username,
                    finger_words(&finger.finger),
                    finger.template_base64.trim(),
                    finger.format,
                    now
                ],
            )
            .map_err(db)?;
        // The same finger approved here by the store head: head office's
        // copy is the one that follows the person now.
        tx.execute(
            "UPDATE edge_fingerprint
                SET active=0, retired_at=?2, template_base64='', updated_at=?2
              WHERE finger_id=?1 AND active=1",
            params![store_finger_id(&username, &finger.finger), now],
        )
        .map_err(db)?;
        kept.insert(finger_id);
    }
    let held: Vec<String> = tx
        .prepare("SELECT finger_id FROM edge_fingerprint WHERE source='HO' AND active=1")
        .map_err(db)?
        .query_map([], |row| row.get(0))
        .map_err(db)?
        .collect::<Result<_, _>>()
        .map_err(db)?;
    let mut retired = 0;
    for finger_id in held.iter().filter(|id| !kept.contains(*id)) {
        retired += tx
            .execute(
                "UPDATE edge_fingerprint
                    SET active=0, retired_at=?2, template_base64='', updated_at=?2
                  WHERE finger_id=?1",
                params![finger_id, now],
            )
            .map_err(db)?;
    }
    retired += tx
        .execute(
            "UPDATE edge_fingerprint
                SET active=0, retired_at=?1, template_base64='', updated_at=?1
              WHERE active=1
                AND username NOT IN (SELECT username FROM edge_user WHERE active=1)",
            params![now],
        )
        .map_err(db)?;
    tx.commit().map_err(db)?;
    Ok((taken, retired))
}

// ── a finger recorded at the store waits for head office ─────────────────
//
// Owner, 24 Oct 2026: every finger recorded at a store waits for head office.
// The store head records her own at the POS after signing in with her
// password, then the people head office added. A recording sits in
// `edge_finger_submission` (`0090`), never in `edge_fingerprint`, so nothing
// can match it before head office says yes; it is sent with the next ask for
// fingers, and an approved one comes back as head office's own.

/// The ten fingers, in head office's words (`fingerprint_template.finger`).
pub const FINGER_CODES: [&str; 10] = [
    "LEFT_THUMB",
    "LEFT_INDEX",
    "LEFT_MIDDLE",
    "LEFT_RING",
    "LEFT_LITTLE",
    "RIGHT_THUMB",
    "RIGHT_INDEX",
    "RIGHT_MIDDLE",
    "RIGHT_RING",
    "RIGHT_LITTLE",
];

/// `POST /api/v1/auth/fingerprints/submissions`, from the store head's POS.
#[derive(Debug, Deserialize)]
pub struct SubmitFingerRequest {
    pub username: String,
    /// `RIGHT_INDEX`, `LEFT_THUMB`, ... — one of [`FINGER_CODES`].
    pub finger: String,
    /// The merged template the scanner produced from three presses.
    pub template_base64: String,
    pub reader_kind: String,
    #[serde(default)]
    pub quality: Option<u8>,
}

/// A recorded finger, as the POS shows it.
#[derive(Debug, Clone, Serialize)]
pub struct FingerSubmission {
    pub submission_id: String,
    pub username: String,
    pub finger: String,
    /// "Telunjuk kanan".
    pub label: String,
    /// `PENDING` until head office decides; `REFUSED` with its reason.
    pub status: String,
    pub reason: Option<String>,
    pub recorded_by: String,
    pub recorded_at: String,
}

/// Record a finger for head office to approve. Recording the same finger of
/// the same person again replaces what was waiting or was refused.
///
/// A finger already enrolled to somebody else here is refused by its exact
/// template; the POS matches the new capture against everybody's fingers
/// first, which is the check that catches the same finger pressed twice.
pub fn submit(
    connection: &Connection,
    request: SubmitFingerRequest,
    recorded_by: &str,
) -> Result<FingerSubmission, EdgeError> {
    let username =
        security::normalize_username(&request.username).map_err(EdgeError::Validation)?;
    let finger = request.finger.trim().to_ascii_uppercase();
    if !FINGER_CODES.contains(&finger.as_str()) {
        return Err(EdgeError::Validation(format!(
            "{finger} is not a finger; say RIGHT_INDEX, LEFT_THUMB and so on"
        )));
    }
    let template = request.template_base64.trim();
    if template.is_empty() {
        return Err(EdgeError::Validation("no fingerprint template".into()));
    }
    let reader_kind = request.reader_kind.trim();
    if reader_kind.is_empty() {
        return Err(EdgeError::Validation(
            "say which reader produced this template; a later SDK may not match it".into(),
        ));
    }
    if request.quality.is_some_and(|quality| quality > 100) {
        return Err(EdgeError::Validation("quality is 0 to 100".into()));
    }
    let here: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM edge_user WHERE username=?1 AND active=1)",
            params![username],
            |row| row.get(0),
        )
        .map_err(db)?;
    if !here {
        return Err(EdgeError::Validation(
            "Orang ini tidak terdaftar di toko ini. Kantor pusat yang menambahkan karyawan.".into(),
        ));
    }
    let owner: Option<String> = connection
        .query_row(
            "SELECT COALESCE(NULLIF(trim(u.display_name), ''), f.username)
               FROM edge_fingerprint f
               LEFT JOIN edge_user u ON u.username = f.username
              WHERE f.active = 1 AND f.template_base64 = ?1 AND f.username <> ?2
             UNION ALL
             SELECT COALESCE(NULLIF(trim(u.display_name), ''), s.username)
               FROM edge_finger_submission s
               LEFT JOIN edge_user u ON u.username = s.username
              WHERE s.status = 'PENDING' AND s.template_base64 = ?1 AND s.username <> ?2
             LIMIT 1",
            params![template, username],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?;
    if let Some(owner) = owner {
        return Err(EdgeError::Conflict(format!(
            "Jari ini sudah terdaftar atas nama {owner}."
        )));
    }
    let recorded_by = security::normalize_username(recorded_by).unwrap_or_else(|_| {
        // Authentication off on this node: nobody to name.
        recorded_by.trim().to_string()
    });
    connection
        .execute(
            "DELETE FROM edge_finger_submission
              WHERE username=?1 AND finger=?2 AND status IN ('PENDING', 'REFUSED')",
            params![username, finger],
        )
        .map_err(db)?;
    let submission_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    connection
        .execute(
            "INSERT INTO edge_finger_submission
               (submission_id,username,finger,template_base64,reader_kind,quality,
                recorded_by,recorded_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                submission_id,
                username,
                finger,
                template,
                reader_kind,
                request.quality.map(i64::from),
                recorded_by,
                now
            ],
        )
        .map_err(db)?;
    // Somebody else's finger, recorded by the store head, is the head's to
    // approve, and she just did (owner, 24 Oct 2026: "both bisa ho bisa
    // kepala toko"): it opens this store's POS now, and head office takes it
    // as approved by her and can still withdraw it. Her own waits for head
    // office. One row per person and finger, which head office's copy
    // retires when it arrives (`replace_from_head_office`).
    let approved_here = username != recorded_by;
    if approved_here {
        connection
            .execute(
                "INSERT INTO edge_fingerprint
                   (finger_id,username,label,template_base64,reader_kind,
                    enrolled_at,enrolled_by,active,updated_at,source)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,1,?6,'STORE')
                 ON CONFLICT(finger_id) DO UPDATE SET
                    template_base64 = excluded.template_base64,
                    reader_kind = excluded.reader_kind,
                    enrolled_at = excluded.enrolled_at,
                    enrolled_by = excluded.enrolled_by,
                    active = 1, retired_at = NULL,
                    updated_at = excluded.updated_at",
                params![
                    store_finger_id(&username, &finger),
                    username,
                    finger_words(&finger),
                    template,
                    reader_kind,
                    now,
                    recorded_by
                ],
            )
            .map_err(db)?;
    }
    Ok(FingerSubmission {
        submission_id,
        username,
        label: finger_words(&finger),
        finger,
        status: if approved_here { "APPROVED" } else { "PENDING" }.into(),
        reason: None,
        recorded_by,
        recorded_at: now,
    })
}

/// The row a finger approved by the store head opens the POS from until
/// head office's copy of it arrives.
fn store_finger_id(username: &str, finger: &str) -> String {
    format!("st-{username}-{finger}")
}

/// A finger that opens the POS here, for the store head's list.
#[derive(Debug, Clone, Serialize)]
pub struct TeamFinger {
    pub finger_id: String,
    /// `RIGHT_INDEX` for one head office sent; `None` for one enrolled here
    /// before, which names its finger only in words.
    pub finger: Option<String>,
    pub label: String,
}

/// One person who signs in here, with their fingers.
#[derive(Debug, Clone, Serialize)]
pub struct TeamMember {
    pub username: String,
    pub display_name: String,
    /// `CASHIER`, `SUPERVISOR` or `ADMIN`.
    pub role: String,
    pub fingers: Vec<TeamFinger>,
    /// Waiting for head office, or refused by it.
    pub submissions: Vec<FingerSubmission>,
}

/// Everybody who signs in here, store heads first, each with the fingers
/// that open the POS and the ones waiting for head office.
pub fn team(connection: &Connection) -> Result<Vec<TeamMember>, EdgeError> {
    let mut people: Vec<TeamMember> = connection
        .prepare(
            "SELECT username, COALESCE(NULLIF(trim(display_name), ''), username), role
               FROM edge_user WHERE active = 1
              ORDER BY CASE role WHEN 'SUPERVISOR' THEN 0 WHEN 'CASHIER' THEN 1 ELSE 2 END,
                       2",
        )
        .map_err(db)?
        .query_map([], |row| {
            Ok(TeamMember {
                username: row.get(0)?,
                display_name: row.get(1)?,
                role: row.get(2)?,
                fingers: Vec::new(),
                submissions: Vec::new(),
            })
        })
        .map_err(db)?
        .collect::<Result<_, _>>()
        .map_err(db)?;
    let fingers: Vec<(String, String, String)> = connection
        .prepare(
            "SELECT username, finger_id, label FROM edge_fingerprint
              WHERE active = 1 ORDER BY enrolled_at",
        )
        .map_err(db)?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(db)?
        .collect::<Result<_, _>>()
        .map_err(db)?;
    let submissions: Vec<FingerSubmission> = connection
        .prepare(
            "SELECT submission_id, username, finger, status, reason, recorded_by, recorded_at
               FROM edge_finger_submission
              WHERE status = 'REFUSED' OR (status = 'PENDING' AND username = recorded_by)
              ORDER BY recorded_at",
        )
        .map_err(db)?
        .query_map([], |row| {
            let finger: String = row.get(2)?;
            Ok(FingerSubmission {
                submission_id: row.get(0)?,
                username: row.get(1)?,
                label: finger_words(&finger),
                finger,
                status: row.get(3)?,
                reason: row.get(4)?,
                recorded_by: row.get(5)?,
                recorded_at: row.get(6)?,
            })
        })
        .map_err(db)?
        .collect::<Result<_, _>>()
        .map_err(db)?;
    for person in &mut people {
        let from_head_office = format!("ho-{}-", person.username);
        let from_here = format!("st-{}-", person.username);
        person.fingers = fingers
            .iter()
            .filter(|(username, _, _)| *username == person.username)
            .map(|(_, finger_id, label)| TeamFinger {
                finger: finger_id
                    .strip_prefix(&from_head_office)
                    .or_else(|| finger_id.strip_prefix(&from_here))
                    .filter(|code| FINGER_CODES.contains(code))
                    .map(str::to_owned),
                finger_id: finger_id.clone(),
                label: label.clone(),
            })
            .collect();
        person.submissions = submissions
            .iter()
            .filter(|submission| submission.username == person.username)
            .cloned()
            .collect();
    }
    Ok(people)
}

/// A waiting finger as it is sent to head office.
#[derive(Debug, Serialize)]
struct OutgoingFinger {
    submission_id: String,
    username: String,
    finger: String,
    template_base64: String,
    reader_kind: String,
    quality: Option<i64>,
    recorded_by: String,
    recorded_at: String,
    /// Somebody else's finger, which the store head approved by recording it.
    approved_by_head: bool,
}

/// Head office's word on one finger sent to it.
#[derive(Debug, Deserialize)]
pub struct SubmissionAnswer {
    pub submission_id: String,
    /// `PENDING`, `APPROVED` or `REFUSED`.
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SubmissionAnswers {
    results: Vec<SubmissionAnswer>,
}

fn waiting_fingers(connection: &Connection) -> Result<Vec<OutgoingFinger>, EdgeError> {
    connection
        .prepare(
            "SELECT submission_id, username, finger, template_base64, reader_kind, quality,
                    recorded_by, recorded_at, username <> recorded_by
               FROM edge_finger_submission WHERE status = 'PENDING'
              ORDER BY recorded_at",
        )
        .map_err(db)?
        .query_map([], |row| {
            Ok(OutgoingFinger {
                submission_id: row.get(0)?,
                username: row.get(1)?,
                finger: row.get(2)?,
                template_base64: row.get(3)?,
                reader_kind: row.get(4)?,
                quality: row.get(5)?,
                recorded_by: row.get(6)?,
                recorded_at: row.get(7)?,
                approved_by_head: row.get(8)?,
            })
        })
        .map_err(db)?
        .collect::<Result<_, _>>()
        .map_err(db)
}

/// Take head office's answers. A decided finger loses its template here:
/// approved, it comes back with head office's fingers; refused, it is a
/// biometric held for nothing. A refused one stays listed with its reason
/// until it is recorded again. Returns how many were decided.
pub fn take_answers(
    connection: &Connection,
    answers: &[SubmissionAnswer],
) -> Result<usize, EdgeError> {
    let now = Utc::now().to_rfc3339();
    let mut decided = 0;
    for answer in answers {
        decided += match answer.status.as_str() {
            "APPROVED" => connection
                .execute(
                    "DELETE FROM edge_finger_submission
                      WHERE submission_id=?1 AND status='PENDING'",
                    params![answer.submission_id],
                )
                .map_err(db)?,
            "REFUSED" => connection
                .execute(
                    "UPDATE edge_finger_submission
                        SET status='REFUSED', reason=?2, decided_at=?3, template_base64=''
                      WHERE submission_id=?1 AND status='PENDING'",
                    params![
                        answer.submission_id,
                        answer
                            .reason
                            .as_deref()
                            .map(|reason| reason.chars().take(300).collect::<String>()),
                        now
                    ],
                )
                .map_err(db)?,
            _ => 0,
        };
    }
    Ok(decided)
}

/// Send what waits to head office, and take its answers. Quiet when nothing
/// waits, and when head office is an older build that does not take them.
async fn send_waiting_fingers(
    client: &reqwest::Client,
    connection: &std::sync::Arc<std::sync::Mutex<Connection>>,
    base: &str,
    key: &str,
    origin: &str,
) {
    let read = connection.clone();
    let waiting = tokio::task::spawn_blocking(move || {
        let guard = read
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        waiting_fingers(&guard)
    })
    .await;
    let waiting = match waiting {
        Ok(Ok(waiting)) if !waiting.is_empty() => waiting,
        Ok(Ok(_)) => return,
        Ok(Err(error)) => {
            tracing::warn!(%error, "waiting fingers not read");
            return;
        }
        Err(error) => {
            tracing::warn!(%error, "finger task failed");
            return;
        }
    };
    let answer = client
        .post(format!("{base}/api/v1/sync/pos-fingers/submit"))
        .header("x-sync-key", key)
        .json(&serde_json::json!({ "origin_id": origin, "submissions": waiting }))
        .send()
        .await;
    let answers = match answer {
        Ok(response) if response.status().is_success() => {
            match response.json::<SubmissionAnswers>().await {
                Ok(answers) => answers.results,
                Err(error) => {
                    tracing::warn!(%error, "head office's answer on fingers did not read");
                    return;
                }
            }
        }
        Ok(response) => {
            tracing::debug!(status = %response.status(), "fingers not taken by head office");
            return;
        }
        Err(error) => {
            tracing::debug!(%error, "head office not reached with fingers");
            return;
        }
    };
    let write = connection.clone();
    match tokio::task::spawn_blocking(move || {
        let guard = write
            .lock()
            .map_err(|_| EdgeError::Persistence("edge connection is poisoned".into()))?;
        take_answers(&guard, &answers)
    })
    .await
    {
        Ok(Ok(decided)) if decided > 0 => tracing::info!(decided, "head office decided fingers"),
        Ok(Ok(_)) => {}
        Ok(Err(error)) => tracing::warn!(%error, "head office's answer on fingers not kept"),
        Err(error) => tracing::warn!(%error, "finger task failed"),
    }
}

/// Ask head office for this server's fingers now and then, and take them.
/// A server with no head office, or one that does not answer, keeps what it
/// has: a till must not lose its fingers to a dropped line.
pub fn spawn_head_office_pull(
    connection: std::sync::Arc<std::sync::Mutex<Connection>>,
    sync: Option<std::sync::Arc<crate::edge::sync::EdgeSyncHandle>>,
) {
    let Some(sync) = sync else {
        return;
    };
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "no client to ask head office for fingers");
                return;
            }
        };
        loop {
            if let Some((base, key)) = sync.cloud().map(|(base, key)| (base, key.to_owned())) {
                let origin = std::env::var("INVENTORY_NODE_ID").unwrap_or_default();
                // Recorded fingers first, so one head office approved in the
                // meantime comes back in the same round.
                send_waiting_fingers(&client, &connection, &base, &key, &origin).await;
                let answer = client
                    .post(format!("{base}/api/v1/sync/pos-fingers"))
                    .header("x-sync-key", key)
                    .json(&serde_json::json!({ "origin_id": origin }))
                    .send()
                    .await;
                match answer {
                    Ok(response) if response.status().is_success() => {
                        match response.json::<HeadOfficeFingers>().await {
                            Ok(bundle) => {
                                let connection = connection.clone();
                                let outcome = tokio::task::spawn_blocking(move || {
                                    let mut guard = connection.lock().map_err(|_| {
                                        EdgeError::Persistence("edge connection is poisoned".into())
                                    })?;
                                    replace_from_head_office(&mut guard, &bundle.fingers)
                                })
                                .await;
                                match outcome {
                                    Ok(Ok((taken, retired))) if taken + retired > 0 => {
                                        tracing::info!(taken, retired, "fingers from head office");
                                    }
                                    Ok(Ok(_)) => {}
                                    Ok(Err(error)) => {
                                        tracing::warn!(%error, "fingers from head office not kept")
                                    }
                                    Err(error) => tracing::warn!(%error, "finger task failed"),
                                }
                            }
                            Err(error) => {
                                tracing::warn!(%error, "head office's fingers did not read")
                            }
                        }
                    }
                    // An older head office answers 404: nothing to take yet.
                    Ok(response) => {
                        tracing::debug!(status = %response.status(), "no fingers from head office")
                    }
                    Err(error) => tracing::debug!(%error, "head office not reached for fingers"),
                }
            }
            tokio::time::sleep(HEAD_OFFICE_FINGERS_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge::{EdgeRole, NodeContext, SiteId, SqliteEdge};

    fn shop() -> SqliteEdge {
        let node = NodeContext::new(
            "store-07-edge".to_owned(),
            EdgeRole::Store,
            SiteId::new("store-07").unwrap_or_else(|error| panic!("site: {error}")),
        )
        .unwrap_or_else(|error| panic!("node: {error}"));
        let shop = SqliteEdge::open_in_memory(node).unwrap_or_else(|error| panic!("open: {error}"));
        {
            let connection = shop.connection();
            let guard = connection
                .lock()
                .unwrap_or_else(|error| panic!("lock: {error}"));
            for (username, active) in [("siti", 1), ("budi", 1), ("lama", 0)] {
                guard
                    .execute(
                        "INSERT INTO edge_user(id,username,display_name,password_hash,role,active,
                                               auth_version,source,created_at,updated_at)
                         VALUES(?1,?2,?2,'x','CASHIER',?3,1,'CLOUD','t','t')",
                        params![Uuid::new_v4().to_string(), username, active],
                    )
                    .unwrap_or_else(|error| panic!("user {username}: {error}"));
            }
            for username in ["budi", "lama"] {
                guard
                    .execute(
                        "INSERT INTO edge_fingerprint
                           (finger_id,username,label,template_base64,reader_kind,
                            enrolled_at,enrolled_by,active,updated_at)
                         VALUES (?1,?2,'Jempol kanan','TE9DQUw=','ZK','t','kepala',1,'t')",
                        params![format!("fp-{username}"), username],
                    )
                    .unwrap_or_else(|error| panic!("local finger {username}: {error}"));
            }
        }
        shop
    }

    fn held(shop: &SqliteEdge) -> Vec<(String, i64, String)> {
        let connection = shop.connection();
        let guard = connection
            .lock()
            .unwrap_or_else(|error| panic!("lock: {error}"));
        let mut statement = guard
            .prepare(
                "SELECT finger_id, active, template_base64 FROM edge_fingerprint ORDER BY finger_id",
            )
            .unwrap_or_else(|error| panic!("prepare: {error}"));
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap_or_else(|error| panic!("query: {error}"))
            .collect::<Result<_, _>>()
            .unwrap_or_else(|error| panic!("rows: {error}"))
    }

    fn from_hr(username: &str) -> HeadOfficeFinger {
        HeadOfficeFinger {
            username: username.into(),
            finger: "RIGHT_INDEX".into(),
            format: "ZKFINGER_V10".into(),
            template_base64: "SFJfVEVNUExBVEU=".into(),
            revision: 1,
        }
    }

    fn replace(shop: &SqliteEdge, fingers: &[HeadOfficeFinger]) -> (usize, usize) {
        let connection = shop.connection();
        let mut guard = connection
            .lock()
            .unwrap_or_else(|error| panic!("lock: {error}"));
        replace_from_head_office(&mut guard, fingers).unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn hr_fingers_arrive_and_a_leavers_finger_is_retired_and_wiped() {
        let shop = shop();
        // HR's finger for siti arrives; one for somebody who does not sign in
        // here is not taken; lama, who left, loses the finger enrolled here.
        let (taken, retired) = replace(&shop, &[from_hr("siti"), from_hr("ghost")]);
        assert_eq!((taken, retired), (1, 1));
        assert_eq!(
            held(&shop),
            vec![
                ("fp-budi".into(), 1, "TE9DQUw=".into()),
                ("fp-lama".into(), 0, String::new()),
                ("ho-siti-RIGHT_INDEX".into(), 1, "SFJfVEVNUExBVEU=".into()),
            ]
        );
        // Asked again with the same answer, nothing moves.
        assert_eq!(replace(&shop, &[from_hr("siti")]), (0, 0));
        // HR withdraws it: retired and wiped here too; budi's local finger stays.
        assert_eq!(replace(&shop, &[]), (0, 1));
        let after = held(&shop);
        assert!(after.contains(&("ho-siti-RIGHT_INDEX".into(), 0, String::new())));
        assert!(after.contains(&("fp-budi".into(), 1, "TE9DQUw=".into())));
        // Enrolled again: it comes back.
        assert_eq!(replace(&shop, &[from_hr("siti")]), (1, 0));
    }

    #[test]
    fn a_finger_is_said_in_the_tills_words() {
        assert_eq!(finger_words("RIGHT_INDEX"), "Telunjuk kanan");
        assert_eq!(finger_words("LEFT_THUMB"), "Jempol kiri");
    }

    fn record(
        shop: &SqliteEdge,
        username: &str,
        template: &str,
        by: &str,
    ) -> Result<FingerSubmission, EdgeError> {
        let connection = shop.connection();
        let guard = connection
            .lock()
            .unwrap_or_else(|error| panic!("lock: {error}"));
        submit(
            &guard,
            SubmitFingerRequest {
                username: username.into(),
                finger: "right_index".into(),
                template_base64: template.into(),
                reader_kind: "ZKFINGER_V10".into(),
                quality: Some(80),
            },
            by,
        )
    }

    #[test]
    fn a_recorded_finger_waits_and_opens_nothing_until_head_office_answers() {
        let shop = shop();
        let waiting =
            record(&shop, "siti", "U0lUSQ==", "siti").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(waiting.finger, "RIGHT_INDEX");
        assert_eq!(waiting.status, "PENDING");
        // Not among the fingers a till matches against.
        assert!(held(&shop).iter().all(|(id, _, _)| !id.contains("siti")));

        // Recorded again: still one waiting, the newer one.
        let again =
            record(&shop, "siti", "U0lUSTI=", "siti").unwrap_or_else(|error| panic!("{error}"));
        let connection = shop.connection();
        let guard = connection
            .lock()
            .unwrap_or_else(|error| panic!("lock: {error}"));
        let sent = waiting_fingers(&guard).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].submission_id, again.submission_id);

        let decided = take_answers(
            &guard,
            &[SubmissionAnswer {
                submission_id: again.submission_id.clone(),
                status: "REFUSED".into(),
                reason: Some("Blurred".into()),
            }],
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(decided, 1);
        assert!(waiting_fingers(&guard)
            .unwrap_or_else(|error| panic!("{error}"))
            .is_empty());
        let siti = team(&guard)
            .unwrap_or_else(|error| panic!("{error}"))
            .into_iter()
            .find(|person| person.username == "siti")
            .unwrap_or_else(|| panic!("siti is on the team"));
        assert_eq!(siti.submissions.len(), 1);
        assert_eq!(siti.submissions[0].status, "REFUSED");
        assert_eq!(siti.submissions[0].reason.as_deref(), Some("Blurred"));
        let wiped: String = guard
            .query_row(
                "SELECT template_base64 FROM edge_finger_submission WHERE submission_id=?1",
                params![again.submission_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        assert!(wiped.is_empty());
    }

    #[test]
    fn a_finger_already_somebody_elses_or_nobody_here_is_refused() {
        let shop = shop();
        // Budi's finger, enrolled here.
        match record(&shop, "siti", "TE9DQUw=", "kepala") {
            Err(EdgeError::Conflict(message)) => assert!(message.contains("budi")),
            other => panic!("expected a conflict, got {other:?}"),
        }
        match record(&shop, "lama", "TEFNQQ==", "kepala") {
            Err(EdgeError::Validation(_)) => {}
            other => panic!("a leaver is nobody here, got {other:?}"),
        }
        let approved =
            record(&shop, "siti", "U0lUSQ==", "siti").unwrap_or_else(|error| panic!("{error}"));
        let connection = shop.connection();
        let guard = connection
            .lock()
            .unwrap_or_else(|error| panic!("lock: {error}"));
        take_answers(
            &guard,
            &[SubmissionAnswer {
                submission_id: approved.submission_id,
                status: "APPROVED".into(),
                reason: None,
            }],
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(waiting_fingers(&guard)
            .unwrap_or_else(|error| panic!("{error}"))
            .is_empty());
    }

    #[test]
    fn a_finger_the_head_records_for_her_team_opens_the_pos_at_once() {
        let shop = shop();
        let approved =
            record(&shop, "siti", "U0lUSQ==", "kepala").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(approved.status, "APPROVED");
        assert!(held(&shop)
            .iter()
            .any(|(id, active, _)| id == "st-siti-RIGHT_INDEX" && *active == 1));
        {
            let connection = shop.connection();
            let guard = connection
                .lock()
                .unwrap_or_else(|error| panic!("lock: {error}"));
            // Still sent to head office, as the head's approval.
            let sent = waiting_fingers(&guard).unwrap_or_else(|error| panic!("{error}"));
            assert_eq!(sent.len(), 1);
            assert!(sent[0].approved_by_head);
            // Not a wait on her list: a finger.
            let siti = team(&guard)
                .unwrap_or_else(|error| panic!("{error}"))
                .into_iter()
                .find(|person| person.username == "siti")
                .unwrap_or_else(|| panic!("siti is on the team"));
            assert!(siti.submissions.is_empty());
            assert_eq!(siti.fingers.len(), 1);
            assert_eq!(siti.fingers[0].finger.as_deref(), Some("RIGHT_INDEX"));
        }
        // Head office's copy arrives and takes over from the store's.
        replace(&shop, &[from_hr("siti")]);
        let rows = held(&shop);
        assert!(rows
            .iter()
            .any(|(id, active, _)| id == "ho-siti-RIGHT_INDEX" && *active == 1));
        assert!(rows
            .iter()
            .any(|(id, active, template)| id == "st-siti-RIGHT_INDEX"
                && *active == 0
                && template.is_empty()));
    }
}
