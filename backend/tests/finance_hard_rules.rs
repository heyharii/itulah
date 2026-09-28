//! The Finance hard rules as tests (owner decisions, 25 Sep 2026).
//!
//! These are the acceptance scenarios from the owner's brief: not "the code
//! says it", but the journal each rule produces, and the ones it refuses.
//! Every test runs against the migration chain alone, so the deliverable is the
//! migration and the poster, not a fixture.
//!
//!   1  a store cash sale stays in the shop (no inter-unit line)
//!   2  a store remits its takings to a head-office bank in two affiliate
//!      halves: store Dr 2028 / Cr 1002, head office Dr bank / Cr 1057
//!   3  head office tops up a shop's petty cash through 1057/2028
//!   4  head office pays a shop's electricity: shop Dr expense / Cr 2028,
//!      head office Dr 1057 / Cr bank, and NO supplier payable at the shop
//!   5  goods sent to a shop cross on Atas Barang (1058/2029), never 1057/2028
//!   6  Modal Kasir (1004) cannot pay an expense — HARD REJECT
//!   7  a supplier payable (2002/2004) cannot sit at a shop — HARD REJECT
//!   8  salary, THR, medical and BPJS have four separate homes
//!   9  stock loss and damage have a route to 8007 / 6011
//!  10  closing a period does not post profit to retained earnings
//!  11  a unit may hold outstanding giro for its own bank account (0380)
//!  12  a unit's giro paying a head-office supplier crosses on Pembiayaan and
//!      never puts 2002/2004 at the unit
//!  13  Lain-lain is 2030 at the unit and 1059 at head office, both ways (0380)
//!  14  1110 Disposed Inventory takes a Finance HO journal and nothing
//!      automatic (0380)
//!  15  across every kind of crossing, a unit line is only ever on a hutang
//!      account (2028/2029/2030) and a head-office line only on a piutang
//!      account (1057/1058/1059) (owner, 25 Sep; 0380)
//!  16  Finance HO posts Prive (3004) straight onto a store's books; no
//!      automatic document may (0380)

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, PostingIntent, PostingLine};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const STORE: &str = "store-01";
const HO: &str = "ho";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

fn intent(kind: &str, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: day(),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "finance_hard_rules/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{kind} hard-rule test")),
        lines,
    }
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn bank_account(pool: &PgPool, ledger: &str, site: &str, bank: &str, number: &str) {
    cloud::describe_account(
        pool,
        &cloud::DescribeBankAccountRequest {
            ledger_account_code: ledger.into(),
            unit_id: site.into(),
            bank_code: Some(bank.into()),
            bank_name: String::new(),
            account_no: number.into(),
            account_holder: "PT Contoh".into(),
            branch: None,
            kind: "GIRO".into(),
            is_primary: Some(true),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bank account {ledger}: {error}"));
}

async fn try_post(pool: &PgPool, kind: &str, lines: Vec<PostingLine>) -> Result<Uuid, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    match cloud::post(&mut tx, &intent(kind, lines), None, ACTOR).await {
        Ok(posted) => {
            tx.commit().await.map_err(|e| e.to_string())?;
            Ok(posted.entry_id)
        }
        Err(error) => Err(error.to_string()),
    }
}

/// (site, account_code, debit_minor, credit_minor) per line, in line order.
async fn lines_of(pool: &PgPool, entry: Uuid) -> Vec<(String, String, i64, i64)> {
    sqlx::query(
        "SELECT unit_id, account_code, debit_minor, credit_minor
           FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"))
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("unit_id"),
            row.get::<String, _>("account_code"),
            row.get::<i64, _>("debit_minor"),
            row.get::<i64, _>("credit_minor"),
        )
    })
    .collect()
}

async fn accounts_of(pool: &PgPool, entry: Uuid) -> Vec<String> {
    lines_of(pool, entry)
        .await
        .into_iter()
        .map(|(_, account, _, _)| account)
        .collect()
}

fn is_affiliate(account: &str) -> bool {
    matches!(account, "1057" | "1058" | "1059" | "2028" | "2029" | "2030")
}

