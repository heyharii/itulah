//! Reading the shop's resident price book, and asking the engine what things
//! cost.
//!
//! The prices themselves have been arriving here for a while. Nothing read
//! them. A publication landed on the command lane, `commercial_price_rule` was
//! filled in faithfully, and the till went on charging the price that was
//! stamped on each unit when it was received — so a price change published at
//! the centre reached the shop, was stored, and changed nothing.
//!
//! This module is the missing half: it loads what is resident into a
//! [`PricingSnapshot`] and hands it to `pricing-engine`, which is the same
//! evaluator the centre uses. The shelf edge, the catalogue screen, and the
//! receipt all come out of this one path, so they cannot quote three different
//! numbers for the same shirt.

use chrono::{DateTime, Utc};
use pricing_engine::{
    price_cart, price_catalog, Campaign, CampaignStatus, Caps, CartLine, CatalogEntry, Coupon,
    Currency, Markdown, Money, PriceEntry, PriceLevel, PricingContext, PricingError,
    PricingSnapshot, Rule,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::edge::EdgeError;

/// The sales channel a till serves. Shops sell over the counter; the other
/// channels the centre publishes for are priced elsewhere.
pub const STORE_CHANNEL: &str = "STORE";

fn db(error: rusqlite::Error) -> EdgeError {
    EdgeError::Persistence(error.to_string())
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, EdgeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| EdgeError::Persistence(error.to_string()))
}

/// Load every price rule this shop holds that could apply to it.
///
/// Rules for *other* shops are filtered out in SQL rather than carried into
/// the engine and rejected there. A shop has no business holding another
/// branch's prices in memory, and the smaller snapshot is the one that is
/// obviously correct.
///
/// Rules with no `sku_code` are skipped. Those predate migration 0015 and
/// carry only the centre's UUID, which nothing in this database can match to a
/// product — see that migration for why they are not repaired in place.
pub fn load_snapshot(
    connection: &Connection,
    site_id: &str,
    channel: &str,
) -> Result<PricingSnapshot, EdgeError> {
    load_snapshot_for(connection, site_id, channel, None)
}

