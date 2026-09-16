//! The chart of accounts, the map into it, the periods, and every balance.
//!
//! Nothing here writes to the journal — that is `poster.rs`, and it is the only
//! door. What this module does is read, and the shape of the reads is the point:
//!
//! **No balance is stored.** Every figure below is summed from `journal_line`
//! at the moment it is asked for. A group account's balance is the sum over its
//! descendants, found by prefix on the account code, because the client's codes
//! are a tree written in digits. This is the same decision `purchase_order`
//! makes about received quantities, for the same reason: a stored total and the
//! rows it summarises drift, and when they do nobody can say which to believe.

use super::poster::HEAD_OFFICE_SITE;
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

/// One account as the client's own chart has it.
///
/// `name` is never translated. An accountant looks for
/// "Piutang Affiliasi Pembiayaan CIKUPA"; anything else is a different account
/// as far as they are concerned.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LedgerAccount {
    pub account_code: String,
    pub name: String,
    pub parent_code: Option<String>,
    /// `1` ASSET … `8` BEBAN NON OPERASIONAL.
    pub root_class: String,
    /// The rung of the client's `{1,3,5,7,10,12}` ladder, which is the code's
    /// own length. Sent so the browser can indent without measuring strings.
    pub depth: i32,
    /// A heading. Has a balance by summation; nothing may be posted to it.
    pub is_group: bool,
    pub is_active: bool,
    pub site_id: Option<String>,
    /// Set only on goods-in-transit leaves, where the code names a route
    /// rather than a place: this is where the goods came from.
    pub counterparty_site_id: Option<String>,
    /// How many accounts hang directly under this one, so a tree can show an
    /// expander without fetching the children first.
    pub child_count: i64,
}

/// What an account is worth, summed over its own postings and its descendants'.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountBalance {
    pub account_code: String,
    pub debit_minor: i64,
    pub credit_minor: i64,
    /// Debit minus credit. Signed, and deliberately not flipped for liability
    /// and income accounts: a report decides how to present a balance, a
    /// balance does not decide how to present itself.
    pub balance_minor: i64,
}

/// One line of the trial balance.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TrialBalanceRow {
    pub account_code: String,
    pub name: String,
    pub root_class: String,
    pub site_id: Option<String>,
    pub debit_minor: i64,
    pub credit_minor: i64,
}

/// The trial balance, and the proof that it is one.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TrialBalance {
    pub as_of: NaiveDate,
    pub site_id: Option<String>,
    pub rows: Vec<TrialBalanceRow>,
    /// **Over the whole ledger at `as_of`, never over the page and never
    /// narrowed by the search.** The thing this screen exists to prove is
    /// about every account that moved; a total that shrank as somebody typed
    /// would be a proof that could be talked out of itself.
    pub total_debit_minor: i64,
    pub total_credit_minor: i64,
    /// Sent rather than left for the browser to work out. A trial balance that
    /// does not balance is the single most important thing this screen can
    /// say, and it should not depend on a client-side subtraction — least of
    /// all over a list the browser holds one page of.
    pub balanced: bool,
    /// Every account that moved at `as_of`, before the search. `total` is how
    /// many the search and the filters left; the difference is what is hidden.
    pub ledger_rows: i64,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// It bounds the RESPONSE and not the scan — see the section above
    /// `trial_balance`. Worth having anyway: the client's chart is 7,528
    /// accounts and a screen draws forty of them.
    pub next_cursor: Option<String>,
    /// How many lines the search and the filters leave.
    pub total: i64,
    pub facets: TrialBalanceFacets,
}

/// A meaning, and the client account that carries it here.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountMapping {
    pub semantic_key: String,
    pub site_id: String,
    /// Which bank, which card scheme. Empty when the meaning needs no
    /// narrowing.
    pub qualifier: String,
    pub account_code: String,
    /// The client's name for that account, so the screen can be read without
    /// looking every code up.
    pub account_name: String,
    pub set_by: String,
    pub set_at: DateTime<Utc>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetAccountMappingRequest {
    pub semantic_key: String,
    pub site_id: String,
    #[serde(default)]
    pub qualifier: String,
    pub account_code: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FiscalPeriod {
    pub year: i32,
    pub month: i32,
    pub status: String,
    pub closed_by: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
    /// How many entries were posted into it. A month with none is a month
    /// nobody has worked yet, which is different from a month that balanced.
    pub entry_count: i64,
}

/// A meaning a posting rule can ask for, and what it is meant to point at.
///
/// This list is the contract between the rules and the Account Map screen. It
/// exists so somebody opening that screen is told what is still unset rather
/// than discovering it when a posting refuses three weeks later — and so the
/// hint can name the client's own account, which is what they will recognise.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SemanticKeyDoc {
    pub key: String,
    pub label: String,
    /// The client account this is expected to be, in their own words. A
    /// suggestion for the person mapping it, never applied automatically.
    pub expects: String,
    /// True when one key needs several accounts — a bank per bank, a card
    /// scheme per scheme — and the qualifier says which.
    pub qualified: bool,
    /// Which menu group stops working without it.
    pub needed_for: String,
}

fn key(key: &str, label: &str, expects: &str, qualified: bool, needed_for: &str) -> SemanticKeyDoc {
    SemanticKeyDoc {
        key: key.into(),
        label: label.into(),
        expects: expects.into(),
        qualified,
        needed_for: needed_for.into(),
    }
}

/// The three numbers the sidebar's Finance badge draws.
///
/// Every screen in the app mounts that sidebar, so the badge was three
/// requests on every cold load: the bill list, the period list, and the whole
/// account map — 695 mappings, 165 KB — read to the browser so it could count
/// to three. The counting belongs where the rows are.
///
/// `year` and `month` are the caller's, not `now()`'s, because "this month" is
/// the operator's month: the node keeps UTC and the shop keeps WIB, and for
/// seven hours of every day those two disagree about which month it is.
///
/// The overdue count is also no longer capped. The browser was counting a
/// page of bills — whatever the list endpoint's limit handed it — so a house
/// with more unpaid bills than that page held was told a smaller number than
/// the truth.
///
/// # Only one of the three is about the month, and the answer now says so
///
/// The endpoint takes a `year` and a `month` and looked, from its shape, like
/// three counts about that month. It never was: `overdue_bills` is every bill
/// late TODAY, and `unmapped_pairs` is every gap in the map as it stands — the
/// account map has no dates in it at all. Only `month_not_open` reads the
/// arguments.
///
/// Scoping all three to the month was considered and is wrong for both. A bill
/// that fell due in July and is still unpaid is late now, and dropping it from
/// September's badge would be the badge hiding the oldest debt in the house. A
/// meaning nobody has mapped is not mapped in any month. So the two stay
/// STANDING and the response labels them: `scopes` says which reading each
/// number has, and `as_of` is the day the standing ones were counted on.
///
/// The numbers and their names are unchanged, so no reader of this badge has
/// to be touched for the labels to arrive.
pub async fn finance_attention_counts(
    pool: &PgPool,
    year: i32,
    month: i32,
) -> Result<serde_json::Value, AppError> {
    let overdue: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM supplier_invoice i
          JOIN supplier_invoice_standing st ON st.invoice_id = i.invoice_id
          -- `st.overdue`, not `i.due_date < CURRENT_DATE`. A bill whose first
          -- instalment is settled and whose balance falls next month is not
          -- late, and the single date on the paper cannot say so (0202).
          WHERE i.status <> 'POSTED' AND st.overdue",
    )
    .fetch_one(pool)
    .await?;

    let required: Vec<String> = required_semantic_keys()
        .into_iter()
        .map(|doc| doc.key)
        .collect();
    let site_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM site")
        .fetch_one(pool)
        .await?;
    // A pair is set when the meaning has any account at that site; the
    // qualifier splits one meaning across banks and does not make a second
    // pair, which is why it is not counted here.
    let mapped_pairs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
             SELECT DISTINCT m.semantic_key, m.site_id
               FROM account_map m
               JOIN site s ON s.id = m.site_id
              WHERE m.semantic_key = ANY($1)
         ) pair",
    )
    .bind(&required)
    .fetch_one(pool)
    .await?;

    let month_open: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM fiscal_period p
                        WHERE p.year = $1 AND p.month = $2 AND p.status = 'OPEN')",
    )
    .bind(year)
    .bind(month)
    .fetch_one(pool)
    .await?;

    let unmapped_pairs = (required.len() as i64 * site_count - mapped_pairs).max(0);
    Ok(serde_json::json!({
        "overdue_bills": overdue,
        "unmapped_pairs": unmapped_pairs,
        "month_not_open": i64::from(!month_open),
        "attention": overdue + unmapped_pairs + i64::from(!month_open),
        // The month that was asked about, echoed so a badge drawn from a stale
        // answer can tell it is stale.
        "year": year,
        "month": month,
        // The day the STANDING counts were taken on. `CURRENT_DATE` on the
        // node, which is what `supplier_invoice_standing.overdue` is computed
        // against — said out loud rather than left for a reader to assume.
        "as_of": chrono::Utc::now().date_naive(),
        // Which reading each count has. `MONTH` means it is about `year`/
        // `month`; `STANDING` means it is about the books as they stand today
        // and does not move when the month does.
        "scopes": {
            "overdue_bills": "STANDING",
            "unmapped_pairs": "STANDING",
            "month_not_open": "MONTH",
        },
    }))
}

/// A location the books are kept for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BookLocation {
    pub site_id: String,
    pub name: String,
    /// `DC` or `STORE`.
    pub kind: String,
    /// How many accounts in the chart are scoped to it. A location with none
    /// is one the import did not reach, which is worth seeing on the screen
    /// rather than discovering when a posting cannot resolve.
    pub account_count: i64,
}

/// The locations finance keeps books for.
///
/// Head office first, then the shops. Not a cosmetic ordering: the DC is HO,
/// which is suffix `00` in the client's own codes and the location most
/// mappings are set for, so a screen that listed it fourteenth would hide the
/// one people open it to reach.
///
/// Derived from the chart rather than from the list of places a delivery can be
/// sent to. They happen to be the same fourteen today, and they are not the same
/// question: a shop that stops receiving stock still has a ledger, and a chart
/// imported for thirteen locations out of fourteen should say so here rather
/// than look complete.
///
/// The NAME comes from `org_place`, not from `site`, and that is the whole of
/// the unit-domain decision taken on 2026-09-13. Accounting's fourteen units
/// are head office and thirteen shops — suffix `00` is HO in the client's own
/// codes — while `site` is the fourteen places STOCK sits. The two lists
/// coincide because HO and the warehouse share a building, and
/// `org_place.site_id` records that: `ho → ho` since 0256 folded `dc` and
/// `dc-01` into one row of kind `HO`, under a unique index, so the bridge is
/// total and one-to-one. It stays a bridge rather than a join on equal ids,
/// because the day the warehouse moves out again is one row to change.
///
/// Reading `site.name` here is what made every finance screen print "DC" where
/// the books, the chart and this function's own comment all mean head office.
/// Since 0256 the row says `ho`/`HO` itself and the two names agree, which is
/// also why the ordering sorts on kind `HO`: there is no longer a `DC` row to
/// put first, and sorting on one would have quietly filed head office
/// fourteenth — between `store-13` and nothing.
/// `COALESCE` rather than an inner join: a site with no place row is a fault
/// worth seeing as itself rather than as a missing row.
pub async fn book_locations(pool: &PgPool) -> Result<Vec<BookLocation>, AppError> {
    let rows = sqlx::query(
        "SELECT s.id AS site_id,
                COALESCE(p.name, s.name) AS name,
                COALESCE(p.kind, s.kind) AS kind,
                (SELECT COUNT(*) FROM ledger_account a WHERE a.site_id = s.id)::bigint AS account_count
           FROM site s
           LEFT JOIN org_place p ON p.site_id = s.id
          ORDER BY (s.kind <> 'HO'), s.id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(BookLocation {
                site_id: row.try_get("site_id")?,
                name: row.try_get("name")?,
                kind: row.try_get("kind")?,
                account_count: row.try_get("account_count")?,
            })
        })
        .collect()
}

