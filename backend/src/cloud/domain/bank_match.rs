//! Matching what the bank says against what we booked.
//!
//! The scoring is ported from `banking-domain` in
//! `~/Documents/retail/final-product/backend`, whose invariants are the best
//! statement of this problem in any generation. Four are kept exactly:
//!
//! * **Amount-anchored.** A candidate outside tolerance is never suggested at
//!   any score. Date and reference refine a match; they cannot create one.
//! * **Only a unique winner auto-matches.** Two candidates tied at the top is
//!   precisely the case a person must look at, so a tie auto-matches nothing.
//! * **Order independence.** The same inputs in any order give the same
//!   suggestions and the same winner — otherwise a re-import silently
//!   reconciles differently.
//! * **Every refusal and every match is explained.** A 0–100 score alone tells
//!   nobody which field agreed.
//!
//! And one it did not have, which this now does: a GLOBAL assignment. Scoring
//! each line on its own is not enough, because two lines can each pick the same
//! ledger row as their unique best. The database refuses the second, but by then
//! the screen has already offered it — see [`resolve`].
//!
//! One thing is deliberately different. The reference implementation scored a
//! statement line against *other statement lines*, because its ledger authority
//! had not landed. Ours scores against `journal_line` rows on the same bank
//! account, which is what bank reconciliation is actually for.
//!
//! This module is pure: no database, no clock, no randomness. Every fact it
//! needs arrives as an argument.

use serde::Serialize;

/// What the bank says happened.
#[derive(Clone, Debug)]
pub struct BankLine {
    pub line_id: String,
    /// Days since an arbitrary epoch. A number rather than a date because this
    /// module does not need a calendar, only distances.
    pub day: i64,
    /// Magnitude. Direction is the caller's concern — matching is on size,
    /// because a payment out of our books is a debit on the bank's.
    pub amount_minor: i64,
    /// True when money left the account.
    pub outgoing: bool,
    pub reference: String,
    pub description: String,
}

/// A journal line on the same bank account that this bank line might settle.
#[derive(Clone, Debug)]
pub struct Candidate {
    pub journal_line_id: String,
    pub day: i64,
    pub amount_minor: i64,
    pub outgoing: bool,
    /// The entry's number and memo, which is what a bank narration usually
    /// echoes some of.
    pub reference: String,
    pub memo: String,
}

/// The weights. Named rather than magic so a disagreement about matching is a
/// disagreement about these numbers and not about the code.
#[derive(Clone, Copy, Debug)]
pub struct Ruleset {
    /// A candidate this many days either side of the bank line still counts.
    /// Three is the reference implementation's default and matches how long a
    /// transfer takes to clear here.
    pub date_window_days: i64,
    /// Amounts must agree exactly by default. A bank that deducts its own fee
    /// from a transfer is a different problem, solved by recording the fee.
    pub amount_tolerance_minor: i64,
    pub exact_amount: i32,
    pub within_window: i32,
    pub same_day: i32,
    pub reference_exact: i32,
    pub reference_contained: i32,
    /// Suggestions below this are not shown at all.
    pub min_to_suggest: i32,
    /// A lone suggestion at or above this may be applied without a person.
    pub auto_match_at: i32,
}

impl Default for Ruleset {
    fn default() -> Self {
        Self {
            date_window_days: 3,
            amount_tolerance_minor: 0,
            exact_amount: 50,
            within_window: 15,
            same_day: 25,
            reference_exact: 30,
            reference_contained: 15,
            min_to_suggest: 50,
            auto_match_at: 90,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Suggestion {
    pub journal_line_id: String,
    pub score: i32,
    /// Whether this is the unique top suggestion at or above the threshold.
    pub auto_match: bool,
    /// Which fields agreed, in words. This is what a person reads before
    /// accepting; the score is only for ordering.
    pub reasons: Vec<String>,
}

fn normalise(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

/// Score one bank line against every candidate, best first.
///
/// Deterministic: candidates are ordered by score and then by id, so two
/// candidates that score alike come back in the same order every time, whatever
/// order they arrived in.
pub fn suggest(line: &BankLine, candidates: &[Candidate], rules: &Ruleset) -> Vec<Suggestion> {
    let mut scored: Vec<Suggestion> = candidates
        .iter()
        .filter_map(|candidate| score(line, candidate, rules))
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.journal_line_id.cmp(&b.journal_line_id))
    });

    // Only a UNIQUE top suggestion may auto-match. A tie at the top is the case
    // a person exists to settle, and letting the sort order break it would make
    // reconciliation depend on which row the database happened to return first.
    let unique_winner = match scored.as_slice() {
        [only] => only.score >= rules.auto_match_at,
        [first, second, ..] => first.score >= rules.auto_match_at && first.score > second.score,
        [] => false,
    };
    if unique_winner {
        if let Some(first) = scored.first_mut() {
            first.auto_match = true;
        }
    }
    scored
}

/// One bank line paired with the ledger row the plan gives it.
#[derive(Clone, Debug, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct Assignment {
    pub line_id: String,
    pub journal_line_id: String,
    pub score: i32,
    pub reasons: Vec<String>,
}

