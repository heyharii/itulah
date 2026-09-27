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
//! away. It is also what "seen by" is: everybody whose mark has passed a
//! message has read it.
//!
//! **Sending twice writes once.** The browser mints an idempotency key before
//! its first attempt, so a resend after a dropped connection carries the same
//! key and lands on the same row. That is what makes optimistic rendering
//! honest rather than a guess that occasionally duplicates.
//!
//! Since `0476`, a message can also be edited, deleted, answered, reacted to
//! and pinned, and a group can be renamed and can gain and lose people. None
//! of those mint a `seq` except the lines a room writes about itself
//! (`SYSTEM`), and a deleted message keeps its number: a gap in the numbering
//! would be indistinguishable, to a reader catching up, from a message it has
//! not been sent yet.

use super::files::{StoredFile, FILE_COLUMNS};
use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{types::Json, PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Somebody in a conversation, as everybody else in it sees them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatMember {
    pub username: String,
    /// The name on their account, or the username when the account has none.
    pub display_name: String,
    /// May rename the room and add, remove and promote people.
    pub is_admin: bool,
    /// How far they have read. Every message at or below this is "seen" by
    /// them — the read receipt is this number, not a second table.
    pub last_read_seq: i64,
}

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
    /// The same people with their names, roles and read marks.
    pub members: Vec<ChatMember>,
    pub created_by: String,
    /// The highest number written to this conversation.
    pub latest_message_seq: i64,
    /// How far this reader has got. The two together place the unread line.
    pub last_read_seq: i64,
    pub unread_count: i64,
    /// Unread messages that name this reader with `@`. A muted room still
    /// asks for attention when somebody asks for you by name.
    pub mention_count: i64,
    pub last_activity_at: DateTime<Utc>,
    /// The last line of it, for the list. Absent when nobody has said anything.
    pub preview: Option<String>,
    /// Absent for a line the room wrote about itself.
    pub preview_author: Option<String>,
    /// This reader's own settings. Nobody else sees them.
    pub muted: bool,
    pub pinned: bool,
    pub archived: bool,
    /// Whether this reader may manage the room.
    pub is_admin: bool,
}

/// The line a reply answers, carried on the reply so the quote draws without
/// a second request — and without needing the quoted message to be loaded.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatReplyPreview {
    pub seq: i64,
    pub author: String,
    pub author_name: String,
    /// The first couple of hundred characters. Empty when deleted.
    pub body: String,
    pub deleted: bool,
    pub has_attachments: bool,
}

/// One emoji on one message, and who put it there, first first.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatReaction {
    pub emoji: String,
    pub users: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatMessage {
    pub conversation_id: Uuid,
    pub seq: i64,
    pub message_id: Uuid,
    /// `TEXT`, or `SYSTEM` for a line the room wrote about itself.
    pub kind: String,
    pub author: String,
    pub author_name: String,
    pub body: String,
    pub reply_to_seq: Option<i64>,
    pub reply_to: Option<ChatReplyPreview>,
    pub sent_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    /// When it was deleted. Its words and files are gone; its place is not.
    pub deleted_at: Option<DateTime<Utc>>,
    pub pinned_at: Option<DateTime<Utc>>,
    pub pinned_by: Option<String>,
    /// Usernames this message names with `@`.
    pub mentions: Vec<String>,
    pub reactions: Vec<ChatReaction>,
    pub attachments: Vec<StoredFile>,
}

