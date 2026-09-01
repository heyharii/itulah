//! Deterministic retail pricing.
//!
//! One evaluator, used by the centre and by the till. That is the whole point:
//! two implementations of "what does this cost" will agree right up until the
//! day they do not, and the day they do not is a day of wrong receipts nobody
//! can explain. Here the question is answered once.
//!
//! The kernel is pure. No database, no clock, no network, no randomness —
//! everything the answer depends on arrives as an argument. That is not
//! fastidiousness: it is what makes it possible to hand the same inputs to the
//! cloud and to a shop-floor terminal and *prove* the answers match, rather
//! than hoping.
//!
//! # The four words, kept apart
//!
//! | | what it is | what it does |
//! |---|---|---|
//! | **Price list** | the base | says what a thing costs |
//! | **Markdown** | a price *source* | **replaces** that base — turun harga |
//! | **Rule** | an *effect* | **reduces** what is charged, or grants a free item |
//! | **Coupon** | a *gate* | discounts nothing; **unlocks** a rule |
//!
//! Blurring the first two is expensive: a markdown booked as a discount
//! inflates both revenue and discount in every report that reads them. Blurring
//! the last two is worse, because a coupon that carries its own discount can
//! disagree with the rule it opens, and then nobody can say what the right
//! price was.
//!
//! # What is not here
//!
//! **Campaigns.** Caps live on each rule rather than on a shared envelope. Five
//! rules that each respect their own budget can still overspend a promotion the
//! business thinks of as one thing; there is nowhere here to say "these five
//! share ten million". See [`rule::Caps`].
//!
//! **Points as tender.** Awarding points is here — it is a deterministic
//! function of a priced basket. Holding a balance, expiring it, and spending it
//! at the till are not: they need a ledger and a lifecycle, and they settle as
//! payment. See [`rule::EarnEffect`].
//!
//! **Vouchers.** A voucher carries money. It is tender, not pricing.

#![forbid(unsafe_code)]

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod engine;
pub mod money;
pub mod price;
pub mod rule;

pub use money::{Currency, Money};
pub use price::{resolve_price, Markdown, PriceEntry, PriceLevel};
pub use rule::{
    Applicability, Campaign, CampaignStatus, Caps, Conditions, Coupon, CumulativeHistory,
    CustomerScope, DaySet, EarnBasis, EarnEffect, Effect, RejectionReason, Rule, RuleScope,
    RuleStatus, Stacking, TimeWindow,
};

// ---------------------------------------------------------------------------
// What the shop is asking about
// ---------------------------------------------------------------------------

/// Everything the engine may consult. Nothing else is reachable from inside.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PricingSnapshot {
    pub publication_version: i64,
    pub entries: Vec<PriceEntry>,
    #[serde(default)]
    pub markdowns: Vec<Markdown>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub coupons: Vec<Coupon>,
    /// The envelopes those rules sit in.
    #[serde(default)]
    pub campaigns: Vec<Campaign>,
}

/// Who is asking, where, and when.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PricingContext {
    pub site_id: String,
    pub channel: String,
    /// The instant to price at. Passed in rather than read from a clock, so a
    /// simulation of last Tuesday is the same code path as a sale right now.
    pub at: DateTime<Utc>,
    /// Codes the shopper presented. A rule gated by a coupon stays shut until
    /// its code is in here.
    #[serde(default)]
    pub coupon_codes: Vec<String>,
    /// The shopper, when they are known. Absent for an anonymous sale.
    #[serde(default)]
    pub customer_id: Option<String>,
    /// Their membership tier, when the shop runs tiers.
    ///
    /// Loyalty is flat unless a shop says otherwise, and a tier benefit is an
    /// ordinary rule scoped to that tier — never a hidden multiplier applied
    /// behind the rules. A shopper who asks why they got that price can be
    /// shown the rule.
    #[serde(default)]
    pub customer_tier: Option<String>,
    /// How many times this shopper has already used each rule, as far as this
    /// node knows.
    #[serde(default)]
    pub customer_rule_uses: std::collections::BTreeMap<String, i64>,
    /// What this shopper has already bought toward each cumulative rule, keyed
    /// by rule id. Supplied by the caller; the engine keeps no history.
    #[serde(default)]
    pub customer_cumulative: std::collections::BTreeMap<String, CumulativeHistory>,
}

impl PricingContext {
    pub fn new(site_id: impl Into<String>, channel: impl Into<String>, at: DateTime<Utc>) -> Self {
        Self {
            site_id: site_id.into(),
            channel: channel.into(),
            at,
            coupon_codes: Vec::new(),
            customer_id: None,
            customer_tier: None,
            customer_rule_uses: std::collections::BTreeMap::new(),
            customer_cumulative: std::collections::BTreeMap::new(),
        }
    }

    pub fn with_coupon(mut self, code: impl Into<String>) -> Self {
        self.coupon_codes.push(code.into());
        self
    }

