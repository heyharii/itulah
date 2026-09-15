//! Store money: what has to be true about a shop's cash.
//!
//! Twelve tests, and each of them is a rule somebody could otherwise argue
//! about at the counter.
//!
//! The heaviest is the fund equation. `sent = settled + direct expenses +
//! returned + outstanding` is checked three ways over — the funds table, the
//! Payment Ledger, and the general ledger balance of `1011102002 PIUTANG KEPALA
//! TOKO` — because a system where two of those agree and nobody ever asks the
//! third is a system that has a wrong number in it and does not know.
//!
//! The Payment Ledger is lane P's and is not merged into this branch. The shim
//! it stands in for is written and read through functions whose arguments
//! already match `ple_open` and `ple_settle`, so these assertions survive the
//! swap unchanged. See `TODO(lane-P)` in `postgres/store_money.rs`.

use inventory_backend::cloud::domain::{
    cashier_equation, remittance_standing, DrawerMovement, ExecutionState, LineExecution,
    LineProgress, RemittanceProgress, STORE_EXPENSE_MANAGER_LIMIT_MINOR,
};
use inventory_backend::cloud::postgres as cloud;
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "hari";
const OTHER: &str = "rina";
const SHOP: &str = "store-07";
const BANK: &str = "BCA-9001";

// ---------------------------------------------------------------------------
// A chart the size of what this lane touches
// ---------------------------------------------------------------------------

/// The headings and postable leaves these tests post to.
///
/// Real codes from the client's export wherever the client has one. The two
/// PROPOSED accounts — `1011005001` cash in transit and `8010110008` the
/// drawer's difference — are here in the shape the seed creates them, so the
/// tests exercise exactly what production will have rather than a stand-in.
async fn chart(pool: &PgPool) {
    let headings: &[(&str, &str, Option<&str>)] = &[
        ("1", "ASSETS", None),
        ("101", "AKTIVA LANCAR", Some("1")),
        ("10110", "KAS & SETARA KAS", Some("101")),
        ("1011001", "CASH ON HAND", Some("10110")),
        ("1011002", "CASH IN BANK GIRO", Some("10110")),
        // PROPOSED: the next free rung, after TIME DEPOSIT.
        ("1011005", "KAS DALAM PERJALANAN", Some("10110")),
        ("10111", "PIUTANG USAHA", Some("101")),
        ("1011102", "PIUTANG LAIN-LAIN", Some("10111")),
        // What the two units owe each other, asset side. A shop banking its
        // takings and a shop paying head office's supplier both move money
        // across the boundary, so the balancer books the pair of affiliate legs
        // that leaves each set of books balanced on its own.
        ("102", "AKTIVA TIDAK LANCAR", None),
        ("10214", "PIUTANG  AFFILIASI ANTAR UNIT", Some("102")),
        ("1021401", "PIUTANG  AFFILIASI PEMBIAYAAN", Some("10214")),
        ("1021402", "PIUTANG  AFFILIASI ATAS BARANG", Some("10214")),
        ("2", "LIABILITIES", None),
        ("201", "HUTANG JANGKA PENDEK", Some("2")),
        ("20120", "HUTANG DAGANG", Some("201")),
        ("2012001", "HUTANG SUPPLIER", Some("20120")),
        // And the liability side of the same pair, at the shop.
        ("20123", "HUTANG LAIN-LAIN", Some("201")),
        ("2012301", "HUTANG AFFILIASI PEMBIAYAAN", Some("20123")),
        ("2012302", "HUTANG AFFILIASI ATAS BARANG", Some("20123")),
        ("20122", "BIAYA YANG MASIH HARUS DIBAYAR", Some("201")),
        ("2012201", "BIAYA YMHD", Some("20122")),
        ("6", "BIAYA OPERASIONAL", None),
        ("601", "BIAYA UMUM DAN ADMINISTRASI", Some("6")),
        ("60103", "BIAYA KANTOR", Some("601")),
        ("6010310", "BIAYA KANTOR", Some("60103")),
        ("8", "BEBAN NON OPERASIONAL", None),
        ("801", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("8")),
        ("80101", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("801")),
        ("8010110", "Pendapatan (Biaya) Lain-lain", Some("80101")),
    ];
    // The ten-digit rungs, still headings.
    let rungs: &[(&str, &str, &str)] = &[
        ("1011001001", "CASH ON HAND", "1011001"),
        ("1011001002", "PETTY CASH", "1011001"),
        ("1011001003", "MODAL KASIR", "1011001"),
        ("1011002001", "CASH IN BANK GIRO", "1011002"),
        ("1011005001", "KAS DALAM PERJALANAN", "1011005"),
        ("1011102002", "PIUTANG KEPALA TOKO", "1011102"),
        ("2012001001", "Hutang Suppliers Barang Dagangan", "2012001"),
        ("2012201001", "Biaya Gaji dan Upah YMHD", "2012201"),
        ("6010310006", "Biaya Pemakaian Listrik", "6010310"),
        ("8010110008", "Selisih Kas", "8010110"),
    ];
    // The postable twelve-digit leaves, per location. `07` is store-07's
    // suffix in the client's numbering; `00` is head office.
    let leaves: &[(&str, &str, &str, &str)] = &[
        ("101100100107", "Cash on Hand C007", "1011001001", SHOP),
        ("101100100207", "Petty Cash C007", "1011001002", SHOP),
        ("101100100307", "Modal Kasir C007", "1011001003", SHOP),
        (
            "101100500107",
            "Kas Dalam Perjalanan C007",
            "1011005001",
            SHOP,
        ),
        (
            "101110200207",
            "Piutang Kepala Toko C007",
            "1011102002",
            SHOP,
        ),
        (
            "201220100107",
            "Biaya Gaji dan Upah YMHD C007",
            "2012201001",
            SHOP,
        ),
        (
            "601031000607",
            "Biaya Pemakaian Listrik C007",
            "6010310006",
            SHOP,
        ),
        ("801011000807", "Selisih Kas C007", "8010110008", SHOP),
        (
            "102140100207",
            "Piutang Affiliasi Pembiayaan C007 - HO",
            "1021401",
            "dc",
        ),
        (
            "201230100107",
            "Hutang Affiliasi Pembiayaan HEAD OFFICE - C007",
            "2012301",
            SHOP,
        ),
        (
            "102140200207",
            "Piutang Affiliasi Atas Barang C007 - HO",
            "1021402",
            "dc",
        ),
        (
            "201230200107",
            "Hutang Affiliasi Atas Barang HEAD OFFICE - C007",
            "2012302",
            SHOP,
        ),
        ("101100200100", "Cash In Bank Giro HO", "1011002001", "dc"),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            "2012001001",
            "dc",
        ),
    ];

    for (code, name, parent) in headings {
        insert_account(pool, code, name, *parent, true, None).await;
    }
    for (code, name, parent) in rungs {
        insert_account(pool, code, name, Some(parent), true, None).await;
    }
    for (code, name, parent, site) in leaves {
        insert_account(pool, code, name, Some(parent), false, Some(site)).await;
    }

    for (key, code, site, qualifier) in [
        ("cash", "101100100107", SHOP, ""),
        ("petty_cash", "101100100207", SHOP, ""),
        ("cashier_float", "101100100307", SHOP, ""),
        ("cash_in_transit", "101100500107", SHOP, ""),
        ("store_manager_receivable", "101110200207", SHOP, ""),
        ("payroll_payable", "201220100107", SHOP, ""),
        ("expense_electricity", "601031000607", SHOP, ""),
        ("cash_variance", "801011000807", SHOP, ""),
        ("bank_giro", "101100200100", "dc", BANK),
        ("trade_payable", "201200100100", "dc", ""),
        // Qualified by the unit on the other side, which is how one account per
        // pair stays separate from one account per counterparty. BARANG rather
        // than PEMBIAYAAN because a shop's banking answers what it owes for
        // stock — the balancer's own reading of STORE_DEPOSIT and REMITTANCE.
        // Two families, because the balancer picks one from the source kind:
        // BARANG for a shop's banking and its remittances — money that answers
        // what it owes for stock — and PEMBIAYAAN for everything else, which is
        // the column head office reconciles by hand.
        (
            "affiliate_receivable",
            "102140200207",
            "dc",
            "BARANG:store-07",
        ),
        ("affiliate_payable", "201230200107", SHOP, "BARANG:dc"),
        (
            "affiliate_receivable",
            "102140100207",
            "dc",
            "PEMBIAYAAN:store-07",
        ),
        ("affiliate_payable", "201230100107", SHOP, "PEMBIAYAAN:dc"),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: site.into(),
                qualifier: qualifier.into(),
                account_code: code.into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key} at {site}: {error}"));
    }

    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn insert_account(
    pool: &PgPool,
    code: &str,
    name: &str,
    parent: Option<&str>,
    is_group: bool,
    site: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    )
    .bind(code)
    .bind(name)
    .bind(parent)
    .bind(is_group)
    .bind(site)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("{code}: {error}"));
}

