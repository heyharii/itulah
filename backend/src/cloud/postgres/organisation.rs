//! The organisation (0805): departments, job levels, grades, where each person
//! sits in them from a date and whom they report to, and the company's BPJS
//! registration.

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

fn code_of(raw: &str) -> Result<String, AppError> {
    let code = raw.trim().to_ascii_uppercase();
    let shaped = code.len() <= 32
        && code.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && code
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    if shaped {
        Ok(code)
    } else {
        Err(AppError::Validation(format!(
            "{raw:?} is not a code: a letter, then letters, digits or underscores, at most 32"
        )))
    }
}

fn name_of(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a name is needed".into()));
    }
    Ok(name.to_owned())
}

// ── departments ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepartmentView {
    pub code: String,
    pub name: String,
    pub parent_code: Option<String>,
    pub retired: bool,
    /// People whose placement in force today is in this department.
    pub members: i64,
}

/// The placement in force today, per person — the one subquery every count
/// and the chart read.
const CURRENT_PLACEMENT: &str = "
    SELECT DISTINCT ON (employee_id) *
      FROM employee_placement
     WHERE effective_from <= current_date
     ORDER BY employee_id, effective_from DESC";

pub async fn departments(pool: &PgPool) -> Result<Vec<DepartmentView>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT d.code, d.name, d.parent_code, d.retired_at IS NOT NULL AS retired,
                (SELECT count(*) FROM ({CURRENT_PLACEMENT}) p
                   JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
                  WHERE p.department_code = d.code) AS members
           FROM org_department d
          ORDER BY d.retired_at IS NOT NULL, d.name"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(DepartmentView {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                parent_code: row.try_get("parent_code")?,
                retired: row.try_get("retired")?,
                members: row.try_get("members")?,
            })
        })
        .collect()
}

/// Define a department or rename and re-parent one. A parent may not be the
/// department itself or anything under it — a loop has no top to draw from.
pub async fn save_department(
    pool: &PgPool,
    raw_code: &str,
    raw_name: &str,
    parent: Option<&str>,
    defined: &Authorization,
) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let name = name_of(raw_name)?;
    let parent = parent
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(code_of)
        .transpose()?;
    if let Some(parent) = &parent {
        let looped: bool = sqlx::query_scalar(
            "WITH RECURSIVE up(code, parent_code) AS (
                 SELECT code, parent_code FROM org_department WHERE code = $1
                 UNION
                 SELECT d.code, d.parent_code FROM org_department d JOIN up ON d.code = up.parent_code
             )
             SELECT EXISTS (SELECT 1 FROM up WHERE code = $2)",
        )
        .bind(parent)
        .bind(&code)
        .fetch_one(pool)
        .await?;
        if looped {
            return Err(AppError::Validation(format!(
                "{parent} is {code} or sits under it; a department cannot be inside itself"
            )));
        }
        let usable: Option<bool> =
            sqlx::query_scalar("SELECT retired_at IS NULL FROM org_department WHERE code = $1")
                .bind(parent)
                .fetch_optional(pool)
                .await?;
        if usable != Some(true) {
            return Err(AppError::Validation(format!(
                "{parent} is not a department in use"
            )));
        }
    }
    let saved = sqlx::query(
        "INSERT INTO org_department (code, name, parent_code, defined)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, parent_code = EXCLUDED.parent_code,
                defined = EXCLUDED.defined, updated_at = now()
          WHERE org_department.retired_at IS NULL",
    )
    .bind(&code)
    .bind(&name)
    .bind(&parent)
    .bind(serde_json::to_value(defined)?)
    .execute(pool)
    .await?;
    if saved.rows_affected() == 0 {
        return Err(AppError::Conflict(format!("{code} is retired")));
    }
    Ok(())
}

