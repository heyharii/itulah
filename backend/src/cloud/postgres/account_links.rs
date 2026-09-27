//! Account links — Finance's own decision about which account answers to a
//! posting role (0460).
//!
//! A posting rule names a ROLE (`cash`, `trade_payable`, `payroll_expense`) and
//! where the decision is kept (today always the company's own defaults, with
//! the old qualifier as `source_id`). Which ACCOUNT answers is a link, and a
//! link holds for a scope: every unit's books, one kind of unit (HO or STORE),
//! or one unit (0606 — it said "site" while the books were kept per site). The
//! most specific link wins, so a fifteenth store inherits every link that holds
//! for all stores and nobody writes a row for it.
//!
//! Everything a person can do to that decision is here: read the links, set
//! one, remove one, see who changed what, and ask whether the books are ready
//! to post — which is the question the whole screen exists to answer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use super::ledger::{assert_category_for_account, assert_postable, book_locations, required_semantic_keys, BookLocation, Intent, SemanticKeyDoc};
use crate::cloud::application::AppError;

/// One link: a role, where the decision is kept, for whom it holds, and the
/// account.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountLink {
    pub link_id: i64,
    pub role: String,
    /// `COMPANY` today; the master records (expense category, pay component,
    /// payment method) arrive as sources of their own.
    pub source_type: String,
    /// Which one of the role's accounts this is — a bank, a pay class, an
    /// asset class, an affiliate family. Empty when the role needs no
    /// narrowing.
    pub source_id: String,
    /// `ALL`, `UNIT_KIND` or `UNIT`.
    pub scope_type: String,
    /// Empty for `ALL`, `HO`/`STORE`/`ONLINE` for `UNIT_KIND`, a unit id for `UNIT`.
    pub scope_key: String,
    pub account_code: String,
    pub account_name: String,
    pub account_type: Option<String>,
    pub category_code: Option<String>,
    /// How many units this link actually decides: the units in its scope that
    /// no more specific link overrides. A link that decides nothing is one a
    /// person can remove without changing a single posting.
    pub decides_units: i64,
    pub set_by: String,
    pub set_at: DateTime<Utc>,
    pub note: Option<String>,
}

/// Point a role at an account for a scope, or move it.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetAccountLinkRequest {
    pub role: String,
    /// `COMPANY` (the default), or the master the decision belongs to:
    /// `EXPENSE_CATEGORY`, `PARTY` (`SUPPLIER:<id>`), `PARTY_GROUP`
    /// (`SUPPLIER:<category>`), `PAY_COMPONENT`,
    /// `ASSET_CLASS`, `PAYMENT_METHOD`, `TAX_TEMPLATE`, `DIVISION`.
    #[serde(default = "company")]
    pub source_type: String,
    #[serde(default)]
    pub source_id: String,
    /// `ALL`, `UNIT_KIND` or `UNIT`.
    pub scope_type: String,
    /// `HO`/`STORE`/`ONLINE` for `UNIT_KIND`, a unit id for `UNIT`, empty for `ALL`.
    #[serde(default)]
    pub scope_key: String,
    pub account_code: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub category_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

/// What a caller is asking the link list for.
#[derive(Clone, Debug, Default)]
pub struct AccountLinkScope {
    /// Free text, tried against the role, the source, the account code and
    /// the account's name.
    pub needle: Option<String>,
    /// Roles to keep. Empty means every role.
    pub roles: Vec<String>,
}

/// The links, with the two lists they are read against: the roles the
/// posting rules use (with their labels) and the units books are kept for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountLinkPage {
    pub rows: Vec<AccountLink>,
    pub total: i64,
    pub roles: Vec<SemanticKeyDoc>,
    pub locations: Vec<BookLocation>,
    /// (role, source, unit) combinations that resolve nowhere — the number the
    /// readiness screen breaks down. Never narrowed by the search.
    pub gaps: i64,
}