/// Somebody who can hold money. Written straight in, because employment is a
/// neighbouring module with its own tests and a full hire here would test that
/// one instead of this one.
async fn person(pool: &PgPool, id: &str, code: &str) -> String {
    sqlx::query(
        "INSERT INTO employee (id, code, status) VALUES ($1,$2,'ACTIVE')
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(id)
    .bind(code)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("employee {id}: {error}"));
    id.to_owned()
}

fn date(day: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad day {day}"))
}

/// Every entry the books hold balances, and the balance of one account.
async fn account_balance(pool: &PgPool, code: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"))
}

async fn entries_for(pool: &PgPool, source_kind: &str, source_id: &str) -> Vec<(String, i64)> {
    sqlx::query(
        "SELECT e.entry_number, e.total_minor FROM journal_entry e
          WHERE e.source_kind = $1 AND e.source_id = $2
          ORDER BY e.entry_number",
    )
    .bind(source_kind)
    .bind(source_id)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("entries: {error}"))
    .iter()
    .map(|row| {
        (
            row.get::<String, _>("entry_number"),
            row.get::<i64, _>("total_minor"),
        )
    })
    .collect()
}

async fn every_entry_balances(pool: &PgPool) {
    let unbalanced: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
             SELECT entry_id FROM journal_line
              GROUP BY entry_id
             HAVING SUM(debit_minor) <> SUM(credit_minor)) x",
    )
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance check: {error}"));
    assert_eq!(unbalanced, 0, "some entry does not balance");
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

