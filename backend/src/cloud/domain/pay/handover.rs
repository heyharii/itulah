//! Handing an approved run to Finance: one gross liability, and what it is made
//! of.
//!
//! # Why this is a crossing and not a posting
//!
//! Every other module that owes Finance money calls `postgres::poster::post`
//! in its own transaction and stamps the journal entry back onto its own row.
//! This one deliberately does not, and the reason is geography rather than
//! taste.
//!
//! A payroll run is keyed by `unit` — head office plus the thirteen shops
//! — because head office employs people too, and a payroll that could only be
//! run for a shop cannot pay the buyer (0105). A journal line is keyed by
//! `site`, and when this was written **head office was not one**: the old
//! `org_place` row for `HO` carried no site by its own check constraint. So the
//! one run the unit key existed for was the one run with no site to post to,
//! and posting it meant deciding that head office's payroll books at the
//! warehouse's site. That was a real decision about the client's chart of
//! accounts and not this lane's to guess. (It has since been taken: every site
//! belongs to a unit, head office's is the Gudang, and `postgres::pay` books
//! the accrual at `book_site_of_unit` until the ledger moves to units.)
//!
//! So the handover is the honest half: it records, once and immovably, that a
//! named gross liability for one place and one month has been given to Finance,
//! with the per-employee breakdown behind it. Finance books it and Finance says
//! when it has been paid. `entry_id` is deliberately absent rather than present
//! and forever null — a column nothing writes is a promise nothing keeps.
//!
//! # What "gross" means here, exactly
//!
//! Base pay plus the standing (*tetap*) allowances — the slip's
//! `statutory_base_minor`. **Nothing else on a slip is money.** Overtime is
//! recorded in minutes and leave in days, and this backend holds no overtime
//! rate and no daily rate anywhere, so a handover that turned those minutes
//! into rupiah would be inventing the multiplier. It does not, and the figure
//! that crosses is therefore the agreement in force and nothing derived.
//!
//! And nothing statutory is netted off it: no PPh 21, no BPJS. The slip has no
//! column for either, on purpose, and neither does this.
//!
//! # The header agrees with its lines, or it does not exist
//!
//! The journal refuses an entry whose header total disagrees with its lines,
//! at COMMIT, by deferred trigger — "*a header that silently disagreed with
//! its lines is the failure this column exists to make impossible*" (0051).
//! The same rule applies here for the same reason: this row is what somebody
//! will eventually reconcile a payment against, and a gross that is not the
//! sum of the people in it is a figure with no evidence behind it.
//!
//! # A run can be reopened after this
//!
//! Hari accepted that explicitly, so nothing here refuses it. What makes it
//! survivable is that the breakdown is a **snapshot**: the lines are copied at
//! the moment of the handover rather than joined to `payroll_slip`, so a
//! reopened run whose slips are rebuilt does not retroactively change what
//! Finance was handed. The run moves; the crossing does not.

use super::error::PayError;
use super::run::{PayrollRun, RunState};
use crate::cloud::domain::employment::{Authorization, UnitId};
use serde::{Deserialize, Serialize};

/// Where a handover has got to, as Finance sees it.
///
/// Two states and no third. There is no `DRAFT`: a handover exists because
/// somebody handed it over, so its first state is Finance holding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HandoverState {
    /// Finance has it and has not paid it.
    Received,
    /// Finance has paid it.
    Paid,
}

impl HandoverState {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Received => "RECEIVED",
            Self::Paid => "PAID",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "RECEIVED" => Some(Self::Received),
            "PAID" => Some(Self::Paid),
            _ => None,
        }
    }
}

/// One person's share of the liability, as it stood when it crossed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayrollHandoverLine {
    employee_id: String,
    /// Base plus standing allowances. See the module doc on what is *not* in
    /// this number.
    gross_minor: i64,
}

impl PayrollHandoverLine {
    pub fn try_new(employee_id: impl Into<String>, gross_minor: i64) -> Result<Self, PayError> {
        let employee_id = employee_id.into();
        if employee_id.trim().is_empty() {
            return Err(PayError::InvalidId {
                field: "employee id",
            });
        }
        // A line worth nothing is either somebody with no agreement — who has
        // no slip and should not be here at all — or an arithmetic mistake.
        // Both are better refused than handed to Finance as a person the
        // company owes nought.
        if gross_minor <= 0 {
            return Err(PayError::HandoverLineNotPositive { employee_id });
        }
        Ok(Self {
            employee_id,
            gross_minor,
        })
    }

    pub fn employee_id(&self) -> &str {
        &self.employee_id
    }
    pub const fn gross_minor(&self) -> i64 {
        self.gross_minor
    }
}

/// The stored shape, so a handover re-runs its own rules on the way in.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayrollHandoverWire {
    pub run_id: String,
    pub unit: UnitId,
    /// `YYYY-MM`.
    pub period: String,
    pub gross_minor: i64,
    pub state: HandoverState,
    pub handed_over: Authorization,
    #[serde(default)]
    pub settled: Option<Authorization>,
    pub lines: Vec<PayrollHandoverLine>,
}

/// One gross liability, handed to Finance for one place and one month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PayrollHandover {
    run_id: String,
    unit: UnitId,
    period: String,
    gross_minor: i64,
    state: HandoverState,
    handed_over: Authorization,
    settled: Option<Authorization>,
    lines: Vec<PayrollHandoverLine>,
}

impl<'de> Deserialize<'de> for PayrollHandover {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = PayrollHandoverWire::deserialize(deserializer)?;
        Self::try_new(wire).map_err(serde::de::Error::custom)
    }
}

