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

/// The chart as it stands. Not asserted as an equality — the chart is expected
/// to grow — but as a floor, so that a chain which somehow loaded no accounts
/// at all cannot pass this file by having nothing to check.
///
/// Two sets, and the number is the sum of them. 0289 added the forty accounts
/// the books post to from now on; 0290 did NOT delete the 190 the client's
/// chart had, because `journal_line` is append-only and their postings are
/// still theirs. They are `is_active = false`, `posting_mode = 'BLOCKED'` and
/// `manual_je_policy = 'NO'` — retired, not gone — and they keep
/// `posting_policy_configured = true`, because BLOCKED is a decision somebody
/// made and not an absence of one.
///
/// `NOT is_group` is therefore 230 and not 40. That is the right thing for this
/// gate to count: the invariant it keeps is "nothing postable sits on the
/// permissive column default", and a retired account that lost its policy would
/// be exactly as open as a new one that never had one.
///
/// 231 since 0296 added `8301 Biaya Lain-lain`: 41 live and 190 retired.
// 0297 split returns from discounts and added the points liability: 43 live + 190 retired.
const POSTABLE_AT_0297: i64 = 233;

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
        postable >= POSTABLE_AT_0297,
        "the chart holds {postable} postable accounts where 0297 left {POSTABLE_AT_0297}. \
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

/// The owner's decision about the replacement reserve, and where it now is not.
///
/// The reserve's formation was ruled undecided and its draw-down approved, so
/// the refusal is `DENY ASSET_RESERVE` per source kind rather than BLOCKED on
/// the account: BLOCKED would refuse the draw-down as well. 0268 moved that row
/// out of the seed script and into the chain, so a database that skipped the
/// script no longer had the undecided path wide open.
///
/// This was red, and what it was red about is worth keeping written down. 0291
/// said "`account_source_rule` and `account_category_policy` are already on the
/// new codes". `account_category_policy` was; `account_source_rule` was not,
/// and all four of its rows sat on accounts 0290 had retired:
///
///   * `1021607001 ASSET_RESERVE DENY` (0268) — this one
///   * `1011302003 OPENING ALLOW` (0267) — see `posting_policy_integration`
///   * `7010216002 AMORTIZATION_RUN ALLOW` and `OPENING ALLOW` (0267)
///
/// Four decisions about which documents may reach an account, silently not in
/// force. Moving them was not mechanical either, and that was the harder half:
/// the table was keyed on the ACCOUNT alone, and `1610` carries every
/// operating-equipment class while `1402` carries every prepaid tax, so a deny
/// or an allow-list copied across would have bound far more than the account it
/// was written for. 0294 gave the table the grain
/// `account_category_policy` already had — a nullable `category_code`, NULL
/// meaning the whole account — and moved three of the four onto it. This one is
/// genuinely about all of `1610`, so it moved as it stood.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_reserve_refuses_its_undecided_source_without_the_seed(pool: PgPool) {
    let effect: Option<String> = sqlx::query_scalar(
        "SELECT effect FROM account_source_rule
          WHERE account_code = '1610' AND source_kind = 'ASSET_RESERVE'",
    )
    .fetch_optional(&pool)
    .await
    .expect("read the reserve's source rule");

    assert_eq!(
        effect.as_deref(),
        Some("DENY"),
        "the reserve's undecided formation path is not refused by the migrations alone: \
         0268 put the DENY on 1021607001 and 0290 retired that account without carrying \
         the decision over to 1610",
    );

    let mode: String =
        sqlx::query_scalar("SELECT posting_mode FROM ledger_account WHERE account_code = '1610'")
            .fetch_one(&pool)
            .await
            .expect("read the reserve's posting mode");

    assert_ne!(
        mode, "BLOCKED",
        "account-level BLOCKED would refuse the draw-down the owner approved as well \
         as the formation they did not; the refusal here is per source kind on purpose",
    );
}
