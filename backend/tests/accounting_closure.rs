//! Phase 2C: what the chart says about itself.
//!
//! Three closures, and each is the kind of thing that is true on the day it is
//! written and quietly stops being true later, which is why they are here
//! rather than in a document:
//!
//!   * every account this estate minted is DECLARED as ours, so the audit
//!     against the client's export can tell a deliberate exception from a
//!     mistake — and fail on the day a seventh appears that nobody declared;
//!   * `cash_in_transit` has an account and a mapping in every set of books,
//!     from the migrations alone: two deposit documents post through it, and
//!     between 0254 deleting the account and 0277 putting it back there was no
//!     database in which a shop could bank its takings;
//!   * the required-meanings list names nothing the estate stopped reading when
//!     0273 deleted the second day-posting writer.

use inventory_backend::cloud::postgres as cloud;
use sqlx::{PgPool, Row};

/// The eight accounts that are ours ON TOP OF the forty, with the reason each
/// exists.
///
/// All forty of the new chart carry `PENDING_CLIENT_CODE` too — the four-digit
/// codes are ours and the names are the client's (`docs/coa-40-contract.md`
/// §4) — so the closure below is "the forty, plus exactly these and nothing
/// else". These eight are retired now and kept for their postings; the reasons
/// are still the reasons, and each one says which category answers it today.
const DECLARED: [(&str, &str); 8] = [
    ("1011005", "the rung money in transit hung from"),
    (
        "1011005001",
        "a bag that has left a drawer and not reached a bank; now 1101 x TRANSIT",
    ),
    (
        "1011101003",
        "QRIS is owed by a provider, not by a card acquirer; now 1201 x QRIS",
    ),
    (
        "2012101006",
        "corporate tax has to be owed somewhere; now 2201 x PPH29",
    ),
    ("2012305", "the rung the voucher liability hung from"),
    (
        "2012305001",
        "a voucher is money the shop already took; now 2401 x VOUCHER_LIABILITY",
    ),
    ("4010114", "the rung QRIS sales hung from"),
    (
        "4010114001",
        "QRIS sales, reconcilable per provider; now 4101 x QRIS",
    ),
];

