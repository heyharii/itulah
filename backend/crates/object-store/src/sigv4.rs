//! AWS Signature Version 4, the subset S3 needs.
//!
//! Two shapes of signature exist and they are not interchangeable. A *header*
//! signature authenticates a request this process is about to send: the
//! secret never leaves the process. A *query* signature bakes the
//! authentication into a URL so that somebody else — a browser, a handheld —
//! can make the request without ever holding the key. Catalogue images use
//! both: the server writes with the first, and hands out the second.
//!
//! The payload hash is deliberately not optional. R2 accepts `UNSIGNED-PAYLOAD`
//! for header-signed requests, but then the signature covers only the envelope,
//! and a body altered in flight still verifies. Bodies are hashed.

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub const ALGORITHM: &str = "AWS4-HMAC-SHA256";
pub const S3: &str = "s3";
const REQUEST_TYPE: &str = "aws4_request";

/// `20260901T103512Z` — the form every signed header and query uses.
pub fn amz_date(at: DateTime<Utc>) -> String {
    at.format("%Y%m%dT%H%M%SZ").to_string()
}

/// `20260901` — the day portion, which is what the signing key is scoped to.
pub fn date_stamp(at: DateTime<Utc>) -> String {
    at.format("%Y%m%d").to_string()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Percent-encoding per RFC 3986, which is *not* what `application/x-www-form-urlencoded`
/// does. Space becomes `%20`, never `+`, and the four unreserved punctuation
/// marks are left alone. Getting this wrong produces a signature mismatch that
/// looks like a credential problem, so it is written out rather than borrowed.
pub fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Credentials and the scope they are valid in.
pub struct Scope<'a> {
    pub access_key_id: &'a str,
    pub secret_access_key: &'a str,
    pub region: &'a str,
    pub date_stamp: &'a str,
    /// Always [`S3`] in this crate. A field rather than a constant so the
    /// derivation can be checked against AWS's published vector, which is
    /// stated for `iam`; a signing chain verified only against our own output
    /// is not verified at all.
    pub service: &'a str,
}

impl Scope<'_> {
    /// `20260901/auto/s3/aws4_request`
    pub fn credential_scope(&self) -> String {
        format!(
            "{}/{}/{}/{}",
            self.date_stamp, self.region, self.service, REQUEST_TYPE
        )
    }

    /// `AKID/20260901/auto/s3/aws4_request`
    pub fn credential(&self) -> String {
        format!("{}/{}", self.access_key_id, self.credential_scope())
    }

    /// The four-step key derivation. Each step narrows what the key can sign,
    /// so a leaked signing key is worthless outside its day, region, and service.
    fn signing_key(&self) -> Vec<u8> {
        let mut key = hmac(
            format!("AWS4{}", self.secret_access_key).as_bytes(),
            self.date_stamp.as_bytes(),
        );
        key = hmac(&key, self.region.as_bytes());
        key = hmac(&key, self.service.as_bytes());
        hmac(&key, REQUEST_TYPE.as_bytes())
    }

    pub fn sign(&self, string_to_sign: &str) -> String {
        hex::encode(hmac(&self.signing_key(), string_to_sign.as_bytes()))
    }
}

/// HMAC-SHA256. `new_from_slice` only fails for key lengths HMAC cannot
/// accept, and HMAC accepts every length, so the branch is unreachable — but
/// the crate forbids `unwrap`, and an empty key here would produce a signature
/// that fails server-side rather than anything unsafe.
fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    match HmacSha256::new_from_slice(key) {
        Ok(mut mac) => {
            mac.update(data);
            mac.finalize().into_bytes().to_vec()
        }
        Err(_) => Vec::new(),
    }
}

/// One header pair, already lowercased and trimmed.
#[derive(Clone)]
pub struct SignedHeader {
    pub name: String,
    pub value: String,
}

impl SignedHeader {
    pub fn new(name: &str, value: impl Into<String>) -> Self {
        Self {
            name: name.to_ascii_lowercase(),
            value: value.into().trim().to_string(),
        }
    }
}

