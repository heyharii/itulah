//! Small security primitives shared by the Cloud and both Edge runtimes.
//!
//! This module deliberately contains no storage or policy decisions.  It owns
//! only token generation, password verification, digest/signature operations,
//! and conservative cookie formatting so those details do not drift between
//! PostgreSQL and SQLite implementations.

use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use sha2::{Digest as _, Sha256};

pub const SESSION_COOKIE: &str = "inventory_session";
pub const CSRF_COOKIE: &str = "inventory_csrf";
/// Minimum textual length for high-entropy machine credentials. Provisioning
/// emits 256-bit hex values (64 characters); this lower bound prevents weak
/// hand-written sync keys while still accepting other safe encodings.
pub const MIN_SYNC_KEY_LENGTH: usize = 32;

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sha256_hex(value: impl AsRef<[u8]>) -> String {
    hex::encode(Sha256::digest(value.as_ref()))
}

pub fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

pub fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> String {
    const BLOCK_SIZE: usize = 64;
    let mut block = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner_key = [0x36u8; BLOCK_SIZE];
    let mut outer_key = [0x5cu8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_key[index] ^= block[index];
        outer_key[index] ^= block[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_key);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_key);
    outer.update(inner);
    hex::encode(outer.finalize())
}

pub fn hash_password(password: &str, minimum_length: usize) -> Result<String, String> {
    if password.chars().count() < minimum_length {
        return Err(format!(
            "password must be at least {minimum_length} characters"
        ));
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| format!("password hashing failed: {error}"))
}

pub fn password_matches(stored_hash: &str, password: &str) -> bool {
    PasswordHash::new(stored_hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

pub fn normalize_username(username: &str) -> Result<String, String> {
    let username = username.trim().to_ascii_lowercase();
    let valid_chars = username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'));
    if username.len() < 3 || username.len() > 32 || !valid_chars {
        return Err("username must be 3-32 characters of a-z, 0-9, '.', '_' or '-'".into());
    }
    Ok(username)
}

pub fn cookie_value(cookie_header: &str, name: &str) -> Option<String> {
    cookie_header.split(';').find_map(|part| {
        let (candidate, value) = part.trim().split_once('=')?;
        (candidate == name).then(|| value.to_string())
    })
}

pub fn set_cookie(
    name: &str,
    value: &str,
    max_age_seconds: i64,
    secure: bool,
    http_only: bool,
) -> String {
    let mut cookie = format!(
        "{name}={value}; Path=/; Max-Age={}; SameSite=Strict",
        max_age_seconds.max(0)
    );
    if secure {
        cookie.push_str("; Secure");
    }
    if http_only {
        cookie.push_str("; HttpOnly");
    }
    cookie
}

pub fn clear_cookie(name: &str, secure: bool, http_only: bool) -> String {
    set_cookie(name, "", 0, secure, http_only)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_random_and_256_bit() {
        let first = random_token();
        let second = random_token();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[test]
    fn cookie_parser_matches_exact_names() {
        let header = "other=x; inventory_session=abc123; inventory_csrf=def456";
        assert_eq!(
            cookie_value(header, SESSION_COOKIE).as_deref(),
            Some("abc123")
        );
        assert_eq!(cookie_value(header, "session"), None);
    }

    #[test]
    fn password_hash_round_trips() {
        let hash = hash_password("correct-horse-battery", 8)
            .unwrap_or_else(|error| panic!("hash: {error}"));
        assert!(password_matches(&hash, "correct-horse-battery"));
        assert!(!password_matches(&hash, "wrong-password"));
    }
}
