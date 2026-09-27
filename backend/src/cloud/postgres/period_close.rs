//! The month-end checklist, the close it gates, and the reopen that undoes it.
//!
//! `ledger::close_period` used to flip a row and count what it had sealed. It
//! checked nothing, which meant the act of closing a month asserted only that
//! somebody had pressed a button. Everything a close is actually FOR — the
//! journal balances, no document is still in draft, depreciation has been run,
//! the bank has been reconciled — was a habit rather than a rule, and a habit
//! is what a close is designed to replace.
//!
//! # The shape
//!
//! A [`CloseCheck`] is a key, a title, whether it is critical, and a function
//! that looks at one month and reports [`CheckOutcome`]. The registry below
//! holds the ones this module ships; [`period_close_register`] takes more. The
//! pure fold that turns a pile of outcomes into "may this month close" lives in
//! `domain::period_close` and is the only place `critical` means anything.
//!
//! # Registering a check from another module
//!
//! Anything with a `&PgPool` and a month can be a check. A lane adding the
//! sub-ledger equalities, the inter-unit two-way, cash in transit, advances,
//! remittances or acquirer settlement calls this once at start-up — before the
//! router is built, so the first close of the process sees it:
//!
//! ```ignore
//! use crate::cloud::postgres::{period_close_register, CloseCheck, CheckOutcome};
//! use crate::cloud::domain::{ClosePeriod, CheckPointer};
//!
//! async fn subledger_agrees(pool: &PgPool, period: ClosePeriod)
//!     -> Result<CheckOutcome, AppError> { /* ... */ }
//!
//! period_close_register(CloseCheck {
//!     key: "subledger.payables",
//!     title: "Payables sub-ledger equals the control account",
//!     critical: true,
//!     evaluate: |pool, period| Box::pin(subledger_agrees(pool, period)),
//! });
//! ```
//!
//! The closure is non-capturing, so it coerces to a plain function pointer and
//! [`CloseCheck`] stays `Copy`. Registration is additive and idempotent by key:
//! registering a key that already exists REPLACES it, which is how a lane that
//! disagrees with one of the built-ins below overrides it without editing this
//! file.
//!
//! # Why the registry is a lock and not a `const` list
//!
//! Because the checks arrive from modules this one must not depend on. A `const`
//! array here would mean `period_close` importing every sub-ledger in the
//! system, and the dependency arrow pointing the wrong way — the close would own
//! the modules instead of the modules owning their own controls.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    close_verdict, CheckOutcome, CheckPointer, CloseCheckResult, ClosePeriod,
};
use chrono::{NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::future::Future;
use std::pin::Pin;
use std::sync::{OnceLock, RwLock};
use uuid::Uuid;

/// How many exceptions a failing check lists by name.
///
/// A check that found four hundred draft bills reports four hundred and shows
/// the first dozen. The count is the fact; the pointers are the way in.
pub(super) const POINTER_CAP: i64 = 12;

/// How long an unmatched bank line may sit before it stops being timing.
///
/// Thirty days rather than a configurable number, until somebody has an opinion
/// about it. A setting nobody has asked for is a setting nobody will maintain.
const UNMATCHED_TOLERANCE_DAYS: i64 = 30;

type CheckFuture<'a> = Pin<Box<dyn Future<Output = Result<CheckOutcome, AppError>> + Send + 'a>>;

/// One control that has to hold before a month may be sealed.
#[derive(Clone, Copy)]
pub struct CloseCheck {
    /// Stable and dotted. Named in the refusal, keyed on in the stored
    /// snapshot, and never translated.
    pub key: &'static str,
    pub title: &'static str,
    /// Whether failing — or being unevaluable — stops the close.
    pub critical: bool,
    pub evaluate: for<'a> fn(&'a PgPool, ClosePeriod) -> CheckFuture<'a>,
}

macro_rules! check {
    ($key:literal, $title:literal, $critical:expr, $function:ident) => {
        CloseCheck {
            key: $key,
            title: $title,
            critical: $critical,
            evaluate: |pool, period| Box::pin($function(pool, period)),
        }
    };
}

