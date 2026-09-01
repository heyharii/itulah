//! Attendance, starting with the only half of it that needs no clock.
//!
//! What is here is the **policy**: what lateness means, what counts as leaving
//! early, how long somebody must work past their shift before ordered overtime
//! is recognised, and how close two taps have to be to be one tap. Head office
//! decides all four, they are effective-dated, and every outcome derived under
//! them records which version produced it.
//!
//! What is deliberately not here yet: punches, rosters, corrections, periods
//! and kiosks. Those need a source of clock-ins, which is an unanswered product
//! question — the till, a fingerprint reader, or a kiosk. The policy does not
//! wait on that answer, and writing it first means the answer arrives to a
//! system that already knows what it would mean.

mod error;
mod policy;

pub use error::AttendanceError;
pub use policy::{
    AttendancePolicy, Minutes, PolicyId, PolicyLimits, PolicySchedule, PolicyVersion,
    MAX_DUPLICATE_PUNCH_WINDOW_MINUTES, MAX_LATE_GRACE_MINUTES,
};
