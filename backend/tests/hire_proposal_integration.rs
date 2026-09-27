//! *Karyawan baru*, over HTTP: a shop asks for an employee, head office
//! answers, and the answer turns into an employment record.
//!
//! Three tests carry the file.
//!
//! **The whole chain**, because the interesting part is not any one step but
//! that the shop's request survives being sent back: version 1 is returned,
//! version 2 is filed and approved, and the returned version and the reason it
//! was returned are still readable afterwards. A revision that overwrote the
//! terms would pass a test of every individual route and lose the only thing
//! worth keeping.
//!
//! **The proposer does not decide their own proposal, at head office too.** A
//! rung cannot express that rule — HR holds the deciding key and may also file
//! a request — so it is checked over HTTP with two Admin logins, which is the
//! shape the owner was actually worried about.
//!
//! **Approval is not employment.** The record opened against an approved
//! proposal is a `CANDIDATE` with a posting and no personal data: no NIK, no
//! address, and nothing that says anybody has started work.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-hire-1";
const SECOND_HR_PASSWORD: &str = "hr-password-hire-1";
const SUPERVISOR_PASSWORD: &str = "supervisor-password-hire-1";
const CASHIER_PASSWORD: &str = "cashier-password-hire-1";

struct Response {
    status: StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send(
    app: axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(String, String)>,
    body: Option<Value>,
) -> Response {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    let response = app
        .oneshot(
            builder
                .body(body.map_or_else(Body::empty, |value| {
                    Body::from(
                        serde_json::to_vec(&value)
                            .unwrap_or_else(|error| panic!("encode body: {error}")),
                    )
                }))
                .unwrap_or_else(|error| panic!("build {method} {path}: {error}")),
        )
        .await
        .unwrap_or_else(|error| panic!("{method} {path}: {error}"));
    let status = response.status();
    let set_cookies = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|value| value.to_str().unwrap_or_default().to_string())
        .collect();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap_or_else(|error| panic!("read body: {error}"));
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    Response {
        status,
        body,
        set_cookies,
    }
}

fn cookie_pair(set_cookies: &[String], name: &str) -> String {
    set_cookies
        .iter()
        .find_map(|cookie| {
            let pair = cookie.split(';').next()?;
            pair.strip_prefix(&format!("{name}="))
                .map(|value| format!("{name}={value}"))
        })
        .unwrap_or_else(|| panic!("missing cookie {name}"))
}

/// The two headers a browser sends on a write: the session cookie, and the
/// CSRF token echoed out of its own cookie.
fn browser(set_cookies: &[String]) -> (String, String) {
    let session = cookie_pair(set_cookies, security::SESSION_COOKIE);
    let csrf = cookie_pair(set_cookies, security::CSRF_COOKIE);
    let token = csrf
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| panic!("invalid csrf cookie"));
    (format!("{session}; {csrf}"), token)
}

fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-hire-test".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: false,
        frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
        sync_upload_url: None,
        sync_upload_key: None,
        sync_ingest_key: Some("test-master-key-at-least-thirty-two-characters".into()),
        sync_generation: 1,
        sync_enqueue_enabled: false,
        sync_interval_seconds: 5,
        sync_batch_limit: 100,
        sync_breaker_threshold: 5,
        sync_breaker_base_cooldown_seconds: 1,
        sync_breaker_max_cooldown_seconds: 10,
        sync_retention_days: 14,
        sync_degraded_after_seconds: 900,
        sync_apply_enabled: true,
        jwt_secret: Some("opaque-auth-enabled".into()),
        auth_token_ttl_minutes: 60,
        auth_session_idle_minutes: 30,
        auth_cookie_secure: false,
        bootstrap_admin_password: None,
        cors_allowed_origins: None,
        media: None,
        attachments: None,
        default_destination_site_id: "dc".into(),
        assistant_api_key: None,
        assistant_base_url: "https://openrouter.ai/api/v1".into(),
        assistant_model: "anthropic/claude-opus-5".into(),
    }
}

async fn sign_in(app: &axum::Router, username: &str, password: &str) -> (String, String) {
    let response = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": username, "password": password })),
    )
    .await;
    assert_eq!(
        response.status,
        StatusCode::OK,
        "sign in as {username}: {:?}",
        response.body
    );
    browser(&response.set_cookies)
}

