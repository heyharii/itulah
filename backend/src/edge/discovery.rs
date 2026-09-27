//! The node says where it is on the shop's LAN.
//!
//! A till looking for its shop's server browses DNS-SD for
//! [`MDNS_SERVICE_TYPE`] (`_itulah-store._tcp`) and finds this node without
//! anybody typing an address (`STORE-SERVER-PLAN.md` §7) — and so do a tablet
//! and a handheld, and so is a replacement server (§5b) found, with no device
//! reconfigured. What a device finds is a **hint**: the till confirms every
//! answer by asking `GET /api/v1/node/identity` on the address it was given,
//! and only that answer is shown to the supervisor. Anything on the wifi can
//! advertise the service type; only our node answers the identity call the
//! way it does, and nothing a till does after that is decided by the
//! advertisement.
//!
//! # What the TXT records carry
//!
//! Exactly what `node/identity` already says to anybody on the LAN: the
//! service word, the origin id, the site id, the site's display code and name
//! (`code`, `name` — "C004-TOKO", "Bumiayu"), the role, the version and the
//! two paths. No key, no user, no count — the same rule as the identity
//! endpoint, for the same reason: an advertisement is read by every machine on
//! the network, including the ones that are not ours.
//!
//! The code and name are head office's words, from the site directory
//! (sqlite 0049, [`site_profile`]), which arrives with the auth policy and may
//! change while the node runs — or arrive for the first time minutes after it
//! started. So the advertisement reads the directory again every minute and
//! announces itself again when either changed. A node that has not heard yet
//! advertises without them, and a till shows the site id until it has.
//!
//! # Names that do not move
//!
//! The instance is `itulah {node id}` and the host is `{node id}.local`, not
//! the site's name and not the machine's: a till keeps both beside the address
//! it joined at, and asks for them again when that address stops answering
//! (`pos-desktop/src-tauri/src/discovery.rs`, `refind`). A name built from the
//! site's display name would change under it the day head office renamed the
//! shop; one built from the PC's hostname would change with the PC. A
//! replacement server enrolled under the same node id (a cold spare,
//! `STORE-SERVER-PLAN.md` §5b) answers to the same names.
//!
//! # Where it runs
//!
//! Only on a node listening beyond loopback. A developer's run on
//! `127.0.0.1:8082` advertises nothing: a till on another machine could not
//! reach that address anyway, and a laptop announcing a shop server to a café's
//! wifi is noise at best. `ITULAH_MDNS=off` switches it off on a node that
//! should stay quiet regardless.
//!
//! On Windows the responder needs UDP 5353 in: `store.exe install-service`
//! adds that rule beside the one for 8082 (`edge/winservice.rs`), private and
//! domain networks only.
//!
//! The responder runs on its own thread (`mdns-sd`), follows the machine's
//! addresses as they change, and says goodbye when the advertisement is
//! dropped — which [`run`](crate::edge::node::run) does when the node stops.

use std::net::SocketAddr;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceInfo};
use rusqlite::Connection;

use crate::edge::contracts::NodeContext;
use crate::edge::site_profile;
use crate::sync::device::{JOIN_PATH, MDNS_SERVICE_TYPE, NODE_SERVICE};

/// Where a till confirms what it found.
pub const IDENTITY_PATH: &str = "/api/v1/node/identity";

/// How often the advertisement looks at the site directory again. The policy
/// that carries it is renewed every twelve hours; a minute is so that a node
/// enrolled this morning is advertised by its shop's name before anybody at
/// the counter has finished unpacking the new till.
const REFRESH: Duration = Duration::from_secs(60);

/// What the site directory says about this node's own site, in the words the
/// TXT records carry. Both absent until head office has said.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct SiteWords {
    code: Option<String>,
    name: Option<String>,
}

fn site_words(connection: &Mutex<Connection>) -> SiteWords {
    let Ok(guard) = connection.lock() else {
        return SiteWords::default();
    };
    let tidy = |value: String| {
        let value = value.trim().to_string();
        (!value.is_empty()).then_some(value)
    };
    site_profile::own(&guard)
        .map(|site| SiteWords {
            code: site.code.and_then(tidy),
            name: tidy(site.name),
        })
        .unwrap_or_default()
}

/// A TXT value short enough for its record: a key and its value share one
/// 255-byte string, and a shop's name that did not fit would stop the whole
/// advertisement rather than lose its tail.
fn txt_value(value: &str) -> String {
    let mut end = value.len().min(200);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

/// A DNS label from the node's id: lowercase letters, digits and hyphens,
/// nothing else, at most 63 characters. `store-07-edge` stays as it is.
fn host_label(node_id: &str) -> String {
    let mut label: String = node_id
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    label = label.trim_matches('-').to_string();
    label.truncate(63);
    if label.is_empty() {
        "itulah-store".to_string()
    } else {
        label
    }
}

fn switched_off() -> bool {
    std::env::var("ITULAH_MDNS")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "off" | "0" | "false" | "no"
            )
        })
        .unwrap_or(false)
}

/// Everything about the advertisement that does not change while the node
/// runs.
struct Described {
    node: NodeContext,
    host: String,
    instance: String,
    port: u16,
}

