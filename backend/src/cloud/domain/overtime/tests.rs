//! The properties this kernel exists to hold.
//!
//! The first two carry the file: an order authorizes nothing until the worker
//! answers, and the worker's answer cannot be recorded under their supervisor's
//! key. Everything else here is a guard on those two.

use super::*;
use crate::cloud::domain::attendance::Minutes;
use crate::cloud::domain::employment::{actions, Authorization, EmployeeId, PlaceId};
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

fn policy() -> OvertimePolicy {
    // Four hours a day, eighteen a week — PP 35/2021 art. 26(1), stated by the
    // test operator rather than compiled into the kernel.
    OvertimePolicy::try_new(1, Minutes::new(4 * 60), Minutes::new(18 * 60))
        .unwrap_or_else(|error| panic!("policy: {error}"))
}

fn ordered(id: &str, minutes: u32, on: &str) -> OvertimeOrder {
    OvertimeOrder::order(
        OvertimeId::try_new(id).unwrap_or_else(|error| panic!("id: {error}")),
        EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("employee: {error}")),
        PlaceId::try_new("store-07").unwrap_or_else(|error| panic!("place: {error}")),
        date(on),
        DayKind::Working,
        Minutes::new(minutes),
        &policy(),
        authority("bu.rina", actions::OVERTIME_ORDER, 0),
    )
    .unwrap_or_else(|error| panic!("order: {error}"))
}

fn consent(offset: i64) -> WorkerConsent {
    WorkerConsent::try_new(authority(
        "kasir.siti",
        actions::OVERTIME_CONSENT_OWN,
        offset,
    ))
    .unwrap_or_else(|error| panic!("consent: {error}"))
}

/// The whole point: an order nobody has answered authorizes nothing.
#[test]
fn an_unanswered_order_authorizes_nothing() {
    let order = ordered("OT-1", 120, "2026-04-06");
    assert_eq!(order.state().code(), "AWAITING_CONSENT");
    assert_eq!(order.authorized_minutes(), None);
    // The minutes ordered are still readable — what was asked for is a fact.
    assert_eq!(order.planned(), Minutes::new(120));
}

#[test]
fn only_an_agreed_order_authorizes_its_minutes() {
    let mut order = ordered("OT-2", 120, "2026-04-06");
    order
        .agree(consent(10))
        .unwrap_or_else(|error| panic!("agree: {error}"));
    assert_eq!(order.authorized_minutes(), Some(Minutes::new(120)));
    assert_eq!(order.state().code(), "AGREED");
}

/// The refusal the module exists for. A consent recorded under the ordering key
/// is the supervisor agreeing twice.
#[test]
fn a_supervisor_cannot_answer_on_the_workers_behalf() {
    let error =
        WorkerConsent::try_new(authority("bu.rina", actions::OVERTIME_ORDER, 10)).unwrap_err();
    assert_eq!(error.code(), "overtime_action_forbids_consent");
    assert!(error.is_forbidden());
}

/// And the same row, stored, fails to hydrate — because a rule only the live
/// path enforces is a rule a round trip through storage removes.
#[test]
fn a_stored_consent_under_the_wrong_key_refuses_to_load() {
    let json = serde_json::json!({
        "id": "OT-3",
        "employee": "emp_1",
        "place": "store-07",
        "date": "2026-04-06",
        "day_kind": "WORKING",
        "planned": 120,
        "ordered": {
            "actor": "bu.rina",
            "action_key": actions::OVERTIME_ORDER,
            "at": instant(0),
            "reason": "stok opname",
        },
        // `OvertimeState` is internally tagged, so the answer lives inside the
        // state rather than beside it — the shape `postgres::overtime` builds
        // when it reassembles a row from its three columns.
        "state": {
            "state": "AGREED",
            "consent": {
                "authorization": {
                    "actor": "bu.rina",
                    "action_key": actions::OVERTIME_ORDER,
                    "at": instant(10),
                    "reason": "disetujui",
                }
            }
        },
    });
    let error = serde_json::from_value::<OvertimeOrder>(json).unwrap_err();
    assert!(
        error.to_string().contains("not the worker's own consent"),
        "unexpected: {error}"
    );
}

