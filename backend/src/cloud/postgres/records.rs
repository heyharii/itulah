//! One record's surroundings: what people said about it, what it is filed
//! under, what happened to it, and what carries it.
//!
//! # Why one read and not five
//!
//! A sheet needs a record's comments, its tags, its history, the documents
//! filed against it and the threads arguing about it. Five routes means five
//! requests on every sheet open, five loading states, and five chances for one
//! of them to be forgotten on the sixth screen somebody builds.
//!
//! ERPNext answers this with `get_docinfo`: one call per opened document that
//! returns comments, versions, attachments, assignments, shares, views, tags
//! and milestones together, and one timeline widget that merges thirteen
//! streams into a single list. That is the part worth copying, and it is worth
//! copying because of what it makes possible rather than what it saves: a
//! generic sheet can offer all of it without any screen having to opt in, and
//! 282 record types get the same treatment without 282 decisions.
//!
//! # What it deliberately is not
//!
//! It is not paged. The lists here are the LAST of each — the recent comments,
//! the recent actions — because a sheet shows a tail and a person who wants
//! the whole history has `/api/v1/audit`, which pages properly. An `info` read
//! that grew a cursor would be a list endpoint wearing a detail endpoint's
//! name.
//!
//! It does not check whether the record EXISTS. Nothing here joins to the
//! record's own table, and that is the same choice `discussion_thread` made in
//! 0040 for the same reason: the fifty-seven kinds live in fifty-seven tables
//! with different key types, a comment must survive its record being archived,
//! and four of the kinds name records this schema does not hold at all.

use super::audit::{list_audit, AuditEntry, AuditScope};
use super::discussion::{list_threads, DiscussionReader, DiscussionThread, ThreadQuery};
use super::documents::{search_documents, Document, DocumentQuery};
use crate::cloud::application::AppError;
use crate::cloud::domain::RecordKind;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// How much of each tail a sheet is given.
///
/// Small on purpose. A record with four hundred comments is a record whose
/// sheet should say so and offer the rest on demand, not one that ships four
/// hundred rows to draw a panel nobody has expanded.
const TAIL: i64 = 50;

/// What somebody said about a record.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordComment {
    pub comment_id: Uuid,
    pub author: String,
    pub display_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// Set once somebody changed their own words. Shown rather than hidden: a
    /// comment that quietly became a different comment is worse than one that
    /// admits it was edited.
    pub edited_at: Option<DateTime<Utc>>,
    /// Whether the caller wrote it — which is the only person who may change
    /// or remove it. Answered by the server so a screen does not have to
    /// compare usernames and get the comparison wrong.
    pub mine: bool,
}

/// A word a record is filed under.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordTag {
    pub tag_code: String,
    /// From the `tag` master, so two screens cannot spell it differently.
    pub label: String,
    pub tagged_by: String,
    pub tagged_at: DateTime<Utc>,
}

/// Everything a sheet needs about the record it has open, in one answer.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordInfo {
    pub subject_kind: String,
    /// What a person calls this kind — "Supplier bill", not `bill`. From the
    /// one vocabulary, so a screen does not keep its own copy of the words.
    pub label: String,
    pub subject_id: String,
    pub comments: Vec<RecordComment>,
    pub tags: Vec<RecordTag>,
    /// Who did what to this record, newest first. The same rows
    /// `/api/v1/audit` serves, cut to a tail.
    pub activity: Vec<AuditEntry>,
    /// Documents filed against it — the drawer's side of the same pair.
    pub documents: Vec<Document>,
    /// Threads arguing about it. A comment is a sentence on a record; a thread
    /// is an argument about one, and both belong on the sheet.
    pub threads: Vec<DiscussionThread>,
}

/// What a caller posts to say something.
#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NewComment {
    pub body: String,
}

const COMMENT_COLUMNS: &str =
    "comment_id, author, display_name, body, created_at, edited_at, subject_kind, subject_id";

fn read_comment(row: &sqlx::postgres::PgRow, viewer: &str) -> Result<RecordComment, sqlx::Error> {
    let author: String = row.try_get("author")?;
    Ok(RecordComment {
        mine: author == viewer,
        comment_id: row.try_get("comment_id")?,
        author,
        display_name: row.try_get("display_name")?,
        body: row.try_get("body")?,
        created_at: row.try_get("created_at")?,
        edited_at: row.try_get("edited_at")?,
    })
}

