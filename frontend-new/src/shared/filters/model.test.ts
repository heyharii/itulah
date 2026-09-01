/**
 * The filter model's two load-bearing decisions, pinned.
 *
 * 1. A count answers "how many would this option add, given what is already
 *    filtered" — not "how many exist somewhere in the dataset". A chip that
 *    promises 40 and delivers 3 is worse than a chip with no number.
 * 2. A `server` filter is never re-applied on the client. Applying it twice
 *    means two implementations of one rule, and they will diverge.
 */

import { describe, expect, it } from "vitest"

import { applyClientFilters, countOptions, type FilterField } from "./model"

interface Row {
  id: string
  division: string
  tags: string[]
  price: number
  active: boolean
  name: string
}

const rows: Row[] = [
  { id: "a", division: "ladies", tags: ["sale"], price: 100, active: true, name: "Alpha dress" },
  { id: "b", division: "ladies", tags: ["sale", "new"], price: 200, active: true, name: "Beta dress" },
  { id: "c", division: "mens", tags: ["new"], price: 300, active: false, name: "Gamma shirt" },
  { id: "d", division: "mens", tags: [], price: 400, active: true, name: "Delta shirt" },
]

const division: FilterField<Row> = {
  kind: "select",
  key: "division",
  label: "Division",
  where: "client",
  options: () => [
    { value: "ladies", label: "Ladieswear" },
    { value: "mens", label: "Menswear" },
  ],
  valueOf: (row) => row.division,
}

const tags: FilterField<Row> = {
  kind: "multi",
  key: "tags",
  label: "Tags",
  where: "client",
  options: () => [
    { value: "sale", label: "Sale" },
    { value: "new", label: "New" },
  ],
  valuesOf: (row) => row.tags,
}

const price: FilterField<Row> = {
  kind: "range",
  key: "price",
  label: "Price",
  where: "client",
  valueOf: (row) => row.price,
}

const search: FilterField<Row> = {
  kind: "text",
  key: "q",
  label: "Search",
  where: "client",
  haystackOf: (row) => `${row.name} ${row.id}`,
}

describe("applyClientFilters", () => {
  it("returns everything when nothing is selected", () => {
    expect(applyClientFilters([division, tags], {}, rows)).toHaveLength(4)
  })

  it("narrows on a select", () => {
    const kept = applyClientFilters([division], { division: "mens" }, rows)
    expect(kept.map((r) => r.id)).toEqual(["c", "d"])
  })

  it("treats several values of a multi as OR", () => {
    // Matching the list contract's comma-separated server filter, so the
    // client and the server agree about what a repeated key means.
    const kept = applyClientFilters([tags], { tags: ["sale", "new"] }, rows)
    expect(kept.map((r) => r.id)).toEqual(["a", "b", "c"])
  })

  it("combines different filters as AND", () => {
    const kept = applyClientFilters(
      [division, tags],
      { division: "ladies", tags: ["new"] },
      rows,
    )
    expect(kept.map((r) => r.id)).toEqual(["b"])
  })

  it("applies an inclusive range", () => {
    const kept = applyClientFilters([price], { price: [200, 300] }, rows)
    expect(kept.map((r) => r.id)).toEqual(["b", "c"])
  })

  it("searches the declared haystack, case-insensitively", () => {
    const kept = applyClientFilters([search], { q: "DRESS" }, rows)
    expect(kept.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("NEVER applies a server-side filter on the client", () => {
    /* The request already applied it. Re-applying means two implementations of
     * one rule, and the client's copy will drift from the server's. */
    const serverSide: FilterField<Row> = { ...division, where: "server" }
    const kept = applyClientFilters([serverSide], { division: "mens" }, rows)
    expect(kept).toHaveLength(4)
  })

  it("ignores an empty selection rather than matching nothing", () => {
    expect(applyClientFilters([tags], { tags: [] }, rows)).toHaveLength(4)
    expect(applyClientFilters([search], { q: "   " }, rows)).toHaveLength(4)
  })
})

describe("countOptions", () => {
  it("counts each value of a select", () => {
    const counts = countOptions(division, rows)
    expect(counts.get("ladies")).toBe(2)
    expect(counts.get("mens")).toBe(2)
  })

  it("counts a row once per tag it carries", () => {
    const counts = countOptions(tags, rows)
    expect(counts.get("sale")).toBe(2)
    expect(counts.get("new")).toBe(2)
  })

  it("counts against the rows it is given, which is how facets stay honest", () => {
    /* `useFilters` passes the rows the OTHER filters already narrowed. Counting
     * against the full list instead is what makes a hand-rolled chip promise
     * more than it delivers. */
    const ladiesOnly = applyClientFilters([division], { division: "ladies" }, rows)
    const counts = countOptions(tags, ladiesOnly)
    expect(counts.get("sale")).toBe(2)
    expect(counts.get("new")).toBe(1)
  })
})
