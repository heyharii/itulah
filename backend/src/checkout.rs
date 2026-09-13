//! The state a checkout is in between "the shopper agreed" and "the sale is
//! written".
//!
//! A shop's sale record is atomic: one SQLite transaction writes the movement,
//! the sale, its tenders and its lines, and either all of it is there or none
//! of it is. That is the right shape and it is not the whole problem, because
//! **the money is taken outside that transaction**. A card terminal is asked
//! for Rp500.000, answers "approved" some seconds later, and only then is the
//! sale written. If the process dies in that gap — power, a crash, somebody
//! closing the lid — the shopper has been charged and the shop has no record
//! that anything happened at all. Not a wrong record: no record.
//!
//! Today the till cannot represent that state. `sale.status` is
//! `CHECK (status = 'COMPLETED')`, which is honest about what a `sale` row
//! means and leaves nowhere to write down an attempt. So the gap is invisible
//! until a customer comes back with a receipt from their bank and the shop has
//! nothing to match it against.
//!
//! # What FINALIZING is for
//!
//! A checkout is written as [`Finalizing`](CheckoutState::Finalizing) and
//! **committed** before the first tender is attempted. It carries what the till
//! is about to do: the amount, the tenders it intends, and the references it
//! will use. After that, every outcome is recoverable:
//!
//! - the sale commits — the checkout becomes [`Completed`](CheckoutState::Completed)
//!   in the same transaction, and the two can never disagree;
//! - the process dies — the checkout is still `Finalizing` at the next start,
//!   and the till knows exactly which acquirer references to ask about;
//! - a tender is declined — the checkout is [`Failed`](CheckoutState::Failed)
//!   with the reason, and any tender that DID succeed is named, so it can be
//!   reversed rather than quietly kept.
//!
//! The cost of the extra commit is one write per sale. The cost of not having
//! it is an unbounded number of charges nobody can reconcile.
//!
//! # Why the till is the authority here
//!
//! The centre finds out about a sale when the shop syncs, which may be minutes
//! or days later. An unresolved checkout is a problem that has to be worked at
//! the counter, with the customer still there, on a node that may have no
//! network. So the state machine lives at the till and the centre is told; the
//! reverse would make the fix require the thing that is broken.
//!
//! This module is pure. It knows the states, which moves between them are
//! legal, and what each state says about the money — no clock, no database, no
//! terminal. The transitions are the part that has to be right, and the part
//! that is worth testing without a shop.

use serde::{Deserialize, Serialize};

/// Where a checkout has got to.
///
/// Deliberately NOT the same set as `sale.status` at the centre
/// (`OPEN`/`COMPLETED`/`VOIDED`). Those describe a sale that exists; these
/// describe an attempt that may not become one. Collapsing the two would put
/// `Finalizing` on the sale table, and a sale that has no movement group and no
/// completion time is not a sale.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckoutState {
    /// Tenders are being attempted. Money may or may not have moved, and the
    /// till cannot tell which without asking somebody — which is precisely why
    /// this state is written down before the asking starts.
    Finalizing,
    /// The sale exists. Written in the same transaction as the sale itself, so
    /// there is no instant at which one is true and the other is not.
    Completed,
    /// Abandoned on purpose — the shopper changed their mind, the operator
    /// cancelled. Distinct from [`Failed`](Self::Failed) because a decision and
    /// a breakage need different follow-up: nobody investigates a walk-away.
    Voided,
    /// Resolved as "no sale, and the money position is known". Reaching this
    /// state is a claim that every tender has been accounted for — settled,
    /// declined, or reversed — not merely that the attempt stopped.
    Failed,
}

impl CheckoutState {
    /// Whether money may have moved while in this state.
    ///
    /// The question a recovery routine actually asks. `Finalizing` answers yes
    /// not because money *did* move but because the till cannot prove it did
    /// not, and treating "unknown" as "no" is how a charge goes unrefunded.
    pub fn money_may_have_moved(self) -> bool {
        // Every state, as it happens — a checkout only exists because money was
        // about to be asked for. The method is kept rather than folded away
        // because the question is asked of a *stored word*, and the day a
        // parked-basket state arrives the answer stops being trivially true.
        matches!(self, Self::Finalizing | Self::Completed | Self::Failed)
    }