    pub fn for_customer(mut self, customer_id: impl Into<String>) -> Self {
        self.customer_id = Some(customer_id.into());
        self
    }

    pub fn in_tier(mut self, tier: impl Into<String>) -> Self {
        self.customer_tier = Some(tier.into());
        self
    }
}

/// One thing a shopper is buying.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CartLine {
    pub sku_code: String,
    /// The parent style, when the caller knows it. Article-scoped markdowns and
    /// rules — "everything in this range" — match on it.
    ///
    /// Supplied rather than derived. This engine does not know how a SKU code
    /// is built, and an engine that did would break the day that format changed.
    #[serde(default)]
    pub article_code: Option<String>,
    /// The merchandise division this sits in — menswear, footwear.
    #[serde(default)]
    pub division: Option<String>,
    /// Free-form labels a promotion can target: "Lebaran", "end-of-season".
    #[serde(default)]
    pub tags: Vec<String>,
    /// What this cost the shop. Only a margin rule reads it; a line without one
    /// is simply left alone by such a rule rather than priced off a guess.
    #[serde(default)]
    pub unit_cost: Option<Money>,
    /// A price a person typed in, overriding the book entirely.
    ///
    /// It still has to be a price the shop can defend, so it is recorded as
    /// `MANUAL_OVERRIDE` on the line rather than blending into the published
    /// price. Promotions still apply on top: an override says what the item
    /// costs, not that the shopper forfeits every offer.
    #[serde(default)]
    pub manual_unit_price: Option<Money>,
    /// What kind of thing this is, for the ledger. A carrier bag and a service
    /// charge must not land in merchandise net sales.
    #[serde(default)]
    pub posting_class: PostingClass,
    pub quantity: i64,
}

/// What a line is, as far as the ledger is concerned.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PostingClass {
    /// Goods. The default, and the only one that belongs in net sales.
    #[default]
    Merchandise,
    /// A carrier bag — kantong. Sold, but not merchandise.
    Bag,
    /// Alterations, delivery, gift wrap.
    Service,
}

impl CartLine {
    pub fn new(sku_code: impl Into<String>, quantity: i64) -> Self {
        Self {
            sku_code: sku_code.into(),
            article_code: None,
            division: None,
            tags: Vec::new(),
            unit_cost: None,
            manual_unit_price: None,
            posting_class: PostingClass::Merchandise,
            quantity,
        }
    }

    pub fn of_article(mut self, article_code: impl Into<String>) -> Self {
        self.article_code = Some(article_code.into());
        self
    }

    pub fn in_division(mut self, division: impl Into<String>) -> Self {
        self.division = Some(division.into());
        self
    }

    pub fn tagged(mut self, tag: impl Into<String>) -> Self {
        self.tags.push(tag.into());
        self
    }

    pub fn costing(mut self, unit_cost: Money) -> Self {
        self.unit_cost = Some(unit_cost);
        self
    }

    pub fn priced_by_hand(mut self, unit_price: Money) -> Self {
        self.manual_unit_price = Some(unit_price);
        self
    }

    pub fn posting(mut self, posting_class: PostingClass) -> Self {
        self.posting_class = posting_class;
        self
    }
}

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

/// Where a line's price came from, before any rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PriceSource {
    /// A price list entry for this exact shop.
    SitePrice,
    /// A price for a group of shops this one belongs to.
    SiteGroupPrice,
    /// A price for this shopper's membership tier.
    TierPrice,
    /// The company-wide price.
    CompanyPrice,
    /// A markdown replaced whichever of the above applied.
    Markdown,
    /// A price a person typed in, overriding the book.
    ManualOverride,
}

/// One priced line, and the reasoning behind it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineResult {
    pub sku_code: String,
    pub quantity: i64,
    pub source: PriceSource,
    /// What the price list said, before any markdown.
    pub base_unit_price: Money,
    /// What one costs after markdown, before any rule. Rules act on the line
    /// total, not the unit price, so this stays the honest per-unit figure.
    pub unit_price: Money,
    /// What this line actually comes to, after every rule that applied.
    pub line_total: Money,
    pub currency: Currency,
    pub tax_category: String,
    pub publication_version: i64,
    /// Named when a markdown won, so a reader can go and look at it.
    pub markdown_id: Option<String>,
    /// Which ledger bucket this line belongs in.
    pub posting_class: PostingClass,
}

/// An item handed over at no charge, or at a token price.
///
/// The caller must append this to the sale as a real line. Otherwise the shirt
/// walks out of the shop and the stock still says it is on the shelf.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FreeLine {
    pub sku_code: String,
    pub quantity: i64,
    pub unit_price: Money,
    pub granted_by_rule_id: String,
    /// What the shopper would otherwise have paid. Recorded so the cost is not
    /// lost to finance, and so this rule can compete fairly against a discount.
    pub value: Money,
}

