//! A shop asks for a new employee; head office answers.
//!
//! ```text
//!                 ┌──────────┐
//!        propose  │ Proposed │◀────────┐
//!        ────────▶└────┬─────┘         │ revise (a NEW version;
//!                      │               │  the old one stays readable)
//!        ┌─────────────┼───────────┐   │
//!     approve       return      reject │
//!        │             │           │   │
//!        ▼             ▼           │   │
//!  ┌──────────┐  ┌──────────┐      │   │
//!  │ Approved │  │ Returned │──────┼───┘
//!  └────┬─────┘  └──────────┘      │
//!       │ open an employment record, once per person asked for
//!       ▼                          ▼
//!  ┌──────────┐              ┌──────────┐
//!  │  Filled  │              │ Rejected │   both terminal
//!  └──────────┘              └──────────┘
//! ```
//!
//! # The state is a fold, and the versions are the record
//!
//! [`HireProposal::try_new`] replays every recorded step and refuses a stored
//! row whose claimed state the history does not produce — the guarantee
//! `domain::employment::Employee` gives for employment status, applied to the
//! same shape of problem. `hire_proposal.state` exists so "what is waiting on
//! head office" is an index scan rather than a fold over every proposal ever
//! filed, and it is safe only because nothing may write it except this fold.
//!
//! A revision does not edit anything. It appends a **new version** of the terms
//! and leaves every earlier one in place, because what was asked for and
//! refused is the point of asking again: a proposal returned because the base
//! pay was too high, revised, and then approved is a three-step record of a
//! negotiation, and an in-place edit would leave only its last line.
//!
//! # Why a version carries no authority of its own
//!
//! Who filed version 2, when, and why is the `REVISED` event that minted it.
//! The alternative — an `authorized` column on the version *beside* the event
//! in the history — stores one decision twice, and two copies of a decision is
//! how a screen comes to show a reason that disagrees with the log.
//!
//! # What this module deliberately does not hold
//!
//! **A recruitment pipeline.** There are no applicants, no interview stages, no
//! CV store and no shortlist. The owner rejected a hiring menu on 2026-09-04
//! and approved this one narrow form on 2026-09-13; what happened before a name
//! reached this proposal is not recorded anywhere, on purpose.
//!
//! **Personal data.** The candidate's name is here because head office cannot
//! decide about a person nobody has named. Their NIK, address, date of birth
//! and contact details are **not**, and there is no column for one: this is a
//! person who may never be employed here, and under UU PDP their identity
//! documents have no business sitting on a form that may be refused. Personal
//! data starts existing when somebody is actually hired, through the
//! `/employees/{id}/personal-data` surface that already owns it.

use super::error::HireError;
use crate::cloud::domain::employment::{
    ActorId, Authorization, ContractKind, EmployeeId, PlaceId, Position,
};
use chrono::NaiveDate;
use pricing_engine::Money;
use serde::{Deserialize, Serialize};

pub const MAX_PROPOSAL_ID_LEN: usize = 64;

/// The same ceiling `employee_profile.full_name` is validated against, because
/// it is the same kind of value written by the same people — and a name that
/// fitted the proposal and not the employment record would be a proposal
/// nobody could act on.
pub const MAX_CANDIDATE_NAME_LEN: usize = 140;

/// Trim, reject empty, reject control characters, bound the length.
///
/// The employment kernel has a function of this name and does not export it;
/// four lines here is cheaper than widening that module's surface, and it is
/// what `leave` and `pay` each did for the same reason.
fn validated_text(field: &'static str, raw: &str, max: usize) -> Result<String, HireError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(HireError::Required { field });
    }
    if trimmed.chars().count() > max {
        return Err(HireError::TooLong { field, max });
    }
    if trimmed.chars().any(char::is_control) {
        return Err(HireError::NotPrintable { field });
    }
    Ok(trimmed.to_owned())
}

/// One proposal, by its id.
///
/// Opaque, and minted by the server. An id a client chooses is an id a client
/// can be made to collide with somebody else's — the same reason
/// `http::employment::register` mints an employee id rather than accepting one.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct HireProposalId(String);

