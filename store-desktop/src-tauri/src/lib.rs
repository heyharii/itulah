//! Central Store: the store app in a window of its own.
//!
//! The store app (`frontend-store-new`) is served by the store server on port
//! 8082. In a browser somebody has to know that address, and at C015 on
//! 28 Oct 2026 nobody could find it: the setup page offered a `.local` name
//! Windows would not open (docs/research/2026-10-29-install-laptop-c015.md).
//! This shell never asks. It looks, in order, at the server it opened last,
//! at a server on this same PC, and then on the shop's network the way
//! Central POS does — the discovery module is POS's own file, not a copy —
//! and opens the first one that answers as a store server.

use serde::{Deserialize, Serialize};
use tauri::Manager as _;

#[path = "../../../pos-desktop/src-tauri/src/discovery.rs"]
pub mod discovery;

/// What `discovery.rs` asks of the POS shell's `edge` module, and nothing else.
pub(crate) mod edge {
    use std::time::Duration;

    pub(crate) fn http(patience: Duration) -> ureq::Agent {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(2).min(patience))
            .timeout(patience)
            .build()
    }

    /// Blocking work — an HTTP call, three seconds of listening — off the
    /// window's thread.
    pub(crate) async fn off_the_window<T: Send + 'static>(
        work: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(work)
            .await
            .map_err(|error| error.to_string())?
    }
}

/// The store server on this PC, where the server and its store app share a
/// back-office PC or a laptop.
const THIS_PC: &str = "http://127.0.0.1:8082";
const REMEMBERED: &str = "store.json";

#[derive(Default, Serialize, Deserialize)]
struct Remembered {
    base_url: Option<String>,
}

fn remembered(app: &tauri::AppHandle) -> Option<String> {
    let path = app.path().app_config_dir().ok()?.join(REMEMBERED);
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Remembered>(&text).ok()?.base_url
}

fn remember(app: &tauri::AppHandle, base_url: &str) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let body = Remembered {
        base_url: Some(base_url.to_owned()),
    };
    if let Ok(text) = serde_json::to_string_pretty(&body) {
        let _ = std::fs::write(dir.join(REMEMBERED), text);
    }
}

/// The store servers this window could open: the remembered one or the one
/// on this PC when either answers, else every confirmed one on the network.
#[tauri::command]
async fn find_store(app: tauri::AppHandle) -> Result<Vec<discovery::FoundNode>, String> {
    let mut first = vec![THIS_PC.to_owned()];
    if let Some(last) = remembered(&app) {
        first.insert(0, last);
    }
    for base_url in first {
        if let Ok(node) = discovery::identify_node(base_url).await {
            if node.identity.is_some() {
                return Ok(vec![node]);
            }
        }
    }
    let found = discovery::discover_nodes().await?;
    Ok(found
        .into_iter()
        .filter(|node| node.identity.is_some())
        .collect())
}

/// Open the store app of `base_url` in this window, and remember it.
#[tauri::command]
async fn open_store(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    base_url: String,
) -> Result<(), String> {
    let node = discovery::identify_node(base_url).await?;
    let url = tauri::Url::parse(&node.base_url).map_err(|error| error.to_string())?;
    remember(&app, &node.base_url);
    window.navigate(url).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![find_store, open_store])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("Central Store could not start: {error}"));
}
