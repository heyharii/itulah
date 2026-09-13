//! What "late" means, and since when.
//!
//! # Policy is data, not configuration
//!
//! The implementation this replaces read the lateness grace from the database
//! with a silent thirty-minute fallback when the row or the connection was
//! missing. A tolerance that appears out of nowhere when a query fails is not
//! auditable: the same arrival is on time or late depending on whether the
//! database answered, and nothing on any screen says which happened.
//!
//! So every policy here is an explicit, versioned, effective-dated value.
//! **There is no default.** A date no version covers yields
//! [`AttendanceError::NoPolicyEffective`] and nothing is derived from it —
//! gaps are allowed and are never silently filled.
//!
//! # Why the version travels with the outcome
//!
//! Every derived attendance outcome records the [`PolicyVersion`] it was
//! produced under, so a later reader can tell which generation of the rules
//! applied without inferring it from dates. A policy change is a new version,
//! not an edit: last month's timesheet still folds under last month's rules.
//!
//! Ported from the reference's `attendance-domain::policy`. The punches,
//! rosters and corrections that consume this are not part of this slice —
//! head office can decide what lateness means before anything is clocking.

use super::error::AttendanceError;
use core::fmt;

/// Upper bound on [`PolicyLimits::late_grace`]: eight hours.
///
/// A lateness grace cannot cover a whole shift. Beyond this the "grace" is the
/// plan, and an unbounded value would turn every arrival into on-time forever —
/// which is not a policy choice, it is a rule quietly switched off.
pub const MAX_LATE_GRACE_MINUTES: u32 = 480;

/// Upper bound on [`PolicyLimits::duplicate_punch_window`]: one hour.
///
/// Two same-direction punches an hour apart are two physical events, not one
/// double-tap. An unbounded window would let a policy collapse an entire shift
/// into a single punch.
pub const MAX_DUPLICATE_PUNCH_WINDOW_MINUTES: u32 = 60;

/// Bounded maximum length of a policy identifier.
pub const MAX_ID_LEN: usize = 64;

/// A whole number of minutes.
///
/// Attendance is never measured in fractional hours. The implementation this
/// replaces carried `overtime_hours: f64`, which cannot round-trip through
/// storage and cannot be compared for equality — two timesheets that agree
/// could disagree, and neither was wrong.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(transparent)]
pub struct Minutes(u32);

impl Minutes {
    pub const ZERO: Minutes = Minutes(0);

    pub const fn new(minutes: u32) -> Self {
        Minutes(minutes)
    }

    pub const fn get(self) -> u32 {
        self.0
    }

    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }
}

/// Nought minutes, which is a measurement and not an absence.
///
/// `DayMeasures` derives `Default` so a test — and a fold that has not yet seen
/// a punch — can start from "nothing measured yet" and add to it, and that
/// needs this. It does not weaken the rule that absence is never silently
/// zero: a quantity nobody measured is `Option<Minutes>` and is `None`, which
/// is a different type from a span that was measured and came to nought.
impl Default for Minutes {
    fn default() -> Self {
        Self::ZERO
    }
}

impl fmt::Display for Minutes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}m", self.0)
    }
}

/// Identity of an attendance policy, independent of its version.
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "String", into = "String")]
pub struct PolicyId(String);

impl PolicyId {
    pub fn try_new(raw: &str) -> Result<Self, AttendanceError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(AttendanceError::Required { field: "policy id" });
        }
        if trimmed.chars().any(char::is_control) {
            return Err(AttendanceError::NotPrintable { field: "policy id" });
        }
        if trimmed.chars().count() > MAX_ID_LEN {
            return Err(AttendanceError::TooLong {
                field: "policy id",
                max: MAX_ID_LEN,
            });
        }
        Ok(PolicyId(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for PolicyId {
    type Error = AttendanceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        PolicyId::try_new(&value)
    }
}

impl From<PolicyId> for String {
    fn from(value: PolicyId) -> String {
        value.0
    }
}

impl fmt::Display for PolicyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Which generation of the rules. Never zero: zero would mean "unversioned",
/// and every derived outcome names the version that produced it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(try_from = "u32", into = "u32")]
pub struct PolicyVersion(u32);

impl PolicyVersion {
    pub fn try_new(version: u32) -> Result<Self, AttendanceError> {
        if version == 0 {
            return Err(AttendanceError::ZeroPolicyVersion);
        }
        Ok(PolicyVersion(version))
    }

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl TryFrom<u32> for PolicyVersion {
    type Error = AttendanceError;
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        PolicyVersion::try_new(value)
    }
}

impl From<PolicyVersion> for u32 {
    fn from(value: PolicyVersion) -> u32 {
        value.0
    }
}

impl fmt::Display for PolicyVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "v{}", self.0)
    }
}

