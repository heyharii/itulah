//! Promotions: what they can do, when they may do it, and how they combine.
//!
//! Four words that are easy to blur and expensive to blur, so they are kept
//! apart here deliberately:
//!
//! - A **markdown** (see [`crate::price`]) is a price *source*. It replaces
//!   what an item costs. Turun harga, clearance.
//! - A **rule** is an *effect*. It reduces what is charged, or grants a free
//!   item. This is what most people mean by "promo".
//! - A **coupon** is a *gate*. It discounts nothing by itself; it unlocks a
//!   rule for a cart that presents the code.
//! - A **campaign** is the *envelope*: lifecycle and caps shared across a set
//!   of rules. Five offers that are one promotion to the business are one
//!   campaign here, and they spend one budget between them.
//!
//! Booking a markdown as a discount inflates both revenue and discount in every
//! report that reads them, which is why the two are different types and not a
//! flag.

use chrono::{DateTime, Datelike, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::money::Money;

/// What a rule does when it applies.
///
/// An enum rather than a struct of mutually exclusive fields. The shape this
/// was ported from carries `effect`, `percent_bps`, `amount`, `fixed_price`,
/// `free_sku`, `free_qty` and more side by side, where at most one group is
/// meaningful for any given rule and nothing prevents a percent rule from
/// carrying a free-item quantity. Here a rule that discounts cannot also be
/// carrying a half-filled free-item effect, because there is nowhere to put it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Effect {
    /// Take a percentage off each matched line.
    Percent {
        bps: i64,
        /// Whether this percentage applies to what is left after earlier
        /// promotions, rather than to the original line total.
        ///
        /// Off by default, and the default is the one that matters: two
        /// stacked "10% off" promotions come to 20%, not 19%. A merchandiser
        /// who advertises 10% + 10% has promised twenty, and a till that
        /// quietly compounds them shorts the shopper by one per cent on every
        /// basket — an error small enough to survive every review and large
        /// enough to be worth arguing about at the counter.
        #[serde(default)]
        compound: bool,
    },
    /// Take a flat amount off the cart, apportioned across matched lines by
    /// their value, so a two-item cart does not get the discount twice.
    Amount { amount: Money },
    /// Replace the unit price of each matched line outright.
    FixedUnitPrice { unit_price: Money },
    /// Price at cost plus a margin. Used to clear stock without selling below
    /// what it was bought for.
    ///
    /// A line whose cost the caller did not supply is left alone, and so is one
    /// where the margin price is not actually cheaper — a "discount" that
    /// raises a price is not a discount.
    Margin { bps: i64 },
    /// Grant free items. Emits a line the caller must append to the sale, so
    /// the stock actually leaves and the cost is not lost.
    FreeItem {
        /// What is given. `None` means the same product that triggered the
        /// rule — "buy two of these, get one of these free", where the shop
        /// does not have to name the product twice and cannot get it wrong.
        #[serde(default)]
        sku_code: Option<String>,
        /// How many are granted each time the trigger is met.
        quantity: i64,
        /// Grant again for every N matched units. `None` grants once.
        #[serde(default)]
        every_matched_quantity: Option<i64>,
        /// Matched units that do not count toward the trigger. "From the third
        /// one onward" is this set to two.
        #[serde(default)]
        after_matched_quantity: i64,
        /// What the free item is charged at. Zero unless a token price is
        /// wanted on the receipt.
        #[serde(default)]
        unit_price: Money,
    },
    /// Award loyalty points. Carries no price benefit, so it never competes
    /// with a discount — see [`crate::engine`] for why it is resolved
    /// separately.
    EarnPoints(EarnEffect),
}

/// How points accrue.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EarnEffect {
    /// One point per this much spend, floored. The base rate; only one wins.
    SpendRate { spend_per_point: Money },
    /// A flat bonus when the rule matches at all. Additive.
    FixedPoints { points: i64 },
    /// A bonus per matched unit. Additive.
    PointsPerQuantity { points: i64 },
}

