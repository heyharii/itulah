//! One year's calendar, as a row.
//!
//! The whole calendar is one row and is loaded whole, because every rule it has
//! is a rule *between* its parts: a day that is not in the year, two days
//! sharing a date, a withdrawal of a day the calendar never held. A loader that
//! returned holidays one at a time could check none of them.
//!
//! What is stored is the set **as published** plus the append-only amendments.
//! The set in force is replayed on the way in — see
//! `domain::holiday::HolidayCalendar` for why storing both would be storing the
//! same facts twice.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    Authorization, CalendarAmendment, Holiday, HolidayCalendar, HolidayError,
};
use sqlx::{PgPool, Row};

/// A stored row that cannot be true. See `postgres::employment` for why this is
/// not a validation error.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The row disagrees with its own history."
    ))
}

fn invalid(error: HolidayError) -> AppError {
    if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Validation(error.to_string())
    }
}

fn decode(row: &sqlx::postgres::PgRow) -> Result<HolidayCalendar, AppError> {
    let year: i32 = row.try_get("year")?;
    let holidays: serde_json::Value = row.try_get("holidays")?;
    let published: serde_json::Value = row.try_get("published")?;
    let amendments: serde_json::Value = row.try_get("amendments")?;

    // Every one of these goes through the domain's constructor, so a row edited
    // by hand into a shape no operator could have produced fails to load rather
    // than becoming the year's red days.
    HolidayCalendar::try_new(
        year,
        serde_json::from_value::<Vec<Holiday>>(holidays)
            .map_err(|error| corrupt("published holidays", error.to_string()))?,
        serde_json::from_value::<Authorization>(published)
            .map_err(|error| corrupt("calendar authority", error.to_string()))?,
        serde_json::from_value::<Vec<CalendarAmendment>>(amendments)
            .map_err(|error| corrupt("calendar amendments", error.to_string()))?,
    )
    .map_err(|error| corrupt("holiday calendar", error.to_string()))
}

/// Which years have been published, oldest first.
pub async fn published_years(pool: &PgPool) -> Result<Vec<i32>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT year FROM holiday_calendar ORDER BY year")
            .fetch_all(pool)
            .await?,
    )
}

/// One year, or `None` when nobody has published it.
///
/// `None` is a real answer: a year nobody has entered is not an empty year, and
/// a leave request that spans it has to be refused rather than charged against
/// a calendar that does not exist.
pub async fn load_calendar(pool: &PgPool, year: i32) -> Result<Option<HolidayCalendar>, AppError> {
    let row = sqlx::query(
        "SELECT year, holidays, published, amendments FROM holiday_calendar WHERE year = $1",
    )
    .bind(year)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(decode).transpose()
}

/// Publish a year.
///
/// Refuses a year that already exists rather than replacing it. Republishing is
/// not an amendment: it would replace the approved set wholesale and take its
/// history with it. A year is published once and changed by amendment.
pub async fn publish_calendar(pool: &PgPool, calendar: &HolidayCalendar) -> Result<(), AppError> {
    let holidays = serde_json::to_value(calendar.as_published().collect::<Vec<_>>())?;
    let published = serde_json::to_value(calendar.published())?;
    let inserted = sqlx::query(
        "INSERT INTO holiday_calendar (year, holidays, published, amendments)
         VALUES ($1, $2, $3, '[]'::jsonb)
         ON CONFLICT (year) DO NOTHING",
    )
    .bind(calendar.year())
    .bind(&holidays)
    .bind(&published)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "the {} calendar has already been published; amend it rather than republishing",
            calendar.year()
        )));
    }
    Ok(())
}

/// Record an amendment.
///
/// The whole amendment list is rewritten rather than appended to by SQL,
/// because the list is validated as a *whole*: a withdrawal is legal only
/// against the set the earlier amendments produced. The domain is what enforces
/// that, so a write folds the calendar, amends it — which is where the refusal
/// happens — and stores the result.
pub async fn save_amendments(pool: &PgPool, calendar: &HolidayCalendar) -> Result<(), AppError> {
    let amendments = serde_json::to_value(calendar.amendments())?;
    let updated = sqlx::query(
        "UPDATE holiday_calendar
            SET amendments = $2, updated_at = now()
          WHERE year = $1",
    )
    .bind(calendar.year())
    .bind(&amendments)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(format!(
            "no calendar has been published for {}",
            calendar.year()
        )));
    }
    Ok(())
}

/// Turn a domain refusal into the right HTTP answer.
///
/// Exported because the handler and the leave module both raise these, and two
/// spellings of "is this a conflict or a bad request" is one spelling too many.
pub fn holiday_error(error: HolidayError) -> AppError {
    invalid(error)
}
