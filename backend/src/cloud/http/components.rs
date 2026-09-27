//! The payroll component catalogue, its ratified rates, and the one-off
//! figures a place files.
//!
//! # Who may do what, and why
//!
//! **Defining a component and ratifying its rate are head office's**, under two
//! separate keys. Inventing a line item decides what a payslip may say;
//! stating its percentage decides what comes out of everybody's wages. A
//! deployment that wants the second held by fewer hands than the first cannot
//! say so with one key, and this module is the reason `overtime_policy` split
//! the same way.
//!
//! **Filing a one-off is the place's**, bounded by [`Reach`] to its own
//! posting. That is the other half of the owner's decision of 2026-09-13: a
//! place that submits a batch and sees the figures but cannot add one can only
//! resend numbers head office has already fixed.
//!
//! **Reading the catalogue and the rates needs no key at all.** The same
//! position the attendance policy and the holiday calendar take, and it matters
//! more here than in either: a rate that decides what comes out of somebody's
//! wage is exactly the rule they are entitled to read, and a deduction kept
//! from the person paying it is the definition of a trap. What *is* gated is
//! reading the one-offs — those are figures about named people, so they sit
//! behind `people.pay.read` and the caller's reach, like the slips they land
//! on.
//!
//! # There is no decide route here
//!
//! A one-off rides the batch carrying it: writable while its month has no run
//! or a `DRAFT` one, frozen by the place's submission, and decided by head
//! office's approval of the run. See `domain::component::adjustment` for why a
//! second approval chain was rejected rather than forgotten.

use super::auth::Principal;
use super::employment::reach_of;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, AttendanceMonth, Authorization,
        ComponentBase, ComponentBasis, ComponentCode, ComponentError, ComponentInForce,
        ComponentKind, ComponentRate, ComponentShape, CountedUnit, PayComponent, PayrollAdjustment,
        RateNumbers, Reach, RecordKind,
    },
    http::audit::DeclaredSubject,
    postgres::{self as infrastructure, PayrollAdjustmentRow},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
/// The second half of "may they". Admin's reach is everywhere; a Supervisor
/// reaches their own posting and nothing else; a login with no posting behind
/// it reaches nothing, which is the honest reading of "we do not know where
/// this person works".
fn reaches(principal: &Principal, reach: &Reach, unit_id: &str) -> Result<(), AppError> {
    if reach.covers(Some(unit_id)) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} is not posted anywhere that reaches {unit_id}",
        principal.username
    )))
}

// ── views ────────────────────────────────────────────────────────────────

/// What a component is worth, as somebody ratified it.
///
/// Every number its shape uses, and only those: the rest are `null` because the
/// shape has no place for them, not because nobody filled them in. The
/// authority is on the wire because "who decided BPJS was 1% here, and when" is
/// the question this row exists to answer.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ComponentRateView {
    pub effective_from: NaiveDate,
    /// `FIXED_AMOUNT` only.
    pub amount_minor: Option<i64>,
    /// `RATE_PER_UNIT` only: money per whole unit.
    pub rate_minor: Option<i64>,
    /// `SHARE_OF_BASE` only: basis points. 4% is 400 — never a decimal.
    pub rate_bp: Option<i32>,
    /// `SHARE_OF_BASE` only, and optional there: the ceiling the share is taken
    /// **of**. `null` means uncapped, which is a different statement from a
    /// very large cap.
    pub cap_minor: Option<i64>,
    /// `FRACTION_OF_BASE_PER_UNIT` only: the 1/173 of Kepmenaker 102/2004
    /// art. 8, as a figure an operator stated.
    pub hours_divisor: Option<i32>,
    /// `FRACTION_OF_BASE_PER_UNIT` only: the statutory multiplier in basis
    /// points. 1.5× is 15000.
    pub multiplier_bp: Option<i32>,
    pub ratified_by: String,
    pub ratified_at: DateTime<Utc>,
    pub reason: String,
}

