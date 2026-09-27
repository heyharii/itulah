//! The Articles module over HTTP: the master product read whole, and the
//! limits that keep a SKU meaning what it says.
//!
//! # Why these particular tests
//!
//! An article is the one record every other screen quotes. A price book names
//! a SKU, a purchase order names an article, a printed label carries a colour
//! word, and a handheld reads an EPC that is nothing but a SKU with a serial
//! stapled to it. So the failures worth guarding here are the ones that would
//! be discovered somewhere else, long after the fact:
//!
//! - somebody types the code from a carton, a swing ticket, a supplier's
//!   invoice or a scanner into one box and gets nothing back, because only
//!   some of those are actually searched;
//! - a facet list that only describes what has already been chosen, so
//!   picking Menswear makes Womenswear read zero and the catalogue looks
//!   empty in a direction nobody then looks;
//! - a colour digit repointed at a different colour, which renames goods
//!   already tagged and sitting on a shelf, silently and everywhere at once;
//! - an eleventh colourway, which cannot exist — the colour is ONE digit of
//!   an eleven-digit SKU, and there is no eleventh value of one digit;
//! - two people editing the same article and the slower one winning.
//!
//! # How the fixture is planted
//!
//! With SQL, not with a setup session. Identity is minted by the centre
//! through `article_setup_session` and that path is proven by
//! `tagging_integration.rs`; what is under test here is the module that READS
//! and edits the master afterwards, so these rows are planted as the mint
//! would have left them. Every SKU string is still built by
//! `cloud::domain::sku_code`, and every QR and EPC by the real codec, because
//! a fixture that hand-wrote those would be testing the search against a
//! format the warehouse does not use.
//!
//! Everything this fixture plants carries the word `Cendana` in its name, so
//! a search can be scoped to it: migration 0002 seeds six demo articles that
//! are none of this suite's business, and an assertion counting every row in
//! the table would be an assertion about the demo seed.

use axum::body::{to_bytes, Body};
use http::{Request, StatusCode};
use inventory_backend::cloud::domain::{encode_epc, qr_payload, sku_code};
use inventory_backend::cloud::{http as cloud_http, AppConfig, AppState};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use uuid::Uuid;

/// The word every article in this fixture carries, so `q` can be pointed at
/// the fixture rather than at the demo seed.
const FIXTURE: &str = "Cendana";

const KEMEJA: &str = "10000001";
const KAOS: &str = "10000002";
const ROK: &str = "10000003";
const SEPATU: &str = "10000004";
/// Only the ceiling test plants this one; it is the article that gets filled
/// to all ten digits.
const PAYUNG: &str = "10000005";

/// What the supplier calls the shirt. Never an identity — two suppliers use
/// the same string for different goods — but it is what a buyer holding the
/// supplier's invoice will type into the search box.
const SUPPLIER_CODE: &str = "SANDANG-KMJ-LP-01";

/// The colour master this fixture needs.
///
/// Deliberately named apart from whatever starter list migration 0081 ships.
/// A fixture that assumed one of the seeded codes would break every time
/// somebody edited the seed, and the seed is not what these tests are about —
/// `colour_label_unique` and the foreign key are.
const COLOURS: &[(&str, &str, &str)] = &[
    ("TEST_NAVY", "Test Navy", "#1B2A4A"),
    ("TEST_PUTIH", "Test Putih", "#FFFFFF"),
    ("TEST_MERAH", "Test Merah", "#B3261E"),
    ("TEST_HITAM", "Test Hitam", "#111111"),
    ("TEST_W01", "Test Warna 01", "#2A9D8F"),
    ("TEST_W02", "Test Warna 02", "#E9C46A"),
    ("TEST_W03", "Test Warna 03", "#F4A261"),
    ("TEST_W04", "Test Warna 04", "#E76F51"),
    ("TEST_W05", "Test Warna 05", "#264653"),
    ("TEST_W06", "Test Warna 06", "#8AB17D"),
    ("TEST_W07", "Test Warna 07", "#6D597A"),
    ("TEST_W08", "Test Warna 08", "#B56576"),
];

fn frontend() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend")
}

/// Auth off, which is what every other HTTP suite here runs with: the
/// middleware then hands handlers a server-owned `development` principal, so
/// an audit row still names an actor the server chose rather than one a body
/// claimed.
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

/// One HTTP call, with whatever headers it needs.
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
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes).to_string() }))
    };
    (status, value)
}

/// A call that must succeed. The body goes in the panic, because a bare
/// status code tells whoever is reading the failure nothing about what to fix.
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

