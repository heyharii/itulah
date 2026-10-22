//! Reading a quantity the way a supplier writes it.
//!
//! The units master (`postgres::units`, migrations 0394 and 0652) says what a
//! unit is worth in pieces; this is the arithmetic and the reading around it,
//! kept free of the database so the PO import can use it on a spreadsheet
//! cell and a test can use it on a string.
//!
//! The lookup here is the GLOBAL master only — what a printed word means and
//! what it is worth in the base unit. An article's own units (a carton of 24,
//! a bottle of 250 ml; migration 0653) are the database's business, through
//! `article_unit_factor`, because they are read per line.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

/// The kinds of unit (ERPNext's UOM Category). A conversion only joins two
/// units of one kind: kilograms never become pieces.
pub const UNIT_CATEGORIES: [&str; 5] = ["COUNT", "MASS", "VOLUME", "LENGTH", "AREA"];

/// One unit an article is also dealt in, with how many of its stock unit one
/// of it is (ERPNext's `UOM Conversion Detail`): a CARTON of this shirt is 24.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct ItemUnit {
    pub unit_code: String,
    /// Stock units in one, as a decimal string: "24", "91.44".
    pub factor: String,
}

/// The master as a lookup: which spellings mean which unit, and how many
/// pieces one of each is.
#[derive(Clone, Debug, Default)]
pub struct UnitLookup {
    base: String,
    /// Lower-cased code or alias → unit code.
    spellings: HashMap<String, String>,
    /// Unit code → pieces in one. Only units a chain reaches.
    pieces: HashMap<String, Decimal>,
}

impl UnitLookup {
    /// `units` is `(code, pieces in one)` for every active unit, `aliases` is
    /// `(alias, code)`. A unit with no conversion to the base still resolves
    /// by name; it just cannot be turned into pieces.
    pub fn new(
        base: &str,
        units: impl IntoIterator<Item = (String, Option<Decimal>)>,
        aliases: impl IntoIterator<Item = (String, String)>,
    ) -> Self {
        let mut lookup = Self {
            base: base.to_owned(),
            ..Self::default()
        };
        for (code, per) in units {
            lookup.spellings.insert(spelling(&code), code.clone());
            if let Some(per) = per.filter(|per| *per > Decimal::ZERO) {
                lookup.pieces.insert(code, per);
            }
        }
        for (alias, code) in aliases {
            // A code wins over an alias that happens to spell it.
            lookup.spellings.entry(spelling(&alias)).or_insert(code);
        }
        lookup
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    /// The unit code a printed word means: "lsn", "Lusin." and "LUSIN" are
    /// all LUSIN. `None` for a word the master does not know.
    pub fn resolve(&self, text: &str) -> Option<&str> {
        let key = spelling(text);
        if key.is_empty() {
            return None;
        }
        self.spellings
            .get(&key)
            .or_else(|| {
                // "pcs." and "lusins" are the plural and the abbreviation dot
                // a sheet adds; try without before giving up.
                key.strip_suffix('s')
                    .filter(|stem| !stem.is_empty())
                    .and_then(|stem| self.spellings.get(stem))
            })
            .map(String::as_str)
    }

    /// Pieces in one of a unit code. `None` when no conversion reaches it.
    pub fn pieces_per(&self, code: &str) -> Option<Decimal> {
        self.pieces.get(code).copied()
    }

    /// A whole quantity as written — "5 lusin", "2 kodi 5 pcs", "1,5 lsn",
    /// "12" — in pieces. A bare number is pieces. `None` when a word is not a
    /// unit, a unit has no conversion, or the text is not a quantity at all.
    pub fn pieces_in(&self, text: &str) -> Option<Decimal> {
        let parts = split_parts(text)?;
        let mut total = Decimal::ZERO;
        for (quantity, word) in parts {
            let per = match word {
                None => Decimal::ONE,
                Some(word) => self.pieces_per(self.resolve(&word)?)?,
            };
            total += quantity * per;
        }
        Some(total.normalize())
    }
}

/// "5 lusin" → 5 and "lusin"; "12" → 12 and nothing; "5lsn" → 5 and "lsn".
/// The number is read by [`read_number`]: "1.000 pcs" is a thousand pieces.
pub fn split_quantity(text: &str) -> Option<(Decimal, Option<String>)> {
    let parts = split_parts(text)?;
    match parts.as_slice() {
        [(quantity, word)] => Some((*quantity, word.clone())),
        _ => None,
    }
}

/// Every `number [word]` pair in the text, in order.
fn split_parts(text: &str) -> Option<Vec<(Decimal, Option<String>)>> {
    let mut parts = Vec::new();
    let mut rest = text.trim();
    if rest.is_empty() {
        return None;
    }
    while !rest.is_empty() {
        let digits = rest
            .find(|c: char| !(c.is_ascii_digit() || c == ',' || c == '.'))
            .unwrap_or(rest.len());
        if digits == 0 {
            return None;
        }
        let quantity = read_number(&rest[..digits])?;
        if quantity <= Decimal::ZERO {
            return None;
        }
        rest = rest[digits..].trim_start();
        let word_end = rest
            .find(|c: char| c.is_ascii_digit())
            .unwrap_or(rest.len());
        let word = rest[..word_end].trim();
        let word = word.trim_matches(|c: char| c == '+' || c == ',' || c.is_whitespace());
        parts.push((quantity, (!word.is_empty()).then(|| word.to_owned())));
        rest = rest[word_end..].trim_start();
    }
    Some(parts)
}

/// A number the way it is typed here. A dot followed by exactly three digits,
/// in groups after one to three leading digits, marks thousands — "1.000" is
/// a thousand and "12.500,5" is twelve thousand five hundred and a half, the
/// Indonesian way. Otherwise a comma or a point is the decimal mark, since
/// both are typed: "2,5" and "2.5" are two and a half.
pub fn read_number(text: &str) -> Option<Decimal> {
    let text = text.trim();
    let all_digits = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit());
    let (whole, fraction) = match text.split_once(',') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text, None),
    };
    let mut groups = whole.split('.');
    let lead = groups.next().unwrap_or_default();
    let rest: Vec<&str> = groups.collect();
    let thousands = !rest.is_empty()
        && lead.len() <= 3
        && all_digits(lead)
        && rest.iter().all(|group| group.len() == 3 && all_digits(*group))
        && fraction.is_none_or(all_digits);
    let plain = if thousands {
        text.replace('.', "").replace(',', ".")
    } else {
        text.replace(',', ".")
    };
    Decimal::from_str(&plain).ok()
}

