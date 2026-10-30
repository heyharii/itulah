//! What a voucher is, in the vocabulary the rest of the system already speaks.
//!
//! A voucher carries money. The pricing engine has said so since it was
//! written — *"a voucher carries money. It is tender, not pricing"* — and this
//! is the module that finally means something by it. Everything here is about
//! value the shopper already holds; nothing here describes what anything costs.
//!
//! The distinction is not pedantry, and the system this replaces is the
//! argument for it. There, one `voucher` table held `percent_off` beside
//! `stored_value`, so a clearance and a gift card were rows in the same list.
//! The consequence was that a gift card settled at the till was booked as a
//! discount against margin instead of as a liability going down — the shop's
//! margin looked worse every time somebody spent money the shop was already
//! holding.
use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

/// Why the voucher exists, and therefore what the ledger owes because of it.
///
/// Three kinds and not one, because the accounting differs at the moment of
/// issue and a single "voucher" cannot be posted correctly:
///
///   * a **gift card** was paid for. Cash came in and the shop owes goods —
///     a liability, and the only kind that is revenue-neutral on issue;
///   * **goodwill** was given away. Nothing came in, so the expense lands the
///     day it is issued, not the day it is spent;
///   * a **refund** voucher unwinds a sale the shopper is handing back, in
///     credit rather than in cash.
///
/// Nothing in this crate posts any of that yet — finance has no voucher rule.
/// The kind is recorded now regardless, because it is knowable only at issue,
/// and a backfill that guesses it later would be guessing at which of three
/// accounts the money belonged in.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum VoucherKind {
    GiftCard,
    Refund,
    Goodwill,
}

impl VoucherKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GiftCard => "GIFT_CARD",
            Self::Refund => "REFUND",
            Self::Goodwill => "GOODWILL",
        }
    }
}

impl fmt::Display for VoucherKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for VoucherKind {
    type Err = VoucherError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().replace('-', "_").as_str() {
            "GIFT_CARD" => Ok(Self::GiftCard),
            "REFUND" => Ok(Self::Refund),
            "GOODWILL" => Ok(Self::Goodwill),
            _ => Err(VoucherError::InvalidKind(value.into())),
        }
    }
}

/// Where the voucher stands.
///
/// Expiry is deliberately absent. A voucher past its date is still ACTIVE with
/// a balance on it — what changed is the clock, not the record — and storing
/// EXPIRED would mean a status that is wrong from the instant it is written
/// until something sweeps the table. Whether a voucher may be spent is
/// [`spendable`], which reads the date.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum VoucherStatus {
    /// Has a balance and has not been stopped.
    Active,
    /// Spent to nothing. A terminal state reached by ordinary use, and the
    /// only one that is good news.
    Spent,
    /// Stopped with value still on it — lost, issued in error, or written off.
    /// The remaining balance is taken to zero by a movement, so the write-off
    /// is a fact somebody can find rather than a balance that changed by
    /// itself.
    Voided,
}

impl VoucherStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Spent => "SPENT",
            Self::Voided => "VOIDED",
        }
    }
}

impl fmt::Display for VoucherStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for VoucherStatus {
    type Err = VoucherError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().as_str() {
            "ACTIVE" => Ok(Self::Active),
            "SPENT" => Ok(Self::Spent),
            "VOIDED" => Ok(Self::Voided),
            _ => Err(VoucherError::InvalidStatus(value.into())),
        }
    }
}

/// What moved the balance.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum VoucherMovementKind {
    Issue,
    Redeem,
    Void,
    /// What a single-use paper voucher had left after its one redemption:
    /// no change, the rest gone (postgres 1006).
    Forfeit,
}

impl VoucherMovementKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Issue => "ISSUE",
            Self::Redeem => "REDEEM",
            Self::Void => "VOID",
            Self::Forfeit => "FORFEIT",
        }
    }
}

impl fmt::Display for VoucherMovementKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for VoucherMovementKind {
    type Err = VoucherError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_uppercase().as_str() {
            "ISSUE" => Ok(Self::Issue),
            "REDEEM" => Ok(Self::Redeem),
            "VOID" => Ok(Self::Void),
            "FORFEIT" => Ok(Self::Forfeit),
            _ => Err(VoucherError::InvalidMovementKind(value.into())),
        }
    }
}

/// How long a code may be, and how short.
///
/// Six is the floor because a code is guessable and a voucher is money: four
/// digits is ten thousand tries, which a script does over lunch. Thirty-two is
/// the ceiling because somebody has to key it while a queue waits.
pub const CODE_MIN: usize = 6;
pub const CODE_MAX: usize = 32;

