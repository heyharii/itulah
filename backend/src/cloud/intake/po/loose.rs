//! The loose readers every PO document leans on.
//!
//! Ported line-for-line from the ingest service this module replaces
//! (`frontend-hub/services/po-import`, deleted at the cutover). Two properties
//! are worth more than tidiness here:
//!
//! * **A number the supplier printed is the number we read.** Rupiah is
//!   printed as `48.500` or `Rp 5.000.000`; `1.234,56` is a price with sen.
//!   The mixed-separator rule below preserves the service's behaviour quirk
//!   on purpose (`1,234.56` reads as `1`) — changing it would silently
//!   re-price lines that already import correctly.
//! * **A date the document did not print is not guessed.** Day-first, four
//!   shapes, Indonesian month names, and nothing else. `31/02/2026` passes —
//!   the parser has no calendar, only digit ranges, exactly as before.

use std::sync::LazyLock;

/// A source-literal regex cannot fail to compile; if it ever does, this module
/// was edited wrong and should be loud rather than quietly match nothing.
fn compile(literal: &str) -> regex::Regex {
    match regex::Regex::new(literal) {
        Ok(regex) => regex,
        Err(error) => panic!("static PO-import regex is invalid: {error}: {literal}"),
    }
}

/// The shared word-boundary suffix strip, kept as one static because grouping
/// and header matching both lean on it and must never drift apart.
static SUFIXES: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"\b(pt|cv|ud|tbk|persero|inc|ltd|llc)\b"));
static NON_ALNUM: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"[^a-z0-9]+"));

/// Strip the corporate suffixes two suppliers of the same company would both
/// print, then keep letter-and-digit runs. This is the grouping key's
/// normaliser and the Excel header normaliser; one function, one idea.
pub fn normalise_name(name: &str) -> String {
    let lowered = name.to_lowercase();
    let stripped = SUFIXES.replace_all(&lowered, " ");
    NON_ALNUM.replace_all(&stripped, " ").trim().to_string()
}

/// A string that is present, or nothing. The document is allowed to leave a
/// field out; the wire shape spells that `null`, not `""`.
pub fn string_or_null(value: &str) -> Option<String> {
    let text = value.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// Money as the document prints it, in whole currency units.
///
/// `48.500` and `48,500` are both forty-eight thousand five hundred; `12,5`
/// is twelve and a half sen rounded the way `Math.round` rounds. The sign
/// survives: a credit-looking `-5.000` reads as `-5.000`, and the callers
/// decide what a negative means.
pub fn parse_amount_loose(text: &str) -> Option<i64> {
    let cleaned: String = text
        .trim()
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let has_dot = cleaned.contains('.');
    let has_comma = cleaned.contains(',');
    if has_dot && has_comma {
        // The separator that appears LAST is the decimal; the other one is
        // grouping. Quirk kept from the service: only the digits before the
        // first decimal, read the way `parseFloat` reads them, survive —
        // `1,234.56` reads as `1`. Re-pricing that now would change money
        // that already imports correctly.
        let decimal = if cleaned.rfind(',').unwrap_or(0) > cleaned.rfind('.').unwrap_or(0) {
            ','
        } else {
            '.'
        };
        let thousands = if decimal == ',' { '.' } else { ',' };
        let (int_part, rest) = cleaned.split_once(decimal)?;
        let digits = int_part.replace(thousands, "");
        // `parseFloat` stops at the first character it cannot read, and the
        // service inherited exactly that; reproduce it rather than refusing
        // a shape the service accepted.
        let value = leading_f64(&format!("{digits}.{rest}"))?;
        Some(value.round() as i64)
    } else if has_dot || has_comma {
        let sep = if has_dot { '.' } else { ',' };
        // Groups of three separated by the mark, an optional 1–2 digit tail —
        // `5.000.000` is grouping, `12,5` is a fraction.
        if let Some(caps) = grouped_pattern(sep).captures(&cleaned) {
            let base: String = caps
                .get(1)
                .map(|m| m.as_str().replace(sep, ""))
                .unwrap_or_default();
            let value = match caps.get(2) {
                Some(fraction) => format!("{base}.{}", fraction.as_str())
                    .parse::<f64>()
                    .ok()?,
                None => base.parse::<i64>().ok()? as f64,
            };
            if !value.is_finite() {
                return None;
            }
            return Some(value.round() as i64);
        }
        // Not grouping after all (`-5.000`, `12.34.56`): the service stripped
        // the separator and read what was left as an integer.
        cleaned.replace(sep, "").parse::<i64>().ok()
    } else {
        cleaned.parse::<i64>().ok()
    }
}

/// `parseFloat` the way the service's host reads it: an optional sign, digits,
/// one dot, more digits — and then it stops reading. `None` is what JavaScript
/// would have called NaN.
fn leading_f64(text: &str) -> Option<f64> {
    let bytes = text.as_bytes();
    let mut index = 0;
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut end = 0;
    if index < bytes.len() && (bytes[index] == b'+' || bytes[index] == b'-') {
        index += 1;
        end = 1;
    }
    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii_digit() {
            seen_digit = true;
            index += 1;
            end = index;
        } else if byte == b'.' && !seen_dot {
            seen_dot = true;
            index += 1;
            end = index;
        } else {
            break;
        }
    }
    if !seen_digit {
        return None;
    }
    text[..end].parse().ok()
}

static GROUPED_DOT: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"^(\d{1,3}(?:\.\d{3})*)(?:\.(\d{1,2}))?$"));
static GROUPED_COMMA: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"^(\d{1,3}(?:,\d{3})*)(?:,(\d{1,2}))?$"));

