//! What a site is, read from its row and never from its id.
//!
//! Owner's ruling, 2026-09-27: no code may derive meaning from an id. Which
//! site is head office, what kind a site is, what clock it keeps and what to
//! print for it are columns on `site` (0603), and this module is the one door
//! the rest of the centre reads them through.
//!
//! # Head office is found by its kind
//!
//! Two questions, and they are not the same one since the books moved to
//! units (0605):
//!
//! * **Whose books** — [`head_office_unit_id`], the one `unit` of kind `HO`.
//!   Every inter-unit balance, every external party's account (I4) and every
//!   "head office's books" in a posting rule asks this. It reads the SQL
//!   function of the same name, which is also what a query calls inline.
//! * **Which premises** — [`head_office_site_id`], the one `site` of kind
//!   `HO` (0603): where head office's goods are, the Gudang. A stock movement,
//!   a dispatch or a count asks this, never the books.
//!
//! And the one bridge between them, which goes one way: [`unit_of_site`]. A
//! document that happens at a site — a receipt at the Gudang, a sale at a
//! shop — is booked to the unit that owns the site (`site.unit_id`). There is
//! no answer the other way round: a unit may own several premises, and "which
//! site's books" is a question the ledger stopped asking.
//!
//! # A day is cut where the site is
//!
//! Each site keeps an IANA time zone. A read about one site uses that site's;
//! a read about the whole company — a cloud-wide report, a cron job's "today"
//! — uses head office's, from the same lookup. `Asia/Jakarta` is what every
//! site held before the column existed, and is the answer only when there is
//! no site to ask.
//!
//! A unit (0600) has no clock of its own: it keeps its site's —
//! head office's site for the head-office unit, a store's shop for a store
//! (`unit_business_timezone`). HR's days, which belong to units, are cut with
//! [`unit_utc_offset_minutes`].

use crate::cloud::application::AppError;
use crate::ids::SiteKind;
use chrono::{DateTime, Utc};

/// Head office's books: the one unit of kind `HO` (0600, 0605).
///
/// What a posting rule, the inter-unit balancer and every "head office's
/// side" read. Read on each call rather than cached for the life of the
/// process. It is one indexed row, and a process-wide cache would be wrong the
/// moment two databases share a process — which every `#[sqlx::test]` run
/// does.
pub async fn head_office_unit_id(executor: impl sqlx::PgExecutor<'_>) -> Result<String, AppError> {
    sqlx::query_scalar::<_, Option<String>>("SELECT head_office_unit_id()")
        .fetch_one(executor)
        .await?
        .ok_or_else(|| {
            AppError::Configuration(
                "no unit is head office: exactly one unit must have kind HO".into(),
            )
        })
}

/// The unit whose books a site's goods and documents are booked to.
///
/// The model's one translation from a premises to the books (`site.unit_id`,
/// 0600; `unit_of_site`, 0605). A site the centre does not hold is refused by
/// name rather than booked somewhere plausible.
pub async fn unit_of_site(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: &str,
) -> Result<String, AppError> {
    sqlx::query_scalar::<_, Option<String>>("SELECT unit_of_site($1)")
        .bind(site_id)
        .fetch_one(executor)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("site {site_id}")))
}

/// Whether a unit exists. For the handlers and rules that take a unit from a
/// request and would otherwise fail on a foreign key with no sentence.
pub async fn unit_exists(
    executor: impl sqlx::PgExecutor<'_>,
    unit_id: &str,
) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM unit WHERE id = $1)")
            .bind(unit_id)
            .fetch_one(executor)
            .await?,
    )
}

/// The premises a unit owns (`site.unit_id`, 0600), by id: a store's shop, or
/// head office's sites, which may be several. Empty for a unit with none yet,
/// or for an id no unit has.
///
/// The way from a unit's reach to the figures that are a site's: what a unit
/// may see is what happened at these.
pub async fn sites_of_unit(
    executor: impl sqlx::PgExecutor<'_>,
    unit_id: &str,
) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT id FROM site WHERE unit_id = $1 ORDER BY id")
            .bind(unit_id)
            .fetch_all(executor)
            .await?,
    )
}

