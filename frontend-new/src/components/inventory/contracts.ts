/**
 * Wire schemas for cloud-hub's inventory read models.
 *
 * Every fetch in `./api.ts` goes `api.get<unknown>` into a defensive parser
 * (`stringFrom`, `optionalInt`, `numberFrom`, or one of the `parse*`
 * functions) that already tolerates a missing field with a fallback, or —
 * for the operations reads — throws inside a try/catch that turns the
 * failure into a per-section error string rather than a broken screen.
 * These schemas run alongside that path through `checkContract`, which
 * never throws — the value is the report, not a guard.
 *
 * Field names are the wire's snake_case, matching the `Api*` interfaces
 * already in `api.ts` (kept as-is — they are the defensive parser's input
 * type, not a second description this schema replaces).
 *
 * Quantities are units, not money — this project's rule is that a unit is
 * the truth. `optionalInt()` in `api.ts` calls `Math.trunc` on whatever
 * arrives, which quietly accepts a float; every quantity field below is
 * `z.number().int()` so that instead surfaces as a reported contract
 * violation. See the task report for what was actually observed.
 */

import { z } from "zod"

/** Inventory quantities are units — see the module doc above. */
const qtyNullish = z.number().int().nullish()

export const LocationRow = z.object({
  location_id: z.string().nullish(),
  code: z.string().nullish(),
  name: z.string().nullish(),
  location_type: z.string().nullish(),
  is_active: z.boolean().nullish(),
})
export type LocationRow = z.infer<typeof LocationRow>

export const BinRow = z.object({
  id: z.string().nullish(),
  warehouse_id: z.string().nullish(),
  code: z.string().nullish(),
  // A closed vocabulary cloud-hub owns (display/backroom/available/reject/
  // staging/in_transit/system), but `binPlacement()` already defaults any
  // unrecognised value to a "warehouse, countable" bucket rather than
  // switching exhaustively — loose.
  type: z.string().nullish(),
  name: z.string().nullish(),
  is_system: z.boolean().nullish(),
  status: z.string().nullish(),
})
export type BinRow = z.infer<typeof BinRow>

export const BalanceRow = z.object({
  sku: z.string().nullish(),
  name: z.string().nullish(),
  location_id: z.string().nullish(),
  location_name: z.string().nullish(),
  bin_id: z.string().nullish(),
  qty_on_hand: qtyNullish,
  qty_reserved: qtyNullish,
  qty_available: qtyNullish,
  /*
   * Inventory valuations ARE money. `unit_cost` / `total_value` should be
   * `z.number().int()` plus an explicit currency per the project's money
   * rule — but this balance row carries no currency field at all, so there
   * is nothing to check a currency against, and the row is left loose on
   * `.int()` too rather than guessing minor-units already happened. This is
   * a genuine gap: valuation figures arrive with neither an enforced
   * integer nor a currency. See the task report.
   */
  unit_cost: z.number().nullish(),
  total_value: z.number().nullish(),
  updated_at: z.string().nullish(),
})
export type BalanceRow = z.infer<typeof BalanceRow>

export const MovementRow = z.object({
  id: z.string().nullish(),
  date: z.string().nullish(),
  time: z.string().nullish(),
  item_id: z.string().nullish(),
  item_name: z.string().nullish(),
  warehouse_id: z.string().nullish(),
  warehouse_name: z.string().nullish(),
  // Free-text voucher type; `movementKind()` maps it with `.includes()` and
  // a "correction" fallback for anything unrecognised — loose.
  voucher_type: z.string().nullish(),
  voucher_no: z.string().nullish(),
  qty_in: qtyNullish,
  qty_out: qtyNullish,
  balance: qtyNullish,
  // Money, no currency field on this row — see BalanceRow's note above.
  unit_cost: z.number().nullish(),
  total_cost: z.number().nullish(),
  performed_by: z.string().nullish(),
  notes: z.string().nullish(),
})
export type MovementRow = z.infer<typeof MovementRow>

export const ProblemItemRow = z.object({
  id: z.string().nullish(),
  store_id: z.string().nullish(),
  sku: z.string().nullish(),
  source_type: z.string().nullish(),
  source_ref: z.string().nullish(),
  expected_qty: qtyNullish,
  counted_qty: qtyNullish,
  variance_qty: qtyNullish,
  // Free-text: `buildSnapshot()` only special-cases "short"/"shortage" (and
  // empty) via a string compare, not an exhaustive switch — cloud-hub's
  // actual vocabulary for the other direction is not documented here, so
  // this stays loose rather than guessing at a closed set.
  direction: z.string().nullish(),
  status: z.string().nullish(),
  notes: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  resolved_by: z.string().nullish(),
  resolved_at: z.string().nullish(),
  resolution: z.string().nullish(),
})
export type ProblemItemRow = z.infer<typeof ProblemItemRow>

