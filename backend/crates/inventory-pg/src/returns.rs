//! Post-completion customer returns. One transaction posts the return
//! document, the CUSTOMER_RETURN movements that bring the goods back into
//! the store (floor when sellable, reject when damaged), and the refund
//! tender rows — or nothing. The completed sale row itself is never touched:
//! finalized sales are immutable, and the return is its own document.

use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use inventory_app::{AppError, CreateReturnRequest, ReturnQuery};
use inventory_domain::{ validate_command, validate_refund, MovementCause, MovementCommand, MovementGroupId, MovementLine, Place, SubjectId, };
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::HashSet;
use uuid::Uuid;

pub async fn create_sale_return(
    pool: &PgPool,
    sale_id: Uuid,
    request: CreateReturnRequest,
) -> Result<Value, AppError> {
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    if request.reason.trim().is_empty() {
        return Err(AppError::Validation("return reason is required".into()));
    }
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "return must contain at least one line".into(),
        ));
    }
    let mut seen = HashSet::new();
    for line in &request.lines {
        if !seen.insert(line.sale_line_id) {
            return Err(AppError::Validation("duplicate sale_line_id".into()));
        }
    }
    for refund in &request.refunds {
        if refund.amount_minor <= 0 {
            return Err(AppError::Validation(
                "refund amounts must be positive".into(),
            ));
        }
    }

    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CREATE_SALE_RETURN",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }

    let sale = sqlx::query(
        "SELECT id,sale_number,site_id,status,total_minor FROM sale WHERE id=$1 FOR UPDATE",
    )
    .bind(sale_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("sale".into()))?;
    let status: String = sale.get("status");
    if status != "COMPLETED" {
        return Err(AppError::Conflict(format!(
            "only COMPLETED sales can be returned, this sale is {status}"
        )));
    }
    let site_id: String = sale.get("site_id");
    let sale_number: String = sale.get("sale_number");
    let sale_total: i64 = sale.get("total_minor");

    let already_refunded: i64 =
        sqlx::query("SELECT COALESCE(SUM(refund_total_minor),0)::bigint total FROM sale_return WHERE sale_id=$1")
            .bind(sale_id)
            .fetch_one(&mut *tx)
            .await?
            .get("total");

    // Resolve and lock each returned line; V1 returns a line in full, and the
    // refund for it is exactly what the customer paid for it.
    let mut return_lines = Vec::with_capacity(request.lines.len());
    let mut refund_expected = 0_i64;
    for line in &request.lines {
        let row = sqlx::query(
            "SELECT l.id,l.subject_id,l.sku_id,l.quantity,l.total_minor,subject.epc,\
             EXISTS(SELECT 1 FROM sale_return_line rl WHERE rl.sale_line_id=l.id) returned \
             FROM sale_line l JOIN inventory_subject subject ON subject.id=l.subject_id \
             WHERE l.id=$1 AND l.sale_id=$2 FOR UPDATE OF l",
        )
        .bind(line.sale_line_id)
        .bind(sale_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("sale line belonging to this sale".into()))?;
        if row.get::<bool, _>("returned") {
            return Err(AppError::Conflict(format!(
                "sale line {} was already returned",
                line.sale_line_id
            )));
        }
        refund_expected += row.get::<i64, _>("total_minor");
        return_lines.push((line.clone(), row));
    }

    let refund_total: i64 = request.refunds.iter().map(|r| r.amount_minor).sum();
    if refund_total != refund_expected {
        return Err(AppError::Conflict(format!(
            "refund total {refund_total} must equal the value of the returned goods {refund_expected}"
        )));
    }
    validate_refund(sale_total, already_refunded, refund_total)
        .map_err(|e| AppError::Conflict(e.to_string()))?;

    let return_id = Uuid::new_v4();
    let sequence = sqlx::query("SELECT nextval('sale_return_number_sequence')::bigint sequence")
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("sequence");
    let return_number = format!("RTN-{sequence:08}");

    // Movements: customer -> floor (sellable) or customer -> reject (damaged).
    let source: Place = "external/customer"
        .parse()
        .map_err(|e: inventory_domain::PlaceError| AppError::Validation(e.to_string()))?;
    let mut movement_lines = Vec::with_capacity(return_lines.len());
    for (input, row) in &return_lines {
        let destination_place = if input.restock {
            format!("{site_id}.floor:on_hand")
        } else {
            format!("{site_id}.reject:on_hand")
        };
        let destination: Place = destination_place
            .parse()
            .map_err(|e: inventory_domain::PlaceError| AppError::Validation(e.to_string()))?;
        movement_lines.push(MovementLine {
            subject_id: SubjectId(row.get("subject_id")),
            quantity: row.get("quantity"),
            from: source.clone(),
            to: destination,
        });
    }
    movement_lines.sort_by_key(|line| line.subject_id.0);
    let movement_group_id = MovementGroupId::new();
    let now = Utc::now();
    let command = MovementCommand {
        movement_group_id,
        lines: movement_lines,
        cause: MovementCause::CustomerReturn,
        reference_type: Some("SALE_RETURN".into()),
        reference_id: Some(return_id.to_string()),
        reason: format!("Customer return {return_number} for sale {sale_number}"),
        actor_id: request.actor_id.trim().into(),
        occurred_at: now,
    };
    validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
    // Namespaced so a client key can never collide with another command's
    // derived movement key.
    let movement_key = format!("sale-return:{}:inventory", request.idempotency_key);
    insert_group(&mut tx, &command, &movement_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &command, &movement_key, &digest).await?;

    sqlx::query(
        "INSERT INTO sale_return(id,return_number,sale_id,site_id,reason,refund_total_minor,\
         movement_group_id,actor_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(return_id)
    .bind(&return_number)
    .bind(sale_id)
    .bind(&site_id)
    .bind(request.reason.trim())
    .bind(refund_total)
    .bind(movement_group_id.0)
    .bind(request.actor_id.trim())
    .bind(&request.idempotency_key)
    .execute(&mut *tx)
    .await?;

    let mut line_values = Vec::with_capacity(return_lines.len());
    for (input, row) in &return_lines {
        let line_id = Uuid::new_v4();
        let line_total: i64 = row.get("total_minor");
        sqlx::query(
            "INSERT INTO sale_return_line(id,return_id,sale_line_id,subject_id,sku_id,quantity,\
             refund_minor,restock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(line_id)
        .bind(return_id)
        .bind(input.sale_line_id)
        .bind(row.get::<Uuid, _>("subject_id"))
        .bind(row.get::<Uuid, _>("sku_id"))
        .bind(row.get::<i64, _>("quantity"))
        .bind(line_total)
        .bind(input.restock)
        .execute(&mut *tx)
        .await?;
        line_values.push(json!({
            "id": line_id,
            "sale_line_id": input.sale_line_id,
            "epc": row.get::<Option<String>,_>("epc"),
            "quantity": row.get::<i64,_>("quantity"),
            "refund_minor": line_total,
            "restock": input.restock,
        }));
    }

    for refund in &request.refunds {
        sqlx::query(
            "INSERT INTO sale_return_payment(id,return_id,method,amount_minor,reference) \
             VALUES($1,$2,$3,$4,$5)",
        )
        .bind(Uuid::new_v4())
        .bind(return_id)
        .bind(refund.method.as_str())
        .bind(refund.amount_minor)
        .bind(refund.reference.as_deref().map(str::trim).filter(|v| !v.is_empty()))
        .execute(&mut *tx)
        .await?;
    }

    let response = json!({
        "id": return_id,
        "return_number": return_number,
        "sale_id": sale_id,
        "sale_number": sale_number,
        "site_id": site_id,
        "status": "COMPLETED",
        "reason": request.reason.trim(),
        "refund_total_minor": refund_total,
        "refunds": request.refunds.iter().map(|r| json!({
            "method": r.method.as_str(),
            "amount_minor": r.amount_minor,
            "reference": r.reference,
        })).collect::<Vec<_>>(),
        "lines": line_values,
        "movement_group_id": movement_group_id.0,
        "movement_ids": movement_ids,
        "created_at": now,
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn get_sale_return(pool: &PgPool, return_id: Uuid) -> Result<Value, AppError> {
    let header = sqlx::query(
        "SELECT r.id,r.return_number,r.sale_id,s.sale_number,r.site_id,r.reason,\
         r.refund_total_minor,r.movement_group_id,r.actor_id,r.created_at \
         FROM sale_return r JOIN sale s ON s.id=r.sale_id WHERE r.id=$1",
    )
    .bind(return_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("sale return".into()))?;
    let lines = sqlx::query(
        "SELECT rl.id,rl.sale_line_id,rl.quantity,rl.refund_minor,rl.restock,\
         subject.epc,sk.sku_code,ar.name article_name \
         FROM sale_return_line rl \
         JOIN inventory_subject subject ON subject.id=rl.subject_id \
         JOIN sku sk ON sk.id=rl.sku_id \
         JOIN article ar ON ar.id=sk.article_id \
         WHERE rl.return_id=$1 ORDER BY sk.sku_code",
    )
    .bind(return_id)
    .fetch_all(pool)
    .await?;
    let refunds = sqlx::query(
        "SELECT method,amount_minor,reference FROM sale_return_payment WHERE return_id=$1",
    )
    .bind(return_id)
    .fetch_all(pool)
    .await?;
    Ok(json!({
        "id": header.get::<Uuid,_>("id"),
        "return_number": header.get::<String,_>("return_number"),
        "sale_id": header.get::<Uuid,_>("sale_id"),
        "sale_number": header.get::<String,_>("sale_number"),
        "site_id": header.get::<String,_>("site_id"),
        "reason": header.get::<String,_>("reason"),
        "refund_total_minor": header.get::<i64,_>("refund_total_minor"),
        "movement_group_id": header.get::<Uuid,_>("movement_group_id"),
        "actor_id": header.get::<String,_>("actor_id"),
        "created_at": header.get::<DateTime<Utc>,_>("created_at"),
        "lines": lines.iter().map(|row| json!({
            "id": row.get::<Uuid,_>("id"),
            "sale_line_id": row.get::<Uuid,_>("sale_line_id"),
            "sku_code": row.get::<String,_>("sku_code"),
            "article_name": row.get::<String,_>("article_name"),
            "epc": row.get::<Option<String>,_>("epc"),
            "quantity": row.get::<i64,_>("quantity"),
            "refund_minor": row.get::<i64,_>("refund_minor"),
            "restock": row.get::<bool,_>("restock"),
        })).collect::<Vec<_>>(),
        "refunds": refunds.iter().map(|row| json!({
            "method": row.get::<String,_>("method"),
            "amount_minor": row.get::<i64,_>("amount_minor"),
            "reference": row.get::<Option<String>,_>("reference"),
        })).collect::<Vec<_>>(),
    }))
}

pub async fn list_sale_returns(pool: &PgPool, query: ReturnQuery) -> Result<Value, AppError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let rows = sqlx::query(
        "SELECT r.id,r.return_number,r.sale_id,s.sale_number,r.site_id,r.reason,\
         r.refund_total_minor,r.actor_id,r.created_at \
         FROM sale_return r JOIN sale s ON s.id=r.sale_id \
         WHERE ($1::text IS NULL OR r.site_id=$1) \
         ORDER BY r.created_at DESC LIMIT $2",
    )
    .bind(
        query
            .site_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(json!({
        "items": rows.iter().map(|row| json!({
            "id": row.get::<Uuid,_>("id"),
            "return_number": row.get::<String,_>("return_number"),
            "sale_id": row.get::<Uuid,_>("sale_id"),
            "sale_number": row.get::<String,_>("sale_number"),
            "site_id": row.get::<String,_>("site_id"),
            "reason": row.get::<String,_>("reason"),
            "refund_total_minor": row.get::<i64,_>("refund_total_minor"),
            "actor_id": row.get::<String,_>("actor_id"),
            "created_at": row.get::<DateTime<Utc>,_>("created_at"),
        })).collect::<Vec<_>>(),
        "limit": limit,
    }))
}