/// Every meaning the posting rules use, in the order a person would set them.
pub fn required_semantic_keys() -> Vec<SemanticKeyDoc> {
    vec![
        key(
            "inventory",
            "Merchandise inventory",
            "1011201001 Persediaan Barang Dagangan",
            false,
            "Payables",
        ),
        key(
            "trade_payable",
            "Supplier payable",
            "2012001001 Hutang Suppliers Barang Dagangan",
            false,
            "Payables",
        ),
        key(
            "vat_in",
            "Input VAT",
            "1011302004 Prepaid - VAT (PPN Masukan)",
            false,
            "Payables",
        ),
        key(
            "purchase_discount",
            "Purchase discount and price variance",
            "8010110003 Potongan Pembelian",
            false,
            "Payables",
        ),
        key(
            "non_merchandise_payable",
            "Non-merchandise payable",
            "2012001003 Hutang Supplier Non Barang Dagang",
            false,
            "Expenses",
        ),
        key(
            "accrued_expense",
            "Accrued expense",
            "2012201* Biaya ... YMHD",
            true,
            "Payables",
        ),
        key(
            "cash",
            "Cash on hand",
            "1011001001 Cash On Hand",
            false,
            "Cash & Bank",
        ),
        key(
            "petty_cash",
            "Petty cash",
            "1011001002 Petty Cash",
            false,
            "Cash & Bank",
        ),
        key(
            "cashier_float",
            "Cashier float",
            "1011001003 Modal Kasir",
            false,
            "Cash & Bank",
        ),
        // Where takings sit between a drawer and a bank. Unqualified, unlike
        // the two bank keys below it: a bag of notes is in transit to one
        // place at a time and the unit is already the dimension on the line,
        // so there is nothing left for a qualifier to narrow.
        //
        // The client's IMPORTED chart had no account for this —
        // `docs/coa-final.md` §8.7 named it as one of exactly two the
        // simplified chart had to add — and 0243 minted it. Until somebody
        // points this key at it, recording a deposit is allowed and banking one
        // is refused BY NAME, the way a cash count is recorded without
        // `cash_variance` and cannot be posted without it.
        key(
            "bank_savings",
            "Bank — savings",
            "1011003* Cash In Bank Tabungan",
            true,
            "Cash & Bank",
        ),
        key(
            "bank_giro",
            "Bank — giro",
            "1011002* Cash In Bank Giro",
            true,
            "Cash & Bank",
        ),
        // lane-C: the instrument, not the bank.
        //
        // Qualified per bank because the client's chart keeps one leaf each —
        // 2012002001 Outstanding Giro Bank BCA, 2012002002 Mandiri,
        // 2012002003 BRI, 2012002004 BNI, 2012002005 DANAMON — and a giro is
        // drawn on one of them. An unqualified mapping would put a BCA giro and
        // a Mandiri giro in the same balance, and the board that answers "does
        // this bank have enough in it for what we have written on it" would be
        // answering about the wrong bank.
        key(
            "giro_outstanding",
            "Giro issued, not cleared",
            "2012002* Outstanding Giro",
            true,
            "Payables",
        ),
        // lane-C: a fixed deposit is money the company has and cannot spend
        // today. It holds money — `MONEY_MEANINGS` says so — which is what
        // makes moving cash into one a TRANSFER rather than a payment, and
        // therefore what stops a slip headed BUKTI KAS KELUAR being printed
        // over an entry that only moved money between two accounts we hold.
        //
        // 1011004001 TIME DEPOSIT BANK BCA, 1011004002 MANDIRI, 1011004003 BRI,
        // 1011004004 BNI.
        key(
            "time_deposit",
            "Time deposit",
            "1011004* TIME DEPOSIT",
            true,
            "Cash & Bank",
        ),
        // lane-C: the three lines every bank statement carries every month,
        // and the accounts the seeded bank rules propose.
        //
        // They are here rather than left to whoever books the statement,
        // because a rule that proposes an account has to have one to propose;
        // an unmapped key makes the proposal refusable with a message naming
        // the key, which is the difference between a screen that explains
        // itself and one that fails.
        key(
            "bank_admin_fee",
            "Bank charges",
            "6010310004 Biaya Bank HO",
            false,
            "Cash & Bank",
        ),
        key(
            "interest_income",
            "Bank interest received",
            "8010110001 Pendapatan Bunga Bank",
            false,
            "Cash & Bank",
        ),
        // The client's chart has no leaf named for PPh final on interest, so
        // this points at the income-tax expense they do keep. It is an expense
        // and not a prepaid on purpose: PPh 4(2) on bank interest is FINAL —
        // withheld at source and never recovered — and mapping it to
        // `1011302006 Prepaid - Other Tax` would put an asset on the balance
        // sheet for money that is gone. Finance can repoint it on the Account
        // map screen the day they open a leaf of their own.
        key(
            "tax_on_interest",
            "Tax withheld on bank interest",
            "8030112001 Current Tax Inc/Exp PPH Pasal 25",
            false,
            "Cash & Bank",
        ),
        key(
            "rounding",
            "Rounding difference",
            "8010110002 Selisih pembulatan",
            false,
            "Cash & Bank",
        ),
        // Where a drawer that does not agree with the books is explained.
        //
        // `cash_counts.rs` has named this meaning since 0216 and it was never
        // declared here — which is worse than an unmapped key, because an
        // unmapped key at least SHOWS on this screen as unset. This one did
        // not: the Account Map never listed it, nobody was ever asked to set
        // it, Period close reported the map complete, and the first person to
        // book a short drawer met a refusal naming a meaning they had never
        // seen. 0238 seeds the binding as well, so the refusal is gone rather
        // than merely explained.
        key(
            "cash_variance",
            "Cash count difference",
            "8010110007 Pendapatan (Biaya) Lain-Lain",
            false,
            "Cash & Bank",
        ),
        // lane-A changed these two from unqualified to qualified. What a shop
        // is owed on cards is owed by a NAMED acquirer, clearing on its own
        // day for its own fee, and a day's takings cannot be reconciled
        // against a settlement file without saying which. The client's chart
        // keeps one account for all of them, so every qualifier may point at
        // the same leaf — the qualifier is what lets them split it later
        // without a change to a posting rule.
        key(
            "card_receivable_credit",
            "Credit card receivable",
            "1011101001 Piutang kartu Kredit (per network)",
            true,
            "Receivables",
        ),
        key(
            "card_receivable_debit",
            "Debit card receivable",
            "1011101002 Piutang Debit Card (per bank)",
            true,
            "Receivables",
        ),
        // lane-P
        //
        // Head office sends a store manager money for the shop to run on, and
        // it is the manager's to account for until they spend it or bring it
        // back. The client keeps an account for exactly that, and keeps it
        // apart from staff loans: `1011102001 PIUTANG PEGAWAI` is what an
        // employee personally owes, `1011102002 PIUTANG KEPALA TOKO` is what a
        // manager is holding on the company's behalf. They read almost the
        // same and they are not the same debt, so this key names the second and
        // says so here rather than leaving somebody to pick from a list.
        //
        // Unqualified, because the location IS the narrowing: the client has a
        // leaf per shop under this heading — `101110200200` at head office
        // through `101110200213` — and `account_map` is already keyed by site.
        key(
            "store_manager_receivable",
            "Store manager float",
            "1011102002 PIUTANG KEPALA TOKO",
            false,
            "Receivables",
        ),
        key(
            "card_fee",
            "Card fee (MDR)",
            "6010110002 Biaya Credit Card",
            false,
            "Receivables",
        ),
        // The three the counter takes that the client's chart never answered
        // for, and the one it answers for too many times.
        //
        // A card sale has had two receivables and a fee account since the
        // chart was imported. QRIS settles exactly the same way — the money
        // reaches the bank a day or two later, net of a fee — and had nothing
        // at all, so it could not be followed from the till to the statement.
        // 0238 adds the accounts; these are the meanings that reach them.
        //
        // 0244 then collapsed the chart against a fixture derived before 0238
        // existed, which knew no QRIS meaning and folded both of these onto
        // `1011101002 Piutang Kartu Debit` — so for six days a QRIS sale and a
        // debit-card sale were the same row in the ledger. 0248 gives each its
        // own account again, ONE account and not fourteen leaves: the unit is
        // `journal_line.site_id` now.
        key(
            "qris_clearing",
            "QRIS taken, not yet settled",
            "1011101003 Piutang QRIS",
            false,
            "Receivables",
        ),
        // There is no TRANSFER tender, so a transfer made at the counter
        // arrives as OTHER. It goes to a clearing account of its own rather
        // than into cash: money nobody has named is money that has to stay
        // visible until somebody names it, and a drawer that was credited with
        // it would reconcile against a count it can never match.
        key(
            "other_tender_clearing",
            "Other tender, not yet settled",
            "1011101004 Piutang Tender Lain-Lain",
            false,
            "Receivables",
        ),
        // What the counter sold. QUALIFIED, and the qualifier is the tender.
        //
        // The client's chart splits sales by tender — `4010110` Tunai,
        // `4010111` Kartu Debit per bank, `4010112` Kartu Kredit per scheme —
        // and whether this estate should follow it that far is an open owner
        // decision (`docs/finance-menu.md` §6, decision 2). So the day's rule
        // asks rather than decides: bind `revenue` per tender here —
        // `CASH`, `CARD_DEBIT`, `CARD_CREDIT`, `QRIS`, `VOUCHER`, `OTHER` —
        // and the credit splits to match; leave only the plain binding and it
        // is one line. Either way the TENDER SPLIT is on the debits beside it,
        // which is where it reconciles to the bank.
        key(
            "revenue",
            "Counter sales",
            "4010114001* Penjualan Barang Dagangan",
            true,
            "Sales",
        ),
        // The tax that was already inside the price, and is not revenue.
        //
        // Indonesian retail prices are tax-INCLUSIVE: the shelf price is what
        // the customer pays and the PPN is part of it, so the day's takings
        // are `net + tax` and the split is a SUBTRACTION from the credit, not
        // an addition to the debit. `sale.tax_minor` has carried that figure
        // since the pricing engine started quoting and `reports::sales_window`
        // has reported it all along; until 0249 there was no meaning pointing
        // at an account, so `sale_day/1` credited the whole gross to revenue
        // and the liability was never recognised at all — income overstated by
        // exactly the tax, and nothing owed to anybody for it.
        //
        // Declared here and not only mapped, which is the lesson 0238 wrote
        // down about `cash_variance`: an unmapped meaning is a gap the Account
        // Map shows, an undeclared one is a gap nobody is ever asked about.
        //
        // Nothing was missing from either chart, and nothing is invented for
        // this: `2012101003` is the CLIENT'S own account and the name below is
        // theirs verbatim, double space and all. Our collapsed chart currently
        // shows it as `Hutang PPN Keluaran` — one of the 139 renames the
        // owner's audit of 2026-09-14 found and put on the list to reverse —
        // so this line is the client's spelling and the chart is the one that
        // is wrong, not this.
        key(
            "output_tax",
            "Output VAT (PPN Keluaran)",
            "2012101003 Hutang  VAT PPN Keluaran",
            false,
            "Sales",
        ),
        // A voucher presented at the counter is not money arriving. The money
        // arrived when the card was sold, possibly at another shop, possibly
        // last year; this is the liability being settled.
        //
        // The other half of that liability — issuing a voucher — has no poster
        // yet, so until it does, settling one drives `205001` debit rather
        // than back towards zero. That is a visible wrong in the right place,
        // which is better than a day that refuses to post or a voucher booked
        // as takings the shop never received.
        key(
            "voucher_liability",
            "Vouchers outstanding",
            "205001 Uang Muka - Penjualan",
            false,
            "Sales",
        ),
        key(
            "affiliate_receivable",
            "Inter-unit receivable",
            "1021401* Piutang Affiliasi Pembiayaan",
            true,
            "Receivables",
        ),
        key(
            "affiliate_payable",
            "Inter-unit payable",
            "2012301* Hutang Affiliasi Pembiayaan",
            true,
            "Payables",
        ),
        key(
            "goods_in_transit",
            "Goods in transit",
            "1011203* BDP Barang Dagangan",
            true,
            "Inventory & COGS",
        ),
        key(
            "cogs",
            "Cost of goods",
            "5010110001 Harga Pokok Pembelian",
            false,
            "Inventory & COGS",
        ),
        key(
            "stock_loss",
            "Stock count variance",
            "8010110006 Kehilangan Barang atau Selisih Stock Opname",
            false,
            "Inventory & COGS",
        ),
        // Both write-off sides, and both on the client's one "income (expense)"
        // leaf. The chart has no bad-debt expense account: what it has is
        // `1011103 Cadangan Penghapusan Piutang Tak Tertagih`, a provision, and
        // a heading at that. So rather than invent an account, two meanings
        // share one leaf — which `account_map` allows, and which keeps the
        // distinction where it is readable: a posting rule that says
        // `bad_debt_expense` says what it did, whatever the balance it lands in
        // is called.
        //
        // `asset_disposal_result` is already on this same leaf, so it is now
        // three meanings on 8010110007. That is the client's filing, not ours.
        key(
            "bad_debt_expense",
            "Receivable written off",
            "8010110007 Pendapatan (Biaya) Lain-Lain",
            false,
            "Corrections",
        ),
        key(
            "other_income_expense",
            "Other income and expense",
            "8010110007 Pendapatan (Biaya) Lain-Lain",
            false,
            "Corrections",
        ),
        key(
            "prepaid_expense",
            "Prepaid expense",
            "1011301* Biaya Dibayar Dimuka",
            true,
            "Expenses",
        ),
        key(
            "advance",
            "Advance",
            "1011303* Uang Muka / Advanced",
            true,
            "Expenses",
        ),
        key(
            "fixed_asset",
            "Fixed asset",
            "10215* Aktiva Tetap",
            true,
            "Fixed Assets",
        ),
        key(
            "accumulated_depreciation",
            "Accumulated depreciation",
            "10216* Akumulasi Penyusutan",
            true,
            "Fixed Assets",
        ),
        key(
            "depreciation_expense",
            "Depreciation expense",
            "70102* Biaya Depresiasi",
            true,
            "Fixed Assets",
        ),
        // The seventh family is not depreciated and the client's chart says so
        // in its own names: `1021607 Reserve Replacement - Operating
        // Equipment`, charged through `7010215 BIAYA REPLACEMENT`. Racks and
        // hangers are replaced rather than written down, and mapping them to
        // `accumulated_depreciation` would credit a reserve through a meaning
        // that says it is something else. 0159 has the argument.
        key(
            "replacement_reserve",
            "Replacement reserve",
            "1021607* Reserve Replacement - Operating Equipment",
            true,
            "Fixed Assets",
        ),
        key(
            "replacement_expense",
            "Replacement expense",
            "7010215* Biaya Replacement Operating Equipment",
            true,
            "Fixed Assets",
        ),
        // Intangibles. A separate cost meaning because an intangible's cost is
        // the one asset cost that does not sit under `10215`, so
        // `fixed_asset` cannot answer for it — and disposal credits the cost.
        // Where a cost sits while the thing it is paying for is still being
        // built. The client keeps one account per unit — `1031803001` plus the
        // unit suffix — and not one per family, because work in progress has
        // not become a kind of thing yet. That is exactly why capitalising it
        // has to say what it became.
        key(
            "work_in_progress",
            "Work in progress",
            "1031803001* Contract In Progress (CIP)",
            true,
            "Fixed Assets",
        ),
        key(
            "intangible_asset",
            "Intangible asset",
            "10217* Intangible Asset",
            true,
            "Fixed Assets",
        ),
        key(
            "accumulated_amortisation",
            "Accumulated amortisation",
            "1021702* Acc Amort Software",
            true,
            "Fixed Assets",
        ),
        key(
            "amortisation_expense",
            "Amortisation expense",
            "7010216* Biaya Amortisasi Intangible Asset",
            true,
            "Fixed Assets",
        ),
        // Where the difference between what an asset was worth and what it
        // fetched lands. The client's chart has no account named for it — they
        // keep no "Laba (Rugi) Penjualan Aktiva Tetap" — so the expectation
        // below points at the general other-income-and-expense leaf they do
        // keep, and it is a suggestion like every other on this screen.
        //
        // One key for both directions rather than a gain key and a loss key.
        // Which way it falls is arithmetic — proceeds against net book value —
        // and two keys would mean two mappings that have to agree about the
        // same event, plus a rule choosing between them. The client's own
        // account is signed, so a gain is a credit to it and a loss a debit.
        //
        // Unmapped, disposal refuses and names this key, which is the whole
        // point: the Account Map screen lists it as unset from the day this
        // ships, rather than somebody discovering it while trying to write off
        // a stolen laptop.
        key(
            "asset_disposal_result",
            "Gain or loss on disposal",
            "8010110007 Pendapatan (Biaya) Lain-Lain",
            false,
            "Fixed Assets",
        ),
        // The client's seventh asset family is not depreciated. `1021607` is
        // named `Reserve Replacement - Operating Equipment` where the other six
        // under `10216` are named `Akum-Penyusu - …`, and `70102` has no
        // depreciation family for operating equipment at all — its sixth child
        // is `BIAYA REPLACEMENT OPERATING EQUIPMENT`. Three parallel blocks of
        // thirty-six accounts, class for class.
        //
        // So these two are qualified by the CLASS and not by the category: the
        // qualifier is `1021507001 OE - Rak 1` and the pair it resolves to is
        // `1021607001` and `7010215001`. Qualifying by the family instead would
        // put every rack, mannequin and hanger in the company into one reserve
        // account, which is what the account map did before 0139 and what made
        // the client's own reserve report unreadable.
        key(
            "loan_principal",
            "Loan principal",
            "20224* / 20125* Pinjaman",
            true,
            "Loans & Financing",
        ),
        key(
            "interest_expense",
            "Interest",
            "80201* Biaya Bunga",
            false,
            "Loans & Financing",
        ),
        // lane-A: what a day's takings need. The client splits sales income by
        // how it was settled, because cash is in a drawer tonight and a card is
        // a named acquirer's debt that arrives on Thursday net of a fee, so the
        // income keys below are qualified the same way the receivables are.
        //
        // Three of these are marked "proposed": their chart, all 496 accounts
        // of it, has nothing for them. QRIS did not exist when it was drawn and
        // they have never sold a gift card — checked, not assumed: no account
        // in it mentions QRIS, a wallet, or a voucher.
        //
        // Each suggested code is a rung nobody has taken, checked against the
        // same file. That check is worth making rather than eyeballing: the
        // obvious next rung for QRIS income, 4010113001, is already spent on
        // "Penjualan Online Sendiri" — 401011.3 is their online rung, .3002
        // being the marketplaces — so QRIS goes to 401011.4 instead. Proposing
        // a code that already means something else is the one mistake here
        // that would post real money into somebody else's account and still
        // balance.
        //
        // All three are suggestions on the Account Map screen and nothing more.
        // Unmapped, the day refuses and names the key.
        key(
            "revenue_cash",
            "Sales — cash",
            "4010110001 Penjualan Tunai",
            false,
            "Sales posting",
        ),
        key(
            "revenue_debit",
            "Sales — debit card",
            "4010111* Penjualan Debit (per bank)",
            true,
            "Sales posting",
        ),
        key(
            "revenue_credit",
            "Sales — credit card",
            "4010112* Penjualan Kartu Kredit (per network)",
            true,
            "Sales posting",
        ),
        key(
            "revenue_qris",
            "Sales — QRIS",
            "4010114001 Penjualan QRIS (proposed; the client's chart has none)",
            false,
            "Sales posting",
        ),
        key(
            "sales_return",
            "Sales returns",
            "4010214001 Retur Penjualan",
            false,
            "Sales posting",
        ),
        key(
            "sales_discount",
            "Sales discount",
            "4010213001 Potongan Penjualan",
            false,
            "Sales posting",
        ),
        key(
            "vat_out",
            "Output VAT",
            "2012101003 Hutang PPN Keluaran",
            false,
            "Sales posting",
        ),
        key(
            "qris_receivable",
            "QRIS receivable",
            "1011101003 Piutang QRIS (proposed; the client's chart has none)",
            true,
            "Sales posting",
        ),
        // end lane-A
        // lane-G: the rest of the payables loop.
        //
        // Every code below was read out of the client's own chart
        // (`Laporan_Master_Account1.csv`) and every one of them has the same
        // fourteen location leaves — HO and C001..C013 — that `inventory` and
        // `trade_payable` do. None is invented and none is borrowed from a
        // meaning that was already spoken for.
        //
        // The one this lane exists for. 0052 said the client's chart had no
        // goods-received-not-invoiced account and refused to post a delivery on
        // those grounds; the account was there all along, beside the ordinary
        // supplier payable, and nothing had ever posted to it. A delivery
        // credits it and the bill that answers the delivery clears it, so the
        // balance on it at a month end is exactly what the warehouse holds and
        // nobody has been invoiced for.
        key(
            "supplier_suspend",
            "Supplier payable — goods received, not invoiced",
            "2012001002 Hutang Supplier Barang Dagang - Suspend",
            false,
            "Payables",
        ),
        // Where a bill that disagrees with the order puts the difference.
        //
        // The expectation is the SAME account `purchase_discount` names, and
        // that is not an oversight: the client keeps one signed account for
        // both, `8010110003 Potongan Pembelian`, and there is no variance
        // account anywhere in the 7,538 rows to point at instead. Two keys
        // rather than one all the same, because they are two different facts —
        // a discount is agreed and a variance is discovered — and a client who
        // opens a variance account later remaps this one key instead of
        // waiting for a release.
        key(
            "purchase_price_variance",
            "Purchase price variance",
            "8010110003 Potongan Pembelian",
            false,
            "Payables",
        ),
        // Money paid to a supplier before there is a bill to owe them for.
        //
        // Distinct from `advance`, which is the travelling advance a person
        // draws (`1011303001 Advanced - Travelling`), and distinct again from
        // anything owed by a store manager. Three different debts to three
        // different kinds of counterparty, and the client's chart keeps them on
        // three different accounts, so this system does too.
        key(
            "advance_purchase",
            "Advance to a supplier",
            "1011303002 Advanced - Purchase",
            false,
            "Payables",
        ),
        // `bank_admin_fee` — the bank's own charge on a transfer, when it comes
        // out of the same movement rather than being debited separately — is
        // the same meaning and the same account lane C declares above under
        // Cash & Bank, so it is declared there and not again here.
        // Income tax kept back from a supplier and owed to the tax office.
        // Creditable: the vendor claims it against their annual liability with
        // the certificate this system's figure appears on.
        key(
            "pph23_payable",
            "PPh 23 withheld",
            "2012101002 Hutang Pajak PPH Pasal 23 (withold)",
            false,
            "Payables",
        ),
        // The final-tax half of the same act, and the one honest gap in this
        // list: the client's chart has no PPh 4(2) leaf. `20121 HUTANG PAJAK`
        // holds PPh 21, PPh 23, output VAT, land-and-building tax and PPh 25,
        // and nothing for the final tax on rent of land and buildings.
        //
        // So the expectation below names the heading rather than a leaf, and it
        // is a suggestion in the way `asset_disposal_result`'s is. Left
        // deliberately unseeded: pointing it at the PPh 23 account would put a
        // final tax in a creditable one, where somebody would claim it back a
        // year later. Unmapped, a rent payment refuses and names this key,
        // which is the whole point — the Account Map screen lists it as unset
        // from the day this ships rather than somebody discovering it while
        // trying to pay a landlord.
        key(
            "pph_final_payable",
            "PPh 4(2) withheld — final",
            "2012101* Hutang Pajak (the chart keeps no PPh 4(2) leaf; open one)",
            false,
            "Payables",
        ),
        // ── lane-B — the store cash chain ────────────────────────────────
        //
        // Two of these are PROPOSED: the client's chart has no account for
        // either, and both are named as proposals on the Account Map screen so
        // nobody maps them to something approximate by accident.
        //
        // `cash_in_transit` is the one that matters. Without it a shop's
        // banking is credited on the day the bag leaves and debited on the day
        // the bank posts it, and in between the money is in no account and no
        // report. `1011005` is the next free rung of `10110 KAS & SETARA KAS`,
        // after CASH ON HAND, CASH IN BANK GIRO, CASH IN BANK TABUNGAN and TIME
        // DEPOSIT — exactly where a treasurer would look for it.
        key(
            "cash_in_transit",
            "Cash in transit",
            "1011005001 Kas Dalam Perjalanan (proposed — the client has none)",
            false,
            "Cash & Bank",
        ),
        // The drawer's difference, once somebody has accepted it. The next free
        // leaf under the rung that already holds `8010110002 Selisih
        // pembulatan` and `8010110006 Kehilangan Barang atau Selisih Stock
        // Opname`, because a till shortfall is the same species of number as a
        // stock one and the client already keeps that species there.
        // `store_manager_receivable` — what a store manager is HOLDING for the
        // company, which is not what an employee OWES it — belongs to this lane
        // as much as to the Payment Ledger, and lane P declares it above under
        // Receivables. One key, one meaning, one declaration: a meaning
        // declared twice fails `every_meaning_is_declared_once`.
        // Wages owed and not yet handed over. What a manager paying an employee
        // out of a fund DEBITS — never a second salary expense, which was
        // already recognised when payroll was finalised.
        key(
            "payroll_payable",
            "Wages payable",
            "2012201001 Biaya Gaji dan Upah YMHD",
            false,
            "Payables",
        ),
        // What a shop may spend petty cash or an operating fund on. Nine, and
        // the ninth is a catch-all on purpose: a category list with no bottom
        // means a real receipt eventually has nowhere to go, and the shop pays
        // for it out of the drawer instead — which is the exact behaviour this
        // lane exists to end.
        key(
            "expense_electricity",
            "Electricity",
            "6010310006 Biaya Pemakaian Listrik",
            false,
            "Store cash",
        ),
        key(
            "expense_water",
            "Water",
            "6010310007 Biaya Pemakaian Air Bersih (PDAM)",
            false,
            "Store cash",
        ),
        key(
            "expense_telephone",
            "Telephone and internet",
            "6010310005 Biaya Telephone, Facsimile, Modem",
            false,
            "Store cash",
        ),
        key(
            "expense_household",
            "Household",
            "6010310003 Biaya Rumah Tangga",
            false,
            "Store cash",
        ),
        key(
            "expense_stationery",
            "Stationery and printing",
            "6010310002 Alat Tulis Kantor & Barang Cetakan",
            false,
            "Store cash",
        ),
        key(
            "expense_repairs",
            "Repairs and maintenance",
            "6010410004 BIAYA PERBAIKAN DAN PERAWATAN BANGUNAN",
            false,
            "Store cash",
        ),
        key(
            "expense_transport",
            "Local transport",
            "6010310009 Biaya Lokal Transport",
            false,
            "Store cash",
        ),
        key(
            "expense_cleaning",
            "Cleaning",
            "6010310001 Biaya Kebersihan (Cleaning)",
            false,
            "Store cash",
        ),
        key(
            "expense_misc",
            "Miscellaneous",
            "6010310099 Miscellaneous Expences",
            false,
            "Store cash",
        ),
        // ── end lane-B ───────────────────────────────────────────────────
    ]
}

