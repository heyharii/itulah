//! Enrolling a shop machine: the code, the claim, the decision, and the first
//! delivery of everything the new node should already know.
//!
//! The protocol and its reasons are in `crate::sync::enrolment`; the table in
//! migration 0397. This module is the storage half and nothing else.
//!
//! # The code is the proof
//!
//! Since 10 Oct 2026 nobody matches a number: a claim of an unexpired, unused
//! code is approved in the same flow ([`claim_and_approve_node_enrolment`]),
//! as the Admin who issued the code. The decision is committed first; the
//! first data is queued after it (a stream that fails is recorded, not
//! fatal), the server is `SYNCING` until it has acknowledged all of it, and
//! the Admins are told when it is connected and when it is ready (0966).
//! Approving and refusing by hand stay for a claim that could not be let in by
//! itself — typically a replacement whose predecessor still has sales head
//! office never received.
//!
//! # Every refusal to a machine says the same thing
//!
//! A claim with an unknown code, a spent code, an expired code or a withdrawn
//! code is answered identically ([`claim_refused`]), for the reason the member
//! pairing code gives: a caller who can tell "no such code" from "expired"
//! has been told which codes exist.

use super::sync::{publish_current_catalog_to, register_origin_digest_tx};
use super::{raise_notification, NewNotification};
use crate::cloud::application::AppError;
use crate::edge::{EdgeRole, NodeContext, SiteId};
use crate::security;
use crate::sync::enrolment::{
    self, ClaimAnswer, ClaimRequest, MachineFacts, StatusAnswer, CLAIM_APPROVAL_WINDOW_HOURS,
    DEFAULT_CODE_TTL_MINUTES, MAX_CODE_TTL_MINUTES,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

/// What an Admin asks for: a code for one site, in one role.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueNodeEnrolmentRequest {
    pub site_id: String,
    /// `STORE` or `DC`. Defaults to `STORE`, which is what almost every
    /// enrolment is.
    #[serde(default)]
    pub node_role: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub ttl_minutes: Option<i64>,
}

/// The code, shown once. Nothing else ever returns it.
#[derive(Debug, Clone, Serialize)]
pub struct IssuedNodeEnrolment {
    pub enrolment_id: Uuid,
    pub site_id: String,
    pub origin_id: String,
    pub node_role: String,
    pub code: String,
    pub expires_at: DateTime<Utc>,
}

/// One enrolment as the hub shows it. Never the code, never the key digest.
#[derive(Debug, Clone, Serialize)]
pub struct NodeEnrolmentView {
    pub enrolment_id: Uuid,
    pub site_id: String,
    pub site_name: Option<String>,
    pub origin_id: String,
    pub node_role: String,
    pub label: Option<String>,
    /// `ISSUED`, `EXPIRED`, `CLAIMED`, `STALE`, `APPROVED`, `REJECTED` or
    /// `REVOKED`. Derived here from the columns, so the hub does not have to
    /// know the clock rules.
    pub status: &'static str,
    pub issued_by: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub claimed_at: Option<DateTime<Utc>>,
    /// The number the shop's screen shows. The person approving reads it back
    /// with the shop before saying yes.
    pub verification: Option<String>,
    pub machine: Option<MachineFacts>,
    pub claimed_from: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub active_generation: Option<i64>,
    pub delivered_at: Option<DateTime<Utc>>,
}

/// An approval, and what the new node was sent.
#[derive(Debug, Clone, Serialize)]
pub struct ApprovedNodeEnrolment {
    pub enrolment: NodeEnrolmentView,
    pub bootstrap: Value,
}

fn claim_refused() -> AppError {
    AppError::Forbidden(
        "this enrolment code is not valid: it may be mistyped, used, expired or withdrawn".into(),
    )
}

fn derive_status(
    now: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    claimed_at: Option<DateTime<Utc>>,
    outcome: Option<&str>,
) -> &'static str {
    match (outcome, claimed_at) {
        (Some("APPROVED"), _) => "APPROVED",
        (Some("REJECTED"), _) => "REJECTED",
        (Some(_), _) => "REVOKED",
        (None, Some(claimed)) if claimed + Duration::hours(CLAIM_APPROVAL_WINDOW_HOURS) <= now => {
            "STALE"
        }
        (None, Some(_)) => "CLAIMED",
        (None, None) if expires_at <= now => "EXPIRED",
        (None, None) => "ISSUED",
    }
}

const VIEW_COLUMNS: &str = "e.enrolment_id, e.site_id, s.name AS site_name, e.origin_id,
        e.node_role, e.label, e.issued_by, e.issued_at, e.expires_at, e.claimed_at,
        e.verification, e.machine, e.claimed_from, e.outcome, e.decided_by,
        e.decided_at, e.active_generation, e.delivered_at";

fn decode_view(
    row: &sqlx::postgres::PgRow,
    now: DateTime<Utc>,
) -> Result<NodeEnrolmentView, AppError> {
    let outcome: Option<String> = row.try_get("outcome")?;
    let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
    let claimed_at: Option<DateTime<Utc>> = row.try_get("claimed_at")?;
    let machine: Option<Value> = row.try_get("machine")?;
    Ok(NodeEnrolmentView {
        enrolment_id: row.try_get("enrolment_id")?,
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        origin_id: row.try_get("origin_id")?,
        node_role: row.try_get("node_role")?,
        label: row.try_get("label")?,
        status: derive_status(now, expires_at, claimed_at, outcome.as_deref()),
        issued_by: row.try_get("issued_by")?,
        issued_at: row.try_get("issued_at")?,
        expires_at,
        claimed_at,
        verification: row.try_get("verification")?,
        machine: machine.map(serde_json::from_value).transpose()?,
        claimed_from: row.try_get("claimed_from")?,
        decided_by: row.try_get("decided_by")?,
        decided_at: row.try_get("decided_at")?,
        active_generation: row.try_get("active_generation")?,
        delivered_at: row.try_get("delivered_at")?,
    })
}

