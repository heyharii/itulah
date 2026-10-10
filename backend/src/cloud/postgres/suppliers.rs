use super::{begin_idempotent, complete_idempotent, inventory_dc_owner_tx, issue_command_tx};
use crate::cloud::{
    application::AppError,
    domain::{
        normalize_legal_form, normalize_supplier_code, normalize_supplier_phones,
        normalize_tag_codes, optional_supplier_text, parse_purchase_order, required_supplier_text,
        validate_supplier_item_price, PurchaseOrderLinePayload, Supplier, SupplierItem,
        SupplierItemColour, SupplierStatus, COMMAND_PURCHASE_ORDER_ACTIVATE,
        COMMAND_PURCHASE_ORDER_REVISE,
    },
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgRow, PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateSupplierRequest {
    /// Ours for this supplier. Blank or absent and the server numbers it: the
    /// next free four-digit number (`0001`, `0002` …), given inside the same
    /// transaction that writes the row — see [`next_supplier_number`].
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub supplier_code: Option<String>,
    pub name: String,
    #[serde(default)]
    pub contact_name: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub status: SupplierStatus,
    /// Which book: `MERCHANDISE` (the default, and what every existing row
    /// is), `EXPENSE` or `AFFILIATE`. See migration 0212.
    ///
    /// Optional on the wire as well as in serde: the screens that existed
    /// before this column did send no such field, and a required one would
    /// have broken all four of them to add a word most of them never say.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub category: Option<String>,
    /// The account this party's bills usually debit. Refused on a merchandise
    /// supplier by the constraint, not by this code.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub expense_account_code: Option<String>,
    /// The tax identity, and the standing arrangement. All three optional on
    /// the wire for the reason `category` is: a supplier is regularly
    /// registered from a delivery note that carries none of them, and they
    /// arrive on the day Finance asks.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub npwp: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_pkp: Option<bool>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub default_payment_terms_code: Option<String>,
    /// `PT`, `CV` or `UD`. See migration 0392.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub legal_form: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub notes: Option<String>,
    /// The people to reach, filed with the party in the same transaction.
    /// Absent (or empty) means the composer sent none yet — the per-contact
    /// POST stays available for adding one later.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub contacts: Vec<super::supplier_contacts::CreateSupplierContactRequest>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub enum NullablePatch<T> {
    /// The caller said nothing about this field, so it keeps whatever it had.
    #[default]
    Missing,
    Null,
    Value(T),
}

impl<'de, T> Deserialize<'de> for NullablePatch<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

impl<T> NullablePatch<T> {
    fn is_present(&self) -> bool {
        !matches!(self, Self::Missing)
    }

    fn into_option(self) -> Option<T> {
        match self {
            Self::Value(value) => Some(value),
            Self::Missing | Self::Null => None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateSupplierRequest {
    #[serde(default)]
    pub supplier_code: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    // Three states, and TypeScript is told all three.
    //
    // Absent means "leave it alone"; `null` means "clear it"; a string means
    // "set it". Collapsing that to `string | undefined` in the browser would
    // make clearing a phone number impossible to express — and a field nobody
    // can clear is a field that stays wrong forever.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub contact_name: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub phone: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub email: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub address: NullablePatch<String>,
    /// Which book this party is in. Not nullable — a party is always in one.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub category: Option<String>,
    /// The account its bills usually debit; `null` clears it, which is what a
    /// party moving back to merchandise has to be able to do.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub expense_account_code: NullablePatch<String>,
    /// The tax number; `null` clears it, for the supplier whose NPWP was
    /// typed off the wrong line of a faktur.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub npwp: NullablePatch<String>,
    /// Whether they are PKP. Not nullable — it is a yes or a no, and the
    /// column's default says which one an unanswered supplier is.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "boolean | null"))]
    pub is_pkp: Option<bool>,
    /// The standing terms; `null` clears them, which is what a supplier who
    /// has gone back to paying on delivery needs.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub default_payment_terms_code: NullablePatch<String>,
    /// `PT`, `CV` or `UD`; `null` clears it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub legal_form: NullablePatch<String>,
    /// The buyer's note on the record; `null` clears it.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub notes: NullablePatch<String>,
    /// The contact sheet, in the same command as the party: people to add and
    /// corrections (including retirements) to people already filed. Absent
    /// means the caller had nothing to say about contacts.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub contacts: Option<super::supplier_contacts::SupplierContactsPatch>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CreateSupplierItemRequest {
    pub supplier_item_code: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    pub unit_price_minor: i64,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub internal_article_code: Option<String>,
    #[serde(default)]
    pub status: SupplierStatus,
    /// Which part of the range this belongs to, in our own vocabulary.
    /// Absent means unclassified, which is a real state — see 0038.
    #[serde(default)]
    pub division_code: Option<String>,
    /// Tag codes from `tag`. Unknown codes are refused rather than dropped: a
    /// tag that silently disappears is a filter that silently misses rows.
    #[serde(default)]
    pub tags: Vec<String>,
    /// What it comes in, from the `colour` and `size_code` masters. Both
    /// optional and both refuse unknown codes, for the reason tags do.
    #[serde(default)]
    pub colour_codes: Vec<String>,
    #[serde(default)]
    pub size_codes: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct UpdateSupplierItemRequest {
    #[serde(default)]
    pub supplier_item_code: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub description: NullablePatch<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub image_url: NullablePatch<String>,
    #[serde(default)]
    pub unit_price_minor: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub internal_article_code: NullablePatch<String>,
    /// Null clears the classification back to unclassified, which is a state
    /// somebody may legitimately want to return an item to.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub division_code: NullablePatch<String>,
    /// Absent leaves tags alone; present REPLACES them. An empty list is
    /// therefore "remove every tag", which is a thing to be able to say — and
    /// is why this is not merged into the existing set.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Same again: absent leaves them alone, present replaces them, and an
    /// empty list is "this does not come in variants after all".
    #[serde(default)]
    pub colour_codes: Option<Vec<String>>,
    #[serde(default)]
    pub size_codes: Option<Vec<String>>,
}

fn default_currency() -> String {
    "IDR".to_owned()
}

fn validation(error: impl ToString) -> AppError {
    AppError::Validation(error.to_string())
}

fn map_catalog_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => {
                AppError::Conflict("Supplier or Supplier Item code is already in use".to_owned())
            }
            Some("23503") => AppError::Validation(
                "referenced Supplier or internal Article does not exist".to_owned(),
            ),
            Some("23514") | Some("23502") => AppError::Validation(database.message().to_owned()),
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

fn supplier_from_row(row: PgRow) -> Result<Supplier, AppError> {
    let status: String = row.try_get("status")?;
    Ok(Supplier {
        supplier_id: row.try_get("supplier_id")?,
        supplier_code: row.try_get("supplier_code")?,
        supplier_code_normalized: row.try_get("supplier_code_normalized")?,
        name: row.try_get("name")?,
        contact_name: row.try_get("contact_name")?,
        phone: row.try_get("phone")?,
        email: row.try_get("email")?,
        address: row.try_get("address")?,
        status: SupplierStatus::from_str(&status).map_err(validation)?,
        category: row.try_get("category")?,
        expense_account_code: row.try_get("expense_account_code")?,
        npwp: row.try_get("npwp")?,
        is_pkp: row.try_get("is_pkp")?,
        default_payment_terms_code: row.try_get("default_payment_terms_code")?,
        legal_form: row.try_get("legal_form")?,
        notes: row.try_get("notes")?,
        version: row.try_get("version")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// The three join tables that say what a supplier item IS and what it comes
/// in, folded into columns a single row read can carry.
///
/// Written once and spliced into every query that returns a `SupplierItem`,
/// because `supplier_item_from_row` reads "column absent" as "this caller did
/// not ask" — which is the right default, and is also exactly how the detail
/// endpoint spent a release returning an item with no tags on it. One fragment
/// means a screen cannot be handed a half-described item by accident.
///
/// `i` is the alias every caller gives `supplier_item`; the sourcing query
/// joins `supplier` beside it and the rest select from it alone.
///
/// The sizes come back in `display_order`, which is size order — so the first
/// and last of the list are the ends of the range, and nothing downstream has
/// to know that XXL sorts after S.
const CLASSIFICATION_COLUMNS: &str = "
    COALESCE(
        (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
           FROM supplier_item_tag t
          WHERE t.supplier_item_id = i.supplier_item_id),
        ARRAY[]::text[]
    ) AS tags,
    COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                    'colour_code', c.code, 'label', c.label, 'hex_code', c.hex_code)
                ORDER BY c.display_order, c.label)
           FROM supplier_item_colour sc
           JOIN colour c ON c.code = sc.colour_code
          WHERE sc.supplier_item_id = i.supplier_item_id),
        '[]'::jsonb
    ) AS colours,
    COALESCE(
        (SELECT array_agg(z.code ORDER BY z.display_order, z.code)
           FROM supplier_item_size ss
           JOIN size_code z ON z.code = ss.size_code
          WHERE ss.supplier_item_id = i.supplier_item_id),
        ARRAY[]::text[]
    ) AS size_codes,
    COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
                    'unit_code', au.unit_code, 'factor', trim_scale(au.factor)::text)
                ORDER BY au.unit_code)
           FROM article a JOIN article_unit au ON au.article_id = a.id
          WHERE a.article_code = i.internal_article_code),
        '[]'::jsonb
    ) AS article_units,
    (SELECT a.stock_unit_code FROM article a
      WHERE a.article_code = i.internal_article_code) AS stock_unit_code,
    (SELECT a.purchase_unit_code FROM article a
      WHERE a.article_code = i.internal_article_code) AS purchase_unit_code";

fn supplier_item_from_row(row: PgRow) -> Result<SupplierItem, AppError> {
    let status: String = row.try_get("status")?;
    Ok(SupplierItem {
        supplier_item_id: row.try_get("supplier_item_id")?,
        supplier_id: row.try_get("supplier_id")?,
        supplier_item_code: row.try_get("supplier_item_code")?,
        supplier_item_code_normalized: row.try_get("supplier_item_code_normalized")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        image_url: row.try_get("image_url")?,
        unit_price_minor: row.try_get("unit_price_minor")?,
        currency: row.try_get::<String, _>("currency")?.trim().to_owned(),
        internal_article_code: row.try_get("internal_article_code")?,
        division_code: row.try_get("division_code")?,
        // Tags come from a join table, so a plain row read cannot carry them.
        // Empty here means "this reader did not fetch them", and every caller
        // that shows tags fetches them — see `CLASSIFICATION_COLUMNS`.
        tags: row
            .try_get::<Option<Vec<String>>, _>("tags")
            .unwrap_or_default()
            .unwrap_or_default(),
        // Same again for what the item comes in. The colours arrive as JSON
        // rather than as an array of codes because a swatch needs the label
        // and the hex too, and three parallel arrays kept in step by ORDER BY
        // is a thing that goes wrong silently.
        colours: row
            .try_get::<Option<serde_json::Value>, _>("colours")
            .ok()
            .flatten()
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default(),
        size_codes: row
            .try_get::<Option<Vec<String>>, _>("size_codes")
            .unwrap_or_default()
            .unwrap_or_default(),
        // Optional reads, like the ones above: a writer that returns the row
        // without the article join still decodes.
        article_units: row
            .try_get::<Option<serde_json::Value>, _>("article_units")
            .ok()
            .flatten()
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default(),
        stock_unit_code: row.try_get("stock_unit_code").ok().flatten(),
        purchase_unit_code: row.try_get("purchase_unit_code").ok().flatten(),
        status: SupplierStatus::from_str(&status).map_err(validation)?,
        version: row.try_get("version")?,
        created_by: row.try_get("created_by")?,
        created_at: row.try_get("created_at")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn replay_or_begin(
    transaction: &mut Transaction<'_, Postgres>,
    idempotency_key: &str,
    command_type: &str,
    digest: &str,
) -> Result<Option<serde_json::Value>, AppError> {
    begin_idempotent(transaction, idempotency_key, command_type, digest).await
}

async fn complete_supplier_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    idempotency_key: &str,
    supplier: &Supplier,
) -> Result<(), AppError> {
    complete_idempotent(
        transaction,
        idempotency_key,
        &serde_json::to_value(supplier)?,
    )
    .await
}

async fn complete_item_mutation(
    transaction: &mut Transaction<'_, Postgres>,
    idempotency_key: &str,
    item: &SupplierItem,
) -> Result<(), AppError> {
    complete_idempotent(transaction, idempotency_key, &serde_json::to_value(item)?).await
}

async fn stale_supplier_error(
    transaction: &mut Transaction<'_, Postgres>,
    supplier_id: Uuid,
    expected_version: i64,
) -> AppError {
    match sqlx::query_scalar::<_, i64>("SELECT version FROM supplier WHERE supplier_id = $1")
        .bind(supplier_id)
        .fetch_optional(&mut **transaction)
        .await
    {
        Ok(Some(actual)) => AppError::Conflict(format!(
            "Supplier version is {actual}, not expected version {expected_version}"
        )),
        Ok(None) => AppError::NotFound("Supplier".to_owned()),
        Err(error) => AppError::Database(error),
    }
}

async fn stale_item_error(
    transaction: &mut Transaction<'_, Postgres>,
    supplier_item_id: Uuid,
    expected_version: i64,
) -> AppError {
    match sqlx::query_scalar::<_, i64>(
        "SELECT version FROM supplier_item WHERE supplier_item_id = $1",
    )
    .bind(supplier_item_id)
    .fetch_optional(&mut **transaction)
    .await
    {
        Ok(Some(actual)) => AppError::Conflict(format!(
            "Supplier Item version is {actual}, not expected version {expected_version}"
        )),
        Ok(None) => AppError::NotFound("Supplier Item".to_owned()),
        Err(error) => AppError::Database(error),
    }
}

// ── the supplier list ────────────────────────────────────────────────────
//
// Brought up to the shape `EmployeeList` and `BillPage` set: a scope struct in,
// an envelope out, a search the SERVER runs and a keyset that can reach the end
// of the book. It was a bare array of every supplier there is — fast today at
// thirty, and with no way out of that when it is not, because a bare array has
// nowhere to put a cursor.
//
// The company buys from thirty suppliers now and has bought from more; a
// purchasing department that has run for a decade holds every one it has ever
// used, because a supplier is deactivated rather than deleted — `status` exists
// precisely so the record survives the relationship.

/// How many suppliers the list returns when the caller does not say.
///
/// Here rather than in the handler, beside the only clamp that enforces it.
const SUPPLIER_DEFAULT_LIMIT: i64 = 200;
/// And the most it will return however loudly a caller asks.
///
/// A thousand, as the workforce list allows and for the same reason: the
/// pickers on the order composer and the item form want every ACTIVE supplier
/// in one read, and clamping them to a page would drop names out of a dropdown
/// with nothing saying so. The envelope is what makes the ceiling safe —
/// `total` says how many there really are, so a caller that hits it can see
/// that it did.
const SUPPLIER_MAX_LIMIT: i64 = 1000;

/// What a caller is asking the supplier list for.
#[derive(Clone, Debug, Default)]
pub struct SupplierScope {
    /// Free text, tried against the supplier's code, its name and the name of
    /// the person there.
    ///
    /// Those three. Not the telephone number and not the email: a supplier
    /// record carries a named individual's contact details, and a list that
    /// could be searched by them would answer "whose number is this" for
    /// anybody who can open the purchasing screen. The code and the name are
    /// what a buyer holding a delivery note actually has.
    pub q: Option<String>,
    /// `ACTIVE` or `INACTIVE`, and one of them.
    ///
    /// An unknown value narrows to nothing rather than being dropped: it is a
    /// column comparison, not a vocabulary this build has to recognise.
    pub status: Option<String>,
    /// `MERCHANDISE`, `EXPENSE` or `AFFILIATE`. Absent means every book, which
    /// is what the record surface and ⌘K want; the two menus each name theirs.
    pub category: Option<String>,
    /// Only suppliers with an order still open — active or partially
    /// received. The Suppliers screen's "Active order" switch (the owner,
    /// 2026-09-28). Narrows the page and its total, not the status counts:
    /// those say how many active and non-active suppliers the book holds.
    pub active_orders: bool,
    /// `code`, `name` or `created` — the closed set this server names.
    ///
    /// Anything unrecognised falls back to the house order rather than
    /// refusing, for the reason every other list here gives: a sort arrives
    /// from a URL somebody may have kept from an older build, and a 400 for a
    /// stale bookmark is a worse answer than the rows in the house order.
    ///
    /// Also `status` (the house order: active first, then by name), and the
    /// order-book tallies — `active`, `completed`, `cancelled` and
    /// `last_purchased` — which are computed per supplier inside the row query
    /// so the keyset can seek on them. The owner asked for every column of the
    /// list to be sortable from its header (2026-09-26).
    pub sort: Option<String>,
    pub desc: bool,
    pub cursor: Option<String>,
    /// Absent means [`SUPPLIER_DEFAULT_LIMIT`], not "everything".
    pub limit: Option<i64>,
}

/// One value a filter can take, and how many suppliers would still be there.
///
/// Counted over everything the search leaves, deliberately ignoring which
/// filter is currently applied — so the number reads as "how many of these
/// there are", which is the question somebody has while choosing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierFacet {
    pub value: String,
    /// Absent for a status, whose words belong to the screen: "Still buying
    /// from" is the hub's phrasing of `ACTIVE`, not the server's.
    pub label: Option<String>,
    pub count: i64,
}

/// The one thing this list can be narrowed by that is worth counting.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierFacets {
    pub statuses: Vec<SupplierFacet>,
}

/// A page of suppliers, and the shape of everything it was drawn from.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierList {
    pub rows: Vec<Supplier>,
    /// Opaque. Pass it back as `cursor` for the next page; absent means this
    /// was the last one.
    pub next_cursor: Option<String>,
    /// Every supplier the search and the filter match — not just this page.
    /// Without it a picker can only say "200 suppliers", which is a statement
    /// about the page size rather than about the company's book.
    pub total: i64,
    pub facets: SupplierFacets,
    /// What we have ordered from each supplier on this page, one entry per
    /// supplier that has ever had an order raised against it. A supplier we
    /// never bought from is absent rather than zero-filled.
    pub orders: Vec<SupplierOrderTally>,
    /// The open side of the order book across every supplier in the book
    /// asked for — not just this page. What the list's KPI tiles print.
    pub book: SupplierBookSummary,
}

/// The supplier rows used by pickers.
///
/// Pickers need the same supplier records as the book, but not its order
/// tallies, facets, or company-wide open-order totals. Keeping this envelope
/// cursor-based lets a picker read the whole book without recomputing those
/// aggregates on every page.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierOptions {
    pub rows: Vec<Supplier>,
    pub next_cursor: Option<String>,
}

/// The purchase orders still open, across the whole book.
///
/// Open means active or partially received: an order somebody is still
/// waiting on. Counted over every supplier the category names, ignoring the
/// search and the status filter, because "how much is on order" is a fact about
/// the company rather than about what is on screen.
#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierBookSummary {
    /// How many purchase orders are open.
    pub open_orders: i64,
    /// How many pieces those orders still expect — ordered less cancelled.
    pub open_units: i64,
    /// What those orders are worth, net of their discounts.
    pub open_value_minor: i64,
}

/// Every purchase order raised against one supplier, counted and summed.
///
/// Cancelled orders are left out of both figures: an order that was called off
/// is not something we bought, and a total that included it would overstate
/// the relationship. The amount is each order's lines net of its discount —
/// the same figure the order book shows as the order's value.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SupplierOrderTally {
    pub supplier_id: Uuid,
    pub order_count: i64,
    pub ordered_minor: i64,
    /// Orders still being waited on: active or partially received.
    pub active_count: i64,
    /// Orders that are finished: fully received, or closed short.
    pub completed_count: i64,
    pub cancelled_count: i64,
    /// When the latest order that was not cancelled was issued.
    pub last_ordered_at: Option<DateTime<Utc>>,
}

/// Where each purchase order stands, and whose it is — one row per order.
///
/// The same reading the order book gives (see `ORDER_BOOK_ROWS` in
/// `sync.rs`), restated here because the supplier list counts by it:
///
///   CANCELLED            the order was called off
///   FULLY_RECEIVED       every piece still expected has been matched
///   SHORT_RECEIVED       every line stopped waiting with pieces missing
///   PARTIALLY_RECEIVED   something has arrived and more is expected
///   ACTIVE               nothing has arrived yet
///
/// `supplier_key` is the supplier's record id. Orders raised before
/// `supplier_ref_id` existed carry only the supplier's code, so those are
/// matched on the code instead.
pub(crate) const PURCHASE_ORDER_STANDING: &str = "
    SELECT o.purchase_order_id, o.issued_at,
           COALESCE(s.supplier_key,
                    (SELECT x.supplier_id FROM supplier x
                      WHERE x.supplier_code = o.supplier_id)) AS supplier_key,
           s.expected_stock_units AS expected_units,
           GREATEST(s.gross_minor - o.discount_minor, 0)::bigint AS net_minor,
           s.lifecycle
      FROM purchase_order o
      JOIN purchase_order_summary s ON s.purchase_order_id = o.purchase_order_id
";

/// Where the previous page stopped — as a ROW, not as a position.
///
/// The supplier id, whatever the list is sorted by. The seek re-reads that
/// row's own sort value in SQL, so one cursor shape serves every order and a
/// fourth sort cannot arrive without its cursor.
#[derive(Serialize, Deserialize)]
struct SupplierCursor {
    supplier_id: Uuid,
}

