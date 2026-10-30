//! Catalogue imagery: the bytes that do not belong in Postgres.
//!
//! A product photograph is large, immutable once written, and wanted by every
//! till and handheld in the estate. Storing it in the database means every
//! read drags it through the application; storing it in object storage means
//! the database keeps only a short key and the browser fetches the rest
//! directly. This module owns that key and nothing else.
//!
//! # Two identities, two prefixes, and why they are not one
//!
//! An article code is **ours**: eight digits minted from `article_code_seq`,
//! never derived from anything a supplier sends. A SKU is that code plus a
//! colour digit plus a size — so an article code that did not come from us is
//! an article that can never be tagged, priced or sold. Imagery follows the
//! same rule, and the catalogue prefix is keyed by our identity alone:
//!
//! ```text
//! catalogue/00000042/3.jpg     article 00000042, colour digit 3
//! ```
//!
//! Photographs are per colourway, not per SKU: every size of the red shirt is
//! the same red shirt, and one image serves them all.
//!
//! A supplier's own code — `0237347069` in the H&M feed — is not an identity
//! here. Two suppliers reuse each other's numbers and one supplier changes
//! its own between shipments. Those images are still worth keeping, so they
//! get a separate prefix under the supplier's own naming, which is what
//! `supplier_item.image_url` points at:
//!
//! ```text
//! supplier/hm/0237347069.jpg   supplier hm, item code 0237347069
//! ```
//!
//! The move from the second to the first happens when a human links a
//! `supplier_item` to an `internal_article_code` and a colour. That link is a
//! decision, not a string operation, and this module deliberately cannot make
//! it: deriving one key from the other would put a photograph next to a price
//! on the strength of a coincidence in numbering.
//!
//! # The ten-colourway ceiling is real here too
//!
//! Colour is one digit, so [`ColourDigit`] accepts `0`–`9` and nothing else.
//! Supplier articles routinely carry more — twenty-four colourways is ordinary
//! in the H&M feed — which is exactly why the mapping above cannot be
//! mechanical. The formats themselves live in the identity module.

use crate::cloud::application::{AppError, AppState};
use crate::cloud::domain::validate_article_code;
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use object_store::{Config, ObjectStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::sync::Arc;
use uuid::Uuid;

/// How long a handed-out read URL stays good. Long enough for a slow shop
/// connection to finish a fetch, short enough that a URL copied out of a log
/// is worthless by the time anyone reads it.
const READ_URL_TTL_SECONDS: u32 = 15 * 60;
/// Uploads are rarer and more deliberate, and a handheld on a bad link needs
/// room to finish.
const WRITE_URL_TTL_SECONDS: u32 = 60 * 60;
/// Catalogue images never change: a new photograph gets written over the same
/// colourway only when the garment itself is re-shot, which is rare enough to
/// be worth a cache purge.
const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Where imagery lives. Absent means this node serves no images — a valid
/// deployment, not a fault, so the service boots without it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MediaConfig {
    pub account_id: String,
    /// An S3-compatible endpoint other than R2 — `https://storage.googleapis.com`
    /// for Google Cloud Storage. When set, `account_id` is not needed.
    pub endpoint: Option<String>,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    /// The r2.dev subdomain or custom domain a browser reads from. This is
    /// **not** the S3 endpoint: without it, every URL handed out is presigned
    /// and therefore expiring.
    pub public_base_url: Option<String>,
    /// Prefix for imagery keyed by our own article codes.
    pub catalogue_prefix: String,
    /// Prefix for imagery still keyed by a supplier's numbering.
    pub supplier_prefix: String,
}

impl MediaConfig {
    pub fn from_env() -> Option<Self> {
        let read = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let endpoint = read("STORAGE_ENDPOINT");
        Some(Self {
            account_id: match &endpoint {
                Some(_) => read("R2_ACCOUNT_ID").unwrap_or_default(),
                None => read("R2_ACCOUNT_ID")?,
            },
            endpoint,
            bucket: read("R2_BUCKET")?,
            access_key_id: read("R2_ACCESS_KEY_ID")?,
            secret_access_key: read("R2_SECRET_ACCESS_KEY")?,
            public_base_url: read("R2_PUBLIC_BASE_URL"),
            catalogue_prefix: read("R2_CATALOGUE_PREFIX").unwrap_or_else(|| "catalogue".into()),
            supplier_prefix: read("R2_SUPPLIER_PREFIX").unwrap_or_else(|| "supplier".into()),
        })
    }
}

