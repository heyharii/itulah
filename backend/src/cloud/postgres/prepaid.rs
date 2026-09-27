//! Prepayments, and the months they are used up in.
//!
//! # What this is not
//!
//! It is not the thing that puts money INTO a prepaid account. A supplier
//! invoice already does that — 0094 let a bill name a class-1 account, and
//! `Dr 1011301001 Asuransi Bayar Dimuka / Cr Hutang Supplier` posts today with
//! nothing here involved. A schedule attaches to that document, by the same
//! `(source_kind, source_id)` pair the journal carries, and from then on only
//! ever takes back out what the document put in. One economic event, one
//! writer: the alternative is the defect 0273 spent a migration undoing.
//!
//! # The one arithmetic decision
//!
//! A year of insurance at 1,000,001 rupiah does not divide by twelve. The
//! remainder goes to the EARLIEST months, one unit each, so:
//!
//!   * the allocations always sum to the schedule exactly, and a schedule can
//!     never end owing itself a rupiah;
//!   * the same month always computes the same figure, however often the run is
//!     replayed, because the figure depends on the month's INDEX and not on
//!     what has been posted so far.
//!
//! The second property is what makes a replay safe even before the unique key
//! catches it.
//!
//! # Why tax cannot get in here
//!
//! `1011302* Prepaid - PPh/VAT/PBB` is a tax credit: it is reclaimed against a
//! return, not amortised over months, and its life is a tax period rather than
//! a date range. So the prepaid account a schedule names has to be one somebody
//! mapped `prepaid_expense` to in that place's books, which is a statement by a
//! person that the account holds prepayments. Tax is its own domain and
//! borrowing this one's machinery would quietly make it this one's.
//!
//! # A schedule is written at a site and booked to its unit
//!
//! `prepaid_schedule.site_id` names the place that consumes the prepayment.
//! Since the books are kept per unit (0605) both legs of every month land in
//! the books of the unit that owns that site (`unit_of_site`), and the control
//! account is read per unit for the same reason.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

use super::ledger::{assert_category_for_account, Intent};
use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

/// A blank category box means no category, not a category called "".
///
/// Spelled once rather than at each call site: a form that cleared its box
/// sends `Some("")`, and the difference between that and `None` must not
/// decide whether a schedule can be written.
fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

/// What caused the entries this module writes.
const SOURCE_KIND: &str = "PREPAID_ALLOCATION";
const RULE_VERSION: &str = "prepaid_allocation/1";
/// The meaning a prepaid account has to be mapped to before a schedule may name
/// it. See the module note: this is the line tax does not cross.
const PREPAID_MEANING: &str = "prepaid_expense";

