//! Grouping — several files are one PO when they name the same supplier and
//! the same PO number. A photograph of page two joins the PDF of page one.
//! The merge is deterministic on purpose: which lines belong together is a
//! bookkeeping fact, not a judgement call.
//!
//! Missing identity is not evidence that two documents are the same PO.
//! Drafts without a supplier or a number stay separate until the wizard has
//! enough to identify them; otherwise unrelated uploads would collapse into
//! one order.

use super::draft::PoImportDraft;
use super::loose::normalise_name;
use std::collections::{BTreeMap, HashMap};

pub fn group_drafts(drafts: Vec<PoImportDraft>) -> Vec<PoImportDraft> {
    let mut groups: Vec<PoImportDraft> = Vec::new();
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for draft in drafts {
        let supplier_key = draft
            .supplier_name
            .as_deref()
            .map(normalise_name)
            .unwrap_or_default();
        let po_key = draft.po_number.as_deref().unwrap_or("").trim().to_string();
        let key = if supplier_key.is_empty() || po_key.is_empty() {
            draft.draft_id.clone()
        } else {
            format!("{supplier_key}|{po_key}")
        };
        match index_by_key.get(&key) {
            Some(&index) => merge_into(&mut groups[index], draft),
            None => {
                index_by_key.insert(key, groups.len());
                groups.push(draft);
            }
        }
    }
    groups
}

fn merge_into(existing: &mut PoImportDraft, draft: PoImportDraft) {
    for file in draft.source_files {
        if !existing.source_files.contains(&file) {
            existing.source_files.push(file);
        }
    }
    if existing.po_number.is_none() {
        existing.po_number = draft.po_number;
    }
    if existing.supplier_name.is_none() {
        existing.supplier_name = draft.supplier_name;
    }
    if existing.supplier_id.is_none() {
        existing.supplier_id = draft.supplier_id;
    }
    if existing.destination_site_id.is_none() {
        existing.destination_site_id = draft.destination_site_id;
    }
    if existing.order_date.is_none() {
        existing.order_date = draft.order_date;
    }
    if existing.expected_arrival.is_none() {
        existing.expected_arrival = draft.expected_arrival;
    }
    if existing.notes.is_none() {
        existing.notes = draft.notes;
    }
    if existing.currency.as_deref() == Some("IDR") && draft.currency.as_deref() != Some("IDR") {
        existing.currency = draft.currency;
    }
    existing.lines.extend(draft.lines);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::intake::po::draft::{new_line_id, PoImportDraftLine};

    fn draft(id: &str, supplier: Option<&str>, po: Option<&str>) -> PoImportDraft {
        PoImportDraft {
            draft_id: id.to_string(),
            source_files: vec![format!("{id}.pdf")],
            po_number: po.map(str::to_string),
            supplier_name: supplier.map(str::to_string),
            supplier_id: None,
            destination_site_id: None,
            currency: Some("IDR".to_string()),
            order_date: None,
            expected_arrival: None,
            notes: None,
            lines: vec![PoImportDraftLine {
                line_id: new_line_id(),
                article_code: None,
                article_name: Some(format!("barang {id}")),
                quantity: Some(1),
                unit: None,
                unit_code: None,
                unit_price_minor: Some(1000),
                promised_date: None,
            }],
            questions: Vec::new(),
            confidence: BTreeMap::default(),
            parser: "heuristic".to_string(),
            parser_note: None,
        }
    }

    #[test]
    fn same_supplier_and_number_merge_into_one_order() {
        let grouped = group_drafts(vec![
            draft("a", Some("CV Sumber Tekstil"), Some("PO-1")),
            draft("b", Some("CV. Sumber Tekstil"), Some("PO-1")),
        ]);
        assert_eq!(grouped.len(), 1);
        assert_eq!(grouped[0].lines.len(), 2);
        assert_eq!(
            grouped[0].source_files,
            vec!["a.pdf".to_string(), "b.pdf".to_string()]
        );
    }

    #[test]
    fn different_numbers_stay_apart_despite_the_same_supplier() {
        let grouped = group_drafts(vec![
            draft("a", Some("CV Sumber Tekstil"), Some("PO-1")),
            draft("b", Some("CV Sumber Tekstil"), Some("PO-2")),
        ]);
        assert_eq!(grouped.len(), 2);
    }

    #[test]
    fn an_unidentified_draft_never_joins_an_identified_one() {
        let grouped = group_drafts(vec![
            draft("a", Some("CV Sumber Tekstil"), Some("PO-1")),
            draft("b", Some("CV Sumber Tekstil"), None),
        ]);
        assert_eq!(grouped.len(), 2);
    }

    #[test]
    fn a_real_currency_beats_the_default_only_once() {
        let mut usd = draft("b", Some("CV Sumber Tekstil"), Some("PO-1"));
        usd.currency = Some("USD".to_string());
        let grouped = group_drafts(vec![
            draft("a", Some("CV Sumber Tekstil"), Some("PO-1")),
            usd,
        ]);
        assert_eq!(grouped[0].currency.as_deref(), Some("USD"));
    }
}
