//! What the date says to head office, outside HR.
//!
//! `domain::schedule` owns the calendar's HR work. This module owns the rest of
//! what nothing else fires on: a GA contract whose own reminder window has
//! opened, a filed paper (STNK, SLO, polis) about to lapse, a supplier bill
//! about to fall due, and a tax month whose payment or return is about to be
//! late. Every one of these is already visible on a screen that computes its
//! standing on read; what was missing is somebody being *told*, once, without
//! having to open that screen.
//!
//! # What this module deliberately does not do
//!
//! * **Write a business fact.** A contract that ended is not terminated here, a
//!   bill is not queued for payment, a tax period is not filed. Each of those
//!   is a decision with a person's name on it.
//! * **Repeat itself.** A band is raised once per subject and date; a standing
//!   condition — "this bill is overdue" — belongs to the screen's count, not to
//!   a notice that recurs every hour until somebody acts.
//! * **Dig up the past.** Something that ended or went late more than
//!   [`ENDED_GRACE_DAYS`] ago is not news. Without this the first pass after a
//!   deploy would raise one notice for every contract that lapsed years ago.

use chrono::{Datelike, Duration, NaiveDate};

/// The job names, written into `scheduled_job_run`.
pub mod jobs {
    /// A GA contract inside its own `reminder_days`, or recently ended.
    pub const GA_CONTRACT: &str = "reminder.ga_contract_expiry";
    /// A filed paper whose `expires_on` is near, or recently passed.
    pub const DOCUMENT: &str = "reminder.document_expiry";
    /// Posted supplier bills whose next instalment falls due within the week.
    pub const BILL_DUE: &str = "reminder.bill_due";
    /// A tax month whose payment or return deadline is near or passed.
    pub const TAX_DEADLINE: &str = "reminder.tax_deadline";
}

/// The notification kinds these jobs raise. A closed set in the database
/// (`notification_kind_check`), so each one is added by a migration.
pub mod kinds {
    pub const GA_CONTRACT: &str = "ga.contract.expiring";
    pub const DOCUMENT: &str = "ga.document.expiring";
    pub const BILL_DUE: &str = "finance.bill.due_soon";
    pub const TAX_DEADLINE: &str = "finance.tax.deadline";
}

/// How long after its date an ended or late thing is still worth a notice.
pub const ENDED_GRACE_DAYS: i64 = 30;
/// How far ahead a paper's expiry is announced. A document has no reminder
/// period of its own — that is a contract's property (0358's rule) — so this
/// is one number for every paper.
pub const DOCUMENT_WARN_DAYS: i64 = 30;
/// How far ahead a bill's next instalment is announced: long enough to put it
/// in this week's payment run.
pub const BILL_WARN_DAYS: i64 = 7;
/// How far ahead a tax deadline is announced.
pub const TAX_WARN_DAYS: i64 = 5;

/// Where a dated thing stands against its date.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExpiryBand {
    /// Inside the warning window, date not yet passed.
    Soon,
    /// Date passed, within [`ENDED_GRACE_DAYS`].
    Ended,
}

impl ExpiryBand {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Soon => "SOON",
            Self::Ended => "ENDED",
        }
    }
}

/// The band `ends_on` is in on `today`, or `None` when it is not news yet or
/// not news any more. The end date itself is still `Soon`: a contract ending
/// today is still in force today.
pub fn expiry_band(ends_on: NaiveDate, today: NaiveDate, warn_days: i64) -> Option<ExpiryBand> {
    let days = (ends_on - today).num_days();
    if days < 0 {
        (-days <= ENDED_GRACE_DAYS).then_some(ExpiryBand::Ended)
    } else {
        (days <= warn_days).then_some(ExpiryBand::Soon)
    }
}

/// Whether a bill whose next instalment falls due on `due` is announced today.
/// Only ahead of the date: once it has passed, the payables screen's overdue
/// count is the place for it.
pub fn bill_due_soon(due: NaiveDate, today: NaiveDate) -> bool {
    let days = (due - today).num_days();
    (0..=BILL_WARN_DAYS).contains(&days)
}

/// When a tax month has to be paid and reported.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaxDeadlines {
    pub pay_by: NaiveDate,
    pub file_by: NaiveDate,
}

/// The statutory deadlines for one tax type and month, or `None` for a type
/// that is not a monthly return (PPh 29 and PBB are annual; PPN Masukan is
/// credited on the PPN Keluaran return and has no deadline of its own).
///
/// PMK 81/2024, in force from January 2025: PPh 21, 23 and 25 are paid by the
/// 15th of the following month and reported by the 20th; PPN is paid before
/// its return, which is due at the end of the following month.
///
/// The statutory rule moves a deadline that falls on a weekend or a public
/// holiday to the next working day. That shift is not applied here: it only
/// ever makes the real deadline later, so a warning computed from the
/// unshifted date is early, never late.
pub fn tax_deadlines(tax_type_code: &str, year: i32, month: u32) -> Option<TaxDeadlines> {
    let first_of_next = first_of_following_month(NaiveDate::from_ymd_opt(year, month, 1)?)?;
    match tax_type_code {
        "PPH21" | "PPH23" | "PPH25" => Some(TaxDeadlines {
            pay_by: first_of_next.with_day(15)?,
            file_by: first_of_next.with_day(20)?,
        }),
        "PPN_OUT" => {
            let end_of_next = first_of_following_month(first_of_next)? - Duration::days(1);
            Some(TaxDeadlines {
                pay_by: end_of_next,
                file_by: end_of_next,
            })
        }
        _ => None,
    }
}

fn first_of_following_month(first: NaiveDate) -> Option<NaiveDate> {
    if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
    }
}

