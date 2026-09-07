//! Every unit balances on its own, proved against a real Postgres.
//!
//! `domain::interunit` is unit-tested and pure, so the arithmetic is not what is
//! at stake here. What is at stake is everything the kernel cannot see: that the
//! legs it decides on resolve to the client's own accounts, that they reach
//! `journal_line` with the counterparty on them, that the database refuses an
//! entry which skipped them, and that the two sides of a pair are the same
//! number when they are read back through the map.
//!
//! One test reaches past the poster and inserts raw SQL. That is deliberate and
//! it is the same argument `finance_integration.rs` makes: a rule that holds
//! only when you go through the front door is not a rule, it is a habit.

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, PostingIntent, PostingLine};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";

/// One row of the seeded chart: code, name, parent, heading, location.
type ChartRow = (
    &'static str,
    &'static str,
    Option<&'static str>,
    bool,
    Option<&'static str>,
);

/// Enough of the client's chart to move a machine between two shops and to
/// carry the affiliate balances that follow it.
///
/// The affiliate codes are the client's own, and the shape of them is the whole
/// reason this fixture is worth reading: `102140100200` is
/// `Piutang Affiliasi Pembiayaan CIKUPA - HO` — CIKUPA in the ten-digit rung is
/// the COUNTERPARTY, `00` in the suffix is the OWNER, which is head office. The
/// mirror is `201230100101`, the same balance in CIKUPA's own books.
async fn seed_chart(pool: &PgPool) {
    let rows: [ChartRow; 29] = [
        ("1", "ASSET", None, true, None),
        ("102", "NON CURRENT ASSET", Some("1"), true, None),
        ("10215", "AKTIVA TETAP", Some("102"), true, None),
        ("1021504", "Machineries", Some("10215"), true, None),
        (
            "102150400101",
            "Mesin CIKUPA",
            Some("1021504"),
            false,
            Some("store-01"),
        ),
        (
            "102150400102",
            "Mesin MUARO BUNGO",
            Some("1021504"),
            false,
            Some("store-02"),
        ),
        // The inter-unit families, both sides.
        (
            "10214",
            "PIUTANG  AFFILIASI ANTAR UNIT",
            Some("102"),
            true,
            None,
        ),
        (
            "1021401",
            "PIUTANG  AFFILIASI PEMBIAYAAN",
            Some("10214"),
            true,
            None,
        ),
        (
            "102140100200",
            "Piutang Affiliasi Pembiayaan CIKUPA - HO",
            Some("1021401"),
            false,
            Some("dc"),
        ),
        (
            "102140100300",
            "Piutang Affiliasi Pembiayaan MUARO BUNGO - HO",
            Some("1021401"),
            false,
            Some("dc"),
        ),
        (
            "102140100400",
            "Piutang Affiliasi Pembiayaan PURBALINGGA - HO",
            Some("1021401"),
            false,
            Some("dc"),
        ),
        (
            "1021402",
            "PIUTANG  AFFILIASI ATAS BARANG",
            Some("10214"),
            true,
            None,
        ),
        (
            "102140200200",
            "Piutang Affiliasi Atas Barang CIKUPA - HO",
            Some("1021402"),
            false,
            Some("dc"),
        ),
        (
            "102140200300",
            "Piutang Affiliasi Atas Barang MUARO BUNGO - HO",
            Some("1021402"),
            false,
            Some("dc"),
        ),
        ("2", "LIABILITIES", None, true, None),
        ("201", "HUTANG JANGKA PENDEK", Some("2"), true, None),
        ("20123", "HUTANG LAIN-LAIN", Some("201"), true, None),
        (
            "2012301",
            "HUTANG AFFILIASI PEMBIAYAAN",
            Some("20123"),
            true,
            None,
        ),
        (
            "201230100101",
            "Hutang Affiliasi Pembiayaan HEAD OFFICE - C001",
            Some("2012301"),
            false,
            Some("store-01"),
        ),
        (
            "201230100102",
            "Hutang Affiliasi Pembiayaan HEAD OFFICE - C002",
            Some("2012301"),
            false,
            Some("store-02"),
        ),
        (
            "201230100103",
            "Hutang Affiliasi Pembiayaan HEAD OFFICE - C003",
            Some("2012301"),
            false,
            Some("store-03"),
        ),
        (
            "2012302",
            "HUTANG AFFILIASI ATAS BARANG",
            Some("20123"),
            true,
            None,
        ),
        (
            "201230200101",
            "Hutang Affiliasi Atas Barang HEAD OFFICE - C001",
            Some("2012302"),
            false,
            Some("store-01"),
        ),
        (
            "201230200102",
            "Hutang Affiliasi Atas Barang HEAD OFFICE - C002",
            Some("2012302"),
            false,
            Some("store-02"),
        ),
        // What head office pays a shop's electricity out of, and what it owes
        // the supplier meanwhile.
        ("101", "CURRENT ASSET", Some("1"), true, None),
        ("20120", "HUTANG DAGANG", Some("201"), true, None),
        ("2012001", "HUTANG SUPPLIER", Some("20120"), true, None),
        (
            "201200100100",
            "Hutang Suppliers HO",
            Some("2012001"),
            false,
            Some("dc"),
        ),
        (
            "601011000103",
            "Biaya Listrik PURBALINGGA",
            Some("6010110"),
            false,
            Some("store-03"),
        ),
    ];
    // The expense family the electricity leaf hangs under, first: a child
    // cannot be inserted before its parent.
    for (code, name, parent, is_group, site) in [
        ("6", "BIAYA OPERASIONAL", None, true, None::<&str>),
        ("601", "BIAYA UMUM & ADMINISTRASI", Some("6"), true, None),
        ("60101", "BIAYA UMUM", Some("601"), true, None),
        (
            "6010110",
            "Biaya Listrik, Air & Telepon",
            Some("60101"),
            true,
            None,
        ),
    ] {
        insert_account(pool, code, name, parent, is_group, site).await;
    }
    for (code, name, parent, is_group, site) in rows {
        insert_account(pool, code, name, parent, is_group, site).await;
    }
    for (year, month) in [(2026, 8), (2026, 9)] {
        cloud::open_period(pool, year, month)
            .await
            .unwrap_or_else(|error| panic!("period {year}-{month}: {error}"));
    }
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
         VALUES ($1,$2,$3,$4,$5)",
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

async fn map(pool: &PgPool, key: &str, site: &str, qualifier: &str, code: &str) {
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
    .unwrap_or_else(|error| panic!("map {key}/{site}/{qualifier}: {error}"));
}

/// The affiliate map, as migration 0122 writes it for the real fourteen.
///
/// The qualifier is `<KIND>:<counterparty>`, which is exactly the string
/// `domain::interunit` builds — so if these two ever stopped agreeing, every
/// inter-unit posting would be refused, and that is what these tests would say.
async fn map_affiliates(pool: &PgPool) {
    for (store, receivable, payable) in [
        ("store-01", "102140100200", "201230100101"),
        ("store-02", "102140100300", "201230100102"),
        ("store-03", "102140100400", "201230100103"),
    ] {
        map(
            pool,
            "affiliate_receivable",
            "dc",
            &format!("PEMBIAYAAN:{store}"),
            receivable,
        )
        .await;
        map(pool, "affiliate_payable", store, "PEMBIAYAAN:dc", payable).await;
    }
}

/// The goods column, which is where a stock movement between units lands.
///
/// The client keeps `Atas Barang` and `Pembiayaan` as separate families and
/// reconciles them separately, so a rule that merged them would produce one
/// balance neither side could agree. `kind_for_source` is what decides, and
/// mapping only these two here is what lets a test prove it decided right.
async fn map_affiliates_for_goods(pool: &PgPool) {
    for (store, receivable, payable) in [
        ("store-01", "102140200200", "201230200101"),
        ("store-02", "102140200300", "201230200102"),
    ] {
        map(
            pool,
            "affiliate_receivable",
            "dc",
            &format!("BARANG:{store}"),
            receivable,
        )
        .await;
        map(pool, "affiliate_payable", store, "BARANG:dc", payable).await;
    }
}

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or_else(|| panic!("bad date"))
}

