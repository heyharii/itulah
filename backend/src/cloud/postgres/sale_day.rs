//! A day's takings, carried into the general ledger.
//!
//! `journal_entry.source_kind` has allowed `SALE_DAY` since 0051 and reserved
//! it again in 0083, and until this module nothing had ever written one. The
//! consequence was not one missing feature: the Profit & Loss screen showed
//! expenses without sales, four meanings sat idle (`card_receivable_credit`,
//! `card_receivable_debit`, `card_fee`, `rounding`), and Store 03's
//! Rp 12,416,979 over 1-13 September 2026 moved nothing on any account.
//!
//! # One entry per unit per trading day
//!
//! Not one per sale. A shop rings up hundreds of baskets a day and an
//! accountant reads none of them; what they read is the day, against the
//! day's banking. Per-sale entries would also make the journal unreadable and
//! the trial balance slow, and would put the same question — is this day in the
//! book? — beyond answering without counting.
//!
//! The day is the SHOP'S day. The node keeps UTC and the shops keep WIB, so for
//! seven hours of every day the two disagree about which day it is and an
//! evening's takings dated by the UTC calendar land on tomorrow. The boundary
//! is `reporting::offset_of`, the same one every sales report is cut along, and
//! the offset used is recorded on the row.
//!
//! # The shape of the entry
//!
//! Debits are where the money went, credit is what was sold:
//!
//! | leg | meaning | amount |
//! |---|---|---|
//! | Dr | `cash` | cash tendered LESS change given |
//! | Dr | `card_receivable_debit` | debit card, net of its fee |
//! | Dr | `card_receivable_credit` | credit card, net of its fee |
//! | Dr | `card_receivable_debit` | QRIS follows the debit-card account route |
//! | Dr | `voucher_liability` | vouchers presented |
//! | Dr | `other_tender_clearing` | everything else |
//! | Dr | `card_fee` | what the acquirer and the QRIS provider keep |
//! | Cr | `revenue` | the day's sale totals, NET of the tax inside them |
//! | Cr | `output_tax` | the PPN that was already in the price |
//!
//! **The price already contains the tax.** Indonesian retail is priced
//! tax-inclusive: the shelf says Rp 5,608,554 and the PPN is INSIDE it, which
//! is why every sale in these books satisfies `total_minor = net_minor +
//! tax_minor`. So the split is `gross = net + tax` and it comes off the CREDIT
//! side — the debits are the money that actually arrived and do not move.
//! `sale_day/1` credited the whole gross to revenue and posted no tax line at
//! all, which recognised income the shop never earned and left the tax office's
//! share invisible; `sale_day/2` is the same entry with that credit split in
//! two. The figure is `sale.tax_minor`, the same column
//! `reports::sales_window` has always reported the day's tax from.
//!
//! **Which account `revenue` resolves to is not this rule's business, and one
//! of them is currently wrong.** `revenue` is bound at this estate to
//! `4010110001`, which in the client's own chart is `Penjualan Tunai` — CASH
//! sales — so every card, QRIS and voucher sale is at present credited to the
//! client's cash-sales account. That is a meaning WE changed, it is on the
//! owner's list to reverse, and it is not fixed here: this rule names a
//! meaning and the Account Map decides the code, which is exactly so that
//! moving it is a row and not a release. The per-tender split below is the
//! machinery for putting each tender on its own account the day the owner says
//! so — and the accounts it would need are the client's `4010110`/`4010111`/
//! `4010112`, not ones we mint.
//!
//! **Change is subtracted from cash and from nothing else**, because change can
//! only be given from the drawer — `tender::validate_tender` is what makes that
//! true. An entry that debited cash with the gross tendered would book money
//! the drawer has never held, and no cash count could ever agree with it.
//!
//! **Every line carries `site_id`.** The unit is not a dimension this estate
//! adds later: the client's chart is per-unit down to the leaf, their trial
//! balance is read per unit, and a line without one cannot be reconciled to any
//! shop's own banking.
//!
//! # What this module does NOT do, and deliberately
//!
//! * **Cost of goods.** The day's margin is not in this entry: `cogs` and
//!   `inventory` need a cost layer on the stock ledger, which is gap G2 in
//!   `docs/finance.md` and a different piece of work.
//! * **Refunds.** `sale_return_payment` carries a lifecycle — PENDING,
//!   PROCESSING, SUCCEEDED — and "when did the money actually leave" is a
//!   question that lifecycle does not yet answer honestly: a cash refund is
//!   handed over at the counter and stays PENDING. Guessing would book refunds
//!   that may never have happened, or miss ones that did. So a day's refunds
//!   are REPORTED on every row (`refunds_minor`) and left out of the entry,
//!   which is visible rather than silent. There are zero returns in the books
//!   today, so nothing is currently mis-stated by this.
//! * **Discounts as a contra.** The client's chart keeps `4010213001
//!   Discount / Potongan Penjualan`, and a sale's discount is already inside
//!   `total_minor` by the time it reaches here. Grossing it back up would mean
//!   re-deriving a discount the pricing engine has already applied.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::{decode_cursor, encode_cursor};
use crate::cloud::AppError;
use crate::reporting::offset_of;

