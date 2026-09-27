//! Expense claims: what somebody spent, what a second person sanctioned, and
//! how the sanction became money.
//!
//! # The point of the module is the posting
//!
//! Everything before it is paperwork the estate already knows how to hold —
//! a filer, a decider, lines with amounts. What makes this module an expenses
//! module rather than a form is the transaction at each end of the money: a
//! decision that says APPROVED writes `Dr employee_expense / Cr
//! employee_claim_payable` **in the same transaction as the state**, and a
//! payout writes `Dr employee_claim_payable / Cr petty_cash` in the same
//! transaction as PAID. A crash between the paperwork and the books would
//! leave an approved claim nothing owes or a payment nothing recorded — so
//! there is no "between". The poster's own idempotency
//! (`(source_kind, source_id, purpose)` unique) is the second guard: a resent
//! decision or a double-clicked payout is refused by the database, not by a
//! status check two racing requests can both pass.
//!
//! # Two actors, one rule
//!
//! The person who files a claim may not sanction it. Like the payroll run's
//! two signatures, the rule is enforced on the transition *and* on the way in
//! from storage — a stored claim whose filer and decider carry one name fails
//! to hydrate rather than becoming an approved claim — and the schema holds
//! it a third time as a CHECK. A rule only the live path enforces is a rule
//! a round trip through the database removes.
//!
//! # What a decision sanctions
//!
//! Lines, not just the total: the decider writes a figure per line, the
//! header total is their arithmetic, and the posting aggregates the lines by
//! type code for the debit legs. A sanction of zero does not exist — a claim
//! worth nothing is RETURNED (back to DRAFT, with a reason) or REJECTED,
//! which are decisions with names on them.
//!
//! # What this module does not do
//!
//! It does not resolve places to sites, meanings to accounts, or the imprest
//! to a balance — that is `postgres::claims` and `poster`'s job. It does not
//! offset advances: V1 claims are petty reimbursements, and the advance
//! surface (0280) is read-only beside this one.

mod catalogue;
mod claim;
mod error;

pub use catalogue::{ClaimType, ClaimTypeCatalogue, ClaimTypeCode};
pub use claim::{
    ClaimEvent, ClaimId, ClaimLine, ClaimLineId, ClaimPosting, ClaimState, ExpenseClaim,
    ExpenseClaimWire, MAX_CLAIM_ID_LEN, MAX_DESCRIPTION_LEN,
};
pub use error::ClaimError;