async fn mapped(pool: &PgPool, key: &str, qualifier: &str) -> String {
    sqlx::query_scalar(
        // No source_type filter: a decision may come from a master record (a
        // claim type, an expense category), not only the company default.
        "SELECT account_code FROM account_resolution
          WHERE role = $1 AND unit_id = $2 AND source_id = $3",
    )
    .bind(key)
    .bind(STORE)
    .bind(qualifier)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("{key}({qualifier}): {error}"))
}

// 1 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_cash_sale_stays_in_the_shop(pool: PgPool) {
    open_september(&pool).await;
    let entry = try_post(
        &pool,
        "SALE_DAY",
        vec![
            PostingLine::debit("cash", STORE, 100_000),
            PostingLine::credit("revenue_cash", STORE, 100_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("cash sale must post: {error}"));

    let accounts = accounts_of(&pool, entry).await;
    assert_eq!(accounts, vec!["1002", "4002"], "store Dr 1002 / Cr 4002");
    assert!(
        !accounts.iter().any(|a| is_affiliate(a)),
        "a sale inside one site creates no inter-unit balance: {accounts:?}"
    );
}

// 2 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_remittance_is_two_affiliate_halves(pool: PgPool) {
    open_september(&pool).await;

    // The bag leaves the shop: Dr 2028 / Cr 1002, the shop's books balanced.
    // The writer names `affiliate_receivable`; at a unit it resolves to the
    // hutang account (owner, 25 Sep): the shop's debt to HO goes down.
    let out = try_post(
        &pool,
        "STORE_DEPOSIT",
        vec![
            PostingLine::debit("affiliate_receivable", STORE, 100_000)
                .with_qualifier("PEMBIAYAAN")
                .with_counter_unit(HO),
            PostingLine::credit("cash", STORE, 100_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("hand over must post: {error}"));
    assert_eq!(
        accounts_of(&pool, out).await,
        vec!["2028", "1002"],
        "shop: Dr 2028 Hutang Affiliasi Pembiayaan / Cr 1002 Cash on Hand"
    );

    // The bank agrees: Dr bank / Cr 1057, head office's books balanced.
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;
    let inn = try_post(
        &pool,
        "STORE_DEPOSIT",
        vec![
            PostingLine::debit("bank_giro", HO, 100_000).with_qualifier("BCA"),
            PostingLine::credit("affiliate_payable", HO, 100_000)
                .with_qualifier("PEMBIAYAAN")
                .with_counter_unit(STORE),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("confirm must post: {error}"));
    assert_eq!(
        accounts_of(&pool, inn).await,
        vec!["1005", "1057"],
        "head office: Dr Bank / Cr 1057 Piutang Affiliasi Pembiayaan"
    );
}

// 3 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn head_office_tops_up_a_shops_petty_cash(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;

    let entry = try_post(
        &pool,
        "PAYMENT",
        vec![
            PostingLine::debit("petty_cash", STORE, 50_000),
            PostingLine::credit("bank_giro", HO, 50_000).with_qualifier("BCA"),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("top-up must post: {error}"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(STORE.into(), "1003".into(), 50_000, 0)),
        "shop Dr 1003 Petty Cash: {lines:?}"
    );
    assert!(
        lines.contains(&(STORE.into(), "2028".into(), 0, 50_000)),
        "shop Cr 2028: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1057".into(), 50_000, 0)),
        "head office Dr 1057: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1005".into(), 0, 50_000)),
        "head office Cr bank: {lines:?}"
    );
}

// 4 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn head_office_pays_a_shops_electricity(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;

    let entry = try_post(
        &pool,
        "SUPPLIER_INVOICE",
        vec![
            PostingLine::debit("electricity_expense", STORE, 200_000),
            PostingLine::credit("bank_giro", HO, 200_000).with_qualifier("BCA"),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("paying a shop's bill must post: {error}"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(STORE.into(), "6045".into(), 200_000, 0)),
        "shop Dr Biaya Listrik: {lines:?}"
    );
    assert!(
        lines.contains(&(STORE.into(), "2028".into(), 0, 200_000)),
        "shop Cr 2028; the shop never owes PLN: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1057".into(), 200_000, 0)),
        "head office Dr 1057: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1005".into(), 0, 200_000)),
        "head office Cr bank: {lines:?}"
    );
    assert!(
        !lines
            .iter()
            .any(|(site, account, _, _)| site == STORE
                && matches!(account.as_str(), "2002" | "2004")),
        "no supplier payable at the shop: {lines:?}"
    );
}

