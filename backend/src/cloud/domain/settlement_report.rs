//! Reading an acquirer's settlement report, whatever shape it arrived in.
//!
//! The report is a CSV of four things — an approval code, an amount, the fee
//! taken off it, and a date — and every acquirer writes those four differently.
//! One exports `1.250.000,00` with semicolons because a comma is its decimal
//! point; another writes `1,250,000.00` with commas; a third writes `1250000`
//! and states the fee once at the bottom. The date is `25/07/2026` or
//! `2026-07-25` or `25-07-2026`, and there is a header row, or there is not.
//!
//! None of that is interesting and all of it has to be handled, because the
//! alternative is a person retyping four hundred rows into a screen — which is
//! how a settlement gets curated against numbers nobody checked.
//!
//! # What it refuses to do
//!
//! It does not guess. A row it cannot read comes back in `rejected` with the
//! line number and the text, and the person curating sees exactly what the
//! parser could not make sense of. The failure this avoids is the one where a
//! malformed row is silently skipped and the settlement's total is short by an
//! amount nobody can find, because the evidence that it existed was dropped on
//! the way in.
//!
//! It also does not decide anything. It reports what the file says; whether
//! those rows are the right rows, and whether they match our own receipts, is a
//! judgement made on the screen by somebody who signs their name to it.
//!
//! # Money is whole rupiah
//!
//! `_minor` in this system is one rupiah — a shirt at 200,000 is `200_000`, as
//! `tax.rs` has it. So a report writing `1.250.000,00` means 1,250,000 minor
//! and the two trailing zeros are decoration. They are still parsed rather than
//! stripped, because `1.250.000,50` would otherwise read as 125,000,050.
//!
//! # Why it is pure
//!
//! The text arrives as an argument and the answer is a value. No clock, so a
//! date in the file is read as the three numbers written there and never
//! compared against today; no calendar type, for the reason the header of
//! `depreciation` gives. Turning `(2026, 7, 25)` into a real date — and
//! refusing the 31st of February — is the caller's job, one layer out, where
//! there is somewhere to put the refusal.

/// One line of the acquirer's report, read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementReportRow {
    /// The approval code. The join back to a till receipt and to the shop's own
    /// batch slip, which is why a row without one is rejected rather than kept.
    pub auth_code: String,
    pub amount_minor: i64,
    pub mdr_minor: i64,
    /// As written, in three numbers. Never validated as a calendar date here —
    /// see the header.
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

/// A line the parser could not read, kept whole.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RejectedReportRow {
    /// One-based, counting every line in the file including the header, so it
    /// is the number an editor shows.
    pub line_number: usize,
    pub reason: String,
    pub text: String,
}

/// Everything one report says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParsedSettlementReport {
    pub rows: Vec<SettlementReportRow>,
    pub rejected: Vec<RejectedReportRow>,
    /// The rows added up. Offered because every caller wants it and computing
    /// it twice is how two totals come to disagree.
    pub gross_minor: i64,
    pub mdr_minor: i64,
}

impl ParsedSettlementReport {
    /// What should reach the bank, if the report is right about itself.
    pub const fn net_minor(&self) -> i64 {
        self.gross_minor - self.mdr_minor
    }
}

