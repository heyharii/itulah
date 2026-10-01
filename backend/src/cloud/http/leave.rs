//! Asking for leave, and deciding it.
//!
//! # There is no route that spends a balance
//!
//! The only way days leave a balance is `POST
//! /employees/{id}/leave-requests/{id}/approve`, which asks the domain to mint
//! the deduction and stores it in the same transaction as the approval. A
//! separate "adjust the balance" route that could take days off without a
//! request behind it would put the halfway state — approved, nothing deducted —
//! back within reach of one careless caller.
//!
//! Allocations, accruals and named corrections *do* have a route. They add days
//! or repair a mistake, and neither can be produced by an approval.
//!
//! # Three ways in, and they are not the same way
//!
//! An employee asks for their own leave under `people.leave.request_own`, which
//! everybody signed in holds and which reaches nothing but their own record. A
//! place manager may file on somebody's behalf under `people.leave.request`,
//! bounded by their posting — not every warehouse hand carries a phone, and a
//! system where the only way to ask is an app is a system where those people
//! stop asking. Deciding is `people.leave.decide`, also bounded, and
//! deliberately disjoint from both: asking for leave is not granting it.

use super::auth::Principal;
use super::employment::{caller_and_reach, current_unit, resolve, Access};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, BalanceContext, EmployeeId, LeaveBacking,
        LeaveDays, LeaveEvent, LeavePeriod, LeaveRequest, LeaveRequestId, LeaveType,
        LeaveTypeCatalogue, LeaveTypeCode, LedgerEntry, UnitId,
    },
    postgres::{self as infrastructure, LeaveBalanceRow, LeaveRequestRecord},
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

