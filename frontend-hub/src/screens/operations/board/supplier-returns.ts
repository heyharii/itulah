import { node } from "@/lib/api"

/// A return to a supplier raised from HO return stock, with its terms.
/// The cloud contract is written by hand until `make contract` carries it
/// (docs/goods-flow-build-2026-10.md).
export type SupplierReturnStatus =
  "TO_HAND_OVER" | "WAITING" | "PARTLY_SETTLED" | "SETTLED" | "CLOSED_SHORT"

export interface SupplierReturn {
  readonly allotment_id: string
  readonly allotment_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  readonly reason: "OVER_DELIVERY" | "ITEM_MISMATCH"
  readonly settle_by: "REPLACEMENT" | "REFUND" | "CREDIT_NOTE"
  readonly status: SupplierReturnStatus
  readonly quantity: number
  readonly value_minor: number
  readonly settled_minor: number
  readonly owed_minor: number
  readonly raised_by: string
  readonly raised_at: string
  readonly handed_over_at: string | null
  readonly closed_short_reason: string | null
  /// The surat issued when the return was confirmed.
  readonly letter_id: string | null
  readonly letter_number: string | null
}

export const supplierReturnKeys = {
  all: ["cloud", "supplier-returns"] as const,
}

export async function supplierReturns(signal?: AbortSignal) {
  const body = await node.get<{ items: SupplierReturn[] }>(
    "/api/v1/supplier-returns",
    { signal }
  )
  return body.items
}
