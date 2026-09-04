//! Who acted, under what authority, when, and why.
//!
//! # Why an action key and not a role
//!
//! The reference this is ported from carries its own role vocabulary
//! (`HR_OFFICER`, `HEAD_OFFICE`, `EMPLOYEE_SELF_SERVICE`) sourced from a second
//! directory of actors. We already have one ladder — `CASHIER < SUPERVISOR <
//! ADMIN` — and a second would be two answers to "may they".
//!
//! So a recorded decision names the **action key** the actor exercised, and
//! [`required_role`] is the single place that says which rung of our ladder
//! that key needs. The property the reference cared about survives exactly: an
//! employment change is not representable without naming its actor, its
//! authority and its reason, and the gate is re-checked when a stored record is
//! decoded.
//!
//! The keys are finer than the ladder can currently express — `PROFILE_READ` is
//! separate from `EMPLOYEE_READ` even though both map to a rung today. That is
//! deliberate: the distinction is real, it is recorded from the first day, and
//! the day we grow per-place grants only [`required_role`] changes. Nothing
//! stored has to be migrated, because the stored value was never the rung.

use super::error::EmployeeError;
use super::ids::{ActorId, ReasonText};
use crate::cloud::domain::Role;
use chrono::{DateTime, Utc};

/// The HR action keys — all of them, not only employment's.
///
/// One key space and one [`required_role`], deliberately. Attendance policy
/// lives here rather than beside the attendance domain because the moment there
/// are two mappings from "what somebody is trying to do" to "which rung that
/// needs", there are two answers to "may they" — and the one that drifts is
/// always the one nobody is looking at.
///
/// Kept beside the state machine rather than in the HTTP layer because
/// [`Authorization::authorizes_employment_change`] is a *domain* rule: which
/// authority may end someone's employment is not a routing question.
pub mod actions {
    pub const EMPLOYEE_READ: &str = "people.employee.read";
    pub const EMPLOYEE_CREATE: &str = "people.employee.create";
    /// Hire, suspend, reinstate, terminate.
    pub const EMPLOYMENT_CHANGE: &str = "people.employment.change";
    /// Correct a badge/NIP without touching identity.
    pub const EMPLOYEE_CODE_CORRECT: &str = "people.employee.code_correct";
    pub const ASSIGNMENT_MANAGE: &str = "people.assignment.manage";
    /// Bind an employment record to a login account.
    pub const ACCOUNT_LINK: &str = "people.account.link";
    /// Issue a login for somebody who has none: create the account, set its
    /// rung, bind it to the employment record, and grant it a till.
    ///
    /// Its own key rather than [`ACCOUNT_LINK`] because it does more than bind:
    /// binding says an existing credential is this person's, and this one
    /// *creates* the credential and decides what it may do. A grant that could
    /// bind but not issue is a real position to hold — it is the one an HR
    /// assistant should have — and one key covering both could not express it.
    pub const ACCOUNT_PROVISION: &str = "people.account.provision";

    /// Read personal data — name, NIK, address, contact, date of birth.
    ///
    /// Separate from [`EMPLOYEE_READ`] on purpose. "Who is on shift" and "what
    /// is this person's NIK and home address" are different questions with
    /// different audiences, and one grant answering both is how a rota screen
    /// ends up exposing a national identity number.
    pub const PROFILE_READ: &str = "people.profile.read";
    /// Change personal data.
    pub const PROFILE_CHANGE: &str = "people.profile.change";
    /// Sign, renew or amend an employment contract.
    pub const CONTRACT_CHANGE: &str = "people.contract.change";
    /// Decide what counts as late, early, or overtime.
    ///
    /// Reading the policy needs no key at all — somebody being measured against
    /// a tolerance is entitled to know it, and a rule kept from the people it
    /// governs is a trap rather than a rule. Setting it is head office's.
    pub const ATTENDANCE_POLICY_SET: &str = "people.attendance_policy.set";

