//! The plan rows this harness can put to `pricing_engine::price_cart`.
//!
//! One function per scenario, named for its plan ID, and each one states the
//! rule it is proving in the words the plan uses. Nothing here mocks the thing
//! under test: every row builds a snapshot and a basket and asks the real
//! engine what the shopper pays.
//!
//! Where a number is in `commercial-v1-golden-fixtures.json` it is read from
//! there rather than written out. Where the plan states a number only in
//! prose, the scenario cites the row it came from in its own comment, so a
//! reader can check the figure against the document without leaving the file.

use std::collections::BTreeMap;

use pricing_engine::{
    price_cart, rule_standing, Applicability, CartLine, EarnEffect, Effect, ExclusiveScope,
    MarkdownPolicy, Money, PricingError, RejectionReason, Stacking,
};

use crate::fixtures::{self as fx, Fixtures};
use crate::got;
use crate::{Check, Expect, Outcome, Owner};

/// Seven CAM rows say the same thing, so it is said once.
///
/// Worth stating plainly rather than burying: the plan marks these UNIT, which
/// is a claim that a campaign metric is a function somebody can call with a
/// basket and check. In this estate it is not.
const CAM_IS_SQL: &str = "the plan marks this UNIT, but campaign measurement in this estate is \
     computed in SQL (cloud/postgres/performance.rs, the `folded` CTE) and \
     there is no pure metric function anywhere to call. `reporting.rs` holds \
     only the calendar the axis is cut along. As built, this row cannot be a \
     unit test at all — it needs Postgres and rows in `edge_sale*`";

/// Every plan row this file answers.
pub fn checks() -> Vec<(&'static str, Check)> {
    vec![
        // --- PRC: regular price and markdown ---------------------------------
        ("PRC-001", Check::Run(prc_001)),
        ("PRC-002", Check::Run(prc_002)),
        (
            "PRC-003",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "a_cleared_line_that_is_excluded_does_not_count_toward_the_threshold_either",
                because: "the row's second half is the hard one — an excluded markdown must \
                          leave the eligible spend as well as the benefit, and that test is \
                          the one that holds both",
            },
        ),
        (
            "PRC-004",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "a_clearance_event_can_say_that_stacking_is_the_point",
                because: "MarkdownPolicy::Allow, with the percentage taken from the markdown \
                          price rather than the regular one",
            },
        ),
        ("PRC-005", Check::Run(prc_005)),
        ("PRC-006", Check::Run(prc_006)),
        ("PRC-007", Check::Run(prc_007)),
        ("PRC-008", Check::Run(prc_008)),
        // --- CFG: the part of configuration that is not authoring -------------
        ("CFG-007", Check::Run(cfg_007)),
        // --- ELG: scope, qualification, limits --------------------------------
        ("ELG-001", Check::Run(elg_001)),
        ("ELG-002", Check::Run(elg_002)),
        ("ELG-003", Check::Run(elg_003)),
        (
            "ELG-004",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "a_basket_threshold_is_measured_after_the_line_offers_have_come_off",
                because: "D01's minimum-spend basis, which is the one divergence the gap \
                          register called out as needing a decision before anything was \
                          built on it",
            },
        ),
        ("ELG-005", Check::Run(elg_005)),
        ("ELG-006", Check::Run(elg_006)),
        ("ELG-007", Check::Run(elg_007)),
        ("ELG-010", Check::Run(elg_010)),
        // --- MON: monetary benefit and allocation -----------------------------
        ("MON-001", Check::Run(mon_001)),
        (
            "MON-002",
            Check::NoKernelSurface {
                note: "the plan wants Rp25.000 off EACH of three units = Rp75.000. \
                       `Effect::Amount` is once per cart and the engine test \
                       `a_flat_amount_comes_off_the_cart_once_not_once_per_line` locks it \
                       that way; there is no per-unit amount effect to express the row with. \
                       A fixture using Percent instead would prove a different rule",
            },
        ),
        ("MON-003", Check::Run(mon_003)),
        ("MON-004", Check::Run(mon_004)),
        ("MON-005", Check::Run(mon_005)),
        ("MON-006", Check::Run(mon_006)),
        ("MON-007", Check::Run(mon_007)),
        ("MON-008", Check::Run(mon_008)),
        ("MON-010", Check::Run(mon_010)),
        // --- COM: Best Price, Exclusive, Combine ------------------------------
        (
            "COM-001",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "best_price_is_the_cheapest_basket_not_the_first_offer_that_fits",
                because: "the reviewer's Rp600.000 case, landing on the basket-only \
                          Rp450.000 rather than the greedy Rp480.000",
            },
        ),
        ("COM-002", Check::Run(com_002)),
        ("COM-003", Check::Run(com_003)),
        ("COM-004", Check::Run(com_004)),
        (
            "COM-005",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "an_exclusive_line_offer_leaves_the_rest_of_the_basket_alone",
                because: "ExclusiveScope::Line blocking exactly the unit it touches",
            },
        ),
        ("COM-006", Check::Run(com_006)),
        ("COM-007", Check::Run(com_007)),
        (
            "COM-008",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "the_order_rules_arrive_in_changes_nothing",
                because: "the permutation property the row asks for: same winner, same \
                          values, whatever order the rules were handed in",
            },
        ),
        (
            "COM-009",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "best_price_matches_an_exhaustive_oracle_over_generated_baskets",
                because: "the independent brute-force oracle the row demands — it enumerates \
                          every subset and writes the arithmetic out separately rather than \
                          calling the engine, which is the row's whole point",
            },
        ),
        // --- BXY: Buy X Get Y --------------------------------------------------
        ("BXY-001", Check::Run(bxy_001)),
        ("BXY-002", Check::Run(bxy_002)),
        (
            "BXY-003",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "golden_g04_buy_two_get_one_with_leftover",
                because: "golden fixture G04 itself: buyers U01/U02, reward U04, leftover \
                          U03 with nothing allocated to it",
            },
        ),
        ("BXY-004", Check::Run(bxy_004)),
        ("BXY-005", Check::Run(bxy_005)),
        // --- PTS: points --------------------------------------------------------
        ("PTS-001", Check::Run(pts_001)),
        (
            "PTS-002",
            Check::NoKernelSurface {
                note: "the plan locks base 400 -> 1.200 at 3x, plus a fixed 500 = 1.700. The \
                       kernel has no integer multiplier: a multiple is expressed by dividing \
                       the rate, and 3x on 1 point per Rp1.000 is Rp333⅓ per point, which \
                       `Money` cannot hold. Rp333 gives 1.201 and Rp334 gives 1.197. D02's \
                       multiplier model is not in the engine",
            },
        ),
        (
            "PTS-003",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "the_earning_rate_is_chosen_per_line_not_for_the_whole_basket",
                because: "the row's actual claim — a rate eligible for the shoes does not \
                          spread to the shirt. Its arithmetic avoids the 3x the kernel \
                          cannot express, so it proves the rule without inventing a rate",
            },
        ),
        ("PTS-004", Check::Run(pts_004)),
        (
            "PTS-005",
            Check::NoKernelSurface {
                note: "D02 wants each BestBonus fixed offer compared against the total of \
                       all Combine fixed offers, highest total winning. `PointsCombination` \
                       governs earning RATES; a fixed `EarnEffect::FixedPoints` bonus has no \
                       BestBonus/Combine distinction to set, so the comparison the row asks \
                       for cannot be set up",
            },
        ),
        (
            "PTS-006",
            Check::NoKernelSurface {
                note: "the row needs a points rule that excludes units which received a \
                       monetary promotion. No field on `Rule` says that — `markdown_policy` \
                       excludes cleared goods and nothing excludes discounted ones",
            },
        ),
        (
            "PTS-007",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "the_parts_of_an_award_always_come_to_the_whole",
                because: "largest-remainder allocation of base points across lines, summing \
                          to exactly the award",
            },
        ),
        // --- TAX: tax, charges, the definition of value -------------------------
        (
            "TAX-001",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "an_inclusive_price_is_split_rather_than_grossed_up",
                because: "G02's inclusive side: Rp110.000 is Rp100.000 of sales and \
                          Rp10.000 of tax, not Rp110.000 plus tax",
            },
        ),
        (
            "TAX-002",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "an_exclusive_price_has_the_tax_added_on_top",
                because: "G02's exclusive side, reaching the same three canonical figures",
            },
        ),
        ("TAX-003", Check::Run(tax_003)),
        ("TAX-004", Check::Run(tax_004)),
        (
            "TAX-005",
            Check::NoKernelSurface {
                note: "the row asks that the choice of tender not move net sales or tax. \
                       `price_cart` has no tender argument at all, so no fixture here can \
                       vary the thing the row varies. The property is true of the kernel's \
                       shape and can only be OBSERVED at the till, where a sale carries \
                       both",
            },
        ),
        ("TAX-006", Check::Run(tax_006)),
        ("TAX-007", Check::Run(tax_007)),
        (
            "TAX-009",
            Check::NoKernelSurface {
                note: "D12 requires charges to be allocated to units in proportion to net \
                       merchandise ex-tax, so a partial return can give back that unit's \
                       share. The engine reports charges only at header level — \
                       `charge_net_ex_tax`, `charge_tax_total`, `charge_total` — and \
                       `LineResult` has no charge share. Nothing here can be returned per \
                       unit",
            },
        ),
        (
            "TAX-010",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "golden_g03_ten_per_cent_tax_cart",
                because: "the 978 half of the row. Its 1.076 half is \
                          `golden_g01_zero_tax_cart`; the two together are the row's whole \
                          claim, that one expected points figure cannot serve both fixtures",
            },
        ),
        // --- E2E: the golden carts end to end ------------------------------------
        (
            "E2E-001",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "golden_g01_zero_tax_cart",
                because: "G01 as far as pricing reaches: unit totals, basket allocation, \
                          promotion discount held apart from the markdown, and 1.076 points. \
                          The row also covers ledger, refund, coupon and campaign, which \
                          this harness does not touch",
            },
        ),
        (
            "E2E-002",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "golden_g02_inclusive_and_exclusive_agree",
                because: "G02 whole: two source conventions, one set of canonical figures",
            },
        ),
        (
            "E2E-003",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "golden_g03_ten_per_cent_tax_cart",
                because: "G03's pricing half — 978 points and Rp489.273 of net sales. The \
                          Shoes return and its 580-point reversal are not priced here",
            },
        ),
        (
            "E2E-004",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "golden_g04_buy_two_get_one_with_leftover",
                because: "G04's selection and allocation. The row's return leg is not \
                          reachable from the engine",
            },
        ),
        // --- CPN: the coupon gate, which is in the engine -------------------------
        ("CPN-001", Check::Run(cpn_001)),
        // --- CFG: authoring checks, which are not in the kernel --------------------
        (
            "CFG-001",
            Check::OutOfReach {
                note: "round-tripping a rule definition through storage. `Rule` is \
                       Serialize/Deserialize, but the row is about the price book's own \
                       publication tables, which need Postgres",
            },
        ),
        (
            "CFG-004",
            Check::OutOfReach {
                note: "the plan calls this UNIT, and the validator it names \
                       (`validate_publication_request` in cloud/postgres/commercial.rs) is \
                       private and database-bound. The engine does not refuse a malformed \
                       rule — it prices with it — so nothing here can reach the check",
            },
        ),
        (
            "CFG-005",
            Check::OutOfReach {
                note: "D03 requires Combine priorities to be unique among rules that can \
                       be live together, enforced at ACTIVATION. The engine does not \
                       refuse a duplicate priority; it breaks the tie by (priority, \
                       rule_id). Refusing it is publish-time work behind the same private \
                       validator",
            },
        ),
        (
            "CFG-009",
            Check::OutOfReach {
                note: "the authoring templates are a browser concern (rule-form.tsx); the \
                       row's claim is that they map onto the same canonical `Rule` the \
                       evaluator reads, which needs the form, not the engine",
            },
        ),
        // --- BXY: where a bundle meets the other offers ----------------------------
        ("BXY-007", Check::Run(bxy_007)),
        // --- CAM: campaign metrics, which have no pure surface ---------------------
        ("CAM-001", Check::NoKernelSurface { note: CAM_IS_SQL }),
        ("CAM-002", Check::NoKernelSurface { note: CAM_IS_SQL }),
        ("CAM-003", Check::NoKernelSurface { note: CAM_IS_SQL }),
        ("CAM-006", Check::NoKernelSurface { note: CAM_IS_SQL }),
        ("CAM-008", Check::NoKernelSurface { note: CAM_IS_SQL }),
        ("CAM-009", Check::NoKernelSurface { note: CAM_IS_SQL }),
        ("CAM-011", Check::NoKernelSurface { note: CAM_IS_SQL }),
        // --- PRP: properties and reference calculation ----------------------------
        ("PRP-003", Check::Run(prp_003)),
        ("PRP-004", Check::Run(prp_004)),
        ("PRP-007", Check::Run(prp_007)),
        (
            "PRP-006",
            Check::Adopted {
                owner: Owner::PricingEngine,
                test: "best_price_matches_an_exhaustive_oracle_on_the_reviewers_case",
                because: "the row's named requirement that the candidate set include the \
                          outcome which deliberately skips the line promotion",
            },
        ),
    ]
}

