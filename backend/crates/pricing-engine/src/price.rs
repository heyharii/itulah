//! What an item costs before anybody discounts it: the price list cascade, and
//! the markdowns that replace its answer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::money::{Currency, Money};
use crate::rule::{local, Campaign, CampaignStatus, DaySet, TimeWindow};
use crate::{CartLine, PricingContext};

/// Which shops and which shoppers a price applies to.
///
/// The variants are declared least specific first, and that order **is** the
/// precedence order: a price naming one shop beats one naming a group of shops,
/// which beats one naming a membership tier, which beats the company default.
/// Keeping the order in the declaration means it cannot drift away from a
/// comparison written somewhere else.
///
/// An enum rather than a scope tag beside a nullable site and a nullable tier.
/// The shape this was ported from carries `store_id`, `store_ids` and `tier`
/// side by side with a separate `level` field saying which of them to read —
/// so a row can claim to be a tier price while carrying a store id, and nothing
/// catches it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "level", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PriceLevel {
    /// Everywhere, unless something more specific says otherwise.
    Company,
    /// A named set of shops — a city, a format, a region.
    SiteGroup { site_ids: BTreeSet<String> },
    /// This one shop.
    Site { site_id: String },
}

impl PriceLevel {
    /// How specific this is. Higher wins.
    pub(crate) fn rank(&self) -> u8 {
        match self {
            Self::Company => 0,
            Self::SiteGroup { .. } => 1,
            Self::Site { .. } => 2,
        }
    }

    pub(crate) fn applies(&self, context: &PricingContext) -> bool {
        match self {
            Self::Company => true,
            Self::SiteGroup { site_ids } => site_ids.contains(&context.site_id),
            Self::Site { site_id } => *site_id == context.site_id,
        }
    }
}

/// One price, as authored.
///
/// Keyed by `sku_code` and not by any internal id: the shop floor speaks in SKU
/// codes — the catalogue is keyed by them, a scanned tag decodes to one, a sale
/// line records one — and a price that arrives wearing a different identifier
/// is a price nothing in the shop can match to a product.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PriceEntry {
    pub sku_code: String,
    #[serde(flatten)]
    pub applies_to: PriceLevel,
    pub channel: String,
    pub sellable: bool,
    pub currency: Currency,
    pub unit_price: Money,
    pub tax_category: String,
    /// Which publication this came from, so an answer can name its source.
    pub publication_version: i64,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
}

/// A temporary replacement for a base price — a sale price, not a discount.
///
/// The distinction is not pedantry. A markdown replaces what the item costs;
/// a discount reduces what is charged for it. Booked as a discount, a markdown
/// inflates both revenue and discount in every report that reads them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Markdown {
    pub markdown_id: String,
    /// The product marked down. `None` when this is an article-wide markdown.
    #[serde(default)]
    pub sku_code: Option<String>,
    /// Every variant of a style — all colours, all sizes. A markdown naming a
    /// SKU beats one naming its article, so a single colour can be cleared
    /// harder than the rest of the range.
    #[serde(default)]
    pub article_code: Option<String>,
    #[serde(flatten)]
    pub applies_to: PriceLevel,
    pub replacement_unit_price: Money,
    #[serde(default)]
    pub priority: i64,
    /// Which publication authored this, so an answer can name its source — the
    /// same reason [`PriceEntry`] carries it.
    ///
    /// `default` because it was added after markdowns were already travelling:
    /// a node sending an older document reports 0, which reads as "the book is
    /// not recorded" rather than failing to price. Zero is deliberately not a
    /// real version — publications start at 1.
    #[serde(default)]
    pub publication_version: i64,
    /// The campaign this price drop belongs to, if it belongs to one.
    ///
    /// A campaign is the envelope a set of offers shares — one window, one
    /// budget, one switch — and until now it enveloped only [`crate::Rule`]s.
    /// A "flash sale" is not a rule: it is a run of markdowns the business
    /// runs as one thing, and without this there was nowhere to say so, so a
    /// shop holding two thousand cleared SKUs could not be told that four
    /// hundred of them are one event with one clock.
    ///
    /// `default` because it arrived after markdowns were already travelling.
    /// `None` means the markdown stands on its own, which is every markdown
    /// written before this field existed — and standing on its own is the
    /// permissive case, deliberately. See `PriceIndex::campaign_allows`.
    #[serde(default)]
    pub campaign_id: Option<String>,
    /// The days it runs on, and the hours it runs between.
    ///
    /// The same two fields a rule's [`crate::Conditions`] carries, and read the
    /// same way — in the SHOP's local time, because "12 sampai 2" means noon
    /// where the shop is. Empty and `None` mean all day, every day, which is
    /// every markdown written before a price could be scheduled by the hour.
    ///
    /// This is what makes a flash sale expressible as a price rather than as
    /// one markdown row per slot. It also makes a price that changes at two in
    /// the afternoon, which is a real thing to be careful with in a shop where
    /// the ticket is printed on the garment — see the note on
    /// `PriceIndex::within_the_hours`.
    #[serde(default)]
    pub days: DaySet,
    #[serde(default)]
    pub time_window: Option<TimeWindow>,
    pub effective_from: DateTime<Utc>,
    #[serde(default)]
    pub effective_to: Option<DateTime<Utc>>,
}

