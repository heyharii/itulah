//! The three properties this module exists to hold: a salary is a history, two
//! people sign a run, and an account number is shown four digits at a time.

use super::*;
use crate::cloud::domain::employment::{actions, Authorization, PlaceId};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;

fn instant(offset: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_780_000_000 + offset, 0).unwrap_or_else(|| panic!("instant"))
}

fn authority(actor: &str, key: &str, offset: i64) -> Authorization {
    Authorization::try_new(actor, key, instant(offset), "alasan")
        .unwrap_or_else(|error| panic!("authority: {error}"))
}

fn date(raw: &str) -> NaiveDate {
    raw.parse().unwrap_or_else(|error| panic!("date: {error}"))
}

fn allowance(code: &str, minor: i64) -> FixedAllowance {
    FixedAllowance::try_new(
        AllowanceCode::try_new(code).unwrap_or_else(|error| panic!("code: {error}")),
        Money::new(minor),
    )
    .unwrap_or_else(|error| panic!("allowance: {error}"))
}

fn record(from: &str, base: i64, allowances: Vec<FixedAllowance>, offset: i64) -> PayRecord {
    PayRecord::try_new(
        date(from),
        Money::new(base),
        allowances,
        authority("hr.dewi", actions::PAY_CHANGE, offset),
    )
    .unwrap_or_else(|error| panic!("record: {error}"))
}

/// The whole reason pay is a timeline: a raise must not change what an earlier
/// month was paid from.
#[test]
fn a_raise_does_not_rewrite_what_last_month_was_paid() {
    let mut timeline = PayTimeline::new();
    timeline
        .append(record(
            "2026-01-01",
            5_000_000,
            vec![allowance("JABATAN", 500_000)],
            0,
        ))
        .unwrap_or_else(|error| panic!("append: {error}"));
    timeline
        .append(record(
            "2026-04-01",
            6_000_000,
            vec![allowance("JABATAN", 750_000)],
            10,
        ))
        .unwrap_or_else(|error| panic!("append: {error}"));

    let february = timeline
        .on(date("2026-02-15"))
        .unwrap_or_else(|| panic!("February had an agreement"));
    assert_eq!(february.base(), Money::new(5_000_000));
    assert_eq!(february.statutory_base(), Money::new(5_500_000));

    let may = timeline
        .on(date("2026-05-15"))
        .unwrap_or_else(|| panic!("May had one too"));
    assert_eq!(may.base(), Money::new(6_000_000));
    assert_eq!(may.statutory_base(), Money::new(6_750_000));
}

/// Before the first agreement there is no agreement — which is not the same as
/// an agreement worth zero.
#[test]
fn no_agreement_yet_is_not_an_agreement_worth_nothing() {
    let mut timeline = PayTimeline::new();
    timeline
        .append(record("2026-04-01", 6_000_000, Vec::new(), 0))
        .unwrap_or_else(|error| panic!("append: {error}"));
    assert!(timeline.on(date("2026-03-31")).is_none());
    assert!(PayTimeline::new().on(date("2026-04-01")).is_none());
}

/// Backdating would change what an already-closed month was owed. A genuine
/// backdated raise is paid as a rapel in a current period instead.
#[test]
fn a_record_cannot_be_filed_behind_the_latest() {
    let mut timeline = PayTimeline::new();
    timeline
        .append(record("2026-04-01", 6_000_000, Vec::new(), 0))
        .unwrap_or_else(|error| panic!("append: {error}"));
    let error = timeline
        .append(record("2026-01-01", 5_000_000, Vec::new(), 10))
        .unwrap_err();
    assert_eq!(error.code(), "pay_not_forward");
    assert!(error.is_conflict());
    // And two records cannot share a date, for the same reason.
    let error = timeline
        .append(record("2026-04-01", 7_000_000, Vec::new(), 20))
        .unwrap_err();
    assert_eq!(error.code(), "pay_not_forward");
}

/// An allowance worth nothing is either a mistake or a removal, and a removal
/// is expressed by leaving the line out — visibly.
#[test]
fn an_allowance_worth_nothing_is_refused() {
    let error = FixedAllowance::try_new(
        AllowanceCode::try_new("TRANSPORT").unwrap_or_else(|error| panic!("{error}")),
        Money::ZERO,
    )
    .unwrap_err();
    assert_eq!(error.code(), "pay_allowance_not_positive");
}

/// Two lines sharing a code would make "the housing allowance" ambiguous and
/// the sum quietly wrong.
#[test]
fn one_allowance_cannot_be_named_twice() {
    let error = PayRecord::try_new(
        date("2026-01-01"),
        Money::new(5_000_000),
        vec![allowance("JABATAN", 500_000), allowance("jabatan", 250_000)],
        authority("hr.dewi", actions::PAY_CHANGE, 0),
    )
    .unwrap_err();
    assert_eq!(error.code(), "pay_duplicate_allowance");
}