/// The buckets a day's money falls into.
///
/// Six, where `PaymentMethod` has five: a card splits by kind, because the
/// client keeps two receivables for it and an acquirer settles them
/// separately.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Tender {
    Cash,
    CardDebit,
    CardCredit,
    Qris,
    Voucher,
    Other,
}

/// What a day's counter took, and where it went.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleDayRow {
    pub site_id: String,
    /// The site's own name, so a list can be read without a second request.
    pub site_name: String,
    pub trading_day: NaiveDate,
    /// Minutes east of UTC that defined this day. 420 is WIB.
    pub utc_offset_minutes: i32,
    pub sales_count: i64,
    /// What was sold — the sum of the day's sale totals, and the amount
    /// credited to revenue.
    pub gross_minor: i64,
    /// Cash as it was handed over, before change.
    pub cash_tendered_minor: i64,
    /// Change handed back. Comes out of the drawer and out of the cash debit.
    pub change_minor: i64,
    pub card_debit_minor: i64,
    pub card_credit_minor: i64,
    /// Card takings whose tender never said which kind of card it was. Booked
    /// to the DEBIT receivable, by a house rule rather than by evidence — see
    /// [`tender_of`]. Shown so that rule is visible on the screen and not only
    /// in this file.
    pub card_unattributed_minor: i64,
    pub qris_minor: i64,
    pub voucher_minor: i64,
    pub other_minor: i64,
    /// Refunds raised at this unit on this day. **Not in the entry** — see the
    /// module note. Shown so a day whose book and till disagree says why.
    pub refunds_minor: i64,
    pub card_debit_fee_minor: i64,
    pub card_credit_fee_minor: i64,
    pub qris_fee_minor: i64,
    /// Set once the day is in the book.
    pub entry_id: Option<Uuid>,
    pub entry_number: Option<String>,
    pub posted_by: Option<String>,
    pub posted_at: Option<DateTime<Utc>>,
    /// What the day was worth when it was posted. Beside `gross_minor`, which
    /// is what it is worth now: the two differ only if the day's sales changed
    /// after it was booked, and a person looking at a mismatch needs to see
    /// both figures rather than be told there is one.
    pub posted_gross_minor: Option<i64>,
}

