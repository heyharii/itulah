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

/// The state a checkout is in between "the shopper agreed" and "the sale is
/// written". Pure: no clock, no database, no terminal. See the module note for
/// why FINALIZING is committed BEFORE the first tender is attempted.
pub mod checkout;
/// The virtual business clock: one handle, three sources (system wall clock,
/// controlled, scaled). See `VIRTUAL-TIME-PLAN.md` and the module note.
pub mod clock;
pub mod cloud;
pub mod contract;
pub mod edge;
/// Splitting a refund back across the tenders that paid. Pure: no clock, no
/// database, no provider. See the module note for why it measures against
/// what each tender has LEFT rather than recomputing the original split.
pub mod refund;
pub mod reporting;
pub mod security;
pub mod sync;
/// What a line comes to once tax has had its say — one implementation for
/// both nodes, because it was two.
/// Tax, from the one crate that owns the rule.
///
/// Re-exported under its old path so every `crate::tax::…` call site keeps
/// working. It moved out of this binary and into `crates/tax` when the pricing
/// engine also needed it: the engine cannot depend on this crate — this crate
/// depends on the engine — so a shared rule had to live below both rather than
/// be copied into one of them. Copying it is what `retail-tax`'s own note says
/// went wrong last time.
pub use retail_tax as tax;
/// How a sale is paid for — one implementation for both nodes, because it
/// was two.
pub mod tender;
