//! What a person may say about a line of money, and what they may not.
//!
//! Three decisions live here, and none of them needs a database to make:
//!
//! * **Whether a category can possibly explain this line.** Money out cannot
//!   be interest received. The direction is a fact about the category and the
//!   direction of the line is a fact about the line, so the filter is
//!   arithmetic and belongs where it can be checked exhaustively.
//!
//! * **Whether it may be posted straight from a bank statement.** Most of the
//!   list may not, and the reasons differ: the money belongs to a document
//!   another screen owns, or the act needs a second signature. Both refusals
//!   have to name what to do instead, because a refusal that only says no
//!   teaches people to pick the neighbouring category.
//!
//! * **What is still missing before it can be written down.** A party, a
//!   reference, a qualifier saying which bank. Asked here rather than by the
//!   database, so the sentence names the thing rather than the constraint.
//!
//! # The order of the doors
//!
//! [`DOOR_ORDER`] is the whole shape of reconciliation in three words, and it
//! is here rather than in the query that builds a screen because it is a rule
//! about accounting and not about SQL. **Match** first: the event is almost
//! always already in the books, and finding it is the only outcome that leaves
//! one record of one thing. **Create** second: it should have been in the books
//! and is not, so make the document that was missed. **Categorise** last and
//! only for what genuinely has no document — a bank charge, interest credited,
//! a rounding difference, the tax the bank withheld.
//!
//! Offering them the other way round is how a reconciliation screen turns into
//! a machine for double-counting: categorising is the quickest of the three and
//! always available, so a person shown it first will use it on lines that had a
//! payment sitting one door away.
//!
//! This module is pure. It cannot read `transaction_category`, which is the
//! point — every fact about a category arrives as a [`CategoryFacts`], so the
//! same category and the same line give the same answer whoever asks and
//! whenever.

use serde::{Deserialize, Serialize};

/// The three doors, in the order they must be offered.
///
/// Read by the options endpoint to stamp each block, and asserted on by the
/// integration test, so a screen that reordered them would have to reorder this
/// and say why in a diff somebody reviews.
pub const DOOR_ORDER: [&str; 3] = ["MATCH", "CREATE", "CATEGORISE"];

/// The `source_document` values that mean "this category makes its own paper".
///
/// Everything else names a document some other part of the system owns, and a
/// category naming one of those may never be posted from a statement line: the
/// event it describes was recognised when that document was.
pub const SELF_CONTAINED_DOCUMENTS: [&str; 3] = ["DIRECT_EXPENSE", "RECEIPT", "TRANSFER"];

/// Which way the money has to be going for a category to be a possible answer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CategoryDirection {
    /// Money leaving: a debit on the bank's own statement.
    Outflow,
    /// Money arriving.
    Inflow,
    /// Either, and always for a reason. A rounding difference falls both ways
    /// by definition; a loan is drawn and repaid against one liability; an
    /// inter-unit balance moves in both directions between the same two units.
    Both,
}

impl CategoryDirection {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "OUTFLOW" => Some(Self::Outflow),
            "INFLOW" => Some(Self::Inflow),
            "BOTH" => Some(Self::Both),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Outflow => "OUTFLOW",
            Self::Inflow => "INFLOW",
            Self::Both => "BOTH",
        }
    }

    /// Can this category explain a line going that way?
    ///
    /// `outgoing` is the bank's own sense: true when the statement shows a
    /// debit, which is money leaving the account. That translation is made
    /// once, where the line is read, and never again — `bank_match` and
    /// `banking::bank_line_to_document` both make it the same way, and a second
    /// convention here would produce a category list that was right on the
    /// screen and wrong when it posted.
    pub fn fits(self, outgoing: bool) -> bool {
        match self {
            Self::Outflow => outgoing,
            Self::Inflow => !outgoing,
            Self::Both => true,
        }
    }
}

/// Everything about one category that a decision here depends on.
///
/// Borrowed rather than owned: the caller has just read a row and this is a
/// view onto it, so nothing is cloned to ask a question about it.
#[derive(Clone, Copy, Debug)]
pub struct CategoryFacts<'a> {
    pub code: &'a str,
    pub display_name: &'a str,
    pub direction: CategoryDirection,
    /// `DIRECT_EXPENSE`, `RECEIPT`, `TRANSFER`, or the document a person
    /// should go and find instead.
    pub source_document: &'a str,
    /// Whether a statement line may be turned straight into this.
    pub bank_postable: bool,
    /// Why not, when it may not be. The database keeps these two in step.
    pub refusal: Option<&'a str>,
    pub active: bool,
    pub requires_party: bool,
    pub requires_reference: bool,
    pub requires_approval: bool,
    /// True when the meaning covers several accounts and only the caller knows
    /// which — a bank, a unit, a class of asset.
    pub qualifier_asked: bool,
}