/// Opening float + cash sales + authorised movements = expected closing cash.
///
/// Computed at the centre from the synced facts, not copied from the shop, so
/// the two figures can be compared rather than merged.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_cashier_equation_holds(pool: PgPool) {
    chart(&pool).await;

    let shift_id = Uuid::new_v4();
    let opened_at = chrono::DateTime::parse_from_rfc3339("2026-09-07T02:00:00Z")
        .unwrap_or_else(|error| panic!("time: {error}"))
        .with_timezone(&chrono::Utc);
    let closed_at = opened_at + chrono::Duration::hours(10);

    // A day at the counter, as the shop recorded it: a float, three cash
    // baskets and one card, a drop to the safe, and a payout nobody signed.
    let sale_ids: Vec<Uuid> = (0..4).map(|_| Uuid::new_v4()).collect();
    for (index, sale_id) in sale_ids.iter().enumerate() {
        sqlx::query(
            "INSERT INTO edge_sale
                 (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
                  occurred_at, currency, total_minor, paid_minor, change_minor)
             VALUES ($1,'store-edge-07',1,$2,$3,$4,'kasir',$5,'IDR',$6,$6,0)",
        )
        .bind(sale_id)
        .bind(index as i64 + 1)
        .bind(Uuid::new_v4())
        .bind(SHOP)
        .bind(opened_at + chrono::Duration::hours(index as i64 + 1))
        .bind(1_000_000_i64)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("sale: {error}"));
        sqlx::query(
            "INSERT INTO edge_sale_tender (sale_id, tender_seq, method, amount_minor)
             VALUES ($1, 1, $2, 1000000)",
        )
        .bind(sale_id)
        .bind(if index == 3 { "CARD" } else { "CASH" })
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("tender: {error}"));
    }

    let fact = serde_json::json!({
        "shift_id": shift_id,
        "site_id": SHOP,
        "terminal_id": "TILL-1",
        "status": "CLOSED",
        "opened_by": "kasir",
        "opened_at": opened_at,
        "opening_float_minor": 500_000,
        "closed_by": "kasir",
        "closed_at": closed_at,
        // 500,000 float + 3,000,000 cash - 2,000,000 dropped = 1,500,000, less
        // the 40,000 that walked out unsigned.
        "declared_cash_minor": 1_460_000,
        "expected_cash_minor": 1_500_000,
        "variance_minor": -40_000,
        "movements": [
            { "movement_id": Uuid::new_v4(), "kind": "OPENING_FLOAT",
              "amount_minor": 500_000, "reason": "Modal awal", "actor_id": "kasir",
              "occurred_at": opened_at },
            { "movement_id": Uuid::new_v4(), "kind": "DROP",
              "amount_minor": -2_000_000, "reason": "Setor brankas", "actor_id": "kasir",
              "approved_by": "spv", "occurred_at": opened_at + chrono::Duration::hours(5) },
            { "movement_id": Uuid::new_v4(), "kind": "PAYOUT",
              "amount_minor": -40_000, "reason": "Ojek", "actor_id": "kasir",
              "occurred_at": opened_at + chrono::Duration::hours(6) },
        ],
    });

    let parsed =
        cloud::parse_cash_shift(&fact).unwrap_or_else(|reason| panic!("parse shift: {reason}"));
    let mut tx = pool.begin().await.unwrap_or_else(|e| panic!("begin: {e}"));
    cloud::cash_shift_ingest(&mut tx, "store-edge-07", 1, 9, &parsed)
        .await
        .unwrap_or_else(|error| panic!("ingest: {error}"));
    tx.commit().await.unwrap_or_else(|e| panic!("commit: {e}"));

    let equation = cloud::cash_shift_equation(&pool, shift_id)
        .await
        .unwrap_or_else(|error| panic!("equation: {error}"));

    assert_eq!(equation.opening_float_minor, 500_000);
    assert_eq!(equation.cash_sales_minor, 3_000_000, "the card is not cash");
    assert_eq!(equation.authorised_movements_minor, -2_000_000);
    // The unsigned payout does NOT reduce what the drawer should hold. That is
    // the point: a till that absorbed it would never be short.
    assert_eq!(equation.unauthorised_movements_minor, -40_000);
    assert_eq!(equation.expected_cash_minor, 1_500_000);
    assert_eq!(equation.variance_minor, Some(-40_000));

    // The float goes into the books; the difference does not, until somebody
    // accepts it.
    cloud::cash_shift_post_float(&pool, shift_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("float: {error}"));
    assert_eq!(account_balance(&pool, "101100100307").await, 500_000);

    let approved = cloud::cash_shift_approve_variance(
        &pool,
        shift_id,
        &cloud::ApproveVarianceRequest {
            posting_date: Some(date(7)),
            note: Some("ojek tidak bertanda tangan".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(approved["posted"], true);
    // Short, so the difference is a cost.
    assert_eq!(account_balance(&pool, "801011000807").await, 40_000);
    every_entry_balances(&pool).await;
}

// ---------------------------------------------------------------------------
// The deposit
// ---------------------------------------------------------------------------

/// Out of the shop's cash into transit, then out of transit into the bank.
///
/// Two entries, not one. Between them the money has a name and an owner on the
/// days it is in a bag, which is the gap the document exists to close.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_deposit_posts_twice_and_balances(pool: PgPool) {
    chart(&pool).await;

    let prepared = cloud::store_deposit_prepare(
        &pool,
        &cloud::PrepareDepositRequest {
            site_id: SHOP.into(),
            amount_minor: 12_000_000,
            deposit_date: date(7),
            bank_key: Some("bank_giro".into()),
            bank_qualifier: Some(BANK.into()),
            remittance_line_id: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("prepare: {error}"));
    let deposit_id: Uuid = serde_json::from_value(prepared["deposit_id"].clone())
        .unwrap_or_else(|error| panic!("deposit id: {error}"));
    assert_eq!(prepared["status"], "PREPARED");
    // Preparing moves nothing.
    assert_eq!(account_balance(&pool, "101100100107").await, 0);

    cloud::store_deposit_hand_over(
        &pool,
        deposit_id,
        &cloud::HandOverDepositRequest {
            proof_file_id: None,
            posting_date: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("hand over: {error}"));
    assert_eq!(account_balance(&pool, "101100100107").await, -12_000_000);
    assert_eq!(account_balance(&pool, "101100500107").await, 12_000_000);
    // The bank has not seen it yet.
    assert_eq!(account_balance(&pool, "101100200100").await, 0);

    cloud::store_deposit_confirm(
        &pool,
        deposit_id,
        &cloud::ConfirmDepositRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("confirm: {error}"));

    assert_eq!(
        account_balance(&pool, "101100500107").await,
        0,
        "cash in transit empties when the bank agrees"
    );
    assert_eq!(account_balance(&pool, "101100200100").await, 12_000_000);
    assert_eq!(
        entries_for(&pool, "STORE_DEPOSIT", &deposit_id.to_string())
            .await
            .len(),
        2,
        "a deposit posts at DEPOSITED and again at CONFIRMED"
    );
    every_entry_balances(&pool).await;

    // Confirming twice is a no-op rather than a second entry.
    let again = cloud::store_deposit_confirm(
        &pool,
        deposit_id,
        &cloud::ConfirmDepositRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("confirm again: {error}"));
    assert_eq!(again["posted"], false);
}

// ---------------------------------------------------------------------------
// What the shop may spend
// ---------------------------------------------------------------------------

/// The drawer is not a pot, and neither are the takings.
///
/// Both refusals name somewhere else to go. A refusal that only says no is a
/// refusal somebody works around by taking the money anyway.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_expense_from_the_drawer_is_refused(pool: PgPool) {
    chart(&pool).await;

    for (source, expected) in [("DRAWER", "petty cash"), ("SALES_PROCEEDS", "remittance")] {
        let refused = cloud::store_expense_claim(
            &pool,
            &cloud::ClaimExpenseRequest {
                site_id: SHOP.into(),
                source: source.into(),
                allocation_id: None,
                category: "expense_electricity".into(),
                amount_minor: 40_000,
                spent_on: date(7),
                vendor: "Warung".into(),
                photo_file_id: None,
                memo: None,
            },
            ACTOR,
        )
        .await;
        let message = match refused {
            Err(error) => error.to_string(),
            Ok(value) => panic!("{source} was accepted: {value}"),
        };
        assert!(
            message.contains(expected),
            "{source} refusal should point at {expected}: {message}"
        );
    }
    // And nothing was written.
    let claimed = cloud::store_expense_list(&pool, Some(SHOP), None, 50)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert!(claimed.is_empty());
}

/// A store manager may approve up to the limit and no further.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_expense_above_the_limit_needs_head_office(pool: PgPool) {
    chart(&pool).await;

    let small = claim(&pool, STORE_EXPENSE_MANAGER_LIMIT_MINOR).await;
    let big = claim(&pool, STORE_EXPENSE_MANAGER_LIMIT_MINOR + 1).await;

    // At the limit, the shop's own manager signs.
    cloud::store_expense_approve(
        &pool,
        small,
        &cloud::ApproveExpenseRequest {
            approver_level: "SUPERVISOR".into(),
            posting_date: None,
        },
        OTHER,
    )
    .await
    .unwrap_or_else(|error| panic!("approve small: {error}"));

    // One rupiah over, and they may not.
    let refused = cloud::store_expense_approve(
        &pool,
        big,
        &cloud::ApproveExpenseRequest {
            approver_level: "SUPERVISOR".into(),
            posting_date: None,
        },
        OTHER,
    )
    .await;
    let message = match refused {
        Err(error) => error.to_string(),
        Ok(value) => panic!("a supervisor approved it: {value}"),
    };
    assert!(message.contains("head office"), "{message}");

    // Head office can.
    cloud::store_expense_approve(
        &pool,
        big,
        &cloud::ApproveExpenseRequest {
            approver_level: "ADMIN".into(),
            posting_date: None,
        },
        OTHER,
    )
    .await
    .unwrap_or_else(|error| panic!("approve big: {error}"));

    // And nobody approves their own claim, at any size.
    let mine = claim(&pool, 10_000).await;
    let own = cloud::store_expense_approve(
        &pool,
        mine,
        &cloud::ApproveExpenseRequest {
            approver_level: "ADMIN".into(),
            posting_date: None,
        },
        ACTOR,
    )
    .await;
    assert!(own.is_err(), "the claimant approved their own expense");

    assert_eq!(
        account_balance(&pool, "101100100207").await,
        -(STORE_EXPENSE_MANAGER_LIMIT_MINOR * 2 + 1),
        "petty cash falls by exactly what was approved"
    );
    every_entry_balances(&pool).await;
}

async fn claim(pool: &PgPool, amount_minor: i64) -> Uuid {
    let claimed = cloud::store_expense_claim(
        pool,
        &cloud::ClaimExpenseRequest {
            site_id: SHOP.into(),
            source: "PETTY_CASH".into(),
            allocation_id: None,
            category: "expense_electricity".into(),
            amount_minor,
            spent_on: date(7),
            vendor: "PLN".into(),
            photo_file_id: None,
            memo: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("claim: {error}"));
    serde_json::from_value(claimed["expense_id"].clone())
        .unwrap_or_else(|error| panic!("expense id: {error}"))
}

// ---------------------------------------------------------------------------
// The manager's float
// ---------------------------------------------------------------------------

/// Sending funds opens a payment ledger item; every settlement reduces it; and
/// the equation closes three ways over.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_fund_is_owed_until_it_is_accounted_for(pool: PgPool) {
    chart(&pool).await;
    let budi = person(&pool, "emp-budi", "K0701").await;

    let sent = cloud::operating_fund_send(&pool, &send_request(&budi, 10_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));
    let fund_id: Uuid = serde_json::from_value(sent["fund_id"].clone())
        .unwrap_or_else(|error| panic!("fund id: {error}"));

    // Dr Piutang Kepala Toko at the shop / Cr the bank at head office.
    assert_eq!(account_balance(&pool, "101110200207").await, 10_000_000);
    assert_eq!(account_balance(&pool, "101100200100").await, -10_000_000);
    // And a payment ledger item against the CUSTODIAN, not the shop.
    assert!(
        !sent["payment_ledger_entry_id"].is_null(),
        "sending funds must open a payment ledger item"
    );
    assert_eq!(
        cloud::store_ledger_outstanding(&pool, "store_manager_receivable", Some(SHOP))
            .await
            .unwrap_or_else(|error| panic!("outstanding: {error}")),
        10_000_000
    );

    // A supplier bill the manager settled in person.
    settle(&pool, fund_id, "VENDOR_BILL", 4_000_000, None).await;
    // Wages handed over.
    settle(&pool, fund_id, "PAYROLL", 3_000_000, None).await;
    // An approved cost with no bill behind it.
    settle(
        &pool,
        fund_id,
        "DIRECT_EXPENSE",
        1_000_000,
        Some("expense_electricity"),
    )
    .await;
    // And some of it came back.
    settle(&pool, fund_id, "RETURN", 500_000, None).await;

    let accountability = cloud::operating_fund_accountability(&pool, fund_id)
        .await
        .unwrap_or_else(|error| panic!("accountability: {error}"));
    assert_eq!(accountability.sent_minor, 10_000_000);
    assert_eq!(accountability.settled_payments_minor, 7_000_000);
    assert_eq!(accountability.direct_expenses_minor, 1_000_000);
    assert_eq!(accountability.returned_minor, 500_000);
    assert_eq!(accountability.outstanding_minor, 1_500_000);
    assert!(accountability.balances, "the equation has to close");

    // The three readings of "outstanding" that have to agree.
    let from_funds: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(amount_minor - settled_minor - returned_minor), 0)::bigint
           FROM operating_fund WHERE site_id = $1 AND status <> 'CLOSED'",
    )
    .bind(SHOP)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("funds: {error}"));
    let from_ledger =
        cloud::store_ledger_outstanding(&pool, "store_manager_receivable", Some(SHOP))
            .await
            .unwrap_or_else(|error| panic!("ledger: {error}"));
    let from_books = account_balance(&pool, "101110200207").await;

    assert_eq!(from_funds, 1_500_000, "the funds table");
    assert_eq!(from_ledger, 1_500_000, "the payment ledger");
    assert_eq!(from_books, 1_500_000, "1011102002 PIUTANG KEPALA TOKO");

    // Paying a bill discharges the payable rather than making an expense.
    assert_eq!(account_balance(&pool, "201200100100").await, 4_000_000);
    every_entry_balances(&pool).await;

    // Over-accounting is refused rather than producing a negative balance.
    let over = cloud::fund_settlement_record(
        &pool,
        &cloud::SettleFundRequest {
            fund_id,
            allocation_id: None,
            kind: "RETURN".into(),
            reference_id: None,
            expense_key: None,
            amount_minor: 1_500_001,
            settled_on: date(20),
            proof_file_id: None,
            note: None,
        },
        ACTOR,
    )
    .await;
    assert!(over.is_err(), "the fund was over-accounted");
}

