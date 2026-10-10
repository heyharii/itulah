use super::*;
use chrono::TimeZone;

// ---------------------------------------------------------------------------
// A note on the `// Acceptance: XXX-000` labels below
// ---------------------------------------------------------------------------
//
// A test carrying one is ADOPTED by `backend/tests/acceptance.rs` as the proof
// of that row of the locked Commercial V1 acceptance plan. The harness does not
// copy the arithmetic — a second expected value agrees on the day it is written
// and diverges later — it names the test and checks the name is still in this
// file.
//
// So renaming or deleting one of these fails the acceptance harness. That is
// the point. Without it, a scenario the business locked would quietly lose the
// only evidence behind it and the coverage report would go on claiming it.
//
// Changing what one of these ASSERTS is a different matter again: the figures
// came from `docs/fixtures/commercial-v1-golden-fixtures.json` and were
// computed away from this engine. If an edit moves them, the edit is what is
// wrong.
use std::collections::{BTreeMap, BTreeSet};

fn at(day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, day, 12, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("bad fixture date"))
}

fn entry(sku: &str, scope: Level, site: Option<&str>, price: i64) -> PriceEntry {
    PriceEntry {
        sku_code: sku.into(),
        applies_to: match (scope, site) {
            (Level::Site, Some(site_id)) => PriceLevel::Site {
                site_id: site_id.into(),
            },
            _ => PriceLevel::Company,
        },
        channel: "STORE".into(),
        sellable: true,
        currency: Currency("IDR".into()),
        unit_price: Money::new(price),
        tax_category: "STANDARD".into(),
        publication_version: 1,
        effective_from: at(1),
        effective_to: None,
    }
}

/// Which level a fixture price sits at. The engine's own [`PriceLevel`] carries
/// its target inside it; this is just a shorthand for the tests.
#[derive(Clone, Copy)]
enum Level {
    Company,
    Site,
}

fn markdown(sku: &str, price: i64) -> Markdown {
    Markdown {
        markdown_id: "MD-1".into(),
        sku_code: Some(sku.into()),
        article_code: None,
        applies_to: PriceLevel::Company,
        replacement_unit_price: Money::new(price),
        priority: 0,
        publication_version: 1,
        campaign_id: None,
        days: DaySet::default(),
        time_window: None,
        effective_from: at(1),
        effective_to: None,
    }
}

fn context() -> PricingContext {
    PricingContext::new("store-01", "STORE", at(5))
}

fn snapshot(entries: Vec<PriceEntry>, markdowns: Vec<Markdown>) -> PricingSnapshot {
    PricingSnapshot {
        publication_version: 1,
        entries,
        markdowns,
        ..Default::default()
    }
}

fn rule(id: &str, effect: Effect) -> Rule {
    Rule {
        rule_id: id.into(),
        campaign_id: None,
        name: format!("Promo {id}"),
        status: RuleStatus::Active,
        scope: RuleScope::default(),
        conditions: Conditions::default(),
        effect,
        coupon_code: None,
        max_discount: None,
        caps: Caps::default(),
        max_uses_per_customer: None,
        priority: 0,
        stacking: Stacking::Alone,
        // The defaults, stated in the helper so a test that wants the other
        // reading has to say so — which is how a reader can tell the two apart.
        exclusive_scope: ExclusiveScope::Basket,
        markdown_policy: MarkdownPolicy::Exclude,
        advisory: false,
        earn_basis: EarnBasis::default(),
        points_combination: PointsCombination::Highest,
        max_points: None,
    }
}

/// A plain percentage off, the default (non-compounding) way.
fn percent(bps: i64) -> Effect {
    Effect::Percent {
        bps,
        compound: false,
    }
}

fn skus(codes: &[&str]) -> BTreeSet<String> {
    codes.iter().map(|code| (*code).to_string()).collect()
}

fn resolved(snap: &PricingSnapshot, context: &PricingContext, cart: &[CartLine]) -> PricingResult {
    price_cart(snap, context, cart).unwrap_or_else(|error| panic!("{error}"))
}

fn applied_ids(result: &PricingResult) -> Vec<&str> {
    let mut ids: Vec<&str> = result
        .applied_rules
        .iter()
        .map(|applied| applied.rule_id.as_str())
        .collect();
    ids.sort_unstable();
    ids
}

fn why(result: &PricingResult, rule_id: &str) -> RejectionReason {
    result
        .rejected_rules
        .iter()
        .find(|rejected| rejected.rule_id == rule_id)
        .map(|rejected| rejected.reason)
        .unwrap_or_else(|| panic!("{rule_id} was not rejected: {:?}", result.rejected_rules))
}

// ---------------------------------------------------------------------------
// The base cascade
// ---------------------------------------------------------------------------

#[test]
fn a_shops_own_price_beats_the_company_one() {
    let snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU1", Level::Site, Some("store-01"), 90_000),
        ],
        vec![],
    );
    let found =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(found.unit_price, Money::new(90_000));
}

#[test]
fn another_shops_price_is_not_this_shops_price() {
    let snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU1", Level::Site, Some("store-99"), 10_000),
        ],
        vec![],
    );
    let found =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(
        found.unit_price,
        Money::new(100_000),
        "a bargain at another branch is not a bargain here"
    );
}

#[test]
fn the_order_prices_arrive_in_changes_nothing() {
    let forwards = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU1", Level::Site, Some("store-01"), 90_000),
        ],
        vec![],
    );
    let backwards = snapshot(
        vec![
            entry("SKU1", Level::Site, Some("store-01"), 90_000),
            entry("SKU1", Level::Company, None, 100_000),
        ],
        vec![],
    );
    assert_eq!(
        resolve_price(&forwards, &context(), "SKU1").map(|e| e.unit_price),
        resolve_price(&backwards, &context(), "SKU1").map(|e| e.unit_price),
        "the centre and the till must not be able to disagree by luck of ordering"
    );
}

#[test]
fn a_new_price_book_supersedes_a_shop_price_from_an_old_one() {
    let mut old_site = entry("SKU1", Level::Site, Some("store-01"), 90_000);
    old_site.publication_version = 3;
    let mut new_company = entry("SKU1", Level::Company, None, 120_000);
    new_company.publication_version = 4;

    let snap = snapshot(vec![old_site, new_company], vec![]);
    let found =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(
        found.unit_price,
        Money::new(120_000),
        "a superseded book must not keep a branch on last season's price"
    );
}

#[test]
fn within_one_price_book_the_shop_still_wins() {
    let mut site = entry("SKU1", Level::Site, Some("store-01"), 90_000);
    site.publication_version = 4;
    let mut company = entry("SKU1", Level::Company, None, 120_000);
    company.publication_version = 4;

    let snap = snapshot(vec![company, site], vec![]);
    let found =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(found.unit_price, Money::new(90_000));
}

#[test]
fn a_price_that_has_not_started_is_not_a_price() {
    let mut future = entry("SKU1", Level::Site, Some("store-01"), 50_000);
    future.effective_from = at(9);
    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000), future],
        vec![],
    );
    let found =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(found.unit_price, Money::new(100_000));
}

#[test]
fn an_unpriced_item_stops_the_sale_rather_than_guessing() {
    let snap = snapshot(vec![], vec![]);
    match price_cart(&snap, &context(), &[CartLine::new("SKU1", 1)]) {
        Err(PricingError::NoPrice { sku_code, .. }) => assert_eq!(sku_code, "SKU1"),
        other => panic!("a till must not invent a price: {other:?}"),
    }
}

#[test]
fn something_withdrawn_from_sale_cannot_be_sold() {
    let mut withdrawn = entry("SKU1", Level::Company, None, 100_000);
    withdrawn.sellable = false;
    let snap = snapshot(vec![withdrawn], vec![]);
    match price_cart(&snap, &context(), &[CartLine::new("SKU1", 1)]) {
        Err(PricingError::NotSellable { .. }) => {}
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn one_cart_cannot_mix_two_currencies() {
    let mut foreign = entry("SKU2", Level::Company, None, 20);
    foreign.currency = Currency("USD".into());
    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000), foreign],
        vec![],
    );
    match price_cart(
        &snap,
        &context(),
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    ) {
        Err(PricingError::MixedCurrency { .. }) => {}
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_total_that_cannot_be_counted_is_an_error_not_a_wrapped_number() {
    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, i64::MAX / 2)],
        vec![],
    );
    match price_cart(&snap, &context(), &[CartLine::new("SKU1", 4)]) {
        Err(PricingError::AmountOverflow) => {}
        other => panic!("expected an overflow refusal, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Markdown: a price source, not a discount
// ---------------------------------------------------------------------------

#[test]
fn a_markdown_replaces_the_price_rather_than_discounting_it() {
    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000)],
        vec![markdown("SKU1", 75_000)],
    );
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 2)]);

    let line = &result.lines[0];
    assert_eq!(line.source, PriceSource::Markdown);
    assert_eq!(line.base_unit_price, Money::new(100_000), "what it was");
    assert_eq!(line.unit_price, Money::new(75_000), "what it is");
    assert_eq!(line.line_total, Money::new(150_000));
    assert_eq!(line.markdown_id.as_deref(), Some("MD-1"));
    assert_eq!(
        result.discount_total,
        Money::ZERO,
        "a markdown is not a discount and must not be booked as one"
    );
}

#[test]
fn two_markdowns_do_not_both_apply() {
    let mut sharper = markdown("SKU1", 60_000);
    sharper.markdown_id = "MD-2".into();
    sharper.priority = 20;
    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000)],
        vec![markdown("SKU1", 75_000), sharper],
    );
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.lines[0].unit_price,
        Money::new(60_000),
        "one replacement wins outright; they do not compound"
    );
}

#[test]
fn a_markdown_can_clear_a_whole_range_at_once() {
    let mut range = markdown("SKU1", 0);
    range.markdown_id = "MD-RANGE".into();
    range.sku_code = None;
    range.article_code = Some("KEMEJA-A".into());
    range.replacement_unit_price = Money::new(80_000);

    let snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 100_000),
        ],
        vec![range],
    );
    let result = resolved(
        &snap,
        &context(),
        &[
            CartLine::new("SKU1", 1).of_article("KEMEJA-A"),
            CartLine::new("SKU2", 1).of_article("CELANA-B"),
        ],
    );
    assert_eq!(
        result.lines[0].unit_price,
        Money::new(80_000),
        "in the range"
    );
    assert_eq!(
        result.lines[1].unit_price,
        Money::new(100_000),
        "a different range is untouched"
    );
}

#[test]
fn one_colour_can_be_cleared_harder_than_its_range() {
    let mut range = markdown("SKU1", 0);
    range.markdown_id = "MD-RANGE".into();
    range.sku_code = None;
    range.article_code = Some("KEMEJA-A".into());
    range.replacement_unit_price = Money::new(80_000);
    range.priority = 99; // even with a much higher priority

    let mut one_colour = markdown("SKU1", 50_000);
    one_colour.markdown_id = "MD-COLOUR".into();

    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000)],
        vec![range, one_colour],
    );
    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SKU1", 1).of_article("KEMEJA-A")],
    );
    assert_eq!(
        result.lines[0].unit_price,
        Money::new(50_000),
        "naming one SKU is the more deliberate statement and wins"
    );
}

#[test]
fn a_markdown_naming_nothing_marks_nothing_down() {
    // Two empty fields must not become "everything at this price".
    let mut nothing = markdown("SKU1", 1);
    nothing.sku_code = None;
    nothing.article_code = None;
    let snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000)],
        vec![nothing],
    );
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.lines[0].unit_price, Money::new(100_000));
}

// ---------------------------------------------------------------------------
// Rules: the effects
// ---------------------------------------------------------------------------

#[test]
fn a_percentage_comes_off_every_line_it_matches() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule("R1", percent(1_000)));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 3)]);
    assert_eq!(result.lines[0].line_total, Money::new(270_000));
    assert_eq!(result.discount_total, Money::new(30_000));
    assert_eq!(applied_ids(&result), vec!["R1"]);
}

#[test]
fn a_flat_amount_comes_off_the_cart_once_not_once_per_line() {
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 100_000),
        ],
        vec![],
    );
    snap.rules.push(rule(
        "R1",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    ));

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    );
    assert_eq!(
        result.discount_total,
        Money::new(50_000),
        "fifty thousand off means fifty thousand, not fifty per line"
    );
    assert_eq!(result.total, Money::new(150_000));
}

#[test]
fn an_apportioned_amount_sums_to_exactly_itself() {
    // Three equal lines and an amount that does not divide by three. The
    // remainder has to land somewhere, and the parts must still sum to the
    // whole — otherwise the shop gives away a rupiah it never authorised.
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 10_000),
            entry("SKU2", Level::Company, None, 10_000),
            entry("SKU3", Level::Company, None, 10_000),
        ],
        vec![],
    );
    snap.rules.push(rule(
        "R1",
        Effect::Amount {
            amount: Money::new(10_000),
        },
    ));

    let result = resolved(
        &snap,
        &context(),
        &[
            CartLine::new("SKU1", 1),
            CartLine::new("SKU2", 1),
            CartLine::new("SKU3", 1),
        ],
    );
    assert_eq!(result.discount_total, Money::new(10_000));
    assert_eq!(result.total, Money::new(20_000));
    let sum: i64 = result.lines.iter().map(|line| line.line_total.minor).sum();
    assert_eq!(sum, result.total.minor);
}

#[test]
fn a_flat_amount_larger_than_the_basket_does_not_pay_the_shopper() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 10_000)], vec![]);
    snap.rules.push(rule(
        "R1",
        Effect::Amount {
            amount: Money::new(500_000),
        },
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::ZERO);
    assert!(
        !result.total.is_negative(),
        "a discount must never turn a sale into a payout"
    );
}

#[test]
fn a_fixed_price_replaces_what_the_line_comes_to() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule(
        "R1",
        Effect::FixedUnitPrice {
            unit_price: Money::new(79_000),
        },
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 2)]);
    assert_eq!(result.total, Money::new(158_000));
}

#[test]
fn a_rules_cap_limits_what_it_can_take_off_one_cart() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 1_000_000)], vec![]);
    let mut capped = rule("R1", percent(5_000));
    capped.max_discount = Some(Money::new(100_000));
    snap.rules.push(capped);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.discount_total,
        Money::new(100_000),
        "half a million would have come off without the cap"
    );
    assert_eq!(result.total, Money::new(900_000));
}

// ---------------------------------------------------------------------------
// Rules: scope and conditions
// ---------------------------------------------------------------------------

#[test]
fn a_rule_matches_only_the_products_it_names() {
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 100_000),
        ],
        vec![],
    );
    let mut narrow = rule("R1", percent(1_000));
    narrow.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SKU1"]),
    });
    snap.rules.push(narrow);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    );
    assert_eq!(result.lines[0].line_total, Money::new(90_000));
    assert_eq!(result.lines[1].line_total, Money::new(100_000));
}

#[test]
fn an_exclusion_beats_the_scope_that_would_have_included_it() {
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 100_000),
        ],
        vec![],
    );
    let mut broad = rule("R1", percent(1_000));
    broad.scope.applicability = Some(Applicability::Article {
        article_codes: skus(&["KEMEJA-A"]),
    });
    broad.scope.excluded_sku_codes = skus(&["SKU2"]);
    snap.rules.push(broad);

    let result = resolved(
        &snap,
        &context(),
        &[
            CartLine::new("SKU1", 1).of_article("KEMEJA-A"),
            CartLine::new("SKU2", 1).of_article("KEMEJA-A"),
        ],
    );
    assert_eq!(result.lines[0].line_total, Money::new(90_000));
    assert_eq!(
        result.lines[1].line_total,
        Money::new(100_000),
        "a hole carved in a rule must not be fillable by that same rule"
    );
}

#[test]
fn a_rule_for_another_shop_does_not_run_here() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut elsewhere = rule("R1", percent(5_000));
    elsewhere.scope.site_ids = skus(&["store-99"]);
    snap.rules.push(elsewhere);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::WrongSite);
}

#[test]
fn a_minimum_that_is_not_met_leaves_the_promotion_shut() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut needs_three = rule("R1", percent(1_000));
    needs_three.conditions.min_quantity = 3;
    snap.rules.push(needs_three);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 2)]);
    assert_eq!(result.total, Money::new(200_000));
    assert_eq!(why(&result, "R1"), RejectionReason::QuantityTooLow);

    let met = resolved(&snap, &context(), &[CartLine::new("SKU1", 3)]);
    assert_eq!(met.total, Money::new(270_000));
}

#[test]
fn a_promotion_that_ended_does_not_come_off() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut over = rule("R1", percent(1_000));
    over.conditions.effective_to = Some(at(3));
    snap.rules.push(over);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::Expired);
}