fn write_headers(cookies: &str, csrf: &str) -> Vec<(String, String)> {
    vec![
        (header::COOKIE.to_string(), cookies.to_owned()),
        ("x-csrf-token".to_string(), csrf.to_owned()),
    ]
}

fn read_headers(cookies: &str) -> Vec<(String, String)> {
    vec![(header::COOKIE.to_string(), cookies.to_owned())]
}

/// Register somebody, hire them, and post them to a place.
async fn staff_at(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    code: &str,
    unit_id: &str,
) -> String {
    let registered = send(
        app.clone(),
        "POST",
        "/api/v1/employees",
        write_headers(cookies, csrf),
        Some(json!({ "employee_code": code })),
    )
    .await;
    assert_eq!(
        registered.status,
        StatusCode::OK,
        "register: {:?}",
        registered.body
    );
    let employee_id = registered.body["employee_id"]
        .as_str()
        .unwrap_or_else(|| panic!("employee_id: {:?}", registered.body))
        .to_owned();

    let hired = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        write_headers(cookies, csrf),
        Some(json!({
            "transition": "HIRE",
            "effective_on": "2026-01-05",
            "reason": "mulai bekerja",
        })),
    )
    .await;
    assert_eq!(hired.status, StatusCode::OK, "hire: {:?}", hired.body);

    let assigned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/assignments"),
        write_headers(cookies, csrf),
        Some(json!({
            "unit_id": unit_id,
            "valid_from": "2026-01-05",
            "reason": "penempatan awal",
        })),
    )
    .await;
    assert_eq!(
        assigned.status,
        StatusCode::OK,
        "assign: {:?}",
        assigned.body
    );
    employee_id
}

/// Give somebody a login at a rung and bind it to their record.
async fn login_for(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    employee_id: &str,
    username: &str,
    role: &str,
    password: &str,
) {
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(cookies, csrf),
        Some(json!({
            "username": username,
            "display_name": username,
            "password": password,
            "role": role,
        })),
    )
    .await;
    assert_eq!(
        created.status,
        StatusCode::OK,
        "create user: {:?}",
        created.body
    );
    let linked = send(
        app.clone(),
        "POST",
        &format!("/api/v1/employees/{employee_id}/account"),
        write_headers(cookies, csrf),
        Some(json!({ "username": username, "reason": "akun untuk staf" })),
    )
    .await;
    assert_eq!(linked.status, StatusCode::OK, "link: {:?}", linked.body);
}

/// A shop manager at `store-01`, posted there, with a supervisor login.
async fn manager_at(
    app: &axum::Router,
    cookies: &str,
    csrf: &str,
    code: &str,
    username: &str,
    unit_id: &str,
    password: &str,
) -> String {
    let employee_id = staff_at(app, cookies, csrf, code, unit_id).await;
    login_for(
        app,
        cookies,
        csrf,
        &employee_id,
        username,
        "SUPERVISOR",
        password,
    )
    .await;
    employee_id
}

fn proposal_body(unit_id: &str, base_pay_minor: i64) -> Value {
    json!({
        "unit_id": unit_id,
        "position": "Kasir",
        "headcount": 1,
        "need": "REPLACEMENT",
        "candidate_name": "Siti Rahayu",
        "start_on": "2026-11-01",
        "contract_kind": "PKWT",
        "contract_ends_on": "2027-10-31",
        "base_pay_minor": base_pay_minor,
        "reason": "kasir sore resign, antrean menumpuk akhir pekan",
    })
}

// ── the chain ────────────────────────────────────────────────────────────