fn send_request(custodian: &str, amount_minor: i64) -> cloud::SendFundRequest {
    cloud::SendFundRequest {
        site_id: SHOP.into(),
        custodian_employee_id: custodian.into(),
        amount_minor,
        value_date: date(1),
        due_date: Some(date(30)),
        bank_key: "bank_giro".into(),
        bank_qualifier: BANK.into(),
        // The custodian's own account. Payout metadata: it is not a bank
        // account, it is not in the chart, and nothing resolves it.
        payout_bank_name: "BCA".into(),
        payout_account_no: "7712345678".into(),
        payout_account_name: "Budi Santoso".into(),
        note: None,
    }
}

async fn settle(pool: &PgPool, fund_id: Uuid, kind: &str, amount: i64, expense_key: Option<&str>) {
    cloud::fund_settlement_record(
        pool,
        &cloud::SettleFundRequest {
            fund_id,
            allocation_id: None,
            kind: kind.into(),
            reference_id: None,
            expense_key: expense_key.map(str::to_string),
            amount_minor: amount,
            settled_on: date(15),
            proof_file_id: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("settle {kind}: {error}"));
}

/// The float goes with the job, not with the person who had it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_handover_moves_the_balance_to_the_new_person(pool: PgPool) {
    chart(&pool).await;
    let budi = person(&pool, "emp-budi", "K0701").await;
    let sari = person(&pool, "emp-sari", "K0702").await;

    cloud::operating_fund_send(&pool, &send_request(&budi, 6_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));

    let before = account_balance(&pool, "101110200207").await;
    assert_eq!(before, 6_000_000);
    assert_eq!(open_against(&pool, &budi).await, 6_000_000);
    assert_eq!(open_against(&pool, &sari).await, 0);

    let prepared = cloud::custodian_handover_prepare(
        &pool,
        &cloud::PrepareHandoverRequest {
            site_id: SHOP.into(),
            from_employee_id: budi.clone(),
            to_employee_id: sari.clone(),
            handover_date: date(20),
            note: Some("Budi pindah ke C009".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("prepare: {error}"));
    let handover_id: Uuid = serde_json::from_value(prepared["handover_id"].clone())
        .unwrap_or_else(|error| panic!("handover id: {error}"));
    // The amount is taken from the books, not typed.
    assert_eq!(prepared["amount_minor"], 6_000_000);

    // One signature is not a handover.
    let half = cloud::custodian_handover_sign(
        &pool,
        handover_id,
        &cloud::SignHandoverRequest {
            side: "FROM".into(),
        },
        "budi",
    )
    .await
    .unwrap_or_else(|error| panic!("sign from: {error}"));
    assert_eq!(half["status"], "DRAFT");
    assert_eq!(open_against(&pool, &sari).await, 0, "nothing moved yet");

    let signed = cloud::custodian_handover_sign(
        &pool,
        handover_id,
        &cloud::SignHandoverRequest { side: "TO".into() },
        "sari",
    )
    .await
    .unwrap_or_else(|error| panic!("sign to: {error}"));
    assert_eq!(signed["status"], "SIGNED");
    assert_eq!(signed["posted"], true);

    // The GL balance has NOT moved: it is the same account at the same shop.
    assert_eq!(
        account_balance(&pool, "101110200207").await,
        before,
        "a handover must not change what the shop owes"
    );
    // The sub-ledger has. That is the whole document.
    assert_eq!(open_against(&pool, &budi).await, 0);
    assert_eq!(open_against(&pool, &sari).await, 6_000_000);
    every_entry_balances(&pool).await;
}

async fn open_against(pool: &PgPool, party_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(outstanding_minor), 0)::bigint
           FROM payment_ledger_entry
          WHERE account_key = 'store_manager_receivable' AND party_id = $1",
    )
    .bind(party_id)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("open items: {error}"))
}

