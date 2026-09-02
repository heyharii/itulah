use super::*;
use chrono::TimeZone;
use std::collections::BTreeSet;

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
        priority: 0,
        stacking: Stacking::Alone,
        advisory: false,
        earn_basis: EarnBasis::default(),
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
    snap.rules.push(rule("R1", percent(1_000)));

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
    assert_eq!(result.points_earned, 100);
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
    snap.rules.push(rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(10_000),
        }),
    ));

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
    let mut offer = rule("R1", Effect::Amount {
        amount: Money::new(50_000),
    });
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
    let apportioned = applied
        .line_benefits
        .iter()
        .fold(Money::ZERO, |sum, line| {
            sum.try_add(line.benefit).unwrap_or(Money::ZERO)
        });
    assert_eq!(apportioned, applied.benefit);
}