/// The controls this module ships.
fn built_in_checks() -> Vec<CloseCheck> {
    vec![
        check!(
            "integrity.equations",
            "Every integrity equation balances",
            true,
            check_integrity_equations
        ),
        check!(
            "journal.balanced",
            "Every entry balances, in total and in each unit's books",
            true,
            check_journal_balanced
        ),
        check!(
            "documents.drafts",
            "No bill or payment dated in the month is still waiting to be posted",
            true,
            check_no_drafts
        ),
        check!(
            "journal.late_entries",
            "Entries dated in the month but keyed after it ended",
            false,
            check_late_entries
        ),
        check!(
            "assets.depreciation",
            "Every asset in service has been charged for the month",
            true,
            check_depreciation
        ),
        check!(
            "bank.statements_imported",
            "Every bank account has a statement covering the month end",
            true,
            check_bank_statements
        ),
        check!(
            "bank.unmatched_lines",
            "No bank line has been unmatched for more than a month",
            false,
            check_unmatched_lines
        ),
        check!(
            "postings.failed",
            "Nothing failed to post",
            false,
            check_failed_postings
        ),
    ]
}

fn registry() -> &'static RwLock<Vec<CloseCheck>> {
    static REGISTRY: OnceLock<RwLock<Vec<CloseCheck>>> = OnceLock::new();
    REGISTRY.get_or_init(|| RwLock::new(built_in_checks()))
}

/// Add a check, or replace one with the same key.
///
/// See the module header for the shape a caller passes. Called at start-up, by
/// the module that owns the control — never from inside a request, because the
/// checklist a close ran against should not depend on which requests happened to
/// arrive first.
pub fn period_close_register(check: CloseCheck) {
    let Ok(mut checks) = registry().write() else {
        return;
    };
    if let Some(slot) = checks.iter_mut().find(|held| held.key == check.key) {
        *slot = check;
    } else {
        checks.push(check);
    }
}

/// Every check that will run, in the order it will run.
pub fn period_close_checks() -> Vec<CloseCheck> {
    registry()
        .read()
        .map(|checks| checks.clone())
        .unwrap_or_else(|_| built_in_checks())
}

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

fn month(year: i32, month: i32) -> Result<ClosePeriod, AppError> {
    let month = u32::try_from(month).ok().unwrap_or(0);
    ClosePeriod::new(year, month).ok_or_else(|| AppError::Validation("month must be 1..12".into()))
}

