//! What an item costs before anybody discounts it: the price list cascade, and
//! the markdowns that replace its answer.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::money::{Currency, Money};
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
    /// Shoppers in this membership tier, wherever they shop.
    Tier { tier: String },
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
            Self::Tier { .. } => 1,
            Self::SiteGroup { .. } => 2,
            Self::Site { .. } => 3,
        }
    }

    pub(crate) fn applies(&self, context: &PricingContext) -> bool {
        match self {
            Self::Company => true,
            Self::Tier { tier } => context.customer_tier.as_deref() == Some(tier.as_str()),
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
        }
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
