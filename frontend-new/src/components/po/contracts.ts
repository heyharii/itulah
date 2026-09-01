/**
 * Response contracts for `po/api.ts`.
 *
 * Every fetch in this domain is `api.get<unknown>` feeding a defensive
 * mapper (`toOrder`/`toSummary`/`toLine`, all in `./api.ts`) — the second of
 * the two populations in docs/recipe-response-contracts.md. A malformed row
 * already degrades safely there (a missing field reads as `""`/`0`/`"active"`
 * via `str`/`num`/`poStatus`), so these schemas are not attached to the
 * fetch. They are passed to `checkContract` after the envelope is unwrapped,
 * purely to make a silent mismatch observable instead of swallowing it.
 */

import { z } from "zod"

/**
 * Procurement money is integer IDR throughout the Go domain — `po/api.ts`
 * says as much on its own write path (`Math.round(item.unit_price)` before
 * every `POST`/`PUT`). This is therefore strict on purpose: a float reaching
 * this field on read is not this schema being wrong, it is the one real
 * money regression this layer exists to catch. See docs/money-contract.md.
 */
const MoneyMinor = z.number().int()

/**
 * One line of `items[]` on both the list and detail payloads. Loose on
 * everything but the money field and the ids a screen keys off of —
 * `toLine` already falls back to a synthetic id
 * (`${orderId}-line-${index}`) for a hand-typed line with no
 * `sourcing_item_id`, so that field staying optional here is not a gap, it
 * is the documented shape of a manual line.
 */
const PurchaseOrderLineRow = z.object({
  item_id: z.string().nullish(),
  sourcing_item_id: z.string().nullish(),
  name: z.string().nullish(),
  ordered_qty: z.number().nullish(),
  unit_price: MoneyMinor.nullish(),
  division_id: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
  photo_urls: z.array(z.unknown()).nullish(),
})

/**
 * One row of the list response (`poListFromSQL`) or the bare object the
 * single-PO handler returns. The two are different projections of the same
 * row — the detail handler "leaves supplier_name, the rollups and
 * subtotal_amount empty" per `PurchaseOrderSummary`'s own doc comment — so
 * one schema covers both call sites; the fields the detail endpoint omits
 * are already `.nullish()`.
 *
 * `po_id` is the one field kept strict beyond money: it becomes `order.id`,
 * which is both the React key for every order row and the id every
 * subsequent detail fetch and mutation is addressed by. A row missing it is
 * not a row this UI can safely render, unlike a missing `supplier_name`.
 */
export const PurchaseOrderRow = z.object({
  po_id: z.string(),
  po_number: z.string().nullish(),
  supplier_id: z.string().nullish(),
  supplier_name: z.string().nullish(),
  supplier_code: z.string().nullish(),
  expected_date: z.string().nullish(),
  /**
   * The backend's whole status vocabulary is 3 values, and `PO_STATUS_META`
   * is a `Record<PoStatus, …>` the order list and detail screen both key
   * off directly — exactly the "enum the UI switches on" case the recipe
   * calls out for strictness. `poStatus()` in `./api.ts` already treats any
   * value outside this set as `active` rather than crashing, but that
   * silent fallback is precisely what this schema should surface instead of
   * hide.
   */
  status: z.enum(["active", "closed", "cancelled"]).nullish(),
  items: z.array(PurchaseOrderLineRow).nullish(),
  created_at: z.string().nullish(),
  order_date: z.string().nullish(),
  notes: z.string().nullish(),
  lines_count: z.number().nullish(),
  ordered_qty: z.number().nullish(),
  received_qty: z.number().nullish(),
  // `receivedStatus()` already folds any value outside {partial,complete}
  // to "none", and nothing downstream keys a Record off it — loose per the
  // "enums the UI only displays" rule.
  received_status: z.string().nullish(),
  is_overdue: z.boolean().nullish(),
  destination_name: z.string().nullish(),
  total_amount: MoneyMinor.nullish(),
  currency: z.string().nullish(),
})
export type PurchaseOrderRow = z.infer<typeof PurchaseOrderRow>
