import type { ReceivedShipmentList } from "@itulah/contract"

import { node } from "@/lib/api"

/// The surat jalan stores have received since `since`, and every one still
/// short however old — read from the CENTRE, not the DC.
///
/// The DC's own shipment never gets past In transit: nothing a shop does
/// reaches its position. The centre holds every shop's receipt as counted at
/// the door and every tag booked against it since, so it is the one place
/// that can say "received, and two short".
export function receivedShipments(since: string, signal?: AbortSignal) {
  return node.get<ReceivedShipmentList>(
    `/api/v1/inventory/shipments/received?since=${encodeURIComponent(since)}&limit=200`,
    { signal }
  )
}
