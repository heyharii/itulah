//! Shift templates and the dated roster.
//!
//! A roster is the **plan**: for one person, what each dated day is supposed to
//! be. Nothing about attendance means anything without it — "absent" only exists
//! against a scheduled day, and a day nobody was scheduled for cannot be an
//! absence.
//!
//! # The roster is a payroll input, and is treated like one
//!
//! Because "absent" is defined against the plan, the plan is upstream of money.
//! Two properties follow, and both are structural here rather than a matter of
//! caller discipline:
//!
//! * **every day names who planned it.** [`RosterDay`] cannot be built without
//!   an [`Authorization`] that carries the roster key, so nobody schedules
//!   themselves and no plan is anonymous.
//! * **revisions are append-only, dated, and frozen by the close.** A revision
//!   is appended with its own evidence; the previous plan stays answerable via
//!   [`RosterDay::plan_as_of`]; and once the `(place, month)` is closed, both
//!   [`DatedRoster::insert`] and [`DatedRoster::revise`] refuse.
//!
//! That last rule is the one worth stating twice. The dangerous edit is not
//! tomorrow's plan — it is quietly adding a scheduled day to a month already
//! counted, which turns a day nobody worked into an absence, and an absence into
//! a deduction basis. A retroactive edit would silently expand the basis of a
//! month that has already been paid.

use super::error::AttendanceError;
use super::period::AttendancePeriod;
use super::policy::Minutes;
use super::punch::PunchTime;
use super::time::{DayOffset, MinuteOfDay, ShiftId, ShiftPosition};
use crate::cloud::domain::employment::{Authorization, EmployeeId, PlaceId};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// A shift template: when it starts, when it ends, and how much of it is unpaid
/// break.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "ShiftWire")]
pub struct Shift {
    id: ShiftId,
    name: String,
    start: MinuteOfDay,
    end: MinuteOfDay,
    end_day_offset: DayOffset,
    unpaid_break: Minutes,
}

/// Deserialization shim, so a stored shift re-runs its constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShiftWire {
    pub id: ShiftId,
    pub name: String,
    pub start: MinuteOfDay,
    pub end: MinuteOfDay,
    pub end_day_offset: DayOffset,
    pub unpaid_break: Minutes,
}

impl TryFrom<ShiftWire> for Shift {
    type Error = AttendanceError;
    fn try_from(wire: ShiftWire) -> Result<Self, Self::Error> {
        Self::try_new(
            wire.id,
            &wire.name,
            wire.start,
            wire.end,
            wire.end_day_offset,
            wire.unpaid_break,
        )
    }
}

impl Shift {
    /// Build a shift, refusing a non-positive span and a break at least as long
    /// as the span — the second because a shift that is all break is paid time
    /// nobody is being paid for.
    pub fn try_new(
        id: ShiftId,
        name: &str,
        start: MinuteOfDay,
        end: MinuteOfDay,
        end_day_offset: DayOffset,
        unpaid_break: Minutes,
    ) -> Result<Self, AttendanceError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AttendanceError::Required {
                field: "shift name",
            });
        }
        let span = ShiftPosition::new(DayOffset::SAME_DAY, start)
            .minutes_until(ShiftPosition::new(end_day_offset, end))
            .filter(|minutes| *minutes > 0)
            .ok_or(AttendanceError::ShiftEndNotAfterStart)?;
        if unpaid_break.get() >= u32::from(span) {
            return Err(AttendanceError::ShiftBreakTooLong);
        }
        Ok(Self {
            id,
            name: name.to_owned(),
            start,
            end,
            end_day_offset,
            unpaid_break,
        })
    }

    pub fn id(&self) -> &ShiftId {
        &self.id
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub const fn start(&self) -> MinuteOfDay {
        self.start
    }
    pub const fn end(&self) -> MinuteOfDay {
        self.end
    }
    pub const fn end_day_offset(&self) -> DayOffset {
        self.end_day_offset
    }
    pub const fn unpaid_break(&self) -> Minutes {
        self.unpaid_break
    }

    pub const fn start_position(&self) -> ShiftPosition {
        ShiftPosition::new(DayOffset::SAME_DAY, self.start)
    }
    pub const fn end_position(&self) -> ShiftPosition {
        ShiftPosition::new(self.end_day_offset, self.end)
    }

    /// The planned span, break included. Total by construction: `try_new`
    /// proved the end is after the start.
    pub fn planned_span(&self) -> Minutes {
        Minutes::new(u32::from(
            self.start_position()
                .minutes_until(self.end_position())
                .unwrap_or(0),
        ))
    }

    /// The planned *paid* minutes: the span less the unpaid break.
    pub fn planned_work(&self) -> Minutes {
        Minutes::new(
            self.planned_span()
                .get()
                .saturating_sub(self.unpaid_break.get()),
        )
    }

    pub fn crosses_midnight(&self) -> bool {
        self.end_day_offset == DayOffset::NEXT_DAY
    }
}