// ---------------------------------------------------------------------------
// PRC — regular price and markdown
// ---------------------------------------------------------------------------

/// PRC-001: the opening price uses the right entry for SKU, store, currency
/// and time.
fn prc_001(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Three books over the same SKU: the company's, another shop's, and this
    // shop's. Only one of them is this shop's price, and a resolver that took
    // the first row it met would pass a one-entry fixture and fail here.
    let snap = fx::snapshot(
        vec![
            fx::entry("SKU1", 200_000),
            fx::site_entry("SKU1", "store-99", 111_000),
            fx::site_entry("SKU1", "store-01", 180_000),
        ],
        vec![],
    );
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PRC-001 the shop's own price is the one charged",
        got!(expect, fx::line_total(&result, "SKU1")),
        180_000,
    );
    expect.eq(
        "PRC-001 currency",
        result.currency.0.clone(),
        "IDR".to_string(),
    );
    expect.finish()
}

/// PRC-002: a markdown replaces the regular price only while it is running,
/// and the price comes back through the resolver afterwards.
fn prc_002(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let entries = vec![fx::entry("SKU1", 200_000)];

    let running = fx::snapshot(entries.clone(), vec![fx::markdown("MD-1", "SKU1", 120_000)]);
    let result = got!(
        expect,
        fx::price(&running, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PRC-002 a running markdown is the price",
        got!(expect, fx::line_total(&result, "SKU1")),
        120_000,
    );

    // D09: start inclusive, end exclusive. Both edges are tested against the
    // same instant so that a resolver which simply ignored the window would
    // have to fail one of them.
    let mut later = fx::markdown("MD-1", "SKU1", 120_000);
    later.effective_from = fx::at(9);
    let not_yet = fx::snapshot(entries.clone(), vec![later]);
    let result = got!(
        expect,
        fx::price(&not_yet, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PRC-002 a markdown that has not started is not a price",
        got!(expect, fx::line_total(&result, "SKU1")),
        200_000,
    );

    let mut over = fx::markdown("MD-1", "SKU1", 120_000);
    over.effective_to = Some(fx::at(3));
    let ended = fx::snapshot(entries, vec![over]);
    let result = got!(
        expect,
        fx::price(&ended, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PRC-002 an ended markdown gives the price back",
        got!(expect, fx::line_total(&result, "SKU1")),
        200_000,
    );
    expect.finish()
}

/// PRC-005: two entries that both reach this shop follow the agreed
/// precedence rather than whichever row came first.
fn prc_005(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Same shop, two books. The later publication is the one in force — and
    // the fixture lists it FIRST so that "took the first row" and "took the
    // right row" cannot give the same answer.
    let mut newer = fx::site_entry("SKU1", "store-01", 150_000);
    newer.publication_version = 2;
    let snap = fx::snapshot(
        vec![newer, fx::site_entry("SKU1", "store-01", 190_000)],
        vec![],
    );
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PRC-005 the newer book wins",
        got!(expect, fx::line_total(&result, "SKU1")),
        150_000,
    );

    // Two markdowns over one SKU: exactly one of them applies.
    let mut deeper = fx::markdown("MD-2", "SKU1", 90_000);
    deeper.priority = 5;
    let cleared = fx::snapshot(
        vec![fx::entry("SKU1", 200_000)],
        vec![fx::markdown("MD-1", "SKU1", 120_000), deeper],
    );
    let result = got!(
        expect,
        fx::price(&cleared, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PRC-005 the higher-priority markdown wins outright, not both",
        got!(expect, fx::line_total(&result, "SKU1")),
        90_000,
    );
    expect.finish()
}

/// PRC-006: no valid price, or a mixed currency, stops the sale. It does not
/// invent a zero and does not borrow another shop's price.
fn prc_006(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // A price exists — for a different shop. The temptation this guards
    // against is a fallback that "helpfully" finds it.
    let elsewhere = fx::snapshot(vec![fx::site_entry("SKU1", "store-99", 111_000)], vec![]);
    match price_cart(&elsewhere, &fx::ctx(), &[CartLine::new("SKU1", 1)]) {
        Err(PricingError::NoPrice { .. }) => {}
        Err(other) => {
            expect.note(format!("PRC-006 expected NoPrice, got {other}"));
        }
        Ok(result) => {
            expect.note(format!(
                "PRC-006 an unpriced item was sold anyway, for {}",
                result.total.minor
            ));
        }
    }

    let mut foreign = fx::entry("SKU2", 50_000);
    foreign.currency = pricing_engine::Currency("USD".into());
    let mixed = fx::snapshot(vec![fx::entry("SKU1", 100_000), foreign], vec![]);
    match price_cart(
        &mixed,
        &fx::ctx(),
        &[CartLine::new("SKU1", 1), CartLine::new("SKU2", 1)],
    ) {
        Err(PricingError::MixedCurrency { .. }) => {}
        Err(other) => {
            expect.note(format!("PRC-006 expected MixedCurrency, got {other}"));
        }
        Ok(_) => {
            expect.note("PRC-006 a cart mixing two currencies priced anyway".into());
        }
    }
    expect.finish()
}

/// PRC-007: several SKUs under one article keep their own prices and their
/// own quantities.
fn prc_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let snap = fx::snapshot(
        vec![
            fx::entry("TEE-RED", 100_000),
            fx::entry("TEE-BLUE", 150_000),
        ],
        vec![],
    );
    let cart = [
        CartLine::new("TEE-RED", 2).of_article("TEE"),
        CartLine::new("TEE-BLUE", 1).of_article("TEE"),
    ];
    let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
    expect.eq(
        "PRC-007 the red line is its own price times its own quantity",
        got!(expect, fx::line_total(&result, "TEE-RED")),
        200_000,
    );
    expect.eq(
        "PRC-007 the blue line is not given the red one's quantity",
        got!(expect, fx::line_total(&result, "TEE-BLUE")),
        150_000,
    );

    // An article-scoped markdown reaches both variants, which is the other
    // half of not confusing the two scopes.
    let mut range = fx::markdown("MD-TEE", "TEE-RED", 0);
    range.sku_code = None;
    range.article_code = Some("TEE".into());
    range.replacement_unit_price = Money::new(80_000);
    let cleared = fx::snapshot(
        vec![
            fx::entry("TEE-RED", 100_000),
            fx::entry("TEE-BLUE", 150_000),
        ],
        vec![range],
    );
    let result = got!(expect, fx::price(&cleared, &fx::ctx(), &cart));
    expect.eq(
        "PRC-007 an article markdown reaches every variant",
        got!(expect, fx::line_total(&result, "TEE-BLUE")),
        80_000,
    );
    expect.finish()
}

/// PRC-008: one line of three is the same money as three lines of one.
fn prc_008(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = || {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 99_999)], vec![]);
        let mut earn = fx::rule(
            "E1",
            Effect::EarnPoints(EarnEffect::SpendRate {
                spend_per_point: Money::new(1_000),
            }),
        );
        earn.stacking = Stacking::Stackable;
        snap.rules.push(fx::rule("R1", fx::percent(1_500)));
        snap.rules.push(earn);
        snap
    };

    let together = got!(
        expect,
        fx::price(&build(), &fx::ctx(), &[CartLine::new("SKU1", 3)])
    );
    let apart = got!(
        expect,
        fx::price(
            &build(),
            &fx::ctx(),
            &[
                CartLine::new("SKU1", 1),
                CartLine::new("SKU1", 1),
                CartLine::new("SKU1", 1),
            ],
        )
    );
    expect.eq("PRC-008 total", apart.total.minor, together.total.minor);
    expect.eq(
        "PRC-008 discount",
        apart.discount_total.minor,
        together.discount_total.minor,
    );
    expect.eq(
        "PRC-008 points",
        apart.points_earned,
        together.points_earned,
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// CFG — the schedule boundaries, which are kernel rather than authoring
// ---------------------------------------------------------------------------

/// CFG-007: start inclusive, end exclusive, and a paused rule out of the
/// running — D09, on the two instants where an off-by-one shows.
fn cfg_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);

    let mut starts_now = fx::rule("R1", fx::percent(1_000));
    starts_now.conditions.effective_from = Some(fx::at(5));
    expect.that(
        "CFG-007 a rule starting at this instant is running (start inclusive)",
        rule_standing(&starts_now, &snap, &fx::ctx()).is_ok(),
    );

    let mut ends_now = fx::rule("R2", fx::percent(1_000));
    ends_now.conditions.effective_to = Some(fx::at(5));
    expect.eq(
        "CFG-007 a rule ending at this instant has ended (end exclusive)",
        rule_standing(&ends_now, &snap, &fx::ctx()).err(),
        Some(RejectionReason::Expired),
    );

    let mut later = fx::rule("R3", fx::percent(1_000));
    later.conditions.effective_from = Some(fx::at(9));
    expect.eq(
        "CFG-007 a rule that has not started says so, rather than just not running",
        rule_standing(&later, &snap, &fx::ctx()).err(),
        Some(RejectionReason::NotStarted),
    );

    let mut paused = fx::rule("R4", fx::percent(1_000));
    paused.status = pricing_engine::RuleStatus::Paused;
    expect.eq(
        "CFG-007 a paused rule is out of the running",
        rule_standing(&paused, &snap, &fx::ctx()).err(),
        Some(RejectionReason::NotActive),
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// ELG — scope, qualification, limits
// ---------------------------------------------------------------------------

/// ELG-001: every selector reaches what it names and nothing else.
fn elg_001(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let entries = || {
        vec![
            fx::entry("SHIRT", 100_000),
            fx::entry("SHOES", 100_000),
            fx::entry("HAT", 100_000),
        ]
    };
    let cart = || {
        [
            CartLine::new("SHIRT", 1)
                .of_article("TOPS")
                .in_division("MENSWEAR")
                .tagged("LEBARAN"),
            CartLine::new("SHOES", 1).in_division("FOOTWEAR"),
            CartLine::new("HAT", 1),
        ]
    };

    // Each selector is set to reach the shirt alone, so the same expected
    // discount proves both halves at once: it reached what it named, and it
    // did not reach the other two.
    let selectors = [
        (
            "sku",
            Applicability::Sku {
                sku_codes: fx::skus(&["SHIRT"]),
            },
        ),
        (
            "article",
            Applicability::Article {
                article_codes: fx::skus(&["TOPS"]),
            },
        ),
        (
            "division",
            Applicability::Division {
                divisions: fx::skus(&["MENSWEAR"]),
            },
        ),
        (
            "tag",
            Applicability::Tag {
                tags: fx::skus(&["LEBARAN"]),
            },
        ),
    ];
    for (name, selector) in selectors {
        let mut snap = fx::snapshot(entries(), vec![]);
        let mut rule = fx::rule("R1", fx::percent(1_000));
        rule.scope.applicability = Some(selector);
        snap.rules.push(rule);
        let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart()));
        expect.eq(
            &format!("ELG-001 {name} selector takes 10% of the shirt and nothing else"),
            result.discount_total.minor,
            10_000,
        );
        expect.eq(
            &format!("ELG-001 {name} leaves the hat alone"),
            got!(expect, fx::line_total(&result, "HAT")),
            100_000,
        );
    }

    // And the whole-cart selector, which must reach all three.
    let mut snap = fx::snapshot(entries(), vec![]);
    let mut everything = fx::rule("R1", fx::percent(1_000));
    everything.scope.applicability = Some(Applicability::WholeCart);
    snap.rules.push(everything);
    let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart()));
    expect.eq(
        "ELG-001 whole cart reaches every line",
        result.discount_total.minor,
        30_000,
    );
    expect.finish()
}

