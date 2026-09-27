//! Opening a store, over HTTP: the Stores list, one store's page, "Open
//! store", and installing the store's server from its page. See
//! `postgres/stores.rs`.
//!
//! # Who
//!
//! Reading follows reach. Head office, the owner, an Admin and IT read every
//! store; a store's manager or supervisor reads their own, the unit they are
//! posted to (`postgres::store_reach`). The section gate has already asked
//! that their job includes `stores`. A call a store's node relays is refused:
//! a store's till has no business on these pages. Opening a store and
//! issuing a server code are Admin's alone — at the path
//! (`domain::auth::required_role`) and again here, so a `role_permission`
//! override that lowered the path's rung cannot hand either to anybody else.
//! Both reads say so in `can_manage`, for the hub to hide those buttons.
//!
//! Approving or refusing the machine that claims a code stays where every
//! enrolment is decided: `POST /api/v1/sync/enrollments/{id}/approve` and
//! `POST /api/v1/sync/enrollments/{id}/refuse` (`http/enrolment.rs`).

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::Role,
    postgres::{self as infrastructure, OpenStoreRequest, StoreReach},
};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};

/// The stores this caller may read — never through a call a store's node
/// relayed.
async fn reach_of(state: &AppState, principal: &Principal) -> Result<StoreReach, AppError> {
    if principal.relayed.is_some() {
        return Err(AppError::Forbidden(
            "the stores pages are the hub's; a store's till cannot read them".into(),
        ));
    }
    if principal.role >= Role::Admin || principal.job.holds_everything() {
        return Ok(StoreReach::Every);
    }
    infrastructure::store_reach(&state.db, &principal.username).await
}

/// May this caller open stores and install their servers?
fn may_manage(principal: &Principal) -> bool {
    principal.role >= Role::Admin && principal.relayed.is_none()
}

fn require_admin(principal: &Principal, what: &str) -> Result<(), AppError> {
    if may_manage(principal) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "only an Admin at head office may {what}"
    )))
}

/// `GET /api/v1/stores`: the stores within the caller's reach, by code.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<infrastructure::StoreList>, AppError> {
    let reach = reach_of(&state, &principal).await?;
    Ok(Json(
        infrastructure::list_stores(&state.db, &reach, may_manage(&principal)).await?,
    ))
}

/// `GET /api/v1/stores/{unit}`: one store's page, with its checks.
pub async fn detail(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::StoreDetail>, AppError> {
    let unit = unit.trim();
    if !reach_of(&state, &principal).await?.covers(unit) {
        return Err(AppError::Forbidden(format!(
            "{} may read only the store they are posted to",
            principal.username
        )));
    }
    Ok(Json(
        infrastructure::store_detail(&state.db, unit, may_manage(&principal)).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/open`, with `{note?}` or no body at all.
pub async fn open(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    body: Bytes,
) -> Result<Json<infrastructure::OpenedStore>, AppError> {
    require_admin(&principal, "open a store")?;
    let request: OpenStoreRequest = if body.iter().all(u8::is_ascii_whitespace) {
        OpenStoreRequest::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|error| AppError::Validation(format!("invalid request: {error}")))?
    };
    Ok(Json(
        infrastructure::open_store(&state.db, unit.trim(), request, &principal.username).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/server/install`: a code for the store's server,
/// its QR, and where the installer is.
pub async fn install_server(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<(StatusCode, Json<infrastructure::StoreServerInstall>), AppError> {
    require_admin(&principal, "issue a code to install a store's server")?;
    let issued =
        infrastructure::install_store_server(&state.db, unit.trim(), &principal.username).await?;
    Ok((StatusCode::CREATED, Json(issued)))
}

/// `POST /api/v1/devices/{device_id}/test-print`: ask a till or a network
/// printer for a test page. Accepted, not done: the node prints it, or the
/// till does, and the outcome reaches the register with a later heartbeat.
pub async fn test_print(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(device_id): Path<String>,
) -> Result<(StatusCode, Json<infrastructure::TestPrintRequested>), AppError> {
    require_admin(&principal, "ask a device for a test page")?;
    let requested =
        infrastructure::request_test_print(&state.db, device_id.trim(), &principal.username)
            .await?;
    Ok((StatusCode::ACCEPTED, Json(requested)))
}
