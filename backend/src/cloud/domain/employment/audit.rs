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
    /// Ask HR to change your own phone, email or address (0816). Everybody's
    /// rung; the bound is the record — only `me` files — and the change is
    /// made by whoever approves it, under [`PROFILE_CHANGE`].
    pub const PROFILE_REQUEST_OWN: &str = "people.profile.request_own";
    /// Key in somebody's papers for head office to take (owner, 2026-10-25:
    /// "ngedit data bisa toko, approval HO"): a new employee's personal data
    /// and scans on their hire proposal, and a change to an existing
    /// employee's. The place manager's, bounded by `Reach`; the change is made
    /// by whoever approves it, under [`PROFILE_CHANGE`]. Reading the papers of
    /// one's own place rides on it too — a form that edits what it may not
    /// show is a form filled in blind.
    pub const PROFILE_PROPOSE: &str = "people.profile.propose";
    /// Fill, take off or reset an employee's benefit balance, and state the
    /// benefit's settings (0818). Head office's.
    pub const BENEFIT_MANAGE: &str = "people.benefit.manage";
    /// Ask for one's own code to show at the till (0818). Everybody's rung;
    /// the bound is the record — only `me`.
    pub const BENEFIT_CODE_OWN: &str = "people.benefit.code_own";
    /// Spend or give back a benefit at the till (0818): the cashier's rung,
    /// bounded by the code the employee shows.
    pub const BENEFIT_REDEEM: &str = "people.benefit.redeem";
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
    /// Filing an attendance correction against somebody's day.
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
    /// Put somebody in charge of a unit (its PIC), which ends the standing
    /// appointment.
    ///
    /// Head office's, and deliberately not in the place arm of
    /// `required_role`: the PIC gets the unit's reach and its approvals, so a
    /// store that could appoint its own would be granting itself authority.
    pub const UNIT_PIC_SET: &str = "people.unit_pic.set";
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
    /// Record your **own** arrival or departure, from the employee app.
    ///
    /// The cashier rung, like asking for your own leave and answering an
    /// overtime order about your own evening, and bounded by the *record*
    /// rather than by the rung: the handler serves this key only for the
    /// caller's own employment record, so a cashier who holds it cannot punch
    /// for a colleague.
    ///
    /// # Why this key exists at all, given the decision above it
    ///
    /// [`ATTENDANCE_PUNCH_RECORD`] is deliberately nobody's: a punch's
    /// authority is a *device*, and no session can reach the route that carries
    /// device punches. That is still true. This is a second source, asked for
    /// by the owner on 2026-09-13 because no reader has been bought yet and the
    /// HR month therefore has no input at all — the roster, the derivation, the
    /// corrections and the close cannot be walked end to end against nothing.
    ///
    /// It is a **separate key** rather than a rung on the first for the reason
    /// [`LEAVE_REQUEST_OWN`] is separate from [`LEAVE_REQUEST`]: "may record
    /// their own arrival" and "may record an arrival" are different grants, and
    /// one key covering both is how a self-service app becomes a way to clock a
    /// colleague in. Being separate is also what lets the owner retire this
    /// source later by refusing this key, while everything the device path does
    /// keeps working and every row already stored stays readable — the punch
    /// itself carries which source produced it (migration `0239`).
    pub const ATTENDANCE_PUNCH_RECORD_OWN: &str = "people.attendance_punch.record_own";
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

    // ── the component engine ─────────────────────────────────────────────
    //
    // What a payroll line IS, what it is WORTH, and the one-off figures a
    // place asks for. Three keys, because they are three decisions taken by
    // different people for different reasons. See `domain::component`.

    /// Define a payroll component, or retire one.
    ///
    /// Head office's. A structural decision — "there is a line called
    /// BPJS_KESEHATAN and it is a capped share of the statutory base" — which
    /// should never change again once taken, and which decides what the
    /// company's payslips can say at all.
    pub const PAY_COMPONENT_DEFINE: &str = "people.pay_component.define";
    /// Ratify what a component is worth.
    ///
    /// Head office's, and its own key rather than a mode of
    /// [`PAY_COMPONENT_DEFINE`] — the same split, for the same reason, as
    /// [`OVERTIME_POLICY_SET`] against [`OVERTIME_ORDER`]. Inventing a line
    /// item and stating its percentage are different acts: the first says what
    /// a payslip may contain, the second decides what comes out of everybody's
    /// wages at once, and a deployment that wants the second held by fewer
    /// hands than the first cannot say so with one key.
    ///
    /// **Nothing is seeded under it.** No BPJS rate and no overtime multiplier
    /// exists in this repository; until somebody exercises this key a slip
    /// refuses to report a deduction total, naming the component.
    pub const PAY_COMPONENT_RATIFY: &str = "people.pay_component.ratify";
    /// File a one-off figure for one person in one month — an incentive, a
    /// *kasbon* instalment, a bonus — or withdraw one not yet submitted.
    ///
    /// **The place's**, bounded by `super::reach::Reach` to their own posting.
    /// This is the key that makes the owner's decision of 2026-09-13 mean
    /// something: the place submits the whole batch and sees the figures, and
    /// without a way to add a figure it could only resend numbers head office
    /// had already fixed.
    ///
    /// Filing and withdrawing are **one** key rather than two, unlike
    /// [`PAYROLL_SUBMIT`] and [`PAYROLL_REOPEN`]. Those are two because a
    /// reopen undoes work somebody has signed for; nothing here is signed —
    /// an adjustment is writable only while its batch is still a draft — and a
    /// grant that could add a figure but not take it back would be a grant to
    /// make a mistake permanent.
    ///
    /// There is no separate key for *deciding* one, and that is the design:
    /// the adjustment rides its batch, so the decision on it is head office's
    /// [`PAYROLL_APPROVE`] on the run carrying it. See
    /// `domain::component::adjustment` for why a second chain was rejected.
    pub const PAYROLL_ADJUSTMENT_FILE: &str = "people.payroll_adjustment.file";

    // ── asking for money back ────────────────────────────────────────────
    //
    // Expense claims: somebody lists what they spent, a second person
    // sanctions each line, and the sanction posts. The keys below are the
    // same three acts the leave module splits — ask, decide, and the one that
    // moves money — plus the catalogue, and they are disjoint for the same
    // reason. See `domain::claim`.

    /// Define the claim type catalogue, or retire an entry.
    ///
    /// Head office's. A catalogue decision, exactly the shape of
    /// [`LEAVE_TYPE_SET`]: the codes the whole company files claims under are
    /// one vocabulary, and a shop with its own idea of what a TRAVEL claim is
    /// would make every total incomparable with the shop beside it.
    pub const CLAIM_TYPE_SET: &str = "people.claim_type.set";
    /// File an expense claim on somebody else's behalf.
    ///
    /// A place manager's, bounded by `super::reach::Reach`: not every member
    /// of staff carries a phone, and the manager who signed the receipts is
    /// the person who can turn them into a claim. Deliberately separate from
    /// [`CLAIM_DECIDE`] — the two-actor rule lives on the actors, and a rule
    /// stated in one key could not compare them.
    pub const CLAIM_FILE: &str = "people.claim.file";
    /// File your own expense claim.
    ///
    /// The cashier rung, like [`LEAVE_REQUEST_OWN`], and bounded by the
    /// record rather than the rung: it reaches the caller's own claim and no
    /// colleague's. Separate from [`CLAIM_FILE`] for the same reason every
    /// `*_own` key here is separate — "may file their own" and "may file on
    /// anyone's behalf" are different grants, and one key covering both is
    /// how a self-service form becomes a way to file claims against a
    /// colleague.
    pub const CLAIM_REQUEST_OWN: &str = "people.claim.request_own";
    /// Sanction a submitted claim, line by line.
    ///
    /// Bounded by reach, and the domain refuses the filer deciding their own
    /// claim — the same comparison [`PAYROLL_APPROVE`] is kept disjoint from
    /// [`PAYROLL_SUBMIT`] for. One key for approve, reject and send-back,
    /// because they are one decision with three answers and each of them
    /// needs a reason.
    pub const CLAIM_DECIDE: &str = "people.claim.decide";
    /// Pay an approved claim out of the place's petty cash.
    ///
    /// Bounded by reach — a shop's imprest is the shop's — and head office
    /// holds it unbounded, as everywhere: paying is where the module touches
    /// the till, and the person who sanctions a claim is not thereby the
    /// person who opens the cash box, but both are supervisor acts in the
    /// same place.
    pub const CLAIM_PAY: &str = "people.claim.pay";

    // ── how it ends ──────────────────────────────────────────────────────
    //
    // The confidential channel, the interview at the door, and the statement
    // that closes a person's books. See `domain::grievance` and
    // `domain::exit`.

    /// Define the grievance kind catalogue, or retire an entry.
    ///
    /// Head office's, exactly the shape of [`CLAIM_TYPE_SET`] and
    /// [`LEAVE_TYPE_SET`]: the vocabulary the whole company complains under
    /// is one company's, not thirteen shops' worth of dialects.
    pub const GRIEVANCE_TYPE_SET: &str = "people.grievance_type.set";
    /// File a grievance on somebody else's behalf.
    ///
    /// A place manager's, bounded by `super::reach::Reach` — the manager who
    /// signed the complaint their warehouse hand could not type. Deliberately
    /// separate from [`GRIEVANCE_REQUEST_OWN`] for the reason every
    /// `*_own`/`*` pair here is separate, and with one consequence the claims
    /// pair does not have: the person the grievance is ABOUT may be the
    /// manager holding this key, which is exactly the filing that must carry
    /// a name and a bound rather than arriving as an anonymous queue entry.
    pub const GRIEVANCE_FILE: &str = "people.grievance.file";
    /// File your own grievance.
    ///
    /// The cashier rung — the essential key of the whole channel. A grievance
    /// about your own supervisor that has to be handed to your supervisor is
    /// not a confidential channel, so the bound is the filing rather than the
    /// rung: it reaches complaints the caller themselves filed, and no
    /// colleague's.
    pub const GRIEVANCE_REQUEST_OWN: &str = "people.grievance.request_own";
    /// Investigate a grievance.
    ///
    /// ADMIN, head office — the queue is nobody's posting but HO's, and a
    /// grievance against a store manager cannot be investigated by that store
    /// manager. **Disjoint from [`GRIEVANCE_DECIDE`]**: investigating and
    /// resolving are two signatures, the payroll lesson. One grant holding
    /// both is a deployment's choice; the keys being distinct is what makes
    /// the choice expressible at all.
    pub const GRIEVANCE_INVESTIGATE: &str = "people.grievance.investigate";
    /// Resolve a grievance — upheld, or refused as invalid.
    ///
    /// ADMIN, and disjoint from [`GRIEVANCE_INVESTIGATE`] for the reason
    /// above. The domain refuses either act by the person who filed, so the
    /// channel never closes its own complaint.
    pub const GRIEVANCE_DECIDE: &str = "people.grievance.decide";
    /// Read the grievance queue.
    ///
    /// **Mapped ADMIN and deliberately its own key rather than a mode of
    /// [`EMPLOYEE_READ`]** — a key finer than the ladder can express, which
    /// is what the one key space is for. The accused supervisor holds
    /// [`EMPLOYEE_READ`] because a rota needs names; if that read also opened
    /// the queue, the channel would read as a list of who complained about
    /// whom, and it would stop being a channel the day somebody worked that
    /// out.
    pub const GRIEVANCE_READ: &str = "people.grievance.read";
    /// Complete the interview at the door, or cancel it as never held.
    ///
    /// ADMIN, head office's: the interview is created by the machine when
    /// employment ends, and answering it is the employer's act. The store is
    /// a party to the exit — it does not hold the pen.
    pub const EXIT_INTERVIEW_FILE: &str = "people.exit_interview.file";
    /// Create, settle or cancel a Full & Final statement.
    ///
    /// ADMIN, and the whole statement is head office's: it settles across
    /// places — advances taken at one shop, claims sanctioned at another,
    /// one journal at head office — so a place-scoped grant could not hold
    /// it without the settlement crossing a bound the grant cannot name.
    pub const FNF_SETTLE: &str = "people.fnf.settle";

    // ── the next generation ──────────────────────────────────────────────
    //
    // The keys the 0359 workloads join the space with. Every supervisor-rung
    // key here is bounded by `Reach` like its siblings above; every decide
    // key falls through to Admin below, because deciding is the employer's.

    /// Ask to swap one of your roster days with a colleague's.
    ///
    /// The cashier rung, bounded to the caller's own record: the person whose
    /// day moves is the person who asks.
    pub const ROSTER_SWAP_REQUEST_OWN: &str = "people.roster_swap.request_own";
    /// Decide a colleague's swap request — approve it and the roster moves
    /// both days, refuse it and the request stays as evidence.
    ///
    /// The place manager's, bounded by reach. The requester may not decide
    /// their own; that rule is on the domain type.
    pub const ROSTER_SWAP_DECIDE: &str = "people.roster_swap.decide";
    /// File a change proposal — promotion, transfer, salary, separation —
    /// against one of your people.
    ///
    /// The place manager's, bounded by reach. Deciding falls through to
    /// Admin below, which is the whole shape: the shop asks, head office
    /// answers, and the answer is what writes the kernels.
    pub const CHANGE_PROPOSAL_FILE: &str = "people.change_proposal.file";
    /// Decide a change proposal. Admin. The domain refuses the filer.
    pub const CHANGE_PROPOSAL_DECIDE: &str = "people.change_proposal.decide";
    /// Close a checklist task the store or head office owns.
    ///
    /// The place manager's, bounded by reach: the person standing in the shop
    /// hands over the uniform and marks it handed over.
    pub const LIFECYCLE_COMPLETE: &str = "people.lifecycle.complete";
    /// Close one of **your own** checklist tasks, from the phone.
    ///
    /// The cashier rung, bounded to the caller's own record, for the reason
    /// [`LEAVE_REQUEST_OWN`] is separate from [`LEAVE_REQUEST`].
    pub const LIFECYCLE_COMPLETE_OWN: &str = "people.lifecycle.complete_own";
    /// Close a checklist task IT owns — an account provisioned, a login
    /// switched off.
    ///
    /// Admin, deliberately: a store cannot mark somebody else's account
    /// provisioned, any more than it could provision it.
    pub const LIFECYCLE_COMPLETE_IT: &str = "people.lifecycle.complete_it";
    /// Open a checklist — onboarding or separation — for one person, by
    /// hand. Admin: the machine opens these on the hire and on an applied
    /// separation, and the by-hand door is head office's backfill, not the
    /// shop's.
    pub const LIFECYCLE_MANAGE: &str = "people.lifecycle.manage";
    /// Schedule and record an interview. The place manager's, bounded by
    /// reach: they are the one who conducts it.
    pub const RECRUITMENT_INTERVIEW: &str = "people.recruitment.interview";
    /// Work the pipeline head office holds — funnel stages, offers, hires,
    /// and the staffing plan the requisitions are measured against. Admin.
    pub const RECRUITMENT_MANAGE: &str = "people.recruitment.manage";
    /// Record one person's monthly performance figure. The place manager's,
    /// bounded by reach; it is their judgement the figure records.
    pub const PERFORMANCE_RECORD: &str = "people.performance.record";
    /// Define which figures a position is measured on. Admin.
    pub const PERFORMANCE_TEMPLATE_SET: &str = "people.performance_template.set";
    /// Nominate one of your people for a training program. The place
    /// manager's, bounded by reach.
    pub const TRAINING_NOMINATE: &str = "people.training.nominate";
    /// Record whether one of your nominated people attended. The place
    /// manager's, bounded by reach, with a reason kept for every correction.
    pub const TRAINING_ATTENDANCE: &str = "people.training.attendance";
    /// Define training programs and close them. Admin.
    pub const TRAINING_MANAGE: &str = "people.training.manage";
    /// Record a benefit handed over — uniform sets. The place manager's,
    /// bounded by reach.
    pub const BENEFIT_RECORD: &str = "people.benefit.record";
    /// Change a rule number in `hr_policy`. Admin, and the change records
    /// who and why.
    pub const POLICY_SET: &str = "people.policy.set";
    /// Read the clock's run ledger: which HR period was worked, when, and
    /// what it wrote. Admin, because it names the whole estate's mornings.
    pub const HR_SCHEDULER_READ: &str = "people.scheduler.read";
    /// Ask the clock to run its HR pass now. Admin, and the request records
    /// a reason; the jobs themselves carry their own authority on every row
    /// they write.
    pub const HR_SCHEDULER_RUN: &str = "people.scheduler.run";

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
    // ── the books ────────────────────────────────────────────────────────
    //
    // Finance keys live in this module for the reason the header gives: one key
    // space, one `required_role`, one answer to "may they". They are named
    // finer than the three-rung ladder can currently express — `finance.post`
    // and `finance.approve` map to the same rung today and always will while
    // the ladder has three rungs — because the distinction is the control, and
    // a control that is not named cannot later be granted separately.
    //
    // Before these existed, `required_role` for a path answered `Supervisor`
    // for everything under `/api/v1/finance/`, and no handler asked a second
    // question. A shift supervisor could seal a month, type a journal entry
    // from nothing, and dispose of a building.

    /// Read the operational money screens: what is owed, what is owing, what
    /// the cash and bank positions are, what assets exist.
    ///
    /// The supervisor rung, and the only finance key that is not head office's.
    /// A place manager who cannot see what their shop owes is a place manager
    /// who has to ask head office what their shop owes.
    pub const FINANCE_READ: &str = "finance.read";
    /// Read the books themselves: the chart of accounts, the journal, a trial
    /// balance, a statement, an account's ledger.
    ///
    /// Separate from [`FINANCE_READ`] and deliberately higher. "What does this
    /// shop owe" and "what has the company earned and what does it own" are
    /// different questions with different audiences, and one grant answering
    /// both is how an operations screen becomes the company's P&L.
    pub const FINANCE_LEDGER_READ: &str = "finance.ledger.read";
    /// Record a bill, a payment or an asset — in draft, touching no account.
    ///
    /// Its own key rather than a mode of [`FINANCE_POST`]: writing down what a
    /// supplier sent is clerical, and putting it into the books is not.
    pub const FINANCE_DOCUMENT_RECORD: &str = "finance.document.record";
    /// Put a recorded document into the books.
    pub const FINANCE_POST: &str = "finance.post";
    /// Agree a correction somebody else drafted.
    ///
    /// **Disjoint from [`FINANCE_POST`]**, which is what lets the two-person
    /// rule compare actors at all — the same argument as
    /// [`PAYROLL_APPROVE`] against [`PAYROLL_VERIFY`]. The rule itself is
    /// enforced on the actor and by a CHECK on the row; the key is what makes
    /// it expressible.
    pub const FINANCE_APPROVE: &str = "finance.approve";
    /// Type a journal entry from nothing.
    ///
    /// Its own key because it is the only write in the system with no document
    /// behind it. Everything else in finance is a consequence of something that
    /// happened; this is somebody's opinion, entered directly.
    pub const FINANCE_JOURNAL_MANUAL: &str = "finance.journal.manual";
    /// Reverse a posted entry, or a posted correction.
    pub const FINANCE_REVERSE: &str = "finance.reverse";
    /// Decide which account a meaning resolves to.
    ///
    /// The map is upstream of every posting rule in the system, so changing it
    /// changes what tomorrow's postings mean without touching a single line of
    /// posting code. That is why it is not [`FINANCE_POST`].
    pub const FINANCE_MAP_SET: &str = "finance.map.set";
    /// Match a bank line, unmatch one, or import a statement.
    pub const FINANCE_BANK_RECONCILE: &str = "finance.bank.reconcile";
    /// Register, assess, dispose of or move a fixed asset, and run a month's
    /// depreciation.
    pub const FINANCE_ASSET_MANAGE: &str = "finance.asset.manage";
    /// Open an accounting month.
    pub const FINANCE_PERIOD_OPEN: &str = "finance.period.open";
    /// Seal one, once its checklist permits.
    pub const FINANCE_PERIOD_CLOSE: &str = "finance.period.close";
    /// Unseal one. **Disjoint from [`FINANCE_PERIOD_CLOSE`]** for the same
    /// reason [`ATTENDANCE_PERIOD_REOPEN`] is disjoint from
    /// [`ATTENDANCE_PERIOD_CLOSE`]: whoever can undo their own close has not
    /// closed anything. It is the key that lets somebody write into a month
    /// that has already been reported, so it is the one key in finance that
    /// exists mainly to be withheld.
    pub const FINANCE_PERIOD_REOPEN: &str = "finance.period.reopen";
    /// Import a cutover: the opening trial balance, the opening stock and its
    /// costs, and the open items carried over from the client's old system.
    ///
    /// Its own key rather than a mode of [`FINANCE_JOURNAL_MANUAL`], and it is
    /// the one this file would most like to see withheld from everybody until
    /// the day it is used. A cutover is the only act in the system that writes
    /// the beginning of every balance at once, and the FIFO queue in particular
    /// is priced exactly once — after the first sale on the first morning there
    /// is no second chance at it, because the layers are already being consumed.
    /// It is also, unusually, an act with no document of ours behind it: what
    /// it asserts happened, happened in somebody else's software.
    pub const FINANCE_OPENING_IMPORT: &str = "finance.opening.import";

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
    /// The keys that may define or retire a payroll component.
    pub const PAY_COMPONENT_DEFINING: &[&str] = &[PAY_COMPONENT_DEFINE];
    /// The keys that may state what one is worth. **Disjoint from
    /// [`PAY_COMPONENT_DEFINING`]**, so a deployment can hold the rate in
    /// fewer hands than the vocabulary.
    pub const PAY_COMPONENT_RATIFYING: &[&str] = &[PAY_COMPONENT_RATIFY];
    /// The keys that may file or withdraw a one-off adjustment. **Disjoint
    /// from [`PAYROLL_APPROVING`]**, which is what decides it: the place asks
    /// and head office answers, and one grant doing both would be a place
    /// paying itself a bonus.
    pub const PAYROLL_ADJUSTMENT_FILING: &[&str] = &[PAYROLL_ADJUSTMENT_FILE];
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
    /// The keys under which somebody may record their **own** punch.
    ///
    /// **Deliberately does not contain [`ATTENDANCE_PUNCH_RECORD`]**, and the
    /// disjointness is the whole rule. That key is the device's act, and a
    /// device holds no session; this one is a person's act about themselves. A
    /// slice holding both would make a supervisor's grant over a shop's
    /// attendance into a grant to clock its staff in from a phone, which is
    /// the shape `domain::attendance::terminal` exists to refuse.
    pub const OWN_PUNCH_RECORDING: &[&str] = &[ATTENDANCE_PUNCH_RECORD_OWN];
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
    /// The keys that may file a claim — a manager on somebody's behalf, or a
    /// person about their own spending. Deliberately excludes
    /// [`CLAIM_DECIDE`]: asking to be paid back is not sanctioning it.
    pub const CLAIM_REQUESTING: &[&str] = &[CLAIM_FILE, CLAIM_REQUEST_OWN];
    /// The keys that may sanction one. **Disjoint from
    /// [`CLAIM_REQUESTING`]**, which is the shape of the two-actor rule: the
    /// domain compares the actor under this key with the actor under the
    /// filing key, and one grant holding both could compare nothing.
    pub const CLAIM_DECIDING: &[&str] = &[CLAIM_DECIDE];
    /// The keys that may pay one out. Its own rather than a mode of
    /// [`CLAIM_DECIDE`] for the reason [`PAYROLL_SETTLE`] is its own: saying
    /// money is owed and opening the cash box are two acts, and a grant that
    /// could do both would be one person closing their own loop.
    pub const CLAIM_PAYING: &[&str] = &[CLAIM_PAY];
    /// The keys that may define or retire a claim type.
    pub const CLAIM_TYPE_SETTING: &[&str] = &[CLAIM_TYPE_SET];

    /// The keys that may file a grievance — a manager on somebody's behalf,
    /// or a person about their own treatment. Deliberately excludes
    /// [`GRIEVANCE_INVESTIGATE`] and [`GRIEVANCE_DECIDE`]: complaining is not
    /// investigating, and the disjointness is the channel.
    pub const GRIEVANCE_FILING: &[&str] = &[GRIEVANCE_FILE, GRIEVANCE_REQUEST_OWN];
    /// The keys that may investigate one. Its own slice so the decode gate
    /// and the resolution gate can never blur into one signature.
    pub const GRIEVANCE_INVESTIGATING: &[&str] = &[GRIEVANCE_INVESTIGATE];
    /// The keys that may resolve one. **Deliberately disjoint from
    /// [`GRIEVANCE_INVESTIGATING`]** — two signatures, the payroll lesson.
    pub const GRIEVANCE_RESOLVING: &[&str] = &[GRIEVANCE_DECIDE];
    /// The keys that may complete or cancel an exit interview.
    pub const EXIT_INTERVIEW_FILING: &[&str] = &[EXIT_INTERVIEW_FILE];
    /// The keys that may create, settle or cancel a Full & Final statement.
    pub const FNF_SETTLING: &[&str] = &[FNF_SETTLE];

    /// The keys that may put something into the books.
    pub const FINANCE_POSTING: &[&str] = &[FINANCE_POST, FINANCE_JOURNAL_MANUAL];
    /// The keys that may agree what somebody else drafted. **Disjoint from
    /// [`FINANCE_POSTING`]**: that disjointness is what the maker-checker rule
    /// on a correction document is made of.
    pub const FINANCE_APPROVING: &[&str] = &[FINANCE_APPROVE];
    /// The keys that may seal an accounting month.
    pub const FINANCE_PERIOD_SEALING: &[&str] = &[FINANCE_PERIOD_CLOSE];
    /// The keys that may unseal one. **Disjoint from
    /// [`FINANCE_PERIOD_SEALING`]**.
    pub const FINANCE_PERIOD_UNSEALING: &[&str] = &[FINANCE_PERIOD_REOPEN];
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
        | actions::HIRE_PROPOSAL_PROPOSE
        // Keying in a person's papers — the new hire's on their proposal, an
        // existing employee's as a change — is the place's too (2026-10-25),
        // bounded by `Reach`. Taking the change is `PROFILE_CHANGE`, which
        // falls through to Admin below.
        | actions::PROFILE_PROPOSE
        // Filing a one-off figure — an incentive, a *kasbon* instalment — is
        // the place's, bounded by `Reach` to its own posting. It is the other
        // half of the owner's decision of 2026-09-13: a place that submits a
        // batch and cannot add a figure to it can only resend numbers head
        // office already fixed.
        //
        // **Defining a component and ratifying its rate are NOT here.** They
        // fall through to Admin below, which is the shape of the feature: the
        // place asks for one figure for one person for one month, and head
        // office decides both what a payslip may say and what it costs.
        | actions::PAYROLL_ADJUSTMENT_FILE
        // Expense claims, up to and including the money: a place manager
        // files a claim on their staff's behalf, sanctions what a different
        // filer submitted, and pays an approved one out of the shop's own
        // imprest — each bounded by `Reach`, the same bound that decides
        // whose leave is theirs to grant. The catalogue behind them
        // (`CLAIM_TYPE_SET`) falls through to Admin below, exactly as the
        // leave kinds and the shift patterns do: the vocabulary is one
        // company's, not thirteen shops' worth of dialects.
        | actions::CLAIM_FILE
        | actions::CLAIM_DECIDE
        | actions::CLAIM_PAY
        // A grievance filed on a colleague's behalf is the place manager's,
        // bounded by `Reach` like every other place-scoped write. Filing is
        // deliberately the ONLY grievance key at this rung: investigating and
        // resolving fall through to Admin below, because the queue is head
        // office's — in a thirteen-store estate, head office is the only
        // place that is nobody's posting, and a channel a store manager could
        // investigate would not survive its first complaint about a store
        // manager.
        | actions::GRIEVANCE_FILE
        // The next generation's place half, bounded by `Reach` like the rest
        // of this arm. Deciding a swap or a change proposal is deliberately
        // NOT here — those fall through to Admin, the same shape as the hire
        // proposal above: the shop asks, head office answers. Interviewing
        // is here because the manager is the one who conducts it; recording
        // a performance figure and nominating for training are here for the
        // same reason, and closing a checklist task the store owns is here
        // because the person standing in the shop is the one who hands the
        // uniform over.
        | actions::ROSTER_SWAP_DECIDE
        | actions::CHANGE_PROPOSAL_FILE
        | actions::LIFECYCLE_COMPLETE
        | actions::RECRUITMENT_INTERVIEW
        | actions::PERFORMANCE_RECORD
        | actions::TRAINING_NOMINATE
        | actions::TRAINING_ATTENDANCE
        | actions::BENEFIT_RECORD => Role::Supervisor,
        // The only finance key below head office. Everything else under
        // `finance.` falls through to Admin with the rest of the rules the
        // places are measured against — including, deliberately, reading the
        // journal and the trial balance.
        | actions::FINANCE_READ => Role::Supervisor,
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
        // Recording your own arrival is the same shape again, and it is the
        // one the owner asked for on 2026-09-13 so the HR month has any input
        // at all before a reader exists. The rung is everybody's because
        // everybody clocks in; the bound is the record, applied by the handler,
        // so this grant reaches the caller's own day and no colleague's.
        //
        // Asking for your own money back is the same shape one more time:
        // everybody spends, so the rung is everybody's, and the bound is the
        // claim the caller filed — the handler serves this key only for a
        // claim whose filer is the caller — so it reaches their own
        // reimbursement and no colleague's.
        //
        // Complaining about your own treatment is the same shape carrying the
        // highest stakes it has had: the bound is the filing the caller
        // themselves made, and the point of the key is that a grievance about
        // your own supervisor does not have to be handed to your supervisor.
        actions::LEAVE_REQUEST_OWN
        | actions::OVERTIME_CONSENT_OWN
        | actions::CORRECTION_REQUEST_OWN
        | actions::ATTENDANCE_PUNCH_RECORD_OWN
        | actions::CLAIM_REQUEST_OWN
        | actions::GRIEVANCE_REQUEST_OWN
        // The next generation's own-record keys, the same shape one more
        // time: swapping one of your own roster days, and closing one of
        // your own checklist tasks from the phone. The rung is everybody's;
        // the bound is the record, applied by the handler.
        | actions::ROSTER_SWAP_REQUEST_OWN
        | actions::LIFECYCLE_COMPLETE_OWN
        | actions::PROFILE_REQUEST_OWN
        | actions::BENEFIT_CODE_OWN
        | actions::BENEFIT_REDEEM => Role::Cashier,
        // Everything else falls through to Admin — including the six keys the
        // exit lane added: `GRIEVANCE_TYPE_SET`, `GRIEVANCE_INVESTIGATE`,
        // `GRIEVANCE_DECIDE`, `GRIEVANCE_READ`, `EXIT_INTERVIEW_FILE` and
        // `FNF_SETTLE`. That fall-through is the shape, not an oversight: the
        // grievance queue is head office's because head office is nobody's
        // posting, the exit interview is the employer's answer and not the
        // shop's, and the Full & Final statement settles across places.
        // Reading the queue is deliberately its own key (`GRIEVANCE_READ`)
        // rather than a consequence of `EMPLOYEE_READ`, so the supervisor who
        // reads a rota still does not read who complained about whom.
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

    /// May this authority define or retire a payroll component?
    ///
    /// Re-checked on decode like every gate above: a component stored under a
    /// key that never permitted it must not become a line on everybody's
    /// payslip by way of a row.
    pub fn authorizes_pay_component_define(&self) -> bool {
        actions::PAY_COMPONENT_DEFINING.contains(&self.action_key.as_str())
    }

    /// May this authority state what a component is worth?
    ///
    /// The gate that keeps a rate from being recorded under the key somebody
    /// used to invent the line item — which is the version of this control
    /// that means something, because the figure is what comes out of wages.
    pub fn authorizes_pay_component_ratify(&self) -> bool {
        actions::PAY_COMPONENT_RATIFYING.contains(&self.action_key.as_str())
    }

    /// May this authority file a one-off adjustment?
    pub fn authorizes_payroll_adjustment(&self) -> bool {
        actions::PAYROLL_ADJUSTMENT_FILING.contains(&self.action_key.as_str())
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

    /// May this authority record a punch about the holder's own day?
    ///
    /// The gate on the second punch source. A punch taken by a station needs
    /// no authority at all — it needs a
    /// [`TerminalAttestation`](crate::cloud::domain::TerminalAttestation),
    /// which only a registered active device produces — so this is not a
    /// loosening of that rule but the separate, narrower door beside it: the
    /// only way to obtain a
    /// [`SelfPunchClaim`](crate::cloud::domain::SelfPunchClaim) is an
    /// authorization that answers `true` here.
    pub fn authorizes_own_punch(&self) -> bool {
        actions::OWN_PUNCH_RECORDING.contains(&self.action_key.as_str())
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

    /// May this authority file an expense claim?
    pub fn authorizes_claim_filing(&self) -> bool {
        actions::CLAIM_REQUESTING.contains(&self.action_key.as_str())
    }

    /// May this authority sanction one?
    ///
    /// The gate that keeps an approval from being recorded under the key
    /// somebody used to file — which is the employee paying themselves,
    /// wearing the shape of a decision. Re-checked on the way in from
    /// storage, because a decision is what puts money in the books and a row
    /// edited into that shape would be a posting nobody authorised.
    pub fn authorizes_claim_decision(&self) -> bool {
        actions::CLAIM_DECIDING.contains(&self.action_key.as_str())
    }

    /// May this authority pay an approved claim out of petty cash?
    pub fn authorizes_claim_payout(&self) -> bool {
        actions::CLAIM_PAYING.contains(&self.action_key.as_str())
    }

    /// May this authority define or retire a claim type?
    pub fn authorizes_claim_type_definition(&self) -> bool {
        actions::CLAIM_TYPE_SETTING.contains(&self.action_key.as_str())
    }

    /// May this authority file a grievance?
    pub fn authorizes_grievance_filing(&self) -> bool {
        actions::GRIEVANCE_FILING.contains(&self.action_key.as_str())
    }

    /// May this authority investigate one?
    ///
    /// Re-checked on the way in from storage: a stored investigation whose
    /// key never permitted investigating is an inquiry nobody authorised,
    /// and it must fail to load rather than become the record of what the
    /// company knew.
    pub fn authorizes_grievance_investigation(&self) -> bool {
        actions::GRIEVANCE_INVESTIGATING.contains(&self.action_key.as_str())
    }

    /// May this authority resolve one?
    ///
    /// **Deliberately not [`authorizes_grievance_investigation`]** — the two
    /// keys are distinct so that the two signatures can be held by two
    /// people, and a stored resolution recorded under the investigating key
    /// is one person closing their own inquiry.
    pub fn authorizes_grievance_resolution(&self) -> bool {
        actions::GRIEVANCE_RESOLVING.contains(&self.action_key.as_str())
    }

    /// May this authority complete or cancel an exit interview?
    pub fn authorizes_exit_interview(&self) -> bool {
        actions::EXIT_INTERVIEW_FILING.contains(&self.action_key.as_str())
    }

    /// May this authority create, settle or cancel a Full & Final statement?
    pub fn authorizes_fnf_settlement(&self) -> bool {
        actions::FNF_SETTLING.contains(&self.action_key.as_str())
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

    /// The component engine's three keys. The place asks for one figure for one
    /// person for one month; head office decides both what a payslip may say
    /// and what it costs.
    #[test]
    fn a_place_asks_for_a_figure_and_head_office_decides_what_a_payslip_may_say() {
        assert_eq!(
            required_role(actions::PAYROLL_ADJUSTMENT_FILE),
            Role::Supervisor
        );
        for key in [actions::PAY_COMPONENT_DEFINE, actions::PAY_COMPONENT_RATIFY] {
            assert_eq!(required_role(key), Role::Admin, "{key}");
        }

        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        let define = Authorization::try_new(
            "hr.dewi",
            actions::PAY_COMPONENT_DEFINE,
            at,
            "komponen BPJS",
        )
        .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(define.authorizes_pay_component_define());
        // Inventing the line item is not stating what it costs. The same
        // disjointness `OVERTIME_POLICY_SET` has from `OVERTIME_ORDER`.
        assert!(!define.authorizes_pay_component_ratify());
        assert!(!define.authorizes_payroll_adjustment());

        let ratify =
            Authorization::try_new("hr.budi", actions::PAY_COMPONENT_RATIFY, at, "1% upah")
                .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(ratify.authorizes_pay_component_ratify());
        assert!(!ratify.authorizes_pay_component_define());

        let file = Authorization::try_new(
            "bu.rina",
            actions::PAYROLL_ADJUSTMENT_FILE,
            at,
            "insentif lembur toko",
        )
        .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(file.authorizes_payroll_adjustment());
        // The place asks; it does not decide. A grant that could do both would
        // be a place paying itself a bonus.
        assert!(!file.authorizes_payroll_approve());
        assert!(!file.authorizes_pay_component_ratify());
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

    /// Every finance key is head office's except the one a place manager needs.
    ///
    /// The line is drawn at "what does my shop owe" against "what has the
    /// company earned". Reading the journal and the trial balance is on the
    /// far side of it deliberately: `auth::required_role` answers Supervisor
    /// for every GET under `/api/v1/finance/`, and this is the gate that says
    /// the trial balance is not one of the things that buys you.
    #[test]
    fn finance_is_head_office_except_the_shop_floor_read() {
        assert_eq!(required_role(actions::FINANCE_READ), Role::Supervisor);
        for key in [
            actions::FINANCE_LEDGER_READ,
            actions::FINANCE_DOCUMENT_RECORD,
            actions::FINANCE_POST,
            actions::FINANCE_APPROVE,
            actions::FINANCE_JOURNAL_MANUAL,
            actions::FINANCE_REVERSE,
            actions::FINANCE_MAP_SET,
            actions::FINANCE_BANK_RECONCILE,
            actions::FINANCE_ASSET_MANAGE,
            actions::FINANCE_PERIOD_OPEN,
            actions::FINANCE_PERIOD_CLOSE,
            actions::FINANCE_PERIOD_REOPEN,
        ] {
            assert_eq!(required_role(key), Role::Admin, "{key}");
        }
    }

    /// The three pairs whose whole purpose is that they are two keys.
    ///
    /// Each of these could be collapsed into one grant, and each collapse would
    /// delete a control: a maker who is also the checker, or a closer who can
    /// reopen what they closed.
    #[test]
    fn the_finance_controls_are_pairs_of_distinct_keys() {
        assert_ne!(actions::FINANCE_POST, actions::FINANCE_APPROVE);
        assert_ne!(actions::FINANCE_DOCUMENT_RECORD, actions::FINANCE_POST);
        assert_ne!(
            actions::FINANCE_PERIOD_CLOSE,
            actions::FINANCE_PERIOD_REOPEN
        );
        for approving in actions::FINANCE_APPROVING {
            assert!(
                !actions::FINANCE_POSTING.contains(approving),
                "{approving} may not also be a posting key"
            );
        }
        for unsealing in actions::FINANCE_PERIOD_UNSEALING {
            assert!(
                !actions::FINANCE_PERIOD_SEALING.contains(unsealing),
                "{unsealing} may not also seal"
            );
        }
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

    /// The second punch source, as rungs and as grants.
    ///
    /// Everybody clocks themselves in, so the rung is the lowest; nobody clocks
    /// anybody else in from a browser, so the device key stays at the highest.
    /// The two keys are disjoint, which is what lets the app's claim and the
    /// station's attestation stay two different kinds of evidence rather than
    /// one grant wearing two names.
    #[test]
    fn recording_your_own_punch_is_not_the_same_grant_as_recording_a_punch() {
        assert_eq!(
            required_role(actions::ATTENDANCE_PUNCH_RECORD_OWN),
            Role::Cashier
        );
        assert_eq!(
            required_role(actions::ATTENDANCE_PUNCH_RECORD),
            Role::Admin,
            "a punch's authority is a device; the honest rung for `nobody by \
             rung` is the highest one"
        );
        assert_ne!(
            actions::ATTENDANCE_PUNCH_RECORD,
            actions::ATTENDANCE_PUNCH_RECORD_OWN
        );

        let at = DateTime::from_timestamp(1_780_000_000, 0).unwrap_or_else(|| panic!("instant"));
        let own = Authorization::try_new(
            "store07.kasir",
            actions::ATTENDANCE_PUNCH_RECORD_OWN,
            at,
            "masuk kerja",
        )
        .unwrap_or_else(|error| panic!("authorization: {error}"));
        assert!(own.authorizes_own_punch());

        // The device key does NOT open the self-service door, and neither does
        // anything a supervisor holds over a shop's attendance.
        for key in [
            actions::ATTENDANCE_PUNCH_RECORD,
            actions::CORRECTION_REQUEST,
            actions::CORRECTION_REQUEST_OWN,
            actions::ROSTER_MANAGE,
        ] {
            let other = Authorization::try_new("hr.dewi", key, at, "alasan")
                .unwrap_or_else(|error| panic!("authorization: {error}"));
            assert!(
                !other.authorizes_own_punch(),
                "{key} must not mint a self-service punch"
            );
        }
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
        for key in [actions::HIRE_PROPOSAL_READ, actions::HIRE_PROPOSAL_PROPOSE] {
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
