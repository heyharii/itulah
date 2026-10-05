//! The palette's record search: one ranked list across every kind of record.
//!
//! The ranking lives in the `global_search` SQL function (migration 0725), so
//! it is one rule for every caller. This file only reads it; whether the
//! caller may see a kind is decided by the handler, not by the database.

use crate::cloud::application::AppError;
use serde::Serialize;
use sqlx::{PgPool, Row};

/// One record the search found.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct SearchHit {
    /// What it is: `purchase_order` or `supplier`. The screen maps this to a route.
    pub kind: String,
    /// The record's own id, as text.
    pub record_id: String,
    /// What the palette prints: the PO number.
    pub title: String,
    pub subtitle: String,
}

/// Records matching `needle`, best first. A blank or one-character needle
/// finds nothing, by the function's own rule. `kinds` limits the answer to
/// what the caller may open.
pub async fn global_search(
    pool: &PgPool,
    needle: &str,
    kinds: &[&str],
    limit: i32,
) -> Result<Vec<SearchHit>, AppError> {
    let kinds: Vec<String> = kinds.iter().map(|kind| (*kind).to_owned()).collect();
    let rows = sqlx::query(
        "SELECT kind, record_id, title, subtitle FROM global_search($1, $2)
         WHERE kind = ANY($3)",
    )
    .bind(needle)
    .bind(limit)
    .bind(&kinds)
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(SearchHit {
                kind: row.try_get("kind")?,
                record_id: row.try_get("record_id")?,
                title: row.try_get("title")?,
                subtitle: row.try_get("subtitle")?,
            })
        })
        .collect::<Result<_, sqlx::Error>>()
        .map_err(Into::into)
}
