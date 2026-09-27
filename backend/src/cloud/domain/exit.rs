//! The end of employment: what the person said at the door, and the one
//! statement that closes their books.
//!
//! # The interview is created by the machine and answered by the employer
//!
//! [`crate::cloud::domain::employment`] terminates with a reason; the PENDING
//! exit interview appears in the same transaction (`ON CONFLICT DO NOTHING`,
//! because the guard costs nothing and the fold's guarantee is the fold's).
//! Completing it is `people.exit_interview.file` — ADMIN, head office's,
//! because the store is a party to the exit and does not hold the pen. The
//! completion stores the stance, the summary, who conducted it and when, and
//! no authorization beside them: the columns are the record HRMS's shape
//! has room for, the route's key is the gate on the live path, and
//! `conducted_by` is the name on it.
//!
//! # The statement aggregates; it does not re-enter
//!
//! The Full & Final statement is READS of live tables — the finance lane's
//! `advance` (0280) for what the leaver still holds, `expense_claim` (0341)
//! APPROVED and unpaid for what the company owes — plus manual
//! asset-recovery rows. The reads are copied into the statement at creation
//! (the handover-snapshot rule: the statement is what Finance settles
//! against, so it stops moving), and [`FullAndFinalStatement::settle`]
//! re-reads the same sources and refuses on drift, naming what moved. There
//! is no watermark to maintain: one read, written twice, compared.
//!
//! # The one journal, and where each leg lives
//!
//! The settlement is one act, so it posts one journal —
//! `('FULL_AND_FINAL', fnf_id, 'MAIN')` — for the net
//!
//! ```text
//! net = claim_payable + final_pay − advance_outstanding − asset_recovery
//! ```
//!
//! with the person-side line at the LEAVER'S PLACE (`employee_claim_payable`,
//! party = the leaver: credited when the company still owes, debited when the
//! leaver owes) and the cash side at HEAD_OFFICE_SITE. Two sites, so
//! `poster::post` adds the affiliate legs itself, the way it does for every
//! inter-unit entry; this module writes no leg of its own and refuses
//! nothing about the placement, because the balancer either expresses it or
//! refuses by name through an unmapped meaning. (Placement recorded; the
//! spec left the counter-leg open.)
//!
//! A net of exactly zero posts nothing — `poster` refuses an empty entry,
//! and a settlement of nothing has nothing to say. The refusal names the
//! arithmetic rather than writing a zero journal to satisfy a column.
//!
//! [`FullAndFinalStatement::try_new`] is the fold, as everywhere: the state
//! pairings, the settled entry's presence, and the asset total against its
//! rows are re-run on the way in from storage, so a row edited into a shape
//! no sequence of acts could reach fails to load rather than settling twice.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::employment::{Authorization, EmployeeId, PlaceId};
use super::grievance::MAX_GRIEVANCE_ID_LEN;

pub const MAX_SUMMARY_LEN: usize = 4_000;
pub const MAX_ASSET_NOTE_LEN: usize = 280;

