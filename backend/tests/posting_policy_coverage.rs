//! Every postable account arrives classified, from the migrations alone.
//!
//! `#[sqlx::test]` builds a fresh database and applies the whole chain and
//! nothing else — no seed script, no spreadsheet. That is exactly the shape of
//! the guarantee being asserted: a production database reaches a governed
//! posting policy by being migrated, not by somebody remembering to run
//! `scripts/seed-posting-profile.py` in each environment.
//!
//! The gate this file keeps is for the migration nobody has written yet. A
//! future migration that adds a postable account and forgets its policy would
//! leave that account on the permissive default, silently — `MANUAL` / `YES`,
//! open to anything. Here it turns this test red and names the account.
//!
//! Headings are exempt. `journal_line` pins `is_group = false` through a
//! composite foreign key, so nothing can post to a group and a group has no
//! policy to decide.

use sqlx::{PgPool, Row};

/// The chart as it stood when the invariant was written (0268). Not asserted
/// as an equality — the chart is expected to grow — but as a floor, so that a
/// chain which somehow loaded no accounts at all cannot pass this file by
/// having nothing to check.
const POSTABLE_AT_0268: i64 = 186;

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_postable_account_has_a_deliberate_posting_policy(pool: PgPool) {
    let unclassified = sqlx::query(
        "SELECT account_code, name, posting_mode, manual_je_policy
           FROM ledger_account
          WHERE NOT is_group AND NOT posting_policy_configured
          ORDER BY account_code",
    )
    .fetch_all(&pool)
    .await
    .expect("read unclassified accounts");

    if !unclassified.is_empty() {
        let listed: Vec<String> = unclassified
            .iter()
            .map(|row| {
                format!(
                    "  {} {} (currently {} / {})",
                    row.get::<String, _>("account_code"),
                    row.get::<String, _>("name"),
                    row.get::<String, _>("posting_mode"),
                    row.get::<String, _>("manual_je_policy"),
                )
            })
            .collect();
        panic!(
            "{} postable account(s) reach a migrated database with nobody having \
             decided how they may be posted to:\n{}\n\n\
             A postable account without a decision sits on the column default, \
             which is MANUAL / YES — open to a hand-keyed entry from any source. \
             Whichever migration introduced these accounts should also set their \
             `posting_mode`, `manual_je_policy` and `posting_policy_configured = true`, \
             the way 0268 does. `MANUAL` / `YES` is a legitimate answer; it just has \
             to be an answer somebody gave.",
            unclassified.len(),
            listed.join("\n"),
        );
    }

    let postable: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM ledger_account WHERE NOT is_group")
            .fetch_one(&pool)
            .await
            .expect("count postable accounts");
    assert!(
        postable >= POSTABLE_AT_0268,
        "the chart holds {postable} postable accounts where 0268 left {POSTABLE_AT_0268}. \
         Accounts disappearing is not what this test is for, but a chain that loses the \
         chart would otherwise pass it with nothing to check",
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_heading_is_not_given_a_policy_it_cannot_use(pool: PgPool) {
    let marked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM ledger_account WHERE is_group AND posting_policy_configured",
    )
    .fetch_one(&pool)
    .await
    .expect("count marked groups");

    assert_eq!(
        marked, 0,
        "{marked} heading(s) carry `posting_policy_configured`. Nothing posts to a \
         group, so a marker there means a blanket UPDATE swept them in — which would \
         also sweep in the postable accounts the coverage gate exists to catch",
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_reserve_refuses_its_undecided_source_without_the_seed(pool: PgPool) {
    // 1021607001 Reserve Replacement Operating Equipment: the owner ruled the
    // formation of the reserve undecided and the draw-down approved. The DENY
    // row used to live in the seed script, so a database that skipped the
    // script had the undecided path wide open.
    let effect: Option<String> = sqlx::query_scalar(
        "SELECT effect FROM account_source_rule
          WHERE account_code = '1021607001' AND source_kind = 'ASSET_RESERVE'",
    )
    .fetch_optional(&pool)
    .await
    .expect("read the reserve's source rule");

    assert_eq!(
        effect.as_deref(),
        Some("DENY"),
        "the reserve's undecided formation path is not refused by the migrations alone",
    );

    let mode: String = sqlx::query_scalar(
        "SELECT posting_mode FROM ledger_account WHERE account_code = '1021607001'",
    )
    .fetch_one(&pool)
    .await
    .expect("read the reserve's posting mode");

    assert_ne!(
        mode, "BLOCKED",
        "account-level BLOCKED would refuse the draw-down the owner approved as well \
         as the formation they did not; the refusal here is per source kind on purpose",
    );
}
