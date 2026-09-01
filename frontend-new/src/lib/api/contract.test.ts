import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  checkContract,
  ContractError,
  onContractViolation,
  resetContractReports,
  routeLabel,
  validateContract,
  type ContractViolation,
} from "./contract"

const Money = z.object({
  amount: z.number().int(),
  currency: z.string(),
})

afterEach(() => {
  resetContractReports()
  vi.unstubAllEnvs()
})

describe("validateContract", () => {
  it("returns the parsed value when the payload matches", () => {
    expect(
      validateContract(Money, { amount: 1500, currency: "IDR" }, "/v1/x")
    ).toEqual({ amount: 1500, currency: "IDR" })
  })

  it("returns the schema's output, so a schema may normalise", () => {
    const schema = z.object({ name: z.string().trim() })
    expect(validateContract(schema, { name: "  Budi " }, "/v1/x")).toEqual({
      name: "Budi",
    })
  })

  it("throws under test, naming the field and the endpoint", () => {
    expect(() =>
      validateContract(Money, { amount: 15.5, currency: "IDR" }, "/v1/ledger")
    ).toThrow(ContractError)

    try {
      validateContract(Money, { amount: 15.5, currency: "IDR" }, "/v1/ledger")
    } catch (error) {
      const contract = error as ContractError
      expect(contract.path).toBe("/v1/ledger")
      expect(contract.message).toContain("amount")
      /* The payload rides along, because the first question about a contract
       * failure is always "what did it actually send?" */
      expect(contract.payload).toEqual({ amount: 15.5, currency: "IDR" })
    }
  })

  it("rejects an async schema rather than silently awaiting it", () => {
    const asyncSchema = z.object({
      code: z.string().refine(async () => true),
    })
    expect(() => validateContract(asyncSchema, { code: "a" }, "/v1/x")).toThrow(
      /synchronous/
    )
  })
})

describe("in production", () => {
  /* The behaviour that matters most: a schema written wrong must not blank a
   * screen that was working. */
  function asProduction() {
    vi.stubEnv("DEV", false)
    vi.stubEnv("MODE", "production")
  }

  it("returns the payload unchanged instead of throwing", () => {
    asProduction()
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))

    const payload = { amount: 15.5, currency: "IDR", extra: "field" }
    const result = validateContract(Money, payload, "/v1/ledger")

    expect(result).toBe(payload)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.path).toBe("/v1/ledger")
  })

  it("reports an endpoint once, however often it refetches", () => {
    asProduction()
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))

    for (let i = 0; i < 50; i += 1) {
      validateContract(Money, { amount: 1.5, currency: "IDR" }, "/v1/ledger")
    }
    expect(seen).toHaveLength(1)
  })

  it("still reports a different endpoint", () => {
    asProduction()
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))

    validateContract(Money, {}, "/v1/a")
    validateContract(Money, {}, "/v1/b")
    expect(seen.map((v) => v.path)).toEqual(["/v1/a", "/v1/b"])
  })
})

describe("routeLabel", () => {
  /* The bug this fixes: `request()` only has the real URL, so without this a
   * single wrong schema reports once per record rather than once. */
  it("collapses uuids, numbers and opaque tokens", () => {
    expect(routeLabel("/v1/records/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(
      "/v1/records/:id"
    )
    expect(routeLabel("/v1/po/482/lines")).toBe("/v1/po/:id/lines")
    expect(routeLabel("/v1/customer/admin/CUST0000198374621/360")).toBe(
      /* `360` is a route word, not an id, and this collapses it anyway — see
       * the note in `routeLabel`. The label stays stable and route-unique,
       * which is all it has to be. */
      "/v1/customer/admin/:id/:id"
    )
  })

  it("keeps route words that merely look long or hyphenated", () => {
    expect(routeLabel("/v1/commercial/purchase-orders")).toBe(
      "/v1/commercial/purchase-orders"
    )
    expect(routeLabel("/v1/commercial/member-program/config")).toBe(
      "/v1/commercial/member-program/config"
    )
    expect(routeLabel("/v1/accounting/reports/profit-and-loss")).toBe(
      "/v1/accounting/reports/profit-and-loss"
    )
  })

  it("drops the query string, which varies per call", () => {
    expect(routeLabel("/v1/finance/invoices?limit=200&status=recorded")).toBe(
      "/v1/finance/invoices"
    )
  })
})

describe("checkContract", () => {
  function asProduction() {
    vi.stubEnv("DEV", false)
    vi.stubEnv("MODE", "production")
  }

  it("never throws, whatever the rows look like", () => {
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))
    /* Not wrapped in expect().not.toThrow() — the group-2 rows it guards are
     * already handled defensively downstream, so throwing here would break a
     * screen that was never going to break. */
    checkContract(Money, [{ amount: 1.5, currency: "IDR" }], "/v1/x")
    expect(seen).toHaveLength(1)
  })

  it("reports the first offending row only", () => {
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))
    const rows = Array.from({ length: 200 }, (_, i) => ({
      amount: i + 0.5,
      currency: "IDR",
    }))
    checkContract(Money, rows, "/v1/many")
    expect(seen).toHaveLength(1)
    expect(seen[0]?.payload).toEqual({ amount: 0.5, currency: "IDR" })
  })

  it("normalises the caller's label, query string and ids alike", () => {
    asProduction()
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))

    checkContract(Money, [{}], "/v1/masterdata/suppliers?limit=200")
    checkContract(Money, [{}], "/v1/records/482/comments")

    expect(seen.map((v) => v.path)).toEqual([
      "/v1/masterdata/suppliers",
      "/v1/records/:id/comments",
    ])
  })
})

describe("the report gate is per schema, not per route", () => {
  /* Three domains each describe /v1/masterdata/suppliers. Before this, the
   * first one to report silenced the other two on the same route. */
  it("lets a second schema report on a route another already reported", () => {
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))

    const financeShape = z.object({ supplier_id: z.string() })
    const sourcingShape = z.object({ id: z.string() })

    checkContract(financeShape, [{}], "/v1/masterdata/suppliers")
    checkContract(sourcingShape, [{}], "/v1/masterdata/suppliers")

    expect(seen).toHaveLength(2)
  })

  it("still gates one schema on one route", () => {
    const seen: ContractViolation[] = []
    onContractViolation((violation) => seen.push(violation))
    for (let i = 0; i < 20; i += 1) {
      checkContract(Money, [{}], "/v1/masterdata/suppliers")
    }
    expect(seen).toHaveLength(1)
  })
})
