//! The asset register, the decision to capitalise, and the monthly run.
//!
//! The arithmetic is in `domain::depreciation` and is pure. This module reads
//! the facts it needs, calls it once per asset, and posts what it says.
//!
//! # Two questions, two tables
//!
//! `fixed_asset` is what Operations knows: what the thing is, where it is, what
//! delivery it came from. It carries no money at all. `asset_capitalization` is
//! what Finance decided: whether it belongs in the books, at what number, over
//! how long. Keeping them apart is what lets a warehouse register a laptop the
//! day it arrives without anybody having decided yet whether it is capital.
//!
//! # The class is the register's own code, and that is new
//!
//! Until the forty-account chart an asset's class WAS an account: a family
//! under `10215`, with `fixed_asset.category_code` pointing at
//! `ledger_account`. The argument for it was that the client's chart already
//! listed the seven kinds and a second list would be a second authority.
//!
//! It had a live bug. The importer wrote ten-character sub-types
//! (`1021507001 OE - Rak 1`) and the seed mapped seven-character families
//! (`1021507`); both are account codes, both satisfy the same foreign key, and
//! `resolve_account_code` matches a qualifier EXACTLY — so every imported asset
//! resolved to nothing and the depreciation run refused it, with no type error
//! anywhere to say why. The chart was not one authority, it was two spellings
//! of one.
//!
//! So the class is now `asset_class(class_code)` — see
//! `postgres::asset_classes`. What has NOT changed is how the accounts are
//! found: the class is still the `account_link` source, and the two accounts
//! a depreciation entry needs are still resolved through the map from a
//! meaning. Only the namespace the qualifier is drawn from is different, and
//! it is now one that cannot be spelled two ways.

use super::asset_classes::{assert_asset_class, WORK_IN_PROGRESS_CLASS};
use super::ledger::{resolve_account, Resolved};
use super::poster::{post, PostingIntent, PostingLine};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    monthly_charge, Basis, ChargeKind, DepreciationMethod, Outcome, SkipReason, ASSET_IN_PROGRESS,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

/// A life in months and a rate in basis points, each derived from the other
/// when only one was given.
///
/// `20%` is five years is sixty months: a year is 10,000 basis points, so the
/// life in years is `10_000 / rate_bps` and in months `120_000 / rate_bps`.
/// The inverse rounds the same way, so a value that went in one side comes
/// back out of the other — 2000 → 60 → 2000, 3333 → 36 → 3333.
///
/// Zero months is the non-depreciating case — land, and the operating
/// equipment the client carries at cost — and it has no rate, which is why
/// both are returned rather than one being computed at every call site.
fn reconcile_life(
    months: Option<i32>,
    rate_bps: Option<i32>,
) -> Result<(Option<i32>, Option<i32>), AppError> {
    match (months, rate_bps) {
        (Some(months), Some(rate)) => {
            if months == 0 || rate <= 0 {
                return Err(AppError::Validation(
                    "a rate and a life of zero cannot both be true: say one of them".into(),
                ));
            }
            if (120_000 / rate - months).abs() > 1 {
                return Err(AppError::Validation(format!(
                    "{}% a year is {} months, not {months}: one of the two is a typing mistake",
                    rate as f64 / 100.0,
                    120_000 / rate
                )));
            }
            Ok((Some(months), Some(rate)))
        }
        (Some(months), None) => {
            let rate = if months > 0 {
                Some(120_000 / months)
            } else {
                None
            };
            Ok((Some(months), rate))
        }
        (None, Some(rate)) if rate > 0 => Ok((Some(120_000 / rate), Some(rate))),
        (None, Some(_)) => Err(AppError::Validation("a rate is a positive number".into())),
        (None, None) => Ok((None, None)),
    }
}

/// An asset as both halves know it: Operations' identity, and the treatment in
/// force if Finance has decided one.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetRow {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub category_code: String,
    /// The client's own name for the category family.
    pub category_name: String,
    /// Which of the eleven forms this class is filled in on — `LAND`,
    /// `BUILDING`, `TECH`, `VEHICLE`, `FFE`, `IT`, `AUDIO`, `OE`, `SOFTWARE`,
    /// `DEFERRED` or `CIP`.
    ///
    /// Travels with every row because it is what the register draws its icon
    /// from, and because the build views filter on it. It is NOT a second class
    /// list: the class decides the accounts, this decides the form. See
    /// migration 0356.
    pub build: String,
    pub site_id: String,
    pub status: String,
    pub serial_number: Option<String>,
    pub acquired_on: NaiveDate,
    /// How many things this row is. 1 for one object; the client's register
    /// keeps lots, and 60,000 sensor pins are one row rather than 60,000.
    pub quantity: i32,

    /// `CAPITALIZE`, `EXPENSE`, or absent when nobody has assessed it.
    ///
    /// Absent is a real state and not a default: "not assessed" is an open
    /// control gap, "assessed and expensed" is a closed one, and a screen that
    /// could not tell them apart would hide the first behind the second.
    pub decision: Option<String>,
    pub capitalized_cost_minor: Option<i64>,
    pub salvage_value_minor: Option<i64>,
    pub useful_life_months: Option<i32>,
    pub method: Option<String>,
    /// `DEPRECIATION`, `REPLACEMENT_RESERVE` or `AMORTISATION` — what the
    /// monthly charge is CALLED, and therefore which pair of accounts it lands
    /// in. Absent exactly when `decision` is, or when the decision was to
    /// expense: an expensed asset has no monthly charge to name.
    pub charge_kind: Option<String>,
    pub in_service_on: Option<NaiveDate>,
    /// What was already depreciated before this system existed, carried in at
    /// cutover, and the last month that figure covers.
    ///
    /// Absent is the ordinary state for anything bought after the cutover, and
    /// it means nothing was carried in — not that nobody has said. Migration
    /// 0237 has the arithmetic this exists to prevent.
    pub opening_accumulated_minor: Option<i64>,
    pub opening_through: Option<NaiveDate>,

    /// Everything ever charged against this asset: what was carried in at
    /// cutover plus every entry this system has posted. Summed on read and
    /// stored nowhere.
    pub accumulated_minor: i64,
    /// Cost less accumulated. Derived on read for the same reason.
    pub book_value_minor: Option<i64>,
    /// The latest month the run actually charged, named by its first day.
    ///
    /// Absent means nothing has ever been charged, which is a real state and
    /// not a zero: a land asset never charges, an asset capitalised last week
    /// has not been reached yet, and an asset the run has been silently
    /// skipping for four months looks exactly like both until this says so.
    /// It is what lets a screen say "charged through August" instead of making
    /// somebody open the schedule to find out.
    pub last_depreciated_month: Option<NaiveDate>,

    /// Every bill line that bought this, as `PLN-0901 line 2, PLN-0912 line 1`,
    /// when the books bought it at all.
    ///
    /// Plural since 0160. One air conditioner at this client is a unit, an
    /// installation charge and sometimes an earlier payment — three lines and
    /// one thing — so a field that could name only one of them was showing a
    /// third of the answer and looking complete.
    ///
    /// Absent is the ordinary state for an asset the company already owned when
    /// this system arrived, and it is an EXCEPTION for one that was
    /// capitalised here: `fixed_asset` has no acquisition posting rule and
    /// never will — the acquisition is a supplier bill — so an asset with no
    /// line is an asset the books never bought. `acquisition_gap` lists them.
    pub acquired_via: Option<String>,

    /// Set once the asset has left the books.
    pub disposed_on: Option<NaiveDate>,
    /// `SOLD` or `WRITTEN_OFF`.
    pub disposal_method: Option<String>,
    pub disposal_proceeds_minor: Option<i64>,
    pub disposal_journal_entry_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RegisterAssetRequest {
    pub asset_number: String,
    pub name: String,
    /// One of the register's own asset classes — an `asset_class.class_code`,
    /// not an account code. The account its cost lands in follows from the
    /// class through `account_resolution`, and is `1601` or `1602` for every one.
    pub category_code: String,
    pub site_id: String,
    pub acquired_on: NaiveDate,
    pub serial_number: Option<String>,
    pub notes: Option<String>,
    /// How many things this row is. Absent means one, which is the ordinary
    /// case; a lot is what the client's register keeps for hangers and pins.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub quantity: Option<i32>,
    /// The expense-bill line that bought it, when there is one. Optional
    /// because most assets on day one predate this system, and because the
    /// bill often arrives after the warehouse has registered the thing.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub acquired_via_line_id: Option<Uuid>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssessAssetRequest {
    /// `CAPITALIZE`, `EXPENSE`, or `IN_PROGRESS`.
    ///
    /// The third is work being paid for on something not yet built — the
    /// client's `Contract In Progress`, which is 668 of the 1,342 rows in
    /// their own register. It carries a cost and nothing else, charges
    /// nothing, and is superseded by a second assessment the day the thing is
    /// finished. See migration 0213.
    pub decision: String,
    pub capitalized_cost_minor: Option<i64>,
    pub salvage_value_minor: Option<i64>,
    pub useful_life_months: Option<i32>,
    /// The class this asset belongs in from now on.
    ///
    /// Only ever used for one thing: a shop fit-out finishing. Work in
    /// progress is its own class, and the day it is done it becomes a
    /// building, an instalation, or furniture — so the assessment that
    /// capitalises it also says which. Refused on anything else: an asset that
    /// could be re-filed at will would let somebody move cost between classes
    /// without a trace, and the client's own `REKLAS CIP` rows show this is
    /// the one move they actually make.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub category_code: Option<String>,
    /// The annual rate, in basis points — 20% is `2000`.
    ///
    /// Optional, and either this or the life may be given: the two are one
    /// fact said twice, and this client's register says it this way. When both
    /// arrive they must agree; when one arrives the other is derived. The
    /// arithmetic downstream still reads the life.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub rate_bps: Option<i32>,
    pub method: Option<String>,
    /// `DEPRECIATION`, `REPLACEMENT_RESERVE` or `AMORTISATION`.
    ///
    /// Required on CAPITALIZE and refused on EXPENSE, which is how the rest of
    /// the basis behaves and for the same reason. It is asked rather than
    /// inferred from the category, because inferring it would mean a posting
    /// rule choosing accounts from a client account code — see 0159.
    pub charge_kind: Option<String>,
    pub in_service_on: Option<NaiveDate>,
    /// What the old system had already depreciated, and the last month that
    /// figure covers.
    ///
    /// Both or neither. The client's register carries a column for this and
    /// leaves it empty on all 1,342 rows, so the figure comes from the ledger
    /// being replaced rather than from the file — and until it does, leaving
    /// these out is the honest state. Migration 0237.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub opening_accumulated_minor: Option<i64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub opening_through: Option<NaiveDate>,
    /// Why. Required on both decisions — an expensed asset with no reason is
    /// the one somebody queries a year later.
    pub reason: String,
    /// The expense-bill line that bought it. Accepted here as well as at
    /// registration because the bill usually arrives after the thing does, and
    /// because this is the moment a cost is named — which is the moment the
    /// two figures can be checked against each other.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub acquired_via_line_id: Option<Uuid>,
    /// The other lines that bought it, when a purchase took more than one.
    ///
    /// Added alongside the singular rather than replacing it because the
    /// ordinary purchase is still one line, and because every caller that
    /// names one line should keep working. Both are accepted and the union is
    /// what gets attached.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub acquired_via_line_ids: Option<Vec<Uuid>>,
}

/// The columns every asset read needs, without the acquisition trail.
///
/// `a` is the `fixed_asset` alias, `c` the category account, `k` the
/// assessment in force.
///
/// `c.kind` travels with the row so a `group` filter can narrow the `kept`
/// CTE — which sees only the searched columns, and no base-table aliases —
/// without this file spelling a second join.
const ASSET_BASE: &str = "a.asset_id, a.asset_number, a.name, a.category_code,
     c.kind AS class_kind, c.build AS class_build,
     c.name AS category_name, a.site_id, a.status, a.serial_number, a.acquired_on,
     a.quantity,
     a.disposed_on, a.disposal_method, a.disposal_proceeds_minor, a.disposal_journal_entry_id,
     k.decision, k.capitalized_cost_minor, k.salvage_value_minor, k.useful_life_months,
     k.method, k.charge_kind, k.in_service_on,
     k.opening_accumulated_minor, k.opening_through,
     (COALESCE(k.opening_accumulated_minor, 0)
      + COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                   WHERE d.asset_id = a.asset_id), 0))::bigint AS accumulated,
     (SELECT MAX(d.period_month) FROM asset_depreciation_entry d
       WHERE d.asset_id = a.asset_id) AS last_depreciated_month";

/// Every bill line that bought one asset, as one string.
///
/// Separate from [`ASSET_BASE`] so the register's page query can add it to the
/// PAGE rather than to every asset the search matched: a CTE is materialised
/// before the `LIMIT`, so a two-table aggregate per row would run for the
/// whole register in order to draw two hundred of it. It is not a sort key and
/// not a filter, so nothing needs it earlier.
const ACQUIRED_VIA: &str =
    "(SELECT string_agg(si.invoice_number || ' line ' || bl.line_number, ', '
                        ORDER BY si.invoice_date, si.invoice_number, bl.line_number)
        FROM supplier_invoice_expense_line bl
        JOIN supplier_invoice si USING (invoice_id)
       WHERE bl.asset_id = a.asset_id) AS acquired_via";

/// The assessment in force is the highest sequence. A lateral join rather than
/// a window, so the planner can stop at the first row per asset.
const IN_FORCE: &str = "LEFT JOIN LATERAL (
         SELECT * FROM asset_capitalization x
          WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
     ) k ON true";

fn to_asset(row: &sqlx::postgres::PgRow) -> Result<AssetRow, AppError> {
    let cost: Option<i64> = row.try_get("capitalized_cost_minor")?;
    let accumulated: i64 = row.try_get("accumulated")?;
    let disposed_on: Option<NaiveDate> = row.try_get("disposed_on")?;
    Ok(AssetRow {
        asset_id: row.try_get("asset_id")?,
        asset_number: row.try_get("asset_number")?,
        name: row.try_get("name")?,
        category_code: row.try_get("category_code")?,
        category_name: row.try_get("category_name")?,
        build: row.try_get("class_build")?,
        site_id: row.try_get("site_id")?,
        status: row.try_get("status")?,
        serial_number: row.try_get("serial_number")?,
        acquired_on: row.try_get("acquired_on")?,
        quantity: row.try_get("quantity")?,
        decision: row.try_get("decision")?,
        capitalized_cost_minor: cost,
        salvage_value_minor: row.try_get("salvage_value_minor")?,
        useful_life_months: row.try_get("useful_life_months")?,
        method: row.try_get("method")?,
        charge_kind: row.try_get("charge_kind")?,
        in_service_on: row.try_get("in_service_on")?,
        opening_accumulated_minor: row.try_get("opening_accumulated_minor")?,
        opening_through: row.try_get("opening_through")?,
        accumulated_minor: accumulated,
        // A disposed asset has left the books: its disposal entry took the
        // cost and the accumulated charge out, so what the books carry for it
        // is nothing. Cost less accumulated here would keep a written-off
        // laptop in every "at book value" total beside a balance sheet that
        // no longer has it.
        book_value_minor: cost.map(|c| {
            if disposed_on.is_some() {
                0
            } else {
                c - accumulated
            }
        }),
        last_depreciated_month: row.try_get("last_depreciated_month")?,
        acquired_via: row.try_get("acquired_via")?,
        disposed_on,
        disposal_method: row.try_get("disposal_method")?,
        disposal_proceeds_minor: row.try_get("disposal_proceeds_minor")?,
        disposal_journal_entry_id: row.try_get("disposal_journal_entry_id")?,
    })
}

