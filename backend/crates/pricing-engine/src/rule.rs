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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
    /// Discount a bundle the shopper is already holding — decision D01.
    ///
    /// Not a variation on [`Effect::FreeItem`] but the other thing "buy two get
    /// one" can mean, and the difference is what leaves the shop. `FreeItem`
    /// hands over an EXTRA unit and leaves the basket priced as it was; this
    /// reprices units that were already picked up and gives nothing away. That
    /// is why this one can be published and that one cannot: a shop sells by
    /// EPC, and every unit in a bundle has already been scanned, where a
    /// granted unit is one nothing chose.
    ///
    /// The discount does not sit on the rewarded unit. D01 spreads it across
    /// every unit in the bundle, buyers included, so that a refund of any one
    /// of them returns a share of the offer rather than all of it or none —
    /// returning the dear unit at full price and keeping the cheap one free is
    /// how a shopper walks out ahead of a bundle they did not complete.
    BuyXGetY {
        /// Units paid for in each bundle.
        buy: i64,
        /// Units rewarded in each bundle. The CHEAPEST eligible units are the
        /// rewarded ones: "get one free" across three different prices is the
        /// cheapest one free, which is what the shop advertised and what it
        /// would have to argue at the counter otherwise.
        get: i64,
        /// How much comes off each rewarded unit, in basis points. 10.000 is
        /// D01's own case — the reward free — and 5.000 is "get one half
        /// price", which is the same offer and not a different effect.
        ///
        /// Required rather than defaulted, because nought is a syntactically
        /// perfect bundle that rewards nothing. A book that does not say what
        /// the offer gives has not described an offer, and should be refused
        /// rather than published as one that silently does nothing.
        reward_bps: i64,
    },
    /// Award loyalty points. Carries no price benefit, so it never competes
    /// with a discount — see [`crate::engine`] for why it is resolved
    /// separately.
    EarnPoints(EarnEffect),
}

/// How points accrue.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
/// Default is [`PostDiscountNet`](EarnBasis::PostDiscountNet) — the goods after
/// every discount has come off, and before tax. That is the locked rule: a
/// shopper earns on what the shop actually took for the merchandise.
///
/// The two halves are separate decisions and both were argued. *After discount*
/// because the alternative pays loyalty on money nobody paid. *Before tax*
/// because the tax is not the shop's to reward: on an inclusive book it is
/// already inside the ticket price, and awarding on it would hand out points
/// that rise and fall with a rate the shop does not set.
///
/// The old default was [`PostMarkdownPreDiscount`](EarnBasis::PostMarkdownPreDiscount),
/// which reads reasonably and was never anybody's policy — it arrived as a
/// field default and stayed. It is still selectable, for a rule that means it.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EarnBasis {
    /// Net of every discount the engine applied, **and of tax**.
    ///
    /// The V1 default, and the locked rule: points are earned on the goods —
    /// what the shopper actually paid for merchandise, with nothing in it that
    /// belongs to the state. Paying loyalty on a PPN line is paying customers
    /// for money the shop is only holding.
    ///
    /// It is the default rather than the third option because a rule that says
    /// nothing should mean the policy, not the most generous reading of it.
    /// The two below are pre-discount bases kept for the offers that genuinely
    /// want them — "earn on the ticket price even though it was on sale" is a
    /// real promotion — and under tax-inclusive pricing they still contain the
    /// tax, because they are prices rather than net amounts.
    #[default]
    PostDiscountNet,
    /// What the line came to after markdown, before any promotion.
    PostMarkdownPreDiscount,
    /// The list price, before markdown.
    Original,
}

/// What a bonus earning rate does when a better rate already reached the line.
///
/// Several earning rules can be eligible for one line — an everyday rate, a
/// double-points weekend, triple points on footwear. One of them wins the line
/// outright; this says what the OTHERS are then worth, and it is read on each
/// of those others rather than on the winner, because the author of "double
/// points this weekend" is the person deciding whether their offer stacks.
///
/// **The bonus is measured against the least generous rate that reaches the
/// line** — the shop's everyday rate, the one that is always on. That is what
/// makes "2x" a number rather than a ratio between two arbitrary rules. Where
/// no everyday rate reaches a line, the least generous rate in play becomes the
/// baseline and there is nothing to be a bonus over, so the best rate stands
/// alone whatever this says.
///
/// [`Highest`](PointsCombination::Highest) is the default and is exactly what
/// the engine did before this field existed: the best rate takes the line and
/// the rest earn nothing. Defaulting either other way would raise the points
/// every published loyalty rule awards, on baskets that have already been rung.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PointsCombination {
    /// Only the best rate on the line counts. A rate that was beaten earns
    /// nothing — 2x beside 3x is 3x.
    #[default]
    Highest,
    /// Each bonus adds what it is worth ABOVE the everyday rate. 2x beside 3x
    /// is 4x: one for the everyday rate, one more from the 2x, two more from
    /// the 3x.
    Add,
    /// Each bonus multiplies what the line has earned so far. 2x beside 3x is
    /// 6x.
    ///
    /// The one that runs away with a basket if it is chosen carelessly, which
    /// is why it is neither the default nor reachable without saying it: three
    /// modest multipliers that read as generous separately are an order of
    /// magnitude together.
    Compound,
}