/// Which amount points accrue on.
///
/// Default is the selling price after any markdown but before discounts: a
/// shopper who buys a marked-down shirt earns on what the shirt now costs, and
/// a promotion the shop chose to run does not also cut the points it awards.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EarnBasis {
    #[default]
    PostMarkdownPreDiscount,
    /// Net of every discount the engine applied.
    PostDiscountNet,
    /// The list price, before markdown.
    Original,
}

/// Who a rule is for.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "who", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CustomerScope {
    /// Anybody who walks in.
    #[default]
    Everyone,
    /// Any identified member.
    Members,
    /// Members in one of these tiers.
    Tiers { tier_ids: BTreeSet<String> },
}

/// What a rule matches.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "on", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Applicability {
    /// These exact products.
    Sku { sku_codes: BTreeSet<String> },
    /// Every variant of these styles — all colours, all sizes.
    ///
    /// The engine does not derive an article from a SKU code. It is told, on
    /// the cart line, by the caller who owns that format. A pricing engine that
    /// knows how SKU codes are built is a pricing engine that breaks when they
    /// change.
    Article { article_codes: BTreeSet<String> },
    /// A merchandise division — menswear, footwear.
    Division { divisions: BTreeSet<String> },
    /// Anything carrying one of these tags. The loose, campaign-shaped
    /// dimension: "Lebaran", "end-of-season".
    Tag { tags: BTreeSet<String> },
    /// The cart as a whole. Conditions read the whole basket; the effect lands
    /// on every line.
    WholeCart,
}

/// Where a rule is allowed to run at all.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleScope {
    pub applicability: Option<Applicability>,
    /// Never matched, whatever else says. Checked last, so an exclusion always
    /// wins — the field exists to carve holes in a broad rule, and a hole that
    /// can be overridden is not a hole.
    #[serde(default)]
    pub excluded_sku_codes: BTreeSet<String>,
    /// Empty means every shop.
    #[serde(default)]
    pub site_ids: BTreeSet<String>,
    /// Empty means every channel.
    #[serde(default)]
    pub channels: BTreeSet<String>,
    /// Who the promotion is for.
    #[serde(default)]
    pub customers: CustomerScope,
    /// Where the discount lands, when that is not where the trigger was.
    ///
    /// "Buy a suit, get 50% off a shirt": the conditions still read the suits,
    /// but the money comes off the shirts. Leaving this unset lands the effect
    /// on the lines that triggered it, which is the ordinary case.
    #[serde(default)]
    pub effect_on: Option<Applicability>,
}

/// The days a rule runs on. Empty means every day.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaySet {
    /// Monday is 1, Sunday is 7, matching ISO 8601 — the numbering people
    /// already write down, rather than a zero-based one that reads correctly
    /// only to whoever wrote the code.
    #[serde(default)]
    pub iso_weekdays: BTreeSet<u32>,
}

impl DaySet {
    fn allows(&self, at: DateTime<Utc>) -> bool {
        self.iso_weekdays.is_empty()
            || self
                .iso_weekdays
                .contains(&at.weekday().number_from_monday())
    }
}

/// The hours a rule runs between, in minutes since midnight.
///
/// `from` greater than `to` means the window crosses midnight — a late-night
/// promotion is a real thing and wrapping is not an error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeWindow {
    pub from_minute: u32,
    pub to_minute: u32,
}

impl TimeWindow {
    fn allows(&self, at: DateTime<Utc>) -> bool {
        let minute = at.hour() * 60 + at.minute();
        if self.from_minute <= self.to_minute {
            minute >= self.from_minute && minute < self.to_minute
        } else {
            minute >= self.from_minute || minute < self.to_minute
        }
    }
}