/// One supplier row, defined once.
///
/// Used by the page query and by the facet counts, and that is the whole reason
/// it is a constant: the facets are only honest if they count exactly what the
/// page can show.
///
/// Binds: `$1` the search pattern, or NULL for no search.
///
/// It stops at the SEARCH. The status filter is applied outside it, which is
/// what lets one definition answer two different questions from the same rows:
/// the page wants what the filter leaves, while the filter panel's counts want
/// what the search alone leaves — because "Active 28" has to mean "there are 28
/// active suppliers", not "28 among the ones you have already narrowed to
/// active".
///
/// The `*_key` columns are computed here rather than only in `ORDER BY` because
/// the keyset has to COMPARE the sort value in a `WHERE`, and a sort expression
/// that is not also a column is one a `WHERE` cannot see. They are non-null for
/// a reason that is easy to miss and expensive to find: a row comparison
/// against NULL is NULL rather than true, so one supplier with a missing value
/// would end paging at whatever row happened to carry it, silently, with the
/// rest of the book below the fold.
///
/// `house_key` is the order this list has always been in — the ones we still
/// buy from first, then alphabetically — spelled as ONE column so a keyset can
/// seek against it. As a text key rather than three `ORDER BY` terms, because
/// a row expression compares columns and cannot be handed a `CASE`. The name is
/// case-folded inside it for the same reason `purchase_destinations` folds
/// case: these are names people typed, and a plain byte comparison files
/// "PT Sinar" before "Pt Abadi".
///
/// The order tallies ride on the row (`t_*`) for the same reason: a list that
/// can be sorted by how many open orders a supplier has has to be able to
/// seek on that number.
fn supplier_rows() -> String {
    format!(
        "WITH tally AS (
             -- Kept up to date by the database beside each order's summary
             -- (migration 0826), so this is a read of one row per supplier and
             -- not a walk over every order there is.
             SELECT supplier_id, order_count, ordered_minor, active_count,
                    completed_count, cancelled_count, last_ordered_at
               FROM supplier_order_tally
         )
         SELECT s.*,
                (CASE WHEN s.status = 'ACTIVE' THEN '0' ELSE '1' END)
                  || ' ' || lower(COALESCE(s.name, '')) AS house_key,
                s.supplier_code AS code_key,
                lower(COALESCE(s.name, '')) AS name_key,
                COALESCE(t.order_count, 0) AS t_order_count,
                COALESCE(t.ordered_minor, 0) AS t_ordered_minor,
                COALESCE(t.active_count, 0) AS active_key,
                COALESCE(t.completed_count, 0) AS completed_key,
                COALESCE(t.cancelled_count, 0) AS cancelled_key,
                t.last_ordered_at AS t_last_ordered_at,
                COALESCE(t.last_ordered_at, TIMESTAMPTZ '-infinity') AS last_key
           FROM supplier s
           LEFT JOIN tally t ON t.supplier_id = s.supplier_id
          WHERE ($1::text IS NULL
                 OR s.supplier_code ILIKE $1
                 OR s.name ILIKE $1
                 OR s.contact_name ILIKE $1)"
    )
}

/// The supplier book, one page at a time, beside how big the whole answer is.
pub async fn list_suppliers(pool: &PgPool, scope: SupplierScope) -> Result<SupplierList, AppError> {
    // A blank search is not a search. `Some("")` would compile to `ILIKE '%%'`,
    // which matches everything and costs a scan to say so.
    let needle = scope
        .q
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{}%", text.replace('%', "\\%")));

    // The sort, and the tie-break that makes it total. Every order ends in the
    // supplier id, which is the primary key, so no two rows can compare equal —
    // which is what stops a keyset from repeating or losing the rows that tie.
    let lead = match scope.sort.as_deref() {
        Some("code") => "code_key",
        Some("name") => "name_key",
        Some("created") => "created_at",
        Some("active") => "active_key",
        Some("completed") => "completed_key",
        Some("cancelled") => "cancelled_key",
        Some("last_purchased") => "last_key",
        _ => "house_key",
    };
    let (cols, order) = super::order_by(lead, "supplier_id", scope.desc);
    // Which way the seek points follows the direction, or paging a descending
    // list walks back up it.
    let seek = if scope.desc { "<" } else { ">" };

    let cursor: Option<SupplierCursor> = scope
        .cursor
        .as_deref()
        .map(super::decode_cursor)
        .transpose()?;
    let limit = scope
        .limit
        .unwrap_or(SUPPLIER_DEFAULT_LIMIT)
        .clamp(1, SUPPLIER_MAX_LIMIT);

    // The seek re-reads the previous row's own sort value rather than trusting
    // one encoded in the cursor — see [`SupplierCursor`].
    // `NOT MATERIALIZED`: `kept` is referenced twice — as the page and
    // inside the seek — and two references makes PostgreSQL materialise a
    // CTE, which is an optimisation fence the `ORDER BY … LIMIT` cannot be
    // pushed through. Materialised, this reads the whole table and sorts it
    // to hand back one page; inlined, it seeks the index. See
    // `postgres::audit::list_audit`, where the difference was measured.
    let supplier_rows = supplier_rows();
    let sql = format!(
        "WITH searched AS NOT MATERIALIZED ({supplier_rows}),
              kept AS NOT MATERIALIZED (
             SELECT * FROM searched
              WHERE ($2::text IS NULL OR status = $2)
                AND ($5::text IS NULL OR category = $5)
                AND (NOT $6::boolean OR active_key > 0)
         )
         SELECT * FROM kept
          WHERE $3::uuid IS NULL
             OR ({cols}) {seek} (SELECT {cols} FROM kept WHERE supplier_id = $3)
          ORDER BY {order}
          LIMIT $4"
    );
    let rows = sqlx::query(&sql)
        .bind(&needle)
        .bind(&scope.status)
        .bind(cursor.as_ref().map(|c| c.supplier_id))
        .bind(limit)
        .bind(&scope.category)
        .bind(scope.active_orders)
        .fetch_all(pool)
        .await?;

    // A short page is the last page. A full one may not be — the next request
    // can come back empty — and that is the honest answer: knowing whether more
    // rows exist without asking costs a second count of the same query.
    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&SupplierCursor {
            supplier_id: row.try_get("supplier_id")?,
        })?),
        _ => None,
    };

    let mut orders = Vec::new();
    for row in &rows {
        let order_count: i64 = row.try_get("t_order_count")?;
        let cancelled_count: i64 = row.try_get("cancelled_key")?;
        // A supplier we never bought from is absent rather than zero-filled,
        // as the list has always said.
        if order_count == 0 && cancelled_count == 0 {
            continue;
        }
        orders.push(SupplierOrderTally {
            supplier_id: row.try_get("supplier_id")?,
            order_count,
            ordered_minor: row.try_get("t_ordered_minor")?,
            active_count: row.try_get("active_key")?,
            completed_count: row.try_get("completed_key")?,
            cancelled_count,
            last_ordered_at: row.try_get("t_last_ordered_at")?,
        });
    }
    let suppliers = rows
        .into_iter()
        .map(supplier_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    let (total, facets) = supplier_facets(pool, &scope, needle.as_deref()).await?;
    let book = supplier_book_summary(pool, scope.category.as_deref()).await?;
    Ok(SupplierList {
        rows: suppliers,
        next_cursor,
        total,
        facets,
        orders,
        book,
    })
}

/// A light, paged read for supplier pickers.
///
/// It returns complete supplier records for callers that also need legal and
/// payment fields, while avoiding the supplier order tally, book facets and
/// open-order totals attached to [`list_suppliers`]. The picker order is the
/// supplier book's house order: active parties first, then name.
pub async fn list_supplier_options(
    pool: &PgPool,
    status: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
) -> Result<SupplierOptions, AppError> {
    let cursor: Option<SupplierCursor> = cursor.as_deref().map(super::decode_cursor).transpose()?;
    let limit = limit
        .unwrap_or(SUPPLIER_DEFAULT_LIMIT)
        .clamp(1, SUPPLIER_MAX_LIMIT);
    let rows = sqlx::query(
        "WITH kept AS NOT MATERIALIZED (
             SELECT s.*,
                    (CASE WHEN s.status = 'ACTIVE' THEN '0' ELSE '1' END)
                      || ' ' || lower(COALESCE(s.name, '')) AS house_key
               FROM supplier s
              WHERE ($1::text IS NULL OR s.status = $1)
         )
         SELECT * FROM kept
          WHERE $2::uuid IS NULL
             OR (house_key, supplier_id) > (
                    SELECT house_key, supplier_id
                      FROM kept WHERE supplier_id = $2
                )
          ORDER BY house_key, supplier_id
          LIMIT $3",
    )
    .bind(status)
    .bind(cursor.as_ref().map(|c| c.supplier_id))
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let next_cursor = match rows.last() {
        Some(row) if rows.len() as i64 == limit => Some(super::encode_cursor(&SupplierCursor {
            supplier_id: row.try_get("supplier_id")?,
        })?),
        _ => None,
    };
    let rows = rows
        .into_iter()
        .map(supplier_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SupplierOptions { rows, next_cursor })
}

/// The open side of the order book, over every supplier in the category.
async fn supplier_book_summary(
    pool: &PgPool,
    category: Option<&str>,
) -> Result<SupplierBookSummary, AppError> {
    let row = sqlx::query(&format!(
        "WITH standing AS ({PURCHASE_ORDER_STANDING})
         SELECT count(*)::bigint AS open_orders,
                COALESCE(sum(p.expected_units), 0)::bigint AS open_units,
                COALESCE(sum(p.net_minor), 0)::bigint AS open_value_minor
           FROM standing p
           JOIN supplier s ON s.supplier_id = p.supplier_key
          WHERE p.lifecycle IN ('ACTIVE', 'PARTIALLY_RECEIVED')
            AND ($1::text IS NULL OR s.category = $1)"
    ))
    .bind(category)
    .fetch_one(pool)
    .await?;
    Ok(SupplierBookSummary {
        open_orders: row.try_get("open_orders")?,
        open_units: row.try_get("open_units")?,
        open_value_minor: row.try_get("open_value_minor")?,
    })
}

/// How many suppliers there are, and how they split.
///
/// Counted from the SAME [`supplier_rows`] the page is drawn from, so a change
/// to what a listable supplier is moves both together. The two scopes are
/// deliberate:
///
///   per-value counts read the SEARCHED set, ignoring what is filtered, so the
///     number beside `ACTIVE` answers "how many active suppliers are there",
///     which is the question somebody has while deciding whether to click it.
///   the total reads the FILTERED set, because it describes the list on screen.
async fn supplier_facets(
    pool: &PgPool,
    scope: &SupplierScope,
    needle: Option<&str>,
) -> Result<(i64, SupplierFacets), AppError> {
    // The category bounds both scopes: it names which book this is, not a
    // filter somebody ticked, so the counts beside Active are counts of that
    // book.
    let supplier_rows = supplier_rows();
    let sql = format!(
        "WITH searched AS ({supplier_rows}), booked AS (
             SELECT * FROM searched WHERE ($3::text IS NULL OR category = $3)
         ), kept AS (
             SELECT * FROM booked
              WHERE ($2::text IS NULL OR status = $2)
                AND (NOT $4::boolean OR active_key > 0)
         )
         SELECT 'status' AS kind, status AS value, count(*)::bigint AS n
           FROM booked GROUP BY status
          UNION ALL
         SELECT 'all', '', count(*)::bigint FROM kept"
    );
    let rows = sqlx::query(&sql)
        .bind(needle)
        .bind(&scope.status)
        .bind(&scope.category)
        .bind(scope.active_orders)
        .fetch_all(pool)
        .await?;

    let mut total = 0i64;
    let mut statuses = Vec::new();
    for row in &rows {
        let kind: String = row.try_get("kind")?;
        let value: String = row.try_get("value")?;
        let n: i64 = row.try_get("n")?;
        if kind == "status" {
            statuses.push(SupplierFacet {
                value,
                label: None,
                count: n,
            });
        } else {
            total = n;
        }
    }
    // Biggest first, ties broken on the value, as every other facet panel in
    // this estate is ordered — a list that reshuffles between calls is a list
    // nobody can click.
    statuses.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
    Ok((total, SupplierFacets { statuses }))
}

pub async fn get_supplier(pool: &PgPool, supplier_id: Uuid) -> Result<Supplier, AppError> {
    let row = sqlx::query("SELECT * FROM supplier WHERE supplier_id = $1")
        .bind(supplier_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Supplier".to_owned()))?;
    supplier_from_row(row)
}

pub async fn create_supplier(
    pool: &PgPool,
    request: CreateSupplierRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<Supplier, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let typed_code = optional_supplier_text(request.supplier_code);
    let name = required_supplier_text("name", request.name).map_err(validation)?;
    let legal_form = normalize_legal_form(request.legal_form).map_err(validation)?;
    let notes = optional_supplier_text(request.notes);
    let contact_name = optional_supplier_text(request.contact_name);
    let phone = normalize_supplier_phones(request.phone).map_err(validation)?;
    let email = optional_supplier_text(request.email);
    let address = optional_supplier_text(request.address);
    let category = optional_supplier_text(request.category);
    let expense_account_code = optional_supplier_text(request.expense_account_code);
    let npwp = optional_supplier_text(request.npwp);
    let default_payment_terms_code = optional_supplier_text(request.default_payment_terms_code);
    // An unanswered supplier is not PKP. The column says the same thing; this
    // says it before the row exists, so the value sent back to the browser is
    // the value that was stored.
    let is_pkp = request.is_pkp.unwrap_or(false);
    // Refuse a bad contact sheet before opening the transaction, so it costs
    // neither a supplier number nor an advisory-lock wait. The batch INSERT
    // validates again inside; this is the cheap pass that protects the
    // numbering.
    for contact in &request.contacts {
        super::supplier_contacts::normalized_new_contact(contact)?;
    }

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, "supplier.create", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    // After the replay check, so a retried Create is answered with the number
    // it was given the first time instead of taking the next one.
    let supplier_code = match typed_code {
        Some(code) => code,
        None => next_supplier_number(&mut transaction).await?,
    };
    let supplier_code_normalized =
        normalize_supplier_code("supplier_code", &supplier_code).map_err(validation)?;

    let row = sqlx::query(
        "INSERT INTO supplier
             (supplier_id, supplier_code, supplier_code_normalized, name,
              contact_name, phone, email, address, status,
              created_by, updated_by, category, expense_account_code,
              npwp, is_pkp, default_payment_terms_code, legal_form, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,
                 COALESCE($11,'MERCHANDISE'),$12,$13,$14,$15,$16,$17)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(supplier_code)
    .bind(supplier_code_normalized)
    .bind(name)
    .bind(contact_name)
    .bind(phone)
    .bind(email)
    .bind(address)
    .bind(request.status.as_str())
    .bind(&actor)
    .bind(category)
    .bind(expense_account_code)
    .bind(npwp)
    .bind(is_pkp)
    .bind(default_payment_terms_code)
    .bind(legal_form)
    .bind(notes)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let supplier = supplier_from_row(row)?;
    // The people to reach, in the same transaction as the party: a supplier
    // saved with its contacts is one command, not one POST plus one per
    // person. Validation ran before the number was taken, so a bad sheet
    // consumes nothing.
    super::supplier_contacts::insert_supplier_contacts_tx(
        &mut transaction,
        supplier.supplier_id,
        &request.contacts,
        &actor,
        true,
    )
    .await?;
    complete_supplier_mutation(&mut transaction, idempotency_key, &supplier).await?;
    transaction.commit().await?;
    Ok(supplier)
}

/// The next free supplier number: four digits, `0001` upward.
///
/// Serialised on a transaction-scoped advisory lock rather than a sequence,
/// so two buyers registering at the same moment get consecutive numbers and a
/// Create that rolls back gives its number back — the book has no holes a
/// supplier would ask about. It starts past the highest four-digit code
/// already filed, so a number somebody typed by hand is never collided with.
/// The older lettered codes (`SINA01`) are not numbers and are skipped.
async fn next_supplier_number(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<String, AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('supplier.number'))")
        .execute(&mut **transaction)
        .await?;
    let next: i32 = sqlx::query_scalar(
        "SELECT COALESCE(max(supplier_code::integer), 0) + 1
           FROM supplier
          WHERE supplier_code ~ '^[0-9]{4}$'",
    )
    .fetch_one(&mut **transaction)
    .await?;
    if next > 9999 {
        return Err(AppError::Conflict(
            "every four-digit supplier number is taken; type a code for this supplier".into(),
        ));
    }
    Ok(format!("{next:04}"))
}

pub async fn update_supplier(
    pool: &PgPool,
    supplier_id: Uuid,
    expected_version: i64,
    request: UpdateSupplierRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<Supplier, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let changes_code = request.supplier_code.is_some();
    let changes_name = request.name.is_some();
    let changes_contact = request.contact_name.is_present();
    let changes_phone = request.phone.is_present();
    let changes_email = request.email.is_present();
    let changes_address = request.address.is_present();
    let changes_category = request.category.is_some();
    let changes_account = request.expense_account_code.is_present();
    let changes_npwp = request.npwp.is_present();
    let changes_pkp = request.is_pkp.is_some();
    let changes_terms = request.default_payment_terms_code.is_present();
    let changes_legal_form = request.legal_form.is_present();
    let changes_notes = request.notes.is_present();
    let changes_contacts = request.contacts.is_some();
    if !(changes_code
        || changes_name
        || changes_contact
        || changes_phone
        || changes_email
        || changes_address
        || changes_category
        || changes_account
        || changes_npwp
        || changes_pkp
        || changes_terms
        || changes_legal_form
        || changes_notes
        || changes_contacts)
    {
        return Err(AppError::Validation(
            "Supplier update must contain at least one field".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_code = request
        .supplier_code
        .map(|value| required_supplier_text("supplier_code", value))
        .transpose()
        .map_err(validation)?;
    let supplier_code_normalized = supplier_code
        .as_deref()
        .map(|value| normalize_supplier_code("supplier_code", value))
        .transpose()
        .map_err(validation)?;
    let name = request
        .name
        .map(|value| required_supplier_text("name", value))
        .transpose()
        .map_err(validation)?;
    let contact_name = optional_supplier_text(request.contact_name.into_option());
    let phone = normalize_supplier_phones(request.phone.into_option()).map_err(validation)?;
    let email = optional_supplier_text(request.email.into_option());
    let address = optional_supplier_text(request.address.into_option());
    let category = optional_supplier_text(request.category);
    let expense_account_code = optional_supplier_text(request.expense_account_code.into_option());
    let npwp = optional_supplier_text(request.npwp.into_option());
    let default_payment_terms_code =
        optional_supplier_text(request.default_payment_terms_code.into_option());
    let legal_form = normalize_legal_form(request.legal_form.into_option()).map_err(validation)?;
    let notes = optional_supplier_text(request.notes.into_option());
    // `false` rather than `None` when the flag is absent: the CASE below only
    // reads it when `changes_pkp` is true, and a NOT NULL column cannot take a
    // null even on the branch that is never chosen.
    let is_pkp = request.is_pkp.unwrap_or(false);

    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, "supplier.update", digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier SET
             supplier_code = CASE WHEN $3 THEN $4 ELSE supplier_code END,
             supplier_code_normalized = CASE WHEN $3 THEN $5 ELSE supplier_code_normalized END,
             name = CASE WHEN $6 THEN $7 ELSE name END,
             contact_name = CASE WHEN $8 THEN $9 ELSE contact_name END,
             phone = CASE WHEN $10 THEN $11 ELSE phone END,
             email = CASE WHEN $12 THEN $13 ELSE email END,
             address = CASE WHEN $14 THEN $15 ELSE address END,
             category = CASE WHEN $17 THEN $18 ELSE category END,
             expense_account_code = CASE WHEN $19 THEN $20 ELSE expense_account_code END,
             npwp = CASE WHEN $21 THEN $22 ELSE npwp END,
             is_pkp = CASE WHEN $23 THEN $24 ELSE is_pkp END,
             default_payment_terms_code =
                 CASE WHEN $25 THEN $26 ELSE default_payment_terms_code END,
             legal_form = CASE WHEN $27 THEN $28 ELSE legal_form END,
             notes = CASE WHEN $29 THEN $30 ELSE notes END,
             version = version + 1, updated_by = $16, updated_at = now()
         WHERE supplier_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_id)
    .bind(expected_version)
    .bind(changes_code)
    .bind(supplier_code)
    .bind(supplier_code_normalized)
    .bind(changes_name)
    .bind(name)
    .bind(changes_contact)
    .bind(contact_name)
    .bind(changes_phone)
    .bind(phone)
    .bind(changes_email)
    .bind(email)
    .bind(changes_address)
    .bind(address)
    .bind(&actor)
    .bind(changes_category)
    .bind(category)
    .bind(changes_account)
    .bind(expense_account_code)
    .bind(changes_npwp)
    .bind(npwp)
    .bind(changes_pkp)
    .bind(is_pkp)
    .bind(changes_terms)
    .bind(default_payment_terms_code)
    .bind(changes_legal_form)
    .bind(legal_form)
    .bind(changes_notes)
    .bind(notes)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let Some(row) = row else {
        return Err(stale_supplier_error(&mut transaction, supplier_id, expected_version).await);
    };
    let supplier = supplier_from_row(row)?;
    // The contact sheet rides the party's own transaction: people added,
    // people corrected — including retirements — all answerable in one
    // command. The creates validate first, so one bad person refuses the
    // whole PATCH before any of it lands.
    if let Some(patch) = &request.contacts {
        super::supplier_contacts::insert_supplier_contacts_tx(
            &mut transaction,
            supplier_id,
            &patch.create,
            &actor,
            false,
        )
        .await?;
        for change in &patch.update {
            super::supplier_contacts::update_supplier_contact_tx(
                &mut transaction,
                change.contact_id,
                change.expected_version,
                change.change.clone(),
                &actor,
            )
            .await?;
        }
    }
    complete_supplier_mutation(&mut transaction, idempotency_key, &supplier).await?;
    transaction.commit().await?;
    Ok(supplier)
}

pub async fn set_supplier_status(
    pool: &PgPool,
    supplier_id: Uuid,
    expected_version: i64,
    status: SupplierStatus,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<Supplier, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let command_type = match status {
        SupplierStatus::Active => "supplier.activate",
        SupplierStatus::Inactive => "supplier.deactivate",
    };
    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, command_type, digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier SET status = $3, version = version + 1,
             updated_by = $4, updated_at = now()
         WHERE supplier_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_id)
    .bind(expected_version)
    .bind(status.as_str())
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(row) = row else {
        return Err(stale_supplier_error(&mut transaction, supplier_id, expected_version).await);
    };
    let supplier = supplier_from_row(row)?;
    complete_supplier_mutation(&mut transaction, idempotency_key, &supplier).await?;
    transaction.commit().await?;
    Ok(supplier)
}

/// What this business has already committed to buying of one item.
///
/// Counted from the order lines, which keep `supplier_item_id`, so this needs
/// no article and no receipt: "have we bought this before, and how much" is
/// answerable about a supplier's own item even when it has never been given an
/// identity of ours.
///
/// Deliberately ORDERED rather than received. Received is derived from the
/// DC's goods receipts on every read and is a different question — "did it
/// turn up" — which belongs on the order, not in a catalogue a buyer is
/// browsing.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseHistory {
    /// How many separate orders named this item.
    pub orders: i64,
    /// Ordered minus cancelled, across all of them.
    pub units: i64,
    /// When it was last put on an order that was actually raised. `None` when
    /// every order naming it is still a draft.
    pub last_ordered_at: Option<DateTime<Utc>>,
}

/// One supplier's item, with the supplier attached.
///
/// Sourcing asks a question no single supplier can answer — "who sells this,
/// and for how much" — so the answer has to carry who.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SourcedItem {
    pub item: SupplierItem,
    pub supplier: Supplier,
    /// Absent when nobody asked. The basket reads this same row shape and has
    /// no use for the history, so `None` means "not looked up" and never
    /// "never bought" — a zero and an unknown are different answers and a
    /// buyer must not read one as the other.
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bought: Option<PurchaseHistory>,
}