/// Who a rule is for.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "who", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CustomerScope {
    /// Anybody who walks in.
    #[default]
    Everyone,
    /// Any identified member.
    Members,
}

/// What a rule matches.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaySet {
    /// Monday is 1, Sunday is 7, matching ISO 8601 — the numbering people
    /// already write down, rather than a zero-based one that reads correctly
    /// only to whoever wrote the code.
    #[serde(default)]
    pub iso_weekdays: BTreeSet<u32>,
}

impl DaySet {
    pub(crate) fn allows(&self, at: DateTime<Utc>) -> bool {
        self.iso_weekdays.is_empty()
            || self
                .iso_weekdays
                .contains(&at.weekday().number_from_monday())
    }
}

/// The instant as the shop experiences it.
///
/// A weekday and an hour are local facts. "Promo Sabtu" means Saturday where
/// the shop is, and read in UTC in a UTC+7 business it ran from Saturday 07:00
/// to Sunday 07:00 — right for seventeen hours of the day and wrong for seven,
/// every week, with nothing on any screen to say so.
///
/// The offset arrives on the context rather than being assumed here: the engine
/// is told everything the answer depends on, and a shop's timezone is a fact
/// about the shop. An absolute window (`effective_from`/`effective_to`) is NOT
/// shifted — those are instants, and an instant is the same moment everywhere.
pub(crate) fn local(at: DateTime<Utc>, offset_minutes: i32) -> DateTime<Utc> {
    at + chrono::Duration::minutes(i64::from(offset_minutes))
}

/// The hours a rule runs between, in minutes since midnight.
///
/// `from` greater than `to` means the window crosses midnight — a late-night
/// promotion is a real thing and wrapping is not an error.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeWindow {
    pub from_minute: u32,
    pub to_minute: u32,
}

impl TimeWindow {
    pub(crate) fn allows(&self, at: DateTime<Utc>) -> bool {
        let minute = at.hour() * 60 + at.minute();
        if self.from_minute <= self.to_minute {
            minute >= self.from_minute && minute < self.to_minute
        } else {
            minute >= self.from_minute || minute < self.to_minute
        }
    }
}

/// Everything that must hold before a rule may apply.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
}