async fn node_enrolment_view(
    pool: &PgPool,
    enrolment_id: Uuid,
) -> Result<NodeEnrolmentView, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {VIEW_COLUMNS} FROM node_enrolment e LEFT JOIN site s ON s.id = e.site_id
          WHERE e.enrolment_id = $1"
    ))
    .bind(enrolment_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("enrolment".into()))?;
    decode_view(&row, Utc::now())
}

/// Issue a code for a site.
///
/// The origin is the site id, which is how every node in the fleet is already
/// named (`provision-store.sh`, `deploy/edge/*.env.example`). Any undecided
/// enrolment for the same origin is revoked in the same transaction: the newest
/// code is the only one that can still become this site.
pub async fn issue_node_enrolment(
    pool: &PgPool,
    request: IssueNodeEnrolmentRequest,
    issued_by: &str,
) -> Result<IssuedNodeEnrolment, AppError> {
    let site_id = request.site_id.trim().to_owned();
    let role = EdgeRole::from_str(request.node_role.as_deref().unwrap_or("STORE").trim())
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let ttl = request.ttl_minutes.unwrap_or(DEFAULT_CODE_TTL_MINUTES);
    if !(5..=MAX_CODE_TTL_MINUTES).contains(&ttl) {
        return Err(AppError::Validation(format!(
            "ttl_minutes must be between 5 and {MAX_CODE_TTL_MINUTES}"
        )));
    }
    let label = request
        .label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .map(str::to_owned);
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(&site_id)
        .fetch_one(pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound(format!("site {site_id}")));
    }
    // The same check registration makes, made before a code exists, so a code
    // that could never be approved is never handed to anybody.
    let site =
        SiteId::new(site_id.clone()).map_err(|error| AppError::Validation(error.to_string()))?;
    NodeContext::new(site_id.clone(), role, site)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let origin_id = site_id.clone();
    let node_role = role.to_string();

    let code = enrolment::random_code();
    let enrolment_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::minutes(ttl);
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE node_enrolment
            SET outcome = 'REVOKED', decided_by = $2, decided_at = now()
          WHERE origin_id = $1 AND outcome IS NULL",
    )
    .bind(&origin_id)
    .bind(issued_by)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO node_enrolment
             (enrolment_id, site_id, origin_id, node_role, label, code_sha256,
              issued_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(enrolment_id)
    .bind(&site_id)
    .bind(&origin_id)
    .bind(&node_role)
    .bind(&label)
    .bind(security::sha256_hex(&code))
    .bind(issued_by)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(IssuedNodeEnrolment {
        enrolment_id,
        site_id,
        origin_id,
        node_role,
        code: enrolment::display_code(&code),
        expires_at,
    })
}

/// The recent enrolments, newest first.
pub async fn list_node_enrolments(pool: &PgPool) -> Result<Vec<NodeEnrolmentView>, AppError> {
    let now = Utc::now();
    sqlx::query(&format!(
        "SELECT {VIEW_COLUMNS} FROM node_enrolment e LEFT JOIN site s ON s.id = e.site_id
          ORDER BY e.issued_at DESC LIMIT 200"
    ))
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| decode_view(row, now))
    .collect()
}

/// A machine spends a code.
pub async fn claim_node_enrolment(
    pool: &PgPool,
    request: ClaimRequest,
    claimed_from: Option<&str>,
) -> Result<ClaimAnswer, AppError> {
    let code = enrolment::normalise_code(&request.code).ok_or_else(claim_refused)?;
    let key_sha256 = request.key_sha256.trim().to_owned();
    if !enrolment::is_key_digest(&key_sha256) {
        return Err(AppError::Validation(
            "key_sha256 must be 64 lowercase hex characters".into(),
        ));
    }
    let machine = serde_json::to_value(request.machine.clamped())?;
    let claimed_from = claimed_from.map(|from| from.chars().take(120).collect::<String>());

    let mut tx = pool.begin().await?;
    // `FOR UPDATE` so two machines typing the same code at once cannot both
    // spend it.
    let Some(row) = sqlx::query(
        "SELECT enrolment_id, site_id, origin_id, node_role, expires_at, claimed_at, outcome
           FROM node_enrolment WHERE code_sha256 = $1 FOR UPDATE",
    )
    .bind(security::sha256_hex(&code))
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Err(claim_refused());
    };
    let expires_at: DateTime<Utc> = row.get("expires_at");
    let claimed_at: Option<DateTime<Utc>> = row.get("claimed_at");
    let outcome: Option<String> = row.get("outcome");
    if outcome.is_some() || claimed_at.is_some() || expires_at <= Utc::now() {
        return Err(claim_refused());
    }
    // A key already standing for some origin is not a fresh key. Refused
    // loudly rather than uniformly: it cannot happen by accident, and the
    // person installing needs to know the machine is reusing a key.
    let reused: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sync_origin_credential WHERE ingest_key_sha256 = $1)",
    )
    .bind(&key_sha256)
    .fetch_one(&mut *tx)
    .await?;
    if reused {
        return Err(AppError::Conflict(
            "this machine presented a key that already belongs to a node; mint a new one".into(),
        ));
    }
    let enrolment_id: Uuid = row.get("enrolment_id");
    let verification = enrolment::verification_number(&code, &key_sha256);
    sqlx::query(
        "UPDATE node_enrolment
            SET claimed_at = now(), key_sha256 = $2, verification = $3,
                machine = $4, claimed_from = $5
          WHERE enrolment_id = $1",
    )
    .bind(enrolment_id)
    .bind(&key_sha256)
    .bind(&verification)
    .bind(&machine)
    .bind(&claimed_from)
    .execute(&mut *tx)
    .await?;
    let site_id: String = row.get("site_id");
    // The page at the shop says which store this machine is becoming the
    // server for by the code and name people know, never the internal id.
    let site = sqlx::query("SELECT code, name FROM site WHERE id = $1")
        .bind(&site_id)
        .fetch_optional(&mut *tx)
        .await?;
    let (site_code, site_name) = match site {
        Some(site) => (site.try_get("code")?, site.try_get("name")?),
        None => (None, None),
    };
    tx.commit().await?;
    Ok(ClaimAnswer {
        enrolment_id,
        origin_id: row.get("origin_id"),
        site_id,
        node_role: row.get("node_role"),
        verification,
        site_code,
        site_name,
    })
}

