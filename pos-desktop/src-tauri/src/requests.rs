//! What head office leaves for this till at its node: a test page, today.
//!
//! Head office asks for a test page from the device's row in the hub. The ask
//! reaches this till's node (`device.test_print.v1`) and waits there; the node
//! cannot print on a USB printer at this counter, and the till is the one
//! that knows which printer its receipts go to. So the till asks, every half a
//! minute, with the same signature it reports its peripherals with
//! (`GET /api/v1/devices/self/requests`), prints each page on its receipt
//! printer (`printer::print_test_page`), and says how it came out
//! (`POST /api/v1/devices/self/test-print-result`). The node keeps the outcome
//! on this till's row and carries it to head office in its heartbeat.
//!
//! The poll lives here rather than in the window, beside the other things
//! this shell does on its own (`peripherals::report` at start): it must run
//! whichever screen is open, and nobody at the counter is waiting on it. A
//! till that has not joined a node polls nothing, and a node too old to know
//! the path is asked again only rarely.
//!
//! Every signed call is also this till saying it is alive, so head office's
//! register sees it online while it stands idle.

use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::Manager;

use crate::edge::{self, Node};

/// The node's signed paths, as `backend/src/sync/device.rs` spells them.
pub const REQUESTS_PATH: &str = "/api/v1/devices/self/requests";
pub const TEST_PRINT_RESULT_PATH: &str = "/api/v1/devices/self/test-print-result";

/// How often a joined till asks.
const EVERY: Duration = Duration::from_secs(30);
/// How often it asks a node that does not know the path.
const EVERY_ON_AN_OLD_NODE: Duration = Duration::from_secs(30 * 60);

/// One ask, as the node answers it.
#[derive(Debug, Deserialize)]
struct TillRequest {
    request_id: String,
    request: String,
    #[serde(default)]
    requested_by: String,
    #[serde(default)]
    printer_host: Option<String>,
    #[serde(default)]
    printer_port: Option<u16>,
}

#[derive(Debug, Default, Deserialize)]
struct TillRequests {
    #[serde(default)]
    items: Vec<TillRequest>,
}

/// Ask forever, on a thread of its own, starting half a minute after the app.
pub fn spawn(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(EVERY);
        let wait = match poll_once(&app) {
            Poll::Done => EVERY,
            Poll::OldNode => EVERY_ON_AN_OLD_NODE,
        };
        if wait > EVERY {
            std::thread::sleep(wait - EVERY);
        }
    });
}

enum Poll {
    Done,
    OldNode,
}

fn joined(app: &tauri::AppHandle) -> bool {
    let held = edge::lock(app.state::<Node>().inner());
    held.pairing_id.is_some() && held.pairing_secret.is_some()
}

fn poll_once(app: &tauri::AppHandle) -> Poll {
    if !joined(app) {
        return Poll::Done;
    }
    let node = app.state::<Node>();
    let reply = edge::signed_call(app, node.inner(), "GET", REQUESTS_PATH, None);
    // A node that predates the path: it routes nothing there (404), or asks
    // for a session because the path is not one of its signed ones.
    let old_node = reply.status == 404
        || (reply.status == 401
            && reply
                .problem
                .as_deref()
                .is_some_and(|problem| problem.contains("missing session")));
    if old_node {
        return Poll::OldNode;
    }
    if !reply.ok {
        // A node that is not there is the counter's everyday weather, and is
        // already shown where the cashier looks. Nothing to add here.
        return Poll::Done;
    }
    let requests: TillRequests = serde_json::from_value(reply.body).unwrap_or_default();
    for request in requests.items {
        if request.request != "TEST_PRINT" {
            continue;
        }
        let recorded = request
            .printer_host
            .clone()
            .filter(|host| !host.trim().is_empty())
            .map(|host| (host, request.printer_port.unwrap_or(9100)));
        let asked_by = if request.requested_by.trim().is_empty() {
            "kantor pusat".to_string()
        } else {
            format!("kantor pusat ({})", request.requested_by.trim())
        };
        let outcome = crate::printer::print_test_page(app, &asked_by, recorded).map(|_| ());
        report(app, Some(&request.request_id), &outcome);
    }
    Poll::Done
}

/// Tell the node how a test page came out: one head office asked for
/// (`request_id`), or one pressed at this till. Best effort: a report the
/// node never heard leaves head office showing the page as not yet printed,
/// which is the truth as far as it knows.
pub fn report(app: &tauri::AppHandle, request_id: Option<&str>, outcome: &Result<(), String>) {
    if !joined(app) {
        return;
    }
    let body = json!({
        "request_id": request_id,
        "ok": outcome.is_ok(),
        "error": outcome.as_ref().err(),
    });
    let node = app.state::<Node>();
    let reply = edge::signed_call(app, node.inner(), "POST", TEST_PRINT_RESULT_PATH, Some(&body));
    if !reply.ok && reply.status != 404 {
        eprintln!(
            "the test page's outcome was not reported: {}",
            reply.problem.unwrap_or_default()
        );
    }
}