    // ── the place manager's day ──────────────────────────────────────────
    //
    // Five keys at the supervisor rung, and they are the reason
    // `super::super::reach` exists. Every store manager holds the same rung,
    // so the rung alone cannot tell store-07's manager from store-03's — each
    // of these is bounded by the caller's own open posting, and Admin is
    // unbounded. `required_role` still answers *which rung*; `Reach` answers
    // *where*.

    /// Build next week's schedule, and revise it.
    pub const ROSTER_MANAGE: &str = "people.roster.manage";
    /// Approve or refuse a leave request.
    pub const LEAVE_DECIDE: &str = "people.leave.decide";
    /// File a leave request on somebody else's behalf.
    ///
    /// A place manager's, and bounded by their reach. It exists because not
    /// every warehouse hand carries a phone, and a system where the only way to
    /// ask for leave is an app is a system where those people stop asking.
    pub const LEAVE_REQUEST: &str = "people.leave.request";
    /// Ask for your own leave.
    ///
    /// The cashier rung — everybody signed in holds it — and the bound is the
    /// record, not the rung: it reaches the caller's own employment record and
    /// no other. Deliberately a separate key from [`LEAVE_REQUEST`], because
    /// "may ask for their own" and "may ask on anyone's behalf" are different
    /// grants and one key covering both is how a self-service app becomes a way
    /// to file leave against a colleague.
    pub const LEAVE_REQUEST_OWN: &str = "people.leave.request_own";
    /// Order overtime. The employer's written instruction — half of what
    /// PP 35/2021 art. 26(2) requires.
    pub const OVERTIME_ORDER: &str = "people.overtime.order";
    /// Answer an order: agree to it, or refuse it.
    ///
    /// **Held by the worker, never by their supervisor.** A key a manager holds
    /// that records the worker's agreement is not the worker's agreement — it
    /// is the manager agreeing twice, which is the single-consent model this
    /// pair of keys exists to refuse, wearing two hats.
    ///
    /// The cashier rung, like [`LEAVE_REQUEST_OWN`], and bounded to the
    /// caller's own record by the handler rather than by the rung.
    pub const OVERTIME_CONSENT_OWN: &str = "people.overtime.consent_own";
    /// Decide an attendance correction.
    pub const CORRECTION_DECIDE: &str = "people.correction.decide";
    /// Sign off a month's attendance for one place. Reopening a closed period
    /// is [`ATTENDANCE_PERIOD_REOPEN`] and is head office's — a place that
    /// could reopen its own sign-off has not signed anything off.
    pub const ATTENDANCE_PERIOD_CLOSE: &str = "people.attendance_period.close";
    /// Undo a closure, at head office.
    pub const ATTENDANCE_PERIOD_REOPEN: &str = "people.attendance_period.reopen";

    // ── the rules everybody else is measured against ─────────────────────
    //
    // Head office's, all of them. These are not decisions about one person in
    // one shop; they are the vocabulary the shops decide in.

    /// Define the kinds of leave and their entitlements, and ratify the policy
    /// a balance folds under.
    ///
    /// One key for both because they are one decision: how many days a year,
    /// how they accrue, what carries forward and what a kind of leave draws on
    /// are answers to the same question, and a grant that could set the kinds
    /// but not the entitlement would be a grant that could not finish the job.
    pub const LEAVE_TYPE_SET: &str = "people.leave_type.set";
    /// Put days into somebody's balance, or correct one.
    ///
    /// Head office's, and separate from [`LEAVE_TYPE_SET`] because it is about
    /// one person rather than about the rules. A manager who could hand
    /// somebody days could hand themselves some, which is why it is not at the
    /// rung that decides requests.
    ///
    /// It cannot spend a balance: `USAGE` is refused on this path, and the only
    /// way days leave a balance is an approval that mints the deduction in the
    /// same transaction.
    pub const LEAVE_GRANT: &str = "people.leave.grant";
    /// Publish the year's public holidays, and amend them when the government
    /// moves one — which it does, by decree, in the middle of the year.
    pub const HOLIDAY_SET: &str = "people.holiday.set";
    /// Define the shift patterns a roster may be built from.
    pub const SHIFT_PATTERN_SET: &str = "people.shift_pattern.set";
    /// Ratify the overtime caps.
    ///
    /// Head office's, and its own key rather than a mode of
    /// [`OVERTIME_ORDER`]: the manager who orders overtime must not be the one
    /// who decides how much of it is lawful.
    pub const OVERTIME_POLICY_SET: &str = "people.overtime_policy.set";

