//! People's next generation: the six workloads the prototype added, as one
//! module.
//!
//! Each half here is small on purpose, and they share one property that is the
//! reason they live together: **every one of them is a request that becomes a
//! decision, and neither act may wear the other's name.** A roster swap is
//! filed by the person whose day moves; a change proposal is filed by the shop
//! and decided by head office; a checklist task is closed by whoever owns it;
//! an offer is answered by the candidate and recorded — never invented — by
//! head office. The state machines below carry that rule on the type, so a
//! stored row re-checks it on the way out of the database exactly as it was
//! checked on the way in.
//!
//! What is deliberately **not** here: money. The change proposal names figures
//! but applies none — applying calls the kernels that already own pay,
//! assignments and exits. The pipeline ends at the employment kernel. The
//! bonus tier is derived on read from the policy table, never stored. And
//! `hr_policy` holds guidance a decider reads, never a figure a journal
//! computes from.

use crate::cloud::domain::employment::{actions, Authorization, EmployeeId, UnitId};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

/// A decider's recorded answer, shared by every state machine below.
///
/// Only the note is the caller's; the authority is assembled by the handler
/// from the session, so a stored decision names whoever actually held the pen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub authorization: Authorization,
    #[serde(default)]
    pub note: Option<String>,
}

// ── roster swaps ─────────────────────────────────────────────────────────

/// Where a swap stands. `WITHDRAWN` is the requester's alone, and a decision
/// is terminal — a swap that happened cannot un-happen, only a new swap can
/// move the day back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SwapState {
    Pending,
    Approved,
    Rejected,
    Withdrawn,
}

impl SwapState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
            Self::Withdrawn => "WITHDRAWN",
        }
    }
}

/// One swap request over one person's one roster day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RosterSwap {
    pub id: String,
    pub employee_id: EmployeeId,
    pub with_employee_id: EmployeeId,
    pub unit_id: UnitId,
    pub on_date: NaiveDate,
    pub reason: String,
    pub state: SwapState,
    pub requested: Authorization,
    pub decision: Option<Decision>,
}

impl RosterSwap {
    pub fn file(
        employee_id: EmployeeId,
        with_employee_id: EmployeeId,
        unit_id: UnitId,
        on_date: NaiveDate,
        reason: &str,
        requested: Authorization,
    ) -> Result<Self, String> {
        if employee_id == with_employee_id {
            return Err("a swap with yourself changes nothing".to_owned());
        }
        let reason = reason.trim();
        if reason.is_empty() {
            return Err("a swap needs a reason".to_owned());
        }
        Ok(Self {
            id: id("rsw"),
            employee_id,
            with_employee_id,
            unit_id,
            on_date,
            reason: reason.to_owned(),
            state: SwapState::Pending,
            requested,
            decision: None,
        })
    }

    /// The requester takes a pending swap back. Anybody else who wants a
    /// pending swap gone must reject it, which records their name.
    pub fn withdraw(&mut self, actor: &str) -> Result<(), String> {
        if self.state != SwapState::Pending {
            return Err(format!(
                "swap {} is already {}",
                self.id,
                self.state.as_str()
            ));
        }
        if self.requested.actor().as_str() != actor {
            return Err("only the requester may withdraw a swap".to_owned());
        }
        self.state = SwapState::Withdrawn;
        Ok(())
    }

    /// The colleague's answer lives in the employee app and the decision on
    /// this row is the store head's. Both must be present before the roster
    /// moves, and the roster move itself refuses a closed period — which is
    /// why deciding is the handler's transaction, not this type's.
    pub fn decide(
        &mut self,
        approved: bool,
        decision: Decision,
        actor: &str,
    ) -> Result<(), String> {
        if self.state != SwapState::Pending {
            return Err(format!(
                "swap {} is already {}",
                self.id,
                self.state.as_str()
            ));
        }
        if self.requested.actor().as_str() == actor {
            return Err("the requester may not decide their own swap".to_owned());
        }
        self.state = if approved {
            SwapState::Approved
        } else {
            SwapState::Rejected
        };
        self.decision = Some(decision);
        Ok(())
    }
}

// ── employment change proposals ──────────────────────────────────────────

