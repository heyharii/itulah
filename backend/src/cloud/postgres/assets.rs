//! The asset register, the decision to capitalise, and the monthly run.
//!
//! The arithmetic is in `domain::depreciation` and is pure. This module reads
//! the facts it needs, calls it once per asset, and posts what it says.
//!
//! # Two questions, two tables
//!
//! `fixed_asset` is what Operations knows: what the thing is, where it is, what
//! delivery it came from. It carries no money at all. `asset_capitalization` is
//! what Finance decided: whether it belongs in the books, at what number, over
//! how long. Keeping them apart is what lets a warehouse register a laptop the
//! day it arrives without anybody having decided yet whether it is capital.
//!
//! # The category is the client's own account family
//!
//! There is no category register here. An asset's category is a family under
//! `10215`, and the two accounts a depreciation entry needs — the accumulated
//! account under `10216` and the expense account under `70102` — are resolved
//! through `account_map` with the category as the qualifier. The client's chart
//! already lists the seven kinds; a second list would be a second authority.

use super::ledger::resolve_account;
use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    monthly_charge, Basis, ChargeKind, DepreciationMethod, Outcome, SkipReason,
};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// An asset as both halves know it: Operations' identity, and the treatment in
/// force if Finance has decided one.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetRow {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub category_code: String,
    /// The client's own name for the category family.
    pub category_name: String,
    pub site_id: String,
    pub status: String,
    pub serial_number: Option<String>,
    pub acquired_on: NaiveDate,
    /// How many things this row is. 1 for one object; the client's register
    /// keeps lots, and 60,000 sensor pins are one row rather than 60,000.
    pub quantity: i32,

    /// `CAPITALIZE`, `EXPENSE`, or absent when nobody has assessed it.
    ///
    /// Absent is a real state and not a default: "not assessed" is an open
    /// control gap, "assessed and expensed" is a closed one, and a screen that
    /// could not tell them apart would hide the first behind the second.
    pub decision: Option<String>,
    pub capitalized_cost_minor: Option<i64>,
    pub salvage_value_minor: Option<i64>,
    pub useful_life_months: Option<i32>,
    pub method: Option<String>,
    /// `DEPRECIATION`, `REPLACEMENT_RESERVE` or `AMORTISATION` — what the
    /// monthly charge is CALLED, and therefore which pair of accounts it lands
    /// in. Absent exactly when `decision` is, or when the decision was to
    /// expense: an expensed asset has no monthly charge to name.
    pub charge_kind: Option<String>,
    pub in_service_on: Option<NaiveDate>,

    /// Summed from the depreciation entries. Not stored anywhere.
    pub accumulated_minor: i64,
    /// Cost less accumulated. Derived on read for the same reason.
    pub book_value_minor: Option<i64>,
    /// The latest month the run actually charged, named by its first day.
    ///
    /// Absent means nothing has ever been charged, which is a real state and
    /// not a zero: a land asset never charges, an asset capitalised last week
    /// has not been reached yet, and an asset the run has been silently
    /// skipping for four months looks exactly like both until this says so.
    /// It is what lets a screen say "charged through August" instead of making
    /// somebody open the schedule to find out.
    pub last_depreciated_month: Option<NaiveDate>,

    /// Every bill line that bought this, as `PLN-0901 line 2, PLN-0912 line 1`,
    /// when the books bought it at all.
    ///
    /// Plural since 0160. One air conditioner at this client is a unit, an
    /// installation charge and sometimes an earlier payment — three lines and
    /// one thing — so a field that could name only one of them was showing a
    /// third of the answer and looking complete.
    ///
    /// Absent is the ordinary state for an asset the company already owned when
    /// this system arrived, and it is an EXCEPTION for one that was
    /// capitalised here: `fixed_asset` has no acquisition posting rule and
    /// never will — the acquisition is a supplier bill — so an asset with no
    /// line is an asset the books never bought. `acquisition_gap` lists them.
    pub acquired_via: Option<String>,

    /// Set once the asset has left the books.
    pub disposed_on: Option<NaiveDate>,
    /// `SOLD` or `WRITTEN_OFF`.
    pub disposal_method: Option<String>,
    pub disposal_proceeds_minor: Option<i64>,
    pub disposal_journal_entry_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RegisterAssetRequest {
    pub asset_number: String,
    pub name: String,
    /// A family under `10215`, or under `10217` for an intangible.
    pub category_code: String,
    pub site_id: String,
    pub acquired_on: NaiveDate,
    pub serial_number: Option<String>,
    pub notes: Option<String>,
    /// How many things this row is. Absent means one, which is the ordinary
    /// case; a lot is what the client's register keeps for hangers and pins.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub quantity: Option<i32>,
    /// The expense-bill line that bought it, when there is one. Optional
    /// because most assets on day one predate this system, and because the
    /// bill often arrives after the warehouse has registered the thing.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub acquired_via_line_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssessAssetRequest {
    /// `CAPITALIZE` or `EXPENSE`.
    pub decision: String,
    pub capitalized_cost_minor: Option<i64>,
    pub salvage_value_minor: Option<i64>,
    pub useful_life_months: Option<i32>,
    pub method: Option<String>,
    /// `DEPRECIATION`, `REPLACEMENT_RESERVE` or `AMORTISATION`.
    ///
    /// Required on CAPITALIZE and refused on EXPENSE, which is how the rest of
    /// the basis behaves and for the same reason. It is asked rather than
    /// inferred from the category, because inferring it would mean a posting
    /// rule choosing accounts from a client account code — see 0159.
    pub charge_kind: Option<String>,
    pub in_service_on: Option<NaiveDate>,
    /// Why. Required on both decisions — an expensed asset with no reason is
    /// the one somebody queries a year later.
    pub reason: String,
    /// The expense-bill line that bought it. Accepted here as well as at
    /// registration because the bill usually arrives after the thing does, and
    /// because this is the moment a cost is named — which is the moment the
    /// two figures can be checked against each other.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub acquired_via_line_id: Option<Uuid>,
    /// The other lines that bought it, when a purchase took more than one.
    ///
    /// Added alongside the singular rather than replacing it because the
    /// ordinary purchase is still one line, and because every caller that
    /// names one line should keep working. Both are accepted and the union is
    /// what gets attached.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub acquired_via_line_ids: Option<Vec<Uuid>>,
}

const ASSET_COLUMNS: &str = "a.asset_id, a.asset_number, a.name, a.category_code,
     c.name AS category_name, a.site_id, a.status, a.serial_number, a.acquired_on,
     a.quantity,
     a.disposed_on, a.disposal_method, a.disposal_proceeds_minor, a.disposal_journal_entry_id,
     k.decision, k.capitalized_cost_minor, k.salvage_value_minor, k.useful_life_months,
     k.method, k.charge_kind, k.in_service_on,
     COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                WHERE d.asset_id = a.asset_id), 0)::bigint AS accumulated,
     (SELECT MAX(d.period_month) FROM asset_depreciation_entry d
       WHERE d.asset_id = a.asset_id) AS last_depreciated_month,
     (SELECT string_agg(si.invoice_number || ' line ' || bl.line_number, ', '
                        ORDER BY si.invoice_date, si.invoice_number, bl.line_number)
        FROM supplier_invoice_expense_line bl
        JOIN supplier_invoice si USING (invoice_id)
       WHERE bl.asset_id = a.asset_id) AS acquired_via";

