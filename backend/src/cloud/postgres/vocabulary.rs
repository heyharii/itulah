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
            // SKUs, not articles (owner, 2026-10-05): a size is a property of the
            // variant, so the variants wearing it are the honest count.
            Self::Sizes => "(SELECT count(*) FROM sku s WHERE s.size_code = v.code)",
            Self::Tags => {
                "(SELECT count(DISTINCT t.article_id) FROM article_tag t WHERE t.tag_code = v.code)"
            }
        }
    }

    /// Count once for a master list rather than twice for every term. The
    /// single-term read still uses `usage`, where an indexed lookup is cheaper.
    fn usage_counts(self) -> &'static str {
        match self {
            Self::Divisions => {
                "SELECT division_code AS code, count(*) AS in_use FROM article GROUP BY division_code"
            }
            Self::Sizes => {
                "SELECT size_code AS code, count(*) AS in_use FROM sku GROUP BY size_code"
            }
            Self::Tags => {
                "SELECT tag_code AS code, count(DISTINCT article_id) AS in_use FROM article_tag GROUP BY tag_code"
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
    /// Whether anything has EVER pointed at this term — not whether anything
    /// does now. Set by the triggers in `0167` and never cleared, because the
    /// question "may this be deleted" is about the past: a tag that clothed
    /// eighty articles in 2025 and none today has `in_use = 0` and a history
    /// that reports, labels and receipts still read.
    pub ever_used: bool,
}

/// One value the list can be narrowed by, and how many terms it leaves.
///
/// Counted over what the SEARCH leaves, deliberately ignoring the filter
/// currently applied — so the number beside "Retired" answers "how many retired
/// terms are there", which is the question somebody has before clicking.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
}

/// The two things a vocabulary list can be narrowed by.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterFacets {
    /// `ACTIVE` and `RETIRED`.
    pub states: Vec<MasterFacet>,
    /// `IN_USE` and `UNUSED`. The figure that decides whether a term can be
    /// retired, offered as a filter so nobody reads down the list counting
    /// zeroes.
    pub usage: Vec<MasterFacet>,
}

/// What a caller is asking one of the three lists for.
///
/// Every field is optional and every default is what this route did before, so
/// a picker that asks for nothing still gets the whole list in one read.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MasterScope {
    /// Free text over the code and the name.
    ///
    /// **It never touches the code's spelling.** Matching is `ILIKE`, which
    /// compares; nothing here normalises, upper-cases or trims a stored code on
    /// the way past. These codes are foreign keys — `article.division_code`,
    /// `sku.size_code`, `article_tag.tag_code` — and a "tidy-up" applied while
    /// searching would be a silent rename of rows other tables point at.
    #[serde(default)]
    pub q: Option<String>,
    /// `true` for the terms still offered, `false` for the retired ones. Absent
    /// is both, which is what the master screen wants.
    #[serde(default)]
    pub active: Option<bool>,
    /// `order`, `label`, `code` or `in_use`. Anything else is `order` — the
    /// order the business reads them in — rather than a 400, so a stale
    /// bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent means ascending.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// One of the three lists, one page at a time.
///
/// **The page is the whole list in practice, and that is deliberate.** A
/// company has five divisions, a dozen sizes and a few dozen tags, and every
/// picker in this estate reads this route. The default limit is well above the
/// realistic ceiling; the shape is here for the honesty rather than the paging,
/// and `total` is how a picker can tell it got all of them.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterVocabulary {
    /// In `display_order`, then label — the order the business reads them in.
    ///
    /// Spelled `terms` rather than `rows` on purpose: every picker in three
    /// front ends reads this field, and renaming it buys nothing.
    pub terms: Vec<MasterTerm>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page —
    /// which, for a list this size, it almost always is.
    pub next_cursor: Option<String>,
    /// Every term the search and the filter match, not just this page.
    pub total: i64,
    pub facets: MasterFacets,
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
        ever_used: row.try_get("ever_used")?,
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
            // A delete the sweep thought was safe, refused by a constraint —
            // which means a table names this term and `reference_sites` does
            // not know about it. The constraint's own message names that table,
            // and is worth more than a sentence we could write here.
            Some("23503") => AppError::Conflict(format!(
                "something still points at that {}: {}",
                kind.subject().to_lowercase(),
                database.message()
            )),
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
        "SELECT v.code, v.label, v.display_order, v.active, v.version, v.ever_used,
                {usage} AS in_use
           FROM {table} v WHERE v.code = $1",
        usage = kind.usage(),
        table = kind.table()
    )
}

