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
//! What is deliberately still not here: punches, corrections and kiosks. Those
//! need a source of clock-ins, which is an unanswered product question — the
//! till, an RFID reader, or a kiosk. `frontend-hub/PEOPLE-BRIEF.md` states the
//! three options and their costs. Everything here is written so that the answer
//! arrives to a system that already knows what it would mean: the close records
//! that the punch checks were *not assessed* rather than that they passed.

mod error;
mod period;
mod policy;
mod roster;
mod time;

pub use error::AttendanceError;
pub use period::{
    AttendancePeriod, AttendancePeriodWire, CloseReadiness, PeriodEvent, PeriodEventKind,
    PeriodStatus,
};
pub use policy::{
    AttendancePolicy, Minutes, PolicyId, PolicyLimits, PolicySchedule, PolicyVersion,
    MAX_DUPLICATE_PUNCH_WINDOW_MINUTES, MAX_LATE_GRACE_MINUTES,
};
pub use roster::{
    DatedRoster, DayPlan, RosterDay, RosterDayWire, RosterRevision, Shift, ShiftWire,
};
pub use time::{
    AttendanceMonth, DayOffset, MinuteOfDay, ShiftId, ShiftPosition, MAX_SHIFT_ID_LEN,
    MINUTES_PER_DAY,
};