/// The four changes that rewrite who somebody is. The words are the
/// prototype's; the spelling is the schema's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChangeKind {
    Promotion,
    Transfer,
    Salary,
    Separation,
}

impl ChangeKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "PROMOTION" => Some(Self::Promotion),
            "TRANSFER" => Some(Self::Transfer),
            "SALARY" => Some(Self::Salary),
            "SEPARATION" => Some(Self::Separation),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Promotion => "PROMOTION",
            Self::Transfer => "TRANSFER",
            Self::Salary => "SALARY",
            Self::Separation => "SEPARATION",
        }
    }
}

/// One row of "what changes": the field, what it is now, what it becomes.
/// `from` is copied from the live record at filing time so the decider sees
/// the same starting point the filer saw.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeProp {
    pub field: String,
    pub from: serde_json::Value,
    pub to: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChangeState {
    Pending,
    Approved,
    Rejected,
    Withdrawn,
}

impl ChangeState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
            Self::Withdrawn => "WITHDRAWN",
        }
    }
}

/// A change head office has been asked to make to one employment record.
///
/// The props are guidance, not instructions: on approval the HTTP layer calls
/// the owning kernels with the decided values, and what the kernel wrote is
/// the truth. That is why [`Self::validate`] checks the *shape* of a kind's
/// props and nothing finer — a salary figure above the grade band is advice
/// the decider reads, not a wall the schema builds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeProposal {
    pub id: String,
    pub employee_id: EmployeeId,
    pub unit_id: UnitId,
    pub kind: ChangeKind,
    pub props: Vec<ChangeProp>,
    pub effective_on: NaiveDate,
    pub reason: String,
    pub state: ChangeState,
    pub filed: Authorization,
    pub decision: Option<Decision>,
    pub applied_at: Option<DateTime<Utc>>,
}

impl ChangeProposal {
    /// File one, refusing each malformed kind by name.
    ///
    /// - `SALARY` carries exactly one prop, `base_minor`, a positive integer —
    ///   a pay change that also moves somebody is two proposals.
    /// - `TRANSFER` carries exactly one prop, `unit_id`, naming somewhere
    ///   else.
    /// - `PROMOTION` carries `position` and/or `grade`.
    /// - `SEPARATION` carries no props; the date is the last day.
    pub fn file(
        employee_id: EmployeeId,
        unit_id: UnitId,
        kind: ChangeKind,
        props: Vec<ChangeProp>,
        effective_on: NaiveDate,
        reason: &str,
        filed: Authorization,
    ) -> Result<Self, String> {
        let reason = reason.trim();
        if reason.is_empty() {
            return Err("a change proposal needs a reason".to_owned());
        }
        let text = |field: &str| {
            props
                .iter()
                .find(|p| p.field == field)
                .and_then(|p| p.to.as_str())
                .map(str::to_owned)
        };
        match kind {
            ChangeKind::Salary => {
                if props.len() != 1 {
                    return Err("a salary change carries exactly one field: base_minor".to_owned());
                }
                let base = props[0]
                    .to
                    .as_i64()
                    .ok_or_else(|| "base_minor must be a whole number of rupiah".to_owned())?;
                if base <= 0 {
                    return Err("base_minor must be positive".to_owned());
                }
            }
            ChangeKind::Transfer => {
                if props.len() != 1 || text("unit_id").is_none() {
                    return Err("a transfer carries exactly one field: unit_id".to_owned());
                }
                if text("unit_id").as_deref() == Some(unit_id.as_str()) {
                    return Err("a transfer to the current unit changes nothing".to_owned());
                }
            }
            ChangeKind::Promotion => {
                if text("position").is_none() && text("grade").is_none() {
                    return Err("a promotion names a position and/or a grade".to_owned());
                }
            }
            ChangeKind::Separation => {
                if !props.is_empty() {
                    return Err(
                        "a separation carries no fields; the date is the last day".to_owned()
                    );
                }
            }
        }
        Ok(Self {
            id: id("chg"),
            employee_id,
            unit_id,
            kind,
            props,
            effective_on,
            reason: reason.to_owned(),
            state: ChangeState::Pending,
            filed,
            decision: None,
            applied_at: None,
        })
    }

