//! The finance kernels, checked as rules rather than as examples.
//!
//! The unit tests beside each kernel pin down cases somebody chose. These state
//! the properties that must hold for inputs nobody chose, which is the
//! difference that matters: the cases in `depreciation.rs` were written AFTER
//! the code, so some of them were picked because I already suspected them. A
//! generator does not know what I suspect.
//!
//! That is not hypothetical here. The declining-balance schedule never
//! terminated — it approaches salvage asymptotically — and the case that
//! exposed it was `100 / 1 / 97`, which is in the table only because I threw in
//! a deliberately silly one. Had I not, it would have shipped. These properties
//! would have found it on the first run and gone on finding it every time
//! somebody touches the arithmetic.

use inventory_backend::cloud::domain::{
    monthly_charge, resolve, suggest, BankLine, Basis, Candidate, DepreciationMethod, Outcome,
    Ruleset, SkipReason,
};
use proptest::prelude::*;

fn basis(
    method: DepreciationMethod,
    cost: i64,
    salvage: i64,
    months: i32,
    accumulated: i64,
    period: i32,
) -> Basis {
    Basis {
        method,
        capitalized_cost_minor: cost,
        salvage_value_minor: salvage,
        useful_life_months: months,
        accumulated_minor: accumulated,
        period_index: period,
    }
}

/// Walk a whole schedule and report what it accumulated.
fn run_schedule(method: DepreciationMethod, cost: i64, salvage: i64, months: i32) -> i64 {
    let mut accumulated = 0i64;
    for period in 0..months {
        if let Outcome::Post(amount) =
            monthly_charge(basis(method, cost, salvage, months, accumulated, period))
        {
            accumulated += amount;
        }
    }
    accumulated
}

proptest! {
    /// Every schedule lands exactly on salvage — not a unit short, not a unit
    /// over.
    ///
    /// Short is the truncation residue: an asset that stops one rupiah above
    /// salvage stays on the register forever and turns up on every
    /// reconciliation after that. Over is worse: the books would carry the
    /// asset below what it is agreed to be worth.
    #[test]
    fn a_schedule_ends_exactly_on_salvage(
        cost in 1i64..1_000_000_000_000i64,
        salvage_fraction in 0.0f64..0.95f64,
        months in 1i32..=480i32,
        straight in any::<bool>(),
    ) {
        let salvage = ((cost as f64) * salvage_fraction) as i64;
        prop_assume!(salvage < cost);
        let method = if straight {
            DepreciationMethod::StraightLine
        } else {
            DepreciationMethod::Declining
        };
        let accumulated = run_schedule(method, cost, salvage, months);
        prop_assert_eq!(
            accumulated,
            cost - salvage,
            "{:?} cost {} salvage {} over {} months",
            method, cost, salvage, months
        );
    }

    /// Nothing is owed after the last instalment.
    #[test]
    fn a_finished_schedule_stays_finished(
        cost in 1i64..1_000_000_000i64,
        months in 1i32..=120i32,
    ) {
        let accumulated = run_schedule(DepreciationMethod::StraightLine, cost, 0, months);
        for extra in 0..3 {
            let after = monthly_charge(basis(
                DepreciationMethod::StraightLine, cost, 0, months, accumulated, months + extra,
            ));
            prop_assert_eq!(after, Outcome::Skip(SkipReason::FullyDepreciated));
        }
    }

    /// A charge is never negative and never exceeds what is still owed.
    ///
    /// A negative charge would credit the expense account — depreciation
    /// running backwards — and is exactly what an i64 overflow in the declining
    /// formula would produce.
    #[test]
    fn a_charge_is_positive_and_never_more_than_is_left(
        cost in 1i64..500_000_000_000_000i64,
        salvage in 0i64..1_000_000i64,
        months in 1i32..=480i32,
        period in 0i32..480i32,
        accumulated in 0i64..500_000_000_000_000i64,
        straight in any::<bool>(),
    ) {
        prop_assume!(salvage < cost);
        let depreciable = cost - salvage;
        prop_assume!(accumulated <= depreciable);
        let method = if straight {
            DepreciationMethod::StraightLine
        } else {
            DepreciationMethod::Declining
        };
        if let Outcome::Post(amount) =
            monthly_charge(basis(method, cost, salvage, months, accumulated, period))
        {
            prop_assert!(amount > 0, "posted {amount}");
            prop_assert!(
                accumulated + amount <= depreciable,
                "{accumulated} + {amount} passes {depreciable}"
            );
        }
    }

    /// Land, and anything else the client does not depreciate, charges nothing
    /// whatever the numbers say.
    #[test]
    fn a_non_depreciating_category_never_charges(
        cost in 1i64..1_000_000_000i64,
        months in 0i32..=480i32,
        period in 0i32..480i32,
    ) {
        prop_assert_eq!(
            monthly_charge(basis(DepreciationMethod::None, cost, 0, months, 0, period)),
            Outcome::Skip(SkipReason::NotDepreciated)
        );
    }
}

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