/// A message found by a search, with the room it is in.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ChatSearchHit {
    pub conversation_id: Uuid,
    pub conversation_title: String,
    pub seq: i64,
    pub author: String,
    pub author_name: String,
    pub body: String,
    pub sent_at: DateTime<Utc>,
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
pub struct EditMessageRequest {
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReactRequest {
    pub emoji: String,
    /// `true` puts it on, `false` takes it off. Stated rather than toggled, so
    /// a double click or a retried request lands where the person meant.
    pub on: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PinMessageRequest {
    pub pinned: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RenameConversationRequest {
    pub title: String,
}

/// This reader's own settings for one room. Absent fields are left alone.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ConversationPreferencesRequest {
    #[serde(default)]
    pub muted: Option<bool>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub archived: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AddParticipantsRequest {
    pub participants: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetAdminRequest {
    pub is_admin: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MarkReadRequest {
    /// Where reading stopped. Never moves backwards.
    pub last_read_seq: i64,
}

/// How much of a thread one request pulls when it does not say. A
/// conversation is read from the bottom, so this is the most recent page.
const MESSAGE_PAGE: i64 = 50;

/// The most one request may pull. A browser refreshing the window it already
/// holds asks with `after`, and may hold several pages.
const MESSAGE_PAGE_MAX: i64 = 500;

/// Longest message, in characters. Past this it is a document.
const MAX_BODY_CHARS: usize = 8_000;

/// Longest group name.
const MAX_TITLE_CHARS: usize = 80;

/// Most different emoji on one message. A reaction row is a glance, not a
/// second conversation.
const MAX_DISTINCT_REACTIONS: i64 = 20;

/// The conversation as `$1` sees it. Callers append their own `WHERE`.
///
/// Members are aggregated here, with names, so the screen can resolve an
/// author, place read receipts and offer `@` completions without a second
/// request per room.
const CONVERSATION_SELECT: &str = "
    SELECT c.conversation_id, c.kind, c.title, c.created_by, c.latest_seq,
           c.last_activity_at,
           me.last_read_seq, me.is_admin AS me_admin,
           (me.muted_at IS NOT NULL) AS me_muted,
           (me.pinned_at IS NOT NULL) AS me_pinned,
           (me.archived_at IS NOT NULL) AS me_archived,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                          'username', p.username,
                          'display_name', COALESCE(NULLIF(btrim(u.display_name), ''), p.username),
                          'is_admin', p.is_admin,
                          'last_read_seq', p.last_read_seq)
                      ORDER BY p.username)
                 FROM chat_participant p
                 LEFT JOIN app_user u ON u.username = p.username
                WHERE p.conversation_id = c.conversation_id
           ), '[]'::jsonb) AS members,
           (SELECT count(*) FROM chat_message mm
             WHERE mm.conversation_id = c.conversation_id
               AND mm.seq > me.last_read_seq
               AND mm.deleted_at IS NULL
               AND $1 = ANY(mm.mentions)) AS mention_count,
           last.kind AS preview_kind, last.body AS preview_body,
           last.deleted_at AS preview_deleted_at,
           last.author_name AS preview_author,
           last.first_file AS preview_file
      FROM chat_conversation c
      JOIN chat_participant me
        ON me.conversation_id = c.conversation_id AND me.username = $1
      LEFT JOIN LATERAL (
           SELECT m.kind, m.body, m.deleted_at,
                  COALESCE(NULLIF(btrim(u.display_name), ''), m.author_username) AS author_name,
                  (SELECT f.file_name FROM chat_message_attachment a
                     JOIN stored_file f ON f.file_id = a.file_id
                    WHERE a.conversation_id = m.conversation_id AND a.seq = m.seq
                    ORDER BY f.uploaded_at LIMIT 1) AS first_file
             FROM chat_message m
             LEFT JOIN app_user u ON u.username = m.author_username
            WHERE m.conversation_id = c.conversation_id
            ORDER BY m.seq DESC
            LIMIT 1
      ) last ON true";

/// Every conversation this person is in: pinned first, then busiest first.
/// Archived rooms are included and flagged; the screen decides where they go.
pub async fn list_conversations(
    db: &PgPool,
    username: &str,
) -> Result<Vec<ChatConversation>, AppError> {
    let rows = sqlx::query(&format!(
        "{CONVERSATION_SELECT}
          ORDER BY (me.pinned_at IS NULL), me.pinned_at DESC, c.last_activity_at DESC"
    ))
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
    let Json(members): Json<Vec<ChatMember>> = row.try_get("members")?;
    let participants: Vec<String> = members.iter().map(|m| m.username.clone()).collect();
    let latest_message_seq: i64 = row.try_get("latest_seq")?;
    let last_read_seq: i64 = row.try_get("last_read_seq")?;
    // A direct conversation is named by the other person, which is a different
    // name for each of the two people in it. Storing one would mean showing
    // somebody their own name in their conversation list.
    let title = match stored_title {
        Some(title) if !title.trim().is_empty() => title,
        _ => members
            .iter()
            .find(|member| member.username != reader)
            .map(|member| member.display_name.clone())
            .unwrap_or_else(|| "Just you".to_string()),
    };

    let preview_kind: Option<String> = row.try_get("preview_kind")?;
    let preview_body: Option<String> = row.try_get("preview_body")?;
    let preview_deleted: Option<DateTime<Utc>> = row.try_get("preview_deleted_at")?;
    let preview_file: Option<String> = row.try_get("preview_file")?;
    let preview_author: Option<String> = row.try_get("preview_author")?;
    let is_system = preview_kind.as_deref() == Some("SYSTEM");
    // What the list says under the name. A deleted line and a photograph with
    // no caption both have an empty body, and "" under a name reads as a bug.
    let preview = preview_body.map(|body| {
        if preview_deleted.is_some() {
            "Message deleted".to_string()
        } else if body.trim().is_empty() {
            match &preview_file {
                Some(name) => format!("📎 {name}"),
                None => "📎 Attachment".to_string(),
            }
        } else {
            body
        }
    });

    Ok(ChatConversation {
        conversation_id: row.try_get("conversation_id")?,
        kind,
        title,
        participants,
        members,
        created_by: row.try_get("created_by")?,
        latest_message_seq,
        last_read_seq,
        // Never negative, even if a read mark somehow overtook the high-water
        // mark: a screen showing "-1 unread" is a screen nobody trusts again.
        unread_count: (latest_message_seq - last_read_seq).max(0),
        mention_count: row.try_get("mention_count")?,
        last_activity_at: row.try_get("last_activity_at")?,
        preview,
        preview_author: if is_system { None } else { preview_author },
        muted: row.try_get("me_muted")?,
        pinned: row.try_get("me_pinned")?,
        archived: row.try_get("me_archived")?,
        is_admin: row.try_get("me_admin")?,
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
        Err(no_conversation(conversation_id))
    }
}

fn no_conversation(conversation_id: Uuid) -> AppError {
    AppError::NotFound(format!("no conversation {conversation_id}"))
}

/// One conversation, as this reader sees it.
pub async fn read_conversation(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
) -> Result<ChatConversation, AppError> {
    let row = sqlx::query(&format!(
        "{CONVERSATION_SELECT} WHERE c.conversation_id = $2"
    ))
    .bind(username)
    .bind(conversation_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| no_conversation(conversation_id))?;
    conversation_from_row(&row, username)
}

/// A message, with who wrote it, what it answers and who reacted. Callers
/// append their own `WHERE`; `m` is the message.
const MESSAGE_SELECT: &str = "
    SELECT m.conversation_id, m.seq, m.message_id, m.kind, m.author_username,
           COALESCE(NULLIF(btrim(u.display_name), ''), m.author_username) AS author_name,
           m.body, m.reply_to_seq, m.sent_at, m.edited_at, m.deleted_at,
           m.pinned_at, m.pinned_by, m.mentions,
           r.author_username AS reply_author,
           COALESCE(NULLIF(btrim(ru.display_name), ''), r.author_username) AS reply_author_name,
           left(r.body, 200) AS reply_body,
           (r.deleted_at IS NOT NULL) AS reply_deleted,
           EXISTS (SELECT 1 FROM chat_message_attachment ra
                    WHERE ra.conversation_id = r.conversation_id AND ra.seq = r.seq)
               AS reply_has_files,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object('emoji', g.emoji, 'users', g.users)
                                ORDER BY g.first_at, g.emoji)
                 FROM (SELECT x.emoji,
                              array_agg(x.username ORDER BY x.reacted_at, x.username) AS users,
                              min(x.reacted_at) AS first_at
                         FROM chat_reaction x
                        WHERE x.conversation_id = m.conversation_id AND x.seq = m.seq
                        GROUP BY x.emoji) g
           ), '[]'::jsonb) AS reactions
      FROM chat_message m
      LEFT JOIN app_user u ON u.username = m.author_username
      LEFT JOIN chat_message r
        ON r.conversation_id = m.conversation_id AND r.seq = m.reply_to_seq
      LEFT JOIN app_user ru ON ru.username = r.author_username";

/// Rows selected with [`MESSAGE_SELECT`], with their files stitched on.
async fn messages_from_rows(
    db: &PgPool,
    conversation_id: Uuid,
    rows: &[sqlx::postgres::PgRow],
) -> Result<Vec<ChatMessage>, AppError> {
    let seqs: Vec<i64> = rows
        .iter()
        .map(|row| row.try_get::<i64, _>("seq"))
        .collect::<Result<_, _>>()?;
    let attachment_rows = if seqs.is_empty() {
        Vec::new()
    } else {
        sqlx::query(&format!(
            "SELECT a.seq, {FILE_COLUMNS}
               FROM chat_message_attachment a
               JOIN stored_file f ON f.file_id = a.file_id
              WHERE a.conversation_id = $1 AND a.seq = ANY($2)
              ORDER BY a.seq, f.uploaded_at"
        ))
        .bind(conversation_id)
        .bind(&seqs)
        .fetch_all(db)
        .await?
    };

    rows.iter()
        .map(|row| {
            let seq: i64 = row.try_get("seq")?;
            let attachments = attachment_rows
                .iter()
                .filter(|a| a.try_get::<i64, _>("seq").ok() == Some(seq))
                .map(super::files::file_from_row)
                .collect::<Result<Vec<_>, AppError>>()?;
            message_from_row(row, attachments)
        })
        .collect()
}

