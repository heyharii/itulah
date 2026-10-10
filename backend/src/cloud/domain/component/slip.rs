//! What a slip earned, what was taken off it, and what could not be worked
//! out.
//!
//! # Absence is never nought
//!
//! This is the rule the whole module is arranged around. `0105` gave
//! `payroll_slip` no deduction column at all, and said why: *"nothing can
//! quietly acquire a zero that reads as 'nothing was owed'."* The columns exist
//! now, so the guarantee has to be carried by something else — and that
//! something is [`SlipComputation::deduction_total`] and
//! [`SlipComputation::net`] being `Option`, with
//! [`SlipComputation::incomplete_because`] saying which component it could not
//! work out from.
//!
//! Three states, not two:
//!
//! | | `deduction_total` | `net` |
//! |---|---|---|
//! | nobody has defined a deduction | `None` | `None` |
//! | a DEDUCTION component has no ratified rate | `None` | `None` |
//! | an EARNING component has no ratified rate | `Some` | `None` |
//! | everything is ratified | `Some` | `Some` |
//!
//! The third row is the one worth having. An unratified earning leaves the
//! deduction total perfectly knowable and the net not, because the gross it
//! would be subtracted from is short. Collapsing it into the second would
//! throw away a true figure; collapsing it into the fourth would publish a net
//! somebody would pay from.
//!
//! # Why a deduction total of nought needs a defined deduction
//!
//! A company that has defined an incentive component and nothing else has not
//! said that nothing is deducted — it has said nothing about deductions at
//! all. So a deduction total is reportable only once at least one DEDUCTION
//! component exists. After that, nought is a real answer: a *kasbon*
//! component with no instalment filed this month genuinely deducts nothing,
//! and somebody has looked.
//!
//! No component is seeded anywhere, so the resting state of a fresh deployment
//! is the first row of that table — which is the honest description of a
//! deployment where nobody has configured payroll.

use super::adjustment::PayrollAdjustment;
use super::basis::{
    ComponentBasis, ComponentKind, ComponentShape, Computed, CountedUnit, SlipFacts,
};
use super::catalogue::{ComponentCode, ComponentInForce, PayComponent};
use super::error::ComponentError;
use pricing_engine::Money;
use serde::Serialize;

/// One computed line, with every input it was computed from.
///
/// A snapshot. The amount is the amount as computed, never a pointer at a rate
/// that will move — the rule `payroll_slip` already follows for the pay
/// agreement, applied one level down. And the intermediates travel with it, so
/// any line can be reproduced from itself: this estate has already been bitten
/// by a computation that derived more than it kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SlipLine {
    kind: ComponentKind,
    code: ComponentCode,
    /// Copied, not joined: renaming a component must not rewrite a slip.
    label: String,
    shape: ComponentShape,
    /// The ratified basis behind it. `None` for a one-off, which has none.
    basis: Option<ComponentBasis>,
    amount: Money,
    /// The figure a share was taken **of**, after any cap.
    base_of: Option<Money>,
    units: Option<i64>,
    unit_rate: Option<Money>,
    /// The rate a statutory line was levied at (a TER rate, a BPJS share), in
    /// hundredths of a percent. A standing line's rate is in its basis.
    statutory_rate_bp: Option<i64>,
    /// Paid by the company on the employee's behalf: on the slip, not from net.
    employer_borne: bool,
}

impl SlipLine {
    /// A standing component, valued against this slip's facts.
    pub fn standing(
        component: &PayComponent,
        basis: ComponentBasis,
        facts: &SlipFacts,
    ) -> Result<Self, ComponentError> {
        let Computed {
            amount,
            base_of,
            units,
            unit_rate,
        } = basis.compute(component.code().as_str(), facts)?;
        Ok(Self {
            kind: component.kind(),
            code: component.code().clone(),
            label: component.label().to_owned(),
            shape: component.shape(),
            basis: Some(basis),
            amount,
            base_of,
            units,
            unit_rate,
            statutory_rate_bp: None,
            employer_borne: component.employer_borne(),
        })
    }

    /// A line the statutory kernel worked out: PPh 21 or a BPJS contribution.
    pub fn statutory(
        component: &PayComponent,
        amount: Money,
        base_of: Option<Money>,
        rate_bp: Option<i64>,
    ) -> Self {
        Self {
            kind: component.kind(),
            code: component.code().clone(),
            label: component.label().to_owned(),
            shape: ComponentShape::Statutory,
            basis: None,
            amount,
            base_of,
            units: None,
            unit_rate: None,
            statutory_rate_bp: rate_bp,
            employer_borne: component.employer_borne(),
        }
    }

