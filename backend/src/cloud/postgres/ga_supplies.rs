//! GA's supplies: the ask a place files for paper, cleaning fluid and bulbs,
//! and the stages that ask walks through.
//!
//! # The ask, not the purchase
//!
//! This module records what a place NEEDS. It never buys anything, never
//! chooses an account and never writes a journal: the category names the kind
//! of thing (`ATK`, `RUMAH_TANGGA`, ...), and Finance's `supply_expense` map
//! turns that kind into an account the day a bill points at this request. The
//! one link to Procurement is [`GaSupplyRequestRow::po_reference`], a TEXT
//! field holding the number somebody types once a non-trade PO exists (brief
//! §15 tahap 5) — not a foreign key, because the table it would point at is not
//! in this database yet.
//!
//! # The ladder is Rust, the vocabulary is the database
//!
//! A CHECK can say which states exist; it cannot say which MOVE is legal,
//! because that depends on where the row has been. So the ladder is
//! [`crate::cloud::domain::supply_may_move`], pure and tested, and the writer
//! refuses an illegal move with a sentence naming both ends. Two rules have a
//! home in both places: the column refuses a REJECTED row with no reason, and
//! the writer says WHY before the constraint has to; the column refuses a
//! `po_reference` on a request that was never ORDERED, and the writer refuses
//! to set one on any other move with a sentence about what a PO number is.
//!
//! # A shop files for itself
//!
//! Brief §11: a shop may create a supply request only for its own site. The
//! route passes the session's site in as `actor_site`; head office passes
//! `None` and may file for any place. The comparison lives here, in
//! [`assert_own_site`], rather than in the route, so that no second route can
//! be written that forgets it.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::cloud::application::AppError;
use crate::cloud::domain::supply_may_move;

/// One supply request as GA reads it: the ask, its category's name and the
/// account that category resolves to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaSupplyRequestRow {
    pub request_id: Uuid,
    /// The number people say: `SR-DDMMYY-NNN`, the Jakarta day it was filed
    /// and its place in that day (0981). Given by the database.
    pub request_number: String,
    pub site_id: String,
    pub requested_by: String,
    pub category_code: String,
    /// The client's own name for the category ("ATK & barang cetakan").
    pub category_name: String,
    /// The expense account the category points at (brief §9.4). Read through
    /// the category, never stored on the request: the map is one row per
    /// category and a copy here would be a second answer to the same question.
    pub account_code: String,
    pub item: String,
    /// As the shop typed it: "2 rim", "5 dus".
    pub quantity: Option<String>,
    /// The same, read against the units master (0655): "2" and RIM. Null
    /// when the text is not a number and a unit the master knows.
    pub quantity_value: Option<String>,
    pub unit_code: Option<String>,
    pub needed_by: Option<NaiveDate>,
    pub estimated_cost_minor: Option<i64>,
    /// The purchase order number, present only once the request is ORDERED.
    pub po_reference: Option<String>,
    /// `REQUESTED`, `APPROVED`, `ORDERED`, `RECEIVED`, `BILLED` or `REJECTED`.
    pub status: String,
    /// Required when, and only when, the request is REJECTED.
    pub rejected_reason: Option<String>,
    /// Σ baris tagihan POSTED yang menunjuk permintaan ini (brief §4): the
    /// Finance figure read back, not stored. Drafts and held bills do not move
    /// it beyond POSTED; a held bill still counts (hold bukan batal).
    pub billed_minor: i64,
    /// The bill GA sent for this request, newest first when there are
    /// several: whose paper it is and its number. Absent until one is sent;
    /// a void or rejected paper is not one.
    pub bill: Option<super::GaLinkedBill>,
    pub notes: Option<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub version: i32,
}

/// One of the seven GA supply categories, with the account it resolves to.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaSupplyCategory {
    pub category_code: String,
    pub name: String,
    pub account_code: String,
}

