//! The organisation (0805): the handlers.
//!
//! Reading the structure is anybody's who may read employees — a manager
//! looks up whom somebody reports to. Changing it is head office's, under the
//! same key as changing somebody's employment.

use super::auth::Principal;
use super::employment::resolve;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows, Authorization},
    postgres::{
        self as infrastructure, BusinessUnitView, CompanyView, DepartmentView, GroupEntityView, JobGradeView, JobLevelView,
        OrgChartNode, PlacementView,
    },
};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;

fn require(principal: &Principal, action_key: &str) -> Result<(), AppError> {
    if role_allows(required_role_for_action(action_key), principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {action_key}",
        principal.username
    )))
}

fn authority(principal: &Principal, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(
        &principal.username,
        actions::EMPLOYMENT_CHANGE,
        Utc::now(),
        reason,
    )
    .map_err(|error| AppError::Validation(error.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReasonBody {
    pub reason: String,
}

// ── departments ─────────────────────────────────────────────────────────────

pub async fn departments(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<DepartmentView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::departments(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveDepartmentBody {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub parent_code: Option<String>,
    pub reason: String,
}

pub async fn save_department(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveDepartmentBody>,
) -> Result<Json<Vec<DepartmentView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::save_department(
        &state.db,
        &body.code,
        &body.name,
        body.parent_code.as_deref(),
        &by,
    )
    .await?;
    Ok(Json(infrastructure::departments(&state.db).await?))
}

pub async fn retire_department(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<DepartmentView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::retire_department(&state.db, &code, &by).await?;
    Ok(Json(infrastructure::departments(&state.db).await?))
}

// ── job levels ──────────────────────────────────────────────────────────────

pub async fn job_levels(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<JobLevelView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::job_levels(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveJobLevelBody {
    pub code: String,
    pub name: String,
    pub rank: i32,
    pub reason: String,
}

pub async fn save_job_level(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveJobLevelBody>,
) -> Result<Json<Vec<JobLevelView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::save_job_level(&state.db, &body.code, &body.name, body.rank, &by).await?;
    Ok(Json(infrastructure::job_levels(&state.db).await?))
}

pub async fn retire_job_level(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<JobLevelView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::retire_job_level(&state.db, &code, &by).await?;
    Ok(Json(infrastructure::job_levels(&state.db).await?))
}

// ── grades ──────────────────────────────────────────────────────────────────

pub async fn job_grades(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<JobGradeView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::job_grades(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveJobGradeBody {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub level_code: Option<String>,
    #[serde(default)]
    pub grade_class: Option<String>,
    #[serde(default)]
    pub min_minor: Option<i64>,
    #[serde(default)]
    pub max_minor: Option<i64>,
    pub reason: String,
}

pub async fn save_job_grade(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveJobGradeBody>,
) -> Result<Json<Vec<JobGradeView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::save_job_grade(
        &state.db,
        &body.code,
        &body.name,
        body.level_code.as_deref(),
        body.grade_class.as_deref(),
        body.min_minor,
        body.max_minor,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::job_grades(&state.db).await?))
}

pub async fn retire_job_grade(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<JobGradeView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::retire_job_grade(&state.db, &code, &by).await?;
    Ok(Json(infrastructure::job_grades(&state.db).await?))
}

// ── placements ──────────────────────────────────────────────────────────────

/// Where somebody sits, newest first. `me` reads one's own.
pub async fn placements(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
) -> Result<Json<Vec<PlacementView>>, AppError> {
    let access = resolve(&state, &principal, &raw).await?;
    access.may_read(actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::placements_of(&state.db, &access.employee_id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PlaceBody {
    pub effective_from: NaiveDate,
    #[serde(default)]
    pub department_code: Option<String>,
    #[serde(default)]
    pub level_code: Option<String>,
    #[serde(default)]
    pub grade_code: Option<String>,
    #[serde(default)]
    pub reports_to: Option<String>,
    pub reason: String,
}

pub async fn place(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(raw): Path<String>,
    Json(body): Json<PlaceBody>,
) -> Result<Json<Vec<PlacementView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    if raw == "me" {
        return Err(AppError::Forbidden("nobody places themselves".into()));
    }
    let access = resolve(&state, &principal, &raw).await?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::place_employee(
        &state.db,
        &access.employee_id,
        body.effective_from,
        body.department_code.as_deref(),
        body.level_code.as_deref(),
        body.grade_code.as_deref(),
        body.reports_to.as_deref(),
        &by,
    )
    .await?;
    Ok(Json(infrastructure::placements_of(&state.db, &access.employee_id).await?))
}

pub async fn chart(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<OrgChartNode>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::org_chart(&state.db).await?))
}

// ── company ─────────────────────────────────────────────────────────────────

pub async fn company(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<CompanyView>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::company(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RegisterBpjsBody {
    pub effective_from: NaiveDate,
    #[serde(default)]
    pub npp: Option<String>,
    #[serde(default)]
    pub kesehatan_code: Option<String>,
    #[serde(default)]
    pub jkk_risk_class: Option<String>,
    pub reason: String,
}

pub async fn register_bpjs(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<RegisterBpjsBody>,
) -> Result<Json<CompanyView>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::register_bpjs(
        &state.db,
        body.effective_from,
        body.npp.as_deref(),
        body.kesehatan_code.as_deref(),
        body.jkk_risk_class.as_deref(),
        &by,
    )
    .await?;
    Ok(Json(infrastructure::company(&state.db).await?))
}

// ── business units and the group ───────────────────────────────────────────

pub async fn business_units(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<BusinessUnitView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::business_units(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveBusinessUnitBody {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub units: Vec<String>,
    pub reason: String,
}

pub async fn save_business_unit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveBusinessUnitBody>,
) -> Result<Json<Vec<BusinessUnitView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::save_business_unit(&state.db, &body.code, &body.name, &body.units, &by)
        .await?;
    Ok(Json(infrastructure::business_units(&state.db).await?))
}

pub async fn group(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<GroupEntityView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::group_entities(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveGroupEntityBody {
    pub code: String,
    pub name: String,
    pub relation: String,
    #[serde(default)]
    pub tax_id: Option<String>,
    pub reason: String,
}

pub async fn save_group_entity(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveGroupEntityBody>,
) -> Result<Json<Vec<GroupEntityView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    let by = authority(&principal, &body.reason)?;
    infrastructure::save_group_entity(
        &state.db,
        &body.code,
        &body.name,
        &body.relation,
        body.tax_id.as_deref(),
        &by,
    )
    .await?;
    Ok(Json(infrastructure::group_entities(&state.db).await?))
}

pub async fn remove_group_entity(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(code): Path<String>,
) -> Result<Json<Vec<GroupEntityView>>, AppError> {
    require(&principal, actions::EMPLOYMENT_CHANGE)?;
    infrastructure::remove_group_entity(&state.db, &code).await?;
    Ok(Json(infrastructure::group_entities(&state.db).await?))
}

// ── onboarding and separation checklists (0806) ─────────────────────────────

pub async fn checklist_templates(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<infrastructure::ChecklistTemplateView>>, AppError> {
    require(&principal, actions::EMPLOYEE_READ)?;
    Ok(Json(infrastructure::checklist_templates(&state.db).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SaveChecklistTemplateBody {
    pub id: String,
    pub label: String,
    pub owner: String,
    pub kind: String,
    pub position: i32,
    pub reason: String,
}

fn checklist_authority(principal: &Principal, reason: &str) -> Result<Authorization, AppError> {
    Authorization::try_new(&principal.username, actions::LIFECYCLE_MANAGE, Utc::now(), reason)
        .map_err(|error| AppError::Validation(error.to_string()))
}

pub async fn save_checklist_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<SaveChecklistTemplateBody>,
) -> Result<Json<Vec<infrastructure::ChecklistTemplateView>>, AppError> {
    require(&principal, actions::LIFECYCLE_MANAGE)?;
    let by = checklist_authority(&principal, &body.reason)?;
    infrastructure::save_checklist_template(
        &state.db,
        &body.id,
        &body.label,
        &body.owner,
        &body.kind,
        body.position,
        &by,
    )
    .await?;
    Ok(Json(infrastructure::checklist_templates(&state.db).await?))
}

pub async fn retire_checklist_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<String>,
    Json(body): Json<ReasonBody>,
) -> Result<Json<Vec<infrastructure::ChecklistTemplateView>>, AppError> {
    require(&principal, actions::LIFECYCLE_MANAGE)?;
    let by = checklist_authority(&principal, &body.reason)?;
    infrastructure::retire_checklist_template(&state.db, &id, &by).await?;
    Ok(Json(infrastructure::checklist_templates(&state.db).await?))
}