/// Pay is head office's, and the key is checked before anything else.
#[test]
fn pay_cannot_be_set_under_another_key() {
    let error = PayRecord::try_new(
        date("2026-01-01"),
        Money::new(5_000_000),
        Vec::new(),
        authority("bu.rina", actions::LEAVE_DECIDE, 0),
    )
    .unwrap_err();
    assert_eq!(error.code(), "pay_action_forbids_change");
    assert!(error.is_forbidden());
}

// ── the run ──────────────────────────────────────────────────────────────

fn draft() -> PayrollRun {
    PayrollRun::draft(
        "PR-2026-04-store-07",
        PlaceId::try_new("store-07").unwrap_or_else(|error| panic!("place: {error}")),
        "2026-04",
        Some("no punch source is connected, so nothing here knows what was worked".to_owned()),
    )
    .unwrap_or_else(|error| panic!("draft: {error}"))
}

/// The rule this module adds to the donor: a control one person can complete
/// alone is a record of a signature, not a control.
#[test]
fn the_person_who_verified_a_run_may_not_approve_it() {
    let mut run = draft();
    run.verify(authority("hr.dewi", actions::PAYROLL_VERIFY, 0))
        .unwrap_or_else(|error| panic!("verify: {error}"));
    assert_eq!(run.state(), RunState::Verified);

    let error = run
        .approve(authority("hr.dewi", actions::PAYROLL_APPROVE, 10))
        .unwrap_err();
    assert_eq!(error.code(), "payroll_same_actor");
    // A conflict, not a bad request: the payload is fine and what is wrong is
    // who is sending it.
    assert!(error.is_conflict());
    assert_eq!(run.state(), RunState::Verified, "nothing half-approved");

    run.approve(authority("hr.budi", actions::PAYROLL_APPROVE, 20))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(run.state(), RunState::Approved);
}

/// And the same run, stored, fails to hydrate — because a rule only the live
/// path enforces is one a round trip through storage removes.
#[test]
fn a_stored_run_signed_twice_by_one_person_refuses_to_load() {
    let json = serde_json::json!({
        "id": "PR-1",
        "place": "store-07",
        "period": "2026-04",
        "state": "APPROVED",
        "complete": false,
        "incomplete_because": "no punch source",
        "history": [
            {
                "step": "VERIFIED",
                "authorization": {
                    "actor": "hr.dewi", "action_key": actions::PAYROLL_VERIFY,
                    "at": instant(0), "reason": "dicek",
                }
            },
            {
                "step": "APPROVED",
                "authorization": {
                    "actor": "hr.dewi", "action_key": actions::PAYROLL_APPROVE,
                    "at": instant(10), "reason": "disetujui",
                }
            }
        ],
    });
    let error = serde_json::from_value::<PayrollRun>(json).unwrap_err();
    assert!(
        error.to_string().contains("may not also approve"),
        "unexpected: {error}"
    );
}

/// Sealing is the point past which the figures are the figures.
#[test]
fn a_sealed_run_cannot_be_reopened() {
    let mut run = draft();
    run.verify(authority("hr.dewi", actions::PAYROLL_VERIFY, 0))
        .unwrap_or_else(|error| panic!("verify: {error}"));
    run.approve(authority("hr.budi", actions::PAYROLL_APPROVE, 10))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    run.seal(authority("hr.dewi", actions::PAYROLL_SEAL, 20))
        .unwrap_or_else(|error| panic!("seal: {error}"));
    assert_eq!(run.state(), RunState::Sealed);

    let error = run
        .reopen(authority("hr.dewi", actions::PAYROLL_REOPEN, 30))
        .unwrap_err();
    assert_eq!(error.code(), "payroll_run_sealed");
}

/// A reopen clears the chain: the next approval is a fresh pair of signatures,
/// not a continuation of the old one.
#[test]
fn a_reopen_lets_the_earlier_verifier_approve_afterwards() {
    let mut run = draft();
    run.verify(authority("hr.dewi", actions::PAYROLL_VERIFY, 0))
        .unwrap_or_else(|error| panic!("verify: {error}"));
    run.reopen(authority("hr.budi", actions::PAYROLL_REOPEN, 10))
        .unwrap_or_else(|error| panic!("reopen: {error}"));
    assert_eq!(run.state(), RunState::Draft);
    assert!(run.verifier().is_none());

    // Budi verifies this time, so Dewi may approve — which she could not have
    // done before the reopen.
    run.verify(authority("hr.budi", actions::PAYROLL_VERIFY, 20))
        .unwrap_or_else(|error| panic!("verify: {error}"));
    run.approve(authority("hr.dewi", actions::PAYROLL_APPROVE, 30))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    assert_eq!(run.state(), RunState::Approved);
}