/// The same, narrowed to the products actually being priced.
///
/// `Some(codes)` loads only what those products need. This is the difference
/// between a till that rings up a basket in a millisecond and one that slows
/// down every time the company adds a season: pricing five items has no
/// business reading forty thousand prices, and the cost of doing so is not
/// visible in a test shop with ten SKUs in it.
///
/// Promotion rules are always loaded whole. A rule can match anything in the
/// basket, including products not in it — a whole-cart threshold reads every
/// line — and there are tens of them, not tens of thousands.
pub fn load_snapshot_for(
    connection: &Connection,
    site_id: &str,
    channel: &str,
    sku_codes: Option<&[String]>,
) -> Result<PricingSnapshot, EdgeError> {
    // The SKU filter is built as one bound parameter per code rather than
    // interpolated, so a product code can never be read as SQL.
    let narrowing = match sku_codes {
        Some(codes) if !codes.is_empty() => {
            let slots = (0..codes.len())
                .map(|index| format!("?{}", index + 3))
                .collect::<Vec<_>>()
                .join(",");
            format!(" AND r.sku_code IN ({slots})")
        }
        // An empty basket narrows to nothing at all, which is not the same as
        // "no filter" — asking for the price of nothing must not load the book.
        Some(_) => " AND 0".to_string(),
        None => String::new(),
    };
    let sql = format!(
        "SELECT p.version, p.effective_from, p.effective_to,
                r.sku_code, r.site_id, r.channel, r.sellable, r.currency,
                r.unit_price_minor, r.tax_category, r.site_ids_json, r.tier
           FROM commercial_price_rule r
           JOIN commercial_publication p ON p.id = r.publication_id
          WHERE r.sku_code IS NOT NULL
            AND r.channel = ?1
            AND (r.site_id IS NULL OR r.site_id = ?2){narrowing}"
    );
    let mut bound: Vec<&dyn rusqlite::ToSql> = vec![&channel, &site_id];
    if let Some(codes) = sku_codes {
        for code in codes {
            bound.push(code);
        }
    }
    let mut statement = connection.prepare(&sql).map_err(db)?;
    let rows = statement
        .query_map(bound.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(db)?;

    let mut entries = Vec::new();
    let mut publication_version = 0_i64;
    for row in rows {
        let (
            version,
            effective_from,
            effective_to,
            sku_code,
            rule_site,
            rule_channel,
            sellable,
            currency,
            unit_price_minor,
            tax_category,
            site_ids_json,
            tier,
        ) = row.map_err(db)?;
        publication_version = publication_version.max(version);
        entries.push(PriceEntry {
            sku_code,
            applies_to: read_level(rule_site, site_ids_json.as_deref(), tier.as_deref())?,
            channel: rule_channel,
            sellable: sellable != 0,
            currency: Currency(currency.trim().to_string()),
            unit_price: Money::new(unit_price_minor),
            tax_category,
            publication_version: version,
            // A publication's window is the window of every rule in it. The
            // centre states validity once, for the whole price book.
            effective_from: parse_time(&effective_from)?,
            effective_to: effective_to.as_deref().map(parse_time).transpose()?,
        });
    }

    let usage = load_usage(connection)?;
    Ok(PricingSnapshot {
        publication_version,
        entries,
        markdowns: load_markdowns(connection, site_id, sku_codes)?,
        rules: load_rules(connection, &usage)?,
        coupons: load_coupons(connection, &usage)?,
        campaigns: load_campaigns(connection, &usage)?,
    })
}

/// What promotions have already given away, as the centre last counted.
///
/// Keyed by (kind, key) — `RULE`/`CAMPAIGN`/`COUPON` and the id or code.
type UsageCounts = std::collections::BTreeMap<(String, String), (i64, i64)>;

fn load_usage(connection: &Connection) -> Result<UsageCounts, EdgeError> {
    let mut statement = connection
        .prepare("SELECT kind, key, uses, spent_minor FROM commercial_usage")
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(db)?;
    let mut counts = UsageCounts::new();
    for row in rows {
        let (kind, key, uses, spent) = row.map_err(db)?;
        counts.insert((kind, key), (uses, spent));
    }
    Ok(counts)
}

/// Overlay what has actually been spent onto the limits a publication declared.
///
/// The publication states the limit and is frozen; this states the count and
/// changes with every sale. Where the centre has counted, its number wins — the
/// figure baked into the price book is the one that was true when the book was
/// written, which is to say never true again.
fn with_usage(mut caps: Caps, counted: Option<&(i64, i64)>) -> Caps {
    if let Some((uses, spent)) = counted {
        caps.used = *uses;
        caps.spent = Money::new(*spent);
    }
    caps
}

/// Read which shops and shoppers a stored price applies to.
///
/// The four levels live in three nullable columns, and only one of them may be
/// set. Reading them in a fixed order — narrowest first — means a row that
/// somehow carries two is resolved the same way everywhere rather than
/// according to whichever branch a reader wrote first.
fn read_level(
    site_id: Option<String>,
    site_ids_json: Option<&str>,
    tier: Option<&str>,
) -> Result<PriceLevel, EdgeError> {
    if let Some(site_id) = site_id {
        return Ok(PriceLevel::Site { site_id });
    }
    if let Some(document) = site_ids_json {
        let site_ids: std::collections::BTreeSet<String> = serde_json::from_str(document)
            .map_err(|error| EdgeError::Persistence(error.to_string()))?;
        // An empty group names no shop at all. Treating it as "everywhere"
        // would turn a mistake in authoring into a company-wide price.
        if !site_ids.is_empty() {
            return Ok(PriceLevel::SiteGroup { site_ids });
        }
    }
    if let Some(tier) = tier {
        return Ok(PriceLevel::Tier { tier: tier.into() });
    }
    Ok(PriceLevel::Company)
}

/// Campaigns resident at this shop.
///
/// Loaded whole, and it matters that they are: a promotion naming a campaign
/// this shop does not hold refuses to apply, so a campaign missed by sync
/// silently disables its offers rather than silently freeing them.
fn load_campaigns(
    connection: &Connection,
    usage: &UsageCounts,
) -> Result<Vec<Campaign>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT campaign_id, name, status, valid_from, valid_to,
                    budget_minor, spent_minor, max_uses, used, max_uses_per_customer
               FROM commercial_campaign ORDER BY campaign_id",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, Option<i64>>(9)?,
            ))
        })
        .map_err(db)?;

    let mut campaigns = Vec::new();
    for row in rows {
        let (
            campaign_id,
            name,
            status,
            valid_from,
            valid_to,
            budget,
            spent,
            max_uses,
            used,
            per_customer,
        ) = row.map_err(db)?;
        let campaign_id_for_usage = campaign_id.clone();
        campaigns.push(Campaign {
            campaign_id,
            name,
            status: match status.as_str() {
                "DRAFT" => CampaignStatus::Draft,
                "SCHEDULED" => CampaignStatus::Scheduled,
                "ACTIVE" => CampaignStatus::Active,
                "PAUSED" => CampaignStatus::Paused,
                "EXPIRED" => CampaignStatus::Expired,
                // Anything this build does not recognise is treated as not
                // running. A status we cannot read must not leave a promotion
                // live by default.
                _ => CampaignStatus::Cancelled,
            },
            valid_from: valid_from.as_deref().map(parse_time).transpose()?,
            valid_to: valid_to.as_deref().map(parse_time).transpose()?,
            caps: with_usage(
                Caps {
                    budget: budget.map(Money::new),
                    spent: Money::new(spent),
                    max_uses,
                    used,
                    max_uses_per_customer: per_customer,
                },
                usage.get(&("CAMPAIGN".to_string(), campaign_id_for_usage.clone())),
            ),
        });
    }
    Ok(campaigns)
}