/// Debits less credits at each location this entry touched.
async fn nets(pool: &PgPool, entry_id: Uuid) -> Vec<(String, i64)> {
    let rows = sqlx::query(
        "SELECT site_id, SUM(debit_minor - credit_minor)::bigint AS net
           FROM journal_line WHERE entry_id = $1 GROUP BY site_id ORDER BY site_id",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("nets: {error}"));
    rows.iter()
        .map(|row| {
            (
                row.try_get::<String, _>("site_id")
                    .unwrap_or_else(|error| panic!("site: {error}")),
                row.try_get::<i64, _>("net")
                    .unwrap_or_else(|error| panic!("net: {error}")),
            )
        })
        .collect()
}

/// The lines of one entry that name another unit.
async fn affiliate_legs(pool: &PgPool, entry_id: Uuid) -> Vec<(String, String, String, i64, i64)> {
    let rows = sqlx::query(
        "SELECT site_id, counter_site_id, account_code, debit_minor, credit_minor
           FROM journal_line
          WHERE entry_id = $1 AND counter_site_id IS NOT NULL
          ORDER BY line_number",
    )
    .bind(entry_id)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("legs: {error}"));
    rows.iter()
        .map(|row| {
            (
                row.try_get("site_id").unwrap_or_default(),
                row.try_get("counter_site_id").unwrap_or_default(),
                row.try_get("account_code").unwrap_or_default(),
                row.try_get("debit_minor").unwrap_or_default(),
                row.try_get("credit_minor").unwrap_or_default(),
            )
        })
        .collect()
}