/// What a dated day is planned to be.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "plan", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DayPlan {
    /// A working day with a planned shift.
    Scheduled { shift: Shift },
    /// A planned non-working day — the weekly rest.
    RestDay,
    /// A public holiday.
    PublicHoliday,
}

impl DayPlan {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Scheduled { .. } => "SCHEDULED",
            Self::RestDay => "REST_DAY",
            Self::PublicHoliday => "PUBLIC_HOLIDAY",
        }
    }

    pub const fn shift(&self) -> Option<&Shift> {
        match self {
            Self::Scheduled { shift } => Some(shift),
            _ => None,
        }
    }

    pub const fn is_working(&self) -> bool {
        matches!(self, Self::Scheduled { .. })
    }
}

/// One authorized statement of what a dated day is planned to be.
///
/// A roster day is not a field that gets overwritten: it is a list of these,
/// append-only and ordered by the authorizing instant. "The plan" is the last
/// revision; "the plan payroll saw" is [`RosterDay::plan_as_of`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RosterRevision {
    plan: DayPlan,
    authorization: Authorization,
}

impl RosterRevision {
    pub fn try_new(plan: DayPlan, authorization: Authorization) -> Result<Self, AttendanceError> {
        if !authorization.authorizes_roster_change() {
            return Err(AttendanceError::ActionForbidsRosterChange {
                action_key: authorization.action_key().to_owned(),
            });
        }
        Ok(Self {
            plan,
            authorization,
        })
    }

    pub const fn plan(&self) -> &DayPlan {
        &self.plan
    }
    pub const fn authorization(&self) -> &Authorization {
        &self.authorization
    }
    /// The instant that orders the list.
    pub fn effective_at(&self) -> DateTime<Utc> {
        self.authorization.at()
    }
}

/// The stored shape, so a row re-runs every rule it carries.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RosterDayWire {
    pub employee: EmployeeId,
    pub place: PlaceId,
    pub date: NaiveDate,
    pub planned: RosterRevision,
    #[serde(default)]
    pub amendments: Vec<RosterRevision>,
}

/// One dated roster entry, with the append-only history of how it came to say
/// what it says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RosterDay {
    employee: EmployeeId,
    place: PlaceId,
    date: NaiveDate,
    // Split rather than one `Vec` so "a rostered day has at least one
    // authorized plan" is a property of the *type*: there is no empty case to
    // handle, and therefore no panic path in `plan()`.
    planned: RosterRevision,
    amendments: Vec<RosterRevision>,
}

