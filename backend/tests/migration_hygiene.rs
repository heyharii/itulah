//! Two guards on the migration folders, one per flavour, because the two
//! flavours are ordered by different things.
//!
//! **The cloud is ordered by the number.** sqlx keys `_sqlx_migrations` on the
//! version parsed out of the filename, so two files claiming one number is
//! fatal — and the way it fails names neither file:
//!
//! ```text
//! duplicate key value violates unique constraint "_sqlx_migrations_pkey"
//! Key (version)=(32) already exists.
//! ```
//!
//! Every Postgres test turns red at once and the message points at nothing, so
//! the first instinct is to go looking for a bug in whatever you last touched.
//! It happens because several sessions work this repository at the same time
//! and each picks "the next free number" by reading the directory. Two people
//! reading it at the same moment pick the same number.
//!
//! The remedy the lanes settled on is to claim a *distant block* instead of the
//! next number, which means the numbering is deliberately full of holes. So the
//! second cloud guard is not "no gaps" but "no gap nobody claimed": see
//! `RESERVED` below, where each hole is written down with the reason it is one.
//! An unexplained gap is still a missing file, and still worth stopping for.
//!
//! **The edge is ordered by the code.** Its migrations are `include_str!`-ed
//! into constants and applied in an order written out by hand in
//! `src/edge/sqlite.rs` — which today applies `0005` before `0004`. So the
//! number there is a label, not a sequence, and asserting that it runs in
//! order would be asserting a property this design has never had.
//!
//! What *is* true of the edge, and worth guarding, is that a file which nobody
//! applies is a table missing from every database built from scratch. So that
//! is what the edge test checks: every migration on disk is referenced by the
//! code that applies them.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn repository() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn migrations_dir(flavour: &str) -> PathBuf {
    repository().join("migrations").join(flavour)
}

/// Every migration file in a flavour, as (version, filename).
fn migration_files(flavour: &str) -> Vec<(u32, String)> {
    let dir = migrations_dir(flavour);
    let entries = std::fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", dir.display()));

    let mut found = Vec::new();
    for entry in entries {
        let entry = entry.unwrap_or_else(|error| panic!("cannot read an entry: {error}"));
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".sql") {
            continue;
        }
        // `0033_price_levels_and_campaigns.sql` -> 33
        let digits: String = name.chars().take_while(char::is_ascii_digit).collect();
        assert!(
            !digits.is_empty(),
            "{flavour}/{name} does not start with a version number"
        );
        let version: u32 = digits
            .parse()
            .unwrap_or_else(|error| panic!("{flavour}/{name} has an unreadable version: {error}"));
        found.push((version, name));
    }
    found.sort();
    found
}

#[test]
fn no_two_cloud_migrations_claim_the_same_number() {
    let mut by_version: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    for (version, name) in migration_files("postgres") {
        by_version.entry(version).or_default().push(name);
    }

    let clashes: Vec<String> = by_version
        .iter()
        .filter(|(_, names)| names.len() > 1)
        .map(|(version, names)| format!("  {version:04}: {}", names.join(", ")))
        .collect();

    assert!(
        clashes.is_empty(),
        "two cloud migrations claim the same number:\n{}\n\n\
         sqlx keys its ledger on that number, so applying these fails with a \
         duplicate-key error that names neither file. Renumber the newer one to \
         the next free number — and check `ls migrations/postgres` first, \
         because somebody else may have taken it since you looked.",
        clashes.join("\n")
    );
}

