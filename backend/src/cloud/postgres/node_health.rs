//! Head office's view of its shop servers: heartbeats in, Fleet out, and the
//! alerts in between.
//!
//! The judgement is `sync::node_status::assess` — the same function the
//! node's own console uses — so the Fleet page and the shop never disagree
//! about what a machine is doing. What this module adds is memory: the latest
//! snapshot per node, every incident filed once, a strip of recent health,
//! and which condition head office was last told about, so a problem is
//! announced once when it starts and once when it ends.
//!
//! Tables in migration 0463.

use super::notifications::{raise_notification, recipients_with_role, NewNotification};
use crate::cloud::application::AppError;
use crate::sync::node_status::{assess, assess_from_afar, Assessment, Needs, NodeStatus, Tone};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};

/// How long a silent node may stay silent before head office is told.
pub const SILENT_ALERT_MINUTES: i64 = 10;
/// How long the health strip remembers.
const SAMPLES_KEPT_DAYS: i64 = 30;

fn tone_text(tone: Tone) -> &'static str {
    match tone {
        Tone::Ok => "OK",
        Tone::Info => "INFO",
        Tone::Warn => "WARN",
        Tone::Bad => "BAD",
    }
}

/// Whether an assessment is something a person must hear about.
fn worth_an_alert(assessment: &Assessment) -> bool {
    assessment.tone >= Tone::Warn && assessment.needs != Needs::Nobody
}

