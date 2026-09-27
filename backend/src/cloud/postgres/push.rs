//! Where each person can be reached, and which pushes are still owed.
//!
//! The tables are 0462's; the sending is `cloud::push`. What lives here is
//! only the SQL, so the worker's rules read as rules rather than as queries.

use crate::cloud::application::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

/// One browser that agreed to be woken. What the browser gave us, and what a
/// person can recognise it by.
pub struct NewPushSubscription<'a> {
    pub endpoint: &'a str,
    pub p256dh: &'a str,
    pub auth: &'a str,
    pub device_label: Option<&'a str>,
    pub user_agent: Option<&'a str>,
}

/// What the subscriber is told back. Not the keys and not the endpoint: the
/// browser has those already, and a response is one more place to leak them.
#[derive(Clone, Debug, Serialize)]
pub struct PushSubscriptionReceipt {
    pub subscription_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub refreshed_at: DateTime<Utc>,
    /// How many browsers this person can now be woken on, this one included.
    pub devices: i64,
}

/// Register this browser for this person, or refresh it.
///
/// An upsert on the endpoint, and the endpoint moves with it: the same phone
/// signed in by a second colleague is the second colleague's phone now, and it
/// must stop being told the first one's work. The failure count starts again
/// because the browser has just proved it is alive.
pub async fn upsert_push_subscription(
    pool: &PgPool,
    username: &str,
    subscription: &NewPushSubscription<'_>,
) -> Result<PushSubscriptionReceipt, AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "INSERT INTO push_subscription
             (username, endpoint, p256dh, auth, device_label, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE SET
             username      = EXCLUDED.username,
             p256dh        = EXCLUDED.p256dh,
             auth          = EXCLUDED.auth,
             device_label  = EXCLUDED.device_label,
             user_agent    = EXCLUDED.user_agent,
             refreshed_at  = now(),
             failure_count = 0,
             last_error    = NULL
         RETURNING subscription_id, created_at, refreshed_at",
    )
    .bind(username)
    .bind(subscription.endpoint)
    .bind(subscription.p256dh)
    .bind(subscription.auth)
    .bind(subscription.device_label)
    .bind(subscription.user_agent)
    .fetch_one(&mut *tx)
    .await?;
    let subscription_id: Uuid = row.try_get("subscription_id")?;
    // A phone that changed hands must not be sent what was queued for the
    // previous person.
    sqlx::query("DELETE FROM push_delivery WHERE subscription_id = $1 AND username <> $2")
        .bind(subscription_id)
        .bind(username)
        .execute(&mut *tx)
        .await?;
    let devices: i64 =
        sqlx::query_scalar("SELECT count(*) FROM push_subscription WHERE username = $1")
            .bind(username)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok(PushSubscriptionReceipt {
        subscription_id,
        created_at: row.try_get("created_at")?,
        refreshed_at: row.try_get("refreshed_at")?,
        devices,
    })
}

/// Stop waking this browser for this person. Returns whether there was one.
///
/// Only the caller's own: an endpoint somebody else registered is not theirs
/// to switch off, and the answer is the same whether it exists or not, so it
/// cannot be used to ask whose it is.
pub async fn delete_push_subscription(
    pool: &PgPool,
    username: &str,
    endpoint: &str,
) -> Result<bool, AppError> {
    let deleted = sqlx::query("DELETE FROM push_subscription WHERE endpoint = $1 AND username = $2")
        .bind(endpoint)
        .bind(username)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(deleted > 0)
}

/// One delivery the worker has claimed, with everything needed to send it or
/// to decide not to.
#[derive(Clone, Debug)]
pub struct DuePushDelivery {
    pub delivery_id: i64,
    /// Including the attempt about to be made.
    pub attempts: i32,
    pub subscription_id: Uuid,
    pub failure_count: i32,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    /// The notification — or, for a chat message (0476), the conversation:
    /// it becomes the push's tag and topic, so a second message from one
    /// room replaces the first on the lock screen instead of stacking.
    pub notification_id: Uuid,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// The recipient has dealt with it already, somewhere else.
    pub read: bool,
    /// The person has not been deactivated. True for a username with no
    /// account row (`development` on a node with auth off).
    pub recipient_active: bool,
    /// The `notification_recipient` row still exists.
    pub still_a_recipient: bool,
}

