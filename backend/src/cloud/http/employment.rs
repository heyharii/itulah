//! Who works here, under what contract, and where they are posted.
//!
//! # Two ways in, and they are not the same way
//!
//! Every route here can be reached by an HR officer asking about somebody, and
//! most can be reached by a person asking about themselves — the employee app
//! calls `/employees/me/profile` on the screen where somebody checks their own
//! bank details are right.
//!
//! Those are different questions. Reading a stranger's NIK and home address is
//! `people.profile.read`, which sits at the top of the ladder; reading your own
//! is not a privilege at all. So [`resolve`] returns not just an id but whether
//! it is the caller's own record, and [`Access::may_read`] lets self-reads past
//! the rung check.
//!
//! # Two things called a profile, and only one of them carries a NIK
//!
//! The reference this is ported from calls personal data — NIK, address, date
//! of birth — a "profile". The employee app means something else entirely by
//! the word: employee number, job title, where you work, when you joined. Both
//! readings are reasonable and they must not share a route, because the route
//! they would share is the one carrying a national identity number.
//!
//! So personal data lives at `/personal-data` behind `people.profile.read`, and
//! `/profile` serves the employment summary behind `people.employee.read`. The
//! summary deliberately carries no NIK, no address and no contact details: a
//! supervisor reading a rota gets a name, a job and a place, and nothing that
//! belongs to the person rather than to the job.
//!
//! Writes are not softened the same way. Somebody amending their own address is
//! still an amendment to a record HR owns, and it still records who authorised
//! it — a person cannot promote themselves by asking about themselves.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Address, AssignmentSpan, Authorization,
        Contact, Contract, ContractKind, Employee, EmployeeCode, EmploymentStatus,
        EmploymentTransition, FullName, Grade, Nik, PlaceId, Position, Profile, ProfileField,
    },
    postgres::{self as infrastructure, EmployeeRecord, EmployeeSummary, ExpiringContract},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The path segment that means "the caller".
const SELF: &str = "me";

/// How many rows the workforce list returns when the caller does not say.
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 1000;

/// A resolved subject, and whether the caller is asking about themselves.
struct Access {
    employee_id: String,
    own: bool,
    principal: Principal,
}

impl Access {
    /// A read the caller is entitled to.
    ///
    /// Reading your own record is not a privilege. Reading somebody else's is,
    /// and the rung comes from the action key.
    fn may_read(&self, action_key: &str) -> Result<(), AppError> {
        if self.own {
            return Ok(());
        }
        self.may(action_key)
    }

    /// A write. Never softened by asking about yourself.
    fn may(&self, action_key: &str) -> Result<(), AppError> {
        if role_allows(required_role_for_action(action_key), self.principal.role) {
            return Ok(());
        }
        Err(AppError::Forbidden(format!(
            "{} may not {action_key}",
            self.principal.username
        )))
    }

    /// The recorded authority for a decision the caller is about to take.
    ///
    /// The actor and the instant come from here, never from the request body:
    /// a handler that accepted either would let a caller sign somebody else's
    /// name to their own decision.
    fn authorize(&self, action_key: &str, reason: &str) -> Result<Authorization, AppError> {
        Authorization::try_new(&self.principal.username, action_key, Utc::now(), reason)
            .map_err(|error| AppError::Validation(error.to_string()))
    }
}

/// Turn a path segment into an employee id, resolving `me` from the session.
async fn resolve(state: &AppState, principal: &Principal, raw: &str) -> Result<Access, AppError> {
    let mine = infrastructure::employee_id_for_username(&state.db, &principal.username).await?;
    let employee_id = if raw == SELF {
        mine.clone().ok_or_else(|| {
            // Not a 404: the route exists and the session is valid. There is
            // simply no employment record behind this login yet, which is a
            // state HR has to fix, not the caller.
            AppError::NotFound(format!(
                "no employment record is bound to {}",
                principal.username
            ))
        })?
    } else {
        raw.to_owned()
    };
    Ok(Access {
        own: mine.as_deref() == Some(employee_id.as_str()),
        employee_id,
        principal: principal.clone(),
    })
}

