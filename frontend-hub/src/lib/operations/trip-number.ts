import type { Dispatch, Shipment } from "@itulah/contract"

/// The number a trip's surat jalan prints. The trip's own `dispatch_number`
/// when it has one; otherwise the first shop's shipment number and how many
/// more ride with it, so the paper still carries something to quote.
export function tripDocumentNumber(
  dispatch: Pick<Dispatch, "dispatch_number"> | null | undefined,
  shipments: readonly Pick<Shipment, "shipment_number">[]
): string {
  const own = dispatch?.dispatch_number.trim() ?? ""
  if (own !== "") return own
  const [first, ...rest] = shipments
  if (!first) return "—"
  return rest.length === 0
    ? first.shipment_number
    : `${first.shipment_number} (+${rest.length})`
}
