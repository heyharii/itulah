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
use crate::sync::node_status::{DeviceFacts, MachineFacts, NodeStatus, SyncFacts, TillFacts};
use chrono::{DateTime, Duration, Utc};
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
        }
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
        let Some(status) = self.sync.as_ref().and_then(|sync| sync.status().ok()) else {
            return SyncFacts {
                enabled: false,
                oldest_pending_at,
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

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}
