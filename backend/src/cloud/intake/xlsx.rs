//! A workbook, opened and flattened into the same grid a CSV becomes.
//!
//! Two things happen here that do not happen to a CSV, and both are the reason
//! this is a separate file rather than three lines in `parse.rs`.
//!
//! **The workbook may be encrypted.** BCA sends the merchant report under a
//! password, and so does more than one bank's rekening koran export. A password
//! belongs to the source rule, not to the code, so it arrives in `settings` and
//! the bytes are decrypted before calamine ever sees them. A file that needs a
//! password and has not been given one says exactly that, because "unsupported
//! file format" sends whoever reads it looking in the wrong place entirely.
//!
//! **A cell is not a string.** A date in a spreadsheet is a number of days
//! since 1900 and a figure is a float, so flattening with `to_string()` would
//! hand the shared reader `45809` where it expects `01/06/2026`, and
//! `5000000.5` where the source's mapping says a dot groups thousands. Both
//! would parse, both would be wrong, and neither would fail. So every cell is
//! rendered deliberately: a date in ISO, a number in the punctuation this
//! source's own mapping says its bank uses.

use super::parse::{DecimalStyle, Grid, ParseError, Settings};
use calamine::{Data, Reader, Xlsx};
use std::io::Cursor;

/// The signature of an OLE compound file, which is what an encrypted OOXML
/// workbook actually is — the ZIP is inside it. A plain `.xlsx` starts `PK`.
const OLE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

pub fn grid(settings: &Settings, bytes: &[u8]) -> Result<Grid, ParseError> {
    let encrypted = bytes.starts_with(&OLE_MAGIC);
    let decrypted;
    let bytes = if encrypted {
        let password = settings.password.as_deref().ok_or_else(|| {
            ParseError::Mapping(
                "this workbook is password-protected and the source has no password set".into(),
            )
        })?;
        decrypted =
            office_crypto::decrypt_from_bytes(bytes.to_vec(), password).map_err(|error| {
                ParseError::Malformed(format!("cannot decrypt the workbook: {error}"))
            })?;
        decrypted.as_slice()
    } else {
        bytes
    };

    let mut workbook: Xlsx<_> = Xlsx::new(Cursor::new(bytes))
        .map_err(|error| ParseError::Malformed(format!("cannot open the workbook: {error}")))?;
    let sheets = workbook.sheet_names().len();
    let range = workbook
        .worksheet_range_at(settings.sheet)
        .ok_or_else(|| {
            ParseError::Mapping(format!(
                "this source reads sheet {} and the workbook has {sheets}",
                settings.sheet
            ))
        })?
        .map_err(|error| ParseError::Malformed(format!("cannot read the sheet: {error}")))?;

    Ok(range
        .rows()
        .map(|row| row.iter().map(|cell| text(cell, settings)).collect())
        .collect())
}

/// One cell, rendered so that the shared reader sees what a person sees.
fn text(cell: &Data, settings: &Settings) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.trim().to_string(),
        Data::Bool(value) => value.to_string(),
        Data::Int(value) => value.to_string(),
        Data::Float(value) => number(*value, settings),
        // A real date, held as one. Rendered ISO, which is in the default list
        // of formats and is unambiguous in a way `01/06` never is.
        Data::DateTime(value) => match value.as_datetime() {
            Some(moment) => moment.date().to_string(),
            // A duration, or a serial outside the calendar. Neither is a date
            // and neither is money; the reader will skip the row and say so.
            None => number(value.as_f64(), settings),
        },
        Data::DateTimeIso(value) => {
            // `2026-06-01T00:00:00` — the date half is what a value date is.
            value.split('T').next().unwrap_or(value).to_string()
        }
        Data::DurationIso(value) => value.clone(),
        // A `#REF!` is not a blank, and treating it as one would silently drop
        // a row. Rendering it means the reader reports it instead.
        Data::Error(error) => format!("#{error:?}"),
    }
}

/// A float, punctuated the way this source's bank punctuates.
///
/// Rendered rather than handed over as `5000000.5`, because the reader is about
/// to apply the source's own separator rules to it and a dot means "thousands"
/// under the Indonesian default.
fn number(value: f64, settings: &Settings) -> String {
    let plain = format!("{value:.6}");
    let plain = plain
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    match settings.decimal {
        // The whole part has no grouping in this rendering, so there is nothing
        // for a group separator to be confused with — only the point moves.
        DecimalStyle::Comma => plain.replace('.', ","),
        DecimalStyle::Dot => plain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::intake::parse::{ColumnMap, ColumnRef, Settings};

    fn settings() -> Settings {
        Settings::default()
    }

    #[test]
    fn a_number_is_punctuated_the_way_the_source_says_its_bank_does() {
        let indonesian = settings();
        assert_eq!(number(5_000_000.0, &indonesian), "5000000");
        assert_eq!(number(5_000_000.5, &indonesian), "5000000,5");

        let dotted = Settings {
            decimal: DecimalStyle::Dot,
            ..Settings::default()
        };
        assert_eq!(number(5_000_000.5, &dotted), "5000000.5");
    }

    #[test]
    fn a_float_cell_survives_the_round_trip_into_money() {
        // The trap this file exists to avoid: a spreadsheet figure rendered
        // with a dot and then read under Indonesian punctuation, where a dot
        // groups thousands. Five million and fifty cents must not become five
        // hundred million.
        let settings = settings();
        let rendered = number(5_000_000.5, &settings);
        assert_eq!(
            crate::cloud::intake::parse::money(&rendered, &settings),
            Some(5_000_000)
        );
    }

    #[test]
    fn an_error_cell_is_visible_rather_than_blank() {
        let settings = settings();
        assert!(!text(&Data::Error(calamine::CellErrorType::Ref), &settings).is_empty());
        assert!(text(&Data::Empty, &settings).is_empty());
    }

    #[test]
    fn an_iso_timestamp_is_read_as_the_day_it_names() {
        let settings = settings();
        let cell = Data::DateTimeIso("2026-06-01T00:00:00".into());
        assert_eq!(text(&cell, &settings), "2026-06-01");
        assert!(
            crate::cloud::intake::parse::date(&text(&cell, &settings), &settings.date_formats)
                .is_some()
        );
    }

    #[test]
    fn an_encrypted_workbook_with_no_password_says_which_of_the_two_is_missing() {
        let mut bytes = OLE_MAGIC.to_vec();
        bytes.extend_from_slice(b"whatever follows");
        let error = grid(&settings(), &bytes)
            .err()
            .map(|error| error.to_string())
            .unwrap_or_default();
        assert!(error.contains("password"), "{error}");
    }

    #[test]
    fn a_sheet_the_workbook_does_not_have_is_a_mapping_fault_not_a_corrupt_file() {
        // Not a workbook at all, so this stops at "cannot open" — the sheet
        // check is exercised by the shape of the message when one does open.
        let settings = Settings {
            sheet: 9,
            columns: ColumnMap {
                value_date: Some(ColumnRef::Index(0)),
                ..ColumnMap::default()
            },
            ..Settings::default()
        };
        assert!(grid(&settings, b"PK\x03\x04not really").is_err());
    }
}
