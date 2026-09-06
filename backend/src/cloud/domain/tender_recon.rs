//! What the till and the EDC slip say about the same evening, paired.
//!
//! A shop closing its card takings has two lists in front of it: the receipts
//! its own till recorded, and the approvals printed on the terminal's batch
//! slip. Most evenings the two lists are the same list in a different order,
//! and reading them line by line is twenty minutes of somebody's time spent
//! confirming what a comparison could have said in a moment.
//!
//! This is that comparison. It suggests; it decides nothing. Every pairing it
//! proposes is written to the screen for a person to accept, because the two
//! interesting cases — an approval that never settled, and a card rung on the
//! wrong machine — are indistinguishable from the outside and only the person
//! who was standing there can tell them apart.
//!
//! # Why it is pure
//!
//! Both lists arrive as arguments. The kernel cannot ask the database what else
//! happened that day, and it cannot ask what day it is: a suggestion computed
//! on the evening of the 5th and re-computed by an auditor in December must be
//! the same suggestion, or the screen is showing a judgement that quietly
//! depends on when it was opened.
//!
//! Dates arrive as a day number the caller worked out, for the reason
//! `depreciation::Basis` takes a period index: a kernel that can name a date is
//! one line away from asking for today's.
//!
//! # The two rules, and why there are only two
//!
//! **Same acquirer, same day, same amount — a match.** Exact, never a
//! tolerance. A card terminal and a till record the same approval to the
//! rupiah, and an amount that is nearly right is a different payment, not a
//! rounding difference. The one place fuzziness would help is a tip or a
//! surcharge added at the machine, which this client's terminals do not do.
//!
//! **Different acquirer, same day, same amount — a retender.** The card was
//! swiped on the wrong EDC: the receipt says BCA and BCA's batch does not have
//! it, while MANDIRI's does. The receivable is owed by MANDIRI and the books
//! say BCA, and nothing downstream can discover that on its own — the amounts
//! all balance, against the wrong counterparty.
//!
//! A cross-acquirer candidate is only proposed when exactly one other acquirer
//! offers it. Two machines that both approved 250,000 that evening is a
//! genuinely ambiguous evening, and picking one would be inventing the answer
//! rather than finding it. Those come back as unexplained, which is what they
//! are.
//!
//! # A receipt that does not say which machine
//!
//! The till records the acquirer in a free-text reference, and it is sometimes
//! blank. A receipt with an empty acquirer is treated as unknown, and an unknown
//! acquirer matches any approval of the same day and amount.
//!
//! That is not leniency, it is the absence of evidence. A retender says "the
//! books name the wrong counterparty", and the only thing that can establish
//! that is the receipt naming one. A blank reference names none, so there is
//! nothing for the slip to contradict — and proposing a retender there would
//! move a receivable off the strength of a field nobody filled in.

/// One payment on one till receipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceiptTender {
    /// The sale, as text. A kernel has no business minting or parsing an
    /// identity; it only ever compares one to another.
    pub sale_id: String,
    /// Which of the sale's payments. Position is a tender's identity.
    pub tender_seq: i32,
    /// The trading day, as a number the caller derived from the calendar.
    pub day: i32,
    /// Whom the till believed it was charging.
    pub acquirer: String,
    pub amount_minor: i64,
}

/// One approval printed on an EDC batch slip.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BatchApproval {
    pub batch_line_id: String,
    pub terminal_id: String,
    /// Whose machine actually approved it.
    pub acquirer: String,
    pub day: i32,
    pub amount_minor: i64,
}

/// What the comparison thinks a pair is.
///
/// Two of the five decisions and not all five, deliberately. MATCHED and
/// RETENDER are the two a comparison of two lists can reach on the evidence in
/// front of it. NO_SETTLEMENT, OTHER_DAY and RETURNED all say something about a
/// day this kernel was not given, so proposing one would be a guess wearing a
/// suggestion's clothes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SuggestedTenderDecision {
    Matched,
    Retender,
}

