//! Resolving a basket: what matches, what it takes off, and which combination
//! the shopper actually gets.
//!
//! The order is fixed and each step depends only on the ones before it:
//!
//! 1. **Base price** — the price list cascade settles what each line costs.
//! 2. **Markdown** — replaces that base where one applies.
//! 3. **Rules** — gated, matched, then combined into the best offer.
//! 4. **Points** — accrued from the result, never competing with a discount.
//!
//! # Why combining is a search and not a loop
//!
//! Rules do not simply pile up. Some combine, some insist on applying alone,
//! and the shop's promise to the shopper is the *best* of those outcomes, not
//! the first one found. So the engine builds every permitted outcome — one
//! where all the stackable rules apply together, and one for each rule that
//! must stand alone — and takes the one that gives the most benefit.
//!
//! Ties break on priority, then rule id. Neither is meaningful in itself; both
//! exist so that two machines evaluating the same basket cannot disagree. A
//! till pricing offline and the centre reproducing that sale later must reach
//! the same number, and "whichever the loop happened to reach first" is not a
//! rule two machines can both follow.
//!
//! Nothing here ever fails at the counter. A rule that cannot apply is recorded
//! with a reason and set aside; a conflict between two rules is decided, not
//! raised. A cashier's screen is the wrong place to discover that two people in
//! head office authored contradictory promotions.

use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

use crate::money::{Currency, Money};
use crate::price::{PriceIndex, PriceLevel};
use crate::rule::{
    Applicability, CampaignStatus, Coupon, CustomerScope, EarnBasis, EarnEffect, Effect,
    ExclusiveScope, MarkdownPolicy, PointsCombination, RejectionReason, Rule, RuleStatus, Stacking,
    TaxRule,
};
use crate::{
    AppliedRule, CartLine, ChargeResult, EarnAward, FreeLine, LinePoints, LineResult, PriceSource,
    PricingContext, PricingError, PricingResult, PricingSnapshot, RejectedRule,
};

/// One cart line, once the base price and any markdown have settled.
struct LineState {
    sku_code: String,
    article_code: Option<String>,
    division: Option<String>,
    tags: Vec<String>,
    quantity: i64,
    /// Before markdown — what the price list said.
    list_unit_price: Money,
    /// After markdown — what the item now costs.
    unit_price: Money,
    gross_total: Money,
    markdown_id: Option<String>,
    source: PriceSource,
    currency: Currency,
    tax_category: String,
    publication_version: i64,
}

/// A rule that passed every check and is ready to be scored.
struct Candidate<'a> {
    rule: &'a Rule,
    /// The lines that triggered it. Conditions were checked against these.
    matched: Vec<usize>,
    /// The lines its discount lands on. The same as `matched`, unless the rule
    /// sends the benefit somewhere else.
    effect: Vec<usize>,
    /// The most this rule may take off this basket: its own per-cart cap, what
    /// is left of its own budget, and what is left of its campaign's.
    ///
    /// Worked out while gating, because that is where the campaign is already
    /// in hand. `None` is unbounded.
    ceiling: Option<Money>,
    /// The shared campaign budget before this scenario starts. Its remaining
    /// value is tracked as each rule is applied, because every candidate in
    /// one basket must spend from the same envelope.
    campaign_budget_remaining: Option<Money>,
    /// Campaign uses available before this scenario starts. Uses continue to
    /// count per applied rule, matching the usage ledger.
    campaign_uses_remaining: Option<i64>,
}

struct Gate {
    ceiling: Option<Money>,
    campaign_budget_remaining: Option<Money>,
    campaign_uses_remaining: Option<i64>,
}

/// One permitted outcome: what each line would come to, and what that is worth
/// to the shopper.
struct Scenario {
    totals: Vec<Money>,
    free: Vec<FreeLine>,
    applied: Vec<AppliedRule>,
    benefit: Money,
    /// Every applied rule as `(priority, id)`, sorted — the tie-break between
    /// two outcomes worth the same money.
    ///
    /// The whole sorted list rather than a highest-and-lowest summary, because
    /// D03 breaks a tie on the list read lexicographically and two outcomes can
    /// share a top priority and a first id while differing further down. A
    /// summary would then leave the winner to whichever was tried first, which
    /// is the arbitrariness the tie-break exists to remove.
    shape: Vec<(i64, String)>,
    /// Rules that were eligible when the basket was scanned and no longer were
    /// by the time this outcome reached them, with the reason.
    ///
    /// Kept because "it was outbid" and "it stopped qualifying" are different
    /// conversations at the counter, and only one of them is true. A basket
    /// offer asking for 500.000 that an earlier line offer took below 500.000
    /// was not beaten by anything — the basket simply got smaller.
    lapsed: Vec<(String, RejectionReason)>,
}

impl Scenario {
    fn empty(states: &[LineState]) -> Self {
        Self {
            totals: states.iter().map(|state| state.gross_total).collect(),
            free: Vec::new(),
            applied: Vec::new(),
            benefit: Money::ZERO,
            shape: Vec::new(),
            lapsed: Vec::new(),
        }
    }

    fn note(&mut self, rule: &Rule) {
        self.shape.push((rule.priority, rule.rule_id.clone()));
        self.shape.sort();
    }

    /// More benefit wins. Where two outcomes are worth the same, the smaller
    /// `(priority, id)` list read lexicographically wins — decision D03.
    ///
    /// "More benefit" and "cheapest basket" are the same statement here: every
    /// scenario prices the same cart, so the one that took most off is the one
    /// that leaves least to pay.
    fn beats(&self, other: &Self) -> bool {
        match self.benefit.minor.cmp(&other.benefit.minor) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Less => false,
            // Equal money: the smaller shape, which is total and deterministic
            // and does not depend on the order the scenarios were tried in.
            std::cmp::Ordering::Equal => self.shape < other.shape,
        }
    }
}

/// Name the level a price came from, so a receipt can say where it got it.
fn source_of(level: &PriceLevel) -> PriceSource {
    match level {
        PriceLevel::Site { .. } => PriceSource::SitePrice,
        PriceLevel::SiteGroup { .. } => PriceSource::SiteGroupPrice,
        PriceLevel::Company => PriceSource::CompanyPrice,
    }
}

/// Order rules for APPLICATION: line offers first, then basket offers, then
/// priority down, then id up.
///
/// The first term is new and it is the whole of the locked rule "line promotion
/// is evaluated before basket promotion". It has to be first, ahead of
/// priority, because a basket rule with a high priority would otherwise be
/// measured against ticket prices — which is the bug this ordering exists to
/// prevent, not a preference about which offer wins.
fn application_order(rule: &Rule) -> (bool, i64, &str) {
    let (priority, id) = selection_order(rule);
    (is_basket_rule(rule), priority, id)
}

/// Order rules: priority ASCENDING, then id ascending — decision D03.
///
/// Lower priority is reached first. See `Rule::priority`: with `Combine` the
/// order decides the money, so the direction is part of the contract rather
/// than an implementation detail.
fn selection_order(rule: &Rule) -> (i64, &str) {
    (rule.priority, rule.rule_id.as_str())
}

// ---------------------------------------------------------------------------
// Step 1 and 2: base price and markdown
// ---------------------------------------------------------------------------

fn settle_lines(
    index: &PriceIndex<'_>,
    context: &PricingContext,
    cart: &[CartLine],
) -> Result<Vec<LineState>, PricingError> {
    let mut states = Vec::with_capacity(cart.len());
    let mut currency: Option<Currency> = None;

    for line in cart {
        if line.quantity <= 0 {
            return Err(PricingError::NonPositiveQuantity {
                sku_code: line.sku_code.clone(),
            });
        }
        let entry = index
            .price(context, &line.sku_code)
            .ok_or_else(|| PricingError::NoPrice {
                sku_code: line.sku_code.clone(),
                site_id: context.site_id.clone(),
                channel: context.channel.clone(),
            })?;
        if !entry.sellable {
            return Err(PricingError::NotSellable {
                sku_code: line.sku_code.clone(),
                site_id: context.site_id.clone(),
                channel: context.channel.clone(),
            });
        }
        match &currency {
            None => currency = Some(entry.currency.clone()),
            Some(seen) if *seen != entry.currency => {
                return Err(PricingError::MixedCurrency {
                    left: seen.0.clone(),
                    right: entry.currency.0.clone(),
                });
            }
            Some(_) => {}
        }

        // Clearance replaces the list price; nothing overrides clearance.
        //
        // There used to be a third case above these two: a price typed in by
        // hand, which beat the book and every markdown in it. It was reachable
        // only from `simulate` — no till could produce one — so the simulator
        // was the only screen in the business that could answer with a price no
        // counter would ever charge. A supervisor override is a real thing a
        // shop needs, and when it is built it needs an authorisation trail and
        // a route at the till; it does not need to exist in the engine first.
        let markdown = index.markdown(context, line);
        let (unit_price, source, markdown_id) = match markdown {
            Some(markdown) => (
                markdown.replacement_unit_price,
                PriceSource::Markdown,
                Some(markdown.markdown_id.clone()),
            ),
            None => (entry.unit_price, source_of(&entry.applies_to), None),
        };

        states.push(LineState {
            sku_code: line.sku_code.clone(),
            article_code: line.article_code.clone(),
            division: line.division.clone(),
            tags: line.tags.clone(),
            quantity: line.quantity,
            list_unit_price: entry.unit_price,
            unit_price,
            gross_total: unit_price.times(line.quantity)?,
            markdown_id,
            source,
            currency: entry.currency.clone(),
            tax_category: entry.tax_category.clone(),
            publication_version: entry.publication_version,
        });
    }
    Ok(states)
}

// ---------------------------------------------------------------------------
// Step 3a: gating — the checks that do not look in the basket
// ---------------------------------------------------------------------------

/// The same gate, for a caller with no basket.
///
/// A shelf, a poster and a promotions screen all have to say what a shop is
/// running before anybody has picked anything up, and the only honest source
/// for that is the check the till itself will apply. Reimplementing it beside
/// the screen is how a window shows an offer the counter then refuses.
///
/// The discount ceiling it works out is dropped: without a basket there is
/// nothing to apply it to, and a number that cannot be checked has no business
/// on a screen.
pub(crate) fn standing(
    rule: &Rule,
    snapshot: &PricingSnapshot,
    context: &PricingContext,
) -> Result<(), RejectionReason> {
    gate(rule, snapshot, context).map(|_| ())
}

