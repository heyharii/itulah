//! A day of takings, from the till's rows to the general ledger.
//!
//! These run against a real Postgres because most of what is asserted is
//! enforced there: the entry balances because a deferred constraint trigger
//! says so, the day is unique because a unique key says so, and a posted
//! document cannot be regenerated over because a status check says so. A test
//! that stubbed the database would prove that the Rust agrees with itself.
//!
//! The sales are inserted as raw rows rather than pushed through sync. That is
//! deliberate: what is under test is the posting rule, and going through the
//! ingest path would make every one of these tests also a test of the sync
//! contract — so a change to either would turn both red and neither message
//! would say which.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use inventory_backend::cloud::postgres::{self as cloud, GenerateSalesPostingRequest};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SITE: &str = "store-01";

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date"))
}

/// Noon at the shop, which is 05:00 UTC. Comfortably inside the business day
/// however the window is rounded, so these tests do not also test the boundary
/// — `a_sale_after_midnight_wib_belongs_to_the_shops_day` does that.
fn midday() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 15, 5, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("bad instant"))
}

/// A chart small enough to read, shaped like the client's, and carrying every
/// leaf a day of takings can touch.
///
/// The ladder is root → ten-digit rung → twelve-digit location leaf, because
/// the client's codes ARE the tree and a balance rolls up by prefix. The
/// suffix `01` is store 01, the same reading `import-coa.py` uses.
async fn seed_chart(pool: &PgPool) {
    for (code, name) in [
        ("1", "ASSET"),
        ("2", "LIABILITIES"),
        ("4", "PENDAPATAN"),
        ("8", "BEBAN NON OPERASIONAL"),
    ] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,NULL,true)",
        )
        .bind(code)
        .bind(name)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }

    // (rung, leaf, name). The rung is the client's own ten-digit account; the
    // leaf is that account at store 01.
    let accounts: [(&str, &str, &str); 13] = [
        ("1011001001", "101100100101", "Cash On Hand C001"),
        ("1011101001", "101110100101", "Piutang kartu Kredit C001"),
        ("1011101002", "101110100201", "Piutang Debit Card C001"),
        ("1011101003", "101110100301", "Piutang QRIS C001"),
        ("2012101003", "201210100301", "Hutang PPN Keluaran C001"),
        ("2012305001", "201230500101", "Hutang Voucher C001"),
        ("4010110001", "401011000101", "Penjualan Tunai C001"),
        ("4010111001", "401011100101", "Penjualan Debit BCA C001"),
        (
            "4010112001",
            "401011200101",
            "Penjualan Kartu Kredit VISA C001",
        ),
        ("4010113001", "401011300101", "Penjualan QRIS C001"),
        ("4010213001", "401021300101", "Potongan Penjualan C001"),
        ("4010214001", "401021400101", "Retur Penjualan C001"),
        ("8010110002", "801011000201", "Selisih pembulatan C001"),
    ];
    for (rung, leaf, name) in accounts {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING",
        )
        .bind(rung)
        .bind(name)
        .bind(&rung[..1])
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{rung}: {error}"));
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,false,$4)",
        )
        .bind(leaf)
        .bind(name)
        .bind(rung)
        .bind(SITE)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{leaf}: {error}"));
    }
}

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: SITE.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}/{qualifier}: {error}"));
}

