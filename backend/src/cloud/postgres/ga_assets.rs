//! GA's own half of the asset register: where a thing is, who holds it, what
//! condition it is in, and what happened to it.
//!
//! # Two halves of one table, one reader each
//!
//! `postgres::assets` is Finance's register: what a thing cost, whether it was
//! capitalised, how much of it has been depreciated away. This module is GA's:
//! the sub-location, the holder, the condition, the build's fields from
//! `fixed_asset.specs`, and the appended history in `ga_asset_event`.
//!
//! They are the same rows and deliberately not the same answer. Finance never
//! wants to know which rack in the shop the printer is on; a shop's facilities
//! person must never be shown a rupiah figure, because GA does not own the
//! money and a register that displayed a cost would be a second, drifting copy
//! of the books. So [`GaAssetRow`] carries Finance's DECISION — read-only, and
//! absent when nobody has assessed the asset — and none of its arithmetic.
//!
//! # There is no DELETE, and that is the rule rather than an omission
//!
//! The brief's §12: an asset that a bill referred to (`acquired_via_line_id
//! IS NOT NULL`) or that has a disposal journal behind it cannot be deleted.
//! Rather than enumerate those cases in a route that could one day forget one,
//! this module has no delete at all — the register loses a thing by DISPOSING
//! of it, which is an entry in the books with a date and a reason, and an asset
//! nobody ever bought can be corrected by hand in the database with an operator
//! looking at it. An asset that vanished from the register with its history
//! intact would be the one deletion nobody could audit.
//!
//! # Events are appended by the writers here, not by a rule
//!
//! Every function that changes where a thing is, who holds it or what condition
//! it is in writes its own `ga_asset_event` row in the same transaction. The
//! database refuses to let anybody edit one (0357's trigger); what it cannot
//! know is whether a writer remembered. So each of the four acts below has its
//! event in the same `Result` as the change, and there is nowhere else that
//! updates these columns.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;
use crate::cloud::domain::{assert_specs, build_schema, GaBuildSchema};

use super::asset_classes::assert_asset_class;

/// One asset as GA reads it: the upkeep side, with Finance's decision read-only.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAssetRow {
    pub asset_id: Uuid,
    pub asset_number: String,
    pub name: String,
    /// The register's own class code, e.g. `AIR_CONDITIONER`.
    pub class_code: String,
    /// The client's own name for that class.
    pub class_name: String,
    /// Which of the eleven forms it is filed on — `LAND`, `BUILDING`, `TECH`,
    /// `VEHICLE`, `FFE`, `IT`, `AUDIO`, `OE`, `SOFTWARE`, `DEFERRED` or `CIP`
    /// (0356). What the register draws its icon from and what the build views
    /// narrow by.
    pub build: String,
    pub site_id: String,
    /// Where inside the site — "Lt. 1 · area kasir". Absent for a thing that is
    /// not anywhere in particular.
    pub sub_location: Option<String>,
    /// Who holds it, as a name. Absent when nobody in particular does.
    pub holder: Option<String>,
    /// `BAIK`, `PERLU_SERVIS` or `RUSAK`.
    pub condition: String,
    pub serial_number: Option<String>,
    /// Status GA: DRAFT | IN_PROGRESS | REGISTERED | IN_SERVICE | DISPOSED.
    pub status: String,
    pub acquired_on: NaiveDate,
    /// The build's fields, validated on the way in. Always an object; `{}` for a
    /// build with no physical facts.
    ///
    /// `ts(type = …)` because `serde_json::Value` has no `TS` impl: the
    /// generator would refuse the whole struct over one field. The keys are the
    /// build's own field names — see `domain::ga::build_fields` and
    /// `GET /api/v1/ga/asset-builds`, which is where a client learns them.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub specs: serde_json::Value,
    /// Keputusan Finance, dibaca saja. Absen = belum dinilai. GA tidak pernah
    /// menampilkan rupiah; ini hanya status.
    pub finance_decision: Option<String>,
    /// Tagihan yang membelinya, sebagai teks ("INV/… line 2"), kalau ada.
    pub acquired_via: Option<String>,
}

/// One value a GA filter can take, and how many assets would still be there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAssetFacet {
    pub value: String,
    /// What to draw, when it differs from the value: the site's name, the
    /// class's name. Absent for a build and a condition, whose words the screen
    /// already has.
    pub label: Option<String>,
    pub count: i64,
}

/// The five things GA's register can be narrowed by.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAssetFacets {
    pub sites: Vec<GaAssetFacet>,
    pub classes: Vec<GaAssetFacet>,
    pub builds: Vec<GaAssetFacet>,
    pub conditions: Vec<GaAssetFacet>,
    pub statuses: Vec<GaAssetFacet>,
}

/// A page of GA's register, and how big the whole answer is.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAssetPage {
    pub rows: Vec<GaAssetRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    pub total: i64,
    pub facets: GaAssetFacets,
}