/// The number blocks this estate has deliberately left empty, and why.
///
/// A gap is normally a missing file, and a missing file is a table absent from
/// every database built from scratch — found far from here and long after. But
/// several sessions work this repository at once, and the convention that stops
/// two of them claiming one number is to take a *distant block* rather than the
/// next free number. Those blocks are gaps on purpose, and they stay gaps: a
/// number that has been applied to a live database cannot be renumbered,
/// because its checksum is what `sqlx::migrate!` compares.
///
/// So the guard cannot be "no gaps". It is "no gap nobody claimed" — which is
/// still the guard worth having, because an accidentally skipped number looks
/// exactly like a reserved one until somebody writes down which it is. That is
/// what this table is for. Anything outside it is a missing file.
const RESERVED: &[(u32, u32, &str)] = &[
    (
        47,
        49,
        "left to the finance lane, which was writing 0050_ledger and its \
         successors in parallel (docs/hr-port-provenance.md)",
    ),
    (
        53,
        59,
        "the remainder of that finance block; the HR port starts at 0060",
    ),
    (
        62,
        69,
        "held open for the HR port after it landed 0060 and 0061",
    ),
    (
        100,
        100,
        "a proposed-hires feature the owner decided against, removed before it \
         reached git; deliberately not reused because 0101 is already applied \
         and renumbering it would change its checksum",
    ),
    (
        107,
        158,
        "the asset lane's block: 146115e filed 0106 and then jumped to 0159 \
         rather than crowd the next number",
    ),
];

#[test]
fn the_cloud_migration_numbers_run_without_unclaimed_gaps() {
    let versions: Vec<u32> = migration_files("postgres")
        .into_iter()
        .map(|(version, _)| version)
        .collect();
    let claimed = |number: u32| {
        RESERVED
            .iter()
            .any(|(first, last, _)| number >= *first && number <= *last)
    };

    let highest = versions.last().copied().unwrap_or(0);
    let unclaimed: Vec<u32> = (1..=highest)
        .filter(|number| !versions.contains(number) && !claimed(*number))
        .collect();

    assert!(
        unclaimed.is_empty(),
        "the cloud migrations skip {} nobody has claimed: {}\n\n\
         A missing file is a table that will be absent from every database \
         built from scratch, which shows up far from here and long after. If \
         the gap is deliberate — a lane holding a block, or a number retired \
         rather than reused — add it to RESERVED in this file with the reason, \
         so the next reader can tell your gap from a lost file.",
        if unclaimed.len() == 1 {
            "a number"
        } else {
            "numbers"
        },
        unclaimed
            .iter()
            .map(|number| format!("{number:04}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
}

#[test]
fn no_reserved_block_is_dead_weight() {
    // A block that has filled up is a block nobody is holding any more, and
    // leaving it here turns the next genuinely missing file into a permitted
    // gap. Same reasoning as the matrix check in `write_authority`: the
    // allowlist has to be guarded, or it rots into a blindfold.
    let versions: Vec<u32> = migration_files("postgres")
        .into_iter()
        .map(|(version, _)| version)
        .collect();

    let full: Vec<String> = RESERVED
        .iter()
        .filter(|(first, last, _)| (*first..=*last).all(|number| versions.contains(&number)))
        .map(|(first, last, reason)| format!("  {first:04}-{last:04}: {reason}"))
        .collect();

    assert!(
        full.is_empty(),
        "these reserved blocks now hold a file at every number:\n{}\n\n\
         Delete the entry. The block did its job; keeping it means a file lost \
         from that range would never be reported.",
        full.join("\n")
    );
}

#[test]
fn every_edge_migration_is_actually_applied_by_something() {
    // The edge applies its migrations from constants written out by hand, so a
    // file can be added, committed, reviewed — and never run. Nothing else
    // would notice until a fresh shop came up missing a table.
    let applier = repository().join("src/edge/sqlite.rs");
    let source = std::fs::read_to_string(&applier)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", applier.display()));

    let orphans: Vec<String> = migration_files("sqlite")
        .into_iter()
        .map(|(_, name)| name)
        .filter(|name| !source.contains(name.as_str()))
        .collect();

    assert!(
        orphans.is_empty(),
        "these edge migrations are on disk but nothing applies them:\n  {}\n\n\
         Add an `include_str!` constant and a guarded `execute_batch` in \
         src/edge/sqlite.rs, next to the others.",
        orphans.join("\n  ")
    );
}
