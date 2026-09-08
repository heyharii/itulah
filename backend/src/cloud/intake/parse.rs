//! Turning what a bank sent into the lines the ledger already understands.
//!
//! Every parser here ends at the same place: an
//! [`ImportStatementRequest`](crate::cloud::postgres::ImportStatementRequest)'s
//! worth of lines, handed to the import that has existed since 0071. Nothing
//! in this module writes anything, reads a clock, or knows what an account is.
//!
//! # Why one mapping and not one parser per bank
//!
//! The reference implementation in `~/Documents/retail` has a parser per
//! acquirer — `mandiri_csv.go`, `bca_xlsx.go`, `bri_pdf.go` — each detected by
//! the shape of the filename, each with the column positions written into the
//! code. That is the right design for settlement reports, which are fixed
//! machine formats with hundreds of thousands of rows.
//!
//! It is the wrong one for a rekening koran. Those come out of an internet
//! banking screen, the columns move when the bank redesigns the page, and every
//! client exports a slightly different set of them. A parser per bank means a
//! deploy every time a column moves, performed by whoever can deploy, on behalf
//! of a clerk who could see the problem instantly. So the shape of the file is
//! a *stored mapping* — `bank_statement_source.settings` — and there are three
//! readers rather than nine parsers:
//!
//! * **CSV** — bytes to a grid, by delimiter.
//! * **XLSX** — bytes to a grid, by way of calamine, decrypting first when the
//!   bank sends the workbook under a password.
//! * **PDF_TEXT** — bytes to text, then one regex per line, because a PDF has
//!   no columns at all; what it has is a layout that happens to look like some.
//!
//! The first two share every line of the interesting part, because once you
//! have a grid it does not matter where the grid came from.
//!
//! # The two things this refuses to guess
//!
//! **A date it cannot read.** A row whose date does not parse under any of the
//! configured formats is not silently dropped when it carries money — `05/06`
//! is the fifth of June or the sixth of May, and a statement imported under the
//! wrong reading reconciles against the wrong week. It is reported.
//!
//! **A balance nobody stated.** `bank_statement` wants an opening and a closing
//! figure, and the whole point of them is that our ledger has to walk from one
//! to the other. When the file has a running balance column we take them from
//! it. When it does not, they are reported as absent rather than invented from
//! the sum of the lines — a computed closing balance always agrees with the
//! lines it was computed from, which makes the check that matters vacuous.

use crate::cloud::postgres::ImportStatementLine;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

/// Which reader opens the attachment.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub enum StatementFormat {
    Csv,
    Xlsx,
    PdfText,
}

impl StatementFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Csv => "CSV",
            Self::Xlsx => "XLSX",
            Self::PdfText => "PDF_TEXT",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_uppercase().as_str() {
            "CSV" => Some(Self::Csv),
            "XLSX" => Some(Self::Xlsx),
            "PDF_TEXT" => Some(Self::PdfText),
            _ => None,
        }
    }
}

/// A column, named or numbered.
///
/// Named is what a clerk can write down from looking at the file. Numbered is
/// what is left when the bank ships a file with no header row at all, which
/// several of them do.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ColumnRef {
    /// Zero-based position.
    Index(usize),
    /// Header text, matched case-insensitively and ignoring surrounding space.
    Name(String),
}

/// Which column is which.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ColumnMap {
    pub value_date: Option<ColumnRef>,
    pub description: Option<ColumnRef>,
    pub reference: Option<ColumnRef>,
    /// Money out of the account. Paired with `credit`.
    pub debit: Option<ColumnRef>,
    /// Money into the account. Paired with `debit`.
    pub credit: Option<ColumnRef>,
    /// One signed column instead of the pair. Negative is money out, unless
    /// `direction` says otherwise.
    pub amount: Option<ColumnRef>,
    /// A column holding `DB`/`CR` (or whatever `debit_markers` lists) beside an
    /// unsigned `amount`.
    pub direction: Option<ColumnRef>,
    /// The running balance, when the file carries one. Only used to recover the
    /// statement's opening and closing figures.
    pub balance: Option<ColumnRef>,
}