/// Retire a department nobody is in and nothing in use sits under.
pub async fn retire_department(
    pool: &PgPool,
    raw_code: &str,
    retired: &Authorization,
) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let busy = departments(pool)
        .await?
        .into_iter()
        .find(|d| d.code == code)
        .ok_or_else(|| AppError::NotFound(format!("department {code}")))?;
    if busy.members > 0 {
        return Err(AppError::Conflict(format!(
            "{} people are in {code}; place them elsewhere first",
            busy.members
        )));
    }
    let children: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM org_department WHERE parent_code = $1 AND retired_at IS NULL",
    )
    .bind(&code)
    .fetch_one(pool)
    .await?;
    if children > 0 {
        return Err(AppError::Conflict(format!(
            "{children} departments in use sit under {code}"
        )));
    }
    let done = sqlx::query(
        "UPDATE org_department SET retired_at = now(), retired = $2, updated_at = now()
          WHERE code = $1 AND retired_at IS NULL",
    )
    .bind(&code)
    .bind(serde_json::to_value(retired)?)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(format!("{code} is already retired")));
    }
    Ok(())
}

// ── job levels and grades ───────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobLevelView {
    pub code: String,
    pub name: String,
    /// 1 is the most senior.
    pub rank: i32,
    pub retired: bool,
    pub members: i64,
}

pub async fn job_levels(pool: &PgPool) -> Result<Vec<JobLevelView>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT l.code, l.name, l.rank, l.retired_at IS NOT NULL AS retired,
                (SELECT count(*) FROM ({CURRENT_PLACEMENT}) p
                   JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
                  WHERE p.level_code = l.code) AS members
           FROM job_level l
          ORDER BY l.retired_at IS NOT NULL, l.rank"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(JobLevelView {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                rank: row.try_get("rank")?,
                retired: row.try_get("retired")?,
                members: row.try_get("members")?,
            })
        })
        .collect()
}

pub async fn save_job_level(
    pool: &PgPool,
    raw_code: &str,
    raw_name: &str,
    rank: i32,
    defined: &Authorization,
) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let name = name_of(raw_name)?;
    if rank <= 0 {
        return Err(AppError::Validation(
            "a rank is 1 or more; 1 is the most senior".into(),
        ));
    }
    let taken: Option<String> =
        sqlx::query_scalar("SELECT code FROM job_level WHERE rank = $1 AND code <> $2")
            .bind(rank)
            .bind(&code)
            .fetch_optional(pool)
            .await?;
    if let Some(other) = taken {
        return Err(AppError::Conflict(format!(
            "{other} already has rank {rank}"
        )));
    }
    let saved = sqlx::query(
        "INSERT INTO job_level (code, name, rank, defined) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, rank = EXCLUDED.rank,
                defined = EXCLUDED.defined, updated_at = now()
          WHERE job_level.retired_at IS NULL",
    )
    .bind(&code)
    .bind(&name)
    .bind(rank)
    .bind(serde_json::to_value(defined)?)
    .execute(pool)
    .await?;
    if saved.rows_affected() == 0 {
        return Err(AppError::Conflict(format!("{code} is retired")));
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct JobGradeView {
    pub code: String,
    pub name: String,
    pub level_code: Option<String>,
    pub grade_class: Option<String>,
    pub min_minor: Option<i64>,
    pub max_minor: Option<i64>,
    pub retired: bool,
    pub members: i64,
}

pub async fn job_grades(pool: &PgPool) -> Result<Vec<JobGradeView>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT g.code, g.name, g.level_code, g.grade_class, g.min_minor, g.max_minor,
                g.retired_at IS NOT NULL AS retired,
                (SELECT count(*) FROM ({CURRENT_PLACEMENT}) p
                   JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
                  WHERE p.grade_code = g.code) AS members
           FROM job_grade g
           LEFT JOIN job_level l ON l.code = g.level_code
          ORDER BY g.retired_at IS NOT NULL, l.rank NULLS LAST, g.code"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(JobGradeView {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                level_code: row.try_get("level_code")?,
                grade_class: row.try_get("grade_class")?,
                min_minor: row.try_get("min_minor")?,
                max_minor: row.try_get("max_minor")?,
                retired: row.try_get("retired")?,
                members: row.try_get("members")?,
            })
        })
        .collect()
}

