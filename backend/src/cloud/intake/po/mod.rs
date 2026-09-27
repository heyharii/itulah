//! PO intake: upload documents, receive drafts.
//!
//! ```text
//! files (Excel / CSV / PDF / foto)
//!   -> read it        excel / text layer / OCR (OpenParser, litparse lokal)
//!   -> draft it       heuristics; every `None` becomes a wizard question
//!   -> group it       same supplier + same printed PO number = one order
//!   -> ask            the questions that remain before the button
//! ```
//!
//! This module NEVER creates a purchase order. It replaces the Node ingest
//! service (`frontend-hub/services/po-import`, deleted at the cutover) and
//! keeps its contract byte-compatible, because the hub screen edits drafts in
//! browser memory and the only route to the real order book is the cloud's
//! direct-order route, pressed by a buyer in the review summary.
//!
//! The decision layer (Jev: which pages need OCR, which extracted field is
//! usable) arrives in stage B2 through the same shapes — `confidence` and the
//! `USABLE` threshold are already on the draft. Until then the pipeline runs
//! the degraded rules, which ask more questions, which is the honest price of
//! no key.

pub mod draft;
pub mod excel;
pub mod group;
pub mod loose;
pub mod ocr;
pub mod pdf;
pub mod text;

use std::collections::BTreeSet;

/// The extraction doors this node was given, read once at boot. Mirrors the
/// `MediaConfig::from_env()` pattern: a node without doors still serves —
/// Excel and text-layer PDFs import, scans fail honestly.
#[derive(Debug, Clone)]
pub struct PoImportConfig {
    pub openparser_api_key: Option<String>,
    pub openparser_base_url: String,
    pub openparser_ocr_model: String,
    pub openparser_llm_model: String,
    pub liteparse_bin: Option<String>,
    pub liteparse_ocr_language: String,
}

impl PoImportConfig {
    pub fn from_env() -> Self {
        fn env_opt(name: &str) -> Option<String> {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        }
        Self {
            openparser_api_key: env_opt("OPENPARSER_API_KEY"),
            openparser_base_url: env_opt("OPENPARSER_BASE_URL")
                .unwrap_or_else(|| "https://api.openparser.dev".into()),
            openparser_ocr_model: env_opt("OPENPARSER_OCR_MODEL")
                .unwrap_or_else(|| "paddleocr-vl-1.6".into()),
            openparser_llm_model: env_opt("OPENPARSER_LLM_MODEL")
                .unwrap_or_else(|| "openai/gpt-5.6-terra".into()),
            liteparse_bin: env_opt("LITEPARSE_BIN"),
            liteparse_ocr_language: env_opt("LITEPARSE_OCR_LANGUAGE")
                .unwrap_or_else(|| "ind+eng".into()),
        }
    }
}

impl Default for PoImportConfig {
    fn default() -> Self {
        Self {
            openparser_api_key: None,
            openparser_base_url: "https://api.openparser.dev".to_string(),
            openparser_ocr_model: "paddleocr-vl-1.6".to_string(),
            openparser_llm_model: "openai/gpt-5.6-terra".to_string(),
            liteparse_bin: None,
            liteparse_ocr_language: "ind+eng".to_string(),
        }
    }
}

pub use draft::{PoImportDraft, PoImportFileReport, PoImportFileStatus};

/// What `POST /purchase-orders/import` answers: every file's report, then the
/// grouped drafts with their open questions.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoImportIngestResponse {
    pub reports: Vec<PoImportFileReport>,
    pub drafts: Vec<PoImportDraft>,
}

