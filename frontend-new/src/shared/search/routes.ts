/**
 * Where a search hit lives *in this app*.
 *
 * The hub's `search_index` carries a `route_path` on every row, and it is
 * tempting to just follow it. Do not. Those paths were written for a different
 * client — the backfill emits `/articles/sku-lookup?id=…`,
 * `/customers/profiles?customerId=…`, `/procurement/suppliers?id=…`,
 * `/hr/employees?id=…` and `/guardian/alerts?id=…`. This app has `/articles`,
 * `/customers`, `/buying`, `/hr-ho`, and no `/guardian` at all. Every one of
 * those links would land on a 404 here.
 *
 * So the mapping lives on this side, keyed on `record_type` — which *is*
 * stable, because it names what the record is rather than where some UI put it.
 *
 * The `open` param is the same one every detail sheet already reads, which is
 * what makes "search from anywhere, land on the record" work without any screen
 * knowing that search exists.
 */

import type { NavigateOptions } from "@tanstack/react-router"

/** The record types the hub's index actually carries. */
export type SearchRecordType =
  | "sku"
  | "customer"
  | "supplier"
  | "po"
  | "employee"
  | "page"
  | (string & {})

export interface SearchDestination {
  to: string
  search: Record<string, unknown>
  /** What to call this group in the palette. */
  group: string
}

/**
 * A hit's destination, or `null` when this app has nowhere to put it.
 *
 * Returning `null` rather than guessing matters: the index is shared with
 * another client and will contain record types this app has no screen for.
 * A palette that silently drops them is right; one that invents a route is not.
 */
export function destinationFor(
  type: SearchRecordType,
  recordId: string,
): SearchDestination | null {
  switch (type) {
    case "sku":
      return { to: "/articles", search: { open: recordId }, group: "Articles" }

    case "customer":
      return { to: "/customers", search: { open: recordId }, group: "Customers" }

    case "supplier":
      return {
        to: "/buying",
        search: { section: "suppliers", open: recordId },
        group: "Suppliers",
      }

    case "po":
      return {
        to: "/buying",
        search: { section: "orders", open: recordId },
        group: "Purchase orders",
      }

    case "employee":
      return { to: "/hr-ho", search: { open: recordId }, group: "People" }

    /* `page` rows are navigation targets the index carries for typeahead — the
     * hub's own app shell. They are paths, not records, and this app's paths
     * are different. The rail already lists every app, so a page hit adds
     * nothing here. */
    case "page":
      return null

    default:
      return null
  }
}

/** The destination as router navigation options. */
export function navigationFor(
  type: SearchRecordType,
  recordId: string,
): NavigateOptions | null {
  const destination = destinationFor(type, recordId)
  if (!destination) return null
  return {
    to: destination.to,
    search: destination.search,
  } as NavigateOptions
}
