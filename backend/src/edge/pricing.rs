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
    price_cart, price_catalog, Applicability, Campaign, CampaignStatus, Caps, CartLine,
    CatalogEntry, Coupon, Currency, CustomerScope, Effect, Markdown, Money, PriceEntry, PriceLevel,
    PricingError, PricingSnapshot, RejectionReason, Rule, TimeWindow,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::cloud::domain::FrozenEligibility;
use crate::edge::EdgeError;
use std::collections::BTreeMap;

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
                r.unit_price_minor, r.tax_category, r.site_ids_json
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
        ) = row.map_err(db)?;
        publication_version = publication_version.max(version);
        entries.push(PriceEntry {
            sku_code,
            applies_to: read_level(rule_site, site_ids_json.as_deref())?,
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
    // A `tier` column with something in it is a row from before tiers were
    // removed. It reads as a company price rather than being skipped: the
    // alternative is a product that silently has no price at all, and a shop
    // that cannot sell a shirt is worse than one that sells it at the
    // company's number.
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
            // Not `spent_minor` or `used`: what a campaign has given away is
            // counted in `commercial_usage` and overlaid below. Reading the
            // publication's frozen copy as a fallback gave the same number two
            // sources, and the two agreed only because authoring always writes
            // nought.
            "SELECT campaign_id, name, status, valid_from, valid_to,
                    budget_minor, max_uses
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
                row.get::<_, Option<i64>>(6)?,
            ))
        })
        .map_err(db)?;

    let mut campaigns = Vec::new();
    for row in rows {
        let (campaign_id, name, status, valid_from, valid_to, budget, max_uses) =
            row.map_err(db)?;
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
                    // Nought until the count says otherwise. No row in
                    // `commercial_usage` means nothing has been spent against
                    // this campaign, which is the answer rather than the
                    // absence of one.
                    spent: Money::ZERO,
                    max_uses,
                    used: 0,
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
                m.site_ids_json, COALESCE(p.version, 0), m.campaign_id,
                m.iso_weekdays_json, m.from_minute, m.to_minute
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
                row.get::<_, i64>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<u32>>(12)?,
                row.get::<_, Option<u32>>(13)?,
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
            publication_version,
            campaign_id,
            iso_weekdays_json,
            from_minute,
            to_minute,
        ) = row.map_err(db)?;
        markdowns.push(Markdown {
            markdown_id,
            sku_code,
            article_code,
            applies_to: read_level(row_site, site_ids_json.as_deref())?,
            replacement_unit_price: Money::new(replacement),
            priority,
            publication_version,
            campaign_id,
            // A schedule this build cannot read costs the schedule and nothing
            // else, the same way a malformed tag list costs the tags: a
            // clearance that ran all day instead of noon to two is a
            // merchandising fault, and refusing to price the shop over it would
            // be a shop that cannot sell.
            days: pricing_engine::DaySet {
                iso_weekdays: iso_weekdays_json
                    .as_deref()
                    .and_then(|raw| serde_json::from_str(raw).ok())
                    .unwrap_or_default(),
            },
            time_window: from_minute
                .zip(to_minute)
                .map(|(from, to)| pricing_engine::TimeWindow {
                    from_minute: from,
                    to_minute: to,
                }),
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
/// What each started promotion covers, as the centre resolved it.
///
/// Read as a map so `load_rules` can amend a rule without a query per rule. A
/// rule with a row and no SKUs is a rule that matched nothing when it started,
/// and it must stay in the map: dropping it would let its selector be read
/// again, which is the whole failure this table exists to end.
fn load_frozen_eligibility(
    connection: &Connection,
) -> Result<BTreeMap<String, FrozenEligibility>, EdgeError> {
    let mut frozen: BTreeMap<String, FrozenEligibility> = BTreeMap::new();
    let mut heads = connection
        .prepare("SELECT rule_id FROM commercial_rule_eligibility")
        .map_err(db)?;
    for row in heads
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(db)?
    {
        frozen.insert(row.map_err(db)?, FrozenEligibility::default());
    }

    let mut statement = connection
        .prepare("SELECT rule_id, sku_code, role FROM commercial_rule_eligibility_sku")
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(db)?;
    for row in rows {
        let (rule_id, sku_code, role) = row.map_err(db)?;
        let entry = frozen.entry(rule_id).or_default();
        if role == "EFFECT_ON" {
            entry
                .effect_on
                .get_or_insert_with(Default::default)
                .insert(sku_code);
        } else {
            entry.applies_to.insert(sku_code);
        }
    }
    Ok(frozen)
}

fn load_rules(connection: &Connection, usage: &UsageCounts) -> Result<Vec<Rule>, EdgeError> {
    // What the centre resolved each started promotion to. Applied below in
    // place of the selector, so a promotion that has begun covers the products
    // it covered then rather than the ones this shop's catalogue would match
    // this morning. A rule absent from here has not started; its selector is
    // still read, which is what makes a scheduled promotion behave.
    let frozen = load_frozen_eligibility(connection)?;
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
                if let Some(eligibility) = frozen.get(&rule.rule_id) {
                    crate::cloud::domain::narrow_to_frozen(&mut rule, eligibility);
                }
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
            "SELECT code, rule_id, active, customer_id, valid_from, valid_to, max_uses
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
            ))
        })
        .map_err(db)?;

    let mut coupons = Vec::new();
    for row in rows {
        let (code, rule_id, active, customer_id, valid_from, valid_to, max_uses) =
            row.map_err(db)?;
        // A coupon's own limit is a use count, not a budget, so only the first
        // half of the pair means anything here.
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
        let redeemed = usage
            .get(&("COUPON".to_string(), code.clone()))
            .map_or(0, |(uses, _)| *uses);
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
    /// The style this colourway belongs to.
    pub article_code: Option<String>,
    /// Which part of the range it is filed under.
    pub division_code: Option<String>,
    /// What the centre tagged it with.
    pub tags: Vec<String>,
    /// Whether this node holds a photograph for it, servable from
    /// `/api/v1/catalog/image?sku=`.
    ///
    /// A flag and not the URL. The URL points at the centre, and a shop's whole
    /// reason for holding a resident catalogue is that the line to the centre
    /// may be down — a grid of `<img>` tags aimed there would draw a page of
    /// broken glyphs on exactly the day the catalogue matters most. The node
    /// proxies the picture and caches it per URL for the life of the process,
    /// so one colourway costs one fetch for the whole shop floor. Saying
    /// *whether* there is one is what stops the browser asking for the ones
    /// there are not, each of which is a 404 the till would have to render as
    /// something.
    ///
    /// These four are the difference between a price list and a catalogue. The
    /// screen that browses this is a grid of photographs with the range down
    /// one side, and none of it can be drawn from a code, a name and a number.
    pub has_image: bool,
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
            "SELECT sku_code, name, uom, barcode, image_url IS NOT NULL
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
                row.get::<_, bool>(4)?,
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
    for (sku_code, name, uom, barcode, has_image) in items {
        let Some(entry) = priced.peek() else { break };
        if entry.sku_code != sku_code {
            continue;
        }
        let Some(entry) = priced.next() else { break };
        // The same facts the engine was handed, said out loud on the row. They
        // are already in hand — reading them a second time for the screen is
        // how a catalogue comes to be filed under one division and priced
        // against another.
        let (article_code, division_code, tags) = facts.get(&sku_code).cloned().unwrap_or_default();
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
            article_code,
            division_code,
            tags,
            has_image,
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
            "SELECT sku_code, name, uom, barcode, image_url IS NOT NULL
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
                    row.get::<_, bool>(4)?,
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
        .filter_map(|(sku_code, name, uom, barcode, has_image)| {
            let entry = priced.get(&sku_code)?;
            let (article_code, division_code, tags) =
                facts.get(&sku_code).cloned().unwrap_or_default();
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
                article_code,
                division_code,
                tags,
                has_image,
            })
        })
        .collect();
    Ok(CatalogPage {
        items,
        next_cursor,
        limit,
    })
}