/// What a caller is asking the supply list for.
#[derive(Clone, Debug, Default)]
pub struct GaSupplyScope {
    /// `Some` narrows to one place; `None` is the whole estate, which is what
    /// head office reads.
    pub site_id: Option<String>,
    /// `REQUESTED`, `APPROVED`, ... — any subset; empty means all.
    pub statuses: Vec<String>,
    /// Free text against the item, who asked, the request's number and the
    /// PO number.
    pub needle: Option<String>,
    /// `ATK`, `MESS`, ... — any subset; empty means all.
    pub categories: Vec<String>,
    /// `Some(day)` keeps only what is overdue on that day: needed before it
    /// and not yet received ([`BEFORE_RECEIPT`]).
    pub overdue_on: Option<NaiveDate>,
    pub limit: i64,
}

/// The states a request can be late in: it has not reached the shop yet.
/// Received is somebody else's wait, not a need that went unmet.
pub const BEFORE_RECEIPT: [&str; 3] = ["REQUESTED", "APPROVED", "ORDERED"];

/// The list's first page when a caller does not say.
pub const DEFAULT_GA_SUPPLY_LIMIT: i64 = 200;
/// And the most it will answer with however loudly a caller asks — the same
/// ceiling the registers keep, for the same reason.
pub const MAX_GA_SUPPLY_LIMIT: i64 = 1000;

/// File a request. The status starts REQUESTED: nobody has decided anything.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct RecordGaSupplyRequestRequest {
    pub site_id: String,
    pub requested_by: String,
    pub category_code: String,
    pub item: String,
    pub quantity: Option<String>,
    pub needed_by: Option<NaiveDate>,
    pub estimated_cost_minor: Option<i64>,
    pub notes: Option<String>,
}

/// Move a request one rung up its ladder, or off it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct MoveGaSupplyRequestRequest {
    /// The state to move to.
    pub to: String,
    /// The purchase order number. Only legal when moving to ORDERED; a number
    /// typed at any other stage is refused with a sentence saying so.
    pub po_reference: Option<String>,
    /// Why the request was turned down. Required when moving to REJECTED.
    pub rejected_reason: Option<String>,
}

/// Correct a request that has not been decided yet.
///
/// Every field is optional and `None` leaves it alone. Only a REQUESTED request
/// may be corrected: once somebody has approved or rejected it, the row is a
/// decision with a history, and a change to it would rewrite what was decided
/// rather than correct a typo. A cleared text field is `Some("")`, which stores
/// NULL — the same convention `ga_assets` keeps.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGaSupplyRequest {
    pub requested_by: Option<String>,
    pub category_code: Option<String>,
    pub item: Option<String>,
    pub quantity: Option<String>,
    pub needed_by: Option<NaiveDate>,
    pub estimated_cost_minor: Option<i64>,
    pub notes: Option<String>,
}

/// The request joined to the category it needs, named once so every read sees
/// the same answer.
const GA_SUPPLY_SELECT: &str = "SELECT q.request_id, q.request_number, q.site_id, q.requested_by,
        q.category_code, c.name AS category_name, c.account_code, q.item, q.quantity,
        trim_scale(q.quantity_value)::text AS quantity_value, q.unit_code, q.needed_by,
        q.estimated_cost_minor, q.po_reference, q.status, q.rejected_reason, q.notes,
        q.created_by, q.created_at, q.version,
        (SELECT COALESCE(SUM(bl.amount_minor), 0)::bigint
           FROM supplier_invoice_expense_line bl
           JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
          WHERE bl.supply_request_id = q.request_id AND si.status = 'POSTED') AS billed_minor,
        bill.invoice_id AS bill_invoice_id, bill.invoice_number AS bill_invoice_number,
        bill.invoice_date AS bill_invoice_date, bill.supplier_id AS bill_supplier_id,
        bill.supplier_name AS bill_supplier_name, bill.status AS bill_status,
        bill.amount_minor AS bill_amount_minor
   FROM ga_supply_request q
   JOIN ga_supply_category c ON c.category_code = q.category_code
   LEFT JOIN LATERAL (
        SELECT si.invoice_id, si.invoice_number, si.invoice_date, si.supplier_id,
               __BILL_SUPPLIER_NAME__ AS supplier_name, si.status,
               sum(bl.amount_minor)::bigint AS amount_minor
          FROM supplier_invoice_expense_line bl
          JOIN supplier_invoice si ON si.invoice_id = bl.invoice_id
         WHERE bl.supply_request_id = q.request_id
           AND si.status NOT IN ('VOID', 'REJECTED')
         GROUP BY si.invoice_id
         ORDER BY si.invoice_date DESC, si.recorded_at DESC
         LIMIT 1
   ) bill ON true";

