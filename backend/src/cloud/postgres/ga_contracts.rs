//! GA's contracts: the deals with a window, the meters that measure them, and
//! the recurring bills that say whose promise they serve.
//!
//! # What a contract is, and what it is not
//!
//! A contract is a DEAL — two parties, a window, a value, a type — and the
//! register's word for the paper. The money is deliberately not here: GA
//! holds what was agreed, Finance holds what was billed, and the two meet
//! through references (0362 points a `bill_template` at the contract, 0370
//! points each bill LINE at it). [`GaContractRow::billed_minor`]
//! reads that side back by asking, never by storing.
//!
//! # The standing is computed, never stored
//!
//! Whether a deal is AKTIF, SEGERA_HABIS or HABIS is arithmetic on the
//! contract's own window and its own `reminder_days`, and storing an answer
//! to arithmetic is storing a number that ages wrong. The rule is written
//! once, in `domain::ga::contract_standing`, and this module asks it for
//! every row it hands out. The one SQL spelling of it — inside
//! [`ga_contract_search`] — exists so the facet counts can GROUP BY and the
//! filter can narrow by what the rows show, and it names the Rust function
//! in a comment so a reader knows which of the two is the law.
//!
//! # There is no DELETE, and archive is a fact, not a trash can
//!
//! Brief §12: a record a bill pointed at cannot vanish. Contracts are no
//! exception, so this module has no delete and the archive is a boolean with
//! a reason appended to the notes — a terminated lease is exactly the paper
//! somebody will need to find again in three years.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::ga_assets::GaDocument;
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    contract_standing, CONTRACT_PREPAID_KINDS, CONTRACT_SCOPE_TYPES, CONTRACT_TYPES,
};

/// One contract as GA reads it: the deal, its window, and the two figures
/// that are read back from Finance rather than kept here.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractRow {
    pub contract_id: Uuid,
    /// The number ON THE PAPER, if the paper has one.
    pub contract_number: Option<String>,
    pub contract_type: String,
    /// The client's own name for the type ("Sewa toko/gudang/kantor").
    pub contract_type_name: String,
    /// `SEWA`, `JASA`, `ASURANSI`, `IZIN`, `LANGGANAN` or `DISEWAKAN` — the
    /// shelf the contract sits on.
    pub group_code: String,
    /// What a maintenance contract maintains; `None` for every other type.
    pub objek: Option<String>,
    pub objek_name: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub supplier_name: Option<String>,
    /// The free-text counterparty — the tenant, the koperasi, the event
    /// organiser — present exactly when `supplier_id` is absent.
    pub counterparty_name: Option<String>,
    pub site_id: Option<String>,
    /// `ALL_STORES` or `ALL_SITES`, present exactly when `site_id` is absent.
    pub site_scope: Option<String>,
    /// The one thing a maintenance contract maintains, when it is a thing.
    pub asset_id: Option<Uuid>,
    pub starts_on: NaiveDate,
    pub ends_on: Option<NaiveDate>,
    pub contract_value_minor: Option<i64>,
    pub is_signed: bool,
    pub signed_by: Option<String>,
    /// The PLN / PDAM / Telkom customer number, for the Langganan types.
    pub customer_number: Option<String>,
    pub reminder_days: i32,
    pub notes: Option<String>,
    /// `DRAFT`, `ACTIVE` or `TERMINATED`, as the row keeps it.
    pub status: String,
    pub archived: bool,
    /// Dihitung dari jendela dan `reminder_days`, bukan disimpan —
    /// `domain::ga::contract_standing` is the rule.
    pub standing: String,
    /// Days until `ends_on`, negative once it has passed; `None` without one.
    pub days_to_end: Option<i64>,
    /// Jumlah baris tagihan POSTED yang menunjuk kontrak ini. Dibaca saja.
    pub billed_minor: i64,
    /// Nilai kontrak dikurangi yang sudah ditagih; `null` bila tidak ada nilai.
    pub remaining_minor: Option<i64>,
    /// The month the meter was last read, for the Langganan strip.
    pub last_usage_period: Option<NaiveDate>,
    /// `closing - opening` of that last reading — computed by the reader, and
    /// never stored twice.
    pub last_usage: Option<i64>,
    pub last_unit: Option<String>,
    pub version: i32,
}

/// One value a GA filter can take, and how many contracts would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
}

/// The four things the contract register can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractFacets {
    pub types: Vec<GaContractFacet>,
    pub groups: Vec<GaContractFacet>,
    pub sites: Vec<GaContractFacet>,
    pub standings: Vec<GaContractFacet>,
}

/// A page of the contract register, and how big the whole answer is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractPage {
    pub rows: Vec<GaContractRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: GaContractFacets,
    pub summary: GaContractSummary,
}

/// The figures the register's strip prints, counted over EVERY contract the
/// search and the filters match — not over a page of them, which would be a
/// figure about the scroll position.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractSummary {
    /// Standing AKTIF or SEGERA_HABIS.
    pub active: i64,
    /// Standing SEGERA_HABIS or HABIS: due, or overdue, for renewal.
    pub due_for_renewal: i64,
    /// Σ contract value of the active ones.
    pub active_value_minor: i64,
    /// Σ POSTED bill lines pointing at the matched contracts. Across every
    /// group, the rent the company RECEIVES (DISEWAKAN) is left out — a sum of
    /// both directions is a number nobody can use; a group filter keeps it in.
    pub billed_minor: i64,
}

/// The two orders the register can be read in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GaContractOrder {
    /// The house order: the type's own position, then the start day.
    #[default]
    Register,
    /// By the place first — the Subscriptions reading, which answers "what is
    /// connected there".
    Site,
}

/// Where the previous page stopped: the last contract's id.
#[derive(Serialize, Deserialize)]
struct GaContractCursor {
    contract_id: Uuid,
}

/// What a caller is asking the contract register for.
///
/// `today` is the business clock's day — the standing is ABOUT a day, and a
/// rule that decides "segera habis" must decide it against the day the shop
/// is actually on, not the server's.
#[derive(Clone, Debug)]
pub struct GaContractScope {
    /// Free text against the paper number, the counterparty, the customer
    /// number and the supplier's name — the four things somebody holding a
    /// vendor invoice might actually type.
    pub needle: Option<String>,
    pub types: Vec<String>,
    pub groups: Vec<String>,
    pub sites: Vec<String>,
    pub standings: Vec<String>,
    /// `Some(true)` hanya yang diarsipkan; `Some(false)` tanpa arsip; `None`
    /// semua.
    pub archived: Option<bool>,
    pub today: NaiveDate,
    pub limit: i64,
}

