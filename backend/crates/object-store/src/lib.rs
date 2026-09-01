//! S3-compatible object storage, aimed at Cloudflare R2.
//!
//! Some things do not belong in Postgres. A catalogue photograph is one of
//! them: it is large, it never changes once written, and every till and
//! handheld in the estate wants to fetch it without a round trip through the
//! application. Those live here, addressed by a key the database stores as a
//! string.
//!
//! # What this client will and will not do
//!
//! It will **not** retry. A PUT that times out may or may not have landed, and
//! a client that quietly repeats it can double-write; the caller knows whether
//! its operation is safe to repeat and decides. It will **not** create
//! buckets — a running service that can create storage can also be talked into
//! creating storage, and the bucket is an operational fact, not a runtime one.
//!
//! It will hash every body it sends, so a signature covers the bytes and not
//! merely the envelope, and it will hand out presigned URLs so a browser can
//! read or write directly without the key ever reaching it.

#![forbid(unsafe_code)]

use chrono::{DateTime, Utc};
use thiserror::Error;

pub mod sigv4;

use sigv4::{CanonicalRequest, Scope, SignedHeader};

/// Where the store is and how to talk to it.
///
/// `public_base_url` is separate from `endpoint` on purpose. The endpoint is
/// the authenticated S3 API; the public base is the r2.dev subdomain or custom
/// domain a browser fetches from. They are different hosts with different
/// trust, and conflating them is how a signed API endpoint ends up in a
/// public catalogue payload.
#[derive(Clone, Debug)]
pub struct Config {
    pub endpoint: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub public_base_url: Option<String>,
}

impl Config {
    /// R2's endpoint is derived from the account id; nobody should be typing
    /// it out by hand.
    pub fn r2(
        account_id: &str,
        bucket: impl Into<String>,
        access_key_id: impl Into<String>,
        secret_access_key: impl Into<String>,
    ) -> Self {
        Self {
            endpoint: format!("https://{account_id}.r2.cloudflarestorage.com"),
            bucket: bucket.into(),
            access_key_id: access_key_id.into(),
            secret_access_key: secret_access_key.into(),
            region: "auto".into(),
            public_base_url: None,
        }
    }

    pub fn with_public_base_url(mut self, base: impl Into<String>) -> Self {
        self.public_base_url = Some(base.into().trim_end_matches('/').to_string());
        self
    }

    fn host(&self) -> Result<String, Error> {
        self.endpoint
            .split("://")
            .nth(1)
            .map(|rest| rest.trim_end_matches('/').to_string())
            .ok_or_else(|| Error::Config("endpoint has no scheme".into()))
    }

    /// `/bucket/key`, each key segment encoded but the separators kept.
    fn canonical_path(&self, key: &str) -> String {
        format!(
            "/{}/{}",
            sigv4::uri_encode(&self.bucket, true),
            sigv4::uri_encode(key.trim_start_matches('/'), false)
        )
    }
}

/// Render an error with everything underneath it.
///
/// `reqwest::Error` displays as "error sending request for url (...)" and puts
/// the reason — DNS, TLS, refused connection — in its source chain. Printing
/// only the top line produces a message that names the URL and says nothing
/// about why, which is the least useful half.
fn with_sources(error: &(dyn std::error::Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut current = error.source();
    while let Some(cause) = current {
        message.push_str(&format!(": {cause}"));
        current = cause.source();
    }
    message
}

impl From<reqwest::Error> for Error {
    fn from(error: reqwest::Error) -> Self {
        Self::Transport(with_sources(&error))
    }
}

#[derive(Debug, Error)]
pub enum Error {
    #[error("object store misconfigured: {0}")]
    Config(String),
    #[error("object store transport: {0}")]
    Transport(String),
    #[error("object store rejected {method} {key}: {status} {body}")]
    Rejected {
        method: &'static str,
        key: String,
        status: u16,
        body: String,
    },
    #[error("no object at {0}")]
    NotFound(String),
}

/// What is known about a stored object without fetching its bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObjectMeta {
    pub key: String,
    pub size: u64,
    pub etag: Option<String>,
    pub content_type: Option<String>,
}

/// A signed client for one bucket.
#[derive(Clone)]
pub struct ObjectStore {
    config: Config,
    http: reqwest::Client,
}

