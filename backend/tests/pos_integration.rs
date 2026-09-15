//! POS-lane integration scenarios: tender rules, post-completion returns,
//! receipt reconstruction, the daily report, and the JWT/role gate on the
//! HTTP surface. Each test runs on its own migrated database via sqlx::test.

use axum::body::{to_bytes, Body};
use http::Request;
use inventory_backend::cloud::{
    application::{
        AddSaleLineRequest, AddSalePaymentRequest, AppConfig, AppState, CommandRequest,
        CommercialOfferRuleInput, CommercialTaxRuleInput, CreateCommercialPublicationRequest,
        CreateReturnRequest, CreateSaleRequest, DailyReportQuery, RefundInput, ReturnLineInput,
        ReturnQuery,
    },
    domain::{CommercialChannel, PaymentMethod},
    http as api_http, postgres as infrastructure,
};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::{net::SocketAddr, path::PathBuf};
use tower::ServiceExt;
use uuid::Uuid;

fn test_config(jwt_secret: Option<&str>) -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0"
            .parse::<SocketAddr>()
            .unwrap_or_else(|e| panic!("socket address: {e}")),
        database_url: "postgresql:///sqlx-test".into(),
        node_id: "pos-test-edge".into(),
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
        jwt_secret: jwt_secret.map(str::to_owned),
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