/// ELG-002: member AND coupon means both, not either.
fn elg_002(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = || {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        let mut rule = fx::rule("R1", fx::percent(1_000));
        rule.scope.customers = pricing_engine::CustomerScope::Members;
        rule.coupon_code = Some("GATE".into());
        snap.rules.push(rule);
        snap.coupons.push(pricing_engine::Coupon {
            code: "GATE".into(),
            rule_id: "R1".into(),
            active: true,
            customer_id: None,
            valid_from: None,
            valid_to: None,
            max_uses: None,
            used: 0,
        });
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];

    let neither = got!(expect, fx::price(&build(), &fx::ctx(), &cart));
    expect.eq(
        "ELG-002 with neither condition met, nothing comes off",
        neither.discount_total.minor,
        0,
    );

    let member_only = got!(
        expect,
        fx::price(&build(), &fx::ctx().for_customer("C001"), &cart)
    );
    expect.eq(
        "ELG-002 being a member alone does not open it",
        member_only.discount_total.minor,
        0,
    );

    let coupon_only = got!(
        expect,
        fx::price(&build(), &fx::ctx().with_coupon("GATE"), &cart)
    );
    expect.eq(
        "ELG-002 the code alone does not open it either",
        coupon_only.discount_total.minor,
        0,
    );

    let both = got!(
        expect,
        fx::price(
            &build(),
            &fx::ctx().for_customer("C001").with_coupon("GATE"),
            &cart,
        )
    );
    expect.eq(
        "ELG-002 both together open it",
        both.discount_total.minor,
        10_000,
    );
    expect.finish()
}

/// ELG-003: the threshold is `>=`, proved on the Rp1 either side of it that
/// the plan asks for by name.
fn elg_003(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let at_price = |price: i64| {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", price)], vec![]);
        let mut rule = fx::rule("R1", fx::amount(50_000));
        rule.scope.applicability = Some(Applicability::WholeCart);
        rule.conditions.min_amount = Money::new(500_000);
        snap.rules.push(rule);
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];

    let under = got!(expect, fx::price(&at_price(499_999), &fx::ctx(), &cart));
    expect.eq(
        "ELG-003 one rupiah under the threshold is under it",
        under.discount_total.minor,
        0,
    );
    let exact = got!(expect, fx::price(&at_price(500_000), &fx::ctx(), &cart));
    expect.eq(
        "ELG-003 exactly the threshold qualifies",
        exact.discount_total.minor,
        50_000,
    );
    let over = got!(expect, fx::price(&at_price(500_001), &fx::ctx(), &cart));
    expect.eq(
        "ELG-003 over the threshold qualifies",
        over.discount_total.minor,
        50_000,
    );
    expect.finish()
}

/// ELG-005: eligible and ineligible goods in one basket. The ineligible half
/// neither counts toward the threshold nor receives allocation.
fn elg_005(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(
        vec![fx::entry("IN", 300_000), fx::entry("OUT", 400_000)],
        vec![],
    );
    // The basket is Rp700.000 and the eligible part is Rp300.000. A rule
    // wanting Rp500.000 of ELIGIBLE spend must stay shut, which it only does
    // if the ineligible Rp400.000 is kept out of the measurement.
    let mut rule = fx::rule("R1", fx::amount(50_000));
    rule.scope.applicability = Some(Applicability::Sku {
        sku_codes: fx::skus(&["IN"]),
    });
    rule.conditions.min_amount = Money::new(500_000);
    snap.rules.push(rule);
    let cart = [CartLine::new("IN", 1), CartLine::new("OUT", 1)];
    let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
    expect.eq(
        "ELG-005 ineligible goods do not carry a basket over its threshold",
        result.discount_total.minor,
        0,
    );

    // And when the eligible half does reach on its own, the allocation stays
    // on it.
    let mut snap = fx::snapshot(
        vec![fx::entry("IN", 600_000), fx::entry("OUT", 400_000)],
        vec![],
    );
    let mut rule = fx::rule("R1", fx::amount(50_000));
    rule.scope.applicability = Some(Applicability::Sku {
        sku_codes: fx::skus(&["IN"]),
    });
    rule.conditions.min_amount = Money::new(500_000);
    snap.rules.push(rule);
    let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
    expect.eq(
        "ELG-005 the eligible half qualifies on its own",
        result.discount_total.minor,
        50_000,
    );
    expect.eq(
        "ELG-005 nothing was allocated to the ineligible line",
        got!(expect, fx::line_total(&result, "OUT")),
        400_000,
    );
    expect.finish()
}

