//! Where a person works, and since when.
//!
//! The reference this is ported from carries its own `StoreId`; here a posting
//! points at [`super::UnitId`] — a row of `unit`, which already covers
//! head office and the stores (the warehouse is a site of head office, not a
//! unit). A separate store identifier would be a
//! second answer to "where".
//!
//! Not to be confused with `edge_identity_assignment`, which is an access
//! grant: which till somebody may sign into. A person can hold five of those
//! and be posted to one unit, and an HR officer has a posting and no till
//! access at all.

use super::audit::Authorization;
use super::error::EmployeeError;
use super::ids::UnitId;
use chrono::NaiveDate;

/// One continuous posting to one unit. `to` is exclusive-open: `None` means
/// "still there".
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignmentSpan {
    unit_id: UnitId,
    from: NaiveDate,
    to: Option<NaiveDate>,
    authorization: Authorization,
}

impl AssignmentSpan {
    pub fn try_new(
        unit_id: UnitId,
        from: NaiveDate,
        to: Option<NaiveDate>,
        authorization: Authorization,
    ) -> Result<Self, EmployeeError> {
        if let Some(to) = to {
            if to < from {
                return Err(EmployeeError::AssignmentEndsBeforeStart { from, to });
            }
        }
        Ok(Self {
            unit_id,
            from,
            to,
            authorization,
        })
    }

    pub fn unit_id(&self) -> &UnitId {
        &self.unit_id
    }
    pub fn from(&self) -> NaiveDate {
        self.from
    }
    pub fn to(&self) -> Option<NaiveDate> {
        self.to
    }
    pub fn authorization(&self) -> &Authorization {
        &self.authorization
    }

    pub fn covers(&self, date: NaiveDate) -> bool {
        date >= self.from && self.to.is_none_or(|end| date <= end)
    }
}

/// Every posting for one person, kept non-overlapping.
///
/// Overlap is refused rather than merged: two open spans mean the person is in
/// two places at once, and every downstream "which store does this belong to"
/// question then has two answers and no way to choose.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct AssignmentTimeline {
    spans: Vec<AssignmentSpan>,
}

impl AssignmentTimeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spans(&self) -> &[AssignmentSpan] {
        &self.spans
    }

    pub fn push(&mut self, span: AssignmentSpan) -> Result<(), EmployeeError> {
        for existing in &self.spans {
            if let Some(on) = overlap(existing, &span) {
                return Err(EmployeeError::AssignmentOverlaps { on });
            }
        }
        self.spans.push(span);
        self.spans.sort_by_key(|span| span.from);
        Ok(())
    }

    /// Where the person was on a date, if anywhere.
    pub fn unit_on(&self, date: NaiveDate) -> Option<&UnitId> {
        self.spans
            .iter()
            .find(|span| span.covers(date))
            .map(|span| span.unit_id())
    }

    /// The current posting: the span with no end date, if there is one.
    pub fn current(&self) -> Option<&AssignmentSpan> {
        self.spans.iter().find(|span| span.to.is_none())
    }
}

/// The first date both spans cover, if they intersect.
fn overlap(a: &AssignmentSpan, b: &AssignmentSpan) -> Option<NaiveDate> {
    let start = a.from.max(b.from);
    let end = match (a.to, b.to) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    };
    match end {
        Some(end) if end < start => None,
        _ => Some(start),
    }
}
