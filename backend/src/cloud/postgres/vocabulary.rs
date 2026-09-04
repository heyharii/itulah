//! Divisions, sizes and tags — the three vocabularies that had tables and no
//! way in.
//!
//! All three arrived as controlled lists (0022, 0027) for the reason free text
//! fails: a typo does not error, it silently creates a division of one and
//! splits every report that groups by it. But none of them got an endpoint, so
//! adding a size has meant shipping a migration. `0091` gives them the
//! `version` column the colour master already had, and this module gives all
//! three the same three operations.
//!
//! # Why one module and not three
//!
//! Because they are one shape: code, label, order, active, and a count of what
//! is filed under the term. Written out three times, the fourth change is the
//! one that lands in two of them — which is the class of bug a master list
//! exists to prevent, so it would be a poor thing to reintroduce in the code
//! that serves it. `Vocabulary` names the differences (which table, what
//! counts as usage, what a code may look like) and everything else is shared.
//!
//! Colours are NOT in here, and that is not an oversight. A colour carries a
//! hex value, is drawn as a swatch, and has a picker built on it; folding it in
//! would mean an `Option<String>` that is always `None` for three of the four.

use super::{begin_idempotent, complete_idempotent};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};

/// Which of the three lists an operation is against.
///
/// Not a string: every SQL statement below interpolates this into a table name,
/// and the whole reason that is safe is that the set is closed here rather than
/// arriving from a request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Vocabulary {
    Divisions,
    Sizes,
    Tags,
}

impl Vocabulary {
    /// The path segment, and what a bad request is named after.
    pub fn parse(segment: &str) -> Option<Self> {
        match segment {
            "divisions" => Some(Self::Divisions),
            "sizes" => Some(Self::Sizes),
            "tags" => Some(Self::Tags),
            _ => None,
        }
    }

    /// The table, for the idempotency digest — two lists must never share a
    /// replay record just because a caller reused a key.
    pub fn table_name(self) -> &'static str {
        self.table()
    }

    fn table(self) -> &'static str {
        match self {
            Self::Divisions => "division",
            Self::Sizes => "size_code",
            Self::Tags => "tag",
        }
    }

    /// What the term is called in an error a merchandiser reads.
    fn subject(self) -> &'static str {
        match self {
            Self::Divisions => "Division",
            Self::Sizes => "Size",
            Self::Tags => "Tag",
        }
    }

    /// Articles filed under one term, as a correlated subquery.
    ///
    /// Articles and not SKUs or units, matching the colour master: it is the
    /// number that answers the only question asked before retiring a term —
    /// "is anything still filed under this" — and a SKU count answers it in a
    /// unit nobody thinks in. Sizes reach it through `sku`, because a size is
    /// a property of the variant rather than of the article, so a size is
    /// "in use" by an article if any one of its SKUs is that size.
    fn usage(self) -> &'static str {
        match self {
            Self::Divisions => "(SELECT count(*) FROM article a WHERE a.division_code = v.code)",
            Self::Sizes => {
                "(SELECT count(DISTINCT s.article_id) FROM sku s WHERE s.size_code = v.code)"
            }
            Self::Tags => {
                "(SELECT count(DISTINCT t.article_id) FROM article_tag t WHERE t.tag_code = v.code)"
            }
        }
    }

    /// The code as this list stores it.
    ///
    /// Sizes are two digits and nothing else — `03` is M on every article in
    /// the company, and the SKU codec reads the last two characters of an
    /// 11-digit code expecting exactly that. The other two are upper-snake,
    /// the shape their migrations minted them in: a master with two
    /// conventions is a master people guess at.
    fn normalize_code(self, raw: &str) -> Result<String, AppError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(format!(
                "{} code cannot be blank",
                self.subject().to_lowercase()
            )));
        }
        match self {
            Self::Sizes => {
                if trimmed.len() != 2 || !trimmed.chars().all(|c| c.is_ascii_digit()) {
                    return Err(AppError::Validation(format!(
                        "size code {raw:?} must be exactly two digits, for example 03 — \
                         it is the last two characters of every 11-digit SKU"
                    )));
                }
                Ok(trimmed.to_owned())
            }
            Self::Divisions | Self::Tags => {
                let code = trimmed.to_uppercase().replace([' ', '-'], "_");
                if !code
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                {
                    return Err(AppError::Validation(format!(
                        "{} code {raw:?} must be letters, digits and underscores, \
                         for example OUTERWEAR",
                        self.subject().to_lowercase()
                    )));
                }
                Ok(code)
            }
        }
    }
}