#[test]
fn a_spent_budget_closes_the_promotion() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut broke = rule("R1", percent(1_000));
    broke.caps.budget = Some(Money::new(1_000_000));
    broke.caps.spent = Money::new(1_000_000);
    snap.rules.push(broke);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::BudgetSpent);
}

#[test]
fn a_nearly_spent_budget_gives_only_what_is_left() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut nearly = rule("R1", percent(5_000));
    nearly.caps.budget = Some(Money::new(1_000_000));
    nearly.caps.spent = Money::new(990_000);
    snap.rules.push(nearly);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.discount_total,
        Money::new(10_000),
        "fifty thousand was due but only ten thousand of budget remained"
    );
}

// ---------------------------------------------------------------------------
// Coupons: a gate, never a discount
// ---------------------------------------------------------------------------

fn coupon(code: &str, rule_id: &str) -> Coupon {
    Coupon {
        code: code.into(),
        rule_id: rule_id.into(),
        active: true,
        customer_id: None,
        valid_from: None,
        valid_to: None,
        max_uses: None,
        used: 0,
    }
}

fn snapshot_with_coupon() -> PricingSnapshot {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut gated = rule("R1", percent(2_000));
    gated.coupon_code = Some("LEBARAN".into());
    snap.rules.push(gated);
    snap.coupons.push(coupon("LEBARAN", "R1"));
    snap
}

#[test]
fn a_gated_promotion_stays_shut_until_the_code_is_presented() {
    let snap = snapshot_with_coupon();

    let without = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(without.total, Money::new(100_000));
    assert_eq!(why(&without, "R1"), RejectionReason::NoCoupon);

    let with = resolved(
        &snap,
        &context().with_coupon("LEBARAN"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(with.total, Money::new(80_000));
    assert_eq!(applied_ids(&with), vec!["R1"]);
}

#[test]
fn an_expired_coupon_says_so_rather_than_saying_nothing() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].valid_to = Some(at(3));

    let result = resolved(
        &snap,
        &context().with_coupon("LEBARAN"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(
        why(&result, "R1"),
        RejectionReason::CouponExpired,
        "'that coupon expired' and 'no promotion applies' are different conversations"
    );
}

#[test]
fn a_spent_coupon_cannot_be_spent_again() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].max_uses = Some(1);
    snap.coupons[0].used = 1;

    let result = resolved(
        &snap,
        &context().with_coupon("LEBARAN"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(why(&result, "R1"), RejectionReason::CouponUsedUp);
}

#[test]
fn a_limited_legacy_coupon_is_refused_until_it_can_be_reserved_online() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].max_uses = Some(2);

    let result = resolved(
        &snap,
        &context().with_coupon("LEBARAN"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(
        why(&result, "R1"),
        RejectionReason::CouponNeedsOnlineAuthorization
    );
    assert_eq!(
        check_coupon(&snap, &context(), "LEBARAN"),
        Err(RejectionReason::CouponNeedsOnlineAuthorization)
    );
}

/// A limited coupon with no hold is refused, exactly as before holds existed:
/// the snapshot's count is as old as the last sync, and admitting from it is
/// how two shops both give away the hundredth use.
#[test]
fn a_limited_coupon_without_a_hold_still_needs_head_office() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].max_uses = Some(100);

    // A hold for a DIFFERENT code opens nothing here.
    let context = context()
        .with_coupon("LEBARAN")
        .with_coupon_authorization("OTHERCODE", "hold-for-something-else");
    let result = resolved(&snap, &context, &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(
        why(&result, "R1"),
        RejectionReason::CouponNeedsOnlineAuthorization
    );
    assert_eq!(
        check_coupon(&snap, &context, "LEBARAN"),
        Err(RejectionReason::CouponNeedsOnlineAuthorization)
    );
}

/// With head office's hold the limited coupon applies — and the snapshot's own
/// count is not read against it, because that count is the stale number the
/// hold replaces (here it even says "used up", as this shop's brake can after
/// its own unsynced sales).
#[test]
fn a_limited_coupon_applies_on_head_offices_hold() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].max_uses = Some(100);

    let held = context()
        .with_coupon("LEBARAN")
        .with_coupon_authorization("lebaran", "6f1c0d6e-hold");
    let result = resolved(&snap, &held, &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(80_000));
    assert_eq!(applied_ids(&result), vec!["R1"]);
    assert!(check_coupon(&snap, &held, "LEBARAN").is_ok());

    snap.coupons[0].used = 100;
    let result = resolved(&snap, &held, &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(80_000));

    // The rest of the gate still stands: a hold does not revive a lapsed code.
    snap.coupons[0].valid_to = Some(at(3));
    let result = resolved(&snap, &held, &[CartLine::new("SKU1", 1)]);
    assert_eq!(why(&result, "R1"), RejectionReason::CouponExpired);
}

/// An uncapped coupon needs no hold and ignores one it is given.
#[test]
fn an_uncapped_coupon_is_unchanged_by_holds() {
    let snap = snapshot_with_coupon();

    let plain = resolved(
        &snap,
        &context().with_coupon("LEBARAN"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(plain.total, Money::new(80_000));

    let held = resolved(
        &snap,
        &context()
            .with_coupon("LEBARAN")
            .with_coupon_authorization("LEBARAN", "unneeded-hold"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(held.total, plain.total);
    assert_eq!(applied_ids(&held), vec!["R1"]);
}

#[test]
fn a_coupon_issued_to_someone_is_not_bearer_paper() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].customer_id = Some("member-1".into());

    let wrong_hands = resolved(
        &snap,
        &context().with_coupon("LEBARAN").for_customer("member-2"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(
        why(&wrong_hands, "R1"),
        RejectionReason::CouponBelongsToSomeoneElse
    );

    let right_hands = resolved(
        &snap,
        &context().with_coupon("LEBARAN").for_customer("member-1"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(right_hands.total, Money::new(80_000));
}

#[test]
fn a_code_can_be_checked_before_there_is_a_basket() {
    let snap = snapshot_with_coupon();
    assert!(check_coupon(&snap, &context(), "LEBARAN").is_ok());
    assert_eq!(
        check_coupon(&snap, &context(), "NATAL"),
        Err(RejectionReason::CouponUnknown)
    );
}

#[test]
fn a_code_that_opens_a_different_door_does_not_open_this_one() {
    let mut snap = snapshot_with_coupon();
    snap.coupons[0].rule_id = "R-OTHER".into();
    let result = resolved(
        &snap,
        &context().with_coupon("LEBARAN"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(result.total, Money::new(100_000));
}

// ---------------------------------------------------------------------------
// Free items
// ---------------------------------------------------------------------------

#[test]
fn buy_two_get_one_grants_a_line_the_till_must_ring() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut bogo = rule(
        "R1",
        Effect::FreeItem {
            sku_code: Some("SKU1".into()),
            quantity: 1,
            every_matched_quantity: Some(2),
            after_matched_quantity: 0,
            unit_price: Money::ZERO,
        },
    );
    bogo.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SKU1"]),
    });
    snap.rules.push(bogo);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 4)]);
    assert_eq!(result.free_lines.len(), 1);
    assert_eq!(
        result.free_lines[0].quantity, 2,
        "four bought is two free, not two and a half"
    );
    assert_eq!(result.free_lines[0].value, Money::new(200_000));
    assert_eq!(
        result.total,
        Money::new(400_000),
        "the free items add nothing to the bill"
    );
}

#[test]
fn a_free_item_nobody_can_price_is_not_granted() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule(
        "R1",
        Effect::FreeItem {
            sku_code: Some("GHOST".into()),
            quantity: 1,
            every_matched_quantity: None,
            after_matched_quantity: 0,
            unit_price: Money::ZERO,
        },
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert!(
        result.free_lines.is_empty(),
        "a till cannot ring up an item it has no price for"
    );
}

// ---------------------------------------------------------------------------
// Stacking: the search for the best offer
// ---------------------------------------------------------------------------

#[test]
fn stackable_promotions_combine() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut first = rule("R1", percent(1_000));
    first.stacking = Stacking::Stackable;
    let mut second = rule(
        "R2",
        Effect::Amount {
            amount: Money::new(5_000),
        },
    );
    second.stacking = Stacking::Stackable;
    snap.rules.push(first);
    snap.rules.push(second);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(applied_ids(&result), vec!["R1", "R2"]);
    assert_eq!(result.total, Money::new(85_000));
}

#[test]
fn the_shopper_gets_the_better_of_two_offers_that_cannot_combine() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut small = rule("R1", percent(1_000));
    small.stacking = Stacking::Stackable;
    let mut large = rule("R2", percent(3_000));
    large.stacking = Stacking::Alone;
    snap.rules.push(small);
    snap.rules.push(large);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.total,
        Money::new(70_000),
        "thirty per cent alone beats ten per cent stacked with nothing else"
    );
    assert_eq!(applied_ids(&result), vec!["R2"]);
    assert_eq!(why(&result, "R1"), RejectionReason::OutbidByBetterOffer);
}

#[test]
fn an_exclusive_promotion_shuts_the_others_out_when_it_wins() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut stacked_a = rule("R1", percent(1_000));
    stacked_a.stacking = Stacking::Stackable;
    let mut stacked_b = rule("R2", percent(1_000));
    stacked_b.stacking = Stacking::Stackable;
    let mut only_me = rule("R3", percent(4_000));
    only_me.stacking = Stacking::Exclusive;
    snap.rules.push(stacked_a);
    snap.rules.push(stacked_b);
    snap.rules.push(only_me);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(applied_ids(&result), vec!["R3"]);
    assert_eq!(result.total, Money::new(60_000));
    assert_eq!(
        why(&result, "R1"),
        RejectionReason::DisplacedByExclusiveRule
    );
}

#[test]
fn an_exclusive_promotion_that_is_worse_does_not_win() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut stacked_a = rule("R1", percent(2_000));
    stacked_a.stacking = Stacking::Stackable;
    let mut stacked_b = rule("R2", percent(2_000));
    stacked_b.stacking = Stacking::Stackable;
    let mut only_me = rule("R3", percent(1_000));
    only_me.stacking = Stacking::Exclusive;
    snap.rules.push(stacked_a);
    snap.rules.push(stacked_b);
    snap.rules.push(only_me);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(applied_ids(&result), vec!["R1", "R2"]);
    assert_eq!(why(&result, "R3"), RejectionReason::OutbidByBetterOffer);
}

// Acceptance: COM-008.
#[test]
fn the_order_rules_arrive_in_changes_nothing() {
    // The one property that makes an offline till and the centre agree.
    let build = |reversed: bool| {
        let mut snap = snapshot(
            vec![
                entry("SKU1", Level::Company, None, 100_000),
                entry("SKU2", Level::Company, None, 70_000),
            ],
            vec![],
        );
        let mut a = rule("R-A", percent(1_500));
        a.stacking = Stacking::Stackable;
        let mut b = rule(
            "R-B",
            Effect::Amount {
                amount: Money::new(20_000),
            },
        );
        b.stacking = Stacking::Stackable;
        let mut c = rule("R-C", percent(2_500));
        c.stacking = Stacking::Exclusive;
        let mut rules = vec![a, b, c];
        if reversed {
            rules.reverse();
        }
        snap.rules = rules;
        snap
    };
    let cart = [CartLine::new("SKU1", 2), CartLine::new("SKU2", 1)];
    let forwards = resolved(&build(false), &context(), &cart);
    let backwards = resolved(&build(true), &context(), &cart);

    assert_eq!(forwards.total, backwards.total);
    assert_eq!(applied_ids(&forwards), applied_ids(&backwards));
    assert_eq!(forwards.rejected_rules, backwards.rejected_rules);
}

#[test]
fn a_tie_is_broken_the_same_way_every_time() {
    let build = |reversed: bool| {
        let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
        let mut a = rule("R-A", percent(1_000));
        a.stacking = Stacking::Alone;
        let mut b = rule("R-B", percent(1_000));
        b.stacking = Stacking::Alone;
        snap.rules = if reversed { vec![b, a] } else { vec![a, b] };
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];
    let forwards = resolved(&build(false), &context(), &cart);
    let backwards = resolved(&build(true), &context(), &cart);
    assert_eq!(applied_ids(&forwards), applied_ids(&backwards));
    assert_eq!(
        applied_ids(&forwards),
        vec!["R-A"],
        "equal offers resolve to the lower rule id, on every machine"
    );
}

#[test]
fn a_promotion_that_would_take_nothing_off_is_not_recorded_as_applying() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut nothing = rule("R1", percent(0));
    nothing.stacking = Stacking::Stackable;
    snap.rules.push(nothing);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert!(result.applied_rules.is_empty());
    assert_eq!(result.total, Money::new(100_000));
}

#[test]
fn a_markdown_and_a_promotion_both_land_and_do_not_double_count() {
    let mut snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000)],
        vec![markdown("SKU1", 80_000)],
    );
    // What this test is about is the BASIS — a promotion works on the marked
    // down price, not the list price. For it to reach the line at all the rule
    // has to allow cleared goods, which is now something a rule has to say.
    let mut on_sale_too = rule("R1", percent(1_000));
    on_sale_too.markdown_policy = MarkdownPolicy::Allow;
    snap.rules.push(on_sale_too);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.lines[0].base_unit_price, Money::new(100_000));
    assert_eq!(result.lines[0].unit_price, Money::new(80_000));
    assert_eq!(
        result.discount_total,
        Money::new(8_000),
        "the promotion discounts the marked-down price, not the list price"
    );
    assert_eq!(result.total, Money::new(72_000));
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

#[test]
fn points_accrue_from_the_basket_without_touching_the_bill() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(10_000),
        }),
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 10);
    assert_eq!(
        result.total,
        Money::new(100_000),
        "earning points costs the shopper nothing today"
    );
    assert!(result.applied_rules.is_empty(), "earning is not a discount");
}

// Acceptance: PTS-003.
#[test]
fn the_earning_rate_is_chosen_per_line_not_for_the_whole_basket() {
    // Shirts earn a point per 1.000; shoes earn one per 500. That is two
    // offers, not a contest. Giving the whole basket the better rate pays
    // points nobody offered; giving it the worse one drops an offer that was
    // made; and taking a single winner for the basket used to do BOTH — the
    // losing rule's lines earned nothing at all.
    let mut snap = snapshot(
        vec![
            entry("SHIRT", Level::Company, None, 100_000),
            entry("SHOES", Level::Company, None, 100_000),
        ],
        vec![],
    );

    let mut shirt = rule(
        "E-SHIRT",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    );
    shirt.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHIRT"]),
    });

    let mut shoes = rule(
        "E-SHOES",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(500),
        }),
    );
    shoes.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHOES"]),
    });

    snap.rules.push(shirt);
    snap.rules.push(shoes);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHIRT", 1), CartLine::new("SHOES", 1)],
    );
    // 100 for the shirt at 1.000 each, 200 for the shoes at 500 each.
    // Not 400 (the better rate over everything) and not 200 (one winner).
    assert_eq!(result.points_earned, 300);
    assert_eq!(
        result.earn_awards.len(),
        2,
        "both offers earned on their own"
    );
}

#[test]
fn the_better_rate_wins_the_line_both_offers_reach() {
    // Where two rates cover the same line, the line earns at the better one —
    // once, not twice.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule(
        "E-SLOW",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(10_000),
        }),
    ));
    snap.rules.push(rule(
        "E-FAST",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 100, "the better rate, and only it");
    assert_eq!(result.earn_awards.len(), 1);
    assert_eq!(result.earn_awards[0].rule_id, "E-FAST");
}

#[test]
fn a_generous_points_offer_never_suppresses_a_real_discount() {
    // The reason points are resolved on their own channel: if an earn rule
    // competed in the discount search, its "benefit" would crowd out a rule
    // that actually reduces the bill.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut discount = rule("R1", percent(1_000));
    discount.stacking = Stacking::Stackable;
    snap.rules.push(discount);
    snap.rules.push(rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.total,
        Money::new(90_000),
        "the discount still applies"
    );
    // 90, not 100. The default earning basis is post-discount net: points are
    // earned on what was actually paid for the goods, not on the ticket the
    // shopper did not pay. This expectation used to read 100 because the
    // default was pre-discount, which was never the stated policy.
    assert_eq!(result.points_earned, 90);
}

