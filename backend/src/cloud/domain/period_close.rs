//! What a month-end checklist is, and what it decides.
//!
//! A pure kernel, in the sense `depreciation` and `bank_match` are pure: every
//! fact it needs arrives as an argument. It cannot read the database, and it
//! cannot ask what today is — which matters here more than anywhere, because
//! the whole point of a close is that the same month, checked twice, gives the
//! same answer. A verdict that depended on when it was asked would be a verdict
//! nobody could re-derive from the record.
//!
//! The SQL that finds the exceptions lives in `postgres::period_close`. What
//! lives here is the shape of what a check may report and the single rule that
//! turns a pile of reports into "you may seal this month" or "you may not, and
//! here is why". That rule is one function, it is exhaustively tested below,
//! and it is the only place the word "critical" means anything.
//!
//! # Why Pending blocks a critical check
//!
//! A check has three answers, not two. `Pass` and `Fail` are obvious; `Pending`
//! says the check could not be evaluated at all — the state it looks for does
//! not exist yet, or the sub-ledger it reads has not been built. Treating that
//! as a pass would mean a month sealed on a control nobody ran, and the
//! checklist snapshot stored against the close would record a green tick for
//! something that was never checked. So a critical check that is Pending blocks
//! exactly as a failing one does, and a check that will be Pending for months
//! is registered as non-critical with the reason written down.

use serde::{Deserialize, Serialize};

/// One accounting month, as two integers.
///
/// Deliberately not a date type. A calendar type in here is one line away from
/// asking for today's, and a September verdict that changed on the 1st of
/// October would be exactly the failure this module exists to prevent. The
/// caller turns these two numbers into whatever range its query needs.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ClosePeriod {
    pub year: i32,
    /// 1..=12. Checked by [`ClosePeriod::new`], and by the database besides.
    pub month: u32,
}

impl ClosePeriod {
    pub fn new(year: i32, month: u32) -> Option<Self> {
        if !(1..=12).contains(&month) {
            return None;
        }
        Some(Self { year, month })
    }

    /// The month after this one, so a caller can build a half-open range
    /// without reaching for a calendar library and without an off-by-one at
    /// December.
    pub fn next(self) -> Self {
        if self.month == 12 {
            Self {
                year: self.year + 1,
                month: 1,
            }
        } else {
            Self {
                year: self.year,
                month: self.month + 1,
            }
        }
    }

    pub fn last_day(self) -> u32 {
        days_in_month(self.year, self.month)
    }

    /// `2026-09`. What a person calls a period, and what every refusal below
    /// names, so the message and the screen agree.
    pub fn label(self) -> String {
        format!("{:04}-{:02}", self.year, self.month)
    }
}

/// The proleptic Gregorian rule, written out rather than borrowed.
pub fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Where to look when a check fails.
///
/// Not a message. A failing check that said "3 bills are still draft" would
/// leave somebody searching for them; this carries the three, each with the
/// identifier the screen routes on and the label a person recognises. The list
/// is deliberately capped by the caller — a check that found four hundred
/// exceptions reports the count honestly and shows the first handful.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CheckPointer {
    /// What sort of thing this is: `bill`, `payment`, `entry`, `asset`,
    /// `bank_account`, `bank_line`. The screen turns it into a route.
    pub kind: String,
    pub id: String,
    /// What a person calls it — an invoice number, an entry number, an asset
    /// code. Never an identifier dressed up as a name.
    pub label: String,
}

impl CheckPointer {
    pub fn new(kind: impl Into<String>, id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            id: id.into(),
            label: label.into(),
        }
    }
}

/// What one check found.
///
/// The `where` name on the wire is the one the screen reads; `at` is the Rust
/// spelling because `where` is a keyword. Same field, one name each side.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckOutcome {
    Pass,
    Fail {
        /// Every exception, not only the ones listed in `at`.
        count: i64,
        #[serde(rename = "where")]
        at: Vec<CheckPointer>,
    },
    /// The check could not be evaluated. Says so, and says why, rather than
    /// reporting a pass it did not earn.
    Pending {
        reason: String,
    },
    /// The check found the ground it stands on to be unsound, and no verdict
    /// about this month is worth anything until that is fixed.
    ///
    /// The one outcome that does not care whether anybody called the check
    /// critical. `Fail` says "this month has an exception in it"; `Blocked`
    /// says "the arithmetic underneath every other answer does not hold" — a
    /// trial balance that does not foot, a control account that disagrees with
    /// its sub-ledger. Weighing that against a `critical` flag would be
    /// offering somebody the option to seal a month on books that are not
    /// books, and the integrity engine's fourth state exists precisely because
    /// that option should not be on the screen.
    ///
    /// It is the state `integrity::CheckState::Blocked` maps onto.
    Blocked {
        reason: String,
    },
}