    // ── money ────────────────────────────────────────────────────────────

    /// Agree or amend somebody's pay. An agreement, effective-dated: a salary
    /// is a history, not a number.
    pub const PAY_CHANGE: &str = "people.pay.change";
    /// Check a payroll run's figures against what it was computed from.
    pub const PAYROLL_VERIFY: &str = "people.payroll.verify";
    /// Approve a verified run. Deliberately a separate key from
    /// [`PAYROLL_VERIFY`] even though both map to the same rung today: the
    /// two-person rule is enforced on the actor, and a rule stated in one key
    /// could not be.
    pub const PAYROLL_APPROVE: &str = "people.payroll.approve";
    /// Seal an approved run, after which its figures do not move.
    pub const PAYROLL_SEAL: &str = "people.payroll.seal";
    /// Reopen a run. The one that undoes work somebody has signed for, which
    /// is why it is its own key and not a mode of the others.
    pub const PAYROLL_REOPEN: &str = "people.payroll.reopen";

    /// The keys that may move the employment state machine.
    pub const EMPLOYMENT_CHANGING: &[&str] = &[EMPLOYMENT_CHANGE];
    /// The keys that may change personal data.
    pub const PROFILE_CHANGING: &[&str] = &[PROFILE_CHANGE];
    /// The keys that may write a contract.
    pub const CONTRACT_CHANGING: &[&str] = &[CONTRACT_CHANGE];
    /// The keys that may publish or amend a holiday calendar.
    ///
    /// One key for both, deliberately: adding a *cuti bersama* in March is the
    /// same act with the same consequence as publishing the year in January —
    /// it changes what people are owed. Splitting them would suggest the later
    /// change is the smaller one, and it is usually the larger, because by then
    /// the year is running.
    pub const HOLIDAY_SETTING: &[&str] = &[HOLIDAY_SET];
    /// The keys that may ask for leave. Deliberately excludes
    /// [`LEAVE_DECIDE`]: granting leave is not asking for it.
    pub const LEAVE_REQUESTING: &[&str] = &[LEAVE_REQUEST, LEAVE_REQUEST_OWN];
    /// The keys that may decide one. Deliberately excludes both requesting
    /// keys: asking for leave is not granting it.
    pub const LEAVE_DECIDING: &[&str] = &[LEAVE_DECIDE];
    /// The keys that may agree or amend pay, and the payroll identity that
    /// goes with it. One key for both: a bank account is not worth less than
    /// the amount paid into it.
    pub const PAY_CHANGING: &[&str] = &[PAY_CHANGE];
    /// The keys that may verify a payroll run.
    pub const PAYROLL_VERIFYING: &[&str] = &[PAYROLL_VERIFY];
    /// The keys that may approve one. **Disjoint from [`PAYROLL_VERIFYING`]**,
    /// which is what lets the two-person rule compare actors at all.
    pub const PAYROLL_APPROVING: &[&str] = &[PAYROLL_APPROVE];
    /// The keys that may seal one.
    pub const PAYROLL_SEALING: &[&str] = &[PAYROLL_SEAL];
    /// The keys that may send one back. Its own, because it undoes work
    /// somebody has signed for.
    pub const PAYROLL_REOPENING: &[&str] = &[PAYROLL_REOPEN];
    /// The keys that may plan or revise a roster.
    ///
    /// A plan is upstream of money — an absence only exists against one — so
    /// this is the same rung as deciding leave and is bounded the same way.
    pub const ROSTER_CHANGING: &[&str] = &[ROSTER_MANAGE];
    /// The keys that may sign off a month.
    pub const PERIOD_CLOSING: &[&str] = &[ATTENDANCE_PERIOD_CLOSE];
    /// The keys that may undo a sign-off. **Disjoint from
    /// [`PERIOD_CLOSING`]**: a place that could reopen its own close has not
    /// closed anything.
    pub const PERIOD_REOPENING: &[&str] = &[ATTENDANCE_PERIOD_REOPEN];
    /// The keys that may order overtime, or take an order back.
    pub const OVERTIME_ORDERING: &[&str] = &[OVERTIME_ORDER];
    /// The keys that may answer one. **Deliberately disjoint from
    /// [`OVERTIME_ORDERING`]** — that disjointness is the whole rule.
    pub const OVERTIME_CONSENTING: &[&str] = &[OVERTIME_CONSENT_OWN];
}