/// The first day of the month, and the first day of the next one. A half-open
/// range, so a `posting_date` comparison uses the index rather than EXTRACT.
fn bounds(period: ClosePeriod) -> Result<(NaiveDate, NaiveDate), AppError> {
    let start = NaiveDate::from_ymd_opt(period.year, period.month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;
    let next = period.next();
    let end = NaiveDate::from_ymd_opt(next.year, next.month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;
    Ok((start, end))
}

fn last_day(period: ClosePeriod) -> Result<NaiveDate, AppError> {
    NaiveDate::from_ymd_opt(period.year, period.month, period.last_day())
        .ok_or_else(|| AppError::Validation("not a month".into()))
}

/// Run every registered check against one month.
///
/// Sequential rather than joined. The checks are cheap, they share one pool,
/// and a checklist that ran them concurrently would report them in whatever
/// order they finished — which is a different order every time, on a screen
/// people read top to bottom.
pub async fn period_checklist(
    pool: &PgPool,
    year: i32,
    month_number: i32,
) -> Result<crate::cloud::domain::CloseVerdict, AppError> {
    let period = month(year, month_number)?;
    let mut results = Vec::new();
    for check in period_close_checks() {
        let outcome = (check.evaluate)(pool, period).await?;
        results.push(CloseCheckResult {
            key: check.key.to_string(),
            title: check.title.to_string(),
            critical: check.critical,
            outcome,
        });
    }
    Ok(close_verdict(period, results))
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/// The ten equations, asked of the integrity engine rather than re-derived.
///
/// This checklist is about READINESS — is anything still in draft, has
/// depreciation run, has the bank been imported. Whether the books balance is a
/// different question with a different owner: `postgres::integrity` holds the
/// ten equations, each an `IntegrityCheck` with its own tolerance and its own
/// four-state verdict, and a month-end that recomputed any of them would be a
/// second opinion drifting away from the first.
///
/// So this is one slot in the checklist that delegates, and the mapping from
/// their four states to ours is the whole of it:
///
/// | `integrity::CheckState` | here |
/// |---|---|
/// | `Balanced`  | `Pass` |
/// | `Pending`   | `Pending` — the equation could not be evaluated |
/// | `Exception` | `Fail`, with the offending scope as a pointer |
/// | `Blocked`   | `Blocked` — refuses the close whatever `critical` says |
///
/// # Why this is Pending today
///
/// The engine lands on its own branch. Calling `integrity_registry()` from a
/// branch where `postgres::integrity` does not exist would not compile, and
/// answering `Pass` in its absence would be exactly the green tick for an
/// unrun control that `CheckOutcome::Pending` exists to refuse. So the slot is
/// held open, critical, and Pending — which means **a month cannot close until
/// the engine is wired in**, and that is the correct behaviour rather than a
/// gap.
///
/// # Wiring it in, when the branches meet
///
/// Nothing in this file changes. The engine's own start-up registers a check
/// under the same key and [`period_close_register`] replaces this placeholder
/// with it:
///
/// ```ignore
/// use crate::cloud::domain::{CheckOutcome, CheckPointer, CheckState};
/// use crate::cloud::postgres::{
///     integrity_registry, period_close_register, CloseCheck,
/// };
///
/// async fn equations(pool: &PgPool, period: ClosePeriod) -> Result<CheckOutcome, AppError> {
///     // The last day of the month, because an equation asked `as_of` today
///     // would answer a question about today.
///     let as_of = NaiveDate::from_ymd_opt(period.year, period.month, period.last_day())
///         .ok_or_else(|| AppError::Validation("not a month".into()))?;
///     let mut failed = Vec::new();
///     let mut blocked = Vec::new();
///     let mut waiting = Vec::new();
///     for check in integrity_registry() {
///         let result = check.evaluate(pool, as_of).await?;
///         match result.state {
///             CheckState::Balanced => {}
///             CheckState::Pending => waiting.push(check.key().to_string()),
///             CheckState::Exception => failed.push(CheckPointer::new(
///                 "integrity_check",
///                 check.key(),
///                 check.title(),
///             )),
///             CheckState::Blocked => blocked.push(check.key().to_string()),
///         }
///     }
///     if !blocked.is_empty() {
///         return Ok(CheckOutcome::blocked(format!(
///             "the books do not add up: {}",
///             blocked.join(", ")
///         )));
///     }
///     if !waiting.is_empty() {
///         return Ok(CheckOutcome::pending(format!(
///             "could not be evaluated: {}",
///             waiting.join(", ")
///         )));
///     }
///     let count = i64::try_from(failed.len()).unwrap_or(i64::MAX);
///     failed.truncate(POINTER_CAP as usize);
///     Ok(CheckOutcome::from_exceptions(count, failed))
/// }
///
/// period_close_register(CloseCheck {
///     key: "integrity.equations",
///     title: "Every integrity equation balances",
///     critical: true,
///     evaluate: |pool, period| Box::pin(equations(pool, period)),
/// });
/// ```
///
/// The `Blocked` arm is the reason [`crate::cloud::domain::CheckOutcome`] has a
/// fourth variant at all: an unfooted trial balance is not an exception
/// somebody may weigh, and a `critical: false` on this slot must not become a
/// way to seal a month over one.
async fn check_integrity_equations(
    _pool: &PgPool,
    _period: ClosePeriod,
) -> Result<CheckOutcome, AppError> {
    Ok(CheckOutcome::pending(
        "the integrity engine is not on this build: nothing has registered a check under \
         integrity.equations, so integrity_registry() has not been asked whether the ten \
         equations balance",
    ))
}

/// Every entry balances, and balances in each unit's books.
///
/// Two questions, one check, because they have one answer for a reader: this
/// entry is wrong. Both are guaranteed by deferred constraint triggers (the
/// per-unit one since 0605), so a failure here means something got in before
/// those triggers existed or around them. The per-unit half is the one that
/// bites: the client keeps a profit and loss per unit, so an entry that debits
/// store 03 and credits head office balances in total and leaves both units
/// wrong by the same amount, invisibly, in a trial balance that foots.
async fn check_journal_balanced(
    pool: &PgPool,
    period: ClosePeriod,
) -> Result<CheckOutcome, AppError> {
    let (start, end) = bounds(period)?;
    let rows = sqlx::query(
        "WITH lopsided AS (
             SELECT e.entry_id, e.entry_number, 'in total' AS how
               FROM journal_entry e JOIN journal_line l USING (entry_id)
              WHERE e.posting_date >= $1 AND e.posting_date < $2
              GROUP BY e.entry_id, e.entry_number
             HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)
             UNION
             SELECT e.entry_id, e.entry_number, 'in the books of ' || l.unit_id AS how
               FROM journal_entry e JOIN journal_line l USING (entry_id)
              WHERE e.posting_date >= $1 AND e.posting_date < $2
              GROUP BY e.entry_id, e.entry_number, l.unit_id
             HAVING SUM(l.debit_minor) <> SUM(l.credit_minor)
         )
         SELECT entry_id, entry_number, how,
                COUNT(*) OVER ()::bigint AS total
           FROM lopsided ORDER BY entry_number LIMIT $3",
    )
    .bind(start)
    .bind(end)
    .bind(POINTER_CAP)
    .fetch_all(pool)
    .await?;
    Ok(outcome_from(rows, "entry", |row| {
        Ok(format!(
            "{} does not balance {}",
            row.try_get::<String, _>("entry_number")?,
            row.try_get::<String, _>("how")?
        ))
    })?)
}

/// No bill or payment dated in the month is still waiting to be posted.
///
/// A draft dated inside the month is a debt or a payment the month's statements
/// do not carry and should. MATCHED counts as a draft here: it means reconciled
/// against the delivery and still not in the ledger, which is exactly the state
/// somebody forgets a bill in.
async fn check_no_drafts(pool: &PgPool, period: ClosePeriod) -> Result<CheckOutcome, AppError> {
    let (start, end) = bounds(period)?;
    let rows = sqlx::query(
        "WITH waiting AS (
             SELECT invoice_id AS id, 'bill ' || invoice_number AS label
               FROM supplier_invoice
              WHERE status IN ('DRAFT', 'MATCHED')
                AND invoice_date >= $1 AND invoice_date < $2
             UNION ALL
             SELECT payment_id, 'payment ' || payment_number
               FROM supplier_payment
              WHERE status = 'DRAFT'
                AND payment_date >= $1 AND payment_date < $2
         )
         SELECT id, label, COUNT(*) OVER ()::bigint AS total
           FROM waiting ORDER BY label LIMIT $3",
    )
    .bind(start)
    .bind(end)
    .bind(POINTER_CAP)
    .fetch_all(pool)
    .await?;
    Ok(outcome_from(rows, "document", |row| {
        Ok(row.try_get::<String, _>("label")?)
    })?)
}