/// The assessment in force is the highest sequence. A lateral join rather than
/// a window, so the planner can stop at the first row per asset.
const IN_FORCE: &str = "LEFT JOIN LATERAL (
         SELECT * FROM asset_capitalization x
          WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
     ) k ON true";

fn to_asset(row: &sqlx::postgres::PgRow) -> Result<AssetRow, AppError> {
    let cost: Option<i64> = row.try_get("capitalized_cost_minor")?;
    let accumulated: i64 = row.try_get("accumulated")?;
    Ok(AssetRow {
        asset_id: row.try_get("asset_id")?,
        asset_number: row.try_get("asset_number")?,
        name: row.try_get("name")?,
        category_code: row.try_get("category_code")?,
        category_name: row.try_get("category_name")?,
        site_id: row.try_get("site_id")?,
        status: row.try_get("status")?,
        serial_number: row.try_get("serial_number")?,
        acquired_on: row.try_get("acquired_on")?,
        quantity: row.try_get("quantity")?,
        decision: row.try_get("decision")?,
        capitalized_cost_minor: cost,
        salvage_value_minor: row.try_get("salvage_value_minor")?,
        useful_life_months: row.try_get("useful_life_months")?,
        method: row.try_get("method")?,
        charge_kind: row.try_get("charge_kind")?,
        in_service_on: row.try_get("in_service_on")?,
        accumulated_minor: accumulated,
        book_value_minor: cost.map(|c| c - accumulated),
        last_depreciated_month: row.try_get("last_depreciated_month")?,
        acquired_via: row.try_get("acquired_via")?,
        disposed_on: row.try_get("disposed_on")?,
        disposal_method: row.try_get("disposal_method")?,
        disposal_proceeds_minor: row.try_get("disposal_proceeds_minor")?,
        disposal_journal_entry_id: row.try_get("disposal_journal_entry_id")?,
    })
}

pub async fn list_assets(
    pool: &PgPool,
    site_id: Option<&str>,
    category: Option<&str>,
    unassessed_only: bool,
    limit: i64,
) -> Result<Vec<AssetRow>, AppError> {
    let sql = format!(
        "SELECT {ASSET_COLUMNS}
           FROM fixed_asset a
           JOIN ledger_account c ON c.account_code = a.category_code
           {IN_FORCE}
          WHERE ($1::text IS NULL OR a.site_id = $1)
            AND ($2::text IS NULL OR a.category_code = $2)
            AND (NOT $3 OR k.decision IS NULL)
          ORDER BY a.asset_number
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(site_id)
        .bind(category)
        .bind(unassessed_only)
        .bind(limit.clamp(1, 1000))
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_asset).collect()
}

pub async fn asset(pool: &PgPool, asset_id: Uuid) -> Result<AssetRow, AppError> {
    let sql = format!(
        "SELECT {ASSET_COLUMNS} FROM fixed_asset a
           JOIN ledger_account c ON c.account_code = a.category_code
           {IN_FORCE} WHERE a.asset_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(asset_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("asset".into()))?;
    to_asset(&row)
}

/// The families an asset's COST hangs under in the client's own chart:
/// `10215 AKTIVA TETAP`, and `10217 INTANGIBLE ASSET` for the software they
/// amortise.
///
/// Named in Rust, which 0050 forbids for a POSTING RULE and permits here: this
/// is not choosing an account, it is recognising one. `register_asset` has
/// checked `10215` since 0070; 0159 widened it, because until then an
/// intangible could not be registered at all.
const ASSET_FAMILIES: [&str; 2] = ["10215", "10217"];

fn is_asset_account(code: &str) -> bool {
    ASSET_FAMILIES.iter().any(|family| code.starts_with(family))
}

/// Point one or more bill lines at this asset, refusing any that could not
/// have bought it.
///
/// One thing is asked of each line and it names its figures, because "invalid
/// acquisition line" is a message that sends somebody to read code: the line's
/// account is under `10215` or `10217`, so the money went into an asset family
/// rather than into an expense. A line already bought for a DIFFERENT asset is
/// refused too — that is somebody attaching the wrong receipt, and it would
/// silently move cost from one asset to another.
///
/// The posting status of the bill is deliberately NOT required. A draft bill is
/// a real document somebody is still checking, and refusing to link it would
/// mean the register could only ever catch up after Finance posts. What counts
/// as "the books bought it" is asked separately, by `acquisition_gap`, which
/// looks only at POSTED lines.
async fn attach_acquisition_lines(
    tx: &mut sqlx::PgConnection,
    asset_id: Uuid,
    line_ids: &[Uuid],
) -> Result<(), AppError> {
    for line_id in line_ids {
        let row = sqlx::query(
            "SELECT l.account_code, a.name AS account_name, l.asset_id,
                    i.invoice_number, l.line_number
               FROM supplier_invoice_expense_line l
               JOIN supplier_invoice i USING (invoice_id)
               JOIN ledger_account a ON a.account_code = l.account_code
              WHERE l.line_id = $1",
        )
        .bind(line_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("bill line {line_id}")))?;

        let account_code: String = row.try_get("account_code")?;
        let account_name: String = row.try_get("account_name")?;
        let invoice_number: String = row.try_get("invoice_number")?;
        let line_number: i32 = row.try_get("line_number")?;
        let claimed: Option<Uuid> = row.try_get("asset_id")?;

        if !is_asset_account(&account_code) {
            return Err(AppError::Validation(format!(
                "{invoice_number} line {line_number} is coded to {account_code} {account_name}, \
                 which is not an asset account; an acquisition is a bill line under 10215 AKTIVA \
                 TETAP or 10217 INTANGIBLE ASSET"
            )));
        }
        if let Some(other) = claimed {
            if other != asset_id {
                return Err(AppError::Validation(format!(
                    "{invoice_number} line {line_number} was already bought for asset {other}; \
                     one line buys one thing"
                )));
            }
        }
        sqlx::query("UPDATE supplier_invoice_expense_line SET asset_id = $2 WHERE line_id = $1")
            .bind(line_id)
            .bind(asset_id)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

/// Check that what the books paid for this asset is what Finance capitalised.
///
/// 0099 asked this of ONE line and its argument is unchanged: capitalised
/// above what the bill charged means the difference is in the books somewhere
/// else, and `fixed_asset` will not empty when the asset is disposed of. What
/// widened in 0160 is only the arithmetic — the client pays for a unit, its
/// installation, and sometimes an earlier deposit, and all three are the
/// acquisition of one air conditioner.
///
/// Silence when NOTHING is attached is deliberate, and is what 0070 and 0099
/// both argue for: an asset the company already owned when this system arrived
/// has no line behind it, and most of the register on day one is exactly that.
/// `acquisition_gap` is what reports those, as a list rather than a refusal.
async fn check_acquisition_total(
    tx: &mut sqlx::PgConnection,
    asset_id: Uuid,
    capitalized_cost_minor: i64,
) -> Result<(), AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(l.amount_minor), 0)::bigint AS paid, COUNT(*)::bigint AS lines,
                string_agg(i.invoice_number || ' line ' || l.line_number, ', '
                           ORDER BY i.invoice_number, l.line_number) AS named
           FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i USING (invoice_id)
          WHERE l.asset_id = $1",
    )
    .bind(asset_id)
    .fetch_one(&mut *tx)
    .await?;
    let paid: i64 = row.try_get("paid")?;
    let lines: i64 = row.try_get("lines")?;
    if lines == 0 {
        return Ok(());
    }
    if paid != capitalized_cost_minor {
        let named: String = row
            .try_get::<Option<String>, _>("named")?
            .unwrap_or_default();
        return Err(AppError::Validation(format!(
            "the books paid {paid} for this across {lines} line(s) — {named} — and it is \
             capitalised at {capitalized_cost_minor}; the difference is {}. Capitalise it at what \
             the bill charged, or name every line that bought it.",
            (paid - capitalized_cost_minor).abs()
        )));
    }
    Ok(())
}

