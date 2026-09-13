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
    AssignmentTimeline, Authorization, Employee, EmployeeId, EmploymentStatus, PlaceId,
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

/// What kind of thing produced a punch.
///
/// # Two sources, named for ever, and why that matters more than it looks
///
/// The owner's decision of 2026-09-13 is a fingerprint station per unit, no PIN
/// and no card, reaffirmed twice. Nothing has been bought, so today nobody can
/// clock in anywhere and the whole HR month has no input to be exercised
/// against; he asked for attendance in the employee app so the flow can be
/// walked end to end before the readers arrive.
///
/// That is a second source, and the decision above did not contemplate one. The
/// two are **not the same evidence**: a terminal punch was witnessed by a device
/// somebody installed and registered, and a phone punch was not witnessed by
/// anything. Flattening them would make "did a finger produce this, or a phone?"
/// unanswerable on the day the readers arrive — which is precisely the defect
/// the implementation this kernel replaced had, where the punch endpoint took
/// `source` as free text and **defaulted it to `fingerprint`**.
///
/// So it is a closed vocabulary with a wire code and a column (migration
/// `0239`), and adding a third is a typed decision with a migration rather than
/// a string that appears in a database one afternoon. Retiring [`EmployeeApp`]
/// later means refusing new rows of it; the ones already stored stay readable
/// and stay honest about what they are.
///
/// [`EmployeeApp`]: Self::EmployeeApp
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PunchSource {
    /// A registered, active station at the unit identified the person.
    Terminal,
    /// The person themselves, signed in, in the employee app. **Nothing saw
    /// them arrive.**
    EmployeeApp,
}

impl PunchSource {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Terminal => "TERMINAL",
            Self::EmployeeApp => "EMPLOYEE_APP",
        }
    }

    /// An error rather than an `Option`, like [`IdentificationMethod::parse`]:
    /// every caller is about to decide whether a stored punch's provenance
    /// holds, and a source this build cannot read must fail the row rather than
    /// pass it as some other source.
    pub fn parse(code: &str) -> Result<Self, AttendanceError> {
        match code {
            "TERMINAL" => Ok(Self::Terminal),
            "EMPLOYEE_APP" => Ok(Self::EmployeeApp),
            _ => Err(AttendanceError::UnreadablePunchSource {
                code: code.to_owned(),
            }),
        }
    }
}

impl fmt::Display for PunchSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

/// The provenance of one punch: its source, and whatever that source implies.
///
/// An enum rather than a source code beside a nullable terminal, because the
/// halves belong together. A terminal punch naming no station, and a phone punch
/// naming one, are both nonsense — and the halfway row is the thing a reader two
/// years from now would have to guess about. Here neither is representable, and
/// `0239`'s `punch_provenance_matches_source` says the same thing in the
/// database so a row edited by hand fails to hydrate rather than becoming
/// attendance.
///
/// [`IdentificationMethod`] lives on the terminal variant rather than on the
/// punch because that is what it always described: how the identification was
/// performed *at the station*. A phone punch has no identification to describe,
/// so the honest answer is its absence rather than a widened vocabulary with a
/// `SELF_SERVICE` value in it — which would have quietly made a phone tap
/// indistinguishable from a reading in every query that filters on `method`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PunchProvenance {
    /// A registered station, at the punch's place, performing its own method.
    Terminal {
        terminal: TerminalId,
        method: IdentificationMethod,
    },
    /// The employee app. It carries nothing further, and that is the point:
    /// there is no device to name, so the source itself is the whole of the
    /// provenance.
    EmployeeApp,
}

impl PunchProvenance {
    pub const fn source(&self) -> PunchSource {
        match self {
            Self::Terminal { .. } => PunchSource::Terminal,
            Self::EmployeeApp => PunchSource::EmployeeApp,
        }
    }

    /// The station that took it, for the sources that have one.
    pub const fn terminal(&self) -> Option<&TerminalId> {
        match self {
            Self::Terminal { terminal, .. } => Some(terminal),
            Self::EmployeeApp => None,
        }
    }

