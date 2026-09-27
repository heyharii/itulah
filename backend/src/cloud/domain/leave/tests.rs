//! The properties this kernel exists to hold, as tests.
//!
//! Each one names the failure it prevents rather than the feature it exercises:
//! a balance that disagrees with its own ledger, a sick day charged against
//! annual leave, an approval with nothing deducted behind it.

use super::*;
use crate::cloud::domain::actions;
use crate::cloud::domain::employment::{Authorization, EmployeeId, UnitId};
use crate::cloud::domain::holiday::{
    Holiday, HolidayCalendar, HolidayKind, HolidayName, HolidayScope,
};
use chrono::{DateTime, NaiveDate, Utc};

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

fn unit() -> UnitId {
    UnitId::try_new("store-07").unwrap_or_else(|error| panic!("unit: {error}"))
}

fn employee() -> EmployeeId {
    EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("employee: {error}"))
}

fn calendar(days: Vec<Holiday>) -> HolidayCalendar {
    HolidayCalendar::publish(2026, days, authority("hr.dewi", actions::HOLIDAY_SET, 0))
        .unwrap_or_else(|error| panic!("calendar: {error}"))
}

fn annual() -> LeaveType {
    LeaveType::try_new(
        LeaveTypeCode::try_new("cuti_tahunan").unwrap_or_else(|error| panic!("code: {error}")),
        "Cuti Tahunan",
        LeaveBacking::Balance,
        LeavePayment::Full,
        false,
    )
    .unwrap_or_else(|error| panic!("type: {error}"))
}

fn sick() -> LeaveType {
    LeaveType::try_new(
        LeaveTypeCode::try_new("CUTI_SAKIT").unwrap_or_else(|error| panic!("code: {error}")),
        "Cuti Sakit",
        LeaveBacking::AsCertified,
        LeavePayment::StatutoryScale,
        true,
    )
    .unwrap_or_else(|error| panic!("type: {error}"))
}

fn ratified() -> PolicyTimeline {
    let mut timeline = PolicyTimeline::new();
    timeline
        .install(
            LeavePolicy::try_new(
                1,
                date("2026-01-01"),
                LeaveDays::from_days(12).unwrap_or_else(|error| panic!("days: {error}")),
                Accrual::Monthly,
                CarryForward::Capped {
                    cap: LeaveDays::from_days(6).unwrap_or_else(|error| panic!("days: {error}")),
                    expires_on_month_day: (3, 31),
                },
                Encashment::Forbidden,
                AccrualDuringProtectedLeave::Continues,
            )
            .unwrap_or_else(|error| panic!("policy: {error}")),
        )
        .unwrap_or_else(|error| panic!("install: {error}"));
    timeline
}

fn allocated(days: i32) -> LeaveLedger {
    let mut ledger = LeaveLedger::new();
    ledger
        .append(
            LedgerEntry::try_new(
                "alloc-2026",
                date("2026-01-01"),
                LeaveEvent::Allocation,
                LeaveDays::from_days(days).unwrap_or_else(|error| panic!("days: {error}")),
                "system:allocation",
            )
            .unwrap_or_else(|error| panic!("entry: {error}")),
        )
        .unwrap_or_else(|error| panic!("append: {error}"));
    ledger
}

fn filed(
    id: &str,
    kind: &LeaveType,
    from: &str,
    to: &str,
    calendar: &HolidayCalendar,
    evidence: Option<String>,
) -> Result<LeaveRequest, LeaveError> {
    LeaveRequest::file(
        LeaveRequestId::try_new(id).unwrap_or_else(|error| panic!("id: {error}")),
        employee(),
        unit(),
        kind,
        LeavePeriod::try_new(date(from), date(to))
            .unwrap_or_else(|error| panic!("period: {error}")),
        calendar,
        &[],
        evidence,
        authority("kasir.siti", actions::LEAVE_REQUEST_OWN, 10),
    )
}

/// The code path where the whole design pays off: an approval and its deduction
/// are produced together, and the state carries the entry.
#[test]
fn an_approval_of_balance_backed_leave_carries_the_entry_it_deducted() {
    let kind = annual();
    let policies = ratified();
    let ledger = allocated(12);
    let mut request = filed(
        "REQ-1",
        &kind,
        "2026-04-06",
        "2026-04-08",
        &calendar(Vec::new()),
        None,
    )
    .unwrap_or_else(|error| panic!("file: {error}"));

    let entry = request
        .approve(
            &kind,
            Some(BalanceContext {
                ledger: &ledger,
                policies: &policies,
            }),
            authority("bu.rina", actions::LEAVE_DECIDE, 20),
        )
        .unwrap_or_else(|error| panic!("approve: {error}"))
        .unwrap_or_else(|| panic!("balance-backed leave must deduct"));

    assert_eq!(entry.event(), LeaveEvent::Usage);
    assert_eq!(entry.amount(), LeaveDays::from_days(3).unwrap_or_default());
    assert_eq!(entry.by(), "bu.rina");
    assert_eq!(request.state().ledger_entry(), Some(entry.id()));
}

