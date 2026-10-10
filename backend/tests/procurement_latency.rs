//! Opt-in latency benchmark. All writes use sqlx's disposable migrated DB.
//! DATABASE_URL=postgresql:///postgres INVENTORY_AUTH_MODE=disabled INVENTORY_DC_HOSTING=cloud \
//! cargo test --locked --test procurement_latency -- --ignored --nocapture
use inventory_backend::cloud::domain::flow::{Effect, FlowStatus};
use inventory_backend::cloud::{http, postgres as db, AppConfig, AppState};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{collections::BTreeMap, time::Instant};
use uuid::Uuid;

async fn post(client: &reqwest::Client, base: &str, path: &str, body: Value) -> Value {
    let response = client
        .post(format!("{base}{path}"))
        .header("Idempotency-Key", Uuid::new_v4().to_string())
        .json(&body)
        .send()
        .await
        .unwrap_or_else(|e| panic!("{path}: {e}"));
    let status = response.status();
    let text = response
        .text()
        .await
        .unwrap_or_else(|e| panic!("body: {e}"));
    assert!(status.is_success(), "{path}: {status} {text}");
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("json: {e}: {text}"))
}
fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}
fn report(label: &str, mut values: Vec<f64>) {
    let ordered_runs = values.clone();
    values.sort_by(f64::total_cmp);
    let percentile = |p: f64| values[((values.len() as f64 * p).ceil() as usize).saturating_sub(1)];
    println!(
        "PERF {}",
        json!({"operation":label,"samples":values.len(),"p50_ms":percentile(0.5),"p95_ms":percentile(0.95),"min_ms":values[0],"max_ms":values[values.len()-1],"runs_ms":ordered_runs})
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
#[ignore = "explicit local HTTP latency benchmark, writes only to an isolated SQLx database"]
async fn procurement_save_and_ready_latency(pool: PgPool) {
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::ERROR)
        .try_init();
    assert_eq!(
        std::env::var("INVENTORY_DC_HOSTING").ok().as_deref(),
        Some("cloud")
    );
    let mut config = AppConfig::from_env().unwrap_or_else(|e| panic!("config: {e}"));
    config.jwt_secret = None;
    config.media = None;
    config.attachments = None;
    config.enable_test_controls = false;
    let sites: Vec<String> =
        sqlx::query_scalar("SELECT id FROM site WHERE kind='STORE' ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| panic!("sites: {e}"));
    for site in &sites {
        db::register_origin_credential_binding(
            &pool,
            &format!("perf-{site}"),
            "performance-disposable-sync-key-00000000000001",
            Some("Perf store"),
            Some(site),
            Some("STORE"),
            Some(1),
            Some(true),
        )
        .await
        .unwrap_or_else(|e| panic!("store: {e}"));
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap_or_else(|e| panic!("bind: {e}"));
    let base = format!(
        "http://{}",
        listener
            .local_addr()
            .unwrap_or_else(|e| panic!("address: {e}"))
    );
    let app = http::router(AppState::new(pool.clone(), config));
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    let client = reqwest::Client::new();
    let ho: String = sqlx::query_scalar("SELECT head_office_site_id()")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("ho: {e}"));
    let source: String = sqlx::query_scalar(
        "SELECT id FROM operational_pool WHERE site_id=$1 AND role='STOCKROOM' ORDER BY id LIMIT 1",
    )
    .bind(&ho)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|e| panic!("pool: {e}"));
    let max_colours = std::env::var("PERF_MAX_COLOURS").ok().as_deref() == Some("true");
    let wide = max_colours || std::env::var("PERF_WIDE").ok().as_deref() == Some("true");
    let colour_limit = std::env::var("PERF_COLOUR_COUNT")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(if wide { 10 } else { 2 });
    if max_colours {
        sqlx::query(
            "INSERT INTO colour(code,label,display_order)
             SELECT 'PERF-COLOR-'||n, 'Performance fixture colour '||n, n
             FROM generate_series(1,10) n",
        )
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("maximum colour fixture: {e}"));
        sqlx::query(
            "INSERT INTO size_code(code,label,display_order)
             SELECT n::text, 'Performance fixture size '||n, n FROM generate_series(80,99) n
             ON CONFLICT(code) DO UPDATE SET active=true,display_order=EXCLUDED.display_order",
        )
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("maximum size fixture: {e}"));
    }
    let colours: Vec<String> =
        sqlx::query_scalar("SELECT code FROM colour WHERE active AND (NOT $2::bool OR code LIKE 'PERF-COLOR-%') ORDER BY code LIMIT $1")
            .bind(colour_limit)
            .bind(max_colours)
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| panic!("colours: {e}"));
    let sizes: Vec<String> = sqlx::query_scalar(
        "SELECT btrim(code) FROM size_code WHERE active AND (NOT $2::bool OR code BETWEEN '80' AND '99') ORDER BY display_order,code LIMIT $1",
    )
    .bind(if wide { 20i64 } else { 5 })
    .bind(max_colours)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("sizes: {e}"));
    assert!(!colours.is_empty());
    assert!(!sizes.is_empty());
    if max_colours {
        assert_eq!(colours.len(), colour_limit as usize);
        assert_eq!(sizes.len(), 20);
    }
    assert!(sites.len() >= 5);
    let variant_count = colours.len() * sizes.len();
    let mut samples: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    let mut bulk_items = Vec::new();
    let runs = std::env::var("PERF_RUNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(7);
    println!(
        "PERF_CONTEXT {}",
        json!({"stores":sites.len(),"variants":variant_count,"warmup_runs":1,"measured_runs":runs,"worker_queue_wait_included":false,"auth":"disabled","transport":"loopback HTTP","debug_assertions":cfg!(debug_assertions)})
    );
    for units in if wide {
        vec![5000i64]
    } else {
        vec![120i64, 1000, 5000]
    } {
        for run in 0..=runs {
            let key = Uuid::new_v4().to_string();
            let po = db::NewPurchaseOrder {
                po_number: format!("PERF-{key}"),
                supplier_id: "SUP-01".into(),
                supplier_name: None,
                destination_site_id: ho.clone(),
                origin_kind: "DIRECT".into(),
                currency: "IDR".into(),
                notes: None,
                created_by: "development".into(),
                lines: vec![db::NewPurchaseLine {
                    article_code: format!("PERF-{key}"),
                    article_name: "Performance shirt".into(),
                    image_url: None,
                    division_code: Some("PRIA".into()),
                    tags: vec!["KEMEJA".into()],
                    ordered_quantity: units,
                    unit_price_minor: 300000,
                    promised_date: None,
                    unit_code: None,
                    unit_quantity: None,
                    order_unit_price_minor: None,
                }],
            };
            let (po_id, _, _) = db::create_purchase_order(&pool, &po)
                .await
                .unwrap_or_else(|e| panic!("po: {e}"));
            let line: Uuid = sqlx::query_scalar(
                "SELECT po_line_id FROM purchase_order_line WHERE purchase_order_id=$1",
            )
            .bind(po_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("line: {e}"));
            let receipt = post(&client,&base,"/api/v1/dc/goods-receipts",json!({"supplier_id":"SUP-01","actor_id":"development","idempotency_key":format!("receipt-{key}")})).await;
            post(&client,&base,"/api/v1/dc/purchase-counts",json!({"receipt_id":receipt["receipt_id"],"po_line_id":line,"counted_quantity":units,"wrong_quantity":0,"actor_id":"development","idempotency_key":format!("count-{key}")})).await;
            let accepted: Uuid = sqlx::query_scalar(
                "SELECT receipt_line_id FROM goods_receipt_line WHERE po_line_id=$1",
            )
            .bind(line)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|e| panic!("accepted: {e}"));
            let variants: Vec<Value> = colours.iter().enumerate()
                .flat_map(|(c,_)| sizes.iter().map(move |s| (c,s)))
                .enumerate().map(|(index,(c,s))| json!({"colour_digit":((c+1)%10).to_string(),"size_code":s,"quantity":units/variant_count as i64 + i64::from((index as i64) < units % variant_count as i64),"base_price_minor":450000})).collect();
            let body = json!({"receipt_line_id":accepted,"article_name":"Performance shirt","division_code":"PRIA","tags":["KEMEJA"],"currency":"IDR","colours":colours.iter().enumerate().map(|(c,code)| json!({"colour_digit":((c+1)%10).to_string(),"colour_code":code})).collect::<Vec<_>>(),"variants":variants,"created_by":"development"});
            let started = Instant::now();
            let session = post(
                &client,
                &base,
                "/api/v1/article-setups?background=true",
                body,
            )
            .await;
            let save_ms = ms(started);
            assert_eq!(session["issue_state"], "QUEUED");
            let worker_start = Instant::now();
            assert_eq!(
                db::process_setup_issue_queue(&pool)
                    .await
                    .unwrap_or_else(|e| panic!("worker: {e}")),
                1
            );
            let worker_ms = ms(worker_start);
            let session_id: Uuid = serde_json::from_value(session["session_id"].clone())
                .unwrap_or_else(|e| panic!("session: {e}"));
            let status = db::setup_session_status(&pool, session_id)
                .await
                .unwrap_or_else(|e| panic!("status: {e}"));
            assert_eq!(status["issue_state"], "DONE", "{status}");
            let minted: i64 = sqlx::query_scalar("SELECT COALESCE(sum(p.quantity),0)::bigint FROM inventory_projection p JOIN inventory_subject subject ON subject.id=p.subject_id JOIN sku ON sku.id=subject.sku_id WHERE sku.created_by_session_id=$1")
                .bind(session_id).fetch_one(&pool).await.unwrap_or_else(|e| panic!("minted: {e}"));
            assert_eq!(minted, units);
            let published_prices: Vec<(String, i64)> = sqlx::query_as(
                "SELECT d.origin_id,jsonb_array_length(c.payload->'price_rules')::bigint
                 FROM sync_command_delivery d JOIN sync_command c USING(command_id)
                 WHERE c.payload->>'publication_id' IN (
                   SELECT DISTINCT pr.publication_id::text FROM commercial_price_rule pr
                   JOIN sku ON sku.id=pr.sku_id WHERE sku.created_by_session_id=$1)
                 ORDER BY d.origin_id",
            )
            .bind(session_id)
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| panic!("published prices: {e}"));
            assert_eq!(published_prices.len(), sites.len());
            for (origin, count) in published_prices {
                assert_eq!(count, variant_count as i64, "price rules for {origin}");
            }
            if bulk_items.len() < 10 && !(units == 5000 && run == runs) {
                let ids: Vec<Uuid> = sqlx::query_scalar(
                    "SELECT id FROM sku WHERE created_by_session_id=$1 ORDER BY sku_code",
                )
                .bind(session_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_else(|e| panic!("bulk SKUs: {e}"));
                bulk_items.push(json!({"type":"TO_STORE","lines":ids.iter().map(|sku| json!({
                    "source_site_id":ho,"source_pool_id":source,"destination_type":"STORE",
                    "destination_id":sites[0],"sku_id":sku,"quantity":1
                })).collect::<Vec<_>>(),"actor_id":"development","idempotency_key":Uuid::new_v4().to_string()}));
            }

            if run > 0 {
                samples
                    .entry(format!("article_save_{units}_units"))
                    .or_default()
                    .push(save_ms);
                samples
                    .entry(format!("article_worker_{units}_units"))
                    .or_default()
                    .push(worker_ms);
            }
            if units == 5000 {
                let skus = sqlx::query(
                    "SELECT id FROM sku WHERE created_by_session_id=$1 ORDER BY sku_code",
                )
                .bind(session_id)
                .fetch_all(&pool)
                .await
                .unwrap_or_else(|e| panic!("skus: {e}"));
                assert_eq!(skus.len(), variant_count);
                for destinations in [1, 5, sites.len()] {
                    let ho_ref = &ho;
                    let source_ref = &source;
                    let lines: Vec<Value> = skus.iter().flat_map(|sku| sites.iter().take(destinations).map(move |site| json!({"source_site_id":ho_ref,"source_pool_id":source_ref,"destination_type":"STORE","destination_id":site,"sku_id":sku.get::<Uuid,_>("id"),"quantity":1}))).collect();
                    let start = Instant::now();
                    let allotment = post(&client,&base,"/api/v1/inventory/allotments/batch",json!({"items":[{"type":"TO_STORE","lines":lines,"actor_id":"development","idempotency_key":Uuid::new_v4().to_string()}]})).await;
                    let elapsed = ms(start);
                    assert!(allotment["failed_index"].is_null(), "{allotment}");
                    assert_eq!(allotment["items"].as_array().map(Vec::len), Some(1));
                    let created_id = allotment["items"][0]["id"]
                        .as_str()
                        .unwrap_or_else(|| panic!("id: {allotment}"));
                    let flows: i64 = sqlx::query_scalar("SELECT count(*) FROM flow_document WHERE source_kind='ALLOTMENT' AND source_id=$1")
                        .bind(created_id).fetch_one(&pool).await.unwrap_or_else(|e| panic!("flows: {e}"));
                    assert_eq!(flows, destinations as i64);
                    let pending_first: i64 = sqlx::query_scalar("SELECT count(*) FROM flow_stage_state s JOIN flow_document d ON d.id=s.document_id WHERE d.source_kind='ALLOTMENT' AND d.source_id=$1 AND s.stage_index=0 AND s.status='PENDING' AND s.activated_at IS NOT NULL")
                        .bind(created_id).fetch_one(&pool).await.unwrap_or_else(|e| panic!("stages: {e}"));
                    assert_eq!(pending_first, destinations as i64);
                    let events: Vec<(String, Value)> = sqlx::query_as(
                        "SELECT d.status,e.payload FROM flow_document d JOIN flow_event e ON e.document_id=d.id
                         WHERE d.source_kind='ALLOTMENT' AND d.source_id=$1 AND e.event_type='STATUS'
                         AND e.stage_index IS NULL AND e.executed_at='HUB' AND e.target_site_id IS NULL",
                    )
                    .bind(created_id).fetch_all(&pool).await.unwrap_or_else(|e| panic!("initial events: {e}"));
                    assert_eq!(events.len(), destinations);
                    for (status, payload) in events {
                        let expected = serde_json::to_value(Effect::Status {
                            from: FlowStatus::Requested,
                            to: FlowStatus::parse(&status)
                                .unwrap_or_else(|| panic!("status: {status}")),
                            reason: None,
                        })
                        .unwrap_or_else(|e| panic!("status payload: {e}"));
                        assert_eq!(payload, expected);
                    }
                    if run > 0 {
                        samples
                            .entry(format!(
                                "allotment_{variant_count}_skus_{destinations}_destinations"
                            ))
                            .or_default()
                            .push(elapsed);
                    }
                }
                if run == runs {
                    // Two real HTTP requests compete for the same remaining
                    // stock. Run after timing so this correctness guard does
                    // not change the comparative workload.
                    let quantity = units / variant_count as i64 - (1 + 5 + sites.len()) as i64;
                    assert!(quantity > 0);
                    let race_body = || {
                        json!({"items":[{"type":"TO_STORE","lines":[{
                        "source_site_id":ho,"source_pool_id":source,
                        "destination_type":"STORE","destination_id":sites[0],
                        "sku_id":skus[0].get::<Uuid,_>("id"),"quantity":quantity
                    }],"actor_id":"development","idempotency_key":Uuid::new_v4().to_string()}]})
                    };
                    let a = race_body();
                    let b = race_body();
                    let path = "/api/v1/inventory/allotments/batch";
                    let (left, right) = tokio::join!(
                        post(&client, &base, path, a.clone()),
                        post(&client, &base, path, b.clone())
                    );
                    let left_ok = left["items"].as_array().map(Vec::len) == Some(1);
                    let right_ok = right["items"].as_array().map(Vec::len) == Some(1);
                    assert_eq!(
                        usize::from(left_ok) + usize::from(right_ok),
                        1,
                        "one reservation must win: {left} / {right}"
                    );
                    let (winner, loser, request) = if left_ok {
                        (&left, &right, a)
                    } else {
                        (&right, &left, b)
                    };
                    assert_eq!(loser["failed_index"], 0);
                    let retry = post(&client, &base, path, request).await;
                    assert_eq!(
                        retry["items"][0]["id"], winner["items"][0]["id"],
                        "retry must keep the winning allotment"
                    );
                    println!(
                        "GUARD concurrent_allotment_and_retry passed variants={variant_count}"
                    );
                }
            }
        }
    }
    let bulk_body = json!({"items":bulk_items});
    let started = Instant::now();
    let bulk = post(
        &client,
        &base,
        "/api/v1/inventory/allotments/batch",
        bulk_body.clone(),
    )
    .await;
    let bulk_ms = ms(started);
    let count = bulk_body["items"].as_array().map(Vec::len).unwrap_or(0);
    assert_eq!(
        bulk["items"].as_array().map(Vec::len),
        Some(count),
        "{bulk}"
    );
    assert!(bulk["failed_index"].is_null(), "{bulk}");
    let retry = post(
        &client,
        &base,
        "/api/v1/inventory/allotments/batch",
        bulk_body,
    )
    .await;
    assert_eq!(
        retry["items"], bulk["items"],
        "bulk retry must preserve all acknowledgements"
    );
    samples
        .entry(format!(
            "allotment_{count}_articles_{variant_count}_skus_one_request"
        ))
        .or_default()
        .push(bulk_ms);
    for (label, values) in samples {
        report(&label, values);
    }
    server.abort();
}
