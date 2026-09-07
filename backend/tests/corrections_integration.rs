//! The three corrections, as documents rather than as opinions.
//!
//! Before this module the only ways to correct the books were a reversal —
//! right when an entry should never have existed — and a MANUAL journal entry,
//! which is what everything else became. A manual entry records a debit, a
//! credit and a memo. It does not record who decided, who agreed, or what
//! evidence there was, and those three are the whole of what makes a correction
//! auditable rather than a second opinion typed into the ledger.
//!
//! So every test here is about one of those three, or about the ledger arriving
//! where the document said it would.

use inventory_backend::cloud::application::{AppError, CreateUserRequest};
use inventory_backend::cloud::postgres::{self as cloud, PostingIntent, PostingLine};

use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

const MAKER: &str = "ana";
const CHECKER: &str = "budi";

// ---------------------------------------------------------------------------
// A chart shaped like the client's
// ---------------------------------------------------------------------------

async fn seed_chart(pool: &PgPool) {
    // Parents before children, and every parent a prefix of its child — which
    // the schema checks, and which matters because a balance rolls up by prefix.
    let tree: &[(&str, &str, Option<&str>)] = &[
        ("1", "ASSET", None),
        ("101", "CURRENT ASSET", Some("1")),
        ("10110", "KAS DAN BANK", Some("101")),
        ("1011001", "KAS", Some("10110")),
        ("10112", "INVENTORY", Some("101")),
        ("1011201", "Persediaan Barang Dagang", Some("10112")),
        ("10113", "PREPAID", Some("101")),
        ("1011301", "Biaya Dibayar Dimuka", Some("10113")),
        ("2", "LIABILITIES", None),
        ("201", "HUTANG JANGKA PENDEK", Some("2")),
        ("20120", "HUTANG DAGANG", Some("201")),
        ("2012001", "HUTANG SUPPLIER", Some("20120")),
        ("8", "BEBAN  NON OPERASIONAL", None),
        ("801", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("8")),
        ("80101", "PENDAPATAN DAN (BIAYA) LAIN - LAIN", Some("801")),
        ("8010110", "Pendapatan (Biaya) Lain-lain", Some("80101")),
    ];
    for (code, name, parent) in tree {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group)
             VALUES ($1,$2,$3,true)",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    let leaves: &[(&str, &str, &str)] = &[
        ("101100100100", "Kas Besar HO", "1011001"),
        ("101120100100", "Persediaan Barang Dagangan HO", "1011201"),
        ("101130100100", "Biaya Dibayar Dimuka HO", "1011301"),
        (
            "201200100100",
            "Hutang Suppliers Barang Dagangan HO",
            "2012001",
        ),
        // 8010110007 is where the client files income and expense that has no
        // other home. Both write-off sides land there; so does asset disposal.
        ("801011000700", "Pendapatan (Biaya) Lain-Lain HO", "8010110"),
        (
            "801011000600",
            "Kehilangan Barang atau Selisih Stock Opname HO",
            "8010110",
        ),
        // 8010110008 does not exist in the client's chart. Store money proposes
        // it for cash over and short and this is the same proposal, seeded so
        // the adjustment below has somewhere to go.
        ("801011000800", "Selisih Kas HO", "8010110"),
    ];
    for (code, name, parent) in leaves {
        sqlx::query(
            "INSERT INTO ledger_account (account_code, name, parent_code, is_group, site_id)
             VALUES ($1,$2,$3,false,'dc')",
        )
        .bind(code)
        .bind(name)
        .bind(parent)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("{code}: {error}"));
    }
    for (key, code) in [
        ("cash", "101100100100"),
        ("inventory", "101120100100"),
        ("prepaid_expense", "101130100100"),
        ("trade_payable", "201200100100"),
        ("other_income_expense", "801011000700"),
        ("bad_debt_expense", "801011000700"),
        ("cash_variance", "801011000800"),
        ("stock_loss", "801011000600"),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: "dc".into(),
                qualifier: String::new(),
                account_code: code.into(),
                note: None,
            },
            MAKER,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key}: {error}"));
    }
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open september: {error}"));
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

