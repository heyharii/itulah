//! The store node's HR relay, as the cloud answers it.
//!
//! A store's till speaks to its own node under one sign-in; HR lives at the
//! cloud. The node carries its manager's HR calls up with its machine key and
//! the manager's id (`domain::relay`), and the cloud decides. These tests hold
//! the cloud to the chain `auth::relayed_principal` promises — the path is on
//! the list, the node proves itself, the node is somewhere, the person may
//! sign in there — and to the bound it then imposes: the node's own place for
//! HR, the node's own site for GA, whatever the person could reach elsewhere.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{
    application::{CreateUserRequest, UpsertEdgeAssignmentRequest},
    domain::Role,
    http as cloud_http, postgres as cloud, AppConfig, AppState,
};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

const ADMIN_PASSWORD: &str = "admin-password-relay-000001";
const ORIGIN_07: &str = "store-07-edge";
const KEY_07: &str = "store-07-relay-integration-key-0000000001";

struct Response {
    status: StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send(
    app: &axum::Router,
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
        .clone()
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

fn config(auth_enabled: bool) -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-relay-test".into(),
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
        jwt_secret: auth_enabled.then(|| "opaque-auth-enabled".into()),
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

/// The three headers a store node puts on a relayed call.
fn relayed(origin: &str, key: &str, user: Uuid) -> Vec<(String, String)> {
    vec![
        ("x-sync-key".into(), key.into()),
        ("x-relay-origin".into(), origin.into()),
        ("x-relay-user".into(), user.to_string()),
    ]
}

async fn register_origin(pool: &PgPool, origin: &str, key: &str, site: &str) {
    cloud::register_origin_credential_binding(
        pool,
        origin,
        key,
        Some(origin),
        Some(site),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register {origin}: {error}"));
}

async fn login(pool: &PgPool, username: &str, role: Role) -> Uuid {
    let user = cloud::create_user(
        pool,
        CreateUserRequest {
            username: username.into(),
            display_name: format!("{username} (test)"),
            password: "cloud-password-relay-1".into(),
            role: role.into(),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("create {username}: {error}"));
    user["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("{username} id: {user:?}"))
}

async fn assign(pool: &PgPool, origin: &str, user_id: Uuid, role: Role) {
    cloud::upsert_edge_assignment(
        pool,
        UpsertEdgeAssignmentRequest {
            origin_id: origin.into(),
            user_id,
            role: role.into(),
            edge_password: Some("edge-relay-password-1".into()),
            offline_ttl_seconds: Some(12 * 60 * 60),
        },
        "admin",
    )
    .await
    .unwrap_or_else(|error| panic!("assign {user_id} at {origin}: {error}"));
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

/// Head office's own session, for the setup a relay may not do.
async fn head_office(app: &axum::Router) -> Vec<(String, String)> {
    let response = send(
        app,
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
    )
    .await;
    assert_eq!(response.status, StatusCode::OK, "admin sign-in: {:?}", response.body);
    let session = cookie_pair(&response.set_cookies, security::SESSION_COOKIE);
    let csrf = cookie_pair(&response.set_cookies, security::CSRF_COOKIE);
    let token = csrf
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| panic!("csrf cookie"));
    vec![
        (header::COOKIE.to_string(), format!("{session}; {csrf}")),
        ("x-csrf-token".to_string(), token),
    ]
}

/// Register, hire and post somebody, returning their employee id.
async fn employ(app: &axum::Router, hq: &[(String, String)], code: &str, unit: &str) -> String {
    let registered = send(
        app,
        "POST",
        "/api/v1/employees",
        hq.to_vec(),
        Some(json!({ "employee_code": code })),
    )
    .await;
    assert_eq!(registered.status, StatusCode::OK, "register: {:?}", registered.body);
    let employee_id = registered.body["employee_id"]
        .as_str()
        .unwrap_or_else(|| panic!("employee_id: {:?}", registered.body))
        .to_owned();
    let hired = send(
        app,
        "POST",
        &format!("/api/v1/employees/{employee_id}/employment"),
        hq.to_vec(),
        Some(json!({
            "transition": "HIRE",
            "effective_on": "2026-01-06",
            "reason": "mulai bekerja",
        })),
    )
    .await;
    assert_eq!(hired.status, StatusCode::OK, "hire: {:?}", hired.body);
    let posted = send(
        app,
        "POST",
        &format!("/api/v1/employees/{employee_id}/assignments"),
        hq.to_vec(),
        Some(json!({
            "unit_id": unit,
            "valid_from": "2026-01-06",
            "reason": "penempatan awal",
        })),
    )
    .await;
    assert_eq!(posted.status, StatusCode::OK, "post: {:?}", posted.body);
    employee_id
}

/// Every link of the chain, broken one at a time.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_relayed_call_is_refused_unless_path_node_and_person_all_check_out(pool: PgPool) {
    let app = cloud_http::router(AppState::new(pool.clone(), config(true)));
    register_origin(&pool, ORIGIN_07, KEY_07, "store-07").await;
    let manager = login(&pool, "mgr.seven", Role::Supervisor).await;
    assign(&pool, ORIGIN_07, manager, Role::Supervisor).await;
    let stranger = login(&pool, "not.assigned", Role::Supervisor).await;

    // The whole chain holds: the person, as themselves, at the lower rung.
    let ok = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, KEY_07, manager),
        None,
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK, "relayed reach: {:?}", ok.body);
    assert_eq!(ok.body["role"], "SUPERVISOR");

    // The node's key is wrong, or missing.
    let wrong_key = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, "store-07-a-key-somebody-guessed-000000000", manager),
        None,
    )
    .await;
    assert_eq!(wrong_key.status, StatusCode::FORBIDDEN, "{:?}", wrong_key.body);
    let mut keyless = relayed(ORIGIN_07, KEY_07, manager);
    keyless.retain(|(name, _)| name != "x-sync-key");
    let keyless = send(&app, "GET", "/api/v1/employees/me/reach", keyless, None).await;
    assert_eq!(keyless.status, StatusCode::FORBIDDEN, "{:?}", keyless.body);