/// Markdowns resident at this shop.
///
/// Scoped in SQL, like prices: a branch has no business holding another
/// branch's clearance, and the smaller snapshot is the one that is obviously
/// correct.
fn load_markdowns(
    connection: &Connection,
    site_id: &str,
    sku_codes: Option<&[String]>,
) -> Result<Vec<Markdown>, EdgeError> {
    // Article-wide clearance is always loaded: it names a style, not a product,
    // and the engine matches it against the article on each line. Only the
    // per-SKU rows can be narrowed by what is in the basket.
    let narrowing = match sku_codes {
        Some(codes) if !codes.is_empty() => {
            let slots = (0..codes.len())
                .map(|index| format!("?{}", index + 2))
                .collect::<Vec<_>>()
                .join(",");
            format!(" AND (m.sku_code IS NULL OR m.sku_code IN ({slots}))")
        }
        Some(_) => " AND m.sku_code IS NULL".to_string(),
        None => String::new(),
    };
    let sql = format!(
        "SELECT m.markdown_id, m.sku_code, m.article_code, m.site_id,
                m.replacement_unit_price_minor, m.priority, m.effective_from, m.effective_to,
                m.site_ids_json, m.tier, COALESCE(p.version, 0)
           FROM commercial_markdown m
           LEFT JOIN commercial_publication p ON p.id = m.publication_id
          WHERE (m.site_id IS NULL OR m.site_id = ?1){narrowing}"
    );
    let mut bound: Vec<&dyn rusqlite::ToSql> = vec![&site_id];
    if let Some(codes) = sku_codes {
        for code in codes {
            bound.push(code);
        }
    }
    let mut statement = connection.prepare(&sql).map_err(db)?;
    let rows = statement
        .query_map(bound.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })
        .map_err(db)?;

    let mut markdowns = Vec::new();
    for row in rows {
        let (
            markdown_id,
            sku_code,
            article_code,
            row_site,
            replacement,
            priority,
            effective_from,
            effective_to,
            site_ids_json,
            tier,
            publication_version,
        ) = row.map_err(db)?;
        markdowns.push(Markdown {
            markdown_id,
            sku_code,
            article_code,
            applies_to: read_level(row_site, site_ids_json.as_deref(), tier.as_deref())?,
            replacement_unit_price: Money::new(replacement),
            priority,
            publication_version,
            effective_from: parse_time(&effective_from)?,
            effective_to: effective_to.as_deref().map(parse_time).transpose()?,
        });
    }
    Ok(markdowns)
}

/// Promotion rules resident at this shop.
///
/// A rule is stored as the engine's own document and parsed back by the engine's
/// own type. A rule this build cannot understand is skipped rather than
/// guessed at or fatal: the centre may be ahead of this shop, and a shop that
/// refuses to sell because it received one promotion it does not recognise is
/// worse than a shop that sells without that promotion. The prices themselves
/// are unaffected — those come down a path that does block on the unknown,
/// because a price that cannot be read is a price that cannot be charged.
fn load_rules(connection: &Connection, usage: &UsageCounts) -> Result<Vec<Rule>, EdgeError> {
    let mut statement = connection
        .prepare("SELECT definition_json FROM commercial_rule ORDER BY rule_id")
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db)?;
    let mut rules = Vec::new();
    for row in rows {
        let document = row.map_err(db)?;
        match serde_json::from_str::<Rule>(&document) {
            Ok(mut rule) => {
                rule.caps = with_usage(
                    rule.caps,
                    usage.get(&("RULE".to_string(), rule.rule_id.clone())),
                );
                rules.push(rule);
            }
            Err(error) => {
                tracing::warn!(
                    %error,
                    "skipping a promotion rule this build cannot read; \
                     prices are unaffected"
                );
            }
        }
    }
    Ok(rules)
}

fn load_coupons(connection: &Connection, usage: &UsageCounts) -> Result<Vec<Coupon>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT code, rule_id, active, customer_id, valid_from, valid_to, max_uses, used
               FROM commercial_coupon",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })
        .map_err(db)?;

    let mut coupons = Vec::new();
    for row in rows {
        let (code, rule_id, active, customer_id, valid_from, valid_to, max_uses, used) =
            row.map_err(db)?;
        // A coupon's own limit is a use count, not a budget, so only the first
        // half of the pair means anything here.
        let redeemed = usage
            .get(&("COUPON".to_string(), code.clone()))
            .map_or(used, |(uses, _)| *uses);
        coupons.push(Coupon {
            code,
            rule_id,
            active: active != 0,
            customer_id,
            valid_from: valid_from.as_deref().map(parse_time).transpose()?,
            valid_to: valid_to.as_deref().map(parse_time).transpose()?,
            max_uses,
            used: redeemed,
        });
    }
    Ok(coupons)
}