// ── the register ─────────────────────────────────────────────────────────
//
// Brought up to the shape `money_overview` set in `postgres::statements`: a
// scope struct in, an envelope out, a keyset cursor, and facet counts drawn
// from the same row definition as the page. Copied deliberately rather than
// reinvented — two list endpoints that page differently are two things to
// learn and two things to get wrong.

/// How many assets the register returns when the caller does not say.
const DEFAULT_ASSET_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
///
/// A thousand, not the money list's two hundred, because this register has a
/// caller that legitimately wants the whole thing in one read — the sidebar's
/// count of unassessed assets — and clamping it to a page would silently
/// understate a control gap. `total` is what makes that safe now: a caller
/// that hits the ceiling can see that it did.
const MAX_ASSET_LIMIT: i64 = 1000;

/// What a caller is asking the asset register for.
#[derive(Clone, Debug, Default)]
pub struct AssetScope {
    /// Free text, tried against the asset number, its name and its serial.
    ///
    /// The serial matters: somebody standing in front of a machine has the
    /// plate in their hand and nothing else, and before this they had to read
    /// down the register looking for it.
    pub needle: Option<String>,
    /// Locations to keep. Empty means every location — an empty filter and no
    /// filter are the same request.
    pub sites: Vec<String>,
    /// Asset classes to keep, as `asset_class.class_code`. Plural where
    /// `category` was single; a caller sending exactly one is unaffected.
    pub categories: Vec<String>,
    /// `CAPITALIZE`, `EXPENSE`, or `UNASSESSED` for the ones nobody has
    /// decided.
    ///
    /// `UNASSESSED` is a value of this filter rather than a separate flag
    /// because that is what it is: "not assessed" is a state an asset is in,
    /// and the old boolean could only ever ask for it alone. The boolean
    /// spelling still works — see the handler — because the sidebar sends it.
    pub decisions: Vec<String>,
    /// `REGISTERED`, `CAPITALIZED`, `DISPOSED`. The asset's own lifecycle,
    /// which is not the same question as what Finance decided about it.
    pub statuses: Vec<String>,
    /// The register's three readings, as the GA menu splits it: `register`
    /// (plant and operating equipment, less work in progress), `software`
    /// (intangibles) and `projects` (deferred cost and work in progress).
    ///
    /// A group rather than a `kind` list because the third reading does not
    /// follow `kind` alone: `CONTRACT_IN_PROGRESS` is `kind = PPE` in
    /// `asset_class` (0288), yet it is a cost for a thing not built — its
    /// chart parent (1109) is neither 1060 nor 1103 — so it reads as neither
    /// Register nor Software. Stating the grouping here keeps its one
    /// exception beside the data it interprets, instead of in every caller's
    /// URL. Absent means the whole register, as before.
    pub group: Option<String>,
    /// The eleven forms a thing can come in, as `asset_class.build`.
    ///
    /// The register's other reading of the same rows, and the one a facilities
    /// person uses: "show me the machines", "show me the vehicles". It is not a
    /// second grouping of the classes — `group` answers *plant, intangible,
    /// still being built*, which is how the money is filed; this answers *what
    /// does somebody have to write down about it*, which is how the FORM is
    /// chosen. Four classes are one build (migration 0356), so a category
    /// filter could not express it without the caller knowing all four.
    ///
    /// Empty means every build, like every other filter here.
    pub builds: Vec<String>,
    /// `number`, `name`, `acquired`, `cost`, `book` or `treatment`. Anything
    /// else is the house order, by asset number — see [`asset_page`].
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`DEFAULT_ASSET_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many assets would still be there.
///
/// `MoneyFacet`'s shape and reasoning. Counted over everything the SEARCH
/// leaves, deliberately ignoring which filters are currently applied.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetFacet {
    pub value: String,
    /// What to draw, when it differs from the value. The client's own category
    /// name for a category, the site's name for a location; absent for a
    /// decision and a status, whose words belong to the screen.
    pub label: Option<String>,
    pub count: i64,
}

/// The four things the register can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetFacets {
    pub sites: Vec<AssetFacet>,
    pub categories: Vec<AssetFacet>,
    /// Includes `UNASSESSED`, which is a real state and the open control gap —
    /// see [`AssetScope::decisions`]. A zero there is a closed gap and is
    /// worth drawing; leaving the row out would make "nobody has assessed
    /// anything" and "everything is assessed" look the same.
    pub decisions: Vec<AssetFacet>,
    pub statuses: Vec<AssetFacet>,
    /// The eleven builds, with how many assets are filed under each — the
    /// counts behind the register's build chips. A build nobody has anything
    /// in is absent rather than zero, like every other facet here: the chips
    /// are drawn from the server's own list of the eleven, not from this.
    pub builds: Vec<AssetFacet>,
}

/// A page of the register, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetPage {
    pub rows: Vec<AssetRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    /// Every asset the search and the filters match, not just this page.
    pub total: i64,
    /// What the matched assets are carried at, and what is left of it — added
    /// HERE, over every matched row rather than over the page.
    ///
    /// Only the server has every row. A paged list summed in the browser gives
    /// a figure that grows while somebody reads, and on a finance screen a
    /// total that changes as you scroll is worse than no total at all.
    ///
    /// An unassessed asset contributes nothing to either, because it has no
    /// cost in the books — that is what unassessed means, and counting it as
    /// zero is the same number for a different reason.
    pub total_cost_minor: i64,
    pub total_book_minor: i64,
    pub facets: AssetFacets,
    /// What the matched assets that carry a cost are worth at book, family by
    /// family — over every matched row, like the totals above.
    ///
    /// The finance register draws this as its "book value by category" chart.
    /// It used to sum the rows it held, which was the whole register only
    /// while the register came in one read; it pages now, and a chart summed
    /// from the pages in hand grows as somebody scrolls.
    ///
    /// Each figure is the row's own `book_value_minor` summed — cost less
    /// opening and charged depreciation, nought once disposed — so the bars
    /// agree with the column beside them. Heaviest first.
    pub book_by_category: Vec<AssetCategoryBook>,
}

/// One family's share of the register at book value.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetCategoryBook {
    pub category_code: String,
    pub category_name: String,
    pub book_minor: i64,
}

/// Where the previous page stopped — as a ROW, not as a position.
#[derive(Serialize, Deserialize)]
struct AssetCursor {
    asset_id: Uuid,
}

impl AssetCursor {
    fn encode(&self) -> Result<String, AppError> {
        Ok(hex::encode(serde_json::to_vec(self)?))
    }

    fn decode(raw: &str) -> Result<Self, AppError> {
        let bytes = hex::decode(raw).map_err(|_| {
            AppError::Validation("cursor is not a cursor this server issued".into())
        })?;
        serde_json::from_slice(&bytes)
            .map_err(|_| AppError::Validation("cursor is not a cursor this server issued".into()))
    }
}

/// One register row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole
/// reason it is a function rather than two queries: the facets are only honest
/// if they count exactly what the page can show.
///
/// Binds: `$1` the search pattern or NULL.
///
/// It stops at the SEARCH. The four filters are applied outside it by each
/// caller, which is what lets one definition answer two different questions
/// from the same rows — because "Unassessed 9" has to mean "there are nine
/// unassessed assets", not "nine among the ones you have already narrowed to
/// unassessed".
///
/// `decision_key` and `book_value` are computed here rather than only in
/// `ORDER BY` and `WHERE` because the keyset has to COMPARE the sort value,
/// and a sort expression that is not also a column is one a `WHERE` cannot
/// see. `decision_key` is `COALESCE`d rather than left NULL for the reason
/// `EmployeeList` gives about `NULLS LAST`: a row comparison against NULL is
/// NULL rather than true, so one unassessed asset would end paging at whatever
/// row happened to carry it, silently, with the rest of the register below the
/// fold.
fn asset_rows() -> String {
    format!(
        "SELECT {ASSET_BASE},
                COALESCE(k.decision, 'UNASSESSED') AS decision_key,
                -- The register screen's treatment order: nothing decided
                -- first (the control gap), disposed last (finished work).
                -- Never NULL, for the keyset reason given above.
                (CASE WHEN a.disposed_on IS NOT NULL THEN 'ZZ'
                      ELSE COALESCE(k.decision, '') END) AS treatment_key,
                COALESCE(k.capitalized_cost_minor, 0)::bigint AS cost_key,
                (CASE WHEN a.disposed_on IS NOT NULL THEN 0
                      ELSE COALESCE(k.capitalized_cost_minor, 0)
                           - COALESCE((SELECT SUM(d.amount_minor)
                                         FROM asset_depreciation_entry d
                                        WHERE d.asset_id = a.asset_id), 0)
                 END)::bigint AS book_key
           FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
           {IN_FORCE}
          WHERE ($1::text IS NULL
                 OR a.asset_number ILIKE $1
                 OR a.name ILIKE $1
                 OR a.serial_number ILIKE $1)"
    )
}

/// The filters, spelled once so the page and the counts narrow identically.
///
/// Binds from `$2`: sites, categories, decisions, statuses, builds.
const ASSET_FILTERS: &str = "
    ($2::text[] IS NULL OR site_id = ANY($2))
    AND ($3::text[] IS NULL OR category_code = ANY($3))
    AND ($4::text[] IS NULL OR decision_key = ANY($4))
    AND ($5::text[] IS NULL OR status = ANY($5))
    AND ($6::text[] IS NULL OR class_build = ANY($6))
";

/// The predicate a `group` filter adds, chosen by name and refused loudly
/// rather than quietly matching nothing.
///
/// Column names, not aliases: the predicate runs inside `kept`, which sees
/// only the searched CTE's output. The class kind rides that output as
/// `class_kind` (see [`ASSET_BASE`]); `category_code` is the class code.
///
/// The literals are the kinds 0288 seeded and the one class this file already
/// names a constant for — `WORK_IN_PROGRESS_CLASS`, whose comment explains why
/// the string has to be exactly the one 0288 slugged. Interpolated rather than
/// bound because it is a constant of our own, and a fragment with no new bind
/// slots keeps the page and the counts narrowing identically.
fn asset_group_predicate(group: Option<&str>) -> Result<Option<String>, AppError> {
    let cip = WORK_IN_PROGRESS_CLASS;
    let predicate = match group {
        None => return Ok(None),
        Some("register") => {
            format!("class_kind IN ('PPE', 'OE') AND category_code <> '{cip}'")
        }
        Some("software") => "class_kind = 'INTANGIBLE'".to_string(),
        // Work in progress belongs here by CLASS and not by kind, which is
        // the whole reason this is a group and not a kind list.
        Some("projects") => format!("(class_kind = 'DEFERRED' OR category_code = '{cip}')"),
        Some(other) => {
            return Err(AppError::Validation(format!(
                "unknown asset group '{other}' — the register reads as \
                 'register', 'software' or 'projects'"
            )))
        }
    };
    Ok(Some(predicate))
}

/// The register, one page at a time, beside how big the whole answer is.
pub async fn asset_page(pool: &PgPool, scope: AssetScope) -> Result<AssetPage, AppError> {
    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let categories = (!scope.categories.is_empty()).then(|| scope.categories.clone());
    let decisions = (!scope.decisions.is_empty()).then(|| scope.decisions.clone());
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let builds = (!scope.builds.is_empty()).then(|| scope.builds.clone());

    // The sort, and the tie-break that makes it total. Every order ends in the
    // asset id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    //
    // TWO spellings of the same thing, and they are not interchangeable:
    // `ORDER BY` takes directions, a ROW EXPRESSION does not.
    let (lead, descending): (&str, bool) = match scope.sort.as_deref() {
        Some("name") => ("name", scope.desc),
        Some("acquired") => ("acquired_on", scope.desc),
        Some("cost") => ("cost_key", scope.desc),
        // What is left of it. The order somebody reads a register in when
        // deciding what is worth insuring.
        Some("book") => ("book_key", scope.desc),
        // Undecided first, disposed last — see `treatment_key` in
        // [`asset_rows`]. How the finance register opens.
        Some("treatment") => ("treatment_key", scope.desc),
        // The house order, and the one this endpoint has always answered in.
        // Reversible, unlike most house orders here: an asset number counts
        // upwards, so "the newest thing we bought" is the same list backwards
        // and is a thing somebody means.
        _ => ("asset_number", scope.desc),
    };
    let cols = format!("{lead}, asset_id");
    let dir = if descending { "DESC" } else { "ASC" };
    let order = format!("{lead} {dir}, asset_id {dir}");
    let seek = if descending { "<" } else { ">" };

    let cursor = scope
        .cursor
        .as_deref()
        .map(AssetCursor::decode)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(DEFAULT_ASSET_LIMIT)
        .clamp(1, MAX_ASSET_LIMIT);

    let rows_sql = asset_rows();
    let group_and = asset_group_predicate(scope.group.as_deref())?
        .map(|predicate| format!(" AND {predicate}"))
        .unwrap_or_default();
    // The acquisition trail is joined onto the PAGE and onto nothing else —
    // see [`ACQUIRED_VIA`]. `a` is the alias it expects, which is why `kept` is
    // aliased to it here.
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({rows_sql}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {ASSET_FILTERS}{group_and}
         )
         SELECT a.*, {ACQUIRED_VIA} FROM kept a
          WHERE $7::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE asset_id = $7)
          ORDER BY {order}
          LIMIT $8"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&sites)
        .bind(&categories)
        .bind(&decisions)
        .bind(&statuses)
        .bind(&builds)
        .bind(cursor.as_ref().map(|c| c.asset_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(
            AssetCursor {
                asset_id: row.try_get("asset_id")?,
            }
            .encode()?,
        ),
        _ => None,
    };

    let out = rows.iter().map(to_asset).collect::<Result<Vec<_>, _>>()?;
    let (total, total_cost_minor, total_book_minor, facets, book_by_category) =
        asset_facets(pool, &scope, needle.as_deref()).await?;
    Ok(AssetPage {
        rows: out,
        next_cursor,
        total,
        total_cost_minor,
        total_book_minor,
        facets,
        book_by_category,
    })
}

/// How many assets there are, what they are carried at, and how they split.
///
/// Counted from the SAME rows the page is drawn from.
///
/// The two scopes here are deliberate:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered, so a
///     number beside a value answers "how many of these there are" — the
///     question somebody has while deciding whether to click it.
///   the total and the money read the FILTERED set, because they describe the
///     list on screen.
async fn asset_facets(
    pool: &PgPool,
    scope: &AssetScope,
    needle: Option<&str>,
) -> Result<(i64, i64, i64, AssetFacets, Vec<AssetCategoryBook>), AppError> {
    let rows_sql = asset_rows();
    // The total and the money describe the list on screen, so the group
    // narrows them exactly as it narrows the page — while the per-value
    // facets below still read the searched set, because "how many of these
    // there are" is asked about the register, not about one reading of it.
    let group_and = asset_group_predicate(scope.group.as_deref())?
        .map(|predicate| format!(" AND {predicate}"))
        .unwrap_or_default();
    let sql = format!(
        "WITH searched AS ({rows_sql}), kept AS (
             SELECT * FROM searched WHERE {ASSET_FILTERS}{group_and}
         )
         SELECT 'site' AS kind, s.site_id AS value,
                (SELECT p.name FROM site p WHERE p.id = s.site_id) AS label,
                COUNT(*)::bigint AS n, 0::bigint AS cost, 0::bigint AS book
           FROM searched s GROUP BY s.site_id
          UNION ALL
         SELECT 'category', s.category_code, MIN(s.category_name),
                COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM searched s GROUP BY s.category_code
          UNION ALL
         SELECT 'decision', s.decision_key, NULL::text,
                COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM searched s GROUP BY s.decision_key
          UNION ALL
         SELECT 'status', s.status, NULL::text,
                COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM searched s GROUP BY s.status
          UNION ALL
         SELECT 'build', s.class_build, NULL::text,
                COUNT(*)::bigint, 0::bigint, 0::bigint
           FROM searched s GROUP BY s.class_build
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint,
                COALESCE(SUM(cost_key), 0)::bigint,
                COALESCE(SUM(book_key), 0)::bigint
           FROM kept
          UNION ALL
         -- Book value by family over the FILTERED set, spelled as `to_asset`
         -- spells a row's `book_value_minor` so the chart and the column agree.
         SELECT 'category_book', s.category_code, MIN(s.category_name),
                COUNT(*)::bigint, 0::bigint,
                COALESCE(SUM(CASE WHEN s.disposed_on IS NOT NULL THEN 0
                                  ELSE s.capitalized_cost_minor - s.accumulated END), 0)::bigint
           FROM kept s
          WHERE s.capitalized_cost_minor IS NOT NULL
          GROUP BY s.category_code"
    );
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let categories = (!scope.categories.is_empty()).then(|| scope.categories.clone());
    let decisions = (!scope.decisions.is_empty()).then(|| scope.decisions.clone());
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let builds = (!scope.builds.is_empty()).then(|| scope.builds.clone());
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&sites)
        .bind(&categories)
        .bind(&decisions)
        .bind(&statuses)
        .bind(&builds)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut cost = 0i64;
    let mut book = 0i64;
    let mut facets = AssetFacets {
        sites: Vec::new(),
        categories: Vec::new(),
        decisions: Vec::new(),
        statuses: Vec::new(),
        builds: Vec::new(),
    };
    let mut books = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let n: i64 = row.try_get("n")?;
        if kind == "category_book" {
            books.push(AssetCategoryBook {
                category_name: label.unwrap_or_else(|| value.clone()),
                category_code: value,
                book_minor: row.try_get("book")?,
            });
            continue;
        }
        let facet = AssetFacet {
            value,
            label,
            count: n,
        };
        match kind.as_str() {
            "site" => facets.sites.push(facet),
            "category" => facets.categories.push(facet),
            "decision" => facets.decisions.push(facet),
            "status" => facets.statuses.push(facet),
            "build" => facets.builds.push(facet),
            _ => {
                total = n;
                cost = row.try_get("cost")?;
                book = row.try_get("book")?;
            }
        }
    }
    // Biggest first, ties on the value so the order is stable between calls —
    // a list that reshuffles under the cursor is a list nobody can click.
    for list in [
        &mut facets.sites,
        &mut facets.categories,
        &mut facets.decisions,
        &mut facets.statuses,
        &mut facets.builds,
    ] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    books.sort_by(|a, b| {
        b.book_minor
            .cmp(&a.book_minor)
            .then_with(|| a.category_code.cmp(&b.category_code))
    });
    Ok((total, cost, book, facets, books))
}

pub async fn asset(pool: &PgPool, asset_id: Uuid) -> Result<AssetRow, AppError> {
    let sql = format!(
        "SELECT {ASSET_BASE}, {ACQUIRED_VIA} FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
           {IN_FORCE} WHERE a.asset_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(asset_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("asset".into()))?;
    to_asset(&row)
}

/// The meanings under which an asset's COST sits.
///
/// Three, and they are the same three `ChargeKind::cost_key` names plus the
/// one for work still being built. Until the forty-account chart this was a
/// list of client account families in Rust — `["10215", "10217", "1031803"]`,
/// matched by prefix — and it is now a list of MEANINGS, resolved through
/// `account_resolution` like everything else. Two things follow from that and both
/// were wrong before:
///
///   * the codes are wherever the map says they are, so the check cannot drift
///     from what the postings actually do, and
///   * a prefix match is gone. `10215` matched `1021507001` and `102159` alike
///     — one deliberately, one by accident — and a four-digit chart has no
///     prefixes to match on anyway.
const ASSET_COST_KEYS: [&str; 3] = ["fixed_asset", "intangible_asset", "work_in_progress"];

/// The accounts an asset's cost can sit in, read off the map rather than
/// spelled out here.
///
/// The same shape `stock_ledger` uses to find the inventory account: DISTINCT
/// over the map, because one meaning is mapped per location and per class and
/// the answer to "is this an asset account" is the same everywhere.
pub(super) async fn asset_cost_accounts(
    executor: impl sqlx::PgExecutor<'_>,
) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT account_code FROM account_resolution
          WHERE role = ANY($1) ORDER BY account_code",
    )
    .bind(ASSET_COST_KEYS.map(str::to_string).to_vec())
    .fetch_all(executor)
    .await?;
    rows.iter()
        .map(|row| Ok(row.try_get("account_code")?))
        .collect()
}

/// Resolve one of an asset rule's meanings and check the map answered with the
/// category the charge kind requires.
///
/// # Why a rule checks a map it does not write
///
/// Because since 0294 the map row is the only place the two facts meet. `7101`
/// carries depreciation, amortisation AND the replacement charge, told apart by
/// `depreciation_kind`; `1601` carries finished work and work in progress, told
/// apart by `asset_stage`. A posting rule names a MEANING and the map decides
/// the account and the category together — that is the whole arrangement, and
/// nothing here wants to override it.
///
/// What this adds is the sentence. A map row pointing `amortisation_expense` at
/// `7101` with no category, or with DEPRECIATION on it, is refused by 0288's
/// trigger at the moment the run posts — as "line 1: 7101 wants a
/// depreciation_kind", weeks after somebody mapped it and in front of whoever
/// pressed Run. Asked here, the same fault reads as the map row it is, names
/// the meaning, and appears in the rehearsal and on the setup screen before a
/// month is ever charged.
///
/// `unit_id` is the books the charge lands in: an asset stands at a site, and
/// its value is booked to the unit that owns the site (`unit_of_site`).
async fn asset_leg(
    executor: impl sqlx::PgExecutor<'_>,
    semantic_key: &str,
    unit_id: &str,
    qualifier: &str,
    expected: Option<&str>,
) -> Result<Resolved, AppError> {
    let resolved = resolve_account(executor, semantic_key, unit_id, qualifier).await?;
    // On the client's 267 leaves the account itself says which charge it is
    // (7007 is building depreciation, 1113 is CIP), so a row with no category
    // is the normal answer and needs no telling apart. The category test
    // still guards a row that DOES carry one and carries the wrong one.
    if resolved.category_code.is_some() && resolved.category_code.as_deref() != expected {
        return Err(AppError::Validation(format!(
            "the map points {semantic_key} ({qualifier}) at {} in the books of {unit_id} {}, and this charge \
             is {}. One account carries several of these now, and the category is the only thing \
             that tells them apart — fix the link on the Account Links screen.",
            resolved.account_code,
            match resolved.category_code.as_deref() {
                Some(found) => format!("under {found}"),
                None => "with no category".to_string(),
            },
            match expected {
                Some(wanted) => wanted.to_string(),
                None => "an account that takes none".to_string(),
            }
        )));
    }
    Ok(resolved)
}

/// Both accounts one month's charge needs, resolved and checked.
///
/// The expense leg is the one that gained a category: all three charges land on
/// `7101` and `depreciation_kind` is what keeps them apart on the profit and
/// loss. The contra leg did not — `1609`, `1610` and `1619` are still three
/// accounts — so it is checked for the absence of one, which is a real check:
/// a map row that gave accumulated depreciation a category would be refused by
/// the trigger at posting time, and here it is refused by name.
pub(super) async fn charge_legs(
    pool: &PgPool,
    kind: ChargeKind,
    unit_id: &str,
    class_code: &str,
) -> Result<(), AppError> {
    asset_leg(
        pool,
        kind.expense_key(),
        unit_id,
        class_code,
        Some(kind.expense_category()),
    )
    .await?;
    asset_leg(pool, kind.contra_key(), unit_id, class_code, None).await?;
    Ok(())
}

/// Whether a bill line's account is one an asset's cost can sit in.
///
/// Takes the list rather than fetching it, because both callers check several
/// lines against one answer and a query per line would be a query per line.
pub(super) fn is_asset_account(accounts: &[String], code: &str) -> bool {
    accounts.iter().any(|account| account == code.trim())
}

/// Point one or more bill lines at this asset, refusing any that could not
/// have bought it.
///
/// One thing is asked of each line and it names its figures, because "invalid
/// acquisition line" is a message that sends somebody to read code: the line's
/// account is one an asset's cost sits in, so the money went into an asset
/// rather than into an expense. A line already bought for a DIFFERENT asset is
/// refused too — that is somebody attaching the wrong receipt, and it would
/// silently move cost from one asset to another.
///
/// The posting status of the bill is deliberately NOT required. A draft bill is
/// a real document somebody is still checking, and refusing to link it would
/// mean the register could only ever catch up after Finance posts. What counts
/// as "the books bought it" is asked separately, by `acquisition_gap`, which
/// looks only at POSTED lines.
async fn attach_acquisition_lines(
    tx: &mut sqlx::PgConnection,
    asset_id: Uuid,
    line_ids: &[Uuid],
) -> Result<(), AppError> {
    // Once for the whole call, not once per line: the answer is the same for
    // every line and reading it per line would be a query per line.
    let cost_accounts = asset_cost_accounts(&mut *tx).await?;
    for line_id in line_ids {
        let row = sqlx::query(
            "SELECT l.account_code, a.name AS account_name, l.asset_id,
                    i.invoice_number, l.line_number
               FROM supplier_invoice_expense_line l
               JOIN supplier_invoice i USING (invoice_id)
               JOIN ledger_account a ON a.account_code = l.account_code
              WHERE l.line_id = $1",
        )
        .bind(line_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("bill line {line_id}")))?;

        let account_code: String = row.try_get("account_code")?;
        let account_name: String = row.try_get("account_name")?;
        let invoice_number: String = row.try_get("invoice_number")?;
        let line_number: i32 = row.try_get("line_number")?;
        let claimed: Option<Uuid> = row.try_get("asset_id")?;

        if !is_asset_account(&cost_accounts, &account_code) {
            return Err(AppError::Validation(format!(
                "{invoice_number} line {line_number} is coded to {account_code} {account_name}, \
                 which is not an account an asset's cost sits in; an acquisition is a bill line \
                 coded to one of {}",
                cost_accounts.join(", ")
            )));
        }
        if let Some(other) = claimed {
            if other != asset_id {
                return Err(AppError::Validation(format!(
                    "{invoice_number} line {line_number} was already bought for asset {other}; \
                     one line buys one thing"
                )));
            }
        }
        sqlx::query("UPDATE supplier_invoice_expense_line SET asset_id = $2 WHERE line_id = $1")
            .bind(line_id)
            .bind(asset_id)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

/// Check that what the books paid for this asset is what Finance capitalised.
///
/// 0099 asked this of ONE line and its argument is unchanged: capitalised
/// above what the bill charged means the difference is in the books somewhere
/// else, and `fixed_asset` will not empty when the asset is disposed of. What
/// widened in 0160 is only the arithmetic — the client pays for a unit, its
/// installation, and sometimes an earlier deposit, and all three are the
/// acquisition of one air conditioner.
///
/// Silence when NOTHING is attached is deliberate, and is what 0070 and 0099
/// both argue for: an asset the company already owned when this system arrived
/// has no line behind it, and most of the register on day one is exactly that.
/// `acquisition_gap` is what reports those, as a list rather than a refusal.
async fn check_acquisition_total(
    tx: &mut sqlx::PgConnection,
    asset_id: Uuid,
    capitalized_cost_minor: i64,
) -> Result<(), AppError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(l.amount_minor), 0)::bigint AS paid, COUNT(*)::bigint AS lines,
                string_agg(i.invoice_number || ' line ' || l.line_number, ', '
                           ORDER BY i.invoice_number, l.line_number) AS named
           FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i USING (invoice_id)
          WHERE l.asset_id = $1",
    )
    .bind(asset_id)
    .fetch_one(&mut *tx)
    .await?;
    let paid: i64 = row.try_get("paid")?;
    let lines: i64 = row.try_get("lines")?;
    if lines == 0 {
        return Ok(());
    }
    if paid != capitalized_cost_minor {
        let named: String = row
            .try_get::<Option<String>, _>("named")?
            .unwrap_or_default();
        return Err(AppError::Validation(format!(
            "the books paid {paid} for this across {lines} line(s) — {named} — and it is \
             capitalised at {capitalized_cost_minor}; the difference is {}. Capitalise it at what \
             the bill charged, or name every line that bought it.",
            (paid - capitalized_cost_minor).abs()
        )));
    }
    Ok(())
}

pub async fn register_asset(
    pool: &PgPool,
    request: &RegisterAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    // The class must be one the register actually keeps. Checked here so the
    // message names the problem and lists what would have worked; the foreign
    // key to `asset_class` is the guarantee.
    let category = request.category_code.trim();
    assert_asset_class(pool, category).await?;
    if let Some(quantity) = request.quantity {
        if quantity < 1 {
            return Err(AppError::Validation(
                "a lot is at least one thing; leave the quantity out for a single object".into(),
            ));
        }
    }
    let asset_id = Uuid::new_v4();
    // One transaction, and the asset is inserted BEFORE its line is attached:
    // the line's foreign key points here, so the other order cannot work. A
    // line that turns out not to be an asset purchase rolls the registration
    // back with it.
    //
    // No cost is known yet, so only the account is checked. What the books
    // paid is checked when Finance names a cost, in `assess_asset`.
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, acquired_on,
            serial_number, notes, registered_by, acquired_via_line_id, quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(asset_id)
    .bind(request.asset_number.trim())
    .bind(request.name.trim())
    .bind(category)
    .bind(&request.site_id)
    .bind(request.acquired_on)
    .bind(request.serial_number.as_deref())
    .bind(request.notes.as_deref())
    .bind(actor)
    .bind(request.acquired_via_line_id)
    .bind(request.quantity.unwrap_or(1))
    .execute(&mut *tx)
    .await?;
    if let Some(line_id) = request.acquired_via_line_id {
        attach_acquisition_lines(&mut tx, asset_id, &[line_id]).await?;
    }
    tx.commit().await?;
    asset(pool, asset_id).await
}

/// Record Finance's decision. Appended — the highest sequence is in force.
///
/// # Why CAPITALIZE posts nothing, and never will
///
/// It is tempting to have this write `Dr fixed_asset / Cr something` — it is,
/// after all, the moment a number is put on an asset. It must not, and the
/// reason is that there is no honest credit for it to write.
///
/// The company did not acquire the thing by deciding it was capital; it
/// acquired it by buying it from a supplier, and that purchase is already a
/// document that posts. 0094's expense bill debits whatever account its line
/// names, and class 1 is admitted precisely so a capital purchase can be coded
/// to the asset account. The acquisition entry therefore already exists, with
/// a supplier and a payable behind it, the moment the bill is posted.
///
/// An assessment that also posted would double the cost. An assessment that
/// posted against a clearing account would put a line in the client's books
/// their own accountant cannot explain, since their chart has no such account —
/// the same argument 0052 makes about goods-received-not-invoiced.
///
/// So this records a decision and writes no journal, and the link below is what
/// ties the decision to the entry that already carries the money.
/// `acquisition_gap` reports where the link is missing in either direction.
pub async fn assess_asset(
    pool: &PgPool,
    asset_id: Uuid,
    request: &AssessAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "an assessment needs a reason; it is the only record of why".into(),
        ));
    }
    if let Some(raw) = request.method.as_deref() {
        if DepreciationMethod::parse(raw).is_none() {
            return Err(AppError::Validation(format!(
                "unknown method {raw}; expected STRAIGHT_LINE, DECLINING or NONE"
            )));
        }
    }

    // What the charge is CALLED is asked, never inferred, and a capitalised
    // asset may not leave it unsaid. Silence here would have to be resolved
    // into something, and the only available something is "depreciation" —
    // which is exactly the wrong answer for the 200 operating-equipment rows
    // the client's own register labels NON DEPRECIABLE while charging them
    // every month. 0159 has the whole argument.
    //
    // The message names the values because "violates check constraint
    // asset_capitalization_charge_kind_follows_decision" is not a sentence
    // anybody can act on.
    let capitalising = request.decision.trim() == "CAPITALIZE";

    // The rate and the life, reconciled.
    //
    // Their register prints both — "20%" beside "5" — and they are one fact:
    // a straight line at 20% a year IS a five-year life. So either may be
    // given. Both, and they have to agree to the month, because a row saying
    // 20% over eight years is a row nobody can post from: one of the two
    // numbers is a typing mistake and this code cannot know which.
    //
    // Months rather than years, because that is what the arithmetic uses and
    // because a rate that does not divide a year evenly — 33.33% — lands on 36
    // months exactly while "3 years" and "3.0003 years" do not.
    // Neither given: the class's own default life (0467), as an ERPNext Asset
    // Category supplies one.
    let class_life: Option<i32> =
        if request.useful_life_months.is_none() && request.rate_bps.is_none() {
            sqlx::query_scalar(
                "SELECT c.default_useful_life_months FROM fixed_asset a
               JOIN asset_class c ON c.class_code = a.category_code
              WHERE a.asset_id = $1",
            )
            .bind(asset_id)
            .fetch_optional(pool)
            .await?
            .flatten()
        } else {
            None
        };
    let (useful_life_months, rate_bps) =
        reconcile_life(request.useful_life_months.or(class_life), request.rate_bps)?;
    let charge_kind = match request.charge_kind.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() => {
            if ChargeKind::parse(raw).is_none() {
                return Err(AppError::Validation(format!(
                    "unknown charge kind {raw}; expected DEPRECIATION, REPLACEMENT_RESERVE or \
                     AMORTISATION"
                )));
            }
            if !capitalising {
                return Err(AppError::Validation(
                    "an expensed asset has no monthly charge, so it names no charge kind".into(),
                ));
            }
            Some(raw)
        }
        _ if capitalising => {
            return Err(AppError::Validation(
                "say what the monthly charge is: DEPRECIATION, REPLACEMENT_RESERVE for operating \
                 equipment (the client's 1021607 is a reserve, not accumulated depreciation), or \
                 AMORTISATION for an intangible"
                    .into(),
            ))
        }
        _ => None,
    };

    // What was carried in from the old system, checked here so the refusal is
    // a sentence rather than the name of a CHECK constraint.
    //
    // The pair is the point. A figure with no month cannot be checked twice and
    // cannot stop a run from charging a period the old ledger already charged;
    // a month with no figure says a cutover happened and declines to say what
    // it carried.
    match (request.opening_accumulated_minor, request.opening_through) {
        (Some(_), None) | (None, Some(_)) => {
            return Err(AppError::Validation(
                "carried-in depreciation needs both the figure and the month it covers; \
                 send both or neither"
                    .into(),
            ))
        }
        (Some(opening), Some(through)) => {
            if !capitalising {
                return Err(AppError::Validation(
                    "only a capitalised asset has a basis to carry anything into".into(),
                ));
            }
            if opening < 0 {
                return Err(AppError::Validation(
                    "carried-in depreciation cannot be negative".into(),
                ));
            }
            let depreciable = request.capitalized_cost_minor.unwrap_or_default()
                - request.salvage_value_minor.unwrap_or_default();
            if opening > depreciable {
                return Err(AppError::Validation(format!(
                    "the old system cannot have written down more than there was to write \
                     down: {opening} carried in against {depreciable} depreciable"
                )));
            }
            if through.day() != 1 {
                return Err(AppError::Validation(
                    "the month a carried-in figure covers is named by its first day".into(),
                ));
            }
            if let Some(in_service) = request.in_service_on {
                if through < month_of(in_service) {
                    return Err(AppError::Validation(
                        "a carried-in figure cannot cover a month before the asset went into \
                         service"
                            .into(),
                    ));
                }
            }
        }
        (None, None) => {}
    }

    // Where it is filed now, and what its last assessment said. Both are
    // needed before anything is written: a re-filing is only legitimate out of
    // work in progress, and the answer to "is this asset in progress" is the
    // latest assessment rather than a column. The asset stands at a site; its
    // cost is in the books of the unit that owns the site.
    let standing = sqlx::query(
        "SELECT a.category_code, unit_of_site(a.site_id) AS unit_id,
                (SELECT x.decision FROM asset_capitalization x
                  WHERE x.asset_id = a.asset_id
                  ORDER BY x.sequence DESC LIMIT 1) AS decision
           FROM fixed_asset a WHERE a.asset_id = $1",
    )
    .bind(asset_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("asset".into()))?;
    let was: Option<String> = standing.try_get("decision")?;
    let filed_under: String = standing.try_get("category_code")?;
    let unit: String = standing.try_get("unit_id")?;

    // Finished work has to say what it became. Capitalising something filed
    // under Contract In Progress and leaving it there would put a building's
    // depreciation against the work-in-progress account for the rest of its
    // life — the books would carry a finished shop as work still going on.
    // Found by trying it: the re-filing was optional, and the omission was
    // silent.
    let leaving_progress =
        was.as_deref() == Some("IN_PROGRESS") && request.decision.trim() == "CAPITALIZE";

    let refiled = match request.category_code.as_deref().map(str::trim) {
        Some(code) if !code.is_empty() && code != filed_under => {
            if was.as_deref() != Some("IN_PROGRESS") {
                return Err(AppError::Validation(
                    "only work in progress may be re-filed, and only as it is capitalised: \
                     an asset already in a family stays in it"
                        .into(),
                ));
            }
            assert_asset_class(pool, code).await?;
            if code == WORK_IN_PROGRESS_CLASS {
                return Err(AppError::Validation(format!(
                    "{code} is what finished work stops being, not what it becomes; name the \
                     class it now belongs to"
                )));
            }
            Some(code.to_owned())
        }
        _ => None,
    };

    if refiled.is_none() && leaving_progress && filed_under == WORK_IN_PROGRESS_CLASS {
        return Err(AppError::Validation(
            "finished work has to be filed as what it became: send the class it now \
             belongs to — a capitalised asset cannot stay under Contract In Progress"
                .into(),
        ));
    }

    sqlx::query("SELECT 1 FROM fixed_asset WHERE asset_id = $1")
        .bind(asset_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("asset".into()))?;

    // Both spellings, unioned. A caller that names one line and a caller that
    // names three are the same act, and the lines already attached from an
    // earlier assessment stay attached — the sum below counts all of them,
    // which is what makes "the books paid this" answerable at all.
    let mut named: Vec<Uuid> = request.acquired_via_line_ids.clone().unwrap_or_default();
    if let Some(one) = request.acquired_via_line_id {
        if !named.contains(&one) {
            named.push(one);
        }
    }

    // Everything from here is one transaction, so a cost that does not
    // reconcile leaves neither an assessment nor a half-attached bill. The
    // order matters: attach first, because the sum has to see the lines being
    // named now, not only the ones named before.
    let mut tx = pool.begin().await?;
    attach_acquisition_lines(&mut tx, asset_id, &named).await?;
    if capitalising {
        if let Some(cost) = request.capitalized_cost_minor {
            check_acquisition_total(&mut tx, asset_id, cost).await?;
        }
    }

    let next: i32 = sqlx::query(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM asset_capitalization WHERE asset_id = $1",
    )
    .bind(asset_id)
    .fetch_one(&mut *tx)
    .await?
    .try_get("next")?;

    sqlx::query(
        "INSERT INTO asset_capitalization
           (capitalization_id, asset_id, sequence, decision, capitalized_cost_minor,
            salvage_value_minor, useful_life_months, method, charge_kind, in_service_on,
            reason, assessed_by, rate_bps, opening_accumulated_minor, opening_through)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    )
    .bind(Uuid::new_v4())
    .bind(asset_id)
    .bind(next)
    .bind(request.decision.trim())
    .bind(request.capitalized_cost_minor)
    .bind(request.salvage_value_minor)
    .bind(useful_life_months)
    .bind(request.method.as_deref())
    .bind(charge_kind)
    .bind(request.in_service_on)
    .bind(request.reason.trim())
    .bind(actor)
    .bind(rate_bps)
    .bind(request.opening_accumulated_minor)
    .bind(request.opening_through)
    .execute(&mut *tx)
    .await?;

    // The display pointer, set after the assessment so a refused one leaves no
    // link behind. Never cleared: `None` means "not saying", not "detach it".
    // Since 0160 the truth is `supplier_invoice_expense_line.asset_id` and this
    // is the first line of it, kept because screens still read it.
    if let Some(line_id) = request.acquired_via_line_id {
        sqlx::query("UPDATE fixed_asset SET acquired_via_line_id = $2 WHERE asset_id = $1")
            .bind(asset_id)
            .bind(line_id)
            .execute(&mut *tx)
            .await?;
    }

    // Finished work becomes what it was built into, and the cost moves with
    // it. In the same transaction as the assessment that capitalised it,
    // because the three are one act: an asset re-filed without an assessment
    // would be a cost that moved family for no stated reason, an assessment
    // without the re-filing would depreciate a building against the
    // work-in-progress account, and either without the journal would leave the
    // work-in-progress account carrying a shop that has been open for months.
    //
    // 0215 deliberately posted nothing here; 0242 is why that changed.
    if let Some(code) = refiled {
        sqlx::query("UPDATE fixed_asset SET category_code = $2 WHERE asset_id = $1")
            .bind(asset_id)
            .bind(&code)
            .execute(&mut *tx)
            .await?;

        let cost = request.capitalized_cost_minor.unwrap_or_default();
        let in_service = request.in_service_on.ok_or_else(|| {
            AppError::Validation("finished work has to say when it went into service".into())
        })?;
        let kind = charge_kind
            .and_then(ChargeKind::parse)
            .unwrap_or(ChargeKind::Depreciation);

        // Both legs of the move, and what each of them has to be.
        //
        // They land on ONE account now — `1031803 Contract In Progress` and the
        // fixed-asset families all became `1601` — so the entry is only a move
        // if the two carry different stages. Checked before anything is
        // written, because `Dr 1601 IN_SERVICE / Cr 1601 IN_SERVICE` for the
        // same asset balances, posts, and says nothing: the cost never leaves
        // work in progress and the balance sheet cannot tell unfinished work
        // from finished afterwards.
        let progress = asset_leg(
            &mut *tx,
            "work_in_progress",
            &unit,
            &filed_under,
            Some(ASSET_IN_PROGRESS),
        )
        .await?;
        let finished = asset_leg(
            &mut *tx,
            kind.cost_key(),
            &unit,
            &code,
            kind.cost_category(),
        )
        .await?;
        let progress_account = progress.account_code.clone();

        // What this entry will credit, and what is actually in it. The balance
        // is checked rather than assumed: every row imported from the client's
        // register has a cost their old ledger holds and this one does not, and
        // crediting it here would take the client's own account negative and
        // call the difference finished work.
        //
        // Narrowed to the STAGE and not just to the account. Summing `1601` in
        // the unit's books would count every capitalised asset there as work in
        // progress, so one finished building would let any number of contracts
        // be capitalised out of an account that holds nothing for them — which
        // is the guard defeating itself.
        let held: i64 = sqlx::query(
            "SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0)::bigint AS held
               FROM journal_line l
              WHERE l.account_code = $1 AND l.unit_id = $2
                AND l.category_code IS NOT DISTINCT FROM $3",
        )
        .bind(&progress_account)
        .bind(&unit)
        .bind(progress.category_code.as_deref())
        .fetch_one(&mut *tx)
        .await?
        .try_get("held")?;
        if held < cost {
            return Err(AppError::Validation(format!(
                "{progress_account}{} holds {held} and this capitalises {cost}: the work in \
                 progress was never posted here, so there is nothing to move out. Carry the \
                 opening balance in first — crediting it now would drive the client's own \
                 account negative.",
                match progress.category_code.as_deref() {
                    Some(stage) => format!(" ({stage})"),
                    None => String::new(),
                }
            )));
        }
        if (&finished.account_code, &finished.category_code)
            == (&progress.account_code, &progress.category_code)
        {
            return Err(AppError::Validation(format!(
                "capitalising this would debit and credit {progress_account} for the same asset \
                 and leave the cost exactly where it was. Finished work and work in progress are \
                 one account with two stages now — point {} and work_in_progress at different \
                 ones on the Account Links screen.",
                kind.cost_key()
            )));
        }

        let intent = PostingIntent {
            posting_date: in_service,
            source_kind: "ASSET_CAPITALIZATION".into(),
            source_id: Some(asset_id.to_string()),
            rule_version: "asset_capitalization/1".into(),
            currency: "IDR".into(),
            memo: Some(format!(
                "Reklas CIP {in_service} — {} menjadi {code}",
                filed_under
            )),
            lines: vec![
                PostingLine::debit(kind.cost_key(), &unit, cost).with_qualifier(&code),
                PostingLine::credit("work_in_progress", &unit, cost).with_qualifier(&filed_under),
            ],
        };
        post(&mut tx, &intent, None, actor).await?;
    }
    tx.commit().await?;
    // A DRAFT asset is one a posted bill line minted; assessing it is a person
    // saying they have seen what the bill bought. That is exactly what
    // REGISTERED has always meant, so this is not a new state machine — it is
    // the draft joining the one that already exists. Guarded on DRAFT so an
    // asset already IN_SERVICE is not walked backwards by a re-assessment.
    sqlx::query(
        "UPDATE fixed_asset SET status = 'REGISTERED' WHERE asset_id = $1 AND status = 'DRAFT'",
    )
    .bind(asset_id)
    .execute(pool)
    .await?;
    asset(pool, asset_id).await
}

/// What one month's run did, asset by asset.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepreciationLine {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub amount_minor: Option<i64>,
    /// Absent when something was posted. Present, and named, when it was not —
    /// a run report that says "nothing" without saying why is a report somebody
    /// has to re-derive by hand.
    pub skipped_because: Option<String>,
    /// Only ever set by a preview: this asset has a charge to make, but a
    /// required account mapping or Finance's source-posting control blocks it.
    ///
    /// A real run cannot report this, because it stops at the first asset it
    /// cannot resolve — which is why the preview exists. Absent in a run, and
    /// absent in a preview for every asset that would post.
    pub blocked_because: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepreciationRun {
    pub period_month: NaiveDate,
    /// In a preview these two are what WOULD post, and nothing has been
    /// written. In a run they are what did.
    pub posted_count: i64,
    pub posted_total_minor: i64,
    pub skipped_count: i64,
    /// Assets a preview found with a charge that cannot post under the current
    /// account mappings and Finance posting control. Always zero in a run.
    pub blocked_count: i64,
    pub lines: Vec<DepreciationLine>,
}

fn skip_label(reason: SkipReason) -> &'static str {
    match reason {
        SkipReason::NotDepreciated => "not depreciated — the category has no method",
        SkipReason::FullyDepreciated => "already at salvage",
        SkipReason::NothingAboveSalvage => "cost is at or below salvage",
        SkipReason::NoUsefulLife => "no useful life",
        SkipReason::BelowSmallestUnit => "this month's share rounds to nothing",
    }
}

/// Months from one date to another, counting only whole months.
///
/// The period index the schedule needs: 0 for the month an asset went into
/// service, 1 for the next. Calendar arithmetic, so a quiet month still
/// advances it — which is the whole reason the index is not a count of entries.
fn months_between(from: NaiveDate, to: NaiveDate) -> i32 {
    (to.year() - from.year()) * 12 + (to.month() as i32 - from.month() as i32)
}

/// Charge one month of depreciation across every capitalised asset.
///
/// Idempotent by construction: the unique index on (asset, period) refuses a
/// second entry, so re-running a month posts nothing and reports every asset as
/// already done rather than doubling the charge.
/// Charge one month, for real.
pub async fn run_depreciation(
    pool: &PgPool,
    year: i32,
    month: u32,
    actor: &str,
) -> Result<DepreciationRun, AppError> {
    charge_month(pool, year, month, Some(actor)).await
}

/// What charging that month would do, without doing any of it.
///
/// The run it previews posts asset by asset and stops at the first account it
/// cannot resolve, which is the right behaviour for a run and useless for
/// looking ahead: the operator learns about one refusal and nothing about the
/// other four hundred. So a preview resolves both legs per asset and reports
/// account-mapping refusals, as well as Finance's global posting pause, instead
/// of raising either before the operator can review the month.
///
/// It writes nothing, which is the whole point on a register carrying 683
/// capitalised assets whose first real run posts into the client's books.
pub async fn preview_depreciation(
    pool: &PgPool,
    year: i32,
    month: u32,
) -> Result<DepreciationRun, AppError> {
    let mut preview = charge_month(pool, year, month, None).await?;
    let automatic_posting_enabled = sqlx::query_scalar::<_, bool>(
        "SELECT automatic_posting_enabled
           FROM finance_posting_control
          WHERE singleton = true",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or(false);

    if !automatic_posting_enabled {
        let reason = "automatic posting is paused while Finance reviews the chart and posting maps; submit a manual Finance journal instead";
        for line in &mut preview.lines {
            let Some(amount) = line.amount_minor else {
                continue;
            };
            if line.blocked_because.is_some() {
                continue;
            }
            line.blocked_because = Some(reason.into());
            preview.posted_count -= 1;
            preview.posted_total_minor -= amount;
            preview.blocked_count += 1;
        }
    }

    Ok(preview)
}

/// One month, posted when an actor is given and rehearsed when none is.
async fn charge_month(
    pool: &PgPool,
    year: i32,
    month: u32,
    posting: Option<&str>,
) -> Result<DepreciationRun, AppError> {
    let period = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;

    let rows = sqlx::query(DUE_CANDIDATES)
        .bind(period)
        .fetch_all(pool)
        .await?;

    let mut lines = Vec::with_capacity(rows.len());
    let mut posted_count = 0i64;
    let mut posted_total = 0i64;
    let mut skipped = 0i64;
    let mut blocked = 0i64;

    for row in &rows {
        let asset_id: Uuid = row.try_get("asset_id")?;
        let asset_number: String = row.try_get("asset_number")?;
        let name: String = row.try_get("name")?;

        if row.try_get::<bool, _>("already")? {
            skipped += 1;
            lines.push(DepreciationLine {
                asset_id,
                asset_number,
                name,
                amount_minor: None,
                blocked_because: None,
                skipped_because: Some("already charged for this month".into()),
            });
            continue;
        }

        // A month the system this one replaced already charged. Nothing here
        // would collide with it — this system has no entry for that month — so
        // without the cutover date the charge would simply be made twice, once
        // in each ledger, and the second one would look ordinary.
        let opening_through: Option<NaiveDate> = row.try_get("opening_through")?;
        if matches!(opening_through, Some(through) if period <= through) {
            skipped += 1;
            lines.push(DepreciationLine {
                asset_id,
                asset_number,
                name,
                amount_minor: None,
                blocked_because: None,
                skipped_because: Some(format!(
                    "carried in: the opening figure already covers {}",
                    period.format("%Y-%m")
                )),
            });
            continue;
        }

        let in_service: NaiveDate = row.try_get("in_service_on")?;
        let method = DepreciationMethod::parse(&row.try_get::<String, _>("method")?)
            .unwrap_or(DepreciationMethod::None);
        // Defaulted rather than refused: 0159's CHECK guarantees a capitalised
        // row names one, and a monthly run is the wrong place to stop the world
        // over a value the schema already will not admit.
        let kind = row
            .try_get::<Option<String>, _>("charge_kind")?
            .as_deref()
            .and_then(ChargeKind::parse)
            .unwrap_or(ChargeKind::Depreciation);
        let basis = Basis {
            method,
            capitalized_cost_minor: row.try_get("capitalized_cost_minor")?,
            salvage_value_minor: row.try_get("salvage_value_minor")?,
            useful_life_months: row.try_get("useful_life_months")?,
            accumulated_minor: row.try_get("accumulated")?,
            period_index: months_between(in_service, period),
        };

        match monthly_charge(basis) {
            Outcome::Skip(reason) => {
                skipped += 1;
                lines.push(DepreciationLine {
                    asset_id,
                    asset_number,
                    name,
                    amount_minor: None,
                    blocked_because: None,
                    skipped_because: Some(skip_label(reason).into()),
                });
            }
            Outcome::Post(amount) => {
                let category: String = row.try_get("category_code")?;
                // The asset stands at a site; the charge lands in the books of
                // the unit that owns it.
                let unit: String = row.try_get("unit_id")?;
                // The class is the qualifier. `MACHINERY` resolves through the
                // map to `7101` with its expense meaning and `1609` with its
                // contra one, so the run names no account itself. It is also
                // why the class had to stop being an account code: the qualifier
                // is matched EXACTLY, and the client's register spelled the same
                // class as `1021507` in the seed and `1021507001` in the import,
                // so every imported asset resolved to nothing and was refused.
                // DEPRECIATION, not MANUAL. A machine wrote this entry, and
                // calling it manual made 44 of the ledger's 58 "hand-typed"
                // entries machine-written: an auditor filtering for the ones a
                // person could have got wrong was handed a list four times too
                // long, with no way to tell which fourteen were real. The kind
                // was added to the CHECK in 0083, which also relabelled the
                // entries the old rule wrote.
                //
                // `source_id` is the asset. Every other non-manual kind points
                // back at the document that caused it — a bill, a sale — and
                // this one had nothing to point at, so an entry charging
                // `AST-0007` said so only inside a memo string. It is also what
                // the schema's own CHECK asks for: a non-MANUAL, non-REVERSAL
                // entry must carry a source.
                //
                // `source_kind` was DEPRECIATION for all three charge kinds, on
                // the argument that it names the RULE — the monthly asset run —
                // rather than what the charge is called. 0266 had already
                // decided otherwise and this file had not caught up: it added
                // `AMORTIZATION_RUN` precisely because "pre-opening and
                // intangible amortisation is a different economic event, and a
                // source allow-list that cannot tell them apart cannot be read
                // by the person maintaining it", and then 0267 wrote such a
                // list — `AMORTIZATION_RUN` and `OPENING` and nothing else on
                // the amortisation charge.
                //
                // Nothing ever wrote the kind, so the list bound nothing while
                // the rule it was written against sat on a retired account.
                // 0294 moved it onto `7101 × AMORTISATION`, where it applies —
                // and would refuse every amortisation this run posts, because
                // the run says DEPRECIATION. The honest fix is the one 0266
                // asked for: say which event this is. A replacement charge
                // keeps ASSET_RESERVE's own kind out of it, because the reserve
                // is formed by `reserves.rs` and this run only ever charges an
                // asset that has one.
                let source_kind = match kind {
                    ChargeKind::Amortisation => "AMORTIZATION_RUN",
                    _ => "DEPRECIATION",
                };
                let intent = PostingIntent {
                    posting_date: period,
                    source_kind: source_kind.into(),
                    source_id: Some(asset_id.to_string()),
                    rule_version: "depreciation/1".into(),
                    currency: "IDR".into(),
                    memo: Some(format!("{} {period} — {asset_number} {name}", kind.label())),
                    lines: vec![
                        PostingLine::debit(kind.expense_key(), &unit, amount)
                            .with_qualifier(&category),
                        PostingLine::credit(kind.contra_key(), &unit, amount)
                            .with_qualifier(&category),
                    ],
                };
                let Some(actor) = posting else {
                    // A rehearsal. Both legs are resolved so the report can
                    // name the asset that has nowhere to charge — the run
                    // itself cannot, because the first such asset ends it.
                    let refusal = charge_legs(pool, kind, &unit, &category)
                        .await
                        .err()
                        .map(|error| error.to_string());
                    if refusal.is_some() {
                        blocked += 1;
                    } else {
                        posted_count += 1;
                        posted_total += amount;
                    }
                    lines.push(DepreciationLine {
                        asset_id,
                        asset_number,
                        name,
                        amount_minor: Some(amount),
                        blocked_because: refusal,
                        skipped_because: None,
                    });
                    continue;
                };

                // The same two legs the rehearsal resolves, asked for real. The
                // poster resolves them again a moment later and would refuse a
                // miscategorised row on its own; asked here, the refusal names
                // the map entry and the asset instead of a line number inside
                // an entry nobody has seen.
                charge_legs(pool, kind, &unit, &category).await?;

                let mut tx = pool.begin().await?;
                // The month is the step. `source_id` is the asset and the asset
                // is charged every month, so the document alone cannot say which
                // charge this is — and under migration 0140's key it would make
                // October's charge look like a duplicate of September's. Naming
                // the period also gives the run the idempotency it never had:
                // charging one asset twice for one month is now refused by the
                // database rather than by `asset_depreciation_entry` being read
                // a moment before it is written.
                let purpose = format!("PERIOD_{}", period.format("%Y%m"));
                let posted = post(&mut tx, &intent, Some(&purpose), actor).await?;
                sqlx::query(
                    "INSERT INTO asset_depreciation_entry
                       (entry_id, asset_id, period_month, amount_minor, journal_entry_id, posted_by)
                     VALUES ($1,$2,$3,$4,$5,$6)",
                )
                .bind(Uuid::new_v4())
                .bind(asset_id)
                .bind(period)
                .bind(amount)
                .bind(posted.entry_id)
                .bind(actor)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;

                posted_count += 1;
                posted_total += amount;
                lines.push(DepreciationLine {
                    asset_id,
                    asset_number,
                    name,
                    amount_minor: Some(amount),
                    blocked_because: None,
                    skipped_because: None,
                });
            }
        }
    }

    Ok(DepreciationRun {
        period_month: period,
        posted_count,
        posted_total_minor: posted_total,
        skipped_count: skipped,
        blocked_count: blocked,
        lines,
    })
}

/// Which categories still have no accounts mapped.
///
/// The run cannot charge an asset whose category has no expense or accumulated
/// account, and it should say so before somebody runs a month and reads a wall
/// of refusals.
pub async fn unmapped_categories(pool: &PgPool) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT a.category_code, unit_of_site(a.site_id) AS unit_id, k.charge_kind
           FROM fixed_asset a
           JOIN LATERAL (
               SELECT * FROM asset_capitalization x
                WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
           ) k ON true
          WHERE k.decision = 'CAPITALIZE' AND k.method <> 'NONE'",
    )
    .fetch_all(pool)
    .await?;
    let mut missing = Vec::new();
    for row in &rows {
        let category: String = row.try_get("category_code")?;
        // Asked in the books the charge would land in: the unit that owns the
        // asset's site.
        let unit: String = row.try_get("unit_id")?;
        // An operating-equipment category needs `replacement_*` mapped and an
        // intangible needs `amortisation_*`; reporting the depreciation pair
        // as missing for either would send somebody to map an account that
        // will never be read.
        let kind = row
            .try_get::<Option<String>, _>("charge_kind")?
            .as_deref()
            .and_then(ChargeKind::parse)
            .unwrap_or(ChargeKind::Depreciation);
        // A row mapped to the wrong CATEGORY is as unusable as one mapped to
        // nothing, and used to be invisible here: it resolved, this screen said
        // nothing, and the month refused. Both faults are listed, and each one
        // names which leg it is about.
        for (key, expected) in [
            (kind.expense_key(), Some(kind.expense_category())),
            (kind.contra_key(), None),
        ] {
            if let Err(error) = asset_leg(pool, key, &unit, &category, expected).await {
                missing.push(format!(
                    "{key} for {category} in the books of {unit}: {error}"
                ));
            }
        }
    }
    Ok(missing)
}

// ---------------------------------------------------------------------------
// Leaving the register
// ---------------------------------------------------------------------------
//
// 0070 registered an asset and charged it every month, and nothing could ever
// take it off again. What follows is the other end of the life: it is sold or
// scrapped, or it simply moves to another shop.

/// The meanings proceeds can arrive into. The same four `supplier_payment`
/// admits, and for the same reason: without the constraint an asset could be
/// sold into `inventory` and the entry would balance.
const PROCEEDS_KEYS: [&str; 4] = ["bank_giro", "bank_savings", "cash", "petty_cash"];

const SOLD: &str = "SOLD";
const WRITTEN_OFF: &str = "WRITTEN_OFF";

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DisposeAssetRequest {
    /// The date it left, and the date the entry posts to. There is no separate
    /// posting date: unlike a bill, which arrives on one day and is booked on
    /// another, an asset leaves the books on the day it leaves.
    pub disposed_on: NaiveDate,
    /// What it fetched. Zero is a real answer — a machine given away for
    /// nothing was still disposed of.
    #[serde(default)]
    pub proceeds_minor: i64,
    /// `SOLD` or `WRITTEN_OFF`. A write-off fetches nothing by definition, and
    /// the database refuses one that claims otherwise.
    pub method: String,
    /// Where the money arrived: one of `bank_giro`, `bank_savings`, `cash`,
    /// `petty_cash`. Required when there are proceeds and meaningless without
    /// them — a meaning and a qualifier, never a client account code, exactly
    /// as `supplier_payment` says which pot money left.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub proceeds_account_key: Option<String>,
    /// Which bank. Empty for cash, which needs no narrowing.
    #[serde(default)]
    pub proceeds_account_qualifier: String,
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TransferAssetRequest {
    pub to_site: String,
    pub moved_on: NaiveDate,
    pub memo: Option<String>,
}

/// The month a date belongs to, named by its first day — the same key
/// `asset_depreciation_entry.period_month` uses.
fn month_of(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap_or(date)
}

/// Whether the depreciation run still owes this asset a charge for a month.
///
/// This is the rule disposal refuses on, and it is worth stating exactly:
/// **an asset may not leave the books while the run still owes it a charge for
/// the month it left in.** Disposing on 14 August before August's run means the
/// gain or loss is computed against a book value that is one month too high, so
/// the loss is overstated by exactly that month and the depreciation expense
/// understated by it — two wrong figures in two different statements, and a
/// trial balance that still balances.
///
/// "Owes" is asked of the arithmetic rather than of the entry table, because a
/// month with no entry is not the same as a month not run. Land charges
/// nothing, ever. An asset already at salvage charges nothing. A small asset
/// with a long life charges nothing in a month whose share rounds below one
/// rupiah. In all three the run HAS reached the month and correctly wrote no
/// row, and refusing those would make some assets undisposable.
fn charge_is_owed(asset: &AssetRow, period: NaiveDate) -> bool {
    let method = match asset.method.as_deref().and_then(DepreciationMethod::parse) {
        Some(method) => method,
        None => return false,
    };
    let (Some(cost), Some(salvage), Some(life), Some(in_service)) = (
        asset.capitalized_cost_minor,
        asset.salvage_value_minor,
        asset.useful_life_months,
        asset.in_service_on,
    ) else {
        return false;
    };
    // Not in service by the end of that month; the run would not have looked at
    // it. `period_index` would be negative here, which the arithmetic does not
    // expect and does not need to.
    if month_of(in_service) > period {
        return false;
    }
    if asset
        .last_depreciated_month
        .is_some_and(|last| last >= period)
    {
        return false;
    }
    matches!(
        monthly_charge(Basis {
            method,
            capitalized_cost_minor: cost,
            salvage_value_minor: salvage,
            useful_life_months: life,
            accumulated_minor: asset.accumulated_minor,
            period_index: months_between(in_service, period),
        }),
        Outcome::Post(_)
    )
}

/// Take an asset off the books.
///
/// # The entry
///
/// ```text
///   Cr  fixed_asset               cost              the asset leaves at what it came in at
///   Dr  accumulated_depreciation  accumulated       and so does everything charged against it
///   Dr  cash / bank_*             proceeds          what it fetched, if anything
///   Dr  asset_disposal_loss       the difference    when it was worth more than it fetched
///   Cr  asset_disposal_result     the difference    when it fetched more than it was worth
/// ```
///
/// Both asset accounts are qualified by the category, exactly as the monthly
/// run qualifies them, so a disposal empties the same pair of accounts the
/// charges filled. The result leg is the only one whose amount nobody chose: it
/// is `cost - accumulated - proceeds`, which is net book value less what was
/// received, and its sign decides which MEANING it goes to — two since 0296,
/// because a loss debited into the gain's revenue account was a cost filed
/// under income. This is the one moment the sign is known, so the side is
/// chosen here and not on the Account Links screen.
pub async fn dispose_asset(
    pool: &PgPool,
    asset_id: Uuid,
    request: &DisposeAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    let existing = asset(pool, asset_id).await?;

    let method = request.method.trim().to_ascii_uppercase();
    if method != SOLD && method != WRITTEN_OFF {
        return Err(AppError::Validation(format!(
            "'{method}' is not a way of disposing of an asset; expected {} or {}",
            SOLD, WRITTEN_OFF
        )));
    }
    if existing.status == "DISPOSED" {
        return Err(AppError::Conflict(format!(
            "{} was already disposed of on {}; reverse its disposal entry rather than disposing \
             of it twice",
            existing.asset_number,
            existing
                .disposed_on
                .map(|d| d.to_string())
                .unwrap_or_else(|| "an unknown date".into())
        )));
    }
    // The in-force assessment, not `status`. `status` is Operations' word for
    // where the thing is in its own life; whether it is IN the books is
    // Finance's decision, and it is the highest sequence of
    // `asset_capitalization`. An asset Finance expensed has no cost in the
    // ledger, so there is nothing for a disposal entry to remove.
    if existing.decision.as_deref() != Some("CAPITALIZE") {
        return Err(AppError::Validation(format!(
            "{} is {}; only a capitalised asset carries a cost the books can take out. Assess it \
             first, or simply retire it in the register.",
            existing.asset_number,
            match existing.decision.as_deref() {
                Some(other) => format!("assessed {}", other.to_lowercase()),
                None => "not assessed".into(),
            }
        )));
    }
    if request.disposed_on < existing.acquired_on {
        return Err(AppError::Validation(format!(
            "{} was acquired on {} and cannot have left before it arrived",
            existing.asset_number, existing.acquired_on
        )));
    }
    if request.proceeds_minor < 0 {
        return Err(AppError::Validation(
            "proceeds cannot be negative; a cost of disposal is a bill, not a negative sale".into(),
        ));
    }
    if method == WRITTEN_OFF && request.proceeds_minor != 0 {
        return Err(AppError::Validation(format!(
            "a write-off fetches nothing, and this one fetched {}; record it as {}",
            request.proceeds_minor, SOLD
        )));
    }

    let proceeds_key = request
        .proceeds_account_key
        .as_deref()
        .map(|raw| raw.trim().to_ascii_lowercase())
        .filter(|key| !key.is_empty());
    if request.proceeds_minor > 0 {
        match proceeds_key.as_deref() {
            None => {
                return Err(AppError::Validation(format!(
                    "say where the {} went: one of {}",
                    request.proceeds_minor,
                    PROCEEDS_KEYS.join(", ")
                )))
            }
            Some(key) if !PROCEEDS_KEYS.contains(&key) => {
                return Err(AppError::Validation(format!(
                    "'{key}' is not an account money arrives into; expected one of {}",
                    PROCEEDS_KEYS.join(", ")
                )))
            }
            Some(_) => {}
        }
    }

    let period = month_of(request.disposed_on);
    if charge_is_owed(&existing, period) {
        return Err(AppError::Conflict(format!(
            "{} is depreciated through {}; run depreciation for {} before disposing of it, or the \
             gain or loss is computed against a book value one month too high",
            existing.asset_number,
            existing
                .last_depreciated_month
                .map(|month| month.format("%Y-%m").to_string())
                .unwrap_or_else(|| "nothing".into()),
            period.format("%Y-%m")
        )));
    }

    // The basis is guaranteed complete by 0070's CHECK on a CAPITALIZE row, so
    // these cannot be absent once the decision is CAPITALIZE. Defaulting rather
    // than unwrapping: a panic in a posting path is never the right answer.
    let cost = existing.capitalized_cost_minor.unwrap_or_default();
    let accumulated = existing.accumulated_minor;
    // The asset stands at a site; its cost, its contra and whatever it fetched
    // are all in the books of the unit that owns the site.
    let unit = super::sites::unit_of_site(pool, &existing.site_id).await?;
    let category = existing.category_code.clone();
    // Where the cost sits and what its contra is called both follow the charge
    // kind: an intangible's cost is not in the fixed-asset account, and
    // operating equipment's contra is a reserve. The same two lines, through whichever
    // pair of meanings this asset was charged through every month.
    let kind = existing
        .charge_kind
        .as_deref()
        .and_then(ChargeKind::parse)
        .unwrap_or(ChargeKind::Depreciation);

    let mut lines =
        vec![PostingLine::credit(kind.cost_key(), &unit, cost).with_qualifier(&category)];
    if accumulated > 0 {
        lines.push(
            PostingLine::debit(kind.contra_key(), &unit, accumulated).with_qualifier(&category),
        );
    }
    if request.proceeds_minor > 0 {
        if let Some(key) = proceeds_key.as_deref() {
            lines.push(
                PostingLine::debit(key, &unit, request.proceeds_minor)
                    .with_qualifier(request.proceeds_account_qualifier.trim())
                    .for_asset(asset_id),
            );
        }
    }
    // Positive is a loss — the asset was worth more than it fetched — and a
    // loss is a debit to `asset_disposal_loss` on `8301`. Negative is a gain,
    // and a credit to `asset_disposal_result` on `4301`. Which way it falls is
    // arithmetic, and so is which key: a disposal at exactly book value posts
    // neither, and a disposal never debits the gain key, because that key sits
    // in revenue and a loss there is the defect 0296 exists to cure.
    let result = cost - accumulated - request.proceeds_minor;
    match result.cmp(&0) {
        std::cmp::Ordering::Greater => {
            lines.push(PostingLine::debit("asset_disposal_loss", &unit, result).for_asset(asset_id))
        }
        std::cmp::Ordering::Less => lines
            .push(PostingLine::credit("asset_disposal_result", &unit, -result).for_asset(asset_id)),
        std::cmp::Ordering::Equal => {}
    }

    let intent = PostingIntent {
        posting_date: request.disposed_on,
        source_kind: "ASSET_DISPOSAL".into(),
        source_id: Some(asset_id.to_string()),
        rule_version: "asset_disposal/1".into(),
        currency: "IDR".into(),
        memo: Some(match request.memo.as_deref().map(str::trim) {
            Some(note) if !note.is_empty() => format!(
                "{} {} — {} — {note}",
                existing.asset_number,
                existing.name,
                method.to_lowercase()
            ),
            _ => format!(
                "{} {} — {}",
                existing.asset_number,
                existing.name,
                method.to_lowercase()
            ),
        }),
        lines,
    };

    let mut tx = pool.begin().await?;
    // An asset leaves the books once, so MAIN is the whole of it.
    let posted = post(&mut tx, &intent, None, actor).await?;
    // One statement, so the CHECK that ties DISPOSED to its entry, its method
    // and its proceeds is satisfied by the row as a whole. Setting them one at
    // a time would fail on the first.
    sqlx::query(
        "UPDATE fixed_asset
            SET status='DISPOSED', disposed_on=$2, disposal_method=$3,
                disposal_proceeds_minor=$4, disposal_journal_entry_id=$5
          WHERE asset_id=$1",
    )
    .bind(asset_id)
    .bind(request.disposed_on)
    .bind(&method)
    .bind(request.proceeds_minor)
    .bind(posted.entry_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    asset(pool, asset_id).await
}

/// Move an asset, and move its money with it.
///
/// # The entry
///
/// ```text
///   Cr  fixed_asset               cost         in the unit it left
///   Dr  fixed_asset               cost         in the one it arrived in
///   Dr  accumulated_depreciation  accumulated  in the unit it left
///   Cr  accumulated_depreciation  accumulated  in the one it arrived in
/// ```
///
/// Both halves, not just the cost. The client keeps a profit and loss per
/// unit and their account codes carry the unit, so moving the cost alone
/// would leave the old unit carrying accumulated depreciation against an asset
/// it no longer has and the new one carrying a cost with nothing charged
/// against it — two balance sheets wrong by the same amount in opposite
/// directions, and a trial balance that still balances.
///
/// The legs are in the books of the unit that owns each site. A move between
/// two units is an inter-unit entry, and the poster adds the affiliate legs
/// that balance each unit (through head office, I8). A move between two sites
/// of ONE unit changes no books at all — the same account, the same unit,
/// debited and credited — so no entry is written for it.
///
/// An asset Finance decided to EXPENSE has no cost in the books, so there is
/// nothing to move and no entry is written. The move is still recorded:
/// somebody has to be able to find the thing.
pub async fn transfer_asset(
    pool: &PgPool,
    asset_id: Uuid,
    request: &TransferAssetRequest,
    actor: &str,
) -> Result<AssetRow, AppError> {
    let existing = asset(pool, asset_id).await?;
    let to_site = request.to_site.trim();

    if existing.status == "DISPOSED" {
        return Err(AppError::Conflict(format!(
            "{} left the books on {}; a disposed asset has nowhere to move to",
            existing.asset_number,
            existing
                .disposed_on
                .map(|d| d.to_string())
                .unwrap_or_else(|| "an unknown date".into())
        )));
    }
    if to_site == existing.site_id {
        return Err(AppError::Validation(format!(
            "{} is already at {}; a move to where it already is would post a debit and a credit \
             to one account and say nothing",
            existing.asset_number, existing.site_id
        )));
    }
    // The foreign key on `asset_transfer.to_site` is the guarantee; it arrives
    // as SQLSTATE 23503 and reaches a person as "database operation failed",
    // which names neither the column nor the value they typed.
    let known: bool = sqlx::query("SELECT EXISTS (SELECT 1 FROM site WHERE id = $1) AS ok")
        .bind(to_site)
        .fetch_one(pool)
        .await?
        .try_get("ok")?;
    if !known {
        return Err(AppError::NotFound(format!("location {to_site}")));
    }

    let capitalised = existing.decision.as_deref() == Some("CAPITALIZE");
    let cost = existing.capitalized_cost_minor.unwrap_or_default();
    let accumulated = existing.accumulated_minor;
    let from_site = existing.site_id.clone();
    let from_unit = super::sites::unit_of_site(pool, &from_site).await?;
    let to_unit = super::sites::unit_of_site(pool, to_site).await?;
    let category = existing.category_code.clone();
    let kind = existing
        .charge_kind
        .as_deref()
        .and_then(ChargeKind::parse)
        .unwrap_or(ChargeKind::Depreciation);

    let mut tx = pool.begin().await?;
    let entry_id = if capitalised && cost > 0 && from_unit != to_unit {
        let mut lines = vec![
            PostingLine::credit(kind.cost_key(), &from_unit, cost).with_qualifier(&category),
            PostingLine::debit(kind.cost_key(), &to_unit, cost).with_qualifier(&category),
        ];
        if accumulated > 0 {
            lines.push(
                PostingLine::debit(kind.contra_key(), &from_unit, accumulated)
                    .with_qualifier(&category),
            );
            lines.push(
                PostingLine::credit(kind.contra_key(), &to_unit, accumulated)
                    .with_qualifier(&category),
            );
        }
        let intent = PostingIntent {
            posting_date: request.moved_on,
            source_kind: "ASSET_TRANSFER".into(),
            source_id: Some(asset_id.to_string()),
            rule_version: "asset_transfer/1".into(),
            currency: "IDR".into(),
            memo: Some(match request.memo.as_deref().map(str::trim) {
                Some(note) if !note.is_empty() => format!(
                    "{} {} — {from_site} to {to_site} — {note}",
                    existing.asset_number, existing.name
                ),
                _ => format!(
                    "{} {} — {from_site} to {to_site}",
                    existing.asset_number, existing.name
                ),
            }),
            lines,
        };
        // The date is the step. An asset moves more than once in its life and
        // `source_id` is the asset, so — as with the monthly charge — the
        // document alone cannot say which move this is. Naming the day also
        // makes the second attempt at one move a refusal rather than a second
        // entry: an asset does not go to two places on one date.
        let purpose = format!("MOVED_{}", request.moved_on.format("%Y%m%d"));
        Some(
            post(&mut tx, &intent, Some(&purpose), actor)
                .await?
                .entry_id,
        )
    } else {
        None
    };

    sqlx::query(
        "INSERT INTO asset_transfer
           (transfer_id, asset_id, from_site, to_site, moved_on, journal_entry_id, memo, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(Uuid::new_v4())
    .bind(asset_id)
    .bind(&from_site)
    .bind(to_site)
    .bind(request.moved_on)
    .bind(entry_id)
    .bind(request.memo.as_deref())
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE fixed_asset SET site_id=$2 WHERE asset_id=$1")
        .bind(asset_id)
        .bind(to_site)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    asset(pool, asset_id).await
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/// One month the run actually charged.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetScheduleRow {
    /// Named by the month's first day, which is how the entry is keyed.
    pub period_month: NaiveDate,
    pub amount_minor: i64,
    pub entry_id: Uuid,
    /// So a row links straight to the journal without a second fetch.
    pub entry_number: String,
}

/// What has been charged against one asset, and what is left to charge.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetSchedule {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    /// The treatment in force. Absent when nobody has assessed the asset.
    pub decision: Option<String>,
    pub method: Option<String>,
    pub capitalized_cost_minor: Option<i64>,
    pub salvage_value_minor: Option<i64>,
    pub useful_life_months: Option<i32>,
    pub in_service_on: Option<NaiveDate>,
    /// What the old system had already charged when this one took over, and
    /// the last month it covers. The schedule shows it as its own line rather
    /// than folding it into `charged_total_minor`: one is a figure somebody
    /// carried in, the other is a list of journals this system can name.
    pub opening_accumulated_minor: Option<i64>,
    pub opening_through: Option<NaiveDate>,

    /// What was actually posted, month by month, oldest first.
    ///
    /// The record of what happened, not a projection of what should have. A
    /// month the run never reached simply is not here, and a month it reached
    /// and skipped is not here either — which is why `months_remaining` is
    /// computed from the calendar rather than from the length of this list.
    pub charged: Vec<AssetScheduleRow>,
    pub charged_total_minor: i64,
    pub last_depreciated_month: Option<NaiveDate>,

    /// Calendar months still inside the asset's life, counted from the month
    /// after the last one charged — or from the month it went into service when
    /// nothing has been charged at all.
    ///
    /// From the calendar and not from a count of entries, for the reason
    /// `Basis::period_index` gives: a small asset charges nothing for months at
    /// a time, and counting entries would leave such an asset permanently short
    /// of its last instalment. Zero once there is nothing left to charge, even
    /// when calendar months remain — an asset at salvage is finished.
    pub months_remaining: i32,
    /// `(cost - salvage) - accumulated`, floored at zero. What the remaining
    /// months have left to spread, and the figure the final instalment sweeps.
    pub remaining_depreciable_minor: i64,
}

/// The depreciation actually charged against one asset, and what remains.
pub async fn asset_schedule(pool: &PgPool, asset_id: Uuid) -> Result<AssetSchedule, AppError> {
    let row = asset(pool, asset_id).await?;

    let charged_rows = sqlx::query(
        "SELECT d.period_month, d.amount_minor, d.journal_entry_id, e.entry_number
           FROM asset_depreciation_entry d
           JOIN journal_entry e ON e.entry_id = d.journal_entry_id
          WHERE d.asset_id = $1
          ORDER BY d.period_month",
    )
    .bind(asset_id)
    .fetch_all(pool)
    .await?;

    let mut charged = Vec::with_capacity(charged_rows.len());
    let mut charged_total = 0i64;
    for entry in &charged_rows {
        let amount: i64 = entry.try_get("amount_minor")?;
        charged_total += amount;
        charged.push(AssetScheduleRow {
            period_month: entry.try_get("period_month")?,
            amount_minor: amount,
            entry_id: entry.try_get("journal_entry_id")?,
            entry_number: entry.try_get("entry_number")?,
        });
    }

    // Nothing is owed by an asset nobody capitalised, and nothing is owed by
    // land: `NONE` is a method rather than an absent value precisely so this
    // does not have to be a special case anywhere else.
    let depreciable = row.decision.as_deref() == Some("CAPITALIZE")
        && row.method.as_deref() != Some(DepreciationMethod::None.as_str());
    let remaining = if depreciable {
        let base = row.capitalized_cost_minor.unwrap_or_default()
            - row.salvage_value_minor.unwrap_or_default();
        (base - row.accumulated_minor).max(0)
    } else {
        0
    };
    let months_remaining = match (depreciable && remaining > 0, row.in_service_on) {
        (true, Some(in_service)) => {
            // Where the next instalment falls: after the last month this system
            // charged, or — when it has charged nothing yet — after the month
            // the carried-in figure covers. Without the second, an asset that
            // arrived mid-life would be reported as having its whole life left.
            let next = row
                .last_depreciated_month
                .or(row.opening_through)
                .map(|last| months_between(in_service, last) + 1)
                .unwrap_or(0);
            (row.useful_life_months.unwrap_or_default() - next).max(0)
        }
        _ => 0,
    };

    Ok(AssetSchedule {
        asset_id: row.asset_id,
        asset_number: row.asset_number,
        name: row.name,
        decision: row.decision,
        method: row.method,
        capitalized_cost_minor: row.capitalized_cost_minor,
        salvage_value_minor: row.salvage_value_minor,
        useful_life_months: row.useful_life_months,
        in_service_on: row.in_service_on,
        opening_accumulated_minor: row.opening_accumulated_minor,
        opening_through: row.opening_through,
        charged,
        charged_total_minor: charged_total,
        last_depreciated_month: row.last_depreciated_month,
        months_remaining,
        remaining_depreciable_minor: remaining,
    })
}

// ---------------------------------------------------------------------------
// Where the register and the books disagree about what was bought
// ---------------------------------------------------------------------------
//
// Two lists, and they are not the same question asked twice.
//
// An asset with no acquisition line is a thing the register says the company
// owns and the ledger has never paid for. In the seeded books that is every
// capitalised asset: `10215*` has not one journal line against forty-four
// months of depreciation on `10216*`. Depreciation is being charged against a
// cost that is not on the balance sheet, and disposal — which credits
// `fixed_asset` at cost — would drive the family negative.
//
// A posted `10215*` bill line with no asset is the mirror: the books bought
// something capital and nobody put it on the register. It will never be
// depreciated, and nobody can be asked where it is.
//
// Both are exceptions to show, not errors to fix automatically. Guessing which
// asset a line bought is exactly the kind of invented link that has to be
// unwound by hand a year later.

/// A capitalised asset the books never bought.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnbackedAsset {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub site_id: String,
    pub category_code: String,
    pub capitalized_cost_minor: i64,
    pub in_service_on: Option<NaiveDate>,
    /// What has been charged against a cost that is not in the books. The
    /// figure that says how far the exception has already travelled.
    pub accumulated_minor: i64,
}

/// A posted capital purchase nobody put on the register.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UnclaimedAcquisitionLine {
    pub line_id: Uuid,
    pub invoice_id: Uuid,
    pub invoice_number: String,
    pub line_number: i32,
    pub invoice_date: NaiveDate,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub account_code: String,
    /// The client's own name, never translated.
    pub account_name: String,
    pub site_id: String,
    pub amount_minor: i64,
    pub memo: Option<String>,
}

/// The two halves of "what the books bought and what the register holds".
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AcquisitionGap {
    pub assets_without_a_line: Vec<UnbackedAsset>,
    /// Summed so Overview can show one sentence — "assets in the register that
    /// the books never bought, 412,000,000" — without loading the list.
    pub assets_total_minor: i64,
    pub lines_without_an_asset: Vec<UnclaimedAcquisitionLine>,
    pub lines_total_minor: i64,
}

/// Assets the books never bought, and purchases nobody registered.
pub async fn acquisition_gap(pool: &PgPool) -> Result<AcquisitionGap, AppError> {
    // Capitalised, not disposed of, and pointing at no line. A disposed asset
    // is excluded because its exception has already been dealt with one way or
    // the other and re-reporting it would keep a closed item on the list.
    let asset_rows = sqlx::query(
        "SELECT a.asset_id, a.asset_number, a.name, a.site_id, a.category_code,
                k.capitalized_cost_minor, k.in_service_on,
                COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                           WHERE d.asset_id = a.asset_id), 0)::bigint AS accumulated
           FROM fixed_asset a
           JOIN LATERAL (
               SELECT * FROM asset_capitalization x
                WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
           ) k ON true
          WHERE k.decision = 'CAPITALIZE'
            AND a.status <> 'DISPOSED'
            AND a.acquired_via_line_id IS NULL
          ORDER BY k.capitalized_cost_minor DESC, a.asset_number",
    )
    .fetch_all(pool)
    .await?;

    let mut assets = Vec::with_capacity(asset_rows.len());
    let mut assets_total = 0i64;
    for row in &asset_rows {
        let cost: i64 = row.try_get("capitalized_cost_minor")?;
        assets_total += cost;
        assets.push(UnbackedAsset {
            asset_id: row.try_get("asset_id")?,
            asset_number: row.try_get("asset_number")?,
            name: row.try_get("name")?,
            site_id: row.try_get("site_id")?,
            category_code: row.try_get("category_code")?,
            capitalized_cost_minor: cost,
            in_service_on: row.try_get("in_service_on")?,
            accumulated_minor: row.try_get("accumulated")?,
        });
    }

    // POSTED only. A draft bill has not bought anything yet — the ledger has
    // never heard of it — so listing it here would report an exception that
    // does not exist. This is the one place the posting status matters, and it
    // is why `check_acquisition_line` deliberately does not ask about it.
    let line_rows = sqlx::query(
        "SELECT l.line_id, l.invoice_id, i.invoice_number, l.line_number, i.invoice_date,
                i.supplier_id, i.supplier_name, l.account_code, c.name AS account_name,
                l.site_id, l.amount_minor, l.memo
           FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i USING (invoice_id)
           JOIN ledger_account c ON c.account_code = l.account_code
          WHERE l.account_code = ANY($1)
            AND i.status = 'POSTED'
            AND l.asset_id IS NULL
          ORDER BY i.invoice_date DESC, i.invoice_number, l.line_number",
    )
    // Bound from the map rather than written into the SQL, so widening the
    // register is one edit and not two that must agree. Equality and no longer
    // `LIKE ANY`: with four-digit codes there is no family to match a prefix
    // against, and the prefix was never what was meant — `10215%` matched
    // `102159` too, and nobody would have noticed.
    .bind(asset_cost_accounts(pool).await?)
    .fetch_all(pool)
    .await?;

    let mut lines = Vec::with_capacity(line_rows.len());
    let mut lines_total = 0i64;
    for row in &line_rows {
        let amount: i64 = row.try_get("amount_minor")?;
        lines_total += amount;
        lines.push(UnclaimedAcquisitionLine {
            line_id: row.try_get("line_id")?,
            invoice_id: row.try_get("invoice_id")?,
            invoice_number: row.try_get("invoice_number")?,
            line_number: row.try_get("line_number")?,
            invoice_date: row.try_get("invoice_date")?,
            supplier_id: row.try_get("supplier_id")?,
            supplier_name: row.try_get("supplier_name")?,
            account_code: row.try_get("account_code")?,
            account_name: row.try_get("account_name")?,
            site_id: row.try_get("site_id")?,
            amount_minor: amount,
            memo: row.try_get("memo")?,
        });
    }

    Ok(AcquisitionGap {
        assets_without_a_line: assets,
        assets_total_minor: assets_total,
        lines_without_an_asset: lines,
        lines_total_minor: lines_total,
    })
}