/// One change to a link, as `account_link_history` kept it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountLinkChange {
    pub history_id: i64,
    pub link_id: i64,
    pub action: String,
    pub role: String,
    pub source_id: String,
    pub scope_type: String,
    pub scope_key: String,
    pub old_account_code: Option<String>,
    pub new_account_code: Option<String>,
    pub changed_by: String,
    pub changed_at: DateTime<Utc>,
    pub note: Option<String>,
}

/// One cell of the readiness matrix: what a role, from a source, lands on in
/// a unit's books — or that it lands nowhere.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReadinessCell {
    pub unit_id: String,
    pub account_code: Option<String>,
    /// Which scope decided it: `ALL`, `UNIT_KIND` or `UNIT`. Absent on a gap.
    pub scope_type: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReadinessRow {
    pub role: String,
    pub label: Option<String>,
    pub source_type: String,
    pub source_id: String,
    pub cells: Vec<ReadinessCell>,
    pub gaps: i64,
}

/// "If this happened now in this unit's books, would it post?" — for every
/// role the posting rules use and every source a link names.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostingReadiness {
    pub locations: Vec<BookLocation>,
    pub rows: Vec<ReadinessRow>,
    pub gaps: i64,
}

const LINK_ROWS: &str = "
    SELECT l.link_id, l.role, l.source_type, l.source_id, l.scope_type, l.scope_key,
           l.account_code, a.name AS account_name, a.account_type, l.category_code,
           l.set_by, l.set_at, l.note,
           (SELECT COUNT(*) FROM account_resolution r WHERE r.link_id = l.link_id)::bigint
               AS decides_units
      FROM account_link l
      JOIN ledger_account a ON a.account_code = l.account_code";

fn to_link(row: &sqlx::postgres::PgRow) -> Result<AccountLink, AppError> {
    Ok(AccountLink {
        link_id: row.try_get("link_id")?,
        role: row.try_get("role")?,
        source_type: row.try_get("source_type")?,
        source_id: row.try_get("source_id")?,
        scope_type: row.try_get("scope_type")?,
        scope_key: row.try_get("scope_key")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        account_type: row.try_get("account_type")?,
        category_code: row.try_get("category_code")?,
        decides_units: row.try_get("decides_units")?,
        set_by: row.try_get("set_by")?,
        set_at: row.try_get("set_at")?,
        note: row.try_get("note")?,
    })
}

/// Every link the search and the role filter keep, in the order a person reads
/// them: role, source, then the widest scope first so the exceptions sit under
/// the rule they override.
///
/// Not paged. There are a few hundred links where the map had 8,330 rows,
/// and a list a person reads top to bottom to find the exception is a list
/// they need whole.
pub async fn account_link_page(
    pool: &PgPool,
    scope: AccountLinkScope,
) -> Result<AccountLinkPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let roles = (!scope.roles.is_empty()).then(|| scope.roles.clone());
    let sql = format!(
        "{LINK_ROWS}
          WHERE ($1::text IS NULL
                 OR l.role ILIKE $1 OR l.source_id ILIKE $1
                 OR l.account_code ILIKE $1 OR a.name ILIKE $1)
            AND ($2::text[] IS NULL OR l.role = ANY($2))
          ORDER BY l.role, l.source_type, l.source_id,
                   CASE l.scope_type WHEN 'ALL' THEN 0 WHEN 'UNIT_KIND' THEN 1 ELSE 2 END,
                   l.scope_key"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&roles)
        .fetch_all(pool)
        .await?;
    let rows = rows.iter().map(to_link).collect::<Result<Vec<_>, _>>()?;
    let readiness = posting_readiness(pool).await?;
    Ok(AccountLinkPage {
        total: rows.len() as i64,
        rows,
        roles: required_semantic_keys(),
        locations: readiness.locations,
        gaps: readiness.gaps,
    })
}

fn company() -> String {
    "COMPANY".to_string()
}

