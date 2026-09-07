//! Store money: the drawer, the deposit, the order, the float, the receipt.
//!
//! # The one rule this module exists to keep
//!
//! Money in a shop has two origins and they never mix.
//!
//! **Sales proceeds** are customers' money in the shop's custody. The shop may
//! not spend them. They are reconciled, and then disposed of under a Remittance
//! Order from head office — banked, or paid to somebody head office named. The
//! order itself moves nothing; the deposit and the cash document do.
//!
//! **Operating funds** are money head office sends so a shop can pay for
//! things. They are accountable through `1011102002 PIUTANG KEPALA TOKO`,
//! against the store manager as a person, in the Payment Ledger.
//!
//! Every refusal in this file is a sentence rather than a code, and every one
//! of them says where to go instead. "You cannot pay for that out of the till"
//! with no second half is a message that gets worked around.
//!
//! # There is no company bank account at a shop
//!
//! Head office holds every bank account. When it funds a shop the money goes to
//! the manager's personal account, and that account is three text columns of
//! payout metadata on `operating_fund` — never a Bank Account, never a row in
//! the chart. Nothing here resolves it, posts to it, or sums it.
//!
//! # Function names
//!
//! Everything public is prefixed. `postgres/mod.rs` re-exports every module
//! with `pub use x::*`, so a bare `list` or `confirm` here would collide with
//! one somewhere else and the error would name a line in `mod.rs`.

use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    approval_is_sufficient, approval_level_for, cashier_equation, fund_accountability,
    remittance_standing, ApprovalLevel, CashierEquation, DrawerMovement, ExecutionState,
    FundAccountability, LineExecution, LineProgress, RemittanceStanding,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Head office. Every bank account belongs here, and every fund leaves from
/// here. The same constant `sync.rs` keeps, restated rather than imported
/// because that one is private to the sync protocol and this is a fact about
/// the books.
const HEAD_OFFICE_SITE_ID: &str = "dc";

// ---------------------------------------------------------------------------
// The two seams to neighbouring lanes
// ---------------------------------------------------------------------------

/// Post an entry, naming which step of a document is posting.
///
/// A thin wrapper over `poster::post`, kept because this lane has fifteen call
/// sites and two of them are documents that post at more than one moment: the
/// store deposit posts `OUT` when the bag leaves the shop and `IN` when the
/// bank agrees it arrived, and a cashier's shift posts `FLOAT` when the drawer
/// opens and `VARIANCE` when it is counted. Every other rule here passes
/// `None`, which the poster reads as `MAIN`. Migration 0140 is what makes the
/// triple `(source_kind, source_id, purpose)` unique.
async fn lane_b_post(
    tx: &mut Transaction<'_, Postgres>,
    intent: &PostingIntent,
    purpose: Option<&str>,
    actor: &str,
) -> Result<super::poster::Posted, AppError> {
    post(tx, intent, purpose, actor).await
}

/// Which way a payment ledger balance faces. Mirrors Lane P's enum.
#[derive(Clone, Copy, Debug)]
pub enum StoreLedgerSide {
    Receivable,
}

/// One balance to follow. The fields and their meanings are Lane P's
/// `PaymentLedgerItem`, kept in the same order so the call site does not change
/// when the shim goes.
#[derive(Clone, Debug)]
pub struct StoreLedgerItem {
    pub account_key: String,
    pub qualifier: String,
    pub site_id: String,
    /// `EMPLOYEE` for everything this lane opens: a store manager holding head
    /// office's money is a person, not a place.
    pub party_type: String,
    pub party_id: String,
    pub party_name: Option<String>,
    pub voucher_kind: String,
    pub voucher_id: String,
    pub journal_entry_id: Uuid,
    pub side: StoreLedgerSide,
    pub amount_minor: i64,
    pub currency: String,
    pub due_date: Option<NaiveDate>,
    pub posting_date: NaiveDate,
}

/// One item a settlement puts money against. Lane P's
/// `PaymentLedgerAllocation`.
#[derive(Clone, Copy, Debug)]
pub struct StoreLedgerAllocation {
    pub entry_id: Uuid,
    pub amount_minor: i64,
}

/// Open a payment ledger item for money a custodian is now holding.
///
/// One call, which is what this was always going to be: `StoreLedgerItem` was
/// written field for field against Lane P's `PaymentLedgerItem` so that the day
/// the ledger landed the body became a conversion and a call, and no call site
/// in this file moved. Migrations 0143-0145 own the table.
///
/// The entry id that comes back is the one this lane stores on the fund and the
/// remittance line, and the one it later hands to [`lane_b_ple_settle`] — so a
/// float opened here and answered there is one item's life rather than two
/// records of the same money.
async fn lane_b_ple_open(
    tx: &mut Transaction<'_, Postgres>,
    item: &StoreLedgerItem,
    actor: &str,
) -> Result<Uuid, AppError> {
    super::payment_ledger::ple_open(
        tx,
        &super::payment_ledger::PaymentLedgerItem {
            account_key: item.account_key.clone(),
            qualifier: item.qualifier.clone(),
            site_id: item.site_id.clone(),
            party_type: super::payment_ledger::PaymentLedgerPartyType::parse(&item.party_type)?,
            party_id: item.party_id.clone(),
            party_name: item.party_name.clone(),
            voucher_kind: item.voucher_kind.clone(),
            voucher_id: item.voucher_id.clone(),
            journal_entry_id: item.journal_entry_id,
            side: match item.side {
                StoreLedgerSide::Receivable => super::payment_ledger::PaymentLedgerSide::Receivable,
            },
            amount_minor: item.amount_minor,
            currency: item.currency.clone(),
            due_date: item.due_date,
            posting_date: item.posting_date,
        },
        actor,
    )
    .await
}

/// Put money against open items.
///
/// Lane P's `ple_settle`, argument for argument. What comes back is what
/// actually landed: a retry of a settlement already recorded applies nothing and
/// says zero rather than paying the same float back twice.
async fn lane_b_ple_settle(
    tx: &mut Transaction<'_, Postgres>,
    against_voucher_kind: &str,
    against_voucher_id: &str,
    journal_entry_id: Uuid,
    posting_date: NaiveDate,
    allocations: &[StoreLedgerAllocation],
    actor: &str,
) -> Result<i64, AppError> {
    let allocations: Vec<super::payment_ledger::PaymentLedgerAllocation> = allocations
        .iter()
        .map(
            |allocation| super::payment_ledger::PaymentLedgerAllocation {
                entry_id: allocation.entry_id,
                amount_minor: allocation.amount_minor,
            },
        )
        .collect();
    let settled = super::payment_ledger::ple_settle(
        tx,
        against_voucher_kind,
        against_voucher_id,
        journal_entry_id,
        posting_date,
        &allocations,
        actor,
    )
    .await?;
    Ok(settled.applied_minor)
}

/// What one control account has open, for one site.
///
/// One side of the equation this lane exists to make checkable: `Sum of open
/// funds = payment ledger outstanding = the general ledger balance of Piutang
/// Kepala Toko`.
///
/// Read off the ledger's own `outstanding_minor` rather than through Lane P's
/// `ple_outstanding`, and the difference is a date. That door answers as at a
/// day, defaulting to today, and a settlement recorded with a value date later
/// than today is correctly not counted by it — which is right for an ageing
/// report and wrong for this equation, whose other two readings (the fund table
/// and the account balance) carry no date bound either. Three readings of the
/// same money have to be asked the same question.
pub async fn store_ledger_outstanding(
    pool: &PgPool,
    account_key: &str,
    site_id: Option<&str>,
) -> Result<i64, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(outstanding_minor), 0)::bigint AS outstanding
           FROM payment_ledger_entry
          WHERE account_key = $1 AND ($2::text IS NULL OR site_id = $2)",
    )
    .bind(account_key.trim().to_ascii_lowercase())
    .bind(site_id)
    .fetch_one(pool)
    .await?;
    Ok(row.try_get("outstanding")?)
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/// The next gapless number in a scope, for the month a date falls in.
///
/// The counter row is locked for the length of the caller's transaction, so a
/// rolled-back document takes its number back with it. See 0110 for why these
/// are a table and journal numbers are a sequence.
async fn next_document_number(
    tx: &mut Transaction<'_, Postgres>,
    scope: &str,
    prefix: &str,
    on: NaiveDate,
) -> Result<String, AppError> {
    let year = on.year() as i16;
    let month = on.month() as i16;
    let row = sqlx::query(
        "INSERT INTO store_document_counter (scope, year, month, last_number)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (scope, year, month)
         DO UPDATE SET last_number = store_document_counter.last_number + 1
         RETURNING last_number",
    )
    .bind(scope)
    .bind(year)
    .bind(month)
    .fetch_one(&mut **tx)
    .await?;
    let number: i32 = row.try_get("last_number")?;
    Ok(format!(
        "{prefix}-{:02}-{:02}-{number:05}",
        year % 100,
        month
    ))
}

async fn site_exists(tx: &mut Transaction<'_, Postgres>, site_id: &str) -> Result<(), AppError> {
    let found = sqlx::query("SELECT 1 FROM site WHERE id = $1")
        .bind(site_id)
        .fetch_optional(&mut **tx)
        .await?
        .is_some();
    if found {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("there is no site {site_id}")))
    }
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

/// A shift as the shop recorded it, on its way in from the edge.
///
/// The centre never recomputes `expected_cash_minor` or `variance_minor` into
/// the row: a recomputation that disagreed would be a second opinion about a
/// drawer nobody at the centre has seen. It DOES compute the equation again for
/// reading (`cash_shift_equation`) and shows both figures side by side, which
/// is the honest way to surface a till on an old build.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CashShiftFact {
    pub shift_id: Uuid,
    pub site_id: String,
    pub terminal_id: String,
    pub status: String,
    pub opened_by: String,
    pub opened_at: DateTime<Utc>,
    pub opening_float_minor: i64,
    #[serde(default)]
    pub closed_by: Option<String>,
    #[serde(default)]
    pub closed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub declared_cash_minor: Option<i64>,
    #[serde(default)]
    pub expected_cash_minor: Option<i64>,
    #[serde(default)]
    pub variance_minor: Option<i64>,
    #[serde(default)]
    pub close_note: Option<String>,
    #[serde(default)]
    pub movements: Vec<CashMovementFact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CashMovementFact {
    pub movement_id: Uuid,
    pub kind: String,
    pub amount_minor: i64,
    pub reason: String,
    pub actor_id: String,
    #[serde(default)]
    pub approved_by: Option<String>,
    pub occurred_at: DateTime<Utc>,
}

/// Check a shift fact before it can enter the centre's tables.
///
/// At the boundary rather than trusted, for the same reason `parse_sales_completed`
/// re-does a sale's arithmetic: a shop runs its own build and can be behind, or
/// wrong, and a malformed shift that entered silently would sit in the cash
/// position as a number nobody could trace.
pub fn parse_cash_shift(payload: &Value) -> Result<CashShiftFact, String> {
    let fact: CashShiftFact = serde_json::from_value(payload.clone())
        .map_err(|error| format!("malformed till.shift.recorded payload: {error}"))?;
    if fact.site_id.trim().is_empty() || fact.terminal_id.trim().is_empty() {
        return Err("a cash shift needs a site and a terminal".into());
    }
    if !matches!(fact.status.as_str(), "OPEN" | "CLOSED") {
        return Err(format!("'{}' is not a shift status", fact.status));
    }
    if fact.opening_float_minor < 0 {
        return Err("a shift cannot open with a negative float".into());
    }
    if fact.status == "CLOSED" && fact.closed_at.is_none() {
        return Err("a closed shift has to say when it closed".into());
    }
    if fact.status == "OPEN" && fact.declared_cash_minor.is_some() {
        return Err("an open shift has not been counted".into());
    }
    for movement in &fact.movements {
        if movement.amount_minor == 0 {
            return Err(format!(
                "cash movement {} moves nothing; a zero movement is not a fact",
                movement.movement_id
            ));
        }
        if !matches!(
            movement.kind.as_str(),
            "OPENING_FLOAT" | "DROP" | "PICKUP" | "PAYOUT" | "CORRECTION"
        ) {
            return Err(format!("'{}' is not a cash movement kind", movement.kind));
        }
    }
    Ok(fact)
}

