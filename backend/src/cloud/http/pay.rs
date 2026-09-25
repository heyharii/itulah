//! What somebody is paid, who they are to payroll, and the run that pays them.
//!
//! # The place asks; head office decides
//!
//! Hari's decisions of 2026-09-13, and the reason they are stated here rather
//! than inferred from the rungs. The formulation this module was built to had
//! payroll head office's from end to end — *"a place manager's whole
//! contribution is closing their attendance period"*. It is now the other way
//! round for the first half:
//!
//! 1. The place **opens** the run for its own unit, once that unit's
//!    attendance period is closed.
//! 2. The place **submits** the whole batch, and **sees the figures** —
//!    including its staff's base pay. That visibility was argued against twice
//!    and reaffirmed twice; it is implemented fully rather than softened,
//!    because a signature on a batch somebody cannot see is not a signature.
//! 3. Head office **approves**, and approval is final. There is no seal.
//! 4. Head office **reopens**, which clears the approval — and may do so after
//!    Finance has booked it, which the owner accepted explicitly.
//! 5. Head office **hands** the approved run to Finance, gross only.
//!
//! # Two people sign a run, in the shape the work actually has
//!
//! Submit and approve are separate keys at **different rungs** now, which is
//! what lets the domain compare *actors* and also what makes the comparison
//! mean something: the two signatures are no longer both head office's. The
//! refusal is a conflict rather than a bad request — the payload is fine and
//! what is wrong is who is sending it.
//!
//! # A rung is half of "may they"; the other half is the place
//!
//! Every store manager holds Supervisor, so the rung cannot tell store-07's
//! manager from store-03's. Every Supervisor-rung route here is bounded by
//! [`Reach`], resolved from the caller's own open posting — including the
//! *reads*. A store that could read another store's pay would be the leak the
//! reach bound was built to close, wearing a payroll screen.
//!
//! # Seeing what somebody earns is not seeing their bank account
//!
//! `people.pay.read` reaches the agreement, the payslip and the run. It does
//! **not** reach `payroll-identity`: a bank account number and an NPWP are not
//! figures, and the reason they live in their own table is so that a read of
//! one is not a read of the other. Those stay `people.pay.change`, at head
//! office. The slips still carry the account **masked**, which is what the
//! masking is for.
//!
//! # Nothing statutory is computed
//!
//! Not here, not in the domain, not in the schema, and not in the handoff to
//! Finance. A slip carries the agreement in force and the facts this system
//! recorded; the columns for computed deductions do not exist, so nothing can
//! quietly acquire a zero that reads as "nothing was owed".

use super::auth::Principal;
use super::employment::{current_place, reach_of, resolve, Access};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AllowanceCode, AttendanceMonth,
        Authorization, BankAccount, FixedAllowance, IdentityChange, PayRecord, PayrollHandover,
        PayrollIdentity, PayrollRun, PlaceId, PtkpStatus, Reach, RecordKind,
    },
    http::audit::DeclaredSubject,
    postgres::{self as infrastructure, HandoverStanding, PayrollSlipRow, RunReconciliation},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;
use serde::{Deserialize, Serialize};

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

/// Is the place one this caller may act in?
///
/// The second half of "may they". Admin's reach is everywhere so nothing head
/// office does changes; a Supervisor reaches their own posting and nothing
/// else, and a login with no posting behind it reaches nothing — which is the
/// honest reading of "we do not know where this person works".
fn reaches(principal: &Principal, reach: &Reach, place_id: &str) -> Result<(), AppError> {
    if reach.covers(Some(place_id)) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} is not posted anywhere that reaches {place_id}",
        principal.username
    )))
}

/// Where the subject of a read is posted, checked against the caller's reach.
///
/// Called after the record is loaded, because the place is a fact about the
/// record. Self-reads bypass it: somebody is entitled to know what they agreed
/// to, and a new joiner whose posting HR has not filed yet would otherwise be
/// refused their own payslip.
async fn subject_is_reachable(state: &AppState, access: &Access) -> Result<(), AppError> {
    if access.own {
        return Ok(());
    }
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_place(&record))
}

// ── views ────────────────────────────────────────────────────────────────

