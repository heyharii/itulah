//! The node, looking at itself: the numbers behind the console and the
//! heartbeat.
//!
//! One collector, two readers. The console at `localhost:8082/console` shows
//! it to whoever is at the shop's server; the heartbeat (`edge/heartbeat.rs`)
//! carries the same snapshot to head office. Both then judge it with
//! `sync::node_status::assess`, so the shop and the hub use the same words.

use crate::edge::node::Journal;
use crate::edge::sync::EdgeSyncHandle;
use crate::sync::enrolment::MachineFacts as Machine;
use crate::sync::node_status::{
    queue_kind, DeviceFacts, LinkOutage, MachineFacts, NodeStatus, QueuedFacts, SyncFacts,
    TillFacts, QUEUE_ATTENDANCE, QUEUE_OTHER, QUEUE_SALES, QUEUE_STOCK,
};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::Connection;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Everything the collector needs, gathered once at start.
pub struct StatusSource {
    pub connection: Arc<Mutex<Connection>>,
    pub sync: Option<Arc<EdgeSyncHandle>>,
    pub data_dir: Option<PathBuf>,
    pub database: PathBuf,
    pub started_at: DateTime<Utc>,
    /// Set from each heartbeat answer: this machine's clock minus the cloud's.
    pub clock_skew: Mutex<Option<i64>>,
    /// When head office last answered a heartbeat, in this process: how an
    /// internet outage the server stayed up through is noticed.
    pub last_answered: Mutex<Option<DateTime<Utc>>>,
    system: Mutex<sysinfo::System>,
}

impl StatusSource {
    pub fn new(
        connection: Arc<Mutex<Connection>>,
        sync: Option<Arc<EdgeSyncHandle>>,
        data_dir: Option<PathBuf>,
        database: PathBuf,
        started_at: DateTime<Utc>,
    ) -> Self {
        Self {
            connection,
            sync,
            data_dir,
            database,
            started_at,
            clock_skew: Mutex::new(None),
            last_answered: Mutex::new(None),
            system: Mutex::new(sysinfo::System::new()),
        }
    }

    /// Blocking: reads SQLite and the operating system. Call it from
    /// `spawn_blocking`.
    pub fn collect(&self) -> NodeStatus {
        let here = Machine::here();
        let env = |name: &str| std::env::var(name).unwrap_or_default();
        NodeStatus {
            taken_at: Utc::now(),
            site_id: env("INVENTORY_SITE_ID"),
            origin_id: env("INVENTORY_NODE_ID"),
            generation: env("INVENTORY_ORIGIN_GENERATION").parse().unwrap_or(1),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            started_at: self.started_at,
            hostname: here.hostname,
            os: format!("{} {}", here.os, here.arch),
            sync: self.sync_facts(),
            machine: self.machine_facts(),
            devices: self.device_facts(),
            till: self.till_facts(),
            incidents: self
                .data_dir
                .as_deref()
                .map(|dir| Journal::new(dir).recent(60))
                .unwrap_or_default(),
            device_list: self.device_list(),
            // What this build takes, so head office sends it nothing newer.
            capabilities: Some(vec![
                crate::sync::workflow::GOODS_ROUTES_CAPABILITY.to_owned(),
                crate::sync::flow::FLOWS_CAPABILITY.to_owned(),
            ]),
            link_outages: self.link_outages(),
        }
    }

