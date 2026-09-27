//! The node telling head office how it is, once a minute.
//!
//! The same snapshot the console shows (`edge/status.rs`), posted to
//! `/api/v1/sync/heartbeat` with the node's own key. The cloud keeps the
//! latest one per node for the hub's Fleet page, files the incidents it has
//! not seen yet, and raises an alert when a node's condition turns into
//! something a person must act on.
//!
//! Pushed by the node, never pulled by the cloud: the cloud never dials a shop
//! (the same principle the sync lane keeps), which is also why this works
//! behind any shop router. A node that stops sending is itself the news — the
//! Fleet page says "not seen since …" after two minutes of silence.
//!
//! The answer carries the cloud's clock, which is how the node learns how far
//! its own has drifted; terminal signatures are refused past a skew, so this
//! is a number the console must be able to show.

use crate::edge::status::StatusSource;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

pub const INTERVAL: Duration = Duration::from_secs(60);
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(15);

/// Woken when there is news head office is waiting for — an action it asked
/// for moved on (`edge/ops.rs`) — so the hub hears in seconds, not at the
/// top of the next minute.
static SOON: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// Send the next heartbeat now rather than when the minute is up. Several
/// calls before it goes collapse into one.
pub fn soon() {
    SOON.notify_one();
}

/// A gap between two answers longer than this, with the process running
/// throughout, is an internet outage: two missed heartbeats and a half.
fn link_outage_after() -> chrono::Duration {
    chrono::Duration::seconds(150)
}

#[derive(Deserialize)]
struct Answer {
    server_time: DateTime<Utc>,
}

/// Send one heartbeat now. Returns the measured clock skew in seconds.
pub async fn send_once(
    client: &reqwest::Client,
    source: &Arc<StatusSource>,
) -> Result<i64, String> {
    let sync = source.sync.as_ref().ok_or("no cloud configured")?;
    let (base, key) = sync.cloud().ok_or("no cloud configured")?;
    let key = key.to_owned();
    let collecting = source.clone();
    let status = tokio::task::spawn_blocking(move || collecting.collect())
        .await
        .map_err(|error| error.to_string())?;
    let sent_at = Utc::now();
    let started = Instant::now();
    let response = client
        .post(format!("{base}/api/v1/sync/heartbeat"))
        .header("x-sync-key", key)
        .json(&json!({ "origin_id": status.origin_id, "status": status }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("heartbeat answered {}", response.status()));
    }
    let answer: Answer = response.json().await.map_err(|error| error.to_string())?;
    // The cloud read its clock somewhere inside the round trip; the middle is
    // the best guess, and good to well under a second on any shop line.
    let midpoint = sent_at + chrono::Duration::from_std(started.elapsed() / 2).unwrap_or_default();
    let skew = (midpoint - answer.server_time).num_seconds();
    if let Ok(mut slot) = source.clock_skew.lock() {
        *slot = Some(skew);
    }
    // Head office answered. If the answer before this one was long enough
    // ago, this process sat through a silence while it kept running: the
    // internet, not the machine. Written down so the Fleet page can say the
    // shop kept selling (sqlite 0065).
    let answered_before = source
        .last_answered
        .lock()
        .ok()
        .and_then(|mut slot| slot.replace(sent_at));
    if let Some(before) = answered_before.filter(|before| sent_at - *before > link_outage_after()) {
        let recording = source.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if let Err(error) = recording.record_link_outage(before, sent_at) {
                tracing::warn!(%error, "an internet outage was not written down");
            }
        })
        .await;
    }
    // Head office answered, so a sync breaker still waiting out an outage is
    // waiting for nothing.
    let sync = sync.clone();
    if tokio::task::spawn_blocking(move || sync.cloud_answered())
        .await
        .unwrap_or(false)
    {
        tracing::info!("head office is reachable again: sync resumes now");
    }
    Ok(skew)
}

/// Heartbeat forever, starting now. A failure is logged at debug only: an
/// unreachable cloud is already on the console as "offline", from the sync
/// lane, and a line a minute saying so again helps nobody.
pub fn spawn(source: Arc<StatusSource>) {
    if source.sync.is_none() {
        return;
    }
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::error!(%error, "heartbeat disabled: cannot build an HTTP client");
                return;
            }
        };
        loop {
            // Soon again after a failure: at boot the node is often up before
            // head office (or the network) is, and a full minute of "not seen"
            // on the Fleet page for a machine that is fine is a false alarm.
            let wait = match send_once(&client, &source).await {
                Ok(skew) => {
                    if skew.abs() > 30 {
                        tracing::warn!(skew, "this machine's clock is off from head office's");
                    }
                    INTERVAL
                }
                Err(error) => {
                    tracing::debug!(%error, "heartbeat not delivered");
                    RETRY_AFTER_FAILURE
                }
            };
            tokio::select! {
                () = tokio::time::sleep(wait) => {}
                () = SOON.notified() => {}
            }
        }
    });
}
