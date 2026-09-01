//! Pure domain model for the Retail OS platform, one module per bounded
//! context. Everything is I/O-free: no database driver, no HTTP, no clock
//! beyond what callers pass in. Each module is a candidate to graduate into
//! its own crate once it grows (customers, finance, campaign land here too).

pub mod auth;
pub mod commercial;
pub mod inventory;
pub mod sales;

pub use auth::*;
pub use commercial::*;
pub use inventory::*;
pub use sales::*;
