//! The activity log, written for every action, and read back by the sheets.
//!
//! One middleware rather than two hundred handler calls. That trade loses
//! detail — this can say "POST /api/v1/suppliers/{id}/activate → 200" and not
//! "reactivated Anugerah Garmen" — and buys the thing that matters more on a
//! surface this wide: nothing can be forgotten. A handler that wants to say
//! something richer writes its own row on top; this one is the floor.
//!
//! # Which record a row is about
//!
//! Two answers, in that order of authority.
//!
//! The route says, through the table in [`crate::cloud::domain`]. It is
//! matched against the pattern axum matched rather than the path as it
//! arrived, which is what makes it exact rather than a guess — see that
//! module for what the guess it replaces kept getting wrong.
//!
//! The handler says, through [`DeclaredSubject`], and overrules the route.
//! This is not a courtesy: a `POST` that CREATES a record cannot name it in
//! the path, because the record did not exist when the path was written. Until
//! handlers could speak here, **no record in this system had a row saying it
//! was created** — 68 write routes filed nothing, including every creation of
//! an order, a supplier, an employee, a bill and a document. The first line of
//! a record's history was whatever somebody changed about it next.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::{record_subject_of, RecordKind, Role},
    postgres as infrastructure,
};
use axum::{
    extract::{MatchedPath, Query, Request, State},
    http::Method,
    middleware::Next,
    response::Response,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::{Arc, Mutex};

/// A handler naming the record it just acted on.
///
/// Extracted like any other `Extension`, and set at the end of the work rather
/// than the start: the id of a record being created is only known once it has
/// been created, and declaring it before the transaction commits would file a
/// row for an order that does not exist.
///
/// A shared cell rather than a return value because the middleware has already
/// let go of the request by the time it writes the row; the handler and the
/// layer above it need one thing they can both hold. Nothing is awaited while
/// the lock is held, so the plain `Mutex` is the right one.
#[derive(Clone, Default)]
pub struct DeclaredSubject(Arc<Mutex<Option<(RecordKind, String)>>>);

impl DeclaredSubject {
    /// Say what this request acted on. Last call wins, so a handler that
    /// creates two things names the one a person would go looking for.
    pub fn set(&self, kind: RecordKind, id: impl Into<String>) {
        let id = id.into();
        if id.trim().is_empty() {
            return;
        }
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some((kind, id));
        }
    }

    fn take(&self) -> Option<(RecordKind, String)> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }
}