/// How a spelling is compared: lower case, single-spaced, no trailing dot.
pub fn spelling(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches('.')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup() -> UnitLookup {
        UnitLookup::new(
            "PCS",
            [
                ("PCS".to_owned(), Some(Decimal::ONE)),
                ("LUSIN".to_owned(), Some(Decimal::from(12))),
                ("KODI".to_owned(), Some(Decimal::from(20))),
                ("KG".to_owned(), None),
            ],
            [
                ("lsn".to_owned(), "LUSIN".to_owned()),
                ("ptg".to_owned(), "PCS".to_owned()),
            ],
        )
    }

    #[test]
    fn a_printed_word_resolves_to_its_unit() {
        let units = lookup();
        assert_eq!(units.resolve("Lusin."), Some("LUSIN"));
        assert_eq!(units.resolve(" lsn "), Some("LUSIN"));
        assert_eq!(units.resolve("pcs"), Some("PCS"));
        assert_eq!(units.resolve("lusins"), Some("LUSIN"));
        assert_eq!(units.resolve("ptg"), Some("PCS"));
        assert_eq!(units.resolve("karung"), None);
    }

    #[test]
    fn a_quantity_as_written_is_pieces() {
        let units = lookup();
        assert_eq!(units.pieces_in("5 lusin"), Some(Decimal::from(60)));
        assert_eq!(units.pieces_in("5lsn"), Some(Decimal::from(60)));
        assert_eq!(units.pieces_in("2 kodi 5 pcs"), Some(Decimal::from(45)));
        assert_eq!(units.pieces_in("1,5 lusin"), Some(Decimal::from(18)));
        assert_eq!(units.pieces_in("12"), Some(Decimal::from(12)));
        assert_eq!(units.pieces_in("3 kg"), None);
        assert_eq!(units.pieces_in("lusin"), None);
    }

    #[test]
    fn one_number_and_one_word_split() {
        assert_eq!(
            split_quantity("10 Lusin"),
            Some((Decimal::from(10), Some("Lusin".to_owned())))
        );
        assert_eq!(split_quantity("24"), Some((Decimal::from(24), None)));
        assert_eq!(split_quantity("2 kodi 5 pcs"), None);
        assert_eq!(split_quantity("abc"), None);
    }

    #[test]
    fn a_dot_before_three_digits_is_a_thousand() {
        assert_eq!(read_number("1.000"), Some(Decimal::from(1000)));
        assert_eq!(read_number("12.500.000"), Some(Decimal::from(12_500_000)));
        assert_eq!(read_number("1.000,5"), Decimal::from_str("1000.5").ok());
        assert_eq!(read_number("2,5"), Decimal::from_str("2.5").ok());
        assert_eq!(read_number("2.5"), Decimal::from_str("2.5").ok());
        assert_eq!(read_number("12.50"), Decimal::from_str("12.50").ok());
        assert_eq!(read_number("1234.567"), Decimal::from_str("1234.567").ok());
        assert_eq!(read_number("1.2.3"), None);
        assert_eq!(
            split_quantity("1.000 pcs"),
            Some((Decimal::from(1000), Some("pcs".to_owned())))
        );
    }
}