/// Plan the whole statement at once, so no ledger row is promised twice.
///
/// # Why scoring each line on its own is not enough
///
/// We paid two suppliers five million each on the same Friday. The bank reports
/// two debits of five million. Line one quotes an entry number and wins its
/// candidate outright; line two happens to sit on the same day as that SAME
/// candidate and a day away from the other, so it also has a unique top — the
/// one already spoken for.
///
/// Scored independently, both lines are offered an "Accept" button pointing at
/// one ledger row. The first click saves; the second fails on
/// `UNIQUE (journal_line_id)`. The data stays right and the screen has lied:
/// somebody was shown a confident suggestion that could never have worked.
///
/// So the plan is made across every line together. Lines are walked in id order
/// — not the order the database happened to return them — and a candidate that
/// has been taken is passed over. A line whose only auto-match is already spoken
/// for gets no assignment, which is the honest answer: a person has to look.
pub fn resolve(lines: &[BankLine], candidates: &[Candidate], rules: &Ruleset) -> Vec<Assignment> {
    let mut ordered: Vec<&BankLine> = lines.iter().collect();
    ordered.sort_by(|a, b| a.line_id.cmp(&b.line_id));

    let mut taken: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut plan = Vec::new();
    for line in ordered {
        for suggestion in suggest(line, candidates, rules) {
            if !suggestion.auto_match || taken.contains(&suggestion.journal_line_id) {
                continue;
            }
            taken.insert(suggestion.journal_line_id.clone());
            plan.push(Assignment {
                line_id: line.line_id.clone(),
                journal_line_id: suggestion.journal_line_id,
                score: suggestion.score,
                reasons: suggestion.reasons,
            });
            break;
        }
    }
    plan
}

fn score(line: &BankLine, candidate: &Candidate, rules: &Ruleset) -> Option<Suggestion> {
    // Direction first. Money leaving the bank cannot settle money arriving,
    // whatever the amount and the reference say.
    if line.outgoing != candidate.outgoing {
        return None;
    }
    // Amount is the anchor, not a bonus. Out of tolerance is not a weak match;
    // it is a different transaction.
    let difference = (line.amount_minor - candidate.amount_minor).abs();
    if difference > rules.amount_tolerance_minor {
        return None;
    }

    let mut total = rules.exact_amount;
    let mut reasons = vec![if difference == 0 {
        "amount matches exactly".to_string()
    } else {
        format!("amount within {difference}")
    }];

    let gap = (line.day - candidate.day).abs();
    if gap == 0 {
        total += rules.same_day;
        reasons.push("same day".to_string());
    } else if gap <= rules.date_window_days {
        total += rules.within_window;
        reasons.push(format!(
            "{gap} day{} apart",
            if gap == 1 { "" } else { "s" }
        ));
    }

    let bank_reference = normalise(&line.reference);
    let ours = normalise(&candidate.reference);
    if !bank_reference.is_empty() && bank_reference == ours {
        total += rules.reference_exact;
        reasons.push("reference matches".to_string());
    } else if !ours.is_empty()
        && (normalise(&line.description).contains(&ours) || bank_reference.contains(&ours))
    {
        total += rules.reference_contained;
        reasons.push(format!("{} appears in the narration", candidate.reference));
    }

    (total >= rules.min_to_suggest).then_some(Suggestion {
        journal_line_id: candidate.journal_line_id.clone(),
        score: total,
        auto_match: false,
        reasons,
    })
}

// ---------------------------------------------------------------------------
// Recognising a line nobody booked
// ---------------------------------------------------------------------------
//
// Everything above answers "which of our entries is this bank line". This
// answers the other question, about the lines where the answer is "none of
// them": the monthly charge, the interest credited, the tax withheld on that
// interest. Those are the same four narrations every month on every account,
// and until now somebody chose the account for each of them by hand, every
// time, with nothing remembering that they had.
//
// A rule PROPOSES and never posts. That is not caution, it is the design: a
// rule that posted would invent journal entries out of text matching, and the
// first time a bank reworded a narration it would invent them somewhere wrong,
// indistinguishably from entries a person made. So this returns which rule
// recognised a line and why, and a person decides what happens next.

