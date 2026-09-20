//! A bank, an account at it, and the natural account it sits in — three things.
//!
//! Every test drives the real writers: `describe_account` for the master and
//! `poster::post` for the ledger, because the guarantees are theirs. Nothing here
//! hardcodes an account id: the chart's own codes are named (they come from the
//! migrations since 0243) and every uuid is whatever the master hands back.
//!
//!     1102  Bank            dimension = company, no category family
//!     1101  Kas             the contra, so entries balance; category `pot`
//!
//! Three of those lines used to be three accounts — `1011002001` giro at BCA,
//! `1011003001` savings at BCA, `1011002002` giro at Mandiri. 0291 folded all
//! fourteen of the client's bank accounts into `1102` and kept the old code on
//! `company_bank_account.legacy_ledger_account_code`. So the account code no
//! longer says which bank a line was about; `bank_account_id` does, which is
//! what this file was always really testing. Two consequences show up below and
//! are called out where they do.

use chrono::NaiveDate;
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres::{
    self as cloud, DescribeBankAccountRequest, LineAccount, PostingIntent, PostingLine,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ACTOR: &str = "ana";
/// One natural account for every bank account we hold. Which bank, which
/// number and whether it is a giro or a savings account are arguments to
/// `account_at`, not different codes.
const BANK: &str = "1102";
const CASH: &str = "1101";
const HO: &str = "dc";
const SHOP: &str = "store-01";

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).expect("date")
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

fn describe(ledger: &str, number: &str, kind: &str) -> DescribeBankAccountRequest {
    DescribeBankAccountRequest {
        ledger_account_code: ledger.into(),
        site_id: HO.into(),
        bank_code: None,
        bank_name: String::new(),
        account_no: number.into(),
        account_holder: "PT Itulah Busana Nusantara".into(),
        branch: None,
        kind: kind.into(),
        is_primary: None,
        note: None,
    }
}

async fn account_at(pool: &PgPool, bank: &str, ledger: &str, number: &str, kind: &str) -> Uuid {
    let mut request = describe(ledger, number, kind);
    request.bank_code = Some(bank.into());
    cloud::describe_account(pool, &request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("describe {bank} {number}: {error}"))
        .account_id
}

/// A balanced entry, with the bank leg first so `line 1:` in a refusal is the
/// one under test.
fn entry(kind: &str, bank_leg: &str, bank_account_id: Option<Uuid>) -> PostingIntent {
    // `1102` declares no family (its identity is the bank account) and `1101`
    // declares `pot`, so the contra carries `DRAWER` and the bank leg carries
    // nothing. 0288's trigger refuses either one the other way round.
    let line = |code: &str,
                category: Option<&str>,
                debit_minor: i64,
                credit_minor: i64,
                bank: Option<Uuid>| PostingLine {
        account: LineAccount::Account {
            account_code: code.into(),
            category_code: category.map(str::to_string),
        },
        site_id: HO.into(),
        debit_minor,
        credit_minor,
        supplier_id: None,
        asset_id: None,
        bank_account_id: bank,
        memo: None,
        counter_site_id: None,
    };
    PostingIntent {
        posting_date: september(1),
        source_kind: kind.into(),
        // Every probe here is a rule kind, because the bank accounts are
        // `SEMI_AUTO` (0268) and refuse a hand-written journal before they ever
        // reach the bank check. A rule kind must carry a source, and it has to be
        // its own: 0083 keeps them apart.
        source_id: Some(format!("bank-probe-{kind}-{bank_leg}-{}", Uuid::new_v4())),
        rule_version: "bank_probe/1".into(),
        currency: "IDR".into(),
        memo: Some("bank probe".into()),
        lines: vec![
            line(
                bank_leg,
                (bank_leg == CASH).then_some("DRAWER"),
                100_000,
                0,
                bank_account_id,
            ),
            line(CASH, Some("DRAWER"), 0, 100_000, None),
        ],
    }
}

async fn post(pool: &PgPool, intent: &PostingIntent) -> Result<Uuid, AppError> {
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(&mut tx, intent, None, ACTOR).await?;
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    Ok(posted.entry_id)
}