/// One standing allowance, both ways.
///
/// The same shape read and written, deliberately: a form that sent a different
/// shape than the one it displays is a form somebody has to translate in their
/// head, and the translation is where a code gets mistyped.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AllowanceView {
    pub code: String,
    pub minor: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayRecordView {
    pub effective_from: NaiveDate,
    pub base_minor: i64,
    pub fixed_allowances: Vec<AllowanceView>,
    /// Base plus fixed allowances — a fact about the agreement, and the figure
    /// statutory rules are computed *against*. Nothing here applies one.
    pub statutory_base_minor: i64,
    pub agreed_by: String,
    pub agreed_at: DateTime<Utc>,
    pub reason: String,
}

fn record_view(record: &PayRecord) -> PayRecordView {
    PayRecordView {
        effective_from: record.effective_from(),
        base_minor: record.base().minor,
        fixed_allowances: record
            .allowances()
            .map(|(code, amount)| AllowanceView {
                code: code.to_string(),
                minor: amount.minor,
            })
            .collect(),
        statutory_base_minor: record.statutory_base().minor,
        agreed_by: record.authorization().actor().to_string(),
        agreed_at: record.authorization().at(),
        reason: record.authorization().reason().to_string(),
    }
}

/// Who somebody is to payroll.
///
/// The account number is **masked**, always, on every route. The screen that
/// exists to check an account is right needs four digits; a payment file needs
/// the number, and a payment file is not a screen.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayrollIdentityView {
    pub bank_name: Option<String>,
    pub bank_account_masked: Option<String>,
    pub bank_holder: Option<String>,
    pub npwp: Option<String>,
    /// `TK/0` … `K/3`. Recorded because a payslip has to say which applied;
    /// the bracket it selects is not computed anywhere here.
    pub ptkp: Option<String>,
    pub bpjs_kesehatan: Option<String>,
    pub bpjs_ketenagakerjaan: Option<String>,
    /// Whether this person can be paid at all.
    pub payable: bool,
    pub amendments: Vec<IdentityAmendmentView>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct IdentityAmendmentView {
    pub field: String,
    pub effective_from: NaiveDate,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

fn identity_view(identity: &PayrollIdentity) -> PayrollIdentityView {
    PayrollIdentityView {
        bank_name: identity.bank_account().map(|a| a.bank().to_owned()),
        bank_account_masked: identity.bank_account().map(BankAccount::masked),
        bank_holder: identity.bank_account().map(|a| a.holder().to_owned()),
        npwp: identity.npwp().map(ToOwned::to_owned),
        ptkp: identity.ptkp().map(|ptkp| ptkp.to_string()),
        bpjs_kesehatan: identity.bpjs_kesehatan().map(ToOwned::to_owned),
        bpjs_ketenagakerjaan: identity.bpjs_ketenagakerjaan().map(ToOwned::to_owned),
        payable: identity.payable(),
        amendments: identity
            .amendments()
            .iter()
            .map(|amendment| IdentityAmendmentView {
                field: amendment.change().field().to_owned(),
                effective_from: amendment.effective_from(),
                actor: amendment.authorization().actor().to_string(),
                at: amendment.authorization().at(),
                reason: amendment.authorization().reason().to_string(),
            })
            .collect(),
    }
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RunEventView {
    /// `SUBMITTED`, `APPROVED` or `REOPENED`.
    pub step: String,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayrollRunView {
    pub id: String,
    pub place_id: String,
    /// `YYYY-MM`.
    pub period: String,
    /// `DRAFT`, `SUBMITTED` or `APPROVED`. Approved is final — there is no
    /// state after it, and the only way back is a reopen.
    pub state: String,
    /// False while anything about the month is unknowable. Read it before
    /// reading the figures.
    pub complete: bool,
    /// The sentence the screen shows when `complete` is false.
    pub incomplete_because: Option<String>,
    /// The place's signature, as the run currently stands. `null` after a
    /// reopen, because the next approval is a fresh pair of signatures.
    ///
    /// Was `verified_by` until 2026-09-13. The act it named moved from head
    /// office to the place, and a field that kept the old word would describe a
    /// step nobody performs.
    pub submitted_by: Option<String>,
    /// Head office's signature, as the run currently stands. `null` after a
    /// reopen: an approval that has been undone is not an approval.
    pub approved_by: Option<String>,
    /// Where this run stands with Finance, or `null` if it has not been handed
    /// over. **No breakdown** — that has its own route; this says which months
    /// have crossed and which of those have been paid.
    pub handover: Option<HandoverStanding>,
    pub history: Vec<RunEventView>,
}

fn run_view(run: &PayrollRun, handover: Option<HandoverStanding>) -> PayrollRunView {
    PayrollRunView {
        id: run.id().to_owned(),
        place_id: run.place().to_string(),
        period: run.period().to_owned(),
        state: run.state().code().to_owned(),
        complete: run.complete(),
        incomplete_because: run.incomplete_because().map(ToOwned::to_owned),
        submitted_by: run.submitter().map(ToString::to_string),
        approved_by: run.approver().map(ToString::to_string),
        handover,
        history: run
            .history()
            .iter()
            .map(|event| RunEventView {
                step: event.step().code().to_owned(),
                actor: event.authorization().actor().to_string(),
                at: event.authorization().at(),
                reason: event.authorization().reason().to_string(),
            })
            .collect(),
    }
}

/// One gross liability with Finance, breakdown and all.
///
/// Its own route rather than a field on the run, so that a list of runs does
/// not pay for every employee line in every month — and so that nothing ever
/// serves an empty `lines` beside a real figure, which would read as "nobody
/// is in it".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayrollHandoverView {
    pub run_id: String,
    pub place_id: String,
    /// `YYYY-MM`.
    pub period: String,
    /// `RECEIVED` or `PAID`.
    pub state: String,
    /// Base plus standing allowances, summed. Nothing statutory is netted off
    /// and no overtime is valued — there is no rate for it anywhere.
    pub gross_minor: i64,
    pub handed_over_by: String,
    pub handed_over_at: DateTime<Utc>,
    pub handed_over_reason: String,
    pub settled_by: Option<String>,
    pub settled_at: Option<DateTime<Utc>>,
    pub settled_reason: Option<String>,
    /// The breakdown, as it stood when it crossed. A snapshot: a reopened run
    /// whose slips are rebuilt does not change what Finance was handed.
    pub lines: Vec<PayrollHandoverLineView>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayrollHandoverLineView {
    pub employee_id: String,
    pub gross_minor: i64,
}

fn handover_view(handover: &PayrollHandover) -> PayrollHandoverView {
    PayrollHandoverView {
        run_id: handover.run_id().to_owned(),
        place_id: handover.place().to_string(),
        period: handover.period().to_owned(),
        state: handover.state().code().to_owned(),
        gross_minor: handover.gross_minor(),
        handed_over_by: handover.handed_over().actor().to_string(),
        handed_over_at: handover.handed_over().at(),
        handed_over_reason: handover.handed_over().reason().to_string(),
        settled_by: handover.settled().map(|a| a.actor().to_string()),
        settled_at: handover.settled().map(Authorization::at),
        settled_reason: handover.settled().map(|a| a.reason().to_string()),
        lines: handover
            .lines()
            .iter()
            .map(|line| PayrollHandoverLineView {
                employee_id: line.employee_id().to_owned(),
                gross_minor: line.gross_minor(),
            })
            .collect(),
    }
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgreePayBody {
    pub effective_from: NaiveDate,
    pub base_minor: i64,
    #[serde(default)]
    pub fixed_allowances: Vec<AllowanceView>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdentityBody {
    /// Exactly one of these per request. Two at once would be two changes
    /// recorded as one, and the trail would say less than it appears to.
    pub field: String,
    #[serde(default)]
    pub bank_name: Option<String>,
    #[serde(default)]
    pub bank_account: Option<String>,
    #[serde(default)]
    pub bank_holder: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    pub effective_from: NaiveDate,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenRunBody {
    pub place_id: String,
    /// `YYYY-MM`.
    pub period: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepBody {
    pub reason: String,
    /// Settling a head-office payroll: which bank paid it (`bank_giro` or
    /// `bank_savings`) and which bank (`BCA` …). Ignored by every other step
    /// and by a store's payroll, which is paid out of its petty cash.
    #[serde(default)]
    pub bank_key: Option<String>,
    #[serde(default)]
    pub bank_qualifier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunQuery {
    #[serde(default)]
    pub place: Option<String>,
}

// ── the pay agreement ────────────────────────────────────────────────────

/// One person's pay, over time.
///
/// **Readable by the place they are posted to**, since 2026-09-13. It had been
/// head office's alone, on the argument that a supervisor who could read the
/// team's salaries knows what everybody earns and that is not a rota question.
/// The owner took the other side twice: a store that submits its own payroll
/// batch has to be able to check it, and a batch checked blind is not checked.
///
/// So the key is `people.pay.read` at the supervisor rung, and the bound that
/// replaces the one being given up is [`Reach`] — store-07's manager reads
/// store-07's agreements and no other shop's. Writing stays head office's.
///
/// Reading your own is not a privilege either way: somebody is entitled to
/// know what they agreed to.
pub async fn read_pay(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<PayRecordView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::PAY_READ)?;
    subject_is_reachable(&state, &access).await?;
    let timeline = infrastructure::pay_timeline(&state.db, &access.employee_id).await?;
    Ok(Json(timeline.records().iter().map(record_view).collect()))
}

/// File a new agreement.
pub async fn agree_pay(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<AgreePayBody>,
) -> Result<Json<Vec<PayRecordView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PAY_CHANGE)?;

    let allowances = body
        .fixed_allowances
        .iter()
        .map(|line| {
            FixedAllowance::try_new(
                AllowanceCode::try_new(&line.code).map_err(infrastructure::pay_error)?,
                Money::new(line.minor),
            )
            .map_err(infrastructure::pay_error)
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let record = PayRecord::try_new(
        body.effective_from,
        Money::new(body.base_minor),
        allowances,
        access.authorize(actions::PAY_CHANGE, &body.reason)?,
    )
    .map_err(infrastructure::pay_error)?;

    // The timeline's forward rule fires here, on the whole history, rather than
    // on the row about to be written.
    let mut timeline = infrastructure::pay_timeline(&state.db, &access.employee_id).await?;
    timeline
        .append(record.clone())
        .map_err(infrastructure::pay_error)?;
    infrastructure::agree_pay(&state.db, &access.employee_id, &record).await?;
    Ok(Json(timeline.records().iter().map(record_view).collect()))
}

// ── payroll identity ─────────────────────────────────────────────────────

/// Who somebody is to payroll.
///
/// **Head office's, deliberately unchanged** by the 2026-09-13 widening of pay
/// reads. What the owner opened up was the *figures* — what a person earns,
/// which a store submitting a batch must be able to check. A bank account
/// number and an NPWP are not figures, and the reason they sit in their own
/// table is precisely so that a read of one is not a read of the other. A
/// store checking its batch needs the last four digits, and gets them, masked,
/// on the slip.
pub async fn read_identity(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<PayrollIdentityView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::PAY_CHANGE)?;
    let identity = infrastructure::payroll_identity(&state.db, &access.employee_id)
        .await?
        .unwrap_or_else(PayrollIdentity::empty);
    Ok(Json(identity_view(&identity)))
}

pub async fn amend_identity(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<IdentityBody>,
) -> Result<Json<PayrollIdentityView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PAY_CHANGE)?;

    let required = |what: &str| -> Result<&str, AppError> {
        body.value
            .as_deref()
            .ok_or_else(|| AppError::Validation(format!("{what} needs a value")))
    };
    let change = match body.field.as_str() {
        "bank_account" => IdentityChange::BankAccount {
            account: BankAccount::try_new(
                body.bank_name.as_deref().unwrap_or_default(),
                body.bank_account.as_deref().unwrap_or_default(),
                body.bank_holder.as_deref().unwrap_or_default(),
            )
            .map_err(infrastructure::pay_error)?,
        },
        "npwp" => IdentityChange::Npwp {
            npwp: required("npwp")?.to_owned(),
        },
        "ptkp" => IdentityChange::Ptkp {
            ptkp: PtkpStatus::parse(required("ptkp")?).map_err(infrastructure::pay_error)?,
        },
        "bpjs_kesehatan" => IdentityChange::BpjsKesehatan {
            number: required("bpjs_kesehatan")?.to_owned(),
        },
        "bpjs_ketenagakerjaan" => IdentityChange::BpjsKetenagakerjaan {
            number: required("bpjs_ketenagakerjaan")?.to_owned(),
        },
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an amendable field: expected bank_account, npwp, ptkp, \
                 bpjs_kesehatan or bpjs_ketenagakerjaan"
            )));
        }
    };

    let mut identity = infrastructure::payroll_identity(&state.db, &access.employee_id)
        .await?
        .unwrap_or_else(PayrollIdentity::empty);
    identity
        .amend(
            change,
            body.effective_from,
            access.authorize(actions::PAY_CHANGE, &body.reason)?,
        )
        .map_err(infrastructure::pay_error)?;
    infrastructure::save_payroll_identity(&state.db, &access.employee_id, &identity).await?;
    Ok(Json(identity_view(&identity)))
}

