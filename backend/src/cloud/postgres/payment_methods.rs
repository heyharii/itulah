//! Payment methods — ERPNext's Mode of Payment (0468).
//!
//! Which tenders the company accepts, through which bank or scheme, how each
//! settles and at what MDR. The tender type is the grammar the day posting
//! knows; the accounts are account links narrowed by the method's bank, set on
//! the Account Links screen. A new e-wallet or a new bank's EDC is a row here
//! and its links, not a release.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

use crate::cloud::application::AppError;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "contract/", rename = "PaymentMethodSetting")
)]
pub struct PaymentMethod {
    pub code: String,
    pub name: String,
    /// `CASH`, `DEBIT_CARD`, `CREDIT_CARD`, `QRIS`, `EWALLET`, `VOUCHER` or
    /// `POINTS`.
    pub tender_type: String,
    /// The bank, scheme or wallet provider the links are narrowed by. Empty
    /// for cash, vouchers and points.
    pub bank_code: String,
    /// `IN_DRAWER`, `VIA_RECEIVABLE`, `DIRECT_TO_BANK` or `NONE`.
    pub settlement_mode: String,
    pub mdr_bps: i32,
    pub point_value_minor: Option<i64>,
    pub is_active: bool,
    pub note: Option<String>,
    /// The roles this method's day lines use, and which of them do not resolve
    /// in every unit's books. A method whose roles do not all resolve cannot
    /// post a day.
    pub roles: Vec<String>,
    pub unlinked_roles: Vec<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavePaymentMethodRequest {
    pub code: String,
    pub name: String,
    pub tender_type: String,
    #[serde(default)]
    pub bank_code: String,
    /// Defaults by tender: cash IN_DRAWER, vouchers and points NONE, the rest
    /// VIA_RECEIVABLE.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub settlement_mode: Option<String>,
    #[serde(default)]
    pub mdr_bps: i32,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub point_value_minor: Option<i64>,
    #[serde(default = "active")]
    pub is_active: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

fn active() -> bool {
    true
}

const ROWS: &str = "
    SELECT p.code, p.name, p.tender_type, p.bank_code, p.settlement_mode, p.mdr_bps,
           p.point_value_minor, p.is_active, p.note, p.created_by, p.created_at,
           ARRAY(SELECT r FROM payment_method_roles(p.tender_type, p.settlement_mode) r) AS roles,
           ARRAY(SELECT r FROM payment_method_roles(p.tender_type, p.settlement_mode) r
                  WHERE (SELECT COUNT(DISTINCT x.unit_id) FROM account_resolution x
                          WHERE x.role = r AND x.source_type = 'COMPANY'
                            AND x.source_id = p.bank_code)
                        < (SELECT COUNT(*) FROM unit)) AS unlinked_roles
      FROM payment_method p";

fn to_method(row: &sqlx::postgres::PgRow) -> Result<PaymentMethod, AppError> {
    Ok(PaymentMethod {
        code: row.try_get("code")?,
        name: row.try_get("name")?,
        tender_type: row.try_get("tender_type")?,
        bank_code: row.try_get("bank_code")?,
        settlement_mode: row.try_get("settlement_mode")?,
        mdr_bps: row.try_get("mdr_bps")?,
        point_value_minor: row.try_get("point_value_minor")?,
        is_active: row.try_get("is_active")?,
        note: row.try_get("note")?,
        roles: row.try_get("roles")?,
        unlinked_roles: row.try_get("unlinked_roles")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

pub async fn payment_methods(pool: &PgPool) -> Result<Vec<PaymentMethod>, AppError> {
    let rows = sqlx::query(&format!("{ROWS} ORDER BY p.is_active DESC, p.tender_type, p.code"))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_method).collect()
}

/// Add a payment method or change one. The database refuses the combinations
/// that make no sense (cash that is owed by an acquirer, points without a
/// value) — the sentence below names them before it does.
pub async fn save_payment_method(
    pool: &PgPool,
    request: &SavePaymentMethodRequest,
    actor: &str,
) -> Result<PaymentMethod, AppError> {
    let code = request.code.trim().to_ascii_uppercase();
    let tender = request.tender_type.trim().to_ascii_uppercase();
    if code.is_empty() || request.name.trim().is_empty() {
        return Err(AppError::Validation("a payment method has a code and a name".into()));
    }
    let mode = match request
        .settlement_mode
        .as_deref()
        .map(|m| m.trim().to_ascii_uppercase())
        .filter(|m| !m.is_empty())
    {
        Some(mode) => mode,
        None => match tender.as_str() {
            "CASH" => "IN_DRAWER".into(),
            "VOUCHER" | "POINTS" => "NONE".into(),
            _ => "VIA_RECEIVABLE".into(),
        },
    };
    let bank = request.bank_code.trim().to_ascii_uppercase();
    let needs_bank = matches!(tender.as_str(), "DEBIT_CARD" | "CREDIT_CARD" | "QRIS" | "EWALLET");
    if needs_bank && bank.is_empty() {
        return Err(AppError::Validation(format!(
            "a {} method names the bank, scheme or provider that pays it",
            tender.to_lowercase().replace('_', " ")
        )));
    }
    sqlx::query(
        "INSERT INTO payment_method
            (code, name, tender_type, bank_code, settlement_mode, mdr_bps, point_value_minor,
             is_active, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name, tender_type = EXCLUDED.tender_type,
                bank_code = EXCLUDED.bank_code, settlement_mode = EXCLUDED.settlement_mode,
                mdr_bps = EXCLUDED.mdr_bps, point_value_minor = EXCLUDED.point_value_minor,
                is_active = EXCLUDED.is_active, note = EXCLUDED.note",
    )
    .bind(&code)
    .bind(request.name.trim())
    .bind(&tender)
    .bind(&bank)
    .bind(&mode)
    .bind(request.mdr_bps)
    .bind(request.point_value_minor)
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
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23514") => AppError::Validation(
            "that combination does not settle: cash is IN_DRAWER, vouchers and points are NONE \
             (points also need a value per point), and cards, QRIS and e-wallets are \
             VIA_RECEIVABLE or DIRECT_TO_BANK"
                .into(),
        ),
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => AppError::Conflict(
            format!("another method already takes {tender} through {bank}"),
        ),
        _ => error.into(),
    })?;
    let row = sqlx::query(&format!("{ROWS} WHERE p.code = $1"))
        .bind(&code)
        .fetch_one(pool)
        .await?;
    to_method(&row)
}
