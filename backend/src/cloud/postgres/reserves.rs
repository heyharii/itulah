//! The replacement reserve: the client's own answer to operating equipment.
//!
//! # Why this is not depreciation with another name
//!
//! Read the client's master account file one line at a time and the seventh
//! asset family stops matching the other six:
//!
//! ```text
//!   1021507  Operating Equipment                        36 accounts
//!   1021607  Reserve Replacement - Operating Equipment  36 accounts
//!   7010215  BIAYA REPLACEMENT OPERATING EQUIPMENT      36 accounts
//! ```
//!
//! The other six under `10216` are named `Akum-Penyusu - <something>`; this one
//! is not. And `70102` has no depreciation family for operating equipment at
//! all — its sixth child is REPLACEMENT. Three parallel blocks of thirty-six,
//! class for class: `OE - Rak 1`, `RR OE- Rak 1`, `Biaya Replacement OE - Rack
//! 1`, down to `OE - Tas / Keranjang Belanja`.
//!
//! So racks, mannequins, hangers and shopping baskets are not depreciated here.
//! A monthly amount per class goes into a reserve, and when a rack is actually
//! replaced the new one comes out of the reserve instead of through the profit
//! and loss. It is a sinking fund, and the accounts for it predate this system.
//!
//! The three blocks above are what the client's chart looked like. In the
//! forty-account chart they are three accounts — `1610`, `7101` and the cost
//! account — and the thirty-six racks are thirty-six rows of `asset_class`,
//! which `asset_class_reserve.class_code` now points at instead of at
//! `ledger_account`. Nothing about the mechanism changed: the class is still
//! the `account_map` qualifier, so the rate, the charge and the draw still
//! find their accounts the way they always did.
//!
//! # The two halves, and why the second one is the point
//!
//! ```text
//!   monthly, per class per location:
//!     Dr  replacement_expense  (unit, class)   the rate
//!     Cr  replacement_reserve  (unit, class)
//!
//!   a replacement purchase flagged as drawing:
//!     Dr  replacement_reserve  (unit, class)   instead of an expense
//!     Cr  the supplier payable
//! ```
//!
//! A rate is set per location (`asset_replacement_rate.site_id`), because the
//! racks stand at a shop; the charge is booked to the unit that owns the shop
//! (`unit_of_site`), because that is whose books the reserve is in.
//!
//! Without the draw the reserve only ever grows — the same half-a-lifecycle
//! mistake 0096 fixed for the register and 0084 for payables. The draw lives in
//! `payables::post_bill`, because a replacement is bought on an ordinary
//! supplier bill and inventing a second document for it would mean a second
//! supplier balance.
//!
//! # No asset dimension on these lines, deliberately
//!
//! `journal_line.asset_id` stays NULL here. A reserve is charged against a
//! CLASS of equipment — "racks at store 03" — and there is no single thing it
//! is about. Filling the column with the nearest asset would make the asset's
//! own ledger claim charges nobody made against it.

use super::assets::charge_legs;
use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::ChargeKind;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// A class of equipment the company reserves against, as the screen shows it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetReserveClass {
    pub class_code: String,
    /// The client's own name, never translated.
    pub class_name: String,
    pub has_replacement_reserve: bool,
    pub note: Option<String>,
    /// How many locations have a rate set for it. Zero is the state worth
    /// seeing: a class flagged and never rated charges nothing, silently.
    pub rated_sites: i64,
}

/// What one location puts aside for one class, from one month on.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetReplacementRate {
    pub class_code: String,
    pub class_name: String,
    pub site_id: String,
    pub effective_from: NaiveDate,
    pub monthly_charge_minor: i64,
    pub set_by: String,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetReplacementRateRequest {
    /// One of the register's asset classes — `OE_RAK_1` and the thirty-five
    /// beside it. A code from `asset_class`, not an account code: the client's
    /// own name for the class is on that row.
    pub class_code: String,
    pub site_id: String,
    /// The month it starts applying. Any day is accepted and the month is what
    /// is kept: a rate that began "on the 14th" is a rate nobody can reconcile
    /// against a monthly charge.
    pub effective_from: NaiveDate,
    pub monthly_charge_minor: i64,
    /// Why the company reserves against this class at all. Written once, onto
    /// the class, the first time a rate is set for it.
    pub note: Option<String>,
}