    pub fn withdraw(&mut self, actor: &str) -> Result<(), String> {
        if self.state != ChangeState::Pending {
            return Err(format!(
                "proposal {} is already {}",
                self.id,
                self.state.as_str()
            ));
        }
        if self.filed.actor().as_str() != actor {
            return Err("only the filer may withdraw a proposal".to_owned());
        }
        self.state = ChangeState::Withdrawn;
        Ok(())
    }

    /// Head office's answer. The filer may not decide their own — the same
    /// two-actor rule the hire proposal carries, for the same reason.
    pub fn decide(
        &mut self,
        approved: bool,
        decision: Decision,
        actor: &str,
    ) -> Result<(), String> {
        if self.state != ChangeState::Pending {
            return Err(format!(
                "proposal {} is already {}",
                self.id,
                self.state.as_str()
            ));
        }
        if self.filed.actor().as_str() == actor {
            return Err("the filer may not decide their own proposal".to_owned());
        }
        self.state = if approved {
            ChangeState::Approved
        } else {
            ChangeState::Rejected
        };
        self.decision = Some(decision);
        Ok(())
    }

    /// Mark applied. Only an approved proposal is ever applied, and only once.
    pub fn mark_applied(&mut self, at: DateTime<Utc>) -> Result<(), String> {
        if self.state != ChangeState::Approved {
            return Err("only an approved proposal is applied".to_owned());
        }
        if self.applied_at.is_some() {
            return Err(format!("proposal {} is already applied", self.id));
        }
        self.applied_at = Some(at);
        Ok(())
    }

    /// The decided value of one field, for the apply step.
    pub fn decided(&self, field: &str) -> Option<&serde_json::Value> {
        self.props.iter().find(|p| p.field == field).map(|p| &p.to)
    }

    /// The action key that authorizes applying this kind.
    pub const fn apply_key(&self) -> &'static str {
        match self.kind {
            // A separation runs the employment state machine, whose key is
            // the one `authorizes_employment_change` accepts.
            ChangeKind::Separation => actions::EMPLOYMENT_CHANGE,
            // The rest write assignments, contracts and pay agreements.
            _ => actions::ASSIGNMENT_MANAGE,
        }
    }
}

// ── the onboarding and separation checklist ──────────────────────────────

/// Who owns a checklist task. The employee's own tasks are the only ones the
/// phone app may close, and it does so under its own key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskOwner {
    HeadOffice,
    Store,
    It,
    Employee,
}

impl TaskOwner {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "HEAD_OFFICE" => Some(Self::HeadOffice),
            "STORE" => Some(Self::Store),
            "IT" => Some(Self::It),
            "EMPLOYEE" => Some(Self::Employee),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::HeadOffice => "HEAD_OFFICE",
            Self::Store => "STORE",
            Self::It => "IT",
            Self::Employee => "EMPLOYEE",
        }
    }
}

/// Which checklist a task belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleKind {
    Onboarding,
    Separation,
}

impl LifecycleKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "ONBOARDING" => Some(Self::Onboarding),
            "SEPARATION" => Some(Self::Separation),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Onboarding => "ONBOARDING",
            Self::Separation => "SEPARATION",
        }
    }
}

/// One instance of one template task, for one person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LifecycleTask {
    pub id: String,
    pub employee_id: EmployeeId,
    pub kind: LifecycleKind,
    pub template_id: String,
    pub state: TaskState,
    pub done: Option<Authorization>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskState {
    Pending,
    Done,
}

impl LifecycleTask {
    pub fn new(employee_id: EmployeeId, kind: LifecycleKind, template_id: &str) -> Self {
        Self {
            id: id("tsk"),
            employee_id,
            kind,
            template_id: template_id.to_owned(),
            state: TaskState::Pending,
            done: None,
        }
    }
}

// ── the recruitment pipeline ─────────────────────────────────────────────

/// Where an applicant stands. Forward is the funnel; `REJECTED` is the only
/// exit besides `HIRED`, and both are terminal — a rejected applicant who
/// returns is a new applicant, because the old row is the record that
/// somebody once said no.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplicantStage {
    New,
    Shortlist,
    Interview,
    Offer,
    Hired,
    Rejected,
}