impl ObjectStore {
    pub fn new(config: Config) -> Result<Self, Error> {
        if config.access_key_id.is_empty() || config.secret_access_key.is_empty() {
            return Err(Error::Config("credentials are empty".into()));
        }
        if config.bucket.is_empty() {
            return Err(Error::Config("bucket is empty".into()));
        }
        Ok(Self {
            config,
            http: reqwest::Client::new(),
        })
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    /// The URL a browser fetches, when the bucket is publicly readable.
    /// `None` when no public base is configured — which is the honest answer,
    /// rather than an API URL that will 403 in a page.
    pub fn public_url(&self, key: &str) -> Option<String> {
        self.config
            .public_base_url
            .as_ref()
            .map(|base| format!("{base}/{}", key.trim_start_matches('/')))
    }

    /// Store bytes. The body is hashed and the hash is signed, so a body
    /// altered in flight is rejected rather than stored.
    pub async fn put(
        &self,
        key: &str,
        body: Vec<u8>,
        content_type: &str,
        cache_control: Option<&str>,
    ) -> Result<ObjectMeta, Error> {
        let payload_hash = sigv4::sha256_hex(&body);
        let mut headers = vec![
            SignedHeader::new("content-type", content_type),
            SignedHeader::new("content-length", body.len().to_string()),
        ];
        if let Some(cache) = cache_control {
            headers.push(SignedHeader::new("cache-control", cache));
        }
        let response = self
            .send(
                "PUT",
                key,
                headers,
                &payload_hash,
                Some(body.clone()),
                Utc::now(),
            )
            .await?;
        let status = response.status();
        if !status.is_success() {
            return Err(self.rejection("PUT", key, response).await);
        }
        Ok(ObjectMeta {
            key: key.to_string(),
            size: body.len() as u64,
            etag: header_string(response.headers(), "etag"),
            content_type: Some(content_type.to_string()),
        })
    }

    /// Fetch bytes. `NotFound` is separated from other failures because a
    /// missing image is an ordinary outcome a caller renders a placeholder
    /// for, while a 500 from storage is not.
    pub async fn get(&self, key: &str) -> Result<Vec<u8>, Error> {
        let response = self
            .send(
                "GET",
                key,
                vec![],
                &sigv4::sha256_hex(b""),
                None,
                Utc::now(),
            )
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(Error::NotFound(key.to_string()));
        }
        if !response.status().is_success() {
            return Err(self.rejection("GET", key, response).await);
        }
        Ok(response.bytes().await?.to_vec())
    }

    /// Ask whether an object exists, and how big it is, without paying for its
    /// bytes. This is what an import run uses to skip what is already there.
    pub async fn head(&self, key: &str) -> Result<Option<ObjectMeta>, Error> {
        let response = self
            .send(
                "HEAD",
                key,
                vec![],
                &sigv4::sha256_hex(b""),
                None,
                Utc::now(),
            )
            .await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(self.rejection("HEAD", key, response).await);
        }
        Ok(Some(ObjectMeta {
            key: key.to_string(),
            size: header_string(response.headers(), "content-length")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
            etag: header_string(response.headers(), "etag"),
            content_type: header_string(response.headers(), "content-type"),
        }))
    }

    /// Remove an object. Deleting what is not there succeeds, because the
    /// caller's intent — "this key must not exist" — is already satisfied.
    pub async fn delete(&self, key: &str) -> Result<(), Error> {
        let response = self
            .send(
                "DELETE",
                key,
                vec![],
                &sigv4::sha256_hex(b""),
                None,
                Utc::now(),
            )
            .await?;
        let status = response.status();
        if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(self.rejection("DELETE", key, response).await)
    }

    /// A URL that reads one object, valid for `expires_in_secs`, carrying no
    /// secret. This is how a private bucket serves a browser: the key stays on
    /// the server and the browser gets a URL that expires.
    pub fn presign_get(&self, key: &str, expires_in_secs: u32) -> Result<String, Error> {
        self.presign("GET", key, expires_in_secs, Utc::now())
    }

    /// A URL that writes one object. Lets a handheld send a photograph
    /// straight to storage instead of pushing it through the application.
    pub fn presign_put(&self, key: &str, expires_in_secs: u32) -> Result<String, Error> {
        self.presign("PUT", key, expires_in_secs, Utc::now())
    }

    fn presign(
        &self,
        method: &str,
        key: &str,
        expires_in_secs: u32,
        now: DateTime<Utc>,
    ) -> Result<String, Error> {
        let host = self.config.host()?;
        let amz_date = sigv4::amz_date(now);
        let date_stamp = sigv4::date_stamp(now);
        let scope = Scope {
            access_key_id: &self.config.access_key_id,
            secret_access_key: &self.config.secret_access_key,
            region: &self.config.region,
            date_stamp: &date_stamp,
            service: sigv4::S3,
        };
        let path = self.config.canonical_path(key);
        let headers = vec![SignedHeader::new("host", host.clone())];

        // A presigned URL cannot hash a body it has not seen — the browser
        // supplies it later. That is the one place UNSIGNED-PAYLOAD is
        // correct, and the short expiry is what bounds the exposure.
        let mut query = vec![
            ("X-Amz-Algorithm".to_string(), sigv4::ALGORITHM.to_string()),
            ("X-Amz-Credential".to_string(), scope.credential()),
            ("X-Amz-Date".to_string(), amz_date.clone()),
            ("X-Amz-Expires".to_string(), expires_in_secs.to_string()),
            ("X-Amz-SignedHeaders".to_string(), "host".to_string()),
        ];

        let request = CanonicalRequest {
            method,
            path: &path,
            query: query.clone(),
            headers,
            payload_hash: "UNSIGNED-PAYLOAD",
        };
        let signature = scope.sign(&request.string_to_sign(&amz_date, &scope.credential_scope()));
        query.push(("X-Amz-Signature".to_string(), signature));

        let canonical_query = CanonicalRequest {
            method,
            path: &path,
            query,
            headers: vec![],
            payload_hash: "",
        }
        .canonical_query_string();

        Ok(format!(
            "{}{}?{}",
            self.config.endpoint.trim_end_matches('/'),
            path,
            canonical_query
        ))
    }

    async fn send(
        &self,
        method: &'static str,
        key: &str,
        mut headers: Vec<SignedHeader>,
        payload_hash: &str,
        body: Option<Vec<u8>>,
        now: DateTime<Utc>,
    ) -> Result<reqwest::Response, Error> {
        let host = self.config.host()?;
        let amz_date = sigv4::amz_date(now);
        let date_stamp = sigv4::date_stamp(now);
        let path = self.config.canonical_path(key);

        headers.push(SignedHeader::new("host", host));
        headers.push(SignedHeader::new("x-amz-content-sha256", payload_hash));
        headers.push(SignedHeader::new("x-amz-date", amz_date.clone()));

        let scope = Scope {
            access_key_id: &self.config.access_key_id,
            secret_access_key: &self.config.secret_access_key,
            region: &self.config.region,
            date_stamp: &date_stamp,
            service: sigv4::S3,
        };
        let request = CanonicalRequest {
            method,
            path: &path,
            query: vec![],
            headers: headers.clone(),
            payload_hash,
        };
        let signature = scope.sign(&request.string_to_sign(&amz_date, &scope.credential_scope()));
        let authorization = format!(
            "{} Credential={}, SignedHeaders={}, Signature={}",
            sigv4::ALGORITHM,
            scope.credential(),
            request.signed_headers(),
            signature
        );

        let url = format!("{}{}", self.config.endpoint.trim_end_matches('/'), path);
        let mut builder = self
            .http
            .request(
                reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET),
                url,
            )
            .header("authorization", authorization);
        for header in headers {
            // `host` is set by the transport; sending it twice is a signature
            // mismatch on some proxies.
            if header.name != "host" {
                builder = builder.header(header.name, header.value);
            }
        }
        if let Some(bytes) = body {
            builder = builder.body(bytes);
        }
        Ok(builder.send().await?)
    }

    async fn rejection(
        &self,
        method: &'static str,
        key: &str,
        response: reqwest::Response,
    ) -> Error {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        Error::Rejected {
            method,
            key: key.to_string(),
            status,
            body: body.chars().take(500).collect(),
        }
    }
}