/// One of the ten colours an article may have.
///
/// A newtype rather than a `char` because the ceiling is the whole point: an
/// eleventh colourway cannot be expressed, and the place to discover that is
/// here, not in a key that silently addresses `catalogue/00000042/10.jpg`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ColourDigit(char);

impl ColourDigit {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        let mut chars = raw.trim().chars();
        match (chars.next(), chars.next()) {
            (Some(digit), None) if digit.is_ascii_digit() => Ok(Self(digit)),
            _ => Err(AppError::Validation(format!(
                "colour must be a single digit 0-9, got {raw:?}; an article has \
                 at most ten colourways"
            ))),
        }
    }

    pub fn as_char(self) -> char {
        self.0
    }
}

/// A photograph of one colourway of one of our articles.
///
/// Both halves are validated before they reach a key. Article codes go
/// through [`validate_article_code`] — the same check the rest of
/// the system uses — so imagery cannot be filed under an article shape that
/// could never own a SKU.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArticleImage {
    article_code: String,
    colour: ColourDigit,
}

impl ArticleImage {
    pub fn parse(article_code: &str, colour: &str) -> Result<Self, AppError> {
        let article_code = article_code.trim().to_string();
        validate_article_code(&article_code).map_err(AppError::Validation)?;
        Ok(Self {
            article_code,
            colour: ColourDigit::parse(colour)?,
        })
    }

    pub fn article_code(&self) -> &str {
        &self.article_code
    }

    pub fn colour(&self) -> ColourDigit {
        self.colour
    }
}

/// A photograph still filed under a supplier's own numbering.
///
/// Validation here is narrower than the schema allows on purpose: the schema
/// stores whatever the supplier calls a thing, but a key is a path, and a
/// code arriving from a URL that contains `/` or `..` walks out of the prefix
/// and addresses arbitrary objects in the bucket.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SupplierImage {
    supplier_code: String,
    item_code: String,
}

impl SupplierImage {
    pub fn parse(supplier_code: &str, item_code: &str) -> Result<Self, AppError> {
        Ok(Self {
            supplier_code: path_safe(supplier_code, "supplier code")?,
            item_code: path_safe(item_code, "supplier item code")?,
        })
    }

    pub fn supplier_code(&self) -> &str {
        &self.supplier_code
    }

    pub fn item_code(&self) -> &str {
        &self.item_code
    }
}

fn path_safe(raw: &str, what: &str) -> Result<String, AppError> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 64 {
        return Err(AppError::Validation(format!(
            "{what} must be 1 to 64 characters"
        )));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(format!(
            "{what} may contain only letters, digits, hyphen, and underscore"
        )));
    }
    Ok(value.to_string())
}

/// The thumbnail that sits beside a photograph: the same key with `.jpg`
/// replaced by `.t.jpg`.
///
/// ```text
/// supplier/0016/ITM-E5151439.jpg     the photograph, up to 1600px
/// supplier/0016/ITM-E5151439.t.jpg   its thumbnail, 200px on the short side
/// ```
///
/// A photograph is drawn at 32-56px in every list, so a list that fetches the
/// photograph downloads about a hundred kilobytes and decodes about eight
/// megabytes of bitmap for a box the size of a postage stamp. The thumbnail is
/// a tenth of the bytes and a fortieth of the memory.
///
/// No photograph's own key can end in `.t.jpg`: [`path_safe`] refuses a dot in
/// a supplier or item code and an article code is digits, so the two names
/// cannot meet. The hub derives the thumbnail's address from the photograph's
/// by the same rule (`frontend-hub/src/lib/thumb.ts`).
pub fn thumbnail_key(key: &str) -> String {
    match key.strip_suffix(".jpg") {
        Some(stem) => format!("{stem}.t.jpg"),
        None => format!("{key}.t.jpg"),
    }
}