pub async fn save_job_grade(
    pool: &PgPool,
    raw_code: &str,
    raw_name: &str,
    level: Option<&str>,
    grade_class: Option<&str>,
    min_minor: Option<i64>,
    max_minor: Option<i64>,
    defined: &Authorization,
) -> Result<(), AppError> {
    let grade_class = grade_class
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_owned);
    let code = code_of(raw_code)?;
    let name = name_of(raw_name)?;
    let level = level
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(code_of)
        .transpose()?;
    if let (Some(min), Some(max)) = (min_minor, max_minor) {
        if min > max {
            return Err(AppError::Validation(
                "the band's bottom is above its top".into(),
            ));
        }
    }
    if min_minor.is_some_and(|m| m <= 0) || max_minor.is_some_and(|m| m <= 0) {
        return Err(AppError::Validation("a band is in positive amounts".into()));
    }
    let saved = sqlx::query(
        "INSERT INTO job_grade (code, name, level_code, min_minor, max_minor, defined, grade_class)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, level_code = EXCLUDED.level_code,
                grade_class = EXCLUDED.grade_class,
                min_minor = EXCLUDED.min_minor, max_minor = EXCLUDED.max_minor,
                defined = EXCLUDED.defined, updated_at = now()
          WHERE job_grade.retired_at IS NULL",
    )
    .bind(&code)
    .bind(&name)
    .bind(&level)
    .bind(min_minor)
    .bind(max_minor)
    .bind(serde_json::to_value(defined)?)
    .bind(&grade_class)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => AppError::Validation(
            format!("{} is not a job level", level.clone().unwrap_or_default()),
        ),
        _ => AppError::from(error),
    })?;
    if saved.rows_affected() == 0 {
        return Err(AppError::Conflict(format!("{code} is retired")));
    }
    Ok(())
}

/// Retire a level or a grade nobody holds today. `table` is one of the two
/// names this module owns, never input.
async fn retire_master(
    pool: &PgPool,
    table: &'static str,
    column: &'static str,
    raw_code: &str,
    retired: &Authorization,
) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let holders: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM ({CURRENT_PLACEMENT}) p
           JOIN employee e ON e.id = p.employee_id AND e.status = 'ACTIVE'
          WHERE p.{column} = $1"
    ))
    .bind(&code)
    .fetch_one(pool)
    .await?;
    if holders > 0 {
        return Err(AppError::Conflict(format!(
            "{holders} people hold {code}; place them elsewhere first"
        )));
    }
    let done = sqlx::query(&format!(
        "UPDATE {table} SET retired_at = now(), retired = $2, updated_at = now()
          WHERE code = $1 AND retired_at IS NULL"
    ))
    .bind(&code)
    .bind(serde_json::to_value(retired)?)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{code} does not exist or is already retired"
        )));
    }
    Ok(())
}

pub async fn retire_job_level(
    pool: &PgPool,
    code: &str,
    by: &Authorization,
) -> Result<(), AppError> {
    retire_master(pool, "job_level", "level_code", code, by).await
}

pub async fn retire_job_grade(
    pool: &PgPool,
    code: &str,
    by: &Authorization,
) -> Result<(), AppError> {
    retire_master(pool, "job_grade", "grade_code", code, by).await
}

// ── placements ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PlacementView {
    pub effective_from: NaiveDate,
    pub department_code: Option<String>,
    pub department_name: Option<String>,
    pub level_code: Option<String>,
    pub level_name: Option<String>,
    pub grade_code: Option<String>,
    pub grade_name: Option<String>,
    pub reports_to: Option<String>,
    pub reports_to_name: Option<String>,
    pub placed_by: String,
    pub reason: String,
}

