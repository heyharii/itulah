//! The supply request's stage ladder: which rung may become which, and which
//! rung is the end.
//!
//! # Why this is a module and not a line in `domain::ga`
//!
//! It is deliberately separate from [`crate::cloud::domain::ga`] so it can be
//! written and reviewed beside the supplies stage without touching a file the
//! rest of GA is already open in. The shape and the reasoning are exactly the
//! ones `domain::ga::repair_may_move` keeps: a CHECK can say which STATES
//! exist, it cannot say which MOVE is legal, because that depends on where the
//! row has been. So the ladder is pure Rust, tested directly, and the writer
//! refuses an illegal move with a sentence naming both ends.
//!
//! # The ladder
//!
//! A request is ASKED FOR, then somebody with authority APPROVES it, then it is
//! ORDERED (the one moment a `po_reference` may appear), then it is RECEIVED,
//! and finally Finance has BILLED it. REJECTED is not a rung on that ladder: it
//! is a way OFF it, and only from REQUESTED — a request that was already
//! approved and ordered was decided, and reversing that after the goods were
//! asked for is a new request, not a rejection of the old one.
//!
//! BILLED is the end. A billed request is history: a correction to it is a
//! credit note from Finance, and this vocabulary has nowhere to put one.

/// The five rungs of the ladder, in order. REJECTED sits outside the flow and
/// is deliberately absent: it is an exit, not a stage.
pub const SUPPLY_STATUS_FLOW: &[&str] =
    &["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "BILLED"];

/// Whether a supply request may move from one state to the next.
///
/// Pure and deliberately database-free, so the whole matrix can be tested
/// directly rather than through a database that could only repeat it.
///
/// The legal moves are the sequential rungs, plus the one exit:
///
///   * REQUESTED → APPROVED
///   * REQUESTED → REJECTED (with a reason — enforced by the writer and the
///     column's own CHECK)
///   * APPROVED → ORDERED (the only move that may carry a `po_reference`)
///   * ORDERED → RECEIVED
///   * RECEIVED → BILLED
///
/// Everything else is refused, and the two terminal states — BILLED and
/// REJECTED — have no moves at all.
pub fn supply_may_move(from: &str, to: &str) -> bool {
    let from = from.trim().to_ascii_uppercase();
    let to = to.trim().to_ascii_uppercase();
    matches!(
        (from.as_str(), to.as_str()),
        ("REQUESTED", "APPROVED")
            | ("REQUESTED", "REJECTED")
            | ("APPROVED", "ORDERED")
            | ("ORDERED", "RECEIVED")
            | ("RECEIVED", "BILLED")
    )
}
