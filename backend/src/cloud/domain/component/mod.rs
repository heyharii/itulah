//! The payroll component engine: deductions, valued overtime, one-off
//! adjustments, and a net figure.
//!
//! Adapted from the reference HRMS payroll module's `Salary Component`,
//! `Salary Detail`, `Additional Salary`, `Salary Structure` and `Salary
//! Structure Assignment`. `docs/hr-port-provenance.md` records every
//! adaptation.
//!
//! # What this closes
//!
//! Four gaps, all of them the same gap seen from different sides: a slip could
//! only ever be gross.
//!
//! 1. **Deductions exist at all.** `payroll_slip` had no deduction column
//!    anywhere.
//! 2. **Overtime becomes money.** The slip carried minutes and nothing valued
//!    them, because no rate existed anywhere in the estate.
//! 3. **One-off and variable components.** There was no table for an
//!    incentive, a *kasbon* instalment, a bonus, or an allowance that depends
//!    on days. See [`adjustment`].
//! 4. **A net figure**, which falls out of the first.
//!
//! # What it refuses to become
//!
//! The reference's component engine was deliberately not ported when the rest
//! of payroll was (`docs/hr-port-provenance.md`, *"Pay, payroll identity, and
//! the run"*). Two things were being protected against, and both are still
//! protected against here.
//!
//! **The first is `eval`.** The reference stores `condition` and `formula` as
//! Python source in a database row and hands them to an interpreter when a
//! payslip is built. There is no expression type in this module. A component
//! is one of five shapes ([`ComponentShape`]), and a shape not in that enum
//! cannot be constructed, stored, or sent — it is unrepresentable rather than
//! refused. No component may name another component, so there is no evaluation
//! order and a cycle is not a thing that can exist. See [`basis`].
//!
//! **The second is inventing statutory arithmetic.** PPh 21 is still nowhere
//! near this code: no brackets, no PTKP lookup, no annualisation. The owner's
//! decision stands — gross first, deductions at Finance — and income-tax
//! brackets are not this backend's to write.
//!
//! What has changed is that BPJS is now *expressible*: a capped share of a
//! named base is one of the five shapes. **No rate is seeded.** There is no
//! BPJS percentage and no overtime multiplier written anywhere in this
//! repository. An operator states them, the way `overtime_policy` makes an
//! operator state the overtime caps, and a component with no ratified rate
//! makes a slip refuse to report a deduction total — naming the component —
//! rather than report nought. See [`slip`].
//!
//! # Every number is an integer
//!
//! Money in the smallest unit, percentages in basis points, statutory
//! multipliers in basis points, overtime in whole minutes priced by the hour.
//! No `f64` appears in this module or in the two migrations behind it.

mod adjustment;
mod basis;
mod catalogue;
mod error;
mod slip;

pub use adjustment::{PayrollAdjustment, PayrollAdjustmentWire, MAX_ADJUSTMENT_ID_LEN};
pub use basis::{
    ComponentBase, ComponentBasis, ComponentKind, ComponentShape, Computed, CountedUnit, SlipFacts,
    BASIS_POINTS, MAX_RATE_BP,
};
pub use catalogue::{
    ComponentCode, ComponentInForce, ComponentRate, PayComponent, PayComponentWire, RateNumbers,
    RateTimeline, MAX_COMPONENT_CODE_LEN, MAX_COMPONENT_LABEL_LEN,
};
pub use error::ComponentError;
pub use slip::{SlipComputation, SlipLine};

#[cfg(test)]
mod tests;
