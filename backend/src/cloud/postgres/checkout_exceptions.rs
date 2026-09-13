//! Money a shop took without producing a sale, as a list somebody works.
//!
//! Each row arrived as a `checkout.unresolved` fact from a till: a tender
//! settled, the sale was never written, and a person at the counter closed the
//! checkout as FAILED because they could not fix it there. See migration 0168
//! for why the centre is the only place this can be resolved — **the shop's own
//! Z report balances**, because the money genuinely is in its takings. Nothing
//! looks wrong at the branch. The customer finds out on their statement.
//!
//! So this is a queue with an end, not a log. Every row carries what head
//! office did about it, and a row nobody has answered is the point of the whole
//! mechanism.
//!
//! Reads only ever *add* the centre's answer. The shop's account of what
//! happened — the amounts, the acquirer references, who was on the till — is
//! written once by the sync and never amended here: a shop and head office
//! disagreeing about what a branch reported is worse than either being wrong.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// How head office answered for money a shop is holding.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExceptionResolution {
    /// Nobody has answered yet. The only state that is work.
    Open,
    /// The shopper got their money back. The ordinary ending.
    Refunded,
    /// The sale was reconstructed and written — the goods did leave, the
    /// shopper kept them, and the charge was right after all. Distinct from
    /// `Refunded` because the stock and the revenue move too, and a report that
    /// could not tell them apart would count the takings twice or not at all.
    RecoveredAsSale,
    /// The acquirer confirmed nothing settled. The till's own view was wrong —
    /// which happens, and is why "money held" is a claim the centre checks
    /// rather than a fact it acts on blind.
    WrittenOff,
}

impl ExceptionResolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Refunded => "REFUNDED",
            Self::RecoveredAsSale => "RECOVERED_AS_SALE",
            Self::WrittenOff => "WRITTEN_OFF",
        }
    }

    pub fn parse(word: &str) -> Option<Self> {
        match word {
            "OPEN" => Some(Self::Open),
            "REFUNDED" => Some(Self::Refunded),
            "RECOVERED_AS_SALE" => Some(Self::RecoveredAsSale),
            "WRITTEN_OFF" => Some(Self::WrittenOff),
            _ => None,
        }
    }
}

/// Closing one case.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResolveExceptionRequest {
    pub resolution: String,
    /// Who answered for it. Required, and not defaulted to the caller's
    /// session: an amount of money leaves the business on the strength of this
    /// row, and "the system" is not a name an auditor accepts.
    pub resolved_by: String,
    /// What was done, in words. A resolution with no note is a case closed
    /// without an account of why, which is the shape of a case closed to make
    /// the list shorter.
    #[serde(default)]
    pub note: Option<String>,
}

