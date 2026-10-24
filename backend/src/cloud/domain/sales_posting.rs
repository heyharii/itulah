//! What a day of takings comes to in the ledger, as a function of the day.
//!
//! Everything this module needs arrives as an argument: the tenders already
//! grouped, what went back over the counter, and the tax figures the day is
//! reported with. It reads nothing, asks nothing the time of day, and mints no
//! identities — so the same day gives the same entry whenever anybody
//! generates it, which is the property that makes regeneration safe and a
//! posted day auditable.
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
//!   Cr  the income account for it         receipts: what the customer was charged
//! ```
//!
//! with two buckets that have no asset of their own: a free VOUCHER debits
//! `sales_discount` (owner decision 13 — nothing was owed when it was issued,
//! so the value spent is a discount), and returned goods paying for their
//! replacement are answered by the return document below. And once for the
//! day:
//!
//! ```text
//!   Dr  sales_return                      what the return documents say went back
//!   Cr  other_income_expense              the residue, when the documents exceed their rows
//!   Dr  rounding_loss                     the residue, when the rows exceed their documents
//! ```
//!
//! # Promotions are inside revenue, not beside it
//!
//! A till records what the customer paid, which is already net of every
//! promotion, markdown and bundle price. That net figure IS the sale: the
//! income accounts are credited with it, and nothing is debited to
//! `sales_discount` for what a promotion took off (owner decision, 25 Sep
//! 2026).
//!
//! This is the client's own practice, and the reason is comparability. Their
//! 2025 books credit Penjualan with what each line was actually sold for and
//! leave `4012 Potongan Penjualan` holding only a small residue of bill-level
//! discounts — 22 million against the 829 million of promotion the POS
//! summary shows. Grossing every promotion back up, as this rule once did,
//! put our revenue line some 800 million above theirs for the same trade and
//! made every year-on-year comparison a reconciliation exercise. Our POS has
//! no bill-level or cashier discount at all — every rupiah off comes from a
//! promotion rule — so the residue the client books to 4012 has nothing to
//! correspond to here, and 4012 carries free vouchers only.
//!
//! What a promotion cost is still answerable, and exactly: from the POS sales
//! data (`edge_sale_promotion`, the per-division sales summary, the campaign
//! reports), which record every benefit per rule and per line. The GL is not
//! the place that question is asked. The day's `discount_minor` is carried on
//! the document as that reported figure and posts nowhere.
//!
//! # No tax line
//!
//! PPN is ignored (owner policy P11), and `0377` deleted the `vat_out` and
//! `vat_in` meanings. So no side this rule builds names a tax account — not on
//! a sale and not on a return: the whole receipt is revenue and the whole
//! refund is `sales_return`. The rate and whatever tax the tills recorded are
//! still read and kept on the document (`vat_recorded_minor`,
//! `vat_recomputed_minor`) for the day's report; `vat_minor`, what was posted
//! to tax, is always nought.
//!
//! # What the residue accounts are for, and what they are not
//!
//! Exactly one thing: the difference between what the return DOCUMENTS say was
//! refunded and what their refund ROWS (and the returned goods given out again
//! as a replacement) add up to. Nothing else lands there. An account that
//! absorbs whatever did not tie is an account that hides the thing it was
//! supposed to reveal.
//!
//! The sign picks the side. Documents over rows is value the shop kept — money
//! never leaves the till on a return (owner decision 11), so a return worth
//! more than its replacement is forfeited to `other_income_expense`. Rows over
//! documents is money the shop paid out with nothing to show for it and debits
//! `rounding_loss`. Neither may ever put a cost inside a revenue account.
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
    /// Set when the bucket's payment method settles straight into a bank
    /// (0468): the MDR it keeps, in basis points of the net taken. The day
    /// then debits the bank net of MDR and books the MDR at once; otherwise
    /// the acquirer owes the gross and the MDR waits for its settlement.
    pub direct_mdr_bps: Option<i32>,
    /// The bank a DIRECT_TO_BANK bucket lands in — the bank of the EDC it
    /// was paid on. Set with `direct_mdr_bps`; the day then debits that bank
    /// (`bank_giro`) instead of an acquirer receivable (owner, 1 Oct 2026:
    /// digital takings go straight to Cash in Bank).
    pub direct_bank: Option<String>,
    /// The Cash In Bank account that EDC's kind of payment lands in, when head
    /// office named one for the shop's machine (0989). The bank's side then
    /// posts to that account instead of the `bank_giro` link of `direct_bank`.
    pub direct_account: Option<String>,
}

