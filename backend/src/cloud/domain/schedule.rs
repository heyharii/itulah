//! What the date decides, and nothing else does.
//!
//! Four pieces of HR work are driven by the calendar rather than by a person:
//! the entitlement a policy has earned, the carry-forward a cap has put a
//! deadline on, next week's roster, and the nudges that say a contract is
//! ending or a month is still open. Everything here is the **decision** half of
//! that work, as pure functions over the dates and the records a caller
//! already holds, so the schedule can be reasoned about — and tested — without
//! a clock, a database or a running node.
//!
//! # What this module deliberately does not decide
//!
//! * **Attendance.** A punch is derived on read from the plan, the punches and
//!   the policy. There is no job here that "processes" a punch, because a job
//!   would have to store an outcome, and a stored outcome is the thing the
//!   attendance design exists to refuse.
//! * **Who works which shift.** Copying last week's pattern forward is the one
//!   roster act that is a *carry*, not a decision: it repeats what a person
//!   already approved, as a plan, which is revisable and carries its authority.
//!   Nothing here invents a shift for somebody who had none — that gap is
//!   reported, not filled.
//! * **Money.** No encashment draft, no accrual of a figure that has not been
//!   earned under a policy in force.

use super::leave::{LeaveDays, LeaveError, LeaveEvent, LeaveLedger, LeavePolicy, LedgerEntry};
use chrono::{Datelike, Duration, NaiveDate, Weekday};

/// The job names, in one place.
///
/// Strings because they are written into `scheduled_job_run` and read back by
/// a screen; a closed set here rather than at each call site so a typo cannot
/// invent a fifth job that never runs and never shows up.
pub mod jobs {
    /// The entitlement a policy has earned by this month.
    pub const LEAVE_ACCRUAL: &str = "leave.accrual";
    /// The carry-forward a cap put a deadline on, swept on its expiry date.
    pub const LEAVE_EXPIRY: &str = "leave.carry_forward_expiry";
    /// Next week's roster, carried from this week's plan.
    pub const ROSTER_CARRY: &str = "roster.carry_forward";
    /// A contract that ends soon, or ended and nobody noticed.
    pub const CONTRACT_NUDGE: &str = "nudge.contract_expiry";
    /// A month whose attendance nobody closed.
    pub const PERIOD_NUDGE: &str = "nudge.period_close";
    /// A week that starts soon with somebody unplanned.
    pub const ROSTER_NUDGE: &str = "nudge.roster_gap";
}

/// The notification kinds the nudges raise.
///
/// Not the job names: a job name is the scheduler's word for its own work, and
/// a notification kind is a closed set the database checks (0363 added these
/// three). Raising a nudge under its job name is refused by that check.
pub mod kinds {
    pub const CONTRACT_NUDGE: &str = "people.contract.expiring";
    pub const PERIOD_NUDGE: &str = "people.period.month_open";
    pub const ROSTER_NUDGE: &str = "people.roster.gap";
}

/// The key a run is claimed under, per period shape.
pub fn day_key(prefix: &str, date: NaiveDate) -> String {
    format!("{prefix}:{}", date.format("%Y-%m-%d"))
}

pub fn month_key(prefix: &str, date: NaiveDate) -> String {
    format!("{prefix}:{}", date.format("%Y-%m"))
}

pub fn week_key(prefix: &str, monday: NaiveDate) -> String {
    format!("{prefix}:{}", monday.format("%Y-%m-%d"))
}

/// Next week, as the Monday-to-Sunday a roster is built for.
///
/// "Next week" is the week that has not started: on any day including Sunday
/// it is the Monday after today. Two properties matter to the caller. It is
/// **stable** within a day, so a job that runs twice claims the same key. And
/// it never returns the current week, so a carry-forward can never write a plan
/// for a day somebody is already working.
pub fn next_week(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    let days_to_monday = match today.weekday() {
        Weekday::Mon => 7,
        Weekday::Tue => 6,
        Weekday::Wed => 5,
        Weekday::Thu => 4,
        Weekday::Fri => 3,
        Weekday::Sat => 2,
        Weekday::Sun => 1,
    };
    let from = today + Duration::days(days_to_monday);
    (from, from + Duration::days(6))
}

/// The week before `monday` — the plan a carry-forward copies from.
pub fn previous_week(monday: NaiveDate) -> (NaiveDate, NaiveDate) {
    let from = monday - Duration::days(7);
    (from, from + Duration::days(6))
}

