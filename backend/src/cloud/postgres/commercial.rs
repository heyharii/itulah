use super::{begin_idempotent, complete_idempotent, payload_digest};
use crate::cloud::{
    application::{
        AppError, CampaignSwitchRequest, CommandRequest, CreateCommercialPublicationRequest,
        ResolveOfferQuery,
    },
    domain::{CommercialChannel, CurrencyCode, SiteId},
};
use chrono::{DateTime, Utc};
use pricing_engine::{price_catalog, CartLine};
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
    // A book's number has to climb, and one authority has to say what the next
    // one is.
    //
    // The engine ranks by version before anything else, so a book numbered
    // below one already written loses every product the higher book names — it
    // publishes, it dispatches, and it changes nothing. Silently, which is the
    // shape of fault this system keeps paying for.
    //
    // The lock is the same one `tagging.rs` takes when a setup allocates a
    // number, and it is taken here for the same reason: two books written at
    // the same moment would otherwise read the same maximum and pick the same
    // next number. The unique index would catch that — loudly, and after the
    // work — but a lock costs nothing and refuses earlier.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('commercial_publication_version'))")
        .execute(&mut *tx)
        .await?;
    let highest: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM commercial_publication")
            .fetch_one(&mut *tx)
            .await?;
    if request.version <= highest {
        return Err(AppError::Validation(format!(
            "book v{} would be written below v{highest}, which is already here. \
             The newest book wins, so this one would publish and change nothing — \
             number it v{} or later.",
            request.version,
            highest + 1
        )));
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
        sqlx::query("INSERT INTO commercial_price_rule(id,publication_id,sku_id,site_id,site_ids,channel,currency,unit_price_minor,tax_category) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(offer.sku_id)
            .bind(&offer.site_id)
            .bind(group_of(offer.site_ids.as_deref()))
            .bind(offer.channel.as_str())
            .bind(currency.as_str())
            .bind(offer.unit_price_minor)
            .bind(tax_category)
            .execute(&mut *tx)
            .await?;
    }
    for markdown in &request.markdowns {
        sqlx::query("INSERT INTO commercial_markdown(id,publication_id,markdown_id,sku_id,sku_code,article_code,site_id,site_ids,replacement_unit_price_minor,priority,effective_from,effective_to,campaign_id,iso_weekdays,from_minute,to_minute) VALUES($1,$2,$3,$4,$5,$6,$7,$12,$8,$9,$10,$11,$13,$14,$15,$16)")
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
            .bind(markdown.campaign_id.as_deref().map(str::trim))
            .bind(
                markdown
                    .iso_weekdays
                    .iter()
                    .map(|day| i16::try_from(*day).unwrap_or(0))
                    .collect::<Vec<i16>>(),
            )
            .bind(markdown.from_minute.map(|m| i32::try_from(m).unwrap_or(0)))
            .bind(markdown.to_minute.map(|m| i32::try_from(m).unwrap_or(0)))
            .execute(&mut *tx)
            .await?;
    }
    for campaign in &request.campaigns {
        sqlx::query("INSERT INTO commercial_campaign(id,publication_id,campaign_id,name,status,valid_from,valid_to,budget_minor,max_uses,image_url,headline,terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(Uuid::new_v4())
            .bind(publication_id)
            .bind(campaign.campaign_id.trim())
            .bind(campaign.name.trim())
            .bind(campaign.status.trim().to_ascii_uppercase())
            .bind(campaign.valid_from)
            .bind(campaign.valid_to)
            .bind(campaign.budget_minor)
            .bind(campaign.max_uses.map(|max| i32::try_from(max).unwrap_or(i32::MAX)))
            .bind(campaign.image_url.as_deref().map(str::trim))
            .bind(campaign.headline.as_deref().map(str::trim))
            .bind(campaign.terms.as_deref())
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

/// What the fleet cannot honour.
///
/// This gate used to hold three more entries: a tier price, a margin effect and
/// a cumulative condition, each authorable and each doing nothing because the
/// input the engine needed was supplied by nobody. They are gone now — not the
/// refusal, the concepts. A gate is a promise to wire something up later, and
/// after long enough an unkept promise is just a field somebody will eventually
/// fill in.
///
/// What is left is refused for the same reason those were: a form field that
/// silently does not apply is worse than a field that is not there. The
/// promotion looks authored, the shelf ticket gets printed, and the counter
/// charges something else.
fn refuse_what_the_fleet_cannot_honour(
    request: &CreateCommercialPublicationRequest,
) -> Result<(), AppError> {
    for rule in &request.rules {
        // A free item is a physical unit, and this system sells physical units
        // by EPC.
        //
        // The engine grants one correctly: it emits a `FreeLine` and says, in
        // its own doc-comment, that the caller must append it to the sale "or
        // the shirt walks out of the shop and the stock still says it is on the
        // shelf". No caller does. `complete_sale` builds its movement, its sale
        // lines and its fact from the scanned EPCs alone, so the granted line
        // is returned to the till and dropped — while `commercial_usage` is
        // charged the full value of a shirt that never left the ledger.
        //
        // Refused rather than half-implemented, because granting an
        // *unidentified* unit is not expressible here: the till would have to
        // be handed a specific EPC to give away, and nothing chooses one. When
        // that exists this check comes out.
        if matches!(rule.effect, pricing_engine::Effect::FreeItem { .. }) {
            return Err(AppError::Validation(format!(
                "promotion {} gives an item away, and a shop sells by EPC — nothing \
                 chooses which unit is given, so the goods would leave the shop \
                 while the stock still said they were on the shelf. Use a fixed \
                 price or a percentage.",
                rule.rule_id
            )));
        }
    }
    Ok(())
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
    // A book is a list of changes, and a book carrying no changes is the one
    // fault this whole area keeps producing: it authors, it publishes, it
    // dispatches, and nothing anywhere is different.
    if request.offer_rules.is_empty()
        && request.markdowns.is_empty()
        && request.rules.is_empty()
        && request.coupons.is_empty()
        && request.campaigns.is_empty()
    {
        return Err(AppError::Validation(
            "a price book has to change something: a price, a markdown, a promotion, \
             a coupon or a campaign."
                .into(),
        ));
    }
    // Only when there are prices to categorise. A promotion-only book used to
    // be impossible: it had to restate a base price and a tax category it did
    // not mean to touch, and restating a price is how a book meant to add a
    // discount silently reprices the range instead — the newest book naming a
    // product wins, whether or not the author meant it to.
    if request.offer_rules.is_empty() {
        if !request.tax_rules.is_empty() {
            return Err(AppError::Validation(
                "this book sets no prices, so its tax rules would categorise nothing.".into(),
            ));
        }
    } else if request.tax_rules.is_empty() {
        return Err(AppError::Validation(
            "a book that sets prices needs at least one tax rule to categorise them.".into(),
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

    refuse_what_the_fleet_cannot_honour(request)?;

    let mut scopes = HashSet::new();
    for offer in &request.offer_rules {
        // One level per price. Two would have no single right reading, and
        // picking one silently is how the centre and a till come to disagree.
        let levels = u8::from(offer.site_id.is_some())
            + u8::from(offer.site_ids.as_ref().is_some_and(|ids| !ids.is_empty()));
        if levels > 1 {
            return Err(AppError::Validation(
                "an offer may name a shop or a group of shops, not both".into(),
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
    // The number has to still be the highest, not just have been when it was
    // allocated.
    //
    // Writing a book checks that; publishing one used to check only the status.
    // Between the two, an article setup publishes at MAX+1 and dispatches
    // immediately, so a draft that sat for a week goes out AFTER the books that
    // overtook it. A shop replaces these four by id, so the older book then
    // walks the newer one backwards — a paused campaign resumes, an ended
    // clearance comes back — and the activation screen reports the shop as
    // behind rather than as rolled back, which reads like sync lag.
    let version: i64 = publication.get("version");
    let highest_published: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) FROM commercial_publication WHERE status = 'PUBLISHED'",
    )
    .fetch_one(&mut *tx)
    .await?;
    if version <= highest_published {
        return Err(AppError::Conflict(format!(
            "this book is numbered {version} and {highest_published} is already published. \
             The newest book wins, so publishing this one would take the fleet backwards — \
             write it again at the next number."
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
    let incomplete_base = sqlx::query(
        r#"
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
"#,
    )
    .bind(publication_id)
    .fetch_one(&mut *tx)
    .await?
    .get::<i64, _>("count");
    // What else this book carries, so a promotion-only one is not judged by a
    // rule about prices.
    //
    // Authoring already allows a book with no prices in it — restating a base
    // price to attach a discount is how a book meant to add twenty per cent off
    // silently reprices the range — but publishing still demanded one, so such
    // a book could be written, saved and never sent, and the refusal spoke
    // about prices to an author who had deliberately set none.
    let other_changes: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM commercial_markdown WHERE publication_id=$1)
              + (SELECT count(*) FROM commercial_rule     WHERE publication_id=$1)
              + (SELECT count(*) FROM commercial_coupon   WHERE publication_id=$1)
              + (SELECT count(*) FROM commercial_campaign WHERE publication_id=$1)",
    )
    .bind(publication_id)
    .fetch_one(&mut *tx)
    .await?;
    if offer_count == 0 && other_changes == 0 {
        return Err(AppError::Conflict(
            "this book changes nothing: no price, markdown, promotion, coupon or \
             campaign. Publishing it would reach every shop and leave all of them \
             exactly as they were."
                .into(),
        ));
    }
    // The completeness checks are about prices, so they only apply to a book
    // that sets some.
    if invalid > 0 || (offer_count > 0 && incomplete_base > 0) {
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

    // Promotions, their codes and their envelopes are the same for every shop:
    // none of the three queries below names a site. Read inside the loop they
    // were read once per branch — thirty identical round trips for one book,
    // inside the transaction that publishes it and therefore holding it open
    // that much longer.
    //
    // Prices and markdowns stay in the loop because they genuinely differ: each
    // shop is sent the company-wide rows and its own, and nothing else.
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
        // Without the counters. What a code has been redeemed is counted in
        // `commercial_usage` and broadcast on its own lane; sending the book's
        // frozen copy alongside gave a shop two numbers for one fact, and it
        // overwrote one with the other on arrival anyway.
        "SELECT code,rule_id,active,customer_id,valid_from,valid_to,max_uses
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
        })
    })
    .collect();

    let campaigns: Vec<Value> = sqlx::query(
        "SELECT campaign_id,name,status,valid_from,valid_to,budget_minor,
                max_uses,image_url,headline,terms
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
            "max_uses": row.get::<Option<i32>, _>("max_uses"),
            // What a shopper reads. Carried to every shop rather than fetched
            // on demand: a till that had to ask the centre what the banner says
            // is a till with a blank banner the moment the line drops.
            "image_url": row.get::<Option<String>, _>("image_url"),
            "headline": row.get::<Option<String>, _>("headline"),
            "terms": row.get::<Option<String>, _>("terms"),
        })
    })
    .collect();

    let mut delivered = Vec::with_capacity(shops.len());
    for shop in shops {
        let origin_id: String = shop.get("origin_id");
        let site_id: String = shop.get("site_id");
        // `sellable` lives on the assortment rule, not the price rule; the two
        // are authored together and the shop receives them as one thing.
        let rules: Vec<Value> = sqlx::query(
            "SELECT pr.sku_id,s.sku_code,pr.site_id,pr.site_ids,pr.channel,ar.sellable,
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
                "channel": row.get::<String, _>("channel"),
                "sellable": row.get::<bool, _>("sellable"),
                "currency": row.get::<String, _>("currency").trim(),
                "unit_price_minor": row.get::<i64, _>("unit_price_minor"),
                "tax_category": row.get::<String, _>("tax_category"),
            })
        })
        .collect();

        // Clearance, scoped the same way prices are: the company-wide ones and
        // this shop's own. A branch has no business holding another branch's.
        let markdowns: Vec<Value> = sqlx::query(
            "SELECT markdown_id,sku_code,article_code,site_id,site_ids,
                    replacement_unit_price_minor,priority,effective_from,effective_to,
                    campaign_id,iso_weekdays,from_minute,to_minute
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
                "replacement_unit_price_minor": row.get::<i64, _>("replacement_unit_price_minor"),
                "priority": row.get::<i32, _>("priority"),
                "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
                "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
                "campaign_id": row.get::<Option<String>, _>("campaign_id"),
                // When in the week and in the day. A flash sale is a clearance
                // with an hour on it, not a separate kind of price.
                "iso_weekdays": row.get::<Vec<i16>, _>("iso_weekdays"),
                "from_minute": row.get::<Option<i32>, _>("from_minute"),
                "to_minute": row.get::<Option<i32>, _>("to_minute"),
            })
        })
        .collect();

        // A shop is not sent a book that says nothing to it: the receiving
        // validator rejects an empty one, and rightly — it cannot tell an empty
        // publication from a truncated one.
        //
        // "Nothing" is the whole book and not the prices alone. This used to
        // test `rules` — the price rules — so a book carrying only a promotion
        // or only a clearance was skipped for every shop in the fleet: it
        // published, reported delivery to nobody, and changed nothing. That is
        // the same publish-and-change-nothing fault the version guard exists to
        // stop, arriving from the other direction.
        if rules.is_empty()
            && markdowns.is_empty()
            && promotion_rules.is_empty()
            && coupons.is_empty()
            && campaigns.is_empty()
        {
            continue;
        }

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
    let counts: Vec<Value> =
        sqlx::query("SELECT kind, key, uses, spent_minor FROM commercial_usage ORDER BY kind, key")
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

