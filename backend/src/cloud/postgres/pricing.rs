//! Reading the centre's price book into the shared evaluator.
//!
//! The mirror of `src/edge/pricing.rs`, against Postgres instead of SQLite.
//! Both build the same [`PricingSnapshot`] and hand it to the same engine, and
//! that is the entire point: until now the centre answered "what does this
//! cost" with its own SQL, which knew about price rules and nothing about
//! markdowns, promotions or coupons. A shirt on clearance rang up at the
//! clearance price in a shop and at the list price here.
//!
//! Two tills in one system agree on every ordinary day and part company on the
//! day a promotion runs — which is the day anybody is looking.

use chrono::{DateTime, Utc};
use pricing_engine::{
    Campaign, CampaignStatus, Caps, CartLine, Coupon, Currency, Markdown, Money, PriceEntry,
    PriceLevel, PricingSnapshot, Rule,
};
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::cloud::application::AppError;

/// The price book a shop is under, and the SKU codes to read it by.
///
/// The engine names products by `sku_code`; the centre's tables key on
/// `sku_id`. The map comes back alongside the snapshot so a caller holding an
/// id can ask about it without a second query — and so there is exactly one
/// place where the two identifiers are married.
pub struct SitePricing {
    pub snapshot: PricingSnapshot,
    pub sku_code_by_id: BTreeMap<Uuid, String>,
    pub sku_id_by_code: BTreeMap<String, Uuid>,
}

/// Which level a stored row applies at.
///
/// The four levels live in three nullable columns and only one may be set —
/// a CHECK constraint says so. Reading them narrowest first means a row that
/// somehow carries two resolves the same way here as it does at a shop.
fn level_of(
    site_id: Option<String>,
    site_ids: Option<Vec<String>>,
    tier: Option<String>,
) -> PriceLevel {
    if let Some(site_id) = site_id {
        return PriceLevel::Site { site_id };
    }
    if let Some(ids) = site_ids {
        if !ids.is_empty() {
            return PriceLevel::SiteGroup {
                site_ids: ids.into_iter().collect(),
            };
        }
    }
    if let Some(tier) = tier {
        return PriceLevel::Tier { tier };
    }
    PriceLevel::Company
}

fn campaign_status(raw: &str) -> CampaignStatus {
    match raw {
        "DRAFT" => CampaignStatus::Draft,
        "SCHEDULED" => CampaignStatus::Scheduled,
        "ACTIVE" => CampaignStatus::Active,
        "PAUSED" => CampaignStatus::Paused,
        "EXPIRED" => CampaignStatus::Expired,
        // A status this build cannot read must not leave a promotion live.
        _ => CampaignStatus::Cancelled,
    }
}

/// Load everything that could price a basket at one shop, at one instant.
///
/// Scoped in SQL rather than filtered in the engine: a shop's evaluation has
/// no business seeing another branch's prices, and the smaller snapshot is the
/// one that is obviously correct.
pub async fn load_site_pricing(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    channel: &str,
    at: DateTime<Utc>,
) -> Result<SitePricing, AppError> {
    let mut pricing = load_site_price_book(tx, site_id, channel, at).await?;
    let usage = load_usage(tx).await?;
    pricing.snapshot.rules = load_rules(tx, &usage).await?;
    pricing.snapshot.coupons = load_coupons(tx, &usage).await?;
    pricing.snapshot.campaigns = load_campaigns(tx, &usage).await?;
    Ok(pricing)
}

/// What promotions have actually given away, keyed by what they are.
///
/// `RULE`/`CAMPAIGN`/`COUPON` and the id or code, to `(uses, spent_minor)`.
type UsageCounts = BTreeMap<(String, String), (i64, i64)>;

async fn load_usage(tx: &mut Transaction<'_, Postgres>) -> Result<UsageCounts, AppError> {
    Ok(sqlx::query("SELECT kind, key, uses, spent_minor FROM commercial_usage")
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|row| {
            (
                (row.get::<String, _>("kind"), row.get::<String, _>("key")),
                (row.get::<i64, _>("uses"), row.get::<i64, _>("spent_minor")),
            )
        })
        .collect())
}

/// Overlay what has actually been spent onto the limits a publication declared.
///
/// The mirror of `edge/pricing.rs::with_usage`, and it was missing here — which
/// is not a tidiness problem. The centre read `spent_minor` and `used` from the
/// publication row, and nothing has ever written those: migration 0035 moved
/// counting to `commercial_usage` precisely because a count cannot live inside
/// a frozen document. So the centre's evaluator saw zero, always.
///
/// A budget therefore never ran out at the centre, a coupon was never used up,
/// and a usage cap was never reached — while every till in the fleet, which
/// does overlay the counts, had already stopped honouring the offer. Two nodes
/// reading one concept from two places, which is the fault this whole design
/// exists to prevent, sitting in the screen built to explain promotions.
fn with_usage(mut caps: Caps, counted: Option<&(i64, i64)>) -> Caps {
    if let Some((uses, spent)) = counted {
        caps.used = *uses;
        caps.spent = Money::new(*spent);
    }
    caps
}

