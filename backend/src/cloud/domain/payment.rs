//! Which screen a payment gets, and what a recipient's account may be shown as.
//!
//! # Why the pattern is decided here and not in the browser
//!
//! There is one money-execution layer with three primitives — PAY, RECEIVE,
//! TRANSFER — and seven presentation patterns sitting on top of it. A frontend
//! that picked its pattern by looking at which module it had come from would be
//! deciding the same thing in seven places, and the seventh would disagree: a
//! bill opened from Payables and the same bill opened from a supplier's page
//! would get different screens, and only one of them would offer allocation.
//!
//! So the choice is a function of the facts, it lives in one place, and it is
//! pure. Everything it needs arrives as an argument, which is why the whole
//! table of cases can be checked in microseconds and why the same source can
//! never resolve two ways depending on when it was asked.
//!
//! # The one rule that decides most of it
//!
//! Money moving between two accounts the company holds is a TRANSFER and can
//! never be a payment to anybody, whatever screen asked for it. That is checked
//! before the count of obligations is even looked at, because a "transfer" with
//! obligations attached is a mistake rather than a shape, and a resolver that
//! answered Pay Obligations for one would let somebody allocate a bank transfer
//! against a supplier's bills.
//!
//! # Masking
//!
//! A destination's account number is stored encrypted and is shown as a mask.
//! The mask is built here rather than in SQL so that one rule decides how much
//! of a number a screen may print, and so that the rule can be checked against
//! short numbers, empty numbers and numbers with spaces in them without a
//! database.

use serde::{Deserialize, Serialize};

/// The seven ways a payment is presented.
///
/// A closed set on purpose. An eighth pattern is a decision somebody has to
/// make in the open, not a string a caller can invent.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PaymentPattern {
    /// One obligation, one recipient, one amount.
    SinglePayment,
    /// Several open obligations for one party, and a sum to spread across them.
    PayObligations,
    /// Many recipients, one instruction. Payroll is the obvious one; it is not
    /// the only one.
    BatchPayout,
    /// Money handed to somebody who will account for it later — a store
    /// manager's float. It leaves the bank and stays the company's.
    FundCustodian,
    /// Between two accounts the company holds. Nobody is paid.
    MoneyTransfer,
    /// Money arriving: a settlement, a refund, a customer paying.
    ReceiveMoney,
    /// Paid on paper that clears later. The instrument is the point.
    GiroPayment,
}

impl PaymentPattern {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SinglePayment => "SINGLE_PAYMENT",
            Self::PayObligations => "PAY_OBLIGATIONS",
            Self::BatchPayout => "BATCH_PAYOUT",
            Self::FundCustodian => "FUND_CUSTODIAN",
            Self::MoneyTransfer => "MONEY_TRANSFER",
            Self::ReceiveMoney => "RECEIVE_MONEY",
            Self::GiroPayment => "GIRO_PAYMENT",
        }
    }

    /// Which of the three primitives this pattern executes as.
    ///
    /// Stated here so that no screen has to work it out, and so that the claim
    /// "there is no per-domain payment engine" is something the type system can
    /// be asked about rather than a sentence in a document.
    pub const fn primitive(self) -> &'static str {
        match self {
            Self::ReceiveMoney => "RECEIVE",
            Self::MoneyTransfer => "TRANSFER",
            _ => "PAY",
        }
    }

    /// Whether this pattern presents the Payment Ledger's allocation surface.
    ///
    /// A transfer and a custodian float do not: neither settles anything a
    /// third party is owed, and offering allocation on them would invite
    /// somebody to point a bank transfer at a supplier's bills.
    pub const fn allocates(self) -> bool {
        matches!(
            self,
            Self::SinglePayment | Self::PayObligations | Self::ReceiveMoney | Self::GiroPayment
        )
    }
}

/// Which way the money is going, from the company's side.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum PaymentDirection {
    Out,
    In,
}

/// The facts a pattern is chosen from.
///
/// Deliberately not "the source row". A resolver reads a bill, a batch or a
/// bank account and reduces it to this, so that the choice can be checked
/// exhaustively and so that a new source kind is a new reduction rather than a
/// new branch in the rule.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PaymentSourceShape {
    /// Both sides are accounts the company itself holds.
    pub between_own_accounts: bool,
    /// Money handed over against a later accounting, not against a debt.
    pub custodial: bool,
    /// Paid on an instrument that clears later.
    pub on_instrument: bool,
    /// How many distinct recipients this one act pays.
    pub recipients: usize,
    /// How many open obligations it answers.
    pub obligations: usize,
    pub direction: PaymentDirection,
}