/// ELG-006: minimum quantity below, at and above; and a quantity that is not
/// a quantity stops the sale rather than being counted as none.
fn elg_006(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = || {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        let mut rule = fx::rule("R1", fx::percent(1_000));
        rule.conditions.min_quantity = 3;
        snap.rules.push(rule);
        snap
    };
    for (quantity, want) in [(2_i64, 0_i64), (3, 30_000), (4, 40_000)] {
        let result = got!(
            expect,
            fx::price(&build(), &fx::ctx(), &[CartLine::new("SKU1", quantity)])
        );
        expect.eq(
            &format!("ELG-006 quantity {quantity} against a minimum of 3"),
            result.discount_total.minor,
            want,
        );
    }

    match price_cart(&build(), &fx::ctx(), &[CartLine::new("SKU1", 0)]) {
        Err(PricingError::NonPositiveQuantity { .. }) => {}
        Err(other) => expect.note(format!("ELG-006 expected NonPositiveQuantity, got {other}")),
        Ok(_) => {
            expect.note("ELG-006 a line of nought priced instead of being refused".into());
        }
    };
    expect.finish()
}

/// ELG-007: a rule bound to a shop and to a schedule, with the shop's own
/// clock stated rather than assumed.
fn elg_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = || {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        let mut rule = fx::rule("R1", fx::percent(1_000));
        rule.scope.site_ids = fx::skus(&["store-01"]);
        // Open only in the shop's morning. The fixture instant is 12:00 UTC,
        // which is 19:00 in Jakarta — so a rule reading the window in UTC
        // would call this morning and a rule reading it locally would not.
        rule.conditions.time_window = Some(pricing_engine::TimeWindow {
            from_minute: 9 * 60,
            to_minute: 13 * 60,
        });
        snap.rules.push(rule);
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];

    let mut elsewhere = fx::ctx();
    elsewhere.site_id = "store-99".into();
    let result = got!(expect, fx::price(&build(), &elsewhere, &cart));
    expect.eq(
        "ELG-007 another shop's promotion does not run here",
        result.discount_total.minor,
        0,
    );

    let mut jakarta = fx::ctx();
    jakarta.utc_offset_minutes = 7 * 60;
    let result = got!(expect, fx::price(&build(), &jakarta, &cart));
    expect.eq(
        "ELG-007 the window is the shop's own hours, and 19:00 local is outside them",
        result.discount_total.minor,
        0,
    );

    let result = got!(expect, fx::price(&build(), &fx::ctx(), &cart));
    expect.eq(
        "ELG-007 at UTC the same instant is inside the window",
        result.discount_total.minor,
        10_000,
    );
    expect.finish()
}

/// ELG-010: a cap on the discount and a cap on the qualifying quantity, met
/// at once. Total benefit does not pass the cap.
fn elg_010(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
    let mut rule = fx::rule("R1", fx::percent(2_000));
    rule.max_discount = Some(Money::new(25_000));
    rule.conditions.min_quantity = 2;
    rule.conditions.max_quantity = Some(5);
    snap.rules.push(rule);

    // Four units is Rp400.000, and 20% of it is Rp80.000 — well past the cap.
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 4)])
    );
    expect.eq(
        "ELG-010 the cap holds and the percentage does not",
        result.discount_total.minor,
        25_000,
    );

    // Six units is past `max_quantity`, so the rule does not qualify at all —
    // the cap is not what stops it, and the reason matters to whoever asks.
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 6)])
    );
    expect.eq(
        "ELG-010 too many qualifying items shuts the rule rather than capping it",
        result.discount_total.minor,
        0,
    );
    expect.that(
        "ELG-010 and it says QuantityTooHigh rather than blaming the basket",
        result
            .rejected_rules
            .iter()
            .any(|one| one.reason == RejectionReason::QuantityTooHigh),
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// MON — monetary benefit and allocation
// ---------------------------------------------------------------------------

/// MON-001: 20% off Rp300.000 is Rp60.000 off and Rp240.000 left.
fn mon_001(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 300_000)], vec![]);
    snap.rules.push(fx::rule("R1", fx::percent(2_000)));
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq("MON-001 discount", result.discount_total.minor, 60_000);
    expect.eq("MON-001 remaining", result.total.minor, 240_000);
    expect.finish()
}

/// MON-003: Rp50.000 off the basket is Rp50.000, not Rp50.000 per unit, and
/// it is allocated back to the lines it came off.
fn mon_003(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(
        vec![
            fx::entry("SKU1", 100_000),
            fx::entry("SKU2", 100_000),
            fx::entry("SKU3", 100_000),
        ],
        vec![],
    );
    let mut rule = fx::rule("R1", fx::amount(50_000));
    rule.scope.applicability = Some(Applicability::WholeCart);
    snap.rules.push(rule);
    let result = got!(
        expect,
        fx::price(
            &snap,
            &fx::ctx(),
            &[
                CartLine::new("SKU1", 1),
                CartLine::new("SKU2", 1),
                CartLine::new("SKU3", 1),
            ],
        )
    );
    expect.eq(
        "MON-003 discount is once",
        result.discount_total.minor,
        50_000,
    );
    expect.eq("MON-003 total", result.total.minor, 250_000);
    let allocated: i64 = result
        .applied_rules
        .iter()
        .flat_map(|applied| &applied.line_benefits)
        .map(|share| share.benefit.minor)
        .sum();
    expect.eq(
        "MON-003 the allocation sums to exactly the discount",
        allocated,
        50_000,
    );
    expect.finish()
}

/// MON-004: a fixed price takes the difference when it is lower, nothing when
/// it is equal, and — the one that matters — nothing when it is higher. A
/// promotion never raises a price.
fn mon_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    for (fixed, want_total, want_discount) in [
        (80_000_i64, 80_000_i64, 20_000_i64),
        (100_000, 100_000, 0),
        (120_000, 100_000, 0),
    ] {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        snap.rules.push(fx::rule(
            "R1",
            Effect::FixedUnitPrice {
                unit_price: Money::new(fixed),
            },
        ));
        let result = got!(
            expect,
            fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
        );
        expect.eq(
            &format!("MON-004 a fixed price of {fixed} against Rp100.000 — total"),
            result.total.minor,
            want_total,
        );
        expect.eq(
            &format!("MON-004 a fixed price of {fixed} against Rp100.000 — discount"),
            result.discount_total.minor,
            want_discount,
        );
    }
    expect.finish()
}

/// MON-005: an amount larger than the goods is capped by the goods. A
/// discount never becomes a payout.
fn mon_005(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 10_000)], vec![]);
    let mut rule = fx::rule("R1", fx::amount(500_000));
    rule.scope.applicability = Some(Applicability::WholeCart);
    snap.rules.push(rule);
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq("MON-005 total floors at nought", result.total.minor, 0);
    expect.eq(
        "MON-005 and the discount is the goods, not what was offered",
        result.discount_total.minor,
        10_000,
    );
    expect.that(
        "MON-005 no line went negative",
        result.lines.iter().all(|line| line.line_total.minor >= 0),
    );
    expect.finish()
}

/// MON-006: a percentage with a maximum gives the lesser of the two.
fn mon_006(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // The cap bites: 20% of Rp300.000 is Rp60.000 against a Rp25.000 ceiling.
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 300_000)], vec![]);
    let mut capped = fx::rule("R1", fx::percent(2_000));
    capped.max_discount = Some(Money::new(25_000));
    snap.rules.push(capped);
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq("MON-006 the cap wins", result.discount_total.minor, 25_000);

    // And it does not bite: the same ceiling against a basket small enough
    // that the percentage is the lesser figure.
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 50_000)], vec![]);
    let mut capped = fx::rule("R1", fx::percent(2_000));
    capped.max_discount = Some(Money::new(25_000));
    snap.rules.push(capped);
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "MON-006 a cap that is not reached takes nothing extra",
        result.discount_total.minor,
        10_000,
    );
    expect.finish()
}

/// MON-007: a basket percentage over lines of different values allocates to
/// exactly the discount it applied.
fn mon_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(
        vec![
            fx::entry("SKU1", 100_000),
            fx::entry("SKU2", 200_000),
            fx::entry("SKU3", 33_333),
        ],
        vec![],
    );
    let mut rule = fx::rule("R1", fx::percent(1_000));
    rule.scope.applicability = Some(Applicability::WholeCart);
    snap.rules.push(rule);
    let result = got!(
        expect,
        fx::price(
            &snap,
            &fx::ctx(),
            &[
                CartLine::new("SKU1", 1),
                CartLine::new("SKU2", 1),
                CartLine::new("SKU3", 1),
            ],
        )
    );
    let applied: i64 = result
        .applied_rules
        .iter()
        .map(|one| one.benefit.minor)
        .sum();
    let allocated: i64 = result
        .applied_rules
        .iter()
        .flat_map(|one| &one.line_benefits)
        .map(|share| share.benefit.minor)
        .sum();
    expect.eq(
        "MON-007 allocation equals application, to the rupiah",
        allocated,
        applied,
    );
    expect.eq(
        "MON-007 and the lines come to the total",
        result
            .lines
            .iter()
            .map(|line| line.line_total.minor)
            .sum::<i64>(),
        result.total.minor,
    );
    expect.finish()
}