fn message_from_row(
    row: &sqlx::postgres::PgRow,
    attachments: Vec<StoredFile>,
) -> Result<ChatMessage, AppError> {
    let reply_to_seq: Option<i64> = row.try_get("reply_to_seq")?;
    let reply_author: Option<String> = row.try_get("reply_author")?;
    let reply_to = match (reply_to_seq, reply_author) {
        (Some(seq), Some(author)) => Some(ChatReplyPreview {
            seq,
            author_name: row
                .try_get::<Option<String>, _>("reply_author_name")?
                .unwrap_or_else(|| author.clone()),
            author,
            body: row
                .try_get::<Option<String>, _>("reply_body")?
                .unwrap_or_default(),
            deleted: row.try_get("reply_deleted")?,
            has_attachments: row.try_get("reply_has_files")?,
        }),
        _ => None,
    };
    let Json(reactions): Json<Vec<ChatReaction>> = row.try_get("reactions")?;
    Ok(ChatMessage {
        conversation_id: row.try_get("conversation_id")?,
        seq: row.try_get("seq")?,
        message_id: row.try_get("message_id")?,
        kind: row.try_get("kind")?,
        author: row.try_get("author_username")?,
        author_name: row.try_get("author_name")?,
        body: row.try_get("body")?,
        reply_to_seq,
        reply_to,
        sent_at: row.try_get("sent_at")?,
        edited_at: row.try_get("edited_at")?,
        deleted_at: row.try_get("deleted_at")?,
        pinned_at: row.try_get("pinned_at")?,
        pinned_by: row.try_get("pinned_by")?,
        mentions: row.try_get("mentions")?,
        reactions,
        attachments,
    })
}

/// Which slice of a thread to read.
#[derive(Clone, Copy, Debug, Default)]
pub struct MessageWindow {
    /// Only messages past this `seq` — what a reconnecting browser asks for.
    pub after: Option<i64>,
    /// Only messages before this `seq` — scrolling back.
    pub before: Option<i64>,
    pub limit: Option<i64>,
}

/// The messages, oldest first.
///
/// Whatever the window, the page is the NEWEST `limit` messages inside it:
/// a conversation is read from the bottom, so the page nearest the bottom is
/// the one to hand over, and scrolling back asks again with `before`.
pub async fn read_messages(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    window: MessageWindow,
) -> Result<Vec<ChatMessage>, AppError> {
    require_participant(db, conversation_id, username).await?;
    let default_limit = if window.after.is_some() {
        MESSAGE_PAGE_MAX
    } else {
        MESSAGE_PAGE
    };
    let limit = window
        .limit
        .unwrap_or(default_limit)
        .clamp(1, MESSAGE_PAGE_MAX);
    let rows = sqlx::query(&format!(
        "SELECT * FROM (
             {MESSAGE_SELECT}
              WHERE m.conversation_id = $1 AND m.seq > $2 AND m.seq < $3
              ORDER BY m.seq DESC
              LIMIT $4
         ) page ORDER BY seq"
    ))
    .bind(conversation_id)
    .bind(window.after.unwrap_or(0))
    .bind(window.before.unwrap_or(i64::MAX))
    .bind(limit)
    .fetch_all(db)
    .await?;
    messages_from_rows(db, conversation_id, &rows).await
}

/// Every pinned message in one room, most recently pinned first.
pub async fn pinned_messages(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
) -> Result<Vec<ChatMessage>, AppError> {
    require_participant(db, conversation_id, username).await?;
    let rows = sqlx::query(&format!(
        "{MESSAGE_SELECT}
          WHERE m.conversation_id = $1 AND m.pinned_at IS NOT NULL
          ORDER BY m.pinned_at DESC"
    ))
    .bind(conversation_id)
    .fetch_all(db)
    .await?;
    messages_from_rows(db, conversation_id, &rows).await
}

async fn one_message(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
) -> Result<ChatMessage, AppError> {
    let rows = sqlx::query(&format!(
        "{MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.seq = $2"
    ))
    .bind(conversation_id)
    .bind(seq)
    .fetch_all(db)
    .await?;
    messages_from_rows(db, conversation_id, &rows)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound(format!("no message {seq}")))
}

/// Words anywhere in the conversations this person is in, newest first.
///
/// A plain substring match: a chat is searched for a word somebody remembers
/// typing, and a stemmer that decides "kirim" and "dikirim" are the same word
/// is a stemmer for a language this search does not know it is reading.
pub async fn search_messages(
    db: &PgPool,
    username: &str,
    query: &str,
    conversation_id: Option<Uuid>,
) -> Result<Vec<ChatSearchHit>, AppError> {
    let needle = query.trim();
    if needle.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let pattern = format!("%{}%", escape_like(needle));
    let rows = sqlx::query(
        "SELECT m.conversation_id, m.seq, m.author_username, m.body, m.sent_at,
                COALESCE(NULLIF(btrim(u.display_name), ''), m.author_username) AS author_name,
                COALESCE(NULLIF(btrim(c.title), ''), (
                    SELECT COALESCE(NULLIF(btrim(ou.display_name), ''), o.username)
                      FROM chat_participant o
                      LEFT JOIN app_user ou ON ou.username = o.username
                     WHERE o.conversation_id = c.conversation_id AND o.username <> $1
                     ORDER BY o.username LIMIT 1
                ), 'Just you') AS conversation_title
           FROM chat_message m
           JOIN chat_participant me
             ON me.conversation_id = m.conversation_id AND me.username = $1
           JOIN chat_conversation c ON c.conversation_id = m.conversation_id
           LEFT JOIN app_user u ON u.username = m.author_username
          WHERE m.kind = 'TEXT'
            AND m.deleted_at IS NULL
            AND m.body ILIKE $2 ESCAPE '\\'
            AND ($3::uuid IS NULL OR m.conversation_id = $3)
          ORDER BY m.sent_at DESC, m.seq DESC
          LIMIT 50",
    )
    .bind(username)
    .bind(&pattern)
    .bind(conversation_id)
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(ChatSearchHit {
                conversation_id: row.try_get("conversation_id")?,
                conversation_title: row.try_get("conversation_title")?,
                seq: row.try_get("seq")?,
                author: row.try_get("author_username")?,
                author_name: row.try_get("author_name")?,
                body: row.try_get("body")?,
                sent_at: row.try_get("sent_at")?,
            })
        })
        .collect()
}

