//! Revocable opaque-session authentication and the /api/v1/auth/* handlers.
//!
//! Design constraints this module owns:
//! - Verification is fully local to this node's user/session tables.
//! - Authentication is required by default. Explicit
//!   INVENTORY_AUTH_MODE=disabled is development-only and is reported by the
//!   health endpoint plus a boot warning.
//! - `actor_id` in any request body must match the authenticated principal:
//!   the audit trail is only worth keeping when nobody can write someone
//!   else's name into it.

use crate::cloud::{
    application::{
        AppError, AppState, ChangePasswordRequest, CreateUserRequest, RegisterRfidDeviceBody,
        ResetPasswordRequest, SetEdgeAssignmentActiveRequest, SetRfidDeviceActiveRequest,
        SetRfidDeviceKindRequest, SetUserActiveRequest, SetUserRoleRequest,
        UpsertEdgeAssignmentRequest,
    },
    domain::{
        flow::Actor,
        job_role::{self, JobGrant},
        relay, required_role, role_allows, RecordKind, Role, UnitId,
    },
    http::audit::{id_in, DeclaredSubject},
    postgres as infrastructure,
};
use crate::contract::{CloudMe, LoginRequest, LoginResponse, SessionUser};
use crate::security::{self, CSRF_COOKIE, SESSION_COOKIE};
use axum::{
    body::{to_bytes, Body},
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue},
    middleware::Next,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

const EDGE_SSO_TICKET_TTL_SECONDS: i64 = 60;

/// Request bodies are already capped by the router's `DefaultBodyLimit`; this
/// is the middleware's own ceiling when buffering a body to check actor_id.
const MAX_BUFFERED_BODY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Principal {
    pub session_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    /// The caller's job role (0633): the flow roles and hub sections it
    /// holds. Read with the session on every request, never carried in it.
    pub job: JobGrant,
    pub authenticated_with_cookie: bool,
    /// The node this call was relayed through, for a call a store node carried
    /// up on its signed-in manager's behalf. `None` for every session of the
    /// cloud's own.
    ///
    /// Not a place stamped into a session — the thing `Reach`'s module doc
    /// refuses. A session outlives a transfer; this lives exactly one request,
    /// and it names where the *node* is, which the node's key proves on every
    /// call, not where the person is posted.
    pub relayed: Option<RelayBinding>,
}

/// Where a relayed call came from: the node that proved it with its key, the
/// site that node is registered for, and the unit that site belongs to.
#[derive(Clone, Debug)]
pub struct RelayBinding {
    pub origin_id: String,
    pub site_id: String,
    /// `site.kind` — `STORE` or `DC` — for a row whose coverage names a kind
    /// of site rather than a site.
    pub site_kind: String,
    pub unit_id: UnitId,
}

impl Principal {
    /// The caller as the flow engine judges them: by the flow roles their job
    /// role holds (0633), not by their rung.
    pub fn flow_actor(&self) -> Actor {
        Actor {
            id: self.username.clone(),
            rung: self.role,
            flow_roles: Some(self.job.flow_roles_held()),
        }
    }

    /// The unit a relayed call may reach, and no other; `None` when unbound.
    pub fn bound_unit(&self) -> Option<&UnitId> {
        self.relayed.as_ref().map(|binding| &binding.unit_id)
    }

    /// The site a relayed call may reach, and no other; `None` when unbound.
    pub fn bound_site(&self) -> Option<&str> {
        self.relayed
            .as_ref()
            .map(|binding| binding.site_id.as_str())
    }

    /// The `site` filter a list may run with.
    ///
    /// Unbound, whatever was asked. Bound, the node's own site and nothing
    /// else: asking for nothing is answered with it (a shop's screen asking
    /// for "the register" means its own), and asking for any other site — or
    /// for its own and another's — is refused in a sentence rather than
    /// quietly narrowed, so a screen that believed it was reading two shops
    /// learns that it is not.
    ///
    /// For readers whose rows carry a site but that resolve no `Reach` — GA's.
    /// HR's readers are bounded by `Reach::bounded_to` instead, in one place.
    pub fn site_filter(&self, asked: Vec<String>) -> Result<Vec<String>, AppError> {
        let Some(bound) = self.bound_site() else {
            return Ok(asked);
        };
        match asked.iter().find(|site| site.as_str() != bound) {
            Some(other) => Err(AppError::Forbidden(format!(
                "this till speaks for {bound}; it cannot read {other}"
            ))),
            None => Ok(vec![bound.to_owned()]),
        }
    }

