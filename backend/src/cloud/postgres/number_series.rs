//! Document numbers, from the series Finance edits (0701).
//!
//! One function mints every number — [`next_number`] — and it mints it inside
//! the caller's transaction: the counter row is upserted and locked there, so
//! a document that rolls back takes its number back with it, and two documents
//! in the same second cannot both be handed 41.
//!
//! The spelling is `domain::number_series`; this module only finds the series,
//! keys the counter and bumps it.

use crate::cloud::application::AppError;
use crate::cloud::domain::number_series::{Pattern, Reset};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, Row};

// The kinds, as `number_series.document_kind` spells them. One constant per
// minting site's kind, so a typo is a compile error rather than a refusal.
pub const JOURNAL_ENTRY: &str = "JOURNAL_ENTRY";
pub const CASH_OUT: &str = "CASH_OUT";
pub const CASH_IN: &str = "CASH_IN";
pub const CASH_TRANSFER: &str = "CASH_TRANSFER";
pub const SUPPLIER_PAYMENT: &str = "SUPPLIER_PAYMENT";
pub const SUPPLIER_CREDIT_NOTE: &str = "SUPPLIER_CREDIT_NOTE";
pub const SUPPLIER_ADVANCE: &str = "SUPPLIER_ADVANCE";
pub const PAYMENT_INSTRUCTION: &str = "PAYMENT_INSTRUCTION";
pub const STORE_DEPOSIT: &str = "STORE_DEPOSIT";
pub const CORRECTION: &str = "CORRECTION";
pub const ADVANCE: &str = "ADVANCE";
pub const FINANCING_FACILITY: &str = "FINANCING_FACILITY";
pub const PREPAID_SCHEDULE: &str = "PREPAID_SCHEDULE";
pub const FIXED_ASSET: &str = "FIXED_ASSET";
pub const STORE_EXPENSE: &str = "STORE_EXPENSE";
pub const EXPENSE_CLAIM: &str = "EXPENSE_CLAIM";
pub const CLAIM_PAYOUT: &str = "CLAIM_PAYOUT";
pub const STORE_BANKING: &str = "STORE_BANKING";
pub const REMITTANCE: &str = "REMITTANCE";
pub const OUTFLOW: &str = "OUTFLOW";
pub const CASH_HANDOVER: &str = "CASH_HANDOVER";
pub const PETTY_REPLENISH: &str = "PETTY_REPLENISH";

fn pattern_error(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

/// The next number of one kind, for a document dated `on` in `unit_id`'s
/// books.
///
/// `unit_id` is the unit whose books the document is in, when it has one. It
/// is needed only when the series prints `{UNIT}`; a document that has no unit
/// passes `None`, and a series edited to print the unit is refused for such a
/// kind when it is saved (`unit_aware`), not here at the till.
pub async fn next_number(
    connection: &mut PgConnection,
    kind: &str,
    on: NaiveDate,
    unit_id: Option<&str>,
) -> Result<String, AppError> {
    let row = sqlx::query("SELECT pattern, reset FROM number_series WHERE document_kind = $1")
        .bind(kind)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| {
            AppError::Configuration(format!("no number series is defined for {kind}"))
        })?;
    let raw: String = row.try_get("pattern")?;
    let reset_code: String = row.try_get("reset")?;
    let pattern = Pattern::parse(&raw).map_err(|error| {
        AppError::Configuration(format!("the {kind} number series is unreadable: {error}"))
    })?;
    let reset = Reset::parse(&reset_code).ok_or_else(|| {
        AppError::Configuration(format!("the {kind} number series resets {reset_code}"))
    })?;

    let (scope_key, unit_code) = if pattern.has_unit() {
        let unit = unit_id.ok_or_else(|| {
            AppError::Validation(format!(
                "{kind} is numbered per unit and this document names no unit"
            ))
        })?;
        let code: String = sqlx::query_scalar("SELECT code FROM unit WHERE id = $1")
            .bind(unit)
            .fetch_optional(&mut *connection)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("there is no unit {unit}")))?;
        (unit.to_owned(), Some(code))
    } else {
        (String::new(), None)
    };
    let period_key = reset.period_key(on.year(), on.month());

    let value: i64 = sqlx::query_scalar(
        "INSERT INTO number_series_counter (document_kind, pattern, scope_key, period_key, last_value)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (document_kind, pattern, scope_key, period_key)
         DO UPDATE SET last_value = number_series_counter.last_value + 1
         RETURNING last_value",
    )
    .bind(kind)
    .bind(&raw)
    .bind(&scope_key)
    .bind(&period_key)
    .fetch_one(&mut *connection)
    .await?;

    pattern
        .render(unit_code.as_deref(), on.year(), on.month(), value)
        .map_err(pattern_error)
}

