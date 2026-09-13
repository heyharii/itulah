//! What this estate serves, written down, so adding to it is a deliberate act.
//!
//! There is no way to ask axum what a built `Router` holds — `Router` takes its
//! paths and gives back nothing, by design. So the catalogue is read from the
//! source of the functions that build the routers, and compared against a file
//! that is committed. A new route turns this test red until somebody adds it to
//! the file, which is the point: the diff then says "this estate grew a public
//! surface" in a place a reviewer is looking.
//!
//! It is worth guarding because the surface is large and nobody holds it in
//! their head. On the day this was written the centre served 271 paths and the
//! two edges 83 between them, across a repository several sessions work at
//! once. A route added on one lane is invisible to the others until something
//! counts them.
//!
//! **Two columns make this more than an inventory: the role and the record.**
//!
//! The record column names which record a write is filed against in the
//! activity log. A `-` there is the one worth stopping on: it says the log
//! will record that somebody did this and never what they did it to, so the
//! record's own Activity panel will not show it. Five sheets in the hub were
//! reading a history that could not exist for exactly this reason.
//! For the
//! centre, `required_role` decides authorisation from `(method, path)` alone,
//! and its last rule is a fall-through. So a mutating route whose path matches
//! none of the earlier arms lands on `SUPERVISOR` silently, and a GET lands on
//! `CASHIER` — which is how an admin surface can be added without anybody
//! choosing that it should be reachable by a cashier. Recording the answer here
//! makes that choice visible in review rather than in an audit months later.
//!
//! Two honest limits. The centre's *public* paths (`/api/v1/health`,
//! `/api/v1/auth/login`, `/api/v1/sync/ingest`, `/metrics`, and the shopper's
//! `/api/v1/member/…`) are gated before `required_role` is consulted, so the
//! role shown for them is the answer to a question nobody asks. And the edges
//! decide permission inside each handler, from a `EdgePermission` that no
//! `(method, path)` function can predict — so their rows carry no role, and
//! `require_permission` remains the only place that says.
//!
//! To update after adding a route: `BLESS_ROUTES=1 cargo test --test
//! route_catalog`, then read the diff before committing it.

