//! Sealing a month, and what it takes to be allowed to.
//!
//! The old close flipped a row. These tests are about the checklist that now
//! stands in front of it, so most of them are shaped the same way: put the
//! books in a state a real month gets into, ask to close, and read the refusal.
//!
//! # Why the integrity slot is stood in for
//!
//! `integrity.equations` ships critical and Pending, because the engine that
//! answers it lands on another branch (see `postgres::period_close`). Left
//! alone, every close in this file would be refused for a reason that has
//! nothing to do with what is being tested.
//!
//! So the file registers a stand-in under that key — which is exactly the
//! mechanism a later lane uses, exercised here as a side effect — and the
//! stand-in reads its verdict from a table. `sqlx::test` hands every test its
//! own database, so a test that wants BLOCKED creates the table and says so,
//! and no other test can see it. The registry is process-global and these tests
//! run concurrently; putting the state in the database rather than in a static
//! is what makes that safe.

use inventory_backend::cloud::application::{AppConfig, AppError, AppState, CreateUserRequest};
use inventory_backend::cloud::domain::{CheckOutcome, ClosePeriod, Role};
use inventory_backend::cloud::http as cloud_http;
use inventory_backend::cloud::postgres::{self as cloud, CloseCheck};

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use chrono::NaiveDate;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Once;
use tower::ServiceExt;

const ACTOR: &str = "ana";
const SECOND: &str = "budi";

// ---------------------------------------------------------------------------
// The stand-in for the integrity engine
// ---------------------------------------------------------------------------

/// What the stand-in reports, read from the test's own database.
///
/// Absent table — which is every test that does not ask — means the equations
/// balance. `unwrap_or(None)` rather than a `to_regclass` probe because the
/// failure mode and the empty case want the same answer, and one branch is
/// easier to be sure of than two.
async fn stand_in(pool: &PgPool, _period: ClosePeriod) -> Result<CheckOutcome, AppError> {
    let state: Option<String> = sqlx::query_scalar("SELECT state FROM test_integrity_verdict")
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    Ok(match state.as_deref() {
        Some("BLOCKED") => CheckOutcome::blocked("the trial balance does not foot"),
        Some("EXCEPTION") => CheckOutcome::failed(1, vec![]),
        _ => CheckOutcome::Pass,
    })
}

/// Registering a check, which is the thing the module header promises a later
/// lane can do. If this stops compiling, that promise has been broken.
fn install_stand_in() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        cloud::period_close_register(CloseCheck {
            key: "integrity.equations",
            title: "Every integrity equation balances",
            critical: true,
            evaluate: |pool, period| Box::pin(stand_in(pool, period)),
        });
    });
}

async fn say_the_books_are(pool: &PgPool, state: &str) {
    sqlx::query("CREATE TABLE test_integrity_verdict (state text NOT NULL)")
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("create verdict table: {error}"));
    sqlx::query("INSERT INTO test_integrity_verdict (state) VALUES ($1)")
        .bind(state)
        .execute(pool)
        .await
        .unwrap_or_else(|error| panic!("set verdict: {error}"));
}

// ---------------------------------------------------------------------------
// A chart small enough to read
// ---------------------------------------------------------------------------

async fn seed_chart(pool: &PgPool) {
    // Nothing to mint: 0289 installs the forty, so what is left is the map.
    for (key, code, category) in [
        ("inventory", "1301", Some("MERCHANDISE")),
        ("trade_payable", "2101", None),
    ] {
        cloud::set_account_mapping(
            pool,
            &cloud::SetAccountMappingRequest {
                semantic_key: key.into(),
                site_id: "dc".into(),
                qualifier: String::new(),
                account_code: code.into(),
                category_code: category.map(str::to_string),
                note: None,
            },
            ACTOR,
        )
        .await
        .unwrap_or_else(|error| panic!("map {key}: {error}"));
    }
}

fn september(day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, day).unwrap_or_else(|| panic!("bad date"))
}

