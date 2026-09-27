//! People's next generation, on the wire.
//!
//! Six small features, one shape: file, decide, read back. The rules below
//! repeat on purpose because they are the point:
//!
//! * **The actor is never in the body.** Every authority is assembled here
//!   from the session; only the reason is the caller's.
//! * **A filer may not decide their own.** Swaps, change proposals and offers
//!   all refuse it on the domain type, which means a stored row refuses it
//!   again on the way out of the database.
//! * **Reach is the place half of "may they".** Supervisor-rung keys are
//!   bounded by the caller's own posting; head office is unbounded. The bound
//!   is checked *after* the row loads, because the place is a fact about the
//!   row.
//! * **Applying a change proposal calls the kernels that already own the
//!   writes.** Nothing here invents a second way to move an assignment, sign
//!   a contract, set pay or end an employment — the proposal decides, and the
//!   employment, pay and exit kernels write.

use super::auth::Principal;
use super::employment::{current_place, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, people::*, required_role_for_action, role_allows, AssignmentSpan,
        AssignmentTimeline, Authorization, Contract, ContractKind, ContractTimeline, Employee,
        EmployeeId, Grade, PlaceId, Position,
    },
    postgres::{self as infrastructure, EmployeeRecord},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use pricing_engine::Money;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

/// A proposal value, as a screen shows it: a string as itself, a number as a
/// number, anything else as its JSON. Never parsed back — the applied truth
/// is what the kernels write.
fn render_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Null => "—".to_owned(),
        other => other.to_string(),
    }
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

fn authorize(
    principal: &Principal,
    action_key: &str,
    reason: &str,
) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, action_key, Utc::now(), reason).map_err(invalid)
}

/// How a list query is fenced by the caller's own posting.
///
/// `All` is head office; `One(None)` is a supervisor posted nowhere, who sees
/// an empty list rather than the whole company — the distinction
/// [`crate::cloud::domain::Reach`] exists to keep.
enum PlaceFilter {
    All,
    One(Option<String>),
}

async fn place_filter(state: &AppState, principal: &Principal) -> Result<PlaceFilter, AppError> {
    let reach = reach_of(state, principal).await?;
    Ok(match reach {
        crate::cloud::domain::Reach::Everywhere => PlaceFilter::All,
        crate::cloud::domain::Reach::Only(place) => {
            PlaceFilter::One(Some(place.as_str().to_owned()))
        }
        crate::cloud::domain::Reach::Nowhere => PlaceFilter::One(None),
    })
}

/// Refuse when the caller's reach does not cover the row's place. Run after
/// the row loads: the place is a fact about the row.
fn reach_covers(
    reach: &crate::cloud::domain::Reach,
    place: &str,
    username: &str,
) -> Result<(), AppError> {
    if reach.covers(Some(place)) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{username} is not posted anywhere that reaches {place}"
    )))
}

// ── views ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RosterSwapView {
    pub id: String,
    pub employee_id: String,
    pub with_employee_id: String,
    pub place_id: String,
    pub on_date: String,
    pub reason: String,
    pub state: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
}