// 5 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn goods_sent_to_a_shop_cross_on_atas_barang(pool: PgPool) {
    open_september(&pool).await;

    let entry = try_post(
        &pool,
        "TRANSFER",
        vec![
            PostingLine::debit("inventory", STORE, 300_000),
            PostingLine::credit("inventory", HO, 300_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("a transfer must post: {error}"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(STORE.into(), "2029".into(), 0, 300_000)),
        "shop Cr 2029 Hutang Affiliasi Atas Barang: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1058".into(), 300_000, 0)),
        "head office Dr 1058 Piutang Affiliasi Atas Barang: {lines:?}"
    );
    assert!(
        !lines
            .iter()
            .any(|(_, account, _, _)| matches!(account.as_str(), "1057" | "2028")),
        "goods never cross on Pembiayaan: {lines:?}"
    );
}

// 6 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn modal_kasir_cannot_pay_an_expense(pool: PgPool) {
    open_september(&pool).await;
    let error = try_post(
        &pool,
        "STORE_EXPENSE",
        vec![
            PostingLine::debit("electricity_expense", STORE, 5_000),
            PostingLine::credit("cashier_float", STORE, 5_000),
        ],
    )
    .await
    .expect_err("Modal Kasir must not pay for anything");

    assert!(
        error.contains("1004"),
        "the refusal names Modal Kasir: {error}"
    );
}

// 7 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supplier_payable_cannot_sit_at_a_shop(pool: PgPool) {
    open_september(&pool).await;

    for key in ["trade_payable", "non_merchandise_payable"] {
        let error = try_post(
            &pool,
            "SUPPLIER_INVOICE",
            vec![
                PostingLine::debit("electricity_expense", STORE, 5_000),
                PostingLine::credit(key, STORE, 5_000).for_supplier("sup-1"),
            ],
        )
        .await
        .err()
        .unwrap_or_else(|| panic!("{key} at a shop must be refused"));

        assert!(
            error.contains("2002") || error.contains("2004"),
            "{key} refusal names the account: {error}"
        );
    }
}

// 8 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn payroll_components_have_four_separate_homes(pool: PgPool) {
    open_september(&pool).await;

    let salary = mapped(&pool, "payroll_payable", "").await;
    let thr = mapped(&pool, "thr_payable", "").await;
    let medical = mapped(&pool, "employee_claim_payable", "MEDICAL").await;
    let bpjs = mapped(&pool, "bpjs_payable", "").await;

    assert_eq!(salary, "2017", "salary payable");
    assert_eq!(thr, "2018", "THR / bonus / severance payable");
    assert_eq!(medical, "2020", "medical payable");
    assert_eq!(
        bpjs, "2021",
        "BPJS payable — its own meaning, not folded into 2017"
    );

    let mut homes = vec![salary, thr, medical, bpjs];
    homes.sort();
    homes.dedup();
    assert_eq!(homes.len(), 4, "four components, four accounts");
}

// 9 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn stock_loss_and_damage_have_a_route(pool: PgPool) {
    open_september(&pool).await;
    assert_eq!(mapped(&pool, "stock_loss", "").await, "8007", "opname loss");
    assert_eq!(
        mapped(&pool, "inventory_damage", "").await,
        "6011",
        "damage / write-off"
    );
}

// 10 ------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn closing_a_period_leaves_profit_derived(pool: PgPool) {
    open_september(&pool).await;
    cloud::close_period(&pool, 2026, 9, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("close: {error}"));

    let posting_to_retained: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_line WHERE account_code = '3003'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(
        posting_to_retained, 0,
        "closing a period seals and validates; it never posts current profit to retained earnings (that is derived)"
    );

    // And a period that is closed takes no new posting.
    let after_close = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit("cash", STORE, 1_000),
            PostingLine::credit("revenue_cash", STORE, 1_000),
        ],
    )
    .await;
    assert!(after_close.is_err(), "a closed period refuses new postings");
}

