//! A vehicle's odometer over time (0975).
//!
//! # Where a reading comes from
//!
//! GA types one on its own, a fuel or parts receipt carries one, or a service
//! is recorded with the odometer at that visit. All three are rows of
//! `ga_odometer_reading`, so "48.210 km" on the car's sheet can say since when,
//! and a service due "at 50.000 km" is measured against the latest of them. A
//! reading written with a receipt belongs to the receipt: cancelling the
//! receipt takes the reading with it.
//!
//! # An odometer runs forward
//!
//! A reading lower than one taken before it, or higher than one taken after
//! it, is refused in words that name the reading it disagrees with. A typo is
//! corrected by removing the reading and typing it again; a reading that came
//! with a receipt goes with the receipt.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;

/// One reading, as the car's sheet lists it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaOdometerReading {
    pub reading_id: Uuid,
    pub asset_id: Uuid,
    pub read_on: NaiveDate,
    pub odometer_km: i32,
    /// `READING` (typed on its own), `EXPENSE` (with a receipt) or `SERVICE`
    /// (read when a scheduled service was done).
    pub source: String,
    pub expense_id: Option<Uuid>,
    pub inspection_id: Option<Uuid>,
    pub note: Option<String>,
    pub recorded_by: String,
}

/// Type a reading.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[cfg_attr(feature = "ts", ts(optional_fields = nullable))]
pub struct RecordGaOdometerReadingRequest {
    pub read_on: NaiveDate,
    pub odometer_km: i32,
    #[serde(default)]
    pub note: Option<String>,
}

/// The readings the sheet lists, newest first, and as many as it keeps.
const READING_LIMIT: i64 = 200;

fn to_reading(row: &sqlx::postgres::PgRow) -> Result<GaOdometerReading, AppError> {
    Ok(GaOdometerReading {
        reading_id: row.try_get("reading_id")?,
        asset_id: row.try_get("asset_id")?,
        read_on: row.try_get("read_on")?,
        odometer_km: row.try_get("odometer_km")?,
        source: row.try_get("source")?,
        expense_id: row.try_get("expense_id")?,
        inspection_id: row.try_get("inspection_id")?,
        note: row.try_get("note")?,
        recorded_by: row.try_get("recorded_by")?,
    })
}

/// A vehicle's readings, newest first.
pub async fn ga_odometer_readings(
    pool: &PgPool,
    asset_id: Uuid,
) -> Result<Vec<GaOdometerReading>, AppError> {
    let rows = sqlx::query(
        "SELECT reading_id, asset_id, read_on, odometer_km, source, expense_id,
                inspection_id, note, recorded_by
           FROM ga_odometer_reading
          WHERE asset_id = $1
          ORDER BY read_on DESC, odometer_km DESC, recorded_at DESC
          LIMIT $2",
    )
    .bind(asset_id)
    .bind(READING_LIMIT)
    .fetch_all(pool)
    .await?;
    rows.iter().map(to_reading).collect()
}

/// The highest reading a vehicle has, which is the latest one: the readings
/// run forward.
pub async fn ga_odometer_latest(
    executor: impl sqlx::PgExecutor<'_>,
    asset_id: Uuid,
) -> Result<Option<i32>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT max(odometer_km) FROM ga_odometer_reading WHERE asset_id = $1")
            .bind(asset_id)
            .fetch_one(executor)
            .await?,
    )
}

/// Whether the asset is a vehicle — the only thing with an odometer.
pub(super) async fn asset_is_vehicle(
    executor: impl sqlx::PgExecutor<'_>,
    asset_id: Uuid,
) -> Result<bool, AppError> {
    let build: Option<String> = sqlx::query_scalar(
        "SELECT c.build FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
          WHERE a.asset_id = $1",
    )
    .bind(asset_id)
    .fetch_optional(executor)
    .await?;
    match build {
        None => Err(AppError::NotFound("asset".into())),
        Some(build) => Ok(build == "VEHICLE"),
    }
}

