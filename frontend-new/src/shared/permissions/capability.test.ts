import { describe, expect, it } from "vitest"

import {
  checkCapability,
  checkEveryCapability,
  checkSomeCapability,
  type CapabilitySet,
} from "./capability"

const holding = (...codes: string[]): CapabilitySet => ({ codes })

describe("checkCapability", () => {
  it("allows an exactly held code", () => {
    expect(checkCapability(holding("finance.settle"), "finance.settle").allowed).toBe(true)
  })

  it("denies a code the session does not hold, and says which", () => {
    const verdict = checkCapability(holding("finance.view"), "finance.settle")
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain("finance.settle")
  })

  it("honours a module wildcard", () => {
    expect(checkCapability(holding("inventory.*"), "inventory.adjust").allowed).toBe(true)
  })

  it("does not let one module's wildcard cover another module", () => {
    expect(checkCapability(holding("inventory.*"), "finance.settle").allowed).toBe(false)
  })

  it("does not let a wildcard cover a module whose name it merely prefixes", () => {
    // "inventory.*" must not reach "inventory_admin.adjust"
    expect(checkCapability(holding("inventory.*"), "inventory_admin.adjust").allowed).toBe(
      false
    )
  })

  it("honours the root wildcard", () => {
    expect(checkCapability(holding("*"), "anything.at.all").allowed).toBe(true)
  })

  it("lets superadmin through whatever its code list says", () => {
    const set: CapabilitySet = { codes: ["forum.view"], role: "superadmin" }
    expect(checkCapability(set, "system.manage").allowed).toBe(true)
  })

  /* The decision documented at the top of capability.ts. `readStringArray`
   * answers [] both for "holds nothing" and for "the payload had no
   * permissions field", and a UI courtesy gate must not black out the suite on
   * the second one. */
  it("allows when the session carries no codes at all — unknown, not none", () => {
    expect(checkCapability(holding(), "finance.settle").allowed).toBe(true)
  })

  it("allows when there is no session — the auth gate owns that state", () => {
    expect(checkCapability(null, "finance.settle").allowed).toBe(true)
  })
})

describe("checkEveryCapability", () => {
  it("requires all of them", () => {
    const set = holding("po.create", "po.send")
    expect(checkEveryCapability(set, ["po.create", "po.send"]).allowed).toBe(true)
    expect(checkEveryCapability(set, ["po.create", "po.cancel"]).allowed).toBe(false)
  })

  it("reports the first code that failed", () => {
    const verdict = checkEveryCapability(holding("po.create"), ["po.create", "po.cancel"])
    expect(verdict.reason).toContain("po.cancel")
  })
})

describe("checkSomeCapability", () => {
  it("needs only one", () => {
    expect(checkSomeCapability(holding("po.send"), ["po.create", "po.send"]).allowed).toBe(
      true
    )
  })

  it("denies when it holds none, and names them all", () => {
    const verdict = checkSomeCapability(holding("forum.view"), ["po.create", "po.send"])
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain("po.create")
    expect(verdict.reason).toContain("po.send")
  })

  it("allows an empty requirement", () => {
    expect(checkSomeCapability(holding("forum.view"), []).allowed).toBe(true)
  })
})
