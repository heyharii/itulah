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

use super::vocabulary::{deletion_refusal, MasterReference, MasterUsage};
use super::{begin_idempotent, complete_idempotent, NullablePatch};
use crate::cloud::application::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgRow, PgPool, Row};

/// One colour, and how much of the catalogue is wearing it.
///
/// `in_use` counts SKUs (owner, 2026-10-05: "in use berapa SKU"): the
/// variants of every article that are this colour. It still answers "is
/// anything filed under this" — zero SKUs is zero articles wearing it.
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
    /// Whether anything has EVER worn this colour — not whether anything does
    /// now. Set by the triggers in `0167` and never cleared. See
    /// `MasterTerm::ever_used`; the rule is the same one, and for colours it
    /// bites hardest: a colour that has been on a garment is on a printed
    /// label somewhere.
    pub ever_used: bool,
}

/// One value the master can be narrowed by, and how many colours it leaves.
///
/// Counted over what the SEARCH leaves, deliberately ignoring which filter is
/// currently applied — so the number beside "Retired" answers "how many retired
/// colours are there", which is the question somebody has before clicking.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColourFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the colour master can be narrowed by.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColourFacets {
    /// `ACTIVE` and `RETIRED`.
    pub states: Vec<ColourFacet>,
    /// `IN_USE` and `UNUSED` — whether any article is filed under the colour.
    /// The figure that decides whether a colour can be retired, offered as a
    /// filter so nobody has to read down the list counting zeroes.
    pub usage: Vec<ColourFacet>,
}

/// What a caller is asking the colour master for.
///
/// Every field is optional and every default is what this route did before, so
/// a picker that asks for nothing still gets the whole master in one read.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColourScope {
    /// Free text over the code and the name. Both, because a colour is looked
    /// up by whichever of the two somebody is holding.
    #[serde(default)]
    pub q: Option<String>,
    /// `true` for the colours still in use as a choice, `false` for the retired
    /// ones. Absent is both, which is what the master screen wants: a
    /// retirement nobody can find is a retirement nobody can undo.
    #[serde(default)]
    pub active: Option<bool>,
    /// `order`, `label`, `code` or `in_use`. Anything else is `order` — the
    /// business reads colours in families, and alphabetical order shatters that
    /// into a list nobody can scan. A stale bookmark gets that rather than a
    /// 400.
    #[serde(default)]
    pub sort: Option<String>,
    /// `desc` and nothing else. Absent means ascending, which is the direction
    /// a vocabulary is in before anybody touches it.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// The colours an article may be made in, one page at a time.
///
/// **The page is the whole master in practice, and that is deliberate.** A
/// company has a hundred colours, not a hundred thousand, and half the callers
/// of this route are pickers that cannot draw themselves from a page. So the
/// default limit is well above the realistic ceiling and the shape is here for
/// the honesty rather than for the paging: `total` is how a picker can tell it
/// got all of them, which it previously could not.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ColourVocabulary {
    /// In `display_order`, then label. The business reads colours in families —
    /// the neutrals together, then the blues — and alphabetical order shatters
    /// that into a list nobody can scan.
    ///
    /// Spelled `colours` rather than `rows`, and that is not laziness: this
    /// field is read by every picker in three front ends, and a master data
    /// rename is the one change here that cannot be made cheaply.
    pub colours: Vec<ColourTerm>,
    /// Opaque. Pass it back as `cursor`; absent means this was the last page —
    /// which, for a master this size, it almost always is.
    pub next_cursor: Option<String>,
    /// Every colour the search and the filter match, not just this page.
    pub total: i64,
    pub facets: ColourFacets,
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
        ever_used: row.try_get("ever_used")?,
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

/// How many colours a caller is handed when they do not say, and the most they
/// can ask for. One spelling each, beside the only clamp that enforces them.
///
/// Five hundred rather than the two hundred a transactional list gets, because
/// every picker in this estate reads this route and a picker clamped to a page
/// would silently drop colourways out of a dropdown. The company has two dozen.
const COLOUR_DEFAULT_LIMIT: i64 = 500;
const COLOUR_MAX_LIMIT: i64 = 1_000;

