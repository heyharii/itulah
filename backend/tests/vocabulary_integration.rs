//! The three vocabularies over HTTP: divisions, sizes and tags.
//!
//! # Why these particular tests
//!
//! These three lists existed as tables from the day the article master was
//! built and had no endpoint at all until `0091`. Every term was a row somebody
//! `INSERT`ed in a migration. So what is guarded here is not a regression in
//! working code — it is the set of ways a first cut of an editable master goes
//! wrong, each of which is discovered somewhere else and much later:
//!
//! - a size code that is not two digits. A size is not a name somebody
//!   chooses; it is the last two characters of every eleven-digit SKU, and
//!   `sku_code` reads that position expecting digits. A size called `M` would
//!   be accepted by a form and then break the codec that mints SKUs against
//!   it, in the warehouse, on the day of a delivery.
//! - a code stored in two shapes. `outer wear`, `Outer-Wear` and `OUTER_WEAR`
//!   becoming three divisions is exactly the split a controlled list exists to
//!   prevent, arriving through the door built to prevent it.
//! - a retirement that unfiles the goods. Retiring is what people reach for
//!   delete to do, and it must leave every article already pointing at the
//!   term reading it.
//! - the slower of two tabs winning a rename. A rename here renames the term
//!   on every article filed under it, so a last-write-wins edit loses a
//!   decision silently and everywhere at once.
//! - a double-clicked save writing two terms. The whole reason the write takes
//!   an idempotency key.
//!
//! # How the fixture is planted
//!
//! With SQL, because what is under test is the vocabulary endpoints and not the
//! setup session that mints articles — that path is proven by
//! `tagging_integration.rs`. Everything planted here carries `TEST_` or a code
//! in the 8x range, so an assertion can be made about this suite's rows rather
//! than about the demo seed migrations 0002, 0022 and 0027 ship.

use axum::body::{to_bytes, Body};
use http::{Request, StatusCode};
use inventory_backend::cloud::{http as cloud_http, AppConfig, AppState};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use uuid::Uuid;

fn frontend() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend")
}

/// Auth off, as in every other HTTP suite here: the middleware then hands
/// handlers a server-owned `development` principal, so an audit row still names
/// an actor the server chose rather than one a body claimed.
fn cloud_config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("socket address: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud".into(),
        node_role: "STORE".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: false,
        frontend_dir: frontend(),
        sync_upload_url: None,
        sync_upload_key: None,
        sync_ingest_key: None,
        sync_generation: 1,
        sync_enqueue_enabled: false,
        sync_interval_seconds: 5,
        sync_batch_limit: 100,
        sync_breaker_threshold: 3,
        sync_breaker_base_cooldown_seconds: 30,
        sync_breaker_max_cooldown_seconds: 900,
        sync_retention_days: 14,
        sync_degraded_after_seconds: 900,
        sync_apply_enabled: false,
        jwt_secret: None,
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

/// A fresh router per call, because `oneshot` consumes one — which also means
/// nothing leaks between requests, exactly as with a real server.
fn router(pool: &PgPool) -> axum::Router {
    cloud_http::router(AppState::new(pool.clone(), cloud_config()))
}

async fn call(
    pool: &PgPool,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let request = match body {
        Some(value) => request.body(Body::from(
            serde_json::to_vec(&value).unwrap_or_else(|e| panic!("encode body: {e}")),
        )),
        None => request.body(Body::empty()),
    }
    .unwrap_or_else(|e| panic!("build {method} {uri}: {e}"));

    let response = tower::ServiceExt::oneshot(router(pool), request)
        .await
        .unwrap_or_else(|e| panic!("{method} {uri}: {e}"));
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|e| panic!("read body of {method} {uri}: {e}"));
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|e| panic!("decode body of {method} {uri}: {e}"))
    };
    (status, value)
}

async fn ok(
    pool: &PgPool,
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> Value {
    let (status, value) = call(pool, method, uri, headers, body).await;
    assert!(
        status.is_success(),
        "{method} {uri} returned {status}: {value}"
    );
    value
}

/// One term out of a list response, by code.
fn term<'a>(list: &'a Value, code: &str) -> &'a Value {
    list["terms"]
        .as_array()
        .unwrap_or_else(|| panic!("no terms array in {list}"))
        .iter()
        .find(|row| row["code"] == code)
        .unwrap_or_else(|| panic!("no term {code} in {list}"))
}