    /// A one-off the place filed. The figure is the figure; there is nothing to
    /// compute and nothing to reproduce it from except the adjustment itself,
    /// which keeps its own actor and reason.
    pub fn one_off(component: &PayComponent, adjustment: &PayrollAdjustment) -> Self {
        Self {
            kind: component.kind(),
            code: component.code().clone(),
            label: component.label().to_owned(),
            shape: ComponentShape::PerOccasion,
            basis: None,
            amount: adjustment.amount(),
            base_of: None,
            units: None,
            unit_rate: None,
            statutory_rate_bp: None,
            employer_borne: component.employer_borne(),
        }
    }

    pub const fn kind(&self) -> ComponentKind {
        self.kind
    }
    pub const fn code(&self) -> &ComponentCode {
        &self.code
    }
    pub fn label(&self) -> &str {
        &self.label
    }
    pub const fn shape(&self) -> ComponentShape {
        self.shape
    }
    pub const fn basis(&self) -> Option<ComponentBasis> {
        self.basis
    }
    pub const fn amount(&self) -> Money {
        self.amount
    }
    pub const fn base_of(&self) -> Option<Money> {
        self.base_of
    }
    pub const fn units(&self) -> Option<i64> {
        self.units
    }
    pub const fn unit_rate(&self) -> Option<Money> {
        self.unit_rate
    }
    pub const fn statutory_rate_bp(&self) -> Option<i64> {
        self.statutory_rate_bp
    }
    pub const fn employer_borne(&self) -> bool {
        self.employer_borne
    }
    pub fn unit(&self) -> Option<CountedUnit> {
        self.basis.and_then(|basis| basis.unit())
    }

    /// A line that counted nothing.
    ///
    /// Worth asking about separately: a per-day allowance produces nothing for
    /// somebody nobody rostered, and "26 days at nil" and "nil days at 20.000"
    /// are two different explanations of the same missing money. The run's
    /// reconciliation counts these so head office sees them before approving.
    pub fn counted_nothing(&self) -> bool {
        self.units == Some(0)
    }
}

/// What one slip's components came to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SlipComputation {
    lines: Vec<SlipLine>,
    gross: Money,
    deduction_total: Option<Money>,
    net: Option<Money>,
    /// What the company pays on top of gross: its BPJS share, a tax it bears.
    company_borne: Money,
    incomplete_because: Option<String>,
}

impl SlipComputation {
    /// Value every component in force, plus every one-off the place filed.
    ///
    /// `catalogue` carries retired components as well as live ones,
    /// deliberately. A retired component produces **no new standing line** —
    /// that is what retiring it means — but an adjustment filed against it
    /// while it was live is still honoured, because head office withdrawing a
    /// code from the vocabulary should not silently cancel a figure a place
    /// filed under it and is waiting to see approved.
    ///
    /// Lines come out in payslip order: earnings before deductions, each by
    /// code. Deterministic, so two builds of the same month produce the same
    /// slip in the same order and a diff of two runs is readable.
    pub fn compute(
        statutory_base: Money,
        facts: &SlipFacts,
        catalogue: &[ComponentInForce],
        adjustments: &[PayrollAdjustment],
    ) -> Result<Self, ComponentError> {
        Self::compute_with(
            statutory_base,
            facts,
            catalogue,
            adjustments,
            Vec::new(),
            Vec::new(),
        )
    }

