//! Units of measure, and what each is worth in another.
//!
//! Stock is kept in pieces. A supplier quotes by the LUSIN (twelve) or the
//! KODI (twenty), and a buyer ordering in either should not have to do the
//! arithmetic in their head — 0394 gives the company a list of the units it
//! uses and a table of how many of one unit another is worth, and this module
//! gives them a door.
//!
//! Two small masters behind one read, because a screen never wants one without
//! the other: a picker offering LUSIN is useless without the twelve.
//!
//! # What this module refuses to decide
//!
//! What a quantity column means. Every quantity the system stores is still a
//! piece; converting is the screen's job before it sends, and the helper the
//! hub uses for it reads this table rather than a constant.
//!
//! There is no delete for either: a unit that was used on a document is part
//! of what that document said. It is retired (`active = false`) instead.

use super::{begin_idempotent, complete_idempotent, NullablePatch};
use crate::cloud::application::AppError;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use std::str::FromStr;
use uuid::Uuid;

/// One unit the company counts or orders in.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitOfMeasure {
    /// Upper case, what a quantity is printed with: "PCS", "LUSIN".
    pub code: String,
    pub label: String,
    /// The unit stock is kept in. At most one, held by the database.
    pub is_base: bool,
    /// Hidden from pickers when false, still readable everywhere it was used.
    pub active: bool,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
}

/// "One `from_unit` is `factor` `to_unit`" — one LUSIN is 12 PCS.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitConversion {
    pub conversion_id: Uuid,
    /// "Satuan lain": the unit being described.
    pub from_unit: String,
    /// "Satuan utama": the unit it is described in.
    pub to_unit: String,
    /// "Nilai konversi", as a decimal string ("12", "0.5"). A string rather
    /// than a number for the reason every money figure here is one: the
    /// column is `numeric`, and a float would round it on the way.
    pub factor: String,
    /// "Keterangan".
    pub note: Option<String>,
    pub active: bool,
    pub version: i32,
}

/// Everything a unit picker or the master screen needs, in one read.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnitsBook {
    /// The base unit first, then by code. Retired ones included: the master
    /// screen has to be able to find them again, and a picker filters.
    pub units: Vec<UnitOfMeasure>,
    pub conversions: Vec<UnitConversion>,
}

/// A new unit.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateUnitRequest {
    /// Trimmed and upper-cased before it is judged; letters, digits and `_`,
    /// at most sixteen.
    pub code: String,
    pub label: String,
    /// True takes the base flag from whichever unit holds it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_base: Option<bool>,
}

/// Relabel a unit, make it the base, retire it or bring it back.
///
/// The code is never among the fields: it is what conversions (and, later,
/// document lines) hold.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateUnitRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub label: Option<String>,
    /// Only `true` is an act: the base moves to this unit. Unmarking the base
    /// without naming another would leave stock with no unit, and is refused.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_base: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub active: Option<bool>,
}

/// A new conversion between two units.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateUnitConversionRequest {
    pub from_unit: String,
    pub to_unit: String,
    /// A positive decimal string, at most four places. A comma is read as the
    /// decimal point, because that is how it is typed here.
    pub factor: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: Option<String>,
}

/// Correct a conversion's factor or note, retire it or bring it back.
///
/// The two units are not among the fields: a conversion that changed which
/// units it joins is a different conversion, and is written as one.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateUnitConversionRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub factor: Option<String>,
    // Absent leaves it alone, `null` clears it, a string sets it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub note: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub active: Option<bool>,
}

const UNIT_COLUMNS: &str = "code, label, is_base, active, version";
const CONVERSION_COLUMNS: &str = "conversion_id, from_unit, to_unit, factor, note, active, version";

fn unit_from_row(row: &PgRow) -> Result<UnitOfMeasure, AppError> {
    Ok(UnitOfMeasure {
        code: row.try_get("code")?,
        label: row.try_get("label")?,
        is_base: row.try_get("is_base")?,
        active: row.try_get("active")?,
        version: row.try_get("version")?,
    })
}

fn conversion_from_row(row: &PgRow) -> Result<UnitConversion, AppError> {
    let factor: Decimal = row.try_get("factor")?;
    Ok(UnitConversion {
        conversion_id: row.try_get("conversion_id")?,
        from_unit: row.try_get("from_unit")?,
        to_unit: row.try_get("to_unit")?,
        // "12", not "12.0000": the column's scale is storage, not meaning.
        factor: factor.normalize().to_string(),
        note: row.try_get("note")?,
        active: row.try_get("active")?,
        version: row.try_get("version")?,
    })
}

/// "lusin", " Lusin " and "LUSIN" are one unit.
fn normalize_code(value: &str) -> Result<String, AppError> {
    let code = value.trim().to_ascii_uppercase();
    if code.is_empty() {
        return Err(AppError::Validation("unit code cannot be blank".into()));
    }
    if code.len() > 16
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(AppError::Validation(format!(
            "'{code}' is not a unit code: use letters, digits or '_', at most 16"
        )));
    }
    Ok(code)
}