pub async fn register_asset(
    pool: &PgPool,
    request: &RegisterAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    // The category must be a family the client actually keeps, under 10215.
    // Checked here so the message names the problem; the foreign key is the
    // guarantee.
    let category = request.category_code.trim();
    if !is_asset_account(category) {
        return Err(AppError::Validation(format!(
            "{category} is not an asset category; they are the families under \
             10215 AKTIVA TETAP and 10217 INTANGIBLE ASSET"
        )));
    }
    if let Some(quantity) = request.quantity {
        if quantity < 1 {
            return Err(AppError::Validation(
                "a lot is at least one thing; leave the quantity out for a single object".into(),
            ));
        }
    }
    let asset_id = Uuid::new_v4();
    // One transaction, and the asset is inserted BEFORE its line is attached:
    // the line's foreign key points here, so the other order cannot work. A
    // line that turns out not to be an asset purchase rolls the registration
    // back with it.
    //
    // No cost is known yet, so only the account is checked. What the books
    // paid is checked when Finance names a cost, in `assess_asset`.
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, acquired_on,
            serial_number, notes, registered_by, acquired_via_line_id, quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(asset_id)
    .bind(request.asset_number.trim())
    .bind(request.name.trim())
    .bind(category)
    .bind(&request.site_id)
    .bind(request.acquired_on)
    .bind(request.serial_number.as_deref())
    .bind(request.notes.as_deref())
    .bind(actor)
    .bind(request.acquired_via_line_id)
    .bind(request.quantity.unwrap_or(1))
    .execute(&mut *tx)
    .await?;
    if let Some(line_id) = request.acquired_via_line_id {
        attach_acquisition_lines(&mut tx, asset_id, &[line_id]).await?;
    }
    tx.commit().await?;
    asset(pool, asset_id).await
}

