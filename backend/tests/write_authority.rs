//! Who is allowed to write what.
//!
//! The idea is taken from the Go implementation's forbidden-writer linter,
//! which enforces an authority matrix — one row per table, naming the packages
//! permitted to write it — and which exists there because that codebase learned
//! the hard way that a table with many writers has no owner, and a table with
//! no owner drifts.
//!
//! `pricing_authority.rs` is the narrow version of this: it guards the two
//! tables that decide a price, and it guards *mentions* rather than writes,
//! because for those the reading is the sin. This is the broad version, and it
//! guards writes, because for everything else the writing is.
//!
//! # Why writes specifically
//!
//! Reading a table widely is usually fine and often necessary — a report reads
//! everything. Writing it widely is how two places come to disagree about what
//! a row means. Every fault found in the commercial domain this week was some
//! version of that: a count written in one place and read from another, a price
//! resolved by two evaluators, a sale recorded in two models.
//!
//! # What this cannot catch
//!
//! Text. A write assembled from a format string, or performed through a helper
//! that names the table somewhere else, is invisible here. That is accepted:
//! the guard exists to make adding a writer a deliberate act with a reason
//! beside it, not to be a proof. A determined author can always get around it,
//! and an undetermined one — the one who adds a second writer without noticing
//! it is a second writer — is exactly who it stops.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// One table, and the files that may write it.
struct Authority {
    table: &'static str,
    /// Paths relative to `backend/`. Test code is excluded before matching, so
    /// a fixture inserting rows is not a writer.
    writers: &'static [&'static str],
    /// Why those and nobody else.
    reason: &'static str,
}

