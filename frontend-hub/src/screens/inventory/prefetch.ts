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
  RECONCILIATIONS_OPENING_SCOPE,
  reconciliationsPageQuery,
  SIGHTINGS_OPENING_SCOPE,
  sightingsPageQuery,
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
/// Every query here is read by its screen with `useSuspense…` inside a
/// `<Suspense>`, so the server starts them too and streams the real page. A
/// query a screen reads with a plain hook (a corner of a card that fills in
/// when it lands) is asked for in the browser only, never on the server.
///
/// Never here, on purpose: Control, As of, Time machine and Flows. They are
/// slow, wait for something to be typed, or nobody opens them by hovering.

/// The exception feeds Stock's cards and the Exceptions inbox are made of (and
/// the nav badge counts): missing balances and short receipts. With the fleet
/// read that places them, the three `useExceptionCases` asks.
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
  // Stock: one card per place. The cards wait for the fleet and the stores
  // (`StockPlaces`); what a card says beyond them — the exception feeds, the
  // allotment book (the road card), the open order book and the count board —
  // is read by plain hooks and so is asked for in the browser only.
  "/inventory": async (client, context) => {
    await Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmQuery(client, unitsQuery()),
      ...(import.meta.env.SSR
        ? []
        : [
            exceptionFeeds(client, context),
            warmQuery(client, allotmentListQuery("", "")),
            warmQuery(client, openOrdersQuery()),
            warmQuery(client, countsBoardQuery()),
          ]),
    ])
  },

  // The inbox waits for the three feeds and the register of places.
  "/inventory/exceptions": async (client, context) => {
    await Promise.all([
      exceptionFeeds(client, context),
      warmQuery(client, unitsQuery()),
    ])
  },

  // On Hand & Shortfall opens on the warehouse, no search, every SKU: the
  // first page of its availability and the fleet read behind the pool picker.
  "/inventory/availability": async (client) => {
    await Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmInfinite(
        client,
        availabilityQuery(AVAILABILITY_OPENING_POOL, "", false)
      ),
    ])
  },

  // Pools: the fleet table. The count board behind its "last counted" column
  // is a plain read that costs the column and nothing else, so it is asked for
  // in the browser only.
  "/inventory/pools": async (client) => {
    await Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      ...(import.meta.env.SSR ? [] : [warmQuery(client, countsBoardQuery())]),
    ])
  },

  // Counts: the fleet read (site and pool names) and the first page of the
  // count book as the screen opens it.
  "/inventory/counts": async (client, { search }) => {
    if (narrowed(search, "count-status")) return
    await Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmInfinite(client, countsBookQuery(COUNTS_OPENING_SCOPE)),
    ])
  },

  // Observations opens on every pool, newest sweep first: the fleet read
  // behind the pool picker and the first page of the sightings. Mirrors
  // `ObservationBook` in `observations.tsx`.
  "/inventory/observations": async (client, { search }) => {
    if (narrowed(search)) return
    await Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmInfinite(client, sightingsPageQuery(SIGHTINGS_OPENING_SCOPE)),
    ])
  },

  // Reconciliations opens on the claims that stop a fleet total being
  // certified, in the house order. Mirrors `ClaimBook` in
  // `reconciliations.tsx`.
  "/inventory/reconciliations": async (client, { search }) => {
    if (narrowed(search)) return
    await warmInfinite(
      client,
      reconciliationsPageQuery(RECONCILIATIONS_OPENING_SCOPE)
    )
  },

  // Movements: the fleet read (pool names on every route chip) and the first
  // page of the ledger, newest first.
  "/inventory/movements": async (client, { search }) => {
    if (narrowed(search)) return
    await Promise.all([
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