impl HireProposalId {
    pub fn try_new(raw: &str) -> Result<Self, HireError> {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.chars().any(char::is_control)
            || trimmed.chars().count() > MAX_PROPOSAL_ID_LEN
        {
            return Err(HireError::InvalidId {
                field: "hire_proposal_id",
            });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for HireProposalId {
    type Error = HireError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<HireProposalId> for String {
    fn from(value: HireProposalId) -> Self {
        value.0
    }
}

impl std::fmt::Display for HireProposalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The one personal datum a proposal holds.
///
/// Its own type rather than the employment kernel's `FullName`, and the
/// separation is the point: that type belongs to `employee_profile`, which sits
/// beside a NIK, a birth date and a home address. A proposal is about somebody
/// who may never be employed here, so the type it uses for a name must not be
/// the one whose table carries identity documents — otherwise the next person
/// to add "just one more field here" is adding it next to the wrong things.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CandidateName(String);

impl CandidateName {
    pub fn try_new(raw: &str) -> Result<Self, HireError> {
        validated_text("candidate_name", raw, MAX_CANDIDATE_NAME_LEN).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for CandidateName {
    type Error = HireError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<CandidateName> for String {
    fn from(value: CandidateName) -> Self {
        value.0
    }
}

impl std::fmt::Display for CandidateName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Whether the shop is replacing somebody or growing.
///
/// Recorded because it is the first thing head office asks, and the two answers
/// mean different things to them: a replacement keeps a place's headcount and
/// its wage bill where the budget already put them, while an addition changes
/// both and is a decision about the shop rather than about the person.
///
/// It deliberately does **not** name who is being replaced. Nobody asked for
/// that field, and a leaver's name on a stranger's proposal would be a second
/// place somebody's departure is recorded — the employment record already holds
/// it, with its date and its authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HiringNeed {
    Replacement,
    Addition,
}

impl HiringNeed {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Replacement => "REPLACEMENT",
            Self::Addition => "ADDITION",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "REPLACEMENT" => Some(Self::Replacement),
            "ADDITION" => Some(Self::Addition),
            _ => None,
        }
    }
}

impl std::fmt::Display for HiringNeed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

/// What is being asked for: the content of one version of a proposal.
///
/// Every field is the owner's, from the decision of 2026-09-13, and there are
/// no others. The unit is absent here because it belongs to the proposal rather
/// than to a version — a revision may change the pay or the start date, and a
/// proposal that changed which shop it was for would be a different proposal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "ProposedTermsWire")]
pub struct ProposedTerms {
    position: Position,
    headcount: u32,
    need: HiringNeed,
    candidate: CandidateName,
    start_on: NaiveDate,
    /// The **proposed** kind, and the employment kernel's own type.
    ///
    /// Reusing [`ContractKind`] rather than a string is what makes a proposed
    /// PKWT with no end date unrepresentable here as well as on the contract
    /// itself: the end date lives inside the fixed-term variant and there is
    /// nowhere to put one in the permanent variant. A proposal approved in the
    /// wrong shape is a contract nobody can sign.
    contract: ContractKind,
    /// Base pay only — *gaji pokok*, in the smallest unit. Allowances are not
    /// here: they are a standing agreement with its own effective dates (see
    /// `domain::pay`), and a proposal is not an agreement.
    base_pay: Money,
}

/// The stored shape, so a version re-runs its own constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposedTermsWire {
    pub position: Position,
    pub headcount: u32,
    pub need: HiringNeed,
    pub candidate: CandidateName,
    pub start_on: NaiveDate,
    pub contract: ContractKind,
    pub base_pay: Money,
}

impl TryFrom<ProposedTermsWire> for ProposedTerms {
    type Error = HireError;
    fn try_from(wire: ProposedTermsWire) -> Result<Self, Self::Error> {
        Self::try_new(
            wire.position,
            wire.headcount,
            wire.need,
            wire.candidate,
            wire.start_on,
            wire.contract,
            wire.base_pay,
        )
    }
}

impl ProposedTerms {
    /// Validate the terms as a whole.
    ///
    /// The one cross-field rule is the fixed term's: UU 13/2003 art. 59 wants a
    /// PKWT to say when it ends, and a term ending before it starts is a typo
    /// that would survive approval and be found only when HR tried to sign it.
    pub fn try_new(
        position: Position,
        headcount: u32,
        need: HiringNeed,
        candidate: CandidateName,
        start_on: NaiveDate,
        contract: ContractKind,
        base_pay: Money,
    ) -> Result<Self, HireError> {
        if headcount == 0 {
            return Err(HireError::HeadcountNotPositive);
        }
        if i32::try_from(headcount).is_err() {
            return Err(HireError::HeadcountNotStorable { asked: headcount });
        }
        if base_pay.minor <= 0 {
            return Err(HireError::BasePayNotPositive);
        }
        if let Some(ends_on) = contract.ends_on() {
            if ends_on < start_on {
                return Err(HireError::TermEndsBeforeItStarts {
                    starts_on: start_on,
                    ends_on,
                });
            }
        }
        Ok(Self {
            position,
            headcount,
            need,
            candidate,
            start_on,
            contract,
            base_pay,
        })
    }

    pub fn position(&self) -> &Position {
        &self.position
    }
    pub const fn headcount(&self) -> u32 {
        self.headcount
    }
    pub const fn need(&self) -> HiringNeed {
        self.need
    }
    pub fn candidate(&self) -> &CandidateName {
        &self.candidate
    }
    pub const fn start_on(&self) -> NaiveDate {
        self.start_on
    }
    pub const fn contract(&self) -> ContractKind {
        self.contract
    }
    pub const fn base_pay(&self) -> Money {
        self.base_pay
    }
}

/// Where a proposal stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HireProposalState {
    /// Filed, and waiting on head office.
    Proposed,
    /// Sent back for revision. Not a refusal: the shop may file a new version,
    /// and the returned one stays readable beside it.
    Returned,
    /// Head office accepted it. **This is not an employee.** What approval buys
    /// is permission to open an employment record — the owner's words,
    /// 2026-09-13: "Approved" is not "working here".
    Approved,
    /// Refused. Terminal, and deliberately so: a refusal a sufficiently senior
    /// person can reverse is not a refusal, and asking again is a new proposal
    /// with its own reasons.
    Rejected,
    /// As many employment records have been opened against it as it asked for.
    /// Terminal.
    Filled,
}

impl HireProposalState {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Proposed => "PROPOSED",
            Self::Returned => "RETURNED",
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
            Self::Filled => "FILLED",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "PROPOSED" => Some(Self::Proposed),
            "RETURNED" => Some(Self::Returned),
            "APPROVED" => Some(Self::Approved),
            "REJECTED" => Some(Self::Rejected),
            "FILLED" => Some(Self::Filled),
            _ => None,
        }
    }