fn refusal(error: AppError, expected: &str) {
    let message = match error {
        AppError::Validation(message) => message,
        AppError::Conflict(message) => message,
        other => panic!("wanted a refusal with a sentence, got {other:?}"),
    };
    assert!(
        message.contains(expected),
        "refused for the wrong reason.\n  wanted: {expected}\n  got:    {message}"
    );
}

/// 1. The institution is a row, so a spelling cannot become a second bank.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_spelling_cannot_become_a_second_institution(pool: PgPool) {
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bank")
        .fetch_one(&pool)
        .await
        .expect("count banks");
    assert_eq!(before, 6, "the chain seeds the six the owner settled on");

    // Four spellings of one bank. Three resolve; the legal name is not a bank we
    // have, and the refusal says so rather than quietly making one.
    for spelling in ["BCA", "Bank BCA", "BANK BCA"] {
        let mut request = describe(BANK, "1234567890", "GIRO");
        request.bank_name = spelling.into();
        cloud::describe_account(&pool, &request, ACTOR)
            .await
            .unwrap_or_else(|error| panic!("{spelling} should resolve: {error}"));
    }

    let mut invented = describe(BANK, "1234567890", "GIRO");
    invented.bank_name = "PT Bank Central Asia".into();
    refusal(
        cloud::describe_account(&pool, &invented, ACTOR)
            .await
            .expect_err("an unknown institution must be refused, not created"),
        "there is no institution",
    );

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bank")
        .fetch_one(&pool)
        .await
        .expect("count banks");
    assert_eq!(after, 6, "no spelling created an institution");
}

/// 2. An account points at an institution that exists, and 3. at a postable
/// natural account.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_account_points_at_a_real_bank_and_a_postable_ledger_account(pool: PgPool) {
    let account_id = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;

    let row = sqlx::query(
        "SELECT b.code, a.is_group, c.status, c.currency
           FROM company_bank_account c
           JOIN bank b ON b.bank_id = c.bank_id
           JOIN ledger_account a ON a.account_code = c.ledger_account_code
          WHERE c.account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&pool)
    .await
    .expect("read the account back");
    assert_eq!(row.get::<String, _>("code"), "BCA");
    assert!(
        !row.get::<bool, _>("is_group"),
        "a heading takes no postings, so it cannot be a bank account's home"
    );
    assert_eq!(row.get::<String, _>("status"), "ACTIVE");
    assert_eq!(row.get::<String, _>("currency"), "IDR");

    // A heading is refused by the composite foreign key the chart has carried
    // since 0050, before this master existed.
    let mut heading = describe("1", "1234567891", "GIRO");
    heading.bank_code = Some("BCA".into());
    assert!(
        cloud::describe_account(&pool, &heading, ACTOR)
            .await
            .is_err(),
        "a heading cannot hold a bank account"
    );
}

/// 4. A supplier's account is a destination, never our cash.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_suppliers_account_is_not_our_cash(pool: PgPool) {
    // Both halves name the same institution now, which is what let the Banks
    // screen double-count before 0269.
    let shared: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'supplier_bank_account' AND column_name = 'bank_id'",
    )
    .fetch_one(&pool)
    .await
    .expect("look for the column");
    assert_eq!(shared, 1, "a supplier's account names the institution");

    // And it holds no reference to one of ours, in either direction.
    let crossed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pg_constraint
          WHERE contype = 'f'
            AND ((conrelid = 'supplier_bank_account'::regclass
                  AND confrelid = 'company_bank_account'::regclass)
              OR (conrelid = 'company_bank_account'::regclass
                  AND confrelid = 'supplier_bank_account'::regclass))",
    )
    .fetch_one(&pool)
    .await
    .expect("look for a crossing key");
    assert_eq!(
        crossed, 0,
        "our money and somebody else's destination must not reference each other"
    );

    // The institution list counts them apart.
    account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let banks = cloud::bank_institutions(&pool)
        .await
        .expect("list institutions");
    let bca = banks
        .iter()
        .find(|bank| bank.code == "BCA")
        .expect("BCA is in the master");
    assert_eq!(bca.our_accounts, 1);
    assert_eq!(bca.supplier_accounts, 0);
}