/// One offer, as a shop floor needs to read it.
///
/// Not the engine's `Rule`. A rule is a document written for an evaluator —
/// scopes, stacking, exclusions, compounding — and handing that to a screen
/// would make every till reimplement "is this on?" in TypeScript. This is the
/// answer instead: whether it runs, when it starts, when it stops, and what it
/// takes off.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreOffer {
    pub rule_id: String,
    pub name: String,
    /// `RUNNING` or `UPCOMING`. Decided by the engine's own gate, not by the
    /// rule's `status` column — a rule can be `ACTIVE` and still be dead.
    pub state: String,
    /// The promotion this is part of, when the business runs it as one thing.
    pub campaign_id: Option<String>,
    pub campaign_name: Option<String>,
    /// The banner and the small print of the campaign this belongs to, so
    /// a promotion and the price drops beside it wear one face, not two.
    pub campaign_has_image: bool,
    pub campaign_terms: Option<String>,
    /// When it starts, and when it stops. The later of the rule's own window
    /// and its campaign's, and the earlier of the two ends: both bind, so the
    /// window a shop actually gets is the intersection. `None` at either end
    /// means open-ended there.
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    /// What it does. The engine's own effect, so a screen can say "20%" or
    /// "buy 2 get 1" without a second vocabulary drifting from this one.
    pub effect: Effect,
    /// What it lands on. `None` is the whole cart.
    pub applies_to: Option<Applicability>,
    /// The code that unlocks it. Present means a cashier has to type something.
    pub coupon_code: Option<String>,
    /// Only for an identified member.
    pub members_only: bool,
    /// ISO weekdays it runs on — Monday is 1. Empty is every day.
    pub weekdays: Vec<u32>,
    /// The hours it runs between, when it does not run all day.
    pub time_window: Option<TimeWindow>,
    /// Whether it is live *this minute*.
    ///
    /// A `RUNNING` offer that only runs on Saturdays is running this week and
    /// not running this instant, and those are different sentences at a
    /// counter. Splitting them into two states would put "Promo Sabtu" under
    /// "upcoming" every Tuesday and file it as a thing that has not started —
    /// which is not what a shop means by it.
    pub live_now: bool,
    /// What is left of the budget it may give away, when it has one. Only as
    /// fresh as the last sync — a brake, not a gate; see `Caps`.
    pub budget_remaining_minor: Option<i64>,
    /// How many more carts it may apply to, when it is counted.
    pub uses_remaining: Option<i64>,
}

