//! Heuristic text extraction — the local path, when the document's text came
//! from a text layer (or litparse) and no extraction model is configured. It
//! is honest narrow: it finds the shapes Indonesian purchase documents usually
//! print, and it would rather leave a field `None` than invent one — every
//! `None` becomes a wizard question on the draft.
//!
//! Ported from the deleted ingest service's `heuristicExtract`, assertions
//! included: the wizard asks about everything a regex produced, because a
//! regex's confidence is a guess pretending to be a fact.

use super::draft::Extracted;
use super::loose::{parse_amount_loose, parse_date_loose, parse_quantity_loose, string_or_null};
use std::sync::LazyLock;

fn compile(literal: &str) -> regex::Regex {
    match regex::Regex::new(literal) {
        Ok(regex) => regex,
        Err(error) => panic!("static PO-import regex is invalid: {error}: {literal}"),
    }
}

/// One item row the heuristics found. `unit_price` is whole currency units —
/// the shape the draft builder maps for every source, so a renamed field here
/// would quietly become a `None` price downstream.
#[derive(Debug)]
pub struct ExtractedLine {
    pub article_code: Option<String>,
    pub article_name: Option<String>,
    pub quantity: Option<i64>,
    pub unit: Option<String>,
    pub unit_price: Option<i64>,
    pub promised_date: Option<String>,
}

static SPLIT_LINES: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"\n+"));
static MEGA_SPLIT: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"\s{3,}"));
static SUPPLIER_LABEL: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"\b(supplier|vendor|pemasok|kepada|untuk)\b"));
static SUPPLIER_PREFIX: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(?i)^.*?(supplier|vendor|pemasok|kepada|untuk)\s*"));
static PO_LABEL: LazyLock<regex::Regex> = LazyLock::new(|| {
    compile(r"(?i)\b(?:nomor\s*po|no\.?\s*po\.?|po\s*no\.?|purchase\s*order)\b\s*[:#]?\s*(.+)$")
});
/// The tail after the label may itself carry "No." again ("Purchase Order
/// No. PO-2026/09/118") — strip it, then take the first token containing a
/// digit; a token without a digit is another label, not a document number.
static PO_TAIL_LABEL: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(?i)^(?:no|nomor)\b\.?\s*"));
static PO_TOKEN: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"^[A-Za-z0-9][A-Za-z0-9./-]*"));
static DATE_LABEL: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"(?i)\b(tanggal|date)\b"));
static ARRIVAL_WORD: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(?i)datang|arrival|deliver|kirim"));
static DATE_LABEL_PREFIX: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(?i).*?\b(tanggal|date)\b"));
static FOREIGN_CURRENCY: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"\b(usd|sgd)\b"));
static ITEM_ROW: LazyLock<regex::Regex> = LazyLock::new(|| {
    compile(r"(?i)^(.+?)\s+(\d{1,6}(?:[.,]\d{1,3})?)\s+(?:rp\.?\s*)?([\d.,]{3,})\s*$")
});
static ROW_INDEX: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"^\d+[).\s-]+"));
static CODE_TOKEN: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"^([A-Za-z0-9-]*\d[A-Za-z0-9-]*)(?:\s+(.*))?$"));
static TOTALS_WORD: LazyLock<regex::Regex> =
    LazyLock::new(|| compile(r"(?i)subtotal|total|ppn|discount|diskon|grand"));
static ALL_DIGITS: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"^\d+$"));

/// Split on PRINTED lines only. The service's old rule also cut on runs of
/// 3+ spaces, which served word-salad input but shredded well-formed tables.
/// A single space-separated mega-line is the fallback case: detected, not
/// assumed.
fn printed_lines(text: &str) -> Vec<String> {
    let by_newline: Vec<String> = SPLIT_LINES
        .split(text)
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    if by_newline.len() == 1
        && by_newline[0].chars().count() > 200
        && by_newline[0].contains(|c: char| c.is_ascii_digit())
    {
        return MEGA_SPLIT
            .split(&by_newline[0])
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
    }
    by_newline
}