async fn record(state: &AppState, employee_id: &str) -> Result<EmployeeRecord, AppError> {
    infrastructure::load_employee(&state.db, employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {employee_id}")))
}

fn invalid(error: impl std::fmt::Display) -> AppError {
    AppError::Validation(error.to_string())
}

// ── views ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssignmentView {
    pub place_id: String,
    pub valid_from: NaiveDate,
    pub valid_to: Option<NaiveDate>,
    pub actor: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmploymentEventView {
    pub transition: String,
    pub from: String,
    pub to: String,
    pub effective_on: NaiveDate,
    pub actor: String,
    pub reason: String,
    pub at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeCodeCorrectionView {
    pub from: String,
    pub to: String,
    pub actor: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmployeeView {
    pub employee_id: String,
    pub employee_code: String,
    pub status: EmploymentStatus,
    /// Whether this person may be picked for new work. Sent rather than left
    /// for the browser to derive, so nothing downstream invents its own idea of
    /// "still here" and disagrees with the domain.
    pub selectable: bool,
    pub current_place_id: Option<String>,
    pub assignments: Vec<AssignmentView>,
    pub history: Vec<EmploymentEventView>,
    pub code_history: Vec<EmployeeCodeCorrectionView>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Personal data. Its own view, reached by its own route, gated by its own key.
///
/// Deliberately not folded into [`EmployeeView`]. A workforce list shows
/// employees; it has no business carrying sixteen digits of national identity
/// number and a home address because somebody added a field to a struct.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PersonalDataView {
    pub employee_id: String,
    pub full_name: String,
    pub nik: String,
    pub birth_date: NaiveDate,
    pub address: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub amendments: Vec<ProfileAmendmentView>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ProfileAmendmentView {
    pub field: String,
    pub actor: String,
    pub at: DateTime<Utc>,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractView {
    /// `PKWT` or `PKWTT`.
    pub kind: String,
    pub starts_on: NaiveDate,
    pub ends_on: Option<NaiveDate>,
    pub position: String,
    pub grade: String,
    /// Whether this is the contract in force on the date asked about.
    pub in_force: bool,
    pub actor: String,
    pub reason: String,
}

/// A run of back-to-back fixed terms. Facts only — whether it has converted to
/// permanent employment by operation of law is not ours to assert.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PkwtRunView {
    pub terms: usize,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub days: i64,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ContractsView {
    pub employee_id: String,
    pub contracts: Vec<ContractView>,
    pub pkwt_run: Option<PkwtRunView>,
}

/// Who somebody is at work: the answer the employee app asks for on the screen
/// where a person checks their own details.
///
/// Assembled rather than stored — every field is derived from something already
/// recorded. `joined_on` in particular is read out of the employment history
/// (the first HIRE) rather than kept as a column, so it cannot drift from the
/// events that produced it.
///
/// Carries no NIK, no address and no contact details. Those are `/personal-data`
/// and a different grant; this view is reachable by anyone who may read the
/// workforce, which is a much wider audience.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EmploymentProfileView {
    pub employee_id: String,
    pub employee_code: String,
    /// Absent until personal data has been enrolled — a record can exist before
    /// anybody has typed a name into it.
    pub full_name: Option<String>,
    pub status: EmploymentStatus,
    /// From the most recent contract. Absent before the first one is signed.
    pub job_title: Option<String>,
    pub grade: Option<String>,
    /// The open posting, if there is one.
    pub place_id: Option<String>,
    pub place_name: Option<String>,
    /// The day the first HIRE took effect. Absent for somebody still a
    /// candidate, which is the honest answer: they have not joined.
    pub joined_on: Option<NaiveDate>,
}

fn assignment_views(record: &EmployeeRecord) -> Vec<AssignmentView> {
    record
        .assignments
        .spans()
        .iter()
        .map(|span| AssignmentView {
            place_id: span.place_id().to_string(),
            valid_from: span.from(),
            valid_to: span.to(),
            actor: span.authorization().actor().to_string(),
            reason: span.authorization().reason().to_string(),
        })
        .collect()
}

fn employee_view(record: &EmployeeRecord) -> EmployeeView {
    EmployeeView {
        employee_id: record.employee.id().to_string(),
        employee_code: record.employee.code().to_string(),
        status: record.employee.status(),
        selectable: record.employee.status().is_selectable(),
        current_place_id: record
            .assignments
            .current()
            .map(|span| span.place_id().to_string()),
        assignments: assignment_views(record),
        history: record
            .employee
            .history()
            .iter()
            .map(|event| EmploymentEventView {
                transition: event.transition().code().to_owned(),
                from: event.from().code().to_owned(),
                to: event.to().code().to_owned(),
                effective_on: event.effective_on(),
                actor: event.authorization().actor().to_string(),
                reason: event.authorization().reason().to_string(),
                at: event.authorization().at(),
            })
            .collect(),
        code_history: record
            .employee
            .code_history()
            .iter()
            .map(|correction| EmployeeCodeCorrectionView {
                from: correction.from().to_string(),
                to: correction.to().to_string(),
                actor: correction.authorization().actor().to_string(),
                reason: correction.authorization().reason().to_string(),
            })
            .collect(),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn personal_data_view(employee_id: &str, profile: &Profile) -> PersonalDataView {
    PersonalDataView {
        employee_id: employee_id.to_owned(),
        full_name: profile.name().as_str().to_owned(),
        nik: profile.nik().as_str().to_owned(),
        birth_date: profile.birth_date(),
        address: profile.address().as_str().to_owned(),
        phone: profile.phone().map(|value| value.as_str().to_owned()),
        email: profile.email().map(|value| value.as_str().to_owned()),
        amendments: profile
            .amendments()
            .iter()
            .map(|amendment| ProfileAmendmentView {
                field: amendment.change().field().to_owned(),
                actor: amendment.authorization().actor().to_string(),
                at: amendment.authorization().at(),
                reason: amendment.authorization().reason().to_string(),
            })
            .collect(),
    }
}

fn contracts_view(record: &EmployeeRecord, as_of: NaiveDate) -> ContractsView {
    ContractsView {
        employee_id: record.employee.id().to_string(),
        contracts: record
            .contracts
            .contracts()
            .iter()
            .map(|contract| ContractView {
                kind: contract.kind().code().to_owned(),
                starts_on: contract.starts_on(),
                ends_on: contract.ends_on(),
                position: contract.position().as_str().to_owned(),
                grade: contract.grade().as_str().to_owned(),
                in_force: contract.covers(as_of),
                actor: contract.authorization().actor().to_string(),
                reason: contract.authorization().reason().to_string(),
            })
            .collect(),
        pkwt_run: record.contracts.pkwt_run().map(|run| PkwtRunView {
            terms: run.terms,
            from: run.from,
            to: run.to,
            days: run.days(),
        }),
    }
}

// ── request bodies ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub place_id: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterBody {
    pub employee_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransitionBody {
    /// `HIRE`, `SUSPEND`, `REINSTATE` or `TERMINATE`.
    pub transition: String,
    pub effective_on: NaiveDate,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodeBody {
    pub employee_code: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignBody {
    pub place_id: String,
    pub valid_from: NaiveDate,
    #[serde(default)]
    pub valid_to: Option<NaiveDate>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkBody {
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrolPersonalDataBody {
    pub full_name: String,
    pub nik: String,
    pub birth_date: NaiveDate,
    pub address: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmendPersonalDataBody {
    /// Exactly one field per amendment. Two at once would be two changes
    /// recorded as one, and the audit trail would say less than it appears to.
    pub field: String,
    /// Absent means "clear it", which only phone and email allow.
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub birth_date: Option<NaiveDate>,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractBody {
    /// `PKWT` or `PKWTT`.
    pub kind: String,
    pub starts_on: NaiveDate,
    /// Required for `PKWT`, refused for `PKWTT`. The domain says so, and so
    /// does the table.
    #[serde(default)]
    pub ends_on: Option<NaiveDate>,
    pub position: String,
    pub grade: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiringQuery {
    /// The date to count from. Defaults to today.
    #[serde(default)]
    pub as_of: Option<NaiveDate>,
    /// How far ahead to look. Defaults to thirty days — the notice period the
    /// workforce screen's first saved view is built around.
    #[serde(default)]
    pub within_days: Option<i64>,
}

// ── handlers ─────────────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<EmployeeSummary>>, AppError> {
    if !role_allows(
        required_role_for_action(actions::EMPLOYEE_READ),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not read the workforce",
            principal.username
        )));
    }
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    Ok(Json(
        infrastructure::list_employees(
            &state.db,
            query.status.as_deref(),
            query.place_id.as_deref(),
            limit,
        )
        .await?,
    ))
}

pub async fn register(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<RegisterBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = Access {
        employee_id: String::new(),
        own: false,
        principal,
    };
    access.may(actions::EMPLOYEE_CREATE)?;

    // The id is minted here and never taken from the caller: an id chosen by a
    // client is an id that can be made to collide with somebody else's.
    let employee_id = format!("emp_{}", Uuid::new_v4().simple());
    let employee = Employee::try_register(&employee_id, &body.employee_code).map_err(invalid)?;
    infrastructure::register_employee(&state.db, &employee).await?;
    Ok(Json(employee_view(&record(&state, &employee_id).await?)))
}

pub async fn detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    Ok(Json(employee_view(
        &record(&state, &access.employee_id).await?,
    )))
}

pub async fn transition(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<TransitionBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::EMPLOYMENT_CHANGE)?;

    let transition = EmploymentTransition::parse(&body.transition).ok_or_else(|| {
        AppError::Validation(format!(
            "{:?} is not a transition: expected HIRE, SUSPEND, REINSTATE or TERMINATE",
            body.transition
        ))
    })?;
    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::EMPLOYMENT_CHANGE, &body.reason)?;
    record
        .employee
        .apply(transition, body.effective_on, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::save_employee(&state.db, &record.employee).await?;
    Ok(Json(employee_view(&record)))
}

pub async fn correct_code(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<CodeBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::EMPLOYEE_CODE_CORRECT)?;

    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::EMPLOYEE_CODE_CORRECT, &body.reason)?;
    let code = EmployeeCode::try_new(&body.employee_code).map_err(invalid)?;
    record
        .employee
        .correct_code(code, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::save_employee(&state.db, &record.employee).await?;
    Ok(Json(employee_view(&record)))
}

pub async fn assign(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<AssignBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ASSIGNMENT_MANAGE)?;

    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::ASSIGNMENT_MANAGE, &body.reason)?;
    let span = AssignmentSpan::try_new(
        PlaceId::try_new(&body.place_id).map_err(invalid)?,
        body.valid_from,
        body.valid_to,
        authorization,
    )
    .map_err(invalid)?;
    // Pushing is where the overlap rule fires, on the whole timeline rather
    // than on the row about to be written.
    record
        .assignments
        .push(span)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::replace_assignments(&state.db, &access.employee_id, &record.assignments)
        .await?;
    Ok(Json(employee_view(&record)))
}

pub async fn link_account(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<LinkBody>,
) -> Result<Json<EmployeeView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::ACCOUNT_LINK)?;
    infrastructure::link_account(&state.db, &access.employee_id, &body.username).await?;
    Ok(Json(employee_view(
        &record(&state, &access.employee_id).await?,
    )))
}

/// Who somebody is at work.
///
/// The employee app calls this for its holder on the screen that shows job
/// title, place and joining date. It is `people.employee.read`, not
/// `people.profile.read`: none of it is personal data.
pub async fn employment_profile(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<EmploymentProfileView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = record(&state, &access.employee_id).await?;

    let current = record.assignments.current();
    let place_id = current.map(|span| span.place_id().to_string());
    let place_name = match &place_id {
        Some(place_id) => infrastructure::place_name(&state.db, place_id).await?,
        None => None,
    };
    let latest = record.contracts.current();

    Ok(Json(EmploymentProfileView {
        employee_id: record.employee.id().to_string(),
        employee_code: record.employee.code().to_string(),
        full_name: record
            .profile
            .as_ref()
            .map(|profile| profile.name().as_str().to_owned()),
        status: record.employee.status(),
        job_title: latest.map(|contract| contract.position().as_str().to_owned()),
        grade: latest.map(|contract| contract.grade().as_str().to_owned()),
        place_id,
        place_name,
        // The first HIRE, read out of the history rather than stored beside it.
        joined_on: record
            .employee
            .history()
            .iter()
            .find(|event| event.transition() == EmploymentTransition::Hire)
            .map(|event| event.effective_on()),
    }))
}

pub async fn read_personal_data(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<PersonalDataView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::PROFILE_READ)?;
    let record = record(&state, &access.employee_id).await?;
    let profile = record.profile.ok_or_else(|| {
        AppError::NotFound(format!(
            "no personal data has been recorded for {}",
            access.employee_id
        ))
    })?;
    Ok(Json(personal_data_view(&access.employee_id, &profile)))
}

pub async fn enrol_personal_data(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<EnrolPersonalDataBody>,
) -> Result<Json<PersonalDataView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PROFILE_CHANGE)?;

    let record = record(&state, &access.employee_id).await?;
    if record.profile.is_some() {
        // Not an overwrite: the amendment route is how a recorded value
        // changes, and it is the one that leaves a trace.
        return Err(AppError::Conflict(format!(
            "{} already has personal data; amend it rather than re-enrolling",
            access.employee_id
        )));
    }
    let profile = Profile::enrol(
        FullName::try_new(&body.full_name).map_err(invalid)?,
        Nik::try_new(&body.nik).map_err(invalid)?,
        body.birth_date,
        Address::try_new(&body.address).map_err(invalid)?,
    );
    infrastructure::upsert_profile(&state.db, &access.employee_id, &profile).await?;
    Ok(Json(personal_data_view(&access.employee_id, &profile)))
}