/// Wages were an expense when payroll was finalised. Handing them over is not a
/// second one.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn payroll_paid_through_the_manager_posts_no_second_salary_expense(pool: PgPool) {
    chart(&pool).await;
    let budi = person(&pool, "emp-budi", "K0701").await;
    let siti = person(&pool, "emp-siti", "K0703").await;
    let joko = person(&pool, "emp-joko", "K0704").await;

    // The run head office finalised, and the payable it recognised.
    sqlx::query(
        "INSERT INTO org_place (id, name, kind, site_id) VALUES ($1,'Store 07','STORE',$1)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(SHOP)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("place: {error}"));
    sqlx::query(
        "INSERT INTO payroll_run (id, place_id, period, state, complete, incomplete_because)
         VALUES ('run-2026-09', $1, DATE '2026-09-01', 'SEALED', false, 'no punch source')",
    )
    .bind(SHOP)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("run: {error}"));

    let sent = cloud::operating_fund_send(&pool, &send_request(&budi, 9_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));
    let fund_id: Uuid = serde_json::from_value(sent["fund_id"].clone())
        .unwrap_or_else(|error| panic!("fund id: {error}"));

    let allocated = cloud::fund_allocation_open(
        &pool,
        &cloud::OpenAllocationRequest {
            fund_id,
            purpose_kind: "PAYROLL".into(),
            reference_kind: "PAYROLL_RUN".into(),
            reference_id: "run-2026-09".into(),
            purpose: "gaji September".into(),
            amount_minor: 9_000_000,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("allocate: {error}"));
    let allocation_id: Uuid = serde_json::from_value(allocated["allocation_id"].clone())
        .unwrap_or_else(|error| panic!("allocation id: {error}"));

    cloud::payroll_payout_build(
        &pool,
        &cloud::BuildPayoutListRequest {
            allocation_id,
            lines: vec![
                cloud::PayoutLineRequest {
                    employee_id: siti.clone(),
                    net_minor: 5_000_000,
                },
                cloud::PayoutLineRequest {
                    employee_id: joko.clone(),
                    net_minor: 4_000_000,
                },
            ],
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("build: {error}"));

    let tasks = cloud::payroll_payout_list(&pool, allocation_id)
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(tasks.len(), 2);
    // What the manager sees, and everything they see.
    for task in &tasks {
        let fields: Vec<&str> = task
            .as_object()
            .map(|map| map.keys().map(String::as_str).collect())
            .unwrap_or_default();
        for forbidden in ["gross_minor", "tax_minor", "bpjs_minor", "deductions"] {
            assert!(
                !fields.contains(&forbidden),
                "the payout list must not carry {forbidden}"
            );
        }
    }

    let task_id: Uuid = serde_json::from_value(tasks[0]["task_id"].clone())
        .unwrap_or_else(|error| panic!("task id: {error}"));
    cloud::payroll_payout_pay(
        &pool,
        task_id,
        &cloud::PayEmployeeRequest {
            paid_on: date(25),
            proof_file_id: None,
        },
        "budi",
    )
    .await
    .unwrap_or_else(|error| panic!("pay: {error}"));

    let paid: i64 = serde_json::from_value(tasks[0]["net_minor"].clone())
        .unwrap_or_else(|error| panic!("net: {error}"));
    // The payable falls; nothing was charged to an expense account.
    assert_eq!(account_balance(&pool, "201220100107").await, paid);
    assert_eq!(
        account_balance(&pool, "601031000607").await,
        0,
        "handing over wages must not recognise the salary a second time"
    );
    // And the manager owes that much less.
    assert_eq!(
        account_balance(&pool, "101110200207").await,
        9_000_000 - paid
    );
    every_entry_balances(&pool).await;
}

// ---------------------------------------------------------------------------
// The remittance order
// ---------------------------------------------------------------------------

/// Issuing an order changes no balance and opens no ledger item.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_remittance_order_posts_nothing_when_it_is_created(pool: PgPool) {
    chart(&pool).await;

    let entries_before: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"));

    let issued = cloud::remittance_order_issue(
        &pool,
        &cloud::IssueRemittanceRequest {
            site_id: SHOP.into(),
            order_date: date(8),
            reconciled_through: Some(date(7)),
            lines: vec![cloud::RemittanceLineRequest {
                destination_kind: "BANK_ACCOUNT".into(),
                destination_ref: BANK.into(),
                destination_name: Some("BCA Giro HO".into()),
                amount_minor: 12_000_000,
                purpose: "setoran harian".into(),
            }],
            total_minor: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));

    assert_eq!(issued["posted"], false);
    assert!(issued["order_number"]
        .as_str()
        .is_some_and(|number| number.starts_with("REM-26-09-")));

    let entries_after: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(entries_before, entries_after, "an order posted a journal");

    let ledger_items: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM payment_ledger_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(ledger_items, 0, "an order opened a payment ledger item");

    // And it reads as ordered, because nothing has carried it out.
    let order_id: Uuid = serde_json::from_value(issued["order_id"].clone())
        .unwrap_or_else(|error| panic!("order id: {error}"));
    let view = cloud::remittance_order_view(&pool, order_id)
        .await
        .unwrap_or_else(|error| panic!("view: {error}"));
    assert_eq!(view["progress"], "ORDERED");
    assert_eq!(view["unexecuted_minor"], 12_000_000);
}