pub fn heuristic_extract(text: &str) -> Extracted {
    let lines = printed_lines(text);
    let mut supplier_name: Option<String> = None;
    let mut po_number: Option<String> = None;
    let mut order_date: Option<String> = None;
    let mut expected_arrival: Option<String> = None;
    let mut currency: Option<String> = None;
    for line in &lines {
        let lower = line.to_lowercase();
        if supplier_name.is_none() && SUPPLIER_LABEL.is_match(&lower) {
            // Text after the first colon; without one, everything from the
            // label word onwards. An empty remainder keeps the slot open for
            // a later line.
            let after = match line.split_once(':') {
                Some((_, tail)) => tail.to_string(),
                None => SUPPLIER_PREFIX.replace(line, "").to_string(),
            };
            supplier_name = string_or_null(&after);
        }
        if po_number.is_none() {
            if let Some(m) = PO_LABEL.captures(line) {
                let tail = PO_TAIL_LABEL.replace(&m[1], "").trim().to_string();
                if let Some(token) = PO_TOKEN.find(&tail) {
                    if token.as_str().contains(|c: char| c.is_ascii_digit()) {
                        po_number = Some(token.as_str().to_string());
                    }
                }
            }
        }
        if order_date.is_none() && DATE_LABEL.is_match(&lower) && !ARRIVAL_WORD.is_match(&lower) {
            let remainder = DATE_LABEL_PREFIX.replace(line, "");
            order_date = parse_date_loose(&remainder);
        }
        if expected_arrival.is_none() && ARRIVAL_WORD.is_match(&lower) {
            expected_arrival = parse_date_loose(line);
        }
        if currency.is_none() {
            if let Some(m) = FOREIGN_CURRENCY.find(&lower) {
                currency = Some(m.as_str().to_uppercase());
            }
        }
    }
    // A supplier's letterhead is usually the first substantial line.
    if supplier_name.is_none() {
        supplier_name = lines.iter().find(|l| l.chars().count() > 3).cloned();
    }

    let mut lines_out = Vec::new();
    for line in &lines {
        let Some(m) = ITEM_ROW.captures(line) else {
            continue;
        };
        let name = m[1].trim().to_string();
        if name.chars().count() < 2 || ALL_DIGITS.is_match(&name) {
            continue;
        }
        if TOTALS_WORD.is_match(&name) {
            continue;
        }
        // The row's leading NUMBER is a row index, not the article's name, and
        // the first token after it that looks like a supplier code — digits
        // with letters, hyphenated — is the article's code. Both moves are
        // conservative: "Kain 3L" keeps its name whole because "Kain" carries
        // no digit.
        let mut name = ROW_INDEX.replace(&name, "").to_string();
        let mut code: Option<String> = None;
        if let Some(token) = CODE_TOKEN.captures(&name) {
            let candidate = &token[1];
            if candidate.chars().any(|c| c.is_ascii_alphabetic()) {
                if let Some(rest) = token.get(2) {
                    if rest.as_str().chars().count() >= 3 {
                        code = Some(candidate.to_string());
                        name = rest.as_str().to_string();
                    }
                }
            }
        }
        let Some(quantity) = parse_quantity_loose(&m[2]) else {
            continue;
        };
        let Some(price) = parse_amount_loose(&m[3]) else {
            continue;
        };
        if price == 0 {
            continue;
        }
        lines_out.push(ExtractedLine {
            article_code: code,
            article_name: string_or_null(&name),
            quantity: Some(quantity),
            unit: None,
            unit_price: Some(price),
            promised_date: None,
        });
    }

    Extracted {
        po_number,
        order_date,
        expected_arrival,
        currency: currency.unwrap_or_else(|| "IDR".to_string()),
        supplier_name,
        notes: None,
        lines: lines_out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_sheet_yields_supplier_number_and_lines() {
        let text = "\
CV Sumber Tekstil
Supplier: CV Sumber Tekstil
No. PO: PO-2026/09/118
Tanggal: 18/09/2026
Tanggal datang: 30/09/2026
Kemeja Flanel L 24 185000
KLS-11 Kain Katon Prima 120 48.500
";
        let got = heuristic_extract(text);
        assert_eq!(got.po_number.as_deref(), Some("PO-2026/09/118"));
        assert_eq!(got.supplier_name.as_deref(), Some("CV Sumber Tekstil"));
        assert_eq!(got.order_date.as_deref(), Some("2026-09-18"));
        assert_eq!(got.expected_arrival.as_deref(), Some("2026-09-30"));
        assert_eq!(got.currency, "IDR");
        assert_eq!(got.lines.len(), 2);
        assert_eq!(
            got.lines[0].article_name.as_deref(),
            Some("Kemeja Flanel L")
        );
        assert_eq!(got.lines[0].quantity, Some(24));
        assert_eq!(got.lines[0].unit_price, Some(185000));
        assert_eq!(got.lines[1].article_code.as_deref(), Some("KLS-11"));
        assert_eq!(
            got.lines[1].article_name.as_deref(),
            Some("Kain Katon Prima")
        );
        assert_eq!(got.lines[1].unit_price, Some(48500));
    }

    #[test]
    fn a_leading_row_index_becomes_the_code_not_the_name() {
        let got = heuristic_extract("1  KLS-11  Kain Katon Prima  120  48.500\n");
        assert_eq!(got.lines.len(), 1);
        assert_eq!(got.lines[0].article_code.as_deref(), Some("KLS-11"));
        assert_eq!(
            got.lines[0].article_name.as_deref(),
            Some("Kain Katon Prima")
        );
    }

    #[test]
    fn totals_rows_and_empty_names_are_not_items() {
        let text = "\
Subtotal 24 2.340.000
PPN 0 0
12 48.500
";
        let got = heuristic_extract(text);
        assert!(got.lines.is_empty(), "got {:?}", got.lines);
    }

    #[test]
    fn a_double_no_label_still_yields_one_number() {
        let got = heuristic_extract("Purchase Order  No. PO-2026/09/118\n");
        assert_eq!(got.po_number.as_deref(), Some("PO-2026/09/118"));
    }

    #[test]
    fn foreign_currency_is_recognised_and_defaults_to_idr() {
        assert_eq!(heuristic_extract("Payment in USD\n").currency, "USD");
        assert_eq!(heuristic_extract("nothing here\n").currency, "IDR");
    }

    #[test]
    fn a_mega_line_falls_back_to_space_runs() {
        let mut text = String::new();
        for index in 0..30 {
            text.push_str(&format!("Baris barang nomor {index}  12  48.500   "));
        }
        let got = heuristic_extract(&text);
        assert!(!got.lines.is_empty());
        assert_eq!(got.lines[0].unit_price, Some(48500));
    }
}