#[test]
fn one_earning_rate_wins_and_bonuses_add_to_it() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut slow = rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(20_000),
        }),
    );
    slow.priority = 1;
    let mut fast = rule(
        "E2",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(10_000),
        }),
    );
    fast.priority = 9;
    snap.rules.push(slow);
    snap.rules.push(fast);
    snap.rules.push(rule(
        "E3",
        Effect::EarnPoints(EarnEffect::FixedPoints { points: 50 }),
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.points_earned, 60,
        "one rate (10) plus the bonus (50); a shop has one earning rate, not two"
    );
    assert_eq!(result.earn_awards.len(), 2);
}

#[test]
fn points_accrue_on_what_the_shirt_now_costs_not_what_it_used_to() {
    let mut snap = snapshot(
        vec![entry("SKU1", Level::Company, None, 100_000)],
        vec![markdown("SKU1", 50_000)],
    );
    let mut earns_on_sale_goods = rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(10_000),
        }),
    );
    earns_on_sale_goods.markdown_policy = MarkdownPolicy::Allow;
    snap.rules.push(earns_on_sale_goods);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 5);
}

#[test]
fn a_points_cap_holds() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 1_000_000)], vec![]);
    let mut capped = rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    );
    capped.max_points = Some(100);
    snap.rules.push(capped);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 100);
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

#[test]
fn the_catalogue_quotes_what_the_till_will_charge() {
    let snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Site, Some("store-01"), 45_000),
        ],
        vec![markdown("SKU1", 75_000)],
    );
    let context = context();
    let listed = price_catalog(
        &snap,
        &context,
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    );
    let rung = resolved(
        &snap,
        &context,
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    );

    for (shelf, till) in listed.iter().zip(rung.lines.iter()) {
        assert_eq!(shelf.sku_code, till.sku_code);
        assert_eq!(
            shelf.unit_price, till.unit_price,
            "the shelf and the receipt must never quote different numbers"
        );
        assert_eq!(shelf.source, till.source);
    }
}

#[test]
fn the_shelf_edge_does_not_advertise_a_basket_promotion() {
    // "Buy two, get 20% off" is not this product's price, and putting it on a
    // shelf edge promises a number the counter will not honour for one item.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut bulk = rule("R1", percent(2_000));
    bulk.conditions.min_quantity = 2;
    snap.rules.push(bulk);

    let listed = price_catalog(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(listed[0].unit_price, Money::new(100_000));
}

// ---------------------------------------------------------------------------
// Legacy parity: the effects and scopes ported from the Go engine
// ---------------------------------------------------------------------------

#[test]
fn two_ten_per_cent_promotions_come_to_twenty_not_nineteen() {
    // The default anybody would assume, and the one that was wrong. A
    // merchandiser advertising "10% + 10%" has promised twenty per cent, and a
    // till that compounds them shorts the shopper on every basket.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut first = rule("R1", percent(1_000));
    first.stacking = Stacking::Stackable;
    let mut second = rule("R2", percent(1_000));
    second.stacking = Stacking::Stackable;
    snap.rules.push(first);
    snap.rules.push(second);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(80_000));
    assert_eq!(result.discount_total, Money::new(20_000));
}

#[test]
fn a_compounding_promotion_says_so_and_takes_less() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut first = rule("R1", percent(1_000));
    first.stacking = Stacking::Stackable;
    let mut second = rule(
        "R2",
        Effect::Percent {
            bps: 1_000,
            compound: true,
        },
    );
    second.stacking = Stacking::Stackable;
    snap.rules.push(first);
    snap.rules.push(second);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.total,
        Money::new(81_000),
        "the second ten per cent came off the ninety thousand that was left"
    );
}

#[test]
fn two_deep_discounts_cannot_between_them_take_more_than_the_line() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut first = rule("R1", percent(6_000));
    first.stacking = Stacking::Stackable;
    let mut second = rule("R2", percent(6_000));
    second.stacking = Stacking::Stackable;
    snap.rules.push(first);
    snap.rules.push(second);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::ZERO);
    assert_eq!(
        result.discount_total,
        Money::new(100_000),
        "the reported discount must be what was actually given, not 120%"
    );
}

#[test]
fn buy_a_suit_and_the_shirt_is_half_price() {
    // The conditions read the suits; the money comes off the shirts.
    let mut snap = snapshot(
        vec![
            entry("JAS001", Level::Company, None, 2_000_000),
            entry("KEM001", Level::Company, None, 300_000),
        ],
        vec![],
    );
    let mut offer = rule("R1", percent(5_000));
    offer.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["JAS001"]),
    });
    offer.scope.effect_on = Some(Applicability::Sku {
        sku_codes: skus(&["KEM001"]),
    });
    snap.rules.push(offer);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("JAS001", 1), CartLine::new("KEM001", 1)],
    );
    assert_eq!(
        result.lines[0].line_total,
        Money::new(2_000_000),
        "the suit"
    );
    assert_eq!(result.lines[1].line_total, Money::new(150_000), "the shirt");
}

#[test]
fn a_suit_with_no_shirt_to_discount_is_not_an_applied_promotion() {
    let mut snap = snapshot(
        vec![
            entry("JAS001", Level::Company, None, 2_000_000),
            entry("KEM001", Level::Company, None, 300_000),
        ],
        vec![],
    );
    let mut offer = rule("R1", percent(5_000));
    offer.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["JAS001"]),
    });
    offer.scope.effect_on = Some(Applicability::Sku {
        sku_codes: skus(&["KEM001"]),
    });
    snap.rules.push(offer);

    let result = resolved(&snap, &context(), &[CartLine::new("JAS001", 1)]);
    assert_eq!(result.total, Money::new(2_000_000));
    assert_eq!(why(&result, "R1"), RejectionReason::NothingMatched);
}

#[test]
fn a_promotion_can_target_a_whole_division() {
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 100_000),
        ],
        vec![],
    );
    let mut offer = rule("R1", percent(2_000));
    offer.scope.applicability = Some(Applicability::Division {
        divisions: skus(&["PRIA"]),
    });
    snap.rules.push(offer);

    let result = resolved(
        &snap,
        &context(),
        &[
            CartLine::new("SKU1", 1).in_division("PRIA"),
            CartLine::new("SKU2", 1).in_division("WANITA"),
        ],
    );
    assert_eq!(result.lines[0].line_total, Money::new(80_000));
    assert_eq!(result.lines[1].line_total, Money::new(100_000));
}

#[test]
fn a_promotion_can_target_a_tag() {
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 100_000),
        ],
        vec![],
    );
    let mut offer = rule("R1", percent(2_000));
    offer.scope.applicability = Some(Applicability::Tag {
        tags: skus(&["LEBARAN"]),
    });
    snap.rules.push(offer);

    let result = resolved(
        &snap,
        &context(),
        &[
            CartLine::new("SKU1", 1).tagged("LEBARAN"),
            CartLine::new("SKU2", 1).tagged("NATAL"),
        ],
    );
    assert_eq!(result.lines[0].line_total, Money::new(80_000));
    assert_eq!(result.lines[1].line_total, Money::new(100_000));
}

#[test]
fn a_members_only_promotion_needs_a_member() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut offer = rule("R1", percent(1_500));
    offer.scope.customers = CustomerScope::Members;
    snap.rules.push(offer);

    let stranger = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(stranger.total, Money::new(100_000));
    assert_eq!(why(&stranger, "R1"), RejectionReason::NotThisCustomer);

    let member = resolved(
        &snap,
        &context().for_customer("member-1"),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(member.total, Money::new(85_000));
}

#[test]
fn buy_two_get_one_free_of_the_same_thing_needs_no_second_naming() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule(
        "R1",
        Effect::FreeItem {
            sku_code: None, // the item that triggered it
            quantity: 1,
            every_matched_quantity: Some(2),
            after_matched_quantity: 0,
            unit_price: Money::ZERO,
        },
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 2)]);
    assert_eq!(result.free_lines.len(), 1);
    assert_eq!(result.free_lines[0].sku_code, "SKU1");
    assert_eq!(result.free_lines[0].quantity, 1);
}

#[test]
fn an_offer_can_start_counting_from_the_third_item() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule(
        "R1",
        Effect::FreeItem {
            sku_code: None,
            quantity: 1,
            every_matched_quantity: Some(1),
            after_matched_quantity: 2,
            unit_price: Money::ZERO,
        },
    ));

    let two = resolved(&snap, &context(), &[CartLine::new("SKU1", 2)]);
    assert!(two.free_lines.is_empty(), "the first two do not count");

    let five = resolved(&snap, &context(), &[CartLine::new("SKU1", 5)]);
    assert_eq!(
        five.free_lines[0].quantity, 3,
        "three past the first two, one free for each"
    );
}

#[test]
fn an_advisory_offer_is_reported_with_its_worth_and_never_applied() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut manual = rule("R1", percent(4_000));
    manual.advisory = true;
    snap.rules.push(manual);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.total,
        Money::new(100_000),
        "an advisory offer is a person's decision, not the till's"
    );
    let advisory = result
        .rejected_rules
        .iter()
        .find(|rejected| rejected.rule_id == "R1")
        .unwrap_or_else(|| panic!("advisory offer was not reported"));
    assert_eq!(advisory.reason, RejectionReason::AdvisoryOnly);
    assert_eq!(
        advisory.would_have_saved,
        Some(Money::new(40_000)),
        "the screen must be able to say what it is offering, not just that something is"
    );
}

// ---------------------------------------------------------------------------
// Price levels beyond shop-or-company
// ---------------------------------------------------------------------------

fn levelled(sku: &str, applies_to: PriceLevel, price: i64) -> PriceEntry {
    PriceEntry {
        sku_code: sku.into(),
        applies_to,
        channel: "STORE".into(),
        sellable: true,
        currency: Currency("IDR".into()),
        unit_price: Money::new(price),
        tax_category: "STANDARD".into(),
        publication_version: 1,
        effective_from: at(1),
        effective_to: None,
    }
}

#[test]
fn a_group_of_shops_can_share_a_price_the_company_does_not() {
    let snap = snapshot(
        vec![
            levelled("SKU1", PriceLevel::Company, 100_000),
            levelled(
                "SKU1",
                PriceLevel::SiteGroup {
                    site_ids: skus(&["store-01", "store-02"]),
                },
                85_000,
            ),
        ],
        vec![],
    );
    let inside =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(inside.unit_price, Money::new(85_000));

    let outside = PricingContext::new("store-09", "STORE", at(5));
    let elsewhere =
        resolve_price(&snap, &outside, "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(elsewhere.unit_price, Money::new(100_000));
}

#[test]
fn one_shop_beats_the_group_it_belongs_to() {
    let snap = snapshot(
        vec![
            levelled("SKU1", PriceLevel::Company, 100_000),
            levelled(
                "SKU1",
                PriceLevel::SiteGroup {
                    site_ids: skus(&["store-01"]),
                },
                85_000,
            ),
            levelled(
                "SKU1",
                PriceLevel::Site {
                    site_id: "store-01".into(),
                },
                79_000,
            ),
        ],
        vec![],
    );
    let found =
        resolve_price(&snap, &context(), "SKU1").unwrap_or_else(|| panic!("nothing resolved"));
    assert_eq!(found.unit_price, Money::new(79_000));
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

fn campaign(id: &str) -> Campaign {
    Campaign {
        campaign_id: id.into(),
        name: format!("Kampanye {id}"),
        status: CampaignStatus::Active,
        valid_from: None,
        valid_to: None,
        site_ids: BTreeSet::new(),
        caps: Caps::default(),
    }
}

fn under_campaign(id: &str, campaign_id: &str, bps: i64) -> Rule {
    let mut offer = rule(id, percent(bps));
    offer.campaign_id = Some(campaign_id.into());
    offer.stacking = Stacking::Stackable;
    offer
}

#[test]
fn pausing_a_campaign_pauses_every_offer_in_it() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.campaigns.push(campaign("C1"));
    snap.rules.push(under_campaign("R1", "C1", 1_000));
    snap.rules.push(under_campaign("R2", "C1", 1_000));

    let running = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(running.total, Money::new(80_000));

    snap.campaigns[0].status = CampaignStatus::Paused;
    let paused = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        paused.total,
        Money::new(100_000),
        "one switch stops the promotion; nobody has to remember all six rules"
    );
    assert_eq!(why(&paused, "R1"), RejectionReason::NotActive);
    assert_eq!(why(&paused, "R2"), RejectionReason::NotActive);
}

// ---------------------------------------------------------------------------
// Tax: what is sales, what is collected for somebody else, what is due
// ---------------------------------------------------------------------------

fn taxed(snap: &mut PricingSnapshot, rate_bps: i64, inclusive: bool) {
    snap.tax_rules.push(TaxRule {
        tax_category: "STANDARD".into(),
        rate_bps,
        inclusive,
    });
}

#[test]
fn a_book_that_says_nothing_about_tax_reports_no_tax() {
    // Every book published before tax was modelled. Their numbers must not
    // move: the whole line is sales and nothing is owed to anybody.
    let snap = snapshot(vec![entry("SKU1", Level::Company, None, 110_000)], vec![]);
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.tax_total, Money::ZERO);
    assert_eq!(result.net_ex_tax, Money::new(110_000));
    assert_eq!(result.amount_due, result.total);
}

// Acceptance: TAX-001.
#[test]
fn an_inclusive_price_is_split_rather_than_grossed_up() {
    // Indonesian retail quotes the price with PPN in it. A 110.000 ticket at
    // 10% is 100.000 of goods and 10.000 of tax — and the shopper still pays
    // 110.000. Reading it as exclusive would charge 121.000.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 110_000)], vec![]);
    taxed(&mut snap, 1_000, true);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.net_ex_tax, Money::new(100_000), "this is Net Sales");
    assert_eq!(result.tax_total, Money::new(10_000));
    assert_eq!(
        result.amount_due,
        Money::new(110_000),
        "unchanged for the shopper"
    );
    assert_eq!(result.total, result.amount_due);
}

// Acceptance: TAX-002.
#[test]
fn an_exclusive_price_has_the_tax_added_on_top() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    taxed(&mut snap, 1_000, false);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.net_ex_tax, Money::new(100_000));
    assert_eq!(result.tax_total, Money::new(10_000));
    assert_eq!(
        result.amount_due,
        Money::new(110_000),
        "more than the ticket"
    );
}

#[test]
fn tax_is_taken_from_what_was_charged_not_from_the_ticket() {
    // A discount reduces what was sold, so it reduces what is taxed. Taxing the
    // ticket and then discounting collects tax on money nobody paid.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 110_000)], vec![]);
    taxed(&mut snap, 1_000, true);
    snap.rules.push(rule("R1", percent(5_000)));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(55_000));
    assert_eq!(result.net_ex_tax, Money::new(50_000));
    assert_eq!(result.tax_total, Money::new(5_000));
}

#[test]
fn the_goods_and_the_tax_always_account_for_the_whole_line() {
    // Two roundings that do not have to agree is how a receipt comes to be a
    // rupiah out from its own lines. Under inclusive pricing the tax is the
    // remainder, so the parts sum to the whole at any price and any rate.
    for price in [1, 7, 333, 99_999, 538_200, 1_000_001] {
        for rate in [1_000, 1_100, 500, 333] {
            let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, price)], vec![]);
            taxed(&mut snap, rate, true);
            let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
            assert_eq!(
                result
                    .net_ex_tax
                    .try_add(result.tax_total)
                    .unwrap_or_else(|error| panic!("{price} at {rate}bps: {error}")),
                Money::new(price),
                "{price} at {rate}bps lost or invented a rupiah"
            );
            for line in &result.lines {
                assert_eq!(
                    line.net_ex_tax
                        .try_add(line.tax_amount)
                        .unwrap_or_else(|error| panic!("{price} at {rate}bps: {error}")),
                    line.line_total
                );
            }
        }
    }
}

#[test]
fn points_are_earned_on_the_goods_not_on_the_tax() {
    // The locked basis: net merchandise after discounts, EXCLUDING tax. Paying
    // loyalty on the tax line is paying customers for money collected for the
    // state.
    //
    // 110.000 inclusive at 10% is 100.000 of goods. At a point per 1.000 that
    // is 100 points, not 110.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 110_000)], vec![]);
    taxed(&mut snap, 1_000, true);
    snap.rules.push(rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    ));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 100);
}

// ---------------------------------------------------------------------------
// The locked checkout kernel: line before basket, and the cheapest BASKET
// ---------------------------------------------------------------------------

