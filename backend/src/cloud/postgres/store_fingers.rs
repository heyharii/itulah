//! A finger recorded at a store's POS, waiting for head office (owner, 24 Oct
//! 2026; postgres 0994).
//!
//! The store head records her own finger at the POS after signing in with her
//! password, then the people head office added. Her server sends each one here
//! with its next ask for fingers ([`take_pos_fingers`]); it waits on the
//! store's People tab in the hub, where head office approves it — it becomes
//! the person's template, and every server they sign in at takes it
//! (`pos_fingers_for_origin`) — or refuses it, and the bytes are dropped.
//! A finger the head records for somebody else she approves herself: it is
//! approved here on arrival, under her name, and head office can withdraw it
//! from the person's Fingerprints like any other.
//! An approved finger is the person's everywhere: every POS of their store,
//! attendance, and the next store if they are moved.

use super::enrolment::seal;
use crate::cloud::application::AppError;
use crate::cloud::domain::{actions, Authorization, EnrolmentKind, Finger, TemplateFormat};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One finger as a store's server sends it.
#[derive(Debug, Deserialize)]
pub struct PosFingerSubmission {
    /// The server's own id for it, so a resend is the same finger.
    pub submission_id: Uuid,
    pub username: String,
    /// `RIGHT_INDEX`, `LEFT_THUMB`, ...
    pub finger: String,
    pub template_base64: String,
    #[serde(default)]
    pub reader_kind: Option<String>,
    #[serde(default)]
    pub quality: Option<i64>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    /// Somebody else's finger, which the store head approved by recording
    /// it (owner, 24 Oct 2026: the head or head office approves). It is the
    /// person's at once; head office can still withdraw it.
    #[serde(default)]
    pub approved_by_head: bool,
}

/// Head office's word on one finger, as the server reads it.
#[derive(Debug, Serialize)]
pub struct PosFingerAnswer {
    pub submission_id: Uuid,
    /// `PENDING`, `APPROVED` or `REFUSED`.
    pub status: &'static str,
    pub reason: Option<String>,
}

fn refused(submission_id: Uuid, reason: &str) -> PosFingerAnswer {
    PosFingerAnswer {
        submission_id,
        status: "REFUSED",
        reason: Some(reason.to_string()),
    }
}