fn grouped_pattern(sep: char) -> &'static regex::Regex {
    if sep == '.' {
        &GROUPED_DOT
    } else {
        &GROUPED_COMMA
    }
}

/// Quantities: whole units, tolerant of `12`, `12,5` and `12.5`. A negative
/// count of goods is not a count.
pub fn parse_quantity_loose(text: &str) -> Option<i64> {
    match parse_amount_loose(text) {
        Some(amount) if amount >= 0 => Some(amount),
        _ => None,
    }
}

static MONTHS_ID: LazyLock<std::collections::HashMap<&'static str, &'static str>> =
    LazyLock::new(|| {
        [
            ("januari", "01"),
            ("februari", "02"),
            ("maret", "03"),
            ("april", "04"),
            ("mei", "05"),
            ("juni", "06"),
            ("juli", "07"),
            ("agustus", "08"),
            ("september", "09"),
            ("oktober", "10"),
            ("november", "11"),
            ("desember", "12"),
            ("jan", "01"),
            ("feb", "02"),
            ("mar", "03"),
            ("apr", "04"),
            ("jun", "06"),
            ("jul", "07"),
            ("agu", "08"),
            ("agt", "08"),
            ("sep", "09"),
            ("okt", "10"),
            ("nov", "11"),
            ("des", "12"),
        ]
        .into_iter()
        .collect()
    });

static ISO_DATE: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"));
static DAY_FIRST: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})"));
static DAY_MONTH_NAME: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})"));

/// The date shapes Indonesian purchase documents print: `2026-09-20`,
/// `20/09/2026`, `20-09-26`, `20 September 2026`. Anything else is not a date.
pub fn parse_date_loose(text: &str) -> Option<String> {
    let raw = text.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(m) = ISO_DATE.captures(raw) {
        return iso(&m[1], &m[2], &m[3]);
    }
    if let Some(m) = DAY_FIRST.captures(raw) {
        // Day-first, which is how Indonesia writes it.
        let year = if m[3].len() == 2 {
            format!("20{}", &m[3])
        } else {
            m[3].to_string()
        };
        return iso(&year, &m[2], &m[1]);
    }
    if let Some(m) = DAY_MONTH_NAME.captures(raw) {
        let month = MONTHS_ID.get(m[2].to_lowercase().as_str())?;
        return iso(&m[3], month, &m[1]);
    }
    None
}

fn iso(year: &str, month: &str, day: &str) -> Option<String> {
    let y: i32 = year.parse().ok()?;
    let mo: i32 = month.parse().ok()?;
    let d: i32 = day.parse().ok()?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    Some(format!("{y:04}-{mo:02}-{d:02}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rupiah_grouping_reads_as_thousands() {
        assert_eq!(parse_amount_loose("48.500"), Some(48500));
        assert_eq!(parse_amount_loose("48,500"), Some(48500));
        assert_eq!(parse_amount_loose("Rp 5.000.000"), Some(5000000));
        assert_eq!(parse_amount_loose("1.234.567"), Some(1234567));
    }

    #[test]
    fn fractions_round_half_up_like_the_service() {
        assert_eq!(parse_amount_loose("12,5"), Some(13));
        assert_eq!(parse_amount_loose("12.5"), Some(13));
        assert_eq!(parse_amount_loose("1.234,56"), Some(1235));
    }

    #[test]
    fn mixed_separators_keep_the_service_quirk() {
        // The service read `1,234.56` as `1`; re-pricing that now would change
        // money already moving. Documented, kept.
        assert_eq!(parse_amount_loose("1,234.56"), Some(1));
    }

    #[test]
    fn negatives_survive_and_zero_is_a_value() {
        assert_eq!(parse_amount_loose("-5.000"), Some(-5000));
        assert_eq!(parse_amount_loose("0"), Some(0));
        assert_eq!(parse_amount_loose("kain"), None);
        assert_eq!(parse_amount_loose(""), None);
    }

    #[test]
    fn quantities_reject_negatives() {
        assert_eq!(parse_quantity_loose("24"), Some(24));
        assert_eq!(parse_quantity_loose("12,5"), Some(13));
        assert_eq!(parse_quantity_loose("-1"), None);
    }

    #[test]
    fn dates_are_day_first_and_four_shapes_only() {
        assert_eq!(parse_date_loose("2026-09-20"), Some("2026-09-20".into()));
        assert_eq!(parse_date_loose("20/09/2026"), Some("2026-09-20".into()));
        assert_eq!(parse_date_loose("20-09-26"), Some("2026-09-20".into()));
        assert_eq!(
            parse_date_loose("20 September 2026"),
            Some("2026-09-20".into())
        );
        assert_eq!(parse_date_loose("1 Agu 2026"), Some("2026-08-01".into()));
        assert_eq!(parse_date_loose("besok"), None);
        assert_eq!(parse_date_loose("13/13/2026"), None);
        assert_eq!(parse_date_loose("31/02/2026"), Some("2026-02-31".into()));
    }

    #[test]
    fn normalise_strips_suffixes_and_punctuation() {
        assert_eq!(normalise_name("CV. Sumber Tekstil"), "sumber tekstil");
        assert_eq!(normalise_name("PT Sumber Tekstil, TBK"), "sumber tekstil");
        assert_eq!(normalise_name("  KODE  BARANG "), "kode barang");
    }

    #[test]
    fn string_or_null_trims_to_none() {
        assert_eq!(string_or_null("  KLS-11 "), Some("KLS-11".into()));
        assert_eq!(string_or_null("   "), None);
    }
}
