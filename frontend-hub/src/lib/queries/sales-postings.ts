import { node } from "@/lib/api"

/// A Cloud document built from one shop's completed sales for one business day.
/// This API is hand-typed because the backend exposes the document through
/// several serde structs that are not currently emitted into the TS contract.
export interface SalesPosting {
  readonly posting_id: string
  readonly site_id: string
  readonly business_date: string
  readonly status: "DRAFT" | "POSTED" | "REVERSED" | string
  readonly currency: string
  readonly gross_minor: number
  readonly settled_minor: number
  readonly discount_minor: number
  readonly returns_minor: number
  readonly vat_minor: number
  readonly revenue_minor: number
  readonly untendered_minor: number
  readonly sale_count: number
  readonly vat_rate_bps: number
  readonly vat_source: string
  readonly vat_recorded_minor: number | null
  readonly vat_recomputed_minor: number
  readonly generated_at: string
  readonly generated_by: string
  readonly journal_entry_id: string | null
  readonly entry_number: string | null
  readonly posted_at: string | null
  readonly posted_by: string | null
  readonly reversal_entry_id: string | null
  readonly reversed_at: string | null
  readonly reversed_by: string | null
  readonly reversal_reason: string | null
}

export interface SalesPostingLine {
  readonly line_id: string
  readonly line_number: number
  readonly method: string
  readonly acquirer: string
  readonly card_kind: string | null
  readonly card_kind_inferred: boolean
  readonly gross_minor: number
  readonly returns_minor: number
  readonly discount_minor: number
  readonly vat_minor: number
  readonly tender_count: number
}

export interface SalesPostingDocument {
  readonly posting: SalesPosting
  readonly lines: readonly SalesPostingLine[]
}

export interface GenerateSalesPostingRequest {
  readonly site_id: string
  readonly business_date: string
}

export const salesPostingKeys = {
  all: ["finance", "sales-postings"] as const,
  list: (site: string, month: string) =>
    ["finance", "sales-postings", site, month] as const,
  detail: (id: string | null) =>
    ["finance", "sales-postings", "detail", id] as const,
}

export function listSalesPostings(
  site: string,
  month: string,
  signal?: AbortSignal
): Promise<SalesPosting[]> {
  const query = new URLSearchParams({ site, month, limit: "200" })
  return node.get<SalesPosting[]>(
    `/api/v1/finance/sales-postings?${query.toString()}`,
    { signal }
  )
}

export function salesPostingDetail(
  id: string,
  signal?: AbortSignal
): Promise<SalesPostingDocument> {
  return node.get<SalesPostingDocument>(
    `/api/v1/finance/sales-postings/${encodeURIComponent(id)}`,
    { signal }
  )
}

export function generateSalesPosting(
  request: GenerateSalesPostingRequest,
  signal?: AbortSignal
): Promise<SalesPostingDocument> {
  return node.post<SalesPostingDocument>(
    "/api/v1/finance/sales-postings/generate",
    request,
    { signal }
  )
}

export function postSalesPosting(
  id: string,
  signal?: AbortSignal
): Promise<SalesPostingDocument> {
  return node.post<SalesPostingDocument>(
    `/api/v1/finance/sales-postings/${encodeURIComponent(id)}/post`,
    {},
    { signal }
  )
}