/// One record's comments, oldest first, because a conversation is read in the
/// order it was had.
pub async fn list_record_comments(
    db: &PgPool,
    kind: RecordKind,
    subject_id: &str,
    viewer: &str,
) -> Result<Vec<RecordComment>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {COMMENT_COLUMNS} FROM comment
          WHERE subject_kind = $1 AND subject_id = $2
          ORDER BY created_at, comment_id
          LIMIT $3"
    ))
    .bind(kind.as_str())
    .bind(subject_id)
    .bind(TAIL)
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| read_comment(row, viewer).map_err(AppError::from))
        .collect()
}

pub async fn add_record_comment(
    db: &PgPool,
    kind: RecordKind,
    subject_id: &str,
    author: &str,
    display_name: &str,
    body: &str,
) -> Result<RecordComment, AppError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::Validation(
            "a comment needs something in it".into(),
        ));
    }
    // Long enough for the paragraph somebody actually wants to leave, short
    // enough that a pasted spreadsheet is refused rather than stored.
    const MAX_BODY: usize = 8_000;
    if body.chars().count() > MAX_BODY {
        return Err(AppError::Validation(format!(
            "a comment is at most {MAX_BODY} characters; this one is {}. \
             Something this long is a document, and there is a drawer for those",
            body.chars().count()
        )));
    }
    let subject_id = subject_id.trim();
    if subject_id.is_empty() {
        return Err(AppError::Validation("name the record this is about".into()));
    }
    let row = sqlx::query(&format!(
        "INSERT INTO comment
             (comment_id, subject_kind, subject_id, author, display_name, body)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING {COMMENT_COLUMNS}"
    ))
    .bind(Uuid::new_v4())
    .bind(kind.as_str())
    .bind(subject_id)
    .bind(author)
    .bind(display_name)
    .bind(body)
    .fetch_one(db)
    .await?;
    Ok(read_comment(&row, author)?)
}

/// The record a comment is about.
///
/// Read before a change rather than after, because the handler has to file the
/// change against the record — and after a delete there is nothing left to ask.
pub async fn comment_subject(
    db: &PgPool,
    comment_id: Uuid,
) -> Result<(RecordKind, String), AppError> {
    let row = sqlx::query("SELECT subject_kind, subject_id FROM comment WHERE comment_id = $1")
        .bind(comment_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Comment".into()))?;
    let kind: String = row.try_get("subject_kind")?;
    let kind = RecordKind::parse(&kind)
        .ok_or_else(|| AppError::Validation(format!("{kind:?} is not a record kind")))?;
    Ok((kind, row.try_get("subject_id")?))
}

/// Change your own words.
///
/// Author-only, enforced in the `WHERE` rather than by reading the row and
/// comparing: a check that happens in a second statement is a check somebody
/// can race.
pub async fn edit_record_comment(
    db: &PgPool,
    comment_id: Uuid,
    author: &str,
    body: &str,
) -> Result<RecordComment, AppError> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::Validation(
            "a comment needs something in it".into(),
        ));
    }
    let row = sqlx::query(&format!(
        "UPDATE comment SET body = $3, edited_at = now()
          WHERE comment_id = $1 AND author = $2
        RETURNING {COMMENT_COLUMNS}"
    ))
    .bind(comment_id)
    .bind(author)
    .bind(body)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| {
        // Deliberately one message for "no such comment" and "not yours". The
        // alternative tells anybody who can guess a uuid whether a comment
        // exists and who did not write it.
        AppError::NotFound("Comment, or not yours to change".into())
    })?;
    Ok(read_comment(&row, author)?)
}

pub async fn delete_record_comment(
    db: &PgPool,
    comment_id: Uuid,
    author: &str,
) -> Result<(), AppError> {
    let done = sqlx::query("DELETE FROM comment WHERE comment_id = $1 AND author = $2")
        .bind(comment_id)
        .bind(author)
        .execute(db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("Comment, or not yours to remove".into()));
    }
    Ok(())
}