/// Take a shift and its movements into the centre.
///
/// Called from the sync applier, inside the transaction that advances the
/// watermark — the same path a sale takes, so a shift and the sales rung on it
/// arrive under one ordering. Nothing here touches watermark or generation
/// logic; it is handed the coordinate and stores it.
///
/// Idempotent by `shift_id`: a resent OPEN does nothing, and a CLOSED that
/// follows an OPEN fills in the close. The centre's own columns — the variance
/// approval and the journal entry ids — are never overwritten by a resend,
/// because the edge does not have them and a fact that carried them would be a
/// shop deciding what head office approved.
pub async fn cash_shift_ingest(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    generation: i64,
    seq: i64,
    fact: &CashShiftFact,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO cash_shift
             (shift_id, origin_id, generation, seq, site_id, terminal_id, status,
              opened_by, opened_at, opening_float_minor, closed_by, closed_at,
              declared_cash_minor, expected_cash_minor, variance_minor, close_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (shift_id) DO UPDATE SET
             status              = EXCLUDED.status,
             closed_by           = EXCLUDED.closed_by,
             closed_at           = EXCLUDED.closed_at,
             declared_cash_minor = EXCLUDED.declared_cash_minor,
             expected_cash_minor = EXCLUDED.expected_cash_minor,
             variance_minor      = EXCLUDED.variance_minor,
             close_note          = EXCLUDED.close_note
         WHERE cash_shift.status = 'OPEN'",
    )
    .bind(fact.shift_id)
    .bind(origin_id)
    .bind(generation)
    .bind(seq)
    .bind(fact.site_id.trim())
    .bind(fact.terminal_id.trim())
    .bind(&fact.status)
    .bind(fact.opened_by.trim())
    .bind(fact.opened_at)
    .bind(fact.opening_float_minor)
    .bind(fact.closed_by.as_deref())
    .bind(fact.closed_at)
    .bind(fact.declared_cash_minor)
    .bind(fact.expected_cash_minor)
    .bind(fact.variance_minor)
    .bind(fact.close_note.as_deref())
    .execute(&mut **tx)
    .await?;

    for movement in &fact.movements {
        sqlx::query(
            "INSERT INTO cash_movement
                 (movement_id, shift_id, site_id, kind, amount_minor, reason,
                  actor_id, approved_by, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (movement_id) DO NOTHING",
        )
        .bind(movement.movement_id)
        .bind(fact.shift_id)
        .bind(fact.site_id.trim())
        .bind(&movement.kind)
        .bind(movement.amount_minor)
        .bind(&movement.reason)
        .bind(movement.actor_id.trim())
        .bind(movement.approved_by.as_deref())
        .bind(movement.occurred_at)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// What one shift's drawer should have held, computed here rather than trusted.
///
/// Cash sales come from the tenders the shop already sends, filtered to CASH,
/// over the window the shift was open. Drops and pickups are movements. The
/// float is the shift's own.
///
/// A DROP is money leaving the drawer for the shop's safe; it is authorised by
/// whoever is named on it. An unapproved PAYOUT is not authorised and does not
/// reduce what the drawer should hold — see `DrawerMovement::authorised`.
pub async fn cash_shift_equation(
    pool: &PgPool,
    shift_id: Uuid,
) -> Result<CashierEquation, AppError> {
    let shift = sqlx::query(
        "SELECT site_id, opened_at, closed_at, opening_float_minor, declared_cash_minor
           FROM cash_shift WHERE shift_id = $1",
    )
    .bind(shift_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no cash shift {shift_id}")))?;

    let site_id: String = shift.try_get("site_id")?;
    let opened_at: DateTime<Utc> = shift.try_get("opened_at")?;
    let closed_at: Option<DateTime<Utc>> = shift.try_get("closed_at")?;
    let opening_float: i64 = shift.try_get("opening_float_minor")?;
    let declared: Option<i64> = shift.try_get("declared_cash_minor")?;

    // Cash taken over the counter while the shift was open. `now()` for an open
    // shift, so the figure a supervisor reads at four in the afternoon is what
    // the drawer should hold at four in the afternoon.
    let sales = sqlx::query(
        "SELECT COALESCE(SUM(t.amount_minor), 0)::bigint AS cash_minor
           FROM edge_sale_tender t
           JOIN edge_sale s ON s.sale_id = t.sale_id
          WHERE s.site_id = $1
            AND t.method = 'CASH'
            AND s.occurred_at >= $2
            AND s.occurred_at < COALESCE($3, now())",
    )
    .bind(&site_id)
    .bind(opened_at)
    .bind(closed_at)
    .fetch_one(pool)
    .await?;
    let cash_sales: i64 = sales.try_get("cash_minor")?;

    // The opening float arrives as a movement of its own on a well-formed
    // shift, and it is already in `opening_float_minor` — counting it twice
    // would double the float. Excluded here for that reason and no other.
    let rows = sqlx::query(
        "SELECT kind, amount_minor, approved_by FROM cash_movement
          WHERE shift_id = $1 AND kind <> 'OPENING_FLOAT'",
    )
    .bind(shift_id)
    .fetch_all(pool)
    .await?;
    let mut movements = Vec::with_capacity(rows.len());
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let approver: Option<String> = row.try_get("approved_by")?;
        movements.push(DrawerMovement {
            amount_minor: row.try_get("amount_minor")?,
            // A payout needs a signature; a drop, a pickup and a correction are
            // the shop moving its own custody around and carry their actor.
            authorised: kind != "PAYOUT" || approver.is_some(),
        });
    }

    Ok(cashier_equation(
        opening_float,
        cash_sales,
        &movements,
        declared,
    ))
}

/// Post the float a shift took out of store cash.
///
/// `1011001003 Modal Kasir` is an account the client keeps per location and
/// nothing has ever posted to it, because the only event that moves a float is
/// a shift opening and shift openings stopped at the edge. Now they do not.
///
///   Dr cashier_float [site] / Cr cash [site]
///
/// Both at the shop, so no cross-site leg. Idempotent: a shift that already has
/// an entry keeps it.
pub async fn cash_shift_post_float(
    pool: &PgPool,
    shift_id: Uuid,
    actor: &str,
) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT site_id, opening_float_minor, opened_at, float_out_entry_id
           FROM cash_shift WHERE shift_id = $1 FOR UPDATE",
    )
    .bind(shift_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no cash shift {shift_id}")))?;

    if row
        .try_get::<Option<Uuid>, _>("float_out_entry_id")?
        .is_some()
    {
        return Ok(json!({ "shift_id": shift_id, "posted": false,
                          "reason": "the float on this shift is already in the books" }));
    }
    let float: i64 = row.try_get("opening_float_minor")?;
    if float == 0 {
        return Ok(json!({ "shift_id": shift_id, "posted": false,
                          "reason": "this shift opened with no float" }));
    }
    let site_id: String = row.try_get("site_id")?;
    let opened_at: DateTime<Utc> = row.try_get("opened_at")?;
    let posting_date = opened_at.date_naive();

    let intent = PostingIntent {
        posting_date,
        source_kind: "CASH_SHIFT".into(),
        source_id: Some(shift_id.to_string()),
        rule_version: "cash_shift_float/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("Modal kasir — shift {shift_id}")),
        lines: vec![
            PostingLine::debit("cashier_float", &site_id, float),
            PostingLine::credit("cash", &site_id, float),
        ],
    };
    let mut tx = pool.begin().await?;
    // A shift is the second two-step document in this lane, not the deposit
    // alone: the float goes out when the drawer opens and the variance is
    // booked when it is counted, and both carry the shift as their source.
    let posted = lane_b_post(&mut tx, &intent, Some("FLOAT"), actor).await?;
    sqlx::query("UPDATE cash_shift SET float_out_entry_id = $2 WHERE shift_id = $1")
        .bind(shift_id)
        .bind(posted.entry_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(json!({ "shift_id": shift_id, "posted": true,
               "entry_number": posted.entry_number, "amount_minor": float }))
}

#[derive(Debug, Deserialize)]
pub struct ApproveVarianceRequest {
    /// The date the difference is booked on. The shift's close date by default.
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Accept a drawer's difference and put it in the books.
///
/// Nothing posts a variance automatically, deliberately. An automatic write-off
/// is how a till that is short every evening becomes a line nobody reads; a
/// person accepting each one is how somebody notices that C007's afternoon
/// shift is always forty thousand light.
///
///   short  Dr cash_variance [site] / Cr cash [site]
///   over   Dr cash [site]          / Cr cash_variance [site]
pub async fn cash_shift_approve_variance(
    pool: &PgPool,
    shift_id: Uuid,
    request: &ApproveVarianceRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT site_id, status, variance_minor, closed_at, approved_at, variance_entry_id
           FROM cash_shift WHERE shift_id = $1 FOR UPDATE",
    )
    .bind(shift_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no cash shift {shift_id}")))?;

    let status: String = row.try_get("status")?;
    if status != "CLOSED" {
        return Err(AppError::Conflict(
            "this shift is still open; a drawer that has not been counted has no difference to \
             accept"
                .into(),
        ));
    }
    if row
        .try_get::<Option<DateTime<Utc>>, _>("approved_at")?
        .is_some()
    {
        return Err(AppError::Conflict(
            "this difference has already been accepted".into(),
        ));
    }
    let variance: i64 = row
        .try_get::<Option<i64>, _>("variance_minor")?
        .ok_or_else(|| {
            AppError::Conflict("this shift closed without a counted difference".into())
        })?;
    let site_id: String = row.try_get("site_id")?;
    let closed_at: Option<DateTime<Utc>> = row.try_get("closed_at")?;

    if variance == 0 {
        // Accepted, and nothing to post: a drawer that came up exactly right
        // still deserves the signature that says somebody looked.
        sqlx::query(
            "UPDATE cash_shift SET approved_by = $2, approved_at = now() WHERE shift_id = $1",
        )
        .bind(shift_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(json!({ "shift_id": shift_id, "variance_minor": 0, "posted": false }));
    }

    let posting_date = request
        .posting_date
        .or_else(|| closed_at.map(|at| at.date_naive()))
        .ok_or_else(|| AppError::Validation("a variance needs a date to be booked on".into()))?;
    let amount = variance.abs();
    let lines = if variance < 0 {
        vec![
            PostingLine::debit("cash_variance", &site_id, amount),
            PostingLine::credit("cash", &site_id, amount),
        ]
    } else {
        vec![
            PostingLine::debit("cash", &site_id, amount),
            PostingLine::credit("cash_variance", &site_id, amount),
        ]
    };
    let intent = PostingIntent {
        posting_date,
        source_kind: "CASH_SHIFT".into(),
        source_id: Some(shift_id.to_string()),
        rule_version: "cash_shift_variance/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "Selisih kas — shift {shift_id}{}",
            request
                .note
                .as_deref()
                .map(|note| format!(" — {note}"))
                .unwrap_or_default()
        )),
        lines,
    };
    // The shift's other step. See the float above.
    let posted = lane_b_post(&mut tx, &intent, Some("VARIANCE"), actor).await?;
    sqlx::query(
        "UPDATE cash_shift
            SET approved_by = $2, approved_at = now(), variance_entry_id = $3
          WHERE shift_id = $1",
    )
    .bind(shift_id)
    .bind(actor)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({
        "shift_id": shift_id,
        "variance_minor": variance,
        "posted": true,
        "entry_number": posted.entry_number
    }))
}

/// The shifts at a shop, newest first, with the difference nobody has accepted
/// flagged.
pub async fn cash_shift_list(
    pool: &PgPool,
    site_id: Option<&str>,
    unapproved_only: bool,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT s.shift_id, s.site_id, s.terminal_id, s.status, s.opened_by, s.opened_at,
                s.opening_float_minor, s.closed_by, s.closed_at, s.declared_cash_minor,
                s.expected_cash_minor, s.variance_minor, s.approved_by, s.approved_at,
                s.float_out_entry_id, s.variance_entry_id, s.close_note
           FROM cash_shift s
          WHERE ($1::text IS NULL OR s.site_id = $1)
            AND (NOT $2 OR (s.status = 'CLOSED'
                            AND s.variance_minor IS NOT NULL AND s.variance_minor <> 0
                            AND s.approved_at IS NULL))
          ORDER BY s.opened_at DESC
          LIMIT $3",
    )
    .bind(site_id)
    .bind(unapproved_only)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            Ok(json!({
                "shift_id": row.try_get::<Uuid, _>("shift_id")?,
                "site_id": row.try_get::<String, _>("site_id")?,
                "terminal_id": row.try_get::<String, _>("terminal_id")?,
                "status": row.try_get::<String, _>("status")?,
                "opened_by": row.try_get::<String, _>("opened_by")?,
                "opened_at": row.try_get::<DateTime<Utc>, _>("opened_at")?,
                "opening_float_minor": row.try_get::<i64, _>("opening_float_minor")?,
                "closed_by": row.try_get::<Option<String>, _>("closed_by")?,
                "closed_at": row.try_get::<Option<DateTime<Utc>>, _>("closed_at")?,
                "declared_cash_minor": row.try_get::<Option<i64>, _>("declared_cash_minor")?,
                // What the shop worked out, kept beside what the centre works
                // out. Two figures rather than one, so a till on an old build
                // is visible instead of silently authoritative.
                "shop_expected_cash_minor": row.try_get::<Option<i64>, _>("expected_cash_minor")?,
                "shop_variance_minor": row.try_get::<Option<i64>, _>("variance_minor")?,
                "approved_by": row.try_get::<Option<String>, _>("approved_by")?,
                "approved_at": row.try_get::<Option<DateTime<Utc>>, _>("approved_at")?,
                "float_posted": row.try_get::<Option<Uuid>, _>("float_out_entry_id")?.is_some(),
                "variance_posted": row.try_get::<Option<Uuid>, _>("variance_entry_id")?.is_some(),
                "close_note": row.try_get::<Option<String>, _>("close_note")?,
            }))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The deposit
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PrepareDepositRequest {
    pub site_id: String,
    pub amount_minor: i64,
    pub deposit_date: NaiveDate,
    /// Which head office account. Defaults to the shop's standing destination.
    #[serde(default)]
    pub bank_key: Option<String>,
    #[serde(default)]
    pub bank_qualifier: Option<String>,
    /// The order line this deposit carries out, when it is disposing of
    /// reconciled proceeds.
    #[serde(default)]
    pub remittance_line_id: Option<Uuid>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Count it, bag it, write the slip. Nothing has posted yet.
pub async fn store_deposit_prepare(
    pool: &PgPool,
    request: &PrepareDepositRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a deposit of nothing is not a deposit".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    site_exists(&mut tx, &request.site_id).await?;

    let (bank_key, bank_qualifier) = match (&request.bank_key, &request.bank_qualifier) {
        (Some(key), Some(qualifier)) => (key.clone(), qualifier.clone()),
        _ => {
            let row = sqlx::query(
                "SELECT bank_key, bank_qualifier FROM store_bank_destination WHERE site_id = $1",
            )
            .bind(&request.site_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "{} has no standing bank destination, so this deposit has to name one. Set \
                     the shop's default under Store money → Banking.",
                    request.site_id
                ))
            })?;
            (row.try_get("bank_key")?, row.try_get("bank_qualifier")?)
        }
    };

    // A deposit that names an order line has to fit inside it. The trigger in
    // 0112 enforces the same rule on the execution link; this is the early,
    // explainable half.
    if let Some(line_id) = request.remittance_line_id {
        remittance_line_room(&mut tx, line_id, request.amount_minor).await?;
    }

    let number = next_document_number(&mut tx, "SB", "SB", request.deposit_date).await?;
    let deposit_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO store_deposit
             (deposit_id, deposit_number, site_id, amount_minor, bank_key, bank_qualifier,
              status, prepared_by, deposit_date, remittance_line_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,'PREPARED',$7,$8,$9,$10)",
    )
    .bind(deposit_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(request.amount_minor)
    .bind(&bank_key)
    .bind(&bank_qualifier)
    .bind(actor)
    .bind(request.deposit_date)
    .bind(request.remittance_line_id)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({ "deposit_id": deposit_id, "deposit_number": number, "status": "PREPARED" }))
}

