//! Ordering overtime, and answering an order.
//!
//! # The two keys are two routes, and neither route accepts the other's key
//!
//! PP 35/2021 art. 26(2) wants two written acts from two people. That holds only
//! if the transport keeps them apart, so `POST .../overtime-orders` is gated on
//! `people.overtime.order` and `POST .../consent` on
//! `people.overtime.consent_own`, and the two key sets are disjoint. A
//! supervisor holding the ordering key reaches the consent route and is refused;
//! if that gate were ever loosened the kernel refuses again when it builds the
//! `WorkerConsent`, and again when a stored order is loaded. Three enforcements,
//! because this layer could be wrong.
//!
//! # The consent route is the caller's own record, and only that
//!
//! `people.overtime.consent_own` sits at the cashier rung, so the ladder does
//! not bound it — the *record* does. [`Access::own`] is what the handler checks,
//! and a caller answering somebody else's order is refused there. Reading it as
//! a rung would make every cashier able to answer every order in the company.
//!
//! # The actor is never in the body
//!
//! Of an authority, only the reason is the caller's to state. The actor comes
//! from the session and the action key from the gate that just passed — not from
//! a field, because a field naming the actor is a field a caller can set to
//! somebody else, and the record of who agreed to work late is the one thing
//! here nobody may forge.