/// A claiming machine asks where its enrolment stands, proving it is the
/// claimant by presenting the key whose digest it claimed with.
pub async fn node_enrolment_status(
    pool: &PgPool,
    enrolment_id: Uuid,
    presented_key: Option<&str>,
) -> Result<StatusAnswer, AppError> {
    let row = sqlx::query(
        "SELECT e.key_sha256, e.verification, e.outcome, e.claimed_at, e.expires_at,
                e.origin_id, e.site_id, e.node_role, e.label, e.active_generation
           FROM node_enrolment e WHERE e.enrolment_id = $1",
    )
    .bind(enrolment_id)
    .fetch_optional(pool)
    .await?;
    let not_yours =
        || AppError::Forbidden("invalid or missing x-sync-key for this enrolment".into());
    let Some(row) = row else {
        // Indistinguishable from a wrong key, so ids cannot be probed.
        return Err(not_yours());
    };
    let stored: Option<String> = row.get("key_sha256");
    let authorised = match (stored.as_deref(), presented_key) {
        (Some(stored), Some(key)) => {
            security::constant_time_eq(&enrolment::key_digest(key), stored)
        }
        _ => false,
    };
    if !authorised {
        return Err(not_yours());
    }
    let outcome: Option<String> = row.get("outcome");
    let status = derive_status(
        Utc::now(),
        row.get("expires_at"),
        row.get("claimed_at"),
        outcome.as_deref(),
    );
    Ok(match status {
        "APPROVED" => {
            sqlx::query(
                "UPDATE node_enrolment SET delivered_at = now()
                  WHERE enrolment_id = $1 AND delivered_at IS NULL",
            )
            .bind(enrolment_id)
            .execute(pool)
            .await?;
            StatusAnswer::Approved {
                origin_id: row.get("origin_id"),
                site_id: row.get("site_id"),
                node_role: row.get("node_role"),
                active_generation: row.get::<Option<i64>, _>("active_generation").unwrap_or(1),
                label: row.get("label"),
            }
        }
        "CLAIMED" => StatusAnswer::Pending {
            verification: row
                .get::<Option<String>, _>("verification")
                .unwrap_or_default(),
        },
        other => StatusAnswer::Refused {
            reason: other.to_owned(),
        },
    })
}

/// Say yes: register the claimed key as the origin, then send the node what
/// the fleet already knows.
///
/// The registration and the decision commit together. The bootstrap runs
/// after, stream by stream, and a stream that fails is reported rather than
/// undoing the approval — the node is enrolled either way, and *Kirim ulang
/// data awal* repeats the bootstrap once the cause is fixed.
pub async fn approve_node_enrolment(
    pool: &PgPool,
    enrolment_id: Uuid,
    decided_by: &str,
) -> Result<ApprovedNodeEnrolment, AppError> {
    let origin_id = decide_approval(pool, enrolment_id, decided_by).await?;
    let bootstrap = after_approval(pool, &origin_id, decided_by).await?;
    Ok(ApprovedNodeEnrolment {
        enrolment: node_enrolment_view(pool, enrolment_id).await?,
        bootstrap,
    })
}

/// An enrolment that was approved by the claim itself.
#[derive(Debug, Clone)]
pub struct LetInEnrolment {
    pub enrolment_id: Uuid,
    pub origin_id: String,
    /// The Admin who issued the code, to whom the decision is attributed.
    pub decided_by: String,
}

/// A machine spends a code, and is let in at once.
///
/// The code is the proof, and it was issued by an Admin from the store's page:
/// the claim is approved as that Admin, in the same request, so the machine's
/// first poll already finds itself approved. What the claim answers is what it
/// always answered — the six-digit `verification` stays in it for the nodes
/// that show it — but nobody has to read it to anybody.
///
/// The claim commits first, on its own; the approval is a second transaction.
/// When it cannot be made (a replacement while the machine before it still has
/// sales head office never received, say) the enrolment stays `CLAIMED` and is
/// decided by hand where it always was, and the answer carries `None`.
///
/// What follows the decision — who signs in there, the first data — is
/// [`finish_node_approval`], left to the caller so the machine is not made to
/// wait on a catalogue being queued.
pub async fn claim_and_approve_node_enrolment(
    pool: &PgPool,
    request: ClaimRequest,
    claimed_from: Option<&str>,
) -> Result<(ClaimAnswer, Option<LetInEnrolment>), AppError> {
    let answer = claim_node_enrolment(pool, request, claimed_from).await?;
    let issued_by: Option<String> =
        sqlx::query_scalar("SELECT issued_by FROM node_enrolment WHERE enrolment_id = $1")
            .bind(answer.enrolment_id)
            .fetch_optional(pool)
            .await
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "the Admin who issued a claimed code could not be read");
                None
            });
    let Some(decided_by) = issued_by else {
        return Ok((answer, None));
    };
    match decide_approval(pool, answer.enrolment_id, &decided_by).await {
        Ok(origin_id) => {
            let let_in = LetInEnrolment {
                enrolment_id: answer.enrolment_id,
                origin_id,
                decided_by,
            };
            Ok((answer, Some(let_in)))
        }
        Err(error) => {
            tracing::warn!(
                enrolment_id = %answer.enrolment_id,
                %error,
                "a claimed code could not be approved by itself; it waits for a decision"
            );
            Ok((answer, None))
        }
    }
}

