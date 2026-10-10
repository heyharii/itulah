//! Chat over HTTP: a conversation people can actually talk in.
//!
//! Driven through the router with real sessions, because every rule here is a
//! rule about WHO — the author edits, an admin moderates, a stranger is told
//! the room does not exist — and a test that called the store directly would
//! prove none of that is wired to a signed-in person.
//!
//! Three tests carry the file. **The thread** — replies, idempotent sends,
//! mentions, edits, reactions, pins, deletions that keep their place, read
//! marks that are everybody else's "seen", search that never reaches a room
//! you are not in, and paging back through history without a gap. **The
//! group** — it writes its own history, it is never left without an admin,
//! and it is gone when the last person leaves. And **the phone** — a direct
//! message or your name buzzes it, a group's small talk and a muted room do
//! not.

use axum::body::{to_bytes, Body};
use http::{header, Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, postgres as cloud, AppConfig, AppState};
use inventory_backend::security;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;

const ADMIN_PASSWORD: &str = "admin-password-chat-1";
const CASHIER_PASSWORD: &str = "cashier-password-chat-1";

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
        node_id: "cloud-chat-test".into(),
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

async fn create_user(app: &axum::Router, cookies: &str, csrf: &str, username: &str, name: &str) {
    let created = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        write_headers(cookies, csrf),
        Some(json!({
            "username": username,
            "display_name": name,
            "password": CASHIER_PASSWORD,
            "role": "CASHIER",
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

struct Person {
    cookies: String,
    csrf: String,
}

impl Person {
    fn write(&self) -> Vec<(String, String)> {
        write_headers(&self.cookies, &self.csrf)
    }
    fn read(&self) -> Vec<(String, String)> {
        read_headers(&self.cookies)
    }
}

/// Admin, and three cashiers with display names.
async fn office(pool: &PgPool) -> (axum::Router, Person, Person, Person, Person) {
    cloud::bootstrap_admin(pool, Some(ADMIN_PASSWORD), true)
        .await
        .unwrap_or_else(|error| panic!("bootstrap: {error}"));
    let app = cloud_http::router(AppState::new(pool.clone(), config()));
    let (cookies, csrf) = sign_in(&app, "admin", ADMIN_PASSWORD).await;
    create_user(&app, &cookies, &csrf, "sari", "Sari M").await;
    create_user(&app, &cookies, &csrf, "budi", "Budi S").await;
    create_user(&app, &cookies, &csrf, "tono", "Tono").await;
    let admin = Person { cookies, csrf };
    let (cookies, csrf) = sign_in(&app, "sari", CASHIER_PASSWORD).await;
    let sari = Person { cookies, csrf };
    let (cookies, csrf) = sign_in(&app, "budi", CASHIER_PASSWORD).await;
    let budi = Person { cookies, csrf };
    let (cookies, csrf) = sign_in(&app, "tono", CASHIER_PASSWORD).await;
    let tono = Person { cookies, csrf };
    (app, admin, sari, budi, tono)
}

async fn say(
    app: &axum::Router,
    who: &Person,
    room: &str,
    body: &str,
    key: &str,
    reply_to: Option<i64>,
) -> Response {
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{room}/messages"),
        who.write(),
        Some(json!({
            "body": body,
            "idempotency_key": key,
            "reply_to_seq": reply_to,
            "attachments": [],
        })),
    )
    .await
}

fn seqs(body: &Value) -> Vec<i64> {
    body.as_array()
        .unwrap_or_else(|| panic!("not a list: {body}"))
        .iter()
        .map(|message| message["seq"].as_i64().unwrap_or_else(|| panic!("seq")))
        .collect()
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_thread_carries_replies_edits_reactions_pins_and_deletions(pool: PgPool) {
    let (app, admin, sari, budi, _tono) = office(&pool).await;

    // A direct room is named by the other person, and asking twice is the
    // same room rather than a second one.
    let started = send(
        app.clone(),
        "POST",
        "/api/v1/chat/conversations",
        sari.write(),
        Some(json!({ "kind": "DIRECT", "title": null, "participants": ["budi"] })),
    )
    .await;
    assert_eq!(started.status, StatusCode::CREATED, "{:?}", started.body);
    assert_eq!(started.body["title"], json!("Budi S"));
    let room = started.body["conversation_id"]
        .as_str()
        .unwrap_or_else(|| panic!("id"))
        .to_string();
    let again = send(
        app.clone(),
        "POST",
        "/api/v1/chat/conversations",
        sari.write(),
        Some(json!({ "kind": "DIRECT", "title": null, "participants": ["budi"] })),
    )
    .await;
    assert_eq!(again.body["conversation_id"], json!(room));

    // Sending twice with one key writes once. The mention is resolved
    // against the room, whatever case it was typed in.
    let first = say(&app, &sari, &room, "halo @BUDI, cek PO-2607", "k-1", None).await;
    assert_eq!(first.status, StatusCode::CREATED, "{:?}", first.body);
    assert_eq!(first.body["seq"], json!(1));
    assert_eq!(first.body["mentions"], json!(["budi"]));
    assert_eq!(first.body["author_name"], json!("Sari M"));
    let resent = say(&app, &sari, &room, "halo @BUDI, cek PO-2607", "k-1", None).await;
    assert_eq!(resent.body["seq"], json!(1));
    assert_eq!(resent.body["message_id"], first.body["message_id"]);

    let listed = send(
        app.clone(),
        "GET",
        "/api/v1/chat/conversations",
        budi.read(),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK);
    assert_eq!(listed.body[0]["title"], json!("Sari M"));
    assert_eq!(listed.body[0]["unread_count"], json!(1));
    assert_eq!(listed.body[0]["mention_count"], json!(1));
    assert_eq!(listed.body[0]["preview_author"], json!("Sari M"));

    // Reading moves the mark, and moving it is announced — it is everybody
    // else's "seen".
    let marked = send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{room}/read"),
        budi.write(),
        Some(json!({ "last_read_seq": 1 })),
    )
    .await;
    assert_eq!(marked.status, StatusCode::OK, "{:?}", marked.body);
    assert_eq!(marked.body["unread_count"], json!(0));
    assert_eq!(marked.body["mention_count"], json!(0));

    // A reply carries the line it answers; a reply to nothing is refused.
    let reply = say(&app, &budi, &room, "siap, sudah dicek", "k-2", Some(1)).await;
    assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.body);
    assert_eq!(reply.body["reply_to"]["author"], json!("sari"));
    assert_eq!(reply.body["reply_to"]["deleted"], json!(false));
    let nowhere = say(&app, &budi, &room, "ke mana?", "k-3", Some(99)).await;
    assert_eq!(nowhere.status, StatusCode::BAD_REQUEST);

    // Only the author edits, and an edit re-reads the mentions.
    let hijack = send(
        app.clone(),
        "PATCH",
        &format!("/api/v1/chat/conversations/{room}/messages/1"),
        budi.write(),
        Some(json!({ "body": "bukan kata-kata saya" })),
    )
    .await;
    assert_eq!(hijack.status, StatusCode::FORBIDDEN);
    let edited = send(
        app.clone(),
        "PATCH",
        &format!("/api/v1/chat/conversations/{room}/messages/1"),
        sari.write(),
        Some(json!({ "body": "halo, cek PO-2607 ya" })),
    )
    .await;
    assert_eq!(edited.status, StatusCode::OK, "{:?}", edited.body);
    assert_eq!(edited.body["body"], json!("halo, cek PO-2607 ya"));
    assert_ne!(edited.body["edited_at"], Value::Null);
    assert_eq!(edited.body["mentions"], json!([]));

    // Reactions are stated, not toggled: on twice is on once.
    for _ in 0..2 {
        let on = send(
            app.clone(),
            "POST",
            &format!("/api/v1/chat/conversations/{room}/messages/1/reactions"),
            budi.write(),
            Some(json!({ "emoji": "👍", "on": true })),
        )
        .await;
        assert_eq!(on.status, StatusCode::OK, "{:?}", on.body);
        assert_eq!(
            on.body["reactions"],
            json!([{ "emoji": "👍", "users": ["budi"] }])
        );
    }
    let words = send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{room}/messages/1/reactions"),
        budi.write(),
        Some(json!({ "emoji": "ok", "on": true })),
    )
    .await;
    assert_eq!(words.status, StatusCode::BAD_REQUEST);

    // Pinned for the room, and listed as such.
    let pinned = send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{room}/messages/1/pin"),
        budi.write(),
        Some(json!({ "pinned": true })),
    )
    .await;
    assert_eq!(pinned.status, StatusCode::OK, "{:?}", pinned.body);
    assert_eq!(pinned.body["pinned_by"], json!("budi"));
    let pins = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/pins"),
        sari.read(),
        None,
    )
    .await;
    assert_eq!(seqs(&pins.body), vec![1]);

    // Deleting keeps the place and takes the words, the pin and the
    // reactions. The reply that quoted it now says so.
    let not_yours = send(
        app.clone(),
        "DELETE",
        &format!("/api/v1/chat/conversations/{room}/messages/1"),
        budi.write(),
        None,
    )
    .await;
    assert_eq!(not_yours.status, StatusCode::FORBIDDEN);
    let deleted = send(
        app.clone(),
        "DELETE",
        &format!("/api/v1/chat/conversations/{room}/messages/1"),
        sari.write(),
        None,
    )
    .await;
    assert_eq!(deleted.status, StatusCode::OK, "{:?}", deleted.body);
    assert_eq!(deleted.body["seq"], json!(1));
    assert_eq!(deleted.body["body"], json!(""));
    assert_ne!(deleted.body["deleted_at"], Value::Null);
    assert_eq!(deleted.body["pinned_at"], Value::Null);
    assert_eq!(deleted.body["reactions"], json!([]));
    let pins = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/pins"),
        sari.read(),
        None,
    )
    .await;
    assert_eq!(seqs(&pins.body), Vec::<i64>::new());
    let thread = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/messages"),
        sari.read(),
        None,
    )
    .await;
    assert_eq!(seqs(&thread.body), vec![1, 2]);
    assert_eq!(thread.body[1]["reply_to"]["deleted"], json!(true));
    assert_eq!(thread.body[1]["reply_to"]["body"], json!(""));

    // Budi's read mark is Sari's "seen": his own reply carried it to 2.
    let seen = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}"),
        sari.read(),
        None,
    )
    .await;
    let budi_mark = seen.body["members"]
        .as_array()
        .unwrap_or_else(|| panic!("members"))
        .iter()
        .find(|member| member["username"] == json!("budi"))
        .map(|member| member["last_read_seq"].clone());
    assert_eq!(budi_mark, Some(json!(2)));
    let kinds: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT kind FROM collaboration_event WHERE conversation_id = $1::uuid ORDER BY kind",
    )
    .bind(&room)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("events: {error}"));
    assert_eq!(kinds, vec!["chat.message", "chat.read", "chat.update"]);
    // Marking again is not a second announcement.
    let before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM collaboration_event WHERE kind = 'chat.read'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{room}/read"),
        budi.write(),
        Some(json!({ "last_read_seq": 50 })),
    )
    .await;
    let after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM collaboration_event WHERE kind = 'chat.read'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(before, after);

    // Search reaches the rooms you are in and no others; a stranger is told
    // the room does not exist at all.
    let found = send(
        app.clone(),
        "GET",
        "/api/v1/chat/search?q=SUDAH",
        sari.read(),
        None,
    )
    .await;
    assert_eq!(found.status, StatusCode::OK);
    assert_eq!(found.body.as_array().map(Vec::len), Some(1));
    assert_eq!(found.body[0]["conversation_title"], json!("Budi S"));
    let outsider = send(
        app.clone(),
        "GET",
        "/api/v1/chat/search?q=sudah",
        admin.read(),
        None,
    )
    .await;
    assert_eq!(outsider.body.as_array().map(Vec::len), Some(0));
    let wildcard = send(
        app.clone(),
        "GET",
        "/api/v1/chat/search?q=%25%25",
        sari.read(),
        None,
    )
    .await;
    assert_eq!(wildcard.body.as_array().map(Vec::len), Some(0));
    let stranger = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}"),
        admin.read(),
        None,
    )
    .await;
    assert_eq!(stranger.status, StatusCode::NOT_FOUND);

    // "Typing" is somebody else's, never your own.
    let typing = send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{room}/typing"),
        sari.write(),
        Some(json!({})),
    )
    .await;
    assert_eq!(typing.status, StatusCode::NO_CONTENT);
    let theirs = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/typing"),
        budi.read(),
        None,
    )
    .await;
    assert_eq!(theirs.body, json!(["sari"]));
    let mine = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/typing"),
        sari.read(),
        None,
    )
    .await;
    assert_eq!(mine.body, json!([]));

    // Scrolling back: the newest page, then the one before it, with no gap
    // and no overlap between them.
    for index in 0..60 {
        let line = say(
            &app,
            &sari,
            &room,
            &format!("baris {index}"),
            &format!("page-{index}"),
            None,
        )
        .await;
        assert_eq!(line.status, StatusCode::CREATED);
    }
    let latest = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/messages"),
        sari.read(),
        None,
    )
    .await;
    let latest = seqs(&latest.body);
    assert_eq!(latest, (13..=62).collect::<Vec<_>>());
    let older = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/messages?before=13&limit=50"),
        sari.read(),
        None,
    )
    .await;
    assert_eq!(seqs(&older.body), (1..=12).collect::<Vec<_>>());
    let since = send(
        app.clone(),
        "GET",
        &format!("/api/v1/chat/conversations/{room}/messages?after=60"),
        sari.read(),
        None,
    )
    .await;
    assert_eq!(seqs(&since.body), vec![61, 62]);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_group_writes_its_own_history_and_keeps_an_admin(pool: PgPool) {
    let (app, _admin, sari, budi, tono) = office(&pool).await;

    let started = send(
        app.clone(),
        "POST",
        "/api/v1/chat/conversations",
        sari.write(),
        Some(json!({ "kind": "GROUP", "title": "Receiving DC-01", "participants": ["budi"] })),
    )
    .await;
    assert_eq!(started.status, StatusCode::CREATED, "{:?}", started.body);
    assert_eq!(started.body["is_admin"], json!(true));
    assert_eq!(started.body["latest_message_seq"], json!(1));
    assert_eq!(
        started.body["preview"],
        json!("Sari M created the group “Receiving DC-01”")
    );
    assert_eq!(started.body["preview_author"], Value::Null);
    let room = started.body["conversation_id"]
        .as_str()
        .unwrap_or_else(|| panic!("id"))
        .to_string();
    let path = format!("/api/v1/chat/conversations/{room}");

    // A line the room wrote about itself cannot be edited or deleted.
    let system_edit = send(
        app.clone(),
        "PATCH",
        &format!("{path}/messages/1"),
        sari.write(),
        Some(json!({ "body": "rewritten history" })),
    )
    .await;
    assert_eq!(system_edit.status, StatusCode::FORBIDDEN);

    // Only an admin renames, adds and removes.
    let renamed_by_member = send(
        app.clone(),
        "PATCH",
        &path,
        budi.write(),
        Some(json!({ "title": "Budi's room" })),
    )
    .await;
    assert_eq!(renamed_by_member.status, StatusCode::FORBIDDEN);
    let renamed = send(
        app.clone(),
        "PATCH",
        &path,
        sari.write(),
        Some(json!({ "title": "Receiving DC-02" })),
    )
    .await;
    assert_eq!(renamed.status, StatusCode::OK, "{:?}", renamed.body);
    assert_eq!(renamed.body["title"], json!("Receiving DC-02"));
    assert_eq!(
        renamed.body["preview"],
        json!("Sari M renamed the group to “Receiving DC-02”")
    );

    let added = send(
        app.clone(),
        "POST",
        &format!("{path}/participants"),
        sari.write(),
        Some(json!({ "participants": ["tono", "nobody-here"] })),
    )
    .await;
    assert_eq!(
        added.status,
        StatusCode::BAD_REQUEST,
        "an unknown name is refused"
    );
    let added = send(
        app.clone(),
        "POST",
        &format!("{path}/participants"),
        sari.write(),
        Some(json!({ "participants": ["tono"] })),
    )
    .await;
    assert_eq!(added.status, StatusCode::OK, "{:?}", added.body);
    assert_eq!(added.body["participants"], json!(["budi", "sari", "tono"]));
    // Tono joins reading from the line that says he was added.
    let his = send(app.clone(), "GET", &path, tono.read(), None).await;
    assert_eq!(his.body["unread_count"], json!(1));
    let history = send(
        app.clone(),
        "GET",
        &format!("{path}/messages"),
        tono.read(),
        None,
    )
    .await;
    assert_eq!(
        seqs(&history.body),
        vec![1, 2, 3],
        "the history before him is his to read"
    );

    let removed_by_member = send(
        app.clone(),
        "DELETE",
        &format!("{path}/participants/tono"),
        budi.write(),
        None,
    )
    .await;
    assert_eq!(removed_by_member.status, StatusCode::FORBIDDEN);

    // Preferences are the reader's own.
    let muted = send(
        app.clone(),
        "PUT",
        &format!("{path}/preferences"),
        budi.write(),
        Some(json!({ "muted": true, "pinned": true, "archived": null })),
    )
    .await;
    assert_eq!(muted.status, StatusCode::OK, "{:?}", muted.body);
    assert_eq!(muted.body["muted"], json!(true));
    assert_eq!(muted.body["pinned"], json!(true));
    assert_eq!(muted.body["archived"], json!(false));
    let hers = send(app.clone(), "GET", &path, sari.read(), None).await;
    assert_eq!(hers.body["muted"], json!(false));
    // Archived-and-not-muted comes back when somebody writes.
    send(
        app.clone(),
        "PUT",
        &format!("{path}/preferences"),
        tono.write(),
        Some(json!({ "muted": null, "pinned": null, "archived": true })),
    )
    .await;
    let line = say(&app, &sari, &room, "@all stock opname jam 4", "g-1", None).await;
    assert_eq!(line.status, StatusCode::CREATED, "{:?}", line.body);
    assert_eq!(line.body["mentions"], json!(["budi", "tono"]));
    let back = send(app.clone(), "GET", &path, tono.read(), None).await;
    assert_eq!(back.body["archived"], json!(false));
    assert_eq!(back.body["mention_count"], json!(1));

    // An admin makes another; the last one out hands over; the room is never
    // without one.
    let promoted = send(
        app.clone(),
        "PATCH",
        &format!("{path}/participants/budi"),
        sari.write(),
        Some(json!({ "is_admin": true })),
    )
    .await;
    assert_eq!(promoted.status, StatusCode::OK, "{:?}", promoted.body);
    let left = send(
        app.clone(),
        "DELETE",
        &format!("{path}/participants/sari"),
        sari.write(),
        None,
    )
    .await;
    assert_eq!(left.status, StatusCode::NO_CONTENT, "{:?}", left.body);
    let gone = send(app.clone(), "GET", &path, sari.read(), None).await;
    assert_eq!(gone.status, StatusCode::NOT_FOUND);
    let after_leaving = send(app.clone(), "GET", &path, budi.read(), None).await;
    assert_eq!(after_leaving.body["preview"], json!("Sari M left"));
    assert_eq!(after_leaving.body["is_admin"], json!(true));

    let lone_admin = send(
        app.clone(),
        "PATCH",
        &format!("{path}/participants/budi"),
        budi.write(),
        Some(json!({ "is_admin": false })),
    )
    .await;
    assert_eq!(lone_admin.status, StatusCode::CONFLICT);

    let removed = send(
        app.clone(),
        "DELETE",
        &format!("{path}/participants/tono"),
        budi.write(),
        None,
    )
    .await;
    assert_eq!(removed.status, StatusCode::OK, "{:?}", removed.body);
    assert_eq!(removed.body["participants"], json!(["budi"]));
    let told: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM collaboration_event
          WHERE kind = 'chat.room' AND conversation_id = $1::uuid AND 'tono' = ANY(audience)",
    )
    .bind(&room)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("events: {error}"));
    assert!(told >= 1, "somebody removed is told the room changed");

    // The last one out takes the room with them.
    let last = send(
        app.clone(),
        "DELETE",
        &format!("{path}/participants/budi"),
        budi.write(),
        None,
    )
    .await;
    assert_eq!(last.status, StatusCode::NO_CONTENT);
    let remaining: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chat_conversation WHERE conversation_id = $1::uuid",
    )
    .bind(&room)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"));
    assert_eq!(remaining, 0);

    // A direct room is not left; it is archived.
    let direct = send(
        app.clone(),
        "POST",
        "/api/v1/chat/conversations",
        sari.write(),
        Some(json!({ "kind": "DIRECT", "title": null, "participants": ["tono"] })),
    )
    .await;
    let direct_id = direct.body["conversation_id"]
        .as_str()
        .unwrap_or_else(|| panic!("id"))
        .to_string();
    let refused = send(
        app.clone(),
        "DELETE",
        &format!("/api/v1/chat/conversations/{direct_id}/participants/sari"),
        sari.write(),
        None,
    )
    .await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);
}

