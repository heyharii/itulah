use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::cloud::{
    application::{
        AppError, CommandRequest, CreateCommercialPublicationRequest, ResolveOfferQuery,
    },
    domain::{CommercialChannel, CurrencyCode, ResolvedOffer, SiteId},
};
use chrono::{DateTime, Utc};
use pricing_engine::{price_catalog, CartLine, PricingContext};
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
        sqlx::query("INSERT INTO commercial_price_rule(id,publication_id,sku_id,site_id,site_ids,tier,channel,currency,unit_price_minor,tax_category) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(offer.sku_id)
            .bind(&offer.site_id)
            .bind(group_of(offer.site_ids.as_deref()))
            .bind(&offer.tier)
            .bind(offer.channel.as_str())
            .bind(currency.as_str())
            .bind(offer.unit_price_minor)
            .bind(tax_category)
            .execute(&mut *tx)
            .await?;
    }
    for markdown in &request.markdowns {
        sqlx::query("INSERT INTO commercial_markdown(id,publication_id,markdown_id,sku_id,sku_code,article_code,site_id,site_ids,tier,replacement_unit_price_minor,priority,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$12,$13,$8,$9,$10,$11)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(markdown.markdown_id.trim())
            .bind(markdown.sku_id)
            .bind(markdown.sku_code.as_deref().map(str::trim))
            .bind(markdown.article_code.as_deref().map(str::trim))
            .bind(&markdown.site_id)
            .bind(markdown.replacement_unit_price_minor)
            .bind(i32::try_from(markdown.priority).unwrap_or(i32::MAX))
            .bind(markdown.effective_from)
            .bind(markdown.effective_to)
            .bind(group_of(markdown.site_ids.as_deref()))
            .bind(&markdown.tier)
            .execute(&mut *tx)
            .await?;
    }
    for campaign in &request.campaigns {
        sqlx::query("INSERT INTO commercial_campaign(id,publication_id,campaign_id,name,status,valid_from,valid_to,budget_minor,max_uses,max_uses_per_customer) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(campaign.campaign_id.trim())
            .bind(campaign.name.trim())
            .bind(campaign.status.trim().to_ascii_uppercase())
            .bind(campaign.valid_from)
            .bind(campaign.valid_to)
            .bind(campaign.budget_minor)
            .bind(campaign.max_uses.map(|max| i32::try_from(max).unwrap_or(i32::MAX)))
            .bind(
                campaign
                    .max_uses_per_customer
                    .map(|max| i32::try_from(max).unwrap_or(i32::MAX)),
            )
            .execute(&mut *tx)
            .await?;
    }
    for rule in &request.rules {
        // Stored as the engine serialises it, so what a shop receives is what
        // was authored — not a reconstruction from columns that might have lost
        // a field this build does not yet know about.
        let definition =
            serde_json::to_value(rule).map_err(|error| AppError::Validation(error.to_string()))?;
        sqlx::query("INSERT INTO commercial_rule(id,publication_id,rule_id,name,definition,status,priority) VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(rule.rule_id.trim())
            .bind(rule.name.trim())
            .bind(definition)
            .bind(format!("{:?}", rule.status).to_uppercase())
            .bind(i32::try_from(rule.priority).unwrap_or(i32::MAX))
            .execute(&mut *tx)
            .await?;
    }
    for coupon in &request.coupons {
        sqlx::query("INSERT INTO commercial_coupon(id,publication_id,code,rule_id,active,customer_id,valid_from,valid_to,max_uses) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(coupon.code.trim())
            .bind(coupon.rule_id.trim())
            .bind(coupon.active)
            .bind(&coupon.customer_id)
            .bind(coupon.valid_from)
            .bind(coupon.valid_to)
            .bind(coupon.max_uses.map(|max| i32::try_from(max).unwrap_or(i32::MAX)))
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

/// A group of shop ids, or nothing.
///
/// An empty list is stored as NULL rather than an empty array. The two read the
/// same to a careless query and mean opposite things: no group named, versus a
/// group that names nobody — and the second would price at nowhere.
fn group_of(site_ids: Option<&[String]>) -> Option<Vec<String>> {
    match site_ids {
        Some(ids) if !ids.is_empty() => Some(ids.to_vec()),
        _ => None,
    }
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
    // A markdown that names neither a product nor a style would clear the whole
    // shop. Refused here, where the person who wrote it is still looking.
    let mut markdown_ids = HashSet::new();
    for markdown in &request.markdowns {
        if markdown.markdown_id.trim().is_empty() {
            return Err(AppError::Validation("markdown_id is required".into()));
        }
        if !markdown_ids.insert(markdown.markdown_id.trim().to_string()) {
            return Err(AppError::Validation(
                "markdown ids must be unique within a publication".into(),
            ));
        }
        let names_sku = markdown
            .sku_code
            .as_deref()
            .is_some_and(|code| !code.trim().is_empty());
        let names_article = markdown
            .article_code
            .as_deref()
            .is_some_and(|code| !code.trim().is_empty());
        if !names_sku && !names_article {
            return Err(AppError::Validation(format!(
                "markdown {} must name a sku_code or an article_code",
                markdown.markdown_id
            )));
        }
        if markdown.replacement_unit_price_minor < 0 {
            return Err(AppError::Validation(
                "markdown price cannot be negative".into(),
            ));
        }
        if markdown
            .effective_to
            .is_some_and(|to| to <= markdown.effective_from)
        {
            return Err(AppError::Validation(
                "markdown effective_to must be after effective_from".into(),
            ));
        }
        if let Some(site) = &markdown.site_id {
            SiteId::new(site).map_err(|e| AppError::Validation(e.to_string()))?;
        }
    }

    let mut campaign_ids = HashSet::new();
    for campaign in &request.campaigns {
        if campaign.campaign_id.trim().is_empty() || campaign.name.trim().is_empty() {
            return Err(AppError::Validation(
                "a campaign needs an id and a name".into(),
            ));
        }
        if !campaign_ids.insert(campaign.campaign_id.trim().to_string()) {
            return Err(AppError::Validation(
                "campaign ids must be unique within a publication".into(),
            ));
        }
        if campaign
            .valid_to
            .zip(campaign.valid_from)
            .is_some_and(|(to, from)| to <= from)
        {
            return Err(AppError::Validation(
                "campaign valid_to must be after valid_from".into(),
            ));
        }
    }

    let mut rule_ids = HashSet::new();
    for rule in &request.rules {
        if rule.rule_id.trim().is_empty() || rule.name.trim().is_empty() {
            return Err(AppError::Validation(
                "a promotion needs a rule_id and a name".into(),
            ));
        }
        if !rule_ids.insert(rule.rule_id.trim().to_string()) {
            return Err(AppError::Validation(
                "promotion rule ids must be unique within a publication".into(),
            ));
        }
        // A shop refuses a promotion whose campaign it does not hold, so a rule
        // naming a campaign this publication does not define would ship an
        // offer that can never apply anywhere. Caught here, where the author is
        // still looking, rather than as silence at thirty tills.
        if let Some(campaign_id) = &rule.campaign_id {
            if !campaign_ids.contains(campaign_id.trim()) {
                return Err(AppError::Validation(format!(
                    "promotion {} names campaign {}, which this publication does not define",
                    rule.rule_id, campaign_id
                )));
            }
        }
    }

    // A coupon that opens nothing is a code a cashier will type in vain.
    let mut codes = HashSet::new();
    for coupon in &request.coupons {
        if coupon.code.trim().is_empty() {
            return Err(AppError::Validation("coupon code is required".into()));
        }
        if !codes.insert(coupon.code.trim().to_string()) {
            return Err(AppError::Validation(
                "coupon codes must be unique within a publication".into(),
            ));
        }
        if !rule_ids.contains(coupon.rule_id.trim()) {
            return Err(AppError::Validation(format!(
                "coupon {} unlocks {}, which this publication does not define",
                coupon.code, coupon.rule_id
            )));
        }
    }

    let mut scopes = HashSet::new();
    for offer in &request.offer_rules {
        // One level per price. Two would have no single right reading, and
        // picking one silently is how the centre and a till come to disagree.
        let levels = u8::from(offer.site_id.is_some())
            + u8::from(offer.site_ids.as_ref().is_some_and(|ids| !ids.is_empty()))
            + u8::from(offer.tier.is_some());
        if levels > 1 {
            return Err(AppError::Validation(
                "an offer may name a shop, a group of shops, or a tier — not more than one"
                    .into(),
            ));
        }
        if let Some(site_ids) = &offer.site_ids {
            for site in site_ids {
                SiteId::new(site).map_err(|e| AppError::Validation(e.to_string()))?;
            }
        }
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
    // Every active SKU must have a company-wide price — somewhere in the
    // published set, not necessarily in this book.
    //
    // The rule used to demand it in THIS publication, which made sense while a
    // SKU could exist unpriced: without that check, one nobody had mentioned
    // was unsellable. Setting up an article now publishes its price, so that
    // cannot happen any more, and the old reading had turned into an
    // obstruction — a merchandiser changing twenty prices was made to restate
    // five thousand that had not changed.
    //
    // So a price book is now a list of changes rather than a full replacement.
    // Anything it does not mention keeps the price the last book gave it, which
    // is how the pricing engine has always resolved: the newest publication
    // that names a product wins, and one that never names it changes nothing.
    let incomplete_base = sqlx::query(r#"
WITH channels AS (
    SELECT DISTINCT channel FROM commercial_price_rule WHERE publication_id=$1
), required AS (
    SELECT s.id sku_id,c.channel FROM sku s CROSS JOIN channels c WHERE s.active
)
SELECT count(*)::bigint count FROM required r
WHERE NOT EXISTS(
        SELECT 1 FROM commercial_price_rule pr
          JOIN commercial_publication p ON p.id=pr.publication_id
         WHERE pr.sku_id=r.sku_id AND pr.channel=r.channel AND pr.site_id IS NULL
           AND (pr.publication_id=$1 OR p.status='PUBLISHED'))
   OR NOT EXISTS(
        SELECT 1 FROM commercial_assortment_rule ar
          JOIN commercial_publication p ON p.id=ar.publication_id
         WHERE ar.sku_id=r.sku_id AND ar.channel=r.channel AND ar.site_id IS NULL
           AND (ar.publication_id=$1 OR p.status='PUBLISHED'))
"#)
        .bind(publication_id)
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    if invalid > 0 || offer_count == 0 || incomplete_base > 0 {
        return Err(AppError::Conflict(
            "a publication needs coherent rules, and every active SKU in each \
             channel it touches must have a company-wide price — in this book or \
             in one already published"
                .into(),
        ));
    }
    sqlx::query("UPDATE commercial_publication SET status='PUBLISHED',published_by=$2,published_at=now() WHERE id=$1")
        .bind(publication_id)
        .bind(request.actor_id.trim())
        .execute(&mut *tx)
        .await?;
    let version: i64 = publication.get("version");
    let delivered_to =
        dispatch_publication(&mut tx, publication_id, request.actor_id.trim()).await?;
    let response = json!({"id":publication_id,"version":version,"status":"PUBLISHED","offer_rule_count":offer_count,"published_at":Utc::now(),"delivered_to":delivered_to});
    complete_idempotent(&mut tx, &request.idempotency_key, &response).await?;
    tx.commit().await?;
    Ok(response)
}

/// Send a freshly published price book to every shop, in the transaction that
/// published it.
///
/// Publishing used to be a status change and nothing more. The command type
/// existed, the shops knew how to apply it, and no code ever issued one — so a
/// price approved at the centre stayed at the centre, and the fleet went on
/// selling at whatever it had been selling at. This is the missing step.
///
/// It runs inside the caller's transaction on purpose. A publication that is
/// PUBLISHED here but undelivered is exactly the split that produced the
/// original silence: either the book is published and on its way to every
/// shop, or neither happened.
///
/// Each shop receives only the rules that bind it — the company-wide ones and
/// its own. A branch has no use for another branch's prices and no business
/// holding them.
pub(super) async fn dispatch_publication(
    tx: &mut Transaction<'_, Postgres>,
    publication_id: Uuid,
    issued_by: &str,
) -> Result<Vec<String>, AppError> {
    let publication = sqlx::query(
        "SELECT version,name,effective_from,effective_to
           FROM commercial_publication WHERE id=$1",
    )
    .bind(publication_id)
    .fetch_one(&mut **tx)
    .await?;

    let tax_rules: Vec<Value> = sqlx::query(
        "SELECT tax_category,rate_bps,tax_inclusive
           FROM commercial_tax_rule WHERE publication_id=$1 ORDER BY tax_category",
    )
    .bind(publication_id)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "tax_category": row.get::<String, _>("tax_category"),
            "rate_bps": row.get::<i32, _>("rate_bps"),
            "tax_inclusive": row.get::<bool, _>("tax_inclusive"),
        })
    })
    .collect();

    let shops = sqlx::query(
        "SELECT origin_id,site_id FROM sync_origin_credential
          WHERE node_role='STORE' AND site_id IS NOT NULL ORDER BY origin_id",
    )
    .fetch_all(&mut **tx)
    .await?;

    let mut delivered = Vec::with_capacity(shops.len());
    for shop in shops {
        let origin_id: String = shop.get("origin_id");
        let site_id: String = shop.get("site_id");
        // `sellable` lives on the assortment rule, not the price rule; the two
        // are authored together and the shop receives them as one thing.
        let rules: Vec<Value> = sqlx::query(
            "SELECT pr.sku_id,s.sku_code,pr.site_id,pr.site_ids,pr.tier,pr.channel,ar.sellable,
                    pr.currency::text currency,pr.unit_price_minor,pr.tax_category
               FROM commercial_price_rule pr
               JOIN sku s ON s.id=pr.sku_id
               JOIN commercial_assortment_rule ar
                 ON ar.publication_id=pr.publication_id AND ar.sku_id=pr.sku_id
                AND ar.channel=pr.channel AND ar.site_id IS NOT DISTINCT FROM pr.site_id
              WHERE pr.publication_id=$1
                AND (pr.site_id IS NULL OR pr.site_id=$2)
                AND (pr.site_ids IS NULL OR $2 = ANY(pr.site_ids))
              ORDER BY s.sku_code,pr.channel,(pr.site_id IS NOT NULL)",
        )
        .bind(publication_id)
        .bind(&site_id)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| {
            json!({
                "sku_id": row.get::<Uuid, _>("sku_id"),
                "sku_code": row.get::<String, _>("sku_code"),
                "site_id": row.get::<Option<String>, _>("site_id"),
                "site_ids": row.get::<Option<Vec<String>>, _>("site_ids"),
                "tier": row.get::<Option<String>, _>("tier"),
                "channel": row.get::<String, _>("channel"),
                "sellable": row.get::<bool, _>("sellable"),
                "currency": row.get::<String, _>("currency").trim(),
                "unit_price_minor": row.get::<i64, _>("unit_price_minor"),
                "tax_category": row.get::<String, _>("tax_category"),
            })
        })
        .collect();

        // A shop with nothing to sell is not sent an empty book: the receiving
        // validator rejects one, and rightly — it cannot tell an empty
        // publication from a truncated one.
        if rules.is_empty() {
            continue;
        }

        // Clearance, scoped the same way prices are: the company-wide ones and
        // this shop's own. A branch has no business holding another branch's.
        let markdowns: Vec<Value> = sqlx::query(
            "SELECT markdown_id,sku_code,article_code,site_id,site_ids,tier,
                    replacement_unit_price_minor,priority,effective_from,effective_to
               FROM commercial_markdown
              WHERE publication_id=$1
                AND (site_id IS NULL OR site_id=$2)
                AND (site_ids IS NULL OR $2 = ANY(site_ids))
              ORDER BY markdown_id",
        )
        .bind(publication_id)
        .bind(&site_id)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| {
            json!({
                "markdown_id": row.get::<String, _>("markdown_id"),
                "sku_code": row.get::<Option<String>, _>("sku_code"),
                "article_code": row.get::<Option<String>, _>("article_code"),
                "site_id": row.get::<Option<String>, _>("site_id"),
                "site_ids": row.get::<Option<Vec<String>>, _>("site_ids"),
                "tier": row.get::<Option<String>, _>("tier"),
                "replacement_unit_price_minor": row.get::<i64, _>("replacement_unit_price_minor"),
                "priority": row.get::<i32, _>("priority"),
                "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
                "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
            })
        })
        .collect();

        // Promotions go to every shop as authored. Unlike prices they carry
        // their own site scope inside the document, and the engine at the shop
        // enforces it — there is no column here to filter on without parsing
        // the rule, and parsing it here would put a second interpreter of rule
        // semantics in the system, which is the one thing this design exists to
        // avoid.
        let promotion_rules: Vec<Value> = sqlx::query(
            "SELECT definition FROM commercial_rule
              WHERE publication_id=$1 ORDER BY rule_id",
        )
        .bind(publication_id)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| row.get::<Value, _>("definition"))
        .collect();

        let coupons: Vec<Value> = sqlx::query(
            "SELECT code,rule_id,active,customer_id,valid_from,valid_to,max_uses,used
               FROM commercial_coupon WHERE publication_id=$1 ORDER BY code",
        )
        .bind(publication_id)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| {
            json!({
                "code": row.get::<String, _>("code"),
                "rule_id": row.get::<String, _>("rule_id"),
                "active": row.get::<bool, _>("active"),
                "customer_id": row.get::<Option<String>, _>("customer_id"),
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                "used": row.get::<i32, _>("used"),
            })
        })
        .collect();

        // Campaigns go to every shop that gets any of this book. A shop
        // refuses a promotion whose campaign it does not hold, so sending the
        // rules without their envelopes would silently switch the offers off.
        let campaigns: Vec<Value> = sqlx::query(
            "SELECT campaign_id,name,status,valid_from,valid_to,budget_minor,
                    spent_minor,max_uses,used,max_uses_per_customer
               FROM commercial_campaign WHERE publication_id=$1 ORDER BY campaign_id",
        )
        .bind(publication_id)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| {
            json!({
                "campaign_id": row.get::<String, _>("campaign_id"),
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
                "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
                "budget_minor": row.get::<Option<i64>, _>("budget_minor"),
                "spent_minor": row.get::<i64, _>("spent_minor"),
                "max_uses": row.get::<Option<i32>, _>("max_uses"),
                "used": row.get::<i32, _>("used"),
                "max_uses_per_customer": row.get::<Option<i32>, _>("max_uses_per_customer"),
            })
        })
        .collect();

        let payload = json!({
            "publication_id": publication_id,
            "version": publication.get::<i64, _>("version"),
            "name": publication.get::<String, _>("name"),
            "effective_from": publication.get::<DateTime<Utc>, _>("effective_from"),
            "effective_to": publication.get::<Option<DateTime<Utc>>, _>("effective_to"),
            "tax_rules": tax_rules,
            "price_rules": rules,
            "markdowns": markdowns,
            "rules": promotion_rules,
            "coupons": coupons,
            "campaigns": campaigns,
        });
        super::sync::issue_command_tx(
            tx,
            crate::cloud::domain::COMMAND_ACTIVATE_PUBLICATION,
            &payload,
            issued_by,
            // No expiry. A price book that lapsed in the queue would leave a
            // shop selling at the previous version with nothing to show why.
            None,
            std::slice::from_ref(&origin_id),
        )
        .await?;
        delivered.push(origin_id);
    }
    Ok(delivered)
}