// ---------------------------------------------------------------------------
// An asset the books bought, put on the register by the posting
// ---------------------------------------------------------------------------
//
// 0099 argued there is no acquisition posting RULE to write, and that is still
// true: the bill is the acquisition and it already posts. What it left to a
// person was the LINK, and `acquisition_gap` has been reporting the gap ever
// since — a list somebody works through by hand, one bill at a time, long after
// the person who knew what the line was for has moved on.
//
// The moment anybody knows that a line bought a rack rather than a month of
// electricity is the moment they are holding the paper. 0137 lets them say so.
// This is what happens when they do.

/// Mint the DRAFT assets a posting bill's lines say they are buying.
///
/// Runs INSIDE the caller's transaction and BEFORE the journal is written, so
/// the acquisition line can carry the asset it bought as its dimension. The
/// other order — post, then mint, then go back and update the line — would need
/// to find the line again by its amount, and two identical racks on one bill
/// would make that a guess.
///
/// Returns bill line -> asset, for the caller to hang on its posting lines.
///
/// A line that DRAWS the replacement reserve mints nothing, and that is not an
/// omission: operating equipment is not capitalised in this client's books at
/// all — 0139 — so there would be no cost for a register row to carry and no
/// depreciation for it to be charged. The reserve stands in for both.
pub async fn asset_drafts_for_bill(
    tx: &mut Transaction<'_, Postgres>,
    invoice_id: Uuid,
    actor: &str,
) -> Result<HashMap<Uuid, Uuid>, AppError> {
    let rows = sqlx::query(
        "SELECT l.line_id, l.asset_class_code, l.site_id, l.memo, l.line_number,
                i.invoice_number, i.invoice_date, c.name AS class_name
           FROM supplier_invoice_expense_line l
           JOIN supplier_invoice i USING (invoice_id)
           JOIN asset_class c ON c.class_code = l.asset_class_code
          WHERE l.invoice_id = $1
            AND l.asset_class_code IS NOT NULL
            AND NOT l.draws_reserve
            AND NOT EXISTS (SELECT 1 FROM fixed_asset a
                             WHERE a.acquired_via_line_id = l.line_id)
          ORDER BY l.line_number",
    )
    .bind(invoice_id)
    .fetch_all(&mut **tx)
    .await?;

    let mut minted = HashMap::with_capacity(rows.len());
    for row in &rows {
        let line_id: Uuid = row.try_get("line_id")?;
        let class_code: String = row.try_get("asset_class_code")?;
        let class_name: String = row.try_get("class_name")?;
        let line_number: i32 = row.try_get("line_number")?;
        let invoice_number: String = row.try_get("invoice_number")?;

        // Checked when the bill was keyed as well. Repeated here because this
        // is the last place before a row exists, and an asset in a class that
        // is not an asset class is a row nothing can ever depreciate or dispose
        // of.
        assert_asset_class(&mut **tx, &class_code)
            .await
            .map_err(|error| match error {
                AppError::Validation(message) => {
                    AppError::Validation(format!("{invoice_number} line {line_number}: {message}"))
                }
                other => other,
            })?;

        // The client's own name for the class, unless the person keying wrote
        // something better. `OE - Rak 1` is a poor name for one rack and an
        // honest one for a row nobody has looked at yet — which is exactly what
        // DRAFT says.
        let name = match row.try_get::<Option<String>, _>("memo")? {
            Some(memo) if !memo.trim().is_empty() => memo.trim().to_string(),
            _ => class_name,
        };

        // In the books of the unit whose site the line was bought for (0701).
        let site_id: String = row.try_get("site_id")?;
        let unit = super::sites::unit_of_site(&mut **tx, &site_id).await?;
        let number = super::number_series::next_number(
            &mut **tx,
            super::number_series::FIXED_ASSET,
            row.try_get::<NaiveDate, _>("invoice_date")?,
            Some(&unit),
        )
        .await?;
        let asset_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO fixed_asset
               (asset_id, asset_number, name, category_code, site_id, acquired_on,
                status, notes, registered_by, acquired_via_line_id)
             VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)",
        )
        .bind(asset_id)
        .bind(&number)
        .bind(&name)
        .bind(&class_code)
        .bind(row.try_get::<String, _>("site_id")?)
        .bind(row.try_get::<NaiveDate, _>("invoice_date")?)
        .bind(format!(
            "Dari {invoice_number} baris {line_number}. Belum dinilai: umur ekonomis dan tanggal \
             mulai disusutkan menunggu Finance."
        ))
        .bind(actor)
        .bind(line_id)
        .execute(&mut **tx)
        .await?;
        minted.insert(line_id, asset_id);
    }
    Ok(minted)
}

