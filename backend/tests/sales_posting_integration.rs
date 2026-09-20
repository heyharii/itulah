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

/// A chart small enough to read and carrying every account a day of takings
/// can touch.
///
/// The ladder is root → four-digit account. It used to be root → ten-digit
/// client rung, because the client's codes WERE the tree; 0287–0292 took the
/// identity out of the code and put it on the line, so a day of takings now
/// lands on seven accounts instead of thirteen and tells them apart by
/// `journal_line.category_code`.
async fn seed_chart(pool: &PgPool) {
    for (code, name) in [("1", "ASSET"), ("2", "LIABILITIES"), ("4", "PENDAPATAN")] {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,NULL,true)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }

    // (account, name, dimension, category family). The family is what makes
    // four tenders share `4101` and still be readable apart.
    let accounts: [(&str, &str, &str, &str); 7] = [
        ("1101", "Kas", "unit", "pot"),
        ("1201", "Piutang tender", "unit", "tender"),
        ("2201", "Hutang pajak", "company", "tax_kind"),
        (
            "2401",
            "Kewajiban voucher & uang muka penjualan",
            "company",
            "deferred_revenue_kind",
        ),
        ("4101", "Penjualan", "unit", "tender"),
        (
            "4201",
            "Potongan & retur penjualan",
            "unit",
            "deduction_kind",
        ),
        ("4301", "Pendapatan lain-lain", "unit", "income_kind"),
    ];
    // `ON CONFLICT DO NOTHING` because 0289 already loads all forty under these
    // names; the list is here so the fixture says out loud which accounts a day
    // of takings is allowed to reach, and fails loudly if one of them goes.
    for (code, name, dimension, family) in accounts {
        sqlx::query(
            "INSERT INTO ledger_account
               (account_code, name, parent_code, is_group, dimension, category_family,
                posting_mode, manual_je_policy, posting_policy_configured)
             VALUES ($1,$2,$3,false,$4,$5,'AUTO_ONLY','NO',true)
             ON CONFLICT (account_code) DO NOTHING",
        )
        .bind(code)
        .bind(name)
        .bind(&code[..1])
        .bind(dimension)
        .bind(family)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
}

