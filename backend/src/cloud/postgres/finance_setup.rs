//! Finance setup for the sales day (Finance Connect, stage 2).
//!
//! Four small registers Finance owns, and the one action that adds a bank:
//!
//! * `edc_terminal` — which bank each shop EDC terminal belongs to. A QRIS
//!   tender rides the EDC of a bank (owner decision 25 Sep) and posts to that
//!   bank's debit-card pair, so a terminal the register does not know sends
//!   its QRIS lines to the sale-day exception queue.
//!   Since 0989 the terminals of one bank at a shop are that shop's EDC
//!   machine: what it takes (debit, credit, QRIS), the account each kind
//!   lands in, and — read off it — the shop's card and QRIS methods.
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
    /// Whose books the registered account is kept in; head office's when
    /// absent.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub account_unit_id: Option<String>,
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
        && code
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
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
        return Err(AppError::Validation(
            "name the terminal id the POS sends".into(),
        ));
    }
    let known: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM bank WHERE upper(code) = $1 AND active)")
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
    .bind(
        request
            .label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty()),
    )
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

/// Link `role` for the bank to `account`, for every unit.
async fn map_everywhere(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    semantic_key: &str,
    bank: &str,
    account: &str,
    actor: &str,
) -> Result<i64, AppError> {
    let written = sqlx::query(
        "INSERT INTO account_link
            (role, source_type, source_id, scope_type, account_code, category_code, set_by, note)
         VALUES ($1, 'COMPANY', $2, 'ALL', $3, NULL, $4, 'Tambah bank')
         ON CONFLICT (role, source_type, source_id, scope_type, scope_key) DO UPDATE
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

/// The heading the accounts linked to `role` sit under — where a new bank's
/// account of the same kind belongs.
async fn heading_of(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT a.parent_code FROM account_link l
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE l.role = $1 AND a.parent_code IS NOT NULL
          GROUP BY a.parent_code ORDER BY count(*) DESC, a.parent_code LIMIT 1",
    )
    .bind(role)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::Validation(format!(
            "no bank is set up for {role} yet, so there is no heading to put a new one under; \
             add the first one on the chart of accounts and link it"
        ))
    })
}

