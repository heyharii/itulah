//! A paper in the drawer can say what it is and when it stops being worth
//! anything.
//!
//! Migration 0358 gave `document` its `doc_type`, `doc_number`, `issuer`,
//! `issued_on` and `expires_on` columns. Until this suite existed no code path
//! could fill or read one of them, which made the asset hub's "Dokumen" tab and
//! the Overview's "papers about to lapse" section permanently empty — columns
//! with a feature behind them and no way in. So what is proved here is the round
//! trip, the one refusal 0358 puts on the pair of dates, and the link that lets
//! one asset's papers be told from everybody else's.
//!
//! `sqlx::test` builds a throwaway database per test and drops it afterwards,
//! so nothing below leaves a fixture in a database somebody is using.

use chrono::NaiveDate;
use inventory_backend::cloud::{
    application::AppError,
    postgres::{self as cloud, DocumentLink, DocumentQuery, FileDocumentRequest},
    AppConfig, AppState,
};
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

const ACTOR: &str = "ana";

/// No bucket, like every other suite here. `attachments: None` is not a gap in
/// the fixture but the point of it: a document filed from a file this node
/// already holds needs no object store, and that is the one way into the drawer
/// that a test can take.
fn config() -> AppConfig {
    AppConfig {
        po_import: inventory_backend::cloud::intake::po::PoImportConfig::from_env(),
        clock: None,
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|error| panic!("socket address: {error}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "cloud".into(),
        node_role: "STORE".into(),
        rfid_burst_window_seconds: 10,
        observed_window_hours: 24,
        lost_risk_window_days: 30,
        enable_test_controls: false,
        finance_automation_enabled: false,
        frontend_dir: std::path::PathBuf::from("nonexistent"),
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

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day)
        .unwrap_or_else(|| panic!("{year}-{month:02}-{day:02} is not a date"))
}

/// A file this node already holds, which `file_document` will accept as the
/// bytes for a document. `DATABASE` rather than `OBJECT` because 0040's CHECK
/// ties an object-stored file to a key and forbids it bytes, and there is no
/// bucket here to key into.
async fn held_file(pool: &PgPool) -> Uuid {
    let file_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO stored_file
             (file_id, file_name, content_type, byte_size, sha256, storage, bytes, uploaded_by)
         VALUES ($1,'IMG_20260924.jpg','image/jpeg',2048,$2,'DATABASE',$3,$4)",
    )
    .bind(file_id)
    .bind("0".repeat(64))
    .bind(vec![0u8; 16])
    .bind(ACTOR)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("hold a file to file from: {error}"));
    file_id
}

/// A filing with nothing filled in but the file, so each test adds exactly the
/// fields it is about.
fn a_filing(file_id: Uuid, file_name: &str) -> FileDocumentRequest {
    FileDocumentRequest {
        upload_id: None,
        file_id: Some(file_id),
        file_name: file_name.to_owned(),
        content_type: Some("image/jpeg".into()),
        sha256: None,
        title: None,
        path_tokens: vec!["GA".into(), "Kendaraan".into()],
        language: None,
        doc_date: None,
        doc_type: None,
        doc_number: None,
        issuer: None,
        issued_on: None,
        expires_on: None,
        tags: Vec::new(),
        links: Vec::new(),
    }
}

async fn file_it(
    state: &AppState,
    pool: &PgPool,
    name: &str,
    asset: Option<Uuid>,
) -> cloud::Document {
    let mut request = a_filing(held_file(pool).await, name);
    request.links = asset
        .map(|subject_id| {
            vec![DocumentLink {
                subject_kind: "asset".into(),
                subject_id: subject_id.to_string(),
            }]
        })
        .unwrap_or_default();
    cloud::file_document(state, request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("file {name}: {error}"))
}

