//! Projects over HTTP (0997): GA's half under `/api/v1/ga/projects`, Finance's
//! half under `/api/v1/finance/contractor-projects/{id}`. The path prefixes are
//! what the job sections and roles gate, as for every other route of either
//! department. See `postgres/ga_projects.rs` and `postgres/project_costs.rs`.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{role_allows, Role},
    postgres::{
        self as infrastructure, AddGaProjectTaskRequest, CapitaliseProjectRequest,
        CloseGaProjectRequest, CreateGaProjectRequest, GaProjectPage, GaProjectRow,
        LinkGaProjectRequest, LinkProjectCostRequest, ProjectCost, UpdateGaProjectTaskRequest,
    },
};
use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use uuid::Uuid;

fn allowed(principal: &Principal, needed: Role, act: &str) -> Result<(), AppError> {
    if role_allows(needed, principal.role) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}",
        principal.username
    )))
}

fn today(state: &AppState) -> chrono::NaiveDate {
    state.clock.now().date_naive()
}

/// A caller bound to a site works only in that site's projects.
async fn at_my_site(
    state: &AppState,
    principal: &Principal,
    project_id: Uuid,
) -> Result<(), AppError> {
    let site = infrastructure::ga_project_site(&state.db, project_id).await?;
    principal.may_touch_site(site.as_deref(), "project")
}

// ── GA ──────────────────────────────────────────────────────────────────

pub async fn projects(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<GaProjectRow>>, AppError> {
    allowed(&principal, Role::Supervisor, "read the projects")?;
    Ok(Json(
        infrastructure::ga_projects(&state.db, today(&state), principal.bound_site()).await?,
    ))
}

pub async fn create_project(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateGaProjectRequest>,
) -> Result<Json<GaProjectPage>, AppError> {
    allowed(&principal, Role::Supervisor, "open a project")?;
    principal.may_touch_site(Some(request.site_id.trim()), "project")?;
    Ok(Json(
        infrastructure::ga_project_create(&state.db, &request, &principal.username, today(&state))
            .await?,
    ))
}

pub async fn project(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<GaProjectPage>, AppError> {
    allowed(&principal, Role::Supervisor, "read a project")?;
    at_my_site(&state, &principal, project_id).await?;
    Ok(Json(
        infrastructure::ga_project_page(&state.db, project_id, today(&state)).await?,
    ))
}

pub async fn add_task(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<AddGaProjectTaskRequest>,
) -> Result<Json<GaProjectPage>, AppError> {
    allowed(&principal, Role::Supervisor, "add a task")?;
    at_my_site(&state, &principal, project_id).await?;
    Ok(Json(
        infrastructure::ga_project_add_task(
            &state.db,
            project_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn update_task(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((project_id, task_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<UpdateGaProjectTaskRequest>,
) -> Result<Json<GaProjectPage>, AppError> {
    allowed(&principal, Role::Supervisor, "change a task")?;
    at_my_site(&state, &principal, project_id).await?;
    Ok(Json(
        infrastructure::ga_project_update_task(
            &state.db,
            project_id,
            task_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

pub async fn link(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<LinkGaProjectRequest>,
) -> Result<Json<GaProjectPage>, AppError> {
    allowed(&principal, Role::Supervisor, "change what a project holds")?;
    at_my_site(&state, &principal, project_id).await?;
    Ok(Json(
        infrastructure::ga_project_link(&state.db, project_id, &request, today(&state)).await?,
    ))
}

pub async fn close(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<CloseGaProjectRequest>,
) -> Result<Json<GaProjectPage>, AppError> {
    allowed(&principal, Role::Supervisor, "close a project")?;
    at_my_site(&state, &principal, project_id).await?;
    Ok(Json(
        infrastructure::ga_project_close(
            &state.db,
            project_id,
            &request,
            &principal.username,
            today(&state),
        )
        .await?,
    ))
}

// ── Finance ─────────────────────────────────────────────────────────────

/// The project's own page, read by Finance: the same tasks, assets and work
/// GA sees.
pub async fn finance_project(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<GaProjectPage>, AppError> {
    Ok(Json(
        infrastructure::ga_project_page(&state.db, project_id, today(&state)).await?,
    ))
}

pub async fn costs(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<ProjectCost>>, AppError> {
    Ok(Json(
        infrastructure::project_costs(&state.db, project_id).await?,
    ))
}

pub async fn cost_candidates(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<ProjectCost>>, AppError> {
    Ok(Json(
        infrastructure::project_cost_candidates(&state.db, project_id).await?,
    ))
}

pub async fn link_cost(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<LinkProjectCostRequest>,
) -> Result<Json<Vec<ProjectCost>>, AppError> {
    Ok(Json(
        infrastructure::link_project_cost(&state.db, project_id, &request).await?,
    ))
}

pub async fn capitalise(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<CapitaliseProjectRequest>,
) -> Result<Json<Vec<ProjectCost>>, AppError> {
    Ok(Json(
        infrastructure::capitalise_project(&state.db, project_id, &request, &principal.username)
            .await?,
    ))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/ga/projects", get(projects).post(create_project))
        .route("/api/v1/ga/projects/{project_id}", get(project))
        .route("/api/v1/ga/projects/{project_id}/tasks", post(add_task))
        .route(
            "/api/v1/ga/projects/{project_id}/tasks/{task_id}",
            patch(update_task),
        )
        .route("/api/v1/ga/projects/{project_id}/links", post(link))
        .route("/api/v1/ga/projects/{project_id}/close", post(close))
        .route(
            "/api/v1/finance/contractor-projects/{project_id}/page",
            get(finance_project),
        )
        .route(
            "/api/v1/finance/contractor-projects/{project_id}/costs",
            get(costs).post(link_cost),
        )
        .route(
            "/api/v1/finance/contractor-projects/{project_id}/cost-candidates",
            get(cost_candidates),
        )
        .route(
            "/api/v1/finance/contractor-projects/{project_id}/capitalise",
            post(capitalise),
        )
}
