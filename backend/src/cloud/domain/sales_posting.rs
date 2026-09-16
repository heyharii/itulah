//! What a day of takings comes to in the ledger, as a function of the day.
//!
//! Everything this module needs arrives as an argument: the tenders already
//! grouped, what promotions gave away, what went back over the counter, and
//! the VAT rate the prices were quoted at. It reads nothing, asks nothing the
//! time of day, and mints no identities — so the same day gives the same entry
//! whenever anybody generates it, which is the property that makes
//! regeneration safe and a posted day auditable.
//!
//! `tests/kernel_purity.rs` guards that. The reason it is worth guarding here
//! and not only for depreciation: a posting rule that could read the database
//! would be a posting rule whose output depends on when it ran, and "the
//! entry we posted in March is not the entry regenerating March produces" is
//! not a bug anybody finds by looking.
//!
//! # The shape of the entry
//!
//! One day, one entry, and the split that matters is by TENDER, not by
//! product. That is the client's own chart talking: they keep
//! `4010110001 Penjualan Tunai`, `4010111001 Penjualan Debit BCA` and
//! `4010112001 Penjualan Kartu Kredit VISA` as three different income
//! accounts, because cash is in a drawer tonight and a card is a receivable
//! from a named acquirer that arrives on Thursday net of a fee. A single
//! "Sales" credit would be tidier and would make every one of their reports
//! impossible.
//!
//! So, per bucket of (method, acquirer, card kind):
//!
//! ```text
//!   Dr  the asset that bucket became      receipts - refunds
//!   Cr  the income account for it         receipts - VAT + its share of the discount
//! ```
//!
//! and once for the day:
//!
//! ```text
//!   Dr  sales_discount                    what promotions gave away
//!   Dr  sales_return                      what came back, less its VAT
//!   Cr  vat_out                           VAT taken, less VAT unwound
//!   Cr  rounding                          the residue, and only the residue
//! ```
//!
//! # Why the discount is grossed back up
//!
//! A till records what the customer paid, which is already net of every
//! promotion. Booking only that would report a smaller sale and no discount at
//! all, and "what did the Lebaran promotion cost us" would have the same
//! answer it had before promotions existed: none. So the discount is a DEBIT
//! to contra revenue and the income accounts are credited with what would have
//! been charged. The profit is identical; the story is not.
//!
//! Its VAT is not adjusted, because none was ever charged on it: the price the
//! customer was taxed on is the discounted one.
//!
//! # Why VAT is extracted per bucket
//!
//! Because then it needs no allocation. Extracting one VAT figure for the day
//! and splitting it across buckets leaves a residue of a few rupiah that has
//! to go somewhere, and the somewhere is always the same account, so it
//! accumulates. Bucket by bucket, every credit is derived from its own debit
//! and the entry ties exactly.
//!
//! # What `rounding` is for, and what it is not
//!
//! Exactly one thing: the difference between what the return DOCUMENTS say was
//! refunded and what their refund ROWS add up to. Nothing else lands there. A
//! rounding account that absorbs whatever did not tie is a rounding account
//! that hides the thing it was supposed to reveal.
//!
//! # No cost of goods
//!
//! Deliberately. Nothing in this system values inventory: there is no costing
//! method, no landed cost and no valuation layer, so any COGS figure would be
//! invented. An income statement with revenue and no cost is visibly
//! incomplete; one with revenue and a made-up cost is invisibly wrong.

/// Which side of a card a tender came from.
///
/// A separate fact from the acquirer, and not derivable from it: BCA issues
/// debit cards and acquires VISA credit transactions, and a shop with one BCA
/// terminal takes both through it.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum CardKind {
    Debit,
    Credit,
}

impl CardKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Debit => "DEBIT",
            Self::Credit => "CREDIT",
        }
    }
}

/// The card networks. An acquirer on this list settles credit; anything else
/// is a bank, and a bank taking a card at a shop counter is taking a debit.
///
/// A guess, and one the caller is told it made. It exists because the till has
/// never been asked which kind of card it just took, and refusing to post
/// every card day until it is would leave the books with no revenue at all —
/// which is the condition this whole module exists to end. A guess recorded on
/// the document and correctable by retender is the smaller wrong.
const CARD_NETWORKS: &[&str] = &[
    "VISA",
    "MASTER",
    "MASTERCARD",
    "JCB",
    "AMEX",
    "AMERICAN EXPRESS",
    "UNIONPAY",
    "CUP",
    "DINERS",
];