/// How the bank punctuates a number.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DecimalStyle {
    /// `1.234.567,89` — the Indonesian default, and every local bank's export.
    #[default]
    Comma,
    /// `1,234,567.89`.
    Dot,
}

/// Everything the reader needs that is not in the file.
#[derive(Clone, Debug, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// CSV only. A single character; anything longer is taken as a comma.
    pub delimiter: String,
    /// Rows to throw away before anything else — the bank's letterhead.
    pub skip_rows: usize,
    /// Whether the first surviving row names the columns. False means every
    /// `ColumnRef` must be an index.
    pub has_header: bool,
    /// XLSX only. Zero-based; the first sheet by default.
    pub sheet: usize,
    /// XLSX only. The password the workbook was encrypted under.
    pub password: Option<String>,
    pub columns: ColumnMap,
    /// Tried in order. The first that parses wins, so put the unambiguous one
    /// first when a bank's dates are ambiguous.
    pub date_formats: Vec<String>,
    pub decimal: DecimalStyle,
    /// How many digits after the separator are money rather than decoration.
    /// Zero for rupiah: `1.234.567,00` is one million two hundred thousand
    /// rupiah, and the `,00` is the export's habit, not a sub-unit.
    pub fraction_digits: u32,
    /// Values in the `direction` column that mean money left the account.
    pub debit_markers: Vec<String>,
    /// PDF_TEXT only. One regex applied to each line of extracted text, with
    /// named groups `date`, `description`, and then either `debit`/`credit`,
    /// or `amount` (with optional `direction`), plus an optional `reference`
    /// and `balance`. Lines that do not match are skipped.
    pub line_pattern: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            delimiter: ",".into(),
            skip_rows: 0,
            has_header: true,
            sheet: 0,
            password: None,
            columns: ColumnMap::default(),
            date_formats: vec![
                "%d/%m/%Y".into(),
                "%d-%m-%Y".into(),
                "%Y-%m-%d".into(),
                "%d/%m/%y".into(),
                "%d %b %Y".into(),
            ],
            decimal: DecimalStyle::Comma,
            fraction_digits: 0,
            debit_markers: vec!["DB".into(), "D".into(), "DEBET".into(), "DEBIT".into()],
            line_pattern: None,
        }
    }
}

/// What a reader made of the file.
#[derive(Clone, Debug)]
pub struct ParsedStatement {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    /// `None` when the file carried no running balance, which is a fact about
    /// the file and not a zero. See the note at the top of this module.
    pub opening_minor: Option<i64>,
    pub closing_minor: Option<i64>,
    pub lines: Vec<ImportStatementLine>,
    /// Rows this could not read, in the operator's words rather than the
    /// parser's. Never fatal on their own — a footer is a row a parser cannot
    /// read, and refusing the whole statement over one would be worse than
    /// saying so.
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    /// The mapping is wrong, or missing something it cannot work without. The
    /// operator can fix this from the screen.
    #[error("{0}")]
    Mapping(String),
    /// The bytes are not what the format says they are.
    #[error("{0}")]
    Malformed(String),
    /// Nothing in the file looked like a statement line. Kept separate from
    /// `Malformed` because it is the shape of a mapping pointed at the wrong
    /// sheet, not of a corrupt download.
    #[error("no statement lines found in {0}")]
    Empty(String),
}

/// A grid of cells, however it was obtained.
pub type Grid = Vec<Vec<String>>;

