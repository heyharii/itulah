//! The append-only punch log.
//!
//! # Punches are facts, not fields
//!
//! The implementation the reference replaced kept one mutable row per
//! `(employee, date, shift)` and upserted it: a clock-out overwrote the
//! clock-in, a re-scan overwrote the clock-in again, and an approved correction
//! overwrote both. The original observation was gone, so "what did the device
//! actually see?" had no answer.
//!
//! Here a punch is an immutable fact with its own identity. There is no setter,
//! no `UPDATE` path and no removal. Corrections do not touch punches at all —
//! they are a separate append-only overlay in [`super::correction`] — and the
//! derived outcome is recomputed from both, so what the terminal observed and
//! what HR decided stay separately answerable for ever.
//!
//! # There is no outcome in this module
//!
//! No `status`, no `late`, no `absent`. Those are [`super::day`]'s, derived on
//! every read from `(roster day, punches, policy version, approvals,
//! correction)`. This module's whole job is to be sure that the punches it
//! holds really were observed by a device somebody registered.

use super::error::AttendanceError;
use super::ids::{PunchId, TerminalId};
use super::period::AttendancePeriod;
use super::terminal::{AttendanceTerminal, IdentificationMethod, TerminalAttestation};
use super::time::{DayOffset, MinuteOfDay, ShiftPosition};
use crate::cloud::domain::employment::{
    AssignmentTimeline, Employee, EmployeeId, EmploymentStatus, PlaceId,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Which way the punch goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PunchDirection {
    /// Arrival.
    In,
    /// Departure.
    Out,
}

impl PunchDirection {
    pub const fn code(self) -> &'static str {
        match self {
            Self::In => "IN",
            Self::Out => "OUT",
        }
    }

    pub fn parse(code: &str) -> Result<Self, AttendanceError> {
        match code {
            "IN" => Ok(Self::In),
            "OUT" => Ok(Self::Out),
            _ => Err(AttendanceError::PunchProvenanceMismatch { field: "direction" }),
        }
    }
}

impl fmt::Display for PunchDirection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// What the edge knew about its own clock when it recorded the punch.
///
/// A terminal that has been offline for a week has been keeping time on its
/// own. A punch taken under a clock nobody had checked is evidence of a
/// different quality from one taken a second after a time sync, and flattening
/// the two would hide the only signal that says which.
///
/// `Unknown` is a real answer and not a default: it means the node could not
/// tell, which is worth reading differently from a node that said the clock was
/// fine. **Nothing in the derivation reads this.** Lateness is measured in
/// place-local business time against the plan, so a drifting clock cannot
/// manufacture a penalty; the value is here so a person auditing a month can
/// see which days to distrust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClockQuality {
    /// The node had a recently synchronised clock.
    Ok,
    /// The node knew its clock had drifted.
    Drift,
    /// The node could not say.
    Unknown,
}

impl ClockQuality {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Ok => "OK",
            Self::Drift => "DRIFT",
            Self::Unknown => "UNKNOWN",
        }
    }

    pub fn parse(code: &str) -> Result<Self, AttendanceError> {
        match code {
            "OK" => Ok(Self::Ok),
            "DRIFT" => Ok(Self::Drift),
            "UNKNOWN" => Ok(Self::Unknown),
            _ => Err(AttendanceError::UnreadableClockQuality {
                code: code.to_owned(),
            }),
        }
    }
}

impl fmt::Display for ClockQuality {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// Where a punch sits in place-local business time: the business date it is
/// filed under, plus a clock reading that may fall after midnight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PunchTime {
    business_date: NaiveDate,
    day_offset: DayOffset,
    minute: MinuteOfDay,
}

impl PunchTime {
    pub const fn new(business_date: NaiveDate, day_offset: DayOffset, minute: MinuteOfDay) -> Self {
        Self {
            business_date,
            day_offset,
            minute,
        }
    }

    /// A reading on the business date itself — the ordinary case, spelled out
    /// so a caller with no overnight shift is not made to think about offsets.
    pub const fn same_day(business_date: NaiveDate, minute: MinuteOfDay) -> Self {
        Self::new(business_date, DayOffset::SAME_DAY, minute)
    }

