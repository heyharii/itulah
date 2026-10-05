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
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
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
    // A role that reaches every unit (0700) reads every store, as an Admin does.
    if principal.role >= Role::Admin || principal.job.holds_everything() || principal.job.every_unit
    {
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

#[derive(Debug, serde::Deserialize)]
pub struct TillSeatsRequest {
    /// Kasir 1 to Kasir `count`.
    pub count: i32,
}

/// `PUT /api/v1/stores/{unit}/tills`: how many till seats the store's counter
/// has. Head office decides; a machine at the shop sits at one of them and
/// never adds another.
pub async fn set_till_seats(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(request): Json<TillSeatsRequest>,
) -> Result<Json<infrastructure::StoreDetail>, AppError> {
    require_admin(&principal, "set a store's till seats")?;
    Ok(Json(
        infrastructure::set_till_seats(&state.db, unit.trim(), request.count, &principal.username)
            .await?,
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

// ---- The Actions menu (remote actions, 28 Sep 2026) ---------------------------
//
// Reading the menu and the history follows reach, like the page. Acting is
// an Admin's, the owner's or IT's: IT sits on the Supervisor rung, so the
// path lets the Supervisor rung through (`domain::auth::required_role`) and
// this is the check that counts. See `postgres/store_actions.rs`.

/// May this caller act on a store's server and devices?
fn may_act(principal: &Principal) -> bool {
    use crate::cloud::domain::job_role::{ADMIN, OWNER};
    principal.relayed.is_none()
        && (principal.role >= Role::Admin
            || [OWNER, ADMIN, "IT"].contains(&principal.job.code.as_str()))
}

async fn require_reach(state: &AppState, principal: &Principal, unit: &str) -> Result<(), AppError> {
    if reach_of(state, principal).await?.covers(unit) {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "{} may read only the store they are posted to",
        principal.username
    )))
}

/// `GET /api/v1/stores/{unit}/actions`: what may be done to the store's
/// server and devices, each with why not when it may not.
pub async fn actions(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::StoreActionMenu>, AppError> {
    let unit = unit.trim();
    require_reach(&state, &principal, unit).await?;
    Ok(Json(
        infrastructure::store_action_menu(&state.db, unit, may_act(&principal)).await?,
    ))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionHistoryQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `GET /api/v1/stores/{unit}/actions/history?limit=`: newest first.
pub async fn action_history(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Query(query): Query<ActionHistoryQuery>,
) -> Result<Json<infrastructure::StoreActionHistory>, AppError> {
    let unit = unit.trim();
    require_reach(&state, &principal, unit).await?;
    Ok(Json(
        infrastructure::store_action_history(&state.db, unit, query.limit).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/actions/{key}` with `{device_id?, note?,
/// confirm?}` and an `Idempotency-Key`: recorded, sent, and followed.
/// Answers 202 with the action's id; the history says where it got to.
pub async fn request_action(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, key)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<infrastructure::StoreActionAccepted>), AppError> {
    if !may_act(&principal) {
        return Err(AppError::Forbidden(
            "only an Admin, the owner or IT may act on a store's server".into(),
        ));
    }
    let idempotency_key = super::articles::idempotency_key(&headers)?;
    let request: infrastructure::StoreActionRequest = if body.iter().all(u8::is_ascii_whitespace) {
        infrastructure::StoreActionRequest::default()
    } else {
        serde_json::from_slice(&body)
            .map_err(|error| AppError::Validation(format!("invalid request: {error}")))?
    };
    let unit = unit.trim();
    let key = key.trim();
    let audit_payload = serde_json::json!({
        "unit": unit,
        "action": key,
        "device_id": request.device_id,
        "note": request.note,
    });
    let requested = infrastructure::request_store_action(
        &state.db,
        unit,
        key,
        request,
        &principal.username,
        &idempotency_key,
    )
    .await?;
    // The activity log's line in words, beside the middleware's own: which
    // server, which action, and the id the history follows it by.
    let mut payload = audit_payload;
    payload["action_id"] = serde_json::json!(requested.accepted.action_id);
    let path = format!("/api/v1/stores/{unit}/actions/{key}");
    let entry = infrastructure::NewAudit {
        username: &principal.username,
        display_name: &principal.display_name,
        role: principal.role.as_str(),
        method: "POST",
        path: &path,
        status: 202,
        subject: requested
            .origin_id
            .clone()
            .map(|origin| (crate::cloud::domain::RecordKind::Origin, origin)),
        payload,
    };
    if let Err(error) = infrastructure::record_audit(&state.db, entry).await {
        tracing::warn!(%error, "a store action was not written to the activity log");
    }
    Ok((StatusCode::ACCEPTED, Json(requested.accepted)))
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