    /// Is head office's answer still outstanding? The queue query.
    pub const fn awaits_a_decision(self) -> bool {
        matches!(self, Self::Proposed)
    }

    /// May an employment record still be opened against this proposal?
    pub const fn admits_employment(self) -> bool {
        matches!(self, Self::Approved)
    }

    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Rejected | Self::Filled)
    }
}

impl std::fmt::Display for HireProposalState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

/// One recorded step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HireProposalStep {
    Proposed,
    Revised,
    Returned,
    Approved,
    Rejected,
    /// An employment record was opened against an approved proposal. One step
    /// per person, so a proposal for two carries two.
    Opened,
}

impl HireProposalStep {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Proposed => "PROPOSED",
            Self::Revised => "REVISED",
            Self::Returned => "RETURNED",
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
            Self::Opened => "OPENED",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "PROPOSED" => Some(Self::Proposed),
            "REVISED" => Some(Self::Revised),
            "RETURNED" => Some(Self::Returned),
            "APPROVED" => Some(Self::Approved),
            "REJECTED" => Some(Self::Rejected),
            "OPENED" => Some(Self::Opened),
            _ => None,
        }
    }

    /// The word a refusal uses, so "a proposal that is REJECTED cannot be
    /// approved" reads as a sentence.
    const fn verb(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Revised => "revised",
            Self::Returned => "returned",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::Opened => "opened against",
        }
    }

    /// Does this authority cover this step?
    ///
    /// Three disjoint answers, and the disjointness is what the rest of the
    /// module rests on: a decision recorded under the proposing key would be
    /// the shop approving its own request. The check runs on the live path
    /// *and* on the way in from storage — a rule only the live path enforces is
    /// a rule a round trip through the database removes.
    fn authorized_by(self, authorization: &Authorization) -> bool {
        match self {
            Self::Proposed | Self::Revised => authorization.authorizes_hire_proposal(),
            Self::Returned | Self::Approved | Self::Rejected => {
                authorization.authorizes_hire_decision()
            }
            Self::Opened => authorization.authorizes_hire_employment(),
        }
    }

    /// The refusal for an authority that does not cover this step.
    fn forbidden(self, authorization: &Authorization) -> HireError {
        let action_key = authorization.action_key().to_owned();
        match self {
            Self::Proposed | Self::Revised => HireError::ActionForbidsProposal { action_key },
            Self::Returned | Self::Approved | Self::Rejected => {
                HireError::ActionForbidsDecision { action_key }
            }
            Self::Opened => HireError::ActionForbidsEmployment { action_key },
        }
    }
}