/// [`GA_SUPPLY_SELECT`] with the bill's supplier name spliced in, once.
fn supply_select() -> String {
    GA_SUPPLY_SELECT.replace("__BILL_SUPPLIER_NAME__", super::ga::BILL_SUPPLIER_NAME)
}

/// The narrowing every supply read shares, over `q` and the parameters
/// `$1` site, `$2` states, `$3` search, `$4` categories and `$5` the overdue
/// day — spelled once so the page, the array and the counts agree.
const GA_SUPPLY_FILTERS: &str = "($1::text IS NULL OR q.site_id = $1)
            AND ($2::text[] IS NULL OR q.status = ANY($2))
            AND ($3::text IS NULL OR q.item ILIKE $3
                 OR q.requested_by ILIKE $3
                 OR q.request_number ILIKE $3
                 OR q.po_reference ILIKE $3)
            AND ($4::text[] IS NULL OR q.category_code = ANY($4))
            AND ($5::date IS NULL
                 OR (q.needed_by < $5 AND q.status IN ('REQUESTED', 'APPROVED', 'ORDERED')))";

/// The scope's parameters, cleaned: blank is nothing, a search is a pattern.
struct SupplyParams {
    site: Option<String>,
    statuses: Option<Vec<String>>,
    needle: Option<String>,
    categories: Option<Vec<String>>,
    overdue_on: Option<NaiveDate>,
    limit: i64,
}

impl SupplyParams {
    fn of(scope: &GaSupplyScope) -> Self {
        Self {
            site: scope
                .site_id
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_string),
            statuses: (!scope.statuses.is_empty()).then(|| scope.statuses.clone()),
            needle: scope
                .needle
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(|text| format!("%{text}%")),
            categories: (!scope.categories.is_empty()).then(|| scope.categories.clone()),
            overdue_on: scope.overdue_on,
            limit: scope.limit.clamp(1, MAX_GA_SUPPLY_LIMIT),
        }
    }
}

/// The typed quantity read against the units master: "2 rim" is 2 and RIM.
/// Anything else — no number, two parts, a word the master does not know —
/// reads as nothing and the text alone is kept.
async fn read_quantity(
    pool: &PgPool,
    text: Option<&str>,
) -> Result<(Option<rust_decimal::Decimal>, Option<String>), AppError> {
    let Some((value, Some(word))) = text.and_then(crate::cloud::domain::uom::split_quantity) else {
        return Ok((None, None));
    };
    let units = super::units::unit_lookup(pool).await?;
    Ok(match units.resolve(&word) {
        Some(code) => (Some(value), Some(code.to_owned())),
        None => (None, None),
    })
}

/// Blank text is nothing, and nothing is stored as NULL rather than as "".
fn nothing_if_blank(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|text| !text.is_empty())
}