/// The tunable minute limits of one policy version.
///
/// A struct rather than four positional arguments of the same type, which a
/// caller could transpose without the compiler noticing — and transposing the
/// lateness grace with the double-tap window is a mistake nobody would see
/// until a month of timesheets was wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct PolicyLimits {
    /// Arriving later than the planned start by **at most** this many minutes
    /// is still on time.
    pub late_grace: Minutes,
    /// Leaving earlier than the planned end by at most this many minutes is
    /// not an early departure.
    pub early_leave_grace: Minutes,
    /// Minutes worked past the planned end before *ordered* overtime is
    /// recognised as overtime worked.
    pub overtime_minimum: Minutes,
    /// Two consecutive same-direction punches this close together are one
    /// physical event — a kiosk double-tap — and collapse into one.
    pub duplicate_punch_window: Minutes,
}

/// One effective-dated version of the attendance policy.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "AttendancePolicyWire")]
pub struct AttendancePolicy {
    id: PolicyId,
    version: PolicyVersion,
    effective_from: chrono::NaiveDate,
    effective_to: Option<chrono::NaiveDate>,
    limits: PolicyLimits,
}

/// Deserialization shim, so a stored policy re-runs its own constructor.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttendancePolicyWire {
    id: PolicyId,
    version: PolicyVersion,
    effective_from: chrono::NaiveDate,
    effective_to: Option<chrono::NaiveDate>,
    limits: PolicyLimits,
}

impl TryFrom<AttendancePolicyWire> for AttendancePolicy {
    type Error = AttendanceError;
    fn try_from(value: AttendancePolicyWire) -> Result<Self, Self::Error> {
        AttendancePolicy::try_new(
            value.id,
            value.version,
            value.effective_from,
            value.effective_to,
            value.limits,
        )
    }
}

impl AttendancePolicy {
    /// Build a version, refusing an end before its start and a limit that is
    /// not a policy choice.
    pub fn try_new(
        id: PolicyId,
        version: PolicyVersion,
        effective_from: chrono::NaiveDate,
        effective_to: Option<chrono::NaiveDate>,
        limits: PolicyLimits,
    ) -> Result<Self, AttendanceError> {
        if let Some(to) = effective_to {
            if to < effective_from {
                return Err(AttendanceError::PolicyEndsBeforeStart);
            }
        }
        if limits.late_grace.get() > MAX_LATE_GRACE_MINUTES {
            return Err(AttendanceError::PolicyLimitOutOfRange {
                field: "late_grace",
                max: MAX_LATE_GRACE_MINUTES,
            });
        }
        if limits.duplicate_punch_window.get() > MAX_DUPLICATE_PUNCH_WINDOW_MINUTES {
            return Err(AttendanceError::PolicyLimitOutOfRange {
                field: "duplicate_punch_window",
                max: MAX_DUPLICATE_PUNCH_WINDOW_MINUTES,
            });
        }
        Ok(AttendancePolicy {
            id,
            version,
            effective_from,
            effective_to,
            limits,
        })
    }

    pub fn id(&self) -> &PolicyId {
        &self.id
    }
    /// The version stamped onto every outcome derived under it.
    pub fn version(&self) -> PolicyVersion {
        self.version
    }
    pub fn effective_from(&self) -> chrono::NaiveDate {
        self.effective_from
    }
    /// Inclusive last date, or `None` while the version is still open.
    pub fn effective_to(&self) -> Option<chrono::NaiveDate> {
        self.effective_to
    }
    pub fn limits(&self) -> PolicyLimits {
        self.limits
    }

    /// Does this version cover `date`?
    pub fn covers(&self, date: chrono::NaiveDate) -> bool {
        date >= self.effective_from && self.effective_to.is_none_or(|to| date <= to)
    }
}

/// Every version of the policy, ordered and non-overlapping.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "Vec<AttendancePolicy>", into = "Vec<AttendancePolicy>")]
pub struct PolicySchedule {
    versions: Vec<AttendancePolicy>,
}

