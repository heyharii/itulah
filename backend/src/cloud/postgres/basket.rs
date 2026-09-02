//! The buyer's basket: what somebody has picked out, before it is an order.
//!
//! Until now this lived in `localStorage`, which made it a property of a
//! browser rather than of a person — it did not follow a buyer to a second
//! machine, it did not survive clearing site data, and the server could not see
//! it at all. See `migrations/postgres/0039_sourcing_basket.sql` for why it is
//! one basket per person rather than one per team.
//!
//! Nothing here is idempotency-keyed, and that is deliberate. Every other write
//! in the catalogue creates a fact that must not be created twice; these change
//! a working set that only its owner can see, and the shapes are already safe
//! to repeat — adding twice is what a shopper means by two, setting a quantity
//! twice sets it once, removing something absent removes nothing.

use super::suppliers::{sourced_item_from_row, SourcedItem};
use crate::cloud::{
    application::AppError,
    domain::{Supplier, SupplierItem, SupplierStatus},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// One line of a basket: the candidate, and how many of it.
///
/// The whole `SourcedItem` is carried rather than an id, for the same reason
/// the sourcing list carries it: a basket that only knew ids would have the
/// browser fetch the catalogue again and stitch the two together, which is a
/// second place for "what is this item" to be decided.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct BasketLine {
    pub item: SupplierItem,
    pub supplier: Supplier,
    pub quantity: i64,
    pub added_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct AddToBasketRequest {
    pub supplier_item_id: Uuid,
    /// Defaults to one, the way picking something up does.
    #[serde(default = "one")]
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SetBasketQuantityRequest {
    /// Zero removes the line. A basket line with nothing on it is not a line.
    pub quantity: i64,
}

const fn one() -> i64 {
    1
}

/// Bounded for the same reason the sourcing search is: a basket is a working
/// set somebody is about to turn into an order, not a wishlist of everything.
const MAX_BASKET_LINES: i64 = 200;

/// A quantity nobody could have meant.
///
/// Rejected here rather than at the database, so the buyer is told what was
/// wrong with the number instead of being handed a constraint violation.
fn validate_quantity(quantity: i64) -> Result<(), AppError> {
    if quantity <= 0 {
        return Err(AppError::Validation(
            "quantity must be at least one; remove the line instead".into(),
        ));
    }
    if quantity > 1_000_000 {
        return Err(AppError::Validation(
            "quantity is larger than any real order".into(),
        ));
    }
    Ok(())
}

/// Aliased exactly as `sourced_item_from_row` requires — the item and the
/// supplier share four column names, so the supplier's are prefixed.
///
/// The basket's own columns are prefixed for the same reason and it is not
/// theoretical: `supplier_item` also has an `updated_at`, and with both
/// unaliased a freshly added line reported the ITEM's timestamp as its own —
/// an `updated_at` older than its `added_at`, which is not a state that can
/// exist. A duplicate column name in a join does not fail, it answers with the
/// wrong column.
const BASKET_SELECT: &str = "SELECT b.quantity AS b_quantity,
            b.added_at AS b_added_at, b.updated_at AS b_updated_at,
            i.*,
            COALESCE(
                (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                   FROM supplier_item_tag t
                  WHERE t.supplier_item_id = i.supplier_item_id),
                '{}'
            ) AS tags,
            s.supplier_id AS s_supplier_id, s.supplier_code AS s_supplier_code,
            s.supplier_code_normalized AS s_supplier_code_normalized, s.name AS s_name,
            s.contact_name AS s_contact_name, s.phone AS s_phone, s.email AS s_email,
            s.address AS s_address, s.status AS s_status, s.version AS s_version,
            s.created_by AS s_created_by, s.created_at AS s_created_at,
            s.updated_by AS s_updated_by, s.updated_at AS s_updated_at
       FROM sourcing_basket_line b
       JOIN supplier_item i ON i.supplier_item_id = b.supplier_item_id
       JOIN supplier s ON s.supplier_id = i.supplier_id";

fn basket_line_from_row(row: sqlx::postgres::PgRow) -> Result<BasketLine, AppError> {
    let quantity: i64 = row.try_get("b_quantity")?;
    let added_at: DateTime<Utc> = row.try_get("b_added_at")?;
    let updated_at: DateTime<Utc> = row.try_get("b_updated_at")?;
    let SourcedItem { item, supplier, .. } = sourced_item_from_row(row)?;
    Ok(BasketLine {
        item,
        supplier,
        quantity,
        added_at,
        updated_at,
    })
}

/// Everything this buyer has picked out, oldest first.
///
/// Oldest first, not newest: a basket read top to bottom should tell the story
/// of the decision in the order it was made, and a list that reorders itself
/// every time you add something is one you cannot find anything in.
pub async fn read_basket(pool: &PgPool, owner: &str) -> Result<Vec<BasketLine>, AppError> {
    let rows = sqlx::query(&format!(
        "{BASKET_SELECT} WHERE b.owner_username = $1 ORDER BY b.added_at, i.name"
    ))
    .bind(owner)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(basket_line_from_row).collect()
}

async fn read_line(
    pool: &PgPool,
    owner: &str,
    supplier_item_id: Uuid,
) -> Result<BasketLine, AppError> {
    let row = sqlx::query(&format!(
        "{BASKET_SELECT} WHERE b.owner_username = $1 AND b.supplier_item_id = $2"
    ))
    .bind(owner)
    .bind(supplier_item_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("basket line".to_owned()))?;
    basket_line_from_row(row)
}

/// Put something in the basket, or more of it if it is already there.
///
/// Adding an item you already have raises the quantity rather than appending a
/// second line — which is what a person means by adding two of something, and
/// is enforced by the table's primary key rather than by a read-then-write that
/// two tabs could interleave.
pub async fn add_to_basket(
    pool: &PgPool,
    owner: &str,
    request: &AddToBasketRequest,
) -> Result<BasketLine, AppError> {
    validate_quantity(request.quantity)?;

    // An item that does not exist, and an item that exists but is withdrawn,
    // are different refusals and a buyer should be told which. An INACTIVE
    // candidate cannot be ordered, so letting it into the basket would only
    // defer the refusal to the moment the order is raised.
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM supplier_item WHERE supplier_item_id = $1")
            .bind(request.supplier_item_id)
            .fetch_optional(pool)
            .await?;
    match status.as_deref() {
        None => return Err(AppError::NotFound("supplier item".to_owned())),
        Some(value) if value != SupplierStatus::Active.as_str() => {
            return Err(AppError::Validation(
                "that item is on hold and cannot be ordered".into(),
            ))
        }
        Some(_) => {}
    }

    let held: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sourcing_basket_line WHERE owner_username = $1")
            .bind(owner)
            .fetch_one(pool)
            .await?;
    let already_held = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM sourcing_basket_line
                        WHERE owner_username = $1 AND supplier_item_id = $2)",
    )
    .bind(owner)
    .bind(request.supplier_item_id)
    .fetch_one(pool)
    .await?;
    if !already_held && held >= MAX_BASKET_LINES {
        return Err(AppError::Validation(format!(
            "a basket holds at most {MAX_BASKET_LINES} different items; raise an order from what is in it first"
        )));
    }

    sqlx::query(
        "INSERT INTO sourcing_basket_line
             (owner_username, supplier_item_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (owner_username, supplier_item_id) DO UPDATE
             SET quantity = sourcing_basket_line.quantity + EXCLUDED.quantity,
                 updated_at = now()",
    )
    .bind(owner)
    .bind(request.supplier_item_id)
    .bind(request.quantity)
    .execute(pool)
    .await?;

    read_line(pool, owner, request.supplier_item_id).await
}

/// Say exactly how many, the way a quantity box does.
///
/// Returns `None` when the answer was zero, because zero is a removal and the
/// caller has to answer with something other than a line that no longer exists.
pub async fn set_basket_quantity(
    pool: &PgPool,
    owner: &str,
    supplier_item_id: Uuid,
    quantity: i64,
) -> Result<Option<BasketLine>, AppError> {
    if quantity == 0 {
        remove_from_basket(pool, owner, supplier_item_id).await?;
        return Ok(None);
    }
    validate_quantity(quantity)?;
    let changed = sqlx::query(
        "UPDATE sourcing_basket_line SET quantity = $3, updated_at = now()
          WHERE owner_username = $1 AND supplier_item_id = $2",
    )
    .bind(owner)
    .bind(supplier_item_id)
    .bind(quantity)
    .execute(pool)
    .await?
    .rows_affected();
    if changed == 0 {
        return Err(AppError::NotFound("basket line".to_owned()));
    }
    Ok(Some(read_line(pool, owner, supplier_item_id).await?))
}

/// Take one thing out. Removing something that is not there is not an error:
/// the basket ends up in the state the caller asked for either way.
pub async fn remove_from_basket(
    pool: &PgPool,
    owner: &str,
    supplier_item_id: Uuid,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM sourcing_basket_line
          WHERE owner_username = $1 AND supplier_item_id = $2",
    )
    .bind(owner)
    .bind(supplier_item_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Take several things out at once — what raising an order from the basket
/// does with the lines that became the order.
///
/// One statement rather than a loop: a buyer who ordered six of the eight
/// things in their basket should not be able to end up with three of them
/// removed because the connection dropped halfway.
pub async fn remove_many(
    pool: &PgPool,
    owner: &str,
    supplier_item_ids: &[Uuid],
) -> Result<u64, AppError> {
    if supplier_item_ids.is_empty() {
        return Ok(0);
    }
    let removed = sqlx::query(
        "DELETE FROM sourcing_basket_line
          WHERE owner_username = $1 AND supplier_item_id = ANY($2)",
    )
    .bind(owner)
    .bind(supplier_item_ids)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(removed)
}

/// Empty it.
pub async fn clear_basket(pool: &PgPool, owner: &str) -> Result<u64, AppError> {
    let removed = sqlx::query("DELETE FROM sourcing_basket_line WHERE owner_username = $1")
        .bind(owner)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(removed)
}
