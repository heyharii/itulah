//! Unmatched sales (owner, 23 Oct 2026; `docs/unmatched-sales-contract.md`).
//!
//! A piece the till cannot take from its own store's stock still sells, and
//! the sale belongs to the store where the shopper paid. The line lands here
//! OPEN from the sale fact (`sync::apply_sale`); head office matches it to one
//! piece of a SKU at a place, and that piece leaves that place's stock:
//!
//! - a place whose ledger the centre keeps (head office, a shop without a
//!   server): a SALE movement here, to `external/customer`;
//! - a shop with its own server: `inventory.unmatched_sale.take.v1` to its
//!   node, which writes the movement itself and sends it up like any other.

use super::sync::{inventory_owner_tx, issue_command_tx, origin_site_id_tx, origin_takes_tx};
use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use crate::cloud::application::AppError;
use crate::cloud::domain::{
    validate_command, MovementCause, MovementCommand, MovementGroupId, MovementLine, Place,
    SubjectId,
};
use crate::sync::unmatched::{
    UnmatchedSaleTakePayload, INVENTORY_UNMATCHED_SALE_TAKE_V1, UNMATCHED_SALE_REFERENCE,
    UNMATCHED_SALE_TAKE_CAPABILITY,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// The places a sale may take a piece from: a site's floor or its stockroom,
/// on hand (`Place::is_sale_source`), as a place id spells them.
const SALE_SOURCE_PLACE: &str = r"^[^.]+\.(floor|warehouse):on_hand$";

/// One row of the screen, every name resolved. `$1` status or NULL, `$2` site
/// or NULL, `$3` line id or NULL.
const ROWS: &str = "
    SELECT u.id, u.site_id, COALESCE(st.name, u.site_id) AS site_name, u.sold_at,
           COALESCE(u.receipt_no, 'POS-' || LEFT(u.sale_id::text, 8)) AS receipt_no,
           u.till,
           COALESCE(cp.full_name, cu.display_name, u.actor_id) AS cashier_name,
           u.kind, COALESCE(u.matched_sku_code, u.sku_code) AS sku_code,
           a.name AS article_name, sk.color AS colour, sk.size, u.name,
           u.line_total_minor AS price_minor,
           CASE WHEN u.priced_by IS NULL THEN NULL
                ELSE COALESCE(pp.full_name, pu.display_name, u.priced_by) END AS priced_by_name,
           u.status, u.match_doc, COALESCE(ms.name, u.matched_site_id) AS matched_site_name,
           u.matched_at,
           (SELECT c.unit_cost_minor FROM cost_layer c
             WHERE c.article_id = sk.article_id
             ORDER BY c.economic_date DESC, c.recorded_at DESC LIMIT 1) AS cost_minor
      FROM unmatched_sale_line u
      LEFT JOIN site st ON st.id = u.site_id
      LEFT JOIN app_user cu ON cu.username = u.actor_id
      LEFT JOIN employee_profile cp ON cp.employee_id = cu.employee_id
      LEFT JOIN app_user pu ON pu.username = u.priced_by
      LEFT JOIN employee_profile pp ON pp.employee_id = pu.employee_id
      LEFT JOIN sku sk ON sk.sku_code = COALESCE(u.matched_sku_code, u.sku_code)
      LEFT JOIN article a ON a.id = sk.article_id
      LEFT JOIN site ms ON ms.id = u.matched_site_id
     WHERE ($1::text IS NULL OR u.status = $1)
       AND ($2::text IS NULL OR u.site_id = $2)
       AND ($3::uuid IS NULL OR u.id = $3)
     ORDER BY u.sold_at, u.id
     LIMIT 2000";

#[derive(Clone, Debug, Serialize)]
pub struct UnmatchedSaleRow {
    pub id: Uuid,
    pub site_id: String,
    pub site_name: String,
    pub sold_at: DateTime<Utc>,
    pub receipt_no: String,
    pub till: Option<String>,
    pub cashier_name: Option<String>,
    pub kind: String,
    pub sku_code: Option<String>,
    pub article_name: Option<String>,
    pub colour: Option<String>,
    pub size: Option<String>,
    pub name: Option<String>,
    pub price_minor: i64,
    pub priced_by_name: Option<String>,
    pub status: String,
    /// "Transfer from {place}" · "Own stock" · "Count · {doc}".
    pub matched_with: Option<String>,
    pub matched_at: Option<DateTime<Utc>>,
    pub cost_minor: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct UnmatchedPlace {
    pub site_id: String,
    pub name: String,
    pub is_ho: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct UnmatchedStockRow {
    pub sku_code: String,
    pub article_name: String,
    pub colour: Option<String>,
    pub size: Option<String>,
    pub on_hand: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MatchUnmatchedRequest {
    pub site_id: String,
    pub sku_code: String,
    pub idempotency_key: String,
}

/// `open|matched|found` (any case) to the column's spelling. Absent is every
/// status.
pub fn unmatched_status(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };
    let upper = raw.to_ascii_uppercase();
    match upper.as_str() {
        "OPEN" | "MATCHED" | "FOUND" => Ok(Some(upper)),
        _ => Err(AppError::Validation(format!(
            "status is open, matched or found, not {raw:?}"
        ))),
    }
}

fn row_of(row: &sqlx::postgres::PgRow) -> Result<UnmatchedSaleRow, AppError> {
    let status: String = row.try_get("status")?;
    let doc: Option<String> = row.try_get("match_doc")?;
    let place: Option<String> = row.try_get("matched_site_name")?;
    let matched_with = match status.as_str() {
        "MATCHED" if doc.as_deref() == Some(OWN_STOCK) => Some(OWN_STOCK.to_owned()),
        "MATCHED" => Some(format!(
            "Transfer from {}",
            place.unwrap_or_else(|| "another place".into())
        )),
        "FOUND" => Some(format!("Count · {}", doc.unwrap_or_default())),
        _ => None,
    };
    Ok(UnmatchedSaleRow {
        id: row.try_get("id")?,
        site_id: row.try_get("site_id")?,
        site_name: row.try_get("site_name")?,
        sold_at: row.try_get("sold_at")?,
        receipt_no: row.try_get("receipt_no")?,
        till: row.try_get("till")?,
        cashier_name: row.try_get("cashier_name")?,
        kind: row.try_get("kind")?,
        sku_code: row.try_get("sku_code")?,
        article_name: row.try_get("article_name")?,
        colour: row.try_get("colour")?,
        size: row.try_get("size")?,
        name: row.try_get("name")?,
        price_minor: row.try_get("price_minor")?,
        priced_by_name: row.try_get("priced_by_name")?,
        status,
        matched_with,
        matched_at: row.try_get("matched_at")?,
        cost_minor: row.try_get("cost_minor")?,
    })
}

const OWN_STOCK: &str = "Own stock";

/// The lines of one status (or all), optionally of one selling store.
pub async fn list_unmatched_sales(
    pool: &PgPool,
    status: Option<&str>,
    site_id: Option<&str>,
) -> Result<Vec<UnmatchedSaleRow>, AppError> {
    let site_id = site_id.map(str::trim).filter(|site| !site.is_empty());
    let rows = sqlx::query(ROWS)
        .bind(status)
        .bind(site_id)
        .bind(None::<Uuid>)
        .fetch_all(pool)
        .await?;
    rows.iter().map(row_of).collect()
}

/// Where a piece can be taken from: head office first, then the stores A–Z.
pub async fn unmatched_places(pool: &PgPool) -> Result<Vec<UnmatchedPlace>, AppError> {
    let rows = sqlx::query(
        "SELECT id, name, kind = 'HO' AS is_ho FROM site
          WHERE kind IN ('HO', 'STORE')
          ORDER BY (kind = 'HO') DESC, lower(name), id",
    )
    .fetch_all(pool)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(UnmatchedPlace {
                site_id: row.try_get("id")?,
                name: row.try_get("name")?,
                is_ho: row.try_get("is_ho")?,
            })
        })
        .collect()
}

/// What a place holds on hand that a sale may take, per SKU, as the centre
/// sees it: its own ledger, or the node's last upload for a shop that keeps
/// its own.
pub async fn unmatched_stock(
    pool: &PgPool,
    site_id: &str,
) -> Result<Vec<UnmatchedStockRow>, AppError> {
    let site_id = site_id.trim();
    if site_id.is_empty() {
        return Err(AppError::Validation("say which place's stock".into()));
    }
    let mut tx = pool.begin().await?;
    let owner = inventory_owner_tx(&mut tx, site_id).await?;
    let rows = match owner.as_deref() {
        Some(origin_id) => {
            sqlx::query(
                "SELECT fp.sku_code, a.name AS article_name, k.color AS colour, k.size,
                        SUM(fp.quantity)::bigint AS on_hand
                   FROM edge_inventory_fact_position fp
                   JOIN sku k ON k.sku_code = fp.sku_code
                   JOIN article a ON a.id = k.article_id
                  WHERE fp.origin_id = $1 AND fp.place_id ~ $2
                  GROUP BY fp.sku_code, a.name, k.color, k.size
                 HAVING SUM(fp.quantity) > 0
                  ORDER BY a.name, fp.sku_code",
            )
            .bind(origin_id)
            .bind(SALE_SOURCE_PLACE)
            .fetch_all(&mut *tx)
            .await?
        }
        None => {
            sqlx::query(
                "SELECT k.sku_code, a.name AS article_name, k.color AS colour, k.size,
                        SUM(pr.quantity)::bigint AS on_hand
                   FROM inventory_projection pr
                   JOIN inventory_place pl ON pl.id = pr.place_id
                   JOIN operational_pool op ON op.id = pl.pool_id
                   JOIN inventory_subject su ON su.id = pr.subject_id
                   JOIN sku k ON k.id = su.sku_id
                   JOIN article a ON a.id = k.article_id
                  WHERE op.site_id = $1 AND pr.place_id ~ $2
                  GROUP BY k.sku_code, a.name, k.color, k.size
                 HAVING SUM(pr.quantity) > 0
                  ORDER BY a.name, k.sku_code",
            )
            .bind(site_id)
            .bind(SALE_SOURCE_PLACE)
            .fetch_all(&mut *tx)
            .await?
        }
    };
    tx.commit().await?;
    rows.iter()
        .map(|row| {
            Ok(UnmatchedStockRow {
                sku_code: row.try_get("sku_code")?,
                article_name: row.try_get("article_name")?,
                colour: row.try_get("colour")?,
                size: row.try_get("size")?,
                on_hand: row.try_get("on_hand")?,
            })
        })
        .collect()
}

/// Match one OPEN line to one piece of `sku_code` on hand at `site_id`.
pub async fn match_unmatched_sale(
    pool: &PgPool,
    line_id: Uuid,
    request: MatchUnmatchedRequest,
    actor: &str,
    now: DateTime<Utc>,
) -> Result<Value, AppError> {
    let site_id = request.site_id.trim().to_owned();
    let sku_code = request.sku_code.trim().to_owned();
    if site_id.is_empty() || sku_code.is_empty() {
        return Err(AppError::Validation(
            "a match names the place and the SKU".into(),
        ));
    }
    let digest = payload_digest(&(line_id, &request))?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "MATCH_UNMATCHED_SALE",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let line = sqlx::query(
        "SELECT sale_id, site_id, status, receipt_no FROM unmatched_sale_line
          WHERE id = $1 FOR UPDATE",
    )
    .bind(line_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("an unmatched sale".into()))?;
    let status: String = line.try_get("status")?;
    if status != "OPEN" {
        return Err(AppError::Conflict(
            "this sale has already been matched".into(),
        ));
    }
    let sale_id: Uuid = line.try_get("sale_id")?;
    let sold_at_site: String = line.try_get("site_id")?;
    let receipt_no: Option<String> = line.try_get("receipt_no")?;
    let place_name: String = sqlx::query_scalar("SELECT name FROM site WHERE id = $1")
        .bind(&site_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("place {site_id}")))?;
    if sqlx::query("SELECT 1 FROM sku WHERE sku_code = $1")
        .bind(&sku_code)
        .fetch_optional(&mut *tx)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound(format!("SKU {sku_code}")));
    }
    let nothing_there = || {
        AppError::Conflict(format!(
            "{place_name} holds no {sku_code} on hand to take"
        ))
    };

    let (matched_epc, movement_group_id, command_id): (Option<String>, Option<Uuid>, Option<Uuid>) =
        match inventory_owner_tx(&mut tx, &site_id).await? {
        // A shop with its own server: its node lets the piece go.
        Some(origin_id) => {
            if !origin_takes_tx(&mut tx, &origin_id, UNMATCHED_SALE_TAKE_CAPABILITY).await? {
                return Err(AppError::Conflict(format!(
                    "{place_name}'s server needs an update before head office can take a piece from it"
                )));
            }
            let piece = sqlx::query(
                "SELECT epc FROM edge_inventory_fact_position
                  WHERE origin_id = $1 AND sku_code = $2 AND place_id ~ $3
                  ORDER BY (place_id LIKE '%.floor:on_hand') DESC, epc NULLS LAST, updated_at
                  LIMIT 1",
            )
            .bind(&origin_id)
            .bind(&sku_code)
            .bind(SALE_SOURCE_PLACE)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(nothing_there)?;
            let epc: Option<String> = piece.try_get("epc")?;
            let payload = UnmatchedSaleTakePayload {
                take_id: line_id,
                site_id: origin_site_id_tx(&mut tx, &origin_id).await?,
                sku_code: sku_code.clone(),
                epc: epc.clone(),
                sale_id,
                sold_at_site_id: sold_at_site.clone(),
                receipt_no: receipt_no.clone(),
                matched_by: actor.to_owned(),
            };
            let command_id = issue_command_tx(
                &mut tx,
                INVENTORY_UNMATCHED_SALE_TAKE_V1,
                &serde_json::to_value(&payload)?,
                actor,
                None,
                std::slice::from_ref(&origin_id),
            )
            .await?;
            (epc, None, Some(command_id))
        }
        // The centre keeps this place's ledger: the SALE movement is written
        // here, in this transaction.
        None => {
            let piece = sqlx::query(
                "SELECT pr.subject_id, pr.place_id, su.epc
                   FROM inventory_projection pr
                   JOIN inventory_place pl ON pl.id = pr.place_id
                   JOIN operational_pool op ON op.id = pl.pool_id
                   JOIN inventory_subject su ON su.id = pr.subject_id
                   JOIN sku k ON k.id = su.sku_id
                  WHERE op.site_id = $1 AND k.sku_code = $2 AND pr.place_id ~ $3
                  ORDER BY (pr.place_id LIKE '%.floor:on_hand') DESC, su.epc NULLS LAST,
                           pr.updated_at
                  LIMIT 1",
            )
            .bind(&site_id)
            .bind(&sku_code)
            .bind(SALE_SOURCE_PLACE)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(nothing_there)?;
            let subject_id: Uuid = piece.try_get("subject_id")?;
            let place_id: String = piece.try_get("place_id")?;
            let epc: Option<String> = piece.try_get("epc")?;
            let from: Place = place_id
                .parse()
                .map_err(|e: crate::cloud::domain::PlaceError| AppError::Validation(e.to_string()))?;
            let to: Place = "external/customer"
                .parse()
                .map_err(|e: crate::cloud::domain::PlaceError| AppError::Validation(e.to_string()))?;
            let group_id = Uuid::new_v4();
            let command = MovementCommand {
                movement_group_id: MovementGroupId(group_id),
                lines: vec![MovementLine {
                    subject_id: SubjectId(subject_id),
                    quantity: 1,
                    from,
                    to,
                }],
                cause: MovementCause::Sale,
                reference_type: Some(UNMATCHED_SALE_REFERENCE.into()),
                reference_id: Some(line_id.to_string()),
                reason: format!(
                    "Unmatched sale {} at {sold_at_site}, matched by head office",
                    receipt_no.clone().unwrap_or_else(|| sale_id.to_string())
                ),
                actor_id: actor.to_owned(),
                occurred_at: now,
            };
            validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
            // One take per line, ever: the key cannot collide with another.
            let movement_key = format!("unmatched-sale:{line_id}:take");
            insert_group(&mut tx, &command, &movement_key, &digest).await?;
            apply_lines(&mut tx, &command, &movement_key, &digest).await?;
            (epc, Some(group_id), None)
        }
    };

    let match_doc = if site_id == sold_at_site {
        OWN_STOCK.to_owned()
    } else {
        let next: i64 = sqlx::query_scalar("SELECT nextval('unmatched_sale_transfer_no')")
            .fetch_one(&mut *tx)
            .await?;
        format!("TRF-{next:04}")
    };
    sqlx::query(
        "UPDATE unmatched_sale_line
            SET status = 'MATCHED', matched_site_id = $2, matched_sku_code = $3,
                matched_epc = $4, match_doc = $5, matched_by = $6, matched_at = $7,
                movement_group_id = $8, match_command_id = $9
          WHERE id = $1",
    )
    .bind(line_id)
    .bind(&site_id)
    .bind(&sku_code)
    .bind(matched_epc.as_deref())
    .bind(&match_doc)
    .bind(actor)
    .bind(now)
    .bind(movement_group_id)
    .bind(command_id)
    .execute(&mut *tx)
    .await?;
    let row = sqlx::query(ROWS)
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(Some(line_id))
        .fetch_one(&mut *tx)
        .await?;
    let response = json!(row_of(&row)?);
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}
