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
    RejectionReason, Rule, RuleStatus, Stacking,
};
use crate::{
    AppliedRule, CartLine, EarnAward, FreeLine, LineResult, PriceSource, PricingContext,
    PricingError, PricingResult, PricingSnapshot, RejectedRule,
};

/// One cart line, once the base price and any markdown have settled.
struct LineState {
    sku_code: String,
    article_code: Option<String>,
    division: Option<String>,
    tags: Vec<String>,
    unit_cost: Option<Money>,
    posting_class: crate::PostingClass,
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
}

/// One permitted outcome: what each line would come to, and what that is worth
/// to the shopper.
struct Scenario {
    totals: Vec<Money>,
    free: Vec<FreeLine>,
    applied: Vec<AppliedRule>,
    benefit: Money,
    /// The highest priority among the rules that applied, for tie-breaking.
    top_priority: i64,
    /// The lowest rule id among those that applied, for tie-breaking.
    first_rule_id: Option<String>,
}

impl Scenario {
    fn empty(states: &[LineState]) -> Self {
        Self {
            totals: states.iter().map(|state| state.gross_total).collect(),
            free: Vec::new(),
            applied: Vec::new(),
            benefit: Money::ZERO,
            top_priority: i64::MIN,
            first_rule_id: None,
        }
    }

    fn note(&mut self, rule: &Rule) {
        self.top_priority = self.top_priority.max(rule.priority);
        match &self.first_rule_id {
            Some(current) if current.as_str() <= rule.rule_id.as_str() => {}
            _ => self.first_rule_id = Some(rule.rule_id.clone()),
        }
    }

    /// More benefit wins; then higher priority; then the lower rule id.
    fn beats(&self, other: &Self) -> bool {
        (
            self.benefit.minor,
            self.top_priority,
            std::cmp::Reverse(self.first_rule_id.as_deref()),
        ) > (
            other.benefit.minor,
            other.top_priority,
            std::cmp::Reverse(other.first_rule_id.as_deref()),
        )
    }
}

/// Name the level a price came from, so a receipt can say where it got it.
fn source_of(level: &PriceLevel) -> PriceSource {
    match level {
        PriceLevel::Site { .. } => PriceSource::SitePrice,
        PriceLevel::SiteGroup { .. } => PriceSource::SiteGroupPrice,
        PriceLevel::Tier { .. } => PriceSource::TierPrice,
        PriceLevel::Company => PriceSource::CompanyPrice,
    }
}

