//! Letting the shop's devices find the server by name.
//!
//! The node advertises `_itulah-store._tcp` over mDNS with its site, version
//! and port, so a till, a tablet or a handheld on the same network can find it
//! without anybody typing an address — and so a replacement server (§5b) is
//! found the same way, with no device reconfigured. Advertising only; the
//! devices' side is theirs to build.

use std::collections::HashMap;

pub const SERVICE_TYPE: &str = "_itulah-store._tcp.local.";

/// Start advertising. The daemon lives as long as the process.
pub fn advertise(site_id: &str, origin_id: &str, port: u16) {
    let daemon = match mdns_sd::ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(error) => {
            tracing::warn!(%error, "mDNS unavailable: devices will need the server's address");
            return;
        }
    };
    let host = crate::sync::enrolment::MachineFacts::here().hostname;
    let host = if host.is_empty() { site_id.to_owned() } else { host };
    let properties: HashMap<String, String> = HashMap::from([
        ("site".to_owned(), site_id.to_owned()),
        ("origin".to_owned(), origin_id.to_owned()),
        ("version".to_owned(), env!("CARGO_PKG_VERSION").to_owned()),
    ]);
    let info = mdns_sd::ServiceInfo::new(
        SERVICE_TYPE,
        site_id,
        &format!("{}.local.", host.trim_end_matches(".local")),
        "",
        port,
        Some(properties),
    )
    .map(mdns_sd::ServiceInfo::enable_addr_auto);
    match info.and_then(|info| daemon.register(info)) {
        Ok(()) => {
            tracing::info!(site = site_id, port, "advertising on the shop network over mDNS");
            // Keep the daemon for the life of the process.
            std::mem::forget(daemon);
        }
        Err(error) => tracing::warn!(%error, "mDNS advertisement failed"),
    }
}