// ── payslips ─────────────────────────────────────────────────────────────

/// One person's own payslips.
///
/// Its own route, and not `/pay`: that one serves the effective-dated
/// *agreement*, which is what somebody is on, and this serves what they were
/// actually paid in a month. The employee app asked for the second at the first
/// one's path, and this is the resolution.
///
/// Only runs somebody has signed for appear. A draft is a working figure, and
/// showing it to the person it is about invites them to plan around a number
/// that is still moving.
pub async fn payslips(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<PayrollSlipRow>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::PAY_READ)?;
    subject_is_reachable(&state, &access).await?;
    Ok(Json(
        infrastructure::slips_of(&state.db, &access.employee_id).await?,
    ))
}

// ── payroll runs ─────────────────────────────────────────────────────────

/// The runs a caller may see, and where each stands with Finance.
///
/// Bounded by the caller's reach, not by the query string. A store manager who
/// asked for every place got every place before this: `place = None` read the
/// whole company, which was right while head office was the only caller and is
/// a leak the moment a shop can open a run. `Reach::Nowhere` reads **nothing**
/// rather than everything — the distinction `Reach` is an enum for.
pub async fn list_runs(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<RunQuery>,
) -> Result<Json<Vec<PayrollRunView>>, AppError> {
    require(&principal, actions::PAY_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Ok(Json(Vec::new()));
    }
    // An explicit place must be one they reach; otherwise the bound *is* the
    // filter, and an unbounded caller reads every place.
    let place = match query.place.as_deref() {
        Some(asked) => {
            reaches(&principal, &reach, asked)?;
            Some(asked.to_owned())
        }
        None => reach.sole_place().map(ToString::to_string),
    };

    let runs = infrastructure::list_runs(&state.db, place.as_deref()).await?;
    let mut standings = infrastructure::handover_standings(&state.db, place.as_deref()).await?;
    Ok(Json(
        runs.iter()
            .map(|run| {
                let at = standings
                    .iter()
                    .position(|standing| standing.run_id == run.id())
                    .map(|at| standings.swap_remove(at));
                run_view(run, at)
            })
            .collect(),
    ))
}