async fn search(pool: &PgPool, query: &str) -> Value {
    ok(pool, "GET", &format!("/api/v1/articles?{query}"), &[], None).await
}

/// A guarded write, carrying the two headers every edit in this estate needs:
/// a key so a retry is not a second edit, and a version so a slow tab cannot
/// overwrite what it never saw.
async fn patch_article(
    pool: &PgPool,
    code: &str,
    version: i64,
    key: &str,
    body: Value,
) -> (StatusCode, Value) {
    call(
        pool,
        "PATCH",
        &format!("/api/v1/articles/{code}"),
        &[
            ("idempotency-key", key),
            ("if-match", &format!("\"{version}\"")),
        ],
        Some(body),
    )
    .await
}

/// What came back, as article codes: the only thing an assertion about which
/// articles a filter admits actually cares about.
fn codes(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items array in {page}"))
        .iter()
        .map(|row| {
            row["article_code"]
                .as_str()
                .unwrap_or_else(|| panic!("no article_code in {row}"))
                .to_owned()
        })
        .collect()
}

fn row<'a>(page: &'a Value, code: &str) -> &'a Value {
    page["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no items array in {page}"))
        .iter()
        .find(|row| row["article_code"] == json!(code))
        .unwrap_or_else(|| panic!("no article {code} in {page}"))
}

/// The strings inside one array-of-strings field of a row.
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap_or_else(|| panic!("expected an array, got {value}"))
        .iter()
        .map(|item| {
            item.as_str()
                .unwrap_or_else(|| panic!("expected a string, got {item}"))
                .to_owned()
        })
        .collect()
}

/// The colour codes a row declares, in the order it declares them.
fn colourway_codes(row: &Value) -> Vec<String> {
    row["colours"]
        .as_array()
        .unwrap_or_else(|| panic!("no colours array in {row}"))
        .iter()
        .map(|colour| {
            colour["colour_code"]
                .as_str()
                .unwrap_or_else(|| panic!("no colour_code in {colour}"))
                .to_owned()
        })
        .collect()
}

/// One facet's count, or zero when the facet is not listed at all — which is
/// precisely the failure the facet tests are looking for, so it must not
/// panic.
fn facet(page: &Value, group: &str, value: &str) -> i64 {
    page["facets"][group]
        .as_array()
        .map(|counts| {
            counts
                .iter()
                .find(|count| count["value"] == json!(value))
                .and_then(|count| count["count"].as_i64())
                .unwrap_or(0)
        })
        .unwrap_or(0)
}

fn version_of(value: &Value) -> i64 {
    value["version"]
        .as_i64()
        .unwrap_or_else(|| panic!("no version in {value}"))
}

/// One article as the mint would have left it.
struct Article<'a> {
    code: &'a str,
    name: &'a str,
    division: &'a str,
    tags: &'a [&'a str],
    /// `(colour digit, colour code)` — the article's own mapping. A digit may
    /// legitimately appear here with no SKU behind it: head office decided on
    /// the colourway and the delivery of it has not been identified yet.
    colours: &'a [(&'a str, &'a str)],
    /// `(colour digit, size code, base price in minor units)`.
    skus: &'a [(&'a str, &'a str, i64)],
}

async fn plant_colours(pool: &PgPool) {
    for (code, label, hex) in COLOURS {
        sqlx::query(
            "INSERT INTO colour (code, label, hex_code, display_order) VALUES ($1, $2, $3, $4)",
        )
        .bind(code)
        .bind(label)
        .bind(hex)
        .bind(10)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("colour {code}: {e}"));
    }
}

async fn plant(pool: &PgPool, article: &Article<'_>) -> Uuid {
    let article_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO article (id, article_code, name, division_code, image_url)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(article_id)
    .bind(article.code)
    .bind(article.name)
    .bind(article.division)
    .bind(format!("https://cdn.itulah.co.id/{}.jpg", article.code))
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("article {}: {e}", article.code));

    for tag in article.tags {
        sqlx::query("INSERT INTO article_tag (article_id, tag_code) VALUES ($1, $2)")
            .bind(article_id)
            .bind(tag)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("tag {tag} on {}: {e}", article.code));
    }

    for (digit, colour_code) in article.colours {
        sqlx::query(
            "INSERT INTO article_colour (article_id, colour_digit, colour_code)
             VALUES ($1, $2, $3)",
        )
        .bind(article_id)
        .bind(digit)
        .bind(colour_code)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("colourway {digit} on {}: {e}", article.code));
    }

    for (digit, size, price) in article.skus {
        let sku = minted(article.code, digit, size);
        let qr = qr_payload(&sku).unwrap_or_else(|e| panic!("qr for {sku}: {e}"));
        sqlx::query(
            "INSERT INTO sku (id, article_id, sku_code, colour_digit, size_code,
                              base_price_minor, currency, qr_payload)
             VALUES ($1, $2, $3, $4, $5, $6, 'IDR', $7)",
        )
        .bind(Uuid::new_v4())
        .bind(article_id)
        .bind(&sku)
        .bind(digit)
        .bind(size)
        .bind(price)
        .bind(&qr)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("sku {sku}: {e}"));
    }

    article_id
}

