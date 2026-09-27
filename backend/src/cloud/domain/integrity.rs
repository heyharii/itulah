//! Whether the books agree with themselves, and what to do when they do not.
//!
//! The poster already refuses an entry whose debits and credits disagree. That
//! is a guarantee about one entry and says nothing about the estate: the
//! Payment Ledger can drift from the control account it is mapped to, a shop
//! can hold funds head office has no record of sending, and every journal in
//! the system can be perfectly balanced while both are true. This module is the
//! vocabulary for saying so.
//!
//! # Three ledgers, ten equations
//!
//! The architecture has exactly three ledgers — General, Payment, Stock — and
//! everything else (bank, asset, giro, tax, payroll, remittance, fund
//! allocation, sales reconciliation) is a register or a projection over them.
//! So the equations this vocabulary describes are not "each subledger against
//! its control account". They are ten named statements about those three
//! ledgers and the registers around them, and `postgres::integrity` is where
//! they are written down.
//!
//! # Two of them are foundations
//!
//! Equations one and two — the General Ledger balancing, and the Payment
//! Ledger tying to it — are not findings. They are the ground every other
//! answer stands on. A run that reported "the General Ledger does not balance"
//! as one exception among eleven would be inviting somebody to work the other
//! ten, and the other ten would be arithmetic over a ledger that is already
//! known to be wrong. So [`classify_foundation`] returns [`CheckState::Blocked`]
//! where [`classify`] would return [`CheckState::Exception`].
//!
//! # Four states, and why not two
//!
//! A control check that answered only "agrees" or "does not agree" would be
//! wrong most mornings, because a great deal of real money is legitimately in
//! flight. A card settlement lands two days after the sale; a transfer clears
//! the day after it is sent. On the first of those days the two sides genuinely
//! disagree and nothing is wrong.
//!
//! So a difference is read together with its age. Inside the settlement window
//! it is [`CheckState::Pending`] — timing, not a fault. Outside it, the same
//! difference is an [`CheckState::Exception`] and somebody has to act.
//!
//! [`CheckState::Pending`] carries a second meaning, and it is the one this
//! engine is used for most in its first months: an equation whose other half
//! has not been built yet. Not Balanced, ever. An equation nobody could compute
//! is not an equation that held, and the reason names the table it is waiting
//! for so the gap is legible on a screen rather than only in a source file.
//!
//! The fourth state, [`CheckState::Blocked`], is for an answer nobody may build
//! on: a control account nobody has mapped, and the two foundation equations
//! when they fail. Reporting either as "balanced" is the failure mode this
//! whole module exists to prevent — a green screen that is green because it
//! looked at nothing.
//!
//! # Why an answer carries actions
//!
//! "Bank account differs by 4,150,000" is a fact nobody can do anything with.
//! "Statement line 14 of 3 September, 4,150,000 out, matches nothing in the
//! books — match it, or write the journal it is missing" is the same fact with
//! the next move attached. The exceptions people actually clear are the ones
//! that arrive with a verb, so [`SuggestedAction`] is part of the result rather
//! than something a screen infers later from the key.
//!
//! # Purity
//!
//! Nothing here reads a database or a clock. Ages arrive as whole days the
//! caller worked out from the calendar, for exactly the reason the depreciation
//! kernel takes a period index: a check run at 23:59 and again at 00:01 must
//! not classify the same difference two ways.

use serde::{Deserialize, Serialize};

/// What a control equation says about itself.
///
/// Ordered worst-last so a run's headline is `max` over its results and a
/// screen never has to hold a second table of severities.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum CheckState {
    /// The two sides agree, inside the tolerance the check was given.
    Balanced,
    /// Not an answer yet. Either the difference is young enough to be money in
    /// flight, or the equation's other half has not been built. Nobody is asked
    /// to do anything either way.
    Pending,
    /// They disagree and the difference has outlived every explanation the
    /// check knows. Somebody has to act.
    Exception,
    /// An answer nobody may build on: a check that could not be evaluated at
    /// all, or one of the two foundation equations failing. Never to be shown
    /// as agreement — an equation nobody could compute is not an equation that
    /// held, and a general ledger that does not balance makes every figure
    /// derived from it a guess.
    Blocked,
}