// Acceptance: ELG-004.
#[test]
fn a_basket_threshold_is_measured_after_the_line_offers_have_come_off() {
    // "Basket minimum spend: after line discount, before basket discount."
    // A 600.000 basket with 20% off an item is a 480.000 basket by the time a
    // rule asking for 500.000 is reached, and that rule does not qualify.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 600_000)], vec![]);

    let mut line = rule("R-LINE", percent(2_000));
    line.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SKU1"]),
    });
    line.stacking = Stacking::Stackable;

    let mut basket = rule(
        "R-BASKET",
        Effect::Amount {
            amount: Money::new(60_000),
        },
    );
    basket.conditions.min_amount = Money::new(500_000);
    basket.stacking = Stacking::Stackable;

    snap.rules.push(line);
    snap.rules.push(basket);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    // Both together would be 600 - 120 - 60 = 420.000 if the threshold were
    // read off the ticket price. It is not: after the line offer the basket is
    // 480.000, under the 500.000 the basket offer asked for.
    //
    // Dropping the line offer instead leaves 600.000 and earns 60.000 — worse
    // than the 120.000 the line offer is worth — so the line offer wins on its
    // own merits rather than by being evaluated first.
    assert_eq!(result.total, Money::new(480_000));
    assert_eq!(why(&result, "R-BASKET"), RejectionReason::AmountTooLow);
}

// Acceptance: COM-001.
#[test]
fn best_price_is_the_cheapest_basket_not_the_first_offer_that_fits() {
    // The case the reviewer named, and the reason the search tries the set
    // minus one:
    //
    //     600.000, A = 20% off the item, B = 150.000 off a basket of 500.000+
    //
    //     A and B : A takes it to 480.000, B no longer qualifies → 480.000
    //     B alone :                                              → 450.000
    //
    // Taking every offer costs the shopper 30.000. Best Price means the
    // cheapest basket, so B alone has to win.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 600_000)], vec![]);

    let mut a = rule("R-A", percent(2_000));
    a.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SKU1"]),
    });
    a.stacking = Stacking::Stackable;

    let mut b = rule(
        "R-B",
        Effect::Amount {
            amount: Money::new(150_000),
        },
    );
    b.conditions.min_amount = Money::new(500_000);
    b.stacking = Stacking::Stackable;

    snap.rules.push(a);
    snap.rules.push(b);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.total,
        Money::new(450_000),
        "a shopper must not be charged more for qualifying for two offers"
    );
    assert!(
        result.applied_rules.iter().any(|one| one.rule_id == "R-B"),
        "the basket offer is the one that makes it cheapest"
    );
    assert!(
        !result.applied_rules.iter().any(|one| one.rule_id == "R-A"),
        "the line offer stood between the basket and a better price"
    );
}

#[test]
fn a_basket_discount_is_allocated_back_to_the_lines_it_came_off() {
    // The golden transaction, to the rupiah. Shirt 299.000 at 20% off; shoes
    // marked down from 499.000 to 349.000; 50.000 off a basket of 500.000 or
    // more. The markdown is a price, not a discount, so it is not in the
    // 50.000's way and not in the promotion spend either.
    let mut snap = snapshot(
        vec![
            entry("SHIRT", Level::Company, None, 299_000),
            entry("SHOES", Level::Company, None, 499_000),
        ],
        vec![markdown("SHOES", 349_000)],
    );

    let mut shirt = rule("R-SHIRT", percent(2_000));
    shirt.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHIRT"]),
    });
    shirt.stacking = Stacking::Stackable;

    let mut basket = rule(
        "R-BASKET",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    basket.conditions.min_amount = Money::new(500_000);
    basket.stacking = Stacking::Stackable;
    // Cleared shoes are in this basket offer's reach only because it says so.
    basket.markdown_policy = MarkdownPolicy::Allow;

    snap.rules.push(shirt);
    snap.rules.push(basket);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHIRT", 1), CartLine::new("SHOES", 1)],
    );

    // 239.200 + 349.000 = 588.200, over the 500.000 the basket offer asks for.
    assert_eq!(result.total, Money::new(538_200));

    // And the 50.000 is not a header figure: it is split across the two lines
    // by what they had come to, so a return of either knows its own share.
    let allocation = result
        .applied_rules
        .iter()
        .find(|one| one.rule_id == "R-BASKET")
        .map(|one| one.line_benefits.clone())
        .unwrap_or_else(|| panic!("the basket offer applied"));
    let mut shares: Vec<i64> = allocation.iter().map(|line| line.benefit.minor).collect();
    shares.sort_unstable();
    assert_eq!(
        shares,
        vec![20_333, 29_667],
        "239.200/588.200 and 349.000/588.200 of 50.000, summing to exactly 50.000"
    );
    assert_eq!(
        shares.iter().sum::<i64>(),
        50_000,
        "the parts are the whole — no rupiah invented, none lost"
    );
}

#[test]
fn a_campaigns_shops_bind_on_the_offers_inside_it() {
    // The case this exists for: Lebaran runs everywhere the campaign says, and
    // a student offer inside it runs in fewer. Both lists bind, so the shop
    // that gets the offer is the one both allow — the same way the campaign's
    // window already binds beside the rule's own.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.site_ids = skus(&["store-01", "store-02"]);
    snap.campaigns.push(envelope);
    // The rule itself names thirteen shops. It cannot widen the campaign back
    // out: a campaign is a constraint, not a default.
    let mut offer = under_campaign("R1", "C1", 2_000);
    offer.scope.site_ids = skus(&["store-01", "store-02", "store-03"]);
    snap.rules.push(offer);

    let inside = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        inside.total,
        Money::new(80_000),
        "store-01 is in both lists"
    );

    let outside = resolved(
        &snap,
        &PricingContext::new("store-03", "STORE", at(5)),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(
        outside.total,
        Money::new(100_000),
        "the rule names store-03 and the campaign does not, so it does not run"
    );
    assert_eq!(why(&outside, "R1"), RejectionReason::WrongSite);
}

#[test]
fn a_campaign_naming_no_shop_narrows_nothing() {
    // Every campaign published before campaigns had shops reads as an empty
    // set, and an empty set has to mean EVERYWHERE — otherwise this field
    // arriving would take every running campaign dark at every till.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.campaigns.push(campaign("C1"));
    snap.rules.push(under_campaign("R1", "C1", 2_000));

    for shop in ["store-01", "store-09", "store-13"] {
        let result = resolved(
            &snap,
            &PricingContext::new(shop, "STORE", at(5)),
            &[CartLine::new("SKU1", 1)],
        );
        assert_eq!(
            result.total,
            Money::new(80_000),
            "{shop} should still get it"
        );
    }
}

#[test]
fn offers_in_one_campaign_spend_one_budget_between_them() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.caps.budget = Some(Money::new(1_000_000));
    envelope.caps.spent = Money::new(1_000_000);
    snap.campaigns.push(envelope);
    snap.rules.push(under_campaign("R1", "C1", 1_000));
    snap.rules.push(under_campaign("R2", "C1", 1_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(
        why(&result, "R1"),
        RejectionReason::BudgetSpent,
        "the rules each had budget of their own; the campaign's was gone"
    );
}

#[test]
fn stackable_rules_share_the_campaigns_remaining_budget_inside_one_basket() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.caps.budget = Some(Money::new(50_000));
    envelope.caps.spent = Money::new(40_000);
    snap.campaigns.push(envelope);
    snap.rules.push(under_campaign("R1", "C1", 5_000));
    snap.rules.push(under_campaign("R2", "C1", 5_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.discount_total, Money::new(10_000));
    assert_eq!(applied_ids(&result), vec!["R1"]);
    assert_eq!(why(&result, "R2"), RejectionReason::BudgetSpent);
}

#[test]
fn stackable_rules_share_campaign_uses_inside_one_basket() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.caps.max_uses = Some(1);
    snap.campaigns.push(envelope);
    snap.rules.push(under_campaign("R1", "C1", 1_000));
    snap.rules.push(under_campaign("R2", "C1", 1_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.discount_total, Money::new(10_000));
    assert_eq!(applied_ids(&result), vec!["R1"]);
    assert_eq!(why(&result, "R2"), RejectionReason::UsageExhausted);
}

#[test]
fn a_free_item_cannot_bypass_a_campaign_budget_spent_by_another_rule() {
    let mut snap = snapshot(
        vec![
            entry("SKU1", Level::Company, None, 100_000),
            entry("SKU2", Level::Company, None, 80_000),
        ],
        vec![],
    );
    let mut envelope = campaign("C1");
    envelope.caps.budget = Some(Money::new(10_000));
    snap.campaigns.push(envelope);
    snap.rules.push(under_campaign("R1", "C1", 1_000));
    snap.rules.push(under_campaign("R2", "C1", 0));
    snap.rules[1].effect = Effect::FreeItem {
        sku_code: Some("SKU2".into()),
        quantity: 1,
        every_matched_quantity: None,
        after_matched_quantity: 0,
        unit_price: Money::ZERO,
    };
    snap.rules[1].scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SKU2"]),
    });

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    );
    assert_eq!(result.discount_total, Money::new(10_000));
    assert!(result.free_lines.is_empty());
    assert_eq!(why(&result, "R2"), RejectionReason::BudgetSpent);
}

#[test]
fn a_campaign_that_has_not_started_holds_its_offers_back() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.valid_from = Some(at(9));
    snap.campaigns.push(envelope);
    snap.rules.push(under_campaign("R1", "C1", 1_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(why(&result, "R1"), RejectionReason::NotStarted);
}

// ---------------------------------------------------------------------------
// Running thresholds
// ---------------------------------------------------------------------------

#[test]
fn the_same_basket_priced_twice_fingerprints_the_same() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule("R1", percent(1_000)));
    let cart = [CartLine::new("SKU1", 2)];

    let once = resolved(&snap, &context(), &cart);
    let twice = resolved(&snap, &context(), &cart);
    assert_eq!(once.trace_id, twice.trace_id);
    assert!(!once.trace_id.is_empty());
}

#[test]
fn a_different_price_fingerprints_differently() {
    let cheap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let dear = snapshot(vec![entry("SKU1", Level::Company, None, 110_000)], vec![]);
    let cart = [CartLine::new("SKU1", 1)];

    assert_ne!(
        resolved(&cheap, &context(), &cart).trace_id,
        resolved(&dear, &context(), &cart).trace_id,
        "a receipt that charged a different amount must not claim the same decision"
    );
}

#[test]
fn a_promotion_that_did_not_apply_does_not_change_the_fingerprint() {
    // A shop holding an offer it could not use must fingerprint the same as one
    // that never received it, or the id would move for a reason nobody can see
    // on the receipt.
    let plain = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut with_dud = plain.clone();
    let mut elsewhere = rule("R1", percent(5_000));
    elsewhere.scope.site_ids = skus(&["store-99"]);
    with_dud.rules.push(elsewhere);

    let cart = [CartLine::new("SKU1", 1)];
    assert_eq!(
        resolved(&plain, &context(), &cart).trace_id,
        resolved(&with_dud, &context(), &cart).trace_id
    );
}

#[test]
fn the_order_rules_arrive_in_does_not_change_the_fingerprint() {
    let build = |reversed: bool| {
        let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
        let mut a = rule("R-A", percent(1_000));
        a.stacking = Stacking::Stackable;
        let mut b = rule(
            "R-B",
            Effect::Amount {
                amount: Money::new(5_000),
            },
        );
        b.stacking = Stacking::Stackable;
        snap.rules = if reversed { vec![b, a] } else { vec![a, b] };
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];
    assert_eq!(
        resolved(&build(false), &context(), &cart).trace_id,
        resolved(&build(true), &context(), &cart).trace_id,
        "a till pricing offline and the centre reproducing it must agree"
    );
}

#[test]
fn an_offer_naming_a_promotion_this_shop_never_received_fails_closed() {
    // The dangerous default would be to treat a missing campaign as no
    // campaign, which leaves the offer running with no envelope — so pausing
    // it at the centre would stop it everywhere except the shops that are
    // already out of date.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(under_campaign("R1", "C-UNKNOWN", 5_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::CampaignUnknown);
}

#[test]
fn a_campaign_budget_trims_a_discount_rather_than_only_closing_it() {
    // The rule's own budget already trimmed; the campaign's only gated. Two
    // limits of the same kind behaving differently is the sort of thing nobody
    // finds until a promotion overspends by exactly one basket.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.caps.budget = Some(Money::new(50_000));
    envelope.caps.spent = Money::new(40_000);
    snap.campaigns.push(envelope);
    snap.rules.push(under_campaign("R1", "C1", 5_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.discount_total,
        Money::new(10_000),
        "fifty thousand was due but only ten thousand of the campaign remained"
    );
}

#[test]
fn the_tighter_of_a_rule_cap_and_a_campaign_budget_wins() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 1_000_000)], vec![]);
    let mut envelope = campaign("C1");
    envelope.caps.budget = Some(Money::new(200_000));
    snap.campaigns.push(envelope);
    let mut offer = under_campaign("R1", "C1", 5_000);
    offer.max_discount = Some(Money::new(80_000));
    snap.rules.push(offer);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(
        result.discount_total,
        Money::new(80_000),
        "the rule's own per-cart cap is the tighter of the two"
    );
}

#[test]
fn a_price_book_need_not_restate_what_an_earlier_one_already_said() {
    // The load-bearing property for letting article setup publish a price book
    // of its own: a publication that mentions only what it changes must leave
    // everything else priced. Without this, every new article would have to
    // restate the whole company's prices to say one new thing.
    let mut priced_in_v1 = entry("SKU-OLD", Level::Company, None, 100_000);
    priced_in_v1.publication_version = 1;
    let mut priced_in_v2 = entry("SKU-NEW", Level::Company, None, 250_000);
    priced_in_v2.publication_version = 2;

    let snap = PricingSnapshot {
        publication_version: 2,
        entries: vec![priced_in_v1, priced_in_v2],
        ..Default::default()
    };
    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SKU-OLD", 1), CartLine::new("SKU-NEW", 1)],
    );
    assert_eq!(
        result.lines[0].line_total,
        Money::new(100_000),
        "a newer book that says nothing about this product must not unprice it"
    );
    assert_eq!(result.lines[1].line_total, Money::new(250_000));
}

/// The name a source has in code and the name it has on the wire are the same
/// name.
///
/// This is the guard the system did not have. `as_str` and the `serde` renaming
/// are two renderings of one enum, and when they were allowed to differ — a
/// shop saying `COMPANY_PRICE`, the centre saying `CompanyPrice` — nothing
/// failed anywhere; a badge just went blank on one screen and a report quietly
/// counted one price under two names. Renaming a variant now breaks this test
/// rather than a browser.
/// `price_catalog` answers with one number, which is what a shelf edge needs
/// and less than a merchandiser needs: "why is this 99 and not 200" is answered
/// by the candidate that was beaten. The order has to be the engine's own — a
/// screen showing the cascade in a different order from the order that decides
/// it would look authoritative and be wrong.
#[test]
fn a_price_stack_names_the_winner_and_everything_it_beat() {
    let mut shop_price = entry("SKU1", Level::Site, Some("store-01"), 150_000);
    shop_price.publication_version = 2;
    let snapshot = PricingSnapshot {
        publication_version: 2,
        entries: vec![entry("SKU1", Level::Company, None, 200_000), shop_price],
        markdowns: vec![markdown("SKU1", 99_000)],
        ..Default::default()
    };

    let stacks = price_stacks(&snapshot, &context(), &[CartLine::new("SKU1", 1)]);
    let candidates = &stacks[0].candidates;
    assert_eq!(candidates.len(), 3, "a markdown and both price levels");

    // A markdown REPLACES the base, so it heads the stack and the price it
    // replaced is a loser. Booking that relationship the other way round is how
    // a markdown comes to be reported as a discount.
    assert_eq!(candidates[0].source, PriceSource::Markdown);
    assert_eq!(candidates[0].unit_price, Money::new(99_000));
    assert!(candidates[0].in_force);

    // Then the cascade, narrowest first — and only one candidate in the whole
    // stack is in force.
    assert_eq!(candidates[1].source, PriceSource::SitePrice);
    assert_eq!(candidates[1].unit_price, Money::new(150_000));
    assert!(!candidates[1].in_force);
    assert_eq!(candidates[2].source, PriceSource::CompanyPrice);
    assert!(!candidates[2].in_force);
    assert_eq!(
        candidates
            .iter()
            .filter(|candidate| candidate.in_force)
            .count(),
        1,
        "exactly one price is charged"
    );
}

/// Without a markdown the head of the stack is what the catalogue charges.
///
/// The guard against the stack and the answer drifting apart: they are two
/// readings of one index, and if they ever disagreed the screen explaining a
/// price would be explaining a price nobody pays.
#[test]
fn the_head_of_the_stack_is_the_price_the_catalogue_gives() {
    let mut shop_price = entry("SKU1", Level::Site, Some("store-01"), 150_000);
    shop_price.publication_version = 2;
    let snapshot = PricingSnapshot {
        publication_version: 2,
        entries: vec![entry("SKU1", Level::Company, None, 200_000), shop_price],
        ..Default::default()
    };
    let products = [CartLine::new("SKU1", 1)];
    let priced = price_catalog(&snapshot, &context(), &products);
    let stacks = price_stacks(&snapshot, &context(), &products);
    let head = &stacks[0].candidates[0];
    assert!(head.in_force);
    assert_eq!(head.unit_price, priced[0].unit_price);
    assert_eq!(head.source, priced[0].source);
}