pub async fn amend_personal_data(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<AmendPersonalDataBody>,
) -> Result<Json<PersonalDataView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::PROFILE_CHANGE)?;

    let record = record(&state, &access.employee_id).await?;
    let mut profile = record.profile.ok_or_else(|| {
        AppError::NotFound(format!(
            "no personal data has been recorded for {}",
            access.employee_id
        ))
    })?;

    let optional_contact = |value: &Option<String>| -> Result<Option<Contact>, AppError> {
        value
            .as_deref()
            .map(|raw| Contact::try_new(raw).map_err(invalid))
            .transpose()
    };
    let required = |what: &str| -> Result<&str, AppError> {
        body.value
            .as_deref()
            .ok_or_else(|| AppError::Validation(format!("{what} cannot be cleared")))
    };

    let field = match body.field.as_str() {
        "name" => ProfileField::Name(FullName::try_new(required("name")?).map_err(invalid)?),
        "nik" => ProfileField::Nik(Nik::try_new(required("nik")?).map_err(invalid)?),
        "birth_date" => ProfileField::BirthDate(body.birth_date.ok_or_else(|| {
            AppError::Validation("amending birth_date needs a birth_date".to_owned())
        })?),
        "address" => {
            ProfileField::Address(Address::try_new(required("address")?).map_err(invalid)?)
        }
        "phone" => ProfileField::Phone(optional_contact(&body.value)?),
        "email" => ProfileField::Email(optional_contact(&body.value)?),
        other => {
            return Err(AppError::Validation(format!(
                "{other:?} is not an amendable field: expected name, nik, birth_date, \
                 address, phone or email"
            )))
        }
    };

    let authorization = access.authorize(actions::PROFILE_CHANGE, &body.reason)?;
    profile
        .amend(field, authorization)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::upsert_profile(&state.db, &access.employee_id, &profile).await?;
    Ok(Json(personal_data_view(&access.employee_id, &profile)))
}