    /// The business date the punch belongs to — the roster day it answers,
    /// which for an overnight shift is the day the shift *started*.
    pub const fn business_date(self) -> NaiveDate {
        self.business_date
    }
    pub const fn day_offset(self) -> DayOffset {
        self.day_offset
    }
    pub const fn minute(self) -> MinuteOfDay {
        self.minute
    }

    /// The position on the business date's shift timeline, which is what makes
    /// "how late" subtraction rather than date arithmetic.
    pub const fn position(self) -> ShiftPosition {
        ShiftPosition::new(self.day_offset, self.minute)
    }
}

impl fmt::Display for PunchTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.day_offset == DayOffset::NEXT_DAY {
            return write!(f, "{} {}+1", self.business_date, self.minute);
        }
        write!(f, "{} {}", self.business_date, self.minute)
    }
}

/// One immutable punch.
///
/// Construction requires a [`TerminalAttestation`], so every punch in existence
/// was produced by a registered, active terminal that identified the employee.
/// There is no other constructor — see [`super::terminal`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Punch {
    id: PunchId,
    employee: EmployeeId,
    place: PlaceId,
    terminal: TerminalId,
    method: IdentificationMethod,
    direction: PunchDirection,
    at: PunchTime,
    recorded_at: DateTime<Utc>,
    clock_quality: ClockQuality,
}

/// The inert transport form of a punch that was already recorded.
///
/// This is what a database row or a sync payload deserializes into. It carries
/// **no authority**: holding one proves nothing, it is not a [`Punch`], and it
/// cannot be used anywhere a `Punch` is required. The only thing it can do is
/// be offered to [`Punch::rehydrate`], which re-derives the punch from live
/// records or refuses.
///
/// The fields are public because there is nothing to protect here. That is the
/// whole trick: the deserializable type is the one with no rules, and the type
/// with the rules has no deserializer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistedPunch {
    pub id: PunchId,
    pub employee: EmployeeId,
    pub place: PlaceId,
    pub terminal: TerminalId,
    pub method: IdentificationMethod,
    pub direction: PunchDirection,
    pub at: PunchTime,
    pub recorded_at: DateTime<Utc>,
    pub clock_quality: ClockQuality,
}

/// The facts a **new** punch is checked against.
///
/// Grouped into one value so the checks travel together: a caller cannot supply
/// an employment record without also supplying the posting timeline and the
/// period that must agree with it.
///
/// All three are **trusted context** — loaded by the handler, never accepted
/// from a request body. A payload that could carry its own period would carry
/// its own answer to "is this month still open".
#[derive(Debug, Clone, Copy)]
pub struct PunchContext<'a> {
    /// The employment record whose status must permit attendance.
    pub employee: &'a Employee,
    /// That employee's effective-dated posting timeline.
    pub assignment: &'a AssignmentTimeline,
    /// The `(place, month)` close state the business date falls in.
    pub period: &'a AttendancePeriod,
}

impl Punch {
    /// Record a punch from a terminal attestation.
    ///
    /// Every one of the following must hold, each with its own typed refusal:
    ///
    /// * the attestation names the context's employee — a terminal cannot punch
    ///   for somebody it did not identify;
    /// * the employment status **on the punch's business date** permits
    ///   attendance (`ACTIVE` only) — not the status now, so a punch replayed
    ///   from a terminal that was offline for a week is judged by the day it
    ///   happened;
    /// * the employee was posted to the attesting terminal's place **on that
    ///   business date** — the effective-dated timeline decides, never a
    ///   current location field;
    /// * the `(place, month)` the date falls in is open.
    pub fn record(
        id: PunchId,
        attestation: &TerminalAttestation,
        direction: PunchDirection,
        at: PunchTime,
        recorded_at: DateTime<Utc>,
        clock_quality: ClockQuality,
        context: PunchContext<'_>,
    ) -> Result<Self, AttendanceError> {
        let PunchContext {
            employee,
            assignment,
            period,
        } = context;
        if attestation.employee() != employee.id() {
            return Err(AttendanceError::AttestationEmployeeMismatch);
        }
        let status = employee.status_on(at.business_date());
        if status != EmploymentStatus::Active {
            return Err(AttendanceError::EmploymentForbidsAttendance {
                status: status.code(),
                date: at.business_date(),
            });
        }
        if assignment.place_on(at.business_date()) != Some(attestation.place()) {
            return Err(AttendanceError::NotPostedToPlaceOnDate {
                date: at.business_date(),
            });
        }
        period.require_covers(attestation.place(), at.business_date())?;
        if period.is_closed() {
            return Err(AttendanceError::ClosedPeriodRejectsPunch {
                period: period.period().to_string(),
            });
        }
        Ok(Self {
            id,
            employee: employee.id().clone(),
            place: attestation.place().clone(),
            terminal: attestation.terminal().clone(),
            method: attestation.method(),
            direction,
            at,
            recorded_at,
            clock_quality,
        })
    }