/// A day, as the ledger has to see it.
#[derive(Clone, Debug)]
pub struct DayFigures {
    pub buckets: Vec<TenderBucket>,
    /// What promotions took off before the customer paid, as the tills
    /// reported it. Carried to the document for the report and posted
    /// nowhere: the receipts are already net of it, and that net is the sale
    /// (see "Promotions are inside revenue").
    pub discount_minor: i64,
    /// What the return documents say went back, VAT inclusive, and what
    /// `sales_return` is debited with. Compared against the refund rows inside
    /// the buckets; the difference is the only thing that reaches
    /// `other_income_expense` or `rounding_loss`.
    pub returns_minor: i64,
    /// The rate the prices were quoted at, in basis points, VAT inclusive.
    pub vat_rate_bps: i32,
    /// The tax the sources themselves recorded, when every one of them did.
    ///
    /// `None` is not "no tax": it is a day where at least one till recorded
    /// none, or a return whose lines could not be traced back to what they
    /// were sold as. On such a day the rate above stands in, which is what
    /// this rule did for every day before 0276. Never half of each — a day is
    /// reported from one authority or the other, and the document says which.
    /// Reported only: no tax is posted while PPN is ignored (P11).
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
    /// The client account the side lands in when somebody chose it — a shop
    /// EDC's Cash In Bank account (0989). The meaning still says whose books
    /// the side is in; the account replaces only what its link would say.
    pub account_code: Option<String>,
}

impl LedgerSide {
    fn debit(semantic_key: &'static str, qualifier: &str, amount: i64, memo: String) -> Self {
        Self {
            semantic_key,
            qualifier: qualifier.to_string(),
            debit_minor: amount,
            credit_minor: 0,
            memo,
            account_code: None,
        }
    }

    fn credit(semantic_key: &'static str, qualifier: &str, amount: i64, memo: String) -> Self {
        Self {
            semantic_key,
            qualifier: qualifier.to_string(),
            debit_minor: 0,
            credit_minor: amount,
            memo,
            account_code: None,
        }
    }

    fn landing_in(mut self, account_code: Option<String>) -> Self {
        self.account_code = account_code;
        self
    }
}

/// The account a bucket's bank side lands in: the shop EDC's own, only on the
/// side that is the bank (0989).
fn landing(bucket: &TenderBucket, asset_key: &str) -> Option<String> {
    if asset_key == "bank_giro" {
        bucket.direct_account.clone()
    } else {
        None
    }
}

