//! Conversations: ordered, resumable, and idempotent on send.
//!
//! Three properties the screen depends on, all of them decided here:
//!
//! **Order is `seq`, not a clock.** Every message takes the next number in its
//! own conversation, allocated inside the transaction that writes it. A till
//! whose time is wrong cannot insert itself into the middle of a thread.
//!
//! **Unread is a position.** `last_read_seq` per participant, so the thread
//! can draw one line exactly where reading stopped. The count is a subtraction
//! the screen can do; the position is information a count would have thrown
//! away.
//!
//! **Sending twice writes once.** The browser mints an idempotency key before
//! its first attempt, so a resend after a dropped connection carries the same
//! key and lands on the same row. That is what makes optimistic rendering
//! honest rather than a guess that occasionally duplicates.

use super::files::{StoredFile, FILE_COLUMNS};
use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// A conversation as one particular person sees it.
///
/// `title` is resolved per reader, because a direct conversation has no name
/// of its own — it is named by whoever else is in it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatConversation {
    pub conversation_id: Uuid,
    /// `DIRECT` or `GROUP`.
    pub kind: String,
    pub title: String,
    pub participants: Vec<String>,
    /// The highest number written to this conversation.
    pub latest_message_seq: i64,
    /// How far this reader has got. The two together place the unread line.
    pub last_read_seq: i64,
    pub unread_count: i64,
    pub last_activity_at: DateTime<Utc>,
    /// The last line of it, for the list. Absent when nobody has said anything.
    pub preview: Option<String>,
    pub preview_author: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatMessage {
    pub conversation_id: Uuid,
    pub seq: i64,
    pub message_id: Uuid,
    pub author: String,
    pub body: String,
    pub reply_to_seq: Option<i64>,
    pub sent_at: DateTime<Utc>,
    pub attachments: Vec<StoredFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StartConversationRequest {
    /// `DIRECT` or `GROUP`. A direct conversation between the same two people
    /// is reused rather than duplicated.
    pub kind: String,
    /// Required for a group, ignored for a direct one.
    pub title: Option<String>,
    /// Everyone else. The caller is added by the server, never by the request.
    pub participants: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SendMessageRequest {
    pub body: String,
    /// Minted by the browser before its first attempt, so a resend after a
    /// dropped connection lands once.
    pub idempotency_key: String,
    pub reply_to_seq: Option<i64>,
    #[serde(default)]
    pub attachments: Vec<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MarkReadRequest {
    /// Where reading stopped. Never moves backwards.
    pub last_read_seq: i64,
}

/// How much of a thread one request may pull. A conversation is read from the
/// bottom, so this is the most recent page and not the first one.
const MESSAGE_PAGE: i64 = 200;

/// Every conversation this person is in, busiest first.
pub async fn list_conversations(
    db: &PgPool,
    username: &str,
) -> Result<Vec<ChatConversation>, AppError> {
    let rows = sqlx::query(
        "SELECT c.conversation_id, c.kind, c.title, c.latest_seq, c.last_activity_at,
                me.last_read_seq,
                ARRAY(SELECT p.username FROM chat_participant p
                       WHERE p.conversation_id = c.conversation_id
                       ORDER BY p.username) AS participants,
                last.body AS preview, last.author_username AS preview_author
           FROM chat_conversation c
           JOIN chat_participant me
             ON me.conversation_id = c.conversation_id AND me.username = $1
           LEFT JOIN LATERAL (
                SELECT m.body, m.author_username
                  FROM chat_message m
                 WHERE m.conversation_id = c.conversation_id
                 ORDER BY m.seq DESC
                 LIMIT 1
           ) last ON true
          ORDER BY c.last_activity_at DESC",
    )
    .bind(username)
    .fetch_all(db)
    .await?;

    rows.iter()
        .map(|row| conversation_from_row(row, username))
        .collect()
}

fn conversation_from_row(
    row: &sqlx::postgres::PgRow,
    reader: &str,
) -> Result<ChatConversation, AppError> {
    let kind: String = row.try_get("kind")?;
    let stored_title: Option<String> = row.try_get("title")?;
    let participants: Vec<String> = row.try_get("participants")?;
    let latest_message_seq: i64 = row.try_get("latest_seq")?;
    let last_read_seq: i64 = row.try_get("last_read_seq")?;
    // A direct conversation is named by the other person, which is a different
    // name for each of the two people in it. Storing one would mean showing
    // somebody their own name in their conversation list.
    let title = match stored_title {
        Some(title) if !title.trim().is_empty() => title,
        _ => participants
            .iter()
            .find(|name| name.as_str() != reader)
            .cloned()
            .unwrap_or_else(|| "Just you".to_string()),
    };
    Ok(ChatConversation {
        conversation_id: row.try_get("conversation_id")?,
        kind,
        title,
        participants,
        latest_message_seq,
        last_read_seq,
        // Never negative, even if a read mark somehow overtook the high-water
        // mark: a screen showing "-1 unread" is a screen nobody trusts again.
        unread_count: (latest_message_seq - last_read_seq).max(0),
        last_activity_at: row.try_get("last_activity_at")?,
        preview: row.try_get("preview")?,
        preview_author: row.try_get("preview_author")?,
    })
}

/// Refuse anyone who is not in the room, before anything else happens.
///
/// Every read and every write goes through this. It answers `NotFound` rather
/// than `Forbidden` on purpose: telling a stranger that a conversation exists
/// but is not theirs is telling them something.
pub async fn require_participant(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
) -> Result<(), AppError> {
    let present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM chat_participant
                         WHERE conversation_id = $1 AND username = $2)",
    )
    .bind(conversation_id)
    .bind(username)
    .fetch_one(db)
    .await?;
    if present {
        Ok(())
    } else {
        Err(AppError::NotFound(format!(
            "no conversation {conversation_id}"
        )))
    }
}

/// One conversation, as this reader sees it.
pub async fn read_conversation(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, username).await?;
    let row = sqlx::query(
        "SELECT c.conversation_id, c.kind, c.title, c.latest_seq, c.last_activity_at,
                me.last_read_seq,
                ARRAY(SELECT p.username FROM chat_participant p
                       WHERE p.conversation_id = c.conversation_id
                       ORDER BY p.username) AS participants,
                last.body AS preview, last.author_username AS preview_author
           FROM chat_conversation c
           JOIN chat_participant me
             ON me.conversation_id = c.conversation_id AND me.username = $2
           LEFT JOIN LATERAL (
                SELECT m.body, m.author_username FROM chat_message m
                 WHERE m.conversation_id = c.conversation_id
                 ORDER BY m.seq DESC LIMIT 1
           ) last ON true
          WHERE c.conversation_id = $1",
    )
    .bind(conversation_id)
    .bind(username)
    .fetch_one(db)
    .await?;
    conversation_from_row(&row, username)
}