use inventory_backend::cloud::domain::{
    declared_subject_of, record_kind_of, required_role, DECLARED_BY_HANDLER,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn repository() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn catalogue_path() -> PathBuf {
    repository().join("tests/testdata/routes.json")
}

fn read(relative: &str) -> String {
    let path = repository().join(relative);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

/// Whole-line comments, removed.
///
/// The files below discuss their own routes in prose — including, in places, by
/// writing `.route(` in a comment to explain what a block does. Reading those
/// as routes would put paths in the catalogue that the server does not serve.
fn code_only(source: &str) -> String {
    source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The body of one router-building function: from its signature to the next
/// item that starts at column zero.
///
/// Bounded rather than "to the end of the file" because `edge/http.rs` builds
/// three routers, and a route attributed to the wrong one is worse than an
/// uncounted route: it claims a shop serves something only the warehouse does.
fn function_body<'a>(source: &'a str, signature: &str) -> &'a str {
    let start = source.find(signature).unwrap_or_else(|| {
        panic!(
            "`{signature}` is not in this file any more, so the catalogue \
             cannot tell which node its routes belong to. If the function was \
             renamed, rename it here too."
        )
    });
    let rest = &source[start + signature.len()..];
    let end = ["\nfn ", "\npub fn ", "\npub(crate) fn ", "\nasync fn "]
        .iter()
        .filter_map(|marker| rest.find(marker))
        .min()
        .unwrap_or(rest.len());
    &rest[..end]
}

/// Every `const NAME: &str = "…";` the crate declares.
///
/// Needed because a route may name its path with a constant rather than a
/// literal — `RFID_OBSERVATION_PATH` does, because the handheld signs that
/// exact string into its HMAC and the two must not be able to drift. A scanner
/// that only reads literals does not fail on such a route; it takes the *next*
/// route's path by mistake and drops one endpoint without saying so. That is
/// how `POST /api/v1/rfid/observations` went missing from the first draft of
/// this catalogue.
fn string_constants() -> BTreeMap<String, String> {
    fn walk(directory: &Path, into: &mut BTreeMap<String, String>) {
        let entries = std::fs::read_dir(directory)
            .unwrap_or_else(|error| panic!("cannot read {}: {error}", directory.display()));
        for entry in entries {
            let entry = entry.unwrap_or_else(|error| panic!("cannot read an entry: {error}"));
            let path = entry.path();
            if path.is_dir() {
                walk(&path, into);
                continue;
            }
            if path.extension().is_none_or(|extension| extension != "rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()));
            for line in source.lines() {
                let line = line.trim();
                let Some(rest) = line
                    .strip_prefix("pub const ")
                    .or_else(|| line.strip_prefix("const "))
                    .or_else(|| line.strip_prefix("pub(crate) const "))
                else {
                    continue;
                };
                let Some((name, value)) = rest.split_once(": &str = ") else {
                    continue;
                };
                let value = value.trim().trim_end_matches(';');
                if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
                    into.insert(
                        name.trim().to_string(),
                        value[1..value.len() - 1].to_string(),
                    );
                }
            }
        }
    }

    let mut found = BTreeMap::new();
    walk(&repository().join("src"), &mut found);
    found
}

/// Every `(METHOD, pattern)` declared by a chain of `.route(...)` calls.
///
/// Written by hand rather than with a regex because the calls wrap: roughly
/// half of them put the path on its own line and the handlers on the next, and
/// a line-oriented match sees only the short ones. Depth counting from the
/// `.route(` parenthesis is what makes `get(a).post(b)` one route with two
/// methods instead of two routes.
fn routes_in(body: &str, constants: &BTreeMap<String, String>) -> Vec<(String, String)> {
    const VERBS: [&str; 7] = ["get", "post", "put", "patch", "delete", "head", "options"];

    let mut found = Vec::new();
    let mut cursor = 0usize;
    while let Some(offset) = body[cursor..].find(".route(") {
        let open = cursor + offset + ".route(".len();
        let argument = body[open..].trim_start();
        let skipped = body[open..].len() - argument.len();

        // Either a literal or a named constant. Anything else is a path this
        // file cannot resolve, and guessing is what loses a route quietly.
        let (pattern, handlers_from) = if argument.starts_with('"') {
            let pattern_start = open + skipped + 1;
            let Some(len) = body[pattern_start..].find('"') else {
                break;
            };
            (
                body[pattern_start..pattern_start + len].to_string(),
                pattern_start + len + 1,
            )
        } else {
            let name: String = argument
                .chars()
                .take_while(|character| character.is_alphanumeric() || *character == '_')
                .collect();
            let resolved = constants.get(&name).unwrap_or_else(|| {
                panic!(
                    "a route names its path `{name}`, which is not a literal \
                     and not a `const … : &str` this scanner could find. Add \
                     the constant, or the catalogue will silently omit the \
                     route it serves."
                )
            });
            (resolved.clone(), open + skipped + name.len())
        };
        let pattern = pattern.as_str();

        // Walk to the parenthesis that closes `.route(`, so the handler
        // expression is bounded even when it nests.
        let mut depth = 1i32;
        let mut end = handlers_from;
        for (index, character) in body[handlers_from..].char_indices() {
            match character {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = handlers_from + index;
                        break;
                    }
                }
                _ => {}
            }
        }
        let handlers = &body[handlers_from..end];

        for verb in VERBS {
            let mut at = 0usize;
            while let Some(hit) = handlers[at..].find(verb) {
                let start = at + hit;
                let after = start + verb.len();
                let opens = handlers[after..].starts_with('(');
                // `get` inside `budget(` or `forget(` is not a method.
                let standalone = start == 0
                    || !handlers[..start]
                        .chars()
                        .next_back()
                        .is_some_and(|character| character.is_alphanumeric() || character == '_');
                if opens && standalone {
                    found.push((verb.to_ascii_uppercase(), pattern.to_string()));
                }
                at = after;
            }
        }

        cursor = end.max(handlers_from);
    }

    found.sort();
    found.dedup();
    found
}

