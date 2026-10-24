//! Head office's view of its shop servers, against Postgres.
//!
//! Heartbeats in, incidents filed once, alerts raised once per condition and
//! once on recovery, silence noticed by the sweep, uptime and the Fleet list
//! read back, and the operations head office may ask of a node validated at
//! the desk (`cloud/postgres/node_health.rs`, `sync/node_status.rs`,
//! `sync/node_ops.rs`).

use chrono::{Duration, Utc};
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::sync::node_status::{
    DeviceFacts, Incident, MachineFacts, NodeStatus, PreviousExit, SyncFacts, TillFacts,
};
use serde_json::json;
use sqlx::PgPool;

const ORIGIN: &str = "store-07";

async fn register(pool: &PgPool) {
    cloud::register_origin_credential_binding(
        pool,
        ORIGIN,
        "store-07-health-test-key-000000000000000001",
        Some("Toko 07"),
        Some(ORIGIN),
        Some("STORE"),
        Some(1),
        Some(true),
    )
    .await
    .unwrap_or_else(|error| panic!("register: {error}"));
    sqlx::query(
        "INSERT INTO app_user (id, username, display_name, password_hash, role, created_by)
         VALUES (gen_random_uuid(), 'ho-admin', 'HO Admin', 'x', 'ADMIN', 'test')",
    )
    .execute(pool)
    .await
    .unwrap_or_else(|error| panic!("admin: {error}"));
}

fn status() -> NodeStatus {
    let now = Utc::now();
    NodeStatus {
        taken_at: now,
        site_id: ORIGIN.into(),
        origin_id: ORIGIN.into(),
        generation: 1,
        version: "0.1.0".into(),
        started_at: now - Duration::hours(2),
        hostname: "toko07".into(),
        os: "linux x86_64".into(),
        sync: SyncFacts {
            enabled: true,
            last_success_at: Some(now),
            ..SyncFacts::default()
        },
        machine: MachineFacts {
            disk_free_bytes: Some(60 << 30),
            disk_total_bytes: Some(100 << 30),
            ..MachineFacts::default()
        },
        devices: DeviceFacts::default(),
        till: TillFacts::default(),
        incidents: vec![Incident::Started {
            at: now - Duration::hours(2),
            version: "0.1.0".into(),
            previous: PreviousExit::Unclean {
                last_seen: now - Duration::hours(2) - Duration::seconds(40),
                machine_restarted: Some(false),
            },
        }],
        device_list: None,
        capabilities: None,
        link_outages: None,
        action_results: None,
        app_address: None,
        sign_ins: None,
    }
}