/// Tell every shop what promotions have given away so far.
///
/// Sent on its own lane rather than folded into a publication, because the two
/// change at different speeds: a price book changes with the season, these
/// numbers with every sale in the fleet. Issued as a whole picture so a shop
/// that missed one is out of date rather than permanently wrong.
///
/// What a shop enforces from this is always behind. It cannot be otherwise —
/// no till knows what the other shops sold this morning — so a budget stops a
/// promotion some time after the money ran out, not at the rupiah. The number
/// that must not be exceeded is the one here, at the centre, where the counting
/// happens.
pub async fn publish_commercial_usage(
    pool: &PgPool,
    issued_by: &str,
    targets: &[String],
) -> Result<(Uuid, Vec<String>), AppError> {
    let counted_at = Utc::now();
    let counts: Vec<Value> = sqlx::query(
        "SELECT kind, key, uses, spent_minor FROM commercial_usage ORDER BY kind, key",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "kind": row.get::<String, _>("kind"),
            "key": row.get::<String, _>("key"),
            "uses": row.get::<i64, _>("uses"),
            "spent_minor": row.get::<i64, _>("spent_minor"),
        })
    })
    .collect();

    let payload = json!({ "counted_at": counted_at, "counts": counts });
    super::sync::issue_command(
        pool,
        crate::cloud::domain::COMMAND_COMMERCIAL_USAGE,
        &payload,
        issued_by,
        // No expiry: a shop that has been offline for a week needs the newest
        // count it can get, not to be told the message is too old to use.
        None,
        targets,
    )
    .await
}

