//! The letter routes.
//!
//! # Which rung, and why reading one is a CASHIER read
//!
//! Nothing here declares a role, so `required_role`'s ordinary rules answer:
//! reads are CASHIER and writes are SUPERVISOR. That is deliberate rather than
//! an oversight, and it only works because of one property of these documents
//! — **a letter carries no money**. A goods receipt note and a delivery note
//! say what arrived and what is being sent, in quantities and article names,
//! which is exactly what the person unloading the vehicle has to check against.
//! The purchasing surface next door is SUPERVISOR to read *because* it carries
//! what a supplier charges; put a price on a delivery note and this rung would
//! become wrong. `LetterLine` has no money field, and that is the reason.
//!
//! Issuing is the SUPERVISOR act, and rightly: a numbered letter is the
//! company committing to what it received or sent.
//!
//! # Who issued it is never in the body
//!
//! The actor comes from the session for every write here. A letter that
//! recorded whoever the browser SAID had signed it would be a signature anybody
//! could type.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, LetterEdit, LetterQuery, NewLetter, NewTemplate, VoidLetter,
    },
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

/// The register: every letter, and how many drafts are waiting.
pub async fn list_letters(
    State(state): State<AppState>,
    Query(query): Query<LetterQuery>,
) -> Result<Json<infrastructure::LetterList>, AppError> {
    Ok(Json(infrastructure::list_letters(&state.db, query).await?))
}

#[derive(Debug, Deserialize)]
pub struct SourceQuery {
    pub kind: String,
}

/// What a letter of this kind could still be written against, and how many
/// records of it are already spoken for.
///
/// The second number is what makes an empty list readable: no rows because
/// nothing has arrived yet, and no rows because every delivery already has its
/// letter, are opposite facts and the screen has to be able to say which.
pub async fn letter_sources(
    State(state): State<AppState>,
    Query(query): Query<SourceQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(json!({
        "items": infrastructure::letter_sources(&state.db, &query.kind).await?,
        "taken": infrastructure::letters_written(&state.db, &query.kind).await?,
    })))
}

/// Every pattern offered for a kind of letter.
pub async fn letter_templates(
    State(state): State<AppState>,
    Query(query): Query<SourceQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(json!({
        "items": infrastructure::letter_templates(&state.db, &query.kind).await?
    })))
}

/// Keep a letter's wording as a pattern, under a name.
pub async fn save_template(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<NewTemplate>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let id = infrastructure::save_template(&state.db, &request, &principal.username).await?;
    Ok((StatusCode::CREATED, Json(json!({ "template_id": id }))))
}

/// Stop offering one. The row stays — see the migration.
pub async fn retire_template(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(principal): Extension<Principal>,
) -> Result<StatusCode, AppError> {
    infrastructure::retire_template(&state.db, id, &principal.username).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// One letter, whole — its head, its table of goods, and what somebody wrote.
pub async fn letter_detail(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<infrastructure::LetterDetail>, AppError> {
    Ok(Json(infrastructure::letter_detail(&state.db, id).await?))
}

/// Start one against a record. A draft, with no number.
pub async fn draft_letter(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<NewLetter>,
) -> Result<(StatusCode, Json<infrastructure::LetterDetail>), AppError> {
    let id = infrastructure::draft_letter(&state.db, &request, &principal.username).await?;
    acted_on.set(RecordKind::Letter, id.to_string());
    Ok((
        StatusCode::CREATED,
        Json(infrastructure::letter_detail(&state.db, id).await?),
    ))
}

/// Keep what somebody typed. Drafts only.
pub async fn save_letter(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(edit): Json<LetterEdit>,
) -> Result<Json<infrastructure::LetterDetail>, AppError> {
    infrastructure::save_letter(&state.db, id, &edit).await?;
    acted_on.set(RecordKind::Letter, id.to_string());
    Ok(Json(infrastructure::letter_detail(&state.db, id).await?))
}

/// Issue it: the number is taken here and nowhere else.
pub async fn issue_letter(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
) -> Result<Json<infrastructure::LetterDetail>, AppError> {
    infrastructure::issue_letter(&state.db, id, &principal.username).await?;
    acted_on.set(RecordKind::Letter, id.to_string());
    Ok(Json(infrastructure::letter_detail(&state.db, id).await?))
}

/// Stop one, with a reason. The number stays spent.
pub async fn void_letter(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<VoidLetter>,
) -> Result<Json<infrastructure::LetterDetail>, AppError> {
    infrastructure::void_letter(&state.db, id, &principal.username, &request).await?;
    acted_on.set(RecordKind::Letter, id.to_string());
    Ok(Json(infrastructure::letter_detail(&state.db, id).await?))
}

/// Throw a draft away.
pub async fn discard_letter(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Extension(acted_on): Extension<DeclaredSubject>,
) -> Result<StatusCode, AppError> {
    infrastructure::discard_letter(&state.db, id).await?;
    acted_on.set(RecordKind::Letter, id.to_string());
    Ok(StatusCode::NO_CONTENT)
}
