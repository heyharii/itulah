import { node } from "@/lib/api"
import { raiseDirectPurchaseOrder } from "@/lib/queries/procurement"

/// Returns to a supplier that come out of HO return stock (RETURN_TO_SUPPLIER
/// allotments plus the terms agreed with the supplier). Types are written by
/// hand until the contract is generated; the shape is the one in
/// `docs/goods-flow-build-2026-10.md`.
///
/// Confirming a return issues its surat — a `SUPPLIER_RETURN` letter, the
/// numbered return delivery note the supplier signs against — server-side, so
/// a return carries its letter id and number from birth.
///
/// Over-delivery returns are a different book (`purchaseReturns`) and are
/// folded into the same list on the screen, not here.

/// Why the goods go back, as the owner set it (2026-10-04): more came than
/// was ordered, or what came is not what the order said.
export type SupplierReturnReason = "OVER_DELIVERY" | "ITEM_MISMATCH"
export type SettleBy = "REPLACEMENT" | "REFUND" | "CREDIT_NOTE"
export type SupplierReturnStatus =
  "TO_HAND_OVER" | "WAITING" | "PARTLY_SETTLED" | "SETTLED" | "CLOSED_SHORT"

export interface SupplierReturnLine {
  readonly sku_code: string
  readonly article_code: string
  readonly article_name: string | null
  readonly quantity: number
  readonly unit_cost_minor: number
}

export interface SupplierReturnSettlement {
  readonly kind: SettleBy
  readonly quantity: number | null
  readonly amount_minor: number
  readonly reference: string | null
  readonly recorded_by: string
  readonly recorded_at: string
}

export interface SupplierReturn {
  readonly allotment_id: string
  readonly allotment_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly reason: SupplierReturnReason
  readonly settle_by: SettleBy
  readonly status: SupplierReturnStatus
  readonly quantity: number
  readonly value_minor: number
  readonly settled_minor: number
  readonly owed_minor: number
  readonly raised_by: string
  readonly raised_at: string
  readonly handed_over_at: string | null
  readonly closed_short_reason: string | null
  /// The surat issued when the return was confirmed: the numbered return
  /// delivery note the supplier signs against.
  readonly letter_id: string | null
  readonly letter_number: string | null
  readonly lines: readonly SupplierReturnLine[]
  readonly settlements: readonly SupplierReturnSettlement[]
}

export interface NewSupplierReturn {
  readonly supplier_id: string
  readonly reason: SupplierReturnReason
  readonly settle_by: SettleBy
  readonly source_pool_id: string
  readonly lines: readonly { sku_code: string; quantity: number }[]
  readonly note?: string | null
}

export interface NewSettlement {
  readonly kind: SettleBy
  readonly quantity?: number | null
  readonly amount_minor?: number | null
  readonly reference?: string | null
}

export const supplierReturnKeys = {
  all: ["supplier-returns"] as const,
  list: () => ["supplier-returns", "list"] as const,
  stock: (poolId: string) => ["supplier-returns", "stock", poolId] as const,
  skuSuppliers: (skus: readonly string[]) =>
    ["supplier-returns", "sku-suppliers", skus] as const,
}

export function supplierReturns(signal?: AbortSignal) {
  return node
    .get<{ items: SupplierReturn[] }>("/api/v1/supplier-returns", { signal })
    .then((body) => body.items)
}

export function createSupplierReturn(
  body: NewSupplierReturn,
  idempotencyKey: string
) {
  return node.post<SupplierReturn>("/api/v1/supplier-returns", body, {
    headers: { "Idempotency-Key": idempotencyKey },
  })
}

export function recordSettlement(allotmentId: string, body: NewSettlement) {
  return node.post<SupplierReturn>(
    `/api/v1/supplier-returns/${allotmentId}/settlements`,
    body
  )
}

export function closeShort(allotmentId: string, reason: string) {
  return node.post<SupplierReturn>(
    `/api/v1/supplier-returns/${allotmentId}/close-short`,
    { reason }
  )
}

/// A return still waiting on the supplier: handed over and something is owed.
export function isOwing(row: SupplierReturn): boolean {
  return row.owed_minor > 0
}

export const REASON_LABEL: Readonly<Record<SupplierReturnReason, string>> = {
  OVER_DELIVERY: "Over-delivery",
  ITEM_MISMATCH: "Items don't match the order",
}

export const SETTLE_LABEL: Readonly<Record<SettleBy, string>> = {
  REPLACEMENT: "Replacement",
  REFUND: "Refund",
  CREDIT_NOTE: "Credit note",
}

export const STATUS_LABEL: Readonly<Record<SupplierReturnStatus, string>> = {
  TO_HAND_OVER: "To hand over",
  WAITING: "Waiting on supplier",
  PARTLY_SETTLED: "Partly settled",
  SETTLED: "Settled",
  CLOSED_SHORT: "Closed short",
}

