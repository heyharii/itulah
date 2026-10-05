//! Returns to a supplier from HO return stock, and how each one is settled.
//!
//! # What a supplier return is
//!
//! A `RETURN_TO_SUPPLIER` allotment — the Gudang picks it and hands it over
//! like any other outbound work — plus the terms Buying agreed with the
//! supplier (`supplier_return`): why it goes back and how the supplier will
//! make it good. The allotment carries the goods; this module carries the
//! money owed back for them.
//!
//! An over-delivery is not one of these. Goods beyond a PO were never ours to
//! pay for, so nothing is owed back; they go on a `purchase_return` raised
//! from the order (`purchase_returns.rs`).
//!
//! # The surat
//!
//! Confirming a return issues its surat in the same transaction: a
//! `SUPPLIER_RETURN` letter (`letters.rs`), numbered in the SJR series, drawn
//! from the allotment the goods leave on. It is the paper the supplier counts
//! and signs against — the reason, the person in charge and the QR that opens
//! the letter in the register print on it.
//!
//! # Settled in rupiah
//!
//! The return's value is fixed when it is raised, at what the goods were
//! bought for (the newest purchase order line of the article, through the
//! receipt it was set up from — the path `sku_suppliers` reads). The supplier
//! may answer in any mix: replacement goods (valued at the same cost),
//! a refund, a credit note. Each answer is a row in
//! `supplier_return_settlement`, written once. The return is settled when
//! they add up to its value; Buying may close it short before that, and what
//! is left is a loss.
//!
//! # Who writes what
//!
//! Buying raises the return and closes it short. Replacements are recorded by
//! Receiving when they are counted in; refunds and credit notes by Finance
//! when they book them. The endpoint does not tell them apart by role — the
//! route's role does, and the record keeps who wrote it.

use crate::cloud::application::{AppError, CreateAllotmentLineInput, CreateAllotmentRequest};
use crate::cloud::domain::{flow::Actor, AllotmentType, DestinationType};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use uuid::Uuid;

/// Why a return goes back, as the owner set it (2026-10-04): more came than
/// was ordered, or what came is not what the order said. The older three —
/// DEFECT, WRONG_ITEM, UNSOLD — all read as one of these two; migration 0828
/// moved the rows.
const REASONS: [&str; 2] = ["OVER_DELIVERY", "ITEM_MISMATCH"];
const SETTLE_BY: [&str; 3] = ["REPLACEMENT", "REFUND", "CREDIT_NOTE"];