/// A run of price drops the shop is in, or is about to enter.
///
/// A markdown is a price, not a discount, so each one is already showing in the
/// catalogue — this is the other half a shop floor needs: **when it stops**,
/// how much of the range is in it, and what the business calls it.
///
/// Grouped rather than listed per product, because a clearance is one event to
/// a shop and two thousand rows to the database. **What it groups by is the
/// point.** A drop that names a campaign is grouped with the others in that
/// campaign and wears its name, its banner and its window, so it is one thing
/// a cashier can be asked about. A drop that names none is
/// grouped with whatever else shares its dates, which is the most a shop can
/// honestly say about a set of unrelated clearances that happen to end
/// together.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PriceDropWindow {
    pub state: String,
    /// The campaign these belong to, when they belong to one.
    pub campaign_id: Option<String>,
    /// What the poster says, then what the campaign is called, then nothing.
    /// A group with no campaign has no name and is not given an invented one.
    pub name: Option<String>,
    /// The banner, servable from `/api/v1/catalog/campaign-image?campaign=`.
    pub has_image: bool,
    /// The small print, as the centre wrote it.
    pub terms: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    /// The days and hours it runs on, when every drop in the run agrees.
    ///
    /// A run whose members are scheduled differently reports nothing here
    /// rather than one of them: "12:00–14:00" against a group where half the
    /// products run all day is a sentence a cashier would act on and be wrong
    /// about. Empty and `None` mean all day, every day.
    pub weekdays: Vec<u32>,
    pub time_window: Option<TimeWindow>,
    /// Markdowns naming one product each.
    pub product_count: i64,
    /// Markdowns naming a whole style — every colour and size of it.
    pub range_count: i64,
}

