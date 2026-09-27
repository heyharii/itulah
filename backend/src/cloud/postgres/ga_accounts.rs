//! Which account a bill line should propose, and why (brief §8.2).
//!
//! # The rule is a precedence, not a lookup
//!
//! A line can be about several things at once — a repair on an asset under a
//! contract — and only one of them decides the account. Brief §8.2 fixes the
//! order, and this module is that order written once so the proposal endpoint
//! and the pre-posting warnings cannot drift apart:
//!
//!   1. a line that buys an asset      → the class's `fixed_asset` account;
//!   2. a line that names a repair     → `repair_expense`, by the repair object;
//!   3. a line that names a contract   → `prepaid_expense` (paid in advance,
//!      qualified by the type's `prepaid_kind`) or `contract_expense` (by type),
//!      with `JASA_MAINTENANCE` following the object it maintains;
//!   4. a line that names a supply     → the category's own account;
//!   5. everything else                → the vendor's default account.
//!
//! # Why a missing account is an answer and not an error
//!
//! Brief §4.2 is a hard limit: this estate creates no chart account. When the
//! map has nothing for a meaning, `resolve_account` refuses — and that refusal
//! is the CORRECT answer, not a hole to paper over. So `suggest_account`
//! catches it and returns `account_code: None` with `missing` naming what
//! Finance has to decide. It never falls back to a plausible-looking account:
//! a wrong account posts silently and is found at month end; an absent one
//! stops at the form.
//!
//! # What "source" is for
//!
//! `source` is the sentence the screen shows beside a proposed account —
//! "objek perbaikan · AC & refrigerator" — so a person can see WHY the code in
//! the box is the one it is. It is built from the same rows the account was, so
//! the two cannot disagree.

use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::ledger::resolve_account;
use crate::cloud::application::AppError;
use crate::cloud::domain::CONTRACT_PREPAID_KINDS;

/// What a bill line points at, reduced to the facts that choose an account.
///
/// `supplier_id` is here rather than only on the request because step five is
/// "the vendor's own default account": without the vendor there is no answer,
/// and a struct that hid that would force the caller to guess.
#[derive(Clone, Debug, Default)]
pub struct LineRefs {
    /// The class a line BUYS an asset in (`asset_class.class_code`). Not the
    /// class of an asset a cost merely happens to be near — that is `asset_id`,
    /// and by itself it proposes the class account at step two through the
    /// repair, or the vendor default.
    pub asset_class_code: Option<String>,
    pub repair_id: Option<Uuid>,
    pub contract_id: Option<Uuid>,
    pub supply_request_id: Option<Uuid>,
    /// "Bayar dimuka" is on. Only meaningful with a contract, and it selects
    /// between the two contract branches.
    pub prepaid: bool,
    /// The vendor, for step five.
    pub supplier_id: Option<String>,
}

/// The account a line should propose, and where the proposal came from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountSuggestion {
    /// `None` when the account is not in the chart yet — see `missing`.
    pub account_code: Option<String>,
    pub account_name: Option<String>,
    /// Which rule proposed it, in words: "kelas aset · Air Conditioner",
    /// "objek perbaikan · AC & refrigerator", "jenis kontrak · Sewa toko ·
    /// bayar dimuka".
    pub source: String,
    /// The account a person has to decide about, when the map resolves to
    /// nothing. Brief §4.2: Finance decides, GA does not invent.
    pub missing: Option<String>,
}

/// A missing account, phrased the way the screen and the report read it: the
/// name of the thing that needs an account, and who has to say which.
fn needs_finance(what: &str) -> String {
    format!("{what} — akunnya belum ada/dipetakan, keputusan Finance")
}

/// Look up the client's own name for an account, so a proposal reads as words
/// and not only as a code.
async fn account_name(pool: &PgPool, code: &str) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar("SELECT name FROM ledger_account WHERE account_code = $1")
        .bind(code)
        .fetch_optional(pool)
        .await?)
}

/// Try one meaning/qualifier at one site. A missing mapping is returned as a
/// suggestion carrying `missing`, and every other error is passed through.
///
/// The line is at a site; the map is read in the books of the unit that owns
/// it (0605), because that is where the bill will post.
async fn resolve_or_missing(
    pool: &PgPool,
    site_id: &str,
    semantic_key: &str,
    qualifier: &str,
    source: String,
    what_needs_an_account: &str,
) -> Result<AccountSuggestion, AppError> {
    let unit = super::sites::unit_of_site(pool, site_id).await?;
    match resolve_account(pool, semantic_key, &unit, qualifier).await {
        Ok(resolved) => Ok(AccountSuggestion {
            account_name: account_name(pool, &resolved.account_code).await?,
            account_code: Some(resolved.account_code),
            source,
            missing: None,
        }),
        Err(AppError::Validation(_)) => Ok(AccountSuggestion {
            account_code: None,
            account_name: None,
            source,
            missing: Some(needs_finance(what_needs_an_account)),
        }),
        Err(other) => Err(other),
    }
}