use super::auth::Principal;
use super::employment::{current_unit, reach_of, resolve, Access};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Authorization, DayKind, EmployeeId,
        Minutes, OvertimeId, OvertimeOrder, OvertimePolicy, UnitId, WorkerConsent,
    },
    postgres::{self as infrastructure, OvertimeRecord},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
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

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OvertimeOrderView {
    pub id: String,
    pub employee_id: String,
    pub unit_id: String,
    pub on_date: NaiveDate,
    /// `WORKING`, `REST` or `HOLIDAY` — which statutory table applies, never a
    /// rate.
    pub day_kind: String,
    /// What was ordered. Not what may be worked, and not what was worked.
    pub planned_minutes: u32,
    /// `AWAITING_CONSENT`, `AGREED`, `DECLINED` or `WITHDRAWN`.
    pub state: String,
    /// The figure anything downstream may act on — `null` in every state but
    /// `AGREED`. An order nobody answered authorizes nothing, and a client that
    /// wants a number has to deal with the absence rather than read a field
    /// that is populated either way.
    pub authorized_minutes: Option<u32>,
    pub ordered_by: String,
    pub ordered_at: DateTime<Utc>,
    pub ordered_reason: String,
    /// The worker's answer, in either direction.
    pub answered_by: Option<String>,
    pub answered_at: Option<DateTime<Utc>>,
    pub answered_reason: Option<String>,
    pub withdrawn_by: Option<String>,
    pub withdrawn_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn order_view(record: &OvertimeRecord) -> OvertimeOrderView {
    let order = &record.order;
    let consent = order.state().consent().map(WorkerConsent::authorization);
    let withdrawal = order.state().withdrawal();
    OvertimeOrderView {
        id: order.id().to_string(),
        employee_id: order.employee().to_string(),
        unit_id: order.unit().to_string(),
        on_date: order.date(),
        day_kind: order.day_kind().code().to_owned(),
        planned_minutes: order.planned().get(),
        state: order.state().code().to_owned(),
        // Asked of the domain, never derived from the state code here. Two
        // answers to "how many minutes are authorized" is one too many.
        authorized_minutes: order.authorized_minutes().map(Minutes::get),
        ordered_by: order.ordered().actor().to_string(),
        ordered_at: order.ordered().at(),
        ordered_reason: order.ordered().reason().to_string(),
        answered_by: consent.map(|authority| authority.actor().to_string()),
        answered_at: consent.map(Authorization::at),
        answered_reason: consent.map(|authority| authority.reason().to_string()),
        withdrawn_by: withdrawal.map(|authority| authority.actor().to_string()),
        withdrawn_reason: withdrawal.map(|authority| authority.reason().to_string()),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OvertimePolicyView {
    pub version: u32,
    pub max_per_day_minutes: u32,
    pub max_per_week_minutes: u32,
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderBody {
    pub order_id: String,
    pub on_date: NaiveDate,
    /// `WORKING`, `REST` or `HOLIDAY`.
    ///
    /// Stated rather than derived. The calendar can say a day is a holiday, but
    /// only a roster can say it is somebody's rest day — and there is no roster,
    /// so a derived value would be right about holidays and silently wrong about
    /// the rest, which puts the wrong statutory table on the row.
    pub day_kind: String,
    /// Minutes ordered. Never hours: a fractional hour cannot round-trip, so two
    /// systems reading the same overtime disagree about it.
    pub planned_minutes: u32,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsentBody {
    /// The whole decision, and there is no third value: an order is answered
    /// yes or no, and "pending" is the state it is already in.
    pub agreed: bool,
    /// Their words either way. A refusal with no reason recorded is a refusal
    /// somebody can later characterise however they like.
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawalBody {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeQuery {
    #[serde(default)]
    pub from: Option<NaiveDate>,
    #[serde(default)]
    pub to: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatifyBody {
    pub version: u32,
    pub max_per_day_minutes: u32,
    pub max_per_week_minutes: u32,
    pub reason: String,
}

// ── the policy ───────────────────────────────────────────────────────────

/// The caps in force, or nothing.
///
/// Readable by anybody signed in, for the reason the attendance policy is:
/// somebody being told they may work four hours and no more is entitled to know
/// where the four came from.
pub async fn read_policy(
    State(state): State<AppState>,
) -> Result<Json<Option<OvertimePolicyView>>, AppError> {
    Ok(Json(
        infrastructure::load_overtime_policy(&state.db)
            .await?
            .map(|policy| OvertimePolicyView {
                version: policy.version(),
                max_per_day_minutes: policy.max_per_day().get(),
                max_per_week_minutes: policy.max_per_week().get(),
            }),
    ))
}

/// Ratify the caps.
pub async fn ratify_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<RatifyBody>,
) -> Result<Json<OvertimePolicyView>, AppError> {
    require(&principal, actions::OVERTIME_POLICY_SET)?;
    let policy = OvertimePolicy::try_new(
        body.version,
        Minutes::new(body.max_per_day_minutes),
        Minutes::new(body.max_per_week_minutes),
    )
    .map_err(infrastructure::overtime_error)?;
    let ratified = Authorization::try_new(
        &principal.username,
        actions::OVERTIME_POLICY_SET,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;
    infrastructure::ratify_overtime_policy(&state.db, &policy, &ratified).await?;
    Ok(Json(OvertimePolicyView {
        version: policy.version(),
        max_per_day_minutes: policy.max_per_day().get(),
        max_per_week_minutes: policy.max_per_week().get(),
    }))
}

// ── orders ───────────────────────────────────────────────────────────────

/// The subject's place, for the reach check.
async fn reaches_subject(state: &AppState, access: &Access) -> Result<Option<String>, AppError> {
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    let unit = current_unit(&record).map(ToOwned::to_owned);
    access.reaches(unit.as_deref())?;
    Ok(unit)
}

/// One person's orders.
///
/// Either key reads the list. A worker who may answer an order has to be able to
/// see it, and a list only supervisors could read would mean the person whose
/// evening it is learns about the instruction some other way.
pub async fn list_orders(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<Vec<OvertimeOrderView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    if !access.own {
        reaches_subject(&state, &access).await?;
    }
    let records =
        infrastructure::overtime_orders_of(&state.db, &access.employee_id, query.from, query.to)
            .await?;
    Ok(Json(records.iter().map(order_view).collect()))
}

/// Everything waiting on an answer, bounded by the caller's posting.
pub async fn awaiting(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<OvertimeOrderView>>, AppError> {
    require(&principal, actions::OVERTIME_ORDER)?;
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's overtime is theirs to see",
            principal.username
        )));
    }
    let records =
        infrastructure::awaiting_consent(&state.db, reach.sole_unit().map(|unit| unit.as_str()))
            .await?;
    Ok(Json(records.iter().map(order_view).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrdersQuery {
    /// `AWAITING_CONSENT`, `AGREED`, `DECLINED` or `WITHDRAWN`; absent for all.
    #[serde(default)]
    pub state: Option<String>,
    /// The window, inclusive at both ends. Absent for unbounded.
    #[serde(default)]
    pub from: Option<NaiveDate>,
    #[serde(default)]
    pub to: Option<NaiveDate>,
}

/// Every order at the caller's places in a window, answered or not — the
/// Overtime list's Agreed, Declined and All beside the queue (owner,
/// 2026-10-16). Bounded by the caller's posting exactly as [`awaiting`] is.
pub async fn orders(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<OrdersQuery>,
) -> Result<Json<Vec<OvertimeOrderView>>, AppError> {
    require(&principal, actions::OVERTIME_ORDER)?;
    let wanted = match query.state.as_deref() {
        None => None,
        Some(code @ ("AWAITING_CONSENT" | "AGREED" | "DECLINED" | "WITHDRAWN")) => Some(code),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an overtime order state"
            )));
        }
    };
    let reach = reach_of(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's overtime is theirs to see",
            principal.username
        )));
    }
    let records = infrastructure::overtime_orders_in(
        &state.db,
        reach.sole_unit().map(|unit| unit.as_str()),
        wanted,
        query.from,
        query.to,
    )
    .await?;
    Ok(Json(records.iter().map(order_view).collect()))
}

/// Issue the employer's written instruction.
pub async fn issue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<OrderBody>,
) -> Result<Json<OvertimeOrderView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::OVERTIME_ORDER)?;
    // The rule is two written acts by two people: the employer's instruction
    // and the worker's agreement. Ordering your own overtime and then agreeing
    // to it would be one person producing both, so the instruction for a
    // supervisor's own evening comes from somebody else who reaches them.
    if access.own {
        return Err(AppError::Forbidden(format!(
            "{} may not order overtime for themselves; somebody else who reaches them orders it",
            principal.username
        )));
    }
    let unit_id = reaches_subject(&state, &access).await?.ok_or_else(|| {
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is no unit to order overtime at",
            access.employee_id
        ))
    })?;

    let day_kind = DayKind::parse(&body.day_kind).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a day kind: expected WORKING, REST or HOLIDAY",
            body.day_kind
        ))
    })?;
    let unit = UnitId::try_new(&unit_id).map_err(invalid)?;

    // The caps, or a refusal by name. There is no default: the figures before
    // PP 35/2021 were three hours and fourteen, which is why nothing here
    // supplies one.
    let policy = infrastructure::load_overtime_policy(&state.db)
        .await?
        .ok_or_else(|| {
            AppError::Conflict(
                "no overtime policy has been ratified, so no order can be checked against any cap"
                    .to_owned(),
            )
        })?;

    // A cross-check the operator can act on rather than a silent correction: if
    // the calendar says the day is a holiday and the order says otherwise, the
    // statutory table on the row would be the wrong one.
    if let Some(hint) = infrastructure::day_kind_hint(&state.db, body.on_date, &unit).await? {
        if hint != day_kind {
            return Err(AppError::Validation(format!(
                "{} is a public holiday at {unit_id}; order it as HOLIDAY so the right statutory \
                 table is recorded",
                body.on_date
            )));
        }
    }

    let order = OvertimeOrder::order(
        infrastructure::overtime_id(&body.order_id)?,
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        unit,
        body.on_date,
        day_kind,
        Minutes::new(body.planned_minutes),
        &policy,
        access.authorize(actions::OVERTIME_ORDER, &body.reason)?,
    )
    .map_err(infrastructure::overtime_error)?;

    infrastructure::issue_overtime_order(&state.db, &order, &policy).await?;
    read_back(&state, order.id()).await
}

