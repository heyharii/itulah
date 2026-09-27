//! One claim: what was filed, what was sanctioned, and what was paid.
//!
//! The state machine is the write-once shape the table's CHECK constraints
//! state a second time: DRAFT → SUBMITTED → APPROVED | REJECTED, APPROVED →
//! PAID, and a filer's withdrawal from DRAFT or SUBMITTED. A RETURN sends a
//! submitted claim back to DRAFT with a reason — it rests nowhere, and the
//! history is its only record. Every method takes the [`Authorization`] of
//! the act and checks the key it was recorded under, so a claim cannot pass
//! through a state on an authority that could not have taken it there.
//!
//! [`ExpenseClaim::try_new`] is the fold: it re-runs every rule — the
//! pairings, the two-actor rule, the sanctioned totals against their lines —
//! on the way in from storage, so a row edited into a shape no sequence of
//! decisions could reach fails to load rather than becoming an approved claim.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use super::catalogue::ClaimTypeCode;
use super::error::ClaimError;
use crate::cloud::domain::employment::{Authorization, EmployeeId, PlaceId, ReasonText};

pub const MAX_CLAIM_ID_LEN: usize = 64;
pub const MAX_DESCRIPTION_LEN: usize = 280;

/// One claim, by its id — the uuid the handler mints, carried as text.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ClaimId(String);

impl ClaimId {
    pub fn try_new(raw: &str) -> Result<Self, ClaimError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_CLAIM_ID_LEN {
            return Err(ClaimError::InvalidId { field: "claim_id" });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ClaimId {
    type Error = ClaimError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<ClaimId> for String {
    fn from(value: ClaimId) -> Self {
        value.0
    }
}

impl std::fmt::Display for ClaimId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One line of a claim, by its id — the uuid the handler mints for it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ClaimLineId(String);

impl ClaimLineId {
    pub fn try_new(raw: &str) -> Result<Self, ClaimError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_CLAIM_ID_LEN {
            return Err(ClaimError::InvalidId { field: "line_id" });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ClaimLineId {
    type Error = ClaimError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<ClaimLineId> for String {
    fn from(value: ClaimLineId) -> Self {
        value.0
    }
}

impl std::fmt::Display for ClaimLineId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One line: one receipt's worth of asking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClaimLine {
    id: ClaimLineId,
    type_code: ClaimTypeCode,
    description: String,
    spent_on: NaiveDate,
    claimed_minor: i64,
    /// What the decider allowed, written when the claim is approved.
    sanctioned_minor: Option<i64>,
    line_number: i32,
}

impl ClaimLine {
    pub fn try_new(
        id: ClaimLineId,
        type_code: ClaimTypeCode,
        description: String,
        spent_on: NaiveDate,
        claimed_minor: i64,
        line_number: i32,
    ) -> Result<Self, ClaimError> {
        let description = description.trim().to_owned();
        if description.is_empty() || description.chars().count() > MAX_DESCRIPTION_LEN {
            return Err(ClaimError::DescriptionRequired);
        }
        if claimed_minor <= 0 {
            return Err(ClaimError::NotPositive {
                field: "claimed_minor",
            });
        }
        Ok(Self {
            id,
            type_code,
            description,
            spent_on,
            claimed_minor,
            sanctioned_minor: None,
            line_number,
        })
    }

    fn sanction(&mut self, sanctioned_minor: i64) -> Result<(), ClaimError> {
        if sanctioned_minor <= 0 {
            return Err(ClaimError::NotPositive {
                field: "sanctioned_minor",
            });
        }
        if sanctioned_minor > self.claimed_minor {
            return Err(ClaimError::SanctionAboveClaim {
                line_number: self.line_number,
                sanctioned_minor,
                claimed_minor: self.claimed_minor,
            });
        }
        self.sanctioned_minor = Some(sanctioned_minor);
        Ok(())
    }

    /// The stored sanction, on the way in from storage. The same rules the
    /// decider's act ran — the fold must not accept a row the live path
    /// could not have produced.
    pub fn sanction_for_storage(&mut self, sanctioned_minor: i64) -> Result<(), ClaimError> {
        self.sanction(sanctioned_minor)
    }

    pub fn id(&self) -> &ClaimLineId {
        &self.id
    }
    pub fn type_code(&self) -> &ClaimTypeCode {
        &self.type_code
    }
    pub fn description(&self) -> &str {
        &self.description
    }
    pub fn spent_on(&self) -> NaiveDate {
        self.spent_on
    }
    pub fn claimed_minor(&self) -> i64 {
        self.claimed_minor
    }
    pub fn sanctioned_minor(&self) -> Option<i64> {
        self.sanctioned_minor
    }
    pub fn line_number(&self) -> i32 {
        self.line_number
    }
}

/// One event of the append-only trail. `RETURNED` rests nowhere else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClaimEvent {
    pub actor: String,
    /// `FILED`, `SUBMITTED`, `APPROVED`, `REJECTED`, `RETURNED`, `WITHDRAWN`
    /// or `PAID`.
    pub action: &'static str,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    /// What a screen's timeline should show beside the act — the payout's
    /// document and journal number, where there is one to name.
    pub detail: Option<String>,
}

/// What an approval leaves for the caller to post, in the same transaction.
///
/// The domain aggregates the sanctioned lines by type code — lines whose type
/// differs may share one journal — and hands the totals over; the caller
/// resolves the place to a site and the meaning to an account, which are
/// questions for the database and not for this struct.
#[derive(Debug, Clone)]
pub struct ClaimPosting {
    /// `(type code, sanctioned total)` per debit leg, in line order.
    pub by_type: Vec<(ClaimTypeCode, i64)>,
    pub total_minor: i64,
    pub employee: EmployeeId,
}

/// Where a claim stands. The pairings the table CHECKs state are carried
/// here as fields, so the fold has to read them together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClaimState {
    Draft,
    Submitted,
    Approved {
        decided: Authorization,
        sanctioned_minor: i64,
        /// The journal entry the sanction posted, present by construction.
        approved_entry: String,
    },
    Rejected {
        decided: Authorization,
    },
    Withdrawn {
        withdrawn: Authorization,
    },
    Paid {
        decided: Authorization,
        sanctioned_minor: i64,
        approved_entry: String,
        paid_by: String,
        paid_at: DateTime<Utc>,
        /// The petty-cash payout's journal entry.
        payout_entry: String,
    },
}

impl ClaimState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Draft => "DRAFT",
            Self::Submitted => "SUBMITTED",
            Self::Approved { .. } => "APPROVED",
            Self::Rejected { .. } => "REJECTED",
            Self::Withdrawn { .. } => "WITHDRAWN",
            Self::Paid { .. } => "PAID",
        }
    }