impl std::fmt::Display for HireProposalStep {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

/// Head office's answer. Exactly three values, and every one of them needs a
/// reason — which is why they are one enum on one route rather than three
/// routes that each have to remember to ask for one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HireDecision {
    Approve,
    /// Send it back for revision. The shop may file a new version; the returned
    /// one stays readable.
    Return,
    Reject,
}

impl HireDecision {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Approve => "APPROVE",
            Self::Return => "RETURN",
            Self::Reject => "REJECT",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "APPROVE" => Some(Self::Approve),
            "RETURN" => Some(Self::Return),
            "REJECT" => Some(Self::Reject),
            _ => None,
        }
    }

    const fn step(self) -> HireProposalStep {
        match self {
            Self::Approve => HireProposalStep::Approved,
            Self::Return => HireProposalStep::Returned,
            Self::Reject => HireProposalStep::Rejected,
        }
    }

    const fn outcome(self) -> HireProposalState {
        match self {
            Self::Approve => HireProposalState::Approved,
            Self::Return => HireProposalState::Returned,
            Self::Reject => HireProposalState::Rejected,
        }
    }
}

/// One step, with the authority behind it and the version it is about.
///
/// The version travels on every event so that a returned version and the reason
/// it was returned stay joined after a revision has moved on: without it, "why
/// was this sent back" would be answerable only about the latest terms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "HireProposalEventWire")]
pub struct HireProposalEvent {
    step: HireProposalStep,
    version: u32,
    /// The employment record an `OPENED` step produced, and nothing else's.
    employee: Option<EmployeeId>,
    authorization: Authorization,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HireProposalEventWire {
    pub step: HireProposalStep,
    pub version: u32,
    #[serde(default)]
    pub employee: Option<EmployeeId>,
    pub authorization: Authorization,
}

impl TryFrom<HireProposalEventWire> for HireProposalEvent {
    type Error = HireError;
    fn try_from(wire: HireProposalEventWire) -> Result<Self, Self::Error> {
        Self::try_new(wire.step, wire.version, wire.employee, wire.authorization)
    }
}

impl HireProposalEvent {
    /// Rebuild one step, checking its authority and its shape.
    ///
    /// The shape rule is the pairing: an `OPENED` step names the employment
    /// record it produced, and no other step names one. A `REJECTED` step
    /// carrying an employee id would be a refusal that somehow hired somebody,
    /// and an `OPENED` step carrying none would be a record nobody could find.
    pub fn try_new(
        step: HireProposalStep,
        version: u32,
        employee: Option<EmployeeId>,
        authorization: Authorization,
    ) -> Result<Self, HireError> {
        if !step.authorized_by(&authorization) {
            return Err(step.forbidden(&authorization));
        }
        if version == 0 {
            return Err(HireError::VersionNotNext {
                expected: 1,
                found: 0,
            });
        }
        let should_name = matches!(step, HireProposalStep::Opened);
        if employee.is_some() != should_name {
            return Err(HireError::EmploymentNamedWrongly {
                step: step.code(),
                expectation: if should_name { "" } else { "not" },
            });
        }
        Ok(Self {
            step,
            version,
            employee,
            authorization,
        })
    }