/// One person's placements, newest first.
pub async fn placements_of(
    pool: &PgPool,
    employee_id: &str,
) -> Result<Vec<PlacementView>, AppError> {
    let rows = sqlx::query(
        "SELECT p.effective_from, p.department_code, d.name AS department_name,
                p.level_code, l.name AS level_name, p.grade_code, g.name AS grade_name,
                p.reports_to, COALESCE(mp.full_name, m.code) AS reports_to_name,
                p.placed->>'actor' AS placed_by, p.placed->>'reason' AS reason
           FROM employee_placement p
           LEFT JOIN org_department d ON d.code = p.department_code
           LEFT JOIN job_level l ON l.code = p.level_code
           LEFT JOIN job_grade g ON g.code = p.grade_code
           LEFT JOIN employee m ON m.id = p.reports_to
           LEFT JOIN employee_profile mp ON mp.employee_id = p.reports_to
          WHERE p.employee_id = $1
          ORDER BY p.effective_from DESC",
    )
    .bind(employee_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PlacementView {
                effective_from: row.try_get("effective_from")?,
                department_code: row.try_get("department_code")?,
                department_name: row.try_get("department_name")?,
                level_code: row.try_get("level_code")?,
                level_name: row.try_get("level_name")?,
                grade_code: row.try_get("grade_code")?,
                grade_name: row.try_get("grade_name")?,
                reports_to: row.try_get("reports_to")?,
                reports_to_name: row.try_get("reports_to_name")?,
                placed_by: row
                    .try_get::<Option<String>, _>("placed_by")?
                    .unwrap_or_default(),
                reason: row
                    .try_get::<Option<String>, _>("reason")?
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// Place somebody from a date. Every master named must be in use, and the
/// manager may not be somebody who — on that date — reports up to this
/// person: a line of report with a loop in it has nobody at the top.
#[allow(clippy::too_many_arguments)]
pub async fn place_employee(
    pool: &PgPool,
    employee_id: &str,
    effective_from: NaiveDate,
    department: Option<&str>,
    level: Option<&str>,
    grade: Option<&str>,
    reports_to: Option<&str>,
    placed: &Authorization,
) -> Result<(), AppError> {
    let clean = |raw: Option<&str>| {
        raw.map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    let department = clean(department).map(|c| c.to_ascii_uppercase());
    let level = clean(level).map(|c| c.to_ascii_uppercase());
    let grade = clean(grade).map(|c| c.to_ascii_uppercase());
    let reports_to = clean(reports_to);

    for (table, value, what) in [
        ("org_department", &department, "department"),
        ("job_level", &level, "job level"),
        ("job_grade", &grade, "grade"),
    ] {
        if let Some(code) = value {
            let usable: Option<bool> = sqlx::query_scalar(&format!(
                "SELECT retired_at IS NULL FROM {table} WHERE code = $1"
            ))
            .bind(code)
            .fetch_optional(pool)
            .await?;
            if usable != Some(true) {
                return Err(AppError::Validation(format!(
                    "{code} is not a {what} in use"
                )));
            }
        }
    }

    if let Some(manager) = &reports_to {
        if manager == employee_id {
            return Err(AppError::Validation("nobody reports to themselves".into()));
        }
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM employee WHERE id = $1)")
                .bind(manager)
                .fetch_one(pool)
                .await?;
        if !exists {
            return Err(AppError::Validation(format!(
                "{manager} is not an employee"
            )));
        }
        let looped: bool = sqlx::query_scalar(
            "WITH RECURSIVE placed AS (
                 SELECT DISTINCT ON (employee_id) employee_id, reports_to
                   FROM employee_placement WHERE effective_from <= $3
                  ORDER BY employee_id, effective_from DESC
             ), up(employee_id, reports_to) AS (
                 SELECT employee_id, reports_to FROM placed WHERE employee_id = $1
                 UNION
                 SELECT p.employee_id, p.reports_to FROM placed p
                   JOIN up ON p.employee_id = up.reports_to
             )
             SELECT EXISTS (SELECT 1 FROM up WHERE reports_to = $2)",
        )
        .bind(manager)
        .bind(employee_id)
        .bind(effective_from)
        .fetch_one(pool)
        .await?;
        if looped {
            return Err(AppError::Validation(format!(
                "{manager} reports up to {employee_id}; the line of report would loop"
            )));
        }
    }

    sqlx::query(
        "INSERT INTO employee_placement
             (employee_id, effective_from, department_code, level_code, grade_code,
              reports_to, placed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (employee_id, effective_from) DO UPDATE
            SET department_code = EXCLUDED.department_code,
                level_code = EXCLUDED.level_code,
                grade_code = EXCLUDED.grade_code,
                reports_to = EXCLUDED.reports_to,
                placed = EXCLUDED.placed",
    )
    .bind(employee_id)
    .bind(effective_from)
    .bind(&department)
    .bind(&level)
    .bind(&grade)
    .bind(&reports_to)
    .bind(serde_json::to_value(placed)?)
    .execute(pool)
    .await?;
    Ok(())
}

// ── the chart ───────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OrgChartNode {
    pub employee_id: String,
    pub employee_code: String,
    pub full_name: Option<String>,
    pub unit_id: Option<String>,
    pub department_code: Option<String>,
    pub department_name: Option<String>,
    pub level_name: Option<String>,
    pub level_rank: Option<i32>,
    pub grade_code: Option<String>,
    pub reports_to: Option<String>,
}

/// Everybody working today, where they sit, and whom they report to. People
/// with no placement are in it too, unplaced, so the chart cannot quietly
/// leave somebody out.
pub async fn org_chart(pool: &PgPool) -> Result<Vec<OrgChartNode>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT e.id AS employee_id, e.code AS employee_code, pr.full_name,
                (SELECT a.unit_id FROM employee_assignment a
                  WHERE a.employee_id = e.id AND a.valid_from <= current_date
                    AND (a.valid_to IS NULL OR a.valid_to > current_date)
                  ORDER BY a.valid_from DESC LIMIT 1) AS unit_id,
                p.department_code, d.name AS department_name,
                l.name AS level_name, l.rank AS level_rank, p.grade_code,
                CASE WHEN m.status = 'ACTIVE' THEN p.reports_to END AS reports_to
           FROM employee e
           LEFT JOIN employee_profile pr ON pr.employee_id = e.id
           LEFT JOIN ({CURRENT_PLACEMENT}) p ON p.employee_id = e.id
           LEFT JOIN org_department d ON d.code = p.department_code
           LEFT JOIN job_level l ON l.code = p.level_code
           LEFT JOIN employee m ON m.id = p.reports_to
          WHERE e.status = 'ACTIVE'
          ORDER BY l.rank NULLS LAST, pr.full_name NULLS LAST, e.code"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(OrgChartNode {
                employee_id: row.try_get("employee_id")?,
                employee_code: row.try_get("employee_code")?,
                full_name: row.try_get("full_name")?,
                unit_id: row.try_get("unit_id")?,
                department_code: row.try_get("department_code")?,
                department_name: row.try_get("department_name")?,
                level_name: row.try_get("level_name")?,
                level_rank: row.try_get("level_rank")?,
                grade_code: row.try_get("grade_code")?,
                reports_to: row.try_get("reports_to")?,
            })
        })
        .collect()
}