/// Whether a rule may run at all, and the most it may give away if it does.
///
/// The two are decided together because both need the campaign, and looking it
/// up twice is how the two answers come to disagree.
fn gate(
    rule: &Rule,
    snapshot: &PricingSnapshot,
    context: &PricingContext,
) -> Result<Gate, RejectionReason> {
    if rule.status != RuleStatus::Active {
        return Err(RejectionReason::NotActive);
    }
    if let Some(reason) = rule
        .conditions
        .window_allows(context.at, context.utc_offset_minutes)
    {
        return Err(reason);
    }
    // A rule is live only when its campaign is. Both must say yes, so pausing
    // the campaign pauses everything inside it — which is what somebody means
    // by "stop the Lebaran promo", and what stops one offer being left running.
    let campaign = match &rule.campaign_id {
        None => None,
        Some(campaign_id) => {
            let Some(found) = snapshot
                .campaigns
                .iter()
                .find(|campaign| campaign.campaign_id == *campaign_id)
            else {
                // The rule belongs to a promotion this node knows nothing
                // about, so it fails closed. The alternative is worse than it
                // looks: an unknown campaign would leave the rule with no
                // envelope at all, and pausing that campaign at the centre
                // would stop it everywhere except the shops that never received
                // it — the ones most likely to be out of date already.
                return Err(RejectionReason::CampaignUnknown);
            };
            Some(found)
        }
    };
    if let Some(campaign) = campaign {
        if campaign.status != CampaignStatus::Active {
            return Err(RejectionReason::NotActive);
        }
        if campaign.valid_from.is_some_and(|from| context.at < from) {
            return Err(RejectionReason::NotStarted);
        }
        if campaign.valid_to.is_some_and(|to| context.at >= to) {
            return Err(RejectionReason::Expired);
        }
        // The campaign's shops bind before the rule's own, and for the same
        // reason its window does: a rule inside a campaign is running where
        // BOTH say it runs. A rule that names no shop of its own inherits the
        // campaign's list rather than meaning "everywhere", which is what makes
        // the campaign a shared constraint instead of a label.
        if !campaign.site_ids.is_empty() && !campaign.site_ids.contains(&context.site_id) {
            return Err(RejectionReason::WrongSite);
        }
    }
    if !rule.scope.site_ids.is_empty() && !rule.scope.site_ids.contains(&context.site_id) {
        return Err(RejectionReason::WrongSite);
    }
    if !rule.scope.channels.is_empty() && !rule.scope.channels.contains(&context.channel) {
        return Err(RejectionReason::WrongChannel);
    }
    match &rule.scope.customers {
        CustomerScope::Everyone => {}
        CustomerScope::Members => {
            if context.customer_id.is_none() {
                return Err(RejectionReason::NotThisCustomer);
            }
        }
    }
    if let Some(code) = &rule.coupon_code {
        if let Some(reason) = check_coupon(code, rule, snapshot, context) {
            return Err(reason);
        }
    }
    if let Some(reason) = rule.caps.allows() {
        return Err(reason);
    }
    if let Some(reason) = customer_cap(rule, context) {
        return Err(reason);
    }
    // The campaign's shared caps, checked after the rule's own. Five offers
    // that are one promotion to the business spend one budget between them.
    if let Some(campaign) = campaign {
        if let Some(reason) = campaign.caps.allows() {
            return Err(reason);
        }
    }

    // The per-rule ceiling is fixed for this one application. Campaign caps
    // are also retained separately: stackable candidates share their live
    // remainder inside `run_scenario`, so a later offer cannot reuse what an
    // earlier offer spent.
    Ok(Gate {
        ceiling: tighter(rule.max_discount, rule.caps.remaining()),
        campaign_budget_remaining: campaign.and_then(|campaign| campaign.caps.remaining()),
        campaign_uses_remaining: campaign.and_then(|campaign| {
            campaign
                .caps
                .max_uses
                .map(|max| max.saturating_sub(campaign.caps.used).max(0))
        }),
    })
}

/// The one limit a rule cannot answer out of its own document.
///
/// Every cap in [`crate::Caps`] is a property of the promotion — how much it
/// has given away, how many baskets it has been on — and the snapshot carries
/// it. [`Rule::max_uses_per_customer`] is a property of the person at the
/// counter, so it is answered from the context, and there are three ways it can
/// go wrong before it can go right:
///
/// 1. **Nobody was identified.** A limit counted per shopper cannot be kept for
///    a shopper with no name, so the offer is members-only in effect, and
///    saying so is the honest reading of what the author wrote.
/// 2. **This node keeps no customer history.** Refused, not waved through —
///    see [`RejectionReason::CustomerUsageUnknown`]. An empty count is
///    indistinguishable from a shopper who has never used it, and a limit that
///    reads nought for everybody is not a limit.
/// 3. **They have had their turn.** Which is the case the field was written
///    for.
fn customer_cap(rule: &Rule, context: &PricingContext) -> Option<RejectionReason> {
    let limit = rule.max_uses_per_customer?;
    if context.customer_id.is_none() {
        return Some(RejectionReason::NotThisCustomer);
    }
    let Some(history) = &context.customer_history else {
        return Some(RejectionReason::CustomerUsageUnknown);
    };
    if history.get(&rule.rule_id).copied().unwrap_or(0) >= limit {
        return Some(RejectionReason::CustomerLimitReached);
    }
    None
}

/// A coupon must be presented, known, live, in date, unspent, and — when it was
/// issued to somebody — held by that somebody.
fn check_coupon(
    code: &str,
    rule: &Rule,
    snapshot: &PricingSnapshot,
    context: &PricingContext,
) -> Option<RejectionReason> {
    if !context.coupon_codes.iter().any(|given| given == code) {
        return Some(RejectionReason::NoCoupon);
    }
    let Some(coupon) = snapshot.coupons.iter().find(|c| c.code == code) else {
        return Some(RejectionReason::CouponUnknown);
    };
    if coupon.rule_id != rule.rule_id {
        // The code exists but opens a different door.
        return Some(RejectionReason::CouponUnknown);
    }
    if !coupon.active {
        return Some(RejectionReason::CouponNotActive);
    }
    if coupon.valid_from.is_some_and(|from| context.at < from)
        || coupon.valid_to.is_some_and(|to| context.at >= to)
    {
        return Some(RejectionReason::CouponExpired);
    }
    if coupon.max_uses.is_some_and(|max| coupon.used >= max) {
        return Some(RejectionReason::CouponUsedUp);
    }
    // This legacy publication has no per-code authorization/reservation in the
    // till. A finite global count read from the last sync is not safe under
    // concurrent sales at different shops, so fail closed until redemption is
    // routed through the cloud CouponSet lifecycle.
    if coupon.max_uses.is_some() {
        return Some(RejectionReason::CouponNeedsOnlineAuthorization);
    }
    match (&coupon.customer_id, &context.customer_id) {
        (Some(owner), Some(shopper)) if owner == shopper => {}
        (Some(_), _) => return Some(RejectionReason::CouponBelongsToSomeoneElse),
        (None, _) => {}
    }
    None
}

// ---------------------------------------------------------------------------
// Step 3b: matching and conditions
// ---------------------------------------------------------------------------

fn matches_scope(
    applicability: Option<&Applicability>,
    excluded: &BTreeSet<String>,
    state: &LineState,
) -> bool {
    // Exclusion is checked first and is absolute: the field exists to carve
    // holes in a broad rule, and a hole something else can fill is not a hole.
    if excluded.contains(&state.sku_code) {
        return false;
    }
    match applicability {
        None | Some(Applicability::WholeCart) => true,
        Some(Applicability::Sku { sku_codes }) => sku_codes.contains(&state.sku_code),
        Some(Applicability::Article { article_codes }) => state
            .article_code
            .as_ref()
            .is_some_and(|article| article_codes.contains(article)),
        Some(Applicability::Division { divisions }) => state
            .division
            .as_ref()
            .is_some_and(|division| divisions.contains(division)),
        Some(Applicability::Tag { tags }) => state.tags.iter().any(|tag| tags.contains(tag)),
    }
}

fn match_lines(rule: &Rule, states: &[LineState]) -> Vec<usize> {
    states
        .iter()
        .enumerate()
        .filter(|(_, state)| {
            // Cleared goods are out unless the rule says otherwise, and they
            // are out of the MATCH rather than out of the benefit — so a
            // marked-down line neither takes the discount nor counts toward the
            // minimum spend that unlocks it. Excluding it from only one of the
            // two would let a rule qualify on goods it then refuses to touch.
            if rule.markdown_policy == MarkdownPolicy::Exclude && state.markdown_id.is_some() {
                return false;
            }
            matches_scope(
                rule.scope.applicability.as_ref(),
                &rule.scope.excluded_sku_codes,
                state,
            )
        })
        .map(|(index, _)| index)
        .collect()
}

/// Why a rule matched nothing, in terms of the thing that actually stopped it.
///
/// Called only once the match has already come back empty, so the second pass
/// costs nothing on the path that works. It asks the one question the first
/// pass threw away: would this rule have found lines if the markdown gate were
/// open? If so, the markdown is the answer and saying "nothing in the basket
/// qualifies" is a lie by omission — the basket is full of exactly what the
/// rule names, and every piece of it is on sale.
fn empty_match_reason(rule: &Rule, states: &[LineState]) -> RejectionReason {
    if rule.markdown_policy == MarkdownPolicy::Exclude
        && states.iter().any(|state| {
            state.markdown_id.is_some()
                && matches_scope(
                    rule.scope.applicability.as_ref(),
                    &rule.scope.excluded_sku_codes,
                    state,
                )
        })
    {
        return RejectionReason::MarkdownExcluded;
    }
    RejectionReason::NothingMatched
}

/// The lines a rule's discount lands on.
///
/// Usually the ones that triggered it. When the rule names a separate effect
/// scope — "buy a suit, get 50% off a shirt" — the conditions have already been
/// checked against the suits and the money now comes off the shirts.
fn effect_lines(rule: &Rule, states: &[LineState], matched: &[usize]) -> Vec<usize> {
    let Some(elsewhere) = &rule.scope.effect_on else {
        return matched.to_vec();
    };
    states
        .iter()
        .enumerate()
        .filter(|(_, state)| matches_scope(Some(elsewhere), &rule.scope.excluded_sku_codes, state))
        .map(|(index, _)| index)
        .collect()
}

