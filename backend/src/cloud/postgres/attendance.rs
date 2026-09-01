//! The attendance policy schedule, as rows.
//!
//! The whole schedule is loaded and validated together rather than one version
//! at a time, because the rules that matter are rules *between* versions: no
//! overlaps, nothing after an open-ended one. A loader that returned a single
//! row could not check either, and the first thing anybody would do with it is
//! assume the row it found was the one in force.

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    AttendancePolicy, Authorization, Minutes, PolicyId, PolicyLimits, PolicySchedule, PolicyVersion,
};
use chrono::NaiveDate;
use sqlx::{PgPool, Row};

/// A stored row that cannot be true. See `postgres::employment` for why this is
/// not a validation error.
fn corrupt(what: &str, detail: String) -> AppError {
    AppError::Configuration(format!(
        "stored {what} does not hydrate: {detail}. The rows disagree with the rules they encode."
    ))
}

fn decode(row: &sqlx::postgres::PgRow) -> Result<AttendancePolicy, AppError> {
    let policy_id: String = row.try_get("policy_id")?;
    let version: i32 = row.try_get("version")?;
    let minutes = |column: &str| -> Result<Minutes, AppError> {
        let raw: i32 = row.try_get(column)?;
        u32::try_from(raw)
            .map(Minutes::new)
            .map_err(|_| corrupt(column, format!("{raw} is not a minute count")))
    };

    AttendancePolicy::try_new(
        PolicyId::try_new(&policy_id).map_err(|error| corrupt("policy id", error.to_string()))?,
        u32::try_from(version)
            .map_err(|_| corrupt("policy version", format!("{version} is not a version")))
            .and_then(|version| {
                PolicyVersion::try_new(version)
                    .map_err(|error| corrupt("policy version", error.to_string()))
            })?,
        row.try_get::<NaiveDate, _>("effective_from")?,
        row.try_get::<Option<NaiveDate>, _>("effective_to")?,
        PolicyLimits {
            late_grace: minutes("late_grace_minutes")?,
            early_leave_grace: minutes("early_leave_grace_minutes")?,
            overtime_minimum: minutes("overtime_minimum_minutes")?,
            duplicate_punch_window: minutes("duplicate_punch_window_mins")?,
        },
    )
    .map_err(|error| corrupt("attendance policy", error.to_string()))
}

/// The whole schedule, or `None` when nobody has written one.
///
/// `None` is a real answer and not an empty schedule: the domain refuses an
/// empty [`PolicySchedule`] outright, because "a schedule with no versions" and
/// "no schedule" would otherwise both mean the same silence, and only one of
/// them is a state an operator can be in.
pub async fn load_attendance_policy(pool: &PgPool) -> Result<Option<PolicySchedule>, AppError> {
    let rows = sqlx::query(
        "SELECT version, policy_id, effective_from, effective_to,
                late_grace_minutes, early_leave_grace_minutes,
                overtime_minimum_minutes, duplicate_punch_window_mins
           FROM attendance_policy
          ORDER BY effective_from, version",
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(None);
    }
    let versions = rows
        .iter()
        .map(decode)
        .collect::<Result<Vec<AttendancePolicy>, AppError>>()?;
    // Building the schedule is where the between-version rules fire: a stored
    // pair that overlaps, or a version written after an open-ended one, fails
    // here rather than being served as the rules.
    PolicySchedule::try_new(versions)
        .map(Some)
        .map_err(|error| corrupt("attendance policy schedule", error.to_string()))
}

/// The next version number, so a caller never has to guess one.
pub async fn next_policy_version(pool: &PgPool) -> Result<u32, AppError> {
    let highest: Option<i32> = sqlx::query_scalar("SELECT max(version) FROM attendance_policy")
        .fetch_one(pool)
        .await?;
    Ok(u32::try_from(highest.unwrap_or(0)).unwrap_or(0) + 1)
}

/// Append a new version, closing the one it supersedes.
///
/// Both writes are one transaction, and that is the point: a new version added
/// without closing the open one leaves two open-ended versions, which the
/// domain refuses to load. Committing them separately would give a window in
/// which the schedule on disk cannot be read back at all.
pub async fn append_policy_version(
    pool: &PgPool,
    policy: &AttendancePolicy,
    authorization: &Authorization,
) -> Result<(), AppError> {
    let authorized = serde_json::to_value(authorization)?;
    let limits = policy.limits();
    let mut tx = pool.begin().await?;

    // The day before the newcomer starts. An open version that would otherwise
    // run past it is closed here rather than left to overlap.
    let closes_on = policy.effective_from().pred_opt().ok_or_else(|| {
        AppError::Validation("a policy cannot start on the first representable date".to_owned())
    })?;
    sqlx::query(
        "UPDATE attendance_policy
            SET effective_to = $1
          WHERE effective_to IS NULL AND effective_from < $2",
    )
    .bind(closes_on)
    .bind(policy.effective_from())
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO attendance_policy
            (version, policy_id, effective_from, effective_to,
             late_grace_minutes, early_leave_grace_minutes,
             overtime_minimum_minutes, duplicate_punch_window_mins, authorized)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(i32::try_from(policy.version().get()).unwrap_or(i32::MAX))
    .bind(policy.id().as_str())
    .bind(policy.effective_from())
    .bind(policy.effective_to())
    .bind(i32::try_from(limits.late_grace.get()).unwrap_or(i32::MAX))
    .bind(i32::try_from(limits.early_leave_grace.get()).unwrap_or(i32::MAX))
    .bind(i32::try_from(limits.overtime_minimum.get()).unwrap_or(i32::MAX))
    .bind(i32::try_from(limits.duplicate_punch_window.get()).unwrap_or(i32::MAX))
    .bind(&authorized)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