/// What a till said, turned into what the ledger needs.
///
/// Returns the kind and whether it had to be guessed.
pub fn classify_card(declared: Option<CardKind>, acquirer: &str) -> (CardKind, bool) {
    match declared {
        Some(kind) => (kind, false),
        None => {
            let needle = acquirer.trim().to_ascii_uppercase();
            if CARD_NETWORKS.iter().any(|network| needle == *network) {
                (CardKind::Credit, true)
            } else {
                (CardKind::Debit, true)
            }
        }
    }
}

/// One way a day's money arrived, already grouped.
///
/// The grouping is (method, acquirer, card kind) because that triple is what
/// one account in the client's chart corresponds to and what one acquirer's
/// settlement file covers.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TenderBucket {
    /// `CASH`, `CARD`, `QRIS`, `VOUCHER` or `OTHER`.
    pub method: String,
    /// The acquiring bank, card network or QRIS provider. Empty when the
    /// method needs no narrowing — cash is cash.
    pub acquirer: String,
    pub card_kind: Option<CardKind>,
    /// True when `card_kind` came from [`classify_card`] rather than the till.
    pub card_kind_inferred: bool,
    /// Money in, net of change given.
    pub receipts_minor: i64,
    /// Money back out through this same bucket.
    pub refunds_minor: i64,
    pub tender_count: i64,
}

/// A day, as the ledger has to see it.
#[derive(Clone, Debug)]
pub struct DayFigures {
    pub buckets: Vec<TenderBucket>,
    /// What promotions took off before the customer paid.
    pub discount_minor: i64,
    /// What the return documents say went back, VAT inclusive. Compared
    /// against the refund rows inside the buckets; the difference is the only
    /// thing that reaches `rounding`.
    pub returns_minor: i64,
    /// The rate the prices were quoted at, in basis points, VAT inclusive.
    pub vat_rate_bps: i32,
    /// The tax the sources themselves recorded, when every one of them did.
    ///
    /// `None` is not "no tax": it is a day where at least one till recorded
    /// none, or a return whose lines could not be traced back to what they
    /// were sold as. On such a day the rate above stands in, which is what
    /// this rule did for every day before 0276. Never half of each — a day is
    /// posted from one authority or the other, and the document says which.
    pub recorded_vat: Option<RecordedVat>,
}

/// What the sale rows and the returned lines recorded as tax, in the window.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordedVat {
    /// PPN inside the day's sales, as the tills wrote it.
    pub taken_minor: i64,
    /// PPN inside what went back, taken from the lines it was sold on.
    pub returned_minor: i64,
}

/// One side of one posting, named by meaning.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LedgerSide {
    pub semantic_key: &'static str,
    /// Which bank, which network, which provider. Empty when the meaning
    /// needs no narrowing.
    pub qualifier: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    pub memo: String,
}

impl LedgerSide {
    fn debit(semantic_key: &'static str, qualifier: &str, amount: i64, memo: String) -> Self {
        Self {
            semantic_key,
            qualifier: qualifier.to_string(),
            debit_minor: amount,
            credit_minor: 0,
            memo,
        }
    }

    fn credit(semantic_key: &'static str, qualifier: &str, amount: i64, memo: String) -> Self {
        Self {
            semantic_key,
            qualifier: qualifier.to_string(),
            debit_minor: 0,
            credit_minor: amount,
            memo,
        }
    }
}

/// What one bucket turned out to be worth, for the working paper.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BucketOutcome {
    pub vat_minor: i64,
    /// This bucket's share of the day's discount.
    pub discount_minor: i64,
}

/// A day's entry, and the figures the document keeps beside it.
#[derive(Clone, Debug)]
pub struct DayPosting {
    pub sides: Vec<LedgerSide>,
    /// The header total: the debits, which equal the credits.
    pub total_minor: i64,
    /// One per input bucket, in the same order.
    pub buckets: Vec<BucketOutcome>,
    /// VAT taken less VAT unwound by returns. Signed: negative means the day
    /// gave back more tax than it took.
    pub vat_minor: i64,
    /// What the day is worth to the income statement: takings less VAT, less
    /// what promotions gave away, less what came back. Signed, because a day
    /// of nothing but returns is a real day.
    pub revenue_minor: i64,
    /// What the tenders came to, before refunds and net of change given.
    pub receipts_minor: i64,
    /// `RECORDED` when `vat_minor` is what the sources recorded, `RATE` when
    /// the rate had to stand in for a source that recorded nothing.
    pub vat_source: &'static str,
    /// What the sources recorded, net of returns. `None` on a `RATE` day,
    /// because on that day there is no such figure.
    pub vat_recorded_minor: Option<i64>,
    /// What `vat_rate_bps` says the same day comes to. Posted on a `RATE` day,
    /// carried as validation on a `RECORDED` one.
    pub vat_recomputed_minor: i64,
}

