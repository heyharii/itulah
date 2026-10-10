//! Excel — read locally, no OCR, no model. A spreadsheet's cells are already
//! data; the only judgement here is which column is which, and the header
//! vocabulary below is deliberately wide (Indonesian and English both)
//! because suppliers name their columns fifteen different ways.
//!
//! One workbook → one draft per sheet that carries item-like rows. Header
//! facts (supplier, dates) are read from cells ABOVE the table and from a
//! key/value block, both common shapes in Indonesian purchase sheets.
//!
//! Column matching is two-pass on purpose. A header that IS one of a field's
//! names claims that column outright; only then do looser substring matches
//! run, and a claimed column never enters that pass. Without the first pass,
//! `kode barang` — the article CODE's column — was also read as the article
//! NAME, because `barang` lives in the name vocabulary too, and supplier
//! codes landed in every item's name.

use std::collections::BTreeMap;
use std::io::Cursor;

use calamine::Reader;

use super::draft::{new_draft_id, new_line_id, PoImportDraft, PoImportDraftLine};
use super::loose::{
    normalise_name, parse_amount_loose, parse_date_loose, parse_quantity_loose, string_or_null,
};
use crate::cloud::domain::uom::split_quantity;

const ALIASES: &[(&str, &[&str])] = &[
    (
        "article_code",
        &[
            "kode",
            "kode barang",
            "kode artikel",
            "sku",
            "code",
            "item code",
            "article code",
        ],
    ),
    (
        "article_name",
        &[
            "nama",
            "nama barang",
            "nama artikel",
            "nama item",
            "item",
            "item name",
            "article name",
            "description",
            "deskripsi",
            "barang",
        ],
    ),
    ("quantity", &["qty", "quantity", "jumlah", "banyak", "vol"]),
    ("unit", &["satuan", "unit", "uom", "unit ukuran"]),
    (
        "unit_price",
        &[
            "harga",
            "harga satuan",
            "harga unit",
            "price",
            "unit price",
            "harga/unit",
            "harga sat",
        ],
    ),
    (
        "promised_date",
        &[
            "tanggal datang",
            "tgl datang",
            "delivery date",
            "promised",
            "jatuh tempo kirim",
            "estimasi datang",
        ],
    ),
];

/// One header row → which column each field reads from. Exact alias wins
/// before substring, and one column serves one field.
pub fn column_map(headers: &[Option<String>]) -> BTreeMap<&'static str, usize> {
    let normalised: Vec<String> = headers
        .iter()
        .map(|header| normalise_name(header.as_deref().unwrap_or("")))
        .collect();
    let mut map: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut claimed: Vec<bool> = vec![false; headers.len()];
    for (field, aliases) in ALIASES {
        for (index, header) in normalised.iter().enumerate() {
            if claimed[index] || header.is_empty() {
                continue;
            }
            if aliases.iter().any(|alias| *header == normalise_name(alias)) {
                map.insert(field, index);
                claimed[index] = true;
                break;
            }
        }
    }
    for (field, aliases) in ALIASES {
        if map.contains_key(field) {
            continue;
        }
        for (index, header) in normalised.iter().enumerate() {
            if claimed[index] || header.is_empty() {
                continue;
            }
            if aliases
                .iter()
                .any(|alias| header.contains(&normalise_name(alias)))
            {
                map.insert(field, index);
                claimed[index] = true;
                break;
            }
        }
    }
    map
}

/// A workbook's bytes → drafts, one per sheet that carries item-like rows.
/// A sheet nobody can read as an order is simply not a draft; a workbook with
/// none at all is the caller's "failed" report.
pub fn excel_file_to_drafts(file_name: &str, bytes: &[u8]) -> Result<Vec<PoImportDraft>, String> {
    let mut workbook = calamine::open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|error| error.to_string())?;
    let mut drafts = Vec::new();
    for sheet_name in workbook.sheet_names() {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|error| error.to_string())?;
        let grid: Vec<Vec<Option<String>>> = range
            .rows()
            .map(|row| row.iter().map(cell_to_text).collect())
            .collect();
        if let Some(mut draft) = grid_to_draft(&grid, &sheet_name) {
            draft.source_files = vec![file_name.to_string()];
            drafts.push(draft);
        }
    }
    Ok(drafts)
}

/// A CSV is the same shape with a humbler reader: one sheet, cells as text.
pub fn csv_file_to_drafts(file_name: &str, bytes: &[u8]) -> Result<Vec<PoImportDraft>, String> {
    let text = String::from_utf8_lossy(bytes);
    let mut grid: Vec<Vec<Option<String>>> = Vec::new();
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    for record in reader.records() {
        let record = record.map_err(|error| error.to_string())?;
        grid.push(record.iter().map(string_or_null).collect::<Vec<_>>());
    }
    let drafts = grid_to_draft(&grid, file_name)
        .into_iter()
        .map(|mut draft| {
            draft.source_files = vec![file_name.to_string()];
            draft
        })
        .collect();
    Ok(drafts)
}