async fn read_back(state: &AppState, id: &OvertimeId) -> Result<Json<OvertimeOrderView>, AppError> {
    let record = infrastructure::load_overtime_order(&state.db, id.as_str())
        .await?
        .ok_or_else(|| AppError::NotFound(format!("overtime order {id}")))?;
    Ok(Json(order_view(&record)))
}

/// The worker's own answer.
///
/// The worker's key, and nothing else. A supervisor holding the ordering key is
/// refused here — otherwise the ordering key would record the answer to its own
/// instruction, which is one consent wearing two hats.
pub async fn consent(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw, order_id)): Path<(String, String)>,
    Json(body): Json<ConsentBody>,
) -> Result<Json<OvertimeOrderView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::OVERTIME_CONSENT_OWN)?;
    // The bound is the record, not the rung. Answering somebody else's order is
    // exactly the shape the two keys exist to refuse.
    if !access.own {
        return Err(AppError::Forbidden(
            "only the person an overtime order is for may answer it".to_owned(),
        ));
    }

    let mut record = infrastructure::load_overtime_order(&state.db, &order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("overtime order {order_id}")))?;
    if record.order.employee().as_str() != access.employee_id {
        return Err(AppError::NotFound(format!("overtime order {order_id}")));
    }

    // The kernel checks the key again. Belt and braces on the one rule whose
    // failure is invisible afterwards: a stored consent carries no trace of
    // which gate let it through.
    let answer =
        WorkerConsent::try_new(access.authorize(actions::OVERTIME_CONSENT_OWN, &body.reason)?)
            .map_err(infrastructure::overtime_error)?;

    if body.agreed {
        record.order.agree(answer)
    } else {
        record.order.decline(answer)
    }
    .map_err(infrastructure::overtime_error)?;

    infrastructure::answer_overtime_order(&state.db, &record.order).await?;
    read_back(&state, record.order.id()).await
}

/// The employer takes the instruction back, before it is answered.
///
/// Taking back your own instruction is an ordering act, so it uses the ordering
/// key. The kernel then refuses it unless the order is still unanswered.
pub async fn withdraw(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw, order_id)): Path<(String, String)>,
    Json(body): Json<WithdrawalBody>,
) -> Result<Json<OvertimeOrderView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::OVERTIME_ORDER)?;

    let mut record = infrastructure::load_overtime_order(&state.db, &order_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("overtime order {order_id}")))?;
    if record.order.employee().as_str() != access.employee_id {
        return Err(AppError::NotFound(format!("overtime order {order_id}")));
    }
    let reach = reach_of(&state, &principal).await?;
    if !reach.covers(Some(record.order.unit().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            record.order.unit()
        )));
    }

    record
        .order
        .withdraw(access.authorize(actions::OVERTIME_ORDER, &body.reason)?)
        .map_err(infrastructure::overtime_error)?;
    infrastructure::answer_overtime_order(&state.db, &record.order).await?;
    read_back(&state, record.order.id()).await
}
