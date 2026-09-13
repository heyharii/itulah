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
    /// File an attendance correction against somebody's day.
    ///
    /// The place manager's, bounded by their posting: the person who knows the
    /// reader was down on Tuesday is the one standing next to it. Deliberately
    /// separate from [`CORRECTION_DECIDE`] — a manager who could file *and*
    /// decide could rewrite a month of their own shop's attendance with nobody
    /// else's name on it.
    pub const CORRECTION_REQUEST: &str = "people.correction.request";
    /// Ask for a correction to your own day.
    ///
    /// The cashier rung, like asking for your own leave, and bounded by the
    /// record rather than the rung. It is the route by which a person whose
    /// finger would not read says so, which matters more here than anywhere
    /// else in this module: fingerprint is the only way in, so a reader that
    /// will not recognise somebody is the difference between a day worked and
    /// a day absent.
    pub const CORRECTION_REQUEST_OWN: &str = "people.correction.request_own";
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
    /// Register a punch station, suspend it, bring it back, or revoke it.
    ///
    /// Head office's. Registering a terminal **creates attendance authority
    /// where there was none** — a row in `attendance_terminal` set to ACTIVE is
    /// the only thing in the system that can produce a punch — so it is at
    /// least as consequential as withdrawing one, and it is not something a
    /// shop does for itself. A place that could register its own terminal could
    /// register a second one in the stockroom.
    pub const ATTENDANCE_TERMINAL_MANAGE: &str = "people.attendance_terminal.manage";
    /// Enrol somebody's fingerprint, replace it, or withdraw it.
    ///
    /// **HR's, even though the capture happens at the store.** The two are not
    /// in tension: the finger is on the reader at the shop, and the decision to
    /// bind a biometric to an employment record is head office's. Biometric
    /// data is *data pribadi spesifik* under UU 27/2022, and a grant that let
    /// every shop manager enrol would be a grant to collect regulated personal
    /// data with no HR officer in the loop.
    ///
    /// One key for enrolling, re-enrolling and withdrawing, because they are
    /// one decision about one person's biometrics. Erasing on termination needs
    /// no key at all and has no actor: it follows from employment ending rather
    /// than from anybody deciding, and migration `0233`'s trigger is what
    /// performs it.
    pub const FINGERPRINT_ENROL: &str = "people.fingerprint.enrol";
    /// Record an attendance punch.
    ///
    /// **Nobody holds this by rung, and that is the point.** A punch's
    /// authority is a *device*, not a person: the domain's `Punch::record`
    /// requires a `TerminalAttestation`, and `AttendanceTerminal::attest` is the
    /// only function that mints one. The route that carries punches into the
    /// cloud is authenticated by the node's own ingest key rather than by a
    /// browser session, so there is no session in the system that can reach it.
    ///
    /// The key exists so the act is named in the one space — the route
    /// catalogue and every refusal say `people.attendance_punch.record` rather
    /// than describing a hole — and [`super::audit::required_role`] maps it to
    /// ADMIN because the honest reading of "no rung grants this" is the highest
    /// rung, never the lowest.
    pub const ATTENDANCE_PUNCH_RECORD: &str = "people.attendance_punch.record";
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
    /// Read what people are paid — an agreement, a payslip, or a whole run's
    /// batch of them.
    ///
    /// **The place manager's, bounded by their reach.** Hari's decision, taken
    /// twice on 2026-09-13: the store submits its own payroll batch and *sees
    /// the figures*, its staff's base pay included. A signature on a batch
    /// somebody cannot see is not a signature, so the visibility is what makes
    /// the second one at head office worth having.
    ///
    /// **One read key for the agreement and for the run**, deliberately, where
    /// the rest of this module splits reads finely. The split is worth making
    /// where it bounds something: [`PROFILE_READ`] is separate from
    /// [`EMPLOYEE_READ`] because a rota needs a name and not a NIK. Here it
    /// would bound nothing — a run's slips carry each person's base pay and
    /// allowances copied out of their agreement, so a grant to read the batch
    /// *is* a grant to read the agreements, and two keys would only describe
    /// one permission twice.
    ///
    /// What it does **not** cover is [`PAY_CHANGE`]'s other half, the payroll
    /// identity: a bank account number and an NPWP are not figures, and the
    /// reason they sit in their own table is so that a read of one is not a
    /// read of the other. Those stay head office's.
    pub const PAY_READ: &str = "people.pay.read";
    /// Open a payroll run for a place and a month.
    ///
    /// **The place's**, for its own unit, once that unit's attendance period
    /// is closed. Head office no longer opens a shop's run: the people who
    /// know whether the month is right are the people who worked it.
    pub const PAYROLL_OPEN: &str = "people.payroll.open";
    /// Send the batch to head office — the first of the two signatures.
    ///
    /// Its own key rather than a mode of [`PAYROLL_OPEN`]: opening a run
    /// starts a working document and submitting one is a person standing
    /// behind its figures. A grant that could build a batch and not send it is
    /// a real position — it is the payroll clerk's — and one key covering both
    /// could not express it.
    pub const PAYROLL_SUBMIT: &str = "people.payroll.submit";
    /// Approve a submitted run. Head office's, and **final**: there is no
    /// state after it.
    ///
    /// Deliberately a separate key from [`PAYROLL_SUBMIT`] — the two-person
    /// rule is enforced on the *actor*, and a rule stated in one key could not
    /// be. They are no longer at the same rung either, which is the version of
    /// this control that means something: the place signs, and somebody who
    /// does not work there decides.
    pub const PAYROLL_APPROVE: &str = "people.payroll.approve";
    /// Hand an approved run to Finance, as one gross liability plus a
    /// per-employee breakdown.
    ///
    /// Head office's, and its own key because it is the act that turns an HR
    /// decision into money the company owes. Nothing statutory crosses with
    /// it: no PPh 21, no BPJS, because nothing here computes either and a
    /// figure this backend invented is a figure somebody would file with the
    /// tax office.
    pub const PAYROLL_HAND_TO_FINANCE: &str = "people.payroll.hand_to_finance";
    /// Record that Finance has paid a handed-over liability.
    ///
    /// **Finance's statement, not HR's**, and its own key for exactly that
    /// reason: a grant that could hand a liability over *and* declare it paid
    /// would be one person closing the loop on their own request. It lives in
    /// this key space because there is one key space — that is the whole
    /// argument of this module — and not because paying salaries is an HR act.
    pub const PAYROLL_SETTLE: &str = "people.payroll.settle";
    /// Reopen a run. The one that undoes work somebody has signed for, which
    /// is why it is its own key and not a mode of the others.
    ///
    /// Head office's, and it may undo an approval **after Finance has booked
    /// the handoff**. Hari accepted that consequence explicitly on
    /// 2026-09-13, so nothing refuses it; what the handoff keeps instead is a
    /// snapshot of what it handed over, so the booked figure does not move
    /// when the run does.
    pub const PAYROLL_REOPEN: &str = "people.payroll.reopen";

    // ── asking for somebody who is not employed yet ──────────────────────
    //
    // *Karyawan baru*: a shop proposes a candidate, head office decides. The
    // owner's decision of 2026-09-13, and the narrow form he approved after
    // rejecting a hiring menu on 2026-09-04. See `domain::hire`.

    /// Read hire proposals.
    ///
    /// The place manager's, bounded by their reach, so a shop reads its own
    /// requests and no other's. Its own key rather than [`EMPLOYEE_READ`]
    /// because a proposal is not an employee: it names somebody who may never
    /// work here, and it carries the base pay a shop is asking to offer — which
    /// is commercial information about the shop as much as about the person.
    ///
    /// Unlike the attendance policy and the holiday calendar, reading this
    /// needs a key. Those two are rules the people they govern are entitled to
    /// know; this is one person's terms before anybody has agreed to them.
    pub const HIRE_PROPOSAL_READ: &str = "people.hire_proposal.read";
    /// Propose a hire, and revise a proposal that was sent back.
    ///
    /// A place manager's act, bounded by `super::reach::Reach` to their own
    /// posting: the unit a proposal names is the unit the proposer is posted
    /// to, and a supervisor who could name another shop could staff it.
    ///
    /// One key for proposing and for revising, because a revision is the same
    /// act done again with better terms. Head office holds it too — HR may file
    /// a proposal for head office's own staff — which is exactly why the rule
    /// against deciding your own is on the actor and not on the rung.
    pub const HIRE_PROPOSAL_PROPOSE: &str = "people.hire_proposal.propose";
    /// Approve a proposal, send it back for revision, or reject it.
    ///
    /// Head office's, and **disjoint from [`HIRE_PROPOSAL_PROPOSE`]** — which
    /// is what lets `domain::hire` compare actors, in the way
    /// [`PAYROLL_APPROVE`] is disjoint from [`PAYROLL_SUBMIT`] so that the
    /// two-person rule has two names to compare. One key for all three
    /// outcomes, because they are one decision with three answers and each of
    /// them needs a reason; splitting them would be three places to forget to
    /// ask for one.
    pub const HIRE_PROPOSAL_DECIDE: &str = "people.hire_proposal.decide";

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
    /// The keys that may submit a payroll run.
    pub const PAYROLL_SUBMITTING: &[&str] = &[PAYROLL_SUBMIT];
    /// The keys that may approve one. **Disjoint from [`PAYROLL_SUBMITTING`]**,
    /// which is what lets the two-person rule compare actors at all.
    pub const PAYROLL_APPROVING: &[&str] = &[PAYROLL_APPROVE];
    /// The keys that may hand one to Finance.
    pub const PAYROLL_HANDING_OVER: &[&str] = &[PAYROLL_HAND_TO_FINANCE];
    /// The keys that may say a handed-over liability has been paid.
    /// **Disjoint from [`PAYROLL_HANDING_OVER`]**, which is what keeps the
    /// request and the answer two acts.
    pub const PAYROLL_SETTLING: &[&str] = &[PAYROLL_SETTLE];
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
    /// The keys that may register, suspend, reactivate or revoke a punch
    /// station.
    pub const TERMINAL_ADMINISTERING: &[&str] = &[ATTENDANCE_TERMINAL_MANAGE];
    /// The keys that may bind a fingerprint to an employment record, replace
    /// one, or withdraw one.
    pub const ENROLLING: &[&str] = &[FINGERPRINT_ENROL];
    /// The keys that may file an attendance correction — a manager on
    /// somebody's behalf, or a person about their own day.
    pub const CORRECTION_REQUESTING: &[&str] = &[CORRECTION_REQUEST, CORRECTION_REQUEST_OWN];
    /// The keys that may decide one. **Disjoint from
    /// [`CORRECTION_REQUESTING`]**, which is what stops the manager who filed
    /// a correction from approving it under the same grant.
    pub const CORRECTION_DECIDING: &[&str] = &[CORRECTION_DECIDE];
    /// The keys that may file a hire proposal, or revise one.
    pub const HIRE_PROPOSING: &[&str] = &[HIRE_PROPOSAL_PROPOSE];
    /// The keys that may decide one. **Disjoint from [`HIRE_PROPOSING`]** —
    /// that disjointness is what gives `domain::hire` two actors to compare,
    /// and the owner's rule of 2026-09-13 is stated on actors because head
    /// office is a place and not a pass.
    pub const HIRE_DECIDING: &[&str] = &[HIRE_PROPOSAL_DECIDE];
    /// The keys that may open an employment record against an approved
    /// proposal.
    ///
    /// **[`EMPLOYEE_CREATE`], and deliberately not a key of its own.** Creating
    /// a candidate from an approved proposal and creating one directly at head
    /// office are the same act with the same consequence — an employment record
    /// exists that did not before — and the owner asked for two ways in and one
    /// employee record out. A second key would describe one permission twice,
    /// and the first grant somebody was given without the other would be a
    /// grant to do half of it.
    pub const HIRE_EMPLOYING: &[&str] = &[EMPLOYEE_CREATE];
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
        | actions::LEAVE_REQUEST
        // Payroll, up to and including the signature the place puts on it.
        // Hari's decision of 2026-09-13 reversed the one recorded here on
        // 2026-09-04: a place manager's contribution is no longer "closing
        // their attendance period" but building the batch, reading its
        // figures, and submitting it. Approving, reopening and handing it to
        // Finance stay head office's, below.
        //
        // All four are bounded by `super::reach::Reach`. A shop that could
        // open, read and submit *another* shop's payroll would be a worse leak
        // than the one this bound was built to close.
        | actions::PAY_READ
        | actions::PAYROLL_OPEN
        | actions::PAYROLL_SUBMIT
        // Filing an attendance correction is the place's, bounded by their
        // posting: the person who knows the reader was down on Tuesday is
        // standing next to it. Its own key at the same rung as deciding one,
        // because the rule that matters is about *actors* and a rung cannot
        // express it — the manager who reports a failed read should not be the
        // only name on the record that it happened.
        | actions::CORRECTION_REQUEST
        // Asking for a new employee is the place's — the shop that is short a
        // cashier is the shop that knows — and reading the answer has to be
        // theirs too, or the request would vanish the moment it was filed.
        // Both bounded by `Reach` to the proposer's own posting. **Deciding is
        // not here**: it falls through to Admin below, which is the whole
        // shape of the feature.
        | actions::HIRE_PROPOSAL_READ
        | actions::HIRE_PROPOSAL_PROPOSE => Role::Supervisor,
        // Everybody signed in may ask for their own leave. The bound is the
        // record rather than the rung — the handler serves this key only for
        // the caller's own employment record — because a cashier who could not
        // ask for their own holiday would have to ask their manager to ask.
        // Answering an order about your own evening is yours, at any rung, and
        // the bound is the record rather than the ladder. A cashier who could
        // not answer would have to have their supervisor answer for them, which
        // is precisely the single-consent shape the two keys refuse.
        // Saying "the reader did not know me on Tuesday" about your own day is
        // the same shape, and matters more here than anywhere else in this
        // module: fingerprint is the only way in, so a finger the reader will
        // not take is the difference between a day worked and a day absent. A
        // person who could not report that would have to find their manager
        // before the month closed.
        actions::LEAVE_REQUEST_OWN
        | actions::OVERTIME_CONSENT_OWN
        | actions::CORRECTION_REQUEST_OWN => Role::Cashier,
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

    /// May this authority submit a payroll run?
    pub fn authorizes_payroll_submit(&self) -> bool {
        actions::PAYROLL_SUBMITTING.contains(&self.action_key.as_str())
    }

    /// May this authority approve one?
    ///
    /// Disjoint from submitting, and re-checked on decode: a stored run whose
    /// two signatures were made under one key is a control one person
    /// completed alone.
    pub fn authorizes_payroll_approve(&self) -> bool {
        actions::PAYROLL_APPROVING.contains(&self.action_key.as_str())
    }

    /// May this authority hand a run to Finance?
    ///
    /// Re-checked on decode like the rest: a handoff stored under a key that
    /// never permitted it must not become a booked liability by way of a row.
    pub fn authorizes_payroll_handover(&self) -> bool {
        actions::PAYROLL_HANDING_OVER.contains(&self.action_key.as_str())
    }

    /// May this authority say a handed-over liability has been paid?
    ///
    /// Disjoint from handing it over, and re-checked on decode: a settlement
    /// recorded under the key that requested the payment is the requester
    /// answering themselves.
    pub fn authorizes_payroll_settlement(&self) -> bool {
        actions::PAYROLL_SETTLING.contains(&self.action_key.as_str())
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

    /// May this authority register a punch station, or change its trust?
    ///
    /// Re-checked on decode, and it is the load-bearing one in the attendance
    /// half: a row in `attendance_terminal` set to ACTIVE is the only thing in
    /// the system that can produce a punch, so a stored terminal registered
    /// under a key that never permitted it must fail to hydrate rather than
    /// become an authority nobody granted.
    pub fn authorizes_terminal_administration(&self) -> bool {
        actions::TERMINAL_ADMINISTERING.contains(&self.action_key.as_str())
    }

    /// May this authority bind a fingerprint to an employment record?
    ///
    /// Re-checked on decode. A template whose enrolment nobody was allowed to
    /// perform is regulated personal data the company cannot account for
    /// holding, which is a worse position than not holding it.
    pub fn authorizes_enrolment(&self) -> bool {
        actions::ENROLLING.contains(&self.action_key.as_str())
    }

    /// May this authority file an attendance correction?
    pub fn authorizes_correction_request(&self) -> bool {
        actions::CORRECTION_REQUESTING.contains(&self.action_key.as_str())
    }

    /// May this authority decide one?
    ///
    /// The gate that keeps an approval from being recorded under the key
    /// somebody used to ask. A decided correction is what changes a derived
    /// outcome and therefore a payroll basis, so the check runs on the way in
    /// from storage as well: a rule only the live path enforces is a rule a
    /// round trip through the database removes.
    pub fn authorizes_correction_decision(&self) -> bool {
        actions::CORRECTION_DECIDING.contains(&self.action_key.as_str())
    }

    /// May this authority file a hire proposal, or revise one?
    pub fn authorizes_hire_proposal(&self) -> bool {
        actions::HIRE_PROPOSING.contains(&self.action_key.as_str())
    }

    /// May this authority decide one?
    ///
    /// The gate that keeps an approval from being recorded under the key
    /// somebody used to ask — which would be the shop granting its own request,
    /// wearing the shape of a decision. Re-checked on the way in from storage,
    /// because an approval is what lets an employment record be opened and a
    /// row edited into that shape would be a hire nobody authorised.
    pub fn authorizes_hire_decision(&self) -> bool {
        actions::HIRE_DECIDING.contains(&self.action_key.as_str())
    }

    /// May this authority open an employment record against an approved
    /// proposal?
    ///
    /// The same key that creates a candidate directly — see
    /// [`actions::HIRE_EMPLOYING`] for why it is not a key of its own.
    pub fn authorizes_hire_employment(&self) -> bool {
        actions::HIRE_EMPLOYING.contains(&self.action_key.as_str())
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

    /// Hari's decision of 2026-09-13, which reversed the one taken on the 4th:
    /// **the place asks for its own payroll and sees the figures**, and head
    /// office decides it. So opening, reading and submitting are the place
    /// manager's rung — bounded by their reach — and approving, reopening and
    /// handing the run to Finance stay head office's.
    #[test]
    fn the_place_asks_for_payroll_and_head_office_decides_it() {
        for key in [
            actions::PAY_READ,
            actions::PAYROLL_OPEN,
            actions::PAYROLL_SUBMIT,
        ] {
            assert_eq!(required_role(key), Role::Supervisor, "{key}");
        }
        for key in [
            actions::PAY_CHANGE,
            actions::PAYROLL_APPROVE,
            actions::PAYROLL_REOPEN,
            actions::PAYROLL_HAND_TO_FINANCE,
            actions::PAYROLL_SETTLE,
        ] {
            assert_eq!(required_role(key), Role::Admin, "{key}");
        }
        // Distinct keys, not one key used twice: the two-person rule compares
        // the actor who submitted with the actor who approved, and it could not
        // if the same grant covered both. They are not even at the same rung
        // any more, which is the version of this control that means something.
        assert_ne!(actions::PAYROLL_SUBMIT, actions::PAYROLL_APPROVE);
        assert_ne!(
            required_role(actions::PAYROLL_SUBMIT),
            required_role(actions::PAYROLL_APPROVE)
        );
    }

    /// Reading the figures is the place's; reading where the money is sent is
    /// not. A bank account number and an NPWP sit in their own table so that a
    /// read of one is not a read of the other, and the key follows the table.
    #[test]
    fn seeing_what_somebody_earns_is_not_seeing_their_bank_account() {
        assert_eq!(required_role(actions::PAY_READ), Role::Supervisor);
        assert_eq!(required_role(actions::PAY_CHANGE), Role::Admin);
        assert_ne!(actions::PAY_READ, actions::PAY_CHANGE);
    }

    /// The steps a run's history can hold, each under its own grant. A
    /// signature recorded under the key for a different step is the wrong
    /// person's signature wearing the right shape.
    #[test]
    fn each_step_of_a_run_needs_its_own_grant() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        let submit = Authorization::try_new("bu.rina", actions::PAYROLL_SUBMIT, at, "dikirim")
            .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(submit.authorizes_payroll_submit());
        assert!(!submit.authorizes_payroll_approve());
        assert!(!submit.authorizes_payroll_handover());

        let approve = Authorization::try_new("hr.dewi", actions::PAYROLL_APPROVE, at, "disetujui")
            .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(approve.authorizes_payroll_approve());
        assert!(!approve.authorizes_payroll_submit());
        // Approving is not handing it to Finance: one is an HR decision and
        // the other is money the company owes.
        assert!(!approve.authorizes_payroll_handover());

        let hand = Authorization::try_new(
            "hr.dewi",
            actions::PAYROLL_HAND_TO_FINANCE,
            at,
            "diserahkan ke keuangan",
        )
        .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(hand.authorizes_payroll_handover());
        assert!(!hand.authorizes_payroll_approve());
        // Asking Finance for the money is not Finance answering.
        assert!(!hand.authorizes_payroll_settlement());

        let settle =
            Authorization::try_new("fin.tono", actions::PAYROLL_SETTLE, at, "sudah dibayar")
                .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(settle.authorizes_payroll_settlement());
        assert!(!settle.authorizes_payroll_handover());
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

    /// *Karyawan baru*: the shop asks and head office answers. The owner's
    /// decision of 2026-09-13, stated here as the rungs it implies.
    #[test]
    fn a_shop_proposes_a_hire_and_head_office_decides_it() {
        for key in [
            actions::HIRE_PROPOSAL_READ,
            actions::HIRE_PROPOSAL_PROPOSE,
        ] {
            assert_eq!(required_role(key), Role::Supervisor, "{key}");
        }
        assert_eq!(required_role(actions::HIRE_PROPOSAL_DECIDE), Role::Admin);
    }

    /// The two key sets are disjoint, and that is what lets `domain::hire`
    /// compare actors: the owner's rule is that the proposer may not decide
    /// their own proposal, and a rung cannot say that because head office's own
    /// HR holds the deciding key and may also file a request.
    #[test]
    fn proposing_a_hire_and_deciding_one_are_never_the_same_grant() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        let propose = Authorization::try_new(
            "store07.manager",
            actions::HIRE_PROPOSAL_PROPOSE,
            at,
            "kasir resign",
        )
        .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(propose.authorizes_hire_proposal());
        assert!(!propose.authorizes_hire_decision());
        assert!(!propose.authorizes_hire_employment());

        let decide =
            Authorization::try_new("hr.dewi", actions::HIRE_PROPOSAL_DECIDE, at, "disetujui")
                .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(decide.authorizes_hire_decision());
        assert!(!decide.authorizes_hire_proposal());
        // And deciding is not creating: an approval permits an employment
        // record and does not open one.
        assert!(!decide.authorizes_hire_employment());
    }

    /// Two ways in, one employee record out. Opening an employment record from
    /// an approved proposal is the same act — and the same key — as head office
    /// creating a candidate directly.
    #[test]
    fn opening_employment_from_a_proposal_is_the_create_key_and_not_a_new_one() {
        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        let create = Authorization::try_new("hr.dewi", actions::EMPLOYEE_CREATE, at, "mulai")
            .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(create.authorizes_hire_employment());
        assert_eq!(actions::HIRE_EMPLOYING, &[actions::EMPLOYEE_CREATE]);
        assert_eq!(required_role(actions::EMPLOYEE_CREATE), Role::Admin);
    }
}