const ACCOUNT_COLUMNS: &str = "a.account_code, a.name, a.parent_code, a.root_class::text AS root_class,
     a.depth::int AS depth, a.is_group, a.is_active, a.site_id, a.counterparty_site_id,
     (SELECT COUNT(*) FROM ledger_account c WHERE c.parent_code = a.account_code)::bigint AS child_count";

fn to_account(row: &sqlx::postgres::PgRow) -> Result<LedgerAccount, AppError> {
    Ok(LedgerAccount {
        account_code: row.try_get("account_code")?,
        name: row.try_get("name")?,
        parent_code: row.try_get("parent_code")?,
        root_class: row.try_get("root_class")?,
        depth: row.try_get("depth")?,
        is_group: row.try_get("is_group")?,
        is_active: row.try_get("is_active")?,
        site_id: row.try_get("site_id")?,
        counterparty_site_id: row.try_get("counterparty_site_id")?,
        child_count: row.try_get("child_count")?,
    })
}

// ── the chart of accounts ────────────────────────────────────────────────
//
// Brought up to the shape `money_overview` set in `postgres::statements`: a
// scope struct in, an envelope out, a keyset cursor, and facet counts drawn
// from the same row definition as the page. The convention is copied
// deliberately rather than reinvented — two list endpoints that page
// differently are two things to learn and two things to get wrong.
//
// This is the list where getting it wrong is immediately visible. The client's
// chart is 7,528 accounts; the tree was already safe, because no heading here
// has more than 36 children, but the SEARCH was not — it clamped at 500 and
// said nothing about the rest, so a needle matching two thousand accounts
// looked like a needle matching five hundred.