    /// Rebuild a punch this kernel previously produced and something else
    /// persisted, revalidating its provenance.
    ///
    /// # Why this exists, and why it is not `Deserialize`
    ///
    /// [`Punch`] has no `Deserialize`, no public fields and no constructor from
    /// raw parts, because a punch anybody can type out is exactly the authority
    /// hole this module exists to close. But punches must come back out of a
    /// database, and "no way back in" would mean either giving up the type or
    /// quietly adding `Deserialize` later and losing the property.
    ///
    /// So the way back in is this function, and it is not a trust transfer. A
    /// [`PersistedPunch`] is inert data; it becomes a `Punch` only if the
    /// *live* records still agree with it — the terminal it names is registered,
    /// at the place the punch claims, performing the method the punch claims,
    /// and the posting timeline still places the employee there on that date.
    ///
    /// # Rehydration re-checks provenance, never eligibility
    ///
    /// Two checks are deliberately *not* made, and their absence is the point.
    /// Each is a rule about whether a punch **may be created**; rehydration
    /// creates nothing.
    ///
    /// * the terminal's **current** status is not consulted. A punch taken by a
    ///   device later suspended or revoked really happened and must still load.
    /// * the period's close state is not consulted, which is why this takes no
    ///   [`AttendancePeriod`] at all. Refusing a read for a closed month would
    ///   make settled periods unreadable, which is the opposite of what closing
    ///   means.
    ///
    /// Employment status on the date is not re-adjudicated either, and that one
    /// is worth spelling out: employment history is effective-dated and can be
    /// written **backwards**. A termination recorded today with an effective
    /// date in March changes [`Employee::status_on`] for days that were ACTIVE
    /// when the terminal observed them. If rehydration asked that question,
    /// every punch already stored for those days would become permanently
    /// unloadable — a backdated HR decision would delete attendance history by
    /// making it impossible to read, which is the overwritten-row defect
    /// arriving by a different door.
    ///
    /// Nothing is lost by not asking. The status check was never a forgery
    /// gate: a fabricated row would simply carry a date inside an eligible
    /// window, and what actually stops fabrication is the terminal provenance
    /// check above.
    pub fn rehydrate(
        record: PersistedPunch,
        terminal: &AttendanceTerminal,
        employee: &Employee,
        assignment: &AssignmentTimeline,
    ) -> Result<Self, AttendanceError> {
        if &record.employee != employee.id() {
            return Err(AttendanceError::PunchProvenanceMismatch { field: "employee" });
        }
        terminal.require_persisted_provenance(&record.terminal, &record.place, record.method)?;
        if assignment.place_on(record.at.business_date()) != Some(&record.place) {
            return Err(AttendanceError::NotPostedToPlaceOnDate {
                date: record.at.business_date(),
            });
        }
        Ok(Self {
            id: record.id,
            employee: record.employee,
            place: record.place,
            terminal: record.terminal,
            method: record.method,
            direction: record.direction,
            at: record.at,
            recorded_at: record.recorded_at,
            clock_quality: record.clock_quality,
        })
    }

    /// The transport form: the same fields, with no authority. Persisting is a
    /// lossless projection; getting one back goes through
    /// [`Punch::rehydrate`].
    pub fn to_persisted(&self) -> PersistedPunch {
        PersistedPunch {
            id: self.id.clone(),
            employee: self.employee.clone(),
            place: self.place.clone(),
            terminal: self.terminal.clone(),
            method: self.method,
            direction: self.direction,
            at: self.at,
            recorded_at: self.recorded_at,
            clock_quality: self.clock_quality,
        }
    }