fn version_of(value: &Value) -> i64 {
    value["version"]
        .as_i64()
        .unwrap_or_else(|| panic!("no version in {value}"))
}

// ---------------------------------------------------------------------------

/// The list counts and its usage facets must agree with the underlying goods,
/// including terms nobody has used. Sizes count SKUs; tags count articles.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn master_list_usage_matches_goods_for_each_vocabulary(pool: PgPool) {
    ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "usage-tag")],
        Some(json!({ "code": "TEST_USAGE", "label": "Usage fixture" })),
    )
    .await;
    sqlx::query(
        "INSERT INTO article_tag (article_id, tag_code)
         SELECT id, 'TEST_USAGE' FROM article ORDER BY article_code LIMIT 2",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("tag two articles: {error}"));
    for (kind, count_sql) in [
        (
            "divisions",
            "SELECT count(*) FROM article WHERE division_code = $1",
        ),
        ("sizes", "SELECT count(*) FROM sku WHERE size_code = $1"),
        (
            "tags",
            "SELECT count(DISTINCT article_id) FROM article_tag WHERE tag_code = $1",
        ),
    ] {
        let list = ok(
            &pool,
            "GET",
            &format!("/api/v1/vocabulary/{kind}?sort=in_use&dir=desc"),
            &[],
            None,
        )
        .await;
        let rows = list["terms"]
            .as_array()
            .unwrap_or_else(|| panic!("no master terms: {list}"));
        assert!(!rows.is_empty(), "seed supplies {kind}");
        let mut used = 0;
        let mut previous = i64::MAX;
        for row in rows {
            let expected: i64 = sqlx::query_scalar(count_sql)
                .bind(
                    row["code"]
                        .as_str()
                        .unwrap_or_else(|| panic!("no term code: {row}")),
                )
                .fetch_one(&pool)
                .await
                .unwrap_or_else(|error| panic!("usage in goods: {error}"));
            assert_eq!(row["in_use"], expected, "{kind} usage: {row}");
            assert!(expected <= previous, "usage sort: {list}");
            previous = expected;
            used += i64::from(expected > 0);
        }
        assert_eq!(list["total"], rows.len() as i64);
        let facets = list["facets"]["usage"]
            .as_array()
            .unwrap_or_else(|| panic!("no usage facets: {list}"));
        for (value, expected) in [("IN_USE", used), ("UNUSED", rows.len() as i64 - used)] {
            let actual = facets
                .iter()
                .find(|facet| facet["value"] == value)
                .and_then(|facet| facet["count"].as_i64())
                .unwrap_or(0);
            assert_eq!(actual, expected, "{kind} facet {value}: {list}");
        }
    }
}