/// How many accounts the chart returns when the caller does not say.
///
/// Here rather than in the handler, beside the only clamp that enforces it.
/// Absent is a page and deliberately not "everything": the chart is the one
/// list in this system big enough that answering it whole is the defect.
const DEFAULT_ACCOUNT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
///
/// Five hundred, which is what `search_accounts` already clamped to — kept, so
/// that nothing about the widening changes how much of the chart one request
/// can pull. What changes is that a caller can now see it was clamped, from
/// `total`, and page past it, from `next_cursor`.
const MAX_ACCOUNT_LIMIT: i64 = 500;

/// What a caller is asking the chart for.
///
/// One scope for two questions, as the route has always been: with no search
/// it is one level of the tree, with a search it is the whole chart. They are
/// the same question — "which accounts am I looking at" — and a screen that
/// switched endpoints when somebody typed would have two loading states for
/// one box.
#[derive(Clone, Debug, Default)]
pub struct AccountScope {
    /// The heading to open. `None` means the eight roots.
    ///
    /// Read only when there is no search. A needle is a question about the
    /// whole chart, and narrowing it to one branch would answer a question
    /// nobody asked — the tree's position is where somebody was, not what they
    /// are now looking for.
    pub parent: Option<String>,
    /// Free text, tried against the account code by prefix and the name
    /// anywhere.
    ///
    /// Both, because both are how people look: finance quotes a code,
    /// everybody else quotes a name, and a search that only did one of them
    /// would send half its users to the tree to hunt.
    pub needle: Option<String>,
    /// Root classes to keep — `1` … `8`, the first digit of the client's own
    /// numbering. Empty means every class — an empty filter and no filter are
    /// the same request, and treating them differently is how a screen ends up
    /// showing nothing the moment somebody unticks the last box.
    pub classes: Vec<String>,
    /// Locations to keep.
    ///
    /// An account with no location is a chart-wide account and is not narrowed
    /// away by naming one: it simply does not match. It is kept out of the
    /// facet counts for the reason `EmployeeFacets::places` gives — the filter
    /// has no spelling for "nowhere", and a count nobody can click is worse
    /// than no count.
    pub sites: Vec<String>,
    /// Include accounts somebody has retired. Off by default, as it has always
    /// been.
    pub include_inactive: bool,
    /// `code`, `name` or `children`. Anything else is the house order — see
    /// [`account_page`], where the house order is relevance and is the one
    /// order `dir` is not read for.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_ACCOUNT_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many accounts would still be there.
///
/// `MoneyFacet`'s shape and `MoneyFacet`'s reasoning: a value that would leave
/// nothing is a value nobody should have to click to find out about. Counted
/// over everything the SEARCH leaves, deliberately ignoring which filters are
/// currently applied — so the number reads as "how many of these there are",
/// which is the question somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountFacet {
    pub value: String,
    /// What to draw, when it differs from the value.
    ///
    /// Always present here, and always the CLIENT'S own words: a root class is
    /// labelled with the name of the one-digit account it is — `1` is
    /// "ASSET" because the chart says so, not because this server has a list —
    /// and a site with the name that site is filed under. A panel that showed
    /// `1` and `store-01` would be a filter only its author could read.
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the chart can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountFacets {
    pub classes: Vec<AccountFacet>,
    /// Silent about the accounts scoped to no location, which is most of the
    /// chart — see [`AccountScope::sites`].
    pub sites: Vec<AccountFacet>,
}

/// A page of the chart, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountPage {
    /// The heading these rows hang under, echoed back, and `null` in search
    /// mode — where the answer is about the whole chart rather than about a
    /// position in it. A screen reads this to know which of its two faces it
    /// is wearing without having to remember what it asked for.
    pub parent: Option<String>,
    /// True when a needle was searched. Distinct from `parent` being absent,
    /// which is also how the eight roots answer.
    pub searched: bool,
    pub rows: Vec<LedgerAccount>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    ///
    /// Deliberately not an offset. The chart is imported and re-imported, and
    /// an offset would skip or repeat accounts while somebody scrolled —
    /// on the one list in this system long enough that nobody would notice.
    pub next_cursor: Option<String>,
    /// Every account the search and the filters match, not just this page.
    /// Without it a screen can only say "500 accounts", which is a statement
    /// about the clamp rather than about the chart.
    pub total: i64,
    pub facets: AccountFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The account code and nothing else, whatever the list is sorted by, exactly
/// as `MoneyCursor` carries the account map's natural key. It is the primary
/// key, so no two rows can compare equal; the seek re-reads that row's own
/// sort value in SQL, so one cursor shape serves every order and a fourth sort
/// cannot arrive without its cursor.
#[derive(Serialize, Deserialize)]
struct AccountCursor {
    account_code: String,
}

impl AccountCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One chart row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole
/// reason it is a constant: the facets are only honest if they count exactly
/// what the page can show.
///
/// Binds: `$1` the parent or NULL, `$2` the search needle or NULL, `$3`
/// whether to include retired accounts.
///
/// It stops at the MODE and the SEARCH. The class and site filters are applied
/// outside it by each caller, which is what lets one definition answer two
/// different questions from the same rows: the page wants what the filters
/// leave, while the filter panel's counts want what the search alone leaves —
/// because "ASSET 1,204" has to mean "there are 1,204 asset accounts", not
/// "1,204 among the ones you have already narrowed to assets".
///
/// `code_rank` is computed here rather than only in `ORDER BY` because the
/// keyset has to COMPARE the sort value in a `WHERE`, and a sort expression
/// that is not also a column is one a `WHERE` cannot see. It is an integer and
/// not a boolean so that it sorts ASCENDING with the code matches first: a
/// keyset compares a row against a row, which takes one direction for the
/// whole tuple, so `code_hit DESC, code ASC` is an order this can order by and
/// cannot seek into.
const ACCOUNT_ROWS: &str = "
    SELECT a.account_code, a.name, a.parent_code, a.root_class::text AS root_class,
           a.depth::int AS depth, a.is_group, a.is_active, a.site_id,
           a.counterparty_site_id,
           COALESCE(kids.n, 0)::bigint AS child_count,
           CASE WHEN $2::text IS NOT NULL AND a.account_code LIKE $2 || '%'
                THEN 0 ELSE 1 END AS code_rank
      FROM ledger_account a
      -- Counted once for the whole chart and joined, rather than a correlated
      -- subquery per row. `ACCOUNT_COLUMNS` keeps the subquery because its
      -- callers fetch one account; here the row set is a search result, and
      -- running the probe 1,248 times cost 2,615 buffer hits against this
      -- join's 230 — the same answer for a tenth of the pages.
      LEFT JOIN (SELECT parent_code, COUNT(*)::bigint AS n
                   FROM ledger_account WHERE parent_code IS NOT NULL
                  GROUP BY parent_code) kids ON kids.parent_code = a.account_code
     WHERE ($3 OR a.is_active)
       -- Branch mode, when nobody is searching: one level of the tree, and a
       -- NULL parent is the eight roots rather than 'every account'.
       AND ($2::text IS NOT NULL OR a.parent_code IS NOT DISTINCT FROM $1)
       -- Search mode: the whole chart. The code by prefix, because a code is
       -- read left to right and `101` means the branch; the name anywhere,
       -- because nobody knows which word of `Piutang Affiliasi Pembiayaan
       -- CIKUPA` the account is filed under.
       AND ($2::text IS NULL
            OR a.account_code LIKE $2 || '%' OR a.name ILIKE '%' || $2 || '%')
";

/// The chart, one page at a time, beside how big the whole answer is.
pub async fn account_page(pool: &PgPool, scope: AccountScope) -> Result<AccountPage, AppError> {
    // A blank search is not a search. `Some("")` would compile to a prefix
    // match on the empty string, which matches all 7,528 accounts and costs a
    // scan to say so — and, worse, would silently turn "clear the box" into
    // "fetch the chart".
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned);
    let searched = needle.is_some();
    // The tree position is not read while searching — see `AccountScope`.
    let parent = if searched { None } else { scope.parent.clone() };