/// How many items carry one value of a facet, across the whole catalogue.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct FacetCount {
    pub value: String,
    pub count: i64,
}

/// What the catalogue contains, beside the page of it being shown.
///
/// Counted over everything the text search matches, NOT over the current
/// selection. Choosing a division should not make the other divisions vanish
/// or read zero: a facet list is how a buyer sees what else is there, and one
/// that only describes what they have already chosen cannot answer "what if I
/// looked at menswear instead".
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SourcingFacets {
    pub divisions: Vec<FacetCount>,
    pub tags: Vec<FacetCount>,
    pub suppliers: Vec<FacetCount>,
    /// Counted by ITEM, not by variant: an item offered in five colours adds
    /// one to each of five rows, so the numbers answer "how many things could
    /// I buy in navy" rather than "how many navy rows exist". Summing them
    /// therefore exceeds the total, which is correct and is the same thing the
    /// tag counts already do.
    pub colours: Vec<FacetCount>,
    pub sizes: Vec<FacetCount>,
}

/// One page of the catalogue, and enough about the rest to describe it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SourcingPage {
    pub items: Vec<SourcedItem>,
    /// Opaque. Pass it back to get the next page; absent means this was the
    /// last one. Deliberately not an offset: rows are added and deactivated
    /// while a buyer scrolls, and an offset would skip or repeat items when
    /// they are.
    pub next_cursor: Option<String>,
    /// Every item the search matches, not just this page. Without it a screen
    /// can only say "500 items", which is a statement about the page size.
    pub total: i64,
    pub facets: SourcingFacets,
}

/// How the catalogue is ordered.
///
/// The sort and the cursor are one decision, not two: keyset pagination walks
/// the sort's own key, so a page taken under one order cannot be continued
/// under another. Changing the sort starts again from the top — which is also
/// what a person expects when they press it.
///
/// There is deliberately no "popular" and no "best selling". Popular would be
/// a ranking with no signal behind it — this system records no views, no
/// per-item order counts a shopper generated, and no ratings — and best
/// selling needs a sold figure, which needs every supplier item to carry our
/// own article code. None do yet.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourcingSort {
    /// What the search matched best, then by supplier and name. Retired items
    /// sink. The only order that means anything when nobody has typed
    /// anything, which is why it is the default.
    #[default]
    Relevance,
    /// Newest into the catalogue first, by when the row was created.
    Newest,
    PriceLow,
    PriceHigh,
}

impl SourcingSort {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw {
            Some("newest") => Self::Newest,
            Some("price_low") => Self::PriceLow,
            Some("price_high") => Self::PriceHigh,
            _ => Self::Relevance,
        }
    }

    /// The keyset predicate and the ordering, which must always agree: a
    /// `WHERE` that walks one order under an `ORDER BY` of another silently
    /// skips rows and repeats others, and the reader only notices when a buyer
    /// says an item they saw yesterday has gone.
    ///
    /// Every branch uses the SAME parameter slots — `$6`–`$9` — and no branch
    /// introduces one of its own. That is not tidiness: Postgres takes a
    /// statement's parameter count from the highest `$n` it actually mentions,
    /// so a sort whose fragment stopped at `$12` while the caller bound
    /// fourteen values would be refused outright with a bind-count error. One
    /// fixed set of slots means one bind list for all four orders.
    ///
    /// `$7` therefore carries whichever leading key this sort walks, always as
    /// text, cast here. A timestamp and a price both survive that round trip;
    /// a bind list that changed shape per sort would not survive review.
    fn sql(self) -> (&'static str, &'static str) {
        match self {
            Self::Relevance => (
                "($6::int IS NULL OR
                  (CASE i.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, s.name, i.name, i.supplier_item_id)
                  > ($6::int, $7::text, $8::text, $9::uuid))",
                "rank, s.name, i.name, i.supplier_item_id",
            ),
            // `$6` is the rank, and it is non-null exactly when there is a
            // cursor, so it doubles as the "is this a first page" guard in
            // every order. `$8` is the item name, which every order uses to
            // break ties — better than falling straight to the uuid, because
            // two items at the same price then read alphabetically instead of
            // arbitrarily.
            //
            // A row-value comparison must run one way, so a descending order
            // compares with `<` and orders every component `DESC`.
            Self::Newest => (
                "($6::int IS NULL OR
                  (i.created_at, i.name, i.supplier_item_id)
                  < ($7::timestamptz, $8::text, $9::uuid))",
                "i.created_at DESC, i.name DESC, i.supplier_item_id DESC",
            ),
            Self::PriceLow => (
                "($6::int IS NULL OR
                  (i.unit_price_minor, i.name, i.supplier_item_id)
                  > ($7::bigint, $8::text, $9::uuid))",
                "i.unit_price_minor, i.name, i.supplier_item_id",
            ),
            Self::PriceHigh => (
                "($6::int IS NULL OR
                  (i.unit_price_minor, i.name, i.supplier_item_id)
                  < ($7::bigint, $8::text, $9::uuid))",
                "i.unit_price_minor DESC, i.name DESC, i.supplier_item_id DESC",
            ),
        }
    }

    /// What goes in `$7` for this sort: the leading key of the row the last
    /// page stopped on, as text.
    fn leading_key(self, cursor: &SourcingCursor) -> Option<String> {
        match self {
            Self::Relevance => Some(cursor.supplier_name.clone()),
            Self::Newest => cursor.created_at.map(|at| at.to_rfc3339()),
            Self::PriceLow | Self::PriceHigh => {
                cursor.unit_price_minor.map(|minor| minor.to_string())
            }
        }
    }
}

/// Where the previous page stopped, in the sort's own terms.
///
/// Every component of the sort is here, ending in the id — the sort is not
/// unique without it, and a keyset that stops at a non-unique key loses or
/// repeats the rows that tie.
///
/// Every key any sort might need is carried, and each sort reads its own. The
/// sort itself travels with it so a cursor issued under one order cannot be
/// silently continued under another — it is checked on the way in.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct SourcingCursor {
    #[serde(default)]
    sort: SourcingSort,
    rank: i32,
    supplier_name: String,
    item_name: String,
    id: Uuid,
    #[serde(default)]
    created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    unit_price_minor: Option<i64>,
}

impl SourcingCursor {
    /// Hex rather than base64 only because `hex` is already a dependency and
    /// base64 is not; the point is that it is opaque, not that it is short.
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

/// What a caller is asking the catalogue for.
#[derive(Clone, Debug, Default)]
pub struct SourcingScope {
    pub sort: SourcingSort,
    pub needle: Option<String>,
    pub status: Option<SupplierStatus>,
    pub supplier_ids: Vec<Uuid>,
    pub division_codes: Vec<String>,
    pub tag_codes: Vec<String>,
    /// The same three, negated. ANDed with their positive twins rather than
    /// replacing them, so "menswear or kidswear, but not the socks" is one
    /// question and not two requests stitched together in a browser.
    pub excluded_supplier_ids: Vec<Uuid>,
    pub excluded_division_codes: Vec<String>,
    pub excluded_tag_codes: Vec<String>,
    /// What it comes in. `ANY` semantics, like tags: asking for Navy and Black
    /// means "offered in navy or black", not "offered in both". A buyer
    /// narrowing a catalogue is naming what would do, not writing a spec.
    pub colour_codes: Vec<String>,
    pub excluded_colour_codes: Vec<String>,
    pub size_codes: Vec<String>,
    pub excluded_size_codes: Vec<String>,
    /// `Some(true)` asks for the rows with nothing in the column, `Some(false)`
    /// for the rows with something, `None` for both.
    ///
    /// "Unclassified" is a real answer, not a gap to be tidied away: an item
    /// nobody has filed is exactly what somebody cleaning the catalogue is
    /// looking for, and until this existed the facet that counted them could
    /// not be clicked.
    pub division_null: Option<bool>,
    pub tags_null: Option<bool>,
    /// `Some(true)` is "no variants recorded", which is most of a scraped feed
    /// and is exactly the pile somebody filling the gaps in wants to see.
    pub colours_null: Option<bool>,
    pub sizes_null: Option<bool>,
    pub cursor: Option<String>,
    /// Inclusive bounds on the catalogue price, in minor units. Server-side
    /// for the same reason the facets are: a slider that only narrows the page
    /// already fetched tells a buyer there is nothing cheaper when there is.
    pub price_min: Option<i64>,
    pub price_max: Option<i64>,
    pub limit: i64,
}

/// Everything on offer, across every supplier, a page at a time.
///
/// Added because the screen that needs it could only be built by asking for
/// each supplier's items in turn and stitching the answers together in the
/// browser — one request per supplier, and a browser deciding what "matches"
/// means. Both of those get worse the more suppliers there are, and the second
/// one puts a search rule somewhere nobody can see it.
///
/// `needle` matches an item's name or code, or the supplier's name — the three
/// things somebody actually knows when they are looking for something to buy.
///
/// Division and tags are filtered HERE, not in the browser. They used to be
/// faceted client-side over whatever rows had been fetched, which was honest
/// while a catalogue was five items and became a lie at 2806: the counts
/// described the page rather than the catalogue, and filtering by a division
/// searched only the part of it that happened to have loaded.
pub async fn search_supplier_items(
    pool: &PgPool,
    scope: SourcingScope,
) -> Result<SourcingPage, AppError> {
    let needle = scope
        .needle
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let status = scope.status.map(|value| value.as_str().to_string());
    // An empty selection is NULL rather than an empty array: every clause is
    // written `$n IS NULL OR …`, so a filter nobody set costs one null check
    // instead of a scan against `= ANY('{}')`, which matches nothing.
    let suppliers = (!scope.supplier_ids.is_empty()).then_some(scope.supplier_ids);
    let divisions = (!scope.division_codes.is_empty()).then_some(scope.division_codes);
    let tags = (!scope.tag_codes.is_empty()).then_some(scope.tag_codes);
    let not_suppliers =
        (!scope.excluded_supplier_ids.is_empty()).then_some(scope.excluded_supplier_ids);
    let not_divisions =
        (!scope.excluded_division_codes.is_empty()).then_some(scope.excluded_division_codes);
    let not_tags = (!scope.excluded_tag_codes.is_empty()).then_some(scope.excluded_tag_codes);
    let colours = (!scope.colour_codes.is_empty()).then_some(scope.colour_codes);
    let not_colours =
        (!scope.excluded_colour_codes.is_empty()).then_some(scope.excluded_colour_codes);
    let sizes = (!scope.size_codes.is_empty()).then_some(scope.size_codes);
    let not_sizes = (!scope.excluded_size_codes.is_empty()).then_some(scope.excluded_size_codes);
    let cursor = scope
        .cursor
        .as_deref()
        .map(SourcingCursor::decode)
        .transpose()?
        // A cursor is a position in ONE order. Continuing it under another
        // would skip rows and repeat others, and nothing downstream could
        // tell. Dropping it restarts the list, which is what changing the
        // sort means anyway.
        .filter(|c| c.sort == scope.sort);
    let (keyset, ordering) = scope.sort.sql();
    // A page, not the catalogue. The browser asks for the next one when the
    // buyer reaches the bottom, which is the only way a 2806-item range can be
    // shown without handing a laptop 2806 photographs at once.
    let limit = scope.limit.clamp(1, 200);

    let rows = sqlx::query(&format!(
        "SELECT i.*,
                {CLASSIFICATION_COLUMNS},
                CASE i.status WHEN 'ACTIVE' THEN 0 ELSE 1 END AS rank,
                s.supplier_id AS s_supplier_id, s.supplier_code AS s_supplier_code,
                s.supplier_code_normalized AS s_supplier_code_normalized, s.name AS s_name,
                s.category AS s_category,
                s.expense_account_code AS s_expense_account_code,
                s.npwp AS s_npwp,
                s.is_pkp AS s_is_pkp,
                s.default_payment_terms_code AS s_default_payment_terms_code,
                s.contact_name AS s_contact_name, s.phone AS s_phone, s.email AS s_email,
                s.address AS s_address, s.status AS s_status, s.version AS s_version,
                s.created_by AS s_created_by, s.created_at AS s_created_at,
                s.updated_by AS s_updated_by, s.updated_at AS s_updated_at,
                bought.orders AS bought_orders, bought.units AS bought_units,
                bought.last_ordered_at AS bought_last_ordered_at
           FROM supplier_item i
           JOIN supplier s ON s.supplier_id = i.supplier_id
           -- What we have already ordered of this item. A LATERAL rather than
           -- three correlated subqueries so the planner reads the line index
           -- once per row instead of three times.
           LEFT JOIN LATERAL (
               SELECT count(DISTINCT l.purchase_order_id) AS orders,
                      -- `::bigint` because SUM over a bigint returns NUMERIC in
                      -- Postgres, and a numeric will not decode as an i64 — the
                      -- history silently came back absent rather than wrong.
                      COALESCE(SUM(l.ordered_quantity - l.cancelled_quantity), 0)::bigint AS units,
                      max(o.issued_at) AS last_ordered_at
                 FROM purchase_order_line l
                 JOIN purchase_order o ON o.purchase_order_id = l.purchase_order_id
                WHERE l.supplier_item_id = i.supplier_item_id
           ) bought ON true
          WHERE ($1::text IS NULL OR i.status = $1)
            AND ($2::uuid[] IS NULL OR i.supplier_id = ANY($2))
            AND ($3::text IS NULL
                 OR i.name ILIKE '%' || $3 || '%'
                 OR i.supplier_item_code ILIKE '%' || $3 || '%'
                 OR s.name ILIKE '%' || $3 || '%'
                 -- The code as well as the name: it is what appears on the
                 -- order and on the carton, so it is what somebody has in
                 -- front of them when they come here looking.
                 OR s.supplier_code ILIKE '%' || $3 || '%')
            AND ($4::text[] IS NULL OR i.division_code = ANY($4))
            AND ($5::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM supplier_item_tag t
                     WHERE t.supplier_item_id = i.supplier_item_id
                       AND t.tag_code = ANY($5)))
            AND ($11::bigint IS NULL OR i.unit_price_minor >= $11)
            AND ($12::bigint IS NULL OR i.unit_price_minor <= $12)
            AND ($13::uuid[] IS NULL OR i.supplier_id <> ALL($13))
            -- The null arm is not tidiness, it is the answer. An item nobody
            -- has filed IS, truthfully, not kidswear, and dropping it would
            -- silently hide exactly the unfinished rows somebody asking for
            -- anything-but-kidswear is usually hunting for. SQL's own
            -- three-valued logic would answer differently; SQL is answering a
            -- different question than a person reading a catalogue.
            AND ($14::text[] IS NULL
                 OR i.division_code IS NULL
                 OR i.division_code <> ALL($14))
            AND ($15::text[] IS NULL OR NOT EXISTS (
                    SELECT 1 FROM supplier_item_tag t
                     WHERE t.supplier_item_id = i.supplier_item_id
                       AND t.tag_code = ANY($15)))
            -- `= $n` rather than two parameters, so is-empty and is-not-empty
            -- are one question asked twice rather than two separate features.
            AND ($16::boolean IS NULL OR (i.division_code IS NULL) = $16)
            AND ($17::boolean IS NULL OR (NOT EXISTS (
                    SELECT 1 FROM supplier_item_tag t
                     WHERE t.supplier_item_id = i.supplier_item_id)) = $17)
            -- Colour and size, in the same six shapes tags already has: is one
            -- of, is none of, is empty, is not empty. Written out rather than
            -- generated, because the alternative is a query builder and this
            -- file's whole argument is that the SQL should be readable next to
            -- the sentence it answers.
            AND ($18::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM supplier_item_colour c
                     WHERE c.supplier_item_id = i.supplier_item_id
                       AND c.colour_code = ANY($18)))
            AND ($19::text[] IS NULL OR NOT EXISTS (
                    SELECT 1 FROM supplier_item_colour c
                     WHERE c.supplier_item_id = i.supplier_item_id
                       AND c.colour_code = ANY($19)))
            AND ($20::boolean IS NULL OR (NOT EXISTS (
                    SELECT 1 FROM supplier_item_colour c
                     WHERE c.supplier_item_id = i.supplier_item_id)) = $20)
            AND ($21::text[] IS NULL OR EXISTS (
                    SELECT 1 FROM supplier_item_size z
                     WHERE z.supplier_item_id = i.supplier_item_id
                       AND z.size_code = ANY($21)))
            AND ($22::text[] IS NULL OR NOT EXISTS (
                    SELECT 1 FROM supplier_item_size z
                     WHERE z.supplier_item_id = i.supplier_item_id
                       AND z.size_code = ANY($22)))
            AND ($23::boolean IS NULL OR (NOT EXISTS (
                    SELECT 1 FROM supplier_item_size z
                     WHERE z.supplier_item_id = i.supplier_item_id)) = $23)
            -- Keyset: strictly after the last row of the previous page, in the
            -- sort's own order. Row-value comparison rather than an unrolled
            -- chain of ORs, so the planner can use the ordering directly.
            -- Both fragments come from `SourcingSort::sql`, which is a closed
            -- match over literals this file wrote — there is no caller input in
            -- the string, only in the binds.
            AND {keyset}
          ORDER BY {ordering}
          LIMIT $10"
    ))
    .bind(&status)
    .bind(&suppliers)
    .bind(&needle)
    .bind(&divisions)
    .bind(&tags)
    .bind(cursor.as_ref().map(|c| c.rank))
    .bind(cursor.as_ref().and_then(|c| scope.sort.leading_key(c)))
    .bind(cursor.as_ref().map(|c| c.item_name.clone()))
    .bind(cursor.as_ref().map(|c| c.id))
    .bind(limit)
    .bind(scope.price_min)
    .bind(scope.price_max)
    .bind(&not_suppliers)
    .bind(&not_divisions)
    .bind(&not_tags)
    .bind(scope.division_null)
    .bind(scope.tags_null)
    .bind(&colours)
    .bind(&not_colours)
    .bind(scope.colours_null)
    .bind(&sizes)
    .bind(&not_sizes)
    .bind(scope.sizes_null)
    .fetch_all(pool)
    .await?;

    // The cursor is built from the last row BEFORE the rows are converted,
    // because the sort keys include the supplier's name, which the converted
    // shape nests one level down.
    let next_cursor = if (rows.len() as i64) < limit {
        None
    } else {
        match rows.last() {
            Some(row) => Some(
                SourcingCursor {
                    sort: scope.sort,
                    rank: row.try_get("rank")?,
                    supplier_name: row.try_get("s_name")?,
                    item_name: row.try_get("name")?,
                    id: row.try_get("supplier_item_id")?,
                    created_at: row.try_get("created_at")?,
                    unit_price_minor: row.try_get("unit_price_minor")?,
                }
                .encode()?,
            ),
            None => None,
        }
    };

    let items = rows
        .into_iter()
        .map(sourced_item_from_row)
        .collect::<Result<Vec<_>, _>>()?;

    let (total, facets) = sourcing_facets(pool, needle.as_deref(), status.as_deref()).await?;
    Ok(SourcingPage {
        items,
        next_cursor,
        total,
        facets,
    })
}

