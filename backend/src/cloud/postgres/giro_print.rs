//! Where the words go on a bank's own giro leaf.
//!
//! Nothing here produces a document. A bilyet giro is the bank's paper, already
//! carrying its number and the account it draws on; printing means putting nine
//! variable facts onto boxes that are already there. So what is stored is a set
//! of coordinates per bank — see `0222` for why they are rows rather than
//! columns — and what a screen does with them is draw the leaf, let somebody
//! nudge a field two millimetres, and print a test.
//!
//! # The defaults are a starting point, not a layout
//!
//! A new template is seeded with nine placements that are roughly where they
//! sit on a common Indonesian leaf. They are a guess and are meant to be wrong:
//! the alternative is a blank sheet with nothing to drag, and somebody typing
//! eighteen numbers from zero before the first test print.

use super::{begin_idempotent, complete_idempotent, NullablePatch};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

/// One fact, and where on the leaf it is printed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GiroPrintPlacement {
    /// One of the nine `0222` allows. Not an enum here: the list is a CHECK in
    /// the database and a `<select>` in the browser, and a third copy in Rust
    /// would be the one that goes stale.
    pub field_code: String,
    /// From the leaf's own top-left corner, in millimetres.
    pub x_mm: f64,
    pub y_mm: f64,
    /// Only the wrapping fields need these.
    pub width_mm: Option<f64>,
    pub line_mm: Option<f64>,
    pub font_pt: f64,
    pub uppercase: bool,
}

/// One bank's leaf, and everything printed on it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GiroPrintTemplate {
    pub template_id: Uuid,
    /// Our bank, spelled the way `account_map` spells it — the qualifier on
    /// `bank_giro`.
    pub bank_qualifier: String,
    pub label: String,
    pub width_mm: f64,
    pub height_mm: f64,
    pub top_offset_mm: f64,
    pub left_offset_mm: f64,
    /// A scan of a blank leaf, shown under the fields while calibrating and
    /// never printed.
    pub backdrop_url: Option<String>,
    pub retired: bool,
    pub version: i32,
    pub placements: Vec<GiroPrintPlacement>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateGiroPrintTemplateRequest {
    pub bank_qualifier: String,
    pub label: String,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub width_mm: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub height_mm: Option<f64>,
}

/// Move the leaf, re-point a field, retire the template.
///
/// `placements`, when present, REPLACES the whole list. A calibration screen
/// saves a layout, not a field: sending one row at a time would make a
/// half-saved layout reachable, and a half-saved layout prints.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGiroPrintTemplateRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub label: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub width_mm: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub height_mm: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub top_offset_mm: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub left_offset_mm: Option<f64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub backdrop_url: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub retired: Option<bool>,
    #[serde(default)]
    // Typed by ts-rs rather than by a `type = "…"` literal, and that is the
    // whole bug this line once carried: a literal is a STRING to ts-rs, so it
    // wrote `Array<GiroPrintPlacement>` into the generated file and imported
    // nothing, and every app that pulled the contract barrel failed to
    // compile on a name that was never declared. The primitives above can
    // spell themselves; a generated type has to be tracked. Absent still
    // means "leave the layout alone" — an empty array is how a layout is
    // cleared — so nothing on the wire changed.
    #[cfg_attr(feature = "ts", ts(optional))]
    pub placements: Option<Vec<GiroPrintPlacement>>,
}

/// Roughly where the nine facts sit on a common leaf, in millimetres.
///
/// Measured off one BCA bilyet giro and deliberately not presented as more than
/// that. The screen exists because this is wrong for every other bank.
const SEEDED: &[(&str, f64, f64, Option<f64>, Option<f64>)] = &[
    ("PLACE_DATE", 120.0, 18.0, Some(60.0), None),
    ("ISSUED_ON", 120.0, 26.0, None, None),
    ("EFFECTIVE_ON", 120.0, 34.0, None, None),
    ("PAYEE", 20.0, 34.0, Some(95.0), None),
    ("PAYEE_BANK", 20.0, 42.0, Some(95.0), None),
    ("PAYEE_ACCOUNT", 20.0, 50.0, Some(60.0), None),
    ("AMOUNT_WORDS", 20.0, 58.0, Some(120.0), Some(5.0)),
    ("AMOUNT_FIGURES", 130.0, 70.0, Some(50.0), None),
    ("NOTE", 20.0, 78.0, Some(100.0), None),
];

const TEMPLATE_COLUMNS: &str = "template_id, bank_qualifier, label, width_mm, height_mm, \
                                top_offset_mm, left_offset_mm, backdrop_url, \
                                (retired_at IS NOT NULL) AS retired, version";

