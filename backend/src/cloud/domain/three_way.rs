//! Order, delivery, bill: the arithmetic of agreeing that three documents
//! describe the same goods.
//!
//! Pure, and checked by `kernel_purity` for the reason the depreciation kernel
//! is. A tolerance that could read the clock would accept a price on Tuesday
//! and refuse it on Wednesday; one that could read the database would be
//! impossible to check exhaustively. Everything it needs — what the order
//! agreed, what the bay accepted, what the supplier charged — arrives as an
//! argument, so the same three documents give the same verdict forever.
//!
//! # The two faults are not the same fault
//!
//! Billing for more than was accepted is a fact, and it is refused. The count
//! was made by one person and verified by another at the moment the goods were
//! in the room, and nothing later can improve on it.
//!
//! Billing at a different price is a DISAGREEMENT, and it is somebody's
//! decision. A small one is ordinary — a rate agreed after the order was
//! raised, a rounding on a per-piece price — and passes. A large one is a
//! conversation with the supplier, so it is refused until whoever is matching
//! says in the request that the difference is accepted. Either way the money
//! ends up in the same place: a purchase price variance, on its own account,
//! rather than quietly inside the value of the stock.

/// How much a price may differ from the order and still be nobody's decision.
///
/// Two limits, and a line passes if it is inside EITHER. A relative one alone
/// would refuse a 40-rupiah rounding on a 2,000-rupiah sock; an absolute one
/// alone would wave through 900,000 on a coat priced at 900,000. Each covers
/// the case the other gets wrong.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchTolerance {
    /// Basis points of the ordered unit price. 100 = 1%.
    pub unit_price_bp: i64,
    /// Absolute difference on the line, in the currency's minor unit.
    pub line_amount_minor: i64,
}

impl Default for MatchTolerance {
    /// One per cent, or a thousand rupiah on the line, whichever is kinder.
    ///
    /// Not derived from anything the client has written down, because they have
    /// not written one down. It is a starting point chosen to pass the
    /// differences a rounding produces and to stop the ones a person should
    /// look at, and it is a parameter precisely so Finance can move it without
    /// a release.
    fn default() -> Self {
        Self {
            unit_price_bp: 100,
            line_amount_minor: 1_000,
        }
    }
}

/// One line of a bill, beside the delivery line it answers.
///
/// The join is the caller's — it is a database question — and the arithmetic is
/// here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchLine {
    pub line_number: i32,
    pub billed_quantity: i64,
    pub billed_unit_price_minor: i64,
    /// What the bay accepted on the delivery line this bill line names.
    pub accepted_quantity: i64,
    /// What the order agreed to pay for one of them.
    pub ordered_unit_price_minor: i64,
}

/// Why a line did not match.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineFault {
    /// The supplier billed for more than arrived.
    OverBilled {
        line_number: i32,
        billed_quantity: i64,
        accepted_quantity: i64,
    },
    /// The price differs by more than the tolerance allows.
    PriceOutsideTolerance {
        line_number: i32,
        billed_unit_price_minor: i64,
        ordered_unit_price_minor: i64,
        /// Signed, in basis points of the ordered price. Positive: dearer than
        /// agreed.
        difference_bp: i64,
    },
}

impl LineFault {
    /// Whether a person may wave this through.
    ///
    /// A price disagreement is a decision somebody is allowed to make. A
    /// quantity that was never delivered is not: accepting it would be agreeing
    /// to pay for goods that are not in the building.
    pub const fn is_acceptable(&self) -> bool {
        matches!(self, Self::PriceOutsideTolerance { .. })
    }

    pub fn line_number(&self) -> i32 {
        match self {
            Self::OverBilled { line_number, .. } => *line_number,
            Self::PriceOutsideTolerance { line_number, .. } => *line_number,
        }
    }
}

/// What the three documents say when they are laid beside each other.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct MatchOutcome {
    pub faults: Vec<LineFault>,
    /// What the bill charges for these lines.
    pub billed_value_minor: i64,
    /// What the same quantities are worth at the ordered price — which is what
    /// the delivery was valued at when it was received.
    pub ordered_value_minor: i64,
}

impl MatchOutcome {
    /// Billed minus ordered. Positive is a debit to purchase price variance.
    pub const fn variance_minor(&self) -> i64 {
        self.billed_value_minor - self.ordered_value_minor
    }

    /// Nothing at all to decide.
    pub fn is_clean(&self) -> bool {
        self.faults.is_empty()
    }

    /// Every fault is one somebody is allowed to accept.
    pub fn is_acceptable(&self) -> bool {
        self.faults.iter().all(LineFault::is_acceptable)
    }
}

/// Signed difference between a billed and an ordered unit price, in basis
/// points of the ordered price.
///
/// An ordered price of zero has no percentage to be a difference of. A free
/// line billed for anything at all is reported as the largest difference the
/// type can hold rather than as a division, which keeps the caller from having
/// to special-case it and keeps the sign honest.
pub fn price_difference_bp(billed_unit_price_minor: i64, ordered_unit_price_minor: i64) -> i64 {
    if ordered_unit_price_minor == 0 {
        return if billed_unit_price_minor == 0 {
            0
        } else {
            i64::MAX
        };
    }
    let difference = (billed_unit_price_minor - ordered_unit_price_minor) as i128 * 10_000;
    (difference / ordered_unit_price_minor as i128) as i64
}

