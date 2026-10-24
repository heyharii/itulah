//! What a store node says about itself, and the one sentence that says it.
//!
//! Shared by the node, which fills it in for its own console
//! (`localhost:8082/console`) and sends it up as its heartbeat, and by the
//! cloud, which keeps the latest one per node and shows it on the hub's Fleet
//! page. The judgement — green, amber or red, and the words — is [`assess`],
//! written once here, so a shop and head office never describe the same
//! machine differently.
//!
//! # The rule every sentence follows
//!
//! What happened, since when, what the machine is already doing about it, and
//! whether a person has to do anything (`STORE-SERVER-PLAN.md` §4). A colour
//! without a sentence is not a status.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

// ---- What happened, written down ------------------------------------------

/// One thing that happened to the node, as a screen will show it.
///
/// Every variant carries enough to answer the three questions a person at the
/// shop or at head office asks: what, when, and for how long.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Incident {
    /// The node started. `previous` is how the run before it ended.
    Started {
        at: DateTime<Utc>,
        version: String,
        previous: PreviousExit,
    },
    /// The node stopped because it was asked to.
    Stopped { at: DateTime<Utc>, reason: String },
    /// The node's own watchdog ended it: nothing proved it alive for
    /// `stalled_seconds`.
    Hung {
        at: DateTime<Utc>,
        stalled_seconds: i64,
    },
    /// Too many starts too close together; holding before the next attempt.
    CrashLoop {
        at: DateTime<Utc>,
        starts_in_window: usize,
        hold_seconds: i64,
    },
    /// Waiting for a person to enrol this machine.
    AwaitingEnrolment { at: DateTime<Utc> },
    /// Enrolled; about to start as a node.
    Enrolled { at: DateTime<Utc>, site_id: String },
    /// Mains power lost; the UPS carries the machine.
    OnBattery {
        at: DateTime<Utc>,
        charge_percent: Option<u8>,
    },
    /// Mains power back after `on_battery_seconds`.
    PowerRestored {
        at: DateTime<Utc>,
        on_battery_seconds: i64,
    },
}

impl Incident {
    pub fn at(&self) -> DateTime<Utc> {
        match self {
            Self::Started { at, .. }
            | Self::Stopped { at, .. }
            | Self::Hung { at, .. }
            | Self::CrashLoop { at, .. }
            | Self::AwaitingEnrolment { at }
            | Self::Enrolled { at, .. }
            | Self::OnBattery { at, .. }
            | Self::PowerRestored { at, .. } => *at,
        }
    }
}

/// How the run before this one ended.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "how", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreviousExit {
    /// Nothing before this: a fresh install.
    FirstStart,
    /// Stopped on request.
    Clean { at: DateTime<Utc> },
    /// Ended by its own watchdog.
    Hung { at: DateTime<Utc> },
    /// Vanished without saying anything. `last_seen` is its last proof of
    /// life, so "down for how long" is `started - last_seen`. `machine_restarted`
    /// is true when the machine booted after that — the power, or a reboot —
    /// and false when the process died on a machine that kept running: a
    /// crash. `None` where the platform cannot tell.
    Unclean {
        last_seen: DateTime<Utc>,
        machine_restarted: Option<bool>,
    },
}

// ---- The snapshot --------------------------------------------------------------