/// Which rung of the ladder an action key needs.
///
/// Running a place is supervisor work — a shop's manager has to know who is on
/// today, schedule next week, approve the leave that breaks it, order the
/// overtime that repairs it, and sign off the month. Everything else is head
/// office: hiring, ending employment, moving somebody between shops, reading a
/// NIK, and every rule the places are measured against are things a shift
/// supervisor has no business doing from a till.
///
/// **This is only half of "may they."** Every supervisor holds the same rung,
/// so a rung cannot say that store-07's manager may decide store-07's leave and
/// not store-03's. The other half is [`super::reach::Reach`], resolved from the
/// caller's own posting; the supervisor-rung keys below are bounded by it and
/// Admin is unbounded. Keeping the two apart is what lets this stay one mapping
/// rather than growing a second directory of grants.
///
/// The unknown key maps to `Admin` rather than to a permissive default. A key
/// this function has not been taught about is a bug, and the safe reading of a
/// bug is "nobody", not "everybody".
pub fn required_role(action_key: &str) -> Role {
    match action_key {
        actions::EMPLOYEE_READ
        | actions::ROSTER_MANAGE
        | actions::LEAVE_DECIDE
        | actions::OVERTIME_ORDER
        | actions::CORRECTION_DECIDE
        | actions::ATTENDANCE_PERIOD_CLOSE
        | actions::LEAVE_REQUEST => Role::Supervisor,
        // Everybody signed in may ask for their own leave. The bound is the
        // record rather than the rung — the handler serves this key only for
        // the caller's own employment record — because a cashier who could not
        // ask for their own holiday would have to ask their manager to ask.
        // Answering an order about your own evening is yours, at any rung, and
        // the bound is the record rather than the ladder. A cashier who could
        // not answer would have to have their supervisor answer for them, which
        // is precisely the single-consent shape the two keys refuse.
        actions::LEAVE_REQUEST_OWN | actions::OVERTIME_CONSENT_OWN => Role::Cashier,
        _ => Role::Admin,
    }
}

/// One authorized decision, as recorded.
///
/// Of its parts only the reason is the caller's to supply: the actor comes from
/// the session, the action key from the authorization decision, and the instant
/// from the server clock. The constructors take them separately so a handler
/// cannot accept an authority from a request body.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Authorization {
    actor: ActorId,
    action_key: String,
    at: DateTime<Utc>,
    reason: ReasonText,
}

impl Authorization {
    pub fn new(
        actor: ActorId,
        action_key: impl Into<String>,
        at: DateTime<Utc>,
        reason: ReasonText,
    ) -> Self {
        Self {
            actor,
            action_key: action_key.into(),
            at,
            reason,
        }
    }

    pub fn try_new(
        actor: &str,
        action_key: &str,
        at: DateTime<Utc>,
        reason: &str,
    ) -> Result<Self, EmployeeError> {
        Ok(Self::new(
            ActorId::try_new(actor)?,
            action_key,
            at,
            ReasonText::try_new(reason)?,
        ))
    }

    pub fn actor(&self) -> &ActorId {
        &self.actor
    }

