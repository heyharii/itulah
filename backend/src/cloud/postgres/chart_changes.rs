//! The chart of accounts, edited from a screen (0461).
//!
//! Finance adds, renames, moves, retypes, retires and revives accounts without
//! a migration, the way an Accounts Manager does in ERPNext. The change applies
//! at once; who may make it is decided by permission. Every change is kept in
//! `ledger_account_change` with the account before and after, who and why —
//! the trigger writes it, this module only says who and why.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::cloud::application::AppError;

/// What somebody asks to change about one account.
///
/// One shape for every kind so a screen has one form. Fields a kind does not
/// read are ignored: `DEACTIVATE` reads only the code.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChartChangeRequest {
    /// `CREATE`, `UPDATE`, `DEACTIVATE` or `REACTIVATE`.
    pub kind: String,
    pub account_code: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub name: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub parent_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_group: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_type: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub statement_section: Option<String>,
    /// `unit` or `company` on a leaf.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub dimension: Option<String>,
    /// ERPNext freeze_account: a frozen account takes no new line (0471).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_frozen: Option<bool>,
    /// Lines on the account must name the unit on the other side (0471).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub requires_counter_site: Option<bool>,
    /// `D` or `C`. Defaults from the root: assets and expenses are debit.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub normal_balance: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub reason: Option<String>,
}

/// One change to the chart, as `ledger_account_change` kept it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChartChange {
    pub change_id: i64,
    pub account_code: String,
    /// `CREATE`, `UPDATE`, `DEACTIVATE` or `REACTIVATE`.
    pub action: String,
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown> | null"))]
    pub before: Option<Value>,
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub after: Value,
    pub reason: Option<String>,
    pub changed_by: String,
    pub changed_at: DateTime<Utc>,
}

const KINDS: [&str; 4] = ["CREATE", "UPDATE", "DEACTIVATE", "REACTIVATE"];

fn trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn payload_of(request: &ChartChangeRequest) -> Value {
    let mut payload = json!({});
    let object = payload.as_object_mut().expect("json! object");
    for (key, value) in [
        ("name", trimmed(&request.name)),
        ("parent_code", trimmed(&request.parent_code)),
        ("account_type", trimmed(&request.account_type).map(|t| t.to_ascii_uppercase())),
        (
            "statement_section",
            trimmed(&request.statement_section).map(|t| t.to_ascii_uppercase()),
        ),
        ("dimension", trimmed(&request.dimension).map(|t| t.to_ascii_lowercase())),
        (
            "normal_balance",
            trimmed(&request.normal_balance).map(|t| t.to_ascii_uppercase()),
        ),
    ] {
        if let Some(value) = value {
            object.insert(key.to_string(), Value::String(value));
        }
    }
    if let Some(is_group) = request.is_group {
        object.insert("is_group".into(), Value::Bool(is_group));
    }
    if let Some(frozen) = request.is_frozen {
        object.insert("is_frozen".into(), Value::Bool(frozen));
    }
    if let Some(counter) = request.requires_counter_site {
        object.insert("requires_counter_site".into(), Value::Bool(counter));
    }
    payload
}

fn text<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

