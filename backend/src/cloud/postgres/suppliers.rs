use super::{begin_idempotent, complete_idempotent, inventory_dc_owner_tx, issue_command_tx};
use crate::cloud::{
    application::AppError,
    domain::{
        normalize_supplier_code, normalize_tag_codes, optional_supplier_text, parse_purchase_order,
        required_supplier_text, validate_supplier_item_price, PurchaseOrderLinePayload, Supplier,
        SupplierItem, SupplierStatus, COMMAND_PURCHASE_ORDER_ACTIVATE,
    },
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateSupplierRequest {
    pub supplier_code: String,
    pub name: String,
    #[serde(default)]
    pub contact_name: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub status: SupplierStatus,
}

#[derive(Clone, Debug, Default, Serialize)]
pub enum NullablePatch<T> {
    /// The caller said nothing about this field, so it keeps whatever it had.
    #[default]
    Missing,
    Null,
    Value(T),
}

impl<'de, T> Deserialize<'de> for NullablePatch<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

impl<T> NullablePatch<T> {
    fn is_present(&self) -> bool {
        !matches!(self, Self::Missing)
    }

    fn into_option(self) -> Option<T> {
        match self {
            Self::Value(value) => Some(value),
            Self::Missing | Self::Null => None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateSupplierRequest {
    #[serde(default)]
    pub supplier_code: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    // Three states, and TypeScript is told all three.
    //
    // Absent means "leave it alone"; `null` means "clear it"; a string means
    // "set it". Collapsing that to `string | undefined` in the browser would
    // make clearing a phone number impossible to express — and a field nobody
    // can clear is a field that stays wrong forever.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub contact_name: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub phone: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub email: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub address: NullablePatch<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateSupplierItemRequest {
    pub supplier_item_code: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    pub unit_price_minor: i64,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub internal_article_code: Option<String>,
    #[serde(default)]
    pub status: SupplierStatus,
    /// Which part of the range this belongs to, in our own vocabulary.
    /// Absent means unclassified, which is a real state — see 0038.
    #[serde(default)]
    pub division_code: Option<String>,
    /// Tag codes from `tag`. Unknown codes are refused rather than dropped: a
    /// tag that silently disappears is a filter that silently misses rows.
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateSupplierItemRequest {
    #[serde(default)]
    pub supplier_item_code: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub description: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub image_url: NullablePatch<String>,
    #[serde(default)]
    pub unit_price_minor: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub internal_article_code: NullablePatch<String>,
    /// Null clears the classification back to unclassified, which is a state
    /// somebody may legitimately want to return an item to.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub division_code: NullablePatch<String>,
    /// Absent leaves tags alone; present REPLACES them. An empty list is
    /// therefore "remove every tag", which is a thing to be able to say — and
    /// is why this is not merged into the existing set.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

fn default_currency() -> String {
    "IDR".to_owned()
}

fn validation(error: impl ToString) -> AppError {
    AppError::Validation(error.to_string())
}

fn map_catalog_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => {
                AppError::Conflict("Supplier or Supplier Item code is already in use".to_owned())
            }
            Some("23503") => AppError::Validation(
                "referenced Supplier or internal Article does not exist".to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn supplier_from_row(row: PgRow) -> Result<Supplier, AppError> {
    let status: String = row.try_get("status")?;
    Ok(Supplier {
        supplier_id: row.try_get("supplier_id")?,
        supplier_code: row.try_get("supplier_code")?,
        supplier_code_normalized: row.try_get("supplier_code_normalized")?,
        name: row.try_get("name")?,
        contact_name: row.try_get("contact_name")?,
        phone: row.try_get("phone")?,
        email: row.try_get("email")?,
        address: row.try_get("address")?,
        status: SupplierStatus::from_str(&status).map_err(validation)?,
        version: row.try_get("version")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn supplier_item_from_row(row: PgRow) -> Result<SupplierItem, AppError> {
    let status: String = row.try_get("status")?;
    Ok(SupplierItem {
        supplier_item_id: row.try_get("supplier_item_id")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_item_code: row.try_get("supplier_item_code")?,
        supplier_item_code_normalized: row.try_get("supplier_item_code_normalized")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        image_url: row.try_get("image_url")?,
        unit_price_minor: row.try_get("unit_price_minor")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_owned(),
        internal_article_code: row.try_get("internal_article_code")?,
        division_code: row.try_get("division_code")?,
        // Tags come from a join table, so a plain row read cannot carry them.
        // Empty here means "this reader did not fetch them", and every caller
        // that shows tags fetches them — see `search_supplier_items`.
        tags: row
            .try_get::<Option<Vec<String>>, _>("tags")
            .unwrap_or_default()
            .unwrap_or_default(),
        status: SupplierStatus::from_str(&status).map_err(validation)?,
        version: row.try_get("version")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn replay_or_begin(
    transaction: &mut Transaction<'_, Postgres>,
    idempotency_key: &str,
    command_type: &str,
    digest: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    begin_idempotent(transaction, idempotency_key, command_type, digest).await
}

async fn complete_supplier_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    idempotency_key: &str,
    supplier: &Supplier,
) -> Result<(), AppError> {
    complete_idempotent(
        transaction,
        idempotency_key,
        &serde_json::to_value(supplier)?,
    )
    .await
}

async fn complete_item_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    idempotency_key: &str,
    item: &SupplierItem,
) -> Result<(), AppError> {
    complete_idempotent(transaction, idempotency_key, &serde_json::to_value(item)?).await
}

async fn stale_supplier_error(
    transaction: &mut Transaction<'_, Postgres>,
    supplier_id: Uuid,
    expected_version: i64,
) -> AppError {
    match sqlx::query_scalar::<_, i64>("SELECT version FROM supplier WHERE supplier_id = $1")
        .bind(supplier_id)
        .fetch_optional(&mut **transaction)
        .await
    {
        Ok(Some(actual)) => AppError::Conflict(format!(
            "Supplier version is {actual}, not expected version {expected_version}"
        )),
        Ok(None) => AppError::NotFound("Supplier".to_owned()),
        Err(error) => AppError::Database(error),
    }
}

async fn stale_item_error(
    transaction: &mut Transaction<'_, Postgres>,
    supplier_item_id: Uuid,
    expected_version: i64,
) -> AppError {
    match sqlx::query_scalar::<_, i64>(
        "SELECT version FROM supplier_item WHERE supplier_item_id = $1",
    )
    .bind(supplier_item_id)
    .fetch_optional(&mut **transaction)
    .await
    {
        Ok(Some(actual)) => AppError::Conflict(format!(
            "Supplier Item version is {actual}, not expected version {expected_version}"
        )),
        Ok(None) => AppError::NotFound("Supplier Item".to_owned()),
        Err(error) => AppError::Database(error),
    }
}

pub async fn list_suppliers(
    pool: &PgPool,
    status: Option<SupplierStatus>,
) -> Result<Vec<Supplier>, AppError> {
    let rows = sqlx::query(
        "SELECT * FROM supplier
         WHERE ($1::text IS NULL OR status = $1)
         ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, name, supplier_id",
    )
    .bind(status.map(|value| value.as_str()))
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(supplier_from_row).collect()
}

pub async fn get_supplier(pool: &PgPool, supplier_id: Uuid) -> Result<Supplier, AppError> {
    let row = sqlx::query("SELECT * FROM supplier WHERE supplier_id = $1")
        .bind(supplier_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Supplier".to_owned()))?;
    supplier_from_row(row)
}

pub async fn create_supplier(
    pool: &PgPool,
    request: CreateSupplierRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<Supplier, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_code =
        required_supplier_text("supplier_code", request.supplier_code).map_err(validation)?;
    let supplier_code_normalized =
        normalize_supplier_code("supplier_code", &supplier_code).map_err(validation)?;
    let name = required_supplier_text("name", request.name).map_err(validation)?;
    let contact_name = optional_supplier_text(request.contact_name);
    let phone = optional_supplier_text(request.phone);
    let email = optional_supplier_text(request.email);
    let address = optional_supplier_text(request.address);

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, "supplier.create", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let row = sqlx::query(
        "INSERT INTO supplier
             (supplier_id, supplier_code, supplier_code_normalized, name,
              contact_name, phone, email, address, status,
              created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(supplier_code)
    .bind(supplier_code_normalized)
    .bind(name)
    .bind(contact_name)
    .bind(phone)
    .bind(email)
    .bind(address)
    .bind(request.status.as_str())
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let supplier = supplier_from_row(row)?;
    complete_supplier_mutation(&mut transaction, idempotency_key, &supplier).await?;
    transaction.commit().await?;
    Ok(supplier)
}

pub async fn update_supplier(
    pool: &PgPool,
    supplier_id: Uuid,
    expected_version: i64,
    request: UpdateSupplierRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<Supplier, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let changes_code = request.supplier_code.is_some();
    let changes_name = request.name.is_some();
    let changes_contact = request.contact_name.is_present();
    let changes_phone = request.phone.is_present();
    let changes_email = request.email.is_present();
    let changes_address = request.address.is_present();
    if !(changes_code
        || changes_name
        || changes_contact
        || changes_phone
        || changes_email
        || changes_address)
    {
        return Err(AppError::Validation(
            "Supplier update must contain at least one field".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_code = request
        .supplier_code
        .map(|value| required_supplier_text("supplier_code", value))
        .transpose()
        .map_err(validation)?;
    let supplier_code_normalized = supplier_code
        .as_deref()
        .map(|value| normalize_supplier_code("supplier_code", value))
        .transpose()
        .map_err(validation)?;
    let name = request
        .name
        .map(|value| required_supplier_text("name", value))
        .transpose()
        .map_err(validation)?;
    let contact_name = optional_supplier_text(request.contact_name.into_option());
    let phone = optional_supplier_text(request.phone.into_option());
    let email = optional_supplier_text(request.email.into_option());
    let address = optional_supplier_text(request.address.into_option());

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, "supplier.update", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier SET
             supplier_code = CASE WHEN $3 THEN $4 ELSE supplier_code END,
             supplier_code_normalized = CASE WHEN $3 THEN $5 ELSE supplier_code_normalized END,
             name = CASE WHEN $6 THEN $7 ELSE name END,
             contact_name = CASE WHEN $8 THEN $9 ELSE contact_name END,
             phone = CASE WHEN $10 THEN $11 ELSE phone END,
             email = CASE WHEN $12 THEN $13 ELSE email END,
             address = CASE WHEN $14 THEN $15 ELSE address END,
             version = version + 1, updated_by = $16, updated_at = now()
         WHERE supplier_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_id)
    .bind(expected_version)
    .bind(changes_code)
    .bind(supplier_code)
    .bind(supplier_code_normalized)
    .bind(changes_name)
    .bind(name)
    .bind(changes_contact)
    .bind(contact_name)
    .bind(changes_phone)
    .bind(phone)
    .bind(changes_email)
    .bind(email)
    .bind(changes_address)
    .bind(address)
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let Some(row) = row else {
        return Err(stale_supplier_error(&mut transaction, supplier_id, expected_version).await);
    };
    let supplier = supplier_from_row(row)?;
    complete_supplier_mutation(&mut transaction, idempotency_key, &supplier).await?;
    transaction.commit().await?;
    Ok(supplier)
}

pub async fn set_supplier_status(
    pool: &PgPool,
    supplier_id: Uuid,
    expected_version: i64,
    status: SupplierStatus,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<Supplier, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let command_type = match status {
        SupplierStatus::Active => "supplier.activate",
        SupplierStatus::Inactive => "supplier.deactivate",
    };
    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, command_type, digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier SET status = $3, version = version + 1,
             updated_by = $4, updated_at = now()
         WHERE supplier_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_id)
    .bind(expected_version)
    .bind(status.as_str())
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(row) = row else {
        return Err(stale_supplier_error(&mut transaction, supplier_id, expected_version).await);
    };
    let supplier = supplier_from_row(row)?;
    complete_supplier_mutation(&mut transaction, idempotency_key, &supplier).await?;
    transaction.commit().await?;
    Ok(supplier)
}

/// One supplier's item, with the supplier attached.
///
/// Sourcing asks a question no single supplier can answer — "who sells this,
/// and for how much" — so the answer has to carry who.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SourcedItem {
    pub item: SupplierItem,
    pub supplier: Supplier,
}

/// How many items carry one value of a facet, across the whole catalogue.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FacetCount {
    pub value: String,
    pub count: i64,
}

/// What the catalogue contains, beside the page of it being shown.
///
/// Counted over everything the text search matches, NOT over the current
/// selection. Choosing a division should not make the other divisions vanish
/// or read zero: a facet list is how a buyer sees what else is there, and one
/// that only describes what they have already chosen cannot answer "what if I
/// looked at menswear instead".
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SourcingFacets {
    pub divisions: Vec<FacetCount>,
    pub tags: Vec<FacetCount>,
    pub suppliers: Vec<FacetCount>,
}

/// One page of the catalogue, and enough about the rest to describe it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SourcingPage {
    pub items: Vec<SourcedItem>,
    /// Opaque. Pass it back to get the next page; absent means this was the
    /// last one. Deliberately not an offset: rows are added and deactivated
    /// while a buyer scrolls, and an offset would skip or repeat items when
    /// they are.
    pub next_cursor: Option<String>,
    /// Every item the search matches, not just this page. Without it a screen
    /// can only say "500 items", which is a statement about the page size.
    pub total: i64,
    pub facets: SourcingFacets,
}

/// Where the previous page stopped, in the sort's own terms.
///
/// Every component of the sort is here, ending in the id — the sort is not
/// unique without it, and a keyset that stops at a non-unique key loses or
/// repeats the rows that tie.
#[derive(Serialize, Deserialize)]
struct SourcingCursor {
    rank: i32,
    supplier_name: String,
    item_name: String,
    id: Uuid,
}

impl SourcingCursor {
    /// Hex rather than base64 only because `hex` is already a dependency and
    /// base64 is not; the point is that it is opaque, not that it is short.
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

/// What a caller is asking the catalogue for.
#[derive(Clone, Debug, Default)]
pub struct SourcingScope {
    pub needle: Option<String>,
    pub status: Option<SupplierStatus>,
    pub supplier_ids: Vec<Uuid>,
    pub division_codes: Vec<String>,
    pub tag_codes: Vec<String>,
    pub cursor: Option<String>,
    /// Inclusive bounds on the catalogue price, in minor units. Server-side
    /// for the same reason the facets are: a slider that only narrows the page
    /// already fetched tells a buyer there is nothing cheaper when there is.
    pub price_min: Option<i64>,
    pub price_max: Option<i64>,
    pub limit: i64,
}

/// Everything on offer, across every supplier, a page at a time.
///
/// Added because the screen that needs it could only be built by asking for
/// each supplier's items in turn and stitching the answers together in the
/// browser — one request per supplier, and a browser deciding what "matches"
/// means. Both of those get worse the more suppliers there are, and the second
/// one puts a search rule somewhere nobody can see it.
///
/// `needle` matches an item's name or code, or the supplier's name — the three
/// things somebody actually knows when they are looking for something to buy.
///
/// Division and tags are filtered HERE, not in the browser. They used to be
/// faceted client-side over whatever rows had been fetched, which was honest
/// while a catalogue was five items and became a lie at 2806: the counts
/// described the page rather than the catalogue, and filtering by a division
/// searched only the part of it that happened to have loaded.
pub async fn search_supplier_items(
    pool: &PgPool,
    scope: SourcingScope,
) -> Result<SourcingPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let status = scope.status.map(|value| value.as_str().to_string());
    let suppliers = (!scope.supplier_ids.is_empty()).then_some(scope.supplier_ids);
    let divisions = (!scope.division_codes.is_empty()).then_some(scope.division_codes);
    let tags = (!scope.tag_codes.is_empty()).then_some(scope.tag_codes);
    let cursor = scope
        .cursor
        .as_deref()
        .map(SourcingCursor::decode)
        .transpose()?;
    // A page, not the catalogue. The browser asks for the next one when the
    // buyer reaches the bottom, which is the only way a 2806-item range can be
    // shown without handing a laptop 2806 photographs at once.
    let limit = scope.limit.clamp(1, 200);

    let rows = sqlx::query(
        "SELECT i.*,
                COALESCE(
                    (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                       FROM supplier_item_tag t
                      WHERE t.supplier_item_id = i.supplier_item_id),
                    '{}'
                ) AS tags,
                CASE i.status WHEN 'ACTIVE' THEN 0 ELSE 1 END AS rank,
                s.supplier_id AS s_supplier_id, s.supplier_code AS s_supplier_code,
                s.supplier_code_normalized AS s_supplier_code_normalized, s.name AS s_name,
                s.contact_name AS s_contact_name, s.phone AS s_phone, s.email AS s_email,
                s.address AS s_address, s.status AS s_status, s.version AS s_version,
                s.created_by AS s_created_by, s.created_at AS s_created_at,
                s.updated_by AS s_updated_by, s.updated_at AS s_updated_at
           FROM supplier_item i
           JOIN supplier s ON s.supplier_id = i.supplier_id
          WHERE ($1::text IS NULL OR i.status = $1)
            AND ($2::uuid[] IS NULL OR i.supplier_id = ANY($2))
            AND ($3::text IS NULL
                 OR i.name ILIKE '%' || $3 || '%'
                 OR i.supplier_item_code ILIKE '%' || $3 || '%'
                 OR s.name ILIKE '%' || $3 || '%'
                 -- The code as well as the name: it is what appears on the
                 -- order and on the carton, so it is what somebody has in
                 -- front of them when they come here looking.
                 OR s.supplier_code ILIKE '%' || $3 || '%')
            AND ($4::text[] IS NULL OR i.division_code = ANY($4))
            AND ($5::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM supplier_item_tag t
                     WHERE t.supplier_item_id = i.supplier_item_id
                       AND t.tag_code = ANY($5)))
            AND ($11::bigint IS NULL OR i.unit_price_minor >= $11)
            AND ($12::bigint IS NULL OR i.unit_price_minor <= $12)
            -- Keyset: strictly after the last row of the previous page, in the
            -- sort's own order. Row-value comparison rather than an unrolled
            -- chain of ORs, so the planner can use the ordering directly.
            AND ($6::int IS NULL OR
                 (CASE i.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, s.name, i.name, i.supplier_item_id)
                 > ($6::int, $7::text, $8::text, $9::uuid))
          ORDER BY rank, s.name, i.name, i.supplier_item_id
          LIMIT $10",
    )
    .bind(&status)
    .bind(&suppliers)
    .bind(&needle)
    .bind(&divisions)
    .bind(&tags)
    .bind(cursor.as_ref().map(|c| c.rank))
    .bind(cursor.as_ref().map(|c| c.supplier_name.clone()))
    .bind(cursor.as_ref().map(|c| c.item_name.clone()))
    .bind(cursor.as_ref().map(|c| c.id))
    .bind(limit)
    .bind(scope.price_min)
    .bind(scope.price_max)
    .fetch_all(pool)
    .await?;

    // The cursor is built from the last row BEFORE the rows are converted,
    // because the sort keys include the supplier's name, which the converted
    // shape nests one level down.
    let next_cursor = if (rows.len() as i64) < limit {
        None
    } else {
        match rows.last() {
            Some(row) => Some(
                SourcingCursor {
                    rank: row.try_get("rank")?,
                    supplier_name: row.try_get("s_name")?,
                    item_name: row.try_get("name")?,
                    id: row.try_get("supplier_item_id")?,
                }
                .encode()?,
            ),
            None => None,
        }
    };

    let items = rows
        .into_iter()
        .map(sourced_item_from_row)
        .collect::<Result<Vec<_>, _>>()?;

    let (total, facets) = sourcing_facets(pool, needle.as_deref(), status.as_deref()).await?;
    Ok(SourcingPage {
        items,
        next_cursor,
        total,
        facets,
    })
}

/// What the whole search contains, by division, tag and supplier.
///
/// One round trip: a screen cannot draw its facet list before it has all three,
/// so splitting them would only buy two more waits.
async fn sourcing_facets(
    pool: &PgPool,
    needle: Option<&str>,
    status: Option<&str>,
) -> Result<(i64, SourcingFacets), AppError> {
    let row = sqlx::query(
        "WITH base AS (
             SELECT i.supplier_item_id, i.division_code, i.supplier_id
               FROM supplier_item i
               JOIN supplier s ON s.supplier_id = i.supplier_id
              WHERE ($1::text IS NULL OR i.status = $1)
                AND ($2::text IS NULL
                     OR i.name ILIKE '%' || $2 || '%'
                     OR i.supplier_item_code ILIKE '%' || $2 || '%'
                     OR s.name ILIKE '%' || $2 || '%'
                     OR s.supplier_code ILIKE '%' || $2 || '%')
         )
         SELECT
             (SELECT count(*) FROM base) AS total,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT COALESCE(division_code, 'Unclassified') AS value,
                                      count(*) AS count
                                 FROM base GROUP BY 1) d), '[]'::jsonb) AS divisions,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT t.tag_code AS value, count(*) AS count
                                 FROM base b
                                 JOIN supplier_item_tag t USING (supplier_item_id)
                                GROUP BY 1) g), '[]'::jsonb) AS tags,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT b.supplier_id::text AS value, count(*) AS count
                                 FROM base b GROUP BY 1) p), '[]'::jsonb) AS suppliers",
    )
    .bind(status)
    .bind(needle)
    .fetch_one(pool)
    .await?;

    Ok((
        row.try_get("total")?,
        SourcingFacets {
            divisions: serde_json::from_value(row.try_get("divisions")?)?,
            tags: serde_json::from_value(row.try_get("tags")?)?,
            suppliers: serde_json::from_value(row.try_get("suppliers")?)?,
        },
    ))
}

/// One joined `supplier_item` + `supplier` row, as both this module and the
/// basket read it.
///
/// The supplier's columns are aliased `s_*` because the two tables share four
/// column names — `name`, `status`, `created_by`, `updated_by` — and an
/// unaliased join would silently hand the item's values to the supplier. Any
/// query feeding this must use the same aliases; that is the contract between
/// this function and its callers, and it is why it lives here rather than
/// being written twice.
pub(crate) fn sourced_item_from_row(row: PgRow) -> Result<SourcedItem, AppError> {
    let supplier = Supplier {
        supplier_id: row.try_get("s_supplier_id")?,
        supplier_code: row.try_get("s_supplier_code")?,
        supplier_code_normalized: row.try_get("s_supplier_code_normalized")?,
        name: row.try_get("s_name")?,
        contact_name: row.try_get("s_contact_name")?,
        phone: row.try_get("s_phone")?,
        email: row.try_get("s_email")?,
        address: row.try_get("s_address")?,
        status: SupplierStatus::from_str(&row.try_get::<String, _>("s_status")?)
            .map_err(validation)?,
        version: row.try_get("s_version")?,
        created_by: row.try_get("s_created_by")?,
        created_at: row.try_get("s_created_at")?,
        updated_by: row.try_get("s_updated_by")?,
        updated_at: row.try_get("s_updated_at")?,
    };
    let item = supplier_item_from_row(row)?;
    Ok(SourcedItem { item, supplier })
}

pub async fn list_supplier_items(
    pool: &PgPool,
    supplier_id: Uuid,
    status: Option<SupplierStatus>,
) -> Result<Vec<SupplierItem>, AppError> {
    if !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM supplier WHERE supplier_id = $1)",
    )
    .bind(supplier_id)
    .fetch_one(pool)
    .await?
    {
        return Err(AppError::NotFound("Supplier".to_owned()));
    }
    let rows = sqlx::query(
        "SELECT * FROM supplier_item
         WHERE supplier_id = $1 AND ($2::text IS NULL OR status = $2)
         ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, name, supplier_item_id",
    )
    .bind(supplier_id)
    .bind(status.map(|value| value.as_str()))
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(supplier_item_from_row).collect()
}

