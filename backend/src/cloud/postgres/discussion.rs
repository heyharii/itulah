//! Discussions: threads that hang off a record, not off a category.
//!
//! `subject_kind` is a record kind and nothing else — there is no "General"
//! and no category table, because a thread that is not about a record is a
//! conversation and conversations have their own screen. That single
//! constraint is what makes the left-hand axis of the forum useful instead of
//! decorative: it is a list of work, and each row names the record being
//! argued about.
//!
//! The nine words this module used to hold are now fifty-seven, and they are
//! not this module's to hold: they live in [`crate::cloud::domain::RecordKind`]
//! and in `record_kind`, which the log, filed documents and notifications read
//! from too. Widening the list was never the risk 0040 was guarding against —
//! a supplier bill and a payroll run are records somebody may argue about, and
//! always were. What it guards is that the subject is a RECORD.
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
//!
//! # What 0490 added, and the forum it was taken from
//!
//! The owner's reference is discuss.frappe.io, which is Discourse. The parts of
//! Discourse that make a forum usable in its second week are here now, each in
//! the shape this schema already had:
//!
//! * **Reading position.** `last_read_seq` per person, so the board can say
//!   which threads moved since you looked and the thread can draw "new since
//!   your last visit" above the right post. A position, like chat's.
//! * **Correcting and withdrawing.** An author may edit their own post; every
//!   earlier wording is kept as a revision. A post is withdrawn rather than
//!   deleted, because its `seq` is what other posts quote.
//! * **Replying to one post.** `reply_to_seq`, drawn as a quote above the reply.
//! * **Reactions.** A closed set of six, so a "+1" does not have to be a reply.
//! * **Naming people.** `@username` tells that person, once, even if they have
//!   never opened the thread.
//! * **Following.** Watching tells you about every reply; muting tells you
//!   nothing. The default is Discourse's "tracking": the thread's opener and
//!   everybody who has written in it.
//! * **Pinning** and **moderation**: head office (ADMIN) may pin a thread,
//!   change any thread's state, and withdraw any post. Everything else stays
//!   with whoever opened or wrote it.

use super::files::{StoredFile, FILE_COLUMNS};
use crate::cloud::application::AppError;
use crate::cloud::domain::RecordKind;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// The reactions a post can carry, in the order a screen draws them.
///
/// Closed on purpose, and matched by the CHECK in 0490: an open emoji picker on
/// a business record is where jokes accumulate, and six is enough to say "yes",
/// "thanks", "done" and "looking at it" without writing a reply.
pub const DISCUSSION_REACTIONS: [&str; 6] =
    ["thumbs_up", "heart", "tada", "laugh", "eyes", "check"];

/// Record kinds a thread may NOT hang on. These are the collaboration surfaces
/// themselves: a discussion about a discussion is a reply, and a conversation
/// or a notification is not a record anybody argues about.
const NOT_A_SUBJECT: [&str; 4] = [
    "discussion",
    "conversation",
    "assistant_conversation",
    "notification",
];

const TITLE_ROOM: usize = 200;
const NOTE_ROOM: usize = 200;
const BODY_ROOM: usize = 20_000;
const ATTACHMENT_ROOM: usize = 10;
const MENTION_ROOM: usize = 20;
const DEFAULT_PAGE: i64 = 50;
const LARGEST_PAGE: i64 = 200;

const FEEDS: [&str; 5] = ["bookmarked", "mine", "watching", "new", "unread"];
const ORDERS: [&str; 4] = ["activity", "replies", "views", "created"];

/// Who is asking, and whether they may act for head office.
///
/// `moderator` is decided by the HTTP layer from the session's role; nothing
/// in here reads a role, so the rule "ADMIN moderates" lives in one place.
#[derive(Clone, Copy, Debug)]
pub struct DiscussionReader<'a> {
    pub username: &'a str,
    pub moderator: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DiscussionThread {
    pub thread_id: Uuid,
    /// A record kind. What the thread is about, structurally.
    pub subject_kind: String,
    /// What to call that kind on screen — `Purchase order`, `Fixed asset`.
    /// Sent rather than mirrored, so a kind added next month is named on the
    /// board the day it exists.
    pub subject_label: String,
    /// The record's own identifier, as a person reads it: `PO-2607-0108`.
    pub subject_id: String,
    pub subject_note: Option<String>,
    pub title: String,
    /// `open`, `resolved`, or `locked`.
    pub status: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub last_activity_at: DateTime<Utc>,
    /// When the title, note or tags were last changed after opening.
    pub edited_at: Option<DateTime<Utc>>,
    /// Set when head office pinned it above the rest of the board.
    pub pinned_at: Option<DateTime<Utc>>,
    pub pinned_by: Option<String>,
    /// Replies still standing — withdrawn ones are not counted.
    pub reply_count: i64,
    /// Distinct people who have opened it. Not page loads.
    pub people: i64,
    pub tags: Vec<String>,
    /// Private to the caller. Nobody sees anyone else's.
    pub bookmarked_by_me: bool,
    /// Everyone who has posted, opener first, for the row of faces.
    pub voices: Vec<String>,
    pub latest_post_preview: Option<String>,
    /// Who wrote the newest post still standing.
    pub last_poster: Option<String>,
    /// Whether one of the replies has been marked as the answer.
    pub has_solution: bool,
    /// The newest post's position, withdrawn or not.
    pub last_seq: i64,
    /// How far the caller had read when this was fetched. `0` if never.
    pub last_read_seq: i64,
    /// Whether the caller has ever opened it.
    pub seen_by_me: bool,
    /// Posts by other people after the caller's reading position.
    pub unread_count: i64,
    /// The caller's own level: `watching`, `normal` or `muted`.
    pub subscription: String,
    /// Whether the caller may retitle it, change its state and mark the answer:
    /// whoever opened it, and head office.
    pub can_manage: bool,
    /// Whether the caller may pin it: head office only.
    pub can_pin: bool,
}

/// The post a reply answers, as much of it as the reply needs to draw.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostReference {
    pub seq: i64,
    pub author: String,
    /// The first line of it. Empty when it has been withdrawn.
    pub excerpt: String,
    pub withdrawn: bool,
}

/// One kind of reaction on one post.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostReaction {
    /// One of [`DISCUSSION_REACTIONS`].
    pub reaction: String,
    pub count: i64,
    /// Whether the caller is one of them.
    pub mine: bool,
    /// Who, in the order they reacted. A reaction is a public act on a public
    /// thread, unlike a bookmark.
    pub people: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DiscussionPost {
    pub post_id: Uuid,
    pub thread_id: Uuid,
    pub seq: i64,
    pub author: String,
    /// The author's display name, or their username when they have none.
    pub author_name: String,
    /// Empty when the post has been withdrawn.
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub is_solution: bool,
    pub edited_at: Option<DateTime<Utc>>,
    /// How many earlier wordings are kept.
    pub revisions: i64,
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub withdrawn_by: Option<String>,
    pub reply_to: Option<PostReference>,
    pub reactions: Vec<PostReaction>,
    pub attachments: Vec<StoredFile>,
    /// Whether the caller may correct it: its author, while the thread is not
    /// locked.
    pub can_edit: bool,
    /// Whether the caller may withdraw it: its author while the thread is not
    /// locked, or head office. Never the opening post, which is the thread.
    pub can_withdraw: bool,
}

/// One earlier wording of a post.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PostRevision {
    /// Revision N is the body as it stood before the Nth edit.
    pub revision: i32,
    pub body: String,
    /// Who made the edit that replaced it.
    pub replaced_by: String,
    pub replaced_at: DateTime<Utc>,
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
    /// The earlier post this one answers.
    #[serde(default)]
    pub reply_to_seq: Option<i64>,
    /// Minted by the browser before its first attempt, so a resend after a
    /// dropped connection lands once.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// A thread's title, note and tags, all three stated — what the thread should
