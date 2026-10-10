import { warmInfinite, warmQuery, type PrefetchMap } from "@/lib/prefetch"
import type { QueryClient } from "@tanstack/react-query"

import {
  orderBookQuery,
  orderDetailQuery,
  supplierBookQuery,
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

export const prefetch: PrefetchMap = {
  // Orders opens on its Active tab with no filter: the first page of the
  // active book (rows, totals and facets) and the supplier names the filter
  // and the search offer. Mirrors `OrderTab` "active" in `purchase-orders.tsx`.
  "/procurement/orders": async (client, { search }) => {
    if (search.q !== undefined) return
    await Promise.all([
      warmInfinite(
        client,
        orderBookQuery({ statuses: ["ACTIVE", "PARTIALLY_RECEIVED"] })
      ),
      warmQuery(client, supplierNamesQuery()),
    ])
  },
  // Suppliers opens on its Active tab of the merchandise book. Mirrors the
  // `scope` in `suppliers.tsx`.
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
