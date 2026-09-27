//! The fleet status page against Postgres: a store's parts written down by
//! the sweep, a silent server turned into one incident told once, answered,
//! and closed when the server speaks again; sync as queues with the commands
//! named; the settings refused where the table would refuse them
//! (`cloud/postgres/fleet_status.rs`, migrations 0637-0640).

use chrono::{Duration, Utc};
use inventory_backend::cloud::application::AppError;
use inventory_backend::cloud::postgres as cloud;
use inventory_backend::sync::node_status::{
    DeviceFacts, MachineFacts, NodeStatus, QueuedFacts, SyncFacts, TillFacts,
};
use serde_json::json;
use sqlx::PgPool;

const ORIGIN: &str = "store-07";

async fn register(pool: &PgPool) {
    cloud::register_origin_credential_binding(
        pool,
        ORIGIN,
        "store-07-fleet-test-key-0000000000000000001",
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
            pending_facts: 3,
            oldest_pending_at: Some(now - Duration::seconds(20)),
            queue: Some(vec![
                QueuedFacts { kind: "SALES".into(), count: 2, oldest_at: Some(now - Duration::seconds(20)) },
                QueuedFacts { kind: "STOCK".into(), count: 1, oldest_at: Some(now - Duration::seconds(5)) },
                QueuedFacts { kind: "ATTENDANCE".into(), count: 0, oldest_at: None },
                QueuedFacts { kind: "OTHER".into(), count: 0, oldest_at: None },
            ]),
            newest_acked_at: Some(now - Duration::seconds(30)),
            ..SyncFacts::default()
        },
        machine: MachineFacts {
            disk_free_bytes: Some(60 << 30),
            disk_total_bytes: Some(100 << 30),
            last_backup_at: Some(now - Duration::hours(3)),
            ..MachineFacts::default()
        },
        devices: DeviceFacts::default(),
        till: TillFacts::default(),
        incidents: vec![],
        device_list: Some(vec![]),
        capabilities: None,
        link_outages: None,
    }
}