/// A size is a position in a code, not a word.
///
/// `03` is M on every article in the company, and the last two characters of an
/// eleven-digit SKU are exactly this field. A size accepted as `M` would pass
/// the form and then break `sku_code` when a delivery is minted against it —
/// which is to say, in the warehouse, on a day when goods are waiting.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_size_code_is_two_digits_or_it_is_refused(pool: PgPool) {
    let (status, body) = call(
        &pool,
        "POST",
        "/api/v1/vocabulary/sizes",
        &[("idempotency-key", "size-named-m")],
        Some(json!({ "code": "M", "label": "Medium" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a size code that is not two digits must be refused, not stored: {body}"
    );

    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/sizes",
        &[("idempotency-key", "size-88")],
        Some(json!({ "code": "88", "label": "Test Medium" })),
    )
    .await;
    assert_eq!(created["code"], "88", "two digits is the shape: {created}");
    assert_eq!(
        created["in_use"], 0,
        "a size nothing has been minted in is unused: {created}"
    );
}

/// One code shape, so a controlled list cannot split the way free text did.
///
/// `outer wear`, `Outer-Wear` and `OUTER_WEAR` are one division. Accepting all
/// three as written would reproduce, through the endpoint built to prevent it,
/// exactly the divergence the table exists for.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_division_code_is_stored_in_one_shape(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/divisions",
        &[("idempotency-key", "division-outer")],
        Some(json!({ "code": "test outer-wear", "label": "Test Outerwear" })),
    )
    .await;
    assert_eq!(
        created["code"], "TEST_OUTER_WEAR",
        "spaces and hyphens normalise to one shape: {created}"
    );

    // The same division, typed the way somebody else would type it.
    let (status, body) = call(
        &pool,
        "POST",
        "/api/v1/vocabulary/divisions",
        &[("idempotency-key", "division-outer-again")],
        Some(json!({ "code": "TEST_OUTER_WEAR", "label": "Test Outerwear Two" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "the second spelling of one code is a conflict, not a second row: {body}"
    );
}

/// Retiring a term leaves the goods filed under it reading it.
///
/// This is the whole reason there is no delete: `article.division_code` points
/// here, and removing the row would leave those articles filed under nothing.
/// `in_use` is what makes it safe to offer the control at all — it says what
/// retiring will and will not touch before somebody presses it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn retiring_a_division_keeps_its_articles(pool: PgPool) {
    ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/divisions",
        &[("idempotency-key", "division-to-retire")],
        Some(json!({ "code": "TEST_RETIRING", "label": "Test Retiring" })),
    )
    .await;

    let article = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article (id, article_code, name, division_code)
         VALUES ($1, '89000001', 'Test Retiring Shirt', 'TEST_RETIRING')",
    )
    .bind(article)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("plant article: {e}"));

    let listed = ok(&pool, "GET", "/api/v1/vocabulary/divisions", &[], None).await;
    let before = term(&listed, "TEST_RETIRING");
    assert_eq!(
        before["in_use"], 1,
        "one article is filed under it, and the count is what says so: {before}"
    );

    let retired = ok(
        &pool,
        "PATCH",
        "/api/v1/vocabulary/divisions/TEST_RETIRING",
        &[
            ("idempotency-key", "retire-it"),
            ("if-match", &format!("\"{}\"", version_of(before))),
        ],
        Some(json!({ "active": false })),
    )
    .await;
    assert_eq!(retired["active"], false, "it retires: {retired}");

    // Still there, still counted, and the article still resolves.
    let after = ok(&pool, "GET", "/api/v1/vocabulary/divisions", &[], None).await;
    let row = term(&after, "TEST_RETIRING");
    assert_eq!(
        row["in_use"], 1,
        "retiring does not unfile the goods: {row}"
    );
    let division: Option<String> =
        sqlx::query_scalar("SELECT division_code FROM article WHERE id = $1")
            .bind(article)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("read article back: {e}"));
    assert_eq!(
        division.as_deref(),
        Some("TEST_RETIRING"),
        "the article still reads the retired division"
    );
}

/// A retired term is still returned, or a retirement is a disappearance.
///
/// `catalogue_vocabulary` hides inactive terms because a picker offering a dead
/// word is a dead end. The master endpoint must not: the screen that retired a
/// term has to be able to find it again, and a retirement nobody can find is a
/// retirement nobody can undo.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_master_list_still_shows_what_was_retired(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "tag-seasonal")],
        Some(json!({ "code": "TEST_SEASONAL", "label": "Test Seasonal" })),
    )
    .await;
    ok(
        &pool,
        "PATCH",
        "/api/v1/vocabulary/tags/TEST_SEASONAL",
        &[
            ("idempotency-key", "retire-seasonal"),
            ("if-match", &format!("\"{}\"", version_of(&created))),
        ],
        Some(json!({ "active": false })),
    )
    .await;

    let master = ok(&pool, "GET", "/api/v1/vocabulary/tags", &[], None).await;
    assert_eq!(
        term(&master, "TEST_SEASONAL")["active"],
        false,
        "the master shows it, retired: {master}"
    );

    let picker = ok(&pool, "GET", "/api/v1/catalogue/vocabulary", &[], None).await;
    let offered = picker["tags"]
        .as_array()
        .unwrap_or_else(|| panic!("no tags in {picker}"))
        .iter()
        .any(|row| row["code"] == "TEST_SEASONAL");
    assert!(
        !offered,
        "the picker hides it, which is the difference between the two: {picker}"
    );
}

