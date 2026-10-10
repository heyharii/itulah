import assert from "node:assert/strict"
import { test } from "node:test"

import {
  findSupplier,
  supplierLabel,
} from "../src/screens/procurement/supplier-format.ts"

const book = [
  { supplier_id: "id-a", supplier_code: "A", name: " Maju ", legal_form: "PT" },
  { supplier_id: "id-b", supplier_code: "B", name: "Bersama" },
  { supplier_id: "id-c", supplier_code: "C", name: " bersama " },
]

test("lookup preserves exact references, name fallbacks and ambiguity", () => {
  assert.equal(findSupplier(book, "id-a"), book[0])
  assert.equal(findSupplier(book, "A", "Bersama"), book[0])
  assert.equal(findSupplier(book, "missing", "MAJU"), book[0])
  assert.equal(findSupplier(book, " maju "), book[0])
  assert.equal(findSupplier(book, null, "Bersama"), undefined)
  assert.equal(findSupplier(book, "id-c", "Bersama"), book[2])
  assert.equal(findSupplier(book, "A ", ""), undefined)
  assert.equal(supplierLabel(book, "A"), " Maju, PT")
  assert.equal(supplierLabel(book, "unknown", "Original name"), "Original name")
  const collisions = [
    { supplier_id: "id", supplier_code: "ref", name: "First" },
    { supplier_id: "ref", supplier_code: "other", name: "Second" },
  ]
  assert.equal(findSupplier(collisions, "ref"), collisions[0])
})

test("a refetched snapshot reflects renames and resolves changed ambiguity", () => {
  const refreshed = book.map((entry, index) =>
    index === 2 ? { ...entry, name: "New name" } : entry
  )
  assert.equal(findSupplier(refreshed, null, "Bersama"), refreshed[1])
  assert.equal(findSupplier(refreshed, "New name"), refreshed[2])
  assert.equal(findSupplier(book, null, "Bersama"), undefined)
})

test("repeated row labels traverse a 10,000 supplier snapshot only once", () => {
  let reads = 0
  const large = Array.from({ length: 10_000 }, (_, index) => ({
    supplier_id: `id-${index}`,
    supplier_code: `SUP-${index}`,
    get name() {
      reads++
      return `Supplier ${index}`
    },
  }))
  for (let index = 0; index < 1_000; index++) {
    assert.equal(findSupplier(large, null, "supplier 9999"), large[9999])
    assert.equal(findSupplier(large, "SUP-9999"), large[9999])
  }
  assert.equal(reads, large.length)
})
