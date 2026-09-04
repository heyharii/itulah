//! Every movement of a balance, and the fold that is the balance.
//!
//! # There is no balance
//!
//! Not a stored one, anywhere. The implementation this is ported from kept a
//! balances table beside the ledger, so there were two answers to "how many days
//! are left" and nothing forcing them to agree — a crash between two statements
//! is enough to part them, silently, for ever.
//!
//! [`LeaveLedger::balance_on`] is the only answer there is, and there is no
//! setter. That costs a fold over a person's entries for one kind of leave,
//! which is a few dozen rows a year.

use super::error::LeaveError;
use super::policy::{CarryForward, LeavePolicy};
use super::units::LeaveDays;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

/// What moved a balance.
///
/// A closed list on purpose. A new kind of movement is a policy change and
/// should be a visible edit here, not a free-text column that lets operations
/// invent categories the reports cannot see.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LeaveEvent {
    /// The year's entitlement, granted at once.
    Allocation,
    /// A month's worth, granted as it is earned.
    Accrual,
    /// Days brought across a year boundary. Carries an expiry.
    CarryForward,
    /// Carried days that lapsed.
    Expiry,
    /// Leave taken. The only event an approval mints.
    Usage,
    /// Days paid out instead of taken.
    Encashment,
    /// Days granted in lieu.
    Compensatory,
    /// A correction, signed by its own amount.
    Adjustment,
}

impl LeaveEvent {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Allocation => "ALLOCATION",
            Self::Accrual => "ACCRUAL",
            Self::CarryForward => "CARRY_FORWARD",
            Self::Expiry => "EXPIRY",
            Self::Usage => "USAGE",
            Self::Encashment => "ENCASHMENT",
            Self::Compensatory => "COMPENSATORY",
            Self::Adjustment => "ADJUSTMENT",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "ALLOCATION" => Some(Self::Allocation),
            "ACCRUAL" => Some(Self::Accrual),
            "CARRY_FORWARD" => Some(Self::CarryForward),
            "EXPIRY" => Some(Self::Expiry),
            "USAGE" => Some(Self::Usage),
            "ENCASHMENT" => Some(Self::Encashment),
            "COMPENSATORY" => Some(Self::Compensatory),
            "ADJUSTMENT" => Some(Self::Adjustment),
            _ => None,
        }
    }

    /// Does this event add days?
    ///
    /// `Adjustment` is the exception and is not listed: a correction may go
    /// either way, and forcing a sign convention on the caller is how
    /// corrections end up doubled.
    pub const fn is_credit(self) -> bool {
        matches!(
            self,
            Self::Allocation | Self::Accrual | Self::CarryForward | Self::Compensatory
        )
    }
}

/// One movement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LedgerEntry {
    id: String,
    on: NaiveDate,
    event: LeaveEvent,
    amount: LeaveDays,
    by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_on: Option<NaiveDate>,
}

impl LedgerEntry {
    pub fn try_new(
        id: impl Into<String>,
        on: NaiveDate,
        event: LeaveEvent,
        amount: LeaveDays,
        by: impl Into<String>,
    ) -> Result<Self, LeaveError> {
        let id = id.into();
        if id.trim().is_empty() {
            return Err(LeaveError::InvalidId { field: "entry id" });
        }
        let by = by.into();
        // A ledger entry nobody is attached to cannot be disputed.
        if by.trim().is_empty() {
            return Err(LeaveError::InvalidId { field: "by" });
        }
        match event {
            // A zero-day usage or a negative accrual is not a fact, it is a bug
            // upstream — and recording it would make the ledger unreadable.
            LeaveEvent::Adjustment if amount.is_zero() => {
                return Err(LeaveError::NotPositive { field: "amount" });
            }
            LeaveEvent::Adjustment => {}
            _ if !amount.is_positive() => {
                return Err(LeaveError::NotPositive { field: "amount" });
            }
            _ => {}
        }
        Ok(Self {
            id,
            on,
            event,
            amount,
            by,
            expires_on: None,
        })
    }

    /// Set on carry-forward entries: the day the carried days lapse.
    pub fn expiring_on(mut self, expires_on: NaiveDate) -> Self {
        self.expires_on = Some(expires_on);
        self
    }

    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn on(&self) -> NaiveDate {
        self.on
    }
    pub fn event(&self) -> LeaveEvent {
        self.event
    }
    pub fn amount(&self) -> LeaveDays {
        self.amount
    }
    pub fn by(&self) -> &str {
        &self.by
    }
    pub fn expires_on(&self) -> Option<NaiveDate> {
        self.expires_on
    }