/// Write one reading inside the caller's transaction, after checking it runs
/// forward against the readings before and after its day.
///
/// The asset's readings are serialised by an advisory lock on the asset, so two
/// receipts typed at once cannot each pass the check against the other's
/// absence.
#[allow(clippy::too_many_arguments)]
pub(super) async fn write_odometer_reading(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    asset_id: Uuid,
    read_on: NaiveDate,
    odometer_km: i32,
    source: &str,
    expense_id: Option<Uuid>,
    inspection_id: Option<Uuid>,
    note: Option<&str>,
    actor: &str,
) -> Result<Uuid, AppError> {
    if odometer_km < 0 {
        return Err(AppError::Validation(
            "an odometer reading is a distance; it cannot be negative".into(),
        ));
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('ga_odometer:' || $1::text))")
        .bind(asset_id)
        .execute(&mut **tx)
        .await?;
    let bounds = sqlx::query(
        "SELECT (SELECT r.odometer_km FROM ga_odometer_reading r
                  WHERE r.asset_id = $1 AND r.read_on <= $2
                  ORDER BY r.odometer_km DESC LIMIT 1) AS before_km,
                (SELECT r.read_on FROM ga_odometer_reading r
                  WHERE r.asset_id = $1 AND r.read_on <= $2
                  ORDER BY r.odometer_km DESC LIMIT 1) AS before_on,
                (SELECT r.odometer_km FROM ga_odometer_reading r
                  WHERE r.asset_id = $1 AND r.read_on > $2
                  ORDER BY r.odometer_km ASC LIMIT 1) AS after_km,
                (SELECT r.read_on FROM ga_odometer_reading r
                  WHERE r.asset_id = $1 AND r.read_on > $2
                  ORDER BY r.odometer_km ASC LIMIT 1) AS after_on",
    )
    .bind(asset_id)
    .bind(read_on)
    .fetch_one(&mut **tx)
    .await?;
    let before_km: Option<i32> = bounds.try_get("before_km")?;
    let before_on: Option<NaiveDate> = bounds.try_get("before_on")?;
    let after_km: Option<i32> = bounds.try_get("after_km")?;
    let after_on: Option<NaiveDate> = bounds.try_get("after_on")?;
    if let (Some(km), Some(on)) = (before_km, before_on) {
        if odometer_km < km {
            return Err(AppError::Validation(format!(
                "the odometer read {} km on {}; {} km on {} would run it backwards",
                km_thousands(km),
                on.format("%d-%m-%Y"),
                km_thousands(odometer_km),
                read_on.format("%d-%m-%Y")
            )));
        }
    }
    if let (Some(km), Some(on)) = (after_km, after_on) {
        if odometer_km > km {
            return Err(AppError::Validation(format!(
                "the odometer read {} km later, on {}; {} km on {} is more than that",
                km_thousands(km),
                on.format("%d-%m-%Y"),
                km_thousands(odometer_km),
                read_on.format("%d-%m-%Y")
            )));
        }
    }
    let reading_id: Uuid = sqlx::query_scalar(
        "INSERT INTO ga_odometer_reading
           (asset_id, read_on, odometer_km, source, expense_id, inspection_id, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING reading_id",
    )
    .bind(asset_id)
    .bind(read_on)
    .bind(odometer_km)
    .bind(source)
    .bind(expense_id)
    .bind(inspection_id)
    .bind(note.map(str::trim).filter(|text| !text.is_empty()))
    .bind(actor)
    .fetch_one(&mut **tx)
    .await?;
    Ok(reading_id)
}

/// Type a reading for a vehicle.
///
/// Not in the future: a reading is something somebody looked at.
pub async fn ga_odometer_record(
    pool: &PgPool,
    asset_id: Uuid,
    request: &RecordGaOdometerReadingRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<Vec<GaOdometerReading>, AppError> {
    if !asset_is_vehicle(pool, asset_id).await? {
        return Err(AppError::Validation(
            "only a vehicle has an odometer; this asset is not one".into(),
        ));
    }
    if request.read_on > today {
        return Err(AppError::Validation(
            "a reading is what somebody saw; it cannot be dated after today".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    write_odometer_reading(
        &mut tx,
        asset_id,
        request.read_on,
        request.odometer_km,
        "READING",
        None,
        None,
        request.note.as_deref(),
        actor,
    )
    .await?;
    tx.commit().await?;
    ga_odometer_readings(pool, asset_id).await
}

/// Remove a reading typed by mistake. One that came with a receipt goes with
/// the receipt (cancel the expense), never on its own.
pub async fn ga_odometer_remove(
    pool: &PgPool,
    reading_id: Uuid,
) -> Result<Vec<GaOdometerReading>, AppError> {
    let row = sqlx::query("SELECT asset_id, source FROM ga_odometer_reading WHERE reading_id = $1")
        .bind(reading_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("odometer reading".into()))?;
    let asset_id: Uuid = row.try_get("asset_id")?;
    let source: String = row.try_get("source")?;
    if source == "EXPENSE" {
        return Err(AppError::Conflict(
            "this reading came with a receipt; cancel the expense and the reading goes with it"
                .into(),
        ));
    }
    sqlx::query("DELETE FROM ga_odometer_reading WHERE reading_id = $1")
        .bind(reading_id)
        .execute(pool)
        .await?;
    ga_odometer_readings(pool, asset_id).await
}

/// The asset a reading belongs to, for the access check of a removal.
pub async fn ga_odometer_reading_asset(pool: &PgPool, reading_id: Uuid) -> Result<Uuid, AppError> {
    sqlx::query_scalar("SELECT asset_id FROM ga_odometer_reading WHERE reading_id = $1")
        .bind(reading_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("odometer reading".into()))
}

/// "48.210" — the way a refusal writes a distance, with the dot the client
/// writes thousands with.
pub(super) fn km_thousands(value: i32) -> String {
    let digits = value.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push('.');
        }
        out.push(digit);
    }
    if value < 0 {
        format!("-{out}")
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::km_thousands;

    #[test]
    fn a_distance_is_written_with_dots_for_thousands() {
        assert_eq!(km_thousands(0), "0");
        assert_eq!(km_thousands(950), "950");
        assert_eq!(km_thousands(48_210), "48.210");
        assert_eq!(km_thousands(1_250_000), "1.250.000");
    }
}
