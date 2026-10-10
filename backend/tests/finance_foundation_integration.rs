//! The dynamic finance foundation (Desain Fondasi Finance Dinamis, stage 1;
//! migrations 0460 and 0461), end to end against the migration chain.
//!
//! What Finance can now do without a developer, and what it still cannot do:
//!
//!   1  a new shop posts on day one: every link that holds for all shops holds
//!      for it, and nobody writes a row
//!   2  one unit's link overrides its kind's, and the kind's overrides
//!      everybody's; removing the exception brings the rule back
//!   3  a link to the wrong kind of account is refused when it is SAVED
//!   4  removing the last link a unit resolves through is refused, unless forced
//!   5  every change to a link is remembered, with who made it
//!   6  Finance adds an account from the screen, it applies at once, is
//!      remembered with who and why, and can be linked the moment it exists
//!   7  a chart change that cannot apply is refused and changes nothing
//!   8  an account that still answers to a role cannot be retired
//!   9  the affiliate links follow the kind of unit, not the counterparty (I7)

use chrono::NaiveDate;
use inventory_backend::cloud::postgres::{self as cloud, PostingIntent, PostingLine};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ALICE: &str = "alice";
const BOB: &str = "bob";

fn intent(kind: &str, lines: Vec<PostingLine>) -> PostingIntent {
    PostingIntent {
        posting_date: NaiveDate::from_ymd_opt(2026, 9, 15).unwrap_or_else(|| panic!("bad date")),
        source_kind: kind.into(),
        source_id: Some(Uuid::new_v4().to_string()),
        rule_version: "finance_foundation/1".into(),
        currency: "IDR".into(),
        memo: Some(format!("{kind} foundation test")),
        lines,
    }
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open period: {error}"));
}

async fn try_post(pool: &PgPool, kind: &str, lines: Vec<PostingLine>) -> Result<Uuid, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    match cloud::post(&mut tx, &intent(kind, lines), None, ALICE).await {
        Ok(posted) => {
            tx.commit().await.map_err(|e| e.to_string())?;
            Ok(posted.entry_id)
        }
        Err(error) => Err(error.to_string()),
    }
}

async fn accounts_of(pool: &PgPool, entry: Uuid) -> Vec<(String, String)> {
    sqlx::query(
        "SELECT unit_id, account_code FROM journal_line WHERE entry_id = $1 ORDER BY line_number",
    )
    .bind(entry)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("lines: {error}"))
    .into_iter()
    .map(|row| (row.get("unit_id"), row.get("account_code")))
    .collect()
}

async fn resolves(pool: &PgPool, role: &str, unit: &str, source: &str) -> Result<String, String> {
    cloud::resolve_account_code(pool, role, unit, source)
        .await
        .map_err(|error| error.to_string())
}

fn link(
    role: &str,
    source: &str,
    scope_type: &str,
    scope_key: &str,
    account: &str,
) -> cloud::SetAccountLinkRequest {
    cloud::SetAccountLinkRequest {
        role: role.into(),
        source_type: "COMPANY".into(),
        source_id: source.into(),
        scope_type: scope_type.into(),
        scope_key: scope_key.into(),
        account_code: account.into(),
        category_code: None,
        note: None,
    }
}