    pub const fn method(&self) -> Option<IdentificationMethod> {
        match self {
            Self::Terminal { method, .. } => Some(*method),
            Self::EmployeeApp => None,
        }
    }
}

/// Proof that a signed-in person asked to record their **own** arrival.
///
/// # Why this exists, and what it deliberately is not
///
/// It is the employee app's counterpart to [`TerminalAttestation`], and the
/// difference between the two names is the difference in the evidence. An
/// attestation is a device saying "I identified this person here". A *claim* is
/// a person saying "I am here", and nothing corroborates it. Calling it an
/// attestation would have made the two look alike at every call site, which is
/// the one thing this pair of types exists to prevent.
///
/// The shape is the same, though, and for the same reason: private fields, no
/// public constructor, no `Deserialize`, no `Default`. A claim can only come
/// from [`SelfPunchClaim::make`], which refuses unless the [`Authorization`] it
/// is handed carries `people.attendance_punch.record_own`. So "a punch from the
/// app requires the self-service grant" is a property of the type rather than a
/// check a handler could forget.
///
/// # The bound this type cannot express, and where it lives instead
///
/// That the claim is about the *caller's own* record is not checkable here: an
/// [`Authorization`]'s actor is a login name and an [`EmployeeId`] is an
/// employment record, and the binding between them is HR data. So the handler
/// applies it — `Access::own`, exactly as `file_correction` chooses between the
/// own and the on-behalf-of correction keys — and this type holds the half that
/// is checkable: the grant. The same division as
/// `actions::CORRECTION_REQUEST_OWN`, whose bound is likewise the record rather
/// than the rung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SelfPunchClaim {
    employee: EmployeeId,
    place: PlaceId,
    authorization: Authorization,
}