/// The master record a link names has to exist: a link to a category nobody
/// created is a decision about nothing.
async fn assert_source_exists(pool: &PgPool, source_type: &str, source_id: &str) -> Result<(), AppError> {
    let lookup = match source_type {
        "COMPANY" => return Ok(()),
        "EXPENSE_CATEGORY" => "SELECT EXISTS (SELECT 1 FROM expense_category WHERE code = $1)",
        "PAY_COMPONENT" => "SELECT EXISTS (SELECT 1 FROM pay_component WHERE code = $1)",
        "ASSET_CLASS" => "SELECT EXISTS (SELECT 1 FROM asset_class WHERE class_code = $1)",
        "PAYMENT_METHOD" => "SELECT EXISTS (SELECT 1 FROM payment_method WHERE code = $1)",
        "TAX_TEMPLATE" => "SELECT EXISTS (SELECT 1 FROM tax_template WHERE code = $1)",
        "DIVISION" => "SELECT EXISTS (SELECT 1 FROM division WHERE code = $1)",
        "PARTY_GROUP" => "SELECT $1 IN ('SUPPLIER:MERCHANDISE', 'SUPPLIER:EXPENSE', 'SUPPLIER:AFFILIATE')",
        "PARTY" => {
            let (kind, id) = source_id.split_once(':').unwrap_or_default();
            let known: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM party_type WHERE party_type = $1)",
            )
            .bind(kind)
            .fetch_one(pool)
            .await?;
            if !known || id.trim().is_empty() {
                return Err(AppError::Validation(
                    "a party link names the party as TYPE:id, for example SUPPLIER:SUP-0012".into(),
                ));
            }
            return Ok(());
        }
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a source a link can come from"
            )))
        }
    };
    let exists: bool = sqlx::query_scalar(lookup).bind(source_id).fetch_one(pool).await?;
    if exists {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "there is no {} {source_id}",
            source_type.to_lowercase().replace('_', " ")
        )))
    }
}

fn scope_columns(request: &SetAccountLinkRequest) -> Result<(&'static str, Option<String>, Option<String>), AppError> {
    let key = request.scope_key.trim();
    match request.scope_type.trim().to_ascii_uppercase().as_str() {
        "ALL" => Ok(("ALL", None, None)),
        "UNIT_KIND" => match key.to_ascii_uppercase().as_str() {
            kind @ ("HO" | "STORE" | "ONLINE") => Ok(("UNIT_KIND", Some(kind.to_string()), None)),
            _ => Err(AppError::Validation(
                "a link for one kind of unit names the kind: HO, STORE or ONLINE".into(),
            )),
        },
        "UNIT" if !key.is_empty() => Ok(("UNIT", None, Some(key.to_string()))),
        "UNIT" => Err(AppError::Validation("a link for one unit names the unit".into())),
        other => Err(AppError::Validation(format!(
            "scope {other:?} is not one of ALL, UNIT_KIND or UNIT"
        ))),
    }
}

/// Point a role at an account for a scope, or move it.
///
/// Upsert: moving a link is an ordinary act, and making somebody remove it
/// first would open a window in which postings refuse for a reason nobody
/// intended. The account is checked here for the sentence and by the database
/// for the guarantee — postable, the right category, and a kind of account the
/// role accepts (0460).
pub async fn set_account_link(
    pool: &PgPool,
    request: &SetAccountLinkRequest,
    actor: &str,
) -> Result<AccountLink, AppError> {
    let role = request.role.trim().to_ascii_lowercase();
    if role.is_empty() {
        return Err(AppError::Validation("name the role the link is for".into()));
    }
    let code = request.account_code.trim();
    assert_postable(pool, code, Intent::Map).await?;
    let category = request
        .category_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    assert_category_for_account(pool, code, category, Intent::Map).await?;
    let (scope_type, unit_kind, unit_id) = scope_columns(request)?;
    let source_type = request.source_type.trim().to_ascii_uppercase();
    assert_source_exists(pool, &source_type, request.source_id.trim()).await?;

    let link_id: i64 = sqlx::query_scalar(
        "INSERT INTO account_link
            (role, source_type, source_id, scope_type, scope_unit_kind, scope_unit_id,
             account_code, category_code, set_by, note)
         VALUES ($1, $10, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (role, source_type, source_id, scope_type, scope_key)
         DO UPDATE SET account_code = EXCLUDED.account_code,
                       category_code = EXCLUDED.category_code,
                       set_by = EXCLUDED.set_by,
                       set_at = now(),
                       note = EXCLUDED.note
         RETURNING link_id",
    )
    .bind(&role)
    .bind(request.source_id.trim())
    .bind(scope_type)
    .bind(unit_kind)
    .bind(unit_id)
    .bind(code)
    .bind(category)
    .bind(actor)
    .bind(request.note.as_deref())
    .bind(&source_type)
    .fetch_one(pool)
    .await?;
    account_link(pool, link_id).await
}

pub async fn account_link(pool: &PgPool, link_id: i64) -> Result<AccountLink, AppError> {
    let row = sqlx::query(&format!("{LINK_ROWS} WHERE l.link_id = $1"))
        .bind(link_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("account link {link_id}")))?;
    to_link(&row)
}