/// A refusal a sufficiently senior person can reverse is not a refusal.
#[test]
fn declining_is_terminal() {
    let mut order = ordered("OT-4", 120, "2026-04-06");
    order
        .decline(consent(10))
        .unwrap_or_else(|error| panic!("decline: {error}"));
    assert_eq!(order.state().code(), "DECLINED");
    assert_eq!(order.authorized_minutes(), None);

    let error = order.agree(consent(20)).unwrap_err();
    assert_eq!(error.code(), "overtime_order_not_awaiting_consent");
    assert!(error.is_conflict());
    // And it cannot be withdrawn into tidiness either.
    let error = order
        .withdraw(authority("bu.rina", actions::OVERTIME_ORDER, 20))
        .unwrap_err();
    assert_eq!(error.code(), "overtime_order_not_awaiting_consent");
}

/// An order the worker has agreed to is a commitment they may have arranged
/// their life around. Taking it back is a cancellation to record against the
/// agreement, not an erasure of it.
#[test]
fn an_agreed_order_cannot_be_withdrawn() {
    let mut order = ordered("OT-5", 120, "2026-04-06");
    order
        .agree(consent(10))
        .unwrap_or_else(|error| panic!("agree: {error}"));
    let error = order
        .withdraw(authority("bu.rina", actions::OVERTIME_ORDER, 20))
        .unwrap_err();
    assert_eq!(error.code(), "overtime_order_not_awaiting_consent");
}

/// The state is checked before the key, so an already-answered order reads as
/// answered rather than as an authority problem — the true and more useful of
/// the two.
#[test]
fn an_answered_order_reads_as_answered_even_under_a_bad_key() {
    let mut order = ordered("OT-6", 120, "2026-04-06");
    order
        .agree(consent(10))
        .unwrap_or_else(|error| panic!("agree: {error}"));
    let error = order
        .withdraw(authority("kasir.siti", actions::OVERTIME_CONSENT_OWN, 20))
        .unwrap_err();
    assert_eq!(error.code(), "overtime_order_not_awaiting_consent");
}

#[test]
fn an_unanswered_order_may_be_withdrawn_by_the_employer() {
    let mut order = ordered("OT-7", 120, "2026-04-06");
    order
        .withdraw(authority("bu.rina", actions::OVERTIME_ORDER, 20))
        .unwrap_or_else(|error| panic!("withdraw: {error}"));
    assert_eq!(order.state().code(), "WITHDRAWN");
    assert_eq!(order.authorized_minutes(), None);
}

/// Exactly at the cap is within it: four hours is four hours, not more.
#[test]
fn the_daily_cap_admits_exactly_itself_and_refuses_a_minute_more() {
    let policy = policy();
    assert!(policy.check_daily(Minutes::new(4 * 60)).is_ok());
    let error = policy.check_daily(Minutes::new(4 * 60 + 1)).unwrap_err();
    assert_eq!(error.code(), "overtime_exceeds_daily_cap");
    // A bad request rather than a conflict: the number in the body is the thing
    // to change.
    assert!(!error.is_conflict());
}

/// An unanswered or refused order commits nobody to anything, so it must not
/// consume somebody else's headroom.
#[test]
fn only_agreed_orders_eat_into_the_week() {
    let policy = policy();
    let mut agreed = ordered("OT-A", 4 * 60, "2026-04-06");
    agreed
        .agree(consent(10))
        .unwrap_or_else(|error| panic!("agree: {error}"));
    let mut declined = ordered("OT-B", 4 * 60, "2026-04-07");
    declined
        .decline(consent(11))
        .unwrap_or_else(|error| panic!("decline: {error}"));
    let awaiting = ordered("OT-C", 4 * 60, "2026-04-08");

    // 4h agreed + 4h declined + 4h unanswered + this one's 4h. Only the agreed
    // one counts, so the week stands at 8h against a cap of 18.
    let fresh = ordered("OT-D", 4 * 60, "2026-04-09");
    let week = vec![agreed.clone(), declined, awaiting];
    assert!(fresh.check_weekly_limit(&week, &policy).is_ok());

    // Four more agreed orders would: 5 × 4h = 20h.
    let mut many = Vec::new();
    for (index, day) in ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09"]
        .iter()
        .enumerate()
    {
        let mut order = ordered(&format!("OT-W{index}"), 4 * 60, day);
        order
            .agree(consent(20 + index as i64))
            .unwrap_or_else(|error| panic!("agree: {error}"));
        many.push(order);
    }
    let error = fresh.check_weekly_limit(&many, &policy).unwrap_err();
    assert_eq!(error.code(), "overtime_exceeds_weekly_cap");
    // A conflict: nothing about the request needs fixing, the week is full.
    assert!(error.is_conflict());
}