// ── the company and its BPJS registration ───────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BpjsRegistrationView {
    pub effective_from: NaiveDate,
    pub npp: Option<String>,
    pub kesehatan_code: Option<String>,
    pub jkk_risk_class: Option<String>,
    pub registered_by: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CompanyView {
    pub name: Option<String>,
    pub legal_form: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    /// Newest first; the first one on or before today is in force.
    pub bpjs: Vec<BpjsRegistrationView>,
}

pub async fn company(pool: &PgPool) -> Result<CompanyView, AppError> {
    let profile = sqlx::query("SELECT name, legal_form, address, tax_id FROM company_profile")
        .fetch_optional(pool)
        .await?;
    let bpjs = sqlx::query(
        "SELECT effective_from, npp, kesehatan_code, jkk_risk_class,
                registered->>'actor' AS registered_by, registered->>'reason' AS reason
           FROM company_bpjs_registration ORDER BY effective_from DESC",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(BpjsRegistrationView {
            effective_from: row.try_get("effective_from")?,
            npp: row.try_get("npp")?,
            kesehatan_code: row.try_get("kesehatan_code")?,
            jkk_risk_class: row.try_get("jkk_risk_class")?,
            registered_by: row
                .try_get::<Option<String>, _>("registered_by")?
                .unwrap_or_default(),
            reason: row
                .try_get::<Option<String>, _>("reason")?
                .unwrap_or_default(),
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let field = |name: &str| -> Result<Option<String>, AppError> {
        Ok(match &profile {
            Some(row) => row.try_get(name)?,
            None => None,
        })
    };
    Ok(CompanyView {
        name: field("name")?,
        legal_form: field("legal_form")?,
        address: field("address")?,
        tax_id: field("tax_id")?,
        bpjs,
    })
}

/// State the company's BPJS numbers from a date. A new row, never an edit of
/// an old one, so a month already reported keeps the numbers it named.
pub async fn register_bpjs(
    pool: &PgPool,
    effective_from: NaiveDate,
    npp: Option<&str>,
    kesehatan_code: Option<&str>,
    jkk_risk_class: Option<&str>,
    registered: &Authorization,
) -> Result<(), AppError> {
    let clean = |raw: Option<&str>| {
        raw.map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    let class = clean(jkk_risk_class).map(|c| c.to_ascii_uppercase());
    if class
        .as_deref()
        .is_some_and(|c| !["I", "II", "III", "IV", "V"].contains(&c))
    {
        return Err(AppError::Validation(
            "a JKK risk class is I, II, III, IV or V".into(),
        ));
    }
    let inserted = sqlx::query(
        "INSERT INTO company_bpjs_registration
             (effective_from, npp, kesehatan_code, jkk_risk_class, registered)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (effective_from) DO NOTHING",
    )
    .bind(effective_from)
    .bind(clean(npp))
    .bind(clean(kesehatan_code))
    .bind(&class)
    .bind(serde_json::to_value(registered)?)
    .execute(pool)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "a registration from {effective_from} is already stated; state the change from another date"
        )));
    }
    Ok(())
}