/// What the exit kernel refuses, and the names it refuses them by.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum ExitError {
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error("a cancel without a reason is a decision without an author")]
    CancelReasonRequired,
    #[error("the interview is {state} and only a pending interview can be completed")]
    InterviewNotPending { state: &'static str },
    #[error("action `{action_key}` does not authorize an exit interview")]
    ActionForbidsCompletion { action_key: String },
    #[error("a completed interview must carry who conducted it")]
    ConductorRequired,
    #[error("the statement is {state} and only a draft can be settled")]
    FnfNotDraft { state: &'static str },
    #[error("the statement is {state} and only a draft can be cancelled")]
    FnfNotCancellable { state: &'static str },
    #[error("action `{action_key}` does not authorize a Full & Final settlement")]
    ActionForbidsSettlement { action_key: String },
    #[error("a settled statement must carry the entry that posted it")]
    SettlementWithoutPosting,
    #[error(
        "the open advances were {frozen_minor} when the statement was drafted and are \
             {live_minor} now; settle against what the person's books say today, or draft a \
             new statement"
    )]
    AdvanceOutstandingMoved { frozen_minor: i64, live_minor: i64 },
    #[error(
        "the unpaid claims were {frozen_minor} when the statement was drafted and are \
             {live_minor} now; settle against what the person's books say today, or draft a \
             new statement"
    )]
    ClaimPayableMoved { frozen_minor: i64, live_minor: i64 },
    #[error(
        "the asset rows recover {rows_minor} but the statement froze \
             {stored_minor}; a total nobody's arithmetic produces is a total nobody answers for"
    )]
    AssetTotalDisagrees { stored_minor: i64, rows_minor: i64 },
    #[error(
        "an asset recovery row needs a note; a charge against a leaver with nothing \
             behind it is a charge nobody can answer"
    )]
    AssetNoteRequired,
    #[error(
        "the statement settles to zero: claims {claim_minor}, final pay {final_pay_minor}, \
             advances {advance_minor}, assets {asset_minor} — there is nothing to post and \
             nothing to settle"
    )]
    NetIsZero {
        claim_minor: i64,
        final_pay_minor: i64,
        advance_minor: i64,
        asset_minor: i64,
    },
}

fn id(raw: &str, field: &'static str) -> Result<String, ExitError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_GRIEVANCE_ID_LEN {
        return Err(ExitError::InvalidId { field });
    }
    Ok(trimmed.to_owned())
}

/// One exit interview, by its id — the uuid the handler mints.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ExitId(String);

impl ExitId {
    pub fn try_new(raw: &str) -> Result<Self, ExitError> {
        id(raw, "exit_id").map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ExitId {
    type Error = ExitError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<ExitId> for String {
    fn from(value: ExitId) -> Self {
        value.0
    }
}

impl std::fmt::Display for ExitId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One Full & Final statement, by its id — the uuid the handler mints.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct FnfId(String);

impl FnfId {
    pub fn try_new(raw: &str) -> Result<Self, ExitError> {
        id(raw, "fnf_id").map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for FnfId {
    type Error = ExitError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<FnfId> for String {
    fn from(value: FnfId) -> Self {
        value.0
    }
}

impl std::fmt::Display for FnfId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// What the person said when they went. Asked to stay and took it, or going
/// anyway — the two answers an exit interview exists to record, and nothing
/// else: this is not an appraisal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EmployeeStance {
    Retained,
    ExitConfirmed,
}

impl EmployeeStance {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Retained => "RETAINED",
            Self::ExitConfirmed => "EXIT_CONFIRMED",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "RETAINED" => Some(Self::Retained),
            "EXIT_CONFIRMED" => Some(Self::ExitConfirmed),
            _ => None,
        }
    }
}

/// Where an interview stands. The pairings the table CHECKs state are
/// carried here as fields, so the fold has to read them together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExitInterviewState {
    Pending,
    Completed {
        stance: EmployeeStance,
        summary: Option<String>,
        conducted_by: String,
        completed_at: DateTime<Utc>,
    },
    Cancelled {
        cancelled_by: String,
        cancel_reason: String,
    },
}

impl ExitInterviewState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Completed { .. } => "COMPLETED",
            Self::Cancelled { .. } => "CANCELLED",
        }
    }
}

/// The stored shape, so decoding re-runs every rule.
#[derive(Debug, Clone)]
pub struct ExitInterviewWire {
    pub id: ExitId,
    pub employee: EmployeeId,
    pub place: PlaceId,
    pub state: ExitInterviewState,
}

/// One exit interview: one per person, at the end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExitInterview {
    id: ExitId,
    employee: EmployeeId,
    place: PlaceId,
    state: ExitInterviewState,
}

impl ExitInterview {
    /// The PENDING row the TERMINATE path (or a head-office backfill for a
    /// termination that predates the hook) creates. Takes no authorization:
    /// nothing has been asked or answered yet, and the act that creates the
    /// row is the employment machine's.
    pub fn open(id: ExitId, employee: EmployeeId, place: PlaceId) -> Self {
        Self {
            id,
            employee,
            place,
            state: ExitInterviewState::Pending,
        }
    }

