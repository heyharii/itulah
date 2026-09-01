//! The activity log: who did what, to which record.
//!
//! Written by the HTTP layer rather than by each handler, and that is a
//! deliberate trade. A per-handler call could say "published price book v9"
//! where this can only say "POST /api/v1/commercial/publications/{id}/publish
//! → 200"; what it buys is that nothing can be forgotten. Two hundred handlers
//! each remembering to log is two hundred chances to miss one, and the one
//! that gets missed is always the one somebody later needs.
//!
//! Handlers that want to say something richer can still write a row of their
//! own with a `payload`; the middleware's row is the floor, not the ceiling.

use crate::cloud::application::AppError;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

/// One line of history.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AuditEntry {
    /// Ordered, not just timestamped: two actions in the same millisecond
    /// still happened in an order, and a reader has to be able to see it.
    pub audit_id: i64,
    pub at: chrono::DateTime<chrono::Utc>,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub method: String,
    pub path: String,
    pub status: i16,
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// Room for what the shape of a path cannot say. Typed as `unknown` for the
    /// browser rather than `any`: a reader has to narrow it before using it,
    /// which is correct — its contents depend on which handler wrote the row.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub payload: Value,
}

/// What the middleware knows at the end of a request.
pub struct NewAudit<'a> {
    pub username: &'a str,
    pub display_name: &'a str,
    pub role: &'a str,
    pub method: &'a str,
    pub path: &'a str,
    pub status: i16,
    pub subject: Option<(String, String)>,
    pub payload: Value,
}

/// Write one line.
///
/// Takes the pool rather than a transaction: this is written *after* the
/// handler's own transaction has committed or rolled back, and it must not be
/// able to undo it. An audit row that vanished because the thing it recorded
/// failed would be the one row you most wanted to keep — "who tried" is the
/// question a refused action raises.
pub async fn record_audit(pool: &PgPool, entry: NewAudit<'_>) -> Result<i64, AppError> {
    let (subject_kind, subject_id) = match &entry.subject {
        Some((kind, id)) => (Some(kind.as_str()), Some(id.as_str())),
        None => (None, None),
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO audit_log
             (username, display_name, role, method, path, status,
              subject_kind, subject_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING audit_id",
    )
    .bind(entry.username)
    .bind(entry.display_name)
    .bind(entry.role)
    .bind(entry.method)
    .bind(entry.path)
    .bind(entry.status)
    .bind(subject_kind)
    .bind(subject_id)
    .bind(&entry.payload)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// One record's history, newest first — what a sheet shows.
///
/// Bounded rather than paged: a record with two thousand lines of history has
/// a different problem, and a sheet that scrolled forever would hide it.
pub async fn audit_for_subject(
    pool: &PgPool,
    subject_kind: &str,
    subject_id: &str,
    limit: i64,
) -> Result<Vec<AuditEntry>, AppError> {
    let rows = sqlx::query(
        "SELECT audit_id, at, username, display_name, role, method, path,
                status, subject_kind, subject_id, payload
           FROM audit_log
          WHERE subject_kind = $1 AND subject_id = $2
          ORDER BY at DESC, audit_id DESC
          LIMIT $3",
    )
    .bind(subject_kind)
    .bind(subject_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_entry).collect())
}

/// The whole feed, newest first. The System module's activity screen.
pub async fn recent_audit(
    pool: &PgPool,
    actor: Option<&str>,
    limit: i64,
) -> Result<Vec<AuditEntry>, AppError> {
    let rows = sqlx::query(
        "SELECT audit_id, at, username, display_name, role, method, path,
                status, subject_kind, subject_id, payload
           FROM audit_log
          WHERE ($1::text IS NULL OR username = $1)
          ORDER BY at DESC, audit_id DESC
          LIMIT $2",
    )
    .bind(actor)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(row_to_entry).collect())
}

fn row_to_entry(row: sqlx::postgres::PgRow) -> AuditEntry {
    AuditEntry {
        audit_id: row.get("audit_id"),
        at: row.get("at"),
        username: row.get("username"),
        display_name: row.get("display_name"),
        role: row.get("role"),
        method: row.get("method"),
        path: row.get("path"),
        status: row.get("status"),
        subject_kind: row.get("subject_kind"),
        subject_id: row.get("subject_id"),
        payload: row.get("payload"),
    }
}

/// Everybody signed in, for the broadcast notification.
///
/// Resolved at raise time like every other recipient list: somebody who joins
/// tomorrow should not inherit today's announcements, and somebody who leaves
/// should not have theirs deleted out from under an audit.
pub async fn every_active_user(pool: &PgPool) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT username FROM app_user WHERE active")
            .fetch_all(pool)
            .await?,
    )
}

/// Announce a completed action to everybody.
///
/// This is the console's "notify on every action" setting, and it is worth
/// being honest in a comment about what it costs: one row per user per action
/// in `notification_recipient`, and a queue that fills faster than anybody
/// clears it. `0046_notifications.sql` says it plainly — a notification for
/// everything that merely happened trains people to dismiss all of them.
///
/// It is implemented as its own `activity` kind rather than reusing the two
/// that name real work, precisely so that narrowing it later is a change to
/// one string and not an archaeology exercise.
pub async fn announce_activity(
    tx: &mut Transaction<'_, Postgres>,
    recipients: &[String],
    actor: &str,
    title: String,
    body: String,
    subject: Option<(&str, String)>,
) -> Result<(), AppError> {
    super::notifications::raise_notification(
        tx,
        super::notifications::NewNotification {
            kind: "activity",
            title,
            body,
            subject: subject.map(|(kind, id)| (kind, id)),
            origin_id: None,
            payload: json!({ "actor": actor }),
        },
        recipients,
    )
    .await?;
    Ok(())
}