async fn open_september(pool: &PgPool) {
    cloud::open_period(pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("open september: {error}"));
}

async fn draft_a_bill(pool: &PgPool, number: &str) -> uuid::Uuid {
    cloud::record_bill(
        pool,
        &cloud::RecordBillRequest {
            invoice_number: number.into(),
            supplier_id: "SUP01".into(),
            supplier_name: Some("PT Sinar Jaya".into()),
            site_id: "dc".into(),
            invoice_date: september(4),
            due_date: Some(september(30)),
            subtotal_minor: 3_000_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: None,
            lines: None,
            matching: None,
            withholding_code: None,
            receipt_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record {number}: {error}"))
    .invoice_id
}

/// What a person is shown. A trigger's `RAISE EXCEPTION` reaches the browser
/// verbatim as a 409; `to_string()` on the wrapper would not.
fn as_shown_to_a_person(error: &AppError) -> String {
    match error {
        AppError::Database(sqlx::Error::Database(db)) if db.code().as_deref() == Some("P0001") => {
            db.message().to_string()
        }
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// The close
// ---------------------------------------------------------------------------

/// A month with a bill still in draft does not close, and says which control
/// stopped it.
///
/// Naming the check rather than counting them is the whole of the difference
/// between a refusal somebody can act on and one they have to go and decode.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_draft_bill_refuses_the_close_and_the_refusal_names_the_check(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;
    let invoice = draft_a_bill(&pool, "INV-9001").await;

    let verdict = cloud::period_checklist(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("checklist: {error}"));
    assert!(!verdict.may_close);
    assert!(
        verdict.blocked_by.contains(&"documents.drafts".to_string()),
        "the draft bill is what stands in the way: {:?}",
        verdict.blocked_by
    );

    let refusal = cloud::period_close(&pool, 2026, 9, ACTOR, None)
        .await
        .expect_err("a month with a draft bill in it must not close");
    let shown = as_shown_to_a_person(&refusal);
    assert!(
        shown.contains("documents.drafts"),
        "the refusal names the control: {shown}"
    );
    assert!(shown.contains("2026-09"), "and the month: {shown}");

    // Nothing was sealed on the way out.
    let status: String =
        sqlx::query_scalar("SELECT status FROM fiscal_period WHERE year=2026 AND month=9")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(status, "OPEN", "a refused close leaves the month open");
    assert!(
        cloud::period_events(&pool, 2026, 9)
            .await
            .unwrap_or_else(|error| panic!("events: {error}"))
            .is_empty(),
        "a refused close is not an event; nothing happened"
    );

    // And once the bill is posted, the same month closes.
    cloud::post_bill(&pool, invoice, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post bill: {error}"));
    let outcome = cloud::period_close(&pool, 2026, 9, ACTOR, Some("month end"))
        .await
        .unwrap_or_else(|error| panic!("close: {}", as_shown_to_a_person(&error)));
    assert!(outcome.checklist.may_close);
    assert_eq!(
        outcome.entries_sealed, 1,
        "the bill's entry is in the month"
    );
}

/// The checklist that permitted a close is stored against it.
///
/// Six months later "was the bank reconciled when September closed?" has to
/// have an answer that is not somebody's memory of a screen.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_close_keeps_the_checklist_that_let_it_through(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;

    cloud::period_close(&pool, 2026, 9, ACTOR, Some("nothing to do"))
        .await
        .unwrap_or_else(|error| panic!("close: {}", as_shown_to_a_person(&error)));

    let events = cloud::period_events(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("events: {error}"));
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event, "CLOSE");
    assert_eq!(events[0].actor, ACTOR);
    let snapshot = events[0]
        .checklist
        .as_ref()
        .unwrap_or_else(|| panic!("a close stores its checklist"));
    let keys: Vec<&str> = snapshot["checks"]
        .as_array()
        .unwrap_or_else(|| panic!("checks is a list"))
        .iter()
        .filter_map(|check| check["key"].as_str())
        .collect();
    assert!(
        keys.contains(&"bank.statements_imported"),
        "the stored snapshot records every control that ran, not only the failures: {keys:?}"
    );
    assert!(keys.contains(&"integrity.equations"));

    // The history cannot be tidied up afterwards.
    let rewrite = sqlx::query("UPDATE fiscal_period_event SET reason='something else'")
        .execute(&pool)
        .await;
    assert!(
        rewrite.is_err(),
        "a period's history is append-only, or it is not history"
    );
}

/// Books that do not add up refuse the close, and no flag on the checklist can
/// be set to let one through.
///
/// This is the one outcome that ignores `critical`. Everything else on the list
/// is a judgement about how much an exception matters; a trial balance that
/// does not foot is not a judgement.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn books_that_do_not_add_up_refuse_the_close_however_they_are_weighed(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;
    say_the_books_are(&pool, "BLOCKED").await;

    let refusal = cloud::period_close(&pool, 2026, 9, ACTOR, None)
        .await
        .expect_err("a month whose books do not balance must not close");
    assert!(
        as_shown_to_a_person(&refusal).contains("integrity.equations"),
        "the refusal names the engine: {}",
        as_shown_to_a_person(&refusal)
    );

    // That it refuses even when nobody calls the equations critical — the
    // thing somebody under time pressure would try — is proved in
    // `domain::period_close`, by `blocked_refuses_the_close_even_when_nobody_
    // called_it_critical`. It is not proved here on purpose: demoting the check
    // means writing to a process-global registry that every other test in this
    // binary is reading concurrently, and a test that can make its neighbours
    // fail is worse than a test in the wrong file.
}

// ---------------------------------------------------------------------------
// The reopen
// ---------------------------------------------------------------------------

/// A reopen needs a reason, because the reason is the only record of why a
/// month that had already been reported was opened again.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_reopen_without_a_reason_is_refused_and_with_one_is_recorded(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;
    cloud::period_close(&pool, 2026, 9, ACTOR, None)
        .await
        .unwrap_or_else(|error| panic!("close: {}", as_shown_to_a_person(&error)));

    for empty in ["", "   "] {
        let refusal = cloud::period_reopen(&pool, 2026, 9, SECOND, empty)
            .await
            .expect_err("a reopen with no reason must be refused");
        assert!(
            as_shown_to_a_person(&refusal).contains("reason"),
            "and must say so: {}",
            as_shown_to_a_person(&refusal)
        );
    }
    let status: String =
        sqlx::query_scalar("SELECT status FROM fiscal_period WHERE year=2026 AND month=9")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("status: {error}"));
    assert_eq!(status, "CLOSED", "a refused reopen changes nothing");

    cloud::period_reopen(&pool, 2026, 9, SECOND, "the supplier's credit note arrived")
        .await
        .unwrap_or_else(|error| panic!("reopen: {}", as_shown_to_a_person(&error)));

    let events = cloud::period_events(&pool, 2026, 9)
        .await
        .unwrap_or_else(|error| panic!("events: {error}"));
    assert_eq!(events.len(), 2, "the close and the reopen are both history");
    let reopen = events
        .iter()
        .find(|event| event.event == "REOPEN")
        .unwrap_or_else(|| panic!("a REOPEN event"));
    assert_eq!(reopen.actor, SECOND);
    assert_eq!(
        reopen.reason.as_deref(),
        Some("the supplier's credit note arrived")
    );

    let row = sqlx::query(
        "SELECT status, reopen_reason, reopened_by FROM fiscal_period WHERE year=2026 AND month=9",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("period: {error}"));
    assert_eq!(
        row.try_get::<String, _>("status").ok().as_deref(),
        Some("OPEN")
    );
    assert_eq!(
        row.try_get::<Option<String>, _>("reopened_by")
            .ok()
            .flatten()
            .as_deref(),
        Some(SECOND),
        "the row caches the latest reopen so a list screen need not join"
    );
    assert!(row
        .try_get::<Option<String>, _>("reopen_reason")
        .ok()
        .flatten()
        .is_some());
}

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