// ── business units and the group ───────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BusinessUnitView {
    pub code: String,
    pub name: String,
    pub retired: bool,
    /// The units in it, by id.
    pub units: Vec<String>,
}

pub async fn business_units(pool: &PgPool) -> Result<Vec<BusinessUnitView>, AppError> {
    let rows = sqlx::query(
        "SELECT b.code, b.name, b.retired_at IS NOT NULL AS retired,
                COALESCE(array_agg(u.unit_id ORDER BY u.unit_id)
                         FILTER (WHERE u.unit_id IS NOT NULL), '{}') AS units
           FROM business_unit b
           LEFT JOIN unit_business_unit u ON u.sbu_code = b.code
          GROUP BY b.code
          ORDER BY b.retired_at IS NOT NULL, b.name",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BusinessUnitView {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                retired: row.try_get("retired")?,
                units: row.try_get("units")?,
            })
        })
        .collect()
}

/// Define or rename a business unit, and say which units are in it. A unit
/// named here leaves whichever business unit it was in.
pub async fn save_business_unit(
    pool: &PgPool,
    raw_code: &str,
    raw_name: &str,
    units: &[String],
    defined: &Authorization,
) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let name = name_of(raw_name)?;
    let mut tx = pool.begin().await?;
    let saved = sqlx::query(
        "INSERT INTO business_unit (code, name, defined) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, defined = EXCLUDED.defined, updated_at = now()
          WHERE business_unit.retired_at IS NULL",
    )
    .bind(&code)
    .bind(&name)
    .bind(serde_json::to_value(defined)?)
    .execute(&mut *tx)
    .await?;
    if saved.rows_affected() == 0 {
        return Err(AppError::Conflict(format!("{code} is retired")));
    }
    sqlx::query("DELETE FROM unit_business_unit WHERE sbu_code = $1 AND NOT (unit_id = ANY($2))")
        .bind(&code)
        .bind(units)
        .execute(&mut *tx)
        .await?;
    for unit in units {
        sqlx::query(
            "INSERT INTO unit_business_unit (unit_id, sbu_code, set_by) VALUES ($1, $2, $3)
             ON CONFLICT (unit_id) DO UPDATE
                SET sbu_code = EXCLUDED.sbu_code, set_by = EXCLUDED.set_by, set_at = now()",
        )
        .bind(unit)
        .bind(&code)
        .bind(serde_json::to_value(defined)?)
        .execute(&mut *tx)
        .await
        .map_err(|error| match &error {
            sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
                AppError::Validation(format!("{unit} is not a unit"))
            }
            _ => AppError::from(error),
        })?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GroupEntityView {
    pub code: String,
    pub name: String,
    /// `HOLDING`, `SUBSIDIARY` or `AFFILIATE`.
    pub relation: String,
    pub tax_id: Option<String>,
}