    /// Refuse a relayed call touching a row that is not at the node's site.
    ///
    /// `None` is a row at no one site, and is refused too: a shop's till reads
    /// and writes what is *its*. A row that may instead cover many sites — a
    /// contract — asks [`Principal::may_touch_coverage`].
    pub fn may_touch_site(&self, site: Option<&str>, what: &str) -> Result<(), AppError> {
        match self.bound_site() {
            None => Ok(()),
            Some(bound) if site == Some(bound) => Ok(()),
            Some(bound) => Err(AppError::Forbidden(format!(
                "this till speaks for {bound}; that {what} is not {bound}'s"
            ))),
        }
    }

    /// Refuse a relayed call touching a row that neither sits at the node's
    /// site nor covers it.
    ///
    /// GA's contracts name one site or a coverage (`ga_contract.site_scope`):
    /// `ALL_SITES` covers every place, `ALL_STORES` every store and never head
    /// office — the rule `ga_locations` already applies when it lists a
    /// place's contracts, so a till reads by id exactly the contracts its own
    /// place's page shows it.
    pub fn may_touch_coverage(
        &self,
        site: Option<&str>,
        coverage: Option<&str>,
        what: &str,
    ) -> Result<(), AppError> {
        let Some(binding) = self.relayed.as_ref() else {
            return Ok(());
        };
        let covered = match (site, coverage) {
            (Some(site), _) => site == binding.site_id,
            (None, Some("ALL_SITES")) => true,
            (None, Some("ALL_STORES")) => binding.site_kind == "STORE",
            (None, _) => false,
        };
        if covered {
            return Ok(());
        }
        Err(AppError::Forbidden(format!(
            "this till speaks for {bound}; that {what} does not cover {bound}",
            bound = binding.site_id
        )))
    }
}