prop_compose! {
    fn a_candidate()(
        id in "[a-f]{4}",
        day in 0i64..40i64,
        amount in 1i64..5i64,
        reference in prop::sample::select(vec!["JV-1", "JV-2", ""]),
    ) -> Candidate {
        Candidate {
            journal_line_id: id,
            day,
            amount_minor: amount * 1_000_000,
            outgoing: true,
            reference: reference.to_string(),
            memo: String::new(),
        }
    }
}

prop_compose! {
    fn a_bank_line()(
        id in "[a-f]{4}",
        day in 0i64..40i64,
        amount in 1i64..5i64,
        reference in prop::sample::select(vec!["JV-1", "JV-2", ""]),
    ) -> BankLine {
        BankLine {
            line_id: id,
            day,
            amount_minor: amount * 1_000_000,
            outgoing: true,
            reference: reference.to_string(),
            description: format!("TRSF DB {reference}"),
        }
    }
}

proptest! {
    /// The order candidates arrive in never changes the answer.
    ///
    /// They arrive from a database, which makes no promise about row order. A
    /// matcher that depended on it would reconcile a statement differently on a
    /// re-run, and nobody would be able to say which run was right.
    #[test]
    fn suggestions_do_not_depend_on_candidate_order(
        line in a_bank_line(),
        mut pool in prop::collection::vec(a_candidate(), 0..8),
    ) {
        pool.sort_by(|a, b| a.journal_line_id.cmp(&b.journal_line_id));
        pool.dedup_by(|a, b| a.journal_line_id == b.journal_line_id);
        let rules = Ruleset::default();
        let forward = suggest(&line, &pool, &rules);
        let mut backward_pool = pool.clone();
        backward_pool.reverse();
        let backward = suggest(&line, &backward_pool, &rules);
        let shape = |s: &[_]| -> Vec<(String, i32, bool)> {
            s.iter()
                .map(|x: &inventory_backend::cloud::domain::Suggestion| {
                    (x.journal_line_id.clone(), x.score, x.auto_match)
                })
                .collect()
        };
        prop_assert_eq!(shape(&forward), shape(&backward));
    }

    /// Nothing auto-matches unless it is alone at the top.
    ///
    /// Two candidates tied at the top is the case a person exists to settle —
    /// two identical payments to two suppliers on the same Friday. Letting the
    /// sort order break the tie would make reconciliation depend on which row
    /// the database happened to return first.
    #[test]
    fn only_a_lone_leader_auto_matches(
        line in a_bank_line(),
        mut pool in prop::collection::vec(a_candidate(), 0..8),
    ) {
        pool.sort_by(|a, b| a.journal_line_id.cmp(&b.journal_line_id));
        pool.dedup_by(|a, b| a.journal_line_id == b.journal_line_id);
        let scored = suggest(&line, &pool, &Ruleset::default());
        let automatic = scored.iter().filter(|s| s.auto_match).count();
        prop_assert!(automatic <= 1, "{automatic} suggestions claimed to be automatic");
        if let Some(winner) = scored.iter().find(|s| s.auto_match) {
            let ties = scored.iter().filter(|s| s.score == winner.score).count();
            prop_assert_eq!(ties, 1, "a tied leader must not auto-match");
        }
    }

    /// A plan never promises one ledger row to two bank lines, and never
    /// promises one bank line two rows.
    ///
    /// This is the property that was missing. Each line scored on its own can
    /// have a unique best that is somebody else's unique best too, and the
    /// database would refuse the second — after the screen had offered it.
    #[test]
    fn a_plan_pairs_each_side_at_most_once(
        mut lines in prop::collection::vec(a_bank_line(), 0..6),
        mut pool in prop::collection::vec(a_candidate(), 0..6),
    ) {
        lines.sort_by(|a, b| a.line_id.cmp(&b.line_id));
        lines.dedup_by(|a, b| a.line_id == b.line_id);
        pool.sort_by(|a, b| a.journal_line_id.cmp(&b.journal_line_id));
        pool.dedup_by(|a, b| a.journal_line_id == b.journal_line_id);

        let plan = resolve(&lines, &pool, &Ruleset::default());

        let mut rows: Vec<&str> = plan.iter().map(|a| a.journal_line_id.as_str()).collect();
        let claimed = rows.len();
        rows.sort_unstable();
        rows.dedup();
        prop_assert_eq!(rows.len(), claimed, "a ledger row was promised twice");

        let mut sides: Vec<&str> = plan.iter().map(|a| a.line_id.as_str()).collect();
        let paired = sides.len();
        sides.sort_unstable();
        sides.dedup();
        prop_assert_eq!(sides.len(), paired, "a bank line was given two rows");
    }

    /// The plan does not depend on the order the lines arrived in either.
    #[test]
    fn a_plan_does_not_depend_on_input_order(
        mut lines in prop::collection::vec(a_bank_line(), 0..6),
        mut pool in prop::collection::vec(a_candidate(), 0..6),
    ) {
        lines.sort_by(|a, b| a.line_id.cmp(&b.line_id));
        lines.dedup_by(|a, b| a.line_id == b.line_id);
        pool.sort_by(|a, b| a.journal_line_id.cmp(&b.journal_line_id));
        pool.dedup_by(|a, b| a.journal_line_id == b.journal_line_id);

        let rules = Ruleset::default();
        let key = |plan: Vec<inventory_backend::cloud::domain::Assignment>| {
            let mut pairs: Vec<(String, String)> = plan
                .into_iter()
                .map(|a| (a.line_id, a.journal_line_id))
                .collect();
            pairs.sort();
            pairs
        };
        let mut shuffled = lines.clone();
        shuffled.reverse();
        prop_assert_eq!(
            key(resolve(&lines, &pool, &rules)),
            key(resolve(&shuffled, &pool, &rules))
        );
    }
}