/// A rule that applied, and what it was worth.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedRule {
    pub rule_id: String,
    /// The campaign it belongs to, so spend can be totalled per promotion
    /// rather than per rule — which is how the business thinks of it.
    pub campaign_id: Option<String>,
    pub name: String,
    /// The code that unlocked it, when one did.
    ///
    /// Present only when the rule actually applied, which is the whole point:
    /// a code typed and refused has not been redeemed, and counting it as used
    /// would burn a customer's coupon for nothing.
    pub coupon_code: Option<String>,
    pub benefit: Money,
}

/// A rule that did not apply, and why not.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RejectedRule {
    pub rule_id: String,
    pub name: String,
    pub reason: RejectionReason,
    /// The same reason in the words a cashier would use.
    pub explanation: String,
    /// What it would have been worth. Present for an offer that a person has to
    /// choose, so the screen can say what it is offering rather than just that
    /// something is available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub would_have_saved: Option<Money>,
}

impl RejectedRule {
    pub(crate) fn new(rule: &Rule, reason: RejectionReason) -> Self {
        Self {
            rule_id: rule.rule_id.clone(),
            name: rule.name.clone(),
            reason,
            explanation: reason.describe().to_string(),
            would_have_saved: None,
        }
    }

    pub(crate) fn worth(mut self, benefit: Money) -> Self {
        self.would_have_saved = Some(benefit);
        self
    }
}

/// Points awarded by one rule.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EarnAward {
    pub rule_id: String,
    pub name: String,
    pub points: i64,
    /// The amount the points were computed from. Zero for a flat bonus.
    pub basis_amount: Money,
}

/// The answer, whole — including what did not happen and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PricingResult {
    /// A fingerprint of this decision.
    ///
    /// The same basket, priced against the same book at the same instant, gives
    /// the same id on any machine. That is what lets a shop price offline and
    /// the centre reproduce the exact same answer afterwards — a disputed
    /// receipt stops being one person's word against a database.
    pub trace_id: String,
    pub publication_version: i64,
    pub currency: Currency,
    pub lines: Vec<LineResult>,
    pub free_lines: Vec<FreeLine>,
    pub applied_rules: Vec<AppliedRule>,
    /// Every rule that could have applied and did not. This is not diagnostic
    /// noise: "the promotion did not come off" and "that coupon expired on
    /// Friday" are different conversations, and the cashier is the one having
    /// them.
    pub rejected_rules: Vec<RejectedRule>,
    pub earn_awards: Vec<EarnAward>,
    pub points_earned: i64,
    /// What every applied rule took off, together.
    pub discount_total: Money,
    pub total: Money,
}

/// What a shop may sell, and for how much.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub sku_code: String,
    pub unit_price: Money,
    pub base_unit_price: Money,
    pub source: PriceSource,
    pub markdown_id: Option<String>,
    pub currency: Currency,
    pub tax_category: String,
    pub publication_version: i64,
}

/// Everything that can go wrong, said plainly enough to act on.
///
/// There is no "price not found, so charge zero" and no guess. A till that
/// invents a price is worse than a till that stops.
///
/// Note what is *not* an error: a promotion that cannot apply. Those are
/// recorded in [`PricingResult::rejected_rules`] and the sale goes through. A
/// cashier's screen is the wrong place to discover that head office authored
/// two contradictory promotions.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum PricingError {
    #[error("no price for {sku_code} at {site_id} on {channel}")]
    NoPrice {
        sku_code: String,
        site_id: String,
        channel: String,
    },
    #[error("{sku_code} is not sellable at {site_id} on {channel}")]
    NotSellable {
        sku_code: String,
        site_id: String,
        channel: String,
    },
    #[error("a cart cannot mix {left} and {right}")]
    MixedCurrency { left: String, right: String },
    #[error("quantity for {sku_code} must be positive")]
    NonPositiveQuantity { sku_code: String },
    #[error("an amount grew past what can be counted")]
    AmountOverflow,
}

// ---------------------------------------------------------------------------
// The entry points
// ---------------------------------------------------------------------------

/// Price a whole basket: base, markdown, promotions, points.
pub fn price_cart(
    snapshot: &PricingSnapshot,
    context: &PricingContext,
    cart: &[CartLine],
) -> Result<PricingResult, PricingError> {
    engine::resolve(snapshot, context, cart)
}

/// What a shop may sell, priced.
///
/// Base and markdown only — a shelf edge shows what a thing costs, not what it
/// would cost in a basket that happened to qualify for something. A "buy two"
/// price is not this product's price.
pub fn price_catalog(
    snapshot: &PricingSnapshot,
    context: &PricingContext,
    products: &[CartLine],
) -> Vec<CatalogEntry> {
    engine::catalog(snapshot, context, products)
}

/// Whether a coupon code would be accepted, before there is a basket to price.
pub fn check_coupon<'a>(
    snapshot: &'a PricingSnapshot,
    context: &PricingContext,
    code: &str,
) -> Result<&'a Coupon, RejectionReason> {
    engine::check_coupon_code(snapshot, context, code)
}

#[cfg(test)]
mod tests;