/// What a tax month still owes the calendar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaxBand {
    PayDue,
    PayLate,
    FileDue,
    FileLate,
}

impl TaxBand {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PayDue => "PAY_DUE",
            Self::PayLate => "PAY_LATE",
            Self::FileDue => "FILE_DUE",
            Self::FileLate => "FILE_LATE",
        }
    }
}

/// Which notices a tax month earns today. Payment and return are separate
/// obligations with separate dates, so a month can earn one of each.
///
/// `outstanding_minor` is what is still to pay (or, for a credit such as PPh
/// 25, still to acquire); `filed` is true once the return went in.
pub fn tax_bands(
    deadlines: TaxDeadlines,
    today: NaiveDate,
    outstanding_minor: i64,
    filed: bool,
) -> Vec<TaxBand> {
    let band = |date: NaiveDate, due: TaxBand, late: TaxBand| {
        let days = (date - today).num_days();
        if days < 0 {
            (-days <= ENDED_GRACE_DAYS).then_some(late)
        } else {
            (days <= TAX_WARN_DAYS).then_some(due)
        }
    };
    let mut bands = Vec::new();
    if outstanding_minor > 0 {
        bands.extend(band(deadlines.pay_by, TaxBand::PayDue, TaxBand::PayLate));
    }
    if !filed {
        bands.extend(band(deadlines.file_by, TaxBand::FileDue, TaxBand::FileLate));
    }
    bands
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(raw: &str) -> NaiveDate {
        raw.parse()
            .unwrap_or_else(|error| panic!("date {raw}: {error}"))
    }

    #[test]
    fn a_contract_is_news_inside_its_window_and_for_a_month_after() {
        let ends = date("2026-10-31");
        assert_eq!(expiry_band(ends, date("2026-08-31"), 60), None);
        assert_eq!(
            expiry_band(ends, date("2026-09-01"), 60),
            Some(ExpiryBand::Soon)
        );
        assert_eq!(
            expiry_band(ends, date("2026-10-31"), 60),
            Some(ExpiryBand::Soon)
        );
        assert_eq!(
            expiry_band(ends, date("2026-11-01"), 60),
            Some(ExpiryBand::Ended)
        );
        assert_eq!(
            expiry_band(ends, date("2026-11-30"), 60),
            Some(ExpiryBand::Ended)
        );
        assert_eq!(expiry_band(ends, date("2026-12-01"), 60), None, "old news");
    }

    #[test]
    fn a_zero_day_window_still_says_the_day_itself() {
        let ends = date("2026-10-31");
        assert_eq!(expiry_band(ends, date("2026-10-30"), 0), None);
        assert_eq!(expiry_band(ends, ends, 0), Some(ExpiryBand::Soon));
    }

    #[test]
    fn a_bill_is_announced_the_week_before_and_not_after() {
        let due = date("2026-10-07");
        assert!(!bill_due_soon(due, date("2026-09-29")));
        assert!(bill_due_soon(due, date("2026-09-30")));
        assert!(bill_due_soon(due, due));
        assert!(!bill_due_soon(due, date("2026-10-08")));
    }

    #[test]
    fn withholding_is_paid_by_the_fifteenth_and_reported_by_the_twentieth() {
        let deadlines = tax_deadlines("PPH21", 2026, 9).expect("monthly");
        assert_eq!(deadlines.pay_by, date("2026-10-15"));
        assert_eq!(deadlines.file_by, date("2026-10-20"));
        let december = tax_deadlines("PPH23", 2026, 12).expect("monthly");
        assert_eq!(december.pay_by, date("2027-01-15"));
        assert_eq!(december.file_by, date("2027-01-20"));
    }

    #[test]
    fn vat_is_due_at_the_end_of_the_next_month() {
        let january = tax_deadlines("PPN_OUT", 2026, 1).expect("monthly");
        assert_eq!(january.file_by, date("2026-02-28"));
        let november = tax_deadlines("PPN_OUT", 2026, 11).expect("monthly");
        assert_eq!(november.pay_by, date("2026-12-31"));
        let december = tax_deadlines("PPN_OUT", 2026, 12).expect("monthly");
        assert_eq!(december.file_by, date("2027-01-31"));
    }

    #[test]
    fn annual_and_credit_only_types_have_no_monthly_deadline() {
        for code in ["PPH29", "PBB", "PPN_IN", "SOMETHING_NEW"] {
            assert_eq!(tax_deadlines(code, 2026, 9), None, "{code}");
        }
    }

    #[test]
    fn a_tax_month_earns_the_notices_it_still_owes() {
        let deadlines = tax_deadlines("PPH21", 2026, 9).expect("monthly");
        assert_eq!(tax_bands(deadlines, date("2026-10-01"), 500, false), vec![]);
        assert_eq!(
            tax_bands(deadlines, date("2026-10-10"), 500, false),
            vec![TaxBand::PayDue]
        );
        assert_eq!(
            tax_bands(deadlines, date("2026-10-16"), 500, false),
            vec![TaxBand::PayLate, TaxBand::FileDue]
        );
        assert_eq!(
            tax_bands(deadlines, date("2026-10-16"), 0, false),
            vec![TaxBand::FileDue],
            "paid is paid; the return is still owed"
        );
        assert_eq!(tax_bands(deadlines, date("2026-10-16"), 0, true), vec![]);
        assert_eq!(
            tax_bands(deadlines, date("2026-10-21"), 0, false),
            vec![TaxBand::FileLate]
        );
        assert_eq!(
            tax_bands(deadlines, date("2026-12-31"), 500, false),
            vec![],
            "late for more than a month is the tax screen's, not a notice"
        );
    }
}