/// Where the previous page stopped — as a ROW, not a position.
#[derive(Serialize, Deserialize)]
struct ColourCursor {
    code: String,
}

impl ColourCursor {
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

/// One colour row, defined once.
///
/// Used by the page query and by the facet counts, which is the whole reason it
/// is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// One query rather than a list plus a count per row: a picker needs the usage
/// figures to draw itself at all, and asking for them one colour at a time is a
/// hundred round trips for a screen that shows one list.
///
/// It stops at the SEARCH. The `active` filter is applied outside by each
/// caller, so one definition answers two questions — the page wants what the
/// filter leaves, the filter panel wants what the search alone leaves.
///
/// Every column a sort can name is non-null: `code`, `label` and
/// `display_order` are `NOT NULL` in the table, and `in_use` is `COALESCE`d to
/// zero here. That last one is the rule that is easy to miss and expensive to
/// find — a row comparison against NULL is NULL rather than true, so the LEFT
/// JOIN's absent rows would end paging at the first colour nothing is filed
/// under, silently, with the rest of the master below the fold.
///
/// Binds: `$1` the search pattern or NULL.
const COLOUR_ROWS: &str = "
    SELECT c.code, c.label, c.hex_code, c.display_order, c.active, c.version, c.ever_used,
           COALESCE(u.skus, 0) AS in_use,
           CASE WHEN c.active THEN 'ACTIVE' ELSE 'RETIRED' END AS state,
           CASE WHEN COALESCE(u.skus, 0) > 0 THEN 'IN_USE' ELSE 'UNUSED' END AS usage
      FROM colour c
      LEFT JOIN (
          SELECT ac.colour_code, count(s.id) AS skus
            FROM article_colour ac
            JOIN sku s ON s.article_id = ac.article_id AND s.colour_digit = ac.colour_digit
           GROUP BY ac.colour_code
      ) u ON u.colour_code = c.code
     WHERE ($1::text IS NULL OR c.code ILIKE $1 OR c.label ILIKE $1)
";

/// The whole master, retired colours included — one page at a time.
///
/// See [`ColourVocabulary`] on why the page is the whole master in practice.
pub async fn colour_vocabulary(
    pool: &PgPool,
    scope: ColourScope,
) -> Result<ColourVocabulary, AppError> {
    // A blank search is not a search: `Some("")` compiles to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // code, which is the primary key, so no two rows can compare equal — which
    // is what stops a keyset repeating or losing the rows that tie.
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
        .map(ColourCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(COLOUR_DEFAULT_LIMIT)
        .clamp(1, COLOUR_MAX_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({COLOUR_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE ($2::bool IS NULL OR active = $2)
         )
         SELECT * FROM kept
          WHERE $3::text IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE code = $3)
          ORDER BY {order}
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(scope.active)
        .bind(cursor.as_ref().map(|one| one.code.clone()))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            ColourCursor {
                code: row.try_get("code")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let counted = sqlx::query(&format!(
        "WITH searched AS ({COLOUR_ROWS}), kept AS (
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
        let one = ColourFacet {
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

    Ok(ColourVocabulary {
        colours: rows
            .into_iter()
            .map(colour_from_row)
            .collect::<Result<Vec<_>, _>>()?,
        next_cursor,
        total,
        facets: ColourFacets { states, usage },
    })
}

/// One colour with the only figure that matters for retiring it.
const COLOUR_WITH_USAGE: &str = "
    SELECT c.code, c.label, c.hex_code, c.display_order, c.active, c.version, c.ever_used,
           (SELECT count(s.id) FROM article_colour ac
              JOIN sku s ON s.article_id = ac.article_id AND s.colour_digit = ac.colour_digit
             WHERE ac.colour_code = c.code) AS in_use
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

// ---------------------------------------------------------------------------

/// Every table that can name a colour, and what to call it on screen.
///
/// Three, and no promotion rule among them: the pricing engine's
/// `Applicability` can select on a SKU, an article, a division or a tag, and
/// there is no colour arm. If one is ever added, it belongs here — see
/// `PROMOTIONS_BY_TAG` in `vocabulary.rs` for the shape of that query.
const COLOUR_REFERENCE_SITES: &[(&str, &str, &str)] = &[
    (
        "articles",
        "Articles",
        "SELECT count(DISTINCT article_id) FROM article_colour WHERE colour_code = $1",
    ),
    (
        "setups",
        "Article setups",
        "SELECT count(DISTINCT session_id) FROM article_setup_colour WHERE colour_code = $1",
    ),
    (
        "supplier_items",
        "Supplier items",
        "SELECT count(DISTINCT supplier_item_id) FROM supplier_item_colour WHERE colour_code = $1",
    ),
];

async fn colour_references(
    connection: &mut sqlx::PgConnection,
    code: &str,
) -> Result<Vec<MasterReference>, AppError> {
    let mut references = Vec::with_capacity(COLOUR_REFERENCE_SITES.len());
    for (key, label, sql) in COLOUR_REFERENCE_SITES {
        let count: i64 = sqlx::query_scalar(sql)
            .bind(code)
            .fetch_one(&mut *connection)
            .await?;
        references.push(MasterReference {
            key: (*key).to_owned(),
            label: (*label).to_owned(),
            count,
        });
    }
    Ok(references)
}

/// What speaks for one colour, and whether it may be deleted.
pub async fn colour_usage(pool: &PgPool, code: &str) -> Result<MasterUsage, AppError> {
    let code = normalize_colour_code(code)?;
    let ever_used: bool = sqlx::query_scalar("SELECT ever_used FROM colour WHERE code = $1")
        .bind(&code)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Colour".to_owned()))?;

    let mut connection = pool.acquire().await?;
    let references = colour_references(&mut connection, &code).await?;
    let total = references.iter().map(|one| one.count).sum();
    let blocked = deletion_refusal("Colour", &references, ever_used);
    Ok(MasterUsage {
        code,
        references,
        total,
        ever_used,
        can_delete: blocked.is_none(),
        blocked,
    })
}

/// Delete a colour that has never been worn.
///
/// The colour master's own header says colours are picked and never typed, and
/// that the list only ever grows. This is the one exception the owner asked for
/// on 2026-09-12, and it is narrow on purpose: a colour that has ever reached a
/// garment is on a printed label and inside a colourway somebody can still
/// scan, so it may only be retired. What may be removed is the row created a
/// minute ago with the word spelt wrong — which, before this, was a permanent
/// entry in a list of twenty-four.
///
/// The same two checks as `delete_term`, under the same lock, for the same
/// reasons.
pub async fn delete_colour(
    pool: &PgPool,
    code: &str,
    expected_version: i32,
) -> Result<(), AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let code = normalize_colour_code(code)?;
    let mut transaction = pool.begin().await?;

    let found: Option<(i32, bool)> =
        sqlx::query_as("SELECT version, ever_used FROM colour WHERE code = $1 FOR UPDATE")
            .bind(&code)
            .fetch_optional(&mut *transaction)
            .await?;
    let (version, ever_used) = found.ok_or_else(|| AppError::NotFound("Colour".to_owned()))?;
    if version != expected_version {
        return Err(AppError::Conflict(format!(
            "Colour version is {version}, not expected version {expected_version}"
        )));
    }

    let references = colour_references(&mut transaction, &code).await?;
    if let Some(refusal) = deletion_refusal("Colour", &references, ever_used) {
        return Err(AppError::Conflict(refusal));
    }

    sqlx::query("DELETE FROM colour WHERE code = $1")
        .bind(&code)
        .execute(&mut *transaction)
        .await
        .map_err(map_colour_write_error)?;
    transaction.commit().await?;
    Ok(())
}