/// Everything after the decision for an enrolment [`claim_and_approve_node_enrolment`]
/// let in: who signs in at the new server, then the first data. Returns the
/// bootstrap report; a stream that failed is in it, and recorded on the
/// enrolment for the retry.
pub async fn finish_node_approval(
    pool: &PgPool,
    let_in: &LetInEnrolment,
) -> Result<Value, AppError> {
    after_approval(pool, &let_in.origin_id, &let_in.decided_by).await
}

/// The decision: register the claimed key as the origin and mark the enrolment
/// approved, in one transaction. Returns the origin. The Admins are told the
/// server is connected afterwards, and only as news: a notification that
/// cannot be written never undoes a decision.
async fn decide_approval(
    pool: &PgPool,
    enrolment_id: Uuid,
    decided_by: &str,
) -> Result<String, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT origin_id, site_id, node_role, label, key_sha256, claimed_at, outcome, expires_at
           FROM node_enrolment WHERE enrolment_id = $1 FOR UPDATE",
    )
    .bind(enrolment_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("enrolment".into()))?;
    let outcome: Option<String> = row.get("outcome");
    let status = derive_status(
        Utc::now(),
        row.get("expires_at"),
        row.get("claimed_at"),
        outcome.as_deref(),
    );
    if status != "CLAIMED" {
        return Err(AppError::Conflict(format!(
            "only a claimed enrolment can be approved; this one is {status}"
        )));
    }
    let origin_id: String = row.get("origin_id");
    let site_id: String = row.get("site_id");
    let node_role: String = row.get("node_role");
    let label: Option<String> = row.get("label");
    let key_sha256: String = row.get("key_sha256");

    // A first machine starts the origin at generation 1. A replacement starts
    // one past the machine it replaces — its database is new, so its sequence
    // restarts, and a stream is identified by origin AND generation. The
    // registration refuses the rollover while the old generation has durable
    // facts the cloud never applied, which is the moment a person has to
    // decide about a dead machine's unsynced sales.
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT active_generation FROM sync_origin_credential WHERE origin_id = $1 FOR UPDATE",
    )
    .bind(&origin_id)
    .fetch_optional(&mut *tx)
    .await?;
    let generation = existing.map_or(1, |generation| generation + 1);
    register_origin_digest_tx(
        &mut tx,
        &origin_id,
        &key_sha256,
        label.as_deref(),
        Some(&site_id),
        Some(&node_role),
        Some(generation),
        Some(true),
    )
    .await?;
    // A machine that was disconnected (`stores.rs`) has its credential back.
    sqlx::query("UPDATE sync_origin_credential SET revoked_at = NULL WHERE origin_id = $1")
        .bind(&origin_id)
        .execute(&mut *tx)
        .await?;
    // A replacement reads the stream from its start: what was asked of the
    // machine it replaces, once, is not asked of it.
    if existing.is_some() {
        let recalled = super::sync::hand_over_to_replacement(&mut tx, &origin_id).await?;
        tracing::info!(%origin_id, generation, recalled, "a replacement took over a server");
    }
    sqlx::query(
        "UPDATE node_enrolment
            SET outcome = 'APPROVED', decided_by = $2, decided_at = now(),
                active_generation = $3
          WHERE enrolment_id = $1",
    )
    .bind(enrolment_id)
    .bind(decided_by)
    .bind(generation)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    if let Err(error) = tell_connected(pool, enrolment_id).await {
        tracing::warn!(%enrolment_id, %error, "the Admins were not told a server is connected");
    }
    Ok(origin_id)
}

/// What follows a decision: who signs in at the new server (0635), then the
/// first data.
///
/// Who signs in at the new server follows from role and posting; derive it
/// now, so the bootstrap's policy already names them rather than the sweep
/// adding them up to five minutes later. Any other server whose list the
/// derivation changed is told here; this one is told by the bootstrap.
async fn after_approval(
    pool: &PgPool,
    origin_id: &str,
    decided_by: &str,
) -> Result<Value, AppError> {
    let changed = super::follow_new_server(pool, origin_id, decided_by).await;
    let others: Vec<String> = changed
        .into_iter()
        .filter(|changed| changed.as_str() != origin_id)
        .collect();
    super::publish_node_access(pool, &others, decided_by).await;

    bootstrap_origin(pool, origin_id, decided_by).await
}

/// Say no. A claimed enrolment is `REJECTED`; one nobody claimed yet is
/// `REVOKED`. Either way the code is dead and nothing was registered.
pub async fn refuse_node_enrolment(
    pool: &PgPool,
    enrolment_id: Uuid,
    decided_by: &str,
) -> Result<NodeEnrolmentView, AppError> {
    let updated = sqlx::query(
        "UPDATE node_enrolment
            SET outcome = CASE WHEN claimed_at IS NULL THEN 'REVOKED' ELSE 'REJECTED' END,
                decided_by = $2, decided_at = now()
          WHERE enrolment_id = $1 AND outcome IS NULL",
    )
    .bind(enrolment_id)
    .bind(decided_by)
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(
            "enrolment not found, or already decided".into(),
        ));
    }
    node_enrolment_view(pool, enrolment_id).await
}