    pub const fn step(&self) -> HireProposalStep {
        self.step
    }
    pub const fn version(&self) -> u32 {
        self.version
    }
    pub fn employee(&self) -> Option<&EmployeeId> {
        self.employee.as_ref()
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The stored shape, so a proposal re-runs its own machine.
///
/// `versions` is a flat list, oldest first, because that is how the rows come
/// back; [`HireProposal::try_new`] splits off the first so that the loaded
/// proposal cannot be empty.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HireProposalWire {
    pub id: HireProposalId,
    pub place: PlaceId,
    pub state: HireProposalState,
    pub versions: Vec<ProposedTerms>,
    #[serde(default)]
    pub history: Vec<HireProposalEvent>,
}

/// One proposal: one unit, one candidate, every version of the terms, and the
/// chain of decisions taken about them.
///
/// The original terms sit outside the revision list rather than at index zero
/// of one list, and that is not tidiness: it is what makes [`Self::current`]
/// and [`Self::proposer`] total functions. A `Vec` that the constructors merely
/// *promise* is non-empty needs an `unwrap` in every getter, which is a panic
/// sitting in the type for the sake of a shape the type could have refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HireProposal {
    id: HireProposalId,
    place: PlaceId,
    state: HireProposalState,
    /// Who filed the version in force — the actor a decision may not be.
    ///
    /// Folded from `history` exactly as `state` is, and never stored: there is
    /// no column for it, so there is nothing for a hand edit to disagree with.
    proposer: ActorId,
    original: ProposedTerms,
    /// Versions 2..n, in order. Empty for a proposal nobody has revised.
    revisions: Vec<ProposedTerms>,
    /// Append-only. The authority for [`Self::state`].
    history: Vec<HireProposalEvent>,
}

impl HireProposal {
    /// File one.
    ///
    /// The unit is the caller's own posting, resolved before this is reached —
    /// see `http::hire`. Nothing in this type can check that, which is why the
    /// check is at the one layer that knows the caller's reach.
    pub fn propose(
        id: HireProposalId,
        place: PlaceId,
        terms: ProposedTerms,
        proposed: Authorization,
    ) -> Result<Self, HireError> {
        let event = HireProposalEvent::try_new(HireProposalStep::Proposed, 1, None, proposed)?;
        Ok(Self {
            id,
            place,
            state: HireProposalState::Proposed,
            proposer: event.authorization.actor().clone(),
            original: terms,
            revisions: Vec::new(),
            history: vec![event],
        })
    }