/// What one bucket turned out to be worth, for the working paper.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BucketOutcome {
    /// Tax posted from this bucket: always nought while PPN is ignored (P11).
    pub vat_minor: i64,
    /// Discount posted from this bucket's sales: always nought, because a
    /// promotion is inside the price the bucket was credited with. Kept so a
    /// document generated under the old rule still reads back.
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
    /// Tax the entry posted. Always nought while PPN is ignored (P11); the
    /// tax the day carried is in `vat_recorded_minor` and
    /// `vat_recomputed_minor`, reported and not posted.
    pub vat_minor: i64,
    /// What the day is worth to the income statement: what the income
    /// accounts were credited with, less the free vouchers debited to
    /// `sales_discount`, less what came back. Signed, because a day of nothing
    /// but returns is a real day.
    pub revenue_minor: i64,
    /// What the tenders came to, before refunds and net of change given.
    pub receipts_minor: i64,
    /// `RECORDED` when every source recorded its tax, `RATE` when the rate
    /// had to stand in for a source that recorded nothing. Reported only.
    pub vat_source: &'static str,
    /// What the sources recorded, net of returns. `None` on a `RATE` day,
    /// because on that day there is no such figure. Reported only.
    pub vat_recorded_minor: Option<i64>,
    /// What `vat_rate_bps` says the same day comes to. Reported only.
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
        // QRIS rides the EDC of a bank (owner decision 25 Sep, no new account):
        // the same debit-card receivable and sales leaf as that bank's debit
        // cards, told apart by the tender kind on the sale-day line. A QRIS
        // bucket that names no bank never reaches here — `exception_reason`
        // sends it to the sale-day exception queue first.
        "QRIS" => Ok(("card_receivable_debit", "revenue_debit")),
        // An e-wallet (OVO, GoPay, …) is owed by its provider until it pays,
        // like a debit card by its bank (0468's payment_method_roles).
        "EWALLET" => Ok(("card_receivable_debit", "revenue_debit")),
        // Every voucher is free (owner decision 13): nothing was owed when it
        // was issued, so the value spent is a sales discount (4012), not a
        // tender and not a liability being settled.
        "VOUCHER" => Ok(("sales_discount", "revenue_cash")),
        // The employee benefit balance (owner, 1 Oct 2026): the part of the
        // basket the balance paid is a sales discount, like a free voucher —
        // not a welfare expense and not PPh 21 natura.
        "BENEFIT" => Ok(("sales_discount", "revenue_cash")),
        // Goods taken back on a RETURN and given out again as the replacement
        // (owner decision 11: money never leaves the till). The replacement is
        // a sale; what paid for it is the returned goods, so there is no asset
        // side — the return document itself is the debit, on `sales_return`.
        RETURN_CREDIT => Ok(("", "revenue_cash")),
        // No online sales (owner decision 14): refused by name, and kept out
        // of the day by `exception_reason` so the rest of the day still posts.
        "OTHER" => Err(ONLINE_REFUSAL.to_string()),
        other => Err(format!(
            "tender method {other:?} has no posting rule; retender it to a method the \
             ledger knows before posting the day"
        )),
    }
}

/// The method a day reading uses for returned goods given out again as the
/// replacement: not a wire tender, a bucket `read_day` builds from the returns.
pub const RETURN_CREDIT: &str = "RETURN";

const ONLINE_REFUSAL: &str =
    "an OTHER (online/marketplace) tender has no posting rule: this company \
     does not sell online (owner decision 14). Retender it at the source to the method that \
     really took the money, then generate the day again";

/// Why a bucket cannot go into the sales-day entry and has to wait in the
/// exception queue instead — or `None` when it can post.
///
/// The day still posts without it (brief stage 2 point 1): one bad tender
/// line must not hold up every other rupiah the shop took that day.
pub fn exception_reason(method: &str, acquirer: &str) -> Option<String> {
    match method {
        "EWALLET" if acquirer.trim().is_empty() => Some(
            "e-wallet tender without its provider: the till has to send which wallet took the \
             money (the payment method's bank_code), then resolve this line"
                .to_string(),
        ),
        "QRIS" if acquirer.trim().is_empty() => Some(
            "QRIS tender without the bank of its EDC terminal: register the terminal under \
             Finance EDC terminals (or let the POS send the bank), then resolve this line"
                .to_string(),
        ),
        "OTHER" => Some(ONLINE_REFUSAL.to_string()),
        _ => None,
    }
}

