//! Devices: the machines enrolled to a node, what a node says about them, and
//! the wire a till speaks to find and join one.
//!
//! Shared by the edge, which enrols tills, records printers and reports them
//! with the RFID keys it trusts in every heartbeat, and by the cloud, which
//! keeps the registry the hub reads and sends a node the hub's suspend and
//! revoke decisions. One copy of the vocabulary, for the reason `enrolment.rs`
//! gives for its protocol: two copies of a wire are two wires.
//!
//! # What a device is (CONTEXT.md, "The fleet")
//!
//! A machine enrolled to a node — a till, a handheld, a network RFID reader, a
//! network printer, an EDC, an attendance terminal. It inherits its site and
//! unit from its node and carries neither itself. **Peripherals** (the
//! customer display, a USB desk reader, the cash drawer, a scanner, a USB
//! printer) are not devices: they are configuration of the one till they hang
//! off, and travel in that till's `config.peripherals`. A person's phone or
//! laptop is a session, not a device.
//!
//! # How each kind reaches head office's register
//!
//! | Kind | Authority | On the register |
//! |------|-----------|-----------------|
//! | TILL, PRINTER | the node (`edge_terminal`, `edge_printer`) | reported in the heartbeat; switchable from the hub by `device.status.set.v1` |
//! | HANDHELD, RFID_READER | head office's `rfid_device`, sent in the auth policy | reported by the node under the kind head office registered the key as (`device_kinds`, postgres 0623 / sqlite 0056) |
//! | ATTENDANCE_TERMINAL | head office's `attendance_terminal` (People) | linked by head office itself, never reported (postgres 0624) |
//! | EDC | Finance's `edc_terminal` | linked by head office itself, never reported (postgres 0624) |
//!
//! The last two are registered at head office against a site, so head office
//! already holds every fact the register shows about them, a node was never
//! sent an EDC at all, and a terminal at a site with no node must still be
//! listed. The register (`device_register`, a view) links each to its site and
//! to the node that serves the site when it is read; nothing is copied.
//!
//! A USB receipt printer is a peripheral, and the one a till prints to itself:
//! the node renders the receipt as it renders every receipt and hands the bytes
//! back (`POST /api/v1/store/sales/{id}/receipt/escpos`); the till sends them
//! through the Windows spooler as a RAW job, or to a CUPS queue with `lp -o
//! raw` (`pos-desktop/src-tauri/src/printer.rs`).
//!
//! # A till finds its node on the LAN
//!
//! The node advertises [`MDNS_SERVICE_TYPE`] as `itulah {node id}` on
//! `{node id}.local` (`edge/discovery.rs`) — names built from the node's id,
//! which do not change when the shop is renamed or the router hands the node a
//! new address. The TXT records carry what [`NodeIdentity`] carries: the
//! origin, the site id and the site's display code and name from the site
//! directory ("C004-TOKO", "Bumiayu"), re-announced when head office changes
//! them. A till lists only machines that confirm themselves at
//! `GET /api/v1/node/identity`, keeps the instance and host beside the address
//! it joined at, and when that address stops connecting looks again and takes
//! a new address only from the same origin (`pos-desktop/src-tauri/src/edge.rs`).
//!
//! What the machines must allow: the node answers queries on UDP 5353, which
//! `store.exe install-service` opens beside TCP 8082 on private and domain
//! networks. A Windows till listening for the first time raises the firewall's
//! prompt for the app — allow it on private networks, or nothing is heard. A
//! Mac till (macOS 15 and later) asks for Local Network access, declared in its
//! `Info.plist`; refused, it can neither hear a node nor reach one at a LAN
//! address, typed or found. A router that drops multicast, or a node on another
//! subnet, leaves the typed address, checked by the same identity call.
//!
//! # A till joins its node the way a node joins head office, one level down
//!
//! | Node enrolment (`enrolment.rs`)          | Till join (here)                          |
//! |------------------------------------------|-------------------------------------------|
//! | ISSUED: an Admin asks the hub for a code | ISSUED + CLAIMED at once: the till asks   |
//! |                                          | the node, sending its key digest          |
//! | CLAIMED: the machine sends code + digest | (the code is born bound to one machine)   |
//! | the key is minted on the machine         | the key is minted on the till             |
//! | six-digit verification number            | the same number, same function            |
//! | decided by an Admin in the hub           | decided by a supervisor at the shop       |
//! | a replacement is generation + 1          | a replacement revokes the old till and    |
//! |                                          | takes its label; both rows are kept       |
//!
//! The one real difference is who carries the code. At head office the code is
//! a secret a person carries to the shop. At the counter the code is a *handle*
//! the till shows so the supervisor can pick the right request from the list
//! on their own screen — it is displayed on both ends and is not a credential.
//! What makes the approval safe is the same as for a node: the verification
//! number is derived from the code and the key digest, so a request made by
//! some other machine on the shop's wifi shows a different number from the one
//! on the till in front of the supervisor.

