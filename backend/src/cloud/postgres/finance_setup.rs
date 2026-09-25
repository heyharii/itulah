//! Finance setup for the sales day (Finance Connect, stage 2).
//!
//! Four small registers Finance owns, and the one action that adds a bank:
//!
//! * `edc_terminal` — which bank each shop EDC terminal belongs to. A QRIS
//!   tender rides the EDC of a bank (owner decision 25 Sep) and posts to that
//!   bank's debit-card pair, so a terminal the register does not know sends
//!   its QRIS lines to the sale-day exception queue.
//! * `acquirer_fee_rate` — the MDR Finance expects per bank and kind; the
//!   settlement checks the bank's actual fee against it.
//! * `finance_setting` — tolerances and windows.
//! * "Tambah bank" — the client adds a bank on purpose: its leaves in the right
//!   groups, the account-map rows qualified by the bank, the register row, and
//!   its terminals, in one act. The only path that creates chart leaves; the
//!   posting rules themselves never do.

use super::company_banks::{describe_account, DescribeBankAccountRequest};
use crate::cloud::application::AppError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdcTerminal {
    pub site_id: String,
    pub terminal_id: String,
    pub bank_code: String,
    pub label: Option<String>,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpsertEdcTerminalRequest {
    pub site_id: String,
    pub terminal_id: String,
    pub bank_code: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub label: Option<String>,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquirerFeeRate {
    pub bank_code: String,
    pub fee_kind: String,
    /// Percent of gross, as text so no float ever carries money: "0.1500".
    pub rate_percent: String,
    pub effective_from: NaiveDate,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetAcquirerFeeRateRequest {
    pub bank_code: String,
    /// DEBIT_ON_US, DEBIT_OFF_US, CREDIT or QRIS.
    pub fee_kind: String,
    /// Percent of gross, e.g. "0.15". Final: the bank's MDR includes VAT.
    pub rate_percent: String,
    pub effective_from: NaiveDate,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FinanceSetting {
    pub setting_key: String,
    pub value: String,
    pub unit: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetFinanceSettingRequest {
    pub value: String,
}

/// One terminal to register with a new bank.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NewBankTerminal {
    pub site_id: String,
    pub terminal_id: String,
}

/// "Tambah bank": everything a new bank needs, in one request.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AddBankRequest {
    /// The institution's short code, e.g. `BSI`. Upper-cased.
    pub bank_code: String,
    /// Its name as the chart should print it, e.g. `BSI` or `Bank Syariah Indonesia`.
    pub bank_name: String,
    /// Create `Cash In Bank Giro Bank X` and `Outstanding Giro Bank X`.
    #[serde(default)]
    pub giro: bool,
    /// Create `Cash In Bank Tabungan Bank X`.
    #[serde(default)]
    pub savings: bool,
    /// Create `Penjualan Debit Card Bank X` and map the debit-card receivable,
    /// fee and dispute meanings for the bank. QRIS on this bank's EDC posts
    /// here too.
    #[serde(default)]
    pub debit_card: bool,
    /// Register our account at the bank, when its number is known.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_no: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_holder: Option<String>,
    /// Where the registered account sits; head office when absent.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_site_id: Option<String>,
    #[serde(default)]
    pub terminals: Vec<NewBankTerminal>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AddBankOutcome {
    pub bank_code: String,
    /// `code name` of every leaf created.
    pub accounts_created: Vec<String>,
    pub mappings_written: i64,
    pub bank_account_id: Option<Uuid>,
    pub terminals_registered: i64,
}

const FEE_KINDS: [&str; 4] = ["DEBIT_ON_US", "DEBIT_OFF_US", "CREDIT", "QRIS"];

fn bank_code_of(raw: &str) -> Result<String, AppError> {
    let code = raw.trim().to_ascii_uppercase();
    let valid = code.len() >= 2
        && code.len() <= 16
        && code.starts_with(|c: char| c.is_ascii_uppercase())
        && code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !valid {
        return Err(AppError::Validation(format!(
            "'{raw}' is not a bank code: 2-16 letters and digits starting with a letter, like BCA"
        )));
    }
    Ok(code)
}

pub async fn edc_terminals(pool: &PgPool) -> Result<Vec<EdcTerminal>, AppError> {
    let rows = sqlx::query(
        "SELECT site_id, terminal_id, bank_code, label, active
           FROM edc_terminal ORDER BY site_id, terminal_id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(EdcTerminal {
                site_id: row.try_get("site_id")?,
                terminal_id: row.try_get("terminal_id")?,
                bank_code: row.try_get("bank_code")?,
                label: row.try_get("label")?,
                active: row.try_get("active")?,
            })
        })
        .collect()
}

pub async fn upsert_edc_terminal(
    pool: &PgPool,
    request: &UpsertEdcTerminalRequest,
    actor: &str,
) -> Result<EdcTerminal, AppError> {
    let bank = bank_code_of(&request.bank_code)?;
    let terminal = request.terminal_id.trim().to_ascii_uppercase();
    if terminal.is_empty() {
        return Err(AppError::Validation("name the terminal id the POS sends".into()));
    }
    let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM bank WHERE upper(code) = $1 AND active)")
        .bind(&bank)
        .fetch_one(pool)
        .await?;
    if !known {
        return Err(AppError::Validation(format!(
            "{bank} is not a bank this company knows; add it first (Finance → Tambah bank)"
        )));
    }
    sqlx::query(
        "INSERT INTO edc_terminal (site_id, terminal_id, bank_code, label, active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (site_id, terminal_id) DO UPDATE
            SET bank_code = EXCLUDED.bank_code, label = EXCLUDED.label, active = EXCLUDED.active",
    )
    .bind(request.site_id.trim())
    .bind(&terminal)
    .bind(&bank)
    .bind(request.label.as_deref().map(str::trim).filter(|l| !l.is_empty()))
    .bind(request.active)
    .bind(actor)
    .execute(pool)
    .await?;
    Ok(EdcTerminal {
        site_id: request.site_id.trim().to_string(),
        terminal_id: terminal,
        bank_code: bank,
        label: request.label.clone(),
        active: request.active,
    })
}

pub async fn acquirer_fee_rates(pool: &PgPool) -> Result<Vec<AcquirerFeeRate>, AppError> {
    let rows = sqlx::query(
        "SELECT bank_code, fee_kind, rate_percent::text AS rate_percent, effective_from, note
           FROM acquirer_fee_rate ORDER BY bank_code, fee_kind, effective_from DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(AcquirerFeeRate {
                bank_code: row.try_get("bank_code")?,
                fee_kind: row.try_get("fee_kind")?,
                rate_percent: row.try_get("rate_percent")?,
                effective_from: row.try_get("effective_from")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

pub async fn set_acquirer_fee_rate(
    pool: &PgPool,
    request: &SetAcquirerFeeRateRequest,
    actor: &str,
) -> Result<AcquirerFeeRate, AppError> {
    let bank = bank_code_of(&request.bank_code)?;
    let kind = request.fee_kind.trim().to_ascii_uppercase();
    if !FEE_KINDS.contains(&kind.as_str()) {
        return Err(AppError::Validation(format!(
            "'{kind}' is not a fee kind; expected one of {}",
            FEE_KINDS.join(", ")
        )));
    }
    let rate = request.rate_percent.trim().replace(',', ".");
    let row = sqlx::query(
        "INSERT INTO acquirer_fee_rate (bank_code, fee_kind, rate_percent, effective_from, note, set_by)
         VALUES ($1, $2, $3::numeric, $4, $5, $6)
         ON CONFLICT (bank_code, fee_kind, effective_from) DO UPDATE
            SET rate_percent = EXCLUDED.rate_percent, note = EXCLUDED.note,
                set_by = EXCLUDED.set_by, set_at = now()
         RETURNING rate_percent::text AS rate_percent",
    )
    .bind(&bank)
    .bind(&kind)
    .bind(&rate)
    .bind(request.effective_from)
    .bind(request.note.as_deref())
    .bind(actor)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::Validation(format!("'{rate}' is not a rate in percent: {error}")))?;
    Ok(AcquirerFeeRate {
        bank_code: bank,
        fee_kind: kind,
        rate_percent: row.try_get("rate_percent")?,
        effective_from: request.effective_from,
        note: request.note.clone(),
    })
}

pub async fn finance_settings(pool: &PgPool) -> Result<Vec<FinanceSetting>, AppError> {
    let rows = sqlx::query(
        "SELECT setting_key, value_numeric::text AS value, unit, note
           FROM finance_setting ORDER BY setting_key",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(FinanceSetting {
                setting_key: row.try_get("setting_key")?,
                value: row.try_get("value")?,
                unit: row.try_get("unit")?,
                note: row.try_get("note")?,
            })
        })
        .collect()
}

pub async fn set_finance_setting(
    pool: &PgPool,
    key: &str,
    request: &SetFinanceSettingRequest,
    actor: &str,
) -> Result<FinanceSetting, AppError> {
    let value = request.value.trim().replace(',', ".");
    let row = sqlx::query(
        "UPDATE finance_setting SET value_numeric = $2::numeric, set_by = $3, set_at = now()
          WHERE setting_key = $1
      RETURNING setting_key, value_numeric::text AS value, unit, note",
    )
    .bind(key)
    .bind(&value)
    .bind(actor)
    .fetch_optional(pool)
    .await
    .map_err(|error| AppError::Validation(format!("'{value}' is not a number: {error}")))?
    .ok_or_else(|| AppError::NotFound(format!("finance setting {key}")))?;
    Ok(FinanceSetting {
        setting_key: row.try_get("setting_key")?,
        value: row.try_get("value")?,
        unit: row.try_get("unit")?,
        note: row.try_get("note")?,
    })
}

/// Create one leaf under `parent`, numbered after the last four-digit code of
/// its class, unless a leaf of exactly that name already sits there.
async fn ensure_leaf(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    parent: &str,
    name: &str,
    normal_balance: &str,
    section: &str,
    created: &mut Vec<String>,
) -> Result<String, AppError> {
    if let Some(code) = sqlx::query_scalar::<_, String>(
        "SELECT account_code FROM ledger_account
          WHERE parent_code = $1 AND lower(name) = lower($2) AND is_active AND NOT is_group",
    )
    .bind(parent)
    .bind(name)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(code);
    }
    let class = &parent[..1];
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(account_code::bigint), 0) + 1 FROM ledger_account
          WHERE account_code ~ '^[0-9]{4}$' AND left(account_code, 1) = $1",
    )
    .bind(class)
    .fetch_one(&mut **tx)
    .await?;
    let code = next.to_string();
    if code.len() != 4 || !code.starts_with(class) {
        return Err(AppError::Conflict(format!(
            "class {class} has no four-digit code left for {name}"
        )));
    }
    sqlx::query(
        "INSERT INTO ledger_account
            (account_code, name, name_en, parent_code, is_group, is_active, dimension,
             normal_balance, is_contra, category_family, requires_counter_site,
             posting_mode, manual_je_policy, posting_policy_configured, code_provenance,
             statement_section)
         VALUES ($1, $2, NULL, $3, FALSE, TRUE, 'unit', $4, FALSE, NULL, FALSE,
                 'MANUAL', 'YES', TRUE, 'PENDING_CLIENT_CODE', $5)",
    )
    .bind(&code)
    .bind(name)
    .bind(parent)
    .bind(normal_balance)
    .bind(section)
    .execute(&mut **tx)
    .await?;
    created.push(format!("{code} {name}"));
    Ok(code)
}