/// Read a settlement report.
///
/// Column order is fixed — auth code, amount, MDR, date — because the reports
/// this was written against state it, and a parser that sniffed column meanings
/// would eventually decide an approval code was a date.
pub fn parse_settlement_report(text: &str) -> ParsedSettlementReport {
    let mut parsed = ParsedSettlementReport::default();
    let separator = detect_separator(text);

    for (offset, line) in text.lines().enumerate() {
        let line_number = offset + 1;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let fields = split_row(trimmed, separator);
        if fields.len() < 4 {
            // A one-field line is almost always a title or a total the exporter
            // appended, and calling that a rejection would fill the screen with
            // noise on every report. Anything with two or three fields is a row
            // that lost something, and that is worth saying out loud.
            if fields.len() > 1 {
                parsed.rejected.push(RejectedReportRow {
                    line_number,
                    reason: format!("{} fields; expected auth code, amount, MDR, date", fields.len()),
                    text: trimmed.to_string(),
                });
            }
            continue;
        }
        if looks_like_a_heading(&fields) {
            continue;
        }

        let auth_code = fields[0].trim().to_string();
        if auth_code.is_empty() {
            parsed.rejected.push(RejectedReportRow {
                line_number,
                reason: "no approval code, so nothing can be settled against it".to_string(),
                text: trimmed.to_string(),
            });
            continue;
        }
        let Some(amount_minor) = parse_money(&fields[1]) else {
            parsed.rejected.push(RejectedReportRow {
                line_number,
                reason: format!("cannot read '{}' as an amount", fields[1].trim()),
                text: trimmed.to_string(),
            });
            continue;
        };
        // An absent fee is zero, and an unreadable one is not. A report that
        // leaves the column blank is stating there was no charge; a report
        // writing something the parser cannot read is stating something, and
        // treating it as nothing would quietly overstate what we are owed.
        let mdr_minor = if fields[2].trim().is_empty() {
            0
        } else {
            match parse_money(&fields[2]) {
                Some(value) => value,
                None => {
                    parsed.rejected.push(RejectedReportRow {
                        line_number,
                        reason: format!("cannot read '{}' as a fee", fields[2].trim()),
                        text: trimmed.to_string(),
                    });
                    continue;
                }
            }
        };
        let Some((year, month, day)) = parse_date(&fields[3]) else {
            parsed.rejected.push(RejectedReportRow {
                line_number,
                reason: format!("cannot read '{}' as a date", fields[3].trim()),
                text: trimmed.to_string(),
            });
            continue;
        };

        parsed.gross_minor = parsed.gross_minor.saturating_add(amount_minor);
        parsed.mdr_minor = parsed.mdr_minor.saturating_add(mdr_minor);
        parsed.rows.push(SettlementReportRow {
            auth_code,
            amount_minor,
            mdr_minor,
            year,
            month,
            day,
        });
    }
    parsed
}

/// Comma or semicolon, whichever the file actually uses.
///
/// Counted outside quotes, because a semicolon-delimited Indonesian export has
/// a comma inside every amount and would otherwise look overwhelmingly
/// comma-delimited. Ties go to the comma: a file with neither is a single
/// column, and the comma is the reading that produces a clearer refusal.
fn detect_separator(text: &str) -> char {
    let mut commas = 0usize;
    let mut semicolons = 0usize;
    let mut tabs = 0usize;
    let mut quoted = false;
    for character in text.chars() {
        match character {
            '"' => quoted = !quoted,
            ',' if !quoted => commas += 1,
            ';' if !quoted => semicolons += 1,
            '\t' if !quoted => tabs += 1,
            _ => {}
        }
    }
    if semicolons > commas && semicolons >= tabs {
        ';'
    } else if tabs > commas && tabs > semicolons {
        '\t'
    } else {
        ','
    }
}

/// One row into its fields, honouring double quotes.
///
/// A doubled quote inside a quoted field is one literal quote, as every
/// spreadsheet writes it.
fn split_row(line: &str, separator: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' if quoted && characters.peek() == Some(&'"') => {
                current.push('"');
                characters.next();
            }
            '"' => quoted = !quoted,
            c if c == separator && !quoted => {
                fields.push(current.clone());
                current.clear();
            }
            c => current.push(c),
        }
    }
    fields.push(current);
    fields
}

/// A header row, recognised by the one field that cannot be a heading anywhere
/// else: an amount column that holds no digits.
fn looks_like_a_heading(fields: &[String]) -> bool {
    !fields[1].chars().any(|c| c.is_ascii_digit())
        && fields[1].chars().any(|c| c.is_ascii_alphabetic())
}