use argon2::password_hash::rand_core::{OsRng, RngCore};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::security;
use crate::sync::enrolment::MachineFacts;

// ---- Kinds and statuses ------------------------------------------------------

pub const KIND_TILL: &str = "TILL";
pub const KIND_HANDHELD: &str = "HANDHELD";
pub const KIND_RFID_READER: &str = "RFID_READER";
pub const KIND_PRINTER: &str = "PRINTER";
pub const KIND_EDC: &str = "EDC";
pub const KIND_ATTENDANCE_TERMINAL: &str = "ATTENDANCE_TERMINAL";

/// Every kind the registry admits. The `device.kind` CHECK in migration 0604
/// names exactly these.
pub const KINDS: [&str; 6] = [
    KIND_TILL,
    KIND_HANDHELD,
    KIND_RFID_READER,
    KIND_PRINTER,
    KIND_EDC,
    KIND_ATTENDANCE_TERMINAL,
];

pub const STATUS_ACTIVE: &str = "ACTIVE";
pub const STATUS_SUSPENDED: &str = "SUSPENDED";
pub const STATUS_REVOKED: &str = "REVOKED";

pub const STATUSES: [&str; 3] = [STATUS_ACTIVE, STATUS_SUSPENDED, STATUS_REVOKED];

pub fn is_kind(value: &str) -> bool {
    KINDS.contains(&value)
}

/// The two kinds an RFID key can belong to: a reader somebody carries, and one
/// fixed over a door or a bench. Head office says which when it registers the
/// key (postgres 0623), and the node reports the device under it.
pub fn is_rfid_kind(value: &str) -> bool {
    matches!(value, KIND_HANDHELD | KIND_RFID_READER)
}

pub fn is_status(value: &str) -> bool {
    STATUSES.contains(&value)
}

/// Whether a device in `from` may be put into `to`.
///
/// REVOKED is terminal, the way it is for `attendance_terminal`: the machine
/// the identity named is gone or not trusted, and a row edited back to ACTIVE
/// would resurrect an identity somebody decided to destroy. A replacement is a
/// new device, never a revived one.
pub fn may_become(from: &str, to: &str) -> bool {
    is_status(to) && from != STATUS_REVOKED && from != to
}

/// The kinds whose credential and status live on the node itself — a till in
/// `edge_terminal`, a printer in `edge_printer` — and which head office can
/// therefore suspend or revoke by sending the node a command. Every other kind
/// keeps its authority where it already is (`rfid_device` in the centre's
/// auth policy, `attendance_terminal`, `edc_terminal`) and is switched there;
/// the registry only shows it.
pub fn node_owns(kind: &str) -> bool {
    matches!(kind, KIND_TILL | KIND_PRINTER)
}

// ---- What a node reports -------------------------------------------------------

/// One device as its node reports it, in every heartbeat.
///
/// Strings rather than enums for `kind` and `status`, deliberately: a node
/// newer than the cloud may know a kind the cloud does not, and an enum would
/// make that one row fail the whole heartbeat. The cloud checks each row with
/// [`is_kind`] and [`is_status`] and skips what it cannot file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceReport {
    pub device_id: String,
    pub kind: String,
    pub label: String,
    pub status: String,
    #[serde(default)]
    pub last_seen_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub registered_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub registered_by: Option<String>,
    /// The device this one replaced, whose row is kept, revoked.
    #[serde(default)]
    pub replaces: Option<String>,
    #[serde(default)]
    pub status_changed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub status_changed_by: Option<String>,
    #[serde(default)]
    pub status_reason: Option<String>,
    /// Kind-specific and never secret: a printer's host and port, a till's
    /// peripherals, a reader's pools. Keys and hashes never appear here.
    #[serde(default)]
    pub config: Value,
    /// The newest test page this device printed — asked for by head office
    /// ([`COMMAND_DEVICE_TEST_PRINT`]) or pressed at the till — whether it
    /// came out, and why not when it did not. Absent from a node that
    /// predates test prints, and for a device that never printed one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test_print_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test_print_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test_print_error: Option<String>,
    /// The newest of head office's asks this node has finished with — carried
    /// out or given up on — so head office can stop showing it as in flight
    /// without comparing two machines' clocks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_test_print_request_id: Option<Uuid>,
    /// How the device is doing, as far as its node can tell. `None` from a
    /// node that predates the fleet status page (28 Sep 2026); every field
    /// inside is optional too, because a handheld on an older app sends none
    /// of its own and a receipt printer has no reads to count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<DeviceHealth>,
}