/// The slower of two tabs must not win a rename.
///
/// A rename here renames the term on every article filed under it. Two people
/// editing one row is not hypothetical on a list this small and this shared,
/// and a last-write-wins edit loses a decision silently.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_stale_rename_is_refused(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "tag-race")],
        Some(json!({ "code": "TEST_RACE", "label": "Test Race" })),
    )
    .await;
    let seen = version_of(&created);

    let saved = ok(
        &pool,
        "PATCH",
        "/api/v1/vocabulary/tags/TEST_RACE",
        &[
            ("idempotency-key", "rename-first"),
            ("if-match", &format!("\"{seen}\"")),
        ],
        Some(json!({ "label": "Test Race Renamed" })),
    )
    .await;
    assert!(
        version_of(&saved) > seen,
        "a save must move the version, or the check has nothing to catch on: {saved}"
    );

    // The second tab, saving what it had.
    let (status, body) = call(
        &pool,
        "PATCH",
        "/api/v1/vocabulary/tags/TEST_RACE",
        &[
            ("idempotency-key", "rename-second"),
            ("if-match", &format!("\"{seen}\"")),
        ],
        Some(json!({ "label": "Test Race Other" })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a stale If-Match is a conflict, not a success: {body}"
    );

    let after = ok(&pool, "GET", "/api/v1/vocabulary/tags", &[], None).await;
    assert_eq!(
        term(&after, "TEST_RACE")["label"],
        "Test Race Renamed",
        "the first save stands: {after}"
    );
}

/// A retried save is the same save, not a second term.
///
/// The reason the write takes an idempotency key at all: a merchandiser whose
/// browser retries a slow request must not end up with the term twice under two
/// codes, which is precisely the split these tables were built to stop.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_retried_create_replays_rather_than_doubling(pool: PgPool) {
    let body = json!({ "code": "87", "label": "Test Retry" });
    let first = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/sizes",
        &[("idempotency-key", "size-retry")],
        Some(body.clone()),
    )
    .await;
    let again = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/sizes",
        &[("idempotency-key", "size-retry")],
        Some(body),
    )
    .await;
    assert_eq!(
        first, again,
        "the retry replays the first answer: {first} vs {again}"
    );

    let planted: i64 = sqlx::query_scalar("SELECT count(*) FROM size_code WHERE code = '87'")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("count sizes: {e}"));
    assert_eq!(planted, 1, "one row, not two");
}

/// There are three lists and nothing else, and asking for a fourth says so.
///
/// A 404 rather than a 500 or an empty list: an empty list would read as "that
/// vocabulary exists and is empty", which is the answer that sends somebody
/// looking for the terms they know are there.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_unknown_vocabulary_is_not_an_empty_one(pool: PgPool) {
    let (status, body) = call(&pool, "GET", "/api/v1/vocabulary/colors", &[], None).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "an unknown list is a missing address, not an empty answer: {body}"
    );
}

/// Order is a decision, and it is the one thing every picker reads.
///
/// Sizes alphabetically are L, M, S, XS — which is not an order anybody wants,
/// and is the reason `display_order` exists on all four vocabularies. Tags only
/// got the column in `0091`; before it they were ordered by label alone.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_new_term_lands_at_the_end_and_can_be_moved(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/sizes",
        &[("idempotency-key", "size-order")],
        Some(json!({ "code": "86", "label": "Test Order" })),
    )
    .await;
    let highest: i32 = sqlx::query_scalar("SELECT max(display_order) FROM size_code")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("read the highest order: {e}"));
    assert_eq!(
        created["display_order"].as_i64(),
        Some(i64::from(highest)),
        "absent, the order puts it last — where somebody who just added it \
         expects to find it: {created}"
    );

    let moved = ok(
        &pool,
        "PATCH",
        "/api/v1/vocabulary/sizes/86",
        &[
            ("idempotency-key", "size-reorder"),
            ("if-match", &format!("\"{}\"", version_of(&created))),
        ],
        Some(json!({ "display_order": 5 })),
    )
    .await;
    assert_eq!(moved["display_order"], 5, "it moves: {moved}");

    // Read as a position rather than as index zero: migration 0022 seeds a
    // `00 No Size` at order 0, so "moved to 5" means "now above XS", not
    // "first". An assertion that said `terms[0]` would have been an assertion
    // about the seed.
    let listed = ok(&pool, "GET", "/api/v1/vocabulary/sizes", &[], None).await;
    let rows = listed["terms"]
        .as_array()
        .unwrap_or_else(|| panic!("no terms in {listed}"));
    let at = |code: &str| {
        rows.iter()
            .position(|row| row["code"] == code)
            .unwrap_or_else(|| panic!("no size {code} in {listed}"))
    };
    assert!(
        at("86") < at("01"),
        "the list is drawn in display order, so order 5 sits above XS at 10: {listed}"
    );
}

// ---------------------------------------------------------------------------
// What may be destroyed, and what may only be retired.