impl ApplicantStage {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "NEW" => Some(Self::New),
            "SHORTLIST" => Some(Self::Shortlist),
            "INTERVIEW" => Some(Self::Interview),
            "OFFER" => Some(Self::Offer),
            "HIRED" => Some(Self::Hired),
            "REJECTED" => Some(Self::Rejected),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::New => "NEW",
            Self::Shortlist => "SHORTLIST",
            Self::Interview => "INTERVIEW",
            Self::Offer => "OFFER",
            Self::Hired => "HIRED",
            Self::Rejected => "REJECTED",
        }
    }

    /// The stages a name may move to from here. Moving backwards is a
    /// rejection and a fresh row, not a rewind.
    pub const fn may_move_to(self) -> &'static [Self] {
        match self {
            Self::New => &[Self::Shortlist, Self::Interview, Self::Rejected],
            Self::Shortlist => &[Self::Interview, Self::Rejected],
            Self::Interview => &[Self::Offer, Self::Rejected],
            Self::Offer => &[Self::Hired, Self::Rejected],
            Self::Hired | Self::Rejected => &[],
        }
    }
}

/// One person who applied to one requisition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobApplicant {
    pub id: String,
    pub proposal_id: String,
    pub unit_id: UnitId,
    pub name: String,
    pub phone: Option<String>,
    pub source: String,
    pub referrer_employee_id: Option<EmployeeId>,
    pub stage: ApplicantStage,
    pub stage_note: Option<String>,
    pub applied_on: NaiveDate,
}

impl JobApplicant {
    pub fn file(
        proposal_id: String,
        unit_id: UnitId,
        name: &str,
        phone: Option<String>,
        source: &str,
        referrer_employee_id: Option<EmployeeId>,
        applied_on: NaiveDate,
    ) -> Result<Self, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("an applicant needs a name".to_owned());
        }
        let source = source.trim();
        if source.is_empty() {
            return Err("an applicant needs a source".to_owned());
        }
        Ok(Self {
            id: id("app"),
            proposal_id,
            unit_id,
            name: name.to_owned(),
            phone,
            source: source.to_owned(),
            referrer_employee_id,
            stage: ApplicantStage::New,
            stage_note: None,
            applied_on,
        })
    }

    /// Move the funnel. Moving to `OFFER` requires an offer row (checked by
    /// the handler, which owns the offer table); moving to `HIRED` happens
    /// only through the hire route, never through this.
    pub fn move_to(&mut self, stage: ApplicantStage, note: Option<String>) -> Result<(), String> {
        if !self.stage.may_move_to().contains(&stage) {
            return Err(format!(
                "an applicant at {} may not move to {}",
                self.stage.as_str(),
                stage.as_str()
            ));
        }
        self.stage = stage;
        self.stage_note = note;
        Ok(())
    }
}

/// One scheduled conversation, and its appended result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplicantInterview {
    pub id: String,
    pub applicant_id: String,
    pub scheduled_at: DateTime<Utc>,
    pub interviewer_employee_id: EmployeeId,
    pub result: InterviewResult,
    pub ratings: std::collections::BTreeMap<String, u8>,
    pub note: Option<String>,
    pub recorded: Authorization,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InterviewResult {
    Scheduled,
    Pass,
    Fail,
}

impl ApplicantInterview {
    pub fn schedule(
        applicant_id: String,
        scheduled_at: DateTime<Utc>,
        interviewer_employee_id: EmployeeId,
        recorded: Authorization,
    ) -> Self {
        Self {
            id: id("ivw"),
            applicant_id,
            scheduled_at,
            interviewer_employee_id,
            result: InterviewResult::Scheduled,
            ratings: Default::default(),
            note: None,
            recorded,
        }
    }