/// Apply one change inside the caller's transaction.
///
/// The database's own checks do most of the refusing — the code format, the
/// parent being a heading of the same root (0345), the type fitting the root
/// (0460) — and reach the caller as P0001/23xxx. What is checked here is what
/// the database cannot see: that retiring an account would strand a link or a
/// balance.
async fn apply(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    code: &str,
    payload: &Value,
) -> Result<(), AppError> {
    match kind {
        "CREATE" => {
            let name = text(payload, "name")
                .ok_or_else(|| AppError::Validation("name the new account".into()))?;
            let parent_code = text(payload, "parent_code").ok_or_else(|| {
                AppError::Validation("a new account sits under a heading; name it".into())
            })?;
            let parent = sqlx::query(
                "SELECT is_group, statement_section FROM ledger_account WHERE account_code = $1",
            )
            .bind(parent_code)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AppError::Validation(format!("there is no account {parent_code}")))?;
            if !parent.try_get::<bool, _>("is_group")? {
                return Err(AppError::Validation(format!(
                    "{parent_code} is a leaf; a new account sits under a heading"
                )));
            }
            let is_group = payload.get("is_group").and_then(Value::as_bool).unwrap_or(false);
            let section = text(payload, "statement_section")
                .map(str::to_string)
                .unwrap_or(parent.try_get::<String, _>("statement_section")?);
            let root: String = sqlx::query_scalar("SELECT ledger_root_type($1, 'D')")
                .bind(&section)
                .fetch_one(&mut **tx)
                .await?;
            let normal_balance = match text(payload, "normal_balance") {
                Some(balance) => balance.to_string(),
                None if section == "OTHER_NET" => {
                    return Err(AppError::Validation(
                        "an account in OTHER_NET can be income or expense; say whether it is debit \
                         (D) or credit (C)"
                            .into(),
                    ))
                }
                None if matches!(root.as_str(), "ASSET" | "EXPENSE") => "D".into(),
                None => "C".into(),
            };
            let dimension = if is_group {
                None
            } else {
                Some(text(payload, "dimension").unwrap_or("unit").to_string())
            };
            sqlx::query(
                "INSERT INTO ledger_account
                    (account_code, name, parent_code, is_group, is_active, dimension,
                     normal_balance, is_contra, category_family, requires_counter_site,
                     posting_mode, manual_je_policy, posting_policy_configured,
                     code_provenance, statement_section, account_type)
                 VALUES ($1, $2, $3, $4, TRUE, $5, $6, FALSE, NULL, FALSE,
                         'MANUAL', 'YES', TRUE, 'PENDING_CLIENT_CODE', $7, $8)",
            )
            .bind(code)
            .bind(name)
            .bind(parent_code)
            .bind(is_group)
            .bind(dimension)
            .bind(&normal_balance)
            .bind(&section)
            .bind(if is_group { None } else { text(payload, "account_type") })
            .execute(&mut **tx)
            .await?;
        }
        "UPDATE" => {
            let changed = sqlx::query(
                "UPDATE ledger_account
                    SET name = COALESCE($2, name),
                        parent_code = COALESCE($3, parent_code),
                        account_type = COALESCE($4, account_type),
                        statement_section = COALESCE($5, statement_section),
                        dimension = CASE WHEN is_group THEN dimension ELSE COALESCE($6, dimension) END,
                        is_frozen = COALESCE($7, is_frozen),
                        requires_counter_site = COALESCE($8, requires_counter_site)
                  WHERE account_code = $1",
            )
            .bind(code)
            .bind(text(payload, "name"))
            .bind(text(payload, "parent_code"))
            .bind(text(payload, "account_type"))
            .bind(text(payload, "statement_section"))
            .bind(text(payload, "dimension"))
            .bind(payload.get("is_frozen").and_then(Value::as_bool))
            .bind(payload.get("requires_counter_site").and_then(Value::as_bool))
            .execute(&mut **tx)
            .await?
            .rows_affected();
            if changed == 0 {
                return Err(AppError::Validation(format!("there is no account {code}")));
            }
        }
        "DEACTIVATE" => {
            let linked: Vec<String> = sqlx::query_scalar(
                "SELECT DISTINCT role || CASE WHEN source_id = '' THEN '' ELSE ' (' || source_id || ')' END
                   FROM account_link WHERE account_code = $1 ORDER BY 1",
            )
            .bind(code)
            .fetch_all(&mut **tx)
            .await?;
            if !linked.is_empty() {
                return Err(AppError::Conflict(format!(
                    "{code} still answers to {}; move those links to another account first",
                    linked.join(", ")
                )));
            }
            let balance: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint
                   FROM journal_line WHERE account_code = $1",
            )
            .bind(code)
            .fetch_one(&mut **tx)
            .await?;
            if balance != 0 {
                return Err(AppError::Conflict(format!(
                    "{code} still carries a balance of {balance}; clear it before retiring the account"
                )));
            }
            let children: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM ledger_account WHERE parent_code = $1 AND is_active",
            )
            .bind(code)
            .fetch_one(&mut **tx)
            .await?;
            if children > 0 {
                return Err(AppError::Conflict(format!(
                    "{code} still has {children} live accounts under it; retire or move them first"
                )));
            }
            let changed = sqlx::query(
                "UPDATE ledger_account SET is_active = FALSE WHERE account_code = $1 AND is_active",
            )
            .bind(code)
            .execute(&mut **tx)
            .await?
            .rows_affected();
            if changed == 0 {
                return Err(AppError::Validation(format!("{code} is not a live account")));
            }
        }
        "REACTIVATE" => {
            let changed = sqlx::query(
                "UPDATE ledger_account SET is_active = TRUE WHERE account_code = $1 AND NOT is_active",
            )
            .bind(code)
            .execute(&mut **tx)
            .await?
            .rows_affected();
            if changed == 0 {
                return Err(AppError::Validation(format!("{code} is not a retired account")));
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not one of {}",
                KINDS.join(", ")
            )))
        }
    }
    Ok(())
}

