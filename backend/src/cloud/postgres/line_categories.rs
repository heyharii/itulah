//! The category a journal line carries, and which accounts admit one.
//!
//! # Why a line carries this at all
//!
//! The forty-account chart stopped baking identity into the account code.
//! Which bank, which rack, which article of PPh, electricity rather than
//! water — none of those are report lines, so none of them are accounts any
//! more. Most moved onto columns the line already had (`bank_account_id`,
//! `asset_id`, `supplier_id`, `counter_site_id`) or onto a master that is
//! richer than a code ever was (`tax_type`, `financing_facility`,
//! `principal`). What was left over — fifty-two kinds of expense, thirteen
//! pay components, the cash pots, the tenders — had no home, and this is it:
//! one table, many families, one code on the line.
//!
//! # One table, and `category_code` unique across every family
//!
//! Not one table per family, and not `(family, code)` as the key. A journal
//! line carries the code alone, so reading "what kind of thing is this"
//! must not depend on which account the line happens to sit in. Values that
//! would otherwise collide across families are spelled with the family in
//! front of them — `ADVANCE_OTHER`, `INCOME_OTHER`, `TENDER_OTHER`.
//!
//! # What this module is for, and what enforces the rule
//!
//! The rule — an account declaring a family refuses a line without a category
//! from it, an account declaring none refuses a line carrying one — is a
//! database trigger, in the style of `assert_period_open`, and the sentence a
//! person reads when it is broken comes from `ledger::assert_category_for_account`
//! on the way in. Deliberately not repeated here: two implementations of one
//! rule is the disease this codebase keeps curing.
//!
//! This module is the READ side of the same fact, and the only reader that
//! needs it is the account picker: given an account, which categories are
//! legal. That question is asked before anything is typed, which is why it is
//! a list and not a refusal.

use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

/// One category, in the family that owns it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LineCategory {
    pub category_code: String,
    pub family: String,
    /// The client's own word for it, never translated.
    pub name: String,
    pub name_en: Option<String>,
    /// The client's own ten-digit account this value was carved out of.
    ///
    /// NULL where there was no such account — the pots, the tenders and the
    /// item classes were never lines in their chart. Everywhere else it is the
    /// number an accountant already knows, and showing it beside the category
    /// is what makes the collapse legible to somebody who has been reading
    /// `6010311 Biaya Listrik` for years.
    pub legacy_code: Option<String>,
    pub sort_order: i32,
    pub is_active: bool,
}

/// An account that declares a family — one row of the answer to "where may
/// this category be used".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CategoryAccount {
    pub account_code: String,
    pub name: String,
}

/// One family: its categories counted, and the accounts that ask for it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CategoryFamily {
    pub family: String,
    pub category_count: i64,
    pub active_count: i64,
    /// The accounts whose `category_family` is this one. Sent with the
    /// families rather than fetched per account, because the picker needs the
    /// mapping in both directions and there are forty accounts in total.
    pub accounts: Vec<CategoryAccount>,
}

/// One account-and-category pair whose posting policy differs from the
/// account's own.
///
/// Merging 190 accounts into 40 merged 190 doors into 40, and neither answer
/// to "which door does the merged account get" is honest on its own: taking
/// the strictest closes correction paths that are live today, and taking the
/// most permissive opens doors that were shut. So the account takes the most
/// permissive of its sources and `account_category_policy` carries the
/// stricter source's door back at the category grain — nine rows, each one a
/// door that was shut before the merge and stays shut after it.
///
/// Sent to the picker so that a combination which cannot post is visible
/// before somebody types an amount against it. The ENFORCEMENT is
/// `ledger::validate_account_posting`, on the way in, as it is for every other
/// policy here; this is the read side of the same fact.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CategoryPolicyOverride {
    pub account_code: String,
    pub category_code: String,
    /// `OPEN`, `RULES_ONLY` or `BLOCKED`, as `ledger_account.posting_mode`
    /// spells it.
    pub posting_mode: String,
    /// `YES`, `APPROVAL` or `NO`.
    pub manual_je_policy: String,
    pub note: Option<String>,
}