/// One term, and how much of the catalogue is filed under it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterTerm {
    pub code: String,
    pub label: String,
    pub display_order: i32,
    /// Retired terms are still returned. A picker filters them out; the master
    /// screen must be able to see them, because a retirement nobody can find
    /// is a retirement nobody can undo.
    pub active: bool,
    /// What a PATCH must quote in `If-Match`.
    pub version: i32,
    /// Articles filed under this term. See `Vocabulary::usage`.
    pub in_use: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterVocabulary {
    /// In `display_order`, then label — the order the business reads them in.
    pub terms: Vec<MasterTerm>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateTermRequest {
    pub code: String,
    pub label: String,
    /// Absent puts the new term at the end of the list, which is where somebody
    /// who just added one expects to find it.
    #[serde(default)]
    pub display_order: Option<i32>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateTermRequest {
    /// Renames the term everywhere at once, which is the point of having a
    /// master. The code is not editable: it is what `article.division_code`,
    /// `sku.size_code` and `article_tag.tag_code` point at, and a code that
    /// moves is a rename that loses the goods.
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub display_order: Option<i32>,
    /// Retiring a term stops it being pickable for new work. It does not touch
    /// what is already filed under it — a shelf of size 03 shirts does not stop
    /// being size M because merchandising stopped offering the size.
    #[serde(default)]
    pub active: Option<bool>,
}

fn term_from_row(row: PgRow) -> Result<MasterTerm, AppError> {
    Ok(MasterTerm {
        code: row.try_get("code")?,
        label: row.try_get("label")?,
        display_order: row.try_get("display_order")?,
        active: row.try_get("active")?,
        version: row.try_get("version")?,
        in_use: row.try_get("in_use")?,
    })
}

/// Unique violations here are always one of two things, and a bare 23505 tells
/// a merchandiser neither of them.
fn map_write_error(kind: Vocabulary, error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(format!(
                "that {} code, or one reading the same as that name, already exists",
                kind.subject().to_lowercase()
            )),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn required_label(kind: Vocabulary, raw: &str) -> Result<String, AppError> {
    let label = raw.trim();
    if label.is_empty() {
        return Err(AppError::Validation(format!(
            "a {} needs a name a human can read on a picking list",
            kind.subject().to_lowercase()
        )));
    }
    Ok(label.to_owned())
}

/// One term with the only figure that matters for retiring it.
fn term_query(kind: Vocabulary) -> String {
    format!(
        "SELECT v.code, v.label, v.display_order, v.active, v.version,
                {usage} AS in_use
           FROM {table} v WHERE v.code = $1",
        usage = kind.usage(),
        table = kind.table()
    )
}

/// The whole list, retired terms included.
pub async fn vocabulary_terms(
    pool: &PgPool,
    kind: Vocabulary,
) -> Result<MasterVocabulary, AppError> {
    let rows = sqlx::query(&format!(
        "SELECT v.code, v.label, v.display_order, v.active, v.version,
                {usage} AS in_use
           FROM {table} v
          ORDER BY v.display_order, v.label",
        usage = kind.usage(),
        table = kind.table()
    ))
    .fetch_all(pool)
    .await?;
    Ok(MasterVocabulary {
        terms: rows
            .into_iter()
            .map(term_from_row)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

/// Add a term.
///
/// Guarded by an idempotency key like every other write here: a merchandiser
/// whose browser retries a slow request must not end up with the term twice
/// under two codes, which is precisely the split these tables were built to
/// stop.
pub async fn create_term(
    pool: &PgPool,
    kind: Vocabulary,
    request: CreateTermRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<MasterTerm, AppError> {
    let code = kind.normalize_code(&request.code)?;
    let label = required_label(kind, &request.label)?;

    let mut transaction = pool.begin().await?;
    let operation = format!("{}.create", kind.table());
    if let Some(response) =
        begin_idempotent(&mut transaction, idempotency_key, &operation, digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    sqlx::query(&format!(
        "INSERT INTO {table} (code, label, display_order)
         VALUES ($1, $2,
                 COALESCE($3, (SELECT COALESCE(max(display_order), 0) + 10 FROM {table})))",
        table = kind.table()
    ))
    .bind(&code)
    .bind(&label)
    .bind(request.display_order)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_write_error(kind, error))?;
    // Read back rather than assembled here, so the row this answers with and
    // the row the next list shows cannot disagree about a default.
    let term = term_from_row(
        sqlx::query(&term_query(kind))
            .bind(&code)
            .fetch_one(&mut *transaction)
            .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&term)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(term)
}

/// Rename, reorder or retire a term.
///
/// There is deliberately no delete. A term with articles behind it cannot be
/// removed without leaving those rows pointing at nothing, and the foreign key
/// would refuse it anyway; retiring is the operation that means what people
/// actually want when they reach for delete.
pub async fn update_term(
    pool: &PgPool,
    kind: Vocabulary,
    code: &str,
    expected_version: i32,
    request: UpdateTermRequest,
    idempotency_key: &str,
    digest: &str,
) -> Result<MasterTerm, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let code = kind.normalize_code(code)?;
    let changes_label = request.label.is_some();
    let changes_order = request.display_order.is_some();
    let changes_active = request.active.is_some();
    if !(changes_label || changes_order || changes_active) {
        return Err(AppError::Validation(format!(
            "{} update must contain at least one field",
            kind.subject()
        )));
    }
    let label = request
        .label
        .as_deref()
        .map(|value| required_label(kind, value))
        .transpose()?;

    let mut transaction = pool.begin().await?;
    let operation = format!("{}.update", kind.table());
    if let Some(response) =
        begin_idempotent(&mut transaction, idempotency_key, &operation, digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let updated = sqlx::query_scalar::<_, i32>(&format!(
        "UPDATE {table} SET
             label         = CASE WHEN $3 THEN $4 ELSE label END,
             display_order = CASE WHEN $5 THEN $6 ELSE display_order END,
             active        = CASE WHEN $7 THEN $8 ELSE active END,
             version       = version + 1
         WHERE code = $1 AND version = $2
         RETURNING version",
        table = kind.table()
    ))
    .bind(&code)
    .bind(expected_version)
    .bind(changes_label)
    .bind(&label)
    .bind(changes_order)
    .bind(request.display_order)
    .bind(changes_active)
    .bind(request.active)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| map_write_error(kind, error))?;
    if updated.is_none() {
        let actual = sqlx::query_scalar::<_, i32>(&format!(
            "SELECT version FROM {table} WHERE code = $1",
            table = kind.table()
        ))
        .bind(&code)
        .fetch_optional(&mut *transaction)
        .await?;
        return Err(match actual {
            Some(actual) => AppError::Conflict(format!(
                "{} version is {actual}, not expected version {expected_version}",
                kind.subject()
            )),
            None => AppError::NotFound(kind.subject().to_owned()),
        });
    }
    let term = term_from_row(
        sqlx::query(&term_query(kind))
            .bind(&code)
            .fetch_one(&mut *transaction)
            .await?,
    )?;
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&term)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(term)
}
