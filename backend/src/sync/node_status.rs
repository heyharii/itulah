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
}

impl Incident {
    pub fn at(&self) -> DateTime<Utc> {
        match self {
            Self::Started { at, .. }
            | Self::Stopped { at, .. }
            | Self::Hung { at, .. }
            | Self::CrashLoop { at, .. }
            | Self::AwaitingEnrolment { at }
            | Self::Enrolled { at, .. } => *at,
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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceFacts {
    pub terminals_active: i64,
    /// Terminals that signed a request in the last ten minutes.
    pub terminals_seen_recently: i64,
    pub rfid_active: i64,
    pub rfid_seen_recently: i64,
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

/// "1 jam 50 menit", "4 menit", "12 detik".
pub fn span(duration: Duration) -> String {
    let seconds = duration.num_seconds().max(0);
    let (days, hours, minutes) = (seconds / 86_400, seconds % 86_400 / 3_600, seconds % 3_600 / 60);
    match (days, hours, minutes) {
        (0, 0, 0) => format!("{seconds} detik"),
        (0, 0, m) => format!("{m} menit"),
        (0, h, 0) => format!("{h} jam"),
        (0, h, m) => format!("{h} jam {m} menit"),
        (d, 0, _) => format!("{d} hari"),
        (d, h, _) => format!("{d} hari {h} jam"),
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
            "Ada data ditolak",
            format!("{} catatan ditolak kantor pusat", sync.dead_lettered),
            "Catatan itu tertahan di server ini dan tidak akan hilang. Penjualan tetap jalan. Developer perlu memeriksanya.".into(),
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
            "Kunci ditolak",
            "Kantor pusat menolak mesin ini".into(),
            "Mesin ini sudah diganti atau dicabut dari kantor pusat, jadi datanya tidak lagi diterima. Kalau ini keliru, daftarkan ulang dari hub.".into(),
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
                "Disk hampir penuh",
                format!("Disk tinggal {gigabytes:.1} GB ({percent} %)"),
                "Log dan backup lama sudah dibersihkan otomatis. Kalau disk penuh, server berhenti menyimpan transaksi. Kosongkan atau ganti disk sekarang.".into(),
                None,
                Needs::Shop,
            );
        }
        if percent < 10 {
            return assessment(
                Tone::Warn,
                "DISK_LOW",
                "Disk menipis",
                format!("Disk tinggal {gigabytes:.1} GB ({percent} %)"),
                "Server masih berjalan normal. Rencanakan pembersihan atau penggantian disk.".into(),
                None,
                Needs::Shop,
            );
        }
    }
    if let Some(skew) = machine.clock_skew_seconds.filter(|skew| skew.abs() > 30) {
        return assessment(
            Tone::Bad,
            "CLOCK_SKEW",
            "Jam bergeser",
            format!("Jam komputer selisih {} dari kantor pusat", span(Duration::seconds(skew.abs()))),
            "Kasir bisa ditolak karena jamnya tidak cocok. Nyalakan sinkron jam otomatis di komputer ini.".into(),
            None,
            Needs::Shop,
        );
    }
    if !sync.enabled {
        return assessment(
            Tone::Info,
            "NOT_CONNECTED",
            "Belum terhubung",
            "Server belum terhubung ke kantor pusat".into(),
            "Penjualan tersimpan di server ini. Daftarkan mesin ini dari hub supaya datanya terkirim.".into(),
            None,
            Needs::HeadOffice,
        );
    }
    let silent_since = sync.last_success_at.unwrap_or(status.started_at);
    if sync.consecutive_failures >= 3 && now - silent_since > Duration::seconds(SILENT_AFTER_SECONDS) {
        return assessment(
            Tone::Warn,
            "OFFLINE",
            "Internet putus",
            format!(
                "Kantor pusat tidak terjangkau sejak {}",
                silent_since.with_timezone(&chrono::Local).format("%H:%M")
            ),
            format!(
                "Kasir tetap bisa berjualan. {} catatan disimpan di sini dan terkirim sendiri begitu internet kembali. Cek router kalau ini lebih dari 30 menit.",
                sync.pending_facts
            ),
            Some(silent_since),
            if now - silent_since > Duration::minutes(30) { Needs::Shop } else { Needs::Nobody },
        );
    }
    if let Some(oldest) = sync.oldest_pending_at.filter(|oldest| now - *oldest > Duration::minutes(30)) {
        return assessment(
            Tone::Warn,
            "SYNC_BEHIND",
            "Sinkron tertinggal",
            format!("{} catatan belum terkirim, tertua {}", sync.pending_facts, span(now - oldest)),
            "Server terus mencoba mengirim. Kalau angkanya terus bertambah, kabari kantor pusat.".into(),
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
            "Sering terganggu",
            format!("Server {disturbances} kali terganggu dalam 24 jam"),
            "Setiap kali pulih sendiri dan penjualan tetap jalan, tetapi sesering ini ada penyebabnya. Developer perlu melihat laporan diagnosanya.".into(),
            None,
            Needs::Developer,
        );
    }
    if disturbances > 0 {
        return assessment(
            Tone::Ok,
            "RECOVERED",
            "Sehat · pulih sendiri",
            format!("Server berjalan — sempat {disturbances} kali terganggu dalam 24 jam"),
            "Semuanya sudah pulih otomatis. Kantor pusat melihat catatan yang sama. Kalau terjadi lebih dari 3 kali sehari, developer akan dilibatkan.".into(),
            None,
            Needs::Nobody,
        );
    }
    assessment(
        Tone::Ok,
        "OK",
        "Sehat",
        "Server berjalan normal".into(),
        "Semua transaksi sudah sampai ke kantor pusat. Tidak ada yang perlu dilakukan.".into(),
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
            "Belum pernah terlihat",
            "Server ini belum pernah mengirim kabar".into(),
            "Terdaftar, tetapi belum menyala atau belum terhubung. Pastikan servernya menyala dan tersambung internet.".into(),
            None,
            Needs::Shop,
        );
    };
    if now - heard > Duration::seconds(SILENT_AFTER_SECONDS) {
        return assessment(
            Tone::Warn,
            "SILENT",
            "Tidak terlihat",
            format!(
                "Tidak ada kabar sejak {} ({})",
                heard.with_timezone(&chrono::Local).format("%H:%M"),
                span(now - heard)
            ),
            "Internet toko putus, listrik padam, atau servernya mati. Toko tetap bisa berjualan kalau server menyala; data terkirim saat tersambung lagi.".into(),
            Some(heard),
            if now - heard > Duration::minutes(10) { Needs::Shop } else { Needs::Nobody },
        );
    }
    match status {
        Some(status) => assess(status, now),
        None => assessment(
            Tone::Info,
            "UNKNOWN",
            "Tidak diketahui",
            "Server mengirim kabar tanpa status".into(),
            "Versi server ini terlalu lama untuk melaporkan kondisinya. Perbarui servernya.".into(),
            None,
            Needs::HeadOffice,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap_or_default() + Duration::minutes(minutes)
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
        }
    }

    #[test]
    fn a_healthy_node_says_so_and_needs_nobody() {
        let now = at(0);
        let verdict = assess(&healthy(now), now);
        assert_eq!((verdict.tone, verdict.code.as_str(), verdict.needs), (Tone::Ok, "OK", Needs::Nobody));
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
        assert!(verdict.sentence.contains("37 catatan"));
        assert_eq!(verdict.needs, Needs::Shop, "past 30 minutes somebody should look at the router");
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
        assert_eq!((verdict.code.as_str(), verdict.needs), ("REJECTED_FACTS", Needs::Developer));
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
            Incident::Hung { at: now - Duration::hours(2), stalled_seconds: 125 },
            Incident::Started {
                at: now - Duration::hours(5),
                version: "0.1.0".into(),
                previous: PreviousExit::Unclean { last_seen: now - Duration::hours(5), machine_restarted: Some(false) },
            },
            Incident::Hung { at: now - Duration::hours(30), stalled_seconds: 125 },
        ];
        let verdict = assess(&status, now);
        assert_eq!((verdict.tone, verdict.code.as_str()), (Tone::Ok, "RECOVERED"));
        assert!(verdict.headline.contains("2 kali"), "{}", verdict.headline);

        // Four in a day is a cause to find, even though each one healed.
        for hours in 6..8 {
            status.incidents.push(Incident::Hung { at: now - Duration::hours(hours), stalled_seconds: 125 });
        }
        let verdict = assess(&status, now);
        assert_eq!((verdict.tone, verdict.code.as_str(), verdict.needs), (Tone::Warn, "UNSTABLE", Needs::Developer));
    }

    #[test]
    fn from_afar_silence_is_the_news() {
        let now = at(0);
        let status = healthy(now);
        assert_eq!(assess_from_afar(Some(&status), Some(now - Duration::seconds(30)), now).code, "OK");
        let silent = assess_from_afar(Some(&status), Some(now - Duration::minutes(15)), now);
        assert_eq!((silent.code.as_str(), silent.needs), ("SILENT", Needs::Shop));
        assert_eq!(assess_from_afar(None, None, now).code, "NEVER_SEEN");
    }

    #[test]
    fn spans_read_like_a_person_says_them() {
        assert_eq!(span(Duration::seconds(12)), "12 detik");
        assert_eq!(span(Duration::minutes(4)), "4 menit");
        assert_eq!(span(Duration::minutes(110)), "1 jam 50 menit");
        assert_eq!(span(Duration::hours(27)), "1 hari 3 jam");
    }
}
