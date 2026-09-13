//! The catalogue: what a company's payroll lines are, and what somebody
//! ratified them at.
//!
//! # A definition and a rate are two decisions
//!
//! Inventing a line item — "there is a thing called BPJS_KESEHATAN and it is a
//! capped share of the statutory base" — is a structural decision that should
//! never change again. Saying what it costs is a decision a regulation
//! changes. They are separate rows here, under separate action keys, for two
//! reasons:
//!
//! 1. It makes **"defined and never priced"** a state this system can name.
//!    That is the state the brief for this module is built around: BPJS is
//!    expressible and its percentage is written nowhere in this repository. A
//!    slip refuses to report a deduction total while a definition has no rate,
//!    naming the component — rather than reporting nought, which claims
//!    somebody looked.
//! 2. It makes the rate **effective-dated**, so January's regulation cannot
//!    rewrite what December was deducted. The same reason `employee_pay` is a
//!    history rather than a column.
//!
//! # There is no default row anywhere
//!
//! Nothing seeds a component, and nothing seeds a rate. That is the discipline
//! `overtime_policy` established: an operator who has not decided cannot
//! build one, and the caller gets a refusal naming the open question rather
//! than a figure somebody typed once in 2019.

use super::basis::{ComponentBase, ComponentBasis, ComponentKind, ComponentShape, CountedUnit};
use super::error::ComponentError;
use crate::cloud::domain::employment::Authorization;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

pub const MAX_COMPONENT_CODE_LEN: usize = 40;
pub const MAX_COMPONENT_LABEL_LEN: usize = 80;

/// Trim, reject empty, reject control characters, bound the length.
///
/// The employment kernel has a function of this name and does not export it;
/// `leave`, `pay` and `hire` each wrote their own for the same reason, and a
/// fourth copy is cheaper than widening that module's surface.
fn validated_text(field: &'static str, raw: &str, max: usize) -> Result<String, ComponentError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ComponentError::Required { field });
    }
    if trimmed.chars().count() > max {
        return Err(ComponentError::TooLong { field, max });
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ComponentError::NotPrintable { field });
    }
    Ok(trimmed.to_owned())
}

/// What a component is called.
///
/// The operator's own vocabulary, upper-cased — exactly as
/// `pay::AllowanceCode` is, and for the same reason: a closed enum would mean a
/// deploy every time HR invents a line item. Upper-cased on the way in so
/// `bpjs` and `BPJS` cannot become two components nobody can tell apart.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ComponentCode(String);