/// UU 13/2003 art. 93: sick leave is approved and nothing is deducted. That is
/// the correct outcome, not an omission.
#[test]
fn approving_sick_leave_deducts_from_nothing() {
    let kind = sick();
    let mut request = filed(
        "REQ-2",
        &kind,
        "2026-04-06",
        "2026-04-08",
        &calendar(Vec::new()),
        Some("surat dokter".to_owned()),
    )
    .unwrap_or_else(|error| panic!("file: {error}"));

    let entry = request
        .approve(&kind, None, authority("bu.rina", actions::LEAVE_DECIDE, 20))
        .unwrap_or_else(|error| panic!("approve: {error}"));
    assert!(entry.is_none());
    assert_eq!(request.state().ledger_entry(), None);
    assert_eq!(request.state().code(), "APPROVED");
}

/// Asking a balance of sick leave is a malformed question, not one whose answer
/// is zero — `0` is a number somebody can refuse leave with.
#[test]
fn a_kind_that_draws_on_nothing_has_no_balance_to_report() {
    let balances = LeaveBalances::new();
    let error = balances
        .balance_on(&sick(), date("2026-04-06"))
        .unwrap_err();
    assert_eq!(error.code(), "leave_not_balance_backed");
}

/// The days come off the balance and the balance is the fold.
#[test]
fn the_balance_is_the_fold_and_there_is_no_setter() {
    let mut ledger = allocated(12);
    assert_eq!(
        ledger
            .balance_on(date("2026-12-31"))
            .unwrap_or_else(|error| panic!("balance: {error}")),
        LeaveDays::from_days(12).unwrap_or_default()
    );
    ledger
        .append(
            LedgerEntry::try_new(
                "REQ-1:CUTI_TAHUNAN",
                date("2026-04-06"),
                LeaveEvent::Usage,
                LeaveDays::from_days(3).unwrap_or_default(),
                "bu.rina",
            )
            .unwrap_or_else(|error| panic!("entry: {error}")),
        )
        .unwrap_or_else(|error| panic!("append: {error}"));
    assert_eq!(
        ledger
            .balance_on(date("2026-12-31"))
            .unwrap_or_else(|error| panic!("balance: {error}")),
        LeaveDays::from_days(9).unwrap_or_default()
    );
    // And on a date before the usage, the days are still there.
    assert_eq!(
        ledger
            .balance_on(date("2026-04-05"))
            .unwrap_or_else(|error| panic!("balance: {error}")),
        LeaveDays::from_days(12).unwrap_or_default()
    );
}

/// Not enough days is a conflict, not a bad request: the number asked for is
/// well formed and the ledger simply does not have it.
#[test]
fn asking_for_more_days_than_are_left_is_a_conflict() {
    let kind = annual();
    let policies = ratified();
    let ledger = allocated(2);
    let mut request = filed(
        "REQ-3",
        &kind,
        "2026-04-06",
        "2026-04-10",
        &calendar(Vec::new()),
        None,
    )
    .unwrap_or_else(|error| panic!("file: {error}"));
    let error = request
        .approve(
            &kind,
            Some(BalanceContext {
                ledger: &ledger,
                policies: &policies,
            }),
            authority("bu.rina", actions::LEAVE_DECIDE, 20),
        )
        .unwrap_err();
    assert_eq!(error.code(), "leave_insufficient_balance");
    assert!(error.is_conflict());
    // And the request is untouched: nothing half-approved.
    assert!(request.state().is_pending());
}

/// A cuti bersama inside a leave span is already charged by the calendar.
/// Charging it again takes the same day off the employee twice.
#[test]
fn a_holiday_inside_a_span_is_not_charged_again() {
    let holidays = calendar(vec![Holiday::try_new(
        date("2026-04-07"),
        HolidayName::try_new("Cuti Bersama").unwrap_or_else(|error| panic!("name: {error}")),
        HolidayKind::CutiBersama,
        HolidayScope::Nationwide,
    )
    .unwrap_or_else(|error| panic!("holiday: {error}"))]);
    let request = filed(
        "REQ-4",
        &annual(),
        "2026-04-06",
        "2026-04-08",
        &holidays,
        None,
    )
    .unwrap_or_else(|error| panic!("file: {error}"));
    assert_eq!(request.chargeable_days(), 2);
    assert!(!request.chargeable().contains(&date("2026-04-07")));
}