/// Send one node everything the fleet already knows, on every stream that
/// would otherwise only reach it the next time something changed.
///
/// Each stream is attempted independently and reported, so the answer says
/// exactly which ones the node now has. Commands to a node are sequenced per
/// node, so what is issued here queues behind nothing and ahead of whatever
/// the fleet is sent next.
///
/// Also the site's open work — purchase orders still `ISSUED` and tagging
/// jobs not yet tagged — by re-issuing the very commands that carried them the
/// first time, revisions included, in the order they were issued; and the
/// attendance book as it stands today. The book is otherwise published by a
/// person on purpose (`http/terminal.rs`: "explicit, not automatic"); a node
/// that has never had one is the case where somebody would press the button
/// anyway, and a new node with no roster refuses every punch.
pub async fn bootstrap_origin(
    pool: &PgPool,
    origin_id: &str,
    issued_by: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query("SELECT node_role FROM sync_origin_credential WHERE origin_id = $1")
        .bind(origin_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("registered origin {origin_id}")))?;
    let is_store = row
        .get::<Option<String>, _>("node_role")
        .is_some_and(|role| role.eq_ignore_ascii_case("STORE"));
    let target = [origin_id.to_owned()];
    // Where the node's command lane stands before anything is queued: what is
    // queued from here is the first data, and the node is ready once it has
    // acknowledged it.
    let queued_from = command_position(pool, origin_id).await?;
    let outcome = |result: Result<Value, AppError>| match result {
        Ok(value) => value,
        Err(error) => json!({ "error": error.to_string() }),
    };

    let catalogue = outcome(
        publish_current_catalog_to(pool, origin_id, issued_by)
            .await
            .map(|generation| json!({ "generation": generation })),
    );
    let auth_policy = outcome(super::publish_auth_policy(pool, origin_id, issued_by).await);
    let eligibility = outcome(
        super::publish_rule_eligibility_to_fleet(pool, issued_by)
            .await
            .map(|command| json!({ "command_id": command })),
    );
    let site_id: Option<String> =
        sqlx::query_scalar("SELECT site_id FROM sync_origin_credential WHERE origin_id = $1")
            .bind(origin_id)
            .fetch_one(pool)
            .await?;
    let (open_work, attendance_book) = match site_id.as_deref() {
        Some(site) => (
            outcome(resend_open_work(pool, origin_id, site, issued_by).await),
            outcome(send_attendance_book(pool, origin_id, site, issued_by).await),
        ),
        None => (
            json!({ "skipped": "no site" }),
            json!({ "skipped": "no site" }),
        ),
    };
    let mut report = json!({
        "origin_id": origin_id,
        "catalogue": catalogue,
        "auth_policy": auth_policy,
        "eligibility": eligibility,
        "open_work": open_work,
        "attendance_book": attendance_book,
    });
    if is_store {
        report["price_books"] = outcome(send_published_books(pool, origin_id, issued_by).await);
        report["campaign_switches"] = outcome(
            super::publish_campaign_switches(pool, issued_by, &target)
                .await
                .map(|(command_id, _)| json!({ "command_id": command_id })),
        );
        report["promotion_usage"] = outcome(
            super::publish_commercial_usage(pool, issued_by, &target)
                .await
                .map(|(command_id, _)| json!({ "command_id": command_id })),
        );
    }
    // Written on the enrolment this node was let in by, so that a stream that
    // failed is not lost and the node's progress can be read. Never allowed to
    // fail the bootstrap: the commands are queued either way.
    if let Err(error) = record_bootstrap(pool, origin_id, queued_from, &report).await {
        tracing::warn!(%origin_id, %error, "the first data sent to a node was not written down");
    }
    Ok(report)
}

/// Whether any stream of a bootstrap report failed.
fn bootstrap_failed(report: &Value) -> bool {
    report
        .as_object()
        .is_some_and(|streams| streams.values().any(|stream| stream.get("error").is_some()))
}

/// How far the cloud has written to a node's command lane.
async fn command_position(pool: &PgPool, origin_id: &str) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE((SELECT next_seq FROM sync_command_cursor WHERE origin_id = $1), 0)::bigint",
    )
    .bind(origin_id)
    .fetch_one(pool)
    .await?)
}

