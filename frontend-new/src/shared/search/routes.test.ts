/**
 * The reason this mapping exists at all, pinned as tests.
 *
 * The hub's `search_index` carries a `route_path` per row, and following it is
 * the obvious implementation. It is also wrong: those paths were written for a
 * different client. The backfill emits `/articles/sku-lookup?id=…`,
 * `/customers/profiles?customerId=…`, `/procurement/suppliers?id=…`,
 * `/hr/employees?id=…` and `/guardian/alerts?id=…`. This app has `/articles`,
 * `/customers`, `/buying`, `/hr-ho`, and no `/guardian` at all — so every one
 * of those links would land on a 404 here.
 *
 * If someone later "simplifies" the palette to just use `route_path`, these
 * fail.
 */

import { describe, expect, it } from "vitest"

import { destinationFor } from "./routes"

describe("destinationFor — this app's routes, not the hub's", () => {
  it("sends a SKU to the articles screen with its sheet open", () => {
    // The hub would say `/articles/sku-lookup?id=SKU-1`, which does not exist here.
    expect(destinationFor("sku", "SKU-1")).toEqual({
      to: "/articles",
      search: { open: "SKU-1" },
      group: "Articles",
    })
  })

  it("sends a customer to /customers, not /customers/profiles", () => {
    expect(destinationFor("customer", "C-9")).toMatchObject({
      to: "/customers",
      search: { open: "C-9" },
    })
  })

  it("sends a supplier into the right half of /buying", () => {
    /* Suppliers and orders were merged into one route with a `section` param,
     * so a destination has to carry the section as well as the record. */
    expect(destinationFor("supplier", "sup-1")).toMatchObject({
      to: "/buying",
      search: { section: "suppliers", open: "sup-1" },
    })
  })

  it("sends a purchase order into the orders half of the same route", () => {
    expect(destinationFor("po", "PO-2026-1")).toMatchObject({
      to: "/buying",
      search: { section: "orders", open: "PO-2026-1" },
    })
  })

  it("sends an employee to hr-ho", () => {
    expect(destinationFor("employee", "e-1")).toMatchObject({
      to: "/hr-ho",
      search: { open: "e-1" },
    })
  })
})

describe("destinationFor — refusing to guess", () => {
  it("returns null for a record type this app has no screen for", () => {
    /* The index is shared with another client and carries types we cannot
     * show — `alert` rows point at a `/guardian` app that does not exist here.
     * Dropping them from the palette is right; inventing a route is not. */
    expect(destinationFor("alert", "A-1")).toBeNull()
    expect(destinationFor("anything-new", "x")).toBeNull()
  })

  it("returns null for a `page` row", () => {
    /* Those are the hub shell's own navigation targets. This app's paths are
     * different, and the rail already lists every app. */
    expect(destinationFor("page", "/")).toBeNull()
  })

  it("uses the record id verbatim, never a re-derived one", () => {
    const id = "PO-2026-42910df4-01a0-7000-8002-28b2b2e0d462"
    expect(destinationFor("po", id)?.search.open).toBe(id)
  })
})