    // Empty means "no filter", never "nothing passes": a screen that showed
    // nothing the moment somebody unticked the last box reads as broken rather
    // than as unfiltered.
    let classes = (!scope.classes.is_empty()).then(|| scope.classes.clone());
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // account code, which is the primary key, so no two rows can compare equal
    // — which is what stops a keyset from repeating or losing the rows that
    // tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not. Writing
    // `(a ASC, b) > (…)` is a syntax error the compiler cannot catch, because
    // the whole clause is a string.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        // The chart's own order, and the one the tree is read in. Distinct
        // from the house order only while searching, where the house order
        // puts the code matches first and this one does not.
        Some("code") => ("account_code", scope.desc),
        Some("name") => ("name", scope.desc),
        // How big a heading is. What somebody sorts by when looking for where
        // the client actually keeps their detail.
        Some("children") => ("child_count", scope.desc),
        // The house order: what you typed the code of, first. Reversing
        // relevance would mean "the ones that match least", so `dir` is not
        // read here — as `money_overview` does not read it for the chart order
        // either.
        _ => ("code_rank", false),
    };
    let cols = format!("{lead}, account_code");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, account_code {dir}");
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(AccountCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_ACCOUNT_LIMIT)
        .clamp(1, MAX_ACCOUNT_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`AccountCursor`].
    //
    // A cursor whose row the filters no longer keep — an account retired, or
    // re-parented by a re-import, between one page and the next — finds no row
    // to compare against, so the comparison is NULL and the page comes back
    // empty. The list ends early rather than starting again, which is the
    // safer of the two wrong answers: a stale cursor stops, and stopping is
    // visible.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({ACCOUNT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($4::text[] IS NULL OR root_class = ANY($4))
                AND ($5::text[] IS NULL OR site_id = ANY($5))
         )
         SELECT * FROM kept
          WHERE $6::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE account_code = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(&parent)
        .bind(&needle)
        .bind(scope.include_inactive)
        .bind(&classes)
        .bind(&sites)
        .bind(cursor.as_ref().map(|c| c.account_code.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether
    // more rows exist without asking costs a second run of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            AccountCursor {
                account_code: row.try_get("account_code")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows.iter().map(to_account).collect::<Result<Vec<_>, _>>()?;
    let (total, facets) = account_facets(pool, &scope, &parent, needle.as_deref()).await?;
    Ok(AccountPage {
        parent,
        searched,
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many accounts there are, and how they split.
///
/// Counted from the SAME [`ACCOUNT_ROWS`] the page is drawn from, so a count
/// beside a filter is a count of rows that filter could actually produce.
///
/// The two scopes here are deliberate:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered. The
///     number beside `ASSET` answers "how many asset accounts are there",
///     which is the question somebody has while deciding whether to click it.
///     Counting the already-filtered set instead shows the chosen value its
///     own row count and every other one a zero.
///   the total reads the FILTERED set, because it describes the list on
///     screen.
///
/// The class label is the client's own one-digit account — `1` is whatever
/// `ledger_account` calls `1` — rather than a table of eight names kept here,
/// which would be a second copy of the chart's top level and would be wrong
/// the first time the client renamed one.
async fn account_facets(
    pool: &PgPool,
    scope: &AccountScope,
    parent: &Option<String>,
    needle: Option<&str>,
) -> Result<(i64, AccountFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({ACCOUNT_ROWS}), kept AS (
             SELECT * FROM searched
              WHERE ($4::text[] IS NULL OR root_class = ANY($4))
                AND ($5::text[] IS NULL OR site_id = ANY($5))
         )
         SELECT 'class' AS kind, s.root_class AS value,
                (SELECT r.name FROM ledger_account r
                  WHERE r.account_code = s.root_class) AS label,
                COUNT(*)::bigint AS n
           FROM searched s WHERE s.root_class IS NOT NULL GROUP BY s.root_class
          UNION ALL
         SELECT 'site', s.site_id,
                (SELECT p.name FROM site p WHERE p.id = s.site_id),
                COUNT(*)::bigint
           FROM searched s WHERE s.site_id IS NOT NULL GROUP BY s.site_id
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let classes_filter = (!scope.classes.is_empty()).then(|| scope.classes.clone());
    let sites_filter = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let rows = sqlx::query(&sql)
        .bind(parent)
        .bind(needle)
        .bind(scope.include_inactive)
        .bind(&classes_filter)
        .bind(&sites_filter)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut classes = Vec::new();
    let mut sites = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "class" => classes.push(AccountFacet {
                value,
                label,
                count: n,
            }),
            "site" => sites.push(AccountFacet {
                value,
                label,
                count: n,
            }),
            _ => total = n,
        }
    }
    // The classes in the client's own order — `1` ASSET through `8` — because
    // that ladder is how an accountant reads a chart, and a panel sorted by
    // size would put BEBAN above ASSET on a busy month. The sites by size, as
    // every other facet panel here is: a filter list is read top-down and the
    // value somebody is most likely to want is the one with the most behind
    // it.
    classes.sort_by(|a, b| a.value.cmp(&b.value));
    sites.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    Ok((total, AccountFacets { classes, sites }))
}

/// One account, with the chain of headings above it.
///
/// The path is what makes a search result legible: `101100100101` means nothing
/// until you can see it sits under CASH ON HAND, under KAS & SETARA KAS, under
/// CURRENT ASSET, under ASSET.
pub async fn account_with_path(
    pool: &PgPool,
    code: &str,
) -> Result<(LedgerAccount, Vec<LedgerAccount>), AppError> {
    let sql = format!("SELECT {ACCOUNT_COLUMNS} FROM ledger_account a WHERE a.account_code = $1");
    let row = sqlx::query(&sql)
        .bind(code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("account {code}")))?;
    let account = to_account(&row)?;

    // Ancestors are every declared strict prefix of this code — the same rule
    // the importer used to choose a parent, applied all the way up.
    let path_sql = format!(
        "SELECT {ACCOUNT_COLUMNS} FROM ledger_account a
          WHERE $1 LIKE a.account_code || '%' AND a.account_code <> $1
          ORDER BY length(a.account_code)"
    );
    let path_rows = sqlx::query(&path_sql).bind(code).fetch_all(pool).await?;
    let path = path_rows
        .iter()
        .map(to_account)
        .collect::<Result<Vec<_>, _>>()?;
    Ok((account, path))
}

/// What one account is worth, including everything filed under it.
///
/// The prefix match is what makes a heading meaningful: asking for `1` gives
/// the whole of ASSET. It is a `LIKE 'code%'` rather than a recursive walk
/// because the client's codes already encode the tree, and the index on
/// `journal_line (account_code, site_id)` serves it directly.
pub async fn account_balance(
    pool: &PgPool,
    code: &str,
    site_id: Option<&str>,
    as_of: Option<NaiveDate>,
) -> Result<AccountBalance, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(l.debit_minor),0)::bigint AS debit,
                COALESCE(SUM(l.credit_minor),0)::bigint AS credit
           FROM journal_line l JOIN journal_entry e USING (entry_id)
          WHERE l.account_code LIKE $1 || '%'
            AND ($2::text IS NULL OR l.site_id = $2)
            AND ($3::date IS NULL OR e.posting_date <= $3)",
    )
    .bind(code)
    .bind(site_id)
    .bind(as_of)
    .fetch_one(pool)
    .await?;
    let debit: i64 = row.try_get("debit")?;
    let credit: i64 = row.try_get("credit")?;
    Ok(AccountBalance {
        account_code: code.to_string(),
        debit_minor: debit,
        credit_minor: credit,
        balance_minor: debit - credit,
    })
}

// ── the trial balance ────────────────────────────────────────────────────
//
// The same envelope as the rest, with the general ledger's override: **the
// totals a trial balance exists to prove are about the WHOLE ledger.** They
// are what the screen is for — do the two sides agree — and a figure that
// shrank when somebody typed in a search box would turn that into a question
// about page one.
//
// So `total_debit_minor`, `total_credit_minor` and `balanced` are computed
// over everything `as_of` and `site_id` leave, in SQL, before any search or
// filter. Only `rows`, `total` and the facet counts narrow.
//
// # What the cursor does and does not buy
//
// It bounds the RESPONSE, not the scan. This is an aggregate over every
// journal line on or before `as_of`, and the aggregate has to finish before
// any row can be ordered — so paging does not make the database do less work,
// it makes the browser receive less. That is still worth having: the client's
// chart is 7,528 accounts, and a month where most of them move is 7,528 rows
// of JSON into a screen that draws forty of them.
//
// The scan itself is the real ceiling, and there is no index that removes it:
// nothing here is stored, by design — see the module header. What would remove
// it is a stored balance per account per period, and that is the trade this
// system has already refused, because a stored total and the lines it
// summarises drift and nobody can then say which to believe.

/// How many trial-balance rows are returned when the caller does not say.
///
/// Deliberately larger than the chart's page: this is a report somebody scrolls
/// or exports rather than a list they click through, and the smaller the page
/// the more times the aggregate above is paid for.
const DEFAULT_TRIAL_LIMIT: i64 = 500;
/// And the most it will return however loudly a caller asks.
const MAX_TRIAL_LIMIT: i64 = 2000;

/// What a caller is asking the trial balance for.
#[derive(Clone, Debug, Default)]
pub struct TrialBalanceScope {
    /// The date the books are proved at. **Part of the ledger being proved**,
    /// not a filter: it decides what the totals are about.
    pub as_of: Option<NaiveDate>,
    /// One location, or all of them. Also part of the ledger being proved —
    /// "the Cikupa books balance" is a different statement from "the company's
    /// books balance", and both are ones somebody makes.
    pub site_id: Option<String>,
    /// Free text over the account code and the client's own name for it.
    ///
    /// Narrows the ROWS and nothing else. See the note above.
    pub needle: Option<String>,
    /// Root classes to keep. Also rows-only.
    pub classes: Vec<String>,
    /// `name`, `debit`, `credit` or `net`. Anything else is the house order,
    /// by account code — which is the order a trial balance is read in.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_TRIAL_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many lines would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TrialBalanceFacet {
    pub value: String,
    /// The client's own name for the one-digit root account, never a list kept
    /// here — see `account_facets`.
    pub label: Option<String>,
    pub count: i64,
}

/// The one thing the rows can be narrowed by beside the search.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TrialBalanceFacets {
    pub classes: Vec<TrialBalanceFacet>,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The account code and the location, which together are what makes a trial
/// balance line unique: one account moves at fourteen shops and that is
/// fourteen lines.
#[derive(Serialize, Deserialize)]
struct TrialCursor {
    account_code: String,
    site_id: String,
}

impl TrialCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// The balance of every account that moved, defined once — the LEDGER, before
/// anybody narrows it.
///
/// Binds: `$1` as_of, `$2` the site or NULL.
///
/// `net` is materialised because the keyset has to compare the sort value in a
/// `WHERE`, and a sort expression that is not also a column is one a `WHERE`
/// cannot see.
const TRIAL_LEDGER: &str = "
    SELECT l.account_code, a.name, a.root_class::text AS root_class, l.site_id,
           SUM(l.debit_minor)::bigint AS debit,
           SUM(l.credit_minor)::bigint AS credit,
           (SUM(l.debit_minor) - SUM(l.credit_minor))::bigint AS net
      FROM journal_line l
      JOIN journal_entry e USING (entry_id)
      JOIN ledger_account a ON a.account_code = l.account_code
     WHERE e.posting_date <= $1
       AND ($2::text IS NULL OR l.site_id = $2)
     GROUP BY l.account_code, a.name, a.root_class, l.site_id
    HAVING SUM(l.debit_minor) <> 0 OR SUM(l.credit_minor) <> 0
";

/// The search and the class filter, applied to [`TRIAL_LEDGER`]'s output.
///
/// Binds from `$3`: the search pattern or NULL, then the classes or NULL.
const TRIAL_KEPT: &str = "
    SELECT * FROM ledger
     WHERE ($3::text IS NULL OR account_code ILIKE $3 OR name ILIKE $3)
       AND ($4::text[] IS NULL OR root_class = ANY($4))
";