/// Tell every shop which campaigns are running, and between which dates.
///
/// The lever, delivered. A campaign's `status` is what the business pulls when
/// it says "stop the promo", and until this existed pulling it changed
/// Postgres and nothing else: a shop learned a campaign's status only from the
/// publication that carried it, and publications are frozen and seasonal. So a
/// pause reached a till when somebody next happened to cut a price book.
///
/// Sent whole, like the usage counts and for the same reason: a shop that
/// missed one is behind rather than permanently wrong about what it is running.
/// Only campaigns from published books are sent — a draft's switch is not a
/// switch yet.
///
/// This is the prerequisite for gating a **markdown** on its campaign at all.
/// That gate reads an absent campaign as "leave the cleared price standing",
/// because charging more than the ticket on the garment is the worse failure —
/// so ending a campaign early has to be an instruction that arrives, and this is
/// the thing that carries it.
pub async fn publish_campaign_switches(
    pool: &PgPool,
    issued_by: &str,
    targets: &[String],
) -> Result<(Uuid, Vec<String>), AppError> {
    let switched_at = Utc::now();
    let campaigns: Vec<Value> = sqlx::query(
        // The newest book that names a campaign owns it, the same rule the shop
        // applies when it replaces on `campaign_id`. Without DISTINCT ON, a
        // campaign carried by three publications would be sent three times with
        // the oldest one landing last.
        "SELECT DISTINCT ON (c.campaign_id)
                c.campaign_id, c.status, c.valid_from, c.valid_to,
                c.image_url, c.headline, c.terms
           FROM commercial_campaign c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.campaign_id, p.version DESC",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "campaign_id": row.get::<String, _>("campaign_id"),
            "status": row.get::<String, _>("status"),
            "valid_from": row.get::<Option<DateTime<Utc>>, _>("valid_from"),
            "valid_to": row.get::<Option<DateTime<Utc>>, _>("valid_to"),
            "image_url": row.get::<Option<String>, _>("image_url"),
            "headline": row.get::<Option<String>, _>("headline"),
            "terms": row.get::<Option<String>, _>("terms"),
        })
    })
    .collect();

    let payload = json!({ "switched_at": switched_at, "campaigns": campaigns });
    super::sync::issue_command(
        pool,
        crate::cloud::domain::COMMAND_COMMERCIAL_CAMPAIGN,
        &payload,
        issued_by,
        // No expiry, for the reason the usage lane has none: a shop back from a
        // week offline needs the newest switch it can get, not to be told the
        // message is stale. A stale switch is still nearer the truth than the
        // one it is holding.
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
    let pricing =
        super::pricing::load_site_pricing(&mut tx, &query.site_id, query.channel.as_str(), at)
            .await?;
    // What the product IS, not just what it is called. A markdown or promotion
    // written against the whole style matches on this, and a line without it
    // silently qualifies for nothing.
    let merchandise = super::pricing::load_merchandise(&mut tx).await?;
    tx.commit().await?;

    let Some(sku_code) = pricing.sku_code_by_id.get(&query.sku_id).cloned() else {
        return Err(AppError::NotFound(
            "an effective offer for that SKU at that store and channel".into(),
        ));
    };
    let context = crate::reporting::pricing_context(&query.site_id, query.channel.as_str(), at);
    let priced = price_catalog(
        &pricing.snapshot,
        &context,
        &[super::pricing::cart_line(&sku_code, 1, &merchandise)],
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
        "price_source": entry.source.as_str(),
        "markdown_id": entry.markdown_id,
        "tax_category": entry.tax_category,
        "as_of": at,
    }))
}