impl SuggestedTenderDecision {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Matched => "MATCHED",
            Self::Retender => "RETENDER",
        }
    }
}

/// One proposed pairing, with the reason a person can check it against.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TenderSuggestion {
    pub sale_id: String,
    pub tender_seq: i32,
    pub batch_line_id: String,
    pub decision: SuggestedTenderDecision,
    /// Where the books currently say the money is owed. Set for a retender
    /// only; a match moves nothing.
    pub from_acquirer: Option<String>,
    /// Where it is actually owed.
    pub to_acquirer: Option<String>,
    /// In words, because a person has to accept this and "score 0.92" tells
    /// them nothing about which field agreed.
    pub reason: String,
}

/// A till receipt nothing on any slip accounts for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnexplainedReceipt {
    pub sale_id: String,
    pub tender_seq: i32,
    pub amount_minor: i64,
    pub acquirer: String,
}

/// Everything the comparison found, including what it could not explain.
///
/// The leftovers are not an afterthought — they are the working list. A shop
/// accepts the suggestions in a moment and then spends its evening on these,
/// and a result that returned only the easy half would leave the screen unable
/// to say what remains.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TenderSuggestions {
    pub suggestions: Vec<TenderSuggestion>,
    pub receipts_without_approval: Vec<UnexplainedReceipt>,
    pub approvals_without_receipt: Vec<String>,
}

/// Pair one evening's receipts against one evening's approvals.
///
/// `approvals` is every approval the shop settled that day, across every
/// terminal — not just this reconciliation's own. That is what makes the
/// cross-acquirer rule possible: a retender is by definition an approval on a
/// machine other than the one the receipt names, so a kernel handed only one
/// terminal's slip could never see it.
///
/// Greedy and in the order given, so the same two lists always produce the same
/// pairing. Where several approvals are interchangeable — same acquirer, same
/// day, same amount — which one is claimed does not matter, because claiming
/// either leaves the other available for the next receipt that wants it.
pub fn suggest_tender_decisions(
    receipts: &[ReceiptTender],
    approvals: &[BatchApproval],
) -> TenderSuggestions {
    let mut claimed = vec![false; approvals.len()];
    let mut paired = vec![false; receipts.len()];
    let mut result = TenderSuggestions::default();

    // Same acquirer first, and all of them, before any cross-acquirer guess is
    // considered. Interleaving the two would let a retender suggestion claim an
    // approval that a plain match had a better title to, and the shop would be
    // asked to move a receivable that was never in the wrong place.
    for (index, receipt) in receipts.iter().enumerate() {
        let same_acquirer = approvals
            .iter()
            .enumerate()
            .find(|(at, approval)| {
                !claimed[*at]
                    && same_payment(receipt, approval)
                    && (receipt.acquirer.is_empty() || approval.acquirer == receipt.acquirer)
            })
            .map(|(at, _)| at);
        if let Some(slot) = same_acquirer {
            claimed[slot] = true;
            paired[index] = true;
            result.suggestions.push(TenderSuggestion {
                sale_id: receipt.sale_id.clone(),
                tender_seq: receipt.tender_seq,
                batch_line_id: approvals[slot].batch_line_id.clone(),
                decision: SuggestedTenderDecision::Matched,
                from_acquirer: None,
                to_acquirer: None,
                reason: format!(
                    "{} approved {} on terminal {} the same day",
                    approvals[slot].acquirer, approvals[slot].amount_minor, approvals[slot].terminal_id
                ),
            });
        }
    }

    for (index, receipt) in receipts.iter().enumerate() {
        // A receipt naming no acquirer cannot be evidence that the books name
        // the wrong one. See the header.
        if paired[index] || receipt.acquirer.is_empty() {
            continue;
        }
        let candidates: Vec<usize> = approvals
            .iter()
            .enumerate()
            .filter(|(at, approval)| {
                !claimed[*at] && same_payment(receipt, approval) && approval.acquirer != receipt.acquirer
            })
            .map(|(at, _)| at)
            .collect();

        // Exactly one other acquirer offering it, or nothing. Several
        // candidates naming ONE acquirer is still one answer — the same
        // interchangeability a match relies on — and only a second acquirer
        // makes the evening genuinely ambiguous.
        let mut named: Vec<&str> = candidates
            .iter()
            .map(|at| approvals[*at].acquirer.as_str())
            .collect();
        named.sort_unstable();
        named.dedup();

        if named.len() != 1 {
            continue;
        }
        if let Some(slot) = candidates.first().copied() {
            claimed[slot] = true;
            paired[index] = true;
            result.suggestions.push(TenderSuggestion {
                sale_id: receipt.sale_id.clone(),
                tender_seq: receipt.tender_seq,
                batch_line_id: approvals[slot].batch_line_id.clone(),
                decision: SuggestedTenderDecision::Retender,
                from_acquirer: Some(receipt.acquirer.clone()),
                to_acquirer: Some(approvals[slot].acquirer.clone()),
                reason: format!(
                    "the receipt says {} but {} approved {} on terminal {} the same day",
                    receipt.acquirer,
                    approvals[slot].acquirer,
                    approvals[slot].amount_minor,
                    approvals[slot].terminal_id
                ),
            });
        }
    }

    for (index, receipt) in receipts.iter().enumerate() {
        if !paired[index] {
            result.receipts_without_approval.push(UnexplainedReceipt {
                sale_id: receipt.sale_id.clone(),
                tender_seq: receipt.tender_seq,
                amount_minor: receipt.amount_minor,
                acquirer: receipt.acquirer.clone(),
            });
        }
    }
    for (at, approval) in approvals.iter().enumerate() {
        if !claimed[at] {
            result
                .approvals_without_receipt
                .push(approval.batch_line_id.clone());
        }
    }
    result
}