/// Every meaning a mixed day needs, mapped the way `seed-finance.py` maps
/// them: the receivables and the card income accounts per acquirer, the rest
/// plain.
async fn map_everything(pool: &PgPool) {
    for (key, code) in [
        ("cash", "101100100101"),
        ("vat_out", "201210100301"),
        ("voucher_liability", "201230500101"),
        ("revenue_cash", "401011000101"),
        ("revenue_qris", "401011300101"),
        ("sales_discount", "401021300101"),
        ("sales_return", "401021400101"),
        ("rounding", "801011000201"),
    ] {
        map(pool, key, "", code).await;
    }
    map(pool, "card_receivable_debit", "BCA", "101110100201").await;
    map(pool, "card_receivable_debit", "MANDIRI", "101110100201").await;
    map(pool, "card_receivable_credit", "VISA", "101110100101").await;
    map(pool, "revenue_debit", "BCA", "401011100101").await;
    map(pool, "revenue_credit", "VISA", "401011200101").await;
    map(pool, "qris_receivable", "GOPAY", "101110100301").await;
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

/// One completed sale as a shop synced it, with one tender behind it.
///
/// Returns the tender's id, which is what a retender is performed on.
#[allow(clippy::too_many_arguments)]
async fn synced_sale(
    pool: &PgPool,
    occurred_at: DateTime<Utc>,
    total_minor: i64,
    change_minor: i64,
    discount_minor: i64,
    method: &str,
    acquirer: Option<&str>,
    card_kind: Option<&str>,
) -> Uuid {
    let sale_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_sale
           (sale_id, origin_id, generation, seq, movement_group_id, site_id, actor_id,
            occurred_at, currency, total_minor, paid_minor, change_minor,
            discount_total_minor)
         VALUES ($1,'store-edge-01',1,nextval('journal_entry_number_seq'),$2,$3,'kasir',
                 $4,'IDR',$5,$6,$7,$8)",
    )
    .bind(sale_id)
    .bind(Uuid::new_v4())
    .bind(SITE)
    .bind(occurred_at)
    .bind(total_minor)
    .bind(total_minor + change_minor)
    .bind(change_minor)
    .bind(discount_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));

    let tender_id: Uuid = sqlx::query(
        "INSERT INTO edge_sale_tender
           (sale_id, tender_seq, method, amount_minor, acquirer, card_kind)
         VALUES ($1,0,$2,$3,$4,$5) RETURNING tender_id",
    )
    .bind(sale_id)
    .bind(method)
    .bind(total_minor + change_minor)
    .bind(acquirer)
    .bind(card_kind)
    .execute_returning(pool)
    .await;
    tender_id
}

/// `RETURNING` through sqlx's untyped query API, kept out of the way of the
/// tests that use it.
trait FetchTenderId {
    async fn execute_returning(self, pool: &PgPool) -> Uuid;
}

impl FetchTenderId for sqlx::query::Query<'_, sqlx::Postgres, sqlx::postgres::PgArguments> {
    async fn execute_returning(self, pool: &PgPool) -> Uuid {
        self.fetch_one(pool)
            .await
            .unwrap_or_else(|error| panic!("tender: {error}"))
            .try_get("tender_id")
            .unwrap_or_else(|error| panic!("tender id: {error}"))
    }
}

/// The five tenders of an ordinary Tuesday.
///
/// Cash carries the change and the promotion, so the arithmetic every other
/// test leans on is exercised in one place: the drawer is the tender less the
/// change, and the discount is grossed back up across every bucket.
async fn an_ordinary_tuesday(pool: &PgPool) {
    synced_sale(
        pool,
        midday(),
        1_110_000,
        90_000,
        111_000,
        "CASH",
        None,
        None,
    )
    .await;
    synced_sale(
        pool,
        midday(),
        2_220_000,
        0,
        0,
        "CARD",
        Some("BCA"),
        Some("DEBIT"),
    )
    .await;
    synced_sale(
        pool,
        midday(),
        3_330_000,
        0,
        0,
        "CARD",
        Some("VISA"),
        Some("CREDIT"),
    )
    .await;
    synced_sale(pool, midday(), 555_000, 0, 0, "QRIS", Some("GOPAY"), None).await;
    synced_sale(pool, midday(), 200_000, 0, 0, "VOUCHER", None, None).await;
}

fn ask() -> GenerateSalesPostingRequest {
    GenerateSalesPostingRequest {
        site_id: SITE.into(),
        business_date: day(),
    }
}

/// What one account holds, at one location, over everything posted.
async fn balance(pool: &PgPool, code: &str) -> (i64, i64) {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(debit_minor),0)::bigint AS d,
                COALESCE(SUM(credit_minor),0)::bigint AS c
           FROM journal_line WHERE account_code = $1",
    )
    .bind(code)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("balance {code}: {error}"));
    (
        row.try_get("d").unwrap_or_else(|e| panic!("{e}")),
        row.try_get("c").unwrap_or_else(|e| panic!("{e}")),
    )
}