fn swap_view(swap: &RosterSwap) -> RosterSwapView {
    RosterSwapView {
        id: swap.id.clone(),
        employee_id: swap.employee_id.as_str().to_owned(),
        with_employee_id: swap.with_employee_id.as_str().to_owned(),
        place_id: swap.place_id.as_str().to_owned(),
        on_date: swap.on_date.to_string(),
        reason: swap.reason.clone(),
        state: swap.state.as_str().to_owned(),
        requested_by: swap.requested.actor().as_str().to_owned(),
        decided_by: swap
            .decision
            .as_ref()
            .map(|d| d.authorization.actor().as_str().to_owned()),
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChangePropView {
    pub field: String,
    /// Rendered for the screen: a name stays a name, a figure prints as one.
    /// The typed truth is whatever the kernel wrote, on the kernels' own
    /// routes; this is the proposal's intent, as the filer stated it.
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChangeProposalView {
    pub id: String,
    pub employee_id: String,
    pub place_id: String,
    pub kind: String,
    pub props: Vec<ChangePropView>,
    pub effective_on: String,
    pub reason: String,
    pub state: String,
    pub filed_by: String,
    pub decided_by: Option<String>,
    pub decision_note: Option<String>,
    pub applied_at: Option<String>,
}

fn change_view(proposal: &ChangeProposal) -> ChangeProposalView {
    ChangeProposalView {
        id: proposal.id.clone(),
        employee_id: proposal.employee_id.as_str().to_owned(),
        place_id: proposal.place_id.as_str().to_owned(),
        kind: proposal.kind.as_str().to_owned(),
        props: proposal
            .props
            .iter()
            .map(|p| ChangePropView {
                field: p.field.clone(),
                from: render_value(&p.from),
                to: render_value(&p.to),
            })
            .collect(),
        effective_on: proposal.effective_on.to_string(),
        reason: proposal.reason.clone(),
        state: proposal.state.as_str().to_owned(),
        filed_by: proposal.filed.actor().as_str().to_owned(),
        decided_by: proposal
            .decision
            .as_ref()
            .map(|d| d.authorization.actor().as_str().to_owned()),
        decision_note: proposal.decision.as_ref().and_then(|d| d.note.clone()),
        applied_at: proposal.applied_at.map(|t| t.to_rfc3339()),
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LifecycleTemplateView {
    pub id: String,
    pub label: String,
    pub owner: String,
    pub kind: String,
    pub position: i32,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LifecycleTaskView {
    pub id: String,
    pub employee_id: String,
    pub kind: String,
    pub template_id: String,
    pub label: String,
    pub owner: String,
    pub position: i32,
    pub state: String,
    pub done_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StaffingPlanView {
    pub id: String,
    pub place_id: String,
    pub position: String,
    pub span: String,
    pub headcount: i32,
    pub cost_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ApplicantView {
    pub id: String,
    pub proposal_id: String,
    pub place_id: String,
    pub name: String,
    pub phone: Option<String>,
    pub source: String,
    pub referrer_employee_id: Option<String>,
    pub stage: String,
    pub stage_note: Option<String>,
    pub applied_on: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct InterviewView {
    pub id: String,
    pub applicant_id: String,
    pub scheduled_at: String,
    pub interviewer_employee_id: String,
    pub result: String,
    pub ratings: BTreeMap<String, u8>,
    pub note: Option<String>,
    pub recorded_by: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OfferView {
    pub id: String,
    pub applicant_id: String,
    pub base_minor: i64,
    pub grade: String,
    pub starts_on: String,
    pub term: String,
    pub state: String,
    pub offered_by: String,
    pub decided_by: Option<String>,
    pub hired_employee_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PerformanceTemplateView {
    pub position: String,
    pub metric: String,
    pub weight: i32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PerformanceScoreView {
    pub employee_id: String,
    pub period: String,
    pub kpi_pct: f64,
    pub manager_score: i32,
    pub note: Option<String>,
    pub recorded_by: String,
    /// Derived on read from the policy table. Not stored, so a policy change
    /// is visible here the moment it happens.
    pub bonus_rate_pct: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TrainingProgramView {
    pub id: String,
    pub title: String,
    pub on_date: String,
    pub place: String,
    pub cost_minor: i64,
    pub state: String,
    pub participants: i64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UniformIssuanceView {
    pub id: String,
    pub employee_id: String,
    pub issued_on: String,
    pub sets: i32,
    pub recorded_by: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PolicyView {
    pub key: String,
    pub group: String,
    pub label: String,
    pub value: f64,
    pub unit: String,
    pub updated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GradeView {
    pub code: String,
    pub floor_minor: i64,
    pub ceiling_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PositionView {
    pub name: String,
    pub grade_floor: String,
    pub grade_ceiling: String,
    pub structure: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StructureView {
    pub code: String,
    pub name: String,
    pub bonus_cap_policy: Option<String>,
    pub components: Vec<String>,
}

// ── roster swaps ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct FileSwapBody {
    pub with_employee_id: String,
    pub on_date: String,
    pub reason: String,
}

/// File a swap for your own roster day. Cashier rung, own record only: the
/// person whose day moves is the person who asks.
pub async fn file_swap(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<FileSwapBody>,
) -> Result<Json<RosterSwapView>, AppError> {
    let access = resolve(&state, &principal, "me").await?;
    let authorization = access.authorize(actions::ROSTER_SWAP_REQUEST_OWN, &body.reason)?;
    let on_date: NaiveDate = body
        .on_date
        .parse()
        .map_err(|_| invalid("on_date is not a date"))?;

    // The colleague must exist: a swap with a name that is nobody fails here
    // rather than in the roster, which would refuse the day, not the person.
    infrastructure::load_employee(&state.db, &body.with_employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound("colleague not found".to_owned()))?;
    let mine_place = colleague_place(&state, access.employee_id.as_str())
        .await?
        .ok_or_else(|| AppError::Conflict("you are not posted anywhere".to_owned()))?;
    let their_place = colleague_place(&state, &body.with_employee_id)
        .await?
        .ok_or_else(|| {
            AppError::Conflict("the colleague you named is not posted anywhere".to_owned())
        })?;
    if mine_place != their_place {
        return Err(AppError::Validation(
            "a swap is between two people at the same place".to_owned(),
        ));
    }

    // A closed month refuses a new swap the way it refuses a new correction.
    let period = infrastructure::period_for(
        &state.db,
        &PlaceId::try_new(&mine_place).map_err(invalid)?,
        on_date,
    )
    .await?;
    if period.is_closed() {
        return Err(AppError::Conflict(format!(
            "attendance for {mine_place} in {} is already closed",
            on_date.format("%Y-%m")
        )));
    }

    let swap = RosterSwap::file(
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        EmployeeId::try_new(&body.with_employee_id).map_err(invalid)?,
        PlaceId::try_new(&mine_place).map_err(invalid)?,
        on_date,
        &body.reason,
        authorization,
    )
    .map_err(invalid)?;
    infrastructure::insert_swap(&state.db, &swap).await?;
    Ok(Json(swap_view(&swap)))
}

async fn colleague_place(state: &AppState, employee_id: &str) -> Result<Option<String>, AppError> {
    let record = infrastructure::load_employee(&state.db, employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {employee_id}")))?;
    Ok(current_place(&record).map(ToOwned::to_owned))
}

/// The store head's queue, bounded by reach.
pub async fn pending_swaps(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<RosterSwapView>>, AppError> {
    require(&principal, actions::ROSTER_SWAP_DECIDE)?;
    let filter = place_filter(&state, &principal).await?;
    let swaps = match filter {
        PlaceFilter::One(None) => Vec::new(),
        PlaceFilter::One(Some(place)) => {
            infrastructure::pending_swaps(&state.db, Some(&place)).await?
        }
        PlaceFilter::All => infrastructure::pending_swaps(&state.db, None).await?,
    };
    Ok(Json(swaps.iter().map(swap_view).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SwapListQuery {
    pub employee_id: Option<String>,
}

/// A person's swap history. Their own is always readable; anybody else's
/// needs the workforce read at their place.
pub async fn swap_history(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<RosterSwapView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        access.may_read(actions::EMPLOYEE_READ)?;
        let place = colleague_place(&state, access.employee_id.as_str()).await?;
        access.reaches(place.as_deref())?;
    }
    let swaps = infrastructure::swaps_of_employee(&state.db, access.employee_id.as_str()).await?;
    Ok(Json(swaps.iter().map(swap_view).collect()))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct SwapDecisionBody {
    pub approved: bool,
    pub reason: String,
}

/// Decide a swap. Approving moves both roster days, in one transaction, as
/// roster revisions — the only way a plan may change. The colleague's
/// consent is checked here: a swap nobody agreed to is not approved into the
/// roster, it is refused.
pub async fn decide_swap(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<SwapDecisionBody>,
) -> Result<Json<RosterSwapView>, AppError> {
    require(&principal, actions::ROSTER_SWAP_DECIDE)?;
    let reach = reach_of(&state, &principal).await?;
    let mut swap = infrastructure::load_swap(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("swap {id}")))?;
    reach_covers(&reach, swap.place_id.as_str(), &principal.username)?;
    let decision = authorize(&principal, actions::ROSTER_SWAP_DECIDE, &body.reason)?;
    swap.decide(
        body.approved,
        Decision {
            authorization: decision,
            note: None,
        },
        &principal.username,
    )
    .map_err(invalid)?;

    if body.approved {
        move_roster_days(&state, &swap).await?;
    }
    infrastructure::update_swap(&state.db, &swap).await?;
    Ok(Json(swap_view(&swap)))
}

/// The move itself: load both days, exchange their plans, append the exchange
/// as a revision under the decider's authority. A closed period refuses —
/// the same refusal planning a day would meet.
async fn move_roster_days(state: &AppState, swap: &RosterSwap) -> Result<(), AppError> {
    let period = infrastructure::period_for(&state.db, &swap.place_id, swap.on_date).await?;
    let day = swap.on_date;
    let mut a = infrastructure::roster_of(&state.db, swap.employee_id.as_str(), day, day).await?;
    let mut b =
        infrastructure::roster_of(&state.db, swap.with_employee_id.as_str(), day, day).await?;
    let plan_a = a
        .on(swap.on_date)
        .ok_or_else(|| AppError::Conflict("the requester has no roster day that date".to_owned()))?
        .plan()
        .clone();
    let plan_b = b
        .on(swap.on_date)
        .ok_or_else(|| AppError::Conflict("the colleague has no roster day that date".to_owned()))?
        .plan()
        .clone();
    // The revisions the swap writes are roster planning, so they carry the
    // roster key in the decider's name — the transport key that decided the
    // swap is not the kernel's, and the kernel rightly refuses it.
    let decider = swap
        .decision
        .as_ref()
        .map(|d| d.authorization.actor().as_str().to_owned())
        .ok_or_else(|| {
            AppError::Configuration("an approved swap carries its decision".to_owned())
        })?;
    let reason = format!("roster swap {} approved", swap.id);
    let auth = Authorization::try_new(&decider, actions::ROSTER_MANAGE, Utc::now(), &reason)
        .map_err(invalid)?;
    a.revise(swap.on_date, plan_b, auth.clone(), &period)
        .map_err(infrastructure::attendance_error)?;
    b.revise(swap.on_date, plan_a, auth, &period)
        .map_err(infrastructure::attendance_error)?;
    infrastructure::save_roster_day(
        &state.db,
        a.on(swap.on_date).ok_or_else(|| {
            AppError::Configuration("the roster lost the day it just revised".to_owned())
        })?,
    )
    .await?;
    infrastructure::save_roster_day(
        &state.db,
        b.on(swap.on_date).ok_or_else(|| {
            AppError::Configuration("the roster lost the day it just revised".to_owned())
        })?,
    )
    .await?;
    Ok(())
}

pub async fn withdraw_swap(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<RosterSwapView>, AppError> {
    let mut swap = infrastructure::load_swap(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("swap {id}")))?;
    swap.withdraw(&principal.username).map_err(invalid)?;
    infrastructure::update_swap(&state.db, &swap).await?;
    Ok(Json(swap_view(&swap)))
}

// ── employment change proposals ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct FileChangeBody {
    pub kind: String,
    pub props: Vec<ChangePropBody>,
    pub effective_on: String,
    pub reason: String,
}

/// One "what changes" row as the filer states it: a name, or a whole number
/// of rupiah. Typed rather than a JSON blob so the wire says what it accepts.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct ChangePropBody {
    pub field: String,
    pub to_text: Option<String>,
    pub to_minor: Option<i64>,
}

/// File a change proposal against somebody's employment. The shop's, bounded
/// by their posting; head office decides.
pub async fn file_change(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<FileChangeBody>,
) -> Result<Json<ChangeProposalView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::CHANGE_PROPOSAL_FILE)?;
    if !access.own {
        let place = colleague_place(&state, access.employee_id.as_str()).await?;
        access.reaches(place.as_deref())?;
    }
    let place = colleague_place(&state, access.employee_id.as_str())
        .await?
        .ok_or_else(|| AppError::Conflict("this person is not posted anywhere".to_owned()))?;
    let kind = ChangeKind::parse(&body.kind)
        .ok_or_else(|| invalid("kind is PROMOTION, TRANSFER, SALARY or SEPARATION"))?;
    let effective_on: NaiveDate = body
        .effective_on
        .parse()
        .map_err(|_| invalid("effective_on is not a date"))?;
    let authorization = access.authorize(actions::CHANGE_PROPOSAL_FILE, &body.reason)?;
    let props = body
        .props
        .into_iter()
        .map(|p| {
            let to = match (p.to_minor, p.to_text) {
                (Some(minor), _) => serde_json::json!(minor),
                (None, Some(text)) => serde_json::Value::String(text),
                (None, None) => {
                    return Err(invalid(
                        "a change row carries to_minor (a figure) or to_text (a name)",
                    ))
                }
            };
            Ok(ChangeProp {
                field: p.field,
                from: serde_json::Value::Null,
                to,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let proposal = ChangeProposal::file(
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        PlaceId::try_new(&place).map_err(invalid)?,
        kind,
        props,
        effective_on,
        &body.reason,
        authorization,
    )
    .map_err(invalid)?;
    infrastructure::insert_change(&state.db, &proposal).await?;
    Ok(Json(change_view(&proposal)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChangeListQuery {
    pub state: Option<String>,
    pub place_id: Option<String>,
}

/// The proposal queue. A bounded caller sees their place only; head office
/// sees everything, and may filter.
pub async fn list_changes(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ChangeListQuery>,
) -> Result<Json<Vec<ChangeProposalView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let filter = place_filter(&state, &principal).await?;
    let requested_place = query.place_id.as_deref();
    if let (PlaceFilter::One(Some(place)), Some(requested)) = (&filter, requested_place) {
        if place != requested {
            return Err(AppError::Forbidden(format!(
                "{} does not reach {requested}",
                principal.username
            )));
        }
    }
    let bound = match (&filter, requested_place) {
        (PlaceFilter::One(Some(place)), _) => Some(place.as_str()),
        (PlaceFilter::All, requested) => requested,
        (PlaceFilter::One(None), _) => {
            return Ok(Json(Vec::new()));
        }
    };
    let rows = infrastructure::list_changes(&state.db, query.state.as_deref(), bound).await?;
    Ok(Json(rows.iter().map(change_view).collect()))
}

pub async fn change_history(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<ChangeProposalView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        access.may_read(actions::EMPLOYEE_READ)?;
        let place = colleague_place(&state, access.employee_id.as_str()).await?;
        access.reaches(place.as_deref())?;
    }
    let rows = infrastructure::changes_of_employee(&state.db, access.employee_id.as_str()).await?;
    Ok(Json(rows.iter().map(change_view).collect()))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct ChangeDecisionBody {
    pub approved: bool,
    pub reason: String,
    pub note: Option<String>,
}

/// Head office's answer, and — for an approval — the apply step, in the same
/// request. An approved proposal that is not applied is a promise the record
/// does not keep, so deciding and applying are one transaction.
pub async fn decide_change(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<ChangeDecisionBody>,
) -> Result<Json<ChangeProposalView>, AppError> {
    require(&principal, actions::CHANGE_PROPOSAL_DECIDE)?;
    let mut proposal = infrastructure::load_change(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("proposal {id}")))?;
    let authorization = authorize(&principal, actions::CHANGE_PROPOSAL_DECIDE, &body.reason)?;
    proposal
        .decide(
            body.approved,
            Decision {
                authorization,
                note: body.note,
            },
            &principal.username,
        )
        .map_err(invalid)?;

    if body.approved {
        apply_change(&state, &mut proposal).await?;
        proposal.mark_applied(Utc::now()).map_err(invalid)?;
    }
    infrastructure::update_change(&state.db, &proposal).await?;
    Ok(Json(change_view(&proposal)))
}

pub async fn withdraw_change(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<ChangeProposalView>, AppError> {
    let mut proposal = infrastructure::load_change(&state.db, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("proposal {id}")))?;
    proposal.withdraw(&principal.username).map_err(invalid)?;
    infrastructure::update_change(&state.db, &proposal).await?;
    Ok(Json(change_view(&proposal)))
}

/// Apply one approved proposal, calling the kernel that owns each write.
///
/// Every arm loads the employment record fresh and saves through the same
/// functions the employment routes use. The keys the writes carry are the
/// kernels' own: a contract signed by this apply is signed under
/// `CONTRACT_CHANGE`, a pay agreement under `PAY_CHANGE`, an employment
/// transition under `EMPLOYMENT_CHANGE` — all head office's, which is what
/// the deciding key already established the caller is.
async fn apply_change(state: &AppState, proposal: &mut ChangeProposal) -> Result<(), AppError> {
    let employee_id = proposal.employee_id.as_str().to_owned();
    let reason: &str = &proposal.reason;
    let effective = proposal.effective_on;
    let mut record = infrastructure::load_employee(&state.db, &employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {employee_id}")))?;

    // The writes carry head office's own keys under the decider's name: the
    // decision established who is acting, and the kernels' keys say what the
    // act was.
    let decider = proposal
        .decision
        .as_ref()
        .map(|d| d.authorization.actor().as_str().to_owned())
        .unwrap_or_else(|| "people.apply".to_owned());
    let authority = |key: &'static str| -> Result<Authorization, AppError> {
        Authorization::try_new(&decider, key, Utc::now(), reason).map_err(invalid)
    };

    match proposal.kind {
        ChangeKind::Transfer => {
            let to_place = proposal
                .decided("place_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AppError::Configuration("an approved transfer names a place".to_owned())
                })?
                .to_owned();
            let auth = authority(actions::ASSIGNMENT_MANAGE)?;
            let mut spans: Vec<AssignmentSpan> = record.assignments.spans().to_vec();
            // Close the open span the day before, open the new one on the day.
            let mut rewritten = Vec::new();
            for span in spans.drain(..) {
                if span.to().is_none() {
                    rewritten.push(
                        AssignmentSpan::try_new(
                            span.place_id().clone(),
                            span.from(),
                            Some(effective - chrono::Duration::days(1)),
                            span.authorization().clone(),
                        )
                        .map_err(invalid)?,
                    );
                } else {
                    rewritten.push(span);
                }
            }
            rewritten.push(
                AssignmentSpan::try_new(
                    PlaceId::try_new(&to_place).map_err(invalid)?,
                    effective,
                    None,
                    auth,
                )
                .map_err(invalid)?,
            );
            let mut timeline = AssignmentTimeline::new();
            for span in rewritten {
                timeline
                    .push(span)
                    .map_err(|error| AppError::Conflict(error.to_string()))?;
            }
            infrastructure::replace_assignments(&state.db, &employee_id, &timeline).await?;
        }
        ChangeKind::Promotion => {
            let position = proposal
                .decided("position")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
            let grade = proposal
                .decided("grade")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
            let auth = authority(actions::CONTRACT_CHANGE)?;
            let current = record.contracts.current().cloned().ok_or_else(|| {
                AppError::Conflict("this person has no contract to change".to_owned())
            })?;
            let new_position = position
                .map(|p| Position::try_new(&p))
                .transpose()
                .map_err(invalid)?
                .unwrap_or_else(|| current.position().clone());
            let new_grade = grade
                .map(|g| Grade::try_new(&g))
                .transpose()
                .map_err(invalid)?
                .unwrap_or_else(|| current.grade().clone());
            // A promotion is an effective-dated rewrite. The current terms
            // cannot simply be overlapped — the timeline refuses two
            // contracts covering one day — so the contract in force ends the
            // day before and the new one starts on the day itself. A fixed
            // term keeps its original end; a permanent contract is replaced
            // by the new permanent one. Earlier, already-ended contracts ride
            // along untouched.
            let new_kind = match current.kind() {
                ContractKind::Pkwt { ends_on } => ContractKind::Pkwt { ends_on },
                ContractKind::Pkwtt => ContractKind::Pkwtt,
            };
            let mut rebuilt: Vec<Contract> = Vec::new();
            for contract in record.contracts.contracts() {
                if contract.covers(effective) {
                    if let ContractKind::Pkwt { ends_on } = contract.kind() {
                        if ends_on >= effective {
                            rebuilt.push(
                                Contract::try_new(
                                    ContractKind::Pkwt {
                                        ends_on: effective - chrono::Duration::days(1),
                                    },
                                    contract.starts_on(),
                                    contract.position().clone(),
                                    contract.grade().clone(),
                                    contract.authorization().clone(),
                                )
                                .map_err(invalid)?,
                            );
                        }
                    }
                    // A permanent contract covered by the change is replaced,
                    // not closed: permanence has no end date to write.
                } else {
                    rebuilt.push(contract.clone());
                }
            }
            let contract = Contract::try_new(new_kind, effective, new_position, new_grade, auth)
                .map_err(invalid)?;
            let mut timeline = ContractTimeline::try_new(rebuilt)
                .map_err(|error| AppError::Conflict(error.to_string()))?;
            timeline
                .append(contract)
                .map_err(|error| AppError::Conflict(error.to_string()))?;
            infrastructure::replace_contracts(&state.db, &employee_id, &timeline).await?;

            // A promotion that also moves pay carries the new base.
            if let Some(base) = proposal.decided("base_minor").and_then(|v| v.as_i64()) {
                write_salary(state, &employee_id, &decider, effective, base, reason).await?;
            }
        }
        ChangeKind::Salary => {
            let base = proposal
                .decided("base_minor")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| {
                    AppError::Configuration(
                        "an approved salary change carries base_minor".to_owned(),
                    )
                })?;
            write_salary(state, &employee_id, &decider, effective, base, reason).await?;
        }
        ChangeKind::Separation => {
            let auth = authority(actions::EMPLOYMENT_CHANGE)?;
            record
                .employee
                .apply(
                    crate::cloud::domain::EmploymentTransition::Terminate,
                    effective,
                    auth,
                )
                .map_err(|error| AppError::Conflict(error.to_string()))?;
            // Persisting the termination opens the PENDING exit interview
            // (see `save_employee`); the checklist follows here.
            infrastructure::save_employee(&state.db, &record.employee).await?;
            infrastructure::create_task_set(&state.db, &employee_id, LifecycleKind::Separation)
                .await?;
        }
    }
    Ok(())
}

/// File the salary row a salary change or a promoted base asked for. The
/// standing allowances ride along unchanged: this proposal moves the base,
/// not the allowances.
async fn write_salary(
    state: &AppState,
    employee_id: &str,
    decider: &str,
    effective: NaiveDate,
    base_minor: i64,
    reason: &str,
) -> Result<(), AppError> {
    let auth = Authorization::try_new(decider, actions::PAY_CHANGE, Utc::now(), reason)
        .map_err(invalid)?;
    let timeline = infrastructure::pay_timeline(&state.db, employee_id).await?;
    // The standing allowances ride along from the agreement in force the day
    // before the new one starts. This proposal moves the base, not them.
    let current = timeline
        .on(effective)
        .or_else(|| timeline.on(effective - chrono::Duration::days(1)));
    let allowances = match current {
        Some(current) => current
            .allowances()
            .map(|(code, amount)| {
                crate::cloud::domain::FixedAllowance::try_new(code.clone(), amount).map_err(invalid)
            })
            .collect::<Result<Vec<_>, AppError>>()?,
        None => Vec::new(),
    };
    let record = crate::cloud::domain::PayRecord::try_new(
        effective,
        Money::new(base_minor),
        allowances,
        auth,
    )
    .map_err(invalid)?;
    infrastructure::agree_pay(&state.db, employee_id, &record).await
}

// ── the onboarding and separation checklist ──────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskListQuery {
    pub employee_id: Option<String>,
    pub kind: Option<String>,
    pub owner: Option<String>,
}

/// The checklist queue. A bounded caller sees their place's rows; the owner
/// filter is how an owner's to-do list is read.
pub async fn list_tasks(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<TaskListQuery>,
) -> Result<Json<Vec<LifecycleTaskView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let filter = place_filter(&state, &principal).await?;
    if let PlaceFilter::One(Some(_)) = &filter {
        if let Some(employee) = query.employee_id.as_deref() {
            let reach = reach_of(&state, &principal).await?;
            let record = infrastructure::load_employee(&state.db, employee)
                .await?
                .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
            match current_place(&record) {
                Some(p) => reach_covers(&reach, p, &principal.username)?,
                None => {
                    return Err(AppError::Forbidden(format!(
                        "{} is not posted anywhere, so nobody's reach covers them",
                        employee
                    )))
                }
            }
        }
    }
    let bound = match (&filter, query.employee_id.as_deref()) {
        // A reach of nowhere sees nobody's checklist — named or not. First,
        // because the arm below trusts a named employee to have been checked
        // against the caller's reach, and above that check runs only for a
        // reach of one place.
        (PlaceFilter::One(None), _) => return Ok(Json(Vec::new())),
        // A named employee is their own fence: the rows are theirs.
        (_, Some(_employee)) => None,
        (PlaceFilter::One(Some(place)), None) => Some(place.as_str()),
        (PlaceFilter::All, None) => None,
    };
    let rows = infrastructure::list_tasks(
        &state.db,
        query.employee_id.as_deref(),
        query.kind.as_deref(),
        query.owner.as_deref(),
        bound,
    )
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| LifecycleTaskView {
                id: r.id,
                employee_id: r.employee_id,
                kind: r.kind,
                template_id: r.template_id,
                label: r.label,
                owner: r.owner,
                position: r.position,
                state: r.state,
                done_by: r
                    .done
                    .as_ref()
                    .and_then(|v| v.get("actor").and_then(|a| a.as_str()).map(str::to_owned)),
            })
            .collect(),
    ))
}

fn access_place_check(
    record: &EmployeeRecord,
    username: &str,
    reach: &crate::cloud::domain::Reach,
) -> Result<(), AppError> {
    let place = current_place(record).map(ToOwned::to_owned);
    reach.covers(place.as_deref()).then_some(()).ok_or_else(|| {
        AppError::Forbidden(format!("{username} does not reach this person's place"))
    })
}

pub async fn task_history(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<LifecycleTaskView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        access.may_read(actions::EMPLOYEE_READ)?;
        let reach = reach_of(&state, &principal).await?;
        let record = infrastructure::load_employee(&state.db, access.employee_id.as_str())
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    let rows = infrastructure::list_tasks(
        &state.db,
        Some(access.employee_id.as_str()),
        None,
        None,
        None,
    )
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| LifecycleTaskView {
                id: r.id,
                employee_id: r.employee_id,
                kind: r.kind,
                template_id: r.template_id,
                label: r.label,
                owner: r.owner,
                position: r.position,
                state: r.state,
                done_by: r
                    .done
                    .as_ref()
                    .and_then(|v| v.get("actor").and_then(|a| a.as_str()).map(str::to_owned)),
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct CompleteTaskBody {
    pub reason: String,
}

/// Close one task by id. The key follows the task's owner: the employee's own
/// tasks close under the own key from the phone, store and head-office tasks
/// under the place key, IT tasks under head office's — a store cannot mark
/// somebody else's account provisioned.
pub async fn complete_task(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(task_id): Path<String>,
    Json(body): Json<CompleteTaskBody>,
) -> Result<Json<LifecycleTaskView>, AppError> {
    let tasks = infrastructure::list_tasks(&state.db, None, None, None, None).await?;
    let task = tasks
        .iter()
        .find(|t| t.id == task_id)
        .ok_or_else(|| AppError::NotFound(format!("task {task_id}")))?;
    let owner = TaskOwner::parse(&task.owner).ok_or_else(|| {
        AppError::Configuration("a template owner this build does not know".to_owned())
    })?;
    let (key, own_only) = match owner {
        TaskOwner::Employee => (actions::LIFECYCLE_COMPLETE_OWN, true),
        TaskOwner::It => (actions::LIFECYCLE_COMPLETE_IT, false),
        TaskOwner::Store | TaskOwner::HeadOffice => (actions::LIFECYCLE_COMPLETE, false),
    };
    require(&principal, key)?;
    let reach = reach_of(&state, &principal).await?;
    if own_only {
        let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
        if caller.employee_id.as_deref() != Some(task.employee_id.as_str()) {
            return Err(AppError::Forbidden(
                "an employee closes their own tasks and nobody else's".to_owned(),
            ));
        }
    } else {
        let record = infrastructure::load_employee(&state.db, &task.employee_id)
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    let done = authorize(&principal, key, &body.reason)?;
    let updated =
        infrastructure::complete_task(&state.db, &task_id, serde_json::to_value(&done)?).await?;
    if updated == 0 {
        return Err(AppError::Conflict("this task is already done".to_owned()));
    }
    Ok(Json(LifecycleTaskView {
        id: task.id.clone(),
        employee_id: task.employee_id.clone(),
        kind: task.kind.clone(),
        template_id: task.template_id.clone(),
        label: task.label.clone(),
        owner: task.owner.clone(),
        position: task.position,
        state: "DONE".to_owned(),
        done_by: Some(principal.username.clone()),
    }))
}

/// Open a checklist for one person: onboarding, or separation.
///
/// Head office's, because creating the set is a statement that somebody is
/// joining or leaving — the same act the hire route and the separation apply
/// each make automatically. This is the by-hand door for everybody the
/// machine did not see arrive.
pub async fn open_lifecycle(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<OpenLifecycleBody>,
) -> Result<Json<Vec<LifecycleTaskView>>, AppError> {
    require(&principal, actions::LIFECYCLE_MANAGE)?;
    let access = resolve(&state, &principal, &raw).await?;
    let kind = LifecycleKind::parse(&body.kind)
        .ok_or_else(|| invalid("kind is ONBOARDING or SEPARATION"))?;
    infrastructure::create_task_set(&state.db, access.employee_id.as_str(), kind).await?;
    let rows = infrastructure::list_tasks(
        &state.db,
        Some(access.employee_id.as_str()),
        Some(kind.as_str()),
        None,
        None,
    )
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| LifecycleTaskView {
                id: r.id,
                employee_id: r.employee_id,
                kind: r.kind,
                template_id: r.template_id,
                label: r.label,
                owner: r.owner,
                position: r.position,
                state: r.state,
                done_by: None,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct OpenLifecycleBody {
    pub kind: String,
}

/// The phone's door: close one of *your own* tasks by its template code, the
/// way the onboarding card names them.
pub async fn complete_own_task(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(template_id): Path<String>,
    Json(body): Json<CompleteTaskBody>,
) -> Result<Json<LifecycleTaskView>, AppError> {
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let employee_id = caller.employee_id.ok_or_else(|| {
        AppError::NotFound("no employment record is bound to this login".to_owned())
    })?;
    let tasks = infrastructure::list_tasks(&state.db, Some(&employee_id), None, None, None).await?;
    let task = tasks
        .iter()
        .find(|t| t.template_id == template_id)
        .ok_or_else(|| AppError::NotFound(format!("no task {template_id} on your checklist")))?;
    require(&principal, actions::LIFECYCLE_COMPLETE_OWN)?;
    let done = authorize(&principal, actions::LIFECYCLE_COMPLETE_OWN, &body.reason)?;
    let updated =
        infrastructure::complete_task(&state.db, &task.id, serde_json::to_value(&done)?).await?;
    if updated == 0 {
        return Err(AppError::Conflict("this task is already done".to_owned()));
    }
    Ok(Json(LifecycleTaskView {
        id: task.id.clone(),
        employee_id: task.employee_id.clone(),
        kind: task.kind.clone(),
        template_id: task.template_id.clone(),
        label: task.label.clone(),
        owner: task.owner.clone(),
        position: task.position,
        state: "DONE".to_owned(),
        done_by: Some(principal.username.clone()),
    }))
}

// ── the recruitment pipeline ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct PlanBody {
    pub place_id: String,
    pub position: String,
    pub span: String,
    pub headcount: u32,
    pub cost_minor: i64,
    pub reason: String,
}

pub async fn define_plan(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<PlanBody>,
) -> Result<Json<Vec<StaffingPlanView>>, AppError> {
    require(&principal, actions::RECRUITMENT_MANAGE)?;
    let defined = authorize(&principal, actions::RECRUITMENT_MANAGE, &body.reason)?;
    let plan = StaffingPlan::define(
        PlaceId::try_new(&body.place_id).map_err(invalid)?,
        &body.position,
        &body.span,
        body.headcount,
        body.cost_minor,
        defined,
    )
    .map_err(invalid)?;
    infrastructure::upsert_plan(&state.db, &plan).await?;
    plan_list(&state, None, None).await
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanQuery {
    pub place_id: Option<String>,
    pub span: Option<String>,
}

pub async fn list_plans(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PlanQuery>,
) -> Result<Json<Vec<StaffingPlanView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let filter = place_filter(&state, &principal).await?;
    let requested = query.place_id.as_deref();
    if let (PlaceFilter::One(Some(place)), Some(requested)) = (&filter, requested) {
        if place != requested {
            return Err(AppError::Forbidden(format!(
                "{} does not reach {requested}",
                principal.username
            )));
        }
    }
    let bound = match (&filter, requested) {
        (PlaceFilter::One(Some(place)), _) => Some(place.as_str()),
        (PlaceFilter::All, requested) => requested,
        (PlaceFilter::One(None), _) => return Ok(Json(Vec::new())),
    };
    plan_list(&state, bound, query.span.as_deref()).await
}

async fn plan_list(
    state: &AppState,
    place: Option<&str>,
    span: Option<&str>,
) -> Result<Json<Vec<StaffingPlanView>>, AppError> {
    let rows = infrastructure::list_plans(&state.db, place, span).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| StaffingPlanView {
                id: r.id,
                place_id: r.place_id,
                position: r.position,
                span: r.span,
                headcount: r.headcount,
                cost_minor: r.cost_minor,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplicantQuery {
    pub proposal_id: Option<String>,
    pub stage: Option<String>,
}

pub async fn list_applicants(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ApplicantQuery>,
) -> Result<Json<Vec<ApplicantView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let filter = place_filter(&state, &principal).await?;
    let rows = infrastructure::list_applicants(
        &state.db,
        query.proposal_id.as_deref(),
        query.stage.as_deref(),
    )
    .await?;
    let rows: Vec<_> = match &filter {
        PlaceFilter::All => rows,
        PlaceFilter::One(None) => Vec::new(),
        PlaceFilter::One(Some(place)) => rows
            .into_iter()
            .filter(|a| a.place_id.as_str() == place)
            .collect(),
    };
    Ok(Json(rows.iter().map(applicant_view).collect()))
}

fn applicant_view(applicant: &JobApplicant) -> ApplicantView {
    ApplicantView {
        id: applicant.id.clone(),
        proposal_id: applicant.proposal_id.clone(),
        place_id: applicant.place_id.as_str().to_owned(),
        name: applicant.name.clone(),
        phone: applicant.phone.clone(),
        source: applicant.source.clone(),
        referrer_employee_id: applicant
            .referrer_employee_id
            .as_ref()
            .map(|e| e.as_str().to_owned()),
        stage: applicant.stage.as_str().to_owned(),
        stage_note: applicant.stage_note.clone(),
        applied_on: applicant.applied_on.to_string(),
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct FileApplicantBody {
    pub name: String,
    pub phone: Option<String>,
    pub source: String,
    pub referrer_employee_id: Option<String>,
}

/// File an applicant against a requisition. The shop that asked for the
/// person records who walked in; head office screens from here.
pub async fn file_applicant(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(proposal_id): Path<String>,
    Json(body): Json<FileApplicantBody>,
) -> Result<Json<ApplicantView>, AppError> {
    require(&principal, actions::HIRE_PROPOSAL_READ)?;
    let reach = reach_of(&state, &principal).await?;
    let proposal = infrastructure::load_hire_proposal(&state.db, &proposal_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("requisition {proposal_id}")))?;
    let place = proposal.proposal.place().as_str();
    reach_covers(&reach, place, &principal.username)?;
    let referrer = body
        .referrer_employee_id
        .map(|r| EmployeeId::try_new(&r))
        .transpose()
        .map_err(invalid)?;
    let applicant = JobApplicant::file(
        proposal_id,
        PlaceId::try_new(place).map_err(invalid)?,
        &body.name,
        body.phone,
        &body.source,
        referrer,
        Utc::now().date_naive(),
    )
    .map_err(invalid)?;
    infrastructure::insert_applicant(&state.db, &applicant).await?;
    Ok(Json(applicant_view(&applicant)))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct StageBody {
    pub stage: String,
    pub note: Option<String>,
    pub reason: String,
}

/// Move the funnel. Reaching `OFFER` without an offer row is refused: the
/// stage says an offer exists, so the row has to.
pub async fn move_stage(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(applicant_id): Path<String>,
    Json(body): Json<StageBody>,
) -> Result<Json<ApplicantView>, AppError> {
    require(&principal, actions::RECRUITMENT_MANAGE)?;
    let _ = authorize(&principal, actions::RECRUITMENT_MANAGE, &body.reason)?;
    let mut applicant = infrastructure::load_applicant(&state.db, &applicant_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("applicant {applicant_id}")))?;
    let stage = ApplicantStage::parse(&body.stage)
        .ok_or_else(|| invalid("stage is NEW, SHORTLIST, INTERVIEW, OFFER, HIRED or REJECTED"))?;
    if stage == ApplicantStage::Hired {
        return Err(AppError::Validation(
            "an applicant is hired through the offer route, not the funnel".to_owned(),
        ));
    }
    if stage == ApplicantStage::Offer {
        infrastructure::offer_for_applicant(&state.db, &applicant_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation("make the offer before moving them to OFFER".to_owned())
            })?;
    }
    applicant.move_to(stage, body.note).map_err(invalid)?;
    infrastructure::update_applicant(&state.db, &applicant).await?;
    Ok(Json(applicant_view(&applicant)))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct ScheduleInterviewBody {
    pub scheduled_at: String,
    pub interviewer_employee_id: String,
    pub reason: String,
}

/// The conversations one applicant has had, or has scheduled.
///
/// Read by whoever may interview at the place: the store head needs the
/// history on the phone before deciding a pass or a fail.
pub async fn list_interviews_for_applicant(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(applicant_id): Path<String>,
) -> Result<Json<Vec<InterviewView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let reach = reach_of(&state, &principal).await?;
    let applicant = infrastructure::load_applicant(&state.db, &applicant_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("applicant {applicant_id}")))?;
    reach_covers(&reach, applicant.place_id.as_str(), &principal.username)?;
    let rows = infrastructure::list_interviews(&state.db, &applicant_id).await?;
    Ok(Json(rows.iter().map(interview_view).collect()))
}

/// Put a conversation on the calendar. The store head's, bounded by reach —
/// they are the one who conducts it.
pub async fn schedule_interview(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(applicant_id): Path<String>,
    Json(body): Json<ScheduleInterviewBody>,
) -> Result<Json<InterviewView>, AppError> {
    require(&principal, actions::RECRUITMENT_INTERVIEW)?;
    let reach = reach_of(&state, &principal).await?;
    let applicant = infrastructure::load_applicant(&state.db, &applicant_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("applicant {applicant_id}")))?;
    reach_covers(&reach, applicant.place_id.as_str(), &principal.username)?;
    let recorded = authorize(&principal, actions::RECRUITMENT_INTERVIEW, &body.reason)?;
    let scheduled_at: DateTime<Utc> = body
        .scheduled_at
        .parse()
        .map_err(|_| invalid("scheduled_at is an RFC 3339 timestamp"))?;
    let interview = ApplicantInterview::schedule(
        applicant_id,
        scheduled_at,
        EmployeeId::try_new(&body.interviewer_employee_id).map_err(invalid)?,
        recorded,
    );
    infrastructure::insert_interview(&state.db, &interview).await?;
    Ok(Json(interview_view(&interview)))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct InterviewResultBody {
    pub result: String,
    pub ratings: BTreeMap<String, u8>,
    pub note: Option<String>,
    pub reason: String,
}

/// Record how the conversation went. A pass carries the ratings it passed on.
pub async fn record_interview(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(interview_id): Path<String>,
    Json(body): Json<InterviewResultBody>,
) -> Result<Json<InterviewView>, AppError> {
    require(&principal, actions::RECRUITMENT_INTERVIEW)?;
    let mut interview = infrastructure::load_applicant_interview(&state.db, &interview_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("interview {interview_id}")))?;
    let reach = reach_of(&state, &principal).await?;
    let applicant = infrastructure::load_applicant(&state.db, &interview.applicant_id)
        .await?
        .ok_or_else(|| AppError::Configuration("an interview names a live applicant".to_owned()))?;
    reach_covers(&reach, applicant.place_id.as_str(), &principal.username)?;
    let result = match body.result.as_str() {
        "PASS" => InterviewResult::Pass,
        "FAIL" => InterviewResult::Fail,
        _ => return Err(invalid("result is PASS or FAIL")),
    };
    interview
        .record(result, body.ratings, body.note, &principal.username)
        .map_err(invalid)?;
    infrastructure::update_interview(&state.db, &interview).await?;
    Ok(Json(interview_view(&interview)))
}

fn interview_view(interview: &ApplicantInterview) -> InterviewView {
    InterviewView {
        id: interview.id.clone(),
        applicant_id: interview.applicant_id.clone(),
        scheduled_at: interview.scheduled_at.to_rfc3339(),
        interviewer_employee_id: interview.interviewer_employee_id.as_str().to_owned(),
        result: match interview.result {
            InterviewResult::Scheduled => "SCHEDULED",
            InterviewResult::Pass => "PASS",
            InterviewResult::Fail => "FAIL",
        }
        .to_owned(),
        ratings: interview.ratings.clone(),
        note: interview.note.clone(),
        recorded_by: interview.recorded.actor().as_str().to_owned(),
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct MakeOfferBody {
    pub base_minor: i64,
    pub grade: String,
    pub starts_on: String,
    pub term: String,
    pub reason: String,
}

/// Make the offer. Head office's: the grade and the base are the employer's
/// decision, checked by the person who holds the pen.
pub async fn make_offer(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(applicant_id): Path<String>,
    Json(body): Json<MakeOfferBody>,
) -> Result<Json<OfferView>, AppError> {
    require(&principal, actions::RECRUITMENT_MANAGE)?;
    let offered = authorize(&principal, actions::RECRUITMENT_MANAGE, &body.reason)?;
    // The applicant must exist: an offer names a person, not an id.
    infrastructure::load_applicant(&state.db, &applicant_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("applicant {applicant_id}")))?;
    if infrastructure::offer_for_applicant(&state.db, &applicant_id)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict(
            "this applicant already has an offer".to_owned(),
        ));
    }
    let starts_on: NaiveDate = body
        .starts_on
        .parse()
        .map_err(|_| invalid("starts_on is not a date"))?;
    let offer = JobOffer::make(
        applicant_id,
        body.base_minor,
        &body.grade,
        starts_on,
        &body.term,
        offered,
    )
    .map_err(invalid)?;
    infrastructure::insert_offer(&state.db, &offer).await?;
    Ok(Json(offer_view(&offer)))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct OfferDecisionBody {
    pub accepted: bool,
    pub reason: String,
}

/// Record the candidate's answer.
pub async fn decide_offer(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(offer_id): Path<String>,
    Json(body): Json<OfferDecisionBody>,
) -> Result<Json<OfferView>, AppError> {
    require(&principal, actions::RECRUITMENT_MANAGE)?;
    let decided = authorize(&principal, actions::RECRUITMENT_MANAGE, &body.reason)?;
    let mut offer = infrastructure::load_offer(&state.db, &offer_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("offer {offer_id}")))?;
    offer
        .decide(
            body.accepted,
            Decision {
                authorization: decided,
                note: None,
            },
        )
        .map_err(invalid)?;
    infrastructure::update_offer(&state.db, &offer).await?;
    // A decline closes the funnel for this name.
    if !body.accepted {
        if let Some(mut applicant) =
            infrastructure::load_applicant(&state.db, &offer.applicant_id).await?
        {
            let _ = applicant.move_to(ApplicantStage::Rejected, Some("offer declined".to_owned()));
            infrastructure::update_applicant(&state.db, &applicant).await?;
        }
    }
    Ok(Json(offer_view(&offer)))
}

pub async fn list_offers(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<OfferView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let filter = place_filter(&state, &principal).await?;
    let offers = infrastructure::list_offers(&state.db).await?;
    let offers = match &filter {
        PlaceFilter::All => offers,
        PlaceFilter::One(None) => Vec::new(),
        PlaceFilter::One(Some(place)) => {
            let mut kept = Vec::new();
            for offer in offers {
                let belongs =
                    match infrastructure::load_applicant(&state.db, &offer.applicant_id).await? {
                        Some(applicant) => applicant.place_id.as_str() == place,
                        None => false,
                    };
                if belongs {
                    kept.push(offer);
                }
            }
            kept
        }
    };
    Ok(Json(offers.iter().map(offer_view).collect()))
}

fn offer_view(offer: &JobOffer) -> OfferView {
    OfferView {
        id: offer.id.clone(),
        applicant_id: offer.applicant_id.clone(),
        base_minor: offer.base_minor,
        grade: offer.grade.clone(),
        starts_on: offer.starts_on.to_string(),
        term: offer.term.clone(),
        state: match offer.state {
            OfferState::Waiting => "WAITING",
            OfferState::Accepted => "ACCEPTED",
            OfferState::Declined => "DECLINED",
            OfferState::Withdrawn => "WITHDRAWN",
        }
        .to_owned(),
        offered_by: offer.offered.actor().as_str().to_owned(),
        decided_by: offer
            .decided
            .as_ref()
            .map(|d| d.authorization.actor().as_str().to_owned()),
        hired_employee_id: offer
            .hired_employee_id
            .as_ref()
            .map(|e| e.as_str().to_owned()),
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct HireBody {
    pub reason: String,
}

/// Turn an accepted offer into an employment record.
///
/// The same hand-off the hire proposal's `open_employment` makes, from the
/// offer instead of the proposal: `Employee::register` mints the candidate,
/// the assignment posts them where the offer said, and the checklist every
/// new joiner works through opens with the record. The `HIRE` event still
/// waits for the day they actually start, on the route that has always
/// recorded it.
pub async fn hire_offer(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(offer_id): Path<String>,
    Json(body): Json<HireBody>,
) -> Result<Json<OfferView>, AppError> {
    require(&principal, actions::RECRUITMENT_MANAGE)?;
    let _ = authorize(&principal, actions::RECRUITMENT_MANAGE, &body.reason)?;
    let mut offer = infrastructure::load_offer(&state.db, &offer_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("offer {offer_id}")))?;
    if offer.state != OfferState::Accepted {
        return Err(AppError::Conflict(
            "only an accepted offer hires".to_owned(),
        ));
    }
    let applicant = infrastructure::load_applicant(&state.db, &offer.applicant_id)
        .await?
        .ok_or_else(|| AppError::Configuration("an offer names a live applicant".to_owned()))?;

    let employee_id =
        EmployeeId::try_new(&format!("emp_{}", uuid::Uuid::new_v4().simple())).map_err(invalid)?;
    let code = format!("ITL-{}", employee_id.as_str()[4..12].to_uppercase());
    let employee = Employee::try_register(employee_id.as_str(), &code).map_err(invalid)?;
    infrastructure::register_employee(&state.db, &employee).await?;

    let auth = Authorization::try_new(
        &principal.username,
        actions::ASSIGNMENT_MANAGE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    let mut timeline = AssignmentTimeline::new();
    timeline
        .push(
            AssignmentSpan::try_new(applicant.place_id.clone(), offer.starts_on, None, auth)
                .map_err(invalid)?,
        )
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::replace_assignments(&state.db, employee_id.as_str(), &timeline).await?;

    // The checklist a new joiner works through, opening with the record.
    infrastructure::create_task_set(&state.db, employee_id.as_str(), LifecycleKind::Onboarding)
        .await?;

    offer.mark_hired(employee_id).map_err(invalid)?;
    infrastructure::update_offer(&state.db, &offer).await?;
    let mut applicant = applicant;
    applicant
        .move_to(
            ApplicantStage::Hired,
            Some("offer accepted and hired".to_owned()),
        )
        .map_err(invalid)?;
    infrastructure::update_applicant(&state.db, &applicant).await?;
    Ok(Json(offer_view(&offer)))
}

// ── performance ──────────────────────────────────────────────────────────

pub async fn performance_templates(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<TemplateQuery>,
) -> Result<Json<Vec<PerformanceTemplateView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let rows =
        infrastructure::list_performance_templates(&state.db, query.position.as_deref()).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| PerformanceTemplateView {
                position: r.position,
                metric: r.metric,
                weight: r.weight,
                source: r.source,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TemplateQuery {
    pub position: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScoreQuery {
    pub period: Option<String>,
    pub place_id: Option<String>,
}

/// The month's board. Bounded by reach like every team read.
pub async fn list_scores(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ScoreQuery>,
) -> Result<Json<Vec<PerformanceScoreView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let period: Option<NaiveDate> = query
        .period
        .as_deref()
        .map(|p| p.parse())
        .transpose()
        .map_err(|_| invalid("period is a date, the first of its month"))?;
    let filter = place_filter(&state, &principal).await?;
    if let (PlaceFilter::One(Some(place)), Some(requested)) = (&filter, query.place_id.as_deref()) {
        if place != requested {
            return Err(AppError::Forbidden(format!(
                "{} does not reach {requested}",
                principal.username
            )));
        }
    }
    let bound = match (&filter, query.place_id.as_deref()) {
        (PlaceFilter::One(Some(place)), _) => Some(place.as_str()),
        (PlaceFilter::All, requested) => requested,
        (PlaceFilter::One(None), _) => return Ok(Json(Vec::new())),
    };
    let rows = infrastructure::list_scores(&state.db, None, period, bound).await?;
    let tiers = bonus_tiers(&state).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                let bonus_rate_pct = tier_for(&tiers, r.kpi_pct);
                PerformanceScoreView {
                    employee_id: r.employee_id,
                    period: r.period.to_string(),
                    kpi_pct: r.kpi_pct,
                    manager_score: r.manager_score,
                    note: r.note,
                    recorded_by: r
                        .recorded
                        .get("actor")
                        .and_then(|a| a.as_str())
                        .unwrap_or_default()
                        .to_owned(),
                    bonus_rate_pct,
                }
            })
            .collect(),
    ))
}

#[derive(Debug, Clone, Copy)]
struct BonusTiers {
    t1_kpi: f64,
    t1_rate: f64,
    t2_kpi: f64,
    t2_rate: f64,
}

async fn bonus_tiers(state: &AppState) -> Result<BonusTiers, AppError> {
    Ok(BonusTiers {
        t1_kpi: infrastructure::policy_value(&state.db, "pay.bonus_tier1_min_kpi")
            .await?
            .unwrap_or(100.0),
        t1_rate: infrastructure::policy_value(&state.db, "pay.bonus_tier1_rate")
            .await?
            .unwrap_or(0.0),
        t2_kpi: infrastructure::policy_value(&state.db, "pay.bonus_tier2_min_kpi")
            .await?
            .unwrap_or(110.0),
        t2_rate: infrastructure::policy_value(&state.db, "pay.bonus_tier2_rate")
            .await?
            .unwrap_or(0.0),
    })
}

fn tier_for(tiers: &BonusTiers, kpi: f64) -> f64 {
    if kpi >= tiers.t2_kpi {
        tiers.t2_rate
    } else if kpi >= tiers.t1_kpi {
        tiers.t1_rate
    } else {
        0.0
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct RecordScoreBody {
    pub kpi_pct: f64,
    pub manager_score: u8,
    pub note: Option<String>,
    pub reason: String,
}

/// Record one person's month. The store head's, bounded by reach — it is
/// their judgement the figure records.
pub async fn record_score(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw, period)): Path<(String, String)>,
    Json(body): Json<RecordScoreBody>,
) -> Result<Json<PerformanceScoreView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PERFORMANCE_RECORD)?;
    if !access.own {
        let reach = reach_of(&state, &principal).await?;
        let record = infrastructure::load_employee(&state.db, access.employee_id.as_str())
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    let period: NaiveDate = period
        .parse()
        .map_err(|_| invalid("period is a date, the first of its month"))?;
    let recorded = access.authorize(actions::PERFORMANCE_RECORD, &body.reason)?;
    let score = PerformanceScore::record(
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        period,
        body.kpi_pct,
        body.manager_score,
        body.note,
        recorded,
    )
    .map_err(invalid)?;
    infrastructure::upsert_score(&state.db, &score).await?;
    let tiers = bonus_tiers(&state).await?;
    Ok(Json(PerformanceScoreView {
        employee_id: score.employee_id.as_str().to_owned(),
        period: score.period.to_string(),
        kpi_pct: score.kpi_pct,
        manager_score: score.manager_score as i32,
        note: score.note,
        recorded_by: score.recorded.actor().as_str().to_owned(),
        bonus_rate_pct: tier_for(&tiers, score.kpi_pct),
    }))
}

pub async fn my_scores(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<PerformanceScoreView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        access.may_read(actions::EMPLOYEE_READ)?;
        let reach = reach_of(&state, &principal).await?;
        let record = infrastructure::load_employee(&state.db, access.employee_id.as_str())
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    let rows =
        infrastructure::list_scores(&state.db, Some(access.employee_id.as_str()), None, None)
            .await?;
    let tiers = bonus_tiers(&state).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| PerformanceScoreView {
                employee_id: r.employee_id,
                period: r.period.to_string(),
                kpi_pct: r.kpi_pct,
                manager_score: r.manager_score,
                note: r.note,
                recorded_by: r
                    .recorded
                    .get("actor")
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .to_owned(),
                bonus_rate_pct: tier_for(&tiers, r.kpi_pct),
            })
            .collect(),
    ))
}

// ── training ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct DefineTrainingBody {
    pub title: String,
    pub on_date: String,
    pub place: String,
    pub cost_minor: i64,
    pub reason: String,
}

pub async fn define_training(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<DefineTrainingBody>,
) -> Result<Json<Vec<TrainingProgramView>>, AppError> {
    require(&principal, actions::TRAINING_MANAGE)?;
    let defined = authorize(&principal, actions::TRAINING_MANAGE, &body.reason)?;
    let on_date: NaiveDate = body
        .on_date
        .parse()
        .map_err(|_| invalid("on_date is not a date"))?;
    let program =
        TrainingProgram::define(&body.title, on_date, &body.place, body.cost_minor, defined)
            .map_err(invalid)?;
    infrastructure::insert_program(&state.db, &program).await?;
    training_list(&state).await
}

pub async fn list_training(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<TrainingProgramView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    training_list(&state).await
}

async fn training_list(state: &AppState) -> Result<Json<Vec<TrainingProgramView>>, AppError> {
    let rows = infrastructure::list_programs(&state.db).await?;
    let mut views = Vec::new();
    for r in rows {
        let participants = infrastructure::list_participants(&state.db, Some(&r.id), None)
            .await?
            .len() as i64;
        views.push(TrainingProgramView {
            id: r.id,
            title: r.title,
            on_date: r.on_date.to_string(),
            place: r.place,
            cost_minor: r.cost_minor,
            state: r.state,
            participants,
        });
    }
    Ok(Json(views))
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct NominateBody {
    pub employee_id: String,
    pub reason: String,
}

/// Nominate somebody. Head office, or the place's own people under reach.
pub async fn nominate(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(program_id): Path<String>,
    Json(body): Json<NominateBody>,
) -> Result<Json<TrainingProgramView>, AppError> {
    let supervisor_run = role_allows(
        required_role_for_action(actions::TRAINING_NOMINATE),
        principal.role,
    );
    let admin_run = role_allows(
        required_role_for_action(actions::TRAINING_MANAGE),
        principal.role,
    );
    if !supervisor_run && !admin_run {
        return Err(AppError::Forbidden(format!(
            "{} may not nominate anybody for training",
            principal.username
        )));
    }
    if !admin_run {
        // Supervisor: bounded to their own places.
        let reach = reach_of(&state, &principal).await?;
        let record = infrastructure::load_employee(&state.db, &body.employee_id)
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    let nominated = authorize(
        &principal,
        if admin_run {
            actions::TRAINING_MANAGE
        } else {
            actions::TRAINING_NOMINATE
        },
        &body.reason,
    )?;
    infrastructure::add_participant(
        &state.db,
        &program_id,
        &body.employee_id,
        serde_json::to_value(&nominated)?,
    )
    .await?;
    let programs = training_list(&state).await?;
    programs
        .0
        .into_iter()
        .find(|p| p.id == program_id)
        .ok_or_else(|| AppError::NotFound(format!("program {program_id}")))
        .map(Json)
}

pub async fn complete_training(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(program_id): Path<String>,
) -> Result<Json<Vec<TrainingProgramView>>, AppError> {
    require(&principal, actions::TRAINING_MANAGE)?;
    infrastructure::complete_program(&state.db, &program_id).await?;
    training_list(&state).await
}

// ── benefits ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct UniformBody {
    pub issued_on: String,
    pub sets: u8,
    pub reason: String,
}

/// Record a uniform handover. The store's, bounded by reach.
pub async fn record_uniform(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<UniformBody>,
) -> Result<Json<Vec<UniformIssuanceView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::BENEFIT_RECORD)?;
    if !access.own {
        let reach = reach_of(&state, &principal).await?;
        let record = infrastructure::load_employee(&state.db, access.employee_id.as_str())
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    let issued_on: NaiveDate = body
        .issued_on
        .parse()
        .map_err(|_| invalid("issued_on is not a date"))?;
    let recorded = access.authorize(actions::BENEFIT_RECORD, &body.reason)?;
    let issuance = UniformIssuance::record(
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        issued_on,
        body.sets,
        recorded,
    )
    .map_err(invalid)?;
    infrastructure::insert_uniform(&state.db, &issuance).await?;
    uniform_list(&state, access.employee_id.as_str()).await
}

pub async fn uniform_history(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<UniformIssuanceView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    if !access.own {
        access.may_read(actions::EMPLOYEE_READ)?;
        let reach = reach_of(&state, &principal).await?;
        let record = infrastructure::load_employee(&state.db, access.employee_id.as_str())
            .await?
            .ok_or_else(|| AppError::NotFound("employee not found".to_owned()))?;
        access_place_check(&record, &principal.username, &reach)?;
    }
    uniform_list(&state, access.employee_id.as_str()).await
}

async fn uniform_list(
    state: &AppState,
    employee_id: &str,
) -> Result<Json<Vec<UniformIssuanceView>>, AppError> {
    let rows = infrastructure::list_uniform(&state.db, employee_id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| UniformIssuanceView {
                id: r.id,
                employee_id: r.employee_id,
                issued_on: r.issued_on.to_string(),
                sets: r.sets,
                recorded_by: r
                    .recorded
                    .get("actor")
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .to_owned(),
            })
            .collect(),
    ))
}

// ── the rule numbers and the org masters ─────────────────────────────────

pub async fn read_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<PolicyQuery>,
) -> Result<Json<Vec<PolicyView>>, AppError> {
    // Any signed-in reader: a rule kept from the people it governs is a trap.
    let _ = &principal;
    let rows = infrastructure::list_policy(&state.db, query.group.as_deref()).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| PolicyView {
                key: r.key,
                group: r.group_,
                label: r.label,
                value: r.value,
                unit: r.unit,
                updated_by: r
                    .updated
                    .get("by")
                    .and_then(|a| a.as_str())
                    .map(str::to_owned),
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyQuery {
    pub group: Option<String>,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(deny_unknown_fields)]
pub struct PolicySetBody {
    pub value: f64,
    pub reason: String,
}

/// Change one rule number. Head office's, and the change records who and why.
pub async fn set_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(key): Path<String>,
    Json(body): Json<PolicySetBody>,
) -> Result<Json<Vec<PolicyView>>, AppError> {
    require(&principal, actions::POLICY_SET)?;
    if !(body.value.is_finite()) || body.value < 0.0 {
        return Err(invalid("a rule number is finite and not negative"));
    }
    let updated = authorize(&principal, actions::POLICY_SET, &body.reason)?;
    infrastructure::update_policy(
        &state.db,
        &key,
        body.value,
        serde_json::json!({"by": updated.actor().as_str(), "reason": body.reason, "at": Utc::now()}),
    )
    .await?;
    let group = infrastructure::list_policy(&state.db, None)
        .await?
        .into_iter()
        .find(|r| r.key == key)
        .map(|r| r.group_);
    let rows = infrastructure::list_policy(&state.db, group.as_deref()).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| PolicyView {
                key: r.key,
                group: r.group_,
                label: r.label,
                value: r.value,
                unit: r.unit,
                updated_by: r
                    .updated
                    .get("by")
                    .and_then(|a| a.as_str())
                    .map(str::to_owned),
            })
            .collect(),
    ))
}

pub async fn org_grades(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<GradeView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let rows = infrastructure::list_grades(&state.db).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| GradeView {
                code: r.code,
                floor_minor: r.floor_minor,
                ceiling_minor: r.ceiling_minor,
            })
            .collect(),
    ))
}

pub async fn org_positions(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<PositionView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let rows = infrastructure::list_positions(&state.db).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| PositionView {
                name: r.name,
                grade_floor: r.grade_floor,
                grade_ceiling: r.grade_ceiling,
                structure: r.structure,
            })
            .collect(),
    ))
}