/// Everything this shop is offering, as of now.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct StoreOffers {
    pub site_id: String,
    pub channel: String,
    pub as_of: DateTime<Utc>,
    /// The price book these came in on, so a shop can tell "no promotions" from
    /// "no price book".
    pub publication_version: Option<i64>,
    /// Running now, soonest to end first — the one a cashier is asked about is
    /// the one about to stop.
    pub running: Vec<StoreOffer>,
    /// Not started, soonest first. This is what a countdown counts down to.
    pub upcoming: Vec<StoreOffer>,
    pub price_drops: Vec<PriceDropWindow>,
}

/// The half of a campaign a shopper reads: the poster, not the budget.
///
/// Loaded separately from `load_campaigns` on purpose. That one builds the
/// engine's `Campaign`, and the engine has no business holding a photograph —
/// it decides money. These three are for a screen, so they stay out of the
/// snapshot and are joined on only where a screen asks.
struct CampaignFace {
    headline: Option<String>,
    name: String,
    has_image: bool,
    terms: Option<String>,
}

fn load_campaign_faces(
    connection: &Connection,
) -> Result<std::collections::BTreeMap<String, CampaignFace>, EdgeError> {
    let mut statement = connection
        .prepare(
            "SELECT campaign_id, name, headline, image_url IS NOT NULL, terms
               FROM commercial_campaign",
        )
        .map_err(db)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                CampaignFace {
                    name: row.get::<_, String>(1)?,
                    headline: row.get::<_, Option<String>>(2)?,
                    has_image: row.get::<_, bool>(3)?,
                    terms: row.get::<_, Option<String>>(4)?,
                },
            ))
        })
        .map_err(db)?;
    let mut faces = std::collections::BTreeMap::new();
    for row in rows {
        let (id, face) = row.map_err(db)?;
        faces.insert(id, face);
    }
    Ok(faces)
}