pub async fn group_entities(pool: &PgPool) -> Result<Vec<GroupEntityView>, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, relation, tax_id FROM company_group_entity
          ORDER BY CASE relation WHEN 'HOLDING' THEN 0 WHEN 'SUBSIDIARY' THEN 1 ELSE 2 END, name",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(GroupEntityView {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                relation: row.try_get("relation")?,
                tax_id: row.try_get("tax_id")?,
            })
        })
        .collect()
}

pub async fn save_group_entity(
    pool: &PgPool,
    raw_code: &str,
    raw_name: &str,
    relation: &str,
    tax_id: Option<&str>,
    defined: &Authorization,
) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let name = name_of(raw_name)?;
    let relation = relation.trim().to_ascii_uppercase();
    if !["HOLDING", "SUBSIDIARY", "AFFILIATE"].contains(&relation.as_str()) {
        return Err(AppError::Validation(
            "a group member is the HOLDING, a SUBSIDIARY or an AFFILIATE".into(),
        ));
    }
    let tax_id = tax_id
        .map(|t| t.chars().filter(char::is_ascii_digit).collect::<String>())
        .filter(|t| !t.is_empty());
    if tax_id
        .as_ref()
        .is_some_and(|t| t.len() != 15 && t.len() != 16)
    {
        return Err(AppError::Validation("an NPWP is 15 or 16 digits".into()));
    }
    if relation == "HOLDING" {
        let other: Option<String> = sqlx::query_scalar(
            "SELECT code FROM company_group_entity WHERE relation = 'HOLDING' AND code <> $1",
        )
        .bind(&code)
        .fetch_optional(pool)
        .await?;
        if let Some(other) = other {
            return Err(AppError::Conflict(format!(
                "{other} is already the holding"
            )));
        }
    }
    sqlx::query(
        "INSERT INTO company_group_entity (code, name, relation, tax_id, defined)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, relation = EXCLUDED.relation,
                tax_id = EXCLUDED.tax_id, defined = EXCLUDED.defined, updated_at = now()",
    )
    .bind(&code)
    .bind(&name)
    .bind(&relation)
    .bind(&tax_id)
    .bind(serde_json::to_value(defined)?)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_group_entity(pool: &PgPool, raw_code: &str) -> Result<(), AppError> {
    let code = code_of(raw_code)?;
    let gone = sqlx::query("DELETE FROM company_group_entity WHERE code = $1")
        .bind(&code)
        .execute(pool)
        .await?;
    if gone.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("group member {code}")));
    }
    Ok(())
}

