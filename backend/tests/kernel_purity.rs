//! The finance kernels stay pure, and this is what keeps them that way.
//!
//! `domain::depreciation` and `domain::bank_match` are decision-free: every
//! fact they need arrives as an argument, so the same inputs give the same
//! answer forever. That is true today because it was written that way, and a
//! property that is only true because somebody was careful is a property that
//! stops being true.
//!
//! # What "pure" buys, concretely
//!
//! The depreciation kernel cannot ask what today's date is. If it could —
//! `Utc::now()` inside `monthly_charge` — then running September's charge on
//! the 30th and on the 1st of October would give different answers, silently,
//! with nothing failing. Instead the period arrives as an index the caller
//! computed, and the same asset in the same month is the same number whenever
//! anybody runs it.
//!
//! Likewise the matcher cannot read the database. A candidate list is an
//! argument, which is why `resolve` can be handed two lines and two candidates
//! and be checked exhaustively in microseconds.
//!
//! # Why this reads source rather than a manifest
//!
//! The reference implementation this was ported from puts each kernel in its
//! own crate and asserts against that crate's `Cargo.toml`, which is stronger:
//! the compiler cannot even resolve `sqlx` there. Here the kernels are modules
//! of one crate that legitimately depends on sqlx, tokio and axum, so a
//! manifest check would prove nothing. Scanning the two files for the imports
//! and calls that would end their purity is the honest version of the same
//! gate at this scale — cruder, and it catches the mistake somebody would
//! actually make.
//!
//! If these ever move into their own crate, replace this with the manifest
//! check and delete the file.

use std::path::{Path, PathBuf};

/// The modules that must stay pure.
const KERNELS: &[&str] = &[
    "src/cloud/domain/depreciation.rs",
    "src/cloud/domain/bank_match.rs",
    // The balancer. It decides what an entry owes between units, which is the
    // one decision in this system that has to give the same answer to the
    // poster and to the reversal of the same entry a year later — so it may
    // not read a map, a site table, or a clock. Where head office is arrives
    // as an argument for exactly that reason.
    "src/cloud/domain/interunit.rs",
    // lane-P: splitting a settlement across open items, and putting an age in
    // a bucket. Here for the same reason as the other two — an ageing report
    // that changed its answer depending on when it was run would be a report
    // nobody could compare with last month's, and the way that happens is a
    // kernel reaching for the calendar. Ages arrive as whole days.
    "src/cloud/domain/payment_ledger.rs",
];

/// Anything that would make an answer depend on something other than the
/// arguments: a database, a network, a clock, a random source, a filesystem, or
/// an async runtime.
///
/// `chrono` is on the list and it is the one worth explaining. It is not I/O —
/// but a kernel that can name a date is a kernel one line away from asking for
/// today's, and `Utc::now()` is exactly the call that makes a September figure
/// depend on when September was closed. Dates reach these modules as plain
/// integers for that reason.
const FORBIDDEN: &[(&str, &str)] = &[
    (
        "sqlx",
        "a database read makes the answer depend on stored state",
    ),
    ("tokio", "an async runtime means I/O is reachable"),
    ("axum", "HTTP is a caller's concern, never a kernel's"),
    ("reqwest", "a network call is not a pure function"),
    (
        "chrono",
        "a calendar type is one line from Utc::now(); pass days as integers",
    ),
    (
        "std::time",
        "a clock makes the same input give different answers",
    ),
    (
        "SystemTime",
        "a clock makes the same input give different answers",
    ),
    ("Utc::now", "the answer would depend on when it was asked"),
    ("rand", "randomness is the opposite of deterministic"),
    ("std::fs", "the filesystem is I/O"),
    ("std::env", "the environment is state the caller cannot see"),
    ("uuid::Uuid::new_v4", "minting an identity is a side effect"),
];

fn repository() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

/// The source with its comments taken out.
///
/// Comments in these files legitimately DISCUSS the forbidden things — this
/// crate's own module header explains why `Utc::now()` is not called — and a
/// scanner that read them would fail on the explanation for the rule it is
/// enforcing.
fn code_only(source: &str) -> String {
    source
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !trimmed.starts_with("//")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn the_finance_kernels_reach_nothing_outside_their_arguments() {
    for relative in KERNELS {
        let path: PathBuf = repository().join(relative);
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
        let code = code_only(&source);

        for (needle, why) in FORBIDDEN {
            assert!(
                !code.contains(needle),
                "{relative} mentions `{needle}` — {why}.\n\
                 This module is a pure kernel: everything it needs arrives as an \
                 argument, which is what lets it be tested exhaustively without a \
                 database and what stops the same input giving two answers. Take \
                 the value as a parameter instead, the way `Basis.period_index` \
                 takes a period the caller worked out from the calendar."
            );
        }
    }
}

/// A kernel that returned nothing observable would pass the scan above and be
/// useless, so check the two doors are still there and still pure in shape.
#[test]
fn the_kernels_still_expose_the_functions_they_exist_for() {
    let depreciation = std::fs::read_to_string(repository().join(KERNELS[0]))
        .unwrap_or_else(|error| panic!("read: {error}"));
    let matching = std::fs::read_to_string(repository().join(KERNELS[1]))
        .unwrap_or_else(|error| panic!("read: {error}"));

    assert!(
        depreciation.contains("pub fn monthly_charge(basis: Basis) -> Outcome"),
        "the depreciation door takes a Basis and returns an Outcome, by value"
    );
    assert!(
        matching.contains("pub fn suggest(") && matching.contains("pub fn resolve("),
        "the matcher scores one line and plans a whole statement, and both are public"
    );
    // No `&mut self`, no `&PgPool`, no `async`: the signatures themselves say
    // these are functions of their arguments.
    for (name, source) in [("depreciation", &depreciation), ("bank_match", &matching)] {
        assert!(
            !source.contains("pub async fn"),
            "{name} has an async door; a pure kernel has nothing to await"
        );
    }
}