/// A span that is all holidays asks for nothing, and approving it would put a
/// zero-day entry in the ledger that a later reader has to explain.
#[test]
fn a_span_of_nothing_but_red_days_is_refused() {
    let holidays = calendar(vec![Holiday::try_new(
        date("2026-04-07"),
        HolidayName::try_new("Cuti Bersama").unwrap_or_else(|error| panic!("name: {error}")),
        HolidayKind::CutiBersama,
        HolidayScope::Nationwide,
    )
    .unwrap_or_else(|error| panic!("holiday: {error}"))]);
    let error = filed(
        "REQ-5",
        &annual(),
        "2026-04-07",
        "2026-04-07",
        &holidays,
        None,
    )
    .unwrap_err();
    assert_eq!(error.code(), "leave_no_chargeable_days");
}

/// The gate that keeps an approval from being recorded under the key somebody
/// used to ask — the employee approving their own leave, wearing the shape of a
/// decision.
#[test]
fn a_request_cannot_be_approved_under_the_key_it_was_asked_with() {
    let kind = sick();
    let mut request = filed(
        "REQ-6",
        &kind,
        "2026-04-06",
        "2026-04-06",
        &calendar(Vec::new()),
        Some("surat dokter".to_owned()),
    )
    .unwrap_or_else(|error| panic!("file: {error}"));
    let error = request
        .approve(
            &kind,
            None,
            authority("kasir.siti", actions::LEAVE_REQUEST_OWN, 20),
        )
        .unwrap_err();
    assert_eq!(error.code(), "leave_action_forbids_decision");
    assert!(error.is_forbidden());
}

/// Anyone else who wants a pending request gone must reject it, which records
/// their name. A third-party withdrawal would dispose of it while looking like
/// the employee changed their own mind.
#[test]
fn only_the_person_who_asked_may_take_it_back() {
    let kind = annual();
    let mut request = filed(
        "REQ-7",
        &kind,
        "2026-04-06",
        "2026-04-06",
        &calendar(Vec::new()),
        None,
    )
    .unwrap_or_else(|error| panic!("file: {error}"));
    let error = request
        .withdraw(authority("bu.rina", actions::LEAVE_REQUEST, 20))
        .unwrap_err();
    assert_eq!(error.code(), "leave_withdrawal_not_by_requester");

    request
        .withdraw(authority("kasir.siti", actions::LEAVE_REQUEST_OWN, 21))
        .unwrap_or_else(|error| panic!("withdraw: {error}"));
    assert_eq!(request.state().code(), "WITHDRAWN");
}

/// A decided request is decided. There is no second opinion.
#[test]
fn a_decided_request_cannot_be_decided_again() {
    let kind = sick();
    let mut request = filed(
        "REQ-8",
        &kind,
        "2026-04-06",
        "2026-04-06",
        &calendar(Vec::new()),
        Some("surat dokter".to_owned()),
    )
    .unwrap_or_else(|error| panic!("file: {error}"));
    request
        .reject(authority("bu.rina", actions::LEAVE_DECIDE, 20))
        .unwrap_or_else(|error| panic!("reject: {error}"));
    let error = request
        .approve(&kind, None, authority("bu.rina", actions::LEAVE_DECIDE, 21))
        .unwrap_err();
    assert_eq!(error.code(), "leave_request_not_pending");
}

/// The stored halfway state — approved, nothing deducted — refuses to load.
/// This is the row the whole design exists to make unrepresentable, and the
/// database refuses the other half of it independently.
#[test]
fn an_approved_request_with_no_deduction_refuses_to_hydrate() {
    let kind = annual();
    let wire = LeaveRequestWire {
        id: LeaveRequestId::try_new("REQ-9").unwrap_or_else(|error| panic!("id: {error}")),
        employee: employee(),
        unit: unit(),
        leave_type: kind.code().clone(),
        period: LeavePeriod::try_new(date("2026-04-06"), date("2026-04-06"))
            .unwrap_or_else(|error| panic!("period: {error}")),
        chargeable: vec![date("2026-04-06")],
        evidence: None,
        requested: authority("kasir.siti", actions::LEAVE_REQUEST_OWN, 10),
        state: LeaveRequestState::Approved {
            decision: authority("bu.rina", actions::LEAVE_DECIDE, 20),
            ledger_entry: None,
        },
    };
    let error = LeaveRequest::try_new(wire, &kind).unwrap_err();
    assert_eq!(error.code(), "leave_approval_without_deduction");
}

