//! What head office is told about the promotions it is running, decided
//! without a clock or a database.
//!
//! Two questions live here, and both are pure:
//!
//!  * **Has a limit been crossed?** A budget or a basket cap is a brake at the
//!    tills — each shop enforces from the last count it was sent — so the
//!    moment the centre's own count reaches a line is the moment worth saying
//!    out loud, and the moment every shop should be sent the new count rather
//!    than on the next beat.
//!  * **Is a fresh count due?** A count is sent when it has changed and the
//!    last one is old enough, or at once when a line has just been crossed —
//!    and when nothing has changed, only as an hourly heartbeat for a till that
//!    starts with no counts at all. A message per shop per beat saying what the
//!    last one said is a queue that grows for nobody.
//!
//! The appliers in `postgres::marketing_watch` read the rows and write the
//! alerts; everything they decide, they decide by calling in here.

use chrono::{DateTime, Duration, Utc};

/// Kinds of notification this watch raises. Each is a word the database knows
/// (`notification_kind_check`, migration 0386) — a kind spelled here and not
/// there fails the insert and rolls the watch back.
pub mod kinds {
    pub const CAP_NEAR: &str = "commercial.cap.near";
    pub const CAP_REACHED: &str = "commercial.cap.reached";
    pub const ROLLOUT_FAILED: &str = "commercial.rollout.failed";
    pub const ROLLOUT_STALLED: &str = "commercial.rollout.stalled";
    pub const USAGE_STALE: &str = "commercial.usage.stale";
    pub const GUARDRAIL_BREACHED: &str = "commercial.guardrail.breached";
    pub const PROMOTION_STARTING: &str = "commercial.promotion.starting";
    pub const PROMOTION_ENDING: &str = "commercial.promotion.ending";
}

/// Jobs in `scheduled_job_run`, one claim per (subject, band, day).
pub mod jobs {
    pub const CAP_ALERT: &str = "marketing.cap_alert";
    pub const ROLLOUT_FAILED: &str = "marketing.rollout_failed";
    pub const ROLLOUT_STALLED: &str = "marketing.rollout_stalled";
    pub const USAGE_STALE: &str = "marketing.usage_stale";
    pub const GUARDRAIL: &str = "marketing.guardrail";
    pub const CALENDAR: &str = "marketing.calendar";
}

/// A shop that was handed a price book and has said nothing for this long is
/// worth a look. Long enough that an ordinary sync delay never trips it — a
/// till syncs every few seconds — short enough that a promotion starting at
/// ten is noticed missing well before lunch.
pub const ROLLOUT_STALLED_AFTER_MINUTES: i64 = 30;

/// The same line for the promotion counts: a shop still enforcing from a count
/// this old is a brake with its foot lifted.
pub const USAGE_STALE_AFTER_MINUTES: i64 = 30;

/// How long a changed count may wait before it is sent. With a till counting
/// its own sales (edge `0043`), this is how far behind one shop can be about
/// what the OTHER shops gave away — the only lag left.
pub const FRESH_COUNT_EVERY_MINUTES: i64 = 5;

/// The least gap between two counts sent because a line was crossed, so a
/// flurry of crossings in consecutive ticks is one message and not ten.
pub const CROSSING_COUNT_GAP_SECONDS: i64 = 30;

/// The longest the fleet goes without a count even when nothing has changed.
///
/// Not for the shops that have been listening — they already hold the last
/// count — but for the one that was not: a till restored from a backup or put
/// in fresh starts with no counts at all, and in a quiet hour "send when it
/// changes" would leave it believing nothing has been spent.
pub const HEARTBEAT_MINUTES: i64 = 60;

/// The two lines a limit is watched at.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Band {
    /// Four fifths gone — time to decide whether to top it up.
    Near,
    /// All gone. The tills refuse the offer once they hold this count.
    Reached,
}

impl Band {
    pub fn as_str(self) -> &'static str {
        match self {
            Band::Near => "NEAR",
            Band::Reached => "REACHED",
        }
    }

    pub fn kind(self) -> &'static str {
        match self {
            Band::Near => kinds::CAP_NEAR,
            Band::Reached => kinds::CAP_REACHED,
        }
    }
}

/// Which limit a band is on: the money, or the baskets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Measure {
    Budget,
    Uses,
}

impl Measure {
    pub fn as_str(self) -> &'static str {
        match self {
            Measure::Budget => "BUDGET",
            Measure::Uses => "USES",
        }
    }
}

/// One limit, at one line, and what the count stood at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Crossing {
    pub measure: Measure,
    pub band: Band,
    pub limit: i64,
    pub observed: i64,
}

