//! The store server — a shop's node.
//!
//! `store run`, `store enroll --code K`, `store stage-code K`, `store
//! diagnose`, the Windows service commands and `store --version` are the one
//! command line both roles share (`edge/cli.rs`); this binary only says which
//! role it is. `dc` is the same program for the Gudang, and running `store`
//! with `INVENTORY_NODE_ROLE=DC` is the same thing again.

use inventory_backend::edge::{cli, EdgeRole};

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    cli::main(EdgeRole::Store)
}
