//! Advances: money out before anybody knows what it bought.
//!
//! One writer for four events, and each posts once:
//!
//!   pay          Dr Advance                      Cr Cash / Bank
//!   settle       Dr Expense (or an asset)        Cr Advance
//!   refund       Dr Cash / Bank                  Cr Advance
//!   cancel       nothing — an unpaid advance never reached the ledger
//!
//! The outstanding balance is arithmetic over the settlements, never a column,
//! so it cannot drift from what posted. Ageing is derived from `paid_at` for
//! the same reason.
//!
//! An advance is asked for at a site and booked to the unit that owns it
//! (`sites::unit_of_site`, 0605): every leg of all three entries sits in that
//! unit's books.

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, LineAccount, PostingIntent, PostingLine};
use crate::cloud::application::AppError;

const SOURCE_KIND: &str = "ADVANCE";
const RULE_VERSION: &str = "advance/1";
/// The meaning an advance sits in. Qualified by purpose, which is how the
/// client's four `1011303*` accounts are told apart.
const ADVANCE_MEANING: &str = "advance";

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Advance {
    pub advance_id: Uuid,
    pub advance_number: String,
    pub site_id: String,
    pub party_type: String,
    pub employee_id: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub party_name: Option<String>,
    /// Who it is, however this estate knows them — the employee's name, the
    /// supplier's name, or the name somebody typed.
    pub party_label: String,
    pub advance_qualifier: String,
    pub purpose: String,
    pub currency: String,
    pub amount_minor: i64,
    pub settled_minor: i64,
    pub refunded_minor: i64,
    /// What is still out with them.
    pub outstanding_minor: i64,
    pub status: String,
    pub requested_by: String,
    pub requested_at: chrono::DateTime<Utc>,
    pub approved_by: Option<String>,
    pub paid_at: Option<chrono::DateTime<Utc>>,
    /// Days since the money left, for the ageing report. Null until it does.
    pub age_days: Option<i64>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AdvanceSettlement {
    pub settlement_id: Uuid,
    pub kind: String,
    pub amount_minor: i64,
    pub account_code: Option<String>,
    pub account_name: Option<String>,
    /// What the spending was, on the accounts that are kept by kind — the half
    /// of "where it landed" that a four-digit code no longer carries.
    pub category_code: Option<String>,
    /// The client's own word for that kind, joined here rather than resolved
    /// in the browser.
    pub category_name: Option<String>,
    pub entry_id: Uuid,
    pub entry_number: Option<String>,
    pub evidence: Option<String>,
    pub note: Option<String>,
    pub settled_by: String,
    pub settled_at: chrono::DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AdvanceDocument {
    pub advance: Advance,
    pub settlements: Vec<AdvanceSettlement>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateAdvanceRequest {
    pub site_id: String,
    pub party_type: String,
    #[serde(default)]
    pub employee_id: Option<String>,
    #[serde(default)]
    pub supplier_id: Option<Uuid>,
    #[serde(default)]
    pub party_name: Option<String>,
    pub purpose: String,
    pub amount_minor: i64,
    #[serde(default)]
    pub advance_qualifier: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayAdvanceRequest {
    pub posting_date: NaiveDate,
    /// Which drawer or bank paid it.
    pub cash_key: String,
    #[serde(default)]
    pub cash_qualifier: String,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SettleAdvanceRequest {
    /// `EXPENSE` when receipts came back, `REFUND` when money did.
    pub kind: String,
    pub amount_minor: i64,
    pub posting_date: NaiveDate,
    /// Where an expense landed.
    #[serde(default)]
    pub account_code: Option<String>,
    /// And what it was. Required when that account declares a family: an
    /// advance settled into `6301` without saying which kind of cost is an
    /// advance nobody accounted for, which is the thing the refusal below
    /// already exists to prevent.
    #[serde(default)]
    pub category_code: Option<String>,
    /// Where a refund went back into.
    #[serde(default)]
    pub cash_key: Option<String>,
    #[serde(default)]
    pub cash_qualifier: String,
    #[serde(default)]
    pub evidence: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AdvanceReconciliationRow {
    /// Whose books: the control account is reconciled per unit (0605), each
    /// advance counted in the unit that owns the site it was asked for at.
    pub unit_id: String,
    pub account_code: String,
    pub account_name: String,
    pub gl_minor: i64,
    pub subledger_minor: i64,
    pub difference_minor: i64,
    pub open_advances: i64,
    /// Outstanding money that left more than thirty days ago.
    pub over_thirty_days_minor: i64,
}

const ADVANCE_COLUMNS: &str = "a.advance_id, a.advance_number, a.site_id, a.party_type,
     a.employee_id, a.supplier_id, a.party_name, a.advance_qualifier, a.purpose,
     a.currency::text AS currency, a.amount_minor, a.status, a.requested_by,
     a.requested_at, a.approved_by, a.paid_at, a.note,
     COALESCE(ep.full_name, s.name, a.party_name, a.employee_id, '—') AS party_label,
     COALESCE(t.expense_minor, 0)::bigint AS settled_minor,
     COALESCE(t.refund_minor, 0)::bigint  AS refunded_minor";

const ADVANCE_FROM: &str = "FROM advance a
       -- A person's name lives on their profile; `employee` carries the code
       -- and the employment history and no name at all.
       LEFT JOIN employee_profile ep ON ep.employee_id = a.employee_id
       LEFT JOIN supplier s ON s.supplier_id = a.supplier_id
       LEFT JOIN (
            SELECT advance_id,
                   SUM(amount_minor) FILTER (WHERE kind = 'EXPENSE') AS expense_minor,
                   SUM(amount_minor) FILTER (WHERE kind = 'REFUND')  AS refund_minor
              FROM advance_settlement GROUP BY advance_id
       ) t ON t.advance_id = a.advance_id";

fn to_advance(row: &sqlx::postgres::PgRow) -> Result<Advance, AppError> {
    let amount: i64 = row.try_get("amount_minor")?;
    let settled: i64 = row.try_get("settled_minor")?;
    let refunded: i64 = row.try_get("refunded_minor")?;
    let paid_at: Option<chrono::DateTime<Utc>> = row.try_get("paid_at")?;
    Ok(Advance {
        advance_id: row.try_get("advance_id")?,
        advance_number: row.try_get("advance_number")?,
        site_id: row.try_get("site_id")?,
        party_type: row.try_get("party_type")?,
        employee_id: row.try_get("employee_id")?,
        supplier_id: row.try_get("supplier_id")?,
        party_name: row.try_get("party_name")?,
        party_label: row.try_get("party_label")?,
        advance_qualifier: row.try_get("advance_qualifier")?,
        purpose: row.try_get("purpose")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_string(),
        amount_minor: amount,
        settled_minor: settled,
        refunded_minor: refunded,
        outstanding_minor: amount - settled - refunded,
        status: row.try_get("status")?,
        requested_by: row.try_get("requested_by")?,
        requested_at: row.try_get("requested_at")?,
        approved_by: row.try_get("approved_by")?,
        paid_at,
        age_days: paid_at.map(|at| (Utc::now() - at).num_days()),
        note: row.try_get("note")?,
    })
}

pub async fn advances(
    pool: &PgPool,
    site_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
) -> Result<Vec<Advance>, AppError> {
    let sql = format!(
        "SELECT {ADVANCE_COLUMNS} {ADVANCE_FROM}
          WHERE ($1::text IS NULL OR a.site_id = $1)
            AND ($2::text IS NULL OR a.status = $2)
          ORDER BY a.requested_at DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(status)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_advance).collect()
}

/// A page of advances, newest first, beside what the whole book says.
///
/// The bare list above stops at `limit` (100 unless asked) and says nothing,
/// so a screen adding up what is still out with people over it was adding up
/// the newest hundred. This pages on a keyset and carries the figures a screen
/// puts in its cards, computed over every advance at the unit rather than over
/// the page — and over every STATUS too, because "how much is still in
/// people's hands" does not change when somebody lists only the settled ones.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AdvancePage {
    pub rows: Vec<Advance>,
    pub next_cursor: Option<String>,
    /// Every advance the unit and status filters match.
    pub total: i64,
    /// Still out with somebody — PAID or PARTIALLY_SETTLED, less what came
    /// back as receipts or as money — across the unit, whatever status is
    /// listed.
    pub outstanding_minor: i64,
    /// How many of those left more than thirty days ago.
    pub over_thirty_days: i64,
}

/// Where the previous page stopped: the last advance's request time and id.
#[derive(Serialize, Deserialize)]
struct AdvanceCursor {
    requested_at: chrono::DateTime<Utc>,
    advance_id: Uuid,
}

pub async fn advance_page(
    pool: &PgPool,
    site_id: Option<&str>,
    status: Option<&str>,
    cursor: Option<&str>,
    limit: Option<i64>,
) -> Result<AdvancePage, AppError> {
    let cursor: Option<AdvanceCursor> = cursor.map(super::decode_cursor).transpose()?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let sql = format!(
        "SELECT {ADVANCE_COLUMNS} {ADVANCE_FROM}
          WHERE ($1::text IS NULL OR a.site_id = $1)
            AND ($2::text IS NULL OR a.status = $2)
            AND ($3::timestamptz IS NULL
                 OR (a.requested_at, a.advance_id) < ($3::timestamptz, $4::uuid))
          ORDER BY a.requested_at DESC, a.advance_id DESC
          LIMIT $5"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(status)
        .bind(cursor.as_ref().map(|c| c.requested_at))
        .bind(cursor.as_ref().map(|c| c.advance_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&AdvanceCursor {
            requested_at: row.try_get("requested_at")?,
            advance_id: row.try_get("advance_id")?,
        })?),
        _ => None,
    };
    let out = rows.iter().map(to_advance).collect::<Result<Vec<_>, _>>()?;

    // Thirty days the way `age_days` counts them: whole days since the money
    // left, and "more than thirty" is the thirty-first.
    let totals = sqlx::query(&format!(
        "SELECT COUNT(*) FILTER (WHERE $2::text IS NULL OR a.status = $2)::bigint AS total,
                COALESCE(SUM(a.amount_minor - COALESCE(t.expense_minor, 0)
                                            - COALESCE(t.refund_minor, 0))
                         FILTER (WHERE a.status IN ('PAID', 'PARTIALLY_SETTLED')), 0)::bigint
                    AS outstanding,
                COUNT(*) FILTER (WHERE a.status IN ('PAID', 'PARTIALLY_SETTLED')
                                   AND a.paid_at <= now() - interval '31 days')::bigint
                    AS over_thirty
           {ADVANCE_FROM}
          WHERE ($1::text IS NULL OR a.site_id = $1)"
    ))
    .bind(site_id)
    .bind(status)
    .fetch_one(pool)
    .await?;
    Ok(AdvancePage {
        rows: out,
        next_cursor,
        total: totals.try_get("total")?,
        outstanding_minor: totals.try_get("outstanding")?,
        over_thirty_days: totals.try_get("over_thirty")?,
    })
}

pub async fn advance_detail(pool: &PgPool, advance_id: Uuid) -> Result<AdvanceDocument, AppError> {
    let sql = format!("SELECT {ADVANCE_COLUMNS} {ADVANCE_FROM} WHERE a.advance_id = $1");
    let row = sqlx::query(&sql)
        .bind(advance_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("advance {advance_id}")))?;
    let advance = to_advance(&row)?;

    let rows = sqlx::query(
        "SELECT st.settlement_id, st.kind, st.amount_minor, st.account_code, la.name AS account_name,
                st.category_code, lk.name AS category_name,
                st.entry_id, e.entry_number, st.evidence, st.note, st.settled_by, st.settled_at
           FROM advance_settlement st
           LEFT JOIN ledger_account la ON la.account_code = st.account_code
           LEFT JOIN line_category lk ON lk.category_code = st.category_code
           LEFT JOIN journal_entry e ON e.entry_id = st.entry_id
          WHERE st.advance_id = $1
          ORDER BY st.settled_at",
    )
    .bind(advance_id)
    .fetch_all(pool)
    .await?;
    let settlements = rows
        .iter()
        .map(|row| {
            Ok(AdvanceSettlement {
                settlement_id: row.try_get("settlement_id")?,
                kind: row.try_get("kind")?,
                amount_minor: row.try_get("amount_minor")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                category_code: row.try_get("category_code")?,
                category_name: row.try_get("category_name")?,
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                evidence: row.try_get("evidence")?,
                note: row.try_get("note")?,
                settled_by: row.try_get("settled_by")?,
                settled_at: row.try_get("settled_at")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(AdvanceDocument {
        advance,
        settlements,
    })
}

pub async fn advance_create(
    pool: &PgPool,
    request: &CreateAdvanceRequest,
    actor: &str,
) -> Result<AdvanceDocument, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "an advance is a positive amount".into(),
        ));
    }
    match request.party_type.as_str() {
        "EMPLOYEE" | "SUPPLIER" | "OTHER" => {}
        other => {
            return Err(AppError::Validation(format!(
                "an advance goes to an EMPLOYEE, a SUPPLIER or OTHER; {other} is none of them"
            )))
        }
    }
    let advance_id = Uuid::new_v4();
    let number: String =
        sqlx::query_scalar("SELECT 'ADV-' || to_char(nextval('advance_number_seq'), 'FM000000')")
            .fetch_one(pool)
            .await?;
    sqlx::query(
        "INSERT INTO advance
           (advance_id, advance_number, site_id, party_type, employee_id, supplier_id,
            party_name, advance_qualifier, purpose, amount_minor, requested_by, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,''),$9,$10,$11,$12)",
    )
    .bind(advance_id)
    .bind(&number)
    .bind(&request.site_id)
    .bind(&request.party_type)
    .bind(request.employee_id.as_deref())
    .bind(request.supplier_id)
    .bind(request.party_name.as_deref())
    .bind(request.advance_qualifier.as_deref())
    .bind(request.purpose.trim())
    .bind(request.amount_minor)
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(pool)
    .await?;
    advance_detail(pool, advance_id).await
}

/// Somebody with authority says the money may go.
pub async fn advance_approve(
    pool: &PgPool,
    advance_id: Uuid,
    actor: &str,
) -> Result<AdvanceDocument, AppError> {
    let done = sqlx::query(
        "UPDATE advance SET status = 'APPROVED', approved_by = $2, approved_at = now()
          WHERE advance_id = $1 AND status = 'REQUESTED'",
    )
    .bind(advance_id)
    .bind(actor)
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "only an advance that has been asked for and not yet approved can be approved".into(),
        ));
    }
    advance_detail(pool, advance_id).await
}