/// What a caller is asking GA's register for.
///
/// Paged by a keyset on the house order (`asset_number`, then `asset_id`):
/// the register screen walks it a page at a time as the foot comes into view,
/// and `total` says how big the whole answer is. `limit` is clamped rather
/// than trusted — see [`MAX_GA_ASSET_LIMIT`].
#[derive(Clone, Debug, Default)]
pub struct GaAssetScope {
    /// Free text against the asset number, the name and the serial. The serial
    /// matters: somebody holding the plate in front of a machine has nothing
    /// else to type.
    pub needle: Option<String>,
    pub sites: Vec<String>,
    pub classes: Vec<String>,
    pub builds: Vec<String>,
    pub conditions: Vec<String>,
    pub statuses: Vec<String>,
    /// `Some(true)` hanya draft; `Some(false)` tanpa draft; `None` semua.
    pub draft_only: Option<bool>,
    /// A `next_cursor` from the previous page, verbatim.
    pub cursor: Option<String>,
    pub limit: i64,
}

/// Where the previous page stopped: the last row's id. The seek reads that
/// row's sort key back out of the same filtered set.
#[derive(Serialize, Deserialize)]
struct GaAssetCursor {
    asset_id: Uuid,
}

/// The register's first page when a caller does not say.
pub const DEFAULT_GA_ASSET_LIMIT: i64 = 200;
/// And the most it will answer with however loudly a caller asks.
///
/// A thousand, like `assets`: this register has a caller that legitimately wants
/// the whole shop in one read — the walk-round sheet — and `total` is what makes
/// the ceiling visible rather than silent.
pub const MAX_GA_ASSET_LIMIT: i64 = 1000;

/// Register a thing GA has, from scratch or from the floor.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RegisterGaAssetRequest {
    pub asset_number: String,
    pub name: String,
    pub class_code: String,
    pub site_id: String,
    pub sub_location: Option<String>,
    pub holder: Option<String>,
    pub condition: String,
    pub serial_number: Option<String>,
    pub acquired_on: NaiveDate,
    /// The build's fields. Validated against the class's build before anything
    /// is written: a wrong key is a sentence naming the field, not a constraint
    /// violation.
    ///
    /// No `ts(optional)`: the generator allows that only on an `Option`, and
    /// the field's Rust type is the one the register stores — a `Value` whose
    /// absence serde reads as an empty form. See [`GaAssetRow::specs`].
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown>"))]
    pub specs: serde_json::Value,
    pub notes: Option<String>,
    /// How many things this row is. Absent means one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub quantity: Option<i32>,
}

/// What may be corrected about a thing, in place.
///
/// `sub_location` is here because the form carries it, and it is REFUSED when
/// it differs: where a thing IS only moves through [`ga_asset_transfer`], which
/// writes the history row that says it moved. A correction with no event behind
/// it is a location nobody can explain later.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGaAssetRequest {
    pub name: Option<String>,
    pub sub_location: Option<String>,
    pub holder: Option<String>,
    pub condition: Option<String>,
    pub serial_number: Option<String>,
    /// The build's fields, when the correction touches them. Absent leaves what
    /// is there alone — see [`GaAssetRow::specs`] for the shape.
    #[cfg_attr(feature = "ts", ts(type = "Record<string, unknown> | null"))]
    pub specs: Option<serde_json::Value>,
    pub notes: Option<String>,
}

/// Move a thing: the one act that changes where it is and who holds it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct TransferGaAssetRequest {
    pub to_site: String,
    /// Where in the destination it now is. Absent means nowhere in particular —
    /// a new site's sub-locations are not the old site's, so the old string is
    /// never carried over.
    pub to_sub_location: Option<String>,
    /// Who holds it from now on. Absent means nobody does, which is a real
    /// answer for a thing standing in a warehouse.
    pub to_holder: Option<String>,
    pub reason: String,
    pub occurred_on: NaiveDate,
}

/// One line of a thing's history.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAssetEvent {
    pub event_id: Uuid,
    /// `REGISTERED`, `TRANSFER`, `ASSIGN`, `CONDITION` or `NOTE`.
    pub kind: String,
    pub from_site: Option<String>,
    pub to_site: Option<String>,
    pub from_holder: Option<String>,
    pub to_holder: Option<String>,
    pub reason: String,
    pub occurred_on: NaiveDate,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
}

/// Something written down about a thing that changes nothing else.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct NoteGaAssetRequest {
    pub reason: String,
    /// Absent means the server's business day. A note is usually written the
    /// day the thing happened, and asking for the date every time is how a
    /// screen ends up with yesterday's date on a form filled in tomorrow.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub occurred_on: Option<NaiveDate>,
}

/// Satu dokumen dengan masa berlakunya, untuk hub aset.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaDocument {
    pub document_id: Uuid,
    pub name: String,
    pub title: Option<String>,
    /// "STNK", "BPKB", "SLO" — the department's own word (0358).
    pub doc_type: Option<String>,
    pub doc_number: Option<String>,
    pub issuer: Option<String>,
    pub issued_on: Option<NaiveDate>,
    pub expires_on: Option<NaiveDate>,
    /// Whether the bytes can be fetched right now. Carried from `stored_file`
    /// so the hub can say "filed, but the object is gone" rather than offer a
    /// link that fails.
    pub available: bool,
}