/// What the whole search contains, by division, tag, supplier, colour and
/// size.
///
/// One round trip: a screen cannot draw its facet list before it has all three,
/// so splitting them would only buy two more waits.
async fn sourcing_facets(
    pool: &PgPool,
    needle: Option<&str>,
    status: Option<&str>,
) -> Result<(i64, SourcingFacets), AppError> {
    let row = sqlx::query(
        "WITH base AS (
             SELECT i.supplier_item_id, i.division_code, i.supplier_id
               FROM supplier_item i
               JOIN supplier s ON s.supplier_id = i.supplier_id
              WHERE ($1::text IS NULL OR i.status = $1)
                AND ($2::text IS NULL
                     OR i.name ILIKE '%' || $2 || '%'
                     OR i.supplier_item_code ILIKE '%' || $2 || '%'
                     OR s.name ILIKE '%' || $2 || '%'
                     OR s.supplier_code ILIKE '%' || $2 || '%')
         )
         SELECT
             (SELECT count(*) FROM base) AS total,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT COALESCE(division_code, 'Unclassified') AS value,
                                      count(*) AS count
                                 FROM base GROUP BY 1) d), '[]'::jsonb) AS divisions,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT t.tag_code AS value, count(*) AS count
                                 FROM base b
                                 JOIN supplier_item_tag t USING (supplier_item_id)
                                GROUP BY 1) g), '[]'::jsonb) AS tags,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY count DESC, value)
                         FROM (SELECT b.supplier_id::text AS value, count(*) AS count
                                 FROM base b GROUP BY 1) p), '[]'::jsonb) AS suppliers,
             -- Colours by their own display order rather than by count. The
             -- colour master IS ordered — neutrals, then the wheel — and a
             -- swatch list shuffled by popularity reads as a jumble of dots
             -- that moves every time somebody types. Sizes for the same
             -- reason, more sharply: S must come before M.
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY ord, value)
                         FROM (SELECT c.code AS value, count(*) AS count,
                                      min(c.display_order) AS ord
                                 FROM base b
                                 JOIN supplier_item_colour sc USING (supplier_item_id)
                                 JOIN colour c ON c.code = sc.colour_code
                                GROUP BY 1) k), '[]'::jsonb) AS colours,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('value', value, 'count', count)
                                        ORDER BY ord, value)
                         FROM (SELECT z.code AS value, count(*) AS count,
                                      min(z.display_order) AS ord
                                 FROM base b
                                 JOIN supplier_item_size ss USING (supplier_item_id)
                                 JOIN size_code z ON z.code = ss.size_code
                                GROUP BY 1) w), '[]'::jsonb) AS sizes",
    )
    .bind(status)
    .bind(needle)
    .fetch_one(pool)
    .await?;

    Ok((
        row.try_get("total")?,
        SourcingFacets {
            divisions: serde_json::from_value(row.try_get("divisions")?)?,
            tags: serde_json::from_value(row.try_get("tags")?)?,
            suppliers: serde_json::from_value(row.try_get("suppliers")?)?,
            colours: serde_json::from_value(row.try_get("colours")?)?,
            sizes: serde_json::from_value(row.try_get("sizes")?)?,
        },
    ))
}

/// One joined `supplier_item` + `supplier` row, as both this module and the
/// basket read it.
///
/// The supplier's columns are aliased `s_*` because the two tables share four
/// column names — `name`, `status`, `created_by`, `updated_by` — and an
/// unaliased join would silently hand the item's values to the supplier. Any
/// query feeding this must use the same aliases; that is the contract between
/// this function and its callers, and it is why it lives here rather than
/// being written twice.
pub(crate) fn sourced_item_from_row(row: PgRow) -> Result<SourcedItem, AppError> {
    let supplier = Supplier {
        supplier_id: row.try_get("s_supplier_id")?,
        supplier_code: row.try_get("s_supplier_code")?,
        supplier_code_normalized: row.try_get("s_supplier_code_normalized")?,
        name: row.try_get("s_name")?,
        contact_name: row.try_get("s_contact_name")?,
        phone: row.try_get("s_phone")?,
        email: row.try_get("s_email")?,
        address: row.try_get("s_address")?,
        status: SupplierStatus::from_str(&row.try_get::<String, _>("s_status")?)
            .map_err(validation)?,
        category: row.try_get("s_category")?,
        expense_account_code: row.try_get("s_expense_account_code")?,
        npwp: row.try_get("s_npwp")?,
        is_pkp: row.try_get("s_is_pkp")?,
        default_payment_terms_code: row.try_get("s_default_payment_terms_code")?,
        // Read when the joining query selects them and blank otherwise: the
        // sourcing rows name a supplier, and its legal form is not what they
        // are about.
        legal_form: row
            .try_get::<Option<String>, _>("s_legal_form")
            .unwrap_or_default(),
        notes: row
            .try_get::<Option<String>, _>("s_notes")
            .unwrap_or_default(),
        version: row.try_get("s_version")?,
        created_by: row.try_get("s_created_by")?,
        created_at: row.try_get("s_created_at")?,
        updated_by: row.try_get("s_updated_by")?,
        updated_at: row.try_get("s_updated_at")?,
    };
    // Only the sourcing query selects the history, so its absence is read as
    // "not asked" rather than as an error. `try_get` on a column that is not
    // in the result set fails, and that failure is the signal.
    let bought = match (
        row.try_get::<i64, _>("bought_orders"),
        row.try_get::<i64, _>("bought_units"),
    ) {
        (Ok(orders), Ok(units)) => Some(PurchaseHistory {
            orders,
            units,
            last_ordered_at: row.try_get("bought_last_ordered_at").ok().flatten(),
        }),
        _ => None,
    };
    let item = supplier_item_from_row(row)?;
    Ok(SourcedItem {
        item,
        supplier,
        bought,
    })
}

pub async fn list_supplier_items(
    pool: &PgPool,
    supplier_id: Uuid,
    status: Option<SupplierStatus>,
) -> Result<Vec<SupplierItem>, AppError> {
    if !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM supplier WHERE supplier_id = $1)",
    )
    .bind(supplier_id)
    .fetch_one(pool)
    .await?
    {
        return Err(AppError::NotFound("Supplier".to_owned()));
    }
    let rows = sqlx::query(&format!(
        "SELECT i.*, {CLASSIFICATION_COLUMNS}
           FROM supplier_item i
          WHERE i.supplier_id = $1 AND ($2::text IS NULL OR i.status = $2)
          ORDER BY CASE i.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, i.name, i.supplier_item_id"
    ))
    .bind(supplier_id)
    .bind(status.map(|value| value.as_str()))
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(supplier_item_from_row).collect()
}

pub async fn list_supplier_items_page(
    pool: &PgPool,
    supplier_id: Uuid,
    status: Option<SupplierStatus>,
    cursor: Option<Uuid>,
    requested_limit: Option<i64>,
) -> Result<Value, AppError> {
    if !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM supplier WHERE supplier_id = $1)",
    )
    .bind(supplier_id)
    .fetch_one(pool)
    .await?
    {
        return Err(AppError::NotFound("Supplier".to_owned()));
    }
    let limit = requested_limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query(&format!(
        "SELECT i.*, {CLASSIFICATION_COLUMNS}
           FROM supplier_item i
          WHERE i.supplier_id = $1 AND ($2::text IS NULL OR i.status = $2)
            AND ($3::uuid IS NULL OR i.supplier_item_id > $3)
          ORDER BY i.supplier_item_id
          LIMIT $4"
    ))
    .bind(supplier_id)
    .bind(status.map(|value| value.as_str()))
    .bind(cursor)
    .bind(limit + 1)
    .fetch_all(pool)
    .await?;
    let has_more = rows.len() > limit as usize;
    let items: Vec<SupplierItem> = rows
        .into_iter()
        .take(limit as usize)
        .map(supplier_item_from_row)
        .collect::<Result<_, _>>()?;
    let next_cursor = has_more
        .then(|| items.last().map(|item| item.supplier_item_id))
        .flatten();
    Ok(json!({"items":items,"limit":limit,"next_cursor":next_cursor}))
}

pub async fn get_supplier_item(
    pool: &PgPool,
    supplier_item_id: Uuid,
) -> Result<SupplierItem, AppError> {
    let row = sqlx::query(&format!(
        "SELECT i.*, {CLASSIFICATION_COLUMNS}
           FROM supplier_item i WHERE i.supplier_item_id = $1"
    ))
    .bind(supplier_item_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier Item".to_owned()))?;
    supplier_item_from_row(row)
}

pub async fn create_supplier_item(
    pool: &PgPool,
    supplier_id: Uuid,
    request: CreateSupplierItemRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierItem, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_item_code =
        required_supplier_text("supplier_item_code", request.supplier_item_code)
            .map_err(validation)?;
    let supplier_item_code_normalized =
        normalize_supplier_code("supplier_item_code", &supplier_item_code).map_err(validation)?;
    let name = required_supplier_text("name", request.name).map_err(validation)?;
    let currency = validate_supplier_item_price(request.unit_price_minor, &request.currency)
        .map_err(validation)?;
    let description = optional_supplier_text(request.description);
    let image_url = optional_supplier_text(request.image_url);
    let internal_article_code = optional_supplier_text(request.internal_article_code);
    let division_code = optional_supplier_text(request.division_code);
    let tags = normalize_tag_codes(request.tags).map_err(validation)?;
    // Colours and sizes are normalised by the same rule as tags — uppercased,
    // trimmed, de-duplicated — because all three are codes from a master and
    // all three land on a table keyed `(supplier_item_id, code)`.
    let colour_codes = normalize_tag_codes(request.colour_codes).map_err(validation)?;
    let size_codes = normalize_tag_codes(request.size_codes).map_err(validation)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "supplier-item.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let supplier_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM supplier WHERE supplier_id = $1)")
            .bind(supplier_id)
            .fetch_one(&mut *transaction)
            .await?;
    if !supplier_exists {
        return Err(AppError::NotFound("Supplier".to_owned()));
    }
    let row = sqlx::query(
        "INSERT INTO supplier_item
             (supplier_item_id, supplier_id, supplier_item_code,
              supplier_item_code_normalized, name, description, image_url,
              unit_price_minor, currency, internal_article_code, status,
              division_code, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(supplier_id)
    .bind(supplier_item_code)
    .bind(supplier_item_code_normalized)
    .bind(name)
    .bind(description)
    .bind(image_url)
    .bind(request.unit_price_minor)
    .bind(currency)
    .bind(internal_article_code)
    .bind(request.status.as_str())
    .bind(division_code)
    .bind(actor)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let mut item = supplier_item_from_row(row)?;
    item.tags = replace_supplier_item_tags(&mut transaction, item.supplier_item_id, &tags).await?;
    item.colours =
        replace_supplier_item_colours(&mut transaction, item.supplier_item_id, &colour_codes)
            .await?;
    item.size_codes =
        replace_supplier_item_sizes(&mut transaction, item.supplier_item_id, &size_codes).await?;
    complete_item_mutation(&mut transaction, idempotency_key, &item).await?;
    transaction.commit().await?;
    Ok(item)
}

pub async fn update_supplier_item(
    pool: &PgPool,
    supplier_item_id: Uuid,
    expected_version: i64,
    request: UpdateSupplierItemRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierItem, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let changes_code = request.supplier_item_code.is_some();
    let changes_name = request.name.is_some();
    let changes_description = request.description.is_present();
    let changes_image = request.image_url.is_present();
    let changes_price = request.unit_price_minor.is_some();
    let changes_currency = request.currency.is_some();
    let changes_article = request.internal_article_code.is_present();
    let changes_division = request.division_code.is_present();
    let changes_tags = request.tags.is_some();
    let changes_colours = request.colour_codes.is_some();
    let changes_sizes = request.size_codes.is_some();
    if !(changes_code
        || changes_name
        || changes_description
        || changes_image
        || changes_price
        || changes_currency
        || changes_article
        || changes_division
        || changes_tags
        || changes_colours
        || changes_sizes)
    {
        return Err(AppError::Validation(
            "Supplier Item update must contain at least one field".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let supplier_item_code = request
        .supplier_item_code
        .map(|value| required_supplier_text("supplier_item_code", value))
        .transpose()
        .map_err(validation)?;
    let supplier_item_code_normalized = supplier_item_code
        .as_deref()
        .map(|value| normalize_supplier_code("supplier_item_code", value))
        .transpose()
        .map_err(validation)?;
    let name = request
        .name
        .map(|value| required_supplier_text("name", value))
        .transpose()
        .map_err(validation)?;
    if let Some(price) = request.unit_price_minor {
        if price < 0 {
            return Err(AppError::Validation("unit price cannot be negative".into()));
        }
    }
    let currency = request
        .currency
        .map(|value| validate_supplier_item_price(0, &value))
        .transpose()
        .map_err(validation)?;
    let description = optional_supplier_text(request.description.into_option());
    let image_url = optional_supplier_text(request.image_url.into_option());
    let internal_article_code = optional_supplier_text(request.internal_article_code.into_option());
    let division_code = optional_supplier_text(request.division_code.into_option());
    let tags = request
        .tags
        .map(normalize_tag_codes)
        .transpose()
        .map_err(validation)?;
    let colour_codes = request
        .colour_codes
        .map(normalize_tag_codes)
        .transpose()
        .map_err(validation)?;
    let size_codes = request
        .size_codes
        .map(normalize_tag_codes)
        .transpose()
        .map_err(validation)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "supplier-item.update",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier_item SET
             supplier_item_code = CASE WHEN $3 THEN $4 ELSE supplier_item_code END,
             supplier_item_code_normalized = CASE WHEN $3 THEN $5 ELSE supplier_item_code_normalized END,
             name = CASE WHEN $6 THEN $7 ELSE name END,
             description = CASE WHEN $8 THEN $9 ELSE description END,
             image_url = CASE WHEN $10 THEN $11 ELSE image_url END,
             unit_price_minor = CASE WHEN $12 THEN $13 ELSE unit_price_minor END,
             currency = CASE WHEN $14 THEN $15 ELSE currency END,
             internal_article_code = CASE WHEN $16 THEN $17 ELSE internal_article_code END,
             division_code = CASE WHEN $18 THEN $19 ELSE division_code END,
             version = version + 1, updated_by = $20, updated_at = now()
         WHERE supplier_item_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_item_id)
    .bind(expected_version)
    .bind(changes_code)
    .bind(supplier_item_code)
    .bind(supplier_item_code_normalized)
    .bind(changes_name)
    .bind(name)
    .bind(changes_description)
    .bind(description)
    .bind(changes_image)
    .bind(image_url)
    .bind(changes_price)
    .bind(request.unit_price_minor)
    .bind(changes_currency)
    .bind(currency)
    .bind(changes_article)
    .bind(internal_article_code)
    .bind(changes_division)
    .bind(division_code)
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_catalog_write_error)?;
    let Some(row) = row else {
        return Err(stale_item_error(&mut transaction, supplier_item_id, expected_version).await);
    };
    let mut item = supplier_item_from_row(row)?;
    if let Some(tags) = tags {
        item.tags = replace_supplier_item_tags(&mut transaction, supplier_item_id, &tags).await?;
    }
    if let Some(colour_codes) = colour_codes {
        item.colours =
            replace_supplier_item_colours(&mut transaction, supplier_item_id, &colour_codes)
                .await?;
    }
    if let Some(size_codes) = size_codes {
        item.size_codes =
            replace_supplier_item_sizes(&mut transaction, supplier_item_id, &size_codes).await?;
    }
    complete_item_mutation(&mut transaction, idempotency_key, &item).await?;
    transaction.commit().await?;
    Ok(item)
}

pub async fn set_supplier_item_status(
    pool: &PgPool,
    supplier_item_id: Uuid,
    expected_version: i64,
    status: SupplierStatus,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<SupplierItem, AppError> {
    if expected_version <= 0 {
        return Err(AppError::Validation(
            "If-Match version must be positive".into(),
        ));
    }
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let command_type = match status {
        SupplierStatus::Active => "supplier-item.activate",
        SupplierStatus::Inactive => "supplier-item.deactivate",
    };
    let mut transaction = pool.begin().await?;
    if let Some(response) =
        replay_or_begin(&mut transaction, idempotency_key, command_type, digest).await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let row = sqlx::query(
        "UPDATE supplier_item SET status = $3, version = version + 1,
             updated_by = $4, updated_at = now()
         WHERE supplier_item_id = $1 AND version = $2
         RETURNING *",
    )
    .bind(supplier_item_id)
    .bind(expected_version)
    .bind(status.as_str())
    .bind(actor)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(row) = row else {
        return Err(stale_item_error(&mut transaction, supplier_item_id, expected_version).await);
    };
    let item = supplier_item_from_row(row)?;
    complete_item_mutation(&mut transaction, idempotency_key, &item).await?;
    transaction.commit().await?;
    Ok(item)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogPurchaseLineRequest {
    pub supplier_item_id: Uuid,
    pub quantity: i64,
    #[serde(default)]
    pub promised_date: Option<NaiveDate>,
    /// What this order pays, when that is not what the catalogue says.
    ///
    /// A sourcing catalogue goes stale between the day something is picked out
    /// and the day it is ordered. Absent means "the catalogue's price", which
    /// is the ordinary case; present means a buyer agreed something else for
    /// this order, and the catalogue's figure is still recorded beside it.
    #[serde(default)]
    pub unit_price_minor: Option<i64>,
    /// A corrected description for this order only. It does not rename the
    /// supplier item: one order's wording is not a catalogue edit.
    #[serde(default)]
    pub article_name: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    /// What this order says the goods are, when the catalogue is wrong or
    /// silent. The classification travels to goods receipt and becomes the
    /// article's own, so correcting it here is correcting it at the only
    /// moment somebody has the garment and the paperwork in front of them.
    #[serde(default)]
    pub division_code: Option<String>,
    /// Absent keeps the catalogue's tags; present replaces them for this order.
    /// An empty list therefore means "no tags", which is a thing a buyer may
    /// legitimately say about a line.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// What the goods will sell for — the base price the articles are set up
    /// at — and the markup over the purchase price it came from. The screen
    /// keeps the two in step; both are stored as the buyer left them. See
    /// migration 0398.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub base_price_minor: Option<i64>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub markup_bps: Option<i32>,
    /// How many of each colour and size, and a SKU's own price where it is not
    /// the base price. When present the quantities must add up to `quantity`.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub variants: Option<Vec<CatalogPurchaseLineVariant>>,
    /// The unit the buyer ordered in — `KODI`, `LUSIN` — and how many of it,
    /// as a decimal string ("10", "9.5"). Absent means pieces. The server
    /// works out the pieces from the article's own units or the global
    /// conversion (0653), and refuses a line whose `quantity` does not agree
    /// — or whose unit quantity is not a whole number of pieces.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub unit_code: Option<String>,
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub unit_quantity: Option<String>,
    /// The price agreed for ONE `unit_code` — "250000" a lusin — exactly as
    /// quoted (0656). When present the line totals unit quantity × this, and
    /// `unit_price_minor` is ignored: a piece is valued at this over the
    /// factor. Absent prices the line per piece, as before.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub order_unit_price_minor: Option<i64>,
}

/// One SKU's worth of a line: a colour, a size, how many, and — when it
/// differs from the line's base price — what it sells for.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogPurchaseLineVariant {
    #[serde(default)]
    pub colour_code: Option<String>,
    #[serde(default)]
    pub size_code: Option<String>,
    pub quantity: i64,
    #[serde(default)]
    pub base_price_minor: Option<i64>,
    /// What this SKU looks like, when the buyer wanted to be specific (0961):
    /// links to photographs already stored, in the order they were added.
    /// Optional; most variants carry none.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub image_urls: Vec<String>,
}

/// Photographs one variant may carry — enough to show the garment from every
/// side, few enough that a line cannot become an album. The schema says so too.
const MAX_PHOTOS_PER_VARIANT: usize = 12;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogPurchaseOrderRequest {
    /// The number the order is filed under. Absent — the ordinary case — and
    /// the server gives it one inside the same transaction that writes the
    /// order: `PO-DDMMYY-NNN`, the day in Jakarta, the serial counted per day
    /// (see migration 0385 and `next_po_number`). A screen used to guess
    /// the next number from the order book and send it, and two buyers who
    /// opened New PO in the same minute were shown the same number and one of
    /// them was refused. Present — an import carrying a supplier's own
    /// reference — and it is used as given, and still refused if taken.
    #[serde(default)]
    pub po_number: Option<String>,
    pub supplier_id: Uuid,
    /// Where the goods land. Absent takes the node's configured default, which
    /// is the ordinary case while the company runs one DC — asking a buyer to
    /// choose between one option is a question with no information in it.
    #[serde(default)]
    pub destination_site_id: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Agreed reduction on the whole order, in the order currency's minor
    /// unit. On the order rather than the lines because that is how it is
    /// negotiated and how an invoice states it — see migration 0044.
    #[serde(default)]
    pub discount_minor: Option<i64>,
    /// The discount as a percentage of the subtotal, in hundredths of a
    /// percent (1250 = 12,50%). When present it wins over `discount_minor`:
    /// the amount is the subtotal × it, rounded half up once (0823).
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "number | null"))]
    pub discount_bps: Option<i32>,
    /// The payment terms template the order is raised on (migration 0817).
    /// Optional: absent or blank raises it with none, and a code no template
    /// carries is refused.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub payment_terms_code: Option<String>,
    /// How the order is paid: GIRO (the default), TRANSFER or CASH (0827).
    /// Absent raises it on giro.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub payment_method: Option<String>,
    /// Free-text terms and conditions written on the order (0824). Optional;
    /// absent or blank raises it with none.
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub terms_and_conditions: Option<String>,
    pub lines: Vec<CatalogPurchaseLineRequest>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CatalogPurchaseOrderReceipt {
    pub purchase_order_id: Uuid,
    pub po_number: String,
    pub supplier_id: Uuid,
    pub supplier_code: String,
    pub destination_site_id: String,
    pub activation_command_id: Uuid,
    pub sent_to_origin: String,
    /// What the lines come to at the agreed prices, what was taken off, and
    /// what is left. Returned so the screen that raised the order can show the
    /// figure the supplier will invoice without recomputing it and risking a
    /// different answer.
    pub gross_minor: i64,
    pub discount_minor: i64,
    pub net_minor: i64,
}

#[derive(Debug)]
struct CatalogItemSnapshot {
    supplier_item_id: Uuid,
    supplier_item_code: String,
    name: String,
    image_url: Option<String>,
    unit_price_minor: i64,
    currency: String,
    version: i64,
    quantity: i64,
    promised_date: Option<NaiveDate>,
    /// What this order pays and calls it — the catalogue's values unless the
    /// buyer said otherwise. The fields above keep what the catalogue said.
    ordered_price_minor: i64,
    ordered_name: String,
    ordered_image_url: Option<String>,
    /// Carried onto the order line, not merely displayed. What a thing IS
    /// survives the order: `tagging` reads these back when it mints the
    /// article at goods receipt, so dropping them here produces articles with
    /// no division and no tags even though the catalogue knew both.
    division_code: Option<String>,
    tags: Vec<String>,
    base_price_minor: Option<i64>,
    markup_bps: Option<i32>,
    variants: Vec<CatalogPurchaseLineVariant>,
    /// The unit it was ordered in, how many, and the factor that applied.
    order_unit: Option<(String, rust_decimal::Decimal, rust_decimal::Decimal)>,
    /// The price agreed per order unit, when the line was priced that way,
    /// and what the line comes to (`units::price_purchase_line`, 0656).
    order_unit_price_minor: Option<i64>,
    line_amount_minor: i64,
    /// This line's share of the order discount (0823), set by `order_value`.
    discount_minor: i64,
    /// The article the catalogue item is linked to, whose units the DC may
    /// count it in.
    article_code: Option<String>,
}

/// The next free purchase order number for today, in Jakarta: `PO-DDMMYY-NNN`.
/// Numbers filed before the prefix (`DDMMYY-NNN`) still count towards the
/// day's serial, so a day that straddles the change does not repeat one.
///
/// The day, then a three-digit serial that restarts every day — `260926-001`
/// is the first order of 26 September 2026. The owner's format (2026-09-26);
/// it replaced `PO-YYYYMMDD-NNNN`. A day-first stamp does not sort by date as
/// text, which is why the order book sorts by the issue instant and never by
/// the number.
///
/// One row per day in `purchase_order_number_day`, bumped by an upsert inside
/// the caller's transaction: two orders raised at the same moment queue on
/// that row and leave with consecutive serials, and an order that rolls back
/// takes its serial back with it. The first order of a day starts past the
/// highest number already filed under that day — orders numbered by hand or
/// by an import before this existed are never collided with — and every
/// later one takes whichever is higher, the counter or the book, for the same
/// reason. A thousandth order in one day widens the serial rather than
/// failing: `PO-260926-1000` is still unique, and still that day's.
async fn next_po_number(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<String, AppError> {
    let row = sqlx::query(
        "WITH today AS (
             -- Head office's day: it is head office that numbers orders (0603).
             SELECT site_local_date(now(), head_office_site_id()) AS day
         ),
         filed AS (
             SELECT today.day,
                    COALESCE(max(substring(po.po_number FROM '-([0-9]+)$')::integer), 0) AS highest
               FROM today
               -- Only today's numbers are read, as a range of the byte-ordered
               -- index (0920): matching the pattern against every order there
               -- is took 0.6 s at 100 000 and grew with the book. The pattern
               -- stays as the exact test on the few rows the range returns.
               LEFT JOIN LATERAL (
                    SELECT n.po_number FROM purchase_order n
                     WHERE n.po_number COLLATE \"C\" >= 'PO-' || to_char(today.day, 'DDMMYY') || '-'
                       AND n.po_number COLLATE \"C\" <  'PO-' || to_char(today.day, 'DDMMYY') || '.'
                    UNION ALL
                    SELECT n.po_number FROM purchase_order n
                     WHERE n.po_number COLLATE \"C\" >= to_char(today.day, 'DDMMYY') || '-'
                       AND n.po_number COLLATE \"C\" <  to_char(today.day, 'DDMMYY') || '.'
               ) po ON po.po_number ~ ('^(PO-)?' || to_char(today.day, 'DDMMYY') || '-[0-9]+$')
              GROUP BY today.day
         )
         INSERT INTO purchase_order_number_day (day, last_serial)
         SELECT day, highest + 1 FROM filed
         ON CONFLICT (day) DO UPDATE
            SET last_serial = GREATEST(
                    purchase_order_number_day.last_serial + 1,
                    EXCLUDED.last_serial
                )
         RETURNING to_char(day, 'DDMMYY') AS stamp, last_serial",
    )
    .fetch_one(&mut **transaction)
    .await?;
    let stamp: String = row.try_get("stamp")?;
    let serial: i32 = row.try_get("last_serial")?;
    Ok(format!("PO-{stamp}-{serial:03}"))
}

fn map_catalog_purchase_error(error: sqlx::Error, po_number: &str) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        return match database.code().as_deref() {
            Some("23505") => AppError::Conflict(format!(
                "purchase order number '{po_number}' already exists"
            )),
            Some("23503") | Some("23514") | Some("23502") => {
                AppError::Validation(database.message().to_owned())
            }
            _ => AppError::Database(error),
        };
    }
    AppError::Database(error)
}