fn normalize_label(value: &str) -> Result<String, AppError> {
    let label = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if label.is_empty() {
        return Err(AppError::Validation("unit label cannot be blank".into()));
    }
    Ok(label)
}

/// A positive decimal with at most four places, as the column holds it.
fn parse_factor(value: &str) -> Result<Decimal, AppError> {
    let text = value.trim().replace(',', ".");
    let factor = Decimal::from_str(&text)
        .map_err(|_| AppError::Validation(format!("'{}' is not a number", value.trim())))?;
    if factor <= Decimal::ZERO {
        return Err(AppError::Validation(
            "a conversion value must be greater than zero".into(),
        ));
    }
    if factor.normalize().scale() > 4 {
        return Err(AppError::Validation(
            "a conversion value has at most four decimal places".into(),
        ));
    }
    if factor >= Decimal::from(100_000_000) {
        return Err(AppError::Validation(
            "a conversion value must be below 100,000,000".into(),
        ));
    }
    Ok(factor)
}

fn optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|one| !one.is_empty())
        .map(str::to_owned)
}

fn map_unit_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") if database.message().contains("one_base") => {
                AppError::Conflict("another unit became the base at the same time".to_owned())
            }
            Some("23505") => AppError::Conflict("a unit with that code already exists".to_owned()),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn map_conversion_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => {
                AppError::Conflict("a conversion between those two units already exists".to_owned())
            }
            Some("23503") => AppError::Validation("unknown unit".to_owned()),
            Some("23514") if database.message().contains("not_itself") => {
                AppError::Validation("a unit cannot convert to itself".to_owned())
            }
            Some("22003") => AppError::Validation("that conversion value is too large".to_owned()),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn require_positive(expected_version: i32) -> Result<(), AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    Ok(())
}

/// Every unit and every conversion, retired ones included.
pub async fn units_book(pool: &PgPool) -> Result<UnitsBook, AppError> {
    let units = sqlx::query(&format!(
        "SELECT {UNIT_COLUMNS} FROM unit_of_measure ORDER BY is_base DESC, code"
    ))
    .fetch_all(pool)
    .await?;
    let conversions = sqlx::query(&format!(
        "SELECT {CONVERSION_COLUMNS} FROM unit_conversion ORDER BY from_unit, to_unit"
    ))
    .fetch_all(pool)
    .await?;
    Ok(UnitsBook {
        units: units.iter().map(unit_from_row).collect::<Result<_, _>>()?,
        conversions: conversions
            .iter()
            .map(conversion_from_row)
            .collect::<Result<_, _>>()?,
    })
}

/// Add a unit.
pub async fn create_unit(
    pool: &PgPool,
    request: CreateUnitRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<UnitOfMeasure, AppError> {
    let code = normalize_code(&request.code)?;
    let label = normalize_label(&request.label)?;
    let is_base = request.is_base.unwrap_or(false);

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "unit_of_measure.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    // Taking the base flag from whoever holds it, inside the transaction, so
    // two requests arriving together cannot both win — the index would refuse
    // the second anyway, with a less useful message.
    if is_base {
        sqlx::query(
            "UPDATE unit_of_measure
                SET is_base = false, version = version + 1,
                    updated_by = $1, updated_at = now()
              WHERE is_base",
        )
        .bind(actor)
        .execute(&mut *transaction)
        .await?;
    }

    let row = sqlx::query(&format!(
        "INSERT INTO unit_of_measure (code, label, is_base, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         RETURNING {UNIT_COLUMNS}"
    ))
    .bind(&code)
    .bind(&label)
    .bind(is_base)
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_unit_error)?;
    let unit = unit_from_row(&row)?;

    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&unit)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(unit)
}

