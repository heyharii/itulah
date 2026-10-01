//! Attendance settings (0807): the employee app's punch rules, the units'
//! geofences, and the absence deduction rule.

use crate::cloud::application::AppError;
use crate::cloud::domain::Authorization;
use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{PgPool, Row};

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MobileAttendanceSetting {
    /// May the employee app record a punch at all.
    pub mobile_enabled: bool,
    /// Must a phone punch say where the phone was.
    pub require_location: bool,
    /// Is a phone punch outside its unit's fence refused. Units with no fence
    /// are not fenced.
    pub require_geofence: bool,
}

pub async fn mobile_setting(pool: &PgPool) -> Result<MobileAttendanceSetting, AppError> {
    let row = sqlx::query(
        "SELECT mobile_enabled, require_location, require_geofence
           FROM attendance_mobile_setting",
    )
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some(row) => MobileAttendanceSetting {
            mobile_enabled: row.try_get("mobile_enabled")?,
            require_location: row.try_get("require_location")?,
            require_geofence: row.try_get("require_geofence")?,
        },
        None => MobileAttendanceSetting {
            mobile_enabled: true,
            require_location: false,
            require_geofence: false,
        },
    })
}

pub async fn save_mobile_setting(
    pool: &PgPool,
    setting: &MobileAttendanceSetting,
    updated: &Authorization,
) -> Result<(), AppError> {
    if setting.require_geofence && !setting.require_location {
        return Err(AppError::Validation(
            "a fence can only be checked when the punch carries a location".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO attendance_mobile_setting
             (singleton, mobile_enabled, require_location, require_geofence, updated, updated_at)
         VALUES (true, $1, $2, $3, $4, now())
         ON CONFLICT (singleton) DO UPDATE
            SET mobile_enabled = EXCLUDED.mobile_enabled,
                require_location = EXCLUDED.require_location,
                require_geofence = EXCLUDED.require_geofence,
                updated = EXCLUDED.updated, updated_at = now()",
    )
    .bind(setting.mobile_enabled)
    .bind(setting.require_location)
    .bind(setting.require_geofence)
    .bind(serde_json::to_value(updated)?)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GeofenceView {
    pub unit_id: String,
    pub latitude: f64,
    pub longitude: f64,
    pub radius_m: i32,
}

pub async fn geofences(pool: &PgPool) -> Result<Vec<GeofenceView>, AppError> {
    let rows = sqlx::query(
        "SELECT unit_id, latitude, longitude, radius_m FROM unit_geofence ORDER BY unit_id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(GeofenceView {
                unit_id: row.try_get("unit_id")?,
                latitude: row.try_get("latitude")?,
                longitude: row.try_get("longitude")?,
                radius_m: row.try_get("radius_m")?,
            })
        })
        .collect()
}

pub async fn geofence_of(pool: &PgPool, unit_id: &str) -> Result<Option<GeofenceView>, AppError> {
    Ok(geofences(pool).await?.into_iter().find(|fence| fence.unit_id == unit_id))
}

pub async fn set_geofence(
    pool: &PgPool,
    unit_id: &str,
    latitude: f64,
    longitude: f64,
    radius_m: i32,
    set_by: &Authorization,
) -> Result<(), AppError> {
    if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
        return Err(AppError::Validation("that point is not on the earth".into()));
    }
    if !(10..=5000).contains(&radius_m) {
        return Err(AppError::Validation("a radius is 10 to 5,000 metres".into()));
    }
    sqlx::query(
        "INSERT INTO unit_geofence (unit_id, latitude, longitude, radius_m, set_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (unit_id) DO UPDATE
            SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
                radius_m = EXCLUDED.radius_m, set_by = EXCLUDED.set_by, set_at = now()",
    )
    .bind(unit_id)
    .bind(latitude)
    .bind(longitude)
    .bind(radius_m)
    .bind(serde_json::to_value(set_by)?)
    .execute(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.is_foreign_key_violation() => {
            AppError::Validation(format!("{unit_id} is not a unit"))
        }
        _ => AppError::from(error),
    })?;
    Ok(())
}

pub async fn remove_geofence(pool: &PgPool, unit_id: &str) -> Result<(), AppError> {
    let gone = sqlx::query("DELETE FROM unit_geofence WHERE unit_id = $1")
        .bind(unit_id)
        .execute(pool)
        .await?;
    if gone.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("a fence for {unit_id}")));
    }
    Ok(())
}

