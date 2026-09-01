//! Work that found a person.
//!
//! A notification is raised by the code that caused it, inside that code's own
//! transaction, so a delivery that was accepted and a buyer who was never told
//! about its price cannot be two separate outcomes. It is announced on the
//! existing collaboration stream rather than on a channel of its own — the
//! browser already holds that connection open, and `after=<event_id>` resumes
//! chat, discussions and this together.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// One thing somebody has to deal with.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Notification {
    pub notification_id: Uuid,
    /// What sort of work this is. The browser routes on it, so it is a closed
    /// set in the schema rather than free text.
    pub kind: String,
    /// The sentence as it was written when the thing happened. Stored rather
    /// than composed in the browser: what a person was told should still read
    /// the same after the screen has been redesigned.
    pub title: String,
    pub body: String,
    /// Where to go when this is clicked, as a record rather than a URL.
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// Which node asked, when a node asked.
    pub origin_id: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Null until this reader has dealt with it. Per reader, which is why
    /// this cannot live on the event stream.
    pub read_at: Option<DateTime<Utc>>,
}

/// What one person is looking at, and how much of it is unfinished.
///
/// The count is not `items.len()`: the list is capped so a screen opened after
/// a bad week does not fetch four hundred rows, and a badge that quietly said
/// "50" when there were four hundred would be a badge nobody trusts.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NotificationPage {
    pub items: Vec<Notification>,
    pub unread: i64,
}

const COLUMNS: &str = "n.notification_id, n.kind, n.title, n.body, n.subject_kind,
                       n.subject_id, n.origin_id, n.created_at, r.read_at";

fn row_to_notification(row: &sqlx::postgres::PgRow) -> Result<Notification, AppError> {
    Ok(Notification {
        notification_id: row.try_get("notification_id")?,
        kind: row.try_get("kind")?,
        title: row.try_get("title")?,
        body: row.try_get("body")?,
        subject_kind: row.try_get("subject_kind")?,
        subject_id: row.try_get("subject_id")?,
        origin_id: row.try_get("origin_id")?,
        created_at: row.try_get("created_at")?,
        read_at: row.try_get("read_at")?,
    })
}

/// Everything a notification needs to be worth sending.
pub struct NewNotification<'a> {
    pub kind: &'a str,
    pub title: String,
    pub body: String,
    pub subject: Option<(&'a str, String)>,
    pub origin_id: Option<&'a str>,
    pub payload: Value,
}

/// Who is told, resolved now rather than at read time.
///
/// Roles are asked of the user table at the moment the work appears, and the
/// resulting usernames are written down. Somebody promoted next week does not
/// inherit last week's unread queue, and somebody who leaves does not take
/// their colleagues' copies with them.
pub async fn recipients_with_role(
    tx: &mut Transaction<'_, Postgres>,
    roles: &[&str],
) -> Result<Vec<String>, AppError> {
    let roles: Vec<String> = roles.iter().map(|role| (*role).to_owned()).collect();
    Ok(
        sqlx::query_scalar("SELECT username FROM app_user WHERE active AND role = ANY($1)")
            .bind(&roles)
            .fetch_all(&mut **tx)
            .await?,
    )
}

/// Raise one, in the caller's transaction.
///
/// Silently does nothing when nobody would be told. That is not a swallowed
/// error: a notification with no recipients is a row that can never be read
/// or cleared, and writing it would make the unread count of a system with no
/// users grow forever.
pub async fn raise_notification(
    tx: &mut Transaction<'_, Postgres>,
    notification: NewNotification<'_>,
    recipients: &[String],
) -> Result<Option<Uuid>, AppError> {
    if recipients.is_empty() {
        return Ok(None);
    }
    let notification_id = Uuid::new_v4();
    let (subject_kind, subject_id) = match &notification.subject {
        Some((kind, id)) => (Some(*kind), Some(id.as_str())),
        None => (None, None),
    };
    sqlx::query(
        "INSERT INTO notification
             (notification_id, kind, title, body, subject_kind, subject_id, origin_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(notification_id)
    .bind(notification.kind)
    .bind(&notification.title)
    .bind(&notification.body)
    .bind(subject_kind)
    .bind(subject_id)
    .bind(notification.origin_id)
    .bind(&notification.payload)
    .execute(&mut **tx)
    .await?;

    // One statement rather than a loop: the recipients are a set, and a
    // partial insert would tell some people and not others.
    sqlx::query(
        "INSERT INTO notification_recipient (notification_id, username)
         SELECT $1, username FROM unnest($2::text[]) AS username",
    )
    .bind(notification_id)
    .bind(recipients)
    .execute(&mut **tx)
    .await?;

    // Announced on the stream so an open screen learns without polling. The
    // audience is exactly the recipients, so this never reaches anybody whose
    // list would not contain it.
    super::chat::record_event(
        tx,
        "notification",
        None,
        None,
        recipients,
        json!({
            "notification_id": notification_id,
            "kind": notification.kind,
            "title": notification.title,
        }),
    )
    .await?;
    Ok(Some(notification_id))
}

/// This person's list, newest first, and how much of it is unread.
pub async fn list_notifications_for(
    pool: &PgPool,
    username: &str,
    unread_only: bool,
    limit: i64,
) -> Result<NotificationPage, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {COLUMNS}
           FROM notification_recipient r
           JOIN notification n ON n.notification_id = r.notification_id
          WHERE r.username = $1 AND ($2 = FALSE OR r.read_at IS NULL)
          ORDER BY n.created_at DESC
          LIMIT $3"
    ))
    .bind(username)
    .bind(unread_only)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;
    let items = rows
        .iter()
        .map(row_to_notification)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(NotificationPage {
        items,
        unread: unread_notification_count(pool, username).await?,
    })
}

pub async fn unread_notification_count(pool: &PgPool, username: &str) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT count(*)::bigint FROM notification_recipient
          WHERE username = $1 AND read_at IS NULL",
    )
    .bind(username)
    .fetch_one(pool)
    .await?)
}

/// Mark one as dealt with, for this reader only.
///
/// `read_at IS NULL` in the WHERE rather than an unconditional UPDATE: two
/// tabs marking the same row should agree on when it was read, and the first
/// answer is the true one.
pub async fn mark_notification_read(pool: &PgPool, username: &str, notification_id: Uuid) -> Result<(), AppError> {
    let updated = sqlx::query(
        "UPDATE notification_recipient SET read_at = now()
          WHERE notification_id = $1 AND username = $2 AND read_at IS NULL",
    )
    .bind(notification_id)
    .bind(username)
    .execute(pool)
    .await?;
    if updated.rows_affected() == 0 {
        // Either already read or not this person's. Both are fine outcomes
        // for a button somebody pressed twice; only a missing row is not.
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM notification_recipient
                            WHERE notification_id = $1 AND username = $2)",
        )
        .bind(notification_id)
        .bind(username)
        .fetch_one(pool)
        .await?;
        if !exists {
            return Err(AppError::NotFound(format!(
                "notification {notification_id} was not sent to {username}"
            )));
        }
    }
    Ok(())
}

/// Clear the badge. Returns how many were actually cleared, so the screen can
/// say what it did rather than merely that it did something.
pub async fn mark_all_notifications_read(pool: &PgPool, username: &str) -> Result<u64, AppError> {
    Ok(sqlx::query(
        "UPDATE notification_recipient SET read_at = now()
          WHERE username = $1 AND read_at IS NULL",
    )
    .bind(username)
    .execute(pool)
    .await?
    .rows_affected())
}