impl<'de> Deserialize<'de> for RosterDay {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = RosterDayWire::deserialize(deserializer)?;
        Self::try_new(
            wire.employee,
            wire.place,
            wire.date,
            wire.planned,
            wire.amendments,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl RosterDay {
    /// Plan a day: the first, authorized revision.
    pub fn new(
        employee: EmployeeId,
        place: PlaceId,
        date: NaiveDate,
        plan: DayPlan,
        authorization: Authorization,
    ) -> Result<Self, AttendanceError> {
        Ok(Self {
            employee,
            place,
            date,
            planned: RosterRevision::try_new(plan, authorization)?,
            amendments: Vec::new(),
        })
    }

    /// Rebuild from storage, re-running every rule.
    ///
    /// Refuses a revision authorized by a key that may not plan, and an
    /// amendment list whose instants are not non-decreasing — the property that
    /// makes [`RosterDay::plan_as_of`] independent of storage order.
    pub fn try_new(
        employee: EmployeeId,
        place: PlaceId,
        date: NaiveDate,
        planned: RosterRevision,
        amendments: Vec<RosterRevision>,
    ) -> Result<Self, AttendanceError> {
        let day = Self {
            employee,
            place,
            date,
            planned,
            amendments,
        };
        for revision in day.revisions() {
            if !revision.authorization.authorizes_roster_change() {
                return Err(AttendanceError::ActionForbidsRosterChange {
                    action_key: revision.authorization.action_key().to_owned(),
                });
            }
        }
        let mut previous = day.planned.effective_at();
        for amendment in &day.amendments {
            if amendment.effective_at() < previous {
                return Err(AttendanceError::RosterRevisionNotForward);
            }
            previous = amendment.effective_at();
        }
        Ok(day)
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

    /// Every revision, oldest first. Never empty: the original plan is always
    /// the first item.
    pub fn revisions(&self) -> impl Iterator<Item = &RosterRevision> {
        std::iter::once(&self.planned).chain(self.amendments.iter())
    }

    /// How many times the day has been planned. A day revised many times is a
    /// governance signal, so the count is first-class.
    pub fn revision_count(&self) -> usize {
        1 + self.amendments.len()
    }

    pub const fn original_revision(&self) -> &RosterRevision {
        &self.planned
    }

    /// The revision in force. Total by construction — the original plan is a
    /// field, not an optional list entry.
    pub fn current_revision(&self) -> &RosterRevision {
        self.amendments.last().unwrap_or(&self.planned)
    }

    pub fn plan(&self) -> &DayPlan {
        self.current_revision().plan()
    }

    pub fn authorization(&self) -> &Authorization {
        self.current_revision().authorization()
    }

    pub fn amendments(&self) -> &[RosterRevision] {
        &self.amendments
    }

    /// The plan as it stood at an instant — `None` if the day had not been
    /// planned yet.
    ///
    /// This is what makes a past payroll run reproducible: a later revision
    /// cannot rewrite what the closing actor was looking at.
    pub fn plan_as_of(&self, at: DateTime<Utc>) -> Option<&DayPlan> {
        self.revisions()
            .take_while(|revision| revision.effective_at() <= at)
            .last()
            .map(RosterRevision::plan)
    }

    pub fn shift(&self) -> Option<&Shift> {
        self.plan().shift()
    }

    /// Append a revision. The caller must already have established that the
    /// day's period is open — [`DatedRoster::revise`] is the checked path.
    fn push_revision(&mut self, revision: RosterRevision) -> Result<(), AttendanceError> {
        if revision.effective_at() < self.current_revision().effective_at() {
            return Err(AttendanceError::RosterRevisionNotForward);
        }
        self.amendments.push(revision);
        Ok(())
    }
}

/// One person's dated roster: at most one plan per date.
///
/// One shift per person per date, deliberately. Split shifts and two same-day
/// assignments are not representable, because admitting them would make "which
/// shift was this for?" ambiguous — and an ambiguous attendance record is worse
/// than a refused one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DatedRoster {
    employee: EmployeeId,
    days: Vec<RosterDay>,
}

impl DatedRoster {
    pub fn new(employee: EmployeeId) -> Self {
        Self {
            employee,
            days: Vec::new(),
        }
    }

    /// Build from entries in any order: sorted by date, and refusing a second
    /// entry for one date or any entry belonging to somebody else.
    pub fn try_new(
        employee: EmployeeId,
        mut days: Vec<RosterDay>,
    ) -> Result<Self, AttendanceError> {
        if days.iter().any(|day| day.employee != employee) {
            return Err(AttendanceError::RosterEmployeeMismatch);
        }
        days.sort_by_key(|day| day.date);
        for window in days.windows(2) {
            if window[0].date == window[1].date {
                return Err(AttendanceError::DuplicateRosterEntry {
                    date: window[1].date,
                });
            }
        }
        Ok(Self { employee, days })
    }

    pub fn employee(&self) -> &EmployeeId {
        &self.employee
    }
    pub fn days(&self) -> &[RosterDay] {
        &self.days
    }

    /// Which roster day a place-local clock reading answers.
    ///
    /// # Why this is the roster's question and not the caller's
    ///
    /// A punch names a `business_date` — the roster day it answers — and for an
    /// overnight shift that is the day the shift *started*. A device delivering
    /// a punch works this out at the edge, from the book it was given. A phone
    /// punch has no edge and no book, so something in the centre has to answer
    /// it, and the honest answerer is the plan: only the roster knows that this
    /// person's Tuesday shift runs to 02:00 on Wednesday.
    ///
    /// The rule, in one sentence: a reading belongs to **yesterday** when
    /// yesterday's shift is still running at that minute, and to today
    /// otherwise. Refusing to guess further is deliberate — a reading at 03:00
    /// on a day whose previous shift ended at midnight is today's, early, and
    /// filing it against yesterday to be helpful would put a clock-in on a day
    /// somebody has already been paid for.
    ///
    /// Takes the local date and minute rather than an instant, because "which
    /// day" is a planning fact and a `DateTime<Utc>` here is what lets a
    /// timezone conversion move it — the same reason `attendance_punch`'s
    /// `business_date` is a `date` and not a `timestamptz`.
    ///
    /// An unrostered reading is not refused: it is filed against today with no
    /// offset. A punch on a day nobody planned is a real thing — it is counted
    /// by `unrostered_punch_days_in` and it blocks the period close, which is
    /// the right place for somebody to notice it, rather than a refusal that
    /// tells a person standing in a shop that they are not allowed to be there.
    pub fn business_position(&self, local_date: NaiveDate, local_minute: MinuteOfDay) -> PunchTime {
        let yesterday = local_date.pred_opt();
        let overnight_still_running = yesterday.is_some_and(|yesterday| {
            self.days
                .iter()
                .find(|day| day.date == yesterday)
                .and_then(RosterDay::shift)
                .is_some_and(|shift| {
                    shift.end_day_offset() == DayOffset::NEXT_DAY
                        && local_minute.minutes() < shift.end().minutes()
                })
        });
        match (overnight_still_running, yesterday) {
            (true, Some(yesterday)) => PunchTime::new(yesterday, DayOffset::NEXT_DAY, local_minute),
            _ => PunchTime::same_day(local_date, local_minute),
        }
    }

    /// Add one entry, keeping the roster sorted and duplicate-free.
    ///
    /// The `(place, month)` the date falls in must be **open**: a closed
    /// period's roster is frozen, because adding a scheduled day to a settled
    /// month would manufacture a new absence — and a new payroll basis — after
    /// the fact.
    pub fn insert(
        &mut self,
        day: RosterDay,
        period: &AttendancePeriod,
    ) -> Result<(), AttendanceError> {
        if day.employee != self.employee {
            return Err(AttendanceError::RosterEmployeeMismatch);
        }
        period.require_accepts_roster_change(&day.place, day.date)?;
        match self.days.binary_search_by_key(&day.date, |held| held.date) {
            Ok(_) => Err(AttendanceError::DuplicateRosterEntry { date: day.date }),
            Err(index) => {
                self.days.insert(index, day);
                Ok(())
            }
        }
    }

    /// Revise a day already on the roster, appending a new authorized revision
    /// and keeping every earlier one.
    ///
    /// Fails closed when the day is not on the roster, when its period is
    /// closed, when the key may not plan, and when the new revision is dated
    /// before the one it follows.
    pub fn revise(
        &mut self,
        date: NaiveDate,
        plan: DayPlan,
        authorization: Authorization,
        period: &AttendancePeriod,
    ) -> Result<(), AttendanceError> {
        let index = self
            .days
            .binary_search_by_key(&date, |held| held.date)
            .map_err(|_| AttendanceError::NoRosterEntry { date })?;
        let revision = RosterRevision::try_new(plan, authorization)?;
        period.require_accepts_roster_change(&self.days[index].place, date)?;
        self.days[index].push_revision(revision)
    }

    pub fn on(&self, date: NaiveDate) -> Option<&RosterDay> {
        self.days
            .binary_search_by_key(&date, |held| held.date)
            .ok()
            .map(|index| &self.days[index])
    }

    pub fn between(&self, from: NaiveDate, to: NaiveDate) -> impl Iterator<Item = &RosterDay> {
        self.days
            .iter()
            .filter(move |day| day.date >= from && day.date <= to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::domain::employment::actions;
    use chrono::TimeZone;

    fn date(iso: &str) -> NaiveDate {
        iso.parse().expect("date")
    }

    fn authority() -> Authorization {
        Authorization::try_new(
            "store07.manager",
            actions::ROSTER_MANAGE,
            Utc.with_ymd_and_hms(2026, 9, 1, 8, 0, 0).unwrap(),
            "jadwal minggu ini",
        )
        .expect("authorization")
    }

    /// 22:00–06:00: the case the whole `day_offset` column exists for.
    fn night_shift() -> Shift {
        Shift::try_new(
            ShiftId::try_new("malam").unwrap(),
            "Malam",
            MinuteOfDay::try_new(22 * 60).unwrap(),
            MinuteOfDay::try_new(6 * 60).unwrap(),
            DayOffset::NEXT_DAY,
            Minutes::new(30),
        )
        .expect("shift")
    }

    fn morning_shift() -> Shift {
        Shift::try_new(
            ShiftId::try_new("pagi").unwrap(),
            "Pagi",
            MinuteOfDay::try_new(8 * 60).unwrap(),
            MinuteOfDay::try_new(16 * 60).unwrap(),
            DayOffset::SAME_DAY,
            Minutes::new(60),
        )
        .expect("shift")
    }

    fn roster(days: Vec<(&str, Shift)>) -> DatedRoster {
        DatedRoster::try_new(
            EmployeeId::try_new("emp-1").unwrap(),
            days.into_iter()
                .map(|(on, shift)| {
                    RosterDay::new(
                        EmployeeId::try_new("emp-1").unwrap(),
                        PlaceId::try_new("store-07").unwrap(),
                        date(on),
                        DayPlan::Scheduled { shift },
                        authority(),
                    )
                    .expect("roster day")
                })
                .collect(),
        )
        .expect("roster")
    }

    fn minute(of_day: u16) -> MinuteOfDay {
        MinuteOfDay::try_new(of_day).expect("minute")
    }

    /// The ordinary day: a reading is filed against the date on the wall.
    #[test]
    fn a_daytime_reading_belongs_to_the_day_it_is_read_on() {
        let plan = roster(vec![("2026-09-14", morning_shift())]);
        let at = plan.business_position(date("2026-09-14"), minute(8 * 60 + 3));
        assert_eq!(at.business_date(), date("2026-09-14"));
        assert_eq!(at.day_offset(), DayOffset::SAME_DAY);
        assert_eq!(at.minute(), minute(8 * 60 + 3));
    }

    /// The case this function exists for: 02:00 on Tuesday, when Monday's
    /// shift runs to 06:00, answers **Monday** — the day the shift started,
    /// which is the day the roster planned and the day payroll counts.
    #[test]
    fn a_reading_after_midnight_answers_the_shift_that_is_still_running() {
        let plan = roster(vec![("2026-09-14", night_shift())]);
        let at = plan.business_position(date("2026-09-15"), minute(2 * 60));
        assert_eq!(at.business_date(), date("2026-09-14"));
        assert_eq!(at.day_offset(), DayOffset::NEXT_DAY);
        // And it lands on the same 0..2879 timeline the shift lives on, so
        // "how long was the shift" stays subtraction.
        assert_eq!(at.position().minutes(), 24 * 60 + 2 * 60);
    }

    /// After that shift has ended, the reading is today's again. A shift that
    /// finished at 06:00 does not keep collecting punches all morning.
    #[test]
    fn a_reading_after_the_overnight_shift_ended_is_todays() {
        let plan = roster(vec![("2026-09-14", night_shift())]);
        let at = plan.business_position(date("2026-09-15"), minute(7 * 60));
        assert_eq!(at.business_date(), date("2026-09-15"));
        assert_eq!(at.day_offset(), DayOffset::SAME_DAY);
    }

    /// Yesterday's shift did not run past midnight, so an early reading is an
    /// early reading and not yesterday's. Filing it against yesterday to be
    /// helpful would put a clock-in on a day that may already be paid.
    #[test]
    fn an_early_reading_after_a_daytime_shift_is_not_filed_against_yesterday() {
        let plan = roster(vec![("2026-09-14", morning_shift())]);
        let at = plan.business_position(date("2026-09-15"), minute(3 * 60));
        assert_eq!(at.business_date(), date("2026-09-15"));
        assert_eq!(at.day_offset(), DayOffset::SAME_DAY);
    }

    /// A day nobody planned is not refused. An unrostered punch is a real
    /// thing — it blocks the period close, which is where somebody should
    /// notice it, rather than a refusal aimed at a person standing in a shop.
    #[test]
    fn an_unrostered_reading_is_filed_against_today_rather_than_refused() {
        let plan = DatedRoster::new(EmployeeId::try_new("emp-1").unwrap());
        let at = plan.business_position(date("2026-09-15"), minute(9 * 60));
        assert_eq!(at.business_date(), date("2026-09-15"));
        assert_eq!(at.day_offset(), DayOffset::SAME_DAY);
    }
}
