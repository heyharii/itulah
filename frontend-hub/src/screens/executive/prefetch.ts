import { warmQuery, type PrefetchMap, type Prefetcher } from "@/lib/prefetch"
import { gaExecutiveContractsQuery, gaLocationsQuery } from "@/lib/queries/ga"
import { fleetPoolsQuery } from "@/lib/queries/inventory"
import { memberSegmentsQuery } from "@/lib/queries/members"
import {
  campaignsQuery,
  ordersQuery,
  salesSeriesQuery,
  vouchersPeekQuery,
} from "@/screens/executive/data"
import { scopeFor } from "@/screens/executive/scope"

/// What the Executive pages ask first, before the screen is open
/// (`lib/prefetch.ts`). The options are the screens' own
/// (`screens/executive/data.ts`).
///
/// Never here, on purpose: the books (profit, cash, payables, postings) and the
/// workforce. A role below supervisor is refused the books and shown a line in
/// place of the card, and the workforce is read for the unit a shop belongs
/// to; both stay plain reads that answer after the page is drawn.
///
/// The period (`term`) and the shop (`store`) live in the address bar, and a
/// link that carries one asks for exactly that: the screen does so itself,
/// since the default is not what it will want.

/// The report as it opens: this month, every shop.
function opening(search: Readonly<Record<string, unknown>>) {
  if (search.term !== undefined || search.store !== undefined) return null
  return scopeFor("month", undefined, new Date())
}

/// This period's sales series and the one before it, which every page reads
/// (the shop list is read from the first).
const trade: Prefetcher = (client, { search }) => {
  const scope = opening(search)
  if (scope === null) return
  return Promise.all([
    warmQuery(client, salesSeriesQuery(scope.range)),
    warmQuery(client, salesSeriesQuery(scope.beforeRange)),
  ])
}

/// Only the shop list, for a page that draws no trade of its own.
const places: Prefetcher = (client, { search }) => {
  const scope = opening(search)
  if (scope === null) return
  return warmQuery(client, salesSeriesQuery(scope.range))
}

/// Run each of the prefetchers given, together.
const together =
  (...all: Prefetcher[]): Prefetcher =>
  (client, context) =>
    Promise.all(all.map((one) => one(client, context)))

export const prefetch: PrefetchMap = {
  "/executive": trade,
  // The shops side by side, with what their shelves hold.
  "/executive/stores": together(trade, (client, { search }) => {
    if (opening(search) === null) return
    return warmQuery(client, fleetPoolsQuery())
  }),
  // Shelves and the open purchase orders.
  "/executive/stock": together(trade, (client, { search }) => {
    if (opening(search) === null) return
    return Promise.all([
      warmQuery(client, fleetPoolsQuery()),
      warmQuery(client, ordersQuery()),
    ])
  }),
  // The figures of this page are the books', which are plain reads; what is
  // drawn at once is the page and its shop list.
  "/executive/finance": places,
  "/executive/customers": together(places, (client, { search }) => {
    const scope = opening(search)
    if (scope === null) return
    return Promise.all([
      warmQuery(client, memberSegmentsQuery()),
      warmQuery(client, vouchersPeekQuery()),
      warmQuery(client, campaignsQuery(scope)),
    ])
  }),
  "/executive/people": together(places, (client, { search }) => {
    if (opening(search) === null) return
    return Promise.all([
      warmQuery(client, gaLocationsQuery()),
      warmQuery(client, gaExecutiveContractsQuery()),
    ])
  }),
}
