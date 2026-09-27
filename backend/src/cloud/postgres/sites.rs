//! What a site is, read from its row and never from its id.
//!
//! Owner's ruling, 2026-09-27: no code may derive meaning from an id. Which
//! site is head office, what kind a site is, what clock it keeps and what to
//! print for it are columns on `site` (0474), and this module is the one door
//! the rest of the centre reads them through.
//!
//! # Head office is found by its kind
//!
//! `head_office_site_id` is the only place that says how, and it says it by
//! asking the SQL function of the same name (0474), which is also what a query
//! calls when it needs head office inline. Today head office is the one `site`
//! of kind `HO` — guarded to be the one by 0474's unique index. When the books
//! move from site to unit, it becomes the one `unit` of kind `HO`, and that
//! change is that one function's body and nothing else.
//!
//! # A day is cut where the site is
//!
//! Each site keeps an IANA time zone. A read about one site uses that site's;
//! a read about the whole company — a cloud-wide report, a cron job's "today"
//! — uses head office's, from the same lookup. `Asia/Jakarta` is what every
//! site held before the column existed, and is the answer only when there is
//! no site to ask.

use crate::cloud::application::AppError;
use crate::ids::SiteKind;
use chrono::{DateTime, Utc};

/// The time zone every site had before `site.timezone` existed, and the
/// answer when there is no row to ask.
pub const FALLBACK_TIMEZONE: &str = "Asia/Jakarta";

/// The site whose books carry every inter-unit balance: the one of kind `HO`.
///
/// Read on each call rather than cached for the life of the process. It is
/// one indexed row, and a process-wide cache would be wrong the moment two
/// databases share a process — which every `#[sqlx::test]` run does.
pub async fn head_office_site_id(executor: impl sqlx::PgExecutor<'_>) -> Result<String, AppError> {
    sqlx::query_scalar::<_, Option<String>>("SELECT head_office_site_id()")
        .fetch_one(executor)
        .await?
        .ok_or_else(|| {
            AppError::Configuration(
                "no site is head office: exactly one site must have kind HO".into(),
            )
        })
}

/// What kind a site is, from its row. `None` for a site the centre does not
/// hold, or one whose kind this build does not know.
pub async fn site_kind(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: &str,
) -> Result<Option<SiteKind>, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT kind FROM site WHERE id = $1")
            .bind(site_id)
            .fetch_optional(executor)
            .await?
            .as_deref()
            .and_then(SiteKind::from_code),
    )
}

/// Refuse a site that is not of the kind a caller needs, naming both.
pub async fn require_site_kind(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: &str,
    wanted: SiteKind,
    what: &str,
) -> Result<(), AppError> {
    match site_kind(executor, site_id).await? {
        Some(kind) if kind == wanted => Ok(()),
        Some(kind) => Err(AppError::Validation(format!(
            "{what} must be a {} site; {site_id} is {}",
            wanted.code(),
            kind.code()
        ))),
        None => Err(AppError::Validation(format!(
            "{what} names site {site_id}, which is not a site head office holds"
        ))),
    }
}

/// The time zone a site keeps its business day in: the site's own, or head
/// office's when no site is named or the one named is not held here.
pub async fn business_timezone(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: Option<&str>,
) -> Result<String, AppError> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(
                    (SELECT timezone FROM site WHERE id = $1),
                    (SELECT timezone FROM site WHERE id = head_office_site_id()),
                    $2)",
    )
    .bind(site_id)
    .bind(FALLBACK_TIMEZONE)
    .fetch_one(executor)
    .await?)
}

/// Head office's time zone: the clock a read about the whole company uses.
pub async fn head_office_timezone(executor: impl sqlx::PgExecutor<'_>) -> Result<String, AppError> {
    business_timezone(executor, None).await
}

/// Minutes east of UTC at one instant, where a site is — or head office, as
/// [`business_timezone`] chooses.
///
/// For the few readers that still cut a day in Rust (the pricing engine's
/// weekday rules, a report window, "today"). The offset of a zone at an
/// instant is Postgres' to know, not ours: it holds the tz database, and a
/// zone that ever moves its clocks is right here without a line changing.
pub async fn business_utc_offset_minutes(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: Option<&str>,
    at: DateTime<Utc>,
) -> Result<i32, AppError> {
    Ok(sqlx::query_scalar::<_, i32>(
        "SELECT (EXTRACT(EPOCH FROM ($2::timestamptz AT TIME ZONE chosen.zone_name)
                                  - ($2::timestamptz AT TIME ZONE 'UTC')) / 60)::int
           FROM (SELECT COALESCE(
                            (SELECT timezone FROM site WHERE id = $1),
                            (SELECT timezone FROM site WHERE id = head_office_site_id()),
                            $3) AS zone_name) chosen",
    )
    .bind(site_id)
    .bind(at)
    .bind(FALLBACK_TIMEZONE)
    .fetch_one(executor)
    .await?)
}

/// What to print for a site: its display code, or — for a site nobody has
/// given one — its id, so a printer is never refused over a missing label.
pub async fn display_code(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: &str,
) -> Result<String, AppError> {
    Ok(
        sqlx::query_scalar::<_, Option<String>>("SELECT code FROM site WHERE id = $1")
            .bind(site_id)
            .fetch_optional(executor)
            .await?
            .flatten()
            .unwrap_or_else(|| site_id.to_string()),
    )
}
