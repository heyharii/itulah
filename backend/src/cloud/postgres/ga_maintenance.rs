//! GA's upkeep side: the schedule, the walk-round, the repair, the swap and
//! the disposal.
//!
//! # The line this module keeps
//!
//! GA records the FACTS of a breakdown — which thing, where, what kind of
//! object, which supplier, what was estimated, what budget was approved and by
//! whom. GA never records the MONEY. The actual cost of a repair is the sum of
//! the POSTED bill lines that point at it (0370's `repair_id`), read back
//! here. Nothing here writes a journal or chooses an
//! account: the object (`AC`, `KENDARAAN`) is a CLASSIFICATION, and Finance's
//! `repair_expense` map (0366) turns it into one.
//!
//! # The ladders are Rust, the vocabulary is the database
//!
//! A CHECK can say which states exist; it cannot say which MOVE is legal,
//! because that depends on where the row has been. So a repair's ladder is
//! [`repair_may_move`] and the writer refuses an illegal move with
//! `AppError::Conflict` naming both ends. The CHECK stays as the last word on
//! the six words alone.
//!
//! # maker != checker, enforced where it is cheap and said where it is read
//!
//! The three acts that commit somebody's money — approving a repair's budget, a
//! replacement, a disposal — are refused when the approver is the person who
//! raised it. The database's own CHECK refuses the state (0365); this module
//! refuses it first, in a sentence that names the maker and the rule, because a
//! person reads a sentence and a constraint name is for the next developer.
//!
//! # There is no DELETE
//!
//! Brief §12: a record a bill pointed at cannot vanish. This module has no
//! delete at all — an inspection is append-only by trigger (0365), a repair is
//! CANCELLED rather than removed, and a thing leaves the register by being
//! disposed of. The act of removing something and keeping no record of it is
//! the one act this file deliberately cannot perform.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;
use crate::cloud::domain::{
    next_due_from, repair_may_move, repair_object_for_class, DISPOSAL_METHODS, INSPECTION_RESULTS,
    REPLACEMENT_STATUSES, REPAIR_STATUSES, TASK_INTERVAL_KINDS,
};

/// The first page of any of the five lists when a caller does not say.
pub const DEFAULT_GA_MAINTENANCE_LIMIT: i64 = 200;
/// And the most any of them will answer with however loudly a caller asks —
/// the same ceiling the registers keep, for the same reason.
pub const MAX_GA_MAINTENANCE_LIMIT: i64 = 1000;

/// What a caller asks one of the upkeep lists for.
///
/// Every list pages by a keyset on its own house order, so a screen walks the
/// whole book a page at a time rather than stopping silently at the first
/// `limit`. `site_id` narrows the rows AND the counts to one place — a shop's
/// till, or a location's own strip — in the query rather than after it, which
/// is what lets a narrowed read page honestly.
#[derive(Clone, Debug, Default)]
pub struct GaMaintenanceScope {
    /// Only the rows whose own row names this site. Ignored by the lists that
    /// have no site of their own (inspections, replacements).
    pub site_id: Option<String>,
    /// A `next_cursor` from the previous page, verbatim.
    pub cursor: Option<String>,
    pub limit: i64,
}

/// Where the previous page of an upkeep list stopped: the last row's id. Each
/// list's seek reads that row's sort key back out of its own table.
#[derive(Serialize, Deserialize)]
struct GaMaintenanceCursor {
    id: Uuid,
}

impl GaMaintenanceScope {
    fn page_size(&self) -> i64 {
        self.limit.clamp(1, MAX_GA_MAINTENANCE_LIMIT)
    }

    fn after(&self) -> Result<Option<Uuid>, AppError> {
        Ok(self
            .cursor
            .as_deref()
            .map(super::decode_cursor::<GaMaintenanceCursor>)
            .transpose()?
            .map(|cursor| cursor.id))
    }
}

/// The next page's cursor: the last row's id when the page came back full.
fn next_cursor_after(
    last: Option<Uuid>,
    len: usize,
    limit: i64,
) -> Result<Option<String>, AppError> {
    match last {
        Some(id) if len as i64 == limit => {
            Ok(Some(super::encode_cursor(&GaMaintenanceCursor { id })?))
        }
        _ => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Maintenance tasks
// ---------------------------------------------------------------------------

/// A standing promise to service something: one thing or one place, and the
/// interval the service comes due on.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaMaintenanceTask {
    pub task_id: Uuid,
    /// Exactly one of `asset_id` and `site_id` is present (0365).
    pub asset_id: Option<Uuid>,
    pub site_id: Option<String>,
    pub title: String,
    /// `DAYS`, `MONTHS` or `KM`.
    pub interval_kind: String,
    pub interval_value: i32,
    /// `None` for a KM task, and for a task nobody has scheduled a first date
    /// for.
    pub next_due: Option<NaiveDate>,
    pub contract_id: Option<Uuid>,
    pub supplier_id: Option<Uuid>,
    /// `ACTIVE` or `PAUSED`.
    pub status: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// A task as the list reads it: the record, plus the names its ids stand for.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaMaintenanceTaskRow {
    pub task_id: Uuid,
    pub asset_id: Option<Uuid>,
    /// The thing serviced, when the task is about one thing.
    pub asset_name: Option<String>,
    /// The place serviced, when the task is about one place.
    pub site_id: Option<String>,
    pub title: String,
    pub interval_kind: String,
    pub interval_value: i32,
    pub next_due: Option<NaiveDate>,
    pub contract_id: Option<Uuid>,
    /// The number ON THE PAPER of the contract the service is under.
    pub contract_number: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub status: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// Record a task from scratch.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordGaTaskRequest {
    pub asset_id: Option<Uuid>,
    pub site_id: Option<String>,
    pub title: String,
    pub interval_kind: String,
    pub interval_value: i32,
    /// Absent means the server computes the first due date from the interval
    /// and the business day; a KM task has none.
    pub next_due: Option<NaiveDate>,
    pub contract_id: Option<Uuid>,
    pub supplier_id: Option<Uuid>,
    pub notes: Option<String>,
}

/// What may be corrected about a task, in place.
///
/// Every field is optional and `None` leaves it alone. `next_due` cannot be
/// NULLED through here for the same reason 0360's window cannot: TypeScript
/// flattens `Option<Option<T>>` to `T | null`, and a caller that omitted the
/// field would be asking a different question from the one it thought it was
/// asking. Pausing and resuming is `status`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGaTaskRequest {
    pub title: Option<String>,
    pub interval_kind: Option<String>,
    pub interval_value: Option<i32>,
    pub next_due: Option<NaiveDate>,
    pub contract_id: Option<Uuid>,
    pub supplier_id: Option<Uuid>,
    /// `ACTIVE` or `PAUSED`.
    pub status: Option<String>,
    pub notes: Option<String>,
}

/// One value a GA maintenance filter can take, and how many rows would remain.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaMaintenanceFacet {
    pub value: String,
    /// What to draw, when it differs from the value (a site's name).
    pub label: Option<String>,
    pub count: i64,
}

/// The two things the task list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaMaintenanceTaskFacets {
    pub sites: Vec<GaMaintenanceFacet>,
    pub statuses: Vec<GaMaintenanceFacet>,
}

/// A page of the task list, and how big the whole answer is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaMaintenanceTaskPage {
    pub rows: Vec<GaMaintenanceTaskRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: GaMaintenanceTaskFacets,
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

/// One walk-round: what somebody found, on one day, about one thing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaInspection {
    pub inspection_id: Uuid,
    pub asset_id: Uuid,
    pub inspected_on: NaiveDate,
    pub inspected_by: String,
    /// `BAIK`, `PERHATIAN` or `RUSAK`.
    pub result: String,
    pub findings: String,
    pub task_id: Option<Uuid>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub version: i32,
}

/// An inspection as the list reads it: the record, plus the thing's name and
/// number.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaInspectionRow {
    pub inspection_id: Uuid,
    pub asset_id: Uuid,
    pub asset_name: String,
    pub asset_number: String,
    pub inspected_on: NaiveDate,
    pub inspected_by: String,
    pub result: String,
    pub findings: String,
    pub task_id: Option<Uuid>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub version: i32,
}

/// Write down what somebody found.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordGaInspectionRequest {
    pub asset_id: Uuid,
    pub inspected_on: NaiveDate,
    pub inspected_by: String,
    /// `BAIK`, `PERHATIAN` or `RUSAK`.
    pub result: String,
    pub findings: String,
    pub task_id: Option<Uuid>,
}

/// The one thing the inspection list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaInspectionFacets {
    pub results: Vec<GaMaintenanceFacet>,
}

/// A page of the inspection list.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaInspectionPage {
    pub rows: Vec<GaInspectionRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: GaInspectionFacets,
}

// ---------------------------------------------------------------------------
// Repairs
// ---------------------------------------------------------------------------

