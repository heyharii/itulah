//! Where a conversation's attachments live — and why that is not the image
//! bucket.
//!
//! # The bug this module exists to close
//!
//! Attachments were first written through [`crate::cloud::media`], the
//! catalogue image store, under an `attachments/` prefix. That store is
//! configured with `R2_PUBLIC_BASE_URL` on purpose: a product photograph is
//! meant to be fetched straight from the bucket by every till in the estate,
//! with no signature and no expiry.
//!
//! Sharing that bucket handed the same property to private correspondence. A
//! scanned invoice attached to one conversation was readable at
//! `https://pub-….r2.dev/attachments/<file_id>.pdf` by anybody at all — no
//! session, no participant check, permanently. The file id is not secret: it
//! is in the API response and in the page. So any participant could copy a
//! public link out of a private room, which is precisely what
//! `0040_collaboration.sql` refused to allow when it declined to give
//! `stored_file` a `url` column:
//!
//! > a file is reached through the conversation or the thread that carries it,
//! > so a link cannot be forwarded to somebody who was never in the room.
//!
//! # The rule
//!
//! Attachments get their own bucket, and this module never calls
//! `with_public_base_url`. There is no method here that returns a URL — not a
//! public one and not a presigned one. The only way out is [`get`], which
//! reads the bytes back through this process, so the permission check in
//! `cloud/http/chat.rs` and `cloud/http/discussion.rs` stands between every
//! byte and its reader.
//!
//! # When it is not configured
//!
//! Attachments fall back to `bytea` in Postgres, exactly as they do on a node
//! with no object storage at all. They must never fall back to the catalogue
//! bucket: an unconfigured node storing private files in a public bucket is
//! the failure this module was written to prevent, and a quiet one.

use crate::cloud::application::AppError;
use object_store::{Config, ObjectStore};

/// Which bucket attachments live in.
///
/// The credentials default to the catalogue's — one R2 account, two buckets —
/// but can be given separately so the attachment bucket is reachable with a
/// token scoped to it alone. A key that can read catalogue imagery then cannot
/// read anybody's correspondence.
#[derive(Clone)]
pub struct AttachmentConfig {
    pub account_id: String,
    /// See `MediaConfig::endpoint`: `STORAGE_ENDPOINT` points this at Google
    /// Cloud Storage instead of R2.
    pub endpoint: Option<String>,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl std::fmt::Debug for AttachmentConfig {
    /// Written out rather than derived: `AppConfig` derives `Debug`, and one
    /// `tracing::debug!(?config)` would otherwise put a bucket secret in a log
    /// file that outlives the key.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AttachmentConfig")
            .field("account_id", &self.account_id)
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("access_key_id", &self.access_key_id)
            .field("secret_access_key", &"<redacted>")
            .finish()
    }
}

impl AttachmentConfig {
    /// `None` when no attachment bucket is named, which sends attachments to
    /// the database. Deliberately not "fall back to `R2_BUCKET`": that is the
    /// public catalogue bucket, and defaulting to it is the bug.
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
            bucket: read("R2_ATTACHMENT_BUCKET")?,
            access_key_id: read("R2_ATTACHMENT_ACCESS_KEY_ID")
                .or_else(|| read("R2_ACCESS_KEY_ID"))?,
            secret_access_key: read("R2_ATTACHMENT_SECRET_ACCESS_KEY")
                .or_else(|| read("R2_SECRET_ACCESS_KEY"))?,
        })
    }
}

/// The attachment bucket, with no way to address it from outside this process.
#[derive(Clone)]
pub struct AttachmentStore {
    store: ObjectStore,
}

impl AttachmentStore {
    pub fn new(config: &AttachmentConfig) -> Result<Self, AppError> {
        // No `with_public_base_url`, ever. See the module comment: the whole
        // point of this store is that its objects have no address a browser
        // can reach directly.
        let mut store_config = Config::r2(
            &config.account_id,
            config.bucket.clone(),
            config.access_key_id.clone(),
            config.secret_access_key.clone(),
        );
        if let Some(endpoint) = &config.endpoint {
            store_config = store_config.with_endpoint(endpoint.clone());
        }
        let store = ObjectStore::new(store_config)
            .map_err(|error| AppError::Configuration(format!("attachment store: {error}")))?;
        Ok(Self { store })
    }

    pub async fn put(&self, key: &str, bytes: Vec<u8>, content_type: &str) -> Result<(), AppError> {
        self.store
            .put(key, bytes, content_type, None)
            .await
            .map(|_| ())
            .map_err(|error| AppError::Configuration(format!("attachment store: {error}")))
    }

    /// Whether the object is actually there, and how big it is.
    ///
    /// Used after a direct upload: the browser sent the bytes past this
    /// process, so the only honest way to record a file as present is to go
    /// and look. Without this, a failed upload would still produce a row that
    /// claims the document is available.
    pub async fn head(&self, key: &str) -> Result<Option<u64>, AppError> {
        self.store
            .head(key)
            .await
            .map(|meta| meta.map(|m| m.size))
            .map_err(|error| AppError::Configuration(format!("attachment store: {error}")))
    }

    /// A time-limited URL a browser may PUT to directly.
    ///
    /// This does not contradict the module's rule that these objects have no
    /// address a browser can reach: a presigned URL is not an address, it is a
    /// grant — it names one key, one method, and expires. What the rule forbids
    /// is a public base URL, which would make every object readable forever by
    /// anyone who guessed its key.
    ///
    /// Documents go direct because they are the size that makes going through
    /// this process wrong: a 512MB node reading a 20MB contract into memory to
    /// hand it to a bucket is a memory spike bought for nothing.
    pub fn presign_put(&self, key: &str, expires_in_secs: u32) -> Result<String, AppError> {
        self.store
            .presign_put(key, expires_in_secs)
            .map_err(|error| AppError::Configuration(format!("attachment store: {error}")))
    }

    /// The same grant, for reading. Issued only after the caller's permission
    /// has been checked, and short-lived because it travels in a response that
    /// may be logged.
    pub fn presign_get(&self, key: &str, expires_in_secs: u32) -> Result<String, AppError> {
        self.store
            .presign_get(key, expires_in_secs)
            .map_err(|error| AppError::Configuration(format!("attachment store: {error}")))
    }

    /// Read the bytes back through this process, so the caller's permission
    /// check is the only door.
    pub async fn get(&self, key: &str) -> Result<Vec<u8>, AppError> {
        self.store
            .get(key)
            .await
            .map_err(|error| AppError::NotFound(format!("attachment store: {error}")))
    }
}
