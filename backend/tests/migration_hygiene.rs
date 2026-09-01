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

#[test]
fn the_cloud_migration_numbers_run_without_gaps() {
    let versions: Vec<u32> = migration_files("postgres")
        .into_iter()
        .map(|(version, _)| version)
        .collect();
    let expected: Vec<u32> = (1..=versions.len() as u32).collect();
    assert_eq!(
        versions, expected,
        "the cloud migrations skip a number. A missing file is a table that \
         will be absent from every database built from scratch, which shows up \
         far from here and long after."
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