#[derive(Debug, Deserialize)]
pub struct HandOverDepositRequest {
    /// The photograph of the slip.
    #[serde(default)]
    pub proof_file_id: Option<Uuid>,
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

/// The bag has left the shop.
///
///   Dr cash_in_transit [site] / Cr cash [site]
///
/// Both at the shop. The money now has a name and an owner on the days it is in
/// somebody's hands, which is the gap this document exists to close.
pub async fn store_deposit_hand_over(
    pool: &PgPool,
    deposit_id: Uuid,
    request: &HandOverDepositRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let row = deposit_for_update(&mut tx, deposit_id).await?;
    let status: String = row.try_get("status")?;
    if status != "PREPARED" {
        return Err(AppError::Conflict(format!(
            "deposit {} is {}, not waiting to be handed over",
            row.try_get::<String, _>("deposit_number")?,
            status.to_lowercase()
        )));
    }
    let site_id: String = row.try_get("site_id")?;
    let amount: i64 = row.try_get("amount_minor")?;
    let number: String = row.try_get("deposit_number")?;
    let posting_date = request.posting_date.unwrap_or_else(|| {
        row.try_get::<NaiveDate, _>("deposit_date")
            .unwrap_or_default()
    });

    let intent = PostingIntent {
        posting_date,
        source_kind: "STORE_DEPOSIT".into(),
        source_id: Some(deposit_id.to_string()),
        rule_version: "store_deposit_out/1".into(),
        currency: row.try_get::<String, _>("currency")?,
        memo: Some(format!("{number} — setoran keluar")),
        lines: vec![
            PostingLine::debit("cash_in_transit", &site_id, amount),
            PostingLine::credit("cash", &site_id, amount),
        ],
    };
    // Two postings on one document, so the step is named. See `lane_b_post`.
    let posted = lane_b_post(&mut tx, &intent, Some("OUT"), actor).await?;
    sqlx::query(
        "UPDATE store_deposit
            SET status='DEPOSITED', deposited_by=$2, deposited_at=now(),
                proof_file_id=COALESCE($3, proof_file_id), out_entry_id=$4
          WHERE deposit_id=$1",
    )
    .bind(deposit_id)
    .bind(actor)
    .bind(request.proof_file_id)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({ "deposit_id": deposit_id, "status": "DEPOSITED",
               "entry_number": posted.entry_number }))
}

#[derive(Debug, Default, Deserialize)]
pub struct ConfirmDepositRequest {
    /// The bank line that proves it arrived. The matcher passes this; a person
    /// reading a statement may too.
    #[serde(default)]
    pub bank_statement_line_id: Option<Uuid>,
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

/// The bank agrees.
///
///   Dr bank [dc, qualifier] / Cr cash_in_transit [site]
///
/// Cross-site: the credit is the shop's cash in transit, the debit is head
/// office's bank. The entry balances in total and not per location, which is
/// what the poster's affiliate legs are for. Nothing here writes one.
///
/// One endpoint for both callers. The bank matcher calls it with a line id; a
/// person reading a statement calls it with the line they found, or with
/// nothing when the statement has not been imported. Two endpoints would be two
/// rules that eventually disagree about what confirmation means.
pub async fn store_deposit_confirm(
    pool: &PgPool,
    deposit_id: Uuid,
    request: &ConfirmDepositRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let row = deposit_for_update(&mut tx, deposit_id).await?;
    let number: String = row.try_get("deposit_number")?;
    let status: String = row.try_get("status")?;
    if status == "CONFIRMED" {
        return Ok(json!({ "deposit_id": deposit_id, "status": "CONFIRMED", "posted": false }));
    }
    if status != "DEPOSITED" {
        return Err(AppError::Conflict(format!(
            "deposit {number} is {}; only a deposit that has left the shop can be confirmed",
            status.to_lowercase()
        )));
    }
    let site_id: String = row.try_get("site_id")?;
    let amount: i64 = row.try_get("amount_minor")?;
    let bank_key: String = row.try_get("bank_key")?;
    let bank_qualifier: String = row.try_get("bank_qualifier")?;
    let posting_date = request.posting_date.unwrap_or_else(|| {
        row.try_get::<NaiveDate, _>("deposit_date")
            .unwrap_or_default()
    });

    let intent = PostingIntent {
        posting_date,
        source_kind: "STORE_DEPOSIT".into(),
        source_id: Some(deposit_id.to_string()),
        rule_version: "store_deposit_in/1".into(),
        currency: row.try_get::<String, _>("currency")?,
        memo: Some(format!("{number} — setoran diterima bank")),
        lines: vec![
            PostingLine::debit(&bank_key, HEAD_OFFICE_SITE_ID, amount)
                .with_qualifier(&bank_qualifier),
            PostingLine::credit("cash_in_transit", &site_id, amount),
        ],
    };
    let posted = lane_b_post(&mut tx, &intent, Some("IN"), actor).await?;
    sqlx::query(
        "UPDATE store_deposit
            SET status='CONFIRMED', confirmed_by=$2, confirmed_at=now(),
                bank_statement_line_id=COALESCE($3, bank_statement_line_id), in_entry_id=$4
          WHERE deposit_id=$1",
    )
    .bind(deposit_id)
    .bind(actor)
    .bind(request.bank_statement_line_id)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(
        json!({ "deposit_id": deposit_id, "status": "CONFIRMED", "posted": true,
               "entry_number": posted.entry_number }),
    )
}

async fn deposit_for_update(
    tx: &mut Transaction<'_, Postgres>,
    deposit_id: Uuid,
) -> Result<sqlx::postgres::PgRow, AppError> {
    sqlx::query("SELECT * FROM store_deposit WHERE deposit_id = $1 FOR UPDATE")
        .bind(deposit_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("there is no deposit {deposit_id}")))
}

pub async fn store_deposit_list(
    pool: &PgPool,
    site_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT deposit_id, deposit_number, site_id, amount_minor, currency, bank_key,
                bank_qualifier, status, prepared_by, deposit_date, deposited_at,
                confirmed_at, bank_statement_line_id, remittance_line_id, note
           FROM store_deposit
          WHERE ($1::text IS NULL OR site_id = $1)
            AND ($2::text IS NULL OR status = $2)
          ORDER BY deposit_date DESC, deposit_number DESC
          LIMIT $3",
    )
    .bind(site_id)
    .bind(status)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(json!({
                "deposit_id": row.try_get::<Uuid, _>("deposit_id")?,
                "deposit_number": row.try_get::<String, _>("deposit_number")?,
                "site_id": row.try_get::<String, _>("site_id")?,
                "amount_minor": row.try_get::<i64, _>("amount_minor")?,
                "currency": row.try_get::<String, _>("currency")?,
                "bank_key": row.try_get::<String, _>("bank_key")?,
                "bank_qualifier": row.try_get::<String, _>("bank_qualifier")?,
                "status": row.try_get::<String, _>("status")?,
                "prepared_by": row.try_get::<String, _>("prepared_by")?,
                "deposit_date": row.try_get::<NaiveDate, _>("deposit_date")?,
                "deposited_at": row.try_get::<Option<DateTime<Utc>>, _>("deposited_at")?,
                "confirmed_at": row.try_get::<Option<DateTime<Utc>>, _>("confirmed_at")?,
                "bank_statement_line_id":
                    row.try_get::<Option<Uuid>, _>("bank_statement_line_id")?,
                "remittance_line_id": row.try_get::<Option<Uuid>, _>("remittance_line_id")?,
                "note": row.try_get::<Option<String>, _>("note")?,
            }))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The remittance order
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RemittanceLineRequest {
    pub destination_kind: String,
    pub destination_ref: String,
    #[serde(default)]
    pub destination_name: Option<String>,
    pub amount_minor: i64,
    pub purpose: String,
}