/// The matrix.
///
/// Read it as a sentence: this table is written by these, for this reason.
/// Anything else that writes it is either a mistake or a decision, and a
/// decision belongs on this list with its reason next to it.
const MATRIX: &[Authority] = &[
    Authority {
        table: "commercial_publication",
        writers: &[
            "src/cloud/postgres/commercial.rs",
            "src/cloud/postgres/tagging.rs",
            "src/cloud/postgres/sync.rs",
            "src/edge/sync.rs",
        ],
        reason: "authoring writes a book, setting up an article publishes one, \
                 and the two sync lanes carry it to a shop and apply it there",
    },
    Authority {
        table: "commercial_price_rule",
        writers: &[
            "src/cloud/postgres/commercial.rs",
            "src/cloud/postgres/tagging.rs",
            "src/cloud/postgres/sync.rs",
            "src/edge/sync.rs",
        ],
        reason: "same four, for the same reason: a price is authored, published, \
                 carried, applied — and resolved by the engine, which writes nothing",
    },
    Authority {
        table: "commercial_markdown",
        writers: &["src/cloud/postgres/commercial.rs", "src/edge/sync.rs"],
        reason: "authored at the centre, applied at a shop. Frozen once published \
                 (migration 0073), so there is no third moment to write one",
    },
    Authority {
        table: "commercial_rule",
        writers: &["src/cloud/postgres/commercial.rs", "src/edge/sync.rs"],
        reason: "as markdowns; a promotion is a document, authored once",
    },
    Authority {
        table: "commercial_coupon",
        writers: &["src/cloud/postgres/commercial.rs", "src/edge/sync.rs"],
        reason: "as markdowns. Its `used` column is dead — counting happens in \
                 commercial_usage, and a writer touching it here would be \
                 reviving a number nothing reads",
    },
    Authority {
        table: "commercial_campaign",
        writers: &["src/cloud/postgres/commercial.rs", "src/edge/sync.rs"],
        reason: "as markdowns. Pausing one will NOT be a write here when it \
                 arrives — a pause has to reach the shops, so it belongs outside \
                 the publication with a command that carries it",
    },
    Authority {
        table: "commercial_usage",
        writers: &["src/cloud/postgres/sync.rs", "src/edge/sync.rs"],
        reason: "built only from sale facts already accepted, so it inherits \
                 their idempotency: a resent sale lands once and counts once. \
                 A second writer would be a count nobody could reconcile",
    },
    Authority {
        table: "commercial_usage_customer",
        writers: &["src/cloud/postgres/sync.rs"],
        reason: "as commercial_usage, and only at the centre: a shop counts its \
                 own customers and would double-count the fleet's",
    },
    Authority {
        table: "commercial_publication_activation",
        writers: &["src/cloud/postgres/sync.rs"],
        reason: "a shop reports activating a book in the transaction that \
                 activates it. Nobody ticks this off by hand, which is the whole \
                 reason it can be trusted",
    },
    Authority {
        table: "edge_sale",
        writers: &["src/cloud/postgres/sync.rs"],
        reason: "the centre's record of a shop's sale, projected from an accepted \
                 fact and from nothing else. Every legacy this system was drawn \
                 from arrived at the same rule: the centre does not originate a sale",
    },
    Authority {
        table: "edge_sale_line",
        writers: &["src/cloud/postgres/sync.rs"],
        reason: "as edge_sale",
    },
    Authority {
        table: "edge_sale_promotion",
        writers: &["src/cloud/postgres/sync.rs"],
        reason: "written beside the counts, from the same fact and inside the \
                 same guard, so a receipt and the usage totals cannot disagree",
    },
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

/// The file with its test modules removed.
///
/// A fixture inserting rows is not a writer, and counting it as one would push
/// every test helper onto the matrix — which would make the matrix describe the
/// tests rather than the system. Cut at the first `#[cfg(test)]`: these files
/// put their tests at the bottom, and a guard that is approximately right about
/// where tests begin is worth more than one that needs a parser.
fn without_tests(text: &str) -> &str {
    match text.find("#[cfg(test)]") {
        Some(at) => &text[..at],
        None => text,
    }
}

fn writes(text: &str, table: &str) -> bool {
    [
        format!("INSERT INTO {table}"),
        format!("UPDATE {table}"),
        format!("DELETE FROM {table}"),
    ]
    .iter()
    .any(|statement| {
        text.match_indices(statement.as_str()).any(|(at, _)| {
            // `commercial_usage` must not match `commercial_usage_customer`.
            text[at + statement.len()..]
                .chars()
                .next()
                .is_none_or(|next| !next.is_alphanumeric() && next != '_')
        })
    })
}

#[test]
fn every_table_is_written_only_by_the_files_that_own_it() {
    let root = backend_root();
    let mut sources = Vec::new();
    rust_sources(&root.join("src"), &mut sources);

    let mut trespasses = Vec::new();
    for entry in MATRIX {
        let allowed: BTreeSet<&str> = entry.writers.iter().copied().collect();
        for path in &sources {
            let text = std::fs::read_to_string(path).unwrap_or_default();
            if !writes(without_tests(&text), entry.table) {
                continue;
            }
            let relative = path
                .strip_prefix(&root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            if !allowed.contains(relative.as_str()) {
                trespasses.push(format!(
                    "{} is written by {relative}, which does not own it.\n    \
                     Owners: {}\n    Because: {}",
                    entry.table,
                    entry.writers.join(", "),
                    entry.reason
                ));
            }
        }
    }
    assert!(
        trespasses.is_empty(),
        "the authority matrix is broken:\n  {}\n\n\
         A table with many writers has no owner, and a table with no owner \
         drifts. If this write is genuinely the right place for it, add the \
         file to MATRIX with the reason — deliberately, in writing.",
        trespasses.join("\n  ")
    );
}

/// The matrix must describe tables that exist.
///
/// A row naming a renamed or dropped table passes for ever and guards nothing,
/// which is worse than no row: it reads like protection.
#[test]
fn the_matrix_names_real_tables() {
    let root = backend_root();
    let mut migrations = String::new();
    for directory in ["migrations/postgres", "migrations/sqlite"] {
        let Ok(entries) = std::fs::read_dir(root.join(directory)) else {
            continue;
        };
        for entry in entries.flatten() {
            migrations.push_str(&std::fs::read_to_string(entry.path()).unwrap_or_default());
        }
    }
    let missing: Vec<&str> = MATRIX
        .iter()
        .map(|entry| entry.table)
        .filter(|table| {
            !migrations.contains(&format!("CREATE TABLE {table}"))
                && !migrations.contains(&format!("CREATE TABLE IF NOT EXISTS {table}"))
        })
        .collect();
    assert!(
        missing.is_empty(),
        "the matrix guards tables no migration creates: {missing:?}. \
         A row for a table that does not exist reads like protection and is none."
    );
}