// ── onboarding and separation checklists (0806) ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChecklistTemplateView {
    pub id: String,
    pub label: String,
    /// `HEAD_OFFICE`, `STORE`, `IT` or `EMPLOYEE`: who ticks it.
    pub owner: String,
    /// `ONBOARDING` or `SEPARATION`.
    pub kind: String,
    pub position: i32,
    pub retired: bool,
}

pub async fn checklist_templates(pool: &PgPool) -> Result<Vec<ChecklistTemplateView>, AppError> {
    let rows = sqlx::query(
        "SELECT id, label, owner, kind, position, retired_at IS NOT NULL AS retired
           FROM lifecycle_task_template
          ORDER BY kind, retired_at IS NOT NULL, position, id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ChecklistTemplateView {
                id: row.try_get("id")?,
                label: row.try_get("label")?,
                owner: row.try_get("owner")?,
                kind: row.try_get("kind")?,
                position: row.try_get("position")?,
                retired: row.try_get("retired")?,
            })
        })
        .collect()
}

/// Add a task to a checklist, or reword and reorder one. Checklists already
/// opened keep the tasks they were opened with; a new task reaches the next
/// hire (or separation).
pub async fn save_checklist_template(
    pool: &PgPool,
    raw_id: &str,
    raw_label: &str,
    owner: &str,
    kind: &str,
    position: i32,
    defined: &Authorization,
) -> Result<(), AppError> {
    let id = raw_id.trim().to_ascii_lowercase();
    if id.is_empty()
        || id.len() > 32
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(AppError::Validation(
            "a task id is lowercase letters, digits or underscores, at most 32".into(),
        ));
    }
    let label = name_of(raw_label)?;
    let owner = owner.trim().to_ascii_uppercase();
    if !["HEAD_OFFICE", "STORE", "IT", "EMPLOYEE"].contains(&owner.as_str()) {
        return Err(AppError::Validation(
            "a task is head office's, the store's, IT's or the employee's".into(),
        ));
    }
    let kind = kind.trim().to_ascii_uppercase();
    if !["ONBOARDING", "SEPARATION"].contains(&kind.as_str()) {
        return Err(AppError::Validation(
            "a checklist is ONBOARDING or SEPARATION".into(),
        ));
    }
    if !(1..=99).contains(&position) {
        return Err(AppError::Validation("a position is 1 to 99".into()));
    }
    let saved = sqlx::query(
        "INSERT INTO lifecycle_task_template (id, label, owner, kind, position, defined)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
            SET label = EXCLUDED.label, owner = EXCLUDED.owner,
                position = EXCLUDED.position, defined = EXCLUDED.defined
          WHERE lifecycle_task_template.retired_at IS NULL
            AND lifecycle_task_template.kind = EXCLUDED.kind",
    )
    .bind(&id)
    .bind(&label)
    .bind(&owner)
    .bind(&kind)
    .bind(position)
    .bind(serde_json::to_value(defined)?)
    .execute(pool)
    .await?;
    if saved.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{id} is retired, or belongs to the other checklist"
        )));
    }
    Ok(())
}

pub async fn retire_checklist_template(
    pool: &PgPool,
    raw_id: &str,
    retired: &Authorization,
) -> Result<(), AppError> {
    let id = raw_id.trim().to_ascii_lowercase();
    let done = sqlx::query(
        "UPDATE lifecycle_task_template SET retired_at = now(), retired = $2
          WHERE id = $1 AND retired_at IS NULL",
    )
    .bind(&id)
    .bind(serde_json::to_value(retired)?)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(format!(
            "{id} does not exist or is already retired"
        )));
    }
    Ok(())
}
