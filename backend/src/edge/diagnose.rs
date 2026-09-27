//! `store diagnose`: everything a person needs to know about this node, in one
//! report, without logging in anywhere.
//!
//! The first question on every support call is the same list — is it running,
//! can it reach head office, is its key still accepted, is the database whole,
//! how far behind is it, what happened to it lately — and each answer used to
//! take a different command. This asks them all, prints a verdict a shop can
//! read out over the phone, and writes the whole thing (secrets removed) to a
//! file a developer can open.
//!
//! Read-only against the node: it opens the database for reading, asks the
//! cloud questions that change nothing, and touches no configuration. Safe to
//! run while the node is serving.

use crate::edge::{enrolment, node};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    pub name: &'static str,
    pub verdict: Verdict,
    /// One sentence a person at the shop can read aloud.
    pub saying: String,
}

fn check(name: &'static str, verdict: Verdict, saying: impl Into<String>) -> Check {
    Check {
        name,
        verdict,
        saying: saying.into(),
    }
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub taken_at: DateTime<Utc>,
    pub version: &'static str,
    pub platform: String,
    pub data_dir: Option<PathBuf>,
    pub verdict: Verdict,
    pub checks: Vec<Check>,
    /// Everything else, for a developer: configuration with the key removed,
    /// recent incidents, the tail of today's log.
    pub detail: Value,
}

/// `node.env` with anything secret replaced, so the report can be emailed.
fn redacted_env(dir: &Path) -> Value {
    let Ok(text) = std::fs::read_to_string(dir.join(enrolment::NODE_ENV_FILE)) else {
        return Value::Null;
    };
    let lines: Vec<String> = text
        .lines()
        .filter(|line| !line.trim_start().starts_with('#') && line.contains('='))
        .map(|line| {
            let (key, value) = line.split_once('=').unwrap_or((line, ""));
            let secret = ["KEY", "PASSWORD", "SECRET", "TOKEN"]
                .iter()
                .any(|word| key.to_ascii_uppercase().contains(word));
            if secret {
                format!("{key}=<{} characters, removed>", value.len())
            } else {
                line.to_owned()
            }
        })
        .collect();
    json!(lines)
}

fn log_tail(dir: &Path, lines: usize) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir.join("logs")) else {
        return Vec::new();
    };
    let newest = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("store"))
        .max_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    let Some(newest) = newest else {
        return Vec::new();
    };
    let text = std::fs::read_to_string(newest.path()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..]
        .iter()
        .map(|line| (*line).to_owned())
        .collect()
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

/// The database: whole, how big, how much is waiting to go up.
fn database_checks(path: &Path, checks: &mut Vec<Check>, detail: &mut Value) {
    if !path.exists() {
        checks.push(check(
            "database",
            Verdict::Warn,
            "No database yet — this node has never run as a store.",
        ));
        return;
    }
    let size = file_size(path);
    let wal = file_size(&path.with_extension("sqlite3-wal"));
    detail["database"] = json!({ "path": path, "bytes": size, "wal_bytes": wal });
    let connection = match rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(connection) => connection,
        Err(error) => {
            checks.push(check(
                "database",
                Verdict::Fail,
                format!("Cannot open the database: {error}"),
            ));
            return;
        }
    };
    let _ = connection.busy_timeout(Duration::from_secs(5));
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .unwrap_or_else(|error| error.to_string());
    checks.push(if integrity == "ok" {
        check(
            "database",
            Verdict::Ok,
            format!("Database intact ({}).", megabytes(size + wal)),
        )
    } else {
        check(
            "database",
            Verdict::Fail,
            format!("Database damaged: {integrity}"),
        )
    });

    let pending: Option<(i64, Option<String>)> = connection
        .query_row(
            "SELECT count(*), min(f.created_at)
               FROM sync_fact_log f
               LEFT JOIN sync_watermark w
                 ON w.origin_id = f.origin_id AND w.generation = f.generation
              WHERE f.seq > COALESCE(w.durable_seq, 0)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let dead: i64 = connection
        .query_row("SELECT count(*) FROM sync_dead_letter", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);
    if let Some((count, oldest)) = pending {
        detail["outbox"] = json!({ "pending": count, "oldest": oldest, "dead_letters": dead });
        let age_minutes = oldest
            .as_deref()
            .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
            .map(|at| (Utc::now() - at.with_timezone(&Utc)).num_minutes());
        checks.push(match (count, age_minutes) {
            (0, _) => check("outbox", Verdict::Ok, "All sales have reached head office."),
            (count, Some(minutes)) if minutes >= 30 => check(
                "outbox",
                Verdict::Warn,
                format!("{count} records waiting to send; the oldest {minutes} min."),
            ),
            (count, _) => check(
                "outbox",
                Verdict::Ok,
                format!("{count} records in the send queue."),
            ),
        });
    }
    if dead > 0 {
        checks.push(check(
            "dead_letters",
            Verdict::Fail,
            format!("{dead} records refused and held — needs a developer."),
        ));
    }
}

