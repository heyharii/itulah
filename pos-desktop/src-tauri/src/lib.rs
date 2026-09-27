//! The counter terminal.
//!
//! A window, a way to reach the shop's node, and the counter's own hardware.
//! Nothing else — and the "nothing else" is the point of this file.
//!
//! # The rule this shell is built to obey
//!
//! **No domain state lives here.** Stock, price, promotion, the sale and its
//! sequence number, the cash session and the sync to head office are all the
//! shop node's, and there is exactly one of that node per shop. A terminal that
//! kept its own opinion about any of them would be a second authority in a
//! building that is supposed to have one, and the disagreement would surface
//! weeks later as a stock count nobody can explain.
//!
//! The single exception is the **basket that has not been sold yet**, which is
//! terminal-local on purpose: a tag waved at a reader has to be drawn before
//! anything touches the wire. `POS-TABLET-PLAN.md` §1 spells out what the
//! alternative costs — six round trips per basket, and a half-finished
//! transaction left on a server every time shop wifi drops mid-sale.
//!
//! So: two lanes out of this process, and both of them are named.
//!
//!   - [`edge`] — everything the shop decides, asked for by path.
//!   - [`device`] — what only a process on this machine can reach.

use tauri::Manager;

mod device;
mod edge;
mod rfid;

/// Open the screen that faces the shopper.
///
/// A second window on the counter's second output, showing the same basket from
/// the other side of the glass. It is the same bundle at `?display`, not a
/// separate app: one build, one place the basket is described, and a display
/// that cannot drift from the till it is standing next to.
///
/// Asked for twice, it focuses the one that is already open rather than opening
/// another — two customer displays would be two answers to "what do I owe".
#[tauri::command]
fn open_customer_display(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("customer") {
        return existing.set_focus().map_err(|error| error.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "customer",
        tauri::WebviewUrl::App("index.html?display".into()),
    )
    .title("central · layar pelanggan")
    .inner_size(1024.0, 768.0)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // What this terminal was set up as, read before the window opens:
            // a till that showed the counter and only then discovered which
            // shop it belongs to would spend its first seconds refusing calls.
            let held = edge::load(app.handle());
            app.manage(edge::Node(std::sync::Mutex::new(held)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            edge::node_config,
            edge::set_node_config,
            edge::edge_call,
            edge::edge_signed_call,
            device::rfid_state,
            device::rfid_read_single,
            device::fingerprint_state,
            device::fingerprint_identify,
            device::fingerprint_enroll,
            device::open_drawer,
            open_customer_display,
        ])
        .run(tauri::generate_context!())
        .expect("the counter window could not be opened");
}