/// The whole thing: proposed, returned, revised, approved, and opened.
///
/// The assertion that matters most is in the middle. After the revision,
/// version 1 is still readable *with the reason it was sent back* — which is
/// the point of a revision being a version rather than an edit.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_asks_head_office_answers_and_the_answer_becomes_a_record(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (hr, hr_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    manager_at(
        &app,
        &hr,
        &hr_csrf,
        "M0001",
        "budi",
        "store-01",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let (shop, shop_csrf) = sign_in(&app, "budi", SUPERVISOR_PASSWORD).await;

    // The shop asks.
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&shop, &shop_csrf),
        Some(proposal_body("store-01", 4_500_000_00)),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "propose: {:?}", filed.body);
    assert_eq!(filed.body["state"], "PROPOSED");
    assert_eq!(filed.body["unit_id"], "store-01");
    // The unit's own name travels with it, so no screen has to render `ho`.
    assert_eq!(filed.body["unit_name"], "Cikupa");
    assert_eq!(filed.body["current_version"], 1);
    assert_eq!(filed.body["proposed_by"], "budi");
    assert_eq!(filed.body["outstanding"], 1);
    let id = filed.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("id: {:?}", filed.body))
        .to_owned();

    // Head office sends it back. Not a refusal: the shop may ask again.
    let returned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/decision"),
        write_headers(&hr, &hr_csrf),
        Some(json!({
            "decision": "RETURN",
            "reason": "4,5jt di atas band kasir; ajukan ulang di 3,8jt",
        })),
    )
    .await;
    assert_eq!(
        returned.status,
        StatusCode::OK,
        "return: {:?}",
        returned.body
    );
    assert_eq!(returned.body["state"], "RETURNED");

    // The shop asks again, cheaper.
    let revised = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/revision"),
        write_headers(&shop, &shop_csrf),
        Some(json!({
            "position": "Kasir",
            "headcount": 1,
            "need": "REPLACEMENT",
            "candidate_name": "Siti Rahayu",
            "start_on": "2026-11-01",
            "contract_kind": "PKWT",
            "contract_ends_on": "2027-10-31",
            "base_pay_minor": 3_800_000_00,
            "reason": "turun ke 3,8jt sesuai arahan",
        })),
    )
    .await;
    assert_eq!(revised.status, StatusCode::OK, "revise: {:?}", revised.body);
    assert_eq!(revised.body["state"], "PROPOSED");
    assert_eq!(revised.body["current_version"], 2);

    // The returned version is still there, with the reason it was returned.
    let versions = revised.body["versions"]
        .as_array()
        .unwrap_or_else(|| panic!("versions: {:?}", revised.body));
    assert_eq!(versions.len(), 2, "the first version is still readable");
    assert_eq!(versions[0]["base_pay_minor"], 4_500_000_00_i64);
    assert_eq!(versions[0]["decision"], "RETURNED");
    assert_eq!(versions[0]["decided_by"], "admin");
    assert_eq!(
        versions[0]["decided_reason"],
        "4,5jt di atas band kasir; ajukan ulang di 3,8jt"
    );
    assert_eq!(versions[1]["base_pay_minor"], 3_800_000_00_i64);
    assert_eq!(versions[1]["filed_by"], "budi");
    assert!(
        versions[1]["decision"].is_null(),
        "version 2 is still waiting: {:?}",
        versions[1]
    );

    // Approved — which is not an employee.
    let approved = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/decision"),
        write_headers(&hr, &hr_csrf),
        Some(json!({ "decision": "APPROVE", "reason": "sesuai band, lanjut" })),
    )
    .await;
    assert_eq!(
        approved.status,
        StatusCode::OK,
        "approve: {:?}",
        approved.body
    );
    assert_eq!(approved.body["state"], "APPROVED");
    assert_eq!(approved.body["outstanding"], 1);
    assert_eq!(
        approved.body["employee_ids"]
            .as_array()
            .map(Vec::len)
            .unwrap_or_default(),
        0,
        "nobody is employed by an approval"
    );

    // A badge number somebody already has is a conflict, and — the point of
    // the check being a pre-flight — it leaves the proposal APPROVED rather
    // than FILLED against a record that was never written.
    let clashing = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/employment"),
        write_headers(&hr, &hr_csrf),
        Some(json!({ "employee_code": "M0001", "reason": "salah nomor" })),
    )
    .await;
    assert_eq!(
        clashing.status,
        StatusCode::CONFLICT,
        "a duplicate badge number: {:?}",
        clashing.body
    );
    let unmoved = send(
        app.clone(),
        "GET",
        &format!("/api/v1/hire-proposals/{id}"),
        read_headers(&hr),
        None,
    )
    .await;
    assert_eq!(unmoved.body["state"], "APPROVED");
    assert_eq!(unmoved.body["outstanding"], 1);

    // And now the employment record.
    let opened = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/employment"),
        write_headers(&hr, &hr_csrf),
        Some(json!({ "employee_code": "K0207", "reason": "buka record karyawan baru" })),
    )
    .await;
    assert_eq!(opened.status, StatusCode::OK, "open: {:?}", opened.body);
    assert_eq!(opened.body["state"], "FILLED");
    assert_eq!(opened.body["outstanding"], 0);
    let employee_id = opened.body["employee_ids"][0]
        .as_str()
        .unwrap_or_else(|| panic!("employee_ids: {:?}", opened.body))
        .to_owned();

    // A CANDIDATE, posted to the shop that asked, from the approved start date.
    // Not ACTIVE: nobody has seen this person start work, and the HIRE event is
    // its own act on its own route.
    let record = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{employee_id}"),
        read_headers(&hr),
        None,
    )
    .await;
    assert_eq!(record.status, StatusCode::OK, "read: {:?}", record.body);
    assert_eq!(record.body["status"], "CANDIDATE");
    assert_eq!(record.body["employee_code"], "K0207");
    assert_eq!(record.body["current_unit_id"], "store-01");
    assert_eq!(record.body["assignments"][0]["valid_from"], "2026-11-01");

    // No personal data came across. A proposal has none to give.
    let personal = send(
        app.clone(),
        "GET",
        &format!("/api/v1/employees/{employee_id}/personal-data"),
        read_headers(&hr),
        None,
    )
    .await;
    assert_eq!(
        personal.status,
        StatusCode::NOT_FOUND,
        "a candidate from a proposal has no NIK on file: {:?}",
        personal.body
    );

    // And the shop can read what became of its own request.
    let queue = send(
        app.clone(),
        "GET",
        "/api/v1/hire-proposals",
        read_headers(&shop),
        None,
    )
    .await;
    assert_eq!(queue.status, StatusCode::OK, "list: {:?}", queue.body);
    assert_eq!(queue.body[0]["id"], id);
    assert_eq!(queue.body[0]["state"], "FILLED");
}