/// Does this category make its own paper, or point at somebody else's?
pub fn makes_its_own_document(source_document: &str) -> bool {
    SELF_CONTAINED_DOCUMENTS.contains(&source_document)
}

/// Should this category be offered at all against a line going this way?
///
/// A retired category is offered to nobody, and a category whose direction does
/// not fit is not offered — not offered-and-greyed. A choice that can only ever
/// be wrong is worse than a shorter list: somebody will pick it, because it is
/// on the list, and the only thing standing between them and a wrong posting
/// would be a message they read after clicking.
pub fn offered_for_line(facts: &CategoryFacts<'_>, outgoing: bool) -> bool {
    facts.active && facts.direction.fits(outgoing)
}

/// Why this category may not be posted straight from a bank line, if it may not.
///
/// The sentence is the category's own, because only the category knows what to
/// say — "find the payroll payment" and "have it approved" are different
/// instructions and a generic refusal would give neither. What this adds is the
/// fallback for a row that somehow has no sentence: the schema makes that
/// impossible, and a kernel that trusted the schema and unwrapped would be one
/// bad row away from a panic on a screen.
pub fn refuse_from_bank_line(facts: &CategoryFacts<'_>) -> Option<String> {
    if !facts.active {
        return Some(format!(
            "'{}' has been retired; it explains nothing new",
            facts.display_name
        ));
    }
    if facts.bank_postable && makes_its_own_document(facts.source_document) {
        return None;
    }
    Some(match facts.refusal {
        Some(said) => said.to_string(),
        None => format!(
            "'{}' cannot be posted from a bank line; it belongs to a {}",
            facts.display_name,
            facts.source_document.to_lowercase().replace('_', " ")
        ),
    })
}

/// What a person still has to say before this can be written down.
///
/// One sentence naming everything that is missing rather than one refusal per
/// field, because a form that refuses three times in a row for three different
/// reasons is a form people fill in by trial and error.
pub fn missing_before_posting(
    facts: &CategoryFacts<'_>,
    qualifier: Option<&str>,
    party_name: Option<&str>,
    reference: Option<&str>,
) -> Option<String> {
    let given = |value: Option<&str>| value.map(str::trim).is_some_and(|v| !v.is_empty());
    let mut wanted: Vec<&str> = Vec::new();
    if facts.qualifier_asked && !given(qualifier) {
        wanted.push("which account it is (the bank, or the unit)");
    }
    if facts.requires_party && !given(party_name) {
        wanted.push("who it was paid to or received from");
    }
    if facts.requires_reference && !given(reference) {
        wanted.push("the reference on the paper behind it");
    }
    if wanted.is_empty() {
        return None;
    }
    Some(format!(
        "'{}' needs {} before it can be written down",
        facts.display_name,
        join_with_and(&wanted)
    ))
}

