//! The member's own surface, and the counter act that opens it.
//!
//! Two audiences, two prefixes, and they are not the same thing:
//!
//! * `/api/v1/members/...` is the **operator** side — enrolling a card and
//!   issuing the pairing code a cashier reads out. Ordinary node session,
//!   Cashier role, because both happen at a till.
//! * `/api/v1/member/...` is the **shopper** side. A member session and
//!   nothing else; there is no role on it and it can read exactly one member's
//!   own sales.
//!
//! The singular/plural split is load-bearing rather than stylistic: these two
//! sets of routes are reached with different credentials, and a reader who has
//! to check which is which every time will eventually get it wrong.
//!
//! The older `/api/v1/customer/{id}/...` routes stay where they are and keep
//! their operator session. They are the counter's lookup — somebody phoning up
//! about a receipt — and that is a legitimate thing for a shop to be able to
//! do. What was wrong was it being the *only* way, so that the shopper's own
//! app had to borrow an operator's authority to read the shopper's own points.

use super::auth::Principal;
use crate::cloud::{
    application::{AppError, AppState},
    domain::RecordKind,
    http::audit::DeclaredSubject,
    postgres::{
        self as infrastructure, CustomerSummary, CustomerTransactionDetail,
        CustomerTransactionPage, CustomerTransactionsQuery, IssuedPairingCode, IssuedRedeemRequest,
        MemberIdentity, MemberPrincipal, RedeemRequest, MEMBER_SESSION_TTL_DAYS,
    },
};
use crate::security;
use axum::{
    extract::{Path, Query, Request, State},
    http::{header, HeaderValue},
    middleware::Next,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Distinct from `inventory_session` on purpose. Two cookies that could be
/// confused for one another is how a shopper's proof of holding a loyalty card
/// ends up being read as an operator's authority.
pub const MEMBER_SESSION_COOKIE: &str = "member_session";
pub const MEMBER_CSRF_COOKIE: &str = "member_csrf";

const MEMBER_PREFIX: &str = "/api/v1/member/";

/// Whether operator authentication should stand aside for this path.
///
/// The member routes are not "public" in the sense of unauthenticated — all but
/// one of them require a member session, checked by [`require_member`] below.
/// They are public to `require_auth`, which knows only about operators.
pub fn is_member_path(path: &str) -> bool {
    path.starts_with(MEMBER_PREFIX)
}

/// The only member route reachable without a member session: the one that
/// creates it.
fn is_pairing(path: &str) -> bool {
    path == "/api/v1/member/session"
}

/// Resolve the member session, or refuse.
///
/// Runs on every request and returns immediately for anything that is not a
/// member path, the same shape `require_auth` uses.
pub async fn require_member(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let path = request.uri().path().to_owned();
    if !is_member_path(&path) || is_pairing(&path) {
        return Ok(next.run(request).await);
    }

    // Cookie only. The operator API also accepts a Bearer token for CLI and
    // native clients; nothing of that kind talks to this surface, and a token
    // a script can hold is a token that ends up in a phone's local storage
    // where a cross-site script can read it out.
    let token = request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| security::cookie_value(value, MEMBER_SESSION_COOKIE))
        .filter(|token| !token.is_empty())
        .ok_or_else(|| AppError::Unauthorized("missing member session".into()))?;

    let principal = infrastructure::authenticate_member_session(&state.db, &token).await?;

    // Same CSRF rule as the operator surface, and for the same reason: the
    // browser attaches this cookie to a request whether or not the page that
    // made it is ours.
    if !matches!(request.method().as_str(), "GET" | "HEAD" | "OPTIONS") {
        let header_token = request
            .headers()
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| AppError::Forbidden("missing CSRF token".into()))?;
        if !security::constant_time_eq(
            &security::sha256_hex(header_token),
            &principal.csrf_token_sha256,
        ) {
            return Err(AppError::Forbidden("invalid CSRF token".into()));
        }
    }

    request.extensions_mut().insert(principal);
    Ok(next.run(request).await)
}

// ── the counter ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct EnrolMemberRequest {
    pub member_id: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Everybody holding a card, with what they have spent joined on.