/// 7. Two real accounts may share one natural account, and 5. a statement then
/// belongs to exactly one of them.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn two_real_accounts_may_share_one_ledger_account(pool: PgPool) {
    let first = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let second = account_at(&pool, "BCA", BANK, "2234567890", "GIRO").await;
    assert_ne!(first, second, "two numbers are two accounts");

    let sharing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM company_bank_account WHERE ledger_account_code = $1",
    )
    .bind(BANK)
    .fetch_one(&pool)
    .await
    .expect("count accounts on the natural account");
    assert_eq!(
        sharing, 2,
        "0223's UNIQUE (ledger_account_code, site_id) made this impossible; 0269 removed it"
    );

    // Describing the same number again is a correction, not a third account.
    account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let still: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM company_bank_account WHERE ledger_account_code = $1",
    )
    .bind(BANK)
    .fetch_one(&pool)
    .await
    .expect("count again");
    assert_eq!(still, 2, "one number at one bank is one account");
}

/// 11. A posting that must say which account, and does not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_posting_is_refused_when_it_does_not_say_which_account_moved(pool: PgPool) {
    open_september(&pool).await;

    // With nothing registered, the estate posts as it always did.
    post(&pool, &entry("TRANSFER", BANK, None))
        .await
        .expect("no accounts registered, so nothing to name");

    account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    account_at(&pool, "BCA", BANK, "2234567890", "GIRO").await;

    // Two BCA giro accounts is the one case the map cannot settle: `bank_giro`
    // qualified BCA describes both. The refusal says the act rather than the
    // inference — "name the bank account" — because nothing is wrong with the
    // chart and the reader's next move is on the document.
    refusal(
        post(&pool, &entry("TRANSFER", BANK, None))
            .await
            .expect_err("two accounts on one natural account is ambiguous"),
        "name the bank account",
    );
}

/// 12. And the same posting, naming one, succeeds — with the reference kept.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn naming_the_account_is_enough_and_the_reference_is_kept(pool: PgPool) {
    open_september(&pool).await;
    let first = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    account_at(&pool, "BCA", BANK, "2234567890", "GIRO").await;

    let entry_id = post(&pool, &entry("TRANSFER", BANK, Some(first)))
        .await
        .expect("naming one of the two is the answer");

    let kept: Option<Uuid> = sqlx::query_scalar(
        "SELECT bank_account_id FROM journal_line
          WHERE entry_id = $1 AND account_code = $2",
    )
    .bind(entry_id)
    .bind(BANK)
    .fetch_one(&pool)
    .await
    .expect("read the line back");
    assert_eq!(kept, Some(first), "the line remembers which account moved");
}

/// The one-account case resolves itself rather than asking twenty-four posting
/// rules to learn a fact the chart already holds.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn one_account_is_filled_in_without_being_named(pool: PgPool) {
    open_september(&pool).await;
    let only = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;

    let entry_id = post(&pool, &entry("TRANSFER", BANK, None))
        .await
        .expect("one candidate is not an ambiguity");

    let filled: Option<Uuid> = sqlx::query_scalar(
        "SELECT bank_account_id FROM journal_line
          WHERE entry_id = $1 AND account_code = $2",
    )
    .bind(entry_id)
    .bind(BANK)
    .fetch_one(&pool)
    .await
    .expect("read the line back");
    assert_eq!(filled, Some(only));
}

/// A line cannot name an account belonging to another natural account.
///
/// This probe had to move. It used to name BCA's SAVINGS account on a line
/// posted to BCA's GIRO ledger account — two codes, two sets of candidates. All
/// fourteen now share `1102`, so that pair is no longer a pair and the rule
/// cannot be shown there at all. What is left of it, and it is the whole of it:
/// a bank account registered against `1102` cannot be named on a line posted to
/// an account that has none, and `1101 Kas` has none.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_line_cannot_name_an_account_from_somewhere_else(pool: PgPool) {
    open_september(&pool).await;
    let savings = account_at(&pool, "BCA", BANK, "9234567890", "SAVINGS").await;

    refusal(
        post(&pool, &entry("TRANSFER", CASH, Some(savings)))
            .await
            .expect_err("a bank account of 1102's does not belong to 1101"),
        "is not one of",
    );
}