/// What a node knows about one device's condition. Kind-specific groups, all
/// optional; a screen shows "—" for what is absent, never an invented zero.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct DeviceHealth {
    // ---- a handheld or a fixed reader ----
    /// When the device last pinged or filed a batch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinged_at: Option<DateTime<Utc>>,
    /// Handheld: battery, as it last said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub battery_percent: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    /// Handheld: when its operator last pulled the trigger, as it says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_scan_at: Option<DateTime<Utc>>,
    /// The newest tag this device filed, from the observations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tag_at: Option<DateTime<Utc>>,
    /// Raw reads per minute over `reads_window_minutes`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reads_per_minute: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reads_window_minutes: Option<i64>,

    // ---- a till ----
    /// The USB desk reader (R3) hanging off this till, when the till has one
    /// configured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desk_reader: Option<DeskReaderHealth>,

    // ---- a printer ----
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_print_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels_printed_24h: Option<i64>,
    /// Labels whose tag could not be written, still failed, in 24 hours.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encode_failures_24h: Option<i64>,
    /// Tags spent on failed attempts in 24 hours: each is a label thrown
    /// away.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub void_tags_24h: Option<i64>,
    /// Set while the printer's most recent attempt failed: its fault.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fault: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fault_at: Option<DateTime<Utc>>,
}

/// The till's desk reader, from its peripherals report.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeskReaderHealth {
    pub model: Option<String>,
    /// `None` while the till only says it has one configured, not whether it
    /// is plugged in (a till app older than the check).
    pub attached: Option<bool>,
    /// When the till last reported its peripherals.
    pub reported_at: Option<DateTime<Utc>>,
}

// ---- Head office's decision, sent down ---------------------------------------

/// Put one device on a node into a status. Rides the signed command channel
/// like every other downstream instruction.
///
/// **Only sent to a node whose heartbeat carries a device list.** An edge
/// build that predates this does not know the type, and an unknown command
/// type blocks a node's whole command stream (`edge/sync.rs`,
/// `apply_command_effect`) — which is right for a price book and wrong for a
/// till switched off from head office.
pub const COMMAND_DEVICE_STATUS_SET: &str = "device.status.set.v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceStatusCommand {
    pub device_id: String,
    pub kind: String,
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
    pub decided_by: String,
    pub decided_at: DateTime<Utc>,
}

pub fn parse_device_status_command(payload: &Value) -> Result<DeviceStatusCommand, String> {
    let command: DeviceStatusCommand = serde_json::from_value(payload.clone())
        .map_err(|error| format!("invalid {COMMAND_DEVICE_STATUS_SET}: {error}"))?;
    if command.device_id.trim().is_empty() {
        return Err(format!("{COMMAND_DEVICE_STATUS_SET} names no device"));
    }
    if !node_owns(&command.kind) {
        return Err(format!(
            "{COMMAND_DEVICE_STATUS_SET}: a {} is not switched on and off at its node",
            command.kind
        ));
    }
    if !is_status(&command.status) {
        return Err(format!(
            "{COMMAND_DEVICE_STATUS_SET}: {} is not a device status",
            command.status
        ));
    }
    if command.decided_by.trim().is_empty() {
        return Err(format!(
            "{COMMAND_DEVICE_STATUS_SET} names nobody who decided"
        ));
    }
    Ok(command)
}

// ---- Head office asks for a test page ------------------------------------------