/// What a caller is asking the day list for.
#[derive(Clone, Debug, Default)]
pub struct SaleDayScope {
    /// Units to keep. Empty means every unit — an empty filter and no filter
    /// are the same request.
    pub sites: Vec<String>,
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    /// `Some(true)` for days already in the book, `Some(false)` for days that
    /// are not, `None` for both.
    pub posted: Option<bool>,
    pub utc_offset_minutes: Option<i32>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Days that took money, newest first, with what is still outside the book.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaleDayPage {
    pub rows: Vec<SaleDayRow>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page.
    pub next_cursor: Option<String>,
    /// Every day the filters match, not just this page.
    pub total: i64,
    pub posted: i64,
    pub unposted: i64,
    /// **What the tills took and the books have not heard about**, over every
    /// day the filters match and never over the page. This is the number the
    /// gap was measured in, so it is the number the screen shows; a figure
    /// that shrank as somebody paged would be the screen reporting progress
    /// nobody made.
    pub unposted_gross_minor: i64,
    pub utc_offset_minutes: i32,
}

/// How many days the list returns when the caller does not say. A quarter.
const DEFAULT_DAY_LIMIT: i64 = 92;
/// And the most it will return however loudly a caller asks. Five years.
const MAX_DAY_LIMIT: i64 = 1830;

/// Where the previous page stopped, as a ROW and not as a position: days are
/// posted while somebody is paging through them.
#[derive(Serialize, Deserialize)]
struct DayCursor {
    trading_day: NaiveDate,
    site_id: String,
}

/// Which bucket one tender row falls into.
///
/// **A card that did not say which kind it was is booked to the DEBIT
/// receivable.** That is a rule and not a reading, and it is here in one place
/// rather than spread through the SQL so it can be found and changed. The
/// argument for debit over credit is weak on its own — it is the commoner card
/// at an Indonesian counter — so the amount it decided is carried out to the
/// screen as `card_unattributed_minor`, where whoever reconciles the acquirer
/// statement can see exactly how much of the split was guessed. Both accounts
/// hang under `1011101 PIUTANG DAGANG`, so the group total is right either way;
/// only the split between them is at risk.
fn tender_of(method: &str, card_kind: Option<&str>) -> Tender {
    match (method, card_kind) {
        ("CASH", _) => Tender::Cash,
        ("CARD", Some("CREDIT")) => Tender::CardCredit,
        ("CARD", _) => Tender::CardDebit,
        ("QRIS", _) => Tender::Qris,
        ("VOUCHER", _) => Tender::Voucher,
        // OTHER, and anything a future till invents. A tender nobody has named
        // is money that arrived: it goes to a clearing account, where it is
        // visible and unreconciled, rather than into cash, where it would be
        // invisible and wrong. A counter transfer is what lands here today,
        // because there is no TRANSFER tender.
        _ => Tender::Other,
    }
}

/// The day's facts, before any account has been resolved.
#[derive(Clone, Debug, Default)]
struct DayFacts {
    sales_count: i64,
    gross_minor: i64,
    /// The PPN already inside `gross_minor`. Read from `sale.tax_minor`, the
    /// same column the sales report cuts the day's tax from, so a day's tax
    /// here and on that report are the same number rather than two.
    tax_minor: i64,
    cash_tendered_minor: i64,
    change_minor: i64,
    card_debit_minor: i64,
    card_credit_minor: i64,
    card_unattributed_minor: i64,
    qris_minor: i64,
    voucher_minor: i64,
    other_minor: i64,
    refunds_minor: i64,
}

/// Every day that took money, and whether it is in the book.
///
/// Built from the SALES and not from the postings, which is the whole point:
/// a list of what has been posted cannot answer the question this screen exists
/// for, which is what has NOT been. The postings are joined on.
///
/// The day is derived with the same offset arithmetic
/// `postgres::reports::sales_window` uses — `(completed_at AT TIME ZONE 'UTC') +
/// make_interval(mins => …)` — so a day here and a day on the sales report are
/// the same day. They would otherwise disagree for seven hours out of every
/// twenty-four and nothing would say so.
pub async fn sale_days(pool: &PgPool, scope: SaleDayScope) -> Result<SaleDayPage, AppError> {
    let offset_minutes = offset_of(scope.utc_offset_minutes);
    let sites = (!scope.sites.is_empty()).then(|| {
        scope
            .sites
            .iter()
            .map(|one| one.trim().to_ascii_lowercase())
            .collect::<Vec<_>>()
    });
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_DAY_LIMIT)
        .clamp(1, MAX_DAY_LIMIT);
    let cursor: Option<DayCursor> = scope.cursor.as_deref().map(decode_cursor).transpose()?;

    // One CTE, referenced by the page and by the totals. `NOT MATERIALIZED` for
    // the reason `account_map_page` gives: two references make PostgreSQL
    // materialise a CTE, which is an optimisation fence a LIMIT cannot be
    // pushed through.
    const DAYS: &str = "
        SELECT s.site_id,
               ((s.completed_at AT TIME ZONE 'UTC')
                 + make_interval(mins => $1))::date AS trading_day,
               COUNT(*)::bigint AS sales_count,
               COALESCE(SUM(s.total_minor), 0)::bigint AS gross_minor,
               COALESCE(SUM(s.tax_minor), 0)::bigint AS tax_minor,
               COALESCE(SUM(s.change_minor), 0)::bigint AS change_minor
          FROM sale s
         WHERE s.status = 'COMPLETED'
           AND ($2::text[] IS NULL OR s.site_id = ANY($2))
           AND ($3::date IS NULL OR ((s.completed_at AT TIME ZONE 'UTC')
                                      + make_interval(mins => $1))::date >= $3)
           AND ($4::date IS NULL OR ((s.completed_at AT TIME ZONE 'UTC')
                                      + make_interval(mins => $1))::date <= $4)
         GROUP BY 1, 2
    ";