pub async fn org_structures(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<StructureView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    let rows = infrastructure::list_structures(&state.db).await?;
    let components = infrastructure::list_structure_components(&state.db).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| StructureView {
                components: components
                    .iter()
                    .filter(|c| c.structure == r.code)
                    .map(|c| c.component_code.clone())
                    .collect(),
                code: r.code,
                name: r.name,
                bonus_cap_policy: r.bonus_cap_policy,
            })
            .collect(),
    ))
}

/// Who else is planned this week at the caller's own place.
///
/// The swap picker's feed. Deliberately narrow — names and shift plans for
/// the caller's own place, and nothing else: a cashier choosing whom to swap
/// a Saturday with is entitled to that much and not to the workforce list.
/// There is no action key because there is no act; the bound is the caller's
/// own posting, read the way `/employees/me/reach` reads it.
pub async fn colleagues(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ColleaguesQuery>,
) -> Result<Json<Vec<ColleagueView>>, AppError> {
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let Some(employee_id) = caller.employee_id else {
        return Err(AppError::NotFound(
            "no employment record is bound to this login".to_owned(),
        ));
    };
    let record = infrastructure::load_employee(&state.db, &employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {employee_id}")))?;
    let place = current_place(&record)
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            AppError::Conflict(
                "you are not posted anywhere, so nobody is your colleague".to_owned(),
            )
        })?;
    let rows = infrastructure::colleagues_at(&state.db, &place, &employee_id, query.from, query.to)
        .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| ColleagueView {
                employee_id: r.employee_id,
                name: r.name,
                days: r
                    .days
                    .into_iter()
                    .map(|d| ColleagueDayView {
                        on_date: d.on_date.to_string(),
                        plan: d.plan,
                    })
                    .collect(),
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColleaguesQuery {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColleagueDayView {
    pub on_date: String,
    /// The plan word: SCHEDULED, REST_DAY or PUBLIC_HOLIDAY, plus the shift
    /// name when one is planned.
    pub plan: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColleagueView {
    pub employee_id: String,
    pub name: String,
    pub days: Vec<ColleagueDayView>,
}

// ── the lane ─────────────────────────────────────────────────────────────

/// Every route this module serves, added in one call rather than spliced
/// into the main builder — the same convention the other lanes follow, for
/// the same reason.
pub fn lane_p_routes(router: axum::Router<AppState>) -> axum::Router<AppState> {
    use axum::routing::{get, post, put};
    router
        // Roster swaps: file your own, decide your place's, read your own.
        .route("/api/v1/roster-swaps", post(file_swap))
        .route("/api/v1/roster-swaps/pending", get(pending_swaps))
        .route("/api/v1/roster-swaps/{id}/decision", post(decide_swap))
        .route("/api/v1/roster-swaps/{id}/withdrawal", post(withdraw_swap))
        .route("/api/v1/employees/{id}/roster-swaps", get(swap_history))
        .route("/api/v1/employees/me/colleagues", get(colleagues))
        // Employment change proposals: the shop files, head office decides
        // and the kernels write.
        .route(
            "/api/v1/employees/{id}/change-proposals",
            get(change_history).post(file_change),
        )
        .route("/api/v1/change-proposals", get(list_changes))
        .route(
            "/api/v1/change-proposals/{id}/decision",
            post(decide_change),
        )
        .route(
            "/api/v1/change-proposals/{id}/withdrawal",
            post(withdraw_change),
        )
        // The onboarding and separation checklist.
        .route("/api/v1/lifecycle/tasks", get(list_tasks))
        .route(
            "/api/v1/lifecycle/tasks/{id}/completion",
            post(complete_task),
        )
        .route(
            "/api/v1/employees/{id}/lifecycle-tasks",
            get(task_history).post(open_lifecycle),
        )
        .route(
            "/api/v1/employees/me/lifecycle-tasks/{template_id}/completion",
            post(complete_own_task),
        )
        // The recruitment pipeline.
        .route(
            "/api/v1/recruitment/plans",
            get(list_plans).post(define_plan),
        )
        .route("/api/v1/recruitment/applicants", get(list_applicants))
        .route(
            "/api/v1/recruitment/proposals/{id}/applicants",
            post(file_applicant),
        )
        .route(
            "/api/v1/recruitment/applicants/{id}/stage",
            post(move_stage),
        )
        .route(
            "/api/v1/recruitment/applicants/{id}/interviews",
            get(list_interviews_for_applicant).post(schedule_interview),
        )
        .route(
            "/api/v1/recruitment/interviews/{id}/result",
            post(record_interview),
        )
        .route(
            "/api/v1/recruitment/applicants/{id}/offer",
            post(make_offer),
        )
        .route("/api/v1/recruitment/offers", get(list_offers))
        .route(
            "/api/v1/recruitment/offers/{id}/decision",
            post(decide_offer),
        )
        .route("/api/v1/recruitment/offers/{id}/hire", post(hire_offer))
        // Performance.
        .route("/api/v1/performance/templates", get(performance_templates))
        .route("/api/v1/performance/scores", get(list_scores))
        .route(
            "/api/v1/employees/{id}/performance/{period}",
            put(record_score),
        )
        .route("/api/v1/employees/{id}/performance", get(my_scores))
        // Training.
        .route(
            "/api/v1/training-programs",
            get(list_training).post(define_training),
        )
        .route(
            "/api/v1/training-programs/{id}/participants",
            post(nominate),
        )
        .route(
            "/api/v1/training-programs/{id}/completion",
            post(complete_training),
        )
        // Benefits.
        .route(
            "/api/v1/employees/{id}/uniform-issuances",
            get(uniform_history).post(record_uniform),
        )
        // The rule numbers and the org masters.
        .route("/api/v1/people-policy", get(read_policy))
        .route("/api/v1/people-policy/{key}", put(set_policy))
        .route("/api/v1/org/grades", get(org_grades))
        .route("/api/v1/org/positions", get(org_positions))
        .route("/api/v1/org/structures", get(org_structures))
}