/// How many terms a caller is handed when they do not say, and the most they
/// can ask for. One spelling each, beside the only clamp that enforces them.
const TERM_DEFAULT_LIMIT: i64 = 500;
const TERM_MAX_LIMIT: i64 = 1_000;

/// Where the previous page stopped — as a ROW, not a position.
#[derive(Serialize, Deserialize)]
struct TermCursor {
    code: String,
}

impl TermCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One term row, defined once per list.
///
/// Built rather than a `const` because the table and the usage subquery differ
/// per vocabulary — and those two are the only things that differ, which is the
/// whole argument of this module's header. The page and the facet counts are
/// both drawn from it, which is what makes the facets honest: they count
/// exactly what the page can show.
///
/// It stops at the SEARCH; the `active` filter is applied outside, so the
/// filter panel's counts read what the search alone leaves.
///
/// Every column a sort can name is non-null: `code`, `label` and
/// `display_order` are `NOT NULL`, and `in_use` defaults to zero when no usage
/// group exists. A row comparison against NULL is NULL rather
/// than true, so a nullable sort key added here would end paging at the first
/// NULL, in silence.
///
/// Binds: `$1` the search pattern or NULL.
fn term_rows(kind: Vocabulary) -> String {
    format!(
        "SELECT v.code, v.label, v.display_order, v.active, v.version, v.ever_used,
                COALESCE(u.in_use, 0) AS in_use,
                CASE WHEN v.active THEN 'ACTIVE' ELSE 'RETIRED' END AS state,
                CASE WHEN COALESCE(u.in_use, 0) > 0 THEN 'IN_USE' ELSE 'UNUSED' END AS usage
           FROM {table} v
           LEFT JOIN ({counts}) u ON u.code = v.code
          WHERE ($1::text IS NULL OR v.code ILIKE $1 OR v.label ILIKE $1)",
        counts = kind.usage_counts(),
        table = kind.table()
    )
}