    // Half a relay is refused as a relay, never answered as a session.
    let half = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        vec![("x-relay-user".into(), manager.to_string())],
        None,
    )
    .await;
    assert_eq!(half.status, StatusCode::UNAUTHORIZED, "{:?}", half.body);

    // The person has no assignment at this node, or does not exist.
    for nobody in [stranger, Uuid::new_v4()] {
        let refused = send(
            &app,
            "GET",
            "/api/v1/employees/me/reach",
            relayed(ORIGIN_07, KEY_07, nobody),
            None,
        )
        .await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
    }

    // The path is not on the list — however good the credentials.
    for (method, path) in [
        ("GET", "/api/v1/auth/users"),
        ("GET", "/api/v1/employees/emp_x/personal-data"),
        ("GET", "/api/v1/payroll/runs"),
        ("GET", "/api/v1/ga/overview"),
        ("GET", "/api/v1/health"),
    ] {
        let refused = send(&app, method, path, relayed(ORIGIN_07, KEY_07, manager), None).await;
        assert_eq!(
            refused.status,
            StatusCode::FORBIDDEN,
            "{method} {path}: {:?}",
            refused.body
        );
        assert!(
            refused.body["error"]
                .as_str()
                .is_some_and(|said| said.contains("may relay")),
            "{method} {path}: {:?}",
            refused.body
        );
    }

    // An `actor_id` naming somebody else is refused exactly as for a session.
    let forged = send(
        &app,
        "POST",
        &format!("/api/v1/notifications/{}/read", Uuid::new_v4()),
        relayed(ORIGIN_07, KEY_07, manager),
        Some(json!({ "actor_id": "somebody.else" })),
    )
    .await;
    assert_eq!(forged.status, StatusCode::FORBIDDEN, "{:?}", forged.body);
    assert!(
        forged.body["error"]
            .as_str()
            .is_some_and(|said| said.contains("actor_id")),
        "{:?}",
        forged.body
    );

    // A node registered for no site is nowhere, and relays nothing.
    // (Nobody can be assigned there either — an assignment needs a site — so
    // this is refused at the place, before anybody is looked up.)
    const ORPHAN_KEY: &str = "orphan-relay-integration-key-0000000001";
    cloud::register_origin_credential_binding(
        &pool,
        "orphan-edge",
        ORPHAN_KEY,
        Some("orphan"),
        None,
        None,
        Some(1),
        Some(false),
    )
    .await
    .unwrap_or_else(|error| panic!("register orphan: {error}"));
    let placeless = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed("orphan-edge", ORPHAN_KEY, manager),
        None,
    )
    .await;
    assert_eq!(placeless.status, StatusCode::FORBIDDEN, "{:?}", placeless.body);

    // Revoking the assignment stops the relay on the next call.
    sqlx::query("UPDATE edge_identity_assignment SET active = false WHERE user_id = $1")
        .bind(manager)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("revoke: {error}"));
    let revoked = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, KEY_07, manager),
        None,
    )
    .await;
    assert_eq!(revoked.status, StatusCode::FORBIDDEN, "{:?}", revoked.body);
}

