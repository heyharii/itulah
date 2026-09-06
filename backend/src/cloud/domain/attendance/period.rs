//! The attendance period close boundary — the payroll gate.
//!
//! Closing a `(place, month)` freezes the facts payroll will be computed from.
//! Three properties matter, and all three are enforced here rather than left to
//! a caller's discipline:
//!
//! 1. **A closed period refuses new facts.** Anything dated inside it is
//!    rejected by the constructor that takes the period as an argument.
//! 2. **A period cannot close over unresolved facts.** What counts as
//!    unresolved is [`CloseReadiness`], and it is computed server-side — never
//!    accepted from a request body.
//! 3. **The roster is frozen too.** Not only the facts: a scheduled day added
//!    afterwards manufactures a new absence, and therefore a new payroll basis,
//!    in a month that has already been settled.
//!
//! Reopening is possible, is head office's, needs a reason, and is recorded —
//! never silent. Every close and reopen appends to a history that is never
//! rewritten, and the status is folded back from that history on the way in.
//!
//! # What "not assessed" means here, and why it is not zero
//!
//! The reference's blockers are all punch-derived: unpaired punches, punched
//! days nobody rostered, days its kernel refuses to evaluate. **There is no
//! punch source in this system**, so those counts cannot be computed, and
//! sending zeros would be a claim nobody made and nobody verified — the same
//! objection the reference itself raises about recording a clean bill of health
//! on a reopen.
//!
//! So the punch-derived counts are `Option<u32>` and are `None` here, which the
//! recorded event preserves. A close taken today says, in its own evidence,
//! that the punch checks were *not assessed* rather than that they *passed*.
//! When a punch source arrives, the same field carries a number and old events
//! stay honest about having been taken without one.

use super::error::AttendanceError;
use super::time::AttendanceMonth;
use crate::cloud::domain::employment::{Authorization, PlaceId};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Whether a period currently accepts attendance facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PeriodStatus {
    /// Accepting roster changes and facts.
    Open,
    /// Frozen. Payroll may summarise it; nothing may add to it.
    Closed,
}

impl PeriodStatus {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Closed => "CLOSED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "OPEN" => Some(Self::Open),
            "CLOSED" => Some(Self::Closed),
            _ => None,
        }
    }
}

impl fmt::Display for PeriodStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// What a place must clear before its month can close.
///
/// Every field is an assertion **about stored data**, so it is computed
/// server-side from the persisted roster, leave and overtime for the
/// `(place, month)` being closed, and is never accepted from a request body. A
/// client that supplied its own zeros would close a month over anything it
/// liked, and the recorded event would then carry evidence that is simply false.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseReadiness {
    /// Leave requests dated in the period and still awaiting a decision.
    /// **Blocks** — an undecided request is a day whose plan is not settled.
    pub unresolved_leave: u32,
    /// Overtime orders dated in the period that nobody has answered.
    /// **Blocks** for the same reason: an unanswered order authorizes nothing,
    /// and closing over it freezes an unanswered question.
    pub unanswered_overtime: u32,
    /// Attendance corrections still open.
    ///
    /// `None` means **not assessed**, because there is no punch source and
    /// therefore no corrections to be open. It is not `0`: zero is a claim that
    /// somebody looked and found none.
    pub open_corrections: Option<u32>,
    /// Days with punches but no roster entry — likewise not assessed.
    pub unrostered_punch_days: Option<u32>,
    /// People with no roster entry in the period at all.
    ///
    /// **Informational.** A place may legitimately have staff who were not
    /// scheduled — somebody on long leave, somebody who joined at the end of
    /// the month — and blocking on it would make the close impossible to
    /// perform rather than careful.
    pub employees_without_roster: u32,
}

impl CloseReadiness {
    /// Nothing outstanding, and nothing assessed that cannot be.
    pub const CLEAR: Self = Self {
        unresolved_leave: 0,
        unanswered_overtime: 0,
        open_corrections: None,
        unrostered_punch_days: None,
        employees_without_roster: 0,
    };