/// One thing, everything GA knows about it, and everything filed against it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaAssetHub {
    pub asset: GaAssetRow,
    pub events: Vec<GaAssetEvent>,
    pub documents: Vec<GaDocument>,
    /// "Biaya terkait" (brief §10.1): Σ baris tagihan POSTED yang menunjuk aset
    /// ini ATAU perbaikan atas aset ini, dibaca saja dari Finance. A held bill
    /// still counts — hold bukan batal. Tidak ada harga perolehan atau nilai
    /// buku di sini (brief §4.6).
    pub related_cost_minor: i64,
}

/// The columns every GA read needs.
///
/// `a` is the `fixed_asset` alias, `c` the class, `k` the capitalisation in
/// force. Deliberately not `postgres::assets`'s `ASSET_BASE`: that one carries
/// cost, salvage, life and a running depreciation total, and none of those
/// belongs on a screen GA owns. What travels from Finance is the DECISION and
/// nothing else.
const GA_ASSET_BASE: &str = "a.asset_id, a.asset_number, a.name, a.category_code,
     c.name AS class_name, c.build, a.site_id, a.sub_location, a.holder, a.condition,
     a.serial_number, a.status, a.acquired_on, a.specs, k.decision AS finance_decision";

/// The bill line that bought it, as one string — `assets.rs`' `ACQUIRED_VIA`,
/// repeated rather than shared because that one is `pub` to nobody and its
/// comment explains why it is added to the PAGE and not to every row.
const GA_ACQUIRED_VIA: &str =
    "(SELECT string_agg(si.invoice_number || ' line ' || bl.line_number, ', '
                        ORDER BY si.invoice_date, si.invoice_number, bl.line_number)
        FROM supplier_invoice_expense_line bl
        JOIN supplier_invoice si USING (invoice_id)
       WHERE bl.asset_id = a.asset_id) AS acquired_via";

/// The decision in force is the highest sequence — `assets.rs`' `IN_FORCE`.
/// A lateral join rather than a window, so the planner can stop at the first
/// row per asset.
const GA_IN_FORCE: &str = "LEFT JOIN LATERAL (
         SELECT decision FROM asset_capitalization x
          WHERE x.asset_id = a.asset_id ORDER BY x.sequence DESC LIMIT 1
     ) k ON true";

/// The search, defined once so the page and the facet counts see one set.
///
/// It stops at the SEARCH. The filters are applied outside it, which is what
/// lets a facet count answer "how many of these there are" about the register
/// while the total answers "how many are on screen".
///
/// Binds: `$1` the search pattern, or NULL.
fn ga_asset_search() -> String {
    format!(
        "SELECT {GA_ASSET_BASE}
           FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
           {GA_IN_FORCE}
          WHERE ($1::text IS NULL
                 OR a.asset_number ILIKE $1
                 OR a.name ILIKE $1
                 OR a.serial_number ILIKE $1)"
    )
}

/// The filters, spelled once so the page and the total narrow identically.
///
/// Binds from `$2`: sites, classes, builds, conditions, statuses, draft-only.
const GA_ASSET_FILTERS: &str = "
    ($2::text[] IS NULL OR site_id = ANY($2))
    AND ($3::text[] IS NULL OR category_code = ANY($3))
    AND ($4::text[] IS NULL OR build = ANY($4))
    AND ($5::text[] IS NULL OR \"condition\" = ANY($5))
    AND ($6::text[] IS NULL OR status = ANY($6))
    AND ($7::boolean IS NULL OR (status = 'DRAFT') = $7)
";

fn to_ga_asset(row: &sqlx::postgres::PgRow) -> Result<GaAssetRow, AppError> {
    Ok(GaAssetRow {
        asset_id: row.try_get("asset_id")?,
        asset_number: row.try_get("asset_number")?,
        name: row.try_get("name")?,
        class_code: row.try_get("category_code")?,
        class_name: row.try_get("class_name")?,
        build: row.try_get("build")?,
        site_id: row.try_get("site_id")?,
        sub_location: row.try_get("sub_location")?,
        holder: row.try_get("holder")?,
        condition: row.try_get("condition")?,
        serial_number: row.try_get("serial_number")?,
        status: row.try_get("status")?,
        acquired_on: row.try_get("acquired_on")?,
        specs: row.try_get("specs")?,
        finance_decision: row.try_get("finance_decision")?,
        acquired_via: row.try_get("acquired_via")?,
    })
}

fn to_ga_event(row: &sqlx::postgres::PgRow) -> Result<GaAssetEvent, AppError> {
    Ok(GaAssetEvent {
        event_id: row.try_get("event_id")?,
        kind: row.try_get("kind")?,
        from_site: row.try_get("from_site")?,
        to_site: row.try_get("to_site")?,
        from_holder: row.try_get("from_holder")?,
        to_holder: row.try_get("to_holder")?,
        reason: row.try_get("reason")?,
        occurred_on: row.try_get("occurred_on")?,
        recorded_by: row.try_get("recorded_by")?,
        recorded_at: row.try_get("recorded_at")?,
    })
}

/// The register, one page at a time, beside the shape of everything it holds.
pub async fn ga_asset_page(pool: &PgPool, scope: GaAssetScope) -> Result<GaAssetPage, AppError> {
    // A blank search is not a search — `Some("")` would compile to `ILIKE '%%'`.
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let classes = (!scope.classes.is_empty()).then(|| scope.classes.clone());
    let builds = (!scope.builds.is_empty()).then(|| scope.builds.clone());
    let conditions = (!scope.conditions.is_empty()).then(|| scope.conditions.clone());
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let limit = scope.limit.clamp(1, MAX_GA_ASSET_LIMIT);
    let cursor = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor::<GaAssetCursor>)
        .transpose()?;

    let search = ga_asset_search();
    // The acquisition trail is joined onto the page and nothing else: a CTE is
    // materialised before the `LIMIT`, so the aggregate would otherwise run for
    // the whole register in order to draw one page of it. The seek is a
    // subquery over `kept`, which is why both CTEs stay `NOT MATERIALIZED` —
    // see `movements::movements_page`.
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({search}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched WHERE {GA_ASSET_FILTERS}
         ),
              paged AS NOT MATERIALIZED (
             SELECT * FROM kept
              WHERE $8::uuid IS NULL
                 OR (asset_number, asset_id) >
                    (SELECT asset_number, asset_id FROM kept WHERE asset_id = $8)
              ORDER BY asset_number, asset_id
              LIMIT $9
         )
         SELECT a.*, {GA_ACQUIRED_VIA} FROM paged a
          ORDER BY a.asset_number, a.asset_id"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&sites)
        .bind(&classes)
        .bind(&builds)
        .bind(&conditions)
        .bind(&statuses)
        .bind(scope.draft_only)
        .bind(cursor.as_ref().map(|c| c.asset_id))
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let out = rows
        .iter()
        .map(to_ga_asset)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = match out.last() {
        Some(last) if out.len() as i64 == limit => Some(super::encode_cursor(&GaAssetCursor {
            asset_id: last.asset_id,
        })?),
        _ => None,
    };
    let (total, facets) = ga_asset_facets(pool, &scope, needle.as_deref()).await?;
    Ok(GaAssetPage {
        rows: out,
        next_cursor,
        total,
        facets,
    })
}

