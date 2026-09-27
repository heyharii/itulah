use super::{apply_lines, begin_idempotent, complete_idempotent, insert_group, payload_digest};
use crate::cloud::{
    application::{
        AddSaleLineRequest, AddSalePaymentRequest, AppError, CommandRequest, CreateSaleRequest,
        SaleQuery,
    },
    domain::{
        calculate_line_totals, validate_command, validate_tender, CommercialChannel, MovementCause,
        MovementCommand, MovementGroupId, MovementLine, PaymentMethod, Place, SiteId, SiteKind,
        SubjectId,
    },
};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::str::FromStr;
use uuid::Uuid;

pub async fn create_sale(pool: &PgPool, request: CreateSaleRequest) -> Result<Value, AppError> {
    let site = SiteId::new(&request.site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    // What the site is comes from its row, never from how its id is spelled.
    if super::sites::site_kind(pool, site.as_str()).await? != Some(SiteKind::Store) {
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

/// Add one EPC to an open sale at the centre.
///
/// Priced by `pricing-engine`, the evaluator the till runs, rather than by SQL
/// of its own. It used to resolve with a hand-written cascade that read price
/// rules and tax and could not see a markdown — so a shirt on clearance rang up
/// here at list price while the counter charged the clearance.
///
/// It also pinned the whole sale to one publication and refused any line whose
/// price came from another. That was the old whole-book model, and it had
/// become a live fault rather than a rough edge: a book is a list of changes,
/// so repricing one shirt made every product the new book did not mention
/// unsellable through this path — still priced, by a book still in force, and
/// refused anyway.
///
/// # What is still not equal to a till
///
/// Promotions and coupons. Those are statements about a whole BASKET, and this
/// path prices a line as it is added; honouring them means re-pricing every
/// line on every scan, and rewriting lines breaks the ids `sale_return_line`
/// points at. The standing decision is that the centre stops taking money
/// altogether and shows a shop's catalogue instead, which makes that work
/// unnecessary rather than merely deferred.
///
/// What changed is the part that decision does not cover: while this path still
/// takes money, it should at least charge what the shop charges for one item.
/// A markdown is this product's price, not a basket-shaped offer, so there was
/// never a reason for it to be missing.
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
    // Priced by the shared evaluator, at the instant the sale opened.
    //
    // This used to resolve with SQL of its own — a cascade that knew about
    // price rules and tax and nothing about clearance — and then demand that
    // every line come from one publication. Both were the old whole-book model.
    // A price book is a list of changes: the newest book that names a product
    // wins and one that never names it changes nothing, so a basket of two
    // shirts legitimately draws its prices from two different books. Pinning
    // the sale to one made every product the newest book did not mention
    // unsellable through this path, while the shop that sells it every day
    // charges it happily.
    // The whole book and the whole catalogue: this path resolves ONE product
    // from a sale that has already happened, and it does not know which until
    // `sku_code_by_id` below tells it. Narrowing needs a list of codes up
    // front, and there is none to give here.
    let pricing = super::pricing::load_site_price_book(
        &mut tx,
        &site_id,
        channel.as_str(),
        sale_created_at,
        None,
        // As published. This resolves a product on a sale that has already
        // happened, and the sale itself is the evidence of what was charged —
        // narrowing to activations here would refuse to name a product the shop
        // demonstrably sold.
        &super::pricing::PriceBookScope::AsPublished,
    )
    .await?;
    let merchandise = super::pricing::load_merchandise(&mut tx, None).await?;
    let sku_code = pricing
        .sku_code_by_id
        .get(&sku_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound("a published price for this SKU".into()))?;
    let context = crate::reporting::pricing_context(&site_id, channel.as_str(), sale_created_at);
    // The catalogue reading, not the basket one: a promotion is a statement
    // about a whole basket, and this path prices a line as it is added. What it
    // does now honour is the markdown, which IS this product's price.
    let priced = pricing_engine::price_catalog(
        &pricing.snapshot,
        &context,
        &[super::pricing::cart_line(&sku_code, 1, &merchandise)],
    )
    .into_iter()
    .next()
    // The engine drops anything unsellable before it prices it, so nothing
    // coming back means exactly that: this shop may not sell this here.
    .ok_or_else(|| AppError::Conflict("SKU is not sellable for this store/channel".into()))?;
    if priced.currency.0 != sale_currency {
        return Err(AppError::Conflict(
            "offer currency does not match the sale currency".into(),
        ));
    }
    // Which book decided this line — not which book the sale opened under.
    let book = sqlx::query(
        "SELECT p.id, tr.rate_bps, tr.tax_inclusive
           FROM commercial_publication p
           JOIN commercial_tax_rule tr
             ON tr.publication_id = p.id AND tr.tax_category = $2
          WHERE p.version = $1",
    )
    .bind(priced.publication_version)
    .bind(&priced.tax_category)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        AppError::Conflict(format!(
            "book v{} prices this product but declares no {} tax rule",
            priced.publication_version, priced.tax_category
        ))
    })?;
    let line_publication_id: Uuid = book.get("id");
    let tax_rate_bps: i32 = book.get("rate_bps");
    let tax_inclusive: bool = book.get("tax_inclusive");
    let totals = calculate_line_totals(
        priced.unit_price.minor,
        request.quantity,
        tax_rate_bps,
        tax_inclusive,
    )
    .map_err(|e| AppError::Validation(e.to_string()))?;
    // The fingerprint covers what was actually charged and where it came from,
    // including the markdown — the old digest covered an offer that could not
    // have named one.
    let offer_digest = payload_digest(&priced)?;
    let line_id = Uuid::new_v4();
    sqlx::query("INSERT INTO sale_line(id,sale_id,subject_id,sku_id,quantity,unit_price_minor,net_minor,tax_minor,total_minor,currency,tax_category,tax_rate_bps,tax_inclusive,commercial_publication_id,commercial_version,price_snapshot_digest,actor_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)")
        .bind(line_id).bind(sale_id).bind(subject_id).bind(sku_id).bind(request.quantity).bind(priced.unit_price.minor)
        .bind(totals.net_minor).bind(totals.tax_minor).bind(totals.total_minor).bind(&priced.currency.0).bind(&priced.tax_category)
        .bind(tax_rate_bps).bind(tax_inclusive).bind(line_publication_id).bind(priced.publication_version).bind(&offer_digest)
        .bind(request.actor_id.trim()).bind(&request.idempotency_key).execute(&mut *tx).await?;
    sqlx::query("UPDATE sale SET net_minor=net_minor+$2,tax_minor=tax_minor+$3,total_minor=total_minor+$4 WHERE id=$1")
        .bind(sale_id).bind(totals.net_minor).bind(totals.tax_minor).bind(totals.total_minor).execute(&mut *tx).await?;
    let response = json!({
        "sale_id":sale_id,"line_id":line_id,"subject_id":subject_id,"epc":request.epc.trim().to_ascii_uppercase(),"sku_id":sku_id,"quantity":request.quantity,
        "unit_price_minor":priced.unit_price.minor,"base_unit_price_minor":priced.base_unit_price.minor,
        "price_source":priced.source.as_str(),"markdown_id":priced.markdown_id,
        "net_minor":totals.net_minor,"tax_minor":totals.tax_minor,"total_minor":totals.total_minor,
        "currency":priced.currency.0,"tax_category":priced.tax_category,"tax_rate_bps":tax_rate_bps,"tax_inclusive":tax_inclusive,
        "commercial_publication_id":line_publication_id,"commercial_version":priced.publication_version,"price_snapshot_digest":offer_digest
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
        .map_err(|e: crate::cloud::domain::PlaceError| AppError::Validation(e.to_string()))?;
    let destination: Place = "external/customer"
        .parse()
        .map_err(|e: crate::cloud::domain::PlaceError| AppError::Validation(e.to_string()))?;
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
    // BEFORE the status flip, and the order is load-bearing: 0003's
    // `sale_finalized_immutable` refuses an UPDATE to a COMPLETED sale, so this
    // one line later would abort every completion that had a shopper to record.
    // Same transaction, so the finalised sale and the member it belongs to are
    // never separately visible — a return reading between the two would file an
    // anonymous return of a member's purchase.
    carry_customer_from_shop_fact(&mut tx, sale_id).await?;
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

/// Carry what the shop knew about the shopper onto the centre's own record.
///
/// There are two accounts of one sale here — `edge_sale`, the shop's, arrived
/// over the sync lane, and `sale`, the centre's own — and only the first has
/// ever held a shopper. The till captures the member's card at the counter;
/// `create_sale` takes a site, a channel, an actor and a key, and never asks.
/// So `sale.customer_id` cannot be filled from the request that opened the
/// sale, and this is where it is filled from instead.
///
/// # This must run while the sale is still OPEN
///
/// `sale_finalized_immutable` (0003) refuses any UPDATE whose OLD row is
/// COMPLETED or VOIDED. Called a line later — after the status flip — this
/// raises `finalized sales are immutable` and takes the whole completion down
/// with it, which is not a subtle failure but it IS one that only appears for
/// sales that have a shop fact to carry. The ordering is the guard.
///
/// For the same reason nothing here writes `sale_line`: `sale_line_append_only`
/// refuses every UPDATE outright, at any status. The per-line award stays on
/// `edge_sale_line` where 0166 put it, and `create_sale_return` reads it from
/// there rather than copying it to a row that may not be rewritten.
///
/// `IS NULL` on the target, so this only ever fills a gap — it never restates a
/// shopper the centre has since corrected.
pub(super) async fn carry_customer_from_shop_fact(
    tx: &mut Transaction<'_, Postgres>,
    sale_id: Uuid,
) -> Result<(), AppError> {
    // Blank is not a shopper. A till that sends an empty string means the
    // sale was anonymous, and `edge_sale` already filters that on the way in —
    // repeated here because this reads the column, not that code path.
    sqlx::query(
        "UPDATE sale s
            SET customer_id = btrim(e.customer_id)
           FROM edge_sale e
          WHERE e.sale_id = s.id
            AND s.id = $1
            AND s.customer_id IS NULL
            AND btrim(e.customer_id) <> ''",
    )
    .bind(sale_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
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
    let sale = sqlx::query("SELECT id,sale_number,site_id,channel,status,commercial_publication_id,commercial_version,currency::text currency,net_minor,tax_minor,total_minor,paid_minor,change_minor,movement_group_id,actor_id,customer_id,created_at,completed_at,voided_at FROM sale WHERE id=$1")
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
        "id":sale.get::<Uuid,_>("id"),"sale_number":sale.get::<String,_>("sale_number"),"site_id":sale.get::<String,_>("site_id"),"channel":sale.get::<String,_>("channel"),"status":sale.get::<String,_>("status"),"commercial_publication_id":sale.get::<Uuid,_>("commercial_publication_id"),"commercial_version":sale.get::<i64,_>("commercial_version"),"currency":sale.get::<String,_>("currency").trim(),"net_minor":sale.get::<i64,_>("net_minor"),"tax_minor":sale.get::<i64,_>("tax_minor"),"total_minor":sale.get::<i64,_>("total_minor"),"paid_minor":sale.get::<i64,_>("paid_minor"),"change_minor":sale.get::<i64,_>("change_minor"),"movement_group_id":sale.get::<Option<Uuid>,_>("movement_group_id"),"actor_id":sale.get::<String,_>("actor_id"),"customer_id":sale.get::<Option<String>,_>("customer_id"),"created_at":sale.get::<DateTime<Utc>,_>("created_at"),"completed_at":sale.get::<Option<DateTime<Utc>>,_>("completed_at"),"voided_at":sale.get::<Option<DateTime<Utc>>,_>("voided_at"),"lines":line_values,"payments":payment_values
    }))
}

/// The register: sales, narrowed by unit, by status and by WINDOW.
///
/// See [`SaleQuery`] for why the window is on `created_at`. Both bounds are
/// optional and independent — "everything since the first" is as ordinary a
/// question as "that fortnight" — and both are read at the caller's UTC
/// offset, defaulting to WIB, so a day means the day a shop had.
pub async fn list_sales(pool: &PgPool, query: SaleQuery) -> Result<Value, AppError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let offset_minutes = crate::reporting::offset_of(query.utc_offset_minutes);
    if let (Some(from), Some(to)) = (query.from, query.to) {
        if to < from {
            return Err(AppError::Validation(format!(
                "the span ends before it starts: {from} to {to}"
            )));
        }
    }
    let shift = chrono::Duration::minutes(i64::from(offset_minutes));
    // Half-open at the far end: `to` is INCLUSIVE as a date, which is the
    // instant the day after it begins. Comparing against midnight of `to`
    // itself would silently drop that whole day's trade.
    let start = query
        .from
        .map(|day| chrono::Utc.from_utc_datetime(&(day.and_time(chrono::NaiveTime::MIN) - shift)));
    let end = query.to.map(|day| {
        chrono::Utc.from_utc_datetime(
            &((day + chrono::Duration::days(1)).and_time(chrono::NaiveTime::MIN) - shift),
        )
    });
    let rows=sqlx::query("WITH all_sales AS ( \
        SELECT 'CENTRE'::text source,s.id,s.sale_number,s.site_id,s.channel,s.status,s.commercial_version,s.currency::text currency, \
               s.total_minor,s.paid_minor,s.change_minor,s.movement_group_id,s.customer_id,s.created_at,s.completed_at \
          FROM sale s \
        UNION ALL \
        SELECT 'EDGE'::text source,e.sale_id,'POS-'||LEFT(e.sale_id::text,8),e.site_id,'STORE',e.status, \
               COALESCE(MAX(l.publication_version),0)::bigint,e.currency::text,e.total_minor,e.paid_minor,e.change_minor, \
               e.movement_group_id,e.customer_id,e.occurred_at,e.occurred_at \
          FROM edge_sale e LEFT JOIN edge_sale_line l ON l.sale_id=e.sale_id \
         GROUP BY e.sale_id,e.site_id,e.currency,e.total_minor,e.paid_minor,e.change_minor,e.movement_group_id,e.customer_id,e.occurred_at \
    ) SELECT source,id,sale_number,site_id,channel,status,commercial_version,currency,total_minor,paid_minor,change_minor, \
             movement_group_id,customer_id,created_at,completed_at \
        FROM all_sales WHERE ($1::text IS NULL OR site_id=$1) AND ($2::text IS NULL OR status=$2) \
          AND ($4::timestamptz IS NULL OR created_at >= $4) AND ($5::timestamptz IS NULL OR created_at < $5) \
        ORDER BY created_at DESC LIMIT $3")
        .bind(query.site_id).bind(query.status.map(|s|s.to_ascii_uppercase())).bind(limit).bind(start).bind(end).fetch_all(pool).await?;
    let items:Vec<Value>=rows.into_iter().map(|row|json!({"source":row.get::<String,_>("source"),"id":row.get::<Uuid,_>("id"),"sale_number":row.get::<String,_>("sale_number"),"site_id":row.get::<String,_>("site_id"),"channel":row.get::<String,_>("channel"),"status":row.get::<String,_>("status"),"commercial_version":row.get::<i64,_>("commercial_version"),"currency":row.get::<String,_>("currency").trim(),"total_minor":row.get::<i64,_>("total_minor"),"paid_minor":row.get::<i64,_>("paid_minor"),"change_minor":row.get::<i64,_>("change_minor"),"movement_group_id":row.get::<Option<Uuid>,_>("movement_group_id"),
        // Selected by `get_sale` since the column existed and never put on the
        // list's wire, so no register could say which receipts were a member's.
        "customer_id":row.get::<Option<String>,_>("customer_id"),"created_at":row.get::<DateTime<Utc>,_>("created_at"),"completed_at":row.get::<Option<DateTime<Utc>>,_>("completed_at")})).collect();
    Ok(json!({
        "items":items,
        "limit":limit,
        // Echoed back so a caller can see the window it was actually answered
        // over — the dates are read at an offset, and a screen that assumed UTC
        // would be a day out for seven hours of every day.
        "from":query.from,
        "to":query.to,
        "utc_offset_minutes":offset_minutes,
    }))
}