/// Raise a PO from canonical Supplier Items while preserving the existing PO
/// command understood by every DC. Catalog identity remains in Cloud columns;
/// the command carries immutable business-code/name/price snapshots.
pub async fn create_catalog_purchase_order(
    pool: &PgPool,
    request: CatalogPurchaseOrderRequest,
    actor: &str,
    flow_actor: Option<&crate::cloud::domain::flow::Actor>,
    idempotency_key: &str,
    digest: &str,
) -> Result<CatalogPurchaseOrderReceipt, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let requested_po_number = request
        .po_number
        .map(|number| number.trim().to_owned())
        .filter(|number| !number.is_empty());
    let destination_site_id = required_supplier_text(
        "destination_site_id",
        request.destination_site_id.unwrap_or_default(),
    )
    .map_err(validation)?;
    let notes = optional_supplier_text(request.notes);
    let payment_terms_code = optional_supplier_text(request.payment_terms_code);
    let payment_method = order_payment_method(request.payment_method.as_deref())?
        .unwrap_or_else(|| "GIRO".to_string());
    let terms_and_conditions = optional_supplier_text(request.terms_and_conditions);
    validate_catalog_lines(&request.lines)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "purchase-order.catalog.create",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    // When the cloud runs the Gudang (DC-CLOUD-NATIVE.md) no node is sent the
    // order: the cloud-run Gudang reads `purchase_order` itself.
    let hosted = crate::cloud::dc::common::hosted();
    let target = if hosted {
        crate::cloud::dc::receiving::hosted_order_target(&mut transaction, &destination_site_id)
            .await?
    } else {
        inventory_dc_owner_tx(&mut transaction, &destination_site_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "no registered DC owns site '{destination_site_id}'; register it before ordering to it"
                ))
            })?
    };

    let supplier_row = sqlx::query(
        "SELECT supplier_code, name, status
         FROM supplier WHERE supplier_id = $1 FOR SHARE",
    )
    .bind(request.supplier_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("Supplier".to_owned()))?;
    let supplier_status: String = supplier_row.try_get("status")?;
    if supplier_status != SupplierStatus::Active.as_str() {
        return Err(AppError::Conflict(
            "inactive Supplier cannot be used for a new purchase order".into(),
        ));
    }
    let supplier_code: String = supplier_row.try_get("supplier_code")?;
    let supplier_name: String = supplier_row.try_get("name")?;
    ensure_payment_terms_template(&mut transaction, payment_terms_code.as_deref()).await?;

    let mut snapshots = snapshot_catalog_lines(
        &mut transaction,
        request.supplier_id,
        request.lines,
        &std::collections::HashSet::new(),
    )
    .await?;

    let (gross_minor, discount_minor) =
        order_value(&mut snapshots, request.discount_minor, request.discount_bps)?;

    // The number is taken LAST, once everything that can refuse the order has
    // had its say. `next_po_number` upserts the day's counter row, and that row
    // stays locked until this transaction ends: every order raised meanwhile
    // queues behind it. Taking it at the top held it across the catalogue
    // reads and the pricing, which for a long order is most of the work. After
    // the replay check, so a retried request gets the order (and the number)
    // it already made rather than consuming another serial.
    let po_number = match requested_po_number {
        Some(number) => number,
        None => next_po_number(&mut transaction).await?,
    };

    let purchase_order_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO purchase_order
             (purchase_order_id, po_number, supplier_id, supplier_name,
              supplier_ref_id, supplier_code_snapshot, supplier_name_snapshot,
              destination_site_id, origin_kind, order_status, currency, notes,
              discount_minor, created_by, issued_at, payment_terms_code, discount_bps,
              terms_and_conditions, payment_method)
         VALUES ($1,$2,$3,$4,$5,$3,$4,$6,'DIRECT','ISSUED','IDR',$7,$9,$8,now(),$10,$11,$12,$13)",
    )
    .bind(purchase_order_id)
    .bind(&po_number)
    .bind(&supplier_code)
    .bind(&supplier_name)
    .bind(request.supplier_id)
    .bind(&destination_site_id)
    .bind(&notes)
    .bind(&actor)
    .bind(discount_minor)
    .bind(&payment_terms_code)
    .bind(request.discount_bps)
    .bind(&terms_and_conditions)
    .bind(&payment_method)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_catalog_purchase_error(error, &po_number))?;

    // One id per line, minted here: the receiving flow below consumes it and
    // the write has to carry the same one.
    let po_line_ids: Vec<Uuid> = std::iter::repeat_with(Uuid::new_v4)
        .take(snapshots.len())
        .collect();
    let flow_lines: Vec<(Uuid, i64)> = po_line_ids
        .iter()
        .copied()
        .zip(snapshots.iter().map(|item| item.quantity))
        .collect();
    let mut units_cache = CountUnitsCache::new();
    // The whole order in a handful of statements — lines, variants, tags —
    // instead of one round trip per line inside the transaction that holds
    // the day's PO number. `insert_catalog_line` stays for the revise path,
    // which rewrites lines that other documents already point at.
    let wire_lines = insert_catalog_lines(
        &mut transaction,
        purchase_order_id,
        po_line_ids,
        snapshots,
        &po_number,
        &mut units_cache,
    )
    .await?;

    let payload = json!({
        "purchase_order_id": purchase_order_id,
        "po_number": po_number,
        "supplier_id": supplier_code,
        "supplier_name": supplier_name,
        "destination_site_id": destination_site_id,
        "created_by": actor,
        "lines": wire_lines,
    });
    parse_purchase_order(&payload).map_err(AppError::Validation)?;
    // Hosted: no command, `activation_command_id` stays NULL, and the nil id
    // answers the caller (DC-CLOUD-NATIVE.md).
    let command_id = if hosted {
        Uuid::nil()
    } else {
        let command_id = issue_command_tx(
            &mut transaction,
            COMMAND_PURCHASE_ORDER_ACTIVATE,
            &payload,
            &actor,
            None,
            std::slice::from_ref(&target),
        )
        .await?;
        sqlx::query(
            "UPDATE purchase_order SET activation_command_id = $2
             WHERE purchase_order_id = $1",
        )
        .bind(purchase_order_id)
        .bind(command_id)
        .execute(&mut *transaction)
        .await?;
        command_id
    };
    // The order's receiving flow, as a raw order starts it
    // (`create_purchase_order_as`): the buyer who raised it is the one who
    // approves the Gudang's blind count. Its lines are the purchase lines,
    // because the goods have no SKU until Article Setup.
    if let Some(flow_actor) = flow_actor {
        super::flows::start_flow_for_purchase_order_tx(
            &mut transaction,
            purchase_order_id,
            &destination_site_id,
            &supplier_code,
            &flow_lines,
            flow_actor,
            Utc::now(),
        )
        .await?;
    }

    let receipt = CatalogPurchaseOrderReceipt {
        purchase_order_id,
        po_number,
        supplier_id: request.supplier_id,
        supplier_code,
        destination_site_id,
        activation_command_id: command_id,
        sent_to_origin: target,
        gross_minor,
        discount_minor,
        net_minor: gross_minor - discount_minor,
    };
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&receipt)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(receipt)
}

/// Refuses a payment terms code no template carries. `None` — no terms — is
/// always fine. Checked here rather than left to the foreign key so the buyer
/// is told which code, not shown a constraint name.
/// The way an order is paid, upper-cased and checked; `None` when not given.
fn order_payment_method(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let method = raw.to_ascii_uppercase();
    if matches!(method.as_str(), "GIRO" | "TRANSFER" | "CASH") {
        Ok(Some(method))
    } else {
        Err(AppError::Validation(format!(
            "'{raw}' is not a payment method for an order; expected GIRO, TRANSFER or CASH"
        )))
    }
}

async fn ensure_payment_terms_template(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    code: Option<&str>,
) -> Result<(), AppError> {
    let Some(code) = code else {
        return Ok(());
    };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM payment_terms_template WHERE code = $1)")
            .bind(code)
            .fetch_one(&mut **transaction)
            .await?;
    if !exists {
        return Err(AppError::Validation(format!(
            "unknown payment terms '{code}'"
        )));
    }
    Ok(())
}