/// What this shop is running, and what it is about to run.
///
/// Answered out of the resident snapshot, like everything else here, so a
/// promotions board keeps working with the line to the centre down. It has to:
/// the shopper asking "is the Lebaran promo still on" is standing in the shop.
pub fn store_offers(
    connection: &Connection,
    site_id: &str,
    channel: &str,
    at: DateTime<Utc>,
) -> Result<StoreOffers, EdgeError> {
    // Prices and markdowns are deliberately left out of this snapshot. The gate
    // reads the rule, its campaign and its coupon and nothing else, and loading
    // forty thousand price rows to answer "what promotions are on" is the cost
    // this screen would otherwise pay every time somebody opened it.
    let usage = load_usage(connection)?;
    let campaigns = load_campaigns(connection, &usage)?;
    let snapshot = PricingSnapshot {
        publication_version: 0,
        entries: Vec::new(),
        markdowns: Vec::new(),
        rules: load_rules(connection, &usage)?,
        coupons: load_coupons(connection, &usage)?,
        campaigns,
    };
    let context = crate::reporting::pricing_context(site_id, channel, at);
    let faces = load_campaign_faces(connection)?;

    let mut running = Vec::new();
    let mut upcoming = Vec::new();
    for rule in &snapshot.rules {
        let campaign = rule.campaign_id.as_ref().and_then(|id| {
            snapshot
                .campaigns
                .iter()
                .find(|campaign| campaign.campaign_id == *id)
        });
        // Both windows bind, so the one the shop gets is the intersection.
        let starts_at = later(
            rule.conditions.effective_from,
            campaign.and_then(|c| c.valid_from),
        );
        let ends_at = earlier(
            rule.conditions.effective_to,
            campaign.and_then(|c| c.valid_to),
        );

        let standing = pricing_engine::rule_standing(rule, &snapshot, &context);
        let state = match standing {
            Ok(()) => "RUNNING",
            // A coupon promotion and a members-only one are both things the
            // shop IS running; they simply need something the counter does not
            // have yet — a code typed in, a shopper identified. Hiding them
            // would leave the poster in the window with nothing on the till
            // agreeing with it, and "sign up and get 15% off shoes" is a
            // sentence a cashier can only say if the screen tells them.
            Err(RejectionReason::NoCoupon) | Err(RejectionReason::NotThisCustomer) => "RUNNING",
            // Inside its dates, outside today's day or hour. Still this week's
            // promotion — `live_now` below is what says it is not this minute.
            Err(RejectionReason::DayNotAllowed) | Err(RejectionReason::TimeNotAllowed) => "RUNNING",
            Err(RejectionReason::NotStarted) => "UPCOMING",
            // Expired, paused, spent, wrong shop, wrong channel, campaign this
            // node never received. None of those are things to advertise.
            Err(_) => continue,
        };
        // On this minute, for whoever it is for. The two gates above are about
        // the basket, not about the clock — unlike a day or an hour window,
        // which genuinely means "not now".
        let live_now = matches!(
            standing,
            Ok(()) | Err(RejectionReason::NoCoupon) | Err(RejectionReason::NotThisCustomer)
        );

        let offer = StoreOffer {
            rule_id: rule.rule_id.clone(),
            name: rule.name.clone(),
            state: state.to_string(),
            campaign_id: rule.campaign_id.clone(),
            // The poster's words when there are any, the campaign's filing name
            // otherwise. "CMP-LEB-26" is what a merchandiser searches for and
            // not what a cashier should be reading out.
            campaign_name: campaign.map(|c| {
                faces
                    .get(&c.campaign_id)
                    .and_then(|face| face.headline.clone())
                    .unwrap_or_else(|| c.name.clone())
            }),
            campaign_has_image: campaign
                .and_then(|c| faces.get(&c.campaign_id))
                .is_some_and(|face| face.has_image),
            campaign_terms: campaign
                .and_then(|c| faces.get(&c.campaign_id))
                .and_then(|face| face.terms.clone()),
            starts_at,
            ends_at,
            effect: rule.effect.clone(),
            applies_to: rule.scope.applicability.clone(),
            coupon_code: rule.coupon_code.clone(),
            members_only: matches!(rule.scope.customers, CustomerScope::Members),
            weekdays: rule.conditions.days.iso_weekdays.iter().copied().collect(),
            time_window: rule.conditions.time_window,
            live_now,
            // The rule's own remainder, tightened by its campaign's — five
            // offers sharing one budget have as much left as the envelope does,
            // not as much as each of them thinks.
            budget_remaining_minor: least(
                rule.caps.remaining().map(|money| money.minor),
                campaign.and_then(|c| c.caps.remaining()).map(|m| m.minor),
            ),
            uses_remaining: least(
                rule.caps.max_uses.map(|max| (max - rule.caps.used).max(0)),
                campaign.and_then(|c| c.caps.max_uses.map(|max| (max - c.caps.used).max(0))),
            ),
        };
        if state == "RUNNING" {
            running.push(offer);
        } else {
            upcoming.push(offer);
        }
    }

    // Soonest to end first among the running: the offer a cashier is asked
    // about is the one about to stop. Soonest to start first among the
    // upcoming, which is the order a countdown reads in.
    running.sort_by_key(|offer| open_ended_last(offer.ends_at));
    upcoming.sort_by_key(|offer| open_ended_last(offer.starts_at));

    let publication_version: Option<i64> = connection
        .query_row(
            "SELECT MAX(version) FROM commercial_publication",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db)?
        .flatten();

    Ok(StoreOffers {
        site_id: site_id.to_string(),
        channel: channel.to_string(),
        as_of: at,
        publication_version,
        running,
        upcoming,
        price_drops: price_drop_windows(connection, site_id, at, &snapshot, &faces)?,
    })
}

/// Price drops grouped by the run they belong to.
///
/// The key is the campaign when there is one and the window when there is not,
/// which is exactly the difference between one event and a coincidence.
/// Counted as
/// products and whole styles, because "128 products and 4 whole styles" is a
/// sentence and "132 markdowns" is not.
type DropGroups = std::collections::BTreeMap<DropKey, DropGroup>;

/// What a run of price drops is filed under.
///
/// Ordered so campaigns sort together and ahead of the unnamed windows — the
/// named thing is the one somebody asks about.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum DropKey {
    Campaign(String),
    Window(DateTime<Utc>, Option<DateTime<Utc>>),
}