/// Record Finance's decision. Appended — the highest sequence is in force.
///
/// # Why CAPITALIZE posts nothing, and never will
///
/// It is tempting to have this write `Dr fixed_asset / Cr something` — it is,
/// after all, the moment a number is put on an asset. It must not, and the
/// reason is that there is no honest credit for it to write.
///
/// The company did not acquire the thing by deciding it was capital; it
/// acquired it by buying it from a supplier, and that purchase is already a
/// document that posts. 0094's expense bill debits whatever account its line
/// names, and class 1 is admitted precisely so a capital purchase can be coded
/// to a `10215*` account. The acquisition entry therefore already exists, with
/// a supplier and a payable behind it, the moment the bill is posted.
///
/// An assessment that also posted would double the cost. An assessment that
/// posted against a clearing account would put a line in the client's books
/// their own accountant cannot explain, since their chart has no such account —
/// the same argument 0052 makes about goods-received-not-invoiced.
///
/// So this records a decision and writes no journal, and the link below is what
/// ties the decision to the entry that already carries the money.
/// `acquisition_gap` reports where the link is missing in either direction.
pub async fn assess_asset(
    pool: &PgPool,
    asset_id: Uuid,
    request: &AssessAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "an assessment needs a reason; it is the only record of why".into(),
        ));
    }
    if let Some(raw) = request.method.as_deref() {
        if DepreciationMethod::parse(raw).is_none() {
            return Err(AppError::Validation(format!(
                "unknown method {raw}; expected STRAIGHT_LINE, DECLINING or NONE"
            )));
        }
    }

    // What the charge is CALLED is asked, never inferred, and a capitalised
    // asset may not leave it unsaid. Silence here would have to be resolved
    // into something, and the only available something is "depreciation" —
    // which is exactly the wrong answer for the 200 operating-equipment rows
    // the client's own register labels NON DEPRECIABLE while charging them
    // every month. 0159 has the whole argument.
    //
    // The message names the values because "violates check constraint
    // asset_capitalization_charge_kind_follows_decision" is not a sentence
    // anybody can act on.
    let capitalising = request.decision.trim() == "CAPITALIZE";
    let charge_kind = match request.charge_kind.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() => {
            if ChargeKind::parse(raw).is_none() {
                return Err(AppError::Validation(format!(
                    "unknown charge kind {raw}; expected DEPRECIATION, REPLACEMENT_RESERVE or \
                     AMORTISATION"
                )));
            }
            if !capitalising {
                return Err(AppError::Validation(
                    "an expensed asset has no monthly charge, so it names no charge kind".into(),
                ));
            }
            Some(raw)
        }
        _ if capitalising => {
            return Err(AppError::Validation(
                "say what the monthly charge is: DEPRECIATION, REPLACEMENT_RESERVE for operating \
                 equipment (the client's 1021607 is a reserve, not accumulated depreciation), or \
                 AMORTISATION for an intangible"
                    .into(),
            ))
        }
        _ => None,
    };

    sqlx::query("SELECT 1 FROM fixed_asset WHERE asset_id = $1")
        .bind(asset_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("asset".into()))?;

    // Both spellings, unioned. A caller that names one line and a caller that
    // names three are the same act, and the lines already attached from an
    // earlier assessment stay attached — the sum below counts all of them,
    // which is what makes "the books paid this" answerable at all.
    let mut named: Vec<Uuid> = request.acquired_via_line_ids.clone().unwrap_or_default();
    if let Some(one) = request.acquired_via_line_id {
        if !named.contains(&one) {
            named.push(one);
        }
    }

    // Everything from here is one transaction, so a cost that does not
    // reconcile leaves neither an assessment nor a half-attached bill. The
    // order matters: attach first, because the sum has to see the lines being
    // named now, not only the ones named before.
    let mut tx = pool.begin().await?;
    attach_acquisition_lines(&mut tx, asset_id, &named).await?;
    if capitalising {
        if let Some(cost) = request.capitalized_cost_minor {
            check_acquisition_total(&mut tx, asset_id, cost).await?;
        }
    }

    let next: i32 = sqlx::query(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM asset_capitalization WHERE asset_id = $1",
    )
    .bind(asset_id)
    .fetch_one(&mut *tx)
    .await?
    .try_get("next")?;

    sqlx::query(
        "INSERT INTO asset_capitalization
           (capitalization_id, asset_id, sequence, decision, capitalized_cost_minor,
            salvage_value_minor, useful_life_months, method, charge_kind, in_service_on,
            reason, assessed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(Uuid::new_v4())
    .bind(asset_id)
    .bind(next)
    .bind(request.decision.trim())
    .bind(request.capitalized_cost_minor)
    .bind(request.salvage_value_minor)
    .bind(request.useful_life_months)
    .bind(request.method.as_deref())
    .bind(charge_kind)
    .bind(request.in_service_on)
    .bind(request.reason.trim())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    // The display pointer, set after the assessment so a refused one leaves no
    // link behind. Never cleared: `None` means "not saying", not "detach it".
    // Since 0160 the truth is `supplier_invoice_expense_line.asset_id` and this
    // is the first line of it, kept because screens still read it.
    if let Some(line_id) = request.acquired_via_line_id {
        sqlx::query("UPDATE fixed_asset SET acquired_via_line_id = $2 WHERE asset_id = $1")
            .bind(asset_id)
            .bind(line_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    asset(pool, asset_id).await
}

/// What one month's run did, asset by asset.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepreciationLine {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub amount_minor: Option<i64>,
    /// Absent when something was posted. Present, and named, when it was not —
    /// a run report that says "nothing" without saying why is a report somebody
    /// has to re-derive by hand.
    pub skipped_because: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepreciationRun {
    pub period_month: NaiveDate,
    pub posted_count: i64,
    pub posted_total_minor: i64,
    pub skipped_count: i64,
    pub lines: Vec<DepreciationLine>,
}

fn skip_label(reason: SkipReason) -> &'static str {
    match reason {
        SkipReason::NotDepreciated => "not depreciated — the category has no method",
        SkipReason::FullyDepreciated => "already at salvage",
        SkipReason::NothingAboveSalvage => "cost is at or below salvage",
        SkipReason::NoUsefulLife => "no useful life",
        SkipReason::BelowSmallestUnit => "this month's share rounds to nothing",
    }
}

/// Months from one date to another, counting only whole months.
///
/// The period index the schedule needs: 0 for the month an asset went into
/// service, 1 for the next. Calendar arithmetic, so a quiet month still
/// advances it — which is the whole reason the index is not a count of entries.
fn months_between(from: NaiveDate, to: NaiveDate) -> i32 {
    (to.year() - from.year()) * 12 + (to.month() as i32 - from.month() as i32)
}

/// Charge one month of depreciation across every capitalised asset.
///
/// Idempotent by construction: the unique index on (asset, period) refuses a
/// second entry, so re-running a month posts nothing and reports every asset as
/// already done rather than doubling the charge.
pub async fn run_depreciation(
    pool: &PgPool,
    year: i32,
    month: u32,
    actor: &str,
) -> Result<DepreciationRun, AppError> {
    let period = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;

    let rows = sqlx::query(
        "SELECT a.asset_id, a.asset_number, a.name, a.category_code, a.site_id,
                k.capitalized_cost_minor, k.salvage_value_minor, k.useful_life_months,
                k.method, k.charge_kind, k.in_service_on,
                COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                           WHERE d.asset_id = a.asset_id), 0)::bigint AS accumulated,
                EXISTS (SELECT 1 FROM asset_depreciation_entry d
                         WHERE d.asset_id = a.asset_id AND d.period_month = $1) AS already
           FROM fixed_asset a
           JOIN LATERAL (
               SELECT * FROM asset_capitalization x
                WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
           ) k ON true
          WHERE k.decision = 'CAPITALIZE'
            AND a.status <> 'DISPOSED'
            AND k.in_service_on <= ($1::date + interval '1 month' - interval '1 day')
          ORDER BY a.asset_number",
    )
    .bind(period)
    .fetch_all(pool)
    .await?;

    let mut lines = Vec::with_capacity(rows.len());
    let mut posted_count = 0i64;
    let mut posted_total = 0i64;
    let mut skipped = 0i64;

    for row in &rows {
        let asset_id: Uuid = row.try_get("asset_id")?;
        let asset_number: String = row.try_get("asset_number")?;
        let name: String = row.try_get("name")?;

        if row.try_get::<bool, _>("already")? {
            skipped += 1;
            lines.push(DepreciationLine {
                asset_id,
                asset_number,
                name,
                amount_minor: None,
                skipped_because: Some("already charged for this month".into()),
            });
            continue;
        }

        let in_service: NaiveDate = row.try_get("in_service_on")?;
        let method = DepreciationMethod::parse(&row.try_get::<String, _>("method")?)
            .unwrap_or(DepreciationMethod::None);
        // Defaulted rather than refused: 0159's CHECK guarantees a capitalised
        // row names one, and a monthly run is the wrong place to stop the world
        // over a value the schema already will not admit.
        let kind = row
            .try_get::<Option<String>, _>("charge_kind")?
            .as_deref()
            .and_then(ChargeKind::parse)
            .unwrap_or(ChargeKind::Depreciation);
        let basis = Basis {
            method,
            capitalized_cost_minor: row.try_get("capitalized_cost_minor")?,
            salvage_value_minor: row.try_get("salvage_value_minor")?,
            useful_life_months: row.try_get("useful_life_months")?,
            accumulated_minor: row.try_get("accumulated")?,
            period_index: months_between(in_service, period),
        };

        match monthly_charge(basis) {
            Outcome::Skip(reason) => {
                skipped += 1;
                lines.push(DepreciationLine {
                    asset_id,
                    asset_number,
                    name,
                    amount_minor: None,
                    skipped_because: Some(skip_label(reason).into()),
                });
            }
            Outcome::Post(amount) => {
                let category: String = row.try_get("category_code")?;
                let site: String = row.try_get("site_id")?;
                // The category is the qualifier. `1021504 Machineries` resolves
                // to the client's `7010212` expense and `1021604` accumulated
                // accounts through the map, so the run names no account itself.
                // DEPRECIATION, not MANUAL. A machine wrote this entry, and
                // calling it manual made 44 of the ledger's 58 "hand-typed"
                // entries machine-written: an auditor filtering for the ones a
                // person could have got wrong was handed a list four times too
                // long, with no way to tell which fourteen were real. The kind
                // was added to the CHECK in 0083, which also relabelled the
                // entries the old rule wrote.
                //
                // `source_id` is the asset. Every other non-manual kind points
                // back at the document that caused it — a bill, a sale — and
                // this one had nothing to point at, so an entry charging
                // `AST-0007` said so only inside a memo string. It is also what
                // the schema's own CHECK asks for: a non-MANUAL, non-REVERSAL
                // entry must carry a source.
                //
                // `source_kind` stays DEPRECIATION for all three charge kinds.
                // It names the RULE that wrote the entry — the monthly asset
                // run — not what the charge is called, and one rule with three
                // source kinds would mean widening 0083's CHECK so that a
                // Journal filter could split a single rule's output three ways,
                // which no reader has asked for. What the charge is called is
                // in the memo, and the asset it charged is in `source_id`.
                let intent = PostingIntent {
                    posting_date: period,
                    source_kind: "DEPRECIATION".into(),
                    source_id: Some(asset_id.to_string()),
                    rule_version: "depreciation/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!("{} {period} — {asset_number} {name}", kind.label())),
                    lines: vec![
                        PostingLine::debit(kind.expense_key(), &site, amount)
                            .with_qualifier(&category),
                        PostingLine::credit(kind.contra_key(), &site, amount)
                            .with_qualifier(&category),
                    ],
                };
                let mut tx = pool.begin().await?;
                let posted = post(&mut tx, &intent, actor).await?;
                sqlx::query(
                    "INSERT INTO asset_depreciation_entry
                       (entry_id, asset_id, period_month, amount_minor, journal_entry_id, posted_by)
                     VALUES ($1,$2,$3,$4,$5,$6)",
                )
                .bind(Uuid::new_v4())
                .bind(asset_id)
                .bind(period)
                .bind(amount)
                .bind(posted.entry_id)
                .bind(actor)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;

                posted_count += 1;
                posted_total += amount;
                lines.push(DepreciationLine {
                    asset_id,
                    asset_number,
                    name,
                    amount_minor: Some(amount),
                    skipped_because: None,
                });
            }
        }
    }

    Ok(DepreciationRun {
        period_month: period,
        posted_count,
        posted_total_minor: posted_total,
        skipped_count: skipped,
        lines,
    })
}