/// `%`, `_` and the escape itself, taken literally.
fn escape_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
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
    let mut participants = clean_names(&request.participants);
    participants.push(creator.to_string());
    participants.sort();
    participants.dedup();

    if kind == "DIRECT" && participants.len() != 2 {
        return Err(AppError::Validation(
            "a direct conversation is between exactly two people".into(),
        ));
    }
    let title = match kind.as_str() {
        "GROUP" => Some(group_title(request.title.as_deref().unwrap_or(""))?),
        _ => None,
    };
    known_users(db, &participants).await?;

    if kind == "DIRECT" {
        // The pair, whichever order they were named in.
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT c.conversation_id
               FROM chat_conversation c
              WHERE c.kind = 'DIRECT'
                AND (SELECT array_agg(p.username ORDER BY p.username COLLATE \"C\")
                       FROM chat_participant p
                      WHERE p.conversation_id = c.conversation_id) = $1
              LIMIT 1",
        )
        .bind(&participants)
        .fetch_optional(db)
        .await?;
        if let Some(conversation_id) = existing {
            // Going back to somebody you had archived brings the room back:
            // asking to talk to them is the opposite of filing them away.
            sqlx::query(
                "UPDATE chat_participant SET archived_at = NULL
                  WHERE conversation_id = $1 AND username = $2",
            )
            .bind(conversation_id)
            .bind(creator)
            .execute(db)
            .await?;
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
        "INSERT INTO chat_participant (conversation_id, username, is_admin)
         SELECT $1, name, name = $3 FROM unnest($2::text[]) AS name",
    )
    .bind(conversation_id)
    .bind(&participants)
    .bind(creator)
    .execute(&mut *tx)
    .await?;
    if let Some(title) = &title {
        // The first line of a group, so it is never an empty room in the list
        // and everybody added learns who made it.
        let actor = display_name(&mut tx, creator).await?;
        append_system(
            &mut tx,
            conversation_id,
            creator,
            &format!("{actor} created the group “{title}”"),
        )
        .await?;
    }
    tx.commit().await?;
    read_conversation(db, conversation_id, creator).await
}

fn clean_names(names: &[String]) -> Vec<String> {
    names
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

fn group_title(raw: &str) -> Result<String, AppError> {
    let title = raw.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Validation("a group needs a name".into()));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(AppError::Validation(format!(
            "a group name is at most {MAX_TITLE_CHARS} characters"
        )));
    }
    Ok(title)
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

async fn display_name(
    tx: &mut Transaction<'_, Postgres>,
    username: &str,
) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT NULLIF(btrim(display_name), '') FROM app_user WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    Ok(name.unwrap_or_else(|| username.to_string()))
}

/// Take the next number in a room and write a message under it.
///
/// The `UPDATE … RETURNING` takes the conversation's row lock, so two people
/// sending at the same instant get two different numbers instead of one
/// collision. This is the only place a `seq` is minted.
#[allow(clippy::too_many_arguments)]
async fn append_message(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    author: &str,
    kind: &str,
    body: &str,
    reply_to_seq: Option<i64>,
    idempotency_key: &str,
    mentions: &[String],
) -> Result<i64, AppError> {
    let seq: i64 = sqlx::query_scalar(
        "UPDATE chat_conversation
            SET latest_seq = latest_seq + 1, last_activity_at = now()
          WHERE conversation_id = $1
      RETURNING latest_seq",
    )
    .bind(conversation_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| no_conversation(conversation_id))?;

    sqlx::query(
        "INSERT INTO chat_message
             (conversation_id, seq, message_id, author_username, body,
              reply_to_seq, idempotency_key, kind, mentions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(conversation_id)
    .bind(seq)
    .bind(Uuid::new_v4())
    .bind(author)
    .bind(body)
    .bind(reply_to_seq)
    .bind(idempotency_key)
    .bind(kind)
    .bind(mentions)
    .execute(&mut **tx)
    .await?;

    // The author has by definition read their own message, so their unread
    // count does not tick up on the way out. A line the room writes about
    // itself is different: it is "authored" by whoever did the renaming or
    // was left behind by a leaver, and moving their mark past it would
    // silently clear everything they had not read yet — so it only moves a
    // mark that was already at the end.
    sqlx::query(
        "UPDATE chat_participant SET last_read_seq = $3
          WHERE conversation_id = $1 AND username = $2 AND last_read_seq < $3
            AND ($4 = 'TEXT' OR last_read_seq = $3 - 1)",
    )
    .bind(conversation_id)
    .bind(author)
    .bind(seq)
    .bind(kind)
    .execute(&mut **tx)
    .await?;

    let audience = audience(tx, conversation_id).await?;
    record_event(
        tx,
        "chat.message",
        Some(conversation_id),
        None,
        &audience,
        // `kind` and `mentions` ride along so a browser deciding whether to
        // raise an alert can tell a line the room wrote from a person's, and
        // a muted room that names the reader from one that does not.
        json!({
            "conversation_id": conversation_id,
            "seq": seq,
            "author": author,
            "kind": kind,
            "mentions": mentions,
        }),
    )
    .await?;
    Ok(seq)
}

/// A line the room writes about itself.
async fn append_system(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    actor: &str,
    body: &str,
) -> Result<i64, AppError> {
    let key = format!("system:{}", Uuid::new_v4());
    append_message(tx, conversation_id, actor, "SYSTEM", body, None, &key, &[]).await
}

async fn audience(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT username FROM chat_participant WHERE conversation_id = $1")
            .bind(conversation_id)
            .fetch_all(&mut **tx)
            .await?,
    )
}

/// Who a body names with `@`, out of the people in the room.
///
/// A name is matched whole and case-insensitively, and trailing punctuation
/// is let go of — "thanks @sari.m." names `sari.m`. `@all` names everybody
/// else. A name that is not in the room names nobody: mentioning somebody is
/// asking for their attention, and they cannot give it to a room they cannot
/// read.
pub fn mentions_in(body: &str, members: &[String], author: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let is_name_char = |ch: char| ch.is_alphanumeric() || matches!(ch, '.' | '_' | '-');
    let chars: Vec<char> = body.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let at_start = index == 0 || !is_name_char(chars[index - 1]);
        if chars[index] == '@' && at_start {
            let mut end = index + 1;
            while end < chars.len() && is_name_char(chars[end]) {
                end += 1;
            }
            let mut token: String = chars[index + 1..end].iter().collect();
            loop {
                if token.is_empty() {
                    break;
                }
                if token.eq_ignore_ascii_case("all") {
                    found.extend(members.iter().filter(|m| m.as_str() != author).cloned());
                    break;
                }
                if let Some(member) = members.iter().find(|m| m.eq_ignore_ascii_case(&token)) {
                    if member != author {
                        found.push(member.clone());
                    }
                    break;
                }
                match token.chars().last() {
                    Some('.' | '_' | '-') => {
                        token.pop();
                    }
                    _ => break,
                }
            }
            index = end.max(index + 1);
        } else {
            index += 1;
        }
    }
    found.sort();
    found.dedup();
    found
}

fn clean_body(raw: &str) -> Result<String, AppError> {
    let body = raw.trim().to_string();
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::Validation(
            "that message is longer than a message; attach it as a file".into(),
        ));
    }
    Ok(body)
}

