//! Overtime: the employer's written order and the worker's written consent,
//! both required.
//!
//! Ported from the reference HR backend's `overtime-domain`. See
//! `docs/hr-port-provenance.md` for what changed.
//!
//! # The rule this module exists to make structural
//!
//! **Overtime needs two consents, not one.** PP 35/2021 art. 26(2) requires
//! *both* a written instruction from the employer *and* the worker's written
//! agreement. Either alone is not lawful overtime.
//!
//! Almost every system models this as a single manager approval, and that shape
//! produces exactly the outcome the rule exists to prevent: hours worked because
//! a supervisor said so, with no record that anyone asked. The employee has no
//! artefact to point at, and neither does an inspector.
//!
//! So an order and a consent are separate recorded acts under disjoint action
//! keys, and [`OvertimeOrder::authorized_minutes`] — the figure anything
//! downstream may act on — is `Some` only in [`OvertimeState::Agreed`]. An order
//! nobody agreed to authorizes nothing. There is no override, no "manager may
//! waive", no seniority that substitutes for the worker's answer:
//! [`OvertimeOrder::decline`] is final and the type offers no path out of it.
//!
//! # What is authorized, and what is worked
//!
//! Different numbers, and this module holds only the first. An order authorizes
//! *up to* so many minutes; what was actually worked comes from punches, and
//! there is no punch source in this system yet. When there is, the seam is
//! [`OvertimeId`] — the reference a day's attendance would carry.
//!
//! # What this module will not do
//!
//! **Compute pay.** The Kepmenaker 102/2004 multipliers — 1.5× the first hour,
//! 2× thereafter, a different table on rest days and public holidays — are
//! statutory arithmetic, and the day they are amended a constant compiled in
//! here becomes quietly wrong. [`DayKind`] records *which* table applies,
//! because that is a fact about the day and somebody has to record it.
//!
//! **Know the statutory caps.** See [`policy`].

mod error;
mod order;
mod policy;

pub use error::OvertimeError;
pub use order::{
    week_of, DayKind, OvertimeId, OvertimeOrder, OvertimeOrderWire, OvertimeState, WorkerConsent,
    CONSENT_KEY as OVERTIME_CONSENT_KEY, MAX_ORDER_ID_LEN as MAX_OVERTIME_ID_LEN,
    ORDER_KEY as OVERTIME_ORDER_KEY,
};
pub use policy::{OvertimePolicy, OvertimePolicyWire};

#[cfg(test)]
mod tests;
