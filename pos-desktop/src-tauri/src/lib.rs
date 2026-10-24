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
//!   - [`device`] — what only a process on this machine can reach (the R3 in
//!     [`rfid`], the fingerprint scanner in [`fingerprint`]).
//!
//! And three things about the till itself, none of them domain state:
//!
//!   - [`discovery`] — finding the shop's node on the LAN.
//!   - [`join`] — asking that node to let this till in.
//!   - [`peripherals`] — what is plugged into this till, told to the node.
//!   - [`printer`] — the receipt printer on this till's own cable.
//!   - [`requests`] — what head office left for this till at its node (a
//!     test page), asked for in the background.

use tauri::Manager;

mod device;
mod discovery;
mod edge;
mod fingerprint;
mod join;
mod peripherals;
mod printer;
mod requests;
mod rfid;
/// Only head office uninstalls a POS: the till holds itself until removed.
mod uninstall;

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
    customer_display(&app, true)
}

/// The window itself. `focus` is false when the till opens it at start: the
/// cashier's window is the one that should end up in front of the cashier.
fn customer_display(app: &tauri::AppHandle, focus: bool) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("customer") {
        return if focus {
            existing.set_focus().map_err(|error| error.to_string())
        } else {
            Ok(())
        };
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "customer",
        tauri::WebviewUrl::App("index.html?display".into()),
    )
    .title("central · layar pelanggan")
    .inner_size(1024.0, 768.0)
    .focused(focus)
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
            let display_at_start =
                held.peripherals.customer_display && held.peripherals.customer_display_on_start;
            let resend = held.peripherals.unsent
                && held.pairing_id.is_some()
                && held.pairing_secret.is_some();
            app.manage(edge::Node(std::sync::Mutex::new(held)));
            // A join left waiting when the app closed, picked up where it was.
            app.manage(join::Joining::load(app.handle()));

            // The shopper's screen, when this till has one and was told to
            // open it: a second monitor showing the desktop is a second monitor
            // showing whatever the last person left on it.
            if display_at_start {
                if let Err(error) = customer_display(app.handle(), false) {
                    eprintln!("the customer display could not be opened at start: {error}");
                }
            }
            // A description of this till's peripherals the node never
            // acknowledged goes again now, off the window's thread: a node that
            // is still not there must not hold up the counter opening.
            if resend {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(problem) = peripherals::report(&handle) {
                        eprintln!("peripherals still not reported: {problem}");
                    }
                });
            }
            // Test pages head office asks for, picked up whichever screen is
            // open (`requests.rs`).
            requests::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            edge::node_config,
            edge::set_node_config,
            edge::edge_call,
            edge::edge_signed_call,
            device::rfid_state,
            device::rfid_status,
            device::rfid_read_pad,
            device::rfid_test_reader,
            device::rfid_calibrate,
            device::rfid_diagnostics,
            device::fingerprint_state,
            device::fingerprint_identify,
            device::fingerprint_enroll,
            device::fingerprint_cancel,
            device::fingerprint_install_driver,
            device::open_drawer,
            discovery::discover_nodes,
            discovery::identify_node,
            join::join_current,
            join::join_begin,
            join::join_poll,
            join::join_cancel,
            join::join_supervisor_sign_in,
            join::join_approve_here,
            join::join_supervisor_leave,
            peripherals::set_peripherals,
            peripherals::report_peripherals,
            printer::print_receipt_here,
            printer::test_usb_printer,
            printer::local_printers,
            open_customer_display,
            uninstall::till_hold,
            uninstall::till_unsent,
            uninstall::open_uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("the counter window could not be opened");
}