/// A SKU built the only way a SKU is ever built. Nothing here hand-writes the
/// eleven digits: the codec is what the handhelds and the labels agree with.
fn minted(article_code: &str, digit: &str, size: &str) -> String {
    let digit = digit
        .chars()
        .next()
        .unwrap_or_else(|| panic!("colour digit {digit:?} is empty"));
    sku_code(article_code, digit, size).unwrap_or_else(|e| panic!("sku_code: {e}"))
}

/// The supplier's own line for the shirt, which is the sixth way into the
/// search: a buyer holding an invoice knows the supplier's code and nothing
/// else.
async fn plant_supplier_item(pool: &PgPool, article_code: &str, supplier_code: &str) -> Uuid {
    let supplier_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier (supplier_id, supplier_code, supplier_code_normalized, name,
                               created_by, updated_by)
         VALUES ($1, 'SANDANG', 'sandang', 'PT Sandang Nusantara', 'buyer-1', 'buyer-1')",
    )
    .bind(supplier_id)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("supplier: {e}"));

    let item_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO supplier_item (supplier_item_id, supplier_id, supplier_item_code,
                                    supplier_item_code_normalized, name, unit_price_minor,
                                    internal_article_code, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'Kemeja Lengan Panjang', 210000, $5, 'buyer-1', 'buyer-1')",
    )
    .bind(item_id)
    .bind(supplier_id)
    .bind(supplier_code)
    .bind(supplier_code.to_lowercase())
    .bind(article_code)
    .execute(pool)
    .await
    .unwrap_or_else(|e| panic!("supplier item: {e}"));
    item_id
}

/// Four articles across three divisions, which is the least that can tell a
/// facet counted over the search from one counted over the selection.
///
/// The shirt is the interesting one: three colourways of which only two have
/// been minted into SKUs, two sizes in one colour and one in another, and a
/// supplier line pointing at it.
async fn catalogue(pool: &PgPool) {
    plant_colours(pool).await;
    plant(
        pool,
        &Article {
            code: KEMEJA,
            name: "Kemeja Cendana Lengan Panjang",
            division: "PRIA",
            tags: &["KEMEJA", "LENGAN_PANJANG"],
            colours: &[("1", "TEST_NAVY"), ("2", "TEST_PUTIH"), ("3", "TEST_MERAH")],
            skus: &[
                ("1", "03", 250_000),
                ("1", "04", 250_000),
                ("2", "03", 260_000),
            ],
        },
    )
    .await;
    plant(
        pool,
        &Article {
            code: KAOS,
            name: "Kaos Cendana Polos",
            division: "PRIA",
            tags: &["KAOS", "BASIC"],
            colours: &[("1", "TEST_PUTIH")],
            skus: &[("1", "02", 90_000)],
        },
    )
    .await;
    plant(
        pool,
        &Article {
            code: ROK,
            name: "Rok Cendana Lipit",
            division: "WANITA",
            tags: &["BASIC"],
            colours: &[("3", "TEST_MERAH")],
            skus: &[("3", "03", 175_000), ("3", "05", 175_000)],
        },
    )
    .await;
    plant(
        pool,
        &Article {
            code: SEPATU,
            name: "Sepatu Cendana Lari",
            division: "SANDAL_SEPATU",
            tags: &[],
            colours: &[("1", "TEST_HITAM")],
            skus: &[("1", "13", 480_000)],
        },
    )
    .await;
    plant_supplier_item(pool, KEMEJA, SUPPLIER_CODE).await;
}

// ---------------------------------------------------------------------------
// 1. Six ways in
// ---------------------------------------------------------------------------