async fn map(pool: &PgPool, key: &str, qualifier: &str, code: &str, category: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: SITE.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            category_code: Some(category.into()),
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
///
/// Since the collapse the account is nearly always the same and the CATEGORY is
/// what the meaning chooses — five of these meanings land on `4101` and three
/// on `1201`.
async fn map_everything(pool: &PgPool) {
    for (key, code, category) in [
        ("cash", "1101", "DRAWER"),
        ("vat_out", "2201", "PPN_OUT"),
        ("voucher_liability", "2401", "VOUCHER_LIABILITY"),
        ("revenue_cash", "4101", "CASH"),
        ("revenue_qris", "4101", "QRIS"),
        ("sales_discount", "4201", "DISCOUNT"),
        ("sales_return", "4201", "RETURN"),
        ("rounding", "4301", "ROUNDING"),
        // The residue's loss side, since 0296: rows over documents is a cost.
        ("rounding_loss", "8301", "ROUNDING_LOSS"),
    ] {
        map(pool, key, "", code, category).await;
    }
    map(pool, "card_receivable_debit", "BCA", "1201", "DEBIT_BCA").await;
    map(
        pool,
        "card_receivable_debit",
        "MANDIRI",
        "1201",
        "DEBIT_MANDIRI",
    )
    .await;
    map(
        pool,
        "card_receivable_credit",
        "VISA",
        "1201",
        "CREDIT_VISA",
    )
    .await;
    map(pool, "revenue_debit", "BCA", "4101", "DEBIT_BCA").await;
    map(pool, "revenue_credit", "VISA", "4101", "CREDIT_VISA").await;
    map(pool, "qris_receivable", "GOPAY", "1201", "QRIS").await;
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

/// What one account holds, at one location, over everything posted — and, when
/// a category is named, only the part of it that answers to that category.
///
/// The category argument is not decoration. Five meanings now share `4101` and
/// three share `1201`, so an assertion on the account alone would pass on the
/// total while every tender inside it was wrong. `None` asks the older
/// question: what does this account hold in total.
async fn balance(pool: &PgPool, code: &str, category: Option<&str>) -> (i64, i64) {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(debit_minor),0)::bigint AS d,
                COALESCE(SUM(credit_minor),0)::bigint AS c
           FROM journal_line
          WHERE account_code = $1
            AND ($2::text IS NULL OR category_code = $2)",
    )
    .bind(code)
    .bind(category)
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

    let trial = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(day()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(trial.balanced, "a day of takings has to balance");

    // The drawer holds the cash tender less the change handed back, which is
    // the figure a shop counts at close.
    assert_eq!(balance(&pool, "1101", Some("DRAWER")).await.0, 1_110_000);
    // The acquirers. One receivable account now, told apart by tender.
    assert_eq!(balance(&pool, "1201", Some("DEBIT_BCA")).await.0, 2_220_000);
    assert_eq!(
        balance(&pool, "1201", Some("CREDIT_VISA")).await.0,
        3_330_000
    );
    assert_eq!(balance(&pool, "1201", Some("QRIS")).await.0, 555_000);
    // A voucher settles a liability the shop has been carrying; it brings no
    // money in today.
    assert_eq!(
        balance(&pool, "2401", Some("VOUCHER_LIABILITY")).await.0,
        200_000
    );
    // PPN inside each bucket, summed. 11% of the tax-exclusive part.
    assert_eq!(balance(&pool, "2201", Some("PPN_OUT")).await.1, 734_819);
    // Contra revenue: what the promotion cost, visible rather than netted
    // silently off the sale.
    assert_eq!(balance(&pool, "4201", Some("DISCOUNT")).await.0, 111_000);
    // And income under four tenders, because that is how the client reads it —
    // one account, four categories, where the client had four accounts.
    for category in ["CASH", "DEBIT_BCA", "CREDIT_VISA", "QRIS"] {
        assert!(
            balance(&pool, "4101", Some(category)).await.1 > 0,
            "4101/{category} should carry this day's income"
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
    let trial = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(day()),
            ..Default::default()
        },
    )
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
    assert_eq!(
        balance(&pool, "1101", Some("DRAWER")).await.0,
        1_110_000 * 2
    );
    assert_eq!(balance(&pool, "1101", Some("DRAWER")).await.1, 1_110_000);
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
    assert_eq!(balance(&pool, "1101", Some("DRAWER")).await.0, 999_000);
    // Contra revenue carries the refund, net of the tax it unwound.
    assert_eq!(balance(&pool, "4201", Some("RETURN")).await.0, 100_000);
    // The income account is untouched by the refund: a return is a return, not
    // a smaller sale.
    assert_eq!(balance(&pool, "4101", Some("CASH")).await.1, 1_000_000);
    assert_eq!(balance(&pool, "2201", Some("PPN_OUT")).await.1, 99_000);
    // Nothing reached rounding, on either side: the return document and its
    // refund row agree.
    assert_eq!(balance(&pool, "4301", Some("ROUNDING")).await, (0, 0));
    assert_eq!(balance(&pool, "8301", Some("ROUNDING_LOSS")).await, (0, 0));

    let trial = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(day()),
            ..Default::default()
        },
    )
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
    let trial = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(day()),
            ..Default::default()
        },
    )
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
        // `status` arrived with the refund lifecycle after this fixture was
        // written, and `SUCCEEDED` is the only state that is money actually given
        // back — which is what a return the ledger unwinds has to be.
        "INSERT INTO sale_return_payment (id, return_id, method, amount_minor, status)
         VALUES ($1,$2,'CASH',$3,'SUCCEEDED')",
    )
    .bind(Uuid::new_v4())
    .bind(return_id)
    .bind(amount_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("refund: {error}"));
}

// ---------------------------------------------------------------------------
// What the acquirers owe, in the ledger and in the books
// ---------------------------------------------------------------------------

/// A date the whole story is certainly behind, whenever this is run.
///
/// `ple_delink` dates a cancellation `CURRENT_DATE` rather than the reversal's
/// own posting date, so an "as at" read taken earlier would see the ledger's
/// cancellation and not the entry that caused it, and report a difference that
/// is only the gap between two dates.
fn after_everything() -> NaiveDate {
    day().max(Utc::now().date_naive())
}