/// What every shop is holding with nothing behind it.
///
/// `open_only` defaults to the answer somebody actually wants — the work —
/// rather than to everything ever reported. A list that opens on eight hundred
/// closed cases is a list nobody scrolls.
pub async fn list_exceptions(
    pool: &PgPool,
    site_id: Option<&str>,
    open_only: bool,
) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT e.checkout_id, e.origin_id, e.site_id, e.actor_id, e.total_minor,
                e.money_held_minor, e.opened_at, e.resolved_at, e.received_at,
                e.last_error, e.resolution, e.resolution_note, e.resolved_by,
                e.resolution_at,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'tender_seq', t.tender_seq,
                        'method', t.method,
                        'amount_minor', t.amount_minor,
                        'status', t.status,
                        'external_reference', t.external_reference,
                        'last_error', t.last_error
                     ) ORDER BY t.tender_seq)
                       FROM edge_checkout_exception_tender t
                      WHERE t.checkout_id = e.checkout_id),
                    '[]'::json
                ) AS tenders
           FROM edge_checkout_exception e
          WHERE ($1::text IS NULL OR e.site_id = $1)
            AND (NOT $2::bool OR e.resolution = 'OPEN')
          -- Oldest first, because the cost of one of these is the time the
          -- shopper spends not having their money.
          ORDER BY e.resolved_at",
    )
    .bind(site_id)
    .bind(open_only)
    .fetch_all(pool)
    .await?;

    let mut held_open: i64 = 0;
    let mut open_count: i64 = 0;
    let list: Vec<Value> = rows
        .iter()
        .map(|row| {
            let resolution: String = row.get("resolution");
            let held: i64 = row.get("money_held_minor");
            if resolution == "OPEN" {
                open_count += 1;
                held_open = held_open.saturating_add(held);
            }
            json!({
                "checkout_id": row.get::<Uuid, _>("checkout_id"),
                "origin_id": row.get::<String, _>("origin_id"),
                "site_id": row.get::<Option<String>, _>("site_id"),
                "actor_id": row.get::<String, _>("actor_id"),
                "total_minor": row.get::<i64, _>("total_minor"),
                "money_held_minor": held,
                "opened_at": row.get::<DateTime<Utc>, _>("opened_at"),
                "resolved_at": row.get::<DateTime<Utc>, _>("resolved_at"),
                "received_at": row.get::<DateTime<Utc>, _>("received_at"),
                "last_error": row.get::<Option<String>, _>("last_error"),
                "resolution": resolution,
                "resolution_note": row.get::<Option<String>, _>("resolution_note"),
                "resolved_by": row.get::<Option<String>, _>("resolved_by"),
                "resolution_at": row.get::<Option<DateTime<Utc>>, _>("resolution_at"),
                "tenders": row.get::<Value, _>("tenders"),
            })
        })
        .collect();

    Ok(json!({
        "rows": list,
        // The two numbers a manager reads before any of the rows: how many
        // people are owed money, and how much. Summed here rather than in the
        // browser because a filtered page would otherwise report the total of
        // whatever happened to be on screen.
        "open_count": open_count,
        "open_money_held_minor": held_open,
    }))
}

/// Answer for one case.
///
/// Refuses to reopen a closed one. The shop's fact can be redelivered by a sync
/// retry at any time and the case may already have cost the business a refund;
/// a second answer over the top of the first is how a shopper gets paid twice.
pub async fn resolve_exception(
    pool: &PgPool,
    checkout_id: Uuid,
    request: ResolveExceptionRequest,
) -> Result<Value, AppError> {
    let resolution = ExceptionResolution::parse(&request.resolution).ok_or_else(|| {
        AppError::Validation(format!("no resolution called {}", request.resolution))
    })?;
    if resolution == ExceptionResolution::Open {
        return Err(AppError::Validation(
            "OPEN is where a case starts, not something it can be set back to".into(),
        ));
    }
    if request.resolved_by.trim().is_empty() {
        return Err(AppError::Validation(
            "a resolution names who made it — money leaves the business on this row".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    // Locked, because two people working the same queue on the same morning is
    // exactly how this list gets used.
    let current: Option<String> = sqlx::query_scalar(
        "SELECT resolution FROM edge_checkout_exception WHERE checkout_id = $1 FOR UPDATE",
    )
    .bind(checkout_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(current) = current else {
        return Err(AppError::NotFound(format!(
            "no checkout exception {checkout_id}"
        )));
    };
    if current != "OPEN" {
        return Err(AppError::Conflict(format!(
            "this case was already answered as {current}"
        )));
    }

    sqlx::query(
        "UPDATE edge_checkout_exception
            SET resolution = $2, resolved_by = $3, resolution_note = $4,
                resolution_at = now()
          WHERE checkout_id = $1",
    )
    .bind(checkout_id)
    .bind(resolution.as_str())
    .bind(request.resolved_by.trim())
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(json!({
        "checkout_id": checkout_id,
        "resolution": resolution.as_str(),
        "resolved_by": request.resolved_by.trim(),
    }))
}
