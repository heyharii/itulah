//! The node says where it is on the shop's LAN.
//!
//! A till looking for its shop's server browses DNS-SD for
//! [`MDNS_SERVICE_TYPE`] (`_itulah-store._tcp`) and finds this node without
//! anybody typing an address (`STORE-SERVER-PLAN.md` §7). What it finds is a
//! **hint**: the till confirms every answer by asking
//! `GET /api/v1/node/identity` on the address it was given, and only that
//! answer is shown to the supervisor. Anything on the wifi can advertise the
//! service type; only our node answers the identity call the way it does, and
//! nothing a till does after that is decided by the advertisement.
//!
//! # What the TXT records carry
//!
//! Exactly what `node/identity` already says to anybody on the LAN: the
//! service word, the origin id, the site, the role, the version and the two
//! paths. No key, no user, no count — the same rule as the identity endpoint,
//! for the same reason: an advertisement is read by every machine on the
//! network, including the ones that are not ours.
//!
//! # Where it runs
//!
//! Only on a node listening beyond loopback. A developer's run on
//! `127.0.0.1:8082` advertises nothing: a till on another machine could not
//! reach that address anyway, and a laptop announcing a shop server to a café's
//! wifi is noise at best. `ITULAH_MDNS=off` switches it off on a node that
//! should stay quiet regardless.
//!
//! The responder runs on its own thread (`mdns-sd`), follows the machine's
//! addresses as they change, and says goodbye when the advertisement is
//! dropped — which [`run`](crate::edge::node::run) does when the node stops.

use std::net::SocketAddr;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceInfo};

use crate::edge::contracts::NodeContext;
use crate::sync::device::{JOIN_PATH, MDNS_SERVICE_TYPE, NODE_SERVICE};

/// Where a till confirms what it found.
pub const IDENTITY_PATH: &str = "/api/v1/node/identity";

/// A live advertisement. Dropping it withdraws the service from the LAN.
pub struct Advertisement {
    daemon: ServiceDaemon,
    fullname: String,
}

impl Drop for Advertisement {
    fn drop(&mut self) {
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

/// Advertise this node on the LAN, or say in the log why not.
///
/// Never fails the node: a shop whose router drops multicast still sells, and
/// its tills still take a typed address. `None` means nothing is advertised.
pub fn advertise(node: &NodeContext, bind: SocketAddr) -> Option<Advertisement> {
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
    let host = format!("{}.local.", host_label(&node.node_id));
    // The instance name is what a browser lists; the site is what a person
    // standing at a till recognises.
    let instance = format!("itulah {}", node.site_id);
    let role = node.role.to_string();
    let site = node.site_id.to_string();
    let properties = [
        ("service", NODE_SERVICE),
        ("origin", node.node_id.as_str()),
        ("site", site.as_str()),
        ("role", role.as_str()),
        ("version", env!("CARGO_PKG_VERSION")),
        ("identity", IDENTITY_PATH),
        ("join", JOIN_PATH),
    ];
    // No address given: the responder answers with whatever addresses the
    // machine has, and follows them when DHCP hands out new ones.
    let info = match ServiceInfo::new(
        MDNS_SERVICE_TYPE,
        &instance,
        &host,
        "",
        bind.port(),
        &properties[..],
    ) {
        Ok(info) => info.enable_addr_auto(),
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
        %host,
        port = bind.port(),
        "advertising this node on the LAN"
    );
    Some(Advertisement { daemon, fullname })
}