/// The messages, oldest first, from `after` onwards.
///
/// `after` is what a reconnecting browser passes: it already has everything up
/// to that number and wants the rest, not the whole thread again.
pub async fn read_messages(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    after: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    require_participant(db, conversation_id, username).await?;
    let rows = sqlx::query(
        "SELECT * FROM (
             SELECT m.conversation_id, m.seq, m.message_id, m.author_username,
                    m.body, m.reply_to_seq, m.sent_at
               FROM chat_message m
              WHERE m.conversation_id = $1 AND m.seq > $2
              ORDER BY m.seq DESC
              LIMIT $3
         ) page ORDER BY seq",
    )
    .bind(conversation_id)
    .bind(after.unwrap_or(0))
    .bind(MESSAGE_PAGE)
    .fetch_all(db)
    .await?;

    let seqs: Vec<i64> = rows.iter().filter_map(|row| row.try_get("seq").ok()).collect();
    let attachment_rows = sqlx::query(&format!(
        "SELECT a.seq, {FILE_COLUMNS}
           FROM chat_message_attachment a
           JOIN stored_file f ON f.file_id = a.file_id
          WHERE a.conversation_id = $1 AND a.seq = ANY($2)
          ORDER BY a.seq, f.uploaded_at"
    ))
    .bind(conversation_id)
    .bind(&seqs)
    .fetch_all(db)
    .await?;

    rows.iter()
        .map(|row| {
            let seq: i64 = row.try_get("seq")?;
            let attachments = attachment_rows
                .iter()
                .filter(|a| a.try_get::<i64, _>("seq").ok() == Some(seq))
                .map(super::files::file_from_row)
                .collect::<Result<Vec<_>, AppError>>()?;
            Ok(ChatMessage {
                conversation_id: row.try_get("conversation_id")?,
                seq,
                message_id: row.try_get("message_id")?,
                author: row.try_get("author_username")?,
                body: row.try_get("body")?,
                reply_to_seq: row.try_get("reply_to_seq")?,
                sent_at: row.try_get("sent_at")?,
                attachments,
            })
        })
        .collect()
}

