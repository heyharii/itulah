use chrono::NaiveDate;
use thiserror::Error;

/// What a calendar refuses, and why.
///
/// Every variant carries the date it is about. A refusal that says only "the
/// calendar is wrong" is a refusal somebody has to reproduce before they can
/// act on it, and these are read by an operator typing a year's holidays in one
/// sitting.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum HolidayError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} must be at most {max} characters")]
    TooLong { field: &'static str, max: usize },
    #[error("{field} must be printable text without control characters")]
    NotPrintable { field: &'static str },
    #[error("the regional holiday on {date} must name the places that observe it")]
    RegionalHolidayWithoutPlaces { date: NaiveDate },
    #[error("the national holiday on {date} cannot be scoped to particular places")]
    NationalHolidayScopedToPlaces { date: NaiveDate },
    #[error("a holiday scoped to no places is not a holiday")]
    EmptyScope,
    #[error("the calendar already has a holiday on {date}")]
    DuplicateHoliday { date: NaiveDate },
    #[error("{date} is not in the {year} calendar")]
    DateOutsideCalendarYear { date: NaiveDate, year: i32 },
    #[error("the calendar has no holiday on {date} to withdraw")]
    NoSuchHoliday { date: NaiveDate },
    #[error("the holiday withdrawn on {date} is not the one the calendar holds")]
    RemovalDoesNotMatch { date: NaiveDate },
    #[error("action `{action_key}` does not authorize a calendar change")]
    ActionForbidsCalendarChange { action_key: String },
}

impl HolidayError {
    /// A stable code for the wire, so a client can branch on the refusal
    /// without matching on a sentence somebody will improve next month.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Required { .. } => "holiday_required",
            Self::TooLong { .. } => "holiday_too_long",
            Self::NotPrintable { .. } => "holiday_not_printable",
            Self::RegionalHolidayWithoutPlaces { .. } => "holiday_regional_without_places",
            Self::NationalHolidayScopedToPlaces { .. } => "holiday_national_scoped",
            Self::EmptyScope => "holiday_empty_scope",
            Self::DuplicateHoliday { .. } => "holiday_duplicate",
            Self::DateOutsideCalendarYear { .. } => "holiday_outside_calendar_year",
            Self::NoSuchHoliday { .. } => "holiday_not_found",
            Self::RemovalDoesNotMatch { .. } => "holiday_removal_mismatch",
            Self::ActionForbidsCalendarChange { .. } => "holiday_action_forbids_change",
        }
    }

    /// Whether the *calendar* is in the wrong state, rather than the request
    /// being malformed.
    ///
    /// The two need different HTTP answers and the difference is not cosmetic.
    /// "Invalid request" means the payload is wrong and resending it unchanged
    /// fails again; a state conflict means the payload is fine and the calendar
    /// is not in a state where it applies. Telling somebody to fix their
    /// request when the calendar is the problem sends them looking in the wrong
    /// place.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::DuplicateHoliday { .. }
                | Self::NoSuchHoliday { .. }
                | Self::RemovalDoesNotMatch { .. }
        )
    }
}