// ---------------------------------------------------------------------------
// The month, run and written down
// ---------------------------------------------------------------------------

/// Whether one asset's arithmetic still owes a charge for a month.
///
/// The same question `charge_is_owed` asks of a disposal, asked of a row of the
/// run's own candidate query rather than of an `AssetRow`. Kept separate rather
/// than reshaping one into the other: `AssetRow` is a read model with a dozen
/// fields this does not need, and building one per asset to answer a boolean is
/// a query per asset on a list that draws a hundred.
fn row_is_owed_a_charge(row: &sqlx::postgres::PgRow, period: NaiveDate) -> Result<bool, AppError> {
    let opening_through: Option<NaiveDate> = row.try_get("opening_through")?;
    if matches!(opening_through, Some(through) if period <= through) {
        return Ok(false);
    }
    let in_service: NaiveDate = row.try_get("in_service_on")?;
    if month_of(in_service) > period {
        return Ok(false);
    }
    let method = match DepreciationMethod::parse(&row.try_get::<String, _>("method")?) {
        Some(method) => method,
        None => return Ok(false),
    };
    Ok(matches!(
        monthly_charge(Basis {
            method,
            capitalized_cost_minor: row.try_get("capitalized_cost_minor")?,
            salvage_value_minor: row.try_get("salvage_value_minor")?,
            useful_life_months: row.try_get("useful_life_months")?,
            accumulated_minor: row.try_get("accumulated")?,
            period_index: months_between(in_service, period),
        }),
        Outcome::Post(_)
    ))
}

