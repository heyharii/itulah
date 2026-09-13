//! The acceptance-scenario harness for Commercial V1.
//!
//! # What this is for
//!
//! `docs/commercial-v1-acceptance-test-plan.md` locks 200 named scenarios and
//! declares every one of them NOT_RUN. A suite that answered that document
//! with the word `ok` would be worse than no suite at all: it would look like
//! coverage. So this harness reports the plan's own matrix back, row by row,
//! and says of each row whether there is a test behind it, whether that test
//! passes, and — when there is not — precisely what is in the way.
//!
//! Three things follow from that, and they are the whole design:
//!
//! 1. **Scenarios are data.** [`plan::PLAN`] is the 200 rows, transcribed
//!    mechanically from the document. [`checks`] says which of them this
//!    harness can prove. The runner joins the two, so a row nobody has written
//!    a test for is *visible* rather than absent. A table of ad-hoc `#[test]`
//!    functions cannot do that: what is missing from it leaves no trace.
//!
//! 2. **The numbers come from the locked fixtures**, read at run time from
//!    `docs/fixtures/commercial-v1-golden-fixtures.json`. See
//!    [`fixtures::Fixtures`] for why they are not copied into Rust literals.
//!
//! 3. **Scenarios that already exist are adopted, not rewritten.** Several of
//!    the engine's tests are golden scenarios in all but name. Copying their
//!    arithmetic here would create a second expected value that agrees today
//!    and drifts later. Instead [`Check::Adopted`] names the test that owns
//!    the scenario and proves it still exists — so deleting or renaming it
//!    breaks this harness, which is the only property a link like that is
//!    worth having.
//!
//! # Reading the output
//!
//! The report prints on every run, pass or fail. It is written straight to the
//! process's stdout rather than through `println!`, because libtest captures
//! the print macros and shows them only for tests that FAIL — which would hide
//! the coverage summary in exactly the case it is wanted: a green run where
//! most of the plan is still unproven.
//!
//! # What a failure means
//!
//! A row reported FAIL is a defect in the kernel, not in the fixture. The
//! expected values here were computed away from this code and frozen before
//! it was read. Nothing in this harness may be adjusted to make a FAIL go
//! away; the number is the contract.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Write as _;

// Spelled with `#[path]` because this file is the test crate's ROOT, so a bare
// `mod fixtures;` would look for `tests/fixtures.rs` — which Cargo would then
// pick up as a test target of its own and try to run.
#[path = "acceptance/fixtures.rs"]
mod fixtures;
#[path = "acceptance/plan.rs"]
mod plan;
#[path = "acceptance/pricing.rs"]
mod pricing;
#[path = "acceptance/settlement.rs"]
mod settlement;

use fixtures::Fixtures;

// ---------------------------------------------------------------------------
// What a scenario can be
// ---------------------------------------------------------------------------