impl From<PolicySchedule> for Vec<AttendancePolicy> {
    fn from(value: PolicySchedule) -> Self {
        value.versions
    }
}

impl TryFrom<Vec<AttendancePolicy>> for PolicySchedule {
    type Error = AttendanceError;
    fn try_from(value: Vec<AttendancePolicy>) -> Result<Self, Self::Error> {
        PolicySchedule::try_new(value)
    }
}

impl PolicySchedule {
    /// Build a schedule from versions in any order.
    ///
    /// Sorted canonically by start date; overlaps are refused, and so is
    /// anything following a still-open version. **Gaps are allowed** and are
    /// never filled: a date in a gap has no policy, and derivation for that
    /// date fails closed rather than borrowing the nearest rule.
    pub fn try_new(mut versions: Vec<AttendancePolicy>) -> Result<Self, AttendanceError> {
        if versions.is_empty() {
            return Err(AttendanceError::EmptyPolicySchedule);
        }
        versions.sort_by(|a, b| {
            a.effective_from
                .cmp(&b.effective_from)
                .then_with(|| a.version.cmp(&b.version))
        });
        for window in versions.windows(2) {
            let overlaps = match window[0].effective_to {
                None => true,
                Some(to) => window[1].effective_from <= to,
            };
            if overlaps {
                return Err(AttendanceError::OverlappingPolicy);
            }
        }
        Ok(PolicySchedule { versions })
    }

    pub fn single(policy: AttendancePolicy) -> Self {
        PolicySchedule {
            versions: vec![policy],
        }
    }

    /// The versions, earliest first.
    pub fn versions(&self) -> &[AttendancePolicy] {
        &self.versions
    }