/// A markdown on a product the book does not price is not a price.
///
/// There is nothing for it to replace, so nothing is charged from it. Reporting
/// it as in force would put a number on screen that no till would ever take.
#[test]
fn a_markdown_with_no_price_under_it_charges_nothing() {
    let snapshot = PricingSnapshot {
        publication_version: 1,
        markdowns: vec![markdown("SKU-NOT-PRICED", 99_000)],
        ..Default::default()
    };
    let stacks = price_stacks(&snapshot, &context(), &[CartLine::new("SKU-NOT-PRICED", 1)]);
    assert!(
        stacks[0].candidates.is_empty(),
        "no price under it means no price at all, not a free-standing 99,000"
    );
}

// ---------------------------------------------------------------------------
// What a promotion cost, line by line
// ---------------------------------------------------------------------------

/// A flat amount off a basket lands on the lines it matched, not on all of them.
///
/// The engine has always had to apportion a flat "Rp 50,000 off" before it
/// could apply it — otherwise fifty thousand would come off every line rather
/// than off the basket once. It then summed the parts away, and what survived
/// was one figure per rule per sale. Every report built on that says the whole
/// basket was promotional: influenced revenue, which is standard in the trade
/// and overstates by however much of the basket the offer never touched.
#[test]
fn a_promotion_says_what_it_took_off_each_line() {
    let mut snap = snapshot(
        vec![
            entry("KEMEJA", Level::Company, None, 200_000),
            entry("CELANA", Level::Company, None, 300_000),
            entry("TOPI", Level::Company, None, 50_000),
        ],
        vec![],
    );
    // Fifty thousand off, but only against the two garments.
    let mut offer = rule(
        "R1",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    offer.scope.applicability = Some(Applicability::Sku {
        sku_codes: ["KEMEJA".to_string(), "CELANA".to_string()]
            .into_iter()
            .collect(),
    });
    snap.rules.push(offer);

    let result = resolved(
        &snap,
        &context(),
        &[
            CartLine::new("KEMEJA", 1),
            CartLine::new("CELANA", 1),
            CartLine::new("TOPI", 1),
        ],
    );

    let applied = &result.applied_rules[0];
    assert_eq!(applied.benefit, Money::new(50_000));
    assert_eq!(
        applied.line_benefits.len(),
        2,
        "the hat was never matched, so it carries none of the discount"
    );
    assert!(
        applied.line_benefits.iter().all(|line| line.line != 2),
        "line 2 is the hat: {:?}",
        applied.line_benefits
    );
    // Apportioned by value: 200k and 300k of a 500k basis take 20k and 30k.
    assert_eq!(applied.line_benefits[0].benefit, Money::new(20_000));
    assert_eq!(applied.line_benefits[1].benefit, Money::new(30_000));
    // And the parts are exactly the whole — the invariant that makes a
    // per-line report add up to the per-rule one it is meant to explain.
    let apportioned = applied.line_benefits.iter().fold(Money::ZERO, |sum, line| {
        sum.try_add(line.benefit).unwrap_or(Money::ZERO)
    });
    assert_eq!(apportioned, applied.benefit);
}

// ---------------------------------------------------------------------------
// A campaign of markdowns — a run of price drops under one envelope
// ---------------------------------------------------------------------------
//
// The gate on a markdown's campaign runs the OPPOSITE way to the gate on a
// rule's, and these are the tests that hold it that way. A rule fails closed
// because the cost of being wrong is a discount not given; a markdown fails
// open because the cost of being wrong is charging a customer more than the
// ticket on the garment, at the counter.

fn cleared_under(campaign_id: &str) -> Markdown {
    let mut drop = markdown("SKU1", 60_000);
    drop.campaign_id = Some(campaign_id.into());
    drop
}

fn priced_at_full() -> Vec<PriceEntry> {
    vec![entry("SKU1", Level::Company, None, 100_000)]
}

#[test]
fn a_campaign_that_is_running_clears_the_price() {
    let mut snap = snapshot(priced_at_full(), vec![cleared_under("CMP-FLASH")]);
    snap.campaigns.push(campaign("CMP-FLASH"));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(60_000));
    assert_eq!(result.lines[0].source, PriceSource::Markdown);
}

#[test]
fn pausing_a_campaign_puts_its_prices_back_up() {
    let mut snap = snapshot(priced_at_full(), vec![cleared_under("CMP-FLASH")]);
    let mut stopped = campaign("CMP-FLASH");
    stopped.status = CampaignStatus::Paused;
    snap.campaigns.push(stopped);

    // The whole point of the switch: one field, and four hundred cleared
    // products go back to the list price without a new price book.
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(result.lines[0].source, PriceSource::CompanyPrice);
}

#[test]
fn a_campaign_that_has_not_started_does_not_clear_the_price_yet() {
    let mut snap = snapshot(priced_at_full(), vec![cleared_under("CMP-FLASH")]);
    let mut later = campaign("CMP-FLASH");
    later.valid_from = Some(at(9));
    snap.campaigns.push(later);

    // The markdown's own window opened on day 1; the campaign opens on day 9. Both
    // bind, so the shop gets the intersection.
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
}

#[test]
fn a_campaign_the_shop_never_received_leaves_the_cleared_price_standing() {
    // No campaign in the snapshot at all — the shop missed it, or was offline
    // when it was cut.
    let snap = snapshot(priced_at_full(), vec![cleared_under("CMP-NEVER-ARRIVED")]);

    // **This is the asymmetry.** A RULE naming an unknown campaign fails closed
    // and gives no discount, which costs the shopper nothing they were promised
    // in the shop. A MARKDOWN failing closed would ring up 100.000 for a shirt
    // with 60.000 on its ticket and 60.000 on the poster in the window — at the
    // branch furthest behind on sync, which is the branch least able to explain
    // it. So silence leaves the cleared price standing, and only a delivered
    // pause puts it back.
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(60_000));
    assert_eq!(result.lines[0].source, PriceSource::Markdown);
}

#[test]
fn a_promotion_naming_that_same_unknown_campaign_still_fails_closed() {
    // The other half of the pair, asserted beside it so the two cannot drift
    // into agreeing with each other.
    let mut snap = snapshot(priced_at_full(), vec![]);
    snap.rules
        .push(under_campaign("R1", "CMP-NEVER-ARRIVED", 2_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::CampaignUnknown);
}

#[test]
fn a_markdown_belonging_to_no_campaign_is_unaffected_by_any_campaign() {
    // Every markdown written before campaigns existed is this case, and a paused
    // campaign elsewhere in the book must not touch it.
    let mut snap = snapshot(priced_at_full(), vec![markdown("SKU1", 60_000)]);
    let mut stopped = campaign("CMP-FLASH");
    stopped.status = CampaignStatus::Paused;
    snap.campaigns.push(stopped);

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(60_000));
}

// ---------------------------------------------------------------------------
// A clearance that runs by the hour
// ---------------------------------------------------------------------------

/// Noon to two, in the shop's own time.
fn flash(from_minute: u32, to_minute: u32) -> Markdown {
    let mut drop = markdown("SKU1", 60_000);
    drop.time_window = Some(TimeWindow {
        from_minute,
        to_minute,
    });
    drop
}

/// `at(5)` is midday UTC. A shop at UTC+7 is at 19:00 when this fires.
fn shop_at(offset_minutes: i32) -> PricingContext {
    let mut context = context();
    context.utc_offset_minutes = offset_minutes;
    context
}

#[test]
fn a_clearance_inside_its_hours_sets_the_price() {
    let snap = snapshot(priced_at_full(), vec![flash(11 * 60, 14 * 60)]);
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(60_000));
}

#[test]
fn a_clearance_outside_its_hours_charges_the_list_price() {
    // The same markdown, the same day, one hour later than its window.
    let snap = snapshot(priced_at_full(), vec![flash(8 * 60, 11 * 60)]);
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(result.lines[0].source, PriceSource::CompanyPrice);
}

#[test]
fn the_hours_are_the_shops_own_not_the_servers() {
    // Noon to two **where the shop is**. The instant under test is 12:00 UTC,
    // so a shop at UTC+7 is at 19:00 and the sale is over; a shop at UTC is in
    // the middle of it. Reading these in UTC would run every flash sale in the
    // business seven hours late — right for nobody, every day, with nothing on
    // any screen saying so.
    let snap = snapshot(priced_at_full(), vec![flash(12 * 60, 14 * 60)]);
    let jakarta = resolved(&snap, &shop_at(7 * 60), &[CartLine::new("SKU1", 1)]);
    assert_eq!(jakarta.total, Money::new(100_000));
    let london = resolved(&snap, &shop_at(0), &[CartLine::new("SKU1", 1)]);
    assert_eq!(london.total, Money::new(60_000));
}

#[test]
fn a_clearance_may_run_past_midnight() {
    // 22:00 to 02:00 wraps, and a late-night sale genuinely wants that. At
    // 12:00 UTC a shop at UTC+13 is at 01:00 the next day — inside it.
    let snap = snapshot(priced_at_full(), vec![flash(22 * 60, 2 * 60)]);
    let result = resolved(&snap, &shop_at(13 * 60), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(60_000));
}

#[test]
fn a_clearance_may_run_on_chosen_days_only() {
    let mut weekend = markdown("SKU1", 60_000);
    // `at(5)` is 2026-09-05, a Saturday.
    weekend.days = DaySet {
        iso_weekdays: [6].into_iter().collect(),
    };
    let snap = snapshot(priced_at_full(), vec![weekend.clone()]);
    assert_eq!(
        resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]).total,
        Money::new(60_000)
    );

    let mut weekday = weekend;
    weekday.days = DaySet {
        iso_weekdays: [1, 2, 3].into_iter().collect(),
    };
    let snap = snapshot(priced_at_full(), vec![weekday]);
    assert_eq!(
        resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]).total,
        Money::new(100_000)
    );
}

#[test]
fn an_unscheduled_clearance_runs_all_day_every_day() {
    // Every markdown written before slots existed is this one, and it must be
    // unaffected by the gate that was added around it.
    let snap = snapshot(priced_at_full(), vec![markdown("SKU1", 60_000)]);
    for offset in [0, 7 * 60, -5 * 60] {
        assert_eq!(
            resolved(&snap, &shop_at(offset), &[CartLine::new("SKU1", 1)]).total,
            Money::new(60_000)
        );
    }
}

// ---------------------------------------------------------------------------
// Golden fixtures G01–G04, from the Commercial V1 acceptance plan
// ---------------------------------------------------------------------------
//
// These are the plan's OWN expected numbers, computed independently of this
// engine and frozen. They are written here first, before anything is changed to
// suit them, so that what the engine agrees with and what it does not is
// evidence rather than opinion.
//
// G05 is refund allocation across four tenders. It is deliberately absent: this
// crate prices baskets and does not allocate refunds, and a fixture placed
// where nothing can execute it is a test that passes by being empty.

/// The plan's G01: no tax, so the older expected points of 1.076 still hold.
fn golden_g01() -> (PricingSnapshot, Vec<CartLine>) {
    let mut snap = snapshot(
        vec![
            entry("SHIRT", Level::Company, None, 299_000),
            entry("SHOES", Level::Company, None, 499_000),
        ],
        vec![markdown("SHOES", 349_000)],
    );

    // A: Shirt 20%, Combine, priority 100.
    let mut a = rule("PROMO-A", percent(2_000));
    a.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHIRT"]),
    });
    a.stacking = Stacking::Stackable;
    a.priority = 100;

    // B: Rp50.000 off a basket of 500.000 or more, markdown allowed, Combine,
    // priority 200, gated by a unique coupon.
    let mut b = rule(
        "PROMO-B",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    b.conditions.min_amount = Money::new(500_000);
    b.stacking = Stacking::Stackable;
    b.priority = 200;
    b.coupon_code = Some("GOLDEN-B".into());
    // The plan's G01 says so in as many words: "Markdown items: Allow". It has
    // to be stated now, because the default is Exclude — and if it were not
    // stated the shoes would drop out of the basket's eligible spend and the
    // 588.200 would never reach the 500.000 threshold.
    b.markdown_policy = MarkdownPolicy::Allow;

    // 1 point per Rp1.000 eligible, doubled on both units. Expressed as the
    // rate it comes to, because this engine models an earning RATE rather than
    // a base rate and a separate multiplier — see the divergence note in the
    // test below.
    let mut points = rule(
        "PROMO-C",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(500),
        }),
    );
    points.earn_basis = EarnBasis::PostDiscountNet;
    // G01 awards "2x on BOTH units", and one of them is marked down. An earning
    // rule is a rule, so the same default applies to it — a shop that wants
    // points on cleared goods says so, exactly as it does for a discount.
    points.markdown_policy = MarkdownPolicy::Allow;

    snap.rules.push(a);
    snap.rules.push(b);
    snap.rules.push(points);
    snap.coupons.push(Coupon {
        code: "GOLDEN-B".into(),
        rule_id: "PROMO-B".into(),
        active: true,
        customer_id: None,
        valid_from: None,
        valid_to: None,
        // Golden fixtures test the promotion arithmetic from the acceptance
        // plan. A finite legacy use count is refused at a till until it has
        // atomic online authorization; that policy has its own regression
        // above, and is not part of G01/G03's pricing arithmetic.
        max_uses: None,
        used: 0,
    });

    (
        snap,
        vec![CartLine::new("SHIRT", 1), CartLine::new("SHOES", 1)],
    )
}

fn with_coupon(code: &str) -> PricingContext {
    let mut context = context();
    context.coupon_codes = vec![code.to_string()];
    context
}

// Acceptance: E2E-001.
#[test]
fn golden_g01_zero_tax_cart() {
    let (snap, cart) = golden_g01();
    let result = resolved(&snap, &with_coupon("GOLDEN-B"), &cart);

    let shirt = result
        .lines
        .iter()
        .find(|line| line.sku_code == "SHIRT")
        .unwrap_or_else(|| panic!("shirt priced"));
    let shoes = result
        .lines
        .iter()
        .find(|line| line.sku_code == "SHOES")
        .unwrap_or_else(|| panic!("shoes priced"));

    // The markdown is a price, not a discount: shoes start from 349.000.
    assert_eq!(shoes.unit_price, Money::new(349_000), "markdown price");

    // Final line amounts, to the rupiah.
    assert_eq!(shirt.line_total, Money::new(218_867), "G01 shirt final");
    assert_eq!(shoes.line_total, Money::new(319_333), "G01 shoes final");
    assert_eq!(result.total, Money::new(538_200), "G01 amount due");

    // With no tax rule published, the whole of it is Net Sales.
    assert_eq!(result.net_ex_tax, Money::new(538_200));
    assert_eq!(result.tax_total, Money::ZERO);

    // The basket's 50.000, split across the lines it came off.
    let basket = result
        .applied_rules
        .iter()
        .find(|one| one.rule_id == "PROMO-B")
        .unwrap_or_else(|| panic!("the basket offer applied"));
    let mut shares: Vec<i64> = basket
        .line_benefits
        .iter()
        .map(|line| line.benefit.minor)
        .collect();
    shares.sort_unstable();
    assert_eq!(shares, vec![20_333, 29_667], "G01 basket allocation");

    // Promotion discount is 109.800. The markdown's 150.000 is NOT in it.
    assert_eq!(
        result.discount_total,
        Money::new(109_800),
        "G01 discount given"
    );

    // 1.076 points on a 538.200 basket at a doubled rate.
    assert_eq!(result.points_earned, 1_076, "G01 awarded points");
}

