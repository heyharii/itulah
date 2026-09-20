//! One store, one trading day, one authority.
//!
//! Two modules used to post a day's takings, both under
//! `source_kind = 'SALE_DAY'`, each idempotent by itself and blind to the other:
//! `sales_posting` named its entries by the document's uuid and `sale_day` by
//! `site:day`, and `ux_journal_entry_source_purpose` is unique on
//! (kind, source_id, purpose), so the two shapes never collided. One shop's
//! Tuesday could be posted through both, and the trial balance balanced twice.
//!
//! 0273 settled it: `sales_posting` is the authority — it is what opens the
//! Payment Ledger items the acquirer settlement closes, and it has the only
//! correction path a posted day has. `sale_day`'s writer was removed, not hidden,
//! and these tests hold the two structural guards that stop it coming back.
//!
//! Its READER stays, and is tested here too: "which days are not in the book" is
//! a real question a list of postings cannot answer, and it now answers it from
//! the authority.

use chrono::{NaiveDate, TimeZone, Utc};
use inventory_backend::cloud::postgres::{self as cloud, SaleDayScope};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
const SHOP: &str = "store-03";

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

/// One completed sale, with the tender it was paid by.
///
/// Ported from the retired suite rather than simplified: a sale at the centre
/// needs a published commercial version before it can exist, and a shortcut that
/// skipped it would be testing a row shape production never has.
async fn ring_up(pool: &PgPool, at: chrono::DateTime<Utc>, total_minor: i64) -> Uuid {
    // Paid in cash, in full, with no change and no tax split: none of that is what
    // this file tests, and a day only has to EXIST for the list to be asked about.
    let tenders: [(&str, Option<&str>, i64); 1] = [("CASH", None, total_minor)];
    let change_minor: i64 = 0;
    let tax_minor: i64 = 0;
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
}

/// Every posting needs the month open, which is 0051's guard and not this file's
/// subject — but it fires before the guards that ARE, so it comes first.
async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

/// A day the AUTHORITY posted, written directly so these tests hold the guards
/// rather than the whole generate-and-post path — `sales_posting_integration`
/// holds that.
async fn the_authority_posted(pool: &PgPool, day: u32, gross_minor: i64) -> Uuid {
    let entry_id = Uuid::new_v4();
    // One transaction, because 0051's "an entry has lines" trigger is deferred to
    // COMMIT: written statement by statement through the pool, the header commits
    // alone and is refused. That is the guard doing its job, and it is also why
    // `poster::post` takes a transaction rather than a pool.
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, purpose,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,$2,$3,'SALE_DAY',$4,'ATTEMPT_1','sale_day/1',$5,'IDR','takings',$6)",
    )
    .bind(entry_id)
    .bind(format!("JV-{}", &entry_id.to_string()[..8]))
    .bind(september(day))
    .bind(Uuid::new_v4().to_string())
    .bind(gross_minor)
    .bind(ACTOR)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("the authority's entry: {error}"));

    // An entry with no lines is refused by 0051's deferred trigger, which is the
    // guarantee this file depends on rather than tests: a day in the book is a day
    // with legs. Cash in, revenue out, both at the shop.
    for (index, (code, category, debit, credit)) in [
        ("1101", "DRAWER", gross_minor, 0),
        ("4101", "CASH", 0, gross_minor),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            "INSERT INTO journal_line
               (line_id, entry_id, line_number, account_code, site_id, category_code,
                debit_minor, credit_minor)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(Uuid::new_v4())
        .bind(entry_id)
        .bind(index as i32 + 1)
        .bind(code)
        .bind(SHOP)
        .bind(category)
        .bind(debit)
        .bind(credit)
        .execute(&mut *tx)
        .await
        .unwrap_or_else(|error| panic!("a leg on {code}: {error}"));
    }

    sqlx::query(
        "INSERT INTO sales_posting
           (posting_id, site_id, business_date, status, gross_minor, settled_minor,
            discount_minor, returns_minor, vat_minor, revenue_minor, sale_count,
            vat_rate_bps, generated_by, journal_entry_id, posted_at, posted_by,
            -- A day of nought tax, so the rate's answer is nought too and
            -- saying so costs nothing. 0276 keeps this column NOT NULL rather
            -- than defaulting it: a default would let a document claim the two
            -- authorities agreed on a day nobody ever compared.
            vat_source, vat_recomputed_minor)
         VALUES ($1,$2,$3,'POSTED',$4,$4,0,0,0,$4,1,1100,$5,$6,now(),$5,'RATE',0)",
    )
    .bind(Uuid::new_v4())
    .bind(SHOP)
    .bind(september(day))
    .bind(gross_minor)
    .bind(ACTOR)
    .bind(entry_id)
    .execute(&mut *tx)
    .await
    .unwrap_or_else(|error| panic!("the authority's document: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    entry_id
}

/// The retired writer's table takes nothing new, so a reintroduced writer cannot
/// claim a day behind the authority's back.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_retired_writers_table_takes_no_new_rows(pool: PgPool) {
    open_september(&pool).await;
    let entry_id = the_authority_posted(&pool, 1, 1_000_000).await;

    let claimed = sqlx::query(
        "INSERT INTO sale_day_posting
           (site_id, trading_day, entry_id, utc_offset_minutes, sales_count, gross_minor,
            cash_tendered_minor, change_minor, card_debit_minor, card_credit_minor,
            card_unattributed_minor, qris_minor, voucher_minor, other_minor,
            card_debit_fee_minor, card_credit_fee_minor, qris_fee_minor, posted_by)
         VALUES ($1,$2,$3,420,1,1000000,1000000,0,0,0,0,0,0,0,0,0,0,$4)",
    )
    .bind(SHOP)
    .bind(september(1))
    .bind(entry_id)
    .bind(ACTOR)
    .execute(&pool)
    .await;

    let error = claimed.expect_err("the retired writer's table is closed");
    assert!(
        error.to_string().contains("one authority"),
        "refused for the wrong reason: {error}"
    );
}

