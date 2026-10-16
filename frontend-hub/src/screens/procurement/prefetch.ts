import { warmInfinite, warmQuery, type PrefetchMap } from "@/lib/prefetch"
import type { QueryClient } from "@tanstack/react-query"

import {
  catalogueVocabularyQuery,
  orderBookQuery,
  orderDetailQuery,
  orderListQuery,
  priceAmendmentsQuery,
  supplierBookQuery,
  supplierItemPagesQuery,
  supplierDetailQuery,
  supplierNamesQuery,
  supplierPeopleQuery,
} from "@/lib/queries/procurement"

/// What Procurement asks first, before the screen is open (`lib/prefetch.ts`).
/// The options are the screens' own (`lib/queries/procurement.ts`).

/// The sheets a row opens, asked for as the pointer rests on the row, a finger
/// touches it or the keyboard reaches it (`DataTable onRowIntent`).
export const prefetchOrder = (client: QueryClient, id: string) =>
  warmQuery(client, orderDetailQuery(id))

export const prefetchSupplier = (client: QueryClient, id: string) =>
  Promise.all([
    warmQuery(client, supplierDetailQuery(id)),
    warmQuery(client, supplierPeopleQuery(id)),
  ])

/// Entries whose screens still read the answer with a plain hook. The server
/// renders such a screen's skeleton (a plain `useQuery` never reads a query the
/// server started), so a head start there would only make the client's first
/// render differ from the HTML: these run in the browser only. A screen read
/// with `useSuspenseQuery` inside a `<Suspense>` moves its entry to `prefetch`.
const browserOnly: PrefetchMap = {
  // Orders opens on its Active tab with no filter: the first page of the
  // active book (rows, totals and facets) and the supplier names the filter
  // and the search offer. Mirrors `OrderTab` "active" in `purchase-orders.tsx`.
  //
  // Browser only, on purpose: the list keeps working with the line down (the
  // orders held on this device stand in for it), which a read that suspends
  // and throws cannot do, and the supplier names it draws are read by a plain
  // hook across the app (`useSupplierName`).
  "/procurement/orders": async (client, { search }) => {
    if (search.q !== undefined) return
    await Promise.all([
      warmInfinite(
        client,
        orderBookQuery({
          statuses: ["ACTIVE", "PARTIALLY_RECEIVED"],
          // Newest change first (`sort: "updated"` in `scope`).
          sort: "updated",
        })
      ),
      warmQuery(client, supplierNamesQuery()),
    ])
  },
}

export const prefetch: PrefetchMap = {
  ...(import.meta.env.SSR ? {} : browserOnly),

  // Everything still owed on the order book. Mirrors `OwedOrders` in
  // `outstanding.tsx`.
  "/procurement/outstanding": async (client) => {
    await warmQuery(client, orderListQuery())
  },

  // The deliveries waiting on a price decision. Mirrors `AmendmentQueue` in
  // `amendments.tsx`.
  "/procurement/amendments": async (client) => {
    await warmQuery(client, priceAmendmentsQuery())
  },

  // The catalogue opens on every item, nothing searched, with the words its
  // rows are labelled with. Mirrors `CatalogueBook` in `catalogue.tsx`.
  "/procurement/catalogue": async (client) => {
    await Promise.all([
      warmInfinite(client, supplierItemPagesQuery({})),
      warmQuery(client, catalogueVocabularyQuery()),
    ])
  },

  // Sourcing opens on what is on offer, best match first. Mirrors `scope` in
  // `SourcingBook` (`sourcing.tsx`); a shop, a search, an order or a filter in
  // the address bar is another question, and the screen asks it itself. The
  // words, the supplier names, the colour master and the basket fill in around
  // the cards and are read by plain hooks.
  "/procurement/sourcing": async (client, { search }) => {
    if (
      ["supplier", "q", "sort", "f"].some((name) => search[name] !== undefined)
    )
      return
    await warmInfinite(
      client,
      supplierItemPagesQuery({ sort: "relevance", status: "ACTIVE" })
    )
  },

  // Suppliers opens on its Active tab of the merchandise book. Mirrors the
  // `scope` in `SupplierBook` (`suppliers.tsx`).
  "/procurement/suppliers": (client, { search }) => {
    if (search.q !== undefined) return
    return warmInfinite(
      client,
      supplierBookQuery({ category: "MERCHANDISE", status: "ACTIVE" })
    )
  },
}

/// Idle warm-up: the order book is the screen buyers open most; the suppliers
/// follow when something is left over.
export const warm = { "/procurement/orders": 2, "/procurement/suppliers": 3 }
