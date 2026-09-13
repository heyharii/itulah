//! The generic record surface: one sheet's worth of context, for any record.
//!
//! Every route here is `/api/v1/records/{kind}/{id}/…`, and `{kind}` is a word
//! from the one vocabulary. That is what makes it generic: the hub's `<Sheet>`
//! already knows which record it has open, so wiring it to these routes gives
//! twenty-four screens comments, tags and a true history without twenty-four
//! decisions — and the twenty-fifth gets them by existing.
//!
//! # How permission works here, and why it is not the usual way
//!
//! `required_role` answers from `(method, path)` alone, and one path serving
//! fifty-seven kinds would have to give one answer for all of them. The lowest
//! answer wins in practice, which would put a payroll run's comments in front
//! of a cashier.
//!
//! So this surface does not have a role of its own: it DELEGATES. The gate for
//! `/api/v1/records/bill/{id}/info` is the gate on `GET /api/v1/finance/bills`
//! — the read that already serves that record — which is why `RecordKind`
//! carries a `read_path`. The rule is applied in `required_role` itself rather
//! than in these handlers, so it is answered in the one place the estate is
//! audited from, and the route catalogue prints `PerRecord` in the role column
//! rather than a number that would be wrong for fifty-six kinds.
//!
//! It delegates to the READ gate for writes too. Saying something about a bill
//! is not posting a bill, and filing one under "chase this" is not paying it:
//! a person who may see a record may write a sentence on it. That is the rule
//! ERPNext settled on — `add_comment` checks read permission on the referenced
//! document — and the alternative, making every comment a Supervisor act,
//! would mean the people who most need to leave a note are the ones who
//! cannot.
//!
//! Editing and deleting a comment are author-only, enforced in the `WHERE` of
//! the statement that does it.

use super::audit::DeclaredSubject;
use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    postgres::{self as infrastructure, NewComment, RecordComment, RecordInfo},
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use uuid::Uuid;

/// Which record this request is about.
///
/// A 404 rather than a 400, for the reason `/api/v1/colors` is: what the
/// caller has got wrong is the address, not the body.
fn kind_of(segment: &str) -> Result<RecordKind, AppError> {
    RecordKind::parse(segment).ok_or_else(|| {
        AppError::NotFound(format!(
            "{segment:?} is not a kind of record this system keeps"
        ))
    })
}

/// Everything around one record: comments, tags, history, filed documents,
/// open threads.
pub async fn info(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((kind, id)): Path<(String, String)>,
) -> Result<Json<RecordInfo>, AppError> {
    Ok(Json(
        infrastructure::record_info(&state.db, kind_of(&kind)?, &id, &principal.username).await?,
    ))
}

pub async fn comment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path((kind, id)): Path<(String, String)>,
    Json(request): Json<NewComment>,
) -> Result<(StatusCode, Json<RecordComment>), AppError> {
    let kind = kind_of(&kind)?;
    let comment = infrastructure::add_record_comment(
        &state.db,
        kind,
        &id,
        &principal.username,
        &principal.display_name,
        &request.body,
    )
    .await?;
    // Filed against the RECORD, not against the comment. Somebody reading a
    // bill's history wants to see that a note was left on it; nobody opens a
    // sheet for a comment.
    acted_on.set(kind, id);
    Ok((StatusCode::CREATED, Json(comment)))
}

#[derive(Debug, Deserialize)]
pub struct EditComment {
    pub body: String,
}

pub async fn edit(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(comment_id): Path<Uuid>,
    Json(request): Json<EditComment>,
) -> Result<Json<RecordComment>, AppError> {
    let comment = infrastructure::edit_record_comment(
        &state.db,
        comment_id,
        &principal.username,
        &request.body,
    )
    .await?;
    let (kind, subject_id) = infrastructure::comment_subject(&state.db, comment_id).await?;
    acted_on.set(kind, subject_id);
    Ok(Json(comment))
}

pub async fn remove(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path(comment_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    // Asked BEFORE the delete. Afterwards there is no row to ask, and an act
    // the log cannot attribute to a record is an act that record's sheet will
    // never show.
    let (kind, subject_id) = infrastructure::comment_subject(&state.db, comment_id).await?;
    infrastructure::delete_record_comment(&state.db, comment_id, &principal.username).await?;
    acted_on.set(kind, subject_id);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn tag(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path((kind, id, code)): Path<(String, String, String)>,
) -> Result<StatusCode, AppError> {
    let kind = kind_of(&kind)?;
    infrastructure::tag_record(&state.db, kind, &id, &code, &principal.username).await?;
    acted_on.set(kind, id);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn untag(
    State(state): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path((kind, id, code)): Path<(String, String, String)>,
) -> Result<StatusCode, AppError> {
    let kind = kind_of(&kind)?;
    infrastructure::untag_record(&state.db, kind, &id, &code).await?;
    acted_on.set(kind, id);
    Ok(StatusCode::NO_CONTENT)
}