// Acceptance: TAX-010, E2E-003.
#[test]
fn golden_g03_ten_per_cent_tax_cart() {
    // The same cart, priced tax-inclusive at a hypothetical 10%. The money the
    // shopper pays does not move; what changes is what of it is sales — and
    // therefore what points are earned on.
    let (mut snap, cart) = golden_g01();
    snap.tax_rules.push(TaxRule {
        tax_category: "STANDARD".into(),
        rate_bps: 1_000,
        inclusive: true,
    });

    let result = resolved(&snap, &with_coupon("GOLDEN-B"), &cart);
    assert_eq!(
        result.total,
        Money::new(538_200),
        "the shopper pays the same"
    );
    assert_eq!(result.net_ex_tax, Money::new(489_273), "G03 net ex-tax");
    assert_eq!(result.tax_total, Money::new(48_927), "G03 tax");

    let shirt = result
        .lines
        .iter()
        .find(|line| line.sku_code == "SHIRT")
        .unwrap_or_else(|| panic!("shirt priced"));
    let shoes = result
        .lines
        .iter()
        .find(|line| line.sku_code == "SHOES")
        .unwrap_or_else(|| panic!("shoes priced"));
    assert_eq!(shirt.net_ex_tax, Money::new(198_970), "G03 shirt net");
    assert_eq!(shirt.tax_amount, Money::new(19_897), "G03 shirt tax");
    assert_eq!(shoes.net_ex_tax, Money::new(290_303), "G03 shoes net");
    assert_eq!(shoes.tax_amount, Money::new(29_030), "G03 shoes tax");

    // 978, not 1.076: the basis is the goods, and 48.927 of what was paid is
    // not goods.
    assert_eq!(result.points_earned, 978, "G03 awarded points");
}

// Acceptance: E2E-002.
#[test]
fn golden_g02_inclusive_and_exclusive_agree() {
    let inclusive = {
        let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 110_000)], vec![]);
        snap.tax_rules.push(TaxRule {
            tax_category: "STANDARD".into(),
            rate_bps: 1_000,
            inclusive: true,
        });
        resolved(&snap, &context(), &[CartLine::new("SKU1", 1)])
    };
    let exclusive = {
        let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
        snap.tax_rules.push(TaxRule {
            tax_category: "STANDARD".into(),
            rate_bps: 1_000,
            inclusive: false,
        });
        resolved(&snap, &context(), &[CartLine::new("SKU1", 1)])
    };

    // The same three canonical figures from two source conventions.
    assert_eq!(inclusive.net_ex_tax, Money::new(100_000));
    assert_eq!(inclusive.tax_total, Money::new(10_000));
    assert_eq!(inclusive.amount_due, Money::new(110_000));
    assert_eq!(exclusive.net_ex_tax, inclusive.net_ex_tax, "G02 net agrees");
    assert_eq!(exclusive.tax_total, inclusive.tax_total, "G02 tax agrees");
    assert_eq!(exclusive.amount_due, inclusive.amount_due, "G02 due agrees");
}

// Acceptance: BXY-003, E2E-004.
/// The plan's G04: Buy 2 Get 1 with a leftover unit.
///
/// **Frozen.** Decision D01 says the bundle's discount is ALLOCATED across the
/// buyer and reward participants — U01, U02 and U04 here — and that the
/// leftover U03 receives none of it. `Effect::BuyXGetY` is what models that:
/// `Effect::FreeItem`, the other reading of "buy two get one", hands over an
/// extra line and leaves every unit in the basket at full price, so it has
/// nothing to allocate and no participant set to record.
///
/// The difference is not cosmetic. A refund of one unit reads its own allocated
/// amount, so "which units were in the bundle" decides what money comes back —
/// which is exactly why D01 had to state it.
///
/// The expected figures are the spec's own and were computed away from this
/// engine. They are the contract, not a transcription of what the code
/// currently returns: if an edit moves them, the edit is what is wrong.
#[test]
fn golden_g04_buy_two_get_one_with_leftover() {
    let mut snap = snapshot(
        vec![
            entry("U01", Level::Company, None, 400_000),
            entry("U02", Level::Company, None, 300_000),
            entry("U03", Level::Company, None, 200_000),
            entry("U04", Level::Company, None, 100_000),
        ],
        vec![],
    );
    let mut bundle = rule(
        "R1",
        Effect::BuyXGetY {
            buy: 2,
            get: 1,
            reward_bps: 10_000,
        },
    );
    // Named rather than left to the default, which would match the whole cart:
    // D01's pool is stated, and a fixture that relied on "everything" would
    // still pass if the pool were ever computed from something else.
    bundle.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["U01", "U02", "U03", "U04"]),
    });
    snap.rules.push(bundle);

    let cart = [
        CartLine::new("U01", 1),
        CartLine::new("U02", 1),
        CartLine::new("U03", 1),
        CartLine::new("U04", 1),
    ];
    let result = resolved(&snap, &context(), &cart);

    // What D01 and G04 require, to the rupiah.
    let net = |sku: &str| {
        result
            .lines
            .iter()
            .find(|line| line.sku_code == sku)
            .map(|line| line.line_total)
            .unwrap_or_else(|| panic!("{sku} priced"))
    };
    assert_eq!(net("U01"), Money::new(350_000), "buyer, 50.000 allocated");
    assert_eq!(net("U02"), Money::new(262_500), "buyer, 37.500 allocated");
    assert_eq!(
        net("U03"),
        Money::new(200_000),
        "leftover, nothing allocated"
    );
    assert_eq!(net("U04"), Money::new(87_500), "reward, 12.500 allocated");
    assert_eq!(result.total, Money::new(900_000));
    assert_eq!(result.discount_total, Money::new(100_000));
}

// ---------------------------------------------------------------------------
// INV-04 / COM-009 / PRP-006: an independent exhaustive Best Price oracle
// ---------------------------------------------------------------------------
//
// The plan is explicit that Best Price must be checked against an outcome set
// computed independently, "bukan membandingkan engine dengan dirinya sendiri".
// So this does not call the engine. It enumerates EVERY subset of the offers,
// applies the contract's own arithmetic directly, and takes the cheapest basket
// that is valid.
//
// It is exhaustive where the engine is not: the engine tries the whole
// stackable set, that set minus one member, and each solo offer. Anything the
// oracle finds that the engine misses is a real hole in Best Price, and this is
// how it gets found rather than argued about.
//
// Scoped on purpose to what these tests generate — percent offers on a named
// SKU, and fixed-amount offers on the basket — because an oracle that handled
// every effect would be a second engine, and a second engine agrees with the
// first by construction.

/// One outcome the oracle considered.
struct Outcome {
    total: i64,
    applied: Vec<String>,
}

/// Every valid combination of `rules` over `prices`, priced from first
/// principles.
fn oracle_best(prices: &[(&str, i64)], rules: &[Rule]) -> Outcome {
    let mut best: Option<Outcome> = None;

    for mask in 0..(1u32 << rules.len()) {
        let chosen: Vec<&Rule> = rules
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, rule)| rule)
            .collect();

        // Compatibility, as D03 states it: two monetary offers touching the
        // same unit stack only if BOTH combine. Anything not `Stackable` here
        // stands alone.
        let solo = chosen
            .iter()
            .filter(|rule| rule.stacking != Stacking::Stackable)
            .count();
        if solo > 0 && chosen.len() > 1 {
            continue;
        }

        // Line offers first, then basket offers; within a stage, priority
        // ascending then id — D03 again.
        let mut ordered = chosen.clone();
        ordered.sort_by_key(|rule| {
            (
                matches!(
                    rule.scope.applicability,
                    None | Some(Applicability::WholeCart)
                ),
                rule.priority,
                rule.rule_id.clone(),
            )
        });

        let mut totals: Vec<i64> = prices.iter().map(|(_, price)| *price).collect();
        let mut applied = Vec::new();
        let mut valid = true;

        for rule in ordered {
            let hits: Vec<usize> = match &rule.scope.applicability {
                Some(Applicability::Sku { sku_codes }) => prices
                    .iter()
                    .enumerate()
                    .filter(|(_, (sku, _))| sku_codes.contains(*sku))
                    .map(|(index, _)| index)
                    .collect(),
                _ => (0..prices.len()).collect(),
            };
            if hits.is_empty() {
                continue;
            }
            // Thresholds against what the basket has come to so far.
            let reach: i64 = hits.iter().map(|index| totals[*index]).sum();
            if reach < rule.conditions.min_amount.minor {
                continue;
            }
            match &rule.effect {
                Effect::Percent { bps, .. } => {
                    for index in &hits {
                        // HALF_UP per unit, per D11.
                        let cut = (totals[*index] * bps + 5_000) / 10_000;
                        let cut = cut.min(totals[*index]);
                        totals[*index] -= cut;
                    }
                }
                Effect::Amount { amount } => {
                    let capped = amount.minor.min(reach);
                    if capped <= 0 || reach <= 0 {
                        continue;
                    }
                    // Floor each share, then the remainder by largest
                    // fractional part — D11. Written out rather than reused
                    // from the engine, which is the point of an oracle.
                    let mut shares: Vec<(usize, i64, i64)> = hits
                        .iter()
                        .map(|index| {
                            let exact = capped * totals[*index];
                            (*index, exact / reach, exact % reach)
                        })
                        .collect();
                    let handed: i64 = shares.iter().map(|(_, whole, _)| *whole).sum();
                    let mut left = capped - handed;
                    shares.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
                    for share in shares.iter_mut() {
                        if left == 0 {
                            break;
                        }
                        share.1 += 1;
                        left -= 1;
                    }
                    for (index, cut, _) in shares {
                        totals[index] -= cut.min(totals[index]);
                    }
                }
                // Not generated by these tests. A subset containing one is not
                // scored rather than scored wrongly.
                _ => {
                    valid = false;
                    break;
                }
            }
            applied.push(rule.rule_id.clone());
        }
        if !valid {
            continue;
        }

        let total: i64 = totals.iter().sum();
        let better = match &best {
            None => true,
            Some(held) => total < held.total,
        };
        if better {
            best = Some(Outcome { total, applied });
        }
    }
    best.unwrap_or_else(|| panic!("the empty subset is always valid"))
}

// Acceptance: PRP-006.
#[test]
fn best_price_matches_an_exhaustive_oracle_on_the_reviewers_case() {
    let prices = [("SKU1", 600_000)];
    let mut a = rule("R-A", percent(2_000));
    a.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SKU1"]),
    });
    a.stacking = Stacking::Stackable;
    let mut b = rule(
        "R-B",
        Effect::Amount {
            amount: Money::new(150_000),
        },
    );
    b.conditions.min_amount = Money::new(500_000);
    b.stacking = Stacking::Stackable;

    let oracle = oracle_best(&prices, &[a.clone(), b.clone()]);
    assert_eq!(oracle.total, 450_000, "the oracle's own answer");

    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 600_000)], vec![]);
    snap.rules.push(a);
    snap.rules.push(b);
    let engine = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(engine.total.minor, oracle.total, "engine vs oracle");
}

// Acceptance: COM-009.
#[test]
fn best_price_matches_an_exhaustive_oracle_over_generated_baskets() {
    // Small, deterministic, and wide enough to land on the cases that matter:
    // thresholds that a line offer can push a basket under, offers that are
    // worth taking alone, and offers that are worth taking together.
    //
    // Deterministic rather than random so a failure is reproducible without a
    // seed file — the plan asks for stored seeds, and a fixed sweep is the same
    // guarantee with nothing to store.
    let mut checked = 0;
    let mut disagreed = Vec::new();

    for shirt in [100_000i64, 299_000, 600_000] {
        for shoes in [0i64, 150_000, 349_000] {
            for bps in [1_000i64, 2_000, 5_000] {
                for off in [50_000i64, 150_000, 400_000] {
                    for threshold in [0i64, 300_000, 500_000, 700_000] {
                        let mut prices = vec![("SHIRT", shirt)];
                        if shoes > 0 {
                            prices.push(("SHOES", shoes));
                        }

                        let mut a = rule("R-A", percent(bps));
                        a.scope.applicability = Some(Applicability::Sku {
                            sku_codes: skus(&["SHIRT"]),
                        });
                        a.stacking = Stacking::Stackable;

                        let mut b = rule(
                            "R-B",
                            Effect::Amount {
                                amount: Money::new(off),
                            },
                        );
                        b.conditions.min_amount = Money::new(threshold);
                        b.stacking = Stacking::Stackable;

                        let oracle = oracle_best(&prices, &[a.clone(), b.clone()]);

                        let mut snap = snapshot(
                            prices
                                .iter()
                                .map(|(sku, price)| entry(sku, Level::Company, None, *price))
                                .collect(),
                            vec![],
                        );
                        snap.rules.push(a);
                        snap.rules.push(b);
                        let cart: Vec<CartLine> = prices
                            .iter()
                            .map(|(sku, _)| CartLine::new(*sku, 1))
                            .collect();
                        let engine = resolved(&snap, &context(), &cart);

                        checked += 1;
                        if engine.total.minor != oracle.total {
                            disagreed.push(format!(
                                "shirt {shirt} shoes {shoes} {bps}bps off {off} min {threshold}: \
                                 engine {} oracle {} (oracle took {:?})",
                                engine.total.minor, oracle.total, oracle.applied
                            ));
                        }
                    }
                }
            }
        }
    }

    assert!(
        disagreed.is_empty(),
        "{} of {checked} baskets disagree with the exhaustive oracle:\n{}",
        disagreed.len(),
        disagreed.join("\n")
    );
}

// ---------------------------------------------------------------------------
// Buy X Get Y, beyond the one shape G04 pins
// ---------------------------------------------------------------------------
//
// G04 fixes one basket: four units, one bundle, one leftover. Every other
// property of D01 was verified once and then had nothing holding it, which is
// the state a rule is in just before somebody changes it and nothing complains.

fn bogo(id: &str, buy: i64, get: i64, reward_bps: i64) -> Rule {
    rule(
        id,
        Effect::BuyXGetY {
            buy,
            get,
            reward_bps,
        },
    )
}

#[test]
fn a_bundle_needs_a_whole_group_before_it_gives_anything() {
    // g = floor(units / (X + Y)). Two units under buy-two-get-one is not a
    // bundle, and a rule that paid out on a partial group would hand over a
    // free item for a purchase that never reached the offer.
    let snap = {
        let mut snap = snapshot(
            vec![
                entry("U01", Level::Company, None, 100_000),
                entry("U02", Level::Company, None, 100_000),
            ],
            vec![],
        );
        snap.rules.push(bogo("R-BOGO", 2, 1, 10_000));
        snap
    };
    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("U01", 1), CartLine::new("U02", 1)],
    );
    assert_eq!(result.total, Money::new(200_000));
    assert_eq!(result.discount_total, Money::ZERO);
}

#[test]
fn a_bundle_repeats_for_every_complete_group() {
    // Six units under buy-one-get-one is three groups, so three rewards — the
    // plan's own BXY-001 sequence. The rewards are the three cheapest.
    let mut snap = snapshot(
        vec![
            entry("U01", Level::Company, None, 300_000),
            entry("U02", Level::Company, None, 280_000),
            entry("U03", Level::Company, None, 250_000),
            entry("U04", Level::Company, None, 220_000),
            entry("U05", Level::Company, None, 180_000),
            entry("U06", Level::Company, None, 150_000),
        ],
        vec![],
    );
    snap.rules.push(bogo("R-BOGO", 1, 1, 10_000));

    let cart: Vec<CartLine> = ["U01", "U02", "U03", "U04", "U05", "U06"]
        .iter()
        .map(|sku| CartLine::new(*sku, 1))
        .collect();
    let result = resolved(&snap, &context(), &cart);

    // 220.000 + 180.000 + 150.000 — the three cheapest, free.
    assert_eq!(result.discount_total, Money::new(550_000));
    assert_eq!(result.total, Money::new(1_380_000 - 550_000));
}

#[test]
fn a_half_price_reward_is_the_same_offer_at_a_different_depth() {
    // "Buy two get one half price" is a bundle, not a different kind of thing,
    // which is why the depth is a field rather than the effect being hardcoded
    // at free.
    let mut snap = snapshot(
        vec![
            entry("U01", Level::Company, None, 400_000),
            entry("U02", Level::Company, None, 300_000),
            entry("U03", Level::Company, None, 100_000),
        ],
        vec![],
    );
    snap.rules.push(bogo("R-BOGO", 2, 1, 5_000));

    let cart: Vec<CartLine> = ["U01", "U02", "U03"]
        .iter()
        .map(|sku| CartLine::new(*sku, 1))
        .collect();
    let result = resolved(&snap, &context(), &cart);
    // Half of the cheapest unit, spread across all three participants.
    assert_eq!(result.discount_total, Money::new(50_000));
    assert_eq!(result.total, Money::new(750_000));
}