/// One class at one location, charged for one month.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReserveChargeLine {
    pub class_code: String,
    pub class_name: String,
    pub site_id: String,
    pub amount_minor: Option<i64>,
    /// Absent when something was charged. Present, and named, when it was not.
    pub skipped_because: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReserveRun {
    pub period_month: NaiveDate,
    pub posted_count: i64,
    pub posted_total_minor: i64,
    pub skipped_count: i64,
    pub lines: Vec<ReserveChargeLine>,
}

/// Whether a month's reserve is done, for the period-close checklist.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReserveStatus {
    pub period_month: NaiveDate,
    /// Class-and-location pairs with a rate in force for this month.
    pub rates_in_force: i64,
    pub charged_count: i64,
    pub charged_total_minor: i64,
    /// The pairs still waiting, named.
    pub missing: Vec<ReserveChargeLine>,
    pub complete: bool,
}

/// The month a date belongs to, named by its first day.
fn month_of(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap_or(date)
}

/// Every class the company reserves against, and whether anybody rated it.
pub async fn asset_reserve_classes(pool: &PgPool) -> Result<Vec<AssetReserveClass>, AppError> {
    let rows = sqlx::query(
        "SELECT r.class_code, c.name AS class_name, r.has_replacement_reserve, r.note,
                (SELECT COUNT(DISTINCT t.site_id) FROM asset_replacement_rate t
                  WHERE t.class_code = r.class_code)::bigint AS rated_sites
           FROM asset_class_reserve r
           JOIN asset_class c ON c.class_code = r.class_code
          ORDER BY r.class_code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(AssetReserveClass {
                class_code: row.try_get("class_code")?,
                class_name: row.try_get("class_name")?,
                has_replacement_reserve: row.try_get("has_replacement_reserve")?,
                note: row.try_get("note")?,
                rated_sites: row.try_get("rated_sites")?,
            })
        })
        .collect()
}

/// Every rate ever set, newest first within a class and location.
///
/// The whole history and not only what is in force: "we reserved 250,000 a
/// month for racks and raised it to 400,000 in July" is the record, and a
/// screen showing only the current figure makes every month before July look as
/// if it had always been 400,000.
pub async fn asset_replacement_rates(
    pool: &PgPool,
    site_id: Option<&str>,
    class_code: Option<&str>,
) -> Result<Vec<AssetReplacementRate>, AppError> {
    let rows = sqlx::query(
        "SELECT t.class_code, c.name AS class_name, t.site_id, t.effective_from,
                t.monthly_charge_minor, t.set_by
           FROM asset_replacement_rate t
           JOIN asset_class c ON c.class_code = t.class_code
          WHERE ($1::text IS NULL OR t.site_id = $1)
            AND ($2::text IS NULL OR t.class_code = $2)
          ORDER BY t.class_code, t.site_id, t.effective_from DESC",
    )
    .bind(site_id)
    .bind(class_code)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(AssetReplacementRate {
                class_code: row.try_get("class_code")?,
                class_name: row.try_get("class_name")?,
                site_id: row.try_get("site_id")?,
                effective_from: row.try_get("effective_from")?,
                monthly_charge_minor: row.try_get("monthly_charge_minor")?,
                set_by: row.try_get("set_by")?,
            })
        })
        .collect()
}