/// How many assets there are and how they split.
///
/// The scopes are deliberate, and are `asset_facets`' argument: the per-value
/// counts read the SEARCHED set within the tab (the ticked states and the
/// draft switch), ignoring the chips, so a number beside a value answers "how
/// many of these there are on this tab" — the question somebody has while
/// deciding whether to click it. The states themselves are counted over the
/// whole searched set, because they are what the tabs count. The total reads
/// the FILTERED set, because it describes the list on screen.
async fn ga_asset_facets(
    pool: &PgPool,
    scope: &GaAssetScope,
    needle: Option<&str>,
) -> Result<(i64, GaAssetFacets), AppError> {
    let sites = (!scope.sites.is_empty()).then(|| scope.sites.clone());
    let classes = (!scope.classes.is_empty()).then(|| scope.classes.clone());
    let builds = (!scope.builds.is_empty()).then(|| scope.builds.clone());
    let conditions = (!scope.conditions.is_empty()).then(|| scope.conditions.clone());
    let statuses = (!scope.statuses.is_empty()).then(|| scope.statuses.clone());
    let search = ga_asset_search();
    let sql = format!(
        "WITH searched AS ({search}),
              tabbed AS (
             SELECT * FROM searched
              WHERE ($6::text[] IS NULL OR status = ANY($6))
                AND ($7::boolean IS NULL OR (status = 'DRAFT') = $7)
         ),
              kept AS (
             SELECT * FROM searched WHERE {GA_ASSET_FILTERS}
         )
         SELECT 'site' AS kind, s.site_id AS value,
                (SELECT p.name FROM site p WHERE p.id = s.site_id) AS label,
                COUNT(*)::bigint AS n
           FROM tabbed s GROUP BY s.site_id
          UNION ALL
         SELECT 'class', s.category_code, MIN(s.class_name), COUNT(*)::bigint
           FROM tabbed s GROUP BY s.category_code
          UNION ALL
         SELECT 'build', s.build, NULL::text, COUNT(*)::bigint
           FROM tabbed s GROUP BY s.build
          UNION ALL
         SELECT 'condition', s.condition, NULL::text, COUNT(*)::bigint
           FROM tabbed s GROUP BY s.condition
          UNION ALL
         SELECT 'status', s.status, NULL::text, COUNT(*)::bigint
           FROM searched s GROUP BY s.status
          UNION ALL
         SELECT 'all', '', NULL::text, COUNT(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&sites)
        .bind(&classes)
        .bind(&builds)
        .bind(&conditions)
        .bind(&statuses)
        .bind(scope.draft_only)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut facets = GaAssetFacets {
        sites: Vec::new(),
        classes: Vec::new(),
        builds: Vec::new(),
        conditions: Vec::new(),
        statuses: Vec::new(),
    };
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let label: Option<String> = row.try_get("label")?;
        let count: i64 = row.try_get("n")?;
        let facet = GaAssetFacet {
            value,
            label,
            count,
        };
        match kind.as_str() {
            "site" => facets.sites.push(facet),
            "class" => facets.classes.push(facet),
            "build" => facets.builds.push(facet),
            "condition" => facets.conditions.push(facet),
            "status" => facets.statuses.push(facet),
            _ => total = count,
        }
    }
    // Biggest first, ties on the value so the order is stable between calls —
    // a list that reshuffles under somebody's finger is a list nobody can click.
    for list in [
        &mut facets.sites,
        &mut facets.classes,
        &mut facets.builds,
        &mut facets.conditions,
        &mut facets.statuses,
    ] {
        list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    }
    Ok((total, facets))
}