/// One shirt, six things somebody might have in front of them.
///
/// Each of these is a real piece of paper or a real screen: the eight digits
/// stencilled on a carton, the eleven on a swing ticket, the words on a
/// buyer's screen, the QR on the label, the EPC a handheld read off the tag,
/// and the code on the supplier's invoice. A search box that answers only
/// some of them is worse than one that answers none, because the ones it
/// misses look like goods that do not exist.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn every_code_on_every_piece_of_paper_finds_the_same_shirt(pool: PgPool) {
    catalogue(&pool).await;
    let large_navy = minted(KEMEJA, "1", "04");
    let qr = qr_payload(&large_navy).unwrap_or_else(|e| panic!("qr: {e}"));
    // Serial 7 of that SKU: one physical shirt, on one shelf, wearing one tag.
    let epc = encode_epc(&large_navy, 7).unwrap_or_else(|e| panic!("epc: {e}"));

    // The four exact identities resolve to exactly one article. A search that
    // returned the shirt plus a handful of near misses would still be wrong:
    // the operator scanned a specific thing.
    for (what, needle) in [
        (
            "the article code stencilled on the carton",
            KEMEJA.to_owned(),
        ),
        ("the SKU on the swing ticket", large_navy.clone()),
        ("the QR printed on the label", qr),
        ("the EPC the handheld read", epc),
        (
            "the code on the supplier's invoice",
            SUPPLIER_CODE.to_owned(),
        ),
    ] {
        let page = search(&pool, &format!("q={needle}")).await;
        assert_eq!(
            codes(&page),
            vec![KEMEJA.to_owned()],
            "{what} ({needle}) must find the shirt and only the shirt: {page}"
        );
    }

    // Words are the one route that is allowed to be generous — a person
    // typing a fragment expects a shortlist — so this one only has to contain
    // it.
    let page = search(&pool, "q=Lengan Panjang").await;
    assert!(
        codes(&page).contains(&KEMEJA.to_owned()),
        "a fragment of the name must find the shirt: {page}"
    );
}

/// Text that is not an EPC is not an error.
///
/// `decode_epc` refusing a string is the ordinary case — almost everything
/// typed into the box is not 24 hex characters — so a decode failure must
/// fall through to the other five routes rather than becoming a 400. A search
/// box that can be made to error by typing is a search box people stop using.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn text_that_is_not_an_epc_is_just_text(pool: PgPool) {
    catalogue(&pool).await;
    // Twenty-four hex characters with the wrong header: as EPC-shaped as a
    // string can be while still not being one of ours.
    let page = search(&pool, "q=300000000000000000000001").await;
    assert!(
        codes(&page).is_empty(),
        "an EPC that is not ours matches nothing, and says so by matching nothing: {page}"
    );
    let page = search(&pool, &format!("q={FIXTURE}")).await;
    assert_eq!(
        codes(&page).len(),
        4,
        "the fixture's four articles are still findable by name: {page}"
    );
}

// ---------------------------------------------------------------------------
// 2. Facets describe the search, not the selection
// ---------------------------------------------------------------------------

/// Choosing one division must not make the others read zero.
///
/// This is the rule most easily got wrong, because the wrong version is the
/// obvious one: count the rows you are about to return. Do that and the facet
/// list stops being a map of the catalogue and becomes a restatement of the
/// current filter — it can no longer answer "what if I looked at womenswear
/// instead", which is the only question it exists to answer. Same rule and
/// same reason as `search_supplier_items`.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn choosing_one_division_still_says_what_the_others_hold(pool: PgPool) {
    catalogue(&pool).await;

    let all = search(&pool, &format!("q={FIXTURE}")).await;
    assert_eq!(
        facet(&all, "divisions", "PRIA"),
        2,
        "two menswear articles before any filter: {all}"
    );
    assert_eq!(facet(&all, "divisions", "WANITA"), 1, "{all}");
    assert_eq!(facet(&all, "divisions", "SANDAL_SEPATU"), 1, "{all}");

    let menswear = search(&pool, &format!("q={FIXTURE}&division_code=PRIA")).await;
    let mut listed = codes(&menswear);
    listed.sort();
    assert_eq!(
        listed,
        vec![KEMEJA.to_owned(), KAOS.to_owned()],
        "the LIST narrows to the chosen division: {menswear}"
    );
    assert_eq!(
        menswear["total"],
        json!(2),
        "total counts what the search and filters match, not the page: {menswear}"
    );

    // And the facets do not.
    assert_eq!(
        facet(&menswear, "divisions", "WANITA"),
        1,
        "womenswear must still be counted while menswear is selected, or nobody \
         can see it is there: {menswear}"
    );
    assert_eq!(
        facet(&menswear, "divisions", "SANDAL_SEPATU"),
        1,
        "footwear likewise: {menswear}"
    );
    assert_eq!(
        facet(&menswear, "divisions", "PRIA"),
        2,
        "and the chosen division still reports its own count: {menswear}"
    );

    // The same rule holds across facet groups: a division filter must not
    // silence the tags, sizes and colours that live outside it, or a second
    // filter can never be added.
    assert_eq!(
        facet(&menswear, "tags", "BASIC"),
        2,
        "BASIC is on the kaos and the rok; selecting menswear must not hide the \
         rok's use of it: {menswear}"
    );
    assert_eq!(
        facet(&menswear, "sizes", "13"),
        1,
        "the shoe's size is outside the selection and still counted: {menswear}"
    );
    assert_eq!(
        facet(&menswear, "colours", "TEST_HITAM"),
        1,
        "so is its colour: {menswear}"
    );
}