// 11 ------------------------------------------------------------------------

/// Owner decision B (0380): a giro follows the bank account it is drawn on.
/// A store with its own BCA giro account holds the outstanding giro for it,
/// and clearing moves the store's own bank, never head office's.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_unit_may_hold_outstanding_giro_for_its_own_bank_account(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", STORE, "BCA", "8880054321").await;

    // Issued at the store: the store's own expense, its own outstanding giro.
    let issued = try_post(
        &pool,
        "STORE_EXPENSE",
        vec![
            PostingLine::debit("electricity_expense", STORE, 75_000),
            PostingLine::credit("giro_outstanding", STORE, 75_000).with_qualifier("BCA"),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("a store's own giro must post: {error}"));
    assert_eq!(
        lines_of(&pool, issued).await,
        vec![
            (STORE.into(), "6045".into(), 75_000, 0),
            (STORE.into(), "2005".into(), 0, 75_000),
        ],
        "store Dr expense / Cr 2005 Outstanding Giro BCA, no inter-unit line"
    );

    // Cleared at the store: Dr 2005 / Cr 1005, both in the store's books.
    let cleared = try_post(
        &pool,
        "GIRO",
        vec![
            PostingLine::debit("giro_outstanding", STORE, 75_000).with_qualifier("BCA"),
            PostingLine::credit("bank_giro", STORE, 75_000).with_qualifier("BCA"),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("clearing a store's giro must post: {error}"));
    assert_eq!(
        lines_of(&pool, cleared).await,
        vec![
            (STORE.into(), "2005".into(), 75_000, 0),
            (STORE.into(), "1005".into(), 0, 75_000),
        ],
        "store Dr 2005 / Cr 1005 Cash in Bank Giro BCA"
    );

    let registered: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM external_party_account
          WHERE account_code IN ('2005','2006','2007','2008','2009')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("registry: {error}"));
    assert_eq!(registered, 0, "outstanding giro is not head office's alone");
}

// 12 ------------------------------------------------------------------------

/// Owner decision B: a unit's giro paying a supplier whose payable is at head
/// office. The real path — a bill recorded at HO, a GIRO payment recorded at
/// the store, posted — so the balancer is the thing under test, not a
/// hand-built entry. The store never holds 2002/2004; the crossing is on the
/// Pembiayaan pair (1057/2028) with head office as the counterparty.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_unit_giro_paying_a_head_office_supplier_crosses_on_pembiayaan(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", STORE, "BCA", "8880054321").await;

    let bill = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-GIRO-01".into(),
            supplier_id: "SUP-GIRO".into(),
            supplier_name: Some("PT Kain Jaya".into()),
            site_id: HO.into(),
            invoice_date: day(),
            due_date: Some(day()),
            subtotal_minor: 400_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: Some("MERCHANDISE".into()),
            lines: None,
            receipt_ids: None,
            matching: None,
            withholding_code: None,
            submitted_by_domain: None,
            document_ref: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("bill at head office: {error}"));

    let recorded = cloud::record_payment(
        &pool,
        &cloud::RecordPaymentRequest {
            unit_id: STORE.into(),
            payment_date: day(),
            method: "GIRO".into(),
            account_key: "bank_giro".into(),
            account_qualifier: "BCA".into(),
            total_minor: Some(400_000),
            reference: None,
            note: None,
            allocations: vec![cloud::AllocateToBill {
                invoice_id: bill.invoice_id,
                amount_minor: 400_000,
            }],
            giro_number: Some("BCA-778899".into()),
            giro_due_date: NaiveDate::from_ymd_opt(2026, 10, 15),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("a store giro payment must record: {error}"));
    let posted = cloud::post_payment(&pool, recorded.payment_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("a store giro payment must post: {error}"));
    let entry = posted
        .journal_entry_id
        .unwrap_or_else(|| panic!("a posted payment has an entry"));

    let lines = lines_of(&pool, entry).await;
    assert!(
        lines.contains(&(HO.into(), "2002".into(), 400_000, 0)),
        "head office Dr 2002: the supplier's payable is cleared where it lives: {lines:?}"
    );
    assert!(
        lines.contains(&(STORE.into(), "2005".into(), 0, 400_000)),
        "store Cr 2005 Outstanding Giro BCA: {lines:?}"
    );
    assert!(
        !lines
            .iter()
            .any(|(site, account, _, _)| site == STORE
                && matches!(account.as_str(), "2002" | "2004")),
        "no supplier payable at the store: {lines:?}"
    );
    assert!(
        !lines.iter().any(|(_, account, _, _)| matches!(
            account.as_str(),
            "1058" | "2029" | "1059" | "2030"
        )),
        "money crosses on Pembiayaan, not Atas Barang or Lain-lain: {lines:?}"
    );
    // Owner, 25 Sep: the unit side is always hutang, head office's always
    // piutang. The store paid head office's supplier, so its debt to HO goes
    // down (Dr 2028) and HO's claim on it goes down (Cr 1057).
    assert!(
        lines.contains(&(STORE.into(), "2028".into(), 400_000, 0)),
        "store Dr 2028 Hutang Affiliasi Pembiayaan (counter dc): {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1057".into(), 0, 400_000)),
        "head office Cr 1057 Piutang Affiliasi Pembiayaan (counter store): {lines:?}"
    );
    assert_eq!(lines.len(), 4, "four lines, nothing else: {lines:?}");

    let counters: Vec<(String, String, Option<String>)> = sqlx::query(
        "SELECT unit_id, account_code, counter_unit_id FROM journal_line
          WHERE entry_id = $1 AND account_code IN ('1057','2028') ORDER BY line_number",
    )
    .bind(entry)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("counters: {error}"))
    .into_iter()
    .map(|row| {
        (
            row.get("unit_id"),
            row.get("account_code"),
            row.get("counter_unit_id"),
        )
    })
    .collect();
    for (site, account, counter) in &counters {
        let expected = if site == HO { STORE } else { HO };
        assert_eq!(
            counter.as_deref(),
            Some(expected),
            "{account} at {site} names the other side: {counters:?}"
        );
    }
}

