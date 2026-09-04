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
fn level_of(site_id: Option<String>, site_ids: Option<Vec<String>>) -> PriceLevel {
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
    // A `tier` column with something in it is a row from before tiers were
    // removed. It reads as a company price rather than being skipped: the
    // alternative is a product that silently has no price at all, and a shop
    // that cannot sell a shirt is worse than one that sells it at the
    // company's number.
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
    Ok(
        sqlx::query("SELECT kind, key, uses, spent_minor FROM commercial_usage")
            .fetch_all(&mut **tx)
            .await?
            .into_iter()
            .map(|row| {
                (
                    (row.get::<String, _>("kind"), row.get::<String, _>("key")),
                    (row.get::<i64, _>("uses"), row.get::<i64, _>("spent_minor")),
                )
            })
            .collect(),
    )
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
                pr.sku_id, s.sku_code, pr.site_id, pr.site_ids, pr.channel,
                ar.sellable, pr.currency::text currency, pr.unit_price_minor, pr.tax_category
           FROM commercial_price_rule pr
           JOIN commercial_publication p ON p.id = pr.publication_id
           JOIN sku s ON s.id = pr.sku_id
           JOIN commercial_assortment_rule ar
             ON ar.publication_id = pr.publication_id AND ar.sku_id = pr.sku_id
            AND ar.channel = pr.channel AND ar.site_id IS NOT DISTINCT FROM pr.site_id
          WHERE p.status = 'PUBLISHED'
            AND p.effective_from <= $3
            AND (p.effective_to IS NULL OR p.effective_to > $3)
            AND pr.channel = $2
            AND (pr.site_id IS NULL OR pr.site_id = $1)
            AND (pr.site_ids IS NULL OR $1 = ANY(pr.site_ids))",
    )
    .bind(site_id)
    .bind(channel)
    .bind(at)
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
            applies_to: level_of(row.get("site_id"), row.get("site_ids")),
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
        // DISTINCT ON, and the three loaders below say the same thing for the
        // same reason.
        //
        // A shop keys `commercial_markdown` on `markdown_id` alone and replaces
        // on apply, so it holds exactly one row per id: the newest book's. The
        // centre scopes per publication and held every version at once — so a
        // clearance extended into a later book at a deeper cut existed twice
        // here and once there.
        //
        // That is not a tie the ranking can break. `PriceIndex::markdown` ranks
        // on (priority, effective_from, markdown_id) and never on version, so
        // two copies of one markdown tie on all three keys and the winner is
        // whichever row Postgres happened to return first. The centre's shelf
        // list and the counter then quote different prices, non-deterministically,
        // and the answer can change between two page loads.
        //
        // So the centre reproduces the shop's model explicitly rather than
        // relying on a comparator that was never given a version to compare.
        "SELECT DISTINCT ON (m.markdown_id)
                m.markdown_id, m.sku_code, m.article_code, m.site_id, m.site_ids,
                m.replacement_unit_price_minor, m.priority, p.version,
                m.effective_from, m.effective_to, m.campaign_id,
                m.iso_weekdays, m.from_minute, m.to_minute
           FROM commercial_markdown m
           JOIN commercial_publication p ON p.id = m.publication_id
          WHERE p.status = 'PUBLISHED'
            AND m.effective_from <= $2
            AND (m.effective_to IS NULL OR m.effective_to > $2)
            AND (m.site_id IS NULL OR m.site_id = $1)
            AND (m.site_ids IS NULL OR $1 = ANY(m.site_ids))
          ORDER BY m.markdown_id, p.version DESC",
    )
    .bind(site_id)
    .bind(at)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| Markdown {
        markdown_id: row.get("markdown_id"),
        sku_code: row.get("sku_code"),
        article_code: row.get("article_code"),
        applies_to: level_of(row.get("site_id"), row.get("site_ids")),
        replacement_unit_price: Money::new(row.get::<i64, _>("replacement_unit_price_minor")),
        priority: i64::from(row.get::<i32, _>("priority")),
        publication_version: row.get("version"),
        // The campaign it belongs to, so the centre's own shelf list is gated by
        // the same switch the till is. Without it the merchandiser's screen
        // would keep showing a paused flash sale's prices.
        campaign_id: row.get("campaign_id"),
        // Read here as well as at the shop, so the merchandiser's own price
        // check is dark at the same minutes the till is.
        days: pricing_engine::DaySet {
            iso_weekdays: row
                .get::<Vec<i16>, _>("iso_weekdays")
                .into_iter()
                .filter_map(|day| u32::try_from(day).ok())
                .collect(),
        },
        time_window: row
            .get::<Option<i32>, _>("from_minute")
            .zip(row.get::<Option<i32>, _>("to_minute"))
            .map(|(from, to)| pricing_engine::TimeWindow {
                from_minute: from.max(0) as u32,
                to_minute: to.max(0) as u32,
            }),
        effective_from: row.get("effective_from"),
        effective_to: row.get("effective_to"),
    })
    .collect();

    // Campaigns, and only campaigns.
    //
    // This loader used to carry none, and the comment at its one caller still
    // explains why: a stack is base prices and markdowns, a promotion is a
    // statement about a basket, so reading the promotion tables here would be
    // three queries per branch thrown away.
    //
    // That stopped being true the day a MARKDOWN could name a campaign. A
    // campaign is now a switch over prices, not only over offers — and with
    // none loaded, the engine reads every clearance as belonging to a campaign
    // this reader does not hold, which it deliberately treats as "leave the
    // cleared price standing". The console would then keep showing a paused
    // flash sale's prices while every till in the fleet had already put them
    // back up: the merchandiser's own price check disagreeing with the counter,
    // which is the exact fault `resolve_offer` was rewritten to end.
    //
    // Rules and coupons stay out. Nothing here evaluates a rule, so their caps
    // are not consulted either — which is why the usage counts are not read.
    let campaigns = load_campaigns(tx, &UsageCounts::new()).await?;

    Ok(SitePricing {
        snapshot: PricingSnapshot {
            publication_version,
            entries,
            markdowns,
            rules: Vec::new(),
            coupons: Vec::new(),
            campaigns,
        },
        sku_code_by_id,
        sku_id_by_code,
    })
}