/// What every catalog order's lines must be before anything is read: at least
/// one, each for a positive quantity, and no supplier item twice.
/// The ceilings a purchase order is held to (owner, 2026-10-05): a quantity or
/// a price past these is almost certainly a typo, and one typed in full once
/// produced a total of Rp 9.999.999.999.899.900.000.000.000. Settings rather
/// than numbers in the code: the environment moves them without a release.
fn order_limit(name: &str, default: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().replace('_', "").parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

/// Most pieces on one line: `PO_MAX_LINE_QUANTITY`, 999.999 by default.
pub fn max_line_quantity() -> i64 {
    order_limit("PO_MAX_LINE_QUANTITY", 999_999)
}

/// Most a piece may cost, in rupiah: `PO_MAX_UNIT_PRICE`, 99.999.999.
pub fn max_unit_price_minor() -> i64 {
    order_limit("PO_MAX_UNIT_PRICE", 99_999_999)
}

/// Most an order may come to: `PO_MAX_ORDER_TOTAL`, 99.999.999.999.
pub fn max_order_total_minor() -> i64 {
    order_limit("PO_MAX_ORDER_TOTAL", 99_999_999_999)
}

fn validate_catalog_lines(lines: &[CatalogPurchaseLineRequest]) -> Result<(), AppError> {
    if lines.is_empty() {
        return Err(AppError::Validation(
            "a catalog purchase order needs at least one line".into(),
        ));
    }
    if lines.len() > i32::MAX as usize {
        return Err(AppError::Validation(
            "purchase order has too many lines".into(),
        ));
    }
    let mut seen_items = std::collections::HashSet::with_capacity(lines.len());
    for (index, line) in lines.iter().enumerate() {
        if line.quantity <= 0 {
            return Err(AppError::Validation(format!(
                "line {} quantity must be positive",
                index + 1
            )));
        }
        if line.quantity > max_line_quantity() {
            return Err(AppError::Validation(format!(
                "line {} quantity is at most {} pieces",
                index + 1,
                max_line_quantity()
            )));
        }
        if let Some(price) = line.unit_price_minor {
            if price < 0 {
                return Err(AppError::Validation(format!(
                    "line {} price cannot be negative",
                    index + 1
                )));
            }
            if price > max_unit_price_minor() {
                return Err(AppError::Validation(format!(
                    "line {} price is at most Rp {} a piece",
                    index + 1,
                    max_unit_price_minor()
                )));
            }
        }
        // Every line carries the delivery date. The owner made it required
        // (2026-09-26): an order nobody promised a date for is an order
        // nobody can chase, and the list flags a late one by it.
        if line.promised_date.is_none() {
            return Err(AppError::Validation(format!(
                "line {} needs a delivery date",
                index + 1
            )));
        }
        if let Some(base) = line.base_price_minor {
            if base < 0 {
                return Err(AppError::Validation(format!(
                    "line {} base price cannot be negative",
                    index + 1
                )));
            }
        }
        if let Some(variants) = line.variants.as_ref().filter(|all| !all.is_empty()) {
            let mut total: i64 = 0;
            let mut seen = std::collections::HashSet::with_capacity(variants.len());
            for variant in variants {
                if variant.quantity <= 0 {
                    return Err(AppError::Validation(format!(
                        "line {}: every variant needs a positive quantity",
                        index + 1
                    )));
                }
                if variant.colour_code.is_none() && variant.size_code.is_none() {
                    return Err(AppError::Validation(format!(
                        "line {}: a variant names a colour, a size or both",
                        index + 1
                    )));
                }
                if variant.base_price_minor.is_some_and(|price| price < 0) {
                    return Err(AppError::Validation(format!(
                        "line {}: a variant price cannot be negative",
                        index + 1
                    )));
                }
                if !seen.insert((variant.colour_code.clone(), variant.size_code.clone())) {
                    return Err(AppError::Validation(format!(
                        "line {}: the same colour and size appears twice",
                        index + 1
                    )));
                }
                if variant.image_urls.len() > MAX_PHOTOS_PER_VARIANT {
                    return Err(AppError::Validation(format!(
                        "line {}: a variant has more than {MAX_PHOTOS_PER_VARIANT} photographs",
                        index + 1
                    )));
                }
                if variant.image_urls.iter().any(|url| {
                    let url = url.trim();
                    url.len() > 2048
                        || !(url.starts_with("https://") || url.starts_with("http://"))
                }) {
                    return Err(AppError::Validation(format!(
                        "line {}: a variant's photograph is not a link",
                        index + 1
                    )));
                }
                total = total.saturating_add(variant.quantity);
            }
            if total != line.quantity {
                return Err(AppError::Validation(format!(
                    "line {}: the variants add up to {total}, not the {} ordered",
                    index + 1,
                    line.quantity
                )));
            }
        }
        if !seen_items.insert(line.supplier_item_id) {
            return Err(AppError::Validation(format!(
                "Supplier Item {} appears more than once",
                line.supplier_item_id
            )));
        }
    }
    // The order as a whole. Lines priced by the request only; a line left to the
    // catalogue's price is checked against the price ceiling where it is read.
    let total: i128 = lines
        .iter()
        .map(|line| i128::from(line.quantity) * i128::from(line.unit_price_minor.unwrap_or(0)))
        .sum();
    if total > i128::from(max_order_total_minor()) {
        return Err(AppError::Validation(format!(
            "an order comes to at most Rp {}",
            max_order_total_minor()
        )));
    }
    Ok(())
}

/// Read each line's supplier item and fix what this order pays and calls it.
///
/// `already_ordered` names the items the order held before a revision; they
/// may be carried even if the catalogue has since retired them.
async fn snapshot_catalog_lines(
    transaction: &mut Transaction<'_, Postgres>,
    supplier_id: Uuid,
    lines: Vec<CatalogPurchaseLineRequest>,
    already_ordered: &std::collections::HashSet<Uuid>,
) -> Result<Vec<CatalogItemSnapshot>, AppError> {
    let mut snapshots = Vec::with_capacity(lines.len());
    // Every item the order names, in one read. This used to be one SELECT per
    // line, each its own round trip inside the transaction that holds the
    // day's PO number: a thirty-line order spent most of its time waiting on
    // the network between the application and the database. The lines are
    // still walked in the order the buyer sent them, so the first item that is
    // missing, foreign or retired is still the one that is reported.
    let wanted: Vec<Uuid> = lines.iter().map(|line| line.supplier_item_id).collect();
    let mut found: std::collections::HashMap<Uuid, PgRow> =
        std::collections::HashMap::with_capacity(wanted.len());
    for row in sqlx::query(
        "SELECT i.supplier_item_id, i.supplier_id, i.supplier_item_code, i.name,
                i.image_url, i.unit_price_minor, i.currency, i.status, i.version,
                i.division_code, i.internal_article_code,
                COALESCE(
                    (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                       FROM supplier_item_tag t
                      WHERE t.supplier_item_id = i.supplier_item_id),
                    ARRAY[]::text[]
                ) AS tags
           FROM supplier_item i
          WHERE i.supplier_item_id = ANY($1)
          ORDER BY i.supplier_item_id
            FOR SHARE OF i",
    )
    .bind(&wanted)
    .fetch_all(&mut **transaction)
    .await?
    {
        let id: Uuid = row.try_get("supplier_item_id")?;
        found.insert(id, row);
    }
    // The units the lines are ordered in, read once per distinct (article,
    // unit) pair instead of once per line (see `OrderUnitFactors`). This read
    // decides nothing by itself, so it cannot reorder the answers: the
    // per-line checks below still run in the order the buyer sent the lines,
    // and the first impossible unit is still the one reported.
    let mut unit_pairs: Vec<(Option<String>, String)> = Vec::new();
    for line in &lines {
        let Some(unit_code) = line
            .unit_code
            .as_deref()
            .map(str::trim)
            .filter(|code| !code.is_empty())
        else {
            continue;
        };
        let article: Option<String> = match found.get(&line.supplier_item_id) {
            // A line whose item is missing is reported as such below, in the
            // usual order; its unit would only be read after that refusal.
            None => continue,
            Some(row) => row.try_get("internal_article_code")?,
        };
        let pair = (article, unit_code.to_uppercase());
        if !unit_pairs.contains(&pair) {
            unit_pairs.push(pair);
        }
    }
    let unit_factors = load_order_unit_factors(transaction, &unit_pairs).await?;
    for line in lines {
        let row = found.get(&line.supplier_item_id).ok_or_else(|| {
            AppError::NotFound(format!("Supplier Item {}", line.supplier_item_id))
        })?;
        let owner_id: Uuid = row.try_get("supplier_id")?;
        if owner_id != supplier_id {
            return Err(AppError::Conflict(format!(
                "Supplier Item {} does not belong to Supplier {}",
                line.supplier_item_id, supplier_id
            )));
        }
        let status: String = row.try_get("status")?;
        // An item already on the order it is being revised on stays orderable
        // there: the supplier retiring it from the catalogue does not undo
        // what was agreed, and refusing would make the order uneditable.
        if status != SupplierStatus::Active.as_str()
            && !already_ordered.contains(&line.supplier_item_id)
        {
            return Err(AppError::Conflict(format!(
                "Supplier Item {} is inactive",
                line.supplier_item_id
            )));
        }
        let currency = row.try_get::<String, _>("currency")?.trim().to_owned();
        if currency != "IDR" {
            return Err(AppError::Conflict(format!(
                "Supplier Item {} uses unsupported currency {currency}",
                line.supplier_item_id
            )));
        }
        // What the catalogue says, read once: it is both the fallback for an
        // order that accepts it and the snapshot for one that does not.
        let catalogue_name: String = row.try_get("name")?;
        let catalogue_image: Option<String> = row.try_get("image_url")?;
        let catalogue_price: i64 = row.try_get("unit_price_minor")?;
        // The article this item is, when it is one yet: its own units (a
        // carton of 24) beat the global table, as in ERPNext.
        let article_code: Option<String> = row.try_get("internal_article_code")?;
        let order_unit = resolve_order_unit_cached(
            &unit_factors,
            article_code.as_deref(),
            line.unit_code.as_deref(),
            line.unit_quantity.as_deref(),
            line.quantity,
        )?;
        let (ordered_price_minor, line_amount_minor, order_unit_price_minor) =
            super::units::price_purchase_line(
                line.quantity,
                line.unit_price_minor.unwrap_or(catalogue_price),
                &order_unit,
                line.order_unit_price_minor,
            )?;
        snapshots.push(CatalogItemSnapshot {
            supplier_item_id: line.supplier_item_id,
            supplier_item_code: row.try_get("supplier_item_code")?,
            name: catalogue_name.clone(),
            image_url: catalogue_image.clone(),
            unit_price_minor: catalogue_price,
            currency,
            version: row.try_get("version")?,
            quantity: line.quantity,
            promised_date: line.promised_date,
            division_code: match optional_supplier_text(line.division_code) {
                Some(code) => Some(code),
                None => row.try_get("division_code")?,
            },
            tags: match line.tags {
                Some(tags) => normalize_tag_codes(tags).map_err(validation)?,
                None => row.try_get("tags")?,
            },
            ordered_price_minor,
            ordered_name: optional_supplier_text(line.article_name).unwrap_or(catalogue_name),
            ordered_image_url: optional_supplier_text(line.image_url).or(catalogue_image),
            base_price_minor: line.base_price_minor,
            markup_bps: line.markup_bps,
            variants: line.variants.unwrap_or_default(),
            order_unit,
            order_unit_price_minor,
            line_amount_minor,
            discount_minor: 0,
            article_code,
        });
    }
    Ok(snapshots)
}

/// The order's gross value at the agreed prices, and the discount checked
/// against it and shared over the lines (0823).
///
/// A percentage (`discount_bps`, hundredths of a percent) wins over an
/// amount: the amount is the subtotal × it, rounded half up once. Either way
/// every piece on the order carries the same discount (owner, 2026-10-02):
/// a line's share is discount × its pieces ÷ the order's pieces, by largest
/// remainder in whole rupiah, so the shares add up to the discount exactly.
fn order_value(
    snapshots: &mut [CatalogItemSnapshot],
    discount_minor: Option<i64>,
    discount_bps: Option<i32>,
) -> Result<(i64, i64), AppError> {
    // What the order is worth before the discount. Computed from the agreed
    // prices, not the catalogue's, because a discount is taken off what is
    // actually being paid. Each line total was rounded once already; the
    // subtotal is their plain sum.
    let mut gross_minor: i64 = 0;
    for item in snapshots.iter() {
        gross_minor = gross_minor
            .checked_add(item.line_amount_minor)
            .ok_or_else(|| AppError::Validation("order value overflows".into()))?;
    }
    if let Some(bps) = discount_bps {
        if !(0..=10_000).contains(&bps) {
            return Err(AppError::Validation(
                "a discount is between 0 and 100 percent".into(),
            ));
        }
    }
    let discount_minor = match discount_bps {
        Some(bps) => super::units::discount_from_bps(gross_minor, bps),
        None => discount_minor.unwrap_or(0),
    };
    if discount_minor < 0 {
        return Err(AppError::Validation("discount cannot be negative".into()));
    }
    // A discount larger than the order is not a discount, it is a credit, and
    // this is not the instrument for one.
    if discount_minor > gross_minor {
        return Err(AppError::Validation(format!(
            "discount {discount_minor} is more than the order is worth ({gross_minor})"
        )));
    }
    let weights: Vec<i64> = snapshots.iter().map(|item| item.quantity).collect();
    for (item, share) in snapshots
        .iter_mut()
        .zip(super::units::share_out(discount_minor, &weights))
    {
        item.discount_minor = share;
    }
    Ok((gross_minor, discount_minor))
}

/// The count units a purchase line is spoken of in, remembered per article for
/// the length of one request. They depend on the article alone, not on the
/// line: a hundred lines of items that are not articles yet (no code) all get
/// the same answer, and asking the database for it a hundred times is a hundred
/// round trips inside the transaction that holds the day's PO number.
pub(super) type CountUnitsCache =
    std::collections::HashMap<Option<String>, Vec<crate::cloud::domain::CountUnit>>;

/// [`super::units::purchase_line_units`], asked once per article.
pub(super) async fn purchase_line_units_cached(
    transaction: &mut Transaction<'_, Postgres>,
    article_code: Option<&str>,
    order_unit: &Option<(String, rust_decimal::Decimal, rust_decimal::Decimal)>,
    cache: &mut CountUnitsCache,
) -> Result<crate::cloud::domain::PurchaseLineUnits, AppError> {
    let key = article_code.map(str::to_owned);
    if let Some(count_units) = cache.get(&key) {
        return Ok(crate::cloud::domain::PurchaseLineUnits {
            order_unit_code: order_unit.as_ref().map(|(code, _, _)| code.clone()),
            order_unit_quantity: order_unit
                .as_ref()
                .map(|(_, quantity, _)| quantity.to_string()),
            unit_factor: order_unit.as_ref().map(|(_, _, factor)| factor.to_string()),
            count_units: count_units.clone(),
        });
    }
    let units = super::units::purchase_line_units(transaction, article_code, order_unit).await?;
    cache.insert(key, units.count_units.clone());
    Ok(units)
}

/// The unit factors an order's lines resolve against, remembered per distinct
/// (article, unit) pair for the length of one request — the sibling of
/// [`CountUnitsCache`], for the OTHER per-line read. Which units an article
/// deals in, and whether one is counted in whole numbers, depend on the pair
/// alone; a twenty-line order of cartons asked the same question of
/// `article_unit_factor` twenty times, each its own round trip inside the
/// transaction that holds the day's PO number. Only the READ is shared: the
/// quantity and piece checks are about one line and stay per line.
pub(super) type OrderUnitFactors = std::collections::HashMap<
    (Option<String>, String),
    (Option<rust_decimal::Decimal>, Option<bool>),
>;

/// [`super::units::resolve_order_unit`]'s database read, asked once for every
/// distinct (article, unit) pair the order names and answered in one
/// statement. The SQL is the single-line query fanned out — the same
/// `article_unit_factor`, the same `whole_number` — so a pair resolves to
/// exactly what the per-line read resolved to.
pub(super) async fn load_order_unit_factors(
    transaction: &mut Transaction<'_, Postgres>,
    pairs: &[(Option<String>, String)],
) -> Result<OrderUnitFactors, AppError> {
    let mut factors = OrderUnitFactors::with_capacity(pairs.len());
    if pairs.is_empty() {
        return Ok(factors);
    }
    let articles: Vec<Option<String>> = pairs.iter().map(|(article, _)| article.clone()).collect();
    let units: Vec<String> = pairs.iter().map(|(_, unit)| unit.clone()).collect();
    for row in sqlx::query(
        "SELECT p.article_code, p.unit_code,
                article_unit_factor(p.article_code, p.unit_code) AS factor,
                (SELECT whole_number FROM unit_of_measure WHERE code = p.unit_code)
                    AS whole_number
           FROM unnest($1::text[], $2::text[]) AS p(article_code, unit_code)",
    )
    .bind(&articles)
    .bind(&units)
    .fetch_all(&mut **transaction)
    .await?
    {
        let article: Option<String> = row.try_get("article_code")?;
        let unit: String = row.try_get("unit_code")?;
        let factor: Option<rust_decimal::Decimal> = row.try_get("factor")?;
        let whole_number: Option<bool> = row.try_get("whole_number")?;
        factors.insert((article, unit), (factor, whole_number));
    }
    Ok(factors)
}

/// What [`super::units::resolve_order_unit`] answers, with the database read
/// already in [`OrderUnitFactors`]. The checks and the messages are that
/// function's, word for word: a line ordered in a unit the article does not
/// deal in is told the same thing whichever way the factor was fetched. The
/// pair is in the map because the caller preloaded every pair the order
/// names — the lookup cannot miss unless the caller skipped its read.
pub(super) fn resolve_order_unit_cached(
    factors: &OrderUnitFactors,
    article_code: Option<&str>,
    unit_code: Option<&str>,
    unit_quantity: Option<&str>,
    pieces: i64,
) -> Result<Option<(String, rust_decimal::Decimal, rust_decimal::Decimal)>, AppError> {
    use rust_decimal::prelude::ToPrimitive;
    use std::str::FromStr;
    let Some(code) = unit_code.map(str::trim).filter(|code| !code.is_empty()) else {
        return Ok(None);
    };
    let code = code.to_uppercase();
    let Some((factor, whole_number)) =
        factors.get(&(article_code.map(str::to_owned), code.clone()))
    else {
        return Err(AppError::Validation(format!(
            "{code} is not one of this article's units; add it to the article's units first"
        )));
    };
    let Some(factor) = factor else {
        return Err(AppError::Validation(format!(
            "{code} is not one of this article's units; add it to the article's units first"
        )));
    };
    if *factor == rust_decimal::Decimal::ONE {
        // The base unit: a line in pieces, said the long way.
        return Ok(None);
    }
    let typed = unit_quantity
        .map(|text| text.trim().replace(',', "."))
        .unwrap_or_default();
    let quantity = rust_decimal::Decimal::from_str(&typed)
        .map_err(|_| AppError::Validation(format!("{typed:?} is not a quantity of {code}")))?;
    if quantity <= rust_decimal::Decimal::ZERO {
        return Err(AppError::Validation(format!(
            "a quantity of {code} must be more than nothing"
        )));
    }
    if *whole_number == Some(true) && !quantity.fract().is_zero() {
        return Err(AppError::Validation(format!(
            "{code} is counted in whole numbers, not {quantity}"
        )));
    }
    let exact = quantity * *factor;
    if !exact.fract().is_zero() {
        return Err(AppError::Validation(format!(
            "{quantity} {code} is {exact} pieces, which is not a whole number"
        )));
    }
    let whole = exact
        .to_i64()
        .ok_or_else(|| AppError::Validation("that quantity is too large".into()))?;
    if whole != pieces {
        return Err(AppError::Validation(format!(
            "{quantity} {code} is {whole} pieces, not the {pieces} sent"
        )));
    }
    Ok(Some((code, quantity.normalize(), factor.normalize())))
}

/// Write every line of a NEW order — the lines, their variants and their
/// tags — and return what the DC is told of each.
///
/// The pricing already happened per line in [`snapshot_catalog_lines`]; what
/// reaches SQL here is a transcript of it. The rows are the ones the old
/// per-line loop bound, but they travel together: a twenty-line order with
/// variants and tags spent fifty-odd waits on the network between the
/// application and the database, all inside the transaction that holds the
/// day's PO number, and now spends four. The per-line order is kept in the
/// transcript (`line_number` ascends), so the lines read back the way they
/// were sent.
async fn insert_catalog_lines(
    transaction: &mut Transaction<'_, Postgres>,
    purchase_order_id: Uuid,
    po_line_ids: Vec<Uuid>,
    snapshots: Vec<CatalogItemSnapshot>,
    po_number: &str,
    units_cache: &mut CountUnitsCache,
) -> Result<Vec<PurchaseOrderLinePayload>, AppError> {
    // What the DC is told of each line, assembled as the transcript is built;
    // the units arrive after, one read per article.
    struct PendingLine {
        payload: PurchaseOrderLinePayload,
        article_code: Option<String>,
        order_unit: Option<(String, rust_decimal::Decimal, rust_decimal::Decimal)>,
    }
    let mut pending: Vec<PendingLine> = Vec::with_capacity(snapshots.len());
    let mut line_rows = Vec::with_capacity(snapshots.len());
    let mut variant_rows = Vec::new();
    let mut tag_rows = Vec::new();
    for (po_line_id, item) in po_line_ids.into_iter().zip(snapshots) {
        let line_number = i32::try_from(pending.len() + 1)
            .map_err(|_| AppError::Validation("purchase order has too many lines".into()))?;
        pending.push(PendingLine {
            payload: PurchaseOrderLinePayload {
                po_line_id,
                line_number,
                article_code: item.supplier_item_code.clone(),
                article_name: item.ordered_name.clone(),
                image_url: item.ordered_image_url.clone(),
                division_code: item.division_code.clone(),
                tags: item.tags.clone(),
                ordered_quantity: item.quantity,
                unit_price_minor: item.ordered_price_minor,
                promised_date: item.promised_date.map(|date| date.to_string()),
                units: None,
            },
            article_code: item.article_code,
            order_unit: item.order_unit.clone(),
        });
        let (order_unit_code, order_unit_quantity, unit_factor) = match &item.order_unit {
            Some((code, quantity, factor)) => (
                Some(code.clone()),
                Some(quantity.to_string()),
                Some(factor.to_string()),
            ),
            None => (None, None, None),
        };
        line_rows.push(json!({
            "po_line_id": po_line_id,
            "line_number": line_number,
            // The buyer's wording is what the order line carries; the
            // catalogue's name, image and price ride along as the snapshots
            // they are, which is the only record of the negotiation.
            "article_code": item.supplier_item_code,
            "article_name": item.ordered_name,
            "image_url": item.ordered_image_url,
            "division_code": item.division_code,
            "ordered_quantity": item.quantity,
            "unit_price_minor": item.ordered_price_minor,
            "line_amount_minor": item.line_amount_minor,
            "promised_date": item.promised_date,
            "supplier_item_id": item.supplier_item_id,
            "supplier_item_name_snapshot": item.name,
            "supplier_item_image_snapshot": item.image_url,
            "supplier_item_version": item.version,
            "currency": item.currency,
            "supplier_item_price_snapshot": item.unit_price_minor,
            "base_price_minor": item.base_price_minor,
            "markup_bps": item.markup_bps,
            "order_unit_code": order_unit_code,
            "order_unit_quantity": order_unit_quantity,
            "unit_factor": unit_factor,
            "order_unit_price_minor": item.order_unit_price_minor,
            "discount_minor": item.discount_minor,
        }));
        for variant in &item.variants {
            variant_rows.push(json!({
                "variant_id": Uuid::new_v4(),
                "po_line_id": po_line_id,
                "colour_code": optional_supplier_text(variant.colour_code.clone())
                    .map(|code| code.to_uppercase()),
                "size_code": optional_supplier_text(variant.size_code.clone())
                    .map(|code| code.to_uppercase()),
                "quantity": variant.quantity,
                "base_price_minor": variant.base_price_minor,
                "image_urls": variant.image_urls.iter().map(|url| url.trim()).collect::<Vec<_>>(),
            }));
        }
        for tag in &item.tags {
            tag_rows.push(json!({ "po_line_id": po_line_id, "tag_code": tag }));
        }
    }

    // Every line in one statement. A line born in this call has no variants
    // to clear and no tags to take off, so the DELETEs the revise path opens
    // with have nothing to do here and are not sent.
    sqlx::query(
        "INSERT INTO purchase_order_line
             (po_line_id, purchase_order_id, line_number,
              article_code, article_name, image_url, division_code,
              ordered_quantity,
              unit_price_minor, line_amount_minor, promised_date,
              supplier_item_id, supplier_item_code_snapshot,
              supplier_item_name_snapshot, supplier_item_image_snapshot,
              supplier_item_version, currency, supplier_item_price_snapshot,
              base_price_minor, markup_bps,
              order_unit_code, order_unit_quantity, unit_factor, order_unit_price_minor,
              discount_minor)
         SELECT row.po_line_id, $2, row.line_number,
                row.article_code, row.article_name, row.image_url, row.division_code,
                row.ordered_quantity,
                row.unit_price_minor, row.line_amount_minor, row.promised_date,
                row.supplier_item_id, row.article_code,
                row.article_name, row.image_url,
                row.supplier_item_version, row.currency, row.supplier_item_price_snapshot,
                row.base_price_minor, row.markup_bps,
                row.order_unit_code, row.order_unit_quantity, row.unit_factor,
                row.order_unit_price_minor, row.discount_minor
           FROM jsonb_to_recordset($1::jsonb) AS row(
                po_line_id uuid, line_number int,
                article_code text, article_name text, image_url text, division_code text,
                ordered_quantity bigint,
                unit_price_minor bigint, line_amount_minor bigint, promised_date date,
                supplier_item_id uuid,
                supplier_item_name_snapshot text, supplier_item_image_snapshot text,
                supplier_item_version bigint, currency text,
                supplier_item_price_snapshot bigint,
                base_price_minor bigint, markup_bps int,
                order_unit_code text, order_unit_quantity numeric, unit_factor numeric,
                order_unit_price_minor bigint, discount_minor bigint)",
    )
    .bind(serde_json::Value::Array(line_rows))
    .bind(purchase_order_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    if !variant_rows.is_empty() {
        sqlx::query(
            "INSERT INTO purchase_order_line_variant
                 (variant_id, po_line_id, colour_code, size_code, quantity, base_price_minor,
                  image_urls)
             SELECT row.variant_id, row.po_line_id, row.colour_code, row.size_code,
                    row.quantity, row.base_price_minor, COALESCE(row.image_urls, '{}')
               FROM jsonb_to_recordset($1::jsonb) AS row(
                    variant_id uuid, po_line_id uuid, colour_code text, size_code text,
                    quantity bigint, base_price_minor bigint, image_urls text[])",
        )
        .bind(serde_json::Value::Array(variant_rows))
        .execute(&mut **transaction)
        .await
        .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    }
    // What the bay may count each line in: asked once per article, not once
    // per line (`purchase_line_units_cached`).
    for line in &mut pending {
        let units = purchase_line_units_cached(
            transaction,
            line.article_code.as_deref(),
            &line.order_unit,
            units_cache,
        )
        .await?;
        line.payload.units = Some(units);
    }
    // The tags the catalogue already holds, carried onto the lines. They are
    // known-good — a supplier item cannot hold a tag that is not in the
    // vocabulary — so unlike the legacy path there is nothing to validate
    // here, only to copy.
    if !tag_rows.is_empty() {
        sqlx::query(
            "INSERT INTO purchase_order_line_tag (po_line_id, tag_code)
             SELECT row.po_line_id, row.tag_code
               FROM jsonb_to_recordset($1::jsonb) AS row(po_line_id uuid, tag_code text)
             ON CONFLICT DO NOTHING",
        )
        .bind(serde_json::Value::Array(tag_rows))
        .execute(&mut **transaction)
        .await
        .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    }
    Ok(pending.into_iter().map(|line| line.payload).collect())
}

/// Write one catalog line and its tags, and return what the DC is told of it.
async fn insert_catalog_line(
    transaction: &mut Transaction<'_, Postgres>,
    po_line_id: Uuid,
    purchase_order_id: Uuid,
    line_number: i32,
    item: CatalogItemSnapshot,
    po_number: &str,
    units_cache: &mut CountUnitsCache,
) -> Result<PurchaseOrderLinePayload, AppError> {
    let line_amount_minor = item.line_amount_minor;
    sqlx::query(
        "INSERT INTO purchase_order_line
             (po_line_id, purchase_order_id, line_number,
              article_code, article_name, image_url, division_code,
              ordered_quantity,
              unit_price_minor, line_amount_minor, promised_date,
              supplier_item_id, supplier_item_code_snapshot,
              supplier_item_name_snapshot, supplier_item_image_snapshot,
              supplier_item_version, currency, supplier_item_price_snapshot,
              base_price_minor, markup_bps,
              order_unit_code, order_unit_quantity, unit_factor, order_unit_price_minor,
              discount_minor)
         VALUES ($1,$2,$3,$4,$15,$16,$14,$7,$8,$9,$10,$11,$4,$5,$6,$12,$13,$17,$18,$19,
                 $20,$21,$22,$23,$24)",
    )
    .bind(po_line_id)
    .bind(purchase_order_id)
    .bind(line_number)
    .bind(&item.supplier_item_code)
    .bind(&item.name)
    .bind(&item.image_url)
    .bind(item.quantity)
    // The agreed price per piece, not the catalogue's. `line_amount_minor`
    // is pieces times it — or, for a line priced per order unit (0656), the
    // supplier's own unit quantity × unit price, with this the rounded
    // piece value beside it.
    .bind(item.ordered_price_minor)
    .bind(line_amount_minor)
    .bind(item.promised_date)
    .bind(item.supplier_item_id)
    .bind(item.version)
    .bind(&item.currency)
    .bind(&item.division_code)
    .bind(&item.ordered_name)
    .bind(&item.ordered_image_url)
    // What the catalogue was asking. Equal to the bound price above when
    // the buyer accepted it; different when they did not, and that
    // difference is the only record of the negotiation.
    .bind(item.unit_price_minor)
    .bind(item.base_price_minor)
    .bind(item.markup_bps)
    .bind(item.order_unit.as_ref().map(|(code, _, _)| code.clone()))
    .bind(item.order_unit.as_ref().map(|(_, quantity, _)| *quantity))
    .bind(item.order_unit.as_ref().map(|(_, _, factor)| *factor))
    .bind(item.order_unit_price_minor)
    .bind(item.discount_minor)
    .execute(&mut **transaction)
    .await
    .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    // A line born in this call has no variants to clear, so the DELETE that
    // `write_line_variants` opens with is a round trip that removes nothing.
    if !item.variants.is_empty() {
        write_line_variants(transaction, po_line_id, &item.variants, po_number).await?;
    }
    let units = purchase_line_units_cached(
        transaction,
        item.article_code.as_deref(),
        &item.order_unit,
        units_cache,
    )
    .await?;
    // The tags the catalogue already holds, carried onto the line. They
    // are known-good — a supplier item cannot hold a tag that is not in
    // the vocabulary — so unlike the legacy path there is nothing to
    // validate here, only to copy. One statement for all of them: a line
    // with four tags used to be four round trips.
    if !item.tags.is_empty() {
        sqlx::query(
            "INSERT INTO purchase_order_line_tag (po_line_id, tag_code)
             SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
        )
        .bind(po_line_id)
        .bind(&item.tags)
        .execute(&mut **transaction)
        .await
        .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    }
    Ok(PurchaseOrderLinePayload {
        po_line_id,
        line_number,
        article_code: item.supplier_item_code,
        article_name: item.ordered_name,
        image_url: item.ordered_image_url,
        // The edge receives what was ordered, classification included.
        // It was `None` and empty here, which meant the DC's copy of the
        // order disagreed with head office's about what the goods are.
        division_code: item.division_code,
        tags: item.tags,
        ordered_quantity: item.quantity,
        unit_price_minor: item.ordered_price_minor,
        promised_date: item.promised_date.map(|date| date.to_string()),
        units: Some(units),
    })
}

/// A catalog order rewritten before anything has happened against it.
///
/// The supplier and the destination are not here: changing who supplies the
/// goods or where they land is a different order, not this one edited.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CatalogPurchaseOrderRevision {
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub discount_minor: Option<i64>,
    /// The discount as a percentage, in hundredths of a percent; wins over
    /// `discount_minor` when present (0823).
    #[serde(default)]
    pub discount_bps: Option<i32>,
    /// The order's payment terms template. Absent leaves it as it was; null
    /// or blank clears it; a code no template carries is refused.
    #[serde(default)]
    pub payment_terms_code: NullablePatch<String>,
    /// How the order is paid (0827). Absent leaves it as it was.
    #[serde(default)]
    pub payment_method: Option<String>,
    /// The order's terms and conditions (0824). Absent leaves them as they
    /// were; null or blank clears them.
    #[serde(default)]
    pub terms_and_conditions: NullablePatch<String>,
    /// The whole order as it should now read. A line for an item the order
    /// already held keeps that line's identity; an item missing from here is
    /// taken off; a new one is added.
    pub lines: Vec<CatalogPurchaseLineRequest>,
}

/// Why this order can no longer be edited, or `None` while it still can.
///
/// An order may be edited until it is finished (the owner's rule, 2026-09-26):
/// fully received, every line closed, or cancelled. What happened against a
/// line before then does not freeze the order — it freezes THAT line's
/// evidence, and [`revise_catalog_purchase_order`] enforces it line by line:
/// a line with goods, a bill or a price query on it stays on the order, keeps
/// its price, and cannot drop below what has already arrived.
pub async fn purchase_order_edit_blocker<'e, E>(
    executor: E,
    purchase_order_id: Uuid,
) -> Result<Option<String>, AppError>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let row = sqlx::query(
        "SELECT o.order_status,
                o.supplier_ref_id IS NOT NULL AS from_catalogue,
                t.expected_units, t.received_units, t.all_lines_settled
           FROM purchase_order o
          CROSS JOIN LATERAL (
              SELECT COALESCE(sum(l.ordered_quantity - l.cancelled_quantity), 0)::bigint
                         AS expected_units,
                     COALESCE(sum((SELECT COALESCE(sum(r.matched_quantity), 0)
                                     FROM goods_receipt_line r
                                    WHERE r.po_line_id = l.po_line_id)), 0)::bigint
                         AS received_units,
                     (count(l.po_line_id) > 0 AND bool_and(
                     l.line_status <> 'OPEN'
                     OR COALESCE((SELECT sum(r.matched_quantity) FROM goods_receipt_line r
                                   WHERE r.po_line_id = l.po_line_id), 0)
                        >= l.ordered_quantity - l.cancelled_quantity))
                         AS all_lines_settled
                FROM purchase_order_line l
               WHERE l.purchase_order_id = o.purchase_order_id
          ) t
          WHERE o.purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order".into()))?;
    let status: String = row.try_get("order_status")?;
    let expected: i64 = row.try_get("expected_units")?;
    let received: i64 = row.try_get("received_units")?;
    let reason = if status == "CANCELLED" {
        Some("a cancelled order cannot be edited".to_owned())
    } else if !row.try_get::<bool, _>("from_catalogue")? {
        Some("only an order raised from a supplier catalogue can be edited".to_owned())
    } else if expected > 0 && received >= expected {
        Some("this order has been fully received".to_owned())
    } else if status == "CLOSED" || row.try_get::<bool, _>("all_lines_settled")? {
        Some("every line on this order has been closed".to_owned())
    } else {
        None
    };
    Ok(reason)
}

