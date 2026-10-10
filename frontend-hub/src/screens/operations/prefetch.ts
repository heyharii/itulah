import type { QueryClient } from "@tanstack/react-query"

import { cacheKey, type DcHosting } from "@/lib/api"
import {
  countSheetBookQuery,
  countSheetOrderQuery,
  koliManifestQuery,
  koliQuery,
  pickRoundQuery,
  picklistsQuery,
  picklistsToPickQuery,
  poolsQuery,
  purchaseSummaryQuery,
  purchaseWorkQuery,
  shortPicksQuery,
  stockFleetQuery,
  storeInboundQuery,
  verifyQueueQuery,
} from "@/lib/operations/queries"
import { warmData, warmQuery, type PrefetchMap } from "@/lib/prefetch"
import { supplierNamesQuery } from "@/lib/queries/procurement"

/// What Operations asks first, before the screen is open (`lib/prefetch.ts`).
///
/// ## The warehouse has its own session
///
/// Every screen here reads the DC node (`dcNode()` in `lib/api.ts`): the cloud
/// itself when it hosts the warehouse (the ordinary session covers it), or an
/// edge node in the building with a bearer of its own. A request sent before
/// that session exists is a 401, and a 401 on the edge drops the bearer
/// (`edge.onBearerRejected` in `main.tsx`) — a favour done early must never do
/// that. So every prefetcher asks `dcReady` first and returns without a word
/// when the answer is no; it never signs anybody in to the DC (that is the
/// gate's job, `operations/gate.tsx`), and it never asks where the warehouse
/// lives: `useDcHosting` does that once the shell is up, and the answer is
/// read from its cache.
///
/// The options are the screens' own (`lib/operations/queries.ts`).

/// Whether the DC will answer this person now.
function dcReady(client: QueryClient): boolean {
  const hosting = client.getQueryData<DcHosting>(cacheKey.dcHosting())
  // Cloud-hosted: the hub session (checked by `prefetchRoute`) is the DC
  // session.
  if (hosting === "cloud") return true
  // On an edge node: only a bearer the node has already vouched for
  // (`useEdgeIdentity` stores who `/auth/me` said it was, `null` when not).
  if (hosting === "edge") {
    return (client.getQueryData(cacheKey.edgeMe()) ?? null) !== null
  }
  // Not asked yet.
  return false
}

export const prefetch: PrefetchMap = {
  // Receiving opens on its Purchase orders tab: the work list, the counts
  // waiting for review, the owed figure on the tab and the store returns still
  // on the road (the other tab's number). The supplier book names the rows; it
  // is left to a person's intent, not the idle warm-up. Mirrors `Receiving`
  // and `IntakeHeader` in `intake/`.
  "/operations/intake": async (client, { reason }) => {
    if (!dcReady(client)) return
    const asks = [
      warmQuery(client, purchaseWorkQuery()),
      warmQuery(client, verifyQueueQuery()),
      warmQuery(client, purchaseSummaryQuery()),
      warmQuery(client, storeInboundQuery("IN_TRANSIT")),
    ]
    if (reason !== "warm") asks.push(warmQuery(client, supplierNamesQuery()))
    await Promise.all(asks)
  },
  // Picking: the picklists to pick, those already walked, the short-pick
  // flags. The pools (the racks to pick from, ~1 s on the local data) wait for
  // a person's intent. Mirrors `Picking` in `picking/picking.tsx`.
  "/operations/picking": async (client, { reason }) => {
    if (!dcReady(client)) return
    const asks = [
      warmQuery(client, picklistsToPickQuery()),
      warmQuery(client, picklistsQuery()),
      warmQuery(client, shortPicksQuery()),
    ]
    if (reason !== "warm") asks.push(warmQuery(client, poolsQuery()))
    await Promise.all(asks)
  },
  // Packing: the picklists owed a pack and every carton. The carton list is
  // not paged by the node and grows with the book, so it is intent-only.
  // Mirrors `Packing` in `packing/packing.tsx`.
  "/operations/packing": async (client) => {
    if (!dcReady(client)) return
    await Promise.all([
      warmQuery(client, picklistsQuery()),
      warmQuery(client, koliQuery()),
    ])
  },
  // Packing lists: the same carton list. Mirrors `PackingLists`.
  "/operations/packing-lists": async (client) => {
    if (!dcReady(client)) return
    await warmQuery(client, koliQuery())
  },
  // Stock: the fleet's pools, the read that gates the table (every other read
  // of the screen degrades to an empty section, and the heavy ones — the whole
  // order book, the allotment book — are not asked for here). Mirrors
  // `useStockStatus` in `stock/data.ts`. This is the cloud's read, not the
  // DC's, so no DC session is needed.
  "/operations/stock": async (client) => {
    await warmQuery(client, stockFleetQuery())
  },
}

/// Idle warm-up: the Receiving list is the screen a bay opens first, and
/// Picking is the outbound one — its lists are already polled by the sidebar,
/// so warming it costs one request (the short-pick flags).
export const warm = { "/operations/intake": 4, "/operations/picking": 5 }

// ---------------------------------------------------------------------------
// Detail sheets, opened from a row (DataTable `onRowIntent`)
// ---------------------------------------------------------------------------

/// A picklist's sheet (`?pick=<session id>` on Picking).
export function prefetchPicklistDetail(client: QueryClient, id: string) {
  if (!dcReady(client)) return
  return warmQuery(client, pickRoundQuery(id))
}

/// A carton's sheet (`?koli=<koli id>` on Packing and Packing lists).
export function prefetchKoliDetail(client: QueryClient, id: string) {
  if (!dcReady(client)) return
  return warmQuery(client, koliManifestQuery(id))
}

/// Receiving's count sheet for an order (`?delivery=<PO number>`): the order
/// found by its number, then that order in full, for the division and tags
/// under each article.
export async function prefetchReceivingDetail(
  client: QueryClient,
  poNumber: string
) {
  if (!dcReady(client)) return
  const page = await warmData(client, countSheetBookQuery(poNumber))
  const found = page.rows.find((one) => one.po_number === poNumber)
  if (found === undefined) return
  await warmQuery(client, countSheetOrderQuery(found.purchase_order_id))
}
