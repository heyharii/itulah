//! The chart of accounts, the map into it, the periods, and every balance.
//!
//! Nothing here writes to the journal — that is `poster.rs`, and it is the only
//! door. What this module does is read, and the shape of the reads is the point:
//!
//! **No balance is stored.** Every figure below is summed from `journal_line`
//! when requested. A group account's balance covers its nested-set interval,
//! rebuilt from the declared `parent_code` tree. Account numbers identify
//! accounts; they are not parsed to infer ancestors. This permits a compact,
//! stable four-digit COA while preserving arbitrary chart depth.

use super::poster::HEAD_OFFICE_SITE;
use crate::cloud::application::AppError;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};

/// One account as the Finance chart has it.
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
    /// Tree depth from the root, sent so the browser can indent without
    /// measuring account numbers.
    pub depth: i32,
    /// A heading. Has a balance by summation; nothing may be posted to it.
    pub is_group: bool,
    pub is_active: bool,
    pub site_id: Option<String>,
    /// Set on goods-in-transit leaves to identify where the goods came from.
    pub counterparty_site_id: Option<String>,
    /// How many accounts hang directly under this one, so a tree can show an
    /// expander without fetching the children first.
    pub child_count: i64,
    /// Which family of categories this account takes, or `null` for the
    /// sixteen that take none.
    ///
    /// Travels with the account because it is a property OF the account, not
    /// of the screen: `6301` takes an `expense_category` and refuses a line
    /// without one; `2101` takes none and refuses a line that carries one.
    /// Both refusals come from the database, and a picker that did not know
    /// this had to let somebody fill the form in, press Save, and read it off
    /// the refusal — which is what it was doing.
    pub category_family: Option<String>,
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
    /// Tree depth from the root, independent of the account number.
    pub depth: i32,
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
    /// The `line_category` family the account behind this meaning declares, or
    /// `None` when it declares none.
    ///
    /// The chart of forty keeps one account per REPORT LINE and moves every
    /// other distinction onto the line — which bank, which rack, which PPh
    /// article, electricity or water. Most of those distinctions already had a
    /// column or a sub-ledger; what was left became `line_category`, and this
    /// is the family the map row beside this meaning has to choose from.
    ///
    /// `None` is a statement, not a gap. It says the account this points at
    /// answers "which one" some other way — `bank_account_id` for the three
    /// bank meanings, `asset_id` for the six asset ones, `supplier_id`,
    /// `financing_facility`, `principal` — and the database will REFUSE a line
    /// that carries a category into it. Getting this wrong in either direction
    /// is a refusal at posting time, so the Account Map screen shows it beside
    /// the key rather than leaving somebody to find out.
    pub category_family: Option<String>,
}

