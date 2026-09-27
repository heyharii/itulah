//! One figure one place is asking to pay one person, once, in one month.
//!
//! The reference's `Additional Salary`, and the gap the owner cares most about.
//! The place submits the whole payroll batch and sees the figures (0231);
//! without this it can only resend numbers head office has already fixed, and
//! a signature on a document you cannot change is not a signature on anything.
//!
//! An incentive, a *kasbon* instalment, a one-month bonus, a transport
//! allowance somebody is owed for a fortnight — all of them are this.
//!
//! # Why it has no state machine of its own
//!
//! The brief for this module asks for a decide-and-return path, and the honest
//! answer is that there already is one: the batch's. An adjustment is writable
//! while its month has no run or a `DRAFT` one, and frozen the moment the place
//! submits — so the decision on it **is** head office's decision on the batch
//! carrying it, under `people.payroll.approve`, and the way back is the reopen
//! that already exists and already clears both signatures.
//!
//! Its own `PROPOSED → APPROVED/RETURNED` machine — the shape
//! [`crate::cloud::domain::hire`] has — was considered and rejected. It would
//! ask head office to approve the same figure twice: once as an adjustment and
//! again as part of the batch that carries it. Two approvals of one number is
//! how two screens come to disagree about whether something was decided, and
//! the second one always wins by accident. `hire_proposal` needs its own
//! machine because nothing else in the estate carries a candidate; an
//! adjustment has a batch to ride, and riding it means there is exactly one
//! place where somebody said yes.
//!
//! The freeze itself is enforced in `postgres::components`, against
//! `payroll_run.state` in the same transaction as the write, rather than by a
//! trigger — because the refusal has to name the run and the month in a
//! sentence a person reads.
//!
//! # And when it repays an advance, it names the advance
//!
//! A *kasbon* instalment pays out; its repayment is this too — a positive
//! figure under a DEDUCTION component, filed with the advance it repays. The
//! advance-side rules (whose advance, money already out, enough outstanding)
//! need the advance row, so they are checked in the request path that has
//! read it, and the outstanding one again at approval, because filings sit
//! while months move. The approval then inserts the `advance_settlement` rows
//! that move the outstanding, in the same transaction as the decision itself;
//! the reopen deletes them in the same transaction as its own.
//!
//! # It may only name a PER_OCCASION component
//!
//! The reference lets an `Additional Salary` *overwrite* a structure
//! component's amount, which makes one component produce two figures and puts
//! something in charge of deciding which wins. Here it cannot: the component
//! must have no standing figure, so no line on any slip is ever the answer to
//! "which of these two won".

use super::basis::{ComponentKind, ComponentShape};
use super::catalogue::{ComponentCode, PayComponent};
use super::error::ComponentError;
use crate::cloud::domain::employment::{Authorization, PlaceId};
use pricing_engine::Money;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const MAX_ADJUSTMENT_ID_LEN: usize = 64;

/// The stored shape, so a filed adjustment re-runs its own constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayrollAdjustmentWire {
    pub id: String,
    pub place: PlaceId,
    /// `YYYY-MM`.
    pub period: String,
    pub employee_id: String,
    pub code: ComponentCode,
    pub amount: Money,
    /// The advance this figure repays, when it is one. `None` is an ordinary
    /// one-off; `Some` makes the filing a recovery.
    pub advance_id: Option<Uuid>,
    pub filed: Authorization,
}

/// One filed one-off.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayrollAdjustment {
    id: String,
    place: PlaceId,
    period: String,
    employee_id: String,
    code: ComponentCode,
    amount: Money,
    advance_id: Option<Uuid>,
    filed: Authorization,
}

impl<'de> Deserialize<'de> for PayrollAdjustment {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PayrollAdjustmentWire::deserialize(deserializer)?;
        Self::try_new(wire).map_err(serde::de::Error::custom)
    }
}

impl PayrollAdjustment {
    /// File one, against a component that has no standing figure.
    ///
    /// The component is passed rather than just its code so the two rules that
    /// need it are checked here and not at the call site: it must be
    /// `PER_OCCASION`, and it must not be retired. A retired component is one
    /// head office has withdrawn from the vocabulary, and filing something new
    /// against it would put a line on a slip under a name nobody may use.
    pub fn file(
        id: impl Into<String>,
        place: PlaceId,
        period: impl Into<String>,
        employee_id: impl Into<String>,
        component: &PayComponent,
        amount: Money,
        advance: Option<Uuid>,
        filed: Authorization,
    ) -> Result<Self, ComponentError> {
        if component.shape() != ComponentShape::PerOccasion {
            return Err(ComponentError::AdjustmentNeedsPerOccasion {
                code: component.code().to_string(),
                shape: component.shape().code(),
            });
        }
        if component.is_retired() {
            return Err(ComponentError::ComponentRetired {
                code: component.code().to_string(),
            });
        }
        // A recovery is money coming back out of a wage, so it can never ride
        // an EARNING. The direction is this component's own fact, checked
        // here; the advance-side rules are the request path's, which has read
        // the advance row.
        if advance.is_some() && component.kind() != ComponentKind::Deduction {
            return Err(ComponentError::RecoveryNeedsDeduction {
                code: component.code().to_string(),
            });
        }
        Self::try_new(PayrollAdjustmentWire {
            id: id.into(),
            place,
            period: period.into(),
            employee_id: employee_id.into(),
            code: component.code().clone(),
            amount,
            advance_id: advance,
            filed,
        })
    }

    /// Rebuild from storage, re-running the rules that do not need the
    /// component row.
    ///
    /// The shape check is not repeated here, and cannot be: it is pinned by the
    /// composite foreign key onto `pay_component (code, basis)` plus the
    /// `basis = 'PER_OCCASION'` CHECK, which is stronger than a re-check —
    /// storage refuses the row rather than the application refusing to read it.
    pub fn try_new(wire: PayrollAdjustmentWire) -> Result<Self, ComponentError> {
        if !wire.filed.authorizes_payroll_adjustment() {
            return Err(ComponentError::ActionForbidsAdjustment {
                action_key: wire.filed.action_key().to_owned(),
            });
        }
        let id = wire.id.trim();
        if id.is_empty()
            || id.chars().any(char::is_control)
            || id.chars().count() > MAX_ADJUSTMENT_ID_LEN
        {
            return Err(ComponentError::InvalidId {
                field: "adjustment id",
            });
        }
        if wire.employee_id.trim().is_empty() {
            return Err(ComponentError::Required {
                field: "the employee",
            });
        }
        // Positive, always. Which way it points is the component's kind, so a
        // *kasbon* instalment is a positive figure under a DEDUCTION component.
        // A signed amount would let one typo turn a deduction into a pay rise.
        if wire.amount.minor <= 0 {
            return Err(ComponentError::NotPositive {
                field: "the amount",
            });
        }
        Ok(Self {
            id: id.to_owned(),
            place: wire.place,
            period: wire.period,
            employee_id: wire.employee_id,
            code: wire.code,
            amount: wire.amount,
            advance_id: wire.advance_id,
            filed: wire.filed,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }
    pub const fn place(&self) -> &PlaceId {
        &self.place
    }
    pub fn period(&self) -> &str {
        &self.period
    }
    pub fn employee_id(&self) -> &str {
        &self.employee_id
    }
    pub const fn code(&self) -> &ComponentCode {
        &self.code
    }
    pub const fn amount(&self) -> Money {
        self.amount
    }
    pub const fn advance_id(&self) -> Option<Uuid> {
        self.advance_id
    }
    pub const fn filed(&self) -> &Authorization {
        &self.filed
    }
}
