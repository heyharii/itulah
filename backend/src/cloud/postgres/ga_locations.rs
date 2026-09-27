//! GA's locations: the place itself, and everything that points at it.
//!
//! # The list is the register's, the detail is GA's
//!
//! The list of places is `site`'s list — every allotment, ledger code and sync
//! credential already joins it — and this module decorates each row with the
//! side table `ga_location_detail` (0367): the address, the floor area, the
//! person to phone. That join is a LEFT JOIN on purpose, and it is the whole
//! point of the screen: a site nobody has written a detail for still appears in
//! "Locations", with its address blank rather than the site absent. A list of
//! places is not a list of places somebody filled a form in for.
//!
//! # The hub reads, it does not copy
//!
//! Brief §2.1: the "related" half of a page is a QUERY BACK through the
//! references that already point at the thing, never a copy of them. So the
//! asset count next to a place is `SELECT count(*) ... WHERE site_id = ?`, the
//! contracts are the ones whose own `site_id` (or coverage) names this place,
//! the repairs and schedules are the ones filed here, and the supplies are the
//! requests this place made. Nothing on the hub is stored twice, and none of
//! the money is GA's: `billed_this_month_minor` is a READ of Finance's POSTED
//! bills for the site, marked "Finance" on the screen.
//!
//! # Contract coverage is not a site id
//!
//! Brief §13: one contract can cover many shops (`site_scope`). A store's hub
//! must show the cleaning contract that covers ALL_STORES, and neither the
//! contract's `site_id` nor a copy of the contract on the site can say that.
//! So the hub adds two sets: contracts whose `site_id` is the place, and
//! contracts whose coverage INCLUDES the place (ALL_SITES anywhere; ALL_STORES
//! at a STORE, never at the HO). The utilities strip is that same set narrowed
//! to the LANGGANAN_* types, and each utility row carries its own last meter
//! reading because [`GaContractRow`] already reads it.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::ga_assets::{ga_asset_page, GaAssetRow, GaAssetScope, MAX_GA_ASSET_LIMIT};
use super::ga_contracts::{
    ga_contract_on, ga_contract_page, GaContractRow, GaContractScope, MAX_GA_CONTRACT_LIMIT,
};
use super::ga_maintenance::{
    ga_maintenance_task_page, ga_repair_page, GaMaintenanceScope, GaMaintenanceTaskRow,
    GaRepairRow, MAX_GA_MAINTENANCE_LIMIT,
};
use super::ga_supplies::{
    ga_supply_requests, GaSupplyRequestRow, GaSupplyScope, MAX_GA_SUPPLY_LIMIT,
};
use crate::cloud::application::AppError;

/// The three utility types. A Langganan contract is a subscription MEASURED at
/// a meter, and that is what the utilities strip draws.
const LANGGANAN_TYPES: &[&str] = &["LANGGANAN_LISTRIK", "LANGGANAN_AIR", "LANGGANAN_TELEKOM"];

/// How far ahead a schedule counts as "due" on a place's strip. Seven days,
/// the same window the overview uses and for the same reason: the shop's
/// service rounds are planned per week.
const DUE_TASK_HORIZON_DAYS: i32 = 7;

/// One place as GA reads it: the register's own row, GA's detail (absent for a
/// site nobody has filled in), and the counts read back through references.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaLocationRow {
    pub site_id: String,
    pub site_name: String,
    pub site_kind: String,
    pub address: Option<String>,
    pub kind: Option<String>,
    pub floor_area_sqm: Option<i32>,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    pub notes: Option<String>,
    /// `ga_location_detail.version`; 0 means GA has written no detail yet,
    /// which is a real answer and not a missing one.
    pub version: i32,
    /// Dibaca balik lewat rujukan yang sudah menunjuk site ini (brief §2.1:
    /// halaman "terkait" adalah query balik, bukan salinan).
    pub asset_count: i64,
    pub contract_count: i64,
    pub open_repair_count: i64,
    pub due_task_count: i64,
    pub supply_request_count: i64,
    /// Tagihan bulan ini untuk site ini, dari baris tagihan POSTED yang
    /// ber-site di sini. Rp; penandanya "Finance" di layar.
    pub billed_this_month_minor: i64,
}