// ── views ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LeaveTypeView {
    pub code: String,
    pub name: String,
    /// `BALANCE`, `PER_OCCURRENCE` or `AS_CERTIFIED`.
    pub backing: String,
    /// The per-occurrence bound in centidays, and `null` for the other two.
    pub max_centidays: Option<i32>,
    /// `FULL`, `UNPAID` or `STATUTORY_SCALE`.
    pub payment: String,
    pub requires_evidence: bool,
    /// Sent rather than derived from `backing` in the browser, so a leave form
    /// and the kernel cannot disagree about whether asking for a balance is even
    /// a question.
    pub draws_on_balance: bool,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LeaveRequestView {
    pub id: String,
    pub employee_id: String,
    pub unit_id: String,
    pub leave_type: String,
    pub leave_type_name: String,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    /// The days actually charged, as settled on the day it was filed. A browser
    /// counting weekends and holidays itself would get *cuti bersama* wrong.
    pub chargeable_days: usize,
    pub chargeable: Vec<NaiveDate>,
    /// `PENDING`, `APPROVED`, `REJECTED` or `WITHDRAWN`.
    pub state: String,
    /// The deduction this approval made. `null` on an approved request means the
    /// kind draws on no balance, which is correct rather than missing.
    pub ledger_entry: Option<String>,
    pub evidence: Option<String>,
    pub requested_by: String,
    pub reason: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn type_view(leave_type: &LeaveType) -> LeaveTypeView {
    LeaveTypeView {
        code: leave_type.code().to_string(),
        name: leave_type.name().to_owned(),
        backing: leave_type.backing().code().to_owned(),
        max_centidays: leave_type
            .max_days_per_occurrence()
            .map(LeaveDays::centidays),
        payment: leave_type.payment().code().to_owned(),
        requires_evidence: leave_type.requires_evidence(),
        draws_on_balance: leave_type.draws_on_balance(),
    }
}

fn request_view(record: &LeaveRequestRecord, catalogue: &LeaveTypeCatalogue) -> LeaveRequestView {
    let request = &record.request;
    let decision = request.state().decision();
    LeaveRequestView {
        id: request.id().to_string(),
        employee_id: request.employee().to_string(),
        unit_id: request.unit().to_string(),
        leave_type: request.leave_type().to_string(),
        leave_type_name: catalogue.get(request.leave_type()).map_or_else(
            || request.leave_type().to_string(),
            |kind| kind.name().to_owned(),
        ),
        from_date: request.period().from(),
        to_date: request.period().to(),
        chargeable_days: request.chargeable_days(),
        chargeable: request.chargeable().to_vec(),
        state: request.state().code().to_owned(),
        ledger_entry: request.state().ledger_entry().map(ToOwned::to_owned),
        evidence: request.evidence().map(ToOwned::to_owned),
        requested_by: request.requested().actor().to_string(),
        reason: request.reason().to_string(),
        decided_by: decision.map(|authority| authority.actor().to_string()),
        decided_at: decision.map(super::super::domain::Authorization::at),
        decision_reason: decision.map(|authority| authority.reason().to_string()),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DefineTypeBody {
    pub code: String,
    pub name: String,
    /// `BALANCE`, `PER_OCCURRENCE` or `AS_CERTIFIED`.
    pub backing: String,
    /// Whole days, required for `PER_OCCURRENCE` and refused for the rest. The
    /// operator's figure, never a constant: three days for a marriage comes from
    /// UU 13/2003 art. 93(4) and can be amended.
    #[serde(default)]
    pub max_days: Option<i32>,
    /// `FULL`, `UNPAID` or `STATUTORY_SCALE`.
    pub payment: String,
    #[serde(default)]
    pub requires_evidence: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementBody {
    pub entry_id: String,
    pub leave_type: String,
    pub on: NaiveDate,
    /// Any event except `USAGE`. Days leave a balance only through an approved
    /// request, so there is no route that can spend one.
    pub event: String,
    /// Whole days. Signed only for `ADJUSTMENT`, which may go either way.
    pub days: i32,
    #[serde(default)]
    pub expires_on: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileBody {
    pub request_id: String,
    pub leave_type: String,
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    /// The days this person is not rostered on. Supplied rather than derived:
    /// attendance owns the roster, and taking a dependency on it to ask one
    /// question would tie the two together.
    #[serde(default)]
    pub rest_days: Vec<NaiveDate>,
    #[serde(default)]
    pub evidence: Option<String>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionBody {
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BalanceQuery {
    /// The date to fold to. Defaults to today.
    #[serde(default)]
    pub on: Option<NaiveDate>,
}

// ── the catalogue ────────────────────────────────────────────────────────

/// The kinds of leave that exist.
///
/// Readable by anybody signed in, for the reason the attendance policy is:
/// somebody filing their own leave has to know which kinds exist before they can
/// ask for one, and the list names no employee and holds nothing personal.
pub async fn list_types(
    State(state): State<AppState>,
) -> Result<Json<Vec<LeaveTypeView>>, AppError> {
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    Ok(Json(catalogue.types().iter().map(type_view).collect()))
}

/// Ratify a kind of leave.
///
/// Head office's, and the weight is the reason: this is the decision that
/// settles whether sick days come out of the twelve.
pub async fn define_type(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<DefineTypeBody>,
) -> Result<Json<Vec<LeaveTypeView>>, AppError> {
    require(&principal, actions::LEAVE_TYPE_SET)?;

    let backing = match (body.backing.as_str(), body.max_days) {
        ("BALANCE", None) => LeaveBacking::Balance,
        ("AS_CERTIFIED", None) => LeaveBacking::AsCertified,
        ("PER_OCCURRENCE", Some(days)) => LeaveBacking::PerOccurrence {
            max_days: LeaveDays::from_days(days).map_err(infrastructure::leave_error)?,
        },
        ("PER_OCCURRENCE", None) => {
            return Err(AppError::Validation(
                "a per-occurrence allowance must say how many days it allows".to_owned(),
            ));
        }
        ("BALANCE" | "AS_CERTIFIED", Some(_)) => {
            return Err(AppError::Validation(
                "only a per-occurrence allowance carries a day bound".to_owned(),
            ));
        }
        (other, _) => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a backing: expected BALANCE, PER_OCCURRENCE or AS_CERTIFIED"
            )));
        }
    };
    let payment = crate::cloud::domain::LeavePayment::parse(&body.payment).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a payment rule: expected FULL, UNPAID or STATUTORY_SCALE",
            body.payment
        ))
    })?;

    let leave_type = LeaveType::try_new(
        LeaveTypeCode::try_new(&body.code).map_err(infrastructure::leave_error)?,
        &body.name,
        backing,
        payment,
        body.requires_evidence,
    )
    .map_err(infrastructure::leave_error)?;

    infrastructure::define_type(&state.db, &leave_type).await?;
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    Ok(Json(catalogue.types().iter().map(type_view).collect()))
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