/// Paths that must stay reachable without a token: liveness, login itself,
/// the machine-to-machine sync ingest (guarded by x-sync-key), and metrics
/// scraping.
///
/// The member surface is here too, and is the one entry that is not actually
/// unauthenticated: `/api/v1/member/...` is guarded by `member::require_member`,
/// which runs before this middleware and resolves a member session. It is
/// exempt here because a shopper has no node account and never will — see
/// `http/member.rs`.
fn is_public(path: &str) -> bool {
    if super::member::is_member_path(path) {
        return true;
    }
    // The three voucher-relay routes a till reaches through its own node
    // (`/api/v1/sync/vouchers/{code}/(authorize|commit|release)`). A counter
    // cannot hold a bearer card against a session it does not have — these are
    // answered by a node proving which shop it is, guarded per-origin by
    // `x-sync-key` inside the handler (`http::relay_site`), exactly like
    // `/sync/ingest`. The session gate has no business asking a drawer for a
    // login.
    if path.starts_with("/api/v1/sync/vouchers/") {
        return true;
    }
    // A limited coupon's hold, relayed the same way by the same node and for the
    // same reason (`/api/v1/sync/coupons/{code}/(authorize|release)`): proven
    // per origin by `x-sync-key` inside the handler.
    if path.starts_with("/api/v1/sync/coupons/") {
        return true;
    }
    // The warehouse's print bridge (`cloud::dc::print_bridge`): a machine in
    // the Gudang with no account, answering to PRINT_BRIDGE_KEY inside the
    // handler.
    if path.starts_with("/api/v1/dc/print-bridge/") {
        return true;
    }
    // The benefit-balance relay (0818), same shape and same reason as the
    // voucher trio: a node proving which shop it is, guarded per origin by
    // `x-sync-key` inside the handler.
    if path.starts_with("/api/v1/sync/benefit/") {
        return true;
    }
    // Finance's expense code (0822), used by a shop's node: same shape, same
    // per-origin `x-sync-key` check inside the handler.
    if path.starts_with("/api/v1/sync/expense-codes/") {
        return true;
    }
    // The points-redemption relay a till reaches through its own node, same
    // shape and same reason as the voucher trio just above: a cashier's
    // counter has no session to hold a member's points against, only a node
    // proving which shop it is — guarded per-origin by `x-sync-key` inside the
    // handler, exactly like `/sync/vouchers/`.
    if path.starts_with("/api/v1/sync/points/redeem-requests") {
        return true;
    }
    // Opening a join link and accepting it (0634). The person has no account
    // yet — that is what the link is for. The token is the credential,
    // checked in the handler (`http::invitations`), which also answers an
    // unknown token the same way whatever it looks like.
    if path.starts_with("/api/v1/invitations/accept/") {
        return true;
    }
    // The page a Surat Jalan Retur's QR opens (0962): read-only, for whoever
    // holds the paper. The token is the credential, looked up in the handler
    // (`http::return_notes`); there is no listing, and an unknown token is a
    // plain 404. Making the link (`POST /api/v1/return-notes`) is NOT here: it
    // is a signed-in person's.
    if path.starts_with("/api/v1/public/return-notes/") {
        return true;
    }
    matches!(
        path,
        "/api/v1/health"
            | "/api/v1/auth/login"
            | "/api/v1/sync/ingest"
            | "/api/v1/sync/handshake"
            // A machine enrolling has no session and no registered key yet:
            // the claim is authorised by its one-time code, the status by the
            // key whose digest the claim carried. Both checked in the handler
            // (`http::enrolment`). Exact paths, so the Admin routes under
            // `/sync/enrollments` stay behind the gate.
            | "/api/v1/sync/enroll/claim"
            // A shop server's heartbeat: proven by its own `x-sync-key` in
            // the handler (`http::fleet`), like `/sync/ingest`.
            | "/api/v1/sync/heartbeat"
            | "/api/v1/sync/diagnostics"
            | "/api/v1/sync/enroll/status"
            // The two routes a unit's attendance station reaches, both guarded
            // by the same per-origin `x-sync-key` as `/sync/ingest` and both
            // re-checking it in the handler (`http::terminal::node_unit`).
            //
            // Outside the session space **on purpose**, and it is the
            // enforcement of a decision rather than a convenience. The path
            // gate below makes every `GET` a Cashier read, so a template route
            // inside this space would be readable by every till in the
            // company; and a punch is authorized by a registered device rather
            // than by anybody's rung, so a session could only ever be the
            // wrong credential for it. No session reaches either, which is why
            // no session can ask for a fingerprint template.
            | "/api/v1/attendance/terminal-sync"
            | "/api/v1/attendance/punches"
            | "/metrics"
    )
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    // A call a store node relays for its signed-in manager is answered before
    // anything else, and in particular before the development shortcut below:
    // a relayed call is bound to the node's own place, and a cloud that has
    // switched its own sessions off has not thereby made every shop head
    // office. See `relayed_principal`.
    if is_relayed(request.headers()) {
        let method = request.method().as_str().to_owned();
        let path = request.uri().path().to_owned();
        let principal = relayed_principal(&state, &method, &path, request.headers()).await?;
        gate_role_with(
            &method,
            &path,
            principal.role,
            &permission_overrides(&state).await,
        )?;
        // No CSRF check: there is no cookie here to ride, only the node's key.
        let request = with_principal(request, principal).await?;
        return Ok(next.run(request).await);
    }
    if state.config.jwt_secret.is_none() {
        // Auth disabled is development-only, but handlers must still receive a
        // truthful server-owned actor rather than accepting actor_id from a
        // request body.
        request.extensions_mut().insert(Principal {
            session_id: Uuid::nil(),
            username: "development".to_owned(),
            display_name: "Development".to_owned(),
            role: Role::Admin,
            job: JobGrant::everything(),
            authenticated_with_cookie: false,
            relayed: None,
        });
        return Ok(next.run(request).await);
    }
    let path = request.uri().path().to_owned();
    if !path.starts_with("/api/") || is_public(&path) {
        return Ok(next.run(request).await);
    }

    let bearer = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| security::cookie_value(value, SESSION_COOKIE));
    let (token, authenticated_with_cookie) = match (bearer, cookie) {
        (Some(token), _) if !token.is_empty() => (token.to_string(), false),
        (_, Some(token)) if !token.is_empty() => (token, true),
        _ => return Err(AppError::Unauthorized("missing session".into())),
    };
    let session = infrastructure::authenticate_session(
        &state.db,
        &token,
        state.config.auth_session_idle_minutes,
    )
    .await?;
    let method = request.method().as_str().to_owned();
    // A delegation running today (0812) lends its delegator's rung and job —
    // only on the paths that decide leave, claims and corrections, and only
    // when it is higher than the caller's own. Everything else is the
    // caller's own authority, as it always was.
    let (role, job) = if super::delegation::is_delegable(&method, &path) {
        match infrastructure::delegated_authority(&state.db, &session.username).await? {
            Some((lent, lent_job)) if lent > session.role => (lent, lent_job),
            _ => (session.role, session.job),
        }
    } else {
        (session.role, session.job)
    };

    gate_role_with(&method, &path, role, &permission_overrides(&state).await)?;
    // The second question, after the rung: does this person's job include
    // the part of the hub the path belongs to (0633)?
    job_role::section_gate(&method, &path, &job).map_err(AppError::Forbidden)?;

    if authenticated_with_cookie && !matches!(request.method().as_str(), "GET" | "HEAD" | "OPTIONS")
    {
        let header_token = request
            .headers()
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| AppError::Forbidden("missing CSRF token".into()))?;
        let cookie_token = request
            .headers()
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| security::cookie_value(value, CSRF_COOKIE))
            .ok_or_else(|| AppError::Forbidden("missing CSRF cookie".into()))?;
        if !security::constant_time_eq(header_token, &cookie_token)
            || !security::constant_time_eq(
                &security::sha256_hex(header_token),
                &session.csrf_token_sha256,
            )
        {
            return Err(AppError::Forbidden("invalid CSRF token".into()));
        }
    }

    let principal = Principal {
        session_id: session.session_id,
        username: session.username,
        display_name: session.display_name,
        role,
        job,
        authenticated_with_cookie,
        relayed: None,
    };

    let request = with_principal(request, principal).await?;
    Ok(next.run(request).await)
}

