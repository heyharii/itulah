use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::SupplierStatus,
    postgres::{
        self as infrastructure, CatalogPurchaseOrderRequest, CreateSupplierItemRequest,
        CreateSupplierRequest, UpdateSupplierItemRequest, UpdateSupplierRequest,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct CatalogListQuery {
    #[serde(default)]
    status: Option<SupplierStatus>,
}

/// What a sourcing screen asks for.
#[derive(Debug, Deserialize)]
pub struct SourcingQuery {
    /// Matches an item's name or code, or the supplier's name.
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    status: Option<SupplierStatus>,
    #[serde(default)]
    supplier_id: Option<Uuid>,
    #[serde(default = "default_sourcing_limit")]
    limit: i64,
}

const fn default_sourcing_limit() -> i64 {
    120
}

/// Everything on offer, across every supplier.
pub async fn search_supplier_items(
    State(state): State<AppState>,
    Query(query): Query<SourcingQuery>,
) -> Result<Json<Vec<infrastructure::SourcedItem>>, AppError> {
    Ok(Json(
        infrastructure::search_supplier_items(
            &state.db,
            query.q.as_deref(),
            query.status,
            query.supplier_id,
            query.limit,
        )
        .await?,
    ))
}

fn idempotency_key(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get("idempotency-key")
        .ok_or_else(|| AppError::Validation("Idempotency-Key header is required".into()))?
        .to_str()
        .map_err(|_| AppError::Validation("Idempotency-Key header is not valid text".into()))?
        .trim();
    if value.is_empty() {
        return Err(AppError::Validation(
            "Idempotency-Key header cannot be blank".into(),
        ));
    }
    Ok(value.to_owned())
}

fn expected_version(headers: &HeaderMap) -> Result<i64, AppError> {
    let raw = headers
        .get(header::IF_MATCH)
        .ok_or_else(|| AppError::Validation("If-Match header is required".into()))?
        .to_str()
        .map_err(|_| AppError::Validation("If-Match header is not valid text".into()))?
        .trim();
    let version_text = raw
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| {
            AppError::Validation(
                "If-Match must be one strong quoted numeric ETag, for example \"3\"".into(),
            )
        })?;
    let version = version_text.parse::<i64>().map_err(|_| {
        AppError::Validation("If-Match version is outside the supported range".into())
    })?;
    if version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    Ok(version)
}

fn digest<T: Serialize>(value: &T) -> Result<String, AppError> {
    infrastructure::payload_digest(value)
}

fn versioned_response<T: Serialize>(
    status: StatusCode,
    value: T,
    version: i64,
) -> Result<Response, AppError> {
    let mut response = (status, Json(value)).into_response();
    let etag = HeaderValue::from_str(&format!("\"{version}\""))
        .map_err(|_| AppError::Configuration("cannot encode Supplier ETag".into()))?;
    response.headers_mut().insert(header::ETAG, etag);
    Ok(response)
}

pub async fn list_suppliers(
    State(state): State<AppState>,
    Query(query): Query<CatalogListQuery>,
) -> Result<Json<Vec<crate::cloud::domain::Supplier>>, AppError> {
    Ok(Json(
        infrastructure::list_suppliers(&state.db, query.status).await?,
    ))
}

pub async fn supplier_detail(
    State(state): State<AppState>,
    Path(supplier_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let supplier = infrastructure::get_supplier(&state.db, supplier_id).await?;
    versioned_response(StatusCode::OK, supplier.clone(), supplier.version)
}

pub async fn create_supplier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CreateSupplierRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let supplier = infrastructure::create_supplier(
        &state.db,
        request,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    versioned_response(StatusCode::CREATED, supplier.clone(), supplier.version)
}

pub async fn update_supplier(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<UpdateSupplierRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "expected_version": version,
        "request": &request,
    }))?;
    let supplier = infrastructure::update_supplier(
        &state.db,
        supplier_id,
        version,
        request,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    versioned_response(StatusCode::OK, supplier.clone(), supplier.version)
}

pub async fn activate_supplier(
    state: State<AppState>,
    principal: Extension<Principal>,
    path: Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    set_supplier_status(state, principal, path, headers, SupplierStatus::Active).await
}

pub async fn deactivate_supplier(
    state: State<AppState>,
    principal: Extension<Principal>,
    path: Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    set_supplier_status(state, principal, path, headers, SupplierStatus::Inactive).await
}

async fn set_supplier_status(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_id): Path<Uuid>,
    headers: HeaderMap,
    status: SupplierStatus,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "expected_version": version,
        "status": status,
    }))?;
    let supplier = infrastructure::set_supplier_status(
        &state.db,
        supplier_id,
        version,
        status,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    versioned_response(StatusCode::OK, supplier.clone(), supplier.version)
}

pub async fn list_supplier_items(
    State(state): State<AppState>,
    Path(supplier_id): Path<Uuid>,
    Query(query): Query<CatalogListQuery>,
) -> Result<Json<Vec<crate::cloud::domain::SupplierItem>>, AppError> {
    Ok(Json(
        infrastructure::list_supplier_items(&state.db, supplier_id, query.status).await?,
    ))
}

pub async fn supplier_item_detail(
    State(state): State<AppState>,
    Path(supplier_item_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let item = infrastructure::get_supplier_item(&state.db, supplier_item_id).await?;
    versioned_response(StatusCode::OK, item.clone(), item.version)
}

pub async fn create_supplier_item(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CreateSupplierItemRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "supplier_id": supplier_id,
        "request": &request,
    }))?;
    let item = infrastructure::create_supplier_item(
        &state.db,
        supplier_id,
        request,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    versioned_response(StatusCode::CREATED, item.clone(), item.version)
}

pub async fn update_supplier_item(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_item_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<UpdateSupplierItemRequest>,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "supplier_item_id": supplier_item_id,
        "expected_version": version,
        "request": &request,
    }))?;
    let item = infrastructure::update_supplier_item(
        &state.db,
        supplier_item_id,
        version,
        request,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    versioned_response(StatusCode::OK, item.clone(), item.version)
}

pub async fn activate_supplier_item(
    state: State<AppState>,
    principal: Extension<Principal>,
    path: Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    set_supplier_item_status(state, principal, path, headers, SupplierStatus::Active).await
}

pub async fn deactivate_supplier_item(
    state: State<AppState>,
    principal: Extension<Principal>,
    path: Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    set_supplier_item_status(state, principal, path, headers, SupplierStatus::Inactive).await
}

async fn set_supplier_item_status(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(supplier_item_id): Path<Uuid>,
    headers: HeaderMap,
    status: SupplierStatus,
) -> Result<Response, AppError> {
    let key = idempotency_key(&headers)?;
    let version = expected_version(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "supplier_item_id": supplier_item_id,
        "expected_version": version,
        "status": status,
    }))?;
    let item = infrastructure::set_supplier_item_status(
        &state.db,
        supplier_item_id,
        version,
        status,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    versioned_response(StatusCode::OK, item.clone(), item.version)
}

pub async fn create_catalog_purchase_order(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
    Json(request): Json<CatalogPurchaseOrderRequest>,
) -> Result<
    (
        StatusCode,
        Json<infrastructure::CatalogPurchaseOrderReceipt>,
    ),
    AppError,
> {
    let key = idempotency_key(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "request": &request,
    }))?;
    let receipt = infrastructure::create_catalog_purchase_order(
        &state.db,
        request,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(receipt)))
}