impl ComponentCode {
    pub fn try_new(raw: &str) -> Result<Self, ComponentError> {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.chars().any(char::is_control)
            || trimmed.chars().count() > MAX_COMPONENT_CODE_LEN
        {
            return Err(ComponentError::InvalidId {
                field: "component code",
            });
        }
        Ok(Self(trimmed.to_uppercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ComponentCode {
    type Error = ComponentError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl From<ComponentCode> for String {
    fn from(value: ComponentCode) -> Self {
        value.0
    }
}

impl std::fmt::Display for ComponentCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The stored shape, so a definition re-runs its own constructor.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayComponentWire {
    pub code: ComponentCode,
    pub label: String,
    pub kind: ComponentKind,
    pub shape: ComponentShape,
    #[serde(default)]
    pub base: Option<ComponentBase>,
    #[serde(default)]
    pub unit: Option<CountedUnit>,
    pub defined: Authorization,
    #[serde(default)]
    pub retired: Option<Authorization>,
}

/// One component, as head office defined it. **No numbers.**
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayComponent {
    code: ComponentCode,
    label: String,
    kind: ComponentKind,
    shape: ComponentShape,
    base: Option<ComponentBase>,
    unit: Option<CountedUnit>,
    defined: Authorization,
    retired: Option<Authorization>,
}

impl<'de> Deserialize<'de> for PayComponent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PayComponentWire::deserialize(deserializer)?;
        Self::try_new(wire).map_err(serde::de::Error::custom)
    }
}

impl PayComponent {
    /// Define a component.
    ///
    /// Refuses a shape whose structural parts are wrong for it — a
    /// `FIXED_AMOUNT` that names a base, a `RATE_PER_UNIT` with no unit, an
    /// hourly wage multiplied by a count of days. Each is also refused by the
    /// schema; the refusal is here as well because a person filling in a form
    /// should read a sentence rather than a constraint name, and because the
    /// rule is a domain rule rather than a storage detail.
    pub fn define(
        code: ComponentCode,
        label: &str,
        kind: ComponentKind,
        shape: ComponentShape,
        base: Option<ComponentBase>,
        unit: Option<CountedUnit>,
        defined: Authorization,
    ) -> Result<Self, ComponentError> {
        Self::try_new(PayComponentWire {
            code,
            label: label.to_owned(),
            kind,
            shape,
            base,
            unit,
            defined,
            retired: None,
        })
    }

    /// Rebuild from storage, re-running every rule.
    pub fn try_new(wire: PayComponentWire) -> Result<Self, ComponentError> {
        if !wire.defined.authorizes_pay_component_define() {
            return Err(ComponentError::ActionForbidsDefine {
                action_key: wire.defined.action_key().to_owned(),
            });
        }
        if let Some(retired) = &wire.retired {
            if !retired.authorizes_pay_component_define() {
                return Err(ComponentError::ActionForbidsDefine {
                    action_key: retired.action_key().to_owned(),
                });
            }
        }
        let label = validated_text("the label", &wire.label, MAX_COMPONENT_LABEL_LEN)?;

        let shape = wire.shape;
        match (shape.needs_base(), wire.base) {
            (true, None) => {
                return Err(ComponentError::ShapeNeedsBase {
                    shape: shape.code(),
                })
            }
            (false, Some(_)) => {
                return Err(ComponentError::ShapeTakesNoBase {
                    shape: shape.code(),
                })
            }
            _ => {}
        }
        match (shape.needs_unit(), wire.unit) {
            (true, None) => {
                return Err(ComponentError::ShapeNeedsUnit {
                    shape: shape.code(),
                })
            }
            (false, Some(_)) => {
                return Err(ComponentError::ShapeTakesNoUnit {
                    shape: shape.code(),
                })
            }
            _ => {}
        }
        if shape == ComponentShape::FractionOfBasePerUnit {
            if let Some(unit) = wire.unit {
                if !unit.is_counted_in_hours() {
                    return Err(ComponentError::UnitIsNotCountedInHours { unit: unit.code() });
                }
            }
        }

        Ok(Self {
            code: wire.code,
            label,
            kind: wire.kind,
            shape,
            base: wire.base,
            unit: wire.unit,
            defined: wire.defined,
            retired: wire.retired,
        })
    }

    pub fn code(&self) -> &ComponentCode {
        &self.code
    }
    pub fn label(&self) -> &str {
        &self.label
    }
    pub const fn kind(&self) -> ComponentKind {
        self.kind
    }
    pub const fn shape(&self) -> ComponentShape {
        self.shape
    }
    pub const fn base(&self) -> Option<ComponentBase> {
        self.base
    }
    pub const fn unit(&self) -> Option<CountedUnit> {
        self.unit
    }
    pub const fn defined(&self) -> &Authorization {
        &self.defined
    }
    pub const fn retired(&self) -> Option<&Authorization> {
        self.retired.as_ref()
    }
    pub const fn is_retired(&self) -> bool {
        self.retired.is_some()
    }

    /// Retire it. **Never delete it**: a slip line naming a deleted component
    /// would point at nothing, and the slips it produced are still the record
    /// of what somebody was paid. The rule the other four master lists follow.
    pub fn retire(&mut self, authorization: Authorization) -> Result<(), ComponentError> {
        if !authorization.authorizes_pay_component_define() {
            return Err(ComponentError::ActionForbidsDefine {
                action_key: authorization.action_key().to_owned(),
            });
        }
        if self.retired.is_some() {
            return Err(ComponentError::ComponentAlreadyRetired {
                code: self.code.to_string(),
            });
        }
        self.retired = Some(authorization);
        Ok(())
    }

    /// Assemble a basis from this definition's structure plus the numbers
    /// somebody ratified.
    ///
    /// The two halves meet here and nowhere else, so a rate whose numbers do
    /// not fit its definition's shape cannot become a computable basis. The
    /// schema pins the same agreement with a composite foreign key; this is
    /// the reading half of it.
    pub fn basis_from(&self, numbers: &RateNumbers) -> Result<ComponentBasis, ComponentError> {
        let missing = |field: &'static str| ComponentError::Required { field };
        let basis = match self.shape {
            ComponentShape::FixedAmount => ComponentBasis::FixedAmount {
                amount: numbers.amount.ok_or_else(|| missing("the amount"))?,
            },
            ComponentShape::ShareOfBase => ComponentBasis::ShareOfBase {
                base: self.base.ok_or_else(|| ComponentError::ShapeNeedsBase {
                    shape: self.shape.code(),
                })?,
                rate_bp: numbers.rate_bp.ok_or_else(|| missing("the rate"))?,
                cap: numbers.cap,
            },
            ComponentShape::RatePerUnit => ComponentBasis::RatePerUnit {
                unit: self.unit.ok_or_else(|| ComponentError::ShapeNeedsUnit {
                    shape: self.shape.code(),
                })?,
                rate: numbers.rate.ok_or_else(|| missing("the rate per unit"))?,
            },
            ComponentShape::FractionOfBasePerUnit => ComponentBasis::FractionOfBasePerUnit {
                base: self.base.ok_or_else(|| ComponentError::ShapeNeedsBase {
                    shape: self.shape.code(),
                })?,
                unit: self.unit.ok_or_else(|| ComponentError::ShapeNeedsUnit {
                    shape: self.shape.code(),
                })?,
                hours_divisor: numbers
                    .hours_divisor
                    .ok_or_else(|| missing("the divisor of hours"))?,
                multiplier_bp: numbers
                    .multiplier_bp
                    .ok_or_else(|| missing("the multiplier"))?,
            },
            ComponentShape::PerOccasion => {
                return Err(ComponentError::PerOccasionHasNoRate {
                    code: self.code.to_string(),
                })
            }
        };
        basis.validated()
    }
}

/// The numbers a rate may carry, before they are matched to a shape.
///
/// One struct with five optional fields rather than five constructors, because
/// this is exactly the shape the row has and the shape a form posts — and
/// [`PayComponent::basis_from`] is the one place that decides which of them a
/// given shape needs. Splitting it would put that decision in two places.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RateNumbers {
    #[serde(default)]
    pub amount: Option<pricing_engine::Money>,
    #[serde(default)]
    pub rate: Option<pricing_engine::Money>,
    #[serde(default)]
    pub rate_bp: Option<i64>,
    #[serde(default)]
    pub cap: Option<pricing_engine::Money>,
    #[serde(default)]
    pub hours_divisor: Option<i64>,
    #[serde(default)]
    pub multiplier_bp: Option<i64>,
}

/// One ratified rate, from one date until the next supersedes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComponentRate {
    effective_from: NaiveDate,
    basis: ComponentBasis,
    ratified: Authorization,
}

impl ComponentRate {
    /// Ratify a rate for a component.
    ///
    /// The basis is built through the component's own definition, so a set of
    /// numbers that does not fit the shape cannot be ratified at all.
    pub fn ratify(
        component: &PayComponent,
        effective_from: NaiveDate,
        numbers: &RateNumbers,
        ratified: Authorization,
    ) -> Result<Self, ComponentError> {
        if !ratified.authorizes_pay_component_ratify() {
            return Err(ComponentError::ActionForbidsRatify {
                action_key: ratified.action_key().to_owned(),
            });
        }
        if component.is_retired() {
            return Err(ComponentError::ComponentRetired {
                code: component.code().to_string(),
            });
        }
        Ok(Self {
            effective_from,
            basis: component.basis_from(numbers)?,
            ratified,
        })
    }