// ---------------------------------------------------------------------------
// 3. Colour and size filter SKUs; the list is still articles
// ---------------------------------------------------------------------------

/// A size filter answers "which articles have one in this size" — and then
/// shows the whole article.
///
/// The trap is joining the filter into the row: filter to L and the shirt
/// comes back claiming to exist only in L, so a merchandiser who filtered to
/// check availability then reads the row as the article's whole range and
/// reorders against it.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_size_filter_picks_articles_without_hiding_a_row_s_other_variants(pool: PgPool) {
    catalogue(&pool).await;

    // Size 04 (L) exists on one SKU of one article.
    let large = search(&pool, &format!("q={FIXTURE}&size_code=04")).await;
    assert_eq!(
        codes(&large),
        vec![KEMEJA.to_owned()],
        "only the shirt has an L: {large}"
    );
    let shirt = row(&large, KEMEJA);
    assert_eq!(
        strings(&shirt["size_codes"]),
        vec!["03".to_owned(), "04".to_owned()],
        "the shirt still says it comes in M as well as L: {shirt}"
    );
    assert_eq!(
        colourway_codes(shirt),
        vec![
            "TEST_NAVY".to_owned(),
            "TEST_PUTIH".to_owned(),
            "TEST_MERAH".to_owned()
        ],
        "and still lists all three of its colourways, in digit order: {shirt}"
    );
    assert_eq!(
        shirt["sku_count"],
        json!(3),
        "the shirt has three SKUs whichever size was filtered on: {shirt}"
    );

    // Size 03 (M) exists on two articles, in two divisions.
    let medium = search(&pool, &format!("q={FIXTURE}&size_code=03")).await;
    let mut listed = codes(&medium);
    listed.sort();
    assert_eq!(
        listed,
        vec![KEMEJA.to_owned(), ROK.to_owned()],
        "the shirt and the skirt both come in M: {medium}"
    );
}

/// A colour filter means "has a SKU in this colour", not "has declared this
/// colourway".
///
/// The shirt declares TEST_MERAH at digit 3 and has never minted a SKU
/// against it — head office chose the colourway and the goods have not been
/// identified yet. Answering a colour filter from `article_colour` rather
/// than from `sku` puts that shirt in front of somebody looking for red stock
/// there is none of.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_colour_filter_finds_goods_not_intentions(pool: PgPool) {
    catalogue(&pool).await;

    let red = search(&pool, &format!("q={FIXTURE}&colour_code=TEST_MERAH")).await;
    assert_eq!(
        codes(&red),
        vec![ROK.to_owned()],
        "the skirt has red SKUs; the shirt only has the intention of them: {red}"
    );

    let white = search(&pool, &format!("q={FIXTURE}&colour_code=TEST_PUTIH")).await;
    let mut listed = codes(&white);
    listed.sort();
    assert_eq!(
        listed,
        vec![KEMEJA.to_owned(), KAOS.to_owned()],
        "both the shirt and the tee have white SKUs: {white}"
    );
    assert_eq!(
        colourway_codes(row(&white, KEMEJA)),
        vec![
            "TEST_NAVY".to_owned(),
            "TEST_PUTIH".to_owned(),
            "TEST_MERAH".to_owned()
        ],
        "filtering to white must not make the shirt look like a white-only shirt: {white}"
    );
}

// ---------------------------------------------------------------------------
// 4. The ten-colourway ceiling
// ---------------------------------------------------------------------------