/// The register's first page when a caller does not say.
pub const DEFAULT_GA_CONTRACT_LIMIT: i64 = 200;
/// And the most it will answer with however loudly a caller asks — the same
/// ceiling `ga_assets` keeps, for the same reason.
pub const MAX_GA_CONTRACT_LIMIT: i64 = 1000;

/// Record a deal, from scratch.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordGaContractRequest {
    pub contract_number: Option<String>,
    pub contract_type: String,
    pub objek: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub counterparty_name: Option<String>,
    pub site_id: Option<String>,
    pub site_scope: Option<String>,
    pub asset_id: Option<Uuid>,
    pub starts_on: NaiveDate,
    pub ends_on: Option<NaiveDate>,
    pub contract_value_minor: Option<i64>,
    pub is_signed: bool,
    pub signed_by: Option<String>,
    pub customer_number: Option<String>,
    #[serde(default = "default_reminder_days")]
    pub reminder_days: i32,
    pub notes: Option<String>,
}

fn default_reminder_days() -> i32 {
    60
}

/// What may be corrected about a deal, in place.
///
/// Every field is optional and `None` leaves it alone. The one-party and
/// one-scope rules make the awkward question disappear: naming a
/// `supplier_id` DROPS the counterparty, naming a `site_scope` drops the
/// site, because a contract cannot hold both and the database would refuse
/// the attempt anyway. What PATCH deliberately cannot do is DETACH —
/// `ends_on`, `contract_value_minor` and `asset_id` can be replaced but not
/// nulled, for the reason `eligibility` wrote down: TypeScript flattens
/// `Option<Option<T>>` to `T | null`, and a caller that omitted the field
/// would be asking a different question from the one it thought it was
/// asking. A deal whose window is wrong is re-cut, not un-ended.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGaContractRequest {
    pub contract_number: Option<String>,
    pub contract_type: Option<String>,
    pub objek: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub counterparty_name: Option<String>,
    pub site_id: Option<String>,
    pub site_scope: Option<String>,
    pub asset_id: Option<Uuid>,
    pub starts_on: Option<NaiveDate>,
    pub ends_on: Option<NaiveDate>,
    pub contract_value_minor: Option<i64>,
    pub is_signed: Option<bool>,
    pub signed_by: Option<String>,
    pub customer_number: Option<String>,
    pub reminder_days: Option<i32>,
    pub notes: Option<String>,
    /// `DRAFT` → `ACTIVE` → `TERMINATED`, and nothing backwards: a
    /// terminated deal is history, and re-activating it is a new deal.
    pub status: Option<String>,
}

/// Archive, or bring back. Archived is a place a contract can be found, not
/// a place it is hidden from the books.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ArchiveGaContractRequest {
    pub archived: bool,
    pub reason: String,
}

/// One meter reading: the month, the two numbers, and the usage between them.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaMeterReading {
    pub reading_id: Uuid,
    pub contract_id: Uuid,
    /// The month being measured, always its first day.
    pub period: NaiveDate,
    /// `kWh`, `m³` — the meter's own unit, typed as read.
    pub unit: String,
    pub opening: i64,
    pub closing: i64,
    /// `closing - opening`, dihitung di sini dan bukan disimpan: storing it
    /// too would store one number twice with a disagreement waiting between
    /// the two.
    pub usage: i64,
    pub read_on: NaiveDate,
    pub recorded_by: String,
}

/// Record (or correct) one month's reading.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordMeterReadingRequest {
    pub period: NaiveDate,
    pub unit: String,
    pub opening: i64,
    pub closing: i64,
    pub read_on: NaiveDate,
}

/// One bill that points at the contract — POSTED, and only the summary: the
/// paper's number, its day, what it charged, on which account.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractBill {
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub invoice_date: NaiveDate,
    pub amount_minor: i64,
    pub account_code: String,
    pub status: String,
}

/// One recurring bill that says whose promise it is (0362).
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractTemplate {
    pub template_id: Uuid,
    pub label: String,
    pub expected_subtotal_minor: i64,
    pub tolerance_bps: i32,
    pub due_day: i32,
    pub active: bool,
}

/// One contract, everything filed against it, and the money that points at it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractHub {
    pub contract: GaContractRow,
    /// Tagihan yang menunjuk kontrak ini (baris POSTED), untuk bagian
    /// "ditagih" di hub. Ringkas: nomor, tanggal, jumlah, akun.
    pub bills: Vec<GaContractBill>,
    /// The meter's history, newest month first.
    pub meter_readings: Vec<GaMeterReading>,
    /// Template tagihan rutin yang menunjuk kontrak ini.
    pub templates: Vec<GaContractTemplate>,
    pub documents: Vec<GaDocument>,
}

/// One contract type as the client draws it, with the accounts it resolves to
/// at ONE site — the map is per site, so the codes are "at this site", and
/// not eternal truths.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaContractType {
    pub code: String,
    pub name: String,
    pub group_code: String,
    pub sort_order: i32,
    /// Where an advance payment for this type lands (`prepaid_expense`,
    /// qualified by the type's `prepaid_kind`).
    pub prepaid_account_code: Option<String>,
    /// The charge a bill for this type carries (`contract_expense`). `None`
    /// for SEWA_KENDARAAN (no leaf in the chart yet) and JASA_MAINTENANCE
    /// (its charge follows the repair object, stage 4).
    pub expense_account_code: Option<String>,
    /// The income a type the company RENTS OUT earns (`contract_income`).
    pub income_account_code: Option<String>,
}

/// The last meter reading per contract, as one lateral row — `NULL` for the
/// fourteen types that have no meter.
const GA_LAST_READING: &str = "LEFT JOIN LATERAL (
         SELECT period, closing - opening AS usage, unit
           FROM ga_meter_reading r
          WHERE r.contract_id = c.contract_id
          ORDER BY r.period DESC LIMIT 1
     ) m ON true";

/// `domain::ga::contract_standing`, spelled in SQL — the Rust function is the
/// law and this mirror exists so the facet counts can GROUP BY it and the
/// filter can narrow by it. `$2` is the business day both sides bind.
const GA_STANDING: &str = "CASE
        WHEN c.status = 'DRAFT' THEN 'DRAFT'
        WHEN c.status = 'TERMINATED' THEN 'DIHENTIKAN'
        WHEN $2::date < c.starts_on THEN 'BELUM_MULAI'
        WHEN c.ends_on IS NOT NULL AND c.ends_on < $2::date THEN 'HABIS'
        WHEN c.ends_on IS NOT NULL
             AND c.ends_on <= $2::date + c.reminder_days THEN 'SEGERA_HABIS'
        ELSE 'AKTIF'
    END";