/// A bill cannot be posted into a month that has been sealed.
///
/// Refused by a trigger rather than by Rust, which is the point: the rule holds
/// against psql, against a second writer, and against a handler somebody adds
/// next year without reading this file.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_bill_cannot_be_posted_into_a_closed_month(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;
    let invoice = draft_a_bill(&pool, "INV-9002").await;
    cloud::post_bill(&pool, invoice, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post while open: {error}"));

    cloud::period_close(&pool, 2026, 9, ACTOR, None)
        .await
        .unwrap_or_else(|error| panic!("close: {}", as_shown_to_a_person(&error)));

    // Recording one is still allowed — a draft touches no account — but the
    // transition into the books is not.
    let late = cloud::record_bill(
        &pool,
        &cloud::RecordBillRequest {
            invoice_number: "INV-9003".into(),
            supplier_id: "SUP01".into(),
            supplier_name: None,
            site_id: "dc".into(),
            invoice_date: september(20),
            due_date: None,
            subtotal_minor: 1_000_000,
            tax_minor: 0,
            discount_minor: 0,
            note: None,
            kind: None,
            lines: None,
            matching: None,
            withholding_code: None,
            receipt_ids: None,
        },
        ACTOR,
    )
    .await
    .unwrap_or_else(|error| panic!("record into a closed month: {error}"))
    .invoice_id;

    let refusal = cloud::post_bill(&pool, late, None, ACTOR)
        .await
        .expect_err("a closed month must refuse a posting");
    let shown = as_shown_to_a_person(&refusal);
    assert!(
        shown.contains("2026-09") && shown.contains("closed"),
        "the trigger's own words reach the browser: {shown}"
    );
}