/// Why this order can no longer be cancelled, or `None` while it still can.
///
/// An order is cancelled only while it is still just a promise: nothing
/// received against it, no bill matched to it and no money advanced on it.
/// Once goods have arrived the order is closed short instead — the goods that
/// came are real, and cancelling would make them an order nobody placed.
pub async fn purchase_order_cancel_blocker<'e, E>(
    executor: E,
    purchase_order_id: Uuid,
) -> Result<Option<String>, AppError>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let row = sqlx::query(
        "SELECT o.order_status,
                EXISTS (SELECT 1 FROM goods_receipt_line r
                          JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
                         WHERE l.purchase_order_id = o.purchase_order_id) AS received,
                EXISTS (SELECT 1 FROM supplier_invoice_line b
                          JOIN purchase_order_line l ON l.po_line_id = b.po_line_id
                         WHERE l.purchase_order_id = o.purchase_order_id) AS billed,
                EXISTS (SELECT 1 FROM supplier_advance a
                         WHERE a.purchase_order_id = o.purchase_order_id) AS advanced
           FROM purchase_order o
          WHERE o.purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order".into()))?;
    let status: String = row.try_get("order_status")?;
    Ok(if status == "CANCELLED" {
        Some("this order is already cancelled".to_owned())
    } else if status == "CLOSED" {
        Some("this order has been closed".to_owned())
    } else if row.try_get::<bool, _>("received")? {
        Some(
            "goods have already been received against this order; close it short instead"
                .to_owned(),
        )
    } else if row.try_get::<bool, _>("billed")? {
        Some("a supplier bill has already been matched to this order".to_owned())
    } else if row.try_get::<bool, _>("advanced")? {
        Some("money has been advanced against this order".to_owned())
    } else {
        None
    })
}

/// Why an order is being called off. Optional: the log records who and when
/// either way.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CancelPurchaseOrderRequest {
    #[serde(default)]
    #[cfg_attr(feature = "ts", ts(optional, type = "string | null"))]
    pub reason: Option<String>,
}

/// What a cancellation answers with.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseOrderCancelled {
    pub purchase_order_id: Uuid,
    pub po_number: String,
    /// The command that tells the DC, which takes the order off its
    /// receiving worklist.
    pub cancel_command_id: Uuid,
}

/// Cancel an order nothing has happened against, tell the DC, and log it.
///
/// Every line is marked cancelled and the order with them; the lines stay, so
/// the order still reads as what was agreed and then called off. The log
/// entry is the same history an edit writes (`purchase_order_revision`).
pub async fn cancel_purchase_order(
    pool: &PgPool,
    purchase_order_id: Uuid,
    request: CancelPurchaseOrderRequest,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<PurchaseOrderCancelled, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let reason = optional_supplier_text(request.reason);

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "purchase-order.cancel",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }
    let header = sqlx::query(
        "SELECT po_number, destination_site_id FROM purchase_order
          WHERE purchase_order_id = $1 FOR UPDATE",
    )
    .bind(purchase_order_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order".into()))?;
    if let Some(reason) =
        purchase_order_cancel_blocker(&mut *transaction, purchase_order_id).await?
    {
        return Err(AppError::Conflict(reason));
    }
    let po_number: String = header.try_get("po_number")?;
    let destination_site_id: String = header.try_get("destination_site_id")?;
    // When the cloud runs the Gudang there is no node to tell: its bay reads
    // the order's status itself (DC-CLOUD-NATIVE.md).
    let hosted = crate::cloud::dc::common::hosted();
    let target = if hosted {
        String::new()
    } else {
        inventory_dc_owner_tx(&mut transaction, &destination_site_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "no registered DC owns site '{destination_site_id}'"
                ))
            })?
    };

    sqlx::query(
        "UPDATE purchase_order SET order_status = 'CANCELLED' WHERE purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE purchase_order_line SET line_status = 'CANCELLED'
          WHERE purchase_order_id = $1 AND line_status = 'OPEN'",
    )
    .bind(purchase_order_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO purchase_order_revision
             (revision_id, purchase_order_id, revised_by, changes)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(purchase_order_id)
    .bind(&actor)
    .bind(json!([{ "kind": "cancelled", "to": reason }]))
    .execute(&mut *transaction)
    .await?;

    let payload = json!({
        "purchase_order_id": purchase_order_id,
        "po_number": po_number,
        "reason": reason,
    });
    let cancel_command_id = if hosted {
        Uuid::nil()
    } else {
        issue_command_tx(
            &mut transaction,
            crate::cloud::domain::COMMAND_PURCHASE_ORDER_CANCEL,
            &payload,
            &actor,
            None,
            std::slice::from_ref(&target),
        )
        .await?
    };

    let answer = PurchaseOrderCancelled {
        purchase_order_id,
        po_number,
        cancel_command_id,
    };
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&answer)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(answer)
}

/// One line as it stood before an edit, and what already points at it.
struct HeldLine {
    po_line_id: Uuid,
    name: String,
    quantity: i64,
    unit_price_minor: i64,
    promised_date: Option<NaiveDate>,
    /// Matched pieces already received against it.
    received: i64,
    /// Goods, a bill, a price query or a close stand against it: it is
    /// evidence now, so it stays and keeps its price.
    locked: bool,
    /// Closed short or cancelled in part: its quantity is settled too.
    settled: bool,
}

/// Rewrite a catalog order that is not finished yet, tell the DC holding it,
/// and keep a record of what changed.
///
/// Lines nothing points at are replaced; a line with goods, a bill or a price
/// query against it is updated in place, keeping its `po_line_id`, and may not
/// be removed, repriced, or cut below what has already arrived. The DC gets
/// the whole order again as a `purchase.order.revise` command — the same shape
/// it was activated with — and it keeps any line it has already counted.
pub async fn revise_catalog_purchase_order(
    pool: &PgPool,
    purchase_order_id: Uuid,
    request: CatalogPurchaseOrderRevision,
    actor: &str,
    idempotency_key: &str,
    digest: &str,
) -> Result<CatalogPurchaseOrderReceipt, AppError> {
    let actor = required_supplier_text("actor", actor).map_err(validation)?;
    let notes = optional_supplier_text(request.notes);
    let changes_terms = request.payment_terms_code.is_present();
    let payment_terms_code = optional_supplier_text(request.payment_terms_code.into_option());
    let payment_method = order_payment_method(request.payment_method.as_deref())?;
    let changes_conditions = request.terms_and_conditions.is_present();
    let terms_and_conditions = optional_supplier_text(request.terms_and_conditions.into_option());
    validate_catalog_lines(&request.lines)?;

    let mut transaction = pool.begin().await?;
    if let Some(response) = replay_or_begin(
        &mut transaction,
        idempotency_key,
        "purchase-order.catalog.revise",
        digest,
    )
    .await?
    {
        return Ok(serde_json::from_value(response)?);
    }

    // Held for the rest of the transaction, so a receipt or a bill cannot land
    // on the lines between the checks below and the rewrite.
    let header = sqlx::query(
        "SELECT po_number, supplier_id, supplier_name, supplier_ref_id, destination_site_id,
                notes, discount_minor, created_by, payment_terms_code, terms_and_conditions
           FROM purchase_order WHERE purchase_order_id = $1 FOR UPDATE",
    )
    .bind(purchase_order_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or_else(|| AppError::NotFound("purchase order".into()))?;
    if let Some(reason) = purchase_order_edit_blocker(&mut *transaction, purchase_order_id).await? {
        return Err(AppError::Conflict(reason));
    }
    // After goods have been received the order is a record of what was bought:
    // only the delivery date and the notes may change (owner, 2026-10-05). The
    // items and their quantities, the way it is paid and the discount are held
    // exactly as they stand; the screen shuts them, and this refuses a request
    // that changes them anyway.
    let received_any: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM goods_receipt_line r
                          JOIN purchase_order_line l ON l.po_line_id = r.po_line_id
                         WHERE l.purchase_order_id = $1)",
    )
    .bind(purchase_order_id)
    .fetch_one(&mut *transaction)
    .await?;
    if received_any {
        let held = sqlx::query(
            "SELECT supplier_item_id, (ordered_quantity - cancelled_quantity)::bigint AS quantity
               FROM purchase_order_line
              WHERE purchase_order_id = $1 AND line_status <> 'CANCELLED'",
        )
        .bind(purchase_order_id)
        .fetch_all(&mut *transaction)
        .await?;
        let mut same = held.len() == request.lines.len();
        for line in &request.lines {
            let found = held.iter().find(|row| {
                row.try_get::<Option<Uuid>, _>("supplier_item_id")
                    .ok()
                    .flatten()
                    == Some(line.supplier_item_id)
            });
            match found {
                Some(row) => {
                    let quantity: i64 = row.try_get("quantity")?;
                    if quantity != line.quantity {
                        same = false;
                    }
                }
                None => same = false,
            }
        }
        let method_before: Option<String> = sqlx::query_scalar(
            "SELECT payment_method FROM purchase_order WHERE purchase_order_id = $1",
        )
        .bind(purchase_order_id)
        .fetch_one(&mut *transaction)
        .await?;
        let terms_held: Option<String> = header.try_get("payment_terms_code")?;
        let terms_changed = changes_terms && payment_terms_code != terms_held;
        let method_changed = payment_method.is_some() && payment_method != method_before;
        if !same || terms_changed || method_changed {
            return Err(AppError::Conflict(
                "goods have been received on this order: only the delivery date and the notes can change"
                    .into(),
            ));
        }
    }
    let po_number: String = header.try_get("po_number")?;
    let supplier_code: String = header.try_get("supplier_id")?;
    let supplier_name: Option<String> = header.try_get("supplier_name")?;
    let supplier_ref_id: Uuid = header
        .try_get::<Option<Uuid>, _>("supplier_ref_id")?
        .ok_or_else(|| {
            AppError::Conflict(
                "only an order raised from a supplier catalogue can be edited".into(),
            )
        })?;
    let destination_site_id: String = header.try_get("destination_site_id")?;
    let notes_before: Option<String> = header.try_get("notes")?;
    let discount_before: i64 = header.try_get("discount_minor")?;
    let terms_before: Option<String> = header.try_get("payment_terms_code")?;
    let conditions_before: Option<String> = header.try_get("terms_and_conditions")?;
    let terms_and_conditions = if changes_conditions {
        terms_and_conditions
    } else {
        conditions_before.clone()
    };
    let payment_terms_code = if changes_terms {
        ensure_payment_terms_template(&mut transaction, payment_terms_code.as_deref()).await?;
        payment_terms_code
    } else {
        terms_before.clone()
    };
    // The order's raiser, not the editor: the DC lets the raiser verify.
    let raised_by: String = header.try_get("created_by")?;

    // When the cloud runs the Gudang (DC-CLOUD-NATIVE.md) no node is sent the
    // order: the cloud-run Gudang reads `purchase_order` itself.
    let hosted = crate::cloud::dc::common::hosted();
    let target = if hosted {
        crate::cloud::dc::receiving::hosted_order_target(&mut transaction, &destination_site_id)
            .await?
    } else {
        inventory_dc_owner_tx(&mut transaction, &destination_site_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "no registered DC owns site '{destination_site_id}'; register it before ordering to it"
                ))
            })?
    };

    let mut held: std::collections::HashMap<Uuid, HeldLine> = std::collections::HashMap::new();
    for row in sqlx::query(
        "SELECT l.supplier_item_id, l.po_line_id, l.article_name, l.ordered_quantity,
                l.unit_price_minor, l.promised_date,
                COALESCE((SELECT sum(r.matched_quantity) FROM goods_receipt_line r
                           WHERE r.po_line_id = l.po_line_id), 0)::bigint AS received,
                (EXISTS (SELECT 1 FROM goods_receipt_line r WHERE r.po_line_id = l.po_line_id)
                 OR EXISTS (SELECT 1 FROM supplier_invoice_line b WHERE b.po_line_id = l.po_line_id)
                 OR EXISTS (SELECT 1 FROM purchase_price_amendment a
                             WHERE a.po_line_id = l.po_line_id)
                 OR l.line_status <> 'OPEN' OR l.cancelled_quantity > 0) AS locked,
                (l.line_status <> 'OPEN' OR l.cancelled_quantity > 0) AS settled
           FROM purchase_order_line l
          WHERE l.purchase_order_id = $1 AND l.supplier_item_id IS NOT NULL",
    )
    .bind(purchase_order_id)
    .fetch_all(&mut *transaction)
    .await?
    {
        held.insert(
            row.try_get("supplier_item_id")?,
            HeldLine {
                po_line_id: row.try_get("po_line_id")?,
                name: row.try_get("article_name")?,
                quantity: row.try_get("ordered_quantity")?,
                unit_price_minor: row.try_get("unit_price_minor")?,
                promised_date: row.try_get("promised_date")?,
                received: row.try_get("received")?,
                locked: row.try_get("locked")?,
                settled: row.try_get("settled")?,
            },
        );
    }
    let already_ordered = held.keys().copied().collect();

    let mut snapshots = snapshot_catalog_lines(
        &mut transaction,
        supplier_ref_id,
        request.lines,
        &already_ordered,
    )
    .await?;

    // What an edit may not do to a line that is already evidence.
    let kept: std::collections::HashSet<Uuid> =
        snapshots.iter().map(|item| item.supplier_item_id).collect();
    for (item, line) in &held {
        if line.locked && !kept.contains(item) {
            return Err(AppError::Conflict(format!(
                "{} cannot be taken off the order: goods or a bill already stand against it",
                line.name
            )));
        }
    }
    for item in &snapshots {
        let Some(line) = held.get(&item.supplier_item_id) else {
            continue;
        };
        if !line.locked {
            continue;
        }
        if item.ordered_price_minor != line.unit_price_minor {
            return Err(AppError::Conflict(format!(
                "the price of {} cannot change once goods or a bill stand against it",
                line.name
            )));
        }
        if line.settled && item.quantity != line.quantity {
            return Err(AppError::Conflict(format!(
                "{} has been closed; its quantity cannot change",
                line.name
            )));
        }
        if item.quantity < line.received {
            return Err(AppError::Conflict(format!(
                "{} cannot be cut to {} — {} have already been received",
                line.name, item.quantity, line.received
            )));
        }
    }

    let (gross_minor, discount_minor) =
        order_value(&mut snapshots, request.discount_minor, request.discount_bps)?;
    let net_minor = gross_minor - discount_minor;
    if received_any && discount_minor != discount_before {
        return Err(AppError::Conflict(
            "goods have been received on this order: only the delivery date and the notes can change"
                .into(),
        ));
    }

    // Money already paid ahead against this order cannot be left worth more
    // than the order it was paid against.
    let advanced: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(amount_minor), 0)::bigint FROM supplier_advance
          WHERE purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .fetch_one(&mut *transaction)
    .await?;
    if net_minor < advanced {
        return Err(AppError::Validation(format!(
            "the order would be worth {net_minor}, less than the {advanced} already advanced against it"
        )));
    }

    // What changed, worked out before anything is written.
    let mut changes: Vec<Value> = Vec::new();
    if optional_supplier_text(notes_before.clone()) != notes {
        changes.push(json!({
            "kind": "header", "field": "notes", "from": notes_before, "to": notes,
        }));
    }
    if discount_before != discount_minor {
        changes.push(json!({
            "kind": "header", "field": "discount", "from": discount_before, "to": discount_minor,
        }));
    }
    if terms_before != payment_terms_code {
        changes.push(json!({
            "kind": "header", "field": "payment_terms",
            "from": terms_before, "to": payment_terms_code,
        }));
    }
    if conditions_before != terms_and_conditions {
        changes.push(json!({
            "kind": "header", "field": "terms_and_conditions",
            "from": conditions_before, "to": terms_and_conditions,
        }));
    }
    for item in &snapshots {
        match held.get(&item.supplier_item_id) {
            None => changes.push(json!({
                "kind": "added", "item": item.ordered_name,
                "to": { "quantity": item.quantity, "unit_price_minor": item.ordered_price_minor },
            })),
            Some(line) => {
                if line.quantity != item.quantity {
                    changes.push(json!({
                        "kind": "changed", "item": item.ordered_name, "field": "quantity",
                        "from": line.quantity, "to": item.quantity,
                    }));
                }
                if line.unit_price_minor != item.ordered_price_minor {
                    changes.push(json!({
                        "kind": "changed", "item": item.ordered_name, "field": "unit_price",
                        "from": line.unit_price_minor, "to": item.ordered_price_minor,
                    }));
                }
                if line.promised_date != item.promised_date {
                    changes.push(json!({
                        "kind": "changed", "item": item.ordered_name, "field": "delivery_date",
                        "from": line.promised_date, "to": item.promised_date,
                    }));
                }
                if line.name != item.ordered_name {
                    changes.push(json!({
                        "kind": "changed", "item": item.ordered_name, "field": "name",
                        "from": line.name, "to": item.ordered_name,
                    }));
                }
            }
        }
    }
    for (item, line) in &held {
        if !kept.contains(item) {
            changes.push(json!({
                "kind": "removed", "item": line.name,
                "from": { "quantity": line.quantity, "unit_price_minor": line.unit_price_minor },
            }));
        }
    }

    // Lines nothing points at are replaced; the rest are kept and renumbered
    // out of the way first, because `(purchase_order_id, line_number)` is
    // unique and the edit may hand a number to a line that held another.
    sqlx::query(
        "DELETE FROM purchase_order_line
          WHERE purchase_order_id = $1 AND NOT (po_line_id = ANY($2))",
    )
    .bind(purchase_order_id)
    .bind(
        held.values()
            .filter(|line| line.locked)
            .map(|line| line.po_line_id)
            .collect::<Vec<_>>(),
    )
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE purchase_order_line SET line_number = -line_number
          WHERE purchase_order_id = $1 AND line_number > 0",
    )
    .bind(purchase_order_id)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE purchase_order SET notes = $2, discount_minor = $3, payment_terms_code = $4,
                discount_bps = $5, terms_and_conditions = $6,
                payment_method = COALESCE($7, payment_method)
          WHERE purchase_order_id = $1",
    )
    .bind(purchase_order_id)
    .bind(&notes)
    .bind(discount_minor)
    .bind(&payment_terms_code)
    .bind(request.discount_bps)
    .bind(&terms_and_conditions)
    .bind(&payment_method)
    .execute(&mut *transaction)
    .await?;

    let mut wire_lines = Vec::with_capacity(snapshots.len());
    let mut units_cache = CountUnitsCache::new();
    for (index, item) in snapshots.into_iter().enumerate() {
        let line_number = i32::try_from(index + 1)
            .map_err(|_| AppError::Validation("purchase order has too many lines".into()))?;
        let wire = match held.get(&item.supplier_item_id) {
            Some(line) if line.locked => {
                update_catalog_line(
                    &mut transaction,
                    line.po_line_id,
                    line_number,
                    item,
                    &po_number,
                    &mut units_cache,
                )
                .await?
            }
            Some(line) => {
                insert_catalog_line(
                    &mut transaction,
                    line.po_line_id,
                    purchase_order_id,
                    line_number,
                    item,
                    &po_number,
                    &mut units_cache,
                )
                .await?
            }
            None => {
                insert_catalog_line(
                    &mut transaction,
                    Uuid::new_v4(),
                    purchase_order_id,
                    line_number,
                    item,
                    &po_number,
                    &mut units_cache,
                )
                .await?
            }
        };
        wire_lines.push(wire);
    }

    let payload = json!({
        "purchase_order_id": purchase_order_id,
        "po_number": po_number,
        "supplier_id": supplier_code,
        "supplier_name": supplier_name,
        "destination_site_id": destination_site_id,
        "created_by": raised_by,
        "lines": wire_lines,
    });
    parse_purchase_order(&payload).map_err(AppError::Validation)?;
    // Hosted: nobody to tell; the cloud-run Gudang reads the revised lines.
    let command_id = if hosted {
        Uuid::nil()
    } else {
        issue_command_tx(
            &mut transaction,
            COMMAND_PURCHASE_ORDER_REVISE,
            &payload,
            &actor,
            None,
            std::slice::from_ref(&target),
        )
        .await?
    };

    // The log. Written even when the lines came back the same — somebody
    // pressed Save, and "nothing changed" is itself what happened.
    sqlx::query(
        "INSERT INTO purchase_order_revision
             (revision_id, purchase_order_id, revised_by, changes)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(purchase_order_id)
    .bind(&actor)
    .bind(Value::Array(changes))
    .execute(&mut *transaction)
    .await?;

    let receipt = CatalogPurchaseOrderReceipt {
        purchase_order_id,
        po_number,
        supplier_id: supplier_ref_id,
        supplier_code,
        destination_site_id,
        activation_command_id: command_id,
        sent_to_origin: target,
        gross_minor,
        discount_minor,
        net_minor,
    };
    complete_idempotent(
        &mut transaction,
        idempotency_key,
        &serde_json::to_value(&receipt)?,
    )
    .await?;
    transaction.commit().await?;
    Ok(receipt)
}