    /// As [`Self::compute`], plus the lines the statutory kernel worked out and
    /// the reasons it could not work some out (no PTKP recorded, a system
    /// component retired). A reason leaves the net unknown, exactly as an
    /// unratified component does.
    ///
    /// A deduction the company bears is on the slip and in
    /// [`Self::company_borne`], and not in the deduction total or the net: it
    /// is the company's cost, which is how the accrual already posts it (0466).
    pub fn compute_with(
        statutory_base: Money,
        facts: &SlipFacts,
        catalogue: &[ComponentInForce],
        adjustments: &[PayrollAdjustment],
        statutory: Vec<SlipLine>,
        statutory_blocked: Vec<String>,
    ) -> Result<Self, ComponentError> {
        let mut lines = statutory;
        let mut unratified: Vec<&str> = Vec::new();
        let mut unratified_deduction = false;

        for in_force in catalogue {
            let component = &in_force.component;
            if component.is_retired() || !component.shape().has_standing_rate() {
                continue;
            }
            match &in_force.rate {
                Some(rate) => {
                    lines.push(SlipLine::standing(component, rate.basis(), facts)?);
                }
                None => {
                    unratified.push(component.code().as_str());
                    if component.kind() == ComponentKind::Deduction {
                        unratified_deduction = true;
                    }
                }
            }
        }

        for adjustment in adjustments {
            let Some(in_force) = catalogue
                .iter()
                .find(|candidate| candidate.component.code() == adjustment.code())
            else {
                // Unreachable through storage: `payroll_adjustment.component_code`
                // is a foreign key. Refused rather than skipped because
                // dropping a figure a place filed is the one failure mode this
                // module must not have.
                return Err(ComponentError::Required {
                    field: "the component an adjustment names",
                });
            };
            lines.push(SlipLine::one_off(&in_force.component, adjustment));
        }

        lines.sort_by(|left, right| {
            left.kind
                .cmp(&right.kind)
                .then_with(|| left.code.cmp(&right.code))
        });

        let overflow = || ComponentError::Overflow {
            code: "the slip total".to_owned(),
        };
        let mut gross = statutory_base;
        let mut deductions = Money::ZERO;
        let mut company_borne = Money::ZERO;
        for line in &lines {
            match line.kind {
                ComponentKind::Deduction if line.employer_borne => {
                    company_borne = company_borne
                        .minor
                        .checked_add(line.amount.minor)
                        .map(Money::new)
                        .ok_or_else(overflow)?;
                }
                ComponentKind::Earning => {
                    gross = gross
                        .minor
                        .checked_add(line.amount.minor)
                        .map(Money::new)
                        .ok_or_else(overflow)?;
                }
                ComponentKind::Deduction => {
                    deductions = deductions
                        .minor
                        .checked_add(line.amount.minor)
                        .map(Money::new)
                        .ok_or_else(overflow)?;
                }
            }
        }

        // A deduction total of nought is only reportable once somebody has
        // defined at least one deduction. See the module header.
        let deductions_were_configured = catalogue.iter().any(|in_force| {
            !in_force.component.is_retired()
                && in_force.component.kind() == ComponentKind::Deduction
                && !in_force.component.employer_borne()
        });

        let mut reasons: Vec<String> = Vec::new();
        if !deductions_were_configured {
            reasons.push(
                "no payroll deduction has been defined, so nothing was taken off this slip \
                 and nothing was found to be nil"
                    .to_owned(),
            );
        }
        if !unratified.is_empty() {
            reasons.push(format!(
                "nobody has ratified a rate for {}, so {} was not worked out",
                unratified.join(", "),
                if unratified.len() == 1 {
                    "it"
                } else {
                    "they were"
                }
            ));
        }
        let statutory_unknown = !statutory_blocked.is_empty();
        reasons.extend(statutory_blocked);

        let deduction_total =
            if deductions_were_configured && !unratified_deduction && !statutory_unknown {
                Some(deductions)
            } else {
                None
            };
        // A net exists only when nothing at all was left unworked out: an
        // unratified earning leaves the deductions knowable and the net not.
        let net = match (deduction_total, reasons.is_empty()) {
            (Some(total), true) => Some(
                gross
                    .minor
                    .checked_sub(total.minor)
                    .map(Money::new)
                    .ok_or_else(overflow)?,
            ),
            _ => None,
        };

        Ok(Self {
            lines,
            gross,
            deduction_total,
            net,
            company_borne,
            incomplete_because: if reasons.is_empty() {
                None
            } else {
                Some(reasons.join("; "))
            },
        })
    }

    pub fn lines(&self) -> &[SlipLine] {
        &self.lines
    }
    /// The statutory base plus every earning line. Never a guess — every
    /// figure in it is on the slip.
    pub const fn gross(&self) -> Money {
        self.gross
    }
    /// `None` when a deduction was not assessed. **Not nought.**
    pub const fn deduction_total(&self) -> Option<Money> {
        self.deduction_total
    }
    /// `None` when anything at all could not be worked out.
    pub const fn net(&self) -> Option<Money> {
        self.net
    }
    pub const fn company_borne(&self) -> Money {
        self.company_borne
    }
    pub fn incomplete_because(&self) -> Option<&str> {
        self.incomplete_because.as_deref()
    }

    /// Whether this slip's figures are the whole story.
    pub const fn is_complete(&self) -> bool {
        self.net.is_some()
    }

    /// A net below nothing: the deductions came to more than the month earned.
    ///
    /// Real rather than impossible — a *kasbon* instalment set too high does
    /// it — so nothing here refuses it. What happens instead is that the run's
    /// reconciliation counts these, so head office sees them before it
    /// approves rather than after somebody is paid a negative wage.
    pub fn is_negative(&self) -> bool {
        self.net.is_some_and(|net| net.minor < 0)
    }
}