fn to_supply_row(row: &sqlx::postgres::PgRow) -> Result<GaSupplyRequestRow, AppError> {
    let bill = match row.try_get::<Option<Uuid>, _>("bill_invoice_id")? {
        Some(invoice_id) => Some(super::GaLinkedBill {
            invoice_id,
            invoice_number: row.try_get("bill_invoice_number")?,
            invoice_date: row.try_get("bill_invoice_date")?,
            supplier_id: row.try_get("bill_supplier_id")?,
            supplier_name: row.try_get("bill_supplier_name")?,
            status: row.try_get("bill_status")?,
            amount_minor: row.try_get("bill_amount_minor")?,
        }),
        None => None,
    };
    Ok(GaSupplyRequestRow {
        request_id: row.try_get("request_id")?,
        request_number: row.try_get("request_number")?,
        site_id: row.try_get("site_id")?,
        requested_by: row.try_get("requested_by")?,
        category_code: row.try_get("category_code")?,
        category_name: row.try_get("category_name")?,
        account_code: row.try_get("account_code")?,
        item: row.try_get("item")?,
        quantity: row.try_get("quantity")?,
        quantity_value: row.try_get("quantity_value")?,
        unit_code: row.try_get("unit_code")?,
        needed_by: row.try_get("needed_by")?,
        estimated_cost_minor: row.try_get("estimated_cost_minor")?,
        po_reference: row.try_get("po_reference")?,
        status: row.try_get("status")?,
        rejected_reason: row.try_get("rejected_reason")?,
        billed_minor: row.try_get("billed_minor")?,
        bill,
        notes: row.try_get("notes")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        version: row.try_get("version")?,
    })
}

/// Brief §11: a shop may file, and move, a supply request only for its own
/// site. `actor_site` is the session's site, handed in by the route; head
/// office passes `None` and is not narrowed. The check lives here so the rule
/// cannot be lost between two routes that both need it.
fn assert_own_site(actor_site: Option<&str>, site_id: &str) -> Result<(), AppError> {
    if let Some(own) = actor_site.map(str::trim).filter(|site| !site.is_empty()) {
        if own != site_id.trim() {
            return Err(AppError::Validation(format!(
                "a shop files a supply request for its own site; {} is not {own}",
                site_id.trim()
            )));
        }
    }
    Ok(())
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
            "{site_id} is not somewhere this estate has; a request is filed by a place"
        )))
    }
}

/// The category must be one of the seven, and the refusal lists them.
async fn require_supply_category(
    executor: impl sqlx::PgExecutor<'_>,
    raw: &str,
) -> Result<(), AppError> {
    let code = raw.trim();
    let names: Vec<String> =
        sqlx::query("SELECT category_code FROM ga_supply_category ORDER BY sort_order")
            .fetch_all(executor)
            .await?
            .iter()
            .filter_map(|row| row.try_get::<String, _>("category_code").ok())
            .collect();
    if names.iter().any(|known| known == code) {
        return Ok(());
    }
    Err(AppError::Validation(format!(
        "{code} is not a supply category; GA supplies are one of: {}",
        names.join(", ")
    )))
}

/// One request, by id, as the writer hands it back.
async fn read_supply_request(
    pool: &PgPool,
    request_id: Uuid,
) -> Result<GaSupplyRequestRow, AppError> {
    let sql = format!("{} WHERE q.request_id = $1", supply_select());
    let row = sqlx::query(&sql)
        .bind(request_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("supply request".into()))?;
    to_supply_row(&row)
}

/// The supply list: newest ask first, narrowed by place, stage and free text.
///
/// An ARRAY and not a page envelope: this is a strip on the site hub and the
/// Supplies screen, and the count that a page would carry is on the overview.
pub async fn ga_supply_requests(
    pool: &PgPool,
    scope: GaSupplyScope,
) -> Result<Vec<GaSupplyRequestRow>, AppError> {
    let params = SupplyParams::of(&scope);
    let sql = format!(
        "{}
          WHERE {GA_SUPPLY_FILTERS}
          ORDER BY q.created_at DESC, q.request_id
          LIMIT $6",
        supply_select()
    );
    let rows = sqlx::query(&sql)
        .bind(&params.site)
        .bind(&params.statuses)
        .bind(&params.needle)
        .bind(&params.categories)
        .bind(params.overdue_on)
        .bind(params.limit)
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_supply_row).collect()
}

