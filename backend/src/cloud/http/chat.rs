//! Conversations over HTTP, including the stream that keeps them live.
//!
//! Two things here are worth reading before changing anything.
//!
//! **The stream resumes, it does not restart.** `GET /chat/stream?after=N`
//! replays every event past `N` and then follows. A browser that lost its
//! connection reconnects with the last id it actually received, so the gap is
//! filled instead of silently skipped. This is why events are numbered rows in
//! a table rather than a fan-out over a channel: a channel has nothing to
//! resume from.
//!
//! **Attachments are addressed through their conversation.** There is no
//! `/files/{id}` here. The path carries the conversation id and the handler
//! checks that the caller is in it, so a file id copied out of one thread
//! cannot be fetched by somebody who was never in the room.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{
        self as infrastructure, AddParticipantsRequest, ChatConversation, ChatMessage,
        ChatSearchHit, ConversationPreferencesRequest, EditMessageRequest, MarkReadRequest,
        MessageWindow, PinMessageRequest, ReactRequest, RenameConversationRequest,
        SendMessageRequest, SetAdminRequest, StartConversationRequest, StoredFile,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Extension, Json,
};
use futures_util::stream::Stream;
use serde::Deserialize;
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use uuid::Uuid;

/// How often the stream looks for new events.
///
/// Polling rather than `LISTEN`/`NOTIFY`: a listening connection is held open
/// per reader for as long as the tab is, and a pool sized for request traffic
/// runs out of connections long before it runs out of readers. A short query
/// every second and a half borrows a connection for milliseconds. If this ever
/// needs to be instant, the fix is one listener for the process fanning out
/// in memory — not one per browser.
const POLL_INTERVAL: Duration = Duration::from_millis(1_500);

/// Events handed over per poll. Enough to catch up a browser that was away for
/// a while without loading a day's traffic into one response.
const EVENT_BATCH: i64 = 100;

#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    /// The last event id this browser actually received. Absent means "start
    /// from now" — a first connection has the screen's contents already and
    /// does not want the history replayed at it.
    pub after: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct MessagesQuery {
    /// Everything past this `seq`. A reconnecting thread asks for the tail it
    /// is missing rather than the whole conversation again.
    pub after: Option<i64>,
    /// Everything before this `seq` — scrolling back through history.
    pub before: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    /// One room only, when searching from inside it.
    pub conversation_id: Option<Uuid>,
}

pub async fn list_conversations(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<ChatConversation>>, AppError> {
    Ok(Json(
        infrastructure::list_conversations(&state.db, &principal.username).await?,
    ))
}

pub async fn start_conversation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<StartConversationRequest>,
) -> Result<(StatusCode, Json<ChatConversation>), AppError> {
    let conversation =
        infrastructure::start_conversation(&state.db, &principal.username, &request).await?;
    Ok((StatusCode::CREATED, Json(conversation)))
}

pub async fn read_conversation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<ChatConversation>, AppError> {
    Ok(Json(
        infrastructure::read_conversation(&state.db, conversation_id, &principal.username).await?,
    ))
}

pub async fn read_messages(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<Vec<ChatMessage>>, AppError> {
    Ok(Json(
        infrastructure::read_messages(
            &state.db,
            conversation_id,
            &principal.username,
            MessageWindow {
                after: query.after,
                before: query.before,
                limit: query.limit,
            },
        )
        .await?,
    ))
}

/// Say something. Repeating the request with the same `idempotency_key`
/// returns the message that was already written rather than writing a second
/// one — which is what makes the browser's optimistic rendering safe.
pub async fn send_message(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<SendMessageRequest>,
) -> Result<(StatusCode, Json<ChatMessage>), AppError> {
    let message =
        infrastructure::send_message(&state.db, conversation_id, &principal.username, &request)
            .await?;
    Ok((StatusCode::CREATED, Json(message)))
}

/// Move the read mark. Answers with the conversation so the caller's unread
/// count comes from the server rather than being recomputed in the browser.
pub async fn mark_read(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<MarkReadRequest>,
) -> Result<Json<ChatConversation>, AppError> {
    Ok(Json(
        infrastructure::mark_read(
            &state.db,
            conversation_id,
            &principal.username,
            request.last_read_seq,
        )
        .await?,
    ))
}

/// Change the words of a message you wrote.
pub async fn edit_message(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, seq)): Path<(Uuid, i64)>,
    Json(request): Json<EditMessageRequest>,
) -> Result<Json<ChatMessage>, AppError> {
    Ok(Json(
        infrastructure::edit_message(
            &state.db,
            conversation_id,
            seq,
            &principal.username,
            &request,
        )
        .await?,
    ))
}