#[derive(Debug, Deserialize)]
pub struct IssueRemittanceRequest {
    pub site_id: String,
    pub order_date: NaiveDate,
    /// The business day through which the proceeds are reconciled.
    #[serde(default)]
    pub reconciled_through: Option<NaiveDate>,
    /// Empty means "what this shop's standing default says".
    #[serde(default)]
    pub lines: Vec<RemittanceLineRequest>,
    #[serde(default)]
    pub total_minor: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Write the instruction. **This posts nothing.**
///
/// No journal entry, no payment ledger item, no balance touched. It is a
/// mandate. The money moves when a deposit or a cash document carries it out,
/// under that document's own rule, and this order's progress is read back from
/// what has been linked to it.
///
/// With no lines, the shop's standing default supplies one for the whole
/// amount, so reconciled proceeds cannot sit with no disposition just because
/// nobody typed anything this evening.
pub async fn remittance_order_issue(
    pool: &PgPool,
    request: &IssueRemittanceRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    site_exists(&mut tx, &request.site_id).await?;

    // TODO(lane-H): tender reconciliation is a neighbouring lane
    // (`tender_reconciliation`, one row per shop per day per tender kind,
    // CLOSED once every receipt has been answered for). When it merges, this
    // becomes a refusal: head office may only order the disposal of proceeds
    // the shop has proved it holds, so a `reconciled_through` with an open or
    // missing CASH reconciliation on or before it is rejected here, by name and
    // by date. Until then the date is recorded and believed.
    let reconciled_through = request.reconciled_through;

    let mut lines: Vec<(String, String, Option<String>, i64, String)> = request
        .lines
        .iter()
        .map(|line| {
            (
                line.destination_kind.trim().to_ascii_uppercase(),
                line.destination_ref.trim().to_string(),
                line.destination_name.clone(),
                line.amount_minor,
                line.purpose.trim().to_string(),
            )
        })
        .collect();

    if lines.is_empty() {
        let total = request
            .total_minor
            .filter(|amount| *amount > 0)
            .ok_or_else(|| {
                AppError::Validation(
                "an order with no lines needs the amount to dispose of, so the shop's standing \
                 destination can carry it"
                    .into(),
            )
            })?;
        let default = sqlx::query(
            "SELECT destination_kind, destination_ref, purpose
               FROM store_remittance_default WHERE site_id = $1",
        )
        .bind(&request.site_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "{} has no standing destination for its takings, so this order has to say where \
                 the money goes. Set the default under Store money → Remittance.",
                request.site_id
            ))
        })?;
        lines.push((
            default.try_get::<String, _>("destination_kind")?,
            default.try_get::<String, _>("destination_ref")?,
            None,
            total,
            default.try_get::<String, _>("purpose")?,
        ));
    }

    let mut resolved = Vec::with_capacity(lines.len());
    for (kind, reference, name, amount, purpose) in lines {
        if amount <= 0 {
            return Err(AppError::Validation(
                "an order line for nothing authorises nothing".into(),
            ));
        }
        if purpose.is_empty() {
            return Err(AppError::Validation(
                "every line needs a reason; an instruction to hand over money with none is the \
                 document this refuses to be"
                    .into(),
            ));
        }
        let display = resolve_destination(&mut tx, &kind, &reference, name.as_deref()).await?;
        resolved.push((kind, reference, display, amount, purpose));
    }

    let number = next_document_number(&mut tx, "REM", "REM", request.order_date).await?;
    let order_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO remittance_order
             (order_id, order_number, site_id, source, reconciled_through, status,
              issued_by, order_date, note)
         VALUES ($1,$2,$3,'SALES_PROCEEDS',$4,'ISSUED',$5,$6,$7)",
    )
    .bind(order_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(reconciled_through)
    .bind(actor)
    .bind(request.order_date)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;

    for (index, (kind, reference, display, amount, purpose)) in resolved.iter().enumerate() {
        sqlx::query(
            "INSERT INTO remittance_order_line
                 (line_id, order_id, line_no, destination_kind, destination_ref,
                  destination_name, amount_minor, purpose)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(Uuid::new_v4())
        .bind(order_id)
        .bind(index as i32 + 1)
        .bind(kind)
        .bind(reference)
        .bind(display)
        .bind(amount)
        .bind(purpose)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(
        json!({ "order_id": order_id, "order_number": number, "status": "ISSUED",
               "posted": false }),
    )
}

/// Turn a destination reference into the name a printed order carries, and
/// refuse one that resolves to nothing.
///
/// Resolved once, when the order is written, so a supplier renamed in March
/// does not rewrite what January's order said.
async fn resolve_destination(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    reference: &str,
    supplied: Option<&str>,
) -> Result<String, AppError> {
    if reference.is_empty() {
        return Err(AppError::Validation(
            "an order line needs a destination".into(),
        ));
    }
    match kind {
        "SUPPLIER" => {
            let name: Option<String> =
                sqlx::query("SELECT name FROM supplier WHERE supplier_code = $1")
                    .bind(reference)
                    .fetch_optional(&mut **tx)
                    .await?
                    .map(|row| row.try_get("name"))
                    .transpose()?;
            name.or_else(|| supplied.map(str::to_string))
                .ok_or_else(|| {
                    AppError::NotFound(format!(
                        "there is no supplier {reference}. A payee with no supplier record is a \
                     VENDOR line, which takes the name written on it."
                    ))
                })
        }
        "OTHER_SITE" => {
            let name: Option<String> = sqlx::query("SELECT name FROM site WHERE id = $1")
                .bind(reference)
                .fetch_optional(&mut **tx)
                .await?
                .map(|row| row.try_get("name"))
                .transpose()?;
            name.ok_or_else(|| AppError::NotFound(format!("there is no site {reference}")))
        }
        "BANK_ACCOUNT" => Ok(supplied.unwrap_or(reference).to_string()),
        "VENDOR" => Ok(supplied.unwrap_or(reference).to_string()),
        other => Err(AppError::Validation(format!(
            "'{other}' is not a destination; it is one of BANK_ACCOUNT, SUPPLIER, VENDOR, \
             OTHER_SITE"
        ))),
    }
}

/// How much of a line is still unexecuted, refusing if the amount does not fit.
///
/// The authority is computed from the executions rather than decremented, so
/// two payments racing for the same line cannot both believe there was room.
/// The trigger in 0112 is the guarantee; this is the explanation.
async fn remittance_line_room(
    tx: &mut Transaction<'_, Postgres>,
    line_id: Uuid,
    wanted_minor: i64,
) -> Result<i64, AppError> {
    let row = sqlx::query(
        "SELECT l.amount_minor, o.status, o.order_number,
                COALESCE((SELECT SUM(e.amount_minor) FROM remittance_order_execution e
                           WHERE e.line_id = l.line_id), 0)::bigint AS used
           FROM remittance_order_line l
           JOIN remittance_order o ON o.order_id = l.order_id
          WHERE l.line_id = $1
            FOR UPDATE OF l",
    )
    .bind(line_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no remittance order line {line_id}")))?;

    let status: String = row.try_get("status")?;
    let number: String = row.try_get("order_number")?;
    if status == "CANCELLED" {
        return Err(AppError::Conflict(format!(
            "remittance order {number} has been withdrawn and authorises nothing"
        )));
    }
    let authorised: i64 = row.try_get("amount_minor")?;
    let used: i64 = row.try_get("used")?;
    let left = authorised - used;
    if wanted_minor > left {
        return Err(AppError::Conflict(format!(
            "remittance order {number} authorises {left} more on this line; {wanted_minor} would \
             exceed it. Ask head office to widen the order or issue another one."
        )));
    }
    Ok(left)
}

#[derive(Debug, Deserialize)]
pub struct LinkExecutionRequest {
    pub line_id: Uuid,
    /// STORE_DEPOSIT, CASH_DOCUMENT or SUPPLIER_PAYMENT.
    pub document_kind: String,
    pub document_id: Uuid,
    pub document_number: String,
    pub amount_minor: i64,
}

/// Record that a money document carried out part of an order.
///
/// A link and nothing more. It posts nothing — the document that is being
/// linked has already posted, under its own rule — and it stores no status,
/// because an execution's state belongs to the document that performed it.
pub async fn remittance_order_link_execution(
    pool: &PgPool,
    request: &LinkExecutionRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let kind = request.document_kind.trim().to_ascii_uppercase();
    if !matches!(
        kind.as_str(),
        "STORE_DEPOSIT" | "CASH_DOCUMENT" | "SUPPLIER_PAYMENT"
    ) {
        return Err(AppError::Validation(format!(
            "'{kind}' is not a money document; it is one of STORE_DEPOSIT, CASH_DOCUMENT, \
             SUPPLIER_PAYMENT"
        )));
    }
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an execution for nothing carries out nothing".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    remittance_line_room(&mut tx, request.line_id, request.amount_minor).await?;
    let execution_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO remittance_order_execution
             (execution_id, line_id, document_kind, document_id, document_number,
              amount_minor, linked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (line_id, document_kind, document_id) DO NOTHING",
    )
    .bind(execution_id)
    .bind(request.line_id)
    .bind(&kind)
    .bind(request.document_id)
    .bind(request.document_number.trim())
    .bind(request.amount_minor)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({ "execution_id": execution_id, "posted": false }))
}

/// What a shop is authorised to pay a given destination out of its takings.
///
/// The check the money documents call before they credit a shop's cash. It
/// returns the lines that would cover the payment, so a refusal can name the
/// order somebody should be asking for rather than saying no twice.
pub async fn remittance_authority(
    pool: &PgPool,
    site_id: &str,
    destination_kind: &str,
    destination_ref: &str,
    amount_minor: i64,
) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, o.order_number, l.amount_minor, l.purpose,
                COALESCE((SELECT SUM(e.amount_minor) FROM remittance_order_execution e
                           WHERE e.line_id = l.line_id), 0)::bigint AS used
           FROM remittance_order_line l
           JOIN remittance_order o ON o.order_id = l.order_id
          WHERE o.site_id = $1
            AND o.status = 'ISSUED'
            AND l.destination_kind = $2
            AND l.destination_ref = $3
          ORDER BY o.order_date, o.order_number, l.line_no",
    )
    .bind(site_id)
    .bind(destination_kind.trim().to_ascii_uppercase())
    .bind(destination_ref.trim())
    .fetch_all(pool)
    .await?;

    let mut available = 0_i64;
    let mut candidates = Vec::new();
    for row in &rows {
        let authorised: i64 = row.try_get("amount_minor")?;
        let used: i64 = row.try_get("used")?;
        let left = authorised - used;
        if left <= 0 {
            continue;
        }
        available += left;
        candidates.push(json!({
            "line_id": row.try_get::<Uuid, _>("line_id")?,
            "order_number": row.try_get::<String, _>("order_number")?,
            "purpose": row.try_get::<String, _>("purpose")?,
            "unexecuted_minor": left,
        }));
    }
    Ok(json!({
        "site_id": site_id,
        "destination_kind": destination_kind,
        "destination_ref": destination_ref,
        "wanted_minor": amount_minor,
        "authorised": available >= amount_minor,
        "available_minor": available,
        "lines": candidates,
        "refusal": if available >= amount_minor { Value::Null } else { json!(format!(
            "{site_id} may not pay this out of its takings: no remittance order authorises it. \
             Sales proceeds are head office's money in the shop's custody — ask head office to \
             issue a remittance order naming this destination, or bank the takings and pay from \
             head office."))
        },
    }))
}

/// One order, with its lines and its progress read off its executions.
pub async fn remittance_order_view(pool: &PgPool, order_id: Uuid) -> Result<Value, AppError> {
    let order = sqlx::query(
        "SELECT order_id, order_number, site_id, source, reconciled_through, amount_minor,
                currency, status, issued_by, issued_at, order_date, note,
                cancelled_by, cancelled_at, cancel_reason
           FROM remittance_order WHERE order_id = $1",
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no remittance order {order_id}")))?;

    let cancelled = order.try_get::<String, _>("status")? == "CANCELLED";
    let (lines, progress) = remittance_lines_and_standing(pool, order_id).await?;

    Ok(json!({
        "order_id": order.try_get::<Uuid, _>("order_id")?,
        "order_number": order.try_get::<String, _>("order_number")?,
        "site_id": order.try_get::<String, _>("site_id")?,
        "source": order.try_get::<String, _>("source")?,
        "reconciled_through": order.try_get::<Option<NaiveDate>, _>("reconciled_through")?,
        "amount_minor": order.try_get::<i64, _>("amount_minor")?,
        "currency": order.try_get::<String, _>("currency")?,
        "status": order.try_get::<String, _>("status")?,
        "issued_by": order.try_get::<String, _>("issued_by")?,
        "issued_at": order.try_get::<DateTime<Utc>, _>("issued_at")?,
        "order_date": order.try_get::<NaiveDate, _>("order_date")?,
        "note": order.try_get::<Option<String>, _>("note")?,
        "cancel_reason": order.try_get::<Option<String>, _>("cancel_reason")?,
        "lines": lines,
        // Read, never stored. See 0112.
        "progress": progress.progress.as_str(),
        "authorised_minor": progress.authorised_minor,
        "executed_minor": progress.executed_minor,
        "confirmed_minor": progress.confirmed_minor,
        "unexecuted_minor": progress.unexecuted_minor,
        "cancelled": cancelled,
    }))
}

/// The lines of one order, each with its executions and their states, plus the
/// standing that falls out of them.
///
/// The state of an execution is read from the document that performed it. A
/// store deposit says CONFIRMED when the bank has agreed; a supplier payment
/// says POSTED. `cash_document` belongs to a lane that is not merged here, so
/// its executions read as `Recorded` — never `Confirmed`, so an order can never
/// claim more certainty than this build can actually see.
/// TODO(lane-C): join `cash_document` and read `status = 'POSTED'`.
async fn remittance_lines_and_standing(
    pool: &PgPool,
    order_id: Uuid,
) -> Result<(Vec<Value>, RemittanceStanding), AppError> {
    let line_rows = sqlx::query(
        "SELECT line_id, line_no, destination_kind, destination_ref, destination_name,
                amount_minor, purpose
           FROM remittance_order_line WHERE order_id = $1 ORDER BY line_no",
    )
    .bind(order_id)
    .fetch_all(pool)
    .await?;

    let cancelled: bool =
        sqlx::query("SELECT status = 'CANCELLED' AS c FROM remittance_order WHERE order_id = $1")
            .bind(order_id)
            .fetch_one(pool)
            .await?
            .try_get("c")?;

    let mut lines = Vec::with_capacity(line_rows.len());
    let mut progress_lines = Vec::with_capacity(line_rows.len());
    for row in &line_rows {
        let line_id: Uuid = row.try_get("line_id")?;
        let execution_rows = sqlx::query(
            "SELECT e.execution_id, e.document_kind, e.document_id, e.document_number,
                    e.amount_minor, e.linked_at,
                    CASE
                        WHEN e.document_kind = 'STORE_DEPOSIT'
                             AND d.status = 'CONFIRMED' THEN true
                        WHEN e.document_kind = 'SUPPLIER_PAYMENT'
                             AND p.status = 'POSTED' THEN true
                        ELSE false
                    END AS confirmed
               FROM remittance_order_execution e
               LEFT JOIN store_deposit d ON d.deposit_id = e.document_id
               LEFT JOIN supplier_payment p ON p.payment_id = e.document_id
              WHERE e.line_id = $1
              ORDER BY e.linked_at",
        )
        .bind(line_id)
        .fetch_all(pool)
        .await?;

        let mut executions = Vec::with_capacity(execution_rows.len());
        let mut states = Vec::with_capacity(execution_rows.len());
        for execution in &execution_rows {
            let amount: i64 = execution.try_get("amount_minor")?;
            let confirmed: bool = execution.try_get("confirmed")?;
            let state = if confirmed {
                ExecutionState::Confirmed
            } else {
                ExecutionState::Recorded
            };
            states.push(LineExecution {
                amount_minor: amount,
                state,
            });
            executions.push(json!({
                "execution_id": execution.try_get::<Uuid, _>("execution_id")?,
                "document_kind": execution.try_get::<String, _>("document_kind")?,
                "document_id": execution.try_get::<Uuid, _>("document_id")?,
                "document_number": execution.try_get::<String, _>("document_number")?,
                "amount_minor": amount,
                "state": if confirmed { "CONFIRMED" } else { "RECORDED" },
            }));
        }

        let authorised: i64 = row.try_get("amount_minor")?;
        progress_lines.push(LineProgress {
            authorised_minor: authorised,
            executions: states,
        });
        lines.push(json!({
            "line_id": line_id,
            "line_no": row.try_get::<i32, _>("line_no")?,
            "destination_kind": row.try_get::<String, _>("destination_kind")?,
            "destination_ref": row.try_get::<String, _>("destination_ref")?,
            "destination_name": row.try_get::<String, _>("destination_name")?,
            "amount_minor": authorised,
            "purpose": row.try_get::<String, _>("purpose")?,
            "executions": executions,
        }));
    }

    Ok((lines, remittance_standing(cancelled, &progress_lines)))
}

pub async fn remittance_order_list(
    pool: &PgPool,
    site_id: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT order_id FROM remittance_order
          WHERE ($1::text IS NULL OR site_id = $1)
          ORDER BY order_date DESC, order_number DESC
          LIMIT $2",
    )
    .bind(site_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;
    let mut orders = Vec::with_capacity(rows.len());
    for row in &rows {
        orders.push(remittance_order_view(pool, row.try_get("order_id")?).await?);
    }
    Ok(orders)
}

#[derive(Debug, Deserialize)]
pub struct CancelRemittanceRequest {
    pub reason: String,
}

/// Withdraw an order. Executions already linked to it stay visible: somebody
/// did pay, and a cancellation that hid that would be the more dangerous
/// document.
pub async fn remittance_order_cancel(
    pool: &PgPool,
    order_id: Uuid,
    request: &CancelRemittanceRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "withdrawing an order needs a reason".into(),
        ));
    }
    let affected = sqlx::query(
        "UPDATE remittance_order
            SET status='CANCELLED', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3
          WHERE order_id=$1 AND status='ISSUED'",
    )
    .bind(order_id)
    .bind(actor)
    .bind(request.reason.trim())
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "this order is not open to be withdrawn".into(),
        ));
    }
    remittance_order_view(pool, order_id).await
}

