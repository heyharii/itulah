//! The account's own posting policy, proved by being refused.
//!
//! A validator that has only ever been compiled is a validator nobody has seen
//! say no. Every test here drives `poster::post` — the single writer — and
//! asserts on the REFUSAL, because the failure paths are the whole feature. The
//! two that succeed are here to prove the refusals are not simply "everything
//! is refused".
//!
//! The chart is not seeded. Since 0243 the migrations write the client's own
//! and 0289 collapsed it to forty; these tests name real accounts from it:
//!
//!     1101  Kas                         dimension = unit,    category `pot`
//!     2101  Hutang usaha                dimension = company, supplier_id
//!     1102  Bank                        dimension = company, bank_account_id
//!     1302  Barang dalam perjalanan     requires_counter_site, `item_class`
//!
//! Policy is set with raw SQL rather than through an endpoint, deliberately: the
//! endpoint that edits a posting profile does not exist yet, and the guarantee
//! under test is the validator's, not a screen's.

use chrono::NaiveDate;
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres::{self as cloud, LineAccount, PostingIntent, PostingLine};
use sqlx::PgPool;
use uuid;

const ACTOR: &str = "ana";
const APPROVER: &str = "budi";
const CASH: &str = "1101";
const PAYABLE: &str = "2101";
const COMPANY_BANK: &str = "1102";
const IN_TRANSIT: &str = "1302";
/// The replacement reserve, and the expense that forms it. Two paths, one of
/// which the owner has ruled on and one of which is still pending.
const RESERVE: &str = "1610";
const RESERVE_EXPENSE: &str = "7101";
/// Migration-only by owner decision (0267): the prepayment came across and must
/// not grow. Its allow-list is `OPENING` and nothing else — see the gap noted
/// on the test that reads it.
const PREPAID_PPH29: &str = "1402";

/// The category each of the accounts above takes, or `None` where its identity
/// is a column instead.
///
/// A category is not decoration to a policy test: 0288's trigger refuses a
/// missing one before `validate_account_posting` is ever reached, so a probe
/// without this would prove that the category trigger works and nothing about
/// the policy it was written for.
fn category_for(code: &str) -> Option<&'static str> {
    match code {
        CASH => Some("DRAWER"),
        IN_TRANSIT => Some("MERCHANDISE"),
        PREPAID_PPH29 => Some("PPH29"),
        // 0294: the charge account carries all three kinds, because the client
        // does not depreciate operating equipment and a P&L that could not say
        // so had lost the distinction 0159 exists for.
        RESERVE_EXPENSE => Some("REPLACEMENT"),
        // `2101` by supplier, `1102` by bank account, `1610` by asset. None of
        // the three declares a family.
        _ => None,
    }
}
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

async fn set_policy(pool: &PgPool, code: &str, mode: &str, manual: &str) {
    sqlx::query(
        "UPDATE ledger_account SET posting_mode = $2, manual_je_policy = $3
          WHERE account_code = $1",
    )
    .bind(code)
    .bind(mode)
    .bind(manual)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("set policy on {code}: {error}"));
}

async fn rule(pool: &PgPool, code: &str, kind: &str, effect: &str) {
    sqlx::query(
        // Restating rather than inserting: 0268 ships the reserve's own DENY row
        // in the chain, so a test that wants it there finds it already there.
        //
        // The conflict target spells the coalesce because that is the index now.
        // 0294 dropped the primary key — NULL is the value that means "the whole
        // account", and a key cannot hold one — for a unique index over
        // `(account_code, source_kind, COALESCE(category_code, ''))`, and an
        // `ON CONFLICT` naming only the first two matches nothing.
        "INSERT INTO account_source_rule (account_code, source_kind, effect, set_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_code, source_kind, COALESCE(category_code, ''))
         DO UPDATE SET effect = EXCLUDED.effect",
    )
    .bind(code)
    .bind(kind)
    .bind(effect)
    .bind(APPROVER)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("{effect} {kind} on {code}: {error}"));
}

