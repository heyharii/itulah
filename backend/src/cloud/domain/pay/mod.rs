//! What somebody is paid, who they are to payroll, and the run that pays them.
//!
//! Ported from the reference HR backend's `employee-pay-domain` and, for the
//! run lifecycle only, the retail backend's payroll module. See
//! `docs/hr-port-provenance.md`.
//!
//! # The three properties worth the port
//!
//! 1. **A salary is a history, not a number.** There is no current-salary
//!    field, because that is the field a raise overwrites — taking February's
//!    payslip with it. See [`agreement`].
//! 2. **Two people sign a run, not one.** Verify and approve are separate
//!    steps by separate actors, enforced on the transition and again on the way
//!    in from storage. See [`run`].
//! 3. **A bank account is stored whole and shown masked.** The screen that
//!    checks an account is right needs four digits; a payment file needs the
//!    number. See [`identity`].
//!
//! # What is deliberately absent
//!
//! **Every statutory calculation.** PPh 21 brackets, BPJS rates, the THR
//! formula: none of it is here. The retail backend this borrows the lifecycle
//! from carries a component engine that applies all three; it was not brought
//! across, because a figure computed here is a figure somebody files with the
//! tax office, and the brackets change by regulation.
//!
//! What a slip carries instead is the agreement in force and the facts this
//! system recorded — and it says, on the run itself, that it is incomplete and
//! why. There is no punch source, so nothing knows what was *worked*.

mod agreement;
mod error;
mod identity;
mod run;

pub use agreement::{
    AllowanceCode, FixedAllowance, PayRecord, PayRecordWire, PayTimeline, MAX_ALLOWANCE_CODE_LEN,
};
pub use error::PayError;
pub use identity::{
    BankAccount, BankAccountWire, IdentityAmendment, IdentityChange, PayrollIdentity, PtkpStatus,
};
pub use run::{PayrollRun, PayrollRunWire, RunEvent, RunState, RunStep};

#[cfg(test)]
mod tests;
