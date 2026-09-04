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
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use serde_json::{json, Map, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Now, on the business clock the reports use.
fn today() -> NaiveDate {
    let offset =
        chrono::Duration::minutes(crate::cloud::reports::spec::LOCAL_OFFSET_MINUTES.into());
    (Utc::now() + offset).date_naive()
}

/// Run a spec and answer with its rows, its columns and what it resolved to.
///
/// The resolved period travels back with the rows on purpose: a report saying
/// "last 14 days" has to be able to tell a reader which fourteen days it just
/// meant, or the figure cannot be checked against anything.
pub async fn run_spec(
    pool: &PgPool,
    spec: &ReportSpec,
    overlay: &[Filter],
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
    let day = today();
    let query = compile(&checked, day);

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
        totals_for(pool, spec).await?
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
async fn totals_for(pool: &PgPool, spec: &ReportSpec) -> Result<Value, AppError> {
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
    let query = compile(&checked, today());
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

/// Everything this person may open: their own, plus what others shared.
pub async fn list(pool: &PgPool, actor: &str) -> Result<Value, AppError> {
    let rows = sqlx::query(
        "SELECT r.report_id, r.name, r.owner_username, r.shared, r.current_version,
                r.created_at, r.updated_at, v.prompt, v.model, v.spec->>'dataset' AS dataset
           FROM report r
           JOIN report_version v
             ON v.report_id = r.report_id AND v.version = r.current_version
          WHERE r.archived_at IS NULL AND (r.owner_username = $1 OR r.shared)
          ORDER BY r.updated_at DESC",
    )
    .bind(actor)
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "report_id": row.get::<Uuid, _>("report_id"),
                "name": row.get::<String, _>("name"),
                "owner": row.get::<String, _>("owner_username"),
                "shared": row.get::<bool, _>("shared"),
                "version": row.get::<i32, _>("current_version"),
                "dataset": row.get::<Option<String>, _>("dataset"),
                "prompt": row.get::<Option<String>, _>("prompt"),
                "model": row.get::<Option<String>, _>("model"),
                "created_at": row.get::<DateTime<Utc>, _>("created_at"),
                "updated_at": row.get::<DateTime<Utc>, _>("updated_at"),
            })
        })
        .collect();
    Ok(json!({ "items": items }))
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
) -> Result<Value, AppError> {
    let report = read(pool, id, actor).await?;
    let spec: ReportSpec =
        serde_json::from_value(report.get("spec").cloned().unwrap_or(Value::Null))?;
    let mut result = run_spec(pool, &spec, overlay).await?;
    if let Some(object) = result.as_object_mut() {
        object.insert("report".into(), report);
    }
    Ok(result)
}
