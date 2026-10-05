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
use super::employment::{current_unit, reach_of};
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

fn record_not_found(kind: RecordKind, id: &str) -> AppError {
    AppError::NotFound(format!("{kind} {id}"))
}

/// Resolve the records whose read gate is a *rung* and whose data is bounded by
/// a place, and apply the other half of "may they".
///
/// The generic surface is safe for the kinds whose permission really is a
/// property of the path — a bill read is a rung and nothing else. HR and
/// payroll are not: `people.employee.read` at the Supervisor rung does not mean
/// every supervisor may read every shop's employee, leave, overtime or payroll
/// run. The typed routes answer that with `Reach`; this is the generic door's
/// copy of the same question, applied before the record's comments, tags or
/// history are read or written.
///
/// Kinds outside that set are left to the delegated read gate, which is the
/// design the module doc explains. The set below is deliberately short: it is
/// the HR kinds the audit found leaking, not a second permission system.
async fn authorize_record(
    state: &AppState,
    principal: &Principal,
    kind: RecordKind,
    id: &str,
) -> Result<(), AppError> {
    let unit: Option<String> = match kind {
        RecordKind::Employee => {
            let record = infrastructure::load_employee(&state.db, id)
                .await?
                .ok_or_else(|| record_not_found(kind, id))?;
            current_unit(&record).map(str::to_owned)
        }
        RecordKind::LeaveRequest => {
            let catalogue = infrastructure::load_catalogue(&state.db).await?;
            let record = infrastructure::load_request(&state.db, id, &catalogue)
                .await?
                .ok_or_else(|| record_not_found(kind, id))?;
            Some(record.request.unit().to_string())
        }
        RecordKind::OvertimeOrder => {
            let record = infrastructure::load_overtime_order(&state.db, id)
                .await?
                .ok_or_else(|| record_not_found(kind, id))?;
            Some(record.order.unit().to_string())
        }
        RecordKind::PayrollRun => {
            let run = infrastructure::load_run(&state.db, id)
                .await?
                .ok_or_else(|| record_not_found(kind, id))?;
            Some(run.unit().to_string())
        }
        RecordKind::HireProposal => {
            let record = infrastructure::load_hire_proposal(&state.db, id)
                .await?
                .ok_or_else(|| record_not_found(kind, id))?;
            Some(record.proposal.unit().to_string())
        }
        _ => return Ok(()),
    };
    let reach = reach_of(state, principal).await?;
    if !reach.covers(unit.as_deref()) {
        return Err(AppError::Forbidden(format!(
            "{} is not posted anywhere that reaches {}",
            principal.username,
            unit.as_deref().unwrap_or("the unit this record belongs to")
        )));
    }
    Ok(())
}

/// Everything around one record: comments, tags, history, filed documents,
/// open threads.
pub async fn info(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((kind, id)): Path<(String, String)>,
) -> Result<Json<RecordInfo>, AppError> {
    let kind = kind_of(&kind)?;
    authorize_record(&state, &principal, kind, &id).await?;
    Ok(Json(
        infrastructure::record_info(&state.db, kind, &id, &principal.username).await?,
    ))
}

#[derive(Debug, serde::Deserialize)]
pub struct VersionQuery {
    pub limit: Option<i64>,
}

/// A record's saved changes, field by field, newest first (0702) — the whole
/// history, where `info` carries only its tail.
pub async fn versions(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((kind, id)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<VersionQuery>,
) -> Result<Json<Vec<infrastructure::RecordVersion>>, AppError> {
    let kind = kind_of(&kind)?;
    authorize_record(&state, &principal, kind, &id).await?;
    Ok(Json(
        infrastructure::list_record_versions(&state.db, kind, &id, query.limit.unwrap_or(200))
            .await?,
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
    authorize_record(&state, &principal, kind, &id).await?;
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
    // The subject first, so the record's own scope is checked before a comment
    // on it is changed — a comment is not a back door onto a record somebody
    // cannot read.
    let (kind, subject_id) = infrastructure::comment_subject(&state.db, comment_id).await?;
    authorize_record(&state, &principal, kind, &subject_id).await?;
    let comment = infrastructure::edit_record_comment(
        &state.db,
        comment_id,
        &principal.username,
        &request.body,
    )
    .await?;
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
    authorize_record(&state, &principal, kind, &subject_id).await?;
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
    authorize_record(&state, &principal, kind, &id).await?;
    infrastructure::tag_record(&state.db, kind, &id, &code, &principal.username).await?;
    acted_on.set(kind, id);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn untag(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Path((kind, id, code)): Path<(String, String, String)>,
) -> Result<StatusCode, AppError> {
    let kind = kind_of(&kind)?;
    authorize_record(&state, &principal, kind, &id).await?;
    infrastructure::untag_record(&state.db, kind, &id, &code).await?;
    acted_on.set(kind, id);
    Ok(StatusCode::NO_CONTENT)
}