/// Read the file according to its source's mapping.
pub fn parse(
    format: StatementFormat,
    settings: &Settings,
    filename: &str,
    bytes: &[u8],
) -> Result<ParsedStatement, ParseError> {
    match format {
        StatementFormat::Csv => grid_to_statement(&csv_grid(settings, bytes)?, settings, filename),
        StatementFormat::Xlsx => {
            grid_to_statement(&super::xlsx::grid(settings, bytes)?, settings, filename)
        }
        StatementFormat::PdfText => super::pdf::statement(settings, filename, bytes),
    }
}

fn csv_grid(settings: &Settings, bytes: &[u8]) -> Result<Grid, ParseError> {
    let delimiter = settings
        .delimiter
        .as_bytes()
        .first()
        .copied()
        .unwrap_or(b',');
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        // The header is ours to skip, not the reader's, because `skip_rows`
        // runs first and a bank's letterhead is not a header.
        .has_headers(false)
        // Banks emit ragged rows constantly: a footer with two cells under a
        // table with nine. Refusing the file over that would be refusing most
        // files.
        .flexible(true)
        .from_reader(bytes);

    let mut grid = Grid::new();
    for record in reader.records() {
        let record = record.map_err(|error| ParseError::Malformed(error.to_string()))?;
        grid.push(record.iter().map(|cell| cell.trim().to_string()).collect());
    }
    Ok(grid)
}

/// Where each field lives, once the header has been read.
struct Resolved {
    value_date: usize,
    description: Option<usize>,
    reference: Option<usize>,
    debit: Option<usize>,
    credit: Option<usize>,
    amount: Option<usize>,
    direction: Option<usize>,
    balance: Option<usize>,
}

fn resolve(header: Option<&Vec<String>>, columns: &ColumnMap) -> Result<Resolved, ParseError> {
    let find = |reference: &Option<ColumnRef>, what: &str| -> Result<Option<usize>, ParseError> {
        let Some(reference) = reference else {
            return Ok(None);
        };
        match reference {
            ColumnRef::Index(index) => Ok(Some(*index)),
            ColumnRef::Name(name) => {
                let header = header.ok_or_else(|| {
                    ParseError::Mapping(format!(
                        "{what} names the column \"{name}\", but this source is set to have no header row"
                    ))
                })?;
                let wanted = name.trim().to_lowercase();
                header
                    .iter()
                    .position(|cell| cell.trim().to_lowercase() == wanted)
                    .map(Some)
                    .ok_or_else(|| {
                        ParseError::Mapping(format!(
                            "no column called \"{name}\"; the file has: {}",
                            header.join(", ")
                        ))
                    })
            }
        }
    };

    let value_date = find(&columns.value_date, "value_date")?.ok_or_else(|| {
        ParseError::Mapping("this source does not say which column holds the date".into())
    })?;
    let debit = find(&columns.debit, "debit")?;
    let credit = find(&columns.credit, "credit")?;
    let amount = find(&columns.amount, "amount")?;
    if amount.is_none() && debit.is_none() && credit.is_none() {
        return Err(ParseError::Mapping(
            "this source names neither a debit/credit pair nor a signed amount column".into(),
        ));
    }

    Ok(Resolved {
        value_date,
        description: find(&columns.description, "description")?,
        reference: find(&columns.reference, "reference")?,
        debit,
        credit,
        amount,
        direction: find(&columns.direction, "direction")?,
        balance: find(&columns.balance, "balance")?,
    })
}

fn cell<'a>(row: &'a [String], index: Option<usize>) -> &'a str {
    index
        .and_then(|index| row.get(index))
        .map(String::as_str)
        .unwrap_or("")
}