/// Whether a request to this route is recorded in the activity log.
fn is_write(method: &str) -> bool {
    matches!(method, "POST" | "PATCH" | "PUT" | "DELETE")
}

/// One line per route, in the committed file's shape.
fn render(node: &str, routes: &[(String, String)], with_role: bool) -> Vec<String> {
    routes
        .iter()
        .map(|(method, pattern)| {
            // Which record this route's activity is filed under. `-` on a
            // write is the interesting value: it says the log will record that
            // somebody did this and not what they did it to, so the record's
            // own sheet will never show it. That is right for a route that
            // acts on no record and wrong for one that does, and the only way
            // to tell them apart is a person reading this column.
            //
            // Reads are `-` by definition: nothing is recorded for a GET.
            let subject = if !is_write(method) {
                "-"
            } else if let Some(declared) = declared_subject_of(method, pattern) {
                // The handler's answer, which overrules the route's: it is the
                // one that knows the id of a record that has just been made.
                declared.map_or("handler", |kind| kind.as_str())
            } else {
                record_kind_of(pattern).map_or("-", |(kind, _)| kind.as_str())
            };
            if with_role {
                // The one family whose role is not a property of the path.
                // `required_role` delegates it to the record named in the URL,
                // so asking about the PATTERN — where `{kind}` is a literal
                // brace — yields the unreadable-kind answer, ADMIN. Printing
                // that would be wrong for fifty-six of the fifty-seven kinds
                // and would read as a decision somebody made.
                let role = if pattern.starts_with("/api/v1/records/") {
                    "PerRecord".to_owned()
                } else {
                    format!("{:?}", required_role(method, pattern))
                };
                format!("{node}\t{method}\t{pattern}\t{role}\t{subject}")
            } else {
                // The edges keep no activity log at all, so the column is not
                // an omission there — there is nothing for it to say.
                format!("{node}\t{method}\t{pattern}\t-\t-")
            }
        })
        .collect()
}

fn scan() -> Vec<String> {
    let cloud_http = code_only(&read("src/cloud/http/mod.rs"));
    let cloud_media = code_only(&read("src/cloud/media.rs"));
    let edge_http = code_only(&read("src/edge/http.rs"));

    let mut lines = Vec::new();

    let constants = string_constants();

    let mut cloud = routes_in(
        function_body(&cloud_http, "pub fn router(state: AppState)"),
        &constants,
    );
    cloud.extend(routes_in(
        function_body(&cloud_media, "pub fn router()"),
        &constants,
    ));
    cloud.sort();
    cloud.dedup();
    lines.extend(render("cloud", &cloud, true));

    // `dc_router` and `dc_router_with_auth` only forward; the chain is built in
    // `_with_sync`, and reading the wrapper instead yields a node with no
    // routes at all — which is why `every_node_serves_something` exists below.
    for (node, signature) in [
        ("dc", "pub fn dc_router_with_sync("),
        ("store", "pub fn store_router_with_sync("),
        ("edge-common", "fn common_router()"),
    ] {
        let routes = routes_in(function_body(&edge_http, signature), &constants);
        lines.extend(render(node, &routes, false));
    }

    lines
}

/// Guards the scanner, not the estate.
///
/// The first version of this file read `pub fn dc_router(`, which is a wrapper
/// that forwards to the function holding the chain. It scanned cleanly, wrote a
/// catalogue, and passed — with every warehouse and shop route missing. A total
/// that only has to be "large" cannot notice that, because the centre alone is
/// large enough. So each node is asserted to serve something.
#[test]
fn every_node_serves_something() {
    let scanned = scan();
    for node in ["cloud", "dc", "store", "edge-common"] {
        let count = scanned
            .iter()
            .filter(|line| line.starts_with(&format!("{node}\t")))
            .count();
        assert!(
            count > 0,
            "the scanner found no routes for `{node}`, which cannot be true. \
             The router-building function it reads has probably been renamed \
             or split, so it is now reading a wrapper that only forwards."
        );
    }
}