/// The order's status is read from the documents linked to it.
///
/// A deposit that has reached the bank is confirmed; one still in a bag is
/// recorded. Both are executions; only the first is certainty.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_order_projects_the_state_of_what_carried_it_out(pool: PgPool) {
    chart(&pool).await;

    let issued = cloud::remittance_order_issue(
        &pool,
        &cloud::IssueRemittanceRequest {
            site_id: SHOP.into(),
            order_date: date(8),
            reconciled_through: Some(date(7)),
            lines: vec![
                cloud::RemittanceLineRequest {
                    destination_kind: "BANK_ACCOUNT".into(),
                    destination_ref: BANK.into(),
                    destination_name: Some("BCA Giro HO".into()),
                    amount_minor: 8_000_000,
                    purpose: "setoran".into(),
                },
                cloud::RemittanceLineRequest {
                    destination_kind: "VENDOR".into(),
                    destination_ref: "Pak Slamet".into(),
                    destination_name: Some("Pak Slamet".into()),
                    amount_minor: 2_000_000,
                    purpose: "sewa genset".into(),
                },
            ],
            total_minor: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));
    let order_id: Uuid = serde_json::from_value(issued["order_id"].clone())
        .unwrap_or_else(|error| panic!("order id: {error}"));
    let view = cloud::remittance_order_view(&pool, order_id)
        .await
        .unwrap_or_else(|error| panic!("view: {error}"));
    let bank_line: Uuid = serde_json::from_value(view["lines"][0]["line_id"].clone())
        .unwrap_or_else(|error| panic!("line id: {error}"));
    let vendor_line: Uuid = serde_json::from_value(view["lines"][1]["line_id"].clone())
        .unwrap_or_else(|error| panic!("line id: {error}"));
    assert_eq!(
        view["amount_minor"], 10_000_000,
        "the header follows its lines"
    );

    // A deposit carries the bank line, and reaches the bank.
    let prepared = cloud::store_deposit_prepare(
        &pool,
        &cloud::PrepareDepositRequest {
            site_id: SHOP.into(),
            amount_minor: 8_000_000,
            deposit_date: date(8),
            bank_key: Some("bank_giro".into()),
            bank_qualifier: Some(BANK.into()),
            remittance_line_id: Some(bank_line),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("prepare: {error}"));
    let deposit_id: Uuid = serde_json::from_value(prepared["deposit_id"].clone())
        .unwrap_or_else(|error| panic!("deposit id: {error}"));
    let deposit_number = prepared["deposit_number"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    cloud::remittance_order_link_execution(
        &pool,
        &cloud::LinkExecutionRequest {
            line_id: bank_line,
            document_kind: "STORE_DEPOSIT".into(),
            document_id: deposit_id,
            document_number: deposit_number,
            amount_minor: 8_000_000,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("link deposit: {error}"));

    // One line covered, one untouched.
    let view = cloud::remittance_order_view(&pool, order_id)
        .await
        .unwrap_or_else(|error| panic!("view: {error}"));
    assert_eq!(view["progress"], "PARTLY_EXECUTED");
    assert_eq!(view["executed_minor"], 8_000_000);
    // The deposit is still in the shop, so nothing is confirmed.
    assert_eq!(view["confirmed_minor"], 0);

    // A cash document carries the vendor line. Its own lane is not merged, so
    // this build cannot read its status and reads the execution as recorded —
    // never as confirmed. See TODO(lane-C).
    cloud::remittance_order_link_execution(
        &pool,
        &cloud::LinkExecutionRequest {
            line_id: vendor_line,
            document_kind: "CASH_DOCUMENT".into(),
            document_id: Uuid::new_v4(),
            document_number: "KK-26-09-00042".into(),
            amount_minor: 2_000_000,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("link cash document: {error}"));

    let view = cloud::remittance_order_view(&pool, order_id)
        .await
        .unwrap_or_else(|error| panic!("view: {error}"));
    assert_eq!(view["progress"], "EXECUTED");
    assert_eq!(view["unexecuted_minor"], 0);
    assert_eq!(view["confirmed_minor"], 0);

    // The bank agrees about the deposit. Still not everything is confirmed,
    // because the cash document cannot be read.
    cloud::store_deposit_hand_over(
        &pool,
        deposit_id,
        &cloud::HandOverDepositRequest {
            proof_file_id: None,
            posting_date: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("hand over: {error}"));
    cloud::store_deposit_confirm(
        &pool,
        deposit_id,
        &cloud::ConfirmDepositRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("confirm: {error}"));

    let view = cloud::remittance_order_view(&pool, order_id)
        .await
        .unwrap_or_else(|error| panic!("view: {error}"));
    assert_eq!(view["confirmed_minor"], 8_000_000);
    assert_eq!(
        view["progress"], "EXECUTED",
        "one unreadable execution is enough to withhold CONFIRMED"
    );

    // The pure projection agrees with the read one, given the same facts.
    let standing = remittance_standing(
        false,
        &[
            LineProgress {
                authorised_minor: 8_000_000,
                executions: vec![LineExecution {
                    amount_minor: 8_000_000,
                    state: ExecutionState::Confirmed,
                }],
            },
            LineProgress {
                authorised_minor: 2_000_000,
                executions: vec![LineExecution {
                    amount_minor: 2_000_000,
                    state: ExecutionState::Recorded,
                }],
            },
        ],
    );
    assert_eq!(standing.progress, RemittanceProgress::Executed);
}

/// A shop may not pay out of its takings without a line that authorises it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn sales_proceeds_cannot_be_spent_without_a_line(pool: PgPool) {
    chart(&pool).await;

    // Nothing ordered, so nothing authorised.
    let none = cloud::remittance_authority(&pool, SHOP, "VENDOR", "Pak Slamet", 2_000_000)
        .await
        .unwrap_or_else(|error| panic!("authority: {error}"));
    assert_eq!(none["authorised"], false);
    assert_eq!(none["available_minor"], 0);
    let refusal = none["refusal"].as_str().unwrap_or_default();
    assert!(
        refusal.contains("remittance order") && refusal.contains("custody"),
        "the refusal has to say why and where to go: {refusal}"
    );

    // Head office orders two million to that payee, and now it is authorised —
    // and only up to that.
    cloud::remittance_order_issue(
        &pool,
        &cloud::IssueRemittanceRequest {
            site_id: SHOP.into(),
            order_date: date(8),
            reconciled_through: Some(date(7)),
            lines: vec![cloud::RemittanceLineRequest {
                destination_kind: "VENDOR".into(),
                destination_ref: "Pak Slamet".into(),
                destination_name: Some("Pak Slamet".into()),
                amount_minor: 2_000_000,
                purpose: "sewa genset".into(),
            }],
            total_minor: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("issue: {error}"));

    let allowed = cloud::remittance_authority(&pool, SHOP, "VENDOR", "Pak Slamet", 2_000_000)
        .await
        .unwrap_or_else(|error| panic!("authority: {error}"));
    assert_eq!(allowed["authorised"], true);

    let too_much = cloud::remittance_authority(&pool, SHOP, "VENDOR", "Pak Slamet", 2_000_001)
        .await
        .unwrap_or_else(|error| panic!("authority: {error}"));
    assert_eq!(too_much["authorised"], false);

    // A different payee is a different question, and the answer is still no.
    let elsewhere = cloud::remittance_authority(&pool, SHOP, "VENDOR", "Bu Ani", 100_000)
        .await
        .unwrap_or_else(|error| panic!("authority: {error}"));
    assert_eq!(elsewhere["authorised"], false);

    // Linking more than the line carries is refused at the database.
    let line_id: Uuid = sqlx::query_scalar("SELECT line_id FROM remittance_order_line LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("line: {error}"));
    let over = cloud::remittance_order_link_execution(
        &pool,
        &cloud::LinkExecutionRequest {
            line_id,
            document_kind: "CASH_DOCUMENT".into(),
            document_id: Uuid::new_v4(),
            document_number: "KK-26-09-00099".into(),
            amount_minor: 2_500_000,
        },
        ACTOR,
    )
    .await;
    assert!(over.is_err(), "an execution exceeded its authority");
}

// ---------------------------------------------------------------------------
// Where the money is
// ---------------------------------------------------------------------------

/// The position keeps physical money and responsibility apart.
///
/// Adding them would be the report that makes a manager think the float is
/// theirs to spend.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_position_never_adds_custody_to_cash(pool: PgPool) {
    chart(&pool).await;
    let budi = person(&pool, "emp-budi", "K0701").await;
    cloud::operating_fund_send(&pool, &send_request(&budi, 5_000_000), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("send: {error}"));
    cloud::petty_cash_replenish(
        &pool,
        &cloud::ReplenishRequest {
            site_id: SHOP.into(),
            amount_minor: 1_000_000,
            replenish_date: date(2),
            bank_key: "bank_giro".into(),
            bank_qualifier: BANK.into(),
            covers_from: None,
            covers_to: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("replenish: {error}"));

    let position = cloud::store_cash_position(&pool, SHOP, None)
        .await
        .unwrap_or_else(|error| panic!("position: {error}"));

    assert_eq!(position["physical"]["petty_cash_minor"], 1_000_000);
    assert_eq!(
        position["physical"]["total_in_the_building_minor"],
        1_000_000
    );
    // The float is not in the building and is not added to what is.
    assert_eq!(
        position["responsibility"]["operating_funds_outstanding_minor"],
        5_000_000
    );
    assert_eq!(
        position["responsibility"]["payment_ledger_outstanding_minor"],
        5_000_000
    );
    assert_eq!(position["attention"]["fund_ledger_disagrees"], false);
}

// ---------------------------------------------------------------------------
// The kernel, without a database
// ---------------------------------------------------------------------------

/// The same equation the ingest path runs, checked on figures nobody stored.
#[test]
fn the_equation_is_arithmetic_and_not_a_lookup() {
    let equation = cashier_equation(
        500_000,
        3_000_000,
        &[
            DrawerMovement {
                amount_minor: -2_000_000,
                authorised: true,
            },
            DrawerMovement {
                amount_minor: -40_000,
                authorised: false,
            },
        ],
        Some(1_460_000),
    );
    assert_eq!(equation.expected_cash_minor, 1_500_000);
    assert_eq!(equation.variance_minor, Some(-40_000));
}
