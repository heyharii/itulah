import { node } from "@/lib/api"

/// A count of a delivery line by colour and size, asked of the warehouse and
/// kept as a reference (0919). New articles asks; Operations answers with a flat
/// list of colour, size and quantity. Nothing waits for it and nothing is
/// checked against it.
export interface QuantityCheckRow {
  /// Which article of the form the count belongs to; absent on checks asked
  /// before the sheet named it.
  readonly article?: string
  readonly colour: string
  readonly size: string
  readonly quantity: number
}

export interface QuantityCheckCell {
  readonly article?: string
  readonly colour: string
  readonly size: string
}

export interface QuantityCheck {
  readonly check_id: string
  readonly receipt_line_id: string
  readonly status: "REQUESTED" | "COUNTED"
  /// The name as head office had it when it asked. The warehouse cannot change
  /// it.
  readonly article_name: string
  readonly requested_by: string
  readonly requested_at: string
  readonly counted_by: string | null
  readonly counted_at: string | null
  readonly lines: readonly QuantityCheckRow[]
  /// The colour and size combinations head office had chosen in the form when
  /// it asked: the rows the warehouse sheet opens with. No quantity, because
  /// head office does not know it.
  readonly expected: readonly QuantityCheckCell[]
  readonly po_number: string
  /// What the delivery was counted at: context for the counter, never a total
  /// to match.
  readonly receipt_quantity: number
  readonly image_url: string | null
  /// The division and tags head office had in the form when it asked, as
  /// catalogue codes.
  readonly division_code: string | null
  readonly tags: readonly string[]
  /// The delivery's supplier: the receipt's code, and the name the order was
  /// raised with when it kept one.
  readonly supplier_id: string
  readonly supplier_name: string | null
}

export const quantityCheckKeys = {
  all: ["quantity-checks"] as const,
  open: () => ["quantity-checks", "open"] as const,
  line: (receiptLineId: string) =>
    ["quantity-checks", "line", receiptLineId] as const,
}

export function listOpenQuantityChecks(signal?: AbortSignal) {
  return node.get<QuantityCheck[]>("/api/v1/quantity-checks?status=REQUESTED", {
    signal,
  })
}

/// Every check of one delivery line, newest first.
export function listLineQuantityChecks(
  receiptLineId: string,
  signal?: AbortSignal
) {
  return node.get<QuantityCheck[]>(
    `/api/v1/quantity-checks?receipt_line_id=${encodeURIComponent(receiptLineId)}`,
    { signal }
  )
}

export function askQuantityCheck(body: {
  receipt_line_id: string
  article_name: string
  expected?: readonly QuantityCheckCell[]
  division?: string
  tags?: readonly string[]
}) {
  return node.post<QuantityCheck>("/api/v1/quantity-checks", body)
}

export function countQuantityCheck(
  id: string,
  lines: readonly QuantityCheckRow[]
) {
  return node.post<QuantityCheck>(`/api/v1/quantity-checks/${id}/count`, {
    lines,
  })
}
