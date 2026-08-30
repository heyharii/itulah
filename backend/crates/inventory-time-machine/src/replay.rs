//! The deterministic fold.
//!
//! [`apply`] is the only place in this crate that changes a [`WorldState`].
//! It reads no clock, allocates no ids, and consults nothing outside the event
//! and the state it is handed, so `replay(events) == replay(events)` holds by
//! construction rather than by test — the tests only keep it that way.

use crate::model::{
    Event, EventKind, Invariant, InvariantViolation, StateSource, SubjectState, UnitStatus,
    WorldState,
};
use thiserror::Error;

/// Structural problems with a *log*, as opposed to invariant violations, which
/// are problems with the world the log describes. A log that fails these
/// cannot be replayed at all, so they are errors rather than findings.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ReplayError {
    #[error("sequence numbers must strictly increase: {previous} is followed by {next}")]
    NonMonotonicSeq { previous: u64, next: u64 },
    #[error("duplicate sequence number {0}")]
    DuplicateSeq(u64),
}

/// Fold every event with `seq <= upto_seq` into a fresh world.
///
/// `upto_seq` of `None` means "the whole log". The events must already be
/// sorted and strictly increasing by `seq`; [`crate::Timeline::build`] checks
/// that once so the hot path does not have to.
pub fn replay(
    source: StateSource,
    events: &[Event],
    upto_seq: Option<u64>,
) -> Result<WorldState, ReplayError> {
    check_ordering(events)?;
    let mut world = WorldState::empty(source);
    for event in events {
        if upto_seq.is_some_and(|limit| event.seq > limit) {
            break;
        }
        apply(&mut world, event);
    }
    Ok(world)
}

/// Fold the first `count` events of `events` into a fresh world. Prefix length
/// rather than sequence number, which is what the binary search wants.
pub fn replay_prefix(
    source: StateSource,
    events: &[Event],
    count: usize,
) -> Result<WorldState, ReplayError> {
    check_ordering(events)?;
    let mut world = WorldState::empty(source);
    for event in events.iter().take(count) {
        apply(&mut world, event);
    }
    Ok(world)
}

pub(crate) fn check_ordering(events: &[Event]) -> Result<(), ReplayError> {
    let mut previous: Option<u64> = None;
    for event in events {
        if let Some(previous) = previous {
            if event.seq == previous {
                return Err(ReplayError::DuplicateSeq(event.seq));
            }
            if event.seq < previous {
                return Err(ReplayError::NonMonotonicSeq {
                    previous,
                    next: event.seq,
                });
            }
        }
        previous = Some(event.seq);
    }
    Ok(())
}

/// Fold one event into a world in place. Total: an event that makes no sense
/// for the current state produces an invariant violation, never a panic and
/// never a skipped event, because "the fold stopped early" is indistinguishable
/// from "the log ended" downstream.
pub fn apply(world: &mut WorldState, event: &Event) {
    let mut state = world
        .subjects
        .get(&event.subject)
        .cloned()
        .unwrap_or_else(|| SubjectState::empty(event.subject.clone()));
    let mut violations: Vec<InvariantViolation> = Vec::new();
    let payload = &event.payload;

    match event.kind {
        EventKind::Receive => {
            if let Some(location) = payload.location.clone() {
                state.location = Some(location);
            }
            // Receiving without a named holder means the receiving location
            // holds it; that is the only sensible reading and it keeps the
            // single-custody invariant satisfiable.
            state.custody = payload.custody.clone().or_else(|| state.location.clone());
            state.quantity += payload.quantity_delta.unwrap_or(1);
            state.status = UnitStatus::InStock;
        }
        EventKind::Move => {
            if let Some(location) = payload.location.clone() {
                state.location = Some(location);
            }
        }
        EventKind::CustodyTransfer => {
            check_custody_origin(&mut violations, event, &state);
            state.custody = payload.custody.clone();
            if let Some(location) = payload.location.clone() {
                state.location = Some(location);
            }
        }
        EventKind::Pick => {
            if let Some(location) = payload.location.clone() {
                state.location = Some(location);
            }
            state.status = UnitStatus::Picked;
        }
        EventKind::Pack => {
            if let Some(location) = payload.location.clone() {
                state.location = Some(location);
            }
            state.status = UnitStatus::Packed;
        }
        EventKind::Dispatch => {
            check_custody_origin(&mut violations, event, &state);
            // Dispatch hands the unit to a carrier: custody leaves the node.
            state.custody = payload.custody.clone();
            state.location = payload.location.clone().or(state.location);
            state.status = UnitStatus::Dispatched;
        }
        EventKind::CountObserved => {
            // A count is an assertion about reality, so it reconciles rather
            // than accumulates. This is the one kind whose effect does not
            // depend on the prior quantity.
            if let Some(observed) = payload.observed_quantity {
                state.quantity = observed;
            }
            if let Some(location) = payload.location.clone() {
                state.location = Some(location);
            }
        }
        EventKind::Adjust => {
            state.quantity += payload.quantity_delta.unwrap_or(0);
        }
        EventKind::StatusChange => {
            if let Some(status) = payload.status {
                state.status = status;
            }
        }
        EventKind::Void => {
            state.status = UnitStatus::Voided;
            state.quantity = 0;
            state.custody = None;
        }
    }

    if state.quantity < 0 {
        violations.push(InvariantViolation {
            seq: event.seq,
            subject: event.subject.clone(),
            invariant: Invariant::NonNegativeQuantity,
            detail: format!("quantity fell to {} after {}", state.quantity, event.kind),
        });
        // Left negative on purpose: clamping here would hide the divergence
        // that the negative quantity is evidence of.
    }

    state.version = match payload.version {
        Some(claimed) if claimed > state.version => claimed,
        Some(claimed) => {
            violations.push(InvariantViolation {
                seq: event.seq,
                subject: event.subject.clone(),
                invariant: Invariant::VersionMonotonic,
                detail: format!(
                    "source claimed version {claimed}, already at {}",
                    state.version
                ),
            });
            state.version + 1
        }
        None => state.version + 1,
    };
    state.last_seq = event.seq;

    world.subjects.insert(event.subject.clone(), state);
    world.violations.extend(violations);
    world.applied += 1;
    world.upto_seq = Some(event.seq);
}

/// A transfer that names where it came from must name the node that actually
/// holds the subject; otherwise two nodes both believe they have custody.
fn check_custody_origin(
    violations: &mut Vec<InvariantViolation>,
    event: &Event,
    state: &SubjectState,
) {
    let Some(claimed) = event.payload.from_custody.as_deref() else {
        return;
    };
    let held = state.custody.as_deref();
    if held != Some(claimed) {
        violations.push(InvariantViolation {
            seq: event.seq,
            subject: event.subject.clone(),
            invariant: Invariant::SingleCustody,
            detail: format!(
                "transfer claims origin `{claimed}` but custody is `{}`",
                held.unwrap_or("-")
            ),
        });
    }
}
