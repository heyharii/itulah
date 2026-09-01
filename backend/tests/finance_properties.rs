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