/// Which meanings a bucket resolves to: the asset it became, and the income
/// account it belongs in.
fn meanings_for(
    method: &str,
    card_kind: Option<CardKind>,
) -> Result<(&'static str, &'static str), String> {
    match method {
        "CASH" => Ok(("cash", "revenue_cash")),
        "CARD" => match card_kind {
            Some(CardKind::Debit) => Ok(("card_receivable_debit", "revenue_debit")),
            Some(CardKind::Credit) => Ok(("card_receivable_credit", "revenue_credit")),
            // Unreachable through `build`, which classifies first. Kept as a
            // refusal rather than a default so a future caller that skips the
            // classification is told, instead of quietly posting every card to
            // the debit receivable.
            None => Err("a CARD tender must say whether it was debit or credit".to_string()),
        },
        "QRIS" => Ok(("qris_receivable", "revenue_qris")),
        // A gift card was paid for when it was sold, and the shop has been
        // holding that money as a liability ever since. Redeeming it settles
        // the liability; it does not bring money in today. The income is
        // ordinary sales income, which is why it credits the same account cash
        // does — the customer's money arrived as cash, on some earlier day.
        "VOUCHER" => Ok(("voucher_liability", "revenue_cash")),
        other => Err(format!(
            "tender method {other:?} has no posting rule; retender it to a method the \
             ledger knows before posting the day"
        )),
    }
}

/// Which qualifier narrows each meaning.
///
/// Cash needs none. A card receivable and its income account are both per
/// acquirer, because the client keeps an account per bank and per network. A
/// QRIS receivable is per provider — that is who owes the money — while their
/// chart keeps one QRIS income account, so the income side is unqualified.
fn qualifiers_for(method: &str, acquirer: &str) -> (String, String) {
    match method {
        "CARD" => (acquirer.to_string(), acquirer.to_string()),
        "QRIS" => (acquirer.to_string(), String::new()),
        _ => (String::new(), String::new()),
    }
}

/// The VAT inside a tax-inclusive figure.
fn vat_within(amount_minor: i64, rate_bps: i32) -> i64 {
    if amount_minor <= 0 || rate_bps <= 0 {
        return 0;
    }
    let rate = i128::from(rate_bps);
    let inside = i128::from(amount_minor) * rate / (10_000 + rate);
    i64::try_from(inside).unwrap_or(0)
}

/// Split `amount` across `weights` so the parts sum to exactly `amount`.
///
/// Largest remainder: every part gets its floor, and the rupiah left over go
/// to the parts that were rounded down hardest. The alternative — round each
/// part and let the total be whatever it is — leaves an entry that does not
/// balance by a few rupiah, and a poster that then has to invent a plug.
///
/// With no weight at all the whole amount goes to the first part, so a day
/// that gave everything away and took nothing still books its discount.
fn allocate(amount: i64, weights: &[i64]) -> Vec<i64> {
    let mut parts = vec![0i64; weights.len()];
    if weights.is_empty() || amount == 0 {
        return parts;
    }
    let total: i128 = weights.iter().map(|w| i128::from(*w)).sum();
    if total <= 0 {
        parts[0] = amount;
        return parts;
    }
    let mut assigned: i128 = 0;
    // (remainder, index), so the largest remainder is picked first and ties
    // break on position rather than on iteration order.
    let mut remainders: Vec<(i128, usize)> = Vec::with_capacity(weights.len());
    for (index, weight) in weights.iter().enumerate() {
        let exact = i128::from(amount) * i128::from(*weight);
        let floor = exact / total;
        parts[index] = i64::try_from(floor).unwrap_or(0);
        assigned += floor;
        remainders.push((exact - floor * total, index));
    }
    let mut left = i128::from(amount) - assigned;
    remainders.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut cursor = 0;
    while left > 0 && !remainders.is_empty() {
        let (_, index) = remainders[cursor % remainders.len()];
        parts[index] += 1;
        left -= 1;
        cursor += 1;
    }
    parts
}