pub async fn get_supplier_item(
    pool: &PgPool,
    supplier_item_id: Uuid,
) -> Result<SupplierItem, AppError> {
    let row = sqlx::query("SELECT * FROM supplier_item WHERE supplier_item_id = $1")
        .bind(supplier_item_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Supplier Item".to_owned()))?;
    supplier_item_from_row(row)
}

pub async fn create_supplier_item(
    pool: &PgPool,
    supplier_id: Uuid,
    request: CreateSupplierItemRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierItem, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_item_code =
        required_supplier_text("supplier_item_code", request.supplier_item_code)
            .map_err(validation)?;
    let supplier_item_code_normalized =
        normalize_supplier_code("supplier_item_code", &supplier_item_code).map_err(validation)?;
    let name = required_supplier_text("name", request.name).map_err(validation)?;
    let currency = validate_supplier_item_price(request.unit_price_minor, &request.currency)
        .map_err(validation)?;
    let description = optional_supplier_text(request.description);
    let image_url = optional_supplier_text(request.image_url);
    let internal_article_code = optional_supplier_text(request.internal_article_code);
    let division_code = optional_supplier_text(request.division_code);
    let tags = normalize_tag_codes(request.tags).map_err(validation)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "supplier-item.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let supplier_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM supplier WHERE supplier_id = $1)")
            .bind(supplier_id)
            .fetch_one(&mut *transaction)
            .await?;
    if !supplier_exists {
        return Err(AppError::NotFound("Supplier".to_owned()));
    }
    let row = sqlx::query(
        "INSERT INTO supplier_item
             (supplier_item_id, supplier_id, supplier_item_code,
              supplier_item_code_normalized, name, description, image_url,
              unit_price_minor, currency, internal_article_code, status,
              division_code, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(supplier_id)
    .bind(supplier_item_code)
    .bind(supplier_item_code_normalized)
    .bind(name)
    .bind(description)
    .bind(image_url)
    .bind(request.unit_price_minor)
    .bind(currency)
    .bind(internal_article_code)
    .bind(request.status.as_str())
    .bind(division_code)
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let mut item = supplier_item_from_row(row)?;
    item.tags = replace_supplier_item_tags(&mut transaction, item.supplier_item_id, &tags).await?;
    complete_item_mutation(&mut transaction, idempotency_key, &item).await?;
    transaction.commit().await?;
    Ok(item)
}

pub async fn update_supplier_item(
    pool: &PgPool,
    supplier_item_id: Uuid,
    expected_version: i64,
    request: UpdateSupplierItemRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierItem, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let changes_code = request.supplier_item_code.is_some();
    let changes_name = request.name.is_some();
    let changes_description = request.description.is_present();
    let changes_image = request.image_url.is_present();
    let changes_price = request.unit_price_minor.is_some();
    let changes_currency = request.currency.is_some();
    let changes_article = request.internal_article_code.is_present();
    let changes_division = request.division_code.is_present();
    let changes_tags = request.tags.is_some();
    if !(changes_code
        || changes_name
        || changes_description
        || changes_image
        || changes_price
        || changes_currency
        || changes_article
        || changes_division
        || changes_tags)
    {
        return Err(AppError::Validation(
            "Supplier Item update must contain at least one field".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_item_code = request
        .supplier_item_code
        .map(|value| required_supplier_text("supplier_item_code", value))
        .transpose()
        .map_err(validation)?;
    let supplier_item_code_normalized = supplier_item_code
        .as_deref()
        .map(|value| normalize_supplier_code("supplier_item_code", value))
        .transpose()
        .map_err(validation)?;
    let name = request
        .name
        .map(|value| required_supplier_text("name", value))
        .transpose()
        .map_err(validation)?;
    if let Some(price) = request.unit_price_minor {
        if price < 0 {
            return Err(AppError::Validation("unit price cannot be negative".into()));
        }
    }
    let currency = request
        .currency
        .map(|value| validate_supplier_item_price(0, &value))
        .transpose()
        .map_err(validation)?;
    let description = optional_supplier_text(request.description.into_option());
    let image_url = optional_supplier_text(request.image_url.into_option());
    let internal_article_code = optional_supplier_text(request.internal_article_code.into_option());
    let division_code = optional_supplier_text(request.division_code.into_option());
    let tags = request
        .tags
        .map(normalize_tag_codes)
        .transpose()
        .map_err(validation)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "supplier-item.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier_item SET
             supplier_item_code = CASE WHEN $3 THEN $4 ELSE supplier_item_code END,
             supplier_item_code_normalized = CASE WHEN $3 THEN $5 ELSE supplier_item_code_normalized END,
             name = CASE WHEN $6 THEN $7 ELSE name END,
             description = CASE WHEN $8 THEN $9 ELSE description END,
             image_url = CASE WHEN $10 THEN $11 ELSE image_url END,
             unit_price_minor = CASE WHEN $12 THEN $13 ELSE unit_price_minor END,
             currency = CASE WHEN $14 THEN $15 ELSE currency END,
             internal_article_code = CASE WHEN $16 THEN $17 ELSE internal_article_code END,
             division_code = CASE WHEN $18 THEN $19 ELSE division_code END,
             version = version + 1, updated_by = $20, updated_at = now()
         WHERE supplier_item_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_item_id)
    .bind(expected_version)
    .bind(changes_code)
    .bind(supplier_item_code)
    .bind(supplier_item_code_normalized)
    .bind(changes_name)
    .bind(name)
    .bind(changes_description)
    .bind(description)
    .bind(changes_image)
    .bind(image_url)
    .bind(changes_price)
    .bind(request.unit_price_minor)
    .bind(changes_currency)
    .bind(currency)
    .bind(changes_article)
    .bind(internal_article_code)
    .bind(changes_division)
    .bind(division_code)
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let Some(row) = row else {
        return Err(stale_item_error(&mut transaction, supplier_item_id, expected_version).await);
    };
    let mut item = supplier_item_from_row(row)?;
    if let Some(tags) = tags {
        item.tags = replace_supplier_item_tags(&mut transaction, supplier_item_id, &tags).await?;
    }
    complete_item_mutation(&mut transaction, idempotency_key, &item).await?;
    transaction.commit().await?;
    Ok(item)
}

pub async fn set_supplier_item_status(
    pool: &PgPool,
    supplier_item_id: Uuid,
    expected_version: i64,
    status: SupplierStatus,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierItem, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let command_type = match status {
        SupplierStatus::Active => "supplier-item.activate",
        SupplierStatus::Inactive => "supplier-item.deactivate",
    };
    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, command_type, digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier_item SET status = $3, version = version + 1,
             updated_by = $4, updated_at = now()
         WHERE supplier_item_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_item_id)
    .bind(expected_version)
    .bind(status.as_str())
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(row) = row else {
        return Err(stale_item_error(&mut transaction, supplier_item_id, expected_version).await);
    };
    let item = supplier_item_from_row(row)?;
    complete_item_mutation(&mut transaction, idempotency_key, &item).await?;
    transaction.commit().await?;
    Ok(item)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogPurchaseLineRequest {
    pub supplier_item_id: Uuid,
    pub quantity: i64,
    #[serde(default)]
    pub promised_date: Option<NaiveDate>,
    /// What this order pays, when that is not what the catalogue says.
    ///
    /// A sourcing catalogue goes stale between the day something is picked out
    /// and the day it is ordered. Absent means "the catalogue's price", which
    /// is the ordinary case; present means a buyer agreed something else for
    /// this order, and the catalogue's figure is still recorded beside it.
    #[serde(default)]
    pub unit_price_minor: Option<i64>,
    /// A corrected description for this order only. It does not rename the
    /// supplier item: one order's wording is not a catalogue edit.
    #[serde(default)]
    pub article_name: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    /// What this order says the goods are, when the catalogue is wrong or
    /// silent. The classification travels to goods receipt and becomes the
    /// article's own, so correcting it here is correcting it at the only
    /// moment somebody has the garment and the paperwork in front of them.
    #[serde(default)]
    pub division_code: Option<String>,
    /// Absent keeps the catalogue's tags; present replaces them for this order.
    /// An empty list therefore means "no tags", which is a thing a buyer may
    /// legitimately say about a line.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogPurchaseOrderRequest {
    pub po_number: String,
    pub supplier_id: Uuid,
    /// Where the goods land. Absent takes the node's configured default, which
    /// is the ordinary case while the company runs one DC — asking a buyer to
    /// choose between one option is a question with no information in it.
    #[serde(default)]
    pub destination_site_id: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Agreed reduction on the whole order, in the order currency's minor
    /// unit. On the order rather than the lines because that is how it is
    /// negotiated and how an invoice states it — see migration 0044.
    #[serde(default)]
    pub discount_minor: Option<i64>,
    pub lines: Vec<CatalogPurchaseLineRequest>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CatalogPurchaseOrderReceipt {
    pub purchase_order_id: Uuid,
    pub po_number: String,
    pub supplier_id: Uuid,
    pub supplier_code: String,
    pub destination_site_id: String,
    pub activation_command_id: Uuid,
    pub sent_to_origin: String,
    /// What the lines come to at the agreed prices, what was taken off, and
    /// what is left. Returned so the screen that raised the order can show the
    /// figure the supplier will invoice without recomputing it and risking a
    /// different answer.
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub net_minor: i64,
}

#[derive(Debug)]
struct CatalogItemSnapshot {
    supplier_item_id: Uuid,
    supplier_item_code: String,
    name: String,
    image_url: Option<String>,
    unit_price_minor: i64,
    currency: String,
    version: i64,
    quantity: i64,
    promised_date: Option<NaiveDate>,
    /// What this order pays and calls it — the catalogue's values unless the
    /// buyer said otherwise. The fields above keep what the catalogue said.
    ordered_price_minor: i64,
    ordered_name: String,
    ordered_image_url: Option<String>,
    /// Carried onto the order line, not merely displayed. What a thing IS
    /// survives the order: `tagging` reads these back when it mints the
    /// article at goods receipt, so dropping them here produces articles with
    /// no division and no tags even though the catalogue knew both.
    division_code: Option<String>,
    tags: Vec<String>,
}

fn map_catalog_purchase_error(error: sqlx::Error, po_number: &str) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(format!(
                "purchase order number '{po_number}' already exists"
            )),
            Some("23503") | Some("23514") | Some("23502") => {
                AppError::Validation(database.message().to_owned())
            }
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Raise a PO from canonical Supplier Items while preserving the existing PO
/// command understood by every DC. Catalog identity remains in Cloud columns;
/// the command carries immutable business-code/name/price snapshots.
pub async fn create_catalog_purchase_order(
    pool: &PgPool,
    request: CatalogPurchaseOrderRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<CatalogPurchaseOrderReceipt, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let po_number = required_supplier_text("po_number", request.po_number).map_err(validation)?;
    let destination_site_id = required_supplier_text(
        "destination_site_id",
        request.destination_site_id.unwrap_or_default(),
    )
    .map_err(validation)?;
    let notes = optional_supplier_text(request.notes);
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a catalog purchase order needs at least one line".into(),
        ));
    }
    if request.lines.len() > i32::MAX as usize {
        return Err(AppError::Validation(
            "purchase order has too many lines".into(),
        ));
    }
    let mut seen_items = std::collections::HashSet::with_capacity(request.lines.len());
    for (index, line) in request.lines.iter().enumerate() {
        if line.quantity <= 0 {
            return Err(AppError::Validation(format!(
                "line {} quantity must be positive",
                index + 1
            )));
        }
        if !seen_items.insert(line.supplier_item_id) {
            return Err(AppError::Validation(format!(
                "Supplier Item {} appears more than once",
                line.supplier_item_id
            )));
        }
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "purchase-order.catalog.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    let target = inventory_dc_owner_tx(&mut transaction, &destination_site_id)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!(
                "no registered DC owns site '{destination_site_id}'; register it before ordering to it"
            ))
        })?;

    let supplier_row = sqlx::query(
        "SELECT supplier_code, name, status
         FROM supplier WHERE supplier_id = $1 FOR SHARE",
    )
    .bind(request.supplier_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier".to_owned()))?;
    let supplier_status: String = supplier_row.try_get("status")?;
    if supplier_status != SupplierStatus::Active.as_str() {
        return Err(AppError::Conflict(
            "inactive Supplier cannot be used for a new purchase order".into(),
        ));
    }
    let supplier_code: String = supplier_row.try_get("supplier_code")?;
    let supplier_name: String = supplier_row.try_get("name")?;

    let mut snapshots = Vec::with_capacity(request.lines.len());
    for line in request.lines {
        let row = sqlx::query(
            "SELECT i.supplier_id, i.supplier_item_code, i.name, i.image_url,
                    i.unit_price_minor, i.currency, i.status, i.version,
                    i.division_code,
                    COALESCE(
                        (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                           FROM supplier_item_tag t
                          WHERE t.supplier_item_id = i.supplier_item_id),
                        ARRAY[]::text[]
                    ) AS tags
             FROM supplier_item i WHERE i.supplier_item_id = $1 FOR SHARE",
        )
        .bind(line.supplier_item_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Supplier Item {}", line.supplier_item_id)))?;
        let owner_id: Uuid = row.try_get("supplier_id")?;
        if owner_id != request.supplier_id {
            return Err(AppError::Conflict(format!(
                "Supplier Item {} does not belong to Supplier {}",
                line.supplier_item_id, request.supplier_id
            )));
        }
        let status: String = row.try_get("status")?;
        if status != SupplierStatus::Active.as_str() {
            return Err(AppError::Conflict(format!(
                "Supplier Item {} is inactive",
                line.supplier_item_id
            )));
        }
        let currency = row.try_get::<String, _>("currency")?.trim().to_owned();
        if currency != "IDR" {
            return Err(AppError::Conflict(format!(
                "Supplier Item {} uses unsupported currency {currency}",
                line.supplier_item_id
            )));
        }
        // What the catalogue says, read once: it is both the fallback for an
        // order that accepts it and the snapshot for one that does not.
        let catalogue_name: String = row.try_get("name")?;
        let catalogue_image: Option<String> = row.try_get("image_url")?;
        let catalogue_price: i64 = row.try_get("unit_price_minor")?;
        snapshots.push(CatalogItemSnapshot {
            supplier_item_id: line.supplier_item_id,
            supplier_item_code: row.try_get("supplier_item_code")?,
            name: catalogue_name.clone(),
            image_url: catalogue_image.clone(),
            unit_price_minor: catalogue_price,
            currency,
            version: row.try_get("version")?,
            quantity: line.quantity,
            promised_date: line.promised_date,
            division_code: match optional_supplier_text(line.division_code) {
                Some(code) => Some(code),
                None => row.try_get("division_code")?,
            },
            tags: match line.tags {
                Some(tags) => normalize_tag_codes(tags).map_err(validation)?,
                None => row.try_get("tags")?,
            },
            ordered_price_minor: match line.unit_price_minor {
                Some(price) if price < 0 => {
                    return Err(AppError::Validation(
                        "agreed unit price cannot be negative".into(),
                    ))
                }
                Some(price) => price,
                None => catalogue_price,
            },
            ordered_name: optional_supplier_text(line.article_name).unwrap_or(catalogue_name),
            ordered_image_url: optional_supplier_text(line.image_url).or(catalogue_image),
        });
    }

    // What the order is worth before the discount. Computed from the agreed
    // prices, not the catalogue's, because a discount is taken off what is
    // actually being paid.
    let mut gross_minor: i64 = 0;
    for item in &snapshots {
        let line = item
            .ordered_price_minor
            .checked_mul(item.quantity)
            .ok_or_else(|| AppError::Validation("order value overflows".into()))?;
        gross_minor = gross_minor
            .checked_add(line)
            .ok_or_else(|| AppError::Validation("order value overflows".into()))?;
    }
    let discount_minor = request.discount_minor.unwrap_or(0);
    if discount_minor < 0 {
        return Err(AppError::Validation("discount cannot be negative".into()));
    }
    // A discount larger than the order is not a discount, it is a credit, and
    // this is not the instrument for one.
    if discount_minor > gross_minor {
        return Err(AppError::Validation(format!(
            "discount {discount_minor} is more than the order is worth ({gross_minor})"
        )));
    }

    let purchase_order_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO purchase_order
             (purchase_order_id, po_number, supplier_id, supplier_name,
              supplier_ref_id, supplier_code_snapshot, supplier_name_snapshot,
              destination_site_id, origin_kind, order_status, currency, notes,
              discount_minor, created_by, issued_at)
         VALUES ($1,$2,$3,$4,$5,$3,$4,$6,'DIRECT','ISSUED','IDR',$7,$9,$8,now())",
    )
    .bind(purchase_order_id)
    .bind(&po_number)
    .bind(&supplier_code)
    .bind(&supplier_name)
    .bind(request.supplier_id)
    .bind(&destination_site_id)
    .bind(&notes)
    .bind(&actor)
    .bind(discount_minor)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_catalog_purchase_error(error, &po_number))?;

    let mut wire_lines = Vec::with_capacity(snapshots.len());
    for (index, item) in snapshots.into_iter().enumerate() {
        let line_number = i32::try_from(index + 1)
            .map_err(|_| AppError::Validation("purchase order has too many lines".into()))?;
        let line_amount_minor = item
            .ordered_price_minor
            .checked_mul(item.quantity)
            .ok_or_else(|| AppError::Validation(format!("line {line_number} amount overflows")))?;
        let po_line_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO purchase_order_line
                 (po_line_id, purchase_order_id, line_number,
                  article_code, article_name, image_url, division_code,
                  ordered_quantity,
                  unit_price_minor, line_amount_minor, promised_date,
                  supplier_item_id, supplier_item_code_snapshot,
                  supplier_item_name_snapshot, supplier_item_image_snapshot,
                  supplier_item_version, currency, supplier_item_price_snapshot)
             VALUES ($1,$2,$3,$4,$15,$16,$14,$7,$8,$9,$10,$11,$4,$5,$6,$12,$13,$17)",
        )
        .bind(po_line_id)
        .bind(purchase_order_id)
        .bind(line_number)
        .bind(&item.supplier_item_code)
        .bind(&item.name)
        .bind(&item.image_url)
        .bind(item.quantity)
        // The agreed price, not the catalogue's — `line_amount_minor` is
        // computed from it, and a row where unit price times quantity does not
        // equal the line amount is a row nobody can reconcile.
        .bind(item.ordered_price_minor)
        .bind(line_amount_minor)
        .bind(item.promised_date)
        .bind(item.supplier_item_id)
        .bind(item.version)
        .bind(&item.currency)
        .bind(&item.division_code)
        .bind(&item.ordered_name)
        .bind(&item.ordered_image_url)
        // What the catalogue was asking. Equal to the bound price above when
        // the buyer accepted it; different when they did not, and that
        // difference is the only record of the negotiation.
        .bind(item.unit_price_minor)
        .execute(&mut *transaction)
        .await
        .map_err(|error| map_catalog_purchase_error(error, &po_number))?;
        // The tags the catalogue already holds, carried onto the line. They
        // are known-good — a supplier item cannot hold a tag that is not in
        // the vocabulary — so unlike the legacy path there is nothing to
        // validate here, only to copy.
        for tag in &item.tags {
            sqlx::query(
                "INSERT INTO purchase_order_line_tag (po_line_id, tag_code)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING",
            )
            .bind(po_line_id)
            .bind(tag)
            .execute(&mut *transaction)
            .await
            .map_err(|error| map_catalog_purchase_error(error, &po_number))?;
        }
        wire_lines.push(PurchaseOrderLinePayload {
            po_line_id,
            line_number,
            article_code: item.supplier_item_code,
            article_name: item.ordered_name,
            image_url: item.ordered_image_url,
            // The edge receives what was ordered, classification included.
            // It was `None` and empty here, which meant the DC's copy of the
            // order disagreed with head office's about what the goods are.
            division_code: item.division_code,
            tags: item.tags,
            ordered_quantity: item.quantity,
            unit_price_minor: item.ordered_price_minor,
            promised_date: item.promised_date.map(|date| date.to_string()),
        });
    }

    let payload = json!({
        "purchase_order_id": purchase_order_id,
        "po_number": po_number,
        "supplier_id": supplier_code,
        "supplier_name": supplier_name,
        "destination_site_id": destination_site_id,
        "lines": wire_lines,
    });
    parse_purchase_order(&payload).map_err(AppError::Validation)?;
    let command_id = issue_command_tx(
        &mut transaction,
        COMMAND_PURCHASE_ORDER_ACTIVATE,
        &payload,
        &actor,
        None,
        std::slice::from_ref(&target),
    )
    .await?;
    sqlx::query(
        "UPDATE purchase_order SET activation_command_id = $2
         WHERE purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .bind(command_id)
    .execute(&mut *transaction)
    .await?;

    let receipt = CatalogPurchaseOrderReceipt {
        purchase_order_id,
        po_number,
        supplier_id: request.supplier_id,
        supplier_code,
        destination_site_id,
        activation_command_id: command_id,
        sent_to_origin: target,
        gross_minor,
        discount_minor,
        net_minor: gross_minor - discount_minor,
    };
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&receipt)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(receipt)
}