// 13 ------------------------------------------------------------------------

/// Owner decision C (0380): the Lain-lain family is 1059 Piutang Affiliasi
/// Lain-lain at head office and 2030 Hutang Lain-lain Principal at the unit,
/// whichever way value moves; a unit balance may go negative.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn lain_lain_is_2030_at_the_unit_and_1059_at_head_office(pool: PgPool) {
    open_september(&pool).await;

    // Head office charges the unit: the unit owes more.
    let fee = try_post(
        &pool,
        "MANAGEMENT_FEE",
        vec![
            PostingLine::debit("management_fee_expense", STORE, 120_000),
            PostingLine::credit("management_fee_income", HO, 120_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("management fee must post: {error}"));
    let lines = lines_of(&pool, fee).await;
    assert!(
        lines.contains(&(STORE.into(), "2030".into(), 0, 120_000)),
        "unit Cr 2030 Hutang Lain-lain Principal: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1059".into(), 120_000, 0)),
        "head office Dr 1059 Piutang Affiliasi Lain-lain: {lines:?}"
    );

    // Value moves the other way (an asset moved unit -> HO): still 2030 at the
    // unit, now a debit, and still 1059 at head office, now a credit.
    let back = try_post(
        &pool,
        "ASSET_TRANSFER",
        vec![
            PostingLine::debit("work_in_progress", HO, 90_000),
            PostingLine::credit("work_in_progress", STORE, 90_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("asset transfer must post: {error}"));
    let lines = lines_of(&pool, back).await;
    assert!(
        lines.contains(&(STORE.into(), "2030".into(), 90_000, 0)),
        "unit Dr 2030: {lines:?}"
    );
    assert!(
        lines.contains(&(HO.into(), "1059".into(), 0, 90_000)),
        "head office Cr 1059: {lines:?}"
    );

    let misplaced: Vec<(String, String, Option<String>)> = sqlx::query(
        "SELECT unit_id, account_code, counter_unit_id FROM journal_line
          WHERE account_code IN ('1059', '2030')
            AND (   (account_code = '1059' AND unit_id <> 'ho')
                 OR (account_code = '2030' AND unit_id = 'ho')
                 OR counter_unit_id IS NULL
                 OR (unit_id <> 'ho' AND counter_unit_id <> 'ho'))",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("misplaced: {error}"))
    .into_iter()
    .map(|row| {
        (
            row.get("unit_id"),
            row.get("account_code"),
            row.get("counter_unit_id"),
        )
    })
    .collect();
    assert!(
        misplaced.is_empty(),
        "1059 only at HO, 2030 only at a unit, both naming the other side: {misplaced:?}"
    );

    // And 2030 is no longer head office's alone, nor reachable without a
    // counterparty.
    let refused = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit(
                cloud::LineAccount::Account {
                    account_code: "8008".into(),
                    category_code: None,
                },
                STORE,
                1_000,
            ),
            PostingLine::credit(
                cloud::LineAccount::Account {
                    account_code: "2030".into(),
                    category_code: None,
                },
                STORE,
                1_000,
            ),
        ],
    )
    .await
    .expect_err("2030 without a counterparty must be refused");
    assert!(
        refused.contains("2030"),
        "the refusal names 2030: {refused}"
    );
}

