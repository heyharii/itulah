//! The calendar a sales report is cut along, shared by the centre and the
//! shops.
//!
//! Here rather than in each of them because the two read different databases —
//! Postgres at the centre, SQLite on an edge — and would otherwise each carry
//! their own notion of where a week starts. When they disagree, one shop's
//! Monday-to-Sunday sits under the centre's Sunday-to-Saturday and the same
//! trade appears as two different weeks. Nothing catches that; it just looks
//! like the shop is wrong.
//!
//! Everything in this module is pure. The SQL that applies it is not shared,
//! because the two databases spell date truncation differently — but both are
//! written against the definitions here, and `Bucket::start_of` is what each
//! one's axis is built from.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, TimeZone, Utc};

/// Minutes east of UTC where a business day turns over, when nobody says.
/// WIB: the shops are Indonesian and so is the day they close.
pub const DEFAULT_UTC_OFFSET_MINUTES: i32 = 7 * 60;

/// How wide a column is.
///
/// A closed set rather than a string handed to the database: the parameter
/// arrives from a query string, and Postgres' `date_trunc` accepts field names
/// — `century`, `microseconds` — that would produce a technically valid report
/// nobody asked for and an axis the caller cannot label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bucket {
    Day,
    Week,
    Month,
}

impl Bucket {
    /// Reads `day`, `week`, `month`, or nothing at all. The error is a
    /// sentence, not a code: each surface wraps it in its own error type.
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") | Some("day") => Ok(Self::Day),
            Some("week") => Ok(Self::Week),
            Some("month") => Ok(Self::Month),
            Some(other) => Err(format!(
                "bucket must be day, week or month, not {other:?}"
            )),
        }
    }

    /// The name this bucket answers to, in a query string and in a response.
    pub fn label(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
        }
    }

    /// The bucket a local date belongs to, named by the date it starts on.
    ///
    /// A week starts on MONDAY. That is ISO, it is what Postgres'
    /// `date_trunc('week')` does, and the SQLite side is written to match it —
    /// see the module note above for why the three must not drift apart.
    pub fn start_of(self, date: NaiveDate) -> NaiveDate {
        match self {
            Self::Day => date,
            Self::Week => date - Duration::days(i64::from(date.weekday().num_days_from_monday())),
            Self::Month => NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date),
        }
    }

    /// The bucket after this one.
    pub fn next(self, start: NaiveDate) -> NaiveDate {
        match self {
            Self::Day => start + Duration::days(1),
            Self::Week => start + Duration::days(7),
            Self::Month => {
                let (year, month) = if start.month() == 12 {
                    (start.year() + 1, 1)
                } else {
                    (start.year(), start.month() + 1)
                };
                NaiveDate::from_ymd_opt(year, month, 1).unwrap_or(start + Duration::days(31))
            }
        }
    }
}

/// Every bucket in a span, including the ones nobody sold anything in.
///
/// Built from the span and never from the rows. A shop that was shut on Sunday
/// and a Sunday nobody has reported yet look identical once the empty buckets
/// are dropped, and "nobody sold anything" is usually the answer somebody came
/// to read.
pub fn buckets_between(bucket: Bucket, from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let mut cursor = bucket.start_of(from);
    while cursor <= to {
        out.push(cursor);
        cursor = bucket.next(cursor);
    }
    out
}

/// The span's local dates, as the UTC instants they begin and end at.
///
/// `to` is INCLUSIVE — a reader asking for the first to the thirtieth means
/// the thirtieth — so the exclusive end is the midnight after it.
pub fn window_of(
    from: NaiveDate,
    to: NaiveDate,
    offset_minutes: i32,
) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    if to < from {
        return Err(format!("the span ends before it starts: {from} to {to}"));
    }
    let shift = Duration::minutes(i64::from(offset_minutes));
    let start = Utc.from_utc_datetime(&(from.and_time(NaiveTime::MIN) - shift));
    let end = Utc.from_utc_datetime(&((to + Duration::days(1)).and_time(NaiveTime::MIN) - shift));
    Ok((start, end))
}

/// A caller's offset, or WIB, clamped to somewhere on Earth.
pub fn offset_of(minutes: Option<i32>) -> i32 {
    minutes
        .unwrap_or(DEFAULT_UTC_OFFSET_MINUTES)
        .clamp(-14 * 60, 14 * 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(text: &str) -> NaiveDate {
        text.parse().expect("a date")
    }

    /// The invariant the whole module exists for: a week is a Monday, whoever
    /// is asking. If this ever changes, one shop's week stops lining up with
    /// the centre's and the same trade is reported as two different weeks.
    #[test]
    fn a_week_starts_on_monday() {
        // 2026-09-01 is a Tuesday.
        assert_eq!(Bucket::Week.start_of(date("2026-09-01")), date("2026-08-31"));
        // A Monday is its own week.
        assert_eq!(Bucket::Week.start_of(date("2026-08-31")), date("2026-08-31"));
        // A Sunday belongs to the week that began six days earlier, not to the
        // one starting tomorrow.
        assert_eq!(Bucket::Week.start_of(date("2026-09-06")), date("2026-08-31"));
    }

    #[test]
    fn a_month_rolls_over_the_year() {
        assert_eq!(Bucket::Month.next(date("2026-12-01")), date("2027-01-01"));
        assert_eq!(Bucket::Month.start_of(date("2026-12-31")), date("2026-12-01"));
    }

    /// The axis covers the whole span even where the span starts mid-bucket,
    /// and never runs past its end.
    #[test]
    fn the_axis_covers_the_span() {
        let weeks = buckets_between(Bucket::Week, date("2026-08-05"), date("2026-08-20"));
        assert_eq!(weeks.first(), Some(&date("2026-08-03")));
        assert_eq!(weeks.last(), Some(&date("2026-08-17")));
        assert_eq!(weeks.len(), 3);

        let days = buckets_between(Bucket::Day, date("2026-08-05"), date("2026-08-05"));
        assert_eq!(days, vec![date("2026-08-05")]);
    }

    /// The last day named is inside the window, and the first instant of the
    /// day after is not.
    #[test]
    fn the_window_includes_the_day_it_names() {
        let (start, end) = window_of(date("2026-09-01"), date("2026-09-01"), 420).expect("a window");
        assert_eq!(start.to_rfc3339(), "2026-08-31T17:00:00+00:00");
        assert_eq!(end.to_rfc3339(), "2026-09-01T17:00:00+00:00");
    }

    #[test]
    fn a_backwards_span_is_refused() {
        assert!(window_of(date("2026-09-01"), date("2026-06-01"), 420).is_err());
    }

    #[test]
    fn only_three_buckets_are_accepted() {
        assert_eq!(Bucket::parse(None), Ok(Bucket::Day));
        assert_eq!(Bucket::parse(Some("WEEK")), Ok(Bucket::Week));
        assert!(Bucket::parse(Some("century")).is_err());
    }
}
