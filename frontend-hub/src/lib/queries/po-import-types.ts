/// The wire types of the PO import kernel, generated from the Rust that
/// parses the documents (`backend/src/cloud/intake/po`) — one truth, not a
/// hand-copy that drifts. What stays hand-written here is the screen's
/// working copy: the wire draft is readonly at rest, and the wizard and the
/// summary edit a shallow structural copy, so a frozen wire type and an
/// editable form can agree.
import type {
  PoImportDraft as WireDraft,
  PoImportQuestion,
} from "@itulah/contract"

export type {
  PoImportDraft,
  PoImportDraftLine,
  PoImportFileReport,
  PoImportHealth,
  PoImportIngestResponse,
  PoImportQuestion,
} from "@itulah/contract"

/// The screen's working copy is MUTABLE — the wizard and the summary edit it.
export interface EditableDraft {
  draft_id: string
  source_files: string[]
  po_number: string | null
  supplier_name: string | null
  supplier_id: string | null
  destination_site_id: string | null
  currency: string
  order_date: string | null
  expected_arrival: string | null
  notes: string | null
  lines: Array<{
    line_id: string
    article_code: string | null
    article_name: string | null
    quantity: number | null
    unit: string | null
    /// The printed `unit` matched to the units master, or the buyer's own
    /// pick when the paper named nothing or something the master does not
    /// know. Starts as the wire draft's own reading; the review summary lets
    /// a buyer override it before the order is raised — see `import.tsx`.
    unit_code: string | null
    unit_price_minor: number | null
    promised_date: string | null
  }>
  questions: PoImportQuestion[]
  confidence: Record<string, number>
  parser: string
  parser_note: string | null
}

export function poImportDraftFromWire(draft: WireDraft): EditableDraft {
  return {
    ...draft,
    currency: draft.currency ?? "IDR",
    source_files: [...draft.source_files],
    lines: draft.lines.map((line) => ({ ...line })),
    questions: [...draft.questions],
    confidence: { ...draft.confidence },
  }
}