/// The typo created a minute ago can be removed. Nothing else can.
///
/// Before `0167` there was no delete at all, on the argument that a term with
/// articles behind it would orphan them. True, and it left a misspelt tag in a
/// list of thirty forever — a permanent monument to one wrong keystroke, which
/// is not what "master data is durable" is supposed to mean.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_term_nothing_has_ever_named_can_be_deleted(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "typo-tag")],
        Some(json!({ "code": "TEST_TYPOO", "label": "Test Typoo" })),
    )
    .await;

    let usage = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_TYPOO/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(usage["can_delete"], true, "nothing names it: {usage}");
    assert_eq!(usage["ever_used"], false, "nothing ever did: {usage}");
    assert_eq!(usage["total"], 0, "and the total says so: {usage}");

    let (status, body) = call(
        &pool,
        "DELETE",
        "/api/v1/vocabulary/tags/TEST_TYPOO",
        &[("if-match", &format!("\"{}\"", version_of(&created)))],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "it goes: {body}");

    let listed = ok(&pool, "GET", "/api/v1/vocabulary/tags", &[], None).await;
    assert!(
        !listed["terms"]
            .as_array()
            .unwrap_or_else(|| panic!("no terms in {listed}"))
            .iter()
            .any(|row| row["code"] == "TEST_TYPOO"),
        "and it is gone from the list: {listed}"
    );
}

/// A term that was used and then unpicked is still not deletable.
///
/// This is the whole point of `ever_used`, and the case a live reference count
/// answers wrongly. A tag taken off the last article it was on has `in_use = 0`
/// and a history that a printed label, a report and an audit line still read;
/// deleting it would make all three name a word the catalogue no longer has.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_term_that_was_ever_used_may_only_be_retired(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "once-used-tag")],
        Some(json!({ "code": "TEST_ONCE", "label": "Test Once" })),
    )
    .await;

    let article = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article (id, article_code, name) VALUES ($1, '89000002', 'Test Once Shirt')",
    )
    .bind(article)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("plant article: {e}"));
    sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, 'TEST_ONCE')")
        .bind(article)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag the article: {e}"));

    let used = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_ONCE/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(used["can_delete"], false, "an article names it: {used}");

    // And now nothing does. The live count drops to zero; the mark does not.
    sqlx::query("DELETE FROM article_tag WHERE tag_code = 'TEST_ONCE'")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("untag the article: {e}"));

    let unpicked = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_ONCE/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(unpicked["total"], 0, "nothing points at it now: {unpicked}");
    assert_eq!(
        unpicked["ever_used"], true,
        "but something once did, and that is the answer: {unpicked}"
    );
    assert_eq!(unpicked["can_delete"], false, "so it stays: {unpicked}");

    let (status, refused) = call(
        &pool,
        "DELETE",
        "/api/v1/vocabulary/tags/TEST_ONCE",
        &[("if-match", &format!("\"{}\"", version_of(&created)))],
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "and the server refuses it too, not only the screen: {refused}"
    );

    // Retiring is the way out, and it leaves the term readable.
    let retired = ok(
        &pool,
        "PATCH",
        "/api/v1/vocabulary/tags/TEST_ONCE",
        &[
            ("idempotency-key", "retire-once"),
            ("if-match", &format!("\"{}\"", version_of(&created))),
        ],
        Some(json!({ "active": false })),
    )
    .await;
    assert_eq!(retired["active"], false, "it retires: {retired}");
}