fn to_change(row: &sqlx::postgres::PgRow) -> Result<ChartChange, AppError> {
    Ok(ChartChange {
        change_id: row.try_get("change_id")?,
        account_code: row.try_get("account_code")?,
        action: row.try_get("action")?,
        before: row.try_get("before")?,
        after: row.try_get("after")?,
        reason: row.try_get("reason")?,
        changed_by: row.try_get("changed_by")?,
        changed_at: row.try_get("changed_at")?,
    })
}

const CHANGE_COLUMNS: &str =
    "change_id, account_code, action, before, after, reason, changed_by, changed_at";

/// Change the chart, now, and say who did it and why.
pub async fn change_chart(
    pool: &PgPool,
    request: &ChartChangeRequest,
    actor: &str,
) -> Result<ChartChange, AppError> {
    let kind = request.kind.trim().to_ascii_uppercase();
    let kind = kind.strip_prefix("ACCOUNT_").unwrap_or(&kind).to_string();
    if !KINDS.contains(&kind.as_str()) {
        return Err(AppError::Validation(format!(
            "{kind:?} is not one of {}",
            KINDS.join(", ")
        )));
    }
    let code = request.account_code.trim();
    if code.is_empty() {
        return Err(AppError::Validation("name the account the change is about".into()));
    }
    let payload = payload_of(request);

    let mut tx = pool.begin().await?;
    sqlx::query("SELECT set_config('finance.actor', $1, true), set_config('finance.reason', $2, true)")
        .bind(actor)
        .bind(trimmed(&request.reason).unwrap_or_default())
        .execute(&mut *tx)
        .await?;
    apply(&mut tx, &kind, code, &payload).await?;
    // The chart's deferred checks (the tree, the roots) run before the answer
    // is read back, so a refusal arrives as a refusal and not at commit.
    sqlx::query("SET CONSTRAINTS ALL IMMEDIATE")
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query(&format!(
        "SELECT {CHANGE_COLUMNS} FROM ledger_account_change
          WHERE account_code = $1 ORDER BY change_id DESC LIMIT 1"
    ))
    .bind(code)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Conflict(format!("{code} did not change: it already says that")))?;
    tx.commit().await?;
    to_change(&row)
}

/// What changed in the chart, newest first; one account's when `account` is
/// set.
pub async fn chart_history(
    pool: &PgPool,
    account: Option<&str>,
    limit: i64,
) -> Result<Vec<ChartChange>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {CHANGE_COLUMNS} FROM ledger_account_change
          WHERE $1::text IS NULL OR account_code = $1
          ORDER BY change_id DESC
          LIMIT $2"
    ))
    .bind(account)
    .bind(limit.clamp(1, 1000))
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_change).collect()
}
