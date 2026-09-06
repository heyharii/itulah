//! Clock positions on a shift timeline, and the month a period covers.
//!
//! # Why a 0..2879 timeline and not a timezone
//!
//! A shift is expressed in **place-local clock positions** anchored at the
//! roster date's midnight, so an overnight shift — 22:00 to 06:00 — is
//! `start 1320`, `end 360`, `end_day_offset 1`, and the arithmetic that says it
//! is eight hours long is subtraction. No timezone database, no DST branch, no
//! instant that means something different depending on where it is read.
//!
//! The alternative is storing two instants, which forces every reader to know
//! the place's zone and forces the schema to be right about a zone that can
//! change by government decree. A rota is written in clock time because that is
//! what a person reads off a wall.

use super::error::AttendanceError;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const MINUTES_PER_DAY: u16 = 1440;
pub const MAX_SHIFT_ID_LEN: usize = 64;

/// A shift template, by its id.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ShiftId(String);

impl ShiftId {
    pub fn try_new(raw: &str) -> Result<Self, AttendanceError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(AttendanceError::Required { field: "shift id" });
        }
        if trimmed.chars().any(char::is_control) {
            return Err(AttendanceError::NotPrintable { field: "shift id" });
        }
        if trimmed.chars().count() > MAX_SHIFT_ID_LEN {
            return Err(AttendanceError::TooLong {
                field: "shift id",
                max: MAX_SHIFT_ID_LEN,
            });
        }
        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ShiftId {
    type Error = AttendanceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<ShiftId> for String {
    fn from(value: ShiftId) -> Self {
        value.0
    }
}

impl fmt::Display for ShiftId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A place-local minute of the day, `00:00`..=`23:59`.
///
/// Serialized as `"HH:MM"` rather than as a number: a rota is read by people,
/// and a stored `1320` is a figure somebody has to divide before they can
/// check it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct MinuteOfDay(u16);

impl MinuteOfDay {
    pub fn try_new(minute: u16) -> Result<Self, AttendanceError> {
        if minute >= MINUTES_PER_DAY {
            return Err(AttendanceError::InvalidMinuteOfDay { minute });
        }
        Ok(Self(minute))
    }

    pub fn try_from_hm(hour: u8, minute: u8) -> Result<Self, AttendanceError> {
        if hour > 23 || minute > 59 {
            return Err(AttendanceError::InvalidMinuteOfDay {
                minute: u16::from(hour) * 60 + u16::from(minute),
            });
        }
        Self::try_new(u16::from(hour) * 60 + u16::from(minute))
    }

    /// Parse an `HH:MM` clock reading.
    pub fn parse(raw: &str) -> Result<Self, AttendanceError> {
        let (hour, minute) = raw
            .split_once(':')
            .ok_or(AttendanceError::UnreadableClockTime)?;
        Self::try_from_hm(
            hour.parse()
                .map_err(|_| AttendanceError::UnreadableClockTime)?,
            minute
                .parse()
                .map_err(|_| AttendanceError::UnreadableClockTime)?,
        )
    }

    pub const fn minutes(self) -> u16 {
        self.0
    }
    pub const fn hour(self) -> u8 {
        (self.0 / 60) as u8
    }
    pub const fn minute(self) -> u8 {
        (self.0 % 60) as u8
    }
}

impl fmt::Display for MinuteOfDay {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02}:{:02}", self.hour(), self.minute())
    }
}

impl From<MinuteOfDay> for String {
    fn from(value: MinuteOfDay) -> Self {
        value.to_string()
    }
}

impl TryFrom<String> for MinuteOfDay {
    type Error = AttendanceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

/// Whether a clock reading belongs to the roster date or the day after it.
///
/// Two values, not a general offset: a shift longer than a day is not a shift,
/// and admitting one would make "which date is this punch for" unanswerable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct DayOffset(u8);

impl DayOffset {
    pub const SAME_DAY: Self = Self(0);
    pub const NEXT_DAY: Self = Self(1);

    pub fn try_new(days: u8) -> Result<Self, AttendanceError> {
        match days {
            0 | 1 => Ok(Self(days)),
            _ => Err(AttendanceError::ShiftSpansMoreThanADay { days }),
        }
    }

    pub const fn days(self) -> u8 {
        self.0
    }
}

impl TryFrom<u8> for DayOffset {
    type Error = AttendanceError;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::try_new(value)
    }
}

impl From<DayOffset> for u8 {
    fn from(value: DayOffset) -> Self {
        value.0
    }
}

/// A position on the shift timeline: minutes since the roster date's midnight.
///
/// Both components are validated before it is built, so the arithmetic is total
/// and cannot overflow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ShiftPosition(u16);

impl ShiftPosition {
    pub const fn new(offset: DayOffset, minute: MinuteOfDay) -> Self {
        Self(offset.days() as u16 * MINUTES_PER_DAY + minute.minutes())
    }

    pub const fn minutes(self) -> u16 {
        self.0
    }

    /// Minutes forward from `self` to `other`, or `None` when `other` is
    /// earlier.
    ///
    /// Saturating arithmetic is deliberately **not** used: "how late" and "how
    /// early" must never silently become zero.
    pub const fn minutes_until(self, other: Self) -> Option<u16> {
        other.0.checked_sub(self.0)
    }
}

impl fmt::Display for ShiftPosition {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "+{}m", self.0)
    }
}

/// The month one attendance period covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct AttendanceMonth {
    // Field order is the comparison order, so `derive(Ord)` gives chronological
    // ordering for free.
    year: i32,
    month: u8,
}

impl AttendanceMonth {
    pub fn try_new(year: i32, month: u8) -> Result<Self, AttendanceError> {
        if !(1..=12).contains(&month) {
            return Err(AttendanceError::UnreadablePeriod);
        }
        Ok(Self { year, month })
    }

    pub fn of(date: NaiveDate) -> Self {
        Self {
            year: date.year(),
            month: u8::try_from(date.month()).unwrap_or(1),
        }
    }

    pub const fn year(self) -> i32 {
        self.year
    }
    pub const fn month(self) -> u8 {
        self.month
    }

    pub fn contains(self, date: NaiveDate) -> bool {
        date.year() == self.year && u32::from(self.month) == date.month()
    }

    /// The first day, which is how the period is stored.
    pub fn first_day(self) -> Option<NaiveDate> {
        NaiveDate::from_ymd_opt(self.year, u32::from(self.month), 1)
    }

    pub fn parse(raw: &str) -> Result<Self, AttendanceError> {
        let (year, month) = raw
            .split_once('-')
            .ok_or(AttendanceError::UnreadablePeriod)?;
        Self::try_new(
            year.parse()
                .map_err(|_| AttendanceError::UnreadablePeriod)?,
            month
                .parse()
                .map_err(|_| AttendanceError::UnreadablePeriod)?,
        )
    }
}

impl fmt::Display for AttendanceMonth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}", self.year, self.month)
    }
}

impl From<AttendanceMonth> for String {
    fn from(value: AttendanceMonth) -> Self {
        value.to_string()
    }
}

impl TryFrom<String> for AttendanceMonth {
    type Error = AttendanceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}
