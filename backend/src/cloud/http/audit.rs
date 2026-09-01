//! The activity log, written for every action, and read back by the sheets.
//!
//! One middleware rather than two hundred handler calls. That trade loses
//! detail — this can say "POST /api/v1/suppliers/{id}/activate → 200" and not
//! "reactivated Anugerah Garmen" — and buys the thing that matters more on a
//! surface this wide: nothing can be forgotten. A handler that wants to say
//! something richer writes its own row on top; this one is the floor.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    postgres::{self as infrastructure, AuditEntry},
};
use axum::{
    extract::{Query, Request, State},
    http::Method,
    middleware::Next,
    response::Response,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;

/// Only writes are recorded.
///
/// A GET is a person looking, and this table exists to answer "who changed
/// this". Logging reads as well would bury every change under a hundred
/// glances, and it would turn an audit trail into a surveillance log of what
/// each colleague was curious about — which is a different thing, and not one
/// anybody asked for.
fn is_write(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PATCH | Method::PUT | Method::DELETE
    )
}

/// Which record a path is about, guessed from its shape.
///
/// `/api/v1/suppliers/{id}/activate` is a supplier; `/api/v1/inventory/counts/{id}/submit`
/// is a count. The rule is: the last identifier-looking segment, named by the
/// collection segment before it, singularised. Best-effort on purpose — a path
/// that names no record leaves this empty, and the row is still a true
/// statement about who did what.
fn subject_of(path: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let mut found: Option<(String, String)> = None;
    for (index, part) in parts.iter().enumerate() {
        if index == 0 || !looks_like_id(part) {
            continue;
        }
        let collection = parts[index - 1];
        found = Some((singular(collection), (*part).to_owned()));
    }
    found
}

/// A uuid, or a code long enough not to be a route word. Deliberately loose:
/// this system's identifiers include uuids, PO numbers and account codes, and
/// a stricter test would silently stop recording the subject of half of them.
fn looks_like_id(part: &str) -> bool {
    if part.len() >= 32 && part.chars().filter(|c| *c == '-').count() == 4 {
        return true;
    }
    part.len() >= 4
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && part.chars().any(|c| c.is_ascii_digit())
}

fn singular(collection: &str) -> String {
    let word = collection.replace('-', "_");
    match word.strip_suffix('s') {
        // "addresses" → "address", not "addresse".
        Some(stem) if stem.ends_with("se") || stem.ends_with("che") => {
            stem.trim_end_matches('e').to_owned()
        }
        Some(stem) if !stem.is_empty() => stem.to_owned(),
        _ => word,
    }
}

pub async fn audit_actions(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let method = request.method().clone();
    if !is_write(&method) {
        return Ok(next.run(request).await);
    }
    let path = request.uri().path().to_owned();
    // Signing in and out are recorded by the session code, which knows more
    // about them than a path does — and a login body is the one body that must
    // never come near this table.
    if path.ends_with("/auth/login") || path.ends_with("/auth/logout") {
        return Ok(next.run(request).await);
    }
    let principal = request.extensions().get::<Principal>().cloned();

    let response = next.run(request).await;
    let status = response.status();

    // Nothing to attribute means nothing to record: an unauthenticated write
    // never reached a handler, and the auth layer has already refused it.
    let Some(principal) = principal else {
        return Ok(response);
    };

    let subject = subject_of(&path);
    let entry = infrastructure::NewAudit {
        username: &principal.username,
        display_name: &principal.display_name,
        role: principal.role.as_str(),
        method: method.as_str(),
        path: &path,
        status: status.as_u16() as i16,
        subject: subject.clone(),
        // Never the request body. Bodies here carry passwords, sync keys and
        // personal data, and an audit table is the last place any of them
        // should be durably written.
        payload: json!({}),
    };

    // Recording must never break the action it is recording. The write already
    // happened and the caller already has their answer; a failure here is a
    // gap in the log, which is worth a log line and nothing more.
    if let Err(error) = infrastructure::record_audit(&state.db, entry).await {
        tracing::warn!(%path, %error, "could not record the action in the audit log");
        return Ok(response);
    }

    // The broadcast. Only for actions that actually succeeded: announcing a
    // refusal to the whole business would be both noisy and unkind.
    if status.is_success() {
        if let Err(error) = announce(&state, &principal, &method, &path, subject).await {
            tracing::warn!(%path, %error, "could not announce the action");
        }
    }

    Ok(response)
}