/// The role overrides Finance set (0472), read through a short cache so the
/// gate does not query on every request. A change clears it.
static PERMISSION_CACHE: std::sync::RwLock<
    Option<(std::time::Instant, Vec<(String, String, Role)>)>,
> = std::sync::RwLock::new(None);

pub fn forget_permission_overrides() {
    if let Ok(mut cache) = PERMISSION_CACHE.write() {
        *cache = None;
    }
}

async fn permission_overrides(state: &AppState) -> Vec<(String, String, Role)> {
    if let Ok(cache) = PERMISSION_CACHE.read() {
        if let Some((at, rows)) = cache.as_ref() {
            if at.elapsed() < std::time::Duration::from_secs(30) {
                return rows.clone();
            }
        }
    }
    let rows: Vec<(String, String, Role)> = infrastructure::role_permissions(&state.db)
        .await
        .map(|rows| {
            rows.into_iter()
                .filter_map(|row| {
                    row.min_role
                        .parse::<Role>()
                        .ok()
                        .map(|role| (row.method, row.path_prefix, role))
                })
                .collect()
        })
        .unwrap_or_default();
    if let Ok(mut cache) = PERMISSION_CACHE.write() {
        *cache = Some((std::time::Instant::now(), rows.clone()));
    }
    rows
}

/// The rung a method and path need: the most specific override Finance set,
/// an exact method before `*`, else the code's default.
fn needed_role(method: &str, path: &str, overrides: &[(String, String, Role)]) -> Role {
    overrides
        .iter()
        .filter(|(m, prefix, _)| {
            (m == "*" || m.eq_ignore_ascii_case(method)) && path.starts_with(prefix.as_str())
        })
        .max_by_key(|(m, prefix, _)| (prefix.len(), m != "*"))
        .map(|(_, _, role)| *role)
        .unwrap_or_else(|| required_role(method, path))
}

/// The path gate: the rung a method and path need, against the rung held.
fn gate_role_with(
    method: &str,
    path: &str,
    role: Role,
    overrides: &[(String, String, Role)],
) -> Result<(), AppError> {
    let needed = needed_role(method, path, overrides);
    if !role_allows(needed, role) {
        return Err(AppError::Forbidden(format!(
            "this action requires the {needed} role"
        )));
    }
    Ok(())
}

