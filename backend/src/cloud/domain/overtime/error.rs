use thiserror::Error;

/// What the overtime kernel refuses.
///
/// The one worth reading twice is [`OvertimeError::ActionForbidsConsent`]: a
/// consent recorded under a supervisor's key is the supervisor agreeing twice,
/// which is the single-consent model PP 35/2021 art. 26(2) does not allow.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum OvertimeError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error("a policy version must not be zero")]
    ZeroPolicyVersion,
    #[error(
        "no ratified policy answers: {question} — the operator must decide before overtime can be \
         ordered"
    )]
    PolicyNotRatified { question: &'static str },
    #[error("the weekly cap of {max_per_week}m is below the daily cap of {max_per_day}m")]
    WeeklyCapBelowDaily { max_per_day: u32, max_per_week: u32 },
    #[error("an overtime order must be for more than zero minutes")]
    ZeroMinutes,
    #[error("the week's overtime minutes do not fit an integer")]
    MinutesOverflow,
    #[error("{requested}m of overtime exceeds the daily cap of {cap}m")]
    ExceedsDailyCap { requested: u32, cap: u32 },
    #[error("{requested}m of overtime this week exceeds the weekly cap of {cap}m")]
    ExceedsWeeklyCap { requested: u32, cap: u32 },
    #[error("action `{action_key}` does not authorize ordering overtime")]
    ActionForbidsOrder { action_key: String },
    /// The refusal this module exists for.
    #[error("action `{action_key}` is not the worker's own consent")]
    ActionForbidsConsent { action_key: String },
    #[error("the order is {state}, not awaiting consent")]
    OrderNotAwaitingConsent { state: &'static str },
}

impl OvertimeError {
    /// A stable code for the wire, so a client can branch on the refusal
    /// without matching on a sentence somebody will improve next month.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Required { .. } => "overtime_required",
            Self::InvalidId { .. } => "overtime_invalid_id",
            Self::ZeroPolicyVersion => "overtime_zero_policy_version",
            Self::PolicyNotRatified { .. } => "overtime_policy_not_ratified",
            Self::WeeklyCapBelowDaily { .. } => "overtime_weekly_cap_below_daily",
            Self::ZeroMinutes => "overtime_zero_minutes",
            Self::MinutesOverflow => "overtime_minutes_overflow",
            Self::ExceedsDailyCap { .. } => "overtime_exceeds_daily_cap",
            Self::ExceedsWeeklyCap { .. } => "overtime_exceeds_weekly_cap",
            Self::ActionForbidsOrder { .. } => "overtime_action_forbids_order",
            Self::ActionForbidsConsent { .. } => "overtime_action_forbids_consent",
            Self::OrderNotAwaitingConsent { .. } => "overtime_order_not_awaiting_consent",
        }
    }

    /// Whether the *record* is in the wrong state rather than the request being
    /// malformed.
    ///
    /// The split is what a caller should do next. More minutes than the daily
    /// cap allows is a bad request — the number in the body is the thing to
    /// change. An order already answered, or a week with no headroom left, is a
    /// conflict: nothing about the request needs fixing, and what has to change
    /// is the world.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::OrderNotAwaitingConsent { .. }
                | Self::ExceedsWeeklyCap { .. }
                | Self::PolicyNotRatified { .. }
                | Self::MinutesOverflow
        )
    }

    /// Whether the caller is reaching outside their grant.
    ///
    /// A consent recorded under the ordering key is not a malformed request; it
    /// is a person doing something they may not do, and telling them to correct
    /// their payload would invite them to look for the field that makes it work.
    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsOrder { .. } | Self::ActionForbidsConsent { .. }
        )
    }
}