/// Ask the drawer for one asset's papers. Spelled out because every test that
/// uses it is asking the same question the hub's Dokumen tab asks.
async fn papers_of(
    pool: &PgPool,
    subject_kind: &str,
    subject_id: Option<Uuid>,
) -> Vec<cloud::Document> {
    cloud::search_documents(
        pool,
        DocumentQuery {
            subject_kind: Some(subject_kind.to_owned()),
            subject_id: subject_id.map(|id| id.to_string()),
            limit: 60,
            ..DocumentQuery::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("search {subject_kind}/{subject_id:?}: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_filed_paper_keeps_what_it_is_and_when_it_lapses(pool: PgPool) {
    let state = AppState::new(pool.clone(), config());
    let mut request = a_filing(held_file(&pool).await, "stnk.jpg");
    request.doc_type = Some("STNK".into());
    request.doc_number = Some("B 1234 XYZ / 7712345".into());
    request.issuer = Some("Bapenda / Samsat".into());
    request.issued_on = Some(date(2026, 1, 15));
    request.expires_on = Some(date(2027, 1, 15));

    // What the client got back from the filing itself.
    let filed = cloud::file_document(&state, request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("file a STNK: {error}"));
    assert_eq!(filed.doc_type.as_deref(), Some("STNK"));

    // And what the drawer reads back afterwards, which is the SELECT rather
    // than the values the INSERT still had in hand.
    let read = cloud::read_document(&pool, filed.document_id)
        .await
        .unwrap_or_else(|error| panic!("read the STNK back: {error}"));
    assert_eq!(read.doc_type.as_deref(), Some("STNK"));
    assert_eq!(read.doc_number.as_deref(), Some("B 1234 XYZ / 7712345"));
    assert_eq!(read.issuer.as_deref(), Some("Bapenda / Samsat"));
    assert_eq!(read.issued_on, Some(date(2026, 1, 15)));
    assert_eq!(read.expires_on, Some(date(2027, 1, 15)));
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_paper_that_lapses_before_it_was_issued_is_refused_in_words(pool: PgPool) {
    let state = AppState::new(pool.clone(), config());
    let mut request = a_filing(held_file(&pool).await, "slo.jpg");
    request.doc_type = Some("SLO".into());
    request.issued_on = Some(date(2026, 6, 1));
    request.expires_on = Some(date(2025, 6, 1));

    // The rule is 0358's CHECK, so the refusal comes from the database and the
    // handler must translate it rather than flatten it into a 500 nobody can
    // act on. `document` is named because that is what the person is filling
    // in; the constraint is named so a log can be searched for it.
    match cloud::file_document(&state, request, ACTOR).await {
        Err(AppError::Validation(message)) => {
            assert!(
                message.contains("expires before it was issued"),
                "the refusal says what is wrong: {message}"
            );
            assert!(
                message.contains("document_expiry_is_after_issue"),
                "the refusal names the constraint: {message}"
            );
        }
        other => panic!("expected the database's own refusal, got {other:?}"),
    }

    // And nothing was left behind: the half-written filing rolled back with
    // the transaction rather than landing in the drawer with a bad date.
    let filed: i64 = sqlx::query_scalar("SELECT count(*)::bigint FROM document")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|error| panic!("count the drawer: {error}"));
    assert_eq!(filed, 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_paper_with_no_expiry_date_is_a_filing_and_not_a_gap(pool: PgPool) {
    let state = AppState::new(pool.clone(), config());
    let mut request = a_filing(held_file(&pool).await, "bpkb.jpg");
    request.doc_type = Some("BPKB".into());
    request.doc_number = Some("F 9876 AB".into());

    // A BPKB has no expiry at all. Filing it must not need one — and reading it
    // back must say `None` rather than an empty string or an invented date,
    // because `None` is what tells the screen this paper has no such date as
    // opposed to a field somebody forgot.
    let filed = cloud::file_document(&state, request, ACTOR)
        .await
        .unwrap_or_else(|error| panic!("file a BPKB: {error}"));
    assert_eq!(filed.issued_on, None);
    assert_eq!(filed.expires_on, None);

    let read = cloud::read_document(&pool, filed.document_id)
        .await
        .unwrap_or_else(|error| panic!("read the BPKB back: {error}"));
    assert_eq!(read.doc_type.as_deref(), Some("BPKB"));
    assert_eq!(read.doc_number.as_deref(), Some("F 9876 AB"));
    assert_eq!(read.issued_on, None);
    assert_eq!(read.expires_on, None);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn only_the_papers_filed_against_an_asset_come_back_for_that_asset(pool: PgPool) {
    let state = AppState::new(pool.clone(), config());
    let this_machine = Uuid::new_v4();
    let another_machine = Uuid::new_v4();

    let ours = file_it(&state, &pool, "stnk.jpg", Some(this_machine)).await;
    let theirs = file_it(&state, &pool, "bpkb.jpg", Some(another_machine)).await;
    let unlinked = file_it(&state, &pool, "garansi.jpg", None).await;

    let found = papers_of(&pool, "asset", Some(this_machine)).await;
    let ids: Vec<Uuid> = found.iter().map(|document| document.document_id).collect();
    assert_eq!(ids, vec![ours.document_id]);
    assert!(!ids.contains(&unlinked.document_id));

    // The link travels back with the document, which is what lets the hub's
    // tab tell this machine's papers from another's that happen to be filed in
    // the same drawer.
    assert_eq!(found[0].links.len(), 1);
    assert_eq!(found[0].links[0].subject_kind, "asset");
    assert_eq!(found[0].links[0].subject_id, this_machine.to_string());

    // The other machine's papers are the other machine's, so the filter is
    // reading the subject id and not only the kind.
    let others = papers_of(&pool, "asset", Some(another_machine)).await;
    assert_eq!(others.len(), 1);
    assert_eq!(others[0].document_id, theirs.document_id);

    // And a paper filed against nothing at all belongs to no asset, so it
    // cannot turn up as somebody's document just because the kind matched.
    let every_asset_paper = papers_of(&pool, "asset", None).await;
    assert_eq!(every_asset_paper.len(), 2);
}
