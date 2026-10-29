/// ⇧8 · Return — exchange only, no money ever goes back (owner, 23 Oct 2026;
/// the prototype's `openExchange` … `xGo` in pos-classic-prototype.html).
///
/// (1) The struk first, found by its whole number in the item list (⇧8 opens
/// Struk as Return; `GET /store/receipts/{no}` answers what it sold, what has
/// come back and what may not). (2) The pieces that come back are read on the
/// sale screen: a sold tag counts as back, a stock tag as a replacement, and a
/// replacement is optional. (3) The Kepala toko's finger, and one call
/// (`POST /store/returns`) records the pieces back, the replacements and — for a
/// dearer replacement — the tenders for the difference. Cheaper or none: nothing
/// is paid out and what is left is forfeited.

import * as api from "@/api"

/// What the till carries into Bayar when a Return has replacements: the pieces
/// are only recorded once Bayar is done, in the same call as the tenders.
export type ExchangeCredit = {
  /// What came back: the most the return pays for the replacements.
  readonly capMinor: number
  readonly receiptNo: string
}

export type ExchangeUnit = {
  readonly epc: string
  readonly sku_code: string
  readonly name: string | null
  readonly unitPriceMinor: number | null
}

export type SoldLine = {
  readonly name: string
  readonly skuCode: string
  readonly quantity: number
  /// What one piece was charged, after markdowns (line total / quantity).
  readonly unitMinor: number
  /// False for goods that never come back.
  readonly exchangeable: boolean
}

export type Receipt = {
  readonly saleId: string
  readonly receiptNo: string
  readonly when: string | null
  readonly totalMinor: number
  readonly stamp: string | null
  readonly lines: readonly SoldLine[]
  /// SKU -> pieces of it this receipt sold without a tag and not yet taken
  /// back: those come back by a typed SKU, not a tag.
  readonly untagged: ReadonlyMap<string, number>
}

export const asMap = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
export const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null
export const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

/// A struk found by its number, read for Return: what it sold that has not come
/// back yet, and which tags those are. A sentence when it cannot be returned.
export function returnFrom(
  found: api.ReceiptLookup,
): { readonly receipt: Receipt; readonly soldTags: ReadonlySet<string> | null } | string {
  if (!found.returnable) return found.refusal ?? "Struk ini tidak bisa di-return"
  if (found.sale_id === null) return "Struk ini tidak punya barang untuk di-return"
  const doc = asMap(found.receipt)
  const lines: SoldLine[] = []
  const untagged = new Map<string, number>()
  const tags = new Set<string>()
  for (const piece of found.pieces) {
    if (piece.returned) continue
    if (piece.epc === null) untagged.set(piece.sku_code, (untagged.get(piece.sku_code) ?? 0) + 1)
    else tags.add(piece.epc.toUpperCase())
    const at = lines.findIndex((one) => one.skuCode === piece.sku_code)
    if (at >= 0) {
      const was = lines[at]
      const sum = was.unitMinor * was.quantity + piece.charged_minor
      lines[at] = {
        ...was,
        quantity: was.quantity + 1,
        unitMinor: Math.round(sum / (was.quantity + 1)),
        exchangeable: was.exchangeable && piece.exchangeable,
      }
    } else {
      lines.push({
        name: piece.name,
        skuCode: piece.sku_code,
        quantity: 1,
        unitMinor: piece.charged_minor,
        exchangeable: piece.exchangeable,
      })
    }
  }
  return {
    receipt: {
      saleId: found.sale_id,
      receiptNo: asText(doc?.receipt_no) ?? "",
      untagged,
      when: asText(doc?.completed_at),
      totalMinor: asCount(doc?.total_minor) ?? 0,
      stamp: asText(doc?.stamp),
      lines,
    },
    soldTags: tags.size > 0 ? tags : null,
  }
}
