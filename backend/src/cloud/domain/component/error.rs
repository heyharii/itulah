use chrono::NaiveDate;
use thiserror::Error;
use uuid::Uuid;

/// What the component engine refuses.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[non_exhaustive]
pub enum ComponentError {
    #[error("{field} is required")]
    Required { field: &'static str },
    #[error("{field} is not a usable identifier")]
    InvalidId { field: &'static str },
    #[error("{field} may not be longer than {max} characters")]
    TooLong { field: &'static str, max: usize },
    #[error("{field} may not contain control characters")]
    NotPrintable { field: &'static str },
    #[error("{value:?} is not a component kind: expected EARNING or DEDUCTION")]
    UnknownKind { value: String },
    #[error(
        "{value:?} is not a component shape: expected FIXED_AMOUNT, SHARE_OF_BASE, \
         RATE_PER_UNIT, FRACTION_OF_BASE_PER_UNIT or PER_OCCASION"
    )]
    UnknownShape { value: String },
    #[error("{value:?} is not a named base: expected BASE or STATUTORY_BASE")]
    UnknownBase { value: String },
    #[error("{value:?} is not a counted unit")]
    UnknownUnit { value: String },

    // ── the shape and its parts ──────────────────────────────────────────
    /// The shape's structural parts are wrong for it. Each of these is a row
    /// the schema also refuses; the message is here so a person fixing a form
    /// reads a sentence rather than a constraint name.
    #[error("a {shape} component is not a share of anything, so it takes no base")]
    ShapeTakesNoBase { shape: &'static str },
    #[error("a {shape} component is a share of a base, so it must name one")]
    ShapeNeedsBase { shape: &'static str },
    #[error("a {shape} component counts nothing, so it takes no unit")]
    ShapeTakesNoUnit { shape: &'static str },
    #[error("a {shape} component is a rate per unit, so it must name one")]
    ShapeNeedsUnit { shape: &'static str },
    /// An hourly wage times a number of days is not a quantity.
    #[error(
        "{unit} is not counted in hours, so an hourly wage cannot be multiplied by it — \
         use one of the overtime bands"
    )]
    UnitIsNotCountedInHours { unit: &'static str },

    // ── the ratified numbers ─────────────────────────────────────────────
    #[error("{field} must be more than nothing")]
    NotPositive { field: &'static str },
    /// Ten thousand per cent. Not a policy — a refusal of a figure that is
    /// certainly a typo, in the one place a typo becomes everybody's deduction.
    #[error("{rate_bp} basis points is more than ten thousand per cent")]
    RateAboveCeiling { rate_bp: i64 },
    /// A `PER_OCCASION` component has nothing standing to ratify, by
    /// definition. Its figure arrives one person and one month at a time.
    #[error(
        "{code} is a PER_OCCASION component, so there is no standing rate to ratify — \
         its figure is filed per person per month"
    )]
    PerOccasionHasNoRate { code: String },
    #[error("a rate effective {effective_from} cannot be filed behind the latest, {latest}")]
    RateNotForward {
        effective_from: NaiveDate,
        latest: NaiveDate,
    },
    #[error("{code} was retired, so nothing new may be filed against it")]
    ComponentRetired { code: String },
    #[error("{code} is already retired")]
    ComponentAlreadyRetired { code: String },
    #[error("the arithmetic for {code} does not fit an integer")]
    Overflow { code: String },

    // ── the one-off ──────────────────────────────────────────────────────
    /// The reference lets a one-off *overwrite* a standing component's amount,
    /// which makes one component produce two figures. Here it cannot.
    #[error(
        "{code} has a standing {shape} figure, so a one-off against it would be a second \
         answer to the same question — file it against a PER_OCCASION component"
    )]
    AdjustmentNeedsPerOccasion { code: String, shape: &'static str },
    #[error("an adjustment for {code} is already filed for {employee_id} in {period}")]
    AdjustmentAlreadyFiled {
        code: String,
        employee_id: String,
        period: String,
    },
    /// The freeze: an adjustment rides the batch it is part of, so it stops
    /// being writable the moment the place signs for that batch.
    #[error(
        "the payroll for {unit} in {period} is {state}, so its figures are no longer the \
         unit's to change — head office reopens it, which clears both signatures"
    )]
    BatchNoLongerDraft {
        unit: String,
        period: String,
        state: &'static str,
    },

    // ── the recovery ─────────────────────────────────────────────────────
    /// A recovery names the advance it repays, and the advance refuses by
    /// name — its number where the row gave one, its id where it did not —
    /// because a filer checking a form against a screen can only match on
    /// names. The outstanding half is re-checked at approval: filings sit
    /// while months move.
    #[error("no advance {advance_id} exists to repay")]
    RecoveryAdvanceUnknown { advance_id: Uuid },
    #[error(
        "advance {advance_id} is a {party_type} advance, and only an EMPLOYEE's advance \
         can be repaid from a wage"
    )]
    RecoveryNotAnEmployeeAdvance {
        advance_id: Uuid,
        party_type: String,
    },
    #[error("advance {advance_number} is not {employee_id}'s, so their wage cannot repay it")]
    RecoveryNotTheEmployees {
        advance_number: String,
        employee_id: String,
    },
    #[error(
        "advance {advance_number} is {status}, and only a paid or partially settled advance \
         has money out to repay"
    )]
    RecoveryAdvanceNotPaidOut {
        advance_number: String,
        status: String,
    },
    #[error(
        "advance {advance_number} has {outstanding_minor} outstanding, so repaying \
         {amount_minor} overshoots it by {over_minor}"
    )]
    RecoveryExceedsOutstanding {
        advance_number: String,
        outstanding_minor: i64,
        amount_minor: i64,
        over_minor: i64,
    },
    #[error(
        "{code} is an EARNING, and a recovery is money coming back out of a wage — file it \
         under a DEDUCTION component"
    )]
    RecoveryNeedsDeduction { code: String },

    // ── authority ────────────────────────────────────────────────────────
    #[error("action `{action_key}` does not authorize defining a payroll component")]
    ActionForbidsDefine { action_key: String },
    #[error("action `{action_key}` does not authorize ratifying a rate")]
    ActionForbidsRatify { action_key: String },
    #[error("action `{action_key}` does not authorize filing a payroll adjustment")]
    ActionForbidsAdjustment { action_key: String },
}