// ---------------------------------------------------------------------------
// What a screen is told
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidSchedule {
    pub schedule_id: Uuid,
    pub schedule_number: String,
    pub site_id: String,
    pub prepaid_account_code: String,
    pub prepaid_account_name: String,
    /// Which kind of prepayment this is — `INSURANCE`, `RENT_STORE` — on the
    /// chart where every prepayment is one account and is told apart by this.
    pub prepaid_category_code: Option<String>,
    /// The client's own word for that kind, joined here so a screen does not
    /// have to hold the category list to render one cell.
    pub prepaid_category_name: Option<String>,
    pub expense_account_code: String,
    pub expense_account_name: String,
    /// And which kind of expense the month becomes. Chosen once, by the person
    /// who wrote the schedule, and carried by every month it posts: a category
    /// re-derived each month could send March somewhere February did not go,
    /// which is the same reason the ACCOUNTS are named here rather than
    /// resolved afresh.
    pub expense_category_code: Option<String>,
    pub expense_category_name: Option<String>,
    /// The document that put the money there, named as the journal names it.
    pub source_kind: String,
    pub source_id: String,
    pub currency: String,
    pub amount_minor: i64,
    /// What has been taken out so far, and what is left. Both counted from the
    /// allocations, so they cannot disagree with the ledger.
    pub allocated_minor: i64,
    pub remaining_minor: i64,
    pub start_period: NaiveDate,
    pub end_period: NaiveDate,
    pub frequency: String,
    /// How many months the schedule covers, inclusive.
    pub periods: i64,
    pub periods_allocated: i64,
    pub status: String,
    pub memo: Option<String>,
    pub created_by: String,
    pub cancelled_at: Option<chrono::DateTime<chrono::Utc>>,
    pub cancelled_by: Option<String>,
    pub cancel_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidAllocation {
    pub allocation_id: Uuid,
    pub period_year: i32,
    pub period_month: i32,
    pub amount_minor: i64,
    pub entry_id: Uuid,
    pub entry_number: Option<String>,
    pub posted_by: String,
    pub posted_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidScheduleDocument {
    pub schedule: PrepaidSchedule,
    /// Oldest first: a schedule is read as a story.
    pub allocations: Vec<PrepaidAllocation>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePrepaidScheduleRequest {
    pub site_id: String,
    pub prepaid_account_code: String,
    /// Required when the prepaid account declares a family, which it does on
    /// the forty-account chart: `1401` is every prepayment the company has.
    #[serde(default)]
    pub prepaid_category_code: Option<String>,
    pub expense_account_code: String,
    /// Required when the expense account declares a family, which all four of
    /// them do.
    #[serde(default)]
    pub expense_category_code: Option<String>,
    pub source_kind: String,
    pub source_id: String,
    pub amount_minor: i64,
    /// Any day in the first month and any day in the last; both are taken back
    /// to the first of their month, because a schedule runs in whole months.
    pub start_period: NaiveDate,
    pub end_period: NaiveDate,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidAllocationRequest {
    pub year: i32,
    pub month: u32,
    /// One shop, or every place when absent.
    #[serde(default)]
    pub site_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidAllocationRun {
    pub year: i32,
    pub month: i32,
    pub posted: i64,
    /// Schedules whose month was already posted. A replay reports them rather
    /// than refusing: a run that cannot be repeated is a run nobody dares
    /// repeat after a failure halfway through.
    pub already_posted: i64,
    pub completed: i64,
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidReconciliationRow {
    /// Whose books: the schedules are summed into the unit that owns their
    /// site, because that is where the ledger holds the balance.
    pub unit_id: String,
    pub account_code: String,
    pub account_name: String,
    /// What the ledger holds on that account in that unit's books.
    pub gl_minor: i64,
    /// What the open schedules say is still to come.
    pub subledger_minor: i64,
    pub difference_minor: i64,
    pub open_schedules: i64,
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

/// Whole months from `start` to `end`, inclusive.
fn months_between(start: NaiveDate, end: NaiveDate) -> i64 {
    let years = i64::from(end.year() - start.year());
    let months = i64::from(end.month() as i32 - start.month() as i32);
    years * 12 + months + 1
}

/// The first of the month `n` months after `start`.
fn month_after(start: NaiveDate, n: i64) -> Option<NaiveDate> {
    let zero = i64::from(start.year()) * 12 + i64::from(start.month()) - 1 + n;
    let year = i32::try_from(zero.div_euclid(12)).ok()?;
    let month = u32::try_from(zero.rem_euclid(12) + 1).ok()?;
    NaiveDate::from_ymd_opt(year, month, 1)
}

/// The last day of the month a period falls in. An allocation is dated the day
/// the month it belongs to ends, which is where a month's expense belongs.
fn month_end(period: NaiveDate) -> Option<NaiveDate> {
    month_after(period, 1).and_then(|next| next.pred_opt())
}

/// What the `index`-th month of a schedule comes to.
///
/// The remainder goes to the earliest months, one unit each. Depends only on
/// the index, so a replay of any month computes what it computed before.
fn share(amount_minor: i64, periods: i64, index: i64) -> i64 {
    if periods <= 0 {
        return 0;
    }
    let base = amount_minor / periods;
    let remainder = amount_minor % periods;
    base + i64::from(index < remainder)
}

fn first_of_month(date: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const SCHEDULE_COLUMNS: &str = "s.schedule_id, s.schedule_number, s.site_id,
     s.prepaid_account_code, pa.name AS prepaid_account_name,
     s.prepaid_category_code, pk.name AS prepaid_category_name,
     s.expense_account_code, ea.name AS expense_account_name,
     s.expense_category_code, ek.name AS expense_category_name,
     s.source_kind, s.source_id, s.currency::text AS currency, s.amount_minor,
     s.start_period, s.end_period, s.frequency, s.status, s.memo,
     s.created_by, s.cancelled_at, s.cancelled_by, s.cancel_reason,
     COALESCE(a.allocated_minor, 0)::bigint AS allocated_minor,
     COALESCE(a.periods_allocated, 0)::bigint AS periods_allocated";

const SCHEDULE_FROM: &str = "FROM prepaid_schedule s
       JOIN ledger_account pa ON pa.account_code = s.prepaid_account_code
       JOIN ledger_account ea ON ea.account_code = s.expense_account_code
       LEFT JOIN line_category pk ON pk.category_code = s.prepaid_category_code
       LEFT JOIN line_category ek ON ek.category_code = s.expense_category_code
       LEFT JOIN (
            SELECT schedule_id,
                   SUM(amount_minor) AS allocated_minor,
                   COUNT(*)          AS periods_allocated
              FROM prepaid_allocation GROUP BY schedule_id
       ) a ON a.schedule_id = s.schedule_id";

fn to_schedule(row: &sqlx::postgres::PgRow) -> Result<PrepaidSchedule, AppError> {
    let amount: i64 = row.try_get("amount_minor")?;
    let allocated: i64 = row.try_get("allocated_minor")?;
    let start: NaiveDate = row.try_get("start_period")?;
    let end: NaiveDate = row.try_get("end_period")?;
    Ok(PrepaidSchedule {
        schedule_id: row.try_get("schedule_id")?,
        schedule_number: row.try_get("schedule_number")?,
        site_id: row.try_get("site_id")?,
        prepaid_account_code: row.try_get("prepaid_account_code")?,
        prepaid_category_code: row.try_get("prepaid_category_code")?,
        prepaid_category_name: row.try_get("prepaid_category_name")?,
        prepaid_account_name: row.try_get("prepaid_account_name")?,
        expense_account_code: row.try_get("expense_account_code")?,
        expense_category_code: row.try_get("expense_category_code")?,
        expense_category_name: row.try_get("expense_category_name")?,
        expense_account_name: row.try_get("expense_account_name")?,
        source_kind: row.try_get("source_kind")?,
        source_id: row.try_get("source_id")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_string(),
        amount_minor: amount,
        allocated_minor: allocated,
        remaining_minor: amount - allocated,
        start_period: start,
        end_period: end,
        frequency: row.try_get("frequency")?,
        periods: months_between(start, end),
        periods_allocated: row.try_get("periods_allocated")?,
        status: row.try_get("status")?,
        memo: row.try_get("memo")?,
        created_by: row.try_get("created_by")?,
        cancelled_at: row.try_get("cancelled_at")?,
        cancelled_by: row.try_get("cancelled_by")?,
        cancel_reason: row.try_get("cancel_reason")?,
    })
}

/// The schedules, newest first. A place and a status when they are named.
pub async fn prepaid_schedules(
    pool: &PgPool,
    site_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<PrepaidSchedule>, AppError> {
    let sql = format!(
        "SELECT {SCHEDULE_COLUMNS} {SCHEDULE_FROM}
          WHERE ($1::text IS NULL OR s.site_id = $1)
            AND ($2::text IS NULL OR s.status = $2)
          ORDER BY s.start_period DESC, s.schedule_number DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(status)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_schedule).collect()
}

/// A page of schedules, newest first, beside what every schedule the filters
/// match adds up to.
///
/// The bare list above stops at `limit` (100 unless asked) and says nothing,
/// so a card adding up "what is still to be charged" over it was adding up
/// the newest hundred. This pages on a keyset and carries the card figures
/// computed over the whole filtered set.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrepaidSchedulePage {
    pub rows: Vec<PrepaidSchedule>,
    pub next_cursor: Option<String>,
    /// Every schedule the unit and status filters match.
    pub total: i64,
    /// What those schedules have still to charge: amount less allocated.
    pub remaining_minor: i64,
    /// ACTIVE schedules among them whose span covers `period`, the month
    /// somebody is about to allocate. `None` when no period was asked about.
    pub due_in_period: Option<i64>,
}

/// Where the previous page stopped, in the list's own order.
#[derive(Serialize, Deserialize)]
struct ScheduleCursor {
    start_period: NaiveDate,
    schedule_number: String,
    schedule_id: Uuid,
}

pub async fn prepaid_schedule_page(
    pool: &PgPool,
    site_id: Option<&str>,
    status: Option<&str>,
    period: Option<NaiveDate>,
    cursor: Option<&str>,
    limit: Option<i64>,
) -> Result<PrepaidSchedulePage, AppError> {
    let cursor: Option<ScheduleCursor> = cursor.map(super::decode_cursor).transpose()?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let sql = format!(
        "SELECT {SCHEDULE_COLUMNS} {SCHEDULE_FROM}
          WHERE ($1::text IS NULL OR s.site_id = $1)
            AND ($2::text IS NULL OR s.status = $2)
            AND ($3::date IS NULL
                 OR (s.start_period, s.schedule_number, s.schedule_id)
                    < ($3::date, $4::text, $5::uuid))
          ORDER BY s.start_period DESC, s.schedule_number DESC, s.schedule_id DESC
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(status)
        .bind(cursor.as_ref().map(|c| c.start_period))
        .bind(cursor.as_ref().map(|c| c.schedule_number.clone()))
        .bind(cursor.as_ref().map(|c| c.schedule_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&ScheduleCursor {
            start_period: row.try_get("start_period")?,
            schedule_number: row.try_get("schedule_number")?,
            schedule_id: row.try_get("schedule_id")?,
        })?),
        _ => None,
    };
    let out = rows
        .iter()
        .map(to_schedule)
        .collect::<Result<Vec<_>, _>>()?;

    // The month a schedule covers is compared as a MONTH, the way the screen
    // reads it: a schedule starting on the 15th covers that whole month.
    let totals = sqlx::query(
        "SELECT COUNT(*)::bigint AS total,
                COALESCE(SUM(s.amount_minor - COALESCE(a.allocated_minor, 0)), 0)::bigint
                    AS remaining,
                COUNT(*) FILTER (
                    WHERE $3::date IS NOT NULL
                      AND s.status = 'ACTIVE'
                      AND date_trunc('month', s.start_period) <= date_trunc('month', $3::date)
                      AND date_trunc('month', $3::date) <= date_trunc('month', s.end_period)
                )::bigint AS due
           FROM prepaid_schedule s
           LEFT JOIN (
                SELECT schedule_id, SUM(amount_minor) AS allocated_minor
                  FROM prepaid_allocation GROUP BY schedule_id
           ) a ON a.schedule_id = s.schedule_id
          WHERE ($1::text IS NULL OR s.site_id = $1)
            AND ($2::text IS NULL OR s.status = $2)",
    )
    .bind(site_id)
    .bind(status)
    .bind(period)
    .fetch_one(pool)
    .await?;
    Ok(PrepaidSchedulePage {
        rows: out,
        next_cursor,
        total: totals.try_get("total")?,
        remaining_minor: totals.try_get("remaining")?,
        due_in_period: match period {
            Some(_) => Some(totals.try_get("due")?),
            None => None,
        },
    })
}

pub async fn prepaid_schedule_detail(
    pool: &PgPool,
    schedule_id: Uuid,
) -> Result<PrepaidScheduleDocument, AppError> {
    let sql = format!("SELECT {SCHEDULE_COLUMNS} {SCHEDULE_FROM} WHERE s.schedule_id = $1");
    let row = sqlx::query(&sql)
        .bind(schedule_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("prepaid schedule {schedule_id}")))?;
    let schedule = to_schedule(&row)?;

    let rows = sqlx::query(
        "SELECT al.allocation_id, al.period_year, al.period_month, al.amount_minor,
                al.entry_id, e.entry_number, al.posted_by, al.posted_at
           FROM prepaid_allocation al
           LEFT JOIN journal_entry e ON e.entry_id = al.entry_id
          WHERE al.schedule_id = $1
          ORDER BY al.period_year, al.period_month",
    )
    .bind(schedule_id)
    .fetch_all(pool)
    .await?;
    let allocations = rows
        .iter()
        .map(|row| {
            Ok(PrepaidAllocation {
                allocation_id: row.try_get("allocation_id")?,
                period_year: i32::from(row.try_get::<i16, _>("period_year")?),
                period_month: i32::from(row.try_get::<i16, _>("period_month")?),
                amount_minor: row.try_get("amount_minor")?,
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                posted_by: row.try_get("posted_by")?,
                posted_at: row.try_get("posted_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(PrepaidScheduleDocument {
        schedule,
        allocations,
    })
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Attach a schedule to a document that has already posted its debit.
pub async fn prepaid_schedule_create(
    pool: &PgPool,
    request: &CreatePrepaidScheduleRequest,
    actor: &str,
) -> Result<PrepaidScheduleDocument, AppError> {
    let start = first_of_month(request.start_period);
    let end = first_of_month(request.end_period);
    if end < start {
        return Err(AppError::Validation(
            "a schedule ends in the month it starts or later".into(),
        ));
    }
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a prepayment is a positive amount; there is nothing to spread".into(),
        ));
    }

    // The debit has to have happened. A schedule attached to nothing would
    // report a remaining balance the ledger has never heard of.
    let source_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM journal_entry
                        WHERE source_kind = $1 AND source_id = $2)",
    )
    .bind(request.source_kind.trim())
    .bind(request.source_id.trim())
    .fetch_one(pool)
    .await?;
    if !source_exists {
        return Err(AppError::Validation(format!(
            "nothing has posted under {} {} — a schedule describes how a prepayment \
             already in the books comes back out, so post the document first",
            request.source_kind.trim(),
            request.source_id.trim()
        )));
    }

    // The account has to be one somebody declared holds prepayments in the
    // books of the unit that owns that place. This is where tax stops:
    // `1011302*` is a tax credit and is mapped to `vat_in` and the PPh
    // meanings, never to this one.
    let unit = super::sites::unit_of_site(pool, &request.site_id).await?;
    let mapped: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM account_resolution
                        WHERE role = $1 AND unit_id = $2 AND account_code = $3)",
    )
    .bind(PREPAID_MEANING)
    .bind(&unit)
    .bind(request.prepaid_account_code.trim())
    .fetch_one(pool)
    .await?;
    if !mapped {
        return Err(AppError::Validation(format!(
            "{} is not mapped as '{PREPAID_MEANING}' in the books of {unit} — a prepaid \
             schedule may only draw down an account somebody has declared holds \
             prepayments there. Tax credits are reclaimed on a return, not amortised, \
             and belong to Tax.",
            request.prepaid_account_code.trim(),
        )));
    }

    let expense_class: Option<String> = sqlx::query_scalar(
        "SELECT root_class::text FROM ledger_account
          WHERE account_code = $1 AND NOT is_group",
    )
    .bind(request.expense_account_code.trim())
    .fetch_optional(pool)
    .await?;
    match expense_class.as_deref() {
        // 5 beban pokok, 6 beban usaha, 7 beban usaha lainnya, 8 non-operasional.
        Some("5") | Some("6") | Some("7") | Some("8") => {}
        Some(other) => {
            return Err(AppError::Validation(format!(
                "{} is in class {other}; a month of a prepayment becomes an EXPENSE, and \
                 crediting the prepaid account against anything else moves the money \
                 rather than consuming it",
                request.expense_account_code.trim()
            )))
        }
        None => {
            return Err(AppError::Validation(format!(
                "no postable account {} in the chart",
                request.expense_account_code.trim()
            )))
        }
    }

    // Both categories, while the person who chose the accounts is still on the
    // screen. Left to the monthly run, the refusal would arrive on the first of
    // a month, in front of whoever ran it, naming a schedule they did not write.
    let prepaid_category = trimmed(request.prepaid_category_code.as_deref());
    let expense_category = trimmed(request.expense_category_code.as_deref());
    assert_category_for_account(
        pool,
        request.prepaid_account_code.trim(),
        prepaid_category,
        Intent::Post,
    )
    .await?;
    assert_category_for_account(
        pool,
        request.expense_account_code.trim(),
        expense_category,
        Intent::Post,
    )
    .await?;

    let mut tx = pool.begin().await?;
    let number: String = sqlx::query_scalar(
        "SELECT 'PPD-' || to_char(nextval('prepaid_schedule_number_seq'), 'FM000000')",
    )
    .fetch_one(&mut *tx)
    .await?;
    let schedule_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO prepaid_schedule
           (schedule_id, schedule_number, site_id, prepaid_account_code,
            prepaid_category_code, expense_account_code, expense_category_code,
            source_kind, source_id, currency, amount_minor,
            start_period, end_period, memo, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'IDR'),$11,$12,$13,$14,$15)",
    )
    .bind(schedule_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(request.prepaid_account_code.trim())
    .bind(prepaid_category)
    .bind(request.expense_account_code.trim())
    .bind(expense_category)
    .bind(request.source_kind.trim())
    .bind(request.source_id.trim())
    .bind(request.currency.as_deref())
    .bind(request.amount_minor)
    .bind(start)
    .bind(end)
    .bind(request.memo.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    prepaid_schedule_detail(pool, schedule_id).await
}

/// Post one month of every schedule that covers it.
///
/// Replayable: a schedule whose month is already there is counted and skipped,
/// so a run interrupted halfway can simply be run again.
pub async fn prepaid_allocate(
    pool: &PgPool,
    request: &PrepaidAllocationRequest,
    actor: &str,
) -> Result<PrepaidAllocationRun, AppError> {
    let period = NaiveDate::from_ymd_opt(request.year, request.month, 1).ok_or_else(|| {
        AppError::Validation(format!("{}-{} is not a month", request.year, request.month))
    })?;
    let posting_date = month_end(period)
        .ok_or_else(|| AppError::Validation("that month has no end".to_string()))?;

    let rows = sqlx::query(
        "SELECT s.schedule_id, unit_of_site(s.site_id) AS unit_id,
                s.schedule_number, s.prepaid_account_code,
                s.prepaid_category_code, s.expense_account_code, s.expense_category_code,
                s.currency::text AS currency, s.amount_minor,
                s.start_period, s.end_period,
                EXISTS(SELECT 1 FROM prepaid_allocation a
                        WHERE a.schedule_id = s.schedule_id
                          AND a.period_year = $2 AND a.period_month = $3) AS done
           FROM prepaid_schedule s
          WHERE s.status = 'ACTIVE'
            AND s.start_period <= $1 AND s.end_period >= $1
            AND ($4::text IS NULL OR s.site_id = $4)
          ORDER BY s.schedule_number",
    )
    .bind(period)
    .bind(i16::try_from(request.year).unwrap_or_default())
    .bind(i16::try_from(request.month).unwrap_or_default())
    .bind(request.site_id.as_deref())
    .fetch_all(pool)
    .await?;

    let mut run = PrepaidAllocationRun {
        year: request.year,
        month: i32::try_from(request.month).unwrap_or_default(),
        posted: 0,
        already_posted: 0,
        completed: 0,
        amount_minor: 0,
    };

    for row in &rows {
        if row.try_get::<bool, _>("done")? {
            run.already_posted += 1;
            continue;
        }
        let schedule_id: Uuid = row.try_get("schedule_id")?;
        // Both legs land in the books of the unit that owns the schedule's site.
        let unit_id: String = row.try_get("unit_id")?;
        let number: String = row.try_get("schedule_number")?;
        let prepaid_account: String = row.try_get("prepaid_account_code")?;
        let prepaid_category: Option<String> = row.try_get("prepaid_category_code")?;
        let expense_account: String = row.try_get("expense_account_code")?;
        let expense_category: Option<String> = row.try_get("expense_category_code")?;
        let currency: String = row.try_get::<String, _>("currency")?.trim().to_string();
        let amount: i64 = row.try_get("amount_minor")?;
        let start: NaiveDate = row.try_get("start_period")?;
        let end: NaiveDate = row.try_get("end_period")?;

        let periods = months_between(start, end);
        let index = months_between(start, period) - 1;
        let share = share(amount, periods, index);
        if share <= 0 {
            continue;
        }

        let mut tx = pool.begin().await?;
        let intent = PostingIntent {
            posting_date,
            source_kind: SOURCE_KIND.into(),
            source_id: Some(schedule_id.to_string()),
            rule_version: RULE_VERSION.into(),
            currency,
            memo: Some(format!(
                "{number} — {} dari {periods} bulan",
                index.saturating_add(1)
            )),
            lines: vec![
                // The month becomes an expense, and the asset gives it up.
                //
                // Named as ACCOUNTS and not as meanings: the two accounts are
                // the schedule's own, chosen by the person who wrote it, and a
                // meaning resolved afresh at posting time could send March
                // somewhere February did not go. The CATEGORIES travel with
                // them for the same reason, and on a chart of forty they are
                // the half that says what this is: every prepayment is `1401`,
                // and only `RENT_STORE` beside it says the schedule is rent.
                PostingLine {
                    dimensions: Vec::new(),
                    account: LineAccount::Account {
                        account_code: expense_account.clone(),
                        category_code: expense_category.clone(),
                    },
                    unit_id: unit_id.clone(),
                    counter_unit_id: None,
                    debit_minor: share,
                    credit_minor: 0,
                    party_type: None,
                    party_id: None,
                    asset_id: None,
                    bank_account_id: None,
                    memo: None,
                },
                PostingLine {
                    dimensions: Vec::new(),
                    account: LineAccount::Account {
                        account_code: prepaid_account.clone(),
                        category_code: prepaid_category.clone(),
                    },
                    unit_id: unit_id.clone(),
                    counter_unit_id: None,
                    debit_minor: 0,
                    credit_minor: share,
                    party_type: None,
                    party_id: None,
                    asset_id: None,
                    bank_account_id: None,
                    memo: None,
                },
            ],
        };
        // The purpose is the month, so the journal's own unique key over
        // (source_kind, source_id, purpose) refuses a second posting of March
        // even if the subledger's row were somehow lost. Shaped `P2026_10`
        // because `journal_entry_purpose_check` allows `^[A-Z][A-Z0-9_]*$` —
        // a purpose is a label the ledger groups by, not a date.
        let purpose = format!("P{}_{:02}", request.year, request.month);
        let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
        sqlx::query(
            "INSERT INTO prepaid_allocation
               (allocation_id, schedule_id, period_year, period_month, amount_minor,
                entry_id, posted_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(schedule_id)
        .bind(i16::try_from(request.year).unwrap_or_default())
        .bind(i16::try_from(request.month).unwrap_or_default())
        .bind(share)
        .bind(posted.entry_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        let completed = close_if_finished(&mut tx, schedule_id).await?;
        tx.commit().await?;

        run.posted += 1;
        run.amount_minor += share;
        run.completed += i64::from(completed);
    }

    Ok(run)
}

/// A schedule whose months are all posted is finished, and says so.
async fn close_if_finished(
    tx: &mut Transaction<'_, Postgres>,
    schedule_id: Uuid,
) -> Result<bool, AppError> {
    let done = sqlx::query(
        "UPDATE prepaid_schedule s
            SET status = 'COMPLETED'
          WHERE s.schedule_id = $1
            AND s.status = 'ACTIVE'
            AND (SELECT COALESCE(SUM(a.amount_minor),0) FROM prepaid_allocation a
                  WHERE a.schedule_id = s.schedule_id) >= s.amount_minor",
    )
    .bind(schedule_id)
    .execute(&mut **tx)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// Stop a schedule. What it has already consumed stays consumed.
pub async fn prepaid_schedule_cancel(
    pool: &PgPool,
    schedule_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<PrepaidScheduleDocument, AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "say why the schedule is being stopped; the months it already posted stay \
             posted and somebody will ask"
                .into(),
        ));
    }
    let done = sqlx::query(
        "UPDATE prepaid_schedule
            SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2,
                cancel_reason = $3
          WHERE schedule_id = $1 AND status = 'ACTIVE'",
    )
    .bind(schedule_id)
    .bind(actor)
    .bind(reason.trim())
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "only a schedule that is still running can be stopped".into(),
        ));
    }
    prepaid_schedule_detail(pool, schedule_id).await
}

// ---------------------------------------------------------------------------
// The control account
// ---------------------------------------------------------------------------

/// What the ledger holds against what the open schedules say is still to come.
///
/// Per unit and per account, because that is how a prepaid balance is read on
/// a trial balance and how a difference is chased. A schedule counts in the
/// books of the unit that owns its site.
pub async fn prepaid_reconciliation(
    pool: &PgPool,
    as_of: Option<NaiveDate>,
) -> Result<Vec<PrepaidReconciliationRow>, AppError> {
    let rows = sqlx::query(
        "WITH gl AS (
             SELECT l.unit_id, l.account_code,
                    SUM(l.debit_minor - l.credit_minor)::bigint AS gl_minor
               FROM journal_line l
               JOIN journal_entry e ON e.entry_id = l.entry_id
              WHERE l.account_code IN (SELECT DISTINCT prepaid_account_code FROM prepaid_schedule)
                AND ($1::date IS NULL OR e.posting_date <= $1)
              GROUP BY l.unit_id, l.account_code
         ), sub AS (
             SELECT unit_of_site(s.site_id) AS unit_id,
                    s.prepaid_account_code AS account_code,
                    SUM(s.amount_minor
                        - COALESCE((SELECT SUM(a.amount_minor) FROM prepaid_allocation a
                                     WHERE a.schedule_id = s.schedule_id), 0))::bigint
                        AS subledger_minor,
                    COUNT(*)::bigint AS open_schedules
               FROM prepaid_schedule s
              WHERE s.status = 'ACTIVE'
              GROUP BY unit_of_site(s.site_id), s.prepaid_account_code
         )
         SELECT COALESCE(gl.unit_id, sub.unit_id) AS unit_id,
                COALESCE(gl.account_code, sub.account_code) AS account_code,
                a.name AS account_name,
                COALESCE(gl.gl_minor, 0)::bigint AS gl_minor,
                COALESCE(sub.subledger_minor, 0)::bigint AS subledger_minor,
                COALESCE(sub.open_schedules, 0)::bigint AS open_schedules
           FROM gl
           FULL OUTER JOIN sub
             ON sub.unit_id = gl.unit_id AND sub.account_code = gl.account_code
           JOIN ledger_account a
             ON a.account_code = COALESCE(gl.account_code, sub.account_code)
          ORDER BY 1, 2",
    )
    .bind(as_of)
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let gl: i64 = row.try_get("gl_minor")?;
            let sub: i64 = row.try_get("subledger_minor")?;
            Ok(PrepaidReconciliationRow {
                unit_id: row.try_get("unit_id")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                gl_minor: gl,
                subledger_minor: sub,
                difference_minor: gl - sub,
                open_schedules: row.try_get("open_schedules")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_year_that_does_not_divide_still_sums_to_itself() {
        let amount = 1_000_001;
        let total: i64 = (0..12).map(|index| share(amount, 12, index)).sum();
        assert_eq!(total, amount);
        // The remainder lands at the front, and the same month always computes
        // the same figure however often a run is replayed.
        assert_eq!(share(amount, 12, 0), 83_334);
        assert_eq!(share(amount, 12, 11), 83_333);
    }

    #[test]
    fn months_are_counted_inclusively() {
        let start = NaiveDate::from_ymd_opt(2026, 9, 1).unwrap_or_default();
        let end = NaiveDate::from_ymd_opt(2027, 8, 1).unwrap_or_default();
        assert_eq!(months_between(start, end), 12);
        assert_eq!(months_between(start, start), 1);
        assert_eq!(month_after(start, 12), NaiveDate::from_ymd_opt(2027, 9, 1));
        assert_eq!(month_end(start), NaiveDate::from_ymd_opt(2026, 9, 30));
    }
}