/// Claim what is due, pushing each row's next attempt out by a lease.
///
/// `FOR UPDATE SKIP LOCKED`, so two cloud processes draining at once take
/// different rows; the lease, so a process that dies holding a row leaves it to
/// come due again in two minutes rather than never. The attempt is counted at
/// claim time for the same reason: a send that crashed the process was still
/// an attempt.
pub async fn claim_push_deliveries(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<DuePushDelivery>, AppError> {
    let rows = sqlx::query(
        "WITH claimed AS (
             UPDATE push_delivery d
                SET attempts = d.attempts + 1,
                    next_attempt_at = now() + interval '2 minutes'
              WHERE d.delivery_id IN (
                    SELECT delivery_id FROM push_delivery
                     WHERE next_attempt_at <= now()
                     ORDER BY next_attempt_at
                     LIMIT $1
                     FOR UPDATE SKIP LOCKED)
             RETURNING d.delivery_id, d.attempts, d.subscription_id, d.notification_id,
                       d.conversation_id, d.message_seq, d.username
         )
         -- Two kinds of delivery share the queue (0476): a notification, or a
         -- chat message. Each branch of every CASE below reads its own kind;
         -- the other kind's columns are NULL from their LEFT JOINs.
         --
         -- A chat message goes out as a notification-shaped push whose
         -- subject is the conversation, so the service worker lands it in
         -- the room with the table it already has, and whose id is the
         -- conversation's, so a second message replaces the first on the lock
         -- screen instead of stacking under it.
         SELECT c.delivery_id, c.attempts, c.subscription_id,
                COALESCE(c.notification_id, c.conversation_id) AS notification_id,
                s.endpoint, s.p256dh, s.auth, s.failure_count,
                CASE WHEN c.notification_id IS NOT NULL THEN n.kind
                     ELSE 'chat.message' END AS kind,
                CASE WHEN c.notification_id IS NOT NULL THEN n.title
                     WHEN room.kind = 'GROUP' THEN COALESCE(room.title, 'Chat')
                     ELSE COALESCE(NULLIF(btrim(author.display_name), ''), m.author_username, 'Chat')
                END AS title,
                CASE WHEN c.notification_id IS NOT NULL THEN n.body
                     ELSE (CASE WHEN room.kind = 'GROUP'
                                THEN COALESCE(NULLIF(btrim(author.display_name), ''), m.author_username, '') || ': '
                                ELSE '' END)
                          || (CASE WHEN btrim(COALESCE(m.body, '')) = '' THEN '📎 Attachment'
                                   ELSE m.body END)
                END AS body,
                CASE WHEN c.notification_id IS NOT NULL THEN n.subject_kind
                     ELSE 'conversation' END AS subject_kind,
                CASE WHEN c.notification_id IS NOT NULL THEN n.subject_id
                     ELSE c.conversation_id::text END AS subject_id,
                -- Read somewhere else already — or, for a message, taken back.
                CASE WHEN c.notification_id IS NOT NULL THEN (r.read_at IS NOT NULL)
                     ELSE (COALESCE(me.last_read_seq, 0) >= c.message_seq
                           OR m.deleted_at IS NOT NULL
                           OR m.seq IS NULL) END AS read,
                CASE WHEN c.notification_id IS NOT NULL THEN (r.username IS NOT NULL)
                     ELSE (me.username IS NOT NULL) END AS still_a_recipient,
                COALESCE(u.active, TRUE) AS recipient_active
           FROM claimed c
           JOIN push_subscription s ON s.subscription_id = c.subscription_id
           LEFT JOIN notification n ON n.notification_id = c.notification_id
           LEFT JOIN notification_recipient r
                  ON r.notification_id = c.notification_id AND r.username = c.username
           LEFT JOIN chat_message m
                  ON m.conversation_id = c.conversation_id AND m.seq = c.message_seq
           LEFT JOIN chat_conversation room ON room.conversation_id = c.conversation_id
           LEFT JOIN chat_participant me
                  ON me.conversation_id = c.conversation_id AND me.username = c.username
           LEFT JOIN app_user author ON author.username = m.author_username
           LEFT JOIN app_user u ON u.username = c.username",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(DuePushDelivery {
                delivery_id: row.try_get("delivery_id")?,
                attempts: row.try_get("attempts")?,
                subscription_id: row.try_get("subscription_id")?,
                failure_count: row.try_get("failure_count")?,
                endpoint: row.try_get("endpoint")?,
                p256dh: row.try_get("p256dh")?,
                auth: row.try_get("auth")?,
                notification_id: row.try_get("notification_id")?,
                kind: row.try_get("kind")?,
                title: row.try_get("title")?,
                body: row.try_get("body")?,
                subject_kind: row.try_get("subject_kind")?,
                subject_id: row.try_get("subject_id")?,
                read: row.try_get("read")?,
                still_a_recipient: row.try_get("still_a_recipient")?,
                recipient_active: row.try_get("recipient_active")?,
            })
        })
        .collect()
}