fn key(
    key: &str,
    label: &str,
    expects: &str,
    qualified: bool,
    needed_for: &str,
    category_family: Option<&str>,
) -> SemanticKeyDoc {
    SemanticKeyDoc {
        key: key.into(),
        label: label.into(),
        expects: expects.into(),
        qualified,
        needed_for: needed_for.into(),
        // Positional and required, rather than a builder call a new key could
        // be written without. Twenty of the seventy-eight are `None`, and a
        // `None` that was reached by forgetting reads exactly like one that was
        // reached by deciding — so the compiler asks the question every time.
        category_family: category_family.map(Into::into),
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
             SELECT DISTINCT r.role, r.site_id
               FROM account_resolution r
              WHERE r.role = ANY($1)
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
/// The NAME comes from the site's `unit`, not from `site`, and that is the
/// whole of the unit-domain decision taken on 2026-09-13 and made a table on
/// 2026-09-27 (0450): the books belong to units, and a site belongs to one. Accounting's fourteen units
/// are head office and thirteen shops — suffix `00` is HO in the client's own
/// codes — while `site` is the fourteen places STOCK sits. The two lists
/// coincide because head office has one site, the Gudang, and `site.unit_id`
/// records that (`dc → ho`). It is a column rather than a join on equal ids,
/// because the day head office opens a second premises is one row to add.
///
/// Reading `site.name` here is what made every finance screen print "DC" where
/// the books, the chart and this function's own comment all mean head office.
/// Since 0256 the row says `ho`/`HO` itself and the two names agree, which is
/// also why the ordering sorts on kind `HO`: there is no longer a `DC` row to
/// put first, and sorting on one would have quietly filed head office
/// fourteenth — between `store-13` and nothing.
/// `COALESCE` over a left join for the same reason it always was: a site whose
/// unit cannot be read is a fault worth seeing as itself, not as a missing row.
pub async fn book_locations(pool: &PgPool) -> Result<Vec<BookLocation>, AppError> {
    let rows = sqlx::query(
        "SELECT s.id AS site_id,
                COALESCE(p.name, s.name) AS name,
                COALESCE(p.kind, s.kind) AS kind,
                (SELECT COUNT(*) FROM ledger_account a WHERE a.site_id = s.id)::bigint AS account_count
           FROM site s
           LEFT JOIN unit p ON p.id = s.unit_id
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
    // Retired meanings from earlier day-posting rules are deliberately absent.
    // The current rule uses the live client chart's sales, tender, tax and
    // receivable meanings; QRIS follows the debit-card route by owner decision.
    vec![
        key(
            "inventory",
            "Merchandise inventory",
            "1029 Persediaan Barang Dagangan",
            false,
            "Payables",
            None,
        ),
        key(
            "trade_payable",
            "Supplier payable",
            "2002 Hutang Suppliers Barang Dagangan · which one is supplier_id",
            false,
            "Payables",
            None,
        ),
        // The four a tax type names and nothing pointed at before 0279. The
        // accounts existed — `2012101001`, `1011302002`, `2012101006`,
        // `2012101004` — with no meaning bound to them, so a tax period had a
        // balance in the chart and no way to resolve it.
        // Equity, which had accounts and no meanings: `3013001001 Modal Setor`
        // and `3013001004 Prive`. 0281 gives owners an identity, and a movement
        // has to resolve an account the same way everything else does.
        key(
            "capital_contributed",
            "Capital put in by an owner",
            "3002 Modal Setor · which one is principal",
            false,
            "Equity",
            None,
        ),
        key(
            "owner_drawings",
            "Drawings taken by an owner",
            "3004 Prive · which one is principal",
            false,
            "Equity",
            None,
        ),
        key(
            "pph21_payable",
            "PPh 21 owed",
            "2011 Hutang Pajak PPH Pasal 21",
            false,
            "Tax",
            None,
        ),
        key(
            "pph25_credit",
            "PPh 25 paid in advance",
            "1046 Prepaid - PPh Pasal 25",
            false,
            "Tax",
            None,
        ),
        key(
            "pph29_payable",
            "PPh 29 owed",
            "2015 Hutang Pajak PPH Pasal 25 (no PPh 29 leaf; review)",
            false,
            "Tax",
            None,
        ),
        key(
            "pbb_payable",
            "Land and building tax owed",
            "2014 Hutang Pajak Bumi & Bangunan",
            false,
            "Tax",
            None,
        ),
        key(
            "vat_in",
            "Input VAT",
            "1048 Prepaid - VAT (PPN Masukan)",
            false,
            "Payables",
            None,
        ),
        key(
            "purchase_discount",
            "Purchase discount and price variance",
            "8004 Potongan Pembelian",
            false,
            "Payables",
            None,
        ),
        key(
            "non_merchandise_payable",
            "Non-merchandise payable",
            "2004 Hutang Supplier Non Barang Dagang",
            false,
            "Expenses",
            None,
        ),
        key(
            "accrued_expense",
            "Accrued expense",
            "2022–2026 … YMHD, per qualifier",
            true,
            "Payables",
            None,
        ),
        key(
            "cash",
            "Cash on hand",
            "1002 Cash on Hand",
            false,
            "Cash & Bank",
            None,
        ),
        key(
            "petty_cash",
            "Petty cash",
            "1003 Petty Cash",
            false,
            "Cash & Bank",
            None,
        ),
        key(
            "cashier_float",
            "Cashier float",
            "1004 Modal Kasir",
            false,
            "Cash & Bank",
            None,
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
            "1010–1014 Cash In Bank Tabungan, per bank",
            true,
            "Cash & Bank",
            None,
        ),
        key(
            "bank_giro",
            "Bank — giro",
            "1005–1009 Cash In Bank Giro, per bank",
            true,
            "Cash & Bank",
            None,
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
            "2005–2009 Outstanding Giro, per bank",
            true,
            "Payables",
            None,
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
            "1015–1018 Time Deposit, per bank",
            true,
            "Cash & Bank",
            None,
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
            "6043 Biaya Bank HO",
            false,
            "Cash & Bank",
            None,
        ),
        key(
            "interest_income",
            "Bank interest received",
            "8002 Pendapatan Bunga Bank",
            false,
            "Cash & Bank",
            None,
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
            "8015 Current Tax Inc/Exp PPH Pasal 25",
            false,
            "Cash & Bank",
            None,
        ),
        // The residue between what the return documents say was refunded and
        // what their refund rows add up to — `domain::sales_posting` — and
        // nothing else. Two keys since 0296, one per side, because the sign is
        // known at the one moment the rule computes the residue and a REVENUE
        // account is no place for the days it costs money. Documents over rows
        // is a credit here; rows over documents is a debit to `rounding_loss`.
        key(
            "rounding",
            "Rounding difference — gain",
            "8003 Selisih pembulatan",
            false,
            "Cash & Bank",
            None,
        ),
        key(
            "rounding_loss",
            "Rounding difference — loss",
            "8003 Selisih pembulatan",
            false,
            "Cash & Bank",
            None,
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
        //
        // Since 0296 this is the OVER side only. A till that came up short was
        // a debit inside a revenue account — arithmetically right, and the one
        // presentation defect the collapse to forty was meant to cure — so the
        // three rules that book a difference (`cash_counts`, `store_money`,
        // an ADJUSTMENT) credit this on an overage and debit `cash_shortage`
        // on a shortage. Both are unqualified: the unit is the dimension.
        key(
            "cash_variance",
            "Cash count difference — over",
            "8008 Pendapatan (Biaya) Lain-Lain (kelebihan kas)",
            false,
            "Cash & Bank",
            None,
        ),
        key(
            "cash_shortage",
            "Cash count difference — short",
            "1023 Piutang Kepala Toko at a store, 1022 Piutang Pegawai at head office (kekurangan kas)",
            false,
            "Cash & Bank",
            None,
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
            "1020 Piutang kartu Kredit, per scheme",
            true,
            "Receivables",
            None,
        ),
        key(
            "card_receivable_debit",
            "Debit card receivable",
            "1021 Piutang Debit Card, per bank",
            true,
            "Receivables",
            None,
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
            "1023 Piutang Kepala Toko",
            false,
            "Receivables",
            None,
        ),
        key(
            "card_fee",
            "Card fee (MDR)",
            "6005 Biaya Credit Card",
            false,
            "Receivables",
            None,
        ),
        // The three the counter takes that the client's chart never answered
        // for, and the one it answers for too many times.
        //
        // A card sale has had two receivables and a fee account since the
        // chart was imported. QRIS settles exactly the same way — the money
        // reaches the bank a day or two later, net of a fee — and had nothing
        // at all, so it could not be followed from the till to the statement.
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
            "2033 Uang Muka - Penjualan",
            false,
            "Sales",
            None,
        ),
        // The member-points half of the same story has NO key here on purpose.
        // The client's chart keeps a loyalty obligation on `66 Hutang
        // Lain-lain`, and 0264 left that account without a home in the
        // forty-account shape in as many words: "it needs its own decision".
        // Until Finance makes it, a redemption posts nothing, which is the
        // state 0297 described — and the honest one, because a liability
        // booked to a related-party payable would be wrong in a way that
        // balances.
        //
        // What a giveaway costs. The chart has `6101 Beban penjualan` with the
        // client's own categories since 0287/0289; what was missing is the one
        // meaning a rule can name, so that issuing a free-sample voucher and a
        // BOGO giveaway are the same ask. This is the client's `74 Biaya
        // Promosi` and `76 Biaya Advertising / Iklan`, which are the SAME
        // account carrying two categories.
        key(
            "marketing_expense",
            "Promotion and marketing expense",
            "6006 Biaya Promosi",
            false,
            "Sales",
            None,
        ),
        // The sibling the client keeps on the SAME account with a different
        // category — their #76 Biaya Advertising / Iklan. Two meanings rather
        // than one key with a parameter, because the category comes from the
        // map and not from the caller: an agency invoice and a giveaway are
        // different questions asked of the same line of the profit and loss.
        key(
            "advertising_expense",
            "Advertising expense",
            "6008 Biaya Advertising / Iklan",
            false,
            "Sales",
            None,
        ),
        // A tender that is none of the named four already has its pair —
        // `other_receivable` / `revenue_other`, registered further down and
        // used by `domain::sales_posting`, so a day containing one still
        // posts.
        key(
            "affiliate_receivable",
            "Inter-unit receivable",
            "1057/1058/1059 Piutang Affiliasi at HO; 2028/2029/2030 at a unit (0380), per kind:counterparty",
            true,
            "Receivables",
            None,
        ),
        key(
            "affiliate_payable",
            "Inter-unit payable",
            "2028 Pembiayaan / 2029 Atas Barang / 2030 Lain-lain Principal at a unit; 1057/1058/1059 at HO (0380), per kind:counterparty",
            true,
            "Payables",
            None,
        ),
        key(
            "goods_in_transit",
            "Goods in transit",
            "1031 BDP Barang Dagangan (1032 for bags)",
            true,
            "Inventory & COGS",
            None,
        ),
        key(
            "cogs",
            "Cost of goods",
            "5002 Harga Pokok Pembelian",
            false,
            "Inventory & COGS",
            None,
        ),
        key(
            "stock_loss",
            "Stock count variance",
            "8007 Kehilangan Barang atau Selisih Stock Opname",
            false,
            "Inventory & COGS",
            None,
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
        // `asset_disposal_result` was on this same leaf too, so it was three
        // meanings on 8010110007. That was the client's filing, not ours — and
        // 0296 unpicked the half of it that put losses under income.
        key(
            "bad_debt_expense",
            "Receivable written off",
            "6051 Biaya Penyisihan Kerugian Piutang",
            false,
            "Corrections",
            None,
        ),
        // The client's `8010110007` was one signed leaf. It is two meanings
        // since 0296: a payable given up on, or anything else that is income
        // with no better name, credits this; a cost with no better name debits
        // `other_expense`. A correction that names either with a direction
        // that would put it on the wrong side is routed to the twin —
        // `corrections::sides_for` — so no rule debits a `4301` meaning.
        key(
            "other_income_expense",
            "Other income",
            "8008 Pendapatan (Biaya) Lain-Lain",
            false,
            "Corrections",
            None,
        ),
        key(
            "other_expense",
            "Other expense",
            "8008 Pendapatan (Biaya) Lain-Lain",
            false,
            "Corrections",
            None,
        ),
        key(
            "prepaid_expense",
            "Prepaid expense",
            "1036–1044 … Bayar Dimuka, per qualifier",
            true,
            "Expenses",
            None,
        ),
        key(
            "advance",
            "Advance",
            "1051–1054 Advanced - Travelling/Purchase/Contractors/Others, per purpose",
            true,
            "Expenses",
            None,
        ),
        key(
            "fixed_asset",
            "Fixed asset",
            "1061–1080 per asset class",
            true,
            "Fixed Assets",
            None,
        ),
        key(
            "accumulated_depreciation",
            "Accumulated depreciation",
            "1082–1099 per asset class",
            true,
            "Fixed Assets",
            None,
        ),
        key(
            "depreciation_expense",
            "Depreciation expense",
            "7007–7023 per asset class",
            true,
            "Fixed Assets",
            None,
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
            "1100 Reserve Replacement - Operating Equipment",
            true,
            "Fixed Assets",
            None,
        ),
        key(
            "replacement_expense",
            "Replacement expense",
            "7024 Biaya Replacement Operating Equipment",
            true,
            "Fixed Assets",
            None,
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
            "1113 Contract In Progress (CIP)",
            true,
            "Fixed Assets",
            None,
        ),
        key(
            "intangible_asset",
            "Intangible asset",
            "1104/1105/1111 per class",
            true,
            "Fixed Assets",
            None,
        ),
        key(
            "accumulated_amortisation",
            "Accumulated amortisation",
            "1106/1107/1112 per class",
            true,
            "Fixed Assets",
            None,
        ),
        key(
            "amortisation_expense",
            "Amortisation expense",
            "7025/7027/7026 per class",
            true,
            "Fixed Assets",
            None,
        ),
        // Where the difference between what an asset was worth and what it
        // fetched lands. The client's chart has no account named for it — they
        // keep no "Laba (Rugi) Penjualan Aktiva Tetap" — so the expectations
        // below point at the other-income and other-expense leaves the forty
        // do keep, and they are suggestions like every other on this screen.
        //
        // Two keys since 0296, one per side. This list used to argue for one
        // key on the grounds that which way it falls is arithmetic and two
        // mappings would have to agree about the same event. Both still true;
        // what changed is that the client's signed account no longer exists as
        // one account. A loss debited into `4301` sat inside REVENUE on the
        // income statement, and `financial_statements::section_of` reads root
        // 8 as cost — so `assets::dispose_asset` computes the result once and
        // credits this on a gain or debits `asset_disposal_loss` on a loss.
        //
        // Unmapped, disposal refuses and names whichever key that disposal
        // needed, which is the whole point: the Account Map screen lists both
        // as unset from the day this ships, rather than somebody discovering
        // it while trying to write off a stolen laptop.
        key(
            "asset_disposal_result",
            "Gain on disposal",
            "8008 Pendapatan (Biaya) Lain-Lain",
            false,
            "Fixed Assets",
            None,
        ),
        key(
            "asset_disposal_loss",
            "Loss on disposal",
            "8008 Pendapatan (Biaya) Lain-Lain",
            false,
            "Fixed Assets",
            None,
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
            "2043–2048 Pinjaman Jangka Panjang, per lender",
            true,
            "Loans & Financing",
            None,
        ),
        key(
            "interest_expense",
            "Interest",
            "8011 Biaya Bunga Pinjaman Bank (8012 leasing)",
            false,
            "Loans & Financing",
            None,
        ),
        // Sales uses the client's existing account tree. QRIS deliberately
        // follows the debit-card meanings because the owner chose not to add a
        // separate QRIS account; an unmapped acquirer still fails closed.
        key(
            "revenue_cash",
            "Sales — cash",
            "4002 Penjualan Tunai",
            false,
            "Sales posting",
            None,
        ),
        key(
            "revenue_debit",
            "Sales — debit card",
            "4003–4006 Penjualan Debit Card, per bank",
            true,
            "Sales posting",
            None,
        ),
        key(
            "revenue_credit",
            "Sales — credit card",
            "4007/4008 Penjualan Kartu Kredit, per scheme",
            true,
            "Sales posting",
            None,
        ),
        // OTHER: the tender that is none of the four — a marketplace payout, a
        // transfer, a payment link. The receivable is qualified by the
        // counterparty (TOKOPEDIA and the like), the income is one account.
        key(
            "sales_return",
            "Sales returns",
            "4013 Retur Penjualan",
            false,
            "Sales posting",
            None,
        ),
        key(
            "sales_discount",
            "Sales discount",
            "4012 Discount / Potongan Penjualan",
            false,
            "Sales posting",
            None,
        ),
        key(
            "vat_out",
            "Output VAT",
            "2013 Hutang VAT PPN Keluaran (head office)",
            false,
            "Sales posting",
            None,
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
            "8004 Potongan Pembelian",
            false,
            "Payables",
            None,
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
            "1052 Advanced - Purchase",
            false,
            "Payables",
            None,
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
            "2012 Hutang Pajak PPH Pasal 23 (withold)",
            false,
            "Payables",
            None,
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
            "2012 Hutang Pajak PPH Pasal 23 (PPh 4(2) has no leaf; told apart by the withholding key)",
            false,
            "Payables",
            None,
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
            "1002 Cash on Hand (no transit leaf; review)",
            false,
            "Cash & Bank",
            None,
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
            "2017 Biaya Gaji dan Upah YMHD",
            false,
            "Payables",
            None,
        ),
        // The salary expense a handed-over run charges. One leaf, `6201 Beban
        // Pegawai`, with the pay component named by the line's category -- the
        // twenty-six client leaves this replaced were an account doing a
        // dimension's job.
        key(
            "payroll_expense",
            "Employee expense",
            "6012–6024 at a store, 6026–6038 at head office, per component class",
            false,
            "Payroll",
            None,
        ),
        // An approved expense claim, sanctioned line by line and posted per
        // claim type. The qualifier IS the type code (TRAVEL, MEDICAL, ...),
        // and it resolves EXACTLY — no fall-through to an unqualified row —
        // so the map rows for it arrive with the types themselves: defining
        // the first type maps it at every site, and an unmapped type refuses
        // by name at approval. A type whose code names a specific expense
        // draws that expense's leaf (medical 6016/6030, travel 6047, and so
        // on); a claim that names nothing else draws `6076 Biaya Klaim
        // Karyawan`, minted by 0372 because the client chart had no general
        // claim leaf. No category family: the account's identity is answered
        // by the qualifier, the way the bank meanings are answered by
        // `bank_account_id`.
        // And what the company owes the employee between the sanction and the
        // petty-cash payout that clears it. The client 267 chart had no claim
        // payable leaf — 0371 had to borrow `Hutang Lain - Lain` — so 0372
        // minted `2049 Hutang Klaim Karyawan` for it. The employee the debt is
        // owed TO is the line's party (0300), not a category.
        key(
            "employee_claim_payable",
            "Owed to an employee for an approved claim",
            "2049 Hutang Klaim Karyawan",
            false,
            "Payables",
            None,
        ),
        // What a shop may spend petty cash or an operating fund on. Nine, and
        // the ninth is a catch-all on purpose: a category list with no bottom
        // means a real receipt eventually has nowhere to go, and the shop pays
        // for it out of the drawer instead — which is the exact behaviour this
        // lane exists to end.
        // ── end lane-B ───────────────────────────────────────────────────
    ]
}

const ACCOUNT_COLUMNS: &str = "a.account_code, a.name, a.parent_code, a.root_class::text AS root_class,
     a.depth::int AS depth, a.is_group, a.is_active, a.site_id, a.counterparty_site_id,
     (SELECT COUNT(*) FROM ledger_account c WHERE c.parent_code = a.account_code)::bigint AS child_count,
     a.category_family";

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
        category_family: row.try_get("category_family")?,
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
    /// Free text, tried against an account-number prefix and the name
    /// anywhere.
    ///
    /// Both, because both are how people look: finance quotes a code,
    /// everybody else quotes a name, and a search that only did one of them
    /// would send half its users to the tree to hunt.
    pub needle: Option<String>,
    /// Root classes to keep — `1` … `8`, matching the top-level account. Empty
    /// means every class — an empty filter and no filter are
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
           -- The second place an account row is assembled. `to_account` reads
           -- both, so a column added to ACCOUNT_COLUMNS and not to this one is
           -- a search that answers: no column found for that name.
           a.category_family,
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
       -- Search mode: the whole chart. A code-number prefix is useful when
       -- somebody remembers only the first digits; names match any word.
       AND ($2::text IS NULL
            OR a.account_code LIKE $2 || '%' OR a.name ILIKE '%' || $2 || '%')
";

/// The chart, one page at a time, beside how big the whole answer is.
pub async fn account_page(pool: &PgPool, scope: AccountScope) -> Result<AccountPage, AppError> {
    // A blank search is not a search. `Some("")` would compile to a prefix
    // match on the empty string, which matches the whole chart and costs a
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

    // The account number is no longer the hierarchy. Read the declared tree
    // ancestors in chart order through the nested-set bounds.
    let path_sql = format!(
        "SELECT {ACCOUNT_COLUMNS} FROM ledger_account a
          JOIN ledger_account target ON target.account_code = $1
          WHERE a.lft < target.lft AND a.rgt > target.rgt
          ORDER BY a.lft"
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
/// The nested-set bounds make a heading meaningful: asking for an account
/// includes its own balance and the balances of all descendants, regardless
/// of how their account numbers are assigned.
pub async fn account_balance(
    pool: &PgPool,
    code: &str,
    site_id: Option<&str>,
    as_of: Option<NaiveDate>,
) -> Result<AccountBalance, AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(l.debit_minor),0)::bigint AS debit,
                COALESCE(SUM(l.credit_minor),0)::bigint AS credit
           FROM ledger_account selected
           JOIN ledger_account descendant
             ON descendant.lft >= selected.lft AND descendant.rgt <= selected.rgt
           JOIN journal_line l ON l.account_code = descendant.account_code
           JOIN journal_entry e USING (entry_id)
          WHERE selected.account_code = $1
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
    SELECT l.account_code, a.name, a.root_class::text AS root_class,
           a.depth::int AS depth, l.site_id,
           SUM(l.debit_minor)::bigint AS debit,
           SUM(l.credit_minor)::bigint AS credit,
           (SUM(l.debit_minor) - SUM(l.credit_minor))::bigint AS net
      FROM journal_line l
      JOIN journal_entry e USING (entry_id)
      JOIN ledger_account a ON a.account_code = l.account_code
     WHERE e.posting_date <= $1
       AND ($2::text IS NULL OR l.site_id = $2)
     GROUP BY l.account_code, a.name, a.root_class, a.depth, l.site_id
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
            depth: row.try_get("depth")?,
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

// ── the category on a line ───────────────────────────────────────────────
//
// The chart of forty keeps one account per line of the balance sheet and the
// profit and loss, and nothing else. Which bank, which rack, which PPh article,
// electricity or water — every one of those used to be its own account code,
// and all of them are now keys on the journal line. Most already had somewhere
// to live: `bank_account_id`, `asset_id`, `supplier_id`, `counter_site_id`, a
// tax type, a facility, a principal. What was left over became one table,
// `line_category`, with a `family` column saying which kind of distinction each
// value is.
//
// The rule is the one `dimension` and `requires_counter_site` already set:
// an account DECLARES what a line has to bring, and a line that brings the
// wrong thing is refused. Migration 0288's trigger is the guarantee. What
// follows is the explanation — and, on the map, the refusal that happens
// EARLIER than the trigger could, because a map row is written weeks before
// anything posts through it.

/// What is wrong with the category on a line or a mapping.
///
/// Separated from the message so the verdict is reached without a query of its
/// own: both callers already read the account, and everything the decision
/// needs — what the account declares, what the named code's own row says, and
/// the codes a refusal would list — rides back on that read.
enum CategoryFault {
    /// The account declares a family and nothing was named.
    Missing,
    /// The account declares none and something was named anyway.
    Unwanted(String),
    /// Named a code `line_category` has never heard of.
    Unknown(String),
    /// Named a real code from the wrong family: `PETTY` on an expense account.
    WrongFamily(String, String),
    /// Named a code that is no longer offered.
    Retired(String),
}

/// Decide, without touching the database.
///
/// `declared` is the account's `category_family`; `given` is what the line or
/// the mapping carries; `given_family` and `given_active` are that code's own
/// row, absent when there is no such row.
fn category_fault(
    declared: Option<&str>,
    given: Option<&str>,
    given_family: Option<&str>,
    given_active: Option<bool>,
) -> Option<CategoryFault> {
    // Trimmed and emptied here rather than at four call sites: a category
    // arriving as `Some("")` from a form that cleared its box means the same
    // thing as no category, and the difference must not decide whether a
    // posting works.
    let given = given.map(str::trim).filter(|value| !value.is_empty());
    match (declared, given) {
        (None, None) => None,
        (None, Some(named)) => Some(CategoryFault::Unwanted(named.to_string())),
        (Some(_), None) => Some(CategoryFault::Missing),
        (Some(wanted), Some(named)) => match given_family {
            None => Some(CategoryFault::Unknown(named.to_string())),
            Some(family) if family != wanted => Some(CategoryFault::WrongFamily(
                named.to_string(),
                family.to_string(),
            )),
            // Inactive is refused for NEW work only, which is every caller of
            // this: both the poster and the Account Map are writing something.
            // Nothing here reads history, and a category that was retired last
            // year must keep explaining the lines it is already on.
            _ if given_active == Some(false) => Some(CategoryFault::Retired(named.to_string())),
            _ => None,
        },
    }
}

/// How many valid codes a refusal lists before it stops.
///
/// Five, because the point is to show the SHAPE of the family — that `pot`
/// means DRAWER and PETTY and not a free-text note — and `expense_category` has
/// forty-eight values nobody reads off an error message. `CATEGORY_CHOICES`
/// fetches a sixth, and the only thing that sixth is for is knowing whether to
/// say there are more; keep the two numbers in step.
const CATEGORY_HINT: usize = 5;

/// The codes a refusal would list, fetched alongside the account rather than
/// after it.
///
/// A lateral and not a second round trip, which is the same bargain
/// [`validate_account_posting`] already struck with the bank accounts: that
/// function runs once per posted line, and buying a good error message at the
/// price of a query per line would be paying for the failure on every success.
/// `line_category` is a few hundred rows behind an index on `family`, so the
/// probe costs what reading the account costs.
///
/// Joined against `a`, so it expects `ledger_account a` in scope.
const CATEGORY_CHOICES: &str = "
    LEFT JOIN LATERAL (
        SELECT COALESCE(
                   ARRAY_AGG(k.category_code ORDER BY k.sort_order, k.category_code),
                   '{}') AS codes
          FROM (SELECT category_code, sort_order
                  FROM line_category
                 WHERE family = a.category_family AND is_active
                 ORDER BY sort_order, category_code
                 LIMIT 6) k
    ) choices ON true";

/// The tail of every category refusal: what would have worked.
fn category_tail(family: &str, choices: &[String]) -> String {
    if choices.is_empty() {
        return format!(
            " Nothing is on file under '{family}' yet, which is a gap in the setup and not in \
             this entry."
        );
    }
    let more = choices.len() > CATEGORY_HINT;
    let listed = choices
        .iter()
        .take(CATEGORY_HINT)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if more {
        format!(" Choose one of {listed}, or another {family}.")
    } else {
        format!(" Choose one of {listed}.")
    }
}

/// Turn a verdict into the sentence a person reads.
fn category_refusal(
    code: &str,
    name: &str,
    declared: Option<&str>,
    choices: &[String],
    fault: CategoryFault,
    intent: Intent,
) -> AppError {
    let family = declared.unwrap_or("category");
    let message = match fault {
        CategoryFault::Missing => {
            let hint = category_tail(family, choices);
            match intent {
                Intent::Post => format!(
                    "{code} {name} is one account for every {family}, and this line names none. \
                     The account is the report line; the {family} is what it was for.{hint}"
                ),
                Intent::Map => format!(
                    "{code} {name} is one account for every {family}, so a mapping has to choose \
                     one. Without it every posting through this meaning would be refused.{hint}"
                ),
            }
        }
        CategoryFault::Unwanted(given) => match intent {
            Intent::Post => format!(
                "{code} {name} takes no category, and this line carries {given}. What this \
                 account is told apart by is its own sub-ledger — the bank account, the asset, \
                 the supplier — not a category."
            ),
            Intent::Map => format!(
                "{code} {name} takes no category, and this mapping sets {given}. Leave it empty: \
                 what narrows this account is its sub-ledger, not a category."
            ),
        },
        CategoryFault::Unknown(given) => format!(
            "there is no category {given}; {code} {name} wants a {family}.{}",
            category_tail(family, choices)
        ),
        CategoryFault::WrongFamily(given, actual) => format!(
            "{given} is a {actual}, and {code} {name} wants a {family}. The two families are not \
             interchangeable — that is what having families is for.{}",
            category_tail(family, choices)
        ),
        CategoryFault::Retired(given) => format!(
            "{given} has been retired, so nothing new is filed under it. It still explains the \
             lines already on it.{}",
            category_tail(family, choices)
        ),
    };
    AppError::Validation(message)
}

/// Refuse a category the account's own declaration does not permit.
///
/// # Why at map time and not only at post time
///
/// Because a map row is written weeks before anything posts through it, by
/// somebody sitting on the Account Map screen who can fix it in the same
/// minute. Migration 0288's trigger catches a bad pair too — but it catches it
/// on the day a shop's till tries to close, in front of somebody who did not
/// set the mapping, cannot change it, and is holding a queue.
///
/// So this runs on the way IN. `set_account_mapping` calls it beside
/// [`assert_postable`], for the same reason that one exists: the constraint is
/// the guarantee, this is the explanation, and the explanation should arrive
/// while the person who caused it is still in the room.
pub async fn assert_category_for_account(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    category_code: Option<&str>,
    intent: Intent,
) -> Result<(), AppError> {
    let code = account_code.trim();
    let given = category_code
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let sql = format!(
        "SELECT a.name, a.category_family, c.family AS given_family, c.is_active AS given_active,
                choices.codes AS choices
           FROM ledger_account a
           LEFT JOIN line_category c ON c.category_code = $2
           {CATEGORY_CHOICES}
          WHERE a.account_code = $1"
    );
    let row = sqlx::query(&sql)
        .bind(code)
        .bind(given)
        .fetch_optional(executor)
        .await?;
    // Absent is not this function's refusal to make: `assert_postable` has
    // already said "no account {code} in the chart" in better words.
    let Some(row) = row else { return Ok(()) };
    let name: String = row.try_get("name")?;
    let declared: Option<String> = row.try_get("category_family")?;
    let given_family: Option<String> = row.try_get("given_family")?;
    let given_active: Option<bool> = row.try_get("given_active")?;
    let choices: Vec<String> = row.try_get("choices")?;

    match category_fault(
        declared.as_deref(),
        given,
        given_family.as_deref(),
        given_active,
    ) {
        None => Ok(()),
        Some(fault) => Err(category_refusal(
            code,
            &name,
            declared.as_deref(),
            &choices,
            fault,
            intent,
        )),
    }
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
    /// The `line_category` the line will carry, resolved from the map or named
    /// by the person writing the entry.
    ///
    /// Checked here rather than left to 0288's trigger for the reason every
    /// other check in this function is: the trigger says which constraint
    /// failed, and this says which line, which account and which of the codes
    /// on file would have worked.
    pub category_code: Option<&'a str>,
    /// Which of our real bank accounts the line says it moved, when it says.
    ///
    /// A rule that knows sets it. Everything else leaves it `None` and lets the
    /// validator resolve it, which it can do whenever the map has already said
    /// which bank — and must refuse when it has not.
    pub bank_account_id: Option<uuid::Uuid>,
    /// The meaning this line came through, when it came through one.
    ///
    /// Carried only so the bank resolution below can read what the map already
    /// declared. Nothing else in this function looks at it, and nothing should:
    /// policy is about the ACCOUNT, and a rule that behaved differently
    /// depending on which door reached the account would be two policies.
    pub semantic_key: Option<&'a str>,
    /// And how that meaning was narrowed. On a bank leg this is the
    /// institution's own code — BCA, MANDIRI — which is the convention 0269
    /// set and `BANK_MEANINGS` above explains.
    pub qualifier: Option<&'a str>,
}

/// Which kind of real account a money meaning stands for.
///
/// The other half of `BANK_MEANINGS`: that list says a meaning holds money at a
/// bank, and this says what sort of account it is. Both halves are needed to
/// read a map row back to an account now that fourteen of them share `1102` —
/// the qualifier gives the bank, this gives the product, and `company_bank_account`
/// is unique on the pair unless we genuinely hold two of the same at one bank,
/// which is the one case that still has to be named outright (0269).
fn bank_account_kind(semantic_key: &str) -> Option<&'static str> {
    match semantic_key {
        "bank_giro" => Some("GIRO"),
        "bank_savings" => Some("SAVINGS"),
        "time_deposit" => Some("TIME_DEPOSIT"),
        _ => None,
    }
}

/// The kinds a PERSON writes, as opposed to the kinds a rule writes.
///
/// `MANUAL` is the hand-written journal. The other three are the corrections
/// (0129): still keyed by a person, but through a document that a second person
/// approves — which is the distinction `manual_je_policy = 'OVERRIDE'` exists to
/// draw.
const HAND_KEYED_KINDS: [&str; 4] = ["MANUAL", "RECLASS", "ADJUSTMENT", "WRITE_OFF"];

/// The meanings that say "this natural account holds money at a bank".
///
/// The list is here rather than a column on `ledger_account`, and rather than a
/// range of account codes in Rust, because the account map ALREADY declares it:
/// pointing `bank_giro`/`BCA` at an account at a place is somebody saying that
/// account is our BCA giro money there, and the qualifier they use is the
/// institution's own code (0269). Nothing else has to be configured, and nothing
/// can drift out of step with it.
///
/// `bank_admin_fee` is not here: it is an expense the bank charges, not money
/// held at one. `giro_outstanding` is not here either — an unpresented giro is a
/// liability of ours, not a balance at the bank.
const BANK_MEANINGS: [&str; 3] = ["bank_giro", "bank_savings", "time_deposit"];
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
///
/// # Two grains, since the chart became forty accounts
///
/// `posting_mode` and `manual_je_policy` are read at the ACCOUNT grain by
/// default and at the (account, category) grain where `account_category_policy`
/// has a row — nine of them, written by 0289, each carrying forward one client
/// account whose door did not survive the merge. See the comment at the
/// override itself for why neither "strictest wins" nor "loosest wins" was a
/// defensible rule.
///
/// `account_source_rule` is read at both grains too, since 0294. It was keyed
/// on the account alone, and four rows somebody had decided deliberately (0139,
/// 0267, 0268) turned out to be decisions about something NARROWER than one of
/// the forty: `1011302003 Prepaid PPh 29` admits OPENING and nothing else, and
/// at the account grain that same rule on `1402` would freeze input VAT and the
/// PPh 25 instalment with it. So a rule may name a category. NULL means the
/// whole account, which is what every rule written before 0294 means, and the
/// join below has to keep letting those through or the four decisions become
/// forty.
/// The account, its policy, its bank accounts and the category the line names —
/// everything [`validate_account_posting`] decides on, in one read.
const POLICY_SELECT: &str = "
    SELECT a.name, a.posting_mode, a.manual_je_policy, a.dimension,
           a.requires_counter_site, a.category_family,
           cat.family AS given_family, cat.is_active AS given_active,
           choices.codes AS choices,
           pol.posting_mode AS pol_posting_mode,
           pol.manual_je_policy AS pol_manual_je_policy,
           COALESCE(
               ARRAY_AGG(r.source_kind) FILTER (WHERE r.effect = 'ALLOW'),
               '{}'
           ) AS allowed,
           COALESCE(
               ARRAY_AGG(r.source_kind) FILTER (WHERE r.effect = 'DENY'),
               '{}'
           ) AS denied,
           -- Whether EVERY rule that matched was written about this CATEGORY
           -- rather than about the account. It changes no decision and it
           -- changes the sentence, which is the whole of its value: told that
           -- `1402` is reached by OPENING alone, a reader would go and widen an
           -- account that is not what is refusing them.
           --
           -- BOOL_AND rather than BOOL_OR, so an account carrying both grains
           -- understates rather than misleads: 'the account' sends a reader to
           -- a screen that shows both rules, and 'under PPH29' when a
           -- whole-account rule was also in play would send them to one that
           -- shows neither.
           BOOL_AND(r.category_code IS NOT NULL) AS rule_by_category,
           held.ids AS bank_ids, held.states AS bank_states,
           held.labels AS bank_labels, held.by_map AS bank_by_map, meant.is_bank
      FROM ledger_account a
      -- A rule with a category is about that pairing; a rule without one is
      -- about the whole account. Written as two arms of one condition rather
      -- than as two joins, because a line has one category and so matches at
      -- most one of them.
      LEFT JOIN account_source_rule r
             ON r.account_code = a.account_code
            AND (r.category_code IS NULL OR r.category_code = $4)
      -- The category the line carries, by its own primary key. A LEFT JOIN and
      -- not an inner one because a code nobody has heard of has to reach the
      -- refusal below rather than silently returning no row at all — which
      -- would read, wrongly, as 'no such account'.
      LEFT JOIN line_category cat ON cat.category_code = $4
      -- And the stricter door, when this pairing has one. Nine rows in 0289,
      -- each one a client account whose policy did not survive being merged
      -- into a bigger one. Absent — which is every pairing but those nine —
      -- leaves `a.posting_mode` and `a.manual_je_policy` governing exactly as
      -- they did before the chart shrank.
      LEFT JOIN account_category_policy pol
             ON pol.account_code = a.account_code AND pol.category_code = $4
      -- The real accounts registered against this ledger binding, in the
      -- order a person would be offered them: the primary first. Lateral
      -- rather than three correlated subqueries so the whole of this check
      -- stays ONE round trip, which is what made it affordable in the
      -- posting path to begin with.
      -- Whether the map says this account holds money at a bank, at this
      -- place. The declaration of intent, and the only one needed: an
      -- account nobody has pointed a bank meaning at is not a bank account
      -- as far as this estate is concerned, and posts as it always did.
      LEFT JOIN LATERAL (
          SELECT COUNT(*) > 0 AS is_bank
            FROM account_resolution r
           WHERE r.account_code = a.account_code AND r.site_id = $2
             AND r.role = ANY($3)
      ) meant ON true
      LEFT JOIN LATERAL (
          SELECT COALESCE(ARRAY_AGG(c.account_id
                     ORDER BY c.is_primary DESC, c.account_no_digits), '{}') AS ids,
                 COALESCE(ARRAY_AGG(c.status
                     ORDER BY c.is_primary DESC, c.account_no_digits), '{}') AS states,
                 COALESCE(ARRAY_AGG(b.code || ' ' || c.account_no
                     ORDER BY c.is_primary DESC, c.account_no_digits), '{}') AS labels,
                 -- And which of them the LINE already named, without knowing it.
                 --
                 -- A leg built from `bank_giro` qualified BCA is somebody
                 -- saying 'our BCA giro money'. Until 0291 the account code
                 -- carried that sentence — `1011002001` WAS the BCA giro — and
                 -- there was one account on it, so the arm below that fills in
                 -- the only candidate always fired. Fourteen accounts on `1102`
                 -- ended that, and the sentence did not move: it is on the map
                 -- row. Matching it here is reading the same declaration off
                 -- its new home, not inferring anything.
                 COALESCE(ARRAY_AGG(
                     COALESCE(b.code = $5 AND c.kind = $6, FALSE)
                     ORDER BY c.is_primary DESC, c.account_no_digits),
                     '{}'::boolean[]) AS by_map
            FROM bank_account c
            JOIN bank b ON b.bank_id = c.bank_id
           -- `bank_account` (0308) holds our accounts and every party's in one
           -- table. This asks about OURS: a party row carries no ledger
           -- binding, so without the flag the join drags in supplier accounts
           -- whose `ledger_account_code` is null.
           WHERE c.is_company_account
             AND c.ledger_account_code = a.account_code AND c.site_id = $2
      ) held ON true";

/// The tail of that read. Everything the aggregate above does not group by
/// itself has to be named here, the two category columns and the hint included.
const POLICY_GROUPING: &str = "
     WHERE a.account_code = $1
     GROUP BY a.name, a.posting_mode, a.manual_je_policy, a.dimension,
              a.requires_counter_site, a.category_family,
              cat.family, cat.is_active, choices.codes,
              pol.posting_mode, pol.manual_je_policy,
              held.ids, held.states, held.labels, held.by_map, meant.is_bank";

pub async fn validate_account_posting(
    executor: impl sqlx::PgExecutor<'_>,
    account_code: &str,
    facts: PostingFacts<'_>,
) -> Result<Option<uuid::Uuid>, AppError> {
    let code = account_code.trim();
    let given_category = facts
        .category_code
        .map(str::trim)
        .filter(|value| !value.is_empty());
    // One query and not two: the allow-list is folded in as an array so that
    // adding this check costs the posting path a single round trip. The
    // category's own row and the codes a refusal would list are folded in the
    // same way and for the same reason — see `CATEGORY_CHOICES`.
    //
    // In three pieces only because `CATEGORY_CHOICES` is shared with
    // `assert_category_for_account` and a lateral has to sit between the FROM
    // and the WHERE. Read them as one statement.
    let sql = format!("{POLICY_SELECT}{CATEGORY_CHOICES}{POLICY_GROUPING}");
    // Which bank the map named, and which product. Empty is not a bank code, so
    // an unqualified meaning narrows nothing rather than matching every row.
    let bank_kind = facts.semantic_key.and_then(bank_account_kind);
    let bank_code = facts
        .qualifier
        .map(str::trim)
        .filter(|value| !value.is_empty() && bank_kind.is_some());
    let row = sqlx::query(&sql)
        .bind(code)
        .bind(facts.site_id)
        .bind(BANK_MEANINGS.as_slice())
        .bind(given_category)
        .bind(bank_code)
        .bind(bank_kind)
        .fetch_optional(executor)
        .await?;
    // Absent is not this function's refusal to make: `assert_postable` has
    // already said "no account {code} in the chart" in the poster's own words.
    let Some(row) = row else { return Ok(None) };

    let name: String = row.try_get("name")?;
    let account_mode: String = row.try_get("posting_mode")?;
    let account_manual: String = row.try_get("manual_je_policy")?;
    let dimension: Option<String> = row.try_get("dimension")?;
    let requires_counter_site: bool = row.try_get("requires_counter_site")?;
    let category_family: Option<String> = row.try_get("category_family")?;
    let given_family: Option<String> = row.try_get("given_family")?;
    let given_active: Option<bool> = row.try_get("given_active")?;
    let category_choices: Vec<String> = row.try_get("choices")?;
    let pol_mode: Option<String> = row.try_get("pol_posting_mode")?;
    let pol_manual: Option<String> = row.try_get("pol_manual_je_policy")?;
    let allowed: Vec<String> = row.try_get("allowed")?;
    let denied: Vec<String> = row.try_get("denied")?;
    let rule_by_category: bool = row
        .try_get::<Option<bool>, _>("rule_by_category")?
        .unwrap_or(false);

    let kind = facts.source_kind.trim();
    let hand_keyed = HAND_KEYED_KINDS.contains(&kind);
    let correction = CORRECTION_KINDS.contains(&kind);

    // The category is checked FIRST, before any policy is read off it, and the
    // order is load-bearing rather than tidy: which door governs below depends
    // on which category this line names, so a line naming a category that does
    // not belong to this account must be refused before its name is used to
    // pick a rule. Otherwise a typo would silently fall through to the
    // account's own, more permissive, policy — and post.
    //
    // 0288's trigger guarantees the pairing too, and has to, because the poster
    // is not the only thing that can reach `journal_line` from inside the
    // database. But a trigger fires at the end and names a constraint. This
    // names the line, the account, the family and up to five codes that would
    // have worked, which is the difference between somebody fixing a posting
    // rule and somebody filing a bug.
    if let Some(fault) = category_fault(
        category_family.as_deref(),
        given_category,
        given_family.as_deref(),
        given_active,
    ) {
        return Err(category_refusal(
            code,
            &name,
            category_family.as_deref(),
            &category_choices,
            fault,
            Intent::Post,
        ));
    }

    // ── which door governs ───────────────────────────────────────────────
    //
    // Merging 190 accounts into 40 merged 190 doors into 40, and neither
    // obvious rule for doing that is honest.
    //
    // Strictest-source-wins closes paths that are live today: cash on hand,
    // petty cash and cash in transit all admit an approved correction and
    // `Modal Kasir` does not, so a merged `1101 Kas` taking the strictest of
    // its sources would refuse the cash-variance correction that every till
    // reconciliation depends on. Most-permissive-wins opens paths that are
    // shut: `Selisih Pembulatan` is written only by a rule, and merged into a
    // `4301` that a person may journal, a person could journal rounding.
    //
    // So the account takes the most permissive of its sources, and the nine
    // pairings that needed the stricter one keep it at the category grain, in
    // `account_category_policy`. Each of those rows names the client account it
    // was kept from. A pairing with no row — which is nearly all of them — is
    // governed exactly as it was before the chart shrank.
    let by_category = pol_mode.is_some();
    let posting_mode = pol_mode.unwrap_or(account_mode);
    let manual_policy = pol_manual.unwrap_or(account_manual);
    // What to call the thing that is refusing, so the reader knows which of the
    // two to go and change. "4301 Pendapatan lain-lain under ROUNDING does not
    // take hand-written entries" is a different problem from "4301 Pendapatan
    // lain-lain does not", and it is answered somewhere else.
    let subject = match (by_category, given_category) {
        (true, Some(category)) => format!("{code} {name} under {category}"),
        _ => format!("{code} {name}"),
    };
    // And the sentence that says which of the two carries the rule — the fact
    // somebody about to go and widen the ACCOUNT's policy most needs to hear,
    // because widening it would not open this.
    let whose = if by_category {
        " The rule is on that pairing rather than on the account, so opening the account will \
         not open it."
    } else {
        ""
    };

    // Before anything else, because it is the one value that admits nothing: not
    // a rule, not a person, not an approved correction. 0263.
    if posting_mode == "BLOCKED" {
        return Err(AppError::Validation(format!(
            "{subject} takes no postings at all: what may move it has not been decided. \
             Nothing is wrong with the entry — it is waiting on a policy.{whose}"
        )));
    }
    if posting_mode == "AUTO_ONLY" && hand_keyed {
        return Err(AppError::Validation(format!(
            "{subject} is posted only by a rule; a {kind} entry cannot name it. Whatever moved it has a document of its own — post that instead.{whose}"
        )));
    }
    if hand_keyed {
        match manual_policy.as_str() {
            "NO" => {
                return Err(AppError::Validation(format!(
                    "{subject} does not take hand-written entries, corrections included.{whose}"
                )))
            }
            // The whole point of the third value: a person may reach it, but
            // only through a document somebody else agreed to.
            "OVERRIDE" if !correction => {
                return Err(AppError::Validation(format!(
                    "{subject} may be corrected but not journalled: raise an adjustment, a reclass or a write-off, and have it approved.{whose}"
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
    //
    // Which of the two grains the matched rule was written at is said out loud,
    // for the reason the policy override says it: "1402 is reached by OPENING
    // alone" would send somebody to widen an account that is not what refused
    // them — only `1402 × PPH29` is held that way, and every other prepaid tax
    // on that account posts as it always did.
    let rule_subject = match (rule_by_category, given_category) {
        (true, Some(category)) => format!("{code} {name} under {category}"),
        _ => format!("{code} {name}"),
    };
    if denied.iter().any(|k| k == kind) {
        return Err(AppError::Validation(format!(
            "{rule_subject} does not take a {kind} posting: that path is held pending a policy. \
             The account is otherwise usable — this refusal is about the document, not the account."
        )));
    }
    if !allowed.is_empty() && !allowed.iter().any(|k| k == kind) {
        let mut spelled: Vec<&str> = allowed.iter().map(String::as_str).collect();
        spelled.sort_unstable();
        return Err(AppError::Validation(format!(
            "{rule_subject} does not take a {kind} posting; it is reached by {}.",
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
    let bank_by_map: Vec<bool> = row.try_get("bank_by_map")?;
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

    let all_live: Vec<usize> = (0..bank_ids.len())
        .filter(|at| bank_states[*at] == "ACTIVE")
        .collect();
    // Narrowed to what the map already said, when the map said anything.
    //
    // This is the arm that keeps the estate posting after fourteen accounts
    // landed on `1102`. Before 0291 a bank leg reached an account only one real
    // account was registered against, so `[only]` below answered every time;
    // now `1102` has fourteen and `[only]` never fires, which refused every
    // payment, every giro and every deposit in the client's estate — not
    // because anything was ambiguous, but because the sentence that used to be
    // in the account code moved to the map row and nothing read it there.
    //
    // A narrowing that finds nothing is left alone rather than refused: the map
    // may name a bank whose accounts nobody has described yet, and the arms
    // below already have the right words for that. What it must never do is
    // pick an account at a DIFFERENT bank when one at the named bank exists,
    // which is why the narrowed set wins whenever it has members.
    let narrowed: Vec<usize> = all_live
        .iter()
        .copied()
        .filter(|at| bank_by_map.get(*at).copied().unwrap_or(false))
        .collect();
    let live: Vec<usize> = if narrowed.is_empty() {
        all_live
    } else {
        narrowed
    };
    match live.as_slice() {
        // Nothing registered — or only accounts marked DORMANT, which is the word
        // for "exists, unused" and so is not something to resolve TO.
        //
        // Whether that is a state to refuse depends on whether anybody has SAID
        // this account holds money at a bank. Unmapped, it is not a bank account
        // as far as the estate knows and the line posts as every line did before
        // the master existed — which is what lets a fresh installation migrate and
        // be configured before the client's bank data arrives.
        //
        // Mapped and uncovered is the state this refusal exists for: somebody has
        // declared "our BCA giro money lives here" and nobody has said which
        // account that is. Left alone it is a bank balance that reconciles against
        // nothing, quietly, for as long as nobody looks.
        [] if row.try_get::<bool, _>("is_bank").unwrap_or(false) && !opening => {
            Err(AppError::Validation(format!(
                "banking setup is incomplete: {code} {name} is mapped as money we hold at a bank, \
                 and no bank account of ours is registered against it at {}. Describe the account \
                 under Bank Accounts — its bank, number and holder — and this posts.",
                facts.site_id
            )))
        }
        [] => Ok(None),
        // One candidate. Asking a rule to name the only possible answer would be
        // ceremony, and would have meant touching two dozen posting rules to
        // teach them a fact the chart already knows.
        [only] => Ok(Some(bank_ids[*only])),
        // Two or more, and this is the refusal the whole column exists for: the
        // statement of one BCA account must not be reconciled against a voucher
        // that could have moved the other.
        //
        // The sentence names the act and not the machinery. It used to describe
        // the inference failing — "has 14 accounts, so a posting has to say
        // which one moved" — which reads as a fault in the chart and sends
        // somebody to look at `1102`. Nothing is wrong with `1102`. What is
        // missing is on the document: this entry has to name the bank account,
        // and until a document has somewhere to name one, that is a gap in the
        // document rather than in the entry.
        _ if opening => Ok(None),
        _ => Err(AppError::Validation(format!(
            "name the bank account: {} of our accounts answer to {code} {name} at {}, and this \
             entry does not say which one it moved. Choose one of {}.",
            live.len(),
            facts.site_id,
            live.iter()
                .map(|at| bank_labels[*at].as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// An account and the category the map chose with it.
///
/// Two halves of one answer, and they travel together on purpose. With forty
/// accounts the code alone no longer says what a line is about — `6301` is
/// every general and administrative expense the company has — and a caller that
/// resolved the code and looked the category up separately would be a second
/// place for the pair to be decided, free to disagree with the first.
///
/// `category_code` is `None` on the accounts that declare no family, which is
/// not the same as "not filled in": the trigger in 0288 refuses a line that
/// carries a category into such an account as firmly as it refuses one that
/// omits it from an account that wants one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    pub account_code: String,
    pub category_code: Option<String>,
}

/// Resolve a role to an account and its category, refusing rather than
/// guessing — from the company's defaults, with `source_id` the bank, pay class
/// or asset class the rule narrows by.
pub async fn resolve_account(
    executor: impl sqlx::PgExecutor<'_>,
    role: &str,
    site_id: &str,
    source_id: &str,
) -> Result<Resolved, AppError> {
    resolve_account_from(executor, role, site_id, "COMPANY", source_id).await
}

/// The account a role resolves to from one source at one site, if any link
/// answers. Reads `account_resolution`, where the most specific scope has
/// already won (0460).
pub async fn resolve_linked(
    executor: impl sqlx::PgExecutor<'_>,
    role: &str,
    site_id: &str,
    source_type: &str,
    source_id: &str,
) -> Result<Option<Resolved>, AppError> {
    let row = sqlx::query(
        "SELECT account_code, category_code FROM account_resolution
          WHERE role = $1 AND site_id = $2 AND source_type = $3 AND source_id = $4",
    )
    .bind(role)
    .bind(site_id)
    .bind(source_type)
    .bind(source_id)
    .fetch_optional(executor)
    .await?;
    Ok(row.map(|row| Resolved {
        account_code: row.get::<String, _>("account_code"),
        category_code: row.get::<Option<String>, _>("category_code"),
    }))
}

/// Resolve a role from a source — the company's defaults or a master record
/// (expense category, pay component, payment method, …) — refusing rather
/// than guessing.
///
/// The refusal names the role, the source and the site, says which scopes
/// were looked at, and lists the records the role IS linked under at that
/// site, because that is exactly what somebody has to go and fill in. An error
/// saying "posting failed" would send them to read code.
pub async fn resolve_account_from(
    executor: impl sqlx::PgExecutor<'_>,
    role: &str,
    site_id: &str,
    source_type: &str,
    source_id: &str,
) -> Result<Resolved, AppError> {
    let rows = sqlx::query(
        "SELECT r.source_id, r.account_code, r.category_code
           FROM account_resolution r
          WHERE r.role = $1 AND r.site_id = $2 AND r.source_type = $3
          ORDER BY r.source_id",
    )
    .bind(role)
    .bind(site_id)
    .bind(source_type)
    .fetch_all(executor)
    .await?;
    if let Some(row) = rows
        .iter()
        .find(|row| row.get::<String, _>("source_id") == source_id)
    {
        return Ok(Resolved {
            account_code: row.get::<String, _>("account_code"),
            category_code: row.get::<Option<String>, _>("category_code"),
        });
    }

    let known: Vec<String> = rows
        .iter()
        .map(|row| row.get::<String, _>("source_id"))
        .filter(|q| !q.is_empty())
        .collect();
    let from = match (source_type, source_id.is_empty()) {
        ("COMPANY", true) => String::new(),
        ("COMPANY", false) => format!(" ({source_id})"),
        (kind, _) => format!(" for {} {source_id}", kind.to_lowercase().replace('_', " ")),
    };
    let hint = if known.is_empty() {
        String::new()
    } else if source_id.is_empty() {
        format!(
            " — it is linked under {}, and this posting named none of them",
            known.join(", ")
        )
    } else {
        format!(" — it is linked under {}", known.join(", "))
    };
    Err(AppError::Validation(format!(
        "no account is linked for '{role}'{from} at {site_id} (looked for a link for \
         {site_id}, for its kind of site, and for every site){hint}; link it on the \
         Account Links screen before posting"
    )))
}

/// Resolve a meaning to an account code only.
///
/// For the twenty-nine callers that are not posting through the map but
/// ASSERTING it: a bill screen checking that `trade_payable` is set before it
/// lets somebody type a bill, a depreciation run checking every class resolves
/// before it writes the first entry, a settlement importer checking an acquirer
/// is known. They want the refusal — which is the whole value of the call — and
/// they have no line to put a category on.
///
/// Deliberately not a `Resolved` those callers would `.account_code` away. The
/// distinction the wrapper draws is worth a name: everything that reaches
/// [`resolve_account`] is about to write a journal line, and everything that
/// reaches this one is not. Grep tells you which is which.
pub async fn resolve_account_code(
    executor: impl sqlx::PgExecutor<'_>,
    semantic_key: &str,
    site_id: &str,
    qualifier: &str,
) -> Result<String, AppError> {
    resolve_account(executor, semantic_key, site_id, qualifier)
        .await
        .map(|resolved| resolved.account_code)
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

// ---------------------------------------------------------------------------
// Ledger health (0307): every answer the books compute about themselves,
// composed in one view and served as one list.
// ---------------------------------------------------------------------------

/// One unhealthy thing, as the health screen lists it.
#[derive(Debug, Serialize, sqlx::FromRow)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LedgerHealthRow {
    pub check_kind: String,
    pub subject: String,
    pub subject_scope: String,
    pub detail: String,
    pub unhealthy: bool,
    pub checked_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn ledger_health(pool: &PgPool) -> Result<Vec<LedgerHealthRow>, AppError> {
    let rows = sqlx::query_as(
        "SELECT check_kind, subject, subject_scope, detail, unhealthy, checked_at
           FROM ledger_health
          ORDER BY checked_at DESC, check_kind, subject",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