/// One thing, as GA reads it.
pub async fn ga_asset(pool: &PgPool, asset_id: Uuid) -> Result<GaAssetRow, AppError> {
    let sql = format!(
        "SELECT {GA_ASSET_BASE}, {GA_ACQUIRED_VIA} FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
           {GA_IN_FORCE} WHERE a.asset_id = $1"
    );
    let row = sqlx::query(&sql)
        .bind(asset_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("asset".into()))?;
    to_ga_asset(&row)
}

/// One thing, its history, and the papers filed against it.
///
/// The history is newest act first — `occurred_on` descending, then the moment
/// it was written down, because a shop fitting-out writes several acts on one
/// day and they only make sense in the order they happened.
///
/// The papers come through `document_link`, whose subject is `('asset', <the
/// id as text>)`: the drawer was built to point at things that are not files in
/// a folder, and 0190's one vocabulary is what spells an asset `asset`.
pub async fn ga_asset_hub(pool: &PgPool, asset_id: Uuid) -> Result<GaAssetHub, AppError> {
    let asset = ga_asset(pool, asset_id).await?;

    let event_rows = sqlx::query(
        "SELECT event_id, kind, from_site, to_site, from_holder, to_holder, reason,
                occurred_on, recorded_by, recorded_at
           FROM ga_asset_event
          WHERE asset_id = $1
          ORDER BY occurred_on DESC, recorded_at DESC",
    )
    .bind(asset_id)
    .fetch_all(pool)
    .await?;
    let events = event_rows
        .iter()
        .map(to_ga_event)
        .collect::<Result<Vec<_>, _>>()?;

    let document_rows = sqlx::query(
        "SELECT d.document_id, d.name, d.title, d.doc_type, d.doc_number, d.issuer,
                d.issued_on, d.expires_on, COALESCE(f.available, false) AS available
           FROM document d
           LEFT JOIN stored_file f ON f.file_id = d.file_id
           JOIN document_link l ON l.document_id = d.document_id
          WHERE l.subject_kind = 'asset' AND l.subject_id = $1::text
          ORDER BY d.expires_on NULLS LAST, d.created_at DESC",
    )
    .bind(asset_id)
    .fetch_all(pool)
    .await?;
    let documents = document_rows
        .iter()
        .map(|row| {
            Ok(GaDocument {
                document_id: row.try_get("document_id")?,
                name: row.try_get("name")?,
                title: row.try_get("title")?,
                doc_type: row.try_get("doc_type")?,
                doc_number: row.try_get("doc_number")?,
                issuer: row.try_get("issuer")?,
                issued_on: row.try_get("issued_on")?,
                expires_on: row.try_get("expires_on")?,
                available: row.try_get("available")?,
            })
        })
        .collect::<Result<Vec<GaDocument>, AppError>>()?;

    // Biaya terkait: the POSTED bill lines that name this asset, OR any of its
    // repairs, OR a bill one of its operating expenses was submitted as (those
    // lines name no asset: see `ga_operating_expense_submit`). The two are summed together and not kept apart because the
    // question is one: what has this thing cost, counting what it took to keep
    // it running. A line that names a repair is not also counted as an asset
    // line — `record_bill` refuses a line that names two objects, so the two
    // sets cannot overlap and no amount is counted twice.
    let related_cost: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(bl.amount_minor), 0)::bigint
           FROM supplier_invoice_expense_line bl
           JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
          WHERE si.status = 'POSTED'
            AND (bl.asset_id = $1
                 OR bl.repair_id IN (SELECT repair_id FROM ga_repair
                                      WHERE asset_id = $1)
                 OR bl.invoice_id IN (SELECT invoice_id FROM ga_operating_expense
                                       WHERE asset_id = $1 AND invoice_id IS NOT NULL))",
    )
    .bind(asset_id)
    .fetch_one(pool)
    .await?;

    Ok(GaAssetHub {
        asset,
        events,
        documents,
        related_cost_minor: related_cost,
    })
}

/// The eleven forms, with the classes each one covers.
///
/// The fields come from `domain::ga`, which is the same table `assert_specs`
/// enforces — that is the whole point of the route: a client that drew its own
/// form from its own copy could offer a field the server refuses, and the
/// disagreement would only ever be discovered by a person typing something
/// reasonable and being told no.
///
/// The classes are read from `asset_class` and not from a list in Rust: four
/// classes are one form, and the register is the list.
pub async fn ga_build_schema(pool: &PgPool) -> Result<GaBuildSchema, AppError> {
    let rows = sqlx::query(
        "SELECT class_code, build FROM asset_class
          WHERE is_active
          ORDER BY class_code",
    )
    .fetch_all(pool)
    .await?;
    let classes = rows
        .iter()
        .map(|row| Ok((row.try_get("class_code")?, row.try_get("build")?)))
        .collect::<Result<Vec<(String, String)>, AppError>>()?;
    Ok(build_schema(&classes))
}