/// One product on the shop's shelf, priced.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct CatalogRow {
    pub sku_code: String,
    pub name: String,
    pub uom: String,
    pub barcode: Option<String>,
    /// What the till will charge, in the smallest currency unit.
    pub unit_price_minor: i64,
    /// What it would cost without a markdown. Equal to `unit_price_minor` when
    /// nothing is marked down — the shelf edge needs both to show a was-price.
    pub base_unit_price_minor: i64,
    pub currency: String,
    pub tax_category: String,
    /// Where the price came from: the shop's own list, the company list, or a
    /// markdown. A cashier asked "why is this price different" has an answer.
    pub price_source: String,
    pub publication_version: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct CatalogQuery {
    pub cursor: Option<String>,
    pub q: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CatalogPage {
    pub items: Vec<CatalogRow>,
    pub next_cursor: Option<String>,
    pub limit: usize,
}

/// What a product *is*, as a range-wide markdown or promotion needs to know it.
///
/// The mirror of `cloud/postgres/pricing.rs::load_merchandise`, against the
/// resident catalogue. Both exist so the engine is told the style, the division
/// and the tags rather than deriving them from the SKU code — it deliberately
/// cannot, because a format change would then silently change what a promotion
/// matches.
///
/// Every caller here used to build lines with `CartLine::new`, which leaves all
/// three empty. An article-wide clearance therefore matched nothing at any till
/// in the fleet, and nothing said so.
fn merchandise(
    connection: &Connection,
    sku_codes: Option<&[String]>,
) -> Result<
    std::collections::BTreeMap<String, (Option<String>, Option<String>, Vec<String>)>,
    EdgeError,
> {
    let narrowing = match sku_codes {
        Some(codes) if !codes.is_empty() => {
            let slots = (0..codes.len())
                .map(|index| format!("?{}", index + 1))
                .collect::<Vec<_>>()
                .join(",");
            format!(" WHERE sku_code IN ({slots})")
        }
        Some(_) => " WHERE 0".to_string(),
        None => String::new(),
    };
    let sql = format!(
        "SELECT sku_code, article_code, division_code, tags_json FROM catalog_item{narrowing}"
    );
    let bound: Vec<&dyn rusqlite::ToSql> = sku_codes
        .into_iter()
        .flatten()
        .map(|code| code as &dyn rusqlite::ToSql)
        .collect();
    let mut statement = connection.prepare(&sql).map_err(db)?;
    let mut facts = std::collections::BTreeMap::new();
    let rows = statement
        .query_map(bound.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(db)?;
    for row in rows {
        let (sku_code, article_code, division_code, tags_json) = row.map_err(db)?;
        // A tag list this build cannot read costs the tags and nothing else.
        // Refusing to price a basket because a label was malformed would turn a
        // cosmetic fault into a shop that cannot sell.
        let tags: Vec<String> = tags_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or_default();
        facts.insert(sku_code, (article_code, division_code, tags));
    }
    Ok(facts)
}

/// One line for the engine, carrying what the product is as well as its code.
fn line_for(
    sku_code: &str,
    quantity: i64,
    facts: &std::collections::BTreeMap<String, (Option<String>, Option<String>, Vec<String>)>,
) -> CartLine {
    let mut line = CartLine::new(sku_code.to_string(), quantity);
    if let Some((article_code, division_code, tags)) = facts.get(sku_code) {
        line.article_code = article_code.clone();
        line.division = division_code.clone();
        line.tags = tags.clone();
    }
    line
}

/// What this shop may sell today, and for how much.
///
/// The catalogue is the centre's list of products; the price book is the
/// centre's list of prices. This joins them and returns only what has both: a
/// product with no price cannot be sold, so listing it would put a row on a
/// screen that the till refuses at the counter.
pub fn store_catalog(
    connection: &Connection,
    site_id: &str,
    channel: &str,
    at: DateTime<Utc>,
) -> Result<Vec<CatalogRow>, EdgeError> {
    let snapshot = load_snapshot(connection, site_id, channel)?;
    let context = crate::reporting::pricing_context(site_id, channel, at);

    let mut statement = connection
        .prepare(
            "SELECT sku_code, name, uom, barcode
               FROM catalog_item
              WHERE active = 1
              ORDER BY sku_code",
        )
        .map_err(db)?;
    let items = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;

    let facts = merchandise(connection, None)?;
    let products: Vec<CartLine> = items
        .iter()
        .map(|(code, ..)| line_for(code, 1, &facts))
        .collect();
    let priced: Vec<CatalogEntry> = price_catalog(&snapshot, &context, &products);

    // `price_catalog` returns entries ordered by SKU code, and the catalogue
    // query is ordered the same way, so this walks both in step rather than
    // building a map: an unpriced product simply has no entry to line up with.
    let mut rows = Vec::with_capacity(priced.len());
    let mut priced = priced.into_iter().peekable();
    for (sku_code, name, uom, barcode) in items {
        let Some(entry) = priced.peek() else { break };
        if entry.sku_code != sku_code {
            continue;
        }
        let Some(entry) = priced.next() else { break };
        rows.push(CatalogRow {
            sku_code,
            name,
            uom,
            barcode,
            unit_price_minor: entry.unit_price.minor,
            base_unit_price_minor: entry.base_unit_price.minor,
            currency: entry.currency.0,
            tax_category: entry.tax_category,
            price_source: entry.source.as_str().to_string(),
            publication_version: entry.publication_version,
        });
    }
    Ok(rows)
}

/// One bounded catalogue page. Both the catalogue facts and the price book
/// are narrowed to the selected SKU codes, so pagination reduces database and
/// pricing-engine work rather than merely truncating the JSON response.
pub fn store_catalog_page(
    connection: &Connection,
    site_id: &str,
    channel: &str,
    at: DateTime<Utc>,
    query: CatalogQuery,
) -> Result<CatalogPage, EdgeError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let cursor = query
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let needle = query.q.as_deref().map(str::trim).filter(|v| !v.is_empty());
    let mut statement = connection
        .prepare(
            "SELECT sku_code, name, uom, barcode
               FROM catalog_item
              WHERE active = 1
                AND (?1 IS NULL OR sku_code > ?1)
                AND (?2 IS NULL OR sku_code LIKE '%'||?2||'%'
                     OR name LIKE '%'||?2||'%' OR barcode LIKE '%'||?2||'%')
              ORDER BY sku_code
              LIMIT ?3",
        )
        .map_err(db)?;
    let scanned = statement
        .query_map(
            rusqlite::params![cursor, needle, (limit + 1) as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .map_err(db)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db)?;
    let has_more = scanned.len() > limit;
    let scanned: Vec<_> = scanned.into_iter().take(limit).collect();
    let sku_codes: Vec<String> = scanned.iter().map(|(code, ..)| code.clone()).collect();
    let next_cursor = has_more.then(|| sku_codes.last().cloned()).flatten();
    let snapshot = load_snapshot_for(connection, site_id, channel, Some(&sku_codes))?;
    let context = crate::reporting::pricing_context(site_id, channel, at);
    let facts = merchandise(connection, Some(&sku_codes))?;
    let products: Vec<CartLine> = sku_codes
        .iter()
        .map(|code| line_for(code, 1, &facts))
        .collect();
    let priced: std::collections::BTreeMap<String, CatalogEntry> =
        price_catalog(&snapshot, &context, &products)
            .into_iter()
            .map(|entry| (entry.sku_code.clone(), entry))
            .collect();
    let items = scanned
        .into_iter()
        .filter_map(|(sku_code, name, uom, barcode)| {
            let entry = priced.get(&sku_code)?;
            Some(CatalogRow {
                sku_code,
                name,
                uom,
                barcode,
                unit_price_minor: entry.unit_price.minor,
                base_unit_price_minor: entry.base_unit_price.minor,
                currency: entry.currency.0.clone(),
                tax_category: entry.tax_category.clone(),
                price_source: entry.source.as_str().to_string(),
                publication_version: entry.publication_version,
            })
        })
        .collect();
    Ok(CatalogPage {
        items,
        next_cursor,
        limit,
    })
}

/// What one unit costs at the counter, and on what authority.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct QuotedLine {
    pub sku_code: String,
    /// What the price list said, before any markdown.
    pub base_unit_price_minor: i64,
    /// What one costs after markdown, before any promotion.
    pub unit_price_minor: i64,
    /// What this line actually comes to. Promotions act on the line, not the
    /// unit, so a discounted line is not always a whole number of unit prices.
    pub line_total_minor: i64,
    pub price_source: String,
    pub publication_version: i64,
}

/// An item the shopper is given, granted by a promotion.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct GrantedLine {
    pub sku_code: String,
    pub quantity: i64,
    pub unit_price_minor: i64,
    pub granted_by_rule_id: String,
    pub value_minor: i64,
}

