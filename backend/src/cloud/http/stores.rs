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
//! The machine that claims a code is let in at once, as the Admin who issued
//! it (`http/enrolment.rs`); the page then shows it getting its first data and
//! being ready, and `POST /api/v1/stores/{unit}/server/disconnect` lets go of
//! it. Approving or refusing a claim by hand stays where every enrolment is
//! decided, for one that could not be let in by itself:
//! `POST /api/v1/sync/enrollments/{id}/approve` and `…/refuse`.

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
    response::{IntoResponse, Response},
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

/// `GET|PUT|DELETE /api/v1/stores/{unit}/receipt-header`: the picture the store
/// prints at the top of its receipts (1009).
pub async fn read_receipt_header(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::ReceiptHeaderView>, AppError> {
    require_admin(&principal, "read a store's receipt picture")?;
    Ok(Json(
        infrastructure::read_receipt_header(&state.db, unit.trim()).await?,
    ))
}

pub async fn save_receipt_header(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(request): Json<infrastructure::SaveReceiptHeader>,
) -> Result<Json<infrastructure::ReceiptHeaderView>, AppError> {
    require_admin(&principal, "set a store's receipt picture")?;
    Ok(Json(
        infrastructure::save_receipt_header(&state.db, unit.trim(), &request, &principal.username)
            .await?,
    ))
}

pub async fn clear_receipt_header(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::ReceiptHeaderView>, AppError> {
    require_admin(&principal, "remove a store's receipt picture")?;
    Ok(Json(
        infrastructure::clear_receipt_header(&state.db, unit.trim(), &principal.username).await?,
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

/// `POST /api/v1/stores/{unit}/server/disconnect`: disconnect the machine that
/// serves the store — its key stops working, the store's server goes back to
/// not installed — and answer with a fresh install code for the next one,
/// exactly what `install` answers. A removed store's server is let go for
/// good: `204`, and no code, since nothing is installed there again.
pub async fn disconnect_server(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Response, AppError> {
    require_admin(&principal, "disconnect a store's server")?;
    let issued =
        infrastructure::disconnect_store_server(&state.db, unit.trim(), &principal.username)
            .await?;
    Ok(match issued {
        Some(issued) => (StatusCode::CREATED, Json(issued)).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
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

async fn require_reach(
    state: &AppState,
    principal: &Principal,
    unit: &str,
) -> Result<(), AppError> {
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

// ── head office stops a till, a cashier or the store (0990) ─────────────

/// `GET /api/v1/stores/{unit}/pos`: the store's Tills tab — its tills, each
/// with the drawer open at it, and the people who sign in at them.
pub async fn pos(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::StorePos>, AppError> {
    let unit = unit.trim();
    if !reach_of(&state, &principal).await?.covers(unit) {
        return Err(AppError::Forbidden(format!(
            "{} may read only the store they are posted to",
            principal.username
        )));
    }
    Ok(Json(
        infrastructure::store_pos(&state.db, unit, may_manage(&principal)).await?,
    ))
}

/// `GET /api/v1/stores/{unit}/fingers`: the store's People tab — the
/// fingers its POS recorded, waiting for head office, and everybody who
/// signs in there with their approved fingers.
pub async fn fingers(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::StoreFingers>, AppError> {
    let unit = unit.trim();
    if !reach_of(&state, &principal).await?.covers(unit) {
        return Err(AppError::Forbidden(format!(
            "{} may read only the store they are posted to",
            principal.username
        )));
    }
    Ok(Json(
        infrastructure::store_fingers(&state.db, unit, may_manage(&principal)).await?,
    ))
}

/// `GET /api/v1/stores/{unit}/people/{user_id}`: one person at the store —
/// their shift now, sales today, the POS they worked at, recent activity,
/// fingers, and head office's stop.
pub async fn person(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, user_id)): Path<(String, uuid::Uuid)>,
) -> Result<Json<infrastructure::StorePersonActivity>, AppError> {
    let unit = unit.trim();
    if !reach_of(&state, &principal).await?.covers(unit) {
        return Err(AppError::Forbidden(format!(
            "{} may read only the store they are posted to",
            principal.username
        )));
    }
    Ok(Json(
        infrastructure::store_person_activity(&state.db, unit, user_id, may_manage(&principal))
            .await?,
    ))
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OneDeviceRequest {
    /// On: a sign-in on a second device ends the first.
    pub on: bool,
}

/// `PUT /api/v1/stores/{unit}/one-device`: whether a person may be signed in
/// on one device at a time at the store. Head office's switch.
pub async fn set_one_device(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(request): Json<OneDeviceRequest>,
) -> Result<Json<infrastructure::StoreDetail>, AppError> {
    require_admin(&principal, "set the one-device rule for a store")?;
    Ok(Json(
        infrastructure::set_one_device(&state.db, unit.trim(), request.on, &principal.username)
            .await?,
    ))
}

/// `POST /api/v1/stores/{unit}/fingers/{submission_id}/approve`: the finger
/// becomes the person's, at every POS they sign in at. Answers the tab.
pub async fn approve_finger(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, submission_id)): Path<(String, uuid::Uuid)>,
) -> Result<Json<infrastructure::StoreFingers>, AppError> {
    require_admin(&principal, "approve a finger recorded at a store")?;
    let unit = unit.trim();
    infrastructure::decide_store_finger(
        &state.db,
        unit,
        submission_id,
        true,
        None,
        &principal.username,
    )
    .await?;
    Ok(Json(
        infrastructure::store_fingers(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/fingers/{submission_id}/refuse`, with
/// `{reason?}`: the finger is dropped, and the store's POS shows why.
pub async fn refuse_finger(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, submission_id)): Path<(String, uuid::Uuid)>,
    body: Option<Json<infrastructure::RefuseFingerRequest>>,
) -> Result<Json<infrastructure::StoreFingers>, AppError> {
    require_admin(&principal, "refuse a finger recorded at a store")?;
    let unit = unit.trim();
    let reason = body.and_then(|Json(body)| body.reason);
    infrastructure::decide_store_finger(
        &state.db,
        unit,
        submission_id,
        false,
        reason.as_deref(),
        &principal.username,
    )
    .await?;
    Ok(Json(
        infrastructure::store_fingers(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/fingers/approve-all`: every finger waiting at
/// the store.
pub async fn approve_all_fingers(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::StoreFingers>, AppError> {
    require_admin(&principal, "approve the fingers recorded at a store")?;
    let unit = unit.trim();
    infrastructure::approve_all_store_fingers(&state.db, unit, &principal.username).await?;
    Ok(Json(
        infrastructure::store_fingers(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/pos/joins/{join_id}/approve`, with
/// `{replaces_device_id?}`: let a POS waiting at the store in, into a free
/// seat or in place of one (`postgres::pos_joins`). Answers the POS tab.
pub async fn approve_pos(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, join_id)): Path<(String, uuid::Uuid)>,
    Json(request): Json<infrastructure::ApprovePosRequest>,
) -> Result<Json<infrastructure::StorePos>, AppError> {
    require_admin(&principal, "let a new POS into a store")?;
    let unit = unit.trim();
    infrastructure::decide_pos_join(
        &state.db,
        unit,
        join_id,
        true,
        request.replaces_device_id.as_deref(),
        &principal.username,
    )
    .await?;
    Ok(Json(
        infrastructure::store_pos(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/pos/joins/{join_id}/refuse`: the POS is told
/// no, and forgets the key it made.
pub async fn refuse_pos(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, join_id)): Path<(String, uuid::Uuid)>,
) -> Result<Json<infrastructure::StorePos>, AppError> {
    require_admin(&principal, "refuse a new POS")?;
    let unit = unit.trim();
    infrastructure::decide_pos_join(&state.db, unit, join_id, false, None, &principal.username)
        .await?;
    Ok(Json(
        infrastructure::store_pos(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/stop`, with `{reason}`: the store's tills
/// stop selling and open no shift. Answers the store's page.
pub async fn stop(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(request): Json<infrastructure::PosStopRequest>,
) -> Result<Json<infrastructure::StoreDetail>, AppError> {
    require_admin(&principal, "stop a store")?;
    let unit = unit.trim();
    infrastructure::stop_store(&state.db, unit, request, &principal.username).await?;
    Ok(Json(
        infrastructure::store_detail(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/resume`: a stopped store trades again.
pub async fn resume(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
) -> Result<Json<infrastructure::StoreDetail>, AppError> {
    require_admin(&principal, "resume a store")?;
    let unit = unit.trim();
    infrastructure::resume_store(&state.db, unit, &principal.username).await?;
    Ok(Json(
        infrastructure::store_detail(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/remove`, with `{code}`: a stopped store that
/// closed for good leaves the active lists. Its history stays.
pub async fn remove(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(unit): Path<String>,
    Json(request): Json<infrastructure::RemoveStoreRequest>,
) -> Result<Json<infrastructure::StoreDetail>, AppError> {
    require_admin(&principal, "remove a store")?;
    let unit = unit.trim();
    infrastructure::remove_store(&state.db, unit, request, &principal.username).await?;
    Ok(Json(
        infrastructure::store_detail(&state.db, unit, true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/cashiers/{user_id}/stop`, with `{reason}`:
/// the person may not sell or open a shift at any store. Answers the store's
/// Tills tab.
pub async fn stop_cashier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, user_id)): Path<(String, uuid::Uuid)>,
    Json(request): Json<infrastructure::PosStopRequest>,
) -> Result<Json<infrastructure::StorePos>, AppError> {
    require_admin(&principal, "stop a person on the POS")?;
    infrastructure::stop_cashier(&state.db, user_id, request, &principal.username).await?;
    Ok(Json(
        infrastructure::store_pos(&state.db, unit.trim(), true).await?,
    ))
}

/// `POST /api/v1/stores/{unit}/cashiers/{user_id}/resume`.
pub async fn resume_cashier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((unit, user_id)): Path<(String, uuid::Uuid)>,
) -> Result<Json<infrastructure::StorePos>, AppError> {
    require_admin(&principal, "resume a person on the POS")?;
    infrastructure::resume_cashier(&state.db, user_id, &principal.username).await?;
    Ok(Json(
        infrastructure::store_pos(&state.db, unit.trim(), true).await?,
    ))
}