    /// The amount as it moves the balance.
    pub fn signed(&self) -> LeaveDays {
        match self.event {
            LeaveEvent::Adjustment => self.amount,
            event if event.is_credit() => self.amount,
            _ => -self.amount,
        }
    }
}

/// One person's movements for one kind of leave, oldest first.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct LeaveLedger {
    entries: Vec<LedgerEntry>,
}

impl<'de> Deserialize<'de> for LeaveLedger {
    /// Replays `append` rather than trusting the stored order.
    ///
    /// A derived `Deserialize` would let a stored ledger skip the ordering and
    /// duplicate checks, and an out-of-order ledger folds to a balance that
    /// never existed — silently, because both look fine.
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let entries = Vec::<LedgerEntry>::deserialize(deserializer)?;
        let mut ledger = Self::default();
        for entry in entries {
            ledger.append(entry).map_err(serde::de::Error::custom)?;
        }
        Ok(ledger)
    }
}

impl LeaveLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, entry: LedgerEntry) -> Result<(), LeaveError> {
        if let Some(last) = self.entries.last() {
            if entry.on < last.on {
                return Err(LeaveError::OutOfOrder {
                    previous: last.on,
                    next: entry.on,
                });
            }
        }
        if self.entries.iter().any(|held| held.id == entry.id) {
            return Err(LeaveError::DuplicateEntry {
                id: entry.id.clone(),
            });
        }
        self.entries.push(entry);
        Ok(())
    }

    pub fn entries(&self) -> &[LedgerEntry] {
        &self.entries
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// **This is the only balance there is.**
    pub fn balance_on(&self, date: NaiveDate) -> Result<LeaveDays, LeaveError> {
        self.entries
            .iter()
            .filter(|entry| entry.on <= date)
            .try_fold(LeaveDays::ZERO, |total, entry| {
                total.checked_add(entry.signed())
            })
    }

    /// How many carried-forward days are still alive on a date.
    ///
    /// Consumption is applied to carried days first, which is what makes a cap
    /// bite: days that expire should be the ones spent last, not the ones
    /// spent first.
    pub fn carried_alive_on(&self, date: NaiveDate) -> LeaveDays {
        let mut carried = LeaveDays::ZERO;
        let mut expired = LeaveDays::ZERO;
        let mut spent = LeaveDays::ZERO;
        for entry in self.entries.iter().filter(|entry| entry.on <= date) {
            match entry.event {
                // Alive up to and INCLUDING the expiry date. `>` here was a
                // real off-by-one in the reference: on the deadline itself the
                // days already read as dead, so the expiry sweep found nothing
                // to expire and the carried days quietly survived into the new
                // year — the exact leak the cap exists to stop.
                LeaveEvent::CarryForward if entry.expires_on.is_none_or(|end| end >= date) => {
                    carried = carried + entry.amount;
                }
                LeaveEvent::Expiry => expired = expired + entry.amount,
                LeaveEvent::Usage | LeaveEvent::Encashment => spent = spent + entry.amount,
                _ => {}
            }
        }
        (carried - expired - spent.min(carried)).clamp_non_negative()
    }

    /// The expiry entry due on a date, if any.
    ///
    /// The kernel hands the entry back rather than mutating itself: whoever
    /// stores it decides when, and a ledger that expired its own days would do
    /// so without anybody recording that it had.
    ///
    /// `None` where nothing is due, so the caller writes nothing rather than a
    /// zero-day entry — a ledger full of zeroes hides the ones that matter.
    pub fn expiry_due(
        &self,
        policy: &LeavePolicy,
        on: NaiveDate,
        id: impl Into<String>,
    ) -> Result<Option<LedgerEntry>, LeaveError> {
        let CarryForward::Capped {
            expires_on_month_day: (month, day),
            ..
        } = policy.carry_forward()
        else {
            return Ok(None);
        };
        if on.month() != month || on.day() != day {
            return Ok(None);
        }
        let alive = self.carried_alive_on(on);
        if !alive.is_positive() {
            return Ok(None);
        }
        LedgerEntry::try_new(id, on, LeaveEvent::Expiry, alive, "system:leave-expiry").map(Some)
    }

    /// May this many days be taken on this date?
    ///
    /// Refuses rather than allowing a negative balance: unpaid leave is a
    /// different kind with its own ledger, not annual leave gone negative.
    pub fn may_take(&self, requested: LeaveDays, date: NaiveDate) -> Result<(), LeaveError> {
        if !requested.is_positive() {
            return Err(LeaveError::NotPositive { field: "requested" });
        }
        let available = self.balance_on(date)?;
        if requested > available {
            return Err(LeaveError::InsufficientBalance {
                requested_centidays: requested.centidays(),
                available_centidays: available.centidays(),
            });
        }
        Ok(())
    }
}