// ── balances ─────────────────────────────────────────────────────────────

/// What one person has left, per kind.
pub async fn balances(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Query(query): Query<BalanceQuery>,
) -> Result<Json<Vec<LeaveBalanceRow>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    reaches_subject(&state, &access).await?;
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let on = query.on.unwrap_or_else(crate::reporting::local_today);
    Ok(Json(
        infrastructure::balances_of(&state.db, &access.employee_id, &catalogue, on).await?,
    ))
}

/// Put days into a balance, or correct one.
///
/// Head office's: an allocation is the entitlement, and a manager who could hand
/// somebody days could hand themselves some. `USAGE` is refused outright — days
/// leave a balance only through an approved request.
pub async fn move_balance(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<MovementBody>,
) -> Result<Json<Vec<LeaveBalanceRow>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::LEAVE_GRANT)?;

    let event = LeaveEvent::parse(&body.event)
        .ok_or_else(|| AppError::Validation(format!("{:?} is not a leave movement", body.event)))?;
    if event == LeaveEvent::Usage {
        return Err(AppError::Validation(
            "days leave a balance only through an approved request".to_owned(),
        ));
    }
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let code = LeaveTypeCode::try_new(&body.leave_type).map_err(infrastructure::leave_error)?;
    let leave_type = catalogue
        .require(&code)
        .map_err(infrastructure::leave_error)?;

    let amount = LeaveDays::from_days(body.days).map_err(infrastructure::leave_error)?;
    let mut entry =
        LedgerEntry::try_new(&body.entry_id, body.on, event, amount, &principal.username)
            .map_err(infrastructure::leave_error)?;
    if let Some(expires_on) = body.expires_on {
        entry = entry.expiring_on(expires_on);
    }
    infrastructure::append_movement(&state.db, &access.employee_id, leave_type, &entry).await?;

    // Head office's day: leave is kept by head office (`site.timezone`, 0603).
    let on = crate::reporting::local_today_at(
        infrastructure::sites::business_utc_offset_minutes(&state.db, None, chrono::Utc::now())
            .await?,
    );
    Ok(Json(
        infrastructure::balances_of(&state.db, &access.employee_id, &catalogue, on).await?,
    ))
}

// ── requests ─────────────────────────────────────────────────────────────

/// The subject's place, for the reach check.
///
/// A request belongs to the place its subject is posted to, so bounding the read
/// is bounding it by the same fact the Directory is bounded by.
async fn reaches_subject(state: &AppState, access: &Access) -> Result<(), AppError> {
    if access.own {
        return Ok(());
    }
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_unit(&record))
}

pub async fn list_requests(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<LeaveRequestView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    reaches_subject(&state, &access).await?;
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let records = infrastructure::requests_of(&state.db, &access.employee_id, &catalogue).await?;
    Ok(Json(
        records
            .iter()
            .map(|record| request_view(record, &catalogue))
            .collect(),
    ))
}