/// Remove a link.
///
/// Refused when it would leave a unit with nothing to post to — that is a
/// posting that works today and refuses tomorrow, and the person removing an
/// "unused" link deserves to hear which units it was quietly deciding. `force`
/// removes it anyway, for the day somebody means exactly that.
pub async fn remove_account_link(
    pool: &PgPool,
    link_id: i64,
    force: bool,
    actor: &str,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let link = sqlx::query(
        "SELECT role, source_type, source_id FROM account_link WHERE link_id = $1 FOR UPDATE",
    )
    .bind(link_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("account link {link_id}")))?;
    let role: String = link.try_get("role")?;
    let source_type: String = link.try_get("source_type")?;
    let source_id: String = link.try_get("source_id")?;

    let before: Vec<String> = sqlx::query_scalar(
        "SELECT unit_id FROM account_resolution
          WHERE role = $1 AND source_type = $2 AND source_id = $3 ORDER BY unit_id",
    )
    .bind(&role)
    .bind(&source_type)
    .bind(&source_id)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query("SELECT set_config('finance.actor', $1, true)")
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM account_link WHERE link_id = $1")
        .bind(link_id)
        .execute(&mut *tx)
        .await?;
    let after: Vec<String> = sqlx::query_scalar(
        "SELECT unit_id FROM account_resolution
          WHERE role = $1 AND source_type = $2 AND source_id = $3 ORDER BY unit_id",
    )
    .bind(&role)
    .bind(&source_type)
    .bind(&source_id)
    .fetch_all(&mut *tx)
    .await?;
    let orphaned: Vec<&String> = before.iter().filter(|unit| !after.contains(unit)).collect();
    if !orphaned.is_empty() && !force {
        return Err(AppError::Conflict(format!(
            "removing this link leaves {role}{} with no account in the books of {}; link those \
             units first, or remove it anyway",
            if source_id.is_empty() { String::new() } else { format!(" ({source_id})") },
            orphaned.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
        )));
    }
    tx.commit().await?;
    Ok(())
}

/// The last changes to the links, newest first; one role's when `role` is set.
pub async fn account_link_history(
    pool: &PgPool,
    role: Option<&str>,
    limit: i64,
) -> Result<Vec<AccountLinkChange>, AppError> {
    account_link_history_before(pool, role, None, limit).await
}