/// Write down on the node's latest approved enrolment what a bootstrap queued:
/// when, the range of the node's lane it took (`from` exclusive, `to`
/// inclusive), whether a stream failed, and the report with a few counts for
/// the store's page. The range's start is kept from the first attempt, so a
/// retry's commands count with the first's.
async fn record_bootstrap(
    pool: &PgPool,
    origin_id: &str,
    from_seq: i64,
    report: &Value,
) -> Result<(), AppError> {
    let to_seq = command_position(pool, origin_id).await?;
    // Articles in the catalogue snapshot this node was sent, counted once, here
    // — the page reads the number, not the snapshot.
    let articles: i64 = sqlx::query_scalar(
        "SELECT count(DISTINCT COALESCE(item ->> 'article_code', item ->> 'sku_code'))::bigint
           FROM sync_command_delivery d
           JOIN sync_command c ON c.command_id = d.command_id
          CROSS JOIN LATERAL jsonb_array_elements(
                  CASE WHEN jsonb_typeof(c.payload -> 'items') = 'array'
                       THEN c.payload -> 'items' ELSE '[]'::jsonb END) AS item
          WHERE d.origin_id = $1 AND d.seq > $2 AND d.seq <= $3
            AND c.command_type = $4",
    )
    .bind(origin_id)
    .bind(from_seq)
    .bind(to_seq)
    .bind(crate::cloud::domain::COMMAND_CATALOG_CHUNK)
    .fetch_one(pool)
    .await?;
    let mut stored = report.clone();
    stored["counts"] = json!({
        "articles": articles,
        "price_books": report["price_books"]["published"],
        "staff": report["attendance_book"]["employees"],
    });
    sqlx::query(
        "UPDATE node_enrolment
            SET bootstrap_at = now(),
                bootstrap_from_seq = COALESCE(bootstrap_from_seq, $2),
                bootstrap_seq = $3,
                bootstrap_failed = $4,
                bootstrap_report = $5
          WHERE enrolment_id = (SELECT x.enrolment_id FROM node_enrolment x
                                 WHERE x.origin_id = $1 AND x.outcome = 'APPROVED'
                                   AND x.disconnected_at IS NULL
                                 ORDER BY x.decided_at DESC LIMIT 1)",
    )
    .bind(origin_id)
    .bind(from_seq)
    .bind(to_seq)
    .bind(bootstrap_failed(report))
    .bind(&stored)
    .execute(pool)
    .await?;
    Ok(())
}

/// The one automatic second attempt at a node's first data.
///
/// Asked after every heartbeat. Does something only for a node that was let in
/// by a code and is not ready yet, and only once: when a stream of its
/// bootstrap failed, or when no bootstrap was ever written down although the
/// approval is minutes old (the request that was to queue it was cut short).
/// The attempt is claimed by an update that only one caller can win, then run
/// in the background so the heartbeat is not kept waiting. A second failure is
/// left for a person: *Kirim ulang data awal*.
pub(super) async fn retry_first_data(pool: &PgPool, origin_id: &str) {
    let claimed = sqlx::query(
        "UPDATE node_enrolment
            SET bootstrap_retried_at = now()
          WHERE enrolment_id = (SELECT x.enrolment_id FROM node_enrolment x
                                 WHERE x.origin_id = $1 AND x.outcome = 'APPROVED'
                                   AND x.disconnected_at IS NULL
                                 ORDER BY x.decided_at DESC LIMIT 1)
            AND bootstrap_retried_at IS NULL
            AND ready_at IS NULL
            AND (bootstrap_failed
                 OR (bootstrap_at IS NULL AND decided_at < now() - interval '5 minutes'))
      RETURNING COALESCE(decided_by, issued_by) AS decided_by",
    )
    .bind(origin_id)
    .fetch_optional(pool)
    .await;
    match claimed {
        Ok(Some(row)) => {
            let Ok(decided_by) = row.try_get::<String, _>("decided_by") else {
                return;
            };
            let pool = pool.clone();
            let origin_id = origin_id.to_owned();
            tokio::spawn(async move {
                tracing::info!(%origin_id, "sending a new server its first data once more");
                if let Err(error) = bootstrap_origin(&pool, &origin_id, &decided_by).await {
                    tracing::warn!(%origin_id, %error, "the second attempt at a server's first data failed");
                }
            });
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!(%origin_id, %error, "a server's first data could not be checked for a retry");
        }
    }
}

// ── telling the Admins ──────────────────────────────────────────────────

/// Mark a server ready the first time it has acknowledged all its first data,
/// and tell the Admins once. Asked after every heartbeat, so a server is
/// ready only while it is being heard from. Never fails the heartbeat.
pub(super) async fn settle_first_data(pool: &PgPool, origin_id: &str) {
    if let Err(error) = mark_ready(pool, origin_id).await {
        tracing::warn!(%origin_id, %error, "a server's first data was not settled");
    }
}