/// Everything waiting on a decision, bounded by the caller's reach.
///
/// One queue rather than one screen per kind of thing: a manager does not have a
/// "leave task" and a "correction task", they have five minutes and a list of
/// what is waiting on them.
pub async fn pending(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<LeaveRequestView>>, AppError> {
    require(&principal, actions::LEAVE_DECIDE)?;
    let (own_record, reach) = caller_and_reach(&state, &principal).await?;
    if reach.is_nowhere() {
        return Err(AppError::Forbidden(format!(
            "{} has no open posting, so no unit's requests are theirs to decide",
            principal.username
        )));
    }
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let records = infrastructure::pending_requests(
        &state.db,
        reach.sole_unit().map(|unit| unit.as_str()),
        &catalogue,
    )
    .await?;
    // Not waiting on *you*: your own leave is somebody else's to decide, and a
    // row offering buttons that can only answer 403 is not a queue item.
    Ok(Json(
        records
            .iter()
            .filter(|record| {
                own_record.as_deref() != Some(record.request.employee().as_str())
                    && record.request.requested().actor().as_str() != principal.username
            })
            .map(|record| request_view(record, &catalogue))
            .collect(),
    ))
}

/// File a request.
///
/// The key the request is recorded under is the one that actually applied —
/// `request_own` for somebody asking about themselves, `request` for a manager
/// filing on their behalf — so a stored request says which authority it rested
/// on rather than which one the handler happened to check first.
pub async fn file(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<FileBody>,
) -> Result<Json<LeaveRequestView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    let action_key = if access.own {
        actions::LEAVE_REQUEST_OWN
    } else {
        actions::LEAVE_REQUEST
    };
    access.may(action_key)?;

    // Where the person is posted, which is where the request belongs and which
    // manager it lands in front of. Read from the employment record rather than
    // taken from the body: a body that named its own place would be a request
    // that chose its own approver.
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_unit(&record))?;
    let unit_id = current_unit(&record).ok_or_else(|| {
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is nobody to decide their leave",
            access.employee_id
        ))
    })?;

    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let code = LeaveTypeCode::try_new(&body.leave_type).map_err(infrastructure::leave_error)?;
    let leave_type = catalogue
        .require(&code)
        .map_err(infrastructure::leave_error)?;

    let period =
        LeavePeriod::try_new(body.from_date, body.to_date).map_err(infrastructure::leave_error)?;
    // A span crossing a year boundary is rare enough, and wrong enough to guess
    // at, that it is refused rather than charged against a calendar that does
    // not cover half of it.
    if body.from_date.format("%Y").to_string() != body.to_date.format("%Y").to_string() {
        return Err(AppError::Validation(
            "a leave span crossing a year boundary must be filed as two requests".to_owned(),
        ));
    }
    let year: i32 = body
        .from_date
        .format("%Y")
        .to_string()
        .parse()
        .map_err(|_| AppError::Validation("unreadable year".to_owned()))?;
    let calendar = infrastructure::load_calendar(&state.db, year)
        .await?
        .ok_or_else(|| {
            // A conflict rather than a bad request: the dates are fine and the
            // calendar is missing, so telling the caller to fix their request
            // would send them looking in the wrong place.
            AppError::Conflict(format!(
                "no holiday calendar has been published for {year}, so which days this charges \
                 cannot be settled"
            ))
        })?;

    // A person on a roster is charged only the days it schedules them to
    // work (0809, cuti untuk pekerja roster): the roster's own rest days and
    // holidays join whatever rest days the caller named.
    let mut rest_days = body.rest_days.clone();
    if let Some(rostered) =
        infrastructure::roster_rest_days(&state.db, &access.employee_id, body.from_date, body.to_date)
            .await?
    {
        rest_days.extend(rostered);
        rest_days.sort();
        rest_days.dedup();
    }

    let request = LeaveRequest::file(
        LeaveRequestId::try_new(&body.request_id).map_err(infrastructure::leave_error)?,
        EmployeeId::try_new(&access.employee_id).map_err(invalid)?,
        UnitId::try_new(unit_id).map_err(invalid)?,
        leave_type,
        period,
        &calendar,
        &rest_days,
        body.evidence.clone(),
        access.authorize(action_key, &body.reason)?,
    )
    .map_err(infrastructure::leave_error)?;

    // Dates head office has closed to leave (0809). Checked on the days the
    // request would charge: a closed Sunday nobody works costs nobody.
    if let Some((day, why)) =
        infrastructure::blocking_leave(&state.db, unit_id, request.chargeable()).await?
    {
        return Err(AppError::Conflict(format!(
            "{day} is closed to leave: {why}"
        )));
    }

    infrastructure::file_request(&state.db, &request).await?;
    read_back(&state, request.id().as_str(), &catalogue).await
}