    /// Rebuild from storage, re-running every rule the live path enforces.
    pub fn try_new(wire: ExitInterviewWire) -> Result<Self, ExitError> {
        match &wire.state {
            ExitInterviewState::Pending => {}
            ExitInterviewState::Completed {
                summary,
                conducted_by,
                ..
            } => {
                if conducted_by.trim().is_empty() {
                    return Err(ExitError::ConductorRequired);
                }
                if let Some(summary) = summary {
                    if summary.chars().count() > MAX_SUMMARY_LEN {
                        return Err(ExitError::InvalidId {
                            field: "interview_summary",
                        });
                    }
                }
            }
            ExitInterviewState::Cancelled {
                cancelled_by,
                cancel_reason,
            } => {
                if cancelled_by.trim().is_empty() || cancel_reason.trim().is_empty() {
                    return Err(ExitError::CancelReasonRequired);
                }
            }
        }
        Ok(Self {
            id: wire.id,
            employee: wire.employee,
            place: wire.place,
            state: wire.state,
        })
    }

    /// Answer it. The stance is the interview's one question; the summary is
    /// whatever the conversation produced, when anything did. Head office's
    /// act, under the key the caller exercised — the same key checked again
    /// here, because a method that trusted its caller would be a method
    /// every future caller has to remember to gate.
    pub fn complete(
        &mut self,
        stance: EmployeeStance,
        summary: Option<String>,
        conducted_by: &str,
        at: DateTime<Utc>,
        authorization: Authorization,
    ) -> Result<(), ExitError> {
        if !matches!(self.state, ExitInterviewState::Pending) {
            return Err(ExitError::InterviewNotPending {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_exit_interview() {
            return Err(ExitError::ActionForbidsCompletion {
                action_key: authorization.action_key().to_owned(),
            });
        }
        let summary = match summary {
            Some(summary) => {
                let trimmed = summary.trim();
                if trimmed.is_empty() {
                    None
                } else if trimmed.chars().count() > MAX_SUMMARY_LEN {
                    return Err(ExitError::InvalidId {
                        field: "interview_summary",
                    });
                } else {
                    Some(trimmed.to_owned())
                }
            }
            None => None,
        };
        self.state = ExitInterviewState::Completed {
            stance,
            summary,
            conducted_by: conducted_by.to_owned(),
            completed_at: at,
        };
        Ok(())
    }

    /// Mark it never held. The honest answer to "the person left and the
    /// interview never happened": a name and a reason, never silence.
    pub fn cancel(
        &mut self,
        reason: &str,
        cancelled_by: &str,
        authorization: Authorization,
    ) -> Result<(), ExitError> {
        if !matches!(self.state, ExitInterviewState::Pending) {
            return Err(ExitError::InterviewNotPending {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_exit_interview() {
            return Err(ExitError::ActionForbidsCompletion {
                action_key: authorization.action_key().to_owned(),
            });
        }
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(ExitError::CancelReasonRequired);
        }
        self.state = ExitInterviewState::Cancelled {
            cancelled_by: cancelled_by.to_owned(),
            cancel_reason: reason.to_owned(),
        };
        Ok(())
    }

    pub fn id(&self) -> &ExitId {
        &self.id
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn state(&self) -> &ExitInterviewState {
        &self.state
    }
}

/// One manual asset-recovery row of a statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FnfAssetRow {
    pub row_id: String,
    /// The assets module's asset — `fixed_asset.asset_id`, typed by the
    /// schema's foreign key so a typo is a refusal and not a recovery
    /// against nothing.
    pub asset_id: uuid::Uuid,
    pub note: String,
    pub recovery_minor: i64,
}

impl FnfAssetRow {
    pub fn try_new(
        row_id: String,
        asset_id: uuid::Uuid,
        note: String,
        recovery_minor: i64,
    ) -> Result<Self, ExitError> {
        let note = {
            let trimmed = note.trim();
            if trimmed.is_empty() || trimmed.chars().count() > MAX_ASSET_NOTE_LEN {
                return Err(ExitError::AssetNoteRequired);
            }
            trimmed.to_owned()
        };
        if recovery_minor < 0 {
            return Err(ExitError::InvalidId {
                field: "recovery_minor",
            });
        }
        Ok(Self {
            row_id: id(&row_id, "row_id")?,
            asset_id,
            note,
            recovery_minor,
        })
    }
}

/// One event of the statement's trail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FnfEvent {
    pub actor: String,
    /// `CREATED`, `SETTLED` or `CANCELLED`.
    pub action: &'static str,
    pub reason: Option<String>,
    pub at: DateTime<Utc>,
    /// The SETTLED event carries the journal number and id — the detail a
    /// screen shows beside the act, the way the claims payout does.
    pub detail: Option<String>,
}

/// Where a statement stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FullAndFinalState {
    Draft,
    Settled {
        settled_by: String,
        settled_at: DateTime<Utc>,
        /// The journal entry the settlement posted, present by construction.
        settled_entry: String,
    },
    Cancelled {
        cancelled_by: String,
        cancel_reason: String,
    },
}

impl FullAndFinalState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Draft => "DRAFT",
            Self::Settled { .. } => "SETTLED",
            Self::Cancelled { .. } => "CANCELLED",
        }
    }
}