/// A site a purchase order can actually be delivered to.
///
/// A purchase order names a `destination_site_id`, and until now the only way
/// to list those was `GET /api/v1/sync/origins` — which is Admin-only, on
/// purpose: `cloud/domain/auth.rs` has a test asserting that knowing which
/// nodes exist is administration even when you are only reading it. A
/// Supervisor raising an order is not doing administration, and was getting a
/// 403 on a list of site names.
///
/// `GET /api/v1/sync/fleet` is readable by everyone but answers a different
/// question: it carries `origin_id` and convergence, not `site_id`, and the two
/// are not the same string — a node registered as `dc-jakarta` can be standing
/// in site `DC-JKT`. An order routed by origin id would name a site that does
/// not exist.
///
/// So this is the purchasing question asked directly: where can a delivery go.
/// It exposes site names and roles and nothing else — no ingest keys, no
/// generations, no command backlog.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseDestination {
    pub site_id: String,
    /// What a person calls it. Falls back to the site id when nobody has named
    /// the node, because a blank line in a picker is not a choice.
    pub label: String,
    /// `DC` or `STORE`. A buyer routing a full container and a buyer topping up
    /// one shop are making different decisions and the list should say which is
    /// which.
    pub node_role: String,
}

/// Every site that can receive a delivery.
///
/// Cloud itself is excluded: the centre has no floor to put stock on. So is any
/// node with inventory switched off, and any registration that never named a
/// site — both would offer a destination the goods receipt could not be booked
/// against.
pub async fn purchase_destinations(pool: &PgPool) -> Result<Vec<PurchaseDestination>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (site_id) site_id, label, node_role
           FROM sync_origin_credential
          WHERE inventory_enabled
            AND site_id IS NOT NULL
            AND node_role IS NOT NULL
            AND node_role <> 'CLOUD'
          ORDER BY site_id, origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut destinations: Vec<PurchaseDestination> = rows
        .into_iter()
        .map(|row| {
            let site_id: String = row.try_get("site_id")?;
            let label: Option<String> = row.try_get("label")?;
            Ok(PurchaseDestination {
                label: label
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| site_id.clone()),
                site_id,
                node_role: row.try_get("node_role")?,
            })
        })
        .collect::<Result<_, AppError>>()?;
    // Warehouses first, then shops, alphabetically inside each — the order a
    // buyer scans them in. The label comparison folds case, because these are
    // names people typed: with a plain byte comparison "STORE store-07" sorts
    // before "Store 02", which is not alphabetical to anybody reading it.
    destinations.sort_by(|a, b| {
        a.node_role
            .cmp(&b.node_role)
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    Ok(destinations)
}

/// Set an item's tags to exactly `tags`, and report what they now are.
///
/// A replace rather than a merge: the caller sent the whole set, so anything
/// absent from it was removed on purpose. Doing this inside the caller's
/// transaction is what keeps an item from being visible with half its tags.
///
/// Unknown codes are refused with the codes named. The alternative — letting
/// the foreign key fire — produces a 500 and a constraint name, which tells a
/// buyer who mistyped a tag nothing at all.
async fn replace_supplier_item_tags(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    supplier_item_id: Uuid,
    tags: &[String],
) -> Result<Vec<String>, AppError> {
    sqlx::query("DELETE FROM supplier_item_tag WHERE supplier_item_id = $1")
        .bind(supplier_item_id)
        .execute(&mut **transaction)
        .await?;
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let known: Vec<String> = sqlx::query_scalar("SELECT code FROM tag WHERE code = ANY($1)")
        .bind(tags)
        .fetch_all(&mut **transaction)
        .await?;
    let unknown: Vec<&str> = tags
        .iter()
        .filter(|tag| !known.contains(tag))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::Validation(format!(
            "unknown tag codes: {}",
            unknown.join(", ")
        )));
    }
    sqlx::query(
        "INSERT INTO supplier_item_tag (supplier_item_id, tag_code)
         SELECT $1, code FROM unnest($2::text[]) AS code",
    )
    .bind(supplier_item_id)
    .bind(tags)
    .execute(&mut **transaction)
    .await?;
    let mut applied = tags.to_vec();
    applied.sort();
    Ok(applied)
}