/// Take what a store's server sent, and answer where each one stands. A
/// finger already here is answered from its row; a new one is sealed and
/// waits, replacing a finger of the same person still waiting.
pub async fn take_pos_fingers(
    pool: &PgPool,
    origin_id: &str,
    submissions: Vec<PosFingerSubmission>,
) -> Result<Vec<PosFingerAnswer>, AppError> {
    use base64::Engine as _;
    let mut answers = Vec::with_capacity(submissions.len());
    for submission in submissions {
        let id = submission.submission_id;
        let known: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT status, reason FROM fingerprint_submission WHERE id = $1")
                .bind(id)
                .fetch_optional(pool)
                .await?;
        if let Some((status, reason)) = known {
            answers.push(match status.as_str() {
                "PENDING" => PosFingerAnswer {
                    submission_id: id,
                    status: "PENDING",
                    reason: None,
                },
                "APPROVED" => PosFingerAnswer {
                    submission_id: id,
                    status: "APPROVED",
                    reason: None,
                },
                "REPLACED" => refused(id, "Recorded again"),
                _ => PosFingerAnswer {
                    submission_id: id,
                    status: "REFUSED",
                    reason,
                },
            });
            continue;
        }
        let Ok(finger) = Finger::parse(submission.finger.trim()) else {
            answers.push(refused(id, "Not a finger head office knows"));
            continue;
        };
        let Ok(plaintext) =
            base64::engine::general_purpose::STANDARD.decode(submission.template_base64.trim())
        else {
            answers.push(refused(id, "The template could not be read"));
            continue;
        };
        if plaintext.is_empty() {
            answers.push(refused(id, "The template is empty"));
            continue;
        }
        // Whose: somebody this server signs in, employed today.
        let employee: Option<String> = sqlx::query_scalar(
            "SELECT e.id
               FROM edge_identity_assignment a
               JOIN app_user u ON u.id = a.user_id AND u.active
               JOIN employee e ON e.id = u.employee_id AND e.status = 'ACTIVE'
              WHERE a.origin_id = $1 AND a.active AND lower(u.username) = lower($2)
              LIMIT 1",
        )
        .bind(origin_id)
        .bind(submission.username.trim())
        .fetch_optional(pool)
        .await?;
        let Some(employee_id) = employee else {
            answers.push(refused(id, "Not one of this store's people"));
            continue;
        };
        // Who: the store's head, signed in at this server.
        let head: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                 SELECT 1 FROM edge_identity_assignment a
                   JOIN app_user u ON u.id = a.user_id AND u.active
                  WHERE a.origin_id = $1 AND a.active
                    AND a.edge_role IN ('SUPERVISOR', 'ADMIN')
                    AND lower(u.username) = lower($2))",
        )
        .bind(origin_id)
        .bind(submission.recorded_by.trim())
        .fetch_one(pool)
        .await?;
        if !head {
            answers.push(refused(
                id,
                "Recorded by somebody who is not this store's head",
            ));
            continue;
        }
        let format = TemplateFormat::ZkfingerV10;
        let sealed = seal(&plaintext, &employee_id, finger, format)?;
        drop(plaintext);
        let quality = submission
            .quality
            .filter(|quality| (0..=100).contains(quality))
            .and_then(|quality| i16::try_from(quality).ok());

        let mut tx = pool.begin().await?;
        sqlx::query(
            "UPDATE fingerprint_submission
                SET status = 'REPLACED', decided_at = now(), decided_by = 'store',
                    reason = 'Recorded again', sealed = NULL, nonce = NULL, key_id = NULL
              WHERE employee_id = $1 AND finger = $2 AND status = 'PENDING'",
        )
        .bind(&employee_id)
        .bind(finger.code())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO fingerprint_submission
                (id, origin_id, employee_id, username, finger, sealed, nonce, key_id, format,
                 quality, recorded_by, recorded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(origin_id)
        .bind(&employee_id)
        .bind(submission.username.trim())
        .bind(finger.code())
        .bind(sealed.sealed())
        .bind(sealed.nonce())
        .bind(sealed.key_id())
        .bind(format.code())
        .bind(quality)
        .bind(submission.recorded_by.trim())
        .bind(submission.recorded_at)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        // The store head approved it by recording it: it becomes the
        // person's now, under her name, and head office sees who said yes.
        if submission.approved_by_head {
            let unit: Option<String> = sqlx::query_scalar(
                "SELECT s.unit_id FROM sync_origin_credential o
                   JOIN site s ON s.id = o.site_id
                  WHERE o.origin_id = $1",
            )
            .bind(origin_id)
            .fetch_optional(pool)
            .await?;
            if let Some(unit) = unit {
                decide_store_finger(pool, &unit, id, true, None, submission.recorded_by.trim())
                    .await?;
                answers.push(PosFingerAnswer {
                    submission_id: id,
                    status: "APPROVED",
                    reason: None,
                });
                continue;
            }
        }
        answers.push(PosFingerAnswer {
            submission_id: id,
            status: "PENDING",
            reason: None,
        });
    }
    Ok(answers)
}

/// A finger waiting on the store's People tab.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreFingerWaiting {
    pub submission_id: Uuid,
    pub employee_id: String,
    pub username: String,
    /// The person's full name.
    pub name: String,
    /// `RIGHT_INDEX`, `LEFT_THUMB`, ...
    pub finger: String,
    pub quality: Option<i32>,
    /// The store head who recorded it, by full name.
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    /// The person already has this finger: approving replaces it.
    pub replaces: bool,
}

/// One person who signs in at the store, with their approved fingers.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreFingerPerson {
    pub user_id: Uuid,
    pub username: String,
    pub employee_id: Option<String>,
    pub name: String,
    /// The job role's name (`Cashier`, `Store manager`).
    pub role: String,
    /// Their approved fingers, `RIGHT_INDEX` and so on.
    pub fingers: Vec<String>,
    /// How many of their fingers wait for head office.
    pub waiting: i32,
    /// The POS they have a drawer open at now.
    pub on_shift: Option<String>,
    /// The last shift opened or closed, or sale rung, at this store.
    pub last_active_at: Option<DateTime<Utc>>,
    /// Head office stopped them on the POS.
    pub stopped: bool,
}