fn rate_view(rate: &ComponentRate) -> ComponentRateView {
    let (amount, unit_rate, rate_bp, cap, divisor, multiplier) = match rate.basis() {
        ComponentBasis::FixedAmount { amount } => {
            (Some(amount.minor), None, None, None, None, None)
        }
        ComponentBasis::ShareOfBase { rate_bp, cap, .. } => (
            None,
            None,
            i32::try_from(rate_bp).ok(),
            cap.map(|cap| cap.minor),
            None,
            None,
        ),
        ComponentBasis::RatePerUnit { rate, .. } => {
            (None, Some(rate.minor), None, None, None, None)
        }
        ComponentBasis::FractionOfBasePerUnit {
            hours_divisor,
            multiplier_bp,
            ..
        } => (
            None,
            None,
            None,
            None,
            i32::try_from(hours_divisor).ok(),
            i32::try_from(multiplier_bp).ok(),
        ),
    };
    ComponentRateView {
        effective_from: rate.effective_from(),
        amount_minor: amount,
        rate_minor: unit_rate,
        rate_bp,
        cap_minor: cap,
        hours_divisor: divisor,
        multiplier_bp: multiplier,
        ratified_by: rate.ratified().actor().to_string(),
        ratified_at: rate.ratified().at(),
        reason: rate.ratified().reason().to_string(),
    }
}

/// One component, and the rate in force.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PayComponentView {
    pub code: String,
    pub label: String,
    /// `EARNING` or `DEDUCTION`. Amounts are positive everywhere; this says
    /// which way a line points.
    pub kind: String,
    /// One of the five shapes: `FIXED_AMOUNT`, `SHARE_OF_BASE`,
    /// `RATE_PER_UNIT`, `FRACTION_OF_BASE_PER_UNIT`, `PER_OCCASION`. There is
    /// no formula and no expression — see `domain::component`.
    pub basis: String,
    /// `BASE` or `STATUTORY_BASE`, for the two shapes that are a share of one.
    pub base_ref: Option<String>,
    pub unit: Option<String>,
    /// What the unit counts — `minutes`, `days` — so a screen can label the
    /// count without a table of its own.
    pub counted_in: Option<String>,
    /// What the rate is quoted per — `hour`, `day`.
    pub priced_per: Option<String>,
    pub defined_by: String,
    pub defined_at: DateTime<Utc>,
    pub reason: String,
    pub retired: bool,
    pub retired_by: Option<String>,
    pub retired_at: Option<DateTime<Utc>>,
    pub retired_reason: Option<String>,
    /// The rate in force on the date asked for, or `null` if nobody has stated
    /// one. **Not a rate of nought** — read `awaiting_rate` beside it.
    pub rate: Option<ComponentRateView>,
    /// True when this component has a standing figure that nobody has ratified.
    /// Every slip built while it is true carries a sentence naming this
    /// component instead of a net.
    ///
    /// False for a `PER_OCCASION` component, which has nothing standing to
    /// ratify by definition and is therefore never the reason a slip is
    /// incomplete.
    pub awaiting_rate: bool,
}