pub(crate) fn covers(at: DateTime<Utc>, from: DateTime<Utc>, to: Option<DateTime<Utc>>) -> bool {
    at >= from && to.is_none_or(|end| at < end)
}

/// Which of two candidates wins, given both apply.
///
/// The newest publication first, and only then site-over-company.
///
/// The order matters and is easy to get backwards. A publication is a whole
/// price book, not a patch: when version 5 supersedes version 3, a shop-specific
/// price authored in 3 is superseded along with everything else in it. Ranking
/// scope first would keep that old shop price alive underneath the new book,
/// which is how a branch ends up quietly selling at last season's price.
///
/// This is also exactly the order the centre resolves in — it picks the
/// publication, then narrows within it. Two rankings would agree on every
/// ordinary day and part company on the day a shop price is overridden, which
/// is the day anyone would notice.
///
/// The start date breaks any remaining tie. Not because it means much, but
/// because it must be *stable*: two prices that tie have to resolve the same
/// way on every machine, or the centre and the till disagree over something
/// neither of them can show you.
fn better(left: &PriceEntry, right: &PriceEntry) -> bool {
    (
        left.publication_version,
        left.applies_to.rank(),
        left.effective_from,
    ) > (
        right.publication_version,
        right.applies_to.rank(),
        right.effective_from,
    )
}

/// Find the price for one SKU. `None` when nothing applies.
///
/// A single lookup, for callers who want one answer. Anything pricing more than
/// a handful of products should build a [`PriceIndex`] once instead — this
/// walks the whole price book on every call.
pub fn resolve_price<'a>(
    snapshot: &'a crate::PricingSnapshot,
    context: &PricingContext,
    sku_code: &str,
) -> Option<&'a PriceEntry> {
    let mut best: Option<&PriceEntry> = None;
    for entry in &snapshot.entries {
        if entry.sku_code != sku_code || entry.channel != context.channel {
            continue;
        }
        if !entry.applies_to.applies(context) {
            continue;
        }
        if !covers(context.at, entry.effective_from, entry.effective_to) {
            continue;
        }
        if best.is_none_or(|current| better(entry, current)) {
            best = Some(entry);
        }
    }
    best
}

// ---------------------------------------------------------------------------
// Looking prices up without walking the whole book
// ---------------------------------------------------------------------------

/// Prices and markdowns, grouped by the product they name.
///
/// Built once per evaluation. Without it every lookup walks every price in the
/// snapshot, which is invisible on a five-line basket and quadratic on a
/// catalogue: forty thousand products, each scanning forty thousand prices.
/// That is the difference between a screen that opens and a screen that hangs.
///
/// It borrows from the snapshot rather than copying it, so building one costs a
/// sort and no prices.
pub(crate) struct PriceIndex<'a> {
    by_sku: BTreeMap<&'a str, Vec<&'a PriceEntry>>,
    markdown_by_sku: BTreeMap<&'a str, Vec<&'a Markdown>>,
    markdown_by_article: BTreeMap<&'a str, Vec<&'a Markdown>>,
    /// The campaigns this node holds, so a markdown can be asked whether the
    /// campaign it belongs to is still on.
    campaigns: BTreeMap<&'a str, &'a Campaign>,
}