impl PaymentSourceShape {
    /// The ordinary outgoing shape: one recipient, whatever obligations.
    pub const fn paying(obligations: usize) -> Self {
        Self {
            between_own_accounts: false,
            custodial: false,
            on_instrument: false,
            recipients: 1,
            obligations,
            direction: PaymentDirection::Out,
        }
    }
}

/// The one place a payment's screen is decided.
///
/// Order matters and is the argument of the function:
///
/// 1. **Between our own accounts** wins over everything. It is a TRANSFER,
///    nobody is paid, and no count of obligations can make it otherwise.
/// 2. **Incoming** is next. Money arriving is never a payout however many
///    parties it touches.
/// 3. **Custodial** before obligations, because a float answers no debt and a
///    resolver that checked obligations first would call a float with a stale
///    open item a Single Payment.
/// 4. **An instrument** before the count, because how it is paid changes the
///    screen more than how many bills it covers: a giro needs a number and a
///    due date before anything else can be filled in.
/// 5. **More than one recipient** is a Batch Payout.
/// 6. Then, and only then, the count of obligations picks between one and
///    several.
///
/// Zero obligations with one recipient is a Single Payment — an advance, a
/// deposit, a payment for something never billed. It is not an error, and a
/// rule that made it one would send every ad-hoc payment through a screen that
/// demands a bill.
pub fn payment_pattern_for(shape: PaymentSourceShape) -> PaymentPattern {
    if shape.between_own_accounts {
        return PaymentPattern::MoneyTransfer;
    }
    if matches!(shape.direction, PaymentDirection::In) {
        return PaymentPattern::ReceiveMoney;
    }
    if shape.custodial {
        return PaymentPattern::FundCustodian;
    }
    if shape.on_instrument {
        return PaymentPattern::GiroPayment;
    }
    if shape.recipients > 1 {
        return PaymentPattern::BatchPayout;
    }
    if shape.obligations > 1 {
        return PaymentPattern::PayObligations;
    }
    PaymentPattern::SinglePayment
}

// ---------------------------------------------------------------------------
// What a screen may print of an account number
// ---------------------------------------------------------------------------

/// How many trailing characters a mask keeps.
const VISIBLE_TAIL: usize = 4;

/// The number with everything but its digits taken out.
///
/// People key account numbers with spaces and dashes, and the same account
/// arrives written three ways from three screens. Normalising is what lets a
/// duplicate be found without decrypting anything, and what stops
/// `1234 5678` and `12345678` being stored as two destinations.
pub fn payment_account_digits(raw: &str) -> String {
    raw.chars().filter(char::is_ascii_digit).collect()
}

/// What a screen is allowed to show.
///
/// Four digits, and the rest as bullets — the form every Indonesian bank's own
/// statement uses, so a person can check it against paper. A number too short
/// to leave four hidden is masked entirely rather than shown: a five-digit
/// account displayed as `•2345` would be a mask that reveals the account.
///
/// An empty or digitless value masks to an empty string, and the caller refuses
/// it. Returning something that looked like a mask would let a destination be
/// created with no account behind it.
pub fn payment_account_mask(raw: &str) -> String {
    let digits = payment_account_digits(raw);
    if digits.is_empty() {
        return String::new();
    }
    if digits.len() <= VISIBLE_TAIL * 2 {
        return "•".repeat(digits.len());
    }
    let tail = &digits[digits.len() - VISIBLE_TAIL..];
    format!("{}{tail}", "•".repeat(digits.len() - VISIBLE_TAIL))
}

/// What to do when an item in a batch has no verified destination.
///
/// Configurable per batch and never defaulted silently, because the two answers
/// suit different money. A payroll run holds: paying nineteen of twenty people
/// and telling the twentieth to wait is worse than paying nobody today. A
/// supplier run skips: nineteen suppliers should not wait on one whose bank
/// details are being chased.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum UnverifiedDestinationPolicy {
    /// Leave the row unpaid, say so on it, and carry on with the rest.
    Skip,
    /// Stop the whole batch. Nothing is executed until somebody fixes it.
    Hold,
}

impl UnverifiedDestinationPolicy {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "SKIP" => Some(Self::Skip),
            "HOLD" => Some(Self::Hold),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Skip => "SKIP",
            Self::Hold => "HOLD",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape() -> PaymentSourceShape {
        PaymentSourceShape::paying(1)
    }

