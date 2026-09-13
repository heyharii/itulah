use axum::body::{to_bytes, Body};
use chrono::{Duration, Utc};
use http::Request;
use inventory_backend::cloud::{
    application::{
        AddSaleLineRequest, AddSalePaymentRequest, AllotmentQuery, AvailabilityQuery,
        CancelAllotmentRequest, CommandRequest, CommercialMarkdownInput, CommercialOfferRuleInput,
        CommercialTaxRuleInput, CorruptProjectionRequest, CreateAllotmentLineInput,
        CreateAllotmentRequest, CreateCommercialPublicationRequest, CreateCountRequest,
        CreateMovementRequest, CreateSaleRequest, ExecuteAllotmentRequest,
        MissingResolutionRequest, MovementLineRequest, ObservationBatchRequest, ReplayRequest,
        ReplayScope, RepostRequest, ResolveOfferQuery,
    },
    domain::{AllotmentType, CommercialChannel, CountKind, DestinationType, RfidRead},
    http as api_http, postgres as infrastructure, AppConfig, AppState,
};
use sqlx::{PgPool, Row};
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

fn movement(epc: &str, from: &str, to: &str, cause: &str, key: &str) -> CreateMovementRequest {
    CreateMovementRequest {
        idempotency_key: key.into(),
        actor_id: "integration-test".into(),
        occurred_at: None,
        reason: "Integration invariant test".into(),
        reference_type: Some("TEST".into()),
        reference_id: Some("TEST-001".into()),
        cause: Some(cause.into()),
        lines: vec![MovementLineRequest {
            subject_id: None,
            epc: Some(epc.into()),
            quantity: 1,
            from: from.into(),
            to: to.into(),
        }],
    }
}

async fn fact_count(pool: &PgPool) -> i64 {
    sqlx::query("SELECT count(*)::bigint count FROM movement")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("fact count: {e}"))
        .get("count")
}

async fn company_quantity(pool: &PgPool) -> i64 {
    sqlx::query("SELECT COALESCE(sum(quantity),0)::bigint quantity FROM inventory_projection")
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("company quantity: {e}"))
        .get("quantity")
}