/// Entries dated in the month but written after it ended.
///
/// Not critical, and not a fault: a bill that arrives on the 3rd and belongs to
/// the 30th is ordinary. It is on the checklist because it is the list somebody
/// should read before sealing — every one of these moved a month that people had
/// already looked at, and a close is the last chance to notice.
async fn check_late_entries(pool: &PgPool, period: ClosePeriod) -> Result<CheckOutcome, AppError> {
    let (start, end) = bounds(period)?;
    let rows = sqlx::query(
        "SELECT entry_id, entry_number, posted_at::date AS keyed_on,
                COUNT(*) OVER ()::bigint AS total
           FROM journal_entry
          WHERE posting_date >= $1 AND posting_date < $2
            AND posted_at >= $2::date
          ORDER BY posted_at LIMIT $3",
    )
    .bind(start)
    .bind(end)
    .bind(POINTER_CAP)
    .fetch_all(pool)
    .await?;
    Ok(outcome_from(rows, "entry", |row| {
        Ok(format!(
            "{} keyed on {}",
            row.try_get::<String, _>("entry_number")?,
            row.try_get::<NaiveDate, _>("keyed_on")?
        ))
    })?)
}

/// Every asset that owes a charge has been charged for the month.
///
/// The asset register's status is the authority for which assets still owe a
/// charge. It applies the same integer depreciation rules as the run, including
/// opening balances, cutover months, non-depreciable assets, and assets already
/// at salvage. The close checklist turns missing assets into actionable
/// pointers for Finance.
async fn check_depreciation(pool: &PgPool, period: ClosePeriod) -> Result<CheckOutcome, AppError> {
    let status = super::assets::asset_depreciation_status(pool, period.year, period.month).await?;
    let count = status.missing.len() as i64;
    let pointers = status
        .missing
        .into_iter()
        .take(POINTER_CAP as usize)
        .map(|asset| {
            CheckPointer::new(
                "asset",
                asset.asset_id.to_string(),
                format!("{} {}", asset.asset_number, asset.name),
            )
        })
        .collect();
    Ok(CheckOutcome::from_exceptions(count, pointers))
}