/// Open a run for a place and a month.
///
/// **The place's act**, for its own unit, since 2026-09-13. Head office no
/// longer opens a shop's run: the people who know whether a month is right are
/// the people who worked it.
///
/// It still refuses a month whose attendance is not closed. The period is the
/// payroll gate: while it is open the facts are still moving, and a run built
/// over moving facts is a run that disagrees with itself an hour later. That
/// gate is unchanged, and it is now the same place's own signature on both
/// sides of it.
pub async fn open_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(body): Json<OpenRunBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    require(&principal, actions::PAYROLL_OPEN)?;
    let reach = reach_of(&state, &principal).await?;
    reaches(&principal, &reach, &body.place_id)?;

    let place = PlaceId::try_new(&body.place_id).map_err(invalid)?;
    let month = AttendanceMonth::parse(&body.period).map_err(infrastructure::attendance_error)?;
    let first = infrastructure::month_first_day(month)?;

    let period = infrastructure::period_for(&state.db, &place, first).await?;
    if !period.is_closed() {
        return Err(AppError::Conflict(format!(
            "attendance for {} in {} is not closed, so its facts are still moving",
            body.place_id, body.period
        )));
    }

    // Always, today. When a punch source arrives this becomes conditional; the
    // sentence is written where a person reads it rather than left implicit in
    // a false zero.
    let incomplete = Some(
        "no punch source is connected, so this run knows what was planned and what was \
         decided — never what was worked"
            .to_owned(),
    );
    let run = PayrollRun::draft(
        format!("PR-{}-{}", body.period, body.place_id),
        place,
        &body.period,
        incomplete,
    )
    .map_err(infrastructure::pay_error)?;

    infrastructure::open_run(&state.db, &run, first).await?;
    acted_on.set(RecordKind::PayrollRun, run.id().to_string());
    read_back(&state, run.id()).await
}