/// A balanced two-line entry naming its accounts directly, which is what a
/// person writing a journal does and what every policy here is about.
fn entry(
    kind: &str,
    debit: &str,
    credit: &str,
    site: &str,
    counter: Option<&str>,
) -> PostingIntent {
    let line = |code: &str, debit_minor: i64, credit_minor: i64| PostingLine {
        account: LineAccount::Account {
            account_code: code.into(),
            category_code: category_for(code).map(str::to_string),
        },
        site_id: site.into(),
        debit_minor,
        credit_minor,
        supplier_id: None,
        asset_id: None,
        bank_account_id: None,
        memo: None,
        counter_site_id: counter.map(str::to_string),
    };
    PostingIntent {
        posting_date: september(1),
        source_kind: kind.into(),
        // `MANUAL` is the one kind 0083 forbids a source on; everything else
        // requires one.
        // A uuid, not a sentence: 0273 requires a `SALE_DAY` entry to be named by
        // its posting's id, and these probes use whichever kinds the policy under
        // test admits. `MANUAL` is the one kind 0083 forbids a source on.
        source_id: if kind == "MANUAL" {
            None
        } else {
            Some(uuid::Uuid::new_v4().to_string())
        },
        rule_version: "policy_probe/1".into(),
        currency: "IDR".into(),
        memo: Some("policy probe".into()),
        lines: vec![line(debit, 100_000, 0), line(credit, 0, 100_000)],
    }
}

async fn post(pool: &PgPool, intent: &PostingIntent) -> Result<(), AppError> {
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    cloud::post(&mut tx, intent, None, ACTOR).await?;
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    Ok(())
}

/// The message matters as much as the refusal. A validation error that does not
/// name the account or say what to do instead sends somebody to read code.
fn refusal(error: AppError, expected: &str) {
    match error {
        AppError::Validation(message) => assert!(
            message.contains(expected),
            "refused for the wrong reason.\n  wanted: {expected}\n  got:    {message}"
        ),
        other => panic!("wanted a validation refusal, got {other:?}"),
    }
}

/// 1. A person cannot name an account only a rule may move.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_manual_entry_cannot_name_an_auto_only_account(pool: PgPool) {
    open_september(&pool).await;
    set_policy(&pool, CASH, "AUTO_ONLY", "YES").await;
    let error = post(&pool, &entry("MANUAL", CASH, PAYABLE, HO, None))
        .await
        .expect_err("AUTO_ONLY must refuse a hand-written entry");
    refusal(error, "posted only by a rule");
}

/// 2. `manual_je_policy = 'NO'` is enforced by the server, corrections included.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn manual_je_no_refuses_a_hand_written_entry(pool: PgPool) {
    open_september(&pool).await;
    // SEMI_AUTO deliberately: the refusal has to come from `manual_je_policy`
    // and not from the posting mode, or the test proves the wrong rule.
    set_policy(&pool, CASH, "SEMI_AUTO", "NO").await;
    let error = post(&pool, &entry("MANUAL", CASH, PAYABLE, HO, None))
        .await
        .expect_err("manual_je_policy = NO must refuse a journal");
    refusal(error, "does not take hand-written entries");

    let error = post(&pool, &entry("RECLASS", CASH, PAYABLE, HO, None))
        .await
        .expect_err("NO means corrections too");
    refusal(error, "corrections included");
}

/// 3. `OVERRIDE` is the third value and it has to differ from both: a journal is
///    refused, an approved correction is not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn override_refuses_a_journal_and_admits_a_correction(pool: PgPool) {
    open_september(&pool).await;
    set_policy(&pool, CASH, "SEMI_AUTO", "OVERRIDE").await;
    set_policy(&pool, PAYABLE, "SEMI_AUTO", "OVERRIDE").await;

    let error = post(&pool, &entry("MANUAL", CASH, PAYABLE, HO, None))
        .await
        .expect_err("OVERRIDE must refuse a plain journal");
    refusal(error, "may be corrected but not journalled");

    post(&pool, &entry("ADJUSTMENT", CASH, PAYABLE, HO, None))
        .await
        .unwrap_or_else(|error| panic!("OVERRIDE must admit a correction: {error}"));
}