/// The money leaves: `Dr Advance / Cr Cash or Bank`.
pub async fn advance_pay(
    pool: &PgPool,
    advance_id: Uuid,
    request: &PayAdvanceRequest,
    actor: &str,
) -> Result<AdvanceDocument, AppError> {
    let row = sqlx::query(
        "SELECT site_id, amount_minor, currency::text AS currency, advance_qualifier,
                advance_number, status
           FROM advance WHERE advance_id = $1 FOR UPDATE",
    )
    .bind(advance_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("advance {advance_id}")))?;
    let status: String = row.try_get("status")?;
    if status != "APPROVED" {
        return Err(AppError::Conflict(format!(
            "an advance is paid after it is approved; this one is {}",
            status.to_lowercase()
        )));
    }
    let site_id: String = row.try_get("site_id")?;
    let amount: i64 = row.try_get("amount_minor")?;
    let qualifier: String = row.try_get("advance_qualifier")?;
    let number: String = row.try_get("advance_number")?;
    let unit = super::sites::unit_of_site(pool, &site_id).await?;

    let mut tx = pool.begin().await?;
    let intent = PostingIntent {
        posting_date: request.posting_date,
        source_kind: SOURCE_KIND.into(),
        source_id: Some(advance_id.to_string()),
        rule_version: RULE_VERSION.into(),
        currency: row.try_get::<String, _>("currency")?.trim().to_string(),
        memo: Some(format!("{number} — uang muka dibayarkan")),
        lines: vec![
            PostingLine::debit(ADVANCE_MEANING, &unit, amount).with_qualifier(&qualifier),
            PostingLine::credit(&request.cash_key, &unit, amount)
                .with_qualifier(&request.cash_qualifier),
        ],
    };
    let posted = post(&mut tx, &intent, Some("PAID"), actor).await?;
    sqlx::query(
        "UPDATE advance SET status = 'PAID', paid_at = now(), paid_by = $2, paid_entry_id = $3
          WHERE advance_id = $1",
    )
    .bind(advance_id)
    .bind(actor)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    advance_detail(pool, advance_id).await
}