/// Say something.
pub async fn send_message(
    db: &PgPool,
    conversation_id: Uuid,
    author: &str,
    request: &SendMessageRequest,
) -> Result<ChatMessage, AppError> {
    require_participant(db, conversation_id, author).await?;
    let body = clean_body(&request.body)?;
    let mut attachments = request.attachments.clone();
    attachments.sort();
    attachments.dedup();
    if body.is_empty() && attachments.is_empty() {
        return Err(AppError::Validation(
            "a message needs words or a file".into(),
        ));
    }
    if attachments.len() > 10 {
        return Err(AppError::Validation(
            "at most ten files on one message".into(),
        ));
    }
    let key = request.idempotency_key.trim();
    if key.is_empty() {
        return Err(AppError::Validation("idempotency_key is required".into()));
    }
    if key.len() > 128 || key.starts_with("system:") {
        return Err(AppError::Validation("that idempotency_key is not usable".into()));
    }

    let mut tx = db.begin().await?;
    // The room's row lock, taken FIRST: two copies of the same send racing
    // then queue here, and the second one finds the first one's row below
    // instead of colliding with it on the unique key.
    sqlx::query("SELECT 1 FROM chat_conversation WHERE conversation_id = $1 FOR UPDATE")
        .bind(conversation_id)
        .execute(&mut *tx)
        .await?;
    // The resend case, answered before anything is written.
    if let Some(seq) = existing_by_key(&mut tx, conversation_id, author, key).await? {
        tx.commit().await?;
        return one_message(db, conversation_id, seq).await;
    }

    // Only files this person uploaded. The attachment route's permission is
    // the room, so attaching somebody else's file id — lifted from a room this
    // person has since left, say — would re-publish it to a new room.
    if !attachments.is_empty() {
        let own: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM stored_file WHERE file_id = ANY($1) AND uploaded_by = $2",
        )
        .bind(&attachments)
        .bind(author)
        .fetch_one(&mut *tx)
        .await?;
        if own != attachments.len() as i64 {
            return Err(AppError::Validation(
                "one of the attachments has not been uploaded".into(),
            ));
        }
    }

    if let Some(reply) = request.reply_to_seq {
        let answerable: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM chat_message
                             WHERE conversation_id = $1 AND seq = $2
                               AND deleted_at IS NULL)",
        )
        .bind(conversation_id)
        .bind(reply)
        .fetch_one(&mut *tx)
        .await?;
        if !answerable {
            return Err(AppError::Validation(
                "the message being answered is not in this conversation".into(),
            ));
        }
    }

    let members = audience(&mut tx, conversation_id).await?;
    let mentions = mentions_in(&body, &members, author);
    let seq = append_message(
        &mut tx,
        conversation_id,
        author,
        "TEXT",
        &body,
        request.reply_to_seq,
        key,
        &mentions,
    )
    .await?;

    for file_id in &attachments {
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

    // Somebody who archived a room and did not mute it has said "not now",
    // not "never": a new message brings it back to the list. A muted room
    // stays where it was put.
    sqlx::query(
        "UPDATE chat_participant SET archived_at = NULL
          WHERE conversation_id = $1 AND archived_at IS NOT NULL
            AND (muted_at IS NULL OR username = $2 OR username = ANY($3))",
    )
    .bind(conversation_id)
    .bind(author)
    .bind(&mentions)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // After the commit, and never able to refuse the message: a phone that
    // cannot be told is a lost buzz, not a lost message.
    if let Err(error) = queue_message_push(db, conversation_id, seq, author, &mentions).await {
        tracing::warn!(%error, %conversation_id, seq, "chat push was not queued");
    }
    one_message(db, conversation_id, seq).await
}

/// Wake the phones of the people this message is FOR.
///
/// A direct message, to the other person, unless they muted the room; and
/// any message, to everybody it names with `@`, muted or not. Not every line
/// of every group: a phone that buzzes for a group's small talk is a phone
/// whose owner turns the buzzing off, and then misses the one that named
/// them. The worker drops a delivery the person has read on another device
/// before it went out (`claim_push_deliveries`).
async fn queue_message_push(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
    author: &str,
    mentions: &[String],
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO push_delivery (conversation_id, message_seq, subscription_id, username)
         SELECT p.conversation_id, $2, s.subscription_id, s.username
           FROM chat_participant p
           JOIN chat_conversation c ON c.conversation_id = p.conversation_id
           JOIN push_subscription s ON s.username = p.username
          WHERE p.conversation_id = $1
            AND p.username <> $3
            AND ((c.kind = 'DIRECT' AND p.muted_at IS NULL) OR p.username = ANY($4))
         ON CONFLICT DO NOTHING",
    )
    .bind(conversation_id)
    .bind(seq)
    .bind(author)
    .bind(mentions)
    .execute(db)
    .await?;
    Ok(())
}