/// The SKUs' suppliers, for the suppliers a return can be raised against.
export async function skuSuppliers(
  skus: readonly string[],
  signal?: AbortSignal
) {
  const found = new Map<string, { id: string; name: string }>()
  const CHUNK = 100
  for (let from = 0; from < skus.length; from += CHUNK) {
    const chunk = skus.slice(from, from + CHUNK)
    const list = await node.get<{
      items: {
        sku_code: string
        supplier_id: string | null
        supplier_name: string | null
      }[]
    }>(
      `/api/v1/inventory/sku-suppliers?sku=${encodeURIComponent(chunk.join(","))}`,
      { signal }
    )
    for (const one of list.items) {
      if (one.supplier_id !== null) {
        found.set(one.sku_code, {
          id: one.supplier_id,
          name: one.supplier_name ?? one.supplier_id,
        })
      }
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Replacement goods
// ---------------------------------------------------------------------------

/// What the supplier still has to send back as goods: the pieces on the return
/// less those already counted in, or, when other settlements took part of the
/// value, the pieces the rupiah still owed stands for.
export function owedPieces(row: SupplierReturn): number {
  const replaced = row.settlements.reduce(
    (sum, one) => sum + (one.kind === "REPLACEMENT" ? (one.quantity ?? 0) : 0),
    0
  )
  const byValue =
    row.value_minor > 0
      ? Math.ceil((row.owed_minor * row.quantity) / row.value_minor)
      : row.quantity
  return Math.max(0, Math.min(row.quantity - replaced, byValue))
}

/// A return can ask for goods back while the supplier owes something and the
/// terms were replacement.
export function expectsReplacement(row: SupplierReturn): boolean {
  return (
    (row.status === "WAITING" || row.status === "PARTLY_SETTLED") &&
    (row.settle_by === "REPLACEMENT" || row.owed_minor > 0) &&
    owedPieces(row) > 0
  )
}

/// The note a replacement order carries. It is how the order is recognised
/// from both ends: the return finds its order, and the count review finds the
/// return to settle.
export function replacementNote(allotmentNumber: string): string {
  return `Replacement for ${allotmentNumber}`
}

/// The return an order is a replacement for, from its note.
export function replacementOf(notes: string | null): string | null {
  const found = /^Replacement for (\S+)$/.exec((notes ?? "").trim())
  return found ? found[1] : null
}

/// The order number a replacement is raised under; the allotment's number in
/// it is what the return matches the order by.
export function replacementPoNumber(
  allotmentNumber: string,
  earlier: number
): string {
  const base = `RPL-${allotmentNumber}`
  return earlier === 0 ? base : `${base}-${earlier + 1}`
}

/// Does this order number belong to a replacement for the return?
export function isReplacementPo(
  poNumber: string,
  allotmentNumber: string
): boolean {
  const base = `RPL-${allotmentNumber}`
  return poNumber === base || poNumber.startsWith(`${base}-`)
}

/// The pieces each line asks for: the return's own lines when everything is
/// still owed, otherwise the owed pieces shared out across them.
function owedByLine(row: SupplierReturn): number[] {
  const owed = owedPieces(row)
  if (owed >= row.quantity) return row.lines.map((line) => line.quantity)
  const shares = row.lines.map((line) =>
    Math.floor((line.quantity * owed) / row.quantity)
  )
  let left = owed - shares.reduce((sum, one) => sum + one, 0)
  for (let i = 0; left > 0; i = (i + 1) % shares.length) {
    if (shares[i] < row.lines[i].quantity) {
      shares[i] += 1
      left -= 1
    }
  }
  return shares
}

/// Raise the order the replacement goods will arrive on: the return's goods,
/// the pieces still owed, at no price. Ops counts it like any other order.
export async function raiseReplacementOrder(
  row: SupplierReturn,
  destinationSiteId: string,
  actor: string,
  earlier: number
) {
  const shares = owedByLine(row)
  const lines = []
  for (const [index, line] of row.lines.entries()) {
    const quantity = shares[index]
    if (quantity <= 0) continue
    // The order names the article; the return carries it beside the SKU.
    lines.push({
      article_code: line.article_code,
      article_name: line.article_name ?? line.article_code,
      ordered_quantity: quantity,
      unit_price_minor: 0,
    })
  }
  return raiseDirectPurchaseOrder({
    po_number: replacementPoNumber(row.allotment_number, earlier),
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    destination_site_id: destinationSiteId,
    origin_kind: "DIRECT",
    currency: "IDR",
    notes: replacementNote(row.allotment_number),
    created_by: actor,
    lines,
  })
}