async fn mark_ready(pool: &PgPool, origin_id: &str) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let ready = sqlx::query(
        "UPDATE node_enrolment e
            SET ready_at = now()
          WHERE e.enrolment_id = (SELECT x.enrolment_id FROM node_enrolment x
                                   WHERE x.origin_id = $1 AND x.outcome = 'APPROVED'
                                     AND x.disconnected_at IS NULL
                                   ORDER BY x.decided_at DESC LIMIT 1)
            AND e.ready_at IS NULL
            AND e.bootstrap_at IS NOT NULL
            AND NOT e.bootstrap_failed
            AND COALESCE((SELECT c.acked_seq FROM sync_command_cursor c
                           WHERE c.origin_id = e.origin_id), 0)
                >= COALESCE(e.bootstrap_seq, 9223372036854775807)
      RETURNING e.enrolment_id, e.site_id, e.issued_by",
    )
    .bind(origin_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(row) = ready {
        let enrolment_id: Uuid = row.try_get("enrolment_id")?;
        let site_id: String = row.try_get("site_id")?;
        let issued_by: String = row.try_get("issued_by")?;
        let store = store_words(&mut tx, &site_id).await?;
        let time = store
            .local_time
            .clone()
            .unwrap_or_else(|| Utc::now().format("%H:%M").to_string());
        raise_server_news(
            &mut tx,
            "store.server.ready",
            format!("{}'s server is ready", store.name),
            format!("Data up to {time}"),
            &store,
            &site_id,
            origin_id,
            enrolment_id,
            &issued_by,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// The store a server belongs to, in the words a notification uses.
struct StoreWords {
    unit_id: Option<String>,
    name: String,
    /// The time at the store now, `HH:MM`.
    local_time: Option<String>,
}

async fn store_words(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<StoreWords, AppError> {
    let row = sqlx::query(
        "SELECT u.id AS unit_id,
                COALESCE(u.name, s.name, s.id) AS store_name,
                to_char(now() AT TIME ZONE site_business_timezone(s.id), 'HH24:MI') AS local_time
           FROM site s
           LEFT JOIN unit u ON u.id = s.unit_id
          WHERE s.id = $1",
    )
    .bind(site_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(match row {
        Some(row) => StoreWords {
            unit_id: row.try_get("unit_id")?,
            name: row.try_get("store_name")?,
            local_time: row.try_get("local_time")?,
        },
        None => StoreWords {
            unit_id: None,
            name: site_id.to_owned(),
            local_time: None,
        },
    })
}

/// "KASIR-PC · windows x86_64": what the machine said about itself, for a
/// line under a title.
fn machine_words(machine: Option<&Value>) -> Option<String> {
    let field = |key: &str| {
        machine
            .and_then(|machine| machine.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    let parts: Vec<&str> = [field("hostname"), field("os")]
        .into_iter()
        .flatten()
        .collect();
    (!parts.is_empty()).then(|| parts.join(" · "))
}

/// Tell every Admin, and the Admin who issued the code, a store's server is
/// connected. Its own transaction: this is news about a decision already made.
async fn tell_connected(pool: &PgPool, enrolment_id: Uuid) -> Result<(), AppError> {
    let Some(row) = sqlx::query(
        "SELECT site_id, origin_id, issued_by, machine
           FROM node_enrolment WHERE enrolment_id = $1 AND outcome = 'APPROVED'",
    )
    .bind(enrolment_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(());
    };
    let site_id: String = row.try_get("site_id")?;
    let origin_id: String = row.try_get("origin_id")?;
    let issued_by: String = row.try_get("issued_by")?;
    let machine: Option<Value> = row.try_get("machine")?;
    let mut tx = pool.begin().await?;
    let store = store_words(&mut tx, &site_id).await?;
    raise_server_news(
        &mut tx,
        "store.server.connected",
        format!("{}'s server is connected", store.name),
        machine_words(machine.as_ref())
            .unwrap_or_else(|| "A machine has claimed the install code".into()),
        &store,
        &site_id,
        origin_id.as_str(),
        enrolment_id,
        &issued_by,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// One notification about a store's server, to every Admin and to the Admin
/// who issued its code.
#[allow(clippy::too_many_arguments)]
async fn raise_server_news(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    title: String,
    body: String,
    store: &StoreWords,
    site_id: &str,
    origin_id: &str,
    enrolment_id: Uuid,
    issued_by: &str,
) -> Result<(), AppError> {
    let recipients: Vec<String> = sqlx::query_scalar(
        "SELECT username FROM app_user
          WHERE active AND (role = 'ADMIN' OR username = $1)
          ORDER BY username",
    )
    .bind(issued_by)
    .fetch_all(&mut **tx)
    .await?;
    raise_notification(
        tx,
        NewNotification {
            kind,
            title,
            body,
            subject: store.unit_id.clone().map(|unit_id| ("unit", unit_id)),
            origin_id: Some(origin_id),
            payload: json!({
                "unit_id": store.unit_id,
                "site_id": site_id,
                "origin_id": origin_id,
                "enrolment_id": enrolment_id,
            }),
        },
        &recipients,
    )
    .await?;
    Ok(())
}

/// Every published price book, oldest first, shaped for this shop.
///
/// Oldest first because a shop applies books by replacing on id and the newest
/// that names a product wins; sent newest first, an older book would arrive
/// last and walk the shop backwards. One transaction, so the shop is sent the
/// whole run or none of it.
async fn send_published_books(
    pool: &PgPool,
    origin_id: &str,
    issued_by: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let books: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM commercial_publication WHERE status = 'PUBLISHED' ORDER BY version",
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut sent = 0usize;
    for book in &books {
        let delivered =
            super::commercial::dispatch_publication_to(&mut tx, *book, issued_by, Some(origin_id))
                .await?;
        sent += delivered.len();
    }
    tx.commit().await?;
    Ok(json!({ "published": books.len(), "sent": sent }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_follows_the_columns_and_the_clock() {
        let now = Utc::now();
        let later = now + Duration::minutes(30);
        let earlier = now - Duration::minutes(30);
        assert_eq!(derive_status(now, later, None, None), "ISSUED");
        assert_eq!(derive_status(now, earlier, None, None), "EXPIRED");
        // A claim outlives the code's own expiry: the code was spent in time.
        assert_eq!(derive_status(now, earlier, Some(earlier), None), "CLAIMED");
        assert_eq!(
            derive_status(
                now,
                earlier,
                Some(now - Duration::hours(CLAIM_APPROVAL_WINDOW_HOURS + 1)),
                None
            ),
            "STALE"
        );
        assert_eq!(
            derive_status(now, later, Some(earlier), Some("APPROVED")),
            "APPROVED"
        );
        assert_eq!(
            derive_status(now, later, Some(earlier), Some("REJECTED")),
            "REJECTED"
        );
        assert_eq!(derive_status(now, later, None, Some("REVOKED")), "REVOKED");
    }
}

/// Re-issue, to one node, the commands that carried its site's open work:
/// purchase orders still `ISSUED` (their activation and every revision since)
/// and tagging jobs still `ISSUED`, oldest first, so the node rebuilds the same
/// state the node before it was told about, in the same order.
async fn resend_open_work(
    pool: &PgPool,
    origin_id: &str,
    site_id: &str,
    issued_by: &str,
) -> Result<Value, AppError> {
    let commands: Vec<(String, Value)> = sqlx::query_as(
        "SELECT c.command_type, c.payload FROM (
             SELECT c.command_id
               FROM purchase_order po
               JOIN sync_command c
                 ON c.command_id = po.activation_command_id
                 OR (c.command_type = $2
                     AND c.payload->>'purchase_order_id' = po.purchase_order_id::text)
              WHERE po.destination_site_id = $1 AND po.order_status = 'ISSUED'
             UNION
             SELECT j.command_id
               FROM tagging_job j
              WHERE j.site_id = $1 AND j.status = 'ISSUED' AND j.command_id IS NOT NULL
         ) open_work
         JOIN sync_command c ON c.command_id = open_work.command_id
        WHERE c.revoked_at IS NULL
        ORDER BY c.issued_at",
    )
    .bind(site_id)
    .bind(crate::cloud::domain::COMMAND_PURCHASE_ORDER_REVISE)
    .fetch_all(pool)
    .await?;
    let mut tx = pool.begin().await?;
    let target = [origin_id.to_owned()];
    for (command_type, payload) in &commands {
        super::sync::issue_command_tx(&mut tx, command_type, payload, issued_by, None, &target)
            .await?;
    }
    // Koli still on the road to this site: announced when they left only if
    // the site had a node then. A shop enrolled after its delivery departed
    // would otherwise never see it to receive. "On the road" is a piece of
    // the koli still standing on an in-transit shelf, in the centre's ledger
    // or a node's facts; one accepted as delivered has left it.
    let on_the_road = sqlx::query(
        "SELECT f.event_id, f.koli_id, f.source_site_id, f.destination_store_id,
                f.shipment_reference, f.occurred_at,
                (SELECT k.koli_number FROM edge_koli k WHERE k.koli_id = f.koli_id) AS koli_number
           FROM edge_fulfillment_progress_fact f
          WHERE f.stage = 'IN_TRANSIT'
            AND EXISTS (
                SELECT 1 FROM edge_fulfillment_progress_unit u
                 WHERE u.progress_event_id = f.event_id
                   AND NOT EXISTS (SELECT 1 FROM edge_transfer_claim c
                                    WHERE c.claim_kind = 'RECEIVED' AND c.epc = u.epc
                                      AND c.shipment_reference
                                          IS NOT DISTINCT FROM f.shipment_reference)
                   AND (EXISTS (SELECT 1 FROM inventory_subject s
                                  JOIN inventory_projection p
                                    ON p.subject_id = s.id AND p.quantity > 0
                                  JOIN inventory_place ip ON ip.id = p.place_id
                                 WHERE s.epc = u.epc AND ip.state = 'NORMAL'
                                   AND ip.pool_id LIKE '%.outbound.in-transit%')
                        OR EXISTS (SELECT 1 FROM edge_inventory_fact_position pos
                                    WHERE pos.origin_id = f.origin_id AND pos.epc = u.epc
                                      AND pos.place_id LIKE '%.outbound.in-transit%:on_hand')))
          ORDER BY f.occurred_at, f.event_id",
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut deliveries = 0_usize;
    for row in &on_the_road {
        let destination: String = row.try_get("destination_store_id")?;
        if super::sync::canonical_site_id_tx(&mut tx, &destination).await? != site_id {
            continue;
        }
        let event_id: Uuid = row.try_get("event_id")?;
        let units = sqlx::query(
            "SELECT epc, sku_code, allotment_line_id FROM edge_fulfillment_progress_unit
              WHERE progress_event_id = $1 ORDER BY unit_ordinal",
        )
        .bind(event_id)
        .fetch_all(&mut *tx)
        .await?
        .iter()
        .map(|unit| {
            Ok(crate::sync::workflow::StoreInboundAnnounceUnit {
                epc: unit.try_get("epc")?,
                sku_code: unit.try_get("sku_code")?,
                allotment_line_id: unit.try_get("allotment_line_id")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
        if units.is_empty() {
            continue;
        }
        super::sync::announce_store_inbound_payload_tx(
            &mut tx,
            crate::sync::workflow::StoreInboundAnnouncePayload {
                koli_id: row.try_get("koli_id")?,
                source_site_id: row.try_get("source_site_id")?,
                destination_store_id: destination,
                shipment_reference: row.try_get("shipment_reference")?,
                departed_at: row.try_get("occurred_at")?,
                units,
                destination_pool_id: None,
                koli_number: row.try_get("koli_number")?,
            },
        )
        .await?;
        deliveries += 1;
    }
    tx.commit().await?;
    Ok(json!({ "commands": commands.len(), "koli_on_the_road": deliveries }))
}

/// The attendance book of the unit that owns the node's site, as it stands
/// today, to one node. People are posted to a unit, not to a site, so the
/// node's site is only the way to its unit.
async fn send_attendance_book(
    pool: &PgPool,
    origin_id: &str,
    site_id: &str,
    issued_by: &str,
) -> Result<Value, AppError> {
    let unit_id: Option<String> = sqlx::query_scalar("SELECT unit_id FROM site WHERE id = $1")
        .bind(site_id)
        .fetch_optional(pool)
        .await?;
    let unit_id = unit_id.ok_or_else(|| {
        AppError::Validation(format!("site {site_id} is not a site head office knows"))
    })?;
    let unit = crate::cloud::domain::UnitId::try_new(&unit_id)
        .map_err(|error| AppError::Validation(error.to_string()))?;
    let book = super::attendance_book_for_unit(pool, &unit, Utc::now().date_naive()).await?;
    let employees = book.employees.len();
    super::issue_command(
        pool,
        crate::cloud::domain::COMMAND_ATTENDANCE_BOOK_REPLACE,
        &serde_json::to_value(&book)?,
        issued_by,
        None,
        &[origin_id.to_owned()],
    )
    .await?;
    Ok(json!({ "employees": employees }))
}