/// Receipts, or change. Either way the advance comes down.
pub async fn advance_settle(
    pool: &PgPool,
    advance_id: Uuid,
    request: &SettleAdvanceRequest,
    actor: &str,
) -> Result<AdvanceDocument, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a settlement is a positive amount".into(),
        ));
    }
    let document = advance_detail(pool, advance_id).await?;
    if !matches!(
        document.advance.status.as_str(),
        "PAID" | "PARTIALLY_SETTLED"
    ) {
        return Err(AppError::Conflict(format!(
            "an advance is settled after it is paid; this one is {}",
            document.advance.status.to_lowercase()
        )));
    }
    if request.amount_minor > document.advance.outstanding_minor {
        return Err(AppError::Validation(format!(
            "{} is still out; settling {} would take the advance below nothing and leave \
             the ledger holding a negative asset",
            document.advance.outstanding_minor, request.amount_minor
        )));
    }

    let unit = super::sites::unit_of_site(pool, &document.advance.site_id).await?;
    let qualifier = document.advance.advance_qualifier.clone();
    let number = document.advance.advance_number.clone();
    let currency = document.advance.currency.clone();

    let (debit_line, account_code, category_code, cash_key) = match request.kind.as_str() {
        "EXPENSE" => {
            let code = request.account_code.clone().ok_or_else(|| {
                AppError::Validation(
                    "say which account the spending landed in; an advance settled into \
                     nothing is an advance nobody accounted for"
                        .into(),
                )
            })?;
            // And what kind of spending, where the account is kept by kind.
            // Checked before the settlement is written rather than left to the
            // poster: the person with the receipts in their hand is the only
            // one who knows, and they are here now.
            let category = request
                .category_code
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            super::ledger::assert_category_for_account(
                pool,
                code.trim(),
                category,
                super::ledger::Intent::Post,
            )
            .await?;
            (
                PostingLine {
                    dimensions: Vec::new(),
                    account: LineAccount::Account {
                        account_code: code.clone(),
                        category_code: category.map(str::to_string),
                    },
                    unit_id: unit.clone(),
                    counter_unit_id: None,
                    debit_minor: request.amount_minor,
                    credit_minor: 0,
                    party_type: None,
                    party_id: None,
                    asset_id: None,
                    bank_account_id: None,
                    memo: None,
                },
                Some(code),
                request
                    .category_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                None,
            )
        }
        "REFUND" => {
            let key = request.cash_key.clone().ok_or_else(|| {
                AppError::Validation("say which drawer or bank the change went back into".into())
            })?;
            (
                PostingLine::debit(&key, &unit, request.amount_minor)
                    .with_qualifier(&request.cash_qualifier),
                None,
                None,
                Some(key),
            )
        }
        other => {
            return Err(AppError::Validation(format!(
                "a settlement is an EXPENSE or a REFUND; {other} is neither"
            )))
        }
    };

    let settlement_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let intent = PostingIntent {
        posting_date: request.posting_date,
        source_kind: SOURCE_KIND.into(),
        source_id: Some(advance_id.to_string()),
        rule_version: RULE_VERSION.into(),
        currency,
        memo: Some(format!("{number} — {}", request.kind.to_lowercase())),
        lines: vec![
            debit_line,
            PostingLine::credit(ADVANCE_MEANING, &unit, request.amount_minor)
                .with_qualifier(&qualifier),
        ],
    };
    // One purpose per settlement, so two settlements on one advance are two
    // entries rather than a collision on the journal's unique key.
    let purpose = format!("S{}", &settlement_id.to_string()[..8].to_uppercase());
    let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
    sqlx::query(
        "INSERT INTO advance_settlement
           (settlement_id, advance_id, kind, amount_minor, account_code, category_code,
            cash_key, cash_qualifier, entry_id, evidence, note, settled_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(settlement_id)
    .bind(advance_id)
    .bind(&request.kind)
    .bind(request.amount_minor)
    .bind(account_code.as_deref())
    .bind(category_code.as_deref())
    .bind(cash_key.as_deref())
    .bind(&request.cash_qualifier)
    .bind(posted.entry_id)
    .bind(request.evidence.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    // Fully settled, or partly. Computed from the rows rather than incremented.
    sqlx::query(
        "UPDATE advance a
            SET status = CASE
                WHEN (SELECT COALESCE(SUM(s.amount_minor),0) FROM advance_settlement s
                       WHERE s.advance_id = a.advance_id) >= a.amount_minor
                THEN 'SETTLED' ELSE 'PARTIALLY_SETTLED' END
          WHERE a.advance_id = $1",
    )
    .bind(advance_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    advance_detail(pool, advance_id).await
}

/// Stop an advance that never left. One that has been paid is settled or
/// refunded, not cancelled.
pub async fn advance_cancel(
    pool: &PgPool,
    advance_id: Uuid,
    reason: &str,
    actor: &str,
) -> Result<AdvanceDocument, AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::Validation("say why it is being cancelled".into()));
    }
    let done = sqlx::query(
        "UPDATE advance
            SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2,
                cancel_reason = $3
          WHERE advance_id = $1 AND status IN ('REQUESTED', 'APPROVED')",
    )
    .bind(advance_id)
    .bind(actor)
    .bind(reason.trim())
    .execute(pool)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "an advance that has been paid cannot be cancelled: settle it or take the \
             money back"
                .into(),
        ));
    }
    advance_detail(pool, advance_id).await
}

