//! The employment kernel: who this person is, whether they are still employed,
//! and where they work.
//!
//! Ported from the reference HR backend's `employee-domain`, which had itself
//! already adapted it once. See `docs/hr-port-provenance.md` for what changed.
//!
//! # What was kept
//!
//! The part worth copying: **status is a fold over history, never a stored
//! fact**. [`Employee::try_new`] re-runs the whole state machine over the
//! recorded events and refuses a record whose claimed status the history does
//! not produce. Deserialization goes through that constructor, so a row in a
//! table — or a payload on the wire — cannot revive an employee into a state no
//! sequence of transitions could reach. [`Profile`] gives the same guarantee
//! over its amendments, and [`ContractTimeline`] over its ordering.
//!
//! # What was changed
//!
//! The reference answers HR authority from its own directory of actors and role
//! grants. We already have a ladder — `CASHIER < SUPERVISOR < ADMIN` — and a
//! second would be two answers to "may they". So [`Authorization`] records the
//! **action key** the actor exercised, and [`audit::required_role`] is the one
//! place that maps a key to a rung. See [`audit`] for why the keys stay finer
//! than the ladder can currently express.
//!
//! [`PlaceId`] points at `org_place` rather than the reference's store table.
//!
//! # What was not ported
//!
//! Attendance, punches, rosters, corrections, payroll periods and kiosks — a
//! separate product several times this size. None of it is needed to answer
//! "who is this person, are they still employed, and where do they work".

// Private, and re-exported by name below. `pub mod` here would put `ids`,
// `error` and friends into `domain::*` alongside the domain's own modules of
// those names — the compiler says so as a shadowed-glob warning, and it is
// right: one `domain::ids` is enough.
mod assignment;
mod audit;
mod contract;
mod employee;
mod error;
mod ids;
mod profile;

pub use assignment::{AssignmentSpan, AssignmentTimeline};
pub use audit::{actions, required_role as required_role_for_action, Authorization};
pub use contract::{Contract, ContractKind, ContractTimeline, Grade, PkwtRun, Position};
pub use employee::{
    Employee, EmployeeCodeCorrection, EmploymentEvent, EmploymentStatus, EmploymentTransition,
};
pub use error::EmployeeError;
pub use ids::{ActorId, EmployeeCode, EmployeeId, PlaceId, ReasonText};
pub use profile::{
    Address, Contact, FullName, Nik, Profile, ProfileAmendment, ProfileChange, ProfileField,
};
