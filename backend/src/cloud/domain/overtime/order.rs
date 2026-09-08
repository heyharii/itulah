//! The order, the answer, and what the pair authorizes.

use super::error::OvertimeError;
use super::policy::OvertimePolicy;
use crate::cloud::domain::attendance::Minutes;
use crate::cloud::domain::employment::{actions, Authorization, EmployeeId, PlaceId};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fmt;

pub const MAX_ORDER_ID_LEN: usize = 64;

/// The identity of one overtime order.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct OvertimeId(String);

impl OvertimeId {
    pub fn try_new(raw: &str) -> Result<Self, OvertimeError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(OvertimeError::Required {
                field: "overtime id",
            });
        }
        if trimmed.chars().any(char::is_control) || trimmed.chars().count() > MAX_ORDER_ID_LEN {
            return Err(OvertimeError::InvalidId {
                field: "overtime id",
            });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for OvertimeId {
    type Error = OvertimeError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<OvertimeId> for String {
    fn from(value: OvertimeId) -> Self {
        value.0
    }
}

impl fmt::Display for OvertimeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What kind of day the overtime falls on.
///
/// Recorded because the statutory pay table differs by it — Kepmenaker 102/2004
/// has one schedule for ordinary working days and another for weekly rest days
/// and public holidays. **No multiplier lives here.** This records which table
/// applies; the table itself is statutory arithmetic and is not this module's.
///
/// Supplied by the caller rather than derived, because deriving it needs the
/// roster and the holiday calendar. The holiday half we now have; the roster is
/// still unbuilt, and a value half-derived would be worse than one stated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DayKind {
    /// An ordinary rostered working day.
    Working,
    /// The weekly rest day.
    Rest,
    /// A public holiday.
    Holiday,
}

impl DayKind {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Working => "WORKING",
            Self::Rest => "REST",
            Self::Holiday => "HOLIDAY",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "WORKING" => Some(Self::Working),
            "REST" => Some(Self::Rest),
            "HOLIDAY" => Some(Self::Holiday),
            _ => None,
        }
    }

    /// Is this one of the days the statutory table treats as non-working?
    pub const fn is_non_working(self) -> bool {
        matches!(self, Self::Rest | Self::Holiday)
    }
}

/// The worker's own answer to an order.
///
/// Carries its own authority, which must be the worker's — the type is the
/// proof, so nothing downstream has to remember to check it. A consent recorded
/// under a key the supervisor holds is the supervisor agreeing twice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerConsent {
    authorization: Authorization,
}

impl WorkerConsent {
    pub fn try_new(authorization: Authorization) -> Result<Self, OvertimeError> {
        if !authorization.authorizes_overtime_consent() {
            return Err(OvertimeError::ActionForbidsConsent {
                action_key: authorization.action_key().to_owned(),
            });
        }
        Ok(Self { authorization })
    }

    /// Who answered, when, and what they said in their own words.
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// Where an order has got to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OvertimeState {
    /// Ordered, and the worker has not answered. Authorizes nothing.
    AwaitingConsent,
    /// The worker agreed. The only state that authorizes anything.
    Agreed { consent: WorkerConsent },
    /// The worker said no.
    ///
    /// Terminal, and deliberately so: there is no transition out of it, no
    /// override and no escalation. A refusal that a sufficiently senior person
    /// can reverse is not a refusal.
    Declined { consent: WorkerConsent },
    /// The employer withdrew the order before it was answered.
    Withdrawn { withdrawal: Authorization },
}

impl OvertimeState {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::AwaitingConsent => "AWAITING_CONSENT",
            Self::Agreed { .. } => "AGREED",
            Self::Declined { .. } => "DECLINED",
            Self::Withdrawn { .. } => "WITHDRAWN",
        }
    }

    pub const fn is_awaiting_consent(&self) -> bool {
        matches!(self, Self::AwaitingConsent)
    }

    pub const fn is_agreed(&self) -> bool {
        matches!(self, Self::Agreed { .. })
    }

    /// The worker's answer, in either direction.
    pub const fn consent(&self) -> Option<&WorkerConsent> {
        match self {
            Self::Agreed { consent } | Self::Declined { consent } => Some(consent),
            _ => None,
        }
    }

    pub const fn withdrawal(&self) -> Option<&Authorization> {
        match self {
            Self::Withdrawn { withdrawal } => Some(withdrawal),
            _ => None,
        }
    }
}

