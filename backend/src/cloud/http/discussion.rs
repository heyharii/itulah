//! Discussions over HTTP.
//!
//! Readable by everybody signed in, which is the deliberate difference from a
//! conversation: an argument about a purchase order is business record, not
//! correspondence, and the person who needs it next week was not in the room
//! when it happened. Writing is another matter — only whoever opened a thread
//! may say what answered it or close it.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, DiscussionPost, DiscussionThread, OpenThreadRequest, ReplyRequest,
        SubjectCount, ThreadQuery,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Response,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub async fn list_threads(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ThreadQuery>,
) -> Result<Json<Vec<DiscussionThread>>, AppError> {
    Ok(Json(
        infrastructure::list_threads(&state.db, &principal.username, &query).await?,
    ))
}

/// How many threads hang on each kind of record — the left-hand axis of the
/// screen. Counts of work, not of categories.
pub async fn subject_counts(
    State(state): State<AppState>,
) -> Result<Json<Vec<SubjectCount>>, AppError> {
    Ok(Json(infrastructure::subject_counts(&state.db).await?))
}

pub async fn open_thread(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<OpenThreadRequest>,
) -> Result<(StatusCode, Json<DiscussionThread>), AppError> {
    let thread = infrastructure::open_thread(&state.db, &principal.username, &request).await?;
    acted_on.set(RecordKind::Discussion, thread.thread_id.to_string());
    Ok((StatusCode::CREATED, Json(thread)))
}

/// Reading a thread records that this person has seen it — one row per person,
/// which is why the number beside it is people rather than page loads.
pub async fn read_thread(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::read_thread(&state.db, thread_id, &principal.username).await?,
    ))
}

pub async fn read_posts(
    State(state): State<AppState>,
    Path(thread_id): Path<Uuid>,
) -> Result<Json<Vec<DiscussionPost>>, AppError> {
    Ok(Json(
        infrastructure::read_posts(&state.db, thread_id).await?,
    ))
}

pub async fn reply(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<ReplyRequest>,
) -> Result<(StatusCode, Json<DiscussionPost>), AppError> {
    let post = infrastructure::reply(&state.db, thread_id, &principal.username, &request).await?;
    Ok((StatusCode::CREATED, Json(post)))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcceptSolutionRequest {
    pub post_id: Uuid,
}

pub async fn accept_solution(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<AcceptSolutionRequest>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::accept_solution(&state.db, thread_id, request.post_id, &principal.username)
            .await?,
    ))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetThreadStatusRequest {
    /// `open`, `resolved`, or `locked`.
    pub status: String,
}

pub async fn set_status(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<SetThreadStatusRequest>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::set_status(&state.db, thread_id, &request.status, &principal.username)
            .await?,
    ))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetBookmarkRequest {
    pub marked: bool,
}

/// The caller's own bookmark, and nobody else's. The answer is a single
/// boolean because there is nothing else to say: no count, no list of who
/// else marked it, because those do not exist.
pub async fn set_bookmark(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<SetBookmarkRequest>,
) -> Result<Json<SetBookmarkRequest>, AppError> {
    let marked =
        infrastructure::set_bookmark(&state.db, thread_id, &principal.username, request.marked)
            .await?;
    Ok(Json(SetBookmarkRequest { marked }))
}

/// A file, fetched through the thread that carries it. The thread id in the
/// path is the check: a file id from one discussion cannot be pulled through
/// another's URL.
pub async fn attachment(
    State(state): State<AppState>,
    Path((thread_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    if !infrastructure::discussion_attachment_is_reachable(&state.db, thread_id, file_id).await? {
        return Err(AppError::NotFound("no such attachment".into()));
    }
    let content = infrastructure::read_file(&state, file_id).await?;
    Ok(super::files::download_response(content))
}