// `resolve_offer_in_tx` stood here: a price cascade written in SQL, reading
// price rules, assortment rules and tax and knowing nothing about clearance. It
// priced every line of every cloud sale.
//
// It is gone rather than deprecated. A second evaluator left lying about is one
// somebody wires back in, and the whole design rests on there being exactly one
// answer to "what does this cost".

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

    // What each product is: its style, its division, its tags. This carries the
    // names the screen prints AND the facts a range-wide markdown matches on —
    // one query, because they are the same facts, and fetching them twice is
    // how a screen and an engine come to disagree about what a garment is.
    let merchandise = super::pricing::load_merchandise(&mut tx).await?;
    tx.commit().await?;

    let context = crate::reporting::pricing_context(site_id, channel.as_str(), at);
    let products: Vec<CartLine> = pricing
        .sku_id_by_code
        .keys()
        .map(|code| super::pricing::cart_line(code, 1, &merchandise))
        .collect();

    let items: Vec<Value> = price_catalog(&pricing.snapshot, &context, &products)
        .into_iter()
        .map(|entry| {
            let facts = merchandise.get(&entry.sku_code);
            let article_code = facts.map(|f| f.article_code.as_str()).unwrap_or_default();
            let article_name = facts.map(|f| f.article_name.as_str()).unwrap_or_default();
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
                "price_source": entry.source.as_str(),
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

/// Which shop is charging which price book, and how far behind it is.
///
/// Reads `commercial_publication_activation`, which shops have been writing
/// since migration 0036 and which nothing has ever read. That was the whole
/// point of the table: a shop whose sync had stalled looked exactly like one
/// that was up to date, and the difference between those two is whether
/// somebody needs to drive out there.
///
/// Every registered shop appears, including one that has never reported. That
/// row is the most important one on the screen and the easiest to leave out —
/// a shop missing from a list of activations reads as "no news", when it
/// actually means no price book has ever gone into service there.
pub async fn commercial_activation(pool: &PgPool) -> Result<Value, AppError> {
    let newest: Option<i64> = sqlx::query_scalar(
        "SELECT max(version) FROM commercial_publication
          WHERE status = 'PUBLISHED'
            AND effective_from <= now()
            AND (effective_to IS NULL OR effective_to > now())",
    )
    .fetch_one(pool)
    .await?;

    let rows = sqlx::query(
        "WITH latest AS (
             SELECT DISTINCT ON (origin_id)
                    origin_id, site_id, publication_id, version,
                    activated_at, reported_at, price_rule_count
               FROM commercial_publication_activation
              ORDER BY origin_id, version DESC
         )
         SELECT c.origin_id, c.label, c.site_id,
                l.version, l.activated_at, l.reported_at, l.price_rule_count,
                p.name book_name
           FROM sync_origin_credential c
           LEFT JOIN latest l ON l.origin_id = c.origin_id
           LEFT JOIN commercial_publication p ON p.id = l.publication_id
          WHERE c.node_role = 'STORE'
          ORDER BY c.origin_id",
    )
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let version: Option<i64> = row.get("version");
            json!({
                "origin_id": row.get::<String, _>("origin_id"),
                "label": row.get::<Option<String>, _>("label"),
                "site_id": row.get::<Option<String>, _>("site_id"),
                "version": version,
                "book_name": row.get::<Option<String>, _>("book_name"),
                // The shop's own clock, and the centre's. The gap between them
                // is the number worth watching.
                "activated_at": row.get::<Option<DateTime<Utc>>, _>("activated_at"),
                "reported_at": row.get::<Option<DateTime<Utc>>, _>("reported_at"),
                // How much of the book arrived, so a truncated delivery shows
                // as a number rather than as a wrong price weeks later.
                "price_rule_count": row.get::<Option<i64>, _>("price_rule_count"),
                // Not a boolean "up to date": a shop can be behind by one book
                // published a minute ago, which is ordinary, or by four
                // published in March, which is not. The screen needs the size.
                "behind_by": match (newest, version) {
                    (Some(newest), Some(seen)) => json!((newest - seen).max(0)),
                    (Some(_), None) => Value::Null,
                    _ => json!(0),
                },
                "has_ever_activated": version.is_some(),
            })
        })
        .collect();

    Ok(json!({
        "newest_published_version": newest,
        "shop_count": items.len(),
        "items": items,
    }))
}

/// What promotions have actually given away, against what they were allowed to.
///
/// The counts come from `commercial_usage`, which is built only from sale facts
/// the centre has already accepted, so it inherits their idempotency. The limits
/// come from the publication that declared them — a limit is a decision and is
/// frozen with the price book; a count is an observation and changes with every
/// sale. They are joined here and nowhere else.
///
/// A rule's caps live inside its stored definition rather than in columns,
/// because the shape of a rule belongs to the engine and a table mirroring it
/// would have to be migrated in lockstep. Reading two known fields out of that
/// document is the price of not having a second definition of what a rule is.
pub async fn commercial_usage(pool: &PgPool) -> Result<Value, AppError> {
    // One pass, not six correlated subqueries per row.
    //
    // It was written as a CASE over three lookups repeated for budget, for the
    // usage cap and for the name — eighteen scans for three rows and eighteen
    // hundred for three hundred, each one re-finding the newest publication
    // that declares the same key. The newest declaration of each kind is a
    // thing to compute ONCE and join to.
    //
    // `DISTINCT ON` gives that directly: the row with the highest publication
    // version per key, which is the declaration in force. A limit stated in an
    // older book has been superseded like everything else in it.
    let rows = sqlx::query(
        "WITH live AS (
             SELECT id, version FROM commercial_publication WHERE status = 'PUBLISHED'
         ), rule AS (
             SELECT DISTINCT ON (r.rule_id) r.rule_id AS key, r.name,
                    (r.definition->'caps'->'budget'->>'minor')::bigint AS budget_minor,
                    (r.definition->'caps'->>'max_uses')::bigint AS max_uses
               FROM commercial_rule r JOIN live p ON p.id = r.publication_id
              ORDER BY r.rule_id, p.version DESC
         ), campaign AS (
             SELECT DISTINCT ON (c.campaign_id) c.campaign_id AS key, c.name,
                    c.budget_minor, c.max_uses::bigint AS max_uses
               FROM commercial_campaign c JOIN live p ON p.id = c.publication_id
              ORDER BY c.campaign_id, p.version DESC
         ), coupon AS (
             SELECT DISTINCT ON (c.code) c.code AS key,
                    c.max_uses::bigint AS max_uses
               FROM commercial_coupon c JOIN live p ON p.id = c.publication_id
              ORDER BY c.code, p.version DESC
         ), per_customer AS (
             SELECT kind, key, count(*)::bigint AS customer_count
               FROM commercial_usage_customer GROUP BY kind, key
         )
         SELECT u.kind, u.key, u.uses, u.spent_minor, u.first_used_at, u.last_used_at,
                CASE u.kind WHEN 'RULE' THEN r.name WHEN 'CAMPAIGN' THEN g.name END AS name,
                CASE u.kind WHEN 'RULE' THEN r.budget_minor
                            WHEN 'CAMPAIGN' THEN g.budget_minor END AS budget_minor,
                CASE u.kind WHEN 'RULE' THEN r.max_uses
                            WHEN 'CAMPAIGN' THEN g.max_uses
                            WHEN 'COUPON' THEN o.max_uses END AS max_uses,
                COALESCE(pc.customer_count, 0) AS customer_count
           FROM commercial_usage u
           LEFT JOIN rule r ON u.kind = 'RULE' AND r.key = u.key
           LEFT JOIN campaign g ON u.kind = 'CAMPAIGN' AND g.key = u.key
           LEFT JOIN coupon o ON u.kind = 'COUPON' AND o.key = u.key
           LEFT JOIN per_customer pc ON pc.kind = u.kind AND pc.key = u.key
          ORDER BY u.spent_minor DESC, u.kind, u.key",
    )
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "kind": row.get::<String, _>("kind"),
                "key": row.get::<String, _>("key"),
                "name": row.get::<Option<String>, _>("name"),
                "uses": row.get::<i64, _>("uses"),
                "spent_minor": row.get::<i64, _>("spent_minor"),
                // Null means unlimited, which is not the same as zero and must
                // not be rendered as a full bar.
                "budget_minor": row.get::<Option<i64>, _>("budget_minor"),
                "max_uses": row.get::<Option<i64>, _>("max_uses"),
                "customer_count": row.get::<i64, _>("customer_count"),
                "first_used_at": row.get::<DateTime<Utc>, _>("first_used_at"),
                "last_used_at": row.get::<DateTime<Utc>, _>("last_used_at"),
            })
        })
        .collect();

    Ok(json!({ "item_count": items.len(), "items": items }))
}