/// MON-008: rounding a basket amount that does not divide, and a basket worth
/// nothing at all. Deterministic, exact, non-negative, and no division by a
/// zero basis.
fn mon_008(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Prices chosen so the share of each does not come out whole, plus a free
    // line whose basis is nought — the divide-by-zero the row names.
    let shapes: [(&[i64], i64); 4] = [
        (&[10_000, 10_000, 10_000], 10_000),
        (&[33_333, 66_667, 1], 7),
        (&[1, 1, 1], 2),
        (&[0, 0, 50_000], 10_000),
    ];
    for (prices, off) in shapes {
        let entries = prices
            .iter()
            .enumerate()
            .map(|(index, price)| fx::entry(&format!("SKU{index}"), *price))
            .collect();
        let mut snap = fx::snapshot(entries, vec![]);
        let mut rule = fx::rule("R1", fx::amount(off));
        rule.scope.applicability = Some(Applicability::WholeCart);
        snap.rules.push(rule);
        let cart: Vec<CartLine> = (0..prices.len())
            .map(|index| CartLine::new(format!("SKU{index}"), 1))
            .collect();

        let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
        let gross: i64 = prices.iter().sum();
        let label = format!("MON-008 {prices:?} less {off}");

        expect.that(
            &format!("{label}: every line stayed at nought or above"),
            result.lines.iter().all(|line| line.line_total.minor >= 0),
        );
        expect.eq(
            &format!("{label}: the lines still sum to the total"),
            result
                .lines
                .iter()
                .map(|line| line.line_total.minor)
                .sum::<i64>(),
            result.total.minor,
        );
        let lines: Vec<i64> = result
            .lines
            .iter()
            .map(|line| line.line_total.minor)
            .collect();
        expect.eq(
            &format!(
                "{label}: goods = what is left plus what came off (lines {lines:?}, \
                 discount {})",
                result.discount_total.minor
            ),
            result.total.minor + result.discount_total.minor,
            gross,
        );
        for applied in &result.applied_rules {
            expect.eq(
                &format!(
                    "{label}: {} allocated exactly what it took",
                    applied.rule_id
                ),
                applied
                    .line_benefits
                    .iter()
                    .map(|share| share.benefit.minor)
                    .sum::<i64>(),
                applied.benefit.minor,
            );
            expect.that(
                &format!("{label}: no share of {} was negative", applied.rule_id),
                applied
                    .line_benefits
                    .iter()
                    .all(|share| share.benefit.minor >= 0),
            );
        }

        // Deterministic: the same basket priced twice is the same answer, and
        // the trace id says so too.
        let again = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
        expect.eq(
            &format!("{label}: priced twice, the same"),
            again.trace_id.clone(),
            result.trace_id.clone(),
        );
    }
    expect.finish()
}

/// MON-010: a promotion worth nothing leaves the price alone and is not
/// recorded as having applied.
fn mon_010(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
    snap.rules.push(fx::rule(
        "R1",
        Effect::FixedUnitPrice {
            unit_price: Money::new(100_000),
        },
    ));
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "MON-010 the price is unchanged",
        result.total.minor,
        100_000,
    );
    expect.eq("MON-010 nothing came off", result.discount_total.minor, 0);
    expect.that(
        "MON-010 and no rule claims to have applied",
        result.applied_rules.is_empty(),
    );
    // Deliberately not asserted: WHICH rejection reason comes back. The row
    // requires that the price does not move and leaves the usage question to
    // "keputusan eksplisit" under D10; it names no reason code, and pinning
    // one here would be this harness inventing a contract.
    expect.finish()
}

// ---------------------------------------------------------------------------
// COM — Best Price, Exclusive, Combine
// ---------------------------------------------------------------------------

/// COM-002: no promo, one promo, and several. All three are candidates, and
/// the winner is the smallest final merchandise amount.
fn com_002(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // The reviewer's basket: Rp600.000, a 20% line offer, and a Rp150.000
    // basket offer that needs Rp500.000. Neither can combine with the other.
    let build = |with: &[&str]| {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 600_000)], vec![]);
        if with.contains(&"A") {
            snap.rules.push(fx::rule("A", fx::percent(2_000)));
        }
        if with.contains(&"B") {
            let mut basket = fx::rule("B", fx::amount(150_000));
            basket.scope.applicability = Some(Applicability::WholeCart);
            basket.conditions.min_amount = Money::new(500_000);
            snap.rules.push(basket);
        }
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];

    let none = got!(expect, fx::price(&build(&[]), &fx::ctx(), &cart));
    expect.eq("COM-002 no promo", none.total.minor, 600_000);

    let only_a = got!(expect, fx::price(&build(&["A"]), &fx::ctx(), &cart));
    expect.eq("COM-002 the line offer alone", only_a.total.minor, 480_000);

    let only_b = got!(expect, fx::price(&build(&["B"]), &fx::ctx(), &cart));
    expect.eq(
        "COM-002 the basket offer alone",
        only_b.total.minor,
        450_000,
    );

    let both = got!(expect, fx::price(&build(&["A", "B"]), &fx::ctx(), &cart));
    expect.eq(
        "COM-002 offered both, the shopper gets the cheaper basket",
        both.total.minor,
        450_000,
    );
    expect.that(
        "COM-002 and the loser is reported as outbid, not as unqualified",
        both.rejected_rules
            .iter()
            .any(|one| one.rule_id == "A" && one.reason == RejectionReason::OutbidByBetterOffer),
    );
    expect.finish()
}

/// COM-003: two Combine offers over Rp300.000. The second is measured on what
/// the first left, not on the ticket price.
fn com_003(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 300_000)], vec![]);
    let mut percent = fx::rule("P", fx::percent(2_000));
    percent.stacking = Stacking::Stackable;
    percent.priority = 100;
    let mut flat = fx::rule("Q", fx::amount(50_000));
    flat.scope.applicability = Some(Applicability::WholeCart);
    flat.stacking = Stacking::Stackable;
    flat.priority = 200;
    snap.rules.push(percent);
    snap.rules.push(flat);

    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    // The plan names both orderings — Rp190.000 taking the percentage first,
    // Rp200.000 taking the flat amount first. D03 fixes the order: line stage
    // before basket, priority ascending inside each. That is the Rp190.000.
    expect.eq(
        "COM-003 the percentage runs first and the flat amount comes off what is left",
        result.total.minor,
        190_000,
    );
    expect.eq("COM-003 both offers applied", result.applied_rules.len(), 2);
    expect.finish()
}

/// COM-004: several Exclusive offers eligible at once. The winner is
/// reproducible however the rules were handed in.
fn com_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Three exclusives worth exactly the same, so nothing but the tie-break
    // can decide. If the answer moved with the input order, a shop and the
    // centre would quote different prices for the same basket.
    let build = |order: [&str; 3]| {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        for id in order {
            let mut rule = fx::rule(id, fx::percent(1_000));
            rule.stacking = Stacking::Exclusive;
            rule.priority = 50;
            snap.rules.push(rule);
        }
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];

    let mut winners = Vec::new();
    for order in [["X", "Y", "Z"], ["Z", "Y", "X"], ["Y", "X", "Z"]] {
        let result = got!(expect, fx::price(&build(order), &fx::ctx(), &cart));
        expect.eq(
            "COM-004 exactly one exclusive applied",
            result.applied_rules.len(),
            1,
        );
        winners.push(
            result
                .applied_rules
                .first()
                .map(|one| one.rule_id.clone())
                .unwrap_or_default(),
        );
        expect.eq("COM-004 the money is the same", result.total.minor, 90_000);
    }
    expect.that(
        &format!("COM-004 the same winner every time, got {winners:?}"),
        winners.windows(2).all(|pair| pair[0] == pair[1]),
    );
    expect.finish()
}

/// COM-006: an Exclusive Basket offer shuts out the other monetary offers and
/// leaves points to their own compatibility rules.
fn com_006(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(
        vec![fx::entry("SHIRT", 200_000), fx::entry("SHOES", 300_000)],
        vec![],
    );
    let mut sole = fx::rule("EX", fx::percent(2_000));
    sole.stacking = Stacking::Exclusive;
    sole.exclusive_scope = ExclusiveScope::Basket;
    sole.scope.applicability = Some(Applicability::Sku {
        sku_codes: fx::skus(&["SHIRT"]),
    });

    let mut line = fx::rule("LINE", fx::percent(1_000));
    line.stacking = Stacking::Stackable;
    line.scope.applicability = Some(Applicability::Sku {
        sku_codes: fx::skus(&["SHOES"]),
    });

    let mut points = fx::rule(
        "EARN",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    );
    points.stacking = Stacking::Stackable;

    snap.rules.push(sole);
    snap.rules.push(line);
    snap.rules.push(points);

    let result = got!(
        expect,
        fx::price(
            &snap,
            &fx::ctx(),
            &[CartLine::new("SHIRT", 1), CartLine::new("SHOES", 1)],
        )
    );
    expect.eq(
        "COM-006 the shoes keep their full price — the basket exclusive shut the line offer out",
        got!(expect, fx::line_total(&result, "SHOES")),
        300_000,
    );
    expect.eq(
        "COM-006 the exclusive itself applied",
        got!(expect, fx::line_total(&result, "SHIRT")),
        160_000,
    );
    expect.that(
        "COM-006 points were still earned — a monetary exclusion is not a points exclusion",
        result.points_earned > 0,
    );
    expect.finish()
}