pub async fn resolve_offer(pool: &PgPool, query: ResolveOfferQuery) -> Result<Value, AppError> {
    // Answered by the shared evaluator, not by SQL of its own.
    //
    // This endpoint is what a merchandiser opens to check what a shop is
    // selling for — so of all the places that could disagree with a till, it is
    // the worst. It used to read `commercial_price_rule` and nothing else,
    // which meant a shirt on clearance showed here at its list price while the
    // counter charged the clearance price. The screen you check prices on is
    // not the place to have a second opinion.
    let at = query.at.unwrap_or_else(Utc::now);
    SiteId::new(&query.site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let mut tx = pool.begin().await?;
    let pricing = super::pricing::load_site_pricing(
        &mut tx,
        &query.site_id,
        query.channel.as_str(),
        at,
    )
    .await?;
    tx.commit().await?;

    let Some(sku_code) = pricing.sku_code_by_id.get(&query.sku_id).cloned() else {
        return Err(AppError::NotFound(
            "an effective offer for that SKU at that store and channel".into(),
        ));
    };
    let context = PricingContext::new(&query.site_id, query.channel.as_str(), at);
    let priced = price_catalog(
        &pricing.snapshot,
        &context,
        &[CartLine::new(sku_code.clone(), 1)],
    );
    let Some(entry) = priced.into_iter().next() else {
        return Err(AppError::NotFound(
            "an effective offer for that SKU at that store and channel".into(),
        ));
    };
    Ok(json!({
        "sku_id": query.sku_id,
        "sku_code": entry.sku_code,
        "site_id": query.site_id,
        "channel": query.channel.as_str(),
        "version": entry.publication_version,
        "sellable": true,
        "currency": entry.currency.0,
        // What is charged, and what it would have been without the clearance.
        "unit_price_minor": entry.unit_price.minor,
        "base_unit_price_minor": entry.base_unit_price.minor,
        "price_source": format!("{:?}", entry.source),
        "markdown_id": entry.markdown_id,
        "tax_category": entry.tax_category,
        "as_of": at,
    }))
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

/// Everything a shop may sell, at the price its own till will charge.
///
/// The same evaluator the till runs, over every catalogued product instead of
/// the few in a basket. Before this it was a hand-written cascade that knew
/// about price rules and nothing about clearance, group prices or member tiers
/// — so the list a merchandiser checked and the price a customer paid were
/// computed by two different pieces of code from two different subsets of the
/// same data.
///
/// Promotions are deliberately absent: they are statements about a basket, and
/// "buy two, get twenty per cent" is not this product's price. A shelf edge
/// that advertised it would promise a number the counter will not honour for
/// one item.
pub async fn list_resolved_offers(
    pool: &PgPool,
    site_id: &str,
    channel: CommercialChannel,
    at: DateTime<Utc>,
) -> Result<Value, AppError> {
    SiteId::new(site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    let mut tx = pool.begin().await?;
    let pricing = super::pricing::load_site_pricing(&mut tx, site_id, channel.as_str(), at).await?;

    // Names for the screen. The engine deals in codes and prices; what a person
    // reads is the article and its name.
    let named: std::collections::BTreeMap<String, (String, String)> = sqlx::query(
        "SELECT s.sku_code, a.article_code, a.name FROM sku s
           JOIN article a ON a.id = s.article_id WHERE s.active",
    )
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("sku_code"),
            (row.get("article_code"), row.get("name")),
        )
    })
    .collect();
    tx.commit().await?;

    let context = PricingContext::new(site_id, channel.as_str(), at);
    let products: Vec<CartLine> = pricing
        .sku_id_by_code
        .keys()
        .map(|code| CartLine::new(code.clone(), 1))
        .collect();

    let items: Vec<Value> = price_catalog(&pricing.snapshot, &context, &products)
        .into_iter()
        .map(|entry| {
            let (article_code, article_name) = named
                .get(&entry.sku_code)
                .cloned()
                .unwrap_or_else(|| (String::new(), String::new()));
            json!({
                "sku_id": pricing.sku_id_by_code.get(&entry.sku_code),
                "sku_code": entry.sku_code,
                "article_code": article_code,
                "article_name": article_name,
                "version": entry.publication_version,
                "sellable": true,
                "currency": entry.currency.0,
                "unit_price_minor": entry.unit_price.minor,
                "base_unit_price_minor": entry.base_unit_price.minor,
                "price_source": format!("{:?}", entry.source),
                "markdown_id": entry.markdown_id,
                "tax_category": entry.tax_category,
            })
        })
        .collect();

    Ok(json!({
        "site_id": site_id,
        "channel": channel.as_str(),
        "as_of": at,
        "item_count": items.len(),
        "items": items,
    }))
}