    let kept = format!(
        "WITH days AS NOT MATERIALIZED ({DAYS}),
              kept AS NOT MATERIALIZED (
             -- Posted means posted by the AUTHORITY, which since 0273 is
             -- `sales_posting` and nothing else. `sale_day_posting` is joined
             -- beside it because it holds what the retired writer posted before
             -- 0273 took its write away, and a day it posted is still a day that
             -- is in the book. Neither can be dropped from this answer: one is
             -- the present, the other is history.
             SELECT d.*,
                    COALESCE(sp.journal_entry_id, p.entry_id) AS entry_id,
                    COALESCE(sp.gross_minor, p.gross_minor)   AS posted_gross_minor
               FROM days d
               LEFT JOIN sales_posting sp
                      ON sp.site_id = d.site_id AND sp.business_date = d.trading_day
               LEFT JOIN sale_day_posting p
                      ON p.site_id = d.site_id AND p.trading_day = d.trading_day
              WHERE $5::bool IS NULL
                 OR (COALESCE(sp.journal_entry_id, p.entry_id) IS NOT NULL) = $5
         )"
    );

    let page_sql = format!(
        "{kept}
         SELECT k.*, s.name AS site_name, e.entry_number,
                COALESCE(sp.posted_by, p.posted_by) AS posted_by,
                COALESCE(sp.posted_at, p.posted_at) AS posted_at,
                p.utc_offset_minutes,
                -- The tender split as the RETIRED writer recorded it, and null
                -- for every day the authority posted — it keeps no tender split,
                -- because the split is a property of the payments and that is
                -- where this function reads it from for every other day.
                p.cash_tendered_minor, p.change_minor AS posted_change_minor,
                p.card_debit_minor, p.card_credit_minor,
                p.card_unattributed_minor, p.qris_minor, p.voucher_minor, p.other_minor,
                p.card_debit_fee_minor, p.card_credit_fee_minor, p.qris_fee_minor
           FROM kept k
           JOIN site s ON s.id = k.site_id
           LEFT JOIN sales_posting sp
                  ON sp.site_id = k.site_id AND sp.business_date = k.trading_day
           LEFT JOIN sale_day_posting p
                  ON p.site_id = k.site_id AND p.trading_day = k.trading_day
           LEFT JOIN journal_entry e ON e.entry_id = k.entry_id
          -- Both halves of the keyset in the SAME direction as the ORDER BY.
          -- A row comparison has one direction for the whole tuple, so an
          -- order that descended by day and ascended by site could not be
          -- seeked by one — and the page boundary would skip and repeat rows
          -- with nothing saying so.
          WHERE $6::date IS NULL
             OR (k.trading_day, k.site_id) < ($6::date, $7::text)
          ORDER BY k.trading_day DESC, k.site_id DESC
          LIMIT $8"
    );