/// Which of a photograph's two objects an upload URL is wanted for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
pub struct UploadVariant {
    /// `thumb` for the thumbnail; absent for the photograph.
    variant: Option<ImageVariant>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ImageVariant {
    Thumb,
}

impl UploadVariant {
    /// The key to write: the photograph's own, or its thumbnail's.
    pub fn key_for(self, key: String) -> String {
        match self.variant {
            Some(ImageVariant::Thumb) => thumbnail_key(&key),
            None => key,
        }
    }
}

/// What a caller is told about one image.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ImageLocation {
    pub key: String,
    pub url: String,
    /// `None` when the URL is a permanent public one; seconds otherwise. The
    /// caller needs this to know whether the URL is cacheable.
    pub expires_in_seconds: Option<u32>,
}

/// The catalogue's view of object storage.
#[derive(Clone)]
pub struct CatalogueMedia {
    store: ObjectStore,
    catalogue_prefix: String,
    supplier_prefix: String,
}

impl CatalogueMedia {
    pub fn new(config: &MediaConfig) -> Result<Self, AppError> {
        let mut store_config = Config::r2(
            &config.account_id,
            config.bucket.clone(),
            config.access_key_id.clone(),
            config.secret_access_key.clone(),
        );
        if let Some(endpoint) = &config.endpoint {
            store_config = store_config.with_endpoint(endpoint.clone());
        }
        if let Some(base) = &config.public_base_url {
            store_config = store_config.with_public_base_url(base.clone());
        }
        let store = ObjectStore::new(store_config)
            .map_err(|e| AppError::Configuration(format!("catalogue media: {e}")))?;
        Ok(Self {
            store,
            catalogue_prefix: config.catalogue_prefix.trim_matches('/').to_string(),
            supplier_prefix: config.supplier_prefix.trim_matches('/').to_string(),
        })
    }

    pub fn article_key(&self, image: &ArticleImage) -> String {
        format!(
            "{}/{}/{}.jpg",
            self.catalogue_prefix,
            image.article_code(),
            image.colour().as_char()
        )
    }

    /// The article's own picture: `<prefix>/<article code>/main.jpg`.
    pub fn article_main_key(&self, article_code: &str) -> Result<String, AppError> {
        let article_code = article_code.trim();
        validate_article_code(article_code).map_err(AppError::Validation)?;
        Ok(format!(
            "{}/{}/main.jpg",
            self.catalogue_prefix, article_code
        ))
    }

    /// Take a photograph away, and its thumbnail with it: a thumbnail left
    /// behind would show a garment nobody has a picture of any more.
    pub async fn remove(&self, key: &str) -> Result<(), AppError> {
        for each in [thumbnail_key(key), key.to_string()] {
            self.store
                .delete(&each)
                .await
                .map_err(|e| AppError::Configuration(format!("object store: {e}")))?;
        }
        Ok(())
    }

    pub fn supplier_key(&self, image: &SupplierImage) -> String {
        format!(
            "{}/{}/{}.jpg",
            self.supplier_prefix,
            image.supplier_code(),
            image.item_code()
        )
    }

    /// A photograph a buyer attached to one variant of an order line (0961).
    ///
    /// Keyed by an id the browser mints, because the line it belongs to may
    /// not exist yet: the bytes go up while the order is still being written,
    /// and the link travels with the order. Filed under the catalogue prefix,
    /// where no article code can be `po-photos` (they are eight digits).
    pub fn order_photo_key(&self, photo_id: Uuid) -> String {
        format!("{}/po-photos/{}.jpg", self.catalogue_prefix, photo_id)
    }

    /// A public URL when the bucket has one, a short-lived signed URL
    /// otherwise. Callers do not need to know which; they need `expires_in`.
    pub fn locate(&self, key: String) -> Result<ImageLocation, AppError> {
        match self.store.public_url(&key) {
            Some(url) => Ok(ImageLocation {
                key,
                url,
                expires_in_seconds: None,
            }),
            None => {
                let url = self
                    .store
                    .presign_get(&key, READ_URL_TTL_SECONDS)
                    .map_err(|e| AppError::Configuration(format!("presign: {e}")))?;
                Ok(ImageLocation {
                    key,
                    url,
                    expires_in_seconds: Some(READ_URL_TTL_SECONDS),
                })
            }
        }
    }