struct DropGroup {
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
    product_count: i64,
    range_count: i64,
    /// Every distinct schedule seen in this run. One means the run has a
    /// schedule worth printing; more than one means it has none to print.
    schedules: std::collections::BTreeSet<(Vec<u32>, Option<(u32, u32)>)>,
}

/// The clearance runs this shop is in, and the ones it is about to enter.
fn price_drop_windows(
    connection: &Connection,
    site_id: &str,
    at: DateTime<Utc>,
    snapshot: &PricingSnapshot,
    faces: &std::collections::BTreeMap<String, CampaignFace>,
) -> Result<Vec<PriceDropWindow>, EdgeError> {
    let mut groups = DropGroups::new();

    for markdown in load_markdowns(connection, site_id, None)? {
        // SQL narrowed this to rows naming this shop or no shop at all; a group
        // row naming a set of shops still has to be read to know whether ours
        // is in it. The engine does the same check before it prices anything,
        // and a screen that skipped it would count another region's clearance.
        let ours = match &markdown.applies_to {
            PriceLevel::Company => true,
            PriceLevel::Site { site_id: named } => named == site_id,
            PriceLevel::SiteGroup { site_ids } => site_ids.contains(site_id),
        };
        if !ours {
            continue;
        }

        // The campaign this drop sits in, if the shop holds it. A drop naming a
        // campaign that never arrived is NOT filed under that name — the shop
        // cannot say what it does not hold — but it still counts, because the
        // engine is still charging the cleared price for it. Those two have to
        // agree or the board contradicts the till.
        let campaign = markdown.campaign_id.as_deref().and_then(|id| {
            snapshot
                .campaigns
                .iter()
                .find(|campaign| campaign.campaign_id == id)
        });
        if let Some(campaign) = campaign {
            // A paused or finished campaign is not showing on any shelf, because
            // the engine has already put those prices back up.
            if campaign.status != CampaignStatus::Active {
                continue;
            }
            if campaign.valid_to.is_some_and(|to| at >= to) {
                continue;
            }
        }

        // The window a shopper actually gets. Both bind, so it is the
        // intersection — a drop running to month end inside a campaign that ends
        // Sunday ends Sunday.
        let starts_at = later(
            Some(markdown.effective_from),
            campaign.and_then(|c| c.valid_from),
        )
        .unwrap_or(markdown.effective_from);
        let ends_at = earlier(markdown.effective_to, campaign.and_then(|c| c.valid_to));

        // Over is over. A run that closed last month is not news at a till.
        if ends_at.is_some_and(|to| at >= to) {
            continue;
        }

        let key = match campaign {
            Some(campaign) => DropKey::Campaign(campaign.campaign_id.clone()),
            None => DropKey::Window(starts_at, ends_at),
        };
        let group = groups.entry(key).or_insert(DropGroup {
            starts_at,
            ends_at,
            product_count: 0,
            range_count: 0,
            schedules: std::collections::BTreeSet::new(),
        });
        group.schedules.insert((
            markdown.days.iso_weekdays.iter().copied().collect(),
            markdown
                .time_window
                .map(|window| (window.from_minute, window.to_minute)),
        ));
        // Inside one campaign the rows may not share dates. The run starts when its
        // first drop does and ends when its last one does, which is what a
        // shopper experiences and what a countdown has to count to.
        group.starts_at = group.starts_at.min(starts_at);
        group.ends_at = later(group.ends_at, ends_at);
        if markdown.sku_code.is_some() {
            group.product_count += 1;
        } else {
            group.range_count += 1;
        }
    }

    Ok(groups
        .into_iter()
        .map(|(key, group)| {
            let face = match &key {
                DropKey::Campaign(id) => faces.get(id),
                DropKey::Window(..) => None,
            };
            // One schedule across the whole run, or none to report.
            let agreed = match group.schedules.len() {
                1 => group.schedules.iter().next(),
                _ => None,
            };
            PriceDropWindow {
                state: if at < group.starts_at {
                    "UPCOMING"
                } else {
                    "RUNNING"
                }
                .to_string(),
                campaign_id: match &key {
                    DropKey::Campaign(id) => Some(id.clone()),
                    DropKey::Window(..) => None,
                },
                name: face.map(|face| face.headline.clone().unwrap_or_else(|| face.name.clone())),
                has_image: face.is_some_and(|face| face.has_image),
                terms: face.and_then(|face| face.terms.clone()),
                starts_at: group.starts_at,
                ends_at: group.ends_at,
                weekdays: agreed.map(|(days, _)| days.clone()).unwrap_or_default(),
                time_window: agreed
                    .and_then(|(_, hours)| *hours)
                    .map(|(from, to)| TimeWindow {
                        from_minute: from,
                        to_minute: to,
                    }),
                product_count: group.product_count,
                range_count: group.range_count,
            }
        })
        .collect())
}