/// Everything that must hold before a rule may apply.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conditions {
    /// How many matched units the cart must hold.
    #[serde(default)]
    pub min_quantity: i64,
    #[serde(default)]
    pub max_quantity: Option<i64>,
    /// How much the matched lines must come to.
    #[serde(default)]
    pub min_amount: Money,
    #[serde(default)]
    pub max_amount: Option<Money>,
    #[serde(default)]
    pub effective_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub effective_to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub days: DaySet,
    #[serde(default)]
    pub time_window: Option<TimeWindow>,
    /// Whether the thresholds above count what this shopper has already bought
    /// in the promotion's window, not just what is in the basket now.
    ///
    /// "Spend five million during June and get ten per cent" is this. It needs
    /// both window bounds — a running total with no start is not a total of
    /// anything — and the history itself comes from the caller.
    #[serde(default)]
    pub cumulative: bool,
}

impl Conditions {
    /// The checks that do not depend on what is in the basket.
    pub(crate) fn window_allows(&self, at: DateTime<Utc>) -> Option<RejectionReason> {
        if self.effective_from.is_some_and(|from| at < from) {
            return Some(RejectionReason::NotStarted);
        }
        if self.effective_to.is_some_and(|to| at >= to) {
            return Some(RejectionReason::Expired);
        }
        if !self.days.allows(at) {
            return Some(RejectionReason::DayNotAllowed);
        }
        if self.time_window.is_some_and(|window| !window.allows(at)) {
            return Some(RejectionReason::TimeNotAllowed);
        }
        None
    }
}

/// Limits on how much may be given away in total.
///
/// Carried by a rule, and again by the campaign a rule belongs to, so a
/// promotion made of five offers can hold one budget between them.
///
/// One limit here is inherent rather than chosen, and it matters. `spent` and
/// `used` are read from the snapshot, which at a shop is only as fresh as its
/// last sync. An offline till cannot know what other shops have spent this
/// morning, so a budget is a brake, not a gate. Anything that must not be
/// exceeded has to be checked where the counting happens.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Caps {
    /// Total discount this rule may give. `None` is unlimited.
    #[serde(default)]
    pub budget: Option<Money>,
    /// What it has given so far, as of the snapshot.
    #[serde(default)]
    pub spent: Money,
    /// How many carts it may apply to. `None` is unlimited.
    #[serde(default)]
    pub max_uses: Option<i64>,
    #[serde(default)]
    pub used: i64,
    /// How many times one shopper may use it. `None` is unlimited.
    #[serde(default)]
    pub max_uses_per_customer: Option<i64>,
}

impl Caps {
    pub(crate) fn allows(&self, customer_uses: i64) -> Option<RejectionReason> {
        if self
            .budget
            .is_some_and(|budget| self.spent.minor >= budget.minor)
        {
            return Some(RejectionReason::BudgetSpent);
        }
        if self.max_uses.is_some_and(|max| self.used >= max) {
            return Some(RejectionReason::UsageExhausted);
        }
        if self
            .max_uses_per_customer
            .is_some_and(|max| customer_uses >= max)
        {
            return Some(RejectionReason::CustomerLimitReached);
        }
        None
    }

    /// What is left in the budget, if there is one.
    pub(crate) fn remaining(&self) -> Option<Money> {
        self.budget
            .map(|budget| Money::new(budget.minor - self.spent.minor).floor_at_zero())
    }
}

/// How a rule behaves in the company of others.
///
/// Three states, and only three. The shape this was ported from spells them
/// with two independent booleans, which can express a fourth combination that
/// means nothing — "exclusive, but also stacks with others".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Stacking {
    /// Combines with every other stackable rule.
    Stackable,
    /// Applies on its own, but loses to a better combination.
    #[default]
    Alone,
    /// If it wins, nothing else applies.
    Exclusive,
}

/// Whether a rule is live.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleStatus {
    Draft,
    #[default]
    Active,
    Paused,
    Expired,
}

