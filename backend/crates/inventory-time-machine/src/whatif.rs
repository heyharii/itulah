//! Hypotheticals.
//!
//! "If the missing dispatch had landed, would the projection be right?" is the
//! question that turns a divergence report into a fix. The answer must not
//! cost anything: [`what_if`] takes the base world by reference, clones it, and
//! returns the clone. The caller's world is unchanged, so a session can try a
//! dozen hypotheses against the same moment in time without rebuilding it.

use crate::diverge::{diff_worlds, SubjectDelta};
use crate::model::{Event, InvariantViolation, WorldState};
use crate::replay::{apply, check_ordering, ReplayError};
use serde::{Deserialize, Serialize};

/// The result of a hypothetical: the world it produced and how that differs
/// from the world it started in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhatIf {
    /// The world after the hypothetical events. The base is *not* included —
    /// the caller already has it.
    pub after: WorldState,
    /// Subjects the hypothetical changed, base on the `expected` side.
    pub changes: Vec<SubjectDelta>,
    /// Invariant violations the hypothetical introduced (violations already
    /// present in the base are not repeated).
    pub new_violations: Vec<InvariantViolation>,
}

impl WhatIf {
    /// True when the hypothetical left the world exactly as it found it.
    pub fn is_noop(&self) -> bool {
        self.changes.is_empty()
    }
}

/// Apply hypothetical events to a cloned world and diff the result.
///
/// The events need not continue the base world's sequence numbers — a
/// hypothetical is often "what if this event had *also* been there" — but they
/// must be internally ordered, because the fold is order-dependent and a
/// caller who hands over an unsorted hypothesis is asking a question they did
/// not mean to ask.
pub fn what_if(base: &WorldState, hypothetical: &[Event]) -> Result<WhatIf, ReplayError> {
    check_ordering(hypothetical)?;

    let mut after = base.clone();
    let violations_before = after.violations.len();
    for event in hypothetical {
        apply(&mut after, event);
    }

    let new_violations = after.violations[violations_before..].to_vec();
    let changes = diff_worlds(base, &after);

    Ok(WhatIf {
        after,
        changes,
        new_violations,
    })
}

/// Two hypotheses against the same base, compared to each other rather than to
/// the base. Answers "does patching the feed and replaying the dispatch give
/// the same world as backfilling the count?".
pub fn compare_hypotheses(
    base: &WorldState,
    left: &[Event],
    right: &[Event],
) -> Result<Vec<SubjectDelta>, ReplayError> {
    let left = what_if(base, left)?;
    let right = what_if(base, right)?;
    Ok(diff_worlds(&left.after, &right.after))
}