    /// A URL a device can PUT to directly. The credential never leaves this
    /// process, and the URL only authorises this one key.
    pub fn upload_location(&self, key: String) -> Result<ImageLocation, AppError> {
        let url = self
            .store
            .presign_put(&key, WRITE_URL_TTL_SECONDS)
            .map_err(|e| AppError::Configuration(format!("presign: {e}")))?;
        Ok(ImageLocation {
            key,
            url,
            expires_in_seconds: Some(WRITE_URL_TTL_SECONDS),
        })
    }

    /// The stored image's tag, or nothing when it is not there.
    ///
    /// The same HEAD that `exists` makes, keeping what it answers: a picture
    /// that is replaced is written over the same key, and the tag is what
    /// tells the two apart.
    pub async fn version_of(&self, key: &str) -> Result<Option<String>, AppError> {
        self.store
            .head(key)
            .await
            .map(|meta| meta.map(|one| one.etag.unwrap_or_default()))
            .map_err(|e| AppError::Configuration(format!("object store: {e}")))
    }

    /// [`locate`](Self::locate), with the picture's tag on a permanent link.
    ///
    /// A public link is the same text for the life of the key, and the store
    /// serves its pictures to be cached for a year: a picture somebody replaces
    /// would go on showing the old one until each browser's copy aged out. The
    /// tag makes the link say which picture it is. A signed link is new on every
    /// read and needs none.
    pub fn locate_versioned(&self, key: String, version: &str) -> Result<ImageLocation, AppError> {
        let mut location = self.locate(key)?;
        let tag: String = version
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect();
        if location.expires_in_seconds.is_none() && !tag.is_empty() {
            let joiner = if location.url.contains('?') { '&' } else { '?' };
            location.url = format!("{}{joiner}v={tag}", location.url);
        }
        Ok(location)
    }

    /// Whether the image is actually there. An import run uses this to skip
    /// what it has already sent rather than re-uploading the estate.
    pub async fn exists(&self, key: &str) -> Result<bool, AppError> {
        self.store
            .head(key)
            .await
            .map(|meta| meta.is_some())
            .map_err(|e| AppError::Configuration(format!("object store: {e}")))
    }

    /// Arbitrary bytes under a caller-chosen key — a conversation
    /// attachment, not a product photograph.
    ///
    /// No cache-control is set, unlike catalogue imagery: these objects are
    /// private correspondence read back through an authenticated route, and
    /// marking them immutably cacheable would invite a proxy to keep a copy.
    pub async fn put_bytes(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: &str,
    ) -> Result<String, AppError> {
        self.store
            .put(key, bytes, content_type, None)
            .await
            .map(|meta| meta.key)
            .map_err(|e| AppError::Configuration(format!("object store: {e}")))
    }

    /// Read an object back through this process.
    ///
    /// Deliberately not a presigned URL: an attachment is reached through the
    /// conversation that carries it, and a signed URL is a link that works
    /// outside that conversation for as long as it lives.
    pub async fn get_object(&self, key: &str) -> Result<Vec<u8>, AppError> {
        self.store
            .get(key)
            .await
            .map_err(|e| AppError::NotFound(format!("object store: {e}")))
    }

    /// Write bytes through this process. Used by server-side imports; devices
    /// should take an upload URL instead so the bytes never transit here.
    pub async fn put_jpeg(&self, key: &str, bytes: Vec<u8>) -> Result<String, AppError> {
        self.store
            .put(key, bytes, "image/jpeg", Some(IMMUTABLE_CACHE_CONTROL))
            .await
            .map(|meta| meta.key)
            .map_err(|e| AppError::Configuration(format!("object store: {e}")))
    }
}

