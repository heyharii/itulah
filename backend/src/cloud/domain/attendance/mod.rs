//! Attendance, starting with the only half of it that needs no clock.
//!
//! What is here is the **policy**: what lateness means, what counts as leaving
//! early, how long somebody must work past their shift before ordered overtime
//! is recognised, and how close two taps have to be to be one tap. Head office
//! decides all four, they are effective-dated, and every outcome derived under
//! them records which version produced it.
//!
//! The **roster half** is here too: shift templates, the dated plan, its
//! append-only revisions, and the close boundary that freezes them. None of it
//! needs a clock — a plan is written before anybody works it, and a month is
//! signed off by a person rather than by a sensor.
//!
//! The **punch half** is here now too, and it is what the two halves above
//! were written to receive. The owner answered the open question on 2026-09-13:
//! a fingerprint punch station per unit, ZKTeco readers, templates held
//! centrally, punches taken at the edge and synced up. So:
//!
//! * [`terminal`] is the authority — a registered, active station is the only
//!   thing that can attest an identification, and an attestation is one of the
//!   two things that can produce a [`Punch`];
//! * [`punch`] is the append-only log of what the devices observed;
//! * [`day`] derives what a day *means* from `(plan, punches, policy,
//!   approvals, correction)` — and stores none of it;
//! * [`correction`] is the append-only overlay, which never edits a punch;
//! * [`enrolment`] binds a fingerprint to an employment record and keeps the
//!   sealed template out of every route that is not the terminal sync.
//!
//! # There is a second punch source, and it is named rather than blurred
//!
//! No reader has been bought, so on 2026-09-13 nobody could clock in anywhere
//! and none of the five modules above had an input to be exercised against. The
//! owner asked for attendance in the employee app so the HR month can be walked
//! end to end before the hardware arrives.
//!
//! That is a source the fingerprint decision did not contemplate, so it is
//! **distinguishable for ever** rather than quietly merged: [`PunchSource`] is a
//! closed vocabulary on every punch, [`PunchProvenance`] carries the station
//! only for the source that has one, and a phone punch is produced by a
//! [`SelfPunchClaim`] — a person's claim, corroborated by nothing — rather than
//! by an attestation. Both sources go through the same eligibility rules; only
//! the evidence differs, and every row says which it was.
//!
//! What is still deliberately absent: the Tauri shell, and the physical
//! ZKFinger adapter. The device boundary stays behind the local HTTP and
//! event-cursor contract the donor's `hardware-agent` exposes, so the shell is
//! a separate port rather than a dependency of any of this.
//!
//! # The one rule that runs through all of it
//!
//! **A day with no punch is not a day of absence, and "not assessed" is not
//! zero.** The close's readiness carried `None` for the punch-derived counts
//! while there was no punch source; now it carries numbers, and the old events
//! stay honest about having been taken without one. A day nobody planned and
//! nobody worked derives to nothing at all rather than to an absence.

mod correction;
mod day;
mod enrolment;
mod error;
mod ids;
mod period;
mod policy;
mod punch;
mod roster;
mod terminal;
mod time;

pub use correction::{
    Correction, CorrectionChain, CorrectionEffect, CorrectionState, CorrectionWire,
};
pub use day::{
    evaluate_day, AttendanceOutcome, DayApprovals, DayEvaluation, DayMeasures, LeaveApproval,
    OutcomeSet, OvertimeAgreement,
};
pub use enrolment::{EnrolmentKind, EnrolmentRecord, SealedTemplate, TEMPLATE_NONCE_LEN};
pub use error::AttendanceError;
pub use ids::{
    CorrectionId, Finger, LeaveRef, OvertimeRef, PunchId, TemplateFormat, TerminalId,
    MAX_ATTENDANCE_ID_LEN,
};
pub use period::{
    AttendancePeriod, AttendancePeriodWire, CloseReadiness, PeriodEvent, PeriodEventKind,
    PeriodStatus,
};
pub use policy::{
    AttendancePolicy, Minutes, PolicyId, PolicyLimits, PolicySchedule, PolicyVersion,
    MAX_DUPLICATE_PUNCH_WINDOW_MINUTES, MAX_LATE_GRACE_MINUTES,
};
pub use punch::{
    ClockQuality, PersistedPunch, Punch, PunchContext, PunchDirection, PunchLog, PunchProvenance,
    PunchSource, PunchTime, SelfPunchClaim,
};
pub use roster::{
    DatedRoster, DayPlan, RosterDay, RosterDayWire, RosterRevision, Shift, ShiftWire,
};
pub use terminal::{
    AttendanceTerminal, AttendanceTerminalWire, IdentificationMethod, TerminalAttestation,
    TerminalEvent, TerminalStatus,
};
pub use time::{
    AttendanceMonth, DayOffset, MinuteOfDay, ShiftId, ShiftPosition, MAX_SHIFT_ID_LEN,
    MINUTES_PER_DAY,
};
