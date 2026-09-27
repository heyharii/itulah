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
        256,
        256,
        "held for the head-office rename, and NOT free. `9b273f83` set that \
         lane's work aside because it lands a migration that folds `dc` and \
         `dc-01` into one `ho` site and refuses `dc` as a site id — which \
         every demo rig still uses. The migration never landed, but eight \
         comments in `src` already cite `0256` as the one that renamed the \
         site (`ledger`, `letters`, `sync`, `queries`). A different file here \
         would make all eight of them lie. It was briefly taken by a renumber \
         on 2026-09-15 and given back; the file that took it is 0258",
    ),
    (
        109,
        109,
        "one number the finance lane stepped over while it filled what had been \
         the asset lane's block — see the entry below. 0108 landed and 0110 was \
         next, in the hours two branches were both filing files in here",
    ),
    (
        149,
        150,
        "the last two holes in what was the asset lane's block, and the record \
         of how that block was settled. 146115e filed a statement-intake \
         migration at 0106 on 2026-09-09 and jumped to 0159 rather than crowd \
         the next number — but the finance lane had taken 0106 three days \
         earlier on its own branch and went on to fill 0107-0158 from there. \
         When the two met, the newer file was renumbered: the statement intake \
         is 0142 and the staff-purchase migration that had landed at 0107 is \
         0256. These two numbers nobody ever filed",
    ),
    (
        183,
        189,
        "left to the lanes already in flight on this branch — several of them \
         have uncommitted files in the 0160s and 0170s. The records \
         vocabulary took a distant block at 0190 rather than crowd the next \
         number, which is the convention this table exists to record",
    ),
    (
        203,
        209,
        "the letters lane again: 0200 landed, 0201 and 0202 were already the \
         payment-terms lane's, so the blank-letter migration took 0210 rather \
         than crowd the next number while three lanes were still filing files \
         in the 0160s-0190s",
    ),
    (
        193,
        199,
        "left to the lanes working beside the letters one on 2026-09-13 — the \
         records vocabulary had just landed 0190-0192 and was still moving. \
         Letters took 0200 rather than 0193 for the reason at the top of this \
         file: two lanes reading the directory at the same moment pick the \
         same next number",
    ),
    (
        171,
        172,
        "never filed by anybody, and verified so: `git log --all` over \
         `0171*` and `0172*` returns nothing, so these are not files somebody \
         lost — they are two numbers a lane stepped over on 2026-09-12 while \
         the promotion and markdown work was landing in the 0170s, and never \
         wrote down. Recorded rather than reused, because the point of this \
         table is that the next reader can tell a deliberate hole from a \
         missing table",
    ),
    (
        224,
        229,
        "the People lane, 2026-09-13. It took 0230 for the reason every block \
         above it was taken: the giro and banking lanes were filing files in \
         the 0210s-0220s in the same hour, and a lane that claims the next \
         number claims the one somebody else is already writing",
    ),
    (
        321,
        339,
        "a block the branch skipped: several lanes were filing migrations in the \
         same hours and the HRMS phases claimed a distant block (0340-0379) \
         rather than these numbers. No file was ever written here, and the gap \
         is declared so the next reader can tell it from a lost file — the \
         scanner that guards this list cannot",
    ),
    (
        340,
        379,
        "the HRMS phase block, claimed the way the records vocabulary claimed \
         0190: several lanes were in flight on the branch at once, so the \
         phases took a distant block rather than the next number. Phase 1 \
         (org structure) holds 0340 and phase 2 (expense claims) filed 0341 \
         and 0342; the rest of the block is held for the phases that follow",
    ),
    (
        400,
        459,
        "left to the other lanes in flight on 27 Sep 2026 (about a dozen \
         sessions were writing migrations at once) when the finance-foundation \
         lane claimed 0460 onward for account links and the chart editor",
    ),
    (
        478,
        489,
        "left to the lanes in flight on 27 Sep 2026 when the discussion lane \
         claimed 0490: the chat lane had filed 0476 in the same minute the \
         discussion migration was written as 0476, so it moved to a distant \
         number rather than race for the next one (the finance-foundation \
         lane then took 0477)",
    ),
    (
        491,
        499,
        "left to the discussion lane, which had just claimed 0490, when the \
         assistant lane took a distant 0500 for its cost ceiling on 27 Sep 2026 \
         rather than race for the next number",
    ),
    (
        503,
        519,
        "held open between the assistant lane (0500 cost ceiling, 0501 verdicts \
         and glossary, 0502 morning brief) and the setup lane, which claimed \
         0520 in the same hours of 27 Sep 2026",
    ),
    (
        522,
        599,
        "left to the lanes in flight on 27 Sep 2026 when the unit/site lane \
         claimed 0600 onward: its three steps had been written as 0450-0452, \
         0474 and 0475 on separate branches while other sessions already held \
         0474-0477, 0490, 0500 and 0520-0521 uncommitted, so the whole lane \
         moved to a distant block rather than race for the next numbers",
    ),
    (
        614,
        614,
        "left unused by the unit/site lane's goods-routes step, which was given \
         0610-0614 on 27 Sep 2026 and needed four numbers; the books step filled \
         0605-0609 and the flow-template engine 0615-0619",
    ),
    (
        621,
        622,
        "held for the unit/site lane's other steps in flight on 27 Sep 2026 when \
         the device step was given 0623-0624 (the RFID key's kind and the \
         terminals head office registers, in the device register)",
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

/// The vocabulary of records exists twice — once as `RecordKind` in
/// `cloud::domain::record`, once as rows in `record_kind` — and the two have to
/// agree or the estate has the old problem back in a new shape.
///
/// Comparing them needs no database: the rows are seeded by migrations, and a
/// migration is a file. So this reads every `INSERT INTO record_kind` in the
/// folder and checks the union against the enum.
///
/// **Every file, not just 0190.** The first version of this read the seed in
/// 0190 alone, which quietly made that file the only place a kind could be
/// added — and adding one there is exactly what must not happen once it has
/// been applied. 0192 is a kind added the right way, in a file of its own, and
/// a test that could not see it would have argued for editing history instead.
///
/// It fails in the direction that matters. A kind added in Rust and not in a
/// migration compiles, passes every unit test, and then rejects every write
/// against it at runtime with a foreign key violation — on the one surface
/// whose whole job is to record what happened.
#[test]
fn the_record_vocabulary_is_the_same_in_rust_and_in_the_database() {
    use inventory_backend::cloud::domain::RecordKind;

    let mut seeded: Vec<String> = Vec::new();
    for (_, name) in migration_files("postgres") {
        let sql = std::fs::read_to_string(migrations_dir("postgres").join(&name))
            .unwrap_or_else(|error| panic!("cannot read {name}: {error}"));
        let mut rest = sql.as_str();
        while let Some(at) = rest.find("INSERT INTO record_kind") {
            let block = &rest[at..];
            let end = block.find(";\n").unwrap_or(block.len());
            // Every `('<code>', …)` tuple, however the insert is laid out.
            //
            // It used to read only lines that OPEN with a tuple, which is the
            // common style (`VALUES\n    ('article', 'Article'),\n…`) — and it
            // silently missed an insert whose single tuple sits on the same
            // line as `VALUES` (`VALUES ('contract', 'Contract')`). A missing
            // file and a missed tuple look identical from here, so the scanner
            // must not depend on where somebody put the newline.
            let mut cursor = &block[..end];
            while let Some(open) = cursor.find("('") {
                let after = &cursor[open + 2..];
                if let Some(close) = after.find('\'') {
                    seeded.push(after[..close].to_owned());
                }
                cursor = after;
            }
            rest = &block[end.min(block.len())..];
        }
    }

    let declared: Vec<String> = RecordKind::ALL
        .iter()
        .map(|kind| kind.as_str().to_owned())
        .collect();

    let missing: Vec<&String> = declared.iter().filter(|k| !seeded.contains(k)).collect();
    let extra: Vec<&String> = seeded.iter().filter(|k| !declared.contains(k)).collect();

    assert!(
        missing.is_empty() && extra.is_empty(),
        "`RecordKind` and the `record_kind` rows disagree.\n\n\
         In Rust but not seeded ({}): {:?}\n\
         Seeded but not in Rust ({}): {:?}\n\n\
         A kind that exists only in Rust compiles and then fails at runtime \
         with a foreign key violation on the audit log. Add it in a NEW \
         migration — never by editing one that has been applied, which is a \
         checksum mismatch and a node that will not start.",
        missing.len(),
        missing,
        extra.len(),
        extra,
    );
}
