//! The PO intake kernel, exercised through its public surface.
//!
//! Everything a buyer's upload meets before the review summary: reading a
//! sheet into lines, grouping files that name one order, the questions the
//! wizard must ask, and the answers that settle them. None of it touches the
//! database — a draft is browser memory until the summary's button calls the
//! order route — so this file needs no `sqlx::test`.

use inventory_backend::cloud::intake::po::{
    self,
    draft::{apply_answers, PoImportAnswer},
    IngestFile, PoImportConfig, PoImportFileStatus,
};
use std::collections::BTreeMap;

fn doors_shut() -> PoImportConfig {
    // No OCR doors configured — the honest degraded run every node ships.
    PoImportConfig::default()
}

const SHEET: &str = "\
Supplier,CV Sumber Tekstil,,
Nomor PO,PO-2026/09/118,,
Tanggal,18/09/2026,,
Tanggal datang,30/09/2026,,
kode barang,nama barang,qty,satuan,harga satuan
KLS-11,Kain Katon Prima,120,potong,48500
KLS-12,Kemeja Flanel L,24,pcs,185000
";

fn csv(name: &str, text: &str) -> IngestFile {
    IngestFile {
        file_name: name.to_string(),
        content_type: "text/csv".to_string(),
        bytes: text.as_bytes().to_vec(),
    }
}

#[tokio::test]
async fn a_sheet_becomes_one_trusted_draft_with_line_facts() {
    let (reports, drafts) = po::ingest(&doors_shut(), vec![csv("po.csv", SHEET)]).await;
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].status, PoImportFileStatus::Parsed);
    assert_eq!(reports[0].parser, "excel");
    assert_eq!(drafts.len(), 1);

    let draft = &drafts[0];
    assert_eq!(draft.po_number.as_deref(), Some("PO-2026/09/118"));
    assert_eq!(draft.supplier_name.as_deref(), Some("CV Sumber Tekstil"));
    assert_eq!(draft.order_date.as_deref(), Some("2026-09-18"));
    assert_eq!(draft.expected_arrival.as_deref(), Some("2026-09-30"));
    assert_eq!(draft.lines.len(), 2);
    // The regression that shipped supplier codes into item names: a `kode
    // barang` column is the CODE's column even though `barang` also lives in
    // the name vocabulary.
    assert_eq!(draft.lines[0].article_code.as_deref(), Some("KLS-11"));
    assert_eq!(
        draft.lines[0].article_name.as_deref(),
        Some("Kain Katon Prima")
    );
    assert_eq!(draft.lines[0].quantity, Some(120));
    assert_eq!(draft.lines[0].unit_price_minor, Some(48500));
    assert_eq!(
        draft.lines[1].article_name.as_deref(),
        Some("Kemeja Flanel L")
    );
}

#[tokio::test]
async fn trusted_cells_ask_nothing_but_the_book_picks() {
    let (reports, drafts) = po::ingest(&doors_shut(), vec![csv("po.csv", SHEET)]).await;
    assert_eq!(reports[0].status, PoImportFileStatus::Parsed);
    let draft = &drafts[0];
    // Spreadsheet cells are exact data: everything the sheet answered needs
    // no question. The supplier and the destination are asked until they are
    // records of the book — a typed name is not an id, and the order route
    // refuses without one.
    let ids: Vec<&str> = draft.questions.iter().map(|q| q.id.as_str()).collect();
    assert_eq!(ids, vec!["supplier_name", "destination_site_id"]);
    assert_eq!(
        drafts[0]
            .questions
            .iter()
            .find(|q| q.id == "supplier_name")
            .map(|q| q.options.as_deref()),
        Some(Some("supplier"))
    );
}

#[tokio::test]
async fn two_files_naming_one_order_become_one_draft() {
    let mut second = SHEET.to_string();
    second.push_str("KLS-20,Kain Katon Jarang,6,potong,62000\n");
    let (reports, drafts) = po::ingest(
        &doors_shut(),
        vec![csv("po-a.csv", &second), csv("po-b.csv", SHEET)],
    )
    .await;
    assert_eq!(reports.len(), 2);
    assert!(reports
        .iter()
        .all(|r| r.status == PoImportFileStatus::Parsed));
    // Same supplier + same printed number = one order, whatever carried it.
    // Both files are complete sheets, so the lines stack: 3 + 2.
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].lines.len(), 5);
    assert_eq!(drafts[0].source_files.len(), 2);
}

