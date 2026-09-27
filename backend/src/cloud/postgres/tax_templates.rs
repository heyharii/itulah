//! Tax master data Finance edits (0469).
//!
//! * `tax_template` — what a supplier payment keeps back, at what rate
//!   (ERPNext Tax Withholding Category). Its payable is an account link, role
//!   `withholding_payable`, source `TAX_TEMPLATE`.
//! * `tax_type` — the taxes the company owes or claims per period (PPh 21, 23,
//!   25, 29, PPN, PBB), each named by the role its account answers to (0279).
//!   Adding one used to take a migration.

use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxTemplate {
    pub code: String,
    pub name: String,
    pub rate_bps: i32,
    pub is_final: bool,
    #[serde(default = "active")]
    pub is_active: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TaxTypeSetting {
    pub code: String,
    pub name: String,
    /// `PAYABLE` (owed to the tax office) or `CREDIT` (claimed against one).
    pub nature: String,
    /// The role its account answers to on the Account Links screen.
    pub semantic_key: String,
    #[serde(default = "authority")]
    pub authority: String,
    #[serde(default = "active")]
    pub active: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

fn active() -> bool {
    true
}

fn authority() -> String {
    "DJP".to_string()
}

pub async fn tax_templates(pool: &PgPool) -> Result<Vec<TaxTemplate>, AppError> {
    let rows = sqlx::query(
        "SELECT code, name, rate_bps, is_final, is_active, note FROM tax_template
          ORDER BY is_active DESC, code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(TaxTemplate {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                rate_bps: row.try_get("rate_bps")?,
                is_final: row.try_get("is_final")?,
                is_active: row.try_get("is_active")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

pub async fn save_tax_template(
    pool: &PgPool,
    template: &TaxTemplate,
    actor: &str,
) -> Result<Vec<TaxTemplate>, AppError> {
    let code = template.code.trim().to_ascii_uppercase();
    if code.is_empty() || template.name.trim().is_empty() {
        return Err(AppError::Validation("a tax template has a code and a name".into()));
    }
    if !(0..=10_000).contains(&template.rate_bps) {
        return Err(AppError::Validation("a rate is between 0 and 10,000 basis points".into()));
    }
    sqlx::query(
        "INSERT INTO tax_template (code, name, rate_bps, is_final, is_active, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, rate_bps = EXCLUDED.rate_bps, is_final = EXCLUDED.is_final,
                is_active = EXCLUDED.is_active, note = EXCLUDED.note",
    )
    .bind(&code)
    .bind(template.name.trim())
    .bind(template.rate_bps)
    .bind(template.is_final)
    .bind(template.is_active)
    .bind(template.note.as_deref().map(str::trim).filter(|n| !n.is_empty()))
    .bind(actor)
    .execute(pool)
    .await?;
    tax_templates(pool).await
}

pub async fn save_tax_type(pool: &PgPool, tax: &TaxTypeSetting) -> Result<TaxTypeSetting, AppError> {
    let code = tax.code.trim().to_ascii_uppercase();
    let nature = tax.nature.trim().to_ascii_uppercase();
    let key = tax.semantic_key.trim().to_ascii_lowercase();
    if code.is_empty() || tax.name.trim().is_empty() || key.is_empty() {
        return Err(AppError::Validation(
            "a tax type has a code, a name and the role its account answers to".into(),
        ));
    }
    if !matches!(nature.as_str(), "PAYABLE" | "CREDIT") {
        return Err(AppError::Validation("a tax is PAYABLE or CREDIT".into()));
    }
    sqlx::query(
        "INSERT INTO tax_type (code, name, nature, semantic_key, authority, active, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, nature = EXCLUDED.nature,
                semantic_key = EXCLUDED.semantic_key, authority = EXCLUDED.authority,
                active = EXCLUDED.active, note = EXCLUDED.note",
    )
    .bind(&code)
    .bind(tax.name.trim())
    .bind(&nature)
    .bind(&key)
    .bind(tax.authority.trim())
    .bind(tax.active)
    .bind(tax.note.as_deref().map(str::trim).filter(|n| !n.is_empty()))
    .execute(pool)
    .await?;
    Ok(TaxTypeSetting {
        code,
        name: tax.name.trim().to_string(),
        nature,
        semantic_key: key,
        authority: tax.authority.trim().to_string(),
        active: tax.active,
        note: tax.note.clone(),
    })
}