/// Take a message back. Answers with what is left of it — its place.
pub async fn delete_message(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, seq)): Path<(Uuid, i64)>,
) -> Result<Json<ChatMessage>, AppError> {
    Ok(Json(
        infrastructure::delete_message(&state.db, conversation_id, seq, &principal.username)
            .await?,
    ))
}

pub async fn react(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, seq)): Path<(Uuid, i64)>,
    Json(request): Json<ReactRequest>,
) -> Result<Json<ChatMessage>, AppError> {
    Ok(Json(
        infrastructure::react(
            &state.db,
            conversation_id,
            seq,
            &principal.username,
            &request,
        )
        .await?,
    ))
}

pub async fn pin_message(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, seq)): Path<(Uuid, i64)>,
    Json(request): Json<PinMessageRequest>,
) -> Result<Json<ChatMessage>, AppError> {
    Ok(Json(
        infrastructure::pin_message(
            &state.db,
            conversation_id,
            seq,
            &principal.username,
            &request,
        )
        .await?,
    ))
}

/// The pinned messages of one room.
pub async fn pinned_messages(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<Vec<ChatMessage>>, AppError> {
    Ok(Json(
        infrastructure::pinned_messages(&state.db, conversation_id, &principal.username).await?,
    ))
}

/// Words in any room the caller is in, or in one of them.
pub async fn search(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Vec<ChatSearchHit>>, AppError> {
    Ok(Json(
        infrastructure::search_messages(
            &state.db,
            &principal.username,
            &query.q,
            query.conversation_id,
        )
        .await?,
    ))
}

/// Rename a group.
pub async fn rename_conversation(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<RenameConversationRequest>,
) -> Result<Json<ChatConversation>, AppError> {
    Ok(Json(
        infrastructure::rename_conversation(
            &state.db,
            conversation_id,
            &principal.username,
            &request,
        )
        .await?,
    ))
}

/// The caller's own settings for one room.
pub async fn set_preferences(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<ConversationPreferencesRequest>,
) -> Result<Json<ChatConversation>, AppError> {
    Ok(Json(
        infrastructure::set_preferences(&state.db, conversation_id, &principal.username, &request)
            .await?,
    ))
}

pub async fn add_participants(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
    Json(request): Json<AddParticipantsRequest>,
) -> Result<Json<ChatConversation>, AppError> {
    Ok(Json(
        infrastructure::add_participants(&state.db, conversation_id, &principal.username, &request)
            .await?,
    ))
}

/// Remove somebody from a group, or — naming yourself — leave it.
///
/// `204` when the caller is no longer in the room afterwards: there is no
/// conversation left that they could be shown.
pub async fn remove_participant(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, username)): Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    let after = infrastructure::remove_participant(
        &state.db,
        conversation_id,
        &principal.username,
        &username,
    )
    .await?;
    Ok(match after {
        Some(conversation) => Json(conversation).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

pub async fn set_admin(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, username)): Path<(Uuid, String)>,
    Json(request): Json<SetAdminRequest>,
) -> Result<Json<ChatConversation>, AppError> {
    Ok(Json(
        infrastructure::set_admin(
            &state.db,
            conversation_id,
            &principal.username,
            &username,
            &request,
        )
        .await?,
    ))
}

// ─── Typing ──────────────────────────────────────────────────────────────────

/// How long "is typing" lasts after the last keystroke was reported. The
/// browser reports at most every few seconds while somebody types, so this is
/// a little longer than that interval and no longer: a line that says Sari is
/// typing ten seconds after she walked away is a line nobody believes.
const TYPING_TTL: Duration = Duration::from_secs(6);

/// Who is typing where, in this process's memory and nowhere else.
///
/// Deliberately not a table and not an event: it is worthless a few seconds
/// after it is true, a row per keystroke would be the busiest write in the
/// schema, and losing it on a restart loses nothing. A deployment running
/// more than one cloud process shows each person the typing reported to the
/// process they asked — best effort, which is all "typing…" has ever been.
fn typing() -> &'static Mutex<HashMap<Uuid, HashMap<String, Instant>>> {
    static TYPING: OnceLock<Mutex<HashMap<Uuid, HashMap<String, Instant>>>> = OnceLock::new();
    TYPING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Say that the caller is typing in this room.
pub async fn report_typing(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    infrastructure::require_participant(&state.db, conversation_id, &principal.username).await?;
    let now = Instant::now();
    // A poisoned lock only means another request panicked mid-update; the map
    // is still a map of instants and is safe to keep using.
    let mut rooms = typing()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Swept on every write, so a room nobody types in any more does not hold
    // its entry for the life of the process.
    rooms.retain(|_, people| {
        people.retain(|_, at| now.duration_since(*at) < TYPING_TTL);
        !people.is_empty()
    });
    rooms
        .entry(conversation_id)
        .or_default()
        .insert(principal.username, now);
    Ok(StatusCode::NO_CONTENT)
}

/// Who else is typing in this room right now.
pub async fn who_is_typing(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<Vec<String>>, AppError> {
    infrastructure::require_participant(&state.db, conversation_id, &principal.username).await?;
    let now = Instant::now();
    let rooms = typing()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut names: Vec<String> = rooms
        .get(&conversation_id)
        .map(|people| {
            people
                .iter()
                .filter(|(name, at)| {
                    name.as_str() != principal.username && now.duration_since(**at) < TYPING_TTL
                })
                .map(|(name, _)| name.clone())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    Ok(Json(names))
}

/// The files in one conversation, for the panel beside the thread.
pub async fn conversation_files(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(conversation_id): Path<Uuid>,
) -> Result<Json<Vec<StoredFile>>, AppError> {
    Ok(Json(
        infrastructure::conversation_files(&state.db, conversation_id, &principal.username).await?,
    ))
}

/// The bytes, fetched through the conversation that carries them.
///
/// The conversation id in the path is not decoration: it is the permission.
/// A file id alone reaches nothing here.
pub async fn attachment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((conversation_id, file_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    if !infrastructure::conversation_attachment_is_reachable(
        &state.db,
        conversation_id,
        file_id,
        &principal.username,
    )
    .await?
    {
        // The same answer whether the file is elsewhere or the caller is not
        // in the room: distinguishing them would confirm the file exists.
        return Err(AppError::NotFound("no such attachment".into()));
    }
    let content = infrastructure::read_file(&state, file_id).await?;
    Ok(super::files::download_response(content))
}

/// Everything happening, resumable from where the caller left off.
pub async fn stream(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<StreamQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let start = match query.after {
        Some(after) => after,
        None => infrastructure::latest_event_id(&state.db).await?,
    };

    struct Cursor {
        state: AppState,
        username: String,
        after: i64,
        pending: VecDeque<infrastructure::CollaborationEvent>,
    }

    let stream = futures_util::stream::unfold(
        Cursor {
            state,
            username: principal.username,
            after: start,
            pending: VecDeque::new(),
        },
        |mut cursor| async move {
            loop {
                if let Some(event) = cursor.pending.pop_front() {
                    cursor.after = event.event_id;
                    // The id is what the browser sends back as `after` on a
                    // reconnect — EventSource echoes it automatically as
                    // Last-Event-ID, and this screen also keeps it in view so
                    // a person can see how far behind they are.
                    let sse = Event::default()
                        .id(event.event_id.to_string())
                        .event(event.kind)
                        .data(event.payload.to_string());
                    return Some((Ok(sse), cursor));
                }
                match infrastructure::events_after(
                    &cursor.state.db,
                    &cursor.username,
                    cursor.after,
                    EVENT_BATCH,
                )
                .await
                {
                    Ok(events) if !events.is_empty() => cursor.pending.extend(events),
                    Ok(_) => tokio::time::sleep(POLL_INTERVAL).await,
                    Err(error) => {
                        // A database blip must not tear down every open tab.
                        // Log it, wait, and try again; the keep-alive below
                        // holds the connection while we do.
                        tracing::warn!(%error, "collaboration stream poll failed");
                        tokio::time::sleep(POLL_INTERVAL).await;
                    }
                }
            }
        },
    );

    // Comment frames, so a proxy between here and the browser does not decide
    // an idle conversation is a dead connection.
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

/// Catching up without a stream at all.
///
/// A browser that cannot hold an event stream open — a locked-down proxy, a
/// tab the phone suspended — asks for the same events by polling this. It is
/// the identical query, so neither path can drift into showing a different
/// history from the other.
pub async fn events(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<StreamQuery>,
) -> Result<Json<Vec<infrastructure::CollaborationEvent>>, AppError> {
    let after = match query.after {
        Some(after) => after,
        None => infrastructure::latest_event_id(&state.db).await?,
    };
    Ok(Json(
        infrastructure::events_after(&state.db, &principal.username, after, EVENT_BATCH).await?,
    ))
}
