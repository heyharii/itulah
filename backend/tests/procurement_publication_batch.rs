//! Publication fan-out keeps each shop's scoped rows and dense command cursor.
//!
//! The test exercises the public authoring and publish calls across more than
//! one eight-shop dispatch chunk, then retries the publish with the same
//! idempotency key. The stored command payloads are the recipient-specific
//! contract the shop will actually apply.

use chrono::{Duration, Utc};
use inventory_backend::cloud::{
    application::{CommandRequest, CommercialMarkdownInput, CreateCommercialPublicationRequest},
    domain::COMMAND_ACTIVATE_PUBLICATION,
    postgres as cloud,
};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

const ORIGIN_PREFIX: &str = "publication-batch-store-";

fn markdown(
    id: &str,
    article: &str,
    site_id: Option<&str>,
    site_ids: Option<Vec<String>>,
) -> CommercialMarkdownInput {
    CommercialMarkdownInput {
        markdown_id: id.into(),
        sku_id: None,
        sku_code: None,
        article_code: Some(article.into()),
        site_id: site_id.map(str::to_owned),
        site_ids,
        replacement_unit_price_minor: 125_000,
        priority: 4,
        campaign_id: None,
        iso_weekdays: Vec::new(),
        from_minute: None,
        to_minute: None,
        effective_from: Utc::now() - Duration::days(1),
        effective_to: None,
    }
}

fn markdown_row<'a>(payload: &'a Value, id: &str) -> &'a Value {
    payload["markdowns"]
        .as_array()
        .unwrap_or_else(|| panic!("markdown array missing: {payload}"))
        .iter()
        .find(|row| row["markdown_id"] == id)
        .unwrap_or_else(|| panic!("markdown {id} missing from {payload}"))
}

async fn register_stores(pool: &PgPool) -> Vec<(String, String)> {
    let mut targets = Vec::new();
    for index in 1..=10 {
        let origin_id = format!("{ORIGIN_PREFIX}{index:02}");
        let site_id = format!("store-{index:02}");
        cloud::register_origin_credential_binding(
            pool,
            &origin_id,
            &format!("{origin_id}-publication-batch-sync-key-0000000001"),
            Some("publication batch test"),
            Some(&site_id),
            Some("STORE"),
            Some(1),
            Some(false),
        )
        .await
        .unwrap_or_else(|error| panic!("register {origin_id}: {error}"));
        targets.push((origin_id, site_id));
    }
    targets
}