impl CheckOutcome {
    /// A failing check with the pointers capped, and the true count kept.
    pub fn failed(count: i64, at: Vec<CheckPointer>) -> Self {
        Self::Fail { count, at }
    }

    pub fn pending(reason: impl Into<String>) -> Self {
        Self::Pending {
            reason: reason.into(),
        }
    }

    pub fn blocked(reason: impl Into<String>) -> Self {
        Self::Blocked {
            reason: reason.into(),
        }
    }

    /// Pass when there is nothing to report, fail when there is. The shape
    /// almost every check wants, so none of them has to write the `if`.
    pub fn from_exceptions(count: i64, at: Vec<CheckPointer>) -> Self {
        if count == 0 {
            Self::Pass
        } else {
            Self::Fail { count, at }
        }
    }

    pub fn is_pass(&self) -> bool {
        matches!(self, Self::Pass)
    }
}

/// One check, evaluated.
///
/// `Close`-prefixed because the integrity engine's control equations produce a
/// `CheckResult` of their own and both names reach callers through the same
/// glob re-export. Two different answers to two different questions: this one
/// says whether a month may be sealed, that one whether a figure agrees with
/// the books.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CloseCheckResult {
    /// Stable, dotted, and never translated: `journal.balanced`. It is what a
    /// refusal names, what the stored snapshot keys on, and what a lane
    /// registering its own check chooses once and does not change.
    pub key: String,
    /// One line a person reads. Free to change; `key` is not.
    pub title: String,
    pub critical: bool,
    pub outcome: CheckOutcome,
}

impl CloseCheckResult {
    /// Whether this result stops the month being sealed.
    ///
    /// A critical check blocks when it fails and blocks when it could not be
    /// evaluated. See the module header: a pass nobody ran is worse than a
    /// refusal, because it leaves a green tick in the record.
    ///
    /// `Blocked` stops the close whatever `critical` says. That is the one
    /// asymmetry in this function and it is deliberate: `critical` is a
    /// judgement somebody made about how much a particular exception matters,
    /// and `Blocked` is the report that the books themselves do not add up.
    /// There is no judgement to make about the second.
    pub fn blocks(&self) -> bool {
        matches!(self.outcome, CheckOutcome::Blocked { .. })
            || (self.critical && !self.outcome.is_pass())
    }
}

/// The checklist, and what it means for the close.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CloseVerdict {
    pub period: ClosePeriod,
    pub may_close: bool,
    /// The keys of the checks standing in the way, in the order they were
    /// evaluated. Empty exactly when `may_close`.
    pub blocked_by: Vec<String>,
    pub checks: Vec<CloseCheckResult>,
}

impl CloseVerdict {
    /// The refusal, in one sentence, naming the checks rather than counting
    /// them. "3 checks failed" is a message somebody has to go and decode.
    pub fn refusal(&self) -> String {
        format!(
            "period {} cannot close: {}",
            self.period.label(),
            self.blocked_by.join(", ")
        )
    }
}

/// Fold a pile of evaluated checks into a decision. The only place `critical`
/// means anything.
pub fn close_verdict(period: ClosePeriod, checks: Vec<CloseCheckResult>) -> CloseVerdict {
    let blocked_by: Vec<String> = checks
        .iter()
        .filter(|check| check.blocks())
        .map(|check| check.key.clone())
        .collect();
    CloseVerdict {
        period,
        may_close: blocked_by.is_empty(),
        blocked_by,
        checks,
    }
}