/// One grid → at most one draft. The header row is the first row whose columns
/// name at least two of the fields; everything above it is fair game for
/// header facts, everything below it is the table.
fn grid_to_draft(grid: &[Vec<Option<String>>], sheet_name: &str) -> Option<PoImportDraft> {
    if grid.is_empty() {
        return None;
    }
    let header_row = grid.iter().position(|row| column_map(row).len() >= 2)?;
    let map = column_map(&grid[header_row]);

    let body: Vec<&Vec<Option<String>>> = grid[header_row + 1..]
        .iter()
        .filter(|row| {
            let name = map
                .get("article_name")
                .and_then(|&i| row.get(i))
                .and_then(|c| c.as_deref());
            let code = map
                .get("article_code")
                .and_then(|&i| row.get(i))
                .and_then(|c| c.as_deref());
            let qty = map
                .get("quantity")
                .and_then(|&i| row.get(i))
                .and_then(|c| c.as_deref());
            let price = map
                .get("unit_price")
                .and_then(|&i| row.get(i))
                .and_then(|c| c.as_deref());
            // A sheet with a code column but no name column is still an order:
            // the code is the identity the order needs, the wizard can carry
            // the rest.
            (matches!(name, Some(name) if !name.trim().is_empty())
                || matches!(code, Some(code) if !code.trim().is_empty()))
                && (qty.is_some() || price.is_some())
        })
        .collect();
    if body.is_empty() {
        return None;
    }

    // Facts printed above the table: scan for labelled cells with the value in
    // the NEXT cell over.
    let mut supplier_name: Option<String> = None;
    let mut po_number: Option<String> = None;
    let mut order_date: Option<String> = None;
    let mut expected_arrival: Option<String> = None;
    for row in &grid[..header_row] {
        if row.len() < 2 {
            continue;
        }
        for c in 0..row.len() - 1 {
            let label = normalise_name(row[c].as_deref().unwrap_or(""));
            let Some(value) = row[c + 1].as_deref() else {
                continue;
            };
            if label.is_empty() {
                continue;
            }
            if supplier_name.is_none() && (label.contains("supplier") || label.contains("vendor")) {
                supplier_name = Some(value.to_string());
            }
            if po_number.is_none()
                && (label.contains("no po")
                    || label.contains("po number")
                    || label.contains("nomor po"))
            {
                po_number = Some(value.to_string());
            }
            if order_date.is_none() && (label.contains("tanggal") || label.contains("date")) {
                order_date = parse_date_loose(value);
            }
            if expected_arrival.is_none()
                && (label.contains("datang")
                    || label.contains("arrival")
                    || label.contains("deliver"))
            {
                expected_arrival = parse_date_loose(value);
            }
        }
    }

    Some(PoImportDraft {
        draft_id: new_draft_id(),
        source_files: Vec::new(),
        po_number,
        supplier_name,
        supplier_id: None,
        destination_site_id: None,
        currency: Some("IDR".to_string()),
        order_date,
        expected_arrival,
        notes: None,
        lines: body
            .iter()
            .map(|row| {
                // "10 lusin" typed into the quantity cell is a quantity and
                // a unit; a unit column, when there is one, still wins.
                let typed = cell_at(&map, row, "quantity");
                let split = typed
                    .and_then(|c| split_quantity(c))
                    .filter(|(quantity, word)| quantity.fract().is_zero() && word.is_some());
                let quantity = match &split {
                    Some((quantity, _)) => rust_decimal::prelude::ToPrimitive::to_i64(quantity),
                    None => typed.and_then(|c| parse_quantity_loose(c)),
                };
                let unit = cell_at(&map, row, "unit")
                    .and_then(|c| string_or_null(c))
                    .or_else(|| split.and_then(|(_, word)| word));
                PoImportDraftLine {
                    line_id: new_line_id(),
                    article_code: cell_at(&map, row, "article_code")
                        .and_then(|c| string_or_null(c)),
                    article_name: cell_at(&map, row, "article_name")
                        .and_then(|c| string_or_null(c)),
                    quantity,
                    unit,
                    unit_code: None,
                    unit_price_minor: cell_at(&map, row, "unit_price")
                        .and_then(|c| parse_amount_loose(c)),
                    promised_date: cell_at(&map, row, "promised_date")
                        .and_then(|c| parse_date_loose(c)),
                }
            })
            .collect(),
        questions: Vec::new(),
        confidence: BTreeMap::new(),
        // The spreadsheet path is deterministic — the header mapping either
        // matched or did not. Stated on the draft so the review summary can
        // show where each figure came from.
        parser: "excel".to_string(),
        parser_note: Some(format!(
            "Sheet \"{sheet_name}\": {} baris item dibaca langsung dari Excel.",
            body.len()
        )),
    })
}