async fn command_rows(pool: &PgPool, publication_id: Uuid) -> Vec<(String, i64, Uuid, Value)> {
    sqlx::query(
        "SELECT d.origin_id,d.seq,d.command_id,c.payload
           FROM sync_command_delivery d
           JOIN sync_command c USING (command_id)
          WHERE c.command_type=$1
            AND c.payload->>'publication_id'=$2
          ORDER BY d.origin_id",
    )
    .bind(COMMAND_ACTIVATE_PUBLICATION)
    .bind(publication_id.to_string())
    .fetch_all(pool)
    .await
    .unwrap_or_else(|error| panic!("publication deliveries: {error}"))
    .into_iter()
    .map(|row| {
        (
            row.get("origin_id"),
            row.get("seq"),
            row.get("command_id"),
            row.get("payload"),
        )
    })
    .collect()
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn publish_batches_store_commands_without_changing_scope_or_retry_semantics(pool: PgPool) {
    let targets = register_stores(&pool).await;
    let origins: Vec<String> = targets.iter().map(|(origin, _)| origin.clone()).collect();

    // Start one recipient partway through its stream with a matching existing
    // delivery. The other nine are new, so the publish increments each cursor
    // once and preserves the seeded recipient's acknowledgement.
    let prior_command = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sync_command(command_id,command_type,payload,issued_by)
         VALUES ($1,'test.seed','{}','publication-batch-test')",
    )
    .bind(prior_command)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("seed command: {error}"));
    sqlx::query(
        "INSERT INTO sync_command_cursor (origin_id,next_seq,acked_seq)
         VALUES ($1,5,3)",
    )
    .bind(&origins[0])
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("seed cursor: {error}"));
    sqlx::query(
        "INSERT INTO sync_command_delivery(origin_id,seq,command_id)
         VALUES ($1,5,$2)",
    )
    .bind(&origins[0])
    .bind(prior_command)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("seed delivery: {error}"));

    let previous: Vec<(String, i64)> = sqlx::query(
        "SELECT target.origin_id,COALESCE(cursor.next_seq,0)::bigint next_seq
           FROM unnest($1::text[]) AS target(origin_id)
           LEFT JOIN sync_command_cursor cursor USING (origin_id)
          ORDER BY target.origin_id",
    )
    .bind(&origins)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read initial cursors: {error}"))
    .into_iter()
    .map(|row| (row.get("origin_id"), row.get("next_seq")))
    .collect();

    let version: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version),0)+100 FROM commercial_publication")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("publication version: {error}"));
    let created = cloud::create_commercial_publication(
        &pool,
        CreateCommercialPublicationRequest {
            change_type: None,
            version,
            name: "Publication fan-out scope test".into(),
            effective_from: Utc::now() - Duration::minutes(1),
            effective_to: None,
            tax_rules: Vec::new(),
            offer_rules: Vec::new(),
            markdowns: vec![
                markdown("GLOBAL-PRICE", "ARTICLE-GLOBAL", None, None),
                markdown(
                    "GROUP-PRICE",
                    "ARTICLE-GROUP",
                    None,
                    Some(vec!["store-01".into(), "store-02".into()]),
                ),
                markdown("SITE-PRICE", "ARTICLE-SITE", Some("store-01"), None),
            ],
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: Vec::new(),
            actor_id: "publication-batch-test".into(),
            idempotency_key: Uuid::new_v4().to_string(),
        },
    )
    .await
    .unwrap_or_else(|error| panic!("create publication: {error}"));
    let publication_id: Uuid = created["id"]
        .as_str()
        .unwrap_or_else(|| panic!("publication id missing: {created}"))
        .parse()
        .unwrap_or_else(|error| panic!("publication id: {error}"));
    let request = CommandRequest {
        actor_id: "publication-batch-test".into(),
        idempotency_key: Uuid::new_v4().to_string(),
    };

    let first = cloud::publish_commercial_publication(&pool, publication_id, request.clone())
        .await
        .unwrap_or_else(|error| panic!("publish: {error}"));
    assert_eq!(first["delivered_to"].as_array().map(Vec::len), Some(10));

    let rows = command_rows(&pool, publication_id).await;
    assert_eq!(rows.len(), 10);
    for (origin_id, seq, _command_id, payload) in &rows {
        let old_seq = previous
            .iter()
            .find(|(origin, _)| origin == origin_id)
            .map(|(_, seq)| *seq)
            .unwrap_or_else(|| panic!("no prior cursor for {origin_id}"));
        assert_eq!(*seq, old_seq + 1, "delivery sequence for {origin_id}");
        assert_eq!(payload["publication_id"], json!(publication_id));
        assert_eq!(payload["version"], json!(version));
        assert_eq!(payload["name"], json!("Publication fan-out scope test"));
        assert!(payload["effective_from"].is_string());
        assert!(payload["effective_to"].is_null());
        assert_eq!(payload["price_rules"], json!([]));
        assert_eq!(payload["tax_rules"], json!([]));
        assert_eq!(payload["rules"], json!([]));
        assert_eq!(payload["coupons"], json!([]));
        assert_eq!(payload["campaigns"], json!([]));
        let global = markdown_row(payload, "GLOBAL-PRICE");
        assert_eq!(global["article_code"], json!("ARTICLE-GLOBAL"));
        assert!(global["site_id"].is_null());
        assert!(global["site_ids"].is_null());
        assert_eq!(global["replacement_unit_price_minor"], json!(125_000));
        assert_eq!(global["priority"], json!(4));
        assert!(global["effective_from"].is_string());
        assert!(global["effective_to"].is_null());
    }

    let markdown_ids = |payload: &Value| {
        payload["markdowns"]
            .as_array()
            .unwrap_or_else(|| panic!("markdown array missing: {payload}"))
            .iter()
            .map(|row| row["markdown_id"].as_str().unwrap_or_default().to_owned())
            .collect::<Vec<_>>()
    };
    for (origin_id, _, _, payload) in &rows {
        let expected = if origin_id == &origins[0] {
            vec!["GLOBAL-PRICE", "GROUP-PRICE", "SITE-PRICE"]
        } else if origin_id == &origins[1] {
            vec!["GLOBAL-PRICE", "GROUP-PRICE"]
        } else {
            vec!["GLOBAL-PRICE"]
        };
        assert_eq!(
            markdown_ids(payload),
            expected,
            "scoped rows for {origin_id}"
        );
        if origin_id == &origins[0] {
            assert_eq!(
                markdown_row(payload, "SITE-PRICE")["site_id"],
                json!("store-01")
            );
            assert!(markdown_row(payload, "SITE-PRICE")["site_ids"].is_null());
        }
        if origin_id == &origins[0] || origin_id == &origins[1] {
            assert_eq!(
                markdown_row(payload, "GROUP-PRICE")["site_ids"],
                json!(["store-01", "store-02"])
            );
        }
    }

    let cursor_rows = sqlx::query(
        "SELECT origin_id,next_seq,acked_seq
           FROM sync_command_cursor
          WHERE origin_id = ANY($1::text[])
          ORDER BY origin_id",
    )
    .bind(&origins)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read cursors: {error}"));
    assert_eq!(cursor_rows.len(), 10);
    for row in cursor_rows {
        let origin_id: String = row.get("origin_id");
        let old_seq = previous
            .iter()
            .find(|(origin, _)| *origin == origin_id)
            .map(|(_, seq)| *seq)
            .unwrap_or_default();
        assert_eq!(row.get::<i64, _>("next_seq"), old_seq + 1, "{origin_id}");
        assert_eq!(
            row.get::<i64, _>("acked_seq"),
            if origin_id == origins[0] { 3 } else { 0 },
            "acknowledgement is preserved for {origin_id}"
        );
    }

    // A retry returns the recorded response and does not append a second
    // command or consume another cursor position.
    let retry = cloud::publish_commercial_publication(&pool, publication_id, request)
        .await
        .unwrap_or_else(|error| panic!("retry publish: {error}"));
    assert_eq!(retry, first);
    assert_eq!(command_rows(&pool, publication_id).await.len(), 10);
    for row in sqlx::query(
        "SELECT origin_id,next_seq
           FROM sync_command_cursor
          WHERE origin_id = ANY($1::text[])
          ORDER BY origin_id",
    )
    .bind(&origins)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("read retry cursors: {error}"))
    {
        let origin_id: String = row.get("origin_id");
        let old_seq = previous
            .iter()
            .find(|(origin, _)| *origin == origin_id)
            .map(|(_, seq)| *seq)
            .unwrap_or_default();
        assert_eq!(row.get::<i64, _>("next_seq"), old_seq + 1, "{origin_id}");
    }
}
