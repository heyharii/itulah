//! The public link of a Surat Jalan Retur.
//!
//! The QR on the printed note opens `/n/{token}` in the hub: a read-only page
//! of that surat jalan for whoever holds the paper (the supplier's driver, a
//! phone camera), with no login.
//!
//! Two routes:
//!
//! * `POST /api/v1/return-notes` — a signed-in person's. The hub sends the note
//!   exactly as it prints it, with a key (its return numbers); the answer is
//!   the link's token. The same key always answers the same token, and the
//!   first snapshot is the one kept, so the page shows what was printed even if
//!   a later print is made from different facts.
//! * `GET /api/v1/public/return-notes/{token}` — public (`auth::is_public`).
//!   The token is the credential: 32 random bytes, so guessing one is not a
//!   plan, and there is no listing. An unknown token is a plain 404.
//!
//! The snapshot is the hub's `PrintableNote`; this module keeps it as it is
//! (an object of bounded size) and hands it back untouched. Reading it is the
//! page's business.

use super::auth::Principal;
use crate::cloud::application::{AppError, AppState};
use axum::{
    extract::{Path, State},
    http::{header, HeaderName, HeaderValue},
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

/// A note's JSON, serialised, is at most this many bytes.
const MAX_NOTE_BYTES: usize = 128 * 1024;

/// The key is the note's return numbers, comma-joined.
const MAX_KEY_CHARS: usize = 500;

#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    pub key: String,
    pub note: Value,
}

/// `POST /api/v1/return-notes` — the link of a note, made the first time and
/// found every time after. `{ "token": "…", "number": "2026-1" }`.
pub async fn create(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<CreateRequest>,
) -> Result<Json<Value>, AppError> {
    let key = request.key.trim();
    if key.is_empty() || key.chars().count() > MAX_KEY_CHARS {
        return Err(AppError::Validation(format!(
            "the key is 1 to {MAX_KEY_CHARS} characters"
        )));
    }
    if !request.note.is_object() {
        return Err(AppError::Validation("the note is an object".into()));
    }
    if !request.note.get("returns").is_some_and(Value::is_array) {
        return Err(AppError::Validation("the note names its returns".into()));
    }
    if serde_json::to_vec(&request.note)?.len() > MAX_NOTE_BYTES {
        return Err(AppError::Validation(format!(
            "the note is at most {} KB",
            MAX_NOTE_BYTES / 1024
        )));
    }

    // First snapshot wins: a second print of the same note finds this row and
    // leaves it as it was. Two printers at the same moment end up with the
    // same token, not two. The number (0969, "2026-1") is the database's to
    // give, on the first insert only, so a reprint keeps it.
    sqlx::query(
        "INSERT INTO return_note_link (token, note_key, note, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (note_key) DO NOTHING",
    )
    .bind(crate::security::random_url_token())
    .bind(key)
    .bind(&request.note)
    .bind(&principal.username)
    .execute(&state.db)
    .await?;
    let (token, number): (String, String) =
        sqlx::query_as("SELECT token, number FROM return_note_link WHERE note_key = $1")
            .bind(key)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(json!({ "token": token, "number": number })))
}

/// `GET /api/v1/public/return-notes/{token}` — public and read-only. The note
/// as it was printed: `{ "note": { … } }`.
pub async fn show(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    // Tokens are base64url; anything else cannot be one, and is not looked up.
    let shaped = !token.is_empty()
        && token.len() <= 128
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    // The number is the row's, not the snapshot's: it rides along inside the
    // note so the page prints it where the paper does.
    let note: Option<Value> = if shaped {
        sqlx::query_scalar(
            "SELECT note || jsonb_build_object('number', number)
               FROM return_note_link WHERE token = $1",
        )
        .bind(&token)
        .fetch_optional(&state.db)
        .await?
    } else {
        None
    };
    let Some(note) = note else {
        return Err(AppError::NotFound("that surat jalan".into()));
    };
    let mut response = Json(json!({ "note": note })).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-robots-tag"),
        HeaderValue::from_static("noindex"),
    );
    Ok(response)
}
