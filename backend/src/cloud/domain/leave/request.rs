//! Asking for days off, and what was decided.
//!
//! # An approval and its deduction happen together, or neither happens
//!
//! In the implementation this replaces these are two writes: the request row
//! goes to `approved`, and a ledger entry is inserted. Nothing binds them. A
//! crash between the two, a handler that returns early, a retry that takes a
//! different branch — any of these leaves a request that says *approved* against
//! a balance that never moved. Nobody notices, because both rows look fine on
//! their own: the employee takes the leave, the balance still shows it
//! available, so they take it again.
//!
//! Here it is enforced in the type. [`LeaveRequestState::Approved`] **carries**
//! the ledger entry id for balance-backed leave, and [`LeaveRequest::approve`]
//! is the only way to reach that state. A caller can still fail to persist what
//! it was handed; what it cannot do is believe it approved something when
//! nothing was deducted.
//!
//! # What a request costs is settled on the day it is filed
//!
//! The chargeable dates are stored rather than recomputed, because the calendar
//! can be amended afterwards: a *cuti bersama* added in June must not silently
//! change what a request filed in April was charged. What it cost is a fact
//! about the day it was decided.

use super::error::LeaveError;
use super::kinds::{LeaveBacking, LeaveType, LeaveTypeCode};
use super::ledger::{LeaveEvent, LeaveLedger, LedgerEntry};
use super::policy::PolicyTimeline;
use super::units::LeaveDays;
use crate::cloud::domain::employment::{Authorization, EmployeeId, ReasonText, UnitId};
use crate::cloud::domain::holiday::HolidayCalendar;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

pub const MAX_REQUEST_ID_LEN: usize = 64;

/// One request, by its id.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct LeaveRequestId(String);

impl LeaveRequestId {
    pub fn try_new(raw: &str) -> Result<Self, LeaveError> {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.chars().any(char::is_control)
            || trimmed.chars().count() > MAX_REQUEST_ID_LEN
        {
            return Err(LeaveError::InvalidId {
                field: "leave_request_id",
            });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for LeaveRequestId {
    type Error = LeaveError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<LeaveRequestId> for String {
    fn from(value: LeaveRequestId) -> Self {
        value.0
    }
}

impl std::fmt::Display for LeaveRequestId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The span asked for, inclusive of both ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "LeavePeriodWire")]
pub struct LeavePeriod {
    from: NaiveDate,
    to: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeavePeriodWire {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

impl TryFrom<LeavePeriodWire> for LeavePeriod {
    type Error = LeaveError;
    fn try_from(wire: LeavePeriodWire) -> Result<Self, Self::Error> {
        Self::try_new(wire.from, wire.to)
    }
}

impl LeavePeriod {
    pub fn try_new(from: NaiveDate, to: NaiveDate) -> Result<Self, LeaveError> {
        if to < from {
            return Err(LeaveError::BackwardsRange { from, to });
        }
        Ok(Self { from, to })
    }

    pub const fn from(&self) -> NaiveDate {
        self.from
    }
    pub const fn to(&self) -> NaiveDate {
        self.to
    }

    pub fn dates(&self) -> impl Iterator<Item = NaiveDate> {
        self.from.iter_days().take_while({
            let to = self.to;
            move |date| *date <= to
        })
    }

    pub fn covers(&self, date: NaiveDate) -> bool {
        date >= self.from && date <= self.to
    }

    /// The days this request actually charges.
    ///
    /// **Every** kind of holiday is excluded, including *cuti bersama*. That day
    /// is already charged against the entitlement by the calendar; charging it
    /// again because it happens to fall inside a request takes the same day off
    /// the employee twice.
    ///
    /// The rest days arrive as a list rather than being read from a roster:
    /// attendance owns the roster, and depending on it to ask one question would
    /// tie the two together.
    pub fn chargeable(
        &self,
        calendar: &HolidayCalendar,
        unit: &UnitId,
        rest_days: &[NaiveDate],
    ) -> Vec<NaiveDate> {
        self.dates()
            .filter(|date| !calendar.is_holiday(*date, unit))
            .filter(|date| !rest_days.contains(date))
            .collect()
    }
}

/// Where a request stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LeaveRequestState {
    Pending,
    /// `ledger_entry` is present for balance-backed leave and absent otherwise.
    /// That pairing is the invariant this module exists for, expressed as a
    /// field rather than as discipline.
    Approved {
        decision: Authorization,
        ledger_entry: Option<String>,
    },
    Rejected {
        decision: Authorization,
    },
    Withdrawn {
        decision: Authorization,
    },
}

impl LeaveRequestState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Approved { .. } => "APPROVED",
            Self::Rejected { .. } => "REJECTED",
            Self::Withdrawn { .. } => "WITHDRAWN",
        }
    }

