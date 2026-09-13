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
//! | Dr | `qris_clearing` | QRIS, net of its fee |
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
use crate::cloud::postgres::poster::{post, PostingIntent, PostingLine};
use crate::cloud::AppError;
use crate::reporting::{offset_of, window_of};

/// Which rule wrote these entries. When it is corrected, this is what says
/// which entries the old one produced.
///
/// `/2` since the tax came out of revenue. `/1` credited the gross, so an entry
/// stamped `sale_day/1` is one whose revenue line is overstated by the PPN
/// inside it and which has no `2012101003` line at all.
const RULE: &str = "sale_day/2";

/// The meanings this rule posts through. It names no client account code, and
/// an unmapped meaning refuses by name — see `poster`.
const REVENUE: &str = "revenue";
const CASH: &str = "cash";
const CARD_DEBIT: &str = "card_receivable_debit";
const CARD_CREDIT: &str = "card_receivable_credit";
const QRIS: &str = "qris_clearing";
const VOUCHER: &str = "voucher_liability";
const OTHER: &str = "other_tender_clearing";
const FEE: &str = "card_fee";
const OUTPUT_TAX: &str = "output_tax";

/// How the revenue credit may be split, when somebody has said it should be.
///
/// The client's chart divides sales by tender — `4010110` Tunai, `4010111`
/// Kartu Debit per bank, `4010112` Kartu Kredit per scheme — and whether this
/// estate should follow it that far is an OPEN owner decision
/// (`docs/finance-menu.md` §6, decision 2). So the rule asks rather than
/// chooses: if `revenue` has a binding at this unit for every tender the day
/// took, the credit is split per tender under these qualifiers; if it has only
/// the plain binding, the credit is one line. All or nothing, so a day can
/// never be half-split — a half-split day would look like a rule that changed
/// its mind halfway through the week.
const REVENUE_QUALIFIERS: [(Tender, &str); 6] = [
    (Tender::Cash, "CASH"),
    (Tender::CardDebit, "CARD_DEBIT"),
    (Tender::CardCredit, "CARD_CREDIT"),
    (Tender::Qris, "QRIS"),
    (Tender::Voucher, "VOUCHER"),
    (Tender::Other, "OTHER"),
];

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

/// What the acquirer and the QRIS provider keep out of a day's takings.
///
/// Told to the rule rather than derived, because nothing in this estate knows
/// an MDR rate: it is a contract with an acquirer, not a fact the till
/// observes, and `sale_payment` has no column for it. Whoever holds the
/// settlement slip keys it; when nobody does, the receivables carry gross and
/// `card_fee` stays where it has always been, which is honest rather than
/// invented.
#[derive(Clone, Debug, Default, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostSaleDayRequest {
    #[serde(default)]
    pub card_debit_fee_minor: i64,
    #[serde(default)]
    pub card_credit_fee_minor: i64,
    #[serde(default)]
    pub qris_fee_minor: i64,
    /// The day boundary, in minutes east of UTC. Absent means WIB, which is
    /// what every sales report means by it.
    #[serde(default)]
    pub utc_offset_minutes: Option<i32>,
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

impl DayFacts {
    /// What each tender bucket sold. Change comes off cash and off nothing
    /// else, so these sum to `gross_minor` — which is what makes the entry
    /// balance whether the credit is one line or six.
    fn revenue_of(&self, tender: Tender) -> i64 {
        match tender {
            Tender::Cash => self.cash_tendered_minor - self.change_minor,
            Tender::CardDebit => self.card_debit_minor + self.card_unattributed_minor,
            Tender::CardCredit => self.card_credit_minor,
            Tender::Qris => self.qris_minor,
            Tender::Voucher => self.voucher_minor,
            Tender::Other => self.other_minor,
        }
    }

    /// What was sold, once the tax inside the price is out of it.
    fn net_minor(&self) -> i64 {
        self.gross_minor - self.tax_minor
    }