async fn alerts(pool: &PgPool, kind: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM notification WHERE kind = $1 AND origin_id = $2")
        .bind(kind)
        .bind(ORIGIN)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("count: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_heartbeat_is_filed_and_its_incidents_only_once(pool: PgPool) {
    register(&pool).await;
    let before = Utc::now();
    let snapshot = status();
    let received = cloud::record_heartbeat(&pool, ORIGIN, &snapshot)
        .await
        .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    assert!(received >= before);
    cloud::record_heartbeat(&pool, ORIGIN, &snapshot)
        .await
        .unwrap_or_else(|error| panic!("second heartbeat: {error}"));
    let incidents: i64 =
        sqlx::query_scalar("SELECT count(*) FROM node_incident WHERE origin_id = $1")
            .bind(ORIGIN)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|error| panic!("incidents: {error}"));
    assert_eq!(
        incidents, 1,
        "the same incident in two heartbeats is filed once"
    );

    let fleet = cloud::fleet(&pool)
        .await
        .unwrap_or_else(|error| panic!("fleet: {error}"));
    let node = fleet
        .iter()
        .find(|node| node.origin_id == ORIGIN)
        .unwrap_or_else(|| panic!("node listed"));
    assert_eq!(node.assessment.code, "RECOVERED", "one crash today, healed");
    assert!(node.last_heard_at.is_some());

    let uptime = cloud::node_uptime(&pool, ORIGIN)
        .await
        .unwrap_or_else(|error| panic!("uptime: {error}"));
    assert_eq!(uptime.state, "UP");
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_condition_is_announced_once_and_its_end_once(pool: PgPool) {
    register(&pool).await;
    let mut sick = status();
    sick.sync.dead_lettered = 2;
    for _ in 0..3 {
        cloud::record_heartbeat(&pool, ORIGIN, &sick)
            .await
            .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    }
    assert_eq!(alerts(&pool, "node.attention").await, 1);
    assert_eq!(alerts(&pool, "node.recovered").await, 0);

    let mut well = status();
    well.incidents.clear();
    cloud::record_heartbeat(&pool, ORIGIN, &well)
        .await
        .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    assert_eq!(alerts(&pool, "node.recovered").await, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn silence_is_noticed_by_the_sweep_once(pool: PgPool) {
    register(&pool).await;
    // With the fleet alerts on (0637), a silent server is theirs to announce;
    // this is the older per-node alert, which still speaks when they are off.
    sqlx::query("UPDATE fleet_setting SET alerts_enabled = false")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("fleet alerts off: {error}"));
    cloud::record_heartbeat(&pool, ORIGIN, &status())
        .await
        .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    sqlx::query("UPDATE node_heartbeat SET received_at = now() - interval '15 minutes'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("age: {error}"));
    assert_eq!(cloud::sweep_silent_nodes(&pool).await.unwrap_or(0), 1);
    assert_eq!(
        cloud::sweep_silent_nodes(&pool).await.unwrap_or(0),
        0,
        "once per silence"
    );
    assert_eq!(alerts(&pool, "node.attention").await, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn operations_are_checked_at_the_desk_and_sent_to_the_node(pool: PgPool) {
    register(&pool).await;
    cloud::ask_node(
        &pool,
        ORIGIN,
        "node.restart",
        json!({ "reason": "kasir lambat", "force": false }),
        "ho-admin",
    )
    .await
    .unwrap_or_else(|error| panic!("restart: {error}"));
    let sent: Vec<String> = sqlx::query_scalar(
        "SELECT c.command_type FROM sync_command_delivery d
           JOIN sync_command c ON c.command_id = d.command_id WHERE d.origin_id = $1",
    )
    .bind(ORIGIN)
    .fetch_all(&pool)
    .await
    .unwrap_or_else(|error| panic!("deliveries: {error}"));
    assert_eq!(sent, vec!["node.restart".to_owned()]);

    let no_reason = cloud::ask_node(
        &pool,
        ORIGIN,
        "node.backup",
        json!({ "reason": " " }),
        "ho-admin",
    )
    .await;
    assert!(
        matches!(no_reason, Err(AppError::Validation(_))),
        "{no_reason:?}"
    );
    let plain_http = cloud::ask_node(
        &pool,
        ORIGIN,
        "node.update",
        json!({ "reason": "rilis", "version": "1.4.0", "url": "http://x/store",
                "sha256": "a".repeat(64), "signature": "b".repeat(128) }),
        "ho-admin",
    )
    .await;
    assert!(
        matches!(plain_http, Err(AppError::Validation(_))),
        "{plain_http:?}"
    );
    let unknown = cloud::ask_node(
        &pool,
        ORIGIN,
        "node.format",
        json!({ "reason": "x" }),
        "ho-admin",
    )
    .await;
    assert!(
        matches!(unknown, Err(AppError::Validation(_))),
        "{unknown:?}"
    );
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn diagnoses_are_kept_newest_ten(pool: PgPool) {
    register(&pool).await;
    for index in 0..12 {
        cloud::record_diagnostic(
            &pool,
            ORIGIN,
            &json!({ "verdict": if index == 11 { "FAIL" } else { "OK" }, "checks": [] }),
        )
        .await
        .unwrap_or_else(|error| panic!("diagnostic: {error}"));
    }
    let kept = cloud::node_diagnostics(&pool, ORIGIN)
        .await
        .unwrap_or_else(|error| panic!("diagnostics: {error}"));
    assert_eq!(kept.len(), 10);
    assert_eq!(kept[0]["verdict"], "FAIL", "newest first");
}