/// `a`, `a and b`, `a, b and c`. English, because the sentence is read by a
/// person and a comma-separated list reads like a machine talking.
fn join_with_and(parts: &[&str]) -> String {
    match parts {
        [] => String::new(),
        [only] => (*only).to_string(),
        [first, last] => format!("{first} and {last}"),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts<'a>(
        direction: CategoryDirection,
        document: &'a str,
        postable: bool,
    ) -> CategoryFacts<'a> {
        CategoryFacts {
            code: "ops_bank_charges",
            display_name: "Bank charges",
            direction,
            source_document: document,
            bank_postable: postable,
            refusal: if postable {
                None
            } else {
                Some("payroll is paid against a sealed payroll run — find the payment")
            },
            active: true,
            requires_party: false,
            requires_reference: false,
            requires_approval: false,
            qualifier_asked: false,
        }
    }

    #[test]
    fn money_in_is_never_offered_an_outflow_category() {
        let out = facts(CategoryDirection::Outflow, "DIRECT_EXPENSE", true);
        assert!(offered_for_line(&out, true), "a debit is an outflow");
        assert!(
            !offered_for_line(&out, false),
            "a credit on the statement is money arriving, and no outflow category can explain it"
        );
    }

    #[test]
    fn money_out_is_never_offered_an_inflow_category() {
        let inflow = facts(CategoryDirection::Inflow, "RECEIPT", true);
        assert!(!offered_for_line(&inflow, true));
        assert!(offered_for_line(&inflow, false));
    }

    #[test]
    fn a_category_for_both_directions_fits_either() {
        let both = facts(CategoryDirection::Both, "TRANSFER", true);
        assert!(offered_for_line(&both, true));
        assert!(offered_for_line(&both, false));
    }

    #[test]
    fn a_retired_category_is_offered_to_nobody() {
        let mut retired = facts(CategoryDirection::Both, "TRANSFER", true);
        retired.active = false;
        assert!(!offered_for_line(&retired, true));
        assert!(!offered_for_line(&retired, false));
        assert!(refuse_from_bank_line(&retired).is_some());
    }

    #[test]
    fn a_category_that_makes_its_own_paper_is_not_refused() {
        for document in SELF_CONTAINED_DOCUMENTS {
            let ok = facts(CategoryDirection::Both, document, true);
            assert_eq!(refuse_from_bank_line(&ok), None, "{document}");
        }
    }

    #[test]
    fn a_category_that_points_at_another_document_is_refused_in_its_own_words() {
        let payroll = facts(CategoryDirection::Outflow, "PAYROLL_RUN", false);
        let refusal = refuse_from_bank_line(&payroll).unwrap_or_default();
        assert!(
            refusal.contains("payroll run"),
            "the refusal names the document to find instead: {refusal}"
        );
    }

    /// The schema makes this impossible. The kernel still cannot panic on it.
    #[test]
    fn a_refusal_with_no_sentence_still_says_something_useful() {
        let mut broken = facts(CategoryDirection::Outflow, "SUPPLIER_PAYMENT", false);
        broken.refusal = None;
        let refusal = refuse_from_bank_line(&broken).unwrap_or_default();
        assert!(refusal.contains("supplier payment"), "{refusal}");
    }

    /// Both halves are needed. A category that says DIRECT_EXPENSE and is not
    /// bank-postable is one needing a signature, and it stays refused.
    #[test]
    fn needing_a_signature_refuses_even_though_it_makes_its_own_paper() {
        let mut drawing = facts(CategoryDirection::Outflow, "DIRECT_EXPENSE", false);
        drawing.requires_approval = true;
        drawing.refusal = Some("key the cash document and have it approved");
        assert!(refuse_from_bank_line(&drawing).is_some());
    }

    #[test]
    fn everything_missing_is_named_in_one_sentence() {
        let mut fussy = facts(CategoryDirection::Outflow, "DIRECT_EXPENSE", true);
        fussy.qualifier_asked = true;
        fussy.requires_party = true;
        fussy.requires_reference = true;
        let said = missing_before_posting(&fussy, None, Some("  "), None).unwrap_or_default();
        assert!(said.contains("which account"), "{said}");
        assert!(said.contains("who it was paid to"), "{said}");
        assert!(said.contains("reference"), "{said}");
        assert_eq!(
            said.matches(" and ").count(),
            1,
            "one 'and', not three: {said}"
        );
    }

    #[test]
    fn nothing_is_missing_when_everything_was_given() {
        let mut fussy = facts(CategoryDirection::Outflow, "DIRECT_EXPENSE", true);
        fussy.qualifier_asked = true;
        fussy.requires_party = true;
        fussy.requires_reference = true;
        assert_eq!(
            missing_before_posting(&fussy, Some("BCA"), Some("PLN"), Some("SSP-1")),
            None
        );
    }

    #[test]
    fn a_blank_is_not_an_answer() {
        let mut fussy = facts(CategoryDirection::Outflow, "DIRECT_EXPENSE", true);
        fussy.requires_party = true;
        assert!(missing_before_posting(&fussy, None, Some(""), None).is_some());
        assert!(missing_before_posting(&fussy, None, Some("\t \n"), None).is_some());
    }

    #[test]
    fn the_doors_are_tried_in_the_order_that_stops_double_counting() {
        assert_eq!(DOOR_ORDER, ["MATCH", "CREATE", "CATEGORISE"]);
    }

    #[test]
    fn directions_round_trip_through_their_stored_word() {
        for direction in [
            CategoryDirection::Outflow,
            CategoryDirection::Inflow,
            CategoryDirection::Both,
        ] {
            assert_eq!(
                CategoryDirection::parse(direction.as_str()),
                Some(direction)
            );
        }
        assert_eq!(CategoryDirection::parse("sideways"), None);
        assert_eq!(
            CategoryDirection::parse(" inflow "),
            Some(CategoryDirection::Inflow),
            "read back what a person typed, not only what the database stores"
        );
    }
}