/// A page of the supply register, and the shape of everything it was drawn
/// from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaSupplyPage {
    pub rows: Vec<GaSupplyRequestRow>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    /// Every request the site, the stages and the search match.
    pub total: i64,
    /// How the requests in the site and the search split by stage, ignoring
    /// which stages are ticked — what the screen's strip counts.
    pub statuses: Vec<super::GaMaintenanceFacet>,
    /// How the requests in the site, the search and the ticked stages (the
    /// tab) split by category, ignoring which categories are ticked. Every
    /// category is listed, an empty one with 0; the label is its name.
    pub categories: Vec<super::GaMaintenanceFacet>,
    /// Requests in the site and the search that are overdue on the business
    /// day: needed before it and not yet received. Whatever the tab.
    pub overdue: i64,
}

/// Where the previous page stopped: the last request's id.
#[derive(Serialize, Deserialize)]
struct GaSupplyCursor {
    request_id: Uuid,
}

/// The supply register a page at a time: the same rows [`ga_supply_requests`]
/// answers, walked by a keyset on `(created_at, request_id)`, newest first.
///
/// A separate reader rather than a cursor on the array: the array is what a
/// shop's till and the site hub read, and an envelope would change their
/// answer under them.
pub async fn ga_supply_page(
    pool: &PgPool,
    scope: GaSupplyScope,
    cursor: Option<&str>,
    today: NaiveDate,
) -> Result<GaSupplyPage, AppError> {
    let params = SupplyParams::of(&scope);
    let after = cursor
        .map(super::decode_cursor::<GaSupplyCursor>)
        .transpose()?
        .map(|cursor| cursor.request_id);
    let sql = format!(
        "{}
          WHERE {GA_SUPPLY_FILTERS}
            AND ($6::uuid IS NULL
                 OR (q.created_at, q.request_id) <
                    (SELECT x.created_at, x.request_id
                       FROM ga_supply_request x WHERE x.request_id = $6))
          ORDER BY q.created_at DESC, q.request_id DESC
          LIMIT $7",
        supply_select()
    );
    let rows = sqlx::query(&sql)
        .bind(&params.site)
        .bind(&params.statuses)
        .bind(&params.needle)
        .bind(&params.categories)
        .bind(params.overdue_on)
        .bind(after)
        .bind(params.limit)
        .fetch_all(pool)
        .await?;
    let out = rows
        .iter()
        .map(to_supply_row)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = match out.last() {
        Some(last) if out.len() as i64 == params.limit => {
            Some(super::encode_cursor(&GaSupplyCursor {
                request_id: last.request_id,
            })?)
        }
        _ => None,
    };

    // The stage counts read the SEARCHED set (site and search), ignoring the
    // ticked stages; the categories read the searched set within the ticked
    // stages — the tab — ignoring the ticked categories; the overdue figure
    // reads the searched set whatever is ticked; the total reads the filtered
    // set.
    let counted = sqlx::query(
        "WITH searched AS (
             SELECT q.status, q.category_code, q.needed_by FROM ga_supply_request q
              WHERE ($1::text IS NULL OR q.site_id = $1)
                AND ($3::text IS NULL OR q.item ILIKE $3
                     OR q.requested_by ILIKE $3
                     OR q.request_number ILIKE $3
                     OR q.po_reference ILIKE $3)
         ), tabbed AS (
             SELECT * FROM searched WHERE $2::text[] IS NULL OR status = ANY($2)
         )
         SELECT 'status' AS kind, status AS value, NULL::text AS label, COUNT(*)::bigint AS n
           FROM searched GROUP BY status
          UNION ALL
         SELECT 'category', c.category_code, c.name, COUNT(t.category_code)::bigint
           FROM ga_supply_category c
           LEFT JOIN tabbed t ON t.category_code = c.category_code
          GROUP BY c.category_code, c.name
          UNION ALL
         SELECT 'overdue', '', NULL, COUNT(*)::bigint
           FROM searched
          WHERE needed_by < $6 AND status IN ('REQUESTED', 'APPROVED', 'ORDERED')
          UNION ALL
         SELECT 'all', '', NULL, COUNT(*)::bigint
           FROM tabbed
          WHERE ($4::text[] IS NULL OR category_code = ANY($4))
            AND ($5::date IS NULL
                 OR (needed_by < $5 AND status IN ('REQUESTED', 'APPROVED', 'ORDERED')))",
    )
    .bind(&params.site)
    .bind(&params.statuses)
    .bind(&params.needle)
    .bind(&params.categories)
    .bind(params.overdue_on)
    .bind(today)
    .fetch_all(pool)
    .await?;
    let mut total = 0i64;
    let mut overdue = 0i64;
    let mut by_status = Vec::new();
    let mut by_category = Vec::new();
    for row in &counted {
        let kind: String = row.try_get("kind")?;
        let count: i64 = row.try_get("n")?;
        let facet = || -> Result<super::GaMaintenanceFacet, AppError> {
            Ok(super::GaMaintenanceFacet {
                value: row.try_get("value")?,
                label: row.try_get("label")?,
                count,
            })
        };
        match kind.as_str() {
            "status" => by_status.push(facet()?),
            "category" => by_category.push(facet()?),
            "overdue" => overdue = count,
            _ => total = count,
        }
    }
    by_status.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    // The categories stand in the client's own order, the order the form's
    // tiles take, rather than by size: a chip row that reorders as requests
    // are filed is a row nobody can learn.
    let order = ga_supply_categories(pool).await?;
    by_category.sort_by_key(|facet| {
        order
            .iter()
            .position(|one| one.category_code == facet.value)
            .unwrap_or(usize::MAX)
    });
    Ok(GaSupplyPage {
        rows: out,
        next_cursor,
        total,
        statuses: by_status,
        categories: by_category,
        overdue,
    })
}

