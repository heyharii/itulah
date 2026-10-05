//! Head office's background jobs on the System screen (0703): how each is
//! doing, what its recent passes did and could not do, and the three things a
//! person may do about one — run it now, pause it, let it run again.
//!
//! Under `/api/v1/fleet/jobs` because the jobs are head office's own row of
//! the fleet page, and so the `system` section and the fleet's rung apply to
//! them as they do to the rest of it. Reading is the page's; the three acts
//! are the Admin's (`required_role`), and checked here as well so a
//! `role_permission` override cannot hand them to somebody else.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::Role,
    postgres::{self as infrastructure, JobList, JobRunRow, JobStatus},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;

fn require_admin(principal: &Principal, act: &str) -> Result<(), AppError> {
    if principal.role >= Role::Admin {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may not {act}: background jobs are the Admin's",
        principal.username
    )))
}

pub async fn jobs(State(state): State<AppState>) -> Result<Json<JobList>, AppError> {
    Ok(Json(infrastructure::jobs::list_jobs(&state.db).await?))
}

#[derive(Debug, Deserialize)]
pub struct RunQuery {
    pub limit: Option<i64>,
}

pub async fn job_runs(
    State(state): State<AppState>,
    Path(job): Path<String>,
    Query(query): Query<RunQuery>,
) -> Result<Json<Vec<JobRunRow>>, AppError> {
    Ok(Json(
        infrastructure::jobs::job_runs(&state.db, &job, query.limit.unwrap_or(50)).await?,
    ))
}

pub async fn run_job(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(job): Path<String>,
) -> Result<Json<JobStatus>, AppError> {
    require_admin(&principal, "ask a job to run")?;
    Ok(Json(
        infrastructure::jobs::request_job_run(&state.db, &job, &principal.username).await?,
    ))
}

pub async fn pause_job(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(job): Path<String>,
) -> Result<Json<JobStatus>, AppError> {
    require_admin(&principal, "pause a job")?;
    Ok(Json(
        infrastructure::jobs::set_job_paused(&state.db, &job, true, &principal.username).await?,
    ))
}

pub async fn resume_job(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(job): Path<String>,
) -> Result<Json<JobStatus>, AppError> {
    require_admin(&principal, "resume a job")?;
    Ok(Json(
        infrastructure::jobs::set_job_paused(&state.db, &job, false, &principal.username).await?,
    ))
}
