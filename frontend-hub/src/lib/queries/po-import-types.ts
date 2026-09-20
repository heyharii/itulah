/// The wire types of the PO import service, transcribed from
/// `services/po-import/server.mjs`. Hand-written beside the fetchers, like the
/// purchasing routes that answer with `json!()` literals — if the service's
/// shapes move, this file is where it goes stale.

export interface PoImportFileReport {
  readonly file_name: string
  readonly status: "parsed" | "failed" | "skipped"
  readonly parser: string
  readonly pages_total: number | null
  readonly pages_ocr: number | null
  readonly note: string | null
  readonly error: string | null
}

export interface PoImportDraftLine {
  readonly line_id: string
  readonly article_code: string | null
  readonly article_name: string | null
  readonly quantity: number | null
  readonly unit: string | null
  readonly unit_price_minor: number | null
  readonly promised_date: string | null
}

/// One wizard question. `options` is the marker of WHAT to fill the choice
/// with on the client — `"supplier"` fills the supplier book,
/// `"destination"` the purchase destinations — because the service does not
/// know our master data.
export interface PoImportQuestion {
  readonly id: string
  readonly kind: "text" | "number" | "date" | "choice"
  readonly label: string
  readonly hint: string | null
  readonly options: string | null
  readonly prefilled: string | null
  readonly confidence: number | null
}

export interface PoImportDraft {
  readonly draft_id: string
  readonly source_files: readonly string[]
  readonly po_number: string | null
  readonly supplier_name: string | null
  readonly supplier_id: string | null
  readonly destination_site_id: string | null
  readonly currency: string | null
  readonly order_date: string | null
  readonly expected_arrival: string | null
  readonly notes: string | null
  readonly lines: readonly PoImportDraftLine[]
  readonly questions: readonly PoImportQuestion[]
  readonly confidence: Readonly<Record<string, number>>
  readonly parser: string
  readonly parser_note: string | null
}

export interface PoImportIngestResponse {
  readonly reports: readonly PoImportFileReport[]
  readonly drafts: readonly PoImportDraft[]
}

export interface PoImportHealth {
  readonly gateway: boolean
  readonly openparser: boolean
  readonly liteparse: boolean
}

/// The screen's working copy is MUTABLE — the wizard and the summary edit it.
/// The service's draft is readonly at rest; the screen works on a shallow
/// structural copy so a frozen wire type and an editable form can agree.
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
    unit_price_minor: number | null
    promised_date: string | null
  }>
  questions: PoImportQuestion[]
  confidence: Record<string, number>
  parser: string
  parser_note: string | null
}

export function poImportDraftFromWire(draft: PoImportDraft): EditableDraft {
  return {
    ...draft,
    currency: draft.currency ?? "IDR",
    source_files: [...draft.source_files],
    lines: draft.lines.map((line) => ({ ...line })),
    questions: [...draft.questions],
    confidence: { ...draft.confidence },
  }
}