    pub fn action_key(&self) -> &str {
        &self.action_key
    }

    pub fn at(&self) -> DateTime<Utc> {
        self.at
    }

    pub fn reason(&self) -> &ReasonText {
        &self.reason
    }

    /// May this authority move the employment state machine?
    ///
    /// Re-checked on decode as well as on the live path. A rule only the live
    /// path enforces is a rule that a round trip through storage removes.
    pub fn authorizes_employment_change(&self) -> bool {
        actions::EMPLOYMENT_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority change personal data?
    ///
    /// Re-checked on decode, like the employment gate: an amendment that no
    /// grant covers must not become history by way of a stored row.
    pub fn authorizes_profile_change(&self) -> bool {
        actions::PROFILE_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority write a contract?
    pub fn authorizes_contract_change(&self) -> bool {
        actions::CONTRACT_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority publish or amend a holiday calendar?
    ///
    /// Re-checked on decode like the others: a calendar stored under a key that
    /// never permitted it must not become the year's red days by way of a row.
    pub fn authorizes_holiday_change(&self) -> bool {
        actions::HOLIDAY_SETTING.contains(&self.action_key.as_str())
    }

    /// May this authority file a leave request?
    pub fn authorizes_leave_request(&self) -> bool {
        actions::LEAVE_REQUESTING.contains(&self.action_key.as_str())
    }

    /// May this authority decide one?
    ///
    /// The gate that keeps an approval from being recorded under the key
    /// somebody used to ask — which would be the employee approving their own
    /// leave, wearing the shape of a decision.
    pub fn authorizes_leave_decision(&self) -> bool {
        actions::LEAVE_DECIDING.contains(&self.action_key.as_str())
    }

    /// May this authority agree or amend pay?
    pub fn authorizes_pay_change(&self) -> bool {
        actions::PAY_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority verify a payroll run?
    pub fn authorizes_payroll_verify(&self) -> bool {
        actions::PAYROLL_VERIFYING.contains(&self.action_key.as_str())
    }

    /// May this authority approve one?
    ///
    /// Disjoint from verifying, and re-checked on decode: a stored run whose
    /// two signatures were made under one key is a control one person
    /// completed alone.
    pub fn authorizes_payroll_approve(&self) -> bool {
        actions::PAYROLL_APPROVING.contains(&self.action_key.as_str())
    }

    /// May this authority seal one?
    pub fn authorizes_payroll_seal(&self) -> bool {
        actions::PAYROLL_SEALING.contains(&self.action_key.as_str())
    }

    /// May this authority send one back to draft?
    pub fn authorizes_payroll_reopen(&self) -> bool {
        actions::PAYROLL_REOPENING.contains(&self.action_key.as_str())
    }

    /// May this authority plan or revise a roster?
    ///
    /// Re-checked on decode, because a stored day whose plan nobody was allowed
    /// to make is an unattributable input to a pay decision.
    pub fn authorizes_roster_change(&self) -> bool {
        actions::ROSTER_CHANGING.contains(&self.action_key.as_str())
    }

    /// May this authority close a month?
    pub fn authorizes_period_close(&self) -> bool {
        actions::PERIOD_CLOSING.contains(&self.action_key.as_str())
    }

    /// May this authority reopen one?
    pub fn authorizes_period_reopen(&self) -> bool {
        actions::PERIOD_REOPENING.contains(&self.action_key.as_str())
    }

    /// May this authority order overtime, or withdraw an order?
    pub fn authorizes_overtime_order(&self) -> bool {
        actions::OVERTIME_ORDERING.contains(&self.action_key.as_str())
    }

    /// May this authority answer an overtime order?
    ///
    /// The gate the overtime module exists for, re-checked on decode as well as
    /// on the live path: a consent recorded under a supervisor's key is the
    /// supervisor agreeing twice, and a stored row in that shape must fail to
    /// load rather than become authorized hours.
    pub fn authorizes_overtime_consent(&self) -> bool {
        actions::OVERTIME_CONSENTING.contains(&self.action_key.as_str())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_the_roster_is_supervisor_work_and_everything_else_is_head_office() {
        assert_eq!(required_role(actions::EMPLOYEE_READ), Role::Supervisor);
        assert_eq!(required_role(actions::PROFILE_READ), Role::Admin);
        assert_eq!(required_role(actions::EMPLOYMENT_CHANGE), Role::Admin);
        assert_eq!(required_role(actions::CONTRACT_CHANGE), Role::Admin);
    }

    /// Running a place is the shop manager's; the rules the places are measured
    /// against are head office's. The split is the formulation approved on
    /// 2026-09-04, and this is where it is stated once.
    #[test]
    fn a_place_manager_runs_their_week_and_head_office_writes_the_rules() {
        for key in [
            actions::ROSTER_MANAGE,
            actions::LEAVE_DECIDE,
            actions::OVERTIME_ORDER,
            actions::CORRECTION_DECIDE,
            actions::ATTENDANCE_PERIOD_CLOSE,
        ] {
            assert_eq!(required_role(key), Role::Supervisor, "{key}");
        }
        for key in [
            actions::ATTENDANCE_PERIOD_REOPEN,
            actions::LEAVE_TYPE_SET,
            actions::HOLIDAY_SET,
            actions::SHIFT_PATTERN_SET,
            actions::ATTENDANCE_POLICY_SET,
        ] {
            assert_eq!(required_role(key), Role::Admin, "{key}");
        }
    }

    /// Hari's explicit decision: a place manager closes their attendance period
    /// and never touches a payroll run. Verify, approve, seal and reopen are
    /// head office's, and a run a shop could approve is a run the shop approves
    /// for itself.
    #[test]
    fn payroll_is_head_office_from_verify_to_seal() {
        for key in [
            actions::PAY_CHANGE,
            actions::PAYROLL_VERIFY,
            actions::PAYROLL_APPROVE,
            actions::PAYROLL_SEAL,
            actions::PAYROLL_REOPEN,
        ] {
            assert_eq!(required_role(key), Role::Admin, "{key}");
        }
        // Distinct keys, not one key used twice: the two-person rule compares
        // the actor who verified with the actor who approved, and it could not
        // if the same grant covered both.
        assert_ne!(actions::PAYROLL_VERIFY, actions::PAYROLL_APPROVE);
    }

    /// Issuing a credential is head office's, because it is the act that
    /// decides what the person may do.
    #[test]
    fn only_head_office_may_issue_a_login() {
        assert_eq!(required_role(actions::ACCOUNT_PROVISION), Role::Admin);
        // Issuing a credential is not the same grant as binding one that
        // already exists, and the distinction is recorded from the first day.
        assert_ne!(actions::ACCOUNT_PROVISION, actions::ACCOUNT_LINK);
    }


    /// A key nobody taught this function about must not be a way in.
    #[test]
    fn an_unknown_action_key_admits_nobody_below_admin() {
        assert_eq!(required_role("people.payroll.release"), Role::Admin);
        assert_eq!(required_role(""), Role::Admin);
    }

    #[test]
    fn only_the_employment_key_moves_employment() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        let change =
            Authorization::try_new("hr.dewi", actions::EMPLOYMENT_CHANGE, at, "mulai kerja")
                .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(change.authorizes_employment_change());
        assert!(!change.authorizes_profile_change());

        let read = Authorization::try_new("hr.dewi", actions::EMPLOYEE_READ, at, "melihat")
            .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(!read.authorizes_employment_change());
    }

    /// The reason is the caller's to state, and a blank one is not a reason.
    #[test]
    fn a_decision_without_a_reason_is_not_representable() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        assert!(Authorization::try_new("hr.dewi", actions::EMPLOYMENT_CHANGE, at, "   ").is_err());
        assert!(Authorization::try_new("", actions::EMPLOYMENT_CHANGE, at, "alasan").is_err());
    }
}