fn cell_at<'a>(
    map: &BTreeMap<&str, usize>,
    row: &'a [Option<String>],
    field: &str,
) -> Option<&'a String> {
    map.get(field)
        .and_then(|&index| row.get(index))
        .and_then(|cell| cell.as_ref())
}

/// Cells as the service read them: text, with dates as ISO and floats without
/// a trailing `.0` — `48500`, never `48500.0`.
fn cell_to_text(cell: &calamine::Data) -> Option<String> {
    match cell {
        calamine::Data::Empty => None,
        calamine::Data::Int(value) => Some(value.to_string()),
        calamine::Data::String(text) => Some(text.clone()),
        calamine::Data::Float(value) => {
            if value.fract() == 0.0 && value.abs() < 1e15 {
                Some(format!("{value:.0}"))
            } else {
                Some(format!("{value}"))
            }
        }
        calamine::Data::Bool(value) => Some(value.to_string()),
        calamine::Data::DateTime(value) => value
            .as_datetime()
            .map(|moment| moment.format("%Y-%m-%d").to_string()),
        calamine::Data::DateTimeIso(text) => Some(text.clone()),
        calamine::Data::DurationIso(text) => Some(text.clone()),
        calamine::Data::Error(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&[&str]]) -> Vec<Vec<Option<String>>> {
        rows.iter()
            .map(|row| {
                row.iter()
                    .map(|cell| {
                        if cell.is_empty() {
                            None
                        } else {
                            Some(cell.to_string())
                        }
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn kode_barang_is_the_code_and_nama_barang_is_the_name() {
        // The regression: `barang` is also a name alias, so the loose pass
        // used to hand BOTH fields the code column.
        let sheet = grid(&[
            &["Supplier", "CV Sumber Tekstil", ""],
            &["Nomor PO", "PO-2026/09/118", ""],
            &["Tanggal", "18/09/2026", ""],
            &["Tanggal datang", "30/09/2026", ""],
            &[
                "kode barang",
                "nama barang",
                "qty",
                "satuan",
                "harga satuan",
            ],
            &["KLS-11", "Kain Katon Prima", "120", "potong", "48500"],
            &["KLS-12", "Kemeja Flanel L", "24", "pcs", "185000"],
        ]);
        let draft = grid_to_draft(&sheet, "Sheet1").expect("draft");
        assert_eq!(draft.po_number.as_deref(), Some("PO-2026/09/118"));
        assert_eq!(draft.supplier_name.as_deref(), Some("CV Sumber Tekstil"));
        assert_eq!(draft.order_date.as_deref(), Some("2026-09-18"));
        assert_eq!(draft.expected_arrival.as_deref(), Some("2026-09-30"));
        assert_eq!(draft.lines.len(), 2);
        assert_eq!(draft.lines[0].article_code.as_deref(), Some("KLS-11"));
        assert_eq!(
            draft.lines[0].article_name.as_deref(),
            Some("Kain Katon Prima")
        );
        assert_eq!(draft.lines[1].unit_price_minor, Some(185000));
        assert_eq!(draft.lines[1].unit.as_deref(), Some("pcs"));
    }

    #[test]
    fn a_code_only_sheet_still_imports() {
        let sheet = grid(&[
            &["kode", "qty", "harga satuan"],
            &["KLS-11", "120", "48500"],
            &["KLS-12", "24", "185000"],
        ]);
        let draft = grid_to_draft(&sheet, "Sheet1").expect("draft");
        assert_eq!(draft.lines.len(), 2);
        assert_eq!(draft.lines[0].article_code.as_deref(), Some("KLS-11"));
        assert_eq!(draft.lines[0].article_name, None);
        assert_eq!(draft.lines[1].unit_price_minor, Some(185000));
    }

    #[test]
    fn english_headers_find_their_columns() {
        let sheet = grid(&[
            &["SKU", "Item", "Qty", "Price"],
            &["ABC-1", "Kemeja", "10", "90000"],
        ]);
        let draft = grid_to_draft(&sheet, "Sheet1").expect("draft");
        assert_eq!(draft.lines[0].article_code.as_deref(), Some("ABC-1"));
        assert_eq!(draft.lines[0].article_name.as_deref(), Some("Kemeja"));
        assert_eq!(draft.lines[0].quantity, Some(10));
        assert_eq!(draft.lines[0].unit_price_minor, Some(90000));
    }

    #[test]
    fn a_sheet_without_item_rows_is_not_a_draft() {
        let sheet = grid(&[&["Nama", "Catatan"], &["saja", "ini"]]);
        assert!(grid_to_draft(&sheet, "Sheet1").is_none());
    }
}