pub async fn read_contracts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<ContractsView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    let record = record(&state, &access.employee_id).await?;
    Ok(Json(contracts_view(&record, Utc::now().date_naive())))
}

pub async fn add_contract(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<ContractBody>,
) -> Result<Json<ContractsView>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may(actions::CONTRACT_CHANGE)?;

    // The pairing UU 13/2003 art. 59 turns on, refused here as a bad request
    // rather than passed down to become a constraint violation.
    let kind = match (body.kind.as_str(), body.ends_on) {
        ("PKWT", Some(ends_on)) => ContractKind::Pkwt { ends_on },
        ("PKWT", None) => {
            return Err(AppError::Validation(
                "a PKWT is a fixed term and must say when it ends".to_owned(),
            ))
        }
        ("PKWTT", None) => ContractKind::Pkwtt,
        ("PKWTT", Some(_)) => {
            return Err(AppError::Validation(
                "a PKWTT is permanent and cannot carry an end date".to_owned(),
            ))
        }
        (other, _) => {
            return Err(AppError::Validation(format!(
                "{other:?} is not a contract kind: expected PKWT or PKWTT"
            )))
        }
    };

    let mut record = record(&state, &access.employee_id).await?;
    let authorization = access.authorize(actions::CONTRACT_CHANGE, &body.reason)?;
    let contract = Contract::try_new(
        kind,
        body.starts_on,
        Position::try_new(&body.position).map_err(invalid)?,
        Grade::try_new(&body.grade).map_err(invalid)?,
        authorization,
    )
    .map_err(invalid)?;
    record
        .contracts
        .append(contract)
        .map_err(|error| AppError::Conflict(error.to_string()))?;
    infrastructure::replace_contracts(&state.db, &access.employee_id, &record.contracts).await?;
    Ok(Json(contracts_view(&record, Utc::now().date_naive())))
}

/// Which fixed terms are running out.
///
/// The report that made contracts a table rather than a JSONB column.
pub async fn expiring(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ExpiringQuery>,
) -> Result<Json<Vec<ExpiringContract>>, AppError> {
    if !role_allows(
        required_role_for_action(actions::EMPLOYEE_READ),
        principal.role,
    ) {
        return Err(AppError::Forbidden(format!(
            "{} may not read the workforce",
            principal.username
        )));
    }
    let as_of = query.as_of.unwrap_or_else(|| Utc::now().date_naive());
    let within = query.within_days.unwrap_or(30).clamp(0, 3650);
    let before = as_of + chrono::Duration::days(within);
    Ok(Json(
        infrastructure::expiring_contracts(&state.db, as_of, before).await?,
    ))
}