///
/// Its own read rather than a page of `/api/v1/customer/{id}/…`, because those
/// answer questions about ONE shopper whose id you already have — and until
/// this landed, the only way to find a member was to know their card number
/// already. A loyalty scheme nobody can list is a foreign key, not a scheme.
pub async fn directory(
    State(state): State<AppState>,
    Query(query): Query<infrastructure::MemberQuery>,
) -> Result<Json<infrastructure::MemberDirectory>, AppError> {
    // A saved segment narrows the list in the database, not in the browser.
    // The clauses are read from the definition here rather than accepted from
    // the query string: a caller holding clauses is holding a copy, and the
    // list would stop agreeing with the count on the card that linked to it.
    //
    // TWO placeholders are bound by `list_members` before the narrowing — the
    // search and the segment filter — and telling the compiler so is the whole
    // contract; see `compile::narrow`. It was three while the limit was bound
    // third; the limit now comes after the narrowing's own parameters, because
    // how many of those there are depends on how many clauses somebody wrote.
    let saved = match query.segment_id {
        Some(id) => {
            Some(infrastructure::segment_narrowing(&state.db, id, 2, state.clock.now()).await?)
        }
        None => None,
    };
    // The filter bar's clauses, numbered after the saved segment's. Unlike the
    // segment these ARE taken from the query string: they are what the reader
    // has on screen right now, not a copy of something stored elsewhere.
    let narrowing =
        infrastructure::directory_narrowing(saved, query.filters.as_deref(), 2, state.clock.now())?;
    Ok(Json(
        infrastructure::list_members(&state.db, query, narrowing.as_ref(), state.clock.now())
            .await?,
    ))
}

