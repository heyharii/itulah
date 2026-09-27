use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{RecordKind, SupplierStatus},
    http::audit::DeclaredSubject,
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
    #[serde(default)]
    cursor: Option<Uuid>,
    #[serde(default)]
    limit: Option<i64>,
}

/// What a sourcing screen asks for.
///
/// The multi-valued facets arrive comma-separated — `division=ANAK_LAKI,NON_DIVISI` —
/// rather than as repeated keys, because that is what the browser's own filter
/// state already serialises to in the URL, and a second encoding for the same
/// idea is a second thing to get wrong.
#[derive(Debug, Deserialize)]
pub struct SourcingQuery {
    /// Matches an item's name or code, or the supplier's name.
    #[serde(default)]
    q: Option<String>,
    /// `relevance` (the default), `newest`, `price_low` or `price_high`.
    /// An unknown word is relevance rather than a refusal: a sort is a way of
    /// looking, and a stale link asking for an order this server no longer has
    /// should still show the catalogue.
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    status: Option<SupplierStatus>,
    #[serde(default)]
    supplier_id: Option<String>,
    #[serde(default)]
    division: Option<String>,
    #[serde(default)]
    tags: Option<String>,
    /// The same three facets, negated — `division_not=ANAK_LAKI` is "anything but
    /// boys' wear".
    ///
    /// A separate parameter rather than a sign inside the existing one, because
    /// the two are ANDed and a buyer may legitimately ask for both at once:
    /// "menswear or kidswear, but not the socks". Packing a negation into
    /// `division=` would make that unsayable, and would make every value
    /// ambiguous the first time a code begins with a minus.
    #[serde(default)]
    supplier_id_not: Option<String>,
    #[serde(default)]
    division_not: Option<String>,
    #[serde(default)]
    tags_not: Option<String>,
    /// Whether the column is empty. `true` asks for the unclassified rows only,
    /// `false` for the classified ones, absent for both.
    ///
    /// This is the question the facet list has been asking since it was written
    /// and the filter could not answer: `sourcing_facets` counts unclassified
    /// items under the synthetic value `Unclassified`, but `division = ANY(…)`
    /// matches no such code, so ticking that facet returned an empty page.
    #[serde(default)]
    division_null: Option<bool>,
    #[serde(default)]
    tags_null: Option<bool>,
    /// What the item comes in — `colour=NAVY,BLACK`, `size=02,03`. The same
    /// three shapes the other facets have: the selection, its negation and
    /// whether the list is empty at all.
    ///
    /// `colour_null=true` is "no colours recorded", which on a scraped feed is
    /// most of the catalogue and is exactly the pile somebody filling the gaps
    /// wants in front of them.
    #[serde(default)]
    colour: Option<String>,
    #[serde(default)]
    colour_not: Option<String>,
    #[serde(default)]
    colour_null: Option<bool>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    size_not: Option<String>,
    #[serde(default)]
    size_null: Option<bool>,
    /// From a previous page's `next_cursor`. Absent asks for the first page.
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    price_min: Option<i64>,
    #[serde(default)]
    price_max: Option<i64>,
    #[serde(default = "default_sourcing_limit")]
    limit: i64,
}

const fn default_sourcing_limit() -> i64 {
    120
}