/** `/api/v1/inventory/pool-status` — a single object, checked as a
 * one-element list per the HR module's convention for singular payloads. */
export const PoolStatusPayload = z.object({
  installed: z.boolean().nullish(),
  ready: z.boolean().nullish(),
  // A closed set the code switches on (falls back to "unknown" otherwise) —
  // strict, matching what parseProjection() actually recognises.
  mode: z.enum(["disabled", "shadow", "active"]).nullish(),
  authority: z.string().nullish(),
  reason: z.string().nullish(),
})
export type PoolStatusPayload = z.infer<typeof PoolStatusPayload>

export const CycleCountRow = z.object({
  id: z.string().nullish(),
  initiated_by: z.string().nullish(),
  scope: z.string().nullish(),
  target_store_ids: z.array(z.string()).nullish(),
  sample_strategy: z.string().nullish(),
  sample_size: qtyNullish,
  skus: z.array(z.string()).nullish(),
  status: z.string().nullish(),
  scheduled_for: z.string().nullish(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type CycleCountRow = z.infer<typeof CycleCountRow>

export const CycleCountVarianceItemRow = z.object({
  id: z.string().nullish(),
  cycle_id: z.string().nullish(),
  sku: z.string().nullish(),
  location_id: z.string().nullish(),
  bin_id: z.string().nullish(),
  expected_qty: qtyNullish,
  counted_qty: qtyNullish,
  variance: qtyNullish,
  counted_by: z.string().nullish(),
  counted_at: z.string().nullish(),
  notes: z.string().nullish(),
})
export type CycleCountVarianceItemRow = z.infer<typeof CycleCountVarianceItemRow>

/** `/api/v1/cycle-counts/{id}/variance-report` — the envelope around the
 * `items` array checked separately against `CycleCountVarianceItemRow`. */
export const CycleCountVariancePayload = z.object({
  cycle_id: z.string().nullish(),
  total_items: qtyNullish,
  counted_items: qtyNullish,
})
export type CycleCountVariancePayload = z.infer<typeof CycleCountVariancePayload>

export const ReceivingBatchRow = z.object({
  id: z.string().nullish(),
  po_id: z.string().nullish(),
  grn_id: z.string().nullish(),
  supplier_id: z.string().nullish(),
  stage: qtyNullish,
  total_units: qtyNullish,
  meta_complete: z.boolean().nullish(),
  bound_count: qtyNullish,
  print_batch_id: z.string().nullish(),
  // Home Price Point total — money, no currency field on this row; loose on
  // `.int()` for the same reason as BalanceRow's `unit_cost` above.
  hpp_total: z.number().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  closed_at: z.string().nullish(),
  closed_by: z.string().nullish(),
})
export type ReceivingBatchRow = z.infer<typeof ReceivingBatchRow>

export const DcOperationRow = z.object({
  dc_id: z.string().nullish(),
  operation_type: z.string().nullish(),
  entity_id: z.string().nullish(),
  status: z.string().nullish(),
  destination: z.string().nullish(),
  item_count: qtyNullish,
  verified: z.boolean().nullish(),
  missing_count: qtyNullish,
  last_event_type: z.string().nullish(),
  occurred_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type DcOperationRow = z.infer<typeof DcOperationRow>

export const InboundReturnRow = z.object({
  id: z.string().nullish(),
  return_number: z.string().nullish(),
  store_id: z.string().nullish(),
  reason: z.string().nullish(),
  status: z.string().nullish(),
  items_count: qtyNullish,
  received_by: z.string().nullish(),
  received_at: z.string().nullish(),
  inspector_notes: z.string().nullish(),
  // Mapped straight through as a display string (InboundReturnOperation.totalValue
  // is `string`, not `number`) — loose, this is presentational here.
  total_value: z.union([z.string(), z.number()]).nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
})
export type InboundReturnRow = z.infer<typeof InboundReturnRow>

export const InboundReturnLineRow = z.object({
  id: z.string().nullish(),
  return_id: z.string().nullish(),
  sku: z.string().nullish(),
  name: z.string().nullish(),
  qty: qtyNullish,
  condition: z.string().nullish(),
  disposition: z.string().nullish(),
  disposition_notes: z.string().nullish(),
})
export type InboundReturnLineRow = z.infer<typeof InboundReturnLineRow>