/// Ten is allowed. Eleven cannot be expressed, and must be refused in words.
///
/// The colour is one character of an eleven-digit SKU, so this is not a policy
/// somebody chose and can unchoose — there is no eleventh value of one digit.
/// The refusal has to say so, because the person hitting it is a merchandiser
/// with an eleventh fabric swatch in their hand and "invalid request" tells
/// them to try again.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_eleventh_colourway_cannot_exist_and_is_refused_in_words(pool: PgPool) {
    plant_colours(&pool).await;
    let article_id = plant(
        &pool,
        &Article {
            code: PAYUNG,
            name: "Payung Cendana",
            division: "AKSESORIS",
            tags: &[],
            colours: &[("0", "TEST_NAVY")],
            skus: &[("0", "08", 65_000)],
        },
    )
    .await;

    // All ten digits, with digit 0 left pointing where its SKU already points.
    let ten: Vec<Value> = COLOURS
        .iter()
        .take(10)
        .enumerate()
        .map(|(index, (code, _, _))| json!({ "colour_digit": index.to_string(), "colour_code": code }))
        .collect();
    let filled = ok(
        &pool,
        "PATCH",
        &format!("/api/v1/articles/{PAYUNG}"),
        &[("idempotency-key", "colourways-ten"), ("if-match", "\"1\"")],
        Some(json!({ "colours": ten.clone() })),
    )
    .await;
    assert_eq!(
        filled["colours"].as_array().map(Vec::len),
        Some(10),
        "ten colourways is the ceiling, not one short of it: {filled}"
    );

    // The eleventh. There is nowhere to put it: the digits 0-9 are spent, so
    // a client that believes colourways are simply numbered sends "10".
    let mut eleven = ten;
    eleven.push(json!({ "colour_digit": "10", "colour_code": "TEST_W07" }));
    let (status, body) = patch_article(
        &pool,
        PAYUNG,
        version_of(&filled),
        "colourways-eleven",
        json!({ "colours": eleven }),
    )
    .await;
    assert!(
        status.is_client_error(),
        "an eleventh colourway is the caller's mistake, not the server's: {status} {body}"
    );
    let message = body["error"]
        .as_str()
        .unwrap_or_else(|| panic!("no error message in {body}"))
        .to_lowercase();
    assert!(
        message.contains("colourway") || message.contains("colour"),
        "the refusal must name what was refused: {body}"
    );
    assert!(
        message.contains("ten") || message.contains("10"),
        "and must say where the limit is, so a merchandiser knows it is not a \
         typo they can fix: {body}"
    );

    let detail = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{PAYUNG}"),
        &[],
        None,
    )
    .await;
    assert_eq!(
        detail["colours"].as_array().map(Vec::len),
        Some(10),
        "the refused edit left the ten that were already there: {detail}"
    );

    // And underneath the handler, the schema itself. This is the guarantee
    // that survives a rewrite of the module: `colour_digit ~ '^[0-9]$'` and a
    // primary key on `(article_id, colour_digit)` mean an eleventh row has
    // nowhere to go even if every check above is deleted.
    let forced = sqlx::query(
        "INSERT INTO article_colour (article_id, colour_digit, colour_code)
         VALUES ($1, 'A', 'TEST_W08')",
    )
    .bind(article_id)
    .execute(&pool)
    .await;
    assert!(
        forced.is_err(),
        "the eleventh colourway must be unrepresentable in the table, not merely \
         unwelcome in the handler"
    );
}

// ---------------------------------------------------------------------------
// 5. A minted colour digit cannot be repointed
// ---------------------------------------------------------------------------

/// Repointing a digit that has SKUs behind it renames goods already on a
/// shelf.
///
/// Nothing about the physical stock changes: the tags are printed, the shirts
/// are hanging, and every one of them says navy. Repointing digit 1 to red
/// makes the master disagree with all of them at once, and the disagreement
/// only surfaces when somebody picks a "red" shirt and finds a navy one.
///
/// The control matters as much as the refusal: a digit with nothing minted
/// against it is head office changing its mind before anything was made, and
/// must still be editable.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_colour_digit_with_goods_behind_it_cannot_be_repointed(pool: PgPool) {
    catalogue(&pool).await;
    let before = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[],
        None,
    )
    .await;

    // Digit 3 was declared and never minted, so it may be moved. Nothing on
    // any shelf says anything about it.
    let moved = ok(
        &pool,
        "PATCH",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[
            ("idempotency-key", "repoint-unminted"),
            ("if-match", "\"1\""),
        ],
        Some(json!({
            "colours": [
                { "colour_digit": "1", "colour_code": "TEST_NAVY" },
                { "colour_digit": "2", "colour_code": "TEST_PUTIH" },
                { "colour_digit": "3", "colour_code": "TEST_W01" },
            ]
        })),
    )
    .await;
    assert_eq!(
        colourway_codes(&moved),
        vec![
            "TEST_NAVY".to_owned(),
            "TEST_PUTIH".to_owned(),
            "TEST_W01".to_owned()
        ],
        "a colourway nothing was ever made in is head office changing its mind: {moved}"
    );

    // Digit 1 has three-hundred navy shirts' worth of printed labels behind
    // it. TEST_W02 is otherwise unused on this article, so the only rule this
    // request breaks is the one under test.
    let (status, body) = patch_article(
        &pool,
        KEMEJA,
        version_of(&moved),
        "repoint-minted",
        json!({
            "colours": [
                { "colour_digit": "1", "colour_code": "TEST_W02" },
                { "colour_digit": "2", "colour_code": "TEST_PUTIH" },
                { "colour_digit": "3", "colour_code": "TEST_W01" },
            ]
        }),
    )
    .await;
    assert!(
        status.is_client_error(),
        "repointing a minted digit must be refused: {status} {body}"
    );
    let message = body["error"]
        .as_str()
        .unwrap_or_else(|| panic!("no error message in {body}"))
        .to_lowercase();
    assert!(
        message.contains("sku") || message.contains("minted") || message.contains("digit"),
        "the refusal must say why, or it reads as a bug in the form: {body}"
    );

    let after = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[],
        None,
    )
    .await;
    assert_eq!(
        colourway_codes(&after)[0],
        "TEST_NAVY".to_owned(),
        "digit 1 still means what every printed label says it means: {after}"
    );
    assert_eq!(
        before["skus"], after["skus"],
        "and no SKU moved underneath the refusal: {after}"
    );
}