    let rows = sqlx::query(&page_sql)
        .bind(offset_minutes)
        .bind(&sites)
        .bind(scope.from)
        .bind(scope.to)
        .bind(scope.posted)
        .bind(cursor.as_ref().map(|c| c.trading_day))
        .bind(cursor.as_ref().map(|c| c.site_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // The tender split for a day that is not posted yet has to come from the
    // payments; for a posted day it comes from the row the rule wrote. Refunds
    // come from the returns either way, because they are in NEITHER — see the
    // module note. One pass for the whole page, so a hundred days is not a
    // hundred queries.
    let keys: Vec<(String, NaiveDate)> = rows
        .iter()
        .map(|row| Ok::<_, AppError>((row.try_get("site_id")?, row.try_get("trading_day")?)))
        .collect::<Result<Vec<_>, _>>()?;
    let derived = derived_tenders(pool, &keys, offset_minutes).await?;
    let refunds_of = |site: &str, day: NaiveDate| -> i64 {
        derived
            .iter()
            .find(|(key, _)| key.0 == site && key.1 == day)
            .map_or(0, |(_, facts)| facts.refunds_minor)
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let site_id: String = row.try_get("site_id")?;
        let trading_day: NaiveDate = row.try_get("trading_day")?;
        let entry_id: Option<Uuid> = row.try_get("entry_id")?;
        // Whether the RETIRED writer is the one that posted it. Only its row
        // carries a tender split, so only its row can be read for one; a day the
        // authority posted takes the same path an unposted day takes, and reads
        // the split from the payments, which is where the truth was all along.
        let legacy_split = row
            .try_get::<Option<i64>, _>("cash_tendered_minor")?
            .is_some();
        let facts = if legacy_split {
            DayFacts {
                sales_count: row.try_get("sales_count")?,
                gross_minor: row.try_get("gross_minor")?,
                // From the sales as they stand, like the gross beside it, and
                // not from the posting row — which does not keep it. A posted
                // day's tax as the RULE saw it is on the entry's
                // `2012101003` line.
                tax_minor: row.try_get("tax_minor")?,
                cash_tendered_minor: row.try_get("cash_tendered_minor")?,
                change_minor: row.try_get("posted_change_minor")?,
                card_debit_minor: row.try_get("card_debit_minor")?,
                card_credit_minor: row.try_get("card_credit_minor")?,
                card_unattributed_minor: row.try_get("card_unattributed_minor")?,
                qris_minor: row.try_get("qris_minor")?,
                voucher_minor: row.try_get("voucher_minor")?,
                other_minor: row.try_get("other_minor")?,
                refunds_minor: refunds_of(&site_id, trading_day),
            }
        } else {
            let mut facts = derived
                .iter()
                .find(|(key, _)| key.0 == site_id && key.1 == trading_day)
                .map(|(_, facts)| facts.clone())
                .unwrap_or_default();
            facts.sales_count = row.try_get("sales_count")?;
            facts.gross_minor = row.try_get("gross_minor")?;
            facts.tax_minor = row.try_get("tax_minor")?;
            facts.change_minor = row.try_get("change_minor")?;
            facts
        };
        out.push(SaleDayRow {
            site_id,
            site_name: row.try_get("site_name")?,
            trading_day,
            utc_offset_minutes: row
                .try_get::<Option<i32>, _>("utc_offset_minutes")?
                .unwrap_or(offset_minutes),
            sales_count: facts.sales_count,
            gross_minor: row.try_get("gross_minor")?,
            cash_tendered_minor: facts.cash_tendered_minor,
            change_minor: facts.change_minor,
            card_debit_minor: facts.card_debit_minor,
            card_credit_minor: facts.card_credit_minor,
            card_unattributed_minor: facts.card_unattributed_minor,
            qris_minor: facts.qris_minor,
            voucher_minor: facts.voucher_minor,
            other_minor: facts.other_minor,
            refunds_minor: facts.refunds_minor,
            card_debit_fee_minor: row
                .try_get::<Option<i64>, _>("card_debit_fee_minor")?
                .unwrap_or(0),
            card_credit_fee_minor: row
                .try_get::<Option<i64>, _>("card_credit_fee_minor")?
                .unwrap_or(0),
            qris_fee_minor: row
                .try_get::<Option<i64>, _>("qris_fee_minor")?
                .unwrap_or(0),
            entry_id,
            entry_number: row.try_get("entry_number")?,
            posted_by: row.try_get("posted_by")?,
            posted_at: row.try_get("posted_at")?,
            posted_gross_minor: row.try_get("posted_gross_minor")?,
        });
    }

    let next_cursor = match out.last() {
        Some(row) if out.len() as i64 == limit => Some(encode_cursor(&DayCursor {
            trading_day: row.trading_day,
            site_id: row.site_id.clone(),
        })?),
        _ => None,
    };

    // The counts and the gap, over every day the filters match — never over the
    // page. See `unposted_gross_minor`.
    let totals = sqlx::query(&format!(
        "{kept}
         SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE entry_id IS NOT NULL)::bigint AS posted,
                COUNT(*) FILTER (WHERE entry_id IS NULL)::bigint AS unposted,
                COALESCE(SUM(gross_minor) FILTER (WHERE entry_id IS NULL), 0)::bigint
                    AS unposted_gross_minor
           FROM kept"
    ))
    .bind(offset_minutes)
    .bind(&sites)
    .bind(scope.from)
    .bind(scope.to)
    .bind(scope.posted)
    .fetch_one(pool)
    .await?;

    Ok(SaleDayPage {
        rows: out,
        next_cursor,
        total: totals.try_get("total")?,
        posted: totals.try_get("posted")?,
        unposted: totals.try_get("unposted")?,
        unposted_gross_minor: totals.try_get("unposted_gross_minor")?,
        utc_offset_minutes: offset_minutes,
    })
}

/// The tender split for days that are not posted yet, in one query.
async fn derived_tenders(
    pool: &PgPool,
    keys: &[(String, NaiveDate)],
    offset_minutes: i32,
) -> Result<Vec<((String, NaiveDate), DayFacts)>, AppError> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let sites: Vec<String> = keys.iter().map(|(site, _)| site.clone()).collect();
    let days: Vec<NaiveDate> = keys.iter().map(|(_, day)| *day).collect();