/// The month whose attendance should already have been closed, or `None` when
/// there is nothing to chase yet.
///
/// The nudge is deliberately late rather than eager: during the month itself a
/// shop is working it, and a reminder on the second day that the month is not
/// closed is a reminder to stop reading reminders. From the 5th, the previous
/// month being open is somebody's problem.
pub fn month_awaiting_close(today: NaiveDate) -> Option<NaiveDate> {
    if today.day() < 5 {
        return None;
    }
    let this_month = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)?;
    Some(this_month - Duration::days(1))
}

/// How many days a contract may be from ending before somebody is told.
///
/// Two bands, because they ask for different work: review and decide, then
/// chase a signature. Not configurable — the number is a policy question this
/// module does not own, and a hidden default beats a wrong knob.
pub const CONTRACT_URGENT_DAYS: i64 = 14;
pub const CONTRACT_WARN_DAYS: i64 = 45;

/// The entitlement entry a policy has earned and the ledger does not hold yet.
///
/// **A delta, not a monthly posting.** The kernel already answers "how much has
/// been earned by the end of month M" (`LeavePolicy::accrued_by_month`), which
/// makes the good question "what is still missing" rather than "what does this
/// month add". A node that was down in March, a policy installed in July and a
/// monthly accrual whose twelfths do not divide all resolve to the same
/// arithmetic here, and none of them needs a backfill nobody can explain.
///
/// The entry is dated `as_of` and carries its own id, so the same period
/// claimed twice cannot mint two entries: the ledger's primary key refuses the
/// second, and the caller treats that refusal as "already done".
///
/// Refuses when the policy is not in force on the date, and when the ledger
/// already holds what was earned — that is a `None`, not an error.
pub fn accrual_due(
    policy: &LeavePolicy,
    ledger: &LeaveLedger,
    as_of: NaiveDate,
    entry_id: &str,
) -> Result<Option<LedgerEntry>, LeaveError> {
    if policy.effective_from() > as_of {
        return Err(LeaveError::NotPositive {
            field: "accrual before the policy was in force",
        });
    }
    let earned = policy.accrued_by_month(as_of.month())?;
    let already: i32 = ledger
        .entries()
        .iter()
        .filter(|entry| {
            entry.event() == LeaveEvent::Accrual && entry.on().year() == as_of.year()
        })
        .map(|entry| entry.amount().centidays())
        .sum();
    let missing = earned.centidays() - already;
    if missing <= 0 {
        return Ok(None);
    }
    Ok(Some(LedgerEntry::try_new(
        entry_id,
        as_of,
        LeaveEvent::Accrual,
        LeaveDays::from_centidays(missing)?,
        "hr-scheduler",
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::leave::{
        Accrual, AccrualDuringProtectedLeave, CarryForward, Encashment, PolicyTimeline,
    };

    fn date(raw: &str) -> NaiveDate {
        raw.parse().unwrap_or_else(|error| panic!("date: {error}"))
    }

    fn policy(annual_days: i32, accrual: Accrual, from: &str) -> LeavePolicy {
        let days = |n: i32| {
            LeaveDays::from_days(n).unwrap_or_else(|error| panic!("days {n}: {error}"))
        };
        LeavePolicy::try_new(
            1,
            from.parse().unwrap_or_else(|error| panic!("from: {error}")),
            days(annual_days),
            accrual,
            CarryForward::Capped {
                cap: days(6),
                expires_on_month_day: (3, 31),
            },
            Encashment::Forbidden,
            AccrualDuringProtectedLeave::Continues,
        )
        .unwrap_or_else(|error| panic!("policy: {error}"))
    }

    /// The window a roster is built for has not started, whatever day it is
    /// asked on — including Sunday, where "next week" is tomorrow.
    #[test]
    fn the_week_a_roster_is_built_for_is_always_ahead() {
        let cases = [
            ("2026-09-21", "2026-09-28", "2026-10-04"), // Monday
            ("2026-09-25", "2026-09-28", "2026-10-04"), // Friday
            ("2026-09-27", "2026-09-28", "2026-10-04"), // Sunday
        ];
        for (today, from, to) in cases {
            let (start, end) = next_week(date(today));
            assert_eq!(start, date(from), "from {today}");
            assert_eq!(end, date(to), "to {today}");
            assert_eq!(start.weekday(), Weekday::Mon);
            assert!(start > date(today));
        }
        let (prev_from, prev_to) = previous_week(date("2026-09-28"));
        assert_eq!(prev_from, date("2026-09-21"));
        assert_eq!(prev_to, date("2026-09-27"));
    }

    /// Nothing is chased while the month is still being worked.
    #[test]
    fn the_close_nudge_starts_after_the_month_it_is_about() {
        assert_eq!(month_awaiting_close(date("2026-09-01")), None);
        assert_eq!(month_awaiting_close(date("2026-09-04")), None);
        assert_eq!(
            month_awaiting_close(date("2026-09-05")),
            Some(date("2026-08-31"))
        );
        assert_eq!(
            month_awaiting_close(date("2026-10-20")),
            Some(date("2026-09-30"))
        );
    }

    /// An up-front policy pays its whole entitlement once, and a second run of
    /// the same period finds nothing missing.
    #[test]
    fn an_up_front_entitlement_is_earned_once() {
        let p = policy(12, Accrual::UpFront, "2026-01-01");
        let ledger = LeaveLedger::new();
        let first = accrual_due(&p, &ledger, date("2026-09-25"), "acc-1")
            .unwrap_or_else(|error| panic!("{error}"))
            .expect("the year's entitlement is due");
        assert_eq!(first.amount().centidays(), 1200);
        assert_eq!(first.event(), LeaveEvent::Accrual);
        assert_eq!(first.on(), date("2026-09-25"));

        let mut ledger_after = LeaveLedger::new();
        ledger_after
            .append(first)
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            accrual_due(&p, &ledger_after, date("2026-09-25"), "acc-2")
                .unwrap_or_else(|error| panic!("{error}")),
            None,
            "nothing is missing a second time"
        );
    }

    /// Twelve days accrue in twelfths, and a missed month is not lost: the
    /// delta in October is what October has earned plus what March did not.
    #[test]
    fn a_monthly_accrual_makes_up_a_month_the_node_missed() {
        let p = policy(12, Accrual::Monthly, "2026-01-01");
        let january = accrual_due(&p, &LeaveLedger::new(), date("2026-01-31"), "acc-jan")
            .unwrap_or_else(|error| panic!("{error}"))
            .expect("January earns a twelfth");
        assert_eq!(january.amount().centidays(), 100);

        // A node that ran in January, was down in February, and ran in October.
        let mut ledger = LeaveLedger::new();
        ledger
            .append(january)
            .unwrap_or_else(|error| panic!("{error}"));
        let october = accrual_due(&p, &ledger, date("2026-10-31"), "acc-oct")
            .unwrap_or_else(|error| panic!("{error}"))
            .expect("ten twelfths less January's one");
        assert_eq!(october.amount().centidays(), 900);

        // December pays the remainder rather than dropping it: ten twelfths
        // rounded down plus the residue is exactly the year.
        let mut ledger = LeaveLedger::new();
        ledger
            .append(
                LedgerEntry::try_new(
                    "acc-earlier",
                    date("2026-11-30"),
                    LeaveEvent::Accrual,
                    LeaveDays::from_days(9)
                        .unwrap_or_else(|error| panic!("days: {error}")),
                    "hr-scheduler",
                )
                .unwrap_or_else(|error| panic!("{error}")),
            )
            .unwrap_or_else(|error| panic!("{error}"));
        let december = accrual_due(&p, &ledger, date("2026-12-31"), "acc-dec")
            .unwrap_or_else(|error| panic!("{error}"))
            .expect("the residue is due");
        assert_eq!(december.amount().centidays(), 300);
    }

    /// A policy that is not in force yet earns nothing, and saying otherwise
    /// is refused rather than silently posted.
    #[test]
    fn a_policy_not_yet_in_force_earns_nothing() {
        let p = policy(12, Accrual::Monthly, "2027-01-01");
        assert!(accrual_due(&p, &LeaveLedger::new(), date("2026-12-31"), "acc-x").is_err());
    }

    /// The generation in force is the one the clock reads, so an amended
    /// policy is followed from its own date and not retroactively.
    #[test]
    fn the_policy_in_force_is_the_one_the_clock_uses() {
        let mut timeline = PolicyTimeline::new();
        timeline
            .install(policy(12, Accrual::UpFront, "2026-01-01"))
            .unwrap_or_else(|error| panic!("{error}"));
        timeline
            .install(policy(15, Accrual::UpFront, "2026-10-01"))
            .unwrap_or_else(|error| panic!("{error}"));
        let september = timeline
            .in_force_on(date("2026-09-30"))
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(september.annual_entitlement().centidays(), 1200);
        let october = timeline
            .in_force_on(date("2026-10-01"))
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(october.annual_entitlement().centidays(), 1500);
    }
}