// ── the rule a rung cannot express ───────────────────────────────────────

/// Head office is a place and not a pass. An HR officer who files a request for
/// head office's own staff holds the deciding key and still may not use it on
/// their own proposal — a second officer has to.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn head_offices_own_hr_cannot_decide_the_proposal_they_filed(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (hr, hr_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    // A second HR officer, posted to head office like the first.
    let dewi = staff_at(&app, &hr, &hr_csrf, "H0002", "ho").await;
    login_for(
        &app,
        &hr,
        &hr_csrf,
        &dewi,
        "dewi",
        "ADMIN",
        SECOND_HR_PASSWORD,
    )
    .await;

    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&hr, &hr_csrf),
        Some(proposal_body("ho", 7_500_000_00)),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "propose: {:?}", filed.body);
    let id = filed.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("id: {:?}", filed.body))
        .to_owned();

    // The officer who filed it holds the deciding rung and is refused anyway.
    let own = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/decision"),
        write_headers(&hr, &hr_csrf),
        Some(json!({ "decision": "APPROVE", "reason": "saya setuju sendiri" })),
    )
    .await;
    assert_eq!(
        own.status,
        StatusCode::FORBIDDEN,
        "the proposer decided their own: {:?}",
        own.body
    );

    // Somebody else can.
    let (second, second_csrf) = sign_in(&app, "dewi", SECOND_HR_PASSWORD).await;
    let theirs = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/decision"),
        write_headers(&second, &second_csrf),
        Some(json!({ "decision": "APPROVE", "reason": "kebutuhan HO disetujui" })),
    )
    .await;
    assert_eq!(
        theirs.status,
        StatusCode::OK,
        "a second officer decides: {:?}",
        theirs.body
    );
    assert_eq!(theirs.body["state"], "APPROVED");
}

// ── the two bounds ───────────────────────────────────────────────────────