    /// Rebuild from storage, re-running the machine and every rule in it.
    ///
    /// Rejects: a step the machine forbids from the state the fold has reached,
    /// a first step that is not `PROPOSED`, a revision that does not follow the
    /// version before it, a decision about a version that is not the one in
    /// force, a decision by the actor who proposed it, an authority that does
    /// not cover its step, more employment records opened than the proposal
    /// asked for, a version count the history did not mint, and a claimed state
    /// the history does not produce.
    ///
    /// What decode *cannot* re-check is that the recorded actor genuinely held
    /// that action key at the time: a recorded authorization is history, not
    /// authority. That is true of every `Authorization` in this estate and is
    /// stated once, in `domain::employment::employee`.
    pub fn try_new(wire: HireProposalWire) -> Result<Self, HireError> {
        use HireProposalState as State;
        use HireProposalStep as Step;

        let mut folded: Option<State> = None;
        // The version head office is deciding, and the actor who filed it.
        let mut in_force: u32 = 0;
        let mut proposer: Option<ActorId> = None;
        // Everybody who has filed a version, not only the latest: the rule a
        // decision is checked against is [`Self::proposed_by`]'s, and a
        // colleague's revision must not launder the first proposer into being
        // allowed to decide.
        let mut proposers: Vec<&ActorId> = Vec::new();
        let mut opened: usize = 0;

        for event in &wire.history {
            // Belt to the constructor's braces: `HireProposalEvent::try_new`
            // checks the authority gate, and a `Vec<HireProposalEvent>` built
            // in Rust rather than decoded from JSON has not been through it.
            if !event.step.authorized_by(&event.authorization) {
                return Err(event.step.forbidden(&event.authorization));
            }
            match (folded, event.step) {
                (None, Step::Proposed) => {
                    if event.version != 1 {
                        return Err(HireError::VersionNotNext {
                            expected: 1,
                            found: event.version,
                        });
                    }
                    proposer = Some(event.authorization.actor().clone());
                    proposers.push(event.authorization.actor());
                    in_force = 1;
                    folded = Some(State::Proposed);
                }
                (Some(State::Returned), Step::Revised) => {
                    if event.version != in_force + 1 {
                        return Err(HireError::VersionNotNext {
                            expected: in_force + 1,
                            found: event.version,
                        });
                    }
                    proposer = Some(event.authorization.actor().clone());
                    proposers.push(event.authorization.actor());
                    in_force = event.version;
                    folded = Some(State::Proposed);
                }
                (Some(State::Proposed), Step::Returned | Step::Approved | Step::Rejected) => {
                    if event.version != in_force {
                        return Err(HireError::DecisionNamesAnotherVersion {
                            expected: in_force,
                            found: event.version,
                        });
                    }
                    // The owner's rule, re-checked here because a row edited
                    // into this shape must fail to load rather than become an
                    // approval the proposer granted themselves.
                    if proposers.contains(&event.authorization.actor()) {
                        return Err(HireError::ProposerDecidedTheirOwnProposal {
                            actor: event.authorization.actor().to_string(),
                        });
                    }
                    folded = Some(match event.step {
                        Step::Returned => State::Returned,
                        Step::Approved => State::Approved,
                        _ => State::Rejected,
                    });
                }
                (Some(State::Approved), Step::Opened) => {
                    if event.version != in_force {
                        return Err(HireError::DecisionNamesAnotherVersion {
                            expected: in_force,
                            found: event.version,
                        });
                    }
                    opened += 1;
                    let headcount = terms_at(&wire.versions, in_force)?.headcount();
                    folded = Some(if count(opened) >= headcount {
                        State::Filled
                    } else {
                        State::Approved
                    });
                }
                (state, step) => {
                    return Err(HireError::NotInState {
                        state: state.map_or("unfiled", State::code),
                        step: step.verb(),
                    });
                }
            }
        }

        // Both are `Some` together or `None` together — the only step that sets
        // either sets both — and destructuring them is what keeps every getter
        // below free of an `unwrap`.
        let (Some(folded), Some(proposer)) = (folded, proposer) else {
            return Err(HireError::NothingWasProposed);
        };
        // A version row no event minted, or an event minting a version no row
        // holds. Either is a hand edit, and there is no way to tell which — so
        // neither becomes the answer.
        if in_force as usize != wire.versions.len() {
            return Err(HireError::VersionCountDisagreesWithHistory {
                minted: in_force,
                stored: wire.versions.len(),
            });
        }
        let headcount = terms_at(&wire.versions, in_force)?.headcount();
        if count(opened) > headcount {
            return Err(HireError::MoreOpenedThanAskedFor { headcount, opened });
        }

        let mut versions = wire.versions;
        // Infallible after the length check above, and expressed as a `match`
        // rather than an index so that a future edit to that check cannot turn
        // this line into a panic.
        let Some(original) = versions.drain(..1).next() else {
            return Err(HireError::NothingWasProposed);
        };

        if folded != wire.state {
            return Err(HireError::StateDoesNotFollowHistory {
                claimed: wire.state.code(),
                folded: folded.code(),
            });
        }
        Ok(Self {
            id: wire.id,
            place: wire.place,
            state: wire.state,
            proposer,
            original,
            revisions: versions,
            history: wire.history,
        })
    }