async fn read_back(
    state: &AppState,
    id: &str,
    catalogue: &LeaveTypeCatalogue,
) -> Result<Json<LeaveRequestView>, AppError> {
    let record = infrastructure::load_request(&state.db, id, catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("leave request {id}")))?;
    Ok(Json(request_view(&record, catalogue)))
}

/// What a decision needs in hand: the request, its kind, and the caller's right
/// to decide it here.
async fn decidable(
    state: &AppState,
    principal: &Principal,
    request_id: &str,
) -> Result<(LeaveRequestRecord, LeaveTypeCatalogue), AppError> {
    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let record = infrastructure::load_request(&state.db, request_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("leave request {request_id}")))?;
    let (own_record, reach) = caller_and_reach(state, principal).await?;
    if !reach.covers(Some(record.request.unit().as_str())) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            record.request.unit()
        )));
    }
    // The domain refuses the person who *filed* it; this refuses the person it
    // is *for*, which the domain cannot see — HR may file on a supervisor's
    // behalf, and the supervisor then finds their own leave in their queue.
    if own_record.as_deref() == Some(record.request.employee().as_str()) {
        return Err(AppError::Forbidden(format!(
            "{} may not decide their own leave; somebody else who reaches {} decides it",
            principal.username,
            record.request.unit()
        )));
    }
    Ok((record, catalogue))
}

pub async fn approve(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((_raw, request_id)): Path<(String, String)>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<LeaveRequestView>, AppError> {
    require(&principal, actions::LEAVE_DECIDE)?;
    let (mut record, catalogue) = decidable(&state, &principal, &request_id).await?;
    let leave_type = catalogue
        .require(record.request.leave_type())
        .map_err(infrastructure::leave_error)?;

    let authorization = crate::cloud::domain::Authorization::try_new(
        &principal.username,
        actions::LEAVE_DECIDE,
        Utc::now(),
        &body.reason,
    )
    .map_err(invalid)?;

    // Balance-backed leave folds its own ledger before it is approved, under the
    // policy in force on the day the leave starts. A kind that draws on nothing
    // needs neither, and passing them would be passing something the domain must
    // refuse to use.
    let employee_id = record.request.employee().to_string();
    let entry = if leave_type.draws_on_balance() {
        let ledger =
            infrastructure::load_ledger(&state.db, &employee_id, leave_type.code()).await?;
        let policies = infrastructure::load_policies(&state.db).await?;
        record
            .request
            .approve(
                leave_type,
                Some(BalanceContext {
                    ledger: &ledger,
                    policies: &policies,
                }),
                authorization,
            )
            .map_err(infrastructure::leave_error)?
    } else {
        record
            .request
            .approve(leave_type, None, authorization)
            .map_err(infrastructure::leave_error)?
    };

    infrastructure::decide_request(&state.db, &record.request, entry.as_ref()).await?;
    read_back(&state, &request_id, &catalogue).await
}

pub async fn reject(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((_raw, request_id)): Path<(String, String)>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<LeaveRequestView>, AppError> {
    require(&principal, actions::LEAVE_DECIDE)?;
    let (mut record, catalogue) = decidable(&state, &principal, &request_id).await?;
    record
        .request
        .reject(
            crate::cloud::domain::Authorization::try_new(
                &principal.username,
                actions::LEAVE_DECIDE,
                Utc::now(),
                &body.reason,
            )
            .map_err(invalid)?,
        )
        .map_err(infrastructure::leave_error)?;
    infrastructure::decide_request(&state.db, &record.request, None).await?;
    read_back(&state, &request_id, &catalogue).await
}

/// Take back your own request.
///
/// Gated on the *requesting* key rather than the deciding one — taking back your
/// own statement is not a decision about somebody else's leave — and the domain
/// then checks it really is the same actor. Anyone else who wants a pending
/// request gone must reject it, which records their name and their reason.
pub async fn withdraw(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((raw, request_id)): Path<(String, String)>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<LeaveRequestView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    let action_key = if access.own {
        actions::LEAVE_REQUEST_OWN
    } else {
        actions::LEAVE_REQUEST
    };
    access.may(action_key)?;

    let catalogue = infrastructure::load_catalogue(&state.db).await?;
    let mut record = infrastructure::load_request(&state.db, &request_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("leave request {request_id}")))?;
    if record.request.employee().as_str() != access.employee_id {
        return Err(AppError::NotFound(format!("leave request {request_id}")));
    }
    // Withdrawing a colleague's request is a place-scoped write like deciding
    // one; your own is yours wherever you are posted (`Access::reaches`).
    access.reaches(Some(record.request.unit().as_str()))?;
    record
        .request
        .withdraw(access.authorize(action_key, &body.reason)?)
        .map_err(infrastructure::leave_error)?;
    infrastructure::decide_request(&state.db, &record.request, None).await?;
    read_back(&state, &request_id, &catalogue).await
}

// ── the policy ───────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LeavePolicyView {
    pub version: u32,
    pub effective_from: NaiveDate,
    pub annual_centidays: i32,
    /// `UP_FRONT` or `MONTHLY`.
    pub accrual: String,
    /// `FORBIDDEN` or `CAPPED`.
    pub carry_forward: String,
    pub carry_forward_cap_centidays: Option<i32>,
    /// `MM-DD`, and absent when carry-forward is forbidden.
    pub carry_forward_expires_on: Option<String>,
    /// `FORBIDDEN` or `ALLOWED`.
    pub encashment: String,
    pub encashment_max_centidays: Option<i32>,
    pub encashment_second_approver: Option<bool>,
    /// `CONTINUES` or `SUSPENDED`.
    pub protected_leave: String,
}