/// Promotions are stored as the engine's own documents. One this build cannot
/// read is skipped rather than fatal, exactly as at a shop: an unreadable offer
/// must cost a discount, never the ability to sell.
///
/// Unlike markdowns, coupons and campaigns, these are NOT narrowed by their
/// window here. A rule's window lives inside its document, and migration 0031
/// is explicit that nothing queries inside a rule — a second reader of rule
/// shape is the one thing that design avoids. The engine drops a lapsed rule on
/// the next line anyway; what it costs is reading rules that will be discarded,
/// which is bounded by how many promotions the business has ever run rather
/// than by how large the catalogue is.
async fn load_rules(
    tx: &mut Transaction<'_, Postgres>,
    usage: &UsageCounts,
) -> Result<Vec<Rule>, AppError> {
    let mut rules = Vec::new();
    for row in sqlx::query(
        // One row per rule_id, newest book wins — the shop's model, which is
        // also how usage is counted (`commercial_usage` is keyed per rule id
        // across every publication, because a promotion run twice is one
        // promotion amended, not two).
        //
        // Without this, a promotion repeated in a later book was loaded twice
        // and — the composer's default being STACKABLE — applied twice. The
        // simulator, which is the screen built to explain a price, reported
        // 20% + 25% off where the till charged 25%.
        "SELECT DISTINCT ON (r.rule_id) r.definition
           FROM commercial_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY r.rule_id, p.version DESC",
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
///
/// Deliberately NOT narrowed by validity, unlike the prices and markdowns above.
/// To the engine a coupon that is absent and a coupon that has lapsed are
/// different answers — `CouponUnknown` against `CouponExpired`, "no such code"
/// against "that one expired on Friday" — and dropping the lapsed ones here
/// would make the centre give the first answer where a till gives the second.
/// The saving is not worth changing an explanation.
async fn load_coupons(
    tx: &mut Transaction<'_, Postgres>,
    usage: &UsageCounts,
) -> Result<Vec<Coupon>, AppError> {
    Ok(sqlx::query(
        "SELECT DISTINCT ON (c.code)
                c.code, c.rule_id, c.active, c.customer_id, c.valid_from, c.valid_to,
                c.max_uses
           FROM commercial_coupon c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.code, p.version DESC",
    )
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|row| {
        let code: String = row.get("code");
        // A coupon has no `Caps`; its count is one number.
        // Nought when nothing has counted it, never the publication's own
        // copy.
        //
        // A count with two sources is the fault this whole area keeps
        // producing, and this was one: `commercial_usage` when it had a row,
        // and a column frozen into the price book when it did not. The two
        // agree today only because authoring always writes nought — which
        // means the column was never an answer, only a coincidence that
        // matched one.
        //
        // No row in `commercial_usage` means no sale has redeemed this code.
        // That is not missing information; it is the information.
        let used = usage
            .get(&("COUPON".to_string(), code.clone()))
            .map_or(0, |(uses, _)| *uses);
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
///
/// Not narrowed by validity either, and for a sharper reason than the coupons.
/// A rule whose campaign is missing is refused as `CampaignUnknown` — the
/// engine treats an absent envelope as "this shop never received that
/// promotion", which is a thing somebody drives to a shop about. A campaign
/// that has simply ended is `Expired`. Dropping the ended ones here would turn
/// every finished promotion into an apparent delivery failure.
async fn load_campaigns(
    tx: &mut Transaction<'_, Postgres>,
    usage: &UsageCounts,
) -> Result<Vec<Campaign>, AppError> {
    Ok(sqlx::query(
        // Newest book wins, as above — and here it decides a switch rather than
        // a number. `gate` picks a campaign with `.find()`, so two rows for one
        // campaign_id meant a campaign paused by republishing it PAUSED could
        // still be found ACTIVE from the older book: stopped at thirty tills
        // and running at head office.
        "SELECT DISTINCT ON (c.campaign_id)
                c.campaign_id, c.name, c.status, c.valid_from, c.valid_to,
                c.budget_minor, c.max_uses
           FROM commercial_campaign c
           JOIN commercial_publication p ON p.id = c.publication_id
          WHERE p.status = 'PUBLISHED'
          ORDER BY c.campaign_id, p.version DESC",
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
                    // As the coupons above: one source for a count, and it is not
                    // a column frozen into the book that declared the limit.
                    spent: Money::ZERO,
                    max_uses: row.get::<Option<i32>, _>("max_uses").map(i64::from),
                    used: 0,
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