/// The one class a transfer or a registration has to name, and its form.
///
/// `assert_asset_class` refuses a code the register does not keep and lists the
/// ones it does; this adds the second half of the same question — which FORM
/// that class is filled in on — because the caller needs it to validate the
/// fields and there is no other place the answer lives.
async fn class_build(
    executor: impl sqlx::PgExecutor<'_>,
    class_code: &str,
) -> Result<String, AppError> {
    let row = sqlx::query("SELECT build FROM asset_class WHERE class_code = $1")
        .bind(class_code)
        .fetch_optional(executor)
        .await?;
    match row {
        Some(row) => Ok(row.try_get("build")?),
        None => Err(AppError::Validation(format!(
            "{class_code} is not an asset class; the register keeps its own list of them"
        ))),
    }
}

/// A condition, in the three words the register knows.
///
/// Checked here as well as by the column's CHECK for the reason every other
/// value in this module is: the constraint's refusal is a constraint name, and
/// the message somebody reads should say what the words are.
fn assert_condition(condition: &str) -> Result<String, AppError> {
    let word = condition.trim().to_ascii_uppercase();
    match word.as_str() {
        "BAIK" | "PERLU_SERVIS" | "RUSAK" => Ok(word),
        other => Err(AppError::Validation(format!(
            "{other} is not a condition; a thing is BAIK, PERLU_SERVIS or RUSAK"
        ))),
    }
}

/// Blank text is nothing, and nothing is stored as NULL rather than as "".
fn nothing_if_blank(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|text| !text.is_empty())
}

/// The one refusal in this module a person can trip over by typing, in words.
///
/// 0357 puts a unique index on `specs ->> 'plate'` for every vehicle still in
/// service, and what the database says when it fires is
/// `duplicate key value violates unique constraint "ux_fixed_asset_active_plate"`
/// — a sentence about an index name, arriving on a screen where somebody has
/// just typed a registration number. So the refusal is translated once, here,
/// and only when the constraint really is that one: an unrelated unique
/// violation (the asset number, an event id) keeps whatever it said.
fn plate_conflict(error: sqlx::Error, specs: Option<&serde_json::Value>) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        let is_the_plate = database.code().as_deref() == Some("23505")
            && database.constraint() == Some("ux_fixed_asset_active_plate");
        if is_the_plate {
            let plate = specs
                .and_then(|given| given.get("plate"))
                .and_then(serde_json::Value::as_str);
            return AppError::Validation(match plate {
                Some(plate) => format!(
                    "{plate} is already on another vehicle still in service — one plate \
                     belongs to one car"
                ),
                None => "that plate is already on another vehicle still in service".into(),
            });
        }
    }
    error.into()
}

/// Put a thing in the register, with the line that says somebody did.
///
/// One transaction, and it writes two rows: the asset and its first event. The
/// event is not a courtesy — a register row whose history starts empty is a row
/// whose first question ("who put this here and when") has no answer, and a
/// failure between the two writes would leave exactly that.
///
/// The build is read from `asset_class` and not from any list in code, so a
/// class re-filed on another form is validated as that form the same day.
pub async fn ga_asset_register(
    pool: &PgPool,
    request: &RegisterGaAssetRequest,
    actor: &str,
) -> Result<GaAssetRow, AppError> {
    let asset_number = request.asset_number.trim();
    if asset_number.is_empty() {
        return Err(AppError::Validation(
            "an asset needs a number; it is what is printed on the label".into(),
        ));
    }
    let name = request.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "an asset needs a name; it is the one line somebody reads in a list".into(),
        ));
    }
    if let Some(quantity) = request.quantity {
        if quantity < 1 {
            return Err(AppError::Validation(
                "a lot is at least one thing; leave the quantity out for a single object".into(),
            ));
        }
    }
    let condition = assert_condition(&request.condition)?;

    let mut tx = pool.begin().await?;
    // The class first, for its own readable refusal, and then its build — which
    // is what decides which fields are legal. Read in this transaction so a
    // class re-filed mid-registration cannot be validated against the old form.
    assert_asset_class(&mut *tx, &request.class_code).await?;
    let build = class_build(&mut *tx, request.class_code.trim()).await?;
    let specs = assert_specs(&build, &request.specs)?;

    let asset_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fixed_asset
           (asset_id, asset_number, name, category_code, site_id, sub_location, holder,
            condition, serial_number, acquired_on, specs, notes, quantity, status,
            registered_by, registered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'REGISTERED',$14,now())",
    )
    .bind(asset_id)
    .bind(asset_number)
    .bind(name)
    .bind(request.class_code.trim())
    .bind(request.site_id.trim())
    .bind(nothing_if_blank(request.sub_location.as_deref()))
    .bind(nothing_if_blank(request.holder.as_deref()))
    .bind(&condition)
    .bind(nothing_if_blank(request.serial_number.as_deref()))
    .bind(request.acquired_on)
    .bind(&specs)
    .bind(nothing_if_blank(request.notes.as_deref()))
    .bind(request.quantity.unwrap_or(1))
    .bind(actor)
    .execute(&mut *tx)
    .await
    .map_err(|error| plate_conflict(error, Some(&specs)))?;

    // "Didaftarkan GA" plus which form and which class, because that is the one
    // line that says what was written down and under what it was filed. The
    // caller's own note is appended when there is one: the reason for the
    // registration is theirs, and this row is the only place it is kept.
    let mut reason = format!(
        "Didaftarkan GA sebagai {build} · kelas {}",
        request.class_code.trim()
    );
    if let Some(note) = nothing_if_blank(request.notes.as_deref()) {
        reason.push_str(&format!(" — {note}"));
    }
    sqlx::query(
        "INSERT INTO ga_asset_event
           (asset_id, kind, to_site, to_holder, reason, occurred_on, recorded_by)
         VALUES ($1, 'REGISTERED', $2, $3, $4, $5, $6)",
    )
    .bind(asset_id)
    .bind(request.site_id.trim())
    .bind(nothing_if_blank(request.holder.as_deref()))
    .bind(&reason)
    .bind(request.acquired_on)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    ga_asset(pool, asset_id).await
}