/// Everything the canonical request is built from.
pub struct CanonicalRequest<'a> {
    pub method: &'a str,
    /// Already-encoded absolute path, e.g. `/images/catalogue/0108775015.jpg`.
    pub path: &'a str,
    /// Query pairs, unencoded. Sorted and encoded here.
    pub query: Vec<(String, String)>,
    pub headers: Vec<SignedHeader>,
    pub payload_hash: &'a str,
}

impl CanonicalRequest<'_> {
    pub fn canonical_query_string(&self) -> String {
        let mut pairs: Vec<(String, String)> = self
            .query
            .iter()
            .map(|(k, v)| (uri_encode(k, true), uri_encode(v, true)))
            .collect();
        pairs.sort();
        pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&")
    }

    fn sorted_headers(&self) -> Vec<SignedHeader> {
        let mut headers = self.headers.clone();
        headers.sort_by(|a, b| a.name.cmp(&b.name));
        headers
    }

    pub fn signed_headers(&self) -> String {
        self.sorted_headers()
            .iter()
            .map(|h| h.name.clone())
            .collect::<Vec<_>>()
            .join(";")
    }

    pub fn canonical(&self) -> String {
        let headers = self
            .sorted_headers()
            .iter()
            .map(|h| format!("{}:{}\n", h.name, h.value))
            .collect::<String>();
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            self.method,
            self.path,
            self.canonical_query_string(),
            headers,
            self.signed_headers(),
            self.payload_hash
        )
    }

    pub fn string_to_sign(&self, amz_date: &str, credential_scope: &str) -> String {
        format!(
            "{}\n{}\n{}\n{}",
            ALGORITHM,
            amz_date,
            credential_scope,
            sha256_hex(self.canonical().as_bytes())
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_encode_leaves_unreserved_alone_and_escapes_space_as_percent_20() {
        assert_eq!(uri_encode("a-b_c.d~e", true), "a-b_c.d~e");
        assert_eq!(uri_encode("a b", true), "a%20b");
        assert_eq!(uri_encode("a/b", false), "a/b");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
    }

    /// The published AWS SigV4 derivation vector. If this drifts, every
    /// request this crate signs is rejected, so it is pinned to the exact
    /// bytes from the specification rather than to our own output.
    #[test]
    fn signing_key_matches_the_published_vector() {
        let scope = Scope {
            access_key_id: "AKIDEXAMPLE",
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            region: "us-east-1",
            date_stamp: "20120215",
            service: "iam",
        };
        assert_eq!(
            hex::encode(scope.signing_key()),
            "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"
        );
    }

    #[test]
    fn credential_scope_is_day_region_service_request() {
        let scope = Scope {
            access_key_id: "AKID",
            secret_access_key: "secret",
            region: "auto",
            date_stamp: "20260901",
            service: S3,
        };
        assert_eq!(scope.credential_scope(), "20260901/auto/s3/aws4_request");
        assert_eq!(scope.credential(), "AKID/20260901/auto/s3/aws4_request");
    }

    #[test]
    fn canonical_query_string_sorts_by_encoded_key() {
        let request = CanonicalRequest {
            method: "GET",
            path: "/images/x.jpg",
            query: vec![
                ("X-Amz-Expires".into(), "900".into()),
                ("X-Amz-Algorithm".into(), ALGORITHM.into()),
            ],
            headers: vec![SignedHeader::new("Host", "example.com")],
            payload_hash: "UNSIGNED-PAYLOAD",
        };
        assert_eq!(
            request.canonical_query_string(),
            "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900"
        );
    }

    #[test]
    fn canonical_request_orders_headers_and_lists_them_signed() {
        let request = CanonicalRequest {
            method: "PUT",
            path: "/images/a.jpg",
            query: vec![],
            headers: vec![
                SignedHeader::new("x-amz-date", "20260901T103512Z"),
                SignedHeader::new("Host", "  example.com  "),
                SignedHeader::new("Content-Type", "image/jpeg"),
            ],
            payload_hash: "abc",
        };
        assert_eq!(request.signed_headers(), "content-type;host;x-amz-date");
        assert!(request.canonical().starts_with("PUT\n/images/a.jpg\n\n"));
        assert!(request.canonical().contains("host:example.com\n"));
    }
}