pub async fn list_record_tags(
    db: &PgPool,
    kind: RecordKind,
    subject_id: &str,
) -> Result<Vec<RecordTag>, AppError> {
    let rows = sqlx::query(
        "SELECT r.tag_code, t.label, r.tagged_by, r.tagged_at
           FROM record_tag r JOIN tag t ON t.code = r.tag_code
          WHERE r.subject_kind = $1 AND r.subject_id = $2
          ORDER BY t.label",
    )
    .bind(kind.as_str())
    .bind(subject_id)
    .fetch_all(db)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(RecordTag {
                tag_code: row.try_get("tag_code")?,
                label: row.try_get("label")?,
                tagged_by: row.try_get("tagged_by")?,
                tagged_at: row.try_get("tagged_at")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(AppError::from)
}

/// File a record under a word.
///
/// Idempotent: tagging what is already tagged is not an error, because the
/// screen's button is a toggle and a double click is not a mistake worth a
/// 409.
pub async fn tag_record(
    db: &PgPool,
    kind: RecordKind,
    subject_id: &str,
    tag_code: &str,
    by: &str,
) -> Result<(), AppError> {
    let subject_id = subject_id.trim();
    let tag_code = tag_code.trim();
    if subject_id.is_empty() || tag_code.is_empty() {
        return Err(AppError::Validation(
            "a tag names a word and a record".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO record_tag (subject_kind, subject_id, tag_code, tagged_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(kind.as_str())
    .bind(subject_id)
    .bind(tag_code)
    .bind(by)
    .execute(db)
    .await
    .map_err(|error| match &error {
        // The vocabulary refuses the word, and the refusal should name it
        // rather than arrive as a foreign key violation.
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23503") => {
            AppError::Validation(format!("{tag_code:?} is not a tag in the vocabulary"))
        }
        _ => AppError::from(error),
    })?;
    Ok(())
}

pub async fn untag_record(
    db: &PgPool,
    kind: RecordKind,
    subject_id: &str,
    tag_code: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM record_tag
          WHERE subject_kind = $1 AND subject_id = $2 AND tag_code = $3",
    )
    .bind(kind.as_str())
    .bind(subject_id.trim())
    .bind(tag_code.trim())
    .execute(db)
    .await?;
    Ok(())
}

/// Everything around one record, in one answer.
pub async fn record_info(
    db: &PgPool,
    kind: RecordKind,
    subject_id: &str,
    viewer: &str,
) -> Result<RecordInfo, AppError> {
    let comments = list_record_comments(db, kind, subject_id, viewer).await?;
    let tags = list_record_tags(db, kind, subject_id).await?;

    // The same rows `/api/v1/audit` serves, asked for the same way. Counting
    // is off: this is a tail on a sheet, and the exact total costs a scan of
    // the whole log to answer a question the panel does not ask.
    let activity = list_audit(
        db,
        AuditScope {
            subject_kind: Some(kind.as_str().to_owned()),
            subject_id: Some(subject_id.to_owned()),
            limit: Some(TAIL),
            desc: true,
            count: false,
            ..AuditScope::default()
        },
    )
    .await?
    .rows;

    let documents = search_documents(
        db,
        DocumentQuery {
            subject_kind: Some(kind.as_str().to_owned()),
            subject_id: Some(subject_id.to_owned()),
            limit: TAIL,
            ..DocumentQuery::default()
        },
    )
    .await?;

    // Not as a moderator: the sheet shows which threads exist, and what the
    // reader may do to one is decided on the thread's own page.
    let threads = list_threads(
        db,
        DiscussionReader {
            username: viewer,
            moderator: false,
        },
        &ThreadQuery {
            subject_kind: Some(kind.as_str().to_owned()),
            subject_id: Some(subject_id.to_owned()),
            limit: Some(200),
            ..ThreadQuery::default()
        },
    )
    .await?;

    Ok(RecordInfo {
        subject_kind: kind.as_str().to_owned(),
        label: kind.label().to_owned(),
        subject_id: subject_id.to_owned(),
        comments,
        tags,
        activity,
        documents,
        threads,
    })
}
