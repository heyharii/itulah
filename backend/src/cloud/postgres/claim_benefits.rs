//! Yearly claim allowances (0810).

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimBenefitView {
    pub type_code: String,
    pub type_name: String,
    pub effective_from: NaiveDate,
    /// `null`: no limit from this date.
    pub yearly_limit_minor: Option<i64>,
    pub ratified_by: String,
}

pub async fn claim_benefits(pool: &PgPool) -> Result<Vec<ClaimBenefitView>, AppError> {
    let rows = sqlx::query(
        "SELECT b.type_code, t.name AS type_name, b.effective_from, b.yearly_limit_minor,
                b.ratified->>'actor' AS ratified_by
           FROM claim_benefit b JOIN expense_claim_type t ON t.code = b.type_code
          ORDER BY t.name, b.effective_from DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ClaimBenefitView {
                type_code: row.try_get("type_code")?,
                type_name: row.try_get("type_name")?,
                effective_from: row.try_get("effective_from")?,
                yearly_limit_minor: row.try_get("yearly_limit_minor")?,
                ratified_by: row
                    .try_get::<Option<String>, _>("ratified_by")?
                    .unwrap_or_default(),
            })
        })
        .collect()
}

pub async fn state_claim_benefit(
    pool: &PgPool,
    type_code: &str,
    effective_from: NaiveDate,
    yearly_limit_minor: Option<i64>,
    ratified: &Authorization,
) -> Result<(), AppError> {
    if yearly_limit_minor.is_some_and(|l| l <= 0) {
        return Err(AppError::Validation(
            "an allowance is a positive amount, or none".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO claim_benefit (type_code, effective_from, yearly_limit_minor, ratified)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (type_code, effective_from) DO UPDATE
            SET yearly_limit_minor = EXCLUDED.yearly_limit_minor, ratified = EXCLUDED.ratified",
    )
    .bind(type_code)
    .bind(effective_from)
    .bind(yearly_limit_minor)
    .bind(serde_json::to_value(ratified)?)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
            AppError::Validation(format!("{type_code} is not a claim type"))
        }
        _ => AppError::from(error),
    })?;
    Ok(())
}

pub async fn override_claim_benefit(
    pool: &PgPool,
    employee_id: &str,
    type_code: &str,
    year: i32,
    limit_minor: i64,
    set_by: &Authorization,
) -> Result<(), AppError> {
    if limit_minor < 0 {
        return Err(AppError::Validation(
            "an allowance cannot be below nothing".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO claim_benefit_override (employee_id, type_code, year, limit_minor, set_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id, type_code, year) DO UPDATE
            SET limit_minor = EXCLUDED.limit_minor, set_by = EXCLUDED.set_by, set_at = now()",
    )
    .bind(employee_id)
    .bind(type_code)
    .bind(year)
    .bind(limit_minor)
    .bind(serde_json::to_value(set_by)?)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
            AppError::Validation(format!("{type_code} is not a claim type"))
        }
        _ => AppError::from(error),
    })?;
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ClaimBalanceRow {
    pub type_code: String,
    pub type_name: String,
    pub year: i32,
    /// `null`: no limit.
    pub limit_minor: Option<i64>,
    /// Whether the limit is this person's own for the year.
    pub personal: bool,
    /// Sanctioned on approved or paid claims this year.
    pub used_minor: i64,
    /// Claimed on claims still waiting on a decision.
    pub pending_minor: i64,
    pub left_minor: Option<i64>,
}