async fn a_machine_at(pool: &PgPool, site: &str) -> Uuid {
    let asset = cloud::register_asset(
        pool,
        &cloud::RegisterAssetRequest {
            asset_number: "AST-000001".into(),
            name: "Mesin jahit Juki".into(),
            category_code: "1021504".into(),
            site_id: site.into(),
            acquired_on: date(2026, 8, 1),
            serial_number: None,
            notes: None,
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error}"));
    cloud::assess_asset(
        pool,
        asset.asset_id,
        &cloud::AssessAssetRequest {
            decision: "CAPITALIZE".into(),
            capitalized_cost_minor: Some(24_000_000),
            salvage_value_minor: Some(0),
            useful_life_months: Some(48),
            method: Some("STRAIGHT_LINE".into()),
            in_service_on: Some(date(2026, 8, 1)),
            reason: "mesin produksi, di atas ambang kapitalisasi".into(),
            acquired_via_line_id: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("assess: {error}"));
    asset.asset_id
}

// ---------------------------------------------------------------------------

/// The case this lane exists for, and the one `assets.rs` has been posting
/// wrong since 0096: a machine moves from one shop to another.
///
/// Before the balancer, that entry credited store 01 and debited store 02 and
/// nothing else — two shops' trial balances out by 24,000,000 in opposite
/// directions, and a consolidated one that balanced perfectly. The fix is not
/// in `assets.rs`, which still builds the same two lines; it is that the door
/// they go through will not let them out that way.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_asset_moving_between_two_shops_leaves_both_of_them_balanced(pool: PgPool) {
    seed_chart(&pool).await;
    map_affiliates(&pool).await;
    map(&pool, "fixed_asset", "store-01", "1021504", "102150400101").await;
    map(&pool, "fixed_asset", "store-02", "1021504", "102150400102").await;

    let asset_id = a_machine_at(&pool, "store-01").await;
    let moved = cloud::transfer_asset(
        &pool,
        asset_id,
        &cloud::TransferAssetRequest {
            to_site: "store-02".into(),
            moved_on: date(2026, 9, 10),
            memo: Some("dipindah ke MUARO BUNGO".into()),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("transfer: {error}"));
    assert_eq!(moved.site_id, "store-02");

    let entry_id: Uuid = sqlx::query(
        "SELECT entry_id FROM journal_entry WHERE source_kind = 'ASSET_TRANSFER' LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("entry: {error}"))
    .try_get("entry_id")
    .unwrap_or_else(|error| panic!("entry_id: {error}"));

    // Three locations, every one of them at zero. Head office is in the entry
    // at all only because two shops trading with each other route through it —
    // which is what leaves each shop with exactly one counterparty to agree
    // with instead of twelve.
    let by_site = nets(&pool, entry_id).await;
    assert_eq!(
        by_site,
        vec![
            ("dc".to_string(), 0),
            ("store-01".to_string(), 0),
            ("store-02".to_string(), 0)
        ],
        "every unit an entry touches has to net to zero"
    );

    // Four legs, each naming the unit on the other side. Without
    // `counter_site_id` a shop's ledger would show a line called "Hutang
    // Affiliasi Pembiayaan" and leave somebody decoding twelve digits.
    let legs = affiliate_legs(&pool, entry_id).await;
    assert_eq!(legs.len(), 4, "two pairs, not one: {legs:?}");
    assert!(
        legs.iter().all(|leg| leg.1 == "dc" || leg.0 == "dc"),
        "every leg is with head office: {legs:?}"
    );

    // Store 01 gave the machine up, so what it owes head office FALLS: its
    // payable is debited. Store 02 received it, so its payable is credited.
    let store_01 = legs
        .iter()
        .find(|leg| leg.0 == "store-01")
        .unwrap_or_else(|| panic!("no leg for store-01: {legs:?}"));
    assert_eq!(store_01.1, "dc");
    assert_eq!(store_01.2, "201230100101");
    assert_eq!((store_01.3, store_01.4), (24_000_000, 0));

    let store_02 = legs
        .iter()
        .find(|leg| leg.0 == "store-02")
        .unwrap_or_else(|| panic!("no leg for store-02: {legs:?}"));
    assert_eq!((store_02.3, store_02.4), (0, 24_000_000));

    // And head office's two legs are the mirror of the shops', which is the
    // equality the whole inter-unit check rests on.
    let report = cloud::interunit_pairs(&pool)
        .await
        .unwrap_or_else(|error| panic!("pairs: {error}"));
    let cikupa = report
        .pairs
        .iter()
        .find(|pair| pair.store_site_id == "store-01")
        .unwrap_or_else(|| panic!("no pair for store-01"));
    assert_eq!(cikupa.head_office_receivable_minor, -24_000_000);
    assert_eq!(cikupa.store_payable_minor, -24_000_000);
    assert_eq!(cikupa.difference_minor, 0);
    assert!(
        report.disagreeing.is_empty(),
        "nothing should disagree: {:?}",
        report.disagreeing
    );
}

/// The refusal 0098 wrote down, and the entry it was waiting for.
///
/// One head-office electricity invoice, the cost belonging to a shop. Until
/// 0121 the composite foreign key made this bill impossible to record at all.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_cost_may_sit_where_it_belongs_and_the_shop_still_balances(pool: PgPool) {
    seed_chart(&pool).await;
    map_affiliates(&pool).await;
    map(&pool, "non_merchandise_payable", "dc", "", "201200100100").await;

    let recorded = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "PLN-0901".into(),
            supplier_id: "PLN".into(),
            supplier_name: Some("PT PLN (Persero)".into()),
            site_id: "dc".into(),
            invoice_date: date(2026, 9, 2),
            due_date: Some(date(2026, 9, 20)),
            subtotal_minor: 1_000_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: Some("EXPENSE".into()),
            lines: Some(vec![cloud::RecordBillLine {
                account_code: "601011000103".into(),
                // PURBALINGGA's electricity, on head office's bill.
                site_id: "store-03".into(),
                amount_minor: 1_000_000,
                memo: Some("listrik September".into()),
                asset_class_code: None,
                draws_reserve: false,
            }]),
            matching: None,
            withholding_code: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record: {error}"));

    let posted = cloud::post_bill(&pool, recorded.invoice_id, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    let entry_id = posted
        .journal_entry_id
        .unwrap_or_else(|| panic!("posted with no entry"));

    assert_eq!(
        nets(&pool, entry_id).await,
        vec![("dc".to_string(), 0), ("store-03".to_string(), 0)],
        "the shop carries the cost and the debt that funded it; head office \
         carries the supplier and the receivable"
    );
    let legs = affiliate_legs(&pool, entry_id).await;
    assert_eq!(legs.len(), 2, "one pair: {legs:?}");
    // The shop owes more, so its payable is credited.
    assert_eq!(legs[0].0, "store-03");
    assert_eq!(legs[0].1, "dc");
    assert_eq!((legs[0].3, legs[0].4), (0, 1_000_000));
    assert_eq!(legs[1].0, "dc");
    assert_eq!(legs[1].1, "store-03");
    assert_eq!((legs[1].3, legs[1].4), (1_000_000, 0));
}

/// A document posts once for each step it has.
///
/// Both halves matter. Posting the same document twice for one step is a retry
/// or a race and must land once; posting it twice for two named steps is a
/// deposit recorded when it leaves the shop and again when the bank confirms
/// it, and must land twice.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_document_posts_once_for_each_step_and_no_more(pool: PgPool) {
    seed_chart(&pool).await;
    map_affiliates_for_goods(&pool).await;
    map(&pool, "fixed_asset", "store-01", "1021504", "102150400101").await;
    map(&pool, "fixed_asset", "store-02", "1021504", "102150400102").await;

    let intent = |amount: i64| PostingIntent {
        posting_date: date(2026, 9, 3),
        source_kind: "TRANSFER".into(),
        source_id: Some("TRF-0001".into()),
        rule_version: "test/1".into(),
        currency: "IDR".into(),
        memo: Some("kirim barang".into()),
        lines: vec![
            PostingLine::credit("fixed_asset", "store-01", amount).with_qualifier("1021504"),
            PostingLine::debit("fixed_asset", "store-02", amount).with_qualifier("1021504"),
        ],
    };

    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, &intent(500_000), None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("first post: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    // The same document, the same step. A resent request.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let again = cloud::post(&mut tx, &intent(500_000), None, ACTOR).await;
    let message = match again {
        Err(error) => error.to_string(),
        Ok(_) => panic!("the same document posted twice for one step"),
    };
    assert!(
        message.contains("already been posted"),
        "the refusal has to say what happened, not 'database operation failed': {message}"
    );
    drop(tx);

    // The same document, a different step. A second, honest posting.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, &intent(500_000), Some("CONFIRMED"), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("second step: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));

    let count: i64 =
        sqlx::query("SELECT COUNT(*)::bigint AS n FROM journal_entry WHERE source_id = 'TRF-0001'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"))
            .try_get("n")
            .unwrap_or_else(|error| panic!("n: {error}"));
    assert_eq!(count, 2, "one entry per step, and exactly one");

    // And a goods movement lands in the goods column. Only BARANG is mapped in
    // this test, so a rule that had classed TRANSFER as financing would not
    // have posted at all — which is the strongest form this assertion takes.
    let accounts: Vec<String> = sqlx::query(
        "SELECT DISTINCT account_code FROM journal_line
          WHERE counter_site_id IS NOT NULL ORDER BY account_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("accounts: {error}"))
    .iter()
    .map(|row| row.try_get::<String, _>("account_code").unwrap_or_default())
    .collect();
    assert_eq!(
        accounts,
        vec![
            "102140200200".to_string(),
            "102140200300".to_string(),
            "201230200101".to_string(),
            "201230200102".to_string()
        ],
        "the legs of a TRANSFER belong in Affiliasi Atas Barang"
    );
}

/// The guarantee, not the habit.
///
/// Every test above goes through the poster, which is the only writer. This one
/// does not: it inserts an entry and its lines by hand, balanced in total and
/// wrong at both locations, exactly as a migration or a second writer would.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_entry_balanced_only_in_total_is_refused_by_the_database(pool: PgPool) {
    seed_chart(&pool).await;

    let entry_id = Uuid::new_v4();
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id,
            rule_version, total_minor, currency, posted_by)
         VALUES ($1,'JV-99999999','2026-09-04','MANUAL',NULL,'by hand/1',700,'IDR','ana')",
    )
    .bind(entry_id)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("header: {error}"));

    for (line, site, debit, credit) in [(1, "store-01", 700, 0), (2, "dc", 0, 700)] {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, debit_minor, credit_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(line)
        .bind(if site == "dc" {
            "102140100200"
        } else {
            "102150400101"
        })
        .bind(site)
        .bind(debit as i64)
        .bind(credit as i64)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("line {line}: {error}"));
    }

    // Deferred, so it fails at COMMIT and not at the second INSERT — which is
    // what lets a rule add its legs in any order.
    let refusal = tx.commit().await;
    let message = match refusal {
        Err(error) => error.to_string(),
        Ok(()) => panic!("an entry that leaves two locations wrong was accepted"),
    };
    assert!(
        message.contains("out by"),
        "the refusal has to name the location and the amount: {message}"
    );
}
