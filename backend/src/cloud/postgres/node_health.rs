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

/// The conditions the fleet alerts announce instead, while they are on.
const FLEET_COVERED_CODES: [&str; 6] = [
    "SILENT",
    "OFFLINE",
    "DISK_LOW",
    "DISK_CRITICAL",
    "UPS_LOW",
    "ON_BATTERY",
];

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
        // A silent server, a disk filling up and a UPS running down are
        // parts of the fleet status page, whose incidents tell the right
        // people once each (`fleet_status`, 0639). Told here as well, they
        // would be told twice.
        if FLEET_COVERED_CODES.contains(&assessment.code.as_str())
            && super::fleet_status::fleet_alerts_enabled(&mut **tx).await?
        {
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
                title: format!("{place}: recovered"),
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
    // What came of the store actions head office asked this node for
    // (`store_actions.rs`). Absent from a node that predates them.
    if let Some(reports) = &status.action_results {
        super::store_actions::record_action_reports(&mut tx, origin_id, reports).await?;
    }
    // A node that takes the goods-route commands is told, in instalments, to
    // let go of what it sent that has since been counted in elsewhere
    // (inventory-fleet G3) — including every pair matched while it ran an
    // older build.
    if status.capabilities.as_ref().is_some_and(|capabilities| {
        capabilities
            .iter()
            .any(|capability| capability == crate::sync::workflow::GOODS_ROUTES_CAPABILITY)
    }) {
        super::sync::issue_waiting_in_transit_releases_tx(&mut tx, origin_id).await?;
    }
    // A node that takes the flow commands hears what the flows touching its
    // site did while it could not (`flow_stages`), a bounded instalment at a
    // time.
    if status.capabilities.as_ref().is_some_and(|capabilities| {
        capabilities
            .iter()
            .any(|capability| capability == crate::sync::flow::FLOWS_CAPABILITY)
    }) {
        super::flow_stages::relay_waiting_flow_events_tx(&mut tx, origin_id, now).await?;
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
    // Internet outages the server stayed up through, filed like the journal's
    // incidents: once each, however many heartbeats repeat them. The fleet
    // page reads the newest as "the internet, and it kept selling".
    for outage in status.link_outages.iter().flatten() {
        sqlx::query(
            "INSERT INTO node_incident (origin_id, at, kind, payload)
             VALUES ($1, $2, 'CONNECTION_LOST', $3) ON CONFLICT DO NOTHING",
        )
        .bind(origin_id)
        .bind(outage.to)
        .bind(json!({
            "kind": "CONNECTION_LOST",
            "at": outage.to,
            "from": outage.from,
            "to": outage.to,
            "facts_written": outage.facts_written,
            "sales_written": outage.sales_written,
        }))
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

/// How many incidents one page carries when the caller does not say, and the
/// most it will carry however loudly a caller asks.
const INCIDENT_DEFAULT_LIMIT: i64 = 50;
const INCIDENT_MAX_LIMIT: i64 = 200;

/// Where the previous page of a node's history stopped — the row's own key.
/// `(at, kind)` is the table's primary key within one origin, so no two rows
/// compare equal and the seek cannot repeat or lose a row.
#[derive(Serialize, serde::Deserialize)]
struct IncidentCursor {
    at: DateTime<Utc>,
    kind: String,
}

/// One node's history: incidents over a week, newest first, one page at a
/// time. The second half is the cursor for the next page — `None` on a short
/// page, which is the last one.
///
/// It used to be a flat `LIMIT 200` with no way to ask for the rest, and the
/// sheet then drew the first twenty of those.
pub async fn node_incidents(
    pool: &PgPool,
    origin_id: &str,
    cursor: Option<&str>,
    limit: Option<i64>,
) -> Result<(Vec<Value>, Option<String>), AppError> {
    let cursor = cursor
        .map(super::decode_cursor::<IncidentCursor>)
        .transpose()?;
    let limit = limit
        .unwrap_or(INCIDENT_DEFAULT_LIMIT)
        .clamp(1, INCIDENT_MAX_LIMIT);
    let rows = sqlx::query(
        "SELECT payload, at, kind FROM node_incident
          WHERE origin_id = $1 AND at > now() - interval '7 days'
            AND ($2::timestamptz IS NULL OR (at, kind) < ($2::timestamptz, $3::text))
          ORDER BY at DESC, kind DESC
          LIMIT $4",
    )
    .bind(origin_id)
    .bind(cursor.as_ref().map(|one| one.at))
    .bind(cursor.as_ref().map(|one| one.kind.clone()))
    .bind(limit)
    .fetch_all(pool)
    .await?;
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&IncidentCursor {
            at: row.try_get("at")?,
            kind: row.try_get("kind")?,
        })?),
        _ => None,
    };
    let items = rows
        .iter()
        .map(|row| row.try_get::<Value, _>("payload"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((items, next_cursor))
}

// ---- Uptime: the status-page view ---------------------------------------------
//
// What UptimeRobot and its kind show — up since when, uptime per day and per
// window, and every outage with its length — computed from what we already
// keep: a heartbeat a minute (`node_health_sample`) and the node's own journal
// (`node_incident`). The journal is what tells a deliberate stop from a
// failure, so a restart somebody asked for is maintenance, not downtime.

/// A heartbeat is due every minute; missing more than this is a gap.
const GAP_AFTER_SECONDS: i64 = 150;
/// Head office's day, for the daily bars.
const DAY_OFFSET_SECONDS: i32 = 7 * 3600;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutageKind {
    Down,
    Maintenance,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Outage {
    pub start: DateTime<Utc>,
    /// `None` while it is still going on.
    pub end: Option<DateTime<Utc>>,
    pub seconds: i64,
    pub kind: OutageKind,
    /// One sentence: why, as far as the node could tell.
    pub cause: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UptimeWindow {
    pub days: i64,
    /// `None` before the node was ever heard from in this window.
    pub percent: Option<f64>,
    pub outages: usize,
    pub down_seconds: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DayBar {
    pub day: chrono::NaiveDate,
    pub percent: Option<f64>,
    pub down_seconds: i64,
    pub maintenance_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeUptime {
    pub origin_id: String,
    /// `UP`, `DOWN`, `MAINTENANCE` or `UNKNOWN` (never heard from).
    pub state: &'static str,
    pub since: Option<DateTime<Utc>>,
    pub last_check: Option<DateTime<Utc>>,
    pub check_every_seconds: i64,
    pub windows: Vec<UptimeWindow>,
    pub days: Vec<DayBar>,
    /// Newest first.
    pub outages: Vec<Outage>,
}

fn interval(start: DateTime<Utc>, end: Option<DateTime<Utc>>, now: DateTime<Utc>) -> i64 {
    (end.unwrap_or(now) - start).num_seconds().max(0)
}

/// Outages from the heartbeat gaps and the journal. Pure, for tests.
fn outages_from(
    samples: &[DateTime<Utc>],
    incidents: &[crate::sync::node_status::Incident],
    now: DateTime<Utc>,
) -> Vec<Outage> {
    use crate::sync::node_status::{Incident, PreviousExit};
    let mut found: Vec<Outage> = Vec::new();
    // What the journal knows, each with the span it covers.
    let mut stopped_at: Option<DateTime<Utc>> = None;
    for incident in incidents {
        match incident {
            Incident::Stopped { at, .. } => stopped_at = Some(*at),
            Incident::Started { at, previous, .. } => {
                let (start, kind, cause) = match previous {
                    PreviousExit::Clean { at: stopped } => (
                        stopped_at.unwrap_or(*stopped),
                        OutageKind::Maintenance,
                        "Stopped on purpose (restart, update, or shut down)".to_owned(),
                    ),
                    PreviousExit::Hung { at: hung } => (
                        *hung,
                        OutageKind::Down,
                        "Hung, restarted itself".to_owned(),
                    ),
                    PreviousExit::Unclean { last_seen, machine_restarted: Some(true) } => (
                        *last_seen,
                        OutageKind::Down,
                        "Power cut or the machine went off suddenly".to_owned(),
                    ),
                    PreviousExit::Unclean { last_seen, .. } => (
                        *last_seen,
                        OutageKind::Down,
                        "Server stopped suddenly (crash), recovered on its own".to_owned(),
                    ),
                    PreviousExit::FirstStart => {
                        stopped_at = None;
                        continue;
                    }
                };
                if *at > start {
                    found.push(Outage {
                        start,
                        end: Some(*at),
                        seconds: interval(start, Some(*at), now),
                        kind,
                        cause,
                    });
                }
                stopped_at = None;
            }
            Incident::CrashLoop { at, hold_seconds, .. } => found.push(Outage {
                start: *at,
                end: Some(*at + Duration::seconds(*hold_seconds)),
                seconds: *hold_seconds,
                kind: OutageKind::Down,
                cause: "Failed repeatedly, held back then tried again".to_owned(),
            }),
            _ => {}
        }
    }
    // Heartbeat gaps the journal does not already explain: the node could not
    // say why — the line, the power, or a machine that never came back.
    let mut gaps: Vec<(DateTime<Utc>, Option<DateTime<Utc>>)> = samples
        .windows(2)
        .filter(|pair| (pair[1] - pair[0]).num_seconds() > GAP_AFTER_SECONDS)
        .map(|pair| (pair[0], Some(pair[1])))
        .collect();
    if let Some(last) = samples.last() {
        if (now - *last).num_seconds() > GAP_AFTER_SECONDS {
            gaps.push((*last, None));
        }
    }
    for (start, end) in gaps {
        let gap_end = end.unwrap_or(now);
        let explained = found
            .iter_mut()
            .find(|outage| outage.start <= gap_end && outage.end.unwrap_or(now) >= start);
        match explained {
            Some(outage) => {
                // The journal says why; the heartbeat says how long.
                outage.start = outage.start.min(start);
                if end.is_none() {
                    outage.end = None;
                } else if let Some(outage_end) = outage.end {
                    outage.end = Some(outage_end.max(gap_end));
                }
                outage.seconds = interval(outage.start, outage.end, now);
            }
            None => {
                // Still going on and the last word was a deliberate stop:
                // maintenance, not an outage.
                let deliberate = end.is_none()
                    && matches!(incidents.last(), Some(Incident::Stopped { at, .. }) if *at >= start - Duration::seconds(GAP_AFTER_SECONDS));
                found.push(Outage {
                    start,
                    end,
                    seconds: interval(start, end, now),
                    kind: if deliberate { OutageKind::Maintenance } else { OutageKind::Down },
                    cause: if deliberate {
                        "Stopped on purpose".to_owned()
                    } else {
                        "No word from the server (internet, power, or machine off)".to_owned()
                    },
                });
            }
        }
    }
    found.sort_by(|a, b| b.start.cmp(&a.start));
    found
}

/// Seconds of `outages` of `kind` inside `[from, to)`.
fn overlap(outages: &[Outage], kind: OutageKind, from: DateTime<Utc>, to: DateTime<Utc>, now: DateTime<Utc>) -> i64 {
    outages
        .iter()
        .filter(|outage| outage.kind == kind)
        .map(|outage| {
            let start = outage.start.max(from);
            let end = outage.end.unwrap_or(now).min(to);
            (end - start).num_seconds().max(0)
        })
        .sum()
}

/// Uptime of `[from, to)`, excluding maintenance, from the first heartbeat on.
fn percent(outages: &[Outage], first: DateTime<Utc>, from: DateTime<Utc>, to: DateTime<Utc>, now: DateTime<Utc>) -> Option<f64> {
    let from = from.max(first);
    let to = to.min(now);
    if to <= from {
        return None;
    }
    let total = (to - from).num_seconds() as f64;
    let maintenance = overlap(outages, OutageKind::Maintenance, from, to, now) as f64;
    let down = overlap(outages, OutageKind::Down, from, to, now) as f64;
    let counted = total - maintenance;
    (counted > 0.0).then(|| ((counted - down) / counted * 100.0).clamp(0.0, 100.0))
}

fn uptime_from(
    origin_id: &str,
    samples: &[DateTime<Utc>],
    incidents: &[crate::sync::node_status::Incident],
    now: DateTime<Utc>,
) -> NodeUptime {
    let outages = outages_from(samples, incidents, now);
    let first = samples.first().copied();
    let last = samples.last().copied();
    let ongoing = outages.iter().find(|outage| outage.end.is_none());
    let (state, since) = match (first, ongoing) {
        (None, _) => ("UNKNOWN", None),
        (Some(_), Some(outage)) => (
            if outage.kind == OutageKind::Maintenance { "MAINTENANCE" } else { "DOWN" },
            Some(outage.start),
        ),
        (Some(first), None) => (
            "UP",
            Some(
                outages
                    .iter()
                    .filter_map(|outage| outage.end)
                    .max()
                    .unwrap_or(first),
            ),
        ),
    };
    let windows = [1, 7, 30, 90]
        .iter()
        .map(|days| {
            let from = now - Duration::days(*days);
            UptimeWindow {
                days: *days,
                percent: first.and_then(|first| percent(&outages, first, from, now, now)),
                outages: outages
                    .iter()
                    .filter(|outage| outage.kind == OutageKind::Down && outage.end.unwrap_or(now) > from)
                    .count(),
                down_seconds: overlap(&outages, OutageKind::Down, from, now, now),
            }
        })
        .collect();
    let offset = chrono::FixedOffset::east_opt(DAY_OFFSET_SECONDS).expect("valid offset");
    let today = now.with_timezone(&offset).date_naive();
    let days = (0..90)
        .rev()
        .map(|back| {
            let day = today - Duration::days(back);
            let start = day
                .and_hms_opt(0, 0, 0)
                .and_then(|midnight| midnight.and_local_timezone(offset).single())
                .map(|local| local.with_timezone(&Utc))
                .unwrap_or(now);
            let end = start + Duration::days(1);
            DayBar {
                day,
                percent: first.and_then(|first| percent(&outages, first, start, end, now)),
                down_seconds: overlap(&outages, OutageKind::Down, start, end, now),
                maintenance_seconds: overlap(&outages, OutageKind::Maintenance, start, end, now),
            }
        })
        .collect();
    NodeUptime {
        origin_id: origin_id.to_owned(),
        state,
        since,
        last_check: last,
        check_every_seconds: 60,
        windows,
        days,
        outages,
    }
}

/// One node's uptime over the last 90 days.
pub async fn node_uptime(pool: &PgPool, origin_id: &str) -> Result<NodeUptime, AppError> {
    let now = Utc::now();
    let samples: Vec<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT at FROM node_health_sample
          WHERE origin_id = $1 AND at > now() - interval '91 days' ORDER BY at",
    )
    .bind(origin_id)
    .fetch_all(pool)
    .await?;
    let incidents: Vec<crate::sync::node_status::Incident> = sqlx::query_scalar::<_, Value>(
        "SELECT payload FROM node_incident
          WHERE origin_id = $1 AND at > now() - interval '91 days' ORDER BY at",
    )
    .bind(origin_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .filter_map(|payload| serde_json::from_value(payload).ok())
    .collect();
    Ok(uptime_from(origin_id, &samples, &incidents, now))
}

/// Every registered shop server's uptime, for the status overview.
pub async fn fleet_uptime(pool: &PgPool) -> Result<Vec<NodeUptime>, AppError> {
    let origins: Vec<String> = sqlx::query_scalar(
        "SELECT origin_id FROM sync_origin_credential WHERE site_id IS NOT NULL ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut all = Vec::with_capacity(origins.len());
    for origin in origins {
        all.push(node_uptime(pool, &origin).await?);
    }
    Ok(all)
}

#[cfg(test)]
mod uptime_tests {
    use super::*;
    use crate::sync::node_status::{Incident, PreviousExit};

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap_or_default() + Duration::minutes(minutes)
    }

    fn beats(from: i64, to: i64) -> Vec<DateTime<Utc>> {
        (from..=to).map(at).collect()
    }

    #[test]
    fn a_node_heard_every_minute_is_up_since_its_first_heartbeat() {
        let uptime = uptime_from("s", &beats(0, 60), &[], at(60));
        assert_eq!(uptime.state, "UP");
        assert_eq!(uptime.since, Some(at(0)));
        assert_eq!(uptime.windows[0].percent, Some(100.0));
        assert!(uptime.outages.is_empty());
    }

    #[test]
    fn a_silent_gap_is_downtime_and_a_silence_now_is_down() {
        let mut samples = beats(0, 10);
        samples.extend(beats(40, 50));
        let uptime = uptime_from("s", &samples, &[], at(60));
        assert_eq!(uptime.state, "DOWN");
        assert_eq!(uptime.since, Some(at(50)));
        assert_eq!(uptime.outages.len(), 2);
        assert!(uptime.outages.iter().all(|o| o.kind == OutageKind::Down));
        assert!(uptime.windows[0].percent.is_some_and(|p| p < 70.0));
    }

    #[test]
    fn a_deliberate_restart_is_maintenance_and_not_downtime() {
        let mut samples = beats(0, 10);
        samples.extend(beats(20, 60));
        let incidents = vec![
            Incident::Stopped { at: at(10), reason: "asked to stop".into() },
            Incident::Started { at: at(20), version: "1".into(), previous: PreviousExit::Clean { at: at(10) } },
        ];
        let uptime = uptime_from("s", &samples, &incidents, at(60));
        assert_eq!(uptime.state, "UP");
        assert_eq!(uptime.outages.len(), 1);
        assert_eq!(uptime.outages[0].kind, OutageKind::Maintenance);
        assert_eq!(uptime.windows[0].percent, Some(100.0), "maintenance does not count against uptime");
    }

    #[test]
    fn a_crash_shorter_than_a_heartbeat_is_still_an_outage_with_its_cause() {
        let incidents = vec![Incident::Started {
            at: at(30),
            version: "1".into(),
            previous: PreviousExit::Unclean { last_seen: at(29), machine_restarted: Some(false) },
        }];
        let uptime = uptime_from("s", &beats(0, 60), &incidents, at(60));
        assert_eq!(uptime.outages.len(), 1);
        assert_eq!(uptime.outages[0].seconds, 60);
        assert!(uptime.outages[0].cause.contains("crash"));
        assert_eq!(uptime.state, "UP");
        assert_eq!(uptime.since, Some(at(30)));
    }

    #[test]
    fn a_power_cut_explains_the_gap_it_caused() {
        let mut samples = beats(0, 10);
        samples.extend(beats(35, 60));
        let incidents = vec![Incident::Started {
            at: at(35),
            version: "1".into(),
            previous: PreviousExit::Unclean { last_seen: at(10), machine_restarted: Some(true) },
        }];
        let uptime = uptime_from("s", &samples, &incidents, at(60));
        assert_eq!(uptime.outages.len(), 1, "{:?}", uptime.outages);
        assert!(uptime.outages[0].cause.contains("Power cut"));
        assert_eq!(uptime.outages[0].seconds, 25 * 60);
    }

    #[test]
    fn never_heard_from_is_unknown_not_down() {
        let uptime = uptime_from("s", &[], &[], at(0));
        assert_eq!(uptime.state, "UNKNOWN");
        assert!(uptime.windows.iter().all(|w| w.percent.is_none()));
    }
}

// ---- Acting from a distance --------------------------------------------------

/// Ask a node to restart, back up, or diagnose itself (`sync/node_ops.rs`).
/// Expires in an hour: an instruction that reaches a node which was off all
/// afternoon is not the instruction anybody gave.
pub async fn ask_node(
    pool: &PgPool,
    origin_id: &str,
    kind: &str,
    payload: Value,
    issued_by: &str,
) -> Result<Value, AppError> {
    if !crate::sync::node_ops::is_node_op(kind) {
        return Err(AppError::Validation(format!("unknown node operation {kind}")));
    }
    crate::sync::node_ops::validate(kind, &payload).map_err(AppError::Validation)?;
    let (command_id, _) = super::issue_command(
        pool,
        kind,
        &payload,
        issued_by,
        Some(Utc::now() + Duration::hours(1)),
        &[origin_id.to_owned()],
    )
    .await?;
    Ok(json!({ "command_id": command_id, "kind": kind, "origin_id": origin_id }))
}

/// File a diagnosis a node sent. Keeps the newest ten per node.
pub async fn record_diagnostic(pool: &PgPool, origin_id: &str, report: &Value) -> Result<(), AppError> {
    let verdict = report["verdict"].as_str().unwrap_or("WARN");
    let verdict = if matches!(verdict, "OK" | "WARN" | "FAIL") { verdict } else { "WARN" };
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO node_diagnostic (diagnostic_id, origin_id, verdict, report) VALUES ($1, $2, $3, $4)")
        .bind(uuid::Uuid::new_v4())
        .bind(origin_id)
        .bind(verdict)
        .bind(report)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM node_diagnostic WHERE origin_id = $1 AND diagnostic_id NOT IN (
             SELECT diagnostic_id FROM node_diagnostic WHERE origin_id = $1
              ORDER BY received_at DESC LIMIT 10)",
    )
    .bind(origin_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// The newest diagnoses for a node, newest first.
pub async fn node_diagnostics(pool: &PgPool, origin_id: &str) -> Result<Vec<Value>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT jsonb_build_object('received_at', received_at, 'verdict', verdict, 'report', report)
           FROM node_diagnostic WHERE origin_id = $1 ORDER BY received_at DESC LIMIT 10",
    )
    .bind(origin_id)
    .fetch_all(pool)
    .await?)
}