/// Every line a count stands at or past.
///
/// Integer arithmetic throughout — `observed * 5 >= limit * 4` rather than a
/// ratio — so a budget of three rupiah and one of three billion are measured
/// the same way and nothing rounds a crossing away. A limit of nought or less
/// declares nothing and is skipped: the engine reads it as "already spent",
/// which is the publication's business, not a crossing anybody caused.
///
/// Both bands are returned when both are passed. The caller records each once
/// and tells somebody about the highest one it recorded, so a count that jumps
/// from half to all in one sale says "used up" and not "nearly".
pub fn crossings(
    uses: i64,
    spent_minor: i64,
    budget_minor: Option<i64>,
    max_uses: Option<i64>,
) -> Vec<Crossing> {
    let mut found = Vec::new();
    for (measure, limit, observed) in [
        (Measure::Budget, budget_minor, spent_minor),
        (Measure::Uses, max_uses, uses),
    ] {
        let Some(limit) = limit.filter(|limit| *limit > 0) else {
            continue;
        };
        if observed.saturating_mul(5) >= limit.saturating_mul(4) {
            found.push(Crossing {
                measure,
                band: Band::Near,
                limit,
                observed,
            });
        }
        if observed >= limit {
            found.push(Crossing {
                measure,
                band: Band::Reached,
                limit,
                observed,
            });
        }
    }
    found
}

/// Whether the fleet should be sent a fresh count now.
///
/// * nothing changed since the last count went out → only as a heartbeat, once
///   the last one is [`HEARTBEAT_MINUTES`] old;
/// * a line was just crossed → now, unless one went out in the last
///   [`CROSSING_COUNT_GAP_SECONDS`];
/// * otherwise → once the last one is [`FRESH_COUNT_EVERY_MINUTES`] old.
///
/// "Changed" is the caller's to say, and it says it from the count itself
/// rather than from a timestamp: `last_used_at` is stamped when the applying
/// transaction STARTED, so a sale committed a moment after a count went out can
/// carry a time before it, and a comparison of times would never send it.
///
/// `last_sent` is `None` when no count has ever gone out, which is due the
/// moment there is anything to say.
pub fn count_due(
    now: DateTime<Utc>,
    changed: bool,
    last_sent: Option<DateTime<Utc>>,
    just_crossed: bool,
) -> bool {
    let Some(sent) = last_sent else {
        return changed;
    };
    let age = now - sent;
    if !changed {
        return age >= Duration::minutes(HEARTBEAT_MINUTES);
    }
    if just_crossed {
        return age >= Duration::seconds(CROSSING_COUNT_GAP_SECONDS);
    }
    age >= Duration::minutes(FRESH_COUNT_EVERY_MINUTES)
}

/// A figure in the words a notification uses: rupiah for a budget, a count
/// for baskets.
pub fn describe(measure: Measure, value: i64) -> String {
    match measure {
        Measure::Budget => format!("Rp {}", group_thousands(value)),
        Measure::Uses => format!("{} uses", group_thousands(value)),
    }
}

/// `1234567` as `1.234.567`, the way rupiah is written.
fn group_thousands(value: i64) -> String {
    let digits = value.unsigned_abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    if value < 0 {
        format!("-{grouped}")
    } else {
        grouped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(minute: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 25, 10, 0, 0).unwrap() + Duration::minutes(minute)
    }

    #[test]
    fn nothing_is_crossed_below_four_fifths() {
        assert!(crossings(7, 790_000, Some(1_000_000), Some(10)).is_empty());
    }

    #[test]
    fn four_fifths_of_a_budget_is_near() {
        let found = crossings(1, 800_000, Some(1_000_000), None);
        assert_eq!(
            found,
            vec![Crossing {
                measure: Measure::Budget,
                band: Band::Near,
                limit: 1_000_000,
                observed: 800_000
            }]
        );
    }

    #[test]
    fn a_spent_budget_is_both_near_and_reached() {
        let bands: Vec<Band> = crossings(3, 1_000_000, Some(1_000_000), None)
            .into_iter()
            .map(|one| one.band)
            .collect();
        assert_eq!(bands, vec![Band::Near, Band::Reached]);
    }

    #[test]
    fn a_single_use_code_is_reached_on_its_first_use() {
        let found = crossings(1, 0, None, Some(1));
        assert!(found
            .iter()
            .any(|one| one.measure == Measure::Uses && one.band == Band::Reached));
    }

    #[test]
    fn a_limit_of_nought_declares_nothing() {
        assert!(crossings(5, 5, Some(0), Some(0)).is_empty());
    }

    #[test]
    fn nothing_changed_waits_for_the_heartbeat() {
        assert!(!count_due(at(59), false, Some(at(0)), true));
        assert!(count_due(at(60), false, Some(at(0)), false));
        assert!(!count_due(at(60), false, None, false));
    }

    #[test]
    fn a_first_count_goes_out_as_soon_as_there_is_one() {
        assert!(count_due(at(0), true, None, false));
    }

    #[test]
    fn a_changed_count_waits_for_the_beat() {
        assert!(!count_due(at(4), true, Some(at(0)), false));
        assert!(count_due(at(5), true, Some(at(0)), false));
    }

    #[test]
    fn a_crossing_skips_the_beat_but_not_the_gap() {
        let sent = at(0);
        assert!(!count_due(sent + Duration::seconds(10), true, Some(sent), true));
        assert!(count_due(sent + Duration::seconds(30), true, Some(sent), true));
    }

    #[test]
    fn rupiah_is_grouped_in_thousands() {
        assert_eq!(describe(Measure::Budget, 1_234_567), "Rp 1.234.567");
        assert_eq!(describe(Measure::Budget, 500), "Rp 500");
        assert_eq!(describe(Measure::Uses, 12_000), "12.000 uses");
    }
}