/// Everything the console and the Fleet page show about one node.
///
/// Numbers are raw and `None` when unknown, so a screen shows "—" rather than
/// an invented zero (the lesson `retail/internal/cloud/storemonitor` wrote
/// down after its sibling computed a health score from missing values).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeStatus {
    pub taken_at: DateTime<Utc>,
    pub site_id: String,
    pub origin_id: String,
    pub generation: i64,
    pub version: String,
    pub started_at: DateTime<Utc>,
    pub hostname: String,
    pub os: String,
    pub sync: SyncFacts,
    pub machine: MachineFacts,
    pub devices: DeviceFacts,
    pub till: TillFacts,
    /// Newest last.
    pub incidents: Vec<Incident>,
    /// Every device enrolled to this node — tills, printers, readers — with
    /// its status and when it was last heard from. Head office's device
    /// registry is fed from this (`cloud/postgres/devices.rs`).
    ///
    /// `None` from a node that predates the registry, which is how the cloud
    /// tells "this node reports no devices" (`Some(vec![])`) from "this node
    /// cannot report them, nor take a device command" — skipped when absent so
    /// the stored snapshot keeps that difference too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_list: Option<Vec<crate::sync::device::DeviceReport>>,
    /// The command families this build takes (`sync::workflow`), so head
    /// office sends a node only what it understands. `None` from a node that
    /// predates the list, which head office reads as "the families every
    /// build has always taken, and nothing newer".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    /// Spells in the last day when head office could not be reached while
    /// this server kept running — the internet, not the machine. A machine
    /// that was switched off says so with `Started` instead. `None` from a
    /// node that predates the report (fleet status, 28 Sep 2026).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_outages: Option<Vec<LinkOutage>>,
    /// What came of the store actions head office asked for lately
    /// (`sync::node_ops::ActionReport`), unfinished ones and those finished
    /// in the last two hours. `None` from a node that predates remote
    /// actions (28 Sep 2026).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_results: Option<Vec<crate::sync::node_ops::ActionReport>>,
    /// Where the shop's own screens answer on its network, by the stable name
    /// the server advertises (`http://{node}.local:8082`,
    /// `edge/discovery.rs`): what the hub shows, and draws as a QR, once the
    /// server is ready. `None` from a server that predates it, or one that
    /// listens on this machine only or does not advertise itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_address: Option<String>,
    /// Who signed in at the store's POS in the last two days, newest first:
    /// head office's view of each person's activity (24 Oct 2026). `None`
    /// from a server that predates it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sign_ins: Option<Vec<SignInFact>>,
}

/// One sign-in at the store's POS.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignInFact {
    pub username: String,
    pub at: DateTime<Utc>,
    /// `PASSWORD`, `FINGER`, `PIN` or `ON_BEHALF` (the store head opened
    /// the POS for them).
    pub method: String,
    /// The POS seat it happened at (`KASIR-1`), when the POS said.
    #[serde(default)]
    pub terminal: Option<String>,
    /// For `ON_BEHALF`, the store head who opened it.
    #[serde(default)]
    pub by: Option<String>,
}

/// One spell without head office while the server stayed up.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkOutage {
    /// The last answer before the silence.
    pub from: DateTime<Utc>,
    /// The first answer after it.
    pub to: DateTime<Utc>,
    /// Facts written here meanwhile, and how many of them were sales: the
    /// answer to "did the shop keep selling".
    pub facts_written: i64,
    pub sales_written: i64,
}

/// The kinds the outbox is broken down by on the fleet page.
pub const QUEUE_SALES: &str = "SALES";
pub const QUEUE_STOCK: &str = "STOCK";
pub const QUEUE_ATTENDANCE: &str = "ATTENDANCE";
pub const QUEUE_OTHER: &str = "OTHER";

/// Which of the four a fact belongs to, by its event type. One spelling, so a
/// node's queue and head office's reading of it never disagree.
pub fn queue_kind(event_type: &str) -> &'static str {
    if event_type.starts_with("sales.")
        || event_type.starts_with("checkout.")
        || event_type.starts_with("till.")
    {
        QUEUE_SALES
    } else if event_type.starts_with("inventory.")
        || event_type.starts_with("goods_receipt.")
        || event_type.starts_with("tagging.")
    {
        QUEUE_STOCK
    } else if event_type.starts_with("attendance.") {
        QUEUE_ATTENDANCE
    } else {
        QUEUE_OTHER
    }
}

/// Unsent facts of one kind.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueuedFacts {
    /// `SALES`, `STOCK`, `ATTENDANCE` or `OTHER` ([`queue_kind`]).
    pub kind: String,
    pub count: i64,
    /// When the oldest of them was written.
    pub oldest_at: Option<DateTime<Utc>>,
}

