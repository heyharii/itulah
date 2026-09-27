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
    postgres::{self as infrastructure, NotificationDigest, NotificationPage},
    push::PushMessage,
};
use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
    Extension, Json,
};
use futures_util::stream::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    time::Duration,
};
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

/// How often the stream looks at the reader's list.
///
/// Polling, for the reason `http::chat` gives and one of its own. A `LISTEN`
/// connection per open tab is a pool connection per tab, and the pool is sized
/// for requests; one listener fanning out in memory would need a trigger, a
/// dedicated connection with its own reconnect story, and still a poll behind
/// it for whatever it missed while reconnecting. What this polls is one count
/// over `ix_notification_recipient_username` — a few rows per person — so three
/// seconds costs almost nothing, and nobody can tell a notification that took
/// three seconds from one that took none. It also survives a second cloud
/// process, which a notify raised in one process's memory would not.
const STREAM_POLL: Duration = Duration::from_secs(3);

/// Every tenth poll — half a minute — the stream asks whether its session is
/// still one (`postgres::session_is_live`), and ends if not.
const SESSION_CHECK_EVERY: u32 = 10;

/// How far back an arrival is looked for, and how long an announced id is
/// remembered. A notification's `created_at` is when its transaction STARTED,
/// so one that committed late looks older than it is; ten minutes is far past
/// any transaction this estate runs.
const ARRIVAL_WINDOW_MINUTES: i64 = 10;

/// Notifications for the signed-in person, as they arrive.
///
/// `GET /api/v1/notifications/stream`. Three kinds of event:
///
/// - `ready` once, at once: `{unread, total}`, so a client that connects knows
///   where it stands without a second request.
/// - `notification` per new arrival: the same shape a push carries
///   (`push::PushMessage`) — the sentence, the kind, the id, where to go. The
///   desktop shell shows it as a system notification, since Electron cannot
///   receive Web Push; the hub uses it to refresh the list.
/// - `unread` whenever the count moves, including when the person reads
///   something in another tab or on their phone, so every open badge agrees.
///
/// And `signed-out`, last, when the session ends while the stream is open. A
/// browser's `EventSource` reconnects by itself, gets a 401, and stops; the
/// hub falls back to its poll, which then shows the sign-in box.
///
/// Not resumable, deliberately, unlike the chat stream: a client that
/// reconnects refetches the list, which is the whole truth, and a replay of
/// what it missed would be a second, worse copy of it.
pub async fn stream(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let digest = infrastructure::notification_digest(&state.db, &principal.username).await?;
    let window = chrono::Duration::minutes(ARRIVAL_WINDOW_MINUTES);
    // What is already there is not news: remember it as announced.
    let announced: HashMap<Uuid, chrono::DateTime<chrono::Utc>> =
        infrastructure::unread_notifications_since(
            &state.db,
            &principal.username,
            chrono::Utc::now() - window,
            100,
        )
        .await?
        .into_iter()
        .map(|one| (one.notification_id, one.created_at))
        .collect();

    struct Follow {
        state: AppState,
        username: String,
        session_id: Uuid,
        digest: NotificationDigest,
        announced: HashMap<Uuid, chrono::DateTime<chrono::Utc>>,
        pending: VecDeque<Event>,
        polls: u32,
        ended: bool,
    }

    let mut pending = VecDeque::new();
    pending.push_back(
        Event::default()
            .event("ready")
            .retry(Duration::from_secs(5))
            .data(json!({ "unread": digest.unread, "total": digest.total }).to_string()),
    );

    let stream = futures_util::stream::unfold(
        Follow {
            state,
            username: principal.username,
            // Nil when authentication is off: there is no session to outlive.
            session_id: principal.session_id,
            digest,
            announced,
            pending,
            polls: 0,
            ended: false,
        },
        move |mut follow| async move {
            loop {
                if let Some(event) = follow.pending.pop_front() {
                    return Some((Ok(event), follow));
                }
                if follow.ended {
                    return None;
                }
                tokio::time::sleep(STREAM_POLL).await;
                follow.polls = follow.polls.wrapping_add(1);

                if !follow.session_id.is_nil() && follow.polls % SESSION_CHECK_EVERY == 0 {
                    match infrastructure::session_is_live(
                        &follow.state.db,
                        follow.session_id,
                        follow.state.config.auth_session_idle_minutes,
                    )
                    .await
                    {
                        Ok(true) => {}
                        Ok(false) => {
                            follow
                                .pending
                                .push_back(Event::default().event("signed-out").data("{}"));
                            follow.ended = true;
                            continue;
                        }
                        // A blip is not a sign-out; ask again next time.
                        Err(error) => tracing::warn!(%error, "notification stream session check failed"),
                    }
                }

                let digest =
                    match infrastructure::notification_digest(&follow.state.db, &follow.username)
                        .await
                    {
                        Ok(digest) => digest,
                        Err(error) => {
                            // A database blip must not tear down every open
                            // tab; the keep-alive holds the connection.
                            tracing::warn!(%error, "notification stream poll failed");
                            continue;
                        }
                    };
                if digest == follow.digest {
                    continue;
                }
                let horizon = chrono::Utc::now() - chrono::Duration::minutes(ARRIVAL_WINDOW_MINUTES);
                follow.announced.retain(|_, at| *at >= horizon);
                if digest.total > follow.digest.total {
                    match infrastructure::unread_notifications_since(
                        &follow.state.db,
                        &follow.username,
                        horizon,
                        20,
                    )
                    .await
                    {
                        Ok(arrived) => {
                            // Oldest first, so a client showing them in turn
                            // shows them in the order they happened.
                            for one in arrived.into_iter().rev() {
                                if follow.announced.contains_key(&one.notification_id) {
                                    continue;
                                }
                                follow.announced.insert(one.notification_id, one.created_at);
                                let message = PushMessage::new(
                                    one.notification_id,
                                    &one.kind,
                                    &one.title,
                                    &one.body,
                                    one.subject_kind,
                                    one.subject_id,
                                );
                                if let Ok(data) = serde_json::to_string(&message) {
                                    follow
                                        .pending
                                        .push_back(Event::default().event("notification").data(data));
                                }
                            }
                        }
                        Err(error) => tracing::warn!(%error, "notification stream read failed"),
                    }
                }
                follow.digest = digest;
                follow.pending.push_back(
                    Event::default().event("unread").data(
                        json!({ "unread": digest.unread, "total": digest.total }).to_string(),
                    ),
                );
            }
        },
    );

    // Comment frames every fifteen seconds, so a proxy between here and the
    // browser does not decide a quiet afternoon is a dead connection.
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