/// The same history, a page at a time: the changes that come after `before`
/// (a `history_id` the previous page ended on) in the history's own order.
/// The seek re-reads that row's `changed_at`, so the page boundary is the
/// same pair the `ORDER BY` sorts on and no two rows can tie across it. A
/// caller has a next page exactly when a page comes back full.
pub async fn account_link_history_before(
    pool: &PgPool,
    role: Option<&str>,
    before: Option<i64>,
    limit: i64,
) -> Result<Vec<AccountLinkChange>, AppError> {
    let rows = sqlx::query(
        "SELECT history_id, link_id, action, role, source_id, scope_type, scope_key,
                old_account_code, new_account_code, changed_by, changed_at, note
           FROM account_link_history
          WHERE ($1::text IS NULL OR role = $1)
            AND ($3::bigint IS NULL
                 OR (changed_at, history_id) < (SELECT h.changed_at, h.history_id
                                                  FROM account_link_history h
                                                 WHERE h.history_id = $3))
          ORDER BY changed_at DESC, history_id DESC
          LIMIT $2",
    )
    .bind(role)
    .bind(limit.clamp(1, 1000))
    .bind(before)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(AccountLinkChange {
                history_id: row.try_get("history_id")?,
                link_id: row.try_get("link_id")?,
                action: row.try_get("action")?,
                role: row.try_get("role")?,
                source_id: row.try_get("source_id")?,
                scope_type: row.try_get("scope_type")?,
                scope_key: row.try_get("scope_key")?,
                old_account_code: row.try_get("old_account_code")?,
                new_account_code: row.try_get("new_account_code")?,
                changed_by: row.try_get("changed_by")?,
                changed_at: row.try_get("changed_at")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

/// For every role the posting rules name and every source a link names, what
/// each unit resolves to.
///
/// A (role, source) is expected wherever it resolves anywhere: a bank linked at
/// twelve stores and not the thirteenth is a gap at the thirteenth. A role the
/// rules need that no link names at all is a gap in every unit.
pub async fn posting_readiness(pool: &PgPool) -> Result<PostingReadiness, AppError> {
    let locations = book_locations(pool).await?;
    let docs = required_semantic_keys();
    let required: Vec<String> = docs.iter().map(|doc| doc.key.clone()).collect();
    let rows = sqlx::query(
        "WITH wanted AS (
             SELECT DISTINCT role, source_type, source_id FROM account_link
             UNION
             SELECT k, 'COMPANY', '' FROM unnest($1::text[]) k
              WHERE NOT EXISTS (SELECT 1 FROM account_link l WHERE l.role = k)
             UNION
             -- Every live master record has to land somewhere, linked or not:
             -- a category or component nobody linked is a gap in every unit.
             SELECT 'expense', 'EXPENSE_CATEGORY', code FROM expense_category WHERE is_active
             UNION
             SELECT CASE kind WHEN 'EARNING' THEN 'payroll_expense' ELSE 'payroll_deduction' END,
                    'PAY_COMPONENT', code
               FROM pay_component WHERE retired_at IS NULL AND NOT paid_from_accrual
             UNION
             SELECT 'payroll_expense', 'PAY_COMPONENT', code
               FROM pay_component WHERE retired_at IS NULL AND employer_borne
             UNION
             -- A payment method's accounts are the company's links narrowed by
             -- its bank (0468).
             SELECT m.role, 'COMPANY', p.bank_code
               FROM payment_method p
              CROSS JOIN LATERAL payment_method_roles(p.tender_type, p.settlement_mode) m (role)
              WHERE p.is_active
         )
         SELECT w.role, w.source_type, w.source_id, u.id AS unit_id, r.account_code, r.scope_type
           FROM wanted w
          CROSS JOIN unit u
           LEFT JOIN account_resolution r
                  ON r.role = w.role AND r.source_type = w.source_type
                 AND r.source_id = w.source_id AND r.unit_id = u.id
          ORDER BY w.role, w.source_type, w.source_id, (u.kind <> 'HO'), u.code",
    )
    .bind(&required)
    .fetch_all(pool)
    .await?;

    let mut out: Vec<ReadinessRow> = Vec::new();
    for row in &rows {
        let role: String = row.try_get("role")?;
        let source_type: String = row.try_get("source_type")?;
        let source_id: String = row.try_get("source_id")?;
        let cell = ReadinessCell {
            unit_id: row.try_get("unit_id")?,
            account_code: row.try_get("account_code")?,
            scope_type: row.try_get("scope_type")?,
        };
        let gap = i64::from(cell.account_code.is_none());
        match out.last_mut() {
            Some(last)
                if last.role == role
                    && last.source_type == source_type
                    && last.source_id == source_id =>
            {
                last.cells.push(cell);
                last.gaps += gap;
            }
            _ => out.push(ReadinessRow {
                label: docs.iter().find(|doc| doc.key == role).map(|doc| doc.label.clone()),
                role,
                source_type,
                source_id,
                cells: vec![cell],
                gaps: gap,
            }),
        }
    }
    let gaps = out.iter().map(|row| row.gaps).sum();
    Ok(PostingReadiness {
        locations,
        rows: out,
        gaps,
    })
}