/// A reason short enough for the column, cut at a character.
fn short(reason: &str) -> String {
    reason.chars().take(300).collect()
}

/// Nothing more to do for this one.
pub async fn push_delivery_done(pool: &PgPool, delivery_id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM push_delivery WHERE delivery_id = $1")
        .bind(delivery_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// The push service has it: the delivery is done and the device is healthy.
pub async fn push_delivered(pool: &PgPool, delivery: &DuePushDelivery) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM push_delivery WHERE delivery_id = $1")
        .bind(delivery.delivery_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE push_subscription
            SET last_success_at = now(), failure_count = 0, last_error = NULL
          WHERE subscription_id = $1",
    )
    .bind(delivery.subscription_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The push service says this browser's subscription no longer exists (404,
/// 410): the person uninstalled, cleared site data, or revoked permission.
/// Anything still queued for it goes with it (`ON DELETE CASCADE`).
pub async fn push_subscription_gone(pool: &PgPool, subscription_id: Uuid) -> Result<(), AppError> {
    sqlx::query("DELETE FROM push_subscription WHERE subscription_id = $1")
        .bind(subscription_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Not this time; come due again after `wait`.
pub async fn push_delivery_retry(
    pool: &PgPool,
    delivery_id: i64,
    wait: Duration,
    reason: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE push_delivery
            SET next_attempt_at = now() + make_interval(secs => $2), last_error = $3
          WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .bind(wait.as_secs_f64())
    .bind(short(reason))
    .execute(pool)
    .await?;
    Ok(())
}

/// Given up on this message. The device's failure count goes up, and a device
/// that has now failed `drop_after` messages in a row is forgotten: whatever
/// status it chose to say it with, a phone that has refused ten messages is a
/// phone that is gone.
pub async fn push_delivery_failed(
    pool: &PgPool,
    delivery: &DuePushDelivery,
    reason: &str,
    drop_after: i32,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM push_delivery WHERE delivery_id = $1")
        .bind(delivery.delivery_id)
        .execute(&mut *tx)
        .await?;
    let failures: Option<i32> = sqlx::query_scalar(
        "UPDATE push_subscription
            SET failure_count = failure_count + 1, last_error = $2
          WHERE subscription_id = $1
         RETURNING failure_count",
    )
    .bind(delivery.subscription_id)
    .bind(short(reason))
    .fetch_optional(&mut *tx)
    .await?;
    if failures.is_some_and(|failures| failures >= drop_after) {
        sqlx::query("DELETE FROM push_subscription WHERE subscription_id = $1")
            .bind(delivery.subscription_id)
            .execute(&mut *tx)
            .await?;
        tracing::warn!(
            subscription = %delivery.subscription_id,
            failures = failures.unwrap_or_default(),
            "push subscription dropped after repeated failures"
        );
    }
    tx.commit().await?;
    Ok(())
}

/// Forget deliveries older than `ttl`. A notification a day old is on the
/// list; buzzing a phone about it now would be noise.
pub async fn prune_push_deliveries(pool: &PgPool, ttl: Duration) -> Result<u32, AppError> {
    let pruned = sqlx::query(
        "DELETE FROM push_delivery WHERE created_at < now() - make_interval(secs => $1)",
    )
    .bind(ttl.as_secs_f64())
    .execute(pool)
    .await?
    .rows_affected();
    Ok(u32::try_from(pruned).unwrap_or(u32::MAX))
}