/// say afterwards, not a patch of what changed.
///
/// The record is the one exception: absent means "the same record", present
/// means the thread moves. A thread opened on the wrong order is a thread
/// nobody looking at the right order will ever find, and the only fix used to
/// be opening it again and losing the replies.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EditThreadRequest {
    pub title: String,
    pub subject_note: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// The record kind to move it to, with `subject_id`. Both or neither.
    #[serde(default)]
    pub subject_kind: Option<String>,
    #[serde(default)]
    pub subject_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct EditPostRequest {
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ReactToPostRequest {
    /// One of [`DISCUSSION_REACTIONS`].
    pub reaction: String,
    /// `true` puts it on, `false` takes it off. Stated rather than toggled, so
    /// a double click or a retried request lands where the person meant.
    pub on: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ThreadQuery {
    /// A record kind, or absent for all of them.
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    pub tag: Option<String>,
    pub status: Option<String>,
    /// `bookmarked`, `mine`, `watching`, `new` or `unread`, applied against
    /// the caller. Absent means every thread, which is the honest default: a
    /// discussion is readable by everyone signed in.
    pub feed: Option<String>,
    /// Matches the title, the record, the note, the tags and every post still
    /// standing.
    pub q: Option<String>,
    /// `activity` (the default), `replies`, `views` or `created`.
    pub order: Option<String>,
    /// At most 200; 50 when absent.
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// How many threads hang on each kind of record — the left-hand axis.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SubjectCount {
    pub subject_kind: String,
    pub label: String,
    pub threads: i64,
}

/// A tag in use, and on how many threads.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TagCount {
    pub tag: String,
    pub threads: i64,
}

/// A kind of record a thread may be opened on, and its name.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SubjectKindOption {
    pub kind: String,
    pub label: String,
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// Every thread column, for the caller in `$1` whose moderator flag is `$2`.
///
/// The caller's reading position comes in through a join rather than a
/// subquery per column, because four columns read it.
const THREAD_SELECT: &str = "SELECT t.thread_id, t.subject_kind, t.subject_id, t.subject_note,
            t.title, t.status, t.created_by, t.created_at, t.last_activity_at,
            t.edited_at, t.pinned_at, t.pinned_by,
            (SELECT count(*) FROM discussion_post p
              WHERE p.thread_id = t.thread_id AND p.seq > 1
                AND p.withdrawn_at IS NULL) AS reply_count,
            (SELECT count(*) FROM discussion_thread_view v
              WHERE v.thread_id = t.thread_id) AS people,
            ARRAY(SELECT g.tag FROM discussion_thread_tag g
                   WHERE g.thread_id = t.thread_id ORDER BY g.tag) AS tags,
            EXISTS (SELECT 1 FROM discussion_bookmark b
                     WHERE b.thread_id = t.thread_id AND b.username = $1)
              AS bookmarked_by_me,
            ARRAY(SELECT p.author_username FROM discussion_post p
                   WHERE p.thread_id = t.thread_id
                   GROUP BY p.author_username ORDER BY min(p.seq)) AS voices,
            left(latest.body, 280) AS latest_post_preview,
            latest.author_username AS last_poster,
            EXISTS (SELECT 1 FROM discussion_post p
                     WHERE p.thread_id = t.thread_id AND p.is_solution)
              AS has_solution,
            (SELECT COALESCE(max(p.seq), 0) FROM discussion_post p
              WHERE p.thread_id = t.thread_id) AS last_seq,
            COALESCE(mine.last_read_seq, 0) AS last_read_seq,
            (mine.thread_id IS NOT NULL) AS seen_by_me,
            (SELECT count(*) FROM discussion_post p
              WHERE p.thread_id = t.thread_id
                AND p.seq > COALESCE(mine.last_read_seq, 0)
                AND p.author_username <> $1
                AND p.withdrawn_at IS NULL) AS unread_count,
            COALESCE((SELECT s.level FROM discussion_subscription s
                       WHERE s.thread_id = t.thread_id AND s.username = $1),
                     'normal') AS subscription,
            (t.created_by = $1 OR $2::boolean) AS can_manage,
            $2::boolean AS can_pin
       FROM discussion_thread t
       LEFT JOIN discussion_thread_view mine
              ON mine.thread_id = t.thread_id AND mine.username = $1
       LEFT JOIN LATERAL (
             SELECT p.body, p.author_username FROM discussion_post p
              WHERE p.thread_id = t.thread_id AND p.withdrawn_at IS NULL
              ORDER BY p.seq DESC LIMIT 1
       ) latest ON true";

fn subject_label(kind: &str) -> String {
    RecordKind::parse(kind)
        .map(|kind| kind.label().to_owned())
        .unwrap_or_else(|| kind.to_owned())
}

fn thread_from_row(row: &PgRow) -> Result<DiscussionThread, AppError> {
    let subject_kind: String = row.try_get("subject_kind")?;
    Ok(DiscussionThread {
        thread_id: row.try_get("thread_id")?,
        subject_label: subject_label(&subject_kind),
        subject_kind,
        subject_id: row.try_get("subject_id")?,
        subject_note: row.try_get("subject_note")?,
        title: row.try_get("title")?,
        status: row.try_get("status")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        last_activity_at: row.try_get("last_activity_at")?,
        edited_at: row.try_get("edited_at")?,
        pinned_at: row.try_get("pinned_at")?,
        pinned_by: row.try_get("pinned_by")?,
        reply_count: row.try_get("reply_count")?,
        people: row.try_get("people")?,
        tags: row.try_get("tags")?,
        bookmarked_by_me: row.try_get("bookmarked_by_me")?,
        voices: row.try_get("voices")?,
        latest_post_preview: row.try_get("latest_post_preview")?,
        last_poster: row.try_get("last_poster")?,
        has_solution: row.try_get("has_solution")?,
        last_seq: row.try_get("last_seq")?,
        last_read_seq: row.try_get("last_read_seq")?,
        seen_by_me: row.try_get("seen_by_me")?,
        unread_count: row.try_get("unread_count")?,
        subscription: row.try_get("subscription")?,
        can_manage: row.try_get("can_manage")?,
        can_pin: row.try_get("can_pin")?,
    })
}

/// A request field with its whitespace trimmed, or nothing if nothing is left.
fn present(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// `needle` as an ILIKE pattern that matches it anywhere, with the three
/// characters LIKE treats specially taken literally — somebody searching for
/// `50%` means the characters, not "starts with 50".
fn like_pattern(needle: &str) -> String {
    let mut pattern = String::with_capacity(needle.len() + 2);
    pattern.push('%');
    for ch in needle.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            pattern.push('\\');
        }
        pattern.push(ch);
    }
    pattern.push('%');
    pattern
}

/// A page of the board.
///
/// Pinned threads float to the top of the plain board — every thread, newest
/// activity first — and nowhere else: a pin says "everybody should see this",
/// which is a statement about the front page, not about "unread" or a search.
pub async fn list_threads(
    db: &PgPool,
    reader: DiscussionReader<'_>,
    query: &ThreadQuery,
) -> Result<Vec<DiscussionThread>, AppError> {
    let feed = present(query.feed.as_deref());
    if let Some(feed) = feed {
        if !FEEDS.contains(&feed) {
            return Err(AppError::Validation(format!(
                "a feed is one of: {}",
                FEEDS.join(", ")
            )));
        }
    }
    let order = present(query.order.as_deref()).unwrap_or("activity");
    if !ORDERS.contains(&order) {
        return Err(AppError::Validation(format!(
            "the board is ordered by one of: {}",
            ORDERS.join(", ")
        )));
    }
    let limit = query.limit.unwrap_or(DEFAULT_PAGE).clamp(1, LARGEST_PAGE);
    let offset = query.offset.unwrap_or(0).max(0);

    // Every filter is a bound parameter compared against NULL-or-match, so
    // there is one prepared statement rather than a SQL string built from
    // request fields.
    let rows = sqlx::query(&format!(
        "SELECT * FROM ({THREAD_SELECT}
          WHERE ($3::text IS NULL OR t.subject_kind = $3)
            AND ($4::text IS NULL OR t.subject_id = $4)
            AND ($5::text IS NULL OR EXISTS (
                    SELECT 1 FROM discussion_thread_tag g
                     WHERE g.thread_id = t.thread_id AND g.tag = $5))
            AND ($6::text IS NULL OR t.status = $6)
            AND ($7::text IS NULL
                 OR t.title ILIKE $7
                 OR t.subject_id ILIKE $7
                 OR t.subject_note ILIKE $7
                 OR EXISTS (SELECT 1 FROM discussion_thread_tag g
                             WHERE g.thread_id = t.thread_id AND g.tag ILIKE $7)
                 OR EXISTS (SELECT 1 FROM discussion_post p
                             WHERE p.thread_id = t.thread_id
                               AND p.withdrawn_at IS NULL
                               AND p.body ILIKE $7))
            AND ($8::text IS DISTINCT FROM 'bookmarked' OR EXISTS (
                    SELECT 1 FROM discussion_bookmark b
                     WHERE b.thread_id = t.thread_id AND b.username = $1))
            AND ($8::text IS DISTINCT FROM 'mine' OR t.created_by = $1 OR EXISTS (
                    SELECT 1 FROM discussion_post p
                     WHERE p.thread_id = t.thread_id AND p.author_username = $1))
            AND ($8::text IS DISTINCT FROM 'watching' OR EXISTS (
                    SELECT 1 FROM discussion_subscription s
                     WHERE s.thread_id = t.thread_id AND s.username = $1
                       AND s.level = 'watching'))
            AND ($8::text IS DISTINCT FROM 'new'
                 OR (mine.thread_id IS NULL AND t.created_by <> $1))
            AND ($8::text IS DISTINCT FROM 'unread'
                 OR (mine.thread_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM discussion_post p
                         WHERE p.thread_id = t.thread_id
                           AND p.seq > mine.last_read_seq
                           AND p.author_username <> $1
                           AND p.withdrawn_at IS NULL)))
          ) board
          ORDER BY CASE WHEN $8::text IS NULL AND $9::text = 'activity'
                        THEN board.pinned_at END DESC NULLS LAST,
                   CASE WHEN $9::text = 'replies' THEN board.reply_count END DESC NULLS LAST,
                   CASE WHEN $9::text = 'views' THEN board.people END DESC NULLS LAST,
                   CASE WHEN $9::text = 'created' THEN board.created_at END DESC NULLS LAST,
                   board.last_activity_at DESC,
                   board.thread_id
          LIMIT $10 OFFSET $11"
    ))
    .bind(reader.username)
    .bind(reader.moderator)
    .bind(present(query.subject_kind.as_deref()))
    .bind(present(query.subject_id.as_deref()))
    .bind(present(query.tag.as_deref()).map(|tag| tag.trim_start_matches('#').to_lowercase()))
    .bind(present(query.status.as_deref()))
    .bind(present(query.q.as_deref()).map(like_pattern))
    .bind(feed)
    .bind(order)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await?;
    rows.iter().map(thread_from_row).collect()
}