/// Would the path gate let this rung through? For a screen that has to say
/// "not yours" before somebody acts rather than after, by the same rule the
/// gate applies — Finance's overrides included.
pub async fn gate_allows(state: &AppState, method: &str, path: &str, role: Role) -> bool {
    role_allows(
        needed_role(method, path, &permission_overrides(state).await),
        role,
    )
}

/// Attach the principal, after holding any `actor_id` in the body to it.
///
/// Enforce a truthful audit trail: a JSON body carrying actor_id must name
/// the authenticated principal. The body is buffered and re-attached
/// unchanged so idempotency digests still cover the exact bytes sent.
async fn with_principal(request: Request, principal: Principal) -> Result<Request, AppError> {
    let method = request.method().as_str().to_owned();
    let request = if method != "GET" && method != "HEAD" {
        let (parts, body) = request.into_parts();
        let bytes = to_bytes(body, MAX_BUFFERED_BODY_BYTES)
            .await
            .map_err(|_| AppError::Validation("request body too large".into()))?;
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(actor) = value.get("actor_id").and_then(Value::as_str) {
                if actor != principal.username {
                    return Err(AppError::Forbidden(format!(
                        "actor_id '{actor}' must match the authenticated user '{}'",
                        principal.username
                    )));
                }
            }
        }
        let mut request = Request::from_parts(parts, Body::from(bytes));
        request.extensions_mut().insert(principal);
        request
    } else {
        let mut request = request;
        request.extensions_mut().insert(principal);
        request
    };
    Ok(request)
}

/// Does this request say it was relayed by a node?
///
/// Either relay header is enough to be treated as one — and so to be held to
/// everything a relayed call is held to. A request carrying only half the
/// relay is refused as a relay, never quietly answered as a session.
fn is_relayed(headers: &HeaderMap) -> bool {
    headers.contains_key(relay::RELAY_ORIGIN_HEADER)
        || headers.contains_key(relay::RELAY_USER_HEADER)
}