/// The lifecycle of a campaign.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CampaignStatus {
    Draft,
    Scheduled,
    #[default]
    Active,
    Paused,
    Expired,
    Cancelled,
}

/// A set of offers the business runs as one thing.
///
/// Its window and its caps bind every rule inside it. A rule is live only when
/// both it and its campaign are: pausing the campaign pauses all of it, which
/// is what somebody means when they say "stop the Lebaran promo" — and having
/// to pause six rules by hand is how one gets left running.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Campaign {
    pub campaign_id: String,
    pub name: String,
    #[serde(default)]
    pub status: CampaignStatus,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    /// Shared across every rule in the campaign.
    #[serde(default)]
    pub caps: Caps,
}

/// How much of a rule's thresholds a shopper has already met.
///
/// Supplied by the caller from what it knows of this customer's history in the
/// promotion's window. It is what turns "spend five million in June and get ten
/// per cent" from a single-basket test into a running one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CumulativeHistory {
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub amount: Money,
}

/// One promotion.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rule {
    pub rule_id: String,
    /// The campaign this belongs to, if any. Its window and caps bind here too.
    #[serde(default)]
    pub campaign_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub status: RuleStatus,
    #[serde(default)]
    pub scope: RuleScope,
    #[serde(default)]
    pub conditions: Conditions,
    pub effect: Effect,
    /// The code that unlocks this rule. `None` means it applies unprompted.
    #[serde(default)]
    pub coupon_code: Option<String>,
    /// Most this rule may take off one cart. `None` is unbounded.
    #[serde(default)]
    pub max_discount: Option<Money>,
    #[serde(default)]
    pub caps: Caps,
    /// Higher wins when two rules cannot both apply.
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub stacking: Stacking,
    /// Never applied on its own; surfaced so a person can choose it.
    ///
    /// For offers that need a decision the till cannot make — a trade-in, a
    /// manager's approval. It reports what it *would* have been worth, so the
    /// screen can offer it rather than silently applying it.
    #[serde(default)]
    pub advisory: bool,
    /// Which amount points accrue on. Only read for an earn rule.
    #[serde(default)]
    pub earn_basis: EarnBasis,
    /// Most points this rule may award on one cart. `None` is unbounded.
    #[serde(default)]
    pub max_points: Option<i64>,
}

impl Rule {
    pub(crate) fn is_earn(&self) -> bool {
        matches!(self.effect, Effect::EarnPoints(_))
    }
}

/// A code that unlocks a rule.
///
/// A coupon is a gate and never a discount in its own right. Keeping it that
/// way means there is exactly one place where a benefit is calculated, so a
/// coupon cannot silently disagree with the rule it opens.
///
/// Value instruments — vouchers, gift cards — are a different thing entirely:
/// they carry money and are settled as tender, not resolved as pricing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Coupon {
    pub code: String,
    pub rule_id: String,
    #[serde(default)]
    pub active: bool,
    /// Reserved for one shopper. `None` means anyone holding the code.
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub valid_from: Option<DateTime<Utc>>,
    #[serde(default)]
    pub valid_to: Option<DateTime<Utc>>,
    #[serde(default)]
    pub max_uses: Option<i64>,
    #[serde(default)]
    pub used: i64,
}

/// Why a rule did not apply.
///
/// Recorded rather than discarded. A cashier facing "the promotion did not come
/// off" needs an answer, and "the rule was not in the winning combination" is a
/// different conversation from "that coupon expired on Friday".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RejectionReason {
    NotActive,
    NotStarted,
    Expired,
    DayNotAllowed,
    TimeNotAllowed,
    WrongSite,
    WrongChannel,
    NoCoupon,
    CouponUnknown,
    CouponNotActive,
    CouponExpired,
    CouponUsedUp,
    CouponBelongsToSomeoneElse,
    BudgetSpent,
    UsageExhausted,
    CustomerLimitReached,
    NothingMatched,
    NotThisCustomer,
    /// It belongs to a promotion this node has never heard of.
    CampaignUnknown,
    /// It applies, but only a person may decide to use it.
    AdvisoryOnly,
    QuantityTooLow,
    QuantityTooHigh,
    AmountTooLow,
    AmountTooHigh,
    /// It applied cleanly, but another combination gave the shopper more.
    OutbidByBetterOffer,
    /// It was excluded because an exclusive rule won.
    DisplacedByExclusiveRule,
    /// It would have taken nothing off.
    NoBenefit,
}