/// Everything one price book says.
///
/// The list endpoint gives headers and a count, which is enough to know a book
/// exists and nothing about what it does. There was no way to read back a
/// markdown, a promotion or a coupon once authored — so the only record of what
/// a published book contained was the JSON somebody had posted, if they kept it.
///
/// Deliberately the same shape a shop is sent, minus the per-shop filtering:
/// what a person reads here is what a till received, rather than a second
/// rendering that could describe it differently.
pub async fn commercial_publication_detail(
    pool: &PgPool,
    publication_id: Uuid,
) -> Result<Value, AppError> {
    let header = sqlx::query(
        "SELECT id, version, name, status, effective_from, effective_to,
                created_by, created_at, published_by, published_at
           FROM commercial_publication WHERE id = $1",
    )
    .bind(publication_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("commercial publication".into()))?;

    let tax_rules: Vec<Value> = sqlx::query(
        "SELECT tax_category, rate_bps, tax_inclusive FROM commercial_tax_rule
          WHERE publication_id = $1 ORDER BY tax_category",
    )
    .bind(publication_id)
    .fetch_all(pool)
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

    // Price and permission-to-sell are authored together and read together.
    // One without the other is either a priced product nobody may sell or a
    // sellable one with no price, and the publish check refuses both.
    let price_rules: Vec<Value> = sqlx::query(
        "SELECT s.sku_code, a.article_code, a.name article_name,
                pr.site_id, pr.site_ids, pr.channel, ar.sellable,
                pr.currency::text currency, pr.unit_price_minor, pr.tax_category
           FROM commercial_price_rule pr
           JOIN sku s ON s.id = pr.sku_id
           JOIN article a ON a.id = s.article_id
           LEFT JOIN commercial_assortment_rule ar
             ON ar.publication_id = pr.publication_id AND ar.sku_id = pr.sku_id
            AND ar.channel = pr.channel AND ar.site_id IS NOT DISTINCT FROM pr.site_id
          WHERE pr.publication_id = $1
          ORDER BY s.sku_code, pr.channel",
    )
    .bind(publication_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "sku_code": row.get::<String, _>("sku_code"),
            "article_code": row.get::<String, _>("article_code"),
            "article_name": row.get::<String, _>("article_name"),
            "site_id": row.get::<Option<String>, _>("site_id"),
            "site_ids": row.get::<Option<Vec<String>>, _>("site_ids"),
            "channel": row.get::<String, _>("channel"),
            "sellable": row.get::<Option<bool>, _>("sellable"),
            "currency": row.get::<String, _>("currency").trim(),
            "unit_price_minor": row.get::<i64, _>("unit_price_minor"),
            "tax_category": row.get::<String, _>("tax_category"),
        })
    })
    .collect();

    let markdowns: Vec<Value> = sqlx::query(
        "SELECT markdown_id, sku_code, article_code, site_id, site_ids,
                replacement_unit_price_minor, priority, effective_from, effective_to
           FROM commercial_markdown WHERE publication_id = $1 ORDER BY markdown_id",
    )
    .bind(publication_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "markdown_id": row.get::<String, _>("markdown_id"),
            "sku_code": row.get::<Option<String>, _>("sku_code"),
            "article_code": row.get::<Option<String>, _>("article_code"),
            "site_id": row.get::<Option<String>, _>("site_id"),
            "site_ids": row.get::<Option<Vec<String>>, _>("site_ids"),
            "replacement_unit_price_minor": row.get::<i64, _>("replacement_unit_price_minor"),
            "priority": row.get::<i32, _>("priority"),
            "effective_from": row.get::<DateTime<Utc>, _>("effective_from"),
            "effective_to": row.get::<Option<DateTime<Utc>>, _>("effective_to"),
        })
    })
    .collect();

    // The rule as the engine serialised it, handed back whole. Rendering it
    // field by field here would put a second interpreter of rule semantics in
    // the system, which is the one thing this design exists to avoid.
    let rules: Vec<Value> = sqlx::query(
        "SELECT rule_id, name, status, priority, definition FROM commercial_rule
          WHERE publication_id = $1 ORDER BY rule_id",
    )
    .bind(publication_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "rule_id": row.get::<String, _>("rule_id"),
            "name": row.get::<String, _>("name"),
            "status": row.get::<String, _>("status"),
            "priority": row.get::<i32, _>("priority"),
            "definition": row.get::<Value, _>("definition"),
        })
    })
    .collect();

    let coupons: Vec<Value> = sqlx::query(
        "SELECT code, rule_id, active, customer_id, valid_from, valid_to, max_uses
           FROM commercial_coupon WHERE publication_id = $1 ORDER BY code",
    )
    .bind(publication_id)
    .fetch_all(pool)
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
        })
    })
    .collect();

    let campaigns: Vec<Value> = sqlx::query(
        "SELECT campaign_id, name, status, valid_from, valid_to, budget_minor,
                max_uses, image_url, headline, terms
           FROM commercial_campaign WHERE publication_id = $1 ORDER BY campaign_id",
    )
    .bind(publication_id)
    .fetch_all(pool)
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
            "max_uses": row.get::<Option<i32>, _>("max_uses"),
            // The poster, read back — the dispatch payload has carried these
            // three since they existed, and this reader did not, so the console
            // read every published campaign with a blank banner.
            //
            // Not cosmetic. A promotion joining a campaign has to RESTATE that
            // campaign in its own book, because a shop drops a rule whose
            // campaign it does not hold — and the console assembles that
            // restatement out of this response. With the poster missing here,
            // filing one offer under the Lebaran sale republished the Lebaran
            // sale with its banner, its headline and its small print blanked,
            // to every shop in the fleet.
            "image_url": row.get::<Option<String>, _>("image_url"),
            "headline": row.get::<Option<String>, _>("headline"),
            "terms": row.get::<Option<String>, _>("terms"),
        })
    })
    .collect();

    // Who has actually put this book into service. The same reading as the
    // fleet screen, narrowed to one book, so "published" and "in force" are
    // visibly different things on the page that shows what a book says.
    let activated_by: Vec<Value> = sqlx::query(
        "SELECT origin_id, site_id, activated_at, reported_at, price_rule_count
           FROM commercial_publication_activation
          WHERE publication_id = $1 ORDER BY origin_id",
    )
    .bind(publication_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        json!({
            "origin_id": row.get::<String, _>("origin_id"),
            "site_id": row.get::<Option<String>, _>("site_id"),
            "activated_at": row.get::<DateTime<Utc>, _>("activated_at"),
            "reported_at": row.get::<DateTime<Utc>, _>("reported_at"),
            "price_rule_count": row.get::<i64, _>("price_rule_count"),
        })
    })
    .collect();

    Ok(json!({
        "id": header.get::<Uuid, _>("id"),
        "version": header.get::<i64, _>("version"),
        "name": header.get::<String, _>("name"),
        "status": header.get::<String, _>("status"),
        "effective_from": header.get::<DateTime<Utc>, _>("effective_from"),
        "effective_to": header.get::<Option<DateTime<Utc>>, _>("effective_to"),
        "created_by": header.get::<String, _>("created_by"),
        "created_at": header.get::<DateTime<Utc>, _>("created_at"),
        "published_by": header.get::<Option<String>, _>("published_by"),
        "published_at": header.get::<Option<DateTime<Utc>>, _>("published_at"),
        "tax_rules": tax_rules,
        "price_rules": price_rules,
        "markdowns": markdowns,
        "rules": rules,
        "coupons": coupons,
        "campaigns": campaigns,
        "activated_by": activated_by,
    }))
}