impl CheckState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Balanced => "BALANCED",
            Self::Pending => "PENDING",
            Self::Exception => "EXCEPTION",
            Self::Blocked => "BLOCKED",
        }
    }

    /// True when a person has to do something about it.
    ///
    /// `Pending` is deliberately not open. A feed that listed every card
    /// settlement still inside its own settlement window would be a feed of
    /// several hundred rows a day, none of which anybody should touch, and the
    /// four real exceptions would be somewhere in it.
    pub const fn is_open(self) -> bool {
        matches!(self, Self::Exception | Self::Blocked)
    }

    /// The worst of a set, or `Balanced` when the set is empty.
    pub fn worst(states: impl IntoIterator<Item = Self>) -> Self {
        states.into_iter().max().unwrap_or(Self::Balanced)
    }
}

/// What the next move is, named as a verb somebody could be asked to do.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum ActionVerb {
    /// Agree that two records are the same event.
    Match,
    /// Undo an agreement that turned out to be wrong.
    Unmatch,
    /// The amount is right and the account is not.
    Reclassify,
    /// Post the mirror of an entry that should not have been made.
    Reverse,
    /// Book a correcting figure, with a reason.
    Adjust,
    /// Accept that the money is not coming, and say where it goes.
    WriteOff,
    /// Nobody can name the fix yet; the next act is to find out.
    Investigate,
    /// The sale was taken on the wrong tender and has to be told again.
    Retender,
    /// Something happened that no document records. Write the document.
    CreateDocument,
}

impl ActionVerb {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Match => "MATCH",
            Self::Unmatch => "UNMATCH",
            Self::Reclassify => "RECLASSIFY",
            Self::Reverse => "REVERSE",
            Self::Adjust => "ADJUST",
            Self::WriteOff => "WRITE_OFF",
            Self::Investigate => "INVESTIGATE",
            Self::Retender => "RETENDER",
            Self::CreateDocument => "CREATE_DOCUMENT",
        }
    }
}

/// One thing somebody could do about one exception.
///
/// `target_kind` and `target_id` are a record, never a URL, for the reason
/// `notification.subject_kind` is: routes get renamed and records do not. They
/// are also what makes an exception stable across runs — the attention feed
/// keys on them, so the same unmatched line stays one row however many nights
/// the engine sees it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SuggestedAction {
    pub verb: ActionVerb,
    /// `bank_statement_line`, `supplier_invoice`, `fixed_asset`, `site`,
    /// `unit` … A `unit` is a finding about a unit's books (0605); the run puts
    /// it in the feeds of the premises that unit owns.
    pub target_kind: String,
    pub target_id: String,
    /// The sentence on the button, written where the facts are.
    pub label: String,
}

impl SuggestedAction {
    pub fn new(
        verb: ActionVerb,
        target_kind: &str,
        target_id: impl Into<String>,
        label: impl Into<String>,
    ) -> Self {
        Self {
            verb,
            target_kind: target_kind.to_string(),
            target_id: target_id.into(),
            label: label.into(),
        }
    }
}

/// Where an answer, and the work it raises, belongs: the whole company, or
/// one premises' feed.
///
/// A place and not a book, deliberately. The books are a unit's (0605), but a
/// feed is read in a shop, and `attention_item` is keyed by site; a finding
/// about a unit's books reaches it through the unit's premises (see the
/// `unit` target kind on [`SuggestedAction`]).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum Scope {
    /// One answer for the whole company.
    Group,
    /// One answer for one location.
    Site { site_id: String },
}

impl Scope {
    pub fn site(site_id: impl Into<String>) -> Self {
        Self::Site {
            site_id: site_id.into(),
        }
    }

    /// The stored form, and half of the key an attention item is upserted on.
    ///
    /// A site id rather than `SITE:<id>` because the column it lands in is also
    /// the one a store feed filters by, and two spellings of one location is
    /// how a feed quietly starts missing rows.
    pub fn as_key(&self) -> &str {
        match self {
            Self::Group => "GROUP",
            Self::Site { site_id } => site_id.as_str(),
        }
    }

    pub fn site_id(&self) -> Option<&str> {
        match self {
            Self::Group => None,
            Self::Site { site_id } => Some(site_id.as_str()),
        }
    }
}