/// What a product costs here, without the promotions.
///
/// The half of [`load_site_pricing`] that answers "what is this priced at" —
/// price list entries and the markdowns that replace them. Promotions are
/// statements about a *basket*, so a caller resolving a shelf price never reads
/// one, and one that loaded them anyway would pay for three queries it throws
/// away.
///
/// That is invisible against one shop and is the whole cost of the screen
/// against thirty: pricing every style at every shop ran this per shop, so the
/// promotion tables were being read once per branch to be discarded once per
/// branch.
pub async fn load_site_price_book(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    channel: &str,
    at: DateTime<Utc>,
) -> Result<SitePricing, AppError> {
    let rows = sqlx::query(
        "SELECT p.version, p.effective_from, p.effective_to,
                pr.sku_id, s.sku_code, pr.site_id, pr.site_ids, pr.tier, pr.channel,
                ar.sellable, pr.currency::text currency, pr.unit_price_minor, pr.tax_category
           FROM commercial_price_rule pr
           JOIN commercial_publication p ON p.id = pr.publication_id
           JOIN sku s ON s.id = pr.sku_id
           JOIN commercial_assortment_rule ar
             ON ar.publication_id = pr.publication_id AND ar.sku_id = pr.sku_id
            AND ar.channel = pr.channel AND ar.site_id IS NOT DISTINCT FROM pr.site_id
          WHERE p.status = 'PUBLISHED'
            AND pr.channel = $2
            AND (pr.site_id IS NULL OR pr.site_id = $1)
            AND (pr.site_ids IS NULL OR $1 = ANY(pr.site_ids))",
    )
    .bind(site_id)
    .bind(channel)
    .fetch_all(&mut **tx)
    .await?;

    let mut entries = Vec::with_capacity(rows.len());
    let mut sku_code_by_id = BTreeMap::new();
    let mut sku_id_by_code = BTreeMap::new();
    let mut publication_version = 0_i64;
    for row in rows {
        let sku_id: Uuid = row.get("sku_id");
        let sku_code: String = row.get("sku_code");
        let version: i64 = row.get("version");
        publication_version = publication_version.max(version);
        sku_code_by_id.insert(sku_id, sku_code.clone());
        sku_id_by_code.insert(sku_code.clone(), sku_id);
        entries.push(PriceEntry {
            sku_code,
            applies_to: level_of(row.get("site_id"), row.get("site_ids"), row.get("tier")),
            channel: row.get("channel"),
            sellable: row.get("sellable"),
            currency: Currency(row.get::<String, _>("currency").trim().to_string()),
            unit_price: Money::new(row.get::<i64, _>("unit_price_minor")),
            tax_category: row.get("tax_category"),
            publication_version: version,
            // A publication states validity once, for the whole price book.
            effective_from: row.get("effective_from"),
            effective_to: row.get("effective_to"),
        });
    }

    let markdowns = sqlx::query(
        "SELECT m.markdown_id, m.sku_code, m.article_code, m.site_id, m.site_ids, m.tier,
                m.replacement_unit_price_minor, m.priority, p.version,
                m.effective_from, m.effective_to
           FROM commercial_markdown m
           JOIN commercial_publication p ON p.id = m.publication_id
          WHERE p.status = 'PUBLISHED'
            AND (m.site_id IS NULL OR m.site_id = $1)
            AND (m.site_ids IS NULL OR $1 = ANY(m.site_ids))",
    )
    .bind(site_id)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| Markdown {
        markdown_id: row.get("markdown_id"),
        sku_code: row.get("sku_code"),
        article_code: row.get("article_code"),
        applies_to: level_of(row.get("site_id"), row.get("site_ids"), row.get("tier")),
        replacement_unit_price: Money::new(row.get::<i64, _>("replacement_unit_price_minor")),
        priority: i64::from(row.get::<i32, _>("priority")),
        publication_version: row.get("version"),
        effective_from: row.get("effective_from"),
        effective_to: row.get("effective_to"),
    })
    .collect();

    let _ = at; // The window is applied by the engine, from the context.
    Ok(SitePricing {
        snapshot: PricingSnapshot {
            publication_version,
            entries,
            markdowns,
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns: Vec::new(),
        },
        sku_code_by_id,
        sku_id_by_code,
    })
}

/// Promotions are stored as the engine's own documents. One this build cannot
/// read is skipped rather than fatal, exactly as at a shop: an unreadable offer
/// must cost a discount, never the ability to sell.
async fn load_rules(
    tx: &mut Transaction<'_, Postgres>,
    usage: &UsageCounts,
) -> Result<Vec<Rule>, AppError> {
    let mut rules = Vec::new();
    for row in sqlx::query(
        "SELECT r.definition FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED' ORDER BY r.rule_id",
    )
    .fetch_all(&mut **tx)
    .await?
    {
        let document: Value = row.get("definition");
        match serde_json::from_value::<Rule>(document) {
            Ok(mut rule) => {
                rule.caps = with_usage(
                    rule.caps,
                    usage.get(&("RULE".to_string(), rule.rule_id.clone())),
                );
                rules.push(rule);
            }
            Err(error) => tracing::warn!(
                %error,
                "skipping a promotion this build cannot read; prices are unaffected"
            ),
        }
    }

    Ok(rules)
}

