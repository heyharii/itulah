//! Units of measure, and what each is worth in another.
//!
//! Stock is kept in pieces. A supplier quotes by the LUSIN (twelve) or the
//! KODI (twenty), and a buyer ordering in either should not have to do the
//! arithmetic in their head — 0394 gives the company a list of the units it
//! uses and a table of how many of one unit another is worth, and this module
//! gives them a door. A conversion is global (0652): one LUSIN is twelve
//! pieces of every item, conversions chain, and a unit carries the other
//! spellings a supplier prints for it.
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
use crate::cloud::domain::uom::{spelling, UnitLookup, UNIT_CATEGORIES};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
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
    /// COUNT, MASS, VOLUME, LENGTH or AREA (ERPNext's UOM Category). A
    /// conversion only joins two units of one category.
    pub category: String,
    /// ERPNext's "Must be Whole Number": a quantity in this unit is whole.
    /// Only a whole unit can be an article's stock unit, because the ledger
    /// counts in whole numbers.
    pub whole_number: bool,
    /// Other spellings that mean this unit on a supplier's paper — "lsn",
    /// "dz" — lower case. The code itself always matches and is not listed.
    pub aliases: Vec<String>,
    /// Pieces in one, walking the conversions ("12" for LUSIN, "1" for the
    /// base). Null when no conversion reaches the base unit.
    pub pieces: Option<String>,
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
    /// COUNT when absent.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub category: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub whole_number: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "Array<string> | null"))]
    pub aliases: Option<Vec<String>>,
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
    /// Present replaces the unit's aliases; an empty list removes them.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "Array<string> | null"))]
    pub aliases: Option<Vec<String>>,
    /// Refused while any conversion joins the unit: those were written for
    /// the kind it was.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub category: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub whole_number: Option<bool>,
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

const UNIT_COLUMNS: &str = "code, label, is_base, active, category, whole_number, version,
     ARRAY(SELECT a.alias FROM unit_alias a
            WHERE a.unit_code = unit_of_measure.code ORDER BY a.alias) AS aliases,
     trim_scale(unit_pieces_per(code))::text AS pieces";
const CONVERSION_COLUMNS: &str = "conversion_id, from_unit, to_unit, factor, note, active, version";

fn unit_from_row(row: &PgRow) -> Result<UnitOfMeasure, AppError> {
    Ok(UnitOfMeasure {
        code: row.try_get("code")?,
        label: row.try_get("label")?,
        is_base: row.try_get("is_base")?,
        active: row.try_get("active")?,
        category: row.try_get("category")?,
        whole_number: row.try_get("whole_number")?,
        aliases: row.try_get("aliases")?,
        pieces: row.try_get("pieces")?,
        version: row.try_get("version")?,
    })
}

/// One unit as it stands inside a transaction, aliases and all.
async fn read_unit(
    transaction: &mut Transaction<'_, Postgres>,
    code: &str,
) -> Result<UnitOfMeasure, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {UNIT_COLUMNS} FROM unit_of_measure WHERE code = $1"
    ))
    .bind(code)
    .fetch_one(&mut **transaction)
    .await?;
    unit_from_row(&row)
}