/// Who is being told.
///
/// A store can act on its own shifts, its own remittances, its own expenses and
/// its own counts, and on nothing else. Sending a store the group's supplier
/// ledger would be sending it work it is not allowed to do, which is how a feed
/// becomes something people stop reading.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum Audience {
    /// Head office only.
    Ho,
    /// The shop only.
    Store,
    /// Both, because both can act on it.
    Both,
}

impl Audience {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ho => "HO",
            Self::Store => "STORE",
            Self::Both => "BOTH",
        }
    }

    pub const fn reaches_store(self) -> bool {
        matches!(self, Self::Store | Self::Both)
    }

    pub const fn reaches_head_office(self) -> bool {
        matches!(self, Self::Ho | Self::Both)
    }
}

/// One row behind the two headline figures.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DetailRow {
    /// A site, an account, a document number — whatever the check was summing.
    pub label: String,
    pub expected_minor: i64,
    pub actual_minor: i64,
    pub difference_minor: i64,
}

impl DetailRow {
    pub fn new(label: impl Into<String>, expected_minor: i64, actual_minor: i64) -> Self {
        Self {
            label: label.into(),
            expected_minor,
            actual_minor,
            difference_minor: expected_minor - actual_minor,
        }
    }
}

/// What the check found, in words and in rows.
///
/// The summary is written where the facts are rather than assembled by a screen
/// from a key and two numbers, for the same reason a notification's body is:
/// what somebody was told in March should still read the same in October, after
/// the screen has been redesigned twice.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Details {
    pub summary: String,
    pub rows: Vec<DetailRow>,
}

impl Details {
    pub fn say(summary: impl Into<String>) -> Self {
        Self {
            summary: summary.into(),
            rows: Vec::new(),
        }
    }

    pub fn with_rows(mut self, rows: Vec<DetailRow>) -> Self {
        self.rows = rows;
        self
    }
}

/// One control equation's answer.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CheckResult {
    pub key: String,
    /// Which books this answer is about. Carried on the result and not only on
    /// the check that produced it, because a check may answer once per shop
    /// from one registration — and because the result is what gets stored, and
    /// a stored answer that could not say which location it was about would be
    /// a row nobody could act on.
    pub scope: Scope,
    pub state: CheckState,
    /// What the business records say the figure should be.
    pub expected_minor: i64,
    /// What the ledger actually holds.
    pub actual_minor: i64,
    /// Expected minus actual. Signed and not flipped for liabilities: which
    /// way a difference points is information, and a report decides how to
    /// present it.
    pub difference_minor: i64,
    pub details: Details,
    pub suggested_actions: Vec<SuggestedAction>,
}

impl CheckResult {
    /// The two sides, classified against a tolerance.
    ///
    /// Group scope, which is what most equations are. A check answering per
    /// location follows this with [`CheckResult::at`].
    pub fn compared(
        key: &str,
        expected_minor: i64,
        actual_minor: i64,
        age_days: Option<i64>,
        tolerance: Tolerance,
        details: Details,
    ) -> Self {
        Self {
            key: key.to_string(),
            scope: Scope::Group,
            state: classify(expected_minor, actual_minor, age_days, tolerance),
            expected_minor,
            actual_minor,
            difference_minor: expected_minor - actual_minor,
            details,
            suggested_actions: Vec::new(),
        }
    }

    /// An answer that is not a comparison: a placeholder, a refusal, a state
    /// the caller worked out for itself.
    pub fn stated(key: &str, state: CheckState, details: Details) -> Self {
        Self {
            key: key.to_string(),
            scope: Scope::Group,
            state,
            expected_minor: 0,
            actual_minor: 0,
            difference_minor: 0,
            details,
            suggested_actions: Vec::new(),
        }
    }

    /// An equation whose other half has not been built yet.
    ///
    /// Pending rather than Balanced, always. The reason must name the table the
    /// equation will read, so the gap is legible on the screen rather than only
    /// in this source file — a run of ten Pendings that each say what they are
    /// waiting for is a roadmap, and one that says "not implemented" ten times
    /// is a shrug.
    pub fn awaiting(key: &str, reason: impl Into<String>) -> Self {
        Self::stated(key, CheckState::Pending, Details::say(reason))
    }