#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_account_we_minted_says_so(pool: PgPool) {
    let rows = sqlx::query(
        "SELECT account_code FROM ledger_account
          WHERE code_provenance = 'PENDING_CLIENT_CODE'
          ORDER BY account_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read: {error}"));

    let found: Vec<String> = rows
        .iter()
        .map(|row| {
            row.try_get::<String, _>("account_code")
                .unwrap_or_else(|error| panic!("code: {error}"))
        })
        .collect();

    // The forty are ours by construction, and counted rather than listed: 0289
    // already refuses a chain that does not install exactly forty of them, so
    // repeating the codes here would be a second list to keep in step.
    let forty: Vec<&String> = found.iter().filter(|code| code.len() == 4).collect();
    assert_eq!(
        forty.len(),
        40,
        "the collapsed chart is forty accounts and all forty are ours: {forty:?}"
    );

    // And what is left over is the eight above, in order, with nothing added.
    let extra: Vec<String> = found
        .iter()
        .filter(|code| code.len() != 4)
        .cloned()
        .collect();
    let expected: Vec<String> = DECLARED.iter().map(|(code, _)| (*code).into()).collect();
    assert_eq!(
        extra, expected,
        "an account outside the client's chart has appeared or gone without a decision; \
         every one of them has to be declared, with its reason, in 0277 and here"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_can_bank_its_takings_from_the_migrations_alone(pool: PgPool) {
    // No seed, no fixture: what a freshly migrated database carries.
    let places: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM site")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("sites: {error}"));
    let mapped: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM account_map WHERE semantic_key = 'cash_in_transit'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("map: {error}"));
    assert_eq!(
        mapped, places,
        "money in transit needs somewhere to sit at every place that keeps a drawer"
    );

    let account = sqlx::query(
        "SELECT a.account_code, m.category_code, a.is_group, a.normal_balance, a.dimension,
                a.posting_mode, a.manual_je_policy, a.posting_policy_configured
           FROM account_map m JOIN ledger_account a ON a.account_code = m.account_code
          WHERE m.semantic_key = 'cash_in_transit' LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("account: {error}"));

    // `1011005001 Setoran Dalam Perjalanan` was one of exactly two accounts the
    // simplified chart had to INVENT. It needs no account of its own now: money
    // out of the drawer and not yet at the bank is cash in a different pot, and
    // the pot is on the line. Which means the account alone no longer answers
    // this test's question — `1101` is also the drawer — so the category is read
    // with it.
    assert_eq!(
        account
            .try_get::<String, _>("account_code")
            .unwrap_or_default(),
        "1101"
    );
    assert_eq!(
        account
            .try_get::<Option<String>, _>("category_code")
            .unwrap_or_default()
            .as_deref(),
        Some("TRANSIT"),
        "mapped to the drawer instead, a deposit would credit the money straight back"
    );
    assert!(
        !account.try_get::<bool, _>("is_group").unwrap_or(true),
        "a heading takes no postings"
    );
    // Debit-normal: the hand-over debits it and the bank's confirmation credits
    // it back, so between the two dates it is an asset of the SHOP.
    assert_eq!(
        account
            .try_get::<Option<String>, _>("normal_balance")
            .unwrap_or_default()
            .as_deref(),
        Some("D")
    );
    assert_eq!(
        account
            .try_get::<Option<String>, _>("dimension")
            .unwrap_or_default()
            .as_deref(),
        Some("unit"),
        "the bag belongs to the shop that sent it"
    );
    // Written by the two deposit rules; reachable by an approved correction and
    // not by a hand-keyed journal, exactly like the cash it came out of.
    assert_eq!(
        account
            .try_get::<String, _>("posting_mode")
            .unwrap_or_default(),
        "SEMI_AUTO"
    );
    assert_eq!(
        account
            .try_get::<String, _>("manual_je_policy")
            .unwrap_or_default(),
        "OVERRIDE"
    );
    assert!(
        account
            .try_get::<bool, _>("posting_policy_configured")
            .unwrap_or(false),
        "an account nobody has decided a policy for is not postable"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn no_postable_account_is_left_without_a_policy(pool: PgPool) {
    let unclassified: Vec<String> = sqlx::query_scalar(
        "SELECT account_code FROM ledger_account
          WHERE NOT is_group AND NOT posting_policy_configured
          ORDER BY account_code",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read: {error}"));
    assert!(
        unclassified.is_empty(),
        "these accounts can be posted to and nobody has said by what: {unclassified:?}"
    );
}

#[test]
fn the_required_meanings_are_ones_something_still_reads() {
    let keys: Vec<String> = cloud::required_semantic_keys()
        .into_iter()
        .map(|doc| doc.key)
        .collect();
    // 0273 deleted the second day-posting writer, and these four went with it:
    // the authority names `revenue_cash`/`revenue_debit`/`revenue_credit`/
    // `revenue_qris` and `vat_out`, holds QRIS money in `qris_receivable`, and
    // REFUSES a tender it does not know rather than clearing it. Left in the
    // list they were 56 pairs the Account Map screen counted as unset for ever.
    for dead in [
        "revenue",
        "output_tax",
        "qris_clearing",
        "other_tender_clearing",
    ] {
        assert!(
            !keys.iter().any(|key| key == dead),
            "'{dead}' is required of every place and nothing in the estate reads it"
        );
    }
    for live in [
        "revenue_cash",
        "revenue_debit",
        "revenue_credit",
        "revenue_qris",
        "vat_out",
        "qris_receivable",
        "cash_in_transit",
    ] {
        assert!(
            keys.iter().any(|key| key == live),
            "'{live}' is asked for by a posting path and is not on the list somebody fills in"
        );
    }
}