/// Price a basket without selling it.
///
/// The engine is a pure function of a snapshot, a context and a cart, so a
/// what-if is the same call a till makes — not an approximation of it. Nothing
/// here writes: no sale, no usage count, no reservation. A promotion that would
/// have exhausted its budget is reported as applying, because it would have.
///
/// The value is not really the total. It is `rejected_rules`: every promotion
/// that could have applied and did not, each carrying the engine's own
/// explanation in the words a cashier would use. "Your rule is not applying
/// because its coupon expired on Friday" is the question this endpoint exists
/// to answer, and until now the only way to ask it was to sell something.
pub async fn simulate(
    pool: &PgPool,
    request: crate::cloud::application::SimulateRequest,
) -> Result<Value, AppError> {
    SiteId::new(&request.site_id).map_err(|e| AppError::Validation(e.to_string()))?;
    if request.lines.is_empty() {
        return Err(AppError::Validation(
            "a basket to price needs at least one line".into(),
        ));
    }
    for line in &request.lines {
        if line.quantity <= 0 {
            return Err(AppError::Validation(format!(
                "quantity for {} must be positive",
                line.sku_code
            )));
        }
    }
    let at = request.at.unwrap_or_else(Utc::now);

    let mut tx = pool.begin().await?;
    let pricing =
        super::pricing::load_site_pricing(&mut tx, &request.site_id, request.channel.as_str(), at)
            .await?;
    let merchandise = super::pricing::load_merchandise(&mut tx).await?;
    tx.commit().await?;

    let mut context =
        crate::reporting::pricing_context(&request.site_id, request.channel.as_str(), at);
    context.coupon_codes = request.coupon_codes.clone();
    context.customer_id = request.customer_id.clone();

    let cart: Vec<CartLine> = request
        .lines
        .iter()
        .map(|line| {
            let mut cart_line =
                super::pricing::cart_line(&line.sku_code, line.quantity, &merchandise);
            cart_line
        })
        .collect();

    // A basket the engine refuses is a validation answer, not a server fault:
    // an unknown SKU or a product this shop may not sell is exactly what
    // somebody is trying to find out.
    let result = pricing_engine::price_cart(&pricing.snapshot, &context, &cart)
        .map_err(|error| AppError::Validation(error.to_string()))?;

    let lines: Vec<Value> = result
        .lines
        .iter()
        .map(|line| {
            json!({
                "sku_code": line.sku_code,
                "quantity": line.quantity,
                "price_source": line.source.as_str(),
                "base_unit_price_minor": line.base_unit_price.minor,
                "unit_price_minor": line.unit_price.minor,
                "line_total_minor": line.line_total.minor,
                "tax_category": line.tax_category,
                "publication_version": line.publication_version,
                "markdown_id": line.markdown_id,
            })
        })
        .collect();

    let applied: Vec<Value> = result
        .applied_rules
        .iter()
        .map(|rule| {
            json!({
                "rule_id": rule.rule_id,
                "campaign_id": rule.campaign_id,
                "name": rule.name,
                "coupon_code": rule.coupon_code,
                "benefit_minor": rule.benefit.minor,
            })
        })
        .collect();

    let rejected: Vec<Value> = result
        .rejected_rules
        .iter()
        .map(|rule| {
            json!({
                "rule_id": rule.rule_id,
                "name": rule.name,
                "reason": rule.reason,
                // The engine's own words, not a lookup table kept beside it. A
                // second copy of these strings in a browser is a second copy
                // that goes stale the day a reason is added.
                "explanation": rule.explanation,
                "would_have_saved_minor": rule.would_have_saved.map(|money| money.minor),
            })
        })
        .collect();

    let free_lines: Vec<Value> = result
        .free_lines
        .iter()
        .map(|line| {
            json!({
                "sku_code": line.sku_code,
                "quantity": line.quantity,
                "unit_price_minor": line.unit_price.minor,
                "granted_by_rule_id": line.granted_by_rule_id,
                "value_minor": line.value.minor,
            })
        })
        .collect();

    Ok(json!({
        "site_id": request.site_id,
        "channel": request.channel.as_str(),
        "as_of": at,
        // The same basket, priced against the same book at the same instant,
        // gives this same id on any machine — which is what lets a disputed
        // receipt be reproduced rather than argued about.
        "trace_id": result.trace_id,
        "publication_version": result.publication_version,
        "currency": result.currency.0,
        "lines": lines,
        "free_lines": free_lines,
        "applied_rules": applied,
        "rejected_rules": rejected,
        "earn_awards": result.earn_awards.iter().map(|award| json!({
            "rule_id": award.rule_id,
            "name": award.name,
            "points": award.points,
            "basis_amount_minor": award.basis_amount.minor,
        })).collect::<Vec<Value>>(),
        "points_earned": result.points_earned,
        "discount_total_minor": result.discount_total.minor,
        "total_minor": result.total.minor,
    }))
}