/// Print a test page on one device: a till, on the receipt printer it was set
/// up with, or a network printer the node recorded. Rides the signed command
/// channel like [`COMMAND_DEVICE_STATUS_SET`].
///
/// **Only sent to a node whose heartbeat advertises
/// [`TEST_PRINT_CAPABILITY`]**, for the reason given there: an older build
/// blocks its whole command stream on a type it does not know.
///
/// The node keeps the ask until it is carried out. A printer's node prints the
/// page itself; a till picks the ask up with its signed poll
/// (`GET /api/v1/devices/self/requests`), prints, and reports
/// (`POST /api/v1/devices/self/test-print-result`). The outcome travels back
/// in the heartbeat's device list ([`DeviceReport::last_test_print_at`]).
pub const COMMAND_DEVICE_TEST_PRINT: &str = "device.test_print.v1";

/// What a node's heartbeat carries once its build takes
/// [`COMMAND_DEVICE_TEST_PRINT`].
pub const TEST_PRINT_CAPABILITY: &str = "device.test_print.v1";

/// Where a till asks for the work head office left for it, signed like its
/// peripherals report.
pub const SELF_REQUESTS_PATH: &str = "/api/v1/devices/self/requests";

/// Where a till says how the test page came out.
pub const SELF_TEST_PRINT_RESULT_PATH: &str = "/api/v1/devices/self/test-print-result";

/// The kinds that print a test page: a till (on its receipt printer) and a
/// network printer.
pub fn prints_test_page(kind: &str) -> bool {
    matches!(kind, KIND_TILL | KIND_PRINTER)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceTestPrintCommand {
    /// Head office's id for the ask; also what the hub was answered with.
    pub request_id: Uuid,
    pub device_id: String,
    pub kind: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
}

pub fn parse_device_test_print_command(payload: &Value) -> Result<DeviceTestPrintCommand, String> {
    let command: DeviceTestPrintCommand = serde_json::from_value(payload.clone())
        .map_err(|error| format!("invalid {COMMAND_DEVICE_TEST_PRINT}: {error}"))?;
    if command.device_id.trim().is_empty() {
        return Err(format!("{COMMAND_DEVICE_TEST_PRINT} names no device"));
    }
    if !prints_test_page(&command.kind) {
        return Err(format!(
            "{COMMAND_DEVICE_TEST_PRINT}: a {} does not print a test page",
            command.kind
        ));
    }
    if command.requested_by.trim().is_empty() {
        return Err(format!("{COMMAND_DEVICE_TEST_PRINT} names nobody who asked"));
    }
    Ok(command)
}

/// One piece of work head office left for a till, as the till's poll reads it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TillRequest {
    pub request_id: Uuid,
    /// `TEST_PRINT`, today the only one.
    pub request: String,
    pub requested_by: String,
    pub requested_at: DateTime<Utc>,
    /// Where the network printer this till's receipts go to answers, when the
    /// till chose one the node recorded (`receipt_printer.printer_id` in its
    /// peripherals): a till keeps only the id, and the address is the node's.
    /// Absent for a till that prints to USB or to an address it was given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub printer_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub printer_port: Option<u16>,
}

/// `GET /api/v1/devices/self/requests`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TillRequests {
    pub items: Vec<TillRequest>,
}

/// `POST /api/v1/devices/self/test-print-result`, signed by the till.
/// `request_id` is absent when the till's own "test print" button was
/// pressed: the outcome is kept all the same.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestPrintResult {
    #[serde(default)]
    pub request_id: Option<Uuid>,
    pub ok: bool,
    #[serde(default)]
    pub error: Option<String>,
}

// ---- A till joining its node ---------------------------------------------------

/// Characters in a join code. Six Crockford characters are 30 bits — plenty
/// for a handle that lives fifteen minutes and is not a secret.
pub const JOIN_CODE_LENGTH: usize = 6;

/// How long a till waits for a supervisor before it has to ask again.
pub const JOIN_TTL_MINUTES: i64 = 15;

/// How many undecided requests a node holds at once. Anybody on the shop's
/// wifi can ask to join; this is what stops that becoming a list nobody can
/// read. A shop never installs five tills in the same quarter of an hour.
pub const MAX_OPEN_JOINS: i64 = 5;

/// What a new till's label starts with: "Kasir 1", "Kasir 2", …
pub const TILL_LABEL_PREFIX: &str = "Kasir";

/// A fresh join code, uniformly random over Crockford's alphabet.
pub fn random_join_code() -> String {
    // Same alphabet and the same exact-uniform masking as the node's code.
    const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut bytes = [0u8; JOIN_CODE_LENGTH];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| ALPHABET[(byte & 0x1f) as usize] as char)
        .collect()
}

