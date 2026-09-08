//! A statement that arrived as a picture of a table.
//!
//! # Why this is a regex and not a parser
//!
//! A PDF has no columns. What it has is text with coordinates, and the columns
//! are something a human eye assembles from where the numbers happen to line
//! up. Extraction gives back a line of text per visual line — and where the
//! two ends of that line came from is gone.
//!
//! The reference implementation writes a parser per bank against that text
//! (`bri_pdf.go` reads BRI's detail and summary layouts by position). It works,
//! and it is right there, because a settlement report is a machine format that
//! changes when the acquirer ships a release.
//!
//! It is the wrong shape here for the reason stated in `parse.rs`, and worse:
//! writing a BRI layout from memory rather than from a file the client actually
//! received would be *inventing* a format, and it would look exactly like a
//! working parser right up until the first real statement went through it and
//! silently produced nothing. So the layout is a regex on the source rule. The
//! operator pastes a line from the PDF, writes the pattern once, and the shape
//! is stored next to the account it belongs to rather than compiled into a
//! binary somebody has to redeploy.
//!
//! # The groups
//!
//! Named, so the pattern documents itself:
//!
//! ```text
//! (?<date>\d{2}/\d{2}/\d{4})\s+(?<description>.+?)\s+(?<debit>[\d.,]*)\s+(?<credit>[\d.,]*)\s+(?<balance>[\d.,]+)
//! ```
//!
//! `date` is required; `description`, `reference` and `balance` are optional;
//! and the amount is either `debit`/`credit` or `amount` with an optional
//! `direction`, exactly as in the grid readers. A line that does not match is
//! skipped in silence — most lines of a bank PDF are the letterhead, the page
//! footer, and the disclaimer.

use super::parse::{date, money, ParseError, ParsedStatement, Settings};
use crate::cloud::postgres::ImportStatementLine;
use regex::Regex;

pub fn statement(
    settings: &Settings,
    filename: &str,
    bytes: &[u8],
) -> Result<ParsedStatement, ParseError> {
    let pattern = settings.line_pattern.as_deref().ok_or_else(|| {
        ParseError::Mapping(
            "a PDF source needs a line_pattern: a regex with a `date` group, a `description` \
             group, and either `debit`/`credit` or `amount`"
                .into(),
        )
    })?;
    let pattern = Regex::new(pattern)
        .map_err(|error| ParseError::Mapping(format!("line_pattern will not compile: {error}")))?;
    if pattern.capture_names().flatten().all(|name| name != "date") {
        return Err(ParseError::Mapping(
            "line_pattern has no `date` group, so nothing it matched could be dated".into(),
        ));
    }

    // `pdf_extract` panics on some malformed documents rather than returning an
    // error. A bank's mail is not a trusted input and one bad attachment must
    // not take the poller down with it, so the panic is caught here and
    // reported as what it is.
    let text = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes))
        .map_err(|_| ParseError::Malformed("the PDF could not be read at all".into()))?
        .map_err(|error| ParseError::Malformed(format!("cannot read the PDF: {error}")))?;

    let mut lines = Vec::new();
    let mut warnings = Vec::new();
    let mut first: Option<(i64, i64)> = None;
    let mut last: Option<i64> = None;

    for (number, raw) in text.lines().enumerate() {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let Some(found) = pattern.captures(raw) else {
            continue;
        };
        let group = |name: &str| -> String {
            found
                .name(name)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default()
        };

        let Some(value_date) = date(&group("date"), &settings.date_formats) else {
            warnings.push(format!(
                "line {}: matched the pattern but \"{}\" is not a date in any configured format",
                number + 1,
                group("date")
            ));
            continue;
        };

        let (debit, credit) = if found.name("amount").is_some() {
            let amount = money(&group("amount"), settings).unwrap_or(0);
            let marker = group("direction").to_uppercase();
            let outgoing = if marker.is_empty() {
                amount < 0
            } else {
                settings
                    .debit_markers
                    .iter()
                    .any(|m| m.trim().eq_ignore_ascii_case(&marker))
            };
            let amount = amount.abs();
            if outgoing {
                (amount, 0)
            } else {
                (0, amount)
            }
        } else {
            (
                money(&group("debit"), settings).unwrap_or(0).abs(),
                money(&group("credit"), settings).unwrap_or(0).abs(),
            )
        };

        if debit == 0 && credit == 0 {
            warnings.push(format!("line {}: no amount on a matched line", number + 1));
            continue;
        }
        if debit != 0 && credit != 0 {
            warnings.push(format!(
                "line {}: both a debit and a credit; skipped",
                number + 1
            ));
            continue;
        }

        if let Some(balance) = money(&group("balance"), settings) {
            first.get_or_insert((balance, credit - debit));
            last = Some(balance);
        }

        let description = group("description");
        let reference = group("reference");
        lines.push(ImportStatementLine {
            value_date,
            description: if description.is_empty() {
                format!("({filename})")
            } else {
                description
            },
            reference: (!reference.is_empty()).then_some(reference),
            debit_minor: debit,
            credit_minor: credit,
        });
    }

    if lines.is_empty() {
        return Err(ParseError::Empty(filename.to_string()));
    }
    let mut period_start = lines[0].value_date;
    let mut period_end = lines[0].value_date;
    for line in &lines {
        period_start = period_start.min(line.value_date);
        period_end = period_end.max(line.value_date);
    }
    Ok(ParsedStatement {
        period_start,
        period_end,
        opening_minor: first.map(|(balance, signed)| balance - signed),
        closing_minor: last,
        lines,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pdf_source_without_a_pattern_says_what_the_pattern_is_for() {
        let error = statement(&Settings::default(), "rk.pdf", b"%PDF-1.4")
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("line_pattern"), "{error}");
        assert!(error.contains("date"), "{error}");
    }

    #[test]
    fn a_pattern_that_will_not_compile_is_the_operators_mistake_not_the_files() {
        let settings = Settings {
            line_pattern: Some("(?<date>".into()),
            ..Settings::default()
        };
        assert!(matches!(
            statement(&settings, "rk.pdf", b"%PDF-1.4"),
            Err(ParseError::Mapping(_))
        ));
    }

    #[test]
    fn a_pattern_with_no_date_group_is_refused_before_the_pdf_is_opened() {
        let settings = Settings {
            line_pattern: Some(r"(?<description>.+)".into()),
            ..Settings::default()
        };
        let error = statement(&settings, "rk.pdf", b"not a pdf at all")
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("`date` group"), "{error}");
    }

    #[test]
    fn bytes_that_are_not_a_pdf_are_reported_rather_than_crashing_the_poller() {
        let settings = Settings {
            line_pattern: Some(r"(?<date>\d{2}/\d{2}/\d{4})\s+(?<description>.+)".into()),
            ..Settings::default()
        };
        assert!(matches!(
            statement(&settings, "rk.pdf", b"this is not a PDF"),
            Err(ParseError::Malformed(_))
        ));
    }
}