/// The code as the database stores it, from whatever was typed.
///
/// Upper-case, no spaces, no dashes. All three of those are how a human writes
/// down a code that was printed in groups — `4f7a 21b9` and `4F7A-21B9` are one
/// card, and a shopper at the counter should not fail because of the shape of
/// the thing they copied. The separators are removed rather than merely
/// tolerated, because storing both forms would put the same card in the table
/// twice.
///
/// Letters and digits only afterwards. Anything else in a code is either a
/// transcription slip or somebody probing the lookup.
pub fn normalize_code(raw: &str) -> Result<String, VoucherError> {
    let code: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .collect::<String>()
        .to_uppercase();
    if code.len() < CODE_MIN || code.len() > CODE_MAX {
        return Err(VoucherError::InvalidCode(raw.into()));
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(VoucherError::InvalidCode(raw.into()));
    }
    Ok(code)
}

/// A code nobody has to guess at, and nobody can guess.
///
/// Crockford's alphabet minus the four characters that are read wrong off a
/// printed card: `I`, `L`, `O` and `U`. That is 32 symbols over 12 characters —
/// about 60 bits, which is not brute-forceable against a lookup that also has
/// to be fast.
///
/// Generated here rather than by the database so that the same rule applies
/// however a voucher comes to exist, and so that a caller may still supply
/// their own code — a shop with pre-printed cards has the code before the
/// system does.
pub fn mint_code(random: [u8; 12]) -> String {
    const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    random
        .iter()
        .map(|byte| ALPHABET[(*byte as usize) % ALPHABET.len()] as char)
        .collect()
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum VoucherError {
    #[error("invalid voucher kind: {0}")]
    InvalidKind(String),
    #[error("invalid voucher status: {0}")]
    InvalidStatus(String),
    #[error("invalid voucher movement kind: {0}")]
    InvalidMovementKind(String),
    #[error("a voucher code is {CODE_MIN} to {CODE_MAX} letters and digits, not {0:?}")]
    InvalidCode(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three shapes one card is written in, all reaching one row.
    #[test]
    fn a_code_is_one_card_however_it_was_copied_down() {
        assert_eq!(normalize_code("4f7a 21b9").unwrap(), "4F7A21B9");
        assert_eq!(normalize_code("4F7A-21B9").unwrap(), "4F7A21B9");
        assert_eq!(normalize_code("4f7a21b9").unwrap(), "4F7A21B9");
    }

    /// Short codes are refused at the door, because a voucher is money and a
    /// four-character code is ten thousand tries.
    #[test]
    fn a_code_too_short_to_be_safe_is_refused() {
        assert!(matches!(
            normalize_code("A1B2"),
            Err(VoucherError::InvalidCode(_))
        ));
        assert!(matches!(
            normalize_code(&"A".repeat(CODE_MAX + 1)),
            Err(VoucherError::InvalidCode(_))
        ));
    }

    #[test]
    fn a_code_carrying_anything_but_letters_and_digits_is_refused() {
        assert!(matches!(
            normalize_code("GIFT/2026"),
            Err(VoucherError::InvalidCode(_))
        ));
    }

    /// The four characters a human reads wrong off a printed card never appear
    /// in one this mints.
    #[test]
    fn a_minted_code_avoids_the_letters_people_misread() {
        for byte in 0u8..=255 {
            let code = mint_code([byte; 12]);
            assert_eq!(code.len(), 12);
            assert!(
                !code.contains(['I', 'L', 'O', 'U']),
                "{code} carries a character somebody will read wrong"
            );
            // And it survives the normaliser it will meet on the way back in.
            assert_eq!(normalize_code(&code).unwrap(), code);
        }
    }

    #[test]
    fn the_wire_names_round_trip() {
        for kind in [
            VoucherKind::GiftCard,
            VoucherKind::Refund,
            VoucherKind::Goodwill,
        ] {
            assert_eq!(VoucherKind::from_str(kind.as_str()).unwrap(), kind);
        }
        for status in [
            VoucherStatus::Active,
            VoucherStatus::Spent,
            VoucherStatus::Voided,
        ] {
            assert_eq!(VoucherStatus::from_str(status.as_str()).unwrap(), status);
        }
        for kind in [
            VoucherMovementKind::Issue,
            VoucherMovementKind::Redeem,
            VoucherMovementKind::Void,
            VoucherMovementKind::Forfeit,
        ] {
            assert_eq!(VoucherMovementKind::from_str(kind.as_str()).unwrap(), kind);
        }
    }
}
