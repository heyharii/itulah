//! The company's colour list.
//!
//! Before this, a colourway was a word somebody typed into a setup session and
//! `article_colour.label` kept whatever they typed. Nothing tied the "Navy" on
//! one article to the "navy" on the next, so a colour filter over the
//! catalogue answered a question about spelling rather than about garments.
//! `0027` had already learnt this lesson for tags and built them a table;
//! `0081` builds colours the same one.
//!
//! Colours are picked from here, never typed. That is the whole reason this
//! module exists, and it is why there is no endpoint that creates a colour as
//! a side effect of using it.

use super::{begin_idempotent, complete_idempotent, NullablePatch};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};

/// One colour, and how much of the catalogue is wearing it.
///
/// `in_use` counts ARTICLES, not SKUs or units. It is the number that answers
/// the only question worth asking before retiring a colour — "is anything
/// still filed under this" — and a SKU count would answer it in a unit nobody
/// thinks in.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColourTerm {
    pub code: String,
    pub label: String,
    pub hex_code: Option<String>,
    pub display_order: i32,
    /// Retired colours are still returned, unlike the catalogue vocabulary's
    /// terms. A picker filters them out; the master screen must be able to see
    /// them, because a retirement nobody can find is a retirement nobody can
    /// undo.
    pub active: bool,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
    pub in_use: i64,
}