/// A breakdown GA records: what failed, what kind of object, which supplier,
/// and the estimate and budget the department signed off.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaRepair {
    pub repair_id: Uuid,
    pub site_id: String,
    pub asset_id: Option<Uuid>,
    /// The repair object (`AC`, `KENDARAAN`, ...); 0360's vocabulary.
    pub objek: String,
    pub title: String,
    pub supplier_id: Uuid,
    pub contract_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub inspection_id: Option<Uuid>,
    pub estimated_cost_minor: Option<i64>,
    pub approved_budget_minor: Option<i64>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub failure_at: NaiveDate,
    pub completed_at: Option<NaiveDate>,
    /// `OPEN`, `APPROVED`, `IN_PROGRESS`, `COMPLETED`, `CLOSED` or `CANCELLED`.
    pub status: String,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// A repair as GA reads it, with the actual cost read back from Finance.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaRepairRow {
    pub repair_id: Uuid,
    pub site_id: String,
    pub asset_id: Option<Uuid>,
    pub asset_name: Option<String>,
    pub objek: String,
    /// The client's own name for the object ("AC & refrigerator").
    pub objek_name: String,
    pub title: String,
    pub supplier_id: Uuid,
    pub supplier_name: String,
    pub contract_id: Option<Uuid>,
    pub contract_number: Option<String>,
    pub task_id: Option<Uuid>,
    pub inspection_id: Option<Uuid>,
    pub estimated_cost_minor: Option<i64>,
    pub approved_budget_minor: Option<i64>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub failure_at: NaiveDate,
    pub completed_at: Option<NaiveDate>,
    pub status: String,
    pub notes: Option<String>,
    /// Σ baris tagihan POSTED yang menunjuk perbaikan ini (0370's
    /// `supplier_invoice_expense_line.repair_id`). Dibaca saja dari Finance;
    /// tagihan yang ditahan tetap dihitung — hold bukan batal.
    pub actual_cost_minor: i64,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// Record a breakdown.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordGaRepairRequest {
    pub site_id: String,
    pub asset_id: Option<Uuid>,
    /// Absent means "derive it from the asset's class"; a person may override
    /// it, and MUST give it when there is no asset.
    pub objek: Option<String>,
    pub title: String,
    pub supplier_id: Uuid,
    pub contract_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub inspection_id: Option<Uuid>,
    pub estimated_cost_minor: Option<i64>,
    pub failure_at: NaiveDate,
    pub notes: Option<String>,
}

/// Correct what GA knows about a breakdown, in place.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGaRepairRequest {
    pub title: Option<String>,
    pub objek: Option<String>,
    pub supplier_id: Option<Uuid>,
    pub contract_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub inspection_id: Option<Uuid>,
    pub estimated_cost_minor: Option<i64>,
    pub failure_at: Option<NaiveDate>,
    pub completed_at: Option<NaiveDate>,
    pub notes: Option<String>,
}

/// Move a repair one rung up its ladder, or off it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveGaRepairRequest {
    /// The state to move to.
    pub to: String,
    /// A sentence appended to the notes, so the row says why it moved.
    pub note: Option<String>,
}

/// Approve the ceiling somebody may spend on a repair.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ApproveGaRepairRequest {
    pub approved_budget_minor: i64,
}

/// The three things the repair list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaRepairFacets {
    pub sites: Vec<GaMaintenanceFacet>,
    pub objects: Vec<GaMaintenanceFacet>,
    pub statuses: Vec<GaMaintenanceFacet>,
}

/// The four figures the repair book is managed by, counted over the WHOLE
/// book (within the scope's site) rather than over a page of it — a strip
/// that summed the rows on screen would change as somebody scrolled.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaRepairSummary {
    /// Repairs still at OPEN.
    pub open: i64,
    /// COMPLETED or CLOSED with a completion day in the last ninety days.
    pub done_recently: i64,
    /// Whose actual cost is above the approved budget, or the estimate where
    /// no budget was approved.
    pub over: i64,
    /// Σ actual cost of the repairs completed (or, not yet completed, failed)
    /// in `year`.
    pub actual_this_year_minor: i64,
    /// The business clock's year the figure above is for.
    pub year: i32,
}

/// A page of the repair list, with the actual-cost total over what it shows.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaRepairPage {
    pub rows: Vec<GaRepairRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: GaRepairFacets,
    /// Σ `actual_cost_minor` of the rows on this page — a read of Finance's
    /// side, never a copy of it.
    pub actual_cost_total_minor: i64,
    pub summary: GaRepairSummary,
}

// ---------------------------------------------------------------------------
// Replacements
// ---------------------------------------------------------------------------

/// A thing too far gone to repair, and the swap that replaces it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaReplacement {
    pub replacement_id: Uuid,
    pub old_asset_id: Uuid,
    pub new_asset_id: Option<Uuid>,
    pub repair_id: Option<Uuid>,
    pub reason: String,
    pub supplier_id: Option<Uuid>,
    /// `PROPOSED`, `APPROVED`, `PURCHASED`, `INSTALLED` or `CLOSED`.
    pub status: String,
    pub proposed_on: NaiveDate,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    /// Who moved it past `PROPOSED`; maker != checker.
    pub decided_by: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// A replacement as the list reads it: the two things and who supplied them.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaReplacementRow {
    pub replacement_id: Uuid,
    pub old_asset_id: Uuid,
    pub old_asset_name: String,
    pub new_asset_id: Option<Uuid>,
    pub new_asset_name: Option<String>,
    pub repair_id: Option<Uuid>,
    pub repair_title: Option<String>,
    pub reason: String,
    pub supplier_id: Option<Uuid>,
    pub supplier_name: Option<String>,
    pub status: String,
    pub proposed_on: NaiveDate,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub decided_by: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// Propose a replacement.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordGaReplacementRequest {
    pub old_asset_id: Uuid,
    pub repair_id: Option<Uuid>,
    pub reason: String,
    pub supplier_id: Option<Uuid>,
    pub proposed_on: NaiveDate,
}

/// Move a replacement one rung up its ladder. Moving to `INSTALLED` may name
/// the new asset, or let the server mint one from the old.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveGaReplacementRequest {
    pub to: String,
    pub new_asset_id: Option<Uuid>,
}

/// The one thing the replacement list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaReplacementFacets {
    pub statuses: Vec<GaMaintenanceFacet>,
}

/// A page of the replacement list.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaReplacementPage {
    pub rows: Vec<GaReplacementRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: GaReplacementFacets,
}

// ---------------------------------------------------------------------------
// Disposals
// ---------------------------------------------------------------------------

/// The request to let a thing go, and what Finance answered.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaDisposal {
    pub disposal_id: Uuid,
    pub asset_id: Uuid,
    /// `SOLD`, `SCRAPPED`, `DONATED` or `LOST`.
    pub method: String,
    pub proceeds_minor: Option<i64>,
    pub reason: String,
    pub requested_on: NaiveDate,
    /// `REQUESTED`, `APPROVED`, `POSTED` or `REJECTED`.
    pub status: String,
    /// Why Finance answered as it did, appended when the decision is made.
    pub notes: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    /// Finance, saat membukukan.
    pub closed_by: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// A disposal as the list reads it, with the thing's own name.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaDisposalRow {
    pub disposal_id: Uuid,
    pub asset_id: Uuid,
    pub asset_name: String,
    pub asset_number: String,
    pub site_id: String,
    pub method: String,
    pub proceeds_minor: Option<i64>,
    pub reason: String,
    pub requested_on: NaiveDate,
    pub status: String,
    pub notes: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub closed_by: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub updated_at: Option<DateTime<Utc>>,
    pub version: i32,
}

/// Ask to let a thing go.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RequestGaDisposalRequest {
    pub asset_id: Uuid,
    /// `SOLD`, `SCRAPPED`, `DONATED` or `LOST`.
    pub method: String,
    /// Only meaningful for `SOLD`; the database refuses a nonzero figure for
    /// anything else.
    pub proceeds_minor: Option<i64>,
    pub reason: String,
    pub requested_on: NaiveDate,
}

/// Finance's answer to a disposal request.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DecideGaDisposalRequest {
    pub approve: bool,
    /// A sentence appended to the notes, so the row says why.
    pub note: Option<String>,
}

/// The two things the disposal list can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaDisposalFacets {
    pub statuses: Vec<GaMaintenanceFacet>,
    pub methods: Vec<GaMaintenanceFacet>,
}

/// A page of the disposal list.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaDisposalPage {
    pub rows: Vec<GaDisposalRow>,
    pub total: i64,
    pub facets: GaDisposalFacets,
}

/// One repair object, its client name and the expense account it resolves to
/// (0360's table). The client draws its object picker from this.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaRepairObject {
    pub code: String,
    pub name: String,
    pub account_code: String,
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/// Blank text is nothing, and nothing is stored as NULL rather than as "".
fn nothing_if_blank(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|text| !text.is_empty())
}

/// The three interval units, in words, for a refusal.
fn assert_interval_kind(raw: &str) -> Result<String, AppError> {
    let word = raw.trim().to_ascii_uppercase();
    if TASK_INTERVAL_KINDS.contains(&word.as_str()) {
        return Ok(word);
    }
    Err(AppError::Validation(format!(
        "{word} is not a task interval; a schedule repeats every {}",
        TASK_INTERVAL_KINDS.join(", ")
    )))
}