    /// Whether this is an end state. An unresolved checkout is work.
    pub fn is_settled(self) -> bool {
        matches!(self, Self::Completed | Self::Voided | Self::Failed)
    }

    /// The word stored in SQLite and Postgres, and sent on the wire. One
    /// spelling, asserted by a test, because the last time this estate had two
    /// spellings of one enum a screen rendered a blank badge against the other
    /// node.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Finalizing => "FINALIZING",
            Self::Completed => "COMPLETED",
            Self::Voided => "VOIDED",
            Self::Failed => "FAILED",
        }
    }

    /// Read one back. `None` for a word this build does not know, which is a
    /// row written by a newer till — reported rather than guessed at.
    pub fn parse(word: &str) -> Option<Self> {
        match word {
            "FINALIZING" => Some(Self::Finalizing),
            "COMPLETED" => Some(Self::Completed),
            "VOIDED" => Some(Self::Voided),
            "FAILED" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// Why a transition was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransitionError {
    /// The move is not in the machine at all.
    NotAllowed {
        from: CheckoutState,
        to: CheckoutState,
    },
    /// The checkout has already finished. Kept separate from
    /// [`NotAllowed`](Self::NotAllowed) because it is the one a retry causes,
    /// and a retry is not a bug — a till that lost the response and asks again
    /// should be told "already done", not "illegal".
    AlreadySettled { at: CheckoutState },
    /// Completing while a tender is still unresolved. A sale whose card
    /// payment is still pending is not a sale; it is a hope.
    TendersUnresolved { pending: usize },
}

impl std::fmt::Display for TransitionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAllowed { from, to } => {
                write!(f, "a checkout cannot go from {from:?} to {to:?}")
            }
            Self::AlreadySettled { at } => {
                write!(f, "this checkout already finished as {}", at.as_str())
            }
            Self::TendersUnresolved { pending } => write!(
                f,
                "{pending} tender(s) have not been resolved, so the sale cannot complete"
            ),
        }
    }
}

impl std::error::Error for TransitionError {}

/// Where one tender has got to.
///
/// The same five words as `sale_return_payment.status` (migration 0164), and
/// that is on purpose: a refund attempt and a payment attempt are the same
/// shape of fact pointing opposite ways, and an estate with two vocabularies
/// for it ends up with two reports that cannot be joined.
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TenderState {
    /// Intended, not yet attempted.
    Pending,
    /// Handed to an acquirer and not yet answered. The state a crash leaves
    /// behind, and the only one that needs somebody to go and ask.
    Processing,
    /// The money moved.
    Succeeded,
    /// The money did not move and will not. A decline, not an outage.
    Failed,
    /// Withdrawn before it moved, or reversed after. Either way the shop is
    /// not holding this money.
    Cancelled,
}

impl TenderState {
    /// Whether this tender still needs an answer before a sale can be called
    /// complete.
    pub fn is_unresolved(self) -> bool {
        matches!(self, Self::Pending | Self::Processing)
    }