impl Conditions {
    /// The checks that do not depend on what is in the basket.
    pub(crate) fn window_allows(
        &self,
        at: DateTime<Utc>,
        offset_minutes: i32,
    ) -> Option<RejectionReason> {
        let here = local(at, offset_minutes);
        if self.effective_from.is_some_and(|from| at < from) {
            return Some(RejectionReason::NotStarted);
        }
        if self.effective_to.is_some_and(|to| at >= to) {
            return Some(RejectionReason::Expired);
        }
        if !self.days.allows(here) {
            return Some(RejectionReason::DayNotAllowed);
        }
        if self.time_window.is_some_and(|window| !window.allows(here)) {
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
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
}

impl Caps {
    pub(crate) fn allows(&self) -> Option<RejectionReason> {
        if self
            .budget
            .is_some_and(|budget| self.spent.minor >= budget.minor)
        {
            return Some(RejectionReason::BudgetSpent);
        }
        if self.max_uses.is_some_and(|max| self.used >= max) {
            return Some(RejectionReason::UsageExhausted);
        }
        None
    }

    /// What is left in the budget, if there is one.
    ///
    /// Public because a promotions board says it out loud — "Rp 4.2jt left of
    /// this campaign" is the number a manager reads before deciding whether to
    /// push an offer. Same caveat as the rest of `Caps`: it is as fresh as the
    /// last sync.
    pub fn remaining(&self) -> Option<Money> {
        self.budget
            .map(|budget| Money::new(budget.minor - self.spent.minor).floor_at_zero())
    }
}

/// How a rule behaves in the company of others.
///
/// Three states, and only three. The shape this was ported from spells them
/// with two independent booleans, which can express a fourth combination that
/// means nothing — "exclusive, but also stacks with others".
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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

/// How much of the basket a rule that will not share actually claims.
///
/// [`Stacking`] says an offer applies on its own. This says what "on its own"
/// is measured over, and it is read for any rule that is not
/// [`Stackable`](Stacking::Stackable).
///
/// **[`Basket`](ExclusiveScope::Basket) is the default and is today's meaning**
/// — an offer that will not share shuts every other offer out of the whole
/// sale. Every rule ever published carries that reading, and defaulting the
/// other way would quietly widen offers a shop has already run: a 20%-off-shoes
/// promotion that has been suppressing a basket offer all season would start
/// letting it through, and the first anybody would hear of it is the margin.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExclusiveScope {
    /// It claims the whole sale: while it applies, nothing else does.
    #[default]
    Basket,
    /// It claims only the lines its own benefit lands on. Another offer may
    /// still work on the rest of the basket — measured over the rest, and
    /// landing on the rest.
    ///
    /// Both halves, for the reason [`MarkdownPolicy::Exclude`] excludes both:
    /// an offer allowed to COUNT a claimed line toward its threshold but not to
    /// discount it would qualify on goods it is then not permitted to touch.
    Line,
}

/// Whether a promotion may land on goods that are already marked down.
///
/// **Excluded by default**, which is the locked V1 rule and the one a shop
/// means when it says "not valid on sale items". A markdown has already given
/// margin away; a promotion on top gives away a second slice of what is left,
/// and the two were authored by different people for different reasons.
///
/// `Allow` is the deliberate exception — a clearance event where the point IS
/// to stack — and it has to be said out loud, because the failure mode of the
/// other default is silent: nobody notices the offers compounding until the
/// margin report lands.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MarkdownPolicy {
    /// A line whose price came from a markdown is not matched at all — so it
    /// takes no benefit AND does not count toward this rule's minimum spend.
    /// Both halves matter: a rule that ignored a cleared line for the discount
    /// but counted it toward the threshold would qualify on goods it refuses
    /// to discount.
    #[default]
    Exclude,
    Allow,
}

/// Whether a rule is live.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
    /// The shops it runs in. Empty is everywhere.
    ///
    /// Shared the way the window above is shared, and enforced the same way:
    /// both the campaign's list and the rule's own bind, and what a shop gets
    /// is the intersection. A campaign across thirteen shops holding a student
    /// offer named for six gives six.
    ///
    /// `#[serde(default)]` is load-bearing rather than tidy. Every book
    /// published before this field existed is still in force in some shop, and
    /// an empty set is exactly what those books meant: nothing narrowed.
    #[serde(default)]
    pub site_ids: BTreeSet<String>,
    /// Shared across every rule in the campaign.
    #[serde(default)]
    pub caps: Caps,
}

/// What tax a category of goods carries, and whether the shelf price already
/// contains it.
///
/// Published with the price book and frozen with it, so a sale from March is
/// still explainable in November after a rate changes. The engine reads it; it
/// does not decide it.
///
/// **`inclusive` is the whole of the difference.** Indonesian retail prices are
/// quoted with PPN in them, so the honest reading of a 110.000 shelf ticket at
/// 10% is 100.000 of goods and 10.000 of tax — the shopper pays 110.000 either
/// way. Read the same ticket as exclusive and the shopper is charged 121.000.
/// Getting this backwards is not a rounding difference, it is an eleven per
/// cent one, which is why it travels with the rate rather than being assumed.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaxRule {
    pub tax_category: String,
    /// Basis points. 1100 is 11%.
    pub rate_bps: i64,
    /// Whether the price the shopper sees already contains this tax.
    #[serde(default)]
    pub inclusive: bool,
}