    /// The version effective on `date`.
    ///
    /// An error rather than an `Option`, because every caller of this is about
    /// to decide whether somebody was late, and "no rule covers that day" is
    /// something a person has to fix — not a `None` to shrug past.
    pub fn effective_on(
        &self,
        date: chrono::NaiveDate,
    ) -> Result<&AttendancePolicy, AttendanceError> {
        self.versions
            .iter()
            .find(|policy| policy.covers(date))
            .ok_or(AttendanceError::NoPolicyEffective { date })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn date(iso: &str) -> NaiveDate {
        iso.parse()
            .unwrap_or_else(|error| panic!("date {iso}: {error}"))
    }

    fn limits(late: u32) -> PolicyLimits {
        PolicyLimits {
            late_grace: Minutes::new(late),
            early_leave_grace: Minutes::new(10),
            overtime_minimum: Minutes::new(30),
            duplicate_punch_window: Minutes::new(2),
        }
    }

    fn version(n: u32, from: &str, to: Option<&str>, late: u32) -> AttendancePolicy {
        AttendancePolicy::try_new(
            PolicyId::try_new("standard").unwrap_or_else(|error| panic!("id: {error}")),
            PolicyVersion::try_new(n).unwrap_or_else(|error| panic!("version: {error}")),
            date(from),
            to.map(date),
            limits(late),
        )
        .unwrap_or_else(|error| panic!("policy: {error}"))
    }

    /// The whole reason this module exists. A day nobody wrote a rule for has
    /// no rule — not a borrowed one, and not a thirty-minute guess.
    #[test]
    fn a_day_no_version_covers_has_no_policy_at_all() {
        let schedule = PolicySchedule::try_new(vec![
            version(1, "2026-01-01", Some("2026-03-31"), 15),
            version(2, "2026-07-01", None, 10),
        ])
        .unwrap_or_else(|error| panic!("schedule: {error}"));

        assert!(schedule.effective_on(date("2026-02-10")).is_ok());
        assert!(schedule.effective_on(date("2026-08-10")).is_ok());

        // April, May and June were left uncovered. Nothing fills them.
        let gap = schedule.effective_on(date("2026-05-01"));
        assert!(
            matches!(gap, Err(AttendanceError::NoPolicyEffective { .. })),
            "a gap produced a policy: {gap:?}"
        );
    }

    #[test]
    fn the_version_in_force_is_the_one_covering_the_date() {
        let schedule = PolicySchedule::try_new(vec![
            version(2, "2026-04-01", None, 10),
            version(1, "2026-01-01", Some("2026-03-31"), 15),
        ])
        .unwrap_or_else(|error| panic!("schedule: {error}"));

        // Given out of order, sorted canonically.
        assert_eq!(schedule.versions()[0].version().get(), 1);

        let march = schedule
            .effective_on(date("2026-03-31"))
            .unwrap_or_else(|error| panic!("march: {error}"));
        assert_eq!(march.limits().late_grace.get(), 15);

        let april = schedule
            .effective_on(date("2026-04-01"))
            .unwrap_or_else(|error| panic!("april: {error}"));
        assert_eq!(april.limits().late_grace.get(), 10);
    }

    #[test]
    fn versions_may_not_overlap() {
        let overlapping = PolicySchedule::try_new(vec![
            version(1, "2026-01-01", Some("2026-06-30"), 15),
            version(2, "2026-06-01", None, 10),
        ]);
        assert!(matches!(
            overlapping,
            Err(AttendanceError::OverlappingPolicy)
        ));
    }

    /// An open version is "and everything after". Something following it would
    /// make "which rules applied" depend on row order.
    #[test]
    fn nothing_may_follow_a_version_that_never_ends() {
        let after_open = PolicySchedule::try_new(vec![
            version(1, "2026-01-01", None, 15),
            version(2, "2027-01-01", None, 10),
        ]);
        assert!(matches!(
            after_open,
            Err(AttendanceError::OverlappingPolicy)
        ));
    }

    /// A grace that covers a whole shift is not a tolerance, it is the plan.
    #[test]
    fn a_tolerance_large_enough_to_disable_its_own_rule_is_refused() {
        let absurd = AttendancePolicy::try_new(
            PolicyId::try_new("standard").unwrap_or_else(|error| panic!("id: {error}")),
            PolicyVersion::try_new(1).unwrap_or_else(|error| panic!("version: {error}")),
            date("2026-01-01"),
            None,
            limits(MAX_LATE_GRACE_MINUTES + 1),
        );
        assert!(matches!(
            absurd,
            Err(AttendanceError::PolicyLimitOutOfRange {
                field: "late_grace",
                ..
            })
        ));

        let wide_window = AttendancePolicy::try_new(
            PolicyId::try_new("standard").unwrap_or_else(|error| panic!("id: {error}")),
            PolicyVersion::try_new(1).unwrap_or_else(|error| panic!("version: {error}")),
            date("2026-01-01"),
            None,
            PolicyLimits {
                duplicate_punch_window: Minutes::new(MAX_DUPLICATE_PUNCH_WINDOW_MINUTES + 1),
                ..limits(15)
            },
        );
        assert!(matches!(
            wide_window,
            Err(AttendanceError::PolicyLimitOutOfRange {
                field: "duplicate_punch_window",
                ..
            })
        ));
    }

    #[test]
    fn a_version_may_not_end_before_it_starts_and_may_not_be_zero() {
        let backwards = AttendancePolicy::try_new(
            PolicyId::try_new("standard").unwrap_or_else(|error| panic!("id: {error}")),
            PolicyVersion::try_new(1).unwrap_or_else(|error| panic!("version: {error}")),
            date("2026-06-01"),
            Some(date("2026-01-01")),
            limits(15),
        );
        assert!(matches!(
            backwards,
            Err(AttendanceError::PolicyEndsBeforeStart)
        ));
        assert!(matches!(
            PolicyVersion::try_new(0),
            Err(AttendanceError::ZeroPolicyVersion)
        ));
    }

    /// A stored row goes back through the constructor, so a schedule edited by
    /// hand into an overlap fails to load rather than becoming the rules.
    #[test]
    fn a_stored_schedule_is_revalidated_on_the_way_in() {
        let json = serde_json::json!([
            { "id": "standard", "version": 1, "effective_from": "2026-01-01",
              "effective_to": "2026-06-30",
              "limits": { "late_grace": 15, "early_leave_grace": 10,
                          "overtime_minimum": 30, "duplicate_punch_window": 2 } },
            { "id": "standard", "version": 2, "effective_from": "2026-06-01",
              "effective_to": null,
              "limits": { "late_grace": 10, "early_leave_grace": 10,
                          "overtime_minimum": 30, "duplicate_punch_window": 2 } }
        ]);
        let decoded: Result<PolicySchedule, _> = serde_json::from_value(json);
        assert!(decoded.is_err(), "an overlapping stored schedule hydrated");
    }
}
