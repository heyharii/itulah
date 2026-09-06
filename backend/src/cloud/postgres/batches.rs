//! Paying many people with one instruction, and finishing what a run started.
//!
//! # A batch holds no accounting
//!
//! Every executed item is one ordinary PAY — a cash document, numbered
//! `KK-YY-MM-NNNNN`, posted through the same poster as every other. There is no
//! batch journal entry, no batch posting rule, and no entry anywhere names a
//! batch. `total_minor` is a checksum a person reads before authorising, and
//! the database restates it from the items so it cannot drift.
//!
//! That constraint is the whole design. Once a batch could post, the second
//! pattern would want to post differently, and "one money-execution layer with
//! three primitives" would have become four.
//!
//! # Executing is resumable because failing halfway is normal
//!
//! Twenty transfers to twenty banks fail one at a time: a rejected account,
//! details being chased, a laptop that dies at line nine. So each item carries
//! its own status, the batch's status is derived, and
//! [`payment_batch_execute_remaining`] picks up whatever is still PENDING. An
//! EXECUTED item is never touched again — that is what makes running it twice
//! safe rather than double payment, and the database enforces it as well as
//! this module does.
//!
//! # One item, one transaction
//!
//! Each item commits on its own. Wrapping twenty in one transaction would mean
//! a failure at line nineteen rolls back eighteen payments that the bank has
//! already been told about, which is the one thing worse than a partial batch.
//! The event log in 0154 is what makes the partial state readable afterwards.