/// A phone that said yes to push, for one person.
async fn subscribe(pool: &PgPool, username: &str) {
    sqlx::query(
        "INSERT INTO push_subscription (username, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(username)
    .bind(format!(
        "https://fcm.googleapis.com/fcm/send/{username}-device"
    ))
    .bind("B".repeat(87))
    .bind("a".repeat(22))
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("subscribe {username}: {error}"));
}

async fn queued_for(pool: &PgPool, username: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM push_delivery WHERE username = $1 AND conversation_id IS NOT NULL",
    )
    .bind(username)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_direct_message_or_your_name_reaches_the_phone(pool: PgPool) {
    let (app, _admin, sari, budi, _tono) = office(&pool).await;
    subscribe(&pool, "budi").await;
    subscribe(&pool, "tono").await;

    let direct = send(
        app.clone(),
        "POST",
        "/api/v1/chat/conversations",
        sari.write(),
        Some(json!({ "kind": "DIRECT", "title": null, "participants": ["budi"] })),
    )
    .await;
    let direct = direct.body["conversation_id"]
        .as_str()
        .unwrap_or_else(|| panic!("id"))
        .to_string();
    let group = send(
        app.clone(),
        "POST",
        "/api/v1/chat/conversations",
        sari.write(),
        Some(json!({ "kind": "GROUP", "title": "Gudang", "participants": ["budi", "tono"] })),
    )
    .await;
    let group = group.body["conversation_id"]
        .as_str()
        .unwrap_or_else(|| panic!("id"))
        .to_string();

    // A direct message buzzes; a resend of it does not buzz twice.
    say(&app, &sari, &direct, "sudah sampai?", "p-1", None).await;
    say(&app, &sari, &direct, "sudah sampai?", "p-1", None).await;
    assert_eq!(queued_for(&pool, "budi").await, 1);

    // Small talk in a group does not; naming somebody does, and only them.
    say(&app, &sari, &group, "pagi semua", "p-2", None).await;
    assert_eq!(queued_for(&pool, "budi").await, 1);
    assert_eq!(queued_for(&pool, "tono").await, 0);
    say(&app, &sari, &group, "@tono tolong cek rak B", "p-3", None).await;
    assert_eq!(queued_for(&pool, "tono").await, 1);
    assert_eq!(queued_for(&pool, "budi").await, 1);

    // Muted means quiet — unless you are named.
    send(
        app.clone(),
        "PUT",
        &format!("/api/v1/chat/conversations/{direct}/preferences"),
        budi.write(),
        Some(json!({ "muted": true, "pinned": null, "archived": null })),
    )
    .await;
    say(&app, &sari, &direct, "masih di situ?", "p-4", None).await;
    assert_eq!(queued_for(&pool, "budi").await, 1);
    say(&app, &sari, &direct, "@budi penting", "p-5", None).await;
    assert_eq!(queued_for(&pool, "budi").await, 2);

    // What the worker sends: the room as the subject, the sender as the
    // title of a direct message, and the room's id as the tag. A message
    // already read on another device is claimed as read, so it is skipped.
    send(
        app.clone(),
        "POST",
        &format!("/api/v1/chat/conversations/{direct}/read"),
        budi.write(),
        Some(json!({ "last_read_seq": 1 })),
    )
    .await;
    let due = cloud::claim_push_deliveries(&pool, 50)
        .await
        .unwrap_or_else(|error| panic!("claim: {error}"));
    let to_budi: Vec<_> = due
        .iter()
        .filter(|delivery| delivery.subject_id.as_deref() == Some(direct.as_str()))
        .collect();
    assert_eq!(to_budi.len(), 2);
    for delivery in &to_budi {
        assert_eq!(delivery.kind, "chat.message");
        assert_eq!(delivery.title, "Sari M");
        assert_eq!(delivery.subject_kind.as_deref(), Some("conversation"));
        assert_eq!(delivery.notification_id.to_string(), direct);
    }
    let first = to_budi
        .iter()
        .find(|delivery| delivery.body == "sudah sampai?")
        .unwrap_or_else(|| panic!("the first message"));
    assert!(first.read, "read on another device before it went out");
    let named = to_budi
        .iter()
        .find(|delivery| delivery.body == "@budi penting")
        .unwrap_or_else(|| panic!("the mention"));
    assert!(!named.read);
    let to_tono = due
        .iter()
        .find(|delivery| delivery.subject_id.as_deref() == Some(group.as_str()))
        .unwrap_or_else(|| panic!("the group mention"));
    assert_eq!(to_tono.title, "Gudang");
    assert_eq!(to_tono.body, "Sari M: @tono tolong cek rak B");
}