/// Relabel a unit, make it the base, retire it or bring it back.
pub async fn update_unit(
    pool: &PgPool,
    code: &str,
    expected_version: i32,
    request: UpdateUnitRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<UnitOfMeasure, AppError> {
    require_positive(expected_version)?;
    let code = normalize_code(code)?;
    let label = request.label.as_deref().map(normalize_label).transpose()?;
    if label.is_none() && request.is_base.is_none() && request.active.is_none() {
        return Err(AppError::Validation(
            "Unit update must contain at least one field".into(),
        ));
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "unit_of_measure.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let current = sqlx::query(
        "SELECT is_base, active, version FROM unit_of_measure WHERE code = $1 FOR UPDATE",
    )
    .bind(&code)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Unit".to_owned()))?;
    let was_base: bool = current.try_get("is_base")?;
    let was_active: bool = current.try_get("active")?;
    let actual_version: i32 = current.try_get("version")?;
    if actual_version != expected_version {
        return Err(AppError::Conflict(format!(
            "Unit has moved on: If-Match said {expected_version}, it is now {actual_version}"
        )));
    }

    let will_be_base = request.is_base.unwrap_or(was_base);
    let will_be_active = request.active.unwrap_or(was_active);
    if was_base && !will_be_base {
        return Err(AppError::Validation(
            "stock is kept in the base unit: make another unit the base instead".into(),
        ));
    }
    if will_be_base && !will_be_active {
        return Err(AppError::Validation(
            "the base unit cannot be retired: make another unit the base first".into(),
        ));
    }

    if will_be_base && !was_base {
        sqlx::query(
            "UPDATE unit_of_measure
                SET is_base = false, version = version + 1,
                    updated_by = $2, updated_at = now()
              WHERE is_base AND code <> $1",
        )
        .bind(&code)
        .bind(actor)
        .execute(&mut *transaction)
        .await?;
    }

    let row = sqlx::query(&format!(
        "UPDATE unit_of_measure
            SET label      = COALESCE($2, label),
                is_base    = $3,
                active     = $4,
                version    = version + 1,
                updated_by = $5,
                updated_at = now()
          WHERE code = $1
          RETURNING {UNIT_COLUMNS}"
    ))
    .bind(&code)
    .bind(&label)
    .bind(will_be_base)
    .bind(will_be_active)
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_unit_error)?;
    let unit = unit_from_row(&row)?;

    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&unit)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(unit)
}

/// Say how many of one unit another is worth.
pub async fn create_unit_conversion(
    pool: &PgPool,
    request: CreateUnitConversionRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<UnitConversion, AppError> {
    let from_unit = normalize_code(&request.from_unit)?;
    let to_unit = normalize_code(&request.to_unit)?;
    // Said here as well as by the CHECK, because a sentence beats an SQLSTATE.
    if from_unit == to_unit {
        return Err(AppError::Validation(
            "a unit cannot convert to itself".into(),
        ));
    }
    let factor = parse_factor(&request.factor)?;
    let note = optional(request.note.as_deref());

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "unit_conversion.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let row = sqlx::query(&format!(
        "INSERT INTO unit_conversion
             (conversion_id, from_unit, to_unit, factor, note, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING {CONVERSION_COLUMNS}"
    ))
    .bind(Uuid::new_v4())
    .bind(&from_unit)
    .bind(&to_unit)
    .bind(factor)
    .bind(&note)
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_conversion_error)?;
    let conversion = conversion_from_row(&row)?;

    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&conversion)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(conversion)
}

/// Correct a conversion's factor or note, retire it or bring it back.
pub async fn update_unit_conversion(
    pool: &PgPool,
    conversion_id: Uuid,
    expected_version: i32,
    request: UpdateUnitConversionRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<UnitConversion, AppError> {
    require_positive(expected_version)?;
    let factor = request.factor.as_deref().map(parse_factor).transpose()?;
    let changes_note = !matches!(request.note, NullablePatch::Missing);
    if factor.is_none() && !changes_note && request.active.is_none() {
        return Err(AppError::Validation(
            "Unit conversion update must contain at least one field".into(),
        ));
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "unit_conversion.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let actual_version: i32 = sqlx::query_scalar(
        "SELECT version FROM unit_conversion WHERE conversion_id = $1 FOR UPDATE",
    )
    .bind(conversion_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Unit conversion".to_owned()))?;
    if actual_version != expected_version {
        return Err(AppError::Conflict(format!(
            "Unit conversion has moved on: If-Match said {expected_version}, it is now \
             {actual_version}"
        )));
    }

    let row = sqlx::query(&format!(
        "UPDATE unit_conversion
            SET factor     = COALESCE($2, factor),
                note       = CASE WHEN $3 THEN $4 ELSE note END,
                active     = COALESCE($5, active),
                version    = version + 1,
                updated_by = $6,
                updated_at = now()
          WHERE conversion_id = $1
          RETURNING {CONVERSION_COLUMNS}"
    ))
    .bind(conversion_id)
    .bind(factor)
    .bind(changes_note)
    .bind(match &request.note {
        NullablePatch::Value(value) => optional(Some(value.as_str())),
        _ => None,
    })
    .bind(request.active)
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_conversion_error)?;
    let conversion = conversion_from_row(&row)?;

    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&conversion)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(conversion)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_is_read_in_upper_case() {
        assert_eq!(normalize_code(" lusin ").ok().as_deref(), Some("LUSIN"));
        assert!(normalize_code("").is_err());
        assert!(normalize_code("two words").is_err());
    }

    #[test]
    fn a_factor_is_positive_with_at_most_four_places() {
        assert_eq!(
            parse_factor("12")
                .ok()
                .map(|value| value.normalize().to_string()),
            Some("12".to_owned())
        );
        assert_eq!(
            parse_factor("0,5")
                .ok()
                .map(|value| value.normalize().to_string()),
            Some("0.5".to_owned())
        );
        assert!(parse_factor("0").is_err());
        assert!(parse_factor("-3").is_err());
        assert!(parse_factor("1.23456").is_err());
        assert!(parse_factor("dozen").is_err());
    }
}