/// Replace a line's colour-and-size breakdown with the one given.
async fn write_line_variants(
    transaction: &mut Transaction<'_, Postgres>,
    po_line_id: Uuid,
    variants: &[CatalogPurchaseLineVariant],
    po_number: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM purchase_order_line_variant WHERE po_line_id = $1")
        .bind(po_line_id)
        .execute(&mut **transaction)
        .await?;
    for variant in variants {
        sqlx::query(
            "INSERT INTO purchase_order_line_variant
                 (variant_id, po_line_id, colour_code, size_code, quantity, base_price_minor,
                  image_urls)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(po_line_id)
        .bind(optional_supplier_text(variant.colour_code.clone()).map(|code| code.to_uppercase()))
        .bind(optional_supplier_text(variant.size_code.clone()).map(|code| code.to_uppercase()))
        .bind(variant.quantity)
        .bind(variant.base_price_minor)
        .bind(
            variant
                .image_urls
                .iter()
                .map(|url| url.trim().to_owned())
                .collect::<Vec<_>>(),
        )
        .execute(&mut **transaction)
        .await
        .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    }
    Ok(())
}

/// Rewrite a line that other documents already point at, in place.
///
/// Its identity, its price and anything received against it stay; what the
/// buyer may still change — how many, by when, what it is called and filed
/// under, and where it sits on the order — is written over it.
async fn update_catalog_line(
    transaction: &mut Transaction<'_, Postgres>,
    po_line_id: Uuid,
    line_number: i32,
    item: CatalogItemSnapshot,
    po_number: &str,
    units_cache: &mut CountUnitsCache,
) -> Result<PurchaseOrderLinePayload, AppError> {
    let line_amount_minor = item.line_amount_minor;
    sqlx::query(
        "UPDATE purchase_order_line SET
             line_number = $2, article_name = $3, image_url = $4, division_code = $5,
             ordered_quantity = $6, line_amount_minor = $7, promised_date = $8,
             base_price_minor = $9, markup_bps = $10,
             order_unit_code = $11, order_unit_quantity = $12, unit_factor = $13,
             order_unit_price_minor = $14, discount_minor = $15
         WHERE po_line_id = $1",
    )
    .bind(po_line_id)
    .bind(line_number)
    .bind(&item.ordered_name)
    .bind(&item.ordered_image_url)
    .bind(&item.division_code)
    .bind(item.quantity)
    .bind(line_amount_minor)
    .bind(item.promised_date)
    .bind(item.base_price_minor)
    .bind(item.markup_bps)
    .bind(item.order_unit.as_ref().map(|(code, _, _)| code.clone()))
    .bind(item.order_unit.as_ref().map(|(_, quantity, _)| *quantity))
    .bind(item.order_unit.as_ref().map(|(_, _, factor)| *factor))
    .bind(item.order_unit_price_minor)
    .bind(item.discount_minor)
    .execute(&mut **transaction)
    .await
    .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    write_line_variants(transaction, po_line_id, &item.variants, po_number).await?;
    let units = purchase_line_units_cached(
        transaction,
        item.article_code.as_deref(),
        &item.order_unit,
        units_cache,
    )
    .await?;
    sqlx::query("DELETE FROM purchase_order_line_tag WHERE po_line_id = $1")
        .bind(po_line_id)
        .execute(&mut **transaction)
        .await?;
    if !item.tags.is_empty() {
        sqlx::query(
            "INSERT INTO purchase_order_line_tag (po_line_id, tag_code)
             SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
        )
        .bind(po_line_id)
        .bind(&item.tags)
        .execute(&mut **transaction)
        .await
        .map_err(|error| map_catalog_purchase_error(error, po_number))?;
    }
    Ok(PurchaseOrderLinePayload {
        po_line_id,
        line_number,
        article_code: item.supplier_item_code,
        article_name: item.ordered_name,
        image_url: item.ordered_image_url,
        division_code: item.division_code,
        tags: item.tags,
        ordered_quantity: item.quantity,
        unit_price_minor: item.ordered_price_minor,
        promised_date: item.promised_date.map(|date| date.to_string()),
        units: Some(units),
    })
}

/// Every saved edit of one order, newest first — what the order sheet shows
/// as its history.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseOrderRevisionEntry {
    pub revision_id: Uuid,
    pub revised_by: String,
    pub revised_at: DateTime<Utc>,
    /// `{kind, item?, field?, from?, to?}` — `kind` is `header`, `added`,
    /// `removed` or `changed`; `field` is `notes`, `discount`, `quantity`,
    /// `unit_price`, `delivery_date` or `name`.
    #[cfg_attr(feature = "ts", ts(type = "Array<Record<string, unknown>>"))]
    pub changes: Value,
}

pub async fn purchase_order_revisions(
    pool: &PgPool,
    purchase_order_id: Uuid,
) -> Result<Vec<PurchaseOrderRevisionEntry>, AppError> {
    sqlx::query(
        "SELECT revision_id, revised_by, revised_at, changes
           FROM purchase_order_revision
          WHERE purchase_order_id = $1
          ORDER BY revised_at DESC",
    )
    .bind(purchase_order_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        Ok(PurchaseOrderRevisionEntry {
            revision_id: row.try_get("revision_id")?,
            revised_by: row.try_get("revised_by")?,
            revised_at: row.try_get("revised_at")?,
            changes: row.try_get("changes")?,
        })
    })
    .collect()
}

/// A site a purchase order can actually be delivered to.
///
/// A purchase order names a `destination_site_id`, and until now the only way
/// to list those was `GET /api/v1/sync/origins` — which is Admin-only, on
/// purpose: `cloud/domain/auth.rs` has a test asserting that knowing which
/// nodes exist is administration even when you are only reading it. A
/// Supervisor raising an order is not doing administration, and was getting a
/// 403 on a list of site names.
///
/// `GET /api/v1/sync/fleet` is readable by everyone but answers a different
/// question: it carries `origin_id` and convergence, not `site_id`, and the two
/// are not the same string — a node registered as `dc-jakarta` can be standing
/// in site `DC-JKT`. An order routed by origin id would name a site that does
/// not exist.
///
/// So this is the purchasing question asked directly: where can a delivery go.
/// It exposes site names and roles and nothing else — no ingest keys, no
/// generations, no command backlog.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PurchaseDestination {
    pub site_id: String,
    /// What a person calls it. Falls back to the site id when nobody has named
    /// the node, because a blank line in a picker is not a choice.
    pub label: String,
    /// `DC` or `STORE`. A buyer routing a full container and a buyer topping up
    /// one shop are making different decisions and the list should say which is
    /// which.
    pub node_role: String,
}

/// Every site a supplier's delivery can be ordered to: the Gudang's servers.
///
/// A shop never receives from a supplier — goods reach it only as head
/// office allots them from the Gudang, and an order to a shop is refused
/// (`inventory_dc_owner_tx`), so a shop is never offered here (owner, 28 Sep
/// 2026). Cloud itself is excluded: the centre has no floor to put stock on. So is any
/// node with inventory switched off, and any registration that never named a
/// site — both would offer a destination the goods receipt could not be booked
/// against.
///
/// **A bare array, deliberately, and the only list in this module that stays
/// one.** Every other list here grew an envelope with a keyset because the set
/// behind it grows without limit — orders, suppliers, amendments. This one does
/// not. A row is a BUILDING: one warehouse and thirteen shops, fourteen rows,
/// and the fifteenth arrives the day the company signs a lease. It is bounded
/// by the estate, not by trade.
///
/// So there is nothing for a cursor to carry. Worse, it is a PICKER — the order
/// composer takes `[0]` as the landing site a new order defaults to — and a
/// picker that can be served half its options is a picker that quietly loses
/// one. A page-two of destinations would be a control nobody thinks to click,
/// hiding a warehouse.
///
/// If this ever stops being true the answer is the same as everywhere else and
/// the shape is written nine times over; until then the ceremony would be the
/// bug.
pub async fn purchase_destinations(pool: &PgPool) -> Result<Vec<PurchaseDestination>, AppError> {
    let rows = sqlx::query(
        "SELECT DISTINCT ON (site_id) site_id, label, node_role
           FROM sync_origin_credential
          WHERE inventory_enabled
            AND site_id IS NOT NULL
            AND node_role = 'DC'
          ORDER BY site_id, origin_id",
    )
    .fetch_all(pool)
    .await?;
    let mut destinations: Vec<PurchaseDestination> = rows
        .into_iter()
        .map(|row| {
            let site_id: String = row.try_get("site_id")?;
            let label: Option<String> = row.try_get("label")?;
            Ok(PurchaseDestination {
                label: label
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| site_id.clone()),
                site_id,
                node_role: row.try_get("node_role")?,
            })
        })
        .collect::<Result<_, AppError>>()?;
    // When the cloud runs the Gudang (DC-CLOUD-NATIVE.md) no node stands
    // there, so the head-office site is offered by itself.
    if crate::cloud::dc::common::hosted() {
        let gudang = sqlx::query(
            "SELECT s.id, COALESCE(NULLIF(btrim(s.name), ''), s.id) AS label
               FROM site s WHERE s.id = head_office_site_id()",
        )
        .fetch_optional(pool)
        .await?;
        if let Some(row) = gudang {
            let site_id: String = row.try_get("id")?;
            if !destinations.iter().any(|known| known.site_id == site_id) {
                destinations.push(PurchaseDestination {
                    label: row.try_get("label")?,
                    site_id,
                    node_role: "DC".into(),
                });
            }
        }
    }
    // Warehouses first, then shops, alphabetically inside each — the order a
    // buyer scans them in. The label comparison folds case, because these are
    // names people typed: with a plain byte comparison "STORE store-07" sorts
    // before "Store 02", which is not alphabetical to anybody reading it.
    destinations.sort_by(|a, b| {
        a.node_role
            .cmp(&b.node_role)
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    Ok(destinations)
}

/// Set an item's tags to exactly `tags`, and report what they now are.
///
/// A replace rather than a merge: the caller sent the whole set, so anything
/// absent from it was removed on purpose. Doing this inside the caller's
/// transaction is what keeps an item from being visible with half its tags.
///
/// Unknown codes are refused with the codes named. The alternative — letting
/// the foreign key fire — produces a 500 and a constraint name, which tells a
/// buyer who mistyped a tag nothing at all.
async fn replace_supplier_item_tags(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    supplier_item_id: Uuid,
    tags: &[String],
) -> Result<Vec<String>, AppError> {
    sqlx::query("DELETE FROM supplier_item_tag WHERE supplier_item_id = $1")
        .bind(supplier_item_id)
        .execute(&mut **transaction)
        .await?;
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    let known: Vec<String> = sqlx::query_scalar("SELECT code FROM tag WHERE code = ANY($1)")
        .bind(tags)
        .fetch_all(&mut **transaction)
        .await?;
    let unknown: Vec<&str> = tags
        .iter()
        .filter(|tag| !known.contains(tag))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::Validation(format!(
            "unknown tag codes: {}",
            unknown.join(", ")
        )));
    }
    sqlx::query(
        "INSERT INTO supplier_item_tag (supplier_item_id, tag_code)
         SELECT $1, code FROM unnest($2::text[]) AS code",
    )
    .bind(supplier_item_id)
    .bind(tags)
    .execute(&mut **transaction)
    .await?;
    let mut applied = tags.to_vec();
    applied.sort();
    Ok(applied)
}

/// The colours an item comes in, replaced wholesale.
///
/// The same shape as the tag writer, and unknown codes are refused the same
/// way: letting the foreign key fire produces a 500 and a constraint name,
/// which tells whoever mistyped a colour nothing at all.
///
/// Returns what a read would now return — labelled and in the master's own
/// order — rather than the codes that went in, so a caller does not have to
/// re-read the row to answer the request it just served.
async fn replace_supplier_item_colours(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    supplier_item_id: Uuid,
    colours: &[String],
) -> Result<Vec<SupplierItemColour>, AppError> {
    sqlx::query("DELETE FROM supplier_item_colour WHERE supplier_item_id = $1")
        .bind(supplier_item_id)
        .execute(&mut **transaction)
        .await?;
    if colours.is_empty() {
        return Ok(Vec::new());
    }
    let known: Vec<String> = sqlx::query_scalar("SELECT code FROM colour WHERE code = ANY($1)")
        .bind(colours)
        .fetch_all(&mut **transaction)
        .await?;
    let unknown: Vec<&str> = colours
        .iter()
        .filter(|code| !known.contains(code))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::Validation(format!(
            "unknown colour codes: {}",
            unknown.join(", ")
        )));
    }
    sqlx::query(
        "INSERT INTO supplier_item_colour (supplier_item_id, colour_code)
         SELECT $1, code FROM unnest($2::text[]) AS code
         ON CONFLICT DO NOTHING",
    )
    .bind(supplier_item_id)
    .bind(colours)
    .execute(&mut **transaction)
    .await?;
    let rows = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT c.code, c.label, c.hex_code
           FROM supplier_item_colour sc
           JOIN colour c ON c.code = sc.colour_code
          WHERE sc.supplier_item_id = $1
          ORDER BY c.display_order, c.label",
    )
    .bind(supplier_item_id)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(colour_code, label, hex_code)| SupplierItemColour {
            colour_code,
            label,
            hex_code,
        })
        .collect())
}

/// The sizes an item comes in, replaced wholesale. Returned in size order,
/// which is what lets a screen print the ends of the range without sorting.
async fn replace_supplier_item_sizes(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    supplier_item_id: Uuid,
    sizes: &[String],
) -> Result<Vec<String>, AppError> {
    sqlx::query("DELETE FROM supplier_item_size WHERE supplier_item_id = $1")
        .bind(supplier_item_id)
        .execute(&mut **transaction)
        .await?;
    if sizes.is_empty() {
        return Ok(Vec::new());
    }
    let known: Vec<String> = sqlx::query_scalar("SELECT code FROM size_code WHERE code = ANY($1)")
        .bind(sizes)
        .fetch_all(&mut **transaction)
        .await?;
    let unknown: Vec<&str> = sizes
        .iter()
        .filter(|code| !known.iter().any(|one| one.trim() == code.as_str()))
        .map(String::as_str)
        .collect();
    if !unknown.is_empty() {
        return Err(AppError::Validation(format!(
            "unknown size codes: {}",
            unknown.join(", ")
        )));
    }
    sqlx::query(
        "INSERT INTO supplier_item_size (supplier_item_id, size_code)
         SELECT $1, code FROM unnest($2::text[]) AS code
         ON CONFLICT DO NOTHING",
    )
    .bind(supplier_item_id)
    .bind(sizes)
    .execute(&mut **transaction)
    .await?;
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT z.code FROM supplier_item_size ss
           JOIN size_code z ON z.code = ss.size_code
          WHERE ss.supplier_item_id = $1
          ORDER BY z.display_order, z.code",
    )
    .bind(supplier_item_id)
    .fetch_all(&mut **transaction)
    .await?;
    Ok(rows
        .into_iter()
        .map(|code| code.trim().to_owned())
        .collect())
}

/// One word the catalogue is allowed to use, and what it reads as.
///
/// `code` is what the database stores and what filters address; `label` is
/// what a person sees. Sending only the code — which is what the sourcing
/// screen had — puts `KAUS_KAKI` in front of a buyer and makes the catalogue
/// look like a database table. Sending only the label would be worse: two
/// labels can be edited to read alike, and a filter cannot address a word.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct VocabularyTerm {
    pub code: String,
    pub label: String,
}

/// The words a catalogue may be described with.
///
/// One request rather than two, because a screen that filters by both needs
/// both before it can draw either, and because they are read together often
/// enough that splitting them only buys a second round trip.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogueVocabulary {
    /// In `display_order`, which is the order the business thinks in — not
    /// alphabetical, which would put Accessories before Menswear.
    pub divisions: Vec<VocabularyTerm>,
    pub tags: Vec<VocabularyTerm>,
    /// The sizes anything may be offered in, in size order — which is what
    /// makes "S–XXL" the first and last of a list rather than a sort every
    /// reader has to redo.
    ///
    /// Here rather than behind an endpoint of its own because there was no
    /// endpoint at all: `frontend-hub` transcribed the `size_code` seed into a
    /// hardcoded map, with a comment saying it would be replaced by exactly
    /// this. A size added to the table after that was written filtered
    /// correctly and read as `21`.
    ///
    /// Colours are NOT here. They have their own master and their own
    /// endpoint (`/api/v1/colours`), a screen that draws swatches already
    /// reads it, and a second half-copy of a table this app can edit is the
    /// split the colour master exists to prevent.
    pub sizes: Vec<VocabularyTerm>,
}

/// Read the vocabulary. Inactive terms are left out: a filter offering a word
/// nothing can be classified as is a dead end a buyer has to discover by
/// clicking it.
pub async fn catalogue_vocabulary(pool: &PgPool) -> Result<CatalogueVocabulary, AppError> {
    // These small dictionaries share one request and one database snapshot.
    // Their own display orders are retained; no article/SKU usage is needed.
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT kind,code,label FROM (
             SELECT 'divisions'::text AS kind,code::text,label,display_order,
                    label AS sort_label FROM division WHERE active
             UNION ALL
             SELECT 'tags',code::text,label,0,label FROM tag WHERE active
             UNION ALL
             SELECT 'sizes',btrim(code)::text,label,display_order,code::text
             FROM size_code WHERE active
         ) terms ORDER BY kind,display_order,sort_label,code",
    )
    .fetch_all(pool)
    .await?;
    let mut result = CatalogueVocabulary {
        divisions: Vec::new(),
        tags: Vec::new(),
        sizes: Vec::new(),
    };
    for (kind, code, label) in rows {
        let term = VocabularyTerm { code, label };
        match kind.as_str() {
            "divisions" => result.divisions.push(term),
            "tags" => result.tags.push(term),
            "sizes" => result.sizes.push(term),
            _ => unreachable!("the vocabulary query names only three dictionaries"),
        }
    }
    Ok(result)
}