    /// Append the outcome. Ratings are 1..=5 per skill code; a result without
    /// ratings is an answer with no evidence, so it is refused for a pass.
    pub fn record(
        &mut self,
        result: InterviewResult,
        ratings: std::collections::BTreeMap<String, u8>,
        note: Option<String>,
        actor: &str,
    ) -> Result<(), String> {
        if self.result != InterviewResult::Scheduled {
            return Err("this interview already has a result".to_owned());
        }
        if result == InterviewResult::Scheduled {
            return Err("the result is what is being recorded".to_owned());
        }
        if self.recorded.actor().as_str() == actor
            && result == InterviewResult::Pass
            && ratings.is_empty()
        {
            return Err("a pass needs the ratings it passed on".to_owned());
        }
        for (skill, score) in &ratings {
            if !(1..=5).contains(score) {
                return Err(format!("rating for {skill} must be between 1 and 5"));
            }
        }
        self.result = result;
        self.ratings = ratings;
        self.note = note;
        Ok(())
    }
}

/// The offer, and the candidate's answer to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobOffer {
    pub id: String,
    pub applicant_id: String,
    pub base_minor: i64,
    pub grade: String,
    pub starts_on: NaiveDate,
    pub term: String,
    pub state: OfferState,
    pub offered: Authorization,
    pub decided: Option<Decision>,
    pub hired_employee_id: Option<EmployeeId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OfferState {
    Waiting,
    Accepted,
    Declined,
    Withdrawn,
}

impl JobOffer {
    pub fn make(
        applicant_id: String,
        base_minor: i64,
        grade: &str,
        starts_on: NaiveDate,
        term: &str,
        offered: Authorization,
    ) -> Result<Self, String> {
        if base_minor <= 0 {
            return Err("an offer carries a positive base".to_owned());
        }
        let grade = grade.trim();
        if grade.is_empty() {
            return Err("an offer names a grade".to_owned());
        }
        let term = term.trim();
        if term.is_empty() {
            return Err("an offer states its term".to_owned());
        }
        Ok(Self {
            id: id("ofr"),
            applicant_id,
            base_minor,
            grade: grade.to_owned(),
            starts_on,
            term: term.to_owned(),
            state: OfferState::Waiting,
            offered,
            decided: None,
            hired_employee_id: None,
        })
    }

    /// Record the candidate's answer. Head office records it; nobody here
    /// pretends to be the candidate.
    pub fn decide(&mut self, accepted: bool, decision: Decision) -> Result<(), String> {
        if self.state != OfferState::Waiting {
            return Err(format!("offer {} is already {}", self.id, self.state_str()));
        }
        self.state = if accepted {
            OfferState::Accepted
        } else {
            OfferState::Declined
        };
        self.decided = Some(decision);
        Ok(())
    }

    /// Head office takes a waiting offer back.
    pub fn withdraw(&mut self, actor: &str, reason: &str) -> Result<(), String> {
        if self.state != OfferState::Waiting {
            return Err(format!("offer {} is already {}", self.id, self.state_str()));
        }
        if self.offered.actor().as_str() != actor {
            return Err("only the offerer may withdraw an offer".to_owned());
        }
        if reason.trim().is_empty() {
            return Err("a withdrawal needs a reason".to_owned());
        }
        self.state = OfferState::Withdrawn;
        Ok(())
    }

    /// Bind the employment record the accepted offer produced.
    pub fn mark_hired(&mut self, employee_id: EmployeeId) -> Result<(), String> {
        if self.state != OfferState::Accepted {
            return Err("only an accepted offer hires".to_owned());
        }
        if self.hired_employee_id.is_some() {
            return Err("this offer already hired".to_owned());
        }
        self.hired_employee_id = Some(employee_id);
        Ok(())
    }

    const fn state_str(&self) -> &'static str {
        match self.state {
            OfferState::Waiting => "WAITING",
            OfferState::Accepted => "ACCEPTED",
            OfferState::Declined => "DECLINED",
            OfferState::Withdrawn => "WITHDRAWN",
        }
    }
}

/// The quota a requisition is measured against, for one place, position and
/// span.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StaffingPlan {
    pub id: String,
    pub unit_id: UnitId,
    pub position: String,
    pub span: String,
    pub headcount: u32,
    pub cost_minor: i64,
    pub defined: Authorization,
}