// ---------------------------------------------------------------------------
// The cash document's number, and the amount in words
// ---------------------------------------------------------------------------
//
// Two things a person reads off a piece of paper, which is why they are worth
// stating as rules rather than as the handful of examples somebody thought of.
//
// A number is what a slip is filed under. If two documents in one month can
// carry the same one, the file has a collision nobody can resolve afterwards —
// the paper is already in a drawer. If a number can be produced that does not
// say which month it belongs to, the September file and the September counter
// stop agreeing and only a person counting the drawer will ever notice.
//
// The words are the line that makes a 1 added to the front of a figure visible.
// A speller that drops a group is worse than no words at all, because the words
// are what somebody checks the figures against.

use inventory_backend::cloud::domain::{
    cash_document_number, holds_money, rupiah_in_words, CashDirection, MONEY_MEANINGS,
};

fn a_direction() -> impl Strategy<Value = CashDirection> {
    prop_oneof![
        Just(CashDirection::Out),
        Just(CashDirection::In),
        Just(CashDirection::Between),
    ]
}

proptest! {
    /// Two documents share a number only when they share all three of kind,
    /// month and sequence.
    ///
    /// This is the property the whole numbering scheme exists to have. The
    /// prefix separates the kinds, the middle separates the months, and the
    /// tail separates the documents — and if any pair of those could collide,
    /// the counter that hands out sequence 41 for PAY in September would be
    /// handing out a number that already sits on a slip in a drawer.
    #[test]
    fn a_number_identifies_exactly_one_slip(
        left_direction in a_direction(),
        right_direction in a_direction(),
        left_year in 2000i32..2100,
        right_year in 2000i32..2100,
        left_month in 1u32..=12,
        right_month in 1u32..=12,
        left_sequence in 0i64..200_000,
        right_sequence in 0i64..200_000,
    ) {
        let left = cash_document_number(left_direction, left_year, left_month, left_sequence);
        let right = cash_document_number(right_direction, right_year, right_month, right_sequence);
        let same_document = left_direction == right_direction
            // Two digits of year, so 2026 and 2126 are one file as far as the
            // paper is concerned. Stated rather than hidden: it is the client's
            // own format and it is a hundred-year assumption, not a forever one.
            && left_year.rem_euclid(100) == right_year.rem_euclid(100)
            && left_month == right_month
            && left_sequence == right_sequence;
        prop_assert_eq!(left == right, same_document, "{} vs {}", left, right);
    }

    /// The month a number carries can always be read back out of it.
    ///
    /// Which is what lets somebody holding a slip find the counter it came from
    /// — and what would stop being true the moment a "simplification" numbered
    /// a September document with October's counter.
    #[test]
    fn the_month_can_be_read_off_the_paper(
        direction in a_direction(),
        year in 2000i32..2100,
        month in 1u32..=12,
        sequence in 0i64..200_000,
    ) {
        let number = cash_document_number(direction, year, month, sequence);
        let parts: Vec<&str> = number.split('-').collect();
        prop_assert_eq!(parts.len(), 4, "{}", number);
        prop_assert_eq!(parts[0], direction.prefix());
        prop_assert_eq!(parts[1].parse::<i32>().ok(), Some(year.rem_euclid(100)));
        prop_assert_eq!(parts[2].parse::<u32>().ok(), Some(month));
        prop_assert_eq!(parts[3].parse::<i64>().ok(), Some(sequence));
        // Five digits, so a month's worth of slips file in order in a drawer.
        // Beyond that the number grows rather than wrapping, because a wrapped
        // number collides with one already filed.
        prop_assert!(parts[3].len() >= 5, "{}", number);
    }

    /// Numbers sort in the order they were handed out, inside one kind and
    /// one month.
    ///
    /// Zero padding is what makes this true, and it is not decoration: the
    /// drawer is sorted by the string on the paper.
    #[test]
    fn numbers_sort_the_way_the_drawer_does(
        direction in a_direction(),
        year in 2000i32..2100,
        month in 1u32..=12,
        first in 0i64..99_999,
        second in 0i64..99_999,
    ) {
        let left = cash_document_number(direction, year, month, first);
        let right = cash_document_number(direction, year, month, second);
        prop_assert_eq!(left.cmp(&right), first.cmp(&second));
    }

    /// Every amount gets words, and they always end in the currency.
    ///
    /// The trap this guards is a speller that returns nothing for a value it
    /// has no branch for: an empty "terbilang" line reads as a slip somebody
    /// forgot to finish, and the figure beside it is then the only record.
    #[test]
    fn every_amount_says_something_and_says_rupiah(amount in 0i64..1_000_000_000_000_000) {
        let words = rupiah_in_words(amount);
        prop_assert!(words.ends_with(" rupiah"), "{}", words);
        let spoken = words.trim_end_matches(" rupiah");
        prop_assert!(!spoken.trim().is_empty(), "{} said nothing", amount);
        // Capitalised, because it starts a line on paper.
        prop_assert!(
            spoken.chars().next().is_some_and(char::is_uppercase),
            "{}", words
        );
    }

    /// Different amounts read differently.
    ///
    /// The bug every recursive speller has is a zero group swallowing the group
    /// after it — 101,000,000 coming out as "seratus juta". Two amounts that
    /// spell the same are two figures a checker cannot tell apart, which is the
    /// one job the line has.
    #[test]
    fn two_amounts_never_read_the_same(
        left in 0i64..10_000_000_000,
        right in 0i64..10_000_000_000,
    ) {
        prop_assume!(left != right);
        prop_assert_ne!(rupiah_in_words(left), rupiah_in_words(right));
    }

    /// A negative amount says so, and says the same figure.
    #[test]
    fn a_minus_is_spoken_and_changes_nothing_else(amount in 1i64..1_000_000_000_000) {
        let positive = rupiah_in_words(amount);
        let negative = rupiah_in_words(-amount);
        prop_assert!(negative.starts_with("Minus "), "{}", negative);
        prop_assert_eq!(
            negative.trim_start_matches("Minus ").to_string(),
            positive[..1].to_lowercase() + &positive[1..]
        );
    }
}

/// The list of meanings that hold money is the definition of "cash or bank",
/// and it has exactly one answer per key.
///
/// Not a proptest: the list is finite and short, and the thing worth asserting
/// is that `holds_money` and `MONEY_MEANINGS` cannot come apart. Which side of a
/// document holds money is the whole of the direction rule, so a key that
/// answered differently to the two would produce a slip headed BUKTI KAS KELUAR
/// over an entry that only moved money between two pots the company holds.
#[test]
fn the_money_meanings_and_the_predicate_are_one_list() {
    for key in MONEY_MEANINGS {
        assert!(holds_money(key), "{key} is in the list and denies it");
    }
    for key in [
        "trade_payable",
        "inventory",
        "bank_admin_fee",
        "interest_income",
        "tax_on_interest",
        "giro_outstanding",
        "",
    ] {
        assert!(!holds_money(key), "{key} is not in the list and claims to be");
    }
    // `giro_outstanding` in particular: an issued giro is a liability, not
    // money. If it ever held money, moving a payable onto it would read as a
    // transfer between two of the company's own accounts and the slip would say
    // so.
    assert!(!holds_money("giro_outstanding"));
}