impl RejectionReason {
    /// A short explanation in the words a cashier would use.
    pub fn describe(self) -> &'static str {
        match self {
            Self::NotActive => "the promotion is not active",
            Self::NotStarted => "the promotion has not started yet",
            Self::Expired => "the promotion has ended",
            Self::DayNotAllowed => "the promotion does not run today",
            Self::TimeNotAllowed => "the promotion does not run at this hour",
            Self::WrongSite => "the promotion does not run at this shop",
            Self::WrongChannel => "the promotion does not run on this channel",
            Self::NoCoupon => "this promotion needs a coupon code",
            Self::CouponUnknown => "no such coupon code",
            Self::CouponNotActive => "that coupon is not active",
            Self::CouponExpired => "that coupon has expired",
            Self::CouponUsedUp => "that coupon has been used already",
            Self::CouponBelongsToSomeoneElse => "that coupon belongs to another customer",
            Self::BudgetSpent => "the promotion budget is used up",
            Self::UsageExhausted => "the promotion has reached its usage limit",
            Self::CustomerLimitReached => "this customer has used the promotion already",
            Self::NothingMatched => "nothing in the basket qualifies",
            Self::NotThisCustomer => "the promotion is for members only",
            Self::CampaignUnknown => "this shop has not received that promotion",
            Self::AdvisoryOnly => "this offer has to be applied by hand",
            Self::QuantityTooLow => "not enough qualifying items",
            Self::QuantityTooHigh => "too many qualifying items",
            Self::AmountTooLow => "the qualifying total is too low",
            Self::AmountTooHigh => "the qualifying total is too high",
            Self::OutbidByBetterOffer => "another offer gave a better price",
            Self::DisplacedByExclusiveRule => "another offer cannot be combined with this one",
            Self::NoBenefit => "the promotion would take nothing off",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32) -> DateTime<Utc> {
        // 2026-09-02 is a Wednesday.
        Utc.with_ymd_and_hms(2026, 9, 2, hour, minute, 0)
            .single()
            .unwrap_or_else(|| panic!("bad fixture time"))
    }

    #[test]
    fn a_window_that_crosses_midnight_is_not_an_empty_window() {
        let overnight = TimeWindow {
            from_minute: 22 * 60,
            to_minute: 2 * 60,
        };
        assert!(overnight.allows(at(23, 0)), "before midnight");
        assert!(overnight.allows(at(1, 0)), "after midnight");
        assert!(!overnight.allows(at(12, 0)), "the middle of the day");
    }

    #[test]
    fn an_ordinary_window_excludes_its_own_end() {
        let window = TimeWindow {
            from_minute: 9 * 60,
            to_minute: 17 * 60,
        };
        assert!(window.allows(at(9, 0)));
        assert!(window.allows(at(16, 59)));
        assert!(!window.allows(at(17, 0)), "closing time is closed");
    }

    #[test]
    fn no_days_named_means_every_day() {
        assert!(DaySet::default().allows(at(12, 0)));
    }

    #[test]
    fn days_are_numbered_the_way_people_write_them_down() {
        let wednesday = DaySet {
            iso_weekdays: [3].into_iter().collect(),
        };
        assert!(
            wednesday.allows(at(12, 0)),
            "2026-09-02 is a Wednesday, and Wednesday is 3"
        );
    }
}