/// Point `semantic_key` qualified by the bank at `account` at every site.
async fn map_everywhere(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    semantic_key: &str,
    bank: &str,
    account: &str,
    actor: &str,
) -> Result<i64, AppError> {
    let written = sqlx::query(
        "INSERT INTO account_map
            (semantic_key, site_id, qualifier, account_code, category_code, set_by, note)
         SELECT $1, site.id, $2, $3, NULL, $4, 'Tambah bank'
           FROM site
         ON CONFLICT (semantic_key, site_id, qualifier) DO UPDATE
            SET account_code = EXCLUDED.account_code, category_code = NULL,
                set_by = EXCLUDED.set_by, set_at = now(), note = EXCLUDED.note",
    )
    .bind(semantic_key)
    .bind(bank)
    .bind(account)
    .bind(actor)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    Ok(i64::try_from(written).unwrap_or(0))
}

/// "Tambah bank" (owner decision 7): one act makes the bank postable.
pub async fn add_bank(
    pool: &PgPool,
    request: &AddBankRequest,
    actor: &str,
) -> Result<AddBankOutcome, AppError> {
    let bank = bank_code_of(&request.bank_code)?;
    let name = request.bank_name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("name the bank as the chart should print it".into()));
    }
    if !(request.giro || request.savings || request.debit_card) {
        return Err(AppError::Validation(
            "choose what the bank is for: a giro account, a savings account, or its debit cards"
                .into(),
        ));
    }
    let display = if name.to_ascii_uppercase().starts_with("BANK ") {
        name.to_string()
    } else {
        format!("Bank {name}")
    };

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO bank (bank_id, code, name, normalized_name, country_code, active)
         SELECT $1, $2, $3, $2, 'ID', true
          WHERE NOT EXISTS (SELECT 1 FROM bank WHERE code = $2 OR normalized_name = $2)",
    )
    .bind(Uuid::new_v4())
    .bind(&bank)
    .bind(&display)
    .execute(&mut *tx)
    .await?;

    let mut created = Vec::new();
    let mut mapped = 0i64;
    if request.giro {
        let cash = ensure_leaf(&mut tx, "1001", &format!("Cash In Bank Giro {display}"), "D", "ASSET", &mut created).await?;
        mapped += map_everywhere(&mut tx, "bank_giro", &bank, &cash, actor).await?;
        let outstanding = ensure_leaf(&mut tx, "2001", &format!("Outstanding Giro {display}"), "C", "LIABILITY", &mut created).await?;
        mapped += map_everywhere(&mut tx, "giro_outstanding", &bank, &outstanding, actor).await?;
    }
    if request.savings {
        let cash = ensure_leaf(&mut tx, "1001", &format!("Cash In Bank Tabungan {display}"), "D", "ASSET", &mut created).await?;
        mapped += map_everywhere(&mut tx, "bank_savings", &bank, &cash, actor).await?;
    }
    if request.debit_card {
        let sales = ensure_leaf(&mut tx, "4001", &format!("Penjualan Debit Card {display}"), "C", "REVENUE", &mut created).await?;
        mapped += map_everywhere(&mut tx, "revenue_debit", &bank, &sales, actor).await?;
        mapped += map_everywhere(&mut tx, "card_receivable_debit", &bank, "1021", actor).await?;
        mapped += map_everywhere(&mut tx, "card_fee", &bank, "6005", actor).await?;
        mapped += map_everywhere(&mut tx, "sales_return", &bank, "4013", actor).await?;
    }
    let mut terminals = 0i64;
    for terminal in &request.terminals {
        let id = terminal.terminal_id.trim().to_ascii_uppercase();
        if id.is_empty() {
            continue;
        }
        sqlx::query(
            "INSERT INTO edc_terminal (site_id, terminal_id, bank_code, active, created_by)
             VALUES ($1, $2, $3, true, $4)
             ON CONFLICT (site_id, terminal_id) DO UPDATE SET bank_code = EXCLUDED.bank_code, active = true",
        )
        .bind(terminal.site_id.trim())
        .bind(&id)
        .bind(&bank)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        terminals += 1;
    }
    tx.commit().await?;

    // The register row goes through the one door that describes our accounts,
    // so its checks (a postable leaf, a real number, one primary) are the same.
    let mut bank_account_id = None;
    if let Some(account_no) = request.account_no.as_deref().filter(|n| !n.trim().is_empty()) {
        let (kind, semantic) = if request.giro { ("GIRO", "bank_giro") } else { ("SAVINGS", "bank_savings") };
        if !(request.giro || request.savings) {
            return Err(AppError::Validation(
                "an account number needs a giro or savings account to register it against".into(),
            ));
        }
        let site = request.account_site_id.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("dc");
        let ledger: String = sqlx::query_scalar(
            "SELECT account_code FROM account_map WHERE semantic_key = $1 AND site_id = $2 AND qualifier = $3",
        )
        .bind(semantic)
        .bind(site)
        .bind(&bank)
        .fetch_one(pool)
        .await?;
        let registered = describe_account(
            pool,
            &DescribeBankAccountRequest {
                ledger_account_code: ledger,
                site_id: site.to_string(),
                bank_code: Some(bank.clone()),
                bank_name: String::new(),
                account_no: account_no.to_string(),
                account_holder: request.account_holder.clone().unwrap_or_default(),
                branch: None,
                kind: kind.to_string(),
                is_primary: None,
                note: Some("Tambah bank".into()),
            },
            actor,
        )
        .await?;
        bank_account_id = Some(registered.account_id);
    }

    Ok(AddBankOutcome {
        bank_code: bank,
        accounts_created: created,
        mappings_written: mapped,
        bank_account_id,
        terminals_registered: terminals,
    })
}