/// 4. An account that belongs to the company does not post at a shop.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_company_account_refuses_a_line_at_a_shop(pool: PgPool) {
    open_september(&pool).await;
    let error = post(
        &pool,
        &entry("SUPPLIER_INVOICE", COMPANY_BANK, PAYABLE, SHOP, None),
    )
    .await
    .expect_err("a company account must refuse a line at a shop");
    refusal(error, "belongs to the company and not to a shop");

    // And the same entry at head office is fine, which is what makes the
    // refusal above about the SITE rather than about the account.
    post(
        &pool,
        &entry("SUPPLIER_INVOICE", COMPANY_BANK, PAYABLE, HO, None),
    )
    .await
    .unwrap_or_else(|error| panic!("the same line at head office: {error}"));
}

/// 5. A balance between two units has to say which two.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_account_that_needs_the_other_unit_refuses_a_line_without_it(pool: PgPool) {
    open_september(&pool).await;
    let error = post(&pool, &entry("TRANSFER", IN_TRANSIT, PAYABLE, HO, None))
        .await
        .expect_err("goods in transit must name the other unit");
    refusal(error, "say which unit is on the other side");

    post(
        &pool,
        &entry("TRANSFER", IN_TRANSIT, PAYABLE, HO, Some(SHOP)),
    )
    .await
    .unwrap_or_else(|error| panic!("naming the other unit should be enough: {error}"));
}

/// 6. A document the account does not take is refused, and the message says
///    which ones it does.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_source_kind_outside_the_allow_list_is_refused(pool: PgPool) {
    open_september(&pool).await;
    rule(&pool, CASH, "SALE_DAY", "ALLOW").await;
    rule(&pool, CASH, "DEPOSIT", "ALLOW").await;
    let error = post(&pool, &entry("SUPPLIER_INVOICE", CASH, PAYABLE, HO, None))
        .await
        .expect_err("a kind outside the allow-list must be refused");
    refusal(error, "does not take a SUPPLIER_INVOICE posting");
    // The list is spelled in the message, sorted, so the fix is on screen.
    refusal(
        post(&pool, &entry("PAYMENT", CASH, PAYABLE, HO, None))
            .await
            .expect_err("still refused"),
        "reached by DEPOSIT, SALE_DAY",
    );
}

/// 7. And the kind that IS allowed posts — otherwise every test above could be
///    passing because nothing posts at all.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_source_kind_inside_the_allow_list_posts(pool: PgPool) {
    open_september(&pool).await;
    rule(&pool, CASH, "SALE_DAY", "ALLOW").await;
    rule(&pool, PAYABLE, "SALE_DAY", "ALLOW").await;
    post(&pool, &entry("SALE_DAY", CASH, PAYABLE, HO, None))
        .await
        .unwrap_or_else(|error| panic!("an allowed kind must post: {error}"));
}

/// 8. `BLOCKED` admits nothing at all — not a rule, not a person, not an
///    approved correction. 0263, and the reserve the owner has not ruled on.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_blocked_account_refuses_every_kind(pool: PgPool) {
    open_september(&pool).await;
    set_policy(&pool, CASH, "BLOCKED", "YES").await;
    // Every shape of caller: a person, an approved correction, and two rules.
    // `manual_je_policy` is left at the most permissive value on purpose, so the
    // refusal can only be coming from BLOCKED.
    for kind in ["MANUAL", "ADJUSTMENT", "SALE_DAY", "SUPPLIER_INVOICE"] {
        let error = post(&pool, &entry(kind, CASH, PAYABLE, HO, None))
            .await
            .expect_err("BLOCKED must refuse every kind");
        refusal(error, "takes no postings at all");
        let _ = kind;
    }
}