/// Everything the account picker needs in one answer.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LineCategoryDirectory {
    pub categories: Vec<LineCategory>,
    pub families: Vec<CategoryFamily>,
    /// The pairs whose door is not the account's own. Empty for almost every
    /// account, which is why they are sent as a list of exceptions rather than
    /// as a policy on every pair: forty accounts times three hundred categories
    /// is a table nobody would draw.
    pub policies: Vec<CategoryPolicyOverride>,
}

/// The categories, and the families with which accounts declare them.
///
/// `family` narrows the categories; the families are returned whole either
/// way, because a screen that filtered to one family still has to know that
/// the account it is about declares a different one.
pub async fn line_categories(
    pool: &PgPool,
    family: Option<&str>,
) -> Result<LineCategoryDirectory, AppError> {
    let wanted = family
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);

    let rows = sqlx::query(
        "SELECT category_code, family, name, name_en, legacy_code, sort_order, is_active
           FROM line_category
          WHERE $1::text IS NULL OR family = $1
          ORDER BY family, sort_order, category_code",
    )
    .bind(wanted.as_deref())
    .fetch_all(pool)
    .await?;
    let categories = rows
        .iter()
        .map(|row| {
            Ok(LineCategory {
                category_code: row.try_get("category_code")?,
                family: row.try_get("family")?,
                name: row.try_get("name")?,
                name_en: row.try_get("name_en")?,
                legacy_code: row.try_get("legacy_code")?,
                sort_order: row.try_get("sort_order")?,
                is_active: row.try_get("is_active")?,
            })
        })
        .collect::<Result<Vec<LineCategory>, AppError>>()?;

    // Every family the table knows AND every family an account declares, so a
    // family declared by an account and never populated shows up as a family
    // with no categories rather than not at all. That state is exactly the one
    // worth seeing: the account refuses every posting until somebody fills it.
    let family_rows = sqlx::query(
        "WITH declared AS (
             SELECT DISTINCT category_family AS family FROM ledger_account
              WHERE category_family IS NOT NULL
         ),
         known AS (
             SELECT DISTINCT family FROM line_category
             UNION SELECT family FROM declared
         )
         SELECT k.family,
                (SELECT count(*) FROM line_category c
                  WHERE c.family = k.family)::bigint AS category_count,
                (SELECT count(*) FROM line_category c
                  WHERE c.family = k.family AND c.is_active)::bigint AS active_count
           FROM known k
          ORDER BY k.family",
    )
    .fetch_all(pool)
    .await?;

    let account_rows = sqlx::query(
        "SELECT category_family, account_code, name FROM ledger_account
          WHERE category_family IS NOT NULL AND NOT is_group
          ORDER BY account_code",
    )
    .fetch_all(pool)
    .await?;

    let mut families = Vec::with_capacity(family_rows.len());
    for row in &family_rows {
        let name: String = row.try_get("family")?;
        let mut accounts = Vec::new();
        for account in &account_rows {
            if account.try_get::<String, _>("category_family")? == name {
                accounts.push(CategoryAccount {
                    account_code: account.try_get("account_code")?,
                    name: account.try_get("name")?,
                });
            }
        }
        families.push(CategoryFamily {
            family: name,
            category_count: row.try_get("category_count")?,
            active_count: row.try_get("active_count")?,
            accounts,
        });
    }

    // Narrowed by the same `family` the categories were, so a picker asking
    // about one family is not handed the exceptions of every other.
    let policy_rows = sqlx::query(
        "SELECT p.account_code, p.category_code, p.posting_mode, p.manual_je_policy, p.note
           FROM account_category_policy p
           JOIN line_category c ON c.category_code = p.category_code
          WHERE $1::text IS NULL OR c.family = $1
          ORDER BY p.account_code, p.category_code",
    )
    .bind(wanted.as_deref())
    .fetch_all(pool)
    .await?;
    let policies = policy_rows
        .iter()
        .map(|row| {
            Ok(CategoryPolicyOverride {
                account_code: row.try_get("account_code")?,
                category_code: row.try_get("category_code")?,
                posting_mode: row.try_get("posting_mode")?,
                manual_je_policy: row.try_get("manual_je_policy")?,
                note: row.try_get("note")?,
            })
        })
        .collect::<Result<Vec<CategoryPolicyOverride>, AppError>>()?;

    Ok(LineCategoryDirectory {
        categories,
        families,
        policies,
    })
}