/// Routes. The handlers answer 404 when media is unconfigured, so a node
/// without object storage says "no imagery here" rather than faulting.
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/catalogue/articles/{article_code}/colours/{colour}/image",
            get(article_image).delete(article_image_delete),
        )
        .route(
            "/api/v1/catalogue/articles/{article_code}/colours/{colour}/image/upload-url",
            post(article_image_upload_url),
        )
        // The article's own picture, the one a colour without a photograph of
        // its own shows. Filed as `main`, which is not a colour digit, so it
        // can never collide with one.
        .route(
            "/api/v1/catalogue/articles/{article_code}/image",
            get(article_main_image).delete(article_main_image_delete),
        )
        .route(
            "/api/v1/catalogue/articles/{article_code}/image/upload-url",
            post(article_main_image_upload_url),
        )
        .route(
            "/api/v1/catalogue/suppliers/{supplier_code}/items/{item_code}/image",
            get(supplier_image),
        )
        .route(
            "/api/v1/catalogue/suppliers/{supplier_code}/items/{item_code}/image/upload-url",
            post(supplier_image_upload_url),
        )
        .route(
            "/api/v1/catalogue/order-photos/{photo_id}",
            get(order_photo),
        )
        .route(
            "/api/v1/catalogue/order-photos/{photo_id}/upload-url",
            post(order_photo_upload_url),
        )
}

fn media(state: &AppState) -> Result<Arc<CatalogueMedia>, AppError> {
    state
        .media
        .clone()
        .ok_or_else(|| AppError::NotFound("catalogue media is not configured on this node".into()))
}

async fn article_image(
    State(state): State<AppState>,
    Path((article_code, colour)): Path<(String, String)>,
) -> Result<Json<ImageLocation>, AppError> {
    let media = media(&state)?;
    let image = ArticleImage::parse(&article_code, &colour)?;
    let key = media.article_key(&image);
    let Some(version) = media.version_of(&key).await? else {
        return Err(AppError::NotFound(format!(
            "no image for article {} colour {}",
            image.article_code(),
            image.colour().as_char()
        )));
    };
    Ok(Json(media.locate_versioned(key, &version)?))
}

async fn article_image_upload_url(
    State(state): State<AppState>,
    Path((article_code, colour)): Path<(String, String)>,
    Query(variant): Query<UploadVariant>,
) -> Result<Json<Value>, AppError> {
    let media = media(&state)?;
    let image = ArticleImage::parse(&article_code, &colour)?;
    let location = media.upload_location(variant.key_for(media.article_key(&image)))?;
    Ok(Json(json!({
        "upload": location,
        "method": "PUT",
        "content_type": "image/jpeg",
    })))
}