    pub const fn is_pending(&self) -> bool {
        matches!(self, Self::Pending)
    }

    pub const fn decision(&self) -> Option<&Authorization> {
        match self {
            Self::Pending => None,
            Self::Approved { decision, .. }
            | Self::Rejected { decision }
            | Self::Withdrawn { decision } => Some(decision),
        }
    }

    pub fn ledger_entry(&self) -> Option<&str> {
        match self {
            Self::Approved { ledger_entry, .. } => ledger_entry.as_deref(),
            _ => None,
        }
    }
}

/// What approving balance-backed leave needs to see.
///
/// One parameter rather than two options, because they are never independently
/// present: approving balance-backed leave needs both or neither. The policy is
/// resolved *per date* inside [`LeaveRequest::approve`], not taken as a single
/// value, so the rules in force on the day the leave starts are the ones that
/// apply.
#[derive(Debug, Clone, Copy)]
pub struct BalanceContext<'a> {
    pub ledger: &'a LeaveLedger,
    pub policies: &'a PolicyTimeline,
}

/// The stored shape, so decoding re-runs every rule.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeaveRequestWire {
    pub id: LeaveRequestId,
    pub employee: EmployeeId,
    pub unit: UnitId,
    pub leave_type: LeaveTypeCode,
    pub period: LeavePeriod,
    pub chargeable: Vec<NaiveDate>,
    #[serde(default)]
    pub evidence: Option<String>,
    pub requested: Authorization,
    pub state: LeaveRequestState,
}

/// One request for leave.
///
/// `Serialize` only. There is no `Deserialize`, deliberately: a request cannot
/// be rebuilt without the [`LeaveType`] it names, because the approval and
/// deduction pairing is unverifiable otherwise. Hydration goes through
/// [`LeaveRequest::try_new`], which looks the kind up first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LeaveRequest {
    id: LeaveRequestId,
    employee: EmployeeId,
    unit: UnitId,
    leave_type: LeaveTypeCode,
    period: LeavePeriod,
    /// Stored rather than recomputed — see the module doc.
    chargeable: Vec<NaiveDate>,
    evidence: Option<String>,
    requested: Authorization,
    state: LeaveRequestState,
}

impl LeaveRequest {
    /// File one.
    #[allow(clippy::too_many_arguments)]
    pub fn file(
        id: LeaveRequestId,
        employee: EmployeeId,
        unit: UnitId,
        leave_type: &LeaveType,
        period: LeavePeriod,
        calendar: &HolidayCalendar,
        rest_days: &[NaiveDate],
        evidence: Option<String>,
        requested: Authorization,
    ) -> Result<Self, LeaveError> {
        if !requested.authorizes_leave_request() {
            return Err(LeaveError::ActionForbidsRequest {
                action_key: requested.action_key().to_owned(),
            });
        }
        if leave_type.requires_evidence() && evidence.is_none() {
            return Err(LeaveError::EvidenceRequired {
                leave_type: leave_type.code().to_string(),
            });
        }
        let chargeable = period.chargeable(calendar, &unit, rest_days);
        // A "request" covering only holidays and rest days asks for nothing, and
        // approving it would put a zero-day entry in the ledger that a later
        // reader has to explain.
        if chargeable.is_empty() {
            return Err(LeaveError::NoChargeableDays {
                from: period.from(),
                to: period.to(),
            });
        }
        // The per-occurrence bound is checked against *chargeable* days rather
        // than against the span: a three-day allowance spanning a weekend is
        // three days off, not five.
        if let LeaveBacking::PerOccurrence { max_days } = leave_type.backing() {
            let requested_days = LeaveDays::from_days(
                i32::try_from(chargeable.len())
                    .map_err(|_| LeaveError::AmountOutOfRange { centidays: None })?,
            )?;
            if requested_days > max_days {
                return Err(LeaveError::ExceedsPerOccurrenceLimit {
                    leave_type: leave_type.code().to_string(),
                    requested_days: chargeable.len(),
                    max_days: max_days.centidays(),
                });
            }
        }
        Ok(Self {
            id,
            employee,
            unit,
            leave_type: leave_type.code().clone(),
            period,
            chargeable,
            evidence,
            requested,
            state: LeaveRequestState::Pending,
        })
    }

