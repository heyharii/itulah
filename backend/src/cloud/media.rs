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
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use object_store::{Config, ObjectStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

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
        Some(Self {
            account_id: read("R2_ACCOUNT_ID")?,
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

    pub fn supplier_key(&self, image: &SupplierImage) -> String {
        format!(
            "{}/{}/{}.jpg",
            self.supplier_prefix,
            image.supplier_code(),
            image.item_code()
        )
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
            get(article_image),
        )
        .route(
            "/api/v1/catalogue/articles/{article_code}/colours/{colour}/image/upload-url",
            post(article_image_upload_url),
        )
        .route(
            "/api/v1/catalogue/suppliers/{supplier_code}/items/{item_code}/image",
            get(supplier_image),
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
    if !media.exists(&key).await? {
        return Err(AppError::NotFound(format!(
            "no image for article {} colour {}",
            image.article_code(),
            image.colour().as_char()
        )));
    }
    Ok(Json(media.locate(key)?))
}

async fn article_image_upload_url(
    State(state): State<AppState>,
    Path((article_code, colour)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let media = media(&state)?;
    let image = ArticleImage::parse(&article_code, &colour)?;
    let location = media.upload_location(media.article_key(&image))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn config(public: Option<&str>) -> MediaConfig {
        MediaConfig {
            account_id: "acct".into(),
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