impl SelfPunchClaim {
    /// Make a claim, refusing any authority that does not carry the
    /// self-service punch key.
    ///
    /// The place is the caller's **posting**, resolved by the handler from the
    /// effective-dated assignment timeline, and never a body field. A caller
    /// who could name their own place could file a day's work at a shop they
    /// have never been posted to — and `Punch::claim_own` re-checks the posting
    /// on the punch's own business date anyway, so a claim that named somewhere
    /// else would be refused twice.
    pub fn make(
        employee: EmployeeId,
        place: PlaceId,
        authorization: Authorization,
    ) -> Result<Self, AttendanceError> {
        if !authorization.authorizes_own_punch() {
            return Err(AttendanceError::ActionForbidsOwnPunch {
                action_key: authorization.action_key().to_owned(),
            });
        }
        Ok(Self {
            employee,
            place,
            authorization,
        })
    }

    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    /// Who claimed it, under which key, when, and why.
    ///
    /// Kept on the claim and **not persisted with the punch**: `0239` adds a
    /// source column and no actor column, because on this route the actor is
    /// the person the row is already about — the handler serves the key only
    /// for the caller's own record. What the punch keeps is the fact that a
    /// phone produced it, which is the part a later reader cannot recover from
    /// anywhere else.
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }

    /// The identity this punch will have, **derived** from what it is rather
    /// than minted.
    ///
    /// # This is the idempotency, and it is the terminal path's own mechanism
    ///
    /// A station's punch carries an id minted at the edge, and redelivery is
    /// free because the identity collides: `ON CONFLICT (id) DO NOTHING`, and
    /// only the first delivery lands. A phone has no such id to offer — and must
    /// not be asked for one, because an id a client chooses is an id a client
    /// can choose *twice differently*, which is the same double tap wearing two
    /// identities.
    ///
    /// So the centre derives it from the punch's own content: the person, the
    /// business minute it falls in, and the direction. A second tap while the
    /// first request is still in flight, a retry on a dropped connection, and a
    /// thumb resting on the button all produce the same id and therefore one
    /// row — by exactly the mechanism that already makes an offline node's
    /// redelivery safe, rather than a lock or a de-duplication window the
    /// storage layer would have to learn about.
    ///
    /// A tap in the *next* minute is a different punch and does land, which is
    /// right: two readings a minute apart are two observations. Whether they
    /// amount to one arrival is [`super::day`]'s question, and it already folds
    /// readings closer together than the policy's
    /// `duplicate_punch_window_minutes`.
    fn punch_id(
        &self,
        at: PunchTime,
        direction: PunchDirection,
    ) -> Result<PunchId, AttendanceError> {
        PunchId::try_new(&format!(
            "app-{}-{}{}-{:04}-{}",
            self.employee,
            at.business_date().format("%Y%m%d"),
            at.day_offset().days(),
            at.minute().minutes(),
            direction.code(),
        ))
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
/// Construction requires evidence, and there are exactly **two** kinds of it:
/// a [`TerminalAttestation`], which only a registered active station produces
/// (see [`super::terminal`]), or a [`SelfPunchClaim`], which only the
/// self-service grant produces. There is no third constructor and no way to
/// build one from raw fields, so every punch in existence names which of the two
/// it came from — see [`PunchSource`] for why those two must never blur.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Punch {
    id: PunchId,
    employee: EmployeeId,
    place: PlaceId,
    provenance: PunchProvenance,
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
    /// The source and whatever it implies, as one value. A row whose columns
    /// say `EMPLOYEE_APP` and also name a station cannot be assembled into this
    /// field at all, which is where `0239`'s check constraint is re-stated in
    /// Rust — the same arrangement as a correction's `state` and the decision
    /// beside it.
    pub provenance: PunchProvenance,
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
        if attestation.employee() != context.employee.id() {
            return Err(AttendanceError::AttestationEmployeeMismatch);
        }
        Self::require_eligible(attestation.place(), at, context)?;
        Ok(Self {
            id,
            employee: context.employee.id().clone(),
            place: attestation.place().clone(),
            provenance: PunchProvenance::Terminal {
                terminal: attestation.terminal().clone(),
                method: attestation.method(),
            },
            direction,
            at,
            recorded_at,
            clock_quality,
        })
    }

    /// Record a punch somebody made about their own day, from the employee app.
    ///
    /// # Every eligibility rule above still applies
    ///
    /// The employment status **on the business date**, the posting **on that
    /// date**, and the `(place, month)` being open are checked by exactly the
    /// same code as [`Punch::record`] — see [`Punch::require_eligible`]. A
    /// second source must not be a second set of rules; the only thing that
    /// differs is the evidence, and the row says which evidence it was.
    ///
    /// # There is no `clock_quality` parameter, and no `recorded_at` from a
    /// client
    ///
    /// [`ClockQuality`] answers "how much did the recorder know about its own
    /// clock". A station that has been offline for a week is keeping time on
    /// its own and says so. Here the recorder is the **centre**, stamping its
    /// own clock in the same request, so the quality is
    /// [`ClockQuality::Ok`] by construction rather than a value anybody
    /// claimed — and `recorded_at` is the server's instant, passed in by the
    /// handler so this stays a pure function.
    ///
    /// A client-supplied instant is a client that can choose when it arrived,
    /// which is the whole reason `IncomingPunch::recorded_at` carries the note
    /// that no rule reads it. Here there is no field to lie in.
    ///
    /// # There is no `id` parameter either
    ///
    /// It is derived from the punch's own content — see
    /// [`SelfPunchClaim::punch_id`] — so a double tap lands once by identity
    /// collision, the way a node's redelivery already does. Taking an id here
    /// would mean a caller could send the same tap twice under two identities,
    /// and no amount of care in the handler would close that.
    pub fn claim_own(
        claim: &SelfPunchClaim,
        direction: PunchDirection,
        at: PunchTime,
        recorded_at: DateTime<Utc>,
        context: PunchContext<'_>,
    ) -> Result<Self, AttendanceError> {
        if claim.employee() != context.employee.id() {
            return Err(AttendanceError::ClaimEmployeeMismatch);
        }
        Self::require_eligible(claim.place(), at, context)?;
        Ok(Self {
            id: claim.punch_id(at, direction)?,
            employee: context.employee.id().clone(),
            place: claim.place().clone(),
            provenance: PunchProvenance::EmployeeApp,
            direction,
            at,
            recorded_at,
            clock_quality: ClockQuality::Ok,
        })
    }

    /// The rules that decide whether attendance may be recorded at all, shared
    /// by both sources.
    ///
    /// One function rather than two copies, because a second source that drifted
    /// into a second set of eligibility rules is how a closed month ends up
    /// taking a punch through the newer door. The three questions are the same
    /// three: was this person employed on that day, were they posted to this
    /// place on that day, and is that month still open.
    fn require_eligible(
        place: &PlaceId,
        at: PunchTime,
        context: PunchContext<'_>,
    ) -> Result<(), AttendanceError> {
        let PunchContext {
            employee,
            assignment,
            period,
        } = context;
        let status = employee.status_on(at.business_date());
        if status != EmploymentStatus::Active {
            return Err(AttendanceError::EmploymentForbidsAttendance {
                status: status.code(),
                date: at.business_date(),
            });
        }
        if assignment.place_on(at.business_date()) != Some(place) {
            return Err(AttendanceError::NotPostedToPlaceOnDate {
                date: at.business_date(),
            });
        }
        period.require_covers(place, at.business_date())?;
        if period.is_closed() {
            return Err(AttendanceError::ClosedPeriodRejectsPunch {
                period: period.period().to_string(),
            });
        }
        Ok(())
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
    /// `terminal` is `Some` for exactly the rows whose source is a terminal.
    ///
    /// Not "the terminal if the caller happened to load one": an
    /// [`PunchSource::EmployeeApp`] row offered a station, or a
    /// [`PunchSource::Terminal`] row offered none, is refused as a provenance
    /// mismatch rather than loaded with the mismatch ignored. The alternative —
    /// taking the terminal when it is there and shrugging when it is not —
    /// would make a phone punch that somebody pointed at a real station load as
    /// a fingerprint reading, which is the one outcome the source column exists
    /// to prevent.
    ///
    /// A phone punch's provenance is re-checked as far as it can be, which is
    /// the posting: nothing else was recorded, because nothing else was
    /// observed.
    pub fn rehydrate(
        record: PersistedPunch,
        terminal: Option<&AttendanceTerminal>,
        employee: &Employee,
        assignment: &AssignmentTimeline,
    ) -> Result<Self, AttendanceError> {
        if &record.employee != employee.id() {
            return Err(AttendanceError::PunchProvenanceMismatch { field: "employee" });
        }
        match (&record.provenance, terminal) {
            (PunchProvenance::Terminal { terminal: id, method }, Some(station)) => {
                station.require_persisted_provenance(id, &record.place, *method)?;
            }
            (PunchProvenance::EmployeeApp, None) => {}
            (PunchProvenance::Terminal { .. }, None) | (PunchProvenance::EmployeeApp, Some(_)) => {
                return Err(AttendanceError::PunchProvenanceMismatch { field: "source" })
            }
        }
        if assignment.place_on(record.at.business_date()) != Some(&record.place) {
            return Err(AttendanceError::NotPostedToPlaceOnDate {
                date: record.at.business_date(),
            });
        }
        Ok(Self {
            id: record.id,
            employee: record.employee,
            place: record.place,
            provenance: record.provenance,
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
            provenance: self.provenance.clone(),
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
    pub const fn provenance(&self) -> &PunchProvenance {
        &self.provenance
    }
    /// Which kind of thing produced this punch. Never inferred from the absence
    /// of a terminal — see [`PunchSource`].
    pub const fn source(&self) -> PunchSource {
        self.provenance.source()
    }
    /// The station that took it, and `None` for a punch no station took.
    pub const fn terminal(&self) -> Option<&TerminalId> {
        self.provenance.terminal()
    }
    pub const fn method(&self) -> Option<IdentificationMethod> {
        self.provenance.method()
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
            Punch::rehydrate(punch.to_persisted(), Some(&elsewhere), &employee, &assignment),
            Err(AttendanceError::PunchProvenanceMismatch { .. })
        ));
        // The right terminal loads it back unchanged.
        let terminal = terminal();
        let reloaded = Punch::rehydrate(punch.to_persisted(), Some(&terminal), &employee, &assignment)
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
        assert!(
            Punch::rehydrate(punch.to_persisted(), Some(&terminal), &employee, &assignment).is_ok()
        );
        // But it attests nothing new.
        assert!(terminal.attest(employee.id().clone()).is_err());
    }

    // ── the second source ────────────────────────────────────────────────

    fn claim(place: &str) -> SelfPunchClaim {
        SelfPunchClaim::make(
            EmployeeId::try_new("emp-1").unwrap(),
            PlaceId::try_new(place).unwrap(),
            Authorization::try_new(
                "store07.kasir",
                actions::ATTENDANCE_PUNCH_RECORD_OWN,
                Utc.with_ymd_and_hms(2026, 9, 14, 1, 0, 0).unwrap(),
                "masuk kerja",
            )
            .expect("authorization"),
        )
        .expect("claim")
    }

    fn app_punch(minute: u16, direction: PunchDirection) -> Result<Punch, AttendanceError> {
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let period = open_period();
        Punch::claim_own(
            &claim("store-07"),
            direction,
            PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(minute).unwrap()),
            Utc.with_ymd_and_hms(2026, 9, 14, 1, 0, 0).unwrap(),
            PunchContext {
                employee: &employee,
                assignment: &assignment,
                period: &period,
            },
        )
    }

    /// The property the whole second source rests on: a phone punch is a punch,
    /// and it names no station and no method for ever.
    #[test]
    fn a_punch_from_the_app_names_no_station_and_says_so() {
        let punch = app_punch(8 * 60, PunchDirection::In).expect("claim");
        assert_eq!(punch.source(), PunchSource::EmployeeApp);
        assert_eq!(punch.terminal(), None);
        assert_eq!(punch.method(), None);
        assert_eq!(punch.place().as_str(), "store-07");
        // And a terminal punch still says the opposite, which is the whole
        // point of asking.
        let read = punch_at(8 * 60, PunchDirection::In).expect("record");
        assert_eq!(read.source(), PunchSource::Terminal);
        assert_eq!(read.method(), Some(IdentificationMethod::Fingerprint));
        assert!(read.terminal().is_some());
    }

    /// The capability, in one assertion. A claim is the only way to reach
    /// `claim_own`, and only the self-service key makes one.
    #[test]
    fn nothing_but_the_self_service_grant_makes_a_claim() {
        let refused = SelfPunchClaim::make(
            EmployeeId::try_new("emp-1").unwrap(),
            PlaceId::try_new("store-07").unwrap(),
            authority(actions::ROSTER_MANAGE),
        );
        assert!(matches!(
            refused,
            Err(AttendanceError::ActionForbidsOwnPunch { .. })
        ));
        // Not even the key that names recording a punch: that one is the
        // device's act, and a session holding it must not become a way to clock
        // somebody in from a browser.
        assert!(matches!(
            SelfPunchClaim::make(
                EmployeeId::try_new("emp-1").unwrap(),
                PlaceId::try_new("store-07").unwrap(),
                authority(actions::ATTENDANCE_PUNCH_RECORD),
            ),
            Err(AttendanceError::ActionForbidsOwnPunch { .. })
        ));
    }

    /// A claim about somebody else is refused in the kernel as well as in the
    /// handler, so the record bound does not rest on one `if` in one route.
    #[test]
    fn a_claim_cannot_be_recorded_against_another_employee() {
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let period = open_period();
        let somebody_else = SelfPunchClaim::make(
            EmployeeId::try_new("emp-2").unwrap(),
            PlaceId::try_new("store-07").unwrap(),
            authority(actions::ATTENDANCE_PUNCH_RECORD_OWN),
        )
        .expect("claim");
        assert!(matches!(
            Punch::claim_own(
                &somebody_else,
                PunchDirection::In,
                PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(480).unwrap()),
                Utc::now(),
                PunchContext {
                    employee: &employee,
                    assignment: &assignment,
                    period: &period,
                },
            ),
            Err(AttendanceError::ClaimEmployeeMismatch)
        ));
    }

    /// A second source must not be a second set of rules. The three
    /// eligibility questions are asked of a phone punch exactly as they are
    /// asked of a reading.
    #[test]
    fn the_app_is_a_second_source_and_not_a_second_rulebook() {
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let mut period = open_period();
        period
            .close(
                super::super::period::CloseReadiness::CLEAR,
                authority(actions::ATTENDANCE_PERIOD_CLOSE),
            )
            .expect("close");
        let at = PunchTime::same_day(date("2026-09-14"), MinuteOfDay::try_new(480).unwrap());
        assert!(matches!(
            Punch::claim_own(
                &claim("store-07"),
                PunchDirection::In,
                at,
                Utc::now(),
                PunchContext {
                    employee: &employee,
                    assignment: &assignment,
                    period: &period,
                },
            ),
            Err(AttendanceError::ClosedPeriodRejectsPunch { .. })
        ));

        // And the posting, on the punch's own business date.
        let elsewhere = posted_to("store-03");
        assert!(matches!(
            Punch::claim_own(
                &claim("store-07"),
                PunchDirection::In,
                at,
                Utc::now(),
                PunchContext {
                    employee: &employee,
                    assignment: &elsewhere,
                    period: &open_period(),
                },
            ),
            Err(AttendanceError::NotPostedToPlaceOnDate { .. })
        ));
    }

    /// A double tap lands once, by the same identity collision that makes a
    /// node's redelivery free. The id is derived rather than supplied, so there
    /// is no way to send one tap twice under two identities.
    #[test]
    fn two_taps_in_the_same_minute_are_one_punch() {
        let first = app_punch(8 * 60, PunchDirection::In).expect("first");
        let again = app_punch(8 * 60, PunchDirection::In).expect("second");
        assert_eq!(first.id(), again.id());

        let mut log = PunchLog::new(PlaceId::try_new("store-07").unwrap());
        assert!(log.append_if_absent(first).expect("first"));
        assert!(!log.append_if_absent(again).expect("second"));
        assert_eq!(log.len(), 1);

        // The next minute is a different observation and does land. Whether
        // the two amount to one arrival is the derivation's question.
        let later = app_punch(8 * 60 + 1, PunchDirection::In).expect("later");
        assert!(log.append_if_absent(later).expect("later"));
        assert_eq!(log.len(), 2);
        // Leaving is not arriving, either.
        assert_ne!(
            app_punch(8 * 60, PunchDirection::Out)
                .expect("out")
                .id()
                .as_str(),
            app_punch(8 * 60, PunchDirection::In)
                .expect("in")
                .id()
                .as_str()
        );
    }

    /// The halfway row, refused from both sides on the way in from storage.
    ///
    /// This is what stops a phone punch loading as a fingerprint reading — the
    /// one outcome the source column exists to prevent — and what stops a
    /// reading losing its station and quietly becoming a phone tap.
    #[test]
    fn a_stored_punch_whose_source_and_station_disagree_does_not_load() {
        let employee = active_employee();
        let assignment = posted_to("store-07");
        let phone = app_punch(8 * 60, PunchDirection::In).expect("claim");
        assert!(matches!(
            Punch::rehydrate(
                phone.to_persisted(),
                Some(&terminal()),
                &employee,
                &assignment
            ),
            Err(AttendanceError::PunchProvenanceMismatch { field: "source" })
        ));
        // With no station offered it loads back unchanged: the posting is the
        // only provenance a phone punch ever had, and it is re-checked.
        assert_eq!(
            Punch::rehydrate(phone.to_persisted(), None, &employee, &assignment).expect("reload"),
            phone
        );

        let read = punch_at(8 * 60, PunchDirection::In).expect("record");
        assert!(matches!(
            Punch::rehydrate(read.to_persisted(), None, &employee, &assignment),
            Err(AttendanceError::PunchProvenanceMismatch { field: "source" })
        ));
    }

    /// The codes round-trip, so a stored row and a wire payload cannot
    /// disagree about which source produced a punch.
    #[test]
    fn every_punch_source_round_trips_through_its_code() {
        for source in [PunchSource::Terminal, PunchSource::EmployeeApp] {
            assert_eq!(PunchSource::parse(source.code()).unwrap(), source);
        }
        assert!(matches!(
            PunchSource::parse("KIOSK"),
            Err(AttendanceError::UnreadablePunchSource { .. })
        ));
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