fn grid_to_statement(
    grid: &Grid,
    settings: &Settings,
    filename: &str,
) -> Result<ParsedStatement, ParseError> {
    let body = grid.get(settings.skip_rows..).unwrap_or(&[]);
    let (header, rows) = if settings.has_header {
        match body.split_first() {
            Some((header, rows)) => (Some(header), rows),
            None => (None, &body[..]),
        }
    } else {
        (None, body)
    };
    let map = resolve(header, &settings.columns)?;

    let mut lines = Vec::new();
    let mut warnings = Vec::new();
    // The balance beside the first and last line we could read, and the
    // movement on that first line — enough to walk the opening figure back out
    // of it.
    let mut first: Option<(i64, i64)> = None;
    let mut last: Option<i64> = None;

    for (offset, row) in rows.iter().enumerate() {
        // The row number a person sees in the spreadsheet, not the index this
        // loop happens to be at.
        let row_number = settings.skip_rows + offset + usize::from(settings.has_header) + 1;
        let date_text = cell(row, Some(map.value_date));
        let (debit, credit) = movement(row, &map, settings);

        if date_text.trim().is_empty() {
            if debit != 0 || credit != 0 {
                warnings.push(format!("row {row_number} carries money but has no date"));
            }
            continue;
        }
        let Some(value_date) = date(date_text, &settings.date_formats) else {
            // A footer row with a total in it lands here, and so does a real
            // line under a wrong date format. They are told apart by whether
            // there is money on the row.
            if debit != 0 || credit != 0 {
                warnings.push(format!(
                    "row {row_number}: cannot read \"{date_text}\" as a date"
                ));
            }
            continue;
        };
        if debit == 0 && credit == 0 {
            warnings.push(format!("row {row_number} has a date but no amount"));
            continue;
        }
        if debit != 0 && credit != 0 {
            warnings.push(format!(
                "row {row_number} is both a debit and a credit; skipped"
            ));
            continue;
        }

        if let Some(balance) = money(cell(row, map.balance), settings) {
            let signed = credit - debit;
            first.get_or_insert((balance, signed));
            last = Some(balance);
        }

        let description = cell(row, map.description).trim().to_string();
        let reference = cell(row, map.reference).trim().to_string();
        lines.push(ImportStatementLine {
            value_date,
            description: if description.is_empty() {
                // The import refuses nothing here, but a blank narration on a
                // screen full of them is unreadable, and the matcher scores on
                // it. Naming the file is more use than an empty string.
                format!("({filename})")
            } else {
                description
            },
            reference: (!reference.is_empty()).then_some(reference),
            debit_minor: debit,
            credit_minor: credit,
        });
    }

    finish(lines, warnings, first, last, filename)
}

/// The debit and credit on one row, from whichever columns the source names.
fn movement(row: &[String], map: &Resolved, settings: &Settings) -> (i64, i64) {
    if let Some(amount_index) = map.amount {
        let Some(amount) = money(cell(row, Some(amount_index)), settings) else {
            return (0, 0);
        };
        let marker = cell(row, map.direction).trim().to_uppercase();
        let outgoing = if marker.is_empty() {
            amount < 0
        } else {
            settings
                .debit_markers
                .iter()
                .any(|m| m.trim().eq_ignore_ascii_case(&marker))
        };
        let amount = amount.abs();
        return if outgoing { (amount, 0) } else { (0, amount) };
    }
    (
        money(cell(row, map.debit), settings).unwrap_or(0).abs(),
        money(cell(row, map.credit), settings).unwrap_or(0).abs(),
    )
}

fn finish(
    lines: Vec<ImportStatementLine>,
    warnings: Vec<String>,
    first: Option<(i64, i64)>,
    last: Option<i64>,
    filename: &str,
) -> Result<ParsedStatement, ParseError> {
    if lines.is_empty() {
        return Err(ParseError::Empty(filename.to_string()));
    }
    // A statement's window is the span of what it actually contains. Taking it
    // from the filename, which is where the month usually is, would date a
    // re-export of June under whatever July was called.
    let mut period_start = lines[0].value_date;
    let mut period_end = lines[0].value_date;
    for line in &lines {
        period_start = period_start.min(line.value_date);
        period_end = period_end.max(line.value_date);
    }
    // The balance before the first movement, which is what "opening" means.
    let opening = first.map(|(balance, signed)| balance - signed);
    Ok(ParsedStatement {
        period_start,
        period_end,
        opening_minor: opening,
        closing_minor: last,
        lines,
        warnings,
    })
}