/// "7K4-P9Q": how the till and the supervisor's screen both print it.
pub fn display_join_code(code: &str) -> String {
    crate::sync::enrolment::display_code(code)
}

/// The number read aloud across the counter. The node's own function, so a
/// shop that has seen one of these has seen both.
pub fn join_verification(code: &str, key_sha256: &str) -> String {
    crate::sync::enrolment::verification_number(code, key_sha256)
}

/// The next free "Kasir N" at a node: the smallest N no live till is using.
///
/// A revoked till gives its number back (the caller passes only live labels),
/// so a shop that replaced "Kasir 2" and did not say so gets a new "Kasir 2"
/// rather than a "Kasir 5" beside three others.
pub fn next_till_label<'a>(taken: impl IntoIterator<Item = &'a str>) -> String {
    let used: std::collections::BTreeSet<u32> = taken
        .into_iter()
        .filter_map(|label| {
            label
                .trim()
                .strip_prefix(TILL_LABEL_PREFIX)
                .and_then(|rest| rest.trim().parse::<u32>().ok())
        })
        .collect();
    let mut number = 1;
    while used.contains(&number) {
        number += 1;
    }
    format!("{TILL_LABEL_PREFIX} {number}")
}

/// `POST /api/v1/devices/join`, sent by a till that has no credential yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinRequest {
    /// SHA-256 of the secret the till minted, lowercase hex. The node keeps
    /// this and nothing else; the till signs with it from then on, exactly as
    /// a till paired the old way does (`edge/fingerprint.rs`).
    pub key_sha256: String,
    /// `TILL` when absent, and today the only kind that joins this way.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub machine: MachineFacts,
}

/// What the till shows while it waits.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinAnswer {
    pub join_id: Uuid,
    /// Already in its display form: `7K4-P9Q`.
    pub code: String,
    pub verification: String,
    pub expires_at: DateTime<Utc>,
    pub node: NodeIdentity,
}

/// `POST /api/v1/devices/join/status`. `proof` is [`join_status_proof`]: only
/// the machine that holds the key the request carried can ask after it, and
/// asking does not put the key on the wire a second time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinStatusRequest {
    pub join_id: Uuid,
    pub proof: String,
}

pub fn join_status_proof(key_sha256: &str, join_id: &Uuid) -> String {
    security::hmac_sha256_hex(
        key_sha256.as_bytes(),
        format!("join-status\n{join_id}").as_bytes(),
    )
}

/// Where a join request stands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JoinStatus {
    /// Nobody at the shop has decided yet.
    Pending {
        code: String,
        verification: String,
        expires_at: DateTime<Utc>,
    },
    /// Registered. The till keeps `terminal_id` beside the secret it minted
    /// and signs every request with them from now on.
    Approved {
        terminal_id: String,
        label: String,
        site_id: String,
        origin_id: String,
    },
    /// Refused, withdrawn, or nobody came in time. The till forgets the key
    /// it minted and asks again.
    Refused { reason: String },
}

// ---- Who a node is, to anybody on its LAN ----------------------------------------

/// The DNS-SD service type a node advertises itself under
/// (`edge/discovery.rs`) and a till browses for
/// (`pos-desktop/src-tauri/src/discovery.rs`, which repeats the spelling: the
/// shell does not link this crate).
pub const MDNS_SERVICE_TYPE: &str = "_itulah-store._tcp.local.";

/// `GET /api/v1/node/identity`: who this node is, for a till looking for its
/// shop's server. Unauthenticated by design, so it carries nothing that is
/// not already printed on the shop's receipts: no key, no user, no count.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeIdentity {
    /// Always `itulah-store`, so a till scanning a LAN can tell our node from
    /// anything else that answers on 8082.
    pub service: String,
    pub origin_id: String,
    pub site_id: String,
    /// The site's display code (`C004-TOKO`) and name (`Bumiayu`), as head
    /// office last described them (`site_directory`, sqlite 0049). What a
    /// person at a till recognises — a site id is a label nobody reads.
    /// Absent until the node has heard from head office, and from a node that
    /// predates the directory; a till then shows the site id instead.
    #[serde(default)]
    pub site_code: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
    pub node_role: String,
    pub version: String,
    /// Where a till asks to join.
    pub join_path: String,
}

pub const NODE_SERVICE: &str = "itulah-store";
pub const JOIN_PATH: &str = "/api/v1/devices/join";
