// The virtual business clock's control surface (VIRTUAL-TIME-PLAN.md §8).
//
// Two routes under `/api/v1/inventory/control/clock` and one response
// middleware. Everything here is double-gated: the routes sit behind the
// Admin-role prefix the router already gives `/api/v1/inventory/control*`,
// and the handlers refuse unless `INVENTORY_ENABLE_TEST_CONTROLS=true` — the
// same fail-closed pattern `control.rs` uses for projection corruption. The
// middleware, by contrast, is free: when the clock is virtual it stamps
// `x-virtual-time` on every response so any client can show business time
// without knowing this endpoint exists.

use axum::{
    extract::{Request, State},
    http::{header::HeaderName, header::HeaderValue},
    response::Response,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::clock::{ClockError, ClockMode, ClockStatus};
use crate::cloud::application::{AppError, AppState};
use crate::cloud::http::auth::Principal;

/// One control operation, named on the wire by `op`. There is deliberately
/// no `allow_backward` flag here: moving the business clock backwards is only
/// ever permitted in the `controlled` mode — a disposable database behind the
/// test-controls flag — and the handler decides that from the mode itself,
/// never from the caller's enthusiasm (plan §7.2).
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClockControlRequest {
    /// Adopt a new clock source. `Scaled` may only move forward; `Controlled`
    /// may move anywhere (it exists for disposable runs).
    SetMode { mode: ClockMode },
    /// Change only the speed, re-anchoring at the current virtual instant —
    /// the virtual time does not jump.
    Rescale { factor: f64 },
    /// Freeze the virtual clock where it now stands.
    Pause,
    /// Continue from the frozen point; the pause never happened to the
    /// business calendar.
    Resume,
    /// Move a virtual clock to a chosen instant (the Stripe `advance`).
    AdvanceTo { at: DateTime<Utc> },
}

fn require_test_controls(state: &AppState) -> Result<(), AppError> {
    if state.config.enable_test_controls {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "test controls are disabled; set INVENTORY_ENABLE_TEST_CONTROLS=true only in a \
             disposable environment"
                .into(),
        ))
    }
}

fn map_clock_error(error: ClockError) -> AppError {
    match error {
        ClockError::Validation(message) => AppError::Validation(message),
        // A backward move is a conflict with what the clock already said and
        // what date-keyed documents already exist (plan §7.2).
        ClockError::BackwardJump { current, attempted } => AppError::Conflict(format!(
            "the business clock cannot move backwards from {current} to {attempted}; re-anchor \
             forward, rescale, or use the controlled mode on a disposable database"
        )),
    }
}

/// Whether a set-mode/advance may move backwards: only under `Controlled`,
/// where the database is disposable by definition.
fn backward_permitted(source: &ClockMode, prospective: &ClockMode) -> bool {
    matches!(prospective, ClockMode::Controlled { .. })
        || matches!(source, ClockMode::Controlled { .. })
}

pub async fn clock_status(State(state): State<AppState>) -> Result<Json<ClockStatus>, AppError> {
    require_test_controls(&state)?;
    Ok(Json(state.clock.status()))
}

pub async fn clock_control(
    State(state): State<AppState>,
    principal: Option<Extension<Principal>>,
    Json(request): Json<ClockControlRequest>,
) -> Result<Json<ClockStatus>, AppError> {
    require_test_controls(&state)?;
    let before = state.clock.status();
    let status = match &request {
        ClockControlRequest::SetMode { mode } => state
            .clock
            .set_mode(mode.clone(), backward_permitted(&before.source, mode))
            .map_err(map_clock_error)?,
        ClockControlRequest::Rescale { factor } => {
            state.clock.rescale(*factor).map_err(map_clock_error)?
        }
        ClockControlRequest::Pause => state.clock.pause().map_err(map_clock_error)?,
        ClockControlRequest::Resume => state.clock.resume().map_err(map_clock_error)?,
        ClockControlRequest::AdvanceTo { at } => state
            .clock
            .advance_to(*at, backward_permitted(&before.source, &before.source))
            .map_err(map_clock_error)?,
    };
    // The epoch table is evidence, not a gate: a failed insert must not undo
    // the clock change, so it logs and moves on, exactly like the audit
    // middleware does.
    let op = match &request {
        ClockControlRequest::SetMode { .. } => "set_mode",
        ClockControlRequest::Rescale { .. } => "rescale",
        ClockControlRequest::Pause => "pause",
        ClockControlRequest::Resume => "resume",
        ClockControlRequest::AdvanceTo { .. } => "advance_to",
    };
    if let Err(error) = crate::cloud::postgres::control::record_clock_epoch(
        &state.db,
        &before,
        &status,
        principal.as_deref().map(|p| p.username.as_str()),
        op,
    )
    .await
    {
        tracing::warn!(%error, "could not record the clock epoch");
    }
    Ok(Json(status))
}

/// Stamp every response with the business instant while the clock is
/// virtual. Absent under `System` — a production response stream carries no
/// virtual-time header at all.
pub async fn virtual_time_header(
    State(state): State<AppState>,
    request: Request,
    next: axum::middleware::Next,
) -> Response {
    let mut response = next.run(request).await;
    if state.clock.is_virtual() {
        if let Some(virtual_now) = state.clock.status().virtual_now {
            if let Ok(value) = HeaderValue::from_str(&virtual_now.to_rfc3339()) {
                response
                    .headers_mut()
                    .insert(HeaderName::from_static("x-virtual-time"), value);
            }
        }
    }
    response
}