// ---------------------------------------------------------------------------
// 6. Optimistic concurrency
// ---------------------------------------------------------------------------

/// The slower of two editors must lose, loudly.
///
/// Two merchandisers open the shirt. One renames it and saves. The other,
/// still looking at the old form, saves the division they picked — and
/// without a version check that second save silently restores the old name,
/// so the first edit is undone by somebody who never saw it and nobody is
/// told.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_edit_that_never_saw_the_last_one_is_refused(pool: PgPool) {
    catalogue(&pool).await;
    let opened = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[],
        None,
    )
    .await;
    let seen = version_of(&opened);

    let saved = ok(
        &pool,
        "PATCH",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[
            ("idempotency-key", "rename-first"),
            ("if-match", &format!("\"{seen}\"")),
        ],
        Some(json!({ "name": "Kemeja Cendana Lengan Panjang Premium" })),
    )
    .await;
    assert_eq!(
        saved["name"], "Kemeja Cendana Lengan Panjang Premium",
        "the first save takes: {saved}"
    );
    assert!(
        version_of(&saved) > seen,
        "a save must move the version, or the check has nothing to catch on: {saved}"
    );

    // The second tab, saving what it had.
    let (status, body) = patch_article(
        &pool,
        KEMEJA,
        seen,
        "reclassify-second",
        json!({ "division_code": "WANITA" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "a stale If-Match is a conflict, not a success and not a bad request: {body}"
    );

    let after = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[],
        None,
    )
    .await;
    assert_eq!(
        after["name"], "Kemeja Cendana Lengan Panjang Premium",
        "the refused save did not quietly restore the old name: {after}"
    );
    assert_eq!(
        after["division_code"], "PRIA",
        "and did not half-apply either: {after}"
    );
}

// ---------------------------------------------------------------------------
// 7. Identity is immutable
// ---------------------------------------------------------------------------

/// No request shape lets an article code or a SKU code move.
///
/// Identity is minted by the centre and only by the centre, and once it is
/// minted it is on labels, in price books, in every fact a till has ever
/// sent. Editing a code here does not rename a product; it detaches it from
/// its own history. Refusing the field and ignoring it are both acceptable —
/// changing it is not, so this asserts on what is true afterwards rather than
/// on the status.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn nothing_in_a_patch_can_move_an_article_code_or_a_sku_code(pool: PgPool) {
    catalogue(&pool).await;
    let before = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[],
        None,
    )
    .await;
    let sku_codes: Vec<String> = before["skus"]
        .as_array()
        .unwrap_or_else(|| panic!("no skus in {before}"))
        .iter()
        .map(|sku| {
            sku["sku_code"]
                .as_str()
                .unwrap_or_else(|| panic!("no sku_code in {sku}"))
                .to_owned()
        })
        .collect();
    assert_eq!(sku_codes.len(), 3, "the fixture's three SKUs: {before}");

    // Everything a client might try, in one body: the code itself, and the
    // SKUs under it.
    let (_status, _body) = patch_article(
        &pool,
        KEMEJA,
        version_of(&before),
        "rewrite-identity",
        json!({
            "name": "Kemeja Cendana Lengan Panjang",
            "article_code": "99999999",
            "skus": [{ "sku_code": "99999999999" }],
        }),
    )
    .await;

    let after = ok(
        &pool,
        "GET",
        &format!("/api/v1/articles/{KEMEJA}"),
        &[],
        None,
    )
    .await;
    assert_eq!(
        after["article_code"], KEMEJA,
        "the article is still itself: {after}"
    );
    let after_codes: Vec<String> = after["skus"]
        .as_array()
        .unwrap_or_else(|| panic!("no skus in {after}"))
        .iter()
        .map(|sku| {
            sku["sku_code"]
                .as_str()
                .unwrap_or_else(|| panic!("no sku_code in {sku}"))
                .to_owned()
        })
        .collect();
    assert_eq!(
        after_codes, sku_codes,
        "and every SKU still carries the eleven digits it was minted with: {after}"
    );

    let (status, body) = call(&pool, "GET", "/api/v1/articles/99999999", &[], None).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "no article was created at the code the request tried to claim: {body}"
    );
    let page = search(&pool, "q=99999999").await;
    assert!(
        codes(&page).is_empty(),
        "and nothing answers to it in the search either: {page}"
    );
}