    /// An equation that could not be computed, because something it needs is
    /// absent. Never silently green.
    pub fn blocked(key: &str, reason: impl Into<String>) -> Self {
        Self::stated(key, CheckState::Blocked, Details::say(reason))
    }

    pub fn with_actions(mut self, actions: Vec<SuggestedAction>) -> Self {
        self.suggested_actions = actions;
        self
    }

    /// Say which books this answer is about.
    pub fn at(mut self, scope: Scope) -> Self {
        self.scope = scope;
        self
    }

    /// Force a state the caller reasoned about itself, keeping the figures.
    ///
    /// Used where the comparison alone is not the whole answer — a bank account
    /// whose difference is exactly the lines still in transit is reconciled,
    /// and no tolerance can know that.
    pub fn in_state(mut self, state: CheckState) -> Self {
        self.state = state;
        self
    }
}

/// How much difference is nothing, and how long money may be in flight.
///
/// Named rather than written into each check, so a disagreement about what
/// counts as reconciled is a disagreement about these numbers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Tolerance {
    /// A difference of this size or smaller is agreement. Zero for anything
    /// derived from the same currency figures on both sides — rupiah do not
    /// round — and non-zero only where two systems genuinely round apart.
    pub absolute_minor: i64,
    /// How many whole days a difference may be explained by timing before it
    /// becomes somebody's problem. Card settlement is T+2 here, which is what
    /// the acquirers actually pay on.
    pub settles_within_days: i64,
}

impl Tolerance {
    /// Two sides that are drawn from the same figures and must agree exactly,
    /// today, with no settlement window at all.
    pub const EXACT: Self = Self {
        absolute_minor: 0,
        settles_within_days: 0,
    };

    /// What an acquirer owes us between the sale and the payout.
    pub const CARD_SETTLEMENT: Self = Self {
        absolute_minor: 0,
        settles_within_days: 2,
    };

    /// A bank transfer, which clears the next working day and sometimes the one
    /// after. The same three days `bank_match::Ruleset` scores dates over, on
    /// purpose: a line the matcher would still consider a candidate is a line
    /// this engine should still be calling timing.
    pub const BANK_CLEARING: Self = Self {
        absolute_minor: 0,
        settles_within_days: 3,
    };

    /// A document keyed in and not yet posted. A week is a long time for a bill
    /// to sit in DRAFT and a normal time for one to sit there over a holiday.
    pub const DOCUMENT_BACKLOG: Self = Self {
        absolute_minor: 0,
        settles_within_days: 7,
    };

    pub const fn within_days(days: i64) -> Self {
        Self {
            absolute_minor: 0,
            settles_within_days: days,
        }
    }
}

/// Read a difference together with its age.
///
/// The order matters and is the whole rule. Size first: inside tolerance is
/// agreement whatever the age, because an explanation is not needed for a
/// difference that is not there. Then age: a real difference younger than the
/// settlement window is timing, and the same difference a day later is not.
///
/// `age_days` is `None` when the difference has no single age — a control
/// account against the ledger behind it is a standing total, not an item in
/// flight — and
/// then there is nothing timing could explain, so it is an exception at once.
pub fn classify(
    expected_minor: i64,
    actual_minor: i64,
    age_days: Option<i64>,
    tolerance: Tolerance,
) -> CheckState {
    let difference = (expected_minor - actual_minor).abs();
    if difference <= tolerance.absolute_minor {
        return CheckState::Balanced;
    }
    match age_days {
        Some(days) if days <= tolerance.settles_within_days => CheckState::Pending,
        _ => CheckState::Exception,
    }
}