/// The checks that cannot change once the basket is fixed.
///
/// Quantity is one of them: no discount removes an item. The money thresholds
/// are NOT — a line discount applied earlier in the same basket lowers what a
/// later rule is measured against — so they are re-checked per scenario in
/// [`check_amount`], and only the safe half of them is pruned here.
///
/// `min_amount` against the gross total is a valid prune and not a duplicate:
/// running totals only ever fall, so a rule that cannot reach its minimum at
/// full price can never reach it after a discount. `max_amount` is deliberately
/// absent — a basket too dear for a rule at full price may be inside its ceiling
/// once earlier offers have come off, and pruning it here would drop a rule that
/// should have applied.
fn check_conditions(
    rule: &Rule,
    matched: &[usize],
    states: &[LineState],
) -> Result<Option<RejectionReason>, PricingError> {
    let conditions = &rule.conditions;
    let mut quantity = 0_i64;
    let mut amount = Money::ZERO;
    for &index in matched {
        quantity = quantity
            .checked_add(states[index].quantity)
            .ok_or(PricingError::AmountOverflow)?;
        amount = amount.try_add(states[index].gross_total)?;
    }
    if quantity < conditions.min_quantity {
        return Ok(Some(RejectionReason::QuantityTooLow));
    }
    if conditions.max_quantity.is_some_and(|max| quantity > max) {
        return Ok(Some(RejectionReason::QuantityTooHigh));
    }
    if amount.minor < conditions.min_amount.minor {
        return Ok(Some(RejectionReason::AmountTooLow));
    }
    Ok(None)
}

/// The money thresholds, against what the basket has come to SO FAR.
///
/// "The basket has to reach Rp 500.000" is a question about the basket at the
/// moment this rule is reached, not about the ticket price of what is in it.
/// A twenty-per-cent line offer that takes a 600.000 basket to 480.000 has
/// genuinely put it below a 500.000 threshold, and a shop that charged the
/// basket offer anyway would be giving away money it said it would not.
///
/// This is what makes the order in [`run_scenario`] load-bearing: line offers
/// are applied before basket offers precisely so that a basket threshold is
/// measured after them.
fn check_amount(
    rule: &Rule,
    matched: &[usize],
    totals: &[Money],
) -> Result<Option<RejectionReason>, PricingError> {
    let conditions = &rule.conditions;
    let mut amount = Money::ZERO;
    for &index in matched {
        amount = amount.try_add(totals[index])?;
    }
    if amount.minor < conditions.min_amount.minor {
        return Ok(Some(RejectionReason::AmountTooLow));
    }
    if conditions
        .max_amount
        .is_some_and(|max| amount.minor > max.minor)
    {
        return Ok(Some(RejectionReason::AmountTooHigh));
    }
    Ok(None)
}

/// Whether a rule is about the basket rather than about the things in it.
///
/// The distinction decides ORDER, and order decides money: a rule scoped to the
/// sale itself is measured against whatever the lines have come to, so every
/// line offer has to have been applied before it is reached. A rule that names
/// products is a line rule however its benefit is shaped.
fn is_basket_rule(rule: &Rule) -> bool {
    match &rule.scope.applicability {
        None => true,
        Some(Applicability::WholeCart) => true,
        Some(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Step 3c: effects
// ---------------------------------------------------------------------------

/// The smaller of two ceilings, where absent means unbounded.
fn tighter(left: Option<Money>, right: Option<Money>) -> Option<Money> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.at_most(right)),
        (Some(only), None) | (None, Some(only)) => Some(only),
        (None, None) => None,
    }
}

/// One unit of stock, considered on its own for a bundle.
///
/// A bundle is counted in units and a cart line is not one: a line of four is
/// four candidates, three of which may be buyers while the fourth is left over.
/// Nothing else in the engine needs this view, which is why it is built for the
/// bundle and thrown away again rather than replacing [`LineState`].
struct BundleUnit {
    line: usize,
    /// Where in its line this unit sits. With `line` it is the stable id D01
    /// breaks price ties on, and it is what makes the choice reproducible on
    /// two machines instead of merely plausible on one.
    position: i64,
    /// What this unit costs RIGHT NOW — after markdown and after any promotion
    /// already applied in this scenario, never the list price. A bundle that
    /// compared ticket prices would rank a deeply marked-down unit as the dear
    /// one and make it a buyer.
    amount: Money,
}

/// Expand the eligible lines into the units a bundle chooses between.
///
/// A line's running total is split evenly across its units with the odd minor
/// unit going to the earliest, so the parts still sum to exactly the line and
/// no unit is invented at a price the line never had.
///
/// Units worth nothing are left out. D01's pool is the positive-value units,
/// and a unit an earlier promotion already took to nought would otherwise be
/// picked as the cheapest reward — spending the bundle on a unit that costs
/// nothing, and giving the shopper an offer that takes nothing off.
fn bundle_pool(matched: &[usize], states: &[LineState], totals: &[Money]) -> Vec<BundleUnit> {
    let mut pool = Vec::new();
    for &line in matched {
        let quantity = states[line].quantity;
        // Quantity is guarded because the split divides by it. `settle_lines`
        // refuses a non-positive one, so this is unreachable rather than
        // expected — but a division is the wrong place to rely on a guarantee
        // made three steps earlier.
        if quantity <= 0 || !totals[line].is_positive() {
            continue;
        }
        let each = totals[line].minor / quantity;
        let odd = totals[line].minor % quantity;
        for position in 0..quantity {
            let amount = Money::new(each + i64::from(position < odd));
            if amount.is_positive() {
                pool.push(BundleUnit {
                    line,
                    position,
                    amount,
                });
            }
        }
    }
    pool
}

/// Choose the units a bundle uses, as positions in `pool`: `(rewards, buyers)`.
///
/// D01's order, and the order matters. The `g x get` CHEAPEST units are taken
/// as rewards first, and only then are the `g x buy` DEAREST of what is left
/// taken as buyers. Choosing buyers first would let the dearest unit be a buyer
/// and the second-dearest a reward, which prices the offer at the shop's
/// expense on every mixed basket.
///
/// `None` when the pool does not fill one whole bundle: three units under a
/// "buy two get two" is not a partial bundle, it is no bundle.
fn bundle_participants(
    pool: &[BundleUnit],
    buy: i64,
    get: i64,
) -> Option<(Vec<usize>, Vec<usize>)> {
    let buy = usize::try_from(buy).ok().filter(|count| *count > 0)?;
    let get = usize::try_from(get).ok().filter(|count| *count > 0)?;
    let groups = pool.len() / buy.checked_add(get)?;
    if groups == 0 {
        return None;
    }

    // Both comparators end on the stable unit id, so each is a TOTAL order over
    // the pool. Ordering on price alone would leave two identically priced
    // units to be separated by whatever order the sort happened to receive
    // them in — and which of the two is a reward decides what a refund of
    // either pays back.
    let mut cheapest: Vec<usize> = (0..pool.len()).collect();
    cheapest.sort_by_key(|&unit| (pool[unit].amount, pool[unit].line, pool[unit].position));
    let rewards: Vec<usize> = cheapest.iter().copied().take(groups * get).collect();

    let mut buyers: Vec<usize> = cheapest.into_iter().skip(groups * get).collect();
    buyers.sort_by(|left, right| {
        pool[*right].amount.cmp(&pool[*left].amount).then(
            (pool[*left].line, pool[*left].position)
                .cmp(&(pool[*right].line, pool[*right].position)),
        )
    });
    buyers.truncate(groups * buy);
    Some((rewards, buyers))
}

/// Apportion `total` across `weights` so the parts sum to exactly `total`,
/// handing the minor units that flooring dropped to the LARGEST fractional
/// remainders first, ties to the earlier position.
///
/// Deliberately not the spread [`Effect::Amount`] uses, which gives the whole
/// remainder to the last participant. Both sum to the whole, so no total ever
/// disagrees; they differ only in who is owed the odd rupiah. On a flat cart
/// discount that is a rounding detail, and on a bundle it is not — a refund
/// reads a unit's own allocation, and "the last one the sort reached" is not a
/// rule two machines can both follow. D01 names largest-remainder for that
/// reason, and `Amount` keeps its own because a frozen fixture pins it.
///
/// `weights` must be non-negative; the bundle pool is filtered to positive
/// units before it reaches here.
fn spread_by_largest_remainder(
    total: Money,
    weights: &[Money],
) -> Result<Vec<Money>, PricingError> {
    let mut basis = Money::ZERO;
    for weight in weights {
        basis = basis.try_add(*weight)?;
    }
    if basis.minor <= 0 {
        return Ok(vec![Money::ZERO; weights.len()]);
    }

    let mut shares = Vec::with_capacity(weights.len());
    let mut handed_out = Money::ZERO;
    let mut by_remainder: Vec<(i64, usize)> = Vec::with_capacity(weights.len());
    for (position, weight) in weights.iter().enumerate() {
        // `Money::share_of`'s arithmetic, written out because this needs the
        // half that method discards: the remainder is the whole of the
        // tie-break, and a floor has already thrown it away.
        let exact = total
            .minor
            .checked_mul(weight.minor)
            .ok_or(PricingError::AmountOverflow)?;
        let share = Money::new(exact / basis.minor);
        handed_out = handed_out.try_add(share)?;
        shares.push(share);
        by_remainder.push((exact % basis.minor, position));
    }

    by_remainder.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    let mut leftover = total.try_sub(handed_out)?.minor;
    for (_, position) in by_remainder {
        if leftover <= 0 {
            break;
        }
        shares[position] = shares[position].try_add(Money::new(1))?;
        leftover -= 1;
    }
    Ok(shares)
}

