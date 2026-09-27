//! PDF text layers, read locally with no model's opinion.
//!
//! [`pdf_extract`] hands back one string per page — which the splitter stage
//! (B3) will need page by page, and the import path joins into one text. A
//! PDF whose pages carry no real text layer is a scanned document: the
//! caller routes it to OCR rather than asking the heuristics to mine
//! whitespace.

/// Below this many characters of text, a page is a scan, not a document. The
/// same floor the ingest service used when a model's opinion was unavailable.
pub const MIN_TEXT_CHARS: usize = 200;

pub fn pdf_pages(bytes: &[u8]) -> Result<Vec<String>, String> {
    pdf_extract::extract_text_from_mem_by_pages(bytes).map_err(|error| error.to_string())
}

/// The whole document's text, for the paths that read page by page only when
/// they must.
pub fn pdf_text(bytes: &[u8]) -> Result<String, String> {
    Ok(pdf_pages(bytes)?.join("\n"))
}

/// Does this text look like a document at all? A scanned page extracts to
/// stray ligature crumbs; a real text layer carries the supplier's letterhead.
pub fn text_looks_real(text: &str) -> bool {
    text.trim().chars().count() >= MIN_TEXT_CHARS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crumbs_are_not_a_document() {
        assert!(!text_looks_real(""));
        assert!(!text_looks_real("   \n "));
        assert!(!text_looks_real(&"a".repeat(199)));
        assert!(text_looks_real(&"CV Sumber Tekstil\n".repeat(20)));
    }
}