// 14 ------------------------------------------------------------------------

/// 1110 Disposed Inventory reopened for the client's opening balances (0380):
/// a Finance HO hand-keyed journal may reach it, a posting rule may not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn disposed_inventory_takes_a_manual_journal_and_nothing_automatic(pool: PgPool) {
    open_september(&pool).await;
    let code = |account_code: &str| cloud::LineAccount::Account {
        account_code: account_code.into(),
        category_code: None,
    };

    let mapped: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM account_link WHERE account_code = '1110'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("map: {error}"));
    assert_eq!(mapped, 0, "no meaning maps to 1110, so no rule can name it");

    let automatic = try_post(
        &pool,
        "STOCK_COUNT",
        vec![
            PostingLine::debit(code("1110"), STORE, 5_000),
            PostingLine::credit(code("8008"), STORE, 5_000),
        ],
    )
    .await
    .expect_err("an automatic posting to 1110 must be refused");
    assert!(
        automatic.contains("1110"),
        "the refusal names 1110: {automatic}"
    );

    let manual = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit(code("1110"), STORE, 5_000),
            PostingLine::credit(code("8008"), STORE, 5_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("a Finance HO journal on 1110 must post: {error}"));
    assert_eq!(
        accounts_of(&pool, manual).await,
        vec!["1110", "8008"],
        "store Dr 1110 Disposed Inventory"
    );
}

// 15 ------------------------------------------------------------------------

