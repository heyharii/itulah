//! Expense categories — the kinds of cost a shop or an employee files under
//! (0465). Master data Finance edits; which account a category lands on is an
//! account link (role `expense`, source `EXPENSE_CATEGORY`), set on the
//! Account Links screen like every other link.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ExpenseCategory {
    pub code: String,
    pub name: String,
    pub for_stores: bool,
    pub for_claims: bool,
    pub is_active: bool,
    pub note: Option<String>,
    /// How many units' books the category resolves an account in. Zero means
    /// a cost filed under it is refused until Finance links it.
    pub linked_units: i64,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

/// Add a category, or change one. `code` is the key and never changes.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveExpenseCategoryRequest {
    pub code: String,
    pub name: String,
    #[serde(default = "yes")]
    pub for_stores: bool,
    #[serde(default)]
    pub for_claims: bool,
    #[serde(default = "yes")]
    pub is_active: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

fn yes() -> bool {
    true
}

const CATEGORY_ROWS: &str = "
    SELECT c.code, c.name, c.for_stores, c.for_claims, c.is_active, c.note, c.created_by,
           c.created_at,
           (SELECT COUNT(DISTINCT r.unit_id) FROM account_resolution r
             WHERE r.role = 'expense' AND r.source_type = 'EXPENSE_CATEGORY'
               AND r.source_id = c.code)::bigint AS linked_units
      FROM expense_category c";

fn to_category(row: &sqlx::postgres::PgRow) -> Result<ExpenseCategory, AppError> {
    Ok(ExpenseCategory {
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        for_stores: row.try_get("for_stores")?,
        for_claims: row.try_get("for_claims")?,
        is_active: row.try_get("is_active")?,
        note: row.try_get("note")?,
        linked_units: row.try_get("linked_units")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

pub async fn expense_categories(pool: &PgPool) -> Result<Vec<ExpenseCategory>, AppError> {
    let rows = sqlx::query(&format!("{CATEGORY_ROWS} ORDER BY c.is_active DESC, c.name"))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_category).collect()
}

/// Add a category, or change its name, who files under it, or whether it is
/// still in use. Retiring rather than deleting: costs already filed under a
/// category keep reading back.
pub async fn save_expense_category(
    pool: &PgPool,
    request: &SaveExpenseCategoryRequest,
    actor: &str,
) -> Result<ExpenseCategory, AppError> {
    let code = request.code.trim();
    let name = request.name.trim();
    if code.is_empty() || name.is_empty() {
        return Err(AppError::Validation("an expense category has a code and a name".into()));
    }
    sqlx::query(
        "INSERT INTO expense_category (code, name, for_stores, for_claims, is_active, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, for_stores = EXCLUDED.for_stores,
                for_claims = EXCLUDED.for_claims, is_active = EXCLUDED.is_active,
                note = EXCLUDED.note",
    )
    .bind(code)
    .bind(name)
    .bind(request.for_stores)
    .bind(request.for_claims)
    .bind(request.is_active)
    .bind(
        request
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty()),
    )
    .bind(actor)
    .execute(pool)
    .await?;
    let row = sqlx::query(&format!("{CATEGORY_ROWS} WHERE c.code = $1"))
        .bind(code)
        .fetch_one(pool)
        .await?;
    to_category(&row)
}
