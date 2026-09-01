//! One evaluator, and a test that says so.
//!
//! The architecture plan makes this its first rule — "hanya `pricing-engine`
//! boleh resolve harga" — and names a forbidden-evaluator test as the proof it
//! requires. There was none, and in its absence a second evaluator grew: a
//! price cascade written in SQL that priced every line of every sale made at
//! the centre, reading price rules and tax and knowing nothing about clearance.
//! It is gone, and this is what keeps it gone.
//!
//! The guard is deliberately crude. It reads the source and asserts which files
//! may name the price tables at all, because a rule about intent cannot be
//! checked and a rule about reach can. Adding a file to the list is then a
//! decision somebody makes on purpose, with a reason written next to it, rather
//! than a thing that happens.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// The tables that decide what something costs.
///
/// All six, not the two it started with. A promotion, the code that unlocks one
/// and the campaign that funds one decide a price exactly as directly as the
/// price list does — and `commercial_usage` decides whether a promotion may
/// still apply at all, which is the same power expressed as a count. Guarding
/// the price list while leaving the discounts open protected the smaller half.
/// `commercial_usage` is deliberately NOT here, though it does decide whether a
/// promotion may still apply. This guard matches bare mentions, and "usage" is
/// also a route path and a handler name — so adding it would flag
/// `/api/v1/commercial/usage` as a second pricing evaluator. It is an
/// observation rather than a decision, and `write_authority.rs` already names
/// its two writers.
const PRICE_TABLES: [&str; 5] = [
    "commercial_price_rule",
    "commercial_markdown",
    "commercial_rule",
    "commercial_coupon",
    "commercial_campaign",
];

/// Who may name them, and why.
///
/// Two of these READ to price — the pair of snapshot loaders that hand the
/// engine its inputs, one per node. The rest only ever WRITE: authoring,
/// publishing, and the sync lanes that carry a book to a shop and apply it
/// there. Nothing else has business knowing these tables exist.
const ALLOWED: [(&str, &str); 8] = [
    (
        "src/cloud/postgres/pricing.rs",
        "reads: builds the centre's snapshot for the engine",
    ),
    (
        "src/edge/pricing.rs",
        "reads: builds a shop's snapshot for the engine",
    ),
    (
        "src/cloud/postgres/commercial.rs",
        "writes: authoring, publishing, and reading a book back to show it",
    ),
    (
        "src/cloud/postgres/tagging.rs",
        "writes: setting up an article publishes its first price",
    ),
    (
        "src/cloud/postgres/sync.rs",
        "writes: carries a published book down the lane",
    ),
    (
        "src/edge/sync.rs",
        "writes: applies a book that arrived at a shop",
    ),
    ("src/edge/sqlite.rs", "writes: the shop's own schema"),
    (
        "src/cloud/postgres/sales.rs",
        "reads ONE thing: which currency a shop sells in, to open a sale. It \
         must never resolve a price — see the test below.",
    ),
];

fn backend_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_sources(root: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_sources(&path, found);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn only_the_snapshot_loaders_may_reach_the_price_tables() {
    let root = backend_root();
    let mut sources = Vec::new();
    rust_sources(&root.join("src"), &mut sources);

    let allowed: BTreeSet<&str> = ALLOWED.iter().map(|(file, _)| *file).collect();
    let mut trespassers = Vec::new();
    for path in sources {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        if !PRICE_TABLES.iter().any(|table| text.contains(table)) {
            continue;
        }
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        if !allowed.contains(relative.as_str()) {
            trespassers.push(relative);
        }
    }
    assert!(
        trespassers.is_empty(),
        "these files name a price table and are not on the list: {trespassers:?}\n\
         Pricing is answered in one place. If this file genuinely needs to write \
         one of these tables, add it to ALLOWED with the reason; if it is \
         resolving a price, it must ask `pricing-engine` instead."
    );
}

/// The sale path may find a currency. It may not find a price.
///
/// This is the specific regression, written down. `add_sale_line` resolved with
/// SQL for as long as it existed; it asks the engine now, and the tell that it
/// has stopped is that the only price table left in the file is the one query
/// that opens a sale.
#[test]
fn the_sale_path_does_not_resolve_a_price_of_its_own() {
    let text = std::fs::read_to_string(backend_root().join("src/cloud/postgres/sales.rs"))
        .unwrap_or_else(|error| panic!("sales.rs: {error}"));

    // A cascade is the shape to watch for: picking a winner among prices.
    for tell in ["ORDER BY (site_id IS NOT NULL)", "JOIN LATERAL"] {
        assert!(
            !text.contains(tell),
            "sales.rs contains `{tell}`, which is a price cascade. \
             Ranking prices is the engine's job, and a second ranking agrees \
             with the first until the day it does not."
        );
    }
    assert!(
        text.contains("pricing_engine::price_catalog"),
        "the sale path must price through the engine"
    );
    assert_eq!(
        text.matches("commercial_price_rule").count(),
        1,
        "the sale path may name the price table once — to learn which currency \
         a shop sells in when a sale is opened — and not to price a line"
    );
}
