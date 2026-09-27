//! Discussions over HTTP.
//!
//! Readable by everybody signed in, which is the deliberate difference from a
//! conversation: an argument about a purchase order is business record, not
//! correspondence, and the person who needs it next week was not in the room
//! when it happened. Writing is another matter — only whoever opened a thread
//! may say what answered it or close it, only whoever wrote a post may correct
//! it, and head office (ADMIN) moderates: it may do both, pin a thread, and
//! withdraw any post.
//!
//! Every route here is CASHIER on the role ladder (see `required_role`), so the
//! moderator rule cannot live there; it lives in [`reader`], once.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{RecordKind, Role},
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, DiscussionPerson, DiscussionPost, DiscussionReader,
        DiscussionThread, DismissedUnread, EditPostRequest, EditThreadRequest, OpenThreadRequest,
        PostReaction, PostRevision, ReactToPostRequest, ReplyRequest, SubjectCount,
        SubjectKindOption, TagCount, ThreadQuery,
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

/// The caller, as the discussion store asks about them.
fn reader(principal: &Principal) -> DiscussionReader<'_> {
    DiscussionReader {
        username: &principal.username,
        moderator: principal.role == Role::Admin,
    }
}

pub async fn list_threads(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<ThreadQuery>,
) -> Result<Json<Vec<DiscussionThread>>, AppError> {
    Ok(Json(
        infrastructure::list_threads(&state.db, reader(&principal), &query).await?,
    ))
}

/// How many threads hang on each kind of record — the left-hand axis of the
/// screen. Counts of work, not of categories.
pub async fn subject_counts(
    State(state): State<AppState>,
) -> Result<Json<Vec<SubjectCount>>, AppError> {
    Ok(Json(infrastructure::subject_counts(&state.db).await?))
}

/// Every tag in use, busiest first.
pub async fn tag_counts(State(state): State<AppState>) -> Result<Json<Vec<TagCount>>, AppError> {
    Ok(Json(infrastructure::tag_counts(&state.db).await?))
}

/// The kinds of record a thread may be opened on. Served rather than mirrored
/// in the browser, so the composer offers exactly what `open_thread` accepts.
pub async fn subject_kinds() -> Json<Vec<SubjectKindOption>> {
    Json(infrastructure::subject_kinds())
}

/// Everybody who can be named with `@` in a post.
pub async fn people(
    State(state): State<AppState>,
) -> Result<Json<Vec<DiscussionPerson>>, AppError> {
    Ok(Json(infrastructure::discussion_people(&state.db).await?))
}

pub async fn open_thread(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<OpenThreadRequest>,
) -> Result<(StatusCode, Json<DiscussionThread>), AppError> {
    let thread = infrastructure::open_thread(&state.db, reader(&principal), &request).await?;
    acted_on.set(RecordKind::Discussion, thread.thread_id.to_string());
    Ok((StatusCode::CREATED, Json(thread)))
}

/// Reading a thread records that this person has seen it — one row per person,
/// which is why the number beside it is people rather than page loads — and
/// moves their reading position to its end.
pub async fn read_thread(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::read_thread(&state.db, thread_id, reader(&principal)).await?,
    ))
}

/// Mark every thread the caller has opened as read to its end.
pub async fn dismiss_unread(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<DismissedUnread>, AppError> {
    Ok(Json(
        infrastructure::dismiss_unread(&state.db, &principal.username).await?,
    ))
}

/// Retitle it, reword its note, refile its tags.
pub async fn edit_thread(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<EditThreadRequest>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::edit_thread(&state.db, thread_id, reader(&principal), &request).await?,
    ))
}

pub async fn read_posts(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
) -> Result<Json<Vec<DiscussionPost>>, AppError> {
    Ok(Json(
        infrastructure::read_posts(&state.db, thread_id, reader(&principal)).await?,
    ))
}

pub async fn reply(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<ReplyRequest>,
) -> Result<(StatusCode, Json<DiscussionPost>), AppError> {
    let post = infrastructure::reply(&state.db, thread_id, reader(&principal), &request).await?;
    Ok((StatusCode::CREATED, Json(post)))
}

/// Correct a post. Its author only.
pub async fn edit_post(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((thread_id, post_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<EditPostRequest>,
) -> Result<Json<DiscussionPost>, AppError> {
    Ok(Json(
        infrastructure::edit_post(&state.db, thread_id, post_id, reader(&principal), &request)
            .await?,
    ))
}

/// Withdraw a post. Its author, or head office. The row stays, because its
/// position is what other posts quote.
pub async fn withdraw_post(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((thread_id, post_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<DiscussionPost>, AppError> {
    Ok(Json(
        infrastructure::withdraw_post(&state.db, thread_id, post_id, reader(&principal)).await?,
    ))
}

/// What a post said before each correction.
pub async fn post_revisions(
    State(state): State<AppState>,
    Path((thread_id, post_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<PostRevision>>, AppError> {
    Ok(Json(
        infrastructure::post_revisions(&state.db, thread_id, post_id).await?,
    ))
}

pub async fn react(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((thread_id, post_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<ReactToPostRequest>,
) -> Result<Json<Vec<PostReaction>>, AppError> {
    Ok(Json(
        infrastructure::react_to_post(&state.db, thread_id, post_id, reader(&principal), &request)
            .await?,
    ))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcceptSolutionRequest {
    /// The reply that answered it, or `null` to say nothing has after all.
    pub post_id: Option<Uuid>,
}

pub async fn accept_solution(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<AcceptSolutionRequest>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::accept_solution(&state.db, thread_id, request.post_id, reader(&principal))
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
        infrastructure::set_status(&state.db, thread_id, &request.status, reader(&principal))
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetSubscriptionRequest {
    /// `watching`, `normal`, or `muted`.
    pub level: String,
}

/// How closely the caller follows a thread. Theirs alone, like a bookmark.
pub async fn set_subscription(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<SetSubscriptionRequest>,
) -> Result<Json<SetSubscriptionRequest>, AppError> {
    let level =
        infrastructure::set_subscription(&state.db, thread_id, &principal.username, &request.level)
            .await?;
    Ok(Json(SetSubscriptionRequest { level }))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetPinRequest {
    pub pinned: bool,
}

/// Pin it above the board. Head office only.
pub async fn set_pin(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(thread_id): Path<Uuid>,
    Json(request): Json<SetPinRequest>,
) -> Result<Json<DiscussionThread>, AppError> {
    Ok(Json(
        infrastructure::pin_thread(&state.db, thread_id, reader(&principal), request.pinned)
            .await?,
    ))
}

/// A file, fetched through the thread that carries it. The thread id in the
/// path is the check: a file id from one discussion cannot be pulled through
/// another's URL, and a file on a withdrawn post cannot be pulled at all.
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