/// Which way the money went, as the BANK reports it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuleDirection {
    /// A credit on the statement: money arriving.
    In,
    /// A debit on the statement: money leaving.
    Out,
    Any,
}

impl RuleDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::In => "IN",
            Self::Out => "OUT",
            Self::Any => "ANY",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "IN" => Some(Self::In),
            "OUT" => Some(Self::Out),
            "ANY" => Some(Self::Any),
            _ => None,
        }
    }

    fn admits(self, outgoing: bool) -> bool {
        match self {
            Self::Any => true,
            Self::Out => outgoing,
            Self::In => !outgoing,
        }
    }
}

/// How a rule recognises a narration.
///
/// `Regex` carries the verdict rather than the pattern, and that is deliberate.
/// This crate has no regex engine, and writing one would mean a pattern that
/// behaves one way on the screen that previews it and another in the query that
/// applies it — two dialects for one field. Postgres has a POSIX engine, so the
/// database answers that one question and hands the answer in, which is exactly
/// the discipline every other input to this module follows: the kernel decides,
/// on facts it was given.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuleMatch {
    Contains(String),
    StartsWith(String),
    Regex { pattern: String, matched: bool },
}

/// One rule, as far as recognising a line needs to know.
#[derive(Clone, Debug)]
pub struct NarrationRule {
    pub rule_id: String,
    /// Lowest first. `PAJAK BUNGA` has to be asked before `BUNGA`, because the
    /// second matches the first's narration and they are different accounts.
    pub priority: i32,
    pub direction: RuleDirection,
    pub matcher: RuleMatch,
}

/// Which rule recognised a line, and the sentence a person will read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuleHit {
    pub rule_id: String,
    pub reason: String,
}