/// `GET /api/v1/stores/{unit}/fingers`: the store's People tab.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreFingers {
    pub waiting: Vec<StoreFingerWaiting>,
    pub people: Vec<StoreFingerPerson>,
    /// Whether the caller may approve and refuse here — an Admin at head
    /// office.
    pub can_decide: bool,
}

/// `POST /api/v1/stores/{unit}/fingers/{submission_id}/refuse`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RefuseFingerRequest {
    /// Shown at the store's POS beside the finger.
    #[serde(default)]
    pub reason: Option<String>,
}

/// The store's People tab: the fingers waiting, oldest first, and everybody
/// its servers sign in, store heads first.
pub async fn store_fingers(
    pool: &PgPool,
    unit_id: &str,
    can_decide: bool,
) -> Result<StoreFingers, AppError> {
    let waiting = sqlx::query(
        "SELECT f.id, f.employee_id, f.username, f.finger, f.quality, f.recorded_at,
                COALESCE(NULLIF(btrim(u.display_name), ''), f.username) AS name,
                COALESCE(NULLIF(btrim(h.display_name), ''), f.recorded_by) AS recorded_by,
                EXISTS (SELECT 1 FROM fingerprint_template t
                         WHERE t.employee_id = f.employee_id AND t.finger = f.finger) AS replaces
           FROM fingerprint_submission f
           JOIN sync_origin_credential o ON o.origin_id = f.origin_id
           JOIN site s ON s.id = o.site_id
           LEFT JOIN app_user u ON lower(u.username) = lower(f.username)
           LEFT JOIN app_user h ON lower(h.username) = lower(f.recorded_by)
          WHERE s.unit_id = $1 AND f.status = 'PENDING'
          ORDER BY f.recorded_at",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| -> Result<StoreFingerWaiting, AppError> {
        Ok(StoreFingerWaiting {
            submission_id: row.try_get("id")?,
            employee_id: row.try_get("employee_id")?,
            username: row.try_get("username")?,
            name: row.try_get("name")?,
            finger: row.try_get("finger")?,
            quality: row.try_get::<Option<i16>, _>("quality")?.map(i32::from),
            recorded_by: row.try_get("recorded_by")?,
            recorded_at: row.try_get("recorded_at")?,
            replaces: row.try_get("replaces")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let people = sqlx::query(
        "WITH people AS (
             SELECT a.user_id, bool_or(a.edge_role IN ('SUPERVISOR', 'ADMIN')) AS head
               FROM site s
               JOIN sync_origin_credential o ON o.site_id = s.id
               JOIN edge_identity_assignment a ON a.origin_id = o.origin_id
              WHERE s.unit_id = $1 AND a.active
              GROUP BY a.user_id
         )
         SELECT u.id, u.username, u.employee_id,
                COALESCE(NULLIF(btrim(u.display_name), ''), u.username) AS name,
                COALESCE(r.name, initcap(lower(u.role))) AS role_name,
                COALESCE((SELECT array_agg(t.finger ORDER BY t.finger)
                            FROM fingerprint_template t
                           WHERE t.employee_id = u.employee_id), '{}'::text[]) AS fingers,
                (SELECT count(*) FROM fingerprint_submission f
                  WHERE f.employee_id = u.employee_id AND f.status = 'PENDING')::int AS waiting,
                (SELECT CASE WHEN c.terminal_id ~ '^KASIR-[0-9]+$'
                             THEN 'Kasir ' || substring(c.terminal_id FROM 7)
                             ELSE COALESCE((SELECT d.label FROM device d
                                             WHERE d.device_id = c.terminal_id), c.terminal_id) END
                   FROM cash_shift c JOIN site s ON s.id = c.site_id
                  WHERE s.unit_id = $1 AND c.opened_by = u.username AND c.status = 'OPEN'
                  ORDER BY c.opened_at DESC LIMIT 1) AS on_shift,
                (SELECT max(x.at) FROM (
                     SELECT max(c.opened_at) AS at FROM cash_shift c JOIN site s ON s.id = c.site_id
                      WHERE s.unit_id = $1 AND c.opened_by = u.username
                     UNION ALL
                     SELECT max(c.closed_at) FROM cash_shift c JOIN site s ON s.id = c.site_id
                      WHERE s.unit_id = $1 AND c.closed_by = u.username
                     UNION ALL
                     SELECT max(e.occurred_at) FROM edge_sale e JOIN site s ON s.id = e.site_id
                      WHERE s.unit_id = $1 AND e.actor_id = u.username) x) AS last_active_at,
                u.till_stopped_at IS NOT NULL AS stopped
           FROM people p
           JOIN app_user u ON u.id = p.user_id AND u.active
           LEFT JOIN job_role r ON r.code = u.role_code
          ORDER BY p.head DESC, name",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| -> Result<StoreFingerPerson, AppError> {
        Ok(StoreFingerPerson {
            user_id: row.try_get("id")?,
            username: row.try_get("username")?,
            employee_id: row.try_get("employee_id")?,
            name: row.try_get("name")?,
            role: row.try_get("role_name")?,
            fingers: row.try_get("fingers")?,
            waiting: row.try_get("waiting")?,
            on_shift: row.try_get("on_shift")?,
            last_active_at: row.try_get("last_active_at")?,
            stopped: row.try_get("stopped")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(StoreFingers {
        waiting,
        people,
        can_decide,
    })
}

/// Approve or refuse one finger waiting at the store.
pub async fn decide_store_finger(
    pool: &PgPool,
    unit_id: &str,
    submission_id: Uuid,
    approve: bool,
    reason: Option<&str>,
    actor: &str,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        "SELECT f.employee_id, f.finger, f.sealed, f.nonce, f.key_id, f.format, f.quality,
                f.origin_id, f.recorded_by, f.status, e.status AS employment,
                un.name AS store
           FROM fingerprint_submission f
           JOIN sync_origin_credential o ON o.origin_id = f.origin_id
           JOIN site s ON s.id = o.site_id
           JOIN unit un ON un.id = s.unit_id
           JOIN employee e ON e.id = f.employee_id
          WHERE f.id = $1 AND s.unit_id = $2
            FOR UPDATE OF f",
    )
    .bind(submission_id)
    .bind(unit_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("finger {submission_id} at {unit_id}")))?;
    let status: String = row.try_get("status")?;
    if status != "PENDING" {
        return Err(AppError::Conflict(format!(
            "that finger is already {}",
            status.to_ascii_lowercase()
        )));
    }

    if !approve {
        let reason = reason
            .map(str::trim)
            .filter(|reason| !reason.is_empty())
            .map(|reason| reason.chars().take(300).collect::<String>());
        sqlx::query(
            "UPDATE fingerprint_submission
                SET status = 'REFUSED', decided_by = $2, decided_at = now(), reason = $3,
                    sealed = NULL, nonce = NULL, key_id = NULL
              WHERE id = $1",
        )
        .bind(submission_id)
        .bind(actor)
        .bind(reason)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(());
    }

    let employment: String = row.try_get("employment")?;
    if employment != "ACTIVE" {
        return Err(AppError::Conflict(
            "this person is no longer employed; refuse the finger instead".into(),
        ));
    }
    let employee_id: String = row.try_get("employee_id")?;
    let finger_code: String = row.try_get("finger")?;
    let finger = Finger::parse(&finger_code)
        .map_err(|error| AppError::Conflict(format!("a waiting finger is unreadable: {error}")))?;
    let origin_id: String = row.try_get("origin_id")?;
    let recorded_by: String = row.try_get("recorded_by")?;
    let store: String = row.try_get("store")?;
    let authorization = Authorization::try_new(
        actor,
        actions::FINGERPRINT_ENROL,
        Utc::now(),
        &format!("Recorded at {store}'s POS by {recorded_by}"),
    )
    .map_err(|error| AppError::Validation(error.to_string()))?;
    let enrolled = serde_json::to_value(&authorization)?;

    let previous: Option<i32> = sqlx::query_scalar(
        "SELECT revision FROM fingerprint_template
          WHERE employee_id = $1 AND finger = $2 FOR UPDATE",
    )
    .bind(&employee_id)
    .bind(finger.code())
    .fetch_optional(&mut *tx)
    .await?;
    let revision = previous.unwrap_or(0).saturating_add(1);
    let kind = if previous.is_some() {
        EnrolmentKind::Replaced
    } else {
        EnrolmentKind::Enrolled
    };
    // The seal binds the person and the finger, not the row, so the bytes
    // move from the submission to the template unopened.
    sqlx::query(
        "INSERT INTO fingerprint_template
            (employee_id, finger, sealed, nonce, key_id, format, quality,
             terminal_id, origin_id, enrolled, revision)
         SELECT employee_id, finger, sealed, nonce, key_id, format, quality,
                NULL, origin_id, $2, $3
           FROM fingerprint_submission WHERE id = $1
         ON CONFLICT (employee_id, finger) DO UPDATE
            SET sealed = excluded.sealed,
                nonce = excluded.nonce,
                key_id = excluded.key_id,
                format = excluded.format,
                quality = excluded.quality,
                terminal_id = NULL,
                origin_id = excluded.origin_id,
                enrolled = excluded.enrolled,
                revision = excluded.revision,
                updated_at = now()",
    )
    .bind(submission_id)
    .bind(&enrolled)
    .bind(revision)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO fingerprint_enrolment_event
            (employee_id, finger, kind, terminal_id, origin_id, authorized)
         VALUES ($1, $2, $3, NULL, $4, $5)",
    )
    .bind(&employee_id)
    .bind(finger.code())
    .bind(kind.code())
    .bind(&origin_id)
    .bind(&enrolled)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE fingerprint_submission
            SET status = 'APPROVED', decided_by = $2, decided_at = now(),
                sealed = NULL, nonce = NULL, key_id = NULL
          WHERE id = $1",
    )
    .bind(submission_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Approve every finger waiting at the store. Answers how many.
pub async fn approve_all_store_fingers(
    pool: &PgPool,
    unit_id: &str,
    actor: &str,
) -> Result<usize, AppError> {
    let waiting: Vec<Uuid> = sqlx::query_scalar(
        "SELECT f.id
           FROM fingerprint_submission f
           JOIN sync_origin_credential o ON o.origin_id = f.origin_id
           JOIN site s ON s.id = o.site_id
           JOIN employee e ON e.id = f.employee_id AND e.status = 'ACTIVE'
          WHERE s.unit_id = $1 AND f.status = 'PENDING'
          ORDER BY f.recorded_at",
    )
    .bind(unit_id)
    .fetch_all(pool)
    .await?;
    let mut approved = 0;
    for submission_id in waiting {
        match decide_store_finger(pool, unit_id, submission_id, true, None, actor).await {
            Ok(()) => approved += 1,
            // Decided by somebody else meanwhile.
            Err(AppError::Conflict(_)) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(approved)
}

// ── one person at the store: what they did, where, and whether they may ──

/// The drawer a person has open at the store now.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePersonShift {
    /// `Kasir 1`, as the POS is named.
    pub pos: String,
    pub opened_at: DateTime<Utc>,
}

/// A POS a person worked at, in the last 30 days.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePersonDevice {
    pub pos: String,
    pub last_used_at: DateTime<Utc>,
    pub shifts: i64,
}

/// One line of a person's recent activity at the store.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePersonEvent {
    pub at: DateTime<Utc>,
    /// `SHIFT_OPENED`, `SHIFT_CLOSED` or `SALES` (one line per day).
    pub kind: String,
    pub pos: Option<String>,
    /// How many sales, for `SALES`.
    pub count: Option<i64>,
    /// Their total, for `SALES`; the drawer's difference, for `SHIFT_CLOSED`.
    pub amount_minor: Option<i64>,
}

/// `GET /api/v1/stores/{unit}/people/{user_id}`: one person at the store.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StorePersonActivity {
    pub user_id: Uuid,
    pub username: String,
    pub employee_id: Option<String>,
    pub name: String,
    pub role: String,
    /// Head office's stop on the POS, at every store.
    pub stop: Option<super::PosStopNote>,
    /// Approved fingers, `RIGHT_INDEX` and so on.
    pub fingers: Vec<String>,
    /// Fingers waiting for head office.
    pub waiting: i32,
    pub on_shift: Option<StorePersonShift>,
    /// The last shift opened or closed, or sale rung, here.
    pub last_active_at: Option<DateTime<Utc>>,
    /// Sales rung today, on the store's own calendar, and their total.
    pub sales_today: i64,
    pub takings_today_minor: i64,
    pub devices: Vec<StorePersonDevice>,
    /// The last 30 lines, newest first, over 14 days.
    pub recent: Vec<StorePersonEvent>,
    /// Whether the caller may stop and resume this person here.
    pub can_manage: bool,
}

/// How a shift names its POS: a seat `KASIR-n` is `Kasir n`; a POS from
/// before seats is named by the register.
const POS_NAME: &str = "CASE WHEN c.terminal_id ~ '^KASIR-[0-9]+$'
                            THEN 'Kasir ' || substring(c.terminal_id FROM 7)
                            ELSE COALESCE((SELECT d.label FROM device d
                                            WHERE d.device_id = c.terminal_id),
                                          c.terminal_id) END";

/// One person who signs in at the store: their shifts, sales and POS here,
/// their fingers, and head office's stop.
pub async fn store_person_activity(
    pool: &PgPool,
    unit_id: &str,
    user_id: Uuid,
    can_manage: bool,
) -> Result<StorePersonActivity, AppError> {
    let person = sqlx::query(
        "SELECT u.id, u.username, u.employee_id,
                COALESCE(NULLIF(btrim(u.display_name), ''), u.username) AS name,
                COALESCE(r.name, initcap(lower(u.role))) AS role_name,
                u.till_stopped_at, u.till_stopped_by, u.till_stopped_reason,
                COALESCE((SELECT array_agg(t.finger ORDER BY t.finger)
                            FROM fingerprint_template t
                           WHERE t.employee_id = u.employee_id), '{}'::text[]) AS fingers,
                (SELECT count(*) FROM fingerprint_submission f
                  WHERE f.employee_id = u.employee_id AND f.status = 'PENDING')::int AS waiting
           FROM app_user u
           LEFT JOIN job_role r ON r.code = u.role_code
          WHERE u.id = $2
            AND EXISTS (SELECT 1 FROM site s
                          JOIN sync_origin_credential o ON o.site_id = s.id
                          JOIN edge_identity_assignment a ON a.origin_id = o.origin_id
                         WHERE s.unit_id = $1 AND a.user_id = u.id)",
    )
    .bind(unit_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("{user_id} does not sign in at {unit_id}")))?;
    let username: String = person.try_get("username")?;
    let stop = match (
        person.try_get::<Option<DateTime<Utc>>, _>("till_stopped_at")?,
        person.try_get::<Option<String>, _>("till_stopped_by")?,
        person.try_get::<Option<String>, _>("till_stopped_reason")?,
    ) {
        (Some(at), Some(by), Some(reason)) => Some(super::PosStopNote { at, by, reason }),
        _ => None,
    };

    let on_shift = sqlx::query(&format!(
        "SELECT {POS_NAME} AS pos, c.opened_at
           FROM cash_shift c JOIN site s ON s.id = c.site_id
          WHERE s.unit_id = $1 AND c.opened_by = $2 AND c.status = 'OPEN'
          ORDER BY c.opened_at DESC LIMIT 1"
    ))
    .bind(unit_id)
    .bind(&username)
    .fetch_optional(pool)
    .await?
    .map(|row| -> Result<StorePersonShift, AppError> {
        Ok(StorePersonShift {
            pos: row.try_get("pos")?,
            opened_at: row.try_get("opened_at")?,
        })
    })
    .transpose()?;

    let today = sqlx::query(
        "SELECT count(*)::bigint AS sales, COALESCE(sum(e.total_minor), 0)::bigint AS takings,
                (SELECT max(x.at) FROM (
                     SELECT max(c.opened_at) AS at FROM cash_shift c JOIN site s ON s.id = c.site_id
                      WHERE s.unit_id = $1 AND c.opened_by = $2
                     UNION ALL
                     SELECT max(c.closed_at) FROM cash_shift c JOIN site s ON s.id = c.site_id
                      WHERE s.unit_id = $1 AND c.closed_by = $2
                     UNION ALL
                     SELECT max(e2.occurred_at) FROM edge_sale e2 JOIN site s ON s.id = e2.site_id
                      WHERE s.unit_id = $1 AND e2.actor_id = $2) x) AS last_active_at
           FROM edge_sale e JOIN site s ON s.id = e.site_id
          WHERE s.unit_id = $1 AND e.actor_id = $2
            AND (e.occurred_at AT TIME ZONE unit_business_timezone($1))::date
                = (now() AT TIME ZONE unit_business_timezone($1))::date",
    )
    .bind(unit_id)
    .bind(&username)
    .fetch_one(pool)
    .await?;

    let devices = sqlx::query(&format!(
        "SELECT {POS_NAME} AS pos, max(c.opened_at) AS last_used_at, count(*)::bigint AS shifts
           FROM cash_shift c JOIN site s ON s.id = c.site_id
          WHERE s.unit_id = $1 AND c.opened_by = $2 AND c.opened_at > now() - interval '30 days'
          GROUP BY 1 ORDER BY 2 DESC"
    ))
    .bind(unit_id)
    .bind(&username)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| -> Result<StorePersonDevice, AppError> {
        Ok(StorePersonDevice {
            pos: row.try_get("pos")?,
            last_used_at: row.try_get("last_used_at")?,
            shifts: row.try_get("shifts")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    let recent = sqlx::query(&format!(
        "SELECT at, kind, pos, count, amount_minor FROM (
             SELECT c.opened_at AS at, 'SHIFT_OPENED' AS kind, {POS_NAME} AS pos,
                    NULL::bigint AS count, NULL::bigint AS amount_minor
               FROM cash_shift c JOIN site s ON s.id = c.site_id
              WHERE s.unit_id = $1 AND c.opened_by = $2
                AND c.opened_at > now() - interval '14 days'
             UNION ALL
             SELECT c.closed_at, 'SHIFT_CLOSED', {POS_NAME}, NULL, c.variance_minor
               FROM cash_shift c JOIN site s ON s.id = c.site_id
              WHERE s.unit_id = $1 AND c.closed_by = $2
                AND c.closed_at > now() - interval '14 days'
             UNION ALL
             SELECT max(e.occurred_at), 'SALES', NULL, count(*)::bigint, sum(e.total_minor)::bigint
               FROM edge_sale e JOIN site s ON s.id = e.site_id
              WHERE s.unit_id = $1 AND e.actor_id = $2
                AND e.occurred_at > now() - interval '14 days'
              GROUP BY (e.occurred_at AT TIME ZONE unit_business_timezone($1))::date
         ) lines
         ORDER BY at DESC LIMIT 30"
    ))
    .bind(unit_id)
    .bind(&username)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| -> Result<StorePersonEvent, AppError> {
        Ok(StorePersonEvent {
            at: row.try_get("at")?,
            kind: row.try_get("kind")?,
            pos: row.try_get("pos")?,
            count: row.try_get("count")?,
            amount_minor: row.try_get("amount_minor")?,
        })
    })
    .collect::<Result<Vec<_>, AppError>>()?;

    Ok(StorePersonActivity {
        user_id: person.try_get("id")?,
        username,
        employee_id: person.try_get("employee_id")?,
        name: person.try_get("name")?,
        role: person.try_get("role_name")?,
        stop,
        fingers: person.try_get("fingers")?,
        waiting: person.try_get("waiting")?,
        on_shift,
        last_active_at: today.try_get("last_active_at")?,
        sales_today: today.try_get("sales")?,
        takings_today_minor: today.try_get("takings")?,
        devices,
        recent,
        can_manage,
    })
}
