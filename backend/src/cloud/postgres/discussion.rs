//! Discussions: threads that hang off a record, not off a category.
//!
//! `subject_kind` has nine values and every one of them is a thing this
//! business does — a purchase order, a supplier, one receipt, an exception.
//! There is no "General" and no category table, because a thread that is not
//! about a record is a conversation and conversations have their own screen.
//! That single constraint is what makes the left-hand axis of the forum useful
//! instead of decorative: it is a list of work, and each row names the record
//! being argued about.
//!
//! Three fields most forums hide are load-bearing here:
//!
//! `people` counts DISTINCT PEOPLE who opened the thread, not page loads. The
//! screen says "orang" because that is what the number is; a hit counter
//! wearing the same label would be a lie by rounding.
//!
//! `bookmarked_by_me` is private to the caller. Nothing here aggregates it and
//! no query returns anybody else's.
//!
//! `attachments[].available` is real. A file can be attached and not
//! retrievable, and saying so is better than a link that 404s.

use super::files::{StoredFile, FILE_COLUMNS};
use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The nine subjects a thread may hang on. Rejected here with a list rather
/// than by the database with a constraint violation, so somebody typing a
/// tenth is told what the nine are.
pub const SUBJECT_KINDS: [&str; 9] = [
    "purchase_order",
    "purchase_order_line",
    "supplier",
    "receipt",
    "purchase_exception",
    "commercial_verification",
    "packaging_item",
    "supply_item",
    "article",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DiscussionThread {
    pub thread_id: Uuid,
    /// One of the nine. What the thread is about, structurally.
    pub subject_kind: String,
    /// The record's own identifier, as a person reads it: `PO-2607-0108`.
    pub subject_id: String,
    pub subject_note: Option<String>,
    pub title: String,
    /// `open`, `resolved`, or `locked`.
    pub status: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    pub reply_count: i64,
    /// Distinct people who have opened it. Not page loads.
    pub people: i64,
    pub tags: Vec<String>,
    /// Private to the caller. Nobody sees anyone else's.
    pub bookmarked_by_me: bool,
    /// Everyone who has posted, for the row of faces.
    pub voices: Vec<String>,
    pub latest_post_preview: Option<String>,
    /// Whether one of the replies has been marked as the answer.
    pub has_solution: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DiscussionPost {
    pub post_id: Uuid,
    pub thread_id: Uuid,
    pub seq: i64,
    pub author: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub is_solution: bool,
    pub attachments: Vec<StoredFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct OpenThreadRequest {
    pub subject_kind: String,
    pub subject_id: String,
    pub subject_note: Option<String>,
    pub title: String,
    /// The first post. A thread with no opening argument is a title.
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReplyRequest {
    pub body: String,
    #[serde(default)]
    pub attachments: Vec<Uuid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ThreadQuery {
    /// One of the nine, or absent for all of them.
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    pub tag: Option<String>,
    pub status: Option<String>,
    /// `bookmarked` or `mine`, applied against the caller. Absent means every
    /// thread, which is the honest default: a discussion is readable by
    /// everyone signed in.
    pub feed: Option<String>,
    pub q: Option<String>,
}

const THREAD_SELECT: &str = "SELECT t.thread_id, t.subject_kind, t.subject_id, t.subject_note,
            t.title, t.status, t.created_by, t.created_at, t.last_activity_at,
            (SELECT count(*) FROM discussion_post p
              WHERE p.thread_id = t.thread_id AND p.seq > 1) AS reply_count,
            (SELECT count(*) FROM discussion_thread_view v
              WHERE v.thread_id = t.thread_id) AS people,
            ARRAY(SELECT g.tag FROM discussion_thread_tag g
                   WHERE g.thread_id = t.thread_id ORDER BY g.tag) AS tags,
            EXISTS (SELECT 1 FROM discussion_bookmark b
                     WHERE b.thread_id = t.thread_id AND b.username = $1)
              AS bookmarked_by_me,
            ARRAY(SELECT DISTINCT p.author_username FROM discussion_post p
                   WHERE p.thread_id = t.thread_id) AS voices,
            (SELECT p.body FROM discussion_post p
              WHERE p.thread_id = t.thread_id
              ORDER BY p.seq DESC LIMIT 1) AS latest_post_preview,
            EXISTS (SELECT 1 FROM discussion_post p
                     WHERE p.thread_id = t.thread_id AND p.is_solution)
              AS has_solution
       FROM discussion_thread t";

fn thread_from_row(row: &sqlx::postgres::PgRow) -> Result<DiscussionThread, AppError> {
    Ok(DiscussionThread {
        thread_id: row.try_get("thread_id")?,
        subject_kind: row.try_get("subject_kind")?,
        subject_id: row.try_get("subject_id")?,
        subject_note: row.try_get("subject_note")?,
        title: row.try_get("title")?,
        status: row.try_get("status")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        last_activity_at: row.try_get("last_activity_at")?,
        reply_count: row.try_get("reply_count")?,
        people: row.try_get("people")?,
        tags: row.try_get("tags")?,
        bookmarked_by_me: row.try_get("bookmarked_by_me")?,
        voices: row.try_get("voices")?,
        latest_post_preview: row.try_get("latest_post_preview")?,
        has_solution: row.try_get("has_solution")?,
    })
}

/// The list, most recently argued-in first.
pub async fn list_threads(
    db: &PgPool,
    username: &str,
    query: &ThreadQuery,
) -> Result<Vec<DiscussionThread>, AppError> {
    // Every filter is a bound parameter compared against NULL-or-match, so
    // there is one prepared statement rather than a SQL string built from
    // request fields.
    let rows = sqlx::query(&format!(
        "{THREAD_SELECT}
          WHERE ($2::text IS NULL OR t.subject_kind = $2)
            AND ($3::text IS NULL OR t.subject_id = $3)
            AND ($4::text IS NULL OR EXISTS (
                    SELECT 1 FROM discussion_thread_tag g
                     WHERE g.thread_id = t.thread_id AND g.tag = $4))
            AND ($5::text IS NULL OR t.status = $5)
            AND ($6::text IS NULL OR t.title ILIKE '%' || $6 || '%'
                                  OR t.subject_id ILIKE '%' || $6 || '%')
            AND ($7::text IS DISTINCT FROM 'bookmarked' OR EXISTS (
                    SELECT 1 FROM discussion_bookmark b
                     WHERE b.thread_id = t.thread_id AND b.username = $1))
            AND ($7::text IS DISTINCT FROM 'mine' OR EXISTS (
                    SELECT 1 FROM discussion_post p
                     WHERE p.thread_id = t.thread_id AND p.author_username = $1))
          ORDER BY t.last_activity_at DESC
          LIMIT 200"
    ))
    .bind(username)
    .bind(
        query
            .subject_kind
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(
        query
            .subject_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(
        query
            .tag
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(
        query
            .status
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(query.q.as_deref().map(str::trim).filter(|v| !v.is_empty()))
    .bind(
        query
            .feed
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .fetch_all(db)
    .await?;
    rows.iter().map(thread_from_row).collect()
}

/// One thread. Opening it records that this person has seen it, which is the
/// only thing that ever writes to `discussion_thread_view` — one row per
/// person, so the number stays "people" and never drifts into "visits".
pub async fn read_thread(
    db: &PgPool,
    thread_id: Uuid,
    username: &str,
) -> Result<DiscussionThread, AppError> {
    sqlx::query(
        "INSERT INTO discussion_thread_view (thread_id, username)
         VALUES ($1, $2)
         ON CONFLICT (thread_id, username) DO UPDATE SET last_seen_at = now()",
    )
    .bind(thread_id)
    .bind(username)
    .execute(db)
    .await?;

    let row = sqlx::query(&format!("{THREAD_SELECT} WHERE t.thread_id = $2"))
        .bind(username)
        .bind(thread_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))?;
    thread_from_row(&row)
}

/// The posts, oldest first — a discussion is read from the top, unlike a
/// conversation.
pub async fn read_posts(db: &PgPool, thread_id: Uuid) -> Result<Vec<DiscussionPost>, AppError> {
    let rows = sqlx::query(
        "SELECT post_id, thread_id, seq, author_username, body, created_at, is_solution
           FROM discussion_post WHERE thread_id = $1 ORDER BY seq",
    )
    .bind(thread_id)
    .fetch_all(db)
    .await?;

    let post_ids: Vec<Uuid> = rows
        .iter()
        .filter_map(|row| row.try_get("post_id").ok())
        .collect();
    let attachment_rows = sqlx::query(&format!(
        "SELECT a.post_id, {FILE_COLUMNS}
           FROM discussion_post_attachment a
           JOIN stored_file f ON f.file_id = a.file_id
          WHERE a.post_id = ANY($1) ORDER BY f.uploaded_at"
    ))
    .bind(&post_ids)
    .fetch_all(db)
    .await?;

    rows.iter()
        .map(|row| {
            let post_id: Uuid = row.try_get("post_id")?;
            let attachments = attachment_rows
                .iter()
                .filter(|a| a.try_get::<Uuid, _>("post_id").ok() == Some(post_id))
                .map(super::files::file_from_row)
                .collect::<Result<Vec<_>, AppError>>()?;
            Ok(DiscussionPost {
                post_id,
                thread_id: row.try_get("thread_id")?,
                seq: row.try_get("seq")?,
                author: row.try_get("author_username")?,
                body: row.try_get("body")?,
                created_at: row.try_get("created_at")?,
                is_solution: row.try_get("is_solution")?,
                attachments,
            })
        })
        .collect()
}

/// Start one. The opening argument is post 1, written in the same transaction
/// as the thread: a thread whose first post failed to write is a title with
/// nothing under it, and there is no screen that can show that sensibly.
pub async fn open_thread(
    db: &PgPool,
    author: &str,
    request: &OpenThreadRequest,
) -> Result<DiscussionThread, AppError> {
    let subject_kind = request.subject_kind.trim().to_ascii_lowercase();
    if !SUBJECT_KINDS.contains(&subject_kind.as_str()) {
        return Err(AppError::Validation(format!(
            "a discussion hangs on a record, and {subject_kind:?} is not one of: {}",
            SUBJECT_KINDS.join(", ")
        )));
    }
    let subject_id = request.subject_id.trim().to_string();
    let title = request.title.trim().to_string();
    let body = request.body.trim().to_string();
    if subject_id.is_empty() {
        return Err(AppError::Validation("name the record this is about".into()));
    }
    if title.is_empty() || body.is_empty() {
        return Err(AppError::Validation(
            "a discussion needs a title and an opening post".into(),
        ));
    }
    super::files::require_files_exist(db, &request.attachments).await?;

    let thread_id = Uuid::new_v4();
    let post_id = Uuid::new_v4();
    let mut tx = db.begin().await?;
    sqlx::query(
        "INSERT INTO discussion_thread
             (thread_id, subject_kind, subject_id, subject_note, title, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(thread_id)
    .bind(&subject_kind)
    .bind(&subject_id)
    .bind(
        request
            .subject_note
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(&title)
    .bind(author)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO discussion_post (post_id, thread_id, seq, author_username, body)
         VALUES ($1, $2, 1, $3, $4)",
    )
    .bind(post_id)
    .bind(thread_id)
    .bind(author)
    .bind(&body)
    .execute(&mut *tx)
    .await?;
    for file_id in &request.attachments {
        sqlx::query(
            "INSERT INTO discussion_post_attachment (post_id, file_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(post_id)
        .bind(file_id)
        .execute(&mut *tx)
        .await?;
    }
    for tag in normalised_tags(&request.tags) {
        sqlx::query(
            "INSERT INTO discussion_thread_tag (thread_id, tag)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(thread_id)
        .bind(&tag)
        .execute(&mut *tx)
        .await?;
    }
    // Empty audience: a discussion is readable by everybody signed in, and
    // that is the difference between this table and a conversation.
    super::chat::record_event(
        &mut tx,
        "discussion.thread",
        None,
        Some(thread_id),
        &[],
        json!({ "thread_id": thread_id, "title": title, "author": author }),
    )
    .await?;
    tx.commit().await?;
    read_thread(db, thread_id, author).await
}

/// Say something in one.
pub async fn reply(
    db: &PgPool,
    thread_id: Uuid,
    author: &str,
    request: &ReplyRequest,
) -> Result<DiscussionPost, AppError> {
    let body = request.body.trim().to_string();
    if body.is_empty() {
        return Err(AppError::Validation("an empty reply says nothing".into()));
    }
    super::files::require_files_exist(db, &request.attachments).await?;

    let mut tx = db.begin().await?;
    // Locked means the argument is over and continues elsewhere. Enforced
    // where the write happens, not only where the button is drawn.
    let status: String =
        sqlx::query_scalar("SELECT status FROM discussion_thread WHERE thread_id = $1 FOR UPDATE")
            .bind(thread_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))?;
    if status == "locked" {
        return Err(AppError::Conflict(
            "this discussion is locked; it was continued somewhere else".into(),
        ));
    }

    let seq: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(seq), 0) + 1 FROM discussion_post WHERE thread_id = $1",
    )
    .bind(thread_id)
    .fetch_one(&mut *tx)
    .await?;
    let post_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO discussion_post (post_id, thread_id, seq, author_username, body)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(post_id)
    .bind(thread_id)
    .bind(seq)
    .bind(author)
    .bind(&body)
    .execute(&mut *tx)
    .await?;
    for file_id in &request.attachments {
        sqlx::query(
            "INSERT INTO discussion_post_attachment (post_id, file_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(post_id)
        .bind(file_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("UPDATE discussion_thread SET last_activity_at = now() WHERE thread_id = $1")
        .bind(thread_id)
        .execute(&mut *tx)
        .await?;
    super::chat::record_event(
        &mut tx,
        "discussion.post",
        None,
        Some(thread_id),
        &[],
        json!({ "thread_id": thread_id, "seq": seq, "author": author }),
    )
    .await?;
    tx.commit().await?;

    Ok(DiscussionPost {
        post_id,
        thread_id,
        seq,
        author: author.to_string(),
        body,
        created_at: Utc::now(),
        is_solution: false,
        attachments: read_post_attachments(db, post_id).await?,
    })
}

async fn read_post_attachments(db: &PgPool, post_id: Uuid) -> Result<Vec<StoredFile>, AppError> {
    sqlx::query(&format!(
        "SELECT {FILE_COLUMNS} FROM discussion_post_attachment a
           JOIN stored_file f ON f.file_id = a.file_id
          WHERE a.post_id = $1 ORDER BY f.uploaded_at"
    ))
    .bind(post_id)
    .fetch_all(db)
    .await?
    .iter()
    .map(super::files::file_from_row)
    .collect()
}

/// Mark the reply that settled it, and say the thread is answered.
///
/// One per thread, guaranteed by a partial unique index, so this clears any
/// previous mark in the same transaction rather than relying on the caller to
/// unmark first.
pub async fn accept_solution(
    db: &PgPool,
    thread_id: Uuid,
    post_id: Uuid,
    username: &str,
) -> Result<DiscussionThread, AppError> {
    let mut tx = db.begin().await?;
    let opener: String = sqlx::query_scalar(
        "SELECT created_by FROM discussion_thread WHERE thread_id = $1 FOR UPDATE",
    )
    .bind(thread_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))?;
    // Whoever asked decides what answered it. Anyone marking anyone's thread
    // resolved is how a forum ends up with questions closed by people who
    // never had the problem.
    if opener != username {
        return Err(AppError::Forbidden(
            "only whoever opened the discussion can say what answered it".into(),
        ));
    }
    sqlx::query(
        "UPDATE discussion_post SET is_solution = false WHERE thread_id = $1 AND is_solution",
    )
    .bind(thread_id)
    .execute(&mut *tx)
    .await?;
    let updated = sqlx::query(
        "UPDATE discussion_post SET is_solution = true
          WHERE thread_id = $1 AND post_id = $2",
    )
    .bind(thread_id)
    .bind(post_id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound(
            "that reply is not in this discussion".into(),
        ));
    }
    sqlx::query("UPDATE discussion_thread SET status = 'resolved' WHERE thread_id = $1")
        .bind(thread_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    read_thread(db, thread_id, username).await
}

/// Open, resolved, or locked — set by whoever opened it.
pub async fn set_status(
    db: &PgPool,
    thread_id: Uuid,
    status: &str,
    username: &str,
) -> Result<DiscussionThread, AppError> {
    let status = status.trim().to_ascii_lowercase();
    if !["open", "resolved", "locked"].contains(&status.as_str()) {
        return Err(AppError::Validation(
            "a discussion is open, resolved, or locked".into(),
        ));
    }
    let opener: Option<String> =
        sqlx::query_scalar("SELECT created_by FROM discussion_thread WHERE thread_id = $1")
            .bind(thread_id)
            .fetch_optional(db)
            .await?;
    let opener = opener.ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))?;
    if opener != username {
        return Err(AppError::Forbidden(
            "only whoever opened the discussion can change its state".into(),
        ));
    }
    sqlx::query("UPDATE discussion_thread SET status = $2 WHERE thread_id = $1")
        .bind(thread_id)
        .bind(&status)
        .execute(db)
        .await?;
    read_thread(db, thread_id, username).await
}

/// Set or clear the caller's own bookmark. Private, and the return value is
/// the caller's state alone — there is no count of bookmarks anywhere.
pub async fn set_bookmark(
    db: &PgPool,
    thread_id: Uuid,
    username: &str,
    marked: bool,
) -> Result<bool, AppError> {
    if marked {
        sqlx::query(
            "INSERT INTO discussion_bookmark (thread_id, username)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(thread_id)
        .bind(username)
        .execute(db)
        .await?;
    } else {
        sqlx::query("DELETE FROM discussion_bookmark WHERE thread_id = $1 AND username = $2")
            .bind(thread_id)
            .bind(username)
            .execute(db)
            .await?;
    }
    Ok(marked)
}

/// Whether these bytes may be fetched through this thread. A discussion is
/// readable by everybody signed in, so the check is that the file actually
/// hangs on a post in THIS thread — which is what stops a file id from one
/// thread being fetched through another's URL.
pub async fn discussion_attachment_is_reachable(
    db: &PgPool,
    thread_id: Uuid,
    file_id: Uuid,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM discussion_post_attachment a
              JOIN discussion_post p ON p.post_id = a.post_id
             WHERE p.thread_id = $1 AND a.file_id = $2)",
    )
    .bind(thread_id)
    .bind(file_id)
    .fetch_one(db)
    .await?)
}

/// How many open threads hang on each kind of record — the left-hand axis.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SubjectCount {
    pub subject_kind: String,
    pub threads: i64,
}

pub async fn subject_counts(db: &PgPool) -> Result<Vec<SubjectCount>, AppError> {
    let rows = sqlx::query(
        "SELECT subject_kind, count(*) AS threads
           FROM discussion_thread GROUP BY subject_kind ORDER BY subject_kind",
    )
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(SubjectCount {
                subject_kind: row.try_get("subject_kind")?,
                threads: row.try_get("threads")?,
            })
        })
        .collect()
}

/// Tags, lower-cased and space-free, so `#Lead Time` and `#lead-time` are one
/// tag rather than two that look alike in a sidebar.
fn normalised_tags(raw: &[String]) -> Vec<String> {
    let mut tags: Vec<String> = raw
        .iter()
        .map(|tag| {
            tag.trim()
                .trim_start_matches('#')
                .to_ascii_lowercase()
                .replace(' ', "-")
        })
        .filter(|tag| !tag.is_empty() && tag.len() <= 40)
        .collect();
    tags.sort();
    tags.dedup();
    tags.truncate(8);
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_that_look_alike_are_one_tag() {
        let tags = normalised_tags(&[
            "#Lead Time".into(),
            "lead-time".into(),
            "  ".into(),
            "Harga".into(),
        ]);
        assert_eq!(tags, vec!["harga".to_string(), "lead-time".to_string()]);
    }

    /// The list is the design. A tenth kind is how this becomes a forum with
    /// categories, which is the one thing it must not become.
    #[test]
    fn there_are_nine_subjects_and_none_of_them_is_general() {
        assert_eq!(SUBJECT_KINDS.len(), 9);
        assert!(!SUBJECT_KINDS.contains(&"general"));
    }
}