/// Announce a condition starting or ending, at most once each, to every
/// Admin. Runs inside the caller's transaction, so the alert memory and the
/// notification commit together.
async fn announce(
    tx: &mut Transaction<'_, Postgres>,
    origin_id: &str,
    site_id: &str,
    assessment: &Assessment,
    now: DateTime<Utc>,
) -> Result<(), AppError> {
    let alerted: Option<String> = sqlx::query_scalar(
        "SELECT alerted_code FROM node_heartbeat WHERE origin_id = $1 FOR UPDATE",
    )
    .bind(origin_id)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    let place = if site_id.is_empty() { origin_id } else { site_id };
    if worth_an_alert(assessment) {
        if alerted.as_deref() == Some(assessment.code.as_str()) {
            return Ok(());
        }
        let recipients = recipients_with_role(tx, &["ADMIN"]).await?;
        raise_notification(
            tx,
            NewNotification {
                kind: "node.attention",
                title: format!("{place}: {}", assessment.label),
                body: format!("{}. {}", assessment.headline, assessment.sentence),
                subject: None,
                origin_id: Some(origin_id),
                payload: json!({ "code": assessment.code, "tone": tone_text(assessment.tone), "since": assessment.since }),
            },
            &recipients,
        )
        .await?;
        sqlx::query("UPDATE node_heartbeat SET alerted_code = $2, alerted_at = $3 WHERE origin_id = $1")
            .bind(origin_id)
            .bind(&assessment.code)
            .bind(now)
            .execute(&mut **tx)
            .await?;
    } else if let Some(previous) = alerted {
        if assessment.tone >= Tone::Warn {
            // Still not well, but nothing a person can do now — keep quiet
            // and keep the memory, so the same problem is not announced
            // twice as it flickers.
            return Ok(());
        }
        let recipients = recipients_with_role(tx, &["ADMIN"]).await?;
        raise_notification(
            tx,
            NewNotification {
                kind: "node.recovered",
                title: format!("{place}: pulih"),
                body: format!("{} {}", assessment.headline, assessment.sentence),
                subject: None,
                origin_id: Some(origin_id),
                payload: json!({ "code": assessment.code, "resolved": previous }),
            },
            &recipients,
        )
        .await?;
        sqlx::query("UPDATE node_heartbeat SET alerted_code = NULL, alerted_at = NULL WHERE origin_id = $1")
            .bind(origin_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

/// File one heartbeat. Returns the moment it was received, which the node
/// uses to measure its own clock.
pub async fn record_heartbeat(
    pool: &PgPool,
    origin_id: &str,
    status: &NodeStatus,
) -> Result<DateTime<Utc>, AppError> {
    let now = Utc::now();
    let assessment = assess(status, now);
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO node_heartbeat (origin_id, received_at, status, version, code, tone)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (origin_id) DO UPDATE SET
             received_at = EXCLUDED.received_at, status = EXCLUDED.status,
             version = EXCLUDED.version, code = EXCLUDED.code, tone = EXCLUDED.tone",
    )
    .bind(origin_id)
    .bind(now)
    .bind(serde_json::to_value(status)?)
    .bind(&status.version)
    .bind(&assessment.code)
    .bind(tone_text(assessment.tone))
    .execute(&mut *tx)
    .await?;
    // The node's devices, into the registry (`devices.rs`). Absent from a
    // node that predates it, which then files nothing here.
    if let Some(devices) = &status.device_list {
        super::devices::record_reported_devices(&mut tx, origin_id, devices).await?;
    }
    for incident in &status.incidents {
        let payload = serde_json::to_value(incident)?;
        let kind = payload["kind"].as_str().unwrap_or("UNKNOWN").to_owned();
        sqlx::query(
            "INSERT INTO node_incident (origin_id, at, kind, payload)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        )
        .bind(origin_id)
        .bind(incident.at())
        .bind(kind)
        .bind(payload)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "INSERT INTO node_health_sample (origin_id, at, tone, code) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING",
    )
    .bind(origin_id)
    .bind(now)
    .bind(tone_text(assessment.tone))
    .bind(&assessment.code)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM node_health_sample WHERE origin_id = $1 AND at < $2")
        .bind(origin_id)
        .bind(now - Duration::days(SAMPLES_KEPT_DAYS))
        .execute(&mut *tx)
        .await?;
    announce(&mut tx, origin_id, &status.site_id, &assessment, now).await?;
    tx.commit().await?;
    Ok(now)
}

/// Tell head office about nodes that have gone quiet. Run once a minute; a
/// node is announced once per silence, however long it lasts.
pub async fn sweep_silent_nodes(pool: &PgPool) -> Result<u64, AppError> {
    let now = Utc::now();
    let quiet: Vec<(String, DateTime<Utc>, Value)> = sqlx::query_as(
        "SELECT origin_id, received_at, status FROM node_heartbeat
          WHERE received_at < $1 AND alerted_code IS DISTINCT FROM 'SILENT'",
    )
    .bind(now - Duration::minutes(SILENT_ALERT_MINUTES))
    .fetch_all(pool)
    .await?;
    let mut told = 0;
    for (origin_id, received_at, status) in quiet {
        let status: Option<NodeStatus> = serde_json::from_value(status).ok();
        let assessment = assess_from_afar(status.as_ref(), Some(received_at), now);
        let site = status.as_ref().map(|s| s.site_id.clone()).unwrap_or_default();
        let mut tx = pool.begin().await?;
        announce(&mut tx, &origin_id, &site, &assessment, now).await?;
        tx.commit().await?;
        told += 1;
    }
    Ok(told)
}

/// One node on the Fleet page.
#[derive(Debug, Serialize)]
pub struct FleetNode {
    pub origin_id: String,
    pub site_id: Option<String>,
    pub site_name: Option<String>,
    pub label: Option<String>,
    pub node_role: Option<String>,
    pub generation: i64,
    pub last_heard_at: Option<DateTime<Utc>>,
    pub version: Option<String>,
    pub assessment: Assessment,
    pub status: Option<NodeStatus>,
    /// The last four hours in 16 slots of 15 minutes, oldest first: the worst
    /// tone heard in each, or `None` for a slot with no heartbeat at all.
    pub strip: Vec<Option<String>>,
    pub alerted_code: Option<String>,
}

const STRIP_SLOTS: i64 = 16;
const STRIP_SLOT_MINUTES: i64 = 15;

/// Every registered node, worst first.
pub async fn fleet(pool: &PgPool) -> Result<Vec<FleetNode>, AppError> {
    let now = Utc::now();
    let rows = sqlx::query(
        "SELECT c.origin_id, c.site_id, s.name AS site_name, c.label, c.node_role,
                c.active_generation, h.received_at, h.version, h.status, h.alerted_code
           FROM sync_origin_credential c
           LEFT JOIN site s ON s.id = c.site_id
           LEFT JOIN node_heartbeat h ON h.origin_id = c.origin_id
          WHERE c.site_id IS NOT NULL
          ORDER BY c.origin_id",
    )
    .fetch_all(pool)
    .await?;
    let since = now - Duration::minutes(STRIP_SLOTS * STRIP_SLOT_MINUTES);
    let samples: Vec<(String, DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT origin_id, at, tone FROM node_health_sample WHERE at >= $1",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;
    let rank = |tone: &str| match tone {
        "BAD" => 3,
        "WARN" => 2,
        "INFO" => 1,
        _ => 0,
    };
    let mut nodes = Vec::with_capacity(rows.len());
    for row in rows {
        let origin_id: String = row.get("origin_id");
        let status: Option<NodeStatus> = row
            .get::<Option<Value>, _>("status")
            .and_then(|value| serde_json::from_value(value).ok());
        let last_heard_at: Option<DateTime<Utc>> = row.get("received_at");
        let mut strip: Vec<Option<String>> = vec![None; STRIP_SLOTS as usize];
        for (_, at, tone) in samples.iter().filter(|(origin, ..)| *origin == origin_id) {
            let slot = ((*at - since).num_minutes() / STRIP_SLOT_MINUTES).clamp(0, STRIP_SLOTS - 1) as usize;
            let worse = strip[slot].as_deref().is_none_or(|held| rank(tone) > rank(held));
            if worse {
                strip[slot] = Some(tone.clone());
            }
        }
        nodes.push(FleetNode {
            assessment: assess_from_afar(status.as_ref(), last_heard_at, now),
            origin_id,
            site_id: row.get("site_id"),
            site_name: row.get("site_name"),
            label: row.get("label"),
            node_role: row.get("node_role"),
            generation: row.get("active_generation"),
            last_heard_at,
            version: row.get("version"),
            status,
            strip,
            alerted_code: row.get("alerted_code"),
        });
    }
    nodes.sort_by(|a, b| {
        b.assessment
            .tone
            .cmp(&a.assessment.tone)
            .then_with(|| a.origin_id.cmp(&b.origin_id))
    });
    Ok(nodes)
}

/// One node's history: incidents over a week, newest first.
pub async fn node_incidents(pool: &PgPool, origin_id: &str) -> Result<Vec<Value>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT payload FROM node_incident
          WHERE origin_id = $1 AND at > now() - interval '7 days'
          ORDER BY at DESC LIMIT 200",
    )
    .bind(origin_id)
    .fetch_all(pool)
    .await?)
}