/// The account most of `role`'s links point at — what a new bank shares with
/// the others (the card receivable, the MDR expense, the returns account).
async fn usual_account(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    role: &str,
) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT account_code FROM account_link WHERE role = $1
          GROUP BY account_code ORDER BY count(*) DESC, account_code LIMIT 1",
    )
    .bind(role)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::Validation(format!(
            "{role} is linked to no account yet; link it on the Account Links screen first"
        ))
    })
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
        return Err(AppError::Validation(
            "name the bank as the chart should print it".into(),
        ));
    }
    if !(request.giro || request.savings || request.debit_card) {
        return Err(AppError::Validation(
            "choose what the bank is for: a giro account, a savings account, or its debit cards"
                .into(),
        ));
    }
    // A card or QRIS taken on this bank's EDC settles into its Cash In Bank
    // Giro the day it is taken. Without that leaf there is no account for the
    // money to land in, and the old code quietly fell back to Piutang Debit
    // Card instead. Say so here rather than at the first sale.
    if request.debit_card && !request.giro {
        return Err(AppError::Validation(
            "a bank that takes debit cards and QRIS needs a giro account: that is where the \
             takings land, and without it the day has no bank to post to"
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

    // Where each new account sits and which shared accounts a new bank uses
    // are read from how the other banks are set up, never written here: the
    // heading the role's accounts already sit under, and the account most of
    // the role's links already point at.
    let mut created = Vec::new();
    let mut mapped = 0i64;
    if request.giro {
        let heading = heading_of(&mut tx, "bank_giro").await?;
        let cash = ensure_leaf(
            &mut tx,
            &heading,
            &format!("Cash In Bank Giro {display}"),
            "D",
            "ASSET",
            &mut created,
        )
        .await?;
        mapped += map_everywhere(&mut tx, "bank_giro", &bank, &cash, actor).await?;
        let heading = heading_of(&mut tx, "giro_outstanding").await?;
        let outstanding = ensure_leaf(
            &mut tx,
            &heading,
            &format!("Outstanding Giro {display}"),
            "C",
            "LIABILITY",
            &mut created,
        )
        .await?;
        mapped += map_everywhere(&mut tx, "giro_outstanding", &bank, &outstanding, actor).await?;
    }
    if request.savings {
        let heading = heading_of(&mut tx, "bank_savings").await?;
        let cash = ensure_leaf(
            &mut tx,
            &heading,
            &format!("Cash In Bank Tabungan {display}"),
            "D",
            "ASSET",
            &mut created,
        )
        .await?;
        mapped += map_everywhere(&mut tx, "bank_savings", &bank, &cash, actor).await?;
    }
    if request.debit_card {
        let heading = heading_of(&mut tx, "revenue_debit").await?;
        let sales = ensure_leaf(
            &mut tx,
            &heading,
            &format!("Penjualan Debit Card {display}"),
            "C",
            "REVENUE",
            &mut created,
        )
        .await?;
        mapped += map_everywhere(&mut tx, "revenue_debit", &bank, &sales, actor).await?;
        for role in ["card_receivable_debit", "card_fee", "sales_return"] {
            let usual = usual_account(&mut tx, role).await?;
            mapped += map_everywhere(&mut tx, role, &bank, &usual, actor).await?;
        }
        // The bank's debit cards and its QRIS become payment methods the
        // tills accept (0468), and they settle straight into the bank the day
        // they are taken (owner, 1 Oct 2026; 0722). A new bank must not start
        // life on Piutang Debit Card: that would need a settlement file to
        // clear an EDC that already pays into the account.
        for (prefix, label, tender) in [("DEBIT", "Debit", "DEBIT_CARD"), ("QRIS", "QRIS", "QRIS")]
        {
            sqlx::query(
                "INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by)
                 VALUES ($1, $2, $3, $4, 'DIRECT_TO_BANK', $5)
                 ON CONFLICT (tender_type, bank_code) DO UPDATE
                    SET settlement_mode = 'DIRECT_TO_BANK'
                  WHERE payment_method.settlement_mode = 'VIA_RECEIVABLE'",
            )
            .bind(format!("{prefix}_{bank}"))
            .bind(format!("{label} {name}"))
            .bind(tender)
            .bind(&bank)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
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
    if let Some(account_no) = request
        .account_no
        .as_deref()
        .filter(|n| !n.trim().is_empty())
    {
        let (kind, semantic) = if request.giro {
            ("GIRO", "bank_giro")
        } else {
            ("SAVINGS", "bank_savings")
        };
        if !(request.giro || request.savings) {
            return Err(AppError::Validation(
                "an account number needs a giro or savings account to register it against".into(),
            ));
        }
        // No unit named means head office's books, found by its kind (0605).
        let unit = match request
            .account_unit_id
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
        {
            Some(unit) => {
                if !super::sites::unit_exists(pool, unit).await? {
                    return Err(AppError::NotFound(format!("unit {unit}")));
                }
                unit.to_string()
            }
            None => super::sites::head_office_unit_id(pool).await?,
        };
        let unit = unit.as_str();
        let ledger: String = sqlx::query_scalar(
            "SELECT account_code FROM account_resolution
              WHERE role = $1 AND unit_id = $2 AND source_type = 'COMPANY' AND source_id = $3",
        )
        .bind(semantic)
        .bind(unit)
        .bind(&bank)
        .fetch_one(pool)
        .await?;
        let registered = describe_account(
            pool,
            &DescribeBankAccountRequest {
                ledger_account_code: ledger,
                unit_id: unit.to_string(),
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

// ---------------------------------------------------------------------------
// A shop's EDC machines (0989)
// ---------------------------------------------------------------------------

/// One shop's EDC for one bank: what it takes, and the Cash In Bank account
/// each kind lands in (owner, 24 Oct 2026). Every active terminal of that bank
/// at the shop is this one machine; `terminal_ids` names them.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdcMachine {
    pub site_id: String,
    pub bank_code: String,
    pub takes_debit: bool,
    pub takes_credit: bool,
    pub takes_qris: bool,
    /// The account a debit card lands in; `None` keeps the bank's link.
    pub debit_account: Option<String>,
    pub credit_account: Option<String>,
    pub qris_account: Option<String>,
    pub terminal_ids: Vec<String>,
}

/// An account of the chart, as a picker lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChartAccountChoice {
    pub account_code: String,
    pub name: String,
}

/// A bank a machine can belong to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdcBankChoice {
    pub code: String,
    pub name: String,
}

/// What Shop Payment Methods reads in one go: every shop's machines, the banks
/// a machine can be of, and the accounts one can settle to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EdcMachineBook {
    pub machines: Vec<EdcMachine>,
    /// The banks the company takes cards with, keeps an account at, or has a
    /// machine of — not every bank of the register.
    pub banks: Vec<EdcBankChoice>,
    /// The chart's live Cash In Bank leaves (account type BANK).
    pub accounts: Vec<ChartAccountChoice>,
    /// The heading most of them sit under: where a new one goes.
    pub heading: Option<ChartAccountChoice>,
}

/// One machine as head office sets it. An account is required for each kind
/// the machine takes, and ignored for the rest.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveEdcMachineRequest {
    pub takes_debit: bool,
    pub takes_credit: bool,
    pub takes_qris: bool,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub debit_account: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub credit_account: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub qris_account: Option<String>,
}

/// The methods a shop takes that are not a machine's.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetShopOtherMethodsRequest {
    /// Every cash, voucher, employee-balance and points method the shop takes;
    /// the others of those kinds are switched off here.
    pub codes: Vec<String>,
}

/// The tenders a machine is, and the ones set beside it.
const MACHINE_TENDERS: [&str; 3] = ["DEBIT_CARD", "CREDIT_CARD", "QRIS"];
const OTHER_TENDERS: [&str; 4] = ["CASH", "VOUCHER", "BENEFIT", "POINTS"];

const MACHINES: &str = "
    SELECT site_id, bank_code,
           bool_or(takes_debit) AS takes_debit,
           bool_or(takes_credit) AS takes_credit,
           bool_or(takes_qris) AS takes_qris,
           max(debit_account) AS debit_account,
           max(credit_account) AS credit_account,
           max(qris_account) AS qris_account,
           array_agg(terminal_id ORDER BY terminal_id) AS terminal_ids
      FROM edc_terminal
     WHERE active";

fn to_machine(row: &sqlx::postgres::PgRow) -> Result<EdcMachine, AppError> {
    Ok(EdcMachine {
        site_id: row.try_get("site_id")?,
        bank_code: row.try_get("bank_code")?,
        takes_debit: row.try_get("takes_debit")?,
        takes_credit: row.try_get("takes_credit")?,
        takes_qris: row.try_get("takes_qris")?,
        debit_account: row.try_get("debit_account")?,
        credit_account: row.try_get("credit_account")?,
        qris_account: row.try_get("qris_account")?,
        terminal_ids: row.try_get("terminal_ids")?,
    })
}

fn to_choice(row: &sqlx::postgres::PgRow) -> Result<ChartAccountChoice, AppError> {
    Ok(ChartAccountChoice {
        account_code: row.try_get("account_code")?,
        name: row.try_get("name")?,
    })
}

pub async fn edc_machine_book(pool: &PgPool) -> Result<EdcMachineBook, AppError> {
    let machines = sqlx::query(&format!(
        "{MACHINES} GROUP BY site_id, bank_code ORDER BY site_id, bank_code"
    ))
    .fetch_all(pool)
    .await?
    .iter()
    .map(to_machine)
    .collect::<Result<Vec<_>, _>>()?;
    let banks = sqlx::query(
        "SELECT b.code, b.name FROM bank b
          WHERE b.active
            AND (EXISTS (SELECT 1 FROM payment_method p
                          WHERE upper(p.bank_code) = b.code
                            AND p.tender_type IN ('DEBIT_CARD', 'CREDIT_CARD', 'QRIS'))
                 OR EXISTS (SELECT 1 FROM bank_account a
                             WHERE a.bank_id = b.bank_id AND a.is_company_account)
                 OR EXISTS (SELECT 1 FROM edc_terminal e
                             WHERE e.bank_code = b.code AND e.active))
          ORDER BY b.code",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| {
        Ok(EdcBankChoice {
            code: row.try_get("code")?,
            name: row.try_get("name")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;
    let accounts = sqlx::query(
        "SELECT account_code, name FROM ledger_account
          WHERE account_type = 'BANK' AND NOT is_group AND is_active
          ORDER BY account_code",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(to_choice)
    .collect::<Result<Vec<_>, _>>()?;
    let heading = sqlx::query(
        "SELECT h.account_code, h.name FROM ledger_account h
          WHERE h.account_code = (
                SELECT parent_code FROM ledger_account
                 WHERE account_type = 'BANK' AND NOT is_group AND is_active
                   AND parent_code IS NOT NULL
                 GROUP BY parent_code ORDER BY count(*) DESC, parent_code LIMIT 1)",
    )
    .fetch_optional(pool)
    .await?
    .as_ref()
    .map(to_choice)
    .transpose()?;
    Ok(EdcMachineBook {
        machines,
        banks,
        accounts,
        heading,
    })
}

/// The account one kind settles to: required when the machine takes it, and a
/// live Cash In Bank leaf of the chart.
async fn settle_account(
    pool: &PgPool,
    taken: bool,
    raw: Option<&str>,
    word: &str,
    bank: &str,
) -> Result<Option<String>, AppError> {
    if !taken {
        return Ok(None);
    }
    let Some(code) = raw.map(str::trim).filter(|code| !code.is_empty()) else {
        return Err(AppError::Validation(format!(
            "pick the account {word} on EDC {bank} settles to"
        )));
    };
    let fits: Option<bool> = sqlx::query_scalar(
        "SELECT account_type = 'BANK' AND NOT is_group AND is_active
           FROM ledger_account WHERE account_code = $1",
    )
    .bind(code)
    .fetch_optional(pool)
    .await?
    .flatten();
    match fits {
        Some(true) => Ok(Some(code.to_string())),
        Some(false) => Err(AppError::Validation(format!(
            "{code} is not a live Cash In Bank account; {word} on EDC {bank} has to land in one"
        ))),
        None => Err(AppError::Validation(format!(
            "no account {code} in the chart"
        ))),
    }
}

/// Set one shop's machine of one bank, and the shop's card and QRIS methods
/// with it. The shop's node hears within a minute (`payment.methods.replace`).
pub async fn save_edc_machine(
    pool: &PgPool,
    site_id: &str,
    bank_raw: &str,
    request: &SaveEdcMachineRequest,
    actor: &str,
) -> Result<EdcMachine, AppError> {
    let site_id = site_id.trim();
    let bank = bank_code_of(bank_raw)?;
    let site_known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(site_id)
        .fetch_one(pool)
        .await?;
    if !site_known {
        return Err(AppError::NotFound(format!("site {site_id}")));
    }
    let bank_known: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM bank WHERE upper(code) = $1 AND active)")
            .bind(&bank)
            .fetch_one(pool)
            .await?;
    if !bank_known {
        return Err(AppError::Validation(format!(
            "{bank} is not a bank this company knows"
        )));
    }
    if !(request.takes_debit || request.takes_credit || request.takes_qris) {
        return Err(AppError::Validation(format!(
            "EDC {bank} takes nothing; pick Debit, Credit or QRIS"
        )));
    }
    let debit = settle_account(
        pool,
        request.takes_debit,
        request.debit_account.as_deref(),
        "Debit",
        &bank,
    )
    .await?;
    let credit = settle_account(
        pool,
        request.takes_credit,
        request.credit_account.as_deref(),
        "Credit",
        &bank,
    )
    .await?;
    let qris = settle_account(
        pool,
        request.takes_qris,
        request.qris_account.as_deref(),
        "QRIS",
        &bank,
    )
    .await?;

    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        "UPDATE edc_terminal
            SET takes_debit = $3, takes_credit = $4, takes_qris = $5,
                debit_account = $6, credit_account = $7, qris_account = $8
          WHERE site_id = $1 AND bank_code = $2 AND active",
    )
    .bind(site_id)
    .bind(&bank)
    .bind(request.takes_debit)
    .bind(request.takes_credit)
    .bind(request.takes_qris)
    .bind(&debit)
    .bind(&credit)
    .bind(&qris)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        // A new machine is known by its bank until a terminal id matters.
        sqlx::query(
            "INSERT INTO edc_terminal
                 (site_id, terminal_id, bank_code, label, active, created_by,
                  takes_debit, takes_credit, takes_qris, debit_account, credit_account, qris_account)
             VALUES ($1, $2, $2,
                     'EDC ' || COALESCE((SELECT regexp_replace(name, '^Bank\\s+', '')
                                           FROM bank WHERE upper(code) = $2), $2),
                     true, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (site_id, terminal_id) DO UPDATE
                SET bank_code = EXCLUDED.bank_code, active = true,
                    takes_debit = EXCLUDED.takes_debit, takes_credit = EXCLUDED.takes_credit,
                    takes_qris = EXCLUDED.takes_qris, debit_account = EXCLUDED.debit_account,
                    credit_account = EXCLUDED.credit_account, qris_account = EXCLUDED.qris_account",
        )
        .bind(site_id)
        .bind(&bank)
        .bind(actor)
        .bind(request.takes_debit)
        .bind(request.takes_credit)
        .bind(request.takes_qris)
        .bind(&debit)
        .bind(&credit)
        .bind(&qris)
        .execute(&mut *tx)
        .await?;
    }
    sync_shop_card_methods(&mut tx, site_id, actor).await?;
    tx.commit().await?;

    let row = sqlx::query(&format!(
        "{MACHINES} AND site_id = $1 AND bank_code = $2 GROUP BY site_id, bank_code"
    ))
    .bind(site_id)
    .bind(&bank)
    .fetch_one(pool)
    .await?;
    to_machine(&row)
}

/// Take a bank's machine off a shop: its terminals stop, and the shop stops
/// taking that bank's cards and QRIS.
pub async fn remove_edc_machine(
    pool: &PgPool,
    site_id: &str,
    bank_raw: &str,
    actor: &str,
) -> Result<(), AppError> {
    let site_id = site_id.trim();
    let bank = bank_code_of(bank_raw)?;
    let mut tx = pool.begin().await?;
    let removed = sqlx::query(
        "UPDATE edc_terminal SET active = false
          WHERE site_id = $1 AND bank_code = $2 AND active",
    )
    .bind(site_id)
    .bind(&bank)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if removed == 0 {
        return Err(AppError::NotFound(format!("EDC {bank} at {site_id}")));
    }
    sync_shop_card_methods(&mut tx, site_id, actor).await?;
    tx.commit().await?;
    Ok(())
}

/// A shop's debit, credit and QRIS methods are exactly what its machines take.
/// A bank whose method the company never declared gets one, settling straight
/// to the bank (owner, 1 Oct 2026); one switched off comes back on.
async fn sync_shop_card_methods(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    site_id: &str,
    actor: &str,
) -> Result<(), AppError> {
    const TAKEN: &str = "((p.tender_type = 'DEBIT_CARD' AND e.takes_debit)
                       OR (p.tender_type = 'CREDIT_CARD' AND e.takes_credit)
                       OR (p.tender_type = 'QRIS' AND e.takes_qris))";
    sqlx::query(
        "INSERT INTO payment_method (code, name, tender_type, bank_code, settlement_mode, created_by)
         SELECT k.prefix || m.bank_code, k.word || ' ' || m.bank_code, k.tender, m.bank_code,
                'DIRECT_TO_BANK', $2
           FROM (SELECT bank_code, bool_or(takes_debit) AS d, bool_or(takes_credit) AS c,
                        bool_or(takes_qris) AS q
                   FROM edc_terminal WHERE site_id = $1 AND active GROUP BY bank_code) m
          CROSS JOIN (VALUES ('DEBIT_', 'Debit', 'DEBIT_CARD'),
                             ('CREDIT_', 'Kartu kredit', 'CREDIT_CARD'),
                             ('QRIS_', 'QRIS', 'QRIS')) AS k (prefix, word, tender)
          WHERE (k.tender = 'DEBIT_CARD' AND m.d)
             OR (k.tender = 'CREDIT_CARD' AND m.c)
             OR (k.tender = 'QRIS' AND m.q)
         ON CONFLICT DO NOTHING",
    )
    .bind(site_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    // A method the bank itself created earlier may still be on
    // VIA_RECEIVABLE (0468's old default). The machine at this shop is the
    // fact that decides where its takings land, so adding or keeping one puts
    // its debit, credit and QRIS methods on the bank (owner, 1 Oct 2026).
    sqlx::query(
        "UPDATE payment_method p
            SET settlement_mode = 'DIRECT_TO_BANK'
          WHERE p.tender_type IN ('DEBIT_CARD', 'CREDIT_CARD', 'QRIS')
            AND p.is_active
            AND p.settlement_mode = 'VIA_RECEIVABLE'
            AND EXISTS (SELECT 1 FROM edc_terminal e
                         WHERE e.site_id = $1 AND e.active
                           AND upper(e.bank_code) = upper(p.bank_code))",
    )
    .bind(site_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(&format!(
        "UPDATE payment_method p SET is_active = true
           FROM edc_terminal e
          WHERE e.site_id = $1 AND e.active AND upper(p.bank_code) = e.bank_code
            AND NOT p.is_active AND {TAKEN}"
    ))
    .bind(site_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "DELETE FROM payment_method_site ps USING payment_method p
          WHERE ps.site_id = $1 AND p.code = ps.method_code AND p.tender_type = ANY($2)",
    )
    .bind(site_id)
    .bind(MACHINE_TENDERS.as_slice())
    .execute(&mut **tx)
    .await?;
    sqlx::query(&format!(
        "INSERT INTO payment_method_site (method_code, site_id, set_by)
         SELECT DISTINCT p.code, $1, $2
           FROM payment_method p
           JOIN edc_terminal e ON e.site_id = $1 AND e.active AND upper(p.bank_code) = e.bank_code
          WHERE {TAKEN}
         ON CONFLICT DO NOTHING"
    ))
    .bind(site_id)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Replace the cash, voucher, employee-balance and points methods a shop
/// takes. Its machines' methods and any e-wallet stay as they are.
pub async fn set_shop_other_methods(
    pool: &PgPool,
    site_id: &str,
    request: &SetShopOtherMethodsRequest,
    actor: &str,
) -> Result<Vec<super::SitePaymentMethod>, AppError> {
    let site_id = site_id.trim();
    let site_known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(site_id)
        .fetch_one(pool)
        .await?;
    if !site_known {
        return Err(AppError::NotFound(format!("site {site_id}")));
    }
    let codes: Vec<String> = request
        .codes
        .iter()
        .map(|code| code.trim().to_ascii_uppercase())
        .filter(|code| !code.is_empty())
        .collect();
    let fitting: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM payment_method WHERE code = ANY($1) AND tender_type = ANY($2)",
    )
    .bind(&codes)
    .bind(OTHER_TENDERS.as_slice())
    .fetch_one(pool)
    .await?;
    let mut distinct = codes.clone();
    distinct.sort();
    distinct.dedup();
    if fitting != distinct.len() as i64 {
        return Err(AppError::Validation(
            "only cash, voucher, employee balance and points are set here; a card or QRIS \
             comes with the shop's EDC"
                .into(),
        ));
    }
    let mut tx = pool.begin().await?;
    sqlx::query(
        "DELETE FROM payment_method_site ps USING payment_method p
          WHERE ps.site_id = $1 AND p.code = ps.method_code AND p.tender_type = ANY($2)",
    )
    .bind(site_id)
    .bind(OTHER_TENDERS.as_slice())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO payment_method_site (method_code, site_id, set_by)
         SELECT code, $2, $3 FROM unnest($1::text[]) AS code
         ON CONFLICT DO NOTHING",
    )
    .bind(&distinct)
    .bind(site_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    super::site_payment_methods(pool, site_id).await
}