/// The three inspection results, in words, for a refusal.
fn assert_inspection_result(raw: &str) -> Result<String, AppError> {
    let word = raw.trim().to_ascii_uppercase();
    if INSPECTION_RESULTS.contains(&word.as_str()) {
        return Ok(word);
    }
    Err(AppError::Validation(format!(
        "{word} is not an inspection result; somebody found it {}",
        INSPECTION_RESULTS.join(", ")
    )))
}

/// The four disposal methods, in words, for a refusal.
fn assert_disposal_method(raw: &str) -> Result<String, AppError> {
    let word = raw.trim().to_ascii_uppercase();
    if DISPOSAL_METHODS.contains(&word.as_str()) {
        return Ok(word);
    }
    Err(AppError::Validation(format!(
        "{word} is not a disposal method; a thing leaves by {}",
        DISPOSAL_METHODS.join(", ")
    )))
}

/// The repair object must be one of the eleven, and the refusal lists them.
async fn assert_repair_object(
    executor: impl sqlx::PgExecutor<'_>,
    raw: &str,
) -> Result<String, AppError> {
    let code = raw.trim().to_ascii_uppercase();
    // The whole list is read once rather than an EXISTS followed by a list: one
    // executor use, and the refusal already needs every name to print them.
    let names: Vec<String> = sqlx::query("SELECT code FROM ga_repair_object ORDER BY code")
        .fetch_all(executor)
        .await?
        .iter()
        .filter_map(|row| row.try_get::<String, _>("code").ok())
        .collect();
    if names.iter().any(|known| *known == code) {
        return Ok(code);
    }
    Err(AppError::Validation(format!(
        "{code} is not a repair object; a repair is one of: {}",
        names.join(", ")
    )))
}

/// An asset must be in the register; refused by name rather than by FK.
async fn require_asset(
    executor: impl sqlx::PgExecutor<'_>,
    asset_id: Uuid,
) -> Result<(), AppError> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM fixed_asset WHERE asset_id = $1)")
            .bind(asset_id)
            .fetch_one(executor)
            .await?;
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound("asset".into()))
    }
}

/// A site must be somewhere the estate has.
async fn require_site(executor: impl sqlx::PgExecutor<'_>, site_id: &str) -> Result<(), AppError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1)")
        .bind(site_id)
        .fetch_one(executor)
        .await?;
    if exists {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "{site_id} is not somewhere this estate has; name one of its own sites"
        )))
    }
}

/// A supplier must be in the register.
async fn require_supplier(
    executor: impl sqlx::PgExecutor<'_>,
    supplier_id: Uuid,
) -> Result<(), AppError> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM supplier WHERE supplier_id = $1)")
            .bind(supplier_id)
            .fetch_one(executor)
            .await?;
    if exists {
        Ok(())
    } else {
        Err(AppError::Validation(
            "the supplier named on this record is not in the register".into(),
        ))
    }
}

/// The class code and kind of one asset, for deriving its repair object.
async fn asset_class_of(
    executor: impl sqlx::PgExecutor<'_>,
    asset_id: Uuid,
) -> Result<(String, String), AppError> {
    let row = sqlx::query(
        "SELECT a.category_code, c.kind
           FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
          WHERE a.asset_id = $1",
    )
    .bind(asset_id)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| AppError::NotFound("asset".into()))?;
    Ok((row.try_get("category_code")?, row.try_get("kind")?))
}

/// The object a repair is for: the one given, or the one the asset's class says.
async fn resolve_repair_object(
    pool: &PgPool,
    given: Option<&str>,
    asset_id: Option<Uuid>,
) -> Result<String, AppError> {
    if let Some(code) = nothing_if_blank(given) {
        return assert_repair_object(pool, code).await;
    }
    let asset_id = asset_id.ok_or_else(|| {
        AppError::Validation(
            "a repair with no asset must say which object it is for (AC, BANGUNAN, ...)".into(),
        )
    })?;
    let (class_code, kind) = asset_class_of(pool, asset_id).await?;
    repair_object_for_class(&kind, &class_code)
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "the class {class_code} does not say which repair object its repairs are for; \
                 name one of the eleven objects"
            ))
        })
}

/// Append a sentence to a notes column, or leave it alone.
fn appended_note(existing: Option<String>, line: Option<&str>) -> Option<String> {
    let line = nothing_if_blank(line)?;
    Some(match existing.map(|text| text.trim().to_string()) {
        Some(text) if !text.is_empty() => format!("{text} {line}"),
        _ => line.to_string(),
    })
}

// ---------------------------------------------------------------------------
// Maintenance tasks
// ---------------------------------------------------------------------------

/// The task list's columns, shared by the page and the single read.
const GA_TASK_SELECT: &str = "SELECT t.task_id, t.asset_id, t.site_id, t.title, t.interval_kind,
        t.interval_value, t.next_due, t.contract_id, t.supplier_id, t.status, t.notes,
        t.created_by, t.created_at, t.updated_by, t.updated_at, t.version,
        a.name AS asset_name, c.contract_number
   FROM ga_maintenance_task t
   LEFT JOIN fixed_asset a ON a.asset_id = t.asset_id
   LEFT JOIN ga_contract c ON c.contract_id = t.contract_id";

