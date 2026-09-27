//! The register of units — head office and the stores — and who is in charge
//! of each.
//!
//! Not `units.rs`: that module is units of *measure* (PCS, LUSIN), which is
//! older than this vocabulary and keeps its name. Here "unit" means what the
//! glossary says it means: the organisation that owns books, people and store
//! money (`CONTEXT.md`, "The organisation"; migrations 0450–0452).
//!
//! Three things live here:
//!
//! * the list the hub's Units screen shows — code, name, kind, status, the
//!   sites each unit owns and its current PIC;
//! * appointing a PIC, which closes the predecessor's span and opens the
//!   successor's in one transaction, after the domain has said the person may
//!   hold it (`domain::require_pic_eligible`);
//! * [`book_site_of_unit`], the one place that answers "which site's books
//!   does this unit's posting land in" while the ledger is still kept per site.

use crate::cloud::application::AppError;
use crate::cloud::domain::{require_pic_eligible, UnitId};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};

/// A premises one unit owns.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitSite {
    pub id: String,
    pub name: String,
    pub kind: String,
}

/// Who answers for a unit, from when, and who said so.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitPic {
    pub employee_id: String,
    pub employee_code: String,
    pub name: Option<String>,
    pub valid_from: NaiveDate,
    /// The first day it no longer held; `None` while it stands.
    pub valid_to: Option<NaiveDate>,
    pub set_by: String,
    pub set_at: DateTime<Utc>,
    pub reason: String,
}

/// One unit as the hub lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitView {
    /// Internal. Routes take it; screens show `code` and `name`.
    pub id: String,
    /// The client's code: `HO`, `C001` … `C013`.
    pub code: String,
    pub name: String,
    /// `HO`, `STORE` or `ONLINE`.
    pub kind: String,
    /// `ACTIVE` or `CLOSED`.
    pub status: String,
    pub sites: Vec<UnitSite>,
    /// People with an open posting here today.
    pub headcount: i64,
    /// The PIC in charge today — `None` when nobody has been appointed, or when
    /// the one appointed is no longer employed or no longer posted here.
    pub pic: Option<UnitPic>,
}

fn pic_from(row: &sqlx::postgres::PgRow) -> Result<UnitPic, AppError> {
    Ok(UnitPic {
        employee_id: row.try_get("employee_id")?,
        employee_code: row.try_get("employee_code")?,
        name: row.try_get("full_name")?,
        valid_from: row.try_get("valid_from")?,
        valid_to: row.try_get("valid_to")?,
        set_by: row.try_get("set_by")?,
        set_at: row.try_get("set_at")?,
        reason: row.try_get("reason")?,
    })
}

/// The appointment in force on `on` for each unit that has one.
///
/// "In force" is the span covering the day **and** the person still employed
/// and posted at the unit that day. A PIC transferred to another store stops
/// answering for this one the day the posting ends, whether or not a successor
/// has been appointed: somebody who works elsewhere is not in charge here.
const PIC_IN_FORCE: &str = "
    SELECT p.unit_id, p.employee_id, e.code AS employee_code, pr.full_name,
           p.valid_from, p.valid_to, p.set_by, p.set_at, p.reason
      FROM unit_pic p
      JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
      LEFT JOIN employee_profile pr ON pr.employee_id = p.employee_id
     WHERE p.valid_from <= $1
       AND (p.valid_to IS NULL OR p.valid_to > $1)
       AND EXISTS (SELECT 1 FROM employee_assignment a
                    WHERE a.employee_id = p.employee_id
                      AND a.unit_id = p.unit_id
                      AND a.valid_from <= $1
                      AND (a.valid_to IS NULL OR a.valid_to >= $1))";

/// Every unit, head office first, with its sites, headcount and PIC on `on`.
pub async fn list_unit_register(pool: &PgPool, on: NaiveDate) -> Result<Vec<UnitView>, AppError> {
    let rows = sqlx::query(
        "SELECT u.id, u.code, u.name, u.kind, u.status,
                (SELECT count(*) FROM employee_assignment a
                  WHERE a.unit_id = u.id
                    AND a.valid_from <= $1
                    AND (a.valid_to IS NULL OR a.valid_to >= $1)) AS headcount
           FROM unit u
          ORDER BY (u.kind = 'HO') DESC, u.code",
    )
    .bind(on)
    .fetch_all(pool)
    .await?;

    let site_rows = sqlx::query("SELECT id, name, kind, unit_id FROM site ORDER BY id")
        .fetch_all(pool)
        .await?;
    let pic_rows = sqlx::query(PIC_IN_FORCE).bind(on).fetch_all(pool).await?;

    let mut units = Vec::with_capacity(rows.len());
    for row in &rows {
        let id: String = row.try_get("id")?;
        let mut sites = Vec::new();
        for site in &site_rows {
            if site.try_get::<String, _>("unit_id")? == id {
                sites.push(UnitSite {
                    id: site.try_get("id")?,
                    name: site.try_get("name")?,
                    kind: site.try_get("kind")?,
                });
            }
        }
        let mut pic = None;
        for candidate in &pic_rows {
            if candidate.try_get::<String, _>("unit_id")? == id {
                pic = Some(pic_from(candidate)?);
            }
        }
        units.push(UnitView {
            id,
            code: row.try_get("code")?,
            name: row.try_get("name")?,
            kind: row.try_get("kind")?,
            status: row.try_get("status")?,
            sites,
            headcount: row.try_get("headcount")?,
            pic,
        });
    }
    Ok(units)
}

