//! The simulator's business clock: minute-resolution, discrete-event.
//!
//! There is no sleep-driven time here. The scheduler picks the earliest
//! pending event, the clock JUMPS to it, and the actor decides what a human
//! would do at that instant. A seven-day scenario therefore runs in seconds,
//! and two runs with the same seed replay the same story.

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Offset, TimeZone, Utc};

/// Business timezone: UTC+7, per `SIMULATION-SCENARIOS-PO.md` §2.
pub const BUSINESS_UTC_OFFSET_HOURS: i32 = 7;

#[derive(Debug)]
pub struct SimClock {
    now: DateTime<Utc>,
}

impl SimClock {
    pub fn start(local_start: DateTime<FixedOffset>) -> Self {
        Self {
            now: local_start.with_timezone(&Utc),
        }
    }

    pub fn now(&self) -> DateTime<Utc> {
        self.now
    }

    /// Discrete-event advance: time only moves forward, in one jump.
    pub fn advance_to(&mut self, at: DateTime<Utc>) {
        if at > self.now {
            self.now = at;
        }
    }

    fn tz(&self) -> FixedOffset {
        match FixedOffset::east_opt(BUSINESS_UTC_OFFSET_HOURS * 3600) {
            Some(tz) => tz,
            None => Utc.fix(),
        }
    }

    /// The business-local calendar day the clock currently stands on.
    pub fn today_local(&self) -> NaiveDate {
        self.now.with_timezone(&self.tz()).date_naive()
    }

    /// An instant on the given business-local day at hour:minute local time.
    pub fn at_local(&self, day: NaiveDate, hour: u32, minute: u32) -> DateTime<Utc> {
        let tz = self.tz();
        day.and_hms_opt(hour, minute, 0)
            .map(|naive| tz.from_local_datetime(&naive))
            .and_then(|local| local.single())
            .map(|local| local.with_timezone(&Utc))
            .unwrap_or_else(|| self.now + Duration::hours(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    fn tz() -> FixedOffset {
        match FixedOffset::east_opt(BUSINESS_UTC_OFFSET_HOURS * 3600) {
            Some(tz) => tz,
            // +07:00 is always representable; this arm only answers the Option.
            None => panic!("a fixed +07:00 offset is always representable"),
        }
    }

    #[test]
    fn a_monday_start_reads_as_monday_in_business_time() {
        // 2026-01-05 is a Monday; midnight+07 is 2025-12-31T17:00Z.
        let monday = NaiveDate::from_ymd_opt(2026, 1, 5)
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|naive| tz().from_local_datetime(&naive));
        let start = match monday {
            Some(local) => match local.single() {
                Some(instant) => instant,
                None => panic!("midnight+07 must map to exactly one instant"),
            },
            None => panic!("2026-01-05T00:00:00 must be a valid datetime"),
        };
        let mut clock = SimClock::start(start);
        assert_eq!(clock.today_local().weekday().to_string(), "Mon");

        // Jumping to 09:00 local lands on the same calendar day.
        let nine = clock.at_local(clock.today_local(), 9, 0);
        clock.advance_to(nine);
        assert_eq!(clock.now(), nine);
        assert_eq!(
            clock.today_local(),
            NaiveDate::from_ymd_opt(2026, 1, 5).unwrap_or_default()
        );
    }
}
