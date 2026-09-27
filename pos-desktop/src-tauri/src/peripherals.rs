//! What hangs off this till, kept as configuration of this till.
//!
//! # Not devices
//!
//! `CONTEXT.md` draws the line: a **peripheral** — the customer display, a USB
//! desk RFID reader, the cash drawer, a scanner, a USB printer — is hardware
//! attached to one till and not enrolled on its own. It has no key, no status
//! and no row in the device register; it is part of what this one till is. So
//! it lives here, in the till's own settings (`node.json`), and is *told* to
//! the node with the till's own signature:
//! `POST /api/v1/devices/self/peripherals`, which the node files on this till's
//! row and carries to head office in the register's `config.peripherals`
//! (`backend/src/edge/devices.rs`, `set_peripherals`). A till can only ever
//! describe itself, because the signature says which till is speaking.
//!
//! # Which copy acts
//!
//! The till's. The node's copy is a report — nothing there decides from it.
//! This copy decides which printer a receipt goes to, whether the drawer is
//! kicked with it, and whether the shopper's window opens when the app starts.
//!
//! # When the node is not there
//!
//! A description the node has not acknowledged is marked `unsent` and sent
//! again the next time the app starts, and again with the next save. A till
//! that could not reach its node the afternoon somebody plugged in a drawer
//! must not keep that from head office for good — and must not stop selling
//! over it either.
//!
//! A network printer is the one thing here that *is* a device: it is recorded
//! once at the node and chosen by its `printer_id` (`record_printer` there).
//! What this till keeps is only which one its receipts go to.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::Manager;

use crate::edge::{self, Node, NodeConfig};

/// Where the node files what a till says is plugged into it.
pub const PERIPHERALS_PATH: &str = "/api/v1/devices/self/peripherals";

/// No receipt printer at this counter. A till can sell all day and hand over
/// no paper.
pub const RECEIPT_NONE: &str = "NONE";
/// The host and port typed in the terminal settings — how every till printed
/// before printers were recorded, and still the default.
pub const RECEIPT_ADDRESS: &str = "ADDRESS";
/// A network printer the node has recorded, chosen by `printer_id`.
pub const RECEIPT_RECORDED: &str = "RECORDED";
/// A USB printer on this till. Recorded and reported; the node, which renders
/// receipts, cannot reach it, so nothing is printed to it yet.
pub const RECEIPT_USB: &str = "USB";

/// The drawer opens when the receipt printer is told to kick it.
pub const DRAWER_PRINTER_PULSE: &str = "PRINTER_PULSE";
/// The drawer opens with a key. Receipts carry `MANUAL`, which the node reads
/// as "do not pulse".
pub const DRAWER_MANUAL: &str = "MANUAL";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Peripherals {
    /// A second screen facing the shopper, shown by this till's second window.
    pub customer_display: bool,
    /// Open that window as the app starts, so the shopper's screen is never
    /// left showing somebody's desktop.
    pub customer_display_on_start: bool,
    /// The USB desk RFID reader's model — `Chainway R3` on the counters
    /// today. `None`: no reader on this till.
    pub desk_reader: Option<String>,
    /// How the cash drawer opens: [`DRAWER_PRINTER_PULSE`] or
    /// [`DRAWER_MANUAL`]. `None`: no drawer at this till.
    pub cash_drawer: Option<String>,
    /// The barcode scanner: `USB_KEYBOARD` (types into the scan field) or
    /// `SERIAL`. `None`: no scanner.
    pub scanner: Option<String>,
    /// [`RECEIPT_NONE`], [`RECEIPT_ADDRESS`], [`RECEIPT_RECORDED`] or
    /// [`RECEIPT_USB`].
    pub receipt_printer: String,
    /// For [`RECEIPT_RECORDED`]: the printer at the node, and its name as the
    /// node spelled it when it was chosen.
    pub printer_id: Option<String>,
    pub printer_label: Option<String>,
    /// For [`RECEIPT_USB`]: what the printer is, as the installer read it off
    /// the machine.
    pub usb_printer_model: Option<String>,
    /// True while the node has not acknowledged the description as it is now.
    pub unsent: bool,
    /// Unix seconds of the node's last acknowledgement.
    pub reported_at: Option<i64>,
}