/// One request, by id — what the request sheet opens, wherever in the
/// register the request sits.
pub async fn ga_supply_request(
    pool: &PgPool,
    request_id: Uuid,
) -> Result<GaSupplyRequestRow, AppError> {
    read_supply_request(pool, request_id).await
}

/// The seven categories, in the order the picker offers them.
pub async fn ga_supply_categories(pool: &PgPool) -> Result<Vec<GaSupplyCategory>, AppError> {
    let rows = sqlx::query(
        "SELECT category_code, name, account_code
           FROM ga_supply_category
          ORDER BY sort_order, category_code",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(GaSupplyCategory {
                category_code: row.try_get("category_code")?,
                name: row.try_get("name")?,
                account_code: row.try_get("account_code")?,
            })
        })
        .collect()
}

/// File the ask.
///
/// The place is checked in words before the foreign key gets a chance to refuse
/// in a constraint name, and the site-own rule is applied before anything is
/// written.
pub async fn ga_supply_record(
    pool: &PgPool,
    request: &RecordGaSupplyRequestRequest,
    actor: &str,
    actor_site: Option<&str>,
) -> Result<GaSupplyRequestRow, AppError> {
    let site_id = request.site_id.trim();
    if site_id.is_empty() {
        return Err(AppError::Validation(
            "a supply request is filed for a site; name it".into(),
        ));
    }
    assert_own_site(actor_site, site_id)?;
    if request.requested_by.trim().is_empty() {
        return Err(AppError::Validation(
            "a supply request says who asked for it; that name is who to answer".into(),
        ));
    }
    if request.item.trim().is_empty() {
        return Err(AppError::Validation(
            "a supply request says what is needed; one line is enough".into(),
        ));
    }
    if request.estimated_cost_minor.is_some_and(|value| value < 0) {
        return Err(AppError::Validation(
            "an estimate is what the request is expected to cost; a negative one is not".into(),
        ));
    }

    let quantity = nothing_if_blank(request.quantity.as_deref());
    let (quantity_value, unit_code) = read_quantity(pool, quantity).await?;

    let mut tx = pool.begin().await?;
    require_site(&mut *tx, site_id).await?;
    require_supply_category(&mut *tx, &request.category_code).await?;

    let row = sqlx::query(
        "INSERT INTO ga_supply_request
           (site_id, requested_by, category_code, item, quantity, needed_by,
            estimated_cost_minor, notes, created_by, quantity_value, unit_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING request_id",
    )
    .bind(site_id)
    .bind(request.requested_by.trim())
    .bind(request.category_code.trim())
    .bind(request.item.trim())
    .bind(quantity)
    .bind(request.needed_by)
    .bind(request.estimated_cost_minor)
    .bind(nothing_if_blank(request.notes.as_deref()))
    .bind(actor)
    .bind(quantity_value)
    .bind(&unit_code)
    .fetch_one(&mut *tx)
    .await?;
    let request_id: Uuid = row.try_get("request_id")?;
    tx.commit().await?;
    read_supply_request(pool, request_id).await
}

/// Move a request one rung up its ladder, or off it.
///
/// # The three refusals this writer owns
///
///  * an illegal move, named at both ends — the ladder is
///    [`crate::cloud::domain::supply_may_move`];
///  * a `po_reference` offered at any stage but ORDERED — a PO number is what
///    the request was ORDERED on, and typing one before that is a fact about
///    the future;
///  * a REJECTED move with no reason — the shop is being told "no" and the
///    reason is what they read.
///
/// A `po_reference` already on the row is CARRIED through the later moves: a
/// request that was ordered and then received did not lose the number it was
/// ordered on.
pub async fn ga_supply_move(
    pool: &PgPool,
    request_id: Uuid,
    request: &MoveGaSupplyRequestRequest,
    actor: &str,
    actor_site: Option<&str>,
) -> Result<GaSupplyRequestRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT site_id, status, po_reference, rejected_reason
           FROM ga_supply_request
          WHERE request_id = $1
          FOR UPDATE",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("supply request".into()))?;

    let site_id: String = current.try_get("site_id")?;
    assert_own_site(actor_site, &site_id)?;
    let from: String = current.try_get("status")?;
    let existing_po: Option<String> = current.try_get("po_reference")?;
    let existing_reason: Option<String> = current.try_get("rejected_reason")?;

    let to = request.to.trim().to_ascii_uppercase();
    if !supply_may_move(&from, &to) {
        return Err(AppError::Conflict(format!(
            "a {from} supply request does not become {to}; the stages move one way: {}",
            crate::cloud::domain::SUPPLY_STATUS_FLOW.join(" -> ")
        )));
    }

    // A PO number belongs to the ORDERED move and to nothing else.
    let offered_po = nothing_if_blank(request.po_reference.as_deref());
    let po_reference = if to == "ORDERED" {
        offered_po.map(str::to_string)
    } else {
        if offered_po.is_some() {
            return Err(AppError::Validation(
                "a po_reference is the number of the purchase order this request was ordered \
                 on; it can only be given when the request moves to ORDERED"
                    .into(),
            ));
        }
        existing_po
    };

    // A rejection says why; nothing else carries a reason.
    let rejected_reason = if to == "REJECTED" {
        Some(
            nothing_if_blank(request.rejected_reason.as_deref())
                .ok_or_else(|| {
                    AppError::Validation(
                        "a rejected supply request says why; the reason is what the shop reads"
                            .into(),
                    )
                })?
                .to_string(),
        )
    } else {
        if nothing_if_blank(request.rejected_reason.as_deref()).is_some() {
            return Err(AppError::Validation(
                "a rejected_reason belongs to a rejection; only a move to REJECTED carries one"
                    .into(),
            ));
        }
        existing_reason
    };

    sqlx::query(
        "UPDATE ga_supply_request
            SET status          = $2,
                po_reference    = $3,
                rejected_reason = $4,
                updated_by      = $5,
                updated_at      = now(),
                version         = version + 1
          WHERE request_id = $1",
    )
    .bind(request_id)
    .bind(&to)
    .bind(&po_reference)
    .bind(&rejected_reason)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    read_supply_request(pool, request_id).await
}