async fn read_back(state: &AppState, id: &str) -> Result<Json<PayrollRunView>, AppError> {
    let run = infrastructure::load_run(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll run {id}")))?;
    let standing = infrastructure::handover_standing(&state.db, id).await?;
    Ok(Json(run_view(&run, standing)))
}

/// A run the caller may act on, loaded and reach-checked.
///
/// The reach check is on the **run's** place rather than on anything the caller
/// sent, because the place is a fact about the run. Admin reaches everywhere so
/// approve and reopen pass it for free; it is the place's own steps the bound
/// is for.
async fn reachable_run(
    state: &AppState,
    principal: &Principal,
    id: &str,
) -> Result<PayrollRun, AppError> {
    let run = infrastructure::load_run(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll run {id}")))?;
    let reach = reach_of(state, principal).await?;
    reaches(principal, &reach, run.place().as_str())?;
    Ok(run)
}

/// How a step is written. Submitting only moves the state; an approval
/// settles the advances the batch's adjustments repay, and a reopen takes
/// those settlements back — each in the same transaction as the state itself,
/// so a step and what it makes cannot be split by a crash.
enum StepSave {
    State,
    Approval,
    Reopen,
}

async fn step(
    state: &AppState,
    principal: &Principal,
    id: &str,
    action_key: &str,
    reason: &str,
    apply: impl FnOnce(&mut PayrollRun, Authorization) -> Result<(), crate::cloud::domain::PayError>,
    save: StepSave,
) -> Result<Json<PayrollRunView>, AppError> {
    require(principal, action_key)?;
    let mut run = reachable_run(state, principal, id).await?;
    let authorization = Authorization::try_new(&principal.username, action_key, Utc::now(), reason)
        .map_err(invalid)?;
    apply(&mut run, authorization).map_err(infrastructure::pay_error)?;
    match save {
        StepSave::State => infrastructure::save_run(&state.db, &run).await?,
        StepSave::Approval => {
            infrastructure::save_approval(&state.db, &run, &principal.username).await?
        }
        StepSave::Reopen => infrastructure::save_reopen(&state.db, &run).await?,
    }
    read_back(state, id).await
}

/// Send the batch to head office — the place's signature.
///
/// The route `verify` used to be. The act is not a rename: verifying was head
/// office checking figures it would then approve, and submitting is the place
/// standing behind figures somebody else will decide. The old route is gone
/// rather than aliased, because a caller still posting to `/verify` is a caller
/// whose screen has not been updated and should hear so.
pub async fn submit_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    step(
        &state,
        &principal,
        &id,
        actions::PAYROLL_SUBMIT,
        &body.reason,
        PayrollRun::submit,
        StepSave::State,
    )
    .await
}

/// Approve a submitted run. Head office's, and final.
pub async fn approve_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    // The two blockers reconciliation can prove before anybody signs: somebody
    // on the run has no account to be paid into, or their deductions came to
    // more than the month earned. Approving either sends Finance a payment file
    // that cannot be paid. The softer findings — an unratified component, a
    // line that counted nothing — stay visible on the screen and on the slip
    // rather than becoming an approval nobody can complete.
    let run = reachable_run(&state, &principal, &id).await?;
    let month = AttendanceMonth::parse(run.period())
        .map_err(infrastructure::attendance_error)?;
    let first_day = infrastructure::month_first_day(month)?;
    let reconciliation = infrastructure::reconcile(&state.db, &run, first_day).await?;
    if reconciliation.unpayable > 0 {
        return Err(AppError::Conflict(format!(
            "{} on this run have no account to be paid into; a payment file would fail for everybody in it",
            reconciliation.unpayable
        )));
    }
    if reconciliation.slips_with_negative_net > 0 {
        return Err(AppError::Conflict(format!(
            "{} slip(s) on this run have deductions above the month's earnings; fix the figure before approving",
            reconciliation.slips_with_negative_net
        )));
    }
    step(
        &state,
        &principal,
        &id,
        actions::PAYROLL_APPROVE,
        &body.reason,
        PayrollRun::approve,
        StepSave::Approval,
    )
    .await
}