fn to_task_row(row: &sqlx::postgres::PgRow) -> Result<GaMaintenanceTaskRow, AppError> {
    Ok(GaMaintenanceTaskRow {
        task_id: row.try_get("task_id")?,
        asset_id: row.try_get("asset_id")?,
        asset_name: row.try_get("asset_name")?,
        site_id: row.try_get("site_id")?,
        title: row.try_get("title")?,
        interval_kind: row.try_get("interval_kind")?,
        interval_value: row.try_get("interval_value")?,
        next_due: row.try_get("next_due")?,
        contract_id: row.try_get("contract_id")?,
        contract_number: row.try_get("contract_number")?,
        supplier_id: row.try_get("supplier_id")?,
        status: row.try_get("status")?,
        notes: row.try_get("notes")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

/// The task list, soonest due first, the undated last.
///
/// Paged by a keyset on `(next_due, title, task_id)` with an undated task's
/// day read as `infinity` — the same place `NULLS LAST` put it, spelled so a
/// row comparison can seek past it.
pub async fn ga_maintenance_task_page(
    pool: &PgPool,
    scope: GaMaintenanceScope,
) -> Result<GaMaintenanceTaskPage, AppError> {
    let limit = scope.page_size();
    let after = scope.after()?;
    let sql = format!(
        "{GA_TASK_SELECT}
          WHERE ($1::text IS NULL OR t.site_id = $1)
            AND ($2::uuid IS NULL
                 OR (COALESCE(t.next_due, 'infinity'::date), t.title, t.task_id) >
                    (SELECT COALESCE(x.next_due, 'infinity'::date), x.title, x.task_id
                       FROM ga_maintenance_task x WHERE x.task_id = $2))
          ORDER BY COALESCE(t.next_due, 'infinity'::date), t.title, t.task_id
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.site_id)
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let out = rows.iter().map(to_task_row).collect::<Result<Vec<_>, _>>()?;
    let next_cursor = next_cursor_after(out.last().map(|row| row.task_id), out.len(), limit)?;

    let facet_rows = sqlx::query(
        "WITH t AS (SELECT * FROM ga_maintenance_task WHERE $1::text IS NULL OR site_id = $1)
         SELECT 'site' AS kind, t.site_id AS value,
                (SELECT s.name FROM site s WHERE s.id = t.site_id) AS label,
                COUNT(*)::bigint AS n
           FROM t WHERE t.site_id IS NOT NULL GROUP BY t.site_id
          UNION ALL
         SELECT 'status', t.status, NULL::text, COUNT(*)::bigint
           FROM t GROUP BY t.status
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM t",
    )
    .bind(&scope.site_id)
    .fetch_all(pool)
    .await?;
    let mut facets = GaMaintenanceTaskFacets {
        sites: Vec::new(),
        statuses: Vec::new(),
    };
    let total = collect_facets(facet_rows, &mut [
        ("site", &mut facets.sites),
        ("status", &mut facets.statuses),
    ])?;
    Ok(GaMaintenanceTaskPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// One task, with the names its ids stand for.
pub async fn ga_maintenance_task(pool: &PgPool, task_id: Uuid) -> Result<GaMaintenanceTaskRow, AppError> {
    let sql = format!("{GA_TASK_SELECT} WHERE t.task_id = $1");
    let row = sqlx::query(&sql)
        .bind(task_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("maintenance task".into()))?;
    to_task_row(&row)
}

/// Put a standing service promise on the schedule.
///
/// Exactly one subject, and the first due date is computed when none is given —
/// a task with an interval and no date would never appear on the overview,
/// which is the only reason the interval exists.
pub async fn ga_maintenance_task_record(
    pool: &PgPool,
    request: &RecordGaTaskRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaMaintenanceTaskRow, AppError> {
    let title = request.title.trim();
    if title.is_empty() {
        return Err(AppError::Validation(
            "a task needs a title; it is the one line somebody reads on the schedule".into(),
        ));
    }
    let interval_kind = assert_interval_kind(&request.interval_kind)?;
    if request.interval_value <= 0 {
        return Err(AppError::Validation(
            "an interval is a positive number of days, months or kilometres".into(),
        ));
    }
    let site_id = nothing_if_blank(request.site_id.as_deref()).map(str::to_string);
    match (request.asset_id, site_id.as_deref()) {
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "a task is for one thing OR one place, not both".into(),
            ))
        }
        (None, None) => {
            return Err(AppError::Validation(
                "a task is for one thing or one place; name exactly one".into(),
            ))
        }
        (Some(asset_id), None) => require_asset(pool, asset_id).await?,
        (None, Some(site)) => require_site(pool, site).await?,
    }
    if let Some(supplier_id) = request.supplier_id {
        require_supplier(pool, supplier_id).await?;
    }

    // A date given is a decision; an absent one is computed from the interval
    // and the business day. KM has no date and stays null.
    let next_due = request
        .next_due
        .or_else(|| next_due_from(&interval_kind, request.interval_value, today));

    let row = sqlx::query(
        "INSERT INTO ga_maintenance_task
           (asset_id, site_id, title, interval_kind, interval_value, next_due,
            contract_id, supplier_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING task_id",
    )
    .bind(request.asset_id)
    .bind(site_id.as_deref())
    .bind(title)
    .bind(&interval_kind)
    .bind(request.interval_value)
    .bind(next_due)
    .bind(request.contract_id)
    .bind(request.supplier_id)
    .bind(nothing_if_blank(request.notes.as_deref()))
    .bind(actor)
    .fetch_one(pool)
    .await?;
    ga_maintenance_task(pool, row.try_get("task_id")?).await
}

/// Correct a task, or pause and resume it.
pub async fn ga_maintenance_task_update(
    pool: &PgPool,
    task_id: Uuid,
    request: &UpdateGaTaskRequest,
    actor: &str,
) -> Result<GaMaintenanceTaskRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT title, interval_kind, interval_value, status, notes
           FROM ga_maintenance_task WHERE task_id = $1 FOR UPDATE",
    )
    .bind(task_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("maintenance task".into()))?;

    let interval_kind = match request.interval_kind.as_deref() {
        Some(raw) => assert_interval_kind(raw)?,
        None => current.try_get("interval_kind")?,
    };
    let interval_value = match request.interval_value {
        Some(value) => {
            if value <= 0 {
                return Err(AppError::Validation(
                    "an interval is a positive number of days, months or kilometres".into(),
                ));
            }
            value
        }
        None => current.try_get("interval_value")?,
    };
    let status = match request.status.as_deref() {
        Some(raw) => {
            let word = raw.trim().to_ascii_uppercase();
            if word != "ACTIVE" && word != "PAUSED" {
                return Err(AppError::Validation(format!(
                    "{word} is not a task status; a schedule is ACTIVE or PAUSED"
                )));
            }
            word
        }
        None => current.try_get("status")?,
    };
    let title = match request.title.as_deref() {
        Some(raw) if raw.trim().is_empty() => {
            return Err(AppError::Validation(
                "a task needs a title; it is the one line somebody reads on the schedule".into(),
            ))
        }
        Some(raw) => raw.trim().to_string(),
        None => current.try_get("title")?,
    };

    sqlx::query(
        "UPDATE ga_maintenance_task
            SET title          = $2,
                interval_kind  = $3,
                interval_value = $4,
                next_due       = COALESCE($5, next_due),
                contract_id    = COALESCE($6, contract_id),
                supplier_id    = COALESCE($7, supplier_id),
                status         = $8,
                notes          = COALESCE($9, notes),
                updated_by     = $10,
                updated_at     = now(),
                version        = version + 1
          WHERE task_id = $1",
    )
    .bind(task_id)
    .bind(&title)
    .bind(&interval_kind)
    .bind(interval_value)
    .bind(request.next_due)
    .bind(request.contract_id)
    .bind(request.supplier_id)
    .bind(&status)
    .bind(request.notes.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_maintenance_task(pool, task_id).await
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

const GA_INSPECTION_SELECT: &str = "SELECT i.inspection_id, i.asset_id, i.inspected_on, i.inspected_by,
        i.result, i.findings, i.task_id, i.recorded_by, i.recorded_at, i.version,
        a.name AS asset_name, a.asset_number
   FROM ga_inspection i
   JOIN fixed_asset a ON a.asset_id = i.asset_id";

fn to_inspection_row(row: &sqlx::postgres::PgRow) -> Result<GaInspectionRow, AppError> {
    Ok(GaInspectionRow {
        inspection_id: row.try_get("inspection_id")?,
        asset_id: row.try_get("asset_id")?,
        asset_name: row.try_get("asset_name")?,
        asset_number: row.try_get("asset_number")?,
        inspected_on: row.try_get("inspected_on")?,
        inspected_by: row.try_get("inspected_by")?,
        result: row.try_get("result")?,
        findings: row.try_get("findings")?,
        task_id: row.try_get("task_id")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
        version: row.try_get("version")?,
    })
}

/// The walk-round list, newest inspection first.
///
/// Paged by a keyset on `(inspected_on, recorded_at, inspection_id)`, all
/// descending. The scope's site is ignored: an inspection is of an asset and
/// carries no site of its own.
pub async fn ga_inspection_page(
    pool: &PgPool,
    scope: GaMaintenanceScope,
) -> Result<GaInspectionPage, AppError> {
    let limit = scope.page_size();
    let after = scope.after()?;
    let sql = format!(
        "{GA_INSPECTION_SELECT}
          WHERE $1::uuid IS NULL
             OR (i.inspected_on, i.recorded_at, i.inspection_id) <
                (SELECT x.inspected_on, x.recorded_at, x.inspection_id
                   FROM ga_inspection x WHERE x.inspection_id = $1)
          ORDER BY i.inspected_on DESC, i.recorded_at DESC, i.inspection_id DESC
          LIMIT $2"
    );
    let rows = sqlx::query(&sql)
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let out = rows
        .iter()
        .map(to_inspection_row)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = next_cursor_after(out.last().map(|row| row.inspection_id), out.len(), limit)?;

    let facet_rows = sqlx::query(
        "SELECT 'result' AS kind, i.result AS value, NULL::text AS label, COUNT(*)::bigint AS n
           FROM ga_inspection i GROUP BY i.result
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM ga_inspection",
    )
    .fetch_all(pool)
    .await?;
    let mut facets = GaInspectionFacets {
        results: Vec::new(),
    };
    let total = collect_facets(facet_rows, &mut [("result", &mut facets.results)])?;
    Ok(GaInspectionPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// One inspection.
pub async fn ga_inspection(pool: &PgPool, inspection_id: Uuid) -> Result<GaInspectionRow, AppError> {
    let sql = format!("{GA_INSPECTION_SELECT} WHERE i.inspection_id = $1");
    let row = sqlx::query(&sql)
        .bind(inspection_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("inspection".into()))?;
    to_inspection_row(&row)
}

/// Write down what somebody found, and move any task it answers.
///
/// An inspection is append-only: there is no update, and a mistake is corrected
/// by another inspection rather than by editing this one.
///
/// When the inspection answers a scheduled task, the task's `next_due` advances
/// from the day it was actually inspected — the service happened, so the next
/// one is counted from then, not from the date the schedule had hoped for.
pub async fn ga_inspection_record(
    pool: &PgPool,
    request: &RecordGaInspectionRequest,
    actor: &str,
) -> Result<GaInspectionRow, AppError> {
    let result = assert_inspection_result(&request.result)?;
    if request.findings.trim().is_empty() {
        return Err(AppError::Validation(
            "an inspection says what was found; an empty finding is not evidence".into(),
        ));
    }
    if request.inspected_by.trim().is_empty() {
        return Err(AppError::Validation(
            "an inspection says who looked; the name is the evidence".into(),
        ));
    }

    let mut tx = pool.begin().await?;
    require_asset(&mut *tx, request.asset_id).await?;

    let row = sqlx::query(
        "INSERT INTO ga_inspection
           (asset_id, inspected_on, inspected_by, result, findings, task_id, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING inspection_id",
    )
    .bind(request.asset_id)
    .bind(request.inspected_on)
    .bind(request.inspected_by.trim())
    .bind(&result)
    .bind(request.findings.trim())
    .bind(request.task_id)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    let inspection_id: Uuid = row.try_get("inspection_id")?;

    if let Some(task_id) = request.task_id {
        let task = sqlx::query(
            "SELECT interval_kind, interval_value FROM ga_maintenance_task
              WHERE task_id = $1 FOR UPDATE",
        )
        .bind(task_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("maintenance task".into()))?;
        let kind: String = task.try_get("interval_kind")?;
        let value: i32 = task.try_get("interval_value")?;
        if let Some(next) = next_due_from(&kind, value, request.inspected_on) {
            sqlx::query(
                "UPDATE ga_maintenance_task
                    SET next_due = $2, updated_by = $3, updated_at = now(), version = version + 1
                  WHERE task_id = $1",
            )
            .bind(task_id)
            .bind(next)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    ga_inspection(pool, inspection_id).await
}

// ---------------------------------------------------------------------------
// Repairs
// ---------------------------------------------------------------------------

/// The billed total for a repair, as a correlated subquery over `r`: POSTED
/// bill lines that point at the repair (0370's `repair_id`).
fn repair_actual_cost_select() -> &'static str {
    "(SELECT COALESCE(sum(bl.amount_minor), 0)::bigint
        FROM supplier_invoice_expense_line bl
        JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
       WHERE bl.repair_id = r.repair_id AND si.status = 'POSTED')"
}

fn to_repair_row(row: &sqlx::postgres::PgRow) -> Result<GaRepairRow, AppError> {
    Ok(GaRepairRow {
        repair_id: row.try_get("repair_id")?,
        site_id: row.try_get("site_id")?,
        asset_id: row.try_get("asset_id")?,
        asset_name: row.try_get("asset_name")?,
        objek: row.try_get("objek")?,
        objek_name: row.try_get("objek_name")?,
        title: row.try_get("title")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        contract_id: row.try_get("contract_id")?,
        contract_number: row.try_get("contract_number")?,
        task_id: row.try_get("task_id")?,
        inspection_id: row.try_get("inspection_id")?,
        estimated_cost_minor: row.try_get("estimated_cost_minor")?,
        approved_budget_minor: row.try_get("approved_budget_minor")?,
        approved_by: row.try_get("approved_by")?,
        approved_at: row.try_get("approved_at")?,
        failure_at: row.try_get("failure_at")?,
        completed_at: row.try_get("completed_at")?,
        status: row.try_get("status")?,
        notes: row.try_get("notes")?,
        actual_cost_minor: row.try_get("actual_cost_minor")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

/// The repair list, most recent failure first.
///
/// The actual cost rides the page and nothing else, exactly as the asset
/// register's acquisition trail does: the aggregate is a correlated subquery ON
/// THE PAGE, where the LIMIT has already cut the list down. Paged by a keyset
/// on `(failure_at, repair_id)`, both descending. The summary strip's figures
/// are counted over the whole book in the scope, as of `today`.
pub async fn ga_repair_page(
    pool: &PgPool,
    scope: GaMaintenanceScope,
    today: NaiveDate,
) -> Result<GaRepairPage, AppError> {
    let limit = scope.page_size();
    let after = scope.after()?;
    let actual = repair_actual_cost_select();
    let sql = format!(
        "SELECT r.repair_id, r.site_id, r.asset_id, r.objek, r.title, r.supplier_id,
                r.contract_id, r.task_id, r.inspection_id, r.estimated_cost_minor,
                r.approved_budget_minor, r.approved_by, r.approved_at, r.failure_at,
                r.completed_at, r.status, r.notes, r.created_by, r.created_at,
                r.updated_by, r.updated_at, r.version,
                o.name AS objek_name, a.name AS asset_name, s.name AS supplier_name,
                c.contract_number, {actual} AS actual_cost_minor
           FROM ga_repair r
           JOIN ga_repair_object o ON o.code = r.objek
           LEFT JOIN fixed_asset a ON a.asset_id = r.asset_id
           JOIN supplier s ON s.supplier_id = r.supplier_id
           LEFT JOIN ga_contract c ON c.contract_id = r.contract_id
          WHERE ($1::text IS NULL OR r.site_id = $1)
            AND ($2::uuid IS NULL
                 OR (r.failure_at, r.repair_id) <
                    (SELECT x.failure_at, x.repair_id FROM ga_repair x WHERE x.repair_id = $2))
          ORDER BY r.failure_at DESC, r.repair_id DESC
          LIMIT $3"
    );
    let rows = sqlx::query(&sql)
        .bind(&scope.site_id)
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let out = rows.iter().map(to_repair_row).collect::<Result<Vec<_>, _>>()?;
    let actual_cost_total_minor = out.iter().map(|row| row.actual_cost_minor).sum();
    let next_cursor = next_cursor_after(out.last().map(|row| row.repair_id), out.len(), limit)?;

    let facet_rows = sqlx::query(
        "WITH r AS (SELECT * FROM ga_repair WHERE $1::text IS NULL OR site_id = $1)
         SELECT 'site' AS kind, r.site_id AS value,
                (SELECT s.name FROM site s WHERE s.id = r.site_id) AS label,
                COUNT(*)::bigint AS n
           FROM r GROUP BY r.site_id
          UNION ALL
         SELECT 'object', r.objek, MIN(o.name), COUNT(*)::bigint
           FROM r JOIN ga_repair_object o ON o.code = r.objek
          GROUP BY r.objek
          UNION ALL
         SELECT 'status', r.status, NULL::text, COUNT(*)::bigint
           FROM r GROUP BY r.status
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM r",
    )
    .bind(&scope.site_id)
    .fetch_all(pool)
    .await?;
    let mut facets = GaRepairFacets {
        sites: Vec::new(),
        objects: Vec::new(),
        statuses: Vec::new(),
    };
    let total = collect_facets(facet_rows, &mut [
        ("site", &mut facets.sites),
        ("object", &mut facets.objects),
        ("status", &mut facets.statuses),
    ])?;
    let summary = ga_repair_summary(pool, scope.site_id.as_deref(), today).await?;
    Ok(GaRepairPage {
        rows: out,
        next_cursor,
        total,
        facets,
        actual_cost_total_minor,
        summary,
    })
}

/// The repair book's strip, over every repair in the site (or the estate).
///
/// The actual cost is the same correlated read the page uses, run over the
/// whole book here — the book is small, and a strip that summed only the
/// loaded page would be a figure about the scroll position.
async fn ga_repair_summary(
    pool: &PgPool,
    site_id: Option<&str>,
    today: NaiveDate,
) -> Result<GaRepairSummary, AppError> {
    let actual = repair_actual_cost_select();
    let sql = format!(
        "SELECT
             COUNT(*) FILTER (WHERE r.status = 'OPEN') AS open,
             COUNT(*) FILTER (WHERE r.status IN ('COMPLETED', 'CLOSED')
                                AND r.completed_at >= $2::date - 90) AS done_recently,
             COUNT(*) FILTER (WHERE cost.actual >
                                COALESCE(r.approved_budget_minor, r.estimated_cost_minor)) AS over_count,
             COALESCE(SUM(cost.actual) FILTER (
                 WHERE cost.actual > 0
                   AND EXTRACT(YEAR FROM COALESCE(r.completed_at, r.failure_at))
                     = EXTRACT(YEAR FROM $2::date)), 0)::bigint AS actual_this_year
           FROM ga_repair r
           CROSS JOIN LATERAL (SELECT {actual} AS actual) cost
          WHERE $1::text IS NULL OR r.site_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(site_id)
        .bind(today)
        .fetch_one(pool)
        .await?;
    Ok(GaRepairSummary {
        open: row.try_get("open")?,
        done_recently: row.try_get("done_recently")?,
        over: row.try_get("over_count")?,
        actual_this_year_minor: row.try_get("actual_this_year")?,
        year: chrono::Datelike::year(&today),
    })
}

/// One repair, with the object's name and Finance's billed total.
pub async fn ga_repair(pool: &PgPool, repair_id: Uuid) -> Result<GaRepairRow, AppError> {
    let actual = repair_actual_cost_select();
    let sql = format!(
        "SELECT r.repair_id, r.site_id, r.asset_id, r.objek, r.title, r.supplier_id,
                r.contract_id, r.task_id, r.inspection_id, r.estimated_cost_minor,
                r.approved_budget_minor, r.approved_by, r.approved_at, r.failure_at,
                r.completed_at, r.status, r.notes, r.created_by, r.created_at,
                r.updated_by, r.updated_at, r.version,
                o.name AS objek_name, a.name AS asset_name, s.name AS supplier_name,
                c.contract_number, {actual} AS actual_cost_minor
           FROM ga_repair r
           JOIN ga_repair_object o ON o.code = r.objek
           LEFT JOIN fixed_asset a ON a.asset_id = r.asset_id
           JOIN supplier s ON s.supplier_id = r.supplier_id
           LEFT JOIN ga_contract c ON c.contract_id = r.contract_id
          WHERE r.repair_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(repair_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("repair".into()))?;
    to_repair_row(&row)
}

/// Record a breakdown.
pub async fn ga_repair_record(
    pool: &PgPool,
    request: &RecordGaRepairRequest,
    actor: &str,
) -> Result<GaRepairRow, AppError> {
    let site_id = request.site_id.trim();
    if site_id.is_empty() {
        return Err(AppError::Validation(
            "a repair happens somewhere; name the site".into(),
        ));
    }
    if request.title.trim().is_empty() {
        return Err(AppError::Validation(
            "a repair needs a title; it is the one line somebody reads on the list".into(),
        ));
    }
    if request.estimated_cost_minor.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "an estimate is what the repair is expected to cost; a negative one is not".into(),
        ));
    }
    require_site(pool, site_id).await?;
    require_supplier(pool, request.supplier_id).await?;
    if let Some(asset_id) = request.asset_id {
        require_asset(pool, asset_id).await?;
    }
    let objek = resolve_repair_object(pool, request.objek.as_deref(), request.asset_id).await?;

    let row = sqlx::query(
        "INSERT INTO ga_repair
           (site_id, asset_id, objek, title, supplier_id, contract_id, task_id,
            inspection_id, estimated_cost_minor, failure_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING repair_id",
    )
    .bind(site_id)
    .bind(request.asset_id)
    .bind(&objek)
    .bind(request.title.trim())
    .bind(request.supplier_id)
    .bind(request.contract_id)
    .bind(request.task_id)
    .bind(request.inspection_id)
    .bind(request.estimated_cost_minor)
    .bind(request.failure_at)
    .bind(nothing_if_blank(request.notes.as_deref()))
    .bind(actor)
    .fetch_one(pool)
    .await?;
    ga_repair(pool, row.try_get("repair_id")?).await
}

/// Correct what GA knows about a breakdown.
///
/// Refused once the repair is CLOSED: a closed repair is history, and a
/// correction to it is a new repair. Everything else is re-validated against
/// what is already there, not against the delta.
pub async fn ga_repair_update(
    pool: &PgPool,
    repair_id: Uuid,
    request: &UpdateGaRepairRequest,
    actor: &str,
) -> Result<GaRepairRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT title, objek, supplier_id, contract_id, task_id, inspection_id,
                estimated_cost_minor, failure_at, completed_at, notes, status
           FROM ga_repair WHERE repair_id = $1 FOR UPDATE",
    )
    .bind(repair_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("repair".into()))?;
    if current.try_get::<String, _>("status")? == "CLOSED" {
        return Err(AppError::Conflict(
            "this repair is closed; a closed repair is history, so correct it with a new one"
                .into(),
        ));
    }

    let title = match request.title.as_deref() {
        Some(raw) if raw.trim().is_empty() => {
            return Err(AppError::Validation(
                "a repair needs a title; it is the one line somebody reads on the list".into(),
            ))
        }
        Some(raw) => raw.trim().to_string(),
        None => current.try_get("title")?,
    };
    let objek = match request.objek.as_deref() {
        Some(raw) => assert_repair_object(&mut *tx, raw).await?,
        None => current.try_get("objek")?,
    };
    let supplier_id = match request.supplier_id {
        Some(id) => {
            require_supplier(&mut *tx, id).await?;
            id
        }
        None => current.try_get("supplier_id")?,
    };
    let estimated_cost_minor = match request.estimated_cost_minor {
        Some(value) => {
            if value < 0 {
                return Err(AppError::Validation(
                    "an estimate is what the repair is expected to cost; a negative one is not"
                        .into(),
                ));
            }
            Some(value)
        }
        None => current.try_get("estimated_cost_minor")?,
    };

    sqlx::query(
        "UPDATE ga_repair
            SET title                = $2,
                objek                = $3,
                supplier_id          = $4,
                contract_id          = COALESCE($5, contract_id),
                task_id              = COALESCE($6, task_id),
                inspection_id        = COALESCE($7, inspection_id),
                estimated_cost_minor = $8,
                failure_at           = COALESCE($9, failure_at),
                completed_at         = COALESCE($10, completed_at),
                notes                = COALESCE($11, notes),
                updated_by           = $12,
                updated_at           = now(),
                version              = version + 1
          WHERE repair_id = $1",
    )
    .bind(repair_id)
    .bind(&title)
    .bind(&objek)
    .bind(supplier_id)
    .bind(request.contract_id)
    .bind(request.task_id)
    .bind(request.inspection_id)
    .bind(estimated_cost_minor)
    .bind(request.failure_at)
    .bind(request.completed_at)
    .bind(request.notes.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_repair(pool, repair_id).await
}

/// Move a repair one rung up its ladder, or off it.
///
/// The move is checked by [`repair_may_move`]; anything else is a Conflict that
/// names both ends. Moving to APPROVED by the person who raised the repair is
/// refused — approving is the second pair of eyes.
pub async fn ga_repair_move(
    pool: &PgPool,
    repair_id: Uuid,
    request: &MoveGaRepairRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaRepairRow, AppError> {
    let to = request.to.trim().to_ascii_uppercase();
    if !REPAIR_STATUSES.contains(&to.as_str()) {
        return Err(AppError::Validation(format!(
            "{to} is not a repair state; a repair is one of: {}",
            REPAIR_STATUSES.join(", ")
        )));
    }
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT status, created_by, notes FROM ga_repair WHERE repair_id = $1 FOR UPDATE",
    )
    .bind(repair_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("repair".into()))?;
    let from: String = current.try_get("status")?;
    let maker: String = current.try_get("created_by")?;

    if !repair_may_move(&from, &to) {
        return Err(AppError::Conflict(format!(
            "a {from} repair does not become {to}; the ladder is OPEN -> APPROVED -> \
             IN_PROGRESS -> COMPLETED -> CLOSED, and CANCELLED comes off the first three"
        )));
    }
    if to == "APPROVED" && maker == actor {
        return Err(AppError::Conflict(format!(
            "a repair cannot be approved by {actor}, who raised it; approving a repair's budget \
             is a second person's act (maker != checker)"
        )));
    }

    let note = format!("{from} -> {to} oleh {actor} ({today})");
    let note = match nothing_if_blank(request.note.as_deref()) {
        Some(extra) => format!("{note}: {extra}"),
        None => note,
    };
    let notes = appended_note(current.try_get("notes")?, Some(&note));

    sqlx::query(
        "UPDATE ga_repair
            SET status       = $2,
                completed_at = CASE WHEN $2 = 'COMPLETED' THEN COALESCE(completed_at, $3)
                                    ELSE completed_at END,
                notes        = $4,
                updated_by   = $5,
                updated_at   = now(),
                version      = version + 1
          WHERE repair_id = $1",
    )
    .bind(repair_id)
    .bind(&to)
    .bind(today)
    .bind(notes.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_repair(pool, repair_id).await
}

/// Approve the ceiling somebody may spend on a repair.
///
/// The maker cannot approve their own: a budget is one person's estimate and
/// another's permission, and the CHECK in 0365 refuses the row either way. The
/// duplicate refusal here is the readable one.
pub async fn ga_repair_approve_budget(
    pool: &PgPool,
    repair_id: Uuid,
    request: &ApproveGaRepairRequest,
    actor: &str,
) -> Result<GaRepairRow, AppError> {
    if request.approved_budget_minor < 0 {
        return Err(AppError::Validation(
            "an approved budget is a ceiling, and a negative ceiling is not one".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT status, created_by FROM ga_repair WHERE repair_id = $1 FOR UPDATE",
    )
    .bind(repair_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("repair".into()))?;
    let status: String = current.try_get("status")?;
    let maker: String = current.try_get("created_by")?;
    if maker == actor {
        return Err(AppError::Conflict(format!(
            "a repair's budget cannot be approved by {actor}, who raised it; maker != checker"
        )));
    }
    if status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "a {status} repair has no budget left to approve; a budget is approved while the \
             repair is OPEN"
        )));
    }

    sqlx::query(
        "UPDATE ga_repair
            SET approved_budget_minor = $2,
                approved_by           = $3,
                approved_at           = now(),
                status                = 'APPROVED',
                updated_by            = $3,
                updated_at            = now(),
                version               = version + 1
          WHERE repair_id = $1",
    )
    .bind(repair_id)
    .bind(request.approved_budget_minor)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_repair(pool, repair_id).await
}

// ---------------------------------------------------------------------------
// Replacements
// ---------------------------------------------------------------------------

const GA_REPLACEMENT_SELECT: &str = "SELECT p.replacement_id, p.old_asset_id, p.new_asset_id, p.repair_id,
        p.reason, p.supplier_id, p.status, p.proposed_on, p.approved_by, p.approved_at,
        p.decided_by, p.created_by, p.created_at, p.updated_by, p.updated_at, p.version,
        old.name AS old_asset_name, new.name AS new_asset_name, s.name AS supplier_name,
        r.title AS repair_title
   FROM ga_replacement p
   JOIN fixed_asset old ON old.asset_id = p.old_asset_id
   LEFT JOIN fixed_asset new ON new.asset_id = p.new_asset_id
   LEFT JOIN supplier s ON s.supplier_id = p.supplier_id
   LEFT JOIN ga_repair r ON r.repair_id = p.repair_id";

fn to_replacement_row(row: &sqlx::postgres::PgRow) -> Result<GaReplacementRow, AppError> {
    Ok(GaReplacementRow {
        replacement_id: row.try_get("replacement_id")?,
        old_asset_id: row.try_get("old_asset_id")?,
        old_asset_name: row.try_get("old_asset_name")?,
        new_asset_id: row.try_get("new_asset_id")?,
        new_asset_name: row.try_get("new_asset_name")?,
        repair_id: row.try_get("repair_id")?,
        repair_title: row.try_get("repair_title")?,
        reason: row.try_get("reason")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_name: row.try_get("supplier_name")?,
        status: row.try_get("status")?,
        proposed_on: row.try_get("proposed_on")?,
        approved_by: row.try_get("approved_by")?,
        approved_at: row.try_get("approved_at")?,
        decided_by: row.try_get("decided_by")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

/// The replacement list, newest proposal first.
///
/// Paged by a keyset on `(proposed_on, replacement_id)`, both descending. The
/// scope's site is ignored: a replacement names assets, not a place.
pub async fn ga_replacement_page(
    pool: &PgPool,
    scope: GaMaintenanceScope,
) -> Result<GaReplacementPage, AppError> {
    let limit = scope.page_size();
    let after = scope.after()?;
    let sql = format!(
        "{GA_REPLACEMENT_SELECT}
          WHERE $1::uuid IS NULL
             OR (p.proposed_on, p.replacement_id) <
                (SELECT x.proposed_on, x.replacement_id
                   FROM ga_replacement x WHERE x.replacement_id = $1)
          ORDER BY p.proposed_on DESC, p.replacement_id DESC
          LIMIT $2"
    );
    let rows = sqlx::query(&sql)
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let out = rows
        .iter()
        .map(to_replacement_row)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor =
        next_cursor_after(out.last().map(|row| row.replacement_id), out.len(), limit)?;

    let facet_rows = sqlx::query(
        "SELECT 'status' AS kind, p.status AS value, NULL::text AS label, COUNT(*)::bigint AS n
           FROM ga_replacement p GROUP BY p.status
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM ga_replacement",
    )
    .fetch_all(pool)
    .await?;
    let mut facets = GaReplacementFacets {
        statuses: Vec::new(),
    };
    let total = collect_facets(facet_rows, &mut [("status", &mut facets.statuses)])?;
    Ok(GaReplacementPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// One replacement.
pub async fn ga_replacement(
    pool: &PgPool,
    replacement_id: Uuid,
) -> Result<GaReplacementRow, AppError> {
    let sql = format!("{GA_REPLACEMENT_SELECT} WHERE p.replacement_id = $1");
    let row = sqlx::query(&sql)
        .bind(replacement_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("replacement".into()))?;
    to_replacement_row(&row)
}

/// Propose a replacement.
pub async fn ga_replacement_record(
    pool: &PgPool,
    request: &RecordGaReplacementRequest,
    actor: &str,
) -> Result<GaReplacementRow, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "a replacement says why; the reason is what the decision was made on".into(),
        ));
    }
    require_asset(pool, request.old_asset_id).await?;
    if let Some(supplier_id) = request.supplier_id {
        require_supplier(pool, supplier_id).await?;
    }

    let row = sqlx::query(
        "INSERT INTO ga_replacement
           (old_asset_id, repair_id, reason, supplier_id, proposed_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING replacement_id",
    )
    .bind(request.old_asset_id)
    .bind(request.repair_id)
    .bind(request.reason.trim())
    .bind(request.supplier_id)
    .bind(request.proposed_on)
    .bind(actor)
    .fetch_one(pool)
    .await?;
    ga_replacement(pool, row.try_get("replacement_id")?).await
}

/// Mint a new asset as the copy of the old one, inside the caller's transaction.
///
/// The new thing carries the old one's IDENTITY — name, class, site,
/// sub-location, holder, condition, serial and the build's fields — but not its
/// number: the number is printed on the label of the thing that is still here,
/// and the new thing gets its own. `acquired_on` is the day it was installed.
async fn create_replacement_asset(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    old_asset_id: Uuid,
    actor: &str,
    today: NaiveDate,
) -> Result<Uuid, AppError> {
    let old = sqlx::query(
        "SELECT name, category_code, site_id, sub_location, holder, condition,
                serial_number, specs, notes
           FROM fixed_asset WHERE asset_id = $1 FOR UPDATE",
    )
    .bind(old_asset_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("asset".into()))?;

    let number: i64 = sqlx::query("SELECT nextval('fixed_asset_number_seq') AS n")
        .fetch_one(&mut **tx)
        .await?
        .try_get("n")?;
    let new_asset_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, sub_location, holder,
            condition, serial_number, acquired_on, specs, notes, quantity, status,
            registered_by, registered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,'REGISTERED',$13,now())",
    )
    .bind(new_asset_id)
    .bind(format!("AST-{number:06}"))
    .bind(old.try_get::<String, _>("name")?)
    .bind(old.try_get::<String, _>("category_code")?)
    .bind(old.try_get::<String, _>("site_id")?)
    .bind(old.try_get::<Option<String>, _>("sub_location")?)
    .bind(old.try_get::<Option<String>, _>("holder")?)
    .bind(old.try_get::<String, _>("condition")?)
    .bind(old.try_get::<Option<String>, _>("serial_number")?)
    .bind(today)
    .bind(old.try_get::<serde_json::Value, _>("specs")?)
    .bind(old.try_get::<Option<String>, _>("notes")?)
    .bind(actor)
    .execute(&mut **tx)
    .await?;
    Ok(new_asset_id)
}

/// Move a replacement one rung up its ladder.
///
/// # The rung that makes an asset
///
/// Moving to `INSTALLED` is the whole point of a replacement: the new thing
/// exists, and the old one is done. It copies the old row into a fresh asset —
/// unless the caller names one it registered first — marks the old `REPLACED`,
/// and links the two, all in ONE transaction, because a swap that left the old
/// thing in service or the new one unlinked is not a swap.
///
/// Approving (`PROPOSED -> APPROVED`) is refused to the person who proposed it:
/// maker != checker, and `decided_by` records who it was.
pub async fn ga_replacement_move(
    pool: &PgPool,
    replacement_id: Uuid,
    request: &MoveGaReplacementRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaReplacementRow, AppError> {
    let to = request.to.trim().to_ascii_uppercase();
    if !REPLACEMENT_STATUSES.contains(&to.as_str()) {
        return Err(AppError::Validation(format!(
            "{to} is not a replacement state; a replacement is one of: {}",
            REPLACEMENT_STATUSES.join(", ")
        )));
    }
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT status, created_by, old_asset_id FROM ga_replacement
          WHERE replacement_id = $1 FOR UPDATE",
    )
    .bind(replacement_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("replacement".into()))?;
    let from: String = current.try_get("status")?;
    let maker: String = current.try_get("created_by")?;
    let old_asset_id: Uuid = current.try_get("old_asset_id")?;

    let legal = matches!(
        (from.as_str(), to.as_str()),
        ("PROPOSED", "APPROVED")
            | ("APPROVED", "PURCHASED")
            | ("PURCHASED", "INSTALLED")
            | ("INSTALLED", "CLOSED")
    );
    if !legal {
        return Err(AppError::Conflict(format!(
            "a {from} replacement does not become {to}; the ladder is PROPOSED -> APPROVED -> \
             PURCHASED -> INSTALLED -> CLOSED"
        )));
    }

    match to.as_str() {
        "APPROVED" => {
            if maker == actor {
                return Err(AppError::Conflict(format!(
                    "a replacement cannot be approved by {actor}, who proposed it; maker != checker"
                )));
            }
            sqlx::query(
                "UPDATE ga_replacement
                    SET status = 'APPROVED', approved_by = $2, approved_at = now(),
                        decided_by = $2, updated_by = $2, updated_at = now(),
                        version = version + 1
                  WHERE replacement_id = $1",
            )
            .bind(replacement_id)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
        "INSTALLED" => {
            let new_asset_id = match request.new_asset_id {
                Some(id) => {
                    if id == old_asset_id {
                        return Err(AppError::Validation(
                            "a replacement swaps a thing for a DIFFERENT thing".into(),
                        ));
                    }
                    require_asset(&mut *tx, id).await?;
                    id
                }
                None => create_replacement_asset(&mut tx, old_asset_id, actor, today).await?,
            };
            // The old thing leaves service, the new one is linked, in the same
            // transaction as the copy above.
            sqlx::query("UPDATE fixed_asset SET status = 'REPLACED' WHERE asset_id = $1")
                .bind(old_asset_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "UPDATE ga_replacement
                    SET status = 'INSTALLED', new_asset_id = $2, updated_by = $3,
                        updated_at = now(), version = version + 1
                  WHERE replacement_id = $1",
            )
            .bind(replacement_id)
            .bind(new_asset_id)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
        _ => {
            sqlx::query(
                "UPDATE ga_replacement
                    SET status = $2, updated_by = $3, updated_at = now(), version = version + 1
                  WHERE replacement_id = $1",
            )
            .bind(replacement_id)
            .bind(&to)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;
    ga_replacement(pool, replacement_id).await
}

// ---------------------------------------------------------------------------
// Disposals
// ---------------------------------------------------------------------------

const GA_DISPOSAL_SELECT: &str = "SELECT d.disposal_id, d.asset_id, d.method, d.proceeds_minor,
        d.reason, d.requested_on, d.status, d.notes, d.approved_by, d.approved_at, d.closed_by,
        d.closed_at, d.created_by, d.created_at, d.updated_by, d.updated_at, d.version,
        a.name AS asset_name, a.asset_number, a.site_id
   FROM ga_disposal d
   JOIN fixed_asset a ON a.asset_id = d.asset_id";

fn to_disposal_row(row: &sqlx::postgres::PgRow) -> Result<GaDisposalRow, AppError> {
    Ok(GaDisposalRow {
        disposal_id: row.try_get("disposal_id")?,
        asset_id: row.try_get("asset_id")?,
        asset_name: row.try_get("asset_name")?,
        asset_number: row.try_get("asset_number")?,
        site_id: row.try_get("site_id")?,
        method: row.try_get("method")?,
        proceeds_minor: row.try_get("proceeds_minor")?,
        reason: row.try_get("reason")?,
        requested_on: row.try_get("requested_on")?,
        status: row.try_get("status")?,
        notes: row.try_get("notes")?,
        approved_by: row.try_get("approved_by")?,
        approved_at: row.try_get("approved_at")?,
        closed_by: row.try_get("closed_by")?,
        closed_at: row.try_get("closed_at")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
        version: row.try_get("version")?,
    })
}

/// The disposal list, newest request first.
pub async fn ga_disposal_page(pool: &PgPool, limit: i64) -> Result<GaDisposalPage, AppError> {
    let limit = limit.clamp(1, MAX_GA_MAINTENANCE_LIMIT);
    let sql = format!("{GA_DISPOSAL_SELECT} ORDER BY d.requested_on DESC, d.disposal_id LIMIT $1");
    let rows = sqlx::query(&sql).bind(limit).fetch_all(pool).await?;
    let out = rows
        .iter()
        .map(to_disposal_row)
        .collect::<Result<Vec<_>, _>>()?;

    let facet_rows = sqlx::query(
        "SELECT 'status' AS kind, d.status AS value, NULL::text AS label, COUNT(*)::bigint AS n
           FROM ga_disposal d GROUP BY d.status
          UNION ALL
         SELECT 'method', d.method, NULL::text, COUNT(*)::bigint
           FROM ga_disposal d GROUP BY d.method
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM ga_disposal",
    )
    .fetch_all(pool)
    .await?;
    let mut facets = GaDisposalFacets {
        statuses: Vec::new(),
        methods: Vec::new(),
    };
    let total = collect_facets(facet_rows, &mut [
        ("status", &mut facets.statuses),
        ("method", &mut facets.methods),
    ])?;
    Ok(GaDisposalPage {
        rows: out,
        total,
        facets,
    })
}

/// One disposal.
pub async fn ga_disposal(pool: &PgPool, disposal_id: Uuid) -> Result<GaDisposalRow, AppError> {
    let sql = format!("{GA_DISPOSAL_SELECT} WHERE d.disposal_id = $1");
    let row = sqlx::query(&sql)
        .bind(disposal_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("disposal".into()))?;
    to_disposal_row(&row)
}

/// Ask to let a thing go.
///
/// The asset is marked `DISPOSAL_REQUESTED` in the same transaction: the
/// register must say "somebody is trying to dispose of this", or the request
/// and the register disagree while Finance decides.
pub async fn ga_disposal_request(
    pool: &PgPool,
    request: &RequestGaDisposalRequest,
    actor: &str,
) -> Result<GaDisposalRow, AppError> {
    let method = assert_disposal_method(&request.method)?;
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "a disposal says why; the reason is what Finance decides on".into(),
        ));
    }
    if request.proceeds_minor.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "proceeds are money received; a negative figure is not".into(),
        ));
    }
    if method != "SOLD" && request.proceeds_minor.is_some_and(|value| value != 0) {
        return Err(AppError::Validation(format!(
            "proceeds only make sense for a thing SOLD; a {method} disposal has none"
        )));
    }

    let mut tx = pool.begin().await?;
    let asset = sqlx::query("SELECT status FROM fixed_asset WHERE asset_id = $1 FOR UPDATE")
        .bind(request.asset_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("asset".into()))?;
    let asset_status: String = asset.try_get("status")?;
    match asset_status.as_str() {
        "DISPOSAL_REQUESTED" => {
            return Err(AppError::Conflict(
                "this asset already has a disposal waiting for Finance's answer".into(),
            ))
        }
        "DISPOSED" | "REPLACED" => {
            return Err(AppError::Conflict(format!(
                "a {asset_status} asset is already gone; there is nothing left to dispose of"
            )))
        }
        _ => {}
    }

    let row = sqlx::query(
        "INSERT INTO ga_disposal
           (asset_id, method, proceeds_minor, reason, requested_on, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING disposal_id",
    )
    .bind(request.asset_id)
    .bind(&method)
    .bind(request.proceeds_minor)
    .bind(request.reason.trim())
    .bind(request.requested_on)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("UPDATE fixed_asset SET status = 'DISPOSAL_REQUESTED' WHERE asset_id = $1")
        .bind(request.asset_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    ga_disposal(pool, row.try_get("disposal_id")?).await
}

/// Finance's answer: approve the request, or send the asset back to service.
///
/// Approving keeps the asset `DISPOSAL_REQUESTED` — it is not disposed until
/// the books say so. Rejecting puts it back to `REGISTERED`, because a thing
/// nobody has decided to let go is a thing still here.
pub async fn ga_disposal_decide(
    pool: &PgPool,
    disposal_id: Uuid,
    request: &DecideGaDisposalRequest,
    actor: &str,
) -> Result<GaDisposalRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT status, created_by, notes, asset_id FROM ga_disposal
          WHERE disposal_id = $1 FOR UPDATE",
    )
    .bind(disposal_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("disposal".into()))?;
    let status: String = current.try_get("status")?;
    let maker: String = current.try_get("created_by")?;
    let asset_id: Uuid = current.try_get("asset_id")?;
    if status != "REQUESTED" {
        return Err(AppError::Conflict(format!(
            "a {status} disposal has already been decided"
        )));
    }

    let note = if request.approve {
        if maker == actor {
            return Err(AppError::Conflict(format!(
                "a disposal cannot be approved by {actor}, who requested it; maker != checker"
            )));
        }
        format!("Disetujui oleh {actor}")
    } else {
        format!("Ditolak oleh {actor}")
    };
    let note = match nothing_if_blank(request.note.as_deref()) {
        Some(extra) => format!("{note}: {extra}"),
        None => note,
    };
    let notes = appended_note(current.try_get("notes")?, Some(&note));

    if request.approve {
        sqlx::query(
            "UPDATE ga_disposal
                SET status = 'APPROVED', approved_by = $2, approved_at = now(),
                    notes = $3, updated_by = $2, updated_at = now(), version = version + 1
              WHERE disposal_id = $1",
        )
        .bind(disposal_id)
        .bind(actor)
        .bind(notes.as_deref())
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE ga_disposal
                SET status = 'REJECTED', notes = $2, updated_by = $3, updated_at = now(),
                    version = version + 1
              WHERE disposal_id = $1",
        )
        .bind(disposal_id)
        .bind(notes.as_deref())
        .bind(actor)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE fixed_asset SET status = 'REGISTERED'
              WHERE asset_id = $1 AND status = 'DISPOSAL_REQUESTED'",
        )
        .bind(asset_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    ga_disposal(pool, disposal_id).await
}

/// Finance closes a disposal it has booked.
///
/// The route is on GA's surface because it is GA's record and GA's screen, but
/// the act is Finance's: the disposal is not final until it is in the books,
/// and this only records that it is. GA writes no journal here (brief §5), so
/// closing changes the DISPOSAL's state and nothing else — the asset's own
/// `DISPOSED` word is stage 6's, when there is an entry behind it.
pub async fn ga_disposal_close(
    pool: &PgPool,
    disposal_id: Uuid,
    actor: &str,
) -> Result<GaDisposalRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query("SELECT status FROM ga_disposal WHERE disposal_id = $1 FOR UPDATE")
        .bind(disposal_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("disposal".into()))?;
    let status: String = current.try_get("status")?;
    if status != "APPROVED" {
        return Err(AppError::Conflict(format!(
            "a {status} disposal cannot be closed; Finance closes one it has approved and booked"
        )));
    }
    sqlx::query(
        "UPDATE ga_disposal
            SET status = 'POSTED', closed_by = $2, closed_at = now(),
                updated_by = $2, updated_at = now(), version = version + 1
          WHERE disposal_id = $1",
    )
    .bind(disposal_id)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ga_disposal(pool, disposal_id).await
}

// ---------------------------------------------------------------------------
// The repair objects
// ---------------------------------------------------------------------------

/// The eleven objects, their client names and their accounts (0360's table).
pub async fn ga_repair_objects(pool: &PgPool) -> Result<Vec<GaRepairObject>, AppError> {
    let rows = sqlx::query("SELECT code, name, account_code FROM ga_repair_object ORDER BY code")
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| {
            Ok(GaRepairObject {
                code: row.try_get("code")?,
                name: row.try_get("name")?,
                account_code: row.try_get("account_code")?,
            })
        })
        .collect()
}

/// Fold the `UNION ALL` facet rows into their lists, returning the total.
///
/// One helper rather than five loops: the shape is the same for every list, and
/// the only thing that differs is which bucket a `kind` falls in. A `kind` that
/// matches nothing is the `all` row.
fn collect_facets(
    rows: Vec<sqlx::postgres::PgRow>,
    buckets: &mut [(&str, &mut Vec<GaMaintenanceFacet>)],
) -> Result<i64, AppError> {
    let mut total = 0i64;
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let count: i64 = row.try_get("n")?;
        let mut placed = false;
        for (name, list) in buckets.iter_mut() {
            if *name == kind.as_str() {
                list.push(GaMaintenanceFacet {
                    value: value.clone(),
                    label,
                    count,
                });
                placed = true;
                break;
            }
        }
        // The one `kind` no bucket names is the `all` row: the whole filtered
        // set, which is what `total` describes.
        if !placed {
            total = count;
        }
    }
    for (_, list) in buckets.iter_mut() {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok(total)
}