/// The later of two instants, where absent means "no bound at this end".
fn later(left: Option<DateTime<Utc>>, right: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    match (left, right) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (some, None) | (None, some) => some,
    }
}

fn earlier(left: Option<DateTime<Utc>>, right: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    match (left, right) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (some, None) | (None, some) => some,
    }
}

/// The tighter of two remainders. Absent is unlimited, so it never tightens.
fn least(left: Option<i64>, right: Option<i64>) -> Option<i64> {
    match (left, right) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (some, None) | (None, some) => some,
    }
}

/// Sort key that puts "no end date" after every date rather than before it.
fn open_ended_last(when: Option<DateTime<Utc>>) -> DateTime<Utc> {
    when.unwrap_or(DateTime::<Utc>::MAX_UTC)
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
    /// Which clearance set this price, when one did.
    ///
    /// `price_source` says a markdown won; this says WHICH. Without it, asking
    /// "what did the end-of-season sale do to this shirt" means joining a sold
    /// line back to the markdown table by sku, publication version and date and
    /// hoping exactly one candidate covered that instant — which is a
    /// reconstruction, and a reconstruction is not evidence.
    pub markdown_id: Option<String>,
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
    /// What it took off each line, by that line's position in the basket.
    ///
    /// The engine apportions a basket-wide discount before it can apply one, so
    /// this costs nothing to carry — it was being summed away. Keeping it is
    /// the difference between "this promotion appeared in a Rp 550,000 basket"
    /// and "this promotion cost Rp 50,000, of which Rp 20,000 came off the
    /// shirt". The first is influenced revenue and overstates by whatever the
    /// offer never touched.
    ///
    /// Empty for a rejected promotion, and for one that grants goods rather
    /// than cutting a price.
    #[serde(default)]
    pub line_benefits: Vec<LineBenefitOut>,
    /// Absent when it applied; otherwise the reason, in a cashier's words.
    pub reason: Option<String>,
}