/// Head office's premises: the one site of kind `HO`, the Gudang (0603).
///
/// For goods — where head office's stock is, where a dispatch leaves from.
/// Never for the books: those are [`head_office_unit_id`]'s.
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

/// The site a pool stands at, read from its row (`operational_pool.site_id`),
/// never from the first segment of its id: a pool id is a label, and the
/// Gudang's pools kept `dc.…` whatever the site is called. `None` for a pool
/// the centre does not hold.
pub async fn pool_site_id(
    executor: impl sqlx::PgExecutor<'_>,
    pool_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT site_id FROM operational_pool WHERE id = $1")
            .bind(pool_id)
            .fetch_optional(executor)
            .await?,
    )
}

/// A site's pool of one role, from the rows (0610): the one its template made,
/// or the one it always had under an older spelling. A legacy per-destination
/// leaf and a return pool are never "the" pool of their role. `None` when the
/// site has none.
pub async fn pool_of_role(
    executor: impl sqlx::PgExecutor<'_>,
    site_id: &str,
    role: crate::pool_role::PoolRole,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT id FROM operational_pool
          WHERE site_id = $1 AND role = $2 AND active AND is_placement
            AND destination_store_id IS NULL AND origin_unit_id IS NULL
          ORDER BY display_order, id
          LIMIT 1",
    )
    .bind(site_id)
    .bind(role.code())
    .fetch_optional(executor)
    .await?)
}

/// The return pool a warehouse site keeps for the store unit that owns
/// `origin_site_id` (0610): where that shop's returned goods land, to be
/// inspected. `None` when the warehouse keeps none for it.
pub async fn return_pool_for(
    executor: impl sqlx::PgExecutor<'_>,
    warehouse_site_id: &str,
    origin_site_id: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT pool.id FROM operational_pool pool
           JOIN site origin ON origin.unit_id = pool.origin_unit_id
          WHERE pool.site_id = $1 AND origin.id = $2
            AND pool.role = 'RETURN' AND pool.active AND pool.is_placement
          ORDER BY pool.id
          LIMIT 1",
    )
    .bind(warehouse_site_id)
    .bind(origin_site_id)
    .fetch_optional(executor)
    .await?)
}

/// Minutes east of UTC at one instant, where a site is — its own zone, or
/// head office's when no site is named or the one named is not held here
/// (`site_business_timezone`, 0603).
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
        "SELECT (EXTRACT(EPOCH FROM ($2::timestamptz AT TIME ZONE site_business_timezone($1))
                                  - ($2::timestamptz AT TIME ZONE 'UTC')) / 60)::int",
    )
    .bind(site_id)
    .bind(at)
    .fetch_one(executor)
    .await?)
}

/// Minutes east of UTC at one instant where a unit keeps its day: the zone of
/// the unit's site — head office's site for the head-office unit, a store's
/// shop for a store — or head office's for a unit with no site
/// (`unit_business_timezone`, 0603).
///
/// What HR cuts a day with: a punch, a roster day and a payroll month belong
/// to a unit, and the unit's clock is its site's. The SQL function is the one
/// definition; this reads it so that Rust and SQL cannot disagree.
pub async fn unit_utc_offset_minutes(
    executor: impl sqlx::PgExecutor<'_>,
    unit_id: &str,
    at: DateTime<Utc>,
) -> Result<i32, AppError> {
    Ok(sqlx::query_scalar::<_, i32>(
        "SELECT (EXTRACT(EPOCH FROM ($2::timestamptz AT TIME ZONE unit_business_timezone($1))
                                  - ($2::timestamptz AT TIME ZONE 'UTC')) / 60)::int",
    )
    .bind(unit_id)
    .bind(at)
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