/// Apply one rule's price effect to the running totals, returning what it took
/// off. Zero means the rule earned its place in no scenario.
fn apply_price_effect(
    rule: &Rule,
    matched: &[usize],
    states: &[LineState],
    totals: &mut [Money],
    ceiling: Option<Money>,
) -> Result<(Money, Vec<crate::LineBenefit>), PricingError> {
    let mut cuts: Vec<(usize, Money)> = Vec::with_capacity(matched.len());

    match &rule.effect {
        Effect::Percent { bps, compound } => {
            for &index in matched {
                // Off the original line total unless the rule says otherwise,
                // so two stacked ten-per-cents come to twenty. The cut is then
                // capped at what is actually left, or two deep discounts would
                // between them take more off a line than the line costs.
                let basis = if *compound {
                    totals[index]
                } else {
                    states[index].gross_total
                };
                cuts.push((index, basis.basis_points(*bps)?.at_most(totals[index])));
            }
        }
        Effect::Amount { amount } => {
            // Spread across the matched lines by value, so a flat "Rp 50,000
            // off" is fifty thousand once, not once per line. The remainder
            // goes to the last line, which is the only way the parts can sum to
            // exactly the whole.
            let mut basis = Money::ZERO;
            for &index in matched {
                basis = basis.try_add(totals[index])?;
            }
            let capped = amount.at_most(basis);
            let mut handed_out = Money::ZERO;
            for (position, &index) in matched.iter().enumerate() {
                let cut = if position + 1 == matched.len() {
                    capped.try_sub(handed_out)?
                } else {
                    capped.share_of(totals[index], basis)?
                };
                handed_out = handed_out.try_add(cut)?;
                cuts.push((index, cut));
            }
        }
        Effect::FixedUnitPrice { unit_price } => {
            for &index in matched {
                let replaced = unit_price.times(states[index].quantity)?;
                cuts.push((index, totals[index].try_sub(replaced)?.floor_at_zero()));
            }
        }
        Effect::BuyXGetY {
            buy,
            get,
            reward_bps,
        } => {
            let pool = bundle_pool(matched, states, totals);
            let Some((rewards, buyers)) = bundle_participants(&pool, *buy, *get) else {
                return Ok((Money::ZERO, Vec::new()));
            };

            // What the rewarded units are worth is what the bundle gives away.
            // Leftover units are not in either list and so are not weighed
            // here — D01's whole point, and the reason a fourth shirt under a
            // "buy two get one" is charged in full.
            let mut given = Money::ZERO;
            for &unit in &rewards {
                given = given.try_add(pool[unit].amount.basis_points(*reward_bps)?)?;
            }

            // Buyers and rewards share one allocation and are put back into
            // stable unit order to receive it. The spread below breaks a tie on
            // the position it is handed, so that ordering is what makes "ties
            // go to the lower line index" true rather than incidental.
            let mut participants: Vec<usize> =
                buyers.iter().chain(rewards.iter()).copied().collect();
            participants.sort_by_key(|&unit| (pool[unit].line, pool[unit].position));
            let weights: Vec<Money> = participants.iter().map(|&unit| pool[unit].amount).collect();
            let mut gross = Money::ZERO;
            for weight in &weights {
                gross = gross.try_add(*weight)?;
            }

            // Capping the whole is what makes D01's per-unit cap automatic: a
            // share of a total no larger than the participants' own amounts
            // cannot come out above the amount it is a share of. Capping each
            // part instead would break the one property the spread has, which
            // is that the parts come to exactly the whole.
            let shares = spread_by_largest_remainder(given.at_most(gross), &weights)?;

            // Folded back onto lines, one entry per line. A unit is this
            // function's own fiction; a refund reads the LINE's allocation, and
            // two rows for one line are two answers to one question.
            let mut per_line: BTreeMap<usize, Money> = BTreeMap::new();
            for (position, &unit) in participants.iter().enumerate() {
                let running = per_line.entry(pool[unit].line).or_insert(Money::ZERO);
                *running = running.try_add(shares[position])?;
            }
            cuts.extend(per_line);
        }
        // Handled elsewhere: a free item adds a line rather than cutting one,
        // and points carry no price benefit at all.
        Effect::FreeItem { .. } | Effect::EarnPoints(_) => return Ok((Money::ZERO, Vec::new())),
    }

    // Trim to the rule's ceiling before anything is applied, so a capped rule
    // reduces the basket by exactly its cap and not a rounding step more.
    let mut total_cut = Money::ZERO;
    for (_, cut) in &cuts {
        total_cut = total_cut.try_add(*cut)?;
    }
    if let Some(ceiling) = ceiling {
        if total_cut.minor > ceiling.minor {
            let mut budget = ceiling;
            for (_, cut) in cuts.iter_mut() {
                let allowed = cut.at_most(budget);
                *cut = allowed;
                budget = budget.try_sub(allowed)?;
            }
            total_cut = ceiling;
        }
    }

    let mut landed = Vec::with_capacity(cuts.len());
    for (index, cut) in cuts {
        if cut.is_positive() {
            totals[index] = totals[index].try_sub(cut)?.floor_at_zero();
            landed.push(crate::LineBenefit {
                line: index,
                benefit: cut,
            });
        }
    }
    // The per-line breakdown, returned rather than summed away.
    //
    // It was computed here all along and discarded three lines later, which
    // left the centre able to say a promotion cost 50,000 on a basket of three
    // shirts and unable to say which shirt. Every report built on that
    // attributes the WHOLE basket to the promotion — influenced revenue, which
    // is standard in the trade and overstates by however much of the basket the
    // offer never touched.
    Ok((total_cut, landed))
}

/// Work out what a free-item rule grants.
///
/// The value handed over is the price the shopper would otherwise have paid,
/// less whatever the free item is charged at. That value is what puts this rule
/// in competition with a discount: a free shirt worth Rp 149,000 should beat
/// 10% off a Rp 200,000 basket, and it only does so if it is valued.
fn apply_free_item(
    rule: &Rule,
    matched: &[usize],
    states: &[LineState],
    index: &PriceIndex<'_>,
    context: &PricingContext,
) -> Result<Option<(FreeLine, Money)>, PricingError> {
    let Effect::FreeItem {
        sku_code,
        quantity,
        every_matched_quantity,
        after_matched_quantity,
        unit_price,
    } = &rule.effect
    else {
        return Ok(None);
    };
    if *quantity <= 0 {
        return Ok(None);
    }

    let mut matched_quantity = 0_i64;
    for &index in matched {
        matched_quantity = matched_quantity
            .checked_add(states[index].quantity)
            .ok_or(PricingError::AmountOverflow)?;
    }
    // Units the offer does not count. "From the third onward" excludes two.
    let counting = (matched_quantity - (*after_matched_quantity).max(0)).max(0);
    if counting <= 0 {
        return Ok(None);
    }

    let granted = match every_matched_quantity {
        // Grant once, however much was bought.
        None => *quantity,
        // Grant again for every N counted units, floored: buy four with a
        // "2 for 1" and you get two free, not two and a half.
        Some(step) if *step > 0 => quantity
            .checked_mul(counting / step)
            .ok_or(PricingError::AmountOverflow)?,
        Some(_) => return Ok(None),
    };
    if granted <= 0 {
        return Ok(None);
    }

    // Naming no product means the one that triggered the rule. The first
    // matched line settles it, so a mixed trigger cannot make the choice
    // depend on which line the loop happened to see last.
    let given: &str = match sku_code {
        Some(named) => named.as_str(),
        None => match matched.first() {
            Some(&first) => states[first].sku_code.as_str(),
            None => return Ok(None),
        },
    };

    // A free item nobody can price is a free item the till cannot ring up. It
    // is refused for the same reason an unpriced sale is refused: better to not
    // apply the promotion than to put an unknown number on a receipt.
    let Some(entry) = index.price(context, given) else {
        return Ok(None);
    };
    let value = entry
        .unit_price
        .try_sub(*unit_price)?
        .floor_at_zero()
        .times(granted)?;

    Ok(Some((
        FreeLine {
            sku_code: given.to_string(),
            quantity: granted,
            unit_price: *unit_price,
            granted_by_rule_id: rule.rule_id.clone(),
            value,
        },
        value,
    )))
}

// ---------------------------------------------------------------------------
// Step 3d: the stacking search
// ---------------------------------------------------------------------------

/// The offers a line-exclusive rule is still willing to share a basket with.
///
/// `Alone` and `Exclusive` both mean "I do not share". [`ExclusiveScope::Line`]
/// says what that is measured over: the lines the claimant's own benefit lands
/// on, and nothing else. A 20%-off-footwear offer marked exclusive claims the
/// shoes; the shirts are still somebody else's to discount.
///
/// The claim is taken over the EFFECT lines rather than the matched ones,
/// because the effect lines are where the money actually goes. "Buy a suit, get
/// half off a shirt" claims the shirt.
///
/// Each companion is narrowed on both sides at once — the lines its benefit
/// lands on AND the lines its conditions are measured over — and then
/// re-checked against what is left. Narrowing only the benefit would let a
/// basket threshold be reached on goods the claimant has already taken, so an
/// offer would qualify on merchandise it is not permitted to discount: the same
/// fault [`MarkdownPolicy::Exclude`] avoids, arriving by a different door.
///
/// Narrowed up front rather than discovered while the scenario runs, so the
/// answer cannot depend on the order rules are applied in. Two machines pricing
/// one basket have to agree, and "whichever offer reached the line first" is not
/// a rule either of them can follow.
fn alongside_the_claim<'a>(
    claimant: &Candidate<'a>,
    stackable: &[&Candidate<'a>],
    states: &[LineState],
) -> Result<Vec<Candidate<'a>>, PricingError> {
    let claimed: BTreeSet<usize> = claimant.effect.iter().copied().collect();
    let mut beside = Vec::new();
    for other in stackable {
        let matched: Vec<usize> = other
            .matched
            .iter()
            .copied()
            .filter(|line| !claimed.contains(line))
            .collect();
        let effect: Vec<usize> = other
            .effect
            .iter()
            .copied()
            .filter(|line| !claimed.contains(line))
            .collect();
        if matched.is_empty() || effect.is_empty() {
            continue;
        }
        if check_conditions(other.rule, &matched, states)?.is_some() {
            continue;
        }
        beside.push(Candidate {
            rule: other.rule,
            matched,
            effect,
            ceiling: other.ceiling,
            campaign_budget_remaining: other.campaign_budget_remaining,
            campaign_uses_remaining: other.campaign_uses_remaining,
        });
    }
    Ok(beside)
}