async fn existing_by_key(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    author: &str,
    key: &str,
) -> Result<Option<i64>, AppError> {
    // The key is the author's: somebody else's message is never handed back
    // as "the one you already sent". A clash with another author's key is
    // refused below by the unique constraint rather than answered wrongly.
    let found: Option<(i64, String)> = sqlx::query_as(
        "SELECT seq, author_username FROM chat_message
          WHERE conversation_id = $1 AND idempotency_key = $2",
    )
    .bind(conversation_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await?;
    match found {
        Some((seq, owner)) if owner == author => Ok(Some(seq)),
        Some(_) => Err(AppError::Conflict(
            "that idempotency_key is already used in this conversation".into(),
        )),
        None => Ok(None),
    }
}

/// The message, locked for a change, with who may change it.
struct Target {
    kind: String,
    author: String,
    deleted: bool,
    has_files: bool,
}

async fn lock_message(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    seq: i64,
) -> Result<Target, AppError> {
    let row = sqlx::query(
        "SELECT m.kind, m.author_username, (m.deleted_at IS NOT NULL) AS deleted,
                EXISTS (SELECT 1 FROM chat_message_attachment a
                         WHERE a.conversation_id = m.conversation_id AND a.seq = m.seq)
                    AS has_files
           FROM chat_message m
          WHERE m.conversation_id = $1 AND m.seq = $2
          FOR UPDATE OF m",
    )
    .bind(conversation_id)
    .bind(seq)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no message {seq}")))?;
    Ok(Target {
        kind: row.try_get("kind")?,
        author: row.try_get("author_username")?,
        deleted: row.try_get("deleted")?,
        has_files: row.try_get("has_files")?,
    })
}

async fn announce_update(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    seq: i64,
    change: &str,
    actor: &str,
) -> Result<(), AppError> {
    let audience = audience(tx, conversation_id).await?;
    record_event(
        tx,
        "chat.update",
        Some(conversation_id),
        None,
        &audience,
        json!({
            "conversation_id": conversation_id,
            "seq": seq,
            "change": change,
            "author": actor,
        }),
    )
    .await?;
    Ok(())
}

/// Change what you said. Only yours, only words, and never a deleted one.
pub async fn edit_message(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
    editor: &str,
    request: &EditMessageRequest,
) -> Result<ChatMessage, AppError> {
    require_participant(db, conversation_id, editor).await?;
    let body = clean_body(&request.body)?;
    let mut tx = db.begin().await?;
    let target = lock_message(&mut tx, conversation_id, seq).await?;
    if target.kind != "TEXT" || target.author != editor {
        return Err(AppError::Forbidden("only the author can edit a message".into()));
    }
    if target.deleted {
        return Err(AppError::Conflict("a deleted message cannot be edited".into()));
    }
    if body.is_empty() && !target.has_files {
        return Err(AppError::Validation(
            "a message needs words or a file; delete it instead".into(),
        ));
    }
    let members = audience(&mut tx, conversation_id).await?;
    let mentions = mentions_in(&body, &members, editor);
    let changed = sqlx::query(
        "UPDATE chat_message
            SET body = $3, mentions = $4, edited_at = now()
          WHERE conversation_id = $1 AND seq = $2 AND body IS DISTINCT FROM $3",
    )
    .bind(conversation_id)
    .bind(seq)
    .bind(&body)
    .bind(&mentions)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    // Saving the same words again is not an edit, and saying "edited" on a
    // message nobody changed would be the screen lying about its history.
    if changed > 0 {
        announce_update(&mut tx, conversation_id, seq, "edit", editor).await?;
    }
    tx.commit().await?;
    one_message(db, conversation_id, seq).await
}

/// Take it back. The author may, and so may an admin of a group — the one
/// moderation a room needs. The row and its number stay; the words, the
/// files, the reactions and any pin go.
pub async fn delete_message(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
    actor: &str,
) -> Result<ChatMessage, AppError> {
    require_participant(db, conversation_id, actor).await?;
    let mut tx = db.begin().await?;
    let target = lock_message(&mut tx, conversation_id, seq).await?;
    if target.kind != "TEXT" {
        return Err(AppError::Forbidden(
            "a line the room wrote about itself cannot be deleted".into(),
        ));
    }
    if target.author != actor && !is_group_admin(&mut tx, conversation_id, actor).await? {
        return Err(AppError::Forbidden(
            "only the author or an admin of the group can delete a message".into(),
        ));
    }
    if target.deleted {
        // Already gone: the second click of a double click lands here, and
        // the answer is the same message it would have produced.
        tx.commit().await?;
        return one_message(db, conversation_id, seq).await;
    }
    sqlx::query(
        "UPDATE chat_message
            SET body = '', mentions = '{}', deleted_at = now(),
                pinned_at = NULL, pinned_by = NULL
          WHERE conversation_id = $1 AND seq = $2",
    )
    .bind(conversation_id)
    .bind(seq)
    .execute(&mut *tx)
    .await?;
    // The files leave the room with the message. The bytes stay stored — the
    // same file may be filed as a document elsewhere — but nobody reaches them
    // through this conversation any more.
    sqlx::query("DELETE FROM chat_message_attachment WHERE conversation_id = $1 AND seq = $2")
        .bind(conversation_id)
        .bind(seq)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM chat_reaction WHERE conversation_id = $1 AND seq = $2")
        .bind(conversation_id)
        .bind(seq)
        .execute(&mut *tx)
        .await?;
    announce_update(&mut tx, conversation_id, seq, "delete", actor).await?;
    tx.commit().await?;
    one_message(db, conversation_id, seq).await
}

fn clean_emoji(raw: &str) -> Result<String, AppError> {
    let emoji = raw.trim().to_string();
    let length = emoji.chars().count();
    // Words are not a reaction, but a keycap (1️⃣, #️⃣) is: it carries an
    // ASCII digit and is still an emoji. So what is refused is a reaction
    // made of nothing BUT plain ASCII, and anything with a gap in it.
    if length == 0
        || length > 16
        || emoji.is_ascii()
        || emoji
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(AppError::Validation("that is not a reaction".into()));
    }
    Ok(emoji)
}

/// Put a reaction on, or take it off.
pub async fn react(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
    username: &str,
    request: &ReactRequest,
) -> Result<ChatMessage, AppError> {
    require_participant(db, conversation_id, username).await?;
    let emoji = clean_emoji(&request.emoji)?;
    let mut tx = db.begin().await?;
    let target = lock_message(&mut tx, conversation_id, seq).await?;
    if target.kind != "TEXT" || target.deleted {
        return Err(AppError::Conflict(
            "that message cannot be reacted to".into(),
        ));
    }
    let changed = if request.on {
        let distinct: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT emoji) FROM chat_reaction
              WHERE conversation_id = $1 AND seq = $2 AND emoji <> $3",
        )
        .bind(conversation_id)
        .bind(seq)
        .bind(&emoji)
        .fetch_one(&mut *tx)
        .await?;
        if distinct >= MAX_DISTINCT_REACTIONS {
            return Err(AppError::Validation(
                "that message has as many different reactions as it can hold".into(),
            ));
        }
        sqlx::query(
            "INSERT INTO chat_reaction (conversation_id, seq, username, emoji)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        )
        .bind(conversation_id)
        .bind(seq)
        .bind(username)
        .bind(&emoji)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "DELETE FROM chat_reaction
              WHERE conversation_id = $1 AND seq = $2 AND username = $3 AND emoji = $4",
        )
        .bind(conversation_id)
        .bind(seq)
        .bind(username)
        .bind(&emoji)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    };
    if changed > 0 {
        announce_update(&mut tx, conversation_id, seq, "reaction", username).await?;
    }
    tx.commit().await?;
    one_message(db, conversation_id, seq).await
}

/// Pin a message for the whole room, or unpin it. Anybody in the room may:
/// a pin is a note on the wall, and the wall belongs to everybody at it.
pub async fn pin_message(
    db: &PgPool,
    conversation_id: Uuid,
    seq: i64,
    username: &str,
    request: &PinMessageRequest,
) -> Result<ChatMessage, AppError> {
    require_participant(db, conversation_id, username).await?;
    let mut tx = db.begin().await?;
    let target = lock_message(&mut tx, conversation_id, seq).await?;
    if request.pinned && (target.kind != "TEXT" || target.deleted) {
        return Err(AppError::Conflict("that message cannot be pinned".into()));
    }
    // Only a real change is written and announced: pinning what is already
    // pinned keeps the first pinner and the first time.
    let changed = sqlx::query(
        "UPDATE chat_message
            SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END,
                pinned_by = CASE WHEN $3 THEN $4 ELSE NULL END
          WHERE conversation_id = $1 AND seq = $2
            AND (pinned_at IS NOT NULL) <> $3",
    )
    .bind(conversation_id)
    .bind(seq)
    .bind(request.pinned)
    .bind(username)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed > 0 {
        announce_update(&mut tx, conversation_id, seq, "pin", username).await?;
    }
    tx.commit().await?;
    one_message(db, conversation_id, seq).await
}

