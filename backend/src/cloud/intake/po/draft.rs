//! The wire shapes of a PO import, and the two rules that live beside them.
//!
//! One draft is the service's working offer: what it read, which fields it is
//! sure of, and what it must ask before the buyer can press the button. The
//! shapes here are byte-compatible with what the deleted Node service answered
//! (`frontend-hub/services/po-import`), because the hub screen edits drafts in
//! browser memory and nothing about that contract needed to change — only
//! where the bytes are judged.
//!
//! Two rules live here:
//!
//! * [`questions_for_draft`] — what the wizard must still ask. A missing field
//!   is always a question; an extracted field is one unless its source is
//!   trusted (a spreadsheet's cells are exact data; a regex's reading is a
//!   claim). A supplier is *always* asked until it is one of the book's real
//!   records — a typed name is not an id, and the order route refuses without
//!   one.
//! * [`apply_answers`] — the buyer's answers merge back in, and the questions
//!   recompute. A field the buyer answered is settled by the act of answering.
//!
//! Jev's confidence scores slot into the same shapes in the next stage (B2);
//! today the map stays empty, and the degraded run asks more questions, which
//! is the honest price of no key.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

/// The trust threshold an extracted value must clear before the wizard stops
/// asking about it. Application policy, kept in one place; tuned against
/// labelled documents in stage B2.
pub const USABLE: f64 = 0.7;

fn compile(literal: &str) -> regex::Regex {
    match regex::Regex::new(literal) {
        Ok(regex) => regex,
        Err(error) => panic!("static PO-import regex is invalid: {error}: {literal}"),
    }
}

static LINE_FIELD: LazyLock<regex::Regex> = LazyLock::new(|| compile(r"^line\.(\d+)\.(\w+)$"));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoImportFileReport {
    pub file_name: String,
    pub status: PoImportFileStatus,
    pub parser: String,
    pub pages_total: Option<u32>,
    pub pages_ocr: Option<u32>,
    pub note: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(rename_all = "lowercase")]