#[derive(Debug, Deserialize)]
pub struct SetRemittanceDefaultRequest {
    pub destination_kind: String,
    pub destination_ref: String,
    pub purpose: String,
}

pub async fn remittance_default_set(
    pool: &PgPool,
    site_id: &str,
    request: &SetRemittanceDefaultRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    site_exists(&mut tx, site_id).await?;
    let kind = request.destination_kind.trim().to_ascii_uppercase();
    resolve_destination(&mut tx, &kind, request.destination_ref.trim(), None).await?;
    sqlx::query(
        "INSERT INTO store_remittance_default
             (site_id, destination_kind, destination_ref, purpose, set_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (site_id) DO UPDATE SET
             destination_kind = EXCLUDED.destination_kind,
             destination_ref  = EXCLUDED.destination_ref,
             purpose          = EXCLUDED.purpose,
             set_by           = EXCLUDED.set_by,
             set_at           = now()",
    )
    .bind(site_id)
    .bind(&kind)
    .bind(request.destination_ref.trim())
    .bind(request.purpose.trim())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(json!({ "site_id": site_id, "destination_kind": kind }))
}

// ---------------------------------------------------------------------------
// Operating funds
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SendFundRequest {
    pub site_id: String,
    /// The store manager who will hold it.
    pub custodian_employee_id: String,
    pub amount_minor: i64,
    pub value_date: NaiveDate,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    pub bank_key: String,
    pub bank_qualifier: String,
    /// The custodian's own account. Payout metadata: never a Bank Account,
    /// never a COA account.
    pub payout_bank_name: String,
    pub payout_account_no: String,
    pub payout_account_name: String,
    #[serde(default)]
    pub note: Option<String>,
}

/// Head office funds a shop.
///
///   Dr store_manager_receivable [site] / Cr bank [dc, qualifier]
///
/// and a Payment Ledger item against the custodian as an EMPLOYEE, so the float
/// ages beside the supplier balances rather than in a column somebody has to
/// remember to read.
pub async fn operating_fund_send(
    pool: &PgPool,
    request: &SendFundRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a fund of nothing funds nothing".into(),
        ));
    }
    if !matches!(request.bank_key.as_str(), "bank_giro" | "bank_savings") {
        return Err(AppError::Validation(
            "a fund leaves a giro or a savings account".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    site_exists(&mut tx, &request.site_id).await?;

    let custodian = sqlx::query("SELECT id, code, status FROM employee WHERE id = $1")
        .bind(&request.custodian_employee_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "there is no employee {}",
                request.custodian_employee_id
            ))
        })?;
    let custodian_status: String = custodian.try_get("status")?;
    if custodian_status != "ACTIVE" {
        return Err(AppError::Conflict(format!(
            "{} is {}; head office money is only ever held by somebody currently employed",
            request.custodian_employee_id,
            custodian_status.to_lowercase()
        )));
    }
    let custodian_name: String = custodian.try_get("code")?;

    let number = next_document_number(&mut tx, "OF", "OF", request.value_date).await?;
    let fund_id = Uuid::new_v4();

    let intent = PostingIntent {
        posting_date: request.value_date,
        source_kind: "ADVANCE".into(),
        source_id: Some(fund_id.to_string()),
        rule_version: "operating_fund_send/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{number} — dana operasional {} ({custodian_name})",
            request.site_id
        )),
        lines: vec![
            PostingLine::debit(
                "store_manager_receivable",
                &request.site_id,
                request.amount_minor,
            ),
            PostingLine::credit(&request.bank_key, HEAD_OFFICE_SITE_ID, request.amount_minor)
                .with_qualifier(&request.bank_qualifier),
        ],
    };
    let posted = lane_b_post(&mut tx, &intent, None, actor).await?;

    let ledger_entry_id = lane_b_ple_open(
        &mut tx,
        &StoreLedgerItem {
            account_key: "store_manager_receivable".into(),
            qualifier: String::new(),
            site_id: request.site_id.clone(),
            // A store manager holding head office's money is a person, not a
            // place. The party is what a handover moves.
            party_type: "EMPLOYEE".into(),
            party_id: request.custodian_employee_id.clone(),
            party_name: Some(custodian_name),
            voucher_kind: "ADVANCE".into(),
            voucher_id: fund_id.to_string(),
            journal_entry_id: posted.entry_id,
            side: StoreLedgerSide::Receivable,
            amount_minor: request.amount_minor,
            currency: "IDR".into(),
            due_date: request.due_date,
            posting_date: request.value_date,
        },
        actor,
    )
    .await?;

    sqlx::query(
        "INSERT INTO operating_fund
             (fund_id, fund_number, site_id, custodian_employee_id, amount_minor,
              bank_key, bank_qualifier, bank_site_id, payout_bank_name, payout_account_no,
              payout_account_name, status, sent_by, value_date, due_date,
              journal_entry_id, payment_ledger_entry_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'SENT',$12,$13,$14,$15,$16,$17)",
    )
    .bind(fund_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(&request.custodian_employee_id)
    .bind(request.amount_minor)
    .bind(&request.bank_key)
    .bind(&request.bank_qualifier)
    .bind(HEAD_OFFICE_SITE_ID)
    .bind(request.payout_bank_name.trim())
    .bind(request.payout_account_no.trim())
    .bind(request.payout_account_name.trim())
    .bind(actor)
    .bind(request.value_date)
    .bind(request.due_date)
    .bind(posted.entry_id)
    .bind(ledger_entry_id)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(json!({
        "fund_id": fund_id,
        "fund_number": number,
        "status": "SENT",
        "entry_number": posted.entry_number,
        "payment_ledger_entry_id": ledger_entry_id
    }))
}

#[derive(Debug, Deserialize)]
pub struct OpenAllocationRequest {
    pub fund_id: Uuid,
    /// PAYROLL, VENDOR_PAYMENT or STORE_OPERATIONS.
    pub purpose_kind: String,
    /// PAYROLL_RUN, SUPPLIER_INVOICE or APPROVED_PURPOSE.
    pub reference_kind: String,
    pub reference_id: String,
    pub purpose: String,
    pub amount_minor: i64,
}

/// Earmark part of a fund for a purpose.
pub async fn fund_allocation_open(
    pool: &PgPool,
    request: &OpenAllocationRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an earmark for nothing earmarks nothing".into(),
        ));
    }
    let purpose_kind = request.purpose_kind.trim().to_ascii_uppercase();
    let reference_kind = request.reference_kind.trim().to_ascii_uppercase();
    let allocation_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fund_allocation
             (allocation_id, fund_id, purpose_kind, reference_kind, reference_id,
              purpose, amount_minor, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(allocation_id)
    .bind(request.fund_id)
    .bind(&purpose_kind)
    .bind(&reference_kind)
    .bind(request.reference_id.trim())
    .bind(request.purpose.trim())
    .bind(request.amount_minor)
    .bind(actor)
    .execute(pool)
    .await?;
    Ok(json!({ "allocation_id": allocation_id, "purpose_kind": purpose_kind }))
}

#[derive(Debug, Deserialize)]
pub struct SettleFundRequest {
    pub fund_id: Uuid,
    #[serde(default)]
    pub allocation_id: Option<Uuid>,
    /// VENDOR_BILL, PAYROLL, DIRECT_EXPENSE or RETURN.
    pub kind: String,
    #[serde(default)]
    pub reference_id: Option<String>,
    /// Which expense meaning a direct expense lands in.
    #[serde(default)]
    pub expense_key: Option<String>,
    pub amount_minor: i64,
    pub settled_on: NaiveDate,
    #[serde(default)]
    pub proof_file_id: Option<Uuid>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Account for money the custodian has spent, or handed back.
///
///   VENDOR_BILL     Dr trade_payable [dc]         / Cr store_manager_receivable [site]
///   PAYROLL         Dr payroll_payable [site]     / Cr store_manager_receivable [site]
///   DIRECT_EXPENSE  Dr <expense key> [site]       / Cr store_manager_receivable [site]
///   RETURN          Dr bank [dc, qualifier]       / Cr store_manager_receivable [site]
///
/// and `ple_settle` against the fund's open item, so the ageing report and the
/// GL move together rather than being reconciled afterwards.
///
/// PAYROLL debits the payable and never an expense. The wages were recognised
/// when the run was finalised; a second debit here would report the month's
/// salary bill twice, and the two would be indistinguishable on the income
/// statement.
pub async fn fund_settlement_record(
    pool: &PgPool,
    request: &SettleFundRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a settlement of nothing settles nothing".into(),
        ));
    }
    let kind = request.kind.trim().to_ascii_uppercase();
    let mut tx = pool.begin().await?;
    let fund = fund_for_update(&mut tx, request.fund_id).await?;
    let site_id: String = fund.try_get("site_id")?;
    let number: String = fund.try_get("fund_number")?;
    let sent: i64 = fund.try_get("amount_minor")?;
    let settled: i64 = fund.try_get("settled_minor")?;
    let returned: i64 = fund.try_get("returned_minor")?;
    let ledger_entry_id: Option<Uuid> = fund.try_get("payment_ledger_entry_id")?;

    let outstanding = sent - settled - returned;
    if request.amount_minor > outstanding {
        return Err(AppError::Conflict(format!(
            "fund {number} has {outstanding} left to account for; {} would over-account it",
            request.amount_minor
        )));
    }

    let lines = match kind.as_str() {
        "VENDOR_BILL" => vec![
            PostingLine::debit("trade_payable", HEAD_OFFICE_SITE_ID, request.amount_minor),
            PostingLine::credit("store_manager_receivable", &site_id, request.amount_minor),
        ],
        "PAYROLL" => vec![
            PostingLine::debit("payroll_payable", &site_id, request.amount_minor),
            PostingLine::credit("store_manager_receivable", &site_id, request.amount_minor),
        ],
        "DIRECT_EXPENSE" => {
            let key = request.expense_key.as_deref().ok_or_else(|| {
                AppError::Validation("a direct expense has to say which account it lands in".into())
            })?;
            vec![
                PostingLine::debit(key, &site_id, request.amount_minor),
                PostingLine::credit("store_manager_receivable", &site_id, request.amount_minor),
            ]
        }
        "RETURN" => vec![
            PostingLine::debit(
                &fund.try_get::<String, _>("bank_key")?,
                HEAD_OFFICE_SITE_ID,
                request.amount_minor,
            )
            .with_qualifier(&fund.try_get::<String, _>("bank_qualifier")?),
            PostingLine::credit("store_manager_receivable", &site_id, request.amount_minor),
        ],
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not a settlement; it is one of VENDOR_BILL, PAYROLL, \
                 DIRECT_EXPENSE, RETURN"
            )))
        }
    };

    let intent = PostingIntent {
        posting_date: request.settled_on,
        source_kind: "ADVANCE".into(),
        source_id: Some(request.fund_id.to_string()),
        rule_version: "operating_fund_settle/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{number} — {}{}",
            kind.to_lowercase().replace('_', " "),
            request
                .note
                .as_deref()
                .map(|note| format!(" — {note}"))
                .unwrap_or_default()
        )),
        lines,
    };
    // A fund is sent once and accounted for many times — a bill here, a wage
    // there — and every one of those entries carries the fund as its source. So
    // each settlement names itself; keyed on the fund alone, 0140 would read the
    // second receipt as a repeat of the first.
    let settlement_id = Uuid::new_v4();
    let posted = lane_b_post(
        &mut tx,
        &intent,
        Some(&format!(
            "SETTLED_{}",
            settlement_id.simple().to_string().to_uppercase()
        )),
        actor,
    )
    .await?;

    sqlx::query(
        "INSERT INTO fund_settlement
             (settlement_id, fund_id, allocation_id, kind, reference_id, expense_key,
              amount_minor, settled_on, settled_by, journal_entry_id, proof_file_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(settlement_id)
    .bind(request.fund_id)
    .bind(request.allocation_id)
    .bind(&kind)
    .bind(request.reference_id.as_deref())
    .bind(request.expense_key.as_deref())
    .bind(request.amount_minor)
    .bind(request.settled_on)
    .bind(actor)
    .bind(posted.entry_id)
    .bind(request.proof_file_id)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;

    if let Some(entry_id) = ledger_entry_id {
        lane_b_ple_settle(
            &mut tx,
            "FUND_SETTLEMENT",
            &settlement_id.to_string(),
            posted.entry_id,
            request.settled_on,
            &[StoreLedgerAllocation {
                entry_id,
                amount_minor: request.amount_minor,
            }],
            actor,
        )
        .await?;
    }
    tx.commit().await?;

    Ok(json!({
        "settlement_id": settlement_id,
        "kind": kind,
        "entry_number": posted.entry_number,
        "amount_minor": request.amount_minor
    }))
}

async fn fund_for_update(
    tx: &mut Transaction<'_, Postgres>,
    fund_id: Uuid,
) -> Result<sqlx::postgres::PgRow, AppError> {
    sqlx::query("SELECT * FROM operating_fund WHERE fund_id = $1 FOR UPDATE")
        .bind(fund_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("there is no operating fund {fund_id}")))
}

