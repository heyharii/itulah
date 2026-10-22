import { queryOptions, useQuery } from "@tanstack/react-query"

import { count } from "@/lib/format"
import { sourceName } from "@/screens/stock/shared"
import {
  fetchInbound,
  fetchInboundDelivery,
  inboundDeliveryKey,
  inboundListKey,
} from "@/lib/queries"
import type { StoreInboundDelivery, StoreInboundLine } from "@itulah/contract"

/// The facts the Receive screen and its sheet share — the reads and the words
/// for a delivery. Nothing here draws; the sheet is `delivery-sheet.tsx`.

// ── The reads ───────────────────────────────────────────────────────────────

/// How often the screen asks again. A count taken at another till in this
/// shop submits on its own, with nobody at this desk pressing anything, so
/// the result has to arrive on its own poll — and a quarter of a minute is
/// about how long it takes to walk from the stockroom to the back office.
export const INBOUND_POLL_MS = 15_000

/// Every delivery the node knows of, in transit and received, in one read.
///
/// One read rather than one per filter: the stat strip needs both halves at
/// once, and two reads polled on two timers could disagree about the same
/// delivery for fifteen seconds. The filter is applied in the browser.
export const inboundQuery = () =>
  queryOptions({
    queryKey: inboundListKey("ALL"),
    queryFn: ({ signal }) => fetchInbound("ALL", signal),
    // The app's five-minute default is for a price book. A delivery flips to
    // received while somebody is looking, so coming back to this screen asks
    // again rather than drawing a list from before the sweep.
    staleTime: INBOUND_POLL_MS,
  })

export function useInbound() {
  return useQuery({ ...inboundQuery(), refetchInterval: INBOUND_POLL_MS })
}

/// One delivery's lines. Only asked for once the delivery is received: in
/// transit the node sends no lines, and there is nothing to poll for — the
/// list's own poll is what notices the delivery arriving.
export function useInboundDelivery(deliveryId: string, enabled: boolean) {
  return useQuery({
    queryKey: inboundDeliveryKey(deliveryId),
    queryFn: ({ signal }) => fetchInboundDelivery(deliveryId, signal),
    enabled,
    staleTime: INBOUND_POLL_MS,
  })
}

// ── The words ───────────────────────────────────────────────────────────────

/// What a delivery is called: the surat jalan number the driver hands over,
/// and where it came from when the DC gave none.
export function deliveryName(delivery: StoreInboundDelivery): string {
  return delivery.shipment_reference ?? `From ${delivery.source_site_id}`
}

/// Where a delivery came from, as the list says it: the warehouse is "HO".
export function fromName(siteId: string): string {
  const id = siteId.toLowerCase()
  return id === "dc" || id.startsWith("dc-") || id.startsWith("ho")
    ? "HO"
    : sourceName(siteId)
}

/// "1 koli", "3 koli" — what the DC calls koli.
export function cartons(n: number): string {
  return `${count(n)} ${"koli"}`
}

export type Verdict = {
  readonly tone: "info" | "ok" | "warn" | "bad"
  readonly label: string
}

/// The delivery's state in one pill: received, or received short. Extras are
/// not a state of their own — they read in the Result column — so a count
/// with no missing garment is simply Received.
export function verdictOf(delivery: StoreInboundDelivery): Verdict {
  if (delivery.status === "IN_TRANSIT") {
    return { tone: "info", label: "In transit" }
  }
  // Counted, and the count differs from what was sent: nothing of it is
  // booked until MD answers (owner, 18 Oct 2026).
  if (delivery.in_review === true) return { tone: "warn", label: "In review" }
  const result = delivery.result
  if (result === null) return { tone: "ok", label: "Received" }
  if (result.missing_units > 0) return { tone: "bad", label: "Received short" }
  return { tone: "ok", label: "Received" }
}

/// The result, but ONLY for a received delivery.
///
/// The count is blind: whoever sweeps an in-transit delivery must not know
/// how many to expect, or the count finds that number. The node already sends
/// no result in transit; reading it through this means a result that ever did
/// arrive early is still never drawn.
export function resultOf(delivery: StoreInboundDelivery) {
  // In review nothing is booked yet, so nothing is missing yet either.
  return delivery.status === "RECEIVED" && delivery.in_review !== true
    ? delivery.result
    : null
}

/// In transit first, then received — newest first within each, by the moment
/// that matters for it: when it left, when it was counted.
export function byArrival(
  left: StoreInboundDelivery,
  right: StoreInboundDelivery,
): number {
  if (left.status !== right.status) return left.status === "IN_TRANSIT" ? -1 : 1
  const when = (one: StoreInboundDelivery) =>
    Date.parse(one.received_at ?? one.departed_at) || 0
  return when(right) - when(left)
}

/// Problems first — the most missing, then the most extra — and the lines that
/// came in exactly as packed after them, by SKU.
export function byTrouble(
  left: StoreInboundLine,
  right: StoreInboundLine,
): number {
  return (
    right.missing - left.missing ||
    right.extra - left.extra ||
    left.sku_code.localeCompare(right.sku_code)
  )
}