/// Every bank account has a statement covering the month end.
///
/// "Every bank account" is read off `account_resolution`, not off a register of our
/// own: an account nobody mapped is an account nothing can post to, and holding
/// a second list of banks would mean two answers to which ones exist. The
/// consequence is worth stating plainly — a bank Finance has not mapped is not
/// checked here, and the Account Links screen is where that becomes visible.
async fn check_bank_statements(
    pool: &PgPool,
    period: ClosePeriod,
) -> Result<CheckOutcome, AppError> {
    let end = last_day(period)?;
    let rows = sqlx::query(
        "SELECT m.account_code, m.unit_id, m.source_id AS qualifier,
                COALESCE(a.name, m.account_code) AS name,
                COUNT(*) OVER ()::bigint AS total
           FROM account_resolution m
           LEFT JOIN ledger_account a ON a.account_code = m.account_code
          WHERE m.role IN ('bank_giro', 'bank_savings')
            AND NOT EXISTS (SELECT 1 FROM bank_statement s
                             WHERE s.account_code = m.account_code
                               AND s.period_end >= $1)
          ORDER BY m.account_code LIMIT $2",
    )
    .bind(end)
    .bind(POINTER_CAP)
    .fetch_all(pool)
    .await?;
    let end_label = end.to_string();
    Ok(outcome_from(rows, "bank_account", move |row| {
        Ok(format!(
            "{} — nothing imported through {end_label}",
            row.try_get::<String, _>("name")?
        ))
    })?)
}

/// No bank line has been unmatched for longer than we allow.
///
/// Advisory. An unmatched line is not necessarily an error — a cheque takes as
/// long as it takes — but one still open after a month is either a mistake or a
/// thing nobody is chasing, and a close is when somebody should say which.
async fn check_unmatched_lines(
    pool: &PgPool,
    period: ClosePeriod,
) -> Result<CheckOutcome, AppError> {
    let end = last_day(period)?;
    let rows = sqlx::query(
        "SELECT l.line_id, l.value_date, l.description,
                ($1::date - l.value_date) AS days_open,
                COUNT(*) OVER ()::bigint AS total
           FROM bank_statement_line l
          WHERE l.value_date <= $1
            AND ($1::date - l.value_date) > $2
            AND NOT EXISTS (SELECT 1 FROM bank_line_match m WHERE m.line_id = l.line_id)
          ORDER BY l.value_date LIMIT $3",
    )
    .bind(end)
    .bind(i32::try_from(UNMATCHED_TOLERANCE_DAYS).unwrap_or(30))
    .bind(POINTER_CAP)
    .fetch_all(pool)
    .await?;
    Ok(outcome_from(rows, "bank_line", |row| {
        Ok(format!(
            "{} — {} days open",
            row.try_get::<String, _>("description")?,
            row.try_get::<i32, _>("days_open")?
        ))
    })?)
}