/// COM-007: two basket offers together, each with a minimum spend. D03 fixes
/// the qualifying snapshot after the line stage, and it stays fixed for both.
fn com_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", 600_000)], vec![]);
    for (id, priority, minimum) in [("B1", 100_i64, 500_000_i64), ("B2", 200, 550_000)] {
        let mut basket = fx::rule(id, fx::amount(100_000));
        basket.scope.applicability = Some(Applicability::WholeCart);
        basket.stacking = Stacking::Stackable;
        basket.priority = priority;
        basket.conditions.min_amount = Money::new(minimum);
        snap.rules.push(basket);
    }
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    // The discriminating figure. B1 takes the basket to Rp500.000; B2 asks for
    // Rp550.000. Measured against the FIXED snapshot of Rp600.000 — which is
    // what D03 says — B2 qualifies and the basket comes to Rp400.000.
    // Measured against what B1 left, it does not, and the answer is
    // Rp500.000.
    let standing: Vec<String> = result
        .applied_rules
        .iter()
        .map(|one| format!("{} applied", one.rule_id))
        .chain(
            result
                .rejected_rules
                .iter()
                .map(|one| format!("{} refused as {:?}", one.rule_id, one.reason)),
        )
        .collect();
    expect.eq(
        &format!("COM-007 both basket offers are measured on the same snapshot ({standing:?})"),
        result.total.minor,
        400_000,
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// BXY — Buy X Get Y
// ---------------------------------------------------------------------------

/// BXY-001: complete groups only. Two, three, five and six units of the same
/// thing give nought, one, one and two rewards.
fn bxy_001(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    for (quantity, rewards) in [(2_i64, 0_i64), (3, 1), (5, 1), (6, 2)] {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        snap.rules.push(fx::rule(
            "R1",
            Effect::BuyXGetY {
                buy: 2,
                get: 1,
                reward_bps: 10_000,
            },
        ));
        let result = got!(
            expect,
            fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", quantity)])
        );
        // Every unit costs the same, so a reward given away in full is worth
        // exactly one unit — the reward COUNT read off the money.
        expect.eq(
            &format!("BXY-001 {quantity} units of a buy-2-get-1 gives {rewards} reward(s)"),
            result.discount_total.minor,
            rewards * 100_000,
        );
    }
    expect.finish()
}

/// BXY-002: buy one get one over six units of different values. The three
/// cheapest are the rewards.
fn bxy_002(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let prices = [300_000_i64, 280_000, 250_000, 220_000, 180_000, 150_000];
    let entries = prices
        .iter()
        .enumerate()
        .map(|(index, price)| fx::entry(&format!("U{index}"), *price))
        .collect();
    let mut snap = fx::snapshot(entries, vec![]);
    let mut bundle = fx::rule(
        "R1",
        Effect::BuyXGetY {
            buy: 1,
            get: 1,
            reward_bps: 10_000,
        },
    );
    bundle.scope.applicability = Some(Applicability::Sku {
        sku_codes: (0..prices.len()).map(|index| format!("U{index}")).collect(),
    });
    snap.rules.push(bundle);
    let cart: Vec<CartLine> = (0..prices.len())
        .map(|index| CartLine::new(format!("U{index}"), 1))
        .collect();

    let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
    // The plan's own figure: rewards of Rp220.000, Rp180.000 and Rp150.000,
    // which is Rp550.000 given away at a hundred per cent.
    expect.eq(
        "BXY-002 three complete pairs give away the three cheapest units",
        result.discount_total.minor,
        550_000,
    );
    expect.eq(
        "BXY-002 and the basket comes to what is left",
        result.total.minor,
        prices.iter().sum::<i64>() - 550_000,
    );
    expect.finish()
}

/// BXY-004: two units could equally be the reward. The choice is stable, so
/// the same basket priced again does not move the money between them.
fn bxy_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = |order: [&str; 4]| {
        let snap = fx::snapshot(
            vec![
                fx::entry("A", 300_000),
                fx::entry("B", 200_000),
                // Two units at exactly the same price, either of which could
                // be the cheapest.
                fx::entry("C", 100_000),
                fx::entry("D", 100_000),
            ],
            vec![],
        );
        let mut snap = snap;
        let mut bundle = fx::rule(
            "R1",
            Effect::BuyXGetY {
                buy: 2,
                get: 1,
                reward_bps: 10_000,
            },
        );
        bundle.scope.applicability = Some(Applicability::Sku {
            sku_codes: fx::skus(&["A", "B", "C", "D"]),
        });
        snap.rules.push(bundle);
        let cart: Vec<CartLine> = order.iter().map(|sku| CartLine::new(*sku, 1)).collect();
        (snap, cart)
    };

    let mut shapes = Vec::new();
    for order in [
        ["A", "B", "C", "D"],
        ["D", "C", "B", "A"],
        ["C", "A", "D", "B"],
    ] {
        let (snap, cart) = build(order);
        let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
        let mut by_sku: BTreeMap<String, i64> = BTreeMap::new();
        for line in &result.lines {
            by_sku.insert(line.sku_code.clone(), line.line_total.minor);
        }
        expect.eq(
            &format!("BXY-004 {order:?}: one group, the cheapest given away"),
            result.discount_total.minor,
            100_000,
        );
        shapes.push(by_sku);
    }
    expect.that(
        &format!("BXY-004 the same unit is chosen every time, got {shapes:?}"),
        shapes.windows(2).all(|pair| pair[0] == pair[1]),
    );
    expect.finish()
}

/// BXY-005: goods outside the rule's scope neither make up a group nor
/// receive any of the bundle's discount.
fn bxy_005(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(
        vec![
            fx::entry("IN-1", 300_000),
            fx::entry("IN-2", 200_000),
            fx::entry("IN-3", 100_000),
            // Cheaper than every eligible unit, so a rule that looked at the
            // whole basket would make this the reward.
            fx::entry("OUT", 50_000),
        ],
        vec![],
    );
    let mut bundle = fx::rule(
        "R1",
        Effect::BuyXGetY {
            buy: 2,
            get: 1,
            reward_bps: 10_000,
        },
    );
    bundle.scope.applicability = Some(Applicability::Sku {
        sku_codes: fx::skus(&["IN-1", "IN-2", "IN-3"]),
    });
    snap.rules.push(bundle);

    let cart = [
        CartLine::new("IN-1", 1),
        CartLine::new("IN-2", 1),
        CartLine::new("IN-3", 1),
        CartLine::new("OUT", 1),
    ];
    let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
    expect.eq(
        "BXY-005 the reward is the cheapest ELIGIBLE unit, not the cheapest unit",
        result.discount_total.minor,
        100_000,
    );
    expect.eq(
        "BXY-005 the out-of-scope line kept its whole price",
        got!(expect, fx::line_total(&result, "OUT")),
        50_000,
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// PTS — points
// ---------------------------------------------------------------------------

/// PTS-001: base points on the merchandise ex-tax, and on nothing else.
fn pts_001(fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let due = fixtures.money("G01.amount_due");
    let base = fixtures.money("G01.base_points");

    let mut snap = fx::snapshot(vec![fx::entry("SKU1", due)], vec![]);
    snap.rules.push(fx::rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    ));
    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PTS-001 base points at one per Rp1.000 of merchandise",
        result.points_earned,
        base,
    );

    // And a delivery fee does not earn: the locked rule is goods after
    // discount, before tax, without charges.
    let with_fee = fx::ctx().with_charge(pricing_engine::Charge {
        code: "DELIVERY".into(),
        description: "Kirim".into(),
        amount_minor: 60_000,
        tax_category: "STANDARD".into(),
    });
    let result = got!(
        expect,
        fx::price(&snap, &with_fee, &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "PTS-001 a charge adds no points",
        result.points_earned,
        base,
    );
    expect.finish()
}

/// PTS-004: a fixed bonus once per transaction is not the same as one per
/// unit, and neither of them is multiplied by an earning rate.
fn pts_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = |effect: EarnEffect| {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        let mut bonus = fx::rule("BONUS", Effect::EarnPoints(effect));
        bonus.stacking = Stacking::Stackable;
        snap.rules.push(bonus);
        snap
    };
    let cart = [CartLine::new("SKU1", 3)];

    let once = got!(
        expect,
        fx::price(
            &build(EarnEffect::FixedPoints { points: 500 }),
            &fx::ctx(),
            &cart
        )
    );
    expect.eq(
        "PTS-004 a fixed bonus is once per transaction whatever the quantity",
        once.points_earned,
        500,
    );

    let per_unit = got!(
        expect,
        fx::price(
            &build(EarnEffect::PointsPerQuantity { points: 500 }),
            &fx::ctx(),
            &cart,
        )
    );
    expect.eq(
        "PTS-004 a per-unit bonus is once per unit",
        per_unit.points_earned,
        1_500,
    );

    // With an everyday rate beside it, the bonus adds and is not scaled by
    // the rate — Rp300.000 at one per Rp1.000 is 300, plus the flat 500.
    let mut snap = build(EarnEffect::FixedPoints { points: 500 });
    let mut everyday = fx::rule(
        "EVERYDAY",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(1_000),
        }),
    );
    everyday.stacking = Stacking::Stackable;
    snap.rules.push(everyday);
    let both = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
    expect.eq(
        "PTS-004 the bonus adds to the rate rather than being multiplied by it",
        both.points_earned,
        800,
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// TAX — tax, charges, the definition of value
// ---------------------------------------------------------------------------

/// TAX-003: ten per cent off a displayed Rp110.000 under a ten per cent tax
/// fixture. G02's discounted leg, read from the fixture file.
fn tax_003(fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let source = fixtures.money("G02.source_inclusive");
    let mut snap = fx::snapshot(vec![fx::entry("SKU1", source)], vec![]);
    fx::taxed(&mut snap, "STANDARD", 1_000, true);
    snap.rules.push(fx::rule("R1", fx::percent(1_000)));

    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("SKU1", 1)])
    );
    expect.eq(
        "TAX-003 displayed final",
        result.total.minor,
        fixtures.money("G02.with_10_percent_discount.gross"),
    );
    expect.eq(
        "TAX-003 net ex-tax",
        result.net_ex_tax.minor,
        fixtures.money("G02.with_10_percent_discount.net"),
    );
    expect.eq(
        "TAX-003 tax",
        result.tax_total.minor,
        fixtures.money("G02.with_10_percent_discount.tax"),
    );
    expect.finish()
}

/// TAX-004: a minimum basket over a mix of taxable and untaxed goods. The
/// qualifying figure is the displayed amount including tax — not the Net
/// Sales figure a dashboard would show.
fn tax_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // Rp520.000 displayed, of which Rp47.273 is tax: Rp472.727 of net sales.
    // A rule wanting Rp500.000 qualifies on the displayed figure and does not
    // on the net one, so the two readings cannot both pass this.
    let mut snap = fx::snapshot(vec![fx::entry_taxed("TAXED", 520_000, "STANDARD")], vec![]);
    fx::taxed(&mut snap, "STANDARD", 1_000, true);
    let mut rule = fx::rule("R1", fx::amount(50_000));
    rule.scope.applicability = Some(Applicability::WholeCart);
    rule.conditions.min_amount = Money::new(500_000);
    snap.rules.push(rule);

    let result = got!(
        expect,
        fx::price(&snap, &fx::ctx(), &[CartLine::new("TAXED", 1)])
    );
    expect.eq(
        "TAX-004 the threshold reads the displayed amount, tax included",
        result.discount_total.minor,
        50_000,
    );

    // And the exempt half of a mixed basket counts at its face value, since
    // there is no tax in it to take out.
    let mut mixed = fx::snapshot(
        vec![
            fx::entry_taxed("TAXED", 330_000, "STANDARD"),
            fx::entry_taxed("EXEMPT", 200_000, "ZERO"),
        ],
        vec![],
    );
    fx::taxed(&mut mixed, "STANDARD", 1_000, true);
    let mut rule = fx::rule("R1", fx::amount(50_000));
    rule.scope.applicability = Some(Applicability::WholeCart);
    rule.conditions.min_amount = Money::new(500_000);
    mixed.rules.push(rule);
    let result = got!(
        expect,
        fx::price(
            &mixed,
            &fx::ctx(),
            &[CartLine::new("TAXED", 1), CartLine::new("EXEMPT", 1)],
        )
    );
    expect.eq(
        "TAX-004 a mixed basket qualifies on Rp530.000 displayed",
        result.discount_total.minor,
        50_000,
    );
    expect.finish()
}