fn component_view(in_force: &ComponentInForce) -> PayComponentView {
    let component = &in_force.component;
    PayComponentView {
        code: component.code().to_string(),
        label: component.label().to_owned(),
        kind: component.kind().code().to_owned(),
        basis: component.shape().code().to_owned(),
        base_ref: component.base().map(|base| base.code().to_owned()),
        unit: component.unit().map(|unit| unit.code().to_owned()),
        counted_in: component.unit().map(|unit| unit.counted_in().to_owned()),
        priced_per: component.unit().map(|unit| unit.priced_per().to_owned()),
        defined_by: component.defined().actor().to_string(),
        defined_at: component.defined().at(),
        reason: component.defined().reason().to_string(),
        retired: component.is_retired(),
        retired_by: component.retired().map(|a| a.actor().to_string()),
        retired_at: component.retired().map(Authorization::at),
        retired_reason: component.retired().map(|a| a.reason().to_string()),
        rate: in_force.rate.as_ref().map(rate_view),
        awaiting_rate: !in_force.is_workable(),
    }
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DefineComponentBody {
    pub code: String,
    pub label: String,
    /// `EARNING` or `DEDUCTION`.
    pub kind: String,
    /// One of the five shapes.
    pub basis: String,
    #[serde(default)]
    pub base_ref: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    pub reason: String,
}

/// Every number any shape could need, and the handler takes the ones its shape
/// uses.
///
/// One body rather than five, because this is the shape a form has — and
/// because the decision about which numbers a shape needs belongs in
/// `PayComponent::basis_from`, once. Sending a number the shape has no place
/// for is refused rather than ignored: a `SHARE_OF_BASE` posted with an
/// `hours_divisor` is somebody who thinks they are ratifying an overtime rate.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatifyRateBody {
    pub effective_from: NaiveDate,
    #[serde(default)]
    pub amount_minor: Option<i64>,
    #[serde(default)]
    pub rate_minor: Option<i64>,
    #[serde(default)]
    pub rate_bp: Option<i64>,
    #[serde(default)]
    pub cap_minor: Option<i64>,
    #[serde(default)]
    pub hours_divisor: Option<i64>,
    #[serde(default)]
    pub multiplier_bp: Option<i64>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReasonBody {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogueQuery {
    /// Which day to resolve the rate in force on. Defaults to today, because
    /// "what is deducted now" is the question a settings screen asks — but a
    /// payroll screen checking last April asks for April, and gets April's
    /// rate rather than this month's.
    #[serde(default)]
    pub on: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileAdjustmentBody {
    pub unit_id: String,
    /// `YYYY-MM`.
    pub period: String,
    pub employee_id: String,
    pub component_code: String,
    /// Positive. Which way it points is the component's kind, so a *kasbon*
    /// instalment is a positive figure under a `DEDUCTION` component.
    pub amount_minor: i64,
    /// The employee's advance the figure repays, when it is one. The advance
    /// is checked here, by name; its outstanding is checked again at
    /// approval, because filings sit while months move.
    #[serde(default)]
    pub advance_id: Option<Uuid>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdjustmentQuery {
    #[serde(default)]
    pub unit: Option<String>,
    /// `YYYY-MM`.
    #[serde(default)]
    pub period: Option<String>,
}

// ── the catalogue ────────────────────────────────────────────────────────

/// The catalogue, with each component's rate in force.
///
/// **No key.** Somebody measured against a rule is entitled to read it, and a
/// deduction rate is the rule with the most direct claim on that: it decides
/// what comes out of their wage. The same position the attendance policy and
/// the holiday calendar already take.
///
/// Nothing here is about a named person, which is what makes it safe to serve
/// ungated — the one-offs, which are, have their own gated route below.
pub async fn catalogue(
    State(state): State<AppState>,
    Query(query): Query<CatalogueQuery>,
) -> Result<Json<Vec<PayComponentView>>, AppError> {
    let on = query.on.unwrap_or_else(|| Utc::now().date_naive());
    let catalogue = infrastructure::catalogue(&state.db, on).await?;
    Ok(Json(catalogue.iter().map(component_view).collect()))
}

/// Define a component. Head office's.
pub async fn define(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<DefineComponentBody>,
) -> Result<Json<PayComponentView>, AppError> {
    require(&principal, actions::PAY_COMPONENT_DEFINE)?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::PAY_COMPONENT_DEFINE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;

    let component = PayComponent::define(
        ComponentCode::try_new(&body.code).map_err(infrastructure::component_error)?,
        &body.label,
        ComponentKind::parse(&body.kind).map_err(infrastructure::component_error)?,
        ComponentShape::parse(&body.basis).map_err(infrastructure::component_error)?,
        body.base_ref
            .as_deref()
            .map(ComponentBase::parse)
            .transpose()
            .map_err(infrastructure::component_error)?,
        body.unit
            .as_deref()
            .map(CountedUnit::parse)
            .transpose()
            .map_err(infrastructure::component_error)?,
        authorization,
    )
    .map_err(infrastructure::component_error)?;

    infrastructure::define_component(&state.db, &component).await?;
    read_back(&state, component.code().as_str()).await
}

/// Retire one. **Never delete**: a slip line naming a deleted component would
/// point at nothing, and the slips it produced are still the record of what
/// somebody was paid.
///
/// The same key as defining, deliberately. Withdrawing a line item from the
/// vocabulary and adding one are the same decision about what a payslip may
/// say, and a grant to do one without the other would be a grant to grow the
/// catalogue and never tidy it.
pub async fn retire(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<PayComponentView>, AppError> {
    require(&principal, actions::PAY_COMPONENT_DEFINE)?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::PAY_COMPONENT_DEFINE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    infrastructure::retire_component(&state.db, &code, &authorization).await?;
    read_back(&state, &code).await
}

/// One component's rates, over time. **No key**, for the reason the catalogue
/// needs none.
pub async fn rates(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<Vec<ComponentRateView>>, AppError> {
    let component = load(&state, &code).await?;
    let timeline = infrastructure::rate_timeline(&state.db, &component).await?;
    Ok(Json(timeline.rates().iter().map(rate_view).collect()))
}

/// State what a component is worth, from a date.
///
/// Head office's, under its own key. **Nothing is seeded**: until this route is
/// called for a component with a standing figure, every slip built carries a
/// sentence naming it instead of a net — which is the whole design, not a
/// teething problem.
///
/// Forward-only. A rate filed behind the latest would change what an
/// already-closed month was deducted, and a genuinely backdated correction is
/// paid in a current period where somebody can see it — the rule
/// `PayTimeline::append` states for the pay agreement.
pub async fn ratify(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<RatifyRateBody>,
) -> Result<Json<Vec<ComponentRateView>>, AppError> {
    require(&principal, actions::PAY_COMPONENT_RATIFY)?;
    let component = load(&state, &code).await?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::PAY_COMPONENT_RATIFY,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;

    let numbers = RateNumbers {
        amount: body.amount_minor.map(Money::new),
        rate: body.rate_minor.map(Money::new),
        rate_bp: body.rate_bp,
        cap: body.cap_minor.map(Money::new),
        hours_divisor: body.hours_divisor,
        multiplier_bp: body.multiplier_bp,
    };
    let rate = ComponentRate::ratify(&component, body.effective_from, &numbers, authorization)
        .map_err(infrastructure::component_error)?;

    // The forward-only rule fires on the whole history rather than on the row
    // about to be written — the shape `agree_pay` settled on, because the rule
    // is about the timeline and not about one row.
    let mut timeline = infrastructure::rate_timeline(&state.db, &component).await?;
    timeline
        .append(rate.clone())
        .map_err(infrastructure::component_error)?;
    infrastructure::ratify_rate(&state.db, &component, &rate).await?;
    Ok(Json(timeline.rates().iter().map(rate_view).collect()))
}

async fn load(state: &AppState, code: &str) -> Result<PayComponent, AppError> {
    infrastructure::load_component(&state.db, code)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll component {code}")))
}

async fn read_back(state: &AppState, code: &str) -> Result<Json<PayComponentView>, AppError> {
    let on = Utc::now().date_naive();
    let catalogue = infrastructure::catalogue(&state.db, on).await?;
    catalogue
        .iter()
        .find(|in_force| in_force.component.code().as_str() == code)
        .map(|in_force| Json(component_view(in_force)))
        .ok_or_else(|| AppError::NotFound(format!("payroll component {code}")))
}

// ── the one-offs a place files ───────────────────────────────────────────

/// What has been filed, bounded by the caller's reach.
///
/// Gated where the catalogue is not: these are figures about named people, so
/// they sit behind `people.pay.read` and the reach that bounds every other
/// payroll read. `Reach::Nowhere` reads **nothing** rather than everything —
/// the distinction `Reach` is an enum for.
pub async fn adjustments(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<AdjustmentQuery>,
) -> Result<Json<Vec<PayrollAdjustmentRow>>, AppError> {
    require(&principal, actions::PAY_READ)?;
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Ok(Json(Vec::new()));
    }
    let unit = match query.unit.as_deref() {
        Some(asked) => {
            reaches(&principal, &reach, asked)?;
            Some(asked.to_owned())
        }
        None => reach.sole_unit().map(ToString::to_string),
    };
    let period = query
        .period
        .as_deref()
        .map(|raw| {
            let month = AttendanceMonth::parse(raw).map_err(infrastructure::attendance_error)?;
            infrastructure::month_first_day(month)
        })
        .transpose()?;

    Ok(Json(
        infrastructure::adjustments(&state.db, unit.as_deref(), period).await?,
    ))
}

/// File one. **The place's act**, for its own unit and its own month.
///
/// The id is minted here rather than accepted: an id a client chooses is an id
/// a client can be made to collide with somebody else's — the reason
/// `http::employment::register` mints an employee id and `hire::propose` mints
/// a proposal one.
///
/// Refused once the batch has been submitted, naming the run and the month. The
/// figure then belongs to a document somebody has signed for, and the way to
/// change it is head office's reopen, which clears both signatures where an
/// audit can see it.
pub async fn file(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(body): Json<FileAdjustmentBody>,
) -> Result<Json<Vec<PayrollAdjustmentRow>>, AppError> {
    require(&principal, actions::PAYROLL_ADJUSTMENT_FILE)?;
    let reach = reach_of(&state, &principal).await?;
    reaches(&principal, &reach, &body.unit_id)?;

    let unit = crate::cloud::domain::UnitId::try_new(&body.unit_id).map_err(invalid)?;
    let month = AttendanceMonth::parse(&body.period).map_err(infrastructure::attendance_error)?;
    let first_day = infrastructure::month_first_day(month)?;
    let component = load(&state, &body.component_code.to_uppercase()).await?;
    // The advance-side rules are refused here, by name, while the filer can
    // still fix the form; the DEDUCTION direction is the domain's, which has
    // the component row.
    if let Some(advance_id) = body.advance_id {
        refuse_impossible_recovery(&state, advance_id, &body.employee_id, body.amount_minor)
            .await?;
    }

    let authorization = Authorization::try_new(
        &principal.username,
        actions::PAYROLL_ADJUSTMENT_FILE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    let adjustment = PayrollAdjustment::file(
        format!("adj-{}", Uuid::new_v4()),
        unit.clone(),
        &body.period,
        &body.employee_id,
        &component,
        Money::new(body.amount_minor),
        body.advance_id,
        authorization,
    )
    .map_err(infrastructure::component_error)?;

    infrastructure::file_adjustment(&state.db, &adjustment, first_day).await?;
    // The run already holds slips built before this figure existed. Rebuild
    // them now, so a place that files and then submits cannot send head office
    // an arithmetic the filing did not reach.
    infrastructure::rebuild_draft_run(&state.db, unit.as_str(), first_day).await?;
    // Filed against the EMPLOYEE, not against a row of its own. "Why did Siti
    // get three hundred thousand extra in April" is a question somebody asks on
    // her sheet, and an adjustment id is not a record anybody opens — the shape
    // `POST /inventory/movements/correct` settled on.
    acted_on.set(RecordKind::Employee, body.employee_id.clone());

    Ok(Json(
        infrastructure::adjustments(&state.db, Some(unit.as_str()), Some(first_day)).await?,
    ))
}

/// The advance-side half of filing a recovery, refused by name.
///
/// These are checked in the request's own path rather than in the domain
/// because they need the advance row, which only this path has read — the
/// component-side rules are [`PayrollAdjustment::file`]'s, which holds that
/// row. The outstanding half repeats at approval, where `postgres::pay` keeps
/// its reasons; here it is a courtesy, there it is the guard.
async fn refuse_impossible_recovery(
    state: &AppState,
    advance_id: Uuid,
    employee_id: &str,
    amount_minor: i64,
) -> Result<(), AppError> {
    let refuse = |error| Err(infrastructure::component_error(error));
    let Some(advance) = infrastructure::advance_for_recovery(&state.db, advance_id).await? else {
        return refuse(ComponentError::RecoveryAdvanceUnknown { advance_id });
    };
    if advance.party_type != "EMPLOYEE" {
        return refuse(ComponentError::RecoveryNotAnEmployeeAdvance {
            advance_id,
            party_type: advance.party_type,
        });
    }
    if advance.employee_id.as_deref() != Some(employee_id) {
        return refuse(ComponentError::RecoveryNotTheEmployees {
            advance_number: advance.advance_number,
            employee_id: employee_id.to_owned(),
        });
    }
    // The open set, as the lane's own partial index names it (0280): money
    // out, or part of it back.
    if !matches!(advance.status.as_str(), "PAID" | "PARTIALLY_SETTLED") {
        return refuse(ComponentError::RecoveryAdvanceNotPaidOut {
            advance_number: advance.advance_number,
            status: advance.status,
        });
    }
    if amount_minor > advance.outstanding_minor {
        return refuse(ComponentError::RecoveryExceedsOutstanding {
            advance_number: advance.advance_number,
            outstanding_minor: advance.outstanding_minor,
            amount_minor,
            over_minor: amount_minor - advance.outstanding_minor,
        });
    }
    Ok(())
}

/// Take one back, while the batch is still the place's.
///
/// A `POST .../withdrawal` rather than a `DELETE`, matching
/// `/attendance-corrections/{id}/withdrawal`: taking a figure back is an act
/// that needs a reason, and a `DELETE` has nowhere to put one.
///
/// The row is removed rather than flagged: this is a working figure in an
/// unsigned batch, exactly like a slip in a draft run, and a
/// withdrawn-adjustment row nothing reads would be a second vocabulary for
/// "not in the batch". The reason lives in the audit log with the actor, which
/// is where somebody asking "who took Siti's incentive off" will look — and it
/// is validated here as a `ReasonText` before anything is deleted, so a blank
/// one cannot get that far.
///
/// The same key as filing. Nothing here is signed yet, and a grant that could
/// add a figure but not take it back would be a grant to make a mistake
/// permanent — which is why this is not the `PAYROLL_REOPEN` shape.
pub async fn withdraw(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(id): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<PayrollAdjustmentRow>>, AppError> {
    require(&principal, actions::PAYROLL_ADJUSTMENT_FILE)?;
    // Built for its validation rather than for storage: the row is about to go,
    // so the reason's home is the audit log — but a blank one is refused before
    // anything is removed.
    Authorization::try_new(
        &principal.username,
        actions::PAYROLL_ADJUSTMENT_FILE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    // The reach is a fact about the row, so the row has to be found before the
    // bound can be applied — and it is found in its own read rather than
    // inside the delete's transaction, so a 403 is never reached by way of a
    // transaction that has already removed something.
    let reach = reach_of(&state, &principal).await?;
    let found = infrastructure::adjustment_unit_of(&state.db, &id).await?;
    let Some((unit, first_day)) = found else {
        return Err(AppError::NotFound(format!("payroll adjustment {id}")));
    };
    reaches(&principal, &reach, unit.as_str())?;

    let withdrawn = infrastructure::withdraw_adjustment(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("payroll adjustment {id}")))?;
    // Taking a figure back changes the month too: the slip that carried it
    // must lose it before the batch can be submitted.
    infrastructure::rebuild_draft_run(&state.db, unit.as_str(), first_day).await?;
    acted_on.set(RecordKind::Employee, withdrawn.employee_id().to_owned());

    Ok(Json(
        infrastructure::adjustments(&state.db, Some(unit.as_str()), Some(first_day)).await?,
    ))
}
