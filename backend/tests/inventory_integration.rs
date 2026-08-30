use axum::body::{to_bytes, Body};
use chrono::{Duration, Utc};
use http::Request;
use inventory_edge::{
    application::{
        AddSaleLineRequest, AddSalePaymentRequest, AllotmentQuery, AvailabilityQuery,
        CancelAllotmentRequest, CommandRequest, CommercialOfferRuleInput, CommercialTaxRuleInput,
        CorruptProjectionRequest, CreateAllotmentLineInput, CreateAllotmentRequest,
        CreateCommercialPublicationRequest, CreateCountRequest, CreateMovementRequest,
        CreateSaleRequest, ExecuteAllotmentRequest, MissingResolutionRequest, MovementLineRequest,
        ObservationBatchRequest, ReplayRequest, ReplayScope, RepostRequest, ResolveOfferQuery,
    },
    domain::{AllotmentType, CommercialChannel, CountKind, DestinationType, RfidRead},
    http as api_http, infrastructure, AppConfig, AppState,
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

#[sqlx::test(migrations = "./migrations")]
async fn inventory_foundation_end_to_end(pool: PgPool) {
    let pools = infrastructure::list_pools(&pool, None, 24, 30)
        .await
        .unwrap_or_else(|e| panic!("list pools: {e}"));
    let pool_items = pools["items"]
        .as_array()
        .unwrap_or_else(|| panic!("pool array"));
    assert_eq!(pool_items.len(), 60);
    assert_eq!(
        pool_items.iter().filter(|p| p["site_id"] == "dc").count(),
        21
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
    let correction = inventory_edge::application::CorrectPlacementRequest {
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

#[sqlx::test(migrations = "./migrations")]
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
        sku_id: target_sku,
        site_id: Some("store-07".into()),
        channel: CommercialChannel::Store,
        sellable: true,
        currency: "IDR".into(),
        unit_price_minor: 250_000,
        tax_category: "STANDARD".into(),
    });
    let publication_request = CreateCommercialPublicationRequest {
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
            publication_id: None,
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
            publication_id: None,
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

#[sqlx::test(migrations = "./migrations")]
async fn allotment_is_a_concurrency_safe_commitment_and_pick_is_atomic(pool: PgPool) {
    let availability = infrastructure::get_availability(&pool, AvailabilityQuery::default())
        .await
        .unwrap_or_else(|e| panic!("initial availability: {e}"));
    let candidates: Vec<(Uuid, i64)> = availability["items"]
        .as_array()
        .unwrap_or_else(|| panic!("availability items"))
        .iter()
        .filter_map(|item| {
            let available = item["available_qty"].as_i64()?;
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
    assert_eq!(created_sku["allotment_qty"], 10);
    assert_eq!(created_sku["available_qty"], cancel_available - 10);

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
    assert_eq!(cancelled_sku["allotment_qty"], 0);
    assert_eq!(cancelled_sku["available_qty"], cancel_available);

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
            .and_then(|item| item["remaining_qty"].as_i64())
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
    let available_before_pick = pick_before["available_qty"].as_i64().unwrap_or_default();
    let allotment_before_pick = pick_before["allotment_qty"].as_i64().unwrap_or_default();
    let warehouse_before_pick = sku_place_quantity(&pool, pick_sku, "dc.warehouse:on_hand").await;
    let picked_before = sku_place_quantity(&pool, pick_sku, "dc.outbound.picked:on_hand").await;
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
        sku_place_quantity(&pool, pick_sku, "dc.outbound.picked:on_hand").await,
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
    assert_eq!(pick_after["allotment_qty"], allotment_before_pick - 3);
    assert_eq!(pick_after["available_qty"], available_before_pick);
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
    assert_eq!(detail["destination_store_id"], "store-02");
    assert!(detail["movements"].as_array().is_some_and(|rows| {
        rows.iter().all(|movement| {
            movement["reference_id"] == store_02_id.to_string()
                && movement["destination_store_id"] == "store-02"
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
            reference_id: Some(store_02_id.to_string()),
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
            "dc.outbound.picked:on_hand",
            "dc.outbound.packed:on_hand",
            "outbound-without-allotment-provenance",
            "TEST",
        ),
    )
    .await
    .is_err());
    for (from, to, key) in [
        (
            "dc.outbound.picked:on_hand",
            "dc.outbound.packed:on_hand",
            "allotment-outbound-packed",
        ),
        (
            "dc.outbound.packed:on_hand",
            "dc.outbound.shipment:on_hand",
            "allotment-outbound-shipment",
        ),
        (
            "dc.outbound.shipment:on_hand",
            "dc.outbound.in-transit:on_hand",
            "allotment-outbound-transit",
        ),
    ] {
        infrastructure::create_manual_movement(&pool, outbound_move(from, to, key, "ALLOTMENT"))
            .await
            .unwrap_or_else(|e| panic!("continue Allotment outbound: {e}"));
    }
    assert!(
        infrastructure::create_manual_movement(
            &pool,
            outbound_move(
                "dc.outbound.in-transit:on_hand",
                "store-01.warehouse:on_hand",
                "allotment-wrong-store",
                "ALLOTMENT",
            ),
        )
        .await
        .is_err(),
        "Store 02 Allotment cannot arrive at Store 01"
    );
    infrastructure::create_manual_movement(
        &pool,
        outbound_move(
            "dc.outbound.in-transit:on_hand",
            "store-02.warehouse:on_hand",
            "allotment-correct-store",
            "ALLOTMENT",
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
        .and_then(|item| item["available_qty"].as_i64())
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
        .and_then(|item| item["available_qty"].as_i64())
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
    assert_eq!(shortage_sku["on_hand_qty"], 0);
    assert_eq!(shortage_sku["allotment_qty"], shortage_available);
    assert_eq!(shortage_sku["available_qty"], -shortage_available);
    assert_eq!(shortage_sku["shortage_qty"], shortage_available);
    assert!(
        sku_place_quantity(&pool, cancel_sku, "dc.warehouse:missing").await > 0,
        "Missing remains physical state and is excluded from Available"
    );
    let shortage_detail = infrastructure::get_allotment(&pool, shortage_allotment_id)
        .await
        .unwrap_or_else(|e| panic!("shortage Allotment detail: {e}"));
    assert_eq!(shortage_detail["status"], "ACTIVE");
    assert_eq!(shortage_detail["remaining_qty"], shortage_available);
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
    assert_eq!(warehouse["allotment"], shortage_after["allotment_qty"]);
    assert_eq!(warehouse["available"], shortage_after["available_qty"]);
    let list = infrastructure::list_allotments(&pool, AllotmentQuery::default())
        .await
        .unwrap_or_else(|e| panic!("Allotment list: {e}"));
    assert!(list["by_destination"]
        .as_array()
        .is_some_and(|rows| rows.len() == 13));
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