/// Owner decision, 25 Sep (0380): for every affiliate family the unit side is
/// its hutang account and head office's side its piutang account, whichever
/// way value moves. Posted across every kind of crossing, in both directions.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_unit_is_always_on_hutang_and_head_office_on_piutang(pool: PgPool) {
    open_september(&pool).await;
    bank_account(&pool, "1005", HO, "BCA", "8880012345").await;

    let crossings: Vec<(&str, Vec<PostingLine>)> = vec![
        // HO funds the unit (Pembiayaan, unit owes more).
        (
            "PAYMENT",
            vec![
                PostingLine::debit("petty_cash", STORE, 10_000),
                PostingLine::credit("bank_giro", HO, 10_000).with_qualifier("BCA"),
            ],
        ),
        // The unit pays HO's supplier from its till (Pembiayaan, unit owes less).
        (
            "PAYMENT",
            vec![
                PostingLine::debit("trade_payable", HO, 20_000).for_supplier("sup-1"),
                PostingLine::credit("cash", STORE, 20_000),
            ],
        ),
        // Goods HO -> unit, and a return unit -> HO (Atas Barang).
        (
            "TRANSFER",
            vec![
                PostingLine::debit("inventory", STORE, 30_000),
                PostingLine::credit("inventory", HO, 30_000),
            ],
        ),
        (
            "TRANSFER",
            vec![
                PostingLine::debit("inventory", HO, 5_000),
                PostingLine::credit("inventory", STORE, 5_000),
            ],
        ),
        // Unit to unit, routed through HO.
        (
            "TRANSFER",
            vec![
                PostingLine::debit("inventory", "store-02", 7_000),
                PostingLine::credit("inventory", STORE, 7_000),
            ],
        ),
        // Management fee and an asset moved back (Lain-lain, both ways).
        (
            "MANAGEMENT_FEE",
            vec![
                PostingLine::debit("management_fee_expense", STORE, 40_000),
                PostingLine::credit("management_fee_income", HO, 40_000),
            ],
        ),
        (
            "ASSET_TRANSFER",
            vec![
                PostingLine::debit("work_in_progress", HO, 9_000),
                PostingLine::credit("work_in_progress", STORE, 9_000),
            ],
        ),
    ];
    for (kind, lines) in crossings {
        try_post(&pool, kind, lines)
            .await
            .unwrap_or_else(|error| panic!("{kind} crossing must post: {error}"));
    }

    // A store return goes Dr 2029 at the store, Cr 1058 at HO.
    let returned: (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(debit_minor) FILTER (WHERE unit_id = $1 AND account_code = '2029'), 0)::bigint,
                COALESCE(SUM(credit_minor) FILTER (WHERE unit_id = 'ho' AND account_code = '1058'), 0)::bigint
           FROM journal_line",
    )
    .bind(STORE)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("return: {error}"));
    assert_eq!(
        returned,
        (5_000 + 7_000, 5_000 + 7_000),
        "returns: store Dr 2029, HO Cr 1058"
    );

    let wrong_side: Vec<(String, String)> = sqlx::query(
        "SELECT unit_id, account_code FROM journal_line
          WHERE (unit_id <> 'ho' AND account_code IN ('1057', '1058', '1059'))
             OR (unit_id =  'ho' AND account_code IN ('2028', '2029', '2030'))",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("wrong side: {error}"))
    .into_iter()
    .map(|row| (row.get("unit_id"), row.get("account_code")))
    .collect();
    assert!(
        wrong_side.is_empty(),
        "no unit line on 1057/1058/1059 and no HO line on 2028/2029/2030: {wrong_side:?}"
    );

    let unit_to_unit: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_line
          WHERE account_code IN ('1057','1058','1059','2028','2029','2030')
            AND (counter_unit_id IS NULL
                 OR (unit_id <> 'ho' AND counter_unit_id <> 'ho')
                 OR (unit_id = 'ho' AND counter_unit_id = 'ho'))",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("unit to unit: {error}"));
    assert_eq!(
        unit_to_unit, 0,
        "every affiliate line is HO <-> unit and names the other side"
    );

    let company: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint FROM journal_line
          WHERE account_code IN ('1057','1058','1059','2028','2029','2030')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("company: {error}"));
    assert_eq!(
        company, 0,
        "the affiliate accounts net to zero company-wide"
    );
}

// 16 ------------------------------------------------------------------------

/// Owner decision, 25 Sep (0380): Finance HO may post to every account of every
/// store, and the owner taking cash at a store is an HO journal on the store's
/// books: Dr 3004 Prive / Cr 1002. A store has no journal access at all (the
/// HTTP refusal is `finance_api_integration::a_shop_role_cannot_post_a_manual_journal`);
/// here: no automatic document may reach 3004.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn finance_ho_posts_prive_on_a_stores_books(pool: PgPool) {
    open_september(&pool).await;
    let code = |account_code: &str| cloud::LineAccount::Account {
        account_code: account_code.into(),
        category_code: None,
    };

    let drawn = try_post(
        &pool,
        "MANUAL",
        vec![
            PostingLine::debit(code("3004"), STORE, 60_000),
            PostingLine::credit(code("1002"), STORE, 60_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("an HO journal on a store's Prive must post: {error}"));
    assert_eq!(
        lines_of(&pool, drawn).await,
        vec![
            (STORE.into(), "3004".into(), 60_000, 0),
            (STORE.into(), "1002".into(), 0, 60_000),
        ],
        "store Dr 3004 Prive / Cr 1002, no inter-unit line"
    );

    let automatic = try_post(
        &pool,
        "STORE_EXPENSE",
        vec![
            PostingLine::debit("owner_drawings", STORE, 1_000),
            PostingLine::credit("petty_cash", STORE, 1_000),
        ],
    )
    .await
    .expect_err("a store document must not reach Prive");
    assert!(
        automatic.contains("3004"),
        "the refusal names 3004: {automatic}"
    );
}