/// The reach bound, asked of a hiring request: a manager posted to one shop may
/// not staff another, and may not read what another asked for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_manager_reaches_their_own_shops_requests_and_no_others(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (hr, hr_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    manager_at(
        &app,
        &hr,
        &hr_csrf,
        "M0001",
        "budi",
        "store-01",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let (shop, shop_csrf) = sign_in(&app, "budi", SUPERVISOR_PASSWORD).await;

    // Head office files one for another shop.
    let elsewhere = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&hr, &hr_csrf),
        Some(proposal_body("store-02", 3_800_000_00)),
    )
    .await;
    assert_eq!(
        elsewhere.status,
        StatusCode::OK,
        "propose: {:?}",
        elsewhere.body
    );
    let other = elsewhere.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("id: {:?}", elsewhere.body))
        .to_owned();

    // store-01's manager cannot propose for store-02.
    let poaching = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&shop, &shop_csrf),
        Some(proposal_body("store-02", 3_800_000_00)),
    )
    .await;
    assert_eq!(
        poaching.status,
        StatusCode::FORBIDDEN,
        "proposing into another shop: {:?}",
        poaching.body
    );

    // Nor read store-02's request, by id or by asking for its unit.
    let peeking = send(
        app.clone(),
        "GET",
        &format!("/api/v1/hire-proposals/{other}"),
        read_headers(&shop),
        None,
    )
    .await;
    assert_eq!(
        peeking.status,
        StatusCode::FORBIDDEN,
        "reading another shop's request: {:?}",
        peeking.body
    );
    let asking = send(
        app.clone(),
        "GET",
        "/api/v1/hire-proposals?unit_id=store-02",
        read_headers(&shop),
        None,
    )
    .await;
    assert_eq!(
        asking.status,
        StatusCode::FORBIDDEN,
        "a bounded caller naming another unit is refused, not re-filtered: {:?}",
        asking.body
    );

    // And an unfiltered list shows them nothing, because they have nothing.
    let mine = send(
        app.clone(),
        "GET",
        "/api/v1/hire-proposals",
        read_headers(&shop),
        None,
    )
    .await;
    assert_eq!(mine.status, StatusCode::OK, "list: {:?}", mine.body);
    assert_eq!(
        mine.body.as_array().map(Vec::len).unwrap_or_default(),
        0,
        "store-02's request is not store-01's to see: {:?}",
        mine.body
    );
}

/// The rung bound. A shop may ask and may not answer, and a cashier may not
/// even look — a proposal names a candidate and the pay a shop is offering.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_shop_may_ask_and_may_not_answer_and_a_cashier_may_not_look(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (hr, hr_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    manager_at(
        &app,
        &hr,
        &hr_csrf,
        "M0001",
        "budi",
        "store-01",
        SUPERVISOR_PASSWORD,
    )
    .await;
    let till = staff_at(&app, &hr, &hr_csrf, "K0009", "store-01").await;
    login_for(
        &app,
        &hr,
        &hr_csrf,
        &till,
        "rina",
        "CASHIER",
        CASHIER_PASSWORD,
    )
    .await;

    let (shop, shop_csrf) = sign_in(&app, "budi", SUPERVISOR_PASSWORD).await;
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&shop, &shop_csrf),
        Some(proposal_body("store-01", 3_800_000_00)),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "propose: {:?}", filed.body);
    let id = filed.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("id: {:?}", filed.body))
        .to_owned();

    // The shop cannot decide its own shop's request, whoever filed it.
    let deciding = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/decision"),
        write_headers(&shop, &shop_csrf),
        Some(json!({ "decision": "APPROVE", "reason": "saya butuh orangnya" })),
    )
    .await;
    assert_eq!(
        deciding.status,
        StatusCode::FORBIDDEN,
        "a shop deciding its own request: {:?}",
        deciding.body
    );

    // Nor open an employment record.
    let opening = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/employment"),
        write_headers(&shop, &shop_csrf),
        Some(json!({ "employee_code": "K0208", "reason": "langsung saja" })),
    )
    .await;
    assert_eq!(
        opening.status,
        StatusCode::FORBIDDEN,
        "a shop opening an employment record: {:?}",
        opening.body
    );

    // And a cashier at the same shop cannot read the queue at all.
    let (counter, _counter_csrf) = sign_in(&app, "rina", CASHIER_PASSWORD).await;
    let looking = send(
        app.clone(),
        "GET",
        "/api/v1/hire-proposals",
        read_headers(&counter),
        None,
    )
    .await;
    assert_eq!(
        looking.status,
        StatusCode::FORBIDDEN,
        "a cashier reading hiring requests: {:?}",
        looking.body
    );
}