/// Send a run back to draft. Head office's.
///
/// **No guard asks Finance first.** The owner accepted explicitly that this can
/// happen after the handoff has been booked, and the honest design is to let it
/// and record it: a company that needs to correct a paid month needs to correct
/// it, and a refusal here would only push the correction somewhere nothing is
/// written down. What Finance was handed is a snapshot and does not move; the
/// reopen goes into the run's history with its actor and its reason, where an
/// audit finds it.
pub async fn reopen_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    step(
        &state,
        &principal,
        &id,
        actions::PAYROLL_REOPEN,
        &body.reason,
        PayrollRun::reopen,
        StepSave::Reopen,
    )
    .await
}

/// Every line on the run — the batch the place is submitting, and sees.
pub async fn run_slips(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<Vec<PayrollSlipRow>>, AppError> {
    require(&principal, actions::PAY_READ)?;
    reachable_run(&state, &principal, &id).await?;
    Ok(Json(infrastructure::run_slips(&state.db, &id).await?))
}

pub async fn run_reconciliation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<RunReconciliation>, AppError> {
    require(&principal, actions::PAY_READ)?;
    let run = reachable_run(&state, &principal, &id).await?;
    let month = AttendanceMonth::parse(run.period()).map_err(infrastructure::attendance_error)?;
    let first = infrastructure::month_first_day(month)?;
    Ok(Json(
        infrastructure::reconcile(&state.db, &run, first).await?,
    ))
}

// ── the handover to Finance ──────────────────────────────────────────────

/// Hand an approved run to Finance: one gross liability, one breakdown.
///
/// Head office's, and **idempotent per (place, period)**: the row is keyed by
/// the run and unique on (place, period), so a second send inserts nothing and
/// is told the liability is already with Finance. Sending twice cannot double
/// what the company owes.
///
/// The figures come off the run's own slips rather than from the request body.
/// A caller supplying its own gross would be a caller deciding what the company
/// owes, which is the whole thing the two signatures above exist to settle.
///
/// The signed handover posts the accrual journal automatically. Finance still
/// records settlement when the money has actually been paid.
pub async fn hand_over_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollHandoverView>, AppError> {
    require(&principal, actions::PAYROLL_HAND_TO_FINANCE)?;
    let run = infrastructure::load_run(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll run {id}")))?;

    let lines = infrastructure::handover_lines_of(&state.db, &id).await?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::PAYROLL_HAND_TO_FINANCE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    let handover = PayrollHandover::hand_over(&run, lines, authorization)
        .map_err(infrastructure::pay_error)?;

    infrastructure::hand_over(&state.db, &handover).await?;
    read_handover_back(&state, &id).await
}

/// Where a run stands with Finance — the status HR reads back.
///
/// Reach-bounded, so the store that submitted the batch can see whether its
/// staff have been paid. That is the point of a status crossing back rather
/// than a write-only handoff.
pub async fn read_handover(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<PayrollHandoverView>, AppError> {
    require(&principal, actions::PAY_READ)?;
    reachable_run(&state, &principal, &id).await?;
    read_handover_back(&state, &id).await
}

/// Finance says the money has gone out.
///
/// Its own key — `people.payroll.settle` — because it is Finance's statement
/// and not HR's: a grant that could hand a liability over *and* declare it paid
/// would be one person closing the loop on their own request.
pub async fn settle_handover(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollHandoverView>, AppError> {
    require(&principal, actions::PAYROLL_SETTLE)?;
    let mut handover = infrastructure::load_handover(&state.db, &id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("payroll run {id} has not been handed to Finance"))
        })?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::PAYROLL_SETTLE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    handover
        .settle(authorization)
        .map_err(infrastructure::pay_error)?;
    let paid_from = body
        .bank_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(|key| (key, body.bank_qualifier.as_deref().unwrap_or("").trim()));
    infrastructure::settle_handover(&state.db, &handover, paid_from).await?;
    read_handover_back(&state, &id).await
}

async fn read_handover_back(
    state: &AppState,
    id: &str,
) -> Result<Json<PayrollHandoverView>, AppError> {
    let handover = infrastructure::load_handover(&state.db, id)
        .await?
        .ok_or_else(|| {
            AppError::NotFound(format!("payroll run {id} has not been handed to Finance"))
        })?;
    Ok(Json(handover_view(&handover)))
}