/// Set what one location reserves for one class, from one month on.
///
/// Appended, never edited: the trigger in 0139 refuses an update, so raising a
/// rate is a new row from the month it changes and the charges already posted
/// keep agreeing with the rate that produced them.
pub async fn set_asset_replacement_rate(
    pool: &PgPool,
    request: &SetReplacementRateRequest,
    actor: &str,
) -> Result<AssetReplacementRate, AppError> {
    let class = request.class_code.trim();
    if request.monthly_charge_minor <= 0 {
        return Err(AppError::Validation(
            "a reserve rate is a monthly amount and has to be positive; to stop reserving, set \
             the flag on the class rather than a rate of nothing"
                .into(),
        ));
    }
    // One of the register's own classes, and a live one. Until the
    // forty-account chart this asked whether the code was an account under
    // `1021507`, which admitted the client's ten-character sub-types and their
    // seven-character families alike — the same two-spellings bug that stopped
    // depreciation resolving. `asset_class` has one spelling.
    super::asset_classes::assert_asset_class(pool, class).await?;
    let from = month_of(request.effective_from);

    let mut tx = pool.begin().await?;
    // The class is flagged by the first rate set against it. A separate step to
    // "enable the reserve" before "say how much" would be two screens for one
    // decision, and the state between them — flagged, unrated — charges
    // nothing while looking configured.
    sqlx::query(
        "INSERT INTO asset_class_reserve (class_code, has_replacement_reserve, note, set_by)
         VALUES ($1, true, $2, $3)
         ON CONFLICT (class_code) DO UPDATE
            SET note = COALESCE(EXCLUDED.note, asset_class_reserve.note)",
    )
    .bind(class)
    .bind(request.note.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO asset_replacement_rate
           (class_code, site_id, effective_from, monthly_charge_minor, set_by)
         VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(class)
    .bind(request.site_id.trim())
    .bind(from)
    .bind(request.monthly_charge_minor)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(AssetReplacementRate {
        class_code: class.to_string(),
        class_name: String::new(),
        site_id: request.site_id.trim().to_string(),
        effective_from: from,
        monthly_charge_minor: request.monthly_charge_minor,
        set_by: actor.to_string(),
    })
}

/// The rate in force for each class and location in a month, and whether the
/// month has already been charged for it.
///
/// One query, because "what should be charged" and "what has been" are the two
/// halves of every answer this module gives, and asking them separately is how
/// a run and a status page come to disagree.
const RATES_IN_FORCE: &str = "SELECT t.class_code, c.name AS class_name, t.site_id,
                t.monthly_charge_minor,
                EXISTS (SELECT 1 FROM asset_replacement_charge g
                         WHERE g.class_code = t.class_code AND g.site_id = t.site_id
                           AND g.period_month = $1) AS already
           FROM asset_replacement_rate t
           JOIN asset_class_reserve r ON r.class_code = t.class_code
           JOIN asset_class c ON c.class_code = t.class_code
          WHERE r.has_replacement_reserve
            AND t.effective_from <= $1
            AND t.effective_from = (
                SELECT MAX(x.effective_from) FROM asset_replacement_rate x
                 WHERE x.class_code = t.class_code AND x.site_id = t.site_id
                   AND x.effective_from <= $1)
          ORDER BY t.site_id, t.class_code";

/// What a month's reserve still owes.
pub async fn asset_reserve_status(
    pool: &PgPool,
    year: i32,
    month: u32,
) -> Result<ReserveStatus, AppError> {
    let period = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;
    let rows = sqlx::query(RATES_IN_FORCE)
        .bind(period)
        .fetch_all(pool)
        .await?;

    let mut missing = Vec::new();
    for row in &rows {
        if row.try_get::<bool, _>("already")? {
            continue;
        }
        missing.push(ReserveChargeLine {
            class_code: row.try_get("class_code")?,
            class_name: row.try_get("class_name")?,
            site_id: row.try_get("site_id")?,
            amount_minor: Some(row.try_get("monthly_charge_minor")?),
            skipped_because: Some("not charged yet".into()),
        });
    }

    let charged = sqlx::query(
        "SELECT COUNT(*)::bigint AS n, COALESCE(SUM(amount_minor), 0)::bigint AS total
           FROM asset_replacement_charge WHERE period_month = $1",
    )
    .bind(period)
    .fetch_one(pool)
    .await?;

    Ok(ReserveStatus {
        period_month: period,
        rates_in_force: rows.len() as i64,
        charged_count: charged.try_get("n")?,
        charged_total_minor: charged.try_get("total")?,
        complete: missing.is_empty(),
        missing,
    })
}

/// Charge one month of replacement reserve, across every rated class.
///
/// Idempotent by construction, exactly as the depreciation run is: the UNIQUE
/// on (class, location, month) refuses a second charge, so a repeat posts
/// nothing and reports every pair as already done.
///
/// One entry per LOCATION, not per class. Thirty-six classes at one shop are
/// seventy-two lines in one entry, because a shop's monthly reserve is one act
/// and thirty-six entries would make the journal unreadable for no gain. Each
/// pair still gets its own `asset_replacement_charge` row, which is what makes
/// the repeat safe.
pub async fn asset_reserve_charge(
    pool: &PgPool,
    year: i32,
    month: u32,
    actor: &str,
) -> Result<ReserveRun, AppError> {
    let period = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;
    let rows = sqlx::query(RATES_IN_FORCE)
        .bind(period)
        .fetch_all(pool)
        .await?;

    let mut lines = Vec::with_capacity(rows.len());
    let mut posted_count = 0i64;
    let mut posted_total = 0i64;
    let mut skipped = 0i64;

    // Grouped by location, in the order the query returned them.
    let mut current_site: Option<String> = None;
    let mut batch: Vec<(String, String, i64)> = Vec::new();

    for row in &rows {
        let site: String = row.try_get("site_id")?;
        let class_code: String = row.try_get("class_code")?;
        let class_name: String = row.try_get("class_name")?;
        let amount: i64 = row.try_get("monthly_charge_minor")?;

        if current_site.as_deref() != Some(site.as_str()) {
            if let Some(previous) = current_site.take() {
                let (count, total) = flush(pool, &previous, period, &batch, actor).await?;
                posted_count += count;
                posted_total += total;
                batch.clear();
            }
            current_site = Some(site.clone());
        }

        if row.try_get::<bool, _>("already")? {
            skipped += 1;
            lines.push(ReserveChargeLine {
                class_code,
                class_name,
                site_id: site,
                amount_minor: None,
                skipped_because: Some("already charged for this month".into()),
            });
            continue;
        }

        batch.push((class_code.clone(), class_name.clone(), amount));
        lines.push(ReserveChargeLine {
            class_code,
            class_name,
            site_id: site,
            amount_minor: Some(amount),
            skipped_because: None,
        });
    }
    if let Some(previous) = current_site.take() {
        let (count, total) = flush(pool, &previous, period, &batch, actor).await?;
        posted_count += count;
        posted_total += total;
    }

    Ok(ReserveRun {
        period_month: period,
        posted_count,
        posted_total_minor: posted_total,
        skipped_count: skipped,
        lines,
    })
}

/// Write one location's month: one entry, two lines per class, and a charge row
/// per class so the month cannot be charged twice. Both lines land in the books
/// of the unit that owns the location.
async fn flush(
    pool: &PgPool,
    site_id: &str,
    period: NaiveDate,
    batch: &[(String, String, i64)],
    actor: &str,
) -> Result<(i64, i64), AppError> {
    if batch.is_empty() {
        return Ok((0, 0));
    }
    let unit = super::sites::unit_of_site(pool, site_id).await?;
    let mut posting = Vec::with_capacity(batch.len() * 2);
    let mut total = 0i64;
    for (class_code, _, amount) in batch {
        // The expense leg shares `7101` with depreciation and amortisation
        // since the chart became forty, and `depreciation_kind` is the only
        // thing that keeps a replacement charge off the depreciation line of
        // the profit and loss. 0159 exists because the client does not
        // depreciate operating equipment; a charge that cannot say it is a
        // REPLACEMENT has given that distinction back.
        //
        // Checked per class rather than once, because the map is kept per class
        // and one class mapped wrongly is what a reader has to be told about.
        charge_legs(pool, ChargeKind::ReplacementReserve, &unit, class_code).await?;
        posting.push(
            PostingLine::debit("replacement_expense", &unit, *amount).with_qualifier(class_code),
        );
        posting.push(
            PostingLine::credit("replacement_reserve", &unit, *amount).with_qualifier(class_code),
        );
        total += *amount;
    }

    let intent = PostingIntent {
        posting_date: period,
        source_kind: "ASSET_RESERVE".into(),
        // The document is the location's month. Every non-manual kind points at
        // what caused it; this one is caused by a month passing at a shop, and
        // there is no row anywhere that IS that — so the key is written out
        // rather than left null, which the schema's own CHECK asks for anyway.
        source_id: Some(format!("{site_id}:{}", period.format("%Y-%m"))),
        rule_version: "asset_reserve/1".into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "Cadangan penggantian operating equipment {} — {site_id}",
            period.format("%Y-%m")
        )),
        lines: posting,
    };

    let mut tx = pool.begin().await?;
    // The source id is already the shop and the month, so a month's reserve
    // charge is one entry and this is its only step.
    let entry = post(&mut tx, &intent, None, actor).await?;
    for (class_code, _, amount) in batch {
        sqlx::query(
            "INSERT INTO asset_replacement_charge
               (charge_id, class_code, site_id, period_month, amount_minor,
                journal_entry_id, posted_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(class_code)
        .bind(site_id)
        .bind(period)
        .bind(amount)
        .bind(entry.entry_id)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok((batch.len() as i64, total))
}