/// One thread as the caller sees it, without recording that they looked.
async fn load_thread(
    db: &PgPool,
    thread_id: Uuid,
    reader: DiscussionReader<'_>,
) -> Result<DiscussionThread, AppError> {
    let row = sqlx::query(&format!("{THREAD_SELECT} WHERE t.thread_id = $3"))
        .bind(reader.username)
        .bind(reader.moderator)
        .bind(thread_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))?;
    thread_from_row(&row)
}

/// One thread, opened. This is the only thing that writes to
/// `discussion_thread_view` — one row per person, so the number stays "people"
/// and never drifts into "visits".
///
/// Opening a thread is reading it to the end, and the reading position moves
/// there. What comes BACK is where the caller stood before this visit, which
/// is what the page needs to draw "new since your last visit" above the right
/// post; the position it moved to is where the next visit will start.
///
/// The existence check comes first. The view row has a foreign key to the
/// thread, and a thread id that names nothing used to reach the insert and
/// come back as a 500 instead of a 404.
pub async fn read_thread(
    db: &PgPool,
    thread_id: Uuid,
    reader: DiscussionReader<'_>,
) -> Result<DiscussionThread, AppError> {
    let mut thread = load_thread(db, thread_id, reader).await?;
    sqlx::query(
        "INSERT INTO discussion_thread_view (thread_id, username, last_read_seq)
         VALUES ($1, $2, $3)
         ON CONFLICT (thread_id, username) DO UPDATE
            SET last_seen_at = now(),
                last_read_seq = GREATEST(discussion_thread_view.last_read_seq,
                                         EXCLUDED.last_read_seq)",
    )
    .bind(thread_id)
    .bind(reader.username)
    .bind(thread.last_seq)
    .execute(db)
    .await?;
    if !thread.seen_by_me {
        thread.people += 1;
    }
    Ok(thread)
}

/// How many threads a "dismiss" caught up on.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DismissedUnread {
    pub threads: i64,
}

/// Everything the caller has opened, marked read to its end — Discourse's
/// "Dismiss" on the Unread list, for the morning after a busy day.
///
/// Only threads they have opened before. Marking a never-opened thread read
/// would write a view row for it, and a view row is what `people` counts: the
/// number beside a thread would then include somebody who never looked. So
/// New stays New until it is opened. `last_seen_at` is not touched either —
/// this is not a visit.
pub async fn dismiss_unread(db: &PgPool, username: &str) -> Result<DismissedUnread, AppError> {
    let caught_up = sqlx::query(
        "UPDATE discussion_thread_view v
            SET last_read_seq = latest.seq
           FROM (SELECT thread_id, max(seq) AS seq
                   FROM discussion_post GROUP BY thread_id) latest
          WHERE v.username = $1
            AND latest.thread_id = v.thread_id
            AND v.last_read_seq < latest.seq",
    )
    .bind(username)
    .execute(db)
    .await?
    .rows_affected();
    Ok(DismissedUnread {
        threads: caught_up as i64,
    })
}

/// The thread's state and title, or a 404. Outside a transaction, for reads.
async fn thread_status(db: &PgPool, thread_id: Uuid) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT status FROM discussion_thread WHERE thread_id = $1")
        .bind(thread_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))
}

/// What a write needs to know about the thread it writes to, taken under a
/// row lock so two writes to one thread happen one after the other.
struct LockedThread {
    status: String,
    title: String,
    created_by: String,
    subject_note: Option<String>,
}

