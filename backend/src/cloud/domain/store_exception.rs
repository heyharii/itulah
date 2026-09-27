//! Store exceptions: the words, kept pure (0646-0648).
//!
//! One "needs attention" list for head office and each store manager: the
//! things that go wrong in stores and that head office must see. Business,
//! not technical — the fleet status page keeps the machines. Every kind is
//! read from data the store already produces (`postgres::store_exceptions`);
//! this module names the kinds, who owns each, which hub sections may see it,
//! and how severity and state are spelled.

use super::job_role::JobGrant;

/// One kind of exception. The set is closed: a new kind is a new reading of
/// the data, which is code, and a new value in `store_exception_kind_check`.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ExceptionKind {
    /// A till shift still open after its business day ended.
    ShiftNotClosed,
    /// A day's cash takings not banked by the deadline.
    DepositMissing,
    /// A flow document's RECEIVE stage, or any parked stage, past its
    /// template deadline.
    ReceiveOverdue,
    /// Missing goods at a site nobody has decided (found or lost) for days.
    MissingOpen,
    /// A closed shift whose count is off by more than the threshold and that
    /// head office has not accepted.
    CashDifference,
    /// A checkout the till could not finish, with the shopper's money held,
    /// that head office has not answered (`edge_checkout_exception`).
    CheckoutUnresolved,
}

impl ExceptionKind {
    pub const ALL: [ExceptionKind; 6] = [
        Self::ShiftNotClosed,
        Self::DepositMissing,
        Self::ReceiveOverdue,
        Self::MissingOpen,
        Self::CashDifference,
        Self::CheckoutUnresolved,
    ];

    /// The spelling `store_exception.kind` stores and the API answers.
    pub const fn code(self) -> &'static str {
        match self {
            Self::ShiftNotClosed => "SHIFT_NOT_CLOSED",
            Self::DepositMissing => "DEPOSIT_MISSING",
            Self::ReceiveOverdue => "RECEIVE_OVERDUE",
            Self::MissingOpen => "MISSING_OPEN",
            Self::CashDifference => "CASH_DIFFERENCE",
            Self::CheckoutUnresolved => "CHECKOUT_UNRESOLVED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        let code = code.trim();
        Self::ALL
            .into_iter()
            .find(|kind| kind.code().eq_ignore_ascii_case(code))
    }

    /// The hub sections whose people see this kind. A store's own people
    /// hold `stores` and see every kind at their store; head office sees
    /// what its sections are about.
    pub const fn sections(self) -> &'static [&'static str] {
        match self {
            Self::ShiftNotClosed
            | Self::DepositMissing
            | Self::CashDifference
            | Self::CheckoutUnresolved => &["stores", "finance"],
            Self::ReceiveOverdue => &["stores", "operations", "inventory"],
            Self::MissingOpen => &["stores", "inventory", "operations"],
        }
    }

    /// The job roles that own the fix, by `job_role.code`. RECEIVE_OVERDUE is
    /// owned by whoever holds the stage's performer role, which only the data
    /// knows; this is its fallback.
    pub const fn owner_roles(self) -> &'static [&'static str] {
        match self {
            Self::ShiftNotClosed => &["STORE_MANAGER"],
            Self::DepositMissing | Self::CashDifference => &["STORE_MANAGER", "FINANCE"],
            Self::CheckoutUnresolved => &["FINANCE", "STORE_MANAGER"],
            Self::ReceiveOverdue => &["STORE_MANAGER", "OPERATIONS"],
            Self::MissingOpen => &["INVENTORY"],
        }
    }

    /// Whether a person with this job may see this kind at all. Reach — which
    /// units — is asked separately.
    pub fn visible_to(self, job: &JobGrant) -> bool {
        job.holds_everything()
            || self
                .sections()
                .iter()
                .any(|section| job.holds_section(section))
    }
}

/// The kinds a job may see, in the vocabulary's order.
pub fn kinds_visible_to(job: &JobGrant) -> Vec<ExceptionKind> {
    ExceptionKind::ALL
        .into_iter()
        .filter(|kind| kind.visible_to(job))
        .collect()
}

/// How bad. `BAD` is red, and red is what gets told.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Severity {
    Info,
    Warn,
    Bad,
}