/// The same reading, for the two equations nothing else may be built on.
///
/// Equation one is the General Ledger balancing; equation two is the Payment
/// Ledger tying to the control accounts in it. Both are foundations rather than
/// findings, and the difference is what a person should do next. An Exception
/// is work: go and match the line, chase the acquirer, write the missing
/// document. A failed foundation is not work, it is a warning that the rest of
/// tonight's answers are arithmetic over a ledger already known to be wrong —
/// and somebody who cleared the other nine equations on such a night would have
/// spent a day proving nothing.
///
/// Timing still applies. A foundation difference inside its window is
/// [`CheckState::Pending`], for the same reason as anywhere else: a posting
/// that lands tomorrow is not a broken ledger today.
pub fn classify_foundation(
    expected_minor: i64,
    actual_minor: i64,
    age_days: Option<i64>,
    tolerance: Tolerance,
) -> CheckState {
    match classify(expected_minor, actual_minor, age_days, tolerance) {
        CheckState::Exception => CheckState::Blocked,
        other => other,
    }
}

/// One item that is in flight, read by its age alone.
///
/// An unmatched statement line, a settlement nobody has been paid for, a
/// document nobody has posted: these have no two sides to subtract, only an age
/// and a window they were supposed to clear inside.
pub fn classify_in_flight(age_days: i64, tolerance: Tolerance) -> CheckState {
    if age_days <= tolerance.settles_within_days {
        CheckState::Pending
    } else {
        CheckState::Exception
    }
}

/// The worst of many items in flight, and `Balanced` when there are none.
///
/// The shape most checks want: fifty unmatched lines, three of them old. The
/// answer is Exception, and the three are what the actions point at.
pub fn classify_oldest(ages_days: &[i64], tolerance: Tolerance) -> CheckState {
    CheckState::worst(
        ages_days
            .iter()
            .map(|age| classify_in_flight(*age, tolerance)),
    )
}