/// The allowance in force for one person, one type, one year, and what has
/// been used of it — leaving one claim out, when the question is whether that
/// claim fits.
async fn balance_of(
    pool: &PgPool,
    employee_id: &str,
    type_code: &str,
    year: i32,
    excluding: Option<Uuid>,
) -> Result<(Option<i64>, bool, i64, i64), AppError> {
    let year_end = NaiveDate::from_ymd_opt(year, 12, 31)
        .ok_or_else(|| AppError::Validation("unreadable year".into()))?;
    let personal: Option<i64> = sqlx::query_scalar(
        "SELECT limit_minor FROM claim_benefit_override
          WHERE employee_id = $1 AND type_code = $2 AND year = $3",
    )
    .bind(employee_id)
    .bind(type_code)
    .bind(year)
    .fetch_optional(pool)
    .await?;
    let company: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT yearly_limit_minor FROM claim_benefit
          WHERE type_code = $1 AND effective_from <= $2
          ORDER BY effective_from DESC LIMIT 1",
    )
    .bind(type_code)
    .bind(year_end)
    .fetch_optional(pool)
    .await?;
    let row = sqlx::query(
        "SELECT
             COALESCE(sum(CASE WHEN c.state IN ('APPROVED', 'PAID')
                               THEN l.sanctioned_minor ELSE 0 END), 0)::bigint AS used,
             COALESCE(sum(CASE WHEN c.state = 'SUBMITTED'
                               THEN l.claimed_minor ELSE 0 END), 0)::bigint AS pending
           FROM expense_claim c
           JOIN expense_claim_line l ON l.claim_id = c.claim_id
          WHERE c.employee_id = $1 AND l.type_code = $2
            AND extract(year FROM c.posted_on) = $3
            AND ($4::uuid IS NULL OR c.claim_id <> $4)",
    )
    .bind(employee_id)
    .bind(type_code)
    .bind(year)
    .bind(excluding)
    .fetch_one(pool)
    .await?;
    let limit = personal.or(company.flatten());
    Ok((
        limit,
        personal.is_some(),
        row.try_get("used")?,
        row.try_get("pending")?,
    ))
}

pub async fn claim_balances(
    pool: &PgPool,
    employee_id: &str,
    year: i32,
) -> Result<Vec<ClaimBalanceRow>, AppError> {
    let types: Vec<(String, String)> = sqlx::query_as(
        "SELECT code, name FROM expense_claim_type WHERE retired_at IS NULL ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    let mut rows = Vec::with_capacity(types.len());
    for (code, name) in types {
        let (limit, personal, used, pending) =
            balance_of(pool, employee_id, &code, year, None).await?;
        rows.push(ClaimBalanceRow {
            type_code: code,
            type_name: name,
            year,
            limit_minor: limit,
            personal,
            used_minor: used,
            pending_minor: pending,
            left_minor: limit.map(|l| (l - used).max(0)),
        });
    }
    Ok(rows)
}

/// Refuse an approval that would take any of the claim's types past the
/// year's allowance. `sanctions` are the figures being approved, per line.
pub async fn check_claim_within_allowance(
    pool: &PgPool,
    claim_id: Uuid,
    sanctions: &[(Uuid, i64)],
) -> Result<(), AppError> {
    let claim = sqlx::query("SELECT employee_id, posted_on FROM expense_claim WHERE claim_id = $1")
        .bind(claim_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("expense claim {claim_id}")))?;
    let employee_id: String = claim.try_get("employee_id")?;
    let posted_on: NaiveDate = claim.try_get("posted_on")?;
    let lines: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT line_id, type_code FROM expense_claim_line WHERE claim_id = $1")
            .bind(claim_id)
            .fetch_all(pool)
            .await?;
    let mut per_type: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for (line_id, type_code) in lines {
        let amount = sanctions
            .iter()
            .find(|(id, _)| *id == line_id)
            .map_or(0, |(_, amount)| *amount);
        *per_type.entry(type_code).or_default() += amount;
    }
    for (type_code, asked) in per_type {
        let (limit, _, used, _) = balance_of(
            pool,
            &employee_id,
            &type_code,
            posted_on.year(),
            Some(claim_id),
        )
        .await?;
        if let Some(limit) = limit {
            if used + asked > limit {
                return Err(AppError::Conflict(format!(
                    "{type_code} allows {limit} a year and {used} is already used, so {} is \
                     left — this claim asks {asked}",
                    (limit - used).max(0)
                )));
            }
        }
    }
    Ok(())
}
