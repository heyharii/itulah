//! A day's takings reaching the general ledger, proved against a real Postgres.
//!
//! The property these tests exist for is the second one: **posting a day twice
//! books it once**. Everything else here is arithmetic that can be read off the
//! code; that one is a race, it is enforced by a primary key taken inside the
//! same transaction as the journal entry, and the only way to know it holds is
//! to make it happen.
//!
//! The sales are inserted with raw SQL rather than rung up through
//! `create_sale`, deliberately. A sale at the centre needs a published
//! commercial version, a priced article and a movement group before it can
//! exist, and none of that is what is under test — what is under test is what
//! the posting rule does with rows that are already there, which is exactly the
//! shape it will meet in production.

use chrono::{NaiveDate, TimeZone, Utc};
use inventory_backend::cloud::postgres::{self as cloud, PostSaleDayRequest};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SHOP: &str = "store-03";

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

/// The client's chart, cut down to what a day's takings touch — and built on
/// their own ladder, because a balance in this estate rolls up by prefix and a
/// seed of leaves hanging off the roots would pass tests a real chart fails.
async fn seed_chart(pool: &PgPool) {
    let rungs: [(&str, &str, Option<&str>); 24] = [
        ("1", "ASSET", None),
        ("101", "CURRENT ASSET", Some("1")),
        ("10110", "KAS DAN BANK", Some("101")),
        ("1011001", "KAS", Some("10110")),
        ("1011001001", "Cash On Hand", Some("1011001")),
        ("10111", "PIUTANG", Some("101")),
        ("1011101", "PIUTANG DAGANG", Some("10111")),
        ("1011101001", "Piutang kartu Kredit", Some("1011101")),
        ("1011101002", "Piutang Debit Card", Some("1011101")),
        ("1011101003", "Piutang QRIS", Some("1011101")),
        ("1011101004", "Piutang Tender Lain-Lain", Some("1011101")),
        ("2", "LIABILITIES", None),
        ("205001", "Uang Muka - Penjualan", Some("2")),
        // Where the tax inside the price goes. The client has kept this
        // account all along — the collapsed chart of 0243 keeps it too — and
        // until 0249 no meaning pointed at it, so the whole gross was credited
        // to revenue and the liability was never recognised.
        ("2012101", "HUTANG PAJAK", Some("2")),
        ("2012101003", "Hutang  VAT PPN Keluaran", Some("2012101")),
        ("4", "PENDAPATAN", None),
        ("401", "PENJUALAN", Some("4")),
        ("40101", "PENJUALAN", Some("401")),
        ("4010114", "Penjualan Barang Dagangan", Some("40101")),
        ("4010114001", "Penjualan Barang Dagangan", Some("4010114")),
        ("6", "BEBAN OPERASIONAL", None),
        ("601", "BEBAN", Some("6")),
        ("60101", "BEBAN", Some("601")),
        ("6010110002", "Biaya Credit Card", Some("60101")),
    ];
    for (code, name, parent) in rungs {
        // `205001` is one of the client's two off-ladder codes and is a LEAF
        // even though it is short. Everything else short is a heading.
        let is_group = code != "205001";
        // `ON CONFLICT DO NOTHING` because 0243 writes a chart of its own and
        // the two share their upper rungs — and because a rung that is already
        // there is exactly as good as one this seed wrote.
        sqlx::query(
            "INSERT INTO ledger_account
               (account_code, name, parent_code, is_group, site_id, dimension)
             VALUES ($1,$2,$3,$4,NULL, CASE WHEN $4 THEN NULL ELSE 'company' END)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .bind(is_group)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    // The postable leaves. Their codes still end in Store 03's two digits, which
    // is where the client's own chart carried the unit; the ACCOUNT no longer
    // does, and the entry's lines carry it instead.
    for (code, name, parent) in [
        ("101100100103", "Cash On Hand C003", "1011001001"),
        ("101110100103", "Piutang kartu Kredit C003", "1011101001"),
        ("101110100203", "Piutang Debit Card C003", "1011101002"),
        ("101110100303", "Piutang QRIS C003", "1011101003"),
        ("101110100403", "Piutang Tender Lain-Lain C003", "1011101004"),
        ("201210100303", "Hutang  VAT PPN Keluaran C003", "2012101003"),
        (
            "401011400103",
            "Penjualan Barang Dagangan C003",
            "4010114001",
        ),
        ("601011000203", "Biaya Credit Card C003", "6010110002"),
    ] {
        // No `site_id` on the account. The unit is `journal_line.site_id`, and
        // 0244 added a CHECK that says so; `dimension` is what the new chart
        // uses to mean "this account is kept per unit".
        sqlx::query(
            "INSERT INTO ledger_account
               (account_code, name, parent_code, is_group, site_id, dimension)
             VALUES ($1,$2,$3,false,NULL,'unit') ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
}

async fn map(pool: &PgPool, key: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: SHOP.into(),
            qualifier: String::new(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}: {error}"));
}

/// Every meaning a day's takings resolve through, pointed at Store 03's own
/// leaves.
async fn map_the_shop(pool: &PgPool) {
    map(pool, "cash", "101100100103").await;
    map(pool, "card_receivable_debit", "101110100203").await;
    map(pool, "card_receivable_credit", "101110100103").await;
    map(pool, "qris_clearing", "101110100303").await;
    map(pool, "other_tender_clearing", "101110100403").await;
    map(pool, "voucher_liability", "205001").await;
    map(pool, "card_fee", "601011000203").await;
    map(pool, "revenue", "401011400103").await;
    map(pool, "output_tax", "201210100303").await;
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

/// One completed sale, with the tenders it was paid by.
///
/// `at` is the instant the till completed it, in UTC — which is what makes the
/// trading-day boundary testable: an evening sale in Jakarta is the afternoon
/// of the same UTC day, and a sale at 18:00 UTC is already tomorrow in the shop.
async fn ring_up(
    pool: &PgPool,
    at: chrono::DateTime<Utc>,
    total_minor: i64,
    change_minor: i64,
    tenders: &[(&str, Option<&str>, i64)],
) -> Uuid {
    ring_up_taxed(pool, at, total_minor, 0, change_minor, tenders).await
}

/// The same sale, with the PPN that was inside its price.
///
/// Two entry points rather than one with a tax argument everywhere, because
/// the tax is what a handful of these tests are ABOUT and noise in the rest.
/// `total_minor` is what the customer paid either way — the price is
/// tax-inclusive, so `net = total - tax` and the tax is never added on top,
/// which is the invariant every completed sale in the real books satisfies.
async fn ring_up_taxed(
    pool: &PgPool,
    at: chrono::DateTime<Utc>,
    total_minor: i64,
    tax_minor: i64,
    change_minor: i64,
    tenders: &[(&str, Option<&str>, i64)],
) -> Uuid {
    let publication: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM commercial_publication WHERE name = 'test book' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|error| panic!("publication: {error}"));
    let publication = match publication {
        Some(id) => id,
        None => {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO commercial_publication
                   (id, version, name, status, effective_from, created_by,
                    published_at, published_by)
                 SELECT $1, COALESCE(MAX(version), 0) + 1, 'test book', 'PUBLISHED',
                        $2, $3, $2, $3
                   FROM commercial_publication",
            )
            .bind(id)
            .bind(at)
            .bind(ACTOR)
            .execute(pool)
            .await
            .unwrap_or_else(|error| panic!("publication: {error}"));
            id
        }
    };

    let group = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO movement_group
           (id, cause, reason, actor_id, idempotency_key, payload_digest, occurred_at)
         VALUES ($1, 'SALE', 'sale', $2, $3, 'digest', $4)",
    )
    .bind(group)
    .bind(ACTOR)
    .bind(format!("group-{group}"))
    .bind(at)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("movement group: {error}"));

    let sale = Uuid::new_v4();
    let paid: i64 = tenders.iter().map(|(_, _, amount)| amount).sum();
    sqlx::query(
        "INSERT INTO sale
           (id, sale_number, site_id, channel, status, commercial_publication_id,
            commercial_version, currency, net_minor, tax_minor, total_minor, paid_minor,
            change_minor, movement_group_id, actor_id, idempotency_key, created_at, completed_at)
         VALUES ($1,$2,$3,'STORE','OPEN',$4,1,'IDR',$5-$12,$12,$5,$6,$7,$8,$9,$10,$11,NULL)",
    )
    .bind(sale)
    .bind(format!("S-{sale}"))
    .bind(SHOP)
    .bind(publication)
    .bind(total_minor)
    .bind(paid)
    .bind(change_minor)
    .bind(group)
    .bind(ACTOR)
    .bind(format!("sale-{sale}"))
    .bind(at)
    .bind(tax_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));

    // OPEN first, then the tenders, then completed — because `protect_sale_child`
    // refuses a tender appended to a sale that is already closed, which is the
    // same order a till puts them in.
    for (index, (method, card_kind, amount)) in tenders.iter().enumerate() {
        sqlx::query(
            "INSERT INTO sale_payment
               (id, sale_id, method, amount_minor, actor_id, idempotency_key, recorded_at, card_kind)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(Uuid::new_v4())
        .bind(sale)
        .bind(method)
        .bind(amount)
        .bind(ACTOR)
        .bind(format!("tender-{sale}-{index}"))
        .bind(at)
        .bind(card_kind)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("tender: {error}"));
    }
    sqlx::query("UPDATE sale SET status='COMPLETED', completed_at=$2 WHERE id=$1")
        .bind(sale)
        .bind(at)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("complete: {error}"));
    sale
}