/// How one plan row is answered.
pub enum Check {
    /// Run here, now, against the real kernel.
    Run(fn(&Fixtures) -> Outcome),
    /// Already locked by a test that owns this scenario. Carries the file it
    /// lives in and the name it goes by, and the runner proves the name is
    /// still there — a link that did not do that would rot silently.
    Adopted {
        owner: Owner,
        test: &'static str,
        /// Why this test IS the scenario, in one line. Without it an adopted
        /// row is an assertion of coverage with nothing behind it.
        because: &'static str,
    },
    /// The kernel has no way to express what the plan asks for. Not a defect
    /// and not an excuse: it is the shape of a gap, and naming it is the
    /// difference between "untested" and "untestable as built".
    NoKernelSurface { note: &'static str },
    /// The plan names the case but states no expected value this harness could
    /// assert without inventing one. `needed` says what the owner would have
    /// to restate.
    NotSpecified { needed: &'static str },
    /// Not written, and the reason its LEVEL would give is wrong.
    ///
    /// Counted as NOT_ENCODED like any unwritten row — it is not a different
    /// kind of coverage — but carrying its own note. The plan marks several
    /// rows UNIT that this estate implements in SQL or behind a private
    /// function, and reporting those as "reachable from this harness" would
    /// send somebody to write a test that cannot be written.
    OutOfReach { note: &'static str },
}

/// Which file owns an adopted scenario.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Owner {
    PricingEngine,
    Refund,
    Checkout,
    Tender,
}

impl Owner {
    fn source(self) -> &'static str {
        // Included so that the link to an adopted test is checked by the
        // compiler's own file reading rather than by a path that might be
        // wrong. A moved file stops the build; a renamed test fails the run.
        match self {
            Self::PricingEngine => include_str!("../crates/pricing-engine/src/tests.rs"),
            Self::Refund => include_str!("../src/refund.rs"),
            Self::Checkout => include_str!("../src/checkout.rs"),
            Self::Tender => include_str!("../src/tender.rs"),
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::PricingEngine => "backend/crates/pricing-engine/src/tests.rs",
            Self::Refund => "backend/src/refund.rs",
            Self::Checkout => "backend/src/checkout.rs",
            Self::Tender => "backend/src/tender.rs",
        }
    }
}

/// What one scenario's run came to. Every mismatch is collected rather than
/// stopping at the first, because a report that named one wrong figure out of
/// four would send somebody looking for one bug where there are four.
pub type Outcome = Result<(), Vec<String>>;

/// Collects mismatches so a scenario can report all of them at once.
pub struct Expect {
    misses: Vec<String>,
}

impl Default for Expect {
    fn default() -> Self {
        Self::new()
    }
}

impl Expect {
    pub fn new() -> Self {
        Self { misses: Vec::new() }
    }

    /// Assert one figure, naming what it is in the shop's words.
    ///
    /// Returns nothing on purpose. A builder that handed `&mut self` back
    /// would read as chainable, and a chain is the one shape that makes it
    /// easy to write an assertion whose result is silently discarded in a
    /// `match` arm.
    pub fn eq<T: std::fmt::Debug + PartialEq>(&mut self, what: &str, got: T, want: T) {
        if got != want {
            self.misses
                .push(format!("{what}: expected {want:?}, kernel gave {got:?}"));
        }
    }

    pub fn that(&mut self, what: &str, held: bool) {
        if !held {
            self.misses.push(format!("{what}: did not hold"));
        }
    }

    /// Fold in a step that could not even be attempted.
    pub fn note(&mut self, trouble: String) {
        self.misses.push(trouble);
    }