fn template_from_row(row: &PgRow) -> Result<GiroPrintTemplate, AppError> {
    Ok(GiroPrintTemplate {
        template_id: row.try_get("template_id")?,
        bank_qualifier: row.try_get("bank_qualifier")?,
        label: row.try_get("label")?,
        width_mm: row.try_get("width_mm")?,
        height_mm: row.try_get("height_mm")?,
        top_offset_mm: row.try_get("top_offset_mm")?,
        left_offset_mm: row.try_get("left_offset_mm")?,
        backdrop_url: row.try_get("backdrop_url")?,
        retired: row.try_get("retired")?,
        version: row.try_get("version")?,
        placements: Vec::new(),
    })
}

fn placement_from_row(row: &PgRow) -> Result<GiroPrintPlacement, AppError> {
    Ok(GiroPrintPlacement {
        field_code: row.try_get("field_code")?,
        x_mm: row.try_get("x_mm")?,
        y_mm: row.try_get("y_mm")?,
        width_mm: row.try_get("width_mm")?,
        line_mm: row.try_get("line_mm")?,
        font_pt: row.try_get("font_pt")?,
        uppercase: row.try_get("uppercase")?,
    })
}

fn required(value: &str, what: &str) -> Result<String, AppError> {
    let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{what} cannot be blank")));
    }
    Ok(trimmed)
}

fn map_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(
                "that bank already has a live giro template; retire it before adding another"
                    .to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Every template, with its placements, retired ones included when asked.
///
/// Two queries and a group rather than one per template: there are five banks,
/// and a round trip each to fetch nine rows is a page built out of ten answers.
pub async fn giro_print_templates(
    pool: &PgPool,
    include_retired: bool,
) -> Result<Vec<GiroPrintTemplate>, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT {TEMPLATE_COLUMNS}
           FROM giro_print_template
          WHERE ($1 OR retired_at IS NULL)
          ORDER BY (retired_at IS NOT NULL), bank_qualifier"
    ))
    .bind(include_retired)
    .fetch_all(pool)
    .await?;

    let mut templates: Vec<GiroPrintTemplate> = rows
        .iter()
        .map(template_from_row)
        .collect::<Result<_, _>>()?;

    let ids: Vec<Uuid> = templates.iter().map(|one| one.template_id).collect();
    let placements = sqlx::query(
        "SELECT template_id, field_code, x_mm, y_mm, width_mm, line_mm, font_pt, uppercase
           FROM giro_print_field
          WHERE template_id = ANY($1)
          ORDER BY field_code",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    for row in &placements {
        let owner: Uuid = row.try_get("template_id")?;
        if let Some(template) = templates.iter_mut().find(|one| one.template_id == owner) {
            template.placements.push(placement_from_row(row)?);
        }
    }

    Ok(templates)
}