/// Split a comma-separated facet selection, dropping the empties a trailing
/// comma leaves behind.
fn facet_values(raw: Option<&str>) -> Vec<String> {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

/// The words the catalogue may be described with, so a screen can show
/// "Kaus Kaki" where the database says `KAUS_KAKI` — and still filter by the
/// code, which is the thing that does not change when somebody edits a label.
pub async fn catalogue_vocabulary(
    State(state): State<AppState>,
) -> Result<Json<infrastructure::CatalogueVocabulary>, AppError> {
    Ok(Json(infrastructure::catalogue_vocabulary(&state.db).await?))
}

/// The arrangements a buyer can agree, and what each instalment counts from.
///
/// Terms and templates together, because a template is unreadable without its
/// terms — see `postgres::payment_terms`.
pub async fn payment_terms_book(
    State(state): State<AppState>,
) -> Result<Json<infrastructure::PaymentTermsBook>, AppError> {
    Ok(Json(infrastructure::payment_terms_book(&state.db).await?))
}

/// Everything on offer, across every supplier — one page, plus what the rest
/// of the catalogue contains.
pub async fn search_supplier_items(
    State(state): State<AppState>,
    Query(query): Query<SourcingQuery>,
) -> Result<Json<infrastructure::SourcingPage>, AppError> {
    Ok(Json(
        infrastructure::search_supplier_items(
            &state.db,
            infrastructure::SourcingScope {
                sort: infrastructure::SourcingSort::parse(query.sort.as_deref()),
                needle: query.q,
                status: query.status,
                supplier_ids: supplier_uuids(query.supplier_id.as_deref())?,
                excluded_supplier_ids: supplier_uuids(query.supplier_id_not.as_deref())?,
                division_codes: facet_values(query.division.as_deref()),
                excluded_division_codes: facet_values(query.division_not.as_deref()),
                division_null: query.division_null,
                tag_codes: facet_values(query.tags.as_deref()),
                excluded_tag_codes: facet_values(query.tags_not.as_deref()),
                tags_null: query.tags_null,
                colour_codes: facet_values(query.colour.as_deref()),
                excluded_colour_codes: facet_values(query.colour_not.as_deref()),
                colours_null: query.colour_null,
                size_codes: facet_values(query.size.as_deref()),
                excluded_size_codes: facet_values(query.size_not.as_deref()),
                sizes_null: query.size_null,
                cursor: query.cursor,
                price_min: query.price_min,
                price_max: query.price_max,
                limit: query.limit,
            },
        )
        .await?,
    ))
}

/// A comma-separated supplier selection, parsed.
///
/// Refused rather than dropped: a malformed id is a link that has been
/// hand-edited or a bug upstream, and answering it with the unfiltered
/// catalogue would look like a filter that silently does nothing.
fn supplier_uuids(raw: Option<&str>) -> Result<Vec<Uuid>, AppError> {
    facet_values(raw)
        .into_iter()
        .map(|value| {
            Uuid::parse_str(&value)
                .map_err(|_| AppError::Validation(format!("supplier_id {value:?} is not a uuid")))
        })
        .collect()
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

/// How the supplier book is narrowed, ordered and paged.
///
/// `deny_unknown_fields`, so a misspelled filter is refused rather than quietly
/// ignored: `?statuss=ACTIVE` narrows nothing, the caller believes a filter is
/// applied, and the screen shows a book it thinks is a shortlist.
///
/// Separate from `CatalogListQuery` rather than grown out of it. That one is
/// the supplier ITEM list's — a different route with a different cursor — and
/// two lists sharing one query struct is how a parameter that means one thing
/// in one place comes to mean something else in the other.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupplierListQuery {
    /// Supplier code, supplier name, or the name of the person there.
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    status: Option<SupplierStatus>,
    /// `code`, `name` or `created`. Anything else is the house order rather
    /// than a 400 — see `SupplierScope::sort`.
    #[serde(default)]
    sort: Option<String>,
    /// `desc` and nothing else.
    #[serde(default)]
    dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    category: Option<String>,
}

pub async fn list_suppliers(
    State(state): State<AppState>,
    Query(query): Query<SupplierListQuery>,
) -> Result<Json<infrastructure::SupplierList>, AppError> {
    Ok(Json(
        infrastructure::list_suppliers(
            &state.db,
            infrastructure::SupplierScope {
                q: query.q.clone().filter(|value| !value.trim().is_empty()),
                status: query.status.map(|value| value.as_str().to_owned()),
                // Which book. The Buying menu asks for merchandise, the
                // Finance one for the rest; a caller that names none gets
                // every party, which is what the record surface wants.
                category: query
                    .category
                    .clone()
                    .filter(|value| !value.trim().is_empty()),
                sort: query.sort.clone(),
                // `dir=desc` and nothing else. Absent, empty and anything
                // unrecognised all mean ascending, which is the direction a
                // list is in before anybody touches it.
                desc: query.dir.as_deref() == Some("desc"),
                cursor: query.cursor.clone(),
                // Clamped where it is enforced, not here.
                limit: query.limit,
            },
        )
        .await?,
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
    Extension(acted_on): Extension<DeclaredSubject>,
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
    acted_on.set(RecordKind::Supplier, supplier.supplier_id.to_string());
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
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        infrastructure::list_supplier_items_page(
            &state.db,
            supplier_id,
            query.status,
            query.cursor,
            query.limit,
        )
        .await?,
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
    Extension(acted_on): Extension<DeclaredSubject>,
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
    acted_on.set(RecordKind::SupplierItem, item.supplier_item_id.to_string());
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
    Json(mut request): Json<CatalogPurchaseOrderRequest>,
) -> Result<
    (
        StatusCode,
        Json<infrastructure::CatalogPurchaseOrderReceipt>,
    ),
    AppError,
> {
    // Resolved before the digest is taken, so a request that relied on the
    // default and one that named the same site explicitly hash alike — an
    // idempotency key replayed across a config change then still answers for
    // the order it actually created.
    if request.destination_site_id.is_none() {
        request.destination_site_id = Some(state.config.default_destination_site_id.clone());
    }
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

/// Rewrite a catalog order nothing has happened against yet.
///
/// Refused with a conflict naming the reason once goods, a bill, a price query
/// or a closed line stand against it — see
/// `infrastructure::purchase_order_edit_blocker`.
pub async fn revise_catalog_purchase_order(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(purchase_order_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<infrastructure::CatalogPurchaseOrderRevision>,
) -> Result<Json<infrastructure::CatalogPurchaseOrderReceipt>, AppError> {
    let key = idempotency_key(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "purchase_order_id": purchase_order_id,
        "request": &request,
    }))?;
    let receipt = infrastructure::revise_catalog_purchase_order(
        &state.db,
        purchase_order_id,
        request,
        &principal.username,
        &key,
        &request_digest,
    )
    .await?;
    Ok(Json(receipt))
}

/// Cancel an order nothing has been received against.
pub async fn cancel_purchase_order(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(purchase_order_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<infrastructure::CancelPurchaseOrderRequest>,
) -> Result<Json<infrastructure::PurchaseOrderCancelled>, AppError> {
    let key = idempotency_key(&headers)?;
    let request_digest = digest(&json!({
        "actor": &principal.username,
        "purchase_order_id": purchase_order_id,
        "request": &request,
    }))?;
    Ok(Json(
        infrastructure::cancel_purchase_order(
            &state.db,
            purchase_order_id,
            request,
            &principal.username,
            &key,
            &request_digest,
        )
        .await?,
    ))
}

/// Where a purchase order can be delivered.
///
/// Readable by anyone signed in, unlike the sync origin register it is derived
/// from — see `infrastructure::purchase_destinations` for why that distinction
/// is deliberate rather than a hole.
pub async fn list_purchase_destinations(
    State(state): State<AppState>,
) -> Result<Json<Vec<infrastructure::PurchaseDestination>>, AppError> {
    Ok(Json(
        infrastructure::purchase_destinations(&state.db).await?,
    ))
}