/// Lay the bill beside the deliveries and say what disagrees.
pub fn match_bill_to_deliveries(lines: &[MatchLine], tolerance: MatchTolerance) -> MatchOutcome {
    let mut outcome = MatchOutcome::default();
    for line in lines {
        outcome.billed_value_minor += line.billed_quantity * line.billed_unit_price_minor;
        outcome.ordered_value_minor += line.billed_quantity * line.ordered_unit_price_minor;

        if line.billed_quantity > line.accepted_quantity {
            outcome.faults.push(LineFault::OverBilled {
                line_number: line.line_number,
                billed_quantity: line.billed_quantity,
                accepted_quantity: line.accepted_quantity,
            });
        }

        let difference_bp =
            price_difference_bp(line.billed_unit_price_minor, line.ordered_unit_price_minor);
        let on_the_line = (line.billed_unit_price_minor - line.ordered_unit_price_minor)
            .saturating_mul(line.billed_quantity)
            .abs();
        let within = difference_bp.saturating_abs() <= tolerance.unit_price_bp
            || on_the_line <= tolerance.line_amount_minor;
        if !within {
            outcome.faults.push(LineFault::PriceOutsideTolerance {
                line_number: line.line_number,
                billed_unit_price_minor: line.billed_unit_price_minor,
                ordered_unit_price_minor: line.ordered_unit_price_minor,
                difference_bp,
            });
        }
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(number: i32, billed_qty: i64, billed_price: i64, accepted: i64, ordered: i64) -> MatchLine {
        MatchLine {
            line_number: number,
            billed_quantity: billed_qty,
            billed_unit_price_minor: billed_price,
            accepted_quantity: accepted,
            ordered_unit_price_minor: ordered,
        }
    }

    #[test]
    fn a_bill_that_says_what_arrived_at_the_agreed_price_is_clean() {
        let outcome =
            match_bill_to_deliveries(&[line(1, 120, 85_000, 120, 85_000)], MatchTolerance::default());
        assert!(outcome.is_clean());
        assert_eq!(outcome.variance_minor(), 0);
        assert_eq!(outcome.billed_value_minor, 10_200_000);
    }

    #[test]
    fn billing_for_more_than_arrived_is_a_fault_nobody_may_accept() {
        let outcome =
            match_bill_to_deliveries(&[line(1, 130, 85_000, 120, 85_000)], MatchTolerance::default());
        assert_eq!(
            outcome.faults,
            vec![LineFault::OverBilled {
                line_number: 1,
                billed_quantity: 130,
                accepted_quantity: 120,
            }]
        );
        assert!(!outcome.is_acceptable());
    }

    #[test]
    fn a_rounding_passes_and_leaves_a_variance() {
        // Eight rupiah a piece on 120 pieces: inside both limits, and still a
        // variance that has to land somewhere.
        let outcome =
            match_bill_to_deliveries(&[line(1, 120, 85_008, 120, 85_000)], MatchTolerance::default());
        assert!(outcome.is_clean());
        assert_eq!(outcome.variance_minor(), 960);
    }

    #[test]
    fn a_real_price_rise_is_refused_until_somebody_accepts_it() {
        let outcome =
            match_bill_to_deliveries(&[line(1, 120, 93_500, 120, 85_000)], MatchTolerance::default());
        assert_eq!(outcome.faults.len(), 1);
        assert!(outcome.is_acceptable(), "a price is a decision, not a fact");
        assert_eq!(outcome.variance_minor(), 1_020_000);
        match outcome.faults[0] {
            LineFault::PriceOutsideTolerance { difference_bp, .. } => assert_eq!(difference_bp, 1_000),
            other => panic!("expected a price fault, got {other:?}"),
        }
    }

    #[test]
    fn cheaper_than_agreed_is_a_credit_and_still_a_disagreement() {
        let outcome =
            match_bill_to_deliveries(&[line(1, 10, 60_000, 10, 85_000)], MatchTolerance::default());
        assert!(outcome.variance_minor() < 0);
        assert_eq!(outcome.variance_minor(), -250_000);
        assert_eq!(outcome.faults.len(), 1);
    }

    #[test]
    fn a_free_line_that_is_billed_for_is_the_largest_difference_there_is() {
        assert_eq!(price_difference_bp(0, 0), 0);
        assert_eq!(price_difference_bp(1, 0), i64::MAX);
        let outcome = match_bill_to_deliveries(&[line(1, 5, 12_000, 5, 0)], MatchTolerance::default());
        assert_eq!(outcome.faults.len(), 1);
    }

    #[test]
    fn a_tiny_absolute_difference_passes_even_on_a_cheap_line() {
        // 40 rupiah on a 2,000-rupiah sock is two per cent — outside the
        // relative limit and well inside the absolute one.
        let outcome = match_bill_to_deliveries(&[line(1, 10, 2_040, 10, 2_000)], MatchTolerance::default());
        assert!(outcome.is_clean(), "faults: {:?}", outcome.faults);
    }
}