impl Severity {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Bad => "BAD",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code.trim() {
            "INFO" => Some(Self::Info),
            "WARN" => Some(Self::Warn),
            "BAD" => Some(Self::Bad),
            _ => None,
        }
    }

    /// Yellow up to the line, red past it.
    pub fn past(value: i64, bad_from: i64) -> Self {
        if value >= bad_from {
            Self::Bad
        } else {
            Self::Warn
        }
    }
}

/// Where one exception stands, read off its row: never stored as a word, so
/// it cannot disagree with the timestamps it is read from.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExceptionState {
    Open,
    Acknowledged,
    Resolved,
}

impl ExceptionState {
    pub fn of(acknowledged: bool, resolved: bool) -> Self {
        match (resolved, acknowledged) {
            (true, _) => Self::Resolved,
            (false, true) => Self::Acknowledged,
            (false, false) => Self::Open,
        }
    }

    pub const fn code(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Acknowledged => "ACKNOWLEDGED",
            Self::Resolved => "RESOLVED",
        }
    }
}

/// `?state=` on the list.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum StateFilter {
    /// Not resolved, acknowledged or not: the work. The default.
    #[default]
    Open,
    /// Not resolved, and nobody has said they have it.
    Unacknowledged,
    /// Not resolved, and somebody has it.
    Acknowledged,
    Resolved,
    All,
}

impl StateFilter {
    pub fn parse(word: Option<&str>) -> Result<Self, String> {
        match word.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") | Some("open") => Ok(Self::Open),
            Some("unacknowledged") => Ok(Self::Unacknowledged),
            Some("acknowledged") => Ok(Self::Acknowledged),
            Some("resolved") => Ok(Self::Resolved),
            Some("all") => Ok(Self::All),
            Some(other) => Err(format!(
                "'{other}' is not a state; ask for open, unacknowledged, acknowledged, resolved or all"
            )),
        }
    }
}

/// `3 h`, `2 days`: how late, as a sentence says it.
pub fn lateness(seconds: i64) -> String {
    let seconds = seconds.max(0);
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;
    if days >= 2 {
        format!("{days} days")
    } else if hours >= 1 {
        format!("{hours} h")
    } else {
        format!("{} min", minutes.max(1))
    }
}

/// `Rp 1.250.000`: rupiah as the hub prints them. For rupiah `_minor` is the
/// amount.
pub fn rupiah(amount: i64) -> String {
    let digits = amount.unsigned_abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    if amount < 0 {
        format!("−Rp {grouped}")
    } else {
        format!("Rp {grouped}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_reads_back_from_its_code() {
        for kind in ExceptionKind::ALL {
            assert_eq!(ExceptionKind::parse(kind.code()), Some(kind));
        }
        assert_eq!(ExceptionKind::parse("NOPE"), None);
    }

    #[test]
    fn a_store_manager_sees_every_kind_and_finance_only_the_money() {
        let manager = JobGrant {
            code: "STORE_MANAGER".into(),
            sections: vec!["stores".into(), "sales".into(), "inventory".into()],
            ..JobGrant::default()
        };
        assert_eq!(kinds_visible_to(&manager).len(), ExceptionKind::ALL.len());
        let finance = JobGrant {
            code: "FINANCE".into(),
            sections: vec!["finance".into(), "reports".into()],
            ..JobGrant::default()
        };
        let seen = kinds_visible_to(&finance);
        assert!(seen.contains(&ExceptionKind::DepositMissing));
        assert!(!seen.contains(&ExceptionKind::MissingOpen));
    }

    #[test]
    fn state_is_read_off_the_timestamps() {
        assert_eq!(ExceptionState::of(true, true), ExceptionState::Resolved);
        assert_eq!(ExceptionState::of(true, false), ExceptionState::Acknowledged);
        assert_eq!(ExceptionState::of(false, false), ExceptionState::Open);
        assert_eq!(StateFilter::parse(None), Ok(StateFilter::Open));
        assert!(StateFilter::parse(Some("closed")).is_err());
    }

    #[test]
    fn lateness_and_money_read_as_the_hub_writes_them() {
        assert_eq!(lateness(59), "1 min");
        assert_eq!(lateness(3 * 3600 + 5), "3 h");
        assert_eq!(lateness(3 * 86_400), "3 days");
        assert_eq!(rupiah(1_250_000), "Rp 1.250.000");
        assert_eq!(rupiah(-40_000), "−Rp 40.000");
    }
}