/// One asset a month is still waiting on.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetAwaitingCharge {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    pub site_id: String,
    pub category_code: String,
}

/// The last time anybody tried to charge a month, and how it went.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct DepreciationRunRecord {
    pub run_id: Uuid,
    pub started_at: DateTime<Utc>,
    /// Absent on a run that never finished — which is not the same as a run
    /// that posted nothing, and is the state worth seeing at a year end.
    pub finished_at: Option<DateTime<Utc>>,
    pub posted_count: i32,
    pub posted_total_minor: i64,
    pub skipped_count: i32,
    pub failed_count: i32,
    /// `system:month-end` when the schedule ran it, a username when a person
    /// did.
    pub triggered_by: String,
    pub note: Option<String>,
}

/// Whether a month's depreciation is actually done.
///
/// Written for the period-close checklist, which needs a sentence rather than a
/// run report: "September — 35 due, 35 posted, none missing" closes, and "35
/// due, 24 posted, 11 missing" does not.
///
/// `assets_due` is asked of the REGISTER and not of the log. A month can have
/// been run correctly on the 1st and be incomplete on the 5th, because an asset
/// was capitalised in between and now owes a charge it did not owe then. A
/// "months completed" flag would say done and the books would disagree.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AssetDepreciationStatus {
    pub period_month: NaiveDate,
    /// Capitalised assets this month concerns: the ones already charged, plus
    /// the ones whose arithmetic still owes a charge. Land and assets at
    /// salvage are in neither — they are complete at nothing.
    pub assets_due: i64,
    pub posted_count: i64,
    pub posted_total_minor: i64,
    /// The ones still waiting, named. A count alone sends somebody looking for
    /// which.
    pub missing: Vec<AssetAwaitingCharge>,
    /// True when nothing is waiting. The one field a checklist reads.
    pub complete: bool,
    /// Whether the month is still open to post into. A month closed with
    /// charges missing is the state this endpoint exists to prevent.
    pub period_status: Option<String>,
    pub last_run: Option<DepreciationRunRecord>,
}