/// One sale as it happened at a shop, with the promotions that came off it.
///
/// `get_sale` above reads the centre's own `sale` table. This reads
/// `edge_sale` — the shop's, arrived over the sync lane — which is where
/// essentially every real sale in this business lives.
///
/// The promotions are the point. A shop has always sent which ones applied and
/// what each was worth; the centre counted them into `commercial_usage` and
/// discarded the list, so "what has the Lebaran promo cost us" had an answer
/// and "why was this customer charged this" did not. That second question is
/// the one asked at a counter with somebody waiting.
///
/// The rule's name is looked up best-effort and may be absent. A receipt has to
/// stay readable after the promotion it names has been superseded, so the name
/// is a courtesy and the id is the record.
pub async fn get_shop_sale(pool: &PgPool, sale_id: Uuid) -> Result<Value, AppError> {
    let sale = sqlx::query(
        "SELECT sale_id, site_id, actor_id, occurred_at, received_at, currency::text currency,
                total_minor, paid_minor, change_minor, discount_total_minor, points_earned,
                pricing_trace_id, customer_id
           FROM edge_sale WHERE sale_id = $1",
    )
    .bind(sale_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("a sale from a shop".into()))?;

    // The product's name comes from the catalogue, not from the sale: a receipt
    // records what was sold and for how much, and a garment's name is not part
    // of that record. A product since deleted simply has no name to show.
    let lines: Vec<Value> = sqlx::query(
        "SELECT l.sku_code, l.quantity, l.unit_price_minor, l.line_total_minor,
                l.price_source, l.publication_version, a.name article_name, a.article_code
           FROM edge_sale_line l
           LEFT JOIN sku s ON s.sku_code = l.sku_code
           LEFT JOIN article a ON a.id = s.article_id
          WHERE l.sale_id = $1
          ORDER BY l.sku_code",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        let unit: i64 = row.get("unit_price_minor");
        let quantity: i64 = row.get("quantity");
        let charged: Option<i64> = row.get("line_total_minor");
        json!({
            "sku_code": row.get::<String, _>("sku_code"),
            "article_code": row.get::<Option<String>, _>("article_code"),
            "article_name": row.get::<Option<String>, _>("article_name"),
            "quantity": quantity,
            "unit_price_minor": unit,
            // What the line was actually charged. Not always unit times
            // quantity: a promotion acts on the line, and an apportioned flat
            // discount does not divide evenly. Null on sales recorded before
            // the column existed, which is not the same as zero.
            "line_total_minor": charged,
            "price_source": row.get::<Option<String>, _>("price_source"),
            "publication_version": row.get::<Option<i64>, _>("publication_version"),
        })
    })
    .collect();

    let promotions: Vec<Value> = sqlx::query(
        "SELECT p.rule_id, p.campaign_id, p.coupon_code, p.benefit_minor,
                (SELECT r.name FROM commercial_rule r
                   JOIN commercial_publication pub ON pub.id = r.publication_id
                  WHERE r.rule_id = p.rule_id AND pub.status = 'PUBLISHED'
                  ORDER BY pub.version DESC LIMIT 1) AS name
           FROM edge_sale_promotion p
          WHERE p.sale_id = $1
          ORDER BY p.benefit_minor DESC, p.rule_id",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "rule_id": row.get::<String, _>("rule_id"),
            "campaign_id": row.get::<Option<String>, _>("campaign_id"),
            "coupon_code": row.get::<Option<String>, _>("coupon_code"),
            "name": row.get::<Option<String>, _>("name"),
            "benefit_minor": row.get::<i64, _>("benefit_minor"),
        })
    })
    .collect();

    // How it settled. On a disputed receipt this is usually the first question
    // asked and the one `paid_minor` alone cannot answer: a refund goes back
    // the way the money came, and "we paid by card" is checkable here.
    let tenders: Vec<Value> = sqlx::query(
        "SELECT tender_seq, method, amount_minor, reference
           FROM edge_sale_tender WHERE sale_id = $1 ORDER BY tender_seq",
    )
    .bind(sale_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "tender_seq": row.get::<i32, _>("tender_seq"),
            "method": row.get::<String, _>("method"),
            "amount_minor": row.get::<i64, _>("amount_minor"),
            "reference": row.get::<Option<String>, _>("reference"),
        })
    })
    .collect();

    Ok(json!({
        "sale_id": sale.get::<Uuid, _>("sale_id"),
        "site_id": sale.get::<String, _>("site_id"),
        "actor_id": sale.get::<String, _>("actor_id"),
        // The shop's clock and the centre's. The gap between them is how long
        // the takings took to arrive.
        "occurred_at": sale.get::<DateTime<Utc>, _>("occurred_at"),
        "received_at": sale.get::<DateTime<Utc>, _>("received_at"),
        "currency": sale.get::<String, _>("currency").trim(),
        "total_minor": sale.get::<i64, _>("total_minor"),
        "paid_minor": sale.get::<i64, _>("paid_minor"),
        "change_minor": sale.get::<i64, _>("change_minor"),
        "discount_total_minor": sale.get::<i64, _>("discount_total_minor"),
        "points_earned": sale.get::<i64, _>("points_earned"),
        // The fingerprint of the pricing decision. What makes a disputed
        // receipt reproducible rather than arguable.
        "pricing_trace_id": sale.get::<Option<String>, _>("pricing_trace_id"),
        "customer_id": sale.get::<Option<String>, _>("customer_id"),
        "lines": lines,
        "promotions": promotions,
        "tenders": tenders,
    }))
}