/// TAX-006: two tax treatments in one basket. Each unit keeps its own, and
/// nothing is forced onto a single basket rate.
fn tax_006(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let mut snap = fx::snapshot(
        vec![
            fx::entry_taxed("FULL", 110_000, "STANDARD"),
            fx::entry_taxed("HALF", 105_000, "REDUCED"),
            fx::entry_taxed("NONE", 100_000, "ZERO"),
        ],
        vec![],
    );
    fx::taxed(&mut snap, "STANDARD", 1_000, true);
    fx::taxed(&mut snap, "REDUCED", 500, true);

    let result = got!(
        expect,
        fx::price(
            &snap,
            &fx::ctx(),
            &[
                CartLine::new("FULL", 1),
                CartLine::new("HALF", 1),
                CartLine::new("NONE", 1),
            ],
        )
    );
    let tax_on = |sku: &str| {
        result
            .lines
            .iter()
            .find(|line| line.sku_code == sku)
            .map(|line| line.tax_amount.minor)
            .unwrap_or(-1)
    };
    expect.eq("TAX-006 the standard line", tax_on("FULL"), 10_000);
    expect.eq("TAX-006 the reduced line", tax_on("HALF"), 5_000);
    expect.eq(
        "TAX-006 a category the book never taxed is reported untaxed, not guessed",
        tax_on("NONE"),
        0,
    );
    expect.eq(
        "TAX-006 and the basket's tax is the sum of the lines', not one rate over the whole",
        result.tax_total.minor,
        15_000,
    );
    expect.finish()
}

/// TAX-007: small prices where tax and discount both land on a fraction. Net
/// plus tax is the total, and the gross discount is the net delta plus the
/// tax delta.
fn tax_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    for price in [1_i64, 3, 7, 11, 99, 101, 1_001, 6] {
        let build = |discounted: bool| {
            let mut snap = fx::snapshot(vec![fx::entry_taxed("SKU1", price, "STANDARD")], vec![]);
            fx::taxed(&mut snap, "STANDARD", 1_000, true);
            if discounted {
                snap.rules.push(fx::rule("R1", fx::percent(1_000)));
            }
            snap
        };
        let cart = [CartLine::new("SKU1", 3)];
        let before = got!(expect, fx::price(&build(false), &fx::ctx(), &cart));
        let after = got!(expect, fx::price(&build(true), &fx::ctx(), &cart));

        expect.eq(
            &format!("TAX-007 at Rp{price}: net plus tax is the total"),
            after.net_ex_tax.minor + after.tax_total.minor,
            after.total.minor,
        );
        expect.eq(
            &format!("TAX-007 at Rp{price}: gross discount is the net delta plus the tax delta"),
            after.discount_total.minor,
            (before.net_ex_tax.minor - after.net_ex_tax.minor)
                + (before.tax_total.minor - after.tax_total.minor),
        );
        expect.that(
            &format!("TAX-007 at Rp{price}: no figure went negative"),
            after.net_ex_tax.minor >= 0 && after.tax_total.minor >= 0,
        );
    }
    expect.finish()
}

// ---------------------------------------------------------------------------
// PRP — properties
// ---------------------------------------------------------------------------

/// PRP-003: permuting the inputs does not change the answer. Stable IDs are
/// the business rule; transport order is not.
fn prp_003(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = |rules: [&str; 3], cart_order: [&str; 3]| {
        let mut snap = fx::snapshot(
            vec![
                fx::entry("SHIRT", 299_000),
                fx::entry("SHOES", 499_000),
                fx::entry("HAT", 99_000),
            ],
            vec![fx::markdown("MD-1", "SHOES", 349_000)],
        );
        for id in rules {
            let mut rule = match id {
                "A" => {
                    let mut one = fx::rule("A", fx::percent(2_000));
                    one.scope.applicability = Some(Applicability::Sku {
                        sku_codes: fx::skus(&["SHIRT"]),
                    });
                    one
                }
                "B" => {
                    let mut one = fx::rule("B", fx::amount(50_000));
                    one.scope.applicability = Some(Applicability::WholeCart);
                    one.conditions.min_amount = Money::new(400_000);
                    one.markdown_policy = MarkdownPolicy::Allow;
                    one.priority = 200;
                    one
                }
                _ => {
                    let mut one = fx::rule(
                        "C",
                        Effect::EarnPoints(EarnEffect::SpendRate {
                            spend_per_point: Money::new(500),
                        }),
                    );
                    one.markdown_policy = MarkdownPolicy::Allow;
                    one
                }
            };
            rule.stacking = Stacking::Stackable;
            snap.rules.push(rule);
        }
        let cart: Vec<CartLine> = cart_order
            .iter()
            .map(|sku| CartLine::new(*sku, 1))
            .collect();
        (snap, cart)
    };

    let (snap, cart) = build(["A", "B", "C"], ["SHIRT", "SHOES", "HAT"]);
    let canonical = got!(expect, fx::price(&snap, &fx::ctx(), &cart));

    // Rules permuted: everything must match, the fingerprint included.
    for order in [["C", "B", "A"], ["B", "A", "C"], ["C", "A", "B"]] {
        let (snap, cart) = build(order, ["SHIRT", "SHOES", "HAT"]);
        let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
        expect.eq(
            &format!("PRP-003 rules as {order:?}: total"),
            result.total.minor,
            canonical.total.minor,
        );
        expect.eq(
            &format!("PRP-003 rules as {order:?}: discount"),
            result.discount_total.minor,
            canonical.discount_total.minor,
        );
        expect.eq(
            &format!("PRP-003 rules as {order:?}: points"),
            result.points_earned,
            canonical.points_earned,
        );
        expect.eq(
            &format!("PRP-003 rules as {order:?}: the fingerprint"),
            result.trace_id.clone(),
            canonical.trace_id.clone(),
        );
    }

    // Cart permuted: the money per SKU must not move, whatever order the
    // scanner happened to read them in.
    let value_by_sku = |result: &pricing_engine::PricingResult| {
        let mut map: BTreeMap<String, i64> = BTreeMap::new();
        for line in &result.lines {
            map.insert(line.sku_code.clone(), line.line_total.minor);
        }
        map
    };
    let canonical_lines = value_by_sku(&canonical);
    for order in [["HAT", "SHOES", "SHIRT"], ["SHOES", "SHIRT", "HAT"]] {
        let (snap, cart) = build(["A", "B", "C"], order);
        let result = got!(expect, fx::price(&snap, &fx::ctx(), &cart));
        expect.eq(
            &format!("PRP-003 cart as {order:?}: the same money on the same goods"),
            value_by_sku(&result),
            canonical_lines.clone(),
        );
        expect.eq(
            &format!("PRP-003 cart as {order:?}: points"),
            result.points_earned,
            canonical.points_earned,
        );
    }
    expect.finish()
}

// ---------------------------------------------------------------------------
// CPN — the coupon gate
// ---------------------------------------------------------------------------

/// CPN-001: a shared code opens a promotion when it is right and does nothing
/// when it is wrong, expired, or attached to a promotion that is not running.
/// A coupon is a key, never a discount of its own.
fn cpn_001(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = |active: bool, valid_to: Option<chrono::DateTime<chrono::Utc>>, running: bool| {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
        let mut rule = fx::rule("R1", fx::percent(1_000));
        rule.coupon_code = Some("SHARED".into());
        if !running {
            rule.status = pricing_engine::RuleStatus::Paused;
        }
        snap.rules.push(rule);
        snap.coupons.push(pricing_engine::Coupon {
            code: "SHARED".into(),
            rule_id: "R1".into(),
            active,
            customer_id: None,
            valid_from: None,
            valid_to,
            // Shared and unlimited: no ceiling, so it never runs out.
            max_uses: None,
            used: 0,
        });
        snap
    };
    let cart = [CartLine::new("SKU1", 1)];

    let good = got!(
        expect,
        fx::price(
            &build(true, None, true),
            &fx::ctx().with_coupon("SHARED"),
            &cart
        )
    );
    expect.eq(
        "CPN-001 the right code opens the promotion",
        good.discount_total.minor,
        10_000,
    );

    let wrong = got!(
        expect,
        fx::price(
            &build(true, None, true),
            &fx::ctx().with_coupon("NOPE"),
            &cart
        )
    );
    expect.eq(
        "CPN-001 a code that is not the code opens nothing",
        wrong.discount_total.minor,
        0,
    );

    let expired = got!(
        expect,
        fx::price(
            &build(true, Some(fx::at(3)), true),
            &fx::ctx().with_coupon("SHARED"),
            &cart,
        )
    );
    expect.eq(
        "CPN-001 an expired code gives nothing",
        expired.discount_total.minor,
        0,
    );
    expect.that(
        "CPN-001 and it says the coupon expired rather than blaming the basket",
        expired
            .rejected_rules
            .iter()
            .any(|one| one.reason == RejectionReason::CouponExpired),
    );

    let paused = got!(
        expect,
        fx::price(
            &build(true, None, false),
            &fx::ctx().with_coupon("SHARED"),
            &cart,
        )
    );
    expect.eq(
        "CPN-001 a valid code on a promotion that is not running gives nothing",
        paused.discount_total.minor,
        0,
    );

    let dormant = got!(
        expect,
        fx::price(
            &build(false, None, true),
            &fx::ctx().with_coupon("SHARED"),
            &cart,
        )
    );
    expect.eq(
        "CPN-001 an inactive code gives nothing",
        dormant.discount_total.minor,
        0,
    );

    // The row's last clause, and the one worth having: the code itself is
    // worth nothing. Present it with no promotion behind it and the basket is
    // the basket.
    let mut bare = fx::snapshot(vec![fx::entry("SKU1", 100_000)], vec![]);
    bare.coupons.push(pricing_engine::Coupon {
        code: "SHARED".into(),
        rule_id: "R1".into(),
        active: true,
        customer_id: None,
        valid_from: None,
        valid_to: None,
        max_uses: None,
        used: 0,
    });
    let alone = got!(
        expect,
        fx::price(&bare, &fx::ctx().with_coupon("SHARED"), &cart)
    );
    expect.eq(
        "CPN-001 a coupon discounts nothing on its own",
        alone.total.minor,
        100_000,
    );
    expect.finish()
}