/// Each step is its own key, so a grant to check figures is not a grant to
/// approve them.
#[test]
fn each_step_needs_its_own_key() {
    let mut run = draft();
    let error = run
        .verify(authority("hr.dewi", actions::PAYROLL_APPROVE, 0))
        .unwrap_err();
    assert_eq!(error.code(), "payroll_action_forbids_step");
    assert!(error.is_forbidden());

    // And a draft cannot be approved without being verified first.
    let error = run
        .approve(authority("hr.dewi", actions::PAYROLL_APPROVE, 10))
        .unwrap_err();
    assert_eq!(error.code(), "payroll_run_not_in_state");
}

/// A run that presented what it knows as a finished payroll would be a run
/// somebody paid from.
#[test]
fn a_run_says_it_is_incomplete_and_why() {
    let run = draft();
    assert!(!run.complete());
    assert!(run
        .incomplete_because()
        .is_some_and(|reason| reason.contains("punch source")));

    let whole = PayrollRun::draft(
        "PR-2",
        PlaceId::try_new("ho").unwrap_or_else(|error| panic!("place: {error}")),
        "2026-04",
        None,
    )
    .unwrap_or_else(|error| panic!("draft: {error}"));
    assert!(whole.complete());
    assert!(whole.incomplete_because().is_none());
}

// ── payroll identity ─────────────────────────────────────────────────────

/// Somebody checking their own account confirms four digits; nobody else needs
/// the rest.
#[test]
fn an_account_number_is_shown_four_digits_at_a_time() {
    let account = BankAccount::try_new("BCA", "1234567890", "Siti Rahayu")
        .unwrap_or_else(|error| panic!("account: {error}"));
    assert_eq!(account.masked(), "••••••7890");
    // The payment file still gets the whole thing.
    assert_eq!(account.number(), "1234567890");
}

/// An account number with no bank and no holder is three ways of being unable
/// to pay somebody.
#[test]
fn an_account_needs_its_bank_and_its_holder() {
    assert!(BankAccount::try_new("", "1234567890", "Siti").is_err());
    assert!(BankAccount::try_new("BCA", "1234567890", "").is_err());
    // And a number that is not digits is not a number.
    let error = BankAccount::try_new("BCA", "12-345", "Siti").unwrap_err();
    assert_eq!(error.code(), "pay_malformed_identity");
}

/// Three dependants is the statutory ceiling — a fourth child does not raise
/// the allowance, so a fourth is a data-entry error.
#[test]
fn ptkp_reads_the_way_the_tax_office_writes_it() {
    let single = PtkpStatus::parse("TK/0").unwrap_or_else(|error| panic!("{error}"));
    assert!(!single.married());
    assert_eq!(single.to_string(), "TK/0");

    let married = PtkpStatus::parse("K/2").unwrap_or_else(|error| panic!("{error}"));
    assert!(married.married());
    assert_eq!(married.dependants(), 2);

    assert!(PtkpStatus::parse("K/4").is_err());
    assert!(PtkpStatus::parse("M/1").is_err());
}

/// The amendments are the authority: a replay produces the record, and a change
/// under the wrong key is refused on the way in.
#[test]
fn an_identity_is_a_fold_over_its_amendments() {
    let mut identity = PayrollIdentity::empty();
    assert!(!identity.payable());

    identity
        .amend(
            IdentityChange::BankAccount {
                account: BankAccount::try_new("BCA", "1234567890", "Siti Rahayu")
                    .unwrap_or_else(|error| panic!("{error}")),
            },
            date("2026-01-01"),
            authority("hr.dewi", actions::PAY_CHANGE, 0),
        )
        .unwrap_or_else(|error| panic!("amend: {error}"));
    assert!(identity.payable());
    assert_eq!(identity.amendments().len(), 1);
    assert_eq!(identity.amendments()[0].change().field(), "bank_account");

    let error = identity
        .amend(
            IdentityChange::Npwp {
                npwp: "09.254.294.1-407.000".to_owned(),
            },
            date("2026-01-01"),
            authority("bu.rina", actions::LEAVE_DECIDE, 10),
        )
        .unwrap_err();
    assert_eq!(error.code(), "pay_action_forbids_change");

    let replayed = PayrollIdentity::replay(identity.amendments().to_vec())
        .unwrap_or_else(|error| panic!("replay: {error}"));
    assert_eq!(
        replayed.bank_account().map(BankAccount::masked),
        Some("••••••7890".to_owned())
    );
}