/// The cloud: reachable, how fast, whether the clocks agree, whether it still
/// accepts this node's key.
async fn cloud_checks(checks: &mut Vec<Check>, detail: &mut Value) {
    let Some(url) = std::env::var("SYNC_UPLOAD_URL")
        .ok()
        .filter(|url| !url.is_empty())
    else {
        checks.push(check(
            "cloud",
            Verdict::Warn,
            "No head office address yet — this node is not enrolled.",
        ));
        return;
    };
    let base = url
        .trim_end_matches('/')
        .trim_end_matches("/api/v1/sync/ingest")
        .to_owned();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            checks.push(check("cloud", Verdict::Fail, error.to_string()));
            return;
        }
    };
    let started = Instant::now();
    let response = client.get(format!("{base}/api/v1/health")).send().await;
    let elapsed = started.elapsed().as_millis();
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            checks.push(check(
                "cloud",
                Verdict::Fail,
                format!("Cannot reach head office — check the store's internet. ({error})"),
            ));
            return;
        }
    };
    let skew = response
        .headers()
        .get(reqwest::header::DATE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| DateTime::parse_from_rfc2822(value).ok())
        .map(|cloud| (Utc::now() - cloud.with_timezone(&Utc)).num_seconds());
    detail["cloud"] = json!({ "base": base, "status": response.status().as_u16(), "latency_ms": elapsed, "clock_skew_seconds": skew });
    checks.push(check(
        "cloud",
        if response.status().is_success() {
            if elapsed > 3_000 {
                Verdict::Warn
            } else {
                Verdict::Ok
            }
        } else {
            Verdict::Fail
        },
        format!(
            "Head office answered {} in {elapsed} ms.",
            response.status()
        ),
    ));
    if let Some(skew) = skew {
        checks.push(if skew.abs() > 30 {
            check(
                "clock",
                Verdict::Fail,
                format!("This computer's clock is {skew} s off from head office — tills may be refused. Turn on automatic time."),
            )
        } else {
            check("clock", Verdict::Ok, format!("Clock matches ({skew} s off)."))
        });
    }

    // The key. An upload with nothing in it asks exactly one question — does
    // the cloud still accept this node — and changes nothing.
    if let (Ok(origin), Ok(key)) = (
        std::env::var("INVENTORY_NODE_ID"),
        std::env::var("SYNC_UPLOAD_KEY"),
    ) {
        let generation: i64 = std::env::var("INVENTORY_ORIGIN_GENERATION")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1);
        let answer = client
            .post(format!("{base}/api/v1/sync/ingest"))
            .header("x-sync-key", key)
            .json(&json!({ "origin_id": origin, "generation": generation, "facts": [] }))
            .send()
            .await;
        checks.push(match answer.map(|response| response.status()) {
            Ok(status) if status.is_success() => {
                check("key", Verdict::Ok, "Head office accepts this machine's key.")
            }
            Ok(status) if status == reqwest::StatusCode::FORBIDDEN => check(
                "key",
                Verdict::Fail,
                "Head office REFUSES this machine's key — it was replaced or revoked. Enrol it again from the hub.",
            ),
            Ok(status) => check("key", Verdict::Warn, format!("Key check answered {status}.")),
            Err(error) => check("key", Verdict::Warn, format!("Cannot check the key: {error}")),
        });
    }
}

/// Is the node itself answering on this machine?
async fn local_checks(checks: &mut Vec<Check>) {
    let port = std::env::var("BIND_ADDR")
        .ok()
        .and_then(|addr| addr.rsplit(':').next().map(str::to_owned))
        .unwrap_or_else(|| "8082".into());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok();
    let answered = match client {
        Some(client) => client
            .get(format!("http://127.0.0.1:{port}/api/v1/health"))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false),
        None => false,
    };
    checks.push(if answered {
        check("service", Verdict::Ok, format!("Store server running on port {port}."))
    } else {
        check(
            "service",
            Verdict::Fail,
            format!("Store server not answering on port {port} — the service is off, restarting, or still waiting for enrolment."),
        )
    });
}