/// Correct what GA knows about a thing, and write down what changed.
///
/// # What this refuses, and why
///
/// A change of `sub_location` here is refused unless it is the value already
/// there. Where a thing IS belongs to [`ga_asset_transfer`], which writes the
/// TRANSFER row; letting an edit move it would produce a location with no
/// history behind it, and the first question about any register is "how did
/// this get here".
///
/// # Two events, and only when something changed
///
/// A condition that changed writes one CONDITION line naming the old word and
/// the new one; a holder that changed writes one ASSIGN line naming both
/// people. A form saved without touching either writes nothing at all — a
/// history padded with "nothing changed" rows is a history nobody reads.
pub async fn ga_asset_update(
    pool: &PgPool,
    asset_id: Uuid,
    request: &UpdateGaAssetRequest,
    actor: &str,
) -> Result<GaAssetRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT a.category_code, a.name, a.sub_location, a.holder, a.condition,
                a.serial_number, a.notes, c.build
           FROM fixed_asset a
           JOIN asset_class c ON c.class_code = a.category_code
          WHERE a.asset_id = $1
          FOR UPDATE OF a",
    )
    .bind(asset_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("asset".into()))?;
    let class_code: String = current.try_get("category_code")?;
    let build: String = current.try_get("build")?;
    let was_holder: Option<String> = current.try_get("holder")?;
    let was_condition: String = current.try_get("condition")?;
    let was_location: Option<String> = current.try_get("sub_location")?;

    // The location is the transfer's fact — see above. Compared rather than
    // refused outright, so a form that posts the whole row back unchanged is
    // not a form that cannot be saved.
    if let Some(wanted) = request.sub_location.as_deref().map(str::trim) {
        if wanted != was_location.as_deref().unwrap_or_default() {
            return Err(AppError::Validation(format!(
                "where a thing is moves through the transfer, not through a \
                 correction: {class_code} is held at {} now",
                was_location.as_deref().unwrap_or("no particular place")
            )));
        }
    }

    let condition = match request.condition.as_deref() {
        Some(raw) => assert_condition(raw)?,
        None => was_condition.clone(),
    };
    let holder = match request.holder.as_deref() {
        // A holder field that was cleared is a thing nobody holds, which is a
        // real answer and not an absence of one.
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => was_holder.clone(),
    };
    let specs = match &request.specs {
        Some(given) => assert_specs(&build, given)?,
        None => serde_json::Value::Null,
    };

    let name = match request.name.as_deref() {
        Some(raw) if raw.trim().is_empty() => {
            return Err(AppError::Validation(
                "an asset needs a name; it is the one line somebody reads in a list".into(),
            ))
        }
        other => other,
    };

    // A field that was ABSENT is not a field that was CLEARED, and the three
    // text columns below say both. `NULL` is "leave it alone" — the form did
    // not carry the field; `''` is "there is nothing here any more", which is a
    // corrected serial or a note somebody removed. `NULLIF(btrim(…), '')` is
    // the whole of that distinction.
    let specs_to_write = (!specs.is_null()).then(|| specs.clone());
    sqlx::query(
        "UPDATE fixed_asset
            SET name          = CASE WHEN $2::text IS NULL THEN name ELSE btrim($2) END,
                holder        = $3,
                condition     = $4,
                serial_number = CASE WHEN $5::text IS NULL THEN serial_number
                                     ELSE NULLIF(btrim($5), '') END,
                specs         = COALESCE($6::jsonb, specs),
                notes         = CASE WHEN $7::text IS NULL THEN notes
                                     ELSE NULLIF(btrim($7), '') END
          WHERE asset_id = $1",
    )
    .bind(asset_id)
    .bind(name)
    .bind(&holder)
    .bind(&condition)
    .bind(request.serial_number.as_deref())
    .bind(&specs_to_write)
    .bind(request.notes.as_deref())
    .execute(&mut *tx)
    .await
    .map_err(|error| plate_conflict(error, specs_to_write.as_ref()))?;

    if condition != was_condition {
        let reason = format!("Kondisi berubah dari {was_condition} ke {condition}");
        sqlx::query(
            "INSERT INTO ga_asset_event
               (asset_id, kind, reason, occurred_on, recorded_by)
             VALUES ($1, 'CONDITION', $2, current_date, $3)",
        )
        .bind(asset_id)
        .bind(&reason)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }
    if holder != was_holder {
        let reason = format!(
            "Pemegang berpindah dari {} ke {}",
            was_holder.as_deref().unwrap_or("tidak ada"),
            holder.as_deref().unwrap_or("tidak ada")
        );
        sqlx::query(
            "INSERT INTO ga_asset_event
               (asset_id, kind, from_holder, to_holder, reason, occurred_on, recorded_by)
             VALUES ($1, 'ASSIGN', $2, $3, $4, current_date, $5)",
        )
        .bind(asset_id)
        .bind(&was_holder)
        .bind(&holder)
        .bind(&reason)
        .bind(actor)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    ga_asset(pool, asset_id).await
}