// ---------------------------------------------------------------------------
// 8. The colour master
// ---------------------------------------------------------------------------

/// Two colours may not share a label, and a colour in use may not be deleted.
///
/// The whole reason `colour` exists is that `article_colour.label` was free
/// text, so "Navy", "navy" and "Biru Navy" became three colours across the
/// catalogue and no filter could see past the split. A master that permits
/// two rows both reading "Navy" recreates the split it was built to end — and
/// a master that permits deleting a colour something points at trades the
/// split for a dangling reference, which is worse.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_colour_master_refuses_a_second_navy_and_will_not_lose_one_in_use(pool: PgPool) {
    catalogue(&pool).await;

    // The guard, at the table. Case and surrounding space are not a
    // difference: they are how the split happened the first time.
    let duplicate = sqlx::query("INSERT INTO colour (code, label) VALUES ('TEST_NAVY_2', $1)")
        .bind("  test navy  ")
        .execute(&pool)
        .await;
    assert!(
        duplicate.is_err(),
        "a second row reading Test Navy is exactly the split this table prevents"
    );

    // The same guard, through the door a person actually uses.
    let (status, body) = call(
        &pool,
        "POST",
        "/api/v1/colours",
        &[("idempotency-key", "second-navy")],
        Some(json!({
            "code": "TEST_NAVY_ALT",
            "label": "  test navy  ",
            "hex_code": "#1B2A4B",
        })),
    )
    .await;
    assert!(
        status.is_client_error(),
        "minting a second Navy is refused rather than accepted: {status} {body}"
    );

    let vocabulary = ok(&pool, "GET", "/api/v1/colours", &[], None).await;
    let navies = vocabulary["colours"]
        .as_array()
        .unwrap_or_else(|| panic!("no colours in {vocabulary}"))
        .iter()
        .filter(|colour| {
            colour["label"]
                .as_str()
                .is_some_and(|label| label.trim().eq_ignore_ascii_case("test navy"))
        })
        .count();
    assert_eq!(
        navies, 1,
        "one colour reads Test Navy, before and after the attempt: {vocabulary}"
    );

    // `in_use` is what lets the master screen refuse to retire a colour, so it
    // has to be true rather than merely present.
    let in_use = |code: &str| -> i64 {
        vocabulary["colours"]
            .as_array()
            .unwrap_or_else(|| panic!("no colours in {vocabulary}"))
            .iter()
            .find(|colour| colour["code"] == json!(code))
            .and_then(|colour| colour["in_use"].as_i64())
            .unwrap_or_else(|| panic!("no colour {code} in {vocabulary}"))
    };
    assert_eq!(
        in_use("TEST_HITAM"),
        1,
        "one article wears black: {vocabulary}"
    );
    assert_eq!(
        in_use("TEST_W08"),
        0,
        "and nothing wears this one, which is what makes it retirable: {vocabulary}"
    );

    // A colour nothing points at can go.
    sqlx::query("DELETE FROM colour WHERE code = 'TEST_W08'")
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("delete an unused colour: {e}"));

    // One that something points at cannot — enforced by the reference, not by
    // a check somebody has to remember to write. Deactivating is the way out.
    let in_use_delete = sqlx::query("DELETE FROM colour WHERE code = 'TEST_HITAM'")
        .execute(&pool)
        .await;
    assert!(
        in_use_delete.is_err(),
        "deleting a colour an article wears would leave that article pointing at \
         nothing; the master screen deactivates instead"
    );
}