    /// Write down an internet outage this process sat through: from the last
    /// answer before it to the first after, with what the shop wrote
    /// meanwhile. Blocking.
    pub fn record_link_outage(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database lock poisoned".to_owned())?;
        let stamp = |at: DateTime<Utc>| at.to_rfc3339_opts(SecondsFormat::Micros, true);
        let mut facts = 0_i64;
        let mut sales = 0_i64;
        {
            let mut statement = connection
                .prepare(
                    "SELECT event_type, count(*) FROM sync_fact_log
                      WHERE created_at >= ?1 AND created_at < ?2 GROUP BY event_type",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([stamp(from), stamp(to)], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                let (event_type, count) = row.map_err(|error| error.to_string())?;
                facts += count;
                if queue_kind(&event_type) == QUEUE_SALES {
                    sales += count;
                }
            }
        }
        connection
            .execute(
                "INSERT INTO edge_link_outage (from_at, to_at, facts_written, sales_written)
                 VALUES (?1, ?2, ?3, ?4) ON CONFLICT (from_at) DO NOTHING",
                rusqlite::params![stamp(from), stamp(to), facts, sales],
            )
            .map_err(|error| error.to_string())?;
        // A week is plenty; the heartbeat carries the last day.
        connection
            .execute(
                "DELETE FROM edge_link_outage WHERE to_at < ?1",
                [stamp(to - Duration::days(7))],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    /// The internet outages of the last day, oldest first.
    fn link_outages(&self) -> Option<Vec<LinkOutage>> {
        let connection = self.connection.lock().ok()?;
        let since = (Utc::now() - Duration::hours(24)).to_rfc3339_opts(SecondsFormat::Micros, true);
        let mut statement = connection
            .prepare(
                "SELECT from_at, to_at, facts_written, sales_written FROM edge_link_outage
                  WHERE to_at >= ?1 ORDER BY from_at",
            )
            .ok()?;
        let rows: Vec<(String, String, i64, i64)> = statement
            .query_map([since], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .ok()?
            .flatten()
            .collect();
        Some(
            rows.into_iter()
                .filter_map(|(from, to, facts_written, sales_written)| {
                    Some(LinkOutage {
                        from: parse_time(&from)?,
                        to: parse_time(&to)?,
                        facts_written,
                        sales_written,
                    })
                })
                .collect(),
        )
    }

    /// The unsent facts by kind, and when the newest acknowledged one was
    /// written ("data up to"). Both read the active stream only.
    fn queue(&self) -> (Option<Vec<QueuedFacts>>, Option<DateTime<Utc>>) {
        let Ok(connection) = self.connection.lock() else {
            return (None, None);
        };
        let mut by_kind: std::collections::BTreeMap<&'static str, (i64, Option<DateTime<Utc>>)> =
            [QUEUE_SALES, QUEUE_STOCK, QUEUE_ATTENDANCE, QUEUE_OTHER]
                .into_iter()
                .map(|kind| (kind, (0, None)))
                .collect();
        let pending = connection
            .prepare(
                "SELECT f.event_type, count(*), min(f.created_at)
                   FROM sync_fact_log f
                   JOIN sync_origin o ON o.origin_id = f.origin_id AND o.generation = f.generation
                   LEFT JOIN sync_watermark w
                     ON w.origin_id = f.origin_id AND w.generation = f.generation
                  WHERE f.seq > COALESCE(w.durable_seq, 0)
                  GROUP BY f.event_type",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()
            });
        let queue = match pending {
            Ok(rows) => {
                for (event_type, count, oldest) in rows {
                    let oldest = oldest.as_deref().and_then(parse_time);
                    if let Some(slot) = by_kind.get_mut(queue_kind(&event_type)) {
                        slot.0 += count;
                        slot.1 = match (slot.1, oldest) {
                            (Some(held), Some(new)) => Some(held.min(new)),
                            (held, new) => held.or(new),
                        };
                    }
                }
                Some(
                    by_kind
                        .into_iter()
                        .map(|(kind, (count, oldest_at))| QueuedFacts {
                            kind: kind.to_owned(),
                            count,
                            oldest_at,
                        })
                        .collect(),
                )
            }
            Err(error) => {
                tracing::debug!(%error, "outbox queue left out of the heartbeat");
                None
            }
        };
        let newest_acked_at = connection
            .query_row(
                "SELECT f.created_at
                   FROM sync_fact_log f
                   JOIN sync_origin o ON o.origin_id = f.origin_id AND o.generation = f.generation
                   JOIN sync_watermark w
                     ON w.origin_id = f.origin_id AND w.generation = f.generation
                  WHERE f.seq <= w.durable_seq
                  ORDER BY f.seq DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .as_deref()
            .and_then(parse_time);
        (queue, newest_acked_at)
    }

    /// Every device enrolled here, for head office's registry. `None` only
    /// when the node cannot read its own tables, which the cloud reads as
    /// "no report this minute" rather than "no devices".
    fn device_list(&self) -> Option<Vec<crate::sync::device::DeviceReport>> {
        let connection = self.connection.lock().ok()?;
        match crate::edge::devices::list_devices(&connection) {
            Ok(devices) => Some(devices),
            Err(error) => {
                tracing::warn!(%error, "devices left out of the heartbeat");
                None
            }
        }
    }

    fn sync_facts(&self) -> SyncFacts {
        let oldest_pending_at = self.connection.lock().ok().and_then(|connection| {
            connection
                .query_row(
                    "SELECT min(f.created_at)
                       FROM sync_fact_log f
                       LEFT JOIN sync_watermark w
                         ON w.origin_id = f.origin_id AND w.generation = f.generation
                      WHERE f.seq > COALESCE(w.durable_seq, 0)",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten()
                .and_then(|at| DateTime::parse_from_rfc3339(&at).ok())
                .map(|at| at.with_timezone(&Utc))
        });
        let (queue, newest_acked_at) = self.queue();
        let Some(status) = self.sync.as_ref().and_then(|sync| sync.status().ok()) else {
            return SyncFacts {
                enabled: false,
                oldest_pending_at,
                queue,
                newest_acked_at,
                ..SyncFacts::default()
            };
        };
        SyncFacts {
            enabled: status.sender_enabled,
            last_success_at: status.last_success_at,
            last_error: status.last_error,
            last_error_at: status.last_error_at,
            consecutive_failures: status.consecutive_failures,
            breaker_open_until: status.breaker_open_until,
            pending_facts: status.pending_facts,
            oldest_pending_at,
            dead_lettered: status.dead_lettered,
            queue,
            newest_acked_at,
        }
    }

    fn machine_facts(&self) -> MachineFacts {
        let mut facts = MachineFacts {
            database_bytes: Some(
                file_size(&self.database)
                    + file_size(&self.database.with_extension("sqlite3-wal")),
            ),
            machine_uptime_seconds: Some(sysinfo::System::uptime()),
            clock_skew_seconds: self.clock_skew.lock().ok().and_then(|skew| *skew),
            last_backup_at: self
                .data_dir
                .as_deref()
                .and_then(crate::edge::backup::latest)
                .map(|(_, at)| at),
            sync_pace: Some(crate::edge::pace::factor()),
            power: crate::edge::power::latest(),
            backup: self
                .connection
                .lock()
                .ok()
                .and_then(|connection| crate::edge::backup::last_run(&connection)),
            ..MachineFacts::default()
        };
        if let Ok(mut system) = self.system.lock() {
            system.refresh_memory();
            facts.memory_used_bytes = Some(system.used_memory());
            facts.memory_total_bytes = Some(system.total_memory());
        }
        // The disk the data lives on: the mount point that is the longest
        // prefix of the data directory.
        let place = self
            .data_dir
            .clone()
            .unwrap_or_else(|| self.database.clone());
        let place = std::fs::canonicalize(&place).unwrap_or(place);
        let disks = sysinfo::Disks::new_with_refreshed_list();
        if let Some(disk) = disks
            .list()
            .iter()
            .filter(|disk| place.starts_with(disk.mount_point()))
            .max_by_key(|disk| disk.mount_point().as_os_str().len())
        {
            facts.disk_free_bytes = Some(disk.available_space());
            facts.disk_total_bytes = Some(disk.total_space());
        }
        facts
    }

    fn device_facts(&self) -> DeviceFacts {
        let Ok(connection) = self.connection.lock() else {
            return DeviceFacts::default();
        };
        let recently = (Utc::now() - Duration::minutes(10)).to_rfc3339();
        let count = |sql: &str, bind: Option<&str>| -> i64 {
            let result = match bind {
                Some(value) => connection.query_row(sql, [value], |row| row.get(0)),
                None => connection.query_row(sql, [], |row| row.get(0)),
            };
            result.unwrap_or(0)
        };
        DeviceFacts {
            terminals_active: count("SELECT count(*) FROM edge_terminal WHERE active = 1", None),
            terminals_seen_recently: count(
                "SELECT count(*) FROM edge_terminal WHERE active = 1 AND last_seen_at >= ?1",
                Some(&recently),
            ),
            rfid_active: count("SELECT count(*) FROM edge_rfid_device WHERE active = 1", None),
            rfid_seen_recently: count(
                "SELECT count(*) FROM edge_rfid_device WHERE active = 1 AND last_seen_at >= ?1",
                Some(&recently),
            ),
        }
    }

    fn till_facts(&self) -> TillFacts {
        let Ok(connection) = self.connection.lock() else {
            return TillFacts::default();
        };
        let terminals: Vec<String> = connection
            .prepare(
                "SELECT COALESCE(t.label, s.terminal_id)
                   FROM cash_shift s
                   LEFT JOIN edge_terminal t ON t.terminal_id = s.terminal_id
                  WHERE s.status = 'OPEN'
                  ORDER BY 1",
            )
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .unwrap_or_default();
        TillFacts {
            open_shifts: terminals.len() as i64,
            open_shift_terminals: terminals,
        }
    }
}

fn parse_time(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}