/// The whole list, retired terms included — one page at a time.
///
/// See [`MasterVocabulary`] on why the page is the whole list in practice.
pub async fn vocabulary_terms(
    pool: &PgPool,
    kind: Vocabulary,
    scope: MasterScope,
) -> Result<MasterVocabulary, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // code, which is the primary key, so no two rows can compare equal.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let lead = match scope.sort.as_deref() {
        Some("label") => "label",
        Some("code") => "code",
        Some("in_use") => "in_use",
        _ => "display_order",
    };
    let descending = scope.dir.as_deref() == Some("desc");
    let cols = if lead == "code" {
        "code".to_owned()
    } else {
        format!("{lead}, code")
    };
    let dir = if descending { "DESC" } else { "ASC" };
    let order = if lead == "code" {
        format!("code {dir}")
    } else {
        format!("{lead} {dir}, code {dir}")
    };
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(TermCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(TERM_DEFAULT_LIMIT)
        .clamp(1, TERM_MAX_LIMIT);
    let rows_sql = term_rows(kind);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let rows = sqlx::query(&format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE ($2::bool IS NULL OR active = $2)
         )
         SELECT * FROM kept
          WHERE $3::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE code = $3)
          ORDER BY {order}
          LIMIT $4"
    ))
    .bind(&needle)
    .bind(scope.active)
    .bind(cursor.as_ref().map(|one| one.code.clone()))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            TermCursor {
                code: row.try_get("code")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let counted = sqlx::query(&format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE ($2::bool IS NULL OR active = $2)
         )
         SELECT 'state' AS facet, state AS value, COUNT(*)::bigint AS n
           FROM searched GROUP BY state
          UNION ALL
         SELECT 'usage', usage, COUNT(*)::bigint FROM searched GROUP BY usage
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    ))
    .bind(&needle)
    .bind(scope.active)
    .fetch_all(pool)
    .await?;

    let mut total = 0i64;
    let (mut states, mut usage) = (Vec::new(), Vec::new());
    for row in &counted {
        let facet: String = row.try_get("facet")?;
        let one = MasterFacet {
            value: row.try_get("value")?,
            label: None,
            count: row.try_get("n")?,
        };
        match facet.as_str() {
            "state" => states.push(one),
            "usage" => usage.push(one),
            _ => total = one.count,
        }
    }
    for list in [&mut states, &mut usage] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }

    Ok(MasterVocabulary {
        terms: rows
            .into_iter()
            .map(term_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        next_cursor,
        total,
        facets: MasterFacets { states, usage },
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
/// The code is not editable and the label is: the code is what
/// `article.division_code`, `sku.size_code` and `article_tag.tag_code` hold, so
/// a code that moved would be a rename that lost the goods. A term whose code
/// is wrong and which has never been used can be deleted and written again —
/// see [`delete_term`].
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

// ---------------------------------------------------------------------------
// What speaks for a term, and what that permits.

/// One place a master value can be spoken for, and how loudly.
///
/// The count is of RECORDS, not of rows in a link table: two SKUs of an article
/// in the same colour is one article wearing it, and "2" there would read as
/// twice the commitment.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterReference {
    /// Stable, for a screen that wants to treat one of these specially.
    pub key: String,
    /// What it is called to somebody who does not know the schema.
    pub label: String,
    pub count: i64,
}

/// Everything that speaks for one term, and what may therefore be done to it.
///
/// # Why this is not `in_use`
///
/// `in_use` counts articles, and articles are one of five things that can name
/// a tag. A promotion can select on one — `Applicability::Tag` in the pricing
/// engine — and does so inside `commercial_rule.definition`, which is `jsonb`
/// and carries no foreign key at all. So "Articles: 0" has never been a licence
/// to delete, and this is the answer that is.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MasterUsage {
    pub code: String,
    /// Every place, including the ones counting zero. A screen that showed only
    /// the non-zero ones would say nothing where it most needs to be believed.
    pub references: Vec<MasterReference>,
    pub total: i64,
    /// See `MasterTerm::ever_used`. The half of this answer the counts cannot
    /// give.
    pub ever_used: bool,
    pub can_delete: bool,
    /// Why not, in a sentence somebody can act on. `None` when it can.
    pub blocked: Option<String>,
}

/// One place a code can be named, as a counting query.
///
/// `$1` is the code. Held as a table of `&'static str` rather than as a match
/// arm per list, because the whole point is that this is the WRITTEN-DOWN map
/// of what references what: adding a table that names a tag and not adding it
/// here is the bug this structure is meant to make visible.
struct ReferenceSite {
    key: &'static str,
    label: &'static str,
    sql: &'static str,
}

/// A promotion selecting on a division or a tag, found in the rule document.
///
/// `commercial_rule.definition` is the serialised engine `Rule`, so a rule that
/// applies to a tag reads
/// `{"scope":{"applicability":{"on":"TAG","tags":["DENIM"]}}}`. There is no
/// foreign key to follow — the engine takes a set of strings — which is exactly
/// why this has to be looked for rather than joined to.
///
/// `effect_on` is checked as well as `applicability`: "buy a suit, get 50% off
/// a shirt" names the shirts there, and a tag named only in that half is just
/// as spoken for.
///
/// Distinct `rule_id`, not rows: one rule republished eleven times is one rule.
const PROMOTIONS_BY_TAG: &str = "
    SELECT count(DISTINCT r.rule_id) FROM commercial_rule r
     WHERE (r.definition->'scope'->'applicability'->>'on' = 'TAG'
            AND r.definition->'scope'->'applicability'->'tags' @> to_jsonb($1::text))
        OR (r.definition->'scope'->'effect_on'->>'on' = 'TAG'
            AND r.definition->'scope'->'effect_on'->'tags' @> to_jsonb($1::text))";

const PROMOTIONS_BY_DIVISION: &str = "
    SELECT count(DISTINCT r.rule_id) FROM commercial_rule r
     WHERE (r.definition->'scope'->'applicability'->>'on' = 'DIVISION'
            AND r.definition->'scope'->'applicability'->'divisions' @> to_jsonb($1::text))
        OR (r.definition->'scope'->'effect_on'->>'on' = 'DIVISION'
            AND r.definition->'scope'->'effect_on'->'divisions' @> to_jsonb($1::text))";

impl Vocabulary {
    /// Every table and document that can name a term of this list.
    ///
    /// Mirrors the trigger map in `0167`, with the promotion rules added: those
    /// have no foreign key, so nothing marks `ever_used` for them and nothing
    /// but this query can see them.
    fn reference_sites(self) -> &'static [ReferenceSite] {
        match self {
            Self::Divisions => &[
                ReferenceSite {
                    key: "articles",
                    label: "Articles",
                    sql: "SELECT count(*) FROM article WHERE division_code = $1",
                },
                ReferenceSite {
                    key: "setups",
                    label: "Article setups",
                    sql: "SELECT count(*) FROM article_setup_session WHERE division_code = $1",
                },
                ReferenceSite {
                    key: "order_lines",
                    label: "Purchase order lines",
                    sql: "SELECT count(*) FROM purchase_order_line WHERE division_code = $1",
                },
                ReferenceSite {
                    key: "supplier_items",
                    label: "Supplier items",
                    sql: "SELECT count(*) FROM supplier_item WHERE division_code = $1",
                },
                ReferenceSite {
                    key: "promotions",
                    label: "Promotion rules",
                    sql: PROMOTIONS_BY_DIVISION,
                },
            ],
            Self::Sizes => &[
                ReferenceSite {
                    key: "skus",
                    label: "SKUs",
                    sql: "SELECT count(*) FROM sku WHERE size_code = $1",
                },
                ReferenceSite {
                    key: "setups",
                    label: "Article setups",
                    sql: "SELECT count(DISTINCT session_id) FROM article_setup_variant \
                          WHERE size_code = $1",
                },
                ReferenceSite {
                    key: "supplier_items",
                    label: "Supplier items",
                    sql: "SELECT count(DISTINCT supplier_item_id) FROM supplier_item_size \
                          WHERE size_code = $1",
                },
            ],
            Self::Tags => &[
                ReferenceSite {
                    key: "articles",
                    label: "Articles",
                    sql: "SELECT count(DISTINCT article_id) FROM article_tag WHERE tag_code = $1",
                },
                ReferenceSite {
                    key: "setups",
                    label: "Article setups",
                    sql: "SELECT count(DISTINCT session_id) FROM article_setup_session_tag \
                          WHERE tag_code = $1",
                },
                ReferenceSite {
                    key: "order_lines",
                    label: "Purchase order lines",
                    sql: "SELECT count(DISTINCT po_line_id) FROM purchase_order_line_tag \
                          WHERE tag_code = $1",
                },
                ReferenceSite {
                    key: "supplier_items",
                    label: "Supplier items",
                    sql: "SELECT count(DISTINCT supplier_item_id) FROM supplier_item_tag \
                          WHERE tag_code = $1",
                },
                ReferenceSite {
                    key: "documents",
                    label: "Documents",
                    sql: "SELECT count(DISTINCT document_id) FROM document_tag WHERE tag_code = $1",
                },
                ReferenceSite {
                    key: "promotions",
                    label: "Promotion rules",
                    sql: PROMOTIONS_BY_TAG,
                },
            ],
        }
    }
}