/// Start one, or hand back the direct conversation that already exists.
///
/// Two people cannot have two direct conversations. Looking for the existing
/// one first is not an optimisation — creating a second would split their
/// history in half without either of them doing anything.
pub async fn start_conversation(
    db: &PgPool,
    creator: &str,
    request: &StartConversationRequest,
) -> Result<ChatConversation, AppError> {
    let kind = request.kind.trim().to_ascii_uppercase();
    if kind != "DIRECT" && kind != "GROUP" {
        return Err(AppError::Validation(
            "a conversation is DIRECT or GROUP".into(),
        ));
    }
    let mut participants: Vec<String> = request
        .participants
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    participants.push(creator.to_string());
    participants.sort();
    participants.dedup();

    if kind == "DIRECT" && participants.len() != 2 {
        return Err(AppError::Validation(
            "a direct conversation is between exactly two people".into(),
        ));
    }
    let title = match kind.as_str() {
        "GROUP" => {
            let title = request.title.as_deref().unwrap_or("").trim().to_string();
            if title.is_empty() {
                return Err(AppError::Validation("a group needs a name".into()));
            }
            Some(title)
        }
        _ => None,
    };
    known_users(db, &participants).await?;

    if kind == "DIRECT" {
        // The pair, whichever order they were named in.
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT c.conversation_id
               FROM chat_conversation c
              WHERE c.kind = 'DIRECT'
                AND (SELECT array_agg(p.username ORDER BY p.username)
                       FROM chat_participant p
                      WHERE p.conversation_id = c.conversation_id) = $1
              LIMIT 1",
        )
        .bind(&participants)
        .fetch_optional(db)
        .await?;
        if let Some(conversation_id) = existing {
            return read_conversation(db, conversation_id, creator).await;
        }
    }

    let conversation_id = Uuid::new_v4();
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO chat_conversation (conversation_id, kind, title, created_by)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(conversation_id)
    .bind(&kind)
    .bind(&title)
    .bind(creator)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO chat_participant (conversation_id, username)
         SELECT $1, unnest($2::text[])",
    )
    .bind(conversation_id)
    .bind(&participants)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    read_conversation(db, conversation_id, creator).await
}

/// Nobody is put in a conversation with a name that is not a person.
///
/// Skipped when the node runs without authentication, where the only actor is
/// the synthetic `development` and `app_user` is empty by design.
async fn known_users(db: &PgPool, usernames: &[String]) -> Result<(), AppError> {
    let unknown: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM unnest($1::text[]) AS name
          WHERE name <> 'development'
            AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.username = name)",
    )
    .bind(usernames)
    .fetch_all(db)
    .await?;
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "no such user: {}",
            unknown.join(", ")
        )))
    }
}

