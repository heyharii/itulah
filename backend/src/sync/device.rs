//! Devices: the machines enrolled to a node, what a node says about them, and
//! the wire a till speaks to join one.
//!
//! Shared by the edge, which enrols tills and records printers and reports
//! both in its heartbeat, and by the cloud, which keeps the registry the hub
//! reads and sends a node the hub's suspend and revoke decisions. One copy of
//! the vocabulary, for the reason `enrolment.rs` gives for its protocol: two
//! copies of a wire are two wires.
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

/// Every kind the registry admits. The `device.kind` CHECK in migration 0475
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
/// auth policy, `attendance_terminal`, `edc_terminal`), and the registry only
/// mirrors it.
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

/// The DNS-SD service type a node will advertise itself under
/// (`STORE-SERVER-PLAN.md` §7). Recorded here so the day the advertisement
/// lands, the till's browser and the node agree on one spelling.
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
    pub node_role: String,
    pub version: String,
    /// Where a till asks to join.
    pub join_path: String,
}

pub const NODE_SERVICE: &str = "itulah-store";
pub const JOIN_PATH: &str = "/api/v1/devices/join";
