//! The confidential channel, on the wire.
//!
//! # Three ways in, and one of them is the point
//!
//! A person files their own grievance under `people.grievance.request_own`,
//! which everybody signed in holds and which reaches nothing but complaints
//! they themselves filed — because a grievance about your own supervisor
//! that has to be handed to your supervisor is not a confidential channel.
//! A place manager may file on a colleague's behalf under
//! `people.grievance.file`, bounded by their posting. The queue itself is
//! `people.grievance.read`, mapped ADMIN: investigating and resolving are
//! two further, disjoint ADMIN keys, and the domain refuses the filer doing
//! either no matter which key it arrived under.
//!
//! # One route, two answers, by the rung the caller holds
//!
//! `GET /grievances` gives head office the whole queue, and a bounded caller
//! only the rows they themselves filed. The branch is on the role mapping,
//! not on a query flag — a caller who cannot read the queue never receives
//! somebody else's complaint by asking nicely. The screen reads the same
//! route for both faces.
//!
//! # The catalogue reads for free
//!
//! Like the claim types and the leave kinds: somebody filing a grievance has
//! to know which kinds exist before they can ask, and the list names nobody.

use super::auth::Principal;
use super::employment::{current_place, invalid, reach_of, resolve};
use crate::cloud::{
    application::{AppError, AppState},
    domain::{
        actions, required_role_for_action, role_allows, Authorization, EmployeeGrievance,
        EmployeeId, GrievanceId, GrievanceType, GrievanceTypeCode, PlaceId,
    },
    postgres::{self as infrastructure, GrievanceView},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

// ── the catalogue ────────────────────────────────────────────────────────

pub async fn list_types(
    State(state): State<AppState>,
) -> Result<Json<Vec<infrastructure::GrievanceTypeView>>, AppError> {
    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    Ok(Json(
        catalogue
            .types()
            .iter()
            .map(infrastructure::grievance_type_view)
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DefineTypeBody {
    pub code: String,
    pub name: String,
}

/// Ratify a kind. Head office's; one INSERT, because a grievance kind names
/// no account and seeds no map rows — the weight the claim catalogue carried
/// was its postings', and this catalogue has none.
pub async fn define_type(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<DefineTypeBody>,
) -> Result<Json<Vec<infrastructure::GrievanceTypeView>>, AppError> {
    require(&principal, actions::GRIEVANCE_TYPE_SET)?;
    let grievance_type = GrievanceType::try_new(
        GrievanceTypeCode::try_new(&body.code).map_err(invalid)?,
        &body.name,
        Utc::now(),
    )
    .map_err(infrastructure::grievance_error)?;
    infrastructure::define_grievance_type(&state.db, &grievance_type).await?;
    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    Ok(Json(
        catalogue
            .types()
            .iter()
            .map(infrastructure::grievance_type_view)
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetireTypeBody {
    pub reason: String,
}

/// Retire a kind, never delete: every grievance filed under it keeps
/// resolving, and no new grievance may name it.
pub async fn retire_type(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<RetireTypeBody>,
) -> Result<Json<Vec<infrastructure::GrievanceTypeView>>, AppError> {
    require(&principal, actions::GRIEVANCE_TYPE_SET)?;
    if body.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "retiring a grievance kind needs a reason; the grievances already filed under it \
             have to be answerable"
                .into(),
        ));
    }
    let code = GrievanceTypeCode::try_new(&code).map_err(invalid)?;
    infrastructure::retire_grievance_type(&state.db, &code, body.reason.trim(), Utc::now()).await?;
    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    Ok(Json(
        catalogue
            .types()
            .iter()
            .map(infrastructure::grievance_type_view)
            .collect(),
    ))
}

// ── the queue and the own-filing list ────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrievanceQuery {
    #[serde(default)]
    pub state: Option<String>,
}

/// The queue, or the caller's own filings, by the rung they hold.
///
/// Head office reads the whole queue — every place's, because that is what
/// makes the channel HO's. A bounded caller reads only the grievances they
/// themselves filed, which is the `filed_by` bound and nothing else: rows
/// raised against them, or raised by them but filed by a manager, are
/// somebody else's lane and would end the channel the day somebody worked
/// out that filing one was a list of who complained about whom.
pub async fn list_grievances(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<GrievanceQuery>,
) -> Result<Json<Vec<GrievanceView>>, AppError> {
    let queue_reader = role_allows(
        required_role_for_action(actions::GRIEVANCE_READ),
        principal.role,
    );
    let filed_by = if queue_reader {
        None
    } else {
        Some(principal.username.as_str())
    };
    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    let records =
        infrastructure::list_grievances(&state.db, &catalogue, query.state.as_deref(), filed_by)
            .await?;
    records
        .iter()
        .map(infrastructure::grievance_view)
        .collect::<Result<Vec<GrievanceView>, AppError>>()
        .map(Json)
}

// ── filing ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileBody {
    /// The person the grievance is about — the complainant. Absent or `me`
    /// when the caller files their own; a manager filing on behalf names the
    /// colleague and files under `people.grievance.file`.
    #[serde(default)]
    pub employee_id: Option<String>,
    pub type_code: String,
    /// Optional: a person, when the complaint names one. Never reach-checked
    /// — the accused's identity is the complaint, and the queue is HO's
    /// precisely so the complaint about a supervisor does not stop at one.
    #[serde(default)]
    pub against_employee: Option<String>,
    pub subject: String,
    pub description: String,
    #[serde(default)]
    pub cause: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// File a grievance.
///
/// The key the grievance is recorded under is the one that actually applied —
/// `request_own` for somebody filing their own, `file` for a manager filing
/// on a colleague's behalf — so the stored grievance says which authority it
/// rested on rather than which one the handler happened to check first.
pub async fn file(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<FileBody>,
) -> Result<Json<GrievanceView>, AppError> {
    let subject = body.employee_id.as_deref().unwrap_or("me");
    let access = resolve(&state, &principal, subject).await?;
    let action_key = if access.own {
        actions::GRIEVANCE_REQUEST_OWN
    } else {
        actions::GRIEVANCE_FILE
    };
    access.may(action_key)?;

    // Where the complainant is posted, which is where the grievance arises.
    // Read from the employment record rather than taken from the body: a
    // body that named its own place would be a grievance that chose its own
    // shelf.
    let record = infrastructure::load_employee(&state.db, &access.employee_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("employee {}", access.employee_id)))?;
    access.reaches(current_place(&record))?;
    let place = current_place(&record).ok_or_else(|| {
        AppError::Conflict(format!(
            "{} is not posted anywhere, so there is no place their grievance arises in",
            access.employee_id
        ))
    })?;

    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    let type_code = GrievanceTypeCode::try_new(&body.type_code).map_err(invalid)?;
    let against = match body.against_employee.as_deref() {
        None => None,
        Some(raw) if raw.trim().is_empty() || raw == "me" => None,
        Some(raw) => Some(
            EmployeeId::try_new(raw).map_err(|error| AppError::Validation(error.to_string()))?,
        ),
    };

    let grievance_id = Uuid::new_v4();
    let grievance = EmployeeGrievance::file(
        GrievanceId::try_new(&grievance_id.to_string()).map_err(invalid)?,
        PlaceId::try_new(place).map_err(invalid)?,
        EmployeeId::try_new(&access.employee_id)
            .map_err(|error| AppError::Validation(error.to_string()))?,
        against,
        body.subject,
        body.description,
        body.cause,
        &catalogue,
        &type_code,
        access.authorize(
            action_key,
            body.reason.as_deref().unwrap_or("grievance filed"),
        )?,
    )
    .map_err(infrastructure::grievance_error)?;

    infrastructure::insert_grievance(&state.db, &grievance).await?;
    read_back(&state, grievance_id).await.map(Json)
}

async fn read_back(state: &AppState, grievance_id: Uuid) -> Result<GrievanceView, AppError> {
    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    let record = infrastructure::load_grievance(&state.db, grievance_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("grievance {grievance_id}")))?;
    infrastructure::grievance_view(&record)
}

// ── the transitions ──────────────────────────────────────────────────────

/// The grievance to act on, folded. Loading only — the key checks live with
/// the routes that need them, because the queue's reads and its writes
/// answer to different keys on purpose.
async fn loaded(state: &AppState, grievance_id: Uuid) -> Result<EmployeeGrievance, AppError> {
    let catalogue = infrastructure::load_grievance_type_catalogue(&state.db).await?;
    let record = infrastructure::load_grievance(&state.db, grievance_id, &catalogue)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("grievance {grievance_id}")))?;
    Ok(record.grievance)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvestigationBody {
    pub note: String,
}

