import { queryOptions } from "@tanstack/react-query"

import type { ReceivedShipment } from "@itulah/contract"

import { keys as operationKeys } from "@/lib/operations/keys"
import { receivedShipments } from "@/screens/operations/board/received"

/// Surat jalan the stores signed for short — the same read the operations
/// board carries, so a short note here and a lane there never disagree.

/// How far back receive gaps are read, fixed in whole days so the window is one
/// cache key (see `receivedSince`).
const RECEIVED_DAYS = 30

/// The start of the receive-gap window: midnight UTC, `RECEIVED_DAYS` back.
/// Whole days on purpose — a window to the millisecond is a new cache key at
/// every mount, and nothing could warm another's.
export function receivedSince(now: number = Date.now()): string {
  const today = Math.floor(now / 86_400_000) * 86_400_000
  return new Date(today - RECEIVED_DAYS * 86_400_000).toISOString()
}

export const receivedFeedQuery = (since: string) =>
  queryOptions({
    queryKey: operationKeys.receivedShipments(since),
    queryFn: ({ signal }) => receivedShipments(since, signal),
  })

/// One row of the received-shipments feed.
export type ReceivedShipmentRow = ReceivedShipment