/// The search, defined once so the page, the facet counts and the single
/// reads see one set — including the standing, which is computed HERE,
/// where the contract's alias is `c`.
///
/// Binds: `$1` the search pattern or NULL, `$2` the business day.
fn ga_contract_search() -> String {
    format!(
        "SELECT c.*, ct.name AS contract_type_name, ct.group_code, ct.sort_order,
                sup.name AS supplier_name,
                ro.name AS objek_name,
                st.name AS site_name,
                {GA_STANDING} AS standing,
                m.period, m.usage, m.unit
           FROM ga_contract c
           JOIN contract_type ct ON ct.code = c.contract_type
           LEFT JOIN supplier sup ON sup.supplier_id = c.supplier_id
           LEFT JOIN ga_repair_object ro ON ro.code = c.objek
           LEFT JOIN site st ON st.id = c.site_id
           {GA_LAST_READING}
          WHERE ($1::text IS NULL
                 OR c.contract_number ILIKE $1
                 OR c.counterparty_name ILIKE $1
                 OR c.customer_number ILIKE $1
                 OR EXISTS (SELECT 1 FROM supplier sx
                             WHERE sx.supplier_id = c.supplier_id AND sx.name ILIKE $1))"
    )
}

/// The filters, spelled once so the page and the total narrow identically.
/// Bare names: they run over the SEARCHED set's own output columns.
const GA_CONTRACT_FILTERS: &str = "
    ($3::text[] IS NULL OR contract_type = ANY($3))
    AND ($4::text[] IS NULL OR group_code = ANY($4))
    AND ($5::text[] IS NULL OR site_id = ANY($5))
    AND ($6::text[] IS NULL OR standing = ANY($6))
    AND ($7::boolean IS NULL OR archived = $7)
";

/// The columns a writer RETURNS, wrapped into the reader's shape by
/// [`written_row`] — with the figures a fresh write KNOWS are true: nothing
/// is billed against a contract nobody has seen yet, and it has no readings.
const GA_CONTRACT_RETURNING: &str = "RETURNING contract_id, contract_number, contract_type,
    objek, supplier_id, counterparty_name, site_id, site_scope, asset_id,
    starts_on, ends_on, contract_value_minor, is_signed, signed_by,
    customer_number, reminder_days, notes, status, archived, version";

fn to_ga_contract(row: &sqlx::postgres::PgRow, today: NaiveDate) -> Result<GaContractRow, AppError> {
    let status: String = row.try_get("status")?;
    let starts_on: NaiveDate = row.try_get("starts_on")?;
    let ends_on: Option<NaiveDate> = row.try_get("ends_on")?;
    let reminder_days: i32 = row.try_get("reminder_days")?;
    let (standing, days_to_end) =
        contract_standing(&status, starts_on, ends_on, reminder_days, today);
    let contract_value_minor: Option<i64> = row.try_get("contract_value_minor")?;
    let billed_minor: i64 = row.try_get("billed_minor")?;

    Ok(GaContractRow {
        contract_id: row.try_get("contract_id")?,
        contract_number: row.try_get("contract_number")?,
        contract_type: row.try_get("contract_type")?,
        contract_type_name: row.try_get("contract_type_name")?,
        group_code: row.try_get("group_code")?,
        objek: row.try_get("objek")?,
        objek_name: row.try_get("objek_name")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        counterparty_name: row.try_get("counterparty_name")?,
        site_id: row.try_get("site_id")?,
        site_scope: row.try_get("site_scope")?,
        asset_id: row.try_get("asset_id")?,
        starts_on,
        ends_on,
        contract_value_minor,
        is_signed: row.try_get("is_signed")?,
        signed_by: row.try_get("signed_by")?,
        customer_number: row.try_get("customer_number")?,
        reminder_days,
        notes: row.try_get("notes")?,
        status,
        archived: row.try_get("archived")?,
        standing: standing.to_string(),
        days_to_end,
        billed_minor,
        remaining_minor: contract_value_minor.map(|value| value - billed_minor),
        last_usage_period: row.try_get("period")?,
        last_usage: row.try_get("usage")?,
        last_unit: row.try_get("unit")?,
        version: row.try_get("version")?,
    })
}

/// Wrap a writer's RETURNING row (see [`GA_CONTRACT_RETURNING`]) into the
/// shape the readers serve, with the billed/reading columns a fresh write
/// knows the answers to filled in rather than read.
const GA_WRITTEN_SHAPE: &str = "SELECT w.*,
        ct.name AS contract_type_name, ct.group_code, ct.sort_order,
        sup.name AS supplier_name,
        ro.name AS objek_name,
        0::bigint AS billed_minor,
        NULL::date AS period, NULL::bigint AS usage, NULL::text AS unit
   FROM written w
   JOIN contract_type ct ON ct.code = w.contract_type
   LEFT JOIN supplier sup ON sup.supplier_id = w.supplier_id
   LEFT JOIN ga_repair_object ro ON ro.code = w.objek";

/// Blank text is nothing, and nothing is stored as NULL rather than as "" —
/// `ga_assets`' same helper, repeated rather than shared because that one is
/// `pub` to nobody.
fn nothing_if_blank(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|text| !text.is_empty())
}

/// The type must be one of the seventeen, and the refusal names them.
fn assert_contract_type(code: &str) -> Result<String, AppError> {
    let upper = code.trim().to_ascii_uppercase();
    match CONTRACT_TYPES.iter().find(|(known, _, _)| *known == upper) {
        Some((code, _, _)) => Ok((*code).to_string()),
        None => {
            let names: Vec<&str> = CONTRACT_TYPES.iter().map(|(code, _, _)| *code).collect();
            Err(AppError::Validation(format!(
                "{upper} is not a contract type; a contract is one of: {}",
                names.join(", ")
            )))
        }
    }
}

/// The scope words, checked before the CHECK can say them badly.
fn assert_site_scope(word: &str) -> Result<String, AppError> {
    let upper = word.trim().to_ascii_uppercase();
    match upper.as_str() {
        "ALL_STORES" | "ALL_SITES" => Ok(upper),
        other => Err(AppError::Validation(format!(
            "{other} is not a coverage; a contract covers ALL_STORES, ALL_SITES, or one site"
        ))),
    }
}

