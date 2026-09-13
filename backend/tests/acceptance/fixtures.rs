//! The locked expected numbers, and the smallest fixtures that reach them.
//!
//! # Why the numbers are read rather than written
//!
//! `docs/fixtures/commercial-v1-golden-fixtures.json` is the authority for
//! every expected value in G01–G05, and the package says so in as many words:
//! *"angka expected yang dapat dibaca mesin; bukan hasil aplikasi"*. This
//! module loads that file and asserts against what is in it.
//!
//! Transcribing those numbers into Rust literals would have been shorter and
//! is the one thing that must not happen. A fixture copied by hand is a second
//! opinion: it agrees with the document on the day it is written and diverges
//! silently on the day somebody revises one of the two. Worse, the failure is
//! invisible — the suite still passes, against a number nobody locked. Reading
//! the file means a revised fixture moves this harness with it, and a fixture
//! that disappears stops the harness rather than quietly excusing it.
//!
//! The same reasoning forbids the reverse: nothing here may be regenerated
//! from what the engine returns. A fixture bent to match the implementation
//! destroys the only independent evidence there is.

use std::collections::BTreeSet;
use std::path::PathBuf;

use chrono::{DateTime, TimeZone, Utc};
use pricing_engine::{
    price_cart, Caps, CartLine, Conditions, Currency, DaySet, EarnBasis, Effect, ExclusiveScope,
    Markdown, MarkdownPolicy, Money, PointsCombination, PriceEntry, PriceLevel, PricingContext,
    PricingResult, PricingSnapshot, Rule, RuleScope, RuleStatus, Stacking, TaxRule,
};

// ---------------------------------------------------------------------------
// The authority file
// ---------------------------------------------------------------------------

/// The golden fixtures, as loaded from the locked package.
pub struct Fixtures {
    root: serde_json::Value,
    path: PathBuf,
}

impl Fixtures {
    /// Read the fixtures beside the specification package.
    ///
    /// Read at run time rather than through `include_str!` deliberately. The
    /// file is not tracked by git today, and a compile-time include would turn
    /// that into a build error with no sentence in it — the harness would look
    /// broken when what is actually missing is the contract it tests against.
    /// This way the failure names the file and the path it looked in.
    pub fn load() -> Self {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../docs/fixtures/commercial-v1-golden-fixtures.json");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "the golden fixtures are the authority for every expected number in this \
                 harness, and {} could not be read: {error}",
                path.display()
            )
        });
        let root = serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("{} is not valid JSON: {error}", path.display()));
        Self { root, path }
    }

    fn at(&self, dotted: &str) -> &serde_json::Value {
        let mut node = &self.root["fixtures"];
        for step in dotted.split('.') {
            node = &node[step];
            if node.is_null() {
                panic!(
                    "the golden fixtures name no `{dotted}` (lost at `{step}`) in {}",
                    self.path.display()
                );
            }
        }
        node
    }

    /// One locked amount, in whole rupiah.
    pub fn money(&self, dotted: &str) -> i64 {
        self.at(dotted)
            .as_i64()
            .unwrap_or_else(|| panic!("`{dotted}` in the golden fixtures is not a whole number"))
    }

    /// One locked list of amounts, in the fixtures' own stable order.
    pub fn list(&self, dotted: &str) -> Vec<i64> {
        let node = self.at(dotted);
        let items = node
            .as_array()
            .unwrap_or_else(|| panic!("`{dotted}` in the golden fixtures is not a list"));
        items
            .iter()
            .map(|item| {
                item.as_i64().unwrap_or_else(|| {
                    panic!(
                        "`{dotted}` in the golden fixtures holds something that is not a \
                            whole number"
                    )
                })
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Building a basket the engine will price
// ---------------------------------------------------------------------------
//
// These mirror the helpers the engine's own tests use, rewritten here against
// the public API only. They cannot be shared: the engine's are `#[cfg(test)]`
// and live inside the crate, so an integration test cannot see them. Written
// out rather than worked around, because the alternative — exporting test
// helpers from the crate under a feature — would put fixture-shaped code in
// the shipping library.

/// A day in the fixture month. Every price starts on day 1 and every basket is
/// priced on day 5, so a rule that does not say otherwise is simply in force.
pub fn at(day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, day, 12, 0, 0)
        .single()
        .unwrap_or_else(|| panic!("2026-09-{day} 12:00 is not one instant"))
}

pub fn ctx() -> PricingContext {
    PricingContext::new("store-01", "STORE", at(5))
}

pub fn entry(sku: &str, price: i64) -> PriceEntry {
    PriceEntry {
        sku_code: sku.into(),
        applies_to: PriceLevel::Company,
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

/// The same price, but published for one shop only.
pub fn site_entry(sku: &str, site_id: &str, price: i64) -> PriceEntry {
    PriceEntry {
        applies_to: PriceLevel::Site {
            site_id: site_id.into(),
        },
        ..entry(sku, price)
    }
}

/// A price in a tax category of its own, for the baskets that have to carry
/// two treatments at once.
pub fn entry_taxed(sku: &str, price: i64, category: &str) -> PriceEntry {
    PriceEntry {
        tax_category: category.into(),
        ..entry(sku, price)
    }
}

pub fn markdown(id: &str, sku: &str, price: i64) -> Markdown {
    Markdown {
        markdown_id: id.into(),
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

pub fn snapshot(entries: Vec<PriceEntry>, markdowns: Vec<Markdown>) -> PricingSnapshot {
    PricingSnapshot {
        publication_version: 1,
        entries,
        markdowns,
        ..Default::default()
    }
}

/// A rule carrying every default spelled out.
///
/// Stated rather than left to `Default` so that a scenario which needs the
/// other reading of `markdown_policy` or `stacking` has to say so on the line
/// that needs it. A reader comparing a scenario against the plan can then see
/// the whole rule, instead of having to know which defaults were in force the
/// day it was written.
pub fn rule(id: &str, effect: Effect) -> Rule {
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
        exclusive_scope: ExclusiveScope::Basket,
        markdown_policy: MarkdownPolicy::Exclude,
        advisory: false,
        earn_basis: EarnBasis::default(),
        points_combination: PointsCombination::Highest,
        max_points: None,
    }
}

pub fn percent(bps: i64) -> Effect {
    Effect::Percent {
        bps,
        compound: false,
    }
}

pub fn amount(minor: i64) -> Effect {
    Effect::Amount {
        amount: Money::new(minor),
    }
}

pub fn skus(codes: &[&str]) -> BTreeSet<String> {
    codes.iter().map(|code| (*code).to_string()).collect()
}

/// Put a tax rule in the book.
pub fn taxed(snap: &mut PricingSnapshot, category: &str, rate_bps: i64, inclusive: bool) {
    snap.tax_rules.push(TaxRule {
        tax_category: category.into(),
        rate_bps,
        inclusive,
    });
}

/// Price a basket, treating a pricing error as a failed scenario rather than a
/// panic — a scenario that cannot price is a result the report has to carry,
/// not a crash that hides the other 199 rows.
pub fn price(
    snap: &PricingSnapshot,
    context: &PricingContext,
    cart: &[CartLine],
) -> Result<PricingResult, String> {
    price_cart(snap, context, cart).map_err(|error| format!("the basket did not price: {error}"))
}

/// What one line came to, by SKU.
pub fn line_total(result: &PricingResult, sku: &str) -> Result<i64, String> {
    result
        .lines
        .iter()
        .find(|line| line.sku_code == sku)
        .map(|line| line.line_total.minor)
        .ok_or_else(|| format!("no line for {sku} in the priced basket"))
}