/// A promotion that applied, or did not, and why.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PromotionOutcome {
    pub rule_id: String,
    /// The campaign it belongs to, when it belongs to one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub campaign_id: Option<String>,
    /// The code that unlocked it. Set only when the promotion actually
    /// applied — a code typed and refused has not been redeemed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coupon_code: Option<String>,
    pub name: String,
    pub applied: bool,
    /// What it took off. Zero when it did not apply.
    pub benefit_minor: i64,
    /// Absent when it applied; otherwise the reason, in a cashier's words.
    pub reason: Option<String>,
}

/// Everything the counter needs to ring up a basket.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Quote {
    /// The fingerprint of this decision. The same basket priced against the
    /// same book at the same instant gives the same string on any machine, so
    /// a sale rung up offline can be reproduced by the centre afterwards.
    pub trace_id: String,
    pub lines: Vec<QuotedLine>,
    pub granted_lines: Vec<GrantedLine>,
    pub promotions: Vec<PromotionOutcome>,
    pub discount_total_minor: i64,
    pub total_minor: i64,
    pub points_earned: i64,
}

/// Price a basket for a shop.
///
/// `Ok(None)` means this shop holds no price book at all — no publication has
/// ever reached it. That is a real state for a shop opened before the centre
/// published anything, and the caller decides what to do about it. It is
/// deliberately distinct from "the price book is here and does not list this
/// item", which is an error: a product missing from a live price book is a
/// mistake someone must fix, not a licence to invent a number.
///
/// A promotion that cannot apply is never an error. It comes back in
/// `promotions` with a reason, and the sale goes through — a cashier's screen
/// is the wrong place to discover that head office authored two contradictory
/// offers.
pub fn quote(
    connection: &Connection,
    site_id: &str,
    channel: &str,
    at: DateTime<Utc>,
    sku_codes: &[String],
    coupon_codes: &[String],
    customer_id: Option<&str>,
) -> Result<Option<Quote>, EdgeError> {
    let snapshot = load_snapshot_for(connection, site_id, channel, Some(sku_codes))?;
    if snapshot.entries.is_empty() {
        // Narrowed to this basket, an empty result means either no price book
        // at all or no price for these products. The two need different
        // answers, so the cheap whole-book existence check settles it — and it
        // only runs on the path that is already about to fail.
        let holds_any: i64 = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM commercial_price_rule
                                WHERE sku_code IS NOT NULL AND channel = ?1
                                  AND (site_id IS NULL OR site_id = ?2))",
                params![channel, site_id],
                |row| row.get(0),
            )
            .map_err(db)?;
        if holds_any == 0 {
            return Ok(None);
        }
    }
    let mut context = crate::reporting::pricing_context(site_id, channel, at);
    context.coupon_codes = coupon_codes.to_vec();
    context.customer_id = customer_id.map(str::to_string);
    // Only the products in the basket. The same narrowing the snapshot already
    // does: pricing five items has no business reading forty thousand rows.
    let facts = merchandise(connection, Some(sku_codes))?;
    let cart: Vec<CartLine> = sku_codes
        .iter()
        .map(|sku_code| line_for(sku_code, 1, &facts))
        .collect();
    let result = price_cart(&snapshot, &context, &cart).map_err(translate)?;

    let mut promotions: Vec<PromotionOutcome> = result
        .applied_rules
        .iter()
        .map(|applied| PromotionOutcome {
            rule_id: applied.rule_id.clone(),
            campaign_id: applied.campaign_id.clone(),
            coupon_code: applied.coupon_code.clone(),
            name: applied.name.clone(),
            applied: true,
            benefit_minor: applied.benefit.minor,
            reason: None,
        })
        .collect();
    promotions.extend(
        result
            .rejected_rules
            .iter()
            .map(|rejected| PromotionOutcome {
                rule_id: rejected.rule_id.clone(),
                // A promotion that did not apply redeemed nothing, so neither
                // its campaign nor its code is named here.
                campaign_id: None,
                coupon_code: None,
                name: rejected.name.clone(),
                applied: false,
                benefit_minor: 0,
                reason: Some(rejected.explanation.clone()),
            }),
    );

    Ok(Some(Quote {
        trace_id: result.trace_id.clone(),
        lines: result
            .lines
            .iter()
            .map(|line| QuotedLine {
                sku_code: line.sku_code.clone(),
                base_unit_price_minor: line.base_unit_price.minor,
                unit_price_minor: line.unit_price.minor,
                line_total_minor: line.line_total.minor,
                price_source: line.source.as_str().to_string(),
                publication_version: line.publication_version,
            })
            .collect(),
        granted_lines: result
            .free_lines
            .iter()
            .map(|free| GrantedLine {
                sku_code: free.sku_code.clone(),
                quantity: free.quantity,
                unit_price_minor: free.unit_price.minor,
                granted_by_rule_id: free.granted_by_rule_id.clone(),
                value_minor: free.value.minor,
            })
            .collect(),
        promotions,
        discount_total_minor: result.discount_total.minor,
        total_minor: result.total.minor,
        points_earned: result.points_earned,
    }))
}