/// Take a colourway's own photograph away. The colour then shows the
/// article's main picture again. Removing what is not there succeeds: the
/// caller's intent — no photograph of its own — is already true.
async fn article_image_delete(
    State(state): State<AppState>,
    Path((article_code, colour)): Path<(String, String)>,
) -> Result<axum::http::StatusCode, AppError> {
    let media = media(&state)?;
    let image = ArticleImage::parse(&article_code, &colour)?;
    media.remove(&media.article_key(&image)).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn article_main_image(
    State(state): State<AppState>,
    Path(article_code): Path<String>,
) -> Result<Json<ImageLocation>, AppError> {
    let media = media(&state)?;
    let key = media.article_main_key(&article_code)?;
    let Some(version) = media.version_of(&key).await? else {
        return Err(AppError::NotFound(format!(
            "no main image for article {}",
            article_code.trim()
        )));
    };
    Ok(Json(media.locate_versioned(key, &version)?))
}

async fn article_main_image_upload_url(
    State(state): State<AppState>,
    Path(article_code): Path<String>,
    Query(variant): Query<UploadVariant>,
) -> Result<Json<Value>, AppError> {
    let media = media(&state)?;
    let location =
        media.upload_location(variant.key_for(media.article_main_key(&article_code)?))?;
    Ok(Json(json!({
        "upload": location,
        "method": "PUT",
        "content_type": "image/jpeg",
    })))
}

async fn article_main_image_delete(
    State(state): State<AppState>,
    Path(article_code): Path<String>,
) -> Result<axum::http::StatusCode, AppError> {
    let media = media(&state)?;
    media
        .remove(&media.article_main_key(&article_code)?)
        .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// A URL the browser can PUT a supplier item's photograph to.
///
/// The mirror of `article_image_upload_url`, and it exists for the same reason
/// that one does: the bytes go straight to the bucket and the credential never
/// leaves this process. It was missing while the read route was not, which
/// left `supplier_item.image_url` writable only by the scraper that seeded it
/// — a buyer adding an item to the catalogue by hand could name a photograph
/// somebody else already hosted and nothing else.
///
/// Unlike the article route, what is stored afterwards is a URL in a column
/// rather than a key this module can recompute. The caller therefore reads the
/// location back through the GET route above once the bytes are up, which is
/// the one that knows whether this bucket serves a public URL or a signed one.
async fn supplier_image_upload_url(
    State(state): State<AppState>,
    Path((supplier_code, item_code)): Path<(String, String)>,
    Query(variant): Query<UploadVariant>,
) -> Result<Json<Value>, AppError> {
    let media = media(&state)?;
    let image = SupplierImage::parse(&supplier_code, &item_code)?;
    let location = media.upload_location(variant.key_for(media.supplier_key(&image)))?;
    Ok(Json(json!({
        "upload": location,
        "method": "PUT",
        "content_type": "image/jpeg",
    })))
}

async fn supplier_image(
    State(state): State<AppState>,
    Path((supplier_code, item_code)): Path<(String, String)>,
) -> Result<Json<ImageLocation>, AppError> {
    let media = media(&state)?;
    let image = SupplierImage::parse(&supplier_code, &item_code)?;
    let key = media.supplier_key(&image);
    if !media.exists(&key).await? {
        return Err(AppError::NotFound(format!(
            "no image for supplier {} item {}",
            image.supplier_code(),
            image.item_code()
        )));
    }
    Ok(Json(media.locate(key)?))
}

/// A URL the browser can PUT one order photograph to (0961). The caller reads
/// the location back through the GET below once the bytes are up, as it does
/// for a supplier item, and sends that link with the order.
async fn order_photo_upload_url(
    State(state): State<AppState>,
    Path(photo_id): Path<Uuid>,
    Query(variant): Query<UploadVariant>,
) -> Result<Json<Value>, AppError> {
    let media = media(&state)?;
    let location = media.upload_location(variant.key_for(media.order_photo_key(photo_id)))?;
    Ok(Json(json!({
        "upload": location,
        "method": "PUT",
        "content_type": "image/jpeg",
    })))
}

async fn order_photo(
    State(state): State<AppState>,
    Path(photo_id): Path<Uuid>,
) -> Result<Json<ImageLocation>, AppError> {
    let media = media(&state)?;
    let key = media.order_photo_key(photo_id);
    if !media.exists(&key).await? {
        return Err(AppError::NotFound(format!(
            "no order photograph {photo_id}"
        )));
    }
    Ok(Json(media.locate(key)?))
}

/// The order photograph a stored link points at: the id after `po-photos/`.
/// Anything else — a supplier's own picture pasted in, a link from before
/// 0961 — is not ours to copy and answers `None`.
fn order_photo_id(url: &str) -> Option<Uuid> {
    let (_, rest) = url.split_once("/po-photos/")?;
    let id = rest.get(..36)?;
    Uuid::parse_str(id).ok()
}

/// Give each colourway of the articles just opened the first photograph the
/// order carried for one of its variants (0961) — the owner's rule of
/// 2026-10-10: what the buyer photographed at ordering is what New Articles
/// starts from. Article imagery is per colourway, so a colour takes one.
///
/// Best effort, and never over a photograph a colourway already has: the
/// setup itself has succeeded by the time this runs, and a picture that did
/// not copy is one somebody can still add by hand. The bytes are copied
/// within the bucket by this process (they are small), the thumbnail with
/// them when there is one.
pub async fn adopt_order_photos(
    db: &PgPool,
    media: &CatalogueMedia,
    session_ids: &[Uuid],
) -> Result<usize, AppError> {
    // A colour's first photograph: of its variants that carry any, the one in
    // the smallest size code (the grid's own order), its first.
    let rows = sqlx::query(
        "SELECT DISTINCT ON (s.session_id, c.colour_digit)
                s.article_code, c.colour_digit, v.image_urls[1] AS image_url
           FROM article_setup_session s
           JOIN goods_receipt_line r ON r.receipt_line_id = s.receipt_line_id
           JOIN article_setup_colour c ON c.session_id = s.session_id
           JOIN purchase_order_line_variant v
             ON v.po_line_id = r.po_line_id
            AND v.colour_code = c.colour_code
            AND cardinality(v.image_urls) > 0
          WHERE s.session_id = ANY($1)
          ORDER BY s.session_id, c.colour_digit, v.size_code NULLS FIRST",
    )
    .bind(session_ids)
    .fetch_all(db)
    .await?;
    let mut copied = 0;
    for row in rows {
        let article_code: String = row.try_get("article_code")?;
        let digit: String = row.try_get("colour_digit")?;
        let url: String = row.try_get("image_url")?;
        let Some(photo_id) = order_photo_id(&url) else {
            continue;
        };
        let target = media.article_key(&ArticleImage::parse(&article_code, &digit)?);
        if media.exists(&target).await? {
            continue;
        }
        let source = media.order_photo_key(photo_id);
        let thumb = thumbnail_key(&source);
        if media.exists(&thumb).await? {
            let bytes = media.get_object(&thumb).await?;
            media.put_jpeg(&thumbnail_key(&target), bytes).await?;
        }
        let bytes = media.get_object(&source).await?;
        media.put_jpeg(&target, bytes).await?;
        copied += 1;
    }
    Ok(copied)
}

/// [`adopt_order_photos`] after the response, so opening a setup never waits
/// on the bucket. A node without imagery has nothing to copy.
pub fn adopt_order_photos_later(
    db: PgPool,
    media: Option<Arc<CatalogueMedia>>,
    session_ids: Vec<Uuid>,
) {
    let Some(media) = media else {
        return;
    };
    tokio::spawn(async move {
        if let Err(error) = adopt_order_photos(&db, &media, &session_ids).await {
            tracing::warn!(%error, "order photographs were not copied to the new colourways");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(public: Option<&str>) -> MediaConfig {
        MediaConfig {
            account_id: "acct".into(),
            endpoint: None,
            bucket: "images".into(),
            access_key_id: "AKID".into(),
            secret_access_key: "secret".into(),
            public_base_url: public.map(str::to_string),
            catalogue_prefix: "catalogue".into(),
            supplier_prefix: "supplier".into(),
        }
    }

    fn media() -> CatalogueMedia {
        #[allow(clippy::expect_used)]
        CatalogueMedia::new(&config(None)).expect("valid media config")
    }

    #[test]
    fn a_catalogue_key_is_our_article_code_and_colour_digit() {
        #[allow(clippy::expect_used)]
        let image = ArticleImage::parse("00000042", "3").expect("valid article image");
        assert_eq!(media().article_key(&image), "catalogue/00000042/3.jpg");
    }

    /// The ceiling, enforced where a key is built. `10` is not a colour.
    #[test]
    fn there_is_no_eleventh_colourway() {
        for digit in ["10", "", "a", "-1", "03"] {
            assert!(
                ColourDigit::parse(digit).is_err(),
                "{digit:?} should not be a colour digit"
            );
        }
        for digit in ["0", "9", " 5 "] {
            assert!(ColourDigit::parse(digit).is_ok(), "{digit:?} is a colour");
        }
    }

    /// A supplier's ten-digit code is not an article code, and must not be
    /// accepted as one — this is the whole point of the rework.
    #[test]
    fn a_supplier_code_is_refused_as_an_article_code() {
        assert!(ArticleImage::parse("0237347069", "0").is_err());
        assert!(ArticleImage::parse("0237347", "0").is_err());
    }

    #[test]
    fn supplier_imagery_keeps_the_suppliers_own_numbering() {
        #[allow(clippy::expect_used)]
        let image = SupplierImage::parse("hm", "0237347069").expect("valid supplier image");
        assert_eq!(media().supplier_key(&image), "supplier/hm/0237347069.jpg");
    }

    /// Both key builders take validated inputs, so neither can be walked out
    /// of its prefix.
    #[test]
    fn traversal_is_refused_on_both_sides() {
        assert!(ArticleImage::parse("../secret", "0").is_err());
        assert!(SupplierImage::parse("hm", "../secret").is_err());
        assert!(SupplierImage::parse("a/b", "x").is_err());
        assert!(SupplierImage::parse("hm", "").is_err());
    }

    #[test]
    fn without_a_public_base_the_read_url_expires() {
        #[allow(clippy::expect_used)]
        let location = media()
            .locate("catalogue/00000042/3.jpg".into())
            .expect("locates");
        assert_eq!(location.expires_in_seconds, Some(READ_URL_TTL_SECONDS));
        assert!(location.url.contains("X-Amz-Signature="));
    }

    #[test]
    fn with_a_public_base_the_read_url_is_permanent_and_unsigned() {
        #[allow(clippy::expect_used)]
        let media = CatalogueMedia::new(&config(Some("https://img.example.com"))).expect("valid");
        #[allow(clippy::expect_used)]
        let location = media
            .locate("catalogue/00000042/3.jpg".into())
            .expect("locates");
        assert_eq!(location.expires_in_seconds, None);
        assert_eq!(
            location.url,
            "https://img.example.com/catalogue/00000042/3.jpg"
        );
    }

    /// An order photograph cannot land on an article's colourway: article
    /// codes are eight digits, and this folder is not one.
    #[test]
    fn an_order_photograph_has_its_own_folder() {
        let id = Uuid::nil();
        assert_eq!(
            media().order_photo_key(id),
            "catalogue/po-photos/00000000-0000-0000-0000-000000000000.jpg"
        );
        assert!(ArticleImage::parse("po-photos", "0").is_err());
    }

    #[test]
    fn an_order_photograph_is_found_by_its_link() {
        let id = "6f2b9a3e-1c4d-4e8f-9a0b-2c3d4e5f6a7b";
        assert_eq!(
            order_photo_id(&format!(
                "https://img.example.com/catalogue/po-photos/{id}.jpg?v=1"
            )),
            Uuid::parse_str(id).ok()
        );
        assert_eq!(
            order_photo_id("https://img.example.com/supplier/hm/1.jpg"),
            None
        );
        assert_eq!(order_photo_id("https://x/po-photos/not-a-uuid.jpg"), None);
    }

    #[test]
    fn a_thumbnail_sits_beside_its_photograph() {
        assert_eq!(
            thumbnail_key("supplier/0016/ITM-E5151439.jpg"),
            "supplier/0016/ITM-E5151439.t.jpg"
        );
        assert_eq!(
            thumbnail_key("catalogue/00000042/3.jpg"),
            "catalogue/00000042/3.t.jpg"
        );
    }

    /// A key that cannot hold a dot cannot be a thumbnail's, so the two
    /// objects can never be one.
    #[test]
    fn no_photograph_can_be_filed_under_a_thumbnails_name() {
        assert!(SupplierImage::parse("hm", "ITM-1.t").is_err());
        assert!(SupplierImage::parse("a.t", "ITM-1").is_err());
        assert!(ArticleImage::parse("0000004.t", "3").is_err());
    }

    #[test]
    fn the_variant_picks_which_object_the_upload_url_is_for() {
        let key = "supplier/hm/0237347069.jpg".to_string();
        assert_eq!(UploadVariant::default().key_for(key.clone()), key);
        let thumb = UploadVariant {
            variant: Some(ImageVariant::Thumb),
        };
        assert_eq!(thumb.key_for(key), "supplier/hm/0237347069.t.jpg");
    }

    /// A read URL must not also authorise a write.
    #[test]
    fn upload_url_differs_from_read_url() {
        let media = media();
        let key = "catalogue/00000042/3.jpg".to_string();
        #[allow(clippy::expect_used)]
        let read = media.locate(key.clone()).expect("locates");
        #[allow(clippy::expect_used)]
        let write = media.upload_location(key).expect("locates");
        assert_ne!(read.url, write.url);
        assert_eq!(read.key, write.key);
    }
}
