//! What a cash document is called, and how its amount reads out loud.
//!
//! Three decisions live here, and all three are decisions about paper:
//!
//! * **Which kind of document this is.** Not chosen — derived. Money leaving a
//!   pot we hold is a payment, money arriving in one is a receipt, and two of
//!   our own pots exchanging is a transfer. A field somebody picks would be a
//!   field somebody can pick wrongly, and the slip would then say Kas Keluar
//!   over an entry that debited the bank.
//!
//! * **What it is numbered.** `KK-26-09-00001`, in the client's own letters
//!   and their own layout, per kind per month. The month is IN the number, so
//!   the number cannot be formatted without knowing which month it belongs to,
//!   which is the property that keeps the counter and the label in step.
//!
//! * **How much it says in words.** Every Indonesian cash slip carries
//!   "terbilang" under the figures, and it is not decoration: it is the line
//!   that makes a 1 added to the front of an amount visible. Getting it wrong
//!   is worse than omitting it, so it is here, where it can be checked against
//!   properties rather than against four examples somebody thought of.
//!
//! This module is pure: no database, no clock, no calendar type. The year and
//! the month arrive as integers because a numbering function that could ask
//! what today is would number a September document with October's counter on
//! the first of the month, silently.

use serde::{Deserialize, Serialize};

/// The meanings that hold money.
///
/// Which side of a document is one of these is the whole of the direction
/// rule, so the list is the definition of "cash or bank" for this system and
/// not a convenience.
///
/// `cash_in_transit` is here and is not this lane's key to define — it belongs
/// to the store-deposit work, where money that has left a shop and not yet
/// reached the bank has to live somewhere. Naming it here costs nothing: a
/// document that used it before it is linked is refused by `account_resolution` with
/// a message naming the key.
pub const MONEY_MEANINGS: [&str; 7] = [
    "cash",
    "petty_cash",
    "cashier_float",
    "cash_in_transit",
    "bank_giro",
    "bank_savings",
    "time_deposit",
];

/// Does this meaning hold money?
pub fn holds_money(semantic_key: &str) -> bool {
    MONEY_MEANINGS.contains(&semantic_key)
}

/// Which way the money went, which is also which document this is.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CashDirection {
    /// Out of a pot we hold: Kas Keluar.
    Out,
    /// Into one: Kas Masuk.
    In,
    /// Between two of our own: a transfer, and no expense or income anywhere.
    Between,
}

impl CashDirection {
    /// The stored kind. `PAY`, `RECEIVE`, `TRANSFER`.
    pub fn kind(self) -> &'static str {
        match self {
            Self::Out => "PAY",
            Self::In => "RECEIVE",
            Self::Between => "TRANSFER",
        }
    }

    /// The two letters the client's own numbering uses.
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Out => "KK",
            Self::In => "KM",
            Self::Between => "TF",
        }
    }

    /// What the slip is headed. Their words, not a translation of ours.
    pub fn slip_title(self) -> &'static str {
        match self {
            Self::Out => "BUKTI KAS KELUAR",
            Self::In => "BUKTI KAS MASUK",
            Self::Between => "BUKTI TRANSFER",
        }
    }

    /// Read back a stored kind.
    pub fn from_kind(kind: &str) -> Option<Self> {
        match kind {
            "PAY" => Some(Self::Out),
            "RECEIVE" => Some(Self::In),
            "TRANSFER" => Some(Self::Between),
            _ => None,
        }
    }
}

/// Which document the two sides make, or nothing when neither holds money.
///
/// The refusal is the interesting case and it is deliberately not a default.
/// Two non-money accounts is a reclassification — rent prepaid becoming rent
/// expensed — and it is a journal entry somebody should have to justify, not a
/// cash slip with no cash on it. Letting it through here would make this the
/// back door into the ledger that the manual-journal guard exists to close.
pub fn cash_direction(from_holds_money: bool, to_holds_money: bool) -> Option<CashDirection> {
    match (from_holds_money, to_holds_money) {
        (true, true) => Some(CashDirection::Between),
        (true, false) => Some(CashDirection::Out),
        (false, true) => Some(CashDirection::In),
        (false, false) => None,
    }
}

/// The month a number belongs to, as the counter stores it: `202609`.
///
/// One integer rather than a pair, because it is only ever used whole and
/// because a month is naturally ordered this way. Months outside 1..=12 are
/// the caller's mistake and are clamped rather than panicking: a kernel that
/// could panic would be a kernel that can take a request down.
pub fn accounting_month(year: i32, month: u32) -> i32 {
    year.saturating_mul(100)
        .saturating_add(month.clamp(1, 12) as i32)
}

/// `KK-26-09-00001`.
///
/// Two-digit year, because that is what is printed on the client's existing
/// books and a slip that suddenly said `2026` would not file beside them. Five
/// digits of sequence, which is a hundred documents a day for three years in
/// one kind in one month; beyond that the number simply grows rather than
/// wrapping, because a wrapped number would collide with one already filed.
pub fn cash_document_number(
    direction: CashDirection,
    year: i32,
    month: u32,
    sequence: i64,
) -> String {
    format!(
        "{}-{:02}-{:02}-{:05}",
        direction.prefix(),
        year.rem_euclid(100),
        month.clamp(1, 12),
        sequence.max(0)
    )
}

// ---------------------------------------------------------------------------
// Terbilang
// ---------------------------------------------------------------------------