/// The order, exactly brief §8.2's.
///
/// "Membeli aset" outranks "merujuk perbaikan": a line that both buys a thing
/// and repairs one is really two lines, and `record_bill` refuses to store the
/// two references on one line — this is the reading that keeps the suggestion
/// honest with that refusal.
pub async fn suggest_account(
    pool: &PgPool,
    site_id: &str,
    refs: &LineRefs,
) -> Result<AccountSuggestion, AppError> {
    let trimmed = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };

    // 1. The line buys an asset: the class decides, through `fixed_asset`.
    if let Some(class) = trimmed(&refs.asset_class_code) {
        let class_name: Option<String> =
            sqlx::query_scalar("SELECT name FROM asset_class WHERE class_code = $1")
                .bind(&class)
                .fetch_optional(pool)
                .await?;
        let label = class_name.unwrap_or_else(|| class.clone());
        return resolve_or_missing(
            pool,
            site_id,
            "fixed_asset",
            &class,
            format!("kelas aset · {label}"),
            &format!("akun aset tetap kelas {label}"),
        )
        .await;
    }

    // 2. The line pays for a repair: the object decides, through
    //    `repair_expense`. The object is the repair's own, never re-derived
    //    from the asset, so a repair entered for the wrong object has one
    //    answer to fix.
    if let Some(repair_id) = refs.repair_id {
        let row = sqlx::query(
            "SELECT r.objek, o.name AS objek_name
               FROM ga_repair r
               JOIN ga_repair_object o ON o.code = r.objek
              WHERE r.repair_id = $1",
        )
        .bind(repair_id)
        .fetch_optional(pool)
        .await?;
        let row = row.ok_or_else(|| {
            AppError::Validation(format!("there is no repair {repair_id} to suggest an account for"))
        })?;
        let objek: String = row.try_get("objek")?;
        let objek_name: String = row.try_get("objek_name")?;
        return resolve_or_missing(
            pool,
            site_id,
            "repair_expense",
            &objek,
            format!("objek perbaikan · {objek_name}"),
            &format!("akun beban perbaikan objek {objek_name}"),
        )
        .await;
    }

    // 3. The line pays under a contract. "Bayar dimuka" is the one branch:
    //    the prepaid side is spoken by `prepaid_kind`, not by contract type
    //    (0361), so the type is bridged to its kind first.
    if let Some(contract_id) = refs.contract_id {
        let row = sqlx::query(
            "SELECT c.contract_type, c.objek, ct.name AS type_name, ro.name AS objek_name
               FROM ga_contract c
               JOIN contract_type ct ON ct.code = c.contract_type
               LEFT JOIN ga_repair_object ro ON ro.code = c.objek
              WHERE c.contract_id = $1",
        )
        .bind(contract_id)
        .fetch_optional(pool)
        .await?;
        let row = row.ok_or_else(|| {
            AppError::Validation(format!("there is no contract {contract_id} to suggest an account for"))
        })?;
        let contract_type: String = row.try_get("contract_type")?;
        let objek: Option<String> = row.try_get("objek")?;
        let objek_name: Option<String> = row.try_get("objek_name")?;
        let type_name: String = row.try_get("type_name")?;

        if refs.prepaid {
            let kind = CONTRACT_PREPAID_KINDS
                .iter()
                .find(|(of_type, _)| *of_type == contract_type)
                .map(|(_, kind)| *kind);
            return match kind {
                Some(kind) => {
                    resolve_or_missing(
                        pool,
                        site_id,
                        "prepaid_expense",
                        kind,
                        format!("jenis kontrak · {type_name} · bayar dimuka"),
                        &format!("akun biaya dibayar dimuka jenis kontrak {type_name}"),
                    )
                    .await
                }
                None => Ok(AccountSuggestion {
                    account_code: None,
                    account_name: None,
                    source: format!("jenis kontrak · {type_name} · bayar dimuka"),
                    missing: Some(needs_finance(&format!(
                        "akun biaya dibayar dimuka jenis kontrak {type_name}"
                    ))),
                }),
            };
        }

        // A maintenance contract's charge follows the thing it maintains
        // (brief §9.2: `JASA_MAINTENANCE` ← ikut `repair_expense` objek), which
        // is why it does not go through `contract_expense` at all.
        if contract_type == "JASA_MAINTENANCE" {
            let Some(objek) = objek else {
                return Ok(AccountSuggestion {
                    account_code: None,
                    account_name: None,
                    source: format!("kontrak maintenance · {type_name}"),
                    missing: Some(needs_finance(
                        "akun beban kontrak maintenance (objek perbaikan belum ditentukan)",
                    )),
                });
            };
            let label = objek_name.unwrap_or_else(|| objek.clone());
            return resolve_or_missing(
                pool,
                site_id,
                "repair_expense",
                &objek,
                format!("kontrak maintenance · {label}"),
                &format!("akun beban perbaikan objek {label}"),
            )
            .await;
        }

        return resolve_or_missing(
            pool,
            site_id,
            "contract_expense",
            &contract_type,
            format!("jenis kontrak · {type_name}"),
            &format!("akun beban jenis kontrak {type_name}"),
        )
        .await;
    }

    // 4. The line answers a supply request: the category carries its own
    //    account (0368), so no map is consulted and nothing can be missing.
    if let Some(request_id) = refs.supply_request_id {
        let row = sqlx::query(
            "SELECT c.category_code, c.name AS category_name, c.account_code
               FROM ga_supply_request r
               JOIN ga_supply_category c ON c.category_code = r.category_code
              WHERE r.request_id = $1",
        )
        .bind(request_id)
        .fetch_optional(pool)
        .await?;
        let row = row.ok_or_else(|| {
            AppError::Validation(format!(
                "there is no supply request {request_id} to suggest an account for"
            ))
        })?;
        let account_code: String = row.try_get("account_code")?;
        let category_name: String = row.try_get("category_name")?;
        return Ok(AccountSuggestion {
            account_name: account_name(pool, &account_code).await?,
            account_code: Some(account_code),
            source: format!("kategori supplies · {category_name}"),
            missing: None,
        });
    }

    // 5. Nothing names an object: the vendor's own default account. It is read
    //    straight off the master and not resolved, because a vendor default is
    //    the client's own choice of account and not a meaning the map owns.
    if let Some(supplier_id) = trimmed(&refs.supplier_id) {
        // `supplier_id::text`: the master's key is a uuid while a bill carries
        // the supplier as TEXT (`supplier_invoice.supplier_id` has no foreign
        // key), so one side has to be cast and the text side is the one that
        // must keep working for a party the register has not got as a uuid.
        let code: Option<String> =
            sqlx::query_scalar("SELECT expense_account_code FROM supplier WHERE supplier_id::text = $1")
                .bind(&supplier_id)
                .fetch_optional(pool)
                .await?
                .flatten();
        return match code.map(|code| code.trim().to_string()).filter(|c| !c.is_empty()) {
            Some(code) => Ok(AccountSuggestion {
                account_name: account_name(pool, &code).await?,
                account_code: Some(code),
                source: "akun default vendor".into(),
                missing: None,
            }),
            None => Ok(AccountSuggestion {
                account_code: None,
                account_name: None,
                source: "akun default vendor".into(),
                missing: Some(needs_finance("akun beban default vendor")),
            }),
        };
    }

    // Nothing to go on at all. This is a caller mistake, not a missing
    // account: the form always has a vendor and usually a reference.
    Err(AppError::Validation(
        "a suggestion needs something to be about: an asset class, a repair, a contract, a \
         supply request, or at least the vendor whose default account it would be"
            .into(),
    ))
}

/// A suggestion for a line that has not been written yet, from the loose ids a
/// form hands over. Kept beside [`suggest_account`] so the two orders are one
/// list, not two.
pub async fn suggest_for_line(
    pool: &PgPool,
    site_id: &str,
    asset_class_code: Option<&str>,
    repair_id: Option<Uuid>,
    contract_id: Option<Uuid>,
    supply_request_id: Option<Uuid>,
    prepaid: bool,
    supplier_id: Option<&str>,
) -> Result<AccountSuggestion, AppError> {
    suggest_account(
        pool,
        site_id,
        &LineRefs {
            asset_class_code: asset_class_code.map(str::to_string),
            repair_id,
            contract_id,
            supply_request_id,
            prepaid,
            supplier_id: supplier_id.map(str::to_string),
        },
    )
    .await
}