/// Send the promotion counts to every shop.
///
/// `publish_commercial_usage` has existed since the counts did and nothing ever
/// called it — so a budget spent at the centre never reached a till, and a
/// coupon marked single-use went on working everywhere. This is the caller.
///
/// The targets are resolved here rather than asked for, because "which shops"
/// has exactly one right answer and a caller passing a list could quietly miss
/// one — which is the failure this is meant to end, not repeat.
///
/// What a shop enforces from this is always behind, and cannot be otherwise: no
/// till knows what the other shops sold this morning. A budget is a brake, not
/// a gate. The number that must not be exceeded is the one at the centre.
pub async fn publish_commercial_usage_to_fleet(
    pool: &PgPool,
    issued_by: &str,
) -> Result<Value, AppError> {
    let targets: Vec<String> = sqlx::query_scalar(
        "SELECT origin_id FROM sync_origin_credential
          WHERE node_role = 'STORE' AND site_id IS NOT NULL ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    if targets.is_empty() {
        return Err(AppError::Conflict(
            "no shop is registered to send promotion counts to".into(),
        ));
    }
    let (command_id, sent_to) = publish_commercial_usage(pool, issued_by, &targets).await?;
    Ok(json!({
        "command_id": command_id,
        "sent_to": sent_to,
        "counted_at": Utc::now(),
    }))
}

/// Pull the lever on one campaign: stop it, restart it, or move its dates.
///
/// The one thing in a published price book that is meant to change afterwards,
/// and migration 0073 says why: a campaign's `status` is what somebody reaches
/// for when they say "stop the Lebaran promo", and freezing it would take the
/// lever away. Everything else here — the prices, the markdowns, the rule
/// documents — stays frozen.
///
/// Every row for the campaign is updated, not only the newest book's. A shop
/// keys campaigns by their business id and holds exactly one; the centre scopes
/// per publication and may hold several. Updating one of several would leave
/// the centre disagreeing with itself about whether a campaign is running,
/// depending on which book a query happened to rank first.
///
/// The switch is dispatched in the same call. A pause that reached Postgres and
/// waited for the next broadcast would still be a pause that had not reached
/// the shop floor — which is the whole fault this exists to fix.
pub async fn switch_campaign(
    pool: &PgPool,
    campaign_id: &str,
    request: CampaignSwitchRequest,
) -> Result<Value, AppError> {
    let campaign_id = campaign_id.trim();
    if campaign_id.is_empty() {
        return Err(AppError::Validation("campaign_id is required".into()));
    }
    let status = request.status.trim().to_ascii_uppercase();
    if !matches!(
        status.as_str(),
        "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "EXPIRED" | "CANCELLED"
    ) {
        return Err(AppError::Validation(format!("unknown status {status}")));
    }
    if let (Some(from), Some(to)) = (request.valid_from, request.valid_to) {
        if to <= from {
            return Err(AppError::Validation(
                "a campaign cannot end before it starts".into(),
            ));
        }
    }

    let mut tx = pool.begin().await?;
    // `COALESCE($n, column)` on every optional field: absence leaves what is
    // there. A screen that sends `{"status":"PAUSED"}` must not silently clear
    // the dates that decide when the campaign was going to end, or blank the
    // banner. Clearing is an empty string, which is a value and survives the
    // COALESCE — so "I did not mention it" and "remove it" stay different
    // instructions.
    let affected = sqlx::query(
        "UPDATE commercial_campaign
            SET status     = $2,
                valid_from = COALESCE($3, valid_from),
                valid_to   = COALESCE($4, valid_to),
                image_url  = COALESCE($5, image_url),
                headline   = COALESCE($6, headline),
                terms      = COALESCE($7, terms)
          WHERE campaign_id = $1",
    )
    .bind(campaign_id)
    .bind(&status)
    .bind(request.valid_from)
    .bind(request.valid_to)
    .bind(request.image_url.as_deref().map(str::trim))
    .bind(request.headline.as_deref().map(str::trim))
    .bind(request.terms.as_deref())
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "no campaign {campaign_id} in any price book"
        )));
    }
    tx.commit().await?;

    let dispatch = publish_campaign_switches_to_fleet(pool, request.actor_id.trim()).await;
    Ok(json!({
        "campaign_id": campaign_id,
        "status": status,
        "rows": affected,
        // The dispatch is reported rather than being allowed to fail the
        // switch. A fleet with no shop registered is a legitimate state — a
        // business setting up — and refusing to pause a campaign because there
        // is nobody to tell would be refusing the safer of the two outcomes.
        "dispatch": match dispatch {
            Ok(report) => report,
            Err(error) => json!({ "error": error.to_string() }),
        },
    }))
}

/// Send the campaign switches to every shop.
///
/// Targets resolved here rather than asked for, for the reason
/// `publish_commercial_usage_to_fleet` gives: "which shops" has one right
/// answer, and a caller passing a list can quietly miss one.
pub async fn publish_campaign_switches_to_fleet(
    pool: &PgPool,
    issued_by: &str,
) -> Result<Value, AppError> {
    let targets: Vec<String> = sqlx::query_scalar(
        "SELECT origin_id FROM sync_origin_credential
          WHERE node_role = 'STORE' AND site_id IS NOT NULL ORDER BY origin_id",
    )
    .fetch_all(pool)
    .await?;
    if targets.is_empty() {
        return Err(AppError::Conflict(
            "no shop is registered to send campaign switches to".into(),
        ));
    }
    let (command_id, sent_to) = publish_campaign_switches(pool, issued_by, &targets).await?;
    Ok(json!({
        "command_id": command_id,
        "sent_to": sent_to,
        "switched_at": Utc::now(),
    }))
}

/// Every price every shop could charge for a style, and which one wins.
///
/// The offers list answers "what does this cost here" with one number per SKU,
/// which is what a shelf edge needs and less than a merchandiser needs. Two
/// questions it cannot answer at all: what the *other* shops are charging for
/// the same thing, and why this shop's number is what it is rather than the one
/// above it in the cascade.
///
/// So this is keyed by style rather than by product, carries every shop side by
/// side, and reports the losing candidates as well as the winner. The ordering
/// is the engine's own — `price_stacks` — never a second ranking written here:
/// a screen that showed the cascade in a different order from the order that
/// decides it would look authoritative and be wrong.
/// How a caller narrows the range before it is priced.
///
/// Empty everywhere means "the whole catalogue, capped by `limit`", which is
/// what the screen asks for when it first opens.
#[derive(Clone, Debug, Default)]
pub struct ArticlePriceFilter {
    pub q: Option<String>,
    pub divisions: Vec<String>,
    pub tags: Vec<String>,
    pub min_price: Option<i64>,
    pub max_price: Option<i64>,
}