/// And the books themselves refuse the retired writer's naming, so a revert, a
/// merge or a third implementation cannot produce a second entry for one day.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_days_entry_can_only_be_named_by_its_posting(pool: PgPool) {
    open_september(&pool).await;
    let written = sqlx::query(
        "INSERT INTO journal_entry
           (entry_id, entry_number, posting_date, source_kind, source_id, purpose,
            rule_version, total_minor, currency, memo, posted_by)
         VALUES ($1,'JV-99999999',$2,'SALE_DAY',$3,'MAIN','sale_day/2',1000000,'IDR','x',$4)",
    )
    .bind(Uuid::new_v4())
    .bind(september(1))
    // The shape the retired writer used.
    .bind(format!("{SHOP}:2026-09-01"))
    .bind(ACTOR)
    .execute(&pool)
    .await;

    let error = written.expect_err("only the authority's naming is accepted");
    assert!(
        error
            .to_string()
            .contains("journal_entry_sale_day_is_named_by_its_posting"),
        "refused for the wrong reason: {error}"
    );

    // And the authority's own naming is accepted, so the guard is not simply
    // refusing everything.
    the_authority_posted(&pool, 2, 1_000_000).await;
}

/// One store and one day reach at most one authoritative result. The authority's
/// own `UNIQUE (site_id, business_date)` is what says so, and nothing can post a
/// day around it any more.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_store_day_cannot_be_posted_twice(pool: PgPool) {
    open_september(&pool).await;
    the_authority_posted(&pool, 3, 2_500_000).await;

    let twice = sqlx::query(
        "INSERT INTO sales_posting
           (posting_id, site_id, business_date, status, gross_minor, settled_minor,
            discount_minor, returns_minor, vat_minor, revenue_minor, sale_count,
            vat_rate_bps, generated_by)
         VALUES ($1,$2,$3,'DRAFT',1,1,0,0,0,1,1,1100,$4)",
    )
    .bind(Uuid::new_v4())
    .bind(SHOP)
    .bind(september(3))
    .bind(ACTOR)
    .execute(&pool)
    .await;
    assert!(
        twice.is_err(),
        "a second document for one store-day is refused"
    );

    let entries: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM journal_entry
          WHERE source_kind = 'SALE_DAY' AND posting_date = $1",
    )
    .bind(september(3))
    .fetch_one(&pool)
    .await
    .expect("count the day's entries");
    assert_eq!(entries, 1, "one day, one authoritative accounting result");
}

/// The reader answers from the authority. Before 0273 it read only the retired
/// writer's table, so after the removal every day would have read as unposted —
/// a list that says the books have not heard about a day they HAVE heard about is
/// worse than no list.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_list_reports_the_authoritys_days_as_posted(pool: PgPool) {
    open_september(&pool).await;
    ring_up(&pool, wib(4, 10, 0), 3_330_000).await;
    ring_up(&pool, wib(5, 10, 0), 1_110_000).await;
    the_authority_posted(&pool, 4, 3_330_000).await;

    let page = cloud::sale_days(
        &pool,
        SaleDayScope {
            sites: vec![SHOP.into()],
            ..Default::default()
        },
    )
    .await
    .expect("list the days");

    let posted: Vec<(NaiveDate, bool)> = page
        .rows
        .iter()
        .map(|row| (row.trading_day, row.entry_id.is_some()))
        .collect();
    assert!(
        posted.contains(&(september(4), true)),
        "the day the authority posted reads as posted: {posted:?}"
    );
    assert!(
        posted.contains(&(september(5), false)),
        "the day nobody posted reads as not posted: {posted:?}"
    );
}

