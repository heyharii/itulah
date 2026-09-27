//! Owner policies as settings (0471).
//!
//! The mechanisms that keep the books safe stay in the database — a trigger
//! refuses a document on an account it may not reach, a supplier payable at a
//! shop, a line on a frozen account. What they enforce is Finance's to edit:
//!
//! * which documents may reach an account (`account_source_rule`);
//! * which accounts belong to head office only (`external_party_account`);
//! * whether automatic posting runs, globally and per document kind.
//!
//! Freezing an account and requiring a counterparty unit are flags on the
//! account itself, edited with the chart (`chart_changes`).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountSourceRule {
    pub account_code: String,
    /// The document kind (`journal_entry.source_kind`), e.g. `CASH_SHIFT`.
    pub source_kind: String,
    /// `ALLOW` or `DENY`. An account with any ALLOW admits only those kinds;
    /// DENY wins over ALLOW.
    pub effect: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub category_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct HeadOfficeAccount {
    pub account_code: String,
    /// `SUPPLIER`, `SERVICE`, `BANK`, `TAX`, `BPJS`, `LENDER` or `OTHER`.
    pub kind: String,
    pub note: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostingSwitches {
    /// Every automatic flow at once.
    pub automatic_posting_enabled: bool,
    pub changed_by: String,
    pub changed_at: DateTime<Utc>,
    pub sources: Vec<PostingSwitch>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostingSwitch {
    pub source_kind: String,
    /// `SALES`, `INVENTORY`, `FINANCE`, `PAYROLL`, `ASSETS` or `PURCHASING`.
    pub module: String,
    pub enabled: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetAutomaticPostingRequest {
    pub enabled: bool,
}

// -- which documents may reach an account ------------------------------------

pub async fn account_source_rules(
    pool: &PgPool,
    account: Option<&str>,
) -> Result<Vec<AccountSourceRule>, AppError> {
    let rows = sqlx::query(
        "SELECT account_code, source_kind, effect, category_code, note FROM account_source_rule
          WHERE $1::text IS NULL OR account_code = $1
          ORDER BY account_code, effect, source_kind",
    )
    .bind(account)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(AccountSourceRule {
                account_code: row.try_get("account_code")?,
                source_kind: row.try_get("source_kind")?,
                effect: row.try_get("effect")?,
                category_code: row.try_get("category_code")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

pub async fn set_account_source_rule(
    pool: &PgPool,
    rule: &AccountSourceRule,
    actor: &str,
) -> Result<Vec<AccountSourceRule>, AppError> {
    let effect = rule.effect.trim().to_ascii_uppercase();
    if !matches!(effect.as_str(), "ALLOW" | "DENY") {
        return Err(AppError::Validation("a rule ALLOWs or DENYs a document kind".into()));
    }
    let category = rule.category_code.as_deref().map(str::trim).filter(|c| !c.is_empty());
    sqlx::query(
        "INSERT INTO account_source_rule (account_code, source_kind, effect, category_code, set_by, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (account_code, source_kind, COALESCE(category_code, ''))
         DO UPDATE SET effect = EXCLUDED.effect, set_by = EXCLUDED.set_by, set_at = now(),
                       note = EXCLUDED.note",
    )
    .bind(rule.account_code.trim())
    .bind(rule.source_kind.trim().to_ascii_uppercase())
    .bind(&effect)
    .bind(category)
    .bind(actor)
    .bind(rule.note.as_deref())
    .execute(pool)
    .await?;
    account_source_rules(pool, Some(rule.account_code.trim())).await
}

pub async fn remove_account_source_rule(
    pool: &PgPool,
    account_code: &str,
    source_kind: &str,
    category_code: Option<&str>,
) -> Result<Vec<AccountSourceRule>, AppError> {
    sqlx::query(
        "DELETE FROM account_source_rule
          WHERE account_code = $1 AND source_kind = $2
            AND COALESCE(category_code, '') = COALESCE($3, '')",
    )
    .bind(account_code)
    .bind(source_kind.to_ascii_uppercase())
    .bind(category_code)
    .execute(pool)
    .await?;
    account_source_rules(pool, Some(account_code)).await
}

// -- head office only --------------------------------------------------------

pub async fn head_office_accounts(pool: &PgPool) -> Result<Vec<HeadOfficeAccount>, AppError> {
    let rows = sqlx::query(
        "SELECT account_code, kind, note FROM external_party_account ORDER BY account_code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(HeadOfficeAccount {
                account_code: row.try_get("account_code")?,
                kind: row.try_get("kind")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

/// Mark an account as head office's only: a supplier, a lender or a tax
/// office faces head office, and a unit reaches the same result through the
/// affiliate accounts (I4).
pub async fn set_head_office_account(
    pool: &PgPool,
    account: &HeadOfficeAccount,
    actor: &str,
) -> Result<Vec<HeadOfficeAccount>, AppError> {
    sqlx::query(
        "INSERT INTO external_party_account (account_code, kind, note, set_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_code) DO UPDATE
            SET kind = EXCLUDED.kind, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now()",
    )
    .bind(account.account_code.trim())
    .bind(account.kind.trim().to_ascii_uppercase())
    .bind(account.note.trim())
    .bind(actor)
    .execute(pool)
    .await?;
    head_office_accounts(pool).await
}

pub async fn remove_head_office_account(
    pool: &PgPool,
    account_code: &str,
) -> Result<Vec<HeadOfficeAccount>, AppError> {
    sqlx::query("DELETE FROM external_party_account WHERE account_code = $1")
        .bind(account_code)
        .execute(pool)
        .await?;
    head_office_accounts(pool).await
}

// -- automatic posting ------------------------------------------------------

pub async fn posting_switches(pool: &PgPool) -> Result<PostingSwitches, AppError> {
    let control = sqlx::query(
        "SELECT automatic_posting_enabled, changed_by, changed_at FROM finance_posting_control
          WHERE singleton",
    )
    .fetch_one(pool)
    .await?;
    let rows = sqlx::query(
        "SELECT source_kind, module, enabled, note FROM finance_posting_source_policy
          ORDER BY module, source_kind",
    )
    .fetch_all(pool)
    .await?;
    Ok(PostingSwitches {
        automatic_posting_enabled: control.try_get("automatic_posting_enabled")?,
        changed_by: control.try_get("changed_by")?,
        changed_at: control.try_get("changed_at")?,
        sources: rows
            .iter()
            .map(|row| {
                Ok(PostingSwitch {
                    source_kind: row.try_get("source_kind")?,
                    module: row.try_get("module")?,
                    enabled: row.try_get("enabled")?,
                    note: row.try_get("note")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?,
    })
}

pub async fn set_automatic_posting(
    pool: &PgPool,
    enabled: bool,
    actor: &str,
) -> Result<PostingSwitches, AppError> {
    sqlx::query(
        "UPDATE finance_posting_control
            SET automatic_posting_enabled = $1, changed_by = $2, changed_at = now()
          WHERE singleton",
    )
    .bind(enabled)
    .bind(actor)
    .execute(pool)
    .await?;
    posting_switches(pool).await
}

pub async fn set_posting_switch(
    pool: &PgPool,
    switch: &PostingSwitch,
    actor: &str,
) -> Result<PostingSwitches, AppError> {
    sqlx::query(
        "INSERT INTO finance_posting_source_policy (source_kind, module, enabled, set_by, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_kind) DO UPDATE
            SET module = EXCLUDED.module, enabled = EXCLUDED.enabled, set_by = EXCLUDED.set_by,
                set_at = now(), note = EXCLUDED.note",
    )
    .bind(switch.source_kind.trim().to_ascii_uppercase())
    .bind(switch.module.trim().to_ascii_uppercase())
    .bind(switch.enabled)
    .bind(actor)
    .bind(switch.note.as_deref())
    .execute(pool)
    .await?;
    posting_switches(pool).await
}