/// Whether an unmatched bank line has been sitting long enough to be an
/// exception rather than ordinary timing.
///
/// Days arrive as an integer the caller worked out, for the reason the module
/// header gives. A line open for exactly the tolerance is not yet late: the
/// tolerance is "how long we allow", not "how long before we complain".
pub fn is_stale(days_open: i64, tolerance_days: i64) -> bool {
    days_open > tolerance_days
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(key: &str, critical: bool, outcome: CheckOutcome) -> CloseCheckResult {
        CloseCheckResult {
            key: key.to_string(),
            title: key.to_string(),
            critical,
            outcome,
        }
    }

    fn september() -> ClosePeriod {
        ClosePeriod::new(2026, 9).unwrap_or_else(|| panic!("september exists"))
    }

    #[test]
    fn a_month_with_nothing_against_it_may_close() {
        let verdict = close_verdict(
            september(),
            vec![
                result("journal.balanced", true, CheckOutcome::Pass),
                result("documents.drafts", true, CheckOutcome::Pass),
            ],
        );
        assert!(verdict.may_close);
        assert!(verdict.blocked_by.is_empty());
    }

    #[test]
    fn a_failing_critical_check_blocks_and_is_named() {
        let verdict = close_verdict(
            september(),
            vec![
                result("journal.balanced", true, CheckOutcome::Pass),
                result(
                    "documents.drafts",
                    true,
                    CheckOutcome::failed(2, vec![CheckPointer::new("bill", "b1", "INV-1")]),
                ),
            ],
        );
        assert!(!verdict.may_close);
        assert_eq!(verdict.blocked_by, vec!["documents.drafts".to_string()]);
        assert!(
            verdict.refusal().contains("documents.drafts"),
            "the refusal names the check: {}",
            verdict.refusal()
        );
        assert!(
            verdict.refusal().contains("2026-09"),
            "the refusal names the month: {}",
            verdict.refusal()
        );
    }

    #[test]
    fn a_failing_check_nobody_called_critical_does_not_block() {
        let verdict = close_verdict(
            september(),
            vec![result(
                "bank.unmatched_lines",
                false,
                CheckOutcome::failed(9, vec![]),
            )],
        );
        assert!(verdict.may_close, "an advisory check is advice");
        assert!(verdict.blocked_by.is_empty());
    }

    #[test]
    fn a_critical_check_that_could_not_run_blocks_too() {
        let verdict = close_verdict(
            september(),
            vec![result(
                "subledger.equal",
                true,
                CheckOutcome::pending("the sub-ledger does not exist yet"),
            )],
        );
        assert!(
            !verdict.may_close,
            "a control nobody could run is not a control that passed"
        );
        assert_eq!(verdict.blocked_by, vec!["subledger.equal".to_string()]);
    }

    #[test]
    fn a_pending_check_nobody_called_critical_is_only_reported() {
        let verdict = close_verdict(
            september(),
            vec![result(
                "postings.failed",
                false,
                CheckOutcome::pending("no document carries a failed state"),
            )],
        );
        assert!(verdict.may_close);
    }

    #[test]
    fn blocked_refuses_the_close_even_when_nobody_called_it_critical() {
        let verdict = close_verdict(
            september(),
            vec![result(
                "integrity.equations",
                false,
                CheckOutcome::blocked("the trial balance does not foot"),
            )],
        );
        assert!(
            !verdict.may_close,
            "books that do not add up are not a matter of opinion"
        );
        assert_eq!(verdict.blocked_by, vec!["integrity.equations".to_string()]);
    }

    #[test]
    fn no_exceptions_is_a_pass_and_one_is_not() {
        assert_eq!(CheckOutcome::from_exceptions(0, vec![]), CheckOutcome::Pass);
        assert!(!CheckOutcome::from_exceptions(1, vec![]).is_pass());
    }

    #[test]
    fn a_period_knows_its_own_length_and_its_successor() {
        assert_eq!(september().last_day(), 30);
        assert_eq!(
            ClosePeriod::new(2026, 12)
                .unwrap_or_else(|| panic!("december"))
                .next(),
            ClosePeriod {
                year: 2027,
                month: 1
            },
            "December rolls the year"
        );
        assert_eq!(
            ClosePeriod::new(2024, 2)
                .unwrap_or_else(|| panic!("february"))
                .last_day(),
            29,
            "2024 is a leap year"
        );
        assert_eq!(
            ClosePeriod::new(2100, 2)
                .unwrap_or_else(|| panic!("february"))
                .last_day(),
            28,
            "2100 is not, and the hundred-year rule is the one people forget"
        );
        assert!(ClosePeriod::new(2026, 13).is_none());
        assert!(ClosePeriod::new(2026, 0).is_none());
    }

    #[test]
    fn the_tolerance_is_how_long_we_allow_not_how_long_before_we_complain() {
        assert!(!is_stale(30, 30));
        assert!(is_stale(31, 30));
        assert!(!is_stale(0, 30));
    }
}