/// Correct a request nobody has decided yet.
///
/// Only a REQUESTED request may be corrected; see [`UpdateGaSupplyRequest`].
/// The whole row is re-checked on the PROPOSED state, not on the delta, so a
/// correction cannot leave a request illegal whichever half of the edit made it
/// so.
pub async fn ga_supply_update(
    pool: &PgPool,
    request_id: Uuid,
    request: &UpdateGaSupplyRequest,
    actor: &str,
    actor_site: Option<&str>,
) -> Result<GaSupplyRequestRow, AppError> {
    let mut tx = pool.begin().await?;
    let current = sqlx::query(
        "SELECT site_id, status, requested_by, category_code, item, quantity, needed_by,
                estimated_cost_minor, notes
           FROM ga_supply_request
          WHERE request_id = $1
          FOR UPDATE",
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("supply request".into()))?;

    let site_id: String = current.try_get("site_id")?;
    assert_own_site(actor_site, &site_id)?;
    let status: String = current.try_get("status")?;
    if status != "REQUESTED" {
        return Err(AppError::Conflict(format!(
            "a supply request that is {status} has been decided; correct only a REQUESTED \
             one, or file a new request"
        )));
    }

    let requested_by = match request.requested_by.as_deref() {
        Some(raw) if raw.trim().is_empty() => {
            return Err(AppError::Validation(
                "a supply request says who asked for it; that name is who to answer".into(),
            ))
        }
        Some(raw) => raw.trim().to_string(),
        None => current.try_get("requested_by")?,
    };
    let category_code = match request.category_code.as_deref() {
        Some(raw) => {
            require_supply_category(&mut *tx, raw).await?;
            raw.trim().to_string()
        }
        None => current.try_get("category_code")?,
    };
    let item = match request.item.as_deref() {
        Some(raw) if raw.trim().is_empty() => {
            return Err(AppError::Validation(
                "a supply request says what is needed; one line is enough".into(),
            ))
        }
        Some(raw) => raw.trim().to_string(),
        None => current.try_get("item")?,
    };
    // A field that was ABSENT leaves what is there; a field that was CLEARED
    // stores NULL. `nothing_if_blank` is the whole of that distinction for text.
    let quantity = match request.quantity.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => current.try_get("quantity")?,
    };
    let needed_by = match request.needed_by {
        Some(day) => Some(day),
        None => current.try_get("needed_by")?,
    };
    let estimated_cost_minor = match request.estimated_cost_minor {
        Some(value) => {
            if value < 0 {
                return Err(AppError::Validation(
                    "an estimate is what the request is expected to cost; a negative one is not"
                        .into(),
                ));
            }
            Some(value)
        }
        None => current.try_get("estimated_cost_minor")?,
    };
    let notes = match request.notes.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => current.try_get("notes")?,
    };
    let (quantity_value, unit_code) = read_quantity(pool, quantity.as_deref()).await?;

    sqlx::query(
        "UPDATE ga_supply_request
            SET requested_by         = $2,
                category_code        = $3,
                item                 = $4,
                quantity             = $5,
                needed_by            = $6,
                estimated_cost_minor = $7,
                notes                = $8,
                updated_by           = $9,
                quantity_value       = $10,
                unit_code            = $11,
                updated_at           = now(),
                version              = version + 1
          WHERE request_id = $1",
    )
    .bind(request_id)
    .bind(&requested_by)
    .bind(&category_code)
    .bind(&item)
    .bind(quantity.as_deref())
    .bind(needed_by)
    .bind(estimated_cost_minor)
    .bind(notes.as_deref())
    .bind(actor)
    .bind(quantity_value)
    .bind(&unit_code)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    read_supply_request(pool, request_id).await
}