async fn open_a_fourteenth_shop(pool: &PgPool) {
    // A shop is a site of its own store unit (0600), so the unit comes first.
    sqlx::query(
        "INSERT INTO unit (id, code, name, kind)
         VALUES ('store-14', 'C014', 'Toko Empat Belas', 'STORE')",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("unit: {error}"));
    sqlx::query(
        "INSERT INTO site (id, name, kind, edge_node_id, unit_id)
         VALUES ('store-14', 'Toko Empat Belas', 'STORE', 'edge-store-14', 'store-14')",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("site: {error}"));
}

fn chart_change(kind: &str, code: &str) -> cloud::ChartChangeRequest {
    cloud::ChartChangeRequest {
        kind: kind.into(),
        account_code: code.into(),
        name: None,
        parent_code: None,
        is_group: None,
        account_type: None,
        statement_section: None,
        dimension: None,
        is_frozen: None,
        requires_counter_site: None,
        normal_balance: None,
        reason: None,
    }
}

// 1 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_new_shop_posts_on_day_one(pool: PgPool) {
    open_a_fourteenth_shop(&pool).await;
    open_september(&pool).await;

    assert_eq!(
        resolves(&pool, "cash", "store-14", "").await,
        Ok("1002".into())
    );
    assert_eq!(
        resolves(&pool, "revenue_cash", "store-14", "").await,
        Ok("4002".into())
    );
    assert_eq!(
        resolves(&pool, "payroll_expense", "store-14", "SALARY").await,
        Ok("6012".into()),
        "a shop's salary is selling expense, as at every other shop"
    );

    let entry = try_post(
        &pool,
        "SALE_DAY",
        vec![
            PostingLine::debit("cash", "store-14", 250_000),
            PostingLine::credit("revenue_cash", "store-14", 250_000),
        ],
    )
    .await
    .unwrap_or_else(|error| panic!("the new shop's first sale must post: {error}"));
    assert_eq!(
        accounts_of(&pool, entry).await,
        vec![
            ("store-14".into(), "1002".into()),
            ("store-14".into(), "4002".into())
        ]
    );

    let readiness = cloud::posting_readiness(&pool)
        .await
        .unwrap_or_else(|error| panic!("readiness: {error}"));
    let cash = readiness
        .rows
        .iter()
        .find(|row| row.role == "cash" && row.source_id.is_empty())
        .unwrap_or_else(|| panic!("cash is on the readiness screen"));
    let cell = cash
        .cells
        .iter()
        .find(|cell| cell.unit_id == "store-14")
        .unwrap_or_else(|| panic!("store-14 is a column"));
    assert_eq!(cell.account_code.as_deref(), Some("1002"));
}

// 2 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_most_specific_link_wins(pool: PgPool) {
    assert_eq!(
        resolves(&pool, "cash", "store-03", "").await,
        Ok("1002".into())
    );

    let exception =
        cloud::set_account_link(&pool, &link("cash", "", "UNIT", "store-03", "1003"), ALICE)
            .await
            .unwrap_or_else(|error| panic!("a one-shop exception: {error}"));
    assert_eq!(exception.decides_units, 1);
    assert_eq!(
        resolves(&pool, "cash", "store-03", "").await,
        Ok("1003".into())
    );
    assert_eq!(
        resolves(&pool, "cash", "store-04", "").await,
        Ok("1002".into()),
        "the exception is store-03's alone"
    );

    cloud::remove_account_link(&pool, exception.link_id, false, ALICE)
        .await
        .unwrap_or_else(|error| panic!("removing an exception strands nobody: {error}"));
    assert_eq!(
        resolves(&pool, "cash", "store-03", "").await,
        Ok("1002".into())
    );
}

// 3 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_link_to_the_wrong_kind_of_account_is_refused_when_saved(pool: PgPool) {
    let refused =
        cloud::set_account_link(&pool, &link("trade_payable", "", "ALL", "", "6045"), ALICE)
            .await
            .err()
            .unwrap_or_else(|| panic!("an expense account cannot answer to trade_payable"))
            .to_string();
    assert!(
        refused.contains("PAYABLE"),
        "the refusal names the kind it wanted: {refused}"
    );
    assert_eq!(
        resolves(&pool, "trade_payable", "ho", "").await,
        Ok("2002".into()),
        "a refused link changes nothing"
    );
}

// 4 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn removing_the_last_link_a_unit_uses_is_refused_unless_forced(pool: PgPool) {
    let cash_links: Vec<i64> = sqlx::query_scalar(
        "SELECT link_id FROM account_link WHERE role = 'cash' AND source_id = ''",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("links: {error}"));
    assert!(!cash_links.is_empty());
    let first = cash_links[0];

    let refused = cloud::remove_account_link(&pool, first, false, ALICE)
        .await
        .err()
        .unwrap_or_else(|| panic!("removing cash leaves shops with nowhere to post"))
        .to_string();
    assert!(
        refused.contains("no account in the books of") && refused.contains("store-01"),
        "the refusal names the units it would strand, and where: {refused}"
    );
    assert!(
        resolves(&pool, "cash", "store-01", "").await.is_ok(),
        "nothing was removed"
    );

    cloud::remove_account_link(&pool, first, true, ALICE)
        .await
        .unwrap_or_else(|error| panic!("forced: {error}"));
}

// 5 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_change_to_a_link_is_remembered(pool: PgPool) {
    let set = cloud::set_account_link(&pool, &link("cash", "", "UNIT", "store-05", "1003"), ALICE)
        .await
        .unwrap_or_else(|error| panic!("set: {error}"));
    cloud::set_account_link(&pool, &link("cash", "", "UNIT", "store-05", "1004"), BOB)
        .await
        .unwrap_or_else(|error| panic!("move: {error}"));
    cloud::remove_account_link(&pool, set.link_id, false, ALICE)
        .await
        .unwrap_or_else(|error| panic!("remove: {error}"));

    let history = cloud::account_link_history(&pool, Some("cash"), 10)
        .await
        .unwrap_or_else(|error| panic!("history: {error}"));
    let story: Vec<(String, Option<String>, Option<String>, String)> = history
        .iter()
        .filter(|change| change.link_id == set.link_id)
        .map(|change| {
            (
                change.action.clone(),
                change.old_account_code.clone(),
                change.new_account_code.clone(),
                change.changed_by.clone(),
            )
        })
        .collect();
    assert_eq!(
        story,
        vec![
            ("DELETE".into(), Some("1004".into()), None, ALICE.into()),
            (
                "UPDATE".into(),
                Some("1003".into()),
                Some("1004".into()),
                BOB.into()
            ),
            ("INSERT".into(), None, Some("1003".into()), ALICE.into()),
        ]
    );
}

