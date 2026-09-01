//! The notification list, and marking things dealt with.
//!
//! There is no endpoint here for CREATING one, and that is deliberate. A
//! notification is raised by the code that caused the work — inside that
//! code's own transaction — so it cannot exist without the thing it is about.
//! An endpoint that let a client post one would make it possible to announce
//! work that never happened.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, NotificationPage},
};
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// How much of the list to fetch, and whether to leave out what has been dealt
/// with. Defaults chosen for the panel: everything recent, read and unread,
/// because a list that hid what you just cleared would flicker items away as
/// you worked through it.
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub unread: bool,
    pub limit: Option<i64>,
}

const DEFAULT_LIMIT: i64 = 50;

pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<NotificationPage>, AppError> {
    Ok(Json(
        infrastructure::list_notifications_for(
            &state.db,
            &principal.username,
            query.unread,
            query.limit.unwrap_or(DEFAULT_LIMIT),
        )
        .await?,
    ))
}

pub async fn mark_read(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(notification_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    infrastructure::mark_notification_read(&state.db, &principal.username, notification_id).await?;
    Ok(Json(json!({
        "unread": infrastructure::unread_notification_count(&state.db, &principal.username).await?
    })))
}

/// Clear the badge, and say how many that took — the screen tells the person
/// what it did rather than merely that the number went to zero.
pub async fn mark_all_read(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Value>, AppError> {
    let cleared = infrastructure::mark_all_notifications_read(&state.db, &principal.username).await?;
    Ok(Json(json!({ "cleared": cleared, "unread": 0 })))
}