pub enum PoImportFileStatus {
    Parsed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoImportDraftLine {
    pub line_id: String,
    pub article_code: Option<String>,
    pub article_name: Option<String>,
    pub quantity: Option<i64>,
    pub unit: Option<String>,
    pub unit_price_minor: Option<i64>,
    pub promised_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoImportQuestion {
    pub id: String,
    pub kind: PoImportQuestionKind,
    pub label: String,
    /// Which book the buyer picks from: the supplier book or the destination
    /// sites. `None` is a typed answer.
    pub options: Option<String>,
    pub prefilled: Option<String>,
    pub confidence: Option<f64>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
#[serde(rename_all = "lowercase")]
pub enum PoImportQuestionKind {
    Text,
    Number,
    Date,
    Choice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoImportDraft {
    pub draft_id: String,
    pub source_files: Vec<String>,
    pub po_number: Option<String>,
    pub supplier_name: Option<String>,
    pub supplier_id: Option<String>,
    pub destination_site_id: Option<String>,
    pub currency: Option<String>,
    pub order_date: Option<String>,
    pub expected_arrival: Option<String>,
    pub notes: Option<String>,
    pub lines: Vec<PoImportDraftLine>,
    pub questions: Vec<PoImportQuestion>,
    pub confidence: BTreeMap<String, f64>,
    pub parser: String,
    pub parser_note: Option<String>,
}

pub fn new_draft_id() -> String {
    format!("d-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

pub fn new_line_id() -> String {
    format!("l-{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

/// One source's reading, as the draft builder receives it. `unit_price` is
/// whole currency units, exactly the shape the OpenParser schema and the
/// heuristics both answer with.
pub struct Extracted {
    pub po_number: Option<String>,
    pub order_date: Option<String>,
    pub expected_arrival: Option<String>,
    pub currency: String,
    pub supplier_name: Option<String>,
    pub notes: Option<String>,
    pub lines: Vec<super::text::ExtractedLine>,
}

pub fn draft_from(
    file_name: &str,
    extracted: Extracted,
    parser: &str,
    parser_note: Option<String>,
) -> PoImportDraft {
    PoImportDraft {
        draft_id: new_draft_id(),
        source_files: vec![file_name.to_string()],
        po_number: extracted.po_number,
        supplier_name: extracted.supplier_name,
        supplier_id: None,
        destination_site_id: None,
        currency: Some(extracted.currency),
        order_date: extracted.order_date,
        expected_arrival: extracted.expected_arrival,
        notes: extracted.notes,
        lines: extracted
            .lines
            .into_iter()
            .map(|line| PoImportDraftLine {
                line_id: new_line_id(),
                article_code: line.article_code,
                article_name: line.article_name,
                quantity: line.quantity,
                unit: line.unit,
                unit_price_minor: line.unit_price,
                promised_date: line
                    .promised_date
                    .and_then(|d| super::loose::parse_date_loose(&d)),
            })
            .collect(),
        questions: Vec::new(),
        confidence: BTreeMap::new(),
        parser: parser.to_string(),
        parser_note,
    }
}

/// The wizard questions a draft still carries.
///
/// A missing field is always a question — there is nothing to be confident
/// about. An extracted field is a question only when its confidence sits below
/// [`USABLE`], or was never scored, in which case the deterministic rule asks
/// for anything the heuristics produced — because a regex's confidence is a
/// guess pretending to be a fact. A spreadsheet's cells are exact data, so a
/// value read from one is trusted without a model's opinion. A field the BUYER
/// answered in the wizard is settled by the act of answering — the value is
/// theirs now, not the document's.
pub fn questions_for_draft(
    draft: &PoImportDraft,
    answered: &BTreeSet<String>,
) -> Vec<PoImportQuestion> {
    let trusted = draft.parser == "excel";
    let mut questions = Vec::new();
    let mut ask = |draft: &PoImportDraft,
                   id: &str,
                   kind: PoImportQuestionKind,
                   label: &str,
                   options: Option<&str>,
                   value: Option<String>| {
        let scored = draft.confidence.get(id);
        let supplier_needs_book = id == "supplier_name" && draft.supplier_id.is_none();
        let unsure = value.is_none()
            || supplier_needs_book
            || (!answered.contains(id)
                && match scored {
                    Some(p) => *p < USABLE,
                    None => !trusted,
                });
        if !unsure {
            return;
        }
        let hint = match (value.as_ref(), scored) {
            (None, _) => "Tidak ditemukan di dokumen sumber.".to_string(),
            (Some(_), None) => "Hasil pembacaan dokumen — periksa sebelum dipakai.".to_string(),
            (Some(_), Some(p)) => format!(
                "Keyakinan pembacaan {}% — di bawah ambang {}%.",
                (p * 100.0).round(),
                (USABLE * 100.0).round()
            ),
        };
        questions.push(PoImportQuestion {
            id: id.to_string(),
            kind,
            label: label.to_string(),
            options: options.map(str::to_string),
            prefilled: value,
            confidence: scored.map(|p| (p * 100.0).round() / 100.0),
            hint: Some(hint),
        });
    };

    let supplier_value = draft.supplier_name.clone();
    ask(
        draft,
        "supplier_name",
        PoImportQuestionKind::Choice,
        "Supplier mana order ini untuk?",
        Some("supplier"),
        supplier_value,
    );
    let destination_value = draft.destination_site_id.clone();
    ask(
        draft,
        "destination_site_id",
        PoImportQuestionKind::Choice,
        "Barangnya dikirim ke mana?",
        Some("destination"),
        destination_value,
    );
    let (po_label, po_value) = match draft.po_number.clone() {
        Some(number) => ("Nomor PO".to_string(), Some(number)),
        None => (
            "Nomor PO (kosongkan untuk nomor otomatis)".to_string(),
            None,
        ),
    };
    ask(
        draft,
        "po_number",
        PoImportQuestionKind::Text,
        &po_label,
        None,
        po_value,
    );
    let arrival_value = draft.expected_arrival.clone();
    ask(
        draft,
        "expected_arrival",
        PoImportQuestionKind::Date,
        "Kapan supplier menjanjikan datang?",
        None,
        arrival_value,
    );
    for (index, line) in draft.lines.iter().enumerate() {
        let name_value = line.article_name.clone();
        ask(
            draft,
            &format!("line.{index}.article_name"),
            PoImportQuestionKind::Text,
            &format!("Baris {}: nama barang", index + 1),
            None,
            name_value,
        );
        let quantity_value = line.quantity.map(|q| q.to_string());
        ask(
            draft,
            &format!("line.{index}.quantity"),
            PoImportQuestionKind::Number,
            &format!("Baris {}: jumlah", index + 1),
            None,
            quantity_value,
        );
        let price_value = line.unit_price_minor.map(|p| p.to_string());
        ask(
            draft,
            &format!("line.{index}.unit_price"),
            PoImportQuestionKind::Number,
            &format!("Baris {}: harga satuan (rupiah)", index + 1),
            None,
            price_value,
        );
    }
    questions
}

/// One wizard answer, as the hub sends it: a typed value, and — when the
/// buyer picked a record from a book — the record's display name.
#[derive(Debug, Clone, Deserialize)]
pub struct PoImportAnswer {
    pub value: Option<String>,
    pub label: Option<String>,
}

/// Merge the wizard's answers into one draft, then recompute the questions.
///
/// Deterministic first: a typed number is a number, a picked option is the
/// record it names. A supplier answer's LABEL is only sent when the buyer
/// picked a real supplier-book option; free text is useful as a hint, but it
/// is not a supplier id and must not make the draft look creatable.
pub fn apply_answers(
    mut draft: PoImportDraft,
    answers: &BTreeMap<String, PoImportAnswer>,
) -> PoImportDraft {
    let mut answered = BTreeSet::new();
    for (id, answer) in answers {
        let Some(value) = answer
            .value
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        answered.insert(id.clone());
        match id.as_str() {
            "po_number" => draft.po_number = Some(value.to_string()),
            "supplier_name" => {
                let label = answer
                    .label
                    .as_deref()
                    .map(str::trim)
                    .filter(|l| !l.is_empty());
                draft.supplier_name = Some(
                    label
                        .map(str::to_string)
                        .unwrap_or_else(|| value.to_string()),
                );
                // The label's presence is what makes the value an id.
                draft.supplier_id = label.map(|_| value.to_string());
            }
            "destination_site_id" => draft.destination_site_id = Some(value.to_string()),
            "expected_arrival" => {
                if let Some(day) = super::loose::parse_date_loose(value) {
                    draft.expected_arrival = Some(day);
                }
            }
            _ => {
                if let Some(m) = LINE_FIELD.captures(id) {
                    let index: usize = match m[1].parse() {
                        Ok(index) => index,
                        Err(_) => continue,
                    };
                    let Some(line) = draft.lines.get_mut(index) else {
                        continue;
                    };
                    match &m[2] {
                        "quantity" => {
                            if let Some(qty) = super::loose::parse_quantity_loose(value) {
                                if qty > 0 {
                                    line.quantity = Some(qty);
                                }
                            }
                        }
                        "unit_price" => {
                            if let Some(price) = super::loose::parse_amount_loose(value) {
                                if price > 0 {
                                    line.unit_price_minor = Some(price);
                                }
                            }
                        }
                        "article_name" => {
                            line.article_name = super::loose::string_or_null(value);
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    draft.questions = questions_for_draft(&draft, &answered);
    draft
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::intake::po::text::ExtractedLine;

    fn draft(parser: &str) -> PoImportDraft {
        PoImportDraft {
            draft_id: new_draft_id(),
            source_files: vec!["uji.csv".to_string()],
            po_number: None,
            supplier_name: Some("CV Sumber Tekstil".to_string()),
            supplier_id: None,
            destination_site_id: None,
            currency: Some("IDR".to_string()),
            order_date: Some("2026-09-18".to_string()),
            expected_arrival: None,
            notes: None,
            lines: vec![PoImportDraftLine {
                line_id: new_line_id(),
                article_code: Some("KLS-11".to_string()),
                article_name: Some("Kain Katon Prima".to_string()),
                quantity: Some(120),
                unit: Some("potong".to_string()),
                unit_price_minor: Some(48500),
                promised_date: None,
            }],
            questions: Vec::new(),
            confidence: BTreeMap::new(),
            parser: parser.to_string(),
            parser_note: None,
        }
    }

    #[test]
    fn an_excel_draft_only_asks_what_it_lacks() {
        let questions = questions_for_draft(&draft("excel"), &BTreeSet::new());
        let ids: Vec<&str> = questions.iter().map(|q| q.id.as_str()).collect();
        // Supplier and destination are always asked until they are real
        // records; po_number and arrival are missing; the line was read from
        // exact cells and is trusted.
        assert_eq!(
            ids,
            vec![
                "supplier_name",
                "destination_site_id",
                "po_number",
                "expected_arrival"
            ]
        );
    }

    #[test]
    fn a_heuristic_draft_asks_about_every_claim() {
        let questions = questions_for_draft(&draft("heuristic"), &BTreeSet::new());
        let ids: Vec<&str> = questions.iter().map(|q| q.id.as_str()).collect();
        assert!(ids.contains(&"line.0.article_name"));
        assert!(ids.contains(&"line.0.quantity"));
        assert!(ids.contains(&"line.0.unit_price"));
    }

    #[test]
    fn picking_a_book_record_settles_the_supplier() {
        let mut answers = BTreeMap::new();
        answers.insert(
            "supplier_name".to_string(),
            PoImportAnswer {
                value: Some("3f1c...".to_string()),
                label: Some("CV Sumber Tekstil".to_string()),
            },
        );
        let draft = apply_answers(draft("excel"), &answers);
        assert!(draft.supplier_id.is_some());
        let ids: Vec<&str> = draft.questions.iter().map(|q| q.id.as_str()).collect();
        assert!(!ids.contains(&"supplier_name"));
    }

    #[test]
    fn free_text_supplier_is_a_hint_never_an_id() {
        let mut answers = BTreeMap::new();
        answers.insert(
            "supplier_name".to_string(),
            PoImportAnswer {
                value: Some("Toko Kain Jaya".to_string()),
                label: None,
            },
        );
        let draft = apply_answers(draft("excel"), &answers);
        assert_eq!(draft.supplier_name.as_deref(), Some("Toko Kain Jaya"));
        assert!(draft.supplier_id.is_none());
        // Still asked, because the order route refuses without an id.
        assert!(draft.questions.iter().any(|q| q.id == "supplier_name"));
    }

    #[test]
    fn an_answered_line_field_settles_even_for_heuristics() {
        let mut answers = BTreeMap::new();
        answers.insert(
            "line.0.quantity".to_string(),
            PoImportAnswer {
                value: Some("118".to_string()),
                label: None,
            },
        );
        let draft = apply_answers(draft("heuristic"), &answers);
        assert_eq!(draft.lines[0].quantity, Some(118));
        assert!(!draft.questions.iter().any(|q| q.id == "line.0.quantity"));
    }

    #[test]
    fn the_wire_shape_round_trips_through_serde() {
        let json = serde_json::to_string(&draft("excel")).expect("serialise");
        let back: PoImportDraft = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(back.lines[0].unit_price_minor, Some(48500));
        assert_eq!(back.confidence.len(), 0);
    }

    #[test]
    fn extracted_lines_arrive_as_draft_lines() {
        let extracted = super::Extracted {
            po_number: Some("PO-1".to_string()),
            order_date: None,
            expected_arrival: None,
            currency: "IDR".to_string(),
            supplier_name: None,
            notes: None,
            lines: vec![ExtractedLine {
                article_code: Some("KLS-11".to_string()),
                article_name: Some("Kain Katon Prima".to_string()),
                quantity: Some(120),
                unit: None,
                unit_price: Some(48500),
                promised_date: None,
            }],
        };
        let draft = draft_from("uji.csv", extracted, "heuristic", None);
        assert!(draft.draft_id.starts_with("d-"));
        assert_eq!(draft.lines[0].line_id.len(), 10);
        assert_eq!(draft.lines[0].unit_price_minor, Some(48500));
    }
}
