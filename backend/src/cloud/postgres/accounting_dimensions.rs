//! Accounting dimensions — ERPNext's Accounting Dimension (0470).
//!
//! Finance defines the ways it cuts the books beyond the unit (division, cost
//! center, project, or anything else), their values, and whether a
//! profit-and-loss or balance-sheet line must carry one. A posting line
//! carries values through `PostingLine::with_dimension`; a manual journal
//! sends them as `dimensions`.

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DimensionValue {
    pub value_code: String,
    pub name: String,
    #[serde(default = "active")]
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountingDimension {
    pub code: String,
    pub name: String,
    pub mandatory_for_pl: bool,
    pub mandatory_for_bs: bool,
    pub is_active: bool,
    pub values: Vec<DimensionValue>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveDimensionRequest {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub mandatory_for_pl: bool,
    #[serde(default)]
    pub mandatory_for_bs: bool,
    #[serde(default = "active")]
    pub is_active: bool,
}

fn active() -> bool {
    true
}

pub async fn accounting_dimensions(pool: &PgPool) -> Result<Vec<AccountingDimension>, AppError> {
    let dimensions = sqlx::query(
        "SELECT code, name, mandatory_for_pl, mandatory_for_bs, is_active
           FROM accounting_dimension ORDER BY is_active DESC, code",
    )
    .fetch_all(pool)
    .await?;
    let values = sqlx::query(
        "SELECT dimension_code, value_code, name, is_active FROM accounting_dimension_value
          ORDER BY dimension_code, is_active DESC, value_code",
    )
    .fetch_all(pool)
    .await?;
    dimensions
        .iter()
        .map(|row| {
            let code: String = row.try_get("code")?;
            let own = values
                .iter()
                .filter(|value| value.try_get::<String, _>("dimension_code").ok().as_deref() == Some(&code))
                .map(|value| {
                    Ok(DimensionValue {
                        value_code: value.try_get("value_code")?,
                        name: value.try_get("name")?,
                        is_active: value.try_get("is_active")?,
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?;
            Ok(AccountingDimension {
                name: row.try_get("name")?,
                mandatory_for_pl: row.try_get("mandatory_for_pl")?,
                mandatory_for_bs: row.try_get("mandatory_for_bs")?,
                is_active: row.try_get("is_active")?,
                values: own,
                code,
            })
        })
        .collect()
}

pub async fn save_accounting_dimension(
    pool: &PgPool,
    request: &SaveDimensionRequest,
    actor: &str,
) -> Result<Vec<AccountingDimension>, AppError> {
    let code = request.code.trim().to_ascii_uppercase();
    if code.is_empty() || request.name.trim().is_empty() {
        return Err(AppError::Validation("a dimension has a code and a name".into()));
    }
    sqlx::query(
        "INSERT INTO accounting_dimension
            (code, name, mandatory_for_pl, mandatory_for_bs, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, mandatory_for_pl = EXCLUDED.mandatory_for_pl,
                mandatory_for_bs = EXCLUDED.mandatory_for_bs, is_active = EXCLUDED.is_active",
    )
    .bind(&code)
    .bind(request.name.trim())
    .bind(request.mandatory_for_pl)
    .bind(request.mandatory_for_bs)
    .bind(request.is_active)
    .bind(actor)
    .execute(pool)
    .await?;
    accounting_dimensions(pool).await
}

pub async fn save_dimension_value(
    pool: &PgPool,
    dimension: &str,
    value: &DimensionValue,
) -> Result<Vec<AccountingDimension>, AppError> {
    let code = value.value_code.trim();
    if code.is_empty() || value.name.trim().is_empty() {
        return Err(AppError::Validation("a dimension value has a code and a name".into()));
    }
    sqlx::query(
        "INSERT INTO accounting_dimension_value (dimension_code, value_code, name, is_active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (dimension_code, value_code) DO UPDATE
            SET name = EXCLUDED.name, is_active = EXCLUDED.is_active",
    )
    .bind(dimension.trim().to_ascii_uppercase())
    .bind(code)
    .bind(value.name.trim())
    .bind(value.is_active)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => {
            AppError::NotFound(format!("dimension {dimension}"))
        }
        _ => error.into(),
    })?;
    accounting_dimensions(pool).await
}
