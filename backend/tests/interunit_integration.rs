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

/// Two open months. The chart is the migrations' own.
///
/// This used to mint twenty-nine rows, and the shape of the affiliate codes was
/// the whole reason it was worth reading: `102140100200` was
/// `Piutang Affiliasi Pembiayaan CIKUPA - HO` — CIKUPA in the ten-digit rung
/// was the COUNTERPARTY, `00` in the suffix the OWNER — and `201230100101` was
/// the same balance in CIKUPA's own books.
///
/// All 1,176 of those leaves are `1501 Rekening koran antar-unit` now. Nothing
/// about the identity is lost and nothing is decoded from digits: the owner is
/// `journal_line.site_id`, the counterparty is `counter_site_id` (which `1501`
/// REQUIRES), and financing-or-goods is the `interunit_reason` category. What
/// changes for a reader is that a receivable and a payable are one account told
/// apart by sign — inside one legal entity an interunit balance is a clearing
/// line, and its company-wide total is zero.
async fn seed_chart(pool: &PgPool) {
    for (year, month) in [(2026, 8), (2026, 9)] {
        cloud::open_period(pool, year, month)
            .await
            .unwrap_or_else(|error| panic!("period {year}-{month}: {error}"));
    }
}

async fn map(
    pool: &PgPool,
    key: &str,
    site: &str,
    qualifier: &str,
    code: &str,
    category: Option<&str>,
) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: site.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            category_code: category.map(str::to_string),
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
    for store in ["store-01", "store-02", "store-03"] {
        map(
            pool,
            "affiliate_receivable",
            "dc",
            &format!("PEMBIAYAAN:{store}"),
            "1501",
            Some("FINANCING"),
        )
        .await;
        map(
            pool,
            "affiliate_payable",
            store,
            "PEMBIAYAAN:dc",
            "1501",
            Some("FINANCING"),
        )
        .await;
    }
}

/// The goods column, which is where a stock movement between units lands.
///
/// The client keeps `Atas Barang` and `Pembiayaan` as separate families and
/// reconciles them separately, so a rule that merged them would produce one
/// balance neither side could agree. `kind_for_source` is what decides, and
/// mapping only these two here is what lets a test prove it decided right.
async fn map_affiliates_for_goods(pool: &PgPool) {
    for store in ["store-01", "store-02"] {
        map(
            pool,
            "affiliate_receivable",
            "dc",
            &format!("BARANG:{store}"),
            "1501",
            Some("GOODS"),
        )
        .await;
        map(
            pool,
            "affiliate_payable",
            store,
            "BARANG:dc",
            "1501",
            Some("GOODS"),
        )
        .await;
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
            category_code: "AIR_CONDITIONER".into(),
            site_id: site.into(),
            acquired_on: date(2026, 8, 1),
            serial_number: None,
            notes: None,
            acquired_via_line_id: None,
            quantity: None,
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
            category_code: None,
            rate_bps: None,
            charge_kind: Some("DEPRECIATION".into()),
            opening_accumulated_minor: None,
            opening_through: None,
            acquired_via_line_ids: None,
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
    map(
        &pool,
        "fixed_asset",
        "store-01",
        "AIR_CONDITIONER",
        "1601",
        Some("IN_SERVICE"),
    )
    .await;
    map(
        &pool,
        "fixed_asset",
        "store-02",
        "AIR_CONDITIONER",
        "1601",
        Some("IN_SERVICE"),
    )
    .await;

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
    assert_eq!(
        store_01.2, "1501",
        "one clearing account; the sign and the counterparty say the rest"
    );
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
    map(&pool, "non_merchandise_payable", "dc", "", "2101", None).await;

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
                account_code: "6301".into(),
                // PURBALINGGA's electricity, on head office's bill. The account
                // was `601011000103 Biaya Listrik PURBALINGGA`, which said both
                // what the cost was and whose it was; `6301` says neither, so
                // the category says the first and `site_id` the second.
                site_id: "store-03".into(),
                amount_minor: 1_000_000,
                memo: Some("listrik September".into()),
                asset_class_code: None,
                draws_reserve: false,
                category_code: Some("BIAYA_PEMAKAIAN_LISTRIK".into()),
            }]),
            matching: None,
            withholding_code: None,
            receipt_ids: None,
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
    map(
        &pool,
        "fixed_asset",
        "store-01",
        "AIR_CONDITIONER",
        "1601",
        Some("IN_SERVICE"),
    )
    .await;
    map(
        &pool,
        "fixed_asset",
        "store-02",
        "AIR_CONDITIONER",
        "1601",
        Some("IN_SERVICE"),
    )
    .await;

    let intent = |amount: i64| PostingIntent {
        posting_date: date(2026, 9, 3),
        source_kind: "TRANSFER".into(),
        source_id: Some("TRF-0001".into()),
        rule_version: "test/1".into(),
        currency: "IDR".into(),
        memo: Some("kirim barang".into()),
        lines: vec![
            PostingLine::credit("fixed_asset", "store-01", amount)
                .with_qualifier("AIR_CONDITIONER"),
            PostingLine::debit("fixed_asset", "store-02", amount).with_qualifier("AIR_CONDITIONER"),
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
        vec!["1501".to_string()],
        "the legs of a TRANSFER are interunit legs"
    );

    // And they are in the GOODS column, which is the assertion the four codes
    // above used to make by being four codes. Only BARANG is mapped in this
    // test, so a rule that had classed TRANSFER as financing would not have
    // posted at all — which is the strongest form this takes.
    let reasons: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT category_code FROM journal_line
          WHERE counter_site_id IS NOT NULL AND account_code = '1501'
          ORDER BY 1",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("reasons: {error}"));
    assert_eq!(
        reasons,
        vec!["GOODS".to_string()],
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

    // `1501` declares `interunit_reason` and requires a counterparty; `1601`
    // declares `asset_stage` since 0294, and a machine that is in use is
    // `IN_SERVICE`. The raw rows carry both correctly, because what is under
    // test is the PER-SITE balance trigger and a row refused by 0288's category
    // trigger never reaches it.
    for (line, site, debit, credit) in [(1, "store-01", 700, 0), (2, "dc", 0, 700)] {
        let (code, category, counter) = if site == "dc" {
            ("1501", Some("FINANCING"), Some("store-01"))
        } else {
            ("1601", Some("IN_SERVICE"), None)
        };
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, category_code,
                counter_site_id, debit_minor, credit_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(line)
        .bind(code)
        .bind(site)
        .bind(category)
        .bind(counter)
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