/// The first rule that recognises this line, or nothing.
///
/// # Why first-match-wins and not best-match
///
/// A best match would need a score for text, and two rules tying would be
/// resolved by whatever order the database returned them in — the exact failure
/// [`suggest`] refuses to make when two candidates tie. Priority is a number
/// somebody sets and can see, and a rule that is too greedy is fixed by moving
/// it down rather than by arguing about weights.
///
/// Ties in priority are broken by rule id, so the same rules over the same line
/// give the same answer whatever order they arrived in.
pub fn recognise(line: &BankLine, rules: &[NarrationRule]) -> Option<RuleHit> {
    let mut ordered: Vec<&NarrationRule> = rules.iter().collect();
    ordered.sort_by(|a, b| a.priority.cmp(&b.priority).then_with(|| a.rule_id.cmp(&b.rule_id)));

    let narration = normalise(&line.description);
    for rule in ordered {
        if !rule.direction.admits(line.outgoing) {
            continue;
        }
        let hit = match &rule.matcher {
            // The same normalisation the reference comparison above uses: case
            // and punctuation folded away, because no two banks agree about
            // either and a rule that only matched "BIAYA ADM." would miss
            // "Biaya Adm" on the next statement.
            RuleMatch::Contains(pattern) => {
                let needle = normalise(pattern);
                !needle.is_empty() && narration.contains(&needle)
            }
            RuleMatch::StartsWith(pattern) => {
                let needle = normalise(pattern);
                !needle.is_empty() && narration.starts_with(&needle)
            }
            RuleMatch::Regex { matched, .. } => *matched,
        };
        if !hit {
            continue;
        }
        let reason = match &rule.matcher {
            RuleMatch::Contains(pattern) => format!("the narration contains {pattern}"),
            RuleMatch::StartsWith(pattern) => format!("the narration starts with {pattern}"),
            RuleMatch::Regex { pattern, .. } => format!("the narration matches {pattern}"),
        };
        return Some(RuleHit {
            rule_id: rule.rule_id.clone(),
            reason,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(amount: i64, day: i64, reference: &str) -> BankLine {
        BankLine {
            line_id: "bank-1".into(),
            day,
            amount_minor: amount,
            outgoing: true,
            reference: reference.into(),
            description: format!("TRSF E-BANKING DB {reference}"),
        }
    }

    fn candidate(id: &str, amount: i64, day: i64, reference: &str) -> Candidate {
        Candidate {
            journal_line_id: id.into(),
            day,
            amount_minor: amount,
            outgoing: true,
            reference: reference.into(),
            memo: String::new(),
        }
    }

    #[test]
    fn a_different_amount_is_never_suggested() {
        let got = suggest(
            &line(1_000_000, 10, "JV-1"),
            &[candidate("a", 999_999, 10, "JV-1")],
            &Ruleset::default(),
        );
        assert!(
            got.is_empty(),
            "amount anchors the match; it is not a bonus"
        );
    }

    #[test]
    fn money_out_never_settles_money_in() {
        let mut incoming = candidate("a", 1_000_000, 10, "JV-1");
        incoming.outgoing = false;
        let got = suggest(
            &line(1_000_000, 10, "JV-1"),
            &[incoming],
            &Ruleset::default(),
        );
        assert!(got.is_empty());
    }

    #[test]
    fn a_unique_strong_match_auto_matches() {
        let got = suggest(
            &line(1_000_000, 10, "JV-00000007"),
            &[
                candidate("a", 1_000_000, 10, "JV-00000007"),
                candidate("b", 1_000_000, 30, "JV-00000099"),
            ],
            &Ruleset::default(),
        );
        assert_eq!(got.len(), 2);
        assert!(got[0].auto_match, "50 + 25 + 30 = 105, and it is alone");
        assert!(!got[1].auto_match);
    }

    #[test]
    fn a_tie_at_the_top_auto_matches_nothing() {
        // Two identical payments to two suppliers on the same day is an
        // ordinary Friday, and it is exactly what a person has to settle.
        let got = suggest(
            &line(1_000_000, 10, ""),
            &[
                candidate("a", 1_000_000, 10, ""),
                candidate("b", 1_000_000, 10, ""),
            ],
            &Ruleset::default(),
        );
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|s| !s.auto_match));
    }

    #[test]
    fn input_order_changes_nothing() {
        let forward = [
            candidate("a", 1_000_000, 10, "JV-1"),
            candidate("b", 1_000_000, 12, "JV-2"),
            candidate("c", 1_000_000, 10, "JV-3"),
        ];
        let mut backward = forward.to_vec();
        backward.reverse();
        let one = suggest(&line(1_000_000, 10, "JV-1"), &forward, &Ruleset::default());
        let two = suggest(&line(1_000_000, 10, "JV-1"), &backward, &Ruleset::default());
        let ids = |s: &[Suggestion]| {
            s.iter()
                .map(|x| (x.journal_line_id.clone(), x.score, x.auto_match))
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(&one), ids(&two));
    }

    #[test]
    fn one_ledger_row_is_never_promised_to_two_lines() {
        // Two payments of five million on the same Friday, and a statement that
        // reports both. Line "a" quotes the entry number of candidate x; line
        // "b" quotes nothing but sits on x's day, so scored alone it would pick
        // x too.
        let lines = [
            BankLine {
                line_id: "a".into(),
                day: 10,
                amount_minor: 5_000_000,
                outgoing: true,
                reference: "JV-00000007".into(),
                description: "TRSF DB JV-00000007".into(),
            },
            BankLine {
                line_id: "b".into(),
                day: 10,
                amount_minor: 5_000_000,
                outgoing: true,
                reference: String::new(),
                description: "TRSF DB".into(),
            },
        ];
        let pool = [
            candidate("x", 5_000_000, 10, "JV-00000007"),
            candidate("y", 5_000_000, 14, "JV-00000008"),
        ];

        // Scored alone, "b" would take x: same day beats four days apart.
        let alone = suggest(&lines[1], &pool, &Ruleset::default());
        assert_eq!(alone.first().map(|s| s.journal_line_id.as_str()), Some("x"));

        // Planned together, x goes to the line that quoted it and "b" is left
        // for a person rather than being offered something already spoken for.
        let plan = resolve(&lines, &pool, &Ruleset::default());
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].line_id, "a");
        assert_eq!(plan[0].journal_line_id, "x");
    }

    #[test]
    fn the_plan_does_not_depend_on_the_order_the_lines_arrived() {
        let lines = [
            BankLine {
                line_id: "a".into(),
                day: 10,
                amount_minor: 1_000_000,
                outgoing: true,
                reference: "JV-1".into(),
                description: "x".into(),
            },
            BankLine {
                line_id: "b".into(),
                day: 10,
                amount_minor: 1_000_000,
                outgoing: true,
                reference: "JV-2".into(),
                description: "x".into(),
            },
        ];
        let pool = [
            candidate("p", 1_000_000, 10, "JV-1"),
            candidate("q", 1_000_000, 10, "JV-2"),
        ];
        let mut backwards = lines.to_vec();
        backwards.reverse();
        let key = |plan: Vec<Assignment>| {
            plan.into_iter()
                .map(|a| (a.line_id, a.journal_line_id))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            key(resolve(&lines, &pool, &Ruleset::default())),
            key(resolve(&backwards, &pool, &Ruleset::default()))
        );
    }

    #[test]
    fn every_suggestion_says_why() {
        let got = suggest(
            &line(1_000_000, 10, "JV-00000007"),
            &[candidate("a", 1_000_000, 11, "JV-00000007")],
            &Ruleset::default(),
        );
        assert_eq!(
            got[0].reasons,
            vec!["amount matches exactly", "1 day apart", "reference matches"]
        );
    }

    // -----------------------------------------------------------------------
    // Recognising a line nobody booked
    // -----------------------------------------------------------------------

    fn narration(text: &str, outgoing: bool) -> BankLine {
        BankLine {
            line_id: "bank-1".into(),
            day: 10,
            amount_minor: 25_000,
            outgoing,
            reference: String::new(),
            description: text.into(),
        }
    }

    /// The three the migration seeds, in the order it seeds them.
    fn seeded() -> Vec<NarrationRule> {
        vec![
            NarrationRule {
                rule_id: "tax".into(),
                priority: 10,
                direction: RuleDirection::Out,
                matcher: RuleMatch::Contains("PAJAK BUNGA".into()),
            },
            NarrationRule {
                rule_id: "fee".into(),
                priority: 20,
                direction: RuleDirection::Out,
                matcher: RuleMatch::Contains("BIAYA ADM".into()),
            },
            NarrationRule {
                rule_id: "interest".into(),
                priority: 30,
                direction: RuleDirection::In,
                matcher: RuleMatch::Contains("BUNGA".into()),
            },
        ]
    }

    #[test]
    fn the_greedier_rule_sits_below_the_one_it_would_swallow() {
        // "PAJAK BUNGA 20%" is matched by both the tax rule and the interest
        // rule. Priority is the only thing that can separate them, and the tax
        // rule is above it in the seed for exactly this line.
        let hit = recognise(&narration("PAJAK BUNGA 20%", true), &seeded())
            .expect("a withheld tax should be recognised");
        assert_eq!(hit.rule_id, "tax");
    }

    #[test]
    fn a_charge_and_a_credit_are_not_the_same_event() {
        // Same word, opposite directions. Interest credited is income;
        // "BUNGA" on the debit side is not, and the IN rule must not take it.
        assert_eq!(
            recognise(&narration("BUNGA BANK", false), &seeded())
                .map(|hit| hit.rule_id),
            Some("interest".to_string())
        );
        assert_eq!(recognise(&narration("BUNGA BANK", true), &seeded()), None);
    }

    #[test]
    fn case_and_punctuation_are_not_part_of_the_pattern() {
        // No two banks write a narration the same way twice.
        for text in ["BIAYA ADM", "Biaya Adm.", "biaya  adm bulanan", "BIAYA-ADM"] {
            let hit = recognise(&narration(text, true), &seeded())
                .unwrap_or_else(|| panic!("{text} should be recognised"));
            assert_eq!(hit.rule_id, "fee", "{text}");
        }
    }

    #[test]
    fn the_order_rules_arrive_in_changes_nothing() {
        let mut backwards = seeded();
        backwards.reverse();
        let line = narration("PAJAK BUNGA ATAS JASA GIRO", true);
        assert_eq!(recognise(&line, &seeded()), recognise(&line, &backwards));
    }

    #[test]
    fn a_line_nothing_recognises_proposes_nothing() {
        assert_eq!(
            recognise(&narration("TRSF E-BANKING DB PT SUMBER", true), &seeded()),
            None
        );
    }

    #[test]
    fn a_regex_rule_is_told_the_answer_rather_than_working_it_out() {
        let rules = vec![NarrationRule {
            rule_id: "regex".into(),
            priority: 1,
            direction: RuleDirection::Any,
            matcher: RuleMatch::Regex {
                pattern: "^SETORAN [0-9]+$".into(),
                matched: true,
            },
        }];
        let hit = recognise(&narration("SETORAN 4412", false), &rules)
            .expect("Postgres said it matched");
        assert!(hit.reason.contains("^SETORAN [0-9]+$"), "said: {}", hit.reason);

        let refused = vec![NarrationRule {
            matcher: RuleMatch::Regex {
                pattern: "^SETORAN [0-9]+$".into(),
                matched: false,
            },
            ..rules[0].clone()
        }];
        assert_eq!(recognise(&narration("SETORAN 4412", false), &refused), None);
    }

    #[test]
    fn every_hit_says_why_in_words_a_person_can_check() {
        let hit = recognise(&narration("BIAYA ADM BULANAN", true), &seeded())
            .expect("recognised");
        assert_eq!(hit.reason, "the narration contains BIAYA ADM");
    }
}