/// The principal a store node's relayed call acts as — or the reason it acts
/// as nobody.
///
/// # The chain, and what each link proves
///
/// 1. **The path is on the relay list** (`domain::relay`). Checked first and
///    without the database: a relay is a narrow door, and a request for a room
///    it does not open onto is refused before anybody is looked up.
/// 2. **The node is who it says.** `x-relay-origin` is proved against that
///    origin's own `x-sync-key` by the same `authenticate_origin` the ingest,
///    the voucher relay and the punch station use — one spelling of "is this
///    really store-07". An authenticated cloud refuses an unregistered origin;
///    development keeps the master-key fallback, and the next link still binds
///    the call to a place, so it is bounded there too.
/// 3. **The node is somewhere.** Its registered site must belong to a unit
///    (`unit_of_origin`). A node bound to no unit has nowhere its manager
///    could be managing, and is refused rather than left unbounded.
/// 4. **The person may sign in there, now.** `x-relay-user` names an active
///    login with an active assignment at this origin (`relay_subject`). The
///    node cannot prove who stands at its till — only its own sign-in can —
///    so this is the node's word, believed exactly as far as the cloud's own
///    register allows, and never further than the node's own place.
///
/// The principal then carries the person's real name, so `actor_id` checks
/// and every audit row name them and not the node; the LOWER of their cloud
/// rung and their rung at this node, so a head-office login at a till is that
/// till's supervisor; and the node's binding, which `reach_from` and the GA
/// guards turn into a bound on every read and write.
async fn relayed_principal(
    state: &AppState,
    method: &str,
    path: &str,
    headers: &HeaderMap,
) -> Result<Principal, AppError> {
    if !relay::is_relayable(method, path) {
        return Err(AppError::Forbidden(format!(
            "{method} {path} is not something a store node may relay"
        )));
    }
    let origin_id = headers
        .get(relay::RELAY_ORIGIN_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| AppError::Unauthorized("a relayed call must name its node".into()))?;
    let user_id = headers
        .get(relay::RELAY_USER_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
        .ok_or_else(|| {
            AppError::Unauthorized("a relayed call must name the person it is for".into())
        })?;
    let origin = super::authenticate_origin(state, headers, origin_id).await?;
    let unit_id = infrastructure::unit_of_origin(&state.db, &origin.origin_id)
        .await?
        .ok_or_else(|| {
            AppError::Forbidden(format!(
                "{} is not bound to a unit, so there is nowhere its relay could reach",
                origin.origin_id
            ))
        })?;
    // `unit_of_origin` found a unit through the origin's site, so the site
    // `authenticate_origin` read is there; the refusal is for a register that
    // changed between the two reads.
    let site_id = origin.site_id.ok_or_else(|| {
        AppError::Forbidden(format!("{} is not bound to a site", origin.origin_id))
    })?;
    let site_kind = infrastructure::relay_site_kind(&state.db, &site_id).await?;
    let subject = infrastructure::relay_subject(&state.db, &origin.origin_id, user_id).await?;
    Ok(Principal {
        // A relayed call has no session of its own at the cloud: nothing to
        // revoke, nothing to sign out of — the node's own sign-in is the one.
        session_id: Uuid::nil(),
        username: subject.username,
        display_name: subject.display_name,
        role: relay::relayed_role(subject.role, subject.edge_role),
        // Not gated by section: a relayed call is the store app's, through
        // the relay's own allowlist, not the hub's (`domain::job_role`).
        job: subject.job,
        authenticated_with_cookie: false,
        relayed: Some(RelayBinding {
            origin_id: origin.origin_id,
            site_id,
            site_kind,
            unit_id,
        }),
    })
}

/// `me`, for any principal. Also what accepting an invitation answers.
pub fn cloud_me(username: String, display_name: String, role: Role, job: &JobGrant) -> CloudMe {
    CloudMe {
        username,
        display_name,
        role: role.into(),
        role_code: job.code.clone(),
        role_name: job.name.clone(),
        sections: job.sections_held(),
        read_only: job.read_only,
    }
}

/// Set a fresh session's two cookies on a response, exactly as signing in
/// does — shared with accepting an invitation, which signs the person in.
pub fn with_session_cookies(
    state: &AppState,
    mut response: Response,
    issued: &infrastructure::IssuedSession,
) -> Result<Response, AppError> {
    let max_age = state.config.auth_token_ttl_minutes.max(1) * 60;
    let session_cookie = security::set_cookie(
        SESSION_COOKIE,
        &issued.token,
        max_age,
        state.config.auth_cookie_secure,
        true,
    );
    let csrf_cookie = security::set_cookie(
        CSRF_COOKIE,
        &issued.csrf_token,
        max_age,
        state.config.auth_cookie_secure,
        false,
    );
    prevent_auth_caching(&mut response);
    append_cookie(&mut response, session_cookie)?;
    append_cookie(&mut response, csrf_cookie)?;
    Ok(response)
}

pub async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, AppError> {
    if state.config.jwt_secret.is_none() {
        return Err(AppError::Conflict(
            "authentication is not enabled on this node".into(),
        ));
    }
    let user =
        infrastructure::authenticate_user(&state.db, &request.username, &request.password).await?;
    let issued =
        infrastructure::create_session(&state.db, &user, state.config.auth_token_ttl_minutes)
            .await?;
    let max_age = state.config.auth_token_ttl_minutes.max(1) * 60;
    // Both cookies are formatted before the body takes ownership of the token.
    let session_cookie = security::set_cookie(
        SESSION_COOKIE,
        &issued.token,
        max_age,
        state.config.auth_cookie_secure,
        true,
    );
    let csrf_cookie = security::set_cookie(
        CSRF_COOKIE,
        &issued.csrf_token,
        max_age,
        state.config.auth_cookie_secure,
        false,
    );
    let mut response = Json(LoginResponse {
        // Native/CLI clients may use the same opaque value as a Bearer token.
        // The browser ignores it and relies on the HttpOnly cookie below.
        token: issued.token,
        token_type: "Bearer".to_owned(),
        expires_at_epoch: issued.expires_at.timestamp(),
        user: SessionUser {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            role: user.role.into(),
            // Cloud has one identity store, so there is nothing to name.
            source: None,
            // What `me` answers, so the hub needs no second call to draw
            // its menu (`cloud_me`).
            role_code: Some(user.job.code.clone()),
            role_name: Some(user.job.name.clone()),
            sections: Some(user.job.sections_held()),
            read_only: Some(user.job.read_only),
        },
    })
    .into_response();
    prevent_auth_caching(&mut response);
    append_cookie(&mut response, session_cookie)?;
    append_cookie(&mut response, csrf_cookie)?;
    Ok(response)
}

pub async fn me(Extension(principal): Extension<Principal>) -> Json<CloudMe> {
    let job = principal.job.clone();
    Json(cloud_me(
        principal.username,
        principal.display_name,
        principal.role,
        &job,
    ))
}

#[derive(serde::Deserialize)]
pub struct EdgeSsoTicketRequest {
    pub origin_id: String,
}

/// Issue a destination-bound one-time ticket for the signed-in Cloud user.
///
/// This route is deliberately not public: Cloud's session middleware
/// authenticates it and requires the normal CSRF echo for this POST. The
/// short-lived ticket is returned with no-store headers and is meant to be
/// posted directly to the selected DC, never placed in a URL or browser
/// storage.
pub async fn edge_sso_ticket(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<EdgeSsoTicketRequest>,
) -> Result<Response, AppError> {
    let origin_id = request.origin_id.trim();
    if origin_id.is_empty() || origin_id.len() > 128 {
        return Err(AppError::Validation("invalid DC origin_id".into()));
    }
    let user_id =
        infrastructure::edge_sso_subject(&state.db, origin_id, &principal.username).await?;
    let seed = crate::security::sso::signing_seed_from_env()
        .map_err(AppError::Configuration)?
        .ok_or_else(|| {
            AppError::Configuration(
                "Cloud-to-DC sign-in is not configured; set INVENTORY_SSO_SIGNING_KEY_HEX".into(),
            )
        })?;
    let issued_at = chrono::Utc::now().timestamp();
    let claims = crate::security::sso::TicketClaims {
        sub: user_id.to_string(),
        aud: origin_id.to_owned(),
        origin_id: origin_id.to_owned(),
        iat: issued_at,
        exp: issued_at + EDGE_SSO_TICKET_TTL_SECONDS,
        jti: Uuid::new_v4().to_string(),
    };
    let ticket =
        crate::security::sso::issue_ticket(&claims, &seed).map_err(AppError::Configuration)?;
    let mut response = Json(json!({ "ticket": ticket })).into_response();
    prevent_auth_caching(&mut response);
    Ok(response)
}

pub async fn logout(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
) -> Result<Response, AppError> {
    infrastructure::revoke_session_id(&state.db, principal.session_id).await?;
    cleared_session_response(&state, json!({"signed_out":true}))
}

pub async fn change_password(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<Response, AppError> {
    let value = infrastructure::change_password(&state.db, &principal.username, request).await?;
    cleared_session_response(&state, value)
}

/// Administrator-only: set a password for a user who cannot supply their old
/// one. Reachable only by an Admin — `required_role` puts every
/// `/api/v1/auth/users` path behind that role.
pub async fn reset_password(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::admin_reset_password(&state.db, id, request, &principal.username).await?,
    ))
}