    /// Whether the shop is holding this money now.
    pub fn is_money_in_hand(self) -> bool {
        matches!(self, Self::Succeeded)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Processing => "PROCESSING",
            Self::Succeeded => "SUCCEEDED",
            Self::Failed => "FAILED",
            Self::Cancelled => "CANCELLED",
        }
    }

    pub fn parse(word: &str) -> Option<Self> {
        match word {
            "PENDING" => Some(Self::Pending),
            "PROCESSING" => Some(Self::Processing),
            "SUCCEEDED" => Some(Self::Succeeded),
            "FAILED" => Some(Self::Failed),
            "CANCELLED" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// Check a move before making it.
///
/// `tenders` is the state of every tender on the checkout, and it is only
/// consulted for the move into [`Completed`](CheckoutState::Completed) — the
/// one transition where the money position is part of the question rather than
/// beside it.
pub fn advance(
    from: CheckoutState,
    to: CheckoutState,
    tenders: &[TenderState],
) -> Result<(), TransitionError> {
    use CheckoutState::*;

    // A settled checkout is finished, and saying so is more useful than listing
    // the move as illegal: this is the answer a retried request gets, and a
    // retried request is ordinary.
    if from.is_settled() {
        // Except the idempotent no-op. A caller re-asserting the state it
        // already reached has asked for nothing and should not be refused.
        if from == to {
            return Ok(());
        }
        return Err(TransitionError::AlreadySettled { at: from });
    }

    let legal = match (from, to) {
        // Every move out of the one live state. A checkout exists because money
        // was about to be asked for, so there is nowhere else to start: a sale
        // written without a checkout took money with the intent recorded
        // nowhere, and that is refused by the absence of the row rather than by
        // a transition, because there is no state to transition FROM.
        (Finalizing, Completed) | (Finalizing, Voided) | (Finalizing, Failed) => true,
        _ => false,
    };
    if !legal {
        return Err(TransitionError::NotAllowed { from, to });
    }

    if to == Completed {
        let pending = tenders.iter().filter(|t| t.is_unresolved()).count();
        if pending > 0 {
            return Err(TransitionError::TendersUnresolved { pending });
        }
    }
    Ok(())
}

/// What a recovering till should do with an unresolved checkout.
///
/// Not a decision this module makes — it reports the shape of the problem so a
/// caller (or a person) can act. The distinction that matters is whether any
/// money is in hand: a checkout with nothing settled can simply be voided,
/// while one holding a successful card charge must either become a sale or give
/// the money back, and quietly voiding it would keep the charge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Recovery {
    /// No tender succeeded and none is still in flight. Safe to void.
    NothingTaken,
    /// At least one tender is still `Processing`. The acquirer has to be asked
    /// before anything else can be decided — voiding now could abandon money
    /// that lands a minute later.
    AskTheAcquirer { unresolved: usize },
    /// Money is in hand with no sale against it. Either finish the sale or
    /// reverse the tenders; doing neither is the state that loses a customer.
    MoneyHeldWithoutSale { minor: i64 },
}

/// Classify an unresolved checkout from its tenders.
pub fn recovery(tenders: &[(TenderState, i64)]) -> Recovery {
    let unresolved = tenders
        .iter()
        .filter(|(state, _)| state.is_unresolved())
        .count();
    if unresolved > 0 {
        return Recovery::AskTheAcquirer { unresolved };
    }
    // Saturating rather than checked: a total that overflowed i64 is not a
    // recoverable arithmetic problem, and reporting the ceiling still routes
    // this to "money is held", which is the answer that matters.
    let held = tenders
        .iter()
        .filter(|(state, _)| state.is_money_in_hand())
        .fold(0_i64, |sum, (_, minor)| sum.saturating_add(*minor));
    if held > 0 {
        Recovery::MoneyHeldWithoutSale { minor: held }
    } else {
        Recovery::NothingTaken
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use CheckoutState::*;
    use TenderState as T;

    #[test]
    fn a_completed_checkout_is_the_only_thing_a_sale_may_hang_off() {
        assert_eq!(advance(Finalizing, Completed, &[T::Succeeded]), Ok(()));
        // And nothing leads back into the live state. A settled checkout that
        // could be reopened is a sale that could be written twice.
        for settled in [Completed, Voided, Failed] {
            assert_eq!(
                advance(settled, Finalizing, &[]),
                Err(TransitionError::AlreadySettled { at: settled })
            );
        }
    }

    #[test]
    fn a_sale_does_not_complete_while_a_card_is_still_thinking() {
        // A sale whose card payment is still pending is not a sale. Completing
        // here would print a receipt for money that may be declined a second
        // later, and the goods are already in a bag.
        assert_eq!(
            advance(Finalizing, Completed, &[T::Succeeded, T::Processing]),
            Err(TransitionError::TendersUnresolved { pending: 1 })
        );
    }

    #[test]
    fn giving_up_deliberately_and_giving_up_because_it_broke_are_different_ends() {
        // FAILED is a queue somebody has to work; VOIDED is not. Collapsing
        // them means either nobody works the queue or everybody works the
        // walk-aways.
        assert_eq!(advance(Finalizing, Voided, &[T::Cancelled]), Ok(()));
        assert_eq!(advance(Finalizing, Failed, &[T::Failed]), Ok(()));
    }

    #[test]
    fn a_retry_of_a_finished_checkout_is_told_it_finished_not_that_it_is_illegal() {
        // The till lost the response and asked again. That is ordinary, and the
        // answer has to be distinguishable from a real protocol error or the
        // caller cannot tell "already done" from "you have a bug".
        assert_eq!(
            advance(Completed, Voided, &[]),
            Err(TransitionError::AlreadySettled { at: Completed })
        );
        // Re-asserting the state it already reached asks for nothing.
        assert_eq!(advance(Completed, Completed, &[]), Ok(()));
    }

    #[test]
    fn finalizing_counts_as_money_may_have_moved_because_nobody_can_prove_otherwise() {
        // The load-bearing pessimism. Treating "unknown" as "no money" is how a
        // charge goes unrefunded.
        assert!(Finalizing.money_may_have_moved());
        assert!(!Finalizing.is_settled());
    }

    #[test]
    fn a_crash_with_a_card_still_in_flight_says_ask_the_acquirer() {
        assert_eq!(
            recovery(&[(T::Succeeded, 100_000), (T::Processing, 400_000)]),
            Recovery::AskTheAcquirer { unresolved: 1 }
        );
    }

    #[test]
    fn a_crash_holding_a_settled_card_says_money_is_held_with_no_sale() {
        // The expensive case: the shopper has been charged, the shop has no
        // sale, and the goods may already be out of the door.
        assert_eq!(
            recovery(&[(T::Succeeded, 400_000), (T::Failed, 100_000)]),
            Recovery::MoneyHeldWithoutSale { minor: 400_000 }
        );
    }

    #[test]
    fn a_crash_before_anything_settled_is_safe_to_void() {
        assert_eq!(
            recovery(&[(T::Failed, 400_000), (T::Cancelled, 100_000)]),
            Recovery::NothingTaken
        );
        assert_eq!(recovery(&[]), Recovery::NothingTaken);
    }

    #[test]
    fn every_state_word_survives_a_round_trip() {
        // One spelling, both directions. The last time this estate had two
        // spellings of one enum, a screen showed a blank badge against the
        // other node for a fortnight.
        for state in [Finalizing, Completed, Voided, Failed] {
            assert_eq!(CheckoutState::parse(state.as_str()), Some(state));
        }
        for tender in [
            T::Pending,
            T::Processing,
            T::Succeeded,
            T::Failed,
            T::Cancelled,
        ] {
            assert_eq!(TenderState::parse(tender.as_str()), Some(tender));
        }
        assert_eq!(CheckoutState::parse("SETTLED"), None);
        assert_eq!(CheckoutState::parse("OPEN"), None);
    }

    #[test]
    fn the_stored_word_is_the_serialised_word() {
        // `as_str` writes the database column and serde writes the wire. Two
        // functions, one answer required — a mismatch here is a row the same
        // process cannot read back.
        let json =
            serde_json::to_string(&Finalizing).unwrap_or_else(|error| panic!("serialise: {error}"));
        assert_eq!(json, "\"FINALIZING\"");
        let json = serde_json::to_string(&T::Processing)
            .unwrap_or_else(|error| panic!("serialise: {error}"));
        assert_eq!(json, "\"PROCESSING\"");
    }
}
