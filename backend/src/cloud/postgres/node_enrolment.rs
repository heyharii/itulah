//! Enrolling a shop machine: the code, the claim, the decision, and the first
//! delivery of everything the new node should already know.
//!
//! The protocol and its reasons are in `crate::sync::enrolment`; the table in
//! migration 0397. This module is the storage half and nothing else.
//!
//! # Every refusal to a machine says the same thing
//!
//! A claim with an unknown code, a spent code, an expired code or a withdrawn
//! code is answered identically ([`claim_refused`]), for the reason the member
//! pairing code gives: a caller who can tell "no such code" from "expired"
//! has been told which codes exist.

use super::sync::{publish_current_catalog_to, register_origin_digest_tx};
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
use sqlx::{PgPool, Row};
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

    // Who signs in at the new server follows from role and posting (0635);
    // derive it now, so the bootstrap's policy already names them rather
    // than the sweep adding them up to five minutes later. Any other server
    // whose list the derivation changed is told here; this one is told by
    // the bootstrap.
    let changed = super::follow_new_server(pool, &origin_id, decided_by).await;
    let others: Vec<String> = changed
        .into_iter()
        .filter(|changed| changed != &origin_id)
        .collect();
    super::publish_node_access(pool, &others, decided_by).await;

    let bootstrap = bootstrap_origin(pool, &origin_id, decided_by).await?;
    Ok(ApprovedNodeEnrolment {
        enrolment: node_enrolment_view(pool, enrolment_id).await?,
        bootstrap,
    })
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
    Ok(report)
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
    tx.commit().await?;
    Ok(json!({ "commands": commands.len() }))
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