/// The control account, with the ageing a Finance reader asks for first.
///
/// Per unit, because the books are: an advance keeps the site it was asked for
/// at, and is counted in the unit that owns that site.
pub async fn advance_reconciliation(
    pool: &PgPool,
) -> Result<Vec<AdvanceReconciliationRow>, AppError> {
    let rows = sqlx::query(
        "WITH mapped AS (
             SELECT DISTINCT m.unit_id, m.account_code
               FROM account_resolution m WHERE m.role = 'advance'
         ), gl AS (
             SELECT l.unit_id, l.account_code,
                    SUM(l.debit_minor - l.credit_minor)::bigint AS gl_minor
               FROM journal_line l
               JOIN mapped ON mapped.unit_id = l.unit_id AND mapped.account_code = l.account_code
              GROUP BY l.unit_id, l.account_code
         ), sub AS (
             SELECT s.unit_id,
                    COALESCE(m.account_code, '?') AS account_code,
                    SUM(a.amount_minor - COALESCE(t.settled, 0))::bigint AS subledger_minor,
                    COUNT(*)::bigint AS open_advances,
                    SUM(CASE WHEN a.paid_at < now() - interval '30 days'
                             THEN a.amount_minor - COALESCE(t.settled, 0) ELSE 0 END)::bigint
                        AS over_thirty_days_minor
               FROM advance a
               JOIN site s ON s.id = a.site_id
               LEFT JOIN (
                    SELECT advance_id, SUM(amount_minor) AS settled
                      FROM advance_settlement GROUP BY advance_id
               ) t ON t.advance_id = a.advance_id
               LEFT JOIN account_resolution m
                 ON m.role = 'advance' AND m.unit_id = s.unit_id
                AND m.source_type = 'COMPANY' AND m.source_id = a.advance_qualifier
              WHERE a.status IN ('PAID', 'PARTIALLY_SETTLED')
              GROUP BY s.unit_id, COALESCE(m.account_code, '?')
         )
         SELECT COALESCE(gl.unit_id, sub.unit_id) AS unit_id,
                COALESCE(gl.account_code, sub.account_code) AS account_code,
                COALESCE(la.name, '—') AS account_name,
                COALESCE(gl.gl_minor, 0)::bigint AS gl_minor,
                COALESCE(sub.subledger_minor, 0)::bigint AS subledger_minor,
                COALESCE(sub.open_advances, 0)::bigint AS open_advances,
                COALESCE(sub.over_thirty_days_minor, 0)::bigint AS over_thirty_days_minor
           FROM gl
           FULL OUTER JOIN sub
             ON sub.unit_id = gl.unit_id AND sub.account_code = gl.account_code
           LEFT JOIN ledger_account la
             ON la.account_code = COALESCE(gl.account_code, sub.account_code)
          ORDER BY 1, 2",
    )
    .fetch_all(pool)
    .await?;

    rows.iter()
        .map(|row| {
            let gl: i64 = row.try_get("gl_minor")?;
            let sub: i64 = row.try_get("subledger_minor")?;
            Ok(AdvanceReconciliationRow {
                unit_id: row.try_get("unit_id")?,
                account_code: row.try_get("account_code")?,
                account_name: row.try_get("account_name")?,
                gl_minor: gl,
                subledger_minor: sub,
                difference_minor: gl - sub,
                open_advances: row.try_get("open_advances")?,
                over_thirty_days_minor: row.try_get("over_thirty_days_minor")?,
            })
        })
        .collect()
}