/// QRIS is a tender the books can name on both sides of a day.
///
/// The question is the same one 0248 asked — can a QRIS day be posted at all —
/// and the answer has moved from "there is an account for it" to "there is a
/// category for it". `1011101003 Piutang QRIS` and `4010114001 Penjualan QRIS`
/// were two accounts minted for one tender; they are `1201 × QRIS` and
/// `4101 × QRIS` now, on the two accounts that carry every tender.
///
/// NOTE what this can no longer say. 0248 refused to restore `1011101004
/// Piutang Tender Lain-Lain`, deliberately: the authority refuses a tender it
/// does not recognise and offers `retender` instead, so there was to be no
/// unnamed-tender debt to hold. 0287 seeds `TENDER_OTHER` in the same family,
/// so `1201 × TENDER_OTHER` is a legal posting again. Nothing maps it and the
/// authority still refuses an unknown tender, so the door is shut one level up
/// rather than in the chart — which is a weaker guarantee than the one 0248
/// chose, and worth a decision rather than a discovery.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn qris_is_owed_by_a_provider_and_the_unnamed_tender_is_not(pool: PgPool) {
    // Both halves of a QRIS day, and the family they are drawn from.
    let rows = sqlx::query(
        "SELECT a.account_code, a.name, a.is_group, a.dimension, a.site_id,
                a.posting_mode, a.category_family, c.name AS category_name
           FROM ledger_account a
           JOIN line_category c ON c.family = a.category_family AND c.category_code = 'QRIS'
          WHERE a.account_code IN ('1201','4101')
          ORDER BY a.account_code",
    )
    .fetch_all(&pool)
    .await
    .expect("the receivable and the income");

    let codes: Vec<String> = rows
        .iter()
        .map(|row| row.get::<String, _>("account_code"))
        .collect();
    assert_eq!(
        codes,
        vec!["1201".to_string(), "4101".to_string()],
        "a QRIS day needs a receivable and an income line, and QRIS has to be a \
         legal category on both"
    );

    for row in &rows {
        assert!(!row.get::<bool, _>("is_group"), "it takes postings");
        assert_eq!(
            row.get::<Option<String>, _>("dimension").as_deref(),
            Some("unit"),
            "kept per unit"
        );
        assert!(
            row.get::<Option<String>, _>("site_id").is_none(),
            "it names no unit; the line does"
        );
        assert_eq!(row.get::<String, _>("posting_mode"), "AUTO_ONLY");
        assert_eq!(row.get::<String, _>("category_family"), "tender");
        assert_eq!(row.get::<String, _>("category_name"), "QRIS");
    }

    // No per-unit copies, which is how 0238 built them and 0243/0244 abolished.
    let copies: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ledger_account
          WHERE account_code LIKE '1201%' AND account_code <> '1201'",
    )
    .fetch_one(&pool)
    .await
    .expect("copies");
    assert_eq!(copies, 0, "one account per meaning");
}

/// A voucher redemption has a liability to settle, for the same reason.
///
/// `2012305001 Hutang Voucher` is `2401 × VOUCHER_LIABILITY`, sharing its
/// account with the customer deposit — two things somebody has paid for and not
/// yet had. It is a `company` account now rather than a `unit` one, which is
/// the honest reading: a voucher is sold at one shop and spent at another, and
/// the liability was never the selling shop's.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_voucher_has_a_liability_to_settle(pool: PgPool) {
    let row = sqlx::query(
        "SELECT a.name, a.parent_code, a.dimension, a.posting_mode,
                a.posting_policy_configured, a.category_family, c.name AS category_name
           FROM ledger_account a
           JOIN line_category c
             ON c.family = a.category_family AND c.category_code = 'VOUCHER_LIABILITY'
          WHERE a.account_code = '2401'",
    )
    .fetch_one(&pool)
    .await
    .expect("the voucher liability");
    assert_eq!(row.get::<String, _>("parent_code"), "2");
    assert_eq!(
        row.get::<Option<String>, _>("dimension").as_deref(),
        Some("company")
    );
    assert_eq!(row.get::<String, _>("posting_mode"), "AUTO_ONLY");
    assert!(row.get::<bool, _>("posting_policy_configured"));
    assert_eq!(
        row.get::<String, _>("category_family"),
        "deferred_revenue_kind"
    );
    assert_eq!(row.get::<String, _>("category_name"), "Hutang Voucher");

    // Not filed against a related company: 0264 had to split four affiliate
    // natures apart because they had been collapsed into one, and money owed to
    // a shopper is not money owed to an affiliate. `1501` is where an affiliate
    // balance lives now, and it is not this account.
    let affiliate: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ledger_account
          WHERE account_code = '1501' AND category_family = 'interunit_reason'",
    )
    .fetch_one(&pool)
    .await
    .expect("the interunit account");
    assert_eq!(
        affiliate, 1,
        "what one unit owes another is its own account, and it is not the voucher's"
    );
}