/// Metres between two points on the earth, by the haversine formula.
pub fn distance_m(a: (f64, f64), b: (f64, f64)) -> f64 {
    const EARTH_RADIUS_M: f64 = 6_371_000.0;
    let (lat1, lon1) = (a.0.to_radians(), a.1.to_radians());
    let (lat2, lon2) = (b.0.to_radians(), b.1.to_radians());
    let h = ((lat2 - lat1) / 2.0).sin().powi(2)
        + lat1.cos() * lat2.cos() * ((lon2 - lon1) / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * h.sqrt().asin()
}

/// Keep where a phone punch was, and how far from its fence.
pub async fn locate_punch(
    pool: &PgPool,
    punch_id: &str,
    latitude: f64,
    longitude: f64,
    distance: Option<i32>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE attendance_punch SET latitude = $2, longitude = $3, distance_m = $4
          WHERE id = $1",
    )
    .bind(punch_id)
    .bind(latitude)
    .bind(longitude)
    .bind(distance)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AbsenceRuleView {
    pub effective_from: NaiveDate,
    pub enabled: bool,
    /// `BASE` or `WAGE` (base plus fixed allowances).
    pub basis: String,
    /// `null`: the month's calendar days.
    pub divisor_days: Option<i32>,
    pub ratified_by: String,
    pub reason: String,
}

pub async fn absence_rules(pool: &PgPool) -> Result<Vec<AbsenceRuleView>, AppError> {
    let rows = sqlx::query(
        "SELECT effective_from, enabled, basis, divisor_days,
                ratified->>'actor' AS ratified_by, ratified->>'reason' AS reason
           FROM absence_deduction_rule ORDER BY effective_from DESC",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(AbsenceRuleView {
                effective_from: row.try_get("effective_from")?,
                enabled: row.try_get("enabled")?,
                basis: row.try_get("basis")?,
                divisor_days: row.try_get("divisor_days")?,
                ratified_by: row.try_get::<Option<String>, _>("ratified_by")?.unwrap_or_default(),
                reason: row.try_get::<Option<String>, _>("reason")?.unwrap_or_default(),
            })
        })
        .collect()
}

/// State the absence rule from a date. Forward only: a month already paid
/// keeps the rule it was paid under.
pub async fn state_absence_rule(
    pool: &PgPool,
    effective_from: NaiveDate,
    enabled: bool,
    basis: &str,
    divisor_days: Option<i32>,
    ratified: &Authorization,
) -> Result<(), AppError> {
    let basis = basis.trim().to_ascii_uppercase();
    if basis != "BASE" && basis != "WAGE" {
        return Err(AppError::Validation("an absence is a share of the BASE or the WAGE".into()));
    }
    if divisor_days.is_some_and(|d| !(1..=31).contains(&d)) {
        return Err(AppError::Validation("a divisor is 1 to 31 days".into()));
    }
    let paid: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM payroll_run
                         WHERE state <> 'DRAFT' AND period + interval '1 month' > $1)",
    )
    .bind(effective_from)
    .fetch_one(pool)
    .await?;
    if paid {
        return Err(AppError::Conflict(format!(
            "a run covering {effective_from} has already been sent; state the rule from a later month"
        )));
    }
    sqlx::query(
        "INSERT INTO absence_deduction_rule (effective_from, enabled, basis, divisor_days, ratified)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (effective_from) DO UPDATE
            SET enabled = EXCLUDED.enabled, basis = EXCLUDED.basis,
                divisor_days = EXCLUDED.divisor_days, ratified = EXCLUDED.ratified",
    )
    .bind(effective_from)
    .bind(enabled)
    .bind(&basis)
    .bind(divisor_days)
    .bind(serde_json::to_value(ratified)?)
    .execute(pool)
    .await?;
    Ok(())
}

/// How long the first tier of a rest day's overtime runs (0808): 420 minutes
/// on a six-day week, 480 on a five-day week (300 for the short day).
pub async fn overtime_tier_minutes(pool: &PgPool) -> Result<i32, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT COALESCE((SELECT rest_day_first_tier_minutes FROM overtime_tier_rule), 420)",
    )
    .fetch_one(pool)
    .await?)
}

pub async fn set_overtime_tier_minutes(
    pool: &PgPool,
    minutes: i32,
    updated: &Authorization,
) -> Result<(), AppError> {
    if ![300, 420, 480].contains(&minutes) {
        return Err(AppError::Validation(
            "the first tier is 7 hours (six-day week), 8 (five-day week) or 5 (the short day)".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO overtime_tier_rule (singleton, rest_day_first_tier_minutes, updated, updated_at)
         VALUES (true, $1, $2, now())
         ON CONFLICT (singleton) DO UPDATE
            SET rest_day_first_tier_minutes = EXCLUDED.rest_day_first_tier_minutes,
                updated = EXCLUDED.updated, updated_at = now()",
    )
    .bind(minutes)
    .bind(serde_json::to_value(updated)?)
    .execute(pool)
    .await?;
    Ok(())
}