/// 9. The replacement reserve: one path held, the account still usable.
///
/// This is the case `effect = 'DENY'` exists for, and the reason account-level
/// BLOCKED is too coarse. The owner has ruled that the draw-down is known and
/// that what CREATES the reserve is not decided. So the formation kind is refused
/// and everything else on the account keeps working — including the draw, which
/// is a supplier bill that debits the reserve (`postgres::payables`).
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_reserve_refuses_its_formation_and_still_takes_the_draw(pool: PgPool) {
    open_september(&pool).await;
    rule(&pool, RESERVE, "ASSET_RESERVE", "DENY").await;

    let error = post(
        &pool,
        &entry("ASSET_RESERVE", RESERVE_EXPENSE, RESERVE, HO, None),
    )
    .await
    .expect_err("forming the reserve is pending policy and must be refused");
    refusal(error, "that path is held pending a policy");

    // The same account, the other direction, the approved document. If this were
    // refused too the mechanism would be BLOCKED wearing a different name.
    post(
        &pool,
        &entry("SUPPLIER_INVOICE", RESERVE, PAYABLE, HO, None),
    )
    .await
    .unwrap_or_else(|error| panic!("the draw-down must still post: {error}"));
}

/// 10. DENY beats ALLOW, because a rule that could be talked out of itself by a
///     second row is not a rule.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn deny_wins_over_allow_for_the_same_kind(pool: PgPool) {
    open_september(&pool).await;
    rule(&pool, CASH, "SALE_DAY", "ALLOW").await;
    sqlx::query(
        "UPDATE account_source_rule SET effect = 'DENY'
          WHERE account_code = $1 AND source_kind = 'SALE_DAY'",
    )
    .bind(CASH)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("flip to DENY: {error}"));
    let error = post(&pool, &entry("SALE_DAY", CASH, PAYABLE, HO, None))
        .await
        .expect_err("a denied kind is refused even where it would otherwise be allowed");
    refusal(error, "held pending a policy");
}

/// 11. A migration-only account takes the migration and nothing else.
///
/// `1011302003 Prepaid - PPh Pasal 29` was the sharpest case the ALLOW
/// direction has: the owner ruled it may not grow, its obligation lives at
/// `2201 × PPH29` (0265's `2012101006`), and offsetting the two is a tax return
/// nobody has filed. Both halves of that come from migrations, so this needs no
/// seed.
///
/// This was red, and why is worth keeping written down.
///
/// The account is `1402 × PPH29` now, and 0267's `ALLOW OPENING` row sat on
/// `1011302003`, which no longer posts. 0291 said `account_source_rule` was
/// "already on the new codes"; it was not, and the same was true of
/// `1021607001 ASSET_RESERVE DENY` (0268) and both of `7010216002`'s rows
/// (0267). Four owner decisions about which documents may reach an account,
/// silently not in force.
///
/// Moving them was not a mechanical remap either, and that was the harder half:
/// the table was keyed on the ACCOUNT alone, so an `ALLOW OPENING`-only list on
/// `1402` would have frozen PPN masukan and PPh 25 with it, and both move every
/// month. 0294 gave the table the category grain `account_category_policy`
/// already had, and `validate_account_posting` reads a rule with a category as
/// applying to that pairing and one without as applying to the account — which
/// is what every rule written before 0294 meant.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_migration_only_account_takes_opening_and_nothing_else(pool: PgPool) {
    open_september(&pool).await;

    let error = post(
        &pool,
        &entry("SUPPLIER_INVOICE", PREPAID_PPH29, PAYABLE, HO, None),
    )
    .await
    .expect_err("a migration-only account must refuse an ordinary bill");
    refusal(error, "does not take a SUPPLIER_INVOICE posting");

    post(&pool, &entry("OPENING", PREPAID_PPH29, PAYABLE, HO, None))
        .await
        .unwrap_or_else(|error| panic!("the opening balance must still land: {error}"));
}

/// 12. The three kinds 0266 added are accepted by the journal.
///
/// A source kind the CHECK does not allow is refused by the database with a
/// constraint violation rather than by the validator, so this proves the
/// vocabulary landed — and it is the guard against the mistake 0257 documents,
/// where a kind the code writes is not a kind the schema permits.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_three_new_source_kinds_are_accepted(pool: PgPool) {
    open_september(&pool).await;
    for kind in ["PAYROLL_RUN", "TAX_SETTLEMENT", "AMORTIZATION_RUN"] {
        post(&pool, &entry(kind, CASH, PAYABLE, HO, None))
            .await
            .unwrap_or_else(|error| panic!("{kind} must be a kind the journal takes: {error}"));
    }
}