// ---------------------------------------------------------------------------
// The settings screen
// ---------------------------------------------------------------------------

/// One series, as `GET /api/v1/finance/number-series` lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NumberSeries {
    pub document_kind: String,
    pub label: String,
    /// `{UNIT}`, `{YYYY}`, `{YY}`, `{MM}` and one `{###}` sequence.
    pub pattern: String,
    /// `MONTHLY`, `YEARLY` or `NEVER`.
    pub reset: String,
    /// Whether `{UNIT}` may appear: the kind's documents each name one unit.
    pub unit_aware: bool,
    /// What a number would look like for a document dated today in head
    /// office's books — the pattern read back, not a number reserved.
    pub example: String,
    pub updated_by: String,
    #[cfg_attr(feature = "ts", ts(type = "string"))]
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NumberSeriesList {
    pub items: Vec<NumberSeries>,
}

/// `PUT /api/v1/finance/number-series/{kind}`. Either field may be left out.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct NumberSeriesPatch {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub pattern: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub reset: Option<String>,
}

async fn example(pool: &PgPool, pattern: &str, today: NaiveDate) -> Result<String, AppError> {
    let head_office: Option<String> =
        sqlx::query_scalar("SELECT code FROM unit WHERE kind = 'HO' ORDER BY id LIMIT 1")
            .fetch_optional(pool)
            .await?;
    Ok(Pattern::parse(pattern)
        .and_then(|pattern| {
            pattern.render(
                Some(head_office.as_deref().unwrap_or("HO")),
                today.year(),
                today.month(),
                1,
            )
        })
        .unwrap_or_else(|error| error.to_string()))
}

async fn to_series(
    pool: &PgPool,
    row: &sqlx::postgres::PgRow,
    today: NaiveDate,
) -> Result<NumberSeries, AppError> {
    let pattern: String = row.try_get("pattern")?;
    Ok(NumberSeries {
        document_kind: row.try_get("document_kind")?,
        label: row.try_get("label")?,
        example: example(pool, &pattern, today).await?,
        pattern,
        reset: row.try_get("reset")?,
        unit_aware: row.try_get("unit_aware")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

const COLUMNS: &str = "document_kind, label, pattern, reset, unit_aware, updated_by, updated_at";

/// Every series. `today` is the business day (`state.clock`), for the
/// examples only.
pub async fn list_number_series(
    pool: &PgPool,
    today: NaiveDate,
) -> Result<NumberSeriesList, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM number_series ORDER BY label"
    ))
    .fetch_all(pool)
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        items.push(to_series(pool, row, today).await?);
    }
    Ok(NumberSeriesList { items })
}

/// Change how one kind is numbered from its next document on.
///
/// The pattern must print whatever its reset turns on, and may print the unit
/// only for a kind whose documents name one. Numbers already issued are not
/// touched: they are quoted back by suppliers and auditors, and a number that
/// changed after it was printed would be two numbers for one document.
pub async fn put_number_series(
    pool: &PgPool,
    kind: &str,
    patch: NumberSeriesPatch,
    actor: &str,
    today: NaiveDate,
) -> Result<NumberSeries, AppError> {
    let kind = kind.trim().to_ascii_uppercase();
    let current = sqlx::query(&format!(
        "SELECT {COLUMNS} FROM number_series WHERE document_kind = $1"
    ))
    .bind(&kind)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("number series {kind}")))?;

    let raw = patch
        .pattern
        .as_deref()
        .map(str::trim)
        .map(str::to_owned)
        .unwrap_or(current.try_get::<String, _>("pattern")?);
    let reset_code = patch
        .reset
        .as_deref()
        .map(|reset| reset.trim().to_ascii_uppercase())
        .unwrap_or(current.try_get::<String, _>("reset")?);
    let reset = Reset::parse(&reset_code).ok_or_else(|| {
        AppError::Validation(format!(
            "reset is one of {}",
            Reset::ALL.map(Reset::code).join(", ")
        ))
    })?;
    let pattern = Pattern::parse(&raw).map_err(pattern_error)?;
    pattern.check_reset(reset).map_err(pattern_error)?;
    let unit_aware: bool = current.try_get("unit_aware")?;
    if pattern.has_unit() && !unit_aware {
        return Err(AppError::Validation(format!(
            "{kind} documents do not belong to one unit, so the pattern cannot print {{UNIT}}"
        )));
    }

    let row = sqlx::query(&format!(
        "UPDATE number_series
            SET pattern = $2, reset = $3, updated_by = $4, updated_at = now()
          WHERE document_kind = $1
      RETURNING {COLUMNS}"
    ))
    .bind(&kind)
    .bind(&raw)
    .bind(reset.code())
    .bind(actor)
    .fetch_one(pool)
    .await?;
    to_series(pool, &row, today).await
}