    /// `true` when no blocker remains.
    ///
    /// A `None` count does not block. It cannot: there is nothing to count, and
    /// treating "not assessed" as a blocker would make every month uncloseable
    /// until a punch source exists. What it does instead is stay `None` in the
    /// recorded evidence, so nobody later reads the close as having checked.
    pub const fn can_close(&self) -> bool {
        self.unresolved_leave == 0
            && self.unanswered_overtime == 0
            && matches!(self.open_corrections, None | Some(0))
            && matches!(self.unrostered_punch_days, None | Some(0))
    }

    /// The refusal this readiness would produce, if any.
    pub fn blocker(&self) -> Option<AttendanceError> {
        if self.can_close() {
            return None;
        }
        Some(AttendanceError::PeriodHasBlockers {
            open_corrections: self.open_corrections.unwrap_or(0),
            unresolved_leave: self.unresolved_leave + self.unanswered_overtime,
        })
    }

    /// Whether anything about punches was assessed at all.
    ///
    /// Read by the screen, so it can say "no punch source is connected" rather
    /// than draw a row of zeros.
    pub const fn punches_assessed(&self) -> bool {
        self.open_corrections.is_some() || self.unrostered_punch_days.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PeriodEventKind {
    Closed,
    Reopened,
}

impl PeriodEventKind {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Closed => "CLOSED",
            Self::Reopened => "REOPENED",
        }
    }
}

/// One recorded close or reopen, with the readiness it was taken under.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PeriodEvent {
    kind: PeriodEventKind,
    readiness: Option<CloseReadiness>,
    authorization: Authorization,
}

impl PeriodEvent {
    pub const fn kind(&self) -> PeriodEventKind {
        self.kind
    }

    /// The blocker counts at the moment of the transition — evidence that the
    /// close was legitimate, kept even after the underlying data changes.
    ///
    /// `None` for a reopen, and deliberately so. A reopen is not taken under an
    /// assessment: nothing is checked, the boundary simply moves. Recording
    /// [`CloseReadiness::CLEAR`] instead would read as "no blockers were
    /// outstanding" — a claim nobody made and nobody verified.
    pub const fn readiness(&self) -> Option<CloseReadiness> {
        self.readiness
    }

    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The stored shape. The status is recomputed from the history.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttendancePeriodWire {
    pub place: PlaceId,
    pub period: AttendanceMonth,
    pub status: PeriodStatus,
    pub history: Vec<PeriodEvent>,
}

/// The close state of one `(place, month)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttendancePeriod {
    place: PlaceId,
    period: AttendanceMonth,
    status: PeriodStatus,
    history: Vec<PeriodEvent>,
}

impl<'de> Deserialize<'de> for AttendancePeriod {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = AttendancePeriodWire::deserialize(deserializer)?;
        Self::try_new(wire.place, wire.period, wire.status, wire.history)
            .map_err(serde::de::Error::custom)
    }
}

impl AttendancePeriod {
    /// A newly opened period.
    ///
    /// Opening needs no authority: an unclosed month is the resting state, not
    /// a decision. That is why there is no `open` event in the history — the
    /// history records departures from the resting state.
    pub fn open(place: PlaceId, period: AttendanceMonth) -> Self {
        Self {
            place,
            period,
            status: PeriodStatus::Open,
            history: Vec::new(),
        }
    }

    /// Rebuild from storage, re-running the close/reopen machine.
    ///
    /// Refuses a close recorded while already closed, a reopen recorded while
    /// open, and a claimed status the history does not produce — so a row
    /// cannot say OPEN when its last event is a close.
    pub fn try_new(
        place: PlaceId,
        period: AttendanceMonth,
        status: PeriodStatus,
        history: Vec<PeriodEvent>,
    ) -> Result<Self, AttendanceError> {
        let mut folded = PeriodStatus::Open;
        for event in &history {
            // A close carries the assessment it was taken under; a reopen never
            // has one. A row that inverts either is refused rather than revived
            // into a record that misrepresents its own evidence.
            match (event.kind, event.readiness) {
                (PeriodEventKind::Closed, None) => {
                    return Err(AttendanceError::CloseEventWithoutReadiness);
                }
                (PeriodEventKind::Reopened, Some(_)) => {
                    return Err(AttendanceError::ReopenEventWithReadiness);
                }
                _ => {}
            }
            folded = match (folded, event.kind) {
                (PeriodStatus::Open, PeriodEventKind::Closed) => PeriodStatus::Closed,
                (PeriodStatus::Closed, PeriodEventKind::Reopened) => PeriodStatus::Open,
                (PeriodStatus::Closed, PeriodEventKind::Closed) => {
                    return Err(AttendanceError::PeriodAlreadyClosed);
                }
                (PeriodStatus::Open, PeriodEventKind::Reopened) => {
                    return Err(AttendanceError::PeriodNotClosed);
                }
            };
        }
        if folded != status {
            return Err(match status {
                PeriodStatus::Closed => AttendanceError::PeriodNotClosed,
                PeriodStatus::Open => AttendanceError::PeriodAlreadyClosed,
            });
        }
        Ok(Self {
            place,
            period,
            status,
            history,
        })
    }

    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub const fn period(&self) -> AttendanceMonth {
        self.period
    }
    pub const fn status(&self) -> PeriodStatus {
        self.status
    }
    pub fn history(&self) -> &[PeriodEvent] {
        &self.history
    }
    pub const fn is_closed(&self) -> bool {
        matches!(self.status, PeriodStatus::Closed)
    }