/// One place, everything that points at it, and the utilities measured there.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GaLocationHub {
    pub location: GaLocationRow,
    pub assets: Vec<GaAssetRow>,
    pub contracts: Vec<GaContractRow>,
    pub repairs: Vec<GaRepairRow>,
    pub tasks: Vec<GaMaintenanceTaskRow>,
    pub supplies: Vec<GaSupplyRequestRow>,
    /// Utilitas site ini: kontrak LANGGANAN_* yang site-nya atau cakupannya
    /// mencakup, dengan bacaan meternya.
    pub utilities: Vec<GaContractRow>,
}

/// What may be corrected about a place's GA detail, in place.
///
/// Every field is optional and `None` leaves it alone; a text field posted as
/// `Some("")` CLEARS it, because a phone number somebody removed is a fact and
/// not a missing form field. `floor_area_sqm` cannot be nulled through here,
/// for the reason `ga_assets` cannot null a serial: TypeScript flattens
/// `Option<Option<T>>` to `T | null`, and a caller that omitted the field would
/// be asking a different question from the one it thought it was asking.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateGaLocationRequest {
    pub address: Option<String>,
    pub kind: Option<String>,
    pub floor_area_sqm: Option<i32>,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    pub notes: Option<String>,
}

/// The columns every location read needs, spelled once so the list and the
/// single read answer identically.
///
/// `$2` is the business day: the due window and "this month" are both ABOUT a
/// day, and a rule that decides either against the server's clock would answer
/// differently on the day the clock chip is moved. `$3` is the due horizon,
/// bound from [`DUE_TASK_HORIZON_DAYS`] so the window is one number and not two
/// spellings of it.
const GA_LOCATION_SEARCH: &str = "SELECT s.id AS site_id, s.name AS site_name, s.kind AS site_kind,
        d.address, d.kind, d.floor_area_sqm, d.contact_name, d.contact_phone, d.notes,
        COALESCE(d.version, 0) AS version,
        (SELECT count(*) FROM fixed_asset a WHERE a.site_id = s.id) AS asset_count,
        (SELECT count(*) FROM ga_contract c
          WHERE NOT c.archived
            AND (c.site_id = s.id
                 OR c.site_scope = 'ALL_SITES'
                 OR (c.site_scope = 'ALL_STORES' AND s.kind = 'STORE'))) AS contract_count,
        (SELECT count(*) FROM ga_repair r
          WHERE r.site_id = s.id
            AND r.status IN ('OPEN', 'APPROVED', 'IN_PROGRESS')) AS open_repair_count,
        (SELECT count(*) FROM ga_maintenance_task t
          WHERE t.site_id = s.id AND t.status = 'ACTIVE' AND t.next_due IS NOT NULL
            AND t.next_due <= $2::date + $3::integer) AS due_task_count,
        (SELECT count(*) FROM ga_supply_request q WHERE q.site_id = s.id) AS supply_request_count,
        COALESCE((SELECT sum(i.total_minor) FROM supplier_invoice i
                   WHERE i.site_id = s.id AND i.status = 'POSTED'
                     AND date_trunc('month', i.invoice_date) = date_trunc('month', $2::date)),
                 0)::bigint AS billed_this_month_minor
   FROM site s
   LEFT JOIN ga_location_detail d ON d.site_id = s.id";

/// Blank text is nothing, and nothing is stored as NULL rather than as "".
fn nothing_if_blank(raw: Option<&str>) -> Option<&str> {
    raw.map(str::trim).filter(|text| !text.is_empty())
}

fn to_location_row(row: &sqlx::postgres::PgRow) -> Result<GaLocationRow, AppError> {
    Ok(GaLocationRow {
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        site_kind: row.try_get("site_kind")?,
        address: row.try_get("address")?,
        kind: row.try_get("kind")?,
        floor_area_sqm: row.try_get("floor_area_sqm")?,
        contact_name: row.try_get("contact_name")?,
        contact_phone: row.try_get("contact_phone")?,
        notes: row.try_get("notes")?,
        version: row.try_get("version")?,
        asset_count: row.try_get("asset_count")?,
        contract_count: row.try_get("contract_count")?,
        open_repair_count: row.try_get("open_repair_count")?,
        due_task_count: row.try_get("due_task_count")?,
        supply_request_count: row.try_get("supply_request_count")?,
        billed_this_month_minor: row.try_get("billed_this_month_minor")?,
    })
}

