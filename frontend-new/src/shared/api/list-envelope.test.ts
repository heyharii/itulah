/**
 * The envelope reader's job is to be *honest*, not clever: when the hub's
 * response cannot distinguish "this is everything" from "this is one page", it
 * must say it does not know rather than guess.
 *
 * Every fixture here is a real response shape observed on the running cloud-hub
 * (see docs/list-contract.md §0), not an invented one.
 */

import { describe, expect, it } from "vitest"

import { readListEnvelope } from "./list-envelope"

describe("readListEnvelope — finding the rows", () => {
  it("reads the contract's `items` key", () => {
    const e = readListEnvelope({ items: [1, 2, 3] })
    expect(e.items).toEqual([1, 2, 3])
    expect(e.count).toBe(3)
  })

  it("falls back to a bespoke key named after the resource", () => {
    // /api/v1/masterdata/locations really returns {count, locations}
    const e = readListEnvelope({ count: 29, locations: [{ id: "a" }] })
    expect(e.items).toHaveLength(1)
    expect(e.count).toBe(29)
  })

  it("falls back to the first array-valued property for an unknown key", () => {
    // 29 endpoints name their array after the resource; enumerating them all
    // would mean editing the reader every time the hub grows a route.
    const e = readListEnvelope({ total: 21, employees: [{ id: "e1" }, { id: "e2" }] })
    expect(e.items).toHaveLength(2)
  })

  it("survives a payload that is not a list at all", () => {
    expect(readListEnvelope(null).items).toEqual([])
    expect(readListEnvelope("nonsense").items).toEqual([])
    expect(readListEnvelope(42).items).toEqual([])
  })
})

describe("readListEnvelope — the trust rule", () => {
  it("trusts a total that cannot be the page length", () => {
    // /api/v1/audit: {count: 5, items: […5], total: 72}
    const e = readListEnvelope({ count: 5, items: [1, 2, 3, 4, 5], total: 72 })
    expect(e.total).toBe(72)
  })

  it("REFUSES a total equal to the row count", () => {
    // ~17 Go sites write `"total": len(items)`, meaning the page length, while
    // ~44 write the whole result set. From the response alone the two are
    // indistinguishable — so this must not be reported as "that was everything".
    const e = readListEnvelope({ items: [1, 2, 3], total: 3 })
    expect(e.total).toBeUndefined()
    expect(e.nextCursor).toBeNull()
  })

  it("trusts `page.total` even when it equals the row count", () => {
    // Under the contract, `page.total` is unambiguous by construction.
    const e = readListEnvelope({ items: [1, 2, 3], page: { count: 3, total: 3 } })
    expect(e.total).toBe(3)
  })

  it("lets X-Total-Count outrank an ambiguous body total", () => {
    // listparams.ApplyInMemory returns a bare array and puts the count in the
    // header — a client reading only the body sees "here is everything".
    const e = readListEnvelope([1, 2, 3], { totalCount: 900 })
    expect(e.total).toBe(900)
    expect(e.nextCursor).toBe("3")
  })

  it("accepts the header as the string a header actually is", () => {
    expect(readListEnvelope([1, 2], { totalCount: "50" }).total).toBe(50)
    expect(readListEnvelope([1, 2], { totalCount: "" }).total).toBe(2)
    expect(readListEnvelope([1, 2], { totalCount: "junk" }).total).toBe(2)
  })
})

describe("readListEnvelope — where the next page comes from", () => {
  it("prefers an explicit cursor over anything derived", () => {
    const e = readListEnvelope({ items: [1], total: 900, next_cursor: "eyJz" })
    expect(e.nextCursor).toBe("eyJz")
    expect(e.hasMore).toBe(true)
  })

  it("honours has_more when there is no cursor", () => {
    // inventory/balances and inventory/movements both return has_more.
    const e = readListEnvelope({ items: [1, 2], total: 2, has_more: true }, { offset: 0 })
    expect(e.nextCursor).toBe("2")
  })

  it("lets has_more say NO even when a total suggests otherwise", () => {
    const e = readListEnvelope({ items: [1, 2], total: 99, has_more: false })
    expect(e.nextCursor).toBeNull()
    expect(e.hasMore).toBe(false)
  })

  it("derives an offset cursor from a trustworthy total", () => {
    const e = readListEnvelope({ count: 5, items: [1, 2, 3, 4, 5], total: 72 }, { offset: 0 })
    expect(e.nextCursor).toBe("5")
  })

  it("counts from the offset already held, not from zero", () => {
    const e = readListEnvelope({ count: 5, items: [1, 2, 3, 4, 5], total: 72 }, { offset: 40 })
    expect(e.nextCursor).toBe("45")
  })

  it("stops at the end of a derived sequence", () => {
    const e = readListEnvelope({ count: 2, items: [1, 2], total: 72 }, { offset: 70 })
    expect(e.nextCursor).toBeNull()
  })

  it("never offers a next page after an empty one", () => {
    // Otherwise a server that reports has_more on an empty tail loops forever.
    const e = readListEnvelope({ items: [], total: 900, has_more: true }, { offset: 100 })
    expect(e.nextCursor).toBeNull()
  })

  it("treats a bare array at offset 0 as the whole list", () => {
    const e = readListEnvelope([1, 2, 3])
    expect(e.total).toBe(3)
    expect(e.nextCursor).toBeNull()
  })
})

describe("readListEnvelope — the regression this whole contract exists for", () => {
  it("does not claim a page is the whole result set", () => {
    // This is the exact shape behind four screens shipping a silent cap:
    // `truncated: total > items.length` is false when total IS items.length,
    // so the client concluded nothing had been withheld — precisely where it
    // could not know.
    const page = readListEnvelope({ items: new Array(200).fill(0), total: 200 })

    expect(page.total).toBeUndefined() // "unknown", not "200 of 200"
    expect(page.hasMore).toBe(false) // and it does not invent a next page either
  })
})