/// The record's own id, read out of the answer a handler is about to give.
///
/// Handlers here answer `Json<Value>` far more often than a typed struct, so
/// the alternative is thirty handlers each reaching into their own JSON with
/// three lines of `get`/`as_str`/`to_owned` — thirty chances to name the key
/// wrong, and a wrong key here fails silently: the row simply loses its
/// subject again.
///
/// A number is accepted as well as a string because not every key in this
/// system is a uuid; `audit_id` and a period's year are integers, and a
/// handler that declared one would otherwise be quietly ignored.
pub fn id_in(body: &serde_json::Value, key: &str) -> Option<String> {
    match body.get(key)? {
        serde_json::Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

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

pub async fn audit_actions(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    // Handed to every request, write or read. Cheaper than the alternative it
    // replaces: a handler that asked for it on a route the middleware had
    // decided to skip would take a 500 at runtime for a line of bookkeeping.
    let declared = DeclaredSubject::default();
    request.extensions_mut().insert(declared.clone());

    let method = request.method().clone();
    if !is_write(&method) {
        return Ok(next.run(request).await);
    }
    let path = request.uri().path().to_owned();
    // The route as the router knows it, not as the caller spelled it. Absent
    // only for requests that matched no route, which never reach a handler.
    let pattern = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned());
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

    // The handler's own answer first. It knows the record; the table knows the
    // shape of the route, which is a weaker thing to know.
    let subject = declared.take().or_else(|| {
        pattern
            .as_deref()
            .and_then(|pattern| record_subject_of(pattern, &path))
    });
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

    // The broadcast used to be here, and it is deliberately gone.
    //
    // Every successful write announced itself to every active user, with a
    // body that read `POST /api/v1/finance/assets/{id}/assess`. That is not a
    // notification, it is the audit log with one copy per person: nothing is
    // being asked of the reader, nobody is waiting on them, and this estate
    // had 2,919 of them before anything ever displayed one.
    //
    // `0046_notifications.sql` predicted it and the function it called said so
    // in its own doc comment — "a notification for everything that merely
    // happened trains people to dismiss all of them". It stayed harmless
    // while nothing drew the list. It stopped being harmless the day a bell
    // went into the top bar, where it would have been the first thing every
    // person in the company saw and the reason they stopped looking.
    //
    // The action is still recorded: `record_audit` above is the row, and
    // `/system/activity` is where a log is read. `announce_activity` is kept
    // for whoever wants a narrowed version of this one day — the point of its
    // own kind was that narrowing it later is a change to one string.
    let _ = status;

    Ok(response)
}

/// The broadcast, kept and no longer called — see the comment above.
///
/// Left in place rather than deleted because the narrowing it is waiting for is
/// a real feature: "tell everyone when a price changes" is worth having, and
/// this is where it would go. What it must never go back to is announcing
/// every successful request to every person.
#[allow(dead_code)]
async fn announce(
    state: &AppState,
    principal: &Principal,
    method: &Method,
    path: &str,
    subject: Option<(RecordKind, String)>,
) -> Result<(), AppError> {
    let recipients = infrastructure::every_active_user(&state.db).await?;
    if recipients.is_empty() {
        return Ok(());
    }
    let what = subject
        .as_ref()
        .map(|(kind, id)| format!("{} {id}", kind.label()))
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

/// What the activity screen and the record sheets ask for.
///
/// A typed struct with `deny_unknown_fields`, so `?actorr=hari` is refused
/// rather than quietly answering the whole log under a filter the caller
/// believes is applied. Every parameter this route already had — `subject_kind`,
/// `subject_id`, `actor`, `limit` — is still here and still means what it did.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubjectQuery {
    pub subject_kind: Option<String>,
    pub subject_id: Option<String>,
    /// One person's actions. Still ignored for nothing: it now composes with a
    /// subject rather than being dropped when one is named, which is the
    /// narrower and more useful reading of "this person, on this record".
    pub actor: Option<String>,
    /// Free text over who acted, what they acted on and where.
    #[serde(default)]
    pub q: Option<String>,
    /// `POST`, `PATCH`, `PUT` or `DELETE`.
    #[serde(default)]
    pub method: Option<String>,
    /// `OK` or `REFUSED` — the `status >= 400` test the screen was making in
    /// the browser, over only the rows it happened to have fetched.
    #[serde(default)]
    pub outcome: Option<String>,
    /// `at`, `actor`, `path` or `status`. Anything else is `at` rather than a
    /// 400, so a stale bookmark still opens.
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` and nothing else. Absent means DESCENDING here, unlike every
    /// other list: a log is read newest-first, and opening six thousand rows at
    /// the day the system was installed is not what anybody meant.
    #[serde(default)]
    pub dir: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    #[serde(default)]
    pub cursor: Option<String>,
    pub limit: Option<i64>,
    /// `0` or `false` to skip the exact total and the facet counts.
    ///
    /// Defaults to counting. The lever exists because the counting half of this
    /// route reads the whole log while the page does not — see
    /// `AuditScope::count`, which carries the measurement. A caller paging
    /// deeply wants it off; the screen drawing the filter panel wants it on.
    ///
    /// Read as text rather than as a `bool`, because serde's `bool` accepts
    /// exactly `true` and `false` and **400s on `count=0`** — which is what
    /// anybody writes, and what the doc comment above would have told them to
    /// write. A parameter whose obvious spelling is an error is a parameter
    /// nobody can use.
    #[serde(default)]
    pub count: Option<String>,
}

/// Whether a caller asked for the counting half.
///
/// Absent is yes, because that is what every screen reading this today wants.
/// Anything unrecognised is also yes, for the reason the `sort` fallback gives:
/// this route prefers answering to refusing, and the safe direction for an
/// unreadable flag is the one that returns MORE truth rather than less.
///
/// Shared with the inventory lists rather than copied into them: four routes
/// reading `count=0` four ways is four things to learn, and the one that gets
/// it wrong 400s on the spelling everybody uses.
pub(super) fn wants_counting(raw: Option<&str>) -> bool {
    !matches!(
        raw.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("0" | "false" | "no" | "off")
    )
}

/// Who did what, newest first — the feed, and one record's history.
///
/// One handler where there were two branches, because they differed only in a
/// `WHERE` and had already drifted apart: the feed took an actor the sheet
/// could not, and the sheet was capped at a hundred lines with no way of saying
/// there were more.
///
/// It answers with an envelope — rows, a cursor, an exact total and exact facet
/// counts — in the shape `GET /finance/money` established. The exactness is
/// this route's own rule rather than a coincidence: this is an audit surface,
/// and an approximate count of who did what reads as a fact without being one.
pub async fn list(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Query(query): Query<SubjectQuery>,
) -> Result<Json<infrastructure::AuditFeed>, AppError> {
    // The activity log names every actor, every HR path and every payroll and
    // leave row it touched. That is the operator's view, not a till's: a
    // cashier holding a session must not be able to page the estate's writes.
    if principal.role != Role::Admin {
        return Err(AppError::Forbidden(format!(
            "{} may not read the global activity log",
            principal.username
        )));
    }
    // Naming half a subject is a caller bug, and answering the global feed
    // instead would hide it behind plausible-looking data.
    if query.subject_kind.is_some() != query.subject_id.is_some() {
        return Err(AppError::Validation(
            "subject_kind and subject_id are named together or not at all".into(),
        ));
    }
    Ok(Json(
        infrastructure::list_audit(
            &state.db,
            infrastructure::AuditScope {
                needle: query.q,
                actor: query.actor,
                method: query.method,
                outcome: query.outcome,
                subject_kind: query.subject_kind,
                subject_id: query.subject_id,
                sort: query.sort,
                // The one list in this system whose default direction is
                // descending, spelled here because this is the only place that
                // can tell an absent `dir` from an explicit one.
                desc: query.dir.as_deref() != Some("asc"),
                cursor: query.cursor,
                // Clamped where it is enforced, not here: one spelling of how
                // much of the log a single request may see.
                limit: query.limit,
                count: wants_counting(query.count.as_deref()),
            },
        )
        .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole route map rests on axum handing a middleware the pattern it
    /// matched. It does — but only because this layer is applied to the
    /// ROUTER, so it runs inside routing. Move it outside (wrap the service,
    /// or add it above a `fallback`) and `MatchedPath` is simply absent: no
    /// error, no warning, and every row silently loses its subject again.
    ///
    /// So the mechanism is guarded rather than assumed, with a router shaped
    /// like the real one and nothing else in it.
    #[tokio::test]
    async fn the_router_hands_the_middleware_the_pattern_it_matched() {
        use axum::{body::Body, routing::post, Router};
        use http::Request;
        use std::sync::{Arc, Mutex};
        use tower::ServiceExt;

        let seen: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let recorder = seen.clone();

        let app = Router::new()
            .route("/api/v1/suppliers/{id}/activate", post(|| async { "ok" }))
            .layer(axum::middleware::from_fn(
                move |request: Request<Body>, next: Next| {
                    let recorder = recorder.clone();
                    async move {
                        let matched = request
                            .extensions()
                            .get::<MatchedPath>()
                            .map(|matched| matched.as_str().to_owned());
                        *recorder.lock().unwrap() = matched;
                        next.run(request).await
                    }
                },
            ));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/suppliers/S-1/activate")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_success());

        assert_eq!(
            seen.lock().unwrap().as_deref(),
            Some("/api/v1/suppliers/{id}/activate"),
            "the middleware could not see which route matched, so every audit \
             row would lose its subject"
        );
    }

    /// A handler's own answer wins over the route's, because the route cannot
    /// know the id of a record that did not exist when the request began.
    #[test]
    fn a_declared_subject_is_what_the_handler_last_said() {
        let declared = DeclaredSubject::default();
        assert_eq!(declared.take(), None);

        declared.set(RecordKind::PurchaseOrder, "PO-2607-0108");
        declared.set(RecordKind::PurchaseOrder, "PO-2607-0109");
        assert_eq!(
            declared.take(),
            Some((RecordKind::PurchaseOrder, "PO-2607-0109".to_owned()))
        );
        // Taken once: the middleware writes one row.
        assert_eq!(declared.take(), None);
    }

    /// An empty id is not an identifier, and a row claiming a record with no
    /// name is worse than a row claiming none.
    #[test]
    fn an_empty_declaration_is_no_declaration() {
        let declared = DeclaredSubject::default();
        declared.set(RecordKind::Document, "   ");
        assert_eq!(declared.take(), None);
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
