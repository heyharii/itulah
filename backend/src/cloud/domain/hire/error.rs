//! Every way the hire-proposal kernel can refuse.
//!
//! The two worth reading twice are
//! [`HireError::ProposerDecidedTheirOwnProposal`] — the rule the owner stated
//! on 2026-09-13, and the one a rung cannot express, because head office's own
//! HR holds the deciding key and may also file a proposal — and
//! [`HireError::StateDoesNotFollowHistory`], which is what makes the stored
//! state a fold rather than a column somebody can edit.

use chrono::NaiveDate;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum HireError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} must be at most {max} characters")]
    TooLong { field: &'static str, max: usize },
    #[error("{field} must be printable text without control characters")]
    NotPrintable { field: &'static str },
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },

    // ── the terms ────────────────────────────────────────────────────────
    /// A proposal for nobody. Zero is not "unspecified": a request to hire
    /// nought people has no outcome head office could approve.
    #[error("a proposal must ask for at least one person")]
    HeadcountNotPositive,
    /// A representation bound, deliberately not a hiring policy. Nothing here
    /// says how many people one proposal may reasonably ask for — that is head
    /// office's to judge when they read it, and a ceiling invented in Rust
    /// would be a number nobody ratified. What this refuses is a count the
    /// column cannot hold, which would otherwise be silently truncated on the
    /// way into the database.
    #[error("a headcount of {asked} does not fit the column that stores it")]
    HeadcountNotStorable { asked: u32 },
    /// Zero as well as negative, for the reason [`super::ProposedTerms`] gives:
    /// a proposal that offers nothing is not something anybody can agree to.
    #[error("the proposed base pay must be more than nothing")]
    BasePayNotPositive,
    /// UU 13/2003 art. 59, on the proposal as well as on the contract. The
    /// same rule `employee_contract` enforces, stated here because a proposed
    /// fixed term that ends before it starts would be approved and only then
    /// found unsignable.
    #[error("a fixed term starting {starts_on} cannot end on {ends_on}")]
    TermEndsBeforeItStarts {
        starts_on: NaiveDate,
        ends_on: NaiveDate,
    },

    // ── authority ────────────────────────────────────────────────────────
    #[error("action `{action_key}` does not authorize proposing a hire")]
    ActionForbidsProposal { action_key: String },
    #[error("action `{action_key}` does not authorize deciding a hire proposal")]
    ActionForbidsDecision { action_key: String },
    #[error("action `{action_key}` does not authorize opening an employment record")]
    ActionForbidsEmployment { action_key: String },
    /// The owner's rule, 2026-09-13. Head office is a place and not a pass
    /// (see `domain::employment::reach`), so the person who asked for the hire
    /// may not be the person who granted it — even when they hold the deciding
    /// rung.
    #[error("{actor} proposed this hire and may not also decide it")]
    ProposerDecidedTheirOwnProposal { actor: String },

    // ── the machine ──────────────────────────────────────────────────────
    #[error("a proposal that is {state} cannot be {step}")]
    NotInState {
        state: &'static str,
        step: &'static str,
    },
    #[error("recorded state {claimed} is not what the history produces ({folded})")]
    StateDoesNotFollowHistory {
        claimed: &'static str,
        folded: &'static str,
    },
    /// A stored proposal with no `PROPOSED` event. Nothing produces the first
    /// state, so there is no state to serve.
    #[error("a proposal with no recorded proposal event has no state")]
    NothingWasProposed,
    #[error("version {found} does not follow version {expected}")]
    VersionNotNext { expected: u32, found: u32 },
    /// A decision recorded against a version that is not the one in force.
    /// Returning version 1 after version 2 was filed would put the decision on
    /// the wrong terms, and the screen would show the wrong pay refused.
    #[error("the decision names version {found}, but version {expected} is the one in force")]
    DecisionNamesAnotherVersion { expected: u32, found: u32 },
    /// The history minted a number of versions the stored rows do not hold —
    /// or holds rows no event ever minted. Either way one of the two is a hand
    /// edit, and there is no way to tell which.
    #[error("the history mints {minted} versions and {stored} are stored")]
    VersionCountDisagreesWithHistory { minted: u32, stored: usize },
    /// An `OPENED` step names the employment record it produced, and no other
    /// step names one.
    ///
    /// The pairing has no `CHECK` constraint behind it, and cannot: the steps
    /// live in `hire_proposal.history` as JSON, exactly as `employee.history`
    /// does. So this is the only guard, which is why it runs on the way in from
    /// storage as well as on the live path — a `REJECTED` step carrying an
    /// employee id would be a refusal that somehow hired somebody, and an
    /// `OPENED` step carrying none would be a record nobody could find.
    #[error("an {step} step must {expectation} name an employment record")]
    EmploymentNamedWrongly {
        step: &'static str,
        expectation: &'static str,
    },
    /// Asking for two people and opening three records is the one arithmetic
    /// error an approval could be stretched by.
    ///
    /// The fold refuses it first — the step that fills the last position moves
    /// the state to `FILLED`, and an `OPENED` step has nothing to follow from
    /// there, so the refusal a caller actually sees is
    /// [`Self::NotInState`]. This is the same rule stated in its own words, as
    /// the arithmetic rather than as a consequence of the transition table,
    /// because the table is not where somebody looks for it.
    #[error("this proposal asked for {headcount} and {opened} employment records are open on it")]
    MoreOpenedThanAskedFor { headcount: u32, opened: usize },
}