async fn lock_thread(
    tx: &mut Transaction<'_, Postgres>,
    thread_id: Uuid,
) -> Result<LockedThread, AppError> {
    let row = sqlx::query(
        "SELECT status, title, created_by, subject_note FROM discussion_thread
          WHERE thread_id = $1 FOR UPDATE",
    )
    .bind(thread_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no discussion {thread_id}")))?;
    Ok(LockedThread {
        status: row.try_get("status")?,
        title: row.try_get("title")?,
        created_by: row.try_get("created_by")?,
        subject_note: row.try_get("subject_note")?,
    })
}

fn locked_refusal() -> AppError {
    AppError::Conflict("this discussion is locked; it was continued somewhere else".into())
}

const POST_SELECT: &str = "SELECT p.post_id, p.thread_id, p.seq, p.author_username,
            COALESCE(NULLIF(btrim(u.display_name), ''), p.author_username) AS author_name,
            p.body, p.created_at, p.is_solution, p.edited_at,
            p.withdrawn_at, p.withdrawn_by, p.reply_to_seq,
            (SELECT count(*) FROM discussion_post_revision r
              WHERE r.post_id = p.post_id) AS revisions,
            q.author_username AS reply_to_author,
            q.body AS reply_to_body,
            (q.withdrawn_at IS NOT NULL) AS reply_to_withdrawn
       FROM discussion_post p
       LEFT JOIN app_user u ON u.username = p.author_username
       LEFT JOIN discussion_post q
              ON q.thread_id = p.thread_id AND q.seq = p.reply_to_seq";

/// The reactions on these posts, grouped, in the order a screen draws them.
async fn reactions_for(
    db: &PgPool,
    post_ids: &[Uuid],
    me: &str,
) -> Result<Vec<(Uuid, PostReaction)>, AppError> {
    if post_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(
        "SELECT post_id, reaction,
                array_agg(username ORDER BY reacted_at, username) AS people
           FROM discussion_post_reaction
          WHERE post_id = ANY($1)
          GROUP BY post_id, reaction",
    )
    .bind(post_ids)
    .fetch_all(db)
    .await?;
    let mut reactions = rows
        .iter()
        .map(|row| {
            let people: Vec<String> = row.try_get("people")?;
            Ok((
                row.try_get::<Uuid, _>("post_id")?,
                PostReaction {
                    reaction: row.try_get("reaction")?,
                    count: people.len() as i64,
                    mine: people.iter().any(|person| person == me),
                    people,
                },
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    reactions.sort_by_key(|(_, reaction)| {
        DISCUSSION_REACTIONS
            .iter()
            .position(|known| *known == reaction.reaction)
            .unwrap_or(usize::MAX)
    });
    Ok(reactions)
}

/// Posts from their rows, with their files and reactions, and what the caller
/// may do to each.
async fn assemble_posts(
    db: &PgPool,
    rows: &[PgRow],
    reader: DiscussionReader<'_>,
    locked: bool,
) -> Result<Vec<DiscussionPost>, AppError> {
    let post_ids = rows
        .iter()
        .map(|row| row.try_get::<Uuid, _>("post_id"))
        .collect::<Result<Vec<_>, _>>()?;
    let attachment_rows = sqlx::query(&format!(
        "SELECT a.post_id, {FILE_COLUMNS}
           FROM discussion_post_attachment a
           JOIN stored_file f ON f.file_id = a.file_id
          WHERE a.post_id = ANY($1) ORDER BY f.uploaded_at"
    ))
    .bind(&post_ids)
    .fetch_all(db)
    .await?;
    let reactions = reactions_for(db, &post_ids, reader.username).await?;

    rows.iter()
        .map(|row| {
            let post_id: Uuid = row.try_get("post_id")?;
            let seq: i64 = row.try_get("seq")?;
            let author: String = row.try_get("author_username")?;
            let withdrawn_at: Option<DateTime<Utc>> = row.try_get("withdrawn_at")?;
            let withdrawn = withdrawn_at.is_some();

            let reply_to = match row.try_get::<Option<i64>, _>("reply_to_seq")? {
                Some(quoted) => {
                    let quoted_author: Option<String> = row.try_get("reply_to_author")?;
                    let quoted_body: Option<String> = row.try_get("reply_to_body")?;
                    let gone: bool = row.try_get("reply_to_withdrawn")?;
                    quoted_author.map(|quoted_author| PostReference {
                        seq: quoted,
                        author: quoted_author,
                        excerpt: if gone {
                            String::new()
                        } else {
                            snippet(quoted_body.as_deref().unwrap_or(""))
                        },
                        withdrawn: gone,
                    })
                }
                None => None,
            };

            // A withdrawn post keeps its place and its author and loses
            // everything else: the words, the files, and what people thought
            // of them.
            let attachments = if withdrawn {
                Vec::new()
            } else {
                attachment_rows
                    .iter()
                    .filter(|a| a.try_get::<Uuid, _>("post_id").ok() == Some(post_id))
                    .map(super::files::file_from_row)
                    .collect::<Result<Vec<_>, AppError>>()?
            };
            let post_reactions = if withdrawn {
                Vec::new()
            } else {
                reactions
                    .iter()
                    .filter(|(id, _)| *id == post_id)
                    .map(|(_, reaction)| reaction.clone())
                    .collect()
            };
            let mine = author == reader.username;

            Ok(DiscussionPost {
                post_id,
                thread_id: row.try_get("thread_id")?,
                seq,
                author_name: row.try_get("author_name")?,
                body: if withdrawn {
                    String::new()
                } else {
                    row.try_get("body")?
                },
                created_at: row.try_get("created_at")?,
                is_solution: row.try_get("is_solution")?,
                edited_at: row.try_get("edited_at")?,
                revisions: row.try_get("revisions")?,
                withdrawn_at,
                withdrawn_by: row.try_get("withdrawn_by")?,
                reply_to,
                reactions: post_reactions,
                attachments,
                can_edit: mine && !withdrawn && !locked,
                can_withdraw: seq > 1 && !withdrawn && ((mine && !locked) || reader.moderator),
                author,
            })
        })
        .collect()
}

/// The posts, oldest first — a discussion is read from the top, unlike a
/// conversation.
pub async fn read_posts(
    db: &PgPool,
    thread_id: Uuid,
    reader: DiscussionReader<'_>,
) -> Result<Vec<DiscussionPost>, AppError> {
    // A thread that does not exist is a 404, not an empty list: an empty list
    // says "there is a thread and nobody has written in it", which the server
    // makes impossible by writing the opening post with the thread.
    let status = thread_status(db, thread_id).await?;
    let rows = sqlx::query(&format!(
        "{POST_SELECT} WHERE p.thread_id = $1 ORDER BY p.seq"
    ))
    .bind(thread_id)
    .fetch_all(db)
    .await?;
    assemble_posts(db, &rows, reader, status == "locked").await
}

/// One post, read back after it was written, so what the writer is handed is
/// what the next reader will see — the database's clock, not this process's.
async fn load_post(
    db: &PgPool,
    post_id: Uuid,
    reader: DiscussionReader<'_>,
) -> Result<DiscussionPost, AppError> {
    let row = sqlx::query(&format!("{POST_SELECT} WHERE p.post_id = $1"))
        .bind(post_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("no such post".into()))?;
    let thread_id: Uuid = row.try_get("thread_id")?;
    let status = thread_status(db, thread_id).await?;
    assemble_posts(db, std::slice::from_ref(&row), reader, status == "locked")
        .await?
        .pop()
        .ok_or_else(|| AppError::NotFound("no such post".into()))
}

/// Every earlier wording of a post, oldest first.
pub async fn post_revisions(
    db: &PgPool,
    thread_id: Uuid,
    post_id: Uuid,
) -> Result<Vec<PostRevision>, AppError> {
    let withdrawn: Option<bool> = sqlx::query_scalar(
        "SELECT withdrawn_at IS NOT NULL FROM discussion_post
          WHERE post_id = $1 AND thread_id = $2",
    )
    .bind(post_id)
    .bind(thread_id)
    .fetch_optional(db)
    .await?;
    match withdrawn {
        None => {
            return Err(AppError::NotFound(
                "that post is not in this discussion".into(),
            ))
        }
        // Withdrawing a post takes its words out of the thread, and its
        // history is its words.
        Some(true) => return Err(AppError::NotFound("that post was withdrawn".into())),
        Some(false) => {}
    }
    let rows = sqlx::query(
        "SELECT revision, body, replaced_by, replaced_at FROM discussion_post_revision
          WHERE post_id = $1 ORDER BY revision",
    )
    .bind(post_id)
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(PostRevision {
                revision: row.try_get("revision")?,
                body: row.try_get("body")?,
                replaced_by: row.try_get("replaced_by")?,
                replaced_at: row.try_get("replaced_at")?,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// A post body, trimmed and measured.
fn clean_body(raw: &str, empty: &str) -> Result<String, AppError> {
    let body = raw.trim().to_string();
    if body.is_empty() {
        return Err(AppError::Validation(empty.into()));
    }
    if body.chars().count() > BODY_ROOM {
        return Err(AppError::Validation(format!(
            "a post holds at most {BODY_ROOM} characters; split it, or attach the rest as a file"
        )));
    }
    Ok(body)
}

/// The record a thread hangs on, checked: a kind that is a record and not a
/// collaboration surface, and an identifier somebody could have typed.
///
/// Refused here rather than by the foreign key, so somebody who typed a word
/// that is not a record is told what the words are instead of reading a
/// constraint name.
fn clean_subject(kind: &str, id: &str) -> Result<(RecordKind, String), AppError> {
    let kind = kind.trim().to_ascii_lowercase();
    let Some(parsed) =
        RecordKind::parse(&kind).filter(|parsed| !NOT_A_SUBJECT.contains(&parsed.as_str()))
    else {
        return Err(AppError::Validation(format!(
            "a discussion hangs on a record, and {kind:?} is not one of: {}",
            subject_kinds()
                .iter()
                .map(|option| option.kind.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    };
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err(AppError::Validation("name the record this is about".into()));
    }
    if id.chars().count() > 120 {
        return Err(AppError::Validation(
            "that is too long to be a record's identifier".into(),
        ));
    }
    Ok((parsed, id))
}

fn clean_title(raw: &str) -> Result<String, AppError> {
    let title = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(AppError::Validation("a discussion needs a title".into()));
    }
    if title.chars().count() > TITLE_ROOM {
        return Err(AppError::Validation(format!(
            "a title is at most {TITLE_ROOM} characters — it has to read in a list"
        )));
    }
    Ok(title)
}

fn clean_note(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let note = present(raw).map(str::to_owned);
    if note
        .as_deref()
        .is_some_and(|note| note.chars().count() > NOTE_ROOM)
    {
        return Err(AppError::Validation(format!(
            "the note is at most {NOTE_ROOM} characters"
        )));
    }
    Ok(note)
}

/// The files a post names, each once, each uploaded by whoever is posting.
///
/// Existence alone was the old check, and it let a file id from somebody
/// else's private conversation be attached to a discussion — which everybody
/// signed in can read — and so be read by everybody. A file joins a post only
/// in the hands of the person who uploaded it.
async fn require_own_files(
    db: &PgPool,
    author: &str,
    file_ids: &[Uuid],
) -> Result<Vec<Uuid>, AppError> {
    let mut ids = file_ids.to_vec();
    ids.sort();
    ids.dedup();
    if ids.len() > ATTACHMENT_ROOM {
        return Err(AppError::Validation(format!(
            "a post carries at most {ATTACHMENT_ROOM} files"
        )));
    }
    if ids.is_empty() {
        return Ok(ids);
    }
    let found: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM stored_file WHERE file_id = ANY($1) AND uploaded_by = $2",
    )
    .bind(&ids)
    .bind(author)
    .fetch_one(db)
    .await?;
    if found != ids.len() as i64 {
        return Err(AppError::Validation(
            "one of the attachments has not been uploaded, or was uploaded by somebody else".into(),
        ));
    }
    Ok(ids)
}

async fn attach_files(
    tx: &mut Transaction<'_, Postgres>,
    post_id: Uuid,
    file_ids: &[Uuid],
) -> Result<(), AppError> {
    for file_id in file_ids {
        sqlx::query(
            "INSERT INTO discussion_post_attachment (post_id, file_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(post_id)
        .bind(file_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn write_tags(
    tx: &mut Transaction<'_, Postgres>,
    thread_id: Uuid,
    tags: &[String],
) -> Result<(), AppError> {
    for tag in normalised_tags(tags) {
        sqlx::query(
            "INSERT INTO discussion_thread_tag (thread_id, tag)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(thread_id)
        .bind(&tag)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Tell every open board that this thread changed. Empty audience: a
/// discussion is readable by everybody signed in, and that is the difference
/// between this table and a conversation.
async fn announce(
    tx: &mut Transaction<'_, Postgres>,
    kind: &str,
    thread_id: Uuid,
    payload: serde_json::Value,
) -> Result<(), AppError> {
    super::chat::record_event(tx, kind, None, Some(thread_id), &[], payload).await?;
    Ok(())
}

/// Start one. The opening argument is post 1, written in the same transaction
/// as the thread: a thread whose first post failed to write is a title with
/// nothing under it, and there is no screen that can show that sensibly.
pub async fn open_thread(
    db: &PgPool,
    reader: DiscussionReader<'_>,
    request: &OpenThreadRequest,
) -> Result<DiscussionThread, AppError> {
    let author = reader.username;
    let (kind, subject_id) = clean_subject(&request.subject_kind, &request.subject_id)?;
    let subject_kind = kind.as_str().to_owned();
    let title = clean_title(&request.title)?;
    let body = clean_body(&request.body, "a discussion needs an opening post")?;
    let note = clean_note(request.subject_note.as_deref())?;
    let attachments = require_own_files(db, author, &request.attachments).await?;

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
    .bind(&note)
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
    attach_files(&mut tx, post_id, &attachments).await?;
    write_tags(&mut tx, thread_id, &request.tags).await?;
    announce(
        &mut tx,
        "discussion.thread",
        thread_id,
        json!({ "thread_id": thread_id, "title": title, "author": author }),
    )
    .await?;

    // Anybody named in the opening post is told by name, and is then not
    // told a second time below as "head office".
    let named = tell_the_named(
        &mut tx,
        thread_id,
        &title,
        author,
        &body,
        mentioned_names(&body),
    )
    .await?;

    // Somebody at head office is told a thread was opened.
    //
    // Added when discussions became the channel a SHOP reports a fault on —
    // "the printer is dead" written into a forum nobody is watching is a
    // report that was never made. Every thread here is about a record, so
    // every thread is somebody's work rather than conversation.
    //
    // Addressed by role and not to a person: there is no GA account, there are
    // two admins, and a notification aimed at whoever happens to be listed as
    // responsible is a notification that stops when that person leaves. The
    // author is dropped — being told about your own report is noise, and it is
    // what makes people stop reading the list.
    // Where this happened, when the record can say. An asset knows which shop
    // it stands in, so a fault reported at store-03 reaches head office AND
    // whoever else is posted at store-03 — the second manager on the rota, who
    // will be the one standing next to the dead printer tomorrow. Records with
    // no place fall back to head office, which is the honest answer for a
    // thread about a supplier or an article.
    //
    // The asset id is compared as text: `subject_id` is whatever the person
    // typed, and a cast to uuid would turn "not an asset id" into a 500.
    let at: Option<String> = if subject_kind == "asset" {
        sqlx::query_scalar("SELECT site_id FROM fixed_asset WHERE asset_id::text = $1")
            .bind(&subject_id)
            .fetch_optional(&mut *tx)
            .await?
    } else {
        None
    };
    let audience: Vec<String> = match at.as_deref() {
        Some(place) => {
            super::notifications::recipients_with_role_at(&mut tx, &["ADMIN", "SUPERVISOR"], place)
                .await?
        }
        None => super::notifications::recipients_with_role(&mut tx, &["ADMIN"]).await?,
    }
    .into_iter()
    .filter(|username| username != author && !named.contains(username))
    .collect();
    super::notifications::raise_notification(
        &mut tx,
        super::notifications::NewNotification {
            kind: "discussion.thread.opened",
            title: title.clone(),
            body: match note.as_deref() {
                Some(note) => format!("{author} · {note}"),
                None => format!(
                    "{author} opened a discussion about a {}",
                    kind.label().to_lowercase()
                ),
            },
            subject: Some(("discussion", thread_id.to_string())),
            origin_id: None,
            payload: json!({
                "thread_id": thread_id,
                "subject_kind": subject_kind,
                "subject_id": subject_id,
            }),
        },
        &audience,
    )
    .await?;

    tx.commit().await?;
    read_thread(db, thread_id, reader).await
}

/// The first line of a post, short enough to read in a list.
///
/// Cut on a word rather than mid-syllable, and only when it is actually too
/// long: most replies in this system are one sentence, and an ellipsis on a
/// sentence that already fits is a lie about there being more.
fn snippet(body: &str) -> String {
    const ROOM: usize = 90;
    let one_line = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= ROOM {
        return one_line;
    }
    let cut: String = one_line.chars().take(ROOM).collect();
    let kept = match cut.rsplit_once(' ') {
        Some((head, _)) if head.chars().count() > ROOM / 2 => head.to_owned(),
        _ => cut,
    };
    format!("{kept}…")
}

/// Everybody `@named` in a post, lower-cased, each once, in the order named.
///
/// A name starts after something that cannot be part of one, so the `@` in
/// `budi@toko.id` is an address and not a mention. The characters are the
/// ones a username may hold; a full stop or hyphen at the end is punctuation
/// ("thanks @sari.") rather than part of the name.
fn mentioned_names(body: &str) -> Vec<String> {
    fn part_of_name(ch: char) -> bool {
        ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')
    }
    let chars: Vec<char> = body.chars().collect();
    let mut names: Vec<String> = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let starts_a_name = chars[index] == '@'
            && (index == 0 || !(part_of_name(chars[index - 1]) || chars[index - 1] == '@'));
        if !starts_a_name {
            index += 1;
            continue;
        }
        let start = index + 1;
        let mut end = start;
        while end < chars.len() && part_of_name(chars[end]) {
            end += 1;
        }
        let name = chars[start..end]
            .iter()
            .collect::<String>()
            .trim_end_matches(|ch: char| ch == '.' || ch == '-')
            .to_lowercase();
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
        index = end.max(start);
    }
    names.truncate(MENTION_ROOM);
    names
}

/// Tell the people named in a post that they were, and say who was told.
///
/// Only names that are somebody: an `@` in front of a word that is not an
/// active account is a word. The author is never told about themselves, and
/// a person who muted the thread is not reached by being named in it.
async fn tell_the_named(
    tx: &mut Transaction<'_, Postgres>,
    thread_id: Uuid,
    title: &str,
    author: &str,
    body: &str,
    names: Vec<String>,
) -> Result<Vec<String>, AppError> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let named: Vec<String> = sqlx::query_scalar(
        "SELECT u.username FROM app_user u
          WHERE u.active AND u.username = ANY($1) AND u.username <> $2
            AND NOT EXISTS (
                SELECT 1 FROM discussion_subscription s
                 WHERE s.thread_id = $3 AND s.username = u.username
                   AND s.level = 'muted')
          ORDER BY u.username",
    )
    .bind(&names)
    .bind(author)
    .bind(thread_id)
    .fetch_all(&mut **tx)
    .await?;
    super::notifications::raise_notification(
        tx,
        super::notifications::NewNotification {
            kind: "discussion.mentioned",
            title: title.to_owned(),
            body: format!("{author} mentioned you — {}", snippet(body)),
            subject: Some(("discussion", thread_id.to_string())),
            origin_id: None,
            payload: json!({ "thread_id": thread_id }),
        },
        &named,
    )
    .await?;
    Ok(named)
}

/// Say something in one.
pub async fn reply(
    db: &PgPool,
    thread_id: Uuid,
    reader: DiscussionReader<'_>,
    request: &ReplyRequest,
) -> Result<DiscussionPost, AppError> {
    let author = reader.username;
    let body = clean_body(&request.body, "an empty reply says nothing")?;
    let key = present(request.idempotency_key.as_deref());
    if key.is_some_and(|key| key.len() > 100) {
        return Err(AppError::Validation(
            "that idempotency key is too long".into(),
        ));
    }
    let attachments = require_own_files(db, author, &request.attachments).await?;

    let mut tx = db.begin().await?;
    // Every reply to one thread waits for the one before it, which is what
    // makes `max(seq) + 1` safe and the idempotency check below final.
    let thread = lock_thread(&mut tx, thread_id).await?;

    // A resend of a reply that already landed is answered with that reply,
    // even if the thread was locked in between: the reply got in first.
    if let Some(key) = key {
        let existing: Option<Uuid> = sqlx::query_scalar(
            "SELECT post_id FROM discussion_post WHERE thread_id = $1 AND idempotency_key = $2",
        )
        .bind(thread_id)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = existing {
            tx.rollback().await?;
            return load_post(db, existing, reader).await;
        }
    }

    // Locked means the argument is over and continues elsewhere. Enforced
    // where the write happens, not only where the button is drawn.
    if thread.status == "locked" {
        return Err(locked_refusal());
    }

    if let Some(quoted) = request.reply_to_seq {
        let withdrawn: Option<bool> = sqlx::query_scalar(
            "SELECT withdrawn_at IS NOT NULL FROM discussion_post
              WHERE thread_id = $1 AND seq = $2",
        )
        .bind(thread_id)
        .bind(quoted)
        .fetch_optional(&mut *tx)
        .await?;
        match withdrawn {
            None => {
                return Err(AppError::Validation(format!(
                    "there is no post #{quoted} in this discussion to reply to"
                )))
            }
            Some(true) => {
                return Err(AppError::Validation(format!(
                    "post #{quoted} was withdrawn, so there is nothing to reply to"
                )))
            }
            Some(false) => {}
        }
    }

    let seq: i64 = sqlx::query_scalar(
        "SELECT COALESCE(max(seq), 0) + 1 FROM discussion_post WHERE thread_id = $1",
    )
    .bind(thread_id)
    .fetch_one(&mut *tx)
    .await?;
    let post_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO discussion_post
             (post_id, thread_id, seq, author_username, body, reply_to_seq, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(post_id)
    .bind(thread_id)
    .bind(seq)
    .bind(author)
    .bind(&body)
    .bind(request.reply_to_seq)
    .bind(key)
    .execute(&mut *tx)
    .await?;
    attach_files(&mut tx, post_id, &attachments).await?;
    sqlx::query("UPDATE discussion_thread SET last_activity_at = now() WHERE thread_id = $1")
        .bind(thread_id)
        .execute(&mut *tx)
        .await?;
    // Whoever writes has read as far as what they wrote. Mostly this changes
    // nothing — the thread page already moved the position when it opened —
    // but a reply filed from the Files screen never opened the thread, and
    // left its own author looking at it as "New".
    sqlx::query(
        "INSERT INTO discussion_thread_view (thread_id, username, last_read_seq)
         VALUES ($1, $2, $3)
         ON CONFLICT (thread_id, username) DO UPDATE
            SET last_seen_at = now(),
                last_read_seq = GREATEST(discussion_thread_view.last_read_seq,
                                         EXCLUDED.last_read_seq)",
    )
    .bind(thread_id)
    .bind(author)
    .bind(seq)
    .execute(&mut *tx)
    .await?;
    announce(
        &mut tx,
        "discussion.post",
        thread_id,
        json!({ "thread_id": thread_id, "seq": seq, "author": author, "action": "posted" }),
    )
    .await?;

    let named = tell_the_named(
        &mut tx,
        thread_id,
        &thread.title,
        author,
        &body,
        mentioned_names(&body),
    )
    .await?;

    // Everybody already in this argument is told there is more of it.
    //
    // Addressed to PEOPLE and not to a role, which is the difference between
    // this and every other notification in the system: the question "who cares
    // about this thread" has one honest answer — whoever has written in it,
    // and whoever asked to watch it — and no rung or posting can be asked it. A
    // store manager who reported a dead printer is not a supervisor here, they
    // are the person waiting.
    //
    // Without this the reporting loop only runs one way: head office is told a
    // fault was reported, answers it, and the shop never learns. People stop
    // reporting faults not because nobody acts on them, but because the answer
    // never becomes visible.
    //
    // Minus whoever muted it, and minus whoever was just told by name — one
    // reply is one notification, not two.
    let participants: Vec<String> = sqlx::query_scalar(
        "SELECT who FROM (
             SELECT created_by AS who FROM discussion_thread WHERE thread_id = $1
             UNION
             SELECT author_username FROM discussion_post WHERE thread_id = $1
             UNION
             SELECT username FROM discussion_subscription
              WHERE thread_id = $1 AND level = 'watching'
         ) everybody
          WHERE who <> $2
            AND NOT (who = ANY($3))
            AND NOT EXISTS (
                SELECT 1 FROM discussion_subscription s
                 WHERE s.thread_id = $1 AND s.username = everybody.who
                   AND s.level = 'muted')
          ORDER BY who",
    )
    .bind(thread_id)
    .bind(author)
    .bind(&named)
    .fetch_all(&mut *tx)
    .await?;
    super::notifications::raise_notification(
        &mut tx,
        super::notifications::NewNotification {
            kind: "discussion.thread.replied",
            title: thread.title.clone(),
            // The reply itself, cut rather than summarised: "there is a new
            // reply" makes somebody open a screen to find out whether it
            // mattered, and most of the time it is one sentence long anyway.
            body: match thread.subject_note.as_deref().map(str::trim) {
                Some(note) if !note.is_empty() => format!("{author} · {note} — {}", snippet(&body)),
                _ => format!("{author} — {}", snippet(&body)),
            },
            subject: Some(("discussion", thread_id.to_string())),
            origin_id: None,
            payload: json!({ "thread_id": thread_id, "seq": seq }),
        },
        &participants,
    )
    .await?;

    tx.commit().await?;
    load_post(db, post_id, reader).await
}

/// Correct a post. Its author only, and never in a locked thread.
///
/// The words it replaces are kept as a revision, and the post says it was
/// edited. Somebody named for the first time by the correction is told; the
/// people named before were told when it was written.
pub async fn edit_post(
    db: &PgPool,
    thread_id: Uuid,
    post_id: Uuid,
    reader: DiscussionReader<'_>,
    request: &EditPostRequest,
) -> Result<DiscussionPost, AppError> {
    let body = clean_body(
        &request.body,
        "a post cannot be edited down to nothing; withdraw it instead",
    )?;
    let mut tx = db.begin().await?;
    let thread = lock_thread(&mut tx, thread_id).await?;
    let row = sqlx::query(
        "SELECT author_username, body, withdrawn_at IS NOT NULL AS withdrawn
           FROM discussion_post WHERE post_id = $1 AND thread_id = $2 FOR UPDATE",
    )
    .bind(post_id)
    .bind(thread_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("that post is not in this discussion".into()))?;
    let author: String = row.try_get("author_username")?;
    let previous: String = row.try_get("body")?;
    let withdrawn: bool = row.try_get("withdrawn")?;
    if author != reader.username {
        return Err(AppError::Forbidden(
            "only whoever wrote a post can change what it says".into(),
        ));
    }
    if withdrawn {
        return Err(AppError::Conflict("that post was withdrawn".into()));
    }
    if thread.status == "locked" {
        return Err(locked_refusal());
    }
    if previous == body {
        tx.rollback().await?;
        return load_post(db, post_id, reader).await;
    }

    let revision: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(revision), 0) + 1 FROM discussion_post_revision WHERE post_id = $1",
    )
    .bind(post_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO discussion_post_revision (post_id, revision, body, replaced_by)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(post_id)
    .bind(revision)
    .bind(&previous)
    .bind(reader.username)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE discussion_post SET body = $2, edited_at = now() WHERE post_id = $1")
        .bind(post_id)
        .bind(&body)
        .execute(&mut *tx)
        .await?;
    announce(
        &mut tx,
        "discussion.post",
        thread_id,
        json!({ "thread_id": thread_id, "post_id": post_id, "author": reader.username, "action": "edited" }),
    )
    .await?;

    let before = mentioned_names(&previous);
    let newly_named: Vec<String> = mentioned_names(&body)
        .into_iter()
        .filter(|name| !before.contains(name))
        .collect();
    tell_the_named(
        &mut tx,
        thread_id,
        &thread.title,
        reader.username,
        &body,
        newly_named,
    )
    .await?;

    tx.commit().await?;
    load_post(db, post_id, reader).await
}

/// Take a post back.
///
/// Its author may, while the thread is open to replies; head office may at any
/// time. Never the opening post: that post IS the thread, and a thread whose
/// question has been withdrawn should be locked, which says so, rather than
/// left as a title over a gap.
///
/// Withdrawing the accepted answer un-answers the thread — an answer nobody
/// can read has not answered anything.
pub async fn withdraw_post(
    db: &PgPool,
    thread_id: Uuid,
    post_id: Uuid,
    reader: DiscussionReader<'_>,
) -> Result<DiscussionPost, AppError> {
    let mut tx = db.begin().await?;
    let thread = lock_thread(&mut tx, thread_id).await?;
    let row = sqlx::query(
        "SELECT author_username, seq, is_solution, withdrawn_at IS NOT NULL AS withdrawn
           FROM discussion_post WHERE post_id = $1 AND thread_id = $2 FOR UPDATE",
    )
    .bind(post_id)
    .bind(thread_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("that post is not in this discussion".into()))?;
    let author: String = row.try_get("author_username")?;
    let seq: i64 = row.try_get("seq")?;
    let was_answer: bool = row.try_get("is_solution")?;
    let withdrawn: bool = row.try_get("withdrawn")?;

    if withdrawn {
        // Already done: a retried request lands where it was meant to.
        tx.rollback().await?;
        return load_post(db, post_id, reader).await;
    }
    if seq == 1 {
        return Err(AppError::Conflict(
            "the opening post is the discussion itself; lock the discussion instead".into(),
        ));
    }
    if author != reader.username && !reader.moderator {
        return Err(AppError::Forbidden(
            "only whoever wrote a post, or head office, can withdraw it".into(),
        ));
    }
    if thread.status == "locked" && !reader.moderator {
        return Err(locked_refusal());
    }

    sqlx::query(
        "UPDATE discussion_post
            SET withdrawn_at = now(), withdrawn_by = $2, is_solution = false
          WHERE post_id = $1",
    )
    .bind(post_id)
    .bind(reader.username)
    .execute(&mut *tx)
    .await?;
    if was_answer && thread.status == "resolved" {
        sqlx::query("UPDATE discussion_thread SET status = 'open' WHERE thread_id = $1")
            .bind(thread_id)
            .execute(&mut *tx)
            .await?;
    }
    announce(
        &mut tx,
        "discussion.post",
        thread_id,
        json!({ "thread_id": thread_id, "post_id": post_id, "author": reader.username, "action": "withdrawn" }),
    )
    .await?;
    tx.commit().await?;
    load_post(db, post_id, reader).await
}

/// Put a reaction on a post, or take it off. Answers with the post's reactions
/// as they now stand.
pub async fn react_to_post(
    db: &PgPool,
    thread_id: Uuid,
    post_id: Uuid,
    reader: DiscussionReader<'_>,
    request: &ReactToPostRequest,
) -> Result<Vec<PostReaction>, AppError> {
    let reaction = request.reaction.trim();
    if !DISCUSSION_REACTIONS.contains(&reaction) {
        return Err(AppError::Validation(format!(
            "a reaction is one of: {}",
            DISCUSSION_REACTIONS.join(", ")
        )));
    }
    let mut tx = db.begin().await?;
    let thread = lock_thread(&mut tx, thread_id).await?;
    if thread.status == "locked" {
        return Err(locked_refusal());
    }
    let withdrawn: bool = sqlx::query_scalar(
        "SELECT withdrawn_at IS NOT NULL FROM discussion_post
          WHERE post_id = $1 AND thread_id = $2",
    )
    .bind(post_id)
    .bind(thread_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("that post is not in this discussion".into()))?;
    if withdrawn {
        return Err(AppError::Conflict("that post was withdrawn".into()));
    }
    let changed = if request.on {
        sqlx::query(
            "INSERT INTO discussion_post_reaction (post_id, username, reaction)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(post_id)
        .bind(reader.username)
        .bind(reaction)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "DELETE FROM discussion_post_reaction
              WHERE post_id = $1 AND username = $2 AND reaction = $3",
        )
        .bind(post_id)
        .bind(reader.username)
        .bind(reaction)
        .execute(&mut *tx)
        .await?
        .rows_affected()
    };
    if changed > 0 {
        announce(
            &mut tx,
            "discussion.post",
            thread_id,
            json!({ "thread_id": thread_id, "post_id": post_id, "author": reader.username, "action": "reacted" }),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(reactions_for(db, &[post_id], reader.username)
        .await?
        .into_iter()
        .map(|(_, reaction)| reaction)
        .collect())
}

/// Mark the reply that settled it and say the thread is answered — or, with
/// no post, say that nothing has answered it after all.
///
/// One per thread, guaranteed by a partial unique index, so this clears any
/// previous mark in the same transaction rather than relying on the caller to
/// unmark first.
pub async fn accept_solution(
    db: &PgPool,
    thread_id: Uuid,
    post_id: Option<Uuid>,
    reader: DiscussionReader<'_>,
) -> Result<DiscussionThread, AppError> {
    let mut tx = db.begin().await?;
    let thread = lock_thread(&mut tx, thread_id).await?;
    // Whoever asked decides what answered it. Anyone marking anyone's thread
    // resolved is how a forum ends up with questions closed by people who
    // never had the problem. Head office may, because head office moderates.
    if thread.created_by != reader.username && !reader.moderator {
        return Err(AppError::Forbidden(
            "only whoever opened the discussion can say what answered it".into(),
        ));
    }
    // Marking an answer sets the thread to "answered", and that would quietly
    // unlock a locked one.
    if thread.status == "locked" {
        return Err(AppError::Conflict(
            "this discussion is locked; reopen it before marking an answer".into(),
        ));
    }
    sqlx::query(
        "UPDATE discussion_post SET is_solution = false WHERE thread_id = $1 AND is_solution",
    )
    .bind(thread_id)
    .execute(&mut *tx)
    .await?;

    match post_id {
        None => {
            if thread.status == "resolved" {
                sqlx::query("UPDATE discussion_thread SET status = 'open' WHERE thread_id = $1")
                    .bind(thread_id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        Some(post_id) => {
            let row = sqlx::query(
                "SELECT seq, author_username, withdrawn_at IS NOT NULL AS withdrawn
                   FROM discussion_post WHERE thread_id = $1 AND post_id = $2",
            )
            .bind(thread_id)
            .bind(post_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("that reply is not in this discussion".into()))?;
            let seq: i64 = row.try_get("seq")?;
            let author: String = row.try_get("author_username")?;
            let withdrawn: bool = row.try_get("withdrawn")?;
            if seq == 1 {
                return Err(AppError::Validation(
                    "the opening post asks the question; it cannot also be the answer".into(),
                ));
            }
            if withdrawn {
                return Err(AppError::Conflict(
                    "that reply was withdrawn, so it cannot be the answer".into(),
                ));
            }
            sqlx::query("UPDATE discussion_post SET is_solution = true WHERE post_id = $1")
                .bind(post_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE discussion_thread SET status = 'resolved' WHERE thread_id = $1")
                .bind(thread_id)
                .execute(&mut *tx)
                .await?;
            // Whoever wrote the answer is told it was one. It is the only
            // thanks a forum reliably gives, and it closes the loop for
            // somebody at head office who answered a shop and moved on.
            if author != reader.username {
                super::notifications::raise_notification(
                    &mut tx,
                    super::notifications::NewNotification {
                        kind: "discussion.solution.accepted",
                        title: thread.title.clone(),
                        body: format!("{} marked your reply as the answer", reader.username),
                        subject: Some(("discussion", thread_id.to_string())),
                        origin_id: None,
                        payload: json!({ "thread_id": thread_id, "seq": seq }),
                    },
                    &[author],
                )
                .await?;
            }
        }
    }
    announce(
        &mut tx,
        "discussion.thread",
        thread_id,
        json!({ "thread_id": thread_id, "author": reader.username, "action": "answered" }),
    )
    .await?;
    tx.commit().await?;
    load_thread(db, thread_id, reader).await
}

/// Open, resolved, or locked — set by whoever opened it, or by head office.
pub async fn set_status(
    db: &PgPool,
    thread_id: Uuid,
    status: &str,
    reader: DiscussionReader<'_>,
) -> Result<DiscussionThread, AppError> {
    let status = status.trim().to_ascii_lowercase();
    if !["open", "resolved", "locked"].contains(&status.as_str()) {
        return Err(AppError::Validation(
            "a discussion is open, resolved, or locked".into(),
        ));
    }
    let mut tx = db.begin().await?;
    let thread = lock_thread(&mut tx, thread_id).await?;
    if thread.created_by != reader.username && !reader.moderator {
        return Err(AppError::Forbidden(
            "only whoever opened the discussion can change its state".into(),
        ));
    }
    if thread.status != status {
        sqlx::query("UPDATE discussion_thread SET status = $2 WHERE thread_id = $1")
            .bind(thread_id)
            .bind(&status)
            .execute(&mut *tx)
            .await?;
        announce(
            &mut tx,
            "discussion.thread",
            thread_id,
            json!({ "thread_id": thread_id, "author": reader.username, "action": status }),
        )
        .await?;
    }
    tx.commit().await?;
    load_thread(db, thread_id, reader).await
}

/// Retitle it, reword its note, refile its tags. Whoever opened it, or head
/// office — the same two who may say it is answered.
pub async fn edit_thread(
    db: &PgPool,
    thread_id: Uuid,
    reader: DiscussionReader<'_>,
    request: &EditThreadRequest,
) -> Result<DiscussionThread, AppError> {
    let title = clean_title(&request.title)?;
    let note = clean_note(request.subject_note.as_deref())?;
    let moved_to = match (
        present(request.subject_kind.as_deref()),
        present(request.subject_id.as_deref()),
    ) {
        (None, None) => None,
        (Some(kind), Some(id)) => {
            let (kind, id) = clean_subject(kind, id)?;
            Some((kind.as_str().to_owned(), id))
        }
        _ => {
            return Err(AppError::Validation(
                "to move a discussion, name both the kind of record and which one".into(),
            ))
        }
    };
    let mut tx = db.begin().await?;
    let thread = lock_thread(&mut tx, thread_id).await?;
    if thread.created_by != reader.username && !reader.moderator {
        return Err(AppError::Forbidden(
            "only whoever opened the discussion can retitle it".into(),
        ));
    }
    // COALESCE keeps the record when nothing moved: one statement, and no
    // second read of the row to learn what it already says.
    sqlx::query(
        "UPDATE discussion_thread
            SET title = $2, subject_note = $3, edited_at = now(),
                subject_kind = COALESCE($4, subject_kind),
                subject_id = COALESCE($5, subject_id)
          WHERE thread_id = $1",
    )
    .bind(thread_id)
    .bind(&title)
    .bind(&note)
    .bind(moved_to.as_ref().map(|(kind, _)| kind.as_str()))
    .bind(moved_to.as_ref().map(|(_, id)| id.as_str()))
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM discussion_thread_tag WHERE thread_id = $1")
        .bind(thread_id)
        .execute(&mut *tx)
        .await?;
    write_tags(&mut tx, thread_id, &request.tags).await?;
    announce(
        &mut tx,
        "discussion.thread",
        thread_id,
        json!({ "thread_id": thread_id, "title": title, "author": reader.username, "action": "edited" }),
    )
    .await?;
    tx.commit().await?;
    load_thread(db, thread_id, reader).await
}

/// Pin it above the board, or take it down. Head office only: a pin is a
/// statement to everybody, and everybody pinning their own thread is a board
/// with no top.
pub async fn pin_thread(
    db: &PgPool,
    thread_id: Uuid,
    reader: DiscussionReader<'_>,
    pinned: bool,
) -> Result<DiscussionThread, AppError> {
    if !reader.moderator {
        return Err(AppError::Forbidden(
            "only head office can pin a discussion".into(),
        ));
    }
    let mut tx = db.begin().await?;
    lock_thread(&mut tx, thread_id).await?;
    sqlx::query(
        "UPDATE discussion_thread
            SET pinned_at = CASE WHEN $2::boolean THEN COALESCE(pinned_at, now()) END,
                pinned_by = CASE WHEN $2::boolean THEN COALESCE(pinned_by, $3) END
          WHERE thread_id = $1",
    )
    .bind(thread_id)
    .bind(pinned)
    .bind(reader.username)
    .execute(&mut *tx)
    .await?;
    announce(
        &mut tx,
        "discussion.thread",
        thread_id,
        json!({
            "thread_id": thread_id,
            "author": reader.username,
            "action": if pinned { "pinned" } else { "unpinned" },
        }),
    )
    .await?;
    tx.commit().await?;
    load_thread(db, thread_id, reader).await
}

/// Set or clear the caller's own bookmark. Private, and the return value is
/// the caller's state alone — there is no count of bookmarks anywhere.
pub async fn set_bookmark(
    db: &PgPool,
    thread_id: Uuid,
    username: &str,
    marked: bool,
) -> Result<bool, AppError> {
    // A 404 for a thread that is not there, rather than the foreign key's 500.
    thread_status(db, thread_id).await?;
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

/// How closely the caller follows a thread: `watching`, `normal` or `muted`.
/// Private, like a bookmark. Answers with the level now in force.
pub async fn set_subscription(
    db: &PgPool,
    thread_id: Uuid,
    username: &str,
    level: &str,
) -> Result<String, AppError> {
    let level = level.trim().to_ascii_lowercase();
    thread_status(db, thread_id).await?;
    match level.as_str() {
        "normal" => {
            sqlx::query(
                "DELETE FROM discussion_subscription WHERE thread_id = $1 AND username = $2",
            )
            .bind(thread_id)
            .bind(username)
            .execute(db)
            .await?;
        }
        "watching" | "muted" => {
            sqlx::query(
                "INSERT INTO discussion_subscription (thread_id, username, level)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (thread_id, username)
                 DO UPDATE SET level = EXCLUDED.level, set_at = now()",
            )
            .bind(thread_id)
            .bind(username)
            .bind(&level)
            .execute(db)
            .await?;
        }
        _ => {
            return Err(AppError::Validation(
                "a discussion is followed as watching, normal, or muted".into(),
            ))
        }
    }
    Ok(level)
}

/// Whether these bytes may be fetched through this thread. A discussion is
/// readable by everybody signed in, so the check is that the file actually
/// hangs on a post in THIS thread — which is what stops a file id from one
/// thread being fetched through another's URL — and that the post still
/// stands: withdrawing a post withdraws what was attached to it.
pub async fn discussion_attachment_is_reachable(
    db: &PgPool,
    thread_id: Uuid,
    file_id: Uuid,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM discussion_post_attachment a
              JOIN discussion_post p ON p.post_id = a.post_id
             WHERE p.thread_id = $1 AND a.file_id = $2
               AND p.withdrawn_at IS NULL)",
    )
    .bind(thread_id)
    .bind(file_id)
    .fetch_one(db)
    .await?)
}

pub async fn subject_counts(db: &PgPool) -> Result<Vec<SubjectCount>, AppError> {
    let rows = sqlx::query(
        "SELECT subject_kind, count(*) AS threads
           FROM discussion_thread GROUP BY subject_kind ORDER BY subject_kind",
    )
    .fetch_all(db)
    .await?;
    let mut counts = rows
        .iter()
        .map(|row| {
            let subject_kind: String = row.try_get("subject_kind")?;
            Ok(SubjectCount {
                label: subject_label(&subject_kind),
                subject_kind,
                threads: row.try_get("threads")?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    // By what a person reads, not by the code underneath it.
    counts.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(counts)
}

/// Every tag in use, busiest first. The rail's second list — read from the
/// tags themselves, so a tag that is on no thread the board happens to be
/// showing can still be chosen.
pub async fn tag_counts(db: &PgPool) -> Result<Vec<TagCount>, AppError> {
    let rows = sqlx::query(
        "SELECT tag, count(*) AS threads FROM discussion_thread_tag
          GROUP BY tag ORDER BY count(*) DESC, tag LIMIT 60",
    )
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(TagCount {
                tag: row.try_get("tag")?,
                threads: row.try_get("threads")?,
            })
        })
        .collect()
}

/// The kinds of record a thread may be opened on, in the order a person reads
/// them.
pub fn subject_kinds() -> Vec<SubjectKindOption> {
    let mut kinds: Vec<SubjectKindOption> = RecordKind::ALL
        .iter()
        .filter(|kind| !NOT_A_SUBJECT.contains(&kind.as_str()))
        .map(|kind| SubjectKindOption {
            kind: kind.as_str().to_owned(),
            label: kind.label().to_owned(),
        })
        .collect();
    kinds.sort_by(|a, b| a.label.cmp(&b.label));
    kinds
}

/// Somebody a post can name with `@`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DiscussionPerson {
    pub username: String,
    /// Their display name, or their username when they have none.
    pub name: String,
}

/// Everybody who can be named in a post: the active accounts, by name.
///
/// Its own read rather than the user administration list, which is ADMIN's —
/// a cashier naming the store manager in a fault report must not need the
/// right to suspend accounts to find out how the manager's name is spelled.
/// Only the two columns a mention needs; roles, postings and sign-in times
/// stay behind the administration route.
pub async fn discussion_people(db: &PgPool) -> Result<Vec<DiscussionPerson>, AppError> {
    let rows = sqlx::query(
        "SELECT username,
                COALESCE(NULLIF(btrim(display_name), ''), username) AS name
           FROM app_user WHERE active ORDER BY username",
    )
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(DiscussionPerson {
                username: row.try_get("username")?,
                name: row.try_get("name")?,
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
                .to_lowercase()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("-")
        })
        .filter(|tag| !tag.is_empty() && tag.chars().count() <= 40)
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
            "lead   time".into(),
        ]);
        assert_eq!(tags, vec!["harga".to_string(), "lead-time".to_string()]);
    }

    /// The rule 0040 wrote down, kept after the list stopped being this
    /// module's. A thread hangs on a RECORD; the moment "general" is a legal
    /// subject this is a forum with categories, which is the one thing it must
    /// not become. The list may grow — a payroll run is a record somebody may
    /// argue about — but it may only grow by records.
    #[test]
    fn no_subject_is_a_category() {
        for word in ["general", "other", "misc", "announcements", "random"] {
            assert!(
                RecordKind::parse(word).is_none(),
                "{word:?} is not a record, and a thread that hangs on it is a \
                 category by another name"
            );
        }
        assert!(RecordKind::parse("purchase_order").is_some());
    }

    /// The collaboration surfaces are records for the log's sake, and not
    /// things a thread can be about.
    #[test]
    fn a_thread_is_not_about_a_thread() {
        let kinds: Vec<String> = subject_kinds()
            .into_iter()
            .map(|option| option.kind)
            .collect();
        for kind in NOT_A_SUBJECT {
            assert!(!kinds.contains(&kind.to_string()), "{kind} is offered");
        }
        assert!(kinds.contains(&"purchase_order".to_string()));
        assert!(kinds.contains(&"asset".to_string()));
    }

    #[test]
    fn a_name_is_an_at_sign_and_a_username() {
        assert_eq!(
            mentioned_names("@sari tolong cek, cc @Budi. dan @sari lagi"),
            vec!["sari".to_string(), "budi".to_string()]
        );
    }

    #[test]
    fn an_email_address_names_nobody() {
        assert!(mentioned_names("kirim ke budi@toko.id ya").is_empty());
        assert!(mentioned_names("@@sari").is_empty());
        assert!(mentioned_names("just an @ on its own").is_empty());
    }

    #[test]
    fn punctuation_after_a_name_is_not_part_of_it() {
        assert_eq!(
            mentioned_names("thanks @dewi.p-, and (@eko)"),
            vec!["dewi.p".to_string(), "eko".to_string()]
        );
    }

    #[test]
    fn a_search_for_a_percent_sign_means_the_character() {
        assert_eq!(like_pattern("50%_a\\b"), "%50\\%\\_a\\\\b%");
    }

    #[test]
    fn a_snippet_is_cut_on_a_word_only_when_it_has_to_be() {
        assert_eq!(snippet("  short\n reply "), "short reply");
        let long = "kata ".repeat(40);
        let cut = snippet(&long);
        assert!(cut.ends_with('…'));
        assert!(cut.chars().count() <= 91);
        assert!(!cut.contains("  "));
    }
}
