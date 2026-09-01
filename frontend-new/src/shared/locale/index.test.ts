/**
 * These tests exist to pin down decisions, not to check arithmetic.
 *
 * Money was formatted in ten places with three different behaviours, and the
 * differences were not stylistic — one of them made a free item
 * indistinguishable from one whose price had never been set. If someone later
 * "simplifies" `formatIDR` back toward any of those, one of these fails.
 */

import { describe, expect, it } from "vitest"

import { UNKNOWN, formatAmount, formatIDR, formatPercent, formatQty } from "./index"

describe("formatIDR — the decisions", () => {
  it("renders zero as an amount, not as unknown", () => {
    /* The old articles formatter did `value === 0 ? "—"`. That conflates a
     * genuinely free item with one whose price was never set — and it was only
     * doing it because its adapter collapsed a missing price to 0. */
    expect(formatIDR(0)).toBe("Rp 0")
  })

  it("renders absent as unknown, not as zero", () => {
    expect(formatIDR(null)).toBe(UNKNOWN)
    expect(formatIDR(undefined)).toBe(UNKNOWN)
  })

  it("puts the sign outside the currency mark", () => {
    // `-Rp 5.000`, which is how it is written here — not `Rp -5.000`.
    expect(formatIDR(-5000)).toBe("-Rp 5.000")
  })

  it("groups by thousands in the Indonesian style", () => {
    expect(formatIDR(1500000)).toBe("Rp 1.500.000")
  })

  it("can mark a positive amount when a delta needs a direction", () => {
    expect(formatIDR(2500, { signed: true })).toBe("+Rp 2.500")
    expect(formatIDR(0, { signed: true })).toBe("Rp 0")
  })

  it("refuses to render a non-finite number as money", () => {
    expect(formatIDR(Number.NaN)).toBe(UNKNOWN)
    expect(formatIDR(Number.POSITIVE_INFINITY)).toBe(UNKNOWN)
  })

  it("rounds a fractional input rather than showing sen", () => {
    /* A fraction here is a bug upstream — money is integer minor units — but
     * IDR has no sen in practice, so `Rp 1.500,33` would be noise the type
     * should never have allowed. */
    expect(formatIDR(1500.33)).toBe("Rp 1.500")
    expect(formatIDR(1500.66)).toBe("Rp 1.501")
  })
})

describe("formatQty — separate from money on purpose", () => {
  it("groups without a currency mark", () => {
    /* Several call sites reached for the money formatter to group a count.
     * That reads fine until someone adds a currency mark to it and silently
     * turns "1.240 events" into "Rp 1.240". */
    expect(formatQty(1240)).toBe("1.240")
  })

  it("treats absent as unknown", () => {
    expect(formatQty(null)).toBe(UNKNOWN)
  })
})

describe("formatAmount — money without the mark", () => {
  it("groups an amount for a column that carries its unit in the header", () => {
    expect(formatAmount(1500000)).toBe("1.500.000")
  })
})

describe("formatPercent — takes a ratio, not a percentage", () => {
  it("converts at the boundary so call sites cannot disagree", () => {
    // The backend stores ratios. Converting here is one place to be wrong
    // instead of every call site.
    expect(formatPercent(0.075)).toBe("7,5%")
    expect(formatPercent(0.075, 2)).toBe("7,50%")
  })

  it("treats absent as unknown", () => {
    expect(formatPercent(undefined)).toBe(UNKNOWN)
  })
})
