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
//! 2. **Two people sign a run, not one.** The place submits and head office
//!    approves — separate steps by separate actors, enforced on the transition
//!    and again on the way in from storage. See [`run`].
//! 3. **A bank account is stored whole and shown masked.** The screen that
//!    checks an account is right needs four digits; a payment file needs the
//!    number. See [`identity`].
//!
//! # Statutory arithmetic (2026-09-30)
//!
//! This module used to hold none: PPh 21 and BPJS were computed outside and
//! entered by Finance. The owner reversed that on 2026-09-30 — "harusnya sesuai
//! Talenta, PPh 21 otomatis" — so [`statutory`] now carries the TER tables of
//! PP 58/2023, Pasal 17, PTKP, *biaya jabatan* and the BPJS contributions, each
//! pinned by a test against the regulation's own figures. Who bears the tax is
//! chosen per employee ([`statutory::TaxMethod`]): withheld, grossed up, or
//! borne by the company.
//!
//! What still is not here: THR entitlement and the 1721-A1 form (the second
//! phase), and anything about what was *worked* — there is no punch source.

mod agreement;
mod error;
mod handover;
mod identity;
mod run;
pub mod statutory;

pub use agreement::{
    AllowanceCode, FixedAllowance, PayRecord, PayRecordWire, PayTimeline, MAX_ALLOWANCE_CODE_LEN,
};
pub use error::PayError;
pub use handover::{HandoverState, PayrollHandover, PayrollHandoverLine, PayrollHandoverWire};
pub use identity::{
    BankAccount, BankAccountWire, IdentityAmendment, IdentityChange, PayrollIdentity, PtkpStatus,
};
pub use run::{PayrollRun, PayrollRunWire, RunEvent, RunState, RunStep};
pub use statutory::{BpjsRates, TaxMethod, TerCategory};

#[cfg(test)]
mod tests;