async fn sku_place_quantity(pool: &PgPool, sku_id: Uuid, place_id: &str) -> i64 {
    sqlx::query("SELECT COALESCE(SUM(CASE WHEN m.to_place_id=$2 THEN m.quantity WHEN m.from_place_id=$2 THEN -m.quantity ELSE 0 END),0)::bigint quantity FROM movement m JOIN inventory_subject s ON s.id=m.subject_id WHERE s.sku_id=$1 AND (m.to_place_id=$2 OR m.from_place_id=$2)")
        .bind(sku_id)
        .bind(place_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("SKU place quantity: {e}"))
        .get("quantity")
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn inventory_foundation_end_to_end(pool: PgPool) {
    let pools = infrastructure::list_pools(&pool, None, 24, 30)
        .await
        .unwrap_or_else(|e| panic!("list pools: {e}"));
    let pool_items = pools["items"]
        .as_array()
        .unwrap_or_else(|| panic!("pool array"));
    assert_eq!(pool_items.len(), 112);
    assert_eq!(
        pool_items.iter().filter(|p| p["site_id"] == "dc").count(),
        73
    );
    assert_eq!(
        pool_items
            .iter()
            .filter(|p| p["site_kind"] == "STORE")
            .count(),
        39
    );

    // The real Axum router serves both typed APIs and the dependency-free HTML application.
    let app = api_http::router(AppState::new(
        pool.clone(),
        AppConfig {
            bind_addr: "127.0.0.1:0"
                .parse::<SocketAddr>()
                .unwrap_or_else(|e| panic!("socket address: {e}")),
            database_url: "postgresql:///sqlx-test".into(),
            node_id: "integration-edge".into(),
            node_role: "STORE".into(),
            rfid_burst_window_seconds: 10,
            observed_window_hours: 24,
            lost_risk_window_days: 30,
            enable_test_controls: true,
            frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
            sync_upload_url: None,
            sync_upload_key: None,
            sync_ingest_key: None,
            sync_generation: 1,
            sync_enqueue_enabled: false,
            sync_interval_seconds: 5,
            sync_batch_limit: 100,
            sync_breaker_threshold: 5,
            sync_breaker_base_cooldown_seconds: 30,
            sync_breaker_max_cooldown_seconds: 900,
            sync_retention_days: 14,
            sync_degraded_after_seconds: 900,
            sync_apply_enabled: false,
            jwt_secret: None,
            auth_token_ttl_minutes: 720,
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
        },
    ));
    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health")
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("health request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("health response: {e}"));
    assert_eq!(health.status(), 200);
    let index = app
        .oneshot(
            Request::builder()
                .uri("/")
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("index request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("index response: {e}"));
    assert_eq!(index.status(), 200);
    let index_body = to_bytes(index.into_body(), 2_000_000)
        .await
        .unwrap_or_else(|e| panic!("index body: {e}"));
    assert!(String::from_utf8_lossy(&index_body).contains("Inventory Edge"));

    // Normal Store Warehouse -> Floor is conserved and retry-safe.
    let company_before = company_quantity(&pool).await;
    let facts_before = fact_count(&pool).await;
    let request = movement(
        "EPC00000006",
        "store-07.warehouse:on_hand",
        "store-07.floor:on_hand",
        "NORMAL_MOVE",
        "test-move-warehouse-floor",
    );
    let first = infrastructure::create_movement(&pool, request.clone())
        .await
        .unwrap_or_else(|e| panic!("first movement: {e}"));
    let retry = infrastructure::create_movement(&pool, request)
        .await
        .unwrap_or_else(|e| panic!("movement retry: {e}"));
    assert_eq!(first, retry);
    assert_eq!(fact_count(&pool).await, facts_before + 1);
    assert_eq!(company_quantity(&pool).await, company_before);

    let conflicting = movement(
        "EPC00000007",
        "store-07.warehouse:on_hand",
        "store-07.floor:on_hand",
        "NORMAL_MOVE",
        "test-move-warehouse-floor",
    );
    assert!(infrastructure::create_movement(&pool, conflicting)
        .await
        .is_err());

    // Placement correction remains a fact and can cross sites only via the correction path.
    let correction = inventory_backend::cloud::application::CorrectPlacementRequest {
        idempotency_key: "test-correction-cross-site".into(),
        actor_id: "inventory-auditor".into(),
        occurred_at: None,
        reason: "Physical investigation proved placement".into(),
        evidence_reference: "PHOTO-TEST-001".into(),
        notes: Some("Cross-site correction is intentionally explicit".into()),
        line: MovementLineRequest {
            subject_id: None,
            epc: Some("EPC00000006".into()),
            quantity: 1,
            from: "store-07.floor:on_hand".into(),
            to: "store-04.warehouse:on_hand".into(),
        },
    };
    infrastructure::correct_placement(&pool, correction)
        .await
        .unwrap_or_else(|e| panic!("correction: {e}"));

    // Sale is the only tested company boundary reduction.
    let sale_before = company_quantity(&pool).await;
    infrastructure::create_movement(
        &pool,
        movement(
            "EPC00000001",
            "store-07.floor:on_hand",
            "external/customer",
            "SALE",
            "test-sale",
        ),
    )
    .await
    .unwrap_or_else(|e| panic!("sale: {e}"));
    assert_eq!(company_quantity(&pool).await, sale_before - 1);

    // Observation consolidates burst noise, is idempotent, retains event time, and writes no inventory facts.
    let observation_time = Utc::now() - Duration::hours(2);
    let observation = ObservationBatchRequest {
        site_id: "store-07".into(),
        pool: "store-07.floor".into(),
        device_id: "RFID-HH-07-TEST".into(),
        reader_session_id: "SESSION-OFFLINE-TEST".into(),
        observed_at: observation_time,
        idempotency_key: "test-rfid-batch".into(),
        observations: vec![
            RfidRead {
                epc: "EPC00000007".into(),
                antenna: Some("A1".into()),
                rssi: Some(-55.0),
                phase: None,
                frequency: None,
                read_count: 1,
            },
            RfidRead {
                epc: "EPC00000007".into(),
                antenna: Some("A1".into()),
                rssi: Some(-44.0),
                phase: None,
                frequency: None,
                read_count: 79,
            },
        ],
    };
    let observation_facts = fact_count(&pool).await;
    let missing_before: i64 = sqlx::query("SELECT count(*)::bigint count FROM inventory_projection p JOIN inventory_place ip ON ip.id=p.place_id WHERE ip.state='MISSING'")
        .fetch_one(&pool).await.unwrap_or_else(|e| panic!("missing count: {e}")).get("count");
    let observed = infrastructure::ingest_observations(&pool, observation.clone(), 10)
        .await
        .unwrap_or_else(|e| panic!("observation: {e}"));
    let observed_retry = infrastructure::ingest_observations(&pool, observation, 10)
        .await
        .unwrap_or_else(|e| panic!("observation retry: {e}"));
    assert_eq!(observed, observed_retry);
    assert_eq!(observed["raw_read_count"], 80);
    assert_eq!(observed["consolidated_sighting_count"], 1);
    assert_eq!(observed["inventory_effect"]["movement_count"], 0);
    assert_eq!(fact_count(&pool).await, observation_facts);
    let missing_after: i64 = sqlx::query("SELECT count(*)::bigint count FROM inventory_projection p JOIN inventory_place ip ON ip.id=p.place_id WHERE ip.state='MISSING'")
        .fetch_one(&pool).await.unwrap_or_else(|e| panic!("missing count: {e}")).get("count");
    assert_eq!(missing_before, missing_after);
    let stored_time: chrono::DateTime<Utc> = sqlx::query(
        "SELECT first_seen_at FROM observation_sighting WHERE device_id='RFID-HH-07-TEST'",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("stored observation: {e}"))
    .get("first_seen_at");
    assert_eq!(stored_time, observation_time);
    let anomalies = infrastructure::observation_anomalies(&pool)
        .await
        .unwrap_or_else(|e| panic!("anomalies: {e}"));
    assert!(anomalies["items"]
        .as_array()
        .unwrap_or_else(|| panic!("anomaly array"))
        .iter()
        .any(|a| a["epc"] == "EPC00000007" && a["type"] == "PLACEMENT_MISMATCH"));

    // Targeted official count snapshots expected, then approval writes On Hand -> Missing exactly once.
    let count = infrastructure::create_count(
        &pool,
        CreateCountRequest {
            site_id: "store-07".into(),
            pool_id: "store-07.warehouse".into(),
            kind: CountKind::Targeted,
            sku_ids: vec![],
            epcs: vec!["EPC00000008".into(), "EPC00000009".into()],
            reason: "Targeted integration count".into(),
            actor_id: "count-lead".into(),
            idempotency_key: "test-count-create".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("create count: {e}"));
    let count_id = Uuid::parse_str(count["id"].as_str().unwrap_or_else(|| panic!("count id")))
        .unwrap_or_else(|e| panic!("count uuid: {e}"));
    infrastructure::activate_count(
        &pool,
        count_id,
        CommandRequest {
            actor_id: "count-lead".into(),
            idempotency_key: "test-count-activate".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("activate: {e}"));
    infrastructure::submit_count(
        &pool,
        count_id,
        CommandRequest {
            actor_id: "count-lead".into(),
            idempotency_key: "test-count-submit".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("submit: {e}"));
    let count_facts = fact_count(&pool).await;
    let approval_request = CommandRequest {
        actor_id: "count-supervisor".into(),
        idempotency_key: "test-count-approve".into(),
    };
    let approved = infrastructure::approve_count(&pool, count_id, approval_request.clone())
        .await
        .unwrap_or_else(|e| panic!("approve: {e}"));
    let approved_retry = infrastructure::approve_count(&pool, count_id, approval_request)
        .await
        .unwrap_or_else(|e| panic!("approve retry: {e}"));
    assert_eq!(approved, approved_retry);
    assert_eq!(approved["movement_count"], 2);
    assert_eq!(fact_count(&pool).await, count_facts + 2);

    let missing = infrastructure::list_missing(&pool)
        .await
        .unwrap_or_else(|e| panic!("list missing: {e}"));
    let missing_items = missing["items"]
        .as_array()
        .unwrap_or_else(|| panic!("missing items"));
    let missing_8 = missing_items
        .iter()
        .find(|m| m["epc"] == "EPC00000008")
        .unwrap_or_else(|| panic!("EPC8 missing"));
    let missing_9 = missing_items
        .iter()
        .find(|m| m["epc"] == "EPC00000009")
        .unwrap_or_else(|| panic!("EPC9 missing"));
    infrastructure::resolve_missing_found(
        &pool,
        missing_8["id"].as_str().unwrap_or_default(),
        MissingResolutionRequest {
            actor_id: "investigator".into(),
            idempotency_key: "test-found".into(),
            quantity: None,
            destination_pool_id: None,
            reason: "Found in origin pool".into(),
            reference: Some("INV-8".into()),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("found: {e}"));
    infrastructure::resolve_missing_lost(
        &pool,
        missing_9["id"].as_str().unwrap_or_default(),
        MissingResolutionRequest {
            actor_id: "investigator".into(),
            idempotency_key: "test-lost".into(),
            quantity: None,
            destination_pool_id: None,
            reason: "Confirmed lost after investigation".into(),
            reference: Some("INV-9".into()),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("lost: {e}"));

    // Time Machine uses facts at T and never mutates current state.
    let historical =
        infrastructure::list_pools(&pool, Some(Utc::now() - Duration::days(30)), 24, 30)
            .await
            .unwrap_or_else(|e| panic!("as of: {e}"));
    assert!(historical["read_only"].as_bool().unwrap_or(false));
    assert_ne!(
        historical["items"],
        infrastructure::list_pools(&pool, None, 24, 30)
            .await
            .unwrap_or_else(|e| panic!("current pools: {e}"))["items"]
    );

    // Replay is read-only. Deliberate test corruption is repaired by Repost without a movement.
    let replay = infrastructure::run_replay(
        &pool,
        ReplayRequest {
            scope: ReplayScope::default(),
            actor_id: "controller".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("replay: {e}"));
    assert_eq!(replay["status"], "MATCH");
    let projection_row = sqlx::query(
        "SELECT subject_id,place_id FROM inventory_projection ORDER BY subject_id LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("projection row: {e}"));
    let subject_id: Uuid = projection_row.get("subject_id");
    let place_id: String = projection_row.get("place_id");
    infrastructure::corrupt_projection_for_test(
        &pool,
        CorruptProjectionRequest {
            subject_id,
            place_id,
            delta: 1,
        },
        true,
    )
    .await
    .unwrap_or_else(|e| panic!("corrupt: {e}"));
    let corrupted = infrastructure::run_replay(
        &pool,
        ReplayRequest {
            scope: ReplayScope::default(),
            actor_id: "controller".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("corrupt replay: {e}"));
    assert_eq!(corrupted["status"], "DIFFERENCE");
    let repost_fact_count = fact_count(&pool).await;
    let repost = infrastructure::run_repost(
        &pool,
        RepostRequest {
            scope: ReplayScope::default(),
            actor_id: "controller".into(),
            idempotency_key: "test-repost".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("repost: {e}"));
    assert_eq!(repost["ledger_facts_created"], 0);
    assert_eq!(fact_count(&pool).await, repost_fact_count);
    let repaired = infrastructure::run_replay(
        &pool,
        ReplayRequest {
            scope: ReplayScope::default(),
            actor_id: "controller".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("repaired replay: {e}"));
    assert_eq!(repaired["status"], "MATCH");

    // Subject row locking makes two concurrent movements from the same EPC serialize; only one succeeds.
    let a = movement(
        "EPC00000010",
        "store-07.warehouse:on_hand",
        "store-07.floor:on_hand",
        "NORMAL_MOVE",
        "test-concurrent-a",
    );
    let b = movement(
        "EPC00000010",
        "store-07.warehouse:on_hand",
        "store-07.floor:on_hand",
        "NORMAL_MOVE",
        "test-concurrent-b",
    );
    let (ra, rb) = tokio::join!(
        infrastructure::create_movement(&pool, a),
        infrastructure::create_movement(&pool, b)
    );
    assert_ne!(
        ra.is_ok(),
        rb.is_ok(),
        "exactly one concurrent movement must succeed"
    );

    // Database trigger rejects mutation of historical movement facts.
    let mutation=sqlx::query("UPDATE movement SET actor_id='tampered' WHERE movement_id=(SELECT movement_id FROM movement LIMIT 1)").execute(&pool).await;
    assert!(mutation.is_err());

    // Final replay proves current inventory reconstructs entirely from the append-only ledger.
    let final_replay = infrastructure::run_replay(
        &pool,
        ReplayRequest {
            scope: ReplayScope::default(),
            actor_id: "controller".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("final replay: {e}"));
    assert_eq!(final_replay["status"], "MATCH");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn commercial_and_store_sales_are_versioned_atomic_and_retry_safe(pool: PgPool) {
    let sku_rows = sqlx::query("SELECT id,sku_code FROM sku WHERE active ORDER BY sku_code")
        .fetch_all(&pool)
        .await
        .unwrap_or_else(|e| panic!("active SKUs: {e}"));
    assert_eq!(sku_rows.len(), 18);
    let target_sku: Uuid =
        sqlx::query("SELECT sku_id FROM inventory_subject WHERE epc='EPC00000002'")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("target SKU: {e}"))
            .get::<Option<Uuid>, _>("sku_id")
            .unwrap_or_else(|| panic!("target subject SKU"));

    let mut offer_rules: Vec<CommercialOfferRuleInput> = sku_rows
        .iter()
        .enumerate()
        .map(|(index, row)| CommercialOfferRuleInput {
            site_ids: None,
            sku_id: row.get("id"),
            site_id: None,
            channel: CommercialChannel::Store,
            sellable: true,
            currency: "IDR".into(),
            unit_price_minor: 200_000 + (index as i64 * 1_000),
            tax_category: "STANDARD".into(),
        })
        .collect();
    offer_rules.push(CommercialOfferRuleInput {
        site_ids: None,
        sku_id: target_sku,
        site_id: Some("store-07".into()),
        channel: CommercialChannel::Store,
        sellable: true,
        currency: "IDR".into(),
        unit_price_minor: 250_000,
        tax_category: "STANDARD".into(),
    });
    let publication_request = CreateCommercialPublicationRequest {
        change_type: None,
        campaigns: Vec::new(),
        markdowns: Vec::new(),
        rules: Vec::new(),
        coupons: Vec::new(),
        version: 2,
        name: "Integration Store Price Book v2".into(),
        effective_from: Utc::now() - Duration::minutes(1),
        effective_to: None,
        tax_rules: vec![CommercialTaxRuleInput {
            tax_category: "STANDARD".into(),
            rate_bps: 1_100,
            tax_inclusive: true,
        }],
        offer_rules,
        actor_id: "commercial-manager".into(),
        idempotency_key: "commercial-v2-create".into(),
    };
    let publication =
        infrastructure::create_commercial_publication(&pool, publication_request.clone())
            .await
            .unwrap_or_else(|e| panic!("create publication: {e}"));
    let publication_retry =
        infrastructure::create_commercial_publication(&pool, publication_request)
            .await
            .unwrap_or_else(|e| panic!("create publication retry: {e}"));
    assert_eq!(publication, publication_retry);
    let publication_id = Uuid::parse_str(
        publication["id"]
            .as_str()
            .unwrap_or_else(|| panic!("publication id")),
    )
    .unwrap_or_else(|e| panic!("publication UUID: {e}"));
    let publish_request = CommandRequest {
        actor_id: "commercial-approver".into(),
        idempotency_key: "commercial-v2-publish".into(),
    };
    let published = infrastructure::publish_commercial_publication(
        &pool,
        publication_id,
        publish_request.clone(),
    )
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));
    let publish_retry =
        infrastructure::publish_commercial_publication(&pool, publication_id, publish_request)
            .await
            .unwrap_or_else(|e| panic!("publish retry: {e}"));
    assert_eq!(published, publish_retry);

    let store_07_offer = infrastructure::resolve_offer(
        &pool,
        ResolveOfferQuery {
            sku_id: target_sku,
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            at: None,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("store-07 offer: {e}"));
    assert_eq!(store_07_offer["version"], 2);
    assert_eq!(store_07_offer["unit_price_minor"], 250_000);
    let store_08_offer = infrastructure::resolve_offer(
        &pool,
        ResolveOfferQuery {
            sku_id: target_sku,
            site_id: "store-08".into(),
            channel: CommercialChannel::Store,
            at: None,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("store-08 offer: {e}"));
    assert_eq!(store_08_offer["version"], 2);
    assert_ne!(store_08_offer["unit_price_minor"], 250_000);

    let mutation =
        sqlx::query("UPDATE commercial_price_rule SET unit_price_minor=1 WHERE publication_id=$1")
            .bind(publication_id)
            .execute(&pool)
            .await;
    assert!(mutation.is_err(), "published prices must be immutable");

    let sale_request = CreateSaleRequest {
        customer_id: None,
        site_id: "store-07".into(),
        channel: CommercialChannel::Store,
        actor_id: "cashier-07".into(),
        idempotency_key: "sales-test-create".into(),
    };
    let sale = infrastructure::create_sale(&pool, sale_request.clone())
        .await
        .unwrap_or_else(|e| panic!("create sale: {e}"));
    assert_eq!(
        sale,
        infrastructure::create_sale(&pool, sale_request)
            .await
            .unwrap_or_else(|e| panic!("create sale retry: {e}"))
    );
    assert_eq!(sale["commercial_version"], 2);
    let sale_id = Uuid::parse_str(sale["id"].as_str().unwrap_or_else(|| panic!("sale id")))
        .unwrap_or_else(|e| panic!("sale UUID: {e}"));
    let line_request = AddSaleLineRequest {
        epc: "EPC00000002".into(),
        quantity: 1,
        actor_id: "cashier-07".into(),
        idempotency_key: "sales-test-line".into(),
    };
    let line = infrastructure::add_sale_line(&pool, sale_id, line_request.clone())
        .await
        .unwrap_or_else(|e| panic!("add line: {e}"));
    assert_eq!(
        line,
        infrastructure::add_sale_line(&pool, sale_id, line_request)
            .await
            .unwrap_or_else(|e| panic!("line retry: {e}"))
    );
    assert_eq!(line["unit_price_minor"], 250_000);
    assert_eq!(line["commercial_version"], 2);
    assert!(line["price_snapshot_digest"].as_str().is_some());
    let payment_request = AddSalePaymentRequest {
        method: "CASH".into(),
        amount_minor: 300_000,
        reference: None,
        actor_id: "cashier-07".into(),
        idempotency_key: "sales-test-payment".into(),
    };
    let payment = infrastructure::add_sale_payment(&pool, sale_id, payment_request.clone())
        .await
        .unwrap_or_else(|e| panic!("payment: {e}"));
    assert_eq!(
        payment,
        infrastructure::add_sale_payment(&pool, sale_id, payment_request)
            .await
            .unwrap_or_else(|e| panic!("payment retry: {e}"))
    );
    let facts_before = fact_count(&pool).await;
    let company_before = company_quantity(&pool).await;
    let completion_request = CommandRequest {
        actor_id: "cashier-07".into(),
        idempotency_key: "sales-test-complete".into(),
    };
    let completed = infrastructure::complete_sale(&pool, sale_id, completion_request.clone())
        .await
        .unwrap_or_else(|e| panic!("complete sale: {e}"));
    let completion_retry = infrastructure::complete_sale(&pool, sale_id, completion_request)
        .await
        .unwrap_or_else(|e| panic!("complete retry: {e}"));
    assert_eq!(completed, completion_retry);
    assert_eq!(completed["status"], "COMPLETED");
    assert_eq!(completed["change_minor"], 50_000);
    assert_eq!(fact_count(&pool).await, facts_before + 1);
    assert_eq!(company_quantity(&pool).await, company_before - 1);
    let completed_detail = infrastructure::get_sale(&pool, sale_id)
        .await
        .unwrap_or_else(|e| panic!("completed detail: {e}"));
    assert_eq!(completed_detail["lines"][0]["unit_price_minor"], 250_000);
    assert_eq!(completed_detail["lines"][0]["commercial_version"], 2);
    assert!(completed_detail["movement_group_id"].as_str().is_some());

    // The same verified commercial and sale records are reachable through the real Axum routes.
    let app = api_http::router(AppState::new(
        pool.clone(),
        AppConfig {
            bind_addr: "127.0.0.1:0"
                .parse::<SocketAddr>()
                .unwrap_or_else(|e| panic!("socket address: {e}")),
            database_url: "postgresql:///sqlx-test".into(),
            node_id: "integration-store-07".into(),
            node_role: "STORE".into(),
            rfid_burst_window_seconds: 10,
            observed_window_hours: 24,
            lost_risk_window_days: 30,
            enable_test_controls: false,
            frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
            sync_upload_url: None,
            sync_upload_key: None,
            sync_ingest_key: None,
            sync_generation: 1,
            sync_enqueue_enabled: false,
            sync_interval_seconds: 5,
            sync_batch_limit: 100,
            sync_breaker_threshold: 5,
            sync_breaker_base_cooldown_seconds: 30,
            sync_breaker_max_cooldown_seconds: 900,
            sync_retention_days: 14,
            sync_degraded_after_seconds: 900,
            sync_apply_enabled: false,
            jwt_secret: None,
            auth_token_ttl_minutes: 720,
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
        },
    ));
    let offers_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/commercial/offers?site_id=store-07&channel=STORE")
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("offers request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("offers response: {e}"));
    assert_eq!(offers_response.status(), 200);
    let sale_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/sales/{sale_id}"))
                .body(Body::empty())
                .unwrap_or_else(|e| panic!("sale request: {e}")),
        )
        .await
        .unwrap_or_else(|e| panic!("sale response: {e}"));
    assert_eq!(sale_response.status(), 200);

    // A failed completion writes neither a sale completion nor an inventory movement.
    let unpaid_sale = infrastructure::create_sale(
        &pool,
        CreateSaleRequest {
            customer_id: None,
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            actor_id: "cashier-07".into(),
            idempotency_key: "sales-unpaid-create".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("unpaid sale: {e}"));
    let unpaid_id = Uuid::parse_str(unpaid_sale["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("unpaid UUID: {e}"));
    infrastructure::add_sale_line(
        &pool,
        unpaid_id,
        AddSaleLineRequest {
            epc: "EPC00000003".into(),
            quantity: 1,
            actor_id: "cashier-07".into(),
            idempotency_key: "sales-unpaid-line".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("unpaid line: {e}"));
    let unpaid_facts = fact_count(&pool).await;
    assert!(infrastructure::complete_sale(
        &pool,
        unpaid_id,
        CommandRequest {
            actor_id: "cashier-07".into(),
            idempotency_key: "sales-unpaid-complete".into()
        }
    )
    .await
    .is_err());
    assert_eq!(fact_count(&pool).await, unpaid_facts);
    assert_eq!(
        infrastructure::get_sale(&pool, unpaid_id)
            .await
            .unwrap_or_else(|e| panic!("unpaid detail: {e}"))["status"],
        "OPEN"
    );

    // Two paid carts may contain the same EPC, but inventory locking allows only one completion.
    let mut concurrent = Vec::new();
    for suffix in ["a", "b"] {
        let created = infrastructure::create_sale(
            &pool,
            CreateSaleRequest {
                customer_id: None,
                site_id: "store-07".into(),
                channel: CommercialChannel::Store,
                actor_id: "cashier-07".into(),
                idempotency_key: format!("sales-race-create-{suffix}"),
            },
        )
        .await
        .unwrap_or_else(|e| panic!("race create: {e}"));
        let id = Uuid::parse_str(created["id"].as_str().unwrap_or_default())
            .unwrap_or_else(|e| panic!("race UUID: {e}"));
        let added = infrastructure::add_sale_line(
            &pool,
            id,
            AddSaleLineRequest {
                epc: "EPC00000004".into(),
                quantity: 1,
                actor_id: "cashier-07".into(),
                idempotency_key: format!("sales-race-line-{suffix}"),
            },
        )
        .await
        .unwrap_or_else(|e| panic!("race line: {e}"));
        infrastructure::add_sale_payment(
            &pool,
            id,
            AddSalePaymentRequest {
                method: "CASH".into(),
                amount_minor: added["total_minor"].as_i64().unwrap_or_default(),
                reference: None,
                actor_id: "cashier-07".into(),
                idempotency_key: format!("sales-race-pay-{suffix}"),
            },
        )
        .await
        .unwrap_or_else(|e| panic!("race payment: {e}"));
        concurrent.push((id, format!("sales-race-complete-{suffix}")));
    }
    let (first_id, first_key) = concurrent.remove(0);
    let (second_id, second_key) = concurrent.remove(0);
    let (first_result, second_result) = tokio::join!(
        infrastructure::complete_sale(
            &pool,
            first_id,
            CommandRequest {
                actor_id: "cashier-07".into(),
                idempotency_key: first_key
            }
        ),
        infrastructure::complete_sale(
            &pool,
            second_id,
            CommandRequest {
                actor_id: "cashier-07".into(),
                idempotency_key: second_key
            }
        )
    );
    assert_ne!(
        first_result.is_ok(),
        second_result.is_ok(),
        "only one sale may consume an EPC"
    );

    let replay = infrastructure::run_replay(
        &pool,
        ReplayRequest {
            scope: ReplayScope::default(),
            actor_id: "sales-controller".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("sales replay: {e}"));
    assert_eq!(replay["status"], "MATCH");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn allotment_is_a_concurrency_safe_commitment_and_pick_is_atomic(pool: PgPool) {
    let availability = infrastructure::get_availability(&pool, AvailabilityQuery::default())
        .await
        .unwrap_or_else(|e| panic!("initial availability: {e}"));
    let candidates: Vec<(Uuid, i64)> = availability["items"]
        .as_array()
        .unwrap_or_else(|| panic!("availability items"))
        .iter()
        .filter_map(|item| {
            let available = item["on_hand_qty"].as_i64()?;
            (available > 20).then(|| {
                (
                    Uuid::parse_str(item["sku_id"].as_str().unwrap_or_default())
                        .unwrap_or_else(|e| panic!("candidate SKU UUID: {e}")),
                    available,
                )
            })
        })
        .take(3)
        .collect();
    assert_eq!(candidates.len(), 3, "seed needs three Warehouse SKUs");
    let (cancel_sku, cancel_available) = candidates[0];
    let (pick_sku, _) = candidates[1];
    let (race_sku, _) = candidates[2];

    let facts_before_create = fact_count(&pool).await;
    let on_hand_before_create = sku_place_quantity(&pool, cancel_sku, "dc.warehouse:on_hand").await;
    let create_request = CreateAllotmentRequest {
        allotment_type: AllotmentType::ToStore,
        lines: vec![CreateAllotmentLineInput {
            source_site_id: "dc".into(),
            source_pool_id: "dc.warehouse".into(),
            destination_type: DestinationType::Store,
            destination_id: "store-01".into(),
            sku_id: cancel_sku,
            quantity: 10,
        }],
        notes: Some("No physical movement during planning".into()),
        actor_id: "allotment-planner".into(),
        idempotency_key: "allotment-create-no-movement".into(),
    };
    let created = infrastructure::create_allotment(&pool, create_request.clone())
        .await
        .unwrap_or_else(|e| panic!("create allotment: {e}"));
    assert_eq!(created["status"], "ACTIVE");
    assert_eq!(created["inventory_effect"]["movement_count"], 0);
    assert_eq!(
        created,
        infrastructure::create_allotment(&pool, create_request)
            .await
            .unwrap_or_else(|e| panic!("create retry: {e}"))
    );
    assert_eq!(fact_count(&pool).await, facts_before_create);
    assert_eq!(
        sku_place_quantity(&pool, cancel_sku, "dc.warehouse:on_hand").await,
        on_hand_before_create
    );
    let after_create = infrastructure::get_availability(&pool, AvailabilityQuery::default())
        .await
        .unwrap_or_else(|e| panic!("availability after create: {e}"));
    let created_sku = after_create["items"]
        .as_array()
        .unwrap_or_else(|| panic!("availability array"))
        .iter()
        .find(|item| item["sku_id"] == cancel_sku.to_string())
        .unwrap_or_else(|| panic!("created SKU availability"));
    assert_eq!(created_sku["allotted_qty"], 10);
    assert_eq!(created_sku["on_hand_qty"], cancel_available - 10);

    let allotment_id = Uuid::parse_str(created["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("allotment UUID: {e}"));
    let cancel_request = CancelAllotmentRequest {
        reason: "Re-plan before Pick".into(),
        actor_id: "allotment-planner".into(),
        idempotency_key: "allotment-cancel-no-movement".into(),
    };
    let cancelled = infrastructure::cancel_allotment(&pool, allotment_id, cancel_request.clone())
        .await
        .unwrap_or_else(|e| panic!("cancel allotment: {e}"));
    assert_eq!(cancelled["status"], "CANCELLED");
    assert_eq!(cancelled["inventory_effect"]["movement_count"], 0);
    assert_eq!(
        cancelled,
        infrastructure::cancel_allotment(&pool, allotment_id, cancel_request)
            .await
            .unwrap_or_else(|e| panic!("cancel retry: {e}"))
    );
    assert_eq!(fact_count(&pool).await, facts_before_create);
    assert_eq!(
        sku_place_quantity(&pool, cancel_sku, "dc.warehouse:on_hand").await,
        on_hand_before_create
    );
    let after_cancel = infrastructure::get_availability(&pool, AvailabilityQuery::default())
        .await
        .unwrap_or_else(|e| panic!("availability after cancel: {e}"));
    let cancelled_sku = after_cancel["items"]
        .as_array()
        .unwrap_or_else(|| panic!("availability array"))
        .iter()
        .find(|item| item["sku_id"] == cancel_sku.to_string())
        .unwrap_or_else(|| panic!("cancelled SKU availability"));
    assert_eq!(cancelled_sku["allotted_qty"], 0);
    assert_eq!(cancelled_sku["on_hand_qty"], cancel_available);

    // Store destinations remain independent for the same SKU.
    let store_01 = infrastructure::create_allotment(
        &pool,
        CreateAllotmentRequest {
            allotment_type: AllotmentType::ToStore,
            lines: vec![CreateAllotmentLineInput {
                source_site_id: "dc".into(),
                source_pool_id: "dc.warehouse".into(),
                destination_type: DestinationType::Store,
                destination_id: "store-01".into(),
                sku_id: pick_sku,
                quantity: 5,
            }],
            notes: None,
            actor_id: "allotment-planner".into(),
            idempotency_key: "allotment-store-01".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("Store 01 allotment: {e}"));
    let store_02 = infrastructure::create_allotment(
        &pool,
        CreateAllotmentRequest {
            allotment_type: AllotmentType::ToStore,
            lines: vec![CreateAllotmentLineInput {
                source_site_id: "dc".into(),
                source_pool_id: "dc.warehouse".into(),
                destination_type: DestinationType::Store,
                destination_id: "store-02".into(),
                sku_id: pick_sku,
                quantity: 7,
            }],
            notes: None,
            actor_id: "allotment-planner".into(),
            idempotency_key: "allotment-store-02".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("Store 02 allotment: {e}"));
    let store_01_view = infrastructure::list_allotments_by_store(&pool, "store-01")
        .await
        .unwrap_or_else(|e| panic!("Store 01 view: {e}"));
    let store_02_view = infrastructure::list_allotments_by_store(&pool, "store-02")
        .await
        .unwrap_or_else(|e| panic!("Store 02 view: {e}"));
    let store_remaining = |view: &serde_json::Value| {
        view["sku_summary"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["sku_id"] == pick_sku.to_string())
            })
            .and_then(|item| item["remaining_quantity"].as_i64())
            .unwrap_or_default()
    };
    assert_eq!(store_remaining(&store_01_view), 5);
    assert_eq!(store_remaining(&store_02_view), 7);
    infrastructure::cancel_allotment(
        &pool,
        Uuid::parse_str(store_01["id"].as_str().unwrap_or_default())
            .unwrap_or_else(|e| panic!("Store 01 allotment UUID: {e}")),
        CancelAllotmentRequest {
            reason: "Keep Store destinations independent".into(),
            actor_id: "allotment-planner".into(),
            idempotency_key: "allotment-store-01-cancel".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("cancel Store 01: {e}"));
    let store_02_id = Uuid::parse_str(store_02["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("Store 02 allotment UUID: {e}"));
    let store_02_line_id = Uuid::parse_str(store_02["lines"][0]["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("Store 02 allotment line UUID: {e}"));

    let availability_before_pick =
        infrastructure::get_availability(&pool, AvailabilityQuery::default())
            .await
            .unwrap_or_else(|e| panic!("availability before pick: {e}"));
    let pick_before = availability_before_pick["items"]
        .as_array()
        .unwrap_or_else(|| panic!("availability items"))
        .iter()
        .find(|item| item["sku_id"] == pick_sku.to_string())
        .unwrap_or_else(|| panic!("pick SKU before"));
    let available_before_pick = pick_before["on_hand_qty"].as_i64().unwrap_or_default();
    let allotment_before_pick = pick_before["allotted_qty"].as_i64().unwrap_or_default();
    let warehouse_before_pick = sku_place_quantity(&pool, pick_sku, "dc.warehouse:on_hand").await;
    let picked_before =
        sku_place_quantity(&pool, pick_sku, "dc.outbound.picked.store-02:on_hand").await;
    let facts_before_pick = fact_count(&pool).await;
    let pick_request = ExecuteAllotmentRequest {
        allotment_line_id: store_02_line_id,
        quantity: 3,
        actor_id: "dc-picker".into(),
        idempotency_key: "allotment-pick-store-02".into(),
    };
    let picked = infrastructure::execute_allotment(&pool, store_02_id, pick_request.clone())
        .await
        .unwrap_or_else(|e| panic!("pick allotment: {e}"));
    let movement_count = picked["movement_ids"]
        .as_array()
        .map_or(0_i64, |ids| ids.len() as i64);
    assert!(movement_count > 0);
    assert_eq!(fact_count(&pool).await, facts_before_pick + movement_count);
    assert_eq!(
        picked,
        infrastructure::execute_allotment(&pool, store_02_id, pick_request)
            .await
            .unwrap_or_else(|e| panic!("pick retry: {e}"))
    );
    assert_eq!(fact_count(&pool).await, facts_before_pick + movement_count);
    assert_eq!(
        sku_place_quantity(&pool, pick_sku, "dc.warehouse:on_hand").await,
        warehouse_before_pick - 3
    );
    assert_eq!(
        sku_place_quantity(&pool, pick_sku, "dc.outbound.picked.store-02:on_hand").await,
        picked_before + 3
    );
    let availability_after_pick =
        infrastructure::get_availability(&pool, AvailabilityQuery::default())
            .await
            .unwrap_or_else(|e| panic!("availability after pick: {e}"));
    let pick_after = availability_after_pick["items"]
        .as_array()
        .unwrap_or_else(|| panic!("availability items"))
        .iter()
        .find(|item| item["sku_id"] == pick_sku.to_string())
        .unwrap_or_else(|| panic!("pick SKU after"));
    // Picking commits to nobody, so it releases nobody's commitment: the
    // three shirts are off the rack and in the pick area, and Store 02 is
    // owed exactly as much as it was a moment ago. This assertion used to
    // read `allotment_before_pick - 3` — the old model let a picker discharge
    // a promise by touching the goods, and the shop found out at the door.
    assert_eq!(pick_after["allotted_qty"], allotment_before_pick);
    // And the shelf has lost nothing it could still promise. Supply is
    // measured over the pools the commitment can be served out of — the
    // warehouse and the picking area together — so carrying goods between
    // them moves no number at all.
    assert_eq!(pick_after["on_hand_qty"], available_before_pick);
    assert_eq!(pick_after["shortfall_qty"], 0);
    assert!(
        infrastructure::execute_allotment(
            &pool,
            store_02_id,
            ExecuteAllotmentRequest {
                allotment_line_id: store_02_line_id,
                quantity: 5,
                actor_id: "dc-picker".into(),
                idempotency_key: "allotment-pick-too-much".into(),
            },
        )
        .await
        .is_err(),
        "cannot pick more than remaining Allotment"
    );

    let detail = infrastructure::get_allotment(&pool, store_02_id)
        .await
        .unwrap_or_else(|e| panic!("allotment detail: {e}"));
    assert_eq!(detail["lines"][0]["destination_id"], "store-02");
    assert!(detail["movements"].as_array().is_some_and(|rows| {
        rows.iter().all(|movement| {
            movement["reference_type"] == "ALLOTMENT_LINE"
                && movement["allotment_id"] == store_02_id.to_string()
                && movement["allotment_line_id"] == store_02_line_id.to_string()
                && movement["destination_id"] == "store-02"
        })
    }));

    // Referenced outbound stock cannot lose or change its destination provenance.
    let picked_group = Uuid::parse_str(picked["movement_group_id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("pick movement group UUID: {e}"));
    let picked_fact = sqlx::query("SELECT subject_id,quantity FROM movement WHERE movement_group_id=$1 ORDER BY fact_sequence LIMIT 1")
        .bind(picked_group)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("picked fact: {e}"));
    let outbound_subject: Uuid = picked_fact.get("subject_id");
    let outbound_quantity: i64 = picked_fact.get("quantity");
    let outbound_move =
        |from: &str, to: &str, key: &str, reference_type: &str| CreateMovementRequest {
            idempotency_key: key.into(),
            actor_id: "outbound-operator".into(),
            occurred_at: None,
            reason: "Continue outbound flow with destination provenance".into(),
            reference_type: Some(reference_type.into()),
            reference_id: Some(store_02_line_id.to_string()),
            cause: Some("NORMAL_MOVE".into()),
            lines: vec![MovementLineRequest {
                subject_id: Some(outbound_subject),
                epc: None,
                quantity: outbound_quantity,
                from: from.into(),
                to: to.into(),
            }],
        };
    assert!(infrastructure::create_manual_movement(
        &pool,
        outbound_move(
            "dc.outbound.picked.store-02:on_hand",
            "dc.outbound.packed.store-02:on_hand",
            "outbound-without-allotment-provenance",
            "TEST",
        ),
    )
    .await
    .is_err());
    for (from, to, key) in [
        (
            "dc.outbound.picked.store-02:on_hand",
            "dc.outbound.packed.store-02:on_hand",
            "allotment-outbound-packed",
        ),
        (
            "dc.outbound.packed.store-02:on_hand",
            "dc.outbound.shipment.store-02:on_hand",
            "allotment-outbound-shipment",
        ),
        (
            "dc.outbound.shipment.store-02:on_hand",
            "dc.outbound.in-transit.store-02:on_hand",
            "allotment-outbound-transit",
        ),
    ] {
        infrastructure::create_manual_movement(
            &pool,
            outbound_move(from, to, key, "ALLOTMENT_LINE"),
        )
        .await
        .unwrap_or_else(|e| panic!("continue Allotment outbound: {e}"));
    }
    assert!(
        infrastructure::create_manual_movement(
            &pool,
            outbound_move(
                "dc.outbound.in-transit.store-02:on_hand",
                "store-01.warehouse:on_hand",
                "allotment-wrong-store",
                "ALLOTMENT_LINE",
            ),
        )
        .await
        .is_err(),
        "Store 02 Allotment cannot arrive at Store 01"
    );
    infrastructure::create_manual_movement(
        &pool,
        outbound_move(
            "dc.outbound.in-transit.store-02:on_hand",
            "store-02.warehouse:on_hand",
            "allotment-correct-store",
            "ALLOTMENT_LINE",
        ),
    )
    .await
    .unwrap_or_else(|e| panic!("correct Store receipt: {e}"));

    // Two concurrent commands cannot consume the same SKU availability.
    let race_availability = infrastructure::get_availability(&pool, AvailabilityQuery::default())
        .await
        .unwrap_or_else(|e| panic!("race availability: {e}"));
    let race_available = race_availability["items"]
        .as_array()
        .unwrap_or_else(|| panic!("race availability items"))
        .iter()
        .find(|item| item["sku_id"] == race_sku.to_string())
        .and_then(|item| item["on_hand_qty"].as_i64())
        .unwrap_or_default();
    assert!(race_available > 0);
    let race_request = |store: &str, key: &str| CreateAllotmentRequest {
        allotment_type: AllotmentType::ToStore,
        lines: vec![CreateAllotmentLineInput {
            source_site_id: "dc".into(),
            source_pool_id: "dc.warehouse".into(),
            destination_type: DestinationType::Store,
            destination_id: store.into(),
            sku_id: race_sku,
            quantity: race_available,
        }],
        notes: None,
        actor_id: "concurrent-planner".into(),
        idempotency_key: key.into(),
    };
    let (race_a, race_b) = tokio::join!(
        infrastructure::create_allotment(&pool, race_request("store-03", "allotment-race-a")),
        infrastructure::create_allotment(&pool, race_request("store-04", "allotment-race-b"))
    );
    assert_ne!(
        race_a.is_ok(),
        race_b.is_ok(),
        "exactly one concurrent Allotment may consume availability"
    );
    let race_winner = race_a
        .or(race_b)
        .unwrap_or_else(|e| panic!("race winner: {e}"));
    let race_winner_id = Uuid::parse_str(race_winner["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("race winner UUID: {e}"));
    assert!(infrastructure::create_allotment(
        &pool,
        CreateAllotmentRequest {
            allotment_type: AllotmentType::ToStore,
            lines: vec![CreateAllotmentLineInput {
                source_site_id: "dc".into(),
                source_pool_id: "dc.warehouse".into(),
                destination_type: DestinationType::Store,
                destination_id: "store-05".into(),
                sku_id: race_sku,
                quantity: 1,
            }],
            notes: None,
            actor_id: "allotment-planner".into(),
            idempotency_key: "allotment-explicit-overage".into(),
        },
    )
    .await
    .is_err());
    infrastructure::cancel_allotment(
        &pool,
        race_winner_id,
        CancelAllotmentRequest {
            reason: "Release concurrency test commitment".into(),
            actor_id: "concurrent-planner".into(),
            idempotency_key: "allotment-race-release".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("release race winner: {e}"));

    // An official DC Warehouse shortage records an exception without cancelling commitment.
    let shortage_availability =
        infrastructure::get_availability(&pool, AvailabilityQuery::default())
            .await
            .unwrap_or_else(|e| panic!("shortage availability: {e}"));
    let shortage_available = shortage_availability["items"]
        .as_array()
        .unwrap_or_else(|| panic!("shortage availability items"))
        .iter()
        .find(|item| item["sku_id"] == cancel_sku.to_string())
        .and_then(|item| item["on_hand_qty"].as_i64())
        .unwrap_or_default();
    assert!(shortage_available > 0);
    let shortage_allotment = infrastructure::create_allotment(
        &pool,
        CreateAllotmentRequest {
            allotment_type: AllotmentType::ToStore,
            lines: vec![CreateAllotmentLineInput {
                source_site_id: "dc".into(),
                source_pool_id: "dc.warehouse".into(),
                destination_type: DestinationType::Store,
                destination_id: "store-06".into(),
                sku_id: cancel_sku,
                quantity: shortage_available,
            }],
            notes: Some("Commitment survives physical shortage".into()),
            actor_id: "allotment-planner".into(),
            idempotency_key: "allotment-shortage-commitment".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("shortage commitment: {e}"));
    let shortage_allotment_id =
        Uuid::parse_str(shortage_allotment["id"].as_str().unwrap_or_default())
            .unwrap_or_else(|e| panic!("shortage Allotment UUID: {e}"));
    let shortage_allotment_line_id = Uuid::parse_str(
        shortage_allotment["lines"][0]["id"]
            .as_str()
            .unwrap_or_default(),
    )
    .unwrap_or_else(|e| panic!("shortage Allotment line UUID: {e}"));
    let count = infrastructure::create_count(
        &pool,
        CreateCountRequest {
            site_id: "dc".into(),
            pool_id: "dc.warehouse".into(),
            kind: CountKind::Targeted,
            sku_ids: vec![cancel_sku],
            epcs: vec![],
            reason: "Prove Allotment shortage exception".into(),
            actor_id: "inventory-counter".into(),
            idempotency_key: "allotment-shortage-count-create".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("shortage count: {e}"));
    let count_id = Uuid::parse_str(count["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("shortage count UUID: {e}"));
    infrastructure::activate_count(
        &pool,
        count_id,
        CommandRequest {
            actor_id: "inventory-counter".into(),
            idempotency_key: "allotment-shortage-count-activate".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("activate shortage count: {e}"));
    infrastructure::submit_count(
        &pool,
        count_id,
        CommandRequest {
            actor_id: "inventory-counter".into(),
            idempotency_key: "allotment-shortage-count-submit".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("submit shortage count: {e}"));
    let facts_before_shortage = fact_count(&pool).await;
    let approved = infrastructure::approve_count(
        &pool,
        count_id,
        CommandRequest {
            actor_id: "inventory-supervisor".into(),
            idempotency_key: "allotment-shortage-count-approve".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("approve shortage count: {e}"));
    assert!(approved["movement_count"].as_i64().unwrap_or_default() > 0);
    assert_eq!(approved["allotment_shortage_event_count"], 1);
    assert!(fact_count(&pool).await > facts_before_shortage);
    let shortage_after = infrastructure::get_availability(&pool, AvailabilityQuery::default())
        .await
        .unwrap_or_else(|e| panic!("availability after shortage: {e}"));
    let shortage_sku = shortage_after["items"]
        .as_array()
        .unwrap_or_else(|| panic!("shortage items"))
        .iter()
        .find(|item| item["sku_id"] == cancel_sku.to_string())
        .unwrap_or_else(|| panic!("shortage SKU"));
    assert_eq!(shortage_sku["allotted_qty"], shortage_available);
    // A count that finds the goods gone does not erase what the shop was
    // promised: the promise stands, and the pool now owes more than it holds.
    // That is a shortfall, and On Hand stops at nought — it used to be shown
    // as a negative quantity of shirts, which is not a thing a shelf can hold.
    assert_eq!(shortage_sku["on_hand_qty"], 0);
    // Every piece the count could not find is a piece the promise now outruns
    // — the shortfall and the missing are the same goods, counted once as a
    // physical state and once as a commitment the shelf cannot meet.
    //
    // They are not `shortage_available`, and that is the scope rule doing its
    // work: availability spans every pool the commitment can be packed out of,
    // so it also counted what was standing in the picking area, and the count
    // was of the warehouse alone.
    assert_eq!(shortage_sku["shortfall_qty"], shortage_sku["missing_qty"]);
    assert!(shortage_sku["missing_qty"].as_i64().unwrap_or_default() > 0);
    assert!(
        sku_place_quantity(&pool, cancel_sku, "dc.warehouse:missing").await > 0,
        "Missing remains physical state and is excluded from On Hand"
    );
    let shortage_detail = infrastructure::get_allotment(&pool, shortage_allotment_id)
        .await
        .unwrap_or_else(|e| panic!("shortage Allotment detail: {e}"));
    assert_eq!(shortage_detail["status"], "ACTIVE");
    assert_eq!(shortage_detail["remaining_quantity"], shortage_available);
    let shortage_events: i64 = sqlx::query("SELECT count(*)::bigint count FROM allotment_event WHERE event_type='ALLOTMENT_SHORTAGE' AND reference_id=$1 AND sku_id=$2")
        .bind(count_id.to_string())
        .bind(cancel_sku)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("shortage events: {e}"))
        .get("count");
    assert_eq!(shortage_events, 1);
    let facts_before_failed_pick = fact_count(&pool).await;
    assert!(infrastructure::execute_allotment(
        &pool,
        shortage_allotment_id,
        ExecuteAllotmentRequest {
            allotment_line_id: shortage_allotment_line_id,
            quantity: 1,
            actor_id: "dc-picker".into(),
            idempotency_key: "allotment-pick-missing-inventory".into(),
        },
    )
    .await
    .is_err());
    assert_eq!(fact_count(&pool).await, facts_before_failed_pick);

    let pool_view = infrastructure::list_pools(&pool, None, 24, 30)
        .await
        .unwrap_or_else(|e| panic!("pool view with Allotment: {e}"));
    let warehouse = pool_view["items"]
        .as_array()
        .unwrap_or_else(|| panic!("pool items"))
        .iter()
        .find(|item| item["id"] == "dc.warehouse")
        .unwrap_or_else(|| panic!("DC Warehouse row"));
    // One commitment, read two ways, and they agree: the pool tree and the
    // allotting screen both ask the view what still has to leave this shelf.
    assert_eq!(warehouse["allotted"], shortage_after["allotted_qty"]);
    // Their On Hand does not agree, and should not. The tree answers per pool
    // — this shelf, these goods. Allotting answers per site, because a promise
    // raised against the warehouse can be packed out of the picking area too.
    // So the warehouse row can only be the smaller of the two, and the gap is
    // exactly what the pickers are holding.
    let tree_on_hand = warehouse["on_hand"].as_i64().unwrap_or_default();
    let allotting_on_hand = shortage_after["on_hand_qty"].as_i64().unwrap_or_default();
    assert!(
        tree_on_hand <= allotting_on_hand,
        "the pool tree cannot offer more than the site can pack: {tree_on_hand} against {allotting_on_hand}"
    );
    let list = infrastructure::list_allotments(&pool, AllotmentQuery::default())
        .await
        .unwrap_or_else(|e| panic!("Allotment list: {e}"));
    let destinations = list["by_destination"]
        .as_array()
        .unwrap_or_else(|| panic!("Allotment destination summary"));
    assert!(destinations
        .iter()
        .any(|row| row["destination_id"] == "store-02"));
    assert!(destinations
        .iter()
        .any(|row| row["destination_id"] == "store-06"));
    assert!(list["shortages"]
        .as_array()
        .is_some_and(|rows| !rows.is_empty()));

    let app = api_http::router(AppState::new(
        pool.clone(),
        AppConfig {
            bind_addr: "127.0.0.1:0"
                .parse::<SocketAddr>()
                .unwrap_or_else(|e| panic!("socket address: {e}")),
            database_url: "postgresql:///sqlx-test".into(),
            node_id: "integration-dc".into(),
            node_role: "DC".into(),
            rfid_burst_window_seconds: 10,
            observed_window_hours: 24,
            lost_risk_window_days: 30,
            enable_test_controls: false,
            frontend_dir: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend"),
            sync_upload_url: None,
            sync_upload_key: None,
            sync_ingest_key: None,
            sync_generation: 1,
            sync_enqueue_enabled: false,
            sync_interval_seconds: 5,
            sync_batch_limit: 100,
            sync_breaker_threshold: 5,
            sync_breaker_base_cooldown_seconds: 30,
            sync_breaker_max_cooldown_seconds: 900,
            sync_retention_days: 14,
            sync_degraded_after_seconds: 900,
            sync_apply_enabled: false,
            jwt_secret: None,
            auth_token_ttl_minutes: 720,
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
        },
    ));
    for uri in [
        "/api/v1/inventory/availability",
        "/api/v1/inventory/allotments",
        "/api/v1/inventory/allotments/by-store/store-02",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap_or_else(|e| panic!("Allotment HTTP request: {e}")),
            )
            .await
            .unwrap_or_else(|e| panic!("Allotment HTTP response: {e}"));
        assert_eq!(response.status(), 200, "route {uri}");
    }

    let replay = infrastructure::run_replay(
        &pool,
        ReplayRequest {
            scope: ReplayScope::default(),
            actor_id: "allotment-controller".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("Allotment replay: {e}"));
    assert_eq!(replay["status"], "MATCH");
}

/// A clearance on a whole style clears every size of it, at the centre too.
///
/// The companion to the shop-side test of the same name. The engine matches an
/// article-wide markdown on `CartLine::article_code`, and it is *told* that
/// field rather than deriving it from the SKU code — but nothing told it. Every
/// caller built its lines with `CartLine::new`, which leaves the style empty,
/// so a range-wide markdown matched nothing: not at a till, and not on the
/// screen a merchandiser opens to check a price.
///
/// The failure had no symptom. The markdown was accepted, stored, published and
/// delivered; it simply never applied. This test fails against that build and
/// is the reason the centre now loads what a product IS alongside what it costs.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_clearance_on_a_whole_style_clears_every_size_of_it(pool: PgPool) {
    // The seed gives every SKU a company-wide STORE price, so a book that only
    // adds a markdown still satisfies the publish check.
    let (any_sku, article): (Uuid, String) = sqlx::query_as(
        "SELECT s.id, a.article_code FROM sku s JOIN article a ON a.id = s.article_id
          WHERE s.active ORDER BY s.sku_code LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("a seeded style: {e}"));

    let siblings: Vec<String> = sqlx::query_scalar(
        "SELECT s.sku_code FROM sku s JOIN article a ON a.id = s.article_id
          WHERE a.article_code = $1 AND s.active ORDER BY s.sku_code",
    )
    .bind(&article)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("the sizes of {article}: {e}"));
    assert!(
        siblings.len() > 1,
        "a style with one size in it cannot show that the markdown reached the others"
    );

    const CLEARANCE: i64 = 49_000;
    let created = infrastructure::create_commercial_publication(
        &pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version: 900,
            name: "Cuci gudang satu style".into(),
            effective_from: Utc::now() - Duration::days(1),
            effective_to: None,
            tax_rules: vec![CommercialTaxRuleInput {
                tax_category: "STANDARD".into(),
                rate_bps: 1_100,
                tax_inclusive: true,
            }],
            // One price, restated, because a book must carry at least one.
            offer_rules: vec![CommercialOfferRuleInput {
                sku_id: any_sku,
                site_id: None,
                site_ids: None,
                channel: CommercialChannel::Store,
                sellable: true,
                currency: "IDR".into(),
                unit_price_minor: 200_000,
                tax_category: "STANDARD".into(),
            }],
            markdowns: vec![CommercialMarkdownInput {
                markdown_id: "MD-STYLE".into(),
                sku_id: None,
                sku_code: None,
                article_code: Some(article.clone()),
                site_id: None,
                site_ids: None,
                replacement_unit_price_minor: CLEARANCE,
                priority: 10,
                campaign_id: None,
                iso_weekdays: Vec::new(),
                from_minute: None,
                to_minute: None,
                effective_from: Utc::now() - Duration::days(1),
                effective_to: None,
            }],
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: Vec::new(),
            actor_id: "merchandiser".into(),
            idempotency_key: "style-clearance-draft".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("draft: {e}"));
    let publication_id: Uuid = created["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no publication id: {created}"))
        .parse()
        .unwrap_or_else(|e| panic!("publication id: {e}"));
    infrastructure::publish_commercial_publication(
        &pool,
        publication_id,
        CommandRequest {
            actor_id: "merchandiser".into(),
            idempotency_key: "style-clearance-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));

    let offers = infrastructure::list_resolved_offers(
        &pool,
        "store-07",
        CommercialChannel::Store,
        Utc::now(),
    )
    .await
    .unwrap_or_else(|e| panic!("offers: {e}"));
    let items = offers["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no offers: {offers}"));
    let quoted = |code: &str| -> serde_json::Value {
        items
            .iter()
            .find(|item| item["sku_code"] == serde_json::json!(code))
            .unwrap_or_else(|| panic!("{code} is missing from the centre's list"))
            .clone()
    };

    for sku_code in &siblings {
        assert_eq!(
            quoted(sku_code)["unit_price_minor"],
            serde_json::json!(CLEARANCE),
            "{sku_code} is in {article}, so the style-wide clearance must reach it"
        );
        assert_eq!(quoted(sku_code)["price_source"], "MARKDOWN");
        assert_eq!(quoted(sku_code)["markdown_id"], "MD-STYLE");
    }

    // And nothing outside the style moved.
    let untouched = items
        .iter()
        .find(|item| item["article_code"] != serde_json::json!(article))
        .unwrap_or_else(|| panic!("the seed has only one style: {offers}"));
    assert_eq!(
        untouched["price_source"], "COMPANY_PRICE",
        "a markdown naming one style must not touch another"
    );
}

/// The what-if says why a promotion did not come off.
///
/// Pricing a basket that is not being sold is the only way to ask "why is my
/// rule not applying" without a customer standing at the counter. The engine
/// never throws for a rule that cannot apply — it records the reason — and
/// that record had nowhere to go: `price_cart` was called only at a till, so
/// the centre could author a promotion and had no way to test one.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_what_if_prices_a_basket_and_explains_what_did_not_apply(pool: PgPool) {
    let sku_code: String =
        sqlx::query_scalar("SELECT sku_code FROM sku WHERE active ORDER BY sku_code LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("a seeded SKU: {e}"));

    let priced = infrastructure::simulate(
        &pool,
        inventory_backend::cloud::application::SimulateRequest {
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            at: None,
            lines: vec![inventory_backend::cloud::application::SimulateLineInput {
                sku_code: sku_code.clone(),
                quantity: 2,
            }],
            coupon_codes: Vec::new(),
            customer_id: None,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("simulate: {e}"));

    assert_eq!(priced["lines"].as_array().map(Vec::len), Some(1));
    assert_eq!(priced["lines"][0]["sku_code"], serde_json::json!(sku_code));
    assert_eq!(priced["lines"][0]["quantity"], serde_json::json!(2));
    assert_eq!(priced["lines"][0]["price_source"], "COMPANY_PRICE");
    assert!(
        priced["total_minor"].as_i64().unwrap_or_default() > 0,
        "a basket of two priced items comes to something"
    );
    assert!(
        priced["trace_id"].as_str().is_some_and(|id| !id.is_empty()),
        "the fingerprint is what lets this answer be reproduced later"
    );

    // Nothing was recorded. A what-if that left a sale behind would be worse
    // than no what-if at all.
    let sales: i64 = sqlx::query_scalar("SELECT count(*) FROM sale")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("sale count: {e}"));
    assert_eq!(sales, 0, "pricing a hypothetical basket must sell nothing");

    // A coupon nobody issued is refused in words, not by failing the request.
    let with_code = infrastructure::simulate(
        &pool,
        inventory_backend::cloud::application::SimulateRequest {
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            at: None,
            lines: vec![inventory_backend::cloud::application::SimulateLineInput {
                sku_code,
                quantity: 1,
            }],
            coupon_codes: vec!["TIDAK-ADA".into()],
            customer_id: None,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("simulate with a bad coupon: {e}"));
    assert!(
        with_code["total_minor"].as_i64().unwrap_or_default() > 0,
        "an unknown coupon must not stop the basket being priced"
    );
}

/// Every shop appears on the fleet list, including the one that never reported.
///
/// That row is the whole point and the easiest to leave out: a shop missing
/// from a list of activations reads as "no news", when what it means is that no
/// price book has ever gone into service there.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_fleet_list_names_a_shop_that_has_never_activated_a_price_book(pool: PgPool) {
    sqlx::query(
        "INSERT INTO sync_origin_credential
             (origin_id, ingest_key_sha256, active_generation, node_role, site_id,
              label, inventory_enabled)
         VALUES ('store-07-till', 'not-a-real-key', 1, 'STORE', 'store-07',
                 'Toko 07', true)",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("register a shop: {e}"));

    let fleet = infrastructure::commercial_activation(&pool)
        .await
        .unwrap_or_else(|e| panic!("activation: {e}"));
    let items = fleet["items"]
        .as_array()
        .unwrap_or_else(|| panic!("no shops: {fleet}"));
    let shop = items
        .iter()
        .find(|row| row["origin_id"] == serde_json::json!("store-07-till"))
        .unwrap_or_else(|| panic!("the shop is missing from the fleet list: {fleet}"));

    assert_eq!(shop["has_ever_activated"], serde_json::json!(false));
    assert!(
        shop["version"].is_null(),
        "it is charging from no book at all"
    );
    assert!(
        shop["behind_by"].is_null(),
        "how far behind a shop that never started is, is not a number"
    );
}

/// A budget spent in the fleet is spent at the centre too.
///
/// The centre read `spent_minor` and `used` from the publication row, and
/// nothing has ever written those — migration 0035 moved counting to
/// `commercial_usage` precisely because a count cannot live inside a frozen
/// document. So the centre's evaluator saw zero forever: a budget never ran
/// out, a coupon was never used up, a usage cap was never reached.
///
/// Every till, which does overlay the counts, had already stopped honouring the
/// offer. Two nodes reading one concept from two places — in the screen built
/// to explain why a promotion did not apply, which would have answered that
/// question wrongly for two of its most common causes.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_budget_spent_in_the_fleet_is_spent_at_the_centre_too(pool: PgPool) {
    let sku: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE active ORDER BY sku_code LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("a seeded SKU: {e}"));
    let sku_code: String = sqlx::query_scalar("SELECT sku_code FROM sku WHERE id = $1")
        .bind(sku)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("its code: {e}"));

    // A campaign with a small budget, and one promotion inside it.
    let rule = serde_json::json!({
        "rule_id": "R-BUDGET",
        "campaign_id": "C-BUDGET",
        "name": "Diskon 10%",
        "status": "ACTIVE",
        "effect": {"kind": "PERCENT", "bps": 1_000},
        "stacking": "ALONE",
        "priority": 0,
    });
    let created = infrastructure::create_commercial_publication(
        &pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version: 800,
            name: "Kampanye berbudget".into(),
            effective_from: Utc::now() - Duration::days(1),
            effective_to: None,
            tax_rules: vec![CommercialTaxRuleInput {
                tax_category: "STANDARD".into(),
                rate_bps: 0,
                tax_inclusive: true,
            }],
            offer_rules: vec![CommercialOfferRuleInput {
                sku_id: sku,
                site_id: None,
                site_ids: None,
                channel: CommercialChannel::Store,
                sellable: true,
                currency: "IDR".into(),
                unit_price_minor: 100_000,
                tax_category: "STANDARD".into(),
            }],
            markdowns: Vec::new(),
            rules: vec![serde_json::from_value(rule)
                .unwrap_or_else(|e| panic!("the rule is not a rule: {e}"))],
            coupons: Vec::new(),
            campaigns: vec![
                inventory_backend::cloud::application::CommercialCampaignInput {
                    campaign_id: "C-BUDGET".into(),
                    name: "Kampanye berbudget".into(),
                    status: "ACTIVE".into(),
                    valid_from: None,
                    valid_to: None,
                    budget_minor: Some(50_000),
                    max_uses: None,
                    site_ids: Vec::new(),
                    image_url: None,
                    headline: None,
                    terms: None,
                },
            ],
            actor_id: "merchandiser".into(),
            idempotency_key: "budget-draft".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("draft: {e}"));
    let publication_id: Uuid = created["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no id: {created}"))
        .parse()
        .unwrap_or_else(|e| panic!("id: {e}"));
    infrastructure::publish_commercial_publication(
        &pool,
        publication_id,
        CommandRequest {
            actor_id: "merchandiser".into(),
            idempotency_key: "budget-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));

    let basket = || inventory_backend::cloud::application::SimulateRequest {
        site_id: "store-07".into(),
        channel: CommercialChannel::Store,
        at: None,
        lines: vec![inventory_backend::cloud::application::SimulateLineInput {
            sku_code: sku_code.clone(),
            quantity: 1,
        }],
        coupon_codes: Vec::new(),
        customer_id: None,
    };

    let before = infrastructure::simulate(&pool, basket())
        .await
        .unwrap_or_else(|e| panic!("simulate: {e}"));
    assert_eq!(
        before["applied_rules"].as_array().map(Vec::len),
        Some(1),
        "with the budget untouched the promotion applies"
    );

    // The fleet spends it. This is the table sale facts fill in — the same rows
    // a shop's own copy is built from.
    sqlx::query(
        "INSERT INTO commercial_usage (kind, key, uses, spent_minor)
         VALUES ('CAMPAIGN', 'C-BUDGET', 40, 50_000)",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("count the spend: {e}"));

    let after = infrastructure::simulate(&pool, basket())
        .await
        .unwrap_or_else(|e| panic!("simulate again: {e}"));
    assert!(
        after["applied_rules"]
            .as_array()
            .is_some_and(|applied| applied.is_empty()),
        "the budget is spent, so the promotion must not apply: {after}"
    );
    let refused = after["rejected_rules"]
        .as_array()
        .and_then(|rules| rules.first())
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        refused["reason"], "BUDGET_SPENT",
        "and it must say so in the words a cashier would use: {after}"
    );
}

/// The usage list reports the limit the newest book declares.
///
/// It reads three declarations — a rule's caps, a campaign's caps, a coupon's
/// cap — and each was a correlated subquery repeated per column: eighteen scans
/// for three rows, eighteen hundred for three hundred, every one re-finding the
/// same newest publication. They are one pass now, and this fixes the answer in
/// place so the rewrite cannot quietly change it.
///
/// The superseded case is the one worth holding: a limit stated in an older
/// book has been replaced like everything else in it, so a campaign re-declared
/// with a bigger budget must report the bigger one.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn the_usage_list_reports_the_limit_the_newest_book_declares(pool: PgPool) {
    let sku: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE active ORDER BY sku_code LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("a seeded SKU: {e}"));

    let publish = |version: i64, budget: i64, key: &'static str| {
        let pool = pool.clone();
        async move {
            let created = infrastructure::create_commercial_publication(
                &pool,
                CreateCommercialPublicationRequest {
                    change_type: None,
                    version,
                    name: format!("Buku {version}"),
                    effective_from: Utc::now() - Duration::days(1),
                    effective_to: None,
                    tax_rules: vec![CommercialTaxRuleInput {
                        tax_category: "STANDARD".into(),
                        rate_bps: 0,
                        tax_inclusive: true,
                    }],
                    offer_rules: vec![CommercialOfferRuleInput {
                        sku_id: sku,
                        site_id: None,
                        site_ids: None,
                        channel: CommercialChannel::Store,
                        sellable: true,
                        currency: "IDR".into(),
                        unit_price_minor: 100_000,
                        tax_category: "STANDARD".into(),
                    }],
                    markdowns: Vec::new(),
                    rules: Vec::new(),
                    coupons: Vec::new(),
                    campaigns: vec![
                        inventory_backend::cloud::application::CommercialCampaignInput {
                            campaign_id: "C-LIMIT".into(),
                            name: "Kampanye".into(),
                            status: "ACTIVE".into(),
                            valid_from: None,
                            valid_to: None,
                            budget_minor: Some(budget),
                            max_uses: None,
                            site_ids: Vec::new(),
                            image_url: None,
                            headline: None,
                            terms: None,
                        },
                    ],
                    actor_id: "merchandiser".into(),
                    idempotency_key: format!("{key}-draft"),
                },
            )
            .await
            .unwrap_or_else(|e| panic!("draft {version}: {e}"));
            let id: Uuid = created["id"]
                .as_str()
                .unwrap_or_else(|| panic!("no id"))
                .parse()
                .unwrap_or_else(|e| panic!("id: {e}"));
            infrastructure::publish_commercial_publication(
                &pool,
                id,
                CommandRequest {
                    actor_id: "merchandiser".into(),
                    idempotency_key: format!("{key}-publish"),
                },
            )
            .await
            .unwrap_or_else(|e| panic!("publish {version}: {e}"));
        }
    };

    publish(810, 1_000_000, "small").await;
    publish(811, 9_000_000, "big").await;

    sqlx::query(
        "INSERT INTO commercial_usage (kind, key, uses, spent_minor)
         VALUES ('CAMPAIGN', 'C-LIMIT', 3, 250_000)",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("count: {e}"));
    sqlx::query(
        "INSERT INTO commercial_usage_customer (kind, key, customer_id, uses)
         VALUES ('CAMPAIGN', 'C-LIMIT', 'cust-1', 2), ('CAMPAIGN', 'C-LIMIT', 'cust-2', 1)",
    )
    .execute(&pool)
    .await
    .unwrap_or_else(|e| panic!("per-customer count: {e}"));

    let usage = infrastructure::commercial_usage(&pool)
        .await
        .unwrap_or_else(|e| panic!("usage: {e}"));
    let row = usage["items"]
        .as_array()
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| panic!("no usage rows: {usage}"));

    assert_eq!(row["key"], "C-LIMIT");
    assert_eq!(row["spent_minor"], 250_000);
    assert_eq!(
        row["budget_minor"], 9_000_000,
        "the newer book's budget supersedes the older one: {usage}"
    );
    assert_eq!(row["name"], "Kampanye");
    assert_eq!(
        row["customer_count"], 2,
        "two shoppers have used it, counted once each"
    );
}

/// A cloud sale can still sell a product the newest book does not mention.
///
/// A price book is a list of changes: the newest book that names a product
/// wins, and one that never names it changes nothing. The publish check says so
/// in as many words, and the engine has always resolved that way.
///
/// The cloud sale path never learned it. It picks the single newest published
/// book at the moment the sale opens, pins every line to that book, and refuses
/// any line whose offer resolves to a different version. So repricing one shirt
/// makes every other product in the shop unsellable through this path — they
/// are still priced, by an older book that is still in force, and the sale
/// refuses them anyway.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_cloud_sale_sells_what_an_older_book_still_prices(pool: PgPool) {
    // Something on the floor, and something else to reprice.
    let (epc, on_floor_sku): (String, Uuid) = sqlx::query_as(
        "SELECT s.epc, s.sku_id FROM inventory_subject s
           JOIN movement m ON m.to_place_id = 'store-07.floor:on_hand'
          WHERE m.subject_id = s.id AND s.sku_id IS NOT NULL
          LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("something on the floor at store-07: {e}"));

    let other_sku: Uuid = sqlx::query_scalar(
        "SELECT id FROM sku WHERE active AND id <> $1 ORDER BY sku_code LIMIT 1",
    )
    .bind(on_floor_sku)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("a different SKU: {e}"));

    // One shirt is repriced. Nothing else is mentioned, which is the ordinary
    // shape of a repricing and the whole reason a book is a list of changes.
    let created = infrastructure::create_commercial_publication(
        &pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version: 820,
            name: "Naikkan satu harga".into(),
            effective_from: Utc::now() - Duration::days(1),
            effective_to: None,
            tax_rules: vec![CommercialTaxRuleInput {
                tax_category: "STANDARD".into(),
                rate_bps: 0,
                tax_inclusive: true,
            }],
            offer_rules: vec![CommercialOfferRuleInput {
                sku_id: other_sku,
                site_id: None,
                site_ids: None,
                channel: CommercialChannel::Store,
                sellable: true,
                currency: "IDR".into(),
                unit_price_minor: 333_000,
                tax_category: "STANDARD".into(),
            }],
            markdowns: Vec::new(),
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: Vec::new(),
            actor_id: "merchandiser".into(),
            idempotency_key: "one-price-draft".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("draft: {e}"));
    let publication_id: Uuid = created["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no id: {created}"))
        .parse()
        .unwrap_or_else(|e| panic!("id: {e}"));
    infrastructure::publish_commercial_publication(
        &pool,
        publication_id,
        CommandRequest {
            actor_id: "merchandiser".into(),
            idempotency_key: "one-price-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));

    let sale = infrastructure::create_sale(
        &pool,
        CreateSaleRequest {
            customer_id: None,
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            actor_id: "cashier".into(),
            idempotency_key: "older-book-sale".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("open the sale: {e}"));
    let sale_id: Uuid = sale["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no sale id"))
        .parse()
        .unwrap_or_else(|e| panic!("sale id: {e}"));

    // The shirt on the floor was priced by the seed's book and never repriced.
    // It is still priced, and the shop may still sell it.
    let line = infrastructure::add_sale_line(
        &pool,
        sale_id,
        AddSaleLineRequest {
            epc,
            quantity: 1,
            actor_id: "cashier".into(),
            idempotency_key: "older-book-line".into(),
        },
    )
    .await
    .unwrap_or_else(|e| {
        panic!(
            "a product the newest book does not mention is still priced by the book \
             that last named it, and must still be sellable: {e}"
        )
    });
    assert!(
        line["unit_price_minor"].as_i64().unwrap_or_default() > 0,
        "and it is charged what that book says: {line}"
    );
}

/// A promotion that ended and a promotion that never arrived read differently.
///
/// The engine draws that line hard: a rule whose campaign is absent from the
/// snapshot is refused as `CAMPAIGN_UNKNOWN` — "this shop has not received that
/// promotion", which is a thing somebody drives to a shop about — while a
/// campaign that has simply run its course is `EXPIRED`.
///
/// Narrowing the campaign read by validity, which looks like free work, erases
/// exactly that distinction: every finished promotion starts reporting as a
/// delivery failure. This holds the two apart so the saving cannot be taken
/// again by someone reading only the query plan.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_ended_promotion_does_not_read_as_one_that_never_arrived(pool: PgPool) {
    let sku: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE active ORDER BY sku_code LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("a seeded SKU: {e}"));
    let sku_code: String = sqlx::query_scalar("SELECT sku_code FROM sku WHERE id = $1")
        .bind(sku)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("its code: {e}"));

    let rule = serde_json::json!({
        "rule_id": "R-ENDED",
        "campaign_id": "C-ENDED",
        "name": "Promo lewat",
        "status": "ACTIVE",
        "effect": {"kind": "PERCENT", "bps": 1_000},
        "stacking": "ALONE",
        "priority": 0,
    });
    let created = infrastructure::create_commercial_publication(
        &pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version: 830,
            name: "Kampanye yang sudah lewat".into(),
            effective_from: Utc::now() - Duration::days(30),
            effective_to: None,
            tax_rules: vec![CommercialTaxRuleInput {
                tax_category: "STANDARD".into(),
                rate_bps: 0,
                tax_inclusive: true,
            }],
            offer_rules: vec![CommercialOfferRuleInput {
                sku_id: sku,
                site_id: None,
                site_ids: None,
                channel: CommercialChannel::Store,
                sellable: true,
                currency: "IDR".into(),
                unit_price_minor: 100_000,
                tax_category: "STANDARD".into(),
            }],
            markdowns: Vec::new(),
            rules: vec![serde_json::from_value(rule)
                .unwrap_or_else(|e| panic!("the rule is not a rule: {e}"))],
            coupons: Vec::new(),
            // Ran for a fortnight, a fortnight ago.
            campaigns: vec![
                inventory_backend::cloud::application::CommercialCampaignInput {
                    campaign_id: "C-ENDED".into(),
                    name: "Kampanye lewat".into(),
                    status: "ACTIVE".into(),
                    valid_from: Some(Utc::now() - Duration::days(28)),
                    valid_to: Some(Utc::now() - Duration::days(14)),
                    budget_minor: None,
                    max_uses: None,
                    site_ids: Vec::new(),
                    image_url: None,
                    headline: None,
                    terms: None,
                },
            ],
            actor_id: "merchandiser".into(),
            idempotency_key: "ended-draft".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("draft: {e}"));
    let publication_id: Uuid = created["id"]
        .as_str()
        .unwrap_or_else(|| panic!("no id: {created}"))
        .parse()
        .unwrap_or_else(|e| panic!("id: {e}"));
    infrastructure::publish_commercial_publication(
        &pool,
        publication_id,
        CommandRequest {
            actor_id: "merchandiser".into(),
            idempotency_key: "ended-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));

    let priced = infrastructure::simulate(
        &pool,
        inventory_backend::cloud::application::SimulateRequest {
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            at: None,
            lines: vec![inventory_backend::cloud::application::SimulateLineInput {
                sku_code,
                quantity: 1,
            }],
            coupon_codes: Vec::new(),
            customer_id: None,
        },
    )
    .await
    .unwrap_or_else(|e| panic!("simulate: {e}"));

    let refused = priced["rejected_rules"]
        .as_array()
        .and_then(|rules| rules.first())
        .cloned()
        .unwrap_or_else(|| panic!("the ended promotion should be reported: {priced}"));
    assert_eq!(
        refused["reason"], "EXPIRED",
        "an ended promotion has ended; it did not fail to arrive: {priced}"
    );
    assert_eq!(refused["explanation"], "the promotion has ended");
}

/// A book numbered below one already written is refused, not published.
///
/// The engine ranks by version before anything else, so such a book loses every
/// product the higher one names: it is accepted, dispatched to every shop, and
/// changes nothing. Nothing fails, nothing logs, and the prices somebody
/// carefully authored are simply not the prices anybody is charged.
///
/// The number is allocated by the setup path with a lock and taken from the
/// caller by this one — two authorities for one sequence. The lock is now taken
/// here too, so the check cannot be raced past.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_book_numbered_below_the_newest_is_refused(pool: PgPool) {
    let sku: Uuid = sqlx::query_scalar("SELECT id FROM sku WHERE active ORDER BY sku_code LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("a seeded SKU: {e}"));

    let book = |version: i64, key: &'static str| CreateCommercialPublicationRequest {
        change_type: None,
        version,
        name: format!("Buku {version}"),
        effective_from: Utc::now() - Duration::days(1),
        effective_to: None,
        tax_rules: vec![CommercialTaxRuleInput {
            tax_category: "STANDARD".into(),
            rate_bps: 0,
            tax_inclusive: true,
        }],
        offer_rules: vec![CommercialOfferRuleInput {
            sku_id: sku,
            site_id: None,
            site_ids: None,
            channel: CommercialChannel::Store,
            sellable: true,
            currency: "IDR".into(),
            unit_price_minor: 100_000 + version,
            tax_category: "STANDARD".into(),
        }],
        markdowns: Vec::new(),
        rules: Vec::new(),
        coupons: Vec::new(),
        campaigns: Vec::new(),
        actor_id: "merchandiser".into(),
        idempotency_key: key.into(),
    };

    infrastructure::create_commercial_publication(&pool, book(900, "climb-1"))
        .await
        .unwrap_or_else(|e| panic!("a book above the seed is fine: {e}"));

    let backwards =
        infrastructure::create_commercial_publication(&pool, book(899, "climb-2")).await;
    let message = match backwards {
        Err(error) => error.to_string(),
        Ok(created) => panic!("a book numbered below v900 was accepted: {created}"),
    };
    assert!(
        message.contains("change nothing"),
        "and it says why, not just that it refused: {message}"
    );

    // The same number twice is refused for the same reason, before the unique
    // index has to catch it.
    let repeat = infrastructure::create_commercial_publication(&pool, book(900, "climb-3")).await;
    assert!(repeat.is_err(), "v900 already exists");
}

/// Register an Edge origin the way a provisioning run does: a credential, and
/// nothing else. No watermark, no facts — a node that exists on paper.
async fn register_edge(pool: &PgPool, origin_id: &str, site_id: &str, node_role: &str) {
    sqlx::query(
        "INSERT INTO sync_origin_credential
             (origin_id, ingest_key_sha256, label, site_id, node_role,
              active_generation, inventory_enabled)
         VALUES ($1, repeat('0', 64), $2, $3, $4, 1, true)",
    )
    .bind(origin_id)
    .bind(format!("{node_role} {site_id}"))
    .bind(site_id)
    .bind(node_role)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("register {origin_id}: {error}"));
}

/// The node speaking for the first time: a watermark, and one piece on a shelf.
async fn report_facts(pool: &PgPool, origin_id: &str, place_id: &str, quantity: i64) {
    sqlx::query(
        "INSERT INTO sync_applied_watermark (origin_id, generation, applied_seq)
         VALUES ($1, 1, 7)
         ON CONFLICT (origin_id, generation) DO UPDATE SET applied_seq = 7",
    )
    .bind(origin_id)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("watermark {origin_id}: {error}"));
    // A position belongs to a subject the origin has already identified, so the
    // identity goes in first — the same order the sync applier writes them.
    let subject_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO edge_inventory_fact_subject_identity
             (origin_id, subject_id, first_generation, first_seq)
         VALUES ($1, $2, 1, 1)",
    )
    .bind(origin_id)
    .bind(subject_id)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("subject {origin_id}: {error}"));
    sqlx::query(
        "INSERT INTO edge_inventory_fact_position
             (origin_id, subject_id, place_id, quantity, last_generation, last_seq)
         VALUES ($1, $2, $3, $4, 1, 1)",
    )
    .bind(origin_id)
    .bind(subject_id)
    .bind(place_id)
    .bind(quantity)
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("fact {origin_id} {place_id}: {error}"));
}

/// Find one fleet row by the pool it names and the source it came from.
fn fleet_row<'a>(
    fleet: &'a serde_json::Value,
    pool_id: &str,
    source: &str,
) -> &'a serde_json::Value {
    fleet["items"]
        .as_array()
        .unwrap_or_else(|| panic!("fleet items: {fleet}"))
        .iter()
        .find(|item| item["id"] == pool_id && item["source_type"] == source)
        .unwrap_or_else(|| panic!("no {source} row for {pool_id}"))
}

fn counted(row: &serde_json::Value) -> bool {
    row["authority"]["included_in_fleet_total"]
        .as_bool()
        .unwrap_or_else(|| panic!("authority on {row}"))
}

/// Owning a site is a claim; applying a fact is the node having spoken. Only
/// the second one takes a shop's numbers off the Cloud ledger.
///
/// Both halves of this were live at once and cancelled out into a plausible
/// screen: thirteen shops read nought because a provisioned-but-silent Edge
/// shadowed their real balances, while the DC's warehouse was counted twice
/// because the centre spells it `dc` and the node spells it `dc-01`, so nothing
/// matched and neither row was shadowed. The fleet total was wrong in both
/// directions simultaneously.
#[sqlx::test(migrations = "./migrations/postgres")]
async fn an_edge_node_shadows_a_pool_only_once_it_has_reported_that_pool(pool: PgPool) {
    register_edge(&pool, "store-02-edge", "store-02", "STORE").await;
    register_edge(&pool, "dc-01-edge", "dc-01", "DC").await;

    // Nobody has said anything yet.
    let fleet = infrastructure::list_fleet_pools(&pool, "cloud-primary", 24, 30)
        .await
        .unwrap_or_else(|error| panic!("fleet: {error}"));

    assert!(
        counted(fleet_row(&fleet, "store-02.warehouse", "CLOUD_LEDGER")),
        "a shop whose node has never reported is still counted by the centre"
    );
    assert!(
        !counted(fleet_row(
            &fleet,
            "store-02.warehouse",
            "EDGE_FACT_POSITION"
        )),
        "and the silent node's own base pool stays out, so the shelf is counted once"
    );
    let diagnostics = &fleet["fleet_total_diagnostics"];
    assert_eq!(
        diagnostics["shadowed_cloud_site_ids"],
        serde_json::json!([]),
        "nothing is shadowed while nothing has reported: {diagnostics}"
    );
    assert!(
        diagnostics["unreported_edge_origins"]
            .as_array()
            .is_some_and(|origins| origins.len() == 2),
        "and both silent origins are named: {diagnostics}"
    );

    // Now both nodes speak. The DC reports under its own spelling, `dc-01`.
    report_facts(&pool, "store-02-edge", "store-02.warehouse:on_hand", 5).await;
    report_facts(&pool, "dc-01-edge", "dc-01.warehouse:on_hand", 9).await;

    let fleet = infrastructure::list_fleet_pools(&pool, "cloud-primary", 24, 30)
        .await
        .unwrap_or_else(|error| panic!("fleet after reporting: {error}"));

    assert!(
        !counted(fleet_row(&fleet, "store-02.warehouse", "CLOUD_LEDGER")),
        "the shop's Cloud row steps aside once its owner has reported the pool"
    );
    assert!(
        counted(fleet_row(
            &fleet,
            "store-02.warehouse",
            "EDGE_FACT_POSITION"
        )),
        "and the owner's row is the one that counts"
    );

    // The DC's two spellings are the same warehouse, and it is counted once.
    assert!(
        !counted(fleet_row(&fleet, "dc.warehouse", "CLOUD_LEDGER")),
        "`dc.warehouse` is shadowed by `dc-01.warehouse` despite the different name"
    );
    assert!(
        counted(fleet_row(&fleet, "dc-01.warehouse", "EDGE_FACT_POSITION")),
        "the node's own spelling carries the number"
    );

    // But shadowing is per pool, not per site. The centre splits outbound into
    // a row per destination store; the Edge has no spelling for those at all,
    // so the Cloud rows remain the only account of them.
    assert!(
        counted(fleet_row(
            &fleet,
            "dc.outbound.picked.store-01",
            "CLOUD_LEDGER"
        )),
        "a pool the owner does not model is not deleted by its ownership"
    );

    // The invariant the whole rule exists for: one counted row per shelf.
    let mut seen = std::collections::BTreeSet::new();
    for item in fleet["items"].as_array().unwrap_or_else(|| panic!("items")) {
        if !counted(item) {
            continue;
        }
        let id = item["id"].as_str().unwrap_or_default();
        let logical = id
            .strip_prefix("dc-01.")
            .map(|rest| format!("dc.{rest}"))
            .unwrap_or_else(|| id.to_string());
        assert!(
            seen.insert(logical.clone()),
            "{logical} is counted twice in the fleet total"
        );
    }
}
