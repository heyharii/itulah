//! How a pay component posts (0466) — Finance's half of a component HR
//! defines. HR says what a component pays; Finance says where it lands: its
//! account links (source `PAY_COMPONENT`) and the two facts that change the
//! shape of its lines, `employer_borne` and `paid_from_accrual`.

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayComponentPosting {
    pub code: String,
    pub label: String,
    /// `EARNING` or `DEDUCTION`.
    pub kind: String,
    pub employer_borne: bool,
    pub paid_from_accrual: bool,
    pub retired: bool,
    /// The role the component's link answers: `payroll_expense` for an
    /// earning, `payroll_deduction` for a deduction.
    pub role: String,
    /// How many units' books the component resolves an account in. A
    /// component that resolves nowhere makes a payroll run that pays it
    /// refuse, by name.
    pub linked_units: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetPayComponentPostingRequest {
    #[serde(default)]
    pub employer_borne: bool,
    #[serde(default)]
    pub paid_from_accrual: bool,
}

const ROWS: &str = "
    SELECT c.code, c.label, c.kind, c.employer_borne, c.paid_from_accrual,
           c.retired_at IS NOT NULL AS retired,
           CASE c.kind WHEN 'EARNING' THEN 'payroll_expense' ELSE 'payroll_deduction' END AS role,
           (SELECT COUNT(DISTINCT r.unit_id) FROM account_resolution r
             WHERE r.source_type = 'PAY_COMPONENT' AND r.source_id = c.code
               AND r.role = CASE c.kind WHEN 'EARNING' THEN 'payroll_expense'
                                        ELSE 'payroll_deduction' END)::bigint AS linked_units
      FROM pay_component c";

fn to_row(row: &sqlx::postgres::PgRow) -> Result<PayComponentPosting, AppError> {
    Ok(PayComponentPosting {
        code: row.try_get("code")?,
        label: row.try_get("label")?,
        kind: row.try_get("kind")?,
        employer_borne: row.try_get("employer_borne")?,
        paid_from_accrual: row.try_get("paid_from_accrual")?,
        retired: row.try_get("retired")?,
        role: row.try_get("role")?,
        linked_units: row.try_get("linked_units")?,
    })
}

pub async fn pay_component_postings(pool: &PgPool) -> Result<Vec<PayComponentPosting>, AppError> {
    let rows = sqlx::query(&format!(
        "{ROWS} ORDER BY c.retired_at IS NOT NULL, c.kind, c.code"
    ))
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_row).collect()
}

/// Say whether a deduction is borne by the company, or an earning paid from
/// the accrual. The database refuses the combinations that make no sense (a
/// borne earning, an accrued deduction) in words.
pub async fn set_pay_component_posting(
    pool: &PgPool,
    code: &str,
    request: &SetPayComponentPostingRequest,
) -> Result<PayComponentPosting, AppError> {
    let changed = sqlx::query(
        "UPDATE pay_component SET employer_borne = $2, paid_from_accrual = $3 WHERE code = $1",
    )
    .bind(code)
    .bind(request.employer_borne)
    .bind(request.paid_from_accrual)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db)
            if db
                .constraint()
                .is_some_and(|c| c.starts_with("pay_component_")) =>
        {
            AppError::Validation(
                "only a deduction can be borne by the company, and only an earning can be paid \
                 from the accrual"
                    .into(),
            )
        }
        _ => error.into(),
    })?
    .rows_affected();
    if changed == 0 {
        return Err(AppError::NotFound(format!("pay component {code}")));
    }
    let row = sqlx::query(&format!("{ROWS} WHERE c.code = $1"))
        .bind(code)
        .fetch_one(pool)
        .await?;
    to_row(&row)
}