/// One to eleven, where Indonesian stops being regular.
///
/// `sebelas` rather than `satu belas`, and `sepuluh` rather than `satu puluh`:
/// the "se-" form is the language's, not an abbreviation, and a slip that read
/// "satu ribu rupiah" would be read as a mistake by the person filing it.
const SMALL: [&str; 12] = [
    "", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh",
    "sebelas",
];

fn join(head: String, tail: String) -> String {
    if tail.is_empty() {
        head
    } else if head.is_empty() {
        tail
    } else {
        format!("{head} {tail}")
    }
}

/// Spell a whole number. Empty for zero, which is what lets `join` compose.
fn spell(value: u64) -> String {
    match value {
        0 => String::new(),
        1..=11 => SMALL[value as usize].to_string(),
        12..=19 => format!("{} belas", SMALL[(value - 10) as usize]),
        20..=99 => join(format!("{} puluh", spell(value / 10)), spell(value % 10)),
        100..=199 => join("seratus".to_string(), spell(value - 100)),
        200..=999 => join(format!("{} ratus", spell(value / 100)), spell(value % 100)),
        1_000..=1_999 => join("seribu".to_string(), spell(value - 1_000)),
        2_000..=999_999 => join(
            format!("{} ribu", spell(value / 1_000)),
            spell(value % 1_000),
        ),
        1_000_000..=999_999_999 => join(
            format!("{} juta", spell(value / 1_000_000)),
            spell(value % 1_000_000),
        ),
        1_000_000_000..=999_999_999_999 => join(
            format!("{} miliar", spell(value / 1_000_000_000)),
            spell(value % 1_000_000_000),
        ),
        _ => join(
            format!("{} triliun", spell(value / 1_000_000_000_000)),
            spell(value % 1_000_000_000_000),
        ),
    }
}

/// The amount as it is written out under the figures on the slip.
///
/// Capitalised, because it starts a line on paper. The rupiah is its own
/// smallest unit in this ledger — there are no sen in anything the client
/// prices, quotes or banks — so the minor amount and the number of rupiah are
/// the same integer and no division happens here.
pub fn rupiah_in_words(amount_minor: i64) -> String {
    let words = if amount_minor == 0 {
        "nol".to_string()
    } else {
        spell(amount_minor.unsigned_abs())
    };
    let signed = if amount_minor < 0 {
        format!("minus {words}")
    } else {
        words
    };
    let mut characters = signed.chars();
    let capitalised = match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => signed.clone(),
    };
    format!("{capitalised} rupiah")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_kind_follows_the_two_accounts_and_nothing_else() {
        assert_eq!(cash_direction(true, false), Some(CashDirection::Out));
        assert_eq!(cash_direction(false, true), Some(CashDirection::In));
        assert_eq!(cash_direction(true, true), Some(CashDirection::Between));
        // Two accounts that hold no money is a journal entry somebody has to
        // justify, not a cash slip.
        assert_eq!(cash_direction(false, false), None);
    }

    #[test]
    fn the_number_carries_the_month_it_belongs_to() {
        assert_eq!(
            cash_document_number(CashDirection::Out, 2026, 9, 1),
            "KK-26-09-00001"
        );
        assert_eq!(
            cash_document_number(CashDirection::In, 2026, 12, 4_312),
            "KM-26-12-04312"
        );
        assert_eq!(
            cash_document_number(CashDirection::Between, 2027, 1, 7),
            "TF-27-01-00007"
        );
    }

    #[test]
    fn the_counter_is_keyed_by_the_month_in_the_number() {
        assert_eq!(accounting_month(2026, 9), 202_609);
        assert_eq!(accounting_month(2026, 12), 202_612);
    }

    #[test]
    fn every_bank_the_client_keeps_is_a_money_meaning() {
        for key in [
            "cash",
            "petty_cash",
            "bank_giro",
            "bank_savings",
            "time_deposit",
        ] {
            assert!(holds_money(key), "{key} holds money");
        }
        // The other side of a bank charge does not, which is what makes that
        // document a KK rather than a TF.
        assert!(!holds_money("bank_admin_fee"));
        assert!(!holds_money("trade_payable"));
    }

    #[test]
    fn the_words_are_the_ones_an_indonesian_slip_carries() {
        // The irregular ones first: these are where a naive speller goes wrong.
        assert_eq!(rupiah_in_words(1_000), "Seribu rupiah");
        assert_eq!(rupiah_in_words(11_000), "Sebelas ribu rupiah");
        assert_eq!(rupiah_in_words(100), "Seratus rupiah");
        assert_eq!(rupiah_in_words(10), "Sepuluh rupiah");
        assert_eq!(rupiah_in_words(15), "Lima belas rupiah");

        assert_eq!(
            rupiah_in_words(2_500_000),
            "Dua juta lima ratus ribu rupiah"
        );
        assert_eq!(
            rupiah_in_words(125_750),
            "Seratus dua puluh lima ribu tujuh ratus lima puluh rupiah"
        );
        assert_eq!(rupiah_in_words(1_000_000_000), "Satu miliar rupiah");
        assert_eq!(rupiah_in_words(0), "Nol rupiah");
    }

    #[test]
    fn a_hundred_and_one_million_does_not_lose_its_middle() {
        // The bug every recursive speller has: a zero group swallowing the
        // group after it.
        assert_eq!(rupiah_in_words(101_000_000), "Seratus satu juta rupiah");
        assert_eq!(rupiah_in_words(1_000_001), "Satu juta satu rupiah");
    }
}