/// The deal's shape, checked in words before the database checks it in
/// constraint names.
///
/// This is the ONE place both writers run through, which is what keeps a
/// record and a correction from disagreeing about what a contract is:
/// exactly one party, exactly one coverage, an objek only on a maintenance
/// contract, a window that does not end before it opens, and a value that is
/// not negative.
async fn assert_contract_shape(
    pool: &PgPool,
    contract_type: &str,
    objek: Option<&str>,
    supplier_id: Option<Uuid>,
    counterparty_name: Option<&str>,
    site_id: Option<&str>,
    site_scope: Option<&str>,
    starts_on: NaiveDate,
    ends_on: Option<NaiveDate>,
    contract_value_minor: Option<i64>,
) -> Result<(), AppError> {
    let counterparty = nothing_if_blank(counterparty_name);
    match (supplier_id, counterparty) {
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "a contract has one counterparty: name the supplier or name the free-text \
                 party, not both".into(),
            ));
        }
        (None, None) => {
            return Err(AppError::Validation(
                "a contract needs one counterparty: a registered supplier, or the free-text \
                 name of whoever signed on the other side".into(),
            ));
        }
        (Some(id), None) => {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM supplier WHERE supplier_id = $1)")
                    .bind(id)
                    .fetch_one(pool)
                    .await?;
            if !exists {
                return Err(AppError::Validation(
                    "the supplier named on this contract is not in the register; register \
                     them first, then file the contract".into(),
                ));
            }
        }
        (None, Some(_)) => {}
    }

    // Exactly one coverage, and the coverage must fit the type: a shop lease
    // is about one shop; only the kinds whose deal genuinely spans places may
    // claim ALL_STORES or ALL_SITES.
    let scope_word = site_scope.map(assert_site_scope).transpose()?;
    match (site_id, &scope_word) {
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "a contract has one coverage: name the site or the scope, not both".into(),
            ));
        }
        (None, None) => {
            return Err(AppError::Validation(
                "a contract needs one coverage: the site it is about, or ALL_STORES / \
                 ALL_SITES for a deal that spans them".into(),
            ));
        }
        (Some(site), None) => {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
                    .bind(site)
                    .fetch_one(pool)
                    .await?;
            if !exists {
                return Err(AppError::Validation(format!(
                    "no site {site} in the register; a contract is filed where the deal happens"
                )));
            }
        }
        (None, Some(word)) => {
            if !CONTRACT_SCOPE_TYPES.contains(&contract_type) {
                return Err(AppError::Validation(format!(
                    "{contract_type} contracts are about one site; {word} is only for a deal \
                     that spans places: {}",
                    CONTRACT_SCOPE_TYPES.join(", ")
                )));
            }
        }
    }

    // The objek, exactly for maintenance.
    match (contract_type, nothing_if_blank(objek)) {
        ("JASA_MAINTENANCE", Some(code)) => {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM ga_repair_object WHERE code = $1)",
            )
            .bind(code)
            .fetch_one(pool)
            .await?;
            if !exists {
                let names: Vec<String> =
                    sqlx::query("SELECT code FROM ga_repair_object ORDER BY code")
                        .fetch_all(pool)
                        .await?
                        .iter()
                        .filter_map(|row| row.try_get::<String, _>("code").ok())
                        .collect();
                return Err(AppError::Validation(format!(
                    "{code} is not a repair object; a maintenance contract maintains one of: {}",
                    names.join(", ")
                )));
            }
        }
        ("JASA_MAINTENANCE", None) => {
            return Err(AppError::Validation(
                "a maintenance contract says what it maintains: one of the eleven repair \
                 objects, from AC to lift".into(),
            ));
        }
        (_, Some(code)) => {
            return Err(AppError::Validation(format!(
                "{code} names a repair object, but objek is only for a JASA_MAINTENANCE \
                 contract; {contract_type} is about the whole deal"
            )));
        }
        (_, None) => {}
    }

    if let Some(end) = ends_on {
        if end < starts_on {
            return Err(AppError::Validation(
                "the window ends before it opens: ends_on cannot be before starts_on".into(),
            ));
        }
    }
    if contract_value_minor.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "a contract's value is what the deal is worth; a negative one is a credit \
             note, not a contract".into(),
        ));
    }
    Ok(())
}

/// The billed total, as a correlated subquery over the caller's contract row
/// (0370's `supplier_invoice_expense_line.contract_id`).
///
/// The alias is a parameter because the two readers name the contract
/// differently — `kept k` in the page, `q` in the single read — and a subquery
/// that names the wrong alias is a SQL error, not a wrong number. (Before the
/// column existed this branch was never taken, which is why the alias was
/// never noticed.)
fn billed_select(alias: &str) -> String {
    format!(
        "(SELECT COALESCE(sum(bl.amount_minor), 0)::bigint
            FROM supplier_invoice_expense_line bl
            JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
           WHERE bl.contract_id = {alias}.contract_id AND si.status = 'POSTED')"
    )
}

/// The contract register's first page in the house order, beside the shape of
/// everything it holds. See [`ga_contract_book`] for the paged read.
pub async fn ga_contract_page(
    pool: &PgPool,
    scope: GaContractScope,
) -> Result<GaContractPage, AppError> {
    ga_contract_book(pool, scope, None, GaContractOrder::Register).await
}

/// The contract register, one page at a time, beside the shape of everything
/// it holds.
///
/// Paged by a keyset on the chosen order, ending in `contract_id` so two
/// contracts that tie on everything else cannot repeat or vanish across a
/// page boundary.
pub async fn ga_contract_book(
    pool: &PgPool,
    scope: GaContractScope,
    cursor: Option<&str>,
    order: GaContractOrder,
) -> Result<GaContractPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let types = (!scope.types.is_empty()).then(|| scope.types.clone());
    let groups = (!scope.groups.is_empty()).then(|| scope.groups.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let standings = (!scope.standings.is_empty()).then(|| scope.standings.clone());
    let limit = scope.limit.clamp(1, MAX_GA_CONTRACT_LIMIT);
    let after = cursor
        .map(super::decode_cursor::<GaContractCursor>)
        .transpose()?
        .map(|cursor| cursor.contract_id);

    // The sort key as a row expression, written over a bare alias so the page
    // (`k`) and the seek (`x`) spell it identically. Every one ends in the
    // unique `contract_id`.
    let key = |alias: &str| match order {
        GaContractOrder::Register => {
            format!("{alias}.sort_order, {alias}.starts_on, {alias}.contract_id")
        }
        GaContractOrder::Site => format!(
            "COALESCE({alias}.site_id, ''), {alias}.sort_order, {alias}.starts_on, \
             {alias}.contract_id"
        ),
    };
    let (page_key, seek_key) = (key("k"), key("x"));

    let search = ga_contract_search();
    // The billed total rides the page and nothing else, exactly as the asset
    // register carries its acquisition trail: the aggregate is a correlated
    // subquery ON THE PAGE, where the LIMIT has already cut the register down.
    let billed = billed_select("k");
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({search}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {GA_CONTRACT_FILTERS}
         )
         SELECT k.*, {billed} AS billed_minor FROM kept k
          WHERE $8::uuid IS NULL
             OR ({page_key}) > (SELECT {seek_key} FROM kept x WHERE x.contract_id = $8)
          ORDER BY {page_key}
          LIMIT $9"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(scope.today)
        .bind(&types)
        .bind(&groups)
        .bind(&sites)
        .bind(&standings)
        .bind(scope.archived)
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let out = rows
        .iter()
        .map(|row| to_ga_contract(row, scope.today))
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = match out.last() {
        Some(last) if out.len() as i64 == limit => Some(super::encode_cursor(&GaContractCursor {
            contract_id: last.contract_id,
        })?),
        _ => None,
    };
    let (total, facets) = ga_contract_facets(pool, &scope, needle.as_deref()).await?;
    let summary = ga_contract_summary(pool, &scope, needle.as_deref()).await?;
    Ok(GaContractPage {
        rows: out,
        next_cursor,
        total,
        facets,
        summary,
    })
}