/// The stored shape, so a row re-runs every rule it carries.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OvertimeOrderWire {
    pub id: OvertimeId,
    pub employee: EmployeeId,
    pub place: PlaceId,
    pub date: NaiveDate,
    pub day_kind: DayKind,
    pub planned: Minutes,
    pub ordered: Authorization,
    pub state: OvertimeState,
}

/// One instruction to work overtime, and its answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OvertimeOrder {
    id: OvertimeId,
    employee: EmployeeId,
    place: PlaceId,
    date: NaiveDate,
    day_kind: DayKind,
    planned: Minutes,
    ordered: Authorization,
    state: OvertimeState,
}

impl<'de> Deserialize<'de> for OvertimeOrder {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = OvertimeOrderWire::deserialize(deserializer)?;
        Self::try_new(wire).map_err(serde::de::Error::custom)
    }
}

impl OvertimeOrder {
    /// Issue the employer's written instruction.
    ///
    /// The order starts awaiting consent and authorizes nothing until the worker
    /// answers. The daily cap is checked here; the weekly one needs the rest of
    /// the week and is [`OvertimeOrder::check_weekly_limit`].
    // Eight parameters, and each one is a fact the order genuinely has to
    // carry. Bundling them into a struct would move the argument list, not
    // shorten it, and would give the shape a name nobody would recognise.
    #[allow(clippy::too_many_arguments)]
    pub fn order(
        id: OvertimeId,
        employee: EmployeeId,
        place: PlaceId,
        date: NaiveDate,
        day_kind: DayKind,
        planned: Minutes,
        policy: &OvertimePolicy,
        ordered: Authorization,
    ) -> Result<Self, OvertimeError> {
        if !ordered.authorizes_overtime_order() {
            return Err(OvertimeError::ActionForbidsOrder {
                action_key: ordered.action_key().to_owned(),
            });
        }
        if planned.is_zero() {
            return Err(OvertimeError::ZeroMinutes);
        }
        policy.check_daily(planned)?;
        Ok(Self {
            id,
            employee,
            place,
            date,
            day_kind,
            planned,
            ordered,
            state: OvertimeState::AwaitingConsent,
        })
    }

    /// Rebuild a stored order, re-running every rule it carries in itself.
    ///
    /// Both authority gates are re-checked: an order issued under a key that
    /// does not authorize one, and — the one that matters — a *consent*
    /// recorded under a key the worker does not hold. A rule only the live path
    /// enforces is a rule a round trip through storage removes, and this is the
    /// rule the module exists for.
    ///
    /// The caps are deliberately **not** re-checked: no policy is in scope
    /// here, and the caps that admitted a row are the ones that were in force
    /// when it was issued. Re-checking against today's would retrospectively
    /// invalidate orders that were lawful when they were made.
    pub fn try_new(wire: OvertimeOrderWire) -> Result<Self, OvertimeError> {
        if !wire.ordered.authorizes_overtime_order() {
            return Err(OvertimeError::ActionForbidsOrder {
                action_key: wire.ordered.action_key().to_owned(),
            });
        }
        if wire.planned.is_zero() {
            return Err(OvertimeError::ZeroMinutes);
        }
        if let Some(consent) = wire.state.consent() {
            if !consent.authorization().authorizes_overtime_consent() {
                return Err(OvertimeError::ActionForbidsConsent {
                    action_key: consent.authorization().action_key().to_owned(),
                });
            }
        }
        if let Some(withdrawal) = wire.state.withdrawal() {
            if !withdrawal.authorizes_overtime_order() {
                return Err(OvertimeError::ActionForbidsOrder {
                    action_key: withdrawal.action_key().to_owned(),
                });
            }
        }
        Ok(Self {
            id: wire.id,
            employee: wire.employee,
            place: wire.place,
            date: wire.date,
            day_kind: wire.day_kind,
            planned: wire.planned,
            ordered: wire.ordered,
            state: wire.state,
        })
    }

    /// The worker agrees.
    pub fn agree(&mut self, consent: WorkerConsent) -> Result<(), OvertimeError> {
        self.require_awaiting()?;
        self.state = OvertimeState::Agreed { consent };
        Ok(())
    }