impl ComponentError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Required { .. } => "component_required",
            Self::InvalidId { .. } => "component_invalid_id",
            Self::TooLong { .. } => "component_too_long",
            Self::NotPrintable { .. } => "component_not_printable",
            Self::UnknownKind { .. } => "component_unknown_kind",
            Self::UnknownShape { .. } => "component_unknown_shape",
            Self::UnknownBase { .. } => "component_unknown_base",
            Self::UnknownUnit { .. } => "component_unknown_unit",
            Self::ShapeTakesNoBase { .. } => "component_shape_takes_no_base",
            Self::ShapeNeedsBase { .. } => "component_shape_needs_base",
            Self::ShapeTakesNoUnit { .. } => "component_shape_takes_no_unit",
            Self::ShapeNeedsUnit { .. } => "component_shape_needs_unit",
            Self::UnitIsNotCountedInHours { .. } => "component_unit_not_hourly",
            Self::NotPositive { .. } => "component_not_positive",
            Self::RateAboveCeiling { .. } => "component_rate_above_ceiling",
            Self::PerOccasionHasNoRate { .. } => "component_per_occasion_has_no_rate",
            Self::RateNotForward { .. } => "component_rate_not_forward",
            Self::ComponentRetired { .. } => "component_retired",
            Self::ComponentAlreadyRetired { .. } => "component_already_retired",
            Self::Overflow { .. } => "component_overflow",
            Self::AdjustmentNeedsPerOccasion { .. } => "component_adjustment_needs_per_occasion",
            Self::AdjustmentAlreadyFiled { .. } => "component_adjustment_already_filed",
            Self::BatchNoLongerDraft { .. } => "component_batch_no_longer_draft",
            Self::RecoveryAdvanceUnknown { .. } => "component_recovery_advance_unknown",
            Self::RecoveryNotAnEmployeeAdvance { .. } => {
                "component_recovery_not_an_employee_advance"
            }
            Self::RecoveryNotTheEmployees { .. } => "component_recovery_not_the_employees",
            Self::RecoveryAdvanceNotPaidOut { .. } => "component_recovery_advance_not_paid_out",
            Self::RecoveryExceedsOutstanding { .. } => "component_recovery_exceeds_outstanding",
            Self::RecoveryNeedsDeduction { .. } => "component_recovery_needs_deduction",
            Self::ActionForbidsDefine { .. } => "component_action_forbids_define",
            Self::ActionForbidsRatify { .. } => "component_action_forbids_ratify",
            Self::ActionForbidsAdjustment { .. } => "component_action_forbids_adjustment",
        }
    }

    /// Whether the *record* is in the wrong state rather than the request being
    /// malformed.
    ///
    /// The freeze is the one worth naming: a place resending a figure after it
    /// has submitted the batch has sent a perfectly good payload, and what is
    /// wrong is when. Telling them to fix their request would invite them to
    /// look for the field that makes it work. The recovery's advance is the
    /// same class of answer: an unpaid or already-settled advance is a fact
    /// that moved, not a field the form got wrong.
    pub const fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::RateNotForward { .. }
                | Self::ComponentRetired { .. }
                | Self::ComponentAlreadyRetired { .. }
                | Self::AdjustmentAlreadyFiled { .. }
                | Self::BatchNoLongerDraft { .. }
                | Self::RecoveryAdvanceNotPaidOut { .. }
                | Self::RecoveryExceedsOutstanding { .. }
        )
    }

    pub const fn is_forbidden(&self) -> bool {
        matches!(
            self,
            Self::ActionForbidsDefine { .. }
                | Self::ActionForbidsRatify { .. }
                | Self::ActionForbidsAdjustment { .. }
        )
    }
}