/// The incidents of the last day, counted.
fn incident_checks(dir: &Path, checks: &mut Vec<Check>, detail: &mut Value) {
    let recent = node::Journal::new(dir).recent(200);
    let since = Utc::now() - chrono::Duration::hours(24);
    let mut hangs = 0;
    let mut unclean = 0;
    let mut loops = 0;
    for incident in &recent {
        match incident {
            node::Incident::Hung { at, .. } if *at > since => hangs += 1,
            node::Incident::CrashLoop { at, .. } if *at > since => loops += 1,
            node::Incident::Started {
                at,
                previous: node::PreviousExit::Unclean { .. },
                ..
            } if *at > since => unclean += 1,
            _ => {}
        }
    }
    detail["incidents"] =
        serde_json::to_value(&recent[recent.len().saturating_sub(50)..]).unwrap_or(Value::Null);
    checks.push(if loops > 0 {
        check(
            "stability",
            Verdict::Fail,
            format!("{loops} crash loops in 24 hours — needs a developer."),
        )
    } else if hangs + unclean > 0 {
        check(
            "stability",
            Verdict::Warn,
            format!("Last 24 hours: {hangs} hangs, {unclean} sudden stops (crash or power). All recovered on their own."),
        )
    } else {
        check("stability", Verdict::Ok, "No crashes or hangs in 24 hours.")
    });
}

/// Run every check. `data_dir` is the installed node's directory, if any.
pub async fn diagnose(data_dir: Option<&Path>) -> Report {
    let mut checks = Vec::new();
    let mut detail = json!({});
    match data_dir {
        Some(dir) => {
            detail["node_env"] = redacted_env(dir);
            checks.push(if enrolment::is_enrolled() {
                check(
                    "enrolment",
                    Verdict::Ok,
                    format!(
                        "Enrolled as {} (generation {}).",
                        std::env::var("INVENTORY_SITE_ID").unwrap_or_default(),
                        std::env::var("INVENTORY_ORIGIN_GENERATION").unwrap_or_else(|_| "1".into())
                    ),
                )
            } else {
                check(
                    "enrolment",
                    Verdict::Warn,
                    "Not enrolled — open http://localhost:8082/setup on this machine.",
                )
            });
            let database = std::env::var("INVENTORY_DATABASE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| dir.join("store-edge.sqlite3"));
            database_checks(&database, &mut checks, &mut detail);
            incident_checks(dir, &mut checks, &mut detail);
            detail["log_tail"] = json!(log_tail(dir, 200));
        }
        None => checks.push(check(
            "installation",
            Verdict::Warn,
            "Not an installation (ITULAH_DATA_DIR not set) — checking connections only.",
        )),
    }
    local_checks(&mut checks).await;
    cloud_checks(&mut checks, &mut detail).await;
    Report {
        taken_at: Utc::now(),
        version: env!("CARGO_PKG_VERSION"),
        platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        data_dir: data_dir.map(Path::to_path_buf),
        verdict: checks
            .iter()
            .map(|check| check.verdict)
            .max()
            .unwrap_or(Verdict::Ok),
        checks,
        detail,
    }
}

/// Print the verdict and write the full report beside the node's data.
/// Returns where the report went.
pub fn print_and_save(report: &Report) -> Option<PathBuf> {
    let mark = |verdict: Verdict| match verdict {
        Verdict::Ok => "OK   ",
        Verdict::Warn => "WARN ",
        Verdict::Fail => "FAIL ",
    };
    println!(
        "itulah Store Server {} — diagnosis {}",
        report.version,
        report.taken_at.format("%Y-%m-%d %H:%M UTC")
    );
    println!();
    for check in &report.checks {
        println!(
            "  [{}] {:<12} {}",
            mark(check.verdict),
            check.name,
            check.saying
        );
    }
    println!();
    println!(
        "Verdict: {}",
        match report.verdict {
            Verdict::Ok => "all good.",
            Verdict::Warn => "running, with something to keep an eye on.",
            Verdict::Fail => "there is a problem — send the report file below to head office.",
        }
    );
    let path = save(report)?;
    println!("Full report: {}", path.display());
    Some(path)
}

/// Write the full report beside the node's data, secrets already removed.
/// Returns where it went; `None` for a node with no data directory.
pub fn save(report: &Report) -> Option<PathBuf> {
    let dir = report.data_dir.as_ref()?.join("diagnostics");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!(
        "diagnose-{}.json",
        report.taken_at.format("%Y%m%d-%H%M%S")
    ));
    std::fs::write(&path, serde_json::to_string_pretty(report).ok()?).ok()?;
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_never_carries_the_key() {
        let dir = std::env::temp_dir().join(format!("itulah-diag-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("dir: {error}"));
        std::fs::write(
            dir.join(enrolment::NODE_ENV_FILE),
            "# comment\nINVENTORY_SITE_ID=store-07\nSYNC_UPLOAD_KEY=supersecretvalue\n",
        )
        .unwrap_or_else(|error| panic!("write: {error}"));
        let env = redacted_env(&dir).to_string();
        assert!(env.contains("INVENTORY_SITE_ID=store-07"));
        assert!(!env.contains("supersecretvalue"), "{env}");
        assert!(env.contains("SYNC_UPLOAD_KEY=<16 characters, removed>"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_worst_check_is_the_verdict() {
        assert!(Verdict::Fail > Verdict::Warn && Verdict::Warn > Verdict::Ok);
    }
}