/// Which qualifier narrows each meaning.
///
/// Cash needs none. Card and QRIS use the same debit or credit acquirer route;
/// OTHER remains qualified by the counterparty that owes the money.
fn qualifiers_for(method: &str, acquirer: &str) -> (String, String) {
    match method {
        "CARD" | "QRIS" | "EWALLET" => (acquirer.to_string(), acquirer.to_string()),
        "OTHER" => (acquirer.to_string(), String::new()),
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

/// Turn a day into an entry.
/// Finance's choices that change the shape of a day's entry.
#[derive(Clone, Copy, Debug, Default)]
pub struct DayRules {
    /// ERPNext's "Enable discount accounting for selling": the promotions the
    /// tills took off are credited back to revenue, spread over the tenders in
    /// proportion, and debited to `promotion_discount`, so revenue reads gross
    /// and the discount has its own account. Off by default: the client books
    /// promotions net (owner policy P18).
    pub discount_accounting: bool,
}

pub fn build(figures: &DayFigures) -> Result<DayPosting, String> {
    build_with(figures, DayRules::default())
}

pub fn build_with(figures: &DayFigures, rules: DayRules) -> Result<DayPosting, String> {
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

    // What the rate says the day's tax came to, and what came back with the
    // returns. Reported beside the recorded figure and never posted: PPN is
    // ignored (owner policy P11) and 0377 deleted `vat_out`, so a side naming
    // it would be refused rather than land anywhere.
    let recomputed_taken: i64 = figures
        .buckets
        .iter()
        .map(|bucket| vat_within(bucket.receipts_minor, figures.vat_rate_bps))
        .sum();
    let recomputed_returned = vat_within(figures.returns_minor, figures.vat_rate_bps);

    let mut sides: Vec<LedgerSide> = Vec::new();
    let mut outcomes = Vec::with_capacity(figures.buckets.len());
    let mut revenue: i64 = 0;
    let mut vouchers: i64 = 0;
    let mut refunded: i64 = 0;
    let mut receipts: i64 = 0;

    for (index, bucket) in figures.buckets.iter().enumerate() {
        let (asset_key, income_key) = meanings[index];
        let (asset_qualifier, income_qualifier) = qualifiers_for(&bucket.method, &bucket.acquirer);
        // What the customers were charged through this bucket. Already net of
        // every promotion, and that net is the sale.
        let income = bucket.receipts_minor;
        let net = bucket.receipts_minor - bucket.refunds_minor;

        let label = if bucket.acquirer.is_empty() {
            bucket.method.clone()
        } else {
            format!("{} {}", bucket.method, bucket.acquirer)
        };

        if asset_key.is_empty() {
            // Returned goods paying for the replacement: they answer the
            // return document, exactly as a refund row would.
            refunded += bucket.receipts_minor;
        } else if net > 0 {
            if asset_key == "sales_discount" {
                vouchers += net;
            }
            // Straight to the bank: the EDC's bank account takes the money
            // the day it was taken, and no acquirer owes anything.
            let (asset_key, asset_qualifier) = match &bucket.direct_bank {
                Some(bank) => ("bank_giro", bank.clone()),
                None => (asset_key, asset_qualifier.clone()),
            };
            let fee = bucket
                .direct_mdr_bps
                .map(|bps| (net * i64::from(bps) + 5_000) / 10_000)
                .unwrap_or(0);
            sides.push(
                LedgerSide::debit(
                    asset_key,
                    &asset_qualifier,
                    net - fee,
                    format!("{label} takings"),
                )
                .landing_in(landing(bucket, asset_key)),
            );
            if fee > 0 {
                sides.push(LedgerSide::debit(
                    "card_fee",
                    &asset_qualifier,
                    fee,
                    format!("{label} MDR, settled straight to the bank"),
                ));
            }
        } else if net < 0 {
            if asset_key == "sales_discount" {
                vouchers += net;
            }
            let (asset_key, asset_qualifier) = match &bucket.direct_bank {
                Some(bank) => ("bank_giro", bank.clone()),
                None => (asset_key, asset_qualifier.clone()),
            };
            sides.push(
                LedgerSide::credit(
                    asset_key,
                    &asset_qualifier,
                    -net,
                    format!("{label} refunded more than it took"),
                )
                .landing_in(landing(bucket, asset_key)),
            );
        }
        if income > 0 {
            sides.push(LedgerSide::credit(
                income_key,
                &income_qualifier,
                income,
                format!("{label} sales"),
            ));
        }

        revenue += income;
        refunded += bucket.refunds_minor;
        receipts += bucket.receipts_minor;
        outcomes.push(BucketOutcome {
            vat_minor: 0,
            discount_minor: 0,
        });
    }

    // Discount accounting: the promotion, credited back to each tender's
    // revenue in proportion to what it took and debited to its own account.
    if rules.discount_accounting && figures.discount_minor > 0 && receipts > 0 {
        let mut left = figures.discount_minor;
        let incomes: Vec<(usize, i64)> = figures
            .buckets
            .iter()
            .enumerate()
            .filter(|(index, bucket)| bucket.receipts_minor > 0 && !meanings[*index].1.is_empty())
            .map(|(index, bucket)| (index, bucket.receipts_minor))
            .collect();
        for (position, (index, taken)) in incomes.iter().enumerate() {
            let share = if position + 1 == incomes.len() {
                left
            } else {
                figures.discount_minor * taken / receipts
            };
            left -= share;
            if share > 0 {
                let bucket = &figures.buckets[*index];
                let (_, income_qualifier) = qualifiers_for(&bucket.method, &bucket.acquirer);
                sides.push(LedgerSide::credit(
                    meanings[*index].1,
                    &income_qualifier,
                    share,
                    format!("{} promotions, gross", bucket.method),
                ));
            }
        }
        sides.push(LedgerSide::debit(
            "promotion_discount",
            "",
            figures.discount_minor,
            "promotions taken off at the till".to_string(),
        ));
    }

    // The whole of what went back, tax and all: with no tax line there is
    // nothing to take out of it.
    let returns_net = figures.returns_minor;
    if returns_net > 0 {
        sides.push(LedgerSide::debit(
            "sales_return",
            "",
            returns_net,
            "returned over the counter".to_string(),
        ));
    }

    // The documents say one thing about what went back and their refund rows
    // say another. Nothing else reaches these two accounts, and the sign picks
    // which: a residue the shop kept is income, a residue it paid out is cost.
    let residue = figures.returns_minor - refunded;
    if residue > 0 {
        // Money never leaves the till on a return (owner decision 11), so a
        // return worth more than the replacement leaves the difference with
        // the shop: forfeited, to Pendapatan (Biaya) Lain-lain.
        sides.push(LedgerSide::credit(
            "other_income_expense",
            "",
            residue,
            "returned goods worth more than their replacement: difference forfeited".to_string(),
        ));
    } else if residue < 0 {
        sides.push(LedgerSide::debit(
            "rounding_loss",
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
        vat_minor: 0,
        revenue_minor: revenue - vouchers - returns_net,
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
            direct_mdr_bps: None,
            direct_bank: None,
            direct_account: None,
        }
    }

    /// The sum of one meaning's debits less its credits, across the entry.
    fn net(posted: &DayPosting, key: &str) -> i64 {
        posted
            .sides
            .iter()
            .filter(|side| side.semantic_key == key)
            .map(|side| side.debit_minor - side.credit_minor)
            .sum()
    }

    fn assert_balanced(posted: &DayPosting) {
        let debits: i64 = posted.sides.iter().map(|s| s.debit_minor).sum();
        let credits: i64 = posted.sides.iter().map(|s| s.credit_minor).sum();
        assert_eq!(debits, credits, "{:?}", posted.sides);
    }

    fn assert_no_tax_line(posted: &DayPosting) {
        assert!(
            posted
                .sides
                .iter()
                .all(|s| s.semantic_key != "vat_out" && s.semantic_key != "vat_in"),
            "PPN is ignored (P11): no tax line may be built\n{:?}",
            posted.sides
        );
    }

    #[test]
    fn a_cash_day_credits_the_whole_receipt_to_income_and_no_tax() {
        let day = DayFigures {
            buckets: vec![bucket("CASH", "", None, 1_110_000)],
            discount_minor: 0,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(posted.total_minor, 1_110_000);
        assert_eq!(posted.vat_minor, 0);
        assert_eq!(posted.revenue_minor, 1_110_000);
        // Reported beside the day, not posted.
        assert_eq!(posted.vat_recomputed_minor, 110_000);
        assert_eq!(
            posted.sides,
            vec![
                LedgerSide::debit("cash", "", 1_110_000, "CASH takings".into()),
                LedgerSide::credit("revenue_cash", "", 1_110_000, "CASH sales".into()),
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
        assert_balanced(&posted);
        assert_no_tax_line(&posted);
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
        assert!(keys.contains(&("card_receivable_debit", "GOPAY")));
        assert!(keys.contains(&("revenue_debit", "GOPAY")));
        // The voucher, and only the voucher, reaches the discount account.
        assert_eq!(net(&posted, "sales_discount"), 200_000);
        assert!(posted.buckets.iter().all(|b| b.discount_minor == 0));
        assert_eq!(
            posted.revenue_minor,
            1_110_000 + 2_220_000 + 3_330_000 + 555_000
        );
    }

    /// A shirt listed at 249,950 sold at 224,950 under a line promotion, paid
    /// by card; a second sold at list for cash. The promotion is inside the
    /// price, as the client books it: revenue is what was charged, per tender,
    /// and nothing reaches 4012.
    #[test]
    fn a_line_promotion_is_inside_revenue_and_never_reaches_the_discount_account() {
        let day = DayFigures {
            buckets: vec![
                bucket("CASH", "", None, 249_950),
                bucket("CARD", "BCA", Some(CardKind::Debit), 224_950),
            ],
            discount_minor: 25_000,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        assert_balanced(&posted);
        assert_no_tax_line(&posted);
        assert_eq!(net(&posted, "sales_discount"), 0);
        assert!(posted
            .sides
            .iter()
            .all(|s| s.semantic_key != "sales_discount"));
        assert_eq!(net(&posted, "revenue_cash"), -249_950);
        assert_eq!(net(&posted, "revenue_debit"), -224_950);
        assert_eq!(net(&posted, "cash"), 249_950);
        assert_eq!(net(&posted, "card_receivable_debit"), 224_950);
        assert_eq!(posted.revenue_minor, 249_950 + 224_950);
        assert_eq!(posted.total_minor, 249_950 + 224_950);
        assert!(posted.buckets.iter().all(|b| b.discount_minor == 0));
    }

    #[test]
    fn a_return_debits_sales_return_at_the_full_amount_and_unwinds_no_tax() {
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
        assert_eq!(posted.vat_minor, 0);
        assert_eq!(posted.revenue_minor, 1_110_000 - 111_000);
        assert_eq!(net(&posted, "sales_return"), 111_000);
        assert_balanced(&posted);
        assert_no_tax_line(&posted);
        // Nothing reached the residue accounts, on either side: the documents
        // and their rows agree.
        assert!(posted.sides.iter().all(|s| s.semantic_key != "rounding"
            && s.semantic_key != "rounding_loss"
            && s.semantic_key != "other_income_expense"));
    }

    /// The case that used to be refused: the tills recorded their tax and a
    /// return came back. The recorded return tax once shrank the return debit
    /// and debited `vat_out`, a meaning 0377 deleted.
    #[test]
    fn a_recorded_tax_day_with_a_promotion_and_a_return_posts_no_tax_and_no_promotion() {
        let mut cash = bucket("CASH", "", None, 555_000);
        cash.refunds_minor = 111_000;
        let day = DayFigures {
            buckets: vec![
                cash,
                bucket("CARD", "VISA", Some(CardKind::Credit), 1_000_000),
                bucket("QRIS", "BNI", None, 300_000),
            ],
            discount_minor: 150_000,
            returns_minor: 111_000,
            vat_rate_bps: 1_100,
            recorded_vat: Some(RecordedVat {
                taken_minor: 183_000,
                returned_minor: 11_000,
            }),
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        assert_balanced(&posted);
        assert_no_tax_line(&posted);
        assert_eq!(net(&posted, "sales_discount"), 0);
        assert_eq!(net(&posted, "sales_return"), 111_000);
        // Income per tender is what that tender was charged.
        assert_eq!(net(&posted, "revenue_cash"), -555_000);
        assert_eq!(net(&posted, "revenue_credit"), -1_000_000);
        assert_eq!(net(&posted, "revenue_debit"), -300_000);
        assert_eq!(net(&posted, "cash"), 555_000 - 111_000);
        assert_eq!(posted.vat_minor, 0);
        assert_eq!(posted.vat_source, "RECORDED");
        assert_eq!(posted.vat_recorded_minor, Some(183_000 - 11_000));
        assert_eq!(
            posted.revenue_minor,
            555_000 + 1_000_000 + 300_000 - 111_000
        );
    }

    #[test]
    fn a_return_worth_more_than_its_replacement_is_forfeited_to_other_income() {
        let day = DayFigures {
            buckets: vec![bucket("CASH", "", None, 1_110_000)],
            discount_minor: 0,
            // A return document for 50,000 with no refund rows behind it.
            returns_minor: 50_000,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        let forfeited = posted
            .sides
            .iter()
            .find(|side| side.semantic_key == "other_income_expense")
            .unwrap_or_else(|| panic!("the residue should be visible"));
        assert_eq!(forfeited.credit_minor, 50_000);
        assert!(posted.sides.iter().all(|s| s.semantic_key != "rounding"));
        let debits: i64 = posted.sides.iter().map(|s| s.debit_minor).sum();
        let credits: i64 = posted.sides.iter().map(|s| s.credit_minor).sum();
        assert_eq!(debits, credits);
        // And the loss side is untouched: a residue the shop kept is income.
        assert!(posted
            .sides
            .iter()
            .all(|s| s.semantic_key != "rounding_loss"));
    }

    /// The other side of the same residue. A refund row with no return
    /// document behind it is money that left the drawer and nothing to show
    /// for it: a cost, and a cost is never a debit to `rounding`, which sits
    /// in revenue. It has its own meaning on the other-expense account.
    #[test]
    fn a_refund_row_its_documents_do_not_cover_lands_in_rounding_loss_and_never_in_rounding() {
        let mut cash = bucket("CASH", "", None, 1_110_000);
        // A refund row for 50,000 with no return document behind it.
        cash.refunds_minor = 50_000;
        let day = DayFigures {
            buckets: vec![cash],
            discount_minor: 0,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|error| panic!("{error}"));
        let loss = posted
            .sides
            .iter()
            .find(|side| side.semantic_key == "rounding_loss")
            .unwrap_or_else(|| panic!("the residue should be visible, on the loss side"));
        assert_eq!(loss.debit_minor, 50_000);
        assert_eq!(loss.credit_minor, 0);
        assert!(
            posted.sides.iter().all(|s| s.semantic_key != "rounding"),
            "a residue that cost money must not reach the income-side meaning"
        );
        let debits: i64 = posted.sides.iter().map(|s| s.debit_minor).sum();
        let credits: i64 = posted.sides.iter().map(|s| s.credit_minor).sum();
        assert_eq!(debits, credits);
    }

    #[test]
    fn a_method_the_ledger_cannot_place_is_refused_by_name() {
        // OTHER has its own refusal (no online sales) and waits in the
        // exception queue; this is a method this build has never heard of —
        // a reading of a different wire, not a day.
        let day = DayFigures {
            buckets: vec![bucket("CHEQUE", "", None, 10_000)],
            discount_minor: 0,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let refusal = build(&day).err().unwrap_or_else(|| panic!("should refuse"));
        assert!(refusal.contains("CHEQUE"), "said: {refusal}");
        assert!(refusal.contains("retender"), "said: {refusal}");
    }

    #[test]
    fn an_online_tender_and_a_bankless_qris_wait_in_the_exception_queue() {
        assert!(exception_reason("OTHER", "TOKOPEDIA").is_some());
        assert!(exception_reason("QRIS", "").is_some());
        assert!(exception_reason("QRIS", "BNI").is_none());
        assert!(exception_reason("CASH", "").is_none());
        let day = DayFigures {
            buckets: vec![bucket("OTHER", "TOKOPEDIA", None, 50_000)],
            discount_minor: 0,
            returns_minor: 0,
            vat_rate_bps: 1_100,
            recorded_vat: None,
        };
        let refusal = build(&day).err().unwrap_or_else(|| panic!("should refuse"));
        assert!(refusal.contains("online"), "said: {refusal}");
    }

    /// Return 100,000 for a replacement of 130,000: 30,000 more comes in as
    /// cash, the return is the debit, the replacement is the sale.
    #[test]
    fn a_return_paid_for_by_returned_goods_moves_no_money() {
        let day = DayFigures {
            buckets: vec![
                bucket("CASH", "", None, 30_000),
                bucket(RETURN_CREDIT, "", None, 100_000),
            ],
            discount_minor: 0,
            returns_minor: 100_000,
            vat_rate_bps: 0,
            recorded_vat: None,
        };
        let posted = build(&day).unwrap_or_else(|refusal| panic!("refused: {refusal}"));
        let debit = |key: &str| -> i64 {
            posted
                .sides
                .iter()
                .filter(|s| s.semantic_key == key)
                .map(|s| s.debit_minor)
                .sum()
        };
        let credit = |key: &str| -> i64 {
            posted
                .sides
                .iter()
                .filter(|s| s.semantic_key == key)
                .map(|s| s.credit_minor)
                .sum()
        };
        assert_eq!(debit("cash"), 30_000);
        assert_eq!(debit("sales_return"), 100_000);
        assert_eq!(credit("revenue_cash"), 130_000);
        assert_eq!(credit("other_income_expense"), 0);
        assert!(posted.sides.iter().all(|s| !s.semantic_key.is_empty()));
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
}
