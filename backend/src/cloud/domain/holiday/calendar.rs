//! A year of red days: published once, amended for ever after.
//!
//! # Why the current set is never stored
//!
//! What a calendar holds is the set **as published** plus an append-only list
//! of amendments. The set in force today is those replayed, and it is computed
//! on the way in rather than kept beside them. Storing both would mean the same
//! facts twice, and the copy that drifts is always the one queries read.
//!
//! It also buys the question payroll actually asks. A March run recomputed in
//! June has to see March's calendar, not June's — the government moves a *cuti
//! bersama* by decree in the middle of a year, and a recomputation that silently
//! used the new set would change what a settled month was owed.
//! [`HolidayCalendar::as_published_at`] answers that by replaying only the
//! amendments that had happened by an instant.

use super::day::Holiday;
use super::error::HolidayError;
use crate::cloud::domain::employment::{Authorization, PlaceId};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// What one amendment did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "change", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CalendarChange {
    Added { holiday: Holiday },
    Removed { holiday: Holiday },
}

impl CalendarChange {
    pub fn date(&self) -> NaiveDate {
        match self {
            Self::Added { holiday } | Self::Removed { holiday } => holiday.date(),
        }
    }

    pub const fn code(&self) -> &'static str {
        match self {
            Self::Added { .. } => "ADDED",
            Self::Removed { .. } => "REMOVED",
        }
    }
}

/// One amendment, with the authority behind it.
///
/// No public constructor: the only way to make one is
/// [`HolidayCalendar::amend`], which checks the authority and the change
/// together. A separately-constructible amendment would be a change nobody had
/// to be allowed to make.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalendarAmendment {
    change: CalendarChange,
    authorization: Authorization,
}

impl CalendarAmendment {
    pub fn change(&self) -> &CalendarChange {
        &self.change
    }
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }
}

/// The stored shape, so decoding replays rather than trusts.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HolidayCalendarWire {
    pub year: i32,
    pub holidays: Vec<Holiday>,
    pub published: Authorization,
    #[serde(default)]
    pub amendments: Vec<CalendarAmendment>,
}

/// One year's calendar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "HolidayCalendarWire")]
pub struct HolidayCalendar {
    year: i32,
    /// The set as first published — the only holiday data that is stored.
    #[serde(rename = "holidays", serialize_with = "holidays_as_list")]
    published_holidays: BTreeMap<NaiveDate, Holiday>,
    published: Authorization,
    amendments: Vec<CalendarAmendment>,
    /// Derived, never stored. See the module doc.
    #[serde(skip)]
    current: BTreeMap<NaiveDate, Holiday>,
}

fn holidays_as_list<S>(
    holidays: &BTreeMap<NaiveDate, Holiday>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.collect_seq(holidays.values())
}

impl TryFrom<HolidayCalendarWire> for HolidayCalendar {
    type Error = HolidayError;
    fn try_from(wire: HolidayCalendarWire) -> Result<Self, Self::Error> {
        Self::try_new(wire.year, wire.holidays, wire.published, wire.amendments)
    }
}

impl HolidayCalendar {
    /// Publish a year. There is no unpublish and no republish: a year is
    /// published once and changed by amendment after that, because replacing
    /// the approved set wholesale would take its history with it.
    pub fn publish(
        year: i32,
        holidays: Vec<Holiday>,
        authorization: Authorization,
    ) -> Result<Self, HolidayError> {
        Self::try_new(year, holidays, authorization, Vec::new())
    }

    /// Rebuild from storage, re-running every rule.
    ///
    /// The amendments are **replayed** rather than trusted: a stored row whose
    /// amendment chain does not produce a legal calendar fails to load instead
    /// of becoming the answer. That is the same guarantee `Employee` gives over
    /// its history and `Profile` over its own.
    pub fn try_new(
        year: i32,
        holidays: Vec<Holiday>,
        published: Authorization,
        amendments: Vec<CalendarAmendment>,
    ) -> Result<Self, HolidayError> {
        if !published.authorizes_holiday_change() {
            return Err(HolidayError::ActionForbidsCalendarChange {
                action_key: published.action_key().to_owned(),
            });
        }
        let mut set = BTreeMap::new();
        for holiday in holidays {
            check_year(year, holiday.date())?;
            if set.insert(holiday.date(), holiday.clone()).is_some() {
                // Two holidays cannot share a day. If Nyepi and a national
                // holiday genuinely coincide, that is one day off with one
                // name, and which name it carries is the operator's call at
                // entry — not a question left to whichever row a query
                // happened to return first.
                return Err(HolidayError::DuplicateHoliday {
                    date: holiday.date(),
                });
            }
        }
        let mut calendar = Self {
            year,
            current: set.clone(),
            published_holidays: set,
            published,
            amendments: Vec::new(),
        };
        for amendment in amendments {
            calendar.apply(amendment.change, amendment.authorization)?;
        }
        Ok(calendar)
    }