/// A cloud with its own sessions switched off has not made every shop head
/// office: a relayed call is still the chain, never the development Admin.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_relayed_call_is_never_the_development_admin(pool: PgPool) {
    let app = cloud_http::router(AppState::new(pool.clone(), config(false)));
    register_origin(&pool, ORIGIN_07, KEY_07, "store-07").await;
    let cashier = login(&pool, "cashier.seven", Role::Cashier).await;
    assign(&pool, ORIGIN_07, cashier, Role::Cashier).await;

    let wrong_key = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, "store-07-a-key-somebody-guessed-000000000", cashier),
        None,
    )
    .await;
    assert_eq!(wrong_key.status, StatusCode::FORBIDDEN, "{:?}", wrong_key.body);

    let off_list = send(
        &app,
        "GET",
        "/api/v1/auth/users",
        relayed(ORIGIN_07, KEY_07, cashier),
        None,
    )
    .await;
    assert_eq!(off_list.status, StatusCode::FORBIDDEN, "{:?}", off_list.body);

    let reach = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, KEY_07, cashier),
        None,
    )
    .await;
    assert_eq!(reach.status, StatusCode::OK, "{:?}", reach.body);
    assert_eq!(reach.body["role"], "CASHIER", "not the development ADMIN");
}

/// Head office HR signed in at store-07's till reaches store-07 — and a
/// supervisor posted to store-03 reaches nothing there.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_relayed_call_reaches_the_nodes_unit_and_no_other(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config(true)));
    let hq = head_office(&app).await;
    register_origin(&pool, ORIGIN_07, KEY_07, "store-07").await;

    let here = employ(&app, &hq, "K0701", "store-07").await;
    let there = employ(&app, &hq, "K0301", "store-03").await;

    // An Admin at the cloud, and an Admin at this till: Everywhere, cut to
    // the till's place.
    let hr = login(&pool, "hr.officer", Role::Admin).await;
    assign(&pool, ORIGIN_07, hr, Role::Admin).await;
    let list = send(
        &app,
        "GET",
        "/api/v1/employees",
        relayed(ORIGIN_07, KEY_07, hr),
        None,
    )
    .await;
    assert_eq!(list.status, StatusCode::OK, "relayed list: {:?}", list.body);
    assert_eq!(list.body["unit_id"], "store-07");
    let ids: Vec<&str> = list.body["rows"]
        .as_array()
        .unwrap_or_else(|| panic!("rows: {:?}", list.body))
        .iter()
        .filter_map(|row| row["employee_id"].as_str())
        .collect();
    assert!(ids.contains(&here.as_str()), "{ids:?}");
    assert!(!ids.contains(&there.as_str()), "{ids:?}");

    let asked_elsewhere = send(
        &app,
        "GET",
        "/api/v1/employees?unit_id=store-03",
        relayed(ORIGIN_07, KEY_07, hr),
        None,
    )
    .await;
    assert_eq!(asked_elsewhere.status, StatusCode::FORBIDDEN, "{:?}", asked_elsewhere.body);
    let one_elsewhere = send(
        &app,
        "GET",
        &format!("/api/v1/employees/{there}"),
        relayed(ORIGIN_07, KEY_07, hr),
        None,
    )
    .await;
    assert!(
        matches!(one_elsewhere.status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "{:?}: {:?}",
        one_elsewhere.status,
        one_elsewhere.body
    );
    let reach = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, KEY_07, hr),
        None,
    )
    .await;
    assert_eq!(reach.body["scope"], "ONE_UNIT", "{:?}", reach.body);
    assert_eq!(reach.body["unit_id"], "store-07", "{:?}", reach.body);

    // A supervisor posted to store-03, signed in at store-07's till.
    let visitor = login(&pool, "mgr.three", Role::Supervisor).await;
    let linked = send(
        &app,
        "POST",
        &format!("/api/v1/employees/{there}/account"),
        hq.clone(),
        Some(json!({ "username": "mgr.three", "reason": "akun manajer toko 03" })),
    )
    .await;
    assert_eq!(linked.status, StatusCode::OK, "link: {:?}", linked.body);
    assign(&pool, ORIGIN_07, visitor, Role::Supervisor).await;
    let reach = send(
        &app,
        "GET",
        "/api/v1/employees/me/reach",
        relayed(ORIGIN_07, KEY_07, visitor),
        None,
    )
    .await;
    assert_eq!(reach.status, StatusCode::OK, "{:?}", reach.body);
    assert_eq!(reach.body["scope"], "NOWHERE", "{:?}", reach.body);
    let list = send(
        &app,
        "GET",
        "/api/v1/employees",
        relayed(ORIGIN_07, KEY_07, visitor),
        None,
    )
    .await;
    assert_eq!(list.status, StatusCode::FORBIDDEN, "{:?}", list.body);
}