/// 9. A transfer between two of our accounts keeps both references.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_transfer_keeps_both_ends(pool: PgPool) {
    open_september(&pool).await;
    let from = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let to = account_at(&pool, "MANDIRI", BANK, "5234567890", "GIRO").await;

    // Both legs now name their account, and they have to.
    //
    // Before the collapse each bank sat in its own ledger account, so each leg
    // had exactly one candidate and the poster filled it in
    // (`one_account_is_filled_in_without_being_named`). With every bank account
    // on `1102`, a transfer has two candidates on BOTH legs and the poster
    // refuses rather than guess. That auto-fill is effectively gone for banks
    // in any estate with more than one bank account — which is every real one.
    let line = |code: &str, debit_minor: i64, credit_minor: i64, bank: Uuid| PostingLine {
        account: LineAccount::Account {
            account_code: code.into(),
            category_code: None,
        },
        site_id: HO.into(),
        debit_minor,
        credit_minor,
        supplier_id: None,
        asset_id: None,
        bank_account_id: Some(bank),
        memo: None,
        counter_site_id: None,
    };
    let intent = PostingIntent {
        posting_date: september(2),
        source_kind: "TRANSFER".into(),
        source_id: Some(format!("bank-probe-transfer-{}", Uuid::new_v4())),
        rule_version: "bank_probe/1".into(),
        currency: "IDR".into(),
        memo: Some("giro to giro".into()),
        lines: vec![line(BANK, 250_000, 0, to), line(BANK, 0, 250_000, from)],
    };
    let entry_id = post(&pool, &intent).await.expect("a transfer posts");

    let rows = sqlx::query(
        "SELECT account_code, bank_account_id FROM journal_line
          WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry_id)
    .fetch_all(&pool)
    .await
    .expect("read both legs");
    let held: Vec<(String, Option<Uuid>)> = rows
        .iter()
        .map(|row| {
            (
                row.get::<String, _>("account_code"),
                row.get::<Option<Uuid>, _>("bank_account_id"),
            )
        })
        .collect();
    assert_eq!(
        held,
        vec![(BANK.to_string(), Some(to)), (BANK.to_string(), Some(from)),],
        "both ends of a transfer say which real account moved"
    );
}

/// 9b. A closed account takes no ordinary posting, and 10. its history stays
/// readable.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_closed_account_takes_no_new_posting_but_keeps_its_history(pool: PgPool) {
    open_september(&pool).await;
    let closing = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let entry_id = post(&pool, &entry("TRANSFER", BANK, Some(closing)))
        .await
        .expect("posts while open");

    cloud::retire_account(&pool, closing, ACTOR)
        .await
        .expect("retire the account");

    refusal(
        post(&pool, &entry("TRANSFER", BANK, Some(closing)))
            .await
            .expect_err("a closed account takes no ordinary posting"),
        "is closed",
    );

    // An approved correction still reaches it, because a closure booked wrong is
    // exactly the thing a correction exists for — and `1102` is
    // `SEMI_AUTO / OVERRIDE` (0289 inherited it from `1011002001`), which is
    // precisely that permission.
    post(&pool, &entry("ADJUSTMENT", BANK, Some(closing)))
        .await
        .expect("an approved correction reaches a closed account");

    // And what it did is still legible: the row, its institution, and the line.
    let readable: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM journal_line l
           JOIN company_bank_account c ON c.account_id = l.bank_account_id
           JOIN bank b ON b.bank_id = c.bank_id
          WHERE l.entry_id = $1",
    )
    .bind(entry_id)
    .fetch_one(&pool)
    .await
    .expect("read the history");
    assert_eq!(readable, 1, "a closed account's history stays joinable");
}