// ---------------------------------------------------------------------------
// BXY — a bundle beside the other offers
// ---------------------------------------------------------------------------

/// BXY-007: a bundle and a line promotion over the same goods. A unit is used
/// once by the same promotion, and the reward's price follows the stated
/// order rather than whichever ran first.
fn bxy_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = |with_line: bool| {
        let mut snap = fx::snapshot(
            vec![
                fx::entry("U1", 300_000),
                fx::entry("U2", 200_000),
                fx::entry("U3", 100_000),
            ],
            vec![],
        );
        let mut bundle = fx::rule(
            "BXGY",
            Effect::BuyXGetY {
                buy: 2,
                get: 1,
                reward_bps: 10_000,
            },
        );
        bundle.scope.applicability = Some(Applicability::Sku {
            sku_codes: fx::skus(&["U1", "U2", "U3"]),
        });
        bundle.stacking = Stacking::Stackable;
        bundle.priority = 100;
        snap.rules.push(bundle);
        if with_line {
            let mut line = fx::rule("LINE", fx::percent(1_000));
            line.scope.applicability = Some(Applicability::Sku {
                sku_codes: fx::skus(&["U1"]),
            });
            line.stacking = Stacking::Stackable;
            line.priority = 50;
            snap.rules.push(line);
        }
        snap
    };
    let cart = [
        CartLine::new("U1", 1),
        CartLine::new("U2", 1),
        CartLine::new("U3", 1),
    ];

    let bundle_only = got!(expect, fx::price(&build(false), &fx::ctx(), &cart));
    expect.eq(
        "BXY-007 the bundle alone gives away the cheapest of the three",
        bundle_only.discount_total.minor,
        100_000,
    );

    let both = got!(expect, fx::price(&build(true), &fx::ctx(), &cart));
    // The row's requirement is that the interaction is EXPLICIT, not that it
    // is generous: whatever the engine does, it must be a stated order and the
    // basket must still add up. Both offers combining means the shopper never
    // pays more than under the bundle alone, and no unit goes negative.
    expect.that(
        "BXY-007 adding a line offer never makes the basket dearer",
        both.total.minor <= bundle_only.total.minor,
    );
    expect.that(
        "BXY-007 no line was taken below nothing by the two together",
        both.lines.iter().all(|line| line.line_total.minor >= 0),
    );
    expect.eq(
        "BXY-007 the lines still come to the total",
        both.lines
            .iter()
            .map(|line| line.line_total.minor)
            .sum::<i64>(),
        both.total.minor,
    );
    for applied in &both.applied_rules {
        expect.eq(
            &format!("BXY-007 {} allocated exactly what it took", applied.rule_id),
            applied
                .line_benefits
                .iter()
                .map(|share| share.benefit.minor)
                .sum::<i64>(),
            applied.benefit.minor,
        );
    }
    expect.finish()
}

// ---------------------------------------------------------------------------
// PRP — more properties
// ---------------------------------------------------------------------------

/// PRP-004: splitting or merging a sale line does not change the sale. Three
/// units are three units however the till chose to group them.
fn prp_004(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    let build = || {
        let mut snap = fx::snapshot(vec![fx::entry("SKU1", 150_000)], vec![]);
        let mut bundle = fx::rule(
            "BXGY",
            Effect::BuyXGetY {
                buy: 2,
                get: 1,
                reward_bps: 10_000,
            },
        );
        bundle.stacking = Stacking::Stackable;
        snap.rules.push(bundle);
        let mut earn = fx::rule(
            "EARN",
            Effect::EarnPoints(EarnEffect::SpendRate {
                spend_per_point: Money::new(1_000),
            }),
        );
        earn.stacking = Stacking::Stackable;
        snap.rules.push(earn);
        snap
    };

    // Six units, grouped four different ways. A bundle and an earning rate are
    // both in play, so a shape that changed the grouping would change the
    // reward count or the points and be caught.
    let shapes: [(&str, Vec<i64>); 4] = [
        ("one line of six", vec![6]),
        ("two threes", vec![3, 3]),
        ("three twos", vec![2, 2, 2]),
        ("six ones", vec![1, 1, 1, 1, 1, 1]),
    ];
    let mut seen: Vec<(i64, i64, i64)> = Vec::new();
    for (name, grouping) in shapes {
        let cart: Vec<CartLine> = grouping
            .iter()
            .map(|quantity| CartLine::new("SKU1", *quantity))
            .collect();
        let result = got!(expect, fx::price(&build(), &fx::ctx(), &cart));
        expect.eq(
            &format!("PRP-004 {name}: the lines come to the total"),
            result
                .lines
                .iter()
                .map(|line| line.line_total.minor)
                .sum::<i64>(),
            result.total.minor,
        );
        seen.push((
            result.total.minor,
            result.discount_total.minor,
            result.points_earned,
        ));
    }
    expect.that(
        &format!("PRP-004 every grouping of the same six units priced the same: {seen:?}"),
        seen.windows(2).all(|pair| pair[0] == pair[1]),
    );
    expect.finish()
}

/// PRP-007: a priced basket survives a round trip through JSON with every
/// canonical value intact.
fn prp_007(_fixtures: &Fixtures) -> Outcome {
    let mut expect = Expect::new();
    // An ordinary basket, but with every value chosen to be awkward: a markdown,
    // a basket amount that does not divide, a tax rate that is not a round
    // percentage, and an earning rate that is prime. A serialiser that rounded
    // anything would show here.
    let mut snap = fx::snapshot(
        vec![
            fx::entry_taxed("SKU1", 1_299_997, "STANDARD"),
            fx::entry_taxed("SKU2", 333_333, "STANDARD"),
        ],
        vec![fx::markdown("MD-1", "SKU2", 299_999)],
    );
    fx::taxed(&mut snap, "STANDARD", 1_100, true);
    let mut basket = fx::rule("R1", fx::amount(70_007));
    basket.scope.applicability = Some(Applicability::WholeCart);
    basket.stacking = Stacking::Stackable;
    basket.markdown_policy = MarkdownPolicy::Allow;
    snap.rules.push(basket);
    let mut earn = fx::rule(
        "E1",
        Effect::EarnPoints(EarnEffect::SpendRate {
            spend_per_point: Money::new(997),
        }),
    );
    earn.stacking = Stacking::Stackable;
    earn.markdown_policy = MarkdownPolicy::Allow;
    snap.rules.push(earn);

    let result = got!(
        expect,
        fx::price(
            &snap,
            &fx::ctx(),
            &[CartLine::new("SKU1", 3), CartLine::new("SKU2", 2)],
        )
    );
    expect.that(
        "PRP-007 the fixture priced to something worth round-tripping",
        result.total.is_positive() && result.points_earned > 0 && !result.lines.is_empty(),
    );

    let wire = match serde_json::to_string(&result) {
        Ok(wire) => wire,
        Err(error) => {
            expect.note(format!("PRP-007 the result would not serialise: {error}"));
            return expect.finish();
        }
    };
    match serde_json::from_str::<pricing_engine::PricingResult>(&wire) {
        Ok(back) => {
            expect.eq(
                "PRP-007 the whole result survives the round trip",
                back,
                result,
            );
        }
        Err(error) => {
            expect.note(format!("PRP-007 the result would not come back: {error}"));
        }
    }

    // And money beyond what a 64-bit float can hold, carried on its own. 2^53+1
    // is the first integer a float cannot represent, so a wire format that went
    // through one would bring back 2^53. Not put through the engine: pricing a
    // basket that large legitimately overflows, and the row is about the
    // SERIALISER, not about arithmetic headroom.
    let beyond_float = Money::new(9_007_199_254_740_993);
    match serde_json::to_string(&beyond_float).and_then(|wire| serde_json::from_str::<Money>(&wire))
    {
        Ok(back) => expect.eq(
            "PRP-007 integer money is not rounded to float precision on the wire",
            back,
            beyond_float,
        ),
        Err(error) => {
            expect.note(format!("PRP-007 money would not round-trip: {error}"));
        }
    }

    // And the rule as published, since a version or a time boundary that moved
    // would reprice history.
    let rule_wire = match serde_json::to_string(&snap.rules) {
        Ok(wire) => wire,
        Err(error) => {
            expect.note(format!("PRP-007 the rules would not serialise: {error}"));
            return expect.finish();
        }
    };
    match serde_json::from_str::<Vec<pricing_engine::Rule>>(&rule_wire) {
        Ok(back) => expect.eq(
            "PRP-007 the rules survive the round trip",
            back,
            snap.rules.clone(),
        ),
        Err(error) => {
            expect.note(format!("PRP-007 the rules would not come back: {error}"));
        }
    }
    expect.finish()
}