/// One fund's equation: sent = settled payments + direct expenses + returned +
/// outstanding.
pub async fn operating_fund_accountability(
    pool: &PgPool,
    fund_id: Uuid,
) -> Result<FundAccountability, AppError> {
    let row = sqlx::query(
        "SELECT f.amount_minor,
                COALESCE(SUM(s.amount_minor) FILTER
                    (WHERE s.kind IN ('VENDOR_BILL', 'PAYROLL')), 0)::bigint AS payments,
                COALESCE(SUM(s.amount_minor) FILTER
                    (WHERE s.kind = 'DIRECT_EXPENSE'), 0)::bigint AS direct,
                COALESCE(SUM(s.amount_minor) FILTER
                    (WHERE s.kind = 'RETURN'), 0)::bigint AS returned
           FROM operating_fund f
           LEFT JOIN fund_settlement s ON s.fund_id = f.fund_id
          WHERE f.fund_id = $1
          GROUP BY f.amount_minor",
    )
    .bind(fund_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no operating fund {fund_id}")))?;

    Ok(fund_accountability(
        row.try_get("amount_minor")?,
        row.try_get("payments")?,
        row.try_get("direct")?,
        row.try_get("returned")?,
    ))
}

pub async fn operating_fund_list(
    pool: &PgPool,
    site_id: Option<&str>,
    open_only: bool,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT f.fund_id, f.fund_number, f.site_id, f.custodian_employee_id, f.amount_minor,
                f.settled_minor, f.returned_minor, f.status, f.value_date, f.due_date,
                f.bank_key, f.bank_qualifier, f.payout_bank_name, f.payout_account_no,
                f.payout_account_name, f.payment_ledger_entry_id, f.note
           FROM operating_fund f
          WHERE ($1::text IS NULL OR f.site_id = $1)
            AND (NOT $2 OR f.status <> 'CLOSED')
          ORDER BY f.value_date DESC, f.fund_number DESC
          LIMIT $3",
    )
    .bind(site_id)
    .bind(open_only)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let sent: i64 = row.try_get("amount_minor")?;
            let settled: i64 = row.try_get("settled_minor")?;
            let returned: i64 = row.try_get("returned_minor")?;
            Ok(json!({
                "fund_id": row.try_get::<Uuid, _>("fund_id")?,
                "fund_number": row.try_get::<String, _>("fund_number")?,
                "site_id": row.try_get::<String, _>("site_id")?,
                "custodian_employee_id": row.try_get::<String, _>("custodian_employee_id")?,
                "amount_minor": sent,
                "settled_minor": settled,
                "returned_minor": returned,
                "outstanding_minor": sent - settled - returned,
                "status": row.try_get::<String, _>("status")?,
                "value_date": row.try_get::<NaiveDate, _>("value_date")?,
                "due_date": row.try_get::<Option<NaiveDate>, _>("due_date")?,
                "bank_key": row.try_get::<String, _>("bank_key")?,
                "bank_qualifier": row.try_get::<String, _>("bank_qualifier")?,
                // Payout metadata. Never a Bank Account, never a COA account.
                "payout": {
                    "bank_name": row.try_get::<String, _>("payout_bank_name")?,
                    "account_no": row.try_get::<String, _>("payout_account_no")?,
                    "account_name": row.try_get::<String, _>("payout_account_name")?,
                },
                "payment_ledger_entry_id":
                    row.try_get::<Option<Uuid>, _>("payment_ledger_entry_id")?,
                "note": row.try_get::<Option<String>, _>("note")?,
            }))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Paying wages through the manager
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PayoutLineRequest {
    pub employee_id: String,
    pub net_minor: i64,
}

#[derive(Debug, Deserialize)]
pub struct BuildPayoutListRequest {
    pub allocation_id: Uuid,
    pub lines: Vec<PayoutLineRequest>,
}

/// Hand the store manager a list of envelopes.
///
/// Head office states each net figure. Nothing here can derive one, because
/// nothing here has the salary, the tax or the BPJS — see `payroll_payout_task`
/// in 0113 for why those columns are absent rather than hidden.
pub async fn payroll_payout_build(
    pool: &PgPool,
    request: &BuildPayoutListRequest,
    _actor: &str,
) -> Result<Value, AppError> {
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a payout list with nobody on it is not a list".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let allocation = sqlx::query(
        "SELECT reference_id, amount_minor FROM fund_allocation
          WHERE allocation_id = $1 AND purpose_kind = 'PAYROLL' FOR UPDATE",
    )
    .bind(request.allocation_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "there is no payroll allocation {}",
            request.allocation_id
        ))
    })?;
    let run_id: String = allocation.try_get("reference_id")?;
    let earmark: i64 = allocation.try_get("amount_minor")?;

    let total: i64 = request.lines.iter().map(|line| line.net_minor).sum();
    if total > earmark {
        return Err(AppError::Conflict(format!(
            "this list comes to {total} and the allocation carries {earmark}; the shop would be \
             short before the last envelope"
        )));
    }

    let mut created = 0;
    for line in &request.lines {
        if line.net_minor <= 0 {
            return Err(AppError::Validation(format!(
                "{} is down for nothing; an envelope with no money in it is not a payment",
                line.employee_id
            )));
        }
        sqlx::query(
            "INSERT INTO payroll_payout_task
                 (task_id, allocation_id, run_id, employee_id, net_minor)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (allocation_id, employee_id) DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(request.allocation_id)
        .bind(&run_id)
        .bind(&line.employee_id)
        .bind(line.net_minor)
        .execute(&mut *tx)
        .await?;
        created += 1;
    }
    tx.commit().await?;
    Ok(
        json!({ "allocation_id": request.allocation_id, "run_id": run_id,
               "tasks": created, "total_minor": total }),
    )
}

