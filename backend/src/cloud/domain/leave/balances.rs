//! One ledger per kind of leave, per person.
//!
//! # Why not one ledger with a label on each entry
//!
//! Because then every fold has to remember to filter, and the one that forgets
//! produces a balance made of two different entitlements added together. *Cuti
//! tahunan* and *cuti besar* accrue differently, carry forward differently and
//! expire differently; summing them gives a number that is right for neither and
//! looks entirely plausible.
//!
//! # What is deliberately absent
//!
//! A ledger for sick leave, maternity leave, or leave for an important reason.
//! Those consume no balance, and creating an empty one "for consistency" would
//! be an invitation to start deducting from it.

use super::error::LeaveError;
use super::kinds::{LeaveType, LeaveTypeCode};
use super::ledger::LeaveLedger;
use super::units::LeaveDays;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LeaveBalances {
    ledgers: BTreeMap<LeaveTypeCode, LeaveLedger>,
}

impl LeaveBalances {
    pub fn new() -> Self {
        Self::default()
    }

    /// The ledger to append to, created on first use.
    ///
    /// Guarded: a kind that draws on no balance has no ledger to open, and
    /// opening one would be the first step towards deducting from it.
    pub fn ledger_mut(&mut self, leave_type: &LeaveType) -> Result<&mut LeaveLedger, LeaveError> {
        leave_type.require_balance_backed()?;
        Ok(self.ledgers.entry(leave_type.code().clone()).or_default())
    }

    /// `Ok(None)` means "balance-backed, and nothing recorded yet" — a new
    /// joiner before their first accrual. That is a different answer from "this
    /// kind has no balance", which is an error.
    pub fn ledger(&self, leave_type: &LeaveType) -> Result<Option<&LeaveLedger>, LeaveError> {
        leave_type.require_balance_backed()?;
        Ok(self.ledgers.get(leave_type.code()))
    }

    pub fn balance_on(
        &self,
        leave_type: &LeaveType,
        date: NaiveDate,
    ) -> Result<LeaveDays, LeaveError> {
        match self.ledger(leave_type)? {
            Some(ledger) => ledger.balance_on(date),
            None => Ok(LeaveDays::ZERO),
        }
    }

    /// The kinds this person has a ledger for, in code order.
    pub fn kinds(&self) -> impl Iterator<Item = &LeaveTypeCode> {
        self.ledgers.keys()
    }

    pub fn is_empty(&self) -> bool {
        self.ledgers.is_empty()
    }

    /// Insert a whole ledger, for rebuilding from storage.
    ///
    /// The rows arrive per kind and the guard still runs, so a stored ledger
    /// against sick leave fails to load rather than becoming a balance nobody
    /// should have.
    pub fn install(
        &mut self,
        leave_type: &LeaveType,
        ledger: LeaveLedger,
    ) -> Result<(), LeaveError> {
        leave_type.require_balance_backed()?;
        self.ledgers.insert(leave_type.code().clone(), ledger);
        Ok(())
    }
}