/// Administrator-only: promote or demote somebody at Cloud. Does not touch
/// their role at any Edge — that lives on the Edge assignment.
pub async fn set_user_role(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(id): Path<Uuid>,
    Json(request): Json<SetUserRoleRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_user_role(&state.db, id, request, &principal.username).await?,
    ))
}

/// Every login, as an envelope rather than a bare `{items}`.
///
/// Exact counts: this answers "who can sign in", and a rough count of that
/// reads as a fact without being one.
pub async fn list_users(
    State(state): State<AppState>,
    Query(scope): Query<infrastructure::UserScope>,
) -> Result<Json<infrastructure::UserList>, AppError> {
    Ok(Json(infrastructure::list_users(&state.db, scope).await?))
}

pub async fn create_user(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<CreateUserRequest>,
) -> Result<Json<Value>, AppError> {
    let body = infrastructure::create_user(&state.db, request, &principal.username).await?;
    if let Some(user_id) = id_in(&body, "id") {
        acted_on.set(RecordKind::AppUser, user_id);
    }
    Ok(Json(body))
}

pub async fn set_user_active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(user_id): Path<Uuid>,
    Json(request): Json<SetUserActiveRequest>,
) -> Result<Json<Value>, AppError> {
    let user =
        infrastructure::set_user_active(&state.db, user_id, request.active, &principal.username)
            .await?;
    let policies =
        infrastructure::publish_auth_policies_for_user(&state.db, user_id, &principal.username)
            .await?;
    Ok(Json(json!({"user":user,"policies":policies})))
}