fn as_shown_to_a_person(error: &AppError) -> String {
    match error {
        AppError::Database(sqlx::Error::Database(db)) if db.code().as_deref() == Some("P0001") => {
            db.message().to_string()
        }
        other => other.to_string(),
    }
}

async fn balance(pool: &PgPool, code: &str) -> i64 {
    cloud::account_balance(pool, code, None, None)
        .await
        .unwrap_or_else(|error| panic!("balance {code}: {error}"))
        .balance_minor
}

/// Post an entry directly, so a test can arrange the line a correction will
/// later move. Everything a correction itself writes still goes through the
/// poster; this is only the "before".
async fn post_entry(pool: &PgPool, debit: &str, credit: &str, amount: i64, source: &str) -> Uuid {
    let intent = PostingIntent {
        posting_date: september(2),
        source_kind: "MANUAL".into(),
        source_id: None,
        rule_version: "test/1".into(),
        currency: "IDR".into(),
        memo: Some(source.into()),
        lines: vec![
            PostingLine::debit(debit, "dc", amount),
            PostingLine::credit(credit, "dc", amount),
        ],
    };
    let mut tx = pool
        .begin()
        .await
        .unwrap_or_else(|error| panic!("begin: {error}"));
    let posted = cloud::post(&mut tx, &intent, None, MAKER)
        .await
        .unwrap_or_else(|error| panic!("post {source}: {error}"));
    tx.commit()
        .await
        .unwrap_or_else(|error| panic!("commit: {error}"));
    posted.entry_id
}

/// The line of an entry that sits on one account.
async fn line_on(pool: &PgPool, entry_id: Uuid, code: &str) -> Uuid {
    sqlx::query_scalar("SELECT line_id FROM journal_line WHERE entry_id=$1 AND account_code=$2")
        .bind(entry_id)
        .bind(code)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("line on {code}: {error}"))
}

