//! The ladder a giro climbs, and the two ways it ends.
//!
//! A giro is a promise to pay on a date. Between writing it and the bank
//! taking it there is a stretch — thirty, sixty, ninety days — during which the
//! company owes the money and the bank account has not moved. Every state below
//! exists because somebody has to be able to answer a question about that
//! stretch:
//!
//!   ISSUED     written. What the payable turned into.
//!   DELIVERED  in the supplier's hands. The difference between one we can
//!              still tear up and one we cannot.
//!   DUE        the date has arrived and the bank has not taken it. This is the
//!              state that makes "overdue" sayable, and it is why the ladder is
//!              not simply ISSUED -> CLEARED.
//!   CLEARED    the bank took it. The only state in which the bank balance
//!              moves.
//!   REJECTED   it bounced, or we stopped it. The issue posting is reversed and
//!              the debt comes back.
//!
//! # Why the ladder is here and not in SQL
//!
//! The database refuses a settled giro being unsettled, which is the invariant
//! that protects the money. What it cannot say helpfully is WHICH move somebody
//! attempted and why it is not allowed — a CHECK constraint's message names a
//! constraint. This says "a rejected giro cannot be cleared", which is the
//! sentence a person needs.
//!
//! Pure: the ladder is a fact about the states, not about any particular giro,
//! any date, or anything in a table.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GiroState {
    Issued,
    Delivered,
    Due,
    Cleared,
    Rejected,
    /// The payment that wrote it was reversed before the bank took it: the
    /// leaf is torn up, not bounced (0712).
    Voided,
}

impl GiroState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Issued => "ISSUED",
            Self::Delivered => "DELIVERED",
            Self::Due => "DUE",
            Self::Cleared => "CLEARED",
            Self::Rejected => "REJECTED",
            Self::Voided => "VOIDED",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "ISSUED" => Some(Self::Issued),
            "DELIVERED" => Some(Self::Delivered),
            "DUE" => Some(Self::Due),
            "CLEARED" => Some(Self::Cleared),
            "REJECTED" => Some(Self::Rejected),
            "VOIDED" => Some(Self::Voided),
            _ => None,
        }
    }

    /// Is this the end of the road?
    pub fn is_settled(self) -> bool {
        matches!(self, Self::Cleared | Self::Rejected | Self::Voided)
    }

    /// Does this giro still sit on `giro_outstanding`?
    ///
    /// The three live states do; the two settled ones do not, one because the
    /// bank took it and one because the posting that put it there was
    /// reversed. This is the predicate the board totals by, and having it here
    /// rather than in a WHERE clause is what stops the board and the ledger
    /// disagreeing about what "outstanding" means.
    pub fn is_outstanding(self) -> bool {
        !self.is_settled()
    }
}

/// May a giro move from one state to another, and if not, why not.
///
/// Forward only, and the two settled states are terminal. A cleared giro walked
/// back and cleared again would post a second, perfectly balanced entry moving
/// money that only moved once — the kind of mistake that balances, which is the
/// kind that survives a year.
///
/// Skipping a rung is allowed on purpose. A giro handed over the same afternoon
/// it was written and taken by the bank a week later never passes through DUE,
/// and a system that insisted it did would teach people to click through states
/// that did not happen.
pub fn giro_may_move(from: GiroState, to: GiroState) -> Result<(), String> {
    if from == to {
        return Err(format!(
            "this giro is already {}",
            to.as_str().to_lowercase()
        ));
    }
    if from.is_settled() {
        return Err(format!(
            "this giro is {} and cannot become {}; a settled giro is settled",
            from.as_str().to_lowercase(),
            to.as_str().to_lowercase()
        ));
    }
    if rung(to) < rung(from) {
        return Err(format!(
            "a giro does not go back from {} to {}",
            from.as_str().to_lowercase(),
            to.as_str().to_lowercase()
        ));
    }
    Ok(())
}

/// May a giro's clearing be taken back — Batal Cair, or the first half of a
/// bounce after clearing (0705)?
///
/// Only from CLEARED, and it is the one exception to "a settled giro is
/// settled": the clearing is not undone by editing it but by reversing its
/// entry, so nothing that moved is un-moved in place. A REJECTED giro stays
/// rejected; a giro not yet cleared has nothing to take back.
pub fn giro_may_unclear(from: GiroState) -> Result<(), String> {
    match from {
        GiroState::Cleared => Ok(()),
        other => Err(format!(
            "this giro is {}, not cleared; there is no clearing to take back",
            other.as_str().to_lowercase()
        )),
    }
}

/// How far up the ladder a state sits. Not public: the ordering is an
/// implementation of the rule above, and exposing it would invite somebody to
/// compare two states somewhere else and get a different answer.
fn rung(state: GiroState) -> u8 {
    match state {
        GiroState::Issued => 0,
        GiroState::Delivered => 1,
        GiroState::Due => 2,
        GiroState::Cleared => 3,
        GiroState::Rejected => 3,
        GiroState::Voided => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_settled_giro_is_settled() {
        for settled in [GiroState::Cleared, GiroState::Rejected] {
            for anywhere in [
                GiroState::Issued,
                GiroState::Delivered,
                GiroState::Due,
                GiroState::Cleared,
                GiroState::Rejected,
            ] {
                assert!(
                    giro_may_move(settled, anywhere).is_err(),
                    "{settled:?} -> {anywhere:?} must be refused"
                );
            }
        }
    }

    #[test]
    fn a_giro_may_skip_a_rung_but_not_go_back() {
        assert!(giro_may_move(GiroState::Issued, GiroState::Cleared).is_ok());
        assert!(giro_may_move(GiroState::Issued, GiroState::Rejected).is_ok());
        assert!(giro_may_move(GiroState::Delivered, GiroState::Due).is_ok());
        assert!(giro_may_move(GiroState::Due, GiroState::Issued).is_err());
        assert!(giro_may_move(GiroState::Delivered, GiroState::Issued).is_err());
    }

    #[test]
    fn the_refusal_says_which_two_states_it_is_about() {
        let refusal = giro_may_move(GiroState::Cleared, GiroState::Rejected)
            .expect_err("a cleared giro cannot be rejected");
        assert!(refusal.contains("cleared"), "said: {refusal}");
        assert!(refusal.contains("rejected"), "said: {refusal}");
    }

    #[test]
    fn only_the_live_states_are_outstanding() {
        assert!(GiroState::Issued.is_outstanding());
        assert!(GiroState::Delivered.is_outstanding());
        assert!(GiroState::Due.is_outstanding());
        assert!(!GiroState::Cleared.is_outstanding());
        assert!(!GiroState::Rejected.is_outstanding());
    }

    #[test]
    fn every_stored_state_reads_back() {
        for state in [
            GiroState::Issued,
            GiroState::Delivered,
            GiroState::Due,
            GiroState::Cleared,
            GiroState::Rejected,
        ] {
            assert_eq!(GiroState::parse(state.as_str()), Some(state));
        }
        assert_eq!(GiroState::parse("BOUNCED"), None);
    }
}