async fn read_template(pool: &PgPool, template_id: Uuid) -> Result<GiroPrintTemplate, AppError> {
    let row = sqlx::query(&format!(
        "SELECT {TEMPLATE_COLUMNS} FROM giro_print_template WHERE template_id = $1"
    ))
    .bind(template_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Giro print template".to_owned()))?;
    let mut template = template_from_row(&row)?;

    let placements = sqlx::query(
        "SELECT field_code, x_mm, y_mm, width_mm, line_mm, font_pt, uppercase
           FROM giro_print_field WHERE template_id = $1 ORDER BY field_code",
    )
    .bind(template_id)
    .fetch_all(pool)
    .await?;
    for row in &placements {
        template.placements.push(placement_from_row(row)?);
    }
    Ok(template)
}

/// Start a bank off with a leaf and nine guesses.
pub async fn create_giro_print_template(
    pool: &PgPool,
    request: CreateGiroPrintTemplateRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<GiroPrintTemplate, AppError> {
    let bank = required(&request.bank_qualifier, "bank")?;
    let label = required(&request.label, "label")?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "giro_print_template.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let template_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO giro_print_template
             (template_id, bank_qualifier, label, width_mm, height_mm, created_by, updated_by)
         VALUES ($1, $2, $3, COALESCE($4, 190.0), COALESCE($5, 95.0), $6, $6)",
    )
    .bind(template_id)
    .bind(&bank)
    .bind(&label)
    .bind(request.width_mm)
    .bind(request.height_mm)
    .bind(actor)
    .execute(&mut *transaction)
    .await
    .map_err(map_write_error)?;

    for (field_code, x_mm, y_mm, width_mm, line_mm) in SEEDED {
        sqlx::query(
            "INSERT INTO giro_print_field
                 (template_id, field_code, x_mm, y_mm, width_mm, line_mm)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(template_id)
        .bind(field_code)
        .bind(x_mm)
        .bind(y_mm)
        .bind(width_mm)
        .bind(line_mm)
        .execute(&mut *transaction)
        .await
        .map_err(map_write_error)?;
    }

    let template = {
        let row = sqlx::query(&format!(
            "SELECT {TEMPLATE_COLUMNS} FROM giro_print_template WHERE template_id = $1"
        ))
        .bind(template_id)
        .fetch_one(&mut *transaction)
        .await?;
        let mut built = template_from_row(&row)?;
        let rows = sqlx::query(
            "SELECT field_code, x_mm, y_mm, width_mm, line_mm, font_pt, uppercase
               FROM giro_print_field WHERE template_id = $1 ORDER BY field_code",
        )
        .bind(template_id)
        .fetch_all(&mut *transaction)
        .await?;
        for row in &rows {
            built.placements.push(placement_from_row(row)?);
        }
        built
    };

    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&template)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(template)
}

/// Save a calibration.
pub async fn update_giro_print_template(
    pool: &PgPool,
    template_id: Uuid,
    expected_version: i32,
    request: UpdateGiroPrintTemplateRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<GiroPrintTemplate, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let label = request
        .label
        .as_deref()
        .map(|one| required(one, "label"))
        .transpose()?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut transaction,
        idempotency_key,
        "giro_print_template.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let current =
        sqlx::query("SELECT version FROM giro_print_template WHERE template_id = $1 FOR UPDATE")
            .bind(template_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or_else(|| AppError::NotFound("Giro print template".to_owned()))?;
    let actual_version: i32 = current.try_get("version")?;
    if actual_version != expected_version {
        return Err(AppError::Conflict(format!(
            "Giro print template has moved on: If-Match said {expected_version}, it is now \
             {actual_version}"
        )));
    }

    let changes_backdrop = !matches!(request.backdrop_url, NullablePatch::Missing);
    sqlx::query(
        "UPDATE giro_print_template
            SET label          = COALESCE($2, label),
                width_mm       = COALESCE($3, width_mm),
                height_mm      = COALESCE($4, height_mm),
                top_offset_mm  = COALESCE($5, top_offset_mm),
                left_offset_mm = COALESCE($6, left_offset_mm),
                backdrop_url   = CASE WHEN $7 THEN $8 ELSE backdrop_url END,
                retired_at     = CASE
                                     WHEN $9 IS NULL THEN retired_at
                                     WHEN $9 THEN COALESCE(retired_at, now())
                                     ELSE NULL
                                 END,
                version        = version + 1,
                updated_by     = $10,
                updated_at     = now()
          WHERE template_id = $1",
    )
    .bind(template_id)
    .bind(label.as_ref())
    .bind(request.width_mm)
    .bind(request.height_mm)
    .bind(request.top_offset_mm)
    .bind(request.left_offset_mm)
    .bind(changes_backdrop)
    .bind(match &request.backdrop_url {
        NullablePatch::Value(value) => Some(value.trim().to_owned()).filter(|one| !one.is_empty()),
        _ => None,
    })
    .bind(request.retired)
    .bind(actor)
    .execute(&mut *transaction)
    .await
    .map_err(map_write_error)?;

    // A layout is saved whole. Deleting and re-inserting inside the transaction
    // is what makes "this is the layout now" true — a field removed from the
    // screen has to leave the table, and an UPDATE per row would leave it.
    if let Some(placements) = &request.placements {
        sqlx::query("DELETE FROM giro_print_field WHERE template_id = $1")
            .bind(template_id)
            .execute(&mut *transaction)
            .await?;
        for placement in placements {
            sqlx::query(
                "INSERT INTO giro_print_field
                     (template_id, field_code, x_mm, y_mm, width_mm, line_mm, font_pt, uppercase)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(template_id)
            .bind(&placement.field_code)
            .bind(placement.x_mm)
            .bind(placement.y_mm)
            .bind(placement.width_mm)
            .bind(placement.line_mm)
            .bind(placement.font_pt)
            .bind(placement.uppercase)
            .execute(&mut *transaction)
            .await
            .map_err(map_write_error)?;
        }
    }

    let template = {
        let row = sqlx::query(&format!(
            "SELECT {TEMPLATE_COLUMNS} FROM giro_print_template WHERE template_id = $1"
        ))
        .bind(template_id)
        .fetch_one(&mut *transaction)
        .await?;
        let mut built = template_from_row(&row)?;
        let rows = sqlx::query(
            "SELECT field_code, x_mm, y_mm, width_mm, line_mm, font_pt, uppercase
               FROM giro_print_field WHERE template_id = $1 ORDER BY field_code",
        )
        .bind(template_id)
        .fetch_all(&mut *transaction)
        .await?;
        for row in &rows {
            built.placements.push(placement_from_row(row)?);
        }
        built
    };

    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&template)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(template)
}

/// One template, with its placements.
pub async fn giro_print_template(
    pool: &PgPool,
    template_id: Uuid,
) -> Result<GiroPrintTemplate, AppError> {
    read_template(pool, template_id).await
}