/// Nothing failed to post.
///
/// Pending, honestly, and it will stay Pending until some document carries a
/// failed state. Nothing in the schema does today: a bill is DRAFT, MATCHED,
/// POSTED, REJECTED or VOID, a payment is DRAFT or POSTED, and a posting either
/// happens inside its caller's transaction or the whole transaction rolls back
/// — so a half-posted document is not a state this system can reach, and
/// "nothing failed" has no rows to count.
///
/// It is on the checklist anyway, as a non-critical Pending, for two reasons. It
/// is the control an auditor asks for by name, and answering "we have no way to
/// tell" in the stored snapshot is worth more than the question not being asked.
/// And when a lane adds a queue that CAN fail — a nightly sales posting, an
/// acquirer file — this is the key it registers over, and every close from that
/// day forward is checked without anyone remembering to add it.
///
/// Non-critical precisely BECAUSE it is Pending: a critical check that can never
/// pass is a month that can never close.
async fn check_failed_postings(
    _pool: &PgPool,
    _period: ClosePeriod,
) -> Result<CheckOutcome, AppError> {
    Ok(CheckOutcome::pending(
        "no document carries a failed-posting state; a posting either completes \
         inside its caller's transaction or rolls the whole transaction back",
    ))
}

/// The rows a check found, turned into an outcome.
///
/// Every check runs the same window function — `COUNT(*) OVER ()` beside a
/// LIMIT — so the true count survives the cap without a second round trip.
fn outcome_from<F>(
    rows: Vec<sqlx::postgres::PgRow>,
    kind: &str,
    label: F,
) -> Result<CheckOutcome, AppError>
where
    F: Fn(&sqlx::postgres::PgRow) -> Result<String, AppError>,
{
    let Some(first) = rows.first() else {
        return Ok(CheckOutcome::Pass);
    };
    let total: i64 = first.try_get("total")?;
    let mut pointers = Vec::with_capacity(rows.len());
    for row in &rows {
        let id = row
            .try_get::<Uuid, _>(0)
            .map(|value| value.to_string())
            .or_else(|_| row.try_get::<String, _>(0))
            .unwrap_or_default();
        pointers.push(CheckPointer::new(kind, id, label(row)?));
    }
    Ok(CheckOutcome::from_exceptions(total, pointers))
}

// ---------------------------------------------------------------------------
// Closing, and reopening
// ---------------------------------------------------------------------------

/// What a close did, or would have done.
#[derive(Clone, Debug, Serialize)]
pub struct PeriodCloseOutcome {
    pub year: i32,
    pub month: i32,
    /// How many entries the month held. The figure the old `close_period`
    /// returned, kept because it is the one thing a person double-checks.
    pub entries_sealed: i64,
    pub checklist: crate::cloud::domain::CloseVerdict,
}