impl<'a> PriceIndex<'a> {
    pub(crate) fn build(snapshot: &'a crate::PricingSnapshot) -> Self {
        let mut by_sku: BTreeMap<&str, Vec<&PriceEntry>> = BTreeMap::new();
        for entry in &snapshot.entries {
            by_sku
                .entry(entry.sku_code.as_str())
                .or_default()
                .push(entry);
        }
        let mut markdown_by_sku: BTreeMap<&str, Vec<&Markdown>> = BTreeMap::new();
        let mut markdown_by_article: BTreeMap<&str, Vec<&Markdown>> = BTreeMap::new();
        for markdown in &snapshot.markdowns {
            // A markdown naming a SKU is indexed there and nowhere else: the
            // SKU is the narrower statement and the one that will be consulted.
            if let Some(sku_code) = &markdown.sku_code {
                markdown_by_sku
                    .entry(sku_code.as_str())
                    .or_default()
                    .push(markdown);
            } else if let Some(article_code) = &markdown.article_code {
                markdown_by_article
                    .entry(article_code.as_str())
                    .or_default()
                    .push(markdown);
            }
            // A markdown naming neither is indexed nowhere, so it marks nothing
            // down — the same outcome the unindexed path reaches, reached
            // sooner.
        }
        Self {
            by_sku,
            markdown_by_sku,
            markdown_by_article,
            campaigns: snapshot
                .campaigns
                .iter()
                .map(|campaign| (campaign.campaign_id.as_str(), campaign))
                .collect(),
        }
    }

    /// Whether the campaign a markdown belongs to is on.
    ///
    /// **This gate is the opposite way round from the one on rules, and the
    /// asymmetry is deliberate.** `engine::gate` refuses a rule whose campaign
    /// this node has never received — fail closed, because the cost of getting
    /// it wrong is a discount not given, and the shopper pays the list price
    /// they would have paid anyway.
    ///
    /// A markdown is not a discount. It IS the price: it is on the ticket
    /// stapled to the garment, on the shelf edge, on the poster in the window
    /// and in the catalogue screen the assistant is holding. Refusing it puts
    /// the price back UP — so failing closed here means charging a customer
    /// more than every printed thing in the shop says, at the counter, and it
    /// would happen first at the branch furthest behind on sync, which is
    /// exactly the branch least able to explain it.
    ///
    /// So: a campaign this node does not hold leaves the cleared price
    /// standing. Only a campaign it DOES hold, saying in as many words that it
    /// is not running, puts the price back. That makes stopping a campaign an
    /// instruction that has to arrive rather than a message that has to not go
    /// missing.
    /// Whether a scheduled clearance is on at this hour, in the shop's own time.
    ///
    /// A markdown with no schedule runs all day, so this is the whole of the
    /// cost for every clearance ever written before slots existed.
    ///
    /// **A price that switches off at two in the afternoon deserves care that a
    /// promotion does not.** A rule is a discount and lives only in the till; a
    /// markdown is THE price, and in a shop it is also printed on a ticket
    /// stapled to the garment. Scheduling one by the hour means the label is
    /// wrong for the rest of the day. That is the merchandiser's call to make —
    /// the engine's job is to charge the same number the shop's own screens are
    /// showing, which it does, to the minute.
    fn within_the_hours(&self, context: &PricingContext, markdown: &Markdown) -> bool {
        let here = local(context.at, context.utc_offset_minutes);
        markdown.days.allows(here)
            && markdown
                .time_window
                .is_none_or(|window| window.allows(here))
    }

    fn campaign_allows(&self, context: &PricingContext, markdown: &Markdown) -> bool {
        let Some(campaign_id) = markdown.campaign_id.as_deref() else {
            // Belongs to no campaign. Every markdown written before campaigns
            // enveloped them is this case.
            return true;
        };
        let Some(campaign) = self.campaigns.get(campaign_id) else {
            // Named a campaign this node has never heard of. See above.
            return true;
        };
        if campaign.status != CampaignStatus::Active {
            return false;
        }
        // The campaign's window binds as well as the markdown's, so the one a
        // shop gets is the intersection. A campaign that ended at midnight takes
        // its prices with it even if the markdown rows run to the end of the
        // month. Written the same way `engine::gate` writes it, rather than
        // through `covers`, because a campaign's ends are both optional — an
        // open-ended campaign has no start to compare against.
        if campaign.valid_from.is_some_and(|from| context.at < from) {
            return false;
        }
        if campaign.valid_to.is_some_and(|to| context.at >= to) {
            return false;
        }
        true
    }