    pub fn id(&self) -> &PunchId {
        &self.id
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn terminal(&self) -> &TerminalId {
        &self.terminal
    }
    pub const fn method(&self) -> IdentificationMethod {
        self.method
    }
    pub const fn direction(&self) -> PunchDirection {
        self.direction
    }
    pub const fn at(&self) -> PunchTime {
        self.at
    }
    pub const fn business_date(&self) -> NaiveDate {
        self.at.business_date()
    }
    /// The instant the device claimed. **No rule reads this** — see
    /// [`ClockQuality`].
    pub const fn recorded_at(&self) -> DateTime<Utc> {
        self.recorded_at
    }
    pub const fn clock_quality(&self) -> ClockQuality {
        self.clock_quality
    }
}

/// An append-only log of punches for one place.
///
/// The API is deliberately narrow — [`PunchLog::append`] and read-only views —
/// so "append-only" is a property of the type rather than a rule in a document.
/// There is no `remove`, no `get_mut`, and no way to reach a mutable [`Punch`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PunchLog {
    place: PlaceId,
    punches: Vec<Punch>,
}

impl PunchLog {
    pub fn new(place: PlaceId) -> Self {
        Self {
            place,
            punches: Vec::new(),
        }
    }

    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn punches(&self) -> &[Punch] {
        &self.punches
    }
    pub fn len(&self) -> usize {
        self.punches.len()
    }
    pub fn is_empty(&self) -> bool {
        self.punches.is_empty()
    }

    /// Append one punch.
    ///
    /// Refuses a punch from another place and a repeated [`PunchId`]. The
    /// duplicate-identity check is what makes an offline terminal's retry safe:
    /// the node may deliver the same punch any number of times, and only the
    /// first delivery lands.
    pub fn append(&mut self, punch: Punch) -> Result<&Punch, AttendanceError> {
        if punch.place != self.place {
            return Err(AttendanceError::PunchPlaceMismatch);
        }
        if self.punches.iter().any(|held| held.id == punch.id) {
            return Err(AttendanceError::DuplicatePunchIdentity);
        }
        self.punches.push(punch);
        self.punches
            .last()
            .ok_or(AttendanceError::DuplicatePunchIdentity)
    }

    /// Idempotent append: `Ok(false)` when this identity is already present.
    ///
    /// What the sync applier calls, because a redelivered batch is the normal
    /// case rather than an error.
    pub fn append_if_absent(&mut self, punch: Punch) -> Result<bool, AttendanceError> {
        match self.append(punch) {
            Ok(_) => Ok(true),
            Err(AttendanceError::DuplicatePunchIdentity) => Ok(false),
            Err(other) => Err(other),
        }
    }

    /// One employee's punches on one business date, in canonical derivation
    /// order: business time, then the audit instant, then identity.
    ///
    /// A **total** order, so derivation is deterministic even when two punches
    /// share a minute — which they do, whenever somebody taps twice.
    pub fn day(&self, employee: &EmployeeId, date: NaiveDate) -> Vec<&Punch> {
        let mut day: Vec<&Punch> = self
            .punches
            .iter()
            .filter(|punch| &punch.employee == employee && punch.business_date() == date)
            .collect();
        day.sort_by(|a, b| canonical_order(a, b));
        day
    }
}