impl HireError {
    /// A stable code for the wire, so a client can branch on the refusal
    /// without matching on a sentence somebody will improve next month.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Required { .. } => "hire_required",
            Self::TooLong { .. } => "hire_too_long",
            Self::NotPrintable { .. } => "hire_not_printable",
            Self::InvalidId { .. } => "hire_invalid_id",
            Self::HeadcountNotPositive => "hire_headcount_not_positive",
            Self::HeadcountNotStorable { .. } => "hire_headcount_not_storable",
            Self::BasePayNotPositive => "hire_base_pay_not_positive",
            Self::TermEndsBeforeItStarts { .. } => "hire_term_ends_before_it_starts",
            Self::ActionForbidsProposal { .. } => "hire_action_forbids_proposal",
            Self::ActionForbidsDecision { .. } => "hire_action_forbids_decision",
            Self::ActionForbidsEmployment { .. } => "hire_action_forbids_employment",
            Self::ProposerDecidedTheirOwnProposal { .. } => "hire_proposer_decided_their_own",
            Self::NotInState { .. } => "hire_not_in_state",
            Self::StateDoesNotFollowHistory { .. } => "hire_state_does_not_follow_history",
            Self::NothingWasProposed => "hire_nothing_was_proposed",
            Self::VersionNotNext { .. } => "hire_version_not_next",
            Self::DecisionNamesAnotherVersion { .. } => "hire_decision_names_another_version",
            Self::VersionCountDisagreesWithHistory { .. } => "hire_version_count_disagrees",
            Self::EmploymentNamedWrongly { .. } => "hire_employment_named_wrongly",
            Self::MoreOpenedThanAskedFor { .. } => "hire_more_opened_than_asked_for",
        }
    }

    /// Whether the *record* is in the wrong state rather than the request being
    /// malformed.
    ///
    /// The split is what the caller should do next, and it is the same one
    /// `OvertimeError` draws. A base pay of nought is a bad request: the number
    /// in the body is the thing to change. A proposal somebody else has already
    /// rejected is a conflict — nothing about the request needs fixing, and
    /// what has to change is the world.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::NotInState { .. } | Self::MoreOpenedThanAskedFor { .. }
        )
    }

    /// Whether the caller is reaching outside their grant.
    ///
    /// Deciding your own proposal is here rather than among the validation
    /// failures on purpose: nothing in the payload is wrong, and telling the
    /// proposer to correct their request would invite them to look for the
    /// field that makes it work.
    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsProposal { .. }
                | Self::ActionForbidsDecision { .. }
                | Self::ActionForbidsEmployment { .. }
                | Self::ProposerDecidedTheirOwnProposal { .. }
        )
    }
}