pub async fn article_prices(
    pool: &PgPool,
    channel: CommercialChannel,
    at: DateTime<Utc>,
    limit: i64,
    filter: ArticlePriceFilter,
) -> Result<Value, AppError> {
    let shops = sqlx::query(
        "SELECT origin_id, site_id, label FROM sync_origin_credential
          WHERE node_role = 'STORE' AND site_id IS NOT NULL
          ORDER BY COALESCE(label, site_id), site_id",
    )
    .fetch_all(pool)
    .await?;

    // The styles, and the products under each. One query rather than one per
    // article: a screen that fetched per row would be as slow as the catalogue
    // is long.
    // The narrowing, written once and bound to both queries below.
    //
    // `q` reaches SKU codes as well as the style's own code and name, because
    // the code somebody has in their hand is as often a product's as a style's
    // — off a label, off a count sheet — and a search box that answered only
    // two of the three would look broken exactly when it mattered.
    //
    // The price bounds are here as well as on the way out, and that is the
    // difference between a filter and a lie. Applied only afterwards, they
    // narrowed the two hundred styles this request happened to price and left
    // the other three hundred unexamined — so "styles over 500.000" quietly
    // meant "styles over 500.000 in the first two hundred alphabetically".
    //
    // What it matches is deliberately a SUPERSET of the answer: every amount
    // the engine can end up charging is stored either as a price rule or as a
    // markdown's replacement, so a style with neither in range cannot come out
    // in range, while a style kept here may still be dropped below once the
    // cascade has actually run. Wider than the truth is safe; narrower is not.
    let narrow = "
        AND ($2::text IS NULL
             OR a.article_code ILIKE '%' || $2 || '%'
             OR a.name ILIKE '%' || $2 || '%'
             OR EXISTS (SELECT 1 FROM sku q WHERE q.article_id = a.id
                          AND q.sku_code ILIKE '%' || $2 || '%'))
        AND (cardinality($3::text[]) = 0
             OR a.division_code = ANY($3))
        AND (cardinality($4::text[]) = 0
             OR EXISTS (SELECT 1 FROM article_tag t
                         WHERE t.article_id = a.id AND t.tag_code = ANY($4)))
        AND ($5::bigint IS NULL AND $6::bigint IS NULL
             OR EXISTS (SELECT 1 FROM commercial_price_rule pr
                          JOIN commercial_publication p ON p.id = pr.publication_id
                          JOIN sku ps ON ps.id = pr.sku_id
                         WHERE ps.article_id = a.id AND p.status = 'PUBLISHED'
                           AND ($5 IS NULL OR pr.unit_price_minor >= $5)
                           AND ($6 IS NULL OR pr.unit_price_minor <= $6))
             OR EXISTS (SELECT 1 FROM commercial_markdown m
                          JOIN commercial_publication p ON p.id = m.publication_id
                          LEFT JOIN sku ms ON ms.id = m.sku_id
                         WHERE p.status = 'PUBLISHED'
                           AND (ms.article_id = a.id
                                OR m.article_code = a.article_code)
                           AND ($5 IS NULL OR m.replacement_unit_price_minor >= $5)
                           AND ($6 IS NULL OR m.replacement_unit_price_minor <= $6)))";

    let article_rows = sqlx::query(&format!(
        "SELECT a.article_code, a.name article_name, a.image_url, a.division_code,
                array_agg(s.sku_code ORDER BY s.sku_code) sku_codes,
                COALESCE(
                    (SELECT array_agg(t.tag_code ORDER BY t.tag_code)
                       FROM article_tag t WHERE t.article_id = a.id),
                    '{{}}'
                ) tags
           FROM article a
           JOIN sku s ON s.article_id = a.id AND s.active
          WHERE true {narrow}
          GROUP BY a.id, a.article_code, a.name, a.image_url, a.division_code
          ORDER BY a.article_code
          LIMIT $1"
    ))
    .bind(limit.clamp(1, 2_000))
    .bind(filter.q.as_deref())
    .bind(&filter.divisions)
    .bind(&filter.tags)
    .bind(filter.min_price)
    .bind(filter.max_price)
    .fetch_all(pool)
    .await?;

    // How many styles there are, against how many were priced. A cap that does
    // not say it capped reads as "this is all of them", and a merchandiser who
    // cannot find a style would go looking for a pricing fault rather than for
    // the next page.
    //
    // Counted through the SAME narrowing, so "200 of 506" means 200 of the 506
    // that match — a total counting the whole catalogue while the list counts a
    // search is a fraction whose two halves are answers to different questions.
    let total_styles: i64 = sqlx::query_scalar(&format!(
        "SELECT count(DISTINCT a.id) FROM article a
           JOIN sku s ON s.article_id = a.id AND s.active
          WHERE true {narrow}"
    ))
    // `$1` is unused here, and bound anyway: the fragment is shared, so the
    // parameter numbering has to be.
    .bind(limit)
    .bind(filter.q.as_deref())
    .bind(&filter.divisions)
    .bind(&filter.tags)
    .bind(filter.min_price)
    .bind(filter.max_price)
    .fetch_one(pool)
    .await?;

    // What the whole catalogue holds, for the filter pickers.
    //
    // Counted over everything rather than over the narrowed set on purpose: a
    // facet list that only counts what is already showing cannot tell you what
    // ticking a second box would add, which is the one thing a facet is for.
    let facet_rows = sqlx::query(
        "SELECT 'division' kind, COALESCE(a.division_code, '') value, count(DISTINCT a.id) n
           FROM article a JOIN sku s ON s.article_id = a.id AND s.active
          GROUP BY 1, 2
          UNION ALL
         SELECT 'tag', t.tag_code, count(DISTINCT a.id)
           FROM article a
           JOIN sku s ON s.article_id = a.id AND s.active
           JOIN article_tag t ON t.article_id = a.id
          GROUP BY 1, 2
          ORDER BY 1, 3 DESC, 2",
    )
    .fetch_all(pool)
    .await?;

    let mut divisions = Vec::new();
    let mut tag_counts = Vec::new();
    for row in &facet_rows {
        let kind: String = row.get("kind");
        let entry = json!({ "value": row.get::<String, _>("value"),
                            "count": row.get::<i64, _>("n") });
        if kind == "division" {
            divisions.push(entry);
        } else {
            tag_counts.push(entry);
        }
    }

    struct Style {
        article_code: String,
        article_name: String,
        image_url: Option<String>,
        division_code: Option<String>,
        tags: Vec<String>,
        sku_codes: Vec<String>,
    }
    let styles: Vec<Style> = article_rows
        .into_iter()
        .map(|row| Style {
            article_code: row.get("article_code"),
            article_name: row.get("article_name"),
            image_url: row.get("image_url"),
            division_code: row.get("division_code"),
            tags: row.get("tags"),
            sku_codes: row.get("sku_codes"),
        })
        .collect();

    // What a product IS does not change from shop to shop, so it is read once
    // rather than once per shop. Inside the loop it was thirty reads of one
    // answer — invisible against two shops and the whole cost of the screen
    // against thirty.
    let mut tx = pool.begin().await?;
    let merchandise = super::pricing::load_merchandise(&mut tx).await?;
    tx.commit().await?;

    // article_code -> site_id -> the collapsed stack
    let mut by_style: std::collections::BTreeMap<String, Vec<Value>> =
        std::collections::BTreeMap::new();
    let mut shop_list = Vec::with_capacity(shops.len());

    // Every style's cart lines, once, with the slice each style owns.
    //
    // What a product IS does not change from shop to shop, so building these
    // inside the shop loop was thirteen constructions of one answer. They are
    // also the reason the whole range can be priced in ONE engine call per
    // shop rather than one per style — see below, which is where the real cost
    // was.
    let mut lines: Vec<CartLine> = Vec::new();
    let mut spans: Vec<(usize, usize)> = Vec::with_capacity(styles.len());
    for style in &styles {
        let from = lines.len();
        lines.extend(
            style
                .sku_codes
                .iter()
                .map(|code| super::pricing::cart_line(code, 1, &merchandise)),
        );
        spans.push((from, lines.len()));
    }

    for shop in &shops {
        let site_id: String = shop.get("site_id");
        let label: Option<String> = shop.get("label");
        shop_list.push(json!({
            "site_id": site_id,
            "label": label.clone().unwrap_or_else(|| site_id.clone()),
        }));

        let mut tx = pool.begin().await?;
        // The price book only. A stack is base prices and markdowns; a
        // promotion is a statement about a basket and is never consulted here,
        // so reading the promotion tables once per shop would be paying for
        // three queries per branch to throw all three away.
        let pricing =
            super::pricing::load_site_price_book(&mut tx, &site_id, channel.as_str(), at).await?;
        tx.commit().await?;
        let context = crate::reporting::pricing_context(&site_id, channel.as_str(), at);

        // ONE call for the whole range, not one per style.
        //
        // `price_stacks` builds its `PriceIndex` on entry — every price and
        // markdown the shop holds, into two BTreeMaps — and that index is the
        // same for every style in the shop. Called per style it was rebuilt
        // once per style: thirteen shops times two hundred styles is 2.600
        // builds over some four thousand entries each, and it was the whole
        // ten seconds this screen used to take to open. Called once per shop
        // it is built thirteen times.
        //
        // Safe because `stacks` maps products to stacks one for one and in
        // order, so a style's answers are exactly the slice its lines went in
        // as. `spans` is that slice, recorded when the lines were built.
        let stacks = pricing_engine::price_stacks(&pricing.snapshot, &context, &lines);

        for (style, (from, to)) in styles.iter().zip(&spans) {
            let collapsed = collapse(&stacks[*from..*to]);
            if collapsed.is_empty() {
                // This style is not sellable at this shop. Absent rather than
                // reported as zero: no price is not a price.
                continue;
            }
            by_style
                .entry(style.article_code.clone())
                .or_default()
                .push(json!({
                    "site_id": site_id,
                    "label": label.clone().unwrap_or_else(|| site_id.clone()),
                    "stack": collapsed,
                }));
        }
    }

    // The price bounds, applied here because this is the first moment a price
    // exists. A style is kept when what the till charges falls inside the
    // bounds at ANY shop — the question "which styles sell under 100.000" is
    // asked of a fleet, and a style that is under at one branch and over at
    // another is an answer to it, not an exception to be dropped.
    //
    // Read off rank 0 only. The rungs below it are prices that were BEATEN,
    // and filtering on those would return styles on the strength of an amount
    // no shop is charging.
    let charged = |shops: &[Value]| -> Option<(i64, i64)> {
        let mut low = i64::MAX;
        let mut high = i64::MIN;
        for shop in shops {
            let Some(top) = shop.get("stack").and_then(|s| s.get(0)) else {
                continue;
            };
            if let Some(min) = top.get("min_unit_price_minor").and_then(Value::as_i64) {
                low = low.min(min);
            }
            if let Some(max) = top.get("max_unit_price_minor").and_then(Value::as_i64) {
                high = high.max(max);
            }
        }
        (low <= high).then_some((low, high))
    };

    let items: Vec<Value> = styles
        .into_iter()
        .filter_map(|style| {
            let shops = by_style.remove(&style.article_code).unwrap_or_default();
            if filter.min_price.is_some() || filter.max_price.is_some() {
                // A style no shop prices cannot satisfy a price bound. Dropped
                // rather than kept: it is absent, and absent is not "cheap".
                let (low, high) = charged(&shops)?;
                if filter.min_price.is_some_and(|bound| high < bound) {
                    return None;
                }
                if filter.max_price.is_some_and(|bound| low > bound) {
                    return None;
                }
            }
            Some(json!({
                "article_code": style.article_code,
                "article_name": style.article_name,
                "image_url": style.image_url,
                "division_code": style.division_code,
                "tags": style.tags,
                "sku_count": style.sku_codes.len(),
                "shops": shops,
            }))
        })
        .collect();

    Ok(json!({
        "channel": channel.as_str(),
        "as_of": at,
        "shops": shop_list,
        "article_count": items.len(),
        "total_article_count": total_styles,
        "facets": { "divisions": divisions, "tags": tag_counts },
        "items": items,
    }))
}