    /// The day's NET revenue, shared out across the tenders it came in
    /// through, in [`REVENUE_QUALIFIERS`] order.
    ///
    /// Only reached when the owner has bound `revenue` per tender. There is no
    /// per-tender tax to read and there cannot be: the tax is a property of the
    /// SALE and the tender split is a property of the PAYMENTS, and one sale
    /// can be paid two ways. So the net is apportioned pro rata on what each
    /// tender took.
    ///
    /// Floor division, with the last few rupiah given to the tender that took
    /// the most. That is not a rounding preference, it is what makes the six
    /// shares add back to `net_minor` EXACTLY — and they must, or the entry
    /// does not balance and the day refuses to post. Sharing the net rather
    /// than the tax is deliberate for the same reason: the floor of a
    /// non-negative number is non-negative, and the remainder only ever makes
    /// the largest share larger, so no tender can be handed a negative credit.
    fn net_shares(&self) -> [i64; REVENUE_QUALIFIERS.len()] {
        let mut shares = [0_i64; REVENUE_QUALIFIERS.len()];
        let net = self.net_minor();
        if self.gross_minor <= 0 || net <= 0 {
            return shares;
        }
        let mut given: i64 = 0;
        let mut largest = 0_usize;
        let mut largest_took = i64::MIN;
        for (index, (tender, _)) in REVENUE_QUALIFIERS.iter().enumerate() {
            let took = self.revenue_of(*tender);
            // i128 because a day's takings times a day's net overflows i64 at
            // around Rp 3bn squared, which is a fortnight of this estate.
            let share = i64::try_from(
                i128::from(took) * i128::from(net) / i128::from(self.gross_minor),
            )
            .unwrap_or(0);
            shares[index] = share;
            given += share;
            if took > largest_took {
                largest_took = took;
                largest = index;
            }
        }
        shares[largest] += net - given;
        shares
    }
}