/// Replace a unit's aliases. A spelling that is the unit's own code is
/// dropped as redundant; one another unit already owns is refused by name.
async fn replace_aliases(
    transaction: &mut Transaction<'_, Postgres>,
    code: &str,
    aliases: &[String],
    actor: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM unit_alias WHERE unit_code = $1")
        .bind(code)
        .execute(&mut **transaction)
        .await?;
    let own = spelling(code);
    let mut seen = std::collections::BTreeSet::new();
    for alias in aliases.iter().map(|one| spelling(one)) {
        if alias.is_empty() || alias == own || !seen.insert(alias.clone()) {
            continue;
        }
        let taken: Option<String> = sqlx::query_scalar(
            "SELECT code FROM unit_of_measure WHERE lower(code) = $1
             UNION ALL
             SELECT unit_code FROM unit_alias WHERE alias = $1
             LIMIT 1",
        )
        .bind(&alias)
        .fetch_optional(&mut **transaction)
        .await?;
        if let Some(taken) = taken {
            return Err(AppError::Conflict(format!(
                "'{alias}' already means {taken}"
            )));
        }
        sqlx::query("INSERT INTO unit_alias (alias, unit_code, created_by) VALUES ($1, $2, $3)")
            .bind(&alias)
            .bind(code)
            .bind(actor)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
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

fn normalize_category(value: &str) -> Result<String, AppError> {
    let category = value.trim().to_ascii_uppercase();
    if UNIT_CATEGORIES.contains(&category.as_str()) {
        Ok(category)
    } else {
        Err(AppError::Validation(format!(
            "'{}' is not a kind of unit: use {}",
            value.trim(),
            UNIT_CATEGORIES.join(", ")
        )))
    }
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
    let category = request
        .category
        .as_deref()
        .map(normalize_category)
        .transpose()?
        .unwrap_or_else(|| "COUNT".to_owned());
    // The base is what stock is counted in, so it is whole whatever was sent.
    let whole_number = is_base || request.whole_number.unwrap_or(false);

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

    sqlx::query(
        "INSERT INTO unit_of_measure
             (code, label, is_base, category, whole_number, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)",
    )
    .bind(&code)
    .bind(&label)
    .bind(is_base)
    .bind(&category)
    .bind(whole_number)
    .bind(actor)
    .execute(&mut *transaction)
    .await
    .map_err(map_unit_error)?;
    if let Some(aliases) = &request.aliases {
        replace_aliases(&mut transaction, &code, aliases, actor).await?;
    }
    let unit = read_unit(&mut transaction, &code).await?;

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
    let category = request
        .category
        .as_deref()
        .map(normalize_category)
        .transpose()?;
    if label.is_none()
        && request.is_base.is_none()
        && request.active.is_none()
        && request.aliases.is_none()
        && category.is_none()
        && request.whole_number.is_none()
    {
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
        "SELECT is_base, active, category, whole_number, version
           FROM unit_of_measure WHERE code = $1 FOR UPDATE",
    )
    .bind(&code)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Unit".to_owned()))?;
    let was_base: bool = current.try_get("is_base")?;
    let was_active: bool = current.try_get("active")?;
    let was_category: String = current.try_get("category")?;
    let was_whole: bool = current.try_get("whole_number")?;
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
    let will_be_category = category.unwrap_or(was_category.clone());
    if will_be_category != was_category {
        let joined: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM unit_conversion WHERE $1 IN (from_unit, to_unit))",
        )
        .bind(&code)
        .fetch_one(&mut *transaction)
        .await?;
        if joined {
            return Err(AppError::Validation(format!(
                "{code} has conversions written for a {} unit; retire them before changing its kind",
                was_category.to_lowercase()
            )));
        }
    }
    let will_be_whole = will_be_base || request.whole_number.unwrap_or(was_whole);
    if was_whole && !will_be_whole {
        let stocked: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM article WHERE stock_unit_code = $1)")
                .bind(&code)
                .fetch_one(&mut *transaction)
                .await?;
        if stocked {
            return Err(AppError::Validation(format!(
                "{code} is an article's stock unit, and stock is counted in whole numbers"
            )));
        }
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

    sqlx::query(
        "UPDATE unit_of_measure
            SET label        = COALESCE($2, label),
                is_base      = $3,
                active       = $4,
                category     = $6,
                whole_number = $7,
                version      = version + 1,
                updated_by   = $5,
                updated_at   = now()
          WHERE code = $1",
    )
    .bind(&code)
    .bind(&label)
    .bind(will_be_base)
    .bind(will_be_active)
    .bind(actor)
    .bind(&will_be_category)
    .bind(will_be_whole)
    .execute(&mut *transaction)
    .await
    .map_err(map_unit_error)?;
    if let Some(aliases) = &request.aliases {
        replace_aliases(&mut transaction, &code, aliases, actor).await?;
    }
    let unit = read_unit(&mut transaction, &code).await?;

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

    // Said here as well as by the trigger (0653), for the sentence.
    let categories: Vec<(String, String)> =
        sqlx::query_as("SELECT code, category FROM unit_of_measure WHERE code IN ($1, $2)")
            .bind(&from_unit)
            .bind(&to_unit)
            .fetch_all(&mut *transaction)
            .await?;
    if let [(_, one), (_, other)] = categories.as_slice() {
        if one != other {
            return Err(AppError::Validation(format!(
                "{from_unit} and {to_unit} are different kinds of unit; \
                 a {} amount never converts to a {} one",
                categories[0].1.to_lowercase(),
                categories[1].1.to_lowercase()
            )));
        }
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

/// The master as a lookup, for reading what a supplier printed: every
/// active unit with what it is worth in pieces, and every alias.
pub async fn unit_lookup(pool: &PgPool) -> Result<UnitLookup, AppError> {
    let units = sqlx::query(
        "SELECT code, is_base, unit_pieces_per(code) AS pieces
           FROM unit_of_measure WHERE active",
    )
    .fetch_all(pool)
    .await?;
    let aliases = sqlx::query(
        "SELECT a.alias, a.unit_code
           FROM unit_alias a JOIN unit_of_measure u ON u.code = a.unit_code
          WHERE u.active",
    )
    .fetch_all(pool)
    .await?;
    let mut base = String::new();
    let mut known = Vec::with_capacity(units.len());
    for row in &units {
        let code: String = row.try_get("code")?;
        if row.try_get::<bool, _>("is_base")? {
            base = code.clone();
        }
        known.push((code, row.try_get::<Option<Decimal>, _>("pieces")?));
    }
    let mut spellings = Vec::with_capacity(aliases.len());
    for row in &aliases {
        spellings.push((row.try_get("alias")?, row.try_get("unit_code")?));
    }
    Ok(UnitLookup::new(&base, known, spellings))
}

/// The unit a purchase line was ordered in, checked and turned into stock
/// units (pieces, for nearly everything).
///
/// `None` for a line ordered in the stock unit. Otherwise the factor is the
/// article's own (`article_unit`) — an article is dealt in only its own
/// units, as in 7Soft (0657) — or, for goods not yet set up as an article,
/// the global chain to the base. A whole-number unit
/// takes a whole quantity; the quantity times the factor must be a whole
/// number of stock units, and that number must be the one the line was sent
/// with — the screen converts too, and two answers that differ are a bug
/// worth a sentence. Returns `(code, quantity, factor)`, which the line keeps
/// as its snapshot.
pub async fn resolve_order_unit(
    transaction: &mut Transaction<'_, Postgres>,
    article_code: Option<&str>,
    unit_code: Option<&str>,
    unit_quantity: Option<&str>,
    pieces: i64,
) -> Result<Option<(String, Decimal, Decimal)>, AppError> {
    let Some(code) = unit_code.map(str::trim).filter(|code| !code.is_empty()) else {
        return Ok(None);
    };
    let code = code.to_uppercase();
    let found = sqlx::query(
        "SELECT article_unit_factor($1, $2) AS factor,
                (SELECT whole_number FROM unit_of_measure WHERE code = $2) AS whole_number",
    )
    .bind(article_code)
    .bind(&code)
    .fetch_one(&mut **transaction)
    .await?;
    let factor: Option<Decimal> = found.try_get("factor")?;
    let whole_number: Option<bool> = found.try_get("whole_number")?;
    let Some(factor) = factor else {
        return Err(AppError::Validation(format!(
            "{code} is not one of this article's units; add it to the article's units first"
        )));
    };
    if factor == Decimal::ONE {
        // The base unit: a line in pieces, said the long way.
        return Ok(None);
    }
    let typed = unit_quantity
        .map(|text| text.trim().replace(',', "."))
        .unwrap_or_default();
    let quantity = Decimal::from_str(&typed)
        .map_err(|_| AppError::Validation(format!("{typed:?} is not a quantity of {code}")))?;
    if quantity <= Decimal::ZERO {
        return Err(AppError::Validation(format!(
            "a quantity of {code} must be more than nothing"
        )));
    }
    if whole_number == Some(true) && !quantity.fract().is_zero() {
        return Err(AppError::Validation(format!(
            "{code} is counted in whole numbers, not {quantity}"
        )));
    }
    let exact = quantity * factor;
    if !exact.fract().is_zero() {
        return Err(AppError::Validation(format!(
            "{quantity} {code} is {exact} pieces, which is not a whole number"
        )));
    }
    let whole = rust_decimal::prelude::ToPrimitive::to_i64(&exact)
        .ok_or_else(|| AppError::Validation("that quantity is too large".into()))?;
    if whole != pieces {
        return Err(AppError::Validation(format!(
            "{quantity} {code} is {whole} pieces, not the {pieces} sent"
        )));
    }
    Ok(Some((code, quantity.normalize(), factor.normalize())))
}

/// What the DC is told about a line's units: what it was ordered in, and
/// every unit it may be counted in with its worth in the line's stock unit —
/// the article's own units first choice, the global chain otherwise.
pub async fn purchase_line_units(
    transaction: &mut Transaction<'_, Postgres>,
    article_code: Option<&str>,
    order_unit: &Option<(String, Decimal, Decimal)>,
) -> Result<crate::cloud::domain::PurchaseLineUnits, AppError> {
    let rows = sqlx::query(
        "SELECT code, label, factor,
                code = COALESCE(
                    (SELECT stock_unit_code FROM article WHERE article_code = btrim($1)),
                    (SELECT code FROM unit_of_measure WHERE is_base)
                ) AS is_stock
           FROM (SELECT u.code, u.label, article_unit_factor($1, u.code) AS factor
                   FROM unit_of_measure u WHERE u.active) units
          WHERE factor IS NOT NULL
          ORDER BY factor, code",
    )
    .bind(article_code)
    .fetch_all(&mut **transaction)
    .await?;
    let mut count_units = Vec::with_capacity(rows.len());
    for row in rows {
        let factor: Decimal = row.try_get("factor")?;
        count_units.push(crate::cloud::domain::CountUnit {
            code: row.try_get("code")?,
            label: row.try_get("label")?,
            factor: factor.normalize().to_string(),
            is_stock: row.try_get::<Option<bool>, _>("is_stock")?.unwrap_or(false),
        });
    }
    Ok(crate::cloud::domain::PurchaseLineUnits {
        order_unit_code: order_unit.as_ref().map(|(code, _, _)| code.clone()),
        order_unit_quantity: order_unit
            .as_ref()
            .map(|(_, quantity, _)| quantity.to_string()),
        unit_factor: order_unit.as_ref().map(|(_, _, factor)| factor.to_string()),
        count_units,
    })
}

/// What `pieces` come to at a purchase line's agreed price, in whole rupiah.
///
/// THE rule (owner, 2026-10-02), used by the order, receiving, payables,
/// valuation and the three-way match alike — its SQL twin is
/// `purchase_value` (migration 0823), and the hub's `lineTotal` is the same
/// arithmetic. Quantities are pieces; the price is kept in the unit it was
/// agreed in. Priced per order unit (`per_unit` = the price per unit and the
/// pieces in one unit), the value is pieces × price ÷ pieces-per-unit, in
/// integers, rounded half up ONCE, here: 240 pcs at Rp 400.000 a lusin is
/// exactly 8.000.000, and 13 pcs is 433.333 after one rounding. A rounded
/// price per piece is never multiplied. Priced per piece, it is a plain
/// product with nothing to round. `None` on overflow.
pub fn purchase_value(
    pieces: i64,
    piece_price_minor: i64,
    per_unit: Option<(i64, Decimal)>,
) -> Option<i64> {
    use rust_decimal::prelude::ToPrimitive;
    match per_unit {
        Some((unit_price_minor, factor)) if factor > Decimal::ZERO => {
            // A factor has at most four decimals (`parse_factor`), so ten
            // thousand of them is a whole number and the division is exact
            // integer arithmetic.
            let factor_e4 = i128::from((factor * Decimal::from(10_000)).round().to_i64()?);
            if factor_e4 <= 0 {
                return None;
            }
            let product = i128::from(pieces) * i128::from(unit_price_minor);
            let magnitude = (product.abs() * 20_000 + factor_e4) / (factor_e4 * 2);
            i64::try_from(if product < 0 { -magnitude } else { magnitude }).ok()
        }
        _ => pieces.checked_mul(piece_price_minor),
    }
}

/// A whole amount split in proportion to `weights`, so the shares add up to
/// `total` exactly: each takes its floor, and the rupiah left over go one
/// each to the largest remainders (the earlier line on a tie). The hub's
/// `shareOut` is the same rule. All zero when there is nothing to share or
/// nothing to share it by.
pub fn share_out(total: i64, weights: &[i64]) -> Vec<i64> {
    let sum: i128 = weights
        .iter()
        .map(|weight| i128::from((*weight).max(0)))
        .sum();
    if total <= 0 || sum <= 0 {
        return vec![0; weights.len()];
    }
    let whole = i128::from(total);
    let mut shares: Vec<(i128, i128)> = weights
        .iter()
        .map(|weight| {
            let exact = whole * i128::from((*weight).max(0));
            (exact / sum, exact % sum)
        })
        .collect();
    let mut left = whole - shares.iter().map(|(floor, _)| *floor).sum::<i128>();
    let mut order: Vec<usize> = (0..shares.len()).collect();
    // Stable: equal remainders keep line order, so the earlier line wins.
    order.sort_by(|a, b| shares[*b].1.cmp(&shares[*a].1));
    for index in order {
        if left <= 0 {
            break;
        }
        shares[index].0 += 1;
        left -= 1;
    }
    shares
        .into_iter()
        .map(|(share, _)| i64::try_from(share).unwrap_or(i64::MAX))
        .collect()
}

/// The discount a percentage of the subtotal comes to, in whole rupiah,
/// rounded half up once. `bps` is hundredths of a percent: 1250 is 12,50%.
pub fn discount_from_bps(subtotal_minor: i64, bps: i32) -> i64 {
    if subtotal_minor <= 0 || bps <= 0 {
        return 0;
    }
    let product = i128::from(subtotal_minor) * i128::from(bps);
    i64::try_from((product * 2 + 10_000) / 20_000).unwrap_or(i64::MAX)
}

/// How a purchase line is priced: `(unit_price_minor, line_amount_minor,
/// order_unit_price_minor)`.
///
/// Priced in the stock unit (no order unit, or no price per order unit), the
/// line is pieces × price as it always was. Priced per order unit — "Rp
/// 250.000 per lusin", migration 0656 — the line total is
/// [`purchase_value`]: pieces × price ÷ pieces-per-unit, rounded half up once
/// at the total, exactly what the supplier bills. `unit_price_minor` beside
/// it is the price over the factor rounded half up to the rupiah — shown and
/// sent to the DC, never multiplied.
pub fn price_purchase_line(
    pieces: i64,
    piece_price_minor: i64,
    order_unit: &Option<(String, Decimal, Decimal)>,
    order_unit_price_minor: Option<i64>,
) -> Result<(i64, i64, Option<i64>), AppError> {
    let overflow = || AppError::Validation("that line's amount is too large".into());
    match (order_unit, order_unit_price_minor) {
        (Some((code, _quantity, factor)), Some(price)) => {
            if price < 0 {
                return Err(AppError::Validation(format!(
                    "a price per {code} cannot be negative"
                )));
            }
            let amount = purchase_value(pieces, 0, Some((price, *factor))).ok_or_else(overflow)?;
            let per_piece = purchase_value(1, 0, Some((price, *factor))).ok_or_else(overflow)?;
            Ok((per_piece, amount, Some(price)))
        }
        _ => {
            if piece_price_minor < 0 {
                return Err(AppError::Validation(
                    "agreed unit price cannot be negative".into(),
                ));
            }
            let amount = piece_price_minor.checked_mul(pieces).ok_or_else(overflow)?;
            Ok((piece_price_minor, amount, None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_priced_per_lusin_totals_as_the_supplier_bills() {
        let lusin = Some(("LUSIN".to_owned(), Decimal::from(10), Decimal::from(12)));
        // 10 lusin at 250.000: the total is exact, a piece rounds.
        assert_eq!(
            price_purchase_line(120, 0, &lusin, Some(250_000)).ok(),
            Some((20_833, 2_500_000, Some(250_000)))
        );
        // No price per unit: pieces times the piece price, as before.
        assert_eq!(
            price_purchase_line(120, 20_000, &lusin, None).ok(),
            Some((20_000, 2_400_000, None))
        );
        let kodi = Some(("KODI".to_owned(), Decimal::new(95, 1), Decimal::from(20)));
        assert_eq!(
            price_purchase_line(190, 0, &kodi, Some(300_000)).ok(),
            Some((15_000, 2_850_000, Some(300_000)))
        );
        // 20 lusin at 400.000 is 8.000.000 exactly, never 240 × 33.333.
        let twenty = Some(("LUSIN".to_owned(), Decimal::from(20), Decimal::from(12)));
        assert_eq!(
            price_purchase_line(240, 0, &twenty, Some(400_000)).ok(),
            Some((33_333, 8_000_000, Some(400_000)))
        );
    }

    #[test]
    fn a_value_is_rounded_once_half_up() {
        let lusin = Some((400_000, Decimal::from(12)));
        assert_eq!(purchase_value(240, 0, lusin), Some(8_000_000));
        assert_eq!(purchase_value(13, 0, lusin), Some(433_333));
        // 1 pcs of Rp 6 a lusin is 0,5: half up, not to even.
        assert_eq!(purchase_value(1, 0, Some((6, Decimal::from(12)))), Some(1));
        assert_eq!(purchase_value(7, 20_000, None), Some(140_000));
    }

    #[test]
    fn a_discount_is_shared_to_the_rupiah() {
        assert_eq!(discount_from_bps(1_000_000, 1250), 125_000);
        assert_eq!(discount_from_bps(333, 150), 5);
        assert_eq!(share_out(100, &[1, 1, 1]), vec![34, 33, 33]);
        assert_eq!(share_out(10, &[0, 0]), vec![0, 0]);
        let shares = share_out(125_000, &[8_000_000, 433_333, 1_566_667]);
        assert_eq!(shares.iter().sum::<i64>(), 125_000);
    }

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