/// The places, newest detail or not, as an ARRAY: this list is a nav screen,
/// not a report with a count.
///
/// `needle` free-texts the site id, its name and the address — the three things
/// somebody at a counter actually types.
pub async fn ga_locations(
    pool: &PgPool,
    needle: Option<&str>,
    today: NaiveDate,
) -> Result<Vec<GaLocationRow>, AppError> {
    let pattern = needle
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let sql = format!(
        "{GA_LOCATION_SEARCH}
          WHERE ($1::text IS NULL
                 OR s.id ILIKE $1
                 OR s.name ILIKE $1
                 OR d.address ILIKE $1)
          ORDER BY s.name, s.id"
    );
    let rows = sqlx::query(&sql)
        .bind(&pattern)
        .bind(today)
        .bind(DUE_TASK_HORIZON_DAYS)
        .fetch_all(pool)
        .await?;
    rows.iter().map(to_location_row).collect()
}

/// One place, everything that points at it, and its utilities.
pub async fn ga_location(
    pool: &PgPool,
    site_id: &str,
    today: NaiveDate,
) -> Result<GaLocationHub, AppError> {
    let sql = format!("{GA_LOCATION_SEARCH} WHERE s.id = $1");
    let row = sqlx::query(&sql)
        .bind(site_id)
        .bind(today)
        .bind(DUE_TASK_HORIZON_DAYS)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("site".into()))?;
    let location = to_location_row(&row)?;

    // The things whose own row says which place they are at. Each read is the
    // module that owns that fact; the hub only asks.
    let assets = ga_asset_page(
        pool,
        GaAssetScope {
            sites: vec![site_id.to_string()],
            limit: MAX_GA_ASSET_LIMIT,
            ..Default::default()
        },
    )
    .await?
    .rows;

    // The upkeep lists narrowed to this place in the query, so a busy site's
    // strip is its own newest rows rather than whatever of them survived the
    // estate's first page.
    let here = || GaMaintenanceScope {
        site_id: Some(site_id.to_string()),
        cursor: None,
        limit: MAX_GA_MAINTENANCE_LIMIT,
    };
    let repairs = ga_repair_page(pool, here(), today).await?.rows;
    let tasks = ga_maintenance_task_page(pool, here()).await?.rows;

    let supplies = ga_supply_requests(
        pool,
        GaSupplyScope {
            site_id: Some(site_id.to_string()),
            limit: MAX_GA_SUPPLY_LIMIT,
            ..Default::default()
        },
    )
    .await?;

    let contracts = contracts_touching(pool, site_id, &location.site_kind, None, today).await?;
    let utilities =
        contracts_touching(pool, site_id, &location.site_kind, Some(LANGGANAN_TYPES), today).await?;

    Ok(GaLocationHub {
        location,
        assets,
        contracts,
        repairs,
        tasks,
        supplies,
        utilities,
    })
}

/// The contracts that are about this place, either because they name it or
/// because their coverage includes it — brief §13's one contract, many shops.
///
/// `types` narrows to a subset (the utilities strip); `None` is every type.
async fn contracts_touching(
    pool: &PgPool,
    site_id: &str,
    site_kind: &str,
    types: Option<&[&str]>,
    today: NaiveDate,
) -> Result<Vec<GaContractRow>, AppError> {
    let type_filter: Vec<String> = types
        .map(|list| list.iter().map(|code| (*code).to_string()).collect())
        .unwrap_or_default();

    // The ones that name the site. `ga_contract_page` computes the standing
    // against the business day and carries the last meter reading, so the hub
    // does not re-implement any of that.
    let mut rows = ga_contract_page(
        pool,
        GaContractScope {
            needle: None,
            types: type_filter.clone(),
            groups: Vec::new(),
            sites: vec![site_id.to_string()],
            standings: Vec::new(),
            archived: Some(false),
            today,
            limit: MAX_GA_CONTRACT_LIMIT,
        },
    )
    .await?
    .rows;

    // And the ones that cover it. ALL_SITES covers every place; ALL_STORES
    // covers every STORE and never the HO. An empty type filter means "all
    // types", which is what a `cardinality` test expresses rather than an
    // `IS NULL` the binder has to special-case.
    let coverage_ids: Vec<Uuid> = sqlx::query(
        "SELECT contract_id FROM ga_contract
          WHERE NOT archived
            AND site_scope IS NOT NULL
            AND (site_scope = 'ALL_SITES' OR (site_scope = 'ALL_STORES' AND $2 = 'STORE'))
            AND (cardinality($1::text[]) = 0 OR contract_type = ANY($1))",
    )
    .bind(&type_filter)
    .bind(site_kind)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| row.try_get::<Uuid, _>("contract_id"))
    .collect::<Result<Vec<_>, _>>()?;
    for contract_id in coverage_ids {
        rows.push(ga_contract_on(pool, contract_id, today).await?);
    }

    // One order for both halves, so the strip does not reshuffle between reads.
    rows.sort_by(|a, b| {
        a.starts_on
            .cmp(&b.starts_on)
            .then_with(|| a.contract_number.cmp(&b.contract_number))
    });
    Ok(rows)
}

