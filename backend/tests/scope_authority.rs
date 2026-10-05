//! A route that takes a unit or a site asks `http::scope` whether it may.
//!
//! # The mistake this catches
//!
//! Until `http::scope`, "is this unit the caller's" was asked by hand in each
//! handler, and the finance routes did not ask at all: a store supervisor
//! holding `finance` could read any unit's general ledger by putting `?unit=`
//! on the address, or every unit's by leaving it off. Nothing failed, because
//! nothing checks that a filter a request supplies is one the caller may use.
//!
//! This is that check, as a source scan in the manner of `kernel_purity`: every
//! handler in `src/cloud/http` whose body reads a unit or a site from the
//! request must also consult the caller's reach — through `Scope`, or through
//! one of the older helpers that resolve the same `Reach` (`reach_of` and the
//! functions built on it). A handler that reads a unit and does neither is a
//! list somebody can widen by editing a URL.
//!
//! # What the allowlist is for
//!
//! Routes whose unit or site is not whose records are shown but which
//! configuration is read: a transaction category resolves to a different
//! account in each unit's books, a site's payment methods are head office's
//! settings. Each entry says why. A new entry is a decision somebody can read
//! in review, which is the whole point of writing it here.

use std::path::Path;

/// Words in a handler's body that mean it asked where the caller may act.
const GUARDS: &[&str] = &[
    "scope",
    "Scope",
    "reach_of",
    "caller_and_reach",
    "allow_unit",
    "allow_site",
    "list_scope",
    "unit_filter",
    "require_reach",
    // Stronger than a scope: only an Admin passes, and an Admin reaches every
    // unit, so the unit in the path is the one being administered.
    "require_admin",
    "head_office_only",
];

/// Reads of a unit or a site from the request.
const UNIT_READS: &[&str] = &[
    "facet_values(&params, \"unit\")",
    "facet_values(&params, \"site\")",
    "single_value(&params, \"unit\")",
    "single_value(&params, \"site\")",
    "query.unit_id",
    "query.site_id",
    "Path(unit)",
    "Path(unit_id)",
    "Path(site_id)",
];

/// (file, handler, why the unit it reads is not a boundary on whose records).
const ALLOWED: &[(&str, &str, &str)] = &[
    (
        "categories.rs",
        "transaction_categories",
        "the unit picks which leaf a category resolves to in that unit's chart; the \
         categories themselves are the company's",
    ),
    ("categories.rs", "unmapped_transaction_categories", "as above"),
    ("categories.rs", "transaction_category", "as above"),
    (
        "fleet.rs",
        "fleet_status_of",
        "server health for IT and head office, whose roles reach every unit",
    ),
    (
        "ga.rs",
        "contract_types",
        "GA's registers are company-wide; only GA and head office hold the section",
    ),
    ("ga.rs", "location", "as above"),
    ("ga.rs", "update_location", "as above"),
    ("ga.rs", "account_suggestion", "as above"),
    (
        "performance.rs",
        "pricelist_performance",
        "merchandise's company-wide view; the site narrows a chart, not a boundary",
    ),
    (
        "unit_register.rs",
        "pic_history",
        "the unit register is head office's (ADMIN); the path names the unit being administered",
    ),
    ("unit_register.rs", "appoint_pic", "as above"),
];

fn handlers(source: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut rest = source;
    let markers = ["\npub async fn ", "\npub(super) async fn "];
    loop {
        let next = markers
            .iter()
            .filter_map(|marker| rest.find(marker).map(|at| (at, marker.len())))
            .min();
        let Some((at, len)) = next else { break };
        let after = &rest[at + len..];
        let name: String = after
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        let end = after.find("\n}\n").map_or(after.len(), |end| end + 3);
        found.push((name, after[..end].to_owned()));
        rest = &after[end..];
    }
    found
}

#[test]
fn every_route_that_reads_a_unit_asks_the_callers_scope() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/cloud/http");
    let mut entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .collect();
    entries.sort();

    let mut unguarded = Vec::new();
    let mut allowed_seen = Vec::new();
    for path in entries {
        let file = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
        for (name, body) in handlers(&source) {
            if !UNIT_READS.iter().any(|read| body.contains(read)) {
                continue;
            }
            if GUARDS.iter().any(|guard| body.contains(guard)) {
                continue;
            }
            if ALLOWED
                .iter()
                .any(|(allowed_file, handler, _)| *allowed_file == file && *handler == name)
            {
                allowed_seen.push((file.clone(), name));
                continue;
            }
            unguarded.push(format!("{file}::{name}"));
        }
    }

    assert!(
        unguarded.is_empty(),
        "these handlers read a unit or a site from the request without asking the caller's \
         scope — take `scope: Scope` and bound the filter with it, or add the handler to \
         ALLOWED with the reason its unit is not a boundary on whose records it shows:\n  {}",
        unguarded.join("\n  ")
    );

    let stale: Vec<String> = ALLOWED
        .iter()
        .filter(|(file, handler, _)| {
            !allowed_seen
                .iter()
                .any(|(seen_file, seen)| seen_file == file && seen == handler)
        })
        .map(|(file, handler, _)| format!("{file}::{handler}"))
        .collect();
    assert!(
        stale.is_empty(),
        "these ALLOWED entries no longer match an unguarded handler — delete them, so the \
         list stays a list of live decisions:\n  {}",
        stale.join("\n  ")
    );
}