/// Every appointment one unit has had, newest first.
pub async fn unit_pic_history(pool: &PgPool, unit: &str) -> Result<Vec<UnitPic>, AppError> {
    let rows = sqlx::query(
        "SELECT p.employee_id, e.code AS employee_code, pr.full_name,
                p.valid_from, p.valid_to, p.set_by, p.set_at, p.reason
           FROM unit_pic p
           JOIN employee e ON e.id = p.employee_id
           LEFT JOIN employee_profile pr ON pr.employee_id = p.employee_id
          WHERE p.unit_id = $1
          ORDER BY p.valid_from DESC, p.id DESC",
    )
    .bind(unit)
    .fetch_all(pool)
    .await?;
    rows.iter().map(pic_from).collect()
}

/// The kind of a unit (`HO`, `STORE`, `ONLINE`), or `None` for no such unit.
pub async fn unit_kind_of(pool: &PgPool, unit: &str) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar("SELECT kind FROM unit WHERE id = $1")
        .bind(unit)
        .fetch_optional(pool)
        .await?)
}

/// Is this employee the PIC in force at `unit` on `on`?
pub async fn is_pic_of(
    pool: &PgPool,
    employee_id: &str,
    unit: &str,
    on: NaiveDate,
) -> Result<bool, AppError> {
    let sql = format!(
        "SELECT 1 FROM ({PIC_IN_FORCE}) AS pic WHERE pic.unit_id = $2 AND pic.employee_id = $3"
    );
    let found: Option<i32> = sqlx::query_scalar(&sql)
        .bind(on)
        .bind(unit)
        .bind(employee_id)
        .fetch_optional(pool)
        .await?;
    Ok(found.is_some())
}

/// Put somebody in charge of a unit from `valid_from`.
///
/// The standing appointment, if there is one, is closed on the same day — its
/// span becomes `[its start, valid_from)` — and the new one opens. One
/// transaction, so no instant has two PICs or none because of this call.
///
/// Refused when:
///
/// * the unit does not exist, or is closed;
/// * the person is not an active employee posted at the unit on `valid_from`
///   (the domain's rule, [`require_pic_eligible`]; the trigger in 0452 checks
///   it again);
/// * the standing appointment starts after `valid_from` — a successor cannot
///   take over before their predecessor began, and backdating over somebody's
///   span is rewriting history rather than recording it;
/// * the same person already holds the standing appointment.
pub async fn appoint_unit_pic(
    pool: &PgPool,
    unit: &UnitId,
    employee_id: &str,
    valid_from: NaiveDate,
    actor: &str,
    reason: &str,
) -> Result<(), AppError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "say why this person is being put in charge".to_owned(),
        ));
    }
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM unit WHERE id = $1")
        .bind(unit.as_str())
        .fetch_optional(pool)
        .await?;
    match status.as_deref() {
        None => return Err(AppError::NotFound(format!("unit {unit}"))),
        Some("ACTIVE") => {}
        Some(other) => {
            return Err(AppError::Conflict(format!(
                "unit {unit} is {other}, so nobody can be put in charge of it"
            )))
        }
    }

    let record = super::load_employee(pool, employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {employee_id}")))?;
    require_pic_eligible(&record.employee, &record.assignments, unit, valid_from)
        .map_err(|error| AppError::Conflict(error.to_string()))?;

    let mut tx = pool.begin().await?;
    let standing = sqlx::query(
        "SELECT id, employee_id, valid_from FROM unit_pic
          WHERE unit_id = $1 AND valid_to IS NULL
          FOR UPDATE",
    )
    .bind(unit.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(standing) = standing {
        let holder: String = standing.try_get("employee_id")?;
        let since: NaiveDate = standing.try_get("valid_from")?;
        if holder == employee_id {
            return Err(AppError::Conflict(format!(
                "{employee_id} has been in charge of {unit} since {since} already"
            )));
        }
        if since > valid_from {
            return Err(AppError::Conflict(format!(
                "the standing appointment at {unit} starts on {since}; a successor \
                 cannot take over before that"
            )));
        }
        let id: i64 = standing.try_get("id")?;
        sqlx::query("UPDATE unit_pic SET valid_to = $2 WHERE id = $1")
            .bind(id)
            .bind(valid_from)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "INSERT INTO unit_pic (unit_id, employee_id, valid_from, set_by, reason)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(unit.as_str())
    .bind(employee_id)
    .bind(valid_from)
    .bind(actor)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The site a unit's journal lines are booked at, while the ledger is still
/// kept per site.
///
/// Every posting a unit makes — a payroll accrual, a sanctioned claim, a
/// leaver's statement — names a `site_id` today, because `journal_line` is
/// keyed by site; the books move to `unit_id` in a later step. Until then this
/// is the one answer to "which site's books": the unit's only site. Head
/// office's is the Gudang (`dc`), a store's is its shop — exactly what the
/// dropped `org_place.site_id` used to say.
///
/// A unit with no site, or with several, is refused by name rather than
/// guessed at: which of two premises a unit's payroll lands on is a decision
/// about the books, and it belongs to the step that moves them.
pub async fn book_site_of_unit(
    executor: impl sqlx::PgExecutor<'_>,
    unit: &str,
) -> Result<String, AppError> {
    let sites: Vec<String> =
        sqlx::query_scalar("SELECT id FROM site WHERE unit_id = $1 ORDER BY id")
            .bind(unit)
            .fetch_all(executor)
            .await?;
    match sites.as_slice() {
        [only] => Ok(only.clone()),
        [] => Err(AppError::NotFound(format!(
            "unit {unit} has no site whose books a posting could land in"
        ))),
        _ => Err(AppError::Conflict(format!(
            "unit {unit} has several sites ({}) and its books are still kept per site, \
             so which one this lands in has not been decided",
            sites.join(", ")
        ))),
    }
}