/// The stored shape, so decoding re-runs every rule.
#[derive(Debug, Clone)]
pub struct FullAndFinalWire {
    pub id: FnfId,
    pub employee: EmployeeId,
    pub place: PlaceId,
    pub transaction_on: NaiveDate,
    pub advance_outstanding_minor: i64,
    pub claim_payable_minor: i64,
    pub asset_recovery_minor: i64,
    pub final_pay_minor: i64,
    pub assets: Vec<FnfAssetRow>,
    pub state: FullAndFinalState,
    pub history: Vec<FnfEvent>,
    pub created_by: String,
}

/// What a settlement leaves for the caller to post, in the same transaction.
///
/// The sign is the net's: positive means the company still pays the leaver
/// (credit the person-side line), negative means the leaver still owes
/// (debit it). Zero never reaches the caller — [`ExitError::NetIsZero`]
/// names the arithmetic instead.
#[derive(Debug, Clone)]
pub struct FnfPosting {
    pub employee: EmployeeId,
    pub net_minor: i64,
}

/// One Full & Final statement: the leaver's books, closed once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FullAndFinalStatement {
    id: FnfId,
    employee: EmployeeId,
    place: PlaceId,
    transaction_on: NaiveDate,
    /// What the leaver still holds of the company's money, frozen at
    /// creation from the finance lane's `advance`.
    advance_outstanding_minor: i64,
    /// What the company still owes on sanctioned claims, frozen at creation
    /// from `expense_claim` APPROVED and unpaid.
    claim_payable_minor: i64,
    /// What the manual asset rows recover, their sum by construction.
    asset_recovery_minor: i64,
    final_pay_minor: i64,
    assets: Vec<FnfAssetRow>,
    state: FullAndFinalState,
    history: Vec<FnfEvent>,
    created_by: String,
}

fn event(
    actor: &str,
    action: &'static str,
    reason: Option<&super::employment::ReasonText>,
    at: DateTime<Utc>,
) -> FnfEvent {
    FnfEvent {
        actor: actor.to_owned(),
        action,
        reason: reason.map(|reason| reason.to_string()),
        at,
        detail: None,
    }
}