impl StaffingPlan {
    pub fn define(
        unit_id: UnitId,
        position: &str,
        span: &str,
        headcount: u32,
        cost_minor: i64,
        defined: Authorization,
    ) -> Result<Self, String> {
        let position = position.trim();
        if position.is_empty() {
            return Err("a plan names a position".to_owned());
        }
        let span = span.trim();
        if span.is_empty() {
            return Err("a plan names its span".to_owned());
        }
        if headcount == 0 {
            return Err("a plan for nobody is not a plan".to_owned());
        }
        if cost_minor < 0 {
            return Err("a plan's cost is not negative".to_owned());
        }
        Ok(Self {
            id: id("stp"),
            unit_id,
            position: position.to_owned(),
            span: span.to_owned(),
            headcount,
            cost_minor,
            defined,
        })
    }
}

// ── performance ──────────────────────────────────────────────────────────

/// Which figure a metric is and where it comes from. `MANAGER` and
/// `ATTENDANCE` are recorded here today; `POS` is the number the till will
/// hand over one day, typed by hand until it does — and the template says so,
/// which is the honest half of a screen that would otherwise read as if the
/// figures were wired.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceTemplate {
    pub position: String,
    pub metric: String,
    pub weight: u8,
    pub source: String,
}

/// One person's month. The bonus tier is *not* here — it is derived on read
/// from `hr_policy`, so a policy change is visible on every screen that
/// shows a tier, including the ones for months already recorded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceScore {
    pub employee_id: EmployeeId,
    pub period: NaiveDate,
    pub kpi_pct: f64,
    pub manager_score: u8,
    pub note: Option<String>,
    pub recorded: Authorization,
}

impl PerformanceScore {
    pub fn record(
        employee_id: EmployeeId,
        period: NaiveDate,
        kpi_pct: f64,
        manager_score: u8,
        note: Option<String>,
        recorded: Authorization,
    ) -> Result<Self, String> {
        if period.day() != 1 {
            return Err("a performance period is the first day of its month".to_owned());
        }
        if !(0.0..=200.0).contains(&kpi_pct) {
            return Err("kpi_pct is a percentage between 0 and 200".to_owned());
        }
        if !(1..=5).contains(&manager_score) {
            return Err("manager_score is 1 to 5".to_owned());
        }
        Ok(Self {
            employee_id,
            period,
            kpi_pct,
            manager_score,
            note,
            recorded,
        })
    }
}

// ── training ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TrainingState {
    Scheduled,
    Done,
}

/// One program. Cost is recorded, never posted: Manpower development is
/// Finance's account to fill, and this is the figure they fill it from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingProgram {
    pub id: String,
    pub title: String,
    pub on_date: NaiveDate,
    pub place: String,
    pub cost_minor: i64,
    pub state: TrainingState,
    pub defined: Authorization,
}

impl TrainingProgram {
    pub fn define(
        title: &str,
        on_date: NaiveDate,
        place: &str,
        cost_minor: i64,
        defined: Authorization,
    ) -> Result<Self, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("a program needs a title".to_owned());
        }
        let place = place.trim();
        if place.is_empty() {
            return Err("a program names where it runs".to_owned());
        }
        if cost_minor < 0 {
            return Err("a program's cost is not negative".to_owned());
        }
        Ok(Self {
            id: id("trn"),
            title: title.to_owned(),
            on_date,
            place: place.to_owned(),
            cost_minor,
            state: TrainingState::Scheduled,
            defined,
        })
    }
}

// ── benefits ─────────────────────────────────────────────────────────────

/// One uniform handover. The annual entitlement is policy; these rows are the
/// count against it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UniformIssuance {
    pub id: String,
    pub employee_id: EmployeeId,
    pub issued_on: NaiveDate,
    pub sets: u8,
    pub recorded: Authorization,
}

impl UniformIssuance {
    pub fn record(
        employee_id: EmployeeId,
        issued_on: NaiveDate,
        sets: u8,
        recorded: Authorization,
    ) -> Result<Self, String> {
        if sets == 0 {
            return Err("recording zero sets is not a handover".to_owned());
        }
        Ok(Self {
            id: id("uni"),
            employee_id,
            issued_on,
            sets,
            recorded,
        })
    }
}