/// Lift a wrong-password lockout now, rather than waiting it out.
pub async fn unlock_user(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(infrastructure::unlock_user(&state.db, user_id).await?))
}

/// Who may sign in at which node — an envelope rather than a bare `{items}`.
///
/// An access surface, so `total` and every facet count is an exact `COUNT(*)`.
pub async fn edge_assignments(
    State(state): State<AppState>,
    Query(scope): Query<infrastructure::EdgeAssignmentScope>,
) -> Result<Json<infrastructure::EdgeAssignmentList>, AppError> {
    Ok(Json(
        infrastructure::list_edge_assignments(&state.db, scope).await?,
    ))
}

pub async fn upsert_edge_assignment(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Json(request): Json<UpsertEdgeAssignmentRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::upsert_edge_assignment(&state.db, request, &principal.username).await?,
    ))
}

pub async fn set_edge_assignment_active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path((origin_id, user_id)): Path<(String, Uuid)>,
    Json(request): Json<SetEdgeAssignmentActiveRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_edge_assignment_active(
            &state.db,
            &origin_id,
            user_id,
            request,
            &principal.username,
        )
        .await?,
    ))
}

/// The readers, as an envelope rather than a bare `{items}`. Exact counts, for
/// the same reason the assignment list has them.
pub async fn rfid_devices(
    State(state): State<AppState>,
    Query(scope): Query<infrastructure::RfidDeviceScope>,
) -> Result<Json<infrastructure::RfidDeviceList>, AppError> {
    Ok(Json(
        infrastructure::list_rfid_devices(&state.db, scope).await?,
    ))
}

pub async fn register_rfid_device(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Extension(acted_on): Extension<DeclaredSubject>,
    Json(request): Json<RegisterRfidDeviceBody>,
) -> Result<Json<Value>, AppError> {
    let body = infrastructure::register_rfid_device_as(
        &state.db,
        request.device,
        request.kind.as_deref(),
        &principal.username,
    )
    .await?;
    if let Some(device_id) = id_in(&body, "device_id") {
        acted_on.set(RecordKind::RfidDevice, device_id);
    }
    Ok(Json(body))
}

pub async fn set_rfid_device_active(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(device_id): Path<String>,
    Json(request): Json<SetRfidDeviceActiveRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_rfid_device_active(&state.db, &device_id, request, &principal.username)
            .await?,
    ))
}

/// Handheld or fixed. Filed against the reader by its path, like `active`.
pub async fn set_rfid_device_kind(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(device_id): Path<String>,
    Json(request): Json<SetRfidDeviceKindRequest>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::set_rfid_device_kind(&state.db, &device_id, request, &principal.username)
            .await?,
    ))
}

pub async fn rotate_rfid_device_key(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(device_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::rotate_rfid_device_key(&state.db, &device_id, &principal.username).await?,
    ))
}

pub async fn publish_edge_policy(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>,
    Path(origin_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        infrastructure::publish_auth_policy(&state.db, &origin_id, &principal.username).await?,
    ))
}

fn append_cookie(response: &mut Response, cookie: String) -> Result<(), AppError> {
    let value = HeaderValue::from_str(&cookie)
        .map_err(|error| AppError::Configuration(format!("invalid auth cookie: {error}")))?;
    response.headers_mut().append(header::SET_COOKIE, value);
    Ok(())
}

fn prevent_auth_caching(response: &mut Response) {
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
        .headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
}

fn cleared_session_response(state: &AppState, value: Value) -> Result<Response, AppError> {
    let mut response = Json(value).into_response();
    prevent_auth_caching(&mut response);
    append_cookie(
        &mut response,
        security::clear_cookie(SESSION_COOKIE, state.config.auth_cookie_secure, true),
    )?;
    append_cookie(
        &mut response,
        security::clear_cookie(CSRF_COOKIE, state.config.auth_cookie_secure, false),
    )?;
    Ok(response)
}
