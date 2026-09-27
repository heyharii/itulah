//! Running a report, and keeping one.
//!
//! Two jobs that look related and are not. Running is pure: a validated spec
//! plus today's date produce one query and its rows, and nothing is written.
//! Keeping is the append-only half — a report points at its current version,
//! and every version ever written is still there, because "why is last month's
//! figure different" has to have an answer.
//!
//! Beside `reports.rs`, not inside it: that file answers three fixed questions
//! about sales and always will. This one answers whatever a spec asks.

use crate::cloud::application::AppError;
use crate::cloud::reports::{
    catalogue::CATALOGUE_VERSION,
    compile::{compile, Param},
    spec::{check, with_overlay, Filter, ReportSpec},
};
use chrono::{DateTime, Utc};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use serde::Serialize;
use serde_json::{json, Map, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Now, on the business clock the reports use.
/// Run a spec and answer with its rows, its columns and what it resolved to.
///
/// The resolved period travels back with the rows on purpose: a report saying
/// "last 14 days" has to be able to tell a reader which fourteen days it just
/// meant, or the figure cannot be checked against anything.
///
/// `now` is the business instant the report measures against — the caller's
/// clock, so a report under a virtual clock answers with virtual history.
pub async fn run_spec(
    pool: &PgPool,
    spec: &ReportSpec,
    overlay: &[Filter],
    now: DateTime<Utc>,
) -> Result<Value, AppError> {
    // The reader's narrowing, joined to the report's own. Two lists rather than
    // one because they mean different things: the spec's filters are part of
    // what the report IS, and the overlay is what somebody is looking at right
    // now. Merging them here — and nowhere else — is what makes the row ceiling
    // stop mattering: the narrowing happens in the database, so a match on the
    // six-thousandth row is found rather than cut off before the browser sees
    // it.
    let narrowed = with_overlay(spec, overlay);
    let spec = &narrowed;
    let checked = check(spec).map_err(|problems| AppError::Validation(problems.join("; ")))?;
    // Head office's clock: a report is the company's (`site.timezone`, 0603).
    let offset = super::sites::business_utc_offset_minutes(pool, None, now).await?;
    let day = crate::cloud::reports::compile::business_day(now, offset);
    let query = compile(&checked, now, offset);

    let mut statement = sqlx::query(&query.sql);
    for parameter in &query.params {
        statement = match parameter {
            Param::Text(value) => statement.bind(value.clone()),
            Param::Texts(values) => statement.bind(values.clone()),
            Param::Int(value) => statement.bind(*value),
            Param::Date(value) => statement.bind(*value),
        };
    }

    let rows = statement.fetch_all(pool).await?;
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut object = Map::new();
            for (index, column) in query.columns.iter().enumerate() {
                let value = if column.role == "measure" {
                    row.try_get::<Option<Decimal>, _>(index)
                        .ok()
                        .flatten()
                        .map(number)
                        .unwrap_or(Value::Null)
                } else {
                    row.try_get::<Option<String>, _>(index)
                        .ok()
                        .flatten()
                        .map(Value::String)
                        .unwrap_or(Value::Null)
                };
                object.insert(column.key.clone(), value);
            }
            Value::Object(object)
        })
        .collect();

    // The headline figures, computed by the database rather than by adding up
    // the rows above. Averages and ratios are the reason: `units_per_sale`
    // summed across fourteen days is not the fortnight's figure, and a browser
    // that summed it would be confidently wrong in a way nobody would notice.
    // Computed over the narrowed set, not the report's own. A KPI that ignored
    // the filter chips above it would disagree with the column under it, and
    // the reader would have no way to tell which one was lying.
    let totals = if spec.present.kpis.is_empty() {
        Value::Null
    } else {
        totals_for(pool, spec, now).await?
    };

    let period = checked.spec.period.resolve(day);
    Ok(json!({
        "columns": query.columns,
        "totals": totals,
        "rows": items,
        "row_count": items.len(),
        // Truthful about being cut off. A report that silently returns its
        // first five thousand rows is a report somebody will average.
        "truncated": items.len() as i64 >= checked.limit,
        "as_of": day,
        "period": period.map(|(from, to)| json!({ "from": from, "to": to })),
        "catalogue_version": CATALOGUE_VERSION,
    }))
}