    /// Who decided, and under what authority — `None` before a decision and
    /// after a filer's withdrawal, which is a taking-back and not a decision.
    pub fn decision(&self) -> Option<&Authorization> {
        match self {
            Self::Approved { decided, .. } | Self::Rejected { decided } => Some(decided),
            _ => None,
        }
    }

    /// The sanctioned total, exactly when a decision sanctioned something.
    pub fn sanctioned_minor(&self) -> Option<i64> {
        match self {
            Self::Approved {
                sanctioned_minor, ..
            }
            | Self::Paid {
                sanctioned_minor, ..
            } => Some(*sanctioned_minor),
            _ => None,
        }
    }
}

/// The stored shape, so decoding re-runs every rule.
#[derive(Debug, Clone)]
pub struct ExpenseClaimWire {
    pub id: ClaimId,
    pub place: PlaceId,
    pub employee: EmployeeId,
    pub claimed_by: String,
    pub posted_on: NaiveDate,
    pub lines: Vec<ClaimLine>,
    pub state: ClaimState,
    pub history: Vec<ClaimEvent>,
}

/// One expense claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExpenseClaim {
    id: ClaimId,
    /// `KLC-{place}-{yy}-{seq}`, minted by persistence and never by the
    /// caller: a document number chosen anywhere else is a second authority.
    claim_number: String,
    place: PlaceId,
    employee: EmployeeId,
    claimed_by: String,
    posted_on: NaiveDate,
    lines: Vec<ClaimLine>,
    state: ClaimState,
    history: Vec<ClaimEvent>,
}

fn history_event(
    actor: &str,
    action: &'static str,
    reason: Option<&ReasonText>,
    at: DateTime<Utc>,
) -> ClaimEvent {
    ClaimEvent {
        actor: actor.to_owned(),
        action,
        reason: reason.map(ReasonText::to_string),
        at,
        detail: None,
    }
}