#[tokio::test]
async fn a_code_only_sheet_still_imports_without_names() {
    let text = "\
kode,qty,harga satuan
KLS-11,120,48500
";
    let (_, drafts) = po::ingest(&doors_shut(), vec![csv("po.csv", text)]).await;
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].lines[0].article_code.as_deref(), Some("KLS-11"));
    assert_eq!(drafts[0].lines[0].article_name, None);
    assert_eq!(drafts[0].lines[0].unit_price_minor, Some(48500));
}

#[tokio::test]
async fn an_unscannable_pdf_fails_by_naming_the_missing_doors() {
    let (reports, drafts) = po::ingest(
        &doors_shut(),
        vec![IngestFile {
            file_name: "scan.pdf".to_string(),
            content_type: "application/pdf".to_string(),
            bytes: b"definitely not a pdf".to_vec(),
        }],
    )
    .await;
    assert_eq!(drafts.len(), 0);
    assert_eq!(reports[0].status, PoImportFileStatus::Failed);
    // Whatever the reader choked on is what the report says — the file's own
    // failure, never a half-guessed draft.
    assert!(reports[0].error.is_some());
}

#[tokio::test]
async fn a_photo_without_ocr_doors_is_refused_not_mined() {
    let (reports, drafts) = po::ingest(
        &doors_shut(),
        vec![IngestFile {
            file_name: "struk.jpg".to_string(),
            content_type: "image/jpeg".to_string(),
            bytes: vec![0xff, 0xd8, 0xff, 0xe0],
        }],
    )
    .await;
    assert_eq!(drafts.len(), 0);
    assert_eq!(reports[0].status, PoImportFileStatus::Failed);
    assert!(reports[0]
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("OPENPARSER_API_KEY"));
}

#[tokio::test]
async fn an_unknown_type_is_skipped_with_its_reason() {
    let (reports, drafts) = po::ingest(
        &doors_shut(),
        vec![IngestFile {
            file_name: "surat.docx".to_string(),
            content_type: "application/msword".to_string(),
            bytes: b"oleh".to_vec(),
        }],
    )
    .await;
    assert_eq!(drafts.len(), 0);
    assert_eq!(reports[0].status, PoImportFileStatus::Skipped);
    assert!(reports[0]
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("Tipe file tidak dikenal"));
}

#[tokio::test]
async fn answers_settle_fields_and_recompute_questions() {
    let (_, drafts) = po::ingest(&doors_shut(), vec![csv("po.csv", SHEET)]).await;
    let draft = drafts.into_iter().next().expect("draft");

    let mut answers: BTreeMap<String, PoImportAnswer> = BTreeMap::new();
    // Picking a book record: the VALUE is the id, the LABEL the name.
    answers.insert(
        "supplier_name".to_string(),
        PoImportAnswer {
            value: Some("7c1e6a5e-0000-4000-8000-000000000001".to_string()),
            label: Some("CV Sumber Tekstil".to_string()),
        },
    );
    answers.insert(
        "destination_site_id".to_string(),
        PoImportAnswer {
            value: Some("dc".to_string()),
            label: None,
        },
    );
    let draft = apply_answers(draft, &answers);

    assert_eq!(
        draft.supplier_id.as_deref(),
        Some("7c1e6a5e-0000-4000-8000-000000000001")
    );
    assert_eq!(draft.destination_site_id.as_deref(), Some("dc"));
    // The sheet settled the rest: nothing left to ask.
    assert!(draft.questions.is_empty(), "got {:?}", draft.questions);

    // An EMPTY answer is not an answer: the question stays open.
    let (_, drafts) = po::ingest(&doors_shut(), vec![csv("po.csv", SHEET)]).await;
    let mut non_answer: BTreeMap<String, PoImportAnswer> = BTreeMap::new();
    non_answer.insert(
        "supplier_name".to_string(),
        PoImportAnswer {
            value: Some("   ".to_string()),
            label: Some("CV Sumber Tekstil".to_string()),
        },
    );
    let draft = apply_answers(drafts.into_iter().next().expect("draft"), &non_answer);
    assert!(draft.supplier_id.is_none());
    assert!(draft.questions.iter().any(|q| q.id == "supplier_name"));
}

#[test]
fn health_reports_the_doors_it_was_given() {
    let health = po::health(&PoImportConfig::default());
    assert!(!health.gateway, "the decision engine arrives in stage B2");
    assert!(!health.openparser);
    assert!(!health.liteparse);
}
