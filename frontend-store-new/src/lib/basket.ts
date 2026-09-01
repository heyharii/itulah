import { useSyncExternalStore } from "react"

import { normalizeEpc } from "@/lib/epc"
import type { CatalogRow } from "@itulah/contract"

/// What is on the counter right now.
///
/// Kept on disk for the same reason the sale queue is: the tablet sleeps, the
/// browser is killed, the shop's wifi drops and somebody reloads to "fix" it —
/// and a basket held in `useState` is gone in every one of those cases, with a
/// customer standing there and eleven garments already scanned. It survives.
///
/// A line is a *unit*, not a quantity. The wire is `SaleRequest.epcs`, one tag
/// per garment, and the node refuses duplicates: two of the same shirt are two
/// different tags, and there is no such thing as scanning one twice.

const STORAGE_KEY = "till.basket.v1"

export interface BasketLine {
  readonly epc: string
  readonly sku_code: string
  /// From the shop's resident price book. `null` when this SKU is not in the
  /// published book at all — an unusual but real state, and one the screen has
  /// to say out loud rather than price at zero.
  readonly name: string | null
  readonly unit_price_minor: number | null
  readonly base_unit_price_minor: number | null
  readonly price_source: string | null
  readonly scannedAt: string
}

export interface Basket {
  readonly lines: readonly BasketLine[]
  /// Codes the shopper presented. A promotion gated by a coupon stays shut
  /// until its code appears on the sale.
  readonly coupons: readonly string[]
  /// The shopper, when they are known — needed for a coupon issued to one
  /// person and for a per-customer usage limit.
  readonly customerId: string | null
}

const EMPTY: Basket = { lines: [], coupons: [], customerId: null }

let basket: Basket = load()
const listeners = new Set<() => void>()

function load(): Basket {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return EMPTY
    const parsed = JSON.parse(raw) as Partial<Basket>
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
      customerId: parsed.customerId ?? null,
    }
  } catch {
    return EMPTY
  }
}

function save(next: Basket): void {
  basket = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // See `sale-queue.ts`: durability is worth having and is not worth
    // refusing to serve a customer over.
  }
  for (const listener of listeners) listener()
}

/// Subscribe and read, both hoisted out of the hook.
///
/// An inline `subscribe` is a new function on every render, and React
/// unsubscribes and resubscribes each time it sees one. It is not wrong — the
/// snapshot is re-read after every resubscribe — but it is churn on the busiest
/// component in the app, and one module-level function costs nothing.
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): Basket {
  return basket
}

export function useBasket(): Basket {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/// Keep two tabs looking at one basket.
///
/// A shop tablet ends up with two of these open more often than anyone plans.
/// Without this each tab holds its own snapshot and writes it over the whole
/// key, so a garment scanned in one disappears when the other scans the next
/// one. The queue MERGES on this event, because two sales are two sales; a
/// basket does not, because one counter has one basket — the tabs converge on
/// whatever was scanned last, which is what a person at that counter means.
export function startBasket(): () => void {
  const onOtherTab = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    basket = load()
    for (const listener of listeners) listener()
  }
  window.addEventListener("storage", onOtherTab)
  return () => window.removeEventListener("storage", onOtherTab)
}

/// Why a scan did not go in the basket. Each of these is a sentence somebody at
/// a counter can act on, which is why they are told apart at all.
export type AddOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "already-scanned" }

export function addToBasket(
  epc: string,
  product: CatalogRow | undefined,
  sku_code: string,
): AddOutcome {
  const normalized = normalizeEpc(epc)
  // The node refuses a sale containing the same EPC twice, and it is right to:
  // one tag is one garment. Catching it here means the cashier is told at the
  // scan rather than at the payment.
  if (basket.lines.some((line) => line.epc === normalized)) {
    return { ok: false, reason: "already-scanned" }
  }
  const line: BasketLine = {
    epc: normalized,
    sku_code,
    name: product?.name ?? null,
    unit_price_minor: product?.unit_price_minor ?? null,
    base_unit_price_minor: product?.base_unit_price_minor ?? null,
    price_source: product?.price_source ?? null,
    scannedAt: new Date().toISOString(),
  }
  save({ ...basket, lines: [...basket.lines, line] })
  return { ok: true }
}

export function removeFromBasket(epc: string): void {
  save({ ...basket, lines: basket.lines.filter((line) => line.epc !== epc) })
}

export function clearBasket(): void {
  save(EMPTY)
}

export function addCoupon(code: string): void {
  const trimmed = code.trim().toUpperCase()
  if (trimmed === "" || basket.coupons.includes(trimmed)) return
  save({ ...basket, coupons: [...basket.coupons, trimmed] })
}

export function removeCoupon(code: string): void {
  save({ ...basket, coupons: basket.coupons.filter((one) => one !== code) })
}

export function setCustomer(id: string | null): void {
  const trimmed = id?.trim() ?? ""
  save({ ...basket, customerId: trimmed === "" ? null : trimmed })
}

/// The basket as one product per row, which is how a person reads it.
///
/// The wire stays per-unit; this is only the grouping the screen draws. Three
/// of the same shirt is one row saying three, not three rows a cashier has to
/// count.
export interface BasketGroup {
  readonly sku_code: string
  readonly name: string | null
  readonly unit_price_minor: number | null
  readonly base_unit_price_minor: number | null
  readonly price_source: string | null
  readonly lines: readonly BasketLine[]
  readonly quantity: number
  /// `null` when any unit in the group has no published price.
  readonly line_total_minor: number | null
}

export function groupBasket(lines: readonly BasketLine[]): BasketGroup[] {
  const groups = new Map<string, BasketLine[]>()
  for (const line of lines) {
    const found = groups.get(line.sku_code)
    if (found === undefined) groups.set(line.sku_code, [line])
    else found.push(line)
  }
  return [...groups.entries()].map(([sku_code, group]) => {
    const head = group[0]
    return {
      sku_code,
      name: head.name,
      unit_price_minor: head.unit_price_minor,
      base_unit_price_minor: head.base_unit_price_minor,
      price_source: head.price_source,
      lines: group,
      quantity: group.length,
      line_total_minor:
        head.unit_price_minor === null
          ? null
          : head.unit_price_minor * group.length,
    }
  })
}

/// What the counter will say the basket comes to.
///
/// A quote, and the screen labels it as one. The engine that actually prices a
/// sale — markdowns, coupons, whole-cart thresholds — runs on the node, and
/// `SaleResult.total_minor` is the number that was charged. This is the shelf
/// arithmetic a cashier needs *before* taking money, computed from the same
/// resident book the counter reads, so it is right in every ordinary case and
/// low by exactly whatever promotion the till could not see.
export interface Quote {
  readonly totalMinor: number
  readonly units: number
  /// True when some line has no published price, so the total is a floor
  /// rather than a figure.
  readonly incomplete: boolean
  /// What markdowns already took off, against the was-prices.
  readonly savedMinor: number
}

export function quoteBasket(lines: readonly BasketLine[]): Quote {
  let totalMinor = 0
  let savedMinor = 0
  let incomplete = false
  for (const line of lines) {
    if (line.unit_price_minor === null) {
      incomplete = true
      continue
    }
    totalMinor += line.unit_price_minor
    if (
      line.base_unit_price_minor !== null &&
      line.base_unit_price_minor > line.unit_price_minor
    ) {
      savedMinor += line.base_unit_price_minor - line.unit_price_minor
    }
  }
  return { totalMinor, units: lines.length, incomplete, savedMinor }
}