async fn told(pool: &PgPool, kind: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM notification WHERE kind = $1 AND payload ? 'fleet_incident_id'",
    )
    .bind(kind)
    .fetch_one(pool)
    .await
    .unwrap_or_else(|error| panic!("count: {error}"))
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn a_silent_server_is_one_incident_told_once_and_closed_when_it_speaks(pool: PgPool) {
    register(&pool).await;
    cloud::record_heartbeat(&pool, ORIGIN, &status())
        .await
        .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    let first = cloud::fleet_sweep(&pool).await.unwrap_or_else(|error| panic!("sweep: {error}"));
    assert!(first.parts > 0);
    assert_eq!(first.opened, 0, "a healthy store opens nothing");

    let page = cloud::fleet_status_page(&pool).await.unwrap_or_else(|error| panic!("page: {error}"));
    let row = page
        .stores
        .iter()
        .find(|row| row.site_id.as_deref() == Some(ORIGIN))
        .unwrap_or_else(|| panic!("the store has a row"));
    let server = row
        .components
        .iter()
        .find(|part| part.part.component == "server")
        .unwrap_or_else(|| panic!("a server part"));
    assert_eq!(server.part.state, "OK");

    // Fifteen minutes of silence, red for ten of them.
    sqlx::query("UPDATE node_heartbeat SET received_at = now() - interval '15 minutes'")
        .execute(&pool)
        .await
        .unwrap_or_else(|error| panic!("age: {error}"));
    cloud::fleet_sweep(&pool).await.unwrap_or_else(|error| panic!("sweep: {error}"));
    assert_eq!(told(&pool, "node.attention").await, 0, "not before red_after_minutes");
    sqlx::query(
        "UPDATE fleet_component SET since = now() - interval '10 minutes'
          WHERE subject = $1 AND component = 'server'",
    )
    .bind(ORIGIN)
    .execute(&pool)
    .await
    .unwrap_or_else(|error| panic!("age the colour: {error}"));
    let opened = cloud::fleet_sweep(&pool).await.unwrap_or_else(|error| panic!("sweep: {error}"));
    assert_eq!((opened.opened, opened.notified), (1, 1));
    let again = cloud::fleet_sweep(&pool).await.unwrap_or_else(|error| panic!("sweep: {error}"));
    assert_eq!((again.opened, again.notified), (0, 0), "once per incident, not per sweep");
    assert_eq!(told(&pool, "node.attention").await, 1);

    let (open, total) = cloud::fleet_incidents(
        &pool,
        &cloud::FleetIncidentQuery {
            unit: Some("C007".into()),
            state: Some("open".into()),
            ..cloud::FleetIncidentQuery::default()
        },
    )
    .await
    .unwrap_or_else(|error| panic!("incidents: {error}"));
    assert_eq!(total, 1);
    let incident_id: uuid::Uuid = open[0]["incident_id"]
        .as_str()
        .and_then(|id| id.parse().ok())
        .unwrap_or_else(|| panic!("an id"));
    let acknowledged = cloud::fleet_acknowledge_incident(&pool, incident_id, "ho-admin", Some("on it"))
        .await
        .unwrap_or_else(|error| panic!("acknowledge: {error}"));
    assert_eq!(acknowledged["state"], "ACKNOWLEDGED");

    // The server speaks again: closed, and said so once.
    cloud::record_heartbeat(&pool, ORIGIN, &status())
        .await
        .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    let recovered = cloud::fleet_sweep(&pool).await.unwrap_or_else(|error| panic!("sweep: {error}"));
    assert_eq!(recovered.resolved, 1);
    assert_eq!(told(&pool, "node.recovered").await, 1);
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn sync_is_queues_and_named_commands_not_a_percentage(pool: PgPool) {
    register(&pool).await;
    cloud::record_heartbeat(&pool, ORIGIN, &status())
        .await
        .unwrap_or_else(|error| panic!("heartbeat: {error}"));
    cloud::ask_node(&pool, ORIGIN, "node.backup", json!({ "reason": "before the update" }), "ho-admin")
        .await
        .unwrap_or_else(|error| panic!("ask: {error}"));
    let sync = cloud::fleet_sync(&pool).await.unwrap_or_else(|error| panic!("sync: {error}"));
    let store = sync["stores"]
        .as_array()
        .and_then(|stores| stores.iter().find(|store| store["site_id"] == ORIGIN))
        .unwrap_or_else(|| panic!("the store is listed"));
    assert_eq!(store["state"], "SYNCED", "{store}");
    assert_eq!(store["up"]["waiting"], 3);
    assert_eq!(store["down"]["pending"], 1);
    assert_eq!(store["down"]["commands"][0]["label"], "Server: backup");
    assert!(store["sales_complete_up_to"].is_string());
}

#[sqlx::test(migrations = "./migrations/postgres")]
async fn settings_are_refused_where_the_table_would_refuse_them(pool: PgPool) {
    let mut settings = cloud::fleet_settings(&pool)
        .await
        .unwrap_or_else(|error| panic!("settings: {error}"))
        .settings;
    settings.quiet_from = Some("22:00".into());
    let refused = cloud::fleet_update_settings(&pool, &settings, "ho-admin").await;
    assert!(matches!(refused, Err(AppError::Validation(_))), "{refused:?}");
    settings.quiet_until = Some("06:00".into());
    settings.red_after_minutes = 10;
    let saved = cloud::fleet_update_settings(&pool, &settings, "ho-admin")
        .await
        .unwrap_or_else(|error| panic!("save: {error}"));
    assert_eq!(saved.settings.quiet_from.as_deref(), Some("22:00"));
    assert_eq!(saved.settings.red_after_minutes, 10);
    assert_eq!(saved.updated_by.as_deref(), Some("ho-admin"));
}