/// Which categories still have no accounts mapped.
///
/// The run cannot charge an asset whose category has no expense or accumulated
/// account, and it should say so before somebody runs a month and reads a wall
/// of refusals.
pub async fn unmapped_categories(pool: &PgPool) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT a.category_code, a.site_id, k.charge_kind FROM fixed_asset a
           JOIN LATERAL (
               SELECT * FROM asset_capitalization x
                WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
           ) k ON true
          WHERE k.decision = 'CAPITALIZE' AND k.method <> 'NONE'",
    )
    .fetch_all(pool)
    .await?;
    let mut missing = Vec::new();
    for row in &rows {
        let category: String = row.try_get("category_code")?;
        let site: String = row.try_get("site_id")?;
        // An operating-equipment category needs `replacement_*` mapped and an
        // intangible needs `amortisation_*`; reporting the depreciation pair
        // as missing for either would send somebody to map an account that
        // will never be read.
        let kind = row
            .try_get::<Option<String>, _>("charge_kind")?
            .as_deref()
            .and_then(ChargeKind::parse)
            .unwrap_or(ChargeKind::Depreciation);
        for key in kind.charge_keys() {
            if resolve_account(pool, key, &site, &category).await.is_err() {
                missing.push(format!("{key} for {category} at {site}"));
            }
        }
    }
    Ok(missing)
}

// ---------------------------------------------------------------------------
// Leaving the register
// ---------------------------------------------------------------------------
//
// 0070 registered an asset and charged it every month, and nothing could ever
// take it off again. What follows is the other end of the life: it is sold or
// scrapped, or it simply moves to another shop.

/// The meanings proceeds can arrive into. The same four `supplier_payment`
/// admits, and for the same reason: without the constraint an asset could be
/// sold into `inventory` and the entry would balance.
const PROCEEDS_KEYS: [&str; 4] = ["bank_giro", "bank_savings", "cash", "petty_cash"];

