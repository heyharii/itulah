use super::{begin_idempotent, complete_idempotent, payload_digest};
use retail_app::{ AppError, CommandRequest, CreateCommercialPublicationRequest, ResolveOfferQuery, };
use retail_domain::{CommercialChannel, CurrencyCode, ResolvedOffer, SiteId};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::HashSet;
use uuid::Uuid;

pub async fn create_commercial_publication(
    pool: &PgPool,
    request: CreateCommercialPublicationRequest,
) -> Result<Value, AppError> {
    validate_publication_request(&request)?;
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "CREATE_COMMERCIAL_PUBLICATION",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let publication_id = Uuid::new_v4();
    sqlx::query("INSERT INTO commercial_publication(id,version,name,status,effective_from,effective_to,created_by) VALUES($1,$2,$3,'DRAFT',$4,$5,$6)")
        .bind(publication_id)
        .bind(request.version)
        .bind(request.name.trim())
        .bind(request.effective_from)
        .bind(request.effective_to)
        .bind(request.actor_id.trim())
        .execute(&mut *tx)
        .await?;
    for tax in &request.tax_rules {
        sqlx::query("INSERT INTO commercial_tax_rule(id,publication_id,tax_category,rate_bps,tax_inclusive) VALUES($1,$2,$3,$4,$5)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(tax.tax_category.trim().to_ascii_uppercase())
            .bind(tax.rate_bps)
            .bind(tax.tax_inclusive)
            .execute(&mut *tx)
            .await?;
    }
    for offer in &request.offer_rules {
        let tax_category = offer.tax_category.trim().to_ascii_uppercase();
        let currency =
            CurrencyCode::new(&offer.currency).map_err(|e| AppError::Validation(e.to_string()))?;
        sqlx::query("INSERT INTO commercial_assortment_rule(id,publication_id,sku_id,site_id,channel,sellable) VALUES($1,$2,$3,$4,$5,$6)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(offer.sku_id)
            .bind(&offer.site_id)
            .bind(offer.channel.as_str())
            .bind(offer.sellable)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO commercial_price_rule(id,publication_id,sku_id,site_id,channel,currency,unit_price_minor,tax_category) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(offer.sku_id)
            .bind(&offer.site_id)
            .bind(offer.channel.as_str())
            .bind(currency.as_str())
            .bind(offer.unit_price_minor)
            .bind(tax_category)
            .execute(&mut *tx)
            .await?;
    }
    let response = json!({
        "id": publication_id,
        "version": request.version,
        "name": request.name,
        "status": "DRAFT",
        "tax_rule_count": request.tax_rules.len(),
        "offer_rule_count": request.offer_rules.len(),
        "effective_from": request.effective_from,
        "effective_to": request.effective_to
    });
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

fn validate_publication_request(
    request: &CreateCommercialPublicationRequest,
) -> Result<(), AppError> {
    if request.version <= 0 {
        return Err(AppError::Validation(
            "commercial version must be positive".into(),
        ));
    }
    if request.name.trim().is_empty() || request.actor_id.trim().is_empty() {
        return Err(AppError::Validation(
            "publication name and actor_id are required".into(),
        ));
    }
    if request
        .effective_to
        .is_some_and(|to| to <= request.effective_from)
    {
        return Err(AppError::Validation(
            "effective_to must be after effective_from".into(),
        ));
    }
    if request.tax_rules.is_empty() || request.offer_rules.is_empty() {
        return Err(AppError::Validation(
            "at least one tax rule and offer rule are required".into(),
        ));
    }
    let mut categories = HashSet::new();
    for tax in &request.tax_rules {
        let category = tax.tax_category.trim().to_ascii_uppercase();
        if category.is_empty() || !categories.insert(category) {
            return Err(AppError::Validation(
                "tax categories must be non-empty and unique".into(),
            ));
        }
        if !(0..=100_000).contains(&tax.rate_bps) {
            return Err(AppError::Validation(
                "tax rate basis points are invalid".into(),
            ));
        }
    }
    let mut scopes = HashSet::new();
    for offer in &request.offer_rules {
        if offer.unit_price_minor < 0 {
            return Err(AppError::Validation("unit price cannot be negative".into()));
        }
        CurrencyCode::new(&offer.currency).map_err(|e| AppError::Validation(e.to_string()))?;
        if !categories.contains(&offer.tax_category.trim().to_ascii_uppercase()) {
            return Err(AppError::Validation(format!(
                "offer references unknown tax category {}",
                offer.tax_category
            )));
        }
        if let Some(site) = &offer.site_id {
            SiteId::new(site).map_err(|e| AppError::Validation(e.to_string()))?;
        }
        let scope = (offer.sku_id, offer.site_id.clone(), offer.channel.as_str());
        if !scopes.insert(scope) {
            return Err(AppError::Validation(
                "commercial offer scopes must be unique".into(),
            ));
        }
    }
    Ok(())
}

pub async fn publish_commercial_publication(
    pool: &PgPool,
    publication_id: Uuid,
    request: CommandRequest,
) -> Result<Value, AppError> {
    let digest = payload_digest(&request)?;
    let mut tx = pool.begin().await?;
    if let Some(response) = begin_idempotent(
        &mut tx,
        &request.idempotency_key,
        "PUBLISH_COMMERCIAL_PUBLICATION",
        &digest,
    )
    .await?
    {
        tx.commit().await?;
        return Ok(response);
    }
    let publication =
        sqlx::query("SELECT version,status FROM commercial_publication WHERE id=$1 FOR UPDATE")
            .bind(publication_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("commercial publication".into()))?;
    let status: String = publication.get("status");
    if status != "DRAFT" {
        return Err(AppError::Conflict(format!(
            "publication must be DRAFT, currently {status}"
        )));
    }
    let invalid = sqlx::query("SELECT count(*)::bigint count FROM commercial_price_rule pr LEFT JOIN commercial_tax_rule tr ON tr.publication_id=pr.publication_id AND tr.tax_category=pr.tax_category LEFT JOIN commercial_assortment_rule ar ON ar.publication_id=pr.publication_id AND ar.sku_id=pr.sku_id AND ar.site_id IS NOT DISTINCT FROM pr.site_id AND ar.channel=pr.channel WHERE pr.publication_id=$1 AND (tr.id IS NULL OR ar.id IS NULL)")
        .bind(publication_id)
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    let offer_count = sqlx::query(
        "SELECT count(*)::bigint count FROM commercial_price_rule WHERE publication_id=$1",
    )
    .bind(publication_id)
    .fetch_one(&mut *tx)
    .await?
    .get::<i64, _>("count");
    let incomplete_base = sqlx::query(r#"
WITH channels AS (
    SELECT DISTINCT channel FROM commercial_price_rule WHERE publication_id=$1
), required AS (
    SELECT s.id sku_id,c.channel FROM sku s CROSS JOIN channels c WHERE s.active
)
SELECT count(*)::bigint count FROM required r
WHERE NOT EXISTS(SELECT 1 FROM commercial_price_rule pr WHERE pr.publication_id=$1 AND pr.sku_id=r.sku_id AND pr.channel=r.channel AND pr.site_id IS NULL)
   OR NOT EXISTS(SELECT 1 FROM commercial_assortment_rule ar WHERE ar.publication_id=$1 AND ar.sku_id=r.sku_id AND ar.channel=r.channel AND ar.site_id IS NULL)
"#)
        .bind(publication_id)
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    if invalid > 0 || offer_count == 0 || incomplete_base > 0 {
        return Err(AppError::Conflict(
            "publication must contain coherent rules and a company-wide base offer for every active SKU in each represented channel".into(),
        ));
    }
    sqlx::query("UPDATE commercial_publication SET status='PUBLISHED',published_by=$2,published_at=now() WHERE id=$1")
        .bind(publication_id)
        .bind(request.actor_id.trim())
        .execute(&mut *tx)
        .await?;
    let version: i64 = publication.get("version");
    let response = json!({"id":publication_id,"version":version,"status":"PUBLISHED","offer_rule_count":offer_count,"published_at":Utc::now()});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn resolve_offer(pool: &PgPool, query: ResolveOfferQuery) -> Result<Value, AppError> {
    let mut tx = pool.begin().await?;
    let offer = resolve_offer_in_tx(
        &mut tx,
        query.sku_id,
        &query.site_id,
        query.channel,
        query.at.unwrap_or_else(Utc::now),
        query.publication_id,
    )
    .await?;
    tx.commit().await?;
    Ok(serde_json::to_value(offer)?)
}

pub(super) async fn resolve_offer_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    sku_id: Uuid,
    site_id: &str,
    channel: CommercialChannel,
    at: DateTime<Utc>,
    publication_id: Option<Uuid>,
) -> Result<ResolvedOffer, AppError> {
    SiteId::new(site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let row = sqlx::query(r#"
SELECT cp.id publication_id,cp.version,cp.effective_from,cp.effective_to,
       ar.sellable,pr.currency::text currency,pr.unit_price_minor,pr.tax_category,tr.rate_bps,tr.tax_inclusive
FROM commercial_publication cp
JOIN LATERAL (
    SELECT sellable FROM commercial_assortment_rule
    WHERE publication_id=cp.id AND sku_id=$1 AND channel=$3 AND (site_id=$2 OR site_id IS NULL)
    ORDER BY (site_id IS NOT NULL) DESC LIMIT 1
) ar ON TRUE
JOIN LATERAL (
    SELECT currency,unit_price_minor,tax_category FROM commercial_price_rule
    WHERE publication_id=cp.id AND sku_id=$1 AND channel=$3 AND (site_id=$2 OR site_id IS NULL)
    ORDER BY (site_id IS NOT NULL) DESC LIMIT 1
) pr ON TRUE
JOIN commercial_tax_rule tr ON tr.publication_id=cp.id AND tr.tax_category=pr.tax_category
WHERE cp.status='PUBLISHED' AND cp.effective_from <= $4 AND (cp.effective_to IS NULL OR cp.effective_to > $4)
  AND ($5::uuid IS NULL OR cp.id=$5)
ORDER BY cp.version DESC LIMIT 1
"#)
        .bind(sku_id)
        .bind(site_id)
        .bind(channel.as_str())
        .bind(at)
        .bind(publication_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("published effective commercial offer".into()))?;
    Ok(ResolvedOffer {
        publication_id: row.get("publication_id"),
        version: row.get("version"),
        sku_id,
        site_id: site_id.into(),
        channel,
        sellable: row.get("sellable"),
        currency: CurrencyCode::new(row.get::<String, _>("currency").trim())
            .map_err(|e| AppError::Conflict(e.to_string()))?,
        unit_price_minor: row.get("unit_price_minor"),
        tax_category: row.get("tax_category"),
        tax_rate_bps: row.get("rate_bps"),
        tax_inclusive: row.get("tax_inclusive"),
        effective_from: row.get("effective_from"),
        effective_to: row.get("effective_to"),
    })
}

pub async fn list_commercial_publications(pool: &PgPool) -> Result<Value, AppError> {
    let rows = sqlx::query("SELECT p.id,p.version,p.name,p.status,p.effective_from,p.effective_to,p.created_by,p.created_at,p.published_by,p.published_at,(SELECT count(*)::bigint FROM commercial_price_rule WHERE publication_id=p.id) offer_count FROM commercial_publication p ORDER BY version DESC")
        .fetch_all(pool)
        .await?;
    let items: Vec<Value> = rows.into_iter().map(|row| json!({
        "id":row.get::<Uuid,_>("id"),"version":row.get::<i64,_>("version"),"name":row.get::<String,_>("name"),"status":row.get::<String,_>("status"),
        "effective_from":row.get::<DateTime<Utc>,_>("effective_from"),"effective_to":row.get::<Option<DateTime<Utc>>,_>("effective_to"),
        "created_by":row.get::<String,_>("created_by"),"created_at":row.get::<DateTime<Utc>,_>("created_at"),"published_by":row.get::<Option<String>,_>("published_by"),"published_at":row.get::<Option<DateTime<Utc>>,_>("published_at"),"offer_count":row.get::<i64,_>("offer_count")
    })).collect();
    Ok(json!({"items":items}))
}

pub async fn list_resolved_offers(
    pool: &PgPool,
    site_id: &str,
    channel: CommercialChannel,
    at: DateTime<Utc>,
) -> Result<Value, AppError> {
    SiteId::new(site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let rows = sqlx::query(r#"
SELECT s.id sku_id,s.sku_code,a.article_code,a.name article_name,cp.id publication_id,cp.version,
       ar.sellable,pr.currency::text currency,pr.unit_price_minor,pr.tax_category,tr.rate_bps,tr.tax_inclusive
FROM sku s JOIN article a ON a.id=s.article_id
JOIN LATERAL (
    SELECT id,version FROM commercial_publication
    WHERE status='PUBLISHED' AND effective_from <= $3 AND (effective_to IS NULL OR effective_to > $3)
      AND EXISTS(SELECT 1 FROM commercial_price_rule WHERE publication_id=commercial_publication.id AND sku_id=s.id AND channel=$2 AND (site_id=$1 OR site_id IS NULL))
    ORDER BY version DESC LIMIT 1
) cp ON TRUE
JOIN LATERAL (SELECT sellable FROM commercial_assortment_rule WHERE publication_id=cp.id AND sku_id=s.id AND channel=$2 AND (site_id=$1 OR site_id IS NULL) ORDER BY (site_id IS NOT NULL) DESC LIMIT 1) ar ON TRUE
JOIN LATERAL (SELECT currency,unit_price_minor,tax_category FROM commercial_price_rule WHERE publication_id=cp.id AND sku_id=s.id AND channel=$2 AND (site_id=$1 OR site_id IS NULL) ORDER BY (site_id IS NOT NULL) DESC LIMIT 1) pr ON TRUE
JOIN commercial_tax_rule tr ON tr.publication_id=cp.id AND tr.tax_category=pr.tax_category
WHERE s.active ORDER BY s.sku_code
"#).bind(site_id).bind(channel.as_str()).bind(at).fetch_all(pool).await?;
    let items: Vec<Value> = rows.into_iter().map(|row| json!({
        "sku_id":row.get::<Uuid,_>("sku_id"),"sku_code":row.get::<String,_>("sku_code"),"article_code":row.get::<String,_>("article_code"),"article_name":row.get::<String,_>("article_name"),
        "publication_id":row.get::<Uuid,_>("publication_id"),"version":row.get::<i64,_>("version"),"sellable":row.get::<bool,_>("sellable"),"currency":row.get::<String,_>("currency").trim(),
        "unit_price_minor":row.get::<i64,_>("unit_price_minor"),"tax_category":row.get::<String,_>("tax_category"),"tax_rate_bps":row.get::<i32,_>("rate_bps"),"tax_inclusive":row.get::<bool,_>("tax_inclusive")
    })).collect();
    Ok(json!({"site_id":site_id,"channel":channel.as_str(),"as_of":at,"items":items}))
}