    /// Add or withdraw one day.
    ///
    /// One key covers publishing and amending, deliberately: adding a *cuti
    /// bersama* in March is the same act with the same consequence as
    /// publishing the year in January — it changes what people are owed.
    /// Splitting the two would suggest the later change is the smaller one, and
    /// it is usually the larger, because by then the year is running.
    pub fn amend(
        &mut self,
        change: CalendarChange,
        authorization: Authorization,
    ) -> Result<(), HolidayError> {
        self.apply(change, authorization)
    }

    fn apply(
        &mut self,
        change: CalendarChange,
        authorization: Authorization,
    ) -> Result<(), HolidayError> {
        if !authorization.authorizes_holiday_change() {
            return Err(HolidayError::ActionForbidsCalendarChange {
                action_key: authorization.action_key().to_owned(),
            });
        }
        check_year(self.year, change.date())?;
        match &change {
            CalendarChange::Added { holiday } => {
                if self.current.contains_key(&holiday.date()) {
                    return Err(HolidayError::DuplicateHoliday {
                        date: holiday.date(),
                    });
                }
                self.current.insert(holiday.date(), holiday.clone());
            }
            CalendarChange::Removed { holiday } => {
                match self.current.get(&holiday.date()) {
                    None => {
                        return Err(HolidayError::NoSuchHoliday {
                            date: holiday.date(),
                        })
                    }
                    // The withdrawal has to name the day it is withdrawing. A
                    // removal that matched only on the date would let an
                    // operator delete a national holiday while believing they
                    // had removed a regional one.
                    Some(held) if held != holiday => {
                        return Err(HolidayError::RemovalDoesNotMatch {
                            date: holiday.date(),
                        });
                    }
                    Some(_) => {
                        self.current.remove(&holiday.date());
                    }
                }
            }
        }
        self.amendments.push(CalendarAmendment {
            change,
            authorization,
        });
        Ok(())
    }

    pub fn year(&self) -> i32 {
        self.year
    }
    pub fn published(&self) -> &Authorization {
        &self.published
    }
    pub fn amendments(&self) -> &[CalendarAmendment] {
        &self.amendments
    }

    /// The set in force, in date order.
    pub fn holidays(&self) -> impl Iterator<Item = &Holiday> {
        self.current.values()
    }

    /// The set as first published, which is what storage keeps.
    pub fn as_published(&self) -> impl Iterator<Item = &Holiday> {
        self.published_holidays.values()
    }

    /// Is this a red day at this place?
    pub fn on(&self, date: NaiveDate, place: &PlaceId) -> Option<&Holiday> {
        self.current
            .get(&date)
            .filter(|holiday| holiday.applies_at(place))
    }

    pub fn is_holiday(&self, date: NaiveDate, place: &PlaceId) -> bool {
        self.on(date, place).is_some()
    }

    /// Every red day in a span, inclusive of both ends.
    pub fn between<'a>(
        &'a self,
        from: NaiveDate,
        to: NaiveDate,
        place: &'a PlaceId,
    ) -> impl Iterator<Item = &'a Holiday> {
        self.current
            .range(from..=to)
            .map(|(_, holiday)| holiday)
            .filter(move |holiday| holiday.applies_at(place))
    }

    /// How many days in a span come out of annual leave.
    pub fn cuti_bersama_days(&self, from: NaiveDate, to: NaiveDate, place: &PlaceId) -> usize {
        self.between(from, to, place)
            .filter(|holiday| holiday.consumes_annual_leave())
            .count()
    }

    /// The calendar as it stood at an instant.
    ///
    /// Replays only the amendments that had happened by then. This is what makes
    /// a recomputation of a settled month reproducible: a *cuti bersama* added
    /// in June cannot change what March was charged.
    pub fn as_published_at(&self, instant: DateTime<Utc>) -> Result<Self, HolidayError> {
        let amendments: Vec<CalendarAmendment> = self
            .amendments
            .iter()
            .filter(|amendment| amendment.authorization().at() <= instant)
            .cloned()
            .collect();
        Self::try_new(
            self.year,
            self.published_holidays.values().cloned().collect(),
            self.published.clone(),
            amendments,
        )
    }
}

fn check_year(year: i32, date: NaiveDate) -> Result<(), HolidayError> {
    if date.year() == year {
        return Ok(());
    }
    Err(HolidayError::DateOutsideCalendarYear { date, year })
}

#[cfg(test)]
mod tests {
    use super::super::day::{HolidayKind, HolidayName, HolidayScope};
    use super::*;
    use crate::cloud::domain::actions;

    fn authority(reason: &str) -> Authorization {
        Authorization::try_new(
            "hr.dewi",
            actions::HOLIDAY_SET,
            DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant")),
            reason,
        )
        .unwrap_or_else(|error| panic!("authority: {error}"))
    }

    fn later(seconds: i64, reason: &str) -> Authorization {
        Authorization::try_new(
            "hr.dewi",
            actions::HOLIDAY_SET,
            DateTime::from_timestamp(1_780_000_000 + seconds, 0)
                .unwrap_or_else(|| panic!("instant")),
            reason,
        )
        .unwrap_or_else(|error| panic!("authority: {error}"))
    }