    pub fn finish(self) -> Outcome {
        if self.misses.is_empty() {
            Ok(())
        } else {
            Err(self.misses)
        }
    }
}

/// Unwrap a fallible fixture step inside a scenario, turning the error into a
/// reported miss instead of a panic.
#[macro_export]
macro_rules! got {
    ($expect:expr, $step:expr) => {
        match $step {
            Ok(value) => value,
            Err(trouble) => {
                $expect.note(trouble.to_string());
                return $expect.finish();
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Status {
    Pass,
    Fail,
    Adopted,
    NoSurface,
    NotSpecified,
    NotEncoded,
}

impl Status {
    fn short(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::Adopted => "ADOPT",
            Self::NoSurface => "NOSURF",
            Self::NotSpecified => "NOSPEC",
            Self::NotEncoded => "NOTENC",
        }
    }
}

impl Status {
    /// Its column in the report. A `match` rather than a search through
    /// [`ORDER`], so adding a status without giving it a column stops the
    /// build instead of quietly counting it as a pass.
    fn column(self) -> usize {
        match self {
            Self::Pass => 0,
            Self::Fail => 1,
            Self::Adopted => 2,
            Self::NoSurface => 3,
            Self::NotSpecified => 4,
            Self::NotEncoded => 5,
        }
    }
}

const ORDER: [Status; 6] = [
    Status::Pass,
    Status::Fail,
    Status::Adopted,
    Status::NoSurface,
    Status::NotSpecified,
    Status::NotEncoded,
];

struct Verdict {
    status: Status,
    /// One line a person can act on: what failed, what is missing, or which
    /// test carries the scenario.
    detail: String,
}

/// Why a row nobody has encoded is not encoded, as far as its level can say.
///
/// Derived from the plan's own Level column rather than written out per row.
/// A row this harness could have proven and has not is a gap in the harness,
/// and it must not read the same as a row that needs Postgres and a card
/// terminal — the first is work, the second is a different kind of test.
fn why_not_encoded(level: &'static str) -> &'static str {
    match level {
        "UNIT" | "PROP" => "no test written yet — reachable from this harness",
        "INT" => "needs a real Postgres/SQLite adapter",
        "RACE" => "needs two overlapping sessions and a barrier",
        "FAULT" => "needs fault injection at a named boundary",
        "E2E" => "needs the whole stack, provider simulator included",
        "PERF" => "needs the recorded target hardware",
        other => other,
    }
}

fn run_all(fixtures: &Fixtures) -> BTreeMap<&'static str, Verdict> {
    let mut checks: BTreeMap<&'static str, Check> = BTreeMap::new();
    for (id, check) in pricing::checks() {
        if checks.insert(id, check).is_some() {
            panic!("{id} is answered twice; one scenario, one answer");
        }
    }
    for (id, check) in settlement::checks() {
        if checks.insert(id, check).is_some() {
            panic!("{id} is answered twice; one scenario, one answer");
        }
    }

    // A check for a scenario the plan does not contain is a typo in an id, and
    // it would otherwise sit there proving something nobody asked for.
    for id in checks.keys() {
        if !plan::PLAN.iter().any(|row| row.id == *id) {
            panic!("{id} is not a scenario in the locked plan");
        }
    }

    let mut verdicts = BTreeMap::new();
    for row in plan::PLAN {
        let verdict = match checks.remove(row.id) {
            Some(Check::Run(body)) => match body(fixtures) {
                Ok(()) => Verdict {
                    status: Status::Pass,
                    detail: String::new(),
                },
                Err(misses) => Verdict {
                    status: Status::Fail,
                    detail: misses.join("; "),
                },
            },
            Some(Check::Adopted {
                owner,
                test,
                because,
            }) => {
                let needle = format!("fn {test}(");
                if owner.source().contains(&needle) {
                    Verdict {
                        status: Status::Adopted,
                        detail: format!("{}::{test} — {because}", owner.path()),
                    }
                } else {
                    Verdict {
                        status: Status::Fail,
                        detail: format!(
                            "this scenario is claimed by {}::{test}, and no such test is in \
                             that file any more",
                            owner.path()
                        ),
                    }
                }
            }
            Some(Check::NoKernelSurface { note }) => Verdict {
                status: Status::NoSurface,
                detail: note.to_string(),
            },
            Some(Check::NotSpecified { needed }) => Verdict {
                status: Status::NotSpecified,
                detail: needed.to_string(),
            },
            Some(Check::OutOfReach { note }) => Verdict {
                status: Status::NotEncoded,
                detail: note.to_string(),
            },
            None => Verdict {
                status: Status::NotEncoded,
                detail: why_not_encoded(row.level).to_string(),
            },
        };
        verdicts.insert(row.id, verdict);
    }
    verdicts
}

// ---------------------------------------------------------------------------
// Defects already found
// ---------------------------------------------------------------------------

/// Scenarios the kernel fails today, each with the defect in one line.
///
/// This is a register, not an excuse list, and it is load-bearing in BOTH
/// directions. A failure that is not on it turns the suite red, so a new
/// defect cannot arrive unnoticed. And an entry that stops failing ALSO turns
/// the suite red, so a defect somebody fixed has to be struck off deliberately
/// — which is the only way a list like this avoids decaying into a permanent
/// apology nobody reads.
///
/// Nothing here is suppressed. Every one of these still prints as FAIL, still
/// counts as FAIL in every matrix, and is written up in
/// `ACCEPTANCE-COVERAGE.md`. The register decides only whether the suite is a
/// usable gate for the NEXT change, not whether the defect is visible.
///
/// The fixture numbers are the contract. None of these is to be closed by
/// editing an expected value.
const KNOWN_DEFECTS: &[(&str, &str)] = &[
    (
        "MON-008",
        "discount conservation (INV-03) breaks on small baskets: three Rp1 lines less \
         Rp2 charges Rp2 and reports a Rp2 discount, so the receipt claims a rupiah it \
         never took off. `discount_total` is the benefit the rule intended rather than \
         the sum of what reached the lines",
    ),
    (
        "COM-007",
        "D03 fixes the basket qualification snapshot after the line stage and keeps it \
         fixed for every basket promotion. The kernel re-measures each one against what \
         the previous basket offer left, so a second offer wanting Rp550.000 of a \
         Rp600.000 basket is refused AmountTooLow once the first has taken Rp100.000 off",
    ),
    (
        "BXY-004",
        "D01 breaks ties on reward selection by stable unit ID. The kernel breaks them by \
         cart position, so which of two equally-priced units is the free one — and \
         therefore what each is worth on a return — depends on the order they were \
         scanned in",
    ),
    (
        "PRP-003",
        "the largest-remainder tie-break on basket allocation follows cart position, not \
         stable unit ID as D11 requires. Permuting the cart moves a rupiah between two \
         lines; the basket total is unchanged, so this is invisible until one of those \
         lines is returned on its own",
    ),
];

fn known_defect(id: &str) -> Option<&'static str> {
    KNOWN_DEFECTS
        .iter()
        .find(|(known, _)| *known == id)
        .map(|(_, note)| *note)
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

fn tally<'a>(
    rows: impl Iterator<Item = (&'a plan::Row, &'a Verdict)>,
    key: impl Fn(&plan::Row) -> &'static str,
) -> BTreeMap<&'static str, [usize; 6]> {
    let mut counts: BTreeMap<&'static str, [usize; 6]> = BTreeMap::new();
    for (row, verdict) in rows {
        let slot = counts.entry(key(row)).or_default();
        slot[verdict.status.column()] += 1;
    }
    counts
}

fn matrix(out: &mut String, title: &str, first: &str, counts: &BTreeMap<&'static str, [usize; 6]>) {
    let _ = writeln!(out, "\n{title}");
    let _ = write!(out, "  {first:<10}");
    for status in ORDER {
        let _ = write!(out, "{:>8}", status.short());
    }
    let _ = writeln!(out, "{:>8}", "TOTAL");
    for (name, slot) in counts {
        let _ = write!(out, "  {name:<10}");
        for count in slot {
            let _ = write!(out, "{count:>8}");
        }
        let _ = writeln!(out, "{:>8}", slot.iter().sum::<usize>());
    }
    let mut total = [0usize; 6];
    for slot in counts.values() {
        for (into, from) in total.iter_mut().zip(slot) {
            *into += from;
        }
    }
    let _ = write!(out, "  {:<10}", "ALL");
    for count in total {
        let _ = write!(out, "{count:>8}");
    }
    let _ = writeln!(out, "{:>8}", total.iter().sum::<usize>());
}

fn report(verdicts: &BTreeMap<&'static str, Verdict>) -> String {
    let paired = || {
        plan::PLAN
            .iter()
            .filter_map(|row| verdicts.get(row.id).map(|verdict| (row, verdict)))
    };
    let mut out = String::new();
    let _ = writeln!(
        out,
        "\n\
         ===========================================================================\n\
         Commercial V1 — acceptance coverage\n\
         plan: docs/commercial-v1-acceptance-test-plan.md (200 scenarios, baseline 1.0)\n\
         expected values: docs/fixtures/commercial-v1-golden-fixtures.json\n\
         ==========================================================================="
    );

    matrix(
        &mut out,
        "By locked decision (the plan's own Aturan column; `—` is its mark for \
         the common contract)",
        "DECISION",
        &tally(paired(), |row| row.decision),
    );
    let group_of = |row: &plan::Row| row.id.split('-').next().unwrap_or(row.id);
    let groups = tally(paired(), group_of);
    matrix(&mut out, "By group", "GROUP", &groups);
    // The three-letter prefixes are the plan's, and they are opaque on their
    // own. Spelled out here so the matrix above can be read without the
    // document open beside it.
    let _ = writeln!(&mut out, "  ---");
    for name in groups.keys() {
        let _ = writeln!(&mut out, "  {name:<10}{}", plan::group_name(name));
    }
    matrix(
        &mut out,
        "By level (what a row would take to prove)",
        "LEVEL",
        &tally(paired(), |row| row.level),
    );
    matrix(
        &mut out,
        "By priority",
        "PRIORITY",
        &tally(paired(), |row| row.priority),
    );

    // Both sections below print the plan's own `must_prove` beside the verdict.
    // Without it a reader has to hold the document open to know what a failing
    // or unreachable row actually demanded, and the commonest way a report like
    // this gets misread is somebody assuming the requirement is narrower than
    // it is.
    let section = |out: &mut String, status: Status, heading: &str, blurb: &str| {
        let hits: Vec<_> = paired()
            .filter(|(_, verdict)| verdict.status == status)
            .collect();
        if hits.is_empty() {
            return;
        }
        let _ = writeln!(out, "\n{heading} ({})", hits.len());
        let _ = writeln!(out, "  {blurb}");
        for (row, verdict) in hits {
            let _ = writeln!(out, "\n  {} [{}] {}", row.id, row.decision, row.scenario);
            let _ = writeln!(out, "      plan requires: {}", row.must_prove);
            let _ = writeln!(out, "      this run:      {}", verdict.detail);
        }
    };

    section(
        &mut out,
        Status::Fail,
        "!!! FAILED — these are defects in the kernel, not in the fixtures",
        "The expected values were computed away from this code and frozen. Do not edit \
         them. Each is written up in ACCEPTANCE-COVERAGE.md.",
    );
    section(
        &mut out,
        Status::NoSurface,
        "NO KERNEL SURFACE — the plan locks an outcome the kernel cannot express",
        "Each of these needs a change to the kernel before a test can even be \
         written against it.",
    );
    section(
        &mut out,
        Status::NotSpecified,
        "NOT SPECIFIED — the owner would have to restate these before they can be run",
        "The plan names the case; it does not give a value this harness could \
         assert without inventing one.",
    );

    let reachable: Vec<_> = paired()
        .filter(|(row, verdict)| {
            verdict.status == Status::NotEncoded
                && matches!(row.level, "UNIT" | "PROP")
                && verdict.detail == why_not_encoded(row.level)
        })
        .collect();
    if !reachable.is_empty() {
        let _ = writeln!(
            &mut out,
            "\nSTILL TO WRITE — reachable from this harness, no database needed ({})",
            reachable.len()
        );
        let _ = writeln!(
            &mut out,
            "  This is the work queue. Every other unproven row needs a surface this \
             harness has not got."
        );
        for (row, _) in reachable {
            let _ = writeln!(
                &mut out,
                "  {} [{}] {}  {}",
                row.id, row.decision, row.level, row.scenario
            );
        }
    }

    let proven = paired()
        .filter(|(_, verdict)| matches!(verdict.status, Status::Pass | Status::Adopted))
        .count();
    let failed = paired()
        .filter(|(_, verdict)| verdict.status == Status::Fail)
        .count();
    // The same filter the queue section uses, so the sentence and the list can
    // never disagree — a summary that said "9 more" over a list of five would
    // be read as five, and the other four would never be written.
    let unit_left = paired()
        .filter(|(row, verdict)| {
            verdict.status == Status::NotEncoded
                && matches!(row.level, "UNIT" | "PROP")
                && verdict.detail == why_not_encoded(row.level)
        })
        .count();
    let _ = writeln!(
        out,
        "\n---------------------------------------------------------------------------\n\
         {proven} of {} scenarios are proven ({} run here, {} adopted from tests that \
         already lock them).\n\
         {failed} failed. {unit_left} more are reachable from this harness with no \
         database and remain unwritten.\n\
         Every other row needs a surface this harness has not got; see the matrices \
         above for which.\n\
         ---------------------------------------------------------------------------",
        plan::PLAN.len(),
        paired()
            .filter(|(_, verdict)| verdict.status == Status::Pass)
            .count(),
        paired()
            .filter(|(_, verdict)| verdict.status == Status::Adopted)
            .count(),
    );
    out
}

/// Print past libtest's capture.
///
/// `println!` here would be swallowed on a green run — libtest shows captured
/// output only for tests that fail — and a coverage report nobody sees is the
/// failure mode this whole harness exists to prevent. Writing to the real
/// stdout handle bypasses the capture without depending on `--nocapture`.
fn emit(text: &str) {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(text.as_bytes());
    let _ = out.flush();
}

#[test]
fn every_locked_commercial_v1_scenario_reports_whether_anything_proves_it() {
    let fixtures = Fixtures::load();
    let verdicts = run_all(&fixtures);
    emit(&report(&verdicts));

    let failed: Vec<&str> = plan::PLAN
        .iter()
        .filter(|row| {
            verdicts
                .get(row.id)
                .is_some_and(|verdict| verdict.status == Status::Fail)
        })
        .map(|row| row.id)
        .collect();

    let fresh: Vec<&str> = failed
        .iter()
        .filter(|id| known_defect(id).is_none())
        .copied()
        .collect();
    assert!(
        fresh.is_empty(),
        "the kernel disagrees with the locked plan on {} scenario(s) that are not on the \
         defect register: {}. These are defects in the kernel. The expected values are \
         the contract and must not be edited to match the code — add the defect to \
         KNOWN_DEFECTS and write it up, or fix the kernel.",
        fresh.len(),
        fresh.join(", ")
    );

    let mended: Vec<&str> = KNOWN_DEFECTS
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| !failed.contains(id))
        .collect();
    assert!(
        mended.is_empty(),
        "{} scenario(s) on the defect register now PASS: {}. That is good news and it \
         has to be recorded: strike them off KNOWN_DEFECTS and update \
         ACCEPTANCE-COVERAGE.md, so the register keeps meaning what it says.",
        mended.len(),
        mended.join(", ")
    );
}

/// The plan is a contract, and a harness that quietly tested 190 of it would
/// be the more dangerous kind of green.
#[test]
fn the_plan_this_harness_answers_is_still_the_two_hundred_that_were_locked() {
    assert_eq!(
        plan::PLAN.len(),
        200,
        "the locked baseline is 200 scenarios; this table has drifted from it"
    );
}

/// The G01 refund table, driven straight from the locked fixture file.
///
/// Not a plan row of its own. RET-001 and RET-002 are E2E rows covering the
/// goods, the points reversal and the ledger as well, and this proves only
/// their refund-allocation half — so they stay NOT_ENCODED in the matrix
/// rather than being claimed. It earns its place anyway: it is the one place
/// where the fixture file's own numbers and a kernel module meet, and it would
/// catch a revision to either that the other did not follow.
#[test]
fn the_golden_carts_two_returns_split_across_its_tenders_as_the_fixtures_lock_them() {
    use inventory_backend::refund::{allocate, Capacity};

    let fixtures = Fixtures::load();
    let originals = fixtures.list("G01.tenders");
    let mut held: Vec<Capacity> = originals
        .iter()
        .map(|minor| Capacity {
            original_minor: *minor,
            committed_minor: 0,
        })
        .collect();

    // The shoes go back first. Their gross is the second unit's.
    let shoes = fixtures.list("G01.unit_gross");
    let shoes_gross = shoes
        .get(1)
        .copied()
        .unwrap_or_else(|| panic!("G01.unit_gross should name both units"));
    let first = allocate(&held, shoes_gross).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(
        first,
        fixtures.list("G01.shoe_refund_tenders"),
        "the shoes return splits across voucher and card as G01 locks it"
    );
    for (tender, share) in held.iter_mut().zip(&first) {
        tender.committed_minor += share;
    }

    // Then the shirt, measured against what the tenders have LEFT — which is
    // why the second split is not the first one recomputed.
    let shirt_gross = shoes
        .first()
        .copied()
        .unwrap_or_else(|| panic!("G01.unit_gross should name both units"));
    let second = allocate(&held, shirt_gross).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(
        second,
        fixtures.list("G01.shirt_refund_tenders"),
        "the shirt return splits as G01 locks it"
    );

    // And the pair of them comes back to exactly what was paid: no rupiah
    // invented by rounding, and none lost.
    let cumulative: Vec<i64> = first
        .iter()
        .zip(&second)
        .map(|(one, two)| one + two)
        .collect();
    assert_eq!(
        cumulative, originals,
        "a full return comes back to exactly the original payments"
    );
}