fn policy_view(policy: &crate::cloud::domain::LeavePolicy) -> LeavePolicyView {
    use crate::cloud::domain::{Accrual, AccrualDuringProtectedLeave, CarryForward, Encashment};
    let (carry_forward, cap, expires) = match policy.carry_forward() {
        CarryForward::Forbidden => ("FORBIDDEN", None, None),
        CarryForward::Capped {
            cap,
            expires_on_month_day: (month, day),
        } => (
            "CAPPED",
            Some(cap.centidays()),
            Some(format!("{month:02}-{day:02}")),
        ),
    };
    let (encashment, max, second) = match policy.encashment() {
        Encashment::Forbidden => ("FORBIDDEN", None, None),
        Encashment::Allowed {
            max_per_year,
            second_approver_required,
        } => (
            "ALLOWED",
            Some(max_per_year.centidays()),
            Some(second_approver_required),
        ),
    };
    LeavePolicyView {
        version: policy.version(),
        effective_from: policy.effective_from(),
        annual_centidays: policy.annual_entitlement().centidays(),
        accrual: match policy.accrual() {
            Accrual::UpFront => "UP_FRONT",
            Accrual::Monthly => "MONTHLY",
        }
        .to_owned(),
        carry_forward: carry_forward.to_owned(),
        carry_forward_cap_centidays: cap,
        carry_forward_expires_on: expires,
        encashment: encashment.to_owned(),
        encashment_max_centidays: max,
        encashment_second_approver: second,
        protected_leave: match policy.protected_leave() {
            AccrualDuringProtectedLeave::Continues => "CONTINUES",
            AccrualDuringProtectedLeave::Suspended => "SUSPENDED",
        }
        .to_owned(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallPolicyBody {
    pub version: u32,
    pub effective_from: NaiveDate,
    pub annual_days: i32,
    /// `UP_FRONT` or `MONTHLY`.
    pub accrual: String,
    /// Absent forbids carry-forward outright. Present, it must say both how
    /// many days and when they lapse: a cap with no expiry never bites, and an
    /// expiry with no cap bounds nothing.
    #[serde(default)]
    pub carry_forward_days: Option<i32>,
    /// `MM-DD`.
    #[serde(default)]
    pub carry_forward_expires_on: Option<String>,
    #[serde(default)]
    pub encashment_max_days: Option<i32>,
    #[serde(default)]
    pub encashment_second_approver: bool,
    /// `CONTINUES` or `SUSPENDED` — whether annual leave keeps accruing during
    /// maternity or long sick leave. There is no default: it is one of the four
    /// questions the operator must actually answer.
    pub protected_leave: String,
}

/// The rules a balance folds under.
///
/// Readable by anybody signed in, for the same reason the attendance policy is:
/// somebody whose days are counted under a rule is entitled to read it.
pub async fn read_policy(
    State(state): State<AppState>,
) -> Result<Json<Vec<LeavePolicyView>>, AppError> {
    let timeline = infrastructure::load_policies(&state.db).await?;
    Ok(Json(
        timeline.generations().iter().map(policy_view).collect(),
    ))
}

/// Ratify a generation.
///
/// A generation, never an edit: last month's balance still folds under last
/// month's rules, and two generations effective on one day would make "which
/// rules applied" depend on row order.
pub async fn install_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<InstallPolicyBody>,
) -> Result<Json<Vec<LeavePolicyView>>, AppError> {
    use crate::cloud::domain::{
        Accrual, AccrualDuringProtectedLeave, CarryForward, Encashment, LeavePolicy,
    };
    require(&principal, actions::LEAVE_TYPE_SET)?;

    let accrual = match body.accrual.as_str() {
        "UP_FRONT" => Accrual::UpFront,
        "MONTHLY" => Accrual::Monthly,
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an accrual rule: expected UP_FRONT or MONTHLY"
            )));
        }
    };
    let carry_forward = match (
        body.carry_forward_days,
        body.carry_forward_expires_on.as_deref(),
    ) {
        (None, None) => CarryForward::Forbidden,
        (Some(days), Some(when)) => {
            let (month, day) = when.split_once('-').ok_or_else(|| {
                AppError::Validation("carry_forward_expires_on must read MM-DD".to_owned())
            })?;
            CarryForward::Capped {
                cap: LeaveDays::from_days(days).map_err(infrastructure::leave_error)?,
                expires_on_month_day: (
                    month.parse().map_err(|_| {
                        AppError::Validation("carry_forward_expires_on must read MM-DD".to_owned())
                    })?,
                    day.parse().map_err(|_| {
                        AppError::Validation("carry_forward_expires_on must read MM-DD".to_owned())
                    })?,
                ),
            }
        }
        // A cap with no expiry never bites and an expiry with no cap bounds
        // nothing. Both halves or neither.
        _ => {
            return Err(AppError::Validation(
                "carry-forward needs both a day bound and the date it lapses".to_owned(),
            ));
        }
    };
    let encashment = match body.encashment_max_days {
        None => Encashment::Forbidden,
        Some(days) => Encashment::Allowed {
            max_per_year: LeaveDays::from_days(days).map_err(infrastructure::leave_error)?,
            second_approver_required: body.encashment_second_approver,
        },
    };
    let protected_leave = match body.protected_leave.as_str() {
        "CONTINUES" => AccrualDuringProtectedLeave::Continues,
        "SUSPENDED" => AccrualDuringProtectedLeave::Suspended,
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an answer: expected CONTINUES or SUSPENDED"
            )));
        }
    };

    let policy = LeavePolicy::try_new(
        body.version,
        body.effective_from,
        LeaveDays::from_days(body.annual_days).map_err(infrastructure::leave_error)?,
        accrual,
        carry_forward,
        encashment,
        protected_leave,
    )
    .map_err(infrastructure::leave_error)?;

    // The timeline's ordering rule fires here, on the whole set, rather than on
    // the row about to be written.
    let mut timeline = infrastructure::load_policies(&state.db).await?;
    timeline
        .install(policy)
        .map_err(infrastructure::leave_error)?;
    infrastructure::install_policy(&state.db, &policy).await?;
    Ok(Json(
        timeline.generations().iter().map(policy_view).collect(),
    ))
}