/// The same spec with its grouping removed: one row, over the whole period.
async fn totals_for(
    pool: &PgPool,
    spec: &ReportSpec,
    now: DateTime<Utc>,
) -> Result<Value, AppError> {
    let mut flat = spec.clone();
    flat.group_by = Vec::new();
    flat.grain = crate::cloud::reports::spec::Grain::None;
    flat.sort = None;
    flat.limit = Some(1);
    // Only the measures the KPIs actually name, so a report with twelve
    // measures and two headline figures does not pay for twelve aggregates.
    flat.measures = spec.present.kpis.clone();
    flat.present = Default::default();

    let checked = check(&flat).map_err(|problems| AppError::Validation(problems.join("; ")))?;
    let offset = super::sites::business_utc_offset_minutes(pool, None, now).await?;
    let query = compile(&checked, now, offset);
    let mut statement = sqlx::query(&query.sql);
    for parameter in &query.params {
        statement = match parameter {
            Param::Text(value) => statement.bind(value.clone()),
            Param::Texts(values) => statement.bind(values.clone()),
            Param::Int(value) => statement.bind(*value),
            Param::Date(value) => statement.bind(*value),
        };
    }
    let Some(row) = statement.fetch_optional(pool).await? else {
        return Ok(Value::Null);
    };
    let mut object = Map::new();
    for (index, column) in query.columns.iter().enumerate() {
        let value = row
            .try_get::<Option<Decimal>, _>(index)
            .ok()
            .flatten()
            .map(number)
            .unwrap_or(Value::Null);
        object.insert(column.key.clone(), value);
    }
    Ok(Value::Object(object))
}

/// A Postgres numeric as JSON. Whole numbers stay whole — money here is an
/// integer count of rupiah, and `8225000.0` in a payload invites somebody to
/// treat it as a float and lose the last digit.
fn number(value: Decimal) -> Value {
    if value.fract().is_zero() {
        return value
            .to_i64()
            .map(Value::from)
            .unwrap_or_else(|| Value::String(value.to_string()));
    }
    value
        .to_f64()
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

// ---- Keeping one -------------------------------------------------------

pub struct NewReport<'a> {
    pub name: &'a str,
    pub spec: &'a ReportSpec,
    pub owner: &'a str,
    /// The sentence this came from, when a model composed it. Null when a
    /// person built it by hand — which is exactly the distinction worth being
    /// able to make later.
    pub prompt: Option<&'a str>,
    pub model: Option<&'a str>,
}

/// Save a new report at version 1.
pub async fn create(pool: &PgPool, new: NewReport<'_>) -> Result<Value, AppError> {
    check(new.spec).map_err(|problems| AppError::Validation(problems.join("; ")))?;
    let spec = serde_json::to_value(new.spec)?;
    let id = Uuid::new_v4();

    // One transaction, and the deferred foreign key is what lets the report row
    // name a version that is written a statement later.
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO report (report_id, name, owner_username, current_version)
         VALUES ($1, $2, $3, 1)",
    )
    .bind(id)
    .bind(new.name)
    .bind(new.owner)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO report_version
             (report_id, version, spec, catalogue_version, authored_by, prompt, model)
         VALUES ($1, 1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(&spec)
    .bind(CATALOGUE_VERSION)
    .bind(new.owner)
    .bind(new.prompt)
    .bind(new.model)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    read(pool, id, new.owner).await
}

