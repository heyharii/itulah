//! How a sale is paid for.
//!
//! Re-exported rather than implemented. This file stood here and in the other
//! node's `domain::sales`, byte for byte the same, until somebody noticed that
//! payment arithmetic copied twice is the same hazard as rounding copied twice.
pub use crate::tender::*;