#[test]
fn a_bundle_allocation_sums_to_the_whole_and_never_invents_a_rupiah() {
    // Three units at one price is the case that does not divide: a third of a
    // reward is not a whole number of rupiah. Largest remainder puts the odd
    // one on the lowest line index, and the parts still come to the whole.
    let mut snap = snapshot(
        vec![
            entry("U01", Level::Company, None, 100_000),
            entry("U02", Level::Company, None, 100_000),
            entry("U03", Level::Company, None, 100_000),
        ],
        vec![],
    );
    snap.rules.push(bogo("R-BOGO", 2, 1, 10_000));

    let cart: Vec<CartLine> = ["U01", "U02", "U03"]
        .iter()
        .map(|sku| CartLine::new(*sku, 1))
        .collect();
    let result = resolved(&snap, &context(), &cart);

    let applied = result
        .applied_rules
        .iter()
        .find(|one| one.rule_id == "R-BOGO")
        .unwrap_or_else(|| panic!("the bundle applied"));
    let shares: Vec<i64> = applied
        .line_benefits
        .iter()
        .map(|line| line.benefit.minor)
        .collect();
    assert_eq!(
        shares.iter().sum::<i64>(),
        100_000,
        "the parts are the whole"
    );
    assert_eq!(
        shares,
        vec![33_334, 33_333, 33_333],
        "the odd rupiah goes first"
    );
}

#[test]
fn a_bundle_is_trimmed_by_the_rules_own_ceiling() {
    // A cap on a bundle is a cap like any other, and the trim has to leave the
    // allocation summing to exactly the capped figure — not to the uncapped one
    // with a correction bolted on.
    let mut snap = snapshot(
        vec![
            entry("U01", Level::Company, None, 400_000),
            entry("U02", Level::Company, None, 300_000),
            entry("U03", Level::Company, None, 100_000),
        ],
        vec![],
    );
    let mut capped = bogo("R-BOGO", 2, 1, 10_000);
    capped.max_discount = Some(Money::new(40_000));
    snap.rules.push(capped);

    let cart: Vec<CartLine> = ["U01", "U02", "U03"]
        .iter()
        .map(|sku| CartLine::new(*sku, 1))
        .collect();
    let result = resolved(&snap, &context(), &cart);
    assert_eq!(result.discount_total, Money::new(40_000));

    let applied = result
        .applied_rules
        .iter()
        .find(|one| one.rule_id == "R-BOGO")
        .unwrap_or_else(|| panic!("the bundle applied"));
    let handed: i64 = applied
        .line_benefits
        .iter()
        .map(|line| line.benefit.minor)
        .sum();
    assert_eq!(handed, 40_000, "the allocation follows the cap");
}

// ---------------------------------------------------------------------------
// D02: points allocated per line, because a return takes back one line's worth
// ---------------------------------------------------------------------------

/// How many points a named product earned, across every award.
fn points_on(result: &PricingResult, sku: &str) -> i64 {
    let line = result
        .lines
        .iter()
        .position(|one| one.sku_code == sku)
        .unwrap_or_else(|| panic!("{sku} priced"));
    result
        .earn_awards
        .iter()
        .flat_map(|award| award.line_points.iter())
        .filter(|share| share.line == line)
        .map(|share| share.points)
        .sum()
}

#[test]
fn golden_g01_points_are_allocated_per_line() {
    // The plan's own per-unit figures for G01: 438 on the shirt, 638 on the
    // shoes, 1.076 together. Without them a return of the shoes would have to
    // guess, and the guess would be today's rate against yesterday's goods.
    let (snap, cart) = golden_g01();
    let result = resolved(&snap, &with_coupon("GOLDEN-B"), &cart);

    assert_eq!(result.points_earned, 1_076);
    assert_eq!(points_on(&result, "SHIRT"), 438, "G01 shirt points");
    assert_eq!(points_on(&result, "SHOES"), 638, "G01 shoes points");
}

#[test]
fn golden_g03_points_are_allocated_per_line_on_the_net() {
    // The same basket taxed. 978 together, and the split follows the NET of
    // each line rather than what was paid for it.
    let (mut snap, cart) = golden_g01();
    snap.tax_rules.push(TaxRule {
        tax_category: "STANDARD".into(),
        rate_bps: 1_000,
        inclusive: true,
    });
    let result = resolved(&snap, &with_coupon("GOLDEN-B"), &cart);

    assert_eq!(result.points_earned, 978);
    assert_eq!(points_on(&result, "SHIRT"), 398, "G03 shirt points");
    assert_eq!(points_on(&result, "SHOES"), 580, "G03 shoes points");
}

// Acceptance: PTS-007.
#[test]
fn the_parts_of_an_award_always_come_to_the_whole() {
    // Whole points over the basket, then split — never a floor per line. Two
    // lines of 1.500 at a point per 1.000 earn one each if each is floored, and
    // three if the basket is. Three is right: the shopper spent 3.000.
    let mut snap = snapshot(
        vec![
            entry("A", Level::Company, None, 1_500),
            entry("B", Level::Company, None, 1_500),
        ],
        vec![],
    );
    snap.rules.push(rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    ));

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("A", 1), CartLine::new("B", 1)],
    );
    assert_eq!(result.points_earned, 3, "the basket, not two floors");

    let allocated: i64 = result
        .earn_awards
        .iter()
        .flat_map(|award| award.line_points.iter())
        .map(|share| share.points)
        .sum();
    assert_eq!(allocated, 3, "the parts are the whole");
    // Equal bases, so the odd point goes to the lower line index.
    assert_eq!(points_on(&result, "A"), 2);
    assert_eq!(points_on(&result, "B"), 1);
}

#[test]
fn a_flat_bonus_is_shared_by_the_lines_that_qualified_for_it() {
    // "500 points on this basket" belongs to no line, and leaving it
    // unallocated would let a shopper return everything and keep it.
    let mut snap = snapshot(
        vec![
            entry("A", Level::Company, None, 300_000),
            entry("B", Level::Company, None, 100_000),
        ],
        vec![],
    );
    snap.rules.push(rule(
        "BONUS",
        Effect::EarnPoints(EarnEffect::FixedPoints { points: 500 }),
    ));

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("A", 1), CartLine::new("B", 1)],
    );
    assert_eq!(result.points_earned, 500);
    assert_eq!(points_on(&result, "A"), 375, "three quarters of the basket");
    assert_eq!(points_on(&result, "B"), 125);
}

// ---------------------------------------------------------------------------
// "Not valid on sale items", as a thing a rule has to say
// ---------------------------------------------------------------------------

#[test]
fn a_promotion_leaves_marked_down_goods_alone_unless_it_says_otherwise() {
    // The locked default. A markdown has already given margin away, and an
    // offer on top gives away a second slice of what is left — authored by
    // somebody else, for a different reason, usually without either knowing.
    let mut snap = snapshot(
        vec![
            entry("PLAIN", Level::Company, None, 100_000),
            entry("CLEARED", Level::Company, None, 100_000),
        ],
        vec![markdown("CLEARED", 60_000)],
    );
    snap.rules.push(rule("R1", percent(1_000)));

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("PLAIN", 1), CartLine::new("CLEARED", 1)],
    );
    // Ten per cent of the full-price line only.
    assert_eq!(result.discount_total, Money::new(10_000));
    assert_eq!(result.total, Money::new(150_000));
}

// Acceptance: PRC-003.
#[test]
fn a_cleared_line_that_is_excluded_does_not_count_toward_the_threshold_either() {
    // The half that is easy to get wrong. A rule that ignored cleared goods for
    // the discount but counted them toward its minimum spend would qualify on
    // goods it then refuses to touch — the shopper reaches the threshold and
    // gets nothing for the item that took them there.
    //
    // 60.000 of full-price goods beside 400.000 of cleared goods is 460.000 on
    // the receipt and 60.000 to this offer, which asks for 100.000.
    let mut snap = snapshot(
        vec![
            entry("PLAIN", Level::Company, None, 60_000),
            entry("CLEARED", Level::Company, None, 500_000),
        ],
        vec![markdown("CLEARED", 400_000)],
    );
    let mut basket = rule(
        "R-BASKET",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    basket.conditions.min_amount = Money::new(100_000);
    snap.rules.push(basket);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("PLAIN", 1), CartLine::new("CLEARED", 1)],
    );
    assert_eq!(result.discount_total, Money::ZERO, "it does not qualify");
    assert_eq!(why(&result, "R-BASKET"), RejectionReason::AmountTooLow);
    assert_eq!(result.total, Money::new(460_000));
}

// Acceptance: PRC-004.
#[test]
fn a_clearance_event_can_say_that_stacking_is_the_point() {
    // The deliberate exception: an offer written FOR the clearance. Saying it
    // out loud is the whole design — the other default fails silently, and
    // nobody notices the offers compounding until the margin report lands.
    let mut snap = snapshot(
        vec![entry("CLEARED", Level::Company, None, 100_000)],
        vec![markdown("CLEARED", 60_000)],
    );
    let mut deeper = rule("R1", percent(1_000));
    deeper.markdown_policy = MarkdownPolicy::Allow;
    snap.rules.push(deeper);

    let result = resolved(&snap, &context(), &[CartLine::new("CLEARED", 1)]);
    // Ten per cent of the cleared price, not of the ticket.
    assert_eq!(result.discount_total, Money::new(6_000));
    assert_eq!(result.total, Money::new(54_000));
}

#[test]
fn a_rule_kept_out_by_a_markdown_says_so_rather_than_blaming_the_basket() {
    // The reason a person reads. "Nothing in the basket qualifies" sends a
    // merchandiser hunting a scope bug while the SKU the rule names is sitting
    // in the basket — on sale. The two facts are identical to the engine and
    // opposite to the reader.
    let mut snap = snapshot(
        vec![entry("CLEARED", Level::Company, None, 100_000)],
        vec![markdown("CLEARED", 60_000)],
    );
    let mut offer = rule("R1", percent(1_000));
    offer.scope.applicability = Some(Applicability::Sku {
        sku_codes: ["CLEARED".to_string()].into_iter().collect(),
    });
    snap.rules.push(offer);

    let result = resolved(&snap, &context(), &[CartLine::new("CLEARED", 1)]);
    assert_eq!(why(&result, "R1"), RejectionReason::MarkdownExcluded);
}

#[test]
fn a_rule_that_names_goods_nobody_bought_still_blames_the_basket() {
    // The other side of that fork: the markdown is present but the rule was
    // never about it. Blaming the markdown here would be the same lie pointed
    // the other way.
    let mut snap = snapshot(
        vec![
            entry("CLEARED", Level::Company, None, 100_000),
            entry("OTHER", Level::Company, None, 50_000),
        ],
        vec![markdown("CLEARED", 60_000)],
    );
    let mut offer = rule("R1", percent(1_000));
    offer.scope.applicability = Some(Applicability::Sku {
        sku_codes: ["ABSENT".to_string()].into_iter().collect(),
    });
    snap.rules.push(offer);

    let result = resolved(&snap, &context(), &[CartLine::new("CLEARED", 1)]);
    assert_eq!(why(&result, "R1"), RejectionReason::NothingMatched);
}

// ---------------------------------------------------------------------------
// What an exclusive offer actually claims
// ---------------------------------------------------------------------------

/// A basket with two very different things in it, so "the rest of the basket"
/// is a real place rather than a figure of speech.
fn shoes_and_shirts() -> PricingSnapshot {
    snapshot(
        vec![
            entry("SHOES", Level::Company, None, 500_000),
            entry("SHIRT", Level::Company, None, 200_000),
        ],
        vec![],
    )
}

/// Twenty per cent off the footwear, and it will not share.
fn exclusive_on_shoes(scope: ExclusiveScope) -> Rule {
    let mut only_shoes = rule("R-SHOES", percent(2_000));
    only_shoes.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHOES"]),
    });
    only_shoes.stacking = Stacking::Exclusive;
    only_shoes.exclusive_scope = scope;
    only_shoes
}

/// Fifty thousand off the shirts, willing to combine with anything.
fn fifty_off_shirts() -> Rule {
    let mut shirts = rule(
        "R-SHIRTS",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    shirts.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHIRT"]),
    });
    shirts.stacking = Stacking::Stackable;
    shirts
}

#[test]
fn an_exclusive_offer_shuts_out_the_whole_basket_unless_it_is_narrowed() {
    // The default, and it has to stay the default: every promotion ever
    // published carries this reading, and widening them all at once is a
    // change nobody authored. The shirt offer is refused even though the
    // exclusive one never goes near a shirt.
    let mut snap = shoes_and_shirts();
    snap.rules.push(exclusive_on_shoes(ExclusiveScope::Basket));
    snap.rules.push(fifty_off_shirts());

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHOES", 1), CartLine::new("SHIRT", 1)],
    );
    assert_eq!(applied_ids(&result), vec!["R-SHOES"]);
    assert_eq!(result.total, Money::new(600_000), "700.000 less 100.000");
    assert_eq!(
        why(&result, "R-SHIRTS"),
        RejectionReason::DisplacedByExclusiveRule
    );
}

// Acceptance: COM-005.
#[test]
fn an_exclusive_line_offer_leaves_the_rest_of_the_basket_alone() {
    // The narrow reading, said out loud. The footwear offer still refuses to
    // share the shoes; the shirts were never its to claim, and an offer that
    // lands on them is none of its business.
    let mut snap = shoes_and_shirts();
    snap.rules.push(exclusive_on_shoes(ExclusiveScope::Line));
    snap.rules.push(fifty_off_shirts());

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHOES", 1), CartLine::new("SHIRT", 1)],
    );
    assert_eq!(applied_ids(&result), vec!["R-SHIRTS", "R-SHOES"]);
    assert_eq!(
        result.total,
        Money::new(550_000),
        "100.000 off the shoes and 50.000 off the shirts, not one or the other"
    );
}

#[test]
fn an_offer_that_wants_a_claimed_line_is_still_shut_out() {
    // The half that must not become permissive. "Exclusive on the lines it
    // touches" is still exclusive on those lines: a second offer reaching for
    // the same shoes loses, and is told why.
    let mut snap = shoes_and_shirts();
    snap.rules.push(exclusive_on_shoes(ExclusiveScope::Line));
    let mut more_off_shoes = rule("R-MORE", percent(1_000));
    more_off_shoes.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHOES"]),
    });
    more_off_shoes.stacking = Stacking::Stackable;
    snap.rules.push(more_off_shoes);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHOES", 1), CartLine::new("SHIRT", 1)],
    );
    assert_eq!(applied_ids(&result), vec!["R-SHOES"]);
    assert_eq!(result.total, Money::new(600_000));
    assert_eq!(
        why(&result, "R-MORE"),
        RejectionReason::DisplacedByExclusiveRule
    );
}

#[test]
fn a_basket_offer_beside_a_line_claim_is_measured_on_what_is_left() {
    // The trap the markdown policy already fell into once, arriving by another
    // door: an offer allowed to COUNT the claimed shoes toward its threshold
    // but not to discount them would qualify on goods it is forbidden to
    // touch. The basket here is 700.000 and the offer asks for 300.000 — but
    // once the shoes are claimed there is only a 200.000 shirt left, so it does
    // not reach, and the shoes it cannot have must not carry it there.
    let mut snap = shoes_and_shirts();
    snap.rules.push(exclusive_on_shoes(ExclusiveScope::Line));
    let mut whole_basket = rule(
        "R-BASKET",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    whole_basket.scope.applicability = Some(Applicability::WholeCart);
    whole_basket.stacking = Stacking::Stackable;
    whole_basket.conditions.min_amount = Money::new(300_000);
    snap.rules.push(whole_basket);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHOES", 1), CartLine::new("SHIRT", 1)],
    );
    assert_eq!(applied_ids(&result), vec!["R-SHOES"]);
    assert_eq!(result.total, Money::new(600_000));
}

#[test]
fn a_basket_offer_that_still_reaches_on_the_rest_does_apply() {
    // The other side of that fork. The same shape with a threshold the shirt
    // alone clears: the offer runs beside the claim, measured on the shirt and
    // landing on the shirt.
    let mut snap = shoes_and_shirts();
    snap.rules.push(exclusive_on_shoes(ExclusiveScope::Line));
    let mut whole_basket = rule(
        "R-BASKET",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    whole_basket.scope.applicability = Some(Applicability::WholeCart);
    whole_basket.stacking = Stacking::Stackable;
    whole_basket.conditions.min_amount = Money::new(150_000);
    snap.rules.push(whole_basket);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHOES", 1), CartLine::new("SHIRT", 1)],
    );
    assert_eq!(applied_ids(&result), vec!["R-BASKET", "R-SHOES"]);
    assert_eq!(result.total, Money::new(550_000));
    // All fifty thousand off the shirt: none of it may land on the shoes.
    assert_eq!(result.lines[0].line_total, Money::new(400_000), "the shoes");
    assert_eq!(result.lines[1].line_total, Money::new(150_000), "the shirt");
}

// ---------------------------------------------------------------------------
// How several earning rates combine on one line
// ---------------------------------------------------------------------------

/// A loyalty rule at one point per this much spend.
fn earns_per(id: &str, spend: i64) -> Rule {
    rule(
        id,
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(spend),
        }),
    )
}