    pub(crate) fn price(&self, context: &PricingContext, sku_code: &str) -> Option<&'a PriceEntry> {
        let mut best: Option<&PriceEntry> = None;
        for entry in self.by_sku.get(sku_code).into_iter().flatten() {
            if entry.channel != context.channel || !entry.applies_to.applies(context) {
                continue;
            }
            if !covers(context.at, entry.effective_from, entry.effective_to) {
                continue;
            }
            if best.is_none_or(|current| better(entry, current)) {
                best = Some(entry);
            }
        }
        best
    }

    /// Every price that applies here, best first.
    ///
    /// The same filter and the same comparator as [`Self::price`], which
    /// returns only the head of this list. Kept as one sort rather than a
    /// second ranking written beside it: a screen that showed the cascade in a
    /// different order from the one that decides it would be worse than no
    /// screen, because it would look authoritative.
    pub(crate) fn ranked(&self, context: &PricingContext, sku_code: &str) -> Vec<&'a PriceEntry> {
        let mut applicable: Vec<&PriceEntry> = self
            .by_sku
            .get(sku_code)
            .into_iter()
            .flatten()
            .filter(|entry| {
                entry.channel == context.channel
                    && entry.applies_to.applies(context)
                    && covers(context.at, entry.effective_from, entry.effective_to)
            })
            .copied()
            .collect();
        applicable.sort_by(|left, right| {
            if better(left, right) {
                std::cmp::Ordering::Less
            } else if better(right, left) {
                std::cmp::Ordering::Greater
            } else {
                // Two prices that tie must order the same way on every machine,
                // or the centre and a till disagree over something neither can
                // show you. The SKU code is the last stable tie-break.
                left.sku_code.cmp(&right.sku_code)
            }
        });
        applicable
    }

    /// Every markdown that applies here, best first.
    pub(crate) fn markdowns_ranked(
        &self,
        context: &PricingContext,
        line: &CartLine,
    ) -> Vec<&'a Markdown> {
        let by_sku = self.markdown_by_sku.get(line.sku_code.as_str());
        let by_article = line
            .article_code
            .as_deref()
            .and_then(|article| self.markdown_by_article.get(article));
        // The same precedence [`Self::markdown`] applies: a SKU markdown
        // outranks an article one whatever their priorities, so when the
        // narrower list answers, the wider one is not consulted at all.
        let candidates = match (by_sku, by_article) {
            (Some(narrow), _) => narrow,
            (None, Some(wide)) => wide,
            (None, None) => return Vec::new(),
        };
        let mut applicable: Vec<&Markdown> = candidates
            .iter()
            .filter(|markdown| {
                markdown.applies_to.applies(context)
                    && covers(context.at, markdown.effective_from, markdown.effective_to)
                    && self.within_the_hours(context, markdown)
                    && self.campaign_allows(context, markdown)
            })
            .copied()
            .collect();
        applicable.sort_by(|left, right| {
            (right.priority, right.effective_from, &right.markdown_id).cmp(&(
                left.priority,
                left.effective_from,
                &left.markdown_id,
            ))
        });
        applicable
    }

    pub(crate) fn markdown(
        &self,
        context: &PricingContext,
        line: &CartLine,
    ) -> Option<&'a Markdown> {
        // A SKU markdown outranks an article one whatever their priorities, so
        // the narrower list is consulted first and settles it when it answers.
        let by_sku = self.markdown_by_sku.get(line.sku_code.as_str());
        let by_article = line
            .article_code
            .as_deref()
            .and_then(|article| self.markdown_by_article.get(article));
        let candidates = match (by_sku, by_article) {
            (Some(narrow), _) => narrow,
            (None, Some(wide)) => wide,
            (None, None) => return None,
        };

        let mut best: Option<&Markdown> = None;
        for markdown in candidates {
            if !markdown.applies_to.applies(context) {
                continue;
            }
            if !covers(context.at, markdown.effective_from, markdown.effective_to) {
                continue;
            }
            if !self.within_the_hours(context, markdown) {
                continue;
            }
            if !self.campaign_allows(context, markdown) {
                continue;
            }
            let wins = best.is_none_or(|current| {
                (
                    markdown.priority,
                    markdown.effective_from,
                    &markdown.markdown_id,
                ) > (
                    current.priority,
                    current.effective_from,
                    &current.markdown_id,
                )
            });
            if wins {
                best = Some(markdown);
            }
        }
        best
    }
}