/// And the mirror image: sick leave that deducted from something is somebody's
/// entitlement quietly disappearing.
#[test]
fn an_approved_sick_day_that_deducted_something_refuses_to_hydrate() {
    let kind = sick();
    let wire = LeaveRequestWire {
        id: LeaveRequestId::try_new("REQ-10").unwrap_or_else(|error| panic!("id: {error}")),
        employee: employee(),
        unit: unit(),
        leave_type: kind.code().clone(),
        period: LeavePeriod::try_new(date("2026-04-06"), date("2026-04-06"))
            .unwrap_or_else(|error| panic!("period: {error}")),
        chargeable: vec![date("2026-04-06")],
        evidence: Some("surat dokter".to_owned()),
        requested: authority("kasir.siti", actions::LEAVE_REQUEST_OWN, 10),
        state: LeaveRequestState::Approved {
            decision: authority("bu.rina", actions::LEAVE_DECIDE, 20),
            ledger_entry: Some("REQ-10:CUTI_SAKIT".to_owned()),
        },
    };
    let error = LeaveRequest::try_new(wire, &kind).unwrap_err();
    assert_eq!(error.code(), "leave_deduction_without_balance");
}

/// A balance asked about before any policy existed is not zero; it is
/// unanswerable, and saying so is the point.
#[test]
fn an_unratified_policy_is_named_rather_than_guessed() {
    let error = PolicyTimeline::new()
        .in_force_on(date("2026-04-06"))
        .unwrap_err();
    assert_eq!(error.code(), "leave_policy_not_ratified");
}

/// Two generations effective the same day would make "which rules applied"
/// depend on row order.
#[test]
fn two_policies_cannot_start_on_one_day() {
    let mut timeline = ratified();
    let error = timeline
        .install(
            LeavePolicy::try_new(
                2,
                date("2026-01-01"),
                LeaveDays::from_days(14).unwrap_or_default(),
                Accrual::UpFront,
                CarryForward::Forbidden,
                Encashment::Forbidden,
                AccrualDuringProtectedLeave::Suspended,
            )
            .unwrap_or_else(|error| panic!("policy: {error}")),
        )
        .unwrap_err();
    assert_eq!(error.code(), "leave_ledger_out_of_order");
}

/// Where the twelfths do not divide, the remainder is given in the final month
/// rather than dropped: over a year the employee receives exactly the
/// entitlement, never a rounding short.
#[test]
fn a_monthly_accrual_never_leaves_the_employee_short_at_the_year_end() {
    let policy = ratified();
    let in_force = policy
        .in_force_on(date("2026-06-30"))
        .unwrap_or_else(|error| panic!("policy: {error}"));
    assert_eq!(
        in_force
            .accrued_by_month(6)
            .unwrap_or_else(|error| panic!("accrual: {error}")),
        LeaveDays::from_days(6).unwrap_or_default()
    );
    assert_eq!(
        in_force
            .accrued_by_month(12)
            .unwrap_or_else(|error| panic!("accrual: {error}")),
        in_force.annual_entitlement()
    );
}

/// A cap that never bites is not a cap. The off-by-one this guards was real:
/// on the deadline itself the carried days already read as dead, so the sweep
/// found nothing to expire and they survived into the new year.
#[test]
fn carried_days_are_still_alive_on_the_day_they_expire() {
    let mut ledger = LeaveLedger::new();
    ledger
        .append(
            LedgerEntry::try_new(
                "carry-2025",
                date("2026-01-01"),
                LeaveEvent::CarryForward,
                LeaveDays::from_days(4).unwrap_or_default(),
                "system:carry",
            )
            .unwrap_or_else(|error| panic!("entry: {error}"))
            .expiring_on(date("2026-03-31")),
        )
        .unwrap_or_else(|error| panic!("append: {error}"));

    assert_eq!(
        ledger.carried_alive_on(date("2026-03-31")),
        LeaveDays::from_days(4).unwrap_or_default()
    );
    assert_eq!(ledger.carried_alive_on(date("2026-04-01")), LeaveDays::ZERO);

    let policies = ratified();
    let policy = policies
        .in_force_on(date("2026-03-31"))
        .unwrap_or_else(|error| panic!("policy: {error}"));
    let due = ledger
        .expiry_due(policy, date("2026-03-31"), "expiry-2026")
        .unwrap_or_else(|error| panic!("expiry: {error}"))
        .unwrap_or_else(|| panic!("four days were due to expire"));
    assert_eq!(due.event(), LeaveEvent::Expiry);
    assert_eq!(due.amount(), LeaveDays::from_days(4).unwrap_or_default());
}