/// The strip's figures over every contract the scope matches.
async fn ga_contract_summary(
    pool: &PgPool,
    scope: &GaContractScope,
    needle: Option<&str>,
) -> Result<GaContractSummary, AppError> {
    let types = (!scope.types.is_empty()).then(|| scope.types.clone());
    let groups = (!scope.groups.is_empty()).then(|| scope.groups.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let standings = (!scope.standings.is_empty()).then(|| scope.standings.clone());
    let search = ga_contract_search();
    let billed = billed_select("k");
    let sql = format!(
        "WITH searched AS ({search}),
              kept AS (
             SELECT * FROM searched WHERE {GA_CONTRACT_FILTERS}
         )
         SELECT
             COUNT(*) FILTER (WHERE k.standing IN ('AKTIF', 'SEGERA_HABIS')) AS active,
             COUNT(*) FILTER (WHERE k.standing IN ('SEGERA_HABIS', 'HABIS')) AS renew,
             COALESCE(SUM(k.contract_value_minor)
                 FILTER (WHERE k.standing IN ('AKTIF', 'SEGERA_HABIS')), 0)::bigint
                 AS active_value,
             COALESCE(SUM(b.billed)
                 FILTER (WHERE $4::text[] IS NOT NULL OR k.group_code <> 'DISEWAKAN'), 0)::bigint
                 AS billed
           FROM kept k
           CROSS JOIN LATERAL (SELECT {billed} AS billed) b"
    );
    let row = sqlx::query(&sql)
        .bind(needle)
        .bind(scope.today)
        .bind(&types)
        .bind(&groups)
        .bind(&sites)
        .bind(&standings)
        .bind(scope.archived)
        .fetch_one(pool)
        .await?;
    Ok(GaContractSummary {
        active: row.try_get("active")?,
        due_for_renewal: row.try_get("renew")?,
        active_value_minor: row.try_get("active_value")?,
        billed_minor: row.try_get("billed")?,
    })
}

/// How many contracts there are and how they split.
///
/// The per-value counts read the SEARCHED set, ignoring what is currently
/// filtered — the same argument `ga_asset_facets` makes: a number beside a
/// value answers "how many of these there are", while `total` describes the
/// list on screen.
async fn ga_contract_facets(
    pool: &PgPool,
    scope: &GaContractScope,
    needle: Option<&str>,
) -> Result<(i64, GaContractFacets), AppError> {
    let types = (!scope.types.is_empty()).then(|| scope.types.clone());
    let groups = (!scope.groups.is_empty()).then(|| scope.groups.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let standings = (!scope.standings.is_empty()).then(|| scope.standings.clone());
    let search = ga_contract_search();
    let sql = format!(
        "WITH searched AS ({search}),
              kept AS (
             SELECT * FROM searched WHERE {GA_CONTRACT_FILTERS}
         )
         SELECT 'type' AS kind, s.contract_type AS value,
                MIN(s.contract_type_name) AS label, COUNT(*)::bigint AS n
           FROM searched s GROUP BY s.contract_type
          UNION ALL
         SELECT 'group', s.group_code, NULL::text, COUNT(*)::bigint
           FROM searched s GROUP BY s.group_code
          UNION ALL
         SELECT 'site', s.site_id, MIN(s.site_name), COUNT(*)::bigint
           FROM searched s
          WHERE s.site_id IS NOT NULL
          GROUP BY s.site_id
          UNION ALL
         SELECT 'standing', s.standing, NULL::text, COUNT(*)::bigint
           FROM searched s GROUP BY s.standing
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(scope.today)
        .bind(&types)
        .bind(&groups)
        .bind(&sites)
        .bind(&standings)
        .bind(scope.archived)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = GaContractFacets {
        types: Vec::new(),
        groups: Vec::new(),
        sites: Vec::new(),
        standings: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let count: i64 = row.try_get("n")?;
        let facet = GaContractFacet {
            value,
            label,
            count,
        };
        match kind.as_str() {
            "type" => facets.types.push(facet),
            "group" => facets.groups.push(facet),
            "site" => facets.sites.push(facet),
            "standing" => facets.standings.push(facet),
            _ => total = count,
        }
    }
    // Biggest first, ties on the value so the order is stable between calls —
    // a list that reshuffles under somebody's finger is a list nobody can click.
    for list in [
        &mut facets.types,
        &mut facets.groups,
        &mut facets.sites,
        &mut facets.standings,
    ] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((total, facets))
}

/// One contract, as GA reads it, against the business clock's day.
pub async fn ga_contract_on(
    pool: &PgPool,
    contract_id: Uuid,
    today: NaiveDate,
) -> Result<GaContractRow, AppError> {
    let search = ga_contract_search();
    let billed = billed_select("q");
    let sql = format!(
        "SELECT q.*, {billed} AS billed_minor
           FROM ({search}) q
          WHERE q.contract_id = $3"
    );
    let row = sqlx::query(&sql)
        .bind(Option::<String>::None)
        .bind(today)
        .bind(contract_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("contract".into()))?;
    to_ga_contract(&row, today)
}

/// One contract, its bills, its meters, its templates and its papers, against
/// the business clock's day.
pub async fn ga_contract_hub_on(
    pool: &PgPool,
    contract_id: Uuid,
    today: NaiveDate,
) -> Result<GaContractHub, AppError> {
    let contract = ga_contract_on(pool, contract_id, today).await?;
    let bills = ga_contract_bills(pool, contract_id).await?;
    let meter_readings = ga_contract_meter_readings(pool, contract_id).await?;

    let template_rows = sqlx::query(
        "SELECT template_id, label, expected_subtotal_minor, tolerance_bps, due_day, active
           FROM bill_template
          WHERE contract_id = $1
          ORDER BY active DESC, label",
    )
    .bind(contract_id)
    .fetch_all(pool)
    .await?;
    let templates = template_rows
        .iter()
        .map(|row| {
            Ok(GaContractTemplate {
                template_id: row.try_get("template_id")?,
                label: row.try_get("label")?,
                expected_subtotal_minor: row.try_get("expected_subtotal_minor")?,
                tolerance_bps: row.try_get("tolerance_bps")?,
                due_day: row.try_get("due_day")?,
                active: row.try_get("active")?,
            })
        })
        .collect::<Result<Vec<GaContractTemplate>, AppError>>()?;

    // The papers come through `document_link`, whose subject is
    // `('contract', <the id as text>)` — 0190's one vocabulary, which 0360
    // taught the word `contract`.
    let document_rows = sqlx::query(
        "SELECT d.document_id, d.name, d.title, d.doc_type, d.doc_number, d.issuer,
                d.issued_on, d.expires_on, f.available
           FROM document d
           JOIN stored_file f ON f.file_id = d.file_id
           JOIN document_link l ON l.document_id = d.document_id
          WHERE l.subject_kind = 'contract' AND l.subject_id = $1::text
          ORDER BY d.expires_on NULLS LAST, d.created_at DESC",
    )
    .bind(contract_id)
    .fetch_all(pool)
    .await?;
    let documents = document_rows
        .iter()
        .map(|row| {
            Ok(GaDocument {
                document_id: row.try_get("document_id")?,
                name: row.try_get("name")?,
                title: row.try_get("title")?,
                doc_type: row.try_get("doc_type")?,
                doc_number: row.try_get("doc_number")?,
                issuer: row.try_get("issuer")?,
                issued_on: row.try_get("issued_on")?,
                expires_on: row.try_get("expires_on")?,
                available: row.try_get("available")?,
            })
        })
        .collect::<Result<Vec<GaDocument>, AppError>>()?;

    Ok(GaContractHub {
        contract,
        bills,
        meter_readings,
        templates,
        documents,
    })
}

/// The POSTED bills pointing at the contract, one row per line (0370's
/// `contract_id` on the line). A held bill is still here: a hold stops payment,
/// not the debt, which is why the hub and the ageing both count it.
async fn ga_contract_bills(
    pool: &PgPool,
    contract_id: Uuid,
) -> Result<Vec<GaContractBill>, AppError> {
    let rows = sqlx::query(
        "SELECT i.invoice_id, i.invoice_number, i.invoice_date,
                l.amount_minor, l.account_code, i.status
           FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i ON i.invoice_id = l.invoice_id
          WHERE l.contract_id = $1 AND i.status = 'POSTED'
          ORDER BY i.invoice_date, i.invoice_number",
    )
    .bind(contract_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(GaContractBill {
                invoice_id: row.try_get("invoice_id")?,
                invoice_number: row.try_get("invoice_number")?,
                invoice_date: row.try_get("invoice_date")?,
                amount_minor: row.try_get("amount_minor")?,
                account_code: row.try_get("account_code")?,
                status: row.try_get("status")?,
            })
        })
        .collect()
}

/// One meaning's qualifier→account rows at one site, as a plain map.
async fn mapped_accounts(
    pool: &PgPool,
    site_id: &str,
    semantic_key: &str,
    qualifiers: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let rows = sqlx::query(
        "SELECT source_id AS qualifier, account_code FROM account_resolution
          WHERE role = $1 AND site_id = $2 AND source_type = 'COMPANY'
            AND source_id = ANY($3)",
    )
    .bind(semantic_key)
    .bind(site_id)
    .bind(qualifiers)
    .fetch_all(pool)
    .await?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        map.insert(
            row.try_get::<String, _>("qualifier")?,
            row.try_get::<String, _>("account_code")?,
        );
    }
    Ok(map)
}

/// The seventeen types, with the accounts they resolve to at one site.
///
/// The map is per site and the codes are the map's answers AT that site, so
/// the endpoint names the site: without it, "which account" has no answer
/// this estate is willing to guess. The prepaid side is paired through
/// `domain::ga::CONTRACT_PREPAID_KINDS`, because `prepaid_expense` speaks the
/// `prepaid_kind` vocabulary, not the contract-type one — and the pairing is
/// the constant's job, done here in Rust, where it is spelled exactly once.
pub async fn ga_contract_types(
    pool: &PgPool,
    site_id: &str,
) -> Result<Vec<GaContractType>, AppError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(site_id)
        .fetch_one(pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound("site".into()));
    }

    let rows = sqlx::query(
        "SELECT code, name, group_code, sort_order FROM contract_type
          ORDER BY sort_order",
    )
    .fetch_all(pool)
    .await?;

    let prepaid_kinds: Vec<String> = CONTRACT_PREPAID_KINDS
        .iter()
        .map(|(_, kind)| (*kind).to_string())
        .collect();
    let prepaid = mapped_accounts(pool, site_id, "prepaid_expense", prepaid_kinds).await?;
    let all_types: Vec<String> = CONTRACT_TYPES
        .iter()
        .map(|(code, _, _)| (*code).to_string())
        .collect();
    let expense = mapped_accounts(pool, site_id, "contract_expense", all_types.clone()).await?;
    let income = mapped_accounts(pool, site_id, "contract_income", all_types).await?;

    rows.iter()
        .map(|row| {
            let code: String = row.try_get("code")?;
            let prepaid_kind = CONTRACT_PREPAID_KINDS
                .iter()
                .find(|(of_type, _)| *of_type == code)
                .map(|(_, kind)| (*kind).to_string());
            Ok(GaContractType {
                prepaid_account_code: prepaid_kind.and_then(|kind| prepaid.get(&kind).cloned()),
                expense_account_code: expense.get(&code).cloned(),
                income_account_code: income.get(&code).cloned(),
                code,
                name: row.try_get("name")?,
                group_code: row.try_get("group_code")?,
                sort_order: row.try_get("sort_order")?,
            })
        })
        .collect()
}

