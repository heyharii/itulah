import { queryOptions } from "@tanstack/react-query"

import { dc, poolsAnswer } from "@/lib/api"
import { dcChanges, shortPicks } from "@/lib/operations/changes"
import { keys } from "@/lib/operations/keys"
import { fleetPools, inventoryKeys } from "@/lib/queries/inventory"
import {
  procurementKeys,
  purchaseOrderDetail,
  purchaseOrderPage,
} from "@/lib/queries/procurement"

/// What the warehouse screens ask first, as options a hook and a prefetcher
/// share (`screens/operations/prefetch.ts`).
///
/// Only the key and the function live here. What a screen adds — its own poll
/// (`refetchInterval`), `staleTime`, `enabled` — it spreads on top, so the key
/// and the request cannot drift between the screen and the prefetcher that
/// warms it.

/// The Receiving list: the articles this DC is still owed a delivery against.
export const purchaseWorkQuery = () =>
  queryOptions({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
  })

/// How many orders are owed a delivery, without the list (the badge and the
/// Receiving tab).
export const purchaseSummaryQuery = () =>
  queryOptions({
    queryKey: keys.purchaseSummary(),
    queryFn: ({ signal }) => dc.purchaseSummary(signal),
  })

/// Counts waiting for a second pair of eyes.
export const verifyQueueQuery = () =>
  queryOptions({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
  })

/// A store's return on the road or counted, by status (Receiving's second tab
/// and the count on it).
export const storeInboundQuery = (status?: string) =>
  queryOptions({
    queryKey: keys.storeInbound(status),
    queryFn: ({ signal }) => dc.storeInboundList(status, signal),
  })

/// Picklists still to pick, one per allotment × shop.
export const picklistsToPickQuery = () =>
  queryOptions({
    queryKey: keys.picklistsToPick(),
    queryFn: ({ signal }) => dc.picklistsToPick(signal),
  })

/// Every picklist this DC has raised.
export const picklistsQuery = () =>
  queryOptions({
    queryKey: keys.picklists(),
    queryFn: ({ signal }) => dc.picklists(signal),
  })

/// Every carton, unfiltered (Packing and Packing lists).
export const koliQuery = () =>
  queryOptions({
    queryKey: keys.koli(),
    queryFn: ({ signal }) => dc.koli({}, signal),
  })

/// The pools this node owns.
export const poolsQuery = () =>
  queryOptions({
    queryKey: keys.pools(),
    queryFn: ({ signal }) => poolsAnswer(signal),
  })

/// Pickers who could not finish a line.
export const shortPicksQuery = () =>
  queryOptions({
    queryKey: keys.shortPicks(),
    queryFn: ({ signal }) => shortPicks(signal),
  })

/// MD changes not yet acknowledged by the warehouse. Polled by the board and
/// the pick sheet at the same 30 s as the other reads.
export const dcChangesQuery = () =>
  queryOptions({
    queryKey: keys.changes(),
    queryFn: ({ signal }) => dcChanges(signal),
    refetchInterval: 30_000,
  })

// ── Stock ──────────────────────────────────────────────────────────────────

/// The fleet's pools: the read that gates Ops › Stock (`stock/data.ts`).
export const stockFleetQuery = () =>
  queryOptions({
    queryKey: inventoryKeys.fleet(),
    queryFn: ({ signal }) => fleetPools(signal),
  })

// ── Detail sheets, opened from a row ───────────────────────────────────────

/// One picklist read back (Picking's sheet), by its session id.
export const pickRoundQuery = (id: string) =>
  queryOptions({
    queryKey: keys.pickRound(id),
    queryFn: ({ signal }) => dc.pickSession(id, signal),
  })

/// One carton's manifest (Packing's and Packing lists' sheet).
export const koliManifestQuery = (id: string) =>
  queryOptions({
    queryKey: keys.manifest(id),
    queryFn: ({ signal }) => dc.koliManifest(id, signal),
  })

/// Receiving's count sheet shows each article's division and tags as head
/// office's copy of the order has them: first the order found by its number,
/// then that order in full.
export const countSheetBookQuery = (poNumber: string) =>
  queryOptions({
    queryKey: procurementKeys.ordersPage({ q: poNumber }),
    queryFn: ({ signal }) => purchaseOrderPage({ q: poNumber }, signal),
  })

export const countSheetOrderQuery = (purchaseOrderId: string) =>
  queryOptions({
    queryKey: procurementKeys.order(purchaseOrderId),
    queryFn: ({ signal }) => purchaseOrderDetail(purchaseOrderId, signal),
  })