/// Move a thing: site, sub-location and holder, with one row saying it moved.
///
/// # Why the three move together
///
/// A transfer states the whole of where the thing is now. The sub-location is
/// never carried over from the old site — "Lt. 1 · area kasir" in a different
/// building is not a location — so an absent one means nowhere in particular,
/// and an absent holder means nobody holds it. A move that left the old
/// holder's name on a thing they handed back would be worse than one that
/// forgot to claim it.
///
/// The asset stays ONE row. The register's history is the events, not a trail
/// of rows each claiming the thing was somewhere once.
pub async fn ga_asset_transfer(
    pool: &PgPool,
    asset_id: Uuid,
    request: &TransferGaAssetRequest,
    actor: &str,
) -> Result<GaAssetRow, AppError> {
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation(
            "a move needs a reason; it is the only line that explains why the thing left".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT site_id, sub_location, holder FROM fixed_asset WHERE asset_id = $1 FOR UPDATE",
    )
    .bind(asset_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("asset".into()))?;
    let from_site: String = current.try_get("site_id")?;
    let was_location: Option<String> = current.try_get("sub_location")?;
    let was_holder: Option<String> = current.try_get("holder")?;

    // The destination has to be a place the estate has. Refused here rather
    // than by the foreign key so the message lists what the sites are — the
    // person sending this has usually just typed one wrong.
    let to_site = request.to_site.trim();
    let known: Option<(String,)> = sqlx::query_as("SELECT id FROM site WHERE id = $1")
        .bind(to_site)
        .fetch_optional(&mut *tx)
        .await?;
    if known.is_none() {
        return Err(AppError::Validation(format!(
            "{to_site} is not somewhere this estate has; a move names one of its own sites"
        )));
    }

    let to_location = nothing_if_blank(request.to_sub_location.as_deref());
    let to_holder = nothing_if_blank(request.to_holder.as_deref());
    // A transfer that says what is already true is not a move: it would write
    // an event with the same place on both sides, which reads as a mistake and
    // is one.
    if to_site == from_site
        && to_location == was_location.as_deref()
        && to_holder == was_holder.as_deref()
    {
        return Err(AppError::Validation(format!(
            "the thing is already at {from_site}{}; a transfer records a move",
            to_location
                .map(|place| format!(" · {place}"))
                .unwrap_or_default()
        )));
    }

    sqlx::query(
        "UPDATE fixed_asset SET site_id = $2, sub_location = $3, holder = $4 WHERE asset_id = $1",
    )
    .bind(asset_id)
    .bind(to_site)
    .bind(to_location)
    .bind(to_holder)
    .execute(&mut *tx)
    .await?;

    let reason = format!(
        "Transfer dari {from_site}{} ke {to_site}{} — {}",
        was_location
            .as_deref()
            .map(|place| format!(" · {place}"))
            .unwrap_or_default(),
        to_location
            .map(|place| format!(" · {place}"))
            .unwrap_or_default(),
        request.reason.trim()
    );
    sqlx::query(
        "INSERT INTO ga_asset_event
           (asset_id, kind, from_site, to_site, from_holder, to_holder, reason,
            occurred_on, recorded_by)
         VALUES ($1, 'TRANSFER', $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(asset_id)
    .bind(&from_site)
    .bind(to_site)
    .bind(&was_holder)
    .bind(to_holder)
    .bind(&reason)
    .bind(request.occurred_on)
    .bind(actor)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    ga_asset(pool, asset_id).await
}

/// Write something down about a thing that changes nothing else.
///
/// The fifth kind, and the one that makes the other four honest: a servis that
/// was done, a dent somebody noticed, a decision not to repair. None of those
/// change a column, and all of them are things a register is asked about.
pub async fn ga_asset_note(
    pool: &PgPool,
    asset_id: Uuid,
    reason: &str,
    occurred_on: NaiveDate,
    actor: &str,
) -> Result<GaAssetEvent, AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::Validation(
            "a note needs a reason; an entry that says nothing is a row nobody can act on".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let known: Option<(Uuid,)> =
        sqlx::query_as("SELECT asset_id FROM fixed_asset WHERE asset_id = $1")
            .bind(asset_id)
            .fetch_optional(&mut *tx)
            .await?;
    if known.is_none() {
        return Err(AppError::NotFound("asset".into()));
    }
    let row = sqlx::query(
        "INSERT INTO ga_asset_event
           (asset_id, kind, reason, occurred_on, recorded_by)
         VALUES ($1, 'NOTE', $2, $3, $4)
         RETURNING event_id, kind, from_site, to_site, from_holder, to_holder, reason,
                   occurred_on, recorded_by, recorded_at",
    )
    .bind(asset_id)
    .bind(reason.trim())
    .bind(occurred_on)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    let event = to_ga_event(&row)?;
    tx.commit().await?;
    Ok(event)
}