/// The daily backup, as the node last tried it (`edge/backup.rs`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackupFacts {
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub last_ok_at: Option<DateTime<Utc>>,
    /// Set when the last attempt failed.
    pub last_error: Option<String>,
    pub last_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncFacts {
    /// A cloud address is configured.
    pub enabled: bool,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
    pub consecutive_failures: u32,
    pub breaker_open_until: Option<DateTime<Utc>>,
    pub pending_facts: i64,
    pub oldest_pending_at: Option<DateTime<Utc>>,
    pub dead_lettered: i64,
    /// The unsent facts by kind. `None` from a node that predates it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue: Option<Vec<QueuedFacts>>,
    /// When the newest fact head office has acknowledged was written: "data
    /// up to".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub newest_acked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct MachineFacts {
    pub disk_free_bytes: Option<u64>,
    pub disk_total_bytes: Option<u64>,
    pub memory_used_bytes: Option<u64>,
    pub memory_total_bytes: Option<u64>,
    pub database_bytes: Option<u64>,
    pub machine_uptime_seconds: Option<u64>,
    /// Seconds this machine's clock is ahead of the cloud's, from the last
    /// heartbeat answer. Terminal signatures are refused past a skew.
    pub clock_skew_seconds: Option<i64>,
    /// When the newest local backup was taken.
    #[serde(default)]
    pub last_backup_at: Option<DateTime<Utc>>,
    /// How far background sync is stretched to spare a busy machine
    /// (`edge/pace.rs`): 1 is full speed.
    #[serde(default)]
    pub sync_pace: Option<u32>,
    /// The UPS, when there is one to read (`edge/power.rs`).
    #[serde(default)]
    pub power: Option<PowerFacts>,
    /// The last backup attempt and how it went. `last_backup_at` above is
    /// the newest file on disk; this says whether the last try failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup: Option<BackupFacts>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PowerSource {
    Mains,
    Battery,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PowerFacts {
    pub source: PowerSource,
    pub charge_percent: Option<u8>,
    pub runtime_seconds: Option<i64>,
    /// The UPS itself says the battery is low.
    pub low: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceFacts {
    pub terminals_active: i64,
    /// Terminals that signed a request in the last ten minutes.
    pub terminals_seen_recently: i64,
    pub rfid_active: i64,
    pub rfid_seen_recently: i64,
    /// Tills waiting to join (`edge_device_join`), which head office's store
    /// page shows and decides. Absent
    /// from a node that predates it, read as none.
    #[serde(default)]
    pub terminals_waiting: i64,
    /// The same tills, one by one, for head office to approve or refuse
    /// (`sync::device::COMMAND_DEVICE_JOIN_DECIDE`). Absent from a node that
    /// predates it.
    #[serde(default)]
    pub joins_waiting: Vec<crate::sync::device::WaitingJoin>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TillFacts {
    /// Drawers open right now — the answer to "is it safe to restart".
    pub open_shifts: i64,
    pub open_shift_terminals: Vec<String>,
}

// ---- The judgement ---------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Tone {
    Ok,
    Info,
    Warn,
    Bad,
}

/// Who has to act.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Needs {
    Nobody,
    /// Somebody at the shop or IT: a router, a disk, a clock.
    Shop,
    /// Head office: an approval, a decision.
    HeadOffice,
    Developer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Assessment {
    pub tone: Tone,
    /// Stable, for filters and alerts: `OK`, `OFFLINE`, `SYNC_BEHIND`, …
    pub code: String,
    /// The pill: a few words.
    pub label: String,
    /// The headline: one line.
    pub headline: String,
    /// What is happening, what the machine is doing, what a person should do.
    pub sentence: String,
    /// When the condition began, where known.
    pub since: Option<DateTime<Utc>>,
    pub needs: Needs,
}

fn assessment(
    tone: Tone,
    code: &str,
    label: &str,
    headline: String,
    sentence: String,
    since: Option<DateTime<Utc>>,
    needs: Needs,
) -> Assessment {
    Assessment {
        tone,
        code: code.to_owned(),
        label: label.to_owned(),
        headline,
        sentence,
        since,
        needs,
    }
}

/// "1 h 50 min", "4 min", "12 s", "2 days 3 h".
pub fn span(duration: Duration) -> String {
    let seconds = duration.num_seconds().max(0);
    let (days, hours, minutes) = (
        seconds / 86_400,
        seconds % 86_400 / 3_600,
        seconds % 3_600 / 60,
    );
    match (days, hours, minutes) {
        (0, 0, 0) => format!("{seconds} s"),
        (0, 0, m) => format!("{m} min"),
        (0, h, 0) => format!("{h} h"),
        (0, h, m) => format!("{h} h {m} min"),
        (1, 0, _) => "1 day".to_owned(),
        (1, h, _) => format!("1 day {h} h"),
        (d, 0, _) => format!("{d} days"),
        (d, h, _) => format!("{d} days {h} h"),
    }
}

/// Recovered disturbances in the last day: hangs and unclean exits the node
/// came back from by itself.
pub fn disturbances_today(incidents: &[Incident], now: DateTime<Utc>) -> usize {
    let since = now - Duration::hours(24);
    incidents
        .iter()
        .filter(|incident| incident.at() > since)
        .filter(|incident| {
            matches!(
                incident,
                Incident::Hung { .. }
                    | Incident::Started {
                        previous: PreviousExit::Unclean { .. },
                        ..
                    }
            )
        })
        .count()
}

/// How far a node may fall silent before it counts as out of reach: several
/// sync intervals, and long enough that one slow cycle is not an outage.
pub const SILENT_AFTER_SECONDS: i64 = 120;

/// The node's own view of itself, worst condition first.
pub fn assess(status: &NodeStatus, now: DateTime<Utc>) -> Assessment {
    let sync = &status.sync;
    let machine = &status.machine;

    if sync.dead_lettered > 0 {
        return assessment(
            Tone::Bad,
            "REJECTED_FACTS",
            "Records refused",
            format!("Head office refused {} records", sync.dead_lettered),
            "They are held on this server and will not be lost. Sales carry on. A developer needs to look at them.".into(),
            None,
            Needs::Developer,
        );
    }
    if sync
        .last_error
        .as_deref()
        .is_some_and(|error| error.contains("403") || error.contains("x-sync-key"))
    {
        return assessment(
            Tone::Bad,
            "KEY_REFUSED",
            "Key refused",
            "Head office refuses this machine".into(),
            "This machine was replaced or revoked at head office, so its records are no longer accepted. If that is a mistake, enrol it again from the hub.".into(),
            sync.last_error_at,
            Needs::HeadOffice,
        );
    }
    if let (Some(free), Some(total)) = (machine.disk_free_bytes, machine.disk_total_bytes) {
        let percent = if total > 0 { free * 100 / total } else { 100 };
        let gigabytes = free as f64 / 1_073_741_824.0;
        if percent < 5 {
            return assessment(
                Tone::Bad,
                "DISK_CRITICAL",
                "Disk almost full",
                format!("Only {gigabytes:.1} GB free on disk ({percent} %)"),
                "Old logs and backups were already cleared automatically. If the disk fills up, the server stops saving sales. Free up or replace the disk now.".into(),
                None,
                Needs::Shop,
            );
        }
        if percent < 10 {
            return assessment(
                Tone::Warn,
                "DISK_LOW",
                "Disk getting full",
                format!("Only {gigabytes:.1} GB free on disk ({percent} %)"),
                "The server is still running normally. Plan to free up or replace the disk.".into(),
                None,
                Needs::Shop,
            );
        }
    }
    if let Some(power) = machine
        .power
        .as_ref()
        .filter(|p| p.source == PowerSource::Battery)
    {
        let left = power
            .runtime_seconds
            .map(|seconds| format!(", about {} left", span(Duration::seconds(seconds))))
            .unwrap_or_default();
        let charge = power
            .charge_percent
            .map(|c| format!(" (battery {c} %)"))
            .unwrap_or_default();
        return if power.low {
            assessment(
                Tone::Bad,
                "UPS_LOW",
                "UPS battery low",
                format!("UPS battery almost empty{charge}"),
                "Finish the sales in progress. The server will sync one last time, shut down cleanly, and start again by itself when the power is back.".into(),
                None,
                Needs::Shop,
            )
        } else {
            assessment(
                Tone::Warn,
                "ON_BATTERY",
                "On UPS",
                format!("Power cut — running on the UPS{left}"),
                format!("Everything keeps running{charge}. Waiting records were sent to head office and backups wait until the power is back."),
                None,
                Needs::Nobody,
            )
        };
    }
    if let Some(skew) = machine.clock_skew_seconds.filter(|skew| skew.abs() > 30) {
        return assessment(
            Tone::Bad,
            "CLOCK_SKEW",
            "Clock off",
            format!("This computer's clock is {} off from head office", span(Duration::seconds(skew.abs()))),
            "Tills may be refused because the clocks do not match. Turn on automatic time sync on this computer.".into(),
            None,
            Needs::Shop,
        );
    }
    if !sync.enabled {
        return assessment(
            Tone::Info,
            "NOT_CONNECTED",
            "Not connected",
            "Server not connected to head office yet".into(),
            "Sales are kept on this server. Enrol this machine from the hub so its records are sent.".into(),
            None,
            Needs::HeadOffice,
        );
    }
    let silent_since = sync.last_success_at.unwrap_or(status.started_at);
    if sync.consecutive_failures >= 3
        && now - silent_since > Duration::seconds(SILENT_AFTER_SECONDS)
    {
        return assessment(
            Tone::Warn,
            "OFFLINE",
            "Internet down",
            format!(
                "Head office unreachable since {}",
                silent_since.with_timezone(&chrono::Local).format("%H:%M")
            ),
            format!(
                "Tills can keep selling. {} records are kept here and go out by themselves once the internet is back. Check the router if this lasts over 30 minutes.",
                sync.pending_facts
            ),
            Some(silent_since),
            if now - silent_since > Duration::minutes(30) { Needs::Shop } else { Needs::Nobody },
        );
    }
    if let Some(oldest) = sync
        .oldest_pending_at
        .filter(|oldest| now - *oldest > Duration::minutes(30))
    {
        return assessment(
            Tone::Warn,
            "SYNC_BEHIND",
            "Sync behind",
            format!(
                "{} records not sent yet, oldest {}",
                sync.pending_facts,
                span(now - oldest)
            ),
            "The server keeps trying to send them. If the number keeps growing, tell head office."
                .into(),
            Some(oldest),
            Needs::Nobody,
        );
    }
    let disturbances = disturbances_today(&status.incidents, now);
    if disturbances > 3 {
        // Recovering every time is not the same as being well: a machine
        // that falls over four times a day has a cause somebody must find.
        return assessment(
            Tone::Warn,
            "UNSTABLE",
            "Often disrupted",
            format!("Server disrupted {disturbances} times in 24 hours"),
            "It recovered by itself each time and sales carried on, but this often has a cause. A developer needs to read its diagnosis report.".into(),
            None,
            Needs::Developer,
        );
    }
    if disturbances > 0 {
        return assessment(
            Tone::Ok,
            "RECOVERED",
            "Healthy · recovered",
            format!("Server running — disrupted {disturbances} {} in 24 hours", if disturbances == 1 { "time" } else { "times" }),
            "Everything recovered automatically. Head office sees the same record. If it happens more than 3 times a day, a developer is brought in.".into(),
            None,
            Needs::Nobody,
        );
    }
    assessment(
        Tone::Ok,
        "OK",
        "Healthy",
        "Server running normally".into(),
        "All sales have reached head office. Nothing to do.".into(),
        None,
        Needs::Nobody,
    )
}

/// Head office's view: the node's own assessment, unless the node itself has
/// gone quiet — then the silence is the news.
pub fn assess_from_afar(
    status: Option<&NodeStatus>,
    last_heard: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Assessment {
    let Some(heard) = last_heard else {
        return assessment(
            Tone::Info,
            "NEVER_SEEN",
            "Never seen",
            "This server has never reported in".into(),
            "Enrolled, but not switched on or not connected yet. Make sure the server is on and online.".into(),
            None,
            Needs::Shop,
        );
    };
    if now - heard > Duration::seconds(SILENT_AFTER_SECONDS) {
        return assessment(
            Tone::Warn,
            "SILENT",
            "Silent",
            format!(
                "No word since {} ({})",
                heard.with_timezone(&chrono::Local).format("%H:%M"),
                span(now - heard)
            ),
            "The store's internet is down, there is a power cut, or the server is off. The store can keep selling while the server is on; records go out once it reconnects.".into(),
            Some(heard),
            if now - heard > Duration::minutes(10) { Needs::Shop } else { Needs::Nobody },
        );
    }
    match status {
        Some(status) => assess(status, now),
        None => assessment(
            Tone::Info,
            "UNKNOWN",
            "Unknown",
            "Server reported in without a status".into(),
            "This server's version is too old to report its condition. Update the server.".into(),
            None,
            Needs::HeadOffice,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap_or_default()
            + Duration::minutes(minutes)
    }

    fn healthy(now: DateTime<Utc>) -> NodeStatus {
        NodeStatus {
            taken_at: now,
            site_id: "store-07".into(),
            origin_id: "store-07".into(),
            generation: 1,
            version: "0.1.0".into(),
            started_at: now - Duration::hours(3),
            hostname: "toko07".into(),
            os: "linux".into(),
            sync: SyncFacts {
                enabled: true,
                last_success_at: Some(now - Duration::seconds(5)),
                ..SyncFacts::default()
            },
            machine: MachineFacts {
                disk_free_bytes: Some(60 << 30),
                disk_total_bytes: Some(100 << 30),
                ..MachineFacts::default()
            },
            devices: DeviceFacts::default(),
            till: TillFacts::default(),
            incidents: vec![],
            device_list: None,
            capabilities: None,
            link_outages: None,
            action_results: None,
            app_address: None,
            sign_ins: None,
        }
    }

    #[test]
    fn facts_fall_into_the_four_queues() {
        assert_eq!(queue_kind("sales.completed"), QUEUE_SALES);
        assert_eq!(queue_kind("till.shift.recorded"), QUEUE_SALES);
        assert_eq!(queue_kind("inventory.pick.v1"), QUEUE_STOCK);
        assert_eq!(queue_kind("attendance.punch.recorded"), QUEUE_ATTENDANCE);
        assert_eq!(queue_kind("store.expense.recorded"), QUEUE_OTHER);
    }

    #[test]
    fn a_healthy_node_says_so_and_needs_nobody() {
        let now = at(0);
        let verdict = assess(&healthy(now), now);
        assert_eq!(
            (verdict.tone, verdict.code.as_str(), verdict.needs),
            (Tone::Ok, "OK", Needs::Nobody)
        );
    }

    #[test]
    fn an_unreachable_cloud_is_offline_with_the_time_it_began() {
        let now = at(0);
        let mut status = healthy(now);
        status.sync.last_success_at = Some(now - Duration::minutes(110));
        status.sync.consecutive_failures = 40;
        status.sync.pending_facts = 37;
        let verdict = assess(&status, now);
        assert_eq!(verdict.code, "OFFLINE");
        assert_eq!(verdict.since, status.sync.last_success_at);
        assert!(verdict.sentence.contains("37 records"));
        assert_eq!(
            verdict.needs,
            Needs::Shop,
            "past 30 minutes somebody should look at the router"
        );
    }

    #[test]
    fn one_slow_cycle_is_not_an_outage() {
        let now = at(0);
        let mut status = healthy(now);
        status.sync.consecutive_failures = 1;
        status.sync.last_success_at = Some(now - Duration::seconds(40));
        assert_eq!(assess(&status, now).code, "OK");
    }

    #[test]
    fn rejected_facts_outrank_everything_and_need_a_developer() {
        let now = at(0);
        let mut status = healthy(now);
        status.sync.dead_lettered = 2;
        status.machine.disk_free_bytes = Some(1 << 30);
        let verdict = assess(&status, now);
        assert_eq!(
            (verdict.code.as_str(), verdict.needs),
            ("REJECTED_FACTS", Needs::Developer)
        );
    }

    #[test]
    fn a_refused_key_says_the_machine_was_replaced() {
        let now = at(0);
        let mut status = healthy(now);
        status.sync.last_error = Some("sync handshake returned 403 Forbidden".into());
        assert_eq!(assess(&status, now).code, "KEY_REFUSED");
    }

    #[test]
    fn disk_thresholds() {
        let now = at(0);
        let mut status = healthy(now);
        status.machine.disk_free_bytes = Some(8 << 30);
        assert_eq!(assess(&status, now).code, "DISK_LOW");
        status.machine.disk_free_bytes = Some(4 << 30);
        assert_eq!(assess(&status, now).code, "DISK_CRITICAL");
    }

    #[test]
    fn recovered_disturbances_stay_green_but_are_counted() {
        let now = at(0);
        let mut status = healthy(now);
        status.incidents = vec![
            Incident::Hung {
                at: now - Duration::hours(2),
                stalled_seconds: 125,
            },
            Incident::Started {
                at: now - Duration::hours(5),
                version: "0.1.0".into(),
                previous: PreviousExit::Unclean {
                    last_seen: now - Duration::hours(5),
                    machine_restarted: Some(false),
                },
            },
            Incident::Hung {
                at: now - Duration::hours(30),
                stalled_seconds: 125,
            },
        ];
        let verdict = assess(&status, now);
        assert_eq!(
            (verdict.tone, verdict.code.as_str()),
            (Tone::Ok, "RECOVERED")
        );
        assert!(verdict.headline.contains("2 times"), "{}", verdict.headline);

        // Four in a day is a cause to find, even though each one healed.
        for hours in 6..8 {
            status.incidents.push(Incident::Hung {
                at: now - Duration::hours(hours),
                stalled_seconds: 125,
            });
        }
        let verdict = assess(&status, now);
        assert_eq!(
            (verdict.tone, verdict.code.as_str(), verdict.needs),
            (Tone::Warn, "UNSTABLE", Needs::Developer)
        );
    }

    #[test]
    fn from_afar_silence_is_the_news() {
        let now = at(0);
        let status = healthy(now);
        assert_eq!(
            assess_from_afar(Some(&status), Some(now - Duration::seconds(30)), now).code,
            "OK"
        );
        let silent = assess_from_afar(Some(&status), Some(now - Duration::minutes(15)), now);
        assert_eq!(
            (silent.code.as_str(), silent.needs),
            ("SILENT", Needs::Shop)
        );
        assert_eq!(assess_from_afar(None, None, now).code, "NEVER_SEEN");
    }

    #[test]
    fn spans_read_like_a_person_says_them() {
        assert_eq!(span(Duration::seconds(12)), "12 s");
        assert_eq!(span(Duration::minutes(4)), "4 min");
        assert_eq!(span(Duration::minutes(110)), "1 h 50 min");
        assert_eq!(span(Duration::hours(27)), "1 day 3 h");
        assert_eq!(span(Duration::hours(51)), "2 days 3 h");
    }
}