/// Read one unit's day: how much was sold, and how it was paid for.
async fn day_facts(
    pool: &PgPool,
    site_id: &str,
    trading_day: NaiveDate,
    offset_minutes: i32,
) -> Result<DayFacts, AppError> {
    let (start, end) =
        window_of(trading_day, trading_day, offset_minutes).map_err(AppError::Validation)?;

    let sales = sqlx::query(
        // `tax_minor` beside `total_minor` and from the same rows, because the
        // two are halves of one figure: the price is tax-inclusive, so
        // `total_minor = net_minor + tax_minor` on every completed sale and a
        // tax read from anywhere else could disagree with the gross it is
        // supposed to be inside.
        "SELECT COUNT(*)::bigint AS sales_count,
                COALESCE(SUM(total_minor), 0)::bigint AS gross_minor,
                COALESCE(SUM(tax_minor), 0)::bigint AS tax_minor,
                COALESCE(SUM(change_minor), 0)::bigint AS change_minor
           FROM sale
          WHERE site_id = $1 AND status = 'COMPLETED'
            AND completed_at >= $2 AND completed_at < $3",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    let mut facts = DayFacts {
        sales_count: sales.try_get("sales_count")?,
        gross_minor: sales.try_get("gross_minor")?,
        tax_minor: sales.try_get("tax_minor")?,
        change_minor: sales.try_get("change_minor")?,
        ..DayFacts::default()
    };

    // Grouped by the two columns the bucket is decided from, and bucketed in
    // Rust — so `tender_of` is the only thing that decides, and the SQL cannot
    // grow a second opinion about what an unattributed card is.
    let tenders = sqlx::query(
        "SELECT p.method, p.card_kind,
                COALESCE(SUM(p.amount_minor), 0)::bigint AS amount_minor
           FROM sale_payment p JOIN sale s ON s.id = p.sale_id
          WHERE s.site_id = $1 AND s.status = 'COMPLETED'
            AND s.completed_at >= $2 AND s.completed_at < $3
          GROUP BY p.method, p.card_kind",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    for row in &tenders {
        let method: String = row.try_get("method")?;
        let card_kind: Option<String> = row.try_get("card_kind")?;
        let amount: i64 = row.try_get("amount_minor")?;
        let bucket = tender_of(&method, card_kind.as_deref());
        let unattributed = bucket == Tender::CardDebit && card_kind.is_none();
        let slot = match bucket {
            Tender::Cash => &mut facts.cash_tendered_minor,
            Tender::CardDebit if unattributed => &mut facts.card_unattributed_minor,
            Tender::CardDebit => &mut facts.card_debit_minor,
            Tender::CardCredit => &mut facts.card_credit_minor,
            Tender::Qris => &mut facts.qris_minor,
            Tender::Voucher => &mut facts.voucher_minor,
            Tender::Other => &mut facts.other_minor,
        };
        *slot += amount;
    }

    // Reported, never posted. See the module note.
    facts.refunds_minor = sqlx::query_scalar(
        "SELECT COALESCE(SUM(p.amount_minor), 0)::bigint
           FROM sale_return_payment p JOIN sale_return r ON r.id = p.return_id
          WHERE r.site_id = $1 AND r.created_at >= $2 AND r.created_at < $3
            AND p.status <> 'CANCELLED' AND p.status <> 'FAILED'",
    )
    .bind(site_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;

    Ok(facts)
}

/// The qualifiers `revenue` is bound under at this unit, if the owner has
/// decided to split it. See [`REVENUE_QUALIFIERS`].
async fn revenue_split(pool: &PgPool, site_id: &str, facts: &DayFacts) -> Result<bool, AppError> {
    let bound: Vec<String> = sqlx::query_scalar(
        "SELECT qualifier FROM account_map
          WHERE semantic_key = $1 AND site_id = $2 AND qualifier <> ''",
    )
    .bind(REVENUE)
    .bind(site_id)
    .fetch_all(pool)
    .await?;
    if bound.is_empty() {
        return Ok(false);
    }
    // Only the tenders this day actually took have to be bound. A shop that
    // never takes vouchers should not have to map one to post a Tuesday.
    Ok(REVENUE_QUALIFIERS
        .iter()
        .filter(|(tender, _)| facts.revenue_of(*tender) != 0)
        .all(|(_, qualifier)| bound.iter().any(|one| one == qualifier)))
}

/// Put one unit's day in the book.
///
/// # Posting it twice
///
/// The second call books nothing and returns the first call's entry. That
/// property is not a check in this function — a check is a thing somebody can
/// forget to write, or write and then move. It is the PRIMARY KEY of
/// `sale_day_posting`, taken inside the same transaction that writes the
/// journal entry: two callers pressing at the same moment both post, both
/// reach the insert, one commits, and the other finds the key taken and rolls
/// back the entry it had written along with it. Nothing is left half-posted,
/// and there is no window in which a second entry exists.
///
/// A second guard sits on the journal's own side — `ux_journal_entry_sale_day`,
/// unique on `source_id` where the kind is `SALE_DAY` — so even a writer that
/// never touched this table cannot produce a second entry for one day.
pub async fn post_sale_day(
    pool: &PgPool,
    site_id: &str,
    trading_day: NaiveDate,
    request: &PostSaleDayRequest,
    actor: &str,
) -> Result<SaleDayRow, AppError> {
    let site_id = site_id.trim().to_ascii_lowercase();
    let offset_minutes = offset_of(request.utc_offset_minutes);
    let site_name: String = sqlx::query_scalar("SELECT name FROM site WHERE id = $1")
        .bind(&site_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("site".into()))?;

    // Already in the book: hand back what is there. Asked before the work and
    // again after the insert, because between those two moments somebody else
    // may have posted it.
    if let Some(row) = day_row(pool, &site_id, trading_day).await? {
        return Ok(row);
    }

    let facts = day_facts(pool, &site_id, trading_day, offset_minutes).await?;
    if facts.sales_count == 0 {
        return Err(AppError::Validation(format!(
            "{site_name} rang up nothing on {trading_day}; there is nothing to post"
        )));
    }
    let cash_minor = facts.cash_tendered_minor - facts.change_minor;
    if cash_minor < 0 {
        // Only cash can produce change, so this cannot happen through the till
        // — `tender::validate_tender` refuses it. If it ever does, the day is
        // not postable and the reason is worth saying rather than posting a
        // negative debit the poster would refuse in less helpful words.
        return Err(AppError::Validation(format!(
            "{site_name} gave more change on {trading_day} ({}) than it took in cash ({}); \
             the day cannot be posted until that is explained",
            facts.change_minor, facts.cash_tendered_minor
        )));
    }
    if facts.tax_minor > facts.gross_minor {
        // The price is tax-inclusive, so the tax is a part of the gross and
        // cannot exceed it. Nothing the till can do produces this —
        // `total_minor = net_minor + tax_minor` on every sale it writes — but
        // a day that did would otherwise post a NEGATIVE revenue credit, which
        // balances and is nonsense, and nonsense that balances is the kind that
        // survives a year.
        return Err(AppError::Validation(format!(
            "{site_name}'s sales on {trading_day} carry more tax ({}) than they were sold for \
             ({}); the shelf price already contains the tax, so that cannot be split and the \
             day cannot be posted until it is explained",
            facts.tax_minor, facts.gross_minor
        )));
    }

    let fees = [
        (
            Tender::CardDebit,
            request.card_debit_fee_minor,
            "debit card fee",
        ),
        (
            Tender::CardCredit,
            request.card_credit_fee_minor,
            "credit card fee",
        ),
        (Tender::Qris, request.qris_fee_minor, "QRIS fee"),
    ];
    for (tender, fee, label) in fees {
        if fee < 0 {
            return Err(AppError::Validation(format!(
                "the {label} cannot be negative"
            )));
        }
        let taken = facts.revenue_of(tender);
        if fee > taken {
            return Err(AppError::Validation(format!(
                "the {label} ({fee}) is more than the {} taken that way ({taken})",
                if taken == 0 { "nothing" } else { "money" }
            )));
        }
    }

    let split = revenue_split(pool, &site_id, &facts).await?;
    let mut lines: Vec<PostingLine> = Vec::with_capacity(10);

    // The debits: where the money went.
    let debits: [(Tender, &str, i64); 6] = [
        (Tender::Cash, CASH, 0),
        (Tender::CardDebit, CARD_DEBIT, request.card_debit_fee_minor),
        (
            Tender::CardCredit,
            CARD_CREDIT,
            request.card_credit_fee_minor,
        ),
        (Tender::Qris, QRIS, request.qris_fee_minor),
        (Tender::Voucher, VOUCHER, 0),
        (Tender::Other, OTHER, 0),
    ];
    for (tender, meaning, fee) in debits {
        let net = facts.revenue_of(tender) - fee;
        if net > 0 {
            lines.push(PostingLine::debit(meaning, &site_id, net));
        }
    }

    // What the acquirer keeps. One line per fee rather than one summed line:
    // they land on the same account and an entry that says which is which can
    // be read against a settlement slip.
    for (_, fee, label) in fees {
        if fee > 0 {
            let mut line = PostingLine::debit(FEE, &site_id, fee);
            line.memo = Some(label.to_string());
            lines.push(line);
        }
    }

    // And the credits: what was sold, and the tax that was already inside the
    // price of it.
    //
    // The debits above are untouched by the split — they are the money that
    // actually arrived, and the whole of it did. What changes is that the
    // credit no longer claims all of it as income.
    if split {
        let shares = facts.net_shares();
        for ((_, qualifier), amount) in REVENUE_QUALIFIERS.into_iter().zip(shares) {
            if amount > 0 {
                lines
                    .push(PostingLine::credit(REVENUE, &site_id, amount).with_qualifier(qualifier));
            }
        }
    } else if facts.net_minor() > 0 {
        lines.push(PostingLine::credit(REVENUE, &site_id, facts.net_minor()));
    }
    // One line however the revenue was split. The tax is one liability owed by
    // the company to one tax office; which tender it came in through is a fact
    // about the debits and not about what is owed.
    if facts.tax_minor > 0 {
        lines.push(PostingLine::credit(OUTPUT_TAX, &site_id, facts.tax_minor));
    }

    let intent = PostingIntent {
        posting_date: trading_day,
        source_kind: "SALE_DAY".into(),
        // `site:day`. The natural key of the thing posted, and what
        // `ux_journal_entry_sale_day` is unique on.
        source_id: Some(format!("{site_id}:{trading_day}")),
        rule_version: RULE.into(),
        currency: "IDR".into(),
        memo: Some(format!(
            "{site_name} {trading_day}: {} sales, {} taken",
            facts.sales_count, facts.gross_minor
        )),
        lines,
    };

    let mut tx = pool.begin().await?;
    let posted = post(&mut tx, &intent, actor).await?;
    let claimed = sqlx::query(
        "INSERT INTO sale_day_posting
           (site_id, trading_day, entry_id, utc_offset_minutes, sales_count, gross_minor,
            cash_tendered_minor, change_minor, card_debit_minor, card_credit_minor,
            card_unattributed_minor, qris_minor, voucher_minor, other_minor,
            card_debit_fee_minor, card_credit_fee_minor, qris_fee_minor, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (site_id, trading_day) DO NOTHING",
    )
    .bind(&site_id)
    .bind(trading_day)
    .bind(posted.entry_id)
    .bind(offset_minutes)
    .bind(facts.sales_count)
    .bind(facts.gross_minor)
    .bind(facts.cash_tendered_minor)
    .bind(facts.change_minor)
    .bind(facts.card_debit_minor)
    .bind(facts.card_credit_minor)
    .bind(facts.card_unattributed_minor)
    .bind(facts.qris_minor)
    .bind(facts.voucher_minor)
    .bind(facts.other_minor)
    .bind(request.card_debit_fee_minor)
    .bind(request.card_credit_fee_minor)
    .bind(request.qris_fee_minor)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    if claimed.rows_affected() == 0 {
        // Somebody else posted this day while this transaction was open. Drop
        // ours — the entry included, because it was written in this
        // transaction — and answer with theirs.
        tx.rollback().await?;
        return day_row(pool, &site_id, trading_day)
            .await?
            .ok_or_else(|| AppError::Conflict("this day was posted and then unposted".into()));
    }
    tx.commit().await?;

    day_row(pool, &site_id, trading_day)
        .await?
        .ok_or_else(|| AppError::NotFound("the day that was just posted".into()))
}

/// One day, as the list draws it. `None` when that day is not in the book.
///
/// Reads the posting rather than re-deriving the sales, because what a posted
/// day IS is the entry: the figures beside it are the ones the rule saw when it
/// wrote it.
async fn day_row(
    pool: &PgPool,
    site_id: &str,
    trading_day: NaiveDate,
) -> Result<Option<SaleDayRow>, AppError> {
    let row = sqlx::query(
        "SELECT p.*, s.name AS site_name, e.entry_number,
                (SELECT COALESCE(SUM(rp.amount_minor), 0)::bigint
                   FROM sale_return_payment rp JOIN sale_return r ON r.id = rp.return_id
                  WHERE r.site_id = p.site_id
                    AND rp.status <> 'CANCELLED' AND rp.status <> 'FAILED'
                    AND r.created_at >= (p.trading_day::timestamp
                                         - make_interval(mins => p.utc_offset_minutes))
                                        AT TIME ZONE 'UTC'
                    AND r.created_at <  ((p.trading_day + 1)::timestamp
                                         - make_interval(mins => p.utc_offset_minutes))
                                        AT TIME ZONE 'UTC') AS refunds_minor
           FROM sale_day_posting p
           JOIN site s ON s.id = p.site_id
           JOIN journal_entry e ON e.entry_id = p.entry_id
          WHERE p.site_id = $1 AND p.trading_day = $2",
    )
    .bind(site_id)
    .bind(trading_day)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let gross: i64 = row.try_get("gross_minor")?;
    Ok(Some(SaleDayRow {
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        trading_day: row.try_get("trading_day")?,
        utc_offset_minutes: row.try_get("utc_offset_minutes")?,
        sales_count: row.try_get("sales_count")?,
        gross_minor: gross,
        cash_tendered_minor: row.try_get("cash_tendered_minor")?,
        change_minor: row.try_get("change_minor")?,
        card_debit_minor: row.try_get("card_debit_minor")?,
        card_credit_minor: row.try_get("card_credit_minor")?,
        card_unattributed_minor: row.try_get("card_unattributed_minor")?,
        qris_minor: row.try_get("qris_minor")?,
        voucher_minor: row.try_get("voucher_minor")?,
        other_minor: row.try_get("other_minor")?,
        refunds_minor: row.try_get("refunds_minor")?,
        card_debit_fee_minor: row.try_get("card_debit_fee_minor")?,
        card_credit_fee_minor: row.try_get("card_credit_fee_minor")?,
        qris_fee_minor: row.try_get("qris_fee_minor")?,
        entry_id: row.try_get("entry_id")?,
        entry_number: row.try_get("entry_number")?,
        posted_by: row.try_get("posted_by")?,
        posted_at: row.try_get("posted_at")?,
        posted_gross_minor: Some(gross),
    }))
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
             SELECT d.*, p.entry_id, p.gross_minor AS posted_gross_minor
               FROM days d
               LEFT JOIN sale_day_posting p
                      ON p.site_id = d.site_id AND p.trading_day = d.trading_day
              WHERE $5::bool IS NULL OR (p.entry_id IS NOT NULL) = $5
         )"
    );

    let page_sql = format!(
        "{kept}
         SELECT k.*, s.name AS site_name, e.entry_number,
                p.posted_by, p.posted_at, p.utc_offset_minutes,
                p.cash_tendered_minor, p.change_minor AS posted_change_minor,
                p.card_debit_minor, p.card_credit_minor,
                p.card_unattributed_minor, p.qris_minor, p.voucher_minor, p.other_minor,
                p.card_debit_fee_minor, p.card_credit_fee_minor, p.qris_fee_minor
           FROM kept k
           JOIN site s ON s.id = k.site_id
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
        let posted = entry_id.is_some();
        let facts = if posted {
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
    fn slot(
        out: &mut Vec<((String, NaiveDate), DayFacts)>,
        site: String,
        day: NaiveDate,
    ) -> usize {
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

    /// The arithmetic the entry balances on: change comes off cash and off
    /// nothing else, so the tenders less the change are what was sold.
    #[test]
    fn change_comes_out_of_cash_and_the_buckets_still_sum_to_the_day() {
        let facts = DayFacts {
            sales_count: 4,
            gross_minor: 3_331_336,
            cash_tendered_minor: 1_500_000,
            change_minor: 200_000,
            card_debit_minor: 0,
            card_credit_minor: 0,
            card_unattributed_minor: 1_431_336,
            qris_minor: 600_000,
            voucher_minor: 0,
            other_minor: 0,
            refunds_minor: 0,
        };
        assert_eq!(facts.revenue_of(Tender::Cash), 1_300_000);
        assert_eq!(facts.revenue_of(Tender::CardDebit), 1_431_336);
        let summed: i64 = REVENUE_QUALIFIERS
            .iter()
            .map(|(tender, _)| facts.revenue_of(*tender))
            .sum();
        assert_eq!(summed, facts.gross_minor);
    }
}