/// GA resolves no `Reach`; its rows carry a site. Through a till, the site is
/// the till's: forced on a list, checked on a row, matched on a body.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn general_affairs_through_a_till_is_the_tills_own_site(pool: PgPool) {
    let app = cloud_http::router(AppState::new(pool.clone(), config(true)));
    register_origin(&pool, ORIGIN_07, KEY_07, "store-07").await;
    let manager = login(&pool, "mgr.seven", Role::Supervisor).await;
    assign(&pool, ORIGIN_07, manager, Role::Supervisor).await;
    let as_manager = || relayed(ORIGIN_07, KEY_07, manager);

    for site in ["store-07", "store-03"] {
        cloud::ga_supply_record(
            &pool,
            &cloud::RecordGaSupplyRequestRequest {
                site_id: site.into(),
                requested_by: "Rina".into(),
                category_code: "ATK".into(),
                item: format!("Kertas A4 untuk {site}"),
                quantity: Some("10 rim".into()),
                needed_by: None,
                estimated_cost_minor: None,
                notes: None,
            },
            "ga.ho",
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("supply at {site}: {error}"));
    }

    // A list asked for nothing is answered with the till's own site.
    let supplies = send(&app, "GET", "/api/v1/ga/supplies", as_manager(), None).await;
    assert_eq!(supplies.status, StatusCode::OK, "{:?}", supplies.body);
    let rows = supplies
        .body
        .as_array()
        .unwrap_or_else(|| panic!("supplies: {:?}", supplies.body));
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert!(rows.iter().all(|row| row["site_id"] == "store-07"), "{rows:?}");

    // An asset and a contract at each shop, and one contract covering every
    // store — written straight in, the way the GA tests seed their registers.
    let mut assets_at = std::collections::BTreeMap::new();
    let mut contracts_at = std::collections::BTreeMap::new();
    for site in ["store-07", "store-03"] {
        let asset_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO fixed_asset
               (asset_id, asset_number, name, category_code, site_id, acquired_on, status,
                registered_by)
             VALUES ($1,$2,'AC toko','AIR_CONDITIONER',$3,DATE '2026-01-06','REGISTERED','ana')",
        )
        .bind(asset_id)
        .bind(format!("AST-RELAY-{site}"))
        .bind(site)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("asset at {site}: {error}"));
        assets_at.insert(site, asset_id);
        let contract_id: Uuid = sqlx::query_scalar(
            "INSERT INTO ga_contract (contract_type, counterparty_name, site_id, starts_on, created_by)
             VALUES ('SEWA_TOKO', 'Pemilik Ruko', $1, DATE '2026-01-01', 'ana')
             RETURNING contract_id",
        )
        .bind(site)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("contract at {site}: {error}"));
        contracts_at.insert(site, contract_id);
    }
    let everywhere: Uuid = sqlx::query_scalar(
        "INSERT INTO ga_contract (contract_type, counterparty_name, site_scope, starts_on, created_by)
         VALUES ('JASA_CLEANING', 'PT Bersih', 'ALL_STORES', DATE '2026-01-01', 'ana')
         RETURNING contract_id",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("company-wide contract: {error}"));

    // Asking for another shop is refused, not quietly narrowed.
    for path in [
        "/api/v1/ga/supplies?site=store-03".to_owned(),
        "/api/v1/ga/assets?site=store-03".to_owned(),
        "/api/v1/ga/assets?site=store-07&site=store-03".to_owned(),
        "/api/v1/ga/contract-types?site=dc".to_owned(),
        "/api/v1/ga/locations/store-03".to_owned(),
        format!("/api/v1/ga/assets/{}", assets_at["store-03"]),
        format!("/api/v1/ga/contracts/{}", contracts_at["store-03"]),
    ] {
        let refused = send(&app, "GET", &path, as_manager(), None).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN, "{path}: {:?}", refused.body);
    }

    // The till's own place, its own things, its own paper — and the paper
    // that covers every store, which its own place's page lists too.
    for path in [
        "/api/v1/ga/locations/store-07".to_owned(),
        "/api/v1/ga/contract-types".to_owned(),
        format!("/api/v1/ga/assets/{}", assets_at["store-07"]),
        format!("/api/v1/ga/contracts/{}", contracts_at["store-07"]),
        format!("/api/v1/ga/contracts/{everywhere}"),
    ] {
        let read = send(&app, "GET", &path, as_manager(), None).await;
        assert_eq!(read.status, StatusCode::OK, "{path}: {:?}", read.body);
    }

    // The register is the till's site, and its facets say nothing about any
    // other shop's.
    let assets = send(&app, "GET", "/api/v1/ga/assets", as_manager(), None).await;
    assert_eq!(assets.status, StatusCode::OK, "{:?}", assets.body);
    let rows = assets.body["rows"]
        .as_array()
        .unwrap_or_else(|| panic!("asset rows: {:?}", assets.body));
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0]["site_id"], "store-07");
    let facets = &assets.body["facets"];
    let sites: Vec<&Value> = facets["sites"]
        .as_array()
        .unwrap_or_else(|| panic!("facets: {facets:?}"))
        .iter()
        .collect();
    assert!(sites.iter().all(|facet| facet["value"] == "store-07"), "{facets:?}");
    for counted_across_the_estate in ["classes", "builds", "conditions", "statuses"] {
        assert_eq!(facets[counted_across_the_estate], json!([]), "{facets:?}");
    }

    // A note on another shop's thing is refused; on its own, written.
    let note = json!({ "reason": "AC bocor di area kasir" });
    let refused = send(
        &app,
        "POST",
        &format!("/api/v1/ga/assets/{}/notes", assets_at["store-03"]),
        as_manager(),
        Some(note.clone()),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
    let noted = send(
        &app,
        "POST",
        &format!("/api/v1/ga/assets/{}/notes", assets_at["store-07"]),
        as_manager(),
        Some(note),
    )
    .await;
    assert_eq!(noted.status, StatusCode::OK, "{:?}", noted.body);

    // The repair and maintenance lists take no site in their readers; through
    // a till they are narrowed to it, facets and all.
    let supplier = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               created_by, updated_by)
         VALUES ($1, 'SUP-RELAY-1', 'sup-relay-1', 'Teknisi Servis', 'ana', 'ana')",
    )
    .bind(supplier)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("supplier: {error}"));
    for site in ["store-07", "store-03", "store-03"] {
        sqlx::query(
            "INSERT INTO ga_repair (site_id, objek, title, supplier_id, failure_at, created_by)
             VALUES ($1, 'AC', 'AC tidak dingin', $2, DATE '2026-09-20', 'ana')",
        )
        .bind(site)
        .bind(supplier)
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("repair at {site}: {error}"));
    }
    let repairs = send(&app, "GET", "/api/v1/ga/repairs?site=store-07", as_manager(), None).await;
    assert_eq!(repairs.status, StatusCode::OK, "{:?}", repairs.body);
    let rows = repairs.body["rows"]
        .as_array()
        .unwrap_or_else(|| panic!("repair rows: {:?}", repairs.body));
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0]["site_id"], "store-07");
    assert_eq!(repairs.body["total"], 1);
    let facets = &repairs.body["facets"];
    for facet in ["sites", "objects", "statuses"] {
        let counted: i64 = facets[facet]
            .as_array()
            .unwrap_or_else(|| panic!("{facet}: {facets:?}"))
            .iter()
            .filter_map(|entry| entry["count"].as_i64())
            .sum();
        assert_eq!(counted, 1, "{facet} counts only the till's repair: {facets:?}");
    }
    for path in [
        "/api/v1/ga/repairs?site=store-03",
        "/api/v1/ga/maintenance-tasks?site=store-03",
    ] {
        let refused = send(&app, "GET", path, as_manager(), None).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN, "{path}: {:?}", refused.body);
    }
    let tasks = send(&app, "GET", "/api/v1/ga/maintenance-tasks", as_manager(), None).await;
    assert_eq!(tasks.status, StatusCode::OK, "{:?}", tasks.body);

    // A repair must be at this shop, on this shop's thing.
    let repair = |site: &str, asset: Uuid| {
        json!({
            "site_id": site,
            "asset_id": asset,
            "title": "AC tidak dingin",
            "supplier_id": Uuid::new_v4(),
            "failure_at": "2026-09-20",
        })
    };
    for body in [
        repair("store-03", assets_at["store-03"]),
        repair("store-07", assets_at["store-03"]),
    ] {
        let refused = send(&app, "POST", "/api/v1/ga/repairs", as_manager(), Some(body)).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN, "{:?}", refused.body);
    }

    // A body naming another shop is refused; its own is filed.
    let filing = |site: &str| {
        json!({
            "site_id": site,
            "requested_by": "Rina",
            "category_code": "ATK",
            "item": "Tinta printer",
            "quantity": "2 botol",
        })
    };
    let elsewhere = send(
        &app,
        "POST",
        "/api/v1/ga/supplies",
        as_manager(),
        Some(filing("store-03")),
    )
    .await;
    assert_eq!(elsewhere.status, StatusCode::FORBIDDEN, "{:?}", elsewhere.body);
    let own = send(
        &app,
        "POST",
        "/api/v1/ga/supplies",
        as_manager(),
        Some(filing("store-07")),
    )
    .await;
    assert_eq!(own.status, StatusCode::OK, "{:?}", own.body);
    assert_eq!(own.body["site_id"], "store-07");
    let request_id = own.body["request_id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .unwrap_or_else(|| panic!("request_id: {:?}", own.body));
    let filed_by: String =
        sqlx::query_scalar("SELECT created_by FROM ga_supply_request WHERE request_id = $1")
            .bind(request_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("filed by: {error}"));
    assert_eq!(filed_by, "mgr.seven", "the person, not the node");
}