/// Every account that has been posted to, and the server's own proof that
/// debits equal credits.
pub async fn trial_balance(
    pool: &PgPool,
    scope: TrialBalanceScope,
) -> Result<TrialBalance, AppError> {
    let as_of = scope
        .as_of
        .unwrap_or_else(|| chrono::Utc::now().date_naive());
    // A blank search is not a search.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let classes = (!scope.classes.is_empty()).then(|| scope.classes.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // account code and the location, which together are unique per line.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("name") => ("name", scope.desc),
        Some("debit") => ("debit", scope.desc),
        Some("credit") => ("credit", scope.desc),
        // Debit minus credit, signed and unflipped — a liability is negative,
        // which is what it is. A report decides how to present a balance; a
        // balance does not decide how to present itself.
        Some("net") => ("net", scope.desc),
        // The house order, and the one a trial balance is read in: the client's
        // own chart order. Reversible, because reading the bottom of the chart
        // first is an ordinary thing to want.
        _ => ("account_code", scope.desc),
    };
    let cols = format!("{lead}, account_code, site_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, account_code {dir}, site_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(TrialCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_TRIAL_LIMIT)
        .clamp(1, MAX_TRIAL_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH ledger AS NOT MATERIALIZED ({TRIAL_LEDGER}),
              kept AS NOT MATERIALIZED ({TRIAL_KEPT})
         SELECT * FROM kept
          WHERE $5::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept
                                  WHERE account_code = $5 AND site_id = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(as_of)
        .bind(scope.site_id.as_deref())
        .bind(&needle)
        .bind(&classes)
        .bind(cursor.as_ref().map(|c| c.account_code.clone()))
        .bind(cursor.as_ref().map(|c| c.site_id.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            TrialCursor {
                account_code: row.try_get("account_code")?,
                site_id: row.try_get("site_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(TrialBalanceRow {
            account_code: row.try_get("account_code")?,
            name: row.try_get("name")?,
            root_class: row.try_get("root_class")?,
            site_id: row.try_get("site_id")?,
            debit_minor: row.try_get("debit")?,
            credit_minor: row.try_get("credit")?,
        });
    }

    let proof = trial_proof(pool, &scope, as_of, needle.as_deref(), classes.as_deref()).await?;
    Ok(TrialBalance {
        as_of,
        site_id: scope.site_id.clone(),
        rows: out,
        total_debit_minor: proof.total_debit,
        total_credit_minor: proof.total_credit,
        // Sent rather than left for the browser to work out — and now for a
        // second reason as well as the first. A trial balance that does not
        // balance is the single most important thing this screen can say, and
        // it must not depend on a client-side subtraction over a list the
        // browser holds only one page of.
        balanced: proof.total_debit == proof.total_credit,
        ledger_rows: proof.ledger_rows,
        next_cursor,
        total: proof.total,
        facets: proof.facets,
    })
}

/// Everything about the trial balance that is not a row of it.
struct TrialProof {
    ledger_rows: i64,
    total_debit: i64,
    total_credit: i64,
    total: i64,
    facets: TrialBalanceFacets,
}

/// The proof, the narrowed count and the facets — one round trip, off the same
/// ledger definition the page is drawn from.
///
/// The three scopes are the whole point of this endpoint:
///
///   the totals read the LEDGER, before search and before filters. They are
///     the thing being proved and they do not move.
///   per-value counts also read the LEDGER, so "ASSET 41" means "forty-one
///     asset accounts moved".
///   `total` reads the FILTERED set, because it describes the list on screen.
async fn trial_proof(
    pool: &PgPool,
    scope: &TrialBalanceScope,
    as_of: NaiveDate,
    needle: Option<&str>,
    classes: Option<&[String]>,
) -> Result<TrialProof, AppError> {
    let sql = format!(
        "WITH ledger AS ({TRIAL_LEDGER}), kept AS ({TRIAL_KEPT})
         SELECT 'class' AS kind, l.root_class AS value,
                (SELECT r.name FROM ledger_account r
                  WHERE r.account_code = l.root_class) AS label,
                COUNT(*)::bigint AS n, 0::bigint AS debit, 0::bigint AS credit
           FROM ledger l WHERE l.root_class IS NOT NULL GROUP BY l.root_class
          UNION ALL
         SELECT 'ledger', '', NULL::text, COUNT(*)::bigint,
                COALESCE(SUM(debit), 0)::bigint, COALESCE(SUM(credit), 0)::bigint
           FROM ledger
          UNION ALL
         SELECT 'kept', '', NULL::text, COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(as_of)
        .bind(scope.site_id.as_deref())
        .bind(needle)
        .bind(classes)
        .fetch_all(pool)
        .await?;

    let mut proof = TrialProof {
        ledger_rows: 0,
        total_debit: 0,
        total_credit: 0,
        total: 0,
        facets: TrialBalanceFacets {
            classes: Vec::new(),
        },
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "class" => proof.facets.classes.push(TrialBalanceFacet {
                value,
                label,
                count: n,
            }),
            "ledger" => {
                proof.ledger_rows = n;
                proof.total_debit = row.try_get("debit")?;
                proof.total_credit = row.try_get("credit")?;
            }
            _ => proof.total = n,
        }
    }
    // The client's own ladder, `1` through `8`, because that is how an
    // accountant reads a chart — see `account_facets` for why this one panel is
    // not sorted by size.
    proof.facets.classes.sort_by(|a, b| a.value.cmp(&b.value));
    Ok(proof)
}

// ---------------------------------------------------------------------------
// The account map
// ---------------------------------------------------------------------------

// ── the account map ──────────────────────────────────────────────────────
//
// The same envelope as every other list here, on a list that is 695 rows at
// this client and was being sent whole — 165 KB — to a screen showing thirty
// of them.

/// How many mappings the list returns when the caller does not say.
const DEFAULT_MAPPING_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const MAX_MAPPING_LIMIT: i64 = 1000;

/// What a caller is asking the account map for.
#[derive(Clone, Debug, Default)]
pub struct AccountMapScope {
    /// Free text, tried against the meaning, the qualifier, the account code
    /// and the client's own name for that account.
    ///
    /// The account name matters most: somebody looking for where the BCA giro
    /// is pointed knows the bank's name and not the meaning `bank_giro`.
    pub needle: Option<String>,
    /// Locations to keep. Empty means every location — an empty filter and no
    /// filter are the same request.
    ///
    /// Plural where `site` was single; a caller sending exactly one is
    /// unaffected.
    pub sites: Vec<String>,
    /// Meanings to keep, as the posting rules spell them.
    pub keys: Vec<String>,
    /// `key`, `account`, `site` or `set`. Anything else is the house order —
    /// meaning, then location, then qualifier, which is the order somebody
    /// reads a map in.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_MAPPING_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many mappings would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountMapFacet {
    pub value: String,
    /// The site's own name for a location; absent for a meaning, whose label
    /// is already in `required_keys` and would be a second copy here.
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the map can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountMapFacets {
    pub sites: Vec<AccountMapFacet>,
    pub keys: Vec<AccountMapFacet>,
}

/// The account map, a page at a time, with the two lists it cannot be read
/// without.
///
/// `locations` and `required_keys` travel with the page rather than being
/// fetched separately because the screen's only real question — which pairs
/// are still unset — cannot be asked without all three parts, and a screen
/// that asked for them in three requests would draw two of them against a
/// third that had not arrived.
///
/// They are NOT paged. Both are small and closed: fourteen locations and the
/// meanings the posting rules name, which is a list generated from the Rust.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AccountMapPage {
    pub rows: Vec<AccountMapping>,
    pub next_cursor: Option<String>,
    /// Every mapping the search and the filters match, not just this page.
    pub total: i64,
    /// How many (meaning, location) pairs the posting rules need and nobody
    /// has set — counted over EVERY location and EVERY required meaning, never
    /// over the page and never narrowed by the search.
    ///
    /// A gap is a gap whether or not you are currently looking at it: a
    /// filtered view that showed "0 unmapped" because the filter hid them
    /// would be the screen reporting the problem solved. It is the same number
    /// the sidebar's badge draws, computed the same way — a pair is set when
    /// the meaning has ANY account at that location, because the qualifier
    /// splits one meaning across banks and does not make a second pair.
    pub unmapped_pairs: i64,
    pub locations: Vec<BookLocation>,
    pub required_keys: Vec<SemanticKeyDoc>,
    pub facets: AccountMapFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The natural key of `account_map`: the meaning, the qualifier and the
/// location. Not an offset — somebody is editing this map on the same screen
/// that is paging through it.
#[derive(Serialize, Deserialize)]
struct MappingCursor {
    semantic_key: String,
    qualifier: String,
    site_id: String,
}

impl MappingCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One mapping row, defined once, so the facets count exactly what the page
/// can show.
///
/// Binds: `$1` the search pattern or NULL.
const MAPPING_ROWS: &str = "
    SELECT m.semantic_key, m.site_id, m.qualifier, m.account_code,
           a.name AS account_name, m.set_by, m.set_at, m.note
      FROM account_map m JOIN ledger_account a ON a.account_code = m.account_code
     WHERE $1::text IS NULL
        OR m.semantic_key ILIKE $1
        OR m.qualifier ILIKE $1
        OR m.account_code ILIKE $1
        OR a.name ILIKE $1
";

fn to_mapping(row: &sqlx::postgres::PgRow) -> Result<AccountMapping, AppError> {
    Ok(AccountMapping {
        semantic_key: row.try_get("semantic_key")?,
        site_id: row.try_get("site_id")?,
        qualifier: row.try_get("qualifier")?,
        account_code: row.try_get("account_code")?,
        account_name: row.try_get("account_name")?,
        set_by: row.try_get("set_by")?,
        set_at: row.try_get("set_at")?,
        note: row.try_get("note")?,
    })
}

/// The map, one page at a time, with the two lists it is read against.
pub async fn account_map_page(
    pool: &PgPool,
    scope: AccountMapScope,
) -> Result<AccountMapPage, AppError> {
    // A blank search is not a search.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let keys = (!scope.keys.is_empty()).then(|| scope.keys.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // natural key of `account_map`, so no two rows can compare equal.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("account") => ("account_code", scope.desc),
        Some("site") => ("site_id", scope.desc),
        // When somebody last decided it. What you sort by to find the mapping
        // that changed under a posting rule last week.
        Some("set") => ("set_at", scope.desc),
        // The house order, and the one this endpoint has always answered in.
        // `key` names it explicitly so a screen can ask for it back after
        // sorting by something else.
        _ => ("semantic_key", scope.desc),
    };
    let cols = format!("{lead}, semantic_key, site_id, qualifier");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, semantic_key {dir}, site_id {dir}, qualifier {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(MappingCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_MAPPING_LIMIT)
        .clamp(1, MAX_MAPPING_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({MAPPING_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($2::text[] IS NULL OR site_id = ANY($2))
                AND ($3::text[] IS NULL OR semantic_key = ANY($3))
         )
         SELECT * FROM kept
          WHERE $4::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept
                                  WHERE semantic_key = $4 AND site_id = $5
                                    AND qualifier = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&sites)
        .bind(&keys)
        .bind(cursor.as_ref().map(|c| c.semantic_key.clone()))
        .bind(cursor.as_ref().map(|c| c.site_id.clone()))
        .bind(cursor.as_ref().map(|c| c.qualifier.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            MappingCursor {
                semantic_key: row.try_get("semantic_key")?,
                qualifier: row.try_get("qualifier")?,
                site_id: row.try_get("site_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows.iter().map(to_mapping).collect::<Result<Vec<_>, _>>()?;
    let (total, facets) = mapping_facets(pool, &scope, needle.as_deref()).await?;
    let required_keys = required_semantic_keys();
    let locations = book_locations(pool).await?;

    // The gap, over the whole map. Never narrowed — see `unmapped_pairs`.
    let required: Vec<String> = required_keys.iter().map(|doc| doc.key.clone()).collect();
    let mapped_pairs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
             SELECT DISTINCT m.semantic_key, m.site_id
               FROM account_map m
               JOIN site s ON s.id = m.site_id
              WHERE m.semantic_key = ANY($1)
         ) pair",
    )
    .bind(&required)
    .fetch_one(pool)
    .await?;
    let unmapped_pairs = (required.len() as i64 * locations.len() as i64 - mapped_pairs).max(0);

    Ok(AccountMapPage {
        rows: out,
        next_cursor,
        total,
        unmapped_pairs,
        locations,
        required_keys,
        facets,
    })
}

/// How many mappings there are, and how they split.
///
/// Per-value counts read the SEARCHED set and the total reads the FILTERED
/// one, for the reason every other facet query here gives.
async fn mapping_facets(
    pool: &PgPool,
    scope: &AccountMapScope,
    needle: Option<&str>,
) -> Result<(i64, AccountMapFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({MAPPING_ROWS}), kept AS (
             SELECT * FROM searched
              WHERE ($2::text[] IS NULL OR site_id = ANY($2))
                AND ($3::text[] IS NULL OR semantic_key = ANY($3))
         )
         SELECT 'site' AS kind, s.site_id AS value,
                (SELECT p.name FROM site p WHERE p.id = s.site_id) AS label,
                COUNT(*)::bigint AS n
           FROM searched s GROUP BY s.site_id
          UNION ALL
         SELECT 'key', s.semantic_key, NULL::text, COUNT(*)::bigint
           FROM searched s GROUP BY s.semantic_key
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let keys = (!scope.keys.is_empty()).then(|| scope.keys.clone());
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&sites)
        .bind(&keys)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut sites_out = Vec::new();
    let mut keys_out = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        let facet = AccountMapFacet {
            value,
            label,
            count: n,
        };
        match kind.as_str() {
            "site" => sites_out.push(facet),
            "key" => keys_out.push(facet),
            _ => total = n,
        }
    }
    for list in [&mut sites_out, &mut keys_out] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((
        total,
        AccountMapFacets {
            sites: sites_out,
            keys: keys_out,
        },
    ))
}

/// What somebody is trying to do with the account, so the refusal can say what
/// it actually cost them rather than describing the chart at them.
///
/// Two verbs, because the same three faults land on two different screens:
/// choosing an account on the Account Map, and naming one on a journal entry.
#[derive(Clone, Copy, Debug)]
pub enum Intent {
    /// Pointing a semantic key at this account.
    Map,
    /// Putting a journal line on this account.
    Post,
}

/// Refuse an account that cannot carry a posting, and say which of the three
/// things is wrong with it.
///
/// # Why this exists twice over
///
/// `journal_line` pins `is_group = false` and carries it into the composite
/// foreign key `journal_line_account_code_is_group_fkey`, so a heading is
/// already impossible. But a foreign-key violation is SQLSTATE 23503, and
/// `AppError::into_response` translates only P0001 — so the database's perfectly
/// correct refusal reached a person as "database operation failed", with no clue
/// whether the code was wrong, a heading, or a typo. Six other refusals in this
/// module name their reason in plain language; this one did not.
///
/// The constraint remains the guarantee. This is only the explanation, checked
/// first so the sentence is a good one — the same arrangement as
/// `poster::check_balanced` sitting in front of the deferred balance trigger.
///
/// Inactive is checked here and nowhere else: `is_active` is not in the foreign
/// key, so an account retired after it was mapped would otherwise keep taking
/// postings quietly, which is the failure that survives a year.
pub async fn assert_postable(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    intent: Intent,
) -> Result<(), AppError> {
    let code = account_code.trim();
    let account =
        sqlx::query("SELECT name, is_group, is_active FROM ledger_account WHERE account_code = $1")
            .bind(code)
            .fetch_optional(executor)
            .await?
            .ok_or_else(|| match intent {
                Intent::Map => AppError::Validation(format!("no account {code} in the chart")),
                Intent::Post => AppError::Validation(format!(
                    "no account {code} in the chart; nothing can be posted to a code the \
                     client does not keep"
                )),
            })?;
    let name: String = account.try_get("name")?;
    if account.try_get::<bool, _>("is_group")? {
        return Err(AppError::Validation(match intent {
            Intent::Map => format!(
                "{code} {name} is a heading; it has a balance by summation and nothing may be \
                 posted to it. Map a postable account under it instead."
            ),
            Intent::Post => format!(
                "{code} {name} is a heading; it has a balance by summation and nothing may be \
                 posted to it. Choose a postable account under it instead."
            ),
        }));
    }
    if !account.try_get::<bool, _>("is_active")? {
        return Err(AppError::Validation(match intent {
            Intent::Map => format!(
                "{code} {name} is inactive in the client's chart; mapping it would post to an \
                 account they have retired."
            ),
            Intent::Post => format!(
                "{code} {name} is inactive in the client's chart; it has been retired and \
                 cannot take new postings."
            ),
        }));
    }
    Ok(())
}

/// What the poster knows about one line, for the policy checks below.
///
/// Borrowed rather than owned: this is built per line inside `poster::post` and
/// thrown away, and the poster already holds every field.
pub struct PostingFacts<'a> {
    /// The `journal_entry.source_kind` the whole entry will carry.
    pub source_kind: &'a str,
    pub site_id: &'a str,
    pub counter_site_id: Option<&'a str>,
    /// Which of our real bank accounts the line says it moved, when it says.
    ///
    /// A rule that knows sets it. Everything else leaves it `None` and lets the
    /// validator resolve it, which it can do whenever the ledger binding has
    /// exactly one active account — and must refuse when it has two.
    pub bank_account_id: Option<uuid::Uuid>,
}

/// The kinds a PERSON writes, as opposed to the kinds a rule writes.
///
/// `MANUAL` is the hand-written journal. The other three are the corrections
/// (0129): still keyed by a person, but through a document that a second person
/// approves — which is the distinction `manual_je_policy = 'OVERRIDE'` exists to
/// draw.
const HAND_KEYED_KINDS: [&str; 4] = ["MANUAL", "RECLASS", "ADJUSTMENT", "WRITE_OFF"];
const CORRECTION_KINDS: [&str; 3] = ["RECLASS", "ADJUSTMENT", "WRITE_OFF"];

/// Refuse a posting the account's own policy does not permit.
///
/// # Why this is here and not in each module
///
/// Because there is exactly one writer. `poster::post` is the only thing in the
/// estate that inserts a `journal_entry` or a `journal_line` — grep for the
/// INSERTs and nothing outside `poster.rs` has one — so a check placed in it
/// cannot be gone round. Twenty-four call sites reach it and none of them can
/// choose not to.
///
/// # What it reads, and what was already there
///
/// Four of the columns it reads were added by 0243 and had never been read by
/// anything: `dimension`, `requires_counter_site`, `normal_balance`,
/// `is_contra`. 0261 added the two the workbook still needed —
/// `posting_mode` and `manual_je_policy` — and this is what brings the set to
/// life.
///
/// `is_group` and `is_active` are NOT checked here. [`assert_postable`] already
/// refuses both and says so better, and the poster calls it on the line before
/// this one runs.
///
/// `normal_balance` is not checked either, and that is a decision rather than an
/// omission: it constrains the account's RESULTING balance, so enforcing it
/// means summing the account inside the posting transaction, per line. ERPNext
/// does exactly that and gives callers `adv_adj` to skip it. Ours would pay that
/// cost on every sale of every day. It belongs to a check that runs over the
/// books, not to the hot path.
///
/// # No rule means "anything", and DENY beats ALLOW
///
/// A chart of 7,528 accounts cannot be seeded in one go, and an empty table that
/// refused everything would stop the estate dead on the day it was created. So
/// `account_source_rule` constrains only the accounts it names: the first row
/// inserted for an account is the moment that account starts refusing.
///
/// Two directions, because the first real case needs the narrower one. A DENY row
/// refuses ONE kind and leaves the account otherwise usable — which is what the
/// replacement reserve needs, where the draw-down is approved and the formation
/// is not. An ALLOW set means "these and nothing else". DENY is checked first, so
/// a kind that appears in both is refused.
pub async fn validate_account_posting(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    facts: PostingFacts<'_>,
) -> Result<Option<uuid::Uuid>, AppError> {
    let code = account_code.trim();
    // One query and not two: the allow-list is folded in as an array so that
    // adding this check costs the posting path a single round trip.
    let row = sqlx::query(
        "SELECT a.name, a.posting_mode, a.manual_je_policy, a.dimension,
                a.requires_counter_site,
                COALESCE(
                    ARRAY_AGG(r.source_kind) FILTER (WHERE r.effect = 'ALLOW'),
                    '{}'
                ) AS allowed,
                COALESCE(
                    ARRAY_AGG(r.source_kind) FILTER (WHERE r.effect = 'DENY'),
                    '{}'
                ) AS denied,
                held.ids AS bank_ids, held.states AS bank_states,
                held.labels AS bank_labels
           FROM ledger_account a
           LEFT JOIN account_source_rule r ON r.account_code = a.account_code
           -- The real accounts registered against this ledger binding, in the
           -- order a person would be offered them: the primary first. Lateral
           -- rather than three correlated subqueries so the whole of this check
           -- stays ONE round trip, which is what made it affordable in the
           -- posting path to begin with.
           LEFT JOIN LATERAL (
               SELECT COALESCE(ARRAY_AGG(c.account_id
                          ORDER BY c.is_primary DESC, c.account_no_digits), '{}') AS ids,
                      COALESCE(ARRAY_AGG(c.status
                          ORDER BY c.is_primary DESC, c.account_no_digits), '{}') AS states,
                      COALESCE(ARRAY_AGG(b.code || ' ' || c.account_no
                          ORDER BY c.is_primary DESC, c.account_no_digits), '{}') AS labels
                 FROM company_bank_account c
                 JOIN bank b ON b.bank_id = c.bank_id
                WHERE c.ledger_account_code = a.account_code AND c.site_id = $2
           ) held ON true
          WHERE a.account_code = $1
          GROUP BY a.name, a.posting_mode, a.manual_je_policy, a.dimension,
                   a.requires_counter_site, held.ids, held.states, held.labels",
    )
    .bind(code)
    .bind(facts.site_id)
    .fetch_optional(executor)
    .await?;
    // Absent is not this function's refusal to make: `assert_postable` has
    // already said "no account {code} in the chart" in the poster's own words.
    let Some(row) = row else { return Ok(None) };

    let name: String = row.try_get("name")?;
    let posting_mode: String = row.try_get("posting_mode")?;
    let manual_policy: String = row.try_get("manual_je_policy")?;
    let dimension: Option<String> = row.try_get("dimension")?;
    let requires_counter_site: bool = row.try_get("requires_counter_site")?;
    let allowed: Vec<String> = row.try_get("allowed")?;
    let denied: Vec<String> = row.try_get("denied")?;

    let kind = facts.source_kind.trim();
    let hand_keyed = HAND_KEYED_KINDS.contains(&kind);
    let correction = CORRECTION_KINDS.contains(&kind);

    // Before anything else, because it is the one value that admits nothing: not
    // a rule, not a person, not an approved correction. 0263.
    if posting_mode == "BLOCKED" {
        return Err(AppError::Validation(format!(
            "{code} {name} takes no postings at all: what may move it has not been decided. \
             Nothing is wrong with the entry — the account is waiting on a policy."
        )));
    }
    if posting_mode == "AUTO_ONLY" && hand_keyed {
        return Err(AppError::Validation(format!(
            "{code} {name} is posted only by a rule; a {kind} entry cannot name it. Whatever moved this account has a document of its own — post that instead."
        )));
    }
    if hand_keyed {
        match manual_policy.as_str() {
            "NO" => {
                return Err(AppError::Validation(format!(
                    "{code} {name} does not take hand-written entries, corrections included."
                )))
            }
            // The whole point of the third value: a person may reach it, but
            // only through a document somebody else agreed to.
            "OVERRIDE" if !correction => {
                return Err(AppError::Validation(format!(
                    "{code} {name} may be corrected but not journalled: raise an adjustment, a reclass or a write-off, and have it approved."
                )))
            }
            _ => {}
        }
    }

    // DENY first, and independently of the allow-list. One undecided path on an
    // otherwise working account is the case this exists for: the replacement
    // reserve may be drawn down and may not be formed, and saying so as a
    // whitelist would mean listing every kind that IS fine and refusing the ones
    // somebody forgot.
    if denied.iter().any(|k| k == kind) {
        return Err(AppError::Validation(format!(
            "{code} {name} does not take a {kind} posting: that path is held pending a policy. \
             The account is otherwise usable — this refusal is about the document, not the account."
        )));
    }
    if !allowed.is_empty() && !allowed.iter().any(|k| k == kind) {
        let mut spelled: Vec<&str> = allowed.iter().map(String::as_str).collect();
        spelled.sort_unstable();
        return Err(AppError::Validation(format!(
            "{code} {name} does not take a {kind} posting; it is reached by {}.",
            spelled.join(", ")
        )));
    }

    // `dimension = 'unit'` needs no check: `journal_line.site_id` is NOT NULL,
    // so a line always carries one. `company` is the one that can be wrong.
    if dimension.as_deref() == Some("company") && facts.site_id != HEAD_OFFICE_SITE {
        return Err(AppError::Validation(format!(
            "{code} {name} belongs to the company and not to a shop; it posts at {HEAD_OFFICE_SITE}, and this line is at {}.",
            facts.site_id
        )));
    }
    if requires_counter_site && facts.counter_site_id.is_none() {
        return Err(AppError::Validation(format!(
            "{code} {name} is a balance between two units and the line names only {}; say which unit is on the other side.",
            facts.site_id
        )));
    }

    // Which real bank account moved, when the chart knows of any.
    //
    // There is no `requires_bank_account` column, on purpose. The requirement is
    // already a fact the database holds — whether this ledger binding has
    // registered accounts — and a flag would be a second place for that fact to
    // live, needing to be switched on in every environment by hand. That is the
    // Phase 1C lesson restated: policy that depends on somebody remembering is
    // policy some environment does not have. Here the control arrives with the
    // accounts.
    let bank_ids: Vec<uuid::Uuid> = row.try_get("bank_ids")?;
    let bank_states: Vec<String> = row.try_get("bank_states")?;
    let bank_labels: Vec<String> = row.try_get("bank_labels")?;
    // An opening balance is history arriving, and the account it sat in may have
    // closed before this master existed. The one exemption, and it exempts only
    // the naming — every other refusal above still applies to it.
    let opening = kind == "OPENING";

    if let Some(named) = facts.bank_account_id {
        let Some(at) = bank_ids.iter().position(|id| *id == named) else {
            return Err(AppError::Validation(format!(
                "the bank account this line names is not one of {code} {name}'s at {}. \
                 A bank account belongs to one ledger account at one place, and this one belongs elsewhere.",
                facts.site_id
            )));
        };
        // Closed takes new money only through a document somebody approved. The
        // account stays readable on everything it ever paid — what it stops
        // doing is receiving ordinary postings.
        if bank_states[at] == "CLOSED" && !(correction || opening) {
            return Err(AppError::Validation(format!(
                "{} is closed, so a {kind} posting cannot move it. If the closing itself needs \
                 correcting, raise an adjustment and have it approved.",
                bank_labels[at]
            )));
        }
        return Ok(Some(named));
    }

    let live: Vec<usize> = (0..bank_ids.len())
        .filter(|at| bank_states[*at] == "ACTIVE")
        .collect();
    match live.as_slice() {
        // Nothing registered — or only accounts marked DORMANT, which is the
        // word for "exists, unused" and so is not something to resolve TO. The
        // line posts without naming an account, exactly as every line did before
        // this master existed.
        [] => Ok(None),
        // One candidate. Asking a rule to name the only possible answer would be
        // ceremony, and would have meant touching two dozen posting rules to
        // teach them a fact the chart already knows.
        [only] => Ok(Some(bank_ids[*only])),
        // Two or more, and this is the refusal the whole column exists for: the
        // statement of one BCA account must not be reconciled against a voucher
        // that could have moved the other.
        _ if opening => Ok(None),
        _ => Err(AppError::Validation(format!(
            "{code} {name} at {} has {} accounts, so a posting has to say which one moved: {}.",
            facts.site_id,
            live.len(),
            live.iter()
                .map(|at| bank_labels[*at].as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// Point a meaning at an account, or move it.
///
/// Upsert rather than insert: remapping is an ordinary act — a bank changes, a
/// location opens — and making somebody delete first would leave a window in
/// which posting fails for a reason nobody intended.
pub async fn set_account_mapping(
    pool: &PgPool,
    request: &SetAccountMappingRequest,
    actor: &str,
) -> Result<AccountMapping, AppError> {
    let key = request.semantic_key.trim().to_ascii_lowercase();
    if key.is_empty() {
        return Err(AppError::Validation("semantic_key is required".into()));
    }

    // Checked here as well as by the composite foreign key below, for the same
    // reason the poster checks balance before the trigger does: the constraint
    // is the guarantee, this is the explanation.
    let code = request.account_code.trim();
    assert_postable(pool, code, Intent::Map).await?;

    sqlx::query(
        "INSERT INTO account_map (semantic_key, site_id, qualifier, account_code, set_by, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (semantic_key, site_id, qualifier)
         DO UPDATE SET account_code = EXCLUDED.account_code,
                       set_by = EXCLUDED.set_by,
                       set_at = now(),
                       note = EXCLUDED.note",
    )
    .bind(&key)
    .bind(&request.site_id)
    .bind(request.qualifier.trim())
    .bind(code)
    .bind(actor)
    .bind(request.note.as_deref())
    .execute(pool)
    .await?;

    // Read the row back rather than assembling one from what was sent: the
    // account's NAME comes from the chart, and the `set_at` is the database's.
    // One row by its natural key, not a page of the map filtered in Rust —
    // which is what this did before `account_map_page` existed and is a
    // fourteenth of the work.
    let row = sqlx::query(
        "SELECT m.semantic_key, m.site_id, m.qualifier, m.account_code,
                a.name AS account_name, m.set_by, m.set_at, m.note
           FROM account_map m JOIN ledger_account a ON a.account_code = m.account_code
          WHERE m.semantic_key = $1 AND m.site_id = $2 AND m.qualifier = $3",
    )
    .bind(&key)
    .bind(&request.site_id)
    .bind(request.qualifier.trim())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("account mapping".into()))?;
    to_mapping(&row)
}

/// Resolve a meaning to an account, refusing rather than guessing.
///
/// The error names the key, the location and the qualifier, because that is
/// exactly what somebody has to go and fill in on the Account Map screen. An
/// error saying "posting failed" would send them to read code.
pub async fn resolve_account(
    executor: impl sqlx::PgExecutor<'_>,
    semantic_key: &str,
    site_id: &str,
    qualifier: &str,
) -> Result<String, AppError> {
    let row = sqlx::query(
        "SELECT account_code FROM account_map
          WHERE semantic_key = $1 AND site_id = $2 AND qualifier = $3",
    )
    .bind(semantic_key)
    .bind(site_id)
    .bind(qualifier)
    .fetch_optional(executor)
    .await?;
    row.map(|r| r.get::<String, _>("account_code"))
        .ok_or_else(|| {
            AppError::Validation(format!(
                "no account is mapped for '{semantic_key}' at {site_id}{}; \
                 set it on the Account Map screen before posting",
                if qualifier.is_empty() {
                    String::new()
                } else {
                    format!(" ({qualifier})")
                }
            ))
        })
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

// ── the period list ──────────────────────────────────────────────────────
//
// The same envelope as every other list here — rows, a cursor, a total, facet
// counts — on a list that is four rows long today and gains twelve a year.
// Not because four rows need paging, but because a screen should not have to
// know which finance lists answer with an envelope and which answer with an
// array: one shape means one hook in the browser, and the shape is what makes
// "how many months are still open" a number the server sends rather than one
// the browser counts off a list it may have truncated.

/// How many periods the list returns when the caller does not say.
///
/// Two hundred is sixteen years of months, which is longer than this company
/// will keep one system.
const DEFAULT_PERIOD_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
const MAX_PERIOD_LIMIT: i64 = 1000;

/// What a caller is asking the period list for.
#[derive(Clone, Debug, Default)]
pub struct PeriodScope {
    /// Free text, tried against the period's own name — `2026-09` — and the
    /// person who closed it.
    ///
    /// The month is matched as text rather than parsed, so `2026` finds a year
    /// and `09` finds every September. Parsing would make `09` either a
    /// refusal or the ninth of something.
    pub needle: Option<String>,
    /// `OPEN` or `CLOSED`. Empty means both.
    pub statuses: Vec<String>,
    /// Calendar years to keep.
    pub years: Vec<String>,
    /// `entries` or `closed`. Anything else is the house order, newest month
    /// first — see [`period_page`].
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_PERIOD_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many months would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodFacet {
    pub value: String,
    /// Absent for both facets here: a year is its own label and `OPEN` is a
    /// word the screen phrases, not the server.
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the period list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodFacets {
    pub statuses: Vec<PeriodFacet>,
    pub years: Vec<PeriodFacet>,
}

/// A page of the period list, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PeriodPage {
    pub rows: Vec<FiscalPeriod>,
    pub next_cursor: Option<String>,
    /// Every month the search and the filters match, not just this page.
    pub total: i64,
    pub facets: PeriodFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The year and the month, which are the natural key of `fiscal_period`.
#[derive(Serialize, Deserialize)]
struct PeriodCursor {
    year: i32,
    month: i32,
}

impl PeriodCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One period row, defined once, so the facets count exactly what the page can
/// show.
///
/// Binds: `$1` the search pattern or NULL.
///
/// `period_name` is materialised rather than formatted in the browser because
/// the search runs on the SERVER now, and `2026-09` is what somebody types.
const PERIOD_ROWS: &str = "
    SELECT p.year::int AS year, p.month::int AS month, p.status,
           p.closed_by, p.closed_at,
           -- A month nobody has sealed sorts after every month somebody has.
           -- A sentinel VALUE and deliberately not `NULLS LAST`, which orders
           -- a result and says nothing a keyset can seek against: a row
           -- comparison against NULL is NULL rather than true, so paging would
           -- end at the first open month — which is the point of the list.
           COALESCE(p.closed_at, TIMESTAMPTZ '9999-12-31') AS closed_key,
           to_char(make_date(p.year::int, p.month::int, 1), 'YYYY-MM') AS period_name,
           -- The month as one number, so the house order is one column. Two
           -- columns would work in an `ORDER BY` and would make the keyset's
           -- tuple name year and month twice.
           (p.year::int * 12 + p.month::int) AS ord,
           -- A half-open DATE RANGE, not `EXTRACT(YEAR …) = p.year`. The
           -- extract is a function of the column, so no index can answer it
           -- and every period costs a full pass of the journal; this rides
           -- `ix_journal_entry_date` and reads only the month it is counting.
           -- The same count, and the difference only shows up once the journal
           -- is large — which is to say, once it matters.
           (SELECT COUNT(*) FROM journal_entry e
             WHERE e.posting_date >= make_date(p.year::int, p.month::int, 1)
               AND e.posting_date < (make_date(p.year::int, p.month::int, 1)
                                     + INTERVAL '1 month'))::bigint AS entry_count
      FROM fiscal_period p
     WHERE $1::text IS NULL
        OR to_char(make_date(p.year::int, p.month::int, 1), 'YYYY-MM') ILIKE $1
        OR p.closed_by ILIKE $1
";

fn to_period(row: &sqlx::postgres::PgRow) -> Result<FiscalPeriod, AppError> {
    Ok(FiscalPeriod {
        year: row.try_get("year")?,
        month: row.try_get("month")?,
        status: row.try_get("status")?,
        closed_by: row.try_get("closed_by")?,
        closed_at: row.try_get("closed_at")?,
        entry_count: row.try_get("entry_count")?,
    })
}

/// The months the books are kept in, newest first.
pub async fn period_page(pool: &PgPool, scope: PeriodScope) -> Result<PeriodPage, AppError> {
    // A blank search is not a search.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let years = (!scope.years.is_empty()).then(|| scope.years.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // year and month, which are the natural key.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("entries") => ("entry_count", scope.desc),
        // When it was sealed. The sentinel is in `PERIOD_ROWS`; see there for
        // why it is a value and not a `NULLS LAST`.
        Some("closed") => ("closed_key", scope.desc),
        // The house order, and the one this endpoint has always answered in:
        // the newest month first. `dir` is not read — a default order that
        // reverses is not a default.
        _ => ("ord", true),
    };
    let cols = format!("{lead}, year, month");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, year {dir}, month {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(PeriodCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_PERIOD_LIMIT)
        .clamp(1, MAX_PERIOD_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({PERIOD_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($2::text[] IS NULL OR status = ANY($2))
                AND ($3::text[] IS NULL OR year::text = ANY($3))
         )
         SELECT * FROM kept
          WHERE $4::int IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept
                                  WHERE year = $4 AND month = $5)
          ORDER BY {order}
          LIMIT $6"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&statuses)
        .bind(&years)
        .bind(cursor.as_ref().map(|c| c.year))
        .bind(cursor.as_ref().map(|c| c.month))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            PeriodCursor {
                year: row.try_get("year")?,
                month: row.try_get("month")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows.iter().map(to_period).collect::<Result<Vec<_>, _>>()?;
    let (total, facets) = period_facets(pool, &scope, needle.as_deref()).await?;
    Ok(PeriodPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many months there are, and how they split.
///
/// Per-value counts read the SEARCHED set and the total reads the FILTERED
/// one, for the reason every other facet query here gives: "Open 2" has to
/// mean "two months are open", not "two among the ones you have already
/// narrowed to open".
async fn period_facets(
    pool: &PgPool,
    scope: &PeriodScope,
    needle: Option<&str>,
) -> Result<(i64, PeriodFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({PERIOD_ROWS}), kept AS (
             SELECT * FROM searched
              WHERE ($2::text[] IS NULL OR status = ANY($2))
                AND ($3::text[] IS NULL OR year::text = ANY($3))
         )
         SELECT 'status' AS kind, status AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'year', year::text, COUNT(*)::bigint FROM searched GROUP BY year
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    );
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let years = (!scope.years.is_empty()).then(|| scope.years.clone());
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&statuses)
        .bind(&years)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut statuses_out = Vec::new();
    let mut years_out = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        match kind.as_str() {
            "status" => statuses_out.push(PeriodFacet {
                value,
                label: None,
                count: n,
            }),
            "year" => years_out.push(PeriodFacet {
                value,
                label: None,
                count: n,
            }),
            _ => total = n,
        }
    }
    // Statuses biggest first, as every other panel here. Years newest first,
    // because a year is a place on a line and not a size — a panel that put
    // 2024 above 2026 because it had more months in it would be a calendar
    // sorted by volume.
    statuses_out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    years_out.sort_by(|a, b| b.value.cmp(&a.value));
    Ok((
        total,
        PeriodFacets {
            statuses: statuses_out,
            years: years_out,
        },
    ))
}

/// Open a month for posting.
///
/// # Why it refuses rather than doing nothing
///
/// This was `INSERT … ON CONFLICT DO NOTHING`, so opening a CLOSED month
/// answered 200 having changed nothing at all — the screen showed the list
/// back, the month still said CLOSED, and there was no way to tell that from
/// a successful open of a month that was already open. A silent no-op that
/// looks like success is worse than either outcome: the one person it fools is
/// the one who just tried to reopen a sealed month and now believes they did.
///
/// So the three cases are separated and only one of them is quiet:
///
///   * the month does not exist — it is created, OPEN, which is what this
///     endpoint is for;
///   * the month exists and is OPEN — nothing to do, and saying so is honest
///     because the state the caller asked for is the state it is in;
///   * the month exists and is CLOSED — refused, 409, naming the month.
///
/// Reopening a closed month is deliberately NOT what this does. A close seals
/// entries (`close_period`), and undoing that is a decision with a reason
/// attached — `fiscal_period` carries `reopened_by` and `reopen_reason`
/// columns for exactly that act, and this is not it.
pub async fn open_period(pool: &PgPool, year: i32, month: i32) -> Result<(), AppError> {
    // One statement, so a concurrent close cannot land between a look and an
    // insert. `RETURNING` fires only on a real insert; on a conflict nothing
    // comes back and the existing row is read on the next line.
    let inserted = sqlx::query(
        "INSERT INTO fiscal_period (year, month) VALUES ($1,$2)
         ON CONFLICT (year, month) DO NOTHING
         RETURNING status",
    )
    .bind(year as i16)
    .bind(month as i16)
    .fetch_optional(pool)
    .await?;
    if inserted.is_some() {
        return Ok(());
    }

    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM fiscal_period WHERE year = $1 AND month = $2 FOR SHARE",
    )
    .bind(year as i16)
    .bind(month as i16)
    .fetch_optional(pool)
    .await?;
    match status.as_deref() {
        // Already what was asked for.
        Some("OPEN") | None => Ok(()),
        _ => Err(AppError::Conflict(format!(
            "period {year}-{month:02} is closed; opening it again would be a \
             reopening, which is a decision with a reason attached and not this"
        ))),
    }
}

/// Close a month, and say what it contained.
///
/// The count comes back so the screen can tell somebody what they just sealed.
/// A close that answered only "done" would be a close nobody double-checks.
pub async fn close_period(
    pool: &PgPool,
    year: i32,
    month: i32,
    actor: &str,
) -> Result<i64, AppError> {
    let updated = sqlx::query(
        "UPDATE fiscal_period SET status='CLOSED', closed_by=$3, closed_at=now()
          WHERE year=$1 AND month=$2 AND status='OPEN'",
    )
    .bind(year as i16)
    .bind(month as i16)
    .bind(actor)
    .execute(pool)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::Conflict(format!(
            "period {year}-{month:02} is not open"
        )));
    }
    // A date range rather than EXTRACT: it says the same thing, it can use the
    // index on `posting_date`, and it does not depend on how Postgres infers
    // the type of a bound value compared against a numeric.
    let row = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_entry
          WHERE posting_date >= make_date($1,$2,1)
            AND posting_date < (make_date($1,$2,1) + interval '1 month')",
    )
    .bind(year)
    .bind(month)
    .fetch_one(pool)
    .await?;
    Ok(row.try_get("n")?)
}

#[cfg(test)]
mod catalogue_tests {
    use super::required_semantic_keys;
    use std::collections::BTreeMap;

    /// One meaning, declared once.
    ///
    /// Worth a test rather than a convention because several lanes add to this
    /// list at the same time and two of them naming the same meaning is the
    /// likeliest way it goes wrong. A duplicate would not fail anything: the
    /// setup screen would show the row twice, an operator would map it twice,
    /// and the second mapping would be the one nobody could find. Two meanings
    /// pointing at ONE ACCOUNT is fine and deliberate — three do below — but
    /// one key twice is a merge nobody finished.
    #[test]
    fn every_meaning_is_declared_exactly_once() {
        let mut seen: BTreeMap<String, usize> = BTreeMap::new();
        for doc in required_semantic_keys() {
            *seen.entry(doc.key.clone()).or_default() += 1;
        }
        let doubled: Vec<&String> = seen
            .iter()
            .filter(|(_, count)| **count > 1)
            .map(|(key, _)| key)
            .collect();
        assert!(
            doubled.is_empty(),
            "declared more than once — two lanes probably added the same meaning: {doubled:?}"
        );
    }
}
