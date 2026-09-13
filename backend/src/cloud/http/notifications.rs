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
/// `deny_unknown_fields`, so `?unreadd=true` is refused rather than quietly
/// answering the whole list under a filter the caller believes is applied.
/// Every parameter this route already had — `unread`, `limit` — is still here
/// and still means what it did.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListQuery {
    #[serde(default)]
    pub unread: bool,
    /// Free text over the sentence somebody was shown — the title and the body.
    #[serde(default)]
    pub q: Option<String>,
    /// One kind of work.
    #[serde(default)]
    pub kind: Option<String>,
    /// `at` or `kind`. Anything else is `at` rather than a 400, so a stale
    /// bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` and nothing else. Absent means descending: a notification list is
    /// read newest-first.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// What one person has to deal with, one page at a time.
///
/// The reader is the principal's own username and never a parameter: this list
/// is per-person, and `read_at` is per-person, so a caller naming somebody else
/// would be reading another colleague's work queue.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ListQuery>,
) -> Result<Json<NotificationPage>, AppError> {
    Ok(Json(
        infrastructure::list_notifications_for(
            &state.db,
            &principal.username,
            infrastructure::NotificationScope {
                needle: query.q,
                unread_only: query.unread,
                kind: query.kind,
                sort: query.sort,
                desc: query.dir.as_deref() != Some("asc"),
                cursor: query.cursor,
                // Clamped where it is enforced, not here: one spelling of how
                // much of a queue one request may see.
                limit: query.limit,
            },
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
    let cleared =
        infrastructure::mark_all_notifications_read(&state.db, &principal.username).await?;
    Ok(Json(json!({ "cleared": cleared, "unread": 0 })))
}
