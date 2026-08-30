use super::{
    apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest,
    resolve_offer_in_tx,
};
use crate::{
    application::{
        AddSaleLineRequest, AddSalePaymentRequest, AppError, CommandRequest, CreateSaleRequest,
        SaleQuery,
    },
    domain::{
        calculate_line_totals, validate_command, validate_tender, CommercialChannel,
        MovementCause, MovementCommand, MovementGroupId, MovementLine, PaymentMethod, Place,
        SiteId, SiteKind, SubjectId,
    },
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

pub async fn create_sale(pool: &PgPool, request: CreateSaleRequest) -> Result<Value, AppError> {
    let site = SiteId::new(&request.site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    if site.kind() != SiteKind::Store {
        return Err(AppError::Validation(
            "Sales is a Store Edge capability".into(),
        ));
    }
    if request.channel != CommercialChannel::Store {
        return Err(AppError::Validation(
            "Sales V1 supports the STORE channel".into(),
        ));
    }
    if request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("actor_id is required".into()));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, "CREATE_SALE", &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let now = Utc::now();
    let publication = sqlx::query(r#"
SELECT cp.id,cp.version,MIN(pr.currency::text) currency,COUNT(DISTINCT pr.currency)::bigint currency_count
FROM commercial_publication cp JOIN commercial_price_rule pr ON pr.publication_id=cp.id
WHERE cp.status='PUBLISHED' AND cp.effective_from <= $1 AND (cp.effective_to IS NULL OR cp.effective_to > $1)
  AND pr.channel=$2 AND (pr.site_id=$3 OR pr.site_id IS NULL)
GROUP BY cp.id,cp.version ORDER BY cp.version DESC LIMIT 1
"#)
        .bind(now)
        .bind(request.channel.as_str())
        .bind(site.as_str())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("effective published commercial version for store".into()))?;
    if publication.get::<i64, _>("currency_count") != 1 {
        return Err(AppError::Conflict(
            "a sale requires exactly one currency in its commercial version".into(),
        ));
    }
    let publication_id: Uuid = publication.get("id");
    let version: i64 = publication.get("version");
    let currency: String = publication.get::<String, _>("currency").trim().into();
    let sequence: i64 = sqlx::query("SELECT nextval('sale_number_sequence')::bigint sequence")
        .fetch_one(&mut *tx)
        .await?
        .get("sequence");
    let sale_id = Uuid::new_v4();
    let sale_number = format!(
        "S-{}-{}-{sequence:08}",
        site.as_str().to_ascii_uppercase(),
        now.format("%Y%m%d")
    );
    sqlx::query("INSERT INTO sale(id,sale_number,site_id,channel,status,commercial_publication_id,commercial_version,currency,actor_id,idempotency_key,created_at) VALUES($1,$2,$3,$4,'OPEN',$5,$6,$7,$8,$9,$10)")
        .bind(sale_id)
        .bind(&sale_number)
        .bind(site.as_str())
        .bind(request.channel.as_str())
        .bind(publication_id)
        .bind(version)
        .bind(&currency)
        .bind(request.actor_id.trim())
        .bind(&request.idempotency_key)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    let response = json!({
        "id":sale_id,"sale_number":sale_number,"site_id":site.as_str(),"channel":request.channel.as_str(),"status":"OPEN",
        "commercial_publication_id":publication_id,"commercial_version":version,"currency":currency,"net_minor":0,"tax_minor":0,"total_minor":0,"paid_minor":0,"change_minor":0,"lines":[],"payments":[]
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn add_sale_line(
    pool: &PgPool,
    sale_id: Uuid,
    request: AddSaleLineRequest,
) -> Result<Value, AppError> {
    if request.epc.trim().is_empty() || request.actor_id.trim().is_empty() {
        return Err(AppError::Validation("epc and actor_id are required".into()));
    }
    if request.quantity != 1 {
        return Err(AppError::Validation(
            "Sales V1 sells UNIT/EPC subjects with quantity 1".into(),
        ));
    }
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, "ADD_SALE_LINE", &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let sale = open_sale_for_update(&mut tx, sale_id).await?;
    let site_id: String = sale.get("site_id");
    let channel = CommercialChannel::from_str(&sale.get::<String, _>("channel"))
        .map_err(|e| AppError::Conflict(e.to_string()))?;
    let publication_id: Uuid = sale.get("commercial_publication_id");
    let commercial_version: i64 = sale.get("commercial_version");
    let sale_currency: String = sale.get::<String, _>("currency").trim().into();
    let sale_created_at: DateTime<Utc> = sale.get("created_at");
    let subject = sqlx::query("SELECT id,subject_type,sku_id FROM inventory_subject WHERE epc=$1")
        .bind(request.epc.trim().to_ascii_uppercase())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("UNIT/EPC inventory subject".into()))?;
    if subject.get::<String, _>("subject_type") != "UNIT" {
        return Err(AppError::Validation(
            "Sales V1 requires a UNIT/EPC subject".into(),
        ));
    }
    let subject_id: Uuid = subject.get("id");
    let sku_id: Uuid = subject
        .get::<Option<Uuid>, _>("sku_id")
        .ok_or_else(|| AppError::Conflict("sale subject has no SKU".into()))?;
    let duplicate = sqlx::query("SELECT 1 FROM sale_line WHERE sale_id=$1 AND subject_id=$2")
        .bind(sale_id)
        .bind(subject_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
    if duplicate {
        return Err(AppError::Conflict("EPC is already in this sale".into()));
    }
    let floor_place = format!("{site_id}.floor:on_hand");
    let available = authoritative_subject_balance(&mut tx, subject_id, &floor_place).await?;
    if available < 1 {
        return Err(AppError::Conflict(format!(
            "EPC is not currently Store Floor / On Hand at {site_id}"
        )));
    }
    let offer = resolve_offer_in_tx(
        &mut tx,
        sku_id,
        &site_id,
        channel,
        sale_created_at,
        Some(publication_id),
    )
    .await?;
    if !offer.sellable {
        return Err(AppError::Conflict(
            "SKU is not sellable for this store/channel".into(),
        ));
    }
    if offer.currency.as_str() != sale_currency {
        return Err(AppError::Conflict(
            "offer currency does not match the sale currency".into(),
        ));
    }
    if offer.version != commercial_version {
        return Err(AppError::Conflict(
            "offer version does not match the sale snapshot".into(),
        ));
    }
    let totals = calculate_line_totals(
        offer.unit_price_minor,
        request.quantity,
        offer.tax_rate_bps,
        offer.tax_inclusive,
    )
    .map_err(|e| AppError::Validation(e.to_string()))?;
    let offer_digest = payload_digest(&offer)?;
    let line_id = Uuid::new_v4();
    sqlx::query("INSERT INTO sale_line(id,sale_id,subject_id,sku_id,quantity,unit_price_minor,net_minor,tax_minor,total_minor,currency,tax_category,tax_rate_bps,tax_inclusive,commercial_publication_id,commercial_version,price_snapshot_digest,actor_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(line_id).bind(sale_id).bind(subject_id).bind(sku_id).bind(request.quantity).bind(offer.unit_price_minor)
        .bind(totals.net_minor).bind(totals.tax_minor).bind(totals.total_minor).bind(offer.currency.as_str()).bind(&offer.tax_category)
        .bind(offer.tax_rate_bps).bind(offer.tax_inclusive).bind(offer.publication_id).bind(offer.version).bind(&offer_digest)
        .bind(request.actor_id.trim()).bind(&request.idempotency_key).execute(&mut *tx).await?;
    sqlx::query("UPDATE sale SET net_minor=net_minor+$2,tax_minor=tax_minor+$3,total_minor=total_minor+$4 WHERE id=$1")
        .bind(sale_id).bind(totals.net_minor).bind(totals.tax_minor).bind(totals.total_minor).execute(&mut *tx).await?;
    let response = json!({
        "sale_id":sale_id,"line_id":line_id,"subject_id":subject_id,"epc":request.epc.trim().to_ascii_uppercase(),"sku_id":sku_id,"quantity":request.quantity,
        "unit_price_minor":offer.unit_price_minor,"net_minor":totals.net_minor,"tax_minor":totals.tax_minor,"total_minor":totals.total_minor,
        "currency":offer.currency.as_str(),"tax_category":offer.tax_category,"tax_rate_bps":offer.tax_rate_bps,"tax_inclusive":offer.tax_inclusive,
        "commercial_publication_id":offer.publication_id,"commercial_version":offer.version,"price_snapshot_digest":offer_digest
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn add_sale_payment(
    pool: &PgPool,
    sale_id: Uuid,
    request: AddSalePaymentRequest,
) -> Result<Value, AppError> {
    if request.amount_minor <= 0 || request.actor_id.trim().is_empty() {
        return Err(AppError::Validation(
            "positive amount_minor and actor_id are required".into(),
        ));
    }
    let method = PaymentMethod::from_str(&request.method)
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "ADD_SALE_PAYMENT",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let sale = open_sale_for_update(&mut tx, sale_id).await?;
    // A tender against an empty cart is always a mistake: there is nothing
    // to pay for yet, and stray paid_minor confuses completion.
    let has_lines = sqlx::query("SELECT 1 FROM sale_line WHERE sale_id=$1 LIMIT 1")
        .bind(sale_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
    if !has_lines {
        return Err(AppError::Conflict(
            "cannot record a payment before the sale has lines".into(),
        ));
    }
    // Change can only be given from cash, so electronic tenders may never
    // exceed the running total (see domain::validate_tender).
    if method != PaymentMethod::Cash {
        let total_minor: i64 = sale.get("total_minor");
        let non_cash_paid: i64 = sqlx::query(
            "SELECT COALESCE(SUM(amount_minor),0)::bigint total FROM sale_payment \
             WHERE sale_id=$1 AND method <> 'CASH'",
        )
        .bind(sale_id)
        .fetch_one(&mut *tx)
        .await?
        .get("total");
        if non_cash_paid + request.amount_minor > total_minor {
            return Err(AppError::Conflict(format!(
                "non-cash tender would exceed the sale total: total {total_minor}, \
                 non-cash already {non_cash_paid}, attempted {}",
                request.amount_minor
            )));
        }
    }
    let payment_id = Uuid::new_v4();
    sqlx::query("INSERT INTO sale_payment(id,sale_id,method,amount_minor,reference,actor_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(payment_id).bind(sale_id).bind(method.as_str()).bind(request.amount_minor).bind(&request.reference).bind(request.actor_id.trim()).bind(&request.idempotency_key)
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE sale SET paid_minor=paid_minor+$2 WHERE id=$1")
        .bind(sale_id)
        .bind(request.amount_minor)
        .execute(&mut *tx)
        .await?;
    let response = json!({"sale_id":sale_id,"payment_id":payment_id,"method":method.as_str(),"amount_minor":request.amount_minor,"reference":request.reference});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn complete_sale(
    pool: &PgPool,
    sale_id: Uuid,
    request: CommandRequest,
) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, "COMPLETE_SALE", &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let sale = open_sale_for_update(&mut tx, sale_id).await?;
    let site_id: String = sale.get("site_id");
    let total_minor: i64 = sale.get("total_minor");
    // Change can only be given from cash: split the tenders and let the
    // domain rule decide (electronic overpayment was already refused at
    // add_sale_payment; this re-checks at the commit point).
    let tender = sqlx::query(
        "SELECT COALESCE(SUM(amount_minor) FILTER (WHERE method='CASH'),0)::bigint cash,\
         COALESCE(SUM(amount_minor) FILTER (WHERE method<>'CASH'),0)::bigint non_cash \
         FROM sale_payment WHERE sale_id=$1",
    )
    .bind(sale_id)
    .fetch_one(&mut *tx)
    .await?;
    let payment = validate_tender(
        total_minor,
        tender.get::<i64, _>("cash"),
        tender.get::<i64, _>("non_cash"),
    )
    .map_err(|e| AppError::Conflict(e.to_string()))?;
    let line_rows = sqlx::query(
        "SELECT l.subject_id,l.quantity,subject.epc FROM sale_line l \
         JOIN inventory_subject subject ON subject.id=l.subject_id \
         WHERE l.sale_id=$1 ORDER BY l.subject_id",
    )
    .bind(sale_id)
    .fetch_all(&mut *tx)
    .await?;
    if line_rows.is_empty() {
        return Err(AppError::Conflict("sale has no lines".into()));
    }
    let source: Place = format!("{site_id}.floor:on_hand")
        .parse()
        .map_err(|e: crate::domain::PlaceError| AppError::Validation(e.to_string()))?;
    let destination: Place = "external/customer"
        .parse()
        .map_err(|e: crate::domain::PlaceError| AppError::Validation(e.to_string()))?;
    // Friendly pre-check so a lost race names the offending item: the ledger
    // apply would fail anyway, but its error cannot say which EPC to remove
    // from the cart.
    let floor_place = format!("{site_id}.floor:on_hand");
    let mut lines = Vec::with_capacity(line_rows.len());
    for row in &line_rows {
        let subject_id: Uuid = row.get("subject_id");
        let quantity: i64 = row.get("quantity");
        let available = authoritative_subject_balance(&mut tx, subject_id, &floor_place).await?;
        if available < quantity {
            let epc: Option<String> = row.get("epc");
            return Err(AppError::Conflict(format!(
                "item {} is no longer available on the store floor (likely sold by another till); remove it from this sale",
                epc.unwrap_or_else(|| subject_id.to_string())
            )));
        }
        lines.push(MovementLine {
            subject_id: SubjectId(subject_id),
            quantity,
            from: source.clone(),
            to: destination.clone(),
        });
    }
    let movement_group_id = MovementGroupId::new();
    let command = MovementCommand {
        movement_group_id,
        lines,
        cause: MovementCause::Sale,
        reference_type: Some("SALE".into()),
        reference_id: Some(sale_id.to_string()),
        reason: format!("Completed Store sale {sale_id}"),
        actor_id: request.actor_id.clone(),
        occurred_at: Utc::now(),
    };
    validate_command(&command).map_err(|e| AppError::Validation(e.to_string()))?;
    // Namespaced so a client key can never collide with another command's
    // derived movement key (e.g. an allotment execute using the same key).
    let movement_key = format!("sale:{}:inventory", request.idempotency_key);
    insert_group(&mut tx, &command, &movement_key, &digest).await?;
    let movement_ids = apply_lines(&mut tx, &command, &movement_key, &digest).await?;
    let completed_at = command.occurred_at;
    sqlx::query("UPDATE sale SET status='COMPLETED',change_minor=$2,movement_group_id=$3,completed_at=$4 WHERE id=$1")
        .bind(sale_id).bind(payment.change_minor).bind(movement_group_id.0).bind(completed_at).execute(&mut *tx).await?;
    let response = json!({
        "id":sale_id,"status":"COMPLETED","total_minor":payment.total_minor,"paid_minor":payment.paid_minor,"change_minor":payment.change_minor,
        "movement_group_id":movement_group_id.0,"movement_ids":movement_ids,"inventory_effect":"Store Floor / On Hand -> external/customer","completed_at":completed_at
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn void_open_sale(
    pool: &PgPool,
    sale_id: Uuid,
    request: CommandRequest,
) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) =
        begin_idempotent(&mut tx, &request.idempotency_key, "VOID_OPEN_SALE", &digest).await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    open_sale_for_update(&mut tx, sale_id).await?;
    sqlx::query("UPDATE sale SET status='VOIDED',voided_at=now() WHERE id=$1")
        .bind(sale_id)
        .execute(&mut *tx)
        .await?;
    let response =
        json!({"id":sale_id,"status":"VOIDED","inventory_effect":null,"voided_at":Utc::now()});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

async fn open_sale_for_update(
    tx: &mut Transaction<'_, Postgres>,
    sale_id: Uuid,
) -> Result<sqlx::postgres::PgRow, AppError> {
    let row = sqlx::query("SELECT id,site_id,channel,status,commercial_publication_id,commercial_version,currency::text currency,total_minor,paid_minor,created_at FROM sale WHERE id=$1 FOR UPDATE")
        .bind(sale_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("sale".into()))?;
    let status: String = row.get("status");
    if status != "OPEN" {
        return Err(AppError::Conflict(format!(
            "sale must be OPEN, currently {status}"
        )));
    }
    Ok(row)
}

async fn authoritative_subject_balance(
    tx: &mut Transaction<'_, Postgres>,
    subject_id: Uuid,
    place_id: &str,
) -> Result<i64, AppError> {
    let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN to_place_id=$2 THEN quantity WHEN from_place_id=$2 THEN -quantity ELSE 0 END),0)::bigint balance FROM movement WHERE subject_id=$1 AND (to_place_id=$2 OR from_place_id=$2)")
        .bind(subject_id)
        .bind(place_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(row.get("balance"))
}

pub async fn get_sale(pool: &PgPool, sale_id: Uuid) -> Result<Value, AppError> {
    let sale = sqlx::query("SELECT id,sale_number,site_id,channel,status,commercial_publication_id,commercial_version,currency::text currency,net_minor,tax_minor,total_minor,paid_minor,change_minor,movement_group_id,actor_id,created_at,completed_at,voided_at FROM sale WHERE id=$1")
        .bind(sale_id).fetch_optional(pool).await?.ok_or_else(||AppError::NotFound("sale".into()))?;
    let lines = sqlx::query("SELECT sl.id,sl.subject_id,s.epc,sl.sku_id,sk.sku_code,sl.quantity,sl.unit_price_minor,sl.net_minor,sl.tax_minor,sl.total_minor,sl.currency::text currency,sl.tax_category,sl.tax_rate_bps,sl.tax_inclusive,sl.commercial_publication_id,sl.commercial_version,sl.price_snapshot_digest,sl.added_at FROM sale_line sl JOIN inventory_subject s ON s.id=sl.subject_id JOIN sku sk ON sk.id=sl.sku_id WHERE sl.sale_id=$1 ORDER BY sl.added_at")
        .bind(sale_id).fetch_all(pool).await?;
    let payments = sqlx::query("SELECT id,method,amount_minor,reference,actor_id,recorded_at FROM sale_payment WHERE sale_id=$1 ORDER BY recorded_at")
        .bind(sale_id).fetch_all(pool).await?;
    let line_values:Vec<Value>=lines.into_iter().map(|row|json!({
        "id":row.get::<Uuid,_>("id"),"subject_id":row.get::<Uuid,_>("subject_id"),"epc":row.get::<String,_>("epc"),"sku_id":row.get::<Uuid,_>("sku_id"),"sku_code":row.get::<String,_>("sku_code"),"quantity":row.get::<i64,_>("quantity"),"unit_price_minor":row.get::<i64,_>("unit_price_minor"),"net_minor":row.get::<i64,_>("net_minor"),"tax_minor":row.get::<i64,_>("tax_minor"),"total_minor":row.get::<i64,_>("total_minor"),"currency":row.get::<String,_>("currency").trim(),"tax_category":row.get::<String,_>("tax_category"),"tax_rate_bps":row.get::<i32,_>("tax_rate_bps"),"tax_inclusive":row.get::<bool,_>("tax_inclusive"),"commercial_publication_id":row.get::<Uuid,_>("commercial_publication_id"),"commercial_version":row.get::<i64,_>("commercial_version"),"price_snapshot_digest":row.get::<String,_>("price_snapshot_digest"),"added_at":row.get::<DateTime<Utc>,_>("added_at")
    })).collect();
    let payment_values:Vec<Value>=payments.into_iter().map(|row|json!({"id":row.get::<Uuid,_>("id"),"method":row.get::<String,_>("method"),"amount_minor":row.get::<i64,_>("amount_minor"),"reference":row.get::<Option<String>,_>("reference"),"actor_id":row.get::<String,_>("actor_id"),"recorded_at":row.get::<DateTime<Utc>,_>("recorded_at")})).collect();
    Ok(json!({
        "id":sale.get::<Uuid,_>("id"),"sale_number":sale.get::<String,_>("sale_number"),"site_id":sale.get::<String,_>("site_id"),"channel":sale.get::<String,_>("channel"),"status":sale.get::<String,_>("status"),"commercial_publication_id":sale.get::<Uuid,_>("commercial_publication_id"),"commercial_version":sale.get::<i64,_>("commercial_version"),"currency":sale.get::<String,_>("currency").trim(),"net_minor":sale.get::<i64,_>("net_minor"),"tax_minor":sale.get::<i64,_>("tax_minor"),"total_minor":sale.get::<i64,_>("total_minor"),"paid_minor":sale.get::<i64,_>("paid_minor"),"change_minor":sale.get::<i64,_>("change_minor"),"movement_group_id":sale.get::<Option<Uuid>,_>("movement_group_id"),"actor_id":sale.get::<String,_>("actor_id"),"created_at":sale.get::<DateTime<Utc>,_>("created_at"),"completed_at":sale.get::<Option<DateTime<Utc>>,_>("completed_at"),"voided_at":sale.get::<Option<DateTime<Utc>>,_>("voided_at"),"lines":line_values,"payments":payment_values
    }))
}

pub async fn list_sales(pool: &PgPool, query: SaleQuery) -> Result<Value, AppError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let rows=sqlx::query("SELECT id,sale_number,site_id,channel,status,commercial_version,currency::text currency,total_minor,paid_minor,change_minor,movement_group_id,created_at,completed_at FROM sale WHERE ($1::text IS NULL OR site_id=$1) AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT $3")
        .bind(query.site_id).bind(query.status.map(|s|s.to_ascii_uppercase())).bind(limit).fetch_all(pool).await?;
    let items:Vec<Value>=rows.into_iter().map(|row|json!({"id":row.get::<Uuid,_>("id"),"sale_number":row.get::<String,_>("sale_number"),"site_id":row.get::<String,_>("site_id"),"channel":row.get::<String,_>("channel"),"status":row.get::<String,_>("status"),"commercial_version":row.get::<i64,_>("commercial_version"),"currency":row.get::<String,_>("currency").trim(),"total_minor":row.get::<i64,_>("total_minor"),"paid_minor":row.get::<i64,_>("paid_minor"),"change_minor":row.get::<i64,_>("change_minor"),"movement_group_id":row.get::<Option<Uuid>,_>("movement_group_id"),"created_at":row.get::<DateTime<Utc>,_>("created_at"),"completed_at":row.get::<Option<DateTime<Utc>>,_>("completed_at")})).collect();
    Ok(json!({"items":items,"limit":limit}))
}