/// Close a month, if the month lets you.
///
/// The order matters and is the whole design. The checklist runs FIRST, against
/// the period while it is still open; if a critical check fails the close is
/// refused and the verdict comes back with it, so the screen shows what to fix
/// rather than "conflict". Only then does the row flip — inside the same
/// transaction as the event that records what the checklist said, because a
/// close whose evidence was written by a second statement is a close that can
/// exist without evidence.
pub async fn period_close(
    pool: &PgPool,
    year: i32,
    month_number: i32,
    actor: &str,
    reason: Option<&str>,
) -> Result<PeriodCloseOutcome, AppError> {
    let period = month(year, month_number)?;
    let verdict = period_checklist(pool, year, month_number).await?;
    if !verdict.may_close {
        return Err(AppError::Conflict(verdict.refusal()));
    }

    let (start, end) = bounds(period)?;
    let snapshot: Value = serde_json::to_value(&verdict)?;

    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE fiscal_period SET status='CLOSED', closed_by=$3, closed_at=now()
          WHERE year=$1 AND month=$2 AND status='OPEN'",
    )
    .bind(period.year as i16)
    .bind(period.month as i16)
    .bind(actor)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "period {} is not open",
            period.label()
        )));
    }
    sqlx::query(
        "INSERT INTO fiscal_period_event (event_id, year, month, event, actor, reason, checklist)
         VALUES ($1,$2,$3,'CLOSE',$4,$5,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(period.year as i16)
    .bind(period.month as i16)
    .bind(actor)
    .bind(reason.map(str::trim).filter(|value| !value.is_empty()))
    .bind(&snapshot)
    .execute(&mut *tx)
    .await?;

    // A date range rather than EXTRACT: it says the same thing, it can use the
    // index on `posting_date`, and it does not depend on how Postgres infers
    // the type of a bound value compared against a numeric.
    let sealed: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_entry
          WHERE posting_date >= $1 AND posting_date < $2",
    )
    .bind(start)
    .bind(end)
    .fetch_one(&mut *tx)
    .await?
    .try_get("n")?;
    tx.commit().await?;

    Ok(PeriodCloseOutcome {
        year: period.year,
        month: month_number,
        entries_sealed: sealed,
        checklist: verdict,
    })
}

/// Unseal a month, and say why in writing.
///
/// The reason is mandatory and it is not decoration: reopening is the one act in
/// this module that has no check behind it, so the record of WHY is the only
/// control there is. It is stored twice on purpose — as an event, which is
/// append-only, and denormalised onto the row, which every period list reads.
///
/// Closing again is a fresh close: the checklist runs from scratch, and it has
/// to pass again. That is the point of reopening rather than editing — whatever
/// was wrong is fixed in the open month and re-checked, instead of being
/// smuggled past a control that already said yes once.
pub async fn period_reopen(
    pool: &PgPool,
    year: i32,
    month_number: i32,
    actor: &str,
    reason: &str,
) -> Result<(), AppError> {
    let period = month(year, month_number)?;
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "a reopen needs a reason; it is the only record of why a sealed month was unsealed"
                .into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE fiscal_period
            SET status='OPEN', closed_by=NULL, closed_at=NULL,
                reopened_by=$3, reopened_at=now(), reopen_reason=$4
          WHERE year=$1 AND month=$2 AND status='CLOSED'",
    )
    .bind(period.year as i16)
    .bind(period.month as i16)
    .bind(actor)
    .bind(reason)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "period {} is not closed",
            period.label()
        )));
    }
    sqlx::query(
        "INSERT INTO fiscal_period_event (event_id, year, month, event, actor, reason)
         VALUES ($1,$2,$3,'REOPEN',$4,$5)",
    )
    .bind(Uuid::new_v4())
    .bind(period.year as i16)
    .bind(period.month as i16)
    .bind(actor)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// One close or reopen, as recorded.
#[derive(Clone, Debug, Serialize)]
pub struct PeriodEvent {
    pub event_id: Uuid,
    pub year: i32,
    pub month: i32,
    pub event: String,
    pub actor: String,
    pub reason: Option<String>,
    /// The checklist as it stood. Present on a close, absent on a reopen.
    pub checklist: Option<Value>,
    pub at: chrono::DateTime<Utc>,
}

/// What has happened to one month, most recent first.
pub async fn period_events(
    pool: &PgPool,
    year: i32,
    month_number: i32,
) -> Result<Vec<PeriodEvent>, AppError> {
    let period = month(year, month_number)?;
    let rows = sqlx::query(
        "SELECT event_id, year::int AS year, month::int AS month, event, actor, reason,
                checklist, at
           FROM fiscal_period_event
          WHERE year = $1 AND month = $2
          ORDER BY at DESC",
    )
    .bind(period.year as i16)
    .bind(period.month as i16)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PeriodEvent {
                event_id: row.try_get("event_id")?,
                year: row.try_get("year")?,
                month: row.try_get("month")?,
                event: row.try_get("event")?,
                actor: row.try_get("actor")?,
                reason: row.try_get("reason")?,
                checklist: row.try_get("checklist")?,
                at: row.try_get("at")?,
            })
        })
        .collect()
}
