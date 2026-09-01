// `queries.rs` builds a deeply nested report with one `json!`, which expands
// past the default 128-step macro limit. Raising it is the compiler's own
// suggested fix and changes no behaviour.
#![recursion_limit = "256"]

/// Resolve the bind address for a server process.
///
/// Local development keeps the loopback defaults, while managed container
/// platforms such as Render provide a `PORT` environment variable and require
/// the process to listen on all interfaces. An explicit `BIND_ADDR` always
/// wins so edge installations can remain loopback-only behind their tunnel.
pub fn bind_addr(default_port: u16) -> Result<std::net::SocketAddr, String> {
    let (raw, source) = match std::env::var("BIND_ADDR") {
        Ok(value) => (value, "BIND_ADDR"),
        Err(_) => match std::env::var("PORT") {
            Ok(port) => (format!("0.0.0.0:{port}"), "PORT"),
            Err(_) => (format!("127.0.0.1:{default_port}"), "default"),
        },
    };
    raw.parse()
        .map_err(|error| format!("invalid {source} value {raw:?}: {error}"))
}

pub mod cloud;
pub mod contract;
pub mod reporting;
pub mod edge;
pub mod security;
pub mod sync;