/// Move the read mark forward. Never backwards — `last_read_seq < $3` in the
/// predicate — because a screen that scrolls up must not un-read what was
/// already read.
///
/// Announced to the room when it moves, because the mark is also everybody
/// else's "seen by".
pub async fn mark_read(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    last_read_seq: i64,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, username).await?;
    let mut tx = db.begin().await?;
    let moved: Option<i64> = sqlx::query_scalar(
        "UPDATE chat_participant
            SET last_read_seq = LEAST($3, (SELECT latest_seq FROM chat_conversation
                                            WHERE conversation_id = $1))
          WHERE conversation_id = $1 AND username = $2 AND last_read_seq < $3
            AND last_read_seq < (SELECT latest_seq FROM chat_conversation
                                  WHERE conversation_id = $1)
      RETURNING last_read_seq",
    )
    .bind(conversation_id)
    .bind(username)
    .bind(last_read_seq)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(seq) = moved {
        let audience = audience(&mut tx, conversation_id).await?;
        record_event(
            &mut tx,
            "chat.read",
            Some(conversation_id),
            None,
            &audience,
            json!({ "conversation_id": conversation_id, "author": username, "seq": seq }),
        )
        .await?;
    }
    tx.commit().await?;
    read_conversation(db, conversation_id, username).await
}

/// This reader's own settings: muted, pinned, archived.
pub async fn set_preferences(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    request: &ConversationPreferencesRequest,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, username).await?;
    // Each flag is a timestamp so the order of pinning is kept; `CASE` leaves
    // an absent field alone and keeps the time of a flag already set.
    sqlx::query(
        "UPDATE chat_participant SET
             muted_at = CASE WHEN $3::boolean IS NULL THEN muted_at
                             WHEN $3 THEN COALESCE(muted_at, now()) ELSE NULL END,
             pinned_at = CASE WHEN $4::boolean IS NULL THEN pinned_at
                              WHEN $4 THEN COALESCE(pinned_at, now()) ELSE NULL END,
             archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at
                                WHEN $5 THEN COALESCE(archived_at, now()) ELSE NULL END
          WHERE conversation_id = $1 AND username = $2",
    )
    .bind(conversation_id)
    .bind(username)
    .bind(request.muted)
    .bind(request.pinned)
    .bind(request.archived)
    .execute(db)
    .await?;
    read_conversation(db, conversation_id, username).await
}

async fn room_kind(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT kind FROM chat_conversation WHERE conversation_id = $1 FOR UPDATE",
    )
    .bind(conversation_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| no_conversation(conversation_id))
}

async fn is_group_admin(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    username: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM chat_participant p
                          JOIN chat_conversation c ON c.conversation_id = p.conversation_id
                         WHERE p.conversation_id = $1 AND p.username = $2
                           AND p.is_admin AND c.kind = 'GROUP')",
    )
    .bind(conversation_id)
    .bind(username)
    .fetch_one(&mut **tx)
    .await?)
}

/// A group-management call: the room must be a group and the caller one of
/// its admins. The room row is locked for the rest of the transaction, so two
/// admins demoting each other at once cannot leave the room with none.
async fn require_group_admin(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    username: &str,
) -> Result<(), AppError> {
    if room_kind(tx, conversation_id).await? != "GROUP" {
        return Err(AppError::Validation(
            "a direct conversation has no members to manage; start a group".into(),
        ));
    }
    if !is_group_admin(tx, conversation_id, username).await? {
        return Err(AppError::Forbidden(
            "only an admin of the group can do that".into(),
        ));
    }
    Ok(())
}

async fn announce_room(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
    change: &str,
    also_tell: &[String],
) -> Result<(), AppError> {
    let mut audience = audience(tx, conversation_id).await?;
    audience.extend(also_tell.iter().cloned());
    audience.sort();
    audience.dedup();
    record_event(
        tx,
        "chat.room",
        Some(conversation_id),
        None,
        &audience,
        json!({ "conversation_id": conversation_id, "change": change }),
    )
    .await?;
    Ok(())
}

/// A room is never left without somebody who can manage it: when the last
/// admin goes, whoever has been there longest takes over.
async fn keep_an_admin(
    tx: &mut Transaction<'_, Postgres>,
    conversation_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE chat_participant SET is_admin = true
          WHERE conversation_id = $1
            AND NOT EXISTS (SELECT 1 FROM chat_participant a
                             WHERE a.conversation_id = $1 AND a.is_admin)
            AND username = (SELECT q.username FROM chat_participant q
                             WHERE q.conversation_id = $1
                             ORDER BY q.joined_at, q.username LIMIT 1)",
    )
    .bind(conversation_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Rename a group.
pub async fn rename_conversation(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    request: &RenameConversationRequest,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, username).await?;
    let title = group_title(&request.title)?;
    let mut tx = db.begin().await?;
    require_group_admin(&mut tx, conversation_id, username).await?;
    let changed = sqlx::query(
        "UPDATE chat_conversation SET title = $2
          WHERE conversation_id = $1 AND title IS DISTINCT FROM $2",
    )
    .bind(conversation_id)
    .bind(&title)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed > 0 {
        let actor = display_name(&mut tx, username).await?;
        append_system(
            &mut tx,
            conversation_id,
            username,
            &format!("{actor} renamed the group to “{title}”"),
        )
        .await?;
        announce_room(&mut tx, conversation_id, "rename", &[]).await?;
    }
    tx.commit().await?;
    read_conversation(db, conversation_id, username).await
}

/// Bring people into a group. They join reading from the line that says they
/// were added: the history before it is theirs to scroll back through, not a
/// wall of unread they did not miss.
pub async fn add_participants(
    db: &PgPool,
    conversation_id: Uuid,
    username: &str,
    request: &AddParticipantsRequest,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, username).await?;
    let mut names = clean_names(&request.participants);
    names.sort();
    names.dedup();
    if names.is_empty() {
        return Err(AppError::Validation("nobody to add".into()));
    }
    known_users(db, &names).await?;
    let mut tx = db.begin().await?;
    require_group_admin(&mut tx, conversation_id, username).await?;
    let added: Vec<String> = sqlx::query_scalar(
        "INSERT INTO chat_participant (conversation_id, username, last_read_seq)
         SELECT $1, name, c.latest_seq
           FROM unnest($2::text[]) AS name, chat_conversation c
          WHERE c.conversation_id = $1
         ON CONFLICT (conversation_id, username) DO NOTHING
         RETURNING username",
    )
    .bind(conversation_id)
    .bind(&names)
    .fetch_all(&mut *tx)
    .await?;
    if !added.is_empty() {
        let actor = display_name(&mut tx, username).await?;
        let mut who = Vec::with_capacity(added.len());
        for name in &added {
            who.push(display_name(&mut tx, name).await?);
        }
        append_system(
            &mut tx,
            conversation_id,
            username,
            &format!("{actor} added {}", join_names(&who)),
        )
        .await?;
        announce_room(&mut tx, conversation_id, "members", &[]).await?;
    }
    tx.commit().await?;
    read_conversation(db, conversation_id, username).await
}