// ---------------------------------------------------------------------------
// The gate on the routes
// ---------------------------------------------------------------------------

fn cloud_config() -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("bind: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud-close-test".into(),
        node_role: "CLOUD".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
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
        cors_allowed_origins: Some("http://127.0.0.1:8080".into()),
        media: None,
        attachments: None,
        default_destination_site_id: "dc".into(),
        assistant_api_key: None,
        assistant_base_url: "https://openrouter.ai/api/v1".into(),
        assistant_model: "anthropic/claude-opus-5".into(),
    }
}

struct Reply {
    status: StatusCode,
    body: Value,
}

async fn send(
    app: axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Reply {
    let mut builder = axum::http::Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let payload = body.map(|value| {
        serde_json::to_vec(&value).unwrap_or_else(|error| panic!("encode body: {error}"))
    });
    if payload.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    let request: Request<Body> = builder
        .body(payload.map_or_else(Body::empty, Body::from))
        .unwrap_or_else(|error| panic!("{method} {path}: {error}"));
    let response = app
        .oneshot(request)
        .await
        .unwrap_or_else(|error| panic!("{method} {path}: {error}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap_or_else(|error| panic!("body of {method} {path}: {error}"));
    Reply {
        status,
        body: if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        },
    }
}

async fn login(app: &axum::Router, username: &str, password: &str) -> String {
    let reply = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({"username": username, "password": password})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "login {username}");
    reply.body["token"]
        .as_str()
        .unwrap_or_else(|| panic!("token for {username}"))
        .to_string()
}

/// The gate the path could not express.
///
/// `auth::required_role` answers Supervisor for every GET under
/// `/api/v1/finance/`, so before this lane a shop supervisor could read the
/// company's trial balance and could seal a month. The handler's own action key
/// is what tells the two kinds of read apart, and what tells sealing from
/// unsealing.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_supervisor_reads_what_a_shop_needs_and_no_more(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;
    cloud::create_user(
        &pool,
        CreateUserRequest {
            username: "sam.supervisor".into(),
            display_name: "Sam".into(),
            password: "supervisor-password".into(),
            role: Role::Supervisor.into(),
        },
        "test",
    )
    .await
    .unwrap_or_else(|error| panic!("create supervisor: {error}"));
    cloud::create_user(
        &pool,
        CreateUserRequest {
            username: "ada.admin".into(),
            display_name: "Ada".into(),
            password: "admin-password-1".into(),
            role: Role::Admin.into(),
        },
        "test",
    )
    .await
    .unwrap_or_else(|error| panic!("create admin: {error}"));

    let app = cloud_http::router(AppState::new(pool.clone(), cloud_config()));
    let supervisor = login(&app, "sam.supervisor", "supervisor-password").await;
    let admin = login(&app, "ada.admin", "admin-password-1").await;

    // What a place manager legitimately needs.
    assert_eq!(
        send(
            app.clone(),
            "GET",
            "/api/v1/finance/periods",
            Some(&supervisor),
            None
        )
        .await
        .status,
        StatusCode::OK,
        "finance.read is the one finance key below head office"
    );

    // What the path gate used to hand them along with it.
    for path in [
        "/api/v1/finance/trial-balance",
        "/api/v1/finance/journal",
        "/api/v1/finance/accounts",
    ] {
        let reply = send(app.clone(), "GET", path, Some(&supervisor), None).await;
        assert_eq!(
            reply.status,
            StatusCode::FORBIDDEN,
            "{path} is the company's books, not a shop's screen"
        );
        assert!(
            reply.body["error"]
                .as_str()
                .unwrap_or_default()
                .contains("finance.ledger.read"),
            "the refusal names the key that was missing: {:?}",
            reply.body
        );
    }

    // Sealing and unsealing are Admin's, and they are two different keys.
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/finance/periods/close",
            Some(&supervisor),
            Some(json!({"year": 2026, "month": 9})),
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/finance/periods/close",
            Some(&admin),
            Some(json!({"year": 2026, "month": 9})),
        )
        .await
        .status,
        StatusCode::OK
    );

    // A reopen still needs its reason, over HTTP as well as under it.
    let no_reason = send(
        app.clone(),
        "POST",
        "/api/v1/finance/periods/2026-09/reopen",
        Some(&admin),
        Some(json!({"reason": "   "})),
    )
    .await;
    assert_eq!(no_reason.status, StatusCode::BAD_REQUEST);

    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/finance/periods/2026-09/reopen",
            Some(&supervisor),
            Some(json!({"reason": "I would like September back"})),
        )
        .await
        .status,
        StatusCode::FORBIDDEN,
        "reopening is the key that exists mainly to be withheld"
    );
    assert_eq!(
        send(
            app.clone(),
            "POST",
            "/api/v1/finance/periods/2026-09/reopen",
            Some(&admin),
            Some(json!({"reason": "the supplier's credit note arrived"})),
        )
        .await
        .status,
        StatusCode::OK
    );

    // And the checklist is readable at the same rung that may act on it.
    let checklist = send(
        app.clone(),
        "GET",
        "/api/v1/finance/periods/2026-09/checklist",
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(checklist.status, StatusCode::OK);
    assert_eq!(checklist.body["may_close"], json!(true));
}