async fn announce(
    state: &AppState,
    principal: &Principal,
    method: &Method,
    path: &str,
    subject: Option<(String, String)>,
) -> Result<(), AppError> {
    let recipients = infrastructure::every_active_user(&state.db).await?;
    if recipients.is_empty() {
        return Ok(());
    }
    let what = subject
        .as_ref()
        .map(|(kind, id)| format!("{kind} {id}"))
        .unwrap_or_else(|| path.trim_start_matches("/api/v1/").to_owned());

    let mut tx = state.db.begin().await?;
    infrastructure::announce_activity(
        &mut tx,
        &recipients,
        &principal.username,
        format!("{} · {what}", principal.display_name),
        format!("{} {path}", method.as_str()),
        subject
            .as_ref()
            .map(|(kind, id)| (kind.as_str(), id.clone())),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// What a sheet asks for: one record's history.
#[derive(Debug, Deserialize)]
pub struct SubjectQuery {
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// Only for the global feed, and ignored when a subject is named.
    pub actor: Option<String>,
    pub limit: Option<i64>,
}

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;

pub async fn list(
    State(state): State<AppState>,
    Extension(_principal): Extension<Principal>,
    Query(query): Query<SubjectQuery>,
) -> Result<Json<Vec<AuditEntry>>, AppError> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    match (query.subject_kind.as_deref(), query.subject_id.as_deref()) {
        (Some(kind), Some(id)) => Ok(Json(
            infrastructure::audit_for_subject(&state.db, kind, id, limit).await?,
        )),
        // Naming half a subject is a caller bug, and answering the global feed
        // instead would hide it behind plausible-looking data.
        (Some(_), None) | (None, Some(_)) => Err(AppError::Validation(
            "subject_kind and subject_id are named together or not at all".into(),
        )),
        (None, None) => Ok(Json(
            infrastructure::recent_audit(&state.db, query.actor.as_deref(), limit).await?,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The derivation is a heuristic, and a wrong guess is not a cosmetic
    /// problem: it files one record's history under another record's id, and
    /// the sheet then shows a history that belongs to something else. These
    /// pin the shapes this API actually serves.
    #[test]
    fn a_path_naming_a_record_is_attributed_to_it() {
        assert_eq!(
            subject_of("/api/v1/suppliers/0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8/activate"),
            Some((
                "supplier".to_owned(),
                "0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8".to_owned()
            ))
        );
        assert_eq!(
            subject_of("/api/v1/inventory/counts/0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8/submit"),
            Some((
                "count".to_owned(),
                "0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8".to_owned()
            ))
        );
    }

    /// The deepest identifier wins, because that is the record being acted on:
    /// closing a line short is an act against the line, not against the order.
    #[test]
    fn the_innermost_record_is_the_subject() {
        assert_eq!(
            subject_of(
                "/api/v1/purchase-orders/0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8/lines/9a8b7c6d-5e4f-3210-9876-543210fedcba"
            ),
            Some((
                "line".to_owned(),
                "9a8b7c6d-5e4f-3210-9876-543210fedcba".to_owned()
            ))
        );
    }

    /// An action on a collection names no record, and saying so is better than
    /// guessing: the row is still a true statement about who did what.
    #[test]
    fn a_collection_has_no_subject() {
        assert_eq!(subject_of("/api/v1/suppliers"), None);
        assert_eq!(subject_of("/api/v1/inventory/movements"), None);
    }

    /// Route words are not identifiers. `activate`, `submit` and `read-all`
    /// must never be mistaken for a record, or every action would file itself
    /// under a subject named after its own verb.
    #[test]
    fn route_words_are_not_records() {
        assert_eq!(subject_of("/api/v1/notifications/read-all"), None);
        assert_eq!(subject_of("/api/v1/sync/breaker/reset"), None);
        assert_eq!(subject_of("/api/v1/inventory/counts"), None);
    }

    /// Reads are not recorded, and that is a decision rather than an omission:
    /// this table answers "who changed this", and logging every glance would
    /// bury the changes and surveil the looking.
    #[test]
    fn only_writes_are_recorded() {
        assert!(is_write(&Method::POST));
        assert!(is_write(&Method::PATCH));
        assert!(is_write(&Method::DELETE));
        assert!(!is_write(&Method::GET));
        assert!(!is_write(&Method::HEAD));
    }
}
