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
use crate::cloud::domain::{monthly_charge, Basis, DepreciationMethod, Outcome, SkipReason};
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
    pub in_service_on: Option<NaiveDate>,

    /// Summed from the depreciation entries. Not stored anywhere.
    pub accumulated_minor: i64,
    /// Cost less accumulated. Derived on read for the same reason.
    pub book_value_minor: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RegisterAssetRequest {
    pub asset_number: String,
    pub name: String,
    /// A family under `10215`.
    pub category_code: String,
    pub site_id: String,
    pub acquired_on: NaiveDate,
    pub serial_number: Option<String>,
    pub notes: Option<String>,
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
    pub in_service_on: Option<NaiveDate>,
    /// Why. Required on both decisions — an expensed asset with no reason is
    /// the one somebody queries a year later.
    pub reason: String,
}

const ASSET_COLUMNS: &str = "a.asset_id, a.asset_number, a.name, a.category_code,
     c.name AS category_name, a.site_id, a.status, a.serial_number, a.acquired_on,
     k.decision, k.capitalized_cost_minor, k.salvage_value_minor, k.useful_life_months,
     k.method, k.in_service_on,
     COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                WHERE d.asset_id = a.asset_id), 0)::bigint AS accumulated";

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
        decision: row.try_get("decision")?,
        capitalized_cost_minor: cost,
        salvage_value_minor: row.try_get("salvage_value_minor")?,
        useful_life_months: row.try_get("useful_life_months")?,
        method: row.try_get("method")?,
        in_service_on: row.try_get("in_service_on")?,
        accumulated_minor: accumulated,
        book_value_minor: cost.map(|c| c - accumulated),
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

pub async fn register_asset(
    pool: &PgPool,
    request: &RegisterAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    // The category must be a family the client actually keeps, under 10215.
    // Checked here so the message names the problem; the foreign key is the
    // guarantee.
    let category = request.category_code.trim();
    if !category.starts_with("10215") {
        return Err(AppError::Validation(format!(
            "{category} is not an asset category; they are the families under \
             10215 AKTIVA TETAP"
        )));
    }
    let asset_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, acquired_on,
            serial_number, notes, registered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
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
    .execute(pool)
    .await?;
    asset(pool, asset_id).await
}

/// Record Finance's decision. Appended — the highest sequence is in force.
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
    let next: i32 = sqlx::query(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM asset_capitalization WHERE asset_id = $1",
    )
    .bind(asset_id)
    .fetch_one(pool)
    .await?
    .try_get("next")?;

    sqlx::query(
        "INSERT INTO asset_capitalization
           (capitalization_id, asset_id, sequence, decision, capitalized_cost_minor,
            salvage_value_minor, useful_life_months, method, in_service_on, reason, assessed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(Uuid::new_v4())
    .bind(asset_id)
    .bind(next)
    .bind(request.decision.trim())
    .bind(request.capitalized_cost_minor)
    .bind(request.salvage_value_minor)
    .bind(request.useful_life_months)
    .bind(request.method.as_deref())
    .bind(request.in_service_on)
    .bind(request.reason.trim())
    .bind(actor)
    .execute(pool)
    .await?;
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
                k.method, k.in_service_on,
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
                let intent = PostingIntent {
                    posting_date: period,
                    source_kind: "MANUAL".into(),
                    source_id: None,
                    rule_version: "depreciation/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!("Penyusutan {period} — {asset_number} {name}")),
                    lines: vec![
                        PostingLine::debit("depreciation_expense", &site, amount)
                            .with_qualifier(&category),
                        PostingLine::credit("accumulated_depreciation", &site, amount)
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
        "SELECT DISTINCT a.category_code, a.site_id FROM fixed_asset a
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
        for key in ["depreciation_expense", "accumulated_depreciation"] {
            if resolve_account(pool, key, &site, &category).await.is_err() {
                missing.push(format!("{key} for {category} at {site}"));
            }
        }
    }
    Ok(missing)
}