/// Say something.
///
/// The whole thing is one transaction that takes a row lock on the
/// conversation: `latest_seq` is read, incremented and written under that
/// lock, so two people sending at the same instant get two different numbers
/// instead of one collision. Sending is the only place a `seq` is minted.
pub async fn send_message(
    db: &PgPool,
    conversation_id: Uuid,
    author: &str,
    request: &SendMessageRequest,
) -> Result<ChatMessage, AppError> {
    require_participant(db, conversation_id, author).await?;
    let body = request.body.trim().to_string();
    if body.is_empty() && request.attachments.is_empty() {
        return Err(AppError::Validation(
            "a message needs words or a file".into(),
        ));
    }
    if body.chars().count() > 8_000 {
        return Err(AppError::Validation(
            "that message is longer than a message; attach it as a file".into(),
        ));
    }
    let key = request.idempotency_key.trim();
    if key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    super::files::require_files_exist(db, &request.attachments).await?;

    let mut tx = db.begin().await?;
    // The resend case, answered before anything is written. Checked inside the
    // transaction so it also settles two copies of the same send racing.
    if let Some(seq) = existing_by_key(&mut tx, conversation_id, key).await? {
        tx.commit().await?;
        return one_message(db, conversation_id, seq).await;
    }

    let seq: i64 = sqlx::query_scalar(
        "UPDATE chat_conversation
            SET latest_seq = latest_seq + 1, last_activity_at = now()
          WHERE conversation_id = $1
      RETURNING latest_seq",
    )
    .bind(conversation_id)
    .fetch_one(&mut *tx)
    .await?;

    let message_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO chat_message
             (conversation_id, seq, message_id, author_username, body,
              reply_to_seq, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(conversation_id)
    .bind(seq)
    .bind(message_id)
    .bind(author)
    .bind(&body)
    .bind(request.reply_to_seq)
    .bind(key)
    .execute(&mut *tx)
    .await?;

    for file_id in &request.attachments {
        sqlx::query(
            "INSERT INTO chat_message_attachment (conversation_id, seq, file_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(conversation_id)
        .bind(seq)
        .bind(file_id)
        .execute(&mut *tx)
        .await?;
    }

    // The author has by definition read their own message, so their unread
    // count does not tick up on the way out.
    sqlx::query(
        "UPDATE chat_participant SET last_read_seq = $3
          WHERE conversation_id = $1 AND username = $2 AND last_read_seq < $3",
    )
    .bind(conversation_id)
    .bind(author)
    .bind(seq)
    .execute(&mut *tx)
    .await?;

    let audience: Vec<String> = sqlx::query_scalar(
        "SELECT username FROM chat_participant WHERE conversation_id = $1",
    )
    .bind(conversation_id)
    .fetch_all(&mut *tx)
    .await?;
    record_event(
        &mut tx,
        "chat.message",
        Some(conversation_id),
        None,
        &audience,
        json!({ "conversation_id": conversation_id, "seq": seq, "author": author }),
    )
    .await?;
    tx.commit().await?;
    one_message(db, conversation_id, seq).await
}

async fn existing_by_key(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    key: &str,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT seq FROM chat_message
          WHERE conversation_id = $1 AND idempotency_key = $2",
    )
    .bind(conversation_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn one_message(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
) -> Result<ChatMessage, AppError> {
    let row = sqlx::query(
        "SELECT conversation_id, seq, message_id, author_username, body,
                reply_to_seq, sent_at
           FROM chat_message WHERE conversation_id = $1 AND seq = $2",
    )
    .bind(conversation_id)
    .bind(seq)
    .fetch_one(db)
    .await?;
    let attachments = sqlx::query(&format!(
        "SELECT {FILE_COLUMNS} FROM chat_message_attachment a
           JOIN stored_file f ON f.file_id = a.file_id
          WHERE a.conversation_id = $1 AND a.seq = $2
          ORDER BY f.uploaded_at"
    ))
    .bind(conversation_id)
    .bind(seq)
    .fetch_all(db)
    .await?
    .iter()
    .map(super::files::file_from_row)
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(ChatMessage {
        conversation_id: row.try_get("conversation_id")?,
        seq: row.try_get("seq")?,
        message_id: row.try_get("message_id")?,
        author: row.try_get("author_username")?,
        body: row.try_get("body")?,
        reply_to_seq: row.try_get("reply_to_seq")?,
        sent_at: row.try_get("sent_at")?,
        attachments,
    })
}

/// Move the read mark forward. Never backwards — `last_read_seq < $3` in the
/// predicate — because a screen that scrolls up must not un-read what was
/// already read.
pub async fn mark_read(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    last_read_seq: i64,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, username).await?;
    sqlx::query(
        "UPDATE chat_participant
            SET last_read_seq = LEAST($3, (SELECT latest_seq FROM chat_conversation
                                            WHERE conversation_id = $1))
          WHERE conversation_id = $1 AND username = $2 AND last_read_seq < $3",
    )
    .bind(conversation_id)
    .bind(username)
    .bind(last_read_seq)
    .execute(db)
    .await?;
    read_conversation(db, conversation_id, username).await
}

/// Whether this person may fetch these bytes: the file must hang on a message
/// in a conversation they are in. Permission belongs to the room, which is why
/// the file id alone is never enough to reach anything.
pub async fn conversation_attachment_is_reachable(
    db: &PgPool,
    conversation_id: Uuid,
    file_id: Uuid,
    username: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM chat_message_attachment a
              JOIN chat_participant p
                ON p.conversation_id = a.conversation_id AND p.username = $3
             WHERE a.conversation_id = $1 AND a.file_id = $2)",
    )
    .bind(conversation_id)
    .bind(file_id)
    .bind(username)
    .fetch_one(db)
    .await?)
}

