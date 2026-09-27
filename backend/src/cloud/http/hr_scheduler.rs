//! The clock's own surface: what the HR scheduler ran, and a door to run it
//! now.
//!
//! Reading the ledger needs the same rung as running it — head office — because
//! one run row names every place's morning and a backfill can mint salary days.
//! The jobs themselves carry `hr-scheduler` as their actor and the authority
//! each row needs (`people.roster.manage`, `people.leave.grant`); this surface
//! only asks *when*.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{actions, required_role_for_action, role_allows},
    postgres::{self as infrastructure, SchedulerJobResult, ScheduledRunView},
};
use axum::{extract::State, routing::{get, post}, Extension, Json, Router};
use chrono::NaiveDate;
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunQuery {
    /// How many of the newest claims to show.
    #[serde(default)]
    pub limit: Option<i64>,
}

/// What the clock has done, newest first.
pub async fn list_runs(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    axum::extract::Query(query): axum::extract::Query<RunQuery>,
) -> Result<Json<Vec<ScheduledRunView>>, AppError> {
    require(&principal, actions::HR_SCHEDULER_READ)?;
    let limit = query.limit.unwrap_or(50);
    infrastructure::recent_runs(&state.db, limit)
        .await
        .map(Json)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunNowBody {
    /// The business day to run for. Absent means today where the shops are.
    /// A date is accepted for a backfill or a test, and a reason is required
    /// for the same reason every other backfill door asks for one.
    #[serde(default)]
    pub as_of: Option<NaiveDate>,
    pub reason: String,
}

/// Run the whole pass now, for one business day.
///
/// This is the same `run_all` the worker calls on its tick, so a manual run
/// cannot diverge from the automatic one: claims already made are reported
/// `SKIPPED`, failures are reported `FAILED`, and the run ledger records both.
pub async fn run_now(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(body): Json<RunNowBody>,
) -> Result<Json<Vec<SchedulerJobResult>>, AppError> {
    require(&principal, actions::HR_SCHEDULER_RUN)?;
    if body.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "running the schedule by hand needs a reason; the run ledger has nowhere else to put it"
                .into(),
        ));
    }
    let on = body.as_of.unwrap_or_else(crate::reporting::local_today);
    let results = infrastructure::run_all(&state.db, on).await;
    // The jobs stamped their own rows; this one says who asked for the pass by
    // hand, on which day, and why. It is the only place that reason is kept —
    // the activity log records the request and not its body — so it is written
    // before the answer goes back.
    infrastructure::record_manual_run(
        &state.db,
        on,
        &principal.username,
        body.reason.trim(),
        &results,
    )
    .await?;
    Ok(Json(results))
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/api/v1/hr-scheduler/runs", get(list_runs))
        .route("/api/v1/hr-scheduler/run-now", post(run_now))
}