/// Count every reference to one code, in one place so the answer cannot differ
/// between the screen that shows it and the delete that enforces it.
///
/// One query per site rather than one query with five subselects: the lists are
/// short, the sites differ per vocabulary, and a `UNION ALL` built by string
/// concatenation would be the same code with a place for a comma to go missing.
async fn master_references(
    connection: &mut sqlx::PgConnection,
    sites: &[ReferenceSite],
    code: &str,
) -> Result<Vec<MasterReference>, AppError> {
    let mut references = Vec::with_capacity(sites.len());
    for site in sites {
        let count: i64 = sqlx::query_scalar(site.sql)
            .bind(code)
            .fetch_one(&mut *connection)
            .await?;
        references.push(MasterReference {
            key: site.key.to_owned(),
            label: site.label.to_owned(),
            count,
        });
    }
    Ok(references)
}

/// A reference label as it reads after a number.
///
/// The labels are plural because they head a column of counts — "Articles",
/// "Promotion rules" — and "1 promotion rules" is the kind of sentence that
/// makes a reader distrust the number in front of it. Dropping a trailing `s`
/// is enough for every label in this file, and there is no ambition here
/// beyond that: a label needing more can spell its own singular.
fn counted(label: &str, count: i64) -> String {
    let lower = label.to_lowercase();
    if count == 1 {
        lower.strip_suffix('s').map(str::to_owned).unwrap_or(lower)
    } else {
        lower
    }
}

