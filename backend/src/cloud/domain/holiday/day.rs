//! One red day: when it is, what it is called, what kind it is, and where it
//! is observed.
//!
//! # Cuti bersama is not an ordinary holiday
//!
//! By the same joint decree that announces it, *cuti bersama* is **charged
//! against the employee's annual leave**: the company closes and the days come
//! out of the twelve. Modelling it and a national holiday both as "a red day on
//! the calendar" is how a leave balance ends up wrong by exactly the number of
//! long weekends in the year — in the employee's favour on paper and against
//! them in practice, because nobody discovers it until December.
//!
//! So [`HolidayKind`] distinguishes them and [`Holiday::consumes_annual_leave`]
//! is the question the leave kernel asks. Only `CutiBersama` answers yes, and
//! it does, which is the part people forget.

use super::error::HolidayError;
use crate::cloud::domain::employment::UnitId;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

pub const MAX_NAME_LEN: usize = 140;

/// What a holiday is called, on the calendar an operator reads.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct HolidayName(String);

impl HolidayName {
    pub fn try_new(raw: &str) -> Result<Self, HolidayError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(HolidayError::Required { field: "name" });
        }
        if trimmed.chars().any(char::is_control) {
            return Err(HolidayError::NotPrintable { field: "name" });
        }
        if trimmed.chars().count() > MAX_NAME_LEN {
            return Err(HolidayError::TooLong {
                field: "name",
                max: MAX_NAME_LEN,
            });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for HolidayName {
    type Error = HolidayError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<HolidayName> for String {
    fn from(value: HolidayName) -> Self {
        value.0
    }
}

impl std::fmt::Display for HolidayName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Which kind of red day this is.
///
/// The distinction that matters is the third question below, not the first
/// two: whether the day comes out of somebody's annual leave.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HolidayKind {
    /// A national public holiday. Nobody works and nobody's balance moves.
    National,
    /// A collective leave day: the company closes and the day is charged
    /// against annual leave.
    CutiBersama,
    /// Observed in some places and not others — Nyepi in Bali, a local
    /// anniversary. Must name the places that observe it.
    Regional,
}

impl HolidayKind {
    pub const fn code(self) -> &'static str {
        match self {
            Self::National => "NATIONAL",
            Self::CutiBersama => "CUTI_BERSAMA",
            Self::Regional => "REGIONAL",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "NATIONAL" => Some(Self::National),
            "CUTI_BERSAMA" => Some(Self::CutiBersama),
            "REGIONAL" => Some(Self::Regional),
            _ => None,
        }
    }

    /// Does this day come out of the employee's annual leave?
    ///
    /// The question the leave kernel asks. Only [`HolidayKind::CutiBersama`]
    /// answers yes — and it does.
    pub const fn consumes_annual_leave(self) -> bool {
        matches!(self, Self::CutiBersama)
    }
}

/// Where a holiday is observed.
///
/// Deliberately not `Option<Vec<UnitId>>`. `None` there would have to mean
/// both "everywhere" and "nobody has said", and those are opposite
/// instructions; here "everywhere" is a stated decision rather than the absence
/// of one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HolidayScope {
    Nationwide,
    Units { units: Vec<UnitId> },
}

impl HolidayScope {
    /// A scope naming no units is refused: it would read as "observed
    /// nowhere", which is not a holiday, and it is one deleted line away from
    /// an operator's mistake.
    pub fn units(units: Vec<UnitId>) -> Result<Self, HolidayError> {
        if units.is_empty() {
            return Err(HolidayError::EmptyScope);
        }
        Ok(Self::Units { units })
    }

    pub fn covers(&self, unit: &UnitId) -> bool {
        match self {
            Self::Nationwide => true,
            Self::Units { units } => units.contains(unit),
        }
    }

    /// The units named, when this scope names any.
    pub fn named(&self) -> Option<&[UnitId]> {
        match self {
            Self::Nationwide => None,
            Self::Units { units } => Some(units),
        }
    }
}

/// The wire shape, so decoding goes through [`Holiday::try_new`].
///
/// A shim rather than a derived `Deserialize` on the real type: a stored row or
/// a request body that skipped the constructor could carry a regional day
/// observed nowhere, and that value would then be a holiday nobody approved as
/// one.
///
/// `units` carries the scope as a plain list because that is the shape both
/// the operator's form and the stored JSON want. Empty means nationwide, and it
/// is unambiguous only because a scope naming no units is refused: `[]` cannot
/// mean "observed nowhere", because no such holiday can exist.
///
/// Stored under the key `places`, which is what every published calendar and
/// every amendment in `holiday_calendar` already says. The ids in it are unit
/// ids and always were — 0600 keyed the units like the places they replaced —
/// so only the word is old, and rewriting each calendar's whole amendment
/// history to change a JSON key would put the history at risk for nothing.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HolidayWire {
    pub date: NaiveDate,
    pub name: HolidayName,
    pub kind: HolidayKind,
    #[serde(default, rename = "places")]
    pub units: Vec<UnitId>,
}

/// One holiday.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "HolidayWire", into = "HolidayWire")]
pub struct Holiday {
    date: NaiveDate,
    name: HolidayName,
    kind: HolidayKind,
    scope: HolidayScope,
}

impl TryFrom<HolidayWire> for Holiday {
    type Error = HolidayError;
    fn try_from(wire: HolidayWire) -> Result<Self, Self::Error> {
        let scope = if wire.units.is_empty() {
            HolidayScope::Nationwide
        } else {
            HolidayScope::units(wire.units)?
        };
        Self::try_new(wire.date, wire.name, wire.kind, scope)
    }
}

impl From<Holiday> for HolidayWire {
    fn from(holiday: Holiday) -> Self {
        Self {
            date: holiday.date,
            name: holiday.name,
            kind: holiday.kind,
            units: match holiday.scope {
                HolidayScope::Nationwide => Vec::new(),
                HolidayScope::Units { units } => units,
            },
        }
    }
}

impl Holiday {
    /// Two combinations are refused, and both are contradictions that would
    /// otherwise become quiet facts.
    ///
    /// "Regional, everywhere" is a national holiday nobody approved as one.
    /// "National, but only in these shops" is the reverse: a day the law gives
    /// everybody, withheld from most of them by a data-entry slip.
    pub fn try_new(
        date: NaiveDate,
        name: HolidayName,
        kind: HolidayKind,
        scope: HolidayScope,
    ) -> Result<Self, HolidayError> {
        match (kind, &scope) {
            (HolidayKind::Regional, HolidayScope::Nationwide) => {
                return Err(HolidayError::RegionalHolidayWithoutUnits { date });
            }
            (HolidayKind::National | HolidayKind::CutiBersama, HolidayScope::Units { .. }) => {
                return Err(HolidayError::NationalHolidayScopedToUnits { date });
            }
            _ => {}
        }
        Ok(Self {
            date,
            name,
            kind,
            scope,
        })
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }
    pub fn name(&self) -> &HolidayName {
        &self.name
    }
    pub fn kind(&self) -> HolidayKind {
        self.kind
    }
    pub fn scope(&self) -> &HolidayScope {
        &self.scope
    }

    pub fn applies_at(&self, unit: &UnitId) -> bool {
        self.scope.covers(unit)
    }

    pub const fn consumes_annual_leave(&self) -> bool {
        self.kind.consumes_annual_leave()
    }
}