/// Order rules for application and for tie-breaking: priority down, id up.
fn selection_order(rule: &Rule) -> (std::cmp::Reverse<i64>, &str) {
    (std::cmp::Reverse(rule.priority), rule.rule_id.as_str())
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

        // A price somebody typed in beats the book and every clearance in it:
        // it is a deliberate act by a person who is standing there, and a
        // markdown quietly undercutting it would make the override meaningless.
        let markdown = index.markdown(context, line);
        let (unit_price, source, markdown_id) = match (line.manual_unit_price, markdown) {
            (Some(manual), _) => (manual, PriceSource::ManualOverride, None),
            (None, Some(markdown)) => (
                markdown.replacement_unit_price,
                PriceSource::Markdown,
                Some(markdown.markdown_id.clone()),
            ),
            (None, None) => (entry.unit_price, source_of(&entry.applies_to), None),
        };

        states.push(LineState {
            sku_code: line.sku_code.clone(),
            article_code: line.article_code.clone(),
            division: line.division.clone(),
            tags: line.tags.clone(),
            unit_cost: line.unit_cost,
            posting_class: line.posting_class,
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

/// Whether a rule may run at all, and the most it may give away if it does.
///
/// The two are decided together because both need the campaign, and looking it
/// up twice is how the two answers come to disagree.
fn gate(
    rule: &Rule,
    snapshot: &PricingSnapshot,
    context: &PricingContext,
) -> Result<Option<Money>, RejectionReason> {
    if rule.status != RuleStatus::Active {
        return Err(RejectionReason::NotActive);
    }
    if let Some(reason) = rule.conditions.window_allows(context.at) {
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
        CustomerScope::Tiers { tier_ids } => {
            let in_tier = context
                .customer_tier
                .as_deref()
                .is_some_and(|tier| tier_ids.contains(tier));
            if !in_tier {
                return Err(RejectionReason::NotThisCustomer);
            }
        }
    }
    if let Some(code) = &rule.coupon_code {
        if let Some(reason) = check_coupon(code, rule, snapshot, context) {
            return Err(reason);
        }
    }
    let customer_uses = context
        .customer_id
        .as_deref()
        .and_then(|_| context.customer_rule_uses.get(&rule.rule_id).copied())
        .unwrap_or(0);
    if let Some(reason) = rule.caps.allows(customer_uses) {
        return Err(reason);
    }
    // The campaign's shared caps, checked after the rule's own. Five offers
    // that are one promotion to the business spend one budget between them.
    if let Some(campaign) = campaign {
        if let Some(reason) = campaign.caps.allows(customer_uses) {
            return Err(reason);
        }
    }

    // A rule may not give away more than its own cap, what is left of its own
    // budget, or what is left of the campaign's.
    //
    // Two stackable rules under one campaign each see the whole remainder, so
    // together they can still overshoot it. That is inherent to deciding at a
    // till: the figure a shop holds is only as fresh as its last sync, and a
    // budget here is a brake rather than a gate. What must not be exceeded is
    // counted at the centre.
    Ok(tighter(
        tighter(rule.max_discount, rule.caps.remaining()),
        campaign.and_then(|campaign| campaign.caps.remaining()),
    ))
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
            matches_scope(
                rule.scope.applicability.as_ref(),
                &rule.scope.excluded_sku_codes,
                state,
            )
        })
        .map(|(index, _)| index)
        .collect()
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

fn check_conditions(
    rule: &Rule,
    matched: &[usize],
    states: &[LineState],
    context: &PricingContext,
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
    // A running threshold counts what this shopper has already bought in the
    // promotion's window, so the basket that finally crosses the line gets the
    // benefit. The history is the caller's to supply; the engine keeps none.
    if conditions.cumulative {
        if conditions.effective_from.is_none() || conditions.effective_to.is_none() {
            // A running total with no window is a total of nothing. Refused
            // rather than silently treated as a single-basket rule, which would
            // look like it worked and quietly never trigger.
            return Ok(Some(RejectionReason::NotStarted));
        }
        if let Some(history) = context.customer_cumulative.get(&rule.rule_id) {
            quantity = quantity
                .checked_add(history.quantity)
                .ok_or(PricingError::AmountOverflow)?;
            amount = amount.try_add(history.amount)?;
        }
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
    if conditions
        .max_amount
        .is_some_and(|max| amount.minor > max.minor)
    {
        return Ok(Some(RejectionReason::AmountTooHigh));
    }
    Ok(None)
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

/// Apply one rule's price effect to the running totals, returning what it took
/// off. Zero means the rule earned its place in no scenario.
fn apply_price_effect(
    rule: &Rule,
    matched: &[usize],
    states: &[LineState],
    totals: &mut [Money],
    ceiling: Option<Money>,
) -> Result<Money, PricingError> {
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
        Effect::Margin { bps } => {
            for &index in matched {
                let Some(unit_cost) = states[index].unit_cost else {
                    // No cost, no margin. Guessing one would price goods
                    // against a number nobody supplied.
                    continue;
                };
                let unit = unit_cost.try_add(unit_cost.basis_points(*bps)?)?;
                let replaced = unit.times(states[index].quantity)?;
                if replaced.minor >= totals[index].minor {
                    // Not cheaper, so not a discount.
                    continue;
                }
                cuts.push((index, totals[index].try_sub(replaced)?));
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
        // Handled elsewhere: a free item adds a line rather than cutting one,
        // and points carry no price benefit at all.
        Effect::FreeItem { .. } | Effect::EarnPoints(_) => return Ok(Money::ZERO),
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

    for (index, cut) in cuts {
        if cut.is_positive() {
            totals[index] = totals[index].try_sub(cut)?.floor_at_zero();
        }
    }
    Ok(total_cut)
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

fn run_scenario(
    rules: &[&Candidate<'_>],
    states: &[LineState],
    index: &PriceIndex<'_>,
    context: &PricingContext,
) -> Result<Scenario, PricingError> {
    let mut scenario = Scenario::empty(states);
    let mut ordered: Vec<&&Candidate<'_>> = rules.iter().collect();
    ordered.sort_by(|left, right| selection_order(left.rule).cmp(&selection_order(right.rule)));

    for candidate in ordered {
        let rule = candidate.rule;
        if matches!(rule.effect, Effect::FreeItem { .. }) {
            let Some((free, value)) =
                apply_free_item(rule, &candidate.matched, states, index, context)?
            else {
                continue;
            };
            scenario.benefit = scenario.benefit.try_add(value)?;
            scenario.applied.push(AppliedRule {
                rule_id: rule.rule_id.clone(),
                campaign_id: rule.campaign_id.clone(),
                name: rule.name.clone(),
                coupon_code: rule.coupon_code.clone(),
                benefit: value,
            });
            scenario.free.push(free);
            scenario.note(rule);
            continue;
        }
        let cut = apply_price_effect(
            rule,
            &candidate.effect,
            states,
            &mut scenario.totals,
            candidate.ceiling,
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
        });
        scenario.note(rule);
    }
    Ok(scenario)
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

    if let Some(candidate) = base.first() {
        if let Effect::EarnPoints(EarnEffect::SpendRate { spend_per_point }) =
            &candidate.rule.effect
        {
            let basis = earn_basis(candidate.rule, &candidate.matched, states, finals)?;
            let points = if spend_per_point.minor > 0 {
                basis.minor / spend_per_point.minor
            } else {
                0
            };
            let points = cap_points(points, candidate.rule.max_points);
            if points > 0 {
                total += points;
                awards.push(EarnAward {
                    rule_id: candidate.rule.rule_id.clone(),
                    name: candidate.rule.name.clone(),
                    points,
                    basis_amount: basis,
                });
            }
        }
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
            awards.push(EarnAward {
                rule_id: candidate.rule.rule_id.clone(),
                name: candidate.rule.name.clone(),
                points,
                basis_amount: Money::ZERO,
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
        let ceiling = match gate(rule, snapshot, context) {
            Ok(ceiling) => ceiling,
            Err(reason) => {
                rejected.push(RejectedRule::new(rule, reason));
                continue;
            }
        };
        let matched = match_lines(rule, &states);
        if matched.is_empty() {
            rejected.push(RejectedRule::new(rule, RejectionReason::NothingMatched));
            continue;
        }
        if let Some(reason) = check_conditions(rule, &matched, &states, context)? {
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
            ceiling,
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
    let mut winner: Vec<&str> = best
        .applied
        .iter()
        .map(|applied| applied.rule_id.as_str())
        .collect();

    // And one offer for each rule that will not share.
    let mut solo: Vec<&Candidate<'_>> = discount_candidates
        .iter()
        .filter(|candidate| candidate.rule.stacking != Stacking::Stackable)
        .collect();
    solo.sort_by(|left, right| selection_order(left.rule).cmp(&selection_order(right.rule)));
    for candidate in solo {
        let scenario = run_scenario(&[candidate], &states, &index, context)?;
        if scenario.beats(&best) {
            best = scenario;
            winner = vec![candidate.rule.rule_id.as_str()];
        }
    }

    // Whatever did not make it into the winning offer is recorded with the
    // reason a cashier would need, not silently dropped.
    let exclusive_won = winner.len() == 1
        && discount_candidates.iter().any(|candidate| {
            candidate.rule.rule_id == winner[0] && candidate.rule.stacking == Stacking::Exclusive
        });
    for candidate in &discount_candidates {
        if winner.contains(&candidate.rule.rule_id.as_str()) {
            continue;
        }
        let reason = if exclusive_won {
            RejectionReason::DisplacedByExclusiveRule
        } else {
            RejectionReason::OutbidByBetterOffer
        };
        rejected.push(RejectedRule::new(candidate.rule, reason));
    }

    let (earn_awards, points_earned) = resolve_earn(&earn_candidates, &states, &best.totals)?;

    let mut lines = Vec::with_capacity(states.len());
    let mut total = Money::ZERO;
    for (index, state) in states.iter().enumerate() {
        let line_total = best.totals[index];
        total = total.try_add(line_total)?;
        lines.push(LineResult {
            sku_code: state.sku_code.clone(),
            quantity: state.quantity,
            source: state.source,
            base_unit_price: state.list_unit_price,
            unit_price: state.unit_price,
            line_total,
            currency: state.currency.clone(),
            tax_category: state.tax_category.clone(),
            publication_version: state.publication_version,
            markdown_id: state.markdown_id.clone(),
            posting_class: state.posting_class,
        });
    }
    for free in &best.free {
        total = total.try_add(free.unit_price.times(free.quantity)?)?;
    }

    rejected.sort_by(|left, right| left.rule_id.cmp(&right.rule_id));

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
    };
    result.trace_id = fingerprint(context, &result);
    Ok(result)
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
        absorb(&format!("{:?}", line.source));
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
