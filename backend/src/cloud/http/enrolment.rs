//! Enrolling a shop machine over HTTP.
//!
//! Two audiences, two kinds of route:
//!
//! - **An Admin in the hub** — `/api/v1/sync/enrollments…`, behind the
//!   session gate like every other `/sync/` administration route. Issuing a
//!   code, seeing claims, approving, refusing, re-sending a node's first data.
//! - **A machine with no identity yet** — `/api/v1/sync/enroll/claim` and
//!   `/api/v1/sync/enroll/status`, outside the session gate (`auth::is_public`)
//!   for the same reason `/sync/ingest` is: a machine has no session. The claim
//!   is authorised by the code; the status by the key whose digest the claim
//!   carried.
//!
//! The master sync key appears nowhere here. That is the point of the module.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres as infrastructure,
};
use crate::sync::enrolment::{ClaimAnswer, ClaimRequest, StatusAnswer, StatusRequest};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

pub async fn list(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let items = infrastructure::list_node_enrolments(&state.db).await?;
    Ok(Json(json!({ "items": items })))
}

pub async fn issue(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<infrastructure::IssueNodeEnrolmentRequest>,
) -> Result<(StatusCode, Json<infrastructure::IssuedNodeEnrolment>), AppError> {
    let issued =
        infrastructure::issue_node_enrolment(&state.db, request, &principal.username).await?;
    Ok((StatusCode::CREATED, Json(issued)))
}

pub async fn approve(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(enrolment_id): Path<Uuid>,
) -> Result<Json<infrastructure::ApprovedNodeEnrolment>, AppError> {
    Ok(Json(
        infrastructure::approve_node_enrolment(&state.db, enrolment_id, &principal.username)
            .await?,
    ))
}

pub async fn refuse(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(enrolment_id): Path<Uuid>,
) -> Result<Json<infrastructure::NodeEnrolmentView>, AppError> {
    Ok(Json(
        infrastructure::refuse_node_enrolment(&state.db, enrolment_id, &principal.username).await?,
    ))
}

/// *Kirim ulang data awal*: the enrolment bootstrap, again, for a node that is
/// already enrolled and has drifted — or whose first bootstrap reported a
/// stream that failed.
pub async fn bootstrap(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(origin_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::bootstrap_origin(&state.db, origin_id.trim(), &principal.username).await?,
    ))
}

/// Where the claim came from, as the proxy in front of us saw it. Shown to the
/// person approving and never used to decide anything: a header is whatever
/// the caller wrote.
fn claimed_from(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// A machine spends a code. The code is the proof, so the claim is approved
/// in the same request, as the Admin who issued it; the machine's first poll
/// finds itself approved. What follows the decision — who signs in there, the
/// first data — is queued in the background so the machine is not kept
/// waiting on a catalogue; a stream that fails is recorded on the enrolment
/// and sent once more by the first heartbeats after it. The answer still
/// carries the six-digit `verification`, for the nodes that show it.
pub async fn claim(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ClaimRequest>,
) -> Result<(StatusCode, Json<ClaimAnswer>), AppError> {
    let (answer, let_in) = infrastructure::claim_and_approve_node_enrolment(
        &state.db,
        request,
        claimed_from(&headers).as_deref(),
    )
    .await?;
    if let Some(let_in) = let_in {
        let pool = state.db.clone();
        tokio::spawn(async move {
            if let Err(error) = infrastructure::finish_node_approval(&pool, &let_in).await {
                tracing::warn!(
                    enrolment_id = %let_in.enrolment_id,
                    %error,
                    "a new server was let in but its first data was not queued; \
                     its heartbeats will try again"
                );
            }
        });
    }
    Ok((StatusCode::CREATED, Json(answer)))
}

pub async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<StatusRequest>,
) -> Result<Json<StatusAnswer>, AppError> {
    let presented = headers
        .get("x-sync-key")
        .and_then(|value| value.to_str().ok());
    Ok(Json(
        infrastructure::node_enrolment_status(&state.db, request.enrolment_id, presented).await?,
    ))
}