/// Money in the smallest unit, written the way the client writes it.
///
/// Here rather than in each caller because every summary sentence in this
/// engine quotes at least one figure, and a thousands separator that appears in
/// half of them is worse than none.
pub fn minor(amount: i64) -> String {
    let negative = amount < 0;
    let digits = amount.unsigned_abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if negative {
        grouped.push('-');
    }
    let lead = digits.len() % 3;
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && index % 3 == lead {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    grouped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agreement_inside_tolerance_needs_no_explanation() {
        // Zero difference, no age at all: nothing to explain.
        assert_eq!(
            classify(1_000, 1_000, None, Tolerance::EXACT),
            CheckState::Balanced
        );
        // Inside a non-zero tolerance, and old. Size wins over age, because an
        // explanation for a difference that is not there is not needed.
        let loose = Tolerance {
            absolute_minor: 100,
            settles_within_days: 0,
        };
        assert_eq!(
            classify(1_000, 1_050, Some(400), loose),
            CheckState::Balanced
        );
    }

    #[test]
    fn a_card_settlement_is_timing_until_it_is_two_days_old() {
        // The rule this engine exists to encode: the same difference reads two
        // ways depending only on how long it has been there.
        for young in [0, 1, 2] {
            assert_eq!(
                classify(500_000, 0, Some(young), Tolerance::CARD_SETTLEMENT),
                CheckState::Pending,
                "{young} days is inside T+2"
            );
        }
        assert_eq!(
            classify(500_000, 0, Some(3), Tolerance::CARD_SETTLEMENT),
            CheckState::Exception
        );
    }

    #[test]
    fn a_difference_with_no_age_is_an_exception_at_once() {
        // A ledger against its control account is a standing total. There is
        // no "it will clear tomorrow" available to it, so a generous settlement
        // window must not quietly buy it one.
        assert_eq!(
            classify(8_600_000, 5_600_000, None, Tolerance::CARD_SETTLEMENT),
            CheckState::Exception
        );
    }

    #[test]
    fn the_worst_state_wins_and_an_empty_run_is_balanced() {
        assert_eq!(CheckState::worst([]), CheckState::Balanced);
        assert_eq!(
            CheckState::worst([CheckState::Balanced, CheckState::Pending]),
            CheckState::Pending
        );
        assert_eq!(
            CheckState::worst([CheckState::Exception, CheckState::Blocked]),
            CheckState::Blocked
        );
        // And the ladder is the one the feed depends on.
        assert!(CheckState::Blocked > CheckState::Exception);
        assert!(CheckState::Exception > CheckState::Pending);
        assert!(CheckState::Pending > CheckState::Balanced);
    }

    #[test]
    fn only_exceptions_and_blocked_checks_reach_a_person() {
        assert!(!CheckState::Balanced.is_open());
        assert!(!CheckState::Pending.is_open());
        assert!(CheckState::Exception.is_open());
        assert!(CheckState::Blocked.is_open());
    }

    #[test]
    fn the_oldest_item_decides_a_batch() {
        assert_eq!(
            classify_oldest(&[], Tolerance::BANK_CLEARING),
            CheckState::Balanced
        );
        assert_eq!(
            classify_oldest(&[0, 1, 2], Tolerance::BANK_CLEARING),
            CheckState::Pending
        );
        // Forty-nine fresh lines and one stale one is an exception, and the
        // opposite reading is how a real problem hides inside a busy month.
        assert_eq!(
            classify_oldest(&[0, 1, 2, 30], Tolerance::BANK_CLEARING),
            CheckState::Exception
        );
    }

    #[test]
    fn a_foundation_that_fails_stops_the_night_rather_than_joining_the_queue() {
        // The same two figures the payables test uses. As an ordinary equation
        // it is somebody's morning; as a foundation it is a reason not to
        // trust anything else the run said.
        assert_eq!(
            classify(8_600_000, 5_600_000, None, Tolerance::EXACT),
            CheckState::Exception
        );
        assert_eq!(
            classify_foundation(8_600_000, 5_600_000, None, Tolerance::EXACT),
            CheckState::Blocked
        );
        // Agreement is agreement either way, and timing is still timing: a
        // foundation does not become stricter about money legitimately in
        // flight, only about what a failure means.
        assert_eq!(
            classify_foundation(1_000, 1_000, None, Tolerance::EXACT),
            CheckState::Balanced
        );
        assert_eq!(
            classify_foundation(500_000, 0, Some(1), Tolerance::CARD_SETTLEMENT),
            CheckState::Pending
        );
    }

    #[test]
    fn a_placeholder_is_pending_and_never_balanced() {
        let result = CheckResult::awaiting("inventory.valuation_vs_gl", "no valuation yet");
        assert_eq!(result.state, CheckState::Pending);
        assert!(!result.state.is_open());
        // A blocked check is open, because somebody has to go and map an
        // account before it can ever answer.
        assert!(CheckResult::blocked("k", "unmapped").state.is_open());
    }

    #[test]
    fn a_store_never_sees_head_office_work() {
        assert!(!Audience::Ho.reaches_store());
        assert!(Audience::Store.reaches_store());
        assert!(Audience::Both.reaches_store());
        assert!(!Audience::Store.reaches_head_office());
    }

    #[test]
    fn a_scope_spells_a_location_exactly_once() {
        assert_eq!(Scope::Group.as_key(), "GROUP");
        assert_eq!(Scope::site("store-01").as_key(), "store-01");
        assert_eq!(Scope::Group.site_id(), None);
        assert_eq!(Scope::site("store-02").site_id(), Some("store-02"));
        // A result is group-wide until it says otherwise, and saying otherwise
        // does not disturb the figures.
        let answer = CheckResult::awaiting("k", "waiting on store_fund_transfer");
        assert_eq!(answer.scope, Scope::Group);
        let located = answer.at(Scope::site("store-01"));
        assert_eq!(located.scope.as_key(), "store-01");
        assert_eq!(located.state, CheckState::Pending);
    }

    #[test]
    fn a_difference_is_expected_minus_actual_and_keeps_its_sign() {
        let result = CheckResult::compared(
            "k",
            8_600_000,
            5_600_000,
            None,
            Tolerance::EXACT,
            Details::say("bills against the payable account"),
        );
        assert_eq!(result.difference_minor, 3_000_000);
        let other = CheckResult::compared(
            "k",
            5_600_000,
            8_600_000,
            None,
            Tolerance::EXACT,
            Details::say("the other way"),
        );
        assert_eq!(other.difference_minor, -3_000_000);
    }

    #[test]
    fn money_reads_the_way_the_client_writes_it() {
        assert_eq!(minor(0), "0");
        assert_eq!(minor(999), "999");
        assert_eq!(minor(1_000), "1.000");
        assert_eq!(minor(8_600_000), "8.600.000");
        assert_eq!(minor(-4_150_000), "-4.150.000");
    }
}