impl Default for Peripherals {
    /// What a till that never opened this screen already does: receipts to
    /// the address in its settings, the drawer kicked by the printer. Anything
    /// else would change how an existing counter behaves because a field
    /// appeared in its config file.
    fn default() -> Self {
        Self {
            customer_display: false,
            customer_display_on_start: false,
            desk_reader: None,
            cash_drawer: Some(DRAWER_PRINTER_PULSE.into()),
            scanner: None,
            receipt_printer: RECEIPT_ADDRESS.into(),
            printer_id: None,
            printer_label: None,
            usb_printer_model: None,
            unsent: false,
            reported_at: None,
        }
    }
}

fn filled(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Tidy what the window sent: blanks become "none", words are checked, and a
/// choice that needs a detail it does not have falls back to something that
/// says so rather than pretending.
fn tidy(mut next: Peripherals) -> Result<Peripherals, String> {
    next.desk_reader = filled(&next.desk_reader);
    next.scanner = filled(&next.scanner).map(|kind| kind.to_ascii_uppercase());
    next.cash_drawer = filled(&next.cash_drawer).map(|how| how.to_ascii_uppercase());
    if let Some(how) = next.cash_drawer.as_deref() {
        if how != DRAWER_PRINTER_PULSE && how != DRAWER_MANUAL {
            return Err(format!(
                "Laci kas dibuka lewat printer (PRINTER_PULSE) atau manual (MANUAL), bukan {how}."
            ));
        }
    }
    next.receipt_printer = next.receipt_printer.trim().to_ascii_uppercase();
    match next.receipt_printer.as_str() {
        RECEIPT_NONE | RECEIPT_ADDRESS => {
            next.printer_id = None;
            next.printer_label = None;
            next.usb_printer_model = None;
        }
        RECEIPT_RECORDED => {
            next.printer_id = filled(&next.printer_id);
            next.printer_label = filled(&next.printer_label);
            next.usb_printer_model = None;
            if next.printer_id.is_none() {
                return Err("Pilih printer jaringan yang tercatat di node.".into());
            }
        }
        RECEIPT_USB => {
            next.printer_id = None;
            next.printer_label = None;
            next.usb_printer_model = filled(&next.usb_printer_model);
        }
        other => {
            return Err(format!(
                "“{other}” bukan pilihan printer struk. Pilih tanpa printer, alamat, \
                 printer tercatat, atau USB."
            ))
        }
    }
    // Only a display that is there can be opened at start.
    next.customer_display_on_start = next.customer_display && next.customer_display_on_start;
    Ok(next)
}

/// This till's peripherals in the node's words: one entry per thing plugged
/// in, nothing for what is not. The shape `set_peripherals` documents:
/// `customer_display`, `desk_reader`, `cash_drawer`, `scanner`,
/// `usb_printer` — plus `receipt_printer`, which names the recorded network
/// printer (or the typed address) this till's receipts go to.
pub fn describe(config: &NodeConfig) -> Value {
    let peripherals = &config.peripherals;
    let mut out = Map::new();
    if peripherals.customer_display {
        out.insert(
            "customer_display".into(),
            json!({
                "window": "customer",
                "open_on_start": peripherals.customer_display_on_start,
            }),
        );
    }
    if let Some(model) = filled(&peripherals.desk_reader) {
        out.insert(
            "desk_reader".into(),
            json!({ "model": model, "connection": "USB" }),
        );
    }
    if let Some(opened_by) = filled(&peripherals.cash_drawer) {
        out.insert("cash_drawer".into(), json!({ "opened_by": opened_by }));
    }
    if let Some(connection) = filled(&peripherals.scanner) {
        out.insert("scanner".into(), json!({ "connection": connection }));
    }
    match peripherals.receipt_printer.as_str() {
        RECEIPT_RECORDED => {
            if let Some(printer_id) = filled(&peripherals.printer_id) {
                out.insert(
                    "receipt_printer".into(),
                    json!({
                        "printer_id": printer_id,
                        "label": filled(&peripherals.printer_label),
                        "paper": config.paper,
                    }),
                );
            }
        }
        RECEIPT_USB => {
            out.insert(
                "usb_printer".into(),
                json!({
                    "model": filled(&peripherals.usb_printer_model),
                    "purpose": "RECEIPT",
                    "paper": config.paper,
                }),
            );
        }
        RECEIPT_ADDRESS => {
            if let Some(host) = filled(&config.printer_host) {
                out.insert(
                    "receipt_printer".into(),
                    json!({
                        "host": host,
                        "port": config.printer_port,
                        "paper": config.paper,
                    }),
                );
            }
        }
        _ => {}
    }
    Value::Object(out)
}

/// Tell the node what is plugged into this till, signed as this till.
///
/// Marks the description sent only if it is still the one held when the node
/// answered: a save that raced this report stays `unsent` and goes next time.
/// Takes the lock itself; the caller must not hold it.
pub fn report(app: &tauri::AppHandle) -> Result<(), String> {
    let node = app.state::<Node>();
    let config = node.0.lock().expect("node config").clone();
    if config.pairing_id.is_none() || config.pairing_secret.is_none() {
        return Err(
            "Kasir ini belum tergabung ke node toko, jadi perangkatnya disimpan di kasir \
             ini saja. Dikirim otomatis setelah kasir bergabung."
                .into(),
        );
    }
    let sent = describe(&config);
    let body = json!({ "peripherals": sent });
    let reply = edge::signed_call(app, node.inner(), "POST", PERIPHERALS_PATH, Some(&body));
    if !reply.ok {
        let mut held = node.0.lock().expect("node config");
        if !held.peripherals.unsent {
            held.peripherals.unsent = true;
            edge::save(app, &held);
        }
        return Err(reply.problem.unwrap_or_else(|| {
            "Node tidak menerima daftar perangkat kasir ini.".into()
        }));
    }
    let mut held = node.0.lock().expect("node config");
    if describe(&held) == sent {
        held.peripherals.unsent = false;
        held.peripherals.reported_at = Some(edge::now_seconds());
        edge::save(app, &held);
    }
    Ok(())
}

/// What the settings screen gets back from a save or a resend.
#[derive(Serialize)]
pub struct PeripheralsSaved {
    /// The whole config as the shell now holds it, so the window's copy — the
    /// one the receipt code reads — is the one in force.
    pub config: NodeConfig,
    /// True when the node took the description just now.
    pub reported: bool,
    /// Why it did not, in the node's words or the shell's. Not a failure of
    /// the save: the description is kept here either way.
    pub problem: Option<String>,
}

fn answer(app: &tauri::AppHandle, outcome: Result<(), String>) -> PeripheralsSaved {
    let config = app
        .state::<Node>()
        .0
        .lock()
        .expect("node config")
        .clone();
    PeripheralsSaved {
        config,
        reported: outcome.is_ok(),
        problem: outcome.err(),
    }
}

/// Keep a new description of this till's peripherals, then tell the node.
#[tauri::command]
pub async fn set_peripherals(
    app: tauri::AppHandle,
    next: Peripherals,
) -> Result<PeripheralsSaved, String> {
    edge::off_the_window(move || {
        let next = tidy(next)?;
        {
            let node = app.state::<Node>();
            let mut held = node.0.lock().expect("node config");
            let reported_at = held.peripherals.reported_at;
            held.peripherals = Peripherals {
                unsent: true,
                reported_at,
                ..next
            };
            edge::save(&app, &held);
        }
        let outcome = report(&app);
        Ok(answer(&app, outcome))
    })
    .await
}

/// Send the description again without changing it — after joining, or from
/// the settings screen's "kirim ulang".
#[tauri::command]
pub async fn report_peripherals(app: tauri::AppHandle) -> Result<PeripheralsSaved, String> {
    edge::off_the_window(move || {
        let outcome = report(&app);
        Ok(answer(&app, outcome))
    })
    .await
}