impl FullAndFinalStatement {
    /// Draft one, freezing the live reads. The caller has already read the
    /// sources; the totals land here and stay. Creation is head office's
    /// (`people.fnf.settle`), because the statement settles across places —
    /// an advance taken at one shop, a claim sanctioned at another.
    #[allow(clippy::too_many_arguments)]
    pub fn draft(
        id: FnfId,
        employee: EmployeeId,
        place: PlaceId,
        transaction_on: NaiveDate,
        advance_outstanding_minor: i64,
        claim_payable_minor: i64,
        final_pay_minor: i64,
        assets: Vec<FnfAssetRow>,
        authorization: Authorization,
    ) -> Result<Self, ExitError> {
        if !authorization.authorizes_fnf_settlement() {
            return Err(ExitError::ActionForbidsSettlement {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if advance_outstanding_minor < 0 || claim_payable_minor < 0 || final_pay_minor < 0 {
            return Err(ExitError::InvalidId {
                field: "frozen totals",
            });
        }
        let asset_recovery_minor: i64 = assets.iter().map(|row| row.recovery_minor).sum();
        Ok(Self {
            id,
            employee,
            place,
            transaction_on,
            advance_outstanding_minor,
            claim_payable_minor,
            asset_recovery_minor,
            final_pay_minor,
            assets,
            state: FullAndFinalState::Draft,
            history: vec![event(
                authorization.actor().as_str(),
                "CREATED",
                Some(authorization.reason()),
                authorization.at(),
            )],
            created_by: authorization.actor().to_string(),
        })
    }

    /// Rebuild from storage, re-running every rule the live path enforces.
    pub fn try_new(wire: FullAndFinalWire) -> Result<Self, ExitError> {
        if wire.advance_outstanding_minor < 0
            || wire.claim_payable_minor < 0
            || wire.asset_recovery_minor < 0
            || wire.final_pay_minor < 0
        {
            return Err(ExitError::InvalidId {
                field: "frozen totals",
            });
        }
        if wire.created_by.trim().is_empty() {
            return Err(ExitError::InvalidId {
                field: "created_by",
            });
        }
        // The header total is the rows' arithmetic; a stored statement whose
        // totals disagree is a statement decided twice by somebody editing a
        // column.
        let rows_minor: i64 = wire.assets.iter().map(|row| row.recovery_minor).sum();
        if rows_minor != wire.asset_recovery_minor {
            return Err(ExitError::AssetTotalDisagrees {
                stored_minor: wire.asset_recovery_minor,
                rows_minor,
            });
        }
        match &wire.state {
            FullAndFinalState::Draft => {}
            FullAndFinalState::Settled {
                settled_by,
                settled_entry,
                ..
            } => {
                if settled_by.trim().is_empty() || settled_entry.is_empty() {
                    return Err(ExitError::SettlementWithoutPosting);
                }
            }
            FullAndFinalState::Cancelled {
                cancelled_by,
                cancel_reason,
            } => {
                if cancelled_by.trim().is_empty() || cancel_reason.trim().is_empty() {
                    return Err(ExitError::CancelReasonRequired);
                }
            }
        }
        Ok(Self {
            id: wire.id,
            employee: wire.employee,
            place: wire.place,
            transaction_on: wire.transaction_on,
            advance_outstanding_minor: wire.advance_outstanding_minor,
            claim_payable_minor: wire.claim_payable_minor,
            asset_recovery_minor: wire.asset_recovery_minor,
            final_pay_minor: wire.final_pay_minor,
            assets: wire.assets,
            state: wire.state,
            history: wire.history,
            created_by: wire.created_by,
        })
    }

    /// The net, in the settlement journal's arithmetic: what the company
    /// owes, less what the leaver returns. Positive credits the person-side
    /// line; negative debits it.
    pub fn net_payable_minor(&self) -> i64 {
        self.claim_payable_minor + self.final_pay_minor
            - self.advance_outstanding_minor
            - self.asset_recovery_minor
    }

    /// Settle it against the live reads.
    ///
    /// The frozen totals are compared here, inside the caller's transaction,
    /// and drift is refused by name — a statement settled against moved
    /// sources would book a net nobody's books support. Produces the
    /// [`FnfPosting`] the caller must post **in the same transaction**;
    /// [`FullAndFinalStatement::mark_settled`] stamps the entry afterwards.
    pub fn settle(
        &mut self,
        live_advance_outstanding_minor: i64,
        live_claim_payable_minor: i64,
        authorization: Authorization,
    ) -> Result<FnfPosting, ExitError> {
        if !matches!(self.state, FullAndFinalState::Draft) {
            return Err(ExitError::FnfNotDraft {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_fnf_settlement() {
            return Err(ExitError::ActionForbidsSettlement {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if live_advance_outstanding_minor != self.advance_outstanding_minor {
            return Err(ExitError::AdvanceOutstandingMoved {
                frozen_minor: self.advance_outstanding_minor,
                live_minor: live_advance_outstanding_minor,
            });
        }
        if live_claim_payable_minor != self.claim_payable_minor {
            return Err(ExitError::ClaimPayableMoved {
                frozen_minor: self.claim_payable_minor,
                live_minor: live_claim_payable_minor,
            });
        }
        let net_minor = self.net_payable_minor();
        if net_minor == 0 {
            return Err(ExitError::NetIsZero {
                claim_minor: self.claim_payable_minor,
                final_pay_minor: self.final_pay_minor,
                advance_minor: self.advance_outstanding_minor,
                asset_minor: self.asset_recovery_minor,
            });
        }
        self.state = FullAndFinalState::Settled {
            settled_by: authorization.actor().to_string(),
            settled_at: authorization.at(),
            // Stamped by `mark_settled` once the poster has written the
            // entry; the fold refuses a settled state without one, so a
            // caller that forgets cannot be stored.
            settled_entry: String::new(),
        };
        Ok(FnfPosting {
            employee: self.employee.clone(),
            net_minor,
        })
    }

    /// Stamp the settlement with the entry the caller posted for it, in the
    /// transaction that recorded the settle. The trail's SETTLED event is
    /// appended here rather than in [`FullAndFinalStatement::settle`],
    /// because the journal number is the detail the event exists to carry.
    pub fn mark_settled(&mut self, entry_id: String, entry_number: &str) -> Result<(), ExitError> {
        if entry_id.is_empty() {
            return Err(ExitError::SettlementWithoutPosting);
        }
        let (settled_by, settled_at) = match &mut self.state {
            FullAndFinalState::Settled {
                settled_by,
                settled_at,
                settled_entry,
            } => {
                *settled_entry = entry_id.clone();
                (settled_by.clone(), *settled_at)
            }
            _ => return Err(ExitError::SettlementWithoutPosting),
        };
        self.history.push(FnfEvent {
            actor: settled_by,
            action: "SETTLED",
            reason: None,
            at: settled_at,
            detail: Some(format!("{entry_number} · {entry_id}")),
        });
        Ok(())
    }

    /// Cancel a draft. Only a draft: a settled statement's money has moved,
    /// and only a reversal moves it back — that is Finance's journal, not
    /// this module's second answer.
    pub fn cancel(&mut self, reason: &str, authorization: Authorization) -> Result<(), ExitError> {
        if !matches!(self.state, FullAndFinalState::Draft) {
            return Err(ExitError::FnfNotCancellable {
                state: self.state.code(),
            });
        }
        if !authorization.authorizes_fnf_settlement() {
            return Err(ExitError::ActionForbidsSettlement {
                action_key: authorization.action_key().to_owned(),
            });
        }
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(ExitError::CancelReasonRequired);
        }
        self.history.push(event(
            authorization.actor().as_str(),
            "CANCELLED",
            Some(authorization.reason()),
            authorization.at(),
        ));
        self.state = FullAndFinalState::Cancelled {
            cancelled_by: authorization.actor().to_string(),
            cancel_reason: reason.to_owned(),
        };
        Ok(())
    }

    pub fn id(&self) -> &FnfId {
        &self.id
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn transaction_on(&self) -> NaiveDate {
        self.transaction_on
    }
    pub fn advance_outstanding_minor(&self) -> i64 {
        self.advance_outstanding_minor
    }
    pub fn claim_payable_minor(&self) -> i64 {
        self.claim_payable_minor
    }
    pub fn asset_recovery_minor(&self) -> i64 {
        self.asset_recovery_minor
    }
    pub fn final_pay_minor(&self) -> i64 {
        self.final_pay_minor
    }
    pub fn assets(&self) -> &[FnfAssetRow] {
        &self.assets
    }
    pub fn state(&self) -> &FullAndFinalState {
        &self.state
    }
    pub fn history(&self) -> &[FnfEvent] {
        &self.history
    }
    pub fn created_by(&self) -> &str {
        &self.created_by
    }
}
