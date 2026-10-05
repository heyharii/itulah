//! The Gudang's server — the same node as `store`, for the warehouse.
//!
//! It used to be a second, smaller program: a router, an auth layer and a sync
//! agent, and none of the runtime every node needs. The deployed Gudang ran
//! *this* binary (`render.yaml`'s `dc` service, `deploy/edge/dc-edge.service`),
//! so its node never sent a heartbeat and the centre could not see it — which
//! silently stopped a shop's return from ever being announced to it. It now
//! runs the one runtime (`edge::node::run`) through the shared command line
//! (`edge/cli.rs`); the role is the only difference from `store`.

use inventory_backend::edge::{cli, EdgeRole};

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    cli::main(EdgeRole::Dc)
}