/// Correct GA's own detail of a place — or write the first one.
///
/// The site must be in the register (the hub's list IS the register), and this
/// never creates one: the UPSERT adds a DETAIL row, never a `site`. The whole
/// proposed row is what is written, so a form that posts one field leaves the
/// other five alone and a form that clears one clears it.
pub async fn ga_location_update(
    pool: &PgPool,
    site_id: &str,
    request: &UpdateGaLocationRequest,
    actor: &str,
    today: NaiveDate,
) -> Result<GaLocationRow, AppError> {
    let mut tx = pool.begin().await?;
    let known: Option<String> = sqlx::query_scalar("SELECT id FROM site WHERE id = $1")
        .bind(site_id)
        .fetch_optional(&mut *tx)
        .await?;
    if known.is_none() {
        return Err(AppError::NotFound("site".into()));
    }

    let current = sqlx::query(
        "SELECT address, kind, floor_area_sqm, contact_name, contact_phone, notes
           FROM ga_location_detail
          WHERE site_id = $1
          FOR UPDATE",
    )
    .bind(site_id)
    .fetch_optional(&mut *tx)
    .await?;

    let was_address: Option<String> = match &current {
        Some(row) => row.try_get("address")?,
        None => None,
    };
    let was_kind: Option<String> = match &current {
        Some(row) => row.try_get("kind")?,
        None => None,
    };
    let was_floor: Option<i32> = match &current {
        Some(row) => row.try_get("floor_area_sqm")?,
        None => None,
    };
    let was_contact_name: Option<String> = match &current {
        Some(row) => row.try_get("contact_name")?,
        None => None,
    };
    let was_contact_phone: Option<String> = match &current {
        Some(row) => row.try_get("contact_phone")?,
        None => None,
    };
    let was_notes: Option<String> = match &current {
        Some(row) => row.try_get("notes")?,
        None => None,
    };

    let address = match request.address.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => was_address,
    };
    let kind = match request.kind.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => was_kind,
    };
    let floor_area_sqm = match request.floor_area_sqm {
        Some(value) => {
            if value <= 0 {
                return Err(AppError::Validation(
                    "a floor area is a positive number of square metres; a room with no area \
                     is not a room"
                        .into(),
                ));
            }
            Some(value)
        }
        None => was_floor,
    };
    let contact_name = match request.contact_name.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => was_contact_name,
    };
    let contact_phone = match request.contact_phone.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => was_contact_phone,
    };
    let notes = match request.notes.as_deref() {
        Some(raw) => nothing_if_blank(Some(raw)).map(str::to_string),
        None => was_notes,
    };

    // One UPSERT: INSERT the first detail, or UPDATE the existing one without
    // ever touching `created_by` — who first described the place is part of
    // what the row is.
    sqlx::query(
        "INSERT INTO ga_location_detail
           (site_id, address, kind, floor_area_sqm, contact_name, contact_phone, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (site_id) DO UPDATE
            SET address        = $2,
                kind           = $3,
                floor_area_sqm = $4,
                contact_name   = $5,
                contact_phone  = $6,
                notes          = $7,
                updated_by     = $9,
                updated_at     = now(),
                version        = ga_location_detail.version + 1",
    )
    .bind(site_id)
    .bind(address.as_deref())
    .bind(kind.as_deref())
    .bind(floor_area_sqm)
    .bind(contact_name.as_deref())
    .bind(contact_phone.as_deref())
    .bind(notes.as_deref())
    .bind(actor)
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(ga_location(pool, site_id, today).await?.location)
}