/// The candidate query the run and the status share, so the two cannot drift
/// about what "an asset this month concerns" means.
const DUE_CANDIDATES: &str =
    "SELECT a.asset_id, a.asset_number, a.name, a.site_id, a.category_code,
                unit_of_site(a.site_id) AS unit_id,
                k.capitalized_cost_minor, k.salvage_value_minor, k.useful_life_months,
                k.method, k.charge_kind, k.in_service_on, k.opening_through,
                (COALESCE(k.opening_accumulated_minor, 0)
                 + COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation_entry d
                              WHERE d.asset_id = a.asset_id), 0))::bigint AS accumulated,
                EXISTS (SELECT 1 FROM asset_depreciation_entry d
                         WHERE d.asset_id = a.asset_id AND d.period_month = $1) AS already
           FROM fixed_asset a
           JOIN LATERAL (
               SELECT * FROM asset_capitalization x
                WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
           ) k ON true
          WHERE k.decision = 'CAPITALIZE'
            AND a.status <> 'DISPOSED'
            AND k.in_service_on <= ($1::date + interval '1 month' - interval '1 day')
          ORDER BY a.asset_number";

/// What a month still owes, and what the last attempt at it did.
pub async fn asset_depreciation_status(
    pool: &PgPool,
    year: i32,
    month: u32,
) -> Result<AssetDepreciationStatus, AppError> {
    let period = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;

    let rows = sqlx::query(DUE_CANDIDATES)
        .bind(period)
        .fetch_all(pool)
        .await?;

    let mut due = 0i64;
    let mut missing = Vec::new();
    for row in &rows {
        // An asset already charged is due by definition — it was, and the
        // charge is the evidence. Asking the arithmetic again would say no,
        // because the accumulated figure now includes this very month, and the
        // count would fall as the run succeeded.
        if row.try_get::<bool, _>("already")? {
            due += 1;
            continue;
        }
        if row_is_owed_a_charge(row, period)? {
            due += 1;
            missing.push(AssetAwaitingCharge {
                asset_id: row.try_get("asset_id")?,
                asset_number: row.try_get("asset_number")?,
                name: row.try_get("name")?,
                site_id: row.try_get("site_id")?,
                category_code: row.try_get("category_code")?,
            });
        }
    }

    let posted = sqlx::query(
        "SELECT COUNT(*)::bigint AS n, COALESCE(SUM(amount_minor), 0)::bigint AS total
           FROM asset_depreciation_entry WHERE period_month = $1",
    )
    .bind(period)
    .fetch_one(pool)
    .await?;

    let period_status: Option<String> =
        sqlx::query("SELECT status FROM fiscal_period WHERE year = $1 AND month = $2")
            .bind(year as i16)
            .bind(month as i16)
            .fetch_optional(pool)
            .await?
            .map(|row| row.try_get("status"))
            .transpose()?;

    let last_run = sqlx::query(
        "SELECT run_id, started_at, finished_at, posted_count, posted_total_minor,
                skipped_count, failed_count, triggered_by, note
           FROM asset_depreciation_run
          WHERE period_month = $1
          ORDER BY started_at DESC LIMIT 1",
    )
    .bind(period)
    .fetch_optional(pool)
    .await?
    .map(|row| {
        Ok::<_, AppError>(DepreciationRunRecord {
            run_id: row.try_get("run_id")?,
            started_at: row.try_get("started_at")?,
            finished_at: row.try_get("finished_at")?,
            posted_count: row.try_get("posted_count")?,
            posted_total_minor: row.try_get("posted_total_minor")?,
            skipped_count: row.try_get("skipped_count")?,
            failed_count: row.try_get("failed_count")?,
            triggered_by: row.try_get("triggered_by")?,
            note: row.try_get("note")?,
        })
    })
    .transpose()?;

    Ok(AssetDepreciationStatus {
        period_month: period,
        assets_due: due,
        posted_count: posted.try_get("n")?,
        posted_total_minor: posted.try_get("total")?,
        complete: missing.is_empty(),
        missing,
        period_status,
        last_run,
    })
}