/// Self-exclusion is by id, so re-checking an order already in the week does
/// not double-count it.
#[test]
fn an_order_does_not_count_itself_twice() {
    let policy = policy();
    let mut order = ordered("OT-E", 4 * 60, "2026-04-06");
    order
        .agree(consent(10))
        .unwrap_or_else(|error| panic!("agree: {error}"));
    let week = vec![order.clone()];
    assert!(order.check_weekly_limit(&week, &policy).is_ok());
}

/// A zero cap forbids overtime by arithmetic rather than by decision. If an
/// operator means to forbid it, that is a policy of its own.
#[test]
fn a_policy_with_a_missing_cap_is_named_rather_than_guessed() {
    let error = OvertimePolicy::try_new(1, Minutes::ZERO, Minutes::new(18 * 60)).unwrap_err();
    assert_eq!(error.code(), "overtime_policy_not_ratified");

    let error = OvertimePolicy::try_new(1, Minutes::new(4 * 60), Minutes::new(60)).unwrap_err();
    assert_eq!(error.code(), "overtime_weekly_cap_below_daily");

    let error = OvertimePolicy::try_new(0, Minutes::new(60), Minutes::new(600)).unwrap_err();
    assert_eq!(error.code(), "overtime_zero_policy_version");
}

/// An order for no minutes is not an order. Storable, it would sit in the record
/// as an instruction somebody could later claim was worked against.
#[test]
fn an_order_for_no_minutes_is_refused() {
    let error = OvertimeOrder::order(
        OvertimeId::try_new("OT-Z").unwrap_or_else(|error| panic!("id: {error}")),
        EmployeeId::try_new("emp_1").unwrap_or_else(|error| panic!("employee: {error}")),
        PlaceId::try_new("store-07").unwrap_or_else(|error| panic!("place: {error}")),
        date("2026-04-06"),
        DayKind::Working,
        Minutes::ZERO,
        &policy(),
        authority("bu.rina", actions::OVERTIME_ORDER, 0),
    )
    .unwrap_err();
    assert_eq!(error.code(), "overtime_zero_minutes");
}

/// The statutory week is a week, not any rolling seven days: a rolling window
/// would make the same pair of orders lawful or not depending on which of them
/// you asked about.
#[test]
fn the_week_runs_monday_to_sunday() {
    // 8 April 2026 is a Wednesday.
    let (monday, sunday) = week_of(date("2026-04-08"));
    assert_eq!(monday, date("2026-04-06"));
    assert_eq!(sunday, date("2026-04-12"));
    // A Monday is its own week's start, and a Sunday its end.
    assert_eq!(week_of(date("2026-04-06")).0, date("2026-04-06"));
    assert_eq!(week_of(date("2026-04-12")).1, date("2026-04-12"));
}

/// Which statutory table applies is recorded; no multiplier is.
#[test]
fn the_day_kind_says_which_table_and_never_a_rate() {
    assert!(!DayKind::Working.is_non_working());
    assert!(DayKind::Rest.is_non_working());
    assert!(DayKind::Holiday.is_non_working());
    assert_eq!(DayKind::parse("REST"), Some(DayKind::Rest));
    assert_eq!(DayKind::parse("DOUBLE_PAY"), None);
}