/// One word the catalogue is allowed to use, and what it reads as.
///
/// `code` is what the database stores and what filters address; `label` is
/// what a person sees. Sending only the code — which is what the sourcing
/// screen had — puts `KAUS_KAKI` in front of a buyer and makes the catalogue
/// look like a database table. Sending only the label would be worse: two
/// labels can be edited to read alike, and a filter cannot address a word.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VocabularyTerm {
    pub code: String,
    pub label: String,
}

/// The words a catalogue may be described with.
///
/// One request rather than two, because a screen that filters by both needs
/// both before it can draw either, and because they are read together often
/// enough that splitting them only buys a second round trip.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogueVocabulary {
    /// In `display_order`, which is the order the business thinks in — not
    /// alphabetical, which would put Accessories before Menswear.
    pub divisions: Vec<VocabularyTerm>,
    pub tags: Vec<VocabularyTerm>,
}

/// Read the vocabulary. Inactive terms are left out: a filter offering a word
/// nothing can be classified as is a dead end a buyer has to discover by
/// clicking it.
pub async fn catalogue_vocabulary(pool: &PgPool) -> Result<CatalogueVocabulary, AppError> {
    let divisions = sqlx::query_as::<_, (String, String)>(
        "SELECT code, label FROM division WHERE active ORDER BY display_order, label",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(code, label)| VocabularyTerm { code, label })
    .collect();

    let tags = sqlx::query_as::<_, (String, String)>(
        "SELECT code, label FROM tag WHERE active ORDER BY label",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(code, label)| VocabularyTerm { code, label })
    .collect();

    Ok(CatalogueVocabulary { divisions, tags })
}