/// A ledger whose entries went backwards folds to a balance that never existed,
/// and it does so silently. Decoding replays the rule.
#[test]
fn a_stored_ledger_out_of_order_refuses_to_load() {
    let json = serde_json::json!([
        {
            "id": "b",
            "on": "2026-04-06",
            "event": "USAGE",
            "amount": 300,
            "by": "bu.rina"
        },
        {
            "id": "a",
            "on": "2026-01-01",
            "event": "ALLOCATION",
            "amount": 1200,
            "by": "system"
        }
    ]);
    let error = serde_json::from_value::<LeaveLedger>(json).unwrap_err();
    assert!(
        error.to_string().contains("cannot follow"),
        "unexpected: {error}"
    );
}

/// "Bounded by the certificate" with no certificate required is unbounded leave
/// nobody decided to grant.
#[test]
fn certified_leave_must_require_its_certificate() {
    let error = LeaveType::try_new(
        LeaveTypeCode::try_new("CUTI_SAKIT").unwrap_or_else(|error| panic!("code: {error}")),
        "Cuti Sakit",
        LeaveBacking::AsCertified,
        LeavePayment::StatutoryScale,
        false,
    )
    .unwrap_err();
    assert_eq!(error.code(), "leave_certified_without_evidence");
}

/// One kind, however it is spelled.
#[test]
fn a_kind_is_one_kind_however_it_is_typed() {
    let lower = LeaveTypeCode::try_new("cuti_tahunan").unwrap_or_else(|error| panic!("{error}"));
    let upper = LeaveTypeCode::try_new("CUTI_TAHUNAN").unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(lower, upper);
}

/// Per-occurrence means per event, and the bound is counted in chargeable days
/// rather than in the length of the span.
#[test]
fn a_per_occurrence_allowance_is_bounded_by_the_days_it_charges() {
    let marriage = LeaveType::try_new(
        LeaveTypeCode::try_new("CUTI_MENIKAH").unwrap_or_else(|error| panic!("{error}")),
        "Cuti Menikah",
        LeaveBacking::PerOccurrence {
            max_days: LeaveDays::from_days(3).unwrap_or_default(),
        },
        LeavePayment::Full,
        false,
    )
    .unwrap_or_else(|error| panic!("type: {error}"));

    // Three working days across a public holiday is still three days off.
    let holidays = calendar(vec![Holiday::try_new(
        date("2026-05-01"),
        HolidayName::try_new("Hari Buruh").unwrap_or_else(|error| panic!("{error}")),
        HolidayKind::National,
        HolidayScope::Nationwide,
    )
    .unwrap_or_else(|error| panic!("holiday: {error}"))]);
    let ok = filed(
        "REQ-11",
        &marriage,
        "2026-04-30",
        "2026-05-02",
        &holidays,
        None,
    );
    assert!(ok.is_ok(), "{:?}", ok.err());

    let error = filed(
        "REQ-12",
        &marriage,
        "2026-04-27",
        "2026-04-30",
        &holidays,
        None,
    )
    .unwrap_err();
    assert_eq!(error.code(), "leave_exceeds_per_occurrence_limit");
}

/// An allowance of no days is not an allowance.
#[test]
fn a_per_occurrence_allowance_of_nothing_is_refused() {
    let error = LeaveType::try_new(
        LeaveTypeCode::try_new("CUTI_X").unwrap_or_else(|error| panic!("{error}")),
        "Nothing",
        LeaveBacking::PerOccurrence {
            max_days: LeaveDays::ZERO,
        },
        LeavePayment::Full,
        false,
    )
    .unwrap_err();
    assert_eq!(error.code(), "leave_not_positive");
}

/// Refused rather than defaulted to annual leave, which is how somebody's
/// balance quietly pays for their sick days.
#[test]
fn an_unknown_kind_is_refused_rather_than_defaulted() {
    let catalogue = LeaveTypeCatalogue::try_new(vec![annual()])
        .unwrap_or_else(|error| panic!("catalogue: {error}"));
    let error = catalogue
        .require(&LeaveTypeCode::try_new("CUTI_HANTU").unwrap_or_else(|error| panic!("{error}")))
        .unwrap_err();
    assert_eq!(error.code(), "leave_unknown_type");
}
