import type { ShiftSale } from "@/api"

/// What a sale on the receipt list is, said plainly (client, 23 Oct 2026: the
/// transaction list shows sales and returns apart). A sale paid with a return's
/// credit, or one goods came back against, is a Return; a voided one is Void.
export function saleKind(one: ShiftSale): "Penjualan" | "Return" | "Void" {
  if (one.status === "VOIDED") return "Void"
  if (one.returned_minor > 0 || one.tenders.some((t) => t.method === "OTHER")) return "Return"
  return "Penjualan"
}

export function SaleKindPill({ sale }: { sale: ShiftSale }) {
  const kind = saleKind(sale)
  return <span className={`kind-pill kind-${kind.toLowerCase()}`}>{kind}</span>
}