/// What one promotion took off one line of a basket.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct LineBenefitOut {
    /// Position in the basket as it was scanned, which is also the position in
    /// `lines`. Position rather than sku code: a basket can hold the same
    /// product twice and a promotion may have matched only one of them.
    pub line: usize,
    pub benefit_minor: i64,
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
            line_benefits: applied
                .line_benefits
                .iter()
                .map(|line| LineBenefitOut {
                    line: line.line,
                    benefit_minor: line.benefit.minor,
                })
                .collect(),
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
                line_benefits: Vec::new(),
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
                markdown_id: line.markdown_id.clone(),
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

    fn campaign(
        connection: &Connection,
        publication_id: &str,
        campaign_id: &str,
        status: &str,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) {
        if let Err(error) = connection.execute(
            "INSERT INTO commercial_campaign
                 (campaign_id, publication_id, name, status, valid_from, valid_to,
                  budget_minor, max_uses)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL)",
            params![
                campaign_id,
                publication_id,
                format!("Kampanye {campaign_id}"),
                status,
                from.map(|when| when.to_rfc3339()),
                to.map(|when| when.to_rfc3339()),
            ],
        ) {
            panic!("fixture campaign: {error}");
        }
    }

    fn promotion(
        connection: &Connection,
        publication_id: &str,
        rule_id: &str,
        campaign_id: Option<&str>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) {
        let document = serde_json::json!({
            "rule_id": rule_id,
            "campaign_id": campaign_id,
            "name": format!("Promo {rule_id}"),
            "status": "ACTIVE",
            "scope": { "applicability": { "on": "DIVISION", "divisions": ["MENSWEAR"] } },
            "conditions": {
                "effective_from": from.map(|when| when.to_rfc3339()),
                "effective_to": to.map(|when| when.to_rfc3339()),
            },
            "effect": { "kind": "PERCENT", "bps": 2000 },
        });
        if let Err(error) = connection.execute(
            "INSERT INTO commercial_rule
                 (rule_id, publication_id, name, definition_json, status, priority)
             VALUES (?1, ?2, ?3, ?4, 'ACTIVE', 0)",
            params![
                rule_id,
                publication_id,
                format!("Promo {rule_id}"),
                document.to_string()
            ],
        ) {
            panic!("fixture promotion: {error}");
        }
    }

    /// The board a cashier reads is the gate the counter runs, not the `status`
    /// column. Four promotions, all `ACTIVE`, and only two of them are news.
    #[test]
    fn the_promotions_board_shows_what_the_counter_would_actually_allow() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            // On, and open-ended.
            promotion(connection, &publication, "NOW", None, Some(at(1)), None);
            // Not yet — this is the one a countdown counts down to.
            promotion(
                connection,
                &publication,
                "SOON",
                None,
                Some(at(20)),
                Some(at(30)),
            );
            // Over. A promotion that ended on Friday is not a thing to advertise
            // on Saturday.
            promotion(
                connection,
                &publication,
                "GONE",
                None,
                Some(at(1)),
                Some(at(3)),
            );
            // Live by its own dates, inside a campaign somebody paused. The
            // engine refuses it, so the board must not carry it — otherwise
            // "stop the Lebaran promo" stops the discount and leaves the poster.
            campaign(
                connection,
                &publication,
                "PAUSED-CAMPAIGN",
                "PAUSED",
                Some(at(1)),
                None,
            );
            promotion(
                connection,
                &publication,
                "UNDER-PAUSED",
                Some("PAUSED-CAMPAIGN"),
                Some(at(1)),
                None,
            );

            let offers = match store_offers(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(offers) => offers,
                Err(error) => panic!("{error}"),
            };

            let running: Vec<&str> = offers
                .running
                .iter()
                .map(|offer| offer.rule_id.as_str())
                .collect();
            let upcoming: Vec<&str> = offers
                .upcoming
                .iter()
                .map(|offer| offer.rule_id.as_str())
                .collect();
            assert_eq!(running, vec!["NOW"]);
            assert_eq!(upcoming, vec!["SOON"]);
            assert_eq!(offers.publication_version, Some(1));

            // The window a countdown reads from, and it is the rule's own here.
            let soon = &offers.upcoming[0];
            assert_eq!(soon.starts_at, Some(at(20)));
            assert_eq!(soon.ends_at, Some(at(30)));
            assert!(!soon.live_now);
        });
    }

    /// Both windows bind, so the one the shop gets is the intersection — not
    /// the rule's, and not the campaign's.
    #[test]
    fn a_campaign_can_only_shorten_the_promotion_inside_it() {
        let edge = shop();
        with_shop(&edge, |connection| {
            let publication = publish(connection, 1, at(1));
            campaign(
                connection,
                &publication,
                "LEBARAN",
                "ACTIVE",
                Some(at(3)),
                Some(at(8)),
            );
            promotion(
                connection,
                &publication,
                "TWENTY-OFF",
                Some("LEBARAN"),
                Some(at(1)),
                Some(at(20)),
            );

            let offers = match store_offers(connection, "store-01", STORE_CHANNEL, at(5)) {
                Ok(offers) => offers,
                Err(error) => panic!("{error}"),
            };
            assert_eq!(offers.running.len(), 1);
            let offer = &offers.running[0];
            assert_eq!(offer.campaign_name.as_deref(), Some("Kampanye LEBARAN"));
            // Starts when the campaign does, ends when the campaign does — the
            // rule's own 1st and 20th are both looser and both lose.
            assert_eq!(offer.starts_at, Some(at(3)));
            assert_eq!(offer.ends_at, Some(at(8)));
            assert!(offer.live_now);
        });
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