const SOLD: &str = "SOLD";
const WRITTEN_OFF: &str = "WRITTEN_OFF";

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DisposeAssetRequest {
    /// The date it left, and the date the entry posts to. There is no separate
    /// posting date: unlike a bill, which arrives on one day and is booked on
    /// another, an asset leaves the books on the day it leaves.
    pub disposed_on: NaiveDate,
    /// What it fetched. Zero is a real answer — a machine given away for
    /// nothing was still disposed of.
    #[serde(default)]
    pub proceeds_minor: i64,
    /// `SOLD` or `WRITTEN_OFF`. A write-off fetches nothing by definition, and
    /// the database refuses one that claims otherwise.
    pub method: String,
    /// Where the money arrived: one of `bank_giro`, `bank_savings`, `cash`,
    /// `petty_cash`. Required when there are proceeds and meaningless without
    /// them — a meaning and a qualifier, never a client account code, exactly
    /// as `supplier_payment` says which pot money left.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub proceeds_account_key: Option<String>,
    /// Which bank. Empty for cash, which needs no narrowing.
    #[serde(default)]
    pub proceeds_account_qualifier: String,
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TransferAssetRequest {
    pub to_site: String,
    pub moved_on: NaiveDate,
    pub memo: Option<String>,
}

/// The month a date belongs to, named by its first day — the same key
/// `asset_depreciation_entry.period_month` uses.
fn month_of(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap_or(date)
}

/// Whether the depreciation run still owes this asset a charge for a month.
///
/// This is the rule disposal refuses on, and it is worth stating exactly:
/// **an asset may not leave the books while the run still owes it a charge for
/// the month it left in.** Disposing on 14 August before August's run means the
/// gain or loss is computed against a book value that is one month too high, so
/// the loss is overstated by exactly that month and the depreciation expense
/// understated by it — two wrong figures in two different statements, and a
/// trial balance that still balances.
///
/// "Owes" is asked of the arithmetic rather than of the entry table, because a
/// month with no entry is not the same as a month not run. Land charges
/// nothing, ever. An asset already at salvage charges nothing. A small asset
/// with a long life charges nothing in a month whose share rounds below one
/// rupiah. In all three the run HAS reached the month and correctly wrote no
/// row, and refusing those would make some assets undisposable.
fn charge_is_owed(asset: &AssetRow, period: NaiveDate) -> bool {
    let method = match asset.method.as_deref().and_then(DepreciationMethod::parse) {
        Some(method) => method,
        None => return false,
    };
    let (Some(cost), Some(salvage), Some(life), Some(in_service)) = (
        asset.capitalized_cost_minor,
        asset.salvage_value_minor,
        asset.useful_life_months,
        asset.in_service_on,
    ) else {
        return false;
    };
    // Not in service by the end of that month; the run would not have looked at
    // it. `period_index` would be negative here, which the arithmetic does not
    // expect and does not need to.
    if month_of(in_service) > period {
        return false;
    }
    if asset
        .last_depreciated_month
        .is_some_and(|last| last >= period)
    {
        return false;
    }
    matches!(
        monthly_charge(Basis {
            method,
            capitalized_cost_minor: cost,
            salvage_value_minor: salvage,
            useful_life_months: life,
            accumulated_minor: asset.accumulated_minor,
            period_index: months_between(in_service, period),
        }),
        Outcome::Post(_)
    )
}

/// Take an asset off the books.
///
/// # The entry
///
/// ```text
///   Cr  fixed_asset               cost              the asset leaves at what it came in at
///   Dr  accumulated_depreciation  accumulated       and so does everything charged against it
///   Dr  cash / bank_*             proceeds          what it fetched, if anything
///   Dr/Cr asset_disposal_result   the difference    a loss if it was worth more than it fetched
/// ```
///
/// Both asset accounts are qualified by the category, exactly as the monthly
/// run qualifies them, so a disposal empties the same pair of accounts the
/// charges filled. The result leg is the only one whose amount nobody chose: it
/// is `cost - accumulated - proceeds`, which is net book value less what was
/// received, and its sign decides which side it goes on.
pub async fn dispose_asset(
    pool: &PgPool,
    asset_id: Uuid,
    request: &DisposeAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    let existing = asset(pool, asset_id).await?;

    let method = request.method.trim().to_ascii_uppercase();
    if method != SOLD && method != WRITTEN_OFF {
        return Err(AppError::Validation(format!(
            "'{method}' is not a way of disposing of an asset; expected {} or {}",
            SOLD, WRITTEN_OFF
        )));
    }
    if existing.status == "DISPOSED" {
        return Err(AppError::Conflict(format!(
            "{} was already disposed of on {}; reverse its disposal entry rather than disposing \
             of it twice",
            existing.asset_number,
            existing
                .disposed_on
                .map(|d| d.to_string())
                .unwrap_or_else(|| "an unknown date".into())
        )));
    }
    // The in-force assessment, not `status`. `status` is Operations' word for
    // where the thing is in its own life; whether it is IN the books is
    // Finance's decision, and it is the highest sequence of
    // `asset_capitalization`. An asset Finance expensed has no cost in the
    // ledger, so there is nothing for a disposal entry to remove.
    if existing.decision.as_deref() != Some("CAPITALIZE") {
        return Err(AppError::Validation(format!(
            "{} is {}; only a capitalised asset carries a cost the books can take out. Assess it \
             first, or simply retire it in the register.",
            existing.asset_number,
            match existing.decision.as_deref() {
                Some(other) => format!("assessed {}", other.to_lowercase()),
                None => "not assessed".into(),
            }
        )));
    }
    if request.disposed_on < existing.acquired_on {
        return Err(AppError::Validation(format!(
            "{} was acquired on {} and cannot have left before it arrived",
            existing.asset_number, existing.acquired_on
        )));
    }
    if request.proceeds_minor < 0 {
        return Err(AppError::Validation(
            "proceeds cannot be negative; a cost of disposal is a bill, not a negative sale".into(),
        ));
    }
    if method == WRITTEN_OFF && request.proceeds_minor != 0 {
        return Err(AppError::Validation(format!(
            "a write-off fetches nothing, and this one fetched {}; record it as {}",
            request.proceeds_minor, SOLD
        )));
    }

    let proceeds_key = request
        .proceeds_account_key
        .as_deref()
        .map(|raw| raw.trim().to_ascii_lowercase())
        .filter(|key| !key.is_empty());
    if request.proceeds_minor > 0 {
        match proceeds_key.as_deref() {
            None => {
                return Err(AppError::Validation(format!(
                    "say where the {} went: one of {}",
                    request.proceeds_minor,
                    PROCEEDS_KEYS.join(", ")
                )))
            }
            Some(key) if !PROCEEDS_KEYS.contains(&key) => {
                return Err(AppError::Validation(format!(
                    "'{key}' is not an account money arrives into; expected one of {}",
                    PROCEEDS_KEYS.join(", ")
                )))
            }
            Some(_) => {}
        }
    }

    let period = month_of(request.disposed_on);
    if charge_is_owed(&existing, period) {
        return Err(AppError::Conflict(format!(
            "{} is depreciated through {}; run depreciation for {} before disposing of it, or the \
             gain or loss is computed against a book value one month too high",
            existing.asset_number,
            existing
                .last_depreciated_month
                .map(|month| month.format("%Y-%m").to_string())
                .unwrap_or_else(|| "nothing".into()),
            period.format("%Y-%m")
        )));
    }

    // The basis is guaranteed complete by 0070's CHECK on a CAPITALIZE row, so
    // these cannot be absent once the decision is CAPITALIZE. Defaulting rather
    // than unwrapping: a panic in a posting path is never the right answer.
    let cost = existing.capitalized_cost_minor.unwrap_or_default();
    let accumulated = existing.accumulated_minor;
    let site = existing.site_id.clone();
    let category = existing.category_code.clone();
    // Where the cost sits and what its contra is called both follow the charge
    // kind: an intangible's cost is not under `10215`, and operating
    // equipment's contra is a reserve. The same two lines, through whichever
    // pair of meanings this asset was charged through every month.
    let kind = existing
        .charge_kind
        .as_deref()
        .and_then(ChargeKind::parse)
        .unwrap_or(ChargeKind::Depreciation);

    let mut lines =
        vec![PostingLine::credit(kind.cost_key(), &site, cost).with_qualifier(&category)];
    if accumulated > 0 {
        lines.push(
            PostingLine::debit(kind.contra_key(), &site, accumulated).with_qualifier(&category),
        );
    }
    if request.proceeds_minor > 0 {
        if let Some(key) = proceeds_key.as_deref() {
            lines.push(
                PostingLine::debit(key, &site, request.proceeds_minor)
                    .with_qualifier(request.proceeds_account_qualifier.trim()),
            );
        }
    }
    // Positive is a loss — the asset was worth more than it fetched — and a
    // loss is a debit. Negative is a gain, and goes the other way. One key for
    // both, because which way it falls is arithmetic and not a decision
    // somebody makes twice on the Account Map.
    let result = cost - accumulated - request.proceeds_minor;
    match result.cmp(&0) {
        std::cmp::Ordering::Greater => {
            lines.push(PostingLine::debit("asset_disposal_result", &site, result))
        }
        std::cmp::Ordering::Less => {
            lines.push(PostingLine::credit("asset_disposal_result", &site, -result))
        }
        std::cmp::Ordering::Equal => {}
    }

    let intent = PostingIntent {
        posting_date: request.disposed_on,
        source_kind: "ASSET_DISPOSAL".into(),
        source_id: Some(asset_id.to_string()),
        rule_version: "asset_disposal/1".into(),
        currency: "IDR".into(),
        memo: Some(match request.memo.as_deref().map(str::trim) {
            Some(note) if !note.is_empty() => format!(
                "{} {} — {} — {note}",
                existing.asset_number,
                existing.name,
                method.to_lowercase()
            ),
            _ => format!(
                "{} {} — {}",
                existing.asset_number,
                existing.name,
                method.to_lowercase()
            ),
        }),
        lines,
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, actor).await?;
    // One statement, so the CHECK that ties DISPOSED to its entry, its method
    // and its proceeds is satisfied by the row as a whole. Setting them one at
    // a time would fail on the first.
    sqlx::query(
        "UPDATE fixed_asset
            SET status='DISPOSED', disposed_on=$2, disposal_method=$3,
                disposal_proceeds_minor=$4, disposal_journal_entry_id=$5
          WHERE asset_id=$1",
    )
    .bind(asset_id)
    .bind(request.disposed_on)
    .bind(&method)
    .bind(request.proceeds_minor)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    asset(pool, asset_id).await
}

/// Move an asset, and move its money with it.
///
/// # The entry
///
/// ```text
///   Cr  fixed_asset               cost         at the location it left
///   Dr  fixed_asset               cost         at the one it arrived at
///   Dr  accumulated_depreciation  accumulated  at the location it left
///   Cr  accumulated_depreciation  accumulated  at the one it arrived at
/// ```
///
/// Both halves, not just the cost. The client keeps a profit and loss per
/// location and their account codes carry the location, so moving the cost
/// alone would leave the old shop carrying accumulated depreciation against an
/// asset it no longer has and the new one carrying a cost with nothing charged
/// against it — two balance sheets wrong by the same amount in opposite
/// directions, and a trial balance that still balances.
///
/// An asset Finance decided to EXPENSE has no cost in the books, so there is
/// nothing to move and no entry is written. The move is still recorded:
/// somebody has to be able to find the thing.
pub async fn transfer_asset(
    pool: &PgPool,
    asset_id: Uuid,
    request: &TransferAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    let existing = asset(pool, asset_id).await?;
    let to_site = request.to_site.trim();

    if existing.status == "DISPOSED" {
        return Err(AppError::Conflict(format!(
            "{} left the books on {}; a disposed asset has nowhere to move to",
            existing.asset_number,
            existing
                .disposed_on
                .map(|d| d.to_string())
                .unwrap_or_else(|| "an unknown date".into())
        )));
    }
    if to_site == existing.site_id {
        return Err(AppError::Validation(format!(
            "{} is already at {}; a move to where it already is would post a debit and a credit \
             to one account and say nothing",
            existing.asset_number, existing.site_id
        )));
    }
    // The foreign key on `asset_transfer.to_site` is the guarantee; it arrives
    // as SQLSTATE 23503 and reaches a person as "database operation failed",
    // which names neither the column nor the value they typed.
    let known: bool = sqlx::query("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1) AS ok")
        .bind(to_site)
        .fetch_one(pool)
        .await?
        .try_get("ok")?;
    if !known {
        return Err(AppError::NotFound(format!("location {to_site}")));
    }

    let capitalised = existing.decision.as_deref() == Some("CAPITALIZE");
    let cost = existing.capitalized_cost_minor.unwrap_or_default();
    let accumulated = existing.accumulated_minor;
    let from_site = existing.site_id.clone();
    let category = existing.category_code.clone();
    let kind = existing
        .charge_kind
        .as_deref()
        .and_then(ChargeKind::parse)
        .unwrap_or(ChargeKind::Depreciation);

    let mut tx = pool.begin().await?;
    let entry_id = if capitalised && cost > 0 {
        let mut lines = vec![
            PostingLine::credit(kind.cost_key(), &from_site, cost).with_qualifier(&category),
            PostingLine::debit(kind.cost_key(), to_site, cost).with_qualifier(&category),
        ];
        if accumulated > 0 {
            lines.push(
                PostingLine::debit(kind.contra_key(), &from_site, accumulated)
                    .with_qualifier(&category),
            );
            lines.push(
                PostingLine::credit(kind.contra_key(), to_site, accumulated)
                    .with_qualifier(&category),
            );
        }
        let intent = PostingIntent {
            posting_date: request.moved_on,
            source_kind: "ASSET_TRANSFER".into(),
            source_id: Some(asset_id.to_string()),
            rule_version: "asset_transfer/1".into(),
            currency: "IDR".into(),
            memo: Some(match request.memo.as_deref().map(str::trim) {
                Some(note) if !note.is_empty() => format!(
                    "{} {} — {from_site} to {to_site} — {note}",
                    existing.asset_number, existing.name
                ),
                _ => format!(
                    "{} {} — {from_site} to {to_site}",
                    existing.asset_number, existing.name
                ),
            }),
            lines,
        };
        Some(post(&mut tx, &intent, actor).await?.entry_id)
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO asset_transfer
           (transfer_id, asset_id, from_site, to_site, moved_on, journal_entry_id, memo, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(Uuid::new_v4())
    .bind(asset_id)
    .bind(&from_site)
    .bind(to_site)
    .bind(request.moved_on)
    .bind(entry_id)
    .bind(request.memo.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE fixed_asset SET site_id=$2 WHERE asset_id=$1")
        .bind(asset_id)
        .bind(to_site)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    asset(pool, asset_id).await
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/// One month the run actually charged.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetScheduleRow {
    /// Named by the month's first day, which is how the entry is keyed.
    pub period_month: NaiveDate,
    pub amount_minor: i64,
    pub entry_id: Uuid,
    /// So a row links straight to the journal without a second fetch.
    pub entry_number: String,
}

/// What has been charged against one asset, and what is left to charge.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetSchedule {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    /// The treatment in force. Absent when nobody has assessed the asset.
    pub decision: Option<String>,
    pub method: Option<String>,
    pub capitalized_cost_minor: Option<i64>,
    pub salvage_value_minor: Option<i64>,
    pub useful_life_months: Option<i32>,
    pub in_service_on: Option<NaiveDate>,

    /// What was actually posted, month by month, oldest first.
    ///
    /// The record of what happened, not a projection of what should have. A
    /// month the run never reached simply is not here, and a month it reached
    /// and skipped is not here either — which is why `months_remaining` is
    /// computed from the calendar rather than from the length of this list.
    pub charged: Vec<AssetScheduleRow>,
    pub charged_total_minor: i64,
    pub last_depreciated_month: Option<NaiveDate>,

    /// Calendar months still inside the asset's life, counted from the month
    /// after the last one charged — or from the month it went into service when
    /// nothing has been charged at all.
    ///
    /// From the calendar and not from a count of entries, for the reason
    /// `Basis::period_index` gives: a small asset charges nothing for months at
    /// a time, and counting entries would leave such an asset permanently short
    /// of its last instalment. Zero once there is nothing left to charge, even
    /// when calendar months remain — an asset at salvage is finished.
    pub months_remaining: i32,
    /// `(cost - salvage) - accumulated`, floored at zero. What the remaining
    /// months have left to spread, and the figure the final instalment sweeps.
    pub remaining_depreciable_minor: i64,
}

/// The depreciation actually charged against one asset, and what remains.
pub async fn asset_schedule(pool: &PgPool, asset_id: Uuid) -> Result<AssetSchedule, AppError> {
    let row = asset(pool, asset_id).await?;

    let charged_rows = sqlx::query(
        "SELECT d.period_month, d.amount_minor, d.journal_entry_id, e.entry_number
           FROM asset_depreciation_entry d
           JOIN journal_entry e ON e.entry_id = d.journal_entry_id
          WHERE d.asset_id = $1
          ORDER BY d.period_month",
    )
    .bind(asset_id)
    .fetch_all(pool)
    .await?;

    let mut charged = Vec::with_capacity(charged_rows.len());
    let mut charged_total = 0i64;
    for entry in &charged_rows {
        let amount: i64 = entry.try_get("amount_minor")?;
        charged_total += amount;
        charged.push(AssetScheduleRow {
            period_month: entry.try_get("period_month")?,
            amount_minor: amount,
            entry_id: entry.try_get("journal_entry_id")?,
            entry_number: entry.try_get("entry_number")?,
        });
    }

    // Nothing is owed by an asset nobody capitalised, and nothing is owed by
    // land: `NONE` is a method rather than an absent value precisely so this
    // does not have to be a special case anywhere else.
    let depreciable = row.decision.as_deref() == Some("CAPITALIZE")
        && row.method.as_deref() != Some(DepreciationMethod::None.as_str());
    let remaining = if depreciable {
        let base = row.capitalized_cost_minor.unwrap_or_default()
            - row.salvage_value_minor.unwrap_or_default();
        (base - row.accumulated_minor).max(0)
    } else {
        0
    };
    let months_remaining = match (depreciable && remaining > 0, row.in_service_on) {
        (true, Some(in_service)) => {
            let next = row
                .last_depreciated_month
                .map(|last| months_between(in_service, last) + 1)
                .unwrap_or(0);
            (row.useful_life_months.unwrap_or_default() - next).max(0)
        }
        _ => 0,
    };

    Ok(AssetSchedule {
        asset_id: row.asset_id,
        asset_number: row.asset_number,
        name: row.name,
        decision: row.decision,
        method: row.method,
        capitalized_cost_minor: row.capitalized_cost_minor,
        salvage_value_minor: row.salvage_value_minor,
        useful_life_months: row.useful_life_months,
        in_service_on: row.in_service_on,
        charged,
        charged_total_minor: charged_total,
        last_depreciated_month: row.last_depreciated_month,
        months_remaining,
        remaining_depreciable_minor: remaining,
    })
}

// ---------------------------------------------------------------------------
// Where the register and the books disagree about what was bought
// ---------------------------------------------------------------------------
//
// Two lists, and they are not the same question asked twice.
//
// An asset with no acquisition line is a thing the register says the company
// owns and the ledger has never paid for. In the seeded books that is every
// capitalised asset: `10215*` has not one journal line against forty-four
// months of depreciation on `10216*`. Depreciation is being charged against a
// cost that is not on the balance sheet, and disposal — which credits
// `fixed_asset` at cost — would drive the family negative.
//
// A posted `10215*` bill line with no asset is the mirror: the books bought
// something capital and nobody put it on the register. It will never be
// depreciated, and nobody can be asked where it is.
//
// Both are exceptions to show, not errors to fix automatically. Guessing which
// asset a line bought is exactly the kind of invented link that has to be
// unwound by hand a year later.

/// A capitalised asset the books never bought.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnbackedAsset {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub site_id: String,
    pub category_code: String,
    pub capitalized_cost_minor: i64,
    pub in_service_on: Option<NaiveDate>,
    /// What has been charged against a cost that is not in the books. The
    /// figure that says how far the exception has already travelled.
    pub accumulated_minor: i64,
}

/// A posted capital purchase nobody put on the register.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnclaimedAcquisitionLine {
    pub line_id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub line_number: i32,
    pub invoice_date: NaiveDate,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub account_code: String,
    /// The client's own name, never translated.
    pub account_name: String,
    pub site_id: String,
    pub amount_minor: i64,
    pub memo: Option<String>,
}

/// The two halves of "what the books bought and what the register holds".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquisitionGap {
    pub assets_without_a_line: Vec<UnbackedAsset>,
    /// Summed so Overview can show one sentence — "assets in the register that
    /// the books never bought, 412,000,000" — without loading the list.
    pub assets_total_minor: i64,
    pub lines_without_an_asset: Vec<UnclaimedAcquisitionLine>,
    pub lines_total_minor: i64,
}

