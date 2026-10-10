import { queryOptions } from "@tanstack/react-query"

import {
  warmInfinite,
  warmQuery,
  type PrefetchMap,
  type Prefetcher,
} from "@/lib/prefetch"
import {
  allotmentListQuery,
  AVAILABILITY_OPENING_POOL,
  availabilityQuery,
  COUNTS_OPENING_SCOPE,
  countsBoardQuery,
  countsBookQuery,
  fleetPoolsQuery,
  MOVEMENTS_OPENING_SCOPE,
  movementsLedgerQuery,
} from "@/lib/queries/inventory"
import { unitsQuery } from "@/lib/queries/organisation"
import { listPurchaseOrders, procurementKeys } from "@/lib/queries/procurement"
import {
  missingFeedQuery,
  receivedFeedQuery,
  receivedSince,
} from "@/screens/inventory/exceptions-data"

/// What Inventory asks first, before the screen is open (`lib/prefetch.ts`).
/// The options are the screens' own: the list screens share theirs through
/// `lib/queries/inventory.ts` and `exceptions-data.ts`.
///
/// Never here, on purpose: Control, Observations (and its anomalies), As of,
/// Time machine, Reconciliations and Flows. They are slow, or nobody opens
/// them by hovering.

/// The exception feeds Stock's cards and the Exceptions inbox are made of (and
/// the nav badge counts): missing balances, short receipts, and the fleet read
/// that places them. The same three `useExceptionCases` asks.
const exceptionFeeds: Prefetcher = (client) =>
  Promise.all([
    warmQuery(client, missingFeedQuery()),
    warmQuery(client, receivedFeedQuery(receivedSince())),
    warmQuery(client, fleetPoolsQuery()),
  ])

/// The open order book as Stock's on-order card reads it: the same scope as
/// `ORDER_SCOPE` in `stock-cards.tsx`.
const OPEN_ORDERS = { statuses: ["ACTIVE", "PARTIALLY_RECEIVED"] } as const
const openOrdersQuery = () =>
  queryOptions({
    queryKey: procurementKeys.orders(OPEN_ORDERS),
    queryFn: ({ signal }) => listPurchaseOrders(OPEN_ORDERS, signal),
  })

/// A list whose narrowing lives in the address bar (`q`, the filter chips `f`
/// and `f2`, a status view) asks for exactly that, and the screen does so
/// itself — the default is not what it will want.
const narrowed = (
  search: Readonly<Record<string, unknown>>,
  ...extra: string[]
) => ["q", "f", "f2", ...extra].some((name) => search[name] !== undefined)

export const prefetch: PrefetchMap = {
  // Stock: one card per place. Mirrors `StockCards` — the fleet, the units,
  // the exception feeds, the allotment book (the road card), the open order
  // book and the count board.
  "/inventory": (client, context) =>
    Promise.all([
      exceptionFeeds(client, context),
      warmQuery(client, unitsQuery()),
      warmQuery(client, allotmentListQuery("", "")),
      warmQuery(client, openOrdersQuery()),
      warmQuery(client, countsBoardQuery()),
    ]),

  "/inventory/exceptions": exceptionFeeds,

  // On Hand & Shortfall opens on the warehouse, no search, every SKU: the
  // first page of its availability and the fleet read behind the pool picker.
  "/inventory/availability": (client) =>
    Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmInfinite(
        client,
        availabilityQuery(AVAILABILITY_OPENING_POOL, "", false)
      ),
    ]),

  // Pools: the fleet table and the count board behind its "last counted".
  "/inventory/pools": (client) =>
    Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmQuery(client, countsBoardQuery()),
    ]),

  // Counts: the fleet read (site and pool names) and the first page of the
  // count book as the screen opens it.
  "/inventory/counts": (client, { search }) => {
    if (narrowed(search, "count-status")) return
    return Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmInfinite(client, countsBookQuery(COUNTS_OPENING_SCOPE)),
    ])
  },

  // Movements: the fleet read (pool names on every route chip) and the first
  // page of the ledger, newest first.
  "/inventory/movements": (client, { search }) => {
    if (narrowed(search)) return
    return Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmInfinite(client, movementsLedgerQuery(MOVEMENTS_OPENING_SCOPE)),
    ])
  },
}

/// Warmed while idle: the exception feeds. The nav badge asks for them as soon
/// as the Inventory menu is on screen, Stock's cards need them, and the fleet
/// read among them is what every other Inventory screen opens with. The rest
/// are asked on hover.
export const warm = { "/inventory/exceptions": 6 }