/// Jakarta wall-clock, as an instant. WIB is UTC+7 and has no daylight saving.
fn wib(day: u32, hour: u32, minute: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, day, hour, minute, 0)
        .single()
        .unwrap_or_else(|| panic!("bad time"))
        - chrono::Duration::hours(7)
}

/// What one account moved by, over everything posted. Reads `journal_line`,
/// never a stored total — there is no stored total.
async fn moved(pool: &PgPool, account_code: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::bigint
           FROM journal_line WHERE account_code = $1",
    )
    .bind(account_code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance of {account_code}: {error}"))
}

/// Store 03's 1 September, as the seeded books actually hold it: four sales,
/// Rp 3,331,336, paid three ways.
async fn a_days_trade(pool: &PgPool) {
    ring_up(
        pool,
        wib(1, 10, 15),
        1_200_000,
        0,
        &[("CASH", None, 1_200_000)],
    )
    .await;
    ring_up(pool, wib(1, 13, 40), 900_000, 0, &[("CARD", None, 900_000)]).await;
    ring_up(
        pool,
        wib(1, 16, 5),
        631_336,
        0,
        &[("QRIS", None, 631_336)],
    )
    .await;
    // The evening sale, and the one that proves the day is the shop's: 21:20 in
    // Jakarta is 14:20 UTC, which is still the 1st either way — so this one
    // also carries the split tender and the change, which is where the
    // arithmetic can go wrong.
    ring_up(
        pool,
        wib(1, 21, 20),
        600_000,
        50_000,
        &[("CASH", None, 250_000), ("CARD", Some("CREDIT"), 400_000)],
    )
    .await;
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_day_reaches_the_general_ledger(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;

    let day = cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post the day: {error}"));

    assert_eq!(day.sales_count, 4);
    assert_eq!(day.gross_minor, 3_331_336);
    assert_eq!(day.cash_tendered_minor, 1_450_000);
    assert_eq!(day.change_minor, 50_000);
    assert!(day.entry_id.is_some(), "the day carries its entry");

    // The kind the schema has always allowed and nothing ever wrote.
    let kind: String = sqlx::query_scalar("SELECT source_kind FROM journal_entry WHERE entry_id=$1")
        .bind(day.entry_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("kind: {error}"));
    assert_eq!(kind, "SALE_DAY");

    // Revenue is what was SOLD, which is the tenders less the change.
    assert_eq!(moved(&pool, "401011400103").await, -3_331_336);
    // And the drawer holds what was handed over less what was handed back.
    assert_eq!(moved(&pool, "101100100103").await, 1_400_000);
}

/// The property this whole design turns on.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn posting_a_day_twice_books_it_once(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;

    let first = cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("first post: {error}"));
    let again = cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("second post: {error}"));

    // The same entry, not a second one — and the second caller is told which
    // entry it is rather than refused.
    assert_eq!(first.entry_id, again.entry_id);
    assert_eq!(first.entry_number, again.entry_number);

    let entries: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry WHERE source_kind='SALE_DAY'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(entries, 1, "a second entry would double the day's income");

    // And nothing moved twice. This is the assertion that would have caught a
    // re-post that wrote a second balanced entry: the trial balance would still
    // balance, and revenue would be twice the truth.
    assert_eq!(moved(&pool, "401011400103").await, -3_331_336);
    assert_eq!(moved(&pool, "101100100103").await, 1_400_000);
}