    /// Rebuild from storage, re-running every rule including the pairing.
    pub fn try_new(wire: LeaveRequestWire, leave_type: &LeaveType) -> Result<Self, LeaveError> {
        if wire.leave_type != *leave_type.code() {
            return Err(LeaveError::UnknownLeaveType {
                leave_type: wire.leave_type.to_string(),
            });
        }
        if !wire.requested.authorizes_leave_request() {
            return Err(LeaveError::ActionForbidsRequest {
                action_key: wire.requested.action_key().to_owned(),
            });
        }
        if leave_type.requires_evidence() && wire.evidence.is_none() {
            return Err(LeaveError::EvidenceRequired {
                leave_type: leave_type.code().to_string(),
            });
        }
        if wire.chargeable.is_empty() {
            return Err(LeaveError::NoChargeableDays {
                from: wire.period.from(),
                to: wire.period.to(),
            });
        }
        if let Some(date) = wire
            .chargeable
            .iter()
            .find(|date| !wire.period.covers(**date))
        {
            return Err(LeaveError::ChargeableDayOutsidePeriod { date: *date });
        }
        if let LeaveRequestState::Approved {
            decision,
            ledger_entry,
        } = &wire.state
        {
            if !decision.authorizes_leave_decision() {
                return Err(LeaveError::ActionForbidsDecision {
                    action_key: decision.action_key().to_owned(),
                });
            }
            match (leave_type.draws_on_balance(), ledger_entry) {
                (true, None) => {
                    return Err(LeaveError::ApprovalWithoutDeduction {
                        leave_type: leave_type.code().to_string(),
                    });
                }
                (false, Some(_)) => {
                    // Sick leave deducts from nothing; a deduction against it is
                    // somebody's entitlement quietly disappearing.
                    return Err(LeaveError::DeductionWithoutBalance {
                        leave_type: leave_type.code().to_string(),
                    });
                }
                _ => {}
            }
        }
        Ok(Self {
            id: wire.id,
            employee: wire.employee,
            unit: wire.unit,
            leave_type: wire.leave_type,
            period: wire.period,
            chargeable: wire.chargeable,
            evidence: wire.evidence,
            requested: wire.requested,
            state: wire.state,
        })
    }

    fn require_pending(&self) -> Result<(), LeaveError> {
        if self.state.is_pending() {
            return Ok(());
        }
        Err(LeaveError::RequestNotPending {
            state: self.state.code(),
        })
    }