/// What the manager sees.
///
/// Name, amount, whether it has been handed over. There is nothing else to
/// select: the columns for gross, tax, BPJS and deductions do not exist on this
/// table.
pub async fn payroll_payout_list(
    pool: &PgPool,
    allocation_id: Uuid,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT t.task_id, t.employee_id, e.code AS employee_code, t.net_minor, t.currency,
                t.status, t.paid_by, t.paid_at, t.proof_file_id, t.fail_reason
           FROM payroll_payout_task t
           JOIN employee e ON e.id = t.employee_id
          WHERE t.allocation_id = $1
          ORDER BY e.code",
    )
    .bind(allocation_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(json!({
                "task_id": row.try_get::<Uuid, _>("task_id")?,
                "employee_id": row.try_get::<String, _>("employee_id")?,
                "employee_code": row.try_get::<String, _>("employee_code")?,
                "net_minor": row.try_get::<i64, _>("net_minor")?,
                "currency": row.try_get::<String, _>("currency")?,
                "status": row.try_get::<String, _>("status")?,
                "paid_by": row.try_get::<Option<String>, _>("paid_by")?,
                "paid_at": row.try_get::<Option<DateTime<Utc>>, _>("paid_at")?,
                "proof_file_id": row.try_get::<Option<Uuid>, _>("proof_file_id")?,
                "fail_reason": row.try_get::<Option<String>, _>("fail_reason")?,
            }))
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct PayEmployeeRequest {
    pub paid_on: NaiveDate,
    /// The signature, or the photograph of it.
    #[serde(default)]
    pub proof_file_id: Option<Uuid>,
}

/// The manager hands over one envelope.
///
///   Dr payroll_payable [site] / Cr store_manager_receivable [site]
///
/// and never a second salary expense. The wage was recognised when payroll was
/// finalised; this discharges the payable and reduces what the manager is
/// holding, and that is the whole entry.
pub async fn payroll_payout_pay(
    pool: &PgPool,
    task_id: Uuid,
    request: &PayEmployeeRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let task = sqlx::query(
        "SELECT t.task_id, t.allocation_id, t.employee_id, t.net_minor, t.status,
                a.fund_id
           FROM payroll_payout_task t
           JOIN fund_allocation a ON a.allocation_id = t.allocation_id
          WHERE t.task_id = $1 FOR UPDATE OF t",
    )
    .bind(task_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("there is no payout task {task_id}")))?;

    let status: String = task.try_get("status")?;
    if status == "PAID" {
        return Err(AppError::Conflict(
            "this envelope has already been handed over".into(),
        ));
    }
    let fund_id: Uuid = task.try_get("fund_id")?;
    let allocation_id: Uuid = task.try_get("allocation_id")?;
    let employee_id: String = task.try_get("employee_id")?;
    let net: i64 = task.try_get("net_minor")?;
    tx.commit().await?;

    let settled = fund_settlement_record(
        pool,
        &SettleFundRequest {
            fund_id,
            allocation_id: Some(allocation_id),
            kind: "PAYROLL".into(),
            reference_id: Some(employee_id.clone()),
            expense_key: None,
            amount_minor: net,
            settled_on: request.paid_on,
            proof_file_id: request.proof_file_id,
            note: Some(format!("gaji {employee_id}")),
        },
        actor,
    )
    .await?;

    let settlement_id = settled
        .get("settlement_id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());

    sqlx::query(
        "UPDATE payroll_payout_task
            SET status='PAID', paid_by=$2, paid_at=now(),
                proof_file_id=COALESCE($3, proof_file_id), settlement_id=$4
          WHERE task_id=$1",
    )
    .bind(task_id)
    .bind(actor)
    .bind(request.proof_file_id)
    .bind(settlement_id)
    .execute(pool)
    .await?;

    Ok(
        json!({ "task_id": task_id, "status": "PAID", "net_minor": net,
               "settlement": settled }),
    )
}

// ---------------------------------------------------------------------------
// Handing the float on
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PrepareHandoverRequest {
    pub site_id: String,
    pub from_employee_id: String,
    pub to_employee_id: String,
    pub handover_date: NaiveDate,
    #[serde(default)]
    pub note: Option<String>,
}

/// Draw up the handover: which funds, how much, and what it comes to.
///
/// The amount is taken from the outgoing custodian's open funds rather than
/// typed, so a handover cannot quietly move a different number from the one the
/// books hold.
pub async fn custodian_handover_prepare(
    pool: &PgPool,
    request: &PrepareHandoverRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.from_employee_id == request.to_employee_id {
        return Err(AppError::Validation(
            "a float does not hand over to the person already holding it".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    site_exists(&mut tx, &request.site_id).await?;

    let funds = sqlx::query(
        "SELECT fund_id, fund_number,
                (amount_minor - settled_minor - returned_minor)::bigint AS outstanding
           FROM operating_fund
          WHERE site_id = $1 AND custodian_employee_id = $2 AND status <> 'CLOSED'
          ORDER BY value_date, fund_number
            FOR UPDATE",
    )
    .bind(&request.site_id)
    .bind(&request.from_employee_id)
    .fetch_all(&mut *tx)
    .await?;

    let mut total = 0_i64;
    let mut items = Vec::new();
    for fund in &funds {
        let outstanding: i64 = fund.try_get("outstanding")?;
        if outstanding <= 0 {
            continue;
        }
        total += outstanding;
        items.push((fund.try_get::<Uuid, _>("fund_id")?, outstanding));
    }
    if total == 0 {
        return Err(AppError::Conflict(format!(
            "{} is holding nothing at {}; there is no float to hand over",
            request.from_employee_id, request.site_id
        )));
    }

    let number = next_document_number(&mut tx, "HO", "HO", request.handover_date).await?;
    let handover_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO custodian_handover
             (handover_id, handover_number, site_id, from_employee_id, to_employee_id,
              amount_minor, handover_date, prepared_by, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(handover_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(&request.from_employee_id)
    .bind(&request.to_employee_id)
    .bind(total)
    .bind(request.handover_date)
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    for (fund_id, amount) in &items {
        sqlx::query(
            "INSERT INTO custodian_handover_item (handover_id, fund_id, amount_minor)
             VALUES ($1,$2,$3)",
        )
        .bind(handover_id)
        .bind(fund_id)
        .bind(amount)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(
        json!({ "handover_id": handover_id, "handover_number": number,
               "amount_minor": total, "funds": items.len(), "status": "DRAFT" }),
    )
}

#[derive(Debug, Deserialize)]
pub struct SignHandoverRequest {
    /// FROM or TO — which of the two is signing.
    pub side: String,
}

/// One of the two signs. When both have, the float changes hands.
///
/// The general ledger account does not move: it is `1011102002` at that shop
/// either way, so the entry debits and credits it and carries both names. What
/// moves is the payment ledger party — the outgoing custodian's items are
/// settled and the same total is opened against the incoming one, in the same
/// transaction, against the same entry. The balance never silently changes
/// name and the GL balance never moves.
pub async fn custodian_handover_sign(
    pool: &PgPool,
    handover_id: Uuid,
    request: &SignHandoverRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let side = request.side.trim().to_ascii_uppercase();
    if !matches!(side.as_str(), "FROM" | "TO") {
        return Err(AppError::Validation(
            "a handover is signed by the FROM side or the TO side".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let row = sqlx::query("SELECT * FROM custodian_handover WHERE handover_id = $1 FOR UPDATE")
        .bind(handover_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("there is no handover {handover_id}")))?;
    let status: String = row.try_get("status")?;
    if status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "this handover is {}",
            status.to_lowercase()
        )));
    }

    // Whether this signature completes the pair, decided BEFORE anything is
    // written.
    //
    // The row constraint is `(status = 'SIGNED') = (both stamps are set)`, and
    // it is checked per statement — so an UPDATE that set the second signature
    // and left the status alone would be refused by the database at the moment
    // it was half true. The signature and the status therefore go in one
    // statement, which means the entry has to exist first.
    let other_signed: bool = if side == "FROM" {
        row.try_get::<Option<DateTime<Utc>>, _>("to_signed_at")?
            .is_some()
    } else {
        row.try_get::<Option<DateTime<Utc>>, _>("from_signed_at")?
            .is_some()
    };

    if !other_signed {
        let column = if side == "FROM" {
            "UPDATE custodian_handover SET from_signed_by=$2, from_signed_at=now()
              WHERE handover_id=$1"
        } else {
            "UPDATE custodian_handover SET to_signed_by=$2, to_signed_at=now()
              WHERE handover_id=$1"
        };
        sqlx::query(column)
            .bind(handover_id)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(json!({ "handover_id": handover_id, "status": "DRAFT",
                          "signed": side, "posted": false }));
    }

    let site_id: String = row.try_get("site_id")?;
    let from_employee: String = row.try_get("from_employee_id")?;
    let to_employee: String = row.try_get("to_employee_id")?;
    let amount: i64 = row.try_get("amount_minor")?;
    let number: String = row.try_get("handover_number")?;
    let handover_date: NaiveDate = row.try_get("handover_date")?;

    let mut debit = PostingLine::debit("store_manager_receivable", &site_id, amount);
    debit.memo = Some(format!("diterima {to_employee}"));
    let mut credit = PostingLine::credit("store_manager_receivable", &site_id, amount);
    credit.memo = Some(format!("diserahkan {from_employee}"));

    let intent = PostingIntent {
        posting_date: handover_date,
        // A reclassification within one account: the money has not moved, the
        // person responsible for it has.
        source_kind: "RECLASS".into(),
        source_id: Some(handover_id.to_string()),
        rule_version: "custodian_handover/1".into(),
        currency: row.try_get::<String, _>("currency")?,
        memo: Some(format!(
            "{number} — serah terima kas kepala toko {from_employee} → {to_employee}"
        )),
        lines: vec![debit, credit],
    };
    let posted = lane_b_post(&mut tx, &intent, None, actor).await?;

    // The funds move person, and each keeps its own age: an ageing report that
    // restarted the clock at handover would make an eight-month-old float look
    // like this week's.
    let items = sqlx::query(
        "SELECT i.fund_id, i.amount_minor, f.payment_ledger_entry_id, f.fund_number, f.value_date,
                f.due_date
           FROM custodian_handover_item i
           JOIN operating_fund f ON f.fund_id = i.fund_id
          WHERE i.handover_id = $1",
    )
    .bind(handover_id)
    .fetch_all(&mut *tx)
    .await?;

    let to_name: String = sqlx::query("SELECT code FROM employee WHERE id = $1")
        .bind(&to_employee)
        .fetch_optional(&mut *tx)
        .await?
        .map(|row| row.try_get("code"))
        .transpose()?
        .unwrap_or_else(|| to_employee.clone());

    for item in &items {
        let amount_minor: i64 = item.try_get("amount_minor")?;
        let fund_id: Uuid = item.try_get("fund_id")?;
        if let Some(entry_id) = item.try_get::<Option<Uuid>, _>("payment_ledger_entry_id")? {
            lane_b_ple_settle(
                &mut tx,
                "HANDOVER",
                &handover_id.to_string(),
                posted.entry_id,
                handover_date,
                &[StoreLedgerAllocation {
                    entry_id,
                    amount_minor,
                }],
                actor,
            )
            .await?;
        }
        let reopened = lane_b_ple_open(
            &mut tx,
            &StoreLedgerItem {
                account_key: "store_manager_receivable".into(),
                qualifier: String::new(),
                site_id: site_id.clone(),
                party_type: "EMPLOYEE".into(),
                party_id: to_employee.clone(),
                party_name: Some(to_name.clone()),
                voucher_kind: "ADVANCE".into(),
                voucher_id: fund_id.to_string(),
                journal_entry_id: posted.entry_id,
                side: StoreLedgerSide::Receivable,
                amount_minor,
                currency: "IDR".into(),
                due_date: item.try_get("due_date")?,
                // The original date, not today's. This is what keeps the age.
                posting_date: item.try_get("value_date")?,
            },
            actor,
        )
        .await?;
        sqlx::query(
            "UPDATE operating_fund
                SET custodian_employee_id = $2, payment_ledger_entry_id = $3
              WHERE fund_id = $1",
        )
        .bind(fund_id)
        .bind(&to_employee)
        .bind(reopened)
        .execute(&mut *tx)
        .await?;
    }

    // The second signature, the status and the entry, in one statement — see
    // the note above about the row constraint.
    let complete = if side == "FROM" {
        "UPDATE custodian_handover
            SET from_signed_by=$2, from_signed_at=now(), status='SIGNED',
                journal_entry_id=$3
          WHERE handover_id=$1"
    } else {
        "UPDATE custodian_handover
            SET to_signed_by=$2, to_signed_at=now(), status='SIGNED',
                journal_entry_id=$3
          WHERE handover_id=$1"
    };
    sqlx::query(complete)
        .bind(handover_id)
        .bind(actor)
        .bind(posted.entry_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(
        json!({ "handover_id": handover_id, "status": "SIGNED", "posted": true,
               "entry_number": posted.entry_number, "amount_minor": amount,
               "funds_moved": items.len() }),
    )
}

pub async fn custodian_handover_list(
    pool: &PgPool,
    site_id: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT handover_id, handover_number, site_id, from_employee_id, to_employee_id,
                amount_minor, handover_date, status, from_signed_by, from_signed_at,
                to_signed_by, to_signed_at, journal_entry_id, note
           FROM custodian_handover
          WHERE ($1::text IS NULL OR site_id = $1)
          ORDER BY handover_date DESC, handover_number DESC
          LIMIT $2",
    )
    .bind(site_id)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(json!({
                "handover_id": row.try_get::<Uuid, _>("handover_id")?,
                "handover_number": row.try_get::<String, _>("handover_number")?,
                "site_id": row.try_get::<String, _>("site_id")?,
                "from_employee_id": row.try_get::<String, _>("from_employee_id")?,
                "to_employee_id": row.try_get::<String, _>("to_employee_id")?,
                "amount_minor": row.try_get::<i64, _>("amount_minor")?,
                "handover_date": row.try_get::<NaiveDate, _>("handover_date")?,
                "status": row.try_get::<String, _>("status")?,
                "from_signed_by": row.try_get::<Option<String>, _>("from_signed_by")?,
                "to_signed_by": row.try_get::<Option<String>, _>("to_signed_by")?,
                "note": row.try_get::<Option<String>, _>("note")?,
            }))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// What a shop spends
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ClaimExpenseRequest {
    pub site_id: String,
    /// PETTY_CASH or FUND_ALLOCATION. Anything else is refused by name.
    pub source: String,
    #[serde(default)]
    pub allocation_id: Option<Uuid>,
    pub category: String,
    pub amount_minor: i64,
    pub spent_on: NaiveDate,
    pub vendor: String,
    /// The receipt, photographed at the counter. The document starts here.
    #[serde(default)]
    pub photo_file_id: Option<Uuid>,
    #[serde(default)]
    pub memo: Option<String>,
}

/// A shop records what it spent.
///
/// The photograph comes first: `photo_file_id` is uploaded through
/// `/api/v1/files` before this is called, and a claim without one is accepted
/// but flagged, because a receipt that is in somebody's apron and not in the
/// system is a receipt that will not be there at the end of the month.
///
/// The drawer and the takings are refused here, by name, with somewhere to go.
pub async fn store_expense_claim(
    pool: &PgPool,
    request: &ClaimExpenseRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let source = request.source.trim().to_ascii_uppercase();
    match source.as_str() {
        "PETTY_CASH" | "FUND_ALLOCATION" => {}
        "DRAWER" | "TILL" | "CASH_DRAWER" | "CASH_SHIFT" => {
            return Err(AppError::Validation(
                "a shop does not pay for things out of the till. The drawer holds customers' \
                 money and head office's; use petty cash, or ask head office for an operating \
                 fund. If the money has already gone, record it as an unapproved payout on the \
                 shift so the variance can be explained."
                    .into(),
            ))
        }
        "SALES_PROCEEDS" | "TAKINGS" => {
            return Err(AppError::Validation(
                "sales proceeds are head office's money in this shop's custody and cannot be \
                 spent. They are reconciled and then disposed of under a remittance order — bank \
                 them, or ask head office to issue an order naming this payee. Use petty cash or \
                 an operating fund for a shop expense."
                    .into(),
            ))
        }
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not a pot a shop may spend from; it is PETTY_CASH or \
                 FUND_ALLOCATION"
            )))
        }
    }
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an expense of nothing is not an expense".into(),
        ));
    }
    if (source == "FUND_ALLOCATION") != request.allocation_id.is_some() {
        return Err(AppError::Validation(
            "an expense drawn on a fund names the allocation it comes out of, and one drawn on \
             petty cash names none"
                .into(),
        ));
    }

    let mut tx = pool.begin().await?;
    site_exists(&mut tx, &request.site_id).await?;
    let number = next_document_number(
        &mut tx,
        &format!("KK:{}", request.site_id),
        &format!("KK-{}", request.site_id.to_uppercase()),
        request.spent_on,
    )
    .await?;
    let expense_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO store_expense
             (expense_id, expense_number, site_id, source, allocation_id, category,
              amount_minor, spent_on, vendor, memo, photo_file_id, status, claimed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12)",
    )
    .bind(expense_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(&source)
    .bind(request.allocation_id)
    .bind(request.category.trim())
    .bind(request.amount_minor)
    .bind(request.spent_on)
    .bind(request.vendor.trim())
    .bind(request.memo.as_deref())
    .bind(request.photo_file_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(json!({
        "expense_id": expense_id,
        "expense_number": number,
        "status": "DRAFT",
        "needs": approval_level_for(request.amount_minor).as_str(),
        "receipt_attached": request.photo_file_id.is_some(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct ApproveExpenseRequest {
    /// Which rung the approver holds: SUPERVISOR or ADMIN.
    pub approver_level: String,
    #[serde(default)]
    pub posting_date: Option<NaiveDate>,
}

/// Approve an expense and put it in the books.
///
///   Dr <the category's meaning> [site]
///   Cr petty_cash [site]                    from the imprest
///   Cr store_manager_receivable [site]      from a fund
///
/// A fund expense also settles the manager's payment ledger item, through the
/// same `DIRECT_EXPENSE` settlement any other direct cost uses — one document,
/// one transaction, and the fund equation stays closed.
pub async fn store_expense_approve(
    pool: &PgPool,
    expense_id: Uuid,
    request: &ApproveExpenseRequest,
    actor: &str,
) -> Result<Value, AppError> {
    let level = match request.approver_level.trim().to_ascii_uppercase().as_str() {
        "SUPERVISOR" => ApprovalLevel::Supervisor,
        "ADMIN" => ApprovalLevel::Admin,
        other => {
            return Err(AppError::Validation(format!(
                "'{other}' is not an approval rung; it is SUPERVISOR or ADMIN"
            )))
        }
    };

    let mut tx = pool.begin().await?;
    let row = sqlx::query("SELECT * FROM store_expense WHERE expense_id = $1 FOR UPDATE")
        .bind(expense_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("there is no expense {expense_id}")))?;

    let status: String = row.try_get("status")?;
    let number: String = row.try_get("expense_number")?;
    if status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "{number} is {}, not waiting for approval",
            status.to_lowercase()
        )));
    }
    let claimed_by: String = row.try_get("claimed_by")?;
    if claimed_by == actor {
        return Err(AppError::Forbidden(
            "the person who claimed an expense does not approve it. Ask somebody else at this \
             shop, or head office."
                .into(),
        ));
    }
    let amount: i64 = row.try_get("amount_minor")?;
    if !approval_is_sufficient(level, amount) {
        return Err(AppError::Forbidden(format!(
            "{number} is {amount} and a store manager may approve up to {}. This one needs head \
             office finance.",
            crate::cloud::domain::STORE_EXPENSE_MANAGER_LIMIT_MINOR
        )));
    }

    let site_id: String = row.try_get("site_id")?;
    let source: String = row.try_get("source")?;
    let category: String = row.try_get("category")?;
    let spent_on: NaiveDate = row.try_get("spent_on")?;
    let allocation_id: Option<Uuid> = row.try_get("allocation_id")?;
    let vendor: String = row.try_get("vendor")?;
    let posting_date = request.posting_date.unwrap_or(spent_on);

    let credit_key = if source == "PETTY_CASH" {
        "petty_cash"
    } else {
        "store_manager_receivable"
    };
    let intent = PostingIntent {
        posting_date,
        source_kind: "STORE_EXPENSE".into(),
        source_id: Some(expense_id.to_string()),
        rule_version: "store_expense/1".into(),
        currency: row.try_get::<String, _>("currency")?,
        memo: Some(format!("{number} — {vendor}")),
        lines: vec![
            PostingLine::debit(&category, &site_id, amount),
            PostingLine::credit(credit_key, &site_id, amount),
        ],
    };
    let posted = lane_b_post(&mut tx, &intent, None, actor).await?;

    sqlx::query(
        "UPDATE store_expense
            SET status='POSTED', approved_by=$2, approved_at=now(), approved_role=$3,
                journal_entry_id=$4, posted_at=now()
          WHERE expense_id=$1",
    )
    .bind(expense_id)
    .bind(actor)
    .bind(level.as_str())
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;

    // A fund expense is an accounting against the fund, so it reduces what the
    // manager owes an explanation for. Recorded here, in the same transaction
    // as the entry that made it true.
    if let Some(allocation_id) = allocation_id {
        let fund_id: Uuid =
            sqlx::query("SELECT fund_id FROM fund_allocation WHERE allocation_id = $1")
                .bind(allocation_id)
                .fetch_one(&mut *tx)
                .await?
                .try_get("fund_id")?;
        let settlement_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO fund_settlement
                 (settlement_id, fund_id, allocation_id, kind, reference_id, expense_key,
                  amount_minor, settled_on, settled_by, journal_entry_id, proof_file_id, note)
             VALUES ($1,$2,$3,'DIRECT_EXPENSE',$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(settlement_id)
        .bind(fund_id)
        .bind(allocation_id)
        .bind(expense_id.to_string())
        .bind(&category)
        .bind(amount)
        .bind(posting_date)
        .bind(actor)
        .bind(posted.entry_id)
        .bind(row.try_get::<Option<Uuid>, _>("photo_file_id")?)
        .bind(format!("{number} — {vendor}"))
        .execute(&mut *tx)
        .await?;

        let ledger_entry_id: Option<Uuid> =
            sqlx::query("SELECT payment_ledger_entry_id FROM operating_fund WHERE fund_id = $1")
                .bind(fund_id)
                .fetch_one(&mut *tx)
                .await?
                .try_get("payment_ledger_entry_id")?;
        if let Some(entry_id) = ledger_entry_id {
            lane_b_ple_settle(
                &mut tx,
                "FUND_SETTLEMENT",
                &settlement_id.to_string(),
                posted.entry_id,
                posting_date,
                &[StoreLedgerAllocation {
                    entry_id,
                    amount_minor: amount,
                }],
                actor,
            )
            .await?;
        }
    }
    tx.commit().await?;

    Ok(
        json!({ "expense_id": expense_id, "expense_number": number, "status": "POSTED",
               "entry_number": posted.entry_number, "approved_role": level.as_str() }),
    )
}

#[derive(Debug, Deserialize)]
pub struct RejectExpenseRequest {
    pub reason: String,
}

pub async fn store_expense_reject(
    pool: &PgPool,
    expense_id: Uuid,
    request: &RejectExpenseRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "refusing an expense needs a reason; the shop has to be able to answer it".into(),
        ));
    }
    let affected = sqlx::query(
        "UPDATE store_expense
            SET status='REJECTED', rejected_by=$2, rejected_at=now(), reject_reason=$3
          WHERE expense_id=$1 AND status='DRAFT'",
    )
    .bind(expense_id)
    .bind(actor)
    .bind(request.reason.trim())
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::Conflict(
            "this expense is not waiting for a decision".into(),
        ));
    }
    Ok(json!({ "expense_id": expense_id, "status": "REJECTED" }))
}

