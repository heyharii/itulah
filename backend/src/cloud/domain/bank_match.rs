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
}