    /// The worker says no.
    ///
    /// Terminal. There is no method that moves an order out of this state,
    /// because a refusal a senior enough person can reverse is not a refusal.
    pub fn decline(&mut self, consent: WorkerConsent) -> Result<(), OvertimeError> {
        self.require_awaiting()?;
        self.state = OvertimeState::Declined { consent };
        Ok(())
    }

    /// The employer withdraws the instruction before it is answered.
    ///
    /// Only while unanswered: an order the worker has already agreed to is a
    /// commitment they may have arranged their life around, and taking it back
    /// is a cancellation to record against the agreement, not an erasure of it.
    ///
    /// The state is checked before the key, so withdrawing an already-answered
    /// order reads as "it is answered" rather than as an authority problem —
    /// which is the true and more useful of the two.
    pub fn withdraw(&mut self, withdrawal: Authorization) -> Result<(), OvertimeError> {
        self.require_awaiting()?;
        if !withdrawal.authorizes_overtime_order() {
            return Err(OvertimeError::ActionForbidsOrder {
                action_key: withdrawal.action_key().to_owned(),
            });
        }
        self.state = OvertimeState::Withdrawn { withdrawal };
        Ok(())
    }

    fn require_awaiting(&self) -> Result<(), OvertimeError> {
        if self.state.is_awaiting_consent() {
            return Ok(());
        }
        Err(OvertimeError::OrderNotAwaitingConsent {
            state: self.state.code(),
        })
    }

    /// How many minutes this order actually authorizes.
    ///
    /// `None` unless the worker agreed. This is the whole point: an order
    /// nobody answered, or one that was refused or withdrawn, authorizes
    /// nothing, and a caller that wants a number has to deal with the absence
    /// rather than read a field that is populated either way.
    pub fn authorized_minutes(&self) -> Option<Minutes> {
        self.state.is_agreed().then_some(self.planned)
    }

    pub fn id(&self) -> &OvertimeId {
        &self.id
    }
    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn place(&self) -> &PlaceId {
        &self.place
    }
    pub const fn date(&self) -> NaiveDate {
        self.date
    }
    pub const fn day_kind(&self) -> DayKind {
        self.day_kind
    }
    /// The minutes ordered — what was asked for, agreed or not.
    pub const fn planned(&self) -> Minutes {
        self.planned
    }
    pub fn ordered(&self) -> &Authorization {
        &self.ordered
    }
    pub const fn state(&self) -> &OvertimeState {
        &self.state
    }

    /// Would agreeing to this order put the week over the ratified cap?
    ///
    /// `others` is the week's orders. Only the ones that were **agreed** count:
    /// an unanswered or refused order commits nobody to anything and must not
    /// consume somebody else's headroom. The caller supplies the week, because
    /// which seven days count as one is a rostering question this module does
    /// not own.
    pub fn check_weekly_limit(
        &self,
        others: &[OvertimeOrder],
        policy: &OvertimePolicy,
    ) -> Result<(), OvertimeError> {
        let mut total = self.planned.get();
        for other in others {
            if other.id == self.id {
                continue;
            }
            if let Some(minutes) = other.authorized_minutes() {
                total = total
                    .checked_add(minutes.get())
                    .ok_or(OvertimeError::MinutesOverflow)?;
            }
        }
        policy.check_weekly(Minutes::new(total))
    }
}

/// The Monday–Sunday window a date falls in.
///
/// The statutory week is stated as a week, not as "any rolling seven days", so
/// a fixed window is the honest reading. A rolling window would make the same
/// pair of orders lawful or not depending on which of them you asked about.
pub fn week_of(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    use chrono::{Datelike, Days};
    let back = u64::from(date.weekday().num_days_from_monday());
    // A date this near the representable edge cannot be reached by any calendar
    // an operator uses; falling back to the date itself narrows the window,
    // which refuses more overtime rather than less.
    let monday = date.checked_sub_days(Days::new(back)).unwrap_or(date);
    let sunday = monday.checked_add_days(Days::new(6)).unwrap_or(date);
    (monday, sunday)
}

/// The action keys this module records under, re-exported so a caller does not
/// have to reach into `employment::actions` to name them.
pub const ORDER_KEY: &str = actions::OVERTIME_ORDER;
pub const CONSENT_KEY: &str = actions::OVERTIME_CONSENT_OWN;