/// Many products' stacks, as one style's rows.
///
/// A style is several products and they need not agree: a shirt can be priced
/// per size, so one level of the cascade covers a RANGE rather than a number.
/// Collapsing to the cheapest would hide that the large costs more, and listing
/// every SKU would put the SKU back on a screen that is deliberately about
/// styles — so a row carries both ends and says how many products it covers.
///
/// `in_force_for` counts the products this candidate actually wins, which is
/// not always all of them: a shop price on one size beats the company price on
/// that size alone, and the company row is then in force for the rest. A
/// boolean would have to pick one of those and be wrong about the other.
fn collapse(stacks: &[pricing_engine::ProductStack]) -> Vec<Value> {
    struct Row {
        rank: usize,
        source: &'static str,
        applies_to: Value,
        markdown_id: Option<String>,
        currency: String,
        publication_version: i64,
        min_minor: i64,
        max_minor: i64,
        sku_count: i64,
        in_force_for: i64,
        /// The distinct amounts inside the range, and which products carry
        /// each. A range is a summary and somebody eventually has to ask which
        /// size is the expensive one; answering that from the same rung means
        /// the detail can never disagree with the summary above it.
        points: std::collections::BTreeMap<i64, (Vec<String>, i64)>,
        effective_from: DateTime<Utc>,
        effective_to: Option<DateTime<Utc>>,
    }
    let mut rows: std::collections::BTreeMap<String, Row> = std::collections::BTreeMap::new();

    for stack in stacks {
        for (rank, candidate) in stack.candidates.iter().enumerate() {
            let scope = serde_json::to_value(&candidate.applies_to).unwrap_or(Value::Null);
            // Two candidates are one row when they are the same statement: the
            // same kind of price, from the same book, for the same audience.
            let key = format!(
                "{}|{}|{}|{}",
                candidate.source.as_str(),
                candidate.publication_version,
                candidate.markdown_id.as_deref().unwrap_or(""),
                scope,
            );
            let entry = rows.entry(key).or_insert_with(|| Row {
                rank,
                source: candidate.source.as_str(),
                applies_to: scope.clone(),
                markdown_id: candidate.markdown_id.clone(),
                currency: candidate.currency.0.clone(),
                publication_version: candidate.publication_version,
                min_minor: candidate.unit_price.minor,
                max_minor: candidate.unit_price.minor,
                sku_count: 0,
                in_force_for: 0,
                points: std::collections::BTreeMap::new(),
                effective_from: candidate.effective_from,
                effective_to: candidate.effective_to,
            });
            entry.rank = entry.rank.min(rank);
            entry.min_minor = entry.min_minor.min(candidate.unit_price.minor);
            entry.max_minor = entry.max_minor.max(candidate.unit_price.minor);
            entry.sku_count += 1;
            if candidate.in_force {
                entry.in_force_for += 1;
            }
            let point = entry
                .points
                .entry(candidate.unit_price.minor)
                .or_insert_with(|| (Vec::new(), 0));
            point.0.push(stack.sku_code.clone());
            if candidate.in_force {
                point.1 += 1;
            }
        }
    }

    let mut ordered: Vec<Row> = rows.into_values().collect();
    // The engine's order, kept. The tie-breaks below only settle rows the
    // engine ranked equally, so two shops with the same book always read the
    // same way round.
    ordered.sort_by(|left, right| {
        (
            left.rank,
            std::cmp::Reverse(left.in_force_for),
            left.min_minor,
        )
            .cmp(&(
                right.rank,
                std::cmp::Reverse(right.in_force_for),
                right.min_minor,
            ))
    });

    ordered
        .into_iter()
        .map(|row| {
            json!({
                "rank": row.rank,
                "source": row.source,
                "applies_to": row.applies_to,
                "markdown_id": row.markdown_id,
                "currency": row.currency,
                "publication_version": row.publication_version,
                "min_unit_price_minor": row.min_minor,
                "max_unit_price_minor": row.max_minor,
                "sku_count": row.sku_count,
                "in_force_for": row.in_force_for,
                // Cheapest first, so opening a range reads down from the price
                // the shelf edge advertises.
                "points": row.points.iter().map(|(minor, (sku_codes, in_force_for))| json!({
                    "unit_price_minor": minor,
                    "sku_codes": sku_codes,
                    "in_force_for": in_force_for,
                })).collect::<Vec<Value>>(),
                "effective_from": row.effective_from,
                "effective_to": row.effective_to,
            })
        })
        .collect()
}

/// The products a price book can name.
///
/// A merchandiser writing a book has to pick what it prices, and until this
/// existed there was nothing to pick from: `article-prices` answers what a shop
/// currently charges, keyed by style, and carries no `sku_id` — which is what
/// an offer is written against. So the authoring screen had no way to turn
/// "that white shirt" into a row the server would accept.
///
/// Searchable by code or name, because those are the two things somebody has in
/// front of them: a tag off a garment, or a description in a meeting.
///
/// It answers with the CURRENT company price beside each product, and that is
/// the point rather than a decoration. A book is a list of changes; an author
/// who cannot see what a thing costs now is authoring blind, and the commonest
/// expensive mistake in this domain is restating a price that had not changed.
pub async fn commercial_products(
    pool: &PgPool,
    query: Option<&str>,
    limit: i64,
) -> Result<Value, AppError> {
    let limit = limit.clamp(1, 500);
    let needle = query
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{value}%"));

    let rows = sqlx::query(
        "SELECT s.id sku_id, s.sku_code, s.color, s.size,
                a.article_code, a.name article_name, a.division_code, a.image_url,
                -- The live company price, from the newest published book that
                -- names this product at all. Narrowed to the company level on
                -- purpose: a shop price is a different question, asked on a
                -- different screen, and blending the two here would show one
                -- shop's number as if it were the range's.
                (SELECT r.unit_price_minor
                   FROM commercial_price_rule r
                   JOIN commercial_publication p ON p.id = r.publication_id
                  WHERE r.sku_id = s.id
                    AND r.site_id IS NULL
                    AND r.channel = 'STORE'
                    AND p.status = 'PUBLISHED'
                  ORDER BY p.version DESC
                  LIMIT 1) AS unit_price_minor
           FROM sku s
           JOIN article a ON a.id = s.article_id
          WHERE s.active
            AND ($1::text IS NULL
                 OR s.sku_code ILIKE $1
                 OR a.article_code ILIKE $1
                 OR a.name ILIKE $1)
          ORDER BY a.article_code, s.sku_code
          LIMIT $2",
    )
    .bind(needle.as_deref())
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "sku_id": row.get::<Uuid, _>("sku_id"),
                "sku_code": row.get::<String, _>("sku_code"),
                "color": row.get::<Option<String>, _>("color"),
                "size": row.get::<Option<String>, _>("size"),
                "article_code": row.get::<String, _>("article_code"),
                "article_name": row.get::<String, _>("article_name"),
                "division_code": row.get::<Option<String>, _>("division_code"),
                "image_url": row.get::<Option<String>, _>("image_url"),
                // Null means no published book has ever named it. Absent rather
                // than zero: no price is not a price of nothing.
                "unit_price_minor": row.get::<Option<i64>, _>("unit_price_minor"),
            })
        })
        .collect();

    Ok(json!({ "items": items }))
}