/// One 60.000 line and three rates over it: the everyday one at a point per
/// 30.000 (two points — this is the 1x), a double at 15.000, a triple at
/// 10.000. Ids are ordered so the fold order is stated rather than incidental.
fn three_rates(double: PointsCombination, triple: PointsCombination) -> PricingSnapshot {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 60_000)], vec![]);
    snap.rules.push(earns_per("E-A-EVERYDAY", 30_000));
    let mut twice = earns_per("E-B-DOUBLE", 15_000);
    twice.points_combination = double;
    snap.rules.push(twice);
    let mut thrice = earns_per("E-C-TRIPLE", 10_000);
    thrice.points_combination = triple;
    snap.rules.push(thrice);
    snap
}

#[test]
fn a_beaten_earning_rate_still_earns_nothing_unless_it_says_otherwise() {
    // The default, and the arithmetic the engine already did. Three offers
    // reach the line and the best one takes it: six points, not eight and not
    // twelve. Any other default would raise the points every loyalty rule
    // already published awards, on baskets that have already been rung.
    let snap = three_rates(PointsCombination::Highest, PointsCombination::Highest);
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 6, "three times the everyday two");
    assert_eq!(
        result.earn_awards.len(),
        1,
        "one rate won the line outright"
    );
}

#[test]
fn bonus_rates_that_add_are_worth_what_they_beat_the_everyday_rate_by() {
    // 2x beside 3x is 4x: one for the everyday rate, one more from the double,
    // two more from the triple. Eight points on a line the everyday rate alone
    // would have earned two on.
    //
    // The everyday rate is the anchor and is therefore worth nothing extra over
    // itself — which is why this is 1 + 1 + 2 and not 1 + 1 + 1 + 2.
    let snap = three_rates(PointsCombination::Add, PointsCombination::Highest);
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 8);

    // And it is attributed to the offer that gave it, not folded into the
    // winner. A points ledger that could not say which promotion paid out
    // cannot answer what a promotion cost.
    let double = result
        .earn_awards
        .iter()
        .find(|award| award.rule_id == "E-B-DOUBLE")
        .unwrap_or_else(|| panic!("the double did not earn: {:?}", result.earn_awards));
    assert_eq!(double.points, 2);
}

#[test]
fn bonus_rates_that_compound_multiply_what_the_line_has_already_earned() {
    // 2x times 3x is 6x — twelve points where the everyday rate alone gives
    // two. The one that runs away with a basket, which is why it has to be
    // asked for.
    let snap = three_rates(PointsCombination::Compound, PointsCombination::Highest);
    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 12);
}

#[test]
fn a_bonus_rate_needs_an_everyday_rate_to_be_a_multiple_of() {
    // Two rates and no everyday one. "Double points" is a number only against
    // something, and with nothing standing all year there is nothing to double:
    // the better rate takes the line and says so, whatever the loser asked for.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 60_000)], vec![]);
    let mut twice = earns_per("E-B-DOUBLE", 15_000);
    twice.points_combination = PointsCombination::Compound;
    snap.rules.push(twice);
    snap.rules.push(earns_per("E-C-TRIPLE", 10_000));

    let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.points_earned, 6, "the triple, alone");
}

#[test]
fn a_bonus_earns_only_on_the_lines_the_bonus_reaches() {
    // The per-line selection this is built on top of, still holding. The
    // double covers the shirt only, so the shoes earn the plain three points
    // and the shirt earns four: three from the triple plus one the double is
    // worth over the everyday rate.
    let mut snap = snapshot(
        vec![
            entry("SHIRT", Level::Company, None, 30_000),
            entry("SHOES", Level::Company, None, 30_000),
        ],
        vec![],
    );
    snap.rules.push(earns_per("E-A-EVERYDAY", 30_000));
    let mut twice = earns_per("E-B-DOUBLE", 15_000);
    twice.points_combination = PointsCombination::Add;
    twice.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHIRT"]),
    });
    snap.rules.push(twice);
    snap.rules.push(earns_per("E-C-TRIPLE", 10_000));

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHIRT", 1), CartLine::new("SHOES", 1)],
    );
    // Three per line from the triple, and one more on the shirt.
    assert_eq!(result.points_earned, 7);
    let double = result
        .earn_awards
        .iter()
        .find(|award| award.rule_id == "E-B-DOUBLE")
        .unwrap_or_else(|| panic!("the double did not earn: {:?}", result.earn_awards));
    assert_eq!(double.points, 1);
    assert_eq!(
        double.line_points,
        vec![LinePoints { line: 0, points: 1 }],
        "the bonus belongs to the shirt, and a return of the shoes must not take it"
    );
}

#[test]
fn every_award_still_adds_up_to_what_its_lines_were_given() {
    // The invariant a return depends on, held through the merge: a rule that
    // earned as a winner on one line and as a bonus on another is ONE award,
    // and its line figures still come to its total.
    let mut snap = snapshot(
        vec![
            entry("SHIRT", Level::Company, None, 90_000),
            entry("SHOES", Level::Company, None, 90_000),
        ],
        vec![],
    );
    snap.rules.push(earns_per("E-A-EVERYDAY", 30_000));
    // Wins the shoes outright, and is a bonus on the shirt where the triple
    // beats it.
    let mut twice = earns_per("E-B-DOUBLE", 15_000);
    twice.points_combination = PointsCombination::Add;
    snap.rules.push(twice);
    let mut thrice = earns_per("E-C-TRIPLE", 10_000);
    thrice.scope.applicability = Some(Applicability::Sku {
        sku_codes: skus(&["SHIRT"]),
    });
    snap.rules.push(thrice);

    let result = resolved(
        &snap,
        &context(),
        &[CartLine::new("SHIRT", 1), CartLine::new("SHOES", 1)],
    );
    let double = result
        .earn_awards
        .iter()
        .filter(|award| award.rule_id == "E-B-DOUBLE")
        .collect::<Vec<_>>();
    assert_eq!(double.len(), 1, "one row per cause, never two");
    for award in &result.earn_awards {
        let parts: i64 = award.line_points.iter().map(|line| line.points).sum();
        assert_eq!(parts, award.points, "{} does not add up", award.rule_id);
    }
    let total: i64 = result.earn_awards.iter().map(|award| award.points).sum();
    assert_eq!(total, result.points_earned);
}

// ---------------------------------------------------------------------------
// The limit that is counted per shopper
// ---------------------------------------------------------------------------

/// A shopper the till has identified, and what this node knows about them.
///
/// `None` is a node that keeps no customer history — a till — and is a
/// different answer from a node that looked and found nothing.
fn shopper(history: Option<BTreeMap<String, i64>>) -> PricingContext {
    let mut context = context().for_customer("cust-1");
    context.customer_history = history;
    context
}

/// What one shopper has already had of one rule.
fn had(rule_id: &str, uses: i64) -> BTreeMap<String, i64> {
    [(rule_id.to_string(), uses)].into_iter().collect()
}

fn once_per_shopper(id: &str) -> Rule {
    let mut offer = rule(id, percent(1_000));
    offer.max_uses_per_customer = Some(1);
    offer
}

#[test]
fn a_shopper_who_has_already_had_an_offer_does_not_get_it_twice() {
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(once_per_shopper("R1"));

    let result = resolved(
        &snap,
        &shopper(Some(had("R1", 1))),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::CustomerLimitReached);
}

#[test]
fn a_shopper_who_has_not_had_it_yet_still_gets_it() {
    // The other side, and the one that proves the count is read rather than the
    // limit merely being refused. A history that was LOOKED UP and came back
    // empty is an answer.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(once_per_shopper("R1"));

    let result = resolved(
        &snap,
        &shopper(Some(BTreeMap::new())),
        &[CartLine::new("SKU1", 1)],
    );
    assert_eq!(result.total, Money::new(90_000));
    assert_eq!(applied_ids(&result), vec!["R1"]);
}

#[test]
fn a_limit_per_shopper_is_refused_where_nothing_counts_the_shopper() {
    // The reason the field is an `Option` rather than an empty map. A node that
    // keeps no customer history would read nought for every shopper alive, and
    // "once per customer" would mean once per basket, at thirteen shops, for
    // ever. Refused loudly beats given away quietly.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(once_per_shopper("R1"));

    let result = resolved(&snap, &shopper(None), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::CustomerUsageUnknown);
}

#[test]
fn a_limit_per_shopper_needs_a_shopper_to_count_against() {
    // An anonymous sale records nothing against anybody, so a limit counted per
    // shopper cannot be kept for one. The offer is members-only in effect, and
    // the answer says so rather than inventing a third story.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(once_per_shopper("R1"));

    let mut anonymous = context();
    anonymous.customer_history = Some(BTreeMap::new());
    let result = resolved(&snap, &anonymous, &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(100_000));
    assert_eq!(why(&result, "R1"), RejectionReason::NotThisCustomer);
}

#[test]
fn a_rule_without_a_per_shopper_limit_never_asks_about_the_shopper() {
    // Every promotion published to date carries no limit here, and none of them
    // may start needing a customer history that no node had when they were
    // written.
    let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule("R1", percent(1_000)));

    let result = resolved(&snap, &shopper(None), &[CartLine::new("SKU1", 1)]);
    assert_eq!(result.total, Money::new(90_000));
}

// ---------------------------------------------------------------------------
// Charges: on the bill, out of everything else
// ---------------------------------------------------------------------------

fn delivery(amount_minor: i64) -> Charge {
    Charge {
        code: "DELIVERY".into(),
        description: "Kirim ke alamat".into(),
        amount_minor,
        tax_category: "STANDARD".into(),
    }
}

#[test]
fn a_delivery_fee_is_owed_but_is_not_sales() {
    // The three totals stay apart on purpose: `total` is goods, `net_ex_tax` is
    // Net Sales, and only `amount_due` has the courier in it. A report that
    // called the fee "sales" would overstate the shop's trade by the price of
    // a motorbike ride.
    let mut snap = snapshot(vec![entry("SHIRT", Level::Company, None, 100_000)], vec![]);
    taxed(&mut snap, 1_100, true);
    let context = context().with_charge(delivery(20_000));

    let result = resolved(&snap, &context, &[CartLine::new("SHIRT", 1)]);

    assert_eq!(result.total, Money::new(100_000), "the goods");
    // 100.000 × 1100 / 11100 = 9.909,9 → 9.909. Truncating, not rounding: the
    // estate settled that in `retail-tax` and this is the same function.
    assert_eq!(
        result.net_ex_tax,
        Money::new(90_091),
        "Net Sales, goods only"
    );
    assert_eq!(result.tax_total, Money::new(9_909), "tax on the goods");
    // The fee, taxed on its own terms rather than at the goods rate:
    // 20.000 × 1100 / 11100 = 1.981,9 → 1.981.
    assert_eq!(result.charge_total, Money::new(20_000));
    assert_eq!(result.charge_net_ex_tax, Money::new(18_019));
    assert_eq!(result.charge_tax_total, Money::new(1_981));
    assert_eq!(result.amount_due, Money::new(120_000), "goods plus the fee");
}

#[test]
fn the_amount_due_is_the_goods_plus_every_charge_and_a_till_settles_against_it() {
    // Trivial arithmetic, expensive failure: a till that settled against
    // `total` would hand the goods over, never ask for the fee, and the drawer
    // would balance — because nobody asked.
    let mut snap = snapshot(vec![entry("SHIRT", Level::Company, None, 250_000)], vec![]);
    taxed(&mut snap, 1_100, true);
    let context = context().with_charge(delivery(15_000)).with_charge(Charge {
        code: "PACKAGING".into(),
        description: "Kotak kado".into(),
        amount_minor: 7_500,
        tax_category: "STANDARD".into(),
    });

    let result = resolved(&snap, &context, &[CartLine::new("SHIRT", 1)]);

    assert_eq!(result.charges.len(), 2);
    assert_eq!(
        result.amount_due,
        result.total.try_add(result.charge_total).expect("sum"),
    );
    assert_eq!(
        result.net_ex_tax.try_add(result.tax_total).expect("sum"),
        result.total,
        "the goods split has to close"
    );
    assert_eq!(
        result
            .charge_net_ex_tax
            .try_add(result.charge_tax_total)
            .expect("sum"),
        result.charge_total,
        "and so does the fee split"
    );
    assert_eq!(result.amount_due, Money::new(272_500));
}

#[test]
fn no_promotion_reaches_a_charge_not_even_one_that_says_everything() {
    // The one that would, if anything did. "10% off the whole cart" means
    // everything the shop SELLS — not 10% off the courier, who is paid the
    // same either way. A shop that wants to give delivery away sends a charge
    // of nought, which is a decision somebody made and can point at.
    let mut snap = snapshot(vec![entry("SHIRT", Level::Company, None, 100_000)], vec![]);
    snap.rules.push(rule("R1", percent(1_000)));
    let context = context().with_charge(delivery(20_000));

    let result = resolved(&snap, &context, &[CartLine::new("SHIRT", 1)]);

    assert_eq!(
        result.discount_total,
        Money::new(10_000),
        "10% of the shirt"
    );
    assert_eq!(result.total, Money::new(90_000));
    assert_eq!(
        result.charge_total,
        Money::new(20_000),
        "the fee is untouched"
    );
    assert_eq!(result.amount_due, Money::new(110_000));
}

#[test]
fn a_delivery_fee_does_not_get_a_shopper_over_a_minimum_spend() {
    // 450.000 of goods beside a 60.000 fee is 510.000 on the bill and 450.000
    // to an offer that asks for 500.000. Counting the fee would let a shopper
    // unlock a discount by paying the courier, and the shop would be giving
    // away margin in exchange for money it passes straight on.
    let mut snap = snapshot(vec![entry("COAT", Level::Company, None, 450_000)], vec![]);
    let mut basket = rule(
        "R-BASKET",
        Effect::Amount {
            amount: Money::new(50_000),
        },
    );
    basket.conditions.min_amount = Money::new(500_000);
    snap.rules.push(basket);
    let context = context().with_charge(delivery(60_000));

    let result = resolved(&snap, &context, &[CartLine::new("COAT", 1)]);

    assert_eq!(result.discount_total, Money::ZERO, "it does not qualify");
    assert_eq!(why(&result, "R-BASKET"), RejectionReason::AmountTooLow);
    assert_eq!(result.amount_due, Money::new(510_000));
}

#[test]
fn a_charge_earns_no_points() {
    // The locked rule: points accrue on the goods after discount, before tax,
    // without charges. A shopper who pays for delivery has not bought anything
    // more, and a loyalty scheme that rewarded the courier would pay out most
    // on the orders the shop makes least on.
    let mut snap = snapshot(vec![entry("SHIRT", Level::Company, None, 100_000)], vec![]);
    let mut earn = rule(
        "R-EARN",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(10_000),
        }),
    );
    earn.earn_basis = EarnBasis::PostDiscountNet;
    snap.rules.push(earn);
    let context = context().with_charge(delivery(50_000));

    let result = resolved(&snap, &context, &[CartLine::new("SHIRT", 1)]);

    // Ten points for the shirt. Fifteen would mean the fee earned five.
    assert_eq!(result.points_earned, 10);
    assert_eq!(result.amount_due, Money::new(150_000));
}

#[test]
fn a_charge_in_a_category_the_book_never_taxed_is_reported_untaxed_not_guessed() {
    // The same honesty the goods get. A book that says nothing about `SERVICE`
    // has no rate to apply, and inventing one would put money on a tax return
    // that nobody owes.
    let mut snap = snapshot(vec![entry("SHIRT", Level::Company, None, 100_000)], vec![]);
    taxed(&mut snap, 1_100, true);
    let context = context().with_charge(Charge {
        code: "SERVICE".into(),
        description: "Biaya layanan".into(),
        amount_minor: 5_000,
        tax_category: "SERVICE".into(),
    });

    let result = resolved(&snap, &context, &[CartLine::new("SHIRT", 1)]);

    assert_eq!(result.charge_tax_total, Money::ZERO);
    assert_eq!(result.charge_net_ex_tax, Money::new(5_000));
    assert_eq!(result.charges[0].tax_category, "SERVICE");
}

#[test]
fn a_bill_with_no_charges_is_exactly_what_it_was_before_charges_existed() {
    // Every sale already recorded, and every sale a shop makes over a counter.
    // The field arriving must not move one rupiah of them.
    let mut snap = snapshot(vec![entry("SHIRT", Level::Company, None, 100_000)], vec![]);
    taxed(&mut snap, 1_100, true);

    let result = resolved(&snap, &context(), &[CartLine::new("SHIRT", 1)]);

    assert!(result.charges.is_empty());
    assert_eq!(result.charge_total, Money::ZERO);
    assert_eq!(result.amount_due, result.total);
}