impl ExpenseClaim {
    /// File one. The authorization records the key that actually applied —
    /// `people.claim.request_own` for somebody filing their own spending,
    /// `people.claim.file` for a manager filing on a colleague's behalf — so
    /// the stored claim says which authority it rested on.
    pub fn file(
        id: ClaimId,
        claim_number: String,
        place: PlaceId,
        employee: EmployeeId,
        posted_on: NaiveDate,
        lines: Vec<ClaimLine>,
        catalogue: &super::catalogue::ClaimTypeCatalogue,
        authorization: Authorization,
    ) -> Result<Self, ClaimError> {
        if !authorization.authorizes_claim_filing() {
            return Err(ClaimError::ActionForbidsFiling {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if lines.is_empty() {
            return Err(ClaimError::NoLines);
        }
        for line in &lines {
            catalogue.require_active(line.type_code())?;
        }
        Ok(Self {
            id,
            claim_number,
            place,
            employee,
            claimed_by: authorization.actor().to_string(),
            posted_on,
            lines,
            state: ClaimState::Draft,
            history: vec![history_event(
                authorization.actor().as_str(),
                "FILED",
                Some(authorization.reason()),
                authorization.at(),
            )],
        })
    }

    /// Rebuild from storage, re-running every rule the live path enforces.
    pub fn try_new(
        wire: ExpenseClaimWire,
        catalogue: &super::catalogue::ClaimTypeCatalogue,
    ) -> Result<Self, ClaimError> {
        if wire.lines.is_empty() {
            return Err(ClaimError::NoLines);
        }
        for line in &wire.lines {
            catalogue.require(line.type_code())?;
        }
        // The lines carry sanctions exactly when the decision sanctioned
        // them: a submitted claim with figures already written on it is the
        // halfway state the header CHECK cannot see.
        let decided_states = matches!(
            wire.state,
            ClaimState::Approved { .. } | ClaimState::Paid { .. }
        );
        for line in &wire.lines {
            if line.sanctioned_minor().is_some() != decided_states {
                return Err(ClaimError::SanctionMissingLine {
                    line_number: line.line_number,
                });
            }
        }
        match &wire.state {
            ClaimState::Approved {
                decided,
                sanctioned_minor,
                approved_entry,
            }
            | ClaimState::Paid {
                decided,
                sanctioned_minor,
                approved_entry,
                ..
            } => {
                if !decided.authorizes_claim_decision() {
                    return Err(ClaimError::ActionForbidsDecision {
                        action_key: decided.action_key().to_owned(),
                    });
                }
                if decided.actor().as_str() == wire.claimed_by {
                    return Err(ClaimError::SameActorFiledAndDecided {
                        actor: decided.actor().to_string(),
                    });
                }
                if approved_entry.is_empty() {
                    return Err(ClaimError::ApprovalWithoutPosting);
                }
                // The header total is the decider's arithmetic over their own
                // line sanctions; a stored claim whose totals disagree is a
                // claim decided twice by somebody editing a column.
                let lines_total: i64 = wire
                    .lines
                    .iter()
                    .filter_map(|line| line.sanctioned_minor())
                    .sum();
                if lines_total != *sanctioned_minor {
                    return Err(ClaimError::SanctionTotalDisagrees {
                        stored_minor: *sanctioned_minor,
                        lines_minor: lines_total,
                    });
                }
                if let ClaimState::Paid { payout_entry, .. } = &wire.state {
                    if payout_entry.is_empty() {
                        return Err(ClaimError::PayoutWithoutPosting);
                    }
                }
            }
            ClaimState::Rejected { decided } => {
                if !decided.authorizes_claim_decision() {
                    return Err(ClaimError::ActionForbidsDecision {
                        action_key: decided.action_key().to_owned(),
                    });
                }
                if decided.actor().as_str() == wire.claimed_by {
                    return Err(ClaimError::SameActorFiledAndDecided {
                        actor: decided.actor().to_string(),
                    });
                }
            }
            ClaimState::Withdrawn { withdrawn } => {
                if !withdrawn.authorizes_claim_filing() {
                    return Err(ClaimError::ActionForbidsFiling {
                        action_key: withdrawn.action_key().to_owned(),
                    });
                }
            }
            ClaimState::Draft | ClaimState::Submitted => {}
        }
        Ok(Self {
            id: wire.id,
            claim_number: String::new(),
            place: wire.place,
            employee: wire.employee,
            claimed_by: wire.claimed_by,
            posted_on: wire.posted_on,
            lines: wire.lines,
            state: wire.state,
            history: wire.history,
        })
    }

    /// The claim number, attached by the loader that read it from the row.
    /// The domain does not carry it through every transition because nothing
    /// decides on it: a document number is an address, not a state.
    pub fn with_claim_number(mut self, claim_number: String) -> Self {
        self.claim_number = claim_number;
        self
    }

    /// The filer sends it up. The one act between filing and deciding, and
    /// the filer's — a manager who could submit somebody else's half-filed
    /// claim would be deciding when to ask, which is the filer's call.
    pub fn submit(&mut self, authorization: Authorization) -> Result<(), ClaimError> {
        if !matches!(self.state, ClaimState::Draft) {
            return Err(ClaimError::ClaimNotDraft {
                state: self.state.code(),
            });
        }
        if authorization.actor().as_str() != self.claimed_by {
            return Err(ClaimError::SubmissionNotByFiler);
        }
        self.history.push(history_event(
            authorization.actor().as_str(),
            "SUBMITTED",
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = ClaimState::Submitted;
        Ok(())
    }

    /// Withdraw — only the filer, from DRAFT or SUBMITTED.
    ///
    /// Anyone else who wants a submitted claim gone must decide it, which
    /// records their name and their reason. Letting a third party "withdraw"
    /// it would dispose of the claim while making it look like the filer
    /// changed their own mind.
    pub fn withdraw(&mut self, authorization: Authorization) -> Result<(), ClaimError> {
        if !matches!(self.state, ClaimState::Draft | ClaimState::Submitted) {
            return Err(ClaimError::ClaimNotWithdrawable {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_claim_filing() {
            return Err(ClaimError::ActionForbidsFiling {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if authorization.actor().as_str() != self.claimed_by {
            return Err(ClaimError::WithdrawalNotByFiler);
        }
        self.history.push(history_event(
            authorization.actor().as_str(),
            "WITHDRAWN",
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = ClaimState::Withdrawn {
            withdrawn: authorization,
        };
        Ok(())
    }

    /// Sanction it: approve with a figure per line, or reject by name.
    ///
    /// Every line must be sanctioned, each figure positive and not above what
    /// was claimed, and the total is the decider's arithmetic. A claim whose
    /// lines sanction to nothing is refused by name — sending it back or
    /// rejecting it are decisions somebody has to stand behind, and an
    /// approval of zero is neither.
    ///
    /// Returns what the caller must post **in the same transaction as this
    /// decision**: `Dr employee_expense` per type, `Cr
    /// employee_claim_payable` for the total. Nothing here writes it; what
    /// this guarantees is that a decision and its posting are produced
    /// together or not at all.
    pub fn decide(
        &mut self,
        approve: bool,
        sanctions: &[(ClaimLineId, i64)],
        authorization: Authorization,
    ) -> Result<Option<ClaimPosting>, ClaimError> {
        if !matches!(self.state, ClaimState::Submitted) {
            return Err(ClaimError::ClaimNotSubmitted {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_claim_decision() {
            return Err(ClaimError::ActionForbidsDecision {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if authorization.actor().as_str() == self.claimed_by {
            return Err(ClaimError::SameActorFiledAndDecided {
                actor: authorization.actor().to_string(),
            });
        }
        let reason = Some(authorization.reason());
        if !approve {
            self.history.push(history_event(
                authorization.actor().as_str(),
                "REJECTED",
                reason,
                authorization.at(),
            ));
            self.state = ClaimState::Rejected {
                decided: authorization,
            };
            return Ok(None);
        }

        if sanctions.is_empty() {
            return Err(ClaimError::SanctionNothing);
        }
        for line in &mut self.lines {
            let sanctioned = sanctions
                .iter()
                .find(|(id, _)| id == line.id())
                .map(|(_, amount)| *amount)
                .ok_or(ClaimError::SanctionMissingLine {
                    line_number: line.line_number,
                })?;
            line.sanction(sanctioned)?;
        }
        let total_minor: i64 = self
            .lines
            .iter()
            .filter_map(|line| line.sanctioned_minor())
            .sum();

        // Aggregated per type, in line order: lines whose type differs share
        // one journal, and every debit leg names the type that earned it.
        let mut by_type: Vec<(ClaimTypeCode, i64)> = Vec::new();
        for line in &self.lines {
            let sanctioned = line
                .sanctioned_minor()
                .expect("sanctioned by the loop above");
            match by_type
                .iter_mut()
                .find(|(code, _)| code == line.type_code())
            {
                Some((_, amount)) => *amount += sanctioned,
                None => by_type.push((line.type_code().clone(), sanctioned)),
            }
        }

        self.history.push(history_event(
            authorization.actor().as_str(),
            "APPROVED",
            reason,
            authorization.at(),
        ));
        self.state = ClaimState::Approved {
            decided: authorization,
            sanctioned_minor: total_minor,
            // Stamped by `mark_approved` once the poster has written the
            // entry; the fold refuses an approved state without one, so a
            // caller that forgets cannot be stored.
            approved_entry: String::new(),
        };
        Ok(Some(ClaimPosting {
            by_type,
            total_minor,
            employee: self.employee.clone(),
        }))
    }

    /// Stamp the approval with the entry the caller posted for it, in the
    /// transaction that recorded the decision. A decision that was not
    /// approved has nothing to stamp.
    pub fn mark_approved(&mut self, entry_id: String) -> Result<(), ClaimError> {
        if entry_id.is_empty() {
            return Err(ClaimError::ApprovalWithoutPosting);
        }
        match &mut self.state {
            ClaimState::Approved { approved_entry, .. } => {
                *approved_entry = entry_id;
                Ok(())
            }
            _ => Err(ClaimError::ApprovalWithoutPosting),
        }
    }

    /// Send a submitted claim back to DRAFT, with a reason.
    ///
    /// The one decision that rests nowhere: the state goes back to DRAFT, the
    /// decision columns empty out, and the history keeps the only record that
    /// it happened. Keeping it simple — once per round is the only limit, and
    /// the resubmission that follows is a fresh SUBMITTED.
    pub fn return_to_draft(&mut self, authorization: Authorization) -> Result<(), ClaimError> {
        if !matches!(self.state, ClaimState::Submitted) {
            return Err(ClaimError::ClaimNotSubmitted {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_claim_decision() {
            return Err(ClaimError::ActionForbidsDecision {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if authorization.actor().as_str() == self.claimed_by {
            return Err(ClaimError::SameActorFiledAndDecided {
                actor: authorization.actor().to_string(),
            });
        }
        self.history.push(history_event(
            authorization.actor().as_str(),
            "RETURNED",
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = ClaimState::Draft;
        Ok(())
    }

    /// Pay an approved claim out of the place's petty cash.
    ///
    /// `entry_id` is the payout's journal entry and `document_number` the
    /// `KKC-` number the imprest lane's counter minted, both produced inside
    /// the caller's transaction — the same shape an approval's posting takes.
    /// A paid claim is terminal: the money has moved, and only a reversal
    /// moves it back.
    pub fn pay(
        &mut self,
        paid_by: &str,
        entry_id: String,
        document_number: &str,
        authorization: Authorization,
    ) -> Result<(), ClaimError> {
        if !matches!(self.state, ClaimState::Approved { .. }) {
            return Err(ClaimError::ClaimNotPayable {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_claim_payout() {
            return Err(ClaimError::ActionForbidsPayout {
                action_key: authorization.action_key().to_owned(),
            });
        }
        let (decided, sanctioned_minor, approved_entry) = match &self.state {
            ClaimState::Approved {
                decided,
                sanctioned_minor,
                approved_entry,
            } => (decided.clone(), *sanctioned_minor, approved_entry.clone()),
            _ => unreachable!("checked above"),
        };
        if entry_id.is_empty() {
            return Err(ClaimError::PayoutWithoutPosting);
        }
        let mut event = history_event(
            authorization.actor().as_str(),
            "PAID",
            Some(authorization.reason()),
            authorization.at(),
        );
        event.detail = Some(format!(
            "{document_number} · {entry_id} · paid by {paid_by}"
        ));
        self.history.push(event);
        self.state = ClaimState::Paid {
            decided,
            sanctioned_minor,
            approved_entry,
            paid_by: paid_by.to_owned(),
            paid_at: authorization.at(),
            payout_entry: entry_id,
        };
        Ok(())
    }

    pub fn id(&self) -> &ClaimId {
        &self.id
    }
    pub fn claim_number(&self) -> &str {
        &self.claim_number
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn claimed_by(&self) -> &str {
        &self.claimed_by
    }
    pub fn posted_on(&self) -> NaiveDate {
        self.posted_on
    }
    pub fn lines(&self) -> &[ClaimLine] {
        &self.lines
    }
    pub fn claimed_total_minor(&self) -> i64 {
        self.lines.iter().map(|line| line.claimed_minor()).sum()
    }
    pub fn state(&self) -> &ClaimState {
        &self.state
    }
    pub fn history(&self) -> &[ClaimEvent] {
        &self.history
    }
}