/// One promotion.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
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
    /// How many carts this may apply to **for one shopper**. `None` is the
    /// default and means no per-shopper limit, which is what every book
    /// published before this field existed says — so none of them changes.
    ///
    /// Beside [`caps`](Rule::caps) rather than inside it, and the placement is
    /// the argument. Every limit in [`Caps`] is a property of the PROMOTION and
    /// can be answered out of the snapshot, which is why `Caps` can be shared
    /// with a [`Campaign`]. This one is a property of the SHOPPER: two people
    /// in the same shop, under the same book, get different answers from it.
    /// Its count arrives on [`crate::PricingContext`] and the check lives in
    /// the gate, which is the only place the rule and the shopper are both in
    /// hand.
    ///
    /// Refused rather than ignored where the count cannot be had — see
    /// [`RejectionReason::CustomerUsageUnknown`]. A limit that silently reads
    /// nought is not a limit, and the money leaks with nothing on any screen to
    /// say so.
    #[serde(default)]
    pub max_uses_per_customer: Option<i64>,
    /// The order this rule is reached in, and the tie-break when two outcomes
    /// are worth the same. **Lower first** — decision D03.
    ///
    /// Ascending, not descending, and the direction is load-bearing rather than
    /// a preference: with `Combine`, each offer works on what the previous one
    /// left, so 20% then Rp50.000 off Rp300.000 is Rp190.000 and the reverse is
    /// Rp200.000. Whoever writes `priority` is choosing between those two
    /// numbers, and they have to know which way the field counts.
    ///
    /// Flipped from "higher wins" when D03 was locked. It cost nothing to flip:
    /// every rule published to that point carried priority nought, so no book's
    /// meaning moved.
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub stacking: Stacking,
    /// How much of the basket this rule claims when it will not share.
    ///
    /// Read only when [`stacking`](Rule::stacking) is not
    /// [`Stackable`](Stacking::Stackable) — a rule that combines with
    /// everything claims nothing, so there is nothing for this to narrow.
    ///
    /// `#[serde(default)]` is [`Basket`](ExclusiveScope::Basket), which is what
    /// the engine has always done and therefore what every book already in
    /// force means. The narrow reading has to be opted into, because widening
    /// it by default would let offers through that a published promotion has
    /// been suppressing.
    #[serde(default)]
    pub exclusive_scope: ExclusiveScope,
    /// Whether this offer lands on goods already marked down. Excluded unless
    /// the rule says otherwise — see [`MarkdownPolicy`].
    ///
    /// `#[serde(default)]` gives every book published before this field existed
    /// the excluded reading. That is a CHANGE in what those books do, and the
    /// right direction for it: they were written under a policy nobody could
    /// state, and the shop's own words for that policy are "not valid on sale
    /// items".
    #[serde(default)]
    pub markdown_policy: MarkdownPolicy,
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
    /// What this earning rate is worth on a line a better rate already won.
    ///
    /// Read only for a rule that earns at a rate. A flat bonus and a
    /// per-unit bonus ([`EarnEffect::FixedPoints`],
    /// [`EarnEffect::PointsPerQuantity`]) are additive by construction — they
    /// are not competing for a line — so there is nothing here to decide.
    ///
    /// `#[serde(default)]` is [`Highest`](PointsCombination::Highest), which is
    /// the arithmetic the engine already did: one rate wins a line and the
    /// beaten ones earn nothing. Any other default would hand out more points
    /// than the rule that is already published promised.
    #[serde(default)]
    pub points_combination: PointsCombination,
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
    /// A coupon with a cross-store use limit, presented without a hold from
    /// head office. Its count cannot be trusted from a stale edge snapshot, so
    /// the till must authorize it online first — see
    /// `PricingContext::coupon_authorizations`.
    CouponNeedsOnlineAuthorization,
    BudgetSpent,
    UsageExhausted,
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
    /// Everything it would have touched is already marked down, and it is not
    /// written to stack on a markdown.
    ///
    /// Distinct from [`NothingMatched`](Self::NothingMatched) on purpose. The
    /// two are the same fact to the engine and opposite facts to the person
    /// reading them: "nothing in the basket qualifies" sends a merchandiser
    /// looking for a scope bug while the named SKU sits right there on the
    /// screen, marked down. Naming the real cause is the difference between a
    /// rule somebody fixes and a rule somebody re-authors from scratch.
    MarkdownExcluded,
    /// This shopper has already had it as often as it allows —
    /// [`Caps::max_uses_per_customer`].
    ///
    /// Deliberately not [`UsageExhausted`](Self::UsageExhausted). That one
    /// means the promotion is finished for everybody and the right answer at
    /// the counter is "it has ended"; this one means the offer is still running
    /// and this shopper has had their turn. Giving the first answer for the
    /// second fact has a cashier telling a queue a live promotion is over.
    CustomerLimitReached,
    /// It is limited per shopper and this node cannot say how often THIS
    /// shopper has used it, so it is refused rather than given away.
    ///
    /// The count lives in `commercial_usage_customer` at the centre. A node
    /// that does not hold it — a till, which keeps no customer history at all —
    /// reads nought for every shopper, and nought means a "once per customer"
    /// offer applies on every visit to every shop, for ever. Failing closed
    /// puts that on the screen instead of into the margin.
    CustomerUsageUnknown,
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
            Self::CouponNeedsOnlineAuthorization => "this limited coupon must be authorized online",
            Self::BudgetSpent => "the promotion budget is used up",
            Self::UsageExhausted => "the promotion has reached its usage limit",
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
            Self::MarkdownExcluded => "it does not apply to goods already marked down",
            Self::CustomerLimitReached => "this shopper has already used this promotion",
            Self::CustomerUsageUnknown => {
                "this shop cannot tell how often this shopper has used it"
            }
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