/// The codes that unlock those promotions.
async fn load_coupons(
    tx: &mut Transaction<'_, Postgres>,
    usage: &UsageCounts,
) -> Result<Vec<Coupon>, AppError> {
    Ok(sqlx::query(
        "SELECT c.code, c.rule_id, c.active, c.customer_id, c.valid_from, c.valid_to,
                c.max_uses, c.used
           FROM commercial_coupon c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'",
    )
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| {
        let code: String = row.get("code");
        // A coupon has no `Caps`; its count is one number on the row. The
        // publication's copy is the one that was true when the book was
        // written, which is to say never true again.
        let used = usage
            .get(&("COUPON".to_string(), code.clone()))
            .map_or_else(|| i64::from(row.get::<i32, _>("used")), |(uses, _)| *uses);
        Coupon {
            code,
            rule_id: row.get("rule_id"),
            active: row.get("active"),
            customer_id: row.get("customer_id"),
            valid_from: row.get("valid_from"),
            valid_to: row.get("valid_to"),
            max_uses: row.get::<Option<i32>, _>("max_uses").map(i64::from),
            used,
        }
    })
    .collect())
}

/// The envelopes those promotions sit in.
async fn load_campaigns(
    tx: &mut Transaction<'_, Postgres>,
    usage: &UsageCounts,
) -> Result<Vec<Campaign>, AppError> {
    Ok(sqlx::query(
        "SELECT c.campaign_id, c.name, c.status, c.valid_from, c.valid_to,
                c.budget_minor, c.spent_minor, c.max_uses, c.used, c.max_uses_per_customer
           FROM commercial_campaign c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED' ORDER BY c.campaign_id",
    )
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| {
        let campaign_id: String = row.get("campaign_id");
        Campaign {
        campaign_id: campaign_id.clone(),
        name: row.get("name"),
        status: campaign_status(&row.get::<String, _>("status")),
        valid_from: row.get("valid_from"),
        valid_to: row.get("valid_to"),
        caps: with_usage(
            Caps {
                budget: row.get::<Option<i64>, _>("budget_minor").map(Money::new),
                spent: Money::new(row.get::<i64, _>("spent_minor")),
                max_uses: row.get::<Option<i32>, _>("max_uses").map(i64::from),
                used: i64::from(row.get::<i32, _>("used")),
                max_uses_per_customer: row
                    .get::<Option<i32>, _>("max_uses_per_customer")
                    .map(i64::from),
            },
            usage.get(&("CAMPAIGN".to_string(), campaign_id)),
        ),
        }
    })
    .collect())
}

/// What a product *is*, as the rules that price a whole range need to know it.
///
/// The engine matches a markdown or a promotion on the article, the division or
/// a tag — and it is told these, never deriving them from the SKU code, because
/// an engine that knew how a SKU code is built would break the day that format
/// changed (see `CartLine::article_code`).
///
/// Nothing told it. Every caller built its cart lines with `CartLine::new`,
/// which leaves all three empty, so an article-wide clearance was authored,
/// validated, stored, shipped to every shop, loaded into the snapshot — and
/// then matched nothing, in the centre and at the till alike. This is the half
/// that was missing.
pub struct Merchandise {
    pub article_code: String,
    pub article_name: String,
    pub division_code: Option<String>,
    pub tags: Vec<String>,
}

/// Every catalogued product, by the code the engine names it by.
pub async fn load_merchandise(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<BTreeMap<String, Merchandise>, AppError> {
    let rows = sqlx::query(
        "SELECT s.sku_code, a.article_code, a.name article_name, a.division_code,
                COALESCE(
                    array_agg(t.tag_code ORDER BY t.tag_code)
                        FILTER (WHERE t.tag_code IS NOT NULL),
                    '{}'
                ) tags
           FROM sku s
           JOIN article a ON a.id = s.article_id
           LEFT JOIN article_tag t ON t.article_id = a.id
          WHERE s.active
          GROUP BY s.sku_code, a.article_code, a.name, a.division_code",
    )
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("sku_code"),
                Merchandise {
                    article_code: row.get("article_code"),
                    article_name: row.get("article_name"),
                    division_code: row.get("division_code"),
                    tags: row.get("tags"),
                },
            )
        })
        .collect())
}

/// One line for the engine, carrying what the product is as well as its code.
///
/// A product the merchandise map does not know still gets a line — priced by
/// its SKU code alone, matching nothing that targets a range. That is the
/// honest degradation: an unknown article means a range rule cannot be judged
/// to apply, and inventing an article code to make one apply would be worse
/// than the rule not applying.
pub fn cart_line(
    sku_code: &str,
    quantity: i64,
    merchandise: &BTreeMap<String, Merchandise>,
) -> CartLine {
    let mut line = CartLine::new(sku_code.to_string(), quantity);
    if let Some(facts) = merchandise.get(sku_code) {
        line.article_code = Some(facts.article_code.clone());
        line.division = facts.division_code.clone();
        line.tags = facts.tags.clone();
    }
    line
}
