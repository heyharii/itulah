//! Owners and investors, and the four ways their money moves.
//!
//!   CONTRIBUTION  Dr Cash / Bank          Cr Modal Setor
//!   DRAWING       Dr Prive                Cr Cash / Bank
//!   LOAN_IN       Dr Cash / Bank          Cr Pinjaman Principal
//!   LOAN_REPAY    Dr Pinjaman Principal   Cr Cash / Bank
//!
//! A principal is not a supplier. What they move is capital, drawings or a
//! loan; none of it belongs in AP ageing, and none of it is bought.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::poster::{post, PostingIntent, PostingLine};

// `EQUITY_MOVEMENT` and not `MANUAL`: capital arriving is a document, and the
// posting kernel refuses a hand-keyed entry on a bank account by design (0261).
// 0284 adds the kind, for the reason 0266 gave when it added `PAYROLL_RUN`.
use crate::cloud::application::AppError;

const SOURCE_KIND: &str = "EQUITY_MOVEMENT";
const RULE_VERSION: &str = "principal/1";
const CAPITAL_MEANING: &str = "capital_contributed";
const DRAWING_MEANING: &str = "owner_drawings";
const LOAN_MEANING: &str = "loan_principal";
/// Which lender the loan meaning is narrowed by when the lender is an owner.
const PRINCIPAL_QUALIFIER: &str = "PRINCIPAL";

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Principal {
    pub principal_id: Uuid,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub active: bool,
    pub note: Option<String>,
    /// What this owner has put in, taken out and lent, each kept apart.
    pub contributed_minor: i64,
    pub drawn_minor: i64,
    pub lent_minor: i64,
    pub repaid_minor: i64,
    /// Equity they hold, and the loan still owed to them. Two balances, never
    /// one: an owner who has lent the company money is a creditor for that
    /// money whatever their equity says.
    pub equity_minor: i64,
    pub loan_outstanding_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrincipalTransaction {
    pub transaction_id: Uuid,
    pub principal_id: Uuid,
    pub principal_name: String,
    pub site_id: String,
    pub kind: String,
    pub amount_minor: i64,
    pub posting_date: NaiveDate,
    pub entry_id: Uuid,
    pub entry_number: Option<String>,
    pub evidence: Option<String>,
    pub note: Option<String>,
    pub recorded_by: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrincipalDocument {
    pub principal: Principal,
    pub transactions: Vec<PrincipalTransaction>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreatePrincipalRequest {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PrincipalMovementRequest {
    pub principal_id: Uuid,
    pub site_id: String,
    /// `CONTRIBUTION`, `DRAWING`, `LOAN_IN` or `LOAN_REPAY`.
    pub kind: String,
    pub amount_minor: i64,
    pub posting_date: NaiveDate,
    /// Which drawer or bank the money moved through.
    pub cash_key: String,
    #[serde(default)]
    pub cash_qualifier: String,
    #[serde(default)]
    pub evidence: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

const PRINCIPAL_COLUMNS: &str = "p.principal_id, p.code, p.name, p.kind, p.active, p.note,
     COALESCE(t.contributed, 0)::bigint AS contributed_minor,
     COALESCE(t.drawn, 0)::bigint       AS drawn_minor,
     COALESCE(t.lent, 0)::bigint        AS lent_minor,
     COALESCE(t.repaid, 0)::bigint      AS repaid_minor";

const PRINCIPAL_FROM: &str = "FROM principal p
       LEFT JOIN (
            SELECT principal_id,
                   SUM(amount_minor) FILTER (WHERE kind = 'CONTRIBUTION') AS contributed,
                   SUM(amount_minor) FILTER (WHERE kind = 'DRAWING')      AS drawn,
                   SUM(amount_minor) FILTER (WHERE kind = 'LOAN_IN')      AS lent,
                   SUM(amount_minor) FILTER (WHERE kind = 'LOAN_REPAY')   AS repaid
              FROM principal_transaction GROUP BY principal_id
       ) t ON t.principal_id = p.principal_id";

fn to_principal(row: &sqlx::postgres::PgRow) -> Result<Principal, AppError> {
    let contributed: i64 = row.try_get("contributed_minor")?;
    let drawn: i64 = row.try_get("drawn_minor")?;
    let lent: i64 = row.try_get("lent_minor")?;
    let repaid: i64 = row.try_get("repaid_minor")?;
    Ok(Principal {
        principal_id: row.try_get("principal_id")?,
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        kind: row.try_get("kind")?,
        active: row.try_get("active")?,
        note: row.try_get("note")?,
        contributed_minor: contributed,
        drawn_minor: drawn,
        lent_minor: lent,
        repaid_minor: repaid,
        equity_minor: contributed - drawn,
        loan_outstanding_minor: lent - repaid,
    })
}

pub async fn principals(pool: &PgPool) -> Result<Vec<Principal>, AppError> {
    let sql = format!("SELECT {PRINCIPAL_COLUMNS} {PRINCIPAL_FROM} ORDER BY p.code");
    let rows = sqlx::query(&sql).fetch_all(pool).await?;
    rows.iter().map(to_principal).collect()
}

pub async fn principal_detail(
    pool: &PgPool,
    principal_id: Uuid,
) -> Result<PrincipalDocument, AppError> {
    let sql = format!("SELECT {PRINCIPAL_COLUMNS} {PRINCIPAL_FROM} WHERE p.principal_id = $1");
    let row = sqlx::query(&sql)
        .bind(principal_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("principal {principal_id}")))?;
    let principal = to_principal(&row)?;

    let rows = sqlx::query(
        "SELECT t.transaction_id, t.principal_id, p.name AS principal_name, t.site_id, t.kind,
                t.amount_minor, t.posting_date, t.entry_id, e.entry_number, t.evidence,
                t.note, t.recorded_by
           FROM principal_transaction t
           JOIN principal p ON p.principal_id = t.principal_id
           LEFT JOIN journal_entry e ON e.entry_id = t.entry_id
          WHERE t.principal_id = $1
          ORDER BY t.posting_date DESC, t.recorded_at DESC",
    )
    .bind(principal_id)
    .fetch_all(pool)
    .await?;
    let transactions = rows
        .iter()
        .map(|row| {
            Ok(PrincipalTransaction {
                transaction_id: row.try_get("transaction_id")?,
                principal_id: row.try_get("principal_id")?,
                principal_name: row.try_get("principal_name")?,
                site_id: row.try_get("site_id")?,
                kind: row.try_get("kind")?,
                amount_minor: row.try_get("amount_minor")?,
                posting_date: row.try_get("posting_date")?,
                entry_id: row.try_get("entry_id")?,
                entry_number: row.try_get("entry_number")?,
                evidence: row.try_get("evidence")?,
                note: row.try_get("note")?,
                recorded_by: row.try_get("recorded_by")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(PrincipalDocument {
        principal,
        transactions,
    })
}

pub async fn principal_create(
    pool: &PgPool,
    request: &CreatePrincipalRequest,
    actor: &str,
) -> Result<PrincipalDocument, AppError> {
    let principal_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO principal (principal_id, code, name, kind, note, created_by)
         VALUES ($1,$2,$3,COALESCE($4,'OWNER'),$5,$6)",
    )
    .bind(principal_id)
    .bind(request.code.trim().to_uppercase())
    .bind(request.name.trim())
    .bind(request.kind.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(pool)
    .await?;
    principal_detail(pool, principal_id).await
}

/// Record one movement, and post it.
pub async fn principal_movement(
    pool: &PgPool,
    request: &PrincipalMovementRequest,
    actor: &str,
) -> Result<PrincipalDocument, AppError> {
    if request.amount_minor <= 0 {
        return Err(AppError::Validation(
            "a movement is a positive amount; the direction is the kind".into(),
        ));
    }
    let name: Option<String> =
        sqlx::query_scalar("SELECT name FROM principal WHERE principal_id = $1")
            .bind(request.principal_id)
            .fetch_optional(pool)
            .await?;
    let name =
        name.ok_or_else(|| AppError::NotFound(format!("principal {}", request.principal_id)))?;

    let amount = request.amount_minor;
    let site = request.site_id.as_str();
    let cash = PostingLine::credit(&request.cash_key, site, amount)
        .with_qualifier(&request.cash_qualifier);
    let cash_in =
        PostingLine::debit(&request.cash_key, site, amount).with_qualifier(&request.cash_qualifier);

    let lines = match request.kind.as_str() {
        // Capital arriving: the company holds more money and owes its owners
        // more of itself.
        "CONTRIBUTION" => vec![cash_in, PostingLine::credit(CAPITAL_MEANING, site, amount)],
        // Money taken out against equity. `Prive` and not an expense: a drawing
        // is not a cost of trading.
        "DRAWING" => vec![PostingLine::debit(DRAWING_MEANING, site, amount), cash],
        // A loan FROM an owner. The company owes it back, so it is a liability
        // and not equity — which is why it is a different meaning entirely.
        "LOAN_IN" => vec![
            cash_in,
            PostingLine::credit(LOAN_MEANING, site, amount).with_qualifier(PRINCIPAL_QUALIFIER),
        ],
        "LOAN_REPAY" => vec![
            PostingLine::debit(LOAN_MEANING, site, amount).with_qualifier(PRINCIPAL_QUALIFIER),
            cash,
        ],
        other => {
            return Err(AppError::Validation(format!(
                "a principal movement is CONTRIBUTION, DRAWING, LOAN_IN or LOAN_REPAY; \
                 {other} is none of them"
            )))
        }
    };

    let transaction_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let intent = PostingIntent {
        posting_date: request.posting_date,
        source_kind: SOURCE_KIND.into(),
        source_id: Some(transaction_id.to_string()),
        rule_version: RULE_VERSION.into(),
        currency: "IDR".into(),
        memo: Some(format!("{name} — {}", request.kind.to_lowercase())),
        lines,
    };
    let posted = post(&mut tx, &intent, Some("MAIN"), actor).await?;
    sqlx::query(
        "INSERT INTO principal_transaction
           (transaction_id, principal_id, site_id, kind, amount_minor, posting_date,
            entry_id, evidence, note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(transaction_id)
    .bind(request.principal_id)
    .bind(site)
    .bind(&request.kind)
    .bind(amount)
    .bind(request.posting_date)
    .bind(posted.entry_id)
    .bind(request.evidence.as_deref())
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    principal_detail(pool, request.principal_id).await
}