/// The colours an article may be made in.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColourVocabulary {
    /// In `display_order`, then label. The business reads colours in families —
    /// the neutrals together, then the blues — and alphabetical order shatters
    /// that into a list nobody can scan.
    pub colours: Vec<ColourTerm>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateColourRequest {
    /// The code filters address and SKUs are filed under. Upper-snake, because
    /// that is the shape `0081` minted the existing ones in and a master with
    /// two conventions is a master people guess at.
    pub code: String,
    pub label: String,
    #[serde(default)]
    pub hex_code: Option<String>,
    /// Absent puts the new colour at the end of the list, which is where
    /// somebody who just added one expects to find it.
    #[serde(default)]
    pub display_order: Option<i32>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateColourRequest {
    /// Renames the colour everywhere at once, which is the point of having a
    /// master. The code is not editable: it is what `article_colour` rows
    /// point at, and a code that moves is a rename that loses the goods.
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub hex_code: NullablePatch<String>,
    #[serde(default)]
    pub display_order: Option<i32>,
    /// Retiring a colour stops it being pickable for NEW colourways. It does
    /// not touch the articles already wearing it — a shelf full of navy
    /// shirts does not stop being navy because merchandising stopped offering
    /// the shade. That is why there is no delete: the only safe removal is one
    /// that leaves the existing rows resolving.
    #[serde(default)]
    pub active: Option<bool>,
}

fn colour_from_row(row: PgRow) -> Result<ColourTerm, AppError> {
    Ok(ColourTerm {
        code: row.try_get("code")?,
        label: row.try_get("label")?,
        hex_code: row.try_get("hex_code")?,
        display_order: row.try_get("display_order")?,
        active: row.try_get("active")?,
        version: row.try_get("version")?,
        in_use: row.try_get("in_use")?,
    })
}

/// Unique violations here are always one of two things, and a bare 23505 tells
/// a merchandiser neither of them.
fn map_colour_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(
                "that colour code, or a colour reading the same as that name, already exists"
                    .to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// The code as the master stores it.
///
/// Upper-snake and nothing else, so `Navy Blue`, `navy-blue` and `NAVY_BLUE`
/// cannot become three rows the way three spellings of the label already did.
fn normalize_colour_code(raw: &str) -> Result<String, AppError> {
    let code = raw.trim().to_uppercase().replace([' ', '-'], "_");
    if code.is_empty() {
        return Err(AppError::Validation("colour code cannot be blank".into()));
    }
    if !code
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(AppError::Validation(format!(
            "colour code {raw:?} must be letters, digits and underscores, for example NAVY_BLUE"
        )));
    }
    Ok(code)
}

fn required_label(raw: &str) -> Result<String, AppError> {
    let label = raw.trim();
    if label.is_empty() {
        return Err(AppError::Validation(
            "a colour needs a name a human can read on a picking list".into(),
        ));
    }
    Ok(label.to_owned())
}

/// The whole master, retired colours included.
///
/// One query rather than a list plus a count per row: a picker needs the usage
/// figures to draw itself at all, and asking for them one colour at a time is
/// a hundred round trips for a screen that shows one list.
pub async fn colour_vocabulary(pool: &PgPool) -> Result<ColourVocabulary, AppError> {
    let rows = sqlx::query(
        "SELECT c.code, c.label, c.hex_code, c.display_order, c.active, c.version,
                COALESCE(u.articles, 0) AS in_use
           FROM colour c
           LEFT JOIN (
               SELECT colour_code, count(DISTINCT article_id) AS articles
                 FROM article_colour GROUP BY colour_code
           ) u ON u.colour_code = c.code
          ORDER BY c.display_order, c.label",
    )
    .fetch_all(pool)
    .await?;
    Ok(ColourVocabulary {
        colours: rows
            .into_iter()
            .map(colour_from_row)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

/// One colour with the only figure that matters for retiring it.
const COLOUR_WITH_USAGE: &str = "
    SELECT c.code, c.label, c.hex_code, c.display_order, c.active, c.version,
           (SELECT count(DISTINCT article_id) FROM article_colour
             WHERE colour_code = c.code) AS in_use
      FROM colour c WHERE c.code = $1";

async fn read_colour(pool: &PgPool, code: &str) -> Result<ColourTerm, AppError> {
    let row = sqlx::query(COLOUR_WITH_USAGE)
        .bind(code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Colour".to_owned()))?;
    colour_from_row(row)
}

pub async fn get_colour(pool: &PgPool, code: &str) -> Result<ColourTerm, AppError> {
    read_colour(pool, &normalize_colour_code(code)?).await
}

/// Add a colour to the master.
///
/// Guarded by an idempotency key like every other write here: a merchandiser
/// whose browser retries a slow request must not end up with the colour twice
/// under two codes, which is precisely the split this table was built to stop.
pub async fn create_colour(
    pool: &PgPool,
    request: CreateColourRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<ColourTerm, AppError> {
    let code = normalize_colour_code(&request.code)?;
    let label = required_label(&request.label)?;
    let hex_code = request
        .hex_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut transaction, idempotency_key, "colour.create", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    sqlx::query(
        "INSERT INTO colour (code, label, hex_code, display_order)
         VALUES ($1, $2, $3,
                 COALESCE($4, (SELECT COALESCE(max(display_order), 0) + 10 FROM colour)))",
    )
    .bind(&code)
    .bind(&label)
    .bind(&hex_code)
    .bind(request.display_order)
    .execute(&mut *transaction)
    .await
    .map_err(map_colour_write_error)?;
    // Read back rather than assembled here, so the row this answers with and
    // the row the next list shows cannot disagree about a default.
    let colour = colour_from_row(
        sqlx::query(COLOUR_WITH_USAGE)
            .bind(&code)
            .fetch_one(&mut *transaction)
            .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&colour)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(colour)
}

/// Rename, recolour, reorder or retire a colour.
///
/// There is deliberately no delete. A colour with articles behind it cannot be
/// removed without leaving `article_colour` rows pointing at nothing, and the
/// foreign key would refuse it anyway; retiring is the operation that means
/// what people actually want when they reach for delete.
pub async fn update_colour(
    pool: &PgPool,
    code: &str,
    expected_version: i32,
    request: UpdateColourRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<ColourTerm, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let code = normalize_colour_code(code)?;
    let changes_label = request.label.is_some();
    let changes_hex = !matches!(request.hex_code, NullablePatch::Missing);
    let changes_order = request.display_order.is_some();
    let changes_active = request.active.is_some();
    if !(changes_label || changes_hex || changes_order || changes_active) {
        return Err(AppError::Validation(
            "Colour update must contain at least one field".into(),
        ));
    }
    let label = request.label.as_deref().map(required_label).transpose()?;
    let hex_code = match request.hex_code {
        NullablePatch::Value(value) => Some(value.trim().to_owned()).filter(|v| !v.is_empty()),
        NullablePatch::Missing | NullablePatch::Null => None,
    };

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut transaction, idempotency_key, "colour.update", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let updated = sqlx::query_scalar::<_, i32>(
        "UPDATE colour SET
             label         = CASE WHEN $3 THEN $4 ELSE label END,
             hex_code      = CASE WHEN $5 THEN $6 ELSE hex_code END,
             display_order = CASE WHEN $7 THEN $8 ELSE display_order END,
             active        = CASE WHEN $9 THEN $10 ELSE active END,
             version       = version + 1
         WHERE code = $1 AND version = $2
         RETURNING version",
    )
    .bind(&code)
    .bind(expected_version)
    .bind(changes_label)
    .bind(&label)
    .bind(changes_hex)
    .bind(&hex_code)
    .bind(changes_order)
    .bind(request.display_order)
    .bind(changes_active)
    .bind(request.active)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_colour_write_error)?;
    if updated.is_none() {
        let actual = sqlx::query_scalar::<_, i32>("SELECT version FROM colour WHERE code = $1")
            .bind(&code)
            .fetch_optional(&mut *transaction)
            .await?;
        return Err(match actual {
            Some(actual) => AppError::Conflict(format!(
                "Colour version is {actual}, not expected version {expected_version}"
            )),
            None => AppError::NotFound("Colour".to_owned()),
        });
    }
    let row = sqlx::query(COLOUR_WITH_USAGE)
        .bind(&code)
        .fetch_one(&mut *transaction)
        .await?;
    let colour = colour_from_row(row)?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&colour)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(colour)
}
