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
    /// The shops that accept it (0474).
    pub site_ids: Vec<String>,
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
    /// Defaults by tender: cash IN_DRAWER, vouchers/points/benefit NONE,
    /// debit/credit/QRIS DIRECT_TO_BANK (owner, 1 Oct 2026), and an e-wallet
    /// VIA_RECEIVABLE until its provider pays.
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
                        < (SELECT COUNT(*) FROM unit)) AS unlinked_roles,
           ARRAY(SELECT ps.site_id FROM payment_method_site ps
                  WHERE ps.method_code = p.code ORDER BY ps.site_id) AS site_ids
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
        site_ids: row.try_get("site_ids")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
    })
}

pub async fn payment_methods(pool: &PgPool) -> Result<Vec<PaymentMethod>, AppError> {
    let rows = sqlx::query(&format!(
        "{ROWS} ORDER BY p.is_active DESC, p.tender_type, p.code"
    ))
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
        return Err(AppError::Validation(
            "a payment method has a code and a name".into(),
        ));
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
            "VOUCHER" | "POINTS" | "BENEFIT" => "NONE".into(),
            // Debit, credit and QRIS are taken on a shop's EDC, and the owner
            // wants that money on Cash in Bank the day it is taken (1 Oct
            // 2026; 0722). A method created without a mode is a method nobody
            // decided, and the wrong default here is what put new banks on
            // Piutang Debit Card / Piutang Kartu Kredit.
            "DEBIT_CARD" | "CREDIT_CARD" | "QRIS" => "DIRECT_TO_BANK".into(),
            // An e-wallet is owed by its provider until it pays, which is not
            // the same fact as a card taken on our own EDC.
            _ => "VIA_RECEIVABLE".into(),
        },
    };
    let bank = request.bank_code.trim().to_ascii_uppercase();
    let needs_bank = matches!(
        tender.as_str(),
        "DEBIT_CARD" | "CREDIT_CARD" | "QRIS" | "EWALLET"
    );
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

// ---------------------------------------------------------------------------
// Per shop (0474)
// ---------------------------------------------------------------------------

/// One method, and whether this shop takes it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SitePaymentMethod {
    pub code: String,
    pub name: String,
    pub tender_type: String,
    pub bank_code: String,
    pub is_active: bool,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetSitePaymentMethodsRequest {
    /// Every method this shop takes; anything not listed is switched off here.
    pub codes: Vec<String>,
}

/// A shop's payment-method setup: every method, and whether this shop takes it.
pub async fn site_payment_methods(
    pool: &PgPool,
    site_id: &str,
) -> Result<Vec<SitePaymentMethod>, AppError> {
    let rows = sqlx::query(
        "SELECT p.code, p.name, p.tender_type, p.bank_code, p.is_active,
                EXISTS (SELECT 1 FROM payment_method_site ps
                         WHERE ps.method_code = p.code AND ps.site_id = $1) AS enabled
           FROM payment_method p
          ORDER BY p.tender_type, p.code",
    )
    .bind(site_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(SitePaymentMethod {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                tender_type: row.try_get("tender_type")?,
                bank_code: row.try_get("bank_code")?,
                is_active: row.try_get("is_active")?,
                enabled: row.try_get("enabled")?,
            })
        })
        .collect()
}

/// Replace a shop's list. The shop's node hears within a minute.
pub async fn set_site_payment_methods(
    pool: &PgPool,
    site_id: &str,
    request: &SetSitePaymentMethodsRequest,
    actor: &str,
) -> Result<Vec<SitePaymentMethod>, AppError> {
    let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(site_id)
        .fetch_one(pool)
        .await?;
    if !known {
        return Err(AppError::NotFound(format!("site {site_id}")));
    }
    let codes: Vec<String> = request
        .codes
        .iter()
        .map(|code| code.trim().to_ascii_uppercase())
        .filter(|code| !code.is_empty())
        .collect();
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM payment_method_site WHERE site_id = $1")
        .bind(site_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO payment_method_site (method_code, site_id, set_by)
         SELECT code, $2, $3 FROM unnest($1::text[]) AS code",
    )
    .bind(&codes)
    .bind(site_id)
    .bind(actor)
    .execute(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => {
            AppError::Validation("one of those codes is not a payment method".into())
        }
        _ => error.into(),
    })?;
    tx.commit().await?;
    site_payment_methods(pool, site_id).await
}

/// Send each shop node its payment methods when they changed since it was
/// last sent them (0474). Called on the catalogue publisher's tick; a node
/// that was never sent a list gets one on the first tick after it enrols.
pub async fn publish_payment_methods_if_changed(
    pool: &PgPool,
    issued_by: &str,
) -> Result<i64, AppError> {
    let switched_on: bool = sqlx::query_scalar(
        "SELECT COALESCE((SELECT value_numeric <> 0 FROM finance_setting
                           WHERE setting_key = 'sync.publish_payment_methods'), false)",
    )
    .fetch_one(pool)
    .await?;
    if !switched_on {
        return Ok(0);
    }
    let origins = sqlx::query(
        "SELECT c.origin_id, c.site_id, p.content_hash
           FROM sync_origin_credential c
           LEFT JOIN payment_method_publication p ON p.origin_id = c.origin_id
          WHERE c.site_id IS NOT NULL
          ORDER BY c.origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut published = 0i64;
    for origin in &origins {
        let origin_id: String = origin.try_get("origin_id")?;
        let site_id: String = origin.try_get("site_id")?;
        let previous: Option<String> = origin.try_get("content_hash")?;
        let rows = sqlx::query(
            "SELECT p.code, p.name, p.tender_type, p.bank_code, p.settlement_mode
               FROM payment_method p
               JOIN payment_method_site ps ON ps.method_code = p.code AND ps.site_id = $1
              WHERE p.is_active
              ORDER BY p.tender_type, p.code",
        )
        .bind(&site_id)
        .fetch_all(pool)
        .await?;
        let methods = rows
            .iter()
            .map(|row| {
                Ok(crate::cloud::domain::TillPaymentMethod {
                    code: row.try_get("code")?,
                    name: row.try_get("name")?,
                    tender_type: row.try_get("tender_type")?,
                    bank_code: row.try_get("bank_code")?,
                    settlement_mode: row.try_get("settlement_mode")?,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        let book = crate::cloud::domain::PaymentMethodBook {
            site_id: site_id.clone(),
            methods,
        };
        let payload = serde_json::to_value(&book)?;
        let hash = crate::security::sha256_hex(&payload.to_string());
        if previous.as_deref() == Some(hash.as_str()) {
            continue;
        }
        let (command_id, _) = super::sync::issue_command(
            pool,
            crate::cloud::domain::COMMAND_PAYMENT_METHODS_REPLACE,
            &payload,
            issued_by,
            None,
            std::slice::from_ref(&origin_id),
        )
        .await?;
        sqlx::query(
            "INSERT INTO payment_method_publication (origin_id, content_hash, command_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (origin_id) DO UPDATE
                SET content_hash = EXCLUDED.content_hash, command_id = EXCLUDED.command_id,
                    published_at = now()",
        )
        .bind(&origin_id)
        .bind(&hash)
        .bind(command_id)
        .execute(pool)
        .await?;
        published += 1;
    }
    Ok(published)
}