/// 6. Reconciliation cannot cross two accounts.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn reconciliation_cannot_cross_two_accounts(pool: PgPool) {
    open_september(&pool).await;
    let first = account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let second = account_at(&pool, "BCA", BANK, "2234567890", "GIRO").await;

    // A voucher on the SECOND account.
    let entry_id = post(&pool, &entry("TRANSFER", BANK, Some(second)))
        .await
        .expect("post on the second account");
    let journal_line_id: Uuid = sqlx::query_scalar(
        "SELECT line_id FROM journal_line WHERE entry_id = $1 AND account_code = $2",
    )
    .bind(entry_id)
    .bind(BANK)
    .fetch_one(&pool)
    .await
    .expect("find the bank leg");

    // A statement of the FIRST.
    let statement_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bank_statement
           (statement_id, account_code, site_id, period_start, period_end,
            opening_minor, closing_minor, imported_by, bank_account_id)
         VALUES ($1,$2,$3,$4,$5,0,100000,$6,$7)",
    )
    .bind(statement_id)
    .bind(BANK)
    .bind(HO)
    .bind(september(1))
    .bind(september(30))
    .bind(ACTOR)
    .bind(first)
    .execute(&pool)
    .await
    .expect("file a statement of the first account");

    let line_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO bank_statement_line
           (line_id, statement_id, line_number, value_date, description,
            debit_minor, credit_minor, fingerprint, account_code, counterparty_name,
            bank_said, note)
         VALUES ($1,$2,1,$3,'Transfer',100000,0,$4,$5,'','Transfer','')",
    )
    .bind(line_id)
    .bind(statement_id)
    .bind(september(2))
    .bind(format!("fp-{line_id}"))
    .bind(BANK)
    .execute(&pool)
    .await
    .expect("a line on that statement");

    let crossed = sqlx::query(
        "INSERT INTO bank_line_match
           (match_id, line_id, journal_line_id, decided_by_kind, reasons, matched_by,
            allocated_minor)
         VALUES ($1,$2,$3,'MANUAL','{}',$4,100000)",
    )
    .bind(Uuid::new_v4())
    .bind(line_id)
    .bind(journal_line_id)
    .bind(ACTOR)
    .execute(&pool)
    .await;

    let error =
        crossed.expect_err("a line on one account cannot be agreed with a voucher on another");
    let message = error.to_string();
    assert!(
        message.contains("two different accounts at this bank"),
        "refused for the wrong reason: {message}"
    );
}

/// A statement filed from here on names a real account. The rows that predate the
/// master are exempt and counted, never given an invented account.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_statement_must_name_a_real_account(pool: PgPool) {
    let unnamed = sqlx::query(
        "INSERT INTO bank_statement
           (statement_id, account_code, site_id, period_start, period_end,
            opening_minor, closing_minor, imported_by)
         VALUES ($1,$2,$3,$4,$5,0,0,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(BANK)
    .bind(HO)
    .bind(september(1))
    .bind(september(30))
    .bind(ACTOR)
    .execute(&pool)
    .await;
    assert!(
        unnamed.is_err(),
        "0271's NOT VALID check enforces every new row, exempting only the ones already there"
    );

    let legacy: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bank_statement WHERE bank_account_id IS NULL")
            .fetch_one(&pool)
            .await
            .expect("count the exempt rows");
    assert_eq!(
        legacy, 0,
        "a migrated-from-blank database has no statement history to exempt"
    );
}

// ---------------------------------------------------------------------------
// Phase 2B: banking setup readiness
// ---------------------------------------------------------------------------

/// Map a meaning at a place, the way the seed and the Account Map screen do.
async fn point(pool: &PgPool, key: &str, qualifier: &str, site: &str, code: &str) {
    cloud::set_account_mapping(
        pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: key.into(),
            site_id: site.into(),
            qualifier: qualifier.into(),
            account_code: code.into(),
            // `1102` declares no family. Every bank meaning maps here now, so
            // this helper has nothing to pass and passing something would be
            // refused by `set_account_mapping`.
            category_code: None,
            note: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("map {key}/{qualifier}: {error}"));
}

/// An unmapped bank GL is not a bank GL as far as the estate knows, so a fresh
/// installation migrates and runs before the client's bank data arrives.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn nothing_is_demanded_of_an_account_nobody_called_a_bank_account(pool: PgPool) {
    open_september(&pool).await;

    post(&pool, &entry("TRANSFER", BANK, None))
        .await
        .expect("nothing maps this account, so nothing is owed about it");

    let gaps = cloud::banking_readiness(&pool, HO)
        .await
        .expect("read readiness");
    assert!(
        gaps.is_empty(),
        "a chain that has claimed nothing has delivered nothing to claim: {gaps:?}"
    );
}

