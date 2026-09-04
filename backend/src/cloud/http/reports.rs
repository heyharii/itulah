//! Reports over HTTP: what may be asked, asking it, and keeping the question.
//!
//! The split in the routes mirrors the split in the feature. `catalogue` is
//! what a report may be about. `run` answers a spec without keeping it — the
//! preview a person sees before deciding the report is worth a name. Everything
//! under `saved` is the kept half, and it is append-only: editing writes a new
//! version rather than overwriting the old one.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres as infrastructure,
    reports::{
        catalogue::{self, CATALOGUE_VERSION},
        spec::{Filter, ReportSpec},
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// What a report may be about.
///
/// Assembled by hand rather than derived: the catalogue's structs carry SQL
/// fragments and a base predicate, and none of that belongs on the wire. What
/// a browser and a model need is the keys, their labels, and what kind of
/// question each column can be asked.
pub async fn catalogue() -> Json<Value> {
    let datasets: Vec<Value> = catalogue::datasets()
        .iter()
        .map(|dataset| {
            json!({
                "name": dataset.name,
                "title": dataset.title,
                "description": dataset.description,
                "dimensions": dataset.dimensions.iter().map(|dimension| json!({
                    "key": dimension.key,
                    "label": dimension.label,
                    "kind": dimension.kind,
                })).collect::<Vec<_>>(),
                "measures": dataset.measures.iter().map(|measure| json!({
                    "key": measure.key,
                    "label": measure.label,
                    "format": measure.format,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();

    Json(json!({
        "catalogue_version": CATALOGUE_VERSION,
        "datasets": datasets,
        // The operators a filter may use, so the browser's filter bar and the
        // model both offer exactly what the server will accept.
        "operators": [
            "Is", "IsNot", "IsAnyOf", "IsNoneOf", "IsEmpty", "IsNotEmpty",
            "Contains", "NotContains", "StartsWith", "Gt", "Gte", "Lt", "Lte", "Between",
            "NotBetween",
        ],
        "grains": ["none", "day", "week", "month"],
    }))
}

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    pub spec: ReportSpec,
    /// The reader's own narrowing, on top of the report's definition.
    ///
    /// Separate from `spec.filters` on purpose, and never written back into
    /// the spec by this endpoint: what somebody is looking at this minute is
    /// not what the report is. Keeping a narrowing is a deliberate act — it
    /// writes a new version through `revise`.
    #[serde(default)]
    pub filters: Vec<Filter>,
}

/// Answer a spec without keeping it.
pub async fn run(
    State(state): State<AppState>,
    Json(request): Json<RunRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::run_spec(&state.db, &request.spec, &request.filters).await?,
    ))
}

pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::list(&state.db, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    pub name: String,
    pub spec: ReportSpec,
    /// The sentence this came from, when the assistant composed it.
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("a report needs a name".into()));
    }
    let saved = infrastructure::create(
        &state.db,
        infrastructure::NewReport {
            name,
            spec: &request.spec,
            owner: &principal.username,
            prompt: request.prompt.as_deref(),
            model: request.model.as_deref(),
        },
    )
    .await?;
    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn read(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::read(&state.db, id, &principal.username).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReviseRequest {
    pub spec: ReportSpec,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

/// Edit by appending. The version somebody linked to still resolves.
pub async fn revise(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<ReviseRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let saved = infrastructure::revise(
        &state.db,
        id,
        &principal.username,
        &request.spec,
        request.prompt.as_deref(),
        request.model.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(saved)))
}

#[derive(Debug, Deserialize)]
pub struct AmendRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub shared: Option<bool>,
    #[serde(default)]
    pub archived: Option<bool>,
}

pub async fn amend(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<AmendRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::amend(
            &state.db,
            id,
            &principal.username,
            request
                .name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty()),
            request.shared,
            request.archived,
        )
        .await?,
    ))
}

#[derive(Debug, Default, Deserialize)]
pub struct RunSavedRequest {
    #[serde(default)]
    pub filters: Vec<Filter>,
}

/// Run a kept report at its current version. No model, ever.
///
/// A POST for a read, because the narrowing travels in a body: the filter bar
/// can carry a dozen clauses with values that are somebody's typing, and a
/// query string long enough to hold them is a query string proxies truncate.
/// The link somebody shares still carries `?f=` — that is the browser's URL,
/// and it is what produces this body.
pub async fn run_saved(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    request: Option<Json<RunSavedRequest>>,
) -> Result<Json<Value>, AppError> {
    let Json(request) = request.unwrap_or_default();
    Ok(Json(
        infrastructure::run_saved(&state.db, id, &principal.username, &request.filters).await?,
    ))
}