fn run_scenario(
    rules: &[&Candidate<'_>],
    states: &[LineState],
    index: &PriceIndex<'_>,
    context: &PricingContext,
) -> Result<Scenario, PricingError> {
    let mut scenario = Scenario::empty(states);
    let mut campaign_budgets: BTreeMap<String, Money> = BTreeMap::new();
    let mut campaign_uses: BTreeMap<String, i64> = BTreeMap::new();
    for candidate in rules {
        if let Some(campaign_id) = candidate.rule.campaign_id.as_ref() {
            if let Some(remaining) = candidate.campaign_budget_remaining {
                campaign_budgets
                    .entry(campaign_id.clone())
                    .or_insert(remaining);
            }
            if let Some(remaining) = candidate.campaign_uses_remaining {
                campaign_uses.entry(campaign_id.clone()).or_insert(remaining);
            }
        }
    }
    let mut ordered: Vec<&&Candidate<'_>> = rules.iter().collect();
    ordered.sort_by(|left, right| application_order(left.rule).cmp(&application_order(right.rule)));

    for candidate in ordered {
        let rule = candidate.rule;
        let campaign_id = rule.campaign_id.as_deref();
        if campaign_id.is_some_and(|id| campaign_uses.get(id).is_some_and(|left| *left <= 0)) {
            scenario
                .lapsed
                .push((rule.rule_id.clone(), RejectionReason::UsageExhausted));
            continue;
        }
        let campaign_ceiling = campaign_id
            .and_then(|id| campaign_budgets.get(id).copied());
        let ceiling = tighter(candidate.ceiling, campaign_ceiling);
        if campaign_ceiling.is_some_and(|left| left.minor <= 0) {
            scenario
                .lapsed
                .push((rule.rule_id.clone(), RejectionReason::BudgetSpent));
            continue;
        }
        // Re-measured here rather than trusted from the pre-pass: the basket
        // this rule is looking at is the one the rules before it have already
        // discounted. A rule that no longer reaches its threshold drops out of
        // THIS outcome — not out of the search, because another outcome that
        // left those earlier rules off may still qualify it. See `resolve`.
        if let Some(reason) = check_amount(rule, &candidate.matched, &scenario.totals)? {
            scenario.lapsed.push((rule.rule_id.clone(), reason));
            continue;
        }
        if matches!(rule.effect, Effect::FreeItem { .. }) {
            let Some((free, value)) =
                apply_free_item(rule, &candidate.matched, states, index, context)?
            else {
                continue;
            };
            // A free item is indivisible. If its full value would cross any
            // remaining rule or campaign limit, the rule cannot be applied.
            if ceiling.is_some_and(|limit| value.minor > limit.minor) {
                scenario
                    .lapsed
                    .push((rule.rule_id.clone(), RejectionReason::BudgetSpent));
                continue;
            }
            scenario.benefit = scenario.benefit.try_add(value)?;
            scenario.applied.push(AppliedRule {
                rule_id: rule.rule_id.clone(),
                campaign_id: rule.campaign_id.clone(),
                name: rule.name.clone(),
                coupon_code: rule.coupon_code.clone(),
                benefit: value,
                // A granted item is not a cut off a line: its value is the
                // price of goods handed over, and it belongs to no line in the
                // basket. Empty rather than attributed somewhere arbitrary.
                line_benefits: Vec::new(),
            });
            scenario.free.push(free);
            scenario.note(rule);
            charge_campaign(rule, value, &mut campaign_budgets, &mut campaign_uses)?;
            continue;
        }
        let (cut, line_benefits) = apply_price_effect(
            rule,
            &candidate.effect,
            states,
            &mut scenario.totals,
            ceiling,
        )?;
        if !cut.is_positive() {
            continue;
        }
        scenario.benefit = scenario.benefit.try_add(cut)?;
        scenario.applied.push(AppliedRule {
            rule_id: rule.rule_id.clone(),
            campaign_id: rule.campaign_id.clone(),
            name: rule.name.clone(),
            coupon_code: rule.coupon_code.clone(),
            benefit: cut,
            line_benefits,
        });
        scenario.note(rule);
        charge_campaign(rule, cut, &mut campaign_budgets, &mut campaign_uses)?;
    }
    Ok(scenario)
}

fn charge_campaign(
    rule: &Rule,
    benefit: Money,
    budgets: &mut BTreeMap<String, Money>,
    uses: &mut BTreeMap<String, i64>,
) -> Result<(), PricingError> {
    let Some(campaign_id) = rule.campaign_id.as_ref() else {
        return Ok(());
    };
    if let Some(remaining) = budgets.get_mut(campaign_id) {
        *remaining = remaining.try_sub(benefit)?.floor_at_zero();
    }
    if let Some(remaining) = uses.get_mut(campaign_id) {
        *remaining = remaining.saturating_sub(1);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Step 4: points
// ---------------------------------------------------------------------------

/// Accrue points from the settled basket.
///
/// This runs last and on a separate channel, because points are not a discount:
/// they cost the shop nothing today and take nothing off the total. Letting an
/// earn rule into the discount search would have it compete for "best offer"
/// against rules that actually reduce the bill, and a generous points offer
/// would start suppressing real discounts.
///
/// One spend-rate rule wins as the base — a shop has one earning rate, not
/// several — and the rest are additive bonuses.
fn resolve_earn(
    candidates: &[Candidate<'_>],
    states: &[LineState],
    finals: &[Money],
) -> Result<(Vec<EarnAward>, i64), PricingError> {
    let mut base: Vec<&Candidate<'_>> = Vec::new();
    let mut bonus: Vec<&Candidate<'_>> = Vec::new();
    for candidate in candidates {
        match &candidate.rule.effect {
            Effect::EarnPoints(EarnEffect::SpendRate { .. }) => base.push(candidate),
            Effect::EarnPoints(_) => bonus.push(candidate),
            _ => {}
        }
    }
    base.sort_by(|left, right| selection_order(left.rule).cmp(&selection_order(right.rule)));
    bonus.sort_by(|left, right| selection_order(left.rule).cmp(&selection_order(right.rule)));

    let mut awards = Vec::new();
    let mut total = 0_i64;

    // ── the earning rate, chosen PER LINE ──────────────────────────────────
    //
    // "Take the highest multiplier" is a question about a unit, not about a
    // receipt. Shirts earning a point per 1.000 beside shoes earning one per
    // 500 is two offers, not a contest: giving the whole basket the better rate
    // pays points nobody offered, and giving it the worse one quietly drops an
    // offer that was made. Both were the outcome of taking one winner for the
    // basket, which is what this replaces.
    //
    // For a line that two rates both reach, the better rate wins — fewer rupiah
    // per point — and `selection_order` breaks a tie the same way it does
    // everywhere else: priority down, then rule id up. Never the order they
    // arrived in.
    let mut owner: Vec<Option<usize>> = vec![None; states.len()];
    for (position, candidate) in base.iter().enumerate() {
        let Effect::EarnPoints(EarnEffect::SpendRate { spend_per_point }) = &candidate.rule.effect
        else {
            continue;
        };
        if spend_per_point.minor <= 0 {
            continue;
        }
        for &line in &candidate.matched {
            let better = match owner[line] {
                None => true,
                Some(held) => match &base[held].rule.effect {
                    Effect::EarnPoints(EarnEffect::SpendRate {
                        spend_per_point: theirs,
                    }) => spend_per_point.minor < theirs.minor,
                    // Unreachable: only spend-rate rules are placed in `base`.
                    // Written as "take the new one" rather than as a panic — a
                    // till must not stop selling over a points rate.
                    _ => true,
                },
            };
            if better {
                owner[line] = Some(position);
            }
        }
    }

    // What the rates that LOST each line are still worth, if they say so.
    let extra = bonus_rates(&base, &owner, states, finals)?;

    for (position, candidate) in base.iter().enumerate() {
        let Effect::EarnPoints(EarnEffect::SpendRate { spend_per_point }) = &candidate.rule.effect
        else {
            continue;
        };
        // Only the lines this rate actually won. A rule beaten on every line
        // earns nothing FROM THE RATE and is not drawn as though it had —
        // though it may still have been worth something as a bonus on a line it
        // lost, which is what `extra` holds.
        let won: Vec<usize> = candidate
            .matched
            .iter()
            .copied()
            .filter(|line| owner[*line] == Some(position))
            .collect();
        // Whole points over the basis, THEN split across the lines — decision
        // D02, and the order matters. Dividing each line separately and
        // flooring each one loses a point per line: two lines of 1.500 at a
        // point per 1.000 earn one each and the basket earns three. Awarding
        // the basket figure and allocating it keeps the total right and still
        // tells a return how many points a single line took.
        let rate_points = if won.is_empty() || spend_per_point.minor <= 0 {
            0
        } else {
            earn_basis(candidate.rule, &won, states, finals)?.minor / spend_per_point.minor
        };
        // Capped here as well as on the total below, and the repetition is
        // load-bearing: the weights this rule's own rate is allocated by are
        // the ones it would have had on its own, so a rule with no bonus at all
        // — which is every rule published to date — comes out of the merge
        // below with exactly the line figures it had before any of this.
        let rate_points = cap_points(rate_points, candidate.rule.max_points);

        // One award per rule, whatever mixture of the two it earned. A rule
        // that owns one line and is a bonus on another must not appear twice:
        // the points ledger keeps one row per cause, so a second row for the
        // same cause is a row silently lost.
        let mut weight = vec![0_i128; states.len()];
        for share in split_points(rate_points, candidate.rule, &won, states, finals)? {
            weight[share.line] += i128::from(share.points);
        }
        let mut gained = 0_i64;
        for (line, bonus) in extra[position].iter().enumerate() {
            weight[line] += i128::from(*bonus);
            gained = gained.saturating_add(*bonus);
        }
        let points = cap_points(
            rate_points.saturating_add(gained),
            candidate.rule.max_points,
        );
        if points <= 0 {
            continue;
        }
        let lines: Vec<usize> = (0..states.len()).filter(|line| weight[*line] > 0).collect();
        let weights: Vec<i128> = lines.iter().map(|line| weight[*line]).collect();
        // The money this rule was measured on: the lines it won, and the lines
        // it was a bonus on. Both, because both earned it points, and a report
        // that showed only half would put a rate against the wrong turnover.
        let mut measured: Vec<usize> = won;
        measured.extend(
            extra[position]
                .iter()
                .enumerate()
                .filter_map(|(line, bonus)| {
                    (*bonus > 0 && owner[line] != Some(position)).then_some(line)
                }),
        );
        measured.sort_unstable();
        measured.dedup();

        total = total.checked_add(points).unwrap_or(i64::MAX);
        awards.push(EarnAward {
            rule_id: candidate.rule.rule_id.clone(),
            name: candidate.rule.name.clone(),
            points,
            basis_amount: earn_basis(candidate.rule, &measured, states, finals)?,
            line_points: allocate_points(points, &lines, &weights),
        });
    }

    for candidate in bonus {
        let points = match &candidate.rule.effect {
            Effect::EarnPoints(EarnEffect::FixedPoints { points }) => *points,
            Effect::EarnPoints(EarnEffect::PointsPerQuantity { points }) => {
                let mut quantity = 0_i64;
                for &index in &candidate.matched {
                    quantity = quantity
                        .checked_add(states[index].quantity)
                        .ok_or(PricingError::AmountOverflow)?;
                }
                points.checked_mul(quantity).unwrap_or(i64::MAX)
            }
            _ => continue,
        };
        let points = cap_points(points, candidate.rule.max_points);
        if points > 0 {
            total = total.checked_add(points).unwrap_or(i64::MAX);
            // A flat bonus is allocated over the lines that QUALIFIED for it,
            // by the same basis. "500 points on this basket" has no line of its
            // own, and a return of half the basket has to take back some of it
            // — leaving it unallocated would let a shopper return everything
            // and keep the bonus.
            let spread = split_points(points, candidate.rule, &candidate.matched, states, finals)?;
            awards.push(EarnAward {
                rule_id: candidate.rule.rule_id.clone(),
                name: candidate.rule.name.clone(),
                points,
                basis_amount: Money::ZERO,
                line_points: spread,
            });
        }
    }
    Ok((awards, total))
}

fn cap_points(points: i64, limit: Option<i64>) -> i64 {
    match limit {
        Some(limit) if points > limit => limit,
        _ => points,
    }
}

/// What one rate is worth on one line, on its own.
///
/// Floored per line, unlike a rate's own award, which floors once over the
/// summed basis. The difference is forced rather than chosen: a bonus is the
/// gap between two rates ON A LINE, and different lines can have different
/// rates in play, so there is no basket-wide gap to floor. It costs under a
/// point per line, where pretending one baseline held across the basket would
/// pay a bonus on lines the everyday rate never reached.
fn rate_points_on_line(
    candidate: &Candidate<'_>,
    line: usize,
    states: &[LineState],
    finals: &[Money],
) -> Result<i64, PricingError> {
    let Effect::EarnPoints(EarnEffect::SpendRate { spend_per_point }) = &candidate.rule.effect
    else {
        return Ok(0);
    };
    if spend_per_point.minor <= 0 {
        return Ok(0);
    }
    Ok(earn_basis(candidate.rule, &[line], states, finals)?.minor / spend_per_point.minor)
}

/// `running`, multiplied by how many times the everyday rate goes into this one.
///
/// In `i128` because a basket's points times a multiplier overflows `i64` long
/// before either factor does, and saturating rather than wrapping: a till must
/// not stop selling, or start awarding negative points, over a loyalty offer.
fn times_over(running: i64, mine: i64, floor: i64) -> i64 {
    if floor <= 0 {
        return running;
    }
    let scaled = i128::from(running) * i128::from(mine) / i128::from(floor);
    i64::try_from(scaled).unwrap_or(i64::MAX)
}

/// What each rate is worth on each line ON TOP of the rate that won it.
///
/// Returns `extra[rule position][line]`, and it is all nought unless a rule
/// asks for something other than [`PointsCombination::Highest`] — which is
/// every rule published to date, and the reason nothing here can change what a
/// rung basket earned.
///
/// The everyday rate is the ANCHOR: the least generous rate that reaches the
/// line, because that is the one a shop leaves running all year. "Double
/// points" is a number only against something, and this is the something. Where
/// the anchor is also the winner there is no bonus — nothing is a multiple of
/// itself — so a line with one rate on it, or with the best rate as its only
/// standing offer, comes out exactly as before.
///
/// The fold runs in `selection_order`, so which bonus lands on which shoulders
/// is the same on two machines. It never subtracts: a rule reading a different
/// [`EarnBasis`] can be worth less per line than the anchor despite a better
/// rate, and a BONUS that took points away would be a promotion that punished
/// the shopper for qualifying.
fn bonus_rates(
    base: &[&Candidate<'_>],
    owner: &[Option<usize>],
    states: &[LineState],
    finals: &[Money],
) -> Result<Vec<Vec<i64>>, PricingError> {
    let mut extra = vec![vec![0_i64; states.len()]; base.len()];
    if base.len() < 2
        || !base
            .iter()
            .any(|candidate| candidate.rule.points_combination != PointsCombination::Highest)
    {
        return Ok(extra);
    }

    let mut anchor: Vec<Option<usize>> = vec![None; states.len()];
    for (position, candidate) in base.iter().enumerate() {
        let Effect::EarnPoints(EarnEffect::SpendRate { spend_per_point }) = &candidate.rule.effect
        else {
            continue;
        };
        if spend_per_point.minor <= 0 {
            continue;
        }
        for &line in &candidate.matched {
            let plainer = match anchor[line] {
                None => true,
                Some(held) => match &base[held].rule.effect {
                    Effect::EarnPoints(EarnEffect::SpendRate {
                        spend_per_point: theirs,
                    }) => spend_per_point.minor > theirs.minor,
                    // Unreachable: only spend-rate rules reach `base`. Written
                    // as "take the new one" rather than as a panic, for the
                    // same reason the owner selection is.
                    _ => true,
                },
            };
            if plainer {
                anchor[line] = Some(position);
            }
        }
    }

    for line in 0..states.len() {
        let (Some(held), Some(everyday)) = (owner[line], anchor[line]) else {
            continue;
        };
        if held == everyday {
            continue;
        }
        let floor = rate_points_on_line(base[everyday], line, states, finals)?;
        if floor <= 0 {
            // A line the everyday rate earns nothing on has no multiple to be
            // taken of it. Anything else here would divide by nought, or make
            // "twice what you get anyway" mean something on a line that gets
            // nothing anyway.
            continue;
        }
        let mut running = rate_points_on_line(base[held], line, states, finals)?;
        for (position, candidate) in base.iter().enumerate() {
            if position == held || !candidate.matched.contains(&line) {
                continue;
            }
            let mine = rate_points_on_line(candidate, line, states, finals)?;
            if mine <= 0 {
                continue;
            }
            let raised = match candidate.rule.points_combination {
                PointsCombination::Highest => running,
                PointsCombination::Add => running.saturating_add((mine - floor).max(0)),
                PointsCombination::Compound => times_over(running, mine, floor).max(running),
            };
            extra[position][line] = raised - running;
            running = raised;
        }
    }
    Ok(extra)
}

/// Split an award across the lines that earned it, by their share of the basis.
///
/// Floor each share, then hand the remaining points out by largest fractional
/// remainder, ties to the lower line index — decision D02 and the same rounding
/// the money allocations use. The parts sum to the whole exactly, which is what
/// lets a return reverse a line without the basket's total drifting.
///
/// A basis of nought — everything discounted to nothing — spreads the points
/// evenly rather than dividing by zero. That case earns nought points today
/// (there is no spend to earn on), so this is a guard rather than a policy.
fn split_points(
    points: i64,
    rule: &Rule,
    lines: &[usize],
    states: &[LineState],
    finals: &[Money],
) -> Result<Vec<LinePoints>, PricingError> {
    if lines.is_empty() || points <= 0 {
        return Ok(Vec::new());
    }
    let mut weights = Vec::with_capacity(lines.len());
    for &line in lines {
        weights.push(i128::from(earn_basis(rule, &[line], states, finals)?.minor));
    }
    Ok(allocate_points(points, lines, &weights))
}

/// The rounding itself, over weights somebody else chose.
///
/// Split out of [`split_points`] because there are now two things an award can
/// be weighted by: the money each line spent, and — for a rule that earned as a
/// bonus on top of another rate — the points it was worth on each line. Both
/// have to land on the same floor-then-largest-remainder rule, or a return
/// reverses a different number of points than the sale awarded.
fn allocate_points(points: i64, lines: &[usize], weights: &[i128]) -> Vec<LinePoints> {
    if lines.is_empty() || points <= 0 {
        return Vec::new();
    }
    let basis: i128 = weights.iter().sum();

    let mut shares: Vec<i64> = Vec::with_capacity(lines.len());
    let mut remainders: Vec<(usize, i128)> = Vec::with_capacity(lines.len());
    let mut handed = 0i64;
    for (position, weight) in weights.iter().enumerate() {
        let (whole, rest) = if basis > 0 {
            let exact = weight * points as i128;
            ((exact / basis) as i64, exact % basis)
        } else {
            // Even split when nothing was spent: the numerator is the same for
            // every line, so the remainder ordering falls back to line index.
            (points / lines.len() as i64, 0)
        };
        shares.push(whole);
        handed += whole;
        remainders.push((position, rest));
    }

    remainders.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    let mut left_over = points - handed;
    for (position, _) in &remainders {
        if left_over <= 0 {
            break;
        }
        shares[*position] += 1;
        left_over -= 1;
    }

    lines
        .iter()
        .zip(shares)
        .filter(|(_, points)| *points > 0)
        .map(|(line, points)| LinePoints {
            line: *line,
            points,
        })
        .collect()
}

fn earn_basis(
    rule: &Rule,
    matched: &[usize],
    states: &[LineState],
    finals: &[Money],
) -> Result<Money, PricingError> {
    let mut sum = Money::ZERO;
    for &index in matched {
        let state = &states[index];
        let amount = match rule.earn_basis {
            EarnBasis::Original => state.list_unit_price.times(state.quantity)?,
            // Post-discount AND post-tax: the goods, with nothing in them that
            // belongs to the state. Under tax-inclusive pricing this is
            // materially smaller than the line total, and paying points on the
            // line total would be paying loyalty on PPN.
            EarnBasis::PostDiscountNet => finals[index],
            EarnBasis::PostMarkdownPreDiscount => state.gross_total,
        };
        sum = sum.try_add(amount)?;
    }
    Ok(sum)
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

pub(crate) fn resolve(
    snapshot: &PricingSnapshot,
    context: &PricingContext,
    cart: &[CartLine],
) -> Result<PricingResult, PricingError> {
    let index = PriceIndex::build(snapshot);
    let states = settle_lines(&index, context, cart)?;
    let mut rejected: Vec<RejectedRule> = Vec::new();
    let mut discount_candidates: Vec<Candidate<'_>> = Vec::new();
    let mut earn_candidates: Vec<Candidate<'_>> = Vec::new();
    let mut advisory_candidates: Vec<Candidate<'_>> = Vec::new();

    for rule in &snapshot.rules {
        let gate = match gate(rule, snapshot, context) {
            Ok(gate) => gate,
            Err(reason) => {
                rejected.push(RejectedRule::new(rule, reason));
                continue;
            }
        };
        let matched = match_lines(rule, &states);
        if matched.is_empty() {
            rejected.push(RejectedRule::new(rule, empty_match_reason(rule, &states)));
            continue;
        }
        if let Some(reason) = check_conditions(rule, &matched, &states)? {
            rejected.push(RejectedRule::new(rule, reason));
            continue;
        }
        let effect = effect_lines(rule, &states, &matched);
        if effect.is_empty() {
            // The trigger is in the basket but the thing the offer discounts is
            // not — a suit with no shirt to take the money off.
            rejected.push(RejectedRule::new(rule, RejectionReason::NothingMatched));
            continue;
        }
        let candidate = Candidate {
            rule,
            matched,
            effect,
            ceiling: gate.ceiling,
            campaign_budget_remaining: gate.campaign_budget_remaining,
            campaign_uses_remaining: gate.campaign_uses_remaining,
        };
        if rule.is_earn() {
            earn_candidates.push(candidate);
        } else if rule.advisory {
            advisory_candidates.push(candidate);
        } else {
            discount_candidates.push(candidate);
        }
    }

    // An advisory offer is never applied on its own. It is priced anyway, so
    // the screen can tell a person what it would be worth and let them decide.
    for candidate in &advisory_candidates {
        let scenario = run_scenario(&[candidate], &states, &index, context)?;
        rejected.push(
            RejectedRule::new(candidate.rule, RejectionReason::AdvisoryOnly)
                .worth(scenario.benefit),
        );
    }

    // The combined offer: every rule that permits company.
    let stackable: Vec<&Candidate<'_>> = discount_candidates
        .iter()
        .filter(|candidate| candidate.rule.stacking == Stacking::Stackable)
        .collect();
    let mut best = run_scenario(&stackable, &states, &index, context)?;

    // ── and the same set with one offer left out, each in turn ──────────────
    //
    // Best Price is the cheapest BASKET, not the cheapest line decided first.
    // Applying every eligible offer is not always the cheapest basket, because
    // an offer can discount a basket below the threshold a bigger offer needed:
    //
    //     Basket 600.000
    //     A  20% off an item        → 480.000
    //     B  150.000 off a basket of 500.000 or more
    //
    //     A and B together : A takes it to 480.000, B no longer qualifies → 480.000
    //     B alone          :                                              → 450.000
    //
    // Taking every offer costs the shopper 30.000 more than taking one. So the
    // set minus each single member is tried as well, and the cheapest outcome
    // wins on its own merits.
    //
    // **One omission, not every subset.** Every subset is 2^n outcomes and this
    // runs at a till, on a basket, while somebody waits. One omission is O(n)
    // and it resolves the whole family of cases this exists for — a single
    // offer standing between the basket and a better one. A basket where TWO
    // offers must both be dropped is not covered, is not known to occur, and
    // would want a proper search rather than a bigger constant.
    for dropped in 0..stackable.len() {
        let fewer: Vec<&Candidate<'_>> = stackable
            .iter()
            .enumerate()
            .filter(|(position, _)| *position != dropped)
            .map(|(_, candidate)| *candidate)
            .collect();
        let scenario = run_scenario(&fewer, &states, &index, context)?;
        if scenario.beats(&best) {
            best = scenario;
        }
    }
    // Owned rather than borrowed from `best`, because a line-exclusive outcome
    // below names rules held in a `Vec` built inside the loop. A `&str` into
    // that would not outlive the iteration that made it, and the winner has to.
    let mut winner: Vec<String> = best
        .applied
        .iter()
        .map(|applied| applied.rule_id.clone())
        .collect();

    // And one offer for each rule that will not share.
    let mut solo: Vec<&Candidate<'_>> = discount_candidates
        .iter()
        .filter(|candidate| candidate.rule.stacking != Stacking::Stackable)
        .collect();
    solo.sort_by(|left, right| selection_order(left.rule).cmp(&selection_order(right.rule)));
    for candidate in solo {
        // A rule that claims only its own lines is not alone in the basket: the
        // offers that land elsewhere run beside it, narrowed to what it left.
        // `Basket` — the default and what every published book means — brings
        // nothing along, which is the empty vector and today's behaviour.
        let alongside = match candidate.rule.exclusive_scope {
            ExclusiveScope::Basket => Vec::new(),
            ExclusiveScope::Line => alongside_the_claim(candidate, &stackable, &states)?,
        };
        let mut set: Vec<&Candidate<'_>> = vec![candidate];
        set.extend(alongside.iter());
        let scenario = run_scenario(&set, &states, &index, context)?;
        if scenario.beats(&best) {
            best = scenario;
            // Everything that actually took money off, plus the claimant
            // itself. The claimant is named whether or not it managed a cut,
            // because it is the rule this outcome was built around and a rule
            // that is neither applied nor rejected appears nowhere at all.
            winner = best
                .applied
                .iter()
                .map(|applied| applied.rule_id.clone())
                .collect();
            if !winner.contains(&candidate.rule.rule_id) {
                winner.push(candidate.rule.rule_id.clone());
            }
        }
    }

    // Whatever did not make it into the winning offer is recorded with the
    // reason a cashier would need, not silently dropped.
    //
    // "An exclusive rule won" is asked of the winning set rather than of a
    // single id: a line-exclusive offer wins WITH the offers it left room for,
    // and the rules it shut out were still shut out by it.
    let exclusive_won = discount_candidates.iter().any(|candidate| {
        candidate.rule.stacking == Stacking::Exclusive && winner.contains(&candidate.rule.rule_id)
    });
    for candidate in &discount_candidates {
        if winner.contains(&candidate.rule.rule_id) {
            continue;
        }
        // What the winning outcome itself recorded, before any guess about
        // why the rule is absent from it. A rule that stopped qualifying was
        // not outbid by anything, and telling a cashier it was sends them
        // looking for an offer that never existed.
        let reason = best
            .lapsed
            .iter()
            .find(|(rule_id, _)| rule_id == &candidate.rule.rule_id)
            .map(|(_, reason)| *reason)
            .unwrap_or(if exclusive_won {
                RejectionReason::DisplacedByExclusiveRule
            } else {
                RejectionReason::OutbidByBetterOffer
            });
        rejected.push(RejectedRule::new(candidate.rule, reason));
    }

    // Tax comes off each line AFTER every commercial discount, which is the
    // locked order and the only one that can be right: a discount reduces what
    // was sold, so it reduces what is taxed. Taxing the ticket price and then
    // discounting would collect tax on money nobody paid.
    //
    // Split BEFORE points are resolved, because the locked earning basis is
    // "net merchandise after discounts, EXCLUDING tax" — and a basis that
    // included tax would pay loyalty on money collected for the state.
    let mut nets = Vec::with_capacity(states.len());
    let mut taxes = Vec::with_capacity(states.len());
    for (index, state) in states.iter().enumerate() {
        let (net, tax) = split_tax(best.totals[index], &state.tax_category, &snapshot.tax_rules)?;
        nets.push(net);
        taxes.push(tax);
    }

    let (earn_awards, points_earned) = resolve_earn(&earn_candidates, &states, &nets)?;

    let mut lines = Vec::with_capacity(states.len());
    let mut total = Money::ZERO;
    let mut net_ex_tax = Money::ZERO;
    let mut tax_total = Money::ZERO;
    for (index, state) in states.iter().enumerate() {
        let line_total = best.totals[index];
        total = total.try_add(line_total)?;
        let (net, tax) = (nets[index], taxes[index]);
        net_ex_tax = net_ex_tax.try_add(net)?;
        tax_total = tax_total.try_add(tax)?;
        lines.push(LineResult {
            sku_code: state.sku_code.clone(),
            quantity: state.quantity,
            source: state.source,
            base_unit_price: state.list_unit_price,
            unit_price: state.unit_price,
            line_total,
            currency: state.currency.clone(),
            tax_category: state.tax_category.clone(),
            net_ex_tax: net,
            tax_amount: tax,
            publication_version: state.publication_version,
            markdown_id: state.markdown_id.clone(),
        });
    }
    for free in &best.free {
        // A granted item is charged for, at a token price or at nothing, and
        // whatever is charged is taxed like anything else. It has no line of
        // its own in `lines`, so its tax is folded into the totals here.
        let charged = free.unit_price.times(free.quantity)?;
        total = total.try_add(charged)?;
        // A `FreeLine` carries no tax category of its own — it is granted, not
        // priced from the book — so it is split against the category of the
        // line it was granted from where that is knowable, and against nothing
        // otherwise. Today a granted item is charged at nought in every book
        // the gate allows, so this contributes nought either way.
        let category = states
            .iter()
            .find(|state| state.sku_code == free.sku_code)
            .map(|state| state.tax_category.clone())
            .unwrap_or_default();
        let (net, tax) = split_tax(charged, &category, &snapshot.tax_rules)?;
        net_ex_tax = net_ex_tax.try_add(net)?;
        tax_total = tax_total.try_add(tax)?;
    }

    rejected.sort_by(|left, right| left.rule_id.cmp(&right.rule_id));

    // Charges are priced HERE and nowhere earlier, and that placement is the
    // enforcement rather than a convention: everything above this line — the
    // scenario search, every threshold, every allocation, the earn basis — has
    // already run, over `states`, which holds goods and only goods. A charge
    // cannot be discounted by a rule that has finished choosing, cannot unlock a
    // minimum spend that has finished being measured, and cannot earn points
    // that have finished being split. A caller cannot get it wrong either,
    // because there is no earlier door to put one through.
    let mut charges = Vec::with_capacity(context.charges.len());
    let mut charge_net_ex_tax = Money::ZERO;
    let mut charge_tax_total = Money::ZERO;
    let mut charge_total = Money::ZERO;
    for charge in &context.charges {
        let amount = Money::new(charge.amount_minor);
        let (net, tax) = split_tax(amount, &charge.tax_category, &snapshot.tax_rules)?;
        charge_net_ex_tax = charge_net_ex_tax.try_add(net)?;
        charge_tax_total = charge_tax_total.try_add(tax)?;
        charge_total = charge_total.try_add(amount)?;
        charges.push(ChargeResult {
            code: charge.code.clone(),
            description: charge.description.clone(),
            amount,
            net_ex_tax: net,
            tax_amount: tax,
            tax_category: charge.tax_category.clone(),
        });
    }

    let mut result = PricingResult {
        trace_id: String::new(),
        publication_version: snapshot.publication_version,
        currency: states
            .first()
            .map(|state| state.currency.clone())
            .unwrap_or_else(|| Currency("IDR".into())),
        lines,
        free_lines: best.free,
        applied_rules: best.applied,
        rejected_rules: rejected,
        earn_awards,
        points_earned,
        discount_total: best.benefit,
        total,
        net_ex_tax,
        tax_total,
        charges,
        charge_net_ex_tax,
        charge_tax_total,
        charge_total,
        // Inclusive pricing has the tax already inside `total`, so the goods
        // half of the amount due IS the total. Exclusive pricing adds it.
        // `net + tax` says both without a branch, because `split_tax` has
        // already put each rupiah on one side or the other. Then the charges,
        // which the shopper owes as well and which no earlier line touched.
        amount_due: net_ex_tax.try_add(tax_total)?.try_add(charge_total)?,
    };
    result.trace_id = fingerprint(context, &result);
    Ok(result)
}

/// One line's money, split into goods and tax.
///
/// Returns `(net_ex_tax, tax_amount)`. **The arithmetic is not here.** It is in
/// `retail-tax`, which exists because this rounding rule was once implemented
/// twice — once at the centre and once at the till — and the two copies parted
/// company by a rupiah, which is a receipt that does not match itself when it
/// is read back at head office.
///
/// This function is the lookup: which rate applies to this category, and does
/// the price already contain it. No rule for the category means no tax figure
/// and not a guessed one — nought tax and the whole line as net, which is what
/// every book published before tax was modelled meant.
///
/// That this crate consumes the tax domain rather than owning it is the point.
/// The engine needs the net only because the points basis is net of tax; it has
/// no opinion about what tax IS, and a second opinion is precisely what
/// `retail-tax` was extracted to prevent.
fn split_tax(
    line_total: Money,
    category: &str,
    rules: &[TaxRule],
) -> Result<(Money, Money), PricingError> {
    let Some(rule) = rules.iter().find(|one| one.tax_category == category) else {
        return Ok((line_total, Money::ZERO));
    };
    if rule.rate_bps <= 0 || line_total.minor <= 0 {
        return Ok((line_total, Money::ZERO));
    }
    let rate = i32::try_from(rule.rate_bps).map_err(|_| PricingError::AmountOverflow)?;
    // Quantity one: the line total has already been through markdown, every
    // promotion and its allocation, so it is one amount and not a unit price
    // times a count. Multiplying a settled line by its quantity again would tax
    // it as many times over.
    let totals = retail_tax::calculate_line_totals(line_total.minor, 1, rate, rule.inclusive)
        .map_err(|_| PricingError::AmountOverflow)?;
    Ok((Money::new(totals.net_minor), Money::new(totals.tax_minor)))
}

/// A fingerprint of one pricing decision.
///
/// Everything that could make the answer different goes in — where, when, who,
/// and every number that came out. Two machines given the same basket and the
/// same book produce the same string, which is what makes an offline sale
/// checkable later instead of merely plausible.
///
/// It covers the decision, not the whole snapshot: a shop holding a promotion
/// that did not apply must not fingerprint differently from one that never
/// received it, or the id would change for reasons nobody can see on the
/// receipt.
fn fingerprint(context: &PricingContext, result: &PricingResult) -> String {
    let mut hasher = Sha256::new();
    let mut absorb = |value: &str| {
        // Length-prefixed, so "ab" + "c" cannot hash the same as "a" + "bc".
        hasher.update(value.len().to_be_bytes());
        hasher.update(value.as_bytes());
    };
    absorb(&context.site_id);
    absorb(&context.channel);
    absorb(&context.at.to_rfc3339());
    absorb(&result.publication_version.to_string());
    absorb(&result.currency.0);
    for line in &result.lines {
        absorb(&line.sku_code);
        absorb(&line.quantity.to_string());
        absorb(&line.unit_price.minor.to_string());
        absorb(&line.line_total.minor.to_string());
        // `as_str`, never `Debug`. The wire spelling and the debug spelling of
        // a `PriceSource` differ — `COMPANY_PRICE` against `CompanyPrice` —
        // and this codebase has already paid once for a screen reading one
        // node's spelling against another's. A fingerprint built from `Debug`
        // is a fingerprint that changes if anyone ever reorders or renames a
        // variant for readability, which is the one edit nobody would think to
        // check a trace against.
        absorb(line.source.as_str());
        absorb(line.markdown_id.as_deref().unwrap_or(""));
    }
    for free in &result.free_lines {
        absorb(&free.sku_code);
        absorb(&free.quantity.to_string());
        absorb(&free.granted_by_rule_id);
    }
    for applied in &result.applied_rules {
        absorb(&applied.rule_id);
        absorb(&applied.benefit.minor.to_string());
    }
    for award in &result.earn_awards {
        absorb(&award.rule_id);
        absorb(&award.points.to_string());
    }
    absorb(&result.discount_total.minor.to_string());
    absorb(&result.total.minor.to_string());
    hex::encode(hasher.finalize())
}

/// What a shop may sell, and for how much, with promotions applied.
pub(crate) fn catalog(
    snapshot: &PricingSnapshot,
    context: &PricingContext,
    products: &[CartLine],
) -> Vec<crate::CatalogEntry> {
    let index = PriceIndex::build(snapshot);
    let mut priced: BTreeMap<&str, crate::CatalogEntry> = BTreeMap::new();
    for product in products {
        let Some(entry) = index.price(context, &product.sku_code) else {
            continue;
        };
        if !entry.sellable {
            continue;
        }
        let markdown = index.markdown(context, product);
        let (unit_price, source, markdown_id) = match markdown {
            Some(markdown) => (
                markdown.replacement_unit_price,
                PriceSource::Markdown,
                Some(markdown.markdown_id.clone()),
            ),
            None => (entry.unit_price, source_of(&entry.applies_to), None),
        };
        priced.insert(
            product.sku_code.as_str(),
            crate::CatalogEntry {
                sku_code: product.sku_code.clone(),
                unit_price,
                base_unit_price: entry.unit_price,
                source,
                markdown_id,
                currency: entry.currency.clone(),
                tax_category: entry.tax_category.clone(),
                publication_version: entry.publication_version,
            },
        );
    }
    priced.into_values().collect()
}

/// Whether a coupon code would be accepted at all, without pricing a basket.
///
/// The till needs this the moment a code is typed, before there is anything to
/// price — telling a shopper "that coupon expired" while they are still filling
/// the basket is a better shop than telling them at the counter.
pub(crate) fn check_coupon_code<'a>(
    snapshot: &'a PricingSnapshot,
    context: &PricingContext,
    code: &str,
) -> Result<&'a Coupon, RejectionReason> {
    let coupon = snapshot
        .coupons
        .iter()
        .find(|coupon| coupon.code == code)
        .ok_or(RejectionReason::CouponUnknown)?;
    if !coupon.active {
        return Err(RejectionReason::CouponNotActive);
    }
    if coupon.valid_from.is_some_and(|from| context.at < from)
        || coupon.valid_to.is_some_and(|to| context.at >= to)
    {
        return Err(RejectionReason::CouponExpired);
    }
    if coupon.max_uses.is_some_and(|max| coupon.used >= max) {
        return Err(RejectionReason::CouponUsedUp);
    }
    if coupon.max_uses.is_some() {
        return Err(RejectionReason::CouponNeedsOnlineAuthorization);
    }
    match (&coupon.customer_id, &context.customer_id) {
        (Some(owner), Some(shopper)) if owner == shopper => {}
        (Some(_), _) => return Err(RejectionReason::CouponBelongsToSomeoneElse),
        (None, _) => {}
    }
    Ok(coupon)
}

/// Every price that could apply to each product, best first.
///
/// The companion to [`catalog`]: that answers "what does this cost", this
/// answers "and what else could it have cost, and why did that lose". A
/// merchandiser looking at a price they did not expect needs the second
/// question answered, and until this existed the only way to answer it was to
/// read the price book by hand.
///
/// A markdown replaces the base rather than reducing it, so a winning markdown
/// heads the stack and the price list entry beneath it is a loser — which is
/// exactly how it should read. Booking that relationship the other way round is
/// how a markdown comes to be reported as a discount.
pub(crate) fn stacks(
    snapshot: &crate::PricingSnapshot,
    context: &crate::PricingContext,
    products: &[crate::CartLine],
) -> Vec<crate::ProductStack> {
    let index = PriceIndex::build(snapshot);
    products
        .iter()
        .map(|product| {
            let entries = index.ranked(context, &product.sku_code);
            let markdowns = index.markdowns_ranked(context, product);
            // A markdown only applies to a product the price book prices. One
            // marking down something with no price is not a price of its own —
            // there is nothing to replace — and reporting it as in force would
            // put a number on screen that no till would ever charge.
            let base = entries.first();
            let mut candidates: Vec<crate::PriceCandidate> = Vec::new();
            if let Some(base) = base {
                for (rank, markdown) in markdowns.iter().enumerate() {
                    candidates.push(crate::PriceCandidate {
                        source: crate::PriceSource::Markdown,
                        applies_to: markdown.applies_to.clone(),
                        unit_price: markdown.replacement_unit_price,
                        currency: base.currency.clone(),
                        tax_category: base.tax_category.clone(),
                        // The markdown's own book, not the book the base price
                        // came out of. A clearance authored in v2 replacing a
                        // v1 price is two books, and reporting one of them
                        // twice loses the more interesting half.
                        publication_version: markdown.publication_version,
                        markdown_id: Some(markdown.markdown_id.clone()),
                        effective_from: markdown.effective_from,
                        effective_to: markdown.effective_to,
                        in_force: rank == 0,
                    });
                }
            }
            let markdown_won = !candidates.is_empty();
            for (rank, entry) in entries.iter().enumerate() {
                candidates.push(crate::PriceCandidate {
                    source: source_of(&entry.applies_to),
                    applies_to: entry.applies_to.clone(),
                    unit_price: entry.unit_price,
                    currency: entry.currency.clone(),
                    tax_category: entry.tax_category.clone(),
                    publication_version: entry.publication_version,
                    markdown_id: None,
                    effective_from: entry.effective_from,
                    effective_to: entry.effective_to,
                    in_force: rank == 0 && !markdown_won,
                });
            }
            crate::ProductStack {
                sku_code: product.sku_code.clone(),
                candidates,
            }
        })
        .collect()
}
