//! Which days are red, and which of them come out of somebody's leave.
//!
//! Ported from the reference HR backend's `holiday-domain`. See
//! `docs/hr-port-provenance.md` for what changed.
//!
//! # What this module does not know
//!
//! **When the holidays are.** Indonesian public holidays are fixed each year by
//! a *Surat Keputusan Bersama* of three ministries. They move: several follow
//! the Hijri calendar and are confirmed only weeks ahead, and *cuti bersama* is
//! routinely added, removed or shifted after the year has started. A table
//! compiled into this binary would need a release every time the government
//! changed its mind, and by then somebody has already been marked absent.
//!
//! So there is no fallback table, no derivation and no network call. An
//! operator publishes the year, and amends it when the decree changes.
//!
//! **Whether a particular person works on a given date.** That needs their
//! roster: a holiday is not a day off for somebody scheduled onto it, and the
//! pay that follows is payroll's business. This module states the fact.
//!
//! # The distinction the whole module exists for
//!
//! *Cuti bersama* is, by the same decree that announces it, charged against the
//! employee's annual leave — the company closes and the days come out of the
//! twelve. Modelling it and a national holiday both as "a red day" is how a
//! leave balance ends up wrong by exactly the number of long weekends in the
//! year. [`HolidayKind::consumes_annual_leave`] is the question the leave
//! kernel asks, and only one variant answers yes.

mod calendar;
mod day;
mod error;

pub use calendar::{CalendarAmendment, CalendarChange, HolidayCalendar, HolidayCalendarWire};
pub use day::{Holiday, HolidayKind, HolidayName, HolidayScope, HolidayWire, MAX_NAME_LEN};
pub use error::HolidayError;