// 6 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn finance_adds_an_account_and_links_it_at_once(pool: PgPool) {
    let mut create = chart_change("CREATE", "6078");
    create.name = Some("Biaya Pest Control".into());
    create.parent_code = Some("6039".into());
    create.reason = Some("vendor hama baru di semua toko".into());
    let change = cloud::change_chart(&pool, &create, ALICE)
        .await
        .unwrap_or_else(|error| panic!("create: {error}"));
    assert_eq!(change.action, "CREATE");
    assert_eq!(change.changed_by, ALICE);
    assert_eq!(
        change.reason.as_deref(),
        Some("vendor hama baru di semua toko")
    );

    let account = sqlx::query(
        "SELECT root_type, account_type, normal_balance, is_active
           FROM ledger_account WHERE account_code = '6078'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("account: {error}"));
    assert_eq!(account.get::<String, _>("root_type"), "EXPENSE");
    assert_eq!(
        account.get::<Option<String>, _>("account_type").as_deref(),
        Some("EXPENSE"),
        "the type its siblings under 6039 have"
    );
    assert_eq!(account.get::<String, _>("normal_balance"), "D");
    assert!(account.get::<bool, _>("is_active"));

    cloud::set_account_link(&pool, &link("expense_misc", "", "ALL", "", "6078"), BOB)
        .await
        .unwrap_or_else(|error| panic!("the new account can be linked at once: {error}"));
    assert_eq!(
        resolves(&pool, "expense_misc", "store-09", "").await,
        Ok("6078".into())
    );

    let mut rename = chart_change("UPDATE", "6078");
    rename.name = Some("Biaya Pengendalian Hama".into());
    cloud::change_chart(&pool, &rename, BOB)
        .await
        .unwrap_or_else(|error| panic!("rename: {error}"));
    let history = cloud::chart_history(&pool, Some("6078"), 10)
        .await
        .unwrap_or_else(|error| panic!("history: {error}"));
    let story: Vec<(String, String)> = history
        .iter()
        .map(|change| (change.action.clone(), change.changed_by.clone()))
        .collect();
    assert_eq!(
        story,
        vec![
            ("UPDATE".into(), BOB.into()),
            ("CREATE".into(), ALICE.into())
        ]
    );
    assert_eq!(
        history[0].before.as_ref().and_then(|b| b["name"].as_str()),
        Some("Biaya Pest Control")
    );
    assert_eq!(
        history[0].after["name"].as_str(),
        Some("Biaya Pengendalian Hama")
    );
}

// 7 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_chart_change_that_cannot_apply_is_refused_and_changes_nothing(pool: PgPool) {
    let mut under_a_leaf = chart_change("CREATE", "6079");
    under_a_leaf.name = Some("Salah tempat".into());
    under_a_leaf.parent_code = Some("6045".into());
    let refused = cloud::change_chart(&pool, &under_a_leaf, ALICE)
        .await
        .err()
        .unwrap_or_else(|| panic!("6045 is a leaf"))
        .to_string();
    assert!(refused.contains("leaf"), "{refused}");

    let mut wrong_type = chart_change("CREATE", "6079");
    wrong_type.name = Some("Kas di beban".into());
    wrong_type.parent_code = Some("6039".into());
    wrong_type.account_type = Some("CASH".into());
    assert!(
        cloud::change_chart(&pool, &wrong_type, ALICE)
            .await
            .is_err(),
        "a cash account cannot sit under an expense heading"
    );

    let mut taken = chart_change("CREATE", "6045");
    taken.name = Some("Listrik lagi".into());
    taken.parent_code = Some("6039".into());
    assert!(
        cloud::change_chart(&pool, &taken, ALICE).await.is_err(),
        "6045 is already an account"
    );

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM ledger_account WHERE account_code = '6079')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("exists: {error}"));
    assert!(!exists, "a refused change leaves no account behind");
}

// 8 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_account_that_still_answers_to_a_role_cannot_be_retired(pool: PgPool) {
    let refused = cloud::change_chart(&pool, &chart_change("DEACTIVATE", "6045"), ALICE)
        .await
        .err()
        .unwrap_or_else(|| panic!("6045 answers to electricity"))
        .to_string();
    assert!(refused.contains("answers to"), "{refused}");
}

// 9 -------------------------------------------------------------------------

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_affiliate_links_follow_the_kind_of_unit(pool: PgPool) {
    for (family, unit, head_office) in [
        ("PEMBIAYAAN", "2028", "1057"),
        ("BARANG", "2029", "1058"),
        ("LAIN", "2030", "1059"),
    ] {
        for role in ["affiliate_payable", "affiliate_receivable"] {
            assert_eq!(
                resolves(&pool, role, "store-07", family).await,
                Ok(unit.into())
            );
            assert_eq!(
                resolves(&pool, role, "ho", family).await,
                Ok(head_office.into())
            );
        }
    }
    let links: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM account_link WHERE role LIKE 'affiliate_%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(links, 12, "two roles x three families x two kinds of unit");
}