/// Every file in one conversation, for the panel beside the thread.
pub async fn conversation_files(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
) -> Result<Vec<StoredFile>, AppError> {
    require_participant(db, conversation_id, username).await?;
    sqlx::query(&format!(
        "SELECT {FILE_COLUMNS} FROM chat_message_attachment a
           JOIN stored_file f ON f.file_id = a.file_id
          WHERE a.conversation_id = $1
          ORDER BY f.uploaded_at DESC"
    ))
    .bind(conversation_id)
    .fetch_all(db)
    .await?
    .iter()
    .map(super::files::file_from_row)
    .collect()
}

/// Append to the resumable stream.
///
/// Written in the same transaction as the thing it describes, so there is no
/// window where a message exists and its event does not — a reader catching up
/// from `after` would skip it forever.
pub(super) async fn record_event(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    conversation_id: Option<Uuid>,
    thread_id: Option<Uuid>,
    audience: &[String],
    payload: serde_json::Value,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO collaboration_event
             (kind, conversation_id, thread_id, audience, payload)
         VALUES ($1, $2, $3, $4, $5) RETURNING event_id",
    )
    .bind(kind)
    .bind(conversation_id)
    .bind(thread_id)
    .bind(audience)
    .bind(payload)
    .fetch_one(&mut **tx)
    .await?)
}

/// One event on the wire.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CollaborationEvent {
    pub event_id: i64,
    pub kind: String,
    /// Shaped by `kind`, so there is no one type to declare. `unknown` rather
    /// than `any`: the browser has to look at `kind` and narrow before it can
    /// read a field, which is exactly what a reader of this event must do.
    #[cfg_attr(feature = "ts", ts(type = "unknown"))]
    pub payload: serde_json::Value,
    pub occurred_at: DateTime<Utc>,
}

/// What this reader missed since `after`.
///
/// The audience filter is in the WHERE clause rather than applied afterwards:
/// a conversation this person is not in must not reach the stream at all, not
/// even to be discarded a line later.
pub async fn events_after(
    db: &PgPool,
    username: &str,
    after: i64,
    limit: i64,
) -> Result<Vec<CollaborationEvent>, AppError> {
    let rows = sqlx::query(
        "SELECT event_id, kind, payload, occurred_at
           FROM collaboration_event
          WHERE event_id > $1
            AND (cardinality(audience) = 0 OR $2 = ANY(audience))
          ORDER BY event_id
          LIMIT $3",
    )
    .bind(after)
    .bind(username)
    .bind(limit.clamp(1, 500))
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(CollaborationEvent {
                event_id: row.try_get("event_id")?,
                kind: row.try_get("kind")?,
                payload: row.try_get("payload")?,
                occurred_at: row.try_get("occurred_at")?,
            })
        })
        .collect()
}

/// The newest event id, so a browser opening the stream fresh starts at the
/// end rather than replaying the whole history it can already see.
pub async fn latest_event_id(db: &PgPool) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT COALESCE(max(event_id), 0) FROM collaboration_event")
            .fetch_one(db)
            .await?,
    )
}
