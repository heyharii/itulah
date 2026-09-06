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
    pub total_debit_minor: i64,
    pub total_credit_minor: i64,
    /// Sent rather than left for the browser to work out. A trial balance that
    /// does not balance is the single most important thing this screen can
    /// say, and it should not depend on a client-side subtraction.
    pub balanced: bool,
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
pub async fn book_locations(pool: &PgPool) -> Result<Vec<BookLocation>, AppError> {
    let rows = sqlx::query(
        "SELECT s.id AS site_id, s.name, s.kind,
                (SELECT COUNT(*) FROM ledger_account a WHERE a.site_id = s.id)::bigint AS account_count
           FROM site s ORDER BY (s.kind <> 'DC'), s.id",
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
        key(
            "giro_outstanding",
            "Giro issued, not cleared",
            "2012002* Outstanding Giro",
            true,
            "Payables",
        ),
        key(
            "rounding",
            "Rounding difference",
            "8010110002 Selisih pembulatan",
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
        key(
            "card_fee",
            "Card fee (MDR)",
            "6010110002 Biaya Credit Card",
            false,
            "Receivables",
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
        key(
            "voucher_liability",
            "Voucher outstanding",
            "2012305001 Hutang Voucher (proposed; the client's chart has none)",
            false,
            "Sales posting",
        ),
        // end lane-A
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

/// The accounts directly under one heading, or the eight roots when none is
/// named.
///
/// A level at a time rather than the whole chart: 7,528 accounts is about a
/// megabyte of JSON, and a person opening the screen wants eight rows.
pub async fn account_children(
    pool: &PgPool,
    parent: Option<&str>,
    include_inactive: bool,
) -> Result<Vec<LedgerAccount>, AppError> {
    let sql = format!(
        "SELECT {ACCOUNT_COLUMNS} FROM ledger_account a
          WHERE a.parent_code IS NOT DISTINCT FROM $1
            AND ($2 OR a.is_active)
          ORDER BY a.account_code"
    );
    let rows = sqlx::query(&sql)
        .bind(parent)
        .bind(include_inactive)
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_account).collect()
}

/// Find an account by code or by name.
///
/// Both, because both are how people look: finance quotes a code, everybody
/// else quotes a name, and a search that only did one of them would send half
/// its users to the tree to hunt.
pub async fn search_accounts(
    pool: &PgPool,
    query: &str,
    site_id: Option<&str>,
    include_inactive: bool,
    limit: i64,
) -> Result<Vec<LedgerAccount>, AppError> {
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT {ACCOUNT_COLUMNS} FROM ledger_account a
          WHERE ($3::text IS NULL OR a.site_id = $3)
            AND ($4 OR a.is_active)
            AND (a.account_code LIKE $1 || '%' OR a.name ILIKE '%' || $1 || '%')
          ORDER BY (a.account_code LIKE $1 || '%') DESC, a.account_code
          LIMIT $2"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(limit.clamp(1, 500))
        .bind(site_id)
        .bind(include_inactive)
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_account).collect()
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

/// Every account that has been posted to, and what it holds.
///
/// Postable accounts only: a heading would double-count, because its balance is
/// its descendants' and they are already listed.
pub async fn trial_balance(
    pool: &PgPool,
    as_of: NaiveDate,
    site_id: Option<&str>,
) -> Result<TrialBalance, AppError> {
    let rows = sqlx::query(
        "SELECT l.account_code, a.name, a.root_class::text AS root_class, l.site_id,
                SUM(l.debit_minor)::bigint AS debit, SUM(l.credit_minor)::bigint AS credit
           FROM journal_line l
           JOIN journal_entry e USING (entry_id)
           JOIN ledger_account a ON a.account_code = l.account_code
          WHERE e.posting_date <= $1
            AND ($2::text IS NULL OR l.site_id = $2)
          GROUP BY l.account_code, a.name, a.root_class, l.site_id
         HAVING SUM(l.debit_minor) <> 0 OR SUM(l.credit_minor) <> 0
          ORDER BY l.account_code, l.site_id",
    )
    .bind(as_of)
    .bind(site_id)
    .fetch_all(pool)
    .await?;

    let mut total_debit = 0i64;
    let mut total_credit = 0i64;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let debit: i64 = row.try_get("debit")?;
        let credit: i64 = row.try_get("credit")?;
        total_debit += debit;
        total_credit += credit;
        out.push(TrialBalanceRow {
            account_code: row.try_get("account_code")?,
            name: row.try_get("name")?,
            root_class: row.try_get("root_class")?,
            site_id: row.try_get("site_id")?,
            debit_minor: debit,
            credit_minor: credit,
        });
    }
    Ok(TrialBalance {
        as_of,
        site_id: site_id.map(str::to_string),
        rows: out,
        total_debit_minor: total_debit,
        total_credit_minor: total_credit,
        balanced: total_debit == total_credit,
    })
}

// ---------------------------------------------------------------------------
// The account map
// ---------------------------------------------------------------------------

pub async fn account_mappings(
    pool: &PgPool,
    site_id: Option<&str>,
) -> Result<Vec<AccountMapping>, AppError> {
    let rows = sqlx::query(
        "SELECT m.semantic_key, m.site_id, m.qualifier, m.account_code,
                a.name AS account_name, m.set_by, m.set_at, m.note
           FROM account_map m JOIN ledger_account a ON a.account_code = m.account_code
          WHERE ($1::text IS NULL OR m.site_id = $1)
          ORDER BY m.semantic_key, m.site_id, m.qualifier",
    )
    .bind(site_id)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
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
        })
        .collect()
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

    account_mappings(pool, Some(&request.site_id))
        .await?
        .into_iter()
        .find(|m| m.semantic_key == key && m.qualifier == request.qualifier.trim())
        .ok_or_else(|| AppError::NotFound("account mapping".into()))
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

pub async fn fiscal_periods(pool: &PgPool) -> Result<Vec<FiscalPeriod>, AppError> {
    let rows = sqlx::query(
        "SELECT p.year::int AS year, p.month::int AS month, p.status, p.closed_by, p.closed_at,
                (SELECT COUNT(*) FROM journal_entry e
                  WHERE EXTRACT(YEAR FROM e.posting_date) = p.year
                    AND EXTRACT(MONTH FROM e.posting_date) = p.month)::bigint AS entry_count
           FROM fiscal_period p ORDER BY p.year DESC, p.month DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(FiscalPeriod {
                year: row.try_get("year")?,
                month: row.try_get("month")?,
                status: row.try_get("status")?,
                closed_by: row.try_get("closed_by")?,
                closed_at: row.try_get("closed_at")?,
                entry_count: row.try_get("entry_count")?,
            })
        })
        .collect()
}

pub async fn open_period(pool: &PgPool, year: i32, month: i32) -> Result<(), AppError> {
    sqlx::query("INSERT INTO fiscal_period (year, month) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(year as i16)
        .bind(month as i16)
        .execute(pool)
        .await?;
    Ok(())
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