/// The same day and the same money. Exact on both, for the reason in the
/// header: an amount that is nearly right is a different payment.
fn same_payment(receipt: &ReceiptTender, approval: &BatchApproval) -> bool {
    receipt.day == approval.day && receipt.amount_minor == approval.amount_minor
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt(sale: &str, seq: i32, acquirer: &str, amount: i64) -> ReceiptTender {
        ReceiptTender {
            sale_id: sale.into(),
            tender_seq: seq,
            day: 20_000,
            acquirer: acquirer.into(),
            amount_minor: amount,
        }
    }

    fn approval(id: &str, terminal: &str, acquirer: &str, amount: i64) -> BatchApproval {
        BatchApproval {
            batch_line_id: id.into(),
            terminal_id: terminal.into(),
            acquirer: acquirer.into(),
            day: 20_000,
            amount_minor: amount,
        }
    }

    #[test]
    fn equal_amounts_on_the_same_acquirer_pair() {
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "BCA", 250_000)],
            &[approval("b1", "EDC-1", "BCA", 250_000)],
        );
        assert_eq!(found.suggestions.len(), 1);
        assert_eq!(
            found.suggestions[0].decision,
            SuggestedTenderDecision::Matched
        );
        assert_eq!(found.suggestions[0].from_acquirer, None);
        assert!(found.receipts_without_approval.is_empty());
        assert!(found.approvals_without_receipt.is_empty());
    }

    #[test]
    fn the_same_amount_on_another_acquirer_is_a_retender() {
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "BCA", 250_000)],
            &[approval("b1", "EDC-2", "MANDIRI", 250_000)],
        );
        assert_eq!(found.suggestions.len(), 1);
        assert_eq!(
            found.suggestions[0].decision,
            SuggestedTenderDecision::Retender
        );
        assert_eq!(found.suggestions[0].from_acquirer.as_deref(), Some("BCA"));
        assert_eq!(found.suggestions[0].to_acquirer.as_deref(), Some("MANDIRI"));
    }

    #[test]
    fn a_plain_match_is_never_given_up_for_a_retender() {
        // The receipt says BCA and BCA has it. A MANDIRI slip for the same
        // money is somebody else's payment, and pairing it here would move a
        // receivable that was in the right place all along.
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "BCA", 250_000)],
            &[
                approval("b-mandiri", "EDC-2", "MANDIRI", 250_000),
                approval("b-bca", "EDC-1", "BCA", 250_000),
            ],
        );
        assert_eq!(found.suggestions.len(), 1);
        assert_eq!(found.suggestions[0].batch_line_id, "b-bca");
        assert_eq!(found.approvals_without_receipt, vec!["b-mandiri"]);
    }

    #[test]
    fn two_other_acquirers_offering_the_same_amount_is_left_to_a_person() {
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "BCA", 250_000)],
            &[
                approval("b1", "EDC-2", "MANDIRI", 250_000),
                approval("b2", "EDC-3", "BRI", 250_000),
            ],
        );
        assert!(found.suggestions.is_empty());
        assert_eq!(found.receipts_without_approval.len(), 1);
        assert_eq!(found.approvals_without_receipt.len(), 2);
    }

    #[test]
    fn a_receipt_naming_no_machine_matches_rather_than_accuses() {
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "", 250_000)],
            &[approval("b1", "EDC-2", "MANDIRI", 250_000)],
        );
        assert_eq!(found.suggestions.len(), 1);
        assert_eq!(
            found.suggestions[0].decision,
            SuggestedTenderDecision::Matched
        );
        assert_eq!(found.suggestions[0].from_acquirer, None);
    }

    #[test]
    fn a_different_day_is_a_different_payment() {
        let mut late = approval("b1", "EDC-1", "BCA", 250_000);
        late.day = 20_001;
        let found = suggest_tender_decisions(&[receipt("s1", 0, "BCA", 250_000)], &[late]);
        assert!(found.suggestions.is_empty());
        assert_eq!(found.receipts_without_approval.len(), 1);
    }

    #[test]
    fn an_amount_that_is_nearly_right_is_not_a_match() {
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "BCA", 250_000)],
            &[approval("b1", "EDC-1", "BCA", 250_001)],
        );
        assert!(found.suggestions.is_empty());
    }

    #[test]
    fn interchangeable_approvals_are_claimed_once_each() {
        let found = suggest_tender_decisions(
            &[receipt("s1", 0, "BCA", 100_000), receipt("s2", 0, "BCA", 100_000)],
            &[
                approval("b1", "EDC-1", "BCA", 100_000),
                approval("b2", "EDC-1", "BCA", 100_000),
            ],
        );
        assert_eq!(found.suggestions.len(), 2);
        assert_eq!(found.suggestions[0].batch_line_id, "b1");
        assert_eq!(found.suggestions[1].batch_line_id, "b2");
        assert!(found.approvals_without_receipt.is_empty());
    }

    #[test]
    fn an_approval_nobody_rang_up_comes_back_as_one() {
        let found =
            suggest_tender_decisions(&[], &[approval("b1", "EDC-1", "BCA", 100_000)]);
        assert!(found.suggestions.is_empty());
        assert_eq!(found.approvals_without_receipt, vec!["b1"]);
    }

    #[test]
    fn the_same_two_lists_give_the_same_answer_twice() {
        let receipts = [receipt("s1", 0, "BCA", 100_000), receipt("s2", 1, "BCA", 100_000)];
        let approvals = [
            approval("b1", "EDC-1", "BCA", 100_000),
            approval("b2", "EDC-1", "BCA", 100_000),
        ];
        assert_eq!(
            suggest_tender_decisions(&receipts, &approvals),
            suggest_tender_decisions(&receipts, &approvals)
        );
    }
}
