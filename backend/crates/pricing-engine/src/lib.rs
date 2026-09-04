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
    Applicability, Campaign, CampaignStatus, Caps, Conditions, Coupon, CustomerScope, DaySet,
    EarnBasis, EarnEffect, Effect, RejectionReason, Rule, RuleScope, RuleStatus, Stacking,
    TimeWindow,
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
    /// How far ahead of UTC the shop is, in minutes.
    ///
    /// Read only by the day-of-week and time-of-day conditions, which are the
    /// only local facts in pricing: an absolute window is an instant and means
    /// the same moment everywhere. Zero here is UTC, which is right for a shop
    /// in London and wrong by seven hours for one in Jakarta — so the callers
    /// that know where the shop is set it, and the engine assumes nothing.
    #[serde(default)]
    pub utc_offset_minutes: i32,
}

impl PricingContext {
    pub fn new(site_id: impl Into<String>, channel: impl Into<String>, at: DateTime<Utc>) -> Self {
        Self {
            site_id: site_id.into(),
            channel: channel.into(),
            at,
            coupon_codes: Vec::new(),
            customer_id: None,
            utc_offset_minutes: 0,
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
    pub quantity: i64,
}

impl CartLine {
    pub fn new(sku_code: impl Into<String>, quantity: i64) -> Self {
        Self {
            sku_code: sku_code.into(),
            article_code: None,
            division: None,
            tags: Vec::new(),
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
    /// The company-wide price.
    CompanyPrice,
    /// A markdown replaced whichever of the above applied.
    Markdown,
}

impl PriceSource {
    /// The one name each source has on the wire.
    ///
    /// Here rather than at each caller, because it was written twice and the
    /// two did not agree: a shop rendered `COMPANY_PRICE` through a private
    /// helper while the centre rendered `CompanyPrice` through `Debug`. Same
    /// enum, same value, two words — so a screen reading one of them showed an
    /// empty badge against the other node, and any report grouping by this
    /// column counted the same price twice under different names.
    ///
    /// `Debug` is the wrong tool for a wire value in particular. It is derived
    /// for a person reading a stack trace, it is explicitly not stable, and
    /// nothing warns you when renaming a variant silently changes what a
    /// browser receives. This matches the `serde` renaming above, so the string
    /// and the serialised form are the same word by construction.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SitePrice => "SITE_PRICE",
            Self::SiteGroupPrice => "SITE_GROUP_PRICE",
            Self::CompanyPrice => "COMPANY_PRICE",
            Self::Markdown => "MARKDOWN",
        }
    }
}

impl std::fmt::Display for PriceSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
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
    /// What it took off each line, by the line's position in the cart.
    ///
    /// The engine has always computed this — a flat "Rp 50,000 off" has to be
    /// apportioned across the matched lines before it can be applied — and used
    /// to sum it away immediately. Keeping it is the difference between two
    /// questions a merchandiser asks with the same words: what a promotion
    /// INFLUENCED (the baskets it appeared in, which overstates by however much
    /// of each basket it never touched) and what it ATTRIBUTABLY cost.
    ///
    /// Empty for a rule that grants goods rather than cutting a price: the
    /// value handed over belongs to no line in the basket.
    #[serde(default)]
    pub line_benefits: Vec<LineBenefit>,
}

/// What one promotion took off one line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineBenefit {
    /// The line's position in the cart as it was handed in, which is also its
    /// position in `PricingResult::lines`. Position rather than sku code,
    /// because a basket may hold the same product on two lines and only one of
    /// them may have matched.
    pub line: usize,
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

/// One price that could have applied, and whether it did.
///
/// The cascade normally answers with a single number, which is all a till
/// needs and less than a merchandiser needs. "Why is this shop charging 99?"
/// is answered by the losers as much as the winner: a company price of 169
/// superseded by a clearance, or a shop price that lost to a newer book.
///
/// Ordered by the same comparator that decides the answer, never a second one
/// written beside it — a screen that showed the cascade in a different order
/// from the order that decides it would look authoritative and be wrong.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PriceCandidate {
    pub source: PriceSource,
    /// Who this price is for: everyone, a group of shops, a tier, one shop.
    pub applies_to: PriceLevel,
    pub unit_price: Money,
    pub currency: Currency,
    pub tax_category: String,
    pub publication_version: i64,
    /// Named when this candidate is a markdown.
    pub markdown_id: Option<String>,
    pub effective_from: DateTime<Utc>,
    pub effective_to: Option<DateTime<Utc>>,
    /// True for the one that is actually charged. Exactly one candidate in a
    /// non-empty stack carries it.
    pub in_force: bool,
}

/// Every price that could apply to one product, best first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProductStack {
    pub sku_code: String,
    /// Empty when nothing prices this product here — which is not an error and
    /// not a zero price: it means the product cannot be sold at this shop.
    pub candidates: Vec<PriceCandidate>,
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

/// Every price that could apply to each product, best first.
///
/// The same index and the same ordering [`price_catalog`] uses, reporting the
/// losers as well as the winner. Built once for the whole list rather than per
/// product: a stack per SKU that rebuilt the index each time would be quadratic
/// on a catalogue, which is the difference between a screen that opens and one
/// that hangs.
pub fn price_stacks(
    snapshot: &PricingSnapshot,
    context: &PricingContext,
    products: &[CartLine],
) -> Vec<ProductStack> {
    engine::stacks(snapshot, context, products)
}

/// Whether one promotion may run right now, and why not when it may not.
///
/// The gate `price_cart` applies, asked without a basket. A screen that lists
/// what a shop is running reads this rather than the rule's own `status` field:
/// a rule can be `ACTIVE` and still be dead — outside its window, at the wrong
/// shop, under a campaign somebody paused, or out of budget — and a promotions
/// board that reported `status` would advertise every one of those.
///
/// The reasons are the caller's to sort. [`RejectionReason::NotStarted`] is the
/// interesting one: it is not a refusal so much as a date, and it is what tells
/// a shop floor that Friday's prices are already in the building.
pub fn rule_standing(
    rule: &Rule,
    snapshot: &PricingSnapshot,
    context: &PricingContext,
) -> Result<(), RejectionReason> {
    engine::standing(rule, snapshot, context)
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