#[test]
fn the_committed_catalogue_still_matches_the_routers() {
    let scanned = scan();
    assert!(
        scanned.len() > 300,
        "the scanner found only {} routes, which is too few to be this \
         estate — the router functions have probably been reshaped in a way \
         the parser no longer reads. Fix the parser rather than blessing this.",
        scanned.len()
    );

    let body = format!("{}\n", scanned.join("\n"));
    let path = catalogue_path();

    if std::env::var("BLESS_ROUTES").is_ok() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .unwrap_or_else(|error| panic!("cannot create {}: {error}", parent.display()));
        }
        std::fs::write(&path, &body)
            .unwrap_or_else(|error| panic!("cannot write {}: {error}", path.display()));
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "cannot read {}: {error}\n\n\
             If this is the first run, write it with:\n  \
             BLESS_ROUTES=1 cargo test --test route_catalog",
            path.display()
        )
    });

    let committed: Vec<&str> = committed.lines().filter(|line| !line.is_empty()).collect();
    let added: Vec<&String> = scanned
        .iter()
        .filter(|line| !committed.contains(&line.as_str()))
        .collect();
    let removed: Vec<&&str> = committed
        .iter()
        .filter(|line| !scanned.iter().any(|scanned| scanned == *line))
        .collect();

    assert!(
        added.is_empty() && removed.is_empty(),
        "the served routes and the committed catalogue disagree.\n\n\
         Serving but not in the file ({}):\n{}\n\n\
         In the file but not served ({}):\n{}\n\n\
         Columns are node, method, pattern, role, record. Check the role on \
         anything new that mutates: `required_role` falls through to \
         SUPERVISOR, so a route can be reachable by more people than its \
         author intended. Check the record too: a `-` on a write means the \
         activity log will record the act and not the thing it was done to, \
         so the record's own sheet will never show it — add the route to \
         `ROUTE_SUBJECTS` in `cloud::domain::record`, or have the handler \
         declare it. Then update the file with:\n  \
         BLESS_ROUTES=1 cargo test --test route_catalog",
        added.len(),
        added
            .iter()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
        removed.len(),
        removed
            .iter()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
}

/// The handler-declared list is an allowlist, and an allowlist has to be
/// guarded or it rots into a blindfold — the same reasoning as `RESERVED` in
/// `migration_hygiene` and the matrix in `write_authority`.
///
/// A line naming a route that no longer exists is worse than no line: it makes
/// the catalogue claim a subject is declared somewhere, on a route nobody
/// serves, while the route it was renamed to shows `-` and looks deliberate.
#[test]
fn every_handler_declared_route_is_one_this_estate_serves() {
    let scanned = scan();
    let served: Vec<(String, String)> = scanned
        .iter()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let node = columns.next()?;
            let method = columns.next()?;
            let pattern = columns.next()?;
            (node == "cloud").then(|| (method.to_owned(), pattern.to_owned()))
        })
        .collect();

    let stale: Vec<String> = DECLARED_BY_HANDLER
        .iter()
        .filter(|(method, pattern, _)| !served.iter().any(|(m, p)| m == method && p == pattern))
        .map(|(method, pattern, _)| format!("  {method} {pattern}"))
        .collect();

    assert!(
        stale.is_empty(),
        "`DECLARED_BY_HANDLER` names {} route(s) the centre does not serve:\n{}\n\n\
         Either the route was renamed — in which case rename it there too, and \
         check the handler still declares its subject — or the line is left \
         over from a route that was removed.",
        stale.len(),
        stale.join("\n"),
    );
}