fn header_string(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim_matches('"').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> ObjectStore {
        let config = Config::r2("acct", "images", "AKID", "secret")
            .with_public_base_url("https://img.example.com/");
        #[allow(clippy::expect_used)]
        ObjectStore::new(config).expect("valid config")
    }

    #[test]
    fn empty_credentials_are_refused_at_construction() {
        let config = Config::r2("acct", "images", "", "secret");
        assert!(matches!(ObjectStore::new(config), Err(Error::Config(_))));
    }

    #[test]
    fn r2_endpoint_is_derived_from_the_account_id() {
        let config = Config::r2("acct", "images", "AKID", "secret");
        assert_eq!(config.endpoint, "https://acct.r2.cloudflarestorage.com");
        assert_eq!(config.region, "auto");
    }

    #[test]
    fn public_url_is_none_without_a_configured_base() {
        let config = Config::r2("acct", "images", "AKID", "secret");
        #[allow(clippy::expect_used)]
        let bare = ObjectStore::new(config).expect("valid config");
        assert_eq!(bare.public_url("catalogue/a.jpg"), None);
        assert_eq!(
            store().public_url("catalogue/a.jpg").as_deref(),
            Some("https://img.example.com/catalogue/a.jpg")
        );
    }

    #[test]
    fn canonical_path_keeps_separators_and_encodes_segments() {
        let config = Config::r2("acct", "images", "AKID", "secret");
        assert_eq!(
            config.canonical_path("catalogue/a b.jpg"),
            "/images/catalogue/a%20b.jpg"
        );
        assert_eq!(
            config.canonical_path("/catalogue/x.jpg"),
            "/images/catalogue/x.jpg"
        );
    }

    #[test]
    fn presigned_url_carries_signature_and_no_secret() {
        #[allow(clippy::expect_used)]
        let url = store()
            .presign_get("catalogue/0108775015.jpg", 900)
            .expect("signs");
        assert!(url.starts_with("https://acct.r2.cloudflarestorage.com/images/catalogue/"));
        assert!(url.contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(url.contains("X-Amz-Expires=900"));
        assert!(url.contains("X-Amz-Signature="));
        assert!(!url.contains("secret"));
    }

    /// The signature must depend on the method, or a read-only URL would also
    /// authorise a write.
    #[test]
    fn get_and_put_presign_to_different_signatures() {
        let now = Utc::now();
        let store = store();
        #[allow(clippy::expect_used)]
        let get = store
            .presign("GET", "catalogue/a.jpg", 900, now)
            .expect("signs");
        #[allow(clippy::expect_used)]
        let put = store
            .presign("PUT", "catalogue/a.jpg", 900, now)
            .expect("signs");
        assert_ne!(get, put);
    }
}