// ── the statutory shape ──────────────────────────────────────────────────

/// UU 13/2003 art. 59 on the request, not only on the contract. Both halves:
/// a fixed term must say when it ends, and a permanent one must not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_proposed_contract_has_to_be_a_shape_somebody_could_sign(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (hr, hr_csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;

    let open_ended_fixed_term = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&hr, &hr_csrf),
        Some(json!({
            "unit_id": "ho",
            "position": "Staf Pembelian",
            "headcount": 1,
            "need": "ADDITION",
            "candidate_name": "Andi Pratama",
            "start_on": "2026-11-01",
            "contract_kind": "PKWT",
            "base_pay_minor": 6_000_000_00_i64,
            "reason": "volume PO naik",
        })),
    )
    .await;
    assert_eq!(
        open_ended_fixed_term.status,
        StatusCode::BAD_REQUEST,
        "a PKWT with no end date: {:?}",
        open_ended_fixed_term.body
    );

    let permanent_with_an_end = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&hr, &hr_csrf),
        Some(json!({
            "unit_id": "ho",
            "position": "Staf Pembelian",
            "headcount": 1,
            "need": "ADDITION",
            "candidate_name": "Andi Pratama",
            "start_on": "2026-11-01",
            "contract_kind": "PKWTT",
            "contract_ends_on": "2027-10-31",
            "base_pay_minor": 6_000_000_00_i64,
            "reason": "volume PO naik",
        })),
    )
    .await;
    assert_eq!(
        permanent_with_an_end.status,
        StatusCode::BAD_REQUEST,
        "a PKWTT with an end date: {:?}",
        permanent_with_an_end.body
    );

    // A request for nobody, and a request that offers nothing.
    for (field, body) in [
        (
            "headcount",
            json!({
                "unit_id": "ho",
                "position": "Staf Pembelian",
                "headcount": 0,
                "need": "ADDITION",
                "candidate_name": "Andi Pratama",
                "start_on": "2026-11-01",
                "contract_kind": "PKWTT",
                "base_pay_minor": 6_000_000_00_i64,
                "reason": "volume PO naik",
            }),
        ),
        (
            "base_pay_minor",
            json!({
                "unit_id": "ho",
                "position": "Staf Pembelian",
                "headcount": 1,
                "need": "ADDITION",
                "candidate_name": "Andi Pratama",
                "start_on": "2026-11-01",
                "contract_kind": "PKWTT",
                "base_pay_minor": 0,
                "reason": "volume PO naik",
            }),
        ),
    ] {
        let refused = send(
            app.clone(),
            "POST",
            "/api/v1/hire-proposals",
            write_headers(&hr, &hr_csrf),
            Some(body),
        )
        .await;
        assert_eq!(
            refused.status,
            StatusCode::BAD_REQUEST,
            "{field}: {:?}",
            refused.body
        );
    }

    // And a decision with no reason, which `ReasonText` refuses before the
    // domain sees it. Every one of the three answers carries one.
    let filed = send(
        app.clone(),
        "POST",
        "/api/v1/hire-proposals",
        write_headers(&hr, &hr_csrf),
        Some(proposal_body("ho", 6_000_000_00)),
    )
    .await;
    assert_eq!(filed.status, StatusCode::OK, "propose: {:?}", filed.body);
    let id = filed.body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("id: {:?}", filed.body))
        .to_owned();
    let unexplained = send(
        app.clone(),
        "POST",
        &format!("/api/v1/hire-proposals/{id}/decision"),
        write_headers(&hr, &hr_csrf),
        Some(json!({ "decision": "REJECT", "reason": "   " })),
    )
    .await;
    assert_eq!(
        unexplained.status,
        StatusCode::BAD_REQUEST,
        "a rejection nobody explained: {:?}",
        unexplained.body
    );
}