    /// Approve, minting the deduction where there is one.
    ///
    /// Returns the ledger entry the caller must store **in the same transaction
    /// as this request**. Nothing here writes it; what this guarantees is that
    /// an approval and its entry are produced together or not at all.
    pub fn approve(
        &mut self,
        leave_type: &LeaveType,
        balance: Option<BalanceContext<'_>>,
        decision: Authorization,
    ) -> Result<Option<LedgerEntry>, LeaveError> {
        self.require_decidable_by(&decision)?;
        if !leave_type.draws_on_balance() {
            // Sick leave is approved and nothing is deducted, which is the
            // correct outcome and not an omission.
            self.state = LeaveRequestState::Approved {
                decision,
                ledger_entry: None,
            };
            return Ok(None);
        }
        let balance = balance.ok_or_else(|| LeaveError::BalanceContextRequired {
            leave_type: leave_type.code().to_string(),
        })?;
        let days = LeaveDays::from_days(
            i32::try_from(self.chargeable.len())
                .map_err(|_| LeaveError::AmountOutOfRange { centidays: None })?,
        )?;
        let taken_on = *self
            .chargeable
            .first()
            .ok_or_else(|| LeaveError::NoChargeableDays {
                from: self.period.from(),
                to: self.period.to(),
            })?;
        // The rules in force on the day the leave starts, not the rules in force
        // today. Resolved even though nothing below reads the value, because a
        // balance folded under no ratified policy is a number with no author and
        // the refusal is the point.
        let _policy = balance.policies.in_force_on(taken_on)?;
        balance.ledger.may_take(days, taken_on)?;

        let entry_id = format!("{}:{}", self.id, self.leave_type);
        let entry = LedgerEntry::try_new(
            &entry_id,
            taken_on,
            LeaveEvent::Usage,
            days,
            decision.actor().as_str(),
        )?;
        self.state = LeaveRequestState::Approved {
            decision,
            ledger_entry: Some(entry_id),
        };
        Ok(Some(entry))
    }

    /// Refuse it. The request stays in the record as evidence.
    pub fn reject(&mut self, decision: Authorization) -> Result<(), LeaveError> {
        self.require_decidable_by(&decision)?;
        self.state = LeaveRequestState::Rejected { decision };
        Ok(())
    }

    /// Pending, under the deciding key, and decided by somebody else.
    ///
    /// The third is the two-person rule every other HR decision already keeps
    /// — corrections, swaps, claims. A supervisor who files their own leave
    /// from the phone finds it in their own queue; approving it there would
    /// mint a deduction under the same name that asked for it, and a control
    /// one person completes alone is a record of a signature, not a control.
    /// Refusing it is refused too: taking your own request back is `withdraw`.
    fn require_decidable_by(&self, decision: &Authorization) -> Result<(), LeaveError> {
        self.require_pending()?;
        if !decision.authorizes_leave_decision() {
            return Err(LeaveError::ActionForbidsDecision {
                action_key: decision.action_key().to_owned(),
            });
        }
        if decision.actor() == self.requested.actor() {
            return Err(LeaveError::DecisionByRequester);
        }
        Ok(())
    }

    /// Take it back — only the person who filed it.
    ///
    /// Anyone else who wants a pending request gone must `reject` it, which
    /// records their name and their reason. Letting a third party "withdraw" it
    /// would dispose of the request while making it look like the employee
    /// changed their own mind.
    pub fn withdraw(&mut self, decision: Authorization) -> Result<(), LeaveError> {
        self.require_pending()?;
        if decision.actor() != self.requested.actor() {
            return Err(LeaveError::WithdrawalNotByRequester);
        }
        self.state = LeaveRequestState::Withdrawn { decision };
        Ok(())
    }

    pub fn id(&self) -> &LeaveRequestId {
        &self.id
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn unit(&self) -> &UnitId {
        &self.unit
    }
    pub fn leave_type(&self) -> &LeaveTypeCode {
        &self.leave_type
    }
    pub fn period(&self) -> LeavePeriod {
        self.period
    }
    pub fn chargeable(&self) -> &[NaiveDate] {
        &self.chargeable
    }
    pub fn chargeable_days(&self) -> usize {
        self.chargeable.len()
    }
    pub fn evidence(&self) -> Option<&str> {
        self.evidence.as_deref()
    }
    pub fn requested(&self) -> &Authorization {
        &self.requested
    }
    pub fn state(&self) -> &LeaveRequestState {
        &self.state
    }
    pub fn reason(&self) -> &ReasonText {
        self.requested.reason()
    }
}