/// A promotion naming a tag counts, and it is invisible to every foreign key.
///
/// `commercial_rule.definition` is the serialised engine rule, and
/// `Applicability::Tag` holds a set of strings the database has no reference
/// to. So a tag can be spoken for by a live promotion while every table in the
/// catalogue says nothing points at it — which is exactly the state in which
/// somebody would reach for delete.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_promotion_selecting_on_a_tag_is_a_reference(pool: PgPool) {
    ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "promoted-tag")],
        Some(json!({ "code": "TEST_PROMOTED", "label": "Test Promoted" })),
    )
    .await;

    let publication = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO commercial_publication (id, version, name, status, effective_from, created_by)
         VALUES ($1, 9901, 'usage probe', 'DRAFT', now(), 'test')",
    )
    .bind(publication)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("plant publication: {e}"));
    sqlx::query(
        "INSERT INTO commercial_rule
             (id, publication_id, rule_id, name, definition, status, priority)
         VALUES ($1, $2, 'promoted-20', 'Promoted 20%', $3::jsonb, 'ACTIVE', 0)",
    )
    .bind(Uuid::new_v4())
    .bind(publication)
    .bind(
        json!({
            "rule_id": "promoted-20",
            "scope": { "applicability": { "on": "TAG", "tags": ["TEST_PROMOTED"] } }
        })
        .to_string(),
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("plant rule: {e}"));

    let usage = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_PROMOTED/usage",
        &[],
        None,
    )
    .await;
    let named = |key: &str| -> i64 {
        usage["references"]
            .as_array()
            .unwrap_or_else(|| panic!("no references in {usage}"))
            .iter()
            .find(|one| one["key"] == key)
            .and_then(|one| one["count"].as_i64())
            .unwrap_or_else(|| panic!("no {key} reference in {usage}"))
    };
    assert_eq!(named("articles"), 0, "no article names it: {usage}");
    assert_eq!(named("promotions"), 1, "one promotion does: {usage}");
    assert_eq!(
        usage["can_delete"], false,
        "so it may not be deleted, despite Articles reading 0: {usage}"
    );
}

/// A value that predates the mark cannot be deleted, whatever its counts say.
///
/// `0167` backfilled `ever_used` from what was referenced at that moment, which
/// marked a tag unpicked from its last article in June as never used — and
/// therefore deletable, taking with it a word that a printed label, a report
/// and an audit line still read. `0180` closes that the only way it can be
/// closed, since the evidence to tell "never used" from "used and unpicked"
/// was never recorded: everything that already existed is assumed to have meant
/// something.
///
/// The seed's own terms are the fixture. They are exactly the population the
/// policy is about — rows that existed before the mark did — and a test that
/// planted its own would be testing the trigger instead.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_term_that_predates_the_mark_is_retire_only(pool: PgPool) {
    let listed = ok(&pool, "GET", "/api/v1/vocabulary/divisions", &[], None).await;
    let seeded = term(&listed, "MENSWEAR");
    assert_eq!(
        seeded["ever_used"], true,
        "a division from the seed is assumed to have meant something: {seeded}"
    );

    let usage = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/divisions/MENSWEAR/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(
        usage["can_delete"], false,
        "so it may not be deleted: {usage}"
    );

    let (status, refused) = call(
        &pool,
        "DELETE",
        "/api/v1/vocabulary/divisions/MENSWEAR",
        &[("if-match", &format!("\"{}\"", version_of(seeded)))],
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "and the server refuses it: {refused}"
    );
}

/// A value created after the mark starts deletable and stops being so on first
/// use — and does not become deletable again when the use goes away.
///
/// The three states in one test because they are one rule read at three
/// moments, and the third is the one that would be got wrong: a tag unticked
/// from the only article that had it looks untouched and is not.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_term_created_after_the_mark_is_deletable_until_it_is_used(pool: PgPool) {
    let created = ok(
        &pool,
        "POST",
        "/api/v1/vocabulary/tags",
        &[("idempotency-key", "fresh-tag")],
        Some(json!({ "code": "TEST_FRESH", "label": "Test Fresh" })),
    )
    .await;
    assert_eq!(
        created["ever_used"], false,
        "a value the lifecycle mechanism watched from birth starts unused: {created}"
    );
    let before = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_FRESH/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(before["can_delete"], true, "and is deletable: {before}");

    let article = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article (id, article_code, name) VALUES ($1, '89000003', 'Test Fresh Shirt')",
    )
    .bind(article)
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("plant article: {e}"));
    sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, 'TEST_FRESH')")
        .bind(article)
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("tag the article: {e}"));

    let used = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_FRESH/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(used["ever_used"], true, "first use sets the mark: {used}");
    assert_eq!(used["can_delete"], false, "{used}");

    sqlx::query("DELETE FROM article_tag WHERE tag_code = 'TEST_FRESH'")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("untag: {e}"));
    let after = ok(
        &pool,
        "GET",
        "/api/v1/vocabulary/tags/TEST_FRESH/usage",
        &[],
        None,
    )
    .await;
    assert_eq!(after["total"], 0, "nothing points at it now: {after}");
    assert_eq!(
        after["ever_used"], true,
        "and the mark does not come off: {after}"
    );
    assert_eq!(after["can_delete"], false, "{after}");
}