    /// Rebuild a stored rate. Same gates, and the basis arrives already
    /// assembled from the row's own columns.
    pub fn try_new(
        effective_from: NaiveDate,
        basis: ComponentBasis,
        ratified: Authorization,
    ) -> Result<Self, ComponentError> {
        if !ratified.authorizes_pay_component_ratify() {
            return Err(ComponentError::ActionForbidsRatify {
                action_key: ratified.action_key().to_owned(),
            });
        }
        Ok(Self {
            effective_from,
            basis: basis.validated()?,
            ratified,
        })
    }

    pub const fn effective_from(&self) -> NaiveDate {
        self.effective_from
    }
    pub const fn basis(&self) -> ComponentBasis {
        self.basis
    }
    pub const fn ratified(&self) -> &Authorization {
        &self.ratified
    }
    pub fn ratified_at(&self) -> DateTime<Utc> {
        self.ratified.at()
    }
}

/// One component's rates, over time.
///
/// Forward-only, like `PayTimeline`: a rate filed *behind* the latest would
/// change what an already-closed month was deducted, which is the defect that
/// makes a mutable rate column unusable, arriving through a different door.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct RateTimeline {
    rates: Vec<ComponentRate>,
}

impl RateTimeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, rate: ComponentRate) -> Result<(), ComponentError> {
        if let Some(last) = self.rates.last() {
            if rate.effective_from <= last.effective_from {
                return Err(ComponentError::RateNotForward {
                    effective_from: rate.effective_from,
                    latest: last.effective_from,
                });
            }
        }
        self.rates.push(rate);
        Ok(())
    }

    /// The rate in force on a date.
    ///
    /// `None` before the first one: there was no ratified rate yet, which is
    /// **not** the same as a rate of nought, and is the distinction this whole
    /// module exists to keep.
    pub fn on(&self, date: NaiveDate) -> Option<&ComponentRate> {
        self.rates
            .iter()
            .rev()
            .find(|rate| rate.effective_from <= date)
    }

    pub fn rates(&self) -> &[ComponentRate] {
        &self.rates
    }

    pub fn is_empty(&self) -> bool {
        self.rates.is_empty()
    }
}

/// A definition and the rate in force on a date — `None` when nobody has
/// stated one.
///
/// The pair the engine reads. `Option` rather than a default, because the whole
/// point is that "nobody has said" is representable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentInForce {
    pub component: PayComponent,
    pub rate: Option<ComponentRate>,
}

impl ComponentInForce {
    /// Whether this component can produce a line at all.
    ///
    /// A `PER_OCCASION` component answers `true` with no rate, because it has
    /// nothing standing to ratify — so it is never the reason a slip is
    /// incomplete. Everything else needs a rate.
    pub const fn is_workable(&self) -> bool {
        !self.component.shape().has_standing_rate() || self.rate.is_some()
    }
}
