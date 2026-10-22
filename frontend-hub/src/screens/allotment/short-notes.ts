import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import {
  receivedFeedQuery,
  receivedSince,
  type ReceivedShipmentRow,
} from "@/screens/inventory/received-feed"

/// The delivery notes stores received short — every one, however old, is in
/// the received feed — shared with Inventory's exceptions, so the two read
/// one fetch. Empty until it answers.
export function useShortNotes(): readonly ReceivedShipmentRow[] {
  const [since] = useState(() => receivedSince())
  const feed = useQuery(receivedFeedQuery(since))
  return (feed.data?.items ?? []).filter((one) => one.open_gap_qty > 0)
}