/// Every control account in the report, having first insisted they all agree.
async fn agreed_receivables(
    pool: &PgPool,
) -> Vec<inventory_backend::cloud::postgres::PaymentLedgerIntegrityRow> {
    let integrity = cloud::payment_ledger_integrity(pool, Some(after_everything()), None)
        .await
        .unwrap_or_else(|error| panic!("integrity: {error}"));
    assert!(
        integrity.agrees,
        "the Payment Ledger and the books disagree: {:?}",
        integrity
            .rows
            .iter()
            .map(|row| (
                row.account_key.clone(),
                row.qualifier.clone(),
                row.ledger_outstanding_minor,
                row.gl_balance_minor
            ))
            .collect::<Vec<_>>()
    );
    integrity.rows
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_posted_day_owes_by_acquirer_exactly_what_the_books_owe(pool: PgPool) {
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

    // One item per acquirer the day owed, and each agrees with the account it
    // was posted to. Cash and the voucher are not here on purpose: a till
    // drawer is not a debt and a gift card is owed to somebody who may never
    // come back, so neither has a party to be owed by.
    let rows = agreed_receivables(&pool).await;
    let owed: Vec<(String, String, i64)> = rows
        .iter()
        .map(|row| {
            (
                row.account_key.clone(),
                row.qualifier.clone(),
                row.ledger_outstanding_minor,
            )
        })
        .collect();
    assert_eq!(
        owed,
        vec![
            (
                "card_receivable_credit".to_string(),
                "VISA".to_string(),
                3_330_000
            ),
            (
                "card_receivable_debit".to_string(),
                "BCA".to_string(),
                2_220_000
            ),
            ("qris_receivable".to_string(), "GOPAY".to_string(), 555_000),
        ]
    );
    for row in &rows {
        assert_eq!(row.side, "RECEIVABLE");
        assert_eq!(row.gl_balance_minor, row.ledger_outstanding_minor);
        assert_eq!(row.open_items, 1);
    }

    // Reversing the day takes the receivables out of the books, and the items
    // stop counting in the same act.
    cloud::sales_posting_reverse(
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

    for row in agreed_receivables(&pool).await {
        assert_eq!(
            row.ledger_outstanding_minor, 0,
            "{} {} is still open after the day was reversed",
            row.account_key, row.qualifier
        );
        assert_eq!(row.gl_balance_minor, 0);
        assert_eq!(row.open_items, 0);
    }

    // And posting it again raises them afresh rather than handing back the
    // cancelled ones, which is what the attempt in the voucher is for.
    let fresh = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("regenerate: {error}"));
    cloud::sales_posting_post(&pool, fresh.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("repost: {error}"));
    let reposted = agreed_receivables(&pool).await;
    let open: i64 = reposted.iter().map(|row| row.open_items).sum();
    assert_eq!(open, 3, "the corrected day is owed once, not not at all");
    let total: i64 = reposted
        .iter()
        .map(|row| row.ledger_outstanding_minor)
        .sum();
    assert_eq!(total, 3_330_000 + 2_220_000 + 555_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_retender_moves_the_debt_to_the_acquirer_that_took_it(pool: PgPool) {
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
    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));

    // It was rung on the wrong terminal: VISA took it, not BCA.
    cloud::retender_tender(
        &pool,
        tender_id,
        &cloud::RetenderRequest {
            to_method: "CARD".into(),
            to_acquirer: "VISA".into(),
            to_card_kind: Some("CREDIT".into()),
            reason: "settled on the VISA terminal, not the BCA one".into(),
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("retender: {error}"));

    // One debt, moved. Not two debts, which is what opening without settling
    // would have left: an evening's takings owed by two banks at once.
    let rows = agreed_receivables(&pool).await;
    let open: i64 = rows.iter().map(|row| row.open_items).sum();
    assert_eq!(open, 1, "{rows:#?}");
    let outstanding: Vec<(String, i64)> = rows
        .iter()
        .map(|row| (row.qualifier.clone(), row.ledger_outstanding_minor))
        .collect();
    assert_eq!(
        outstanding,
        vec![("VISA".to_string(), 2_220_000), ("BCA".to_string(), 0)]
    );
    for row in &rows {
        assert_eq!(row.gl_balance_minor, row.ledger_outstanding_minor);
        assert_eq!(row.difference_minor, 0);
    }

    // And the item VISA now owes says which correction raised it.
    let items = cloud::ple_open_items(
        &pool,
        &cloud::PaymentLedgerFilter {
            party_id: Some("VISA".into()),
            open_only: true,
            as_of: Some(after_everything()),
            limit: 10,
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("open items: {error}"));
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].voucher_kind, "RETENDER");
    assert_eq!(items[0].account_key, "card_receivable_credit");
    assert_eq!(
        items[0].posting_date,
        day(),
        "the debt is as old as the sale"
    );
}

// ---------------------------------------------------------------------------
// Whose tax the day posts
// ---------------------------------------------------------------------------
//
// A receipt is a transaction that happened: the tax on it was quoted from the
// product's own category on the book that priced it, and the customer paid it.
// Extracting a day's tax from a rate instead replaces that with an inference,
// and the two do not agree — measured over 21,829 real sales, by Rp 10,850.
// See `docs/finance-sales-tax-source.md`.

/// The tax a till recorded on a sale it synced up.
///
/// `edge_sale.tax_total_minor` is nullable and NULL there means UNKNOWN — a
/// basket priced with no book in force — so a fixture that wants a recorded day
/// has to say so, which is exactly what a real till does.
async fn recorded_tax(pool: &PgPool, tender_id: Uuid, tax_minor: i64) {
    // `synced_sale` hands back the TENDER's id, so the sale is reached through
    // it rather than guessed at.
    let updated = sqlx::query(
        "UPDATE edge_sale s
            SET tax_total_minor = $2, net_ex_tax_minor = s.total_minor - $2
           FROM edge_sale_tender t
          WHERE t.tender_id = $1 AND s.sale_id = t.sale_id",
    )
    .bind(tender_id)
    .bind(tax_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("recorded tax: {error}"));
    assert_eq!(updated.rows_affected(), 1, "no sale behind that tender");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_day_posts_the_tax_its_tills_recorded(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale = synced_sale(&pool, midday(), 1_110_000, 0, 0, "CASH", None, None).await;
    recorded_tax(&pool, sale, 110_000).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(document.posting.vat_source, "RECORDED");
    assert_eq!(document.posting.vat_minor, 110_000);
    assert_eq!(document.posting.vat_recorded_minor, Some(110_000));
    // The rate agrees here, and the column says so rather than leaving a reader
    // to work out whether it was ever checked.
    assert_eq!(document.posting.vat_recomputed_minor, 110_000);
    assert_eq!(document.posting.revenue_minor, 1_000_000);

    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(balance(&pool, "2201", Some("PPN_OUT")).await.1, 110_000);
    assert_eq!(balance(&pool, "4101", Some("CASH")).await.1, 1_000_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn per_sale_rounding_is_posted_rather_than_rounded_again_per_bucket(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    // Three small sales, each rounded on its own receipt: 100 inclusive of 11%
    // is 9.909 of tax, and the receipt keeps 9. The same three as one bucket of
    // 300 comes to 29.7, which rounds to 29. That two-rupiah gap IS the whole
    // difference between the two authorities, scaled down to where it can be
    // read: the rate is not wrong, the rounding happens somewhere else.
    for _ in 0..3 {
        let sale = synced_sale(&pool, midday(), 100, 0, 0, "CASH", None, None).await;
        recorded_tax(&pool, sale, 9).await;
    }

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(document.posting.vat_source, "RECORDED");
    assert_eq!(
        document.posting.vat_minor, 27,
        "what the three receipts say"
    );
    assert_eq!(
        document.posting.vat_recomputed_minor, 29,
        "what the rate would have said, kept beside it"
    );
    assert_eq!(document.posting.revenue_minor, 300 - 27);

    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    // Posted, not merely recorded on the document.
    assert_eq!(balance(&pool, "2201", Some("PPN_OUT")).await.1, 27);
    assert_eq!(balance(&pool, "4101", Some("CASH")).await.1, 273);
    let trial = cloud::trial_balance(
        &pool,
        cloud::TrialBalanceScope {
            as_of: Some(day()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(trial.balanced, "the allocation still sums back to the day");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_refund_unwinds_the_tax_the_line_was_sold_with(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale = synced_sale(&pool, midday(), 1_110_000, 0, 0, "CASH", None, None).await;
    recorded_tax(&pool, sale, 110_000).await;
    // Sold on an older book at 10%: 1,100 carrying 100 of tax. Today's rate
    // would unwind 109 of it. The line says 100, and the line is what the
    // customer was charged.
    a_refund_of_a_recorded_line(&pool, 1_100, 100).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(document.posting.vat_source, "RECORDED");
    assert_eq!(document.posting.returns_minor, 1_100);
    assert_eq!(
        document.posting.vat_minor,
        110_000 - 100,
        "the tax that was taken, less the tax that was given back"
    );
    assert_eq!(
        document.posting.vat_recomputed_minor,
        110_000 - 109,
        "the rate's answer, kept for comparison only"
    );
    assert_eq!(document.posting.revenue_minor, 1_000_000 - (1_100 - 100));

    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(
        balance(&pool, "2201", Some("PPN_OUT")).await.1,
        110_000 - 100
    );
    assert_eq!(balance(&pool, "4201", Some("RETURN")).await.0, 1_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_recorded_day_generates_the_same_figures_however_often_it_is_replayed(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let sale = synced_sale(&pool, midday(), 1_110_000, 0, 0, "CASH", None, None).await;
    recorded_tax(&pool, sale, 110_000).await;
    a_refund_of_a_recorded_line(&pool, 1_100, 100).await;

    let first = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    let again = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("regenerate: {error}"));
    assert_eq!(first.posting.posting_id, again.posting.posting_id);
    assert_eq!(first.posting.vat_source, again.posting.vat_source);
    assert_eq!(first.posting.vat_minor, again.posting.vat_minor);
    assert_eq!(
        first.posting.vat_recorded_minor,
        again.posting.vat_recorded_minor
    );
    assert_eq!(
        first.posting.vat_recomputed_minor,
        again.posting.vat_recomputed_minor
    );

    cloud::sales_posting_post(&pool, again.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    let posted = cloud::sales_posting_detail(&pool, again.posting.posting_id)
        .await
        .unwrap_or_else(|error| panic!("read: {error}"));
    assert_eq!(posted.posting.status, "POSTED");
    assert_eq!(posted.posting.vat_minor, first.posting.vat_minor);
    assert_eq!(posted.posting.vat_source, "RECORDED");
    // Posting is what makes the day unrepeatable; nothing about reading the
    // recorded tax made it repeatable by accident.
    let refused = cloud::sales_posting_generate(&pool, &ask(), ACTOR).await;
    assert!(refused.is_err(), "a posted day cannot be generated over");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_till_that_recorded_no_tax_takes_the_whole_day_back_to_the_rate(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    let recorded = synced_sale(&pool, midday(), 1_110_000, 0, 0, "CASH", None, None).await;
    recorded_tax(&pool, recorded, 110_000).await;
    // A basket priced with no book in force. NULL is not nought, and half a day
    // of receipts plus half a day of arithmetic is a figure nobody can defend —
    // so the whole day goes back to the rate and says so.
    synced_sale(&pool, midday(), 1_110_000, 0, 0, "CASH", None, None).await;

    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    assert_eq!(document.posting.vat_source, "RATE");
    assert_eq!(document.posting.vat_recorded_minor, None);
    assert_eq!(document.posting.vat_minor, 220_000);
    assert_eq!(
        document.posting.vat_recomputed_minor,
        document.posting.vat_minor
    );
}

/// A return the ledger can trace: a central sale, its line, and a return line
/// pointing back at it.
///
/// `sale_return_line.sale_line_id` is NOT NULL and references `sale_line`, so
/// this is the only shape a return with traceable tax can have. The sale is
/// dated an earlier day on purpose — what is under test is the refund, and a
/// refund of something sold under a different book is the case the rate gets
/// wrong.
async fn a_refund_of_a_recorded_line(pool: &PgPool, refund_minor: i64, tax_minor: i64) {
    let publication: Uuid =
        sqlx::query("SELECT id FROM commercial_publication ORDER BY version DESC LIMIT 1")
            .fetch_one(pool)
            .await
            .unwrap_or_else(|error| panic!("publication: {error}"))
            .try_get("id")
            .unwrap_or_else(|error| panic!("publication id: {error}"));

    let article = Uuid::new_v4();
    sqlx::query("INSERT INTO article (id, article_code, name) VALUES ($1,'ART-RET','Kaos')")
        .bind(article)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("article: {error}"));
    let sku = Uuid::new_v4();
    sqlx::query("INSERT INTO sku (id, article_id, sku_code) VALUES ($1,$2,'RET-01-M')")
        .bind(sku)
        .bind(article)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("sku: {error}"));
    let subject = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO inventory_subject (id, subject_type, sku_id, quantity, uom)
         VALUES ($1,'QUANTITY',$2,1,'EA')",
    )
    .bind(subject)
    .bind(sku)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("subject: {error}"));

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
         VALUES ($1,'S-RET',$2,'STORE','OPEN',$3,1,'IDR',$4,$5,$6,$6,0,$7,'kasir',$8,
                 '2026-09-01T05:00:00Z',NULL)",
    )
    .bind(sale)
    .bind(SITE)
    .bind(publication)
    .bind(refund_minor - tax_minor)
    .bind(tax_minor)
    .bind(refund_minor)
    .bind(group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));

    let sale_line = Uuid::new_v4();
    sqlx::query(
        // 10%, and inclusive: the book this was sold under, not the one in
        // force now.
        "INSERT INTO sale_line
           (id, sale_id, subject_id, sku_id, quantity, unit_price_minor, net_minor,
            tax_minor, total_minor, currency, tax_category, tax_rate_bps, tax_inclusive,
            commercial_publication_id, commercial_version, price_snapshot_digest,
            actor_id, idempotency_key)
         VALUES ($1,$2,$3,$4,1,$5,$6,$7,$5,'IDR','STANDARD',1000,true,$8,1,'digest',
                 'kasir',$9)",
    )
    .bind(sale_line)
    .bind(sale)
    .bind(subject)
    .bind(sku)
    .bind(refund_minor)
    .bind(refund_minor - tax_minor)
    .bind(tax_minor)
    .bind(publication)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale line: {error}"));

    // A sale takes its lines while it is OPEN and is completed after — the
    // same order the till writes in, and a trigger holds it to that.
    sqlx::query(
        "UPDATE sale SET status = 'COMPLETED', completed_at = '2026-09-01T05:00:00Z'
          WHERE id = $1",
    )
    .bind(sale)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("complete: {error}"));

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
         VALUES ($1,'R-RET',$2,$3,'did not fit',$4,$5,'kasir',$6,'2026-09-15T05:00:00Z')",
    )
    .bind(return_id)
    .bind(sale)
    .bind(SITE)
    .bind(refund_minor)
    .bind(refund_group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("return: {error}"));

    sqlx::query(
        "INSERT INTO sale_return_line
           (id, return_id, sale_line_id, subject_id, sku_id, quantity, refund_minor, restock)
         VALUES ($1,$2,$3,$4,$5,1,$6,true)",
    )
    .bind(Uuid::new_v4())
    .bind(return_id)
    .bind(sale_line)
    .bind(subject)
    .bind(sku)
    .bind(refund_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("return line: {error}"));

    sqlx::query(
        "INSERT INTO sale_return_payment (id, return_id, method, amount_minor, status)
         VALUES ($1,$2,'CASH',$3,'SUCCEEDED')",
    )
    .bind(Uuid::new_v4())
    .bind(return_id)
    .bind(refund_minor)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("refund: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_declared_card_and_a_guessed_one_are_the_same_bucket(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    // The same money, twice, from the two tills this estate actually has: a
    // shop's own, which records the card kind, and the centre's, which has no
    // column for it and leaves it to be inferred from the acquirer.
    synced_sale(
        &pool,
        midday(),
        500_000,
        0,
        0,
        "CARD",
        Some("BCA"),
        Some("DEBIT"),
    )
    .await;
    a_central_card_sale(&pool, 300_000, "BCA").await;

    // Before the kind was settled ahead of grouping, these were two buckets
    // that resolved to one `(method, acquirer, card_kind)` — and
    // `sales_posting_line` is unique on exactly that, so the day died on a
    // unique violation the API renders as "database operation failed".
    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));

    let cards: Vec<_> = document
        .lines
        .iter()
        .filter(|line| line.method == "CARD")
        .collect();
    assert_eq!(cards.len(), 1, "one bucket, not one per till");
    assert_eq!(cards[0].acquirer, "BCA");
    assert_eq!(cards[0].card_kind.as_deref(), Some("DEBIT"));
    assert_eq!(cards[0].gross_minor, 800_000, "both tills' money");
    assert!(
        cards[0].card_kind_inferred,
        "half of it was guessed, and the working paper has to say so"
    );

    cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post: {error}"));
    assert_eq!(balance(&pool, "1201", Some("DEBIT_BCA")).await.0, 800_000);
}

/// A completed central sale paid by card, with the acquirer named and the kind
/// left to be inferred — which is all `sale_payment` can carry: it has an
/// `acquirer` column and no `card_kind` one.
async fn a_central_card_sale(pool: &PgPool, total_minor: i64, acquirer: &str) {
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
            change_minor, movement_group_id, actor_id, idempotency_key, created_at)
         VALUES ($1,'S-CARD',$2,'STORE','OPEN',$3,1,'IDR',$4,$5,$6,$6,0,$7,'kasir',$8,
                 '2026-09-15T05:00:00Z')",
    )
    .bind(sale)
    .bind(SITE)
    .bind(publication)
    .bind(total_minor - total_minor * 100 / 1110)
    .bind(total_minor * 100 / 1110)
    .bind(total_minor)
    .bind(group)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("sale: {error}"));

    sqlx::query(
        "INSERT INTO sale_payment
           (id, sale_id, method, amount_minor, acquirer, actor_id, idempotency_key)
         VALUES ($1,$2,'CARD',$3,$4,'kasir',$5)",
    )
    .bind(Uuid::new_v4())
    .bind(sale)
    .bind(total_minor)
    .bind(acquirer)
    .bind(Uuid::new_v4().to_string())
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("payment: {error}"));

    sqlx::query(
        "UPDATE sale SET status='COMPLETED', completed_at='2026-09-15T05:00:00Z' WHERE id=$1",
    )
    .bind(sale)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("complete: {error}"));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_card_that_names_no_acquirer_is_told_which_ones_the_map_has(pool: PgPool) {
    seed_chart(&pool).await;
    map_everything(&pool).await;
    open_september(&pool).await;
    // A card tender with no acquirer on it — an older till, or a receipt whose
    // EDC slip was never captured. The map keeps card income per acquirer, so
    // this resolves nothing.
    synced_sale(&pool, midday(), 555_000, 0, 0, "CARD", None, None).await;

    // The document generates: it is a working paper, and resolving meanings to
    // accounts is the poster's job, not the reading's.
    let document = cloud::sales_posting_generate(&pool, &ask(), ACTOR)
        .await
        .unwrap_or_else(|error| panic!("generate: {error}"));
    let refused = cloud::sales_posting_post(&pool, document.posting.posting_id, ACTOR)
        .await
        .err()
        .unwrap_or_else(|| panic!("a day with nowhere to post its card income cannot post"));
    let said = refused.to_string();
    // The receivable is resolved before the income, so it is the one named.
    assert!(
        said.contains("card_receivable_debit"),
        "the meaning that could not be resolved: {said}"
    );
    // The point of the message: the reader is looking at a screen that DOES
    // show `revenue_debit`, and without this they conclude the refusal is lying.
    assert!(
        said.contains("BCA") && said.contains("MANDIRI"),
        "the qualifiers the map does have: {said}"
    );
    assert!(
        said.contains("named none of them"),
        "why the qualified rows did not match: {said}"
    );
}
