//! Finding the shop's node on the LAN.
//!
//! A new till should not need somebody who knows what an IP address is. The
//! node advertises itself over mDNS as `_itulah-store._tcp`
//! (`backend/src/edge/discovery.rs`), and this file listens for it for a few
//! seconds and lists what answered.
//!
//! # An advertisement is a hint
//!
//! Anything on the shop's wifi can announce the service type. So every
//! address heard is **confirmed** by asking it `GET /api/v1/node/identity`,
//! and only a machine that answers as our node — `service: "itulah-store"`,
//! with its origin and its site — is offered as one. The site and origin the
//! window shows come from that answer, never from the TXT records; the TXT
//! site is kept only to say which shop a machine *claimed* to be when it would
//! not confirm.
//!
//! And confirming is still not trusting. What makes a till's join safe is the
//! supervisor reading the same code and number on both screens, not which
//! machine the till found first.
//!
//! # The typed address stays
//!
//! A router that drops multicast is common in shops, and a node on another
//! subnet is never heard. So an address can always be typed, and it is
//! checked with the same identity call before anything is sent to it.

use std::collections::BTreeMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};

/// `MDNS_SERVICE_TYPE` in `backend/src/sync/device.rs`.
pub const SERVICE_TYPE: &str = "_itulah-store._tcp.local.";
/// `NODE_SERVICE` there: what our node says it is.
pub const NODE_SERVICE: &str = "itulah-store";
const IDENTITY_PATH: &str = "/api/v1/node/identity";
/// The port a store node listens on unless told otherwise
/// (`backend/src/edge/node.rs`).
const NODE_PORT: u16 = 8082;

/// Long enough for a responder on a busy shop wifi to answer twice, short
/// enough that a person looking at "Mencari…" does not start to wonder.
const LISTEN: Duration = Duration::from_millis(2500);
/// A node on the same LAN answers in milliseconds; two seconds is a node that
/// is not there.
const CONFIRM: Duration = Duration::from_secs(2);
/// A typed address may be across a slower link. Still bounded.
const CONFIRM_TYPED: Duration = Duration::from_secs(5);

/// Who a node says it is: `NodeIdentity` in `backend/src/sync/device.rs`.
/// Every field defaulted, so a node newer than this till that adds one does
/// not make the answer unreadable.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeIdentity {
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub origin_id: String,
    #[serde(default)]
    pub site_id: String,
    #[serde(default)]
    pub node_role: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub join_path: String,
}

/// One node this till could join, as the window lists it.
#[derive(Clone, Debug, Serialize)]
pub struct FoundNode {
    /// Where the till would talk to it: `http://192.168.1.20:8082`.
    pub base_url: String,
    /// The name it is known by on the LAN, `store-07-edge.local`, or the
    /// address as typed.
    pub host: String,
    /// What it said about itself. `None` when it would not answer as our node,
    /// in which case the window shows it greyed out with `problem`.
    pub identity: Option<NodeIdentity>,
    /// The site its advertisement claimed. Only ever shown beside a failure.
    pub advertised_site: Option<String>,
    pub problem: Option<String>,
}

/// What one advertisement said, before anybody has checked it.
struct Heard {
    host: String,
    port: u16,
    addresses: Vec<IpAddr>,
    site: Option<String>,
}

/// An address as a person types it, as the shell will use it.
///
/// `192.168.1.20` becomes `http://192.168.1.20:8082`: the scheme and the
/// node's own port are what somebody standing at a till leaves out, and
/// neither is a guess — a store node listens on 8082 unless its installer said
/// otherwise, in which case they will have typed the port.
pub fn normalise_base(typed: &str) -> Result<String, String> {
    let text = typed.trim().trim_end_matches('/');
    if text.is_empty() {
        return Err("Alamat node tidak boleh kosong.".into());
    }
    if text.chars().any(char::is_whitespace) {
        return Err(format!("“{text}” bukan alamat — ada spasi di dalamnya."));
    }
    let (scheme, rest) = match text.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => ("http".to_string(), text),
    };
    if scheme != "http" && scheme != "https" {
        return Err(format!(
            "Alamat node dimulai dengan http:// atau https://, bukan {scheme}://."
        ));
    }
    if rest.is_empty() || rest.contains('/') {
        return Err(format!(
            "“{text}” bukan alamat node. Tulis alamatnya saja, misalnya 192.168.1.20:8082."
        ));
    }
    // An IPv6 literal carries its own colons; only look past its bracket.
    let authority_has_port = match rest.rfind(']') {
        Some(end) => rest[end..].contains(':'),
        None => rest.contains(':'),
    };
    Ok(if authority_has_port {
        format!("{scheme}://{rest}")
    } else {
        format!("{scheme}://{rest}:{NODE_PORT}")
    })
}

/// Ask an address who it is, and accept only our node's answer.
pub fn identify(base_url: &str, patience: Duration) -> Result<NodeIdentity, String> {
    let url = format!("{}{IDENTITY_PATH}", base_url.trim_end_matches('/'));
    match ureq::get(&url)
        .timeout(patience)
        .set("Accept", "application/json")
        .call()
    {
        Ok(response) => {
            let identity: NodeIdentity = response.into_json().map_err(|_| {
                format!("{base_url} menjawab, tetapi bukan sebagai node toko.")
            })?;
            if identity.service != NODE_SERVICE {
                return Err(format!(
                    "{base_url} menjawab, tetapi bukan sebagai node toko itulah."
                ));
            }
            Ok(identity)
        }
        // A node that predates the join API answers everything else and not
        // this: say what to do about it rather than "not found".
        Err(ureq::Error::Status(404, _)) => Err(format!(
            "{base_url} menjawab, tetapi belum mengenal pendaftaran kasir — \
             kemungkinan node versi lama. Perbarui node dulu, atau pasangkan \
             terminal lewat Setelan."
        )),
        Err(ureq::Error::Status(status, _)) => Err(format!(
            "{base_url} menolak pertanyaan “siapa kamu” dengan status {status}."
        )),
        Err(transport) => Err(format!("Tidak ada jawaban dari {base_url}. {transport}")),
    }
}