    fn day(date: &str, name: &str, kind: HolidayKind) -> Holiday {
        Holiday::try_new(
            date.parse().unwrap_or_else(|error| panic!("date: {error}")),
            HolidayName::try_new(name).unwrap_or_else(|error| panic!("name: {error}")),
            kind,
            HolidayScope::Nationwide,
        )
        .unwrap_or_else(|error| panic!("holiday: {error}"))
    }

    fn place() -> PlaceId {
        PlaceId::try_new("store-07").unwrap_or_else(|error| panic!("place: {error}"))
    }

    #[test]
    fn a_regional_day_that_names_nowhere_is_not_representable() {
        let error = Holiday::try_new(
            "2026-03-19"
                .parse()
                .unwrap_or_else(|error| panic!("date: {error}")),
            HolidayName::try_new("Nyepi").unwrap_or_else(|error| panic!("name: {error}")),
            HolidayKind::Regional,
            HolidayScope::Nationwide,
        )
        .unwrap_err();
        assert_eq!(error.code(), "holiday_regional_without_places");
    }

    #[test]
    fn a_national_day_cannot_be_narrowed_to_some_shops() {
        let error = Holiday::try_new(
            "2026-08-17"
                .parse()
                .unwrap_or_else(|error| panic!("date: {error}")),
            HolidayName::try_new("Hari Kemerdekaan")
                .unwrap_or_else(|error| panic!("name: {error}")),
            HolidayKind::National,
            HolidayScope::places(vec![place()]).unwrap_or_else(|error| panic!("scope: {error}")),
        )
        .unwrap_err();
        assert_eq!(error.code(), "holiday_national_scoped");
    }

    /// The whole reason `HolidayKind` is three values and not a boolean.
    #[test]
    fn only_cuti_bersama_comes_out_of_the_twelve() {
        let calendar = HolidayCalendar::publish(
            2026,
            vec![
                day("2026-03-20", "Idul Fitri", HolidayKind::National),
                day("2026-03-23", "Cuti Bersama", HolidayKind::CutiBersama),
                day("2026-03-24", "Cuti Bersama", HolidayKind::CutiBersama),
            ],
            authority("SKB 2026"),
        )
        .unwrap_or_else(|error| panic!("publish: {error}"));

        let from = "2026-03-01"
            .parse()
            .unwrap_or_else(|error| panic!("date: {error}"));
        let to = "2026-03-31"
            .parse()
            .unwrap_or_else(|error| panic!("date: {error}"));
        assert_eq!(calendar.between(from, to, &place()).count(), 3);
        assert_eq!(calendar.cuti_bersama_days(from, to, &place()), 2);
    }

    #[test]
    fn a_day_outside_the_year_is_refused() {
        let error = HolidayCalendar::publish(
            2026,
            vec![day("2027-01-01", "Tahun Baru", HolidayKind::National)],
            authority("SKB 2026"),
        )
        .unwrap_err();
        assert_eq!(error.code(), "holiday_outside_calendar_year");
    }

    #[test]
    fn withdrawing_a_day_the_calendar_does_not_hold_is_a_conflict() {
        let mut calendar = HolidayCalendar::publish(2026, Vec::new(), authority("SKB 2026"))
            .unwrap_or_else(|error| panic!("publish: {error}"));
        let error = calendar
            .amend(
                CalendarChange::Removed {
                    holiday: day("2026-05-01", "Hari Buruh", HolidayKind::National),
                },
                later(60, "salah entri"),
            )
            .unwrap_err();
        assert_eq!(error.code(), "holiday_not_found");
        assert!(error.is_conflict());
    }

    /// The question payroll asks in June about March.
    #[test]
    fn a_recomputation_sees_the_calendar_the_month_was_settled_under() {
        let mut calendar = HolidayCalendar::publish(
            2026,
            vec![day("2026-03-20", "Idul Fitri", HolidayKind::National)],
            authority("SKB 2026"),
        )
        .unwrap_or_else(|error| panic!("publish: {error}"));
        calendar
            .amend(
                CalendarChange::Added {
                    holiday: day("2026-03-25", "Cuti Bersama", HolidayKind::CutiBersama),
                },
                later(86_400, "SKB revisi"),
            )
            .unwrap_or_else(|error| panic!("amend: {error}"));

        assert_eq!(calendar.holidays().count(), 2);

        let before =
            DateTime::from_timestamp(1_780_000_030, 0).unwrap_or_else(|| panic!("instant"));
        let settled = calendar
            .as_published_at(before)
            .unwrap_or_else(|error| panic!("replay: {error}"));
        assert_eq!(
            settled.holidays().count(),
            1,
            "the added day had not happened yet"
        );
    }

    /// A stored row whose history does not produce it does not load.
    #[test]
    fn a_calendar_authorized_under_the_wrong_key_refuses_to_hydrate() {
        let wrong = Authorization::try_new(
            "kasir.siti",
            actions::EMPLOYEE_READ,
            DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant")),
            "melihat",
        )
        .unwrap_or_else(|error| panic!("authority: {error}"));
        let error = HolidayCalendar::try_new(2026, Vec::new(), wrong, Vec::new()).unwrap_err();
        assert_eq!(error.code(), "holiday_action_forbids_change");
    }
}