/// Saying "our BCA giro money lives here" and registering no account is the state
/// that must not run quietly forever.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn declaring_a_bank_account_without_describing_one_stops_the_posting(pool: PgPool) {
    open_september(&pool).await;
    point(&pool, "bank_giro", "BCA", HO, BANK).await;

    let gaps = cloud::banking_readiness(&pool, HO)
        .await
        .expect("read readiness");
    assert_eq!(gaps.len(), 1, "one thing declared, one thing missing");
    assert_eq!(gaps[0].account_code, BANK);
    assert_eq!(gaps[0].qualifier, "BCA");
    assert_eq!(gaps[0].expected_bank_code.as_deref(), Some("BCA"));
    assert!(
        gaps[0].why.contains("no bank account of ours is described"),
        "the reason says which of the two states it is: {}",
        gaps[0].why
    );

    refusal(
        post(&pool, &entry("TRANSFER", BANK, None))
            .await
            .expect_err("a declared bank account with none registered is refused"),
        "banking setup is incomplete",
    );

    // And describing it completes the setup, without anything else being touched.
    account_at(&pool, "BCA", BANK, "1234567890", "GIRO").await;
    let after = cloud::banking_readiness(&pool, HO)
        .await
        .expect("read readiness again");
    assert!(after.is_empty(), "setup is complete: {after:?}");
    post(&pool, &entry("TRANSFER", BANK, None))
        .await
        .expect("and the posting goes through");
}

/// An opening balance still lands. History arriving is not a thing to hold up
/// for a master that did not exist when it happened.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_opening_balance_is_not_held_up_by_an_unfinished_setup(pool: PgPool) {
    open_september(&pool).await;
    point(&pool, "bank_giro", "BCA", HO, BANK).await;

    post(&pool, &entry("OPENING", BANK, None))
        .await
        .expect("an opening balance reaches an account the setup has not finished");
}

/// A dormant bank GL needs no fake account: it is simply not mapped, and mapping
/// is the declaration. A registered account that is DORMANT is not coverage
/// either — "exists, unused" is not "use this one".
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_dormant_account_is_not_coverage(pool: PgPool) {
    open_september(&pool).await;
    point(&pool, "bank_savings", "BCA", HO, BANK).await;
    let dormant = account_at(&pool, "BCA", BANK, "9234567890", "SAVINGS").await;
    sqlx::query("UPDATE company_bank_account SET status = 'DORMANT' WHERE account_id = $1")
        .bind(dormant)
        .execute(&pool)
        .await
        .expect("mark it dormant");

    let gaps = cloud::banking_readiness(&pool, HO)
        .await
        .expect("read readiness");
    assert_eq!(gaps.len(), 1);
    assert!(
        gaps[0].why.contains("dormant or closed"),
        "the reason distinguishes an unfinished setup from a decision: {}",
        gaps[0].why
    );
}

/// A company-dimension account mapped at a shop is a mapping nothing can use, so
/// it is not a gap. Demanding coverage for it would demand thirteen bank accounts
/// no shop has.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bank_mapping_at_a_shop_is_not_a_gap(pool: PgPool) {
    point(&pool, "bank_giro", "BCA", SHOP, BANK).await;

    let gaps = cloud::banking_readiness(&pool, HO)
        .await
        .expect("read readiness");
    assert!(
        gaps.is_empty(),
        "1102 posts at head office and nowhere else, so a shop mapping asks for nothing: {gaps:?}"
    );
}