/// Assets the books never bought, and purchases nobody registered.
pub async fn acquisition_gap(pool: &PgPool) -> Result<AcquisitionGap, AppError> {
    // Capitalised, not disposed of, and pointing at no line. A disposed asset
    // is excluded because its exception has already been dealt with one way or
    // the other and re-reporting it would keep a closed item on the list.
    let asset_rows = sqlx::query(
        "SELECT a.asset_id, a.asset_number, a.name, a.site_id, a.category_code,
                k.capitalized_cost_minor, k.in_service_on,
                COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                           WHERE d.asset_id = a.asset_id), 0)::bigint AS accumulated
           FROM fixed_asset a
           JOIN LATERAL (
               SELECT * FROM asset_capitalization x
                WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
           ) k ON true
          WHERE k.decision = 'CAPITALIZE'
            AND a.status <> 'DISPOSED'
            AND a.acquired_via_line_id IS NULL
          ORDER BY k.capitalized_cost_minor DESC, a.asset_number",
    )
    .fetch_all(pool)
    .await?;

    let mut assets = Vec::with_capacity(asset_rows.len());
    let mut assets_total = 0i64;
    for row in &asset_rows {
        let cost: i64 = row.try_get("capitalized_cost_minor")?;
        assets_total += cost;
        assets.push(UnbackedAsset {
            asset_id: row.try_get("asset_id")?,
            asset_number: row.try_get("asset_number")?,
            name: row.try_get("name")?,
            site_id: row.try_get("site_id")?,
            category_code: row.try_get("category_code")?,
            capitalized_cost_minor: cost,
            in_service_on: row.try_get("in_service_on")?,
            accumulated_minor: row.try_get("accumulated")?,
        });
    }

    // POSTED only. A draft bill has not bought anything yet — the ledger has
    // never heard of it — so listing it here would report an exception that
    // does not exist. This is the one place the posting status matters, and it
    // is why `check_acquisition_line` deliberately does not ask about it.
    let line_rows = sqlx::query(
        "SELECT l.line_id, l.invoice_id, i.invoice_number, l.line_number, i.invoice_date,
                i.supplier_id, i.supplier_name, l.account_code, c.name AS account_name,
                l.site_id, l.amount_minor, l.memo
           FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i USING (invoice_id)
           JOIN ledger_account c ON c.account_code = l.account_code
          WHERE l.account_code LIKE ANY($1)
            AND i.status = 'POSTED'
            AND l.asset_id IS NULL
          ORDER BY i.invoice_date DESC, i.invoice_number, l.line_number",
    )
    // Bound from `ASSET_FAMILIES` rather than written into the SQL, so
    // widening the register is one edit and not two that must agree.
    .bind(
        ASSET_FAMILIES
            .iter()
            .map(|family| format!("{family}%"))
            .collect::<Vec<_>>(),
    )
    .fetch_all(pool)
    .await?;

    let mut lines = Vec::with_capacity(line_rows.len());
    let mut lines_total = 0i64;
    for row in &line_rows {
        let amount: i64 = row.try_get("amount_minor")?;
        lines_total += amount;
        lines.push(UnclaimedAcquisitionLine {
            line_id: row.try_get("line_id")?,
            invoice_id: row.try_get("invoice_id")?,
            invoice_number: row.try_get("invoice_number")?,
            line_number: row.try_get("line_number")?,
            invoice_date: row.try_get("invoice_date")?,
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            account_code: row.try_get("account_code")?,
            account_name: row.try_get("account_name")?,
            site_id: row.try_get("site_id")?,
            amount_minor: amount,
            memo: row.try_get("memo")?,
        });
    }

    Ok(AcquisitionGap {
        assets_without_a_line: assets,
        assets_total_minor: assets_total,
        lines_without_an_asset: lines,
        lines_total_minor: lines_total,
    })
}