/// The status ladder, in one place: DRAFT activates, ACTIVE terminates, and
/// TERMINATED stays. The refusal says which way the window moves.
fn assert_status_change(from: &str, to: &str) -> Result<String, AppError> {
    let wanted = to.trim().to_ascii_uppercase();
    let legal = match from {
        "DRAFT" => matches!(wanted.as_str(), "DRAFT" | "ACTIVE"),
        "ACTIVE" => matches!(wanted.as_str(), "ACTIVE" | "TERMINATED"),
        // A terminated deal stays terminated; the register's history is the
        // point of it.
        _ => wanted == from,
    };
    if !legal {
        return Err(AppError::Validation(format!(
            "a {from} contract does not become {wanted}; the window moves one way: DRAFT to \
             ACTIVE to TERMINATED"
        )));
    }
    Ok(wanted)
}

/// Put a deal in the register.
///
/// The shape is checked in words before the database gets a chance to refuse
/// in constraint names. The row starts DRAFT: a deal is ACTIVE when somebody
/// says the paper is signed and running, which is a decision, not a default.
pub async fn ga_contract_record(
    pool: &PgPool,
    request: &RecordGaContractRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaContractRow, AppError> {
    let contract_type = assert_contract_type(&request.contract_type)?;
    assert_contract_shape(
        pool,
        &contract_type,
        request.objek.as_deref(),
        request.supplier_id,
        request.counterparty_name.as_deref(),
        request.site_id.as_deref(),
        request.site_scope.as_deref(),
        request.starts_on,
        request.ends_on,
        request.contract_value_minor,
    )
    .await?;
    if request.reminder_days < 0 {
        return Err(AppError::Validation(
            "reminder_days is how far ahead the contract wants itself remembered; it \
             cannot be negative".into(),
        ));
    }

    let row = sqlx::query(&format!(
        "WITH written AS (
             INSERT INTO ga_contract
               (contract_number, contract_type, objek, supplier_id, counterparty_name,
                site_id, site_scope, asset_id, starts_on, ends_on, contract_value_minor,
                is_signed, signed_by, customer_number, reminder_days, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             {GA_CONTRACT_RETURNING}
         )
         {GA_WRITTEN_SHAPE}"
    ))
    .bind(nothing_if_blank(request.contract_number.as_deref()))
    .bind(&contract_type)
    .bind(nothing_if_blank(request.objek.as_deref()))
    .bind(request.supplier_id)
    .bind(nothing_if_blank(request.counterparty_name.as_deref()))
    .bind(
        request
            .site_id
            .as_deref()
            .map(str::trim)
            .filter(|site| !site.is_empty()),
    )
    .bind(nothing_if_blank(request.site_scope.as_deref()))
    .bind(request.asset_id)
    .bind(request.starts_on)
    .bind(request.ends_on)
    .bind(request.contract_value_minor)
    .bind(request.is_signed)
    .bind(nothing_if_blank(request.signed_by.as_deref()))
    .bind(nothing_if_blank(request.customer_number.as_deref()))
    .bind(request.reminder_days)
    .bind(nothing_if_blank(request.notes.as_deref()))
    .bind(actor)
    .fetch_one(pool)
    .await?;

    to_ga_contract(&row, today)
}

/// Correct what GA knows about a deal.
///
/// The whole shape is re-checked on the PROPOSED state, not the delta — the
/// same rule `ga_asset_update` keeps: a correction that would leave the row
/// illegal is refused in words, whichever half of the edit made it so.
pub async fn ga_contract_update(
    pool: &PgPool,
    contract_id: Uuid,
    request: &UpdateGaContractRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaContractRow, AppError> {
    let mut tx = pool.begin().await?;
    let current: sqlx::postgres::PgRow = sqlx::query(
        "SELECT contract_number, contract_type, objek, supplier_id, counterparty_name,
                site_id, site_scope, asset_id, starts_on, ends_on, contract_value_minor,
                is_signed, signed_by, customer_number, reminder_days, notes, status, archived
           FROM ga_contract
          WHERE contract_id = $1
          FOR UPDATE",
    )
    .bind(contract_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::NotFound("contract".into()))?;

    if current.try_get::<bool, _>("archived")? {
        return Err(AppError::Conflict(
            "this contract is archived; bring it back before correcting it".into(),
        ));
    }

    // A cleared text field is `""`; an absent one leaves what is there — the
    // `NULLIF(btrim(…), '')` convention `ga_asset_update` keeps.
    let text_or = |column: &str, given: Option<&str>| -> Result<Option<String>, AppError> {
        Ok(match given {
            Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
            None => current.try_get::<Option<String>, _>(column)?,
        })
    };

    let contract_number = text_or("contract_number", request.contract_number.as_deref())?;
    let contract_type = match &request.contract_type {
        Some(raw) => assert_contract_type(raw)?,
        None => current.try_get::<String, _>("contract_type")?,
    };

    // One party: naming one side drops the other, which is what the CHECK
    // would insist on anyway — said here in words, applied below in SETs.
    let supplier_id = match (&request.supplier_id, &request.counterparty_name) {
        (Some(id), _) => Some(*id),
        (None, Some(_)) => None,
        (None, None) => current.try_get("supplier_id")?,
    };
    let counterparty_name = match (&request.supplier_id, &request.counterparty_name) {
        (Some(_), _) => None,
        (None, Some(_)) => nothing_if_blank(Some(request.counterparty_name.as_deref().unwrap_or("")))
            .map(str::to_string),
        (None, None) => current.try_get("counterparty_name")?,
    };

    // One coverage, with the same rule.
    let site_id = match (&request.site_id, &request.site_scope) {
        (Some(site), _) => Some(site.trim().to_string()),
        (None, Some(_)) => None,
        (None, None) => current.try_get::<Option<String>, _>("site_id")?,
    };
    let site_scope = match (&request.site_id, &request.site_scope) {
        (Some(_), _) => None,
        (None, Some(word)) => Some(assert_site_scope(word)?),
        (None, None) => current.try_get::<Option<String>, _>("site_scope")?,
    };

    let objek = match &request.objek {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => current.try_get("objek")?,
    };
    let starts_on = request.starts_on.unwrap_or(current.try_get("starts_on")?);
    let ends_on = match request.ends_on {
        Some(end) => Some(end),
        None => current.try_get("ends_on")?,
    };
    let contract_value_minor = match request.contract_value_minor {
        Some(value) => Some(value),
        None => current.try_get("contract_value_minor")?,
    };
    let asset_id = match request.asset_id {
        Some(id) => Some(id),
        None => current.try_get("asset_id")?,
    };
    let is_signed = request.is_signed.unwrap_or(current.try_get("is_signed")?);
    let signed_by = text_or("signed_by", request.signed_by.as_deref())?;
    let customer_number = text_or("customer_number", request.customer_number.as_deref())?;
    let reminder_days = request
        .reminder_days
        .unwrap_or(current.try_get("reminder_days")?);
    if reminder_days < 0 {
        return Err(AppError::Validation(
            "reminder_days is how far ahead the contract wants itself remembered; it \
             cannot be negative".into(),
        ));
    }
    let notes = text_or("notes", request.notes.as_deref())?;
    let status = match &request.status {
        Some(wanted) => assert_status_change(current.try_get("status")?, wanted)?,
        None => current.try_get::<String, _>("status")?,
    };

    assert_contract_shape(
        pool,
        &contract_type,
        objek.as_deref(),
        supplier_id,
        counterparty_name.as_deref(),
        site_id.as_deref(),
        site_scope.as_deref(),
        starts_on,
        ends_on,
        contract_value_minor,
    )
    .await?;

    let row = sqlx::query(&format!(
        "WITH written AS (
             UPDATE ga_contract
                SET contract_number = $2,
                    contract_type = $3,
                    objek = $4,
                    supplier_id = $5,
                    counterparty_name = $6,
                    site_id = $7,
                    site_scope = $8,
                    asset_id = $9,
                    starts_on = $10,
                    ends_on = $11,
                    contract_value_minor = $12,
                    is_signed = $13,
                    signed_by = $14,
                    customer_number = $15,
                    reminder_days = $16,
                    notes = $17,
                    status = $18,
                    updated_by = $19,
                    updated_at = now(),
                    version = version + 1
              WHERE contract_id = $1
             {GA_CONTRACT_RETURNING}
         )
         {GA_WRITTEN_SHAPE}"
    ))
    .bind(contract_id)
    .bind(contract_number.as_deref())
    .bind(&contract_type)
    .bind(objek.as_deref())
    .bind(supplier_id)
    .bind(counterparty_name.as_deref())
    .bind(site_id.as_deref())
    .bind(site_scope.as_deref())
    .bind(asset_id)
    .bind(starts_on)
    .bind(ends_on)
    .bind(contract_value_minor)
    .bind(is_signed)
    .bind(signed_by.as_deref())
    .bind(customer_number.as_deref())
    .bind(reminder_days)
    .bind(notes.as_deref())
    .bind(&status)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    to_ga_contract(&row, today)
}

/// Archive, or bring back — with the reason appended to the notes, because
/// "why is this lease in the archive" is the question the notes exist to
/// answer, and a separate column nobody reads is not an answer.
///
/// A TERMINATED contract archives like any other: the deal ended, the paper
/// stays findable.
pub async fn ga_contract_archive(
    pool: &PgPool,
    contract_id: Uuid,
    request: &ArchiveGaContractRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaContractRow, AppError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "archiving says why: the reason is what somebody reads when they find the \
             row gone from the list".into(),
        ));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM ga_contract WHERE contract_id = $1)",
    )
    .bind(contract_id)
    .fetch_one(pool)
    .await?;
    if !exists {
        return Err(AppError::NotFound("contract".into()));
    }

    let word = if request.archived {
        "Diarsipkan"
    } else {
        "Dikembalikan"
    };
    let note = format!("{word} ({today}) oleh {actor}: {reason}");
    let row = sqlx::query(&format!(
        "WITH written AS (
             UPDATE ga_contract
                SET archived = $2,
                    notes = btrim(coalesce(notes, '') || ' ' || $3),
                    updated_by = $4,
                    updated_at = now(),
                    version = version + 1
              WHERE contract_id = $1
             {GA_CONTRACT_RETURNING}
         )
         {GA_WRITTEN_SHAPE}"
    ))
    .bind(contract_id)
    .bind(request.archived)
    .bind(&note)
    .bind(actor)
    .fetch_one(pool)
    .await?;

    to_ga_contract(&row, today)
}

