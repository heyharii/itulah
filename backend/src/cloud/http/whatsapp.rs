//! Central › System › WhatsApp: pair head office's number by its QR, see that
//! it is connected, send a test, unlink it. An Admin's, at head office.

use super::auth::Principal;
use crate::cloud::{
    application::AppError,
    domain::Role,
    whatsapp::{self, WhatsAppStatus},
};
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};

fn require_admin(principal: &Principal, what: &str) -> Result<(), AppError> {
    if principal.role >= Role::Admin && principal.relayed.is_none() {
        return Ok(());
    }
    Err(AppError::Forbidden(format!(
        "only an Admin at head office may {what}"
    )))
}

/// `GET /api/v1/system/whatsapp`
pub async fn status(
    Extension(principal): Extension<Principal>,
) -> Result<Json<WhatsAppStatus>, AppError> {
    require_admin(&principal, "see head office's WhatsApp")?;
    Ok(Json(whatsapp::status().await))
}

#[derive(Debug, Deserialize)]
pub struct TestRequest {
    pub to: String,
}

/// `POST /api/v1/system/whatsapp/test`: one message to a number the Admin
/// names, to prove the line works end to end.
pub async fn test(
    Extension(principal): Extension<Principal>,
    Json(request): Json<TestRequest>,
) -> Result<Json<Value>, AppError> {
    require_admin(&principal, "send a WhatsApp test")?;
    let id = whatsapp::send(
        &request.to,
        "Tes dari Central: WhatsApp kantor pusat tersambung.",
    )
    .await?;
    Ok(Json(json!({ "id": id, "sent_to": whatsapp::masked(&request.to) })))
}

/// `POST /api/v1/system/whatsapp/logout`: unlink the number, so another can be
/// paired by a fresh QR.
pub async fn logout(
    Extension(principal): Extension<Principal>,
) -> Result<Json<Value>, AppError> {
    require_admin(&principal, "unlink head office's WhatsApp")?;
    whatsapp::logout().await?;
    Ok(Json(json!({ "ok": true })))
}