/// An amount, in whole rupiah, however it was written.
///
/// The rule for separators is the one every importer converges on: when both a
/// dot and a comma appear, the LAST of them is the decimal point and the other
/// groups thousands. When only one appears, it is a decimal point only if it is
/// followed by exactly two digits and nothing else — `1.250` is one thousand
/// two hundred and fifty rupiah in this client's writing, not one and a quarter.
///
/// Rounds half away from zero, so a fee of `0,50` is one rupiah rather than
/// none. A rounding that always fell towards zero would make a report of ten
/// thousand half-rupiah fees add up to nothing.
fn parse_money(field: &str) -> Option<i64> {
    let raw = field.trim();
    if raw.is_empty() {
        return None;
    }
    let negative = raw.starts_with('-') || (raw.starts_with('(') && raw.ends_with(')'));
    let digits_and_marks: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    if !digits_and_marks.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }

    let last_dot = digits_and_marks.rfind('.');
    let last_comma = digits_and_marks.rfind(',');
    let decimal_at = match (last_dot, last_comma) {
        (Some(dot), Some(comma)) => Some(dot.max(comma)),
        (Some(dot), None) => two_digit_tail(&digits_and_marks, dot),
        (None, Some(comma)) => two_digit_tail(&digits_and_marks, comma),
        (None, None) => None,
    };

    let (whole_part, fraction_part) = match decimal_at {
        Some(at) => (
            &digits_and_marks[..at],
            digits_and_marks.get(at + 1..).unwrap_or(""),
        ),
        None => (digits_and_marks.as_str(), ""),
    };

    let whole: String = whole_part.chars().filter(char::is_ascii_digit).collect();
    let fraction: String = fraction_part.chars().filter(char::is_ascii_digit).collect();
    let mut value: i64 = whole.parse().ok()?;

    // The fraction rounds into the rupiah, because the rupiah is the unit.
    if let Some(first) = fraction.chars().next() {
        if first.is_ascii_digit() && first >= '5' {
            value = value.checked_add(1)?;
        }
    }
    Some(if negative { -value } else { value })
}

/// Is the separator at `at` a decimal point — that is, followed by exactly two
/// digits and nothing more?
fn two_digit_tail(text: &str, at: usize) -> Option<usize> {
    let tail = text.get(at + 1..)?;
    if tail.len() == 2 && tail.chars().all(|c| c.is_ascii_digit()) {
        Some(at)
    } else {
        None
    }
}