pub async fn store_expense_list(
    pool: &PgPool,
    site_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let rows = sqlx::query(
        "SELECT expense_id, expense_number, site_id, source, allocation_id, category,
                amount_minor, currency, spent_on, vendor, memo, photo_file_id, status,
                claimed_by, claimed_at, approved_by, approved_role, reject_reason
           FROM store_expense
          WHERE ($1::text IS NULL OR site_id = $1)
            AND ($2::text IS NULL OR status = $2)
          ORDER BY spent_on DESC, expense_number DESC
          LIMIT $3",
    )
    .bind(site_id)
    .bind(status)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            let amount: i64 = row.try_get("amount_minor")?;
            Ok(json!({
                "expense_id": row.try_get::<Uuid, _>("expense_id")?,
                "expense_number": row.try_get::<String, _>("expense_number")?,
                "site_id": row.try_get::<String, _>("site_id")?,
                "source": row.try_get::<String, _>("source")?,
                "allocation_id": row.try_get::<Option<Uuid>, _>("allocation_id")?,
                "category": row.try_get::<String, _>("category")?,
                "amount_minor": amount,
                "currency": row.try_get::<String, _>("currency")?,
                "spent_on": row.try_get::<NaiveDate, _>("spent_on")?,
                "vendor": row.try_get::<String, _>("vendor")?,
                "memo": row.try_get::<Option<String>, _>("memo")?,
                "photo_file_id": row.try_get::<Option<Uuid>, _>("photo_file_id")?,
                "status": row.try_get::<String, _>("status")?,
                "claimed_by": row.try_get::<String, _>("claimed_by")?,
                "claimed_at": row.try_get::<DateTime<Utc>, _>("claimed_at")?,
                "approved_by": row.try_get::<Option<String>, _>("approved_by")?,
                "approved_role": row.try_get::<Option<String>, _>("approved_role")?,
                "reject_reason": row.try_get::<Option<String>, _>("reject_reason")?,
                "needs": approval_level_for(amount).as_str(),
            }))
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct ReplenishRequest {
    pub site_id: String,
    pub amount_minor: i64,
    pub replenish_date: NaiveDate,
    pub bank_key: String,
    pub bank_qualifier: String,
    #[serde(default)]
    pub covers_from: Option<NaiveDate>,
    #[serde(default)]
    pub covers_to: Option<NaiveDate>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Head office puts the imprest back.
///
///   Dr petty_cash [site] / Cr bank [dc, qualifier]
///
/// Not an expense: the expenses were posted one per receipt. Cross-site, and
/// the affiliate legs are the poster's job.
pub async fn petty_cash_replenish(
    pool: &PgPool,
    request: &ReplenishRequest,
    actor: &str,
) -> Result<Value, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a replenishment of nothing replenishes nothing".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    site_exists(&mut tx, &request.site_id).await?;
    let number = next_document_number(&mut tx, "RPL", "KK-RPL", request.replenish_date).await?;
    let replenishment_id = Uuid::new_v4();

    let intent = PostingIntent {
        posting_date: request.replenish_date,
        source_kind: "PETTY_REPLENISH".into(),
        source_id: Some(replenishment_id.to_string()),
        rule_version: "petty_cash_replenish/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{number} — pengisian kas kecil {}",
            request.site_id
        )),
        lines: vec![
            PostingLine::debit("petty_cash", &request.site_id, request.amount_minor),
            PostingLine::credit(&request.bank_key, HEAD_OFFICE_SITE_ID, request.amount_minor)
                .with_qualifier(&request.bank_qualifier),
        ],
    };
    let posted = lane_b_post(&mut tx, &intent, None, actor).await?;
    sqlx::query(
        "INSERT INTO petty_cash_replenishment
             (replenishment_id, replenishment_number, site_id, amount_minor, bank_key,
              bank_qualifier, replenish_date, covers_from, covers_to, issued_by,
              journal_entry_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(replenishment_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(request.amount_minor)
    .bind(&request.bank_key)
    .bind(&request.bank_qualifier)
    .bind(request.replenish_date)
    .bind(request.covers_from)
    .bind(request.covers_to)
    .bind(actor)
    .bind(posted.entry_id)
    .bind(request.note.as_deref())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(
        json!({ "replenishment_id": replenishment_id, "replenishment_number": number,
               "entry_number": posted.entry_number }),
    )
}

// ---------------------------------------------------------------------------
// Where a shop's money is
// ---------------------------------------------------------------------------

/// Everything a shop is holding, grouped the way the architecture separates it.
///
/// Two groups, and the split is the point.
///
/// **Physical and purpose** — where the money is and what it is for: the
/// cashier float in the drawers, cash on hand, petty cash. These are asset
/// balances at this location and they add up to what is in the building.
///
/// **Origin and responsibility** — whose money it is and who has to account for
/// it: proceeds awaiting remittance, operating funds outstanding, cash in
/// transit. These do NOT add up to anything in the building; two of them are
/// not even at the shop.
///
/// A single "cash position" number that mixed the two would be the report that
/// makes a manager think the float is theirs to spend, which is the confusion
/// this whole lane exists to end.
pub async fn store_cash_position(
    pool: &PgPool,
    site_id: &str,
    as_of: Option<NaiveDate>,
) -> Result<Value, AppError> {
    let when = as_of;

    // The asset balances, from the ledger, so the position and the trial
    // balance cannot disagree.
    let balances = sqlx::query(
        "SELECT m.semantic_key, COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS balance
           FROM account_map m
           LEFT JOIN journal_line l
                  ON l.account_code = m.account_code
           LEFT JOIN journal_entry e
                  ON e.entry_id = l.entry_id
                 AND ($2::date IS NULL OR e.posting_date <= $2)
          WHERE m.site_id = $1
            AND m.semantic_key IN ('cash', 'petty_cash', 'cashier_float', 'cash_in_transit')
          GROUP BY m.semantic_key",
    )
    .bind(site_id)
    .bind(when)
    .fetch_all(pool)
    .await?;

    let mut cash = 0_i64;
    let mut petty = 0_i64;
    let mut float = 0_i64;
    let mut in_transit = 0_i64;
    for row in &balances {
        let key: String = row.try_get("semantic_key")?;
        let balance: i64 = row.try_get("balance")?;
        match key.as_str() {
            "cash" => cash = balance,
            "petty_cash" => petty = balance,
            "cashier_float" => float = balance,
            "cash_in_transit" => in_transit = balance,
            _ => {}
        }
    }

    // What head office has ordered and nobody has carried out yet: the shop is
    // holding proceeds it has been told what to do with.
    let ordered = sqlx::query(
        "SELECT COALESCE(SUM(l.amount_minor) - COALESCE((
                    SELECT SUM(e.amount_minor) FROM remittance_order_execution e
                     WHERE e.line_id IN (SELECT l2.line_id FROM remittance_order_line l2
                                          JOIN remittance_order o2 ON o2.order_id = l2.order_id
                                         WHERE o2.site_id = $1 AND o2.status = 'ISSUED')), 0), 0)
                ::bigint AS unexecuted
           FROM remittance_order_line l
           JOIN remittance_order o ON o.order_id = l.order_id
          WHERE o.site_id = $1 AND o.status = 'ISSUED'",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await?;
    let awaiting_remittance: i64 = ordered
        .try_get::<Option<i64>, _>("unexecuted")?
        .unwrap_or(0);

    let funds = sqlx::query(
        "SELECT COALESCE(SUM(amount_minor - settled_minor - returned_minor), 0)::bigint AS open
           FROM operating_fund WHERE site_id = $1 AND status <> 'CLOSED'",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await?;
    let funds_outstanding: i64 = funds.try_get("open")?;

    // The same number the payment ledger holds. Shown beside the funds figure
    // rather than instead of it: if the two disagree, that is the thing worth
    // knowing, and a position that showed only one of them would hide it.
    let ledger_outstanding =
        store_ledger_outstanding(pool, "store_manager_receivable", Some(site_id)).await?;

    let unapproved = sqlx::query(
        "SELECT COUNT(*)::bigint AS n,
                COALESCE(SUM(variance_minor), 0)::bigint AS total
           FROM cash_shift
          WHERE site_id = $1 AND status = 'CLOSED'
            AND variance_minor IS NOT NULL AND variance_minor <> 0 AND approved_at IS NULL",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await?;

    Ok(json!({
        "site_id": site_id,
        "as_of": when,
        // Where the money is, and what it is for.
        "physical": {
            "cashier_float_minor": float,
            "cash_on_hand_minor": cash,
            "petty_cash_minor": petty,
            "total_in_the_building_minor": float + cash + petty,
        },
        // Whose it is, and who has to account for it. Deliberately not summed
        // with the group above: two of these are not at the shop at all.
        "responsibility": {
            "sales_proceeds_awaiting_remittance_minor": awaiting_remittance,
            "operating_funds_outstanding_minor": funds_outstanding,
            "payment_ledger_outstanding_minor": ledger_outstanding,
            "cash_in_transit_minor": in_transit,
        },
        "attention": {
            "unapproved_variances": unapproved.try_get::<i64, _>("n")?,
            "unapproved_variance_minor": unapproved.try_get::<i64, _>("total")?,
            // A disagreement between the funds table and the payment ledger is
            // a fact worth putting on the screen rather than a number to pick
            // between.
            "fund_ledger_disagrees": funds_outstanding != ledger_outstanding,
        }
    }))
}