/// One uploaded file, as the route hands it over.
pub struct IngestFile {
    pub file_name: String,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// Which extraction doors this node can open. The screen shows an honest
/// banner about what each upload will and will not get.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export, export_to = "contract/"))]
pub struct PoImportHealth {
    /// The decision engine. Wired in stage B2; until then always `false`,
    /// and the pipeline runs the deterministic rules.
    pub gateway: bool,
    pub openparser: bool,
    pub liteparse: bool,
}

pub fn health(config: &PoImportConfig) -> PoImportHealth {
    let set = |key: &Option<String>| key.as_deref().is_some_and(|k| !k.is_empty());
    PoImportHealth {
        gateway: false,
        openparser: set(&config.openparser_api_key),
        liteparse: set(&config.liteparse_bin),
    }
}

/// Every picked file in one request: per-file reports, then the grouped
/// drafts. The service never creates a purchase order.
pub async fn ingest(
    config: &PoImportConfig,
    files: Vec<IngestFile>,
) -> (Vec<PoImportFileReport>, Vec<PoImportDraft>) {
    let mut reports = Vec::new();
    let mut drafts = Vec::new();
    for file in &files {
        let (report, mut file_drafts) = process_file(config, file).await;
        reports.push(report);
        drafts.append(&mut file_drafts);
    }
    let mut grouped = group::group_drafts(drafts);
    // Questions after grouping, so line indexes and the ask list cover the
    // complete merged document rather than only its first file.
    for draft in &mut grouped {
        draft.questions = draft::questions_for_draft(draft, &BTreeSet::new());
    }
    (reports, grouped)
}

/// One uploaded document → its report, and zero or more raw drafts.
async fn process_file(
    config: &PoImportConfig,
    file: &IngestFile,
) -> (PoImportFileReport, Vec<PoImportDraft>) {
    let mut report = PoImportFileReport {
        file_name: file.file_name.clone(),
        status: PoImportFileStatus::Parsed,
        parser: "heuristic".to_string(),
        pages_total: None,
        pages_ocr: None,
        note: None,
        error: None,
    };
    let lower = file.file_name.to_lowercase();

    // -- Excel: read, never OCR. --
    if lower.ends_with(".xlsx") || lower.ends_with(".xls") || lower.ends_with(".csv") {
        let read = if lower.ends_with(".csv") {
            excel::csv_file_to_drafts(&file.file_name, &file.bytes)
        } else {
            excel::excel_file_to_drafts(&file.file_name, &file.bytes)
        };
        return match read {
            Ok(drafts) if !drafts.is_empty() => {
                report.parser = "excel".to_string();
                report.note = Some(format!(
                    "{} sheet dibaca langsung (tanpa OCR).",
                    drafts.len()
                ));
                (report, drafts)
            }
            Ok(_) => {
                report.status = PoImportFileStatus::Failed;
                report.error =
                    Some("Tidak ada baris item yang dikenali di workbook ini.".to_string());
                (report, Vec::new())
            }
            Err(error) => {
                report.status = PoImportFileStatus::Failed;
                report.error = Some(error);
                (report, Vec::new())
            }
        };
    }

    // -- PDF: text layer first; a scanned packet goes to OCR. --
    if lower.ends_with(".pdf") {
        let pages = match pdf::pdf_pages(&file.bytes) {
            Ok(pages) => pages,
            Err(error) => {
                report.status = PoImportFileStatus::Failed;
                report.error = Some(error);
                return (report, Vec::new());
            }
        };
        report.pages_total = Some(pages.len() as u32);
        let text = pages.join("\n");
        if pdf::text_looks_real(&text) {
            report.parser = "pdf-text".to_string();
            report.note = Some(format!(
                "{} halaman punya text layer utuh — dibaca lokal, tanpa OCR.",
                pages.len()
            ));
            return draft_or_fail(
                report,
                text::heuristic_extract(&text),
                &file.file_name,
                "pdf-text",
                None,
            );
        }
        report.pages_ocr = Some(pages.len() as u32);
        let ocr_note = format!("{} dari {} halaman perlu OCR.", pages.len(), pages.len());
        if health(config).openparser {
            return match ocr::openparser_extract(
                config,
                &file.bytes,
                &file.file_name,
                "application/pdf",
            )
            .await
            {
                Ok(extracted) => {
                    report.parser = "pdf-ocr".to_string();
                    report.note = Some(format!(
                        "{ocr_note} Diekstrak OpenParser ({}).",
                        config.openparser_ocr_model
                    ));
                    draft_or_fail(report, extracted, &file.file_name, "pdf-ocr", None)
                }
                Err(error) => {
                    report.status = PoImportFileStatus::Failed;
                    report.error = Some(error);
                    (report, Vec::new())
                }
            };
        }
        if let Some(text) = ocr::liteparse_text(
            config,
            &file.bytes,
            &file.file_name,
            "application/pdf",
            true,
        )
        .await
        {
            report.parser = "pdf-ocr".to_string();
            report.note = Some(format!("{ocr_note} OCR lokal LiteParse/Tesseract."));
            return draft_or_fail(
                report,
                text::heuristic_extract(&text),
                &file.file_name,
                "pdf-ocr",
                None,
            );
        }
        report.status = PoImportFileStatus::Failed;
        report.error = Some(
            "Dokumen butuh OCR tapi tidak ada cara: set OPENPARSER_API_KEY atau LITEPARSE_BIN."
                .to_string(),
        );
        return (report, Vec::new());
    }

    // -- Photographs: OCR or nothing. --
    if lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
        || lower.ends_with(".heic")
    {
        if health(config).openparser {
            let mime = if file.content_type.is_empty() {
                "image/jpeg"
            } else {
                &file.content_type
            };
            return match ocr::openparser_extract(config, &file.bytes, &file.file_name, mime).await {
                Ok(extracted) => {
                    report.parser = "image-ocr".to_string();
                    report.note = Some(format!(
                        "Foto — OCR OpenParser ({}), tanpa pertanyaan per halaman.",
                        config.openparser_ocr_model
                    ));
                    draft_or_fail(report, extracted, &file.file_name, "image-ocr", None)
                }
                Err(error) => {
                    report.status = PoImportFileStatus::Failed;
                    report.error = Some(error);
                    (report, Vec::new())
                }
            };
        }
        if let Some(text) = ocr::liteparse_text(
            config,
            &file.bytes,
            &file.file_name,
            &file.content_type,
            true,
        )
        .await
        {
            report.parser = "image-ocr".to_string();
            report.note = Some("Foto — OCR lokal LiteParse/Tesseract.".to_string());
            return draft_or_fail(
                report,
                text::heuristic_extract(&text),
                &file.file_name,
                "image-ocr",
                None,
            );
        }
        report.status = PoImportFileStatus::Failed;
        report.error = Some(
            "Foto perlu OCR: set OPENPARSER_API_KEY atau LITEPARSE_BIN terlebih dahulu."
                .to_string(),
        );
        return (report, Vec::new());
    }

    report.status = PoImportFileStatus::Skipped;
    report.error =
        Some("Tipe file tidak dikenal — kirim xlsx/xls/csv, pdf, atau foto.".to_string());
    (report, Vec::new())
}

/// A draft with no lines is not a draft; it is the file's failure, stated in
/// its report.
fn draft_or_fail(
    mut report: PoImportFileReport,
    extracted: draft::Extracted,
    file_name: &str,
    parser: &str,
    note: Option<String>,
) -> (PoImportFileReport, Vec<PoImportDraft>) {
    let draft = draft::draft_from(file_name, extracted, parser, note);
    if draft.lines.is_empty() {
        report.status = PoImportFileStatus::Failed;
        report.error = Some("Tidak ada baris item yang dikenali di dokumen ini.".to_string());
        return (report, Vec::new());
    }
    (report, vec![draft])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> PoImportConfig {
        // No OCR doors configured — the honest degraded run this node ships.
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

    #[tokio::test]
    async fn a_csv_becomes_one_grouped_trusted_draft() {
        let (reports, drafts) = ingest(
            &config(),
            vec![IngestFile {
                file_name: "po.csv".to_string(),
                content_type: "text/csv".to_string(),
                bytes: SHEET.as_bytes().to_vec(),
            }],
        )
        .await;
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].status, PoImportFileStatus::Parsed);
        assert_eq!(reports[0].parser, "excel");
        assert_eq!(drafts.len(), 1);
        let draft = &drafts[0];
        assert_eq!(draft.po_number.as_deref(), Some("PO-2026/09/118"));
        assert_eq!(draft.lines.len(), 2);
        assert_eq!(
            draft.lines[0].article_name.as_deref(),
            Some("Kain Katon Prima")
        );
        // Trusted cells ask nothing; supplier and destination are always
        // asked until they are book records.
        let ids: Vec<&str> = draft.questions.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, vec!["supplier_name", "destination_site_id"]);
    }

    #[tokio::test]
    async fn a_scanned_pdf_without_ocr_doors_fails_honestly() {
        let (reports, drafts) = ingest(
            &config(),
            vec![IngestFile {
                file_name: "scan.pdf".to_string(),
                content_type: "application/pdf".to_string(),
                bytes: b"not really a pdf".to_vec(),
            }],
        )
        .await;
        assert_eq!(drafts.len(), 0);
        assert_eq!(reports[0].status, PoImportFileStatus::Failed);
        let error = reports[0].error.as_deref().unwrap_or_default();
        assert!(
            error.contains("OCR"),
            "the failure should name the missing doors: {error}"
        );
    }

    #[tokio::test]
    async fn an_unknown_type_is_skipped_not_failed() {
        let (reports, drafts) = ingest(
            &config(),
            vec![IngestFile {
                file_name: "surat.docx".to_string(),
                content_type: "application/msword".to_string(),
                bytes: b"oleh".to_vec(),
            }],
        )
        .await;
        assert_eq!(drafts.len(), 0);
        assert_eq!(reports[0].status, PoImportFileStatus::Skipped);
    }
}