    #[test]
    fn two_of_our_own_accounts_is_a_transfer_whatever_else_is_true() {
        // Every other flag set the way that would otherwise pick a different
        // pattern. A transfer that could be talked into being a payment is the
        // failure this ordering exists to prevent.
        let moving = PaymentSourceShape {
            between_own_accounts: true,
            custodial: true,
            on_instrument: true,
            recipients: 40,
            obligations: 12,
            direction: PaymentDirection::Out,
        };
        assert_eq!(payment_pattern_for(moving), PaymentPattern::MoneyTransfer);
        assert_eq!(PaymentPattern::MoneyTransfer.primitive(), "TRANSFER");
        assert!(!PaymentPattern::MoneyTransfer.allocates());
    }

    #[test]
    fn one_bill_is_a_single_payment_and_two_are_pay_obligations() {
        assert_eq!(
            payment_pattern_for(PaymentSourceShape::paying(1)),
            PaymentPattern::SinglePayment
        );
        assert_eq!(
            payment_pattern_for(PaymentSourceShape::paying(2)),
            PaymentPattern::PayObligations
        );
        // And nothing open is still a payment somebody can make.
        assert_eq!(
            payment_pattern_for(PaymentSourceShape::paying(0)),
            PaymentPattern::SinglePayment
        );
    }

    #[test]
    fn many_recipients_is_a_batch_however_many_bills_each_of_them_has() {
        let payroll = PaymentSourceShape {
            recipients: 20,
            obligations: 20,
            ..shape()
        };
        assert_eq!(payment_pattern_for(payroll), PaymentPattern::BatchPayout);
        assert_eq!(PaymentPattern::BatchPayout.primitive(), "PAY");
    }

    #[test]
    fn a_float_answers_no_debt_even_when_something_is_open() {
        let float = PaymentSourceShape {
            custodial: true,
            obligations: 3,
            ..shape()
        };
        assert_eq!(payment_pattern_for(float), PaymentPattern::FundCustodian);
        assert!(!PaymentPattern::FundCustodian.allocates());
    }

    #[test]
    fn money_arriving_is_never_a_payout() {
        let settlement = PaymentSourceShape {
            direction: PaymentDirection::In,
            recipients: 9,
            obligations: 9,
            ..shape()
        };
        assert_eq!(
            payment_pattern_for(settlement),
            PaymentPattern::ReceiveMoney
        );
        assert_eq!(PaymentPattern::ReceiveMoney.primitive(), "RECEIVE");
        assert!(PaymentPattern::ReceiveMoney.allocates());
    }

    #[test]
    fn paper_that_clears_later_picks_its_own_screen() {
        let giro = PaymentSourceShape {
            on_instrument: true,
            obligations: 4,
            ..shape()
        };
        assert_eq!(payment_pattern_for(giro), PaymentPattern::GiroPayment);
    }

    #[test]
    fn a_mask_keeps_four_digits_and_hides_a_short_number_completely() {
        assert_eq!(payment_account_mask("1234567890"), "••••••7890");
        assert_eq!(payment_account_mask("0812 3456 7890"), "••••••••7890");
        // Eight digits or fewer: showing four would reveal half of it.
        assert_eq!(payment_account_mask("12345678"), "••••••••");
        assert_eq!(payment_account_mask("12345"), "•••••");
        assert_eq!(payment_account_mask(""), "");
        assert_eq!(payment_account_mask("no digits here"), "");
    }

    #[test]
    fn the_same_account_written_three_ways_normalises_to_one() {
        let forms = ["1234567890", "1234 567 890", "1234-567-890"];
        let digits: Vec<String> = forms.iter().map(|f| payment_account_digits(f)).collect();
        assert!(digits.iter().all(|d| d == "1234567890"), "{digits:?}");
    }

    #[test]
    fn every_pattern_executes_as_one_of_the_three_primitives() {
        for pattern in [
            PaymentPattern::SinglePayment,
            PaymentPattern::PayObligations,
            PaymentPattern::BatchPayout,
            PaymentPattern::FundCustodian,
            PaymentPattern::MoneyTransfer,
            PaymentPattern::ReceiveMoney,
            PaymentPattern::GiroPayment,
        ] {
            assert!(
                matches!(pattern.primitive(), "PAY" | "RECEIVE" | "TRANSFER"),
                "{pattern:?} executes as {}, which is not one of the three",
                pattern.primitive()
            );
        }
    }

    #[test]
    fn a_policy_survives_the_round_trip_through_its_stored_form() {
        for policy in [
            UnverifiedDestinationPolicy::Skip,
            UnverifiedDestinationPolicy::Hold,
        ] {
            assert_eq!(
                UnverifiedDestinationPolicy::parse(policy.as_str()),
                Some(policy)
            );
        }
        assert_eq!(UnverifiedDestinationPolicy::parse("MAYBE"), None);
    }
}