/// The sentence a refusal is worth, or `None` when there is nothing to refuse.
///
/// Written once because it is said twice: the screen asks before drawing a
/// Delete button, and the handler asks again before honouring one. Two spellings
/// of the rule is a screen that offers what the server refuses.
pub fn deletion_refusal(
    subject: &str,
    references: &[MasterReference],
    ever_used: bool,
) -> Option<String> {
    let spoken: Vec<&MasterReference> = references.iter().filter(|one| one.count > 0).collect();
    if !spoken.is_empty() {
        let named = spoken
            .iter()
            .map(|one| format!("{} {}", one.count, counted(one.label.as_str(), one.count)))
            .collect::<Vec<_>>()
            .join(", ");
        return Some(format!(
            "this {} is named by {named}. Retire it instead: everything already \
             pointing at it keeps reading it, and nothing new may choose it",
            subject.to_lowercase()
        ));
    }
    if ever_used {
        return Some(format!(
            "nothing points at this {} today, but something once did — a report, \
             a printed label or an audit line may still read it. Retire it instead",
            subject.to_lowercase()
        ));
    }
    None
}

/// What speaks for one term, and whether it may be deleted.
pub async fn term_usage(
    pool: &PgPool,
    kind: Vocabulary,
    code: &str,
) -> Result<MasterUsage, AppError> {
    let code = kind.normalize_code(code)?;
    let ever_used: bool = sqlx::query_scalar(&format!(
        "SELECT ever_used FROM {table} WHERE code = $1",
        table = kind.table()
    ))
    .bind(&code)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(kind.subject().to_owned()))?;

    let mut connection = pool.acquire().await?;
    let references = master_references(&mut connection, kind.reference_sites(), &code).await?;
    let total = references.iter().map(|one| one.count).sum();
    let blocked = deletion_refusal(kind.subject(), &references, ever_used);
    Ok(MasterUsage {
        code,
        references,
        total,
        ever_used,
        can_delete: blocked.is_none(),
        blocked,
    })
}

/// Delete a term that has never meant anything.
///
/// # The rule, and why it is this one
///
/// A master value that has ever had business meaning does not leave: a division
/// nothing is filed under today still names twelve thousand transactions in last
/// year's report, and a size code is two characters of every SKU minted in it.
/// So the only deletable term is one that was created and never used — the typo
/// somebody notices a minute later, which until now could only be retired,
/// leaving a permanent misspelling in a list of thirty.
///
/// Both halves are checked, and the second is the one that is easy to miss:
/// nothing referencing it NOW is not the same as nothing ever having done. See
/// `MasterTerm::ever_used`.
///
/// The row is locked before the sweep and the delete happens under the same
/// lock, so a colourway being saved in another tab cannot land between the two.
/// The foreign keys are still the backstop: if a table names this term and is
/// missing from `reference_sites`, the delete fails on the constraint rather
/// than succeeding, and the error names the table that was forgotten.
pub async fn delete_term(
    pool: &PgPool,
    kind: Vocabulary,
    code: &str,
    expected_version: i32,
) -> Result<(), AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let code = kind.normalize_code(code)?;
    let mut transaction = pool.begin().await?;

    let found: Option<(i32, bool)> = sqlx::query_as(&format!(
        "SELECT version, ever_used FROM {table} WHERE code = $1 FOR UPDATE",
        table = kind.table()
    ))
    .bind(&code)
    .fetch_optional(&mut *transaction)
    .await?;
    let (version, ever_used) =
        found.ok_or_else(|| AppError::NotFound(kind.subject().to_owned()))?;
    if version != expected_version {
        return Err(AppError::Conflict(format!(
            "{} version is {version}, not expected version {expected_version}",
            kind.subject()
        )));
    }

    let references = master_references(&mut transaction, kind.reference_sites(), &code).await?;
    if let Some(refusal) = deletion_refusal(kind.subject(), &references, ever_used) {
        return Err(AppError::Conflict(refusal));
    }

    sqlx::query(&format!(
        "DELETE FROM {table} WHERE code = $1",
        table = kind.table()
    ))
    .bind(&code)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_write_error(kind, error))?;
    transaction.commit().await?;
    Ok(())
}