impl Described {
    fn info(&self, site: &SiteWords) -> Result<ServiceInfo, mdns_sd::Error> {
        let mut properties: Vec<(&str, String)> = vec![
            ("service", NODE_SERVICE.to_string()),
            ("origin", self.node.node_id.clone()),
            ("site", self.node.site_id.to_string()),
            ("role", self.node.role.to_string()),
            ("version", env!("CARGO_PKG_VERSION").to_string()),
            ("identity", IDENTITY_PATH.to_string()),
            ("join", JOIN_PATH.to_string()),
        ];
        if let Some(code) = &site.code {
            properties.push(("code", txt_value(code)));
        }
        if let Some(name) = &site.name {
            properties.push(("name", txt_value(name)));
        }
        // No address given: the responder answers with whatever addresses the
        // machine has, and follows them when DHCP hands out new ones.
        ServiceInfo::new(
            MDNS_SERVICE_TYPE,
            &self.instance,
            &self.host,
            "",
            self.port,
            &properties[..],
        )
        .map(ServiceInfo::enable_addr_auto)
    }
}

/// A live advertisement. Dropping it withdraws the service from the LAN.
pub struct Advertisement {
    daemon: ServiceDaemon,
    fullname: String,
    /// Dropped to stop the refresher: its wait ends when the sender is gone.
    stop: Option<mpsc::Sender<()>>,
    refresher: Option<JoinHandle<()>>,
}

impl Drop for Advertisement {
    fn drop(&mut self) {
        // The refresher first, so it cannot announce the node again after the
        // goodbye below.
        drop(self.stop.take());
        if let Some(refresher) = self.refresher.take() {
            let _ = refresher.join();
        }
        // Say goodbye rather than let the record age out: a till browsing in
        // the next two minutes should not be offered a node that has stopped.
        // Waited for briefly, and only briefly — a node that is stopping has
        // better things to do than wait on a multicast socket.
        if let Ok(done) = self.daemon.unregister(&self.fullname) {
            let _ = done.recv_timeout(Duration::from_millis(500));
        }
        let _ = self.daemon.shutdown();
    }
}

/// Announce again whenever head office's words for this site change.
fn spawn_refresher(
    daemon: ServiceDaemon,
    described: Described,
    connection: Arc<Mutex<Connection>>,
    mut said: SiteWords,
    stop: mpsc::Receiver<()>,
) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("lan-advertisement".into())
        .spawn(move || loop {
            match stop.recv_timeout(REFRESH) {
                Err(RecvTimeoutError::Timeout) => {}
                // Asked to stop, or the advertisement is gone.
                Ok(()) | Err(RecvTimeoutError::Disconnected) => return,
            }
            let now = site_words(&connection);
            if now == said {
                continue;
            }
            // Registering the same instance again replaces its records; the
            // name stays, so nothing a till remembered goes stale.
            match described.info(&now).and_then(|info| daemon.register(info)) {
                Ok(()) => {
                    tracing::info!(
                        code = now.code.as_deref().unwrap_or(""),
                        name = now.name.as_deref().unwrap_or(""),
                        "the LAN advertisement now says what head office calls this site"
                    );
                    said = now;
                }
                Err(error) => {
                    tracing::warn!(%error, "the LAN advertisement could not be updated")
                }
            }
        })
        .map_err(
            |error| tracing::warn!(%error, "the LAN advertisement will not follow the site's name"),
        )
        .ok()
}

/// Advertise this node on the LAN, or say in the log why not.
///
/// Never fails the node: a shop whose router drops multicast still sells, and
/// its tills still take a typed address. `None` means nothing is advertised.
/// `connection` is the node's own database, read for the site directory.
pub fn advertise(
    node: &NodeContext,
    connection: Arc<Mutex<Connection>>,
    bind: SocketAddr,
) -> Option<Advertisement> {
    if switched_off() {
        tracing::info!("ITULAH_MDNS is off: this node is not advertised on the LAN");
        return None;
    }
    if bind.ip().is_loopback() {
        tracing::info!(%bind, "listening on loopback only: this node is not advertised on the LAN");
        return None;
    }
    let daemon = match ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(error) => {
            tracing::warn!(%error, "the LAN advertisement could not start; tills must be given this node's address");
            return None;
        }
    };
    let label = host_label(&node.node_id);
    let described = Described {
        node: node.clone(),
        host: format!("{label}.local."),
        // What a generic browser lists. Our till lists what the identity call
        // confirms — the site's code and name — and keeps this as a handle.
        instance: format!("itulah {label}"),
        port: bind.port(),
    };
    let site = site_words(&connection);
    let info = match described.info(&site) {
        Ok(info) => info,
        Err(error) => {
            tracing::warn!(%error, "the LAN advertisement could not be described");
            let _ = daemon.shutdown();
            return None;
        }
    };
    let fullname = info.get_fullname().to_string();
    if let Err(error) = daemon.register(info) {
        tracing::warn!(%error, "the LAN advertisement could not be registered");
        let _ = daemon.shutdown();
        return None;
    }
    tracing::info!(
        service = MDNS_SERVICE_TYPE,
        host = %described.host,
        port = bind.port(),
        code = site.code.as_deref().unwrap_or(""),
        "advertising this node on the LAN"
    );
    let (stop, stopped) = mpsc::channel();
    let refresher = spawn_refresher(daemon.clone(), described, connection, site, stopped);
    Some(Advertisement {
        daemon,
        fullname,
        stop: Some(stop),
        refresher,
    })
}