// ---------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_mixed_day_becomes_one_balanced_entry(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    an_ordinary_tuesday(&pool).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));

    // Charged to customers, and what the drawer and the acquirers between them
    // are owed. Equal, because every sale said how it settled.
    assert_eq!(document.posting.gross_minor, 7_415_000);
    assert_eq!(document.posting.settled_minor, 7_415_000);
    assert_eq!(document.posting.untendered_minor, 0);
    assert_eq!(document.posting.discount_minor, 111_000);
    assert_eq!(document.posting.sale_count, 5);
    assert_eq!(document.posting.vat_rate_bps, 1_100);
    assert_eq!(document.posting.status, "DRAFT");
    assert_eq!(
        document.lines.len(),
        5,
        "one line per way the money settled"
    );

    let posted = cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(posted.posting.status, "POSTED");

    // One entry, and it is the day's.
    let entries = sqlx::query(
        "SELECT entry_id, source_kind, source_id, total_minor, rule_version, posting_date
           FROM journal_entry",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("entries: {error}"));
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.get::<String, _>("source_kind"), "SALE_DAY");
    assert_eq!(
        entry.get::<Option<String>, _>("source_id"),
        Some(document.posting.posting_id.to_string()),
        "the entry has to lead back to the document it summarises"
    );
    assert_eq!(entry.get::<String, _>("rule_version"), "sale_day/1");
    assert_eq!(entry.get::<NaiveDate, _>("posting_date"), day());
    // Every debit: the five tenders' takings plus the promotion grossed back
    // up. The trigger has already checked the credits match.
    assert_eq!(entry.get::<i64, _>("total_minor"), 7_526_000);

    let trial = cloud::trial_balance(&pool, day(), None)
        .await
        .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(trial.balanced, "a day of takings has to balance");

    // The drawer holds the cash tender less the change handed back, which is
    // the figure a shop counts at close.
    assert_eq!(balance(&pool, "101100100101").await.0, 1_110_000);
    // The acquirers, each under their own qualifier.
    assert_eq!(balance(&pool, "101110100201").await.0, 2_220_000);
    assert_eq!(balance(&pool, "101110100101").await.0, 3_330_000);
    assert_eq!(balance(&pool, "101110100301").await.0, 555_000);
    // A voucher settles a liability the shop has been carrying; it brings no
    // money in today.
    assert_eq!(balance(&pool, "201230500101").await.0, 200_000);
    // PPN inside each bucket, summed. 11% of the tax-exclusive part.
    assert_eq!(balance(&pool, "201210100301").await.1, 734_819);
    // Contra revenue: what the promotion cost, visible rather than netted
    // silently off the sale.
    assert_eq!(balance(&pool, "401021300101").await.0, 111_000);
    // And income in four places, because that is how the client reads it.
    for code in [
        "401011000101",
        "401011100101",
        "401011200101",
        "401011300101",
    ] {
        assert!(
            balance(&pool, code).await.1 > 0,
            "{code} should carry this day's income"
        );
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn generating_twice_replaces_the_draft_rather_than_adding_one(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    an_ordinary_tuesday(&pool).await;

    let first = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    let second = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("regenerate: {error}"));

    assert_eq!(
        first.posting.posting_id, second.posting.posting_id,
        "a day has one document, not one per generation"
    );
    assert_eq!(first.posting.gross_minor, second.posting.gross_minor);
    assert_eq!(first.lines.len(), second.lines.len());

    let documents: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM sales_posting")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(documents, 1);
    let lines: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM sales_posting_line")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(lines, 5, "the working paper is rebuilt, not appended to");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_posted_day_refuses_to_be_posted_or_regenerated(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    an_ordinary_tuesday(&pool).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let again = cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR).await;
    let message = match again {
        Ok(_) => panic!("posted the same day twice"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("already posted"),
        "the refusal should say the day is already in the books, said: {message}"
    );

    // And regeneration is refused too, because the entry quoting it cannot
    // move. The message has to name the way out.
    let regenerated = cloud::sales_posting_generate(&pool, &ask(), ACTOR).await;
    let message = match regenerated {
        Ok(_) => panic!("regenerated over a posted day"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("reversing"),
        "the refusal should point at reversal, said: {message}"
    );

    let entries: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(entries, 1, "nothing should have been written twice");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn reversing_a_day_lets_it_be_generated_again(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    an_ordinary_tuesday(&pool).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let reversed = cloud::sales_posting_reverse(
        &pool,
        document.posting.posting_id,
        &cloud::ReverseSalesPostingRequest {
            reason: "the QRIS provider was wrong".into(),
            posting_date: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("reverse: {error}"));
    assert_eq!(reversed.posting.status, "REVERSED");
    assert!(reversed.posting.reversal_entry_id.is_some());

    // Both entries stay, and together they come to nothing. The accounts do
    // NOT drop off the trial balance — it lists anything that moved, and both
    // halves moved — so what has to hold is that every one of them nets to
    // zero. That is the stronger statement anyway: an account that vanished
    // would only prove it was never touched.
    let trial = cloud::trial_balance(&pool, day(), None)
        .await
        .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(trial.balanced);
    assert_eq!(trial.total_debit_minor, trial.total_credit_minor);
    for row in &trial.rows {
        assert_eq!(
            row.debit_minor, row.credit_minor,
            "{} should carry nothing after the reversal, said: {row:?}",
            row.account_code
        );
    }

    // And the day can be built afresh, which is the second half of the only
    // correction path this ledger has. A reversed day that could not be
    // regenerated would be a day posted once and wrong forever.
    let fresh = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("a reversed day should be generatable again: {error}"));
    assert_eq!(fresh.posting.posting_id, document.posting.posting_id);
    assert_eq!(fresh.posting.status, "DRAFT");
    assert!(fresh.posting.journal_entry_id.is_none());
    assert!(fresh.posting.reversal_entry_id.is_none());

    // And posted again, for real.
    let reposted = cloud::sales_posting_post(&pool, fresh.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("repost: {error}"));
    assert_eq!(reposted.posting.status, "POSTED");

    // Three entries now — the original, its reversal, and the correction — and
    // all three lead back to this document. That is where the history of a
    // corrected day lives: the working paper only ever shows the current
    // answer, and the journal shows how it was arrived at.
    let entries: i64 = sqlx::query(
        "SELECT COUNT(*)::bigint AS n FROM journal_entry
          WHERE source_kind = 'SALE_DAY' AND source_id = $1",
    )
    .bind(document.posting.posting_id.to_string())
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
    .try_get("n")
    .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(entries, 2, "the original and its replacement");

    // The books carry the day exactly once, not twice and not not at all.
    assert_eq!(balance(&pool, "101100100101").await.0, 1_110_000 * 2);
    assert_eq!(balance(&pool, "101100100101").await.1, 1_110_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_return_reduces_the_income_and_unwinds_its_tax(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    // A cash day, and one thing brought back from an earlier day. The original
    // sale is not on this day, so what is under test is the refund alone.
    synced_sale(
        pool_ref(&pool),
        midday(),
        1_110_000,
        0,
        0,
        "CASH",
        None,
        None,
    )
    .await;
    a_cash_refund(&pool, 111_000).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(document.posting.returns_minor, 111_000);
    // Income, less VAT, less what went back net of its own VAT.
    assert_eq!(document.posting.revenue_minor, 1_000_000 - 100_000);
    assert_eq!(document.posting.vat_minor, 110_000 - 11_000);

    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    // The drawer is the takings less the refund paid out of it.
    assert_eq!(balance(&pool, "101100100101").await.0, 999_000);
    // Contra revenue carries the refund, net of the tax it unwound.
    assert_eq!(balance(&pool, "401021400101").await.0, 100_000);
    // The income account is untouched by the refund: a return is a return, not
    // a smaller sale.
    assert_eq!(balance(&pool, "401011000101").await.1, 1_000_000);
    assert_eq!(balance(&pool, "201210100301").await.1, 99_000);
    // Nothing reached rounding: the return document and its refund row agree.
    assert_eq!(balance(&pool, "801011000201").await, (0, 0));

    let trial = cloud::trial_balance(&pool, day(), None)
        .await
        .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(trial.balanced);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_meaning_nobody_mapped_refuses_and_names_it(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    // Take the QRIS income account back off the map, and leave everything else
    // set: the refusal has to name the one that is missing.
    sqlx::query("DELETE FROM account_map WHERE semantic_key = 'revenue_qris'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("unmap: {error}"));
    open_september(&pool).await;
    an_ordinary_tuesday(&pool).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    // Generation still works: nothing is resolved until something is posted,
    // which is what lets a shop see its day before Finance has finished the
    // account map.
    let refusal = cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR).await;
    let message = match refusal {
        Ok(_) => panic!("posted a day with an unmapped income account"),
        Err(error) => error.to_string(),
    };
    assert!(
        message.contains("revenue_qris"),
        "the refusal has to name the key somebody must go and map, said: {message}"
    );
    assert!(
        message.contains(SITE),
        "and the location it is missing at, said: {message}"
    );

    let entries: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(entries, 0, "half an entry is worse than none");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn retendering_a_posted_day_reclassifies_the_receivable(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    // One card sale, rung on the wrong terminal.
    let tender_id = synced_sale(
        &pool,
        midday(),
        2_220_000,
        0,
        0,
        "CARD",
        Some("BCA"),
        Some("DEBIT"),
    )
    .await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    let outcome = cloud::retender_tender(
        &pool,
        tender_id,
        &cloud::RetenderRequest {
            to_method: "CARD".into(),
            to_acquirer: "MANDIRI".into(),
            to_card_kind: Some("DEBIT".into()),
            reason: "settled on the Mandiri terminal, not the BCA one".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("retender: {error}"));

    assert_eq!(outcome.from_acquirer, "BCA");
    assert_eq!(outcome.to_acquirer, "MANDIRI");
    assert!(
        outcome.journal_entry_id.is_some(),
        "a posted day has to be told, not just corrected"
    );

    let reclass = sqlx::query(
        "SELECT source_kind, source_id, total_minor, rule_version
           FROM journal_entry WHERE source_kind = 'RETENDER'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("reclass: {error}"));
    assert_eq!(
        reclass.get::<Option<String>, _>("source_id"),
        Some(tender_id.to_string())
    );
    assert_eq!(reclass.get::<i64, _>("total_minor"), 2_220_000);
    assert_eq!(reclass.get::<String, _>("rule_version"), "retender/1");

    // Both acquirers point at the same leaf in this chart, so the reclass nets
    // to nothing there — and the trial balance still has to hold, which is the
    // property that matters when they are split.
    let trial = cloud::trial_balance(&pool, day(), None)
        .await
        .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(trial.balanced);

    // The row moved too, and the reason survived.
    let audit =
        sqlx::query("SELECT from_acquirer, to_acquirer, reason, actor FROM sale_tender_retender")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("audit: {error}"));
    assert_eq!(audit.get::<String, _>("from_acquirer"), "BCA");
    assert_eq!(audit.get::<String, _>("to_acquirer"), "MANDIRI");
    assert_eq!(audit.get::<String, _>("actor"), ACTOR);
    assert!(audit
        .get::<String, _>("reason")
        .contains("Mandiri terminal"));

    let moved: String = sqlx::query("SELECT acquirer FROM edge_sale_tender WHERE tender_id = $1")
        .bind(tender_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("tender: {error}"))
        .try_get("acquirer")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(moved, "MANDIRI");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn retendering_before_posting_only_edits_the_tender(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let tender_id = synced_sale(
        &pool,
        midday(),
        2_220_000,
        0,
        0,
        "CARD",
        Some("BCA"),
        Some("DEBIT"),
    )
    .await;
    cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));

    let outcome = cloud::retender_tender(
        &pool,
        tender_id,
        &cloud::RetenderRequest {
            to_method: "CARD".into(),
            to_acquirer: "MANDIRI".into(),
            to_card_kind: Some("DEBIT".into()),
            reason: "wrong terminal".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("retender: {error}"));

    assert!(
        outcome.journal_entry_id.is_none(),
        "nothing in the books mentions this tender yet, so nothing to reverse"
    );
    let entries: i64 = sqlx::query("SELECT COUNT(*)::bigint AS n FROM journal_entry")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
        .try_get("n")
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(entries, 0);

    // Regenerating picks the correction up.
    let regenerated = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("regenerate: {error}"));
    assert_eq!(regenerated.lines[0].acquirer, "MANDIRI");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_sale_after_midnight_wib_belongs_to_the_shops_day(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    // 23:40 in Jakarta on the 15th, which is 16:40 UTC on the 15th, and would
    // be the 16th if the day were cut in UTC.
    let late = Utc
        .with_ymd_and_hms(2026, 9, 15, 16, 40, 0)
        .single()
        .unwrap_or_else(|| panic!("bad instant"));
    synced_sale(&pool, late, 111_000, 0, 0, "CASH", None, None).await;
    // 00:10 in Jakarta on the 16th: 17:10 UTC on the 15th, and the shop's next
    // day.
    let early = Utc
        .with_ymd_and_hms(2026, 9, 15, 17, 10, 0)
        .single()
        .unwrap_or_else(|| panic!("bad instant"));
    synced_sale(&pool, early, 222_000, 0, 0, "CASH", None, None).await;

    let fifteenth = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(fifteenth.posting.gross_minor, 111_000);

    let sixteenth = cloud::sales_posting_generate(
        &pool,
        &GenerateSalesPostingRequest {
            site_id: SITE.into(),
            business_date: NaiveDate::from_ymd_opt(2026, 9, 16)
                .unwrap_or_else(|| panic!("bad date")),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(sixteenth.posting.gross_minor, 222_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_sweep_generates_every_day_that_traded(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    an_ordinary_tuesday(&pool).await;
    // A second day, so the sweep has more than one thing to find.
    let wednesday = Utc
        .with_ymd_and_hms(2026, 9, 16, 5, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("bad instant"));
    synced_sale(&pool, wednesday, 333_000, 0, 0, "CASH", None, None).await;

    let swept = cloud::sales_posting_generate_days(
        &pool,
        &cloud::GenerateSalesDaysRequest {
            site_id: None,
            from: None,
            to: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("sweep: {error}"));

    assert_eq!(swept.len(), 2);
    assert!(swept.iter().all(|d| d.outcome == "GENERATED"));
    assert_eq!(
        swept.iter().map(|d| d.gross_minor).sum::<i64>(),
        7_415_000 + 333_000
    );
}

// ---------------------------------------------------------------------------
// The central population, which only the return path needs here
// ---------------------------------------------------------------------------

fn pool_ref(pool: &PgPool) -> &PgPool {
    pool
}

/// A cash refund against a sale from an earlier day.
///
/// The chain is real rather than convenient: `sale_return` names a sale, a
/// site and a movement group, and a sale names a price book. Faking any of
/// them would be faking the join the generator actually reads.
async fn a_cash_refund(pool: &PgPool, amount_minor: i64) {
    // The price book `0003` seeds, rather than one of our own. A sale needs a
    // publication to point at, and inserting a second one would collide on
    // `version` — and, worse, would quietly move what `day_vat_rate_bps`
    // reads: it takes the NEWEST publication, and a fresh one carrying no tax
    // rule would send the rate to the 11% fallback by a different road. The
    // seeded book declares 11% outright, which is the rate this test's
    // arithmetic is written against.
    let publication: Uuid =
        sqlx::query("SELECT id FROM commercial_publication ORDER BY version DESC LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap_or_else(|error| panic!("publication: {error}"))
            .try_get("id")
            .unwrap_or_else(|error| panic!("publication id: {error}"));

    let group = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO movement_group
           (id, cause, reason, actor_id, idempotency_key, payload_digest, occurred_at)
         VALUES ($1,'SALE','a sale','kasir',$2,'digest',now())",
    )
    .bind(group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("group: {error}"));

    let sale = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sale
           (id, sale_number, site_id, channel, status, commercial_publication_id,
            commercial_version, currency, net_minor, tax_minor, total_minor, paid_minor,
            change_minor, movement_group_id, actor_id, idempotency_key, created_at,
            completed_at)
         VALUES ($1,'S-1',$2,'STORE','COMPLETED',$3,1,'IDR',$4,$5,$6,$6,0,$7,'kasir',$8,
                 '2026-09-01T05:00:00Z','2026-09-01T05:00:00Z')",
    )
    .bind(sale)
    .bind(SITE)
    .bind(publication)
    .bind(amount_minor * 100 / 111)
    .bind(amount_minor - amount_minor * 100 / 111)
    .bind(amount_minor)
    .bind(group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));

    let refund_group = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO movement_group
           (id, cause, reason, actor_id, idempotency_key, payload_digest, occurred_at)
         VALUES ($1,'CUSTOMER_RETURN','a return','kasir',$2,'digest',now())",
    )
    .bind(refund_group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("refund group: {error}"));

    let return_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sale_return
           (id, return_number, sale_id, site_id, reason, refund_total_minor,
            movement_group_id, actor_id, idempotency_key, created_at)
         VALUES ($1,'R-1',$2,$3,'did not fit',$4,$5,'kasir',$6,'2026-09-15T05:00:00Z')",
    )
    .bind(return_id)
    .bind(sale)
    .bind(SITE)
    .bind(amount_minor)
    .bind(refund_group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("return: {error}"));

    sqlx::query(
        "INSERT INTO sale_return_payment (id, return_id, method, amount_minor)
         VALUES ($1,$2,'CASH',$3)",
    )
    .bind(Uuid::new_v4())
    .bind(return_id)
    .bind(amount_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("refund: {error}"));
}