    /// How many times the period has been reopened. A frequently reopened
    /// period is a governance signal, so the count is first-class.
    pub fn reopen_count(&self) -> usize {
        self.history
            .iter()
            .filter(|event| matches!(event.kind, PeriodEventKind::Reopened))
            .count()
    }

    /// Close the period.
    ///
    /// Fails closed when it is already closed, when the key may not close, or
    /// when any blocker remains.
    pub fn close(
        &mut self,
        readiness: CloseReadiness,
        authorization: Authorization,
    ) -> Result<(), AttendanceError> {
        if self.is_closed() {
            return Err(AttendanceError::PeriodAlreadyClosed);
        }
        if !authorization.authorizes_period_close() {
            return Err(AttendanceError::ActionForbidsPeriodOperation {
                action_key: authorization.action_key().to_owned(),
                operation: "close",
            });
        }
        if let Some(blocker) = readiness.blocker() {
            return Err(blocker);
        }
        self.status = PeriodStatus::Closed;
        self.history.push(PeriodEvent {
            kind: PeriodEventKind::Closed,
            readiness: Some(readiness),
            authorization,
        });
        Ok(())
    }

    /// Reopen a closed period — head office's, and never silent.
    ///
    /// A place that could reopen its own sign-off has not signed anything off,
    /// which is why the key differs from the closing one. No readiness is
    /// recorded, because none is taken.
    pub fn reopen(&mut self, authorization: Authorization) -> Result<(), AttendanceError> {
        if !self.is_closed() {
            return Err(AttendanceError::PeriodNotClosed);
        }
        if !authorization.authorizes_period_reopen() {
            return Err(AttendanceError::ActionForbidsPeriodOperation {
                action_key: authorization.action_key().to_owned(),
                operation: "reopen",
            });
        }
        self.status = PeriodStatus::Open;
        self.history.push(PeriodEvent {
            kind: PeriodEventKind::Reopened,
            readiness: None,
            authorization,
        });
        Ok(())
    }

    /// Fail closed unless this date's roster may still be planned or revised.
    pub fn require_accepts_roster_change(
        &self,
        place: &PlaceId,
        date: NaiveDate,
    ) -> Result<(), AttendanceError> {
        self.require_covers(place, date)?;
        if self.is_closed() {
            return Err(AttendanceError::ClosedPeriodRejectsRosterChange {
                period: self.period.to_string(),
            });
        }
        Ok(())
    }

    /// Fail closed unless this period is the one `(place, date)` belongs to.
    ///
    /// Passing *some* real period in place of the right one fails here rather
    /// than passing, which is what makes "load it, never accept it" a rule the
    /// kernel can partly hold up on its own.
    pub fn require_covers(&self, place: &PlaceId, date: NaiveDate) -> Result<(), AttendanceError> {
        if &self.place != place {
            return Err(AttendanceError::PeriodIdentityMismatch);
        }
        if !self.period.contains(date) {
            return Err(AttendanceError::DateOutsidePeriod { date });
        }
        Ok(())
    }

    /// Fail closed unless the period is closed. Payroll needs a frozen
    /// boundary, and this is the question it asks.
    pub fn require_closed(&self) -> Result<(), AttendanceError> {
        if self.is_closed() {
            return Ok(());
        }
        Err(AttendanceError::PeriodNotClosed)
    }
}