/// The contract's meter history, newest month first.
pub async fn ga_contract_meter_readings(
    pool: &PgPool,
    contract_id: Uuid,
) -> Result<Vec<GaMeterReading>, AppError> {
    let rows = sqlx::query(
        "SELECT reading_id, contract_id, period, unit, opening, closing, read_on, recorded_by
           FROM ga_meter_reading
          WHERE contract_id = $1
          ORDER BY period DESC",
    )
    .bind(contract_id)
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_ga_meter_reading).collect()
}

fn to_ga_meter_reading(row: &sqlx::postgres::PgRow) -> Result<GaMeterReading, AppError> {
    let opening: i64 = row.try_get("opening")?;
    let closing: i64 = row.try_get("closing")?;
    Ok(GaMeterReading {
        reading_id: row.try_get("reading_id")?,
        contract_id: row.try_get("contract_id")?,
        period: row.try_get("period")?,
        unit: row.try_get("unit")?,
        opening,
        closing,
        usage: closing - opening,
        read_on: row.try_get("read_on")?,
        recorded_by: row.try_get("recorded_by")?,
    })
}

/// Record one month's meter — or correct one that was mis-typed.
///
/// The upsert is the correction path and is deliberate: a reading typed
/// wrong on Monday and fixed on Friday is ONE month's reading with a truer
/// number, and a second row for the same period would make "what did we use
/// in March" a question with two answers. The UNIQUE (contract_id, period)
/// says the same thing at the bottom.
pub async fn ga_meter_reading_record(
    pool: &PgPool,
    contract_id: Uuid,
    request: &RecordMeterReadingRequest,
    actor: &str,
) -> Result<GaMeterReading, AppError> {
    let live: Option<bool> = sqlx::query_scalar(
        "SELECT NOT archived FROM ga_contract WHERE contract_id = $1",
    )
    .bind(contract_id)
    .fetch_optional(pool)
    .await?;
    match live {
        None => return Err(AppError::NotFound("contract".into())),
        Some(false) => {
            return Err(AppError::Conflict(
                "this contract is archived; its meter stopped being read when the deal did".into(),
            ));
        }
        Some(true) => {}
    }

    if request.period.day() != 1 {
        return Err(AppError::Validation(
            "a reading measures a MONTH: give its first day, and the meter tells the rest".into(),
        ));
    }
    let unit = request.unit.trim();
    if unit.is_empty() {
        return Err(AppError::Validation(
            "a reading carries the meter's own unit — kWh, m³ — because a number \
             without a unit is a guess at what was measured".into(),
        ));
    }
    if request.closing < request.opening {
        return Err(AppError::Validation(format!(
            "closing {} is below opening {}; a meter runs forward, and a number that went \
             down is a meter swap a person enters knowing why",
            request.closing, request.opening
        )));
    }

    let row = sqlx::query(
        "INSERT INTO ga_meter_reading
           (contract_id, period, unit, opening, closing, read_on, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (contract_id, period) DO UPDATE
            SET unit = EXCLUDED.unit,
                opening = EXCLUDED.opening,
                closing = EXCLUDED.closing,
                read_on = EXCLUDED.read_on,
                recorded_by = EXCLUDED.recorded_by,
                recorded_at = now()
       RETURNING reading_id, contract_id, period, unit, opening, closing, read_on, recorded_by",
    )
    .bind(contract_id)
    .bind(request.period)
    .bind(unit)
    .bind(request.opening)
    .bind(request.closing)
    .bind(request.read_on)
    .bind(actor)
    .fetch_one(pool)
    .await?;
    to_ga_meter_reading(&row)
}