/// Take it up. ADMIN, disjoint from deciding; the domain refuses the filer
/// investigating their own filing, so the channel never closes its own
/// complaint.
pub async fn investigation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(grievance_id): Path<Uuid>,
    Json(body): Json<InvestigationBody>,
) -> Result<Json<GrievanceView>, AppError> {
    require(&principal, actions::GRIEVANCE_INVESTIGATE)?;
    let mut grievance = loaded(&state, grievance_id).await?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::GRIEVANCE_INVESTIGATE,
        Utc::now(),
        &body.note,
    )
    .map_err(invalid)?;
    infrastructure::record_investigation(&state.db, &mut grievance, authorization).await?;
    read_back(&state, grievance_id).await.map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolutionBody {
    /// Upheld (`RESOLVED`) or refused as never a grievance (`INVALID`).
    pub valid: bool,
    pub detail: String,
}

/// Resolve it. ADMIN, disjoint from investigating; only an investigated
/// grievance resolves, and the detail is the decision's record.
pub async fn resolution(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(grievance_id): Path<Uuid>,
    Json(body): Json<ResolutionBody>,
) -> Result<Json<GrievanceView>, AppError> {
    require(&principal, actions::GRIEVANCE_DECIDE)?;
    let mut grievance = loaded(&state, grievance_id).await?;
    let authorization = Authorization::try_new(
        &principal.username,
        actions::GRIEVANCE_DECIDE,
        Utc::now(),
        &body.detail,
    )
    .map_err(invalid)?;
    infrastructure::record_resolution(&state.db, &mut grievance, body.valid, authorization).await?;
    read_back(&state, grievance_id).await.map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawalBody {
    pub reason: String,
}

/// Take it back. The filer's, from OPEN or INVESTIGATED; anyone else who
/// wants a grievance gone must resolve it, which records their name.
///
/// The filing key is chosen the same way filing chose it — the caller's own
/// complaint answers to `request_own`, a colleague's to `file` — and either
/// way the grievance's filer must be the caller, which the domain re-checks.
/// A grievance that names nobody the caller filed is simply not found: it
/// belongs to somebody else's lane and saying so would be a queue leak.
pub async fn withdrawal(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(grievance_id): Path<Uuid>,
    Json(body): Json<WithdrawalBody>,
) -> Result<Json<GrievanceView>, AppError> {
    let mut grievance = loaded(&state, grievance_id).await?;
    let caller = infrastructure::caller_record(&state.db, &principal.username).await?;
    let own = caller
        .employee_id
        .as_deref()
        .is_some_and(|mine| mine == grievance.raised_by().as_str());
    let action_key = if own {
        actions::GRIEVANCE_REQUEST_OWN
    } else {
        actions::GRIEVANCE_FILE
    };
    if !role_allows(required_role_for_action(action_key), principal.role) {
        return Err(AppError::Forbidden(format!(
            "{} may not {action_key}",
            principal.username
        )));
    }
    if !own {
        // A supervisor act on a colleague's grievance is bounded by the
        // caller's own posting, like every other place-scoped write.
        let reach = reach_of(&state, &principal).await?;
        if !reach.covers(Some(grievance.place().as_str())) {
            return Err(AppError::Forbidden(format!(
                "{} is not posted anywhere that reaches {}",
                principal.username,
                grievance.place()
            )));
        }
    }
    if grievance.filed_by() != principal.username {
        return Err(AppError::NotFound(format!("grievance {grievance_id}")));
    }
    let authorization =
        Authorization::try_new(&principal.username, action_key, Utc::now(), &body.reason)
            .map_err(invalid)?;
    infrastructure::record_grievance_withdrawal(&state.db, &mut grievance, authorization).await?;
    read_back(&state, grievance_id).await.map(Json)
}