/// The guarantee is the database's, not this function's — so reach past the
/// rule and try to write the second entry by hand.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_database_refuses_a_second_entry_for_one_day(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;
    cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    let forged = sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, rule_version,
            total_minor, currency, posted_by)
         VALUES ($1, 'JV-FORGED', '2026-09-01', 'SALE_DAY', $2, 'by hand', 1, 'IDR', 'mallory')",
    )
    .bind(Uuid::new_v4())
    .bind(format!("{SHOP}:2026-09-01"))
    .execute(&pool)
    .await;
    assert!(
        forged.is_err(),
        "a second SALE_DAY entry for one day must be impossible even by hand"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_tender_lands_on_its_own_account_and_the_fee_on_the_fee(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;

    // One sale of each kind, so every leg has a figure nobody else could have
    // produced.
    ring_up(&pool, wib(2, 9, 0), 100_000, 0, &[("CASH", None, 100_000)]).await;
    ring_up(
        &pool,
        wib(2, 10, 0),
        200_000,
        0,
        &[("CARD", Some("DEBIT"), 200_000)],
    )
    .await;
    ring_up(
        &pool,
        wib(2, 11, 0),
        400_000,
        0,
        &[("CARD", Some("CREDIT"), 400_000)],
    )
    .await;
    ring_up(&pool, wib(2, 12, 0), 800_000, 0, &[("QRIS", None, 800_000)]).await;
    // No VOUCHER tender here, and not because the rule cannot book one — it
    // posts to `voucher_liability`, which is mapped above. `sale_payment`'s
    // method CHECK on a database built from these migrations is
    // ('CASH','CARD','QRIS','OTHER'): VOUCHER was widened onto the dev database
    // out of band, the same drift `card_kind` had, and no migration on this
    // branch adds it. Ringing one up here would test the drift, not the rule.
    ring_up(
        &pool,
        wib(2, 14, 0),
        3_200_000,
        0,
        &[("OTHER", None, 3_200_000)],
    )
    .await;
    // And one card that never said which kind it was, which is every card in
    // the seeded books.
    ring_up(&pool, wib(2, 15, 0), 64_000, 0, &[("CARD", None, 64_000)]).await;

    let day = cloud::post_sale_day(
        &pool,
        SHOP,
        september(2),
        &PostSaleDayRequest {
            card_debit_fee_minor: 5_000,
            card_credit_fee_minor: 8_000,
            qris_fee_minor: 6_000,
            utc_offset_minutes: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    assert_eq!(day.card_debit_minor, 200_000);
    assert_eq!(day.card_credit_minor, 400_000);
    assert_eq!(day.card_unattributed_minor, 64_000);

    assert_eq!(moved(&pool, "101100100103").await, 100_000, "cash");
    // Debit card, plus the card that did not say, less the debit fee.
    assert_eq!(
        moved(&pool, "101110100203").await,
        200_000 + 64_000 - 5_000,
        "debit card receivable"
    );
    assert_eq!(
        moved(&pool, "101110100103").await,
        400_000 - 8_000,
        "credit card receivable"
    );
    assert_eq!(moved(&pool, "101110100303").await, 800_000 - 6_000, "QRIS");
    assert_eq!(moved(&pool, "205001").await, 0, "no voucher was presented");
    assert_eq!(moved(&pool, "101110100403").await, 3_200_000, "other tender");
    assert_eq!(
        moved(&pool, "601011000203").await,
        5_000 + 8_000 + 6_000,
        "the acquirer's and the provider's cut"
    );
    // Revenue is the gross, undiminished by the fees: a fee is an expense of
    // taking the money, not a discount on what was sold.
    assert_eq!(moved(&pool, "401011400103").await, -4_764_000);
}

/// The unit dimension is not optional. A line without one cannot be reconciled
/// against any shop's own trial balance, and the client's is read per unit.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_line_carries_its_unit(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;
    let day = cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    let rows = sqlx::query(
        "SELECT line_number, site_id FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(day.entry_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"));
    assert!(!rows.is_empty(), "an entry with no lines is not an entry");
    for row in &rows {
        let site: String = row.try_get("site_id").unwrap_or_else(|e| panic!("site: {e}"));
        assert_eq!(site, SHOP, "line {:?}", row.try_get::<i32, _>("line_number"));
    }
}

/// A drawer that is short, booked — the thing that refused before this work.
///
/// `cash_variance` was named by `cash_counts.rs` and declared nowhere, so the
/// Account Map never listed it, nobody was ever asked to set it, and the first
/// person to book a short drawer met a refusal naming a meaning they had never
/// seen. Two things are asserted: that the meaning is now something the map
/// asks for, and that a short drawer posts once it is set.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_short_drawer_posts_its_variance_against_the_day(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;
    cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post the day: {error}"));

    // The map now asks for it. This is the defect itself: an unmapped meaning
    // is a gap somebody can see, an UNDECLARED one is not.
    assert!(
        cloud::required_semantic_keys()
            .iter()
            .any(|doc| doc.key == "cash_variance"),
        "the Account Map has to ask for cash_variance, or nobody ever sets it"
    );

    // Somewhere for the difference to go, and a drawer 25,000 short of the
    // 1,400,000 the day's entry says is in it.
    sqlx::query(
        "INSERT INTO ledger_account
           (account_code, name, parent_code, is_group, site_id, dimension)
         VALUES ('8010110007','Pendapatan (Biaya) Lain-Lain','8',true,NULL,NULL),
                ('801011000703','Pendapatan (Biaya) Lain-Lain C003','8010110007',false,NULL,'unit')
         ON CONFLICT (account_code) DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("variance account: {error}"));
    map(&pool, "cash_variance", "801011000703").await;

    let count = cloud::record_count(
        &pool,
        &cloud::RecordCountRequest {
            account_code: "101100100103".into(),
            site_id: SHOP.into(),
            counted_on: september(1),
            counted_by: "siti".into(),
            witnessed_by: "budi".into(),
            counted_minor: 1_375_000,
            reason: "a note went missing between the till and the safe".into(),
            notes: Vec::new(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record the count: {error}"));
    assert_eq!(
        count.per_books_minor, 1_400_000,
        "the books know what the day's entry put in the drawer"
    );
    assert_eq!(count.variance_minor, -25_000);

    let posted = cloud::post_variance(
        &pool,
        count.count_id,
        &cloud::PostCountRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post the variance: {error}"));
    assert!(posted.entry_id.is_some());

    // The drawer now says what was counted, and the difference has a home.
    assert_eq!(moved(&pool, "101100100103").await, 1_375_000);
    assert_eq!(moved(&pool, "801011000703").await, 25_000);
}

/// The day belongs to the shop, not to the node.
///
/// A sale completed at 23:30 in Jakarta is 16:30 UTC on the same date, and a
/// sale at 00:30 in Jakarta is 17:30 UTC on the PREVIOUS one. Dating by the UTC
/// calendar would move the second one's takings into yesterday.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_trading_day_is_the_shops_day(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;

    ring_up(&pool, wib(3, 23, 30), 700_000, 0, &[("CASH", None, 700_000)]).await;
    // 00:30 on the 4th in Jakarta — 17:30 UTC on the 3rd.
    ring_up(&pool, wib(4, 0, 30), 300_000, 0, &[("CASH", None, 300_000)]).await;

    let third = cloud::post_sale_day(
        &pool,
        SHOP,
        september(3),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post the 3rd: {error}"));
    assert_eq!(third.gross_minor, 700_000, "the late sale is still the 3rd");

    let fourth = cloud::post_sale_day(
        &pool,
        SHOP,
        september(4),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post the 4th: {error}"));
    assert_eq!(
        fourth.gross_minor, 300_000,
        "the sale after midnight belongs to the new day"
    );
}

/// The list is built from the SALES, so it can say what is NOT in the book.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_list_says_what_the_books_have_not_heard_about(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;
    ring_up(&pool, wib(2, 11, 0), 500_000, 0, &[("QRIS", None, 500_000)]).await;

    let before = cloud::sale_days(&pool, cloud::SaleDayScope::default())
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(before.total, 2);
    assert_eq!(before.posted, 0);
    assert_eq!(before.unposted, 2);
    assert_eq!(before.unposted_gross_minor, 3_331_336 + 500_000);
    // An unposted day still shows its tender split, which is what somebody
    // decides from before they post it.
    let first = before
        .rows
        .iter()
        .find(|row| row.trading_day == september(1))
        .unwrap_or_else(|| panic!("the 1st is in the list"));
    assert_eq!(first.cash_tendered_minor, 1_450_000);
    assert_eq!(first.qris_minor, 631_336);
    assert!(first.entry_id.is_none());

    cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    let after = cloud::sale_days(&pool, cloud::SaleDayScope::default())
        .await
        .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(after.posted, 1);
    assert_eq!(after.unposted, 1);
    assert_eq!(after.unposted_gross_minor, 500_000);

    // And it can be asked for one side.
    let outstanding = cloud::sale_days(
        &pool,
        cloud::SaleDayScope {
            posted: Some(false),
            ..cloud::SaleDayScope::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("list: {error}"));
    assert_eq!(outstanding.rows.len(), 1);
    assert_eq!(outstanding.rows[0].trading_day, september(2));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_day_that_sold_nothing_refuses_rather_than_posting_an_empty_entry(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;

    let refusal = cloud::post_sale_day(
        &pool,
        SHOP,
        september(9),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .expect_err("a day with no sales has nothing to post");
    assert!(
        refusal.to_string().contains("nothing to post"),
        "the refusal should say why: {refusal}"
    );
}

/// A fee bigger than the takings it is charged on is a keying mistake, and it
/// is refused before anything is written rather than posting a negative debit.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_fee_larger_than_the_tender_is_refused(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;
    a_days_trade(&pool).await;

    let refusal = cloud::post_sale_day(
        &pool,
        SHOP,
        september(1),
        &PostSaleDayRequest {
            qris_fee_minor: 999_999_999,
            ..PostSaleDayRequest::default()
        },
        ACTOR,
    )
    .await
    .expect_err("a fee cannot exceed what was taken that way");
    assert!(refusal.to_string().contains("QRIS fee"), "{refusal}");

    let entries: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM journal_entry WHERE source_kind='SALE_DAY'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(entries, 0, "nothing may be written by a refused posting");
}

/// When the owner decides the chart's per-tender split is the one to keep, that
/// decision is a row on the Account Map and not a change to this rule.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn revenue_splits_per_tender_when_somebody_has_said_it_should(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;

    // The client's own per-tender leaves, at this shop.
    sqlx::query(
        "INSERT INTO ledger_account
           (account_code, name, parent_code, is_group, site_id, dimension)
         VALUES ('4010110','Penjualan Tunai','40101',true,NULL,NULL),
                ('4010110001','Penjualan Tunai','4010110',true,NULL,NULL),
                ('401011000103','Penjualan Tunai C003','4010110001',false,NULL,'unit')
         ON CONFLICT (account_code) DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("tender revenue: {error}"));
    for qualifier in ["CASH", "CARD_DEBIT", "CARD_CREDIT", "QRIS", "VOUCHER", "OTHER"] {
        cloud::set_account_mapping(
            &pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: "revenue".into(),
                site_id: SHOP.into(),
                qualifier: qualifier.into(),
                // One account for all six here only because this chart has one;
                // the point under test is that the QUALIFIER is honoured.
                account_code: "401011000103".into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map revenue/{qualifier}: {error}"));
    }

    ring_up(&pool, wib(5, 9, 0), 100_000, 0, &[("CASH", None, 100_000)]).await;
    ring_up(&pool, wib(5, 10, 0), 250_000, 0, &[("QRIS", None, 250_000)]).await;

    let day = cloud::post_sale_day(
        &pool,
        SHOP,
        september(5),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    // Two credit lines rather than one, and the plain binding untouched.
    let credits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_line
          WHERE entry_id = $1 AND credit_minor > 0",
    )
    .bind(day.entry_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("credits: {error}"));
    assert_eq!(credits, 2, "one credit per tender the day took");
    assert_eq!(moved(&pool, "401011000103").await, -350_000);
    assert_eq!(moved(&pool, "401011400103").await, 0);
}

/// The tax was already in the price, so it comes out of the credit.
///
/// This is the defect `sale_day/1` had for its whole life: it credited the
/// day's GROSS to revenue and posted no tax line at all, so the books
/// recognised more income than the till's own net by exactly the PPN, and
/// nothing was owed to anybody for it. Indonesian retail prices are
/// tax-INCLUSIVE — `total_minor = net_minor + tax_minor` on every completed
/// sale — so the correction is a subtraction from the credit and not an
/// addition to the debit: the money that arrived did not change.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_tax_inside_the_price_is_owed_and_not_earned(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;

    // Rp 1,110,000 over the counter, of which Rp 110,000 is PPN.
    ring_up_taxed(
        &pool,
        wib(6, 10, 0),
        1_110_000,
        110_000,
        0,
        &[("CASH", None, 1_110_000)],
    )
    .await;
    // And one paid by card, so the split is not an artefact of a single tender.
    ring_up_taxed(
        &pool,
        wib(6, 14, 0),
        555_000,
        55_000,
        0,
        &[("CARD", Some("DEBIT"), 555_000)],
    )
    .await;

    let day = cloud::post_sale_day(
        &pool,
        SHOP,
        september(6),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    // The day is still worth what the customers paid.
    assert_eq!(day.gross_minor, 1_665_000);

    // The debits are untouched: every rupiah that arrived is still on the
    // account it arrived in.
    assert_eq!(moved(&pool, "101100100103").await, 1_110_000, "the drawer");
    assert_eq!(
        moved(&pool, "101110100203").await,
        555_000,
        "the card receivable"
    );

    // The credit is what moved. Revenue is the NET, and the tax office's share
    // is a liability — a credit, hence negative through `moved`.
    assert_eq!(
        moved(&pool, "401011400103").await,
        -1_500_000,
        "revenue is the day net of the tax inside its prices"
    );
    assert_eq!(
        moved(&pool, "201210100303").await,
        -165_000,
        "and the PPN is owed"
    );

    // Which is the whole point: the two add back to the gross, so nothing
    // went missing on the way.
    assert_eq!(1_500_000 + 165_000, day.gross_minor);

    // And the entry says which rule wrote it, so a day posted by the old one
    // can be told apart without reading its lines.
    let rule: String = sqlx::query_scalar("SELECT rule_version FROM journal_entry WHERE entry_id=$1")
        .bind(day.entry_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("rule: {error}"));
    assert_eq!(rule, "sale_day/2");

    // The Account Map has to ASK for the meaning, or nobody ever sets it and
    // the refusal names a key they have never seen — the lesson 0238 wrote
    // down about `cash_variance`.
    assert!(
        cloud::required_semantic_keys()
            .iter()
            .any(|doc| doc.key == "output_tax"),
        "output_tax has to be a meaning the Account Map lists"
    );
}

/// A day whose revenue is split per tender still adds back to the day.
///
/// There is no per-tender tax to read and there cannot be: the tax belongs to
/// the SALE and the tender split belongs to the PAYMENTS, and one sale can be
/// paid two ways. So the NET is apportioned, and the property that matters is
/// that the shares add back exactly — a rounding rule that lost a rupiah would
/// not produce a wrong number, it would produce a day that refuses to post.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_split_revenue_still_adds_back_to_the_day_net_of_its_tax(pool: PgPool) {
    seed_chart(&pool).await;
    map_the_shop(&pool).await;
    open_september(&pool).await;

    sqlx::query(
        "INSERT INTO ledger_account
           (account_code, name, parent_code, is_group, site_id, dimension)
         VALUES ('4010110','Penjualan Tunai','40101',true,NULL,NULL),
                ('4010110001','Penjualan Tunai','4010110',true,NULL,NULL),
                ('401011000103','Penjualan Tunai C003','4010110001',false,NULL,'unit')
         ON CONFLICT (account_code) DO NOTHING",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("tender revenue: {error}"));
    for qualifier in ["CASH", "CARD_DEBIT", "CARD_CREDIT", "QRIS", "VOUCHER", "OTHER"] {
        cloud::set_account_mapping(
            &pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: "revenue".into(),
                site_id: SHOP.into(),
                qualifier: qualifier.into(),
                account_code: "401011000103".into(),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map revenue/{qualifier}: {error}"));
    }

    // Amounts chosen so the apportionment does NOT divide evenly: whatever the
    // six shares round to, they have to add back to the net exactly or the
    // entry will not balance and this test will not get an entry at all.
    ring_up_taxed(
        &pool,
        wib(7, 9, 0),
        100_001,
        9_910,
        0,
        &[("CASH", None, 100_001)],
    )
    .await;
    ring_up_taxed(
        &pool,
        wib(7, 10, 0),
        250_003,
        24_773,
        0,
        &[("QRIS", None, 250_003)],
    )
    .await;

    let day = cloud::post_sale_day(
        &pool,
        SHOP,
        september(7),
        &PostSaleDayRequest::default(),
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("post: {error}"));

    let gross = 100_001 + 250_003;
    let tax = 9_910 + 24_773;
    assert_eq!(day.gross_minor, gross);
    assert_eq!(
        moved(&pool, "401011000103").await,
        -(gross - tax),
        "the tender shares add back to the day's net"
    );
    assert_eq!(moved(&pool, "201210100303").await, -tax);

    // One tax line however many revenue lines there are: the PPN is one
    // liability owed to one tax office, and which tender it came in through is
    // a fact about the debits.
    let tax_lines: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_line
          WHERE entry_id = $1 AND account_code = '201210100303'",
    )
    .bind(day.entry_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("tax lines: {error}"));
    assert_eq!(tax_lines, 1);

    // And no share came out negative, which is what apportioning the NET
    // rather than the tax is for.
    let negative: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_line
          WHERE entry_id = $1 AND (debit_minor < 0 OR credit_minor < 0)",
    )
    .bind(day.entry_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("negatives: {error}"));
    assert_eq!(negative, 0);
}

/// QRIS has a receivable of its own, and it is ONE account.
///
/// 0238 gave QRIS and the unnamed tender clearing accounts; 0244 collapsed the
/// chart against a fixture derived before 0238 existed, knew no QRIS meaning,
/// and folded both onto `1011101002 Piutang Kartu Debit` — so for six days a
/// QRIS sale and a debit-card sale were the same row in the ledger and no
/// QRIS settlement report had an account to reconcile against. 0248 undoes it.
///
/// One account per meaning and no per-unit copies: the unit is
/// `journal_line.site_id`, which is what 0243 and 0244 were for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn qris_has_a_receivable_of_its_own_and_only_one(pool: PgPool) {
    let rows = sqlx::query(
        "SELECT account_code, name, parent_code, is_group, dimension, site_id
           FROM ledger_account
          WHERE account_code IN ('1011101002','1011101003','1011101004')
          ORDER BY account_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("the receivables: {error}"));
    assert_eq!(
        rows.len(),
        3,
        "card, QRIS and the unnamed tender are three accounts and not one"
    );
    // All three on the same rung, whatever rung the chart has the card on.
    // 0247 moved the card receivable from `10111 Piutang` down onto `1011101
    // Piutang Dagang`, and QRIS is its sibling either way.
    let card_parent: String = rows[0].get("parent_code");
    for row in &rows {
        let code: String = row.get("account_code");
        assert_eq!(
            row.get::<String, _>("parent_code"),
            card_parent,
            "{code} sits beside the card receivable"
        );
        assert!(!row.get::<bool, _>("is_group"), "{code} takes postings");
        assert_eq!(
            row.get::<Option<String>, _>("dimension").as_deref(),
            Some("unit"),
            "{code} is kept per unit"
        );
        assert!(
            row.get::<Option<String>, _>("site_id").is_none(),
            "{code} names no unit; the line does"
        );
    }
    assert_eq!(rows[1].get::<String, _>("name"), "Piutang QRIS");
    assert_eq!(
        rows[2].get::<String, _>("name"),
        "Piutang Tender Lain-Lain"
    );

    // And not fourteen leaves under two groups, which is how 0238 built them
    // and what 0243/0244 abolished.
    let copies: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM ledger_account
          WHERE (account_code LIKE '1011101003%' OR account_code LIKE '1011101004%')
            AND account_code NOT IN ('1011101003','1011101004')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("copies: {error}"));
    assert_eq!(copies, 0, "one account per meaning, no per-unit copies");

    // The map of the old chart no longer says QRIS became a card, which is
    // where anybody comparing this year's figure with last year's will look.
    let stale: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM ledger_account_remap
          WHERE left(legacy_code, 10) IN ('1011101003','1011101004')
            AND new_code = '1011101002'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("remap: {error}"));
    assert_eq!(stale, 0, "0244's judgement has been taken back");
}