use super::destinations::payment_destination_snapshot_take;
use super::payment_execution::{
    payment_execution_document_number, payment_execution_pay, PayInstruction,
};
use crate::cloud::application::AppError;
use crate::cloud::domain::UnverifiedDestinationPolicy;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// What a caller says
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentBatchItemInput {
    pub party_type: String,
    pub party_id: String,
    pub party_name: String,
    /// The account to pay. May be absent: a row for somebody with nothing on
    /// file has to EXIST, or the unverified-destination policy has nothing to
    /// act on and that person is silently missing from the run.
    pub destination_id: Option<Uuid>,
    pub amount_minor: i64,
    pub obligation_kind: Option<String>,
    pub obligation_id: Option<String>,
    /// What the recipient will recognise on their statement.
    pub obligation_reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePaymentBatchRequest {
    /// `PAYROLL_RUN`, `SUPPLIER_BILLS`, `FUND_ALLOCATION`, `AD_HOC`.
    pub source_kind: String,
    pub source_id: Option<String>,
    /// The company money account this pays from, named by meaning.
    pub from_key: String,
    #[serde(default)]
    pub from_qualifier: String,
    pub site_id: String,
    /// What the money answers, on the other side of every entry. A meaning, or
    /// an account code — never both.
    pub counter_key: Option<String>,
    #[serde(default)]
    pub counter_qualifier: String,
    pub counter_account_code: Option<String>,
    /// `BANK_TRANSFER`, `CASH` or `GIRO`.
    pub method: String,
    pub doc_date: NaiveDate,
    /// `SKIP` or `HOLD`. Required: a default here would be a policy nobody
    /// chose that everybody inherits.
    pub unverified_policy: String,
    /// Why that policy. Also required, for the same reason.
    pub unverified_policy_reason: String,
    pub memo: String,
    pub items: Vec<PaymentBatchItemInput>,
}

// ---------------------------------------------------------------------------
// What a screen reads
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentBatchRow {
    pub batch_id: Uuid,
    pub source_kind: String,
    pub source_id: Option<String>,
    pub from_key: String,
    pub from_qualifier: String,
    pub site_id: String,
    pub counter_key: Option<String>,
    pub counter_qualifier: String,
    pub counter_account_code: Option<String>,
    pub method: String,
    pub doc_date: NaiveDate,
    pub currency: String,
    /// Restated from the items. A checksum, never a posting.
    pub total_minor: i64,
    pub item_count: i32,
    /// `SKIP` or `HOLD`.
    pub unverified_policy: String,
    pub unverified_policy_reason: String,
    /// `DRAFT`, `READY`, `PARTIAL`, `EXECUTED`, `HELD` or `CANCELLED`.
    pub status: String,
    pub held_reason: Option<String>,
    pub memo: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub authorised_by: Option<String>,
    pub authorised_at: Option<DateTime<Utc>>,
    pub cancelled_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentBatchItemRow {
    pub item_id: Uuid,
    pub batch_id: Uuid,
    pub line_number: i32,
    pub party_type: String,
    pub party_id: String,
    pub party_name: String,
    pub destination_id: Option<Uuid>,
    /// What was actually paid to, frozen at execution. Absent until then, and
    /// never re-read from the destination afterwards.
    pub snapshot_bank_name: Option<String>,
    pub snapshot_account_mask: Option<String>,
    pub snapshot_account_holder: Option<String>,
    pub snapshot_verification_status: Option<String>,
    /// What the destination says today, for a row that has not been paid yet.
    pub destination_bank_name: Option<String>,
    pub destination_account_mask: Option<String>,
    pub destination_verification_status: Option<String>,
    pub amount_minor: i64,
    pub obligation_kind: Option<String>,
    pub obligation_id: Option<String>,
    pub obligation_reference: Option<String>,
    /// `PENDING`, `EXECUTED`, `SKIPPED` or `FAILED`.
    pub status: String,
    pub skip_reason: Option<String>,
    pub bank_reference: Option<String>,
    pub cash_document_id: Option<Uuid>,
    /// `KK-26-09-00001`, when the money layer is in this build.
    pub cash_document_number: Option<String>,
    pub executed_by: Option<String>,
    pub executed_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentBatchEventRow {
    pub event_id: Uuid,
    pub item_id: Option<Uuid>,
    pub kind: String,
    pub detail: String,
    pub policy_in_force: Option<String>,
    pub amount_minor: Option<i64>,
    pub occurred_at: DateTime<Utc>,
    pub actor: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentBatchDetail {
    pub batch: PaymentBatchRow,
    pub items: Vec<PaymentBatchItemRow>,
    /// What the run has actually done, in order.
    pub events: Vec<PaymentBatchEventRow>,
}

/// What one pass down a batch achieved.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PaymentBatchRunOutcome {
    pub batch_id: Uuid,
    pub executed: i32,
    pub skipped: i32,
    pub failed: i32,
    pub still_pending: i32,
    /// The batch's status after the pass.
    pub status: String,
    /// Set when the HOLD policy stopped the run.
    pub held_reason: Option<String>,
}

const BATCH_COLUMNS: &str = "b.batch_id, b.source_kind, b.source_id, b.from_key, b.from_qualifier,
     b.site_id, b.counter_key, b.counter_qualifier, b.counter_account_code,
     b.method, b.doc_date, b.currency, b.total_minor, b.item_count,
     b.unverified_policy, b.unverified_policy_reason, b.status, b.held_reason, b.memo,
     b.created_by, b.created_at, b.authorised_by, b.authorised_at, b.cancelled_reason";

fn to_batch(row: &sqlx::postgres::PgRow) -> Result<PaymentBatchRow, AppError> {
    Ok(PaymentBatchRow {
        batch_id: row.try_get("batch_id")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        from_key: row.try_get("from_key")?,
        from_qualifier: row.try_get("from_qualifier")?,
        site_id: row.try_get("site_id")?,
        counter_key: row.try_get("counter_key")?,
        counter_qualifier: row.try_get("counter_qualifier")?,
        counter_account_code: row.try_get("counter_account_code")?,
        method: row.try_get("method")?,
        doc_date: row.try_get("doc_date")?,
        currency: row.try_get("currency")?,
        total_minor: row.try_get("total_minor")?,
        item_count: row.try_get("item_count")?,
        unverified_policy: row.try_get("unverified_policy")?,
        unverified_policy_reason: row.try_get("unverified_policy_reason")?,
        status: row.try_get("status")?,
        held_reason: row.try_get("held_reason")?,
        memo: row.try_get("memo")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        authorised_by: row.try_get("authorised_by")?,
        authorised_at: row.try_get("authorised_at")?,
        cancelled_reason: row.try_get("cancelled_reason")?,
    })
}

// ---------------------------------------------------------------------------
// Building one
// ---------------------------------------------------------------------------

/// Create the batch and its items, authorised in the same act.
///
/// # Why there is no separate authorise step
///
/// A maker/checker split is the right shape for money and this repository has
/// already decided it cannot have one yet: `Role` is on the wire that Edge and
/// Store speak, and every write under `/api/v1/finance` is already ADMIN, so a
/// second button would be the same person clicking twice. `authorised_by` is
/// kept on the row and an `AUTHORISED` event is written, so the day `Role`
/// widens, splitting this into two acts is a change to one function rather than
/// to the schema.
pub async fn payment_batch_create(
    pool: &PgPool,
    request: &CreatePaymentBatchRequest,
    actor: &str,
) -> Result<PaymentBatchDetail, AppError> {
    let policy = UnverifiedDestinationPolicy::parse(&request.unverified_policy).ok_or_else(|| {
        AppError::Validation(format!(
            "'{}' is not a policy for an unverified destination; it is SKIP — pay the rest and \
             say why this one was passed over — or HOLD, which executes nothing until it is \
             fixed",
            request.unverified_policy
        ))
    })?;
    let policy_reason = request.unverified_policy_reason.trim();
    if policy_reason.is_empty() {
        return Err(AppError::Validation(
            "say why this batch skips or holds on an unverified account. The two answers suit \
             different money — a supplier run should not wait on one supplier, a payroll run \
             should not pay nineteen people out of twenty — and a reason is what tells the next \
             person which of those this is"
                .into(),
        ));
    }
    let memo = request.memo.trim();
    if memo.is_empty() {
        return Err(AppError::Validation(
            "a batch needs a note saying what it is for; it is what the run is called on every \
             screen that shows it"
                .into(),
        ));
    }
    let method = request.method.trim().to_ascii_uppercase();
    if !matches!(method.as_str(), "BANK_TRANSFER" | "CASH" | "GIRO") {
        return Err(AppError::Validation(format!(
            "'{method}' is not a way of paying; expected BANK_TRANSFER, CASH or GIRO"
        )));
    }
    if request.items.is_empty() {
        return Err(AppError::Validation(
            "a batch with nobody in it is not a batch".into(),
        ));
    }
    let counter_key = trimmed(request.counter_key.as_deref());
    let counter_account_code = trimmed(request.counter_account_code.as_deref());
    if counter_key.is_some() == counter_account_code.is_some() {
        return Err(AppError::Validation(
            "a batch says what the money answers once: a meaning like trade_payable, or an \
             account code somebody chose. Not both, and not neither"
                .into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let batch_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO payment_batch
           (batch_id, source_kind, source_id, from_key, from_qualifier, site_id,
            counter_key, counter_qualifier, counter_account_code,
            method, doc_date, unverified_policy, unverified_policy_reason,
            status, memo, created_by, authorised_by, authorised_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'READY',$14,$15,$15,now())",
    )
    .bind(batch_id)
    .bind(request.source_kind.trim())
    .bind(trimmed(request.source_id.as_deref()))
    .bind(request.from_key.trim())
    .bind(request.from_qualifier.trim())
    .bind(request.site_id.trim())
    .bind(counter_key.as_deref())
    .bind(if counter_key.is_some() {
        request.counter_qualifier.trim()
    } else {
        ""
    })
    .bind(counter_account_code.as_deref())
    .bind(&method)
    .bind(request.doc_date)
    .bind(policy.as_str())
    .bind(policy_reason)
    .bind(memo)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    for (index, item) in request.items.iter().enumerate() {
        if item.amount_minor <= 0 {
            return Err(AppError::Validation(format!(
                "line {} pays {}; a payment is a positive amount",
                index + 1,
                item.amount_minor
            )));
        }
        let party_type = item.party_type.trim().to_ascii_uppercase();
        if !matches!(party_type.as_str(), "SUPPLIER" | "EMPLOYEE" | "OTHER") {
            return Err(AppError::Validation(format!(
                "line {} names '{party_type}', which is not a party; expected SUPPLIER, \
                 EMPLOYEE or OTHER",
                index + 1
            )));
        }
        sqlx::query(
            "INSERT INTO payment_batch_item
               (item_id, batch_id, line_number, party_type, party_id, party_name,
                destination_id, amount_minor, obligation_kind, obligation_id,
                obligation_reference)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        )
        .bind(Uuid::new_v4())
        .bind(batch_id)
        .bind(i32::try_from(index + 1).unwrap_or(i32::MAX))
        .bind(&party_type)
        .bind(item.party_id.trim())
        .bind(item.party_name.trim())
        .bind(item.destination_id)
        .bind(item.amount_minor)
        .bind(trimmed(item.obligation_kind.as_deref()))
        .bind(trimmed(item.obligation_id.as_deref()))
        .bind(trimmed(item.obligation_reference.as_deref()))
        .execute(&mut *tx)
        .await
        .map_err(|error| already_being_paid(error, index + 1))?;
    }

    record_event(
        &mut tx,
        batch_id,
        None,
        "AUTHORISED",
        &format!(
            "{} recipients, {}, unverified destinations {}: {policy_reason}",
            request.items.len(),
            method.to_lowercase().replace('_', " "),
            policy.as_str().to_lowercase()
        ),
        Some(policy),
        None,
        None,
        actor,
    )
    .await?;
    tx.commit().await?;

    payment_batch_read(pool, batch_id).await
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// The partial unique index's message, in the words of what somebody just did.
fn already_being_paid(error: sqlx::Error, line: usize) -> AppError {
    if let sqlx::Error::Database(db) = &error {
        if db.constraint() == Some("ux_payment_batch_item_obligation") {
            return AppError::Conflict(format!(
                "line {line} pays something another live batch is already paying. Cancel that \
                 batch or take the row out of this one — the alternative is the same bill \
                 answered twice"
            ));
        }
    }
    AppError::from(error)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

pub async fn payment_batch_list(
    pool: &PgPool,
    status: Option<&str>,
    source_kind: Option<&str>,
    limit: i64,
) -> Result<Vec<PaymentBatchRow>, AppError> {
    let sql = format!(
        "SELECT {BATCH_COLUMNS} FROM payment_batch b
          WHERE ($1::text IS NULL OR b.status = $1)
            AND ($2::text IS NULL OR b.source_kind = $2)
          ORDER BY b.doc_date DESC, b.created_at DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(status)
        .bind(source_kind)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_batch).collect()
}

pub async fn payment_batch_read(
    pool: &PgPool,
    batch_id: Uuid,
) -> Result<PaymentBatchDetail, AppError> {
    let sql = format!("SELECT {BATCH_COLUMNS} FROM payment_batch b WHERE b.batch_id = $1");
    let row = sqlx::query(&sql)
        .bind(batch_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("payment batch".into()))?;
    let batch = to_batch(&row)?;
    Ok(PaymentBatchDetail {
        batch,
        items: payment_batch_items(pool, batch_id).await?,
        events: payment_batch_events(pool, batch_id).await?,
    })
}

/// The items, with the snapshot for the paid ones and the live destination for
/// the rest.
///
/// The two are read into different fields on purpose. A screen showing a paid
/// row shows what it was paid to; a screen showing a pending row shows what it
/// is about to be paid to, which is a different fact and may already be a
/// different account. Collapsing them into one pair of columns is exactly the
/// mistake `payment_destination_snapshot` exists to prevent, and it would be
/// made here rather than in the schema.
pub async fn payment_batch_items(
    pool: &PgPool,
    batch_id: Uuid,
) -> Result<Vec<PaymentBatchItemRow>, AppError> {
    let rows = sqlx::query(
        "SELECT i.item_id, i.batch_id, i.line_number, i.party_type, i.party_id, i.party_name,
                i.destination_id, i.amount_minor, i.obligation_kind, i.obligation_id,
                i.obligation_reference, i.status, i.skip_reason, i.bank_reference,
                i.cash_document_id, i.executed_by, i.executed_at,
                s.bank_name AS snap_bank, s.account_number_mask AS snap_mask,
                s.account_holder AS snap_holder, s.verification_status AS snap_status,
                d.bank_name AS live_bank, d.account_number_mask AS live_mask,
                d.verification_status AS live_status
           FROM payment_batch_item i
           LEFT JOIN payment_destination_snapshot s ON s.snapshot_id = i.snapshot_id
           LEFT JOIN payment_destination d ON d.destination_id = i.destination_id
          WHERE i.batch_id = $1
          ORDER BY i.line_number",
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        let cash_document_id: Option<Uuid> = row.try_get("cash_document_id")?;
        let cash_document_number = match cash_document_id {
            Some(id) => payment_execution_document_number(pool, id).await?,
            None => None,
        };
        items.push(PaymentBatchItemRow {
            item_id: row.try_get("item_id")?,
            batch_id: row.try_get("batch_id")?,
            line_number: row.try_get("line_number")?,
            party_type: row.try_get("party_type")?,
            party_id: row.try_get("party_id")?,
            party_name: row.try_get("party_name")?,
            destination_id: row.try_get("destination_id")?,
            snapshot_bank_name: row.try_get("snap_bank")?,
            snapshot_account_mask: row.try_get("snap_mask")?,
            snapshot_account_holder: row.try_get("snap_holder")?,
            snapshot_verification_status: row.try_get("snap_status")?,
            destination_bank_name: row.try_get("live_bank")?,
            destination_account_mask: row.try_get("live_mask")?,
            destination_verification_status: row.try_get("live_status")?,
            amount_minor: row.try_get("amount_minor")?,
            obligation_kind: row.try_get("obligation_kind")?,
            obligation_id: row.try_get("obligation_id")?,
            obligation_reference: row.try_get("obligation_reference")?,
            status: row.try_get("status")?,
            skip_reason: row.try_get("skip_reason")?,
            bank_reference: row.try_get("bank_reference")?,
            cash_document_id,
            cash_document_number,
            executed_by: row.try_get("executed_by")?,
            executed_at: row.try_get("executed_at")?,
        });
    }
    Ok(items)
}

pub async fn payment_batch_events(
    pool: &PgPool,
    batch_id: Uuid,
) -> Result<Vec<PaymentBatchEventRow>, AppError> {
    let rows = sqlx::query(
        "SELECT event_id, item_id, kind, detail, policy_in_force, amount_minor,
                occurred_at, actor
           FROM payment_batch_event WHERE batch_id = $1
          ORDER BY occurred_at, event_id",
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PaymentBatchEventRow {
                event_id: row.try_get("event_id")?,
                item_id: row.try_get("item_id")?,
                kind: row.try_get("kind")?,
                detail: row.try_get("detail")?,
                policy_in_force: row.try_get("policy_in_force")?,
                amount_minor: row.try_get("amount_minor")?,
                occurred_at: row.try_get("occurred_at")?,
                actor: row.try_get("actor")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Executing
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Default)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExecutePaymentBatchItemRequest {
    /// The bank's own reference, when it is already known. The only thread
    /// between this row and the statement that will arrive next month.
    pub bank_reference: Option<String>,
}

/// What one item's execution decided, before anything was written.
enum ItemVerdict {
    Pay,
    Skip(String),
    Hold(String),
}

/// Whether this item may be paid, given the batch's policy.
fn verdict_for(
    destination_id: Option<Uuid>,
    verification_status: Option<&str>,
    active: Option<bool>,
    party_name: &str,
    policy: UnverifiedDestinationPolicy,
) -> ItemVerdict {
    let complaint = match (destination_id, verification_status, active) {
        (None, _, _) => format!("{party_name} has no bank account on file"),
        (Some(_), _, Some(false)) => {
            format!("{party_name}'s account has been taken out of use")
        }
        (Some(_), Some("VERIFIED"), _) => return ItemVerdict::Pay,
        (Some(_), Some("REJECTED"), _) => {
            format!("{party_name}'s account was checked and found wrong")
        }
        (Some(_), _, _) => format!("{party_name}'s account has not been verified"),
    };
    match policy {
        UnverifiedDestinationPolicy::Skip => ItemVerdict::Skip(complaint),
        UnverifiedDestinationPolicy::Hold => ItemVerdict::Hold(complaint),
    }
}

/// Execute one item: one PAY, one document, one commit.
pub async fn payment_batch_execute_item(
    pool: &PgPool,
    batch_id: Uuid,
    item_id: Uuid,
    request: &ExecutePaymentBatchItemRequest,
    actor: &str,
) -> Result<PaymentBatchDetail, AppError> {
    let mut tx = pool.begin().await?;
    execute_one(&mut tx, batch_id, item_id, request.bank_reference.as_deref(), actor).await?;
    restate_batch_status(&mut tx, batch_id).await?;
    tx.commit().await?;
    payment_batch_read(pool, batch_id).await
}

/// Work down whatever is still pending.
///
/// Each item is its own transaction. A failure at line nineteen leaves lines
/// one to eighteen paid, which is the truth — the bank has been told about
/// them — and the run is resumed by calling this again.
pub async fn payment_batch_execute_remaining(
    pool: &PgPool,
    batch_id: Uuid,
    actor: &str,
) -> Result<PaymentBatchRunOutcome, AppError> {
    let mut tx = pool.begin().await?;
    let (_, policy) = lock_runnable_batch(&mut tx, batch_id).await?;
    record_event(
        &mut tx,
        batch_id,
        None,
        "RUN_STARTED",
        "working down whatever is still pending",
        Some(policy),
        None,
        None,
        actor,
    )
    .await?;
    tx.commit().await?;

    let pending: Vec<Uuid> = sqlx::query_scalar(
        "SELECT item_id FROM payment_batch_item
          WHERE batch_id = $1 AND status = 'PENDING' ORDER BY line_number",
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?;

    let mut executed = 0;
    let mut skipped = 0;
    let mut failed = 0;
    for item_id in pending {
        let mut tx = pool.begin().await?;
        match execute_one(&mut tx, batch_id, item_id, None, actor).await {
            Ok(Outcome::Paid) => {
                tx.commit().await?;
                executed += 1;
            }
            Ok(Outcome::Skipped) => {
                tx.commit().await?;
                skipped += 1;
            }
            Ok(Outcome::Held) => {
                tx.commit().await?;
                break;
            }
            Err(error) => {
                // The failure is a fact about this row, so it is recorded on
                // the row rather than thrown away with the transaction that
                // was trying to pay it. Rolled back first: whatever half-wrote
                // must not survive, and the note about it must.
                tx.rollback().await?;
                let mut note = pool.begin().await?;
                mark_failed(&mut note, batch_id, item_id, &error.to_string(), actor).await?;
                note.commit().await?;
                failed += 1;
            }
        }
    }

    let mut tx = pool.begin().await?;
    restate_batch_status(&mut tx, batch_id).await?;
    tx.commit().await?;

    let row = sqlx::query(
        "SELECT b.status, b.held_reason,
                (SELECT COUNT(*) FROM payment_batch_item i
                  WHERE i.batch_id = b.batch_id AND i.status = 'PENDING')::int AS pending
           FROM payment_batch b WHERE b.batch_id = $1",
    )
    .bind(batch_id)
    .fetch_one(pool)
    .await?;

    Ok(PaymentBatchRunOutcome {
        batch_id,
        executed,
        skipped,
        failed,
        still_pending: row.try_get("pending")?,
        status: row.try_get("status")?,
        held_reason: row.try_get("held_reason")?,
    })
}

enum Outcome {
    Paid,
    Skipped,
    Held,
}

/// The batch, locked, if it is in a state that can pay anybody.
async fn lock_runnable_batch(
    tx: &mut Transaction<'_, Postgres>,
    batch_id: Uuid,
) -> Result<(sqlx::postgres::PgRow, UnverifiedDestinationPolicy), AppError> {
    let sql = format!("SELECT {BATCH_COLUMNS} FROM payment_batch b WHERE b.batch_id = $1 FOR UPDATE");
    let row = sqlx::query(&sql)
        .bind(batch_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("payment batch".into()))?;
    let status: String = row.try_get("status")?;
    match status.as_str() {
        "READY" | "PARTIAL" => {}
        "HELD" => {
            let reason: Option<String> = row.try_get("held_reason")?;
            return Err(AppError::Conflict(format!(
                "this batch is held: {}. Nothing will be paid out of it until that is settled — \
                 which is what its policy asked for",
                reason.unwrap_or_else(|| "no reason recorded".into())
            )));
        }
        "EXECUTED" => {
            return Err(AppError::Conflict(
                "every line in this batch has already been dealt with".into(),
            ))
        }
        "CANCELLED" => {
            return Err(AppError::Conflict(
                "this batch was cancelled; the lines already paid stay paid, and no more will be"
                    .into(),
            ))
        }
        other => {
            return Err(AppError::Conflict(format!(
                "this batch is {}, so nobody can be paid out of it yet",
                other.to_lowercase()
            )))
        }
    }
    let policy_text: String = row.try_get("unverified_policy")?;
    let policy = UnverifiedDestinationPolicy::parse(&policy_text).ok_or_else(|| {
        AppError::Validation(format!("'{policy_text}' is not a policy this run understands"))
    })?;
    Ok((row, policy))
}

#[allow(clippy::too_many_lines)]
async fn execute_one(
    tx: &mut Transaction<'_, Postgres>,
    batch_id: Uuid,
    item_id: Uuid,
    bank_reference: Option<&str>,
    actor: &str,
) -> Result<Outcome, AppError> {
    let batch = lock_runnable_batch(tx, batch_id).await?;
    let (batch, policy) = batch;
    let doc_date: NaiveDate = batch.try_get("doc_date")?;
    let from_key: String = batch.try_get("from_key")?;
    let from_qualifier: String = batch.try_get("from_qualifier")?;
    let site_id: String = batch.try_get("site_id")?;
    let counter_key: Option<String> = batch.try_get("counter_key")?;
    let counter_qualifier: String = batch.try_get("counter_qualifier")?;
    let counter_account_code: Option<String> = batch.try_get("counter_account_code")?;
    let batch_memo: String = batch.try_get("memo")?;

    let item = sqlx::query(
        "SELECT i.item_id, i.line_number, i.party_type, i.party_id, i.party_name,
                i.destination_id, i.amount_minor, i.obligation_reference, i.status,
                d.verification_status, d.active
           FROM payment_batch_item i
           LEFT JOIN payment_destination d ON d.destination_id = i.destination_id
          WHERE i.item_id = $1 AND i.batch_id = $2
          FOR UPDATE OF i",
    )
    .bind(item_id)
    .bind(batch_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("payment batch item".into()))?;

    let status: String = item.try_get("status")?;
    let line_number: i32 = item.try_get("line_number")?;
    if status != "PENDING" {
        // Not an error. Running a batch again is how a partial run is finished,
        // and a row that is already dealt with is the ordinary thing to meet.
        return Ok(match status.as_str() {
            "EXECUTED" => Outcome::Paid,
            _ => Outcome::Skipped,
        });
    }

    let party_name: String = item.try_get("party_name")?;
    let destination_id: Option<Uuid> = item.try_get("destination_id")?;
    let verification: Option<String> = item.try_get("verification_status")?;
    let active: Option<bool> = item.try_get("active")?;

    match verdict_for(
        destination_id,
        verification.as_deref(),
        active,
        &party_name,
        policy,
    ) {
        ItemVerdict::Pay => {}
        ItemVerdict::Skip(why) => {
            let detail = format!("line {line_number} passed over: {why}");
            sqlx::query(
                "UPDATE payment_batch_item SET status='SKIPPED', skip_reason=$2 WHERE item_id=$1",
            )
            .bind(item_id)
            .bind(&detail)
            .execute(&mut **tx)
            .await?;
            record_event(
                tx,
                batch_id,
                Some(item_id),
                "ITEM_SKIPPED",
                &detail,
                Some(policy),
                None,
                None,
                actor,
            )
            .await?;
            return Ok(Outcome::Skipped);
        }
        ItemVerdict::Hold(why) => {
            let detail = format!(
                "held at line {line_number}: {why}. This batch was set up to hold rather than \
                 skip, so nothing further will be paid until it is settled"
            );
            sqlx::query(
                "UPDATE payment_batch SET status='HELD', held_reason=$2 WHERE batch_id=$1",
            )
            .bind(batch_id)
            .bind(&detail)
            .execute(&mut **tx)
            .await?;
            record_event(
                tx,
                batch_id,
                Some(item_id),
                "POLICY_APPLIED",
                &detail,
                Some(policy),
                None,
                None,
                actor,
            )
            .await?;
            return Ok(Outcome::Held);
        }
    }

    let destination_id = destination_id.ok_or_else(|| {
        AppError::Validation(format!("line {line_number} has no account to pay into"))
    })?;
    let amount_minor: i64 = item.try_get("amount_minor")?;
    let party_type: String = item.try_get("party_type")?;
    let party_id: String = item.try_get("party_id")?;
    let reference: Option<String> = item.try_get("obligation_reference")?;

    // The copy is taken before the money moves and inside the same
    // transaction, so a payment can never exist without the record of what it
    // was paid to.
    let snapshot_id = payment_destination_snapshot_take(
        tx,
        "BATCH_ITEM",
        &item_id.to_string(),
        destination_id,
        actor,
    )
    .await?;

    let memo = match reference.as_deref() {
        Some(reference) => format!("{batch_memo} — {reference}"),
        None => batch_memo.clone(),
    };
    let instruction = PayInstruction {
        doc_date,
        from_key,
        from_qualifier,
        site_id,
        counter_key,
        counter_qualifier,
        counter_account_code,
        amount_minor,
        party_kind: party_type.clone(),
        supplier_id: (party_type == "SUPPLIER").then(|| party_id.clone()),
        employee_id: (party_type == "EMPLOYEE").then(|| party_id.clone()),
        party_name: party_name.clone(),
        memo,
    };
    let document_id = payment_execution_pay(tx, &instruction, actor).await?;

    sqlx::query(
        "UPDATE payment_batch_item
            SET status='EXECUTED', snapshot_id=$2, cash_document_id=$3,
                bank_reference=COALESCE($4, bank_reference),
                executed_by=$5, executed_at=now()
          WHERE item_id=$1",
    )
    .bind(item_id)
    .bind(snapshot_id)
    .bind(document_id)
    .bind(bank_reference.map(str::trim).filter(|v| !v.is_empty()))
    .bind(actor)
    .execute(&mut **tx)
    .await?;

    record_event(
        tx,
        batch_id,
        Some(item_id),
        "ITEM_EXECUTED",
        &format!("line {line_number} paid to {party_name}"),
        Some(policy),
        Some(document_id),
        Some(amount_minor),
        actor,
    )
    .await?;
    Ok(Outcome::Paid)
}

async fn mark_failed(
    tx: &mut Transaction<'_, Postgres>,
    batch_id: Uuid,
    item_id: Uuid,
    why: &str,
    actor: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE payment_batch_item SET status='FAILED', skip_reason=$2 WHERE item_id=$1")
        .bind(item_id)
        .bind(why)
        .execute(&mut **tx)
        .await?;
    record_event(
        tx,
        batch_id,
        Some(item_id),
        "ITEM_FAILED",
        why,
        None,
        None,
        None,
        actor,
    )
    .await
}

/// The batch's status, worked out from its items.
///
/// Derived rather than set, so a run that ends in any order leaves the batch
/// saying the same thing. A HELD batch stays held: it was stopped on purpose
/// and only a person deciding what to do about it should move it.
async fn restate_batch_status(
    tx: &mut Transaction<'_, Postgres>,
    batch_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE payment_batch b
            SET status = CASE
                WHEN b.status IN ('CANCELLED', 'HELD', 'DRAFT') THEN b.status
                WHEN NOT EXISTS (SELECT 1 FROM payment_batch_item i
                                  WHERE i.batch_id = b.batch_id AND i.status = 'PENDING')
                     THEN 'EXECUTED'
                WHEN EXISTS (SELECT 1 FROM payment_batch_item i
                              WHERE i.batch_id = b.batch_id AND i.status <> 'PENDING')
                     THEN 'PARTIAL'
                ELSE 'READY' END
          WHERE b.batch_id = $1",
    )
    .bind(batch_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn payment_batch_cancel(
    pool: &PgPool,
    batch_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<PaymentBatchDetail, AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "say why the run is being abandoned; the lines already paid stay paid and somebody \
             will ask why the rest were not"
                .into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM payment_batch WHERE batch_id=$1 FOR UPDATE")
            .bind(batch_id)
            .fetch_optional(&mut *tx)
            .await?;
    let status = status.ok_or_else(|| AppError::NotFound("payment batch".into()))?;
    if status == "CANCELLED" {
        tx.rollback().await?;
        return payment_batch_read(pool, batch_id).await;
    }
    if status == "EXECUTED" {
        return Err(AppError::Conflict(
            "every line in this batch has been paid; there is nothing left to cancel".into(),
        ));
    }
    sqlx::query(
        "UPDATE payment_batch
            SET status='CANCELLED', cancelled_by=$2, cancelled_at=now(), cancelled_reason=$3
          WHERE batch_id=$1",
    )
    .bind(batch_id)
    .bind(actor)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    record_event(
        &mut tx,
        batch_id,
        None,
        "CANCELLED",
        reason,
        None,
        None,
        None,
        actor,
    )
    .await?;
    tx.commit().await?;
    payment_batch_read(pool, batch_id).await
}

#[allow(clippy::too_many_arguments)]
async fn record_event(
    tx: &mut Transaction<'_, Postgres>,
    batch_id: Uuid,
    item_id: Option<Uuid>,
    kind: &str,
    detail: &str,
    policy: Option<UnverifiedDestinationPolicy>,
    cash_document_id: Option<Uuid>,
    amount_minor: Option<i64>,
    actor: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO payment_batch_event
           (event_id, batch_id, item_id, kind, detail, policy_in_force,
            cash_document_id, amount_minor, actor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(Uuid::new_v4())
    .bind(batch_id)
    .bind(item_id)
    .bind(kind)
    .bind(detail)
    .bind(policy.map(UnverifiedDestinationPolicy::as_str))
    .bind(cash_document_id)
    .bind(amount_minor)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