/// Turn a day into an entry.
pub fn build(figures: &DayFigures) -> Result<DayPosting, String> {
    if !(0..=100_000).contains(&figures.vat_rate_bps) {
        return Err("the VAT rate is outside the range a rate can be".to_string());
    }
    if figures.discount_minor < 0 || figures.returns_minor < 0 {
        return Err("a discount and a return are both positive amounts".to_string());
    }
    if figures.buckets.is_empty() {
        return Err("that day has no takings to post".to_string());
    }
    for bucket in &figures.buckets {
        if bucket.receipts_minor < 0 || bucket.refunds_minor < 0 {
            return Err(format!(
                "the {} bucket carries a negative amount; a refund is a refund, not a \
                 negative receipt",
                bucket.method
            ));
        }
    }

    let receipts_total: i64 = figures
        .buckets
        .iter()
        .map(|bucket| bucket.receipts_minor)
        .sum();
    if let Some(recorded) = &figures.recorded_vat {
        if recorded.taken_minor < 0 || recorded.returned_minor < 0 {
            return Err("recorded tax is a positive amount on both sides".to_string());
        }
        if recorded.taken_minor > receipts_total {
            return Err(format!(
                "the sources recorded {} of tax on takings of {receipts_total}; that is \
                 not a day, it is a reading of the wrong window",
                recorded.taken_minor
            ));
        }
        if recorded.returned_minor > figures.returns_minor {
            return Err(format!(
                "the returned lines recorded {} of tax against refunds of {}",
                recorded.returned_minor, figures.returns_minor
            ));
        }
    }

    // Resolved before anything is built, so an unpostable method is refused
    // without half an entry to reason about.
    let mut meanings = Vec::with_capacity(figures.buckets.len());
    for bucket in &figures.buckets {
        meanings.push(meanings_for(&bucket.method, bucket.card_kind)?);
    }

    let weights: Vec<i64> = figures
        .buckets
        .iter()
        .map(|bucket| bucket.receipts_minor)
        .collect();
    let discounts = allocate(figures.discount_minor, &weights);
    // What the rate says, kept whatever the day is posted from: on a RECORDED
    // day this is the validation figure, and a column somebody can query beats
    // a line in a log nobody reads.
    let recomputed_taken: i64 = figures
        .buckets
        .iter()
        .map(|bucket| vat_within(bucket.receipts_minor, figures.vat_rate_bps))
        .sum();
    let recomputed_returned = vat_within(figures.returns_minor, figures.vat_rate_bps);
    // A recorded figure is one number for the day and the entry wants one per
    // bucket, so it is split the same way the discount is: largest remainder,
    // which sums back to exactly what the tills recorded. Rounding each bucket
    // at the rate instead is how the recorded total stopped being the posted
    // total in the first place.
    let bucket_vat: Vec<i64> = match &figures.recorded_vat {
        Some(recorded) => allocate(recorded.taken_minor, &weights),
        None => figures
            .buckets
            .iter()
            .map(|bucket| vat_within(bucket.receipts_minor, figures.vat_rate_bps))
            .collect(),
    };

    let mut sides: Vec<LedgerSide> = Vec::new();
    let mut outcomes = Vec::with_capacity(figures.buckets.len());
    let mut vat_taken: i64 = 0;
    let mut revenue: i64 = 0;
    let mut refunded: i64 = 0;
    let mut receipts: i64 = 0;

    for (index, bucket) in figures.buckets.iter().enumerate() {
        let (asset_key, income_key) = meanings[index];
        let (asset_qualifier, income_qualifier) = qualifiers_for(&bucket.method, &bucket.acquirer);
        let vat = bucket_vat[index];
        let share = discounts[index];
        let income = bucket.receipts_minor - vat + share;
        let net = bucket.receipts_minor - bucket.refunds_minor;

        let label = if bucket.acquirer.is_empty() {
            bucket.method.clone()
        } else {
            format!("{} {}", bucket.method, bucket.acquirer)
        };

        if net > 0 {
            sides.push(LedgerSide::debit(
                asset_key,
                &asset_qualifier,
                net,
                format!("{label} takings"),
            ));
        } else if net < 0 {
            sides.push(LedgerSide::credit(
                asset_key,
                &asset_qualifier,
                -net,
                format!("{label} refunded more than it took"),
            ));
        }
        if income > 0 {
            sides.push(LedgerSide::credit(
                income_key,
                &income_qualifier,
                income,
                format!("{label} sales"),
            ));
        }

        vat_taken += vat;
        revenue += income;
        refunded += bucket.refunds_minor;
        receipts += bucket.receipts_minor;
        outcomes.push(BucketOutcome {
            vat_minor: vat,
            discount_minor: share,
        });
    }

    if figures.discount_minor > 0 {
        sides.push(LedgerSide::debit(
            "sales_discount",
            "",
            figures.discount_minor,
            "promotions given away".to_string(),
        ));
    }

    let vat_returned = match &figures.recorded_vat {
        Some(recorded) => recorded.returned_minor,
        None => recomputed_returned,
    };
    let returns_net = figures.returns_minor - vat_returned;
    if returns_net > 0 {
        sides.push(LedgerSide::debit(
            "sales_return",
            "",
            returns_net,
            "returned over the counter".to_string(),
        ));
    }

    let vat = vat_taken - vat_returned;
    if vat > 0 {
        sides.push(LedgerSide::credit(
            "vat_out",
            "",
            vat,
            "PPN keluaran".to_string(),
        ));
    } else if vat < 0 {
        sides.push(LedgerSide::debit(
            "vat_out",
            "",
            -vat,
            "PPN unwound by returns".to_string(),
        ));
    }

    // The documents say one thing about what went back and their refund rows
    // say another. Nothing else reaches this account.
    let residue = figures.returns_minor - refunded;
    if residue > 0 {
        sides.push(LedgerSide::credit(
            "rounding",
            "",
            residue,
            "refund documents exceed their refund rows".to_string(),
        ));
    } else if residue < 0 {
        sides.push(LedgerSide::debit(
            "rounding",
            "",
            -residue,
            "refund rows exceed their refund documents".to_string(),
        ));
    }

    let debits: i64 = sides.iter().map(|side| side.debit_minor).sum();
    let credits: i64 = sides.iter().map(|side| side.credit_minor).sum();
    if debits != credits {
        // Unreachable, and checked anyway. The identity above is a proof about
        // arithmetic, and a proof that is never executed is a comment.
        return Err(format!(
            "the day's rule produced an entry that does not balance: debits {debits}, \
             credits {credits}"
        ));
    }
    if debits == 0 {
        return Err("that day nets to nothing; there is no entry to post".to_string());
    }

    Ok(DayPosting {
        sides,
        total_minor: debits,
        buckets: outcomes,
        vat_minor: vat,
        revenue_minor: revenue - figures.discount_minor - returns_net,
        receipts_minor: receipts,
        vat_source: if figures.recorded_vat.is_some() {
            "RECORDED"
        } else {
            "RATE"
        },
        vat_recorded_minor: figures
            .recorded_vat
            .as_ref()
            .map(|recorded| recorded.taken_minor - recorded.returned_minor),
        vat_recomputed_minor: recomputed_taken - recomputed_returned,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket(method: &str, acquirer: &str, kind: Option<CardKind>, receipts: i64) -> TenderBucket {
        TenderBucket {
            method: method.into(),
            acquirer: acquirer.into(),
            card_kind: kind,
            card_kind_inferred: false,
            receipts_minor: receipts,
            refunds_minor: 0,
            tender_count: 1,
        }
    }

    #[test]
    fn a_cash_day_credits_income_and_the_tax_it_carried() {
        let day = DayFigures {
            buckets: vec![bucket("CASH", "", None, 1_110_000)],
            discount_minor: 0,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(posted.total_minor, 1_110_000);
        assert_eq!(posted.vat_minor, 110_000);
        assert_eq!(posted.revenue_minor, 1_000_000);
        assert_eq!(
            posted.sides,
            vec![
                LedgerSide::debit("cash", "", 1_110_000, "CASH takings".into()),
                LedgerSide::credit("revenue_cash", "", 1_000_000, "CASH sales".into()),
                LedgerSide::credit("vat_out", "", 110_000, "PPN keluaran".into()),
            ]
        );
    }

    #[test]
    fn every_mix_of_tenders_still_balances() {
        let day = DayFigures {
            buckets: vec![
                bucket("CASH", "", None, 1_110_000),
                bucket("CARD", "BCA", Some(CardKind::Debit), 2_220_000),
                bucket("CARD", "VISA", Some(CardKind::Credit), 3_330_000),
                bucket("QRIS", "GOPAY", None, 555_000),
                bucket("VOUCHER", "", None, 200_000),
            ],
            discount_minor: 117_000,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        let debits: i64 = posted.sides.iter().map(|s| s.debit_minor).sum();
        let credits: i64 = posted.sides.iter().map(|s| s.credit_minor).sum();
        assert_eq!(debits, credits);
        // The discount is split across the buckets and nothing is lost doing
        // it — the reason `allocate` exists.
        let shared: i64 = posted.buckets.iter().map(|b| b.discount_minor).sum();
        assert_eq!(shared, 117_000);
        // Every meaning a mixed day needs, and each qualified the way its
        // account is.
        let keys: Vec<(&str, &str)> = posted
            .sides
            .iter()
            .map(|side| (side.semantic_key, side.qualifier.as_str()))
            .collect();
        assert!(keys.contains(&("card_receivable_debit", "BCA")));
        assert!(keys.contains(&("revenue_debit", "BCA")));
        assert!(keys.contains(&("card_receivable_credit", "VISA")));
        assert!(keys.contains(&("revenue_credit", "VISA")));
        assert!(keys.contains(&("qris_receivable", "GOPAY")));
        assert!(keys.contains(&("revenue_qris", "")));
        assert!(keys.contains(&("voucher_liability", "")));
    }

    #[test]
    fn a_return_reduces_income_and_unwinds_its_tax() {
        let mut cash = bucket("CASH", "", None, 1_110_000);
        cash.refunds_minor = 111_000;
        let day = DayFigures {
            buckets: vec![cash],
            discount_minor: 0,
            returns_minor: 111_000,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(posted.receipts_minor, 1_110_000);
        assert_eq!(posted.vat_minor, 110_000 - 11_000);
        assert_eq!(posted.revenue_minor, 1_000_000 - 100_000);
        let debits: i64 = posted.sides.iter().map(|s| s.debit_minor).sum();
        let credits: i64 = posted.sides.iter().map(|s| s.credit_minor).sum();
        assert_eq!(debits, credits);
        // Nothing reached rounding: the documents and their rows agree.
        assert!(posted.sides.iter().all(|s| s.semantic_key != "rounding"));
    }

    #[test]
    fn a_refund_document_its_rows_do_not_cover_lands_in_rounding_and_nowhere_else() {
        let day = DayFigures {
            buckets: vec![bucket("CASH", "", None, 1_110_000)],
            discount_minor: 0,
            // A return document for 50,000 with no refund rows behind it.
            returns_minor: 50_000,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        let rounding = posted
            .sides
            .iter()
            .find(|side| side.semantic_key == "rounding")
            .unwrap_or_else(|| panic!("the residue should be visible"));
        assert_eq!(rounding.credit_minor, 50_000);
        let debits: i64 = posted.sides.iter().map(|s| s.debit_minor).sum();
        let credits: i64 = posted.sides.iter().map(|s| s.credit_minor).sum();
        assert_eq!(debits, credits);
    }

    #[test]
    fn a_method_the_ledger_cannot_place_is_refused_by_name() {
        let day = DayFigures {
            buckets: vec![bucket("OTHER", "", None, 10_000)],
            discount_minor: 0,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let refusal = build(&day).err().unwrap_or_else(|| panic!("should refuse"));
        assert!(refusal.contains("OTHER"), "said: {refusal}");
        assert!(refusal.contains("retender"), "said: {refusal}");
    }

    #[test]
    fn a_card_with_no_kind_is_guessed_from_the_acquirer_and_says_so() {
        assert_eq!(classify_card(None, "BCA"), (CardKind::Debit, true));
        assert_eq!(classify_card(None, "visa"), (CardKind::Credit, true));
        assert_eq!(
            classify_card(Some(CardKind::Credit), "BCA"),
            (CardKind::Credit, false)
        );
    }

    #[test]
    fn an_allocation_never_loses_or_invents_a_rupiah() {
        for amount in [0i64, 1, 7, 999, 1_000_000, 117_000] {
            for weights in [
                vec![1, 1, 1],
                vec![0, 0, 0],
                vec![1_110_000, 2_220_000, 3_330_000, 555_000],
                vec![7],
            ] {
                let parts = allocate(amount, &weights);
                assert_eq!(
                    parts.iter().sum::<i64>(),
                    amount,
                    "{amount} across {weights:?} came to {parts:?}"
                );
                assert!(parts.iter().all(|p| *p >= 0));
            }
        }
    }
}