    let rows = sqlx::query(
        "WITH asked AS (SELECT * FROM unnest($2::text[], $3::date[]) AS a(site_id, trading_day))
         SELECT a.site_id, a.trading_day, p.method, p.card_kind,
                COALESCE(SUM(p.amount_minor), 0)::bigint AS amount_minor
           FROM asked a
           JOIN sale s ON s.site_id = a.site_id AND s.status = 'COMPLETED'
            AND ((s.completed_at AT TIME ZONE 'UTC')
                  + make_interval(mins => $1))::date = a.trading_day
           JOIN sale_payment p ON p.sale_id = s.id
          GROUP BY a.site_id, a.trading_day, p.method, p.card_kind",
    )
    .bind(offset_minutes)
    .bind(&sites)
    .bind(&days)
    .fetch_all(pool)
    .await?;

    let refunds = sqlx::query(
        "WITH asked AS (SELECT * FROM unnest($2::text[], $3::date[]) AS a(site_id, trading_day))
         SELECT a.site_id, a.trading_day,
                COALESCE(SUM(rp.amount_minor), 0)::bigint AS refunds_minor
           FROM asked a
           JOIN sale_return r ON r.site_id = a.site_id
            AND ((r.created_at AT TIME ZONE 'UTC')
                  + make_interval(mins => $1))::date = a.trading_day
           JOIN sale_return_payment rp ON rp.return_id = r.id
          WHERE rp.status <> 'CANCELLED' AND rp.status <> 'FAILED'
          GROUP BY a.site_id, a.trading_day",
    )
    .bind(offset_minutes)
    .bind(&sites)
    .bind(&days)
    .fetch_all(pool)
    .await?;

    /// The row for one (unit, day), made if it is not there yet.
    ///
    /// A free function rather than a closure over `out`: a closure would hold
    /// the borrow for its whole lifetime and the loops below could not then
    /// reach into the vector it returned an index into.
    fn slot(out: &mut Vec<((String, NaiveDate), DayFacts)>, site: String, day: NaiveDate) -> usize {
        match out
            .iter()
            .position(|(key, _)| key.0 == site && key.1 == day)
        {
            Some(index) => index,
            None => {
                out.push(((site, day), DayFacts::default()));
                out.len() - 1
            }
        }
    }

    let mut out: Vec<((String, NaiveDate), DayFacts)> = Vec::new();
    for row in &rows {
        let site: String = row.try_get("site_id")?;
        let day: NaiveDate = row.try_get("trading_day")?;
        let method: String = row.try_get("method")?;
        let card_kind: Option<String> = row.try_get("card_kind")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let index = slot(&mut out, site, day);
        let facts = &mut out[index].1;
        let bucket = tender_of(&method, card_kind.as_deref());
        match bucket {
            Tender::Cash => facts.cash_tendered_minor += amount,
            Tender::CardDebit if card_kind.is_none() => facts.card_unattributed_minor += amount,
            Tender::CardDebit => facts.card_debit_minor += amount,
            Tender::CardCredit => facts.card_credit_minor += amount,
            Tender::Qris => facts.qris_minor += amount,
            Tender::Voucher => facts.voucher_minor += amount,
            Tender::Other => facts.other_minor += amount,
        }
    }
    for row in &refunds {
        let site: String = row.try_get("site_id")?;
        let day: NaiveDate = row.try_get("trading_day")?;
        let amount: i64 = row.try_get("refunds_minor")?;
        let index = slot(&mut out, site, day);
        out[index].1.refunds_minor += amount;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rule that decides the card split, and the one place it is decided.
    #[test]
    fn a_card_that_did_not_say_which_kind_it_was_is_a_debit_card() {
        assert_eq!(tender_of("CARD", Some("CREDIT")), Tender::CardCredit);
        assert_eq!(tender_of("CARD", Some("DEBIT")), Tender::CardDebit);
        assert_eq!(tender_of("CARD", None), Tender::CardDebit);
    }

    /// A tender nobody has named is money that arrived, and it goes somewhere
    /// it can be seen — never into cash, where it would be invisible.
    #[test]
    fn an_unnamed_tender_clears_rather_than_becoming_cash() {
        assert_eq!(tender_of("OTHER", None), Tender::Other);
        assert_eq!(tender_of("TRANSFER", None), Tender::Other);
        assert_eq!(tender_of("CASH", None), Tender::Cash);
    }
}