    pub fn id(&self) -> &HireProposalId {
        &self.id
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub const fn state(&self) -> HireProposalState {
        self.state
    }
    pub fn history(&self) -> &[HireProposalEvent] {
        &self.history
    }

    /// Every version, oldest first. The returned ones are still here, which is
    /// the whole point of a revision being a version.
    pub fn versions(&self) -> impl Iterator<Item = &ProposedTerms> {
        std::iter::once(&self.original).chain(self.revisions.iter())
    }

    /// The terms in force: the latest revision, or the original if there has
    /// been none.
    pub fn current(&self) -> &ProposedTerms {
        self.revisions.last().unwrap_or(&self.original)
    }

    /// Which version that is. One-based, and the number a screen shows.
    pub fn current_version(&self) -> u32 {
        count(self.revisions.len() + 1)
    }

    /// The employment records opened against this proposal, in order.
    pub fn opened(&self) -> impl Iterator<Item = &EmployeeId> {
        self.history.iter().filter_map(HireProposalEvent::employee)
    }

    /// How many of the people asked for still have no employment record.
    pub fn outstanding(&self) -> u32 {
        self.current()
            .headcount()
            .saturating_sub(count(self.opened().count()))
    }

    /// Who filed the version in force. What a screen shows beside the terms.
    pub fn proposer(&self) -> &ActorId {
        &self.proposer
    }

    /// Has this actor filed *any* version of this proposal?
    ///
    /// The bound a decision is checked against, and it is deliberately wider
    /// than [`Self::proposer`]. A manager who filed version 1, had a colleague
    /// revise it, and then approved version 2 would have decided their own
    /// proposal with one extra step in between — and the owner's rule
    /// (2026-09-13) is about the proposal, not about one of its drafts.
    pub fn proposed_by(&self, actor: &ActorId) -> bool {
        self.history.iter().any(|event| {
            matches!(
                event.step,
                HireProposalStep::Proposed | HireProposalStep::Revised
            ) && event.authorization.actor() == actor
        })
    }

    fn require(&self, state: HireProposalState, step: HireProposalStep) -> Result<(), HireError> {
        if self.state == state {
            return Ok(());
        }
        Err(HireError::NotInState {
            state: self.state.code(),
            step: step.verb(),
        })
    }

    /// File a new version of a returned proposal.
    ///
    /// The earlier versions are untouched. Only a *returned* proposal may be
    /// revised: revising one still awaiting an answer would change the terms
    /// under the person reading them, and revising an approved one would change
    /// what was approved.
    pub fn revise(
        &mut self,
        terms: ProposedTerms,
        proposed: Authorization,
    ) -> Result<(), HireError> {
        self.require(HireProposalState::Returned, HireProposalStep::Revised)?;
        let version = self.current_version() + 1;
        let event = HireProposalEvent::try_new(HireProposalStep::Revised, version, None, proposed)?;
        // The reviser becomes the proposer of the version in force — which is
        // what a screen shows. Who may *decide* it is a wider question than
        // this field: see [`Self::proposed_by`].
        self.proposer = event.authorization.actor().clone();
        self.revisions.push(terms);
        self.history.push(event);
        self.state = HireProposalState::Proposed;
        Ok(())
    }

    /// Head office's answer: approve, return for revision, or reject.
    ///
    /// **Not the person who proposed it.** The refusal is a forbidden rather
    /// than a bad request: the payload is fine, and what is wrong is who is
    /// sending it. The comparison is on the *actor*, which is why the proposing
    /// and deciding keys are disjoint — a rung cannot tell one person from
    /// another, and head office's own HR may file a proposal too.
    pub fn decide(
        &mut self,
        decision: HireDecision,
        authorization: Authorization,
    ) -> Result<(), HireError> {
        let step = decision.step();
        self.require(HireProposalState::Proposed, step)?;
        if self.proposed_by(authorization.actor()) {
            return Err(HireError::ProposerDecidedTheirOwnProposal {
                actor: authorization.actor().to_string(),
            });
        }
        let event = HireProposalEvent::try_new(step, self.current_version(), None, authorization)?;
        self.history.push(event);
        self.state = decision.outcome();
        Ok(())
    }

    /// Record that an employment record has been opened against this proposal.
    ///
    /// The caller creates the employee through the employment kernel and hands
    /// the id here; nothing in this module writes an employee. What this
    /// guarantees is the arithmetic: a proposal for two cannot produce three
    /// employment records, on the live path and again on the way in from
    /// storage.
    ///
    /// Reaching [`HireProposalState::Filled`] closes the proposal. It does not
    /// make anybody an active employee — the person is a `CANDIDATE` in the
    /// employment kernel until somebody records the `HIRE` event on the day
    /// they actually start, which is `POST /employees/{id}/employment` and is
    /// not this module's to do.
    pub fn open_employment(
        &mut self,
        employee: EmployeeId,
        authorization: Authorization,
    ) -> Result<(), HireError> {
        self.require(HireProposalState::Approved, HireProposalStep::Opened)?;
        let event = HireProposalEvent::try_new(
            HireProposalStep::Opened,
            self.current_version(),
            Some(employee),
            authorization,
        )?;
        self.history.push(event);
        if self.outstanding() == 0 {
            self.state = HireProposalState::Filled;
        }
        Ok(())
    }
}

/// A count as a version/headcount number, saturating rather than wrapping.
fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// The terms of one version, by its one-based number.
fn terms_at(versions: &[ProposedTerms], version: u32) -> Result<&ProposedTerms, HireError> {
    let index = usize::try_from(version)
        .ok()
        .and_then(|version| version.checked_sub(1))
        .ok_or(HireError::VersionNotNext {
            expected: 1,
            found: version,
        })?;
    versions
        .get(index)
        .ok_or(HireError::VersionCountDisagreesWithHistory {
            minted: version,
            stored: versions.len(),
        })
}