/// A date as the three numbers written in it.
///
/// Four orderings are accepted and they are told apart by which component has
/// four digits: `2026-07-25` leads with the year, `25/07/2026` ends with it. A
/// two-digit year is refused rather than guessed at — a report that writes `26`
/// could mean 2026 or the twenty-sixth, and settling the wrong month is worse
/// than asking.
fn parse_date(field: &str) -> Option<(i32, u32, u32)> {
    let raw = field.trim();
    // The time an exporter appends is not a date and is not wanted.
    let date_part = raw.split_whitespace().next()?;
    let parts: Vec<&str> = date_part
        .split(['-', '/', '.'])
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() != 3 {
        return None;
    }
    if !parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }

    let (year_text, month_text, day_text) = if parts[0].len() == 4 {
        (parts[0], parts[1], parts[2])
    } else if parts[2].len() == 4 {
        (parts[2], parts[1], parts[0])
    } else {
        return None;
    };

    let year: i32 = year_text.parse().ok()?;
    let month: u32 = month_text.parse().ok()?;
    let day: u32 = day_text.parse().ok()?;
    // The cheapest possible sanity, and no more. Whether the 31st of a
    // thirty-day month exists is a calendar question, and this module has no
    // calendar on purpose.
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_comma_report_reads() {
        let parsed = parse_settlement_report(
            "auth,amount,mdr,date\n\
             880123,250000,5000,2026-07-25\n\
             880124,100000,2000,2026-07-25\n",
        );
        assert_eq!(parsed.rows.len(), 2);
        assert!(parsed.rejected.is_empty());
        assert_eq!(parsed.gross_minor, 350_000);
        assert_eq!(parsed.mdr_minor, 7_000);
        assert_eq!(parsed.net_minor(), 343_000);
        assert_eq!(parsed.rows[0].auth_code, "880123");
        assert_eq!(parsed.rows[0].year, 2026);
        assert_eq!(parsed.rows[0].month, 7);
        assert_eq!(parsed.rows[0].day, 25);
    }

    #[test]
    fn the_indonesian_export_reads_the_same_way() {
        // Semicolons, dots for thousands, a comma for the decimal, and the day
        // first. Everything an acquirer's own exporter does.
        let parsed = parse_settlement_report(
            "Kode Approval;Jumlah;MDR;Tanggal\n\
             880123;1.250.000,00;25.000,00;25/07/2026\n",
        );
        assert!(parsed.rejected.is_empty(), "{:?}", parsed.rejected);
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].amount_minor, 1_250_000);
        assert_eq!(parsed.rows[0].mdr_minor, 25_000);
        assert_eq!(parsed.rows[0].day, 25);
        assert_eq!(parsed.rows[0].month, 7);
    }

    #[test]
    fn a_thousands_dot_is_not_a_decimal_point() {
        assert_eq!(parse_money("1.250"), Some(1_250));
        assert_eq!(parse_money("1,250"), Some(1_250));
        assert_eq!(parse_money("1.250,00"), Some(1_250));
        assert_eq!(parse_money("1,250.00"), Some(1_250));
        assert_eq!(parse_money("250000"), Some(250_000));
        assert_eq!(parse_money("Rp 250.000"), Some(250_000));
    }

    #[test]
    fn half_a_rupiah_rounds_up_and_away_from_zero() {
        assert_eq!(parse_money("0,50"), Some(1));
        assert_eq!(parse_money("0,49"), Some(0));
        assert_eq!(parse_money("-1.000,50"), Some(-1_001));
        assert_eq!(parse_money("(1.000,50)"), Some(-1_001));
    }

    #[test]
    fn a_row_the_parser_cannot_read_comes_back_whole() {
        let parsed = parse_settlement_report(
            "880123,250000,5000,2026-07-25\n\
             880124,not a number,2000,2026-07-25\n",
        );
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rejected.len(), 1);
        assert_eq!(parsed.rejected[0].line_number, 2);
        assert!(parsed.rejected[0].text.contains("880124"));
        // And the total does not silently include it.
        assert_eq!(parsed.gross_minor, 250_000);
    }

    #[test]
    fn an_unreadable_fee_is_not_read_as_no_fee() {
        let parsed = parse_settlement_report("880123,250000,~~,2026-07-25\n");
        assert!(parsed.rows.is_empty());
        assert_eq!(parsed.rejected.len(), 1);
    }

    #[test]
    fn a_blank_fee_is_no_fee() {
        let parsed = parse_settlement_report("880123,250000,,2026-07-25\n");
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].mdr_minor, 0);
    }

    #[test]
    fn a_two_digit_year_is_refused_rather_than_guessed() {
        assert_eq!(parse_date("25/07/26"), None);
        assert_eq!(parse_date("2026-07-25"), Some((2026, 7, 25)));
        assert_eq!(parse_date("25-07-2026"), Some((2026, 7, 25)));
        assert_eq!(parse_date("25/07/2026 14:03"), Some((2026, 7, 25)));
        assert_eq!(parse_date("2026-13-01"), None);
    }

    #[test]
    fn a_quoted_field_keeps_its_separator() {
        let fields = split_row("\"880,123\",250000,5000,2026-07-25", ',');
        assert_eq!(fields[0], "880,123");
        assert_eq!(fields.len(), 4);
    }

    #[test]
    fn an_empty_report_is_an_empty_answer_and_not_a_failure() {
        let parsed = parse_settlement_report("");
        assert!(parsed.rows.is_empty());
        assert!(parsed.rejected.is_empty());
        assert_eq!(parsed.gross_minor, 0);
    }

    #[test]
    fn a_trailing_total_line_is_not_a_rejection() {
        let parsed = parse_settlement_report(
            "880123,250000,5000,2026-07-25\n\
             TOTAL\n",
        );
        assert_eq!(parsed.rows.len(), 1);
        assert!(parsed.rejected.is_empty());
    }
}