/// Listen for advertisements for `listen`, then stop.
fn browse(listen: Duration) -> Result<Vec<Heard>, String> {
    let daemon = ServiceDaemon::new().map_err(|error| {
        format!("Pencarian node di jaringan tidak bisa dimulai di komputer ini: {error}")
    })?;
    let events = daemon.browse(SERVICE_TYPE).map_err(|error| {
        let _ = daemon.shutdown();
        format!("Pencarian node di jaringan tidak bisa dimulai: {error}")
    })?;
    let deadline = Instant::now() + listen;
    // Keyed by the instance's full name, so the second answer from the same
    // node replaces the first rather than listing it twice.
    let mut heard: BTreeMap<String, Heard> = BTreeMap::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match events.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(service)) => {
                let mut addresses: Vec<IpAddr> = service
                    .get_addresses()
                    .iter()
                    .map(|address| address.to_ip_addr())
                    .filter(|address| !address.is_loopback() && !address.is_unspecified())
                    .collect();
                // IPv4 first: a URL with a scoped IPv6 literal is one a proxy
                // and a person both get wrong, and every shop LAN has IPv4.
                addresses.sort_by_key(|address| (!address.is_ipv4(), *address));
                addresses.dedup();
                heard.insert(
                    service.get_fullname().to_string(),
                    Heard {
                        host: service.get_hostname().trim_end_matches('.').to_string(),
                        port: service.get_port(),
                        addresses,
                        site: service.get_property_val_str("site").map(str::to_string),
                    },
                );
            }
            Ok(_) => {}
            // Timed out, or the daemon went away: either way, stop listening.
            Err(_) => break,
        }
    }
    let _ = daemon.stop_browse(SERVICE_TYPE);
    let _ = daemon.shutdown();
    Ok(heard.into_values().collect())
}

/// Try each address one advertisement gave until one answers as our node.
fn confirm(heard: &Heard) -> FoundNode {
    let mut bases: Vec<String> = heard
        .addresses
        .iter()
        .filter(|address| address.is_ipv4())
        .map(|address| format!("http://{address}:{}", heard.port))
        .collect();
    // No IPv4 at all: the name, and hope the machine resolves `.local`.
    if bases.is_empty() && !heard.host.is_empty() {
        bases.push(format!("http://{}:{}", heard.host, heard.port));
    }
    let mut problem = None;
    for base in &bases {
        match identify(base, CONFIRM) {
            Ok(identity) => {
                return FoundNode {
                    base_url: base.clone(),
                    host: heard.host.clone(),
                    identity: Some(identity),
                    advertised_site: heard.site.clone(),
                    problem: None,
                }
            }
            Err(why) => problem = Some(why),
        }
    }
    FoundNode {
        base_url: bases.into_iter().next().unwrap_or_default(),
        host: heard.host.clone(),
        identity: None,
        advertised_site: heard.site.clone(),
        problem: problem.or_else(|| Some("Node ini tidak mengumumkan alamat yang bisa dipakai.".into())),
    }
}

/// Listen, then confirm everything heard, in parallel — five nodes that each
/// take two seconds to refuse must not take ten.
fn find(listen: Duration) -> Result<Vec<FoundNode>, String> {
    let heard = browse(listen)?;
    let checked: Vec<FoundNode> = std::thread::scope(|scope| {
        let asks: Vec<_> = heard
            .iter()
            .map(|one| scope.spawn(move || confirm(one)))
            .collect();
        asks.into_iter().filter_map(|ask| ask.join().ok()).collect()
    });
    // One node, one row: a node on two networks is heard twice under one
    // origin. Confirmed nodes first, then what would not confirm.
    let mut seen = std::collections::BTreeSet::new();
    let mut found: Vec<FoundNode> = Vec::new();
    for node in checked.iter().filter(|node| node.identity.is_some()) {
        let origin = node
            .identity
            .as_ref()
            .map(|identity| identity.origin_id.clone())
            .unwrap_or_default();
        if seen.insert(origin) {
            found.push(node.clone());
        }
    }
    found.extend(checked.into_iter().filter(|node| node.identity.is_none()));
    Ok(found)
}

/// Look for the shop's node on the LAN. Takes about three seconds, off the
/// window's thread.
#[tauri::command]
pub async fn discover_nodes() -> Result<Vec<FoundNode>, String> {
    crate::edge::off_the_window(|| find(LISTEN)).await
}

/// Check a typed address the same way a discovered one is checked.
#[tauri::command]
pub async fn identify_node(base_url: String) -> Result<FoundNode, String> {
    crate::edge::off_the_window(move || {
        let base = normalise_base(&base_url)?;
        let identity = identify(&base, CONFIRM_TYPED)?;
        Ok(FoundNode {
            host: base
                .split_once("://")
                .map(|(_, rest)| rest.to_string())
                .unwrap_or_else(|| base.clone()),
            base_url: base,
            identity: Some(identity),
            advertised_site: None,
            problem: None,
        })
    })
    .await
}
