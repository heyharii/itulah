//! What somebody is paid, who they are to payroll, and the run that pays them.
//!
//! # Head office only, all of it
//!
//! Hari's decision, and the reason it is worth stating rather than inferring
//! from the rungs: a place manager's whole contribution to payroll is closing
//! their attendance period. They never see a run and never approve one. Every
//! key in this module is at the Admin rung, so the ladder enforces it without
//! this file having to.
//!
//! # Two people sign a run
//!
//! Verify and approve are separate keys held by the same rung, which is what
//! lets the domain compare *actors* — the rung cannot, because everybody who
//! may do either may do both. The refusal is a conflict rather than a bad
//! request: the payload is fine and what is wrong is who is sending it.
//!
//! # Nothing statutory is computed
//!
//! Not here, not in the domain, not in the schema. A slip carries the agreement
//! in force and the facts this system recorded; the columns for computed
//! deductions do not exist, so nothing can quietly acquire a zero that reads as
//! "nothing was owed".

use super::auth::Principal;
use super::employment::{current_place, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AllowanceCode, AttendanceMonth,
        Authorization, BankAccount, FixedAllowance, IdentityChange, PayRecord, PayrollIdentity,
        PayrollRun, PlaceId, PtkpStatus,
    },
    postgres::{self as infrastructure, PayrollSlipRow, RunReconciliation},
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
    /// `VERIFIED`, `APPROVED`, `SEALED` or `REOPENED`.
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
    /// `DRAFT`, `VERIFIED`, `APPROVED` or `SEALED`.
    pub state: String,
    /// False while anything about the month is unknowable. Read it before
    /// reading the figures.
    pub complete: bool,
    /// The sentence the screen shows when `complete` is false.
    pub incomplete_because: Option<String>,
    /// Who checked the figures as the run currently stands. `null` after a
    /// reopen, because the next approval is a fresh pair of signatures.
    pub verified_by: Option<String>,
    pub history: Vec<RunEventView>,
}

fn run_view(run: &PayrollRun) -> PayrollRunView {
    PayrollRunView {
        id: run.id().to_owned(),
        place_id: run.place().to_string(),
        period: run.period().to_owned(),
        state: run.state().code().to_owned(),
        complete: run.complete(),
        incomplete_because: run.incomplete_because().map(ToOwned::to_owned),
        verified_by: run.verifier().map(ToString::to_string),
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
/// Head office's to read as well as to write: a supervisor who could read the
/// team's salaries is a supervisor who knows what everybody earns, and that is
/// not a rota question.
pub async fn read_pay(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<PayRecordView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    // Reading your own is not a privilege — somebody is entitled to know what
    // they agreed to.
    access.may_read(actions::PAY_CHANGE)?;
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
    access.may_read(actions::PAY_CHANGE)?;
    Ok(Json(
        infrastructure::slips_of(&state.db, &access.employee_id).await?,
    ))
}

// ── payroll runs ─────────────────────────────────────────────────────────

pub async fn list_runs(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<RunQuery>,
) -> Result<Json<Vec<PayrollRunView>>, AppError> {
    require(&principal, actions::PAYROLL_VERIFY)?;
    let runs = infrastructure::list_runs(&state.db, query.place.as_deref()).await?;
    Ok(Json(runs.iter().map(run_view).collect()))
}

/// Open a run for a place and a month.
///
/// Refuses a month whose attendance is not closed. The period is the payroll
/// gate: while it is open the facts are still moving, and a run built over
/// moving facts is a run that disagrees with itself an hour later.
pub async fn open_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<OpenRunBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    require(&principal, actions::PAYROLL_VERIFY)?;
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
    read_back(&state, run.id()).await
}

async fn read_back(state: &AppState, id: &str) -> Result<Json<PayrollRunView>, AppError> {
    let run = infrastructure::load_run(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll run {id}")))?;
    Ok(Json(run_view(&run)))
}

async fn step(
    state: &AppState,
    principal: &Principal,
    id: &str,
    action_key: &str,
    reason: &str,
    apply: impl FnOnce(&mut PayrollRun, Authorization) -> Result<(), crate::cloud::domain::PayError>,
) -> Result<Json<PayrollRunView>, AppError> {
    require(principal, action_key)?;
    let mut run = infrastructure::load_run(&state.db, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll run {id}")))?;
    let authorization = Authorization::try_new(&principal.username, action_key, Utc::now(), reason)
        .map_err(invalid)?;
    apply(&mut run, authorization).map_err(infrastructure::pay_error)?;
    infrastructure::save_run(&state.db, &run).await?;
    read_back(state, id).await
}

pub async fn verify_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    step(
        &state,
        &principal,
        &id,
        actions::PAYROLL_VERIFY,
        &body.reason,
        PayrollRun::verify,
    )
    .await
}

pub async fn approve_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    step(
        &state,
        &principal,
        &id,
        actions::PAYROLL_APPROVE,
        &body.reason,
        PayrollRun::approve,
    )
    .await
}

pub async fn seal_run(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<StepBody>,
) -> Result<Json<PayrollRunView>, AppError> {
    step(
        &state,
        &principal,
        &id,
        actions::PAYROLL_SEAL,
        &body.reason,
        PayrollRun::seal,
    )
    .await
}

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
    )
    .await
}

pub async fn run_slips(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<Vec<PayrollSlipRow>>, AppError> {
    require(&principal, actions::PAYROLL_VERIFY)?;
    Ok(Json(infrastructure::run_slips(&state.db, &id).await?))
}

pub async fn run_reconciliation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<RunReconciliation>, AppError> {
    require(&principal, actions::PAYROLL_VERIFY)?;
    let run = infrastructure::load_run(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll run {id}")))?;
    let month = AttendanceMonth::parse(run.period()).map_err(infrastructure::attendance_error)?;
    let first = infrastructure::month_first_day(month)?;
    Ok(Json(
        infrastructure::reconcile(&state.db, &run, first).await?,
    ))
}
