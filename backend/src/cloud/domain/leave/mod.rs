//! Leave: what somebody is owed, what they have taken, and what was decided.
//!
//! Ported from the reference HR backend's `leave-domain`. See
//! `docs/hr-port-provenance.md` for what changed.
//!
//! # The five properties worth copying
//!
//! 1. **A balance is a fold, never a stored number.** The implementation this
//!    replaces kept a balances table beside the ledger, so there were two
//!    answers to "how many days are left" and nothing forcing them to agree — a
//!    crash between two statements is enough to part them, silently, for ever.
//!    [`LeaveLedger::balance_on`] is the only answer and there is no setter.
//!
//! 2. **Unratified policy has no constructor.** Four questions — how much
//!    carries forward, when it expires, whether encashment needs a second
//!    approver, whether protected leave keeps accruing — have no defaults here.
//!    A deployment that has not decided gets [`LeaveError::PolicyNotRatified`]
//!    naming the open question rather than a number somebody typed once.
//!
//! 3. **Not every kind of leave draws on a balance.** Asking how many sick days
//!    are left is a malformed question, not one whose answer is zero — and the
//!    difference matters, because `0` is a number somebody can refuse leave
//!    with. See [`kinds`] for the UU 13/2003 reasoning.
//!
//! 4. **Days are exact integers.** Leave is counted in hundredths of a day, for
//!    the same reason money is counted in the smallest unit.
//!
//! 5. **An approval and its deduction happen together, or neither happens.**
//!    [`LeaveRequestState::Approved`] carries the ledger entry it deducted, and
//!    [`LeaveRequest::approve`] is the only way to reach that state. See
//!    [`request`].
//!
//! # What this module does not do
//!
//! It does not know when the holidays are — that is [`super::holiday`] — and it
//! does not know the roster, so the non-working days a request must not charge
//! arrive as a caller-supplied list. It computes nothing statutory: which pay
//! rule applies to a kind of leave is recorded, and the arithmetic is not here.

mod balances;
mod error;
mod kinds;
mod ledger;
mod policy;
mod request;
mod units;

pub use balances::LeaveBalances;
pub use error::LeaveError;
pub use kinds::{
    LeaveBacking, LeavePayment, LeaveType, LeaveTypeCatalogue, LeaveTypeCode, LeaveTypeWire,
    MAX_CODE_LEN as MAX_LEAVE_CODE_LEN, MAX_NAME_LEN as MAX_LEAVE_NAME_LEN,
};
pub use ledger::{LeaveEvent, LeaveLedger, LedgerEntry};
pub use policy::{
    Accrual, AccrualDuringProtectedLeave, CarryForward, Encashment, Joiner, LeavePolicy,
    PolicyTimeline,
};
pub use request::{
    BalanceContext, LeavePeriod, LeaveRequest, LeaveRequestId, LeaveRequestState, LeaveRequestWire,
    MAX_REQUEST_ID_LEN,
};
pub use units::LeaveDays;

#[cfg(test)]
mod tests;