impl PayrollHandover {
    /// Cross an approved run to Finance.
    ///
    /// Only an approved one. A draft is a working figure and a submitted run is
    /// a request nobody has answered; handing either to Finance would put a
    /// number in the books that head office has not agreed to.
    pub fn hand_over(
        run: &PayrollRun,
        lines: Vec<PayrollHandoverLine>,
        authorization: Authorization,
    ) -> Result<Self, PayError> {
        if !authorization.authorizes_payroll_handover() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "handover",
            });
        }
        if run.state() != RunState::Approved {
            return Err(PayError::RunNotInState {
                state: run.state().code(),
                step: "handed to Finance",
            });
        }
        let gross = Self::sum(&lines)?;
        Self::assemble(
            run.id().to_owned(),
            run.unit().clone(),
            run.period().to_owned(),
            gross,
            HandoverState::Received,
            authorization,
            None,
            lines,
        )
    }

    /// Rebuild from storage, re-running every rule the live path applies.
    ///
    /// The key gate and the header-agrees-with-its-lines rule both fire here as
    /// well, because a rule only the live path enforces is a rule a round trip
    /// through storage removes — and this row is the one a payment will be
    /// reconciled against.
    pub fn try_new(wire: PayrollHandoverWire) -> Result<Self, PayError> {
        if !wire.handed_over.authorizes_payroll_handover() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: wire.handed_over.action_key().to_owned(),
                step: "handover",
            });
        }
        if let Some(settled) = &wire.settled {
            if !settled.authorizes_payroll_settlement() {
                return Err(PayError::ActionForbidsPayrollStep {
                    action_key: settled.action_key().to_owned(),
                    step: "settlement",
                });
            }
        }
        // `PAID` and "somebody signed for the payment" are the same fact, so
        // they cannot disagree — the shape `supplier_invoice` refuses between
        // its status and its `posted_at`.
        if (wire.state == HandoverState::Paid) != wire.settled.is_some() {
            return Err(PayError::Required { field: "settled" });
        }
        let summed = Self::sum(&wire.lines)?;
        if summed != wire.gross_minor {
            return Err(PayError::HandoverDoesNotAddUp {
                header: wire.gross_minor,
                lines: summed,
            });
        }
        Self::assemble(
            wire.run_id,
            wire.unit,
            wire.period,
            wire.gross_minor,
            wire.state,
            wire.handed_over,
            wire.settled,
            wire.lines,
        )
    }

    /// The sum of the breakdown, refusing an empty one and an overflow.
    ///
    /// An empty breakdown is not a liability of nought — it is a place where
    /// nobody has a pay agreement yet, and handing Finance a row saying the
    /// company owes nothing would be a claim somebody looked.
    fn sum(lines: &[PayrollHandoverLine]) -> Result<i64, PayError> {
        if lines.is_empty() {
            return Err(PayError::NothingToHandOver);
        }
        lines
            .iter()
            .try_fold(0_i64, |total, line| total.checked_add(line.gross_minor))
            .ok_or(PayError::PayOverflow)
    }

    #[allow(clippy::too_many_arguments)]
    fn assemble(
        run_id: String,
        unit: UnitId,
        period: String,
        gross_minor: i64,
        state: HandoverState,
        handed_over: Authorization,
        settled: Option<Authorization>,
        mut lines: Vec<PayrollHandoverLine>,
    ) -> Result<Self, PayError> {
        if run_id.trim().is_empty() {
            return Err(PayError::InvalidId { field: "run id" });
        }
        // One line per person. Two lines for one employee would make "what were
        // they handed over for" a question with two answers, and the sum would
        // be right while the breakdown was nonsense.
        lines.sort_by(|left, right| left.employee_id.cmp(&right.employee_id));
        if let Some(pair) = lines.windows(2).find(|pair| {
            pair.first().map(|line| &line.employee_id) == pair.get(1).map(|line| &line.employee_id)
        }) {
            return Err(PayError::HandoverNamesSomebodyTwice {
                employee_id: pair
                    .first()
                    .map(|line| line.employee_id.clone())
                    .unwrap_or_default(),
            });
        }
        Ok(Self {
            run_id,
            unit,
            period,
            gross_minor,
            state,
            handed_over,
            settled,
            lines,
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }
    pub fn unit(&self) -> &UnitId {
        &self.unit
    }
    pub fn period(&self) -> &str {
        &self.period
    }
    pub const fn gross_minor(&self) -> i64 {
        self.gross_minor
    }
    pub const fn state(&self) -> HandoverState {
        self.state
    }
    pub const fn handed_over(&self) -> &Authorization {
        &self.handed_over
    }
    pub const fn settled(&self) -> Option<&Authorization> {
        self.settled.as_ref()
    }
    pub fn lines(&self) -> &[PayrollHandoverLine] {
        &self.lines
    }

    /// Finance says the money has gone out.
    ///
    /// Its own key, because it is Finance's statement and not HR's: a grant
    /// that could hand a liability over *and* declare it paid is one person
    /// closing the loop on their own request.
    pub fn settle(&mut self, authorization: Authorization) -> Result<(), PayError> {
        if !authorization.authorizes_payroll_settlement() {
            return Err(PayError::ActionForbidsPayrollStep {
                action_key: authorization.action_key().to_owned(),
                step: "settlement",
            });
        }
        if self.state == HandoverState::Paid {
            return Err(PayError::HandoverAlreadyPaid);
        }
        self.state = HandoverState::Paid;
        self.settled = Some(authorization);
        Ok(())
    }
}