#[derive(Clone, Debug, Deserialize)]
pub struct NewSupplierReturnLine {
    pub sku_code: String,
    pub quantity: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct NewSupplierReturn {
    pub supplier_id: String,
    pub reason: String,
    pub settle_by: String,
    /// The HO return-stock pool the goods leave from.
    pub source_pool_id: String,
    pub lines: Vec<NewSupplierReturnLine>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct NewSettlement {
    pub kind: String,
    /// REPLACEMENT: pieces counted in.
    #[serde(default)]
    pub quantity: Option<i64>,
    /// REFUND and CREDIT_NOTE: rupiah, in minor units.
    #[serde(default)]
    pub amount_minor: Option<i64>,
    /// The goods receipt, BKM or credit note number.
    #[serde(default)]
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CloseShortRequest {
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupplierReturnLine {
    pub sku_code: String,
    pub article_code: String,
    pub article_name: Option<String>,
    pub quantity: i64,
    pub unit_cost_minor: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupplierReturnSettlement {
    pub kind: String,
    pub quantity: Option<i64>,
    pub amount_minor: i64,
    pub reference: Option<String>,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupplierReturnView {
    pub allotment_id: Uuid,
    pub allotment_number: String,
    pub supplier_id: String,
    pub supplier_name: Option<String>,
    pub reason: String,
    pub settle_by: String,
    /// TO_HAND_OVER · WAITING · PARTLY_SETTLED · SETTLED · CLOSED_SHORT
    pub status: String,
    pub quantity: i64,
    pub value_minor: i64,
    pub settled_minor: i64,
    /// What the supplier still owes; nought once settled or closed short.
    pub owed_minor: i64,
    pub note: Option<String>,
    pub raised_by: String,
    pub raised_at: DateTime<Utc>,
    /// When the Gudang had nothing left to do on it.
    pub handed_over_at: Option<DateTime<Utc>>,
    pub closed_short_reason: Option<String>,
    /// The surat issued when the return was confirmed: the numbered return
    /// delivery note the supplier signs against. `None` only for returns
    /// raised before 0828 or whose letter was voided.
    pub letter_id: Option<Uuid>,
    pub letter_number: Option<String>,
    pub lines: Vec<SupplierReturnLine>,
    pub settlements: Vec<SupplierReturnSettlement>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SupplierReturnList {
    pub items: Vec<SupplierReturnView>,
}

fn one_of(value: &str, allowed: &[&str], what: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_uppercase();
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(AppError::Validation(format!(
            "{what} must be one of {}",
            allowed.join(", ")
        )))
    }
}

/// Raise a return to a supplier: the allotment that moves the goods, and the
/// terms it is settled on.
pub async fn raise_supplier_return(
    pool: &PgPool,
    request: NewSupplierReturn,
    actor: &Actor,
) -> Result<SupplierReturnView, AppError> {
    let reason = one_of(&request.reason, &REASONS, "reason")?;
    let settle_by = one_of(&request.settle_by, &SETTLE_BY, "settle_by")?;
    let supplier_id = request.supplier_id.trim().to_owned();
    if supplier_id.is_empty() {
        return Err(AppError::Validation("supplier_id is required".into()));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation("a return needs at least one line".into()));
    }
    let source_pool_id = request.source_pool_id.trim().to_ascii_lowercase();
    let site_id: String = sqlx::query("SELECT site_id FROM operational_pool WHERE id = $1")
        .bind(&source_pool_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Validation(format!("no pool {source_pool_id}")))?
        .get("site_id");

    // SKU ids, and the cost each was bought at.
    let codes: Vec<String> = request
        .lines
        .iter()
        .map(|line| line.sku_code.trim().to_uppercase())
        .collect();
    let rows = sqlx::query(
        "SELECT DISTINCT ON (s.sku_code) s.sku_code, s.id AS sku_id,
                COALESCE(order_line.unit_price_minor, 0)::bigint AS unit_cost_minor
         FROM sku s
         JOIN article a ON a.id = s.article_id
         LEFT JOIN article_setup_session setup ON setup.article_code = a.article_code
         LEFT JOIN goods_receipt_line receipt ON receipt.receipt_line_id = setup.receipt_line_id
         LEFT JOIN purchase_order_line order_line ON order_line.po_line_id = receipt.po_line_id
         LEFT JOIN purchase_order po ON po.purchase_order_id = order_line.purchase_order_id
         WHERE s.sku_code = ANY($1)
         ORDER BY s.sku_code, po.created_at DESC NULLS LAST",
    )
    .bind(&codes)
    .fetch_all(pool)
    .await?;
    let known: HashMap<String, (Uuid, i64)> = rows
        .iter()
        .map(|row| {
            (
                row.get::<String, _>("sku_code"),
                (row.get("sku_id"), row.get("unit_cost_minor")),
            )
        })
        .collect();

    let mut lines = Vec::with_capacity(request.lines.len());
    for (line, code) in request.lines.iter().zip(&codes) {
        let (sku_id, _) = known
            .get(code)
            .ok_or_else(|| AppError::Validation(format!("unknown SKU {code}")))?;
        lines.push(CreateAllotmentLineInput {
            source_site_id: site_id.clone(),
            source_pool_id: source_pool_id.clone(),
            destination_type: DestinationType::Supplier,
            destination_id: "external/supplier".into(),
            sku_id: *sku_id,
            quantity: line.quantity,
        });
    }
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_owned);
    let created = super::create_allotment_as(
        pool,
        CreateAllotmentRequest {
            allotment_type: AllotmentType::ReturnToSupplier,
            lines,
            notes: note.clone(),
            actor_id: actor.id.clone(),
            idempotency_key: Uuid::new_v4().to_string(),
        },
        Some(actor),
    )
    .await?;
    let allotment_id: Uuid = created
        .get("id")
        .and_then(|id| id.as_str())
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(|| AppError::Conflict("the allotment came back without an id".into()))?;

    let supplier_name: Option<String> = sqlx::query(
        "SELECT name FROM supplier WHERE supplier_id::text = $1 OR supplier_code = $1 LIMIT 1",
    )
    .bind(&supplier_id)
    .fetch_optional(pool)
    .await?
    .map(|row| row.get("name"));

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO supplier_return
             (allotment_id, supplier_id, supplier_name, reason, settle_by, note, raised_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(allotment_id)
    .bind(&supplier_id)
    .bind(&supplier_name)
    .bind(&reason)
    .bind(&settle_by)
    .bind(&note)
    .bind(&actor.id)
    .execute(&mut *tx)
    .await?;
    for (code, (sku_id, cost)) in &known {
        if codes.contains(code) {
            sqlx::query(
                "INSERT INTO supplier_return_cost (allotment_id, sku_id, unit_cost_minor)
                 VALUES ($1, $2, $3)",
            )
            .bind(allotment_id)
            .bind(sku_id)
            .bind(cost)
            .execute(&mut *tx)
            .await?;
        }
    }
    // Confirming the return issues its surat — the numbered return delivery
    // note the supplier signs against — in the same transaction. There is no
    // draft stage: a return that existed without its paper would be goods
    // handed over with nothing to count them against.
    super::letters::issue_supplier_return_letter(&mut *tx, allotment_id, &actor.id).await?;
    tx.commit().await?;
    one(pool, allotment_id).await
}

/// Every supplier return, open ones first.
pub async fn list_supplier_returns(pool: &PgPool) -> Result<SupplierReturnList, AppError> {
    let ids: Vec<Uuid> = sqlx::query("SELECT allotment_id FROM supplier_return ORDER BY raised_at DESC")
        .fetch_all(pool)
        .await?
        .iter()
        .map(|row| row.get("allotment_id"))
        .collect();
    let mut items = Vec::with_capacity(ids.len());
    for id in ids {
        items.push(one(pool, id).await?);
    }
    let rank = |r: &SupplierReturnView| match r.status.as_str() {
        "SETTLED" | "CLOSED_SHORT" => 1,
        _ => 0,
    };
    items.sort_by_key(rank);
    Ok(SupplierReturnList { items })
}

/// What came back from the supplier for a return.
pub async fn settle_supplier_return(
    pool: &PgPool,
    allotment_id: Uuid,
    request: NewSettlement,
    actor: &str,
) -> Result<SupplierReturnView, AppError> {
    let kind = one_of(&request.kind, &SETTLE_BY, "kind")?;
    let current = one(pool, allotment_id).await?;
    if current.status == "CLOSED_SHORT" {
        return Err(AppError::Conflict("this return was closed short".into()));
    }
    if current.owed_minor <= 0 {
        return Err(AppError::Conflict("nothing is owed on this return".into()));
    }
    let (quantity, amount) = if kind == "REPLACEMENT" {
        let pieces = request.quantity.unwrap_or(0);
        if pieces <= 0 {
            return Err(AppError::Validation("a replacement needs the pieces counted".into()));
        }
        // Valued at what the returned goods cost, on average across the return.
        let unit = if current.quantity > 0 { current.value_minor / current.quantity } else { 0 };
        (Some(pieces), (pieces * unit).min(current.owed_minor))
    } else {
        let amount = request.amount_minor.unwrap_or(0);
        if amount <= 0 {
            return Err(AppError::Validation("an amount is required".into()));
        }
        (None, amount.min(current.owed_minor))
    };
    let reference = request
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|reference| !reference.is_empty());
    sqlx::query(
        "INSERT INTO supplier_return_settlement
             (settlement_id, allotment_id, kind, quantity, amount_minor, reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(allotment_id)
    .bind(&kind)
    .bind(quantity)
    .bind(amount)
    .bind(reference)
    .bind(actor)
    .execute(pool)
    .await?;
    one(pool, allotment_id).await
}

/// Buying gives up on the rest: what is still owed becomes a loss.
pub async fn close_supplier_return_short(
    pool: &PgPool,
    allotment_id: Uuid,
    request: CloseShortRequest,
    actor: &str,
) -> Result<SupplierReturnView, AppError> {
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation("say why it is closed short".into()));
    }
    let current = one(pool, allotment_id).await?;
    if current.owed_minor <= 0 {
        return Err(AppError::Conflict("nothing is owed on this return".into()));
    }
    sqlx::query(
        "UPDATE supplier_return
            SET closed_short_reason = $2, closed_short_by = $3, closed_short_at = now()
          WHERE allotment_id = $1 AND closed_short_at IS NULL",
    )
    .bind(allotment_id)
    .bind(reason)
    .bind(actor)
    .execute(pool)
    .await?;
    one(pool, allotment_id).await
}

async fn one(pool: &PgPool, allotment_id: Uuid) -> Result<SupplierReturnView, AppError> {
    let head = sqlx::query(
        "SELECT r.allotment_id, a.allotment_number, r.supplier_id, r.supplier_name, r.reason,
                r.settle_by, r.note, r.raised_by, r.raised_at, r.closed_short_reason,
                r.closed_short_at, c.dc_fulfilled, a.updated_at,
                l.letter_id, l.letter_number
         FROM supplier_return r
         JOIN allotment a ON a.id = r.allotment_id
         LEFT JOIN allotment_commitment c ON c.allotment_id = r.allotment_id
         LEFT JOIN letter l ON l.kind = 'SUPPLIER_RETURN'
                AND l.subject_id = r.allotment_id::text AND l.status <> 'VOID'
         WHERE r.allotment_id = $1",
    )
    .bind(allotment_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("no supplier return {allotment_id}")))?;

    let lines: Vec<SupplierReturnLine> = sqlx::query(
        "SELECT s.sku_code, a.article_code, a.name AS article_name, l.quantity::bigint AS quantity,
                COALESCE(cost.unit_cost_minor, 0)::bigint AS unit_cost_minor
         FROM allotment_line l
         JOIN sku s ON s.id = l.sku_id
         JOIN article a ON a.id = s.article_id
         LEFT JOIN supplier_return_cost cost
                ON cost.allotment_id = l.allotment_id AND cost.sku_id = l.sku_id
         WHERE l.allotment_id = $1
         ORDER BY s.sku_code",
    )
    .bind(allotment_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| SupplierReturnLine {
        sku_code: row.get("sku_code"),
        article_code: row.get("article_code"),
        article_name: row.get("article_name"),
        quantity: row.get("quantity"),
        unit_cost_minor: row.get("unit_cost_minor"),
    })
    .collect();

    let settlements: Vec<SupplierReturnSettlement> = sqlx::query(
        "SELECT kind, quantity, amount_minor, reference, recorded_by, recorded_at
         FROM supplier_return_settlement WHERE allotment_id = $1 ORDER BY recorded_at",
    )
    .bind(allotment_id)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|row| SupplierReturnSettlement {
        kind: row.get("kind"),
        quantity: row.get("quantity"),
        amount_minor: row.get("amount_minor"),
        reference: row.get("reference"),
        recorded_by: row.get("recorded_by"),
        recorded_at: row.get("recorded_at"),
    })
    .collect();

    let quantity: i64 = lines.iter().map(|line| line.quantity).sum();
    let value: i64 = lines
        .iter()
        .map(|line| line.quantity * line.unit_cost_minor)
        .sum();
    let settled: i64 = settlements.iter().map(|s| s.amount_minor).sum();
    let closed_short: Option<DateTime<Utc>> = head.get("closed_short_at");
    let handed_over = head.get::<Option<bool>, _>("dc_fulfilled").unwrap_or(false);
    let status = if closed_short.is_some() {
        "CLOSED_SHORT"
    } else if value > 0 && settled >= value {
        "SETTLED"
    } else if !handed_over {
        "TO_HAND_OVER"
    } else if settled > 0 {
        "PARTLY_SETTLED"
    } else {
        "WAITING"
    };
    Ok(SupplierReturnView {
        allotment_id: head.get("allotment_id"),
        allotment_number: head.get("allotment_number"),
        supplier_id: head.get("supplier_id"),
        supplier_name: head.get("supplier_name"),
        reason: head.get("reason"),
        settle_by: head.get("settle_by"),
        status: status.into(),
        quantity,
        value_minor: value,
        settled_minor: settled,
        owed_minor: if closed_short.is_some() { 0 } else { (value - settled).max(0) },
        note: head.get("note"),
        raised_by: head.get("raised_by"),
        raised_at: head.get("raised_at"),
        // The allotment's last change once the Gudang is done with it — the
        // hand-over is the last thing the Gudang does.
        handed_over_at: if handed_over { Some(head.get("updated_at")) } else { None },
        closed_short_reason: head.get("closed_short_reason"),
        letter_id: head.get("letter_id"),
        letter_number: head.get("letter_number"),
        lines,
        settlements,
    })
}