/// Turn a pricing refusal into the shape the API already speaks.
///
/// A missing or withdrawn price is a conflict, not a bad request: the till
/// asked a well-formed question and the price book is not in a state to answer
/// it. That distinction is what tells a cashier "this is not your fault" and
/// puts the fix at the centre, where it belongs.
fn translate(error: PricingError) -> EdgeError {
    match error {
        PricingError::NoPrice { .. } | PricingError::NotSellable { .. } => {
            EdgeError::Conflict(error.to_string())
        }
        PricingError::MixedCurrency { .. }
        | PricingError::NonPositiveQuantity { .. }
        | PricingError::AmountOverflow => EdgeError::Validation(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edge::{EdgeRole, NodeContext, SiteId, SqliteEdge};
    use chrono::TimeZone;

    fn at(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, day, 12, 0, 0)
            .single()
            .unwrap_or_else(|| panic!("bad fixture date"))
    }

    /// Just enough of the edge schema to exercise the read path.
    /// A real shop database, opened in memory.
    ///
    /// Every migration runs, which is the point. This fixture used to restate
    /// the schema by hand and drifted from it twice — each time the failure
    /// read as "no such column" in a test about pricing, which says nothing
    /// about the behaviour under test and costs a bisect to understand.
    fn shop() -> SqliteEdge {
        let site = match SiteId::new("store-01") {
            Ok(site) => site,
            Err(error) => panic!("fixture site: {error}"),
        };
        let node = match NodeContext::new("store-01", EdgeRole::Store, site) {
            Ok(node) => node,
            Err(error) => panic!("fixture node: {error}"),
        };
        match SqliteEdge::open_in_memory(node) {
            Ok(edge) => edge,
            Err(error) => panic!("fixture edge: {error}"),
        }
    }

    /// Run a body against the shop's connection.
    ///
    /// The adapter hands out a shared, locked connection; this keeps the guard
    /// alive for exactly as long as the test needs it and no longer.
    fn with_shop<T>(edge: &SqliteEdge, body: impl FnOnce(&Connection) -> T) -> T {
        let connection = edge.connection();
        let guard = match connection.lock() {
            Ok(guard) => guard,
            Err(error) => panic!("fixture lock: {error}"),
        };
        body(&guard)
    }

    fn publish(connection: &Connection, version: i64, from: DateTime<Utc>) -> String {
        let id = format!("pub-{version}");
        if let Err(error) = connection.execute(
            "INSERT INTO commercial_publication
                 (id, version, name, effective_from, effective_to, activated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?4)",
            params![id, version, format!("v{version}"), from.to_rfc3339()],
        ) {
            panic!("fixture publication: {error}");
        }
        id
    }

    fn price(
        connection: &Connection,
        publication_id: &str,
        sku_code: Option<&str>,
        site_id: Option<&str>,
        minor: i64,
    ) {
        if let Err(error) = connection.execute(
            "INSERT INTO commercial_price_rule
                 (publication_id, sku_id, sku_code, site_id, channel, sellable,
                  currency, unit_price_minor, tax_category)
             VALUES (?1, ?5, ?2, ?3, 'STORE',
                     1, 'IDR', ?4, 'STANDARD')",
            params![
                publication_id,
                sku_code,
                site_id,
                minor,
                format!("fixture-{sku_code:?}")
            ],
        ) {
            panic!("fixture price: {error}");
        }
    }

    fn stock(connection: &Connection, sku_code: &str, name: &str) {
        if let Err(error) = connection.execute(
            "INSERT INTO catalog_item
                 (sku_code, name, uom, barcode, tax_category, active, generation, updated_at)
             VALUES (?1, ?2, 'PCS', NULL, 'STANDARD', 1, 1, '2026-09-01T00:00:00Z')",
            params![sku_code, name],
        ) {
            panic!("fixture catalogue: {error}");
        }
    }

    #[test]
    fn the_shelf_shows_what_the_till_will_charge() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            price(connection, &publication, Some("SKU1"), None, 100_000);
            price(
                connection,
                &publication,
                Some("SKU1"),
                Some("store-01"),
                90_000,
            );
            stock(connection, "SKU1", "Kemeja Putih");

            let rows = match store_catalog(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(rows) => rows,
                Err(error) => panic!("{error}"),
            };
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].unit_price_minor, 90_000);
            assert_eq!(rows[0].price_source, "SITE_PRICE");

            let quoted = match quote(
                connection,
                "store-01",
                STORE_CHANNEL,
                at(5),
                &["SKU1".to_string()],
                &[],
                None,
            ) {
                Ok(Some(quoted)) => quoted,
                other => panic!("expected a quote, got {other:?}"),
            };
            assert_eq!(
                quoted.lines[0].unit_price_minor, rows[0].unit_price_minor,
                "the shelf and the counter must agree"
            );
        });
    }

    #[test]
    fn catalogue_pages_are_stable_and_search_before_pricing() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            for (code, name) in [("SKU1", "Kemeja"), ("SKU2", "Celana"), ("SKU3", "Jaket")] {
                price(connection, &publication, Some(code), None, 100_000);
                stock(connection, code, name);
            }
            let first = store_catalog_page(
                connection,
                "store-01",
                STORE_CHANNEL,
                at(5),
                CatalogQuery {
                    limit: Some(1),
                    ..CatalogQuery::default()
                },
            )
            .unwrap_or_else(|error| panic!("first page: {error}"));
            assert_eq!(first.items.len(), 1);
            assert_eq!(first.items[0].sku_code, "SKU1");
            let second = store_catalog_page(
                connection,
                "store-01",
                STORE_CHANNEL,
                at(5),
                CatalogQuery {
                    cursor: first.next_cursor,
                    limit: Some(1),
                    ..CatalogQuery::default()
                },
            )
            .unwrap_or_else(|error| panic!("second page: {error}"));
            assert_eq!(second.items[0].sku_code, "SKU2");
            let search = store_catalog_page(
                connection,
                "store-01",
                STORE_CHANNEL,
                at(5),
                CatalogQuery {
                    q: Some("Jaket".into()),
                    ..CatalogQuery::default()
                },
            )
            .unwrap_or_else(|error| panic!("search: {error}"));
            assert_eq!(search.items.len(), 1);
            assert_eq!(search.items[0].sku_code, "SKU3");
        });
    }

    #[test]
    fn another_branchs_price_never_reaches_this_shop() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            price(connection, &publication, Some("SKU1"), None, 100_000);
            price(
                connection,
                &publication,
                Some("SKU1"),
                Some("store-99"),
                10_000,
            );
            stock(connection, "SKU1", "Kemeja Putih");

            let rows = match store_catalog(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(rows) => rows,
                Err(error) => panic!("{error}"),
            };
            assert_eq!(rows[0].unit_price_minor, 100_000);
            assert_eq!(rows[0].price_source, "COMPANY_PRICE");
        });
    }

    #[test]
    fn a_price_with_no_sku_code_is_not_used() {
        // Rules that predate migration 0015 carry only the centre's UUID.
        // Nothing here can match one to a product, so it must not price.
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            price(connection, &publication, None, None, 100_000);
            stock(connection, "SKU1", "Kemeja Putih");

            let rows = match store_catalog(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(rows) => rows,
                Err(error) => panic!("{error}"),
            };
            assert!(
                rows.is_empty(),
                "an unmatched price must leave the product unlisted, not priced by guess"
            );
        });
    }

    #[test]
    fn a_shop_with_no_price_book_is_told_so_rather_than_refused() {
        let edge = shop();
        with_shop(&edge, |connection| {
            stock(connection, "SKU1", "Kemeja Putih");
            match quote(
                connection,
                "store-01",
                STORE_CHANNEL,
                at(5),
                &["SKU1".to_string()],
                &[],
                None,
            ) {
                Ok(None) => {}
                other => panic!("expected the no-price-book signal, got {other:?}"),
            }
        });
    }

    #[test]
    fn a_live_price_book_missing_an_item_is_an_error_not_a_guess() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            price(connection, &publication, Some("SKU1"), None, 100_000);
            stock(connection, "SKU1", "Kemeja Putih");

            match quote(
                connection,
                "store-01",
                STORE_CHANNEL,
                at(5),
                &["SKU2".to_string()],
                &[],
                None,
            ) {
                Err(EdgeError::Conflict(_)) => {}
                other => panic!("expected a conflict, got {other:?}"),
            }
        });
    }

    #[test]
    fn products_the_catalogue_lists_but_nothing_prices_are_not_offered() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            price(connection, &publication, Some("SKU1"), None, 100_000);
            stock(connection, "SKU1", "Kemeja Putih");
            stock(connection, "SKU2", "Celana Chino");

            let rows = match store_catalog(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(rows) => rows,
                Err(error) => panic!("{error}"),
            };
            let listed: Vec<&str> = rows.iter().map(|row| row.sku_code.as_str()).collect();
            assert_eq!(
                listed,
                vec!["SKU1"],
                "a product the counter would refuse must not appear on the shelf"
            );
        });
    }

    #[test]
    fn a_newer_price_book_replaces_the_one_before_it() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let first = publish(connection, 1, at(1));
            price(connection, &first, Some("SKU1"), Some("store-01"), 90_000);
            let second = publish(connection, 2, at(2));
            price(connection, &second, Some("SKU1"), None, 120_000);
            stock(connection, "SKU1", "Kemeja Putih");

            let rows = match store_catalog(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(rows) => rows,
                Err(error) => panic!("{error}"),
            };
            assert_eq!(
                rows[0].unit_price_minor, 120_000,
                "the newer price book governs, branch price included"
            );
        });
    }
}