/// Charge a month, and write down that it was charged.
///
/// The run itself is `run_depreciation`, unchanged and still idempotent by the
/// unique index on (asset, period). What this adds is the record that an
/// attempt happened — the thing a schedule needs and a person pressing a button
/// does not, because a person can see the answer on their screen and nobody is
/// watching at three in the morning on the first of the month.
///
/// The row is written BEFORE the run and finished after, so a run that dies
/// half way leaves a row with no `finished_at` rather than no row at all. A run
/// that left nothing behind would be indistinguishable from a month nobody ever
/// reached, which is the confusion this exists to end.
pub async fn asset_depreciation_run_month(
    pool: &PgPool,
    year: i32,
    month: u32,
    actor: &str,
) -> Result<DepreciationRun, AppError> {
    let period = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::Validation("not a month".into()))?;

    let run_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO asset_depreciation_run (run_id, period_month, triggered_by)
         VALUES ($1,$2,$3)",
    )
    .bind(run_id)
    .bind(period)
    .bind(actor)
    .execute(pool)
    .await?;

    match run_depreciation(pool, year, month, actor).await {
        Ok(run) => {
            // What is still missing after the attempt, asked of the register
            // and not of the run's own report: an asset the run never selected
            // — one capitalised while it was running — is missing from the
            // month and absent from the report, and only the register sees
            // both.
            let after = asset_depreciation_status(pool, year, month).await?;
            sqlx::query(
                "UPDATE asset_depreciation_run
                    SET finished_at = now(), posted_count = $2, posted_total_minor = $3,
                        skipped_count = $4, failed_count = $5
                  WHERE run_id = $1",
            )
            .bind(run_id)
            .bind(run.posted_count as i32)
            .bind(run.posted_total_minor)
            .bind(run.skipped_count as i32)
            .bind(after.missing.len() as i32)
            .execute(pool)
            .await?;
            Ok(run)
        }
        Err(error) => {
            // The run posts asset by asset in its own transactions, so whatever
            // it managed before the refusal stands. The row records the refusal
            // verbatim, because by morning the only other evidence that eleven
            // assets were turned away is that their entries are absent.
            let note = error.to_string();
            let still_missing = asset_depreciation_status(pool, year, month)
                .await
                .map(|status| status.missing.len() as i32)
                .unwrap_or(0);
            sqlx::query(
                "UPDATE asset_depreciation_run
                    SET finished_at = now(), failed_count = $2, note = $3
                  WHERE run_id = $1",
            )
            .bind(run_id)
            .bind(still_missing)
            .bind(&note)
            .execute(pool)
            .await?;
            Err(error)
        }
    }
}