/// Draft, agree, post — the lifecycle every correction goes through, written
/// once so the tests below are about what each correction MEANS.
async fn agree_and_post(pool: &PgPool, correction_id: Uuid) -> cloud::CorrectionDocument {
    let approved = cloud::correction_approve(pool, correction_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {}", as_shown_to_a_person(&error)));
    assert_eq!(approved.status, "APPROVED");
    let posted = cloud::correction_post(pool, correction_id, None, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("post: {}", as_shown_to_a_person(&error)));
    assert_eq!(posted.status, "POSTED");
    posted
}

// ---------------------------------------------------------------------------
// Reclassification
// ---------------------------------------------------------------------------

/// A reclassification moves an amount and leaves the books footing.
///
/// The half worth watching is the side it moves the amount OFF: the original
/// line's own account code, copied, never re-resolved through `account_map`. If
/// the map has moved since the original posted, resolving the meaning afresh
/// would credit an account the original never debited — and the books would be
/// wrong in two places by the same amount while the trial balance still footed.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reclassification_credits_back_the_account_the_original_actually_used(pool: PgPool) {
    seed_chart(&pool).await;
    let entry = post_entry(&pool, "inventory", "trade_payable", 10_000_000, "a bill").await;
    let inventory_line = line_on(&pool, entry, "101120100100").await;

    // The map moves after the original posted. This is the trap.
    cloud::set_account_mapping(
        &pool,
        &cloud::SetAccountMappingRequest {
            semantic_key: "inventory".into(),
            site_id: "dc".into(),
            qualifier: String::new(),
            account_code: "101130100100".into(),
            note: Some("somebody remapped inventory".into()),
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("remap: {error}"));

    let drafted = cloud::reclass_create(
        &pool,
        &cloud::ReclassRequest {
            source_line_id: inventory_line,
            target_key: "prepaid_expense".into(),
            target_qualifier: String::new(),
            target_site_id: None,
            amount_minor: 2_500_000,
            document_date: Some(september(5)),
            reason: "the freight portion was capitalised in error".into(),
            note: None,
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {}", as_shown_to_a_person(&error)));
    assert_eq!(drafted.status, "DRAFT", "drafting is not posting");
    assert_eq!(drafted.kind, "RECLASS");

    agree_and_post(&pool, drafted.correction_id).await;

    assert_eq!(
        balance(&pool, "101120100100").await,
        7_500_000,
        "the amount left the account the original really used"
    );
    assert_eq!(
        balance(&pool, "101130100100").await,
        2_500_000,
        "and arrived where the document said, once"
    );
    let trial = cloud::trial_balance(&pool, september(30), None)
        .await
        .unwrap_or_else(|error| panic!("trial balance: {error}"));
    assert!(
        trial.balanced,
        "a correction that unbalanced the books would be the opposite of a correction: {} vs {}",
        trial.total_debit_minor, trial.total_credit_minor
    );
}

/// Money never moves by reclassification.
///
/// Moving an amount between cash accounts is a transfer and it has a document
/// of its own. A reclassification that could touch cash would be a way to make
/// the cash balance say something the cash count does not, with no counting
/// anywhere in the story.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reclassification_refuses_a_cash_account_on_either_side(pool: PgPool) {
    seed_chart(&pool).await;
    let entry = post_entry(&pool, "cash", "trade_payable", 4_000_000, "a receipt").await;
    let cash_line = line_on(&pool, entry, "101100100100").await;
    let payable_line = line_on(&pool, entry, "201200100100").await;

    let from_cash = cloud::reclass_create(
        &pool,
        &cloud::ReclassRequest {
            source_line_id: cash_line,
            target_key: "prepaid_expense".into(),
            target_qualifier: String::new(),
            target_site_id: None,
            amount_minor: 1_000_000,
            document_date: Some(september(5)),
            reason: "tidying".into(),
            note: None,
        },
        MAKER,
    )
    .await
    .expect_err("a cash line must not be reclassified off");
    let shown = as_shown_to_a_person(&from_cash);
    assert!(
        shown.contains("cash") && shown.contains("transfer"),
        "the refusal says what the right document is: {shown}"
    );

    let to_cash = cloud::reclass_create(
        &pool,
        &cloud::ReclassRequest {
            source_line_id: payable_line,
            target_key: "cash".into(),
            target_qualifier: String::new(),
            target_site_id: None,
            amount_minor: 1_000_000,
            document_date: Some(september(5)),
            reason: "tidying".into(),
            note: None,
        },
        MAKER,
    )
    .await
    .expect_err("nor onto one");
    assert!(as_shown_to_a_person(&to_cash).contains("transfer"));

    assert_eq!(
        balance(&pool, "101100100100").await,
        4_000_000,
        "neither refusal moved anything"
    );
}

// ---------------------------------------------------------------------------
// Adjustment
// ---------------------------------------------------------------------------

/// A till is short, and the adjustment says which shift it was short on.
///
/// The evidence is the point. "Cash is 150,000 lower than it should be" is a
/// number somebody typed; "cash is 150,000 lower than it should be on shift
/// SHIFT-7788, and here is who agreed" is a document.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_adjustment_for_a_cash_shortage_posts_against_the_shift_it_names(pool: PgPool) {
    seed_chart(&pool).await;
    post_entry(&pool, "cash", "trade_payable", 5_000_000, "the float").await;

    let drafted = cloud::adjustment_create(
        &pool,
        &cloud::AdjustmentRequest {
            adjustment_kind: "CASH_OVER_SHORT".into(),
            direction: "LOSS".into(),
            site_id: "dc".into(),
            amount_minor: 150_000,
            evidence_kind: Some("SHIFT".into()),
            evidence_ref: Some("SHIFT-7788".into()),
            document_date: Some(september(6)),
            reason: "counted short at handover, not found".into(),
            note: None,
            other_key: None,
            other_qualifier: String::new(),
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {}", as_shown_to_a_person(&error)));
    assert_eq!(drafted.evidence_kind.as_deref(), Some("SHIFT"));
    assert_eq!(drafted.evidence_ref.as_deref(), Some("SHIFT-7788"));

    let posted = agree_and_post(&pool, drafted.correction_id).await;

    assert_eq!(
        balance(&pool, "101100100100").await,
        4_850_000,
        "the shortage came out of cash"
    );
    assert_eq!(
        balance(&pool, "801011000800").await,
        150_000,
        "and landed in cash over and short, not in a rounding account"
    );

    // The entry can be found from the shift, which is the question somebody
    // actually asks: what did this shift cost us.
    let kind: String =
        sqlx::query_scalar("SELECT source_kind FROM journal_entry WHERE entry_id=$1")
            .bind(
                posted
                    .journal_entry_id
                    .unwrap_or_else(|| panic!("a posted correction has an entry")),
            )
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("kind: {error}"));
    assert_eq!(kind, "ADJUSTMENT");
}

// ---------------------------------------------------------------------------
// Write-off
// ---------------------------------------------------------------------------

/// A write-off gives up on a named balance and says which item it closes.
///
/// The reference is what ties the document to the Payment Ledger item it
/// settles. Without it a write-off is an amount leaving an account, and the
/// question "which of these forty invoices did we give up on" has no answer.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_write_off_names_the_item_it_closes_and_clears_that_balance(pool: PgPool) {
    seed_chart(&pool).await;
    post_entry(&pool, "inventory", "trade_payable", 3_000_000, "a bill").await;

    let drafted = cloud::write_off_create(
        &pool,
        &cloud::WriteOffRequest {
            balance_side: "PAYABLE".into(),
            balance_key: "trade_payable".into(),
            balance_qualifier: String::new(),
            site_id: "dc".into(),
            amount_minor: 3_000_000,
            counterparty: Some("SUP01".into()),
            balance_ref: Some("PL-ITEM-0042".into()),
            document_date: Some(september(7)),
            reason: "supplier dissolved; the debt will not be collected".into(),
            note: None,
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {}", as_shown_to_a_person(&error)));
    assert_eq!(
        drafted.balance_ref.as_deref(),
        Some("PL-ITEM-0042"),
        "the document names the ledger item it closes"
    );

    agree_and_post(&pool, drafted.correction_id).await;

    assert_eq!(
        balance(&pool, "201200100100").await,
        0,
        "the payable is gone"
    );
    assert_eq!(
        balance(&pool, "801011000700").await,
        -3_000_000,
        "a payable given up on is income, on the leaf the client keeps it under"
    );
}

// ---------------------------------------------------------------------------
// The two-person rule, and the way back
// ---------------------------------------------------------------------------

/// A correction one person completes alone is not a control.
///
/// Checked three ways, because the rule is worth more than one of them: the
/// infrastructure refuses it, a CHECK on the row refuses it, and the two action
/// keys are distinct so that the refusal is expressible at all.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_person_who_wrote_it_is_not_the_person_who_agrees_to_it(pool: PgPool) {
    seed_chart(&pool).await;
    for username in [MAKER, CHECKER] {
        cloud::create_user(
            &pool,
            CreateUserRequest {
                username: username.into(),
                display_name: username.into(),
                password: "a-long-enough-password".into(),
                role: inventory_backend::cloud::domain::Role::Admin.into(),
            },
            "test",
        )
        .await
        .unwrap_or_else(|error| panic!("create {username}: {error}"));
    }

    let drafted = cloud::adjustment_create(
        &pool,
        &cloud::AdjustmentRequest {
            adjustment_kind: "STOCK_LOSS".into(),
            direction: "LOSS".into(),
            site_id: "dc".into(),
            amount_minor: 400_000,
            evidence_kind: Some("COUNT".into()),
            evidence_ref: Some("COUNT-31".into()),
            document_date: Some(september(8)),
            reason: "three jackets missing at the count".into(),
            note: None,
            other_key: None,
            other_qualifier: String::new(),
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {}", as_shown_to_a_person(&error)));

    let refusal = cloud::correction_approve(&pool, drafted.correction_id, MAKER)
        .await
        .expect_err("the author must not be the approver");
    assert!(
        matches!(refusal, AppError::Forbidden(_)),
        "and it is a refusal of authority, not a validation quibble: {refusal:?}"
    );

    // Past the application, straight at the table. A rule that only holds when
    // you use the front door is not a rule.
    let behind_the_back = sqlx::query(
        "UPDATE correction_document SET status='APPROVED', approved_by=$2, approved_at=now()
          WHERE correction_id=$1",
    )
    .bind(drafted.correction_id)
    .bind(MAKER)
    .execute(&pool)
    .await;
    assert!(
        behind_the_back.is_err(),
        "the database refuses a maker who is also the checker"
    );

    let approved = cloud::correction_approve(&pool, drafted.correction_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {}", as_shown_to_a_person(&error)));
    assert_eq!(approved.approved_by.as_deref(), Some(CHECKER));
    assert_eq!(approved.created_by, MAKER);

    // Approving twice is not a second agreement, it is a race.
    assert!(
        cloud::correction_approve(&pool, drafted.correction_id, CHECKER)
            .await
            .is_err(),
        "an approved correction is not waiting to be approved"
    );
}

/// A posted correction is undone by its mirror, never by deleting it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_posted_correction_is_undone_by_a_mirror_and_never_erased(pool: PgPool) {
    seed_chart(&pool).await;
    post_entry(&pool, "inventory", "trade_payable", 1_000_000, "a bill").await;

    let drafted = cloud::adjustment_create(
        &pool,
        &cloud::AdjustmentRequest {
            adjustment_kind: "STOCK_LOSS".into(),
            direction: "LOSS".into(),
            site_id: "dc".into(),
            amount_minor: 250_000,
            evidence_kind: Some("COUNT".into()),
            evidence_ref: Some("COUNT-9".into()),
            document_date: Some(september(9)),
            reason: "shrinkage at the quarterly count".into(),
            note: None,
            other_key: None,
            other_qualifier: String::new(),
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {}", as_shown_to_a_person(&error)));
    agree_and_post(&pool, drafted.correction_id).await;
    assert_eq!(balance(&pool, "101120100100").await, 750_000);

    let reversed = cloud::correction_reverse(
        &pool,
        drafted.correction_id,
        Some(september(10)),
        "the jackets were in the stockroom after all",
        CHECKER,
    )
    .await
    .unwrap_or_else(|error| panic!("reverse: {}", as_shown_to_a_person(&error)));
    assert_eq!(reversed.status, "REVERSED");
    assert!(reversed.reversal_entry_id.is_some());
    assert_eq!(
        balance(&pool, "101120100100").await,
        1_000_000,
        "the mirror put the stock back"
    );

    // Both entries are still there. Correcting a correction adds a row.
    let entries: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM journal_entry WHERE source_kind IN ('ADJUSTMENT','REVERSAL')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(entries, 2, "the original and its mirror, both readable");
}

/// A correction cannot be posted into a month that has been sealed.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_correction_cannot_be_posted_into_a_closed_month(pool: PgPool) {
    seed_chart(&pool).await;
    post_entry(&pool, "inventory", "trade_payable", 1_000_000, "a bill").await;
    let drafted = cloud::adjustment_create(
        &pool,
        &cloud::AdjustmentRequest {
            adjustment_kind: "STOCK_LOSS".into(),
            direction: "LOSS".into(),
            site_id: "dc".into(),
            amount_minor: 100_000,
            evidence_kind: Some("COUNT".into()),
            evidence_ref: Some("COUNT-12".into()),
            document_date: Some(september(11)),
            reason: "shrinkage".into(),
            note: None,
            other_key: None,
            other_qualifier: String::new(),
        },
        MAKER,
    )
    .await
    .unwrap_or_else(|error| panic!("draft: {}", as_shown_to_a_person(&error)));
    cloud::correction_approve(&pool, drafted.correction_id, CHECKER)
        .await
        .unwrap_or_else(|error| panic!("approve: {}", as_shown_to_a_person(&error)));

    sqlx::query("UPDATE fiscal_period SET status='CLOSED', closed_by='ana', closed_at=now() WHERE year=2026 AND month=9")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("seal: {error}"));

    let refusal = cloud::correction_post(&pool, drafted.correction_id, None, CHECKER)
        .await
        .expect_err("a sealed month refuses a correction like anything else");
    let shown = as_shown_to_a_person(&refusal);
    assert!(
        shown.contains("2026-09") && shown.contains("closed"),
        "the period lock speaks for itself: {shown}"
    );
    let status: String =
        sqlx::query_scalar("SELECT status FROM correction_document WHERE correction_id=$1")
            .bind(drafted.correction_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(
        status, "APPROVED",
        "a correction the ledger refused is still approved, not a lie about being posted"
    );
}
