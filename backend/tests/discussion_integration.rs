//! Discussions, driven the way the board and the thread page drive them.
//!
//! Three people with three different rights, over HTTP with real sessions,
//! because every rule worth testing here is a rule about WHO: whoever opened a
//! thread decides what answered it, only an author corrects a post, head
//! office moderates, and nobody is told about a thread they muted. A test that
//! called the store directly would prove the SQL and not that the route hands
//! the store the right person.
//!
//! What 0490 added is covered end to end: reading position and the Unread
//! feed, replying to one post, a resend that lands once, corrections and their
//! history, reactions, `@names`, the accepted answer and its withdrawal,
//! following and muting, pinning, and locking. So are the three failures the
//! old module had: an unknown thread answering 500 instead of 404, a tag chip
//! that searched titles, and a file from somebody else's upload riding into a
//! thread everybody can read.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

const ADMIN_PASSWORD: &str = "admin-password-discuss-1";
const SARI_PASSWORD: &str = "sari-password-discuss-1";
const BUDI_PASSWORD: &str = "budi-password-discuss-1";

struct Response {
    status: StatusCode,
    body: Value,
    set_cookies: Vec<String>,
}

async fn send_raw(
    app: axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(String, String)>,
    content_type: Option<&str>,
    body: Body,
) -> Response {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    let response = app
        .oneshot(
            builder
                .body(body)
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

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    headers: Vec<(String, String)>,
    body: Option<Value>,
) -> Response {
    match body {
        Some(value) => {
            send_raw(
                app.clone(),
                method,
                path,
                headers,
                Some("application/json"),
                Body::from(
                    serde_json::to_vec(&value).unwrap_or_else(|error| panic!("encode: {error}")),
                ),
            )
            .await
        }
        None => send_raw(app.clone(), method, path, headers, None, Body::empty()).await,
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

/// A signed-in browser: the session cookie for reads, and the CSRF token it
/// echoes on every write.
#[derive(Clone)]
struct Person {
    cookie: String,
    csrf: String,
}

impl Person {
    fn reads(&self) -> Vec<(String, String)> {
        vec![("cookie".into(), self.cookie.clone())]
    }

    fn writes(&self) -> Vec<(String, String)> {
        vec![
            ("cookie".into(), self.cookie.clone()),
            ("x-csrf-token".into(), self.csrf.clone()),
        ]
    }
}

async fn sign_in(app: &axum::Router, username: &str, password: &str) -> Person {
    let login = send(
        app,
        "POST",
        "/api/v1/auth/login",
        vec![],
        Some(json!({ "username": username, "password": password })),
    )
    .await;
    assert_eq!(login.status, StatusCode::OK, "sign in as {username}");
    let session = cookie_pair(&login.set_cookies, security::SESSION_COOKIE);
    let csrf = cookie_pair(&login.set_cookies, security::CSRF_COOKIE);
    let token = csrf
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| panic!("invalid csrf cookie"));
    Person {
        cookie: format!("{session}; {csrf}"),
        csrf: token,
    }
}

async fn create_user(
    app: &axum::Router,
    admin: &Person,
    username: &str,
    name: &str,
    password: &str,
    role: &str,
) {
    let created = send(
        app,
        "POST",
        "/api/v1/auth/users",
        admin.writes(),
        Some(json!({
            "username": username,
            "display_name": name,
            "password": password,
            "role": role
        })),
    )
    .await;
    assert_eq!(
        created.status,
        StatusCode::OK,
        "create {username}: {:?}",
        created.body
    );
}

/// The kinds of notification this person has been handed, newest first.
async fn told(app: &axum::Router, person: &Person) -> Vec<String> {
    let list = send(app, "GET", "/api/v1/notifications", person.reads(), None).await;
    assert_eq!(list.status, StatusCode::OK, "{:?}", list.body);
    list.body["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items in {:?}", list.body))
        .iter()
        .filter_map(|item| item["kind"].as_str().map(str::to_owned))
        .collect()
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap_or_else(|| panic!("not a list: {list:?}"))
        .iter()
        .filter_map(|thread| thread["thread_id"].as_str().map(str::to_owned))
        .collect()
}

fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-discussion-test".into(),
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
        assistant_vertex: false,
        assistant_price_per_mtok: None,
    }
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_discussion_is_read_answered_corrected_and_followed_by_the_right_people(pool: PgPool) {
    cloud::bootstrap_admin(&pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));

    let admin = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    create_user(&app, &admin, "sari.kasir", "Sari", SARI_PASSWORD, "CASHIER").await;
    create_user(
        &app,
        &admin,
        "budi.spv",
        "Budi",
        BUDI_PASSWORD,
        "SUPERVISOR",
    )
    .await;
    let sari = sign_in(&app, "sari.kasir", SARI_PASSWORD).await;
    let budi = sign_in(&app, "budi.spv", BUDI_PASSWORD).await;

    // ── who can be named, readable by a cashier ─────────────────────────
    let people = send(
        &app,
        "GET",
        "/api/v1/discussions/people",
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(people.status, StatusCode::OK, "{:?}", people.body);
    assert!(
        people.body.as_array().is_some_and(|rows| rows
            .iter()
            .any(|row| row["username"] == "budi.spv" && row["name"] == "Budi")),
        "{:?}",
        people.body
    );

    // ── a thread hangs on a record, never on a category ─────────────────
    for kind in ["general", "discussion"] {
        let refused = send(
            &app,
            "POST",
            "/api/v1/discussions",
            sari.writes(),
            Some(json!({
                "subject_kind": kind, "subject_id": "X-1", "subject_note": null,
                "title": "t", "body": "b"
            })),
        )
        .await;
        assert_eq!(
            refused.status,
            StatusCode::BAD_REQUEST,
            "{kind}: {:?}",
            refused.body
        );
    }

    // ── an unknown thread is a 404, not the foreign key's 500 ───────────
    let nowhere = Uuid::new_v4();
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("/api/v1/discussions/{nowhere}"),
            sari.reads(),
            None
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("/api/v1/discussions/{nowhere}/bookmark"),
            sari.writes(),
            Some(json!({ "marked": true }))
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );

    // ── Sari asks, and names Budi ────────────────────────────────────────
    let opened = send(
        &app,
        "POST",
        "/api/v1/discussions",
        sari.writes(),
        Some(json!({
            "subject_kind": "purchase_order",
            "subject_id": "PO-2609-0001",
            "subject_note": "Kemeja lengan panjang",
            "title": "Harga kemeja naik 400rb dari PO",
            "body": "Tagihan lebih mahal dari PO. @budi.spv tolong cek.",
            "tags": ["Harga", "#faktur"],
            "attachments": []
        })),
    )
    .await;
    assert_eq!(opened.status, StatusCode::CREATED, "{:?}", opened.body);
    let thread = opened.body["thread_id"]
        .as_str()
        .unwrap_or_else(|| panic!("no thread id"))
        .to_string();
    assert_eq!(opened.body["subject_label"], "Purchase order");
    assert_eq!(opened.body["tags"], json!(["faktur", "harga"]));
    assert_eq!(opened.body["can_manage"], json!(true));
    assert_eq!(opened.body["can_pin"], json!(false));
    assert_eq!(opened.body["people"], json!(1));

    // Named, so told by name — and head office is told a thread opened.
    let budi_told = told(&app, &budi).await;
    assert!(
        budi_told.contains(&"discussion.mentioned".to_string()),
        "{budi_told:?}"
    );
    assert!(
        !budi_told.contains(&"discussion.thread.opened".to_string()),
        "Budi is not head office"
    );
    assert!(told(&app, &admin)
        .await
        .contains(&"discussion.thread.opened".to_string()));

    // ── Budi opens it for the first time: New, not Unread ───────────────
    let fresh = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=new",
        budi.reads(),
        None,
    )
    .await;
    assert_eq!(ids(&fresh.body), vec![thread.clone()]);
    let first = send(
        &app,
        "GET",
        &format!("/api/v1/discussions/{thread}"),
        budi.reads(),
        None,
    )
    .await;
    assert_eq!(first.status, StatusCode::OK);
    assert_eq!(first.body["seen_by_me"], json!(false));
    assert_eq!(
        first.body["people"],
        json!(2),
        "the reader counts on their first visit"
    );
    assert_eq!(first.body["can_manage"], json!(false));
    let fresh = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=new",
        budi.reads(),
        None,
    )
    .await;
    assert!(ids(&fresh.body).is_empty());

    // ── Budi answers post #1, and the resend lands once ─────────────────
    let answer_body = json!({
        "body": "Sudah dicek, supplier naikkan harga kain.",
        "attachments": [],
        "reply_to_seq": 1,
        "idempotency_key": "reply-budi-1"
    });
    let replied = send(
        &app,
        "POST",
        &format!("/api/v1/discussions/{thread}/posts"),
        budi.writes(),
        Some(answer_body.clone()),
    )
    .await;
    assert_eq!(replied.status, StatusCode::CREATED, "{:?}", replied.body);
    assert_eq!(replied.body["seq"], json!(2));
    assert_eq!(replied.body["reply_to"]["seq"], json!(1));
    assert_eq!(replied.body["reply_to"]["author"], "sari.kasir");
    assert_eq!(replied.body["author_name"], "Budi");
    let answer = replied.body["post_id"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let resent = send(
        &app,
        "POST",
        &format!("/api/v1/discussions/{thread}/posts"),
        budi.writes(),
        Some(answer_body),
    )
    .await;
    assert_eq!(
        resent.body["post_id"],
        json!(answer),
        "a resend is the same reply"
    );

    // Sari hears about it; the reply cannot name a post that is not there.
    assert!(told(&app, &sari)
        .await
        .contains(&"discussion.thread.replied".to_string()));
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("/api/v1/discussions/{thread}/posts"),
            budi.writes(),
            Some(json!({ "body": "x", "attachments": [], "reply_to_seq": 9 })),
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );

    // ── Sari's board says it moved, until she reads it ──────────────────
    let unread = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=unread",
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(ids(&unread.body), vec![thread.clone()]);
    assert_eq!(unread.body[0]["unread_count"], json!(1));
    let visit = send(
        &app,
        "GET",
        &format!("/api/v1/discussions/{thread}"),
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(
        visit.body["last_read_seq"],
        json!(1),
        "where she stood before this visit"
    );
    let unread = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=unread",
        sari.reads(),
        None,
    )
    .await;
    assert!(ids(&unread.body).is_empty(), "{:?}", unread.body);

    // ── only the author corrects a post, and the old words are kept ─────
    let posts = format!("/api/v1/discussions/{thread}/posts/{answer}");
    assert_eq!(
        send(
            &app,
            "PATCH",
            &posts,
            sari.writes(),
            Some(json!({ "body": "bukan" }))
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    let corrected = send(
        &app,
        "PATCH",
        &posts,
        budi.writes(),
        Some(json!({ "body": "Sudah dicek, supplier naikkan harga kain 5%." })),
    )
    .await;
    assert_eq!(corrected.status, StatusCode::OK, "{:?}", corrected.body);
    assert!(!corrected.body["edited_at"].is_null());
    assert_eq!(corrected.body["revisions"], json!(1));
    let history = send(
        &app,
        "GET",
        &format!("{posts}/revisions"),
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(
        history.body[0]["body"],
        "Sudah dicek, supplier naikkan harga kain."
    );
    assert_eq!(history.body[0]["replaced_by"], "budi.spv");

    // ── reactions, from the closed set ──────────────────────────────────
    let reacted = send(
        &app,
        "POST",
        &format!("{posts}/reactions"),
        sari.writes(),
        Some(json!({ "reaction": "thumbs_up", "on": true })),
    )
    .await;
    assert_eq!(reacted.status, StatusCode::OK, "{:?}", reacted.body);
    assert_eq!(reacted.body[0]["count"], json!(1));
    assert_eq!(reacted.body[0]["mine"], json!(true));
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("{posts}/reactions"),
            sari.writes(),
            Some(json!({ "reaction": "fire", "on": true })),
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );

    // ── whoever asked decides what answered it ──────────────────────────
    let solution = format!("/api/v1/discussions/{thread}/solution");
    assert_eq!(
        send(
            &app,
            "POST",
            &solution,
            budi.writes(),
            Some(json!({ "post_id": answer }))
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    let opening_post = send(
        &app,
        "GET",
        &format!("/api/v1/discussions/{thread}/posts"),
        sari.reads(),
        None,
    )
    .await
    .body[0]["post_id"]
        .clone();
    assert_eq!(
        send(
            &app,
            "POST",
            &solution,
            sari.writes(),
            Some(json!({ "post_id": opening_post }))
        )
        .await
        .status,
        StatusCode::BAD_REQUEST,
        "the question cannot be its own answer"
    );
    let answered = send(
        &app,
        "POST",
        &solution,
        sari.writes(),
        Some(json!({ "post_id": answer })),
    )
    .await;
    assert_eq!(answered.status, StatusCode::OK, "{:?}", answered.body);
    assert_eq!(answered.body["status"], "resolved");
    assert_eq!(answered.body["has_solution"], json!(true));
    assert!(told(&app, &budi)
        .await
        .contains(&"discussion.solution.accepted".to_string()));

    // ── a tag is a filter, and search reads the posts ───────────────────
    let tagged = send(
        &app,
        "GET",
        "/api/v1/discussions?tag=faktur",
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(ids(&tagged.body), vec![thread.clone()]);
    let found = send(
        &app,
        "GET",
        "/api/v1/discussions?q=kain",
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(
        ids(&found.body),
        vec![thread.clone()],
        "a word only in a reply"
    );
    let percent = send(
        &app,
        "GET",
        "/api/v1/discussions?q=5%25",
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(
        ids(&percent.body),
        vec![thread.clone()],
        "`%` is the character"
    );
    // "4%" as a pattern would match the "400rb" in the title; as characters
    // it matches nothing.
    let none = send(
        &app,
        "GET",
        "/api/v1/discussions?q=4%25",
        sari.reads(),
        None,
    )
    .await;
    assert!(
        ids(&none.body).is_empty(),
        "`%` is not a wildcard: {:?}",
        none.body
    );

    // ── somebody else's upload does not ride into a public thread ───────
    let uploaded = send_raw(
        app.clone(),
        "POST",
        "/api/v1/files?name=nota.txt&content_type=text/plain",
        budi.writes(),
        Some("application/octet-stream"),
        Body::from("nota pembelian"),
    )
    .await;
    assert_eq!(uploaded.status, StatusCode::CREATED, "{:?}", uploaded.body);
    let file = uploaded.body["file_id"].clone();
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("/api/v1/discussions/{thread}/posts"),
            sari.writes(),
            Some(json!({ "body": "ini notanya", "attachments": [file] })),
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );

    // ── withdrawing the answer un-answers the thread ────────────────────
    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!(
                "/api/v1/discussions/{thread}/posts/{}",
                opening_post.as_str().unwrap_or_default()
            ),
            sari.writes(),
            None
        )
        .await
        .status,
        StatusCode::CONFLICT,
        "the opening post is the thread"
    );
    let withdrawn = send(&app, "DELETE", &posts, budi.writes(), None).await;
    assert_eq!(withdrawn.status, StatusCode::OK, "{:?}", withdrawn.body);
    assert_eq!(withdrawn.body["body"], "");
    assert!(!withdrawn.body["withdrawn_at"].is_null());
    assert_eq!(withdrawn.body["reactions"], json!([]));
    let after = send(
        &app,
        "GET",
        &format!("/api/v1/discussions/{thread}"),
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(after.body["status"], "open");
    assert_eq!(after.body["has_solution"], json!(false));
    assert_eq!(after.body["reply_count"], json!(0));
    assert_eq!(
        send(
            &app,
            "GET",
            &format!("{posts}/revisions"),
            sari.reads(),
            None
        )
        .await
        .status,
        StatusCode::NOT_FOUND,
        "a withdrawn post's history went with its words"
    );

    // ── muting means nothing reaches you ────────────────────────────────
    let muted = send(
        &app,
        "POST",
        &format!("/api/v1/discussions/{thread}/subscription"),
        budi.writes(),
        Some(json!({ "level": "muted" })),
    )
    .await;
    assert_eq!(muted.body["level"], "muted");
    let before = told(&app, &budi).await.len();
    let again = send(
        &app,
        "POST",
        &format!("/api/v1/discussions/{thread}/posts"),
        sari.writes(),
        Some(json!({ "body": "Oke, @budi.spv makasih.", "attachments": [] })),
    )
    .await;
    assert_eq!(again.status, StatusCode::CREATED, "{:?}", again.body);
    assert_eq!(
        told(&app, &budi).await.len(),
        before,
        "muted, even when named"
    );

    // ── head office pins; nobody else can ───────────────────────────────
    let pin = format!("/api/v1/discussions/{thread}/pin");
    assert_eq!(
        send(
            &app,
            "POST",
            &pin,
            sari.writes(),
            Some(json!({ "pinned": true }))
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    let later = send(
        &app,
        "POST",
        "/api/v1/discussions",
        budi.writes(),
        Some(json!({
            "subject_kind": "supplier", "subject_id": "SUP-0001", "subject_note": null,
            "title": "Supplier baru", "body": "Siapa yang pegang?"
        })),
    )
    .await;
    assert_eq!(later.status, StatusCode::CREATED, "{:?}", later.body);
    let pinned = send(
        &app,
        "POST",
        &pin,
        admin.writes(),
        Some(json!({ "pinned": true })),
    )
    .await;
    assert_eq!(pinned.status, StatusCode::OK, "{:?}", pinned.body);
    assert!(!pinned.body["pinned_at"].is_null());
    let board = send(&app, "GET", "/api/v1/discussions", sari.reads(), None).await;
    assert_eq!(
        ids(&board.body).first(),
        Some(&thread),
        "the pinned thread leads the board even though another moved later"
    );

    // ── a locked thread takes nothing more ──────────────────────────────
    let locked = send(
        &app,
        "POST",
        &format!("/api/v1/discussions/{thread}/status"),
        sari.writes(),
        Some(json!({ "status": "locked" })),
    )
    .await;
    assert_eq!(locked.body["status"], "locked");
    assert_eq!(
        send(
            &app,
            "POST",
            &format!("/api/v1/discussions/{thread}/posts"),
            budi.writes(),
            Some(json!({ "body": "satu lagi", "attachments": [] })),
        )
        .await
        .status,
        StatusCode::CONFLICT
    );
    assert_eq!(
        send(
            &app,
            "POST",
            &solution,
            sari.writes(),
            Some(json!({ "post_id": null })),
        )
        .await
        .status,
        StatusCode::CONFLICT,
        "marking an answer would quietly unlock it"
    );

    // ── the opener retitles, and the tags follow ────────────────────────
    let retitled = send(
        &app,
        "PATCH",
        &format!("/api/v1/discussions/{thread}"),
        sari.writes(),
        Some(json!({ "title": "Harga kemeja naik — sudah dijawab", "subject_note": null, "tags": ["harga"] })),
    )
    .await;
    assert_eq!(retitled.status, StatusCode::OK, "{:?}", retitled.body);
    assert_eq!(retitled.body["tags"], json!(["harga"]));
    assert_eq!(retitled.body["subject_id"], "PO-2609-0001", "not moved");

    // ── opened on the wrong order, moved to the right one ───────────────
    let half = send(
        &app,
        "PATCH",
        &format!("/api/v1/discussions/{thread}"),
        sari.writes(),
        Some(json!({ "title": "x", "subject_note": null, "tags": [], "subject_kind": "purchase_order" })),
    )
    .await;
    assert_eq!(
        half.status,
        StatusCode::BAD_REQUEST,
        "a kind without a record is no move"
    );
    assert_eq!(
        send(
            &app,
            "PATCH",
            &format!("/api/v1/discussions/{thread}"),
            budi.writes(),
            Some(json!({
                "title": "x", "subject_note": null, "tags": [],
                "subject_kind": "purchase_order", "subject_id": "PO-2609-0002"
            })),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "only the opener or head office moves a thread"
    );
    let moved = send(
        &app,
        "PATCH",
        &format!("/api/v1/discussions/{thread}"),
        sari.writes(),
        Some(json!({
            "title": "Harga kemeja naik — sudah dijawab", "subject_note": null, "tags": ["harga"],
            "subject_kind": "purchase_order", "subject_id": "PO-2609-0002"
        })),
    )
    .await;
    assert_eq!(moved.status, StatusCode::OK, "{:?}", moved.body);
    assert_eq!(moved.body["subject_id"], "PO-2609-0002");
    let on_new_record = send(
        &app,
        "GET",
        "/api/v1/discussions?subject_kind=purchase_order&subject_id=PO-2609-0002",
        sari.reads(),
        None,
    )
    .await;
    assert_eq!(ids(&on_new_record.body), vec![thread.clone()]);
    assert!(!retitled.body["edited_at"].is_null());
    let tags = send(&app, "GET", "/api/v1/discussions/tags", sari.reads(), None).await;
    assert_eq!(tags.body, json!([{ "tag": "harga", "threads": 1 }]));

    // ── "mark all read" catches up on what was opened, and only that ────
    // Budi read up to his own reply; Sari's thank-you came after it.
    let unread = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=unread",
        budi.reads(),
        None,
    )
    .await;
    assert_eq!(ids(&unread.body), vec![thread.clone()]);
    let dismissed = send(
        &app,
        "POST",
        "/api/v1/discussions/read",
        budi.writes(),
        Some(json!({})),
    )
    .await;
    assert_eq!(dismissed.status, StatusCode::OK, "{:?}", dismissed.body);
    assert_eq!(dismissed.body["threads"], json!(1));
    let unread = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=unread",
        budi.reads(),
        None,
    )
    .await;
    assert!(ids(&unread.body).is_empty(), "{:?}", unread.body);
    // Admin never opened Budi's supplier thread, and dismissing does not
    // pretend otherwise: it is still New, and nobody new has "read it".
    send(
        &app,
        "POST",
        "/api/v1/discussions/read",
        admin.writes(),
        Some(json!({})),
    )
    .await;
    let fresh = send(
        &app,
        "GET",
        "/api/v1/discussions?feed=new",
        admin.reads(),
        None,
    )
    .await;
    assert!(ids(&fresh.body).contains(
        &later.body["thread_id"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    ));
}