/// The six segments, counted and valued.
///
/// Derived on every read, never stored — see `postgres/membership.rs`. A
/// segment is a statement about behaviour, and behaviour changes without
/// anybody touching the member's row, so a stored one is wrong from the day
/// after it is written and wrong silently.
pub async fn segments(
    State(state): State<AppState>,
) -> Result<Json<infrastructure::SegmentBook>, AppError> {
    Ok(Json(
        infrastructure::member_segments(&state.db, state.clock.now()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct UnenrolledQuery {
    pub limit: Option<i64>,
}

/// The numbers the till wrote onto sales that belong to nobody.
///
/// A read rather than a segment, and under `/members` rather than beside the
/// six, because these people are not members: they hold no card and the scheme
/// has never heard of them. The segment book has carried a *count* of them
/// since it existed, and a count is not something anybody can act on — this is
/// the same population with names on it, which is what makes enrolling one
/// possible.
///
/// Enrolling a number from this list is not a repair anybody has to write: the
/// directory joins on `member_id = edge_sale.customer_id`, so the moment the
/// card exists its whole history is already attached to it.
pub async fn unenrolled(
    State(state): State<AppState>,
    Query(query): Query<UnenrolledQuery>,
) -> Result<Json<infrastructure::UnenrolledList>, AppError> {
    Ok(Json(
        infrastructure::list_unenrolled(&state.db, query.limit).await?,
    ))
}

/// Segments somebody wrote down, as opposed to the six that are worked out.
///
/// Under `/members/segments/saved` rather than beside it, so the URL says which
/// species is being asked for. The six above are derived and cannot be written;
/// these are written and cannot be exhaustive, and a reader who has to
/// remember which is which will eventually get it wrong.
pub async fn saved_segments(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Vec<infrastructure::SavedSegment>>, AppError> {
    Ok(Json(
        infrastructure::list_segments(&state.db, &principal.username, state.clock.now()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct SegmentRequest {
    pub name: String,
    /// Why it exists, in the author's own words. A clause list says what a
    /// segment matches and never why, and "why" is what the next person needs.
    #[serde(default)]
    pub purpose: Option<String>,
    pub definition: infrastructure::SegmentDefinition,
}

pub async fn create_segment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<SegmentRequest>,
) -> Result<(axum::http::StatusCode, Json<infrastructure::SavedSegment>), AppError> {
    let saved = infrastructure::create_segment(
        &state.db,
        infrastructure::NewSegment {
            name: &request.name,
            purpose: request.purpose.as_deref(),
            definition: &request.definition,
            owner: &principal.username,
        },
        state.clock.now(),
    )
    .await?;
    acted_on.set(RecordKind::Segment, saved.segment_id.to_string());
    Ok((axum::http::StatusCode::CREATED, Json(saved)))
}

pub async fn read_segment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<Json<infrastructure::SavedSegment>, AppError> {
    Ok(Json(
        infrastructure::read_segment(&state.db, id, &principal.username, true, state.clock.now())
            .await?,
    ))
}

/// Edit by appending a version. What a campaign was sent against still
/// resolves, which is the only way "who was in this list in March" can be
/// answered at all.
pub async fn revise_segment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<SegmentRequest>,
) -> Result<Json<infrastructure::SavedSegment>, AppError> {
    Ok(Json(
        infrastructure::revise_segment(
            &state.db,
            id,
            &principal.username,
            &request.name,
            request.purpose.as_deref(),
            &request.definition,
            state.clock.now(),
        )
        .await?,
    ))
}

pub async fn archive_segment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    infrastructure::archive_segment(&state.db, id, &principal.username).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// What a definition would match, before anybody saves it.
///
/// The same compiler and the same `FROM` the saved list uses, so the number on
/// the form is the number on the card afterwards. A preview that ran its own
/// query would be previewing a different segment.
pub async fn preview_segment(
    State(state): State<AppState>,
    Json(definition): Json<infrastructure::SegmentDefinition>,
) -> Result<Json<infrastructure::SegmentTally>, AppError> {
    Ok(Json(
        infrastructure::preview_segment(&state.db, &definition, state.clock.now()).await?,
    ))
}

/// Enrol a card at the counter.
pub async fn enrol(
    State(state): State<AppState>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<EnrolMemberRequest>,
) -> Result<Json<MemberIdentity>, AppError> {
    let member = infrastructure::enrol_member(
        &state.db,
        &request.member_id,
        request.display_name.as_deref(),
    )
    .await?;
    acted_on.set(RecordKind::Member, member.member_id.clone());
    Ok(Json(member))
}

/// Issue the six digits a cashier reads out to a shopper holding the card.
///
/// The plaintext code is in this response and nowhere else — not in the table,
/// not in a log line. If the cashier loses it before the customer types it,
/// the answer is another code, not a lookup.
pub async fn issue_code(
    State(state): State<AppState>,
    Extension(principal): Extension<super::auth::Principal>,
    Path(member_id): Path<String>,
) -> Result<Json<IssuedPairingCode>, AppError> {
    Ok(Json(
        infrastructure::issue_pairing_code(&state.db, &member_id, &principal.username).await?,
    ))
}

// ── the shopper ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PairRequest {
    pub member_id: String,
    pub code: String,
}

/// What the app is told about a successful pairing.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MemberSessionResponse {
    pub member: MemberIdentity,
    pub expires_at_epoch: i64,
}

/// Trade a card number and the cashier's code for a session.
pub async fn pair(
    State(state): State<AppState>,
    Json(request): Json<PairRequest>,
) -> Result<Response, AppError> {
    // Which node answered. Recorded on the session so "my points are being
    // read by somebody else" has an answer in the database rather than in a
    // memory.
    let issued = infrastructure::redeem_pairing_code(
        &state.db,
        &request.member_id,
        &request.code,
        Some(state.config.node_id.as_str()),
    )
    .await?;

    let max_age = MEMBER_SESSION_TTL_DAYS * 24 * 60 * 60;
    let session_cookie = security::set_cookie(
        MEMBER_SESSION_COOKIE,
        &issued.token,
        max_age,
        state.config.auth_cookie_secure,
        true,
    );
    let csrf_cookie = security::set_cookie(
        MEMBER_CSRF_COOKIE,
        &issued.csrf_token,
        max_age,
        state.config.auth_cookie_secure,
        // Readable by script: sending it back in a header is the whole
        // mechanism.
        false,
    );

    // No token in the body. The operator login returns one for CLI and native
    // callers; this surface has none of those, and a token in a JSON response
    // is a token something will decide to keep.
    let mut response = Json(MemberSessionResponse {
        member: issued.member,
        expires_at_epoch: issued.expires_at.timestamp(),
    })
    .into_response();
    no_store(&mut response);
    append_cookie(&mut response, session_cookie)?;
    append_cookie(&mut response, csrf_cookie)?;
    Ok(response)
}

pub async fn me(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
) -> Result<Json<MemberIdentity>, AppError> {
    Ok(Json(
        infrastructure::member_identity(&state.db, &principal.member_id).await?,
    ))
}

pub async fn sign_out(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
) -> Result<Response, AppError> {
    infrastructure::revoke_member_session(&state.db, principal.session_id).await?;
    let mut response = Json(serde_json::json!({ "ok": true })).into_response();
    no_store(&mut response);
    append_cookie(
        &mut response,
        security::clear_cookie(MEMBER_SESSION_COOKIE, state.config.auth_cookie_secure, true),
    )?;
    append_cookie(
        &mut response,
        security::clear_cookie(MEMBER_CSRF_COOKIE, state.config.auth_cookie_secure, false),
    )?;
    Ok(response)
}

/// The three reads, scoped by the session rather than by the URL.
///
/// Identical answers to the `/api/v1/customer/{id}/...` routes, and that is the
/// point: the queries were always scoped correctly, and what was missing was
/// any reason to believe the id in the path belonged to the person asking.
pub async fn summary(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
) -> Result<Json<CustomerSummary>, AppError> {
    Ok(Json(
        infrastructure::customer_summary(&state.db, &principal.member_id).await?,
    ))
}

pub async fn transactions(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
    Query(query): Query<CustomerTransactionsQuery>,
) -> Result<Json<CustomerTransactionPage>, AppError> {
    Ok(Json(
        infrastructure::customer_transactions(&state.db, &principal.member_id, query).await?,
    ))
}

pub async fn transaction(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
    Path(sale_id): Path<Uuid>,
) -> Result<Json<CustomerTransactionDetail>, AppError> {
    Ok(Json(
        infrastructure::customer_transaction(&state.db, &principal.member_id, sale_id).await?,
    ))
}

// ── the shopper's points ────────────────────────────────────────────────────
//
// `summary` above has always had a lifetime-earned figure
// (`CustomerSummary.points_earned_total`) — a counter, explicitly not a
// balance. What a shopper never had was the actual balance a redemption
// spends against, because the balance lives behind `points_account`, an
// operator-only read scoped by an id in the URL. This wraps the same query,
// scoped by the session instead — identical to how `summary` and
// `transactions` already relate to their `/customer/{id}/...` equivalents.

pub async fn points(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::points_account(&state.db, &principal.member_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct CreateRedeemRequest {
    pub points: i64,
}

/// Ask to turn points into a voucher. The code in the response is shown once,
/// large, with a countdown — a shopper reads it to a cashier the same way a
/// cashier reads a pairing code to them, just the two roles swapped.
pub async fn create_redeem_request(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
    Json(request): Json<CreateRedeemRequest>,
) -> Result<Json<IssuedRedeemRequest>, AppError> {
    Ok(Json(
        infrastructure::create_redeem_request(&state.db, &principal.member_id, request.points)
            .await?,
    ))
}

/// A shopper's own redemption requests, newest first — what was asked for and
/// what became of it.
pub async fn redeem_requests(
    State(state): State<AppState>,
    Extension(principal): Extension<MemberPrincipal>,
) -> Result<Json<Vec<RedeemRequest>>, AppError> {
    Ok(Json(
        infrastructure::list_redeem_requests(&state.db, &principal.member_id).await?,
    ))
}

fn no_store(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, private"),
    );
}

fn append_cookie(response: &mut Response, cookie: String) -> Result<(), AppError> {
    let value = HeaderValue::from_str(&cookie)
        .map_err(|_| AppError::Configuration("could not format the session cookie".into()))?;
    response.headers_mut().append(header::SET_COOKIE, value);
    Ok(())
}