/// Append a version and make it current. The previous one is kept.
pub async fn revise(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
    spec: &ReportSpec,
    prompt: Option<&str>,
    model: Option<&str>,
) -> Result<Value, AppError> {
    check(spec).map_err(|problems| AppError::Validation(problems.join("; ")))?;
    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner_username FROM report WHERE report_id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(owner) = owner else {
        return Err(AppError::NotFound("no such report".into()));
    };
    // Sharing widens who may read, never who may write.
    if owner != actor {
        return Err(AppError::Forbidden(
            "only the owner may edit this report".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    let next: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM report_version WHERE report_id = $1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO report_version
             (report_id, version, spec, catalogue_version, authored_by, prompt, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(next)
    .bind(serde_json::to_value(spec)?)
    .bind(CATALOGUE_VERSION)
    .bind(actor)
    .bind(prompt)
    .bind(model)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE report SET current_version = $2, updated_at = now() WHERE report_id = $1")
        .bind(id)
        .bind(next)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    read(pool, id, actor).await
}

// ── the saved list ───────────────────────────────────────────────────────
//
// The same envelope as the finance lists — rows, a cursor, a total and facet
// counts — and, for the first time on this route, a TYPED row. It answered
// with a hand-built `json!` before, which is how the browser ended up with a
// hand-written mirror of a shape nothing generated.

/// How many reports the list returns when the caller does not say.
const DEFAULT_REPORT_LIMIT: i64 = 100;
/// And the most it will return however loudly a caller asks.
const MAX_REPORT_LIMIT: i64 = 500;

/// One saved report, as the list shows it.
///
/// Deliberately not the whole report: the spec is the big part and the list
/// does not draw it. `dataset` is lifted out of the current version's spec
/// because it is the one thing about a report somebody scans a list for —
/// "which of these are about sales".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavedReportRow {
    pub report_id: Uuid,
    pub name: String,
    pub owner: String,
    /// Visible to everybody, rather than only to its owner.
    pub shared: bool,
    /// Which version is the current one. Every earlier one is still there —
    /// "why is last month's figure different" has to have an answer.
    pub version: i32,
    pub dataset: Option<String>,
    /// The sentence this came from, when the assistant composed it. Absent for
    /// one somebody built by hand, which is a real difference and not a
    /// missing field.
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// What a caller is asking the saved list for.
#[derive(Clone, Debug, Default)]
pub struct SavedReportScope {
    /// Free text, tried against the report's name, its owner and the sentence
    /// it was composed from.
    pub needle: Option<String>,
    /// Datasets to keep — the catalogue's own names. Empty means every
    /// dataset.
    pub datasets: Vec<String>,
    /// Owners to keep, by username.
    pub owners: Vec<String>,
    /// `MINE` or `SHARED`. Empty means both, which is what the list has always
    /// answered: everything this person owns, plus everything anybody has
    /// shared.
    ///
    /// Not a widening of what a caller can see. The reach is applied first and
    /// separately — see [`saved_report_page`] — so `SHARED` narrows what is
    /// already visible rather than reaching past it.
    pub scopes: Vec<String>,
    /// `name`, `created` or `owner`. Anything else is the house order, most
    /// recently edited first.
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_REPORT_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many reports would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavedReportFacet {
    pub value: String,
    pub label: Option<String>,
    pub count: i64,
}

/// The three things the saved list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavedReportFacets {
    pub datasets: Vec<SavedReportFacet>,
    pub owners: Vec<SavedReportFacet>,
    pub scopes: Vec<SavedReportFacet>,
}

/// A page of the saved list, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SavedReportPage {
    pub rows: Vec<SavedReportRow>,
    pub next_cursor: Option<String>,
    /// Every report this caller can see that the search and the filters match.
    pub total: i64,
    pub facets: SavedReportFacets,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(serde::Serialize, serde::Deserialize)]
struct SavedReportCursor {
    report_id: Uuid,
}

impl SavedReportCursor {
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

/// One saved-list row, defined once, so the facets count exactly what the page
/// can show.
///
/// Binds: `$1` the caller's username, `$2` the search pattern or NULL.
///
/// **The reach is inside this definition and not beside it.** `$1` is who is
/// asking, applied here where no filter and no sort can reach around it — a
/// caller's own reports plus everything shared, and nothing else. A filter
/// applied outside it can only ever narrow that.
const SAVED_REPORT_ROWS: &str = "
    SELECT r.report_id, r.name, r.owner_username AS owner, r.shared,
           r.current_version AS version, r.created_at, r.updated_at,
           v.prompt, v.model, v.spec->>'dataset' AS dataset,
           CASE WHEN r.owner_username = $1 THEN 'MINE' ELSE 'SHARED' END AS scope
      FROM report r
      JOIN report_version v
        ON v.report_id = r.report_id AND v.version = r.current_version
     WHERE r.archived_at IS NULL
       AND (r.owner_username = $1 OR r.shared)
       AND ($2::text IS NULL
            OR r.name ILIKE $2
            OR r.owner_username ILIKE $2
            OR v.prompt ILIKE $2)
";

fn to_saved_report(row: &sqlx::postgres::PgRow) -> Result<SavedReportRow, AppError> {
    Ok(SavedReportRow {
        report_id: row.try_get("report_id")?,
        name: row.try_get("name")?,
        owner: row.try_get("owner")?,
        shared: row.try_get("shared")?,
        version: row.try_get("version")?,
        dataset: row.try_get("dataset")?,
        prompt: row.try_get("prompt")?,
        model: row.try_get("model")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// Every report this person can open, a page at a time.
pub async fn saved_report_page(
    pool: &PgPool,
    actor: &str,
    scope: SavedReportScope,
) -> Result<SavedReportPage, AppError> {
    // A blank search is not a search.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let datasets = (!scope.datasets.is_empty()).then(|| scope.datasets.clone());
    let owners = (!scope.owners.is_empty()).then(|| scope.owners.clone());
    let scopes = (!scope.scopes.is_empty()).then(|| scope.scopes.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // report id, which is the primary key.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("name") => ("name", scope.desc),
        Some("created") => ("created_at", scope.desc),
        Some("owner") => ("owner", scope.desc),
        // The house order, and the one this endpoint has always answered in:
        // most recently edited first. `dir` is not read — a default order that
        // reverses is not a default.
        _ => ("updated_at", true),
    };
    let cols = format!("{lead}, report_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, report_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(SavedReportCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_REPORT_LIMIT)
        .clamp(1, MAX_REPORT_LIMIT);

    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({SAVED_REPORT_ROWS}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($3::text[] IS NULL OR dataset = ANY($3))
                AND ($4::text[] IS NULL OR owner = ANY($4))
                AND ($5::text[] IS NULL OR scope = ANY($5))
         )
         SELECT * FROM kept
          WHERE $6::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE report_id = $6)
          ORDER BY {order}
          LIMIT $7"
    );
    let rows = sqlx::query(&sql)
        .bind(actor)
        .bind(&needle)
        .bind(&datasets)
        .bind(&owners)
        .bind(&scopes)
        .bind(cursor.as_ref().map(|c| c.report_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            SavedReportCursor {
                report_id: row.try_get("report_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows
        .iter()
        .map(to_saved_report)
        .collect::<Result<Vec<_>, _>>()?;
    let (total, facets) = saved_report_facets(pool, actor, &scope, needle.as_deref()).await?;
    Ok(SavedReportPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many reports there are, and how they split.
///
/// Counted through the same reach as the page, so the numbers are about what
/// this person can open. Per-value counts read the SEARCHED set and the total
/// reads the FILTERED one, for the reason every other facet query here gives.
async fn saved_report_facets(
    pool: &PgPool,
    actor: &str,
    scope: &SavedReportScope,
    needle: Option<&str>,
) -> Result<(i64, SavedReportFacets), AppError> {
    let sql = format!(
        "WITH searched AS ({SAVED_REPORT_ROWS}), kept AS (
             SELECT * FROM searched
              WHERE ($3::text[] IS NULL OR dataset = ANY($3))
                AND ($4::text[] IS NULL OR owner = ANY($4))
                AND ($5::text[] IS NULL OR scope = ANY($5))
         )
         SELECT 'dataset' AS kind, s.dataset AS value, COUNT(*)::bigint AS n
           FROM searched s WHERE s.dataset IS NOT NULL GROUP BY s.dataset
          UNION ALL
         SELECT 'owner', s.owner, COUNT(*)::bigint FROM searched s GROUP BY s.owner
          UNION ALL
         SELECT 'scope', s.scope, COUNT(*)::bigint FROM searched s GROUP BY s.scope
          UNION ALL
         SELECT 'all', '', COUNT(*)::bigint FROM kept"
    );
    let datasets = (!scope.datasets.is_empty()).then(|| scope.datasets.clone());
    let owners = (!scope.owners.is_empty()).then(|| scope.owners.clone());
    let scopes = (!scope.scopes.is_empty()).then(|| scope.scopes.clone());
    let rows = sqlx::query(&sql)
        .bind(actor)
        .bind(needle)
        .bind(&datasets)
        .bind(&owners)
        .bind(&scopes)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = SavedReportFacets {
        datasets: Vec::new(),
        owners: Vec::new(),
        scopes: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        let facet = SavedReportFacet {
            value,
            label: None,
            count: n,
        };
        match kind.as_str() {
            "dataset" => facets.datasets.push(facet),
            "owner" => facets.owners.push(facet),
            "scope" => facets.scopes.push(facet),
            _ => total = n,
        }
    }
    for list in [&mut facets.datasets, &mut facets.owners, &mut facets.scopes] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((total, SavedReportFacets { ..facets }))
}

/// One report, at its current version, with its history beside it.
pub async fn read(pool: &PgPool, id: Uuid, actor: &str) -> Result<Value, AppError> {
    let row = sqlx::query(
        "SELECT r.report_id, r.name, r.owner_username, r.shared, r.current_version,
                r.created_at, r.updated_at, v.spec, v.catalogue_version, v.prompt, v.model
           FROM report r
           JOIN report_version v
             ON v.report_id = r.report_id AND v.version = r.current_version
          WHERE r.report_id = $1 AND r.archived_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else {
        return Err(AppError::NotFound("no such report".into()));
    };

    let owner: String = row.get("owner_username");
    let shared: bool = row.get("shared");
    if owner != actor && !shared {
        // The same answer as a report that does not exist: distinguishing them
        // would confirm somebody else's report by its id.
        return Err(AppError::NotFound("no such report".into()));
    }

    let history = sqlx::query(
        "SELECT version, authored_by, prompt, model, catalogue_version, created_at
           FROM report_version WHERE report_id = $1 ORDER BY version DESC",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "report_id": row.get::<Uuid, _>("report_id"),
        "name": row.get::<String, _>("name"),
        "owner": owner,
        "shared": shared,
        "version": row.get::<i32, _>("current_version"),
        "spec": row.get::<Value, _>("spec"),
        "catalogue_version": row.get::<i32, _>("catalogue_version"),
        "prompt": row.get::<Option<String>, _>("prompt"),
        "model": row.get::<Option<String>, _>("model"),
        "created_at": row.get::<DateTime<Utc>, _>("created_at"),
        "updated_at": row.get::<DateTime<Utc>, _>("updated_at"),
        "editable": owner == actor,
        "versions": history.into_iter().map(|version| json!({
            "version": version.get::<i32, _>("version"),
            "authored_by": version.get::<String, _>("authored_by"),
            "prompt": version.get::<Option<String>, _>("prompt"),
            "model": version.get::<Option<String>, _>("model"),
            "catalogue_version": version.get::<i32, _>("catalogue_version"),
            "created_at": version.get::<DateTime<Utc>, _>("created_at"),
        })).collect::<Vec<_>>(),
    }))
}

/// Rename, share, or put away. Never delete: a report somebody linked to
/// should stop appearing, not stop existing.
pub async fn amend(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
    name: Option<&str>,
    shared: Option<bool>,
    archived: Option<bool>,
) -> Result<Value, AppError> {
    let owner: Option<String> =
        sqlx::query_scalar("SELECT owner_username FROM report WHERE report_id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(owner) = owner else {
        return Err(AppError::NotFound("no such report".into()));
    };
    if owner != actor {
        return Err(AppError::Forbidden(
            "only the owner may change this report".into(),
        ));
    }

    sqlx::query(
        "UPDATE report
            SET name = COALESCE($2, name),
                shared = COALESCE($3, shared),
                archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at
                                   WHEN $4 THEN now() ELSE NULL END,
                updated_at = now()
          WHERE report_id = $1",
    )
    .bind(id)
    .bind(name)
    .bind(shared)
    .bind(archived)
    .execute(pool)
    .await?;

    if archived == Some(true) {
        return Ok(json!({ "report_id": id, "archived": true }));
    }
    read(pool, id, actor).await
}

/// Run a report that is already saved, at its current version.
pub async fn run_saved(
    pool: &PgPool,
    id: Uuid,
    actor: &str,
    overlay: &[Filter],
    now: DateTime<Utc>,
) -> Result<Value, AppError> {
    let report = read(pool, id, actor).await?;
    let spec: ReportSpec =
        serde_json::from_value(report.get("spec").cloned().unwrap_or(Value::Null))?;
    let mut result = run_spec(pool, &spec, overlay, now).await?;
    if let Some(object) = result.as_object_mut() {
        object.insert("report".into(), report);
    }
    Ok(result)
}