async fn publish_price_book(pool: &PgPool) {
    let sku_rows = sqlx::query("SELECT id FROM sku WHERE active ORDER BY sku_code")
        .fetch_all(pool)
        .await
        .unwrap_or_else(|e| panic!("active SKUs: {e}"));
    let offer_rules: Vec<CommercialOfferRuleInput> = sku_rows
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
    let publication = infrastructure::create_commercial_publication(
        pool,
        CreateCommercialPublicationRequest {
            campaigns: Vec::new(),
            markdowns: Vec::new(),
            rules: Vec::new(),
            coupons: Vec::new(),
            // Authored since 0231, and this book authors nothing: the test is
            // about what the till charges, not about how the change is filed.
            change_type: None,
            version: 2,
            name: "POS Test Price Book".into(),
            effective_from: chrono::Utc::now() - chrono::Duration::minutes(1),
            effective_to: None,
            tax_rules: vec![CommercialTaxRuleInput {
                tax_category: "STANDARD".into(),
                rate_bps: 1_100,
                tax_inclusive: true,
            }],
            offer_rules,
            actor_id: "commercial-manager".into(),
            idempotency_key: "pos-test-pricebook".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("create publication: {e}"));
    let publication_id = Uuid::parse_str(publication["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("publication UUID: {e}"));
    infrastructure::publish_commercial_publication(
        pool,
        publication_id,
        CommandRequest {
            actor_id: "commercial-approver".into(),
            idempotency_key: "pos-test-pricebook-publish".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("publish: {e}"));
}

async fn floor_epcs(pool: &PgPool, site_id: &str, count: usize) -> Vec<String> {
    let place = format!("{site_id}.floor:on_hand");
    let rows = sqlx::query(
        "WITH delta AS (\
            SELECT subject_id, SUM(CASE WHEN to_place_id=$1 THEN quantity ELSE -quantity END)::bigint bal \
            FROM movement WHERE to_place_id=$1 OR from_place_id=$1 GROUP BY subject_id\
         ) SELECT s.epc FROM delta d JOIN inventory_subject s ON s.id=d.subject_id \
         WHERE d.bal > 0 AND s.subject_type='UNIT' AND s.epc IS NOT NULL ORDER BY s.epc LIMIT $2",
    )
    .bind(&place)
    .bind(count as i64)
    .fetch_all(pool)
    .await
    .unwrap_or_else(|e| panic!("floor EPCs: {e}"));
    rows.into_iter()
        .map(|row| row.get::<String, _>("epc"))
        .collect()
}

async fn place_balance(pool: &PgPool, epc: &str, place: &str) -> i64 {
    sqlx::query(
        "SELECT COALESCE(SUM(CASE WHEN m.to_place_id=$2 THEN m.quantity \
         WHEN m.from_place_id=$2 THEN -m.quantity ELSE 0 END),0)::bigint bal \
         FROM movement m JOIN inventory_subject s ON s.id=m.subject_id WHERE s.epc=$1",
    )
    .bind(epc)
    .bind(place)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|e| panic!("place balance: {e}"))
    .get("bal")
}

async fn completed_sale(pool: &PgPool, site: &str, epcs: &[String], key_prefix: &str) -> Value {
    let sale = infrastructure::create_sale(
        pool,
        CreateSaleRequest {
            customer_id: None,
            site_id: site.into(),
            channel: CommercialChannel::Store,
            actor_id: "kasir-1".into(),
            idempotency_key: format!("{key_prefix}-create"),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("create sale: {e}"));
    let sale_id = Uuid::parse_str(sale["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("sale UUID: {e}"));
    for (index, epc) in epcs.iter().enumerate() {
        infrastructure::add_sale_line(
            pool,
            sale_id,
            AddSaleLineRequest {
                epc: epc.clone(),
                quantity: 1,
                actor_id: "kasir-1".into(),
                idempotency_key: format!("{key_prefix}-line-{index}"),
            },
        )
        .await
        .unwrap_or_else(|e| panic!("add line {epc}: {e}"));
    }
    let total: i64 = sqlx::query("SELECT total_minor FROM sale WHERE id=$1")
        .bind(sale_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("sale total: {e}"))
        .get("total_minor");
    infrastructure::add_sale_payment(
        pool,
        sale_id,
        AddSalePaymentRequest {
            method: "CASH".into(),
            amount_minor: total + 50_000,
            reference: None,
            actor_id: "kasir-1".into(),
            idempotency_key: format!("{key_prefix}-payment"),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("payment: {e}"));
    infrastructure::complete_sale(
        pool,
        sale_id,
        CommandRequest {
            actor_id: "kasir-1".into(),
            idempotency_key: format!("{key_prefix}-complete"),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("complete: {e}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn tender_rules_hold_at_the_http_boundary_of_payments(pool: PgPool) {
    publish_price_book(&pool).await;
    let epcs = floor_epcs(&pool, "store-07", 1).await;
    assert_eq!(epcs.len(), 1, "seed needs a Store 07 floor EPC");

    let sale = infrastructure::create_sale(
        &pool,
        CreateSaleRequest {
            customer_id: None,
            site_id: "store-07".into(),
            channel: CommercialChannel::Store,
            actor_id: "kasir-1".into(),
            idempotency_key: "tender-create".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("create sale: {e}"));
    let sale_id = Uuid::parse_str(sale["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("sale UUID: {e}"));

    // No payment before the first line.
    assert!(infrastructure::add_sale_payment(
        &pool,
        sale_id,
        AddSalePaymentRequest {
            method: "CASH".into(),
            amount_minor: 10_000,
            reference: None,
            actor_id: "kasir-1".into(),
            idempotency_key: "tender-early-payment".into(),
        },
    )
    .await
    .is_err());

    infrastructure::add_sale_line(
        &pool,
        sale_id,
        AddSaleLineRequest {
            epc: epcs[0].clone(),
            quantity: 1,
            actor_id: "kasir-1".into(),
            idempotency_key: "tender-line".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("add line: {e}"));
    let total: i64 = sqlx::query("SELECT total_minor FROM sale WHERE id=$1")
        .bind(sale_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|e| panic!("total: {e}"))
        .get("total_minor");

    // Electronic tender may never exceed the total.
    assert!(infrastructure::add_sale_payment(
        &pool,
        sale_id,
        AddSalePaymentRequest {
            method: "QRIS".into(),
            amount_minor: total + 1,
            reference: Some("RRN-1".into()),
            actor_id: "kasir-1".into(),
            idempotency_key: "tender-qris-over".into(),
        },
    )
    .await
    .is_err());

    // Exact electronic payment completes with zero change.
    infrastructure::add_sale_payment(
        &pool,
        sale_id,
        AddSalePaymentRequest {
            method: "QRIS".into(),
            amount_minor: total,
            reference: Some("RRN-2".into()),
            actor_id: "kasir-1".into(),
            idempotency_key: "tender-qris-exact".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("qris payment: {e}"));
    let completed = infrastructure::complete_sale(
        &pool,
        sale_id,
        CommandRequest {
            actor_id: "kasir-1".into(),
            idempotency_key: "tender-complete".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("complete: {e}"));
    assert_eq!(completed["change_minor"], 0);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn returns_receipts_and_the_daily_report_agree(pool: PgPool) {
    publish_price_book(&pool).await;
    let epcs = floor_epcs(&pool, "store-07", 2).await;
    assert_eq!(epcs.len(), 2, "seed needs two Store 07 floor EPCs");
    let completed = completed_sale(&pool, "store-07", &epcs, "rr").await;
    let sale_id = Uuid::parse_str(completed["id"].as_str().unwrap_or_default())
        .unwrap_or_else(|e| panic!("sale UUID: {e}"));

    // Receipt reconstructs the committed rows.
    let receipt = infrastructure::build_receipt(&pool, sale_id)
        .await
        .unwrap_or_else(|e| panic!("receipt: {e}"));
    assert_eq!(receipt["currency"], "IDR", "currency must come out trimmed");
    let receipt_lines = receipt["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("receipt lines"));
    assert_eq!(receipt_lines.len(), 2);
    let tax_sum: i64 = receipt["tax_summary"]
        .as_array()
        .unwrap_or_else(|| panic!("tax summary"))
        .iter()
        .filter_map(|group| group["tax_minor"].as_i64())
        .sum();
    assert_eq!(json!(tax_sum), receipt["totals"]["tax_minor"]);
    assert_eq!(receipt["totals"]["refunded_minor"], 0);
    assert_eq!(receipt["totals"]["total_minor"], completed["total_minor"]);

    let line_rows = sqlx::query(
        "SELECT l.id,l.total_minor,s.epc FROM sale_line l \
         JOIN inventory_subject s ON s.id=l.subject_id WHERE l.sale_id=$1 ORDER BY l.added_at",
    )
    .bind(sale_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|e| panic!("lines: {e}"));
    let (line_1_id, line_1_total, line_1_epc) = (
        line_rows[0].get::<Uuid, _>("id"),
        line_rows[0].get::<i64, _>("total_minor"),
        line_rows[0].get::<String, _>("epc"),
    );
    let (line_2_id, line_2_total, line_2_epc) = (
        line_rows[1].get::<Uuid, _>("id"),
        line_rows[1].get::<i64, _>("total_minor"),
        line_rows[1].get::<String, _>("epc"),
    );

    // Refund must equal the value of the returned goods.
    assert!(infrastructure::create_sale_return(
        &pool,
        sale_id,
        CreateReturnRequest {
            lines: vec![ReturnLineInput {
                sale_line_id: line_1_id,
                restock: true
            }],
            refunds: vec![RefundInput {
                method: PaymentMethod::Cash,
                amount_minor: line_1_total + 1,
                reference: None,
            }],
            reason: "wrong refund".into(),
            actor_id: "spv-1".into(),
            idempotency_key: "return-wrong-amount".into(),
        },
    )
    .await
    .is_err());

    // Sellable return goes back to the floor, idempotently.
    let return_request = CreateReturnRequest {
        lines: vec![ReturnLineInput {
            sale_line_id: line_1_id,
            restock: true,
        }],
        refunds: vec![RefundInput {
            method: PaymentMethod::Cash,
            amount_minor: line_1_total,
            reference: None,
        }],
        reason: "customer changed their mind".into(),
        actor_id: "spv-1".into(),
        idempotency_key: "return-line-1".into(),
    };
    let returned = infrastructure::create_sale_return(&pool, sale_id, return_request.clone())
        .await
        .unwrap_or_else(|e| panic!("return: {e}"));
    assert_eq!(
        returned,
        infrastructure::create_sale_return(&pool, sale_id, return_request)
            .await
            .unwrap_or_else(|e| panic!("return retry: {e}"))
    );
    assert_eq!(
        place_balance(&pool, &line_1_epc, "store-07.floor:on_hand").await,
        1,
        "restocked item is sellable again"
    );
    assert_eq!(
        place_balance(&pool, &line_1_epc, "external/customer").await,
        0
    );

    // The same line cannot be returned twice.
    assert!(infrastructure::create_sale_return(
        &pool,
        sale_id,
        CreateReturnRequest {
            lines: vec![ReturnLineInput {
                sale_line_id: line_1_id,
                restock: true
            }],
            refunds: vec![RefundInput {
                method: PaymentMethod::Cash,
                amount_minor: line_1_total,
                reference: None,
            }],
            reason: "double dip".into(),
            actor_id: "spv-1".into(),
            idempotency_key: "return-line-1-again".into(),
        },
    )
    .await
    .is_err());

    // Damaged return lands in the reject pool, not the floor.
    infrastructure::create_sale_return(
        &pool,
        sale_id,
        CreateReturnRequest {
            lines: vec![ReturnLineInput {
                sale_line_id: line_2_id,
                restock: false,
            }],
            refunds: vec![RefundInput {
                method: PaymentMethod::Cash,
                amount_minor: line_2_total,
                reference: None,
            }],
            reason: "damaged in the bag".into(),
            actor_id: "spv-1".into(),
            idempotency_key: "return-line-2".into(),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("damaged return: {e}"));
    assert_eq!(
        place_balance(&pool, &line_2_epc, "store-07.reject:on_hand").await,
        1
    );
    assert_eq!(
        place_balance(&pool, &line_2_epc, "store-07.floor:on_hand").await,
        0
    );

    // Receipt now reflects both returns.
    let receipt_after = infrastructure::build_receipt(&pool, sale_id)
        .await
        .unwrap_or_else(|e| panic!("receipt after: {e}"));
    assert_eq!(
        receipt_after["totals"]["refunded_minor"],
        json!(line_1_total + line_2_total)
    );
    assert!(receipt_after["lines"]
        .as_array()
        .unwrap_or_else(|| panic!("lines"))
        .iter()
        .all(|line| line["returned"] == true));

    // Listing filters by site.
    let listed = infrastructure::list_sale_returns(
        &pool,
        ReturnQuery {
            site_id: Some("store-07".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_else(|e| panic!("list returns: {e}"));
    // `rows` and a `total` beside them: the refund list answers an envelope
    // now, and the total is over the whole matched set rather than the page —
    // which here is the same two, and has to be checked to stay that way.
    assert_eq!(listed.rows.len(), 2);
    assert_eq!(listed.total, 2);

    // Daily report ties out: gross, tenders, refunds, expected cash.
    let today = chrono::Utc::now()
        .with_timezone(&chrono::FixedOffset::east_opt(7 * 3600).unwrap_or_else(|| panic!("tz")))
        .date_naive();
    let report = infrastructure::daily_sales_report(
        &pool,
        DailyReportQuery {
            site_id: "store-07".into(),
            date: today,
            utc_offset_minutes: Some(420),
        },
    )
    .await
    .unwrap_or_else(|e| panic!("daily report: {e}"));
    assert_eq!(report["sales"]["count"], 1);
    assert_eq!(report["sales"]["gross_minor"], completed["total_minor"]);
    assert_eq!(
        report["returns"]["refund_total_minor"],
        json!(line_1_total + line_2_total)
    );
    let cash_tendered = report["cash"]["cash_tendered_minor"]
        .as_i64()
        .unwrap_or_default();
    let change = report["cash"]["change_given_minor"]
        .as_i64()
        .unwrap_or_default();
    let refunded = report["cash"]["cash_refunded_minor"]
        .as_i64()
        .unwrap_or_default();
    assert_eq!(
        report["cash"]["cash_expected_minor"],
        json!(cash_tendered - change - refunded)
    );
    assert_eq!(change, 50_000);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn auth_gates_every_protected_route(pool: PgPool) {
    infrastructure::bootstrap_admin(&pool, Some("admin-password-1"), true)
        .await
        .unwrap_or_else(|e| panic!("bootstrap: {e}"));
    let app = api_http::router(AppState::new(
        pool.clone(),
        test_config(Some("test-secret")),
    ));

    let send =
        |app: axum::Router, method: &str, uri: &str, token: Option<String>, body: Option<Value>| {
            let method = method.to_owned();
            let uri = uri.to_owned();
            async move {
                let mut builder = Request::builder().method(method.as_str()).uri(uri);
                if let Some(token) = token {
                    builder = builder.header("authorization", format!("Bearer {token}"));
                }
                let request = match body {
                    Some(value) => builder
                        .header("content-type", "application/json")
                        .body(Body::from(value.to_string())),
                    None => builder.body(Body::empty()),
                }
                .unwrap_or_else(|e| panic!("request: {e}"));
                let response = app
                    .oneshot(request)
                    .await
                    .unwrap_or_else(|e| panic!("response: {e}"));
                let status = response.status().as_u16();
                let bytes = to_bytes(response.into_body(), 1 << 20)
                    .await
                    .unwrap_or_else(|e| panic!("body: {e}"));
                let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
                (status, value)
            }
        };

    // Health stays public; protected reads do not.
    let (status, _) = send(app.clone(), "GET", "/api/v1/health", None, None).await;
    assert_eq!(status, 200);
    let (status, _) = send(app.clone(), "GET", "/api/v1/inventory/pools", None, None).await;
    assert_eq!(status, 401);
    let (status, _) = send(app.clone(), "GET", "/api/v1/sales", None, None).await;
    assert_eq!(status, 401);

    // Wrong password is refused; the right one yields a token.
    let (status, _) = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({"username":"admin","password":"wrong-password"})),
    )
    .await;
    assert_eq!(status, 401);
    let (status, login) = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({"username":"admin","password":"admin-password-1"})),
    )
    .await;
    assert_eq!(status, 200);
    let admin_token = login["token"].as_str().unwrap_or_default().to_owned();
    assert!(!admin_token.is_empty());

    // Admin creates a cashier; the cashier logs in.
    let (status, _) = send(
        app.clone(),
        "POST",
        "/api/v1/auth/users",
        Some(admin_token.clone()),
        Some(json!({
            "username":"kasir-1","display_name":"Kasir Satu",
            "password":"kasir-password","role":"CASHIER"
        })),
    )
    .await;
    assert_eq!(status, 200);
    let (status, cashier_login) = send(
        app.clone(),
        "POST",
        "/api/v1/auth/login",
        None,
        Some(json!({"username":"kasir-1","password":"kasir-password"})),
    )
    .await;
    assert_eq!(status, 200);
    let cashier_token = cashier_login["token"]
        .as_str()
        .unwrap_or_default()
        .to_owned();

    // Role ladder: a cashier cannot move stock or manage users.
    let (status, _) = send(
        app.clone(),
        "POST",
        "/api/v1/inventory/movements",
        Some(cashier_token.clone()),
        Some(json!({"idempotency_key":"x","actor_id":"kasir-1","reason":"r","lines":[]})),
    )
    .await;
    assert_eq!(status, 403);
    let (status, _) = send(
        app.clone(),
        "GET",
        "/api/v1/auth/users",
        Some(cashier_token.clone()),
        None,
    )
    .await;
    assert_eq!(status, 403);

    // The audit trail is truthful: actor_id must match the principal.
    let (status, body) = send(
        app.clone(),
        "POST",
        "/api/v1/sales",
        Some(cashier_token.clone()),
        Some(json!({
            "site_id":"store-07","channel":"STORE",
            "actor_id":"someone-else","idempotency_key":"auth-actor-mismatch"
        })),
    )
    .await;
    assert_eq!(status, 403, "mismatched actor_id must be refused: {body}");

    // With the right actor the request passes auth and the sale opens against
    // the seeded price book.
    let (status, _) = send(
        app.clone(),
        "POST",
        "/api/v1/sales",
        Some(cashier_token.clone()),
        Some(json!({
            "site_id":"store-07","channel":"STORE",
            "actor_id":"kasir-1","idempotency_key":"auth-actor-match"
        })),
    )
    .await;
    assert_eq!(status, 201);

    // Garbage tokens are refused.
    let (status, _) = send(
        app.clone(),
        "GET",
        "/api/v1/inventory/pools",
        Some("not-a-real-token".into()),
        None,
    )
    .await;
    assert_eq!(status, 401);
}