/// The one canonical ordering of punches, shared by the log and the
/// derivation so the two cannot drift.
pub(super) fn canonical_order(a: &Punch, b: &Punch) -> std::cmp::Ordering {
    a.at()
        .position()
        .cmp(&b.at().position())
        .then_with(|| a.recorded_at().cmp(&b.recorded_at()))
        .then_with(|| a.id().cmp(b.id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::attendance::terminal::TerminalStatus;
    use crate::cloud::domain::attendance::time::AttendanceMonth;
    use crate::cloud::domain::employment::{
        actions, AssignmentSpan, Authorization, EmployeeCode, EmploymentTransition,
    };
    use chrono::TimeZone;

    fn authority(action_key: &str) -> Authorization {
        Authorization::try_new(
            "hr.officer",
            action_key,
            Utc.with_ymd_and_hms(2026, 9, 1, 8, 0, 0).unwrap(),
            "because the shop opened",
        )
        .expect("authorization")
    }

    fn date(iso: &str) -> NaiveDate {
        iso.parse().expect("date")
    }

    fn terminal() -> AttendanceTerminal {
        AttendanceTerminal::register(
            TerminalId::try_new("term-07").unwrap(),
            PlaceId::try_new("store-07").unwrap(),
            "Pintu belakang",
            IdentificationMethod::Fingerprint,
            authority(actions::ATTENDANCE_TERMINAL_MANAGE),
        )
        .expect("register")
    }

    fn active_employee() -> Employee {
        let mut employee = Employee::register(
            EmployeeId::try_new("emp-1").unwrap(),
            EmployeeCode::try_new("0001").unwrap(),
        );
        employee
            .apply(
                EmploymentTransition::Hire,
                date("2026-01-01"),
                authority(actions::EMPLOYMENT_CHANGE),
            )
            .expect("hire");
        employee
    }

    fn posted_to(place: &str) -> AssignmentTimeline {
        let mut timeline = AssignmentTimeline::new();
        timeline
            .push(
                AssignmentSpan::try_new(
                    PlaceId::try_new(place).unwrap(),
                    date("2026-01-01"),
                    None,
                    authority(actions::ASSIGNMENT_MANAGE),
                )
                .expect("span"),
            )
            .expect("push");
        timeline
    }

    fn open_period() -> AttendancePeriod {
        AttendancePeriod::open(
            PlaceId::try_new("store-07").unwrap(),
            AttendanceMonth::try_new(2026, 9).unwrap(),
        )
    }

    fn punch_at(minute: u16, direction: PunchDirection) -> Result<Punch, AttendanceError> {
        let terminal = terminal();
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let period = open_period();
        Punch::record(
            PunchId::try_new(&format!("p-{minute}-{}", direction.code())).unwrap(),
            &terminal.attest(employee.id().clone()).expect("attest"),
            direction,
            PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(minute).unwrap()),
            Utc.with_ymd_and_hms(2026, 9, 14, 1, 0, 0).unwrap(),
            ClockQuality::Ok,
            PunchContext {
                employee: &employee,
                assignment: &assignment,
                period: &period,
            },
        )
    }

    #[test]
    fn a_registered_terminal_produces_a_punch() {
        let punch = punch_at(8 * 60, PunchDirection::In).expect("record");
        assert_eq!(punch.place().as_str(), "store-07");
        assert_eq!(punch.direction(), PunchDirection::In);
        assert_eq!(punch.at().position().minutes(), 480);
    }

    /// A terminal cannot punch for somebody it did not identify. Without this
    /// the attestation would be decoration.
    #[test]
    fn a_terminal_cannot_punch_for_somebody_else() {
        let terminal = terminal();
        let other = Employee::register(
            EmployeeId::try_new("emp-2").unwrap(),
            EmployeeCode::try_new("0002").unwrap(),
        );
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let period = open_period();
        let refused = Punch::record(
            PunchId::try_new("p-x").unwrap(),
            &terminal.attest(other.id().clone()).expect("attest"),
            PunchDirection::In,
            PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(480).unwrap()),
            Utc::now(),
            ClockQuality::Ok,
            PunchContext {
                employee: &employee,
                assignment: &assignment,
                period: &period,
            },
        );
        assert!(matches!(
            refused,
            Err(AttendanceError::AttestationEmployeeMismatch)
        ));
    }

    /// The posting decides which place's log a punch belongs in, and it is the
    /// effective-dated timeline that answers — never a current location field.
    #[test]
    fn a_punch_at_a_place_the_person_is_not_posted_to_is_refused() {
        let terminal = terminal();
        let employee = active_employee();
        let assignment = posted_to("store-03");
        let period = open_period();
        let refused = Punch::record(
            PunchId::try_new("p-x").unwrap(),
            &terminal.attest(employee.id().clone()).expect("attest"),
            PunchDirection::In,
            PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(480).unwrap()),
            Utc::now(),
            ClockQuality::Ok,
            PunchContext {
                employee: &employee,
                assignment: &assignment,
                period: &period,
            },
        );
        assert!(matches!(
            refused,
            Err(AttendanceError::NotPostedToPlaceOnDate { .. })
        ));
    }

    /// A settled month takes no new facts. This is the payroll gate, and it is
    /// the reason the period is loaded rather than accepted from a body.
    #[test]
    fn a_closed_month_takes_no_punch() {
        let terminal = terminal();
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let mut period = open_period();
        period
            .close(
                super::super::period::CloseReadiness::CLEAR,
                authority(actions::ATTENDANCE_PERIOD_CLOSE),
            )
            .expect("close");
        let refused = Punch::record(
            PunchId::try_new("p-late").unwrap(),
            &terminal.attest(employee.id().clone()).expect("attest"),
            PunchDirection::In,
            PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(480).unwrap()),
            Utc::now(),
            ClockQuality::Ok,
            PunchContext {
                employee: &employee,
                assignment: &assignment,
                period: &period,
            },
        );
        assert!(matches!(
            refused,
            Err(AttendanceError::ClosedPeriodRejectsPunch { .. })
        ));
    }

    /// The property the whole offline design rests on: redelivery is free.
    #[test]
    fn redelivering_a_punch_lands_once() {
        let mut log = PunchLog::new(PlaceId::try_new("store-07").unwrap());
        let punch = punch_at(8 * 60, PunchDirection::In).expect("record");
        assert!(log.append_if_absent(punch.clone()).expect("first"));
        assert!(!log.append_if_absent(punch).expect("second"));
        assert_eq!(log.len(), 1);
    }

    /// Rehydration re-checks the device, so a row naming a terminal that never
    /// existed — or one at another place — does not become a punch.
    #[test]
    fn a_stored_punch_must_still_be_explained_by_its_terminal() {
        let punch = punch_at(8 * 60, PunchDirection::In).expect("record");
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let elsewhere = AttendanceTerminal::register(
            TerminalId::try_new("term-03").unwrap(),
            PlaceId::try_new("store-03").unwrap(),
            "Depan",
            IdentificationMethod::Fingerprint,
            authority(actions::ATTENDANCE_TERMINAL_MANAGE),
        )
        .expect("register");
        assert!(matches!(
            Punch::rehydrate(punch.to_persisted(), &elsewhere, &employee, &assignment),
            Err(AttendanceError::PunchProvenanceMismatch { .. })
        ));
        // The right terminal loads it back unchanged.
        let terminal = terminal();
        let reloaded = Punch::rehydrate(punch.to_persisted(), &terminal, &employee, &assignment)
            .expect("rehydrate");
        assert_eq!(reloaded, punch);
    }

    /// Revoking a device is not a way to delete history. A punch it took
    /// before the revocation still happened and must still load.
    #[test]
    fn a_revoked_terminal_still_explains_the_punches_it_took() {
        let punch = punch_at(8 * 60, PunchDirection::In).expect("record");
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let mut terminal = terminal();
        terminal
            .transition(
                TerminalStatus::Revoked,
                authority(actions::ATTENDANCE_TERMINAL_MANAGE),
            )
            .expect("revoke");
        assert!(Punch::rehydrate(punch.to_persisted(), &terminal, &employee, &assignment).is_ok());
        // But it attests nothing new.
        assert!(terminal.attest(employee.id().clone()).is_err());
    }

    /// Derivation must not depend on delivery order, so the log's day view is
    /// a total order. Two punches in the same minute still sort the same way
    /// on every machine.
    #[test]
    fn the_day_view_is_a_total_order() {
        let mut log = PunchLog::new(PlaceId::try_new("store-07").unwrap());
        log.append(punch_at(17 * 60, PunchDirection::Out).expect("out"))
            .expect("append");
        log.append(punch_at(8 * 60, PunchDirection::In).expect("in"))
            .expect("append");
        let employee = EmployeeId::try_new("emp-1").unwrap();
        let day = log.day(&employee, date("2026-09-14"));
        assert_eq!(day.len(), 2);
        assert_eq!(day[0].direction(), PunchDirection::In);
        assert_eq!(day[1].direction(), PunchDirection::Out);
    }
}