/// Read a date under the first format that accepts it.
pub(super) fn date(text: &str, formats: &[String]) -> Option<NaiveDate> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    formats
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(text, format).ok())
}

/// Read a money figure, in whole units of whatever `fraction_digits` says the
/// decoration is.
///
/// Integer arithmetic throughout. A float here would round a hundred million
/// rupiah to the nearest few, and it would do it silently on exactly the
/// statements that matter.
pub(super) fn money(text: &str, settings: &Settings) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    // A trailing or leading marker: `1.000.000,00 DB`, `CR 250.000`.
    let negative = text.starts_with('-') || (text.starts_with('(') && text.ends_with(')'));
    let digits_and_separators: String = text
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    if digits_and_separators.chars().all(|c| !c.is_ascii_digit()) {
        return None;
    }

    let (group, point) = match settings.decimal {
        DecimalStyle::Comma => ('.', ','),
        DecimalStyle::Dot => (',', '.'),
    };
    let stripped: String = digits_and_separators
        .chars()
        .filter(|c| *c != group)
        .collect();
    let (whole, fraction) = match stripped.split_once(point) {
        Some((whole, fraction)) => (whole, fraction),
        None => (stripped.as_str(), ""),
    };

    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().ok()?
    };
    // Rupiah keeps no sub-unit, so `fraction_digits` is normally zero and the
    // `,00` every export carries is discarded. When a deployment does keep one,
    // the fraction is padded or truncated to exactly that many digits.
    let mut value = whole;
    if settings.fraction_digits > 0 {
        let wanted = settings.fraction_digits as usize;
        let mut padded: String = fraction.chars().filter(char::is_ascii_digit).collect();
        padded.truncate(wanted);
        while padded.len() < wanted {
            padded.push('0');
        }
        let scale = 10i64.checked_pow(settings.fraction_digits)?;
        value = value
            .checked_mul(scale)?
            .checked_add(padded.parse().ok()?)?;
    }
    Some(if negative { -value } else { value })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings {
            columns: ColumnMap {
                value_date: Some(ColumnRef::Name("Tanggal".into())),
                description: Some(ColumnRef::Name("Keterangan".into())),
                reference: Some(ColumnRef::Name("Ref".into())),
                debit: Some(ColumnRef::Name("Debet".into())),
                credit: Some(ColumnRef::Name("Kredit".into())),
                balance: Some(ColumnRef::Name("Saldo".into())),
                ..ColumnMap::default()
            },
            ..Settings::default()
        }
    }

    const KORAN: &str = "\
Tanggal,Keterangan,Ref,Debet,Kredit,Saldo
01/06/2026,SETORAN TUNAI,TRF001,,\"5.000.000,00\",\"15.000.000,00\"
02/06/2026,BIAYA ADMIN,,\"25.000,00\",,\"14.975.000,00\"
03/06/2026,TRANSFER KE SUPPLIER,TRF002,\"3.500.000,00\",,\"11.475.000,00\"
TOTAL,,,\"3.525.000,00\",\"5.000.000,00\",
";

    #[test]
    fn a_rekening_koran_becomes_lines_the_ledger_already_understands() {
        let parsed = parse(
            StatementFormat::Csv,
            &settings(),
            "rk.csv",
            KORAN.as_bytes(),
        )
        .unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(parsed.lines.len(), 3);
        assert_eq!(parsed.period_start.to_string(), "2026-06-01");
        assert_eq!(parsed.period_end.to_string(), "2026-06-03");
        assert_eq!(parsed.lines[0].credit_minor, 5_000_000);
        assert_eq!(parsed.lines[0].debit_minor, 0);
        assert_eq!(parsed.lines[0].reference.as_deref(), Some("TRF001"));
        assert_eq!(parsed.lines[1].debit_minor, 25_000);
        assert_eq!(parsed.lines[1].reference, None);
    }

    #[test]
    fn the_opening_figure_is_walked_back_out_of_the_first_balance() {
        let parsed = parse(
            StatementFormat::Csv,
            &settings(),
            "rk.csv",
            KORAN.as_bytes(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        // 15.000.000 after a 5.000.000 credit means 10.000.000 before it.
        assert_eq!(parsed.opening_minor, Some(10_000_000));
        assert_eq!(parsed.closing_minor, Some(11_475_000));
        // And it walks: opening + credits - debits = closing.
        let net: i64 = parsed
            .lines
            .iter()
            .map(|line| line.credit_minor - line.debit_minor)
            .sum();
        assert_eq!(parsed.opening_minor.map(|o| o + net), parsed.closing_minor);
    }

    #[test]
    fn a_file_with_no_balance_column_says_so_rather_than_inventing_one() {
        let mut settings = settings();
        settings.columns.balance = None;
        let parsed = parse(StatementFormat::Csv, &settings, "rk.csv", KORAN.as_bytes())
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed.opening_minor, None);
        assert_eq!(parsed.closing_minor, None);
    }

    #[test]
    fn a_total_row_is_skipped_and_never_becomes_a_movement() {
        let parsed = parse(
            StatementFormat::Csv,
            &settings(),
            "rk.csv",
            KORAN.as_bytes(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(!parsed
            .lines
            .iter()
            .any(|line| line.description.contains("TOTAL")));
        // But it is reported, because a row with money on it that we did not
        // import is exactly what somebody needs to be told about.
        assert!(parsed
            .warnings
            .iter()
            .any(|warning| warning.contains("TOTAL")));
    }

    #[test]
    fn one_signed_column_works_as_well_as_a_pair() {
        let csv = "\
Tanggal,Keterangan,Jumlah
01/06/2026,SETORAN,\"5.000.000,00\"
02/06/2026,ADMIN,\"-25.000,00\"
";
        let settings = Settings {
            columns: ColumnMap {
                value_date: Some(ColumnRef::Name("Tanggal".into())),
                description: Some(ColumnRef::Name("Keterangan".into())),
                amount: Some(ColumnRef::Name("Jumlah".into())),
                ..ColumnMap::default()
            },
            ..Settings::default()
        };
        let parsed = parse(StatementFormat::Csv, &settings, "m.csv", csv.as_bytes())
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed.lines[0].credit_minor, 5_000_000);
        assert_eq!(parsed.lines[1].debit_minor, 25_000);
    }

    #[test]
    fn a_direction_column_beats_the_sign() {
        let csv = "\
Tanggal,Keterangan,Jumlah,DK
01/06/2026,SETORAN,\"5.000.000,00\",CR
02/06/2026,ADMIN,\"25.000,00\",DB
";
        let settings = Settings {
            columns: ColumnMap {
                value_date: Some(ColumnRef::Name("Tanggal".into())),
                description: Some(ColumnRef::Name("Keterangan".into())),
                amount: Some(ColumnRef::Name("Jumlah".into())),
                direction: Some(ColumnRef::Name("DK".into())),
                ..ColumnMap::default()
            },
            ..Settings::default()
        };
        let parsed = parse(StatementFormat::Csv, &settings, "m.csv", csv.as_bytes())
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed.lines[0].credit_minor, 5_000_000);
        assert_eq!(parsed.lines[1].debit_minor, 25_000);
    }

    #[test]
    fn a_column_the_file_does_not_have_is_named_in_the_complaint() {
        let mut settings = settings();
        settings.columns.debit = Some(ColumnRef::Name("Pengeluaran".into()));
        let error = parse(StatementFormat::Csv, &settings, "rk.csv", KORAN.as_bytes())
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("Pengeluaran"), "{error}");
        // And it names what the file does have, so the fix is one edit away.
        assert!(error.contains("Debet"), "{error}");
    }

    #[test]
    fn a_mapping_with_no_amount_at_all_is_refused_before_a_single_row_is_read() {
        let settings = Settings {
            columns: ColumnMap {
                value_date: Some(ColumnRef::Index(0)),
                ..ColumnMap::default()
            },
            ..Settings::default()
        };
        assert!(matches!(
            parse(StatementFormat::Csv, &settings, "rk.csv", KORAN.as_bytes()),
            Err(ParseError::Mapping(_))
        ));
    }

    #[test]
    fn indonesian_punctuation_is_read_as_indonesian() {
        let settings = Settings::default();
        assert_eq!(money("1.234.567,89", &settings), Some(1_234_567));
        assert_eq!(money("0,00", &settings), Some(0));
        assert_eq!(money("(25.000)", &settings), Some(-25_000));
        assert_eq!(money("Rp 5.000.000", &settings), Some(5_000_000));
        assert_eq!(money("  ", &settings), None);
        assert_eq!(money("-", &settings), None);

        let dotted = Settings {
            decimal: DecimalStyle::Dot,
            ..Settings::default()
        };
        assert_eq!(money("1,234,567.89", &dotted), Some(1_234_567));
    }

    #[test]
    fn a_deployment_that_keeps_a_sub_unit_gets_one() {
        let settings = Settings {
            fraction_digits: 2,
            ..Settings::default()
        };
        assert_eq!(money("1.234,5", &settings), Some(123_450));
        assert_eq!(money("1.234,567", &settings), Some(123_456));
        assert_eq!(money("1.234", &settings), Some(123_400));
    }

    #[test]
    fn an_unreadable_date_on_a_row_with_money_is_reported_and_never_guessed() {
        let csv = "\
Tanggal,Keterangan,Debet,Kredit
2026.06.01,SETORAN,,\"5.000.000,00\"
01/06/2026,ADMIN,\"25.000,00\",
";
        let settings = Settings {
            columns: ColumnMap {
                value_date: Some(ColumnRef::Name("Tanggal".into())),
                description: Some(ColumnRef::Name("Keterangan".into())),
                debit: Some(ColumnRef::Name("Debet".into())),
                credit: Some(ColumnRef::Name("Kredit".into())),
                ..ColumnMap::default()
            },
            ..Settings::default()
        };
        let parsed = parse(StatementFormat::Csv, &settings, "rk.csv", csv.as_bytes())
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed.lines.len(), 1);
        assert!(parsed.warnings.iter().any(|w| w.contains("2026.06.01")));
    }

    #[test]
    fn a_letterhead_is_skipped_by_the_row_count_the_source_states() {
        let csv = "\
BANK CENTRAL ASIA
Rekening Koran 4471
Tanggal,Keterangan,Debet,Kredit
01/06/2026,SETORAN,,\"5.000.000,00\"
";
        let settings = Settings {
            skip_rows: 2,
            columns: ColumnMap {
                value_date: Some(ColumnRef::Name("Tanggal".into())),
                description: Some(ColumnRef::Name("Keterangan".into())),
                debit: Some(ColumnRef::Name("Debet".into())),
                credit: Some(ColumnRef::Name("Kredit".into())),
                ..ColumnMap::default()
            },
            ..Settings::default()
        };
        let parsed = parse(StatementFormat::Csv, &settings, "rk.csv", csv.as_bytes())
            .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(parsed.lines.len(), 1);
    }

    #[test]
    fn a_file_with_nothing_in_it_is_its_own_answer() {
        let csv = "Tanggal,Keterangan,Debet,Kredit\n";
        let settings = settings();
        assert!(matches!(
            parse(StatementFormat::Csv, &settings, "empty.csv", csv.as_bytes()),
            Err(ParseError::Mapping(_)) | Err(ParseError::Empty(_))
        ));
    }
}