/// The lock a table that has not been written yet will get.
///
/// Nine money documents are being built on other branches, and every one of
/// them has to be shut out of a sealed month. An earlier draft of `0127`
/// offered them a lock keyed on a status named `POSTED` — which `store_deposit`
/// calls CONFIRMED, `acquirer_settlement` calls MATCHED and `giro` calls
/// CLEARED. That lock would have attached, reported success, and never fired.
///
/// So this proves the rule that replaced it, against a table standing in for
/// one of theirs: a document is in the books exactly when it names a journal
/// entry, whatever its status column happens to say.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_document_table_that_lands_later_is_shut_out_of_a_sealed_month(pool: PgPool) {
    install_stand_in();
    seed_chart(&pool).await;
    open_september(&pool).await;

    // A sister lane's table, with a status vocabulary this migration has never
    // seen and a date column of its own. Invented rather than borrowed from a
    // real lane: `store_deposit` and `remittance_order` were the obvious
    // stand-ins while lane B was unmerged, and now that it is merged its
    // migrations create both — a stand-in has to be a name nobody owns or the
    // test stops testing the lock and starts testing the merge order.
    sqlx::query(
        "CREATE TABLE later_lane_document (
             document_id uuid PRIMARY KEY,
             document_date date NOT NULL,
             status text NOT NULL DEFAULT 'PREPARED',
             journal_entry_id uuid REFERENCES journal_entry(entry_id))",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("stand-in table: {error}"));
    let note: String = sqlx::query_scalar(
        "SELECT attach_entry_link_period_lock('later_lane_document', 'document_date')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("attach: {error}"));
    assert!(note.contains("locked on"), "{note}");

    // A table nobody has merged says so instead of failing the migration.
    let absent: String = sqlx::query_scalar(
        "SELECT attach_entry_link_period_lock('a_table_no_lane_owns', 'its_date')",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|error| panic!("attach absent: {error}"));
    assert!(absent.contains("has not landed yet"), "{absent}");

    // Something in the ledger for the deposit to point at, while the month is
    // still open.
    let invoice = draft_a_bill(&pool, "INV-9100").await;
    cloud::post_bill(&pool, invoice, None, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("post while open: {error}"));

    // While the month is open the deposit may be prepared AND may reach the
    // ledger. Both halves matter: a lock that refused everything would pass a
    // test that only tried the refusal.
    sqlx::query(
        "INSERT INTO later_lane_document (document_id, document_date, status, journal_entry_id)
         SELECT gen_random_uuid(), DATE '2026-09-14', 'CONFIRMED', entry_id
           FROM journal_entry LIMIT 1",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("confirm while open: {error}"));
    sqlx::query(
        "INSERT INTO later_lane_document (document_id, document_date, status)
         VALUES (gen_random_uuid(), DATE '2026-09-14', 'PREPARED')",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("prepare a deposit: {error}"));

    cloud::period_close(&pool, 2026, 9, ACTOR, None)
        .await
        .unwrap_or_else(|error| panic!("close: {}", as_shown_to_a_person(&error)));

    // Still editable in a sealed month, as long as it stays out of the ledger.
    // A document with no entry is not in the books, and refusing a typo
    // correction would be a rule about paperwork rather than about the ledger.
    sqlx::query("UPDATE later_lane_document SET status='CANCELLED' WHERE journal_entry_id IS NULL")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("edit a deposit in a closed month: {error}"));

    // The transition into the books is what is refused, and the status word
    // does not appear anywhere in the rule that refuses it.
    let linked = sqlx::query(
        "UPDATE later_lane_document
            SET status='CONFIRMED',
                journal_entry_id = (SELECT entry_id FROM journal_entry LIMIT 1)
          WHERE journal_entry_id IS NULL",
    )
    .execute(&pool)
    .await;
    assert!(
        linked.is_err(),
        "a deposit cannot reach the ledger in a month that has been sealed"
    );
    let shown = format!("{:?}", linked.err());
    assert!(
        shown.contains("2026-09") && shown.contains("closed"),
        "and the refusal says which month: {shown}"
    );

    // An INSERT that arrives already linked — the shape a sync or a batch job
    // uses — is refused by the same trigger.
    let arrived = sqlx::query(
        "INSERT INTO later_lane_document (document_id, document_date, status, journal_entry_id)
         SELECT gen_random_uuid(), DATE '2026-09-14', 'CONFIRMED', entry_id
           FROM journal_entry LIMIT 1",
    )
    .execute(&pool)
    .await;
    assert!(arrived.is_err(), "and it cannot arrive linked either");
}