fn join_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

/// Take somebody out of a group — or, when it is yourself, leave it.
///
/// Leaving needs no permission; removing somebody else needs an admin. A
/// group everybody has left is removed with its history: there is nobody
/// left who could ever read it.
///
/// Answers `None` when the caller is no longer in the room afterwards.
pub async fn remove_participant(
    db: &PgPool,
    conversation_id: Uuid,
    actor: &str,
    target: &str,
) -> Result<Option<ChatConversation>, AppError> {
    require_participant(db, conversation_id, actor).await?;
    let leaving = actor == target;
    let mut tx = db.begin().await?;
    if leaving {
        if room_kind(&mut tx, conversation_id).await? != "GROUP" {
            return Err(AppError::Validation(
                "a direct conversation cannot be left; archive it instead".into(),
            ));
        }
    } else {
        require_group_admin(&mut tx, conversation_id, actor).await?;
    }
    let removed = sqlx::query(
        "DELETE FROM chat_participant WHERE conversation_id = $1 AND username = $2",
    )
    .bind(conversation_id)
    .bind(target)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if removed == 0 {
        return Err(AppError::NotFound(format!("{target} is not in this conversation")));
    }

    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM chat_participant WHERE conversation_id = $1")
            .bind(conversation_id)
            .fetch_one(&mut *tx)
            .await?;
    if remaining == 0 {
        sqlx::query("DELETE FROM chat_conversation WHERE conversation_id = $1")
            .bind(conversation_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(None);
    }

    keep_an_admin(&mut tx, conversation_id).await?;
    let target_name = display_name(&mut tx, target).await?;
    let line = if leaving {
        format!("{target_name} left")
    } else {
        let actor_name = display_name(&mut tx, actor).await?;
        format!("{actor_name} removed {target_name}")
    };
    // Written by whoever is still in the room: a line authored by somebody
    // who can no longer read it would advance a read mark that is gone.
    let author: String = if leaving {
        sqlx::query_scalar(
            "SELECT username FROM chat_participant WHERE conversation_id = $1
              ORDER BY is_admin DESC, joined_at, username LIMIT 1",
        )
        .bind(conversation_id)
        .fetch_one(&mut *tx)
        .await?
    } else {
        actor.to_string()
    };
    append_system(&mut tx, conversation_id, &author, &line).await?;
    announce_room(&mut tx, conversation_id, "members", &[target.to_string()]).await?;
    tx.commit().await?;
    if leaving {
        Ok(None)
    } else {
        Ok(Some(read_conversation(db, conversation_id, actor).await?))
    }
}

/// Make somebody an admin of a group, or stop them being one.
pub async fn set_admin(
    db: &PgPool,
    conversation_id: Uuid,
    actor: &str,
    target: &str,
    request: &SetAdminRequest,
) -> Result<ChatConversation, AppError> {
    require_participant(db, conversation_id, actor).await?;
    let mut tx = db.begin().await?;
    require_group_admin(&mut tx, conversation_id, actor).await?;
    let changed = sqlx::query(
        "UPDATE chat_participant SET is_admin = $3
          WHERE conversation_id = $1 AND username = $2 AND is_admin <> $3",
    )
    .bind(conversation_id)
    .bind(target)
    .bind(request.is_admin)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    let present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM chat_participant
                         WHERE conversation_id = $1 AND username = $2)",
    )
    .bind(conversation_id)
    .bind(target)
    .fetch_one(&mut *tx)
    .await?;
    if !present {
        return Err(AppError::NotFound(format!("{target} is not in this conversation")));
    }
    if changed > 0 {
        let admins: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM chat_participant WHERE conversation_id = $1 AND is_admin",
        )
        .bind(conversation_id)
        .fetch_one(&mut *tx)
        .await?;
        if admins == 0 {
            return Err(AppError::Conflict(
                "a group needs at least one admin; make somebody else one first".into(),
            ));
        }
        let actor_name = display_name(&mut tx, actor).await?;
        let target_name = display_name(&mut tx, target).await?;
        let line = if request.is_admin {
            format!("{actor_name} made {target_name} an admin")
        } else if actor == target {
            format!("{actor_name} is no longer an admin")
        } else {
            format!("{actor_name} removed {target_name} as an admin")
        };
        append_system(&mut tx, conversation_id, actor, &line).await?;
        announce_room(&mut tx, conversation_id, "members", &[]).await?;
    }
    tx.commit().await?;
    read_conversation(db, conversation_id, actor).await
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

#[cfg(test)]
mod tests {
    use super::{clean_emoji, escape_like, join_names, mentions_in};

    fn room() -> Vec<String> {
        vec!["budi".into(), "sari.m".into(), "Tono_2".into()]
    }

    #[test]
    fn a_mention_names_a_member_and_lets_go_of_punctuation() {
        assert_eq!(
            mentions_in("thanks @sari.m. and @TONO_2!", &room(), "budi"),
            vec!["Tono_2".to_string(), "sari.m".to_string()]
        );
    }

    #[test]
    fn a_mention_is_never_an_email_or_a_stranger_or_yourself() {
        assert!(mentions_in("mail budi@sari.m", &room(), "tono").is_empty());
        assert!(mentions_in("@nobody here", &room(), "budi").is_empty());
        assert!(mentions_in("@budi note to self", &room(), "budi").is_empty());
    }

    #[test]
    fn at_all_names_everybody_else() {
        assert_eq!(
            mentions_in("@all stock count at 4", &room(), "budi"),
            vec!["Tono_2".to_string(), "sari.m".to_string()]
        );
    }

    #[test]
    fn a_reaction_is_an_emoji_and_not_a_word() {
        assert!(clean_emoji("👍").is_ok());
        assert!(clean_emoji("1️⃣").is_ok());
        assert!(clean_emoji(" ❤️ ").is_ok());
        assert!(clean_emoji("ok").is_err());
        assert!(clean_emoji("").is_err());
        assert!(clean_emoji("👍 👍").is_err());
    }

    #[test]
    fn a_search_takes_wildcards_literally() {
        assert_eq!(escape_like(r"50%_off\"), r"50\%\_off\\");
    }

    #[test]
    fn names_are_joined_the_way_a_sentence_joins_them() {
        assert_eq!(join_names(&["A".into()]), "A");
        assert_eq!(join_names(&["A".into(), "B".into()]), "A and B");
        assert_eq!(join_names(&["A".into(), "B".into(), "C".into()]), "A, B and C");
    }
}
